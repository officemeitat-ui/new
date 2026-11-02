"""ME-IT-Assistent: Chat-Agent mit Werkzeugen auf die eigenen Daten.

Beispiele: "Welche Kunden haben noch Windows 10?", "Leg für Huber ein Ticket an:
Drucker kaputt", "Was ist die größte Verkaufschance diese Woche?",
"Wie behebe ich einen hängenden Druckerspooler?"
"""

from __future__ import annotations

import time
from typing import Any

from ..db import loads
from ..knowledge import normalize
from ..llm import LLMError
from ..radar import eol_info
from .base import AgentContext, Tool, ToolAgent


def _tools(ctx: AgentContext) -> list[Tool]:
    db = ctx.db

    def find_customer(name: str) -> list[dict[str, Any]]:
        needle = normalize(name)
        rows = db.query("SELECT id, name, contact_name, employees, package, mrr FROM customers")
        hits = [r for r in rows if needle in normalize(r["name"]) or needle in normalize(r["contact_name"])]
        return hits or [{"hinweis": "Kein Kunde gefunden", "alle_kunden": [r["name"] for r in rows]}]

    def customer_details(customer_id: int) -> dict[str, Any]:
        c = db.get("customers", int(customer_id))
        if not c:
            return {"fehler": "Kunde nicht gefunden"}
        c["booked_services"] = loads(c["booked_services"], [])
        c["geraete"] = db.query("SELECT name, type, os, warranty_end FROM assets WHERE customer_id = ?", (c["id"],))
        c["offene_tickets"] = db.query(
            "SELECT id, title, priority, status FROM tickets WHERE customer_id = ? AND status != 'geloest'", (c["id"],))
        return c

    def open_tickets(customer_id: int | None = None) -> list[dict[str, Any]]:
        sql = ("SELECT t.id, t.title, t.priority, t.status, t.category, c.name AS kunde FROM tickets t "
               "LEFT JOIN customers c ON c.id = t.customer_id WHERE t.status != 'geloest'")
        params: tuple = ()
        if customer_id:
            sql += " AND t.customer_id = ?"
            params = (int(customer_id),)
        return db.query(sql + " ORDER BY t.id DESC LIMIT 30", params)

    def create_ticket(customer_id: int, title: str, description: str = "", priority: str = "normal") -> dict[str, Any]:
        if not db.get("customers", int(customer_id)):
            return {"fehler": "Kunde nicht gefunden – erst kunde_finden nutzen"}
        prio = priority if priority in ("niedrig", "normal", "hoch", "kritisch") else "normal"
        tid = db.insert("tickets", {"customer_id": int(customer_id), "title": title, "description": description,
                                    "priority": prio, "status": "neu"})
        return {"ok": True, "ticket_id": tid}

    def search_kb(query: str) -> list[dict[str, Any]]:
        hits = ctx.kb.search(query, limit=3)
        return [{"titel": h["title"], "inhalt": h["content"][:1500]} for h in hits] or [{"hinweis": "Nichts gefunden"}]

    def opportunities(customer_id: int | None = None) -> dict[str, Any]:
        scan = ctx.radar.scan(int(customer_id) if customer_id else None)
        return {"summe_jahreswert": scan["total_annual"],
                "top": [{k: o[k] for k in ("customer", "title", "reason", "once", "monthly", "priority")}
                        for o in scan["opportunities"][:8]]}

    def eol_devices() -> list[dict[str, Any]]:
        rows = db.query("SELECT a.name, a.os, a.type, c.name AS kunde FROM assets a "
                        "LEFT JOIN customers c ON c.id = a.customer_id")
        out = []
        for r in rows:
            info = eol_info(r["os"] or "")
            if info:
                out.append({**r, "support_ende": info[0].isoformat(), "produkt": info[1]})
        return out or [{"hinweis": "Keine Geräte mit bekanntem Support-Ende"}]

    def kpis() -> dict[str, Any]:
        return {
            "kunden": db.scalar("SELECT COUNT(*) FROM customers"),
            "mrr_summe": db.scalar("SELECT COALESCE(SUM(mrr), 0) FROM customers"),
            "offene_tickets": db.scalar("SELECT COUNT(*) FROM tickets WHERE status != 'geloest'"),
            "kritische_tickets": db.scalar(
                "SELECT COUNT(*) FROM tickets WHERE status != 'geloest' AND priority = 'kritisch'"),
            "geraete": db.scalar("SELECT COUNT(*) FROM assets"),
        }

    return [
        Tool("kunde_finden", "Sucht Kunden nach Firmen- oder Kontaktname.", {"name": "Text"}, find_customer),
        Tool("kunde_details", "Stammdaten, Geräte und offene Tickets eines Kunden.", {"customer_id": "Zahl"},
             customer_details),
        Tool("offene_tickets", "Offene Tickets, optional für einen Kunden.", {"customer_id": "Zahl (optional)"},
             open_tickets),
        Tool("ticket_anlegen", "Legt ein neues Ticket an.",
             {"customer_id": "Zahl", "title": "Text", "description": "Text", "priority": "niedrig|normal|hoch|kritisch"},
             create_ticket),
        Tool("wissen_suchen", "Durchsucht die Wissensdatenbank nach Lösungen.", {"query": "Text"}, search_kb),
        Tool("umsatz_chancen", "Verkaufschancen aus dem Umsatz-Radar.", {"customer_id": "Zahl (optional)"},
             opportunities),
        Tool("geraete_support_ende", "Alle Geräte mit (bald) auslaufendem Herstellersupport.", {}, eol_devices),
        Tool("kennzahlen", "Kennzahlen des Unternehmens (Kunden, MRR, Tickets).", {}, kpis),
    ]


SYSTEM = (
    "Du bist der interne KI-Assistent von {company}, einem IT-Dienstleister in Österreich. "
    "Du hilfst Technikern und der Geschäftsführung: Tickets, Kunden, Lösungen, Verkaufschancen. "
    "Antworte knapp, konkret und auf Deutsch. Bei technischen Anleitungen: nummerierte Schritte."
)


def run_assistant(ctx: AgentContext, messages: list[dict[str, str]]) -> dict[str, Any]:
    started = time.time()
    messages = [m for m in messages if m.get("role") in ("user", "assistant") and m.get("content")][-12:]
    question = messages[-1]["content"] if messages else ""
    llm = ctx.llm()
    tools = _tools(ctx)
    if not llm.available():
        # Offline-Fallback: Wissensdatenbank durchsuchen.
        hits = ctx.kb.search(question, limit=3)
        if hits:
            answer = "**KI ist gerade nicht verfügbar** – passende Artikel aus der Wissensdatenbank:\n\n" + \
                "\n\n".join(f"### {h['title']}\n{h['content']}" for h in hits)
        else:
            answer = ("**KI ist gerade nicht verfügbar** und in der Wissensdatenbank wurde nichts gefunden. "
                      "Starte Ollama (`ollama serve`) und lade ein Modell (`ollama pull qwen3:14b`).")
        ctx.log("assistent", "offline", question, answer, False, started)
        return {"answer": answer, "steps": [], "provider": "offline"}

    agent = ToolAgent(llm=llm, system=SYSTEM.format(company=ctx.company), tools=tools)
    try:
        answer = agent.run(messages)
        ok = True
    except LLMError as exc:
        answer = f"Der Agent konnte die Anfrage nicht abschließen: {exc}"
        ok = False
    provider = f"{llm.provider}:{llm.model}"
    ctx.log("assistent", provider, question, {"answer": answer, "steps": agent.steps}, ok, started)
    return {"answer": answer, "steps": agent.steps, "provider": provider, "local": llm.local}
