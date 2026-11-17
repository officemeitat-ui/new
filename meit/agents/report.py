"""Monatsbericht-Agent: zeigt dem Kunden den Wert der Betreuung (= Kundenbindung).

Zahlen werden im Code berechnet, die KI formuliert nur Zusammenfassung und Empfehlungen.
"""

from __future__ import annotations

import json
import time
from datetime import date
from typing import Any

from ..llm import LLMError
from ..sla import customer_sla_quote
from .base import AgentContext


def monthly_report(ctx: AgentContext, customer_id: int, month: str | None = None) -> dict[str, Any]:
    started = time.time()
    customer = ctx.db.get("customers", customer_id)
    if not customer:
        raise ValueError("Kunde nicht gefunden")
    month = month or date.today().strftime("%Y-%m")
    tickets = ctx.db.query(
        "SELECT id, title, status, priority, category, time_spent_min, solution FROM tickets "
        "WHERE customer_id = ? AND substr(created_at, 1, 7) = ?", (customer_id, month))
    open_all = ctx.db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND status != 'geloest'",
                             (customer_id,))
    minutes = sum(t["time_spent_min"] or 0 for t in tickets)
    resolved = [t for t in tickets if t["status"] == "geloest"]
    scan = ctx.radar.scan(customer_id)
    risks = [o for o in scan["opportunities"] if o["kind"] in ("lifecycle", "security", "compliance")][:5]
    assessment = ctx.db.query_one(
        "SELECT score, level, created_at FROM assessments WHERE customer_id = ? ORDER BY id DESC LIMIT 1",
        (customer_id,))

    from ..maintenance import Maintenance, month_bounds, report_lines

    m_start, m_end, _ = month_bounds(month)
    wartung = Maintenance(ctx.db).summary(customer_id, m_start, m_end)
    facts = {
        "wartung_durchgefuehrt": [f"{r['title']}: {r['result']}" for r in wartung["done"]],
        "monat": month, "tickets_gesamt": len(tickets), "geloest": len(resolved), "offen_gesamt": open_all,
        "arbeitszeit_stunden": round(minutes / 60, 1),
        "kategorien": sorted({t["category"] for t in tickets if t["category"]}),
        "security_score": assessment["score"] if assessment else None,
        "risiken": [{"titel": r["title"], "grund": r["reason"]} for r in risks],
    }

    summary = ""
    provider = "vorlage"
    llm = ctx.llm()
    if llm.available():
        try:
            summary = llm.chat(
                [{"role": "user", "content":
                  f"Schreibe für den Kunden {customer['name']} eine kurze Management-Zusammenfassung "
                  f"(max. 120 Wörter, Sie-Form, positiv aber ehrlich) des IT-Monats und 2-3 konkrete Empfehlungen. "
                  f"Fakten: {json.dumps(facts, ensure_ascii=False)}\nNur Fließtext und eine Aufzählung, keine Überschrift."}],
                system=f"Du schreibst Kundenberichte für {ctx.company}, einen IT-Dienstleister.",
                temperature=0.4,
            )
            provider = f"{llm.provider}:{llm.model}"
        except LLMError:
            summary = ""
    if not summary:
        summary = (f"Im {month} haben wir {len(tickets)} Anfrage(n) bearbeitet, davon {len(resolved)} abgeschlossen "
                   f"(Aufwand {facts['arbeitszeit_stunden']} h). "
                   + ("Aktuell gibt es folgende Risiken, die wir gemeinsam angehen sollten." if risks else
                      "Ihre IT läuft stabil."))

    lines = [f"# IT-Monatsbericht {month} – {customer['name']}", "", summary.strip(), "", "## Kennzahlen",
             f"- Tickets im Monat: **{len(tickets)}** (gelöst: {len(resolved)})",
             f"- Offene Tickets gesamt: **{open_all}**",
             f"- Aufgewendete Zeit: **{str(facts['arbeitszeit_stunden']).replace('.', ',')} h**"]
    if assessment:
        lines.append(f"- Security-Score: **{assessment['score']:.0f}/100** ({assessment['level']})")
    sla_q = customer_sla_quote(ctx.db, customer, days=31)
    if sla_q["quote"] is not None:
        lines.append(f"- SLA eingehalten: **{sla_q['quote']:.0f} %** ({sla_q['met']} von {sla_q['measured']} Zusagen)")
    done_tickets = [t for t in resolved if t["category"] != "Wartung"]
    if done_tickets:
        lines += ["", "## Erledigt"] + [f"- {t['title']}" for t in done_tickets]
    lines += report_lines(wartung)
    if risks:
        lines += ["", "## Empfehlungen & Risiken"] + [f"- **{r['title']}** – {r['reason']}" for r in risks]
    lines += ["", f"_Erstellt von {ctx.company}_"]
    text = "\n".join(lines)
    ctx.log("bericht", provider, {"customer_id": customer_id, "month": month}, text, True, started)
    return {"customer_id": customer_id, "month": month, "text": text, "facts": facts, "provider": provider}
