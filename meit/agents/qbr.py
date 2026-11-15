"""QBR-Agent: Quartalsgespräch im „Trusted Advisor“-Format.

Statt „Das haben wir für Sie geleistet – passt alles?“ führt der Bericht:
  Das war der Plan → das haben wir erreicht → das ist der nächste Hebel → das ist jetzt zu tun.
Zahlen, Health Score und Hebel kommen aus dem Code; die KI formuliert nur.
"""

from __future__ import annotations

import json
import time
from datetime import date, timedelta
from typing import Any

from ..db import loads, now_iso
from ..growth import health_score
from ..llm import LLMError
from .base import AgentContext


MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
          "November", "Dezember"]


def _quarter(d: date) -> str:
    return f"Q{(d.month - 1) // 3 + 1}/{d.year}"


def create_qbr(ctx: AgentContext, customer_id: int, today: date | None = None) -> dict[str, Any]:
    started = time.time()
    db = ctx.db
    today = today or date.today()
    customer = db.get("customers", customer_id)
    if not customer:
        raise ValueError("Kunde nicht gefunden")
    since = (today - timedelta(days=90)).isoformat()
    tickets = db.query("SELECT title, status, priority, category, time_spent_min, created_at, resolved_at FROM tickets "
                       "WHERE customer_id = ? AND created_at >= ?", (customer_id, since))
    resolved = [t for t in tickets if t["status"] == "geloest"]
    critical = [t for t in tickets if t["priority"] == "kritisch"]
    hours = round(sum(t["time_spent_min"] or 0 for t in tickets) / 60, 1)
    projects = db.query("SELECT title, total_once, total_monthly FROM quotes WHERE customer_id = ? AND status = 'angenommen' "
                        "AND created_at >= ?", (customer_id, since))
    last = db.query_one("SELECT next_steps, created_at FROM qbrs WHERE customer_id = ? ORDER BY id DESC LIMIT 1",
                        (customer_id,))
    plan = loads(last["next_steps"], []) if last else []
    if not plan:
        plan = [f"Stabiler und sicherer IT-Betrieb im Rahmen des Pakets „{customer['package']}“"]
    health = health_score(db, customer, today)
    levers = ctx.radar.scan(customer_id, today=today)["opportunities"][:3]
    next_steps = [o["title"] for o in levers]

    facts = {
        "kunde": customer["name"], "zeitraum": f"{_quarter(today)} (letzte 90 Tage)", "plan_letztes_qbr": plan,
        "tickets": len(tickets), "geloest": len(resolved), "kritische_vorfaelle": len(critical),
        "arbeitszeit_stunden": hours, "umgesetzte_projekte": [p["title"] for p in projects],
        "health_score": health["score"], "health_faktoren": [f["text"] for f in health["factors"]],
        "naechste_hebel": [{"titel": o["title"], "grund": o["reason"]} for o in levers],
    }

    intro = ""
    lever_text = ""
    provider = "vorlage"
    llm = ctx.llm()
    if llm.available():
        try:
            data = llm.chat_json(
                [{"role": "user", "content":
                  "Schreibe Bausteine für ein Quartalsgespräch (QBR) mit der Geschäftsführung des Kunden. "
                  "Haltung: Trusted Advisor, nicht Bittsteller – klar, ergebnisorientiert, Sie-Form, keine Floskeln, "
                  "keine Preise. Fakten: " + json.dumps(facts, ensure_ascii=False) + "\n"
                  'JSON: {"einleitung": "2 Sätze: Plan vs. Ergebnis", '
                  '"naechster_hebel": "2-3 Sätze: Sie haben A erreicht. Der nächste logische Hebel ist B – so gehen wir vor."}'}],
                system=f"Du bist Kundenbetreuer (Customer Success) bei {ctx.company}, einem IT-Dienstleister in Österreich.",
            )
            intro = str(data.get("einleitung") or "").strip()
            lever_text = str(data.get("naechster_hebel") or "").strip()
            provider = f"{llm.provider}:{llm.model}"
        except (LLMError, AttributeError, TypeError):
            pass
    if not intro:
        intro = (f"Im letzten Quartal haben wir {len(tickets)} Anliegen bearbeitet, davon {len(resolved)} abgeschlossen"
                 + (f", darunter {len(critical)} kritische Vorfälle" if critical else "") + ". "
                 + (f"Umgesetzt wurde: {', '.join(p['title'] for p in projects)}." if projects else
                    "Der laufende Betrieb war der Schwerpunkt."))
    if not lever_text and levers:
        lever_text = (f"Der nächste logische Hebel ist „{levers[0]['title']}“: {levers[0]['reason']} "
                      "Wir schlagen vor, das im nächsten Schritt gemeinsam anzugehen.")

    lines = [f"# Quartalsgespräch {_quarter(today)} – {customer['name']}", "",
             f"**Health Score: {health['score']}/100 ({health['status']})**", "",
             "## 1. Das war der Plan"] + [f"- {p}" for p in plan] + [
             "", "## 2. Das haben wir erreicht", intro, "",
             f"- Anliegen bearbeitet: **{len(tickets)}** (abgeschlossen: {len(resolved)})",
             f"- Aufgewendete Zeit: **{str(hours).replace('.', ',')} h**"]
    if projects:
        lines += [f"- Projekt umgesetzt: **{p['title']}**" for p in projects]
    lines += ["", "## 3. Wo wir stehen"] + [
        f"- {'▲' if f['delta'] > 0 else '▼'} {f['text']}" for f in health["factors"]] + [""]
    lines += ["## 4. Der nächste Hebel", lever_text or "Aktuell keine offenen Hebel – Fokus auf stabilen Betrieb.", ""]
    if levers:
        lines += ["## 5. Das ist jetzt zu tun"] + [
            f"{i}. **{o['title']}** – Entscheidung bis {(today + timedelta(days=21)).strftime('%d.%m.%Y')}"
            for i, o in enumerate(levers, 1)] + [""]
    nxt = today + timedelta(days=91)
    lines += [f"_Nächstes Quartalsgespräch: {MONTHS[nxt.month - 1]} {nxt.year} · {ctx.company}_"]
    text = "\n".join(lines)

    qid = db.insert("qbrs", {"customer_id": customer_id, "period": _quarter(today), "health_score": health["score"],
                             "text": text, "next_steps": next_steps})
    db.update("customers", customer_id, {"last_qbr_at": now_iso()})
    ctx.log("qbr", provider, {"customer_id": customer_id}, {"health": health["score"], "levers": next_steps}, True, started)
    return {"id": qid, "text": text, "health": health, "next_steps": next_steps, "provider": provider}
