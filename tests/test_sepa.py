"""SEPA-Lastschrift: Mandate, Vormerkung beim Stellen, pain.008-Datei, Gutschrift, Rücklastschrift.

Volle Schema-Prüfung der Einzugsdatei, wenn PAIN008_XSD (pain.008.001.08.xsd) gesetzt und lxml installiert ist.
"""

from __future__ import annotations

import io
import os
import xml.etree.ElementTree as ET
from datetime import date, timedelta

import pytest

from meit.sepa import is_target_day, next_target_day, sepa_text, valid_creditor_id

NS = {"p": "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08"}
DEBTOR_IBAN = "AT022050302101023600"


def _setup(client, app, scheme="CORE") -> dict:
    r = client.put("/api/billing/profile", json={"iban": "AT61 1904 3002 3457 3201", "bic": "BKAUATWW",
                                                 "creditor_id": "AT61ZZZ01234567890", "sepa_prenotify_days": 5})
    assert r.status_code == 200, r.text
    m = client.post("/api/customers/1/mandates", json={"iban": "AT02 2050 3021 0102 3600", "signed_on": "2026-01-15",
                                                       "holder": "Tischlerei Huber GmbH", "scheme": scheme})
    assert m.status_code == 201, m.text
    return m.json()


def _finalize(client, period="2026-10") -> list[dict]:
    client.post("/api/billing/run", json={"period": period})
    return [client.put(f"/api/invoices/{i['id']}", json={"status": "gestellt"}).json()
            for i in client.get("/api/invoices?status=entwurf").json()]


def _csv(rows) -> bytes:
    return ("Buchungsdatum;Partnername;Betrag;Verwendungszweck\n"
            + "\n".join(f"{d};{p};{a};{t}" for d, p, a, t in rows)).encode("cp1252")


def test_helpers():
    assert valid_creditor_id("DE98ZZZ09999999999") and valid_creditor_id("AT61ZZZ01234567890")
    assert not valid_creditor_id("AT62ZZZ01234567890") and not valid_creditor_id("ATXX")
    assert sepa_text("Müller & Söhne – Café „Zum Bären“ <GmbH>") == "Mueller + Soehne - Cafe 'Zum Baeren' GmbH"
    assert not is_target_day(date(2026, 12, 25)) and not is_target_day(date(2026, 11, 21))  # Feiertag / Samstag
    assert not is_target_day(date(2027, 3, 26)) and not is_target_day(date(2027, 3, 29))  # Karfreitag / Ostermontag 2027
    assert next_target_day(date(2026, 12, 24)) == date(2026, 12, 24)
    assert next_target_day(date(2026, 12, 25)) == date(2026, 12, 28)


