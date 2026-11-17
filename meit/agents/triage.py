"""Ticket-Triage-Agent: Kategorie, Priorität, Lösungsschritte und Antwortentwurf.

Nutzt Kontext aus Wissensdatenbank (RAG), ähnlichen gelösten Tickets und den
Geräten des Kunden. Ohne KI greift eine Regel-Triage – das Ticket wird trotzdem
sinnvoll eingeordnet.
"""

from __future__ import annotations

import json
import time
from typing import Any

from ..db import loads
from ..knowledge import normalize
from ..llm import LLMError
from .base import AgentContext

CATEGORIES = ["Netzwerk", "E-Mail/M365", "Hardware", "Software", "Sicherheit", "Server/Backup",
              "Benutzer/Zugang", "Beratung/Anfrage"]
PRIORITIES = ["niedrig", "normal", "hoch", "kritisch"]

CATEGORY_KEYWORDS = {
    "Sicherheit": ["virus", "phishing", "ransomware", "verschluesselt", "hack", "trojaner", "verdaechtig",
                   "spam", "angriff", "malware", "link geklickt", "erpress"],
    "Netzwerk": ["wlan", "wifi", "netzwerk", "internet", "vpn", "router", "switch", "dns", "lan",
                 "verbindung", "access point"],
    "E-Mail/M365": ["outlook", "mail", "exchange", "teams", "onedrive", "sharepoint", "m365", "office 365",
                    "postfach", "kalender"],
    "Server/Backup": ["server", "backup", "nas", "sicherung", "restore", "speicher", "festplatte voll",
                      "laufwerk", "datenbank"],
    "Benutzer/Zugang": ["passwort", "konto", "gesperrt", "zugriff", "berechtigung", "neuer mitarbeiter",
                        "onboarding", "anmeldung", "login", "neue kollegin", "neuer kollege"],
    "Hardware": ["drucker", "monitor", "bildschirm", "laptop", "notebook", "tastatur", "maus", "akku",
                 "scanner", "langsam", "hochfahren", "pc "],
    "Software": ["installation", "update", "programm", "software", "lizenz", "fehlermeldung", "app"],
    "Beratung/Anfrage": ["frage", "angebot", "beratung", "moeglichkeit", "ki ", "kuenstliche intelligenz",
                         "wie kann", "gibt es"],
}
CRITICAL_WORDS = ["ransomware", "verschluesselt", "produktion steht", "niemand", "alle ", "server down",
                  "ausfall", "geht gar nichts", "erpress", "praxis steht"]
HIGH_WORDS = ["dringend", "sofort", "geht nicht", "chef", "geschaeftsfuehr", "kunde wartet", "heute noch",
              "link geklickt", "daten eingegeben"]
LOW_WORDS = ["wenn zeit", "irgendwann", "frage", "info", "nicht eilig", "bei gelegenheit"]

SECURITY_FIRST_STEPS = [
    "Betroffene Geräte sofort vom Netzwerk trennen (LAN/WLAN), NICHT ausschalten (Spuren sichern).",
    "Betroffene Konten sperren bzw. Passwörter zurücksetzen, alle Sitzungen abmelden, MFA prüfen.",
    "Backups vom Netz isolieren und auf Unversehrtheit prüfen – nicht überschreiben lassen.",
    "Vorfall mit Zeitstempeln dokumentieren; Geschäftsführung und ggf. Cyber-Versicherung informieren.",
    "Bei NIS2-pflichtigen Kunden: Frühwarnung an die Behörde binnen 24 h prüfen; bei Personendaten DSGVO-Meldung (72 h).",
]

ETA = {"kritisch": "innerhalb von 30 Minuten", "hoch": "innerhalb von 2 Stunden",
       "normal": "noch am selben Werktag", "niedrig": "innerhalb von 2 Werktagen"}


def rule_triage(title: str, description: str) -> dict[str, Any]:
    text = " " + normalize(f"{title} {description}") + " "
    scores = {cat: sum(1 for kw in kws if kw in text) for cat, kws in CATEGORY_KEYWORDS.items()}
    category = max(scores, key=lambda c: scores[c]) if any(scores.values()) else "Software"
    if any(w in text for w in CRITICAL_WORDS):
        priority = "kritisch"
    elif any(w in text for w in HIGH_WORDS):
        priority = "hoch"
    elif any(w in text for w in LOW_WORDS) or category == "Beratung/Anfrage":
        priority = "niedrig"
    else:
        priority = "normal"
    if category == "Sicherheit" and priority in ("niedrig", "normal"):
        priority = "hoch"
    return {"category": category, "priority": priority}


def _normalize_choice(value: Any, options: list[str], default: str) -> str:
    text = normalize(str(value or ""))
    for opt in options:
        if normalize(opt) == text:
            return opt
    for opt in options:
        if normalize(opt).split("/")[0] in text:
            return opt
    return default


