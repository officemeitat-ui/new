"""„Mein Tag“ – die persönliche Startseite: Was steht heute an, was liegt bei mir, was wartet auf Abschluss.

Zeigt für den angemeldeten Benutzer (ohne Benutzerkonten: für alle) auf einen Blick:
heutige und morgige Termine, den nächsten Einsatz, die eigenen offenen Tickets nach Dringlichkeit,
Tickets ohne Zuständigen, Arbeitsberichte, die noch auf die Unterschrift warten, fällige Wartungen
sowie die heute und in dieser Woche gebuchte Zeit.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import FastAPI, Request

from .db import Database

PRIORITY_ORDER = "CASE t.priority WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END"
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def greeting(now: datetime, name: str = "") -> str:
    part = "Guten Morgen" if now.hour < 11 else "Mahlzeit" if now.hour < 14 else "Guten Tag" if now.hour < 18 else "Guten Abend"
    first = (name or "").split(" ")[0]
    return f"{part}, {first}" if first else part


def my_day(db: Database, planner: Any, user: dict[str, Any] | None, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    today, tomorrow = now.date(), now.date() + timedelta(days=1)
    uid = (user or {}).get("id")
    mine = bool(uid)

    appts: list[dict[str, Any]] = []
    if planner:
        rows = planner.list(today.isoformat(), tomorrow.isoformat(), user_id=uid if mine else None)
        appts = [planner.view(a) for a in rows if a["status"] != "abgesagt"]
    stamp = now.replace(microsecond=0).isoformat(sep=" ")
    upcoming = [a for a in appts if a["end_at"] >= stamp and a["status"] != "erledigt"]

    where, params = ("t.assigned_to = ?", [uid]) if mine else ("1 = 1", [])
    tickets = db.query(
        "SELECT t.id, t.title, t.priority, t.status, t.created_at, t.customer_id, c.name AS customer FROM tickets t "
        f"LEFT JOIN customers c ON c.id = t.customer_id WHERE t.status != 'geloest' AND {where} "
        f"ORDER BY {PRIORITY_ORDER}, t.created_at LIMIT 15", params)
    for t in tickets:
        t["age_days"] = max(0, (today - date.fromisoformat(t["created_at"][:10])).days)
    open_mine = db.scalar(f"SELECT COUNT(*) FROM tickets t WHERE t.status != 'geloest' AND {where}", params) or 0
    unassigned = (db.scalar("SELECT COUNT(*) FROM tickets WHERE status != 'geloest' AND assigned_to IS NULL") or 0) if mine else 0

    dwhere, dparams = ("AND r.user_id = ?", [uid]) if mine else ("", [])
    drafts = db.query("SELECT r.id, r.number, r.date, r.minutes, r.work, c.name AS customer FROM work_reports r "
                      f"LEFT JOIN customers c ON c.id = r.customer_id WHERE r.status = 'entwurf' {dwhere} ORDER BY r.id DESC LIMIT 10", dparams)
    for d in drafts:
        d["work"] = (d["work"] or "").splitlines()[0][:100] if d["work"] else ""

    horizon = (today + timedelta(days=7)).isoformat()
    maintenance = db.query("SELECT r.id, r.title, r.due_date, r.customer_id, c.name AS customer FROM maintenance_runs r "
                           "LEFT JOIN customers c ON c.id = r.customer_id WHERE r.status = 'offen' AND r.due_date <= ? "
                           "ORDER BY r.due_date LIMIT 8", (horizon,))
    for m in maintenance:
        m["overdue"] = m["due_date"] < today.isoformat()

    monday = today - timedelta(days=today.weekday())
    twhere, tparams = ("AND user_id = ?", [uid]) if mine else ("", [])
    minutes_today = db.scalar(f"SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE date = ? {twhere}", [today.isoformat(), *tparams]) or 0
    minutes_week = db.scalar(f"SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE date >= ? AND date <= ? {twhere}",
                             [monday.isoformat(), today.isoformat(), *tparams]) or 0
    planned_today = sum(a["duration_min"] for a in appts if a["start_at"][:10] == today.isoformat())

    return {
        "date": today.isoformat(), "weekday": WEEKDAYS[today.weekday()], "greeting": greeting(now, (user or {}).get("name", "")),
        "personal": mine, "next": upcoming[0] if upcoming else None,
        "today": [a for a in appts if a["start_at"][:10] == today.isoformat()],
        "tomorrow": [a for a in appts if a["start_at"][:10] == tomorrow.isoformat()],
        "tickets": tickets, "open_tickets": open_mine, "unassigned": unassigned,
        "drafts": drafts, "maintenance": maintenance,
        "minutes_today": minutes_today, "minutes_week": minutes_week, "planned_today": planned_today,
    }


def register(app: FastAPI, ctx: Any) -> None:
    db: Database = ctx.db

    @app.get("/api/my-day")
    def get_my_day(request: Request) -> dict:
        u = getattr(request.state, "user", None)
        return my_day(db, getattr(app.state, "planner", None), u if isinstance(u, dict) else None)
