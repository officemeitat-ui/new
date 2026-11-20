"""Einsatzplanung: Termine je Techniker, Kunde und Ticket – mit Kalender-Abo und Terminbestätigung.

- Termine (vor Ort, Fernwartung, Telefon, intern) mit Techniker, Kunde, Ticket, Ort und Dauer.
- Überschneidungen beim selben Techniker werden gemeldet (nicht verboten – manchmal ist es Absicht).
- Kalender-Abo (iCalendar) für Outlook, iPhone und Android: eigener, geheimer Link je Benutzer oder fürs Team.
- Terminbestätigung an den Kunden per E-Mail mit Kalenderdatei; Verschiebung und Absage ebenso.
- „Erledigt“ bucht die Zeit direkt auf Kunde/Ticket.
- Der Kunde sieht seine nächsten Termine im Portal.

Zeiten werden als Ortszeit des Servers gespeichert; in Kalenderdateien stehen sie in Weltzeit (UTC),
damit jedes Gerät sie richtig anzeigt – auch über die Zeitumstellung hinweg.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .db import Database, now_iso

KINDS = {"vor_ort": "Vor Ort", "remote": "Fernwartung", "telefon": "Telefon", "intern": "Intern"}
STATUSES = {"geplant": "geplant", "bestaetigt": "bestätigt", "erledigt": "erledigt", "abgesagt": "abgesagt"}
WHEN = r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$"
DAY = r"^\d{4}-\d{2}-\d{2}$"
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def parse_when(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("T", " ")[:19] if len(value) > 16 else value.replace("T", " ") + ":00")


def fmt(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat(sep=" ")


def human(start: datetime, end: datetime) -> str:
    """„Dienstag, 24.11.2026, 09:00–10:30 Uhr“"""
    return f"{WEEKDAYS[start.weekday()]}, {start.strftime('%d.%m.%Y, %H:%M')}–{end.strftime('%H:%M')} Uhr"


def feed_hash(token: str) -> str:
    return hashlib.sha256(("meit-calendar|" + token).encode()).hexdigest()


# ----------------------------------------------------------------------------- iCalendar
def ics_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")


def ics_fold(line: str) -> str:
    """Zeilen nach 75 Bytes umbrechen (Vorgabe des Formats) – ohne ein Zeichen zu zerteilen."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, current, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > (75 if not parts else 74):
            parts.append(current)
            current, size = "", 0
        current += ch
        size += n
    parts.append(current)
    return "\r\n ".join(parts)


def utc_stamp(local: str | datetime) -> str:
    dt = datetime.fromisoformat(local[:19]) if isinstance(local, str) else local
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ics_event(a: dict[str, Any], host: str = "cockpit", public: bool = False) -> list[str]:
    """Ein Termin als VEVENT. ``public`` = für den Kunden: ohne interne Notizen, mit dem Hinweis für ihn."""
    kind = KINDS.get(a["kind"], a["kind"])
    desc = [f"Art: {kind}"]
    if a.get("user_name"):
        desc.append(f"Techniker: {a['user_name']}")
    if a.get("ticket_id"):
        desc.append(f"Ticket #{a['ticket_id']}" + (f": {a['ticket_title']}" if a.get("ticket_title") else ""))
    if a.get("customer_note"):
        desc.append(a["customer_note"])
    summary = a["title"] if public or not a.get("customer") else f"{a['title']} – {a['customer']}"
    lines = ["BEGIN:VEVENT", f"UID:{a['uid']}@{host}", f"DTSTAMP:{utc_stamp(datetime.now())}", f"DTSTART:{utc_stamp(a['start_at'])}",
             f"DTEND:{utc_stamp(a['end_at'])}", f"SUMMARY:{ics_escape(summary)}", f"DESCRIPTION:{ics_escape(chr(10).join(desc))}",
             f"SEQUENCE:{a.get('sequence') or 0}",
             f"STATUS:{'CANCELLED' if a['status'] == 'abgesagt' else 'CONFIRMED' if a['status'] in ('bestaetigt', 'erledigt') else 'TENTATIVE'}"]
    if a.get("location"):
        lines.append(f"LOCATION:{ics_escape(a['location'])}")
    lines.append("END:VEVENT")
    return lines


