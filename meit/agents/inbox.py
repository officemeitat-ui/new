"""KI-Mitarbeiter: Posteingangs-Agent („KI-Sachbearbeiter“).

Jede eingehende Nachricht (E-Mail, Webformular, manuell erfasst) wird
  1. eingeordnet:  support · anfrage · termin · beleg · info
  2. ausgelesen:   Kontakt, Bedarf, Qualifizierung, Belegdaten
  3. weitergeleitet: Support → Ticket (inkl. Triage), Anfrage/Termin → Lead im CRM,
                     Beleg → Belegliste für den Steuerberater, Info → Ablage
  4. beantwortet:  Antwortentwurf. Modus je Kategorie:
                     „entwurf“   – ein Mensch gibt mit einem Klick frei (Standard, AI-Act-freundlich)
                     „autopilot“ – wird automatisch versendet bzw. abgelegt

Ohne KI greifen Regeln und Vorlagen. Zahlen (Beträge, Scores) rechnet immer der Code.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta
from typing import Any

from ..db import loads, now_iso
from ..knowledge import normalize
from ..llm import LLMError
from ..mail import MailError
from .base import AgentContext
from .triage import CATEGORY_KEYWORDS, triage_ticket

CATEGORIES = {
    "support": "Support: Bestandskunde meldet ein Problem oder braucht Hilfe",
    "anfrage": "Neue Anfrage: Interessent fragt nach Leistung, Angebot, Preis oder Beratung",
    "termin": "Terminwunsch oder Rückrufbitte",
    "beleg": "Rechnung, Beleg, Gutschrift oder Zahlungserinnerung (Eingangsrechnung)",
    "info": "Newsletter, Werbung, automatische Benachrichtigung, Spam – keine Aktion nötig",
}
# Geschätzte eingesparte Minuten je erledigter Nachricht (Annahme, für die Übersicht).
MINUTES_SAVED = {"support": 6, "anfrage": 10, "termin": 5, "beleg": 4, "info": 1, "nachfassen": 8}
DEFAULT_MODES = {"support": "entwurf", "anfrage": "entwurf", "termin": "entwurf", "beleg": "entwurf",
                 "info": "autopilot"}
REPLY_CATEGORIES = {"support", "anfrage", "termin"}

FREEMAIL = {
    "gmail.com", "googlemail.com", "gmx.at", "gmx.net", "gmx.de", "hotmail.com", "outlook.com", "outlook.at",
    "live.com", "live.at", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "aon.at", "a1.net", "chello.at",
    "web.de", "t-online.de", "kabelplus.at", "liwest.at", "drei.at", "proton.me", "protonmail.com",
}

INFO_WORDS = ["newsletter", "abmelden", "unsubscribe", "webinar", "gewinnspiel", "rabatt", "angebot der woche",
              "ihre bestellung wurde versandt", "automatisch generiert", "do not reply"]
RECEIPT_WORDS = ["rechnung", "invoice", "beleg", "gutschrift", "zahlungserinnerung", "mahnung", "rechnungsnummer",
                 "re-nr", "faktura", "quittung"]
APPOINTMENT_WORDS = ["termin", "rueckruf", "zurueckrufen", "rufen sie mich", "telefonat", "meeting", "besprechung",
                     "vorbeikommen", "wann haetten sie zeit", "wann haben sie zeit"]
INQUIRY_WORDS = ["angebot", "preis", "kosten", "interesse", "anfrage", "beratung", "brauchen", "suchen",
                 "betreuung", "wechseln", "neuer it", "it-partner", "kostenvoranschlag", "nis2", "ki "]
PROBLEM_WORDS = ["geht nicht", "funktioniert nicht", "fehler", "stoerung", "kaputt", "hilfe", "ausfall", "problem",
                 "langsam", "abgestuerzt", "kein zugriff", "gesperrt", "virus"]

PHONE_RE = re.compile(r"(?:\+|00)\d[\d\s/-]{7,}\d|\b0\d{2,4}[\s/-]?\d{3,}[\d\s-]{2,}\d")
AMOUNT_KEY_RE = re.compile(
    r"(?:gesamtbetrag|rechnungsbetrag|endbetrag|bruttobetrag|summe|gesamt|betrag|total|zu zahlen|zahlbetrag)"
    r"[^\d\n]{0,30}?(?:€|eur)?\s*(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+[.,]\d{2})",
    re.IGNORECASE,
)
AMOUNT_ANY_RE = re.compile(r"(?:€|eur)\s*(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+[.,]\d{2})|"
                           r"(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+[.,]\d{2})\s*(?:€|eur)", re.IGNORECASE)
INVOICE_RE = re.compile(r"(?:rechnungs?\s*-?\s*(?:nr\.?|nummer)|re\.?\s*-?\s*nr\.?|invoice\s*(?:no\.?|number|#))"
                        r"\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b")
RECEIPT_CATEGORIES = {
    "Software/Lizenzen": ["lizenz", "software", "abo", "subscription", "microsoft", "adobe", "cloud", "saas"],
    "Hardware": ["notebook", "laptop", "monitor", "hardware", "server", "festplatte", "switch", "drucker"],
    "Telefon/Internet": ["internet", "mobilfunk", "telefon", "a1 ", "magenta", "drei ", "glasfaser"],
    "Büro": ["buero", "papier", "toner", "porto", "post"],
    "Fahrzeug/Reise": ["tanken", "treibstoff", "hotel", "bahn", "oebb", "parken", "vignette"],
}


# ----------------------------------------------------------------------- Helfer
def get_modes(db) -> dict[str, str]:
    stored = db.get_setting("inbox_modes", {}) or {}
    return {k: stored.get(k, v) if stored.get(k) in ("entwurf", "autopilot") else v for k, v in DEFAULT_MODES.items()}


def match_customer(db, email_addr: str) -> dict[str, Any] | None:
    email_addr = (email_addr or "").strip().lower()
    if "@" not in email_addr:
        return None
    rows = db.query("SELECT id, name, email, contact_name FROM customers WHERE email != ''")
    for r in rows:
        if r["email"].strip().lower() == email_addr:
            return r
    domain = email_addr.split("@")[-1]
    if domain in FREEMAIL:
        return None
    for r in rows:
        if r["email"].strip().lower().split("@")[-1] == domain:
            return r
    return None


def parse_amount(text: str) -> float:
    text = text.replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return round(float(text), 2)
    except ValueError:
        return 0.0


def parse_receipt(text: str, sender: str = "") -> dict[str, Any]:
    amount = 0.0
    m = AMOUNT_KEY_RE.search(text)
    if m:
        amount = parse_amount(m.group(1))
    else:
        values = [parse_amount(a or b) for a, b in AMOUNT_ANY_RE.findall(text)]
        amount = max(values) if values else 0.0
    inv = INVOICE_RE.search(text)
    date_match = DATE_RE.search(text)
    invoice_date = ""
    if date_match:
        d, mth, y = (int(x) for x in date_match.groups())
        if 1 <= d <= 31 and 1 <= mth <= 12:
            invoice_date = f"{y:04d}-{mth:02d}-{d:02d}"
    norm = " " + normalize(text) + " "
    category = next((cat for cat, words in RECEIPT_CATEGORIES.items() if any(w in norm for w in words)), "Sonstiges")
    return {"vendor": sender, "invoice_no": inv.group(1) if inv else "", "invoice_date": invoice_date,
            "amount": amount, "currency": "EUR", "category": category}


def rule_classify(subject: str, body: str, attachments: list[str], from_email: str, known_customer: bool) -> str:
    text = " " + normalize(f"{subject} {body}") + " "
    sender = (from_email or "").lower()
    if any(x in sender for x in ("noreply", "no-reply", "donotreply", "newsletter", "mailer-daemon")) and \
            not any(w in text for w in RECEIPT_WORDS):
        return "info"
    if any(w in text for w in INFO_WORDS):
        return "info"
    has_pdf = any(a.lower().endswith(".pdf") for a in attachments)
    if any(w in text for w in RECEIPT_WORDS) and (has_pdf or AMOUNT_ANY_RE.search(text) or "rechnung" in text):
        if not any(w in text for w in ("angebot", "kostenvoranschlag")) or has_pdf:
            return "beleg"
    problem = any(w in text for w in PROBLEM_WORDS) or sum(
        1 for kws in CATEGORY_KEYWORDS.values() for kw in kws if kw in text) >= 2
    if known_customer and problem:
        return "support"
    if any(w in text for w in APPOINTMENT_WORDS):
        return "termin"
    if any(w in text for w in INQUIRY_WORDS):
        return "anfrage"
    return "support" if known_customer else "anfrage"


def lead_score(qualification: dict[str, Any], need: str, phone: str, company: str) -> int:
    """Nachvollziehbarer Lead-Score 0–100 (im Code, nicht von der KI)."""
    score = 10
    try:
        employees = int(qualification.get("mitarbeiter") or 0)
    except (TypeError, ValueError):
        employees = 0
    score += 35 if employees >= 50 else 25 if employees >= 10 else 10 if employees >= 3 else 0
    text = normalize(f"{need} {qualification.get('zeitrahmen', '')} {qualification.get('budget', '')}")
    valuable = ["managed", "betreuung", "security", "sicherheit", "nis2", "backup", "server", "migration",
                "ki", "m365", "netzwerk", "wartungsvertrag", "mitarbeiter"]
    score += min(30, 10 * sum(1 for w in valuable if w in text))
    if any(w in text for w in ("sofort", "dringend", "asap", "diese woche", "diesen monat", "bald")):
        score += 15
    if qualification.get("budget"):
        score += 5
    if phone:
        score += 5
    if company:
        score += 5
    return max(0, min(100, score))


EMPLOYEES_RE = re.compile(r"(\d{1,4})\s*(?:mitarbeiter|mitarbeitende|leute|personen|beschäftigte|ma\b|arbeitspl|user|benutzer)",
                          re.IGNORECASE)
TIMING_WORDS = {"sofort": "sofort", "dringend": "dringend", "diesen monat": "diesen Monat", "diese woche": "diese Woche",
                "naechsten monat": "nächsten Monat", "bis ende": "bis Jahresende", "anfang naechsten jahres": "Anfang nächsten Jahres"}


def rule_qualification(text: str) -> dict[str, Any]:
    qual: dict[str, Any] = {}
    m = EMPLOYEES_RE.search(text)
    if m:
        qual["mitarbeiter"] = int(m.group(1))
    norm = normalize(text)
    timing = next((label for word, label in TIMING_WORDS.items() if word in norm), "")
    if timing:
        qual["zeitrahmen"] = timing
    return qual


def clean_subject(subject: str) -> str:
    return re.sub(r"^\s*((re|aw|wg|fw|fwd|webanfrage)\s*:\s*)+", "", subject or "", flags=re.IGNORECASE).strip()


def _first_line(text: str) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:140]
    return ""


def _greeting(name: str) -> str:
    return f"Guten Tag {name}," if name else "Guten Tag,"


def template_reply(ctx: AgentContext, category: str, name: str, subject: str, ref: str = "",
                   qualification: dict[str, Any] | None = None) -> str:
    booking = getattr(ctx.settings, "booking_url", "") if ctx.settings else ""
    sign = f"Freundliche Grüße\nIhr {ctx.company}-Team"
    subject = clean_subject(subject)
    if category == "anfrage":
        qual = qualification or {}
        questions = [q for q, known in (
            ("Wie viele Arbeitsplätze/Mitarbeiter betrifft es?", qual.get("mitarbeiter")),
            ("Bis wann soll die Lösung umgesetzt sein?", qual.get("zeitrahmen")),
            ("Was ist Ihnen dabei am wichtigsten – und was passiert, wenn alles bleibt, wie es ist?", False),
            ("Wann sind Sie am besten telefonisch erreichbar?", False),
        ) if not known][:3]
        return (f"{_greeting(name)}\n\nvielen Dank für Ihre Anfrage{f' „{subject}“' if subject else ''} und Ihr Interesse "
                f"an {ctx.company}. Damit wir uns gut auf ein erstes Gespräch vorbereiten können, beantworten Sie uns "
                "bitte kurz:\n" + "\n".join(f"{i}. {q}" for i, q in enumerate(questions, 1)) + "\n\n"
                + (f"Gerne auch direkt einen Termin buchen: {booking}\n\n" if booking else "")
                + "Wir melden uns innerhalb eines Werktags bei Ihnen.\n\n" + sign)
    if category == "termin":
        return (f"{_greeting(name)}\n\nvielen Dank für Ihre Nachricht. Gerne vereinbaren wir einen Termin. "
                + (f"Sie können sich hier direkt einen passenden Zeitpunkt aussuchen: {booking}\n\n" if booking else
                   "Wir rufen Sie innerhalb eines Werktags zurück, um einen Termin abzustimmen.\n\n")
                + sign)
    return (f"{_greeting(name)}\n\nvielen Dank für Ihre Nachricht. Wir haben Ihr Anliegen{f' ({ref})' if ref else ''} "
            f"aufgenommen und melden uns schnellstmöglich.\n\n{sign}")


# ------------------------------------------------------------------ Verarbeitung
def _llm_analyse(ctx: AgentContext, m: dict, customer: dict | None, attachments: list[str]) -> dict[str, Any]:
    kb_hits = ctx.kb.search(f"{m['subject']} {m['body'][:500]}", limit=2)
    cats = "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    prompt = (
        f"Kategorien:\n{cats}\n\n"
        f"Absender: {m['from_name']} <{m['from_email']}> – "
        + (f"bekannter Kunde: {customer['name']}" if customer else "unbekannt (kein Bestandskunde)") + "\n"
        f"Kanal: {m['channel']}\nBetreff: {m['subject']}\nNachricht:\n{m['body'][:4000]}\n"
        + (f"Anhänge: {attachments}\n" if attachments else "")
        + (f"Text aus Anhang:\n{m.get('attachment_text', '')[:2000]}\n" if m.get("attachment_text") else "")
        + (f"Passendes aus unserer Wissensdatenbank: {[h['title'] for h in kb_hits]}\n" if kb_hits else "")
        + "\nGib exakt dieses JSON zurück:\n"
        '{"kategorie": "support|anfrage|termin|beleg|info", "zusammenfassung": "1 Satz", '
        '"dringlichkeit": "niedrig|normal|hoch", "kontakt": {"name": "", "firma": "", "telefon": ""}, '
        '"bedarf": "was die Person konkret möchte", '
        '"qualifizierung": {"mitarbeiter": 0, "zeitrahmen": "", "budget": "", "offene_fragen": ["..."]}, '
        '"beleg": {"lieferant": "", "rechnungsnummer": "", "datum": "JJJJ-MM-TT", "betrag": 0, "waehrung": "EUR", "kategorie": ""}, '
        '"antwort": "Nur bei anfrage/termin: Antwortentwurf in Sie-Form – Dank, kurze Bestätigung, höchstens 3 '
        'Rückfragen zur Qualifizierung. Keine Preise oder Zusagen erfinden. Sonst leer."}'
    )
    return ctx.llm().chat_json(
        [{"role": "user", "content": prompt}],
        system=(f"Du bist der KI-Sachbearbeiter von {ctx.company}, einem IT-Dienstleister in Österreich. "
                "Du sortierst eingehende Nachrichten, liest Daten aus und schreibst Antwortentwürfe. Nur JSON."),
    )


def process_message(ctx: AgentContext, message_id: int) -> dict[str, Any]:
    started = time.time()
    db = ctx.db
    m = db.get("messages", message_id)
    if not m or m["direction"] != "in":
        raise ValueError("Eingehende Nachricht nicht gefunden")
    attachments = loads(m["attachments"], [])
    ai_prev = loads(m["ai_result"], {}) or {}
    m["attachment_text"] = ai_prev.get("attachment_text", "")
    customer = db.get("customers", m["customer_id"]) if m.get("customer_id") else match_customer(db, m["from_email"])
    full_text = f"{m['subject']}\n{m['body']}\n{m['attachment_text']}"

    category = rule_classify(m["subject"], m["body"], attachments, m["from_email"], bool(customer))
    phone = m["phone"] or (PHONE_RE.search(m["body"]).group(0).strip() if PHONE_RE.search(m["body"]) else "")
    result: dict[str, Any] = {
        "category": category, "summary": m["subject"] or _first_line(m["body"]), "urgency": "normal",
        "contact": {"name": m["from_name"], "company": m["company"] or (customer["name"] if customer else ""),
                    "phone": phone},
        "need": "", "qualification": {}, "receipt": {}, "reply": "", "provider": "regeln",
        "customer": customer["name"] if customer else "", "attachment_text": m["attachment_text"],
        "mail_handle": ai_prev.get("mail_handle", ""),
    }
    llm = ctx.llm()
    if llm.available():
        try:
            data = _llm_analyse(ctx, m, customer, attachments)
            cat = str(data.get("kategorie") or "").strip().lower()
            if cat in CATEGORIES:
                result["category"] = cat
            contact = data.get("kontakt") if isinstance(data.get("kontakt"), dict) else {}
            result.update({
                "summary": str(data.get("zusammenfassung") or result["summary"])[:300],
                "urgency": str(data.get("dringlichkeit") or "normal"),
                "need": str(data.get("bedarf") or "")[:1000],
                "qualification": data.get("qualifizierung") if isinstance(data.get("qualifizierung"), dict) else {},
                "reply": str(data.get("antwort") or "").strip(),
                "provider": f"{llm.provider}:{llm.model}",
            })
            for key, src in (("name", "name"), ("company", "firma"), ("phone", "telefon")):
                if not result["contact"].get(key) and contact.get(src):
                    result["contact"][key] = str(contact[src])[:120]
            if isinstance(data.get("beleg"), dict):
                result["receipt_ai"] = data["beleg"]
        except (LLMError, AttributeError, TypeError, ValueError) as exc:
            result["error"] = f"KI-Auswertung fehlgeschlagen, Regeln verwendet: {exc}"

    category = result["category"]
    contact = result["contact"]
    update: dict[str, Any] = {"category": category, "customer_id": customer["id"] if customer else None,
                              "phone": contact.get("phone", ""), "company": contact.get("company", ""),
                              "from_name": m["from_name"] or contact.get("name", "")}
    reply = ""
    linked_type, linked_id = m["linked_type"], m["linked_id"]

    if category == "support":
        if linked_type != "ticket" or not linked_id or not db.get("tickets", linked_id):
            linked_id = db.insert("tickets", {
                "customer_id": customer["id"] if customer else None,
                "title": (m["subject"] or result["summary"])[:200],
                "description": f"{m['body'][:5000]}\n\n— eingegangen per {m['channel']} von {m['from_name']} <{m['from_email']}>",
                "status": "neu",
            })
            linked_type = "ticket"
        try:
            triage = triage_ticket(ctx, linked_id)
            reply = triage.get("reply", "")
            result["ticket_priority"] = triage.get("priority")
        except Exception:  # noqa: BLE001 - Ticket bleibt bestehen, Antwort per Vorlage
            reply = ""
        reply = (reply or template_reply(ctx, "support", contact.get("name", ""), m["subject"]))
        reply += f"\n\n(Ihre Ticketnummer: #{linked_id})"
    elif category in ("anfrage", "termin") and not customer:
        qual = {**rule_qualification(full_text), **{k: v for k, v in result["qualification"].items() if v}}
        result["qualification"] = qual
        score = lead_score(qual, result["need"] or m["body"][:500], contact.get("phone", ""), contact.get("company", ""))
        lead_fields = {"name": contact.get("name", "") or m["from_name"], "company": contact.get("company", ""),
                       "email": m["from_email"], "phone": contact.get("phone", ""), "source": m["channel"],
                       "need": (result["need"] or m["body"][:1000]), "score": score, "qualification": qual}
        existing = db.query_one("SELECT id FROM leads WHERE email = ? AND email != '' ORDER BY id DESC LIMIT 1",
                                (m["from_email"],))
        if linked_type == "lead" and linked_id and db.get("leads", linked_id):
            db.update("leads", linked_id, lead_fields)
        elif existing:
            linked_type, linked_id = "lead", existing["id"]
            db.update("leads", linked_id, lead_fields)
        else:
            linked_type, linked_id = "lead", db.insert("leads", {**lead_fields, "stage": "neu"})
        result["lead_score"] = score
        reply = result["reply"] or template_reply(ctx, category, contact.get("name", ""), m["subject"], qualification=qual)
    elif category in ("anfrage", "termin"):
        # Bestandskunde mit Anfrage/Terminwunsch → Ticket "Beratung/Anfrage" für den Vertrieb
        if linked_type != "ticket" or not linked_id or not db.get("tickets", linked_id):
            linked_id = db.insert("tickets", {
                "customer_id": customer["id"], "title": (m["subject"] or result["summary"])[:200],
                "description": m["body"][:5000], "status": "neu", "category": "Beratung/Anfrage",
                "priority": "normal"})
            linked_type = "ticket"
        reply = result["reply"] or template_reply(ctx, category, contact.get("name", ""), m["subject"])
    elif category == "beleg":
        parsed = parse_receipt(full_text, m["from_name"] or m["from_email"].split("@")[-1])
        ai = result.get("receipt_ai") or {}
        if ai:
            try:
                ai_amount = float(str(ai.get("betrag") or 0).replace(",", "."))
            except ValueError:
                ai_amount = 0.0
            parsed.update({k: v for k, v in {
                "vendor": str(ai.get("lieferant") or ""), "invoice_no": str(ai.get("rechnungsnummer") or ""),
                "invoice_date": str(ai.get("datum") or "") if re.match(r"^\d{4}-\d{2}-\d{2}$", str(ai.get("datum") or "")) else "",
                "amount": ai_amount, "category": str(ai.get("kategorie") or ""),
            }.items() if v})
        result["receipt"] = parsed
        if linked_type == "receipt" and linked_id and db.get("receipts", linked_id):
            db.update("receipts", linked_id, parsed)
        else:
            linked_type, linked_id = "receipt", db.insert("receipts", {**parsed, "message_id": message_id})

    booking = getattr(ctx.settings, "booking_url", "") if ctx.settings else ""
    if reply and booking and category in ("anfrage", "termin") and booking not in reply:
        reply += f"\n\nTermin direkt buchen: {booking}"

    modes = get_modes(db)
    mode = modes.get(category, "entwurf")
    result["mode"] = mode
    needs_reply = category in REPLY_CATEGORIES and bool(m["from_email"])
    status = "freigabe"
    if needs_reply and mode == "autopilot" and ctx.mailer is not None and ctx.mailer.smtp_configured:
        update.update({"draft_reply": reply, "linked_type": linked_type, "linked_id": linked_id,
                       "ai_result": json.dumps(result, ensure_ascii=False, default=str)})
        db.update("messages", message_id, update)
        try:
            send_message_reply(ctx, message_id, reply, handled_by="autopilot")
            status = "beantwortet"
        except MailError as exc:
            result["error"] = f"Autopilot konnte nicht senden: {exc}"
            status = "freigabe"
    elif not needs_reply:
        status = "erledigt" if mode == "autopilot" else "freigabe"
        if status == "erledigt":
            result["handled_by"] = "autopilot"
    if status != "beantwortet":
        update.update({"status": status, "draft_reply": reply, "linked_type": linked_type, "linked_id": linked_id,
                       "ai_result": json.dumps(result, ensure_ascii=False, default=str)})
        db.update("messages", message_id, update)
    ctx.log("posteingang", result["provider"], f"{m['subject']} ({m['from_email']})",
            {"category": category, "status": status, "linked": f"{linked_type}#{linked_id}"}, "error" not in result,
            started)
    return message_out(db.get("messages", message_id))


def message_out(m: dict[str, Any]) -> dict[str, Any]:
    m = dict(m)
    m["attachments"] = loads(m.get("attachments"), [])
    m["ai_result"] = loads(m.get("ai_result"), None)
    return m


# ---------------------------------------------------------------------- Versand
def send_message_reply(ctx: AgentContext, message_id: int, text: str, handled_by: str = "freigabe",
                       manual: bool = False) -> dict[str, Any]:
    """Versendet die Antwort auf eine eingehende Nachricht bzw. einen ausgehenden Entwurf.

    manual=True: Text wurde außerhalb (z. B. per Outlook) verschickt – nur als erledigt markieren.
    """
    db = ctx.db
    m = db.get("messages", message_id)
    if not m:
        raise ValueError("Nachricht nicht gefunden")
    text = (text or "").strip()
    if not text and not manual:
        raise ValueError("Kein Antworttext")
    incoming = m["direction"] == "in"
    to = m["from_email"] if incoming else m["to_email"]
    subject = m["subject"] or "Ihre Nachricht"
    if incoming and not subject.lower().startswith(("re:", "aw:")):
        subject = f"Re: {subject}"
    sent_id = ""
    if not manual:
        if ctx.mailer is None:
            raise MailError("Kein E-Mail-Versand konfiguriert.")
        ai_meta = loads(m["ai_result"], {}) or {}
        sent_id = ctx.mailer.send(to, subject, text, in_reply_to=m["external_id"] if incoming else "",
                                  reply_handle=ai_meta.get("mail_handle", "") if incoming else "")
    ts = now_iso()
    ai = loads(m["ai_result"], {}) or {}
    ai["handled_by"] = "manuell" if manual else handled_by
    if incoming:
        if text:
            db.insert("messages", {"channel": "email", "direction": "out", "external_id": sent_id, "to_email": to,
                                   "subject": subject, "body": text, "status": "gesendet" if not manual else "manuell",
                                   "reply_to_id": message_id, "customer_id": m["customer_id"],
                                   "linked_type": m["linked_type"], "linked_id": m["linked_id"], "sent_at": ts})
        db.update("messages", message_id, {"status": "beantwortet", "draft_reply": text, "sent_at": ts,
                                           "ai_result": json.dumps(ai, ensure_ascii=False, default=str)})
    else:
        db.update("messages", message_id, {"status": "gesendet" if not manual else "manuell", "body": text or m["body"],
                                           "external_id": sent_id, "sent_at": ts,
                                           "ai_result": json.dumps(ai, ensure_ascii=False, default=str)})
    if m["linked_type"] == "lead" and m["linked_id"]:
        db.update("leads", m["linked_id"], {"last_contact_at": ts})
    return {"sent": not manual, "to": to, "subject": subject}


# -------------------------------------------------------------------- Nachfassen
def _open_draft_exists(db, linked_type: str, linked_id: int) -> bool:
    return bool(db.scalar(
        "SELECT COUNT(*) FROM messages WHERE direction = 'out' AND status = 'freigabe' AND linked_type = ? AND linked_id = ?",
        (linked_type, linked_id)))


def _followup_text(ctx: AgentContext, kind: str, name: str, topic: str, number: int) -> tuple[str, str]:
    llm = ctx.llm()
    if llm.available():
        try:
            text = llm.chat(
                [{"role": "user", "content":
                  f"Schreibe eine kurze, freundliche Nachfass-E-Mail (max. 90 Wörter, Sie-Form) an {name or 'den Kunden'}. "
                  f"Anlass: {'unser Angebot' if kind == 'quote' else 'ihre Anfrage'} „{topic}“, {number}. Nachfrage. "
                  "Nicht drängeln, Nutzen in einem Satz, konkrete Frage nach dem nächsten Schritt. "
                  f"Unterschrift: Ihr {ctx.company}-Team. Nur den E-Mail-Text, ohne Betreff."}],
                system=f"Du bist Kundenbetreuer bei {ctx.company}, einem IT-Dienstleister in Österreich.",
                temperature=0.4)
            if text.strip():
                return text.strip(), f"{llm.provider}:{llm.model}"
        except LLMError:
            pass
    what = f"unser Angebot „{topic}“" if kind == "quote" else f"Ihre Anfrage „{topic}“"
    text = (f"{_greeting(name)}\n\nich wollte kurz nachfragen, ob Sie {what} schon ansehen konnten. "
            "Gibt es noch offene Fragen, die wir klären können? Gerne besprechen wir die nächsten Schritte "
            "in einem kurzen Telefonat.\n\nFreundliche Grüße\n"
            f"Ihr {ctx.company}-Team")
    return text, "vorlage"


def create_followups(ctx: AgentContext, now: datetime | None = None) -> list[dict[str, Any]]:
    """Legt Nachfass-Entwürfe für offene Angebote und Leads an (Freigabe im Posteingang)."""
    started = time.time()
    db = ctx.db
    now = now or datetime.now()
    days = getattr(ctx.settings, "followup_days", 5) if ctx.settings else 5
    cutoff = (now - timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    created = []

    quotes = db.query(
        "SELECT q.*, c.email AS c_email, c.contact_name AS c_contact FROM quotes q JOIN customers c ON c.id = q.customer_id "
        "WHERE q.status = 'versendet' AND q.sent_at != '' AND q.sent_at <= ? AND q.followup_count < 2 "
        "AND (q.last_followup_at = '' OR q.last_followup_at <= ?)", (cutoff, cutoff))
    for q in quotes:
        if not q["c_email"] or _open_draft_exists(db, "quote", q["id"]):
            continue
        text, provider = _followup_text(ctx, "quote", q["c_contact"], q["title"], q["followup_count"] + 1)
        mid = db.insert("messages", {
            "channel": "email", "direction": "out", "to_email": q["c_email"], "subject": f"Nachfrage: {q['title']}",
            "body": text, "draft_reply": text, "status": "freigabe", "category": "nachfassen",
            "customer_id": q["customer_id"], "linked_type": "quote", "linked_id": q["id"],
            "ai_result": json.dumps({"provider": provider, "category": "nachfassen", "summary": "Angebot nachfassen"})})
        db.update("quotes", q["id"], {"followup_count": q["followup_count"] + 1, "last_followup_at": now_iso()})
        created.append({"id": mid, "type": "quote", "title": q["title"]})

    leads = db.query(
        "SELECT * FROM leads WHERE stage IN ('neu', 'erstgespraech') AND email != '' AND followups < 2 "
        "AND (CASE WHEN last_contact_at != '' THEN last_contact_at ELSE created_at END) <= ?", (cutoff,))
    for lead in leads:
        if _open_draft_exists(db, "lead", lead["id"]):
            continue
        topic = _first_line(lead["need"]) or "IT-Betreuung"
        text, provider = _followup_text(ctx, "lead", lead["name"], topic[:80], lead["followups"] + 1)
        mid = db.insert("messages", {
            "channel": "email", "direction": "out", "to_email": lead["email"], "subject": f"Ihre Anfrage: {topic[:80]}",
            "body": text, "draft_reply": text, "status": "freigabe", "category": "nachfassen",
            "linked_type": "lead", "linked_id": lead["id"],
            "ai_result": json.dumps({"provider": provider, "category": "nachfassen", "summary": "Lead nachfassen"})})
        db.update("leads", lead["id"], {"followups": lead["followups"] + 1})
        created.append({"id": mid, "type": "lead", "title": lead["name"] or lead["email"]})

    ctx.log("nachfassen", "agent", {"cutoff": cutoff}, created, True, started)
    return created


# ----------------------------------------------------------------------- Übersicht
def overview(ctx: AgentContext, days: int = 7) -> dict[str, Any]:
    db = ctx.db
    since = (datetime.now() - timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    incoming = db.query("SELECT category, status, ai_result FROM messages WHERE direction = 'in' AND created_at >= ?",
                        (since,))
    processed = [m for m in incoming if m["status"] != "neu"]
    auto = sum(1 for m in processed if (loads(m["ai_result"], {}) or {}).get("handled_by") == "autopilot")
    by_cat: dict[str, int] = {}
    for m in processed:
        by_cat[m["category"] or "?"] = by_cat.get(m["category"] or "?", 0) + 1
    followups_sent = db.scalar("SELECT COUNT(*) FROM messages WHERE category = 'nachfassen' AND status = 'gesendet' "
                               "AND sent_at >= ?", (since,)) or 0
    minutes = sum(MINUTES_SAVED.get(m["category"], 3) for m in processed) + MINUTES_SAVED["nachfassen"] * followups_sent
    stages = {r["stage"]: r["n"] for r in db.query("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage")}
    return {
        "days": days,
        "received": len(incoming),
        "processed": len(processed),
        "auto_handled": auto,
        "by_category": by_cat,
        "pending_approval": db.scalar("SELECT COUNT(*) FROM messages WHERE status = 'freigabe'") or 0,
        "unprocessed": db.scalar("SELECT COUNT(*) FROM messages WHERE direction = 'in' AND status = 'neu'") or 0,
        "minutes_saved": minutes,
        "followups_sent": followups_sent,
        "lead_stages": stages,
        "open_receipts": db.scalar("SELECT COUNT(*) FROM receipts WHERE status = 'offen'") or 0,
        "modes": get_modes(db),
        "mail": {
            "provider": getattr(ctx.mailer, "provider", "imap"),
            "imap": bool(ctx.mailer and ctx.mailer.imap_configured),
            "smtp": bool(ctx.mailer and ctx.mailer.smtp_configured),
            "last_fetch": db.get_setting("mail_last_fetch", ""),
            "last_error": db.get_setting("mail_last_error", ""),
        },
    }


# ------------------------------------------------------------------ Postfach-Abruf
def insert_incoming(ctx: AgentContext, *, channel: str, from_name: str = "", from_email: str = "", phone: str = "",
                    company: str = "", subject: str = "", body: str = "", attachments: list[str] | None = None,
                    external_id: str = "", attachment_text: str = "", mail_handle: str = "") -> int:
    meta = {k: v for k, v in {"attachment_text": attachment_text, "mail_handle": mail_handle}.items() if v}
    return ctx.db.insert("messages", {
        "channel": channel, "direction": "in", "external_id": external_id, "from_name": from_name[:200],
        "from_email": (from_email or "").strip().lower()[:200], "phone": phone[:60], "company": company[:200],
        "subject": subject[:300], "body": body[:20000], "attachments": attachments or [], "status": "neu",
        "ai_result": json.dumps(meta) if meta else "",
    })


def fetch_and_process(ctx: AgentContext, limit: int = 25) -> dict[str, Any]:
    """Ruft ungelesene E-Mails ab, legt sie im Posteingang an und lässt den Agenten arbeiten."""
    try:
        mails = ctx.mailer.fetch_unseen(limit)
    except MailError as exc:
        ctx.db.set_setting("mail_last_error", str(exc))
        raise
    own = (getattr(ctx.settings, "mail_from", "") or "").lower()
    new_ids = []
    for pm in mails:
        if pm.message_id and ctx.db.scalar("SELECT COUNT(*) FROM messages WHERE external_id = ?", (pm.message_id,)):
            continue
        if own and pm.from_email == own:
            continue
        new_ids.append(insert_incoming(ctx, channel="email", from_name=pm.from_name, from_email=pm.from_email,
                                       subject=pm.subject, body=pm.body, attachments=pm.attachments,
                                       external_id=pm.message_id, attachment_text=pm.attachment_text,
                                       mail_handle=getattr(pm, "handle", "")))
    errors = 0
    for mid in new_ids:
        try:
            process_message(ctx, mid)
        except Exception:  # noqa: BLE001 - eine kaputte Mail darf den Rest nicht blockieren
            errors += 1
    ctx.db.set_setting("mail_last_fetch", now_iso())
    ctx.db.set_setting("mail_last_error", "")
    return {"fetched": len(mails), "new": len(new_ids), "errors": errors}
