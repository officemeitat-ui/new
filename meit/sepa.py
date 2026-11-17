"""SEPA-Lastschrift für Pauschalen und Rechnungen.

* Mandate je Kunde (Referenz, Unterschriftsdatum, IBAN, CORE oder B2B), Mandatsformular als PDF.
* Beim Stellen einer Rechnung für einen Kunden mit aktivem Mandat wird sie zur Lastschrift vorgemerkt:
  Fälligkeit = Rechnungsdatum + Vorabankündigung (die Rechnung ist die Pre-Notification).
* Einzugsdatei (ISO 20022 pain.008.001.08, wahlweise .02) für George Business, ELBA & Co.
* Die Gutschrift (Sammel- oder Einzelbuchung) wird beim Kontoauszug-Import erkannt, Rücklastschriften
  setzen die Rechnung wieder auf offen (→ Mahnwesen mit QR-Code statt erneutem Einzug).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .billing import company_profile
from .db import Database, now_iso
from .pdf import valid_iban

FORMATS = ("pain.008.001.08", "pain.008.001.02")
SEPA_CHARS = re.compile(r"[^A-Za-z0-9/\-?:().,'+ ]")
TRANSLIT = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss", "&": "+",
                          "é": "e", "è": "e", "á": "a", "à": "a", "ó": "o", "í": "i", "ú": "u", "ç": "c",
                          "–": "-", "—": "-", "„": "'", "“": "'", "”": "'", "’": "'", "‚": "'"})


def sepa_text(value: str, max_len: int = 70) -> str:
    """Auf den SEPA-Zeichensatz (EPC „Basic Latin“) reduzieren – sonst lehnt die Bank die Datei ab."""
    text = SEPA_CHARS.sub("", str(value or "").translate(TRANSLIT))
    return re.sub(r"\s+", " ", text).strip()[:max_len]


def valid_creditor_id(cid: str) -> bool:
    """Gläubiger-Identifikationsnummer (Creditor Identifier), Prüfziffer nach EPC262-08."""
    cid = (cid or "").replace(" ", "").upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}", cid):
        return False
    digits = "".join(str(int(ch, 36)) for ch in cid[7:] + cid[:2] + "00")
    return 98 - int(digits) % 97 == int(cid[2:4])


def _easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month = (h + m - 7 * n + 114) // 31
    return date(year, month, (h + m - 7 * n + 114) % 31 + 1)


def is_target_day(day: date) -> bool:
    """TARGET2-Geschäftstag (Basis für SEPA-Fälligkeiten)."""
    if day.weekday() >= 5:
        return False
    easter = _easter(day.year)
    return day not in {date(day.year, 1, 1), easter - timedelta(days=2), easter + timedelta(days=1),
                       date(day.year, 5, 1), date(day.year, 12, 25), date(day.year, 12, 26)}


def next_target_day(day: date) -> date:
    while not is_target_day(day):
        day += timedelta(days=1)
    return day


def mask_iban(iban: str) -> str:
    iban = iban.replace(" ", "")
    return f"{iban[:4]} **** {iban[-4:]}" if len(iban) > 8 else iban


class Sepa:
    def __init__(self, db: Database, company: str = "ME-IT"):
        self.db, self.company = db, company

    def profile(self) -> dict[str, Any]:
        return company_profile(self.db, self.company)

    # -- Mandate
    def active_mandate(self, customer_id: int | None) -> dict[str, Any] | None:
        if not customer_id:
            return None
        return self.db.query_one("SELECT * FROM sepa_mandates WHERE customer_id = ? AND status = 'aktiv' "
                                 "ORDER BY id DESC LIMIT 1", (customer_id,))

    def next_reference(self, customer_id: int) -> str:
        prefix = sepa_text(self.profile().get("invoice_prefix") or self.company, 10).replace(" ", "").upper() or "M"
        n = (self.db.scalar("SELECT COUNT(*) FROM sepa_mandates WHERE customer_id = ?", (customer_id,)) or 0) + 1
        ref = f"{prefix.rstrip('-')}-{customer_id:05d}-{n}"
        while self.db.scalar("SELECT COUNT(*) FROM sepa_mandates WHERE reference = ?", (ref,)):
            n += 1
            ref = f"{prefix.rstrip('-')}-{customer_id:05d}-{n}"
        return ref

    def create_mandate(self, customer_id: int, *, iban: str, signed_on: str, holder: str = "", bic: str = "",
                       scheme: str = "CORE", kind: str = "wiederkehrend", reference: str = "") -> dict[str, Any]:
        customer = self.db.get("customers", customer_id)
        if not customer:
            raise ValueError("Kunde nicht gefunden")
        iban = iban.replace(" ", "").upper()
        if not valid_iban(iban):
            raise ValueError("IBAN ungültig (Prüfziffer)")
        bic = bic.replace(" ", "").upper()
        if bic and not re.fullmatch(r"[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?", bic):
            raise ValueError("BIC ungültig")
        if scheme not in ("CORE", "B2B"):
            raise ValueError("Verfahren: CORE (Basis) oder B2B (Firmen)")
        if kind not in ("wiederkehrend", "einmalig"):
            raise ValueError("Art: wiederkehrend oder einmalig")
        try:
            if date.fromisoformat(signed_on) > date.today():
                raise ValueError("Unterschriftsdatum liegt in der Zukunft")
        except (TypeError, ValueError) as exc:
            raise ValueError(str(exc) if "Zukunft" in str(exc) else "Unterschriftsdatum im Format JJJJ-MM-TT") from None
        reference = sepa_text(reference, 35) if reference else self.next_reference(customer_id)
        if self.db.scalar("SELECT COUNT(*) FROM sepa_mandates WHERE reference = ?", (reference,)):
            raise ValueError("Mandatsreferenz bereits vergeben")
        # ein Kunde hat höchstens ein aktives Mandat – ein neues ersetzt das alte
        self.db.query("UPDATE sepa_mandates SET status = 'ersetzt' WHERE customer_id = ? AND status = 'aktiv'",
                      (customer_id,))
        mid = self.db.insert("sepa_mandates", {
            "customer_id": customer_id, "reference": reference, "signed_on": signed_on,
            "holder": (holder or customer["name"])[:70], "iban": iban, "bic": bic, "scheme": scheme, "kind": kind,
            "status": "aktiv"})
        return self.db.get("sepa_mandates", mid)

    # -- Rechnungen
    def on_finalized(self, invoice_id: int) -> dict[str, Any] | None:
        """Gestellte Rechnung eines Kunden mit aktivem Mandat zur Lastschrift vormerken."""
        inv = self.db.get("invoices", invoice_id)
        if not inv or inv["status"] != "gestellt" or not inv["gross"] or inv["gross"] <= 0:
            return None
        mandate = self.active_mandate(inv["customer_id"])
        profile = self.profile()
        if not mandate or not valid_creditor_id(profile.get("creditor_id", "")) or not valid_iban(profile.get("iban", "")):
            return None
        if mandate["kind"] == "einmalig" and mandate["used_at"]:
            return None
        base = date.fromisoformat(inv["date"]) if inv["date"] else date.today()
        due = next_target_day(base + timedelta(days=int(profile.get("sepa_prenotify_days") or 14)))
        self.db.update("invoices", invoice_id, {"payment_method": "lastschrift", "sepa_mandate_id": mandate["id"],
                                                "sepa_status": "vorgemerkt", "sepa_due": due.isoformat(),
                                                "due_date": due.isoformat()})
        return self.db.get("invoices", invoice_id)

    def requeue(self, invoice_id: int) -> dict[str, Any]:
        """Nach Rücklastschrift erneut einziehen (neue Vorabankündigung nötig)."""
        inv = self.db.get("invoices", invoice_id)
        if not inv or inv["status"] != "gestellt":
            raise ValueError("Nur offene Rechnungen können eingezogen werden")
        mandate = self.active_mandate(inv["customer_id"])
        if not mandate:
            raise ValueError("Kein aktives Mandat für diesen Kunden")
        profile = self.profile()
        due = next_target_day(date.today() + timedelta(days=int(profile.get("sepa_prenotify_days") or 14)))
        self.db.update("invoices", invoice_id, {"payment_method": "lastschrift", "sepa_mandate_id": mandate["id"],
                                                "sepa_status": "vorgemerkt", "sepa_due": due.isoformat(),
                                                "due_date": due.isoformat(), "sepa_batch_id": None})
        return self.db.get("invoices", invoice_id)

    def pending(self) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT i.*, m.reference AS mandate_ref, m.iban AS debtor_iban, m.scheme, m.kind, m.status AS mandate_status "
            "FROM invoices i JOIN sepa_mandates m ON m.id = i.sepa_mandate_id "
            "WHERE i.status = 'gestellt' AND i.payment_method = 'lastschrift' AND i.sepa_status = 'vorgemerkt' "
            "ORDER BY i.sepa_due, i.id")
        for r in rows:
            r["open"] = round(float(r["gross"]) - float(r["paid_amount"] or 0), 2)
            r["debtor_iban"] = mask_iban(r["debtor_iban"])
        return rows

    # -- Einzugsdatei
    def create_batch(self, invoice_ids: list[int] | None = None, collection_date: str | None = None,
                     fmt: str | None = None) -> dict[str, Any]:
        profile = self.profile()
        fmt = fmt or profile.get("sepa_format") or FORMATS[0]
        if fmt not in FORMATS:
            raise ValueError("Unbekanntes Format")
        if not valid_creditor_id(profile.get("creditor_id", "")):
            raise ValueError("Gläubiger-ID fehlt oder ist ungültig (Abrechnung → Firmendaten).")
        if not valid_iban(profile.get("iban", "")):
            raise ValueError("Eigene IBAN fehlt oder ist ungültig (Abrechnung → Firmendaten).")
        rows = [r for r in self.pending() if invoice_ids is None or r["id"] in invoice_ids]
        rows = [r for r in rows if r["mandate_status"] == "aktiv" and r["open"] > 0]
        if not rows:
            raise ValueError("Keine vorgemerkten Lastschriften.")
        earliest = next_target_day(date.today() + timedelta(days=1))
        coll = max([earliest] + [date.fromisoformat(r["sepa_due"]) for r in rows])
        if collection_date:
            wanted = date.fromisoformat(collection_date)
            if wanted < coll:
                raise ValueError(f"Einzugstermin frühestens {coll.strftime('%d.%m.%Y')} (Vorabankündigung beachten).")
            coll = next_target_day(wanted)
        stamp = datetime.now()
        msg_id = f"MEIT{stamp.strftime('%Y%m%d%H%M%S')}{len(rows):03d}"
        while self.db.scalar("SELECT COUNT(*) FROM sepa_batches WHERE msg_id = ?", (msg_id,)):
            msg_id = msg_id[:-3] + f"{int(msg_id[-3:]) + 1:03d}"
        full = {r["id"]: self.db.get("sepa_mandates", r["sepa_mandate_id"]) for r in rows}
        xml = build_pain008(fmt, msg_id, stamp, coll, profile, [
            {"end_to_end": sepa_text(r["number"], 35) or f"RE{r['id']}", "amount": r["open"],
             "mandate": full[r["id"]], "debtor": sepa_text(full[r["id"]]["holder"] or r["customer_name"], 70),
             "remittance": sepa_text(f"Rechnung {r['number']}", 140)} for r in rows])
        total = round(sum(r["open"] for r in rows), 2)
        bid = self.db.insert("sepa_batches", {"msg_id": msg_id, "collection_date": coll.isoformat(), "count": len(rows),
                                              "total": total, "format": fmt, "status": "erstellt", "xml": xml.decode()})
        ts = now_iso()
        for r in rows:
            self.db.update("invoices", r["id"], {"sepa_status": "eingereicht", "sepa_batch_id": bid,
                                                 "sepa_due": coll.isoformat(), "due_date": coll.isoformat()})
            self.db.update("sepa_mandates", r["sepa_mandate_id"], {"used_at": ts})
        return self.db.get("sepa_batches", bid)


def build_pain008(fmt: str, msg_id: str, created: datetime, collection: date, profile: dict[str, Any],
                  txs: list[dict[str, Any]]) -> bytes:
    """ISO-20022-Lastschriftdatei. Eine PmtInf je Verfahren (CORE/B2B) und Sequenz (RCUR/OOFF)."""
    ns = f"urn:iso:std:iso:20022:tech:xsd:{fmt}"
    bic_tag = "BICFI" if fmt.endswith(".08") else "BIC"
    root = ET.Element("Document", xmlns=ns)
    init = ET.SubElement(root, "CstmrDrctDbtInitn")

    def sub(parent: ET.Element, tag: str, text: str | None = None, **attrs: str) -> ET.Element:
        el = ET.SubElement(parent, tag, attrs)
        if text is not None:
            el.text = text
        return el

    def agent(parent: ET.Element, tag: str, bic: str) -> None:
        fin = sub(sub(parent, tag), "FinInstnId")
        if bic:
            sub(fin, bic_tag, bic)
        else:
            sub(sub(fin, "Othr"), "Id", "NOTPROVIDED")

    amount = lambda v: f"{v:.2f}"  # noqa: E731
    hdr = sub(init, "GrpHdr")
    sub(hdr, "MsgId", msg_id)
    sub(hdr, "CreDtTm", created.replace(microsecond=0).isoformat())
    sub(hdr, "NbOfTxs", str(len(txs)))
    sub(hdr, "CtrlSum", amount(sum(t["amount"] for t in txs)))
    sub(sub(hdr, "InitgPty"), "Nm", sepa_text(profile.get("name") or "ME-IT", 70))

    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for t in txs:
        seq = "OOFF" if t["mandate"]["kind"] == "einmalig" else "RCUR"
        groups.setdefault((t["mandate"]["scheme"], seq), []).append(t)
    for n, ((scheme, seq), items) in enumerate(sorted(groups.items()), 1):
        pmt = sub(init, "PmtInf")
        sub(pmt, "PmtInfId", f"{msg_id}-{n}"[:35])
        sub(pmt, "PmtMtd", "DD")
        sub(pmt, "BtchBookg", "true")
        sub(pmt, "NbOfTxs", str(len(items)))
        sub(pmt, "CtrlSum", amount(sum(t["amount"] for t in items)))
        tp = sub(pmt, "PmtTpInf")
        sub(sub(tp, "SvcLvl"), "Cd", "SEPA")
        sub(sub(tp, "LclInstrm"), "Cd", scheme)
        sub(tp, "SeqTp", seq)
        sub(pmt, "ReqdColltnDt", collection.isoformat())
        sub(sub(pmt, "Cdtr"), "Nm", sepa_text(profile.get("name") or "ME-IT", 70))
        sub(sub(sub(pmt, "CdtrAcct"), "Id"), "IBAN", profile["iban"].replace(" ", "").upper())
        agent(pmt, "CdtrAgt", (profile.get("bic") or "").replace(" ", "").upper())
        sub(pmt, "ChrgBr", "SLEV")
        othr = sub(sub(sub(sub(pmt, "CdtrSchmeId"), "Id"), "PrvtId"), "Othr")
        sub(othr, "Id", profile["creditor_id"].replace(" ", "").upper())
        sub(sub(othr, "SchmeNm"), "Prtry", "SEPA")
        for t in items:
            tx = sub(pmt, "DrctDbtTxInf")
            sub(sub(tx, "PmtId"), "EndToEndId", t["end_to_end"])
            sub(tx, "InstdAmt", amount(t["amount"]), Ccy="EUR")
            mri = sub(sub(tx, "DrctDbtTx"), "MndtRltdInf")
            sub(mri, "MndtId", t["mandate"]["reference"])
            sub(mri, "DtOfSgntr", t["mandate"]["signed_on"])
            agent(tx, "DbtrAgt", t["mandate"]["bic"])
            sub(sub(tx, "Dbtr"), "Nm", t["debtor"])
            sub(sub(sub(tx, "DbtrAcct"), "Id"), "IBAN", t["mandate"]["iban"])
            sub(sub(tx, "RmtInf"), "Ustrd", t["remittance"])
    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


def mandate_markdown(mandate: dict[str, Any], customer: dict[str, Any], profile: dict[str, Any]) -> str:
    firm = profile.get("name") or "ME-IT"
    b2b = mandate["scheme"] == "B2B"
    address = ", ".join(l.strip() for l in (profile.get("address") or "").splitlines() if l.strip())
    lines = [f"# SEPA-{'Firmen-' if b2b else ''}Lastschrift-Mandat", "",
             f"**Zahlungsempfänger:** {firm}{', ' + address if address else ''}  ",
             f"**Gläubiger-Identifikationsnummer:** {profile.get('creditor_id') or '–'}  ",
             f"**Mandatsreferenz:** {mandate['reference']}  ",
             f"**Art der Zahlung:** {'wiederkehrende Zahlung' if mandate['kind'] == 'wiederkehrend' else 'einmalige Zahlung'}",
             ""]
    if b2b:
        lines += [f"Wir ermächtigen {firm}, Zahlungen von unserem Konto mittels SEPA-Firmenlastschrift einzuziehen. "
                  f"Zugleich weisen wir unser Kreditinstitut an, die von {firm} auf unser Konto gezogenen "
                  "SEPA-Firmenlastschriften einzulösen.", "",
                  "**Hinweis:** Dieses Lastschriftmandat dient nur dem Einzug von SEPA-Firmenlastschriften, die auf "
                  "Konten von Unternehmen gezogen sind. Wir sind nicht berechtigt, nach der erfolgten Einlösung eine "
                  "Erstattung des belasteten Betrages zu verlangen. Wir sind berechtigt, unser Kreditinstitut bis zum "
                  "Fälligkeitstag anzuweisen, Lastschriften nicht einzulösen. Das Mandat muss vor der ersten Lastschrift "
                  "auch unserem Kreditinstitut bestätigt werden."]
    else:
        lines += [f"Ich ermächtige / Wir ermächtigen {firm}, Zahlungen von meinem / unserem Konto mittels "
                  f"SEPA-Lastschrift einzuziehen. Zugleich weise ich mein / weisen wir unser Kreditinstitut an, die von "
                  f"{firm} auf mein / unser Konto gezogenen SEPA-Lastschriften einzulösen.", "",
                  "**Hinweis:** Ich kann / Wir können innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, "
                  "die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem / unserem "
                  "Kreditinstitut vereinbarten Bedingungen."]
    days = int(profile.get("sepa_prenotify_days") or 14)
    debtor_address = ", ".join(part.strip() for part in re.split(r"[\n,]", customer.get("address") or "") if part.strip())
    lines += ["", f"Die Vorabinformation über Betrag und Fälligkeit (Pre-Notification) erfolgt mit der Rechnung "
                  f"mindestens {days} Kalendertage vor dem Einzug.", "",
              "## Zahlungspflichtiger", "",
              "| Feld | Eintrag |", "|---|---|",
              f"| Name / Firma | {mandate['holder'] or customer['name']} |",
              f"| Anschrift | {debtor_address or '______________________________'} |",
              f"| IBAN | {mandate['iban'] or '______________________________'} |",
              f"| BIC | {mandate['bic'] or '(optional)'} |", "",
              "", "", "Ort, Datum: ________________________________________", "", "",
              "Unterschrift(en) des Kontoinhabers: ________________________________________"]
    return "\n".join(lines)


# ----------------------------------------------------------------------------- API
class MandateIn(BaseModel):
    iban: str = Field(..., max_length=40)
    signed_on: str
    holder: str = Field("", max_length=70)
    bic: str = Field("", max_length=11)
    scheme: str = "CORE"
    kind: str = "wiederkehrend"
    reference: str = Field("", max_length=35)


class BatchIn(BaseModel):
    invoice_ids: Optional[list[int]] = None
    collection_date: Optional[str] = None
    format: Optional[str] = None


def register(app: FastAPI, ctx: Any, admin_only, sepa: Sepa) -> Sepa:
    db: Database = ctx.db

    def guard(fn):
        try:
            return fn()
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/sepa")
    def overview() -> dict:
        profile = sepa.profile()
        pending = sepa.pending()
        batches = db.query("SELECT id, msg_id, collection_date, count, total, format, status, created_at FROM sepa_batches "
                           "ORDER BY id DESC LIMIT 50")
        return {"creditor_id_ok": valid_creditor_id(profile.get("creditor_id", "")), "iban_ok": valid_iban(profile.get("iban", "")),
                "prenotify_days": profile.get("sepa_prenotify_days"), "format": profile.get("sepa_format"),
                "pending": pending, "pending_total": round(sum(r["open"] for r in pending), 2), "batches": batches,
                "mandates_active": db.scalar("SELECT COUNT(*) FROM sepa_mandates WHERE status = 'aktiv'") or 0,
                "returns": db.query("SELECT id, number, customer_name, gross, paid_amount FROM invoices "
                                    "WHERE sepa_status = 'ruecklastschrift' AND status = 'gestellt'")}

    @app.get("/api/customers/{cid}/mandates")
    def mandates(cid: int) -> list[dict]:
        return db.query("SELECT * FROM sepa_mandates WHERE customer_id = ? ORDER BY id DESC", (cid,))

    @app.post("/api/customers/{cid}/mandates", status_code=201, dependencies=[Depends(admin_only)])
    def create_mandate(cid: int, data: MandateIn) -> dict:
        return guard(lambda: sepa.create_mandate(cid, iban=data.iban, signed_on=data.signed_on, holder=data.holder,
                                                 bic=data.bic, scheme=data.scheme, kind=data.kind,
                                                 reference=data.reference))

    @app.post("/api/mandates/{mid}/revoke", dependencies=[Depends(admin_only)])
    def revoke(mid: int) -> dict:
        m = db.get("sepa_mandates", mid)
        if not m:
            raise HTTPException(404, "Mandat nicht gefunden")
        db.update("sepa_mandates", mid, {"status": "widerrufen"})
        # vorgemerkte (noch nicht eingereichte) Lastschriften werden zu normalen Überweisungsrechnungen
        db.query("UPDATE invoices SET payment_method = 'ueberweisung', sepa_status = '' WHERE sepa_mandate_id = ? "
                 "AND sepa_status = 'vorgemerkt'", (mid,))
        return db.get("sepa_mandates", mid)

    @app.get("/api/mandates/{mid}/pdf")
    def mandate_pdf(mid: int):
        from .documents import pdf_response

        m = db.get("sepa_mandates", mid)
        if not m:
            raise HTTPException(404, "Mandat nicht gefunden")
        customer = db.get("customers", m["customer_id"]) or {"name": ""}
        data = ctx.docs.text_pdf("SEPA-Lastschrift-Mandat", mandate_markdown(m, customer, sepa.profile()))
        return pdf_response(data, f"SEPA-Mandat_{m['reference']}.pdf")

    @app.get("/api/customers/{cid}/mandate-form.pdf")
    def blank_mandate(cid: int, scheme: str = "CORE"):
        """Vorausgefülltes Formular zum Unterschreiben (IBAN trägt der Kunde ein)."""
        from .documents import pdf_response

        customer = db.get("customers", cid)
        if not customer:
            raise HTTPException(404, "Kunde nicht gefunden")
        draft = {"reference": sepa.next_reference(cid), "scheme": "B2B" if scheme == "B2B" else "CORE",
                 "kind": "wiederkehrend", "holder": customer["name"], "iban": "", "bic": ""}
        data = ctx.docs.text_pdf("SEPA-Lastschrift-Mandat", mandate_markdown(draft, customer, sepa.profile()))
        return pdf_response(data, f"SEPA-Mandat_{draft['reference']}.pdf")

    @app.post("/api/sepa/batches", status_code=201, dependencies=[Depends(admin_only)])
    def create_batch(data: BatchIn) -> dict:
        batch = guard(lambda: sepa.create_batch(data.invoice_ids, data.collection_date, data.format))
        batch.pop("xml", None)
        return batch

    @app.get("/api/sepa/batches/{bid}/xml", dependencies=[Depends(admin_only)])
    def batch_xml(bid: int) -> Response:
        b = db.get("sepa_batches", bid)
        if not b:
            raise HTTPException(404, "Einzugsdatei nicht gefunden")
        if b["status"] == "erstellt":
            db.update("sepa_batches", bid, {"status": "eingereicht"})
        return Response(b["xml"], media_type="application/xml", headers={
            "Content-Disposition": f'attachment; filename="SEPA-Lastschrift_{b["collection_date"]}_{b["msg_id"]}.xml"'})

    @app.post("/api/invoices/{iid}/sepa-requeue", dependencies=[Depends(admin_only)])
    def requeue(iid: int) -> dict:
        return guard(lambda: sepa.requeue(iid))

    return sepa
