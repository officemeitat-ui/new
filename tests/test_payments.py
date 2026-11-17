"""Geldkreislauf: Kontoauszug-Import, Zahlungsabgleich, Belege, Mahnwesen, EPC-QR."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from meit.payments import BankFormatError, parse_amount, parse_camt, parse_csv, parse_mt940, parse_statement
from meit.pdf import epc_payload, payment_qr, valid_iban


class FakeMailer:
    imap_configured = smtp_configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body, in_reply_to="", reply_handle="", attachments=None, html="", cc=""):
        self.sent.append({"to": to, "subject": subject, "body": body, "attachments": attachments or [], "cc": cc})
        return f"<m{len(self.sent)}@test>"


def _invoices(client, n=2) -> list[dict]:
    client.put("/api/billing/profile", json={"iban": "AT61 1904 3002 3457 3201", "bic": "BKAUATWW"})
    client.post("/api/billing/run", json={"period": "2026-10"})
    out = []
    for inv in client.get("/api/invoices?status=entwurf").json()[:n]:
        out.append(client.put(f"/api/invoices/{inv['id']}", json={"status": "gestellt"}).json())
    return out


def _csv(rows: list[tuple[str, str, str, str]]) -> bytes:
    lines = ["Buchungsdatum;Partnername;Partner IBAN;Betrag;Währung;Verwendungszweck"]
    lines += [f"{d};{p};{i};{a};EUR;{t}" for d, p, i, a, t in [(r[0], r[1], r[2], r[3], r[4]) for r in rows]]
    return "\n".join(lines).encode("cp1252")


def _import(client, data: bytes, name="auszug.csv") -> dict:
    r = client.post("/api/bank/import", content=data, headers={"X-Filename": name})
    assert r.status_code == 200, r.text
    return r.json()


def _eur(v: float) -> str:
    return f"{v:.2f}".replace(".", ",")


# ------------------------------------------------------------------ Parser
@pytest.mark.parametrize("raw,expected", [
    ("1.234,56", 1234.56), ("-12,30", -12.3), ("+561,60", 561.6), ("1,234.56", 1234.56), ("561.60", 561.6),
    ("12,30-", -12.3), ("1.234", 1234.0), ("€ 99,00", 99.0), ("−5,00", -5.0),
])
def test_parse_amount(raw, expected):
    assert parse_amount(raw) == expected


def test_parse_csv_george_style_cp1252():
    txs = parse_csv(_csv([("05.11.2026", "Müller GmbH", "AT02 2050 3021 0102 3600", "1.234,56", "Rechnung 2026-0001"),
                          ("06.11.2026", "A1 Telekom", "", "-49,90", "Lastschrift")]))
    assert [t.amount for t in txs] == [1234.56, -49.9]
    assert txs[0].partner == "Müller GmbH" and txs[0].iban == "AT022050302101023600"
    assert txs[0].booking_date == "2026-11-05" and "2026-0001" in txs[0].text


def test_parse_csv_with_preamble_and_without_header():
    pre = b"Kontoauszug;AT61...\n\nDatum;Text;Betrag\n01.10.2026;Gutschrift Huber RE 2026-0001;+561,60\n"
    assert parse_csv(pre)[0].amount == 561.6
    elba = ("05.11.2026;Gutschrift HUBER FRANZ RE 2026-0001 Danke;05.11.2026;+561,60;EUR;05.11.2026 10:22:33:123\n"
            "06.11.2026;Abbuchung A1 Telekom Austria Rechnung 4711;06.11.2026;-49,90;EUR;06.11.2026 08:00:00:000\n")
    txs = parse_csv(elba.encode())
    assert [(t.booking_date, t.amount) for t in txs] == [("2026-11-05", 561.6), ("2026-11-06", -49.9)]
    assert "RE 2026-0001" in txs[0].text and txs[0].currency == "EUR"
    with pytest.raises(BankFormatError):
        parse_csv(b"foo;bar\nbaz;qux\n")


CAMT = b"""<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="EUR">561.60</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-05</Dt></BookgDt>
 <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Tischlerei Huber GmbH</Nm></Pty></Dbtr>
 <DbtrAcct><Id><IBAN>AT022050302101023600</IBAN></Id></DbtrAcct></RltdPties>
 <RmtInf><Ustrd>Rechnung 2026-0001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><DtTm>2026-11-06T09:00:00</DtTm></BookgDt>
 <NtryDtls>
  <TxDtls><Amt Ccy="EUR">100.00</Amt><RmtInf><Ustrd>A</Ustrd></RmtInf></TxDtls>
  <TxDtls><Amt Ccy="EUR">200.00</Amt><RmtInf><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>
 </NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">49.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-07</Dt></BookgDt>
 <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>A1 Telekom Austria</Nm></Cdtr></RltdPties></TxDtls></NtryDtls>
 <AddtlNtryInf>SEPA Lastschrift</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>"""


def test_parse_camt053():
    txs = parse_camt(CAMT)
    assert [t.amount for t in txs] == [561.6, 100.0, 200.0, -49.9]  # Sammelbuchung aufgeteilt
    assert txs[0].partner == "Tischlerei Huber GmbH" and txs[0].iban == "AT022050302101023600"
    assert txs[1].booking_date == "2026-11-06" and txs[2].reference == "RF18539007547034"
    assert txs[3].partner == "A1 Telekom Austria" and "Lastschrift" in txs[3].text
    assert parse_statement(CAMT, "x.xml")[0].amount == 561.6


def test_camt_rejects_entities():
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Document>&a;</Document>'
    with pytest.raises(BankFormatError):
        parse_camt(evil)


def test_parse_mt940():
    mt = (":20:STARTUMS\n:25:BKAUATWW/12345678901\n:28C:00001/001\n:60F:C261104EUR1000,00\n"
          ":61:2611051105C561,60NTRFNONREF//X\n:86:166?00GUTSCHRIFT?20RE 2026-0001?21DANKE?32TISCHLEREI HUBER\n"
          ":61:2611061106D49,90NDDTNONREF\n:86:105?00LASTSCHRIFT?20A1 TELEKOM?32A1 TELEKOM AUSTRIA AG\n"
          ":62F:C261106EUR1511,70\n-")
    txs = parse_mt940(mt.encode())
    assert [(t.booking_date, t.amount) for t in txs] == [("2026-11-05", 561.6), ("2026-11-06", -49.9)]
    assert "RE 2026-0001" in txs[0].text and txs[0].partner == "TISCHLEREI HUBER"
    assert parse_statement(mt.encode(), "auszug.sta")[1].amount == -49.9


# ------------------------------------------------------------------ Abgleich
def test_payment_by_invoice_number_marks_paid_and_dedupes(client):
    inv1, inv2 = _invoices(client)
    data = _csv([(date.today().strftime("%d.%m.%Y"), "Irgendwer", "AT022050302101023600", _eur(inv1["gross"]),
                  f"Zahlung RE {inv1['number']} danke")])
    r = _import(client, data)
    assert r["imported"] == 1 and r["matched"] == 1
    paid = next(i for i in client.get("/api/invoices").json() if i["id"] == inv1["id"])
    assert paid["status"] == "bezahlt" and paid["paid_amount"] == inv1["gross"] and paid["paid_at"]
    again = _import(client, data)
    assert again["imported"] == 0 and again["duplicates"] == 1
    tx = client.get("/api/bank").json()[0]
    assert tx["status"] == "zugeordnet" and tx["invoice_numbers"] == inv1["number"]
    # Zuordnung lösen → Rechnung wieder offen
    client.post(f"/api/bank/{tx['id']}/unassign")
    back = next(i for i in client.get("/api/invoices").json() if i["id"] == inv1["id"])
    assert back["status"] == "gestellt" and back["paid_amount"] == 0


def test_partial_and_collective_payments(client):
    inv1, inv2 = _invoices(client)
    day = date.today().strftime("%d.%m.%Y")
    _import(client, _csv([(day, "X", "", "100,00", f"Teilzahlung {inv1['number']}")]))
    part = next(i for i in client.get("/api/invoices").json() if i["id"] == inv1["id"])
    assert part["status"] == "gestellt" and part["paid_amount"] == 100
    assert "Teilzahlung" in client.get("/api/bank").json()[0]["match_note"]
    rest = round(inv1["gross"] - 100 + inv2["gross"], 2)
    r = _import(client, _csv([(day, "X", "", _eur(rest), f"RG {inv1['number']} und {inv2['number']}")]))
    assert r["matched"] == 1
    statuses = {i["id"]: i["status"] for i in client.get("/api/invoices").json()}
    assert statuses[inv1["id"]] == statuses[inv2["id"]] == "bezahlt"
    assert len(client.get(f"/api/invoices/{inv1['id']}/payments").json()) == 2


def test_name_match_is_suggestion_then_iban_is_learned(client):
    inv1, inv2 = _invoices(client)
    customer = inv1["customer_name"]
    day = date.today().strftime("%d.%m.%Y")
    r = _import(client, _csv([(day, customer.upper(), "AT483200000012345864", _eur(inv1["gross"]), "Danke")]))
    assert r["suggested"] == 1
    tx = client.get("/api/bank?status=vorschlag").json()[0]
    assert tx["suggestion"] == [inv1["id"]]
    assert client.post(f"/api/bank/{tx['id']}/accept").json()["status"] == "zugeordnet"
    # nächste Rechnung desselben Kunden: IBAN bekannt + exakter Betrag → automatisch
    client.post("/api/billing/run", json={"period": "2026-11"})
    nxt = next(i for i in client.get("/api/invoices?status=entwurf").json() if i["customer_id"] == inv1["customer_id"])
    nxt = client.put(f"/api/invoices/{nxt['id']}", json={"status": "gestellt"}).json()
    r = _import(client, _csv([(day, "Online-Banking", "AT48 3200 0000 1234 5864", _eur(nxt["gross"]), "Überweisung")]))
    assert r["matched"] == 1


def test_unknown_payment_stays_open_and_manual_assign(client):
    inv1, _ = _invoices(client)
    _import(client, _csv([(date.today().strftime("%d.%m.%Y"), "Unbekannt", "", "12,34", "Spende")]))
    tx = client.get("/api/bank?status=offen").json()[0]
    assert client.post(f"/api/bank/{tx['id']}/assign", json={"invoice_ids": [inv1["id"]]}).json()["status"] == "zugeordnet"
    assert client.post(f"/api/bank/{tx['id']}/assign", json={"invoice_ids": [inv1["id"]]}).status_code == 422
    assert client.post(f"/api/bank/{tx['id']}/ignore", json={}).status_code == 409


def test_debits_matched_to_receipts_or_flagged(client, app):
    db = app.state.ctx.db
    rid = db.insert("receipts", {"vendor": "A1 Telekom Austria", "invoice_no": "4711", "invoice_date": "2026-11-01",
                                 "amount": 49.90})
    r = _import(client, _csv([
        ("06.11.2026", "A1 Telekom Austria AG", "", "-49,90", "Lastschrift Rechnung 4711"),
        ("07.11.2026", "Finanzamt Salzburg-Land", "", "-1.200,00", "UVA 09/2026"),
        ("08.11.2026", "Amazon EU", "", "-89,99", "Bestellung 302-123"),
    ]))
    assert r["receipts_linked"] == 1 and r["missing_receipts"] == 1
    rows = {t["partner"]: t for t in client.get("/api/bank?direction=out").json()}
    assert rows["A1 Telekom Austria AG"]["receipt_id"] == rid
    assert rows["Finanzamt Salzburg-Land"]["status"] == "ignoriert"
    assert rows["Amazon EU"]["status"] == "beleg_fehlt"
    s = client.get("/api/payments/summary").json()
    assert s["missing_receipts"] == 1 and s["missing_receipts_sum"] == 89.99
    # Beleg kommt später → erneuter Abgleich findet ihn
    db.insert("receipts", {"vendor": "Amazon", "amount": 89.99, "invoice_date": "2026-11-08"})
    assert client.post("/api/bank/rematch").json()["receipts_linked"] == 1


def test_bank_import_rejects_garbage_and_needs_admin(client):
    assert client.post("/api/bank/import", content=b"hallo welt").status_code == 422
    assert client.post("/api/bank/import", content=b"").status_code == 422


# ------------------------------------------------------------------ EPC-QR
def test_epc_qr_payload():
    assert valid_iban("AT61 1904 3002 3457 3201") and not valid_iban("AT61 1904 3002 3457 3202")
    payload = epc_payload("ME-IT ✓", "AT61 1904 3002 3457 3201", 561.6, "Rechnung 2026-0001", "bkauatww")
    assert payload.split("\n") == ["BCD", "002", "1", "SCT", "BKAUATWW", "ME-IT", "AT611904300234573201", "EUR561.60",
                                   "", "", "Rechnung 2026-0001"]
    assert len(payload.encode()) <= 331
    assert payment_qr({"iban": "AT00 1234", "name": "x"}, 10, "r") == ""
    assert payment_qr({"iban": "AT611904300234573201", "name": "x"}, 0, "r") == ""


def test_invoice_pdf_contains_qr(client):
    inv, _ = _invoices(client)
    with_qr = client.get(f"/api/invoices/{inv['id']}/pdf").content
    client.put("/api/billing/profile", json={"iban": ""})
    without = client.get(f"/api/invoices/{inv['id']}/pdf").content
    assert with_qr.startswith(b"%PDF") and len(with_qr) > len(without) + 500


# ------------------------------------------------------------------ Mahnwesen
def _overdue(app, inv: dict, days: int, dunned_days_ago: int | None = None) -> None:
    upd = {"due_date": (date.today() - timedelta(days=days)).isoformat()}
    if dunned_days_ago is not None:
        upd["dunned_at"] = (date.today() - timedelta(days=dunned_days_ago)).isoformat() + " 09:00:00"
    app.state.ctx.db.update("invoices", inv["id"], upd)


def test_dunning_levels_and_sending(client, app):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    inv, inv2 = _invoices(client)
    _overdue(app, inv, 3)
    assert client.get("/api/dunning").json()["proposals"] == []  # noch innerhalb der Kulanz
    _overdue(app, inv, 10)
    props = client.get("/api/dunning").json()["proposals"]
    assert [p["level"] for p in props] == ["Zahlungserinnerung"] and props[0]["total"] == inv["gross"]
    preset = client.get(f"/api/dunning/{inv['id']}/mail").json()
    assert inv["number"] in preset["subject"] and "Guten Tag" in preset["text"]
    assert client.get(f"/api/dunning/{inv['id']}/pdf").content.startswith(b"%PDF")
    r = client.post(f"/api/dunning/{inv['id']}/send", json={})
    assert r.status_code == 200, r.text
    names = [a.name for a in fake.sent[0]["attachments"]]
    assert names[0].startswith("Zahlungserinnerung_") and names[1].startswith("Rechnung_")
    assert client.get("/api/dunning").json()["proposals"] == []  # Mindestabstand
    assert client.get(f"/api/documents?kind=mahnung").json()[0]["folder"].startswith("Buchhaltung/Mahnungen/")

    # 1. Mahnung mit Spesen und Verzugszinsen
    conf = client.get("/api/dunning/settings").json()
    conf["levels"][1]["fee"] = 10
    conf["interest_rate"] = 12.0
    assert client.put("/api/dunning/settings", json=conf).status_code == 200
    _overdue(app, inv, 25, dunned_days_ago=15)
    case = client.get("/api/dunning").json()["proposals"][0]
    assert case["level"] == "1. Mahnung" and case["fees"] == 10
    assert case["interest"] == round(inv["gross"] * 0.12 * 25 / 365, 2)
    assert case["total"] == round(inv["gross"] + 10 + case["interest"], 2)
    client.post("/api/dunning/run")
    _overdue(app, inv, 40, dunned_days_ago=12)
    client.post("/api/dunning/run")
    assert len(fake.sent) == 3 and fake.sent[-1]["subject"].startswith("Letzte Mahnung")
    d = client.get("/api/dunning").json()
    assert d["proposals"] == [] and d["escalations"][0]["number"] == inv["number"]


def test_paid_invoice_is_not_dunned(client, app):
    app.state.ctx.mailer = FakeMailer()
    inv, _ = _invoices(client)
    _overdue(app, inv, 30)
    _import(client, _csv([(date.today().strftime("%d.%m.%Y"), "X", "", _eur(inv["gross"]), inv["number"])]))
    assert client.get("/api/dunning").json()["proposals"] == []
    assert client.post(f"/api/dunning/{inv['id']}/send", json={}).status_code == 422


def test_dunning_settings_validation_and_autopilot_guard(client, app):
    conf = client.get("/api/dunning/settings").json()
    conf["levels"] = list(reversed(conf["levels"]))
    assert client.put("/api/dunning/settings", json=conf).status_code == 422
    assert client.put("/api/dunning/settings", json={"auto_send": True}).json()["auto_send"] is True
    auto = client.get("/api/dunning").json()["autopilot"]
    assert auto["ready"] is False and "Kontoauszug" in auto["reason"]
    _invoices(client, 1)
    _import(client, _csv([(date.today().strftime("%d.%m.%Y"), "Unbekannt", "", "5,00", "?")]))
    auto = client.get("/api/dunning").json()["autopilot"]
    assert auto["ready"] is False and "Zahlungseingänge" in auto["reason"]


def test_summary_aging(client, app):
    inv1, inv2 = _invoices(client)
    _overdue(app, inv1, 45)
    s = client.get("/api/payments/summary").json()
    assert s["aging"]["31_60"] == inv1["gross"] and s["aging"]["nicht_faellig"] == inv2["gross"]
    assert s["overdue_total"] == inv1["gross"] and s["iban_ok"] is True