def test_mandate_validation_and_replacement(client, app):
    client.put("/api/billing/profile", json={"creditor_id": "AT62ZZZ01234567890"})  # falsche Prüfziffer
    assert client.put("/api/billing/profile", json={"creditor_id": "AT62ZZZ01234567890"}).status_code == 422
    bad = client.post("/api/customers/1/mandates", json={"iban": "AT02 2050 3021 0102 3601", "signed_on": "2026-01-15"})
    assert bad.status_code == 422 and "IBAN" in bad.json()["detail"]
    future = (date.today() + timedelta(days=3)).isoformat()
    assert client.post("/api/customers/1/mandates", json={"iban": DEBTOR_IBAN, "signed_on": future}).status_code == 422
    m1 = _setup(client, app)
    assert m1["reference"].endswith("-00001-1") and m1["status"] == "aktiv"
    m2 = client.post("/api/customers/1/mandates", json={"iban": DEBTOR_IBAN, "signed_on": "2026-02-01", "scheme": "B2B"}).json()
    ms = {m["id"]: m["status"] for m in client.get("/api/customers/1/mandates").json()}
    assert ms == {m1["id"]: "ersetzt", m2["id"]: "aktiv"}
    pdf = client.get(f"/api/mandates/{m2['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.get("/api/customers/2/mandate-form.pdf?scheme=B2B").content.startswith(b"%PDF")


def test_finalize_marks_direct_debit_with_prenotification(client, app):
    _setup(client, app)
    invs = _finalize(client)
    huber = next(i for i in invs if i["customer_id"] == 1)
    other = next(i for i in invs if i["customer_id"] != 1)
    assert huber["payment_method"] == "lastschrift" and huber["sepa_status"] == "vorgemerkt"
    due = date.fromisoformat(huber["sepa_due"])
    assert due >= date.fromisoformat(huber["date"]) + timedelta(days=5) and is_target_day(due)
    assert huber["due_date"] == huber["sepa_due"] and other["payment_method"] == "ueberweisung"
    # PDF: Lastschrift-Hinweis statt Zahlungsaufforderung (ohne QR-Code)
    pypdf = pytest.importorskip("pypdf")
    text = pypdf.PdfReader(io.BytesIO(client.get(f"/api/invoices/{huber['id']}/pdf").content)).pages[0].extract_text()
    assert "SEPA-Lastschrift" in text and "AT02 **** 3600" in text and "Bitte überweisen" not in text
    assert "Lastschrift" in client.get(f"/api/invoices/{huber['id']}/mail").json()["text"]
    xml = client.get(f"/api/invoices/{huber['id']}/ebinterface.xml")
    if xml.status_code == 200:
        assert b"<SEPADirectDebit>" in xml.content and b"AT61ZZZ01234567890" in xml.content
    # nicht mahnen, solange eingezogen wird
    app.state.ctx.db.update("invoices", huber["id"], {"due_date": (date.today() - timedelta(days=30)).isoformat()})
    assert all(p["invoice_id"] != huber["id"] for p in client.get("/api/dunning").json()["proposals"])


def test_batch_file_and_collective_credit(client, app):
    _setup(client, app)
    client.post("/api/customers/2/mandates", json={"iban": "AT483200000012345864", "signed_on": "2026-03-01",
                                                   "scheme": "B2B", "holder": "Steuerberatung Gruber & Partner"})
    invs = [i for i in _finalize(client) if i["payment_method"] == "lastschrift"]
    assert len(invs) == 2
    ov = client.get("/api/sepa").json()
    assert ov["creditor_id_ok"] and len(ov["pending"]) == 2 and ov["pending"][0]["debtor_iban"].startswith("AT")
    assert client.post("/api/sepa/batches", json={"collection_date": date.today().isoformat()}).status_code == 422
    batch = client.post("/api/sepa/batches", json={}).json()
    assert batch["count"] == 2 and batch["total"] == round(sum(i["gross"] for i in invs), 2)
    raw = client.get(f"/api/sepa/batches/{batch['id']}/xml").content
    root = ET.fromstring(raw)
    assert root.find("p:CstmrDrctDbtInitn/p:GrpHdr/p:NbOfTxs", NS).text == "2"
    pmts = root.findall("p:CstmrDrctDbtInitn/p:PmtInf", NS)
    assert sorted(p.find("p:PmtTpInf/p:LclInstrm/p:Cd", NS).text for p in pmts) == ["B2B", "CORE"]
    core = next(p for p in pmts if p.find("p:PmtTpInf/p:LclInstrm/p:Cd", NS).text == "CORE")
    assert core.find("p:CdtrSchmeId/p:Id/p:PrvtId/p:Othr/p:Id", NS).text == "AT61ZZZ01234567890"
    assert core.find("p:CdtrAgt/p:FinInstnId/p:BICFI", NS).text == "BKAUATWW"
    tx = core.find("p:DrctDbtTxInf", NS)
    assert tx.find("p:DbtrAcct/p:Id/p:IBAN", NS).text == DEBTOR_IBAN
    assert tx.find("p:DbtrAgt/p:FinInstnId/p:Othr/p:Id", NS).text == "NOTPROVIDED"
    assert tx.find("p:PmtId/p:EndToEndId", NS).text in {i["number"] for i in invs}
    b2b = next(p for p in pmts if p is not core)
    assert b2b.find("p:DrctDbtTxInf/p:Dbtr/p:Nm", NS).text == "Steuerberatung Gruber + Partner"
    xsd = os.environ.get("PAIN008_XSD")
    if xsd:
        etree = pytest.importorskip("lxml.etree")
        schema = etree.XMLSchema(etree.parse(xsd))
        doc = etree.fromstring(raw)
        assert schema.validate(doc), schema.error_log
    assert all(i["sepa_status"] == "eingereicht" for i in client.get("/api/invoices").json() if i["payment_method"] == "lastschrift")
    assert client.get("/api/sepa").json()["batches"][0]["status"] == "eingereicht"
    # Sammelgutschrift am Einzugstag → beide Rechnungen bezahlt
    day = date.fromisoformat(batch["collection_date"]).strftime("%d.%m.%Y")
    r = client.post("/api/bank/import", content=_csv([(day, "ME-IT", f"{batch['total']:.2f}".replace(".", ","),
                                                       "SEPA Lastschrift Einzug Sammler")]))
    assert r.json()["matched"] == 1
    paid = [i for i in client.get("/api/invoices").json() if i["payment_method"] == "lastschrift"]
    assert all(i["status"] == "bezahlt" and i["sepa_status"] == "eingezogen" for i in paid)
    assert client.get("/api/sepa").json()["batches"][0]["status"] == "gutgeschrieben"


def test_return_debit_reopens_invoice_and_requeue(client, app):
    _setup(client, app)
    inv = next(i for i in _finalize(client) if i["payment_method"] == "lastschrift")
    batch = client.post("/api/sepa/batches", json={}).json()
    day = date.fromisoformat(batch["collection_date"]).strftime("%d.%m.%Y")
    assert client.post("/api/bank/import", content=_csv([(day, "Einzug", f"{batch['total']:.2f}".replace(".", ","),
                                                          "SEPA")])).json()["matched"] == 1
    fee_total = round(inv["gross"] + 7.5, 2)
    r = client.post("/api/bank/import", content=_csv([(day, "Raiffeisen", f"-{fee_total:.2f}".replace(".", ","),
                                                       f"RUECKLASTSCHRIFT {inv['number']} AM04 Deckung")])).json()
    assert r["missing_receipts"] == 0
    back = next(i for i in client.get("/api/invoices").json() if i["id"] == inv["id"])
    assert back["status"] == "gestellt" and back["paid_amount"] == 0 and back["sepa_status"] == "ruecklastschrift"
    assert back["payment_method"] == "ueberweisung"
    tx = client.get("/api/bank?direction=out").json()[0]
    assert "Rücklastschrift" in tx["match_note"] and "7,50" in tx["match_note"]
    assert client.get("/api/sepa").json()["returns"][0]["id"] == inv["id"]
    # Mahnwesen greift wieder (nach Kulanz), PDF zeigt wieder QR/Überweisung
    app.state.ctx.db.update("invoices", inv["id"], {"due_date": (date.today() - timedelta(days=8)).isoformat()})
    assert any(p["invoice_id"] == inv["id"] for p in client.get("/api/dunning").json()["proposals"])
    # erneut einziehen
    again = client.post(f"/api/invoices/{inv['id']}/sepa-requeue").json()
    assert again["sepa_status"] == "vorgemerkt" and again["payment_method"] == "lastschrift"


def test_revoke_mandate_turns_pending_into_transfer(client, app):
    m = _setup(client, app)
    inv = next(i for i in _finalize(client) if i["customer_id"] == 1)
    assert inv["payment_method"] == "lastschrift"
    assert client.post(f"/api/mandates/{m['id']}/revoke").json()["status"] == "widerrufen"
    inv = next(i for i in client.get("/api/invoices").json() if i["id"] == inv["id"])
    assert inv["payment_method"] == "ueberweisung" and inv["sepa_status"] == ""
    assert client.post("/api/sepa/batches", json={}).status_code == 422


def test_no_direct_debit_without_creditor_id(client, app):
    client.put("/api/billing/profile", json={"iban": "AT61 1904 3002 3457 3201"})
    client.post("/api/customers/1/mandates", json={"iban": DEBTOR_IBAN, "signed_on": "2026-01-15"})
    inv = next(i for i in _finalize(client) if i["customer_id"] == 1)
    assert inv["payment_method"] == "ueberweisung"
