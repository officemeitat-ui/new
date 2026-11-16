"""SLA-Tracking: garantierte Reaktions- und Lösungszeiten je Paket – messbar statt versprochen.

* Zeiten in Geschäftszeiten (Standard Mo–Fr 8–17 Uhr), je Paket und Priorität konfigurierbar.
* Reaktion = erste Rückmeldung (Statuswechsel weg von „neu“ oder versendete Antwort).
* Ampel je offenem Ticket, Erfüllungsquote je Kunde für Berichte, QBR und Health Score.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from .db import Database

# Stunden (Geschäftszeit) – reaction / resolution je Paket und Priorität. None = keine Zusage.
DEFAULT_SLA: dict[str, Any] = {
    "business_hours": {"start": 8, "end": 17, "days": [0, 1, 2, 3, 4]},
    "packages": {
        "premium": {"kritisch": [1, 4], "hoch": [2, 8], "normal": [4, 16], "niedrig": [8, 40]},
        "pro": {"kritisch": [2, 8], "hoch": [4, 16], "normal": [8, 24], "niedrig": [16, 72]},
        "basis": {"kritisch": [4, 16], "hoch": [8, 24], "normal": [16, 40], "niedrig": [24, 80]},
        "keins": {"kritisch": [8, None], "hoch": [16, None], "normal": [None, None], "niedrig": [None, None]},
    },
}


def sla_config(db: Database) -> dict[str, Any]:
    stored = db.get_setting("sla_config", {}) or {}
    cfg = {"business_hours": {**DEFAULT_SLA["business_hours"], **(stored.get("business_hours") or {})},
           "packages": {k: {**v, **((stored.get("packages") or {}).get(k) or {})} for k, v in DEFAULT_SLA["packages"].items()}}
    return cfg


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace(" ", "T")[:19])
    except ValueError:
        return None


def add_business_hours(start: datetime, hours: float, bh: dict[str, Any]) -> datetime:
    """Zeitpunkt, an dem `hours` Geschäftsstunden nach `start` erreicht sind."""
    remaining = timedelta(hours=hours)
    cur = start
    for _ in range(3700):  # Sicherheitsgrenze (~10 Jahre Tage)
        day_start = cur.replace(hour=bh["start"], minute=0, second=0, microsecond=0)
        day_end = cur.replace(hour=bh["end"], minute=0, second=0, microsecond=0)
        if cur.weekday() in bh["days"] and cur < day_end:
            begin = max(cur, day_start)
            available = day_end - begin
            if remaining <= available:
                return begin + remaining
            remaining -= available
        cur = (cur + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return cur


def business_hours_between(start: datetime, end: datetime, bh: dict[str, Any]) -> float:
    if end <= start:
        return 0.0
    total = timedelta()
    cur = start
    while cur < end:
        day_start = cur.replace(hour=bh["start"], minute=0, second=0, microsecond=0)
        day_end = cur.replace(hour=bh["end"], minute=0, second=0, microsecond=0)
        if cur.weekday() in bh["days"]:
            a, b = max(cur, day_start), min(end, day_end)
            if b > a:
                total += b - a
        cur = (cur + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return total.total_seconds() / 3600


def ticket_sla(ticket: dict[str, Any], package: str, cfg: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    bh = cfg["business_hours"]
    targets = cfg["packages"].get(package or "keins", cfg["packages"]["keins"]).get(ticket.get("priority") or "normal", [None, None])
    created = _parse(ticket.get("created_at")) or now
    responded = _parse(ticket.get("first_response_at"))
    resolved = _parse(ticket.get("resolved_at")) if ticket.get("status") == "geloest" else None
    out: dict[str, Any] = {"package": package, "priority": ticket.get("priority")}
    for key, target, done in (("response", targets[0], responded or resolved), ("resolution", targets[1], resolved)):
        if target is None:
            out[key] = {"target_h": None, "state": "keine Zusage"}
            continue
        due = add_business_hours(created, float(target), bh)
        if done:
            state = "erfüllt" if done <= due else "verletzt"
            out[key] = {"target_h": target, "due": due.isoformat(sep=" ", timespec="minutes"), "state": state,
                        "took_h": round(business_hours_between(created, done, bh), 1)}
        else:
            left = business_hours_between(now, due, bh) if now < due else -business_hours_between(due, now, bh)
            state = "verletzt" if now > due else ("knapp" if left <= max(0.5, 0.25 * target) else "ok")
            out[key] = {"target_h": target, "due": due.isoformat(sep=" ", timespec="minutes"), "state": state,
                        "left_h": round(left, 1)}
    return out


def sla_overview(db: Database, days: int = 30, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now()
    cfg = sla_config(db)
    since = (now - timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    rows = db.query(
        "SELECT t.*, c.name AS customer_name, COALESCE(c.package, 'keins') AS package FROM tickets t "
        "LEFT JOIN customers c ON c.id = t.customer_id WHERE t.status != 'geloest' OR t.created_at >= ?", (since,))
    open_tickets, per_customer = [], {}
    for t in rows:
        s = ticket_sla(t, t["package"], cfg, now)
        if t["status"] != "geloest":
            open_tickets.append({"id": t["id"], "title": t["title"], "customer": t["customer_name"], "priority": t["priority"],
                                 "status": t["status"], "sla": s})
        if t["created_at"] >= since and t["customer_id"]:
            pc = per_customer.setdefault(t["customer_id"], {"customer_id": t["customer_id"], "customer": t["customer_name"],
                                                             "package": t["package"], "tickets": 0, "measured": 0, "met": 0,
                                                             "breached": 0})
            pc["tickets"] += 1
            for key in ("response", "resolution"):
                state = s[key]["state"]
                if state in ("erfüllt", "verletzt"):  # offene, überfällige Tickets zählen als verletzt
                    pc["measured"] += 1
                    pc["met"] += state == "erfüllt"
                    pc["breached"] += state == "verletzt"
    for pc in per_customer.values():
        pc["quote"] = round(100 * pc["met"] / pc["measured"], 1) if pc["measured"] else None
    order = {"verletzt": 0, "knapp": 1, "ok": 2, "erfüllt": 3, "keine Zusage": 4}
    open_tickets.sort(key=lambda x: min(order.get(x["sla"]["response"]["state"], 5), order.get(x["sla"]["resolution"]["state"], 5)))
    measured = sum(p["measured"] for p in per_customer.values())
    met = sum(p["met"] for p in per_customer.values())
    return {
        "days": days, "open": open_tickets,
        "breached_open": sum(1 for t in open_tickets if "verletzt" in (t["sla"]["response"]["state"], t["sla"]["resolution"]["state"])),
        "at_risk_open": sum(1 for t in open_tickets if "knapp" in (t["sla"]["response"]["state"], t["sla"]["resolution"]["state"])),
        "customers": sorted(per_customer.values(), key=lambda p: (p["quote"] if p["quote"] is not None else 101)),
        "quote": round(100 * met / measured, 1) if measured else None, "config": cfg,
    }


def customer_sla_quote(db: Database, customer: dict[str, Any], days: int = 90, now: datetime | None = None) -> dict[str, Any]:
    """SLA-Erfüllung eines Kunden (für Health Score, Bericht, QBR)."""
    now = now or datetime.now()
    cfg = sla_config(db)
    since = (now - timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ")
    measured = met = breached = 0
    for t in db.query("SELECT * FROM tickets WHERE customer_id = ? AND created_at >= ?", (customer["id"], since)):
        s = ticket_sla(t, customer.get("package") or "keins", cfg, now)
        for key in ("response", "resolution"):
            if s[key]["state"] in ("erfüllt", "verletzt"):
                measured += 1
                met += s[key]["state"] == "erfüllt"
                breached += s[key]["state"] == "verletzt"
    return {"measured": measured, "met": met, "breached": breached,
            "quote": round(100 * met / measured, 1) if measured else None}


class SlaConfigIn(BaseModel):
    business_hours: Optional[dict[str, Any]] = None
    packages: Optional[dict[str, dict[str, list[Optional[float]]]]] = None


def register(app: FastAPI, db: Database, admin_only) -> None:
    @app.get("/api/sla")
    def get_sla(days: int = 30) -> dict:
        return sla_overview(db, days=max(1, min(days, 365)))

    @app.put("/api/sla/config", dependencies=[Depends(admin_only)])
    def set_sla(data: SlaConfigIn) -> dict:
        stored = db.get_setting("sla_config", {}) or {}
        if data.business_hours:
            bh = {k: v for k, v in data.business_hours.items() if k in ("start", "end", "days")}
            if "start" in bh and "end" in bh and not (0 <= int(bh["start"]) < int(bh["end"]) <= 24):
                from fastapi import HTTPException
                raise HTTPException(422, "Geschäftszeiten ungültig")
            stored["business_hours"] = {**(stored.get("business_hours") or {}), **bh}
        if data.packages:
            pk = stored.get("packages") or {}
            for name, prios in data.packages.items():
                if name in DEFAULT_SLA["packages"]:
                    pk[name] = {**pk.get(name, {}), **{p: v for p, v in prios.items()
                                                       if p in ("kritisch", "hoch", "normal", "niedrig") and len(v) == 2}}
            stored["packages"] = pk
        db.set_setting("sla_config", stored)
        return sla_config(db)
