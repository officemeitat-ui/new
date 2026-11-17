"""Lizenzen & Verträge pro Kunde: Verlängerungen, Kündigungsfristen, Marge, Lizenzanzahl.

Typische Einträge: Microsoft 365 (je Benutzer, monatlich), Virenschutz/EDR, Firewall-Lizenz,
Domains, SSL-Zertifikate, Hersteller-Wartung, Backup-Speicher. Verrechenbare Lizenzen laufen
automatisch in den monatlichen Rechnungslauf – jährliche im Monat der Verlängerung.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database

KINDS = {"lizenz": "Lizenz", "abo": "Abo/Cloud", "domain": "Domain", "zertifikat": "Zertifikat",
         "wartung": "Wartung/Support", "garantie": "Garantie", "sonstiges": "Sonstiges"}
CYCLES = {"monat": 1, "jahr": 12}


def _parse(d: str | None) -> date | None:
    try:
        return date.fromisoformat(d[:10]) if d else None
    except ValueError:
        return None


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def next_renewal(sub: dict[str, Any], today: date) -> date | None:
    d = _parse(sub.get("renewal_date"))
    if not d:
        return None
    if sub.get("auto_renew"):
        step = CYCLES.get(sub.get("billing_cycle") or "monat", 1)
        while d < today:
            d = add_months(d, step)
    return d


def monthly(value: float, cycle: str) -> float:
    return value / CYCLES.get(cycle or "monat", 1)


def enrich(sub: dict[str, Any], employees: int = 0, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    s = dict(sub)
    qty = float(s.get("quantity") or 0)
    nr = next_renewal(s, today)
    s["next_renewal"] = nr.isoformat() if nr else ""
    s["days_to_renewal"] = (nr - today).days if nr else None
    notice = nr - timedelta(days=int(s.get("notice_days") or 0)) if nr else None
    s["notice_deadline"] = notice.isoformat() if notice else ""
    if nr is None:
        state = "ok"
    elif nr < today:
        state = "abgelaufen"
    elif notice and today >= notice - timedelta(days=14):
        state = "kündigungsfrist"
    elif (nr - today).days <= 60:
        state = "bald"
    else:
        state = "ok"
    s["state"] = state
    s["cost_month"] = round(monthly(float(s.get("unit_cost") or 0) * qty, s.get("billing_cycle")), 2)
    s["price_month"] = round(monthly(float(s.get("unit_price") or 0) * qty, s.get("billing_cycle")), 2)
    s["margin_month"] = round(s["price_month"] - s["cost_month"], 2)
    s["margin_pct"] = round(100 * s["margin_month"] / s["price_month"], 1) if s["price_month"] else None
    seats = None
    if s.get("per_user") and employees and qty:
        diff = int(qty) - int(employees)
        seats = {"licensed": int(qty), "employees": int(employees), "diff": diff,
                 "hint": ("unterlizenziert – Compliance-Risiko" if diff < 0 else
                          f"{diff} ungenutzte Lizenz(en)? Prüfen und ggf. reduzieren" if diff > 0 else "passt")}
    s["seats"] = seats
    return s


def list_enriched(db: Database, customer_id: int | None = None, today: date | None = None) -> list[dict[str, Any]]:
    sql = ("SELECT s.*, c.name AS customer_name, c.employees AS employees FROM subscriptions s "
           "JOIN customers c ON c.id = s.customer_id")
    params: tuple = ()
    if customer_id:
        sql += " WHERE s.customer_id = ?"
        params = (customer_id,)
    rows = [enrich(r, r.get("employees") or 0, today) for r in db.query(sql + " ORDER BY c.name, s.name", params)]
    order = {"abgelaufen": 0, "kündigungsfrist": 1, "bald": 2, "ok": 3}
    rows.sort(key=lambda r: (order[r["state"]], r["days_to_renewal"] if r["days_to_renewal"] is not None else 99999))
    return rows


def billable_items(db: Database, customer_id: int, period: str) -> list[dict[str, Any]]:
    """Positionen für den Rechnungslauf: monatliche Lizenzen jeden Monat, jährliche im Verlängerungsmonat."""
    y, m = (int(x) for x in period.split("-"))
    first = date(y, m, 1)
    items = []
    for s in db.query("SELECT * FROM subscriptions WHERE customer_id = ? AND billable = 1 AND unit_price > 0", (customer_id,)):
        if db.scalar("SELECT COUNT(*) FROM subscription_billing WHERE subscription_id = ? AND period = ?", (s["id"], period)):
            continue
        cycle = s["billing_cycle"] or "monat"
        if cycle == "jahr":
            nr = next_renewal(s, first)
            if not nr or (nr.year, nr.month) != (y, m):
                continue
        start = _parse(s.get("created_at")) or first
        if cycle == "monat" and start > add_months(first, 1) - timedelta(days=1):
            continue  # erst ab dem Monat des Anlegens
        qty = float(s["quantity"] or 1)
        items.append({"kind": "subscription", "ref": s["id"],
                      "description": f"{s['name']} ({'Jahreslizenz' if cycle == 'jahr' else 'monatlich'})"
                                     + (f" – {s['vendor']}" if s["vendor"] else ""),
                      "quantity": qty, "unit": "Jahr" if cycle == "jahr" else "Monat",
                      "price": round(float(s["unit_price"]), 2), "total": round(qty * float(s["unit_price"]), 2)})
    return items


class SubscriptionIn(BaseModel):
    customer_id: int
    name: str = Field(min_length=1, max_length=200)
    vendor: str = Field("", max_length=120)
    kind: str = "lizenz"
    quantity: float = Field(1, ge=0)
    unit_cost: float = Field(0, ge=0)
    unit_price: float = Field(0, ge=0)
    billing_cycle: str = "monat"
    renewal_date: str = ""
    auto_renew: bool = True
    notice_days: int = Field(30, ge=0, le=730)
    billable: bool = True
    per_user: bool = False  # je Benutzer lizenziert → Abgleich mit Mitarbeiterzahl
    notes: str = Field("", max_length=1000)


def register(app: FastAPI, db: Database, admin_only) -> None:
    def validate(data: SubscriptionIn) -> dict[str, Any]:
        if data.kind not in KINDS or data.billing_cycle not in CYCLES:
            raise HTTPException(422, "Ungültige Art oder Abrechnungszyklus")
        if data.renewal_date and not _parse(data.renewal_date):
            raise HTTPException(422, "Datum im Format JJJJ-MM-TT")
        if not db.get("customers", data.customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        return data.model_dump()

    @app.get("/api/subscriptions")
    def list_subs(customer_id: Optional[int] = None, due_days: Optional[int] = None) -> list[dict]:
        rows = list_enriched(db, customer_id)
        if due_days is not None:
            rows = [r for r in rows if r["days_to_renewal"] is not None and r["days_to_renewal"] <= due_days]
        return rows

    @app.get("/api/subscriptions/summary")
    def summary() -> dict:
        rows = list_enriched(db)
        return {
            "count": len(rows),
            "price_month": round(sum(r["price_month"] for r in rows if r["billable"]), 2),
            "cost_month": round(sum(r["cost_month"] for r in rows), 2),
            "margin_month": round(sum(r["margin_month"] for r in rows if r["billable"]), 2),
            "due_60": sum(1 for r in rows if r["state"] in ("bald", "kündigungsfrist", "abgelaufen")),
            "notice_soon": sum(1 for r in rows if r["state"] == "kündigungsfrist"),
            "seat_issues": sum(1 for r in rows if r["seats"] and r["seats"]["diff"] != 0),
            "kinds": KINDS,
        }

    @app.post("/api/subscriptions", status_code=201)
    def add_sub(data: SubscriptionIn) -> dict:
        sid = db.insert("subscriptions", validate(data))
        return next(r for r in list_enriched(db, data.customer_id) if r["id"] == sid)

    @app.put("/api/subscriptions/{sid}")
    def update_sub(sid: int, data: SubscriptionIn) -> dict:
        if not db.get("subscriptions", sid):
            raise HTTPException(404, "Eintrag nicht gefunden")
        db.update("subscriptions", sid, validate(data))
        return next(r for r in list_enriched(db, data.customer_id) if r["id"] == sid)

    @app.delete("/api/subscriptions/{sid}", dependencies=[Depends(admin_only)])
    def delete_sub(sid: int) -> dict:
        if not db.delete("subscriptions", sid):
            raise HTTPException(404, "Eintrag nicht gefunden")
        return {"ok": True}
