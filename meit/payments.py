"""Geldkreislauf: Kontoauszug-Import, automatischer Zahlungsabgleich, Ausgaben ohne Beleg, Mahnwesen.

* **Import**: CSV aus George/ELBA/Bank Austria/Volksbank (Spalten werden erkannt, auch ohne Kopfzeile),
  CAMT.053 (ISO 20022, XML) und MT940. Doppelte Buchungen werden beim erneuten Import erkannt.
* **Zahlungseingänge** werden über die Rechnungsnummer im Verwendungszweck zugeordnet – auch Teil- und
  Sammelzahlungen. Ohne Nummer: bekannte IBAN bzw. Kundenname + exakter Betrag (als Vorschlag).
* **Abbuchungen** werden mit den Belegen abgeglichen; was fehlt, landet in „Ausgaben ohne Beleg“.
* **Mahnwesen**: Zahlungserinnerung → 1. Mahnung → letzte Mahnung, als PDF im Corporate Design mit QR-Code,
  Versand über Outlook/Microsoft 365 bzw. SMTP. Wahlweise mit Freigabe oder automatisch (täglich).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .billing import company_profile
from .branding import get_branding, logo_path
from .db import Database, now_iso
from .documents import DocumentError, fill_text, pdf_response
from .mail import Attachment, MailError
from .pdf import _d, _eur, dunning_pdf, valid_iban

# Abbuchungen, für die kein eigener Beleg nötig ist (Kontoauszug bzw. Bescheid genügt)
NO_RECEIPT_KEYWORDS = ("finanzamt", "abgabenkonto", "svs ", "sozialversicherung", "ögk", "oegk", "gehalt", "lohn ",
                       "löhne", "kontoführung", "kontofuehrung", "kontoführungsentgelt", "habenzinsen", "sollzinsen",
                       "kest", "kapitalertragsteuer", "umbuchung", "eigenübertrag", "privatentnahme")
LEGAL_WORDS = {"gmbh", "kg", "og", "eu", "ag", "co", "und", "partner", "dr", "mag", "ing", "gesmbh", "e", "u", "the",
               "firma", "gruppe", "ges", "mbh", "bei", "von", "der", "die", "das"}

DEFAULT_DUNNING: dict[str, Any] = {
    "auto_send": False,          # Autopilot: täglich automatisch versenden
    "min_days_between": 10,      # Mindestabstand zwischen zwei Stufen
    "interest_rate": 0.0,        # Verzugszinsen % p. a. (B2B: Basiszinssatz + 9,2 %-Punkte, § 456 UGB)
    "max_import_age_days": 7,    # Autopilot nur, wenn der letzte Kontoauszug höchstens so alt ist
    "levels": [
        {"name": "Zahlungserinnerung", "days": 7, "fee": 0.0, "payment_days": 7,
         "subject": "Zahlungserinnerung – Rechnung {nummer}",
         "text": ("{anrede}\n\nsicher ist es im Alltag nur untergegangen: Unsere Rechnung {nummer} vom {datum} über "
                  "{betrag} war am {faellig} fällig. Bis heute konnten wir noch keinen Zahlungseingang feststellen.\n\n"
                  "Bitte überweisen Sie den offenen Betrag von {gesamt} bis {frist}. Die Rechnung liegt zur Sicherheit "
                  "noch einmal bei.\n\nFreundliche Grüße\n{firma}")},
        {"name": "1. Mahnung", "days": 21, "fee": 0.0, "payment_days": 7,
         "subject": "1. Mahnung – Rechnung {nummer}",
         "text": ("{anrede}\n\nleider ist unsere Rechnung {nummer} vom {datum} trotz Zahlungserinnerung weiterhin "
                  "offen ({tage} Tage nach Fälligkeit). Wir ersuchen Sie, den Betrag von {gesamt} bis spätestens "
                  "{frist} zu begleichen.\n\nFalls es zur Rechnung Fragen gibt, melden Sie sich bitte – wir finden "
                  "sicher eine Lösung.\n\nFreundliche Grüße\n{firma}")},
        {"name": "Letzte Mahnung", "days": 35, "fee": 0.0, "payment_days": 7,
         "subject": "Letzte Mahnung – Rechnung {nummer}",
         "text": ("{anrede}\n\ntrotz Zahlungserinnerung und Mahnung ist unsere Rechnung {nummer} vom {datum} noch "
                  "immer offen. Bitte überweisen Sie {gesamt} bis spätestens {frist}.\n\nSollte bis dahin kein "
                  "Zahlungseingang erfolgen, müssen wir weitere Schritte einleiten (Inkasso bzw. gerichtliche "
                  "Geltendmachung). Das möchten wir gerne vermeiden.\n\nFreundliche Grüße\n{firma}")},
    ],
}


class BankFormatError(ValueError):
    pass


@dataclass
class BankTx:
    booking_date: str
    amount: float
    currency: str = "EUR"
    partner: str = ""
    iban: str = ""
    text: str = ""
    reference: str = ""


# ----------------------------------------------------------------------------- Parser
def parse_amount(value: str) -> float:
    v = str(value).strip().replace("EUR", "").replace("€", "").replace("\u00a0", "").replace(" ", "").replace("'", "")
    neg = v.startswith(("-", "−")) or v.endswith("-")
    v = v.strip("+-−")
    if not v:
        raise ValueError("leer")
    if "," in v and "." in v:
        v = v.replace(".", "").replace(",", ".") if v.rfind(",") > v.rfind(".") else v.replace(",", "")
    elif "," in v:
        v = v.replace(".", "").replace(",", ".")
    elif v.count(".") > 1 or (v.count(".") == 1 and len(v.split(".")[1]) == 3):
        v = v.replace(".", "")
    if not re.fullmatch(r"\d+(\.\d+)?", v):
        raise ValueError(f"Kein Betrag: {value!r}")
    amount = float(v)
    return -amount if neg else amount


def parse_date(value: str) -> str | None:
    value = str(value).strip()[:19]
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d.%m.%y", "%d/%m/%Y", "%Y%m%d", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y %H:%M:%S"):
        try:
            return datetime.strptime(value if "%H" in fmt else value[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


HEADER_KEYS = {
    "date": ("buchungsdatum", "buchungstag", "booking date", "datum", "valutadatum", "valuta", "wertstellung"),
    "amount": ("betrag", "amount", "umsatz"),
    "partner": ("partnername", "auftraggeber/empfänger", "auftraggeber", "empfänger", "zahlungspflichtiger",
                "beguenstigter", "begünstigter", "partner name", "name"),
    "iban": ("partner iban", "partner-iban", "iban auftraggeber", "gegenkonto", "iban"),
    "text": ("verwendungszweck", "zahlungsreferenz", "buchungstext", "buchungs-info", "buchungsinfo", "beschreibung",
             "text", "details", "purpose", "reference"),
    "currency": ("währung", "waehrung", "currency"),
}


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _header_map(row: list[str]) -> dict[str, list[int]]:
    found: dict[str, list[int]] = {}
    cells = [c.strip().lower().strip('"') for c in row]
    for key, words in HEADER_KEYS.items():
        for word in words:  # Reihenfolge = Priorität (z. B. Buchungsdatum vor Valuta)
            idx = [i for i, c in enumerate(cells) if c == word or (len(word) > 4 and word in c)]
            idx = [i for i in idx if not any(i in v for k, v in found.items() if k != key)]
            if idx:
                if key == "text":
                    found.setdefault(key, [])
                    found[key] += [i for i in idx if i not in found[key]]
                    continue
                found[key] = [idx[0]]
                break
    return found


def parse_csv(data: bytes) -> list[BankTx]:
    text = _decode(data)
    lines = [line for line in text.splitlines()[:30] if line.strip()]
    delim = next((d for d in (";", "\t", "|") if lines and sum(d in line for line in lines) >= 0.6 * len(lines)), None)
    if delim is None:
        try:
            delim = csv.Sniffer().sniff(text[:5000], delimiters=";,\t|").delimiter
        except csv.Error:
            delim = ","
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]
    if not rows:
        raise BankFormatError("Datei ist leer.")
    header_idx, cols = None, {}
    for i, row in enumerate(rows[:15]):
        m = _header_map(row)
        if "date" in m and "amount" in m:
            header_idx, cols = i, m
            break
    if header_idx is None:  # z. B. ELBA-Export ohne Kopfzeile: Spalten am Inhalt erkennen
        cols = _guess_columns(rows)
        body = rows
    else:
        body = rows[header_idx + 1:]
    out = []
    for row in body:
        try:
            day = parse_date(row[cols["date"][0]])
            amount = parse_amount(row[cols["amount"][0]])
        except (IndexError, ValueError):
            continue
        if not day:
            continue
        get = lambda k: (row[cols[k][0]].strip() if k in cols and cols[k][0] < len(row) else "")  # noqa: E731
        texts = [row[i].strip() for i in cols.get("text", []) if i < len(row) and row[i].strip()]
        out.append(BankTx(day, round(amount, 2), (get("currency") or "EUR").upper()[:3], get("partner")[:200],
                          re.sub(r"\s+", "", get("iban")).upper()[:34], " | ".join(dict.fromkeys(texts))[:1000]))
    if not out:
        raise BankFormatError("Keine Buchungen erkannt – bitte CSV mit Datum und Betrag (oder CAMT.053/MT940) verwenden.")
    return out


def _guess_columns(rows: list[list[str]]) -> dict[str, list[int]]:
    width = max(len(r) for r in rows)
    sample = rows[:30]

    def ratio(i: int, fn: Callable[[str], Any]) -> float:
        ok = 0
        for r in sample:
            try:
                ok += bool(i < len(r) and fn(r[i]))
            except ValueError:
                pass
        return ok / len(sample)

    date_cols = [i for i in range(width) if ratio(i, parse_date) > 0.8]
    amount_cols = [i for i in range(width) if i not in date_cols
                   and ratio(i, lambda v: re.search(r"\d,\d{2}\s*-?$|^[+-]", v.strip()) and parse_amount(v) is not None) > 0.8]
    if not date_cols or not amount_cols:
        raise BankFormatError("Spalten für Datum und Betrag nicht gefunden.")
    rest = [i for i in range(width) if i not in date_cols and i not in amount_cols]
    text_col = max(rest, key=lambda i: sum(len(r[i]) for r in sample if i < len(r)), default=None)
    cols = {"date": [date_cols[0]], "amount": [amount_cols[0]]}
    if text_col is not None:
        cols["text"] = [text_col]
    cur = [i for i in rest if ratio(i, lambda v: re.fullmatch(r"[A-Z]{3}", v.strip())) > 0.8]
    if cur:
        cols["currency"] = [cur[0]]
    return cols


def parse_camt(data: bytes) -> list[BankTx]:
    head = data[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in data.upper():
        raise BankFormatError("XML mit DOCTYPE/ENTITY wird aus Sicherheitsgründen nicht verarbeitet.")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise BankFormatError(f"Ungültiges XML: {exc}") from exc
    out = []
    for ntry in (e for e in root.iter() if isinstance(e.tag, str) and e.tag.rsplit("}", 1)[-1] == "Ntry"):
        amt = ntry.find("{*}Amt")
        if amt is None or not (amt.text or "").strip():
            continue
        sign = -1 if (ntry.findtext("{*}CdtDbtInd") or "").strip() == "DBIT" else 1
        if (ntry.findtext("{*}RvslInd") or "").strip().lower() == "true":
            sign = -sign
        day = (ntry.findtext("{*}BookgDt/{*}Dt") or (ntry.findtext("{*}BookgDt/{*}DtTm") or "")[:10]
               or ntry.findtext("{*}ValDt/{*}Dt") or "")
        entry_info = (ntry.findtext("{*}AddtlNtryInf") or "").strip()
        details = ntry.findall("{*}NtryDtls/{*}TxDtls")
        split = len(details) > 1 and all(_tx_amount(d) is not None for d in details)
        for d in (details if split else details[:1] or [None]):
            amount = _tx_amount(d) if split else float(amt.text)
            role = "Dbtr" if sign > 0 else "Cdtr"
            partner = iban = ""
            texts, ref = [], ""
            if d is not None:
                partner = (d.findtext(f"{{*}}RltdPties/{{*}}{role}/{{*}}Nm")
                           or d.findtext(f"{{*}}RltdPties/{{*}}{role}/{{*}}Pty/{{*}}Nm") or "")
                iban = d.findtext(f"{{*}}RltdPties/{{*}}{role}Acct/{{*}}Id/{{*}}IBAN") or ""
                texts = [t.text.strip() for t in d.iterfind("{*}RmtInf/{*}Ustrd") if t.text and t.text.strip()]
                ref = (d.findtext("{*}RmtInf/{*}Strd/{*}CdtrRefInf/{*}Ref") or "").strip()
                extra = (d.findtext("{*}AddtlTxInf") or "").strip()
                if extra:
                    texts.append(extra)
            if entry_info:
                texts.append(entry_info)
            if ref:
                texts.append(ref)
            if not parse_date(day or ""):
                continue
            out.append(BankTx(parse_date(day), round(sign * float(amount), 2), amt.get("Ccy", "EUR"), partner.strip()[:200],
                              iban.replace(" ", "").upper()[:34], " | ".join(dict.fromkeys(texts))[:1000], ref[:35]))
    if not out:
        raise BankFormatError("Keine Buchungen im CAMT-Auszug gefunden.")
    return out


def _tx_amount(d: ET.Element) -> float | None:
    for path in ("{*}Amt", "{*}AmtDtls/{*}TxAmt/{*}Amt", "{*}AmtDtls/{*}InstdAmt/{*}Amt"):
        v = d.findtext(path)
        if v and v.strip():
            return float(v)
    return None


def parse_mt940(data: bytes) -> list[BankTx]:
    text = _decode(data).replace("\r\n", "\n")
    out: list[BankTx] = []
    blocks = re.split(r"\n(?=:61:)", text)
    for block in blocks:
        m = re.search(r":61:(\d{6})(\d{4})?(R?[CD])[A-Z]?(\d+,\d{0,2})", block)
        if not m:
            continue
        yy, mm, dd = m.group(1)[:2], m.group(1)[2:4], m.group(1)[4:6]
        amount = parse_amount(m.group(4))
        if m.group(3) in ("D", "RC"):
            amount = -amount
        info = ""
        m86 = re.search(r":86:(.*?)(?=\n:\d{2}[A-Z]?:|\n-}|\Z)", block, re.S)
        partner = ""
        if m86:
            raw = m86.group(1).replace("\n", "")
            fields = dict(re.findall(r"\?(\d{2})([^?]*)", raw))
            if fields:
                info = " ".join(fields.get(f"{i}", "") for i in range(20, 30)).strip() + " " + \
                       " ".join(fields.get(f"{i}", "") for i in range(60, 64)).strip()
                partner = (fields.get("32", "") + fields.get("33", "")).strip()
                info = (info.strip() or fields.get("00", "")).strip()
            else:
                info = raw.strip()
        out.append(BankTx(f"20{yy}-{mm}-{dd}", round(amount, 2), "EUR", partner[:200], "", info[:1000]))
    if not out:
        raise BankFormatError("Keine Umsätze (:61:) im MT940 gefunden.")
    return out


def parse_statement(data: bytes, filename: str = "") -> list[BankTx]:
    head = data.lstrip()[:200]
    name = filename.lower()
    if head.startswith(b"<") or name.endswith(".xml"):
        return parse_camt(data)
    if b":20:" in data[:500] or b":61:" in data or name.endswith((".sta", ".mt940", ".940")):
        return parse_mt940(data)
    return parse_csv(data)


# ----------------------------------------------------------------------------- Abgleich
def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _contains_number(normalized_text: str, number: str) -> bool:
    for variant in {norm(number), norm(re.sub(r"^[A-Za-z]+[-_ ]*", "", number))}:
        if len(variant) < 5:
            continue
        for m in re.finditer(re.escape(variant), normalized_text):
            before = normalized_text[m.start() - 1] if m.start() else ""
            after = normalized_text[m.end()] if m.end() < len(normalized_text) else ""
            if not before.isdigit() and not after.isdigit():
                return True
    return False


def _tokens(name: str) -> set[str]:
    name = name.lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return {t for t in re.findall(r"[a-z0-9]+", name) if len(t) >= 4 and t not in LEGAL_WORDS}


class Ledger:
    """Zahlungsabgleich und Mahnwesen auf Basis der Datenbank."""

    def __init__(self, db: Database, company: str = "ME-IT"):
        self.db, self.company = db, company

    # -- Hilfsfunktionen
    def open_amount(self, inv: dict[str, Any]) -> float:
        if inv["status"] != "gestellt":
            return 0.0
        return round(float(inv["gross"]) - float(inv.get("paid_amount") or 0), 2)

    def open_invoices(self) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM invoices WHERE status = 'gestellt' ORDER BY date, id")
        return [r for r in rows if self.open_amount(r) > 0.004]

    def iban_map(self) -> dict[str, int]:
        return self.db.get_setting("bank_iban_customers", {}) or {}

    def learn_iban(self, iban: str, customer_id: int | None) -> None:
        if iban and customer_id:
            m = self.iban_map()
            if m.get(iban) != customer_id:
                m[iban] = customer_id
                self.db.set_setting("bank_iban_customers", m)

    def customer_for(self, tx: dict[str, Any]) -> tuple[int | None, str]:
        if tx.get("iban") and tx["iban"] in self.iban_map():
            return self.iban_map()[tx["iban"]], "iban"
        hay = _tokens(f"{tx.get('partner', '')} {tx.get('text', '')}")
        if not hay:
            return None, ""
        scores = []
        for c in self.db.query("SELECT id, name FROM customers"):
            hit = len(_tokens(c["name"]) & hay)
            if hit:
                scores.append((hit, c["id"]))
        scores.sort(reverse=True)
        if scores and (len(scores) == 1 or scores[0][0] > scores[1][0]):
            return scores[0][1], "name"
        return None, ""

    # -- Import
    def import_statement(self, data: bytes, filename: str = "") -> dict[str, Any]:
        txs = parse_statement(data, filename)
        seen: dict[str, int] = {}
        new_ids, dupes = [], 0
        for tx in txs:
            base = f"{tx.booking_date}|{tx.amount:.2f}|{norm(tx.text)[:200]}|{norm(tx.partner)}|{tx.reference}"
            seen[base] = seen.get(base, 0) + 1
            key = hashlib.sha256(f"{base}#{seen[base]}".encode()).hexdigest()
            if self.db.scalar("SELECT COUNT(*) FROM bank_transactions WHERE dedupe_key = ?", (key,)):
                dupes += 1
                continue
            new_ids.append(self.db.insert("bank_transactions", {
                "booking_date": tx.booking_date, "amount": tx.amount, "currency": tx.currency, "partner": tx.partner,
                "iban": tx.iban, "text": tx.text, "reference": tx.reference, "dedupe_key": key,
                "status": "offen" if tx.amount > 0 else "beleg_fehlt", "import_file": filename[:120]}))
        self.db.set_setting("bank_last_import", now_iso())
        stats = self.rematch()
        return {"imported": len(new_ids), "duplicates": dupes, "total_in_file": len(txs), **stats}

    def rematch(self) -> dict[str, int]:
        """Offene Eingänge und Abbuchungen ohne Beleg (erneut) abgleichen."""
        stats = {"matched": 0, "suggested": 0, "receipts_linked": 0}
        for tx in self.db.query("SELECT * FROM bank_transactions WHERE status IN ('offen', 'vorschlag') "
                                "AND amount > 0 ORDER BY booking_date, id"):
            result = self.match_credit(tx)
            if result == "zugeordnet":
                stats["matched"] += 1
            elif result == "vorschlag":
                stats["suggested"] += 1
            elif tx["status"] == "vorschlag":  # Vorschlag passt nicht mehr (z. B. Rechnung inzwischen bezahlt)
                self.db.update("bank_transactions", tx["id"], {"status": "offen", "suggestion": ""})
        for tx in self.db.query("SELECT * FROM bank_transactions WHERE status = 'beleg_fehlt' ORDER BY booking_date"):
            stats["receipts_linked"] += self.match_debit(tx)
        stats["open"] = self.db.scalar("SELECT COUNT(*) FROM bank_transactions WHERE status IN ('offen', 'vorschlag')") or 0
        stats["missing_receipts"] = self.db.scalar(
            "SELECT COUNT(*) FROM bank_transactions WHERE status = 'beleg_fehlt'") or 0
        return stats

    def match_credit(self, tx: dict[str, Any]) -> str:
        open_inv = self.open_invoices()
        text = norm(f"{tx['text']} {tx['reference']} {tx['partner']}")
        by_number = [i for i in open_inv if i["number"] and _contains_number(text, i["number"])]
        amount = round(float(tx["amount"]), 2)
        if len(by_number) == 1:
            self.assign(tx["id"], [by_number[0]["id"]], note="Rechnungsnummer im Verwendungszweck", auto=True)
            return "zugeordnet"
        if len(by_number) > 1:
            if abs(sum(self.open_amount(i) for i in by_number) - amount) <= 0.01:
                self.assign(tx["id"], [i["id"] for i in by_number], note="Sammelzahlung (mehrere Rechnungsnummern)",
                            auto=True)
                return "zugeordnet"
            return self._suggest(tx, by_number, "mehrere Rechnungsnummern, Betrag weicht ab")
        paid = [i for i in self.db.query("SELECT id, number FROM invoices WHERE status = 'bezahlt' AND number != ''")
                if _contains_number(text, i["number"])]
        if paid:
            self.db.update("bank_transactions", tx["id"], {
                "match_note": f"Rechnung {paid[0]['number']} ist bereits bezahlt – Doppelzahlung?"})
            return "offen"
        customer_id, how = self.customer_for(tx)
        same = [i for i in open_inv if abs(self.open_amount(i) - amount) <= 0.01]
        if customer_id:
            mine = [i for i in same if i["customer_id"] == customer_id]
            self.db.update("bank_transactions", tx["id"], {"customer_id": customer_id})
            if len(mine) == 1 and how == "iban":
                self.assign(tx["id"], [mine[0]["id"]], note="bekannte IBAN + exakter Betrag", auto=True)
                return "zugeordnet"
            if len(mine) >= 1:
                return self._suggest(tx, mine[:1], "Kunde erkannt + exakter Betrag")
            return "offen"
        if len(same) == 1:
            return self._suggest(tx, same, "exakter Betrag (Kunde nicht eindeutig)")
        return "offen"

    def _suggest(self, tx: dict[str, Any], invoices: list[dict[str, Any]], why: str) -> str:
        self.db.update("bank_transactions", tx["id"], {
            "status": "vorschlag", "suggestion": json.dumps([i["id"] for i in invoices]),
            "match_note": f"Vorschlag: {', '.join(i['number'] for i in invoices)} ({why})"})
        return "vorschlag"

    def match_debit(self, tx: dict[str, Any]) -> int:
        hay = f"{tx['partner']} {tx['text']}".lower()
        if any(k in f" {hay} " for k in NO_RECEIPT_KEYWORDS):
            self.db.update("bank_transactions", tx["id"], {"status": "ignoriert",
                                                           "match_note": "kein Beleg nötig (Abgaben/Gehalt/Bankspesen)"})
            return 0
        amount = abs(float(tx["amount"]))
        day = date.fromisoformat(tx["booking_date"])
        used = {r["receipt_id"] for r in self.db.query(
            "SELECT receipt_id FROM bank_transactions WHERE receipt_id IS NOT NULL")}
        cands = []
        for r in self.db.query("SELECT * FROM receipts WHERE ABS(amount - ?) <= 0.01", (amount,)):
            if r["id"] in used:
                continue
            try:
                dist = abs((date.fromisoformat(r["invoice_date"]) - day).days) if r["invoice_date"] else 30
            except ValueError:
                dist = 30
            if dist <= 75:
                vendor_hit = bool(_tokens(r["vendor"] or "") & _tokens(hay))
                cands.append((not vendor_hit, dist, r["id"]))
        if not cands:
            return 0
        cands.sort()
        self.db.update("bank_transactions", tx["id"], {"status": "zugeordnet", "receipt_id": cands[0][2],
                                                       "match_note": "Beleg gefunden (Betrag/Datum)"})
        return 1

    # -- Zuordnen / Lösen
    def assign(self, tx_id: int, invoice_ids: list[int], note: str = "manuell", auto: bool = False) -> dict[str, Any]:
        tx = self.db.get("bank_transactions", tx_id)
        if not tx:
            raise ValueError("Buchung nicht gefunden")
        if tx["amount"] <= 0:
            raise ValueError("Nur Zahlungseingänge können Rechnungen zugeordnet werden")
        if self.db.scalar("SELECT COUNT(*) FROM payments WHERE transaction_id = ?", (tx_id,)):
            raise ValueError("Buchung ist bereits zugeordnet – zuerst lösen")
        remaining = round(float(tx["amount"]), 2)
        notes, customer_id = [], None
        for iid in invoice_ids:
            inv = self.db.get("invoices", iid)
            if not inv or inv["status"] != "gestellt":
                raise ValueError(f"Rechnung {iid} ist nicht offen")
            part = min(remaining, self.open_amount(inv))
            if part <= 0:
                continue
            self._book(inv, part, tx_id, tx["booking_date"], note)
            remaining = round(remaining - part, 2)
            customer_id = inv["customer_id"]
            if self.open_amount(self.db.get("invoices", iid)) > 0.004:
                notes.append(f"Teilzahlung auf {inv['number']}, offen {_eur(self.open_amount(self.db.get('invoices', iid)))}")
        if remaining > 0.004:
            notes.append(f"Überzahlung {_eur(remaining)} – bitte prüfen")
        self.db.update("bank_transactions", tx_id, {
            "status": "zugeordnet", "customer_id": customer_id, "suggestion": "",
            "match_note": ("automatisch: " if auto else "") + "; ".join([note, *notes])})
        self.learn_iban(tx["iban"], customer_id)
        return self.db.get("bank_transactions", tx_id)

    def _book(self, inv: dict[str, Any], amount: float, tx_id: int | None, day: str, note: str) -> None:
        self.db.insert("payments", {"invoice_id": inv["id"], "transaction_id": tx_id, "amount": round(amount, 2),
                                    "date": day, "note": note[:200]})
        paid = round(float(inv.get("paid_amount") or 0) + amount, 2)
        update: dict[str, Any] = {"paid_amount": paid}
        if paid >= float(inv["gross"]) - 0.004:
            update.update({"status": "bezahlt", "paid_at": f"{day} 00:00:00" if len(day) == 10 else day})
        self.db.update("invoices", inv["id"], update)

    def unassign(self, tx_id: int) -> dict[str, Any]:
        tx = self.db.get("bank_transactions", tx_id)
        if not tx:
            raise ValueError("Buchung nicht gefunden")
        for p in self.db.query("SELECT * FROM payments WHERE transaction_id = ?", (tx_id,)):
            inv = self.db.get("invoices", p["invoice_id"])
            if inv:
                paid = max(0.0, round(float(inv["paid_amount"] or 0) - p["amount"], 2))
                update: dict[str, Any] = {"paid_amount": paid}
                if inv["status"] == "bezahlt" and paid < float(inv["gross"]) - 0.004:
                    update.update({"status": "gestellt", "paid_at": ""})
                self.db.update("invoices", inv["id"], update)
            self.db.delete("payments", p["id"])
        self.db.update("bank_transactions", tx_id, {
            "status": "offen" if tx["amount"] > 0 else "beleg_fehlt", "receipt_id": None, "suggestion": "",
            "match_note": "Zuordnung gelöst"})
        return self.db.get("bank_transactions", tx_id)

    def link_receipt(self, tx_id: int, receipt_id: int) -> dict[str, Any]:
        tx = self.db.get("bank_transactions", tx_id)
        if not tx or tx["amount"] >= 0:
            raise ValueError("Nur Abbuchungen können Belegen zugeordnet werden")
        if not self.db.get("receipts", receipt_id):
            raise ValueError("Beleg nicht gefunden")
        self.db.update("bank_transactions", tx_id, {"status": "zugeordnet", "receipt_id": receipt_id,
                                                    "match_note": "manuell zugeordnet"})
        return self.db.get("bank_transactions", tx_id)

    # -- Kennzahlen
    def summary(self) -> dict[str, Any]:
        today = date.today()
        buckets = {"nicht_faellig": 0.0, "1_30": 0.0, "31_60": 0.0, "ueber_60": 0.0}
        for inv in self.open_invoices():
            open_ = self.open_amount(inv)
            days = (today - date.fromisoformat(inv["due_date"])).days if inv["due_date"] else 0
            key = "nicht_faellig" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60 else "ueber_60"
            buckets[key] = round(buckets[key] + open_, 2)
        since = (today - timedelta(days=180)).isoformat()
        paid = self.db.query("SELECT date, paid_at FROM invoices WHERE status = 'bezahlt' AND paid_at >= ? "
                             "AND date != ''", (since,))
        days = [(date.fromisoformat(p["paid_at"][:10]) - date.fromisoformat(p["date"])).days for p in paid]
        return {
            "open_total": round(sum(buckets.values()), 2), "overdue_total": round(sum(buckets.values()) - buckets["nicht_faellig"], 2),
            "aging": buckets, "dso": round(sum(days) / len(days), 1) if days else None, "paid_count_180": len(days),
            "last_import": self.db.get_setting("bank_last_import", ""),
            "unassigned": self.db.scalar("SELECT COUNT(*) FROM bank_transactions WHERE status IN ('offen', 'vorschlag')") or 0,
            "missing_receipts": self.db.scalar("SELECT COUNT(*) FROM bank_transactions WHERE status = 'beleg_fehlt'") or 0,
            "missing_receipts_sum": round(abs(self.db.scalar(
                "SELECT COALESCE(SUM(amount), 0) FROM bank_transactions WHERE status = 'beleg_fehlt'") or 0), 2),
        }

    # -- Mahnwesen
    def dunning_conf(self) -> dict[str, Any]:
        stored = self.db.get_setting("dunning", {}) or {}
        conf = {**DEFAULT_DUNNING, **{k: v for k, v in stored.items() if k in DEFAULT_DUNNING}}
        if not isinstance(conf.get("levels"), list) or not conf["levels"]:
            conf["levels"] = DEFAULT_DUNNING["levels"]
        return conf

    def save_dunning_conf(self, data: dict[str, Any]) -> dict[str, Any]:
        conf = self.dunning_conf()
        for key in ("auto_send",):
            if key in data:
                conf[key] = bool(data[key])
        for key, lo, hi in (("min_days_between", 1, 90), ("max_import_age_days", 1, 60)):
            if key in data:
                conf[key] = max(lo, min(int(data[key]), hi))
        if "interest_rate" in data:
            conf["interest_rate"] = max(0.0, min(float(data["interest_rate"]), 20.0))
        if "levels" in data:
            levels = []
            for lv in data["levels"][:4]:
                levels.append({"name": str(lv.get("name") or "Mahnung")[:60], "days": max(1, min(int(lv.get("days") or 7), 365)),
                               "fee": max(0.0, min(float(lv.get("fee") or 0), 500.0)),
                               "payment_days": max(1, min(int(lv.get("payment_days") or 7), 60)),
                               "subject": str(lv.get("subject") or "")[:200], "text": str(lv.get("text") or "")[:4000]})
            if not levels:
                raise ValueError("Mindestens eine Mahnstufe nötig")
            if [lv["days"] for lv in levels] != sorted(lv["days"] for lv in levels):
                raise ValueError("Mahnstufen müssen nach Tagen aufsteigend sortiert sein")
            conf["levels"] = levels
        self.db.set_setting("dunning", conf)
        return conf

    def dunning_case(self, inv: dict[str, Any], level_index: int | None = None, today: date | None = None) -> dict[str, Any]:
        conf = self.dunning_conf()
        today = today or date.today()
        levels = conf["levels"]
        current = int(inv.get("dunning_level") or 0)
        idx = min(current, len(levels) - 1) if level_index is None else max(0, min(level_index, len(levels) - 1))
        lv = levels[idx]
        due = date.fromisoformat(inv["due_date"]) if inv["due_date"] else today
        days = max(0, (today - due).days)
        open_ = self.open_amount(inv)
        fees = round(sum(float(x.get("fee") or 0) for x in levels[:idx + 1]), 2)
        interest = round(open_ * float(conf["interest_rate"]) / 100 * days / 365, 2) if conf["interest_rate"] else 0.0
        return {"invoice_id": inv["id"], "number": inv["number"], "customer_id": inv["customer_id"],
                "customer_name": inv["customer_name"], "date": inv["date"], "due_date": inv["due_date"],
                "days_overdue": days, "gross": inv["gross"], "paid": round(float(inv.get("paid_amount") or 0), 2),
                "open": open_, "fees": fees, "interest": interest, "total": round(open_ + fees + interest, 2),
                "level_index": idx, "level": lv["name"], "current_level": current, "dunned_at": inv.get("dunned_at") or "",
                "deadline": (today + timedelta(days=int(lv.get("payment_days") or 7))).isoformat()}

    def proposals(self, today: date | None = None) -> list[dict[str, Any]]:
        conf = self.dunning_conf()
        today = today or date.today()
        out = []
        for inv in self.open_invoices():
            if not inv["due_date"]:
                continue
            level = int(inv.get("dunning_level") or 0)
            if level >= len(conf["levels"]):
                continue  # letzte Stufe erreicht → Inkasso/Anruf
            days = (today - date.fromisoformat(inv["due_date"])).days
            if days < int(conf["levels"][level]["days"]):
                continue
            if inv.get("dunned_at"):
                last = date.fromisoformat(inv["dunned_at"][:10])
                if (today - last).days < int(conf["min_days_between"]):
                    continue
            out.append(self.dunning_case(inv, level, today))
        return out

    def escalations(self) -> list[dict[str, Any]]:
        """Rechnungen, bei denen alle Mahnstufen ausgeschöpft sind (persönlich anrufen / Inkasso)."""
        n = len(self.dunning_conf()["levels"])
        return [self.dunning_case(i, n - 1) for i in self.open_invoices() if int(i.get("dunning_level") or 0) >= n]


# ----------------------------------------------------------------------------- Versand der Mahnungen
def _split_closing(text: str) -> tuple[str, str]:
    parts = text.strip().split("\n\n")
    if len(parts) > 1 and re.match(r"^(freundliche|mit freundlichen|beste|liebe|herzliche) grü", parts[-1].strip(), re.I):
        return "\n\n".join(parts[:-1]), parts[-1]
    return text.strip(), ""


class Dunning:
    def __init__(self, ctx: Any, ledger: Ledger):
        self.ctx, self.ledger, self.db = ctx, ledger, ctx.db

    def _values(self, case: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, str]:
        profile = company_profile(self.db, self.ctx.company)
        contact = (customer or {}).get("contact_name") or ""
        return {"anrede": f"Guten Tag {contact}," if contact else "Guten Tag,", "nummer": case["number"],
                "datum": _d(case["date"]), "betrag": _eur(case["gross"]), "offen": _eur(case["open"]),
                "gesamt": _eur(case["total"]), "faellig": _d(case["due_date"]), "frist": _d(case["deadline"]),
                "tage": str(case["days_overdue"]), "firma": profile.get("name") or self.ctx.company,
                "kunde": (customer or {}).get("name", ""), "stufe": case["level"]}

    def mail(self, invoice_id: int, level_index: int | None = None) -> dict[str, Any]:
        inv = self._invoice(invoice_id)
        case = self.ledger.dunning_case(inv, level_index)
        lv = self.ledger.dunning_conf()["levels"][case["level_index"]]
        customer = self.db.get("customers", inv["customer_id"]) if inv["customer_id"] else None
        values = self._values(case, customer)
        return {**case, "to": (customer or {}).get("email", ""), "cc": self.ctx.docs.conf().get("cc", ""),
                "subject": fill_text(lv["subject"], values), "text": fill_text(lv["text"], values)}

    def _invoice(self, invoice_id: int) -> dict[str, Any]:
        inv = self.db.get("invoices", invoice_id)
        if not inv:
            raise DocumentError("Rechnung nicht gefunden")
        if self.ledger.open_amount(inv) <= 0:
            raise DocumentError("Rechnung ist nicht (mehr) offen.")
        return inv

    def pdf(self, invoice_id: int, level_index: int | None = None, text: str | None = None) -> tuple[bytes, dict[str, Any]]:
        inv = self._invoice(invoice_id)
        m = self.mail(invoice_id, level_index)
        profile = company_profile(self.db, self.ctx.company)
        customer = self.db.get("customers", inv["customer_id"]) if inv["customer_id"] else {}
        body, closing = _split_closing(text if text is not None else m["text"])
        rows = [(f"Rechnung {inv['number']} vom {_d(inv['date'])}, fällig seit {_d(inv['due_date'])} "
                 f"({m['days_overdue']} Tage)", float(inv["gross"]))]
        if m["paid"]:
            rows.append(("abzüglich bereits bezahlt", -m["paid"]))
        if m["fees"]:
            rows.append(("Mahnspesen", m["fees"]))
        if m["interest"]:
            rate = str(self.ledger.dunning_conf()["interest_rate"]).replace(".", ",")
            rows.append((f"Verzugszinsen {rate} % p. a. für {m['days_overdue']} Tage", m["interest"]))
        data = dunning_pdf(title=m["level"], inv=inv, customer=customer or {"name": inv["customer_name"]}, profile=profile,
                           branding=get_branding(self.db, profile.get("name") or self.ctx.company),
                           logo=logo_path(self.ctx.docs.data_dir), text=body, rows=rows, total=m["total"],
                           due_text=f"bis {_d(m['deadline'])}", closing=closing)
        return data, m

    def send(self, invoice_id: int, *, to: str | None = None, cc: str | None = None, subject: str | None = None,
             text: str | None = None, level_index: int | None = None, actor: int | None = None) -> dict[str, Any]:
        inv = self._invoice(invoice_id)
        preset = self.mail(invoice_id, level_index)
        to = (to if to is not None else preset["to"]).strip()
        text = text if text is not None else preset["text"]
        subject = subject if subject is not None else preset["subject"]
        letter, case = self.pdf(invoice_id, level_index, text)
        docs = self.ctx.docs
        fname = f"{case['level'].replace('.', '')}_{inv['number']}.pdf".replace(" ", "_")
        attachments = [Attachment(fname, letter, "application/pdf"),
                       Attachment(docs.invoice_filename(inv), docs.invoice_pdf(inv), "application/pdf")]
        external_id = docs.send_branded(self.ctx.mailer, to, cc if cc is not None else preset["cc"], subject, text,
                                        attachments)
        ts = now_iso()
        self.db.update("invoices", invoice_id, {"dunning_level": case["level_index"] + 1, "dunned_at": ts})
        docs.log_out(to, subject, text, inv["customer_id"], "invoice", invoice_id, external_id, len(attachments))
        doc = docs.store("mahnung", fname, letter, title=f"{case['level']} {inv['number']}",
                         customer_id=inv["customer_id"], ref_type="invoice", ref_id=invoice_id, folder_keys=("mahnung",))
        from .team import log_activity

        log_activity(self.db, actor, "mahnung", "invoice", invoice_id, f"{case['level']} an {to} ({_eur(case['total'])})")
        return {"sent": True, "to": to, "level": case["level"], "total": case["total"], "document": doc}

    def run(self, actor: int | None = None) -> dict[str, Any]:
        sent, errors = [], []
        for case in self.ledger.proposals():
            try:
                sent.append(self.send(case["invoice_id"], actor=actor))
            except (DocumentError, MailError, ValueError) as exc:
                errors.append({"invoice": case["number"], "error": str(exc)})
        return {"sent": len(sent), "errors": errors, "details": sent}

    def autopilot_ready(self) -> tuple[bool, str]:
        conf = self.ledger.dunning_conf()
        if not conf["auto_send"]:
            return False, "Autopilot aus"
        last = self.db.get_setting("bank_last_import", "")
        if not last:
            return False, "noch kein Kontoauszug importiert"
        age = (datetime.now() - datetime.fromisoformat(last)).days
        if age > int(conf["max_import_age_days"]):
            return False, f"letzter Kontoauszug ist {age} Tage alt – erst aktuelle Zahlungen importieren"
        if self.db.scalar("SELECT COUNT(*) FROM bank_transactions WHERE status IN ('offen', 'vorschlag') AND amount > 0"):
            return False, "nicht zugeordnete Zahlungseingänge – bitte zuerst prüfen"
        return True, ""


def start_dunning_scheduler(dunning: Dunning) -> threading.Thread:
    def loop() -> None:
        time.sleep(120)
        while True:
            try:
                today = date.today().isoformat()
                if dunning.db.get_setting("dunning_last_run", "") != today and datetime.now().hour >= 8:
                    ok, reason = dunning.autopilot_ready()
                    if ok:
                        result = dunning.run()
                        dunning.db.set_setting("dunning_last_result", {"date": today, "sent": result["sent"],
                                                                       "errors": result["errors"]})
                        dunning.db.set_setting("dunning_last_run", today)
                    elif reason != "Autopilot aus":
                        dunning.db.set_setting("dunning_last_result", {"date": today, "skipped": reason})
            except Exception as exc:  # noqa: BLE001 - Fehler sichtbar machen, Schleife läuft weiter
                dunning.db.set_setting("dunning_last_result", {"error": str(exc)})
            time.sleep(3600)

    thread = threading.Thread(target=loop, name="meit-dunning", daemon=True)
    thread.start()
    return thread


# ----------------------------------------------------------------------------- API
class AssignIn(BaseModel):
    invoice_ids: list[int] = Field(default_factory=list, max_length=20)
    receipt_id: Optional[int] = None


class IgnoreIn(BaseModel):
    note: str = Field("", max_length=200)


class DunningSendIn(BaseModel):
    to: Optional[str] = Field(None, max_length=200)
    cc: Optional[str] = Field(None, max_length=300)
    subject: Optional[str] = Field(None, max_length=200)
    text: Optional[str] = Field(None, max_length=8000)
    level_index: Optional[int] = None


def register(app: FastAPI, ctx: Any, admin_only, start_scheduler: bool = True) -> Ledger:
    db: Database = ctx.db
    ledger = Ledger(db, ctx.company)
    dunning = Dunning(ctx, ledger)

    def guard(fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except (DocumentError, MailError, ValueError) as exc:
            raise HTTPException(422, str(exc))

    def actor(request: Request) -> int | None:
        user = getattr(request.state, "user", None)
        return user["id"] if user else None

    @app.post("/api/bank/import", dependencies=[Depends(admin_only)])
    async def bank_import(request: Request) -> dict:
        from urllib.parse import unquote

        data = await request.body()
        if not data:
            raise HTTPException(422, "Leere Datei")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "Datei zu groß (max. 10 MB)")
        name = unquote(request.headers.get("x-filename", "kontoauszug"))[:120]
        try:
            return ledger.import_statement(data, name)
        except BankFormatError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/bank", dependencies=[Depends(admin_only)])
    def bank_list(status: Optional[str] = None, direction: Optional[str] = None, limit: int = 300) -> list[dict]:
        sql = ("SELECT t.*, c.name AS customer_name, r.vendor AS receipt_vendor, r.invoice_no AS receipt_no, "
               "(SELECT GROUP_CONCAT(i.number, ', ') FROM payments p JOIN invoices i ON i.id = p.invoice_id "
               "WHERE p.transaction_id = t.id) AS invoice_numbers FROM bank_transactions t "
               "LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN receipts r ON r.id = t.receipt_id WHERE 1=1")
        params: list[Any] = []
        if status:
            sql += " AND t.status IN (" + ",".join("?" * len(status.split(","))) + ")"
            params += status.split(",")
        if direction == "in":
            sql += " AND t.amount > 0"
        elif direction == "out":
            sql += " AND t.amount < 0"
        rows = db.query(sql + " ORDER BY t.booking_date DESC, t.id DESC LIMIT ?", [*params, min(limit, 2000)])
        for r in rows:
            r["suggestion"] = json.loads(r["suggestion"]) if r["suggestion"] else []
        return rows

    @app.post("/api/bank/{tid}/assign", dependencies=[Depends(admin_only)])
    def bank_assign(tid: int, data: AssignIn) -> dict:
        if data.receipt_id:
            return guard(lambda: ledger.link_receipt(tid, data.receipt_id))
        if not data.invoice_ids:
            raise HTTPException(422, "Rechnung oder Beleg angeben")
        return guard(lambda: ledger.assign(tid, data.invoice_ids))

    @app.post("/api/bank/{tid}/accept", dependencies=[Depends(admin_only)])
    def bank_accept(tid: int) -> dict:
        tx = db.get("bank_transactions", tid)
        if not tx or tx["status"] != "vorschlag":
            raise HTTPException(409, "Kein Vorschlag vorhanden")
        return guard(lambda: ledger.assign(tid, json.loads(tx["suggestion"] or "[]"), note="Vorschlag bestätigt"))

    @app.post("/api/bank/{tid}/ignore", dependencies=[Depends(admin_only)])
    def bank_ignore(tid: int, data: IgnoreIn) -> dict:
        tx = db.get("bank_transactions", tid)
        if not tx:
            raise HTTPException(404, "Buchung nicht gefunden")
        if db.scalar("SELECT COUNT(*) FROM payments WHERE transaction_id = ?", (tid,)):
            raise HTTPException(409, "Buchung ist zugeordnet – zuerst lösen")
        db.update("bank_transactions", tid, {"status": "ignoriert", "suggestion": "",
                                             "match_note": data.note or ("kein Beleg nötig" if tx["amount"] < 0 else "ignoriert")})
        return db.get("bank_transactions", tid)

    @app.post("/api/bank/{tid}/unassign", dependencies=[Depends(admin_only)])
    def bank_unassign(tid: int) -> dict:
        return guard(lambda: ledger.unassign(tid))

    @app.post("/api/bank/rematch", dependencies=[Depends(admin_only)])
    def bank_rematch() -> dict:
        return ledger.rematch()

    @app.get("/api/payments/summary")
    def payments_summary() -> dict:
        return {**ledger.summary(), "dunning_due": len(ledger.proposals()),
                "dunning_last": db.get_setting("dunning_last_result", {}),
                "iban_ok": valid_iban(company_profile(db, ctx.company).get("iban", ""))}

    @app.get("/api/invoices/{iid}/payments")
    def invoice_payments(iid: int) -> list[dict]:
        return db.query("SELECT p.*, t.partner, t.text FROM payments p LEFT JOIN bank_transactions t "
                        "ON t.id = p.transaction_id WHERE p.invoice_id = ? ORDER BY p.date", (iid,))

    # Mahnwesen
    @app.get("/api/dunning/settings")
    def dunning_settings() -> dict:
        return ledger.dunning_conf()

    @app.put("/api/dunning/settings", dependencies=[Depends(admin_only)])
    def save_dunning_settings(data: dict[str, Any]) -> dict:
        return guard(lambda: ledger.save_dunning_conf(data))

    @app.get("/api/dunning")
    def dunning_list() -> dict:
        ok, reason = dunning.autopilot_ready()
        return {"proposals": ledger.proposals(), "escalations": ledger.escalations(),
                "autopilot": {"ready": ok, "reason": reason, "last": db.get_setting("dunning_last_result", {})}}

    @app.get("/api/dunning/{iid}/mail")
    def dunning_mail(iid: int, level_index: Optional[int] = None) -> dict:
        return guard(lambda: dunning.mail(iid, level_index))

    @app.get("/api/dunning/{iid}/pdf")
    def dunning_pdf_view(iid: int, level_index: Optional[int] = None):
        data, case = guard(lambda: dunning.pdf(iid, level_index))
        return pdf_response(data, f"{case['level']}_{case['number']}.pdf".replace(" ", "_"))

    @app.post("/api/dunning/{iid}/send", dependencies=[Depends(admin_only)])
    def dunning_send(iid: int, data: DunningSendIn, request: Request) -> dict:
        return guard(lambda: dunning.send(iid, to=data.to, cc=data.cc, subject=data.subject, text=data.text,
                                          level_index=data.level_index, actor=actor(request)))

    @app.post("/api/dunning/run", dependencies=[Depends(admin_only)])
    def dunning_run(request: Request) -> dict:
        return dunning.run(actor=actor(request))

    if start_scheduler:
        start_dunning_scheduler(dunning)
    return ledger
