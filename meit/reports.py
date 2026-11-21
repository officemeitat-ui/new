"""Auswertungen: Wie ausgelastet sind wir, was wird verrechnet, wie entwickeln sich Umsatz und Tickets?

Alles aus Daten, die im Cockpit ohnehin entstehen – ohne zusätzliche Eingaben:

- **Monatsverlauf:** gebuchte Stunden (verrechenbar / nicht verrechenbar), gestellter Umsatz netto, neue und gelöste Tickets.
- **Auslastung je Techniker:** gebuchte und verrechenbare Stunden gegen die verfügbare Arbeitszeit des Monats.
- **Kunden:** wer bindet die meiste Zeit – und wie viel davon wird verrechnet.
- **Tickets:** Aufkommen nach Kategorie und mittlere Lösungszeit.

„Verfügbar“ ist eine Näherung: Werktage des Monats × Wochenstunden / 5, ohne Urlaub, Krankenstand und Feiertage.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI
from pydantic import BaseModel, Field

from .db import Database

MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]


def month_list(count: int, today: date | None = None) -> list[str]:
    today = today or date.today()
    y, m, out = today.year, today.month, []
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def workdays(month: str, until: date | None = None) -> int:
    """Montag bis Freitag im Monat – im laufenden Monat nur bis heute (sonst wirkt er immer schlecht ausgelastet)."""
    y, m = int(month[:4]), int(month[5:7])
    d, n = date(y, m, 1), 0
    while d.month == m and (until is None or d <= until):
        n += d.weekday() < 5
        d += timedelta(days=1)
    return n


def label(month: str) -> str:
    return f"{MONTHS[int(month[5:7]) - 1]} {month[2:4]}"


def overview(db: Database, months: int = 6, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    span = month_list(max(2, min(months, 24)), today)
    first = span[0] + "-01"
    week_hours = float(db.get_setting("reports_week_hours", 38.5) or 38.5)

    hours = {r["m"]: r for r in db.query(
        "SELECT substr(date, 1, 7) AS m, SUM(minutes) AS total, SUM(CASE WHEN billable = 1 THEN minutes ELSE 0 END) AS billable, "
        "SUM(CASE WHEN billable = 1 THEN minutes / 60.0 * rate ELSE 0 END) AS value FROM time_entries WHERE date >= ? GROUP BY m", (first,))}
    revenue = {r["m"]: r["net"] for r in db.query(
        "SELECT substr(date, 1, 7) AS m, SUM(net) AS net FROM invoices WHERE status IN ('gestellt', 'bezahlt') AND date >= ? GROUP BY m", (first,))}
    created = {r["m"]: r["n"] for r in db.query("SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM tickets WHERE created_at >= ? GROUP BY m", (first,))}
    resolved = {r["m"]: r for r in db.query(
        "SELECT substr(resolved_at, 1, 7) AS m, COUNT(*) AS n, AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS hours "
        "FROM tickets WHERE resolved_at IS NOT NULL AND resolved_at != '' AND resolved_at >= ? GROUP BY m", (first,))}
    series = []
    for m in span:
        h = hours.get(m) or {}
        total, bill = (h.get("total") or 0), (h.get("billable") or 0)
        r = resolved.get(m) or {}
        series.append({"month": m, "label": label(m), "hours": round(total / 60, 1), "hours_billable": round(bill / 60, 1),
                       "hours_other": round((total - bill) / 60, 1), "billable_share": round(100 * bill / total) if total else None,
                       "hours_value": round(h.get("value") or 0, 2), "revenue": round(revenue.get(m) or 0, 2),
                       "tickets_new": created.get(m, 0), "tickets_resolved": r.get("n") or 0,
                       "resolution_hours": round(r["hours"], 1) if r.get("hours") is not None else None})

    # Auslastung je Techniker: laufender Monat und Vormonat
    techs = []
    for m in span[-2:][::-1]:
        current = m == span[-1]
        days = workdays(m, today if current else None)
        available = round(days * week_hours / 5, 1)
        rows = db.query("SELECT u.id, u.name, COALESCE(SUM(e.minutes), 0) AS total, COALESCE(SUM(CASE WHEN e.billable = 1 THEN e.minutes ELSE 0 END), 0) AS billable "
                        "FROM users u LEFT JOIN time_entries e ON e.user_id = u.id AND substr(e.date, 1, 7) = ? WHERE u.active = 1 GROUP BY u.id ORDER BY total DESC", (m,))
        nobody = db.query_one("SELECT COALESCE(SUM(minutes), 0) AS total, COALESCE(SUM(CASE WHEN billable = 1 THEN minutes ELSE 0 END), 0) AS billable "
                              "FROM time_entries WHERE user_id IS NULL AND substr(date, 1, 7) = ?", (m,))
        people = [{"name": r["name"], "hours": round(r["total"] / 60, 1), "hours_billable": round(r["billable"] / 60, 1),
                   "booked_share": round(100 * r["total"] / 60 / available) if available else None,
                   "billable_share": round(100 * r["billable"] / 60 / available) if available else None} for r in rows]
        if nobody["total"]:
            people.append({"name": "ohne Benutzer", "hours": round(nobody["total"] / 60, 1), "hours_billable": round(nobody["billable"] / 60, 1),
                           "booked_share": None, "billable_share": None})
        techs.append({"month": m, "label": label(m), "current": current, "workdays": days, "available_hours": available, "people": people})

    since = (today - timedelta(days=90)).isoformat()
    customers = db.query(
        "SELECT c.id, c.name, SUM(e.minutes) AS total, SUM(CASE WHEN e.billable = 1 THEN e.minutes ELSE 0 END) AS billable, c.mrr "
        "FROM time_entries e JOIN customers c ON c.id = e.customer_id WHERE e.date >= ? GROUP BY c.id ORDER BY total DESC LIMIT 8", (since,))
    categories = db.query("SELECT COALESCE(NULLIF(category, ''), 'ohne Kategorie') AS category, COUNT(*) AS n, "
                          "SUM(status != 'geloest') AS open FROM tickets WHERE created_at >= ? GROUP BY 1 ORDER BY n DESC LIMIT 8", (since,))
    cur, prev = series[-1], series[-2]
    return {
        "months": series, "technicians": techs, "week_hours": week_hours,
        "customers": [{"id": c["id"], "name": c["name"], "hours": round(c["total"] / 60, 1), "hours_billable": round(c["billable"] / 60, 1),
                       "billable_share": round(100 * c["billable"] / c["total"]) if c["total"] else None, "mrr": c["mrr"] or 0} for c in customers],
        "categories": categories,
        "summary": {"month": cur["label"], "hours": cur["hours"], "hours_prev": prev["hours"], "billable_share": cur["billable_share"],
                    "revenue": cur["revenue"], "revenue_prev": prev["revenue"], "tickets_new": cur["tickets_new"],
                    "tickets_resolved": cur["tickets_resolved"], "resolution_hours": cur["resolution_hours"]},
    }


class ReportSettingsIn(BaseModel):
    week_hours: float = Field(38.5, ge=1, le=80)


def register(app: FastAPI, ctx: Any, admin_only) -> None:
    db: Database = ctx.db

    @app.get("/api/reports/overview", dependencies=[Depends(admin_only)])
    def get_overview(months: int = 6) -> dict:
        return overview(db, months)

    @app.put("/api/reports/settings", dependencies=[Depends(admin_only)])
    def save_settings(data: ReportSettingsIn) -> dict:
        db.set_setting("reports_week_hours", data.week_hours)
        return {"week_hours": data.week_hours}