def ics_calendar(events: list[dict[str, Any]], name: str, host: str = "cockpit", public: bool = False, method: str = "PUBLISH") -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ME-IT Cockpit//Einsatzplanung//DE", "CALSCALE:GREGORIAN", f"METHOD:{method}",
             f"X-WR-CALNAME:{ics_escape(name)}", "X-PUBLISHED-TTL:PT30M", "REFRESH-INTERVAL;VALUE=DURATION:PT30M"]
    for a in events:
        lines += ics_event(a, host, public)
    lines.append("END:VCALENDAR")
    return "\r\n".join(ics_fold(line) for line in lines) + "\r\n"


# ----------------------------------------------------------------------------- Modelle
class AppointmentIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    customer_id: Optional[int] = None
    ticket_id: Optional[int] = None
    user_id: Optional[int] = None
    kind: str = Field("vor_ort", pattern="^(vor_ort|remote|telefon|intern)$")
    start_at: str = Field(pattern=WHEN)
    duration_min: int = Field(60, ge=5, le=24 * 60)
    location: str = Field("", max_length=300)
    notes: str = Field("", max_length=2000)
    customer_note: str = Field("", max_length=1000)


class AppointmentPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=160)
    customer_id: Optional[int] = None
    ticket_id: Optional[int] = None
    user_id: Optional[int] = None
    kind: Optional[str] = Field(None, pattern="^(vor_ort|remote|telefon|intern)$")
    start_at: Optional[str] = Field(None, pattern=WHEN)
    duration_min: Optional[int] = Field(None, ge=5, le=24 * 60)
    location: Optional[str] = Field(None, max_length=300)
    notes: Optional[str] = Field(None, max_length=2000)
    customer_note: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field(None, pattern="^(geplant|bestaetigt|erledigt|abgesagt)$")


class CompleteIn(BaseModel):
    book_time: bool = True
    minutes: Optional[int] = Field(None, ge=1, le=24 * 60)
    description: str = Field("", max_length=500)
    billable: Optional[bool] = None


class NotifyIn(BaseModel):
    to: str = Field("", max_length=200)
    message: str = Field("", max_length=1000)


class FeedIn(BaseModel):
    scope: str = Field("own", pattern="^(own|team)$")


