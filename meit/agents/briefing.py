"""Wochenbriefing-Agent („KI-Abteilungsleiter“): die Woche in einer Seite für die Geschäftsführung.

Zahlen kommen aus dem Code (MRR, Pipeline, Tickets, Health, Wochenziele), die KI fasst
zusammen und schlägt die drei Prioritäten für die nächste Woche vor.
"""

from __future__ import annotations

import json
import time
from datetime import date, timedelta
from typing import Any

from ..growth import health_overview
from ..llm import LLMError
from ..team import ACTIVITY_TYPES, iso_week, week_overview
from .base import AgentContext
from .inbox import overview as inbox_overview


def _eur(v: float) -> str:
    return "€ " + f"{v:,.0f}".replace(",", ".")


def weekly_briefing(ctx: AgentContext, today: date | None = None) -> dict[str, Any]:
    started = time.time()
    db = ctx.db
    today = today or date.today()
    since = (today - timedelta(days=7)).isoformat()
    week = iso_week(today)
    mrr_now = db.scalar("SELECT COALESCE(SUM(mrr), 0) FROM customers") or 0
    mrr_delta = db.scalar("SELECT COALESCE(SUM(new_mrr - old_mrr), 0) FROM mrr_history WHERE created_at >= ?", (since,)) or 0
    acts = {r["type"]: r["n"] for r in db.query(
        "SELECT type, COUNT(*) AS n FROM activities WHERE created_at >= ? GROUP BY type", (since,))}
    new_leads = db.scalar("SELECT COUNT(*) FROM leads WHERE created_at >= ?", (since,)) or 0
    pipeline = {r["stage"]: r["n"] for r in db.query("SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage")}
    tickets_new = db.scalar("SELECT COUNT(*) FROM tickets WHERE created_at >= ?", (since,)) or 0
    tickets_done = db.scalar("SELECT COUNT(*) FROM tickets WHERE resolved_at != '' AND resolved_at >= ?", (since,)) or 0
    critical_open = db.query("SELECT t.title, c.name AS customer FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id "
                             "WHERE t.status != 'geloest' AND t.priority = 'kritisch'")
    health = health_overview(db, today)
    risks = [h for h in health["customers"] if h["status"] == "risiko"]
    radar = ctx.radar.scan(today=today)["opportunities"][:3]
    km = inbox_overview(ctx, days=7)
    team = week_overview(db, week)

    facts = {
        "kalenderwoche": week, "mrr": mrr_now, "mrr_veraenderung_7_tage": mrr_delta, "neue_leads": new_leads,
        "pipeline": pipeline, "aktivitaeten": {ACTIVITY_TYPES.get(k, k): v for k, v in acts.items()},
        "tickets_neu": tickets_new, "tickets_geloest": tickets_done,
        "kritisch_offen": [f"{t['title']} ({t['customer']})" for t in critical_open],
        "kunden_im_risiko": [f"{r['customer']} ({r['score']}/100)" for r in risks],
        "top_chancen": [f"{o['title']} – {o['customer']}" for o in radar],
        "ki_mitarbeiter": {"bearbeitet": km["processed"], "freigaben_offen": km["pending_approval"],
                           "zeitersparnis_h": round(km["minutes_saved"] / 60, 1)},
        "wochenziele": [{"name": r["name"], "erfuellt": r["fulfilled"]} for r in team["rows"] if r["goals"]],
    }

    summary, priorities, provider = "", [], "vorlage"
    llm = ctx.llm("briefing")
    if llm.available():
        try:
            data = llm.chat_json(
                [{"role": "user", "content":
                  "Erstelle das Wochenbriefing für die Geschäftsführung eines IT-Dienstleisters. Klar, ehrlich, "
                  "ohne Floskeln. Fakten: " + json.dumps(facts, ensure_ascii=False, default=str) + "\n"
                  'JSON: {"zusammenfassung": "3-4 Sätze: Wie war die Woche?", '
                  '"prioritaeten": ["3 konkrete Prioritäten für nächste Woche"]}'}],
                system=f"Du bist der KI-Abteilungsleiter von {ctx.company}. Du denkst wie ein Geschäftsführer.",
            )
            summary = str(data.get("zusammenfassung") or "").strip()
            pr = data.get("prioritaeten")
            priorities = [str(x) for x in pr][:3] if isinstance(pr, list) else []
            provider = f"{llm.provider}:{llm.model}"
        except (LLMError, AttributeError, TypeError):
            pass
    if not summary:
        summary = (f"Wiederkehrender Umsatz: {_eur(mrr_now)}/Monat ({'+' if mrr_delta >= 0 else ''}{_eur(mrr_delta)} in 7 Tagen). "
                   f"{new_leads} neue Lead(s), {tickets_new} neue und {tickets_done} gelöste Tickets. "
                   + (f"{len(critical_open)} kritische(s) Ticket(s) offen. " if critical_open else "")
                   + (f"{len(risks)} Kunde(n) im Health-Risiko." if risks else "Kein Kunde im Health-Risiko."))
    if not priorities:
        if critical_open:
            priorities.append(f"Kritische Tickets schließen: {', '.join(t['title'] for t in critical_open[:2])}")
        if risks:
            priorities.append(f"Risiko-Kunden aktiv anrufen bzw. QBR: {', '.join(r['customer'] for r in risks[:2])}")
        if km["pending_approval"]:
            priorities.append(f"{km['pending_approval']} Freigaben im Posteingang abarbeiten")
        for o in radar:
            if len(priorities) >= 3:
                break
            priorities.append(f"Chance nutzen: {o['title']} ({o['customer']})")

    lines = [f"# Wochenbriefing {week}", "", summary, "", "## Zahlen der Woche",
             f"- Wiederkehrender Umsatz: **{_eur(mrr_now)}/Monat** ({'+' if mrr_delta >= 0 else ''}{_eur(mrr_delta)})",
             f"- Neue Leads: **{new_leads}** · Pipeline: " + ", ".join(f"{k} {v}" for k, v in pipeline.items()) if pipeline else
             f"- Neue Leads: **{new_leads}**",
             f"- Tickets: {tickets_new} neu, {tickets_done} gelöst, {len(critical_open)} kritisch offen",
             f"- KI-Mitarbeiter: {km['processed']} Nachrichten bearbeitet, ca. {str(round(km['minutes_saved'] / 60, 1)).replace('.', ',')} h gespart, "
             f"{km['pending_approval']} Freigaben offen"]
    if acts:
        lines.append("- Aktivitäten: " + ", ".join(f"{ACTIVITY_TYPES.get(k, k)} {v}" for k, v in sorted(acts.items())))
    if facts["wochenziele"]:
        lines.append("- Wochenziele erfüllt: " + ", ".join(f"{w['name']} {w['erfuellt']}" for w in facts["wochenziele"]))
    if risks:
        lines += ["", "## Kunden im Risiko"] + [f"- {r['customer']} ({r['score']}/100): "
                                               + "; ".join(f["text"] for f in r["factors"] if f["delta"] < 0)[:200] for r in risks]
    lines += ["", "## Prioritäten nächste Woche"] + [f"{i}. {p}" for i, p in enumerate(priorities, 1)]
    lines += ["", f"_Erstellt vom KI-Mitarbeiter · {ctx.company}_"]
    text = "\n".join(lines)
    ctx.log("wochenbriefing", provider, {"week": week}, {"priorities": priorities}, True, started)
    return {"week": week, "text": text, "priorities": priorities, "facts": facts, "provider": provider}
