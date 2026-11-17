"""Passwort-Wächter: Zugangsdaten gehören in Keeper – nicht in Tickets, Wissen, Notizen, Wiki oder an eine Cloud-KI.

* ``find_secrets`` erkennt typische Klartext-Zugangsdaten („Passwort: …“, WLAN-Schlüssel, API-Keys, private Schlüssel).
* ``redact`` ersetzt nur den geheimen Teil („Passwort: •••• (in Keeper)“) – der Kontext bleibt lesbar.
* Wird vor dem Export nach BookStack und vor jedem Aufruf einer Cloud-KI angewendet; ein Scan über alle Daten
  zeigt Altlasten, die per Klick geschwärzt werden können.
"""

from __future__ import annotations

import re
from typing import Any

MASK = "•••• (in Keeper)"

_LABEL = (r"(?:passwort|kennwort|passwd|password|pass|pwd|pw|pin|wlan[- ]?(?:key|schlüssel|passwort)|wpa2?[- ]?key|psk|"
          r"preshared[- ]?key|api[-_ ]?key|api[-_ ]?secret|client[-_ ]?secret|secret|token|zugangscode|"
          r"recovery[- ]?key|wiederherstellungsschlüssel|bitlocker[- ]?key)")
PATTERNS = [
    # „Passwort: geheim123“, „pw=abc“, „WLAN-Key – xyz“
    ("zugangsdaten", re.compile(rf"(?i)(\b{_LABEL}\b\s*(?:[:=]|–|-|ist|lautet)\s*)([^\s,;'\"<>]{{4,}})")),
    # private Schlüssel
    ("privater-schluessel", re.compile(r"(-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----)[\s\S]+?(-----END [A-Z ]*PRIVATE KEY-----)")),
    # BitLocker-Wiederherstellungsschlüssel (8 Blöcke à 6 Ziffern)
    ("bitlocker", re.compile(r"()(\b\d{6}(?:-\d{6}){7}\b)")),
    # typische Cloud-Schlüssel
    ("api-schluessel", re.compile(r"()(\b(?:AKIA[0-9A-Z]{16}|sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]{20,})\b)")),
]
_SKIP_VALUES = {"vergessen", "zurücksetzen", "zuruecksetzen", "abgelaufen", "falsch", "geändert", "geaendert", "ändern",
                "aendern", "reset", "keeper", "••••", "siehe", "hinterlegt", "unbekannt", "erforderlich", "manager",
                "nicht", "noch", "jetzt", "wieder", "schon", "immer", "leider", "bitte", "korrekt", "richtig",
                "gesperrt", "leer", "unsicher", "schwach", "gültig", "ungültig", "gleich", "bekannt", "vorhanden",
                "nötig", "notwendig", "change", "expired", "required", "policy", "richtlinie", "eingeben", "neues",
                "neu", "anfordern", "senden", "per", "über", "ueber", "via", "wird", "wurde", "muss", "soll"}


def _is_real(value: str) -> bool:
    v = value.strip(".:!?)(").lower()
    return len(v) >= 4 and v not in _SKIP_VALUES and not v.startswith("••")


def find_secrets(text: str) -> list[dict[str, Any]]:
    hits = []
    for kind, rx in PATTERNS:
        for m in rx.finditer(text or ""):
            value = m.group(2)
            if kind == "zugangsdaten" and not _is_real(value):
                continue
            hits.append({"kind": kind, "start": m.start(2), "end": m.end(2),
                         "preview": (m.group(1) or "")[-30:] + value[:2] + "•" * min(6, max(len(value) - 2, 1))})
    return hits


def redact(text: str) -> str:
    if not text:
        return text
    out = text
    for kind, rx in PATTERNS:
        def repl(m: re.Match) -> str:
            if kind == "zugangsdaten" and not _is_real(m.group(2)):
                return m.group(0)
            if kind == "privater-schluessel":
                return f"{m.group(1)}\n{MASK}\n{m.group(2)}"
            return f"{m.group(1)}{MASK}"
        out = rx.sub(repl, out)
    return out


def contains_secret(text: str) -> bool:
    return bool(find_secrets(text))


# Was durchsucht wird: Tabelle, Spalten, Titel-Spalte, Link in der Oberfläche
SCAN_TARGETS = [
    ("tickets", ("description", "solution"), "title", "#/tickets"),
    ("kb_articles", ("content",), "title", "#/wissen"),
    ("customers", ("notes",), "name", "#/kunde/{id}"),
    ("assets", ("notes",), "name", "#/assets"),
    ("messages", ("body", "draft_reply"), "subject", "#/posteingang"),
    ("maintenance_runs", ("note",), "title", "#/wartung"),
]


def scan(db) -> list[dict[str, Any]]:
    findings = []
    for table, columns, title_col, link in SCAN_TARGETS:
        cols = ", ".join(("id", title_col) + columns)
        for row in db.query(f"SELECT {cols} FROM {table}"):
            for col in columns:
                hits = find_secrets(row[col] or "")
                if hits:
                    findings.append({"table": table, "id": row["id"], "field": col, "title": row[title_col] or "",
                                     "count": len(hits), "kinds": sorted({h["kind"] for h in hits}),
                                     "preview": hits[0]["preview"], "link": link.replace("{id}", str(row["id"]))})
    return findings


def redact_row(db, table: str, row_id: int, field: str) -> bool:
    allowed = {t: cols for t, cols, _, _ in SCAN_TARGETS}
    if table not in allowed or field not in allowed[table]:
        raise ValueError("Feld kann nicht geschwärzt werden")
    row = db.query_one(f"SELECT {field} FROM {table} WHERE id = ?", (row_id,))
    if not row:
        raise ValueError("Eintrag nicht gefunden")
    new = redact(row[field] or "")
    if new == (row[field] or ""):
        return False
    db.query(f"UPDATE {table} SET {field} = ? WHERE id = ?", (new, row_id))
    if table == "kb_articles":
        db.query("UPDATE kb_articles SET embedding = '', embedding_model = '' WHERE id = ?", (row_id,))
    return True
