"""Atera (RMM/PSA mit Splashtop-Fernzugriff).

Abgleich über die Atera-API v3 (``X-API-KEY``):
* Kunden → Kunden (Zuordnung per Name, gespeichert), fehlende optional anlegen
* Agents → Geräte (Name, Typ, Betriebssystem, Seriennummer, zuletzt gesehen, **Link zur Atera-Geräteseite**,
  von dort startet der Techniker Splashtop)
* offene Alarme → Tickets (optional, jeder Alarm nur einmal)

Fernwartungs-Nachweis: Jede Splashtop-Sitzung wird in Atera/Splashtop protokolliert (Beginn, Ende, Techniker,
Gerät). Der Export (CSV) wird hier importiert und automatisch zugeordnet:
Gerät → Kunde → offene/erledigte Wartung im Zeitfenster → Nachweis im Wartungsprotokoll, Monatsbericht, Portal.
Sitzungen ohne Wartung und ohne Zeitbuchung landen in „Fernwartung ohne Zeitbuchung“ – keine verschenkten Stunden.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, now_iso

API = "https://app.atera.com/api/v3"


class AteraError(RuntimeError):
    pass


class Atera:
    def __init__(self, api_key: str, base: str = API):
        self.api_key, self.base = api_key, base.rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.configured:
            raise AteraError("Atera ist nicht eingerichtet (ATERA_API_KEY in .env).")
        try:
            r = httpx.get(f"{self.base}{path}", params=params or {}, timeout=60,
                          headers={"X-API-KEY": self.api_key, "Accept": "application/json"})
            if r.status_code == 401:
                raise AteraError("Atera lehnt den API-Schlüssel ab (Admin → API → Schlüssel prüfen).")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as exc:
            raise AteraError(f"Atera-API nicht erreichbar: {exc}") from exc

    def paged(self, path: str, max_pages: int = 200) -> list[dict[str, Any]]:
        items, page = [], 1
        while page <= max_pages:
            data = self.get(path, {"page": page, "itemsInPage": 50})
            items += data.get("items") or []
            if page >= int(data.get("totalPages") or 1):
                break
            page += 1
        return items

    def customers(self) -> list[dict[str, Any]]:
        return self.paged("/customers")

    def agents(self) -> list[dict[str, Any]]:
        return self.paged("/agents")

    def alerts(self) -> list[dict[str, Any]]:
        return [a for a in self.paged("/alerts") if not a.get("Archived")]


def _device_type(agent: dict[str, Any]) -> str:
    kind = f"{agent.get('OSType') or ''} {agent.get('OS') or ''}".lower()
    return "server" if "server" in kind or "domain controller" in kind else "pc"


def sync(db: Database, client: Atera, create_customers: bool = True, alert_tickets: bool = False) -> dict[str, Any]:
    mapping: dict[str, int] = {str(k): v for k, v in (db.get_setting("atera_customer_map", {}) or {}).items()}
    by_name = {c["name"].strip().lower(): c["id"] for c in db.query("SELECT id, name FROM customers")}
    created_customers = []
    for c in client.customers():
        aid = str(c.get("CustomerID"))
        if aid in mapping and db.get("customers", mapping[aid]):
            continue
        name = (c.get("CustomerName") or "").strip()
        cid = by_name.get(name.lower())
        if cid is None and create_customers and name:
            address = ", ".join(x for x in (c.get("Address"), f"{c.get('ZipCodeStr') or ''} {c.get('City') or ''}".strip()) if x)
            cid = db.insert("customers", {"name": name, "phone": c.get("Phone") or "", "address": address,
                                          "booked_services": [], "notes": "Aus Atera übernommen"})
            by_name[name.lower()] = cid
            created_customers.append(name)
        if cid:
            mapping[aid] = cid
    db.set_setting("atera_customer_map", mapping)

    created = updated = skipped = 0
    for a in client.agents():
        cid = mapping.get(str(a.get("CustomerID")))
        if not cid:
            skipped += 1
            continue
        name = (a.get("AgentName") or a.get("MachineName") or f"Atera-Gerät {a.get('AgentID')}").strip()
        ext = f"atera:{a.get('AgentID')}"
        data = {"name": name, "type": _device_type(a), "os": (a.get("OS") or "").strip(),
                "serial": (a.get("VendorSerialNumber") or "").strip(), "last_seen": str(a.get("LastSeen") or "")[:10],
                "external_id": ext, "remote_url": a.get("AppViewUrl") if str(a.get("AppViewUrl") or "").startswith("https://") else ""}
        existing = db.query_one("SELECT id FROM assets WHERE external_id = ?", (ext,)) or \
            db.query_one("SELECT id FROM assets WHERE customer_id = ? AND lower(name) = lower(?)", (cid, name))
        if existing:
            db.update("assets", existing["id"], {k: v for k, v in data.items() if v})
            updated += 1
        else:
            db.insert("assets", {**data, "customer_id": cid})
            created += 1

    tickets = 0
    if alert_tickets:
        seen = set(db.get_setting("atera_alerts_seen", []) or [])
        for al in client.alerts():
            uid = str(al.get("AlertID") or "")
            cid = mapping.get(str(al.get("CustomerID")))
            if not uid or uid in seen or not cid:
                continue
            title = (al.get("Title") or al.get("AlertMessage") or "Atera-Alarm").strip()
            db.insert("tickets", {
                "customer_id": cid, "title": f"RMM: {title[:150]}", "status": "neu",
                "priority": "hoch" if str(al.get("Severity")).lower() == "critical" else "normal",
                "category": "Server/Backup" if "backup" in title.lower() else "",
                "description": f"Automatisch aus Atera-Alarm ({al.get('DeviceName') or ''}, {al.get('Severity') or ''}):\n"
                               f"{al.get('AlertMessage') or title}"})
            seen.add(uid)
            tickets += 1
        db.set_setting("atera_alerts_seen", sorted(seen)[-5000:])
    result = {"customers_created": created_customers, "assets_created": created, "assets_updated": updated,
              "agents_unmapped": skipped, "alert_tickets": tickets, "at": now_iso()}
    db.set_setting("atera_last_sync", result)
    return result


# ----------------------------------------------------------------------------- Fernwartungs-Sitzungen
COLS = {
    "start": ("start time", "session start", "startzeit", "beginn", "start", "started", "begin", "datum", "date"),
    "end": ("end time", "session end", "endzeit", "ende", "end", "ended", "stop"),
    "duration": ("duration", "dauer", "session duration", "länge", "laenge", "minutes", "minuten"),
    "technician": ("technician", "techniker", "from user", "user name", "username", "benutzer", "user", "account",
                   "owner", "operator", "from"),
    "device": ("remote computer", "computer name", "device name", "agent name", "computer", "device", "gerät",
               "geraet", "machine", "endpoint", "host", "agent", "target"),
    "customer": ("customer", "kunde", "computer group", "group", "gruppe", "organization", "organisation", "company",
                 "firma", "folder"),
}
DATE_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M",
                "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
                "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M")


def parse_dt(value: str) -> datetime | None:
    v = re.sub(r"\s+", " ", str(value or "").strip().replace("Z", ""))
    v = re.sub(r"\.\d+$", "", v)
    v = re.sub(r"([+-]\d{2}:?\d{2})$", "", v).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt)
        except ValueError:
            continue
    return None


def parse_duration(value: str) -> int | None:
    """„00:29:13“, „29 min“, „1h 5m“, „1 Std. 5 Min.“, „1753“ (Sekunden) → Minuten."""
    v = str(value or "").strip().lower()
    if not v:
        return None
    m = re.fullmatch(r"(\d+):(\d{2}):(\d{2})", v)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)) + (1 if int(m.group(3)) >= 30 else 0)
    m = re.fullmatch(r"(\d+):(\d{2})", v)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    hours = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:h|std|stunde)", v)
    mins = re.search(r"(\d+)\s*(?:m(?:in)?|minute)", v)
    secs = re.search(r"(\d+)\s*(?:s(?:ec|ek)?|sekunde)", v)
    if hours or mins or secs:
        total = (float(hours.group(1).replace(",", ".")) * 60 if hours else 0) + (int(mins.group(1)) if mins else 0)
        total += 1 if secs and int(secs.group(1)) >= 30 else 0
        return int(round(total))
    if re.fullmatch(r"\d+", v):
        n = int(v)
        return round(n / 60) if n > 600 else n  # große Zahlen sind Sekunden
    return None


def _header_index(header: list[str]) -> dict[str, int]:
    cells = [h.strip().lower().strip('"').replace("_", " ") for h in header]
    found: dict[str, int] = {}
    for key, words in COLS.items():
        for word in words:
            idx = next((i for i, c in enumerate(cells) if (c == word or (len(word) > 4 and word in c))
                        and i not in found.values()), None)
            if idx is not None:
                found[key] = idx
                break
    return found


def parse_sessions(data: bytes) -> list[dict[str, Any]]:
    text = None
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    text = text if text is not None else data.decode("latin-1")
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("Datei ist leer.")
    delim = max((";", ",", "\t"), key=lambda d: lines[0].count(d))
    rows = list(csv.reader(io.StringIO("\n".join(lines)), delimiter=delim))
    cols = _header_index(rows[0])
    if "start" not in cols or ("end" not in cols and "duration" not in cols):
        raise ValueError("Spalten nicht erkannt – benötigt: Beginn/Start und Ende oder Dauer (CSV-Export aus Atera bzw. "
                         "Splashtop-Sitzungsprotokoll).")
    out = []
    for row in rows[1:]:
        get = lambda k: row[cols[k]].strip() if k in cols and cols[k] < len(row) else ""  # noqa: E731
        start = parse_dt(get("start"))
        if not start:
            continue
        end = parse_dt(get("end")) if "end" in cols else None
        minutes = parse_duration(get("duration")) if "duration" in cols else None
        if minutes is None and end:
            minutes = max(0, round((end - start).total_seconds() / 60))
        if end is None and minutes is not None:
            end = start + timedelta(minutes=minutes)
        out.append({"started_at": start.isoformat(sep=" "), "ended_at": end.isoformat(sep=" ") if end else "",
                    "minutes": int(minutes or 0), "technician": get("technician")[:120], "device": get("device")[:200],
                    "customer_hint": get("customer")[:200]})
    if not out:
        raise ValueError("Keine Sitzungen erkannt (Datumsformat?).")
    return out


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})))


class Sessions:
    def __init__(self, db: Database):
        self.db = db

    def import_csv(self, data: bytes, source: str = "atera") -> dict[str, Any]:
        items = parse_sessions(data)
        new = dupes = 0
        for it in items:
            key = hashlib.sha256(f"{source}|{it['started_at']}|{_norm(it['device'])}|{_norm(it['technician'])}".encode()).hexdigest()
            if self.db.scalar("SELECT COUNT(*) FROM remote_sessions WHERE dedupe_key = ?", (key,)):
                dupes += 1
                continue
            self.db.insert("remote_sessions", {**it, "source": source, "dedupe_key": key, "status": "offen"})
            new += 1
        self.db.set_setting("sessions_last_import", now_iso())
        return {"imported": new, "duplicates": dupes, **self.match()}

    def _resolve(self, s: dict[str, Any]) -> tuple[int | None, int | None]:
        dev = _norm(s["device"].split(".")[0]) if s["device"] else ""
        if dev:
            for a in self.db.query("SELECT id, customer_id, name FROM assets"):
                if _norm(a["name"].split(".")[0]) == dev:
                    return a["customer_id"], a["id"]
        hint = _norm(s["customer_hint"])
        if hint:
            for c in self.db.query("SELECT id, name FROM customers"):
                n = _norm(c["name"])
                if n and (n == hint or (len(hint) >= 5 and (hint in n or n in hint))):
                    return c["id"], None
        return None, None

    def match(self) -> dict[str, int]:
        """Offene Sitzungen zuordnen: Kunde/Gerät, dann Wartung im Zeitfenster, sonst vorhandene Zeitbuchung."""
        stats = {"matched_customer": 0, "maintenance": 0, "already_booked": 0}
        for s in self.db.query("SELECT * FROM remote_sessions WHERE status = 'offen' ORDER BY started_at"):
            cid, aid = (s["customer_id"], s["asset_id"]) if s["customer_id"] else self._resolve(s)
            if not cid:
                continue
            upd: dict[str, Any] = {"customer_id": cid, "asset_id": aid}
            stats["matched_customer"] += not s["customer_id"]
            day = s["started_at"][:10]
            run = self.db.query_one(
                "SELECT r.id FROM maintenance_runs r JOIN maintenance_tasks t ON t.id = r.task_id "
                "WHERE r.customer_id = ? AND r.status != 'uebersprungen' "
                "AND date(r.due_date, '-' || (COALESCE(t.lead_days, 3) + 3) || ' days') <= date(?) "
                "AND date(?) <= date(r.due_date, '+30 days') "
                "AND (r.status = 'offen' OR substr(r.done_at, 1, 10) >= ?) ORDER BY r.status = 'offen' DESC, r.due_date LIMIT 1",
                (cid, day, day, day))
            if run:
                upd.update({"maintenance_run_id": run["id"], "status": "wartung"})
                stats["maintenance"] += 1
            else:
                used = {r["time_entry_id"] for r in self.db.query(
                    "SELECT time_entry_id FROM remote_sessions WHERE time_entry_id IS NOT NULL")}
                for te in self.db.query("SELECT id, minutes FROM time_entries WHERE customer_id = ? AND date = ?", (cid, day)):
                    if te["id"] not in used and s["minutes"] and 0.5 * s["minutes"] <= te["minutes"] <= 2.5 * s["minutes"] + 15:
                        upd.update({"time_entry_id": te["id"], "status": "gebucht", "note": "vorhandene Zeitbuchung"})
                        stats["already_booked"] += 1
                        break
            self.db.update("remote_sessions", s["id"], upd)
        stats["unbooked"] = self.db.scalar("SELECT COUNT(*) FROM remote_sessions WHERE status = 'offen'") or 0
        return stats

    def book(self, session_id: int, *, ticket_id: int | None = None, description: str = "", billable: bool | None = None,
             user_id: int | None = None) -> dict[str, Any]:
        s = self.db.get("remote_sessions", session_id)
        if not s:
            raise ValueError("Sitzung nicht gefunden")
        if s["status"] != "offen" or not s["customer_id"]:
            raise ValueError("Nur offene, einem Kunden zugeordnete Sitzungen können gebucht werden")
        from .billing import add_time

        tid = add_time(self.db, customer_id=s["customer_id"], minutes=max(1, int(s["minutes"] or 1)),
                       description=description or f"Fernwartung {s['device'] or ''} ({s['technician'] or 'Techniker'})".strip(),
                       ticket_id=ticket_id, user_id=user_id, day=s["started_at"][:10], billable=billable)
        self.db.update("remote_sessions", session_id, {"time_entry_id": tid, "status": "gebucht"})
        return self.db.get("remote_sessions", session_id)

    def for_run(self, run_id: int) -> list[dict[str, Any]]:
        return self.db.query("SELECT * FROM remote_sessions WHERE maintenance_run_id = ? ORDER BY started_at", (run_id,))

    def summary(self) -> dict[str, Any]:
        from .billing import hourly_rate

        rows = self.db.query("SELECT s.minutes, COALESCE(c.package, 'keins') AS package FROM remote_sessions s "
                             "LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status = 'offen'")
        billable_min = sum(r["minutes"] for r in rows if r["package"] == "keins")
        return {"unbooked": len(rows), "unbooked_minutes": sum(r["minutes"] for r in rows),
                "unbooked_value": round(billable_min / 60 * hourly_rate(self.db), 2),
                "unassigned": self.db.scalar("SELECT COUNT(*) FROM remote_sessions WHERE customer_id IS NULL") or 0,
                "maintenance_linked": self.db.scalar("SELECT COUNT(*) FROM remote_sessions WHERE status = 'wartung'") or 0,
                "last_import": self.db.get_setting("sessions_last_import", "")}


# ----------------------------------------------------------------------------- API
class BookIn(BaseModel):
    ticket_id: Optional[int] = None
    description: str = Field("", max_length=500)
    billable: Optional[bool] = None


class AssignIn(BaseModel):
    customer_id: Optional[int] = None
    maintenance_run_id: Optional[int] = None


def register(app: FastAPI, db: Database, settings: Any, admin_only) -> tuple[Atera, Sessions]:
    client = Atera(getattr(settings, "atera_api_key", ""))
    sessions = Sessions(db)

    def guard(fn):
        try:
            return fn()
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/atera/status")
    def status() -> dict:
        return {"configured": client.configured, "sync_hours": getattr(settings, "atera_sync_hours", 0),
                "alert_tickets": getattr(settings, "atera_alert_tickets", False),
                "last": db.get_setting("atera_last_sync", None), "error": db.get_setting("atera_error", ""),
                "sessions": sessions.summary()}

    @app.post("/api/atera/sync", dependencies=[Depends(admin_only)])
    def run_sync() -> dict:
        if not client.configured:
            raise HTTPException(409, "Atera nicht eingerichtet: ATERA_API_KEY in .env (Atera → Admin → API).")
        try:
            result = sync(db, client, alert_tickets=getattr(settings, "atera_alert_tickets", False))
            db.set_setting("atera_error", "")
            sessions.match()
            return result
        except AteraError as exc:
            db.set_setting("atera_error", str(exc))
            raise HTTPException(502, str(exc))

    @app.post("/api/sessions/import")
    async def import_sessions(request: Request) -> dict:
        data = await request.body()
        if not data:
            raise HTTPException(422, "Leere Datei")
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(413, "Datei zu groß (max. 10 MB)")
        source = "splashtop" if "splashtop" in request.headers.get("x-filename", "").lower() else "atera"
        return guard(lambda: sessions.import_csv(data, source))

    @app.get("/api/sessions")
    def list_sessions(status: Optional[str] = None, customer_id: Optional[int] = None, limit: int = 300) -> list[dict]:
        sql = ("SELECT s.*, c.name AS customer_name, a.name AS asset_name, a.remote_url, r.title AS run_title "
               "FROM remote_sessions s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN assets a ON a.id = s.asset_id "
               "LEFT JOIN maintenance_runs r ON r.id = s.maintenance_run_id WHERE 1=1")
        params: list[Any] = []
        if status == "ohne_kunde":
            sql += " AND s.customer_id IS NULL"
        elif status:
            sql += " AND s.status = ?"
            params.append(status)
        if customer_id:
            sql += " AND s.customer_id = ?"
            params.append(customer_id)
        return db.query(sql + " ORDER BY s.started_at DESC LIMIT ?", [*params, min(limit, 2000)])

    @app.post("/api/sessions/{sid}/book")
    def book(sid: int, data: BookIn, request: Request) -> dict:
        user = getattr(request.state, "user", None)
        return guard(lambda: sessions.book(sid, ticket_id=data.ticket_id, description=data.description,
                                           billable=data.billable, user_id=user["id"] if user else None))

    @app.post("/api/sessions/{sid}/assign")
    def assign(sid: int, data: AssignIn) -> dict:
        s = db.get("remote_sessions", sid)
        if not s:
            raise HTTPException(404, "Sitzung nicht gefunden")
        upd: dict[str, Any] = {}
        if data.customer_id:
            if not db.get("customers", data.customer_id):
                raise HTTPException(404, "Kunde nicht gefunden")
            upd["customer_id"] = data.customer_id
        if data.maintenance_run_id:
            run = db.get("maintenance_runs", data.maintenance_run_id)
            if not run:
                raise HTTPException(404, "Wartung nicht gefunden")
            upd.update({"maintenance_run_id": run["id"], "customer_id": run["customer_id"], "status": "wartung"})
        db.update("remote_sessions", sid, upd)
        if data.customer_id and not data.maintenance_run_id:
            sessions.match()
        return db.get("remote_sessions", sid)

    @app.post("/api/sessions/{sid}/ignore")
    def ignore(sid: int) -> dict:
        if not db.get("remote_sessions", sid):
            raise HTTPException(404, "Sitzung nicht gefunden")
        db.update("remote_sessions", sid, {"status": "ignoriert"})
        return db.get("remote_sessions", sid)

    @app.get("/api/maintenance/runs/{rid}/sessions")
    def run_sessions(rid: int) -> list[dict]:
        return sessions.for_run(rid)

    if client.configured and getattr(settings, "atera_sync_hours", 0) > 0:
        def loop() -> None:
            time.sleep(120)
            while True:
                try:
                    sync(db, client, alert_tickets=getattr(settings, "atera_alert_tickets", False))
                    sessions.match()
                    db.set_setting("atera_error", "")
                except Exception as exc:  # noqa: BLE001
                    db.set_setting("atera_error", str(exc))
                time.sleep(settings.atera_sync_hours * 3600)

        threading.Thread(target=loop, name="meit-atera-sync", daemon=True).start()
    return client, sessions
