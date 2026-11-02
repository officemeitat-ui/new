"""Export von Trainingsdaten für das eigene "ME-IT-Modell" (LoRA-Feintuning).

Erzeugt JSONL im Chat-Format ({"messages": [...]}) aus gelösten Tickets und
Wissensartikeln. Personenbezogene Daten werden vorher pseudonymisiert (DSGVO).
Das eigentliche Training läuft mit ``training/finetune_lora.py`` auf der GPU.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .db import Database

SYSTEM_PROMPT = (
    "Du bist der Support-Assistent eines österreichischen IT-Dienstleisters. "
    "Du ordnest Anfragen ein und gibst konkrete, geprüfte Lösungsschritte auf Deutsch."
)

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+|00)\d[\d\s/-]{6,}\d|\b0\d{2,4}[\s/-]?\d{3,}[\d\s-]*\b")
IP_RE = re.compile(r"\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b")
IBAN_RE = re.compile(r"\bAT\d{2}(?:\s?\d{4}){4}\b")


def _is_private_ip(a: int, b: int) -> bool:
    return a == 10 or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31) or a == 127


class Pseudonymizer:
    def __init__(self, db: Database):
        self.terms: list[tuple[str, str]] = []
        for c in db.query("SELECT name, contact_name FROM customers"):
            if c["name"]:
                self.terms.append((c["name"], "[KUNDE]"))
            contact = (c["contact_name"] or "").strip()
            if contact:
                self.terms.append((contact, "[KONTAKT]"))
                last = contact.split()[-1]
                if len(last) > 3:
                    self.terms.append((last, "[KONTAKT]"))
        # Längere Begriffe zuerst ersetzen ("Steuerberatung Gruber & Partner" vor "Gruber").
        self.terms.sort(key=lambda t: len(t[0]), reverse=True)

    def __call__(self, text: str) -> str:
        text = text or ""
        for term, placeholder in self.terms:
            text = re.sub(re.escape(term), placeholder, text, flags=re.IGNORECASE)
        text = EMAIL_RE.sub("[EMAIL]", text)
        text = IBAN_RE.sub("[IBAN]", text)
        text = IP_RE.sub(lambda m: m.group(0) if _is_private_ip(int(m.group(1)), int(m.group(2))) else "[IP]", text)
        text = PHONE_RE.sub("[TELEFON]", text)
        return text


def build_dataset(db: Database, include_kb: bool = True) -> list[dict[str, Any]]:
    scrub = Pseudonymizer(db)
    examples: list[dict[str, Any]] = []
    tickets = db.query(
        "SELECT title, description, category, priority, solution FROM tickets "
        "WHERE status = 'geloest' AND length(solution) >= 20")
    for t in tickets:
        examples.append({"messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": scrub(f"Neue Anfrage: {t['title']}\n{t['description']}")},
            {"role": "assistant", "content": scrub(
                f"Kategorie: {t['category'] or 'unbekannt'} | Priorität: {t['priority']}\n\nLösung: {t['solution']}")},
        ], "source": "ticket"})
    if include_kb:
        for a in db.query("SELECT title, content FROM kb_articles WHERE length(content) >= 40"):
            examples.append({"messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": scrub(f"Wie gehe ich vor bei: {a['title']}?")},
                {"role": "assistant", "content": scrub(a["content"].strip())},
            ], "source": "wissen"})
    return examples


def to_jsonl(examples: list[dict[str, Any]]) -> str:
    return "\n".join(json.dumps({"messages": e["messages"]}, ensure_ascii=False) for e in examples) + "\n"


def stats(db: Database) -> dict[str, Any]:
    examples = build_dataset(db)
    tickets = sum(1 for e in examples if e["source"] == "ticket")
    kb = len(examples) - tickets
    if len(examples) >= 500:
        advice = "Genug Daten für ein erstes LoRA-Feintuning."
    elif len(examples) >= 100:
        advice = "Für ein Stil-/Format-Training ausreichend; für Fachwissen besser RAG (Wissensdatenbank) nutzen."
    else:
        advice = ("Noch zu wenig Daten fürs Training (Ziel: 300–1000 gute Beispiele). Bis dahin liefert die "
                  "Wissensdatenbank (RAG) bessere Ergebnisse – Lösungen in Tickets sauber dokumentieren!")
    return {"examples": len(examples), "from_tickets": tickets, "from_kb": kb, "advice": advice}