def triage_ticket(ctx: AgentContext, ticket_id: int, apply: bool = True) -> dict[str, Any]:
    started = time.time()
    ticket = ctx.db.get("tickets", ticket_id)
    if not ticket:
        raise ValueError("Ticket nicht gefunden")
    customer = ctx.db.get("customers", ticket["customer_id"]) if ticket.get("customer_id") else None
    assets = ctx.db.query("SELECT name, type, os, purchase_date FROM assets WHERE customer_id = ?",
                          (ticket.get("customer_id"),)) if customer else []
    query = f"{ticket['title']} {ticket['description']}"
    kb_hits = ctx.kb.search(query, limit=3)
    similar = ctx.kb.similar_tickets(query, exclude_id=ticket_id, limit=3)
    rules = rule_triage(ticket["title"], ticket["description"])

    result: dict[str, Any] = {
        **rules,
        "summary": ticket["title"],
        "steps": [],
        "reply": "",
        "minutes": {"kritisch": 60, "hoch": 45, "normal": 30, "niedrig": 20}[rules["priority"]],
        "hint": "",
        "sources": {"kb": [{"id": h["id"], "title": h["title"]} for h in kb_hits],
                    "tickets": [{"id": s["id"], "title": s["title"]} for s in similar]},
        "provider": "regeln",
    }

    llm = ctx.llm()
    if llm.available():
        context = {
            "ticket": {"titel": ticket["title"], "beschreibung": ticket["description"]},
            "kunde": {"name": customer["name"], "branche": customer["industry"], "mitarbeiter": customer["employees"],
                      "paket": customer["package"], "notizen": customer["notes"]} if customer else None,
            "geraete_des_kunden": assets[:20],
            "wissensdatenbank": [{"titel": h["title"], "inhalt": h["content"][:1200]} for h in kb_hits],
            "aehnliche_geloeste_tickets": [{"titel": s["title"], "loesung": s["solution"]} for s in similar],
        }
        system = (
            f"Du bist der erfahrene Service-Desk-Disponent von {ctx.company}, einem IT-Dienstleister in Österreich. "
            "Analysiere das Ticket und antworte nur mit JSON."
        )
        prompt = (
            "Kontext:\n" + json.dumps(context, ensure_ascii=False, default=str) + "\n\n"
            "Gib exakt dieses JSON zurück:\n"
            '{"kategorie": "' + "|".join(CATEGORIES) + '", '
            '"prioritaet": "niedrig|normal|hoch|kritisch", '
            '"zusammenfassung": "1 Satz", '
            '"loesungsschritte": ["konkreter Schritt 1", "..."], '
            '"antwort_an_kunden": "kurze, freundliche Antwort (Sie-Form), ohne Versprechen, die wir nicht halten können", '
            '"geschaetzte_minuten": 30, '
            '"verkaufschance": "optional: passende Leistung, falls das Problem auf einen tieferen Bedarf hinweist, sonst leer"}\n'
            "Priorität kritisch nur bei Betriebsstillstand oder Sicherheitsvorfall mit Schaden."
        )
        try:
            data = llm.chat_json([{"role": "user", "content": prompt}], system=system)
            steps = data.get("loesungsschritte") or []
            result.update({
                "category": _normalize_choice(data.get("kategorie"), CATEGORIES, rules["category"]),
                "priority": _normalize_choice(data.get("prioritaet"), PRIORITIES, rules["priority"]),
                "summary": str(data.get("zusammenfassung") or ticket["title"]),
                "steps": [str(s) for s in steps][:10] if isinstance(steps, list) else [str(steps)],
                "reply": str(data.get("antwort_an_kunden") or ""),
                "minutes": int(data.get("geschaetzte_minuten") or result["minutes"]),
                "hint": str(data.get("verkaufschance") or ""),
                "provider": f"{llm.provider}:{llm.model}",
            })
        except (LLMError, ValueError, TypeError) as exc:
            result["error"] = f"KI-Triage fehlgeschlagen, Regeln verwendet: {exc}"

    if not result["steps"]:
        if result["category"] == "Sicherheit" and result["priority"] in ("hoch", "kritisch"):
            result["steps"] = list(SECURITY_FIRST_STEPS)
        elif similar:
            result["steps"] = [f"Ähnliches Ticket #{similar[0]['id']}: {similar[0]['solution']}"]
        elif kb_hits:
            result["steps"] = [f"Siehe Wissensartikel „{kb_hits[0]['title']}“"]
        else:
            result["steps"] = ["Rückfrage beim Benutzer, Fernwartung starten, Fehlerbild dokumentieren."]
    if not result["reply"]:
        name = customer["contact_name"] if customer and customer.get("contact_name") else ""
        result["reply"] = (
            f"Guten Tag{(' ' + name) if name else ''},\n\nvielen Dank für Ihre Meldung „{ticket['title']}“. "
            f"Wir haben das Ticket mit Priorität „{result['priority']}“ aufgenommen und melden uns {ETA[result['priority']]}.\n\n"
            f"Freundliche Grüße\nIhr {ctx.company}-Team"
        )

    if apply and ticket["status"] != "geloest":
        ctx.db.update("tickets", ticket_id, {
            "category": result["category"], "priority": result["priority"],
            "ai_suggestion": json.dumps(result, ensure_ascii=False),
        })
        from ..team import auto_assign

        assigned = auto_assign(ctx.db, ticket_id)
        if assigned:
            result["assigned_to"] = assigned
    ctx.log("triage", result["provider"], query, result, "error" not in result, started)
    return result


def suggestion_of(ticket: dict[str, Any]) -> dict[str, Any] | None:
    return loads(ticket.get("ai_suggestion"), None)
