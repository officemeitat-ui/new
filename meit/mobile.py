"""Unterwegs arbeiten: Stoppuhr für Zeiterfassung und das Cockpit als App am Handy (PWA).

* **Stoppuhr**: je Benutzer eine laufende Uhr (Ticket oder Kunde). Stopp → Zeiteintrag (inkl. Ticketzeit);
  wer eine neue Uhr startet, bucht die laufende automatisch. Keine vergessenen Minuten mehr.
* **App**: Web-App-Manifest + Service Worker → „Zum Startbildschirm hinzufügen“ (Android/iOS/Windows).
  Der Service Worker speichert nur die Oberfläche (HTML/CSS/JS/Logo/Schrift) – nie Kundendaten aus /api/.
"""

from __future__ import annotations

import math
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from .db import Database, now_iso

ICONS = {"icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"}


class StartIn(BaseModel):
    ticket_id: Optional[int] = None
    customer_id: Optional[int] = None
    note: str = Field("", max_length=300)


class StopIn(BaseModel):
    description: Optional[str] = Field(None, max_length=500)
    minutes: Optional[int] = Field(None, ge=1, le=1440)
    billable: Optional[bool] = None
    customer_id: Optional[int] = None


def _uid(request: Request) -> int | None:
    user = getattr(request.state, "user", None)
    return user["id"] if user else None


def current_timer(db: Database, user_id: int | None) -> dict[str, Any] | None:
    sql = ("SELECT tm.*, t.title AS ticket_title, c.name AS customer_name FROM timers tm "
           "LEFT JOIN tickets t ON t.id = tm.ticket_id LEFT JOIN customers c ON c.id = tm.customer_id WHERE ")
    row = db.query_one(sql + ("tm.user_id = ?" if user_id else "tm.user_id IS NULL"), (user_id,) if user_id else ())
    if row:
        row["elapsed_s"] = max(0, int((datetime.now() - datetime.fromisoformat(row["started_at"])).total_seconds()))
    return row


def stop_timer(db: Database, user_id: int | None, data: StopIn | None = None) -> dict[str, Any]:
    from .billing import add_time

    data = data or StopIn()
    t = current_timer(db, user_id)
    if not t:
        raise ValueError("Keine Stoppuhr läuft")
    customer_id = t["customer_id"] or data.customer_id
    if not customer_id:
        raise ValueError("Kunde angeben – die Zeit muss einem Kunden zugeordnet werden")
    minutes = data.minutes or max(1, math.ceil(t["elapsed_s"] / 60))
    desc = data.description if data.description is not None else (t["note"] or t["ticket_title"] or "Arbeitszeit")
    entry_id = add_time(db, customer_id=customer_id, minutes=minutes, description=desc, ticket_id=t["ticket_id"],
                        user_id=user_id, billable=data.billable)
    db.delete("timers", t["id"])
    return db.get("time_entries", entry_id)


def register(app: FastAPI, db: Database, static_dir: Path, branding) -> None:
    @app.get("/api/timer")
    def get_timer(request: Request) -> dict:
        return {"timer": current_timer(db, _uid(request))}

    @app.post("/api/timer/start", status_code=201)
    def start(data: StartIn, request: Request) -> dict:
        uid = _uid(request)
        customer_id = data.customer_id
        if data.ticket_id:
            ticket = db.get("tickets", data.ticket_id)
            if not ticket:
                raise HTTPException(404, "Ticket nicht gefunden")
            customer_id = customer_id or ticket["customer_id"]
        if customer_id and not db.get("customers", customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        booked = None
        if current_timer(db, uid):
            try:
                booked = stop_timer(db, uid)  # laufende Uhr wird gebucht, nicht verworfen
            except ValueError:
                db.query("DELETE FROM timers WHERE " + ("user_id = ?" if uid else "user_id IS NULL"), (uid,) if uid else ())
        db.insert("timers", {"user_id": uid, "ticket_id": data.ticket_id, "customer_id": customer_id,
                             "note": data.note, "started_at": now_iso()})
        if data.ticket_id:
            db.query("UPDATE tickets SET status = 'in_arbeit' WHERE id = ? AND status = 'neu'", (data.ticket_id,))
        return {"timer": current_timer(db, uid), "booked": booked}

    @app.post("/api/timer/stop")
    def stop(data: StopIn, request: Request) -> dict:
        try:
            return {"entry": stop_timer(db, _uid(request), data)}
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.delete("/api/timer")
    def discard(request: Request) -> dict:
        uid = _uid(request)
        db.query("DELETE FROM timers WHERE " + ("user_id = ?" if uid else "user_id IS NULL"), (uid,) if uid else ())
        return {"ok": True}

    # ------------------------------------------------------------------ PWA
    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest() -> JSONResponse:
        b = branding()
        return JSONResponse({
            "name": f"{b.get('name') or 'ME-IT'} Cockpit", "short_name": b.get("name") or "ME-IT",
            "description": "Tickets, Kunden, Wartung, Zeiterfassung und KI-Mitarbeiter",
            "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any", "lang": "de",
            "background_color": "#ffffff", "theme_color": b.get("brand") or "#00bcd4",
            "icons": [{"src": "/brand/icon.png", "sizes": "192x192", "type": "image/png"},
                      {"src": "/brand/icon-512.png", "sizes": "512x512", "type": "image/png"},
                      {"src": "/brand/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
            "shortcuts": [{"name": "Neues Ticket", "url": "/#/tickets?neu=1"}, {"name": "Wartung", "url": "/#/wartung"},
                          {"name": "Posteingang", "url": "/#/posteingang"}],
        }, media_type="application/manifest+json", headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/brand/{name}", include_in_schema=False)
    def brand_icon(name: str) -> FileResponse:
        if name not in ICONS:
            raise HTTPException(404, "Nicht gefunden")
        return FileResponse(static_dir / "brand" / name, headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/sw.js", include_in_schema=False)
    def service_worker() -> Response:
        version = int(max((static_dir / f).stat().st_mtime for f in ("app.js", "style.css", "index.html")))
        body = (static_dir / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", str(version))
        return Response(body, media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})