# ----------------------------------------------------------------------------- Dienst
class Planner:
    SELECT = ("SELECT a.*, c.name AS customer, u.name AS user_name, t.title AS ticket_title FROM appointments a "
              "LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tickets t ON t.id = a.ticket_id ")

    def __init__(self, db: Database):
        self.db = db

    def get(self, aid: int) -> dict[str, Any] | None:
        return self.db.query_one(self.SELECT + "WHERE a.id = ?", (aid,))

    def conflicts(self, a: dict[str, Any]) -> list[dict[str, Any]]:
        """Andere Termine desselben Technikers, die sich zeitlich überschneiden."""
        if not a.get("user_id") or a["status"] == "abgesagt":
            return []
        return self.db.query("SELECT a.id, a.title, a.start_at, a.end_at, c.name AS customer FROM appointments a "
                             "LEFT JOIN customers c ON c.id = a.customer_id WHERE a.user_id = ? AND a.id != ? AND a.status != 'abgesagt' "
                             "AND a.start_at < ? AND a.end_at > ? ORDER BY a.start_at", (a["user_id"], a["id"], a["end_at"], a["start_at"]))

    def view(self, a: dict[str, Any], with_conflicts: bool = True) -> dict[str, Any]:
        start, end = datetime.fromisoformat(a["start_at"]), datetime.fromisoformat(a["end_at"])
        out = {k: a[k] for k in ("id", "customer_id", "ticket_id", "user_id", "title", "kind", "start_at", "end_at", "location", "notes",
                                 "customer_note", "status", "notified_at", "notified_to", "time_entry_id", "created_at")}
        out.update({"customer": a.get("customer") or "", "user_name": a.get("user_name") or "", "ticket_title": a.get("ticket_title") or "",
                    "duration_min": int((end - start).total_seconds() // 60), "kind_label": KINDS.get(a["kind"], a["kind"]),
                    "status_label": STATUSES.get(a["status"], a["status"]), "when": human(start, end),
                    "conflicts": self.conflicts(a) if with_conflicts else []})
        return out

    def check_refs(self, data: dict[str, Any]) -> None:
        if data.get("customer_id") and not self.db.get("customers", data["customer_id"]):
            raise LookupError("Kunde nicht gefunden")
        if data.get("ticket_id") and not self.db.get("tickets", data["ticket_id"]):
            raise LookupError("Ticket nicht gefunden")
        if data.get("user_id"):
            u = self.db.get("users", data["user_id"])
            if not u or not u["active"]:
                raise LookupError("Techniker nicht gefunden")

    def create(self, data: AppointmentIn, created_by: int | None) -> dict[str, Any]:
        d = data.model_dump()
        self.check_refs(d)
        start = parse_when(d.pop("start_at"))
        end = start + timedelta(minutes=d.pop("duration_min"))
        if d["ticket_id"] and not d["customer_id"]:
            d["customer_id"] = self.db.get("tickets", d["ticket_id"])["customer_id"]
        if d["kind"] == "vor_ort" and not d["location"] and d["customer_id"]:
            d["location"] = (self.db.get("customers", d["customer_id"])["address"] or "").replace("\n", ", ")
        aid = self.db.insert("appointments", {**d, "uid": secrets.token_hex(12), "start_at": fmt(start), "end_at": fmt(end),
                                              "status": "geplant", "created_by": created_by})
        return self.get(aid)

    def update(self, aid: int, patch: AppointmentPatch) -> dict[str, Any] | None:
        a = self.db.get("appointments", aid)
        if not a:
            return None
        d = patch.model_dump(exclude_unset=True)
        self.check_refs(d)
        start = parse_when(d.pop("start_at")) if d.get("start_at") else datetime.fromisoformat(a["start_at"])
        d.pop("start_at", None)
        old_minutes = int((datetime.fromisoformat(a["end_at"]) - datetime.fromisoformat(a["start_at"])).total_seconds() // 60)
        minutes = d.pop("duration_min", None) or old_minutes
        d.update({"start_at": fmt(start), "end_at": fmt(start + timedelta(minutes=minutes))})
        moved = d["start_at"] != a["start_at"] or d["end_at"] != a["end_at"] or d.get("location", a["location"]) != a["location"]
        if moved or (d.get("status") and d["status"] != a["status"]):
            d["sequence"] = (a["sequence"] or 0) + 1  # Kalenderprogramme erkennen daran die neuere Fassung
        self.db.update("appointments", aid, d)
        return self.get(aid)

    def list(self, start: str, end: str, user_id: int | None = None, customer_id: int | None = None,
             unassigned: bool = False) -> list[dict[str, Any]]:
        sql, params = self.SELECT + "WHERE a.start_at < ? AND a.end_at >= ?", [f"{end} 23:59:59", f"{start} 00:00:00"]
        if unassigned:
            sql += " AND a.user_id IS NULL"
        elif user_id:
            sql, params = sql + " AND a.user_id = ?", params + [user_id]
        if customer_id:
            sql, params = sql + " AND a.customer_id = ?", params + [customer_id]
        return self.db.query(sql + " ORDER BY a.start_at, a.id", params)

    def portal_rows(self, customer_id: int) -> list[dict[str, Any]]:
        """Kommende Termine eines Kunden fürs Portal – ohne interne und abgesagte."""
        since = fmt(datetime.now() - timedelta(hours=2))
        return self.db.query(self.SELECT + "WHERE a.customer_id = ? AND a.end_at >= ? AND a.kind != 'intern' AND a.status != 'abgesagt' "
                             "ORDER BY a.start_at LIMIT 20", (customer_id, since))

    @staticmethod
    def portal_view(a: dict[str, Any]) -> dict[str, Any]:
        start, end = datetime.fromisoformat(a["start_at"]), datetime.fromisoformat(a["end_at"])
        return {"id": a["id"], "title": a["title"], "when": human(start, end), "start_at": a["start_at"], "end_at": a["end_at"],
                "kind": KINDS.get(a["kind"], a["kind"]), "location": a["location"], "technician": (a["user_name"] or "").split(" ")[0],
                "note": a["customer_note"], "status": STATUSES.get(a["status"], a["status"]), "ticket_id": a["ticket_id"]}

    def feed_events(self, user_id: int | None) -> list[dict[str, Any]]:
        since = fmt(datetime.now() - timedelta(days=30))
        until = fmt(datetime.now() + timedelta(days=365))
        sql, params = self.SELECT + "WHERE a.end_at >= ? AND a.start_at <= ?", [since, until]
        if user_id:
            sql, params = sql + " AND a.user_id = ?", params + [user_id]
        return self.db.query(sql + " ORDER BY a.start_at LIMIT 2000", params)


def register(app: FastAPI, ctx: Any, settings: Any) -> Planner:
    db: Database = ctx.db
    svc = Planner(db)
    app.state.planner = svc
    company = getattr(settings, "company_name", "ME-IT")

    def user_of(request: Request) -> dict[str, Any] | None:
        u = getattr(request.state, "user", None)
        return u if isinstance(u, dict) else None

    def base_url(request: Request) -> str:
        return (getattr(settings, "public_url", "") or str(request.base_url)).rstrip("/")

    def host_of(request: Request) -> str:
        return re.sub(r"^https?://", "", base_url(request)).split("/")[0].split(":")[0] or "cockpit"

    def need(aid: int) -> dict[str, Any]:
        a = svc.get(aid)
        if not a:
            raise HTTPException(404, "Termin nicht gefunden")
        return a

    def tell_technician(a: dict[str, Any], actor: dict[str, Any] | None, what: str) -> None:
        """Dem zugeteilten Techniker Bescheid geben – außer er hat den Termin selbst angelegt/geändert."""
        notifier = getattr(app.state, "notifier", None)
        if not notifier or not a["user_id"] or (actor and actor.get("id") == a["user_id"]):
            return
        start, end = datetime.fromisoformat(a["start_at"]), datetime.fromisoformat(a["end_at"])
        try:
            notifier.emit("termin", f"{what}: {a['title']}", f"{human(start, end)}" + (f" · {a['customer']}" if a["customer"] else ""),
                          link=f"termine?datum={a['start_at'][:10]}", user_id=a["user_id"], ref=f"termin-{a['id']}-{a['sequence']}-{what}")
        except Exception:  # noqa: BLE001 - die Meldung darf das Speichern nicht verhindern
            pass

    # --- Termine ---------------------------------------------------------------------------------
    @app.get("/api/appointments")
    def list_appointments(start: str = "", end: str = "", user_id: int = 0, customer_id: int = 0, unassigned: bool = False) -> dict:
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        start = start if re.match(DAY, start) else monday.isoformat()
        end = end if re.match(DAY, end) else (date.fromisoformat(start) + timedelta(days=6)).isoformat()
        if end < start or (date.fromisoformat(end) - date.fromisoformat(start)).days > 400:
            raise HTTPException(422, "Zeitraum ungültig")
        rows = [svc.view(a) for a in svc.list(start, end, user_id or None, customer_id or None, unassigned)]
        return {"start": start, "end": end, "items": rows, "kinds": KINDS, "statuses": STATUSES,
                "users": db.query("SELECT id, name FROM users WHERE active = 1 ORDER BY name")}

    @app.post("/api/appointments", status_code=201)
    def create(data: AppointmentIn, request: Request) -> dict:
        actor = user_of(request)
        try:
            a = svc.create(data, (actor or {}).get("id"))
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        tell_technician(a, actor, "Neuer Termin")
        return svc.view(a)

    @app.get("/api/appointments/{aid}")
    def one(aid: int) -> dict:
        return svc.view(need(aid))

    @app.put("/api/appointments/{aid}")
    def update(aid: int, data: AppointmentPatch, request: Request) -> dict:
        before = need(aid)
        try:
            a = svc.update(aid, data)
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        if a["user_id"] != before["user_id"]:
            tell_technician(a, user_of(request), "Neuer Termin")
        elif a["start_at"] != before["start_at"] or a["end_at"] != before["end_at"]:
            tell_technician(a, user_of(request), "Termin verschoben")
        elif a["status"] == "abgesagt" and before["status"] != "abgesagt":
            tell_technician(a, user_of(request), "Termin abgesagt")
        changed = a["start_at"] != before["start_at"] or a["end_at"] != before["end_at"] or \
            (a["status"] == "abgesagt" and before["status"] != "abgesagt")
        # Der Kunde hat schon eine Bestätigung bekommen und der Termin hat sich geändert → Oberfläche fragt nach
        return {**svc.view(a), "customer_needs_update": bool(before["notified_at"]) and changed}

    @app.delete("/api/appointments/{aid}")
    def delete(aid: int) -> dict:
        need(aid)
        db.delete("appointments", aid)
        return {"ok": True}

    @app.post("/api/appointments/{aid}/complete")
    def complete(aid: int, data: CompleteIn, request: Request) -> dict:
        from .billing import add_time

        a = need(aid)
        if a["status"] == "abgesagt":
            raise HTTPException(409, "Ein abgesagter Termin kann nicht erledigt werden.")
        patch: dict[str, Any] = {"status": "erledigt"}
        if data.book_time and not a["time_entry_id"]:
            if not a["customer_id"]:
                raise HTTPException(422, "Zeit buchen geht nur mit Kunde – Termin ohne Zeitbuchung abschließen oder Kunde eintragen.")
            start, end = datetime.fromisoformat(a["start_at"]), datetime.fromisoformat(a["end_at"])
            minutes = data.minutes or int((end - start).total_seconds() // 60)
            actor = user_of(request)
            patch["time_entry_id"] = add_time(db, customer_id=a["customer_id"], minutes=minutes,
                                              description=data.description or f"{KINDS.get(a['kind'], a['kind'])}: {a['title']}",
                                              ticket_id=a["ticket_id"], user_id=a["user_id"] or (actor or {}).get("id"),
                                              day=a["start_at"][:10], billable=data.billable)
        db.update("appointments", aid, patch)
        return svc.view(need(aid))

    @app.post("/api/appointments/{aid}/notify")
    def notify_customer(aid: int, data: NotifyIn, request: Request) -> dict:
        """Terminbestätigung (oder Verschiebung/Absage) an den Kunden – mit Kalenderdatei im Anhang."""
        from .mail import Attachment

        a = need(aid)
        customer = db.get("customers", a["customer_id"]) if a["customer_id"] else None
        to = (data.to or (customer or {}).get("email") or "").strip()
        if not EMAIL.match(to):
            raise HTTPException(422, "Keine E-Mail-Adresse – beim Kunden hinterlegen oder hier angeben.")
        mailer = getattr(ctx, "mailer", None)
        if not (mailer and getattr(mailer, "smtp_configured", False)):
            raise HTTPException(409, "Kein Mailversand eingerichtet (Postfach verbinden).")
        start, end = datetime.fromisoformat(a["start_at"]), datetime.fromisoformat(a["end_at"])
        cancelled, again = a["status"] == "abgesagt", bool(a["notified_at"])
        subject = (f"Termin abgesagt: {a['title']}" if cancelled else f"Termin geändert: {a['title']}" if again else f"Terminbestätigung: {a['title']}")
        hello = f"Guten Tag{' ' + customer['contact_name'] if customer and customer['contact_name'] else ''},"
        lines = [hello, ""]
        if cancelled:
            lines += [f"der folgende Termin findet leider nicht statt: {human(start, end)}.", "Wir melden uns mit einem neuen Vorschlag."]
        else:
            lines += ["wir haben den Termin verschoben. Neu:" if again else "hiermit bestätigen wir unseren Termin:", "",
                      f"  {human(start, end)}", f"  {KINDS.get(a['kind'], a['kind'])}" + (f" – {a['location']}" if a["location"] else "")]
            if a["user_name"]:
                lines.append(f"  Ihr Techniker: {a['user_name']}")
            if a["customer_note"]:
                lines += ["", a["customer_note"]]
            lines += ["", "Im Anhang finden Sie den Termin für Ihren Kalender. Passt er nicht, antworten Sie einfach auf diese E-Mail."]
        if data.message.strip():
            lines += ["", data.message.strip()]
        lines += ["", "Freundliche Grüße", company]
        ics = ics_calendar([a], f"Termin {company}", host_of(request), public=True)
        try:
            mailer.send(to, subject, "\n".join(lines), attachments=[Attachment("Termin.ics", ics.encode("utf-8"), "text/calendar")])
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Versand fehlgeschlagen: {exc}")
        patch = {"notified_at": now_iso(), "notified_to": to}
        if a["status"] == "geplant":
            patch["status"] = "bestaetigt"
        db.update("appointments", aid, patch)
        return {**svc.view(need(aid)), "sent_to": to, "subject": subject}

    @app.get("/api/appointments/{aid}/ics")
    def one_ics(aid: int, request: Request) -> Response:
        a = need(aid)
        return Response(ics_calendar([a], "Termin", host_of(request)), media_type="text/calendar; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="Termin-{aid}.ics"'})

    # --- Kalender-Abo ------------------------------------------------------------------------------
    @app.get("/api/calendar/feeds")
    def feeds(request: Request) -> dict:
        u = user_of(request)
        rows = db.query("SELECT scope, created_at, last_used_at FROM calendar_feeds WHERE user_id = ? ORDER BY scope", ((u or {}).get("id") or 0,))
        return {"feeds": rows, "has_users": bool(u)}

    @app.post("/api/calendar/feeds", status_code=201)
    def new_feed(data: FeedIn, request: Request) -> dict:
        """Geheimen Abo-Link erzeugen (ein vorhandener wird ersetzt und damit ungültig)."""
        u = user_of(request)
        uid = (u or {}).get("id") or 0
        scope = data.scope if u else "team"  # ohne Benutzerkonten gibt es nur den Team-Kalender
        token = secrets.token_urlsafe(32)
        db.query("DELETE FROM calendar_feeds WHERE user_id = ? AND scope = ?", (uid, scope))
        db.insert("calendar_feeds", {"user_id": uid, "scope": scope, "token_hash": feed_hash(token), "last_used_at": ""})
        url = f"{base_url(request)}/api/public/calendar.ics?token={token}"
        return {"scope": scope, "url": url, "webcal": re.sub(r"^https?://", "webcal://", url)}

    @app.delete("/api/calendar/feeds/{scope}")
    def drop_feed(scope: str, request: Request) -> dict:
        u = user_of(request)
        db.query("DELETE FROM calendar_feeds WHERE user_id = ? AND scope = ?", ((u or {}).get("id") or 0, scope))
        return {"ok": True}

    @app.get("/api/public/calendar.ics", include_in_schema=False)
    def feed(request: Request, token: str = "") -> Response:
        row = db.query_one("SELECT * FROM calendar_feeds WHERE token_hash = ?", (feed_hash(token),)) if len(token) >= 20 else None
        if not row:
            raise HTTPException(404, "Kalender nicht gefunden")
        user = db.get("users", row["user_id"]) if row["user_id"] else None
        if row["user_id"] and not (user and user["active"]):
            raise HTTPException(404, "Kalender nicht gefunden")  # deaktivierte Benutzer verlieren ihr Abo sofort
        db.query("UPDATE calendar_feeds SET last_used_at = ? WHERE id = ?", (now_iso(), row["id"]))
        own = row["scope"] == "own" and user
        events = svc.feed_events(user["id"] if own else None)
        name = f"{company} – {user['name']}" if own else f"{company} – Einsätze"
        return Response(ics_calendar(events, name, host_of(request)), media_type="text/calendar; charset=utf-8",
                        headers={"Cache-Control": "no-store", "Content-Disposition": 'inline; filename="einsaetze.ics"'})

    return svc
