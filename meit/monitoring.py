"""Überwachung: Sind die Websites und Dienste der Kunden erreichbar?

- **Website/Web-Dienst (HTTP):** Adresse wird abgerufen; in Ordnung ist eine Antwort unter 400, optional mit Suchtext
  (erkennt auch „Seite lädt, zeigt aber eine Fehlermeldung“).
- **Anschluss (TCP):** ob ein Dienst Verbindungen annimmt – Mailserver, VPN, Fernzugriff, Warenwirtschaft.
- Geprüft wird alle paar Minuten. „Gestört“ gilt erst nach zwei Fehlversuchen in Folge (kein Fehlalarm bei einem Aussetzer).
- Bei einer Störung entsteht ein dringendes Ticket; kommt der Dienst zurück, steht die Ausfalldauer als Notiz im Ticket.
- Je Tag wird mitgezählt (Prüfungen, Fehler, Antwortzeit) – daraus entstehen Verfügbarkeit und Verlauf der letzten 30 Tage.
- Der Kunde sieht den Status seiner Dienste im Portal.

Geprüft wird vom Server des Cockpits aus. Interne Adressen der Kunden sind nur erreichbar, wenn der Server sie erreicht
(z. B. über VPN). Fällt der Internetanschluss des Cockpits selbst aus, sähe das wie eine Störung aller Dienste aus –
deshalb wird pausiert, sobald in einem Durchgang alles gleichzeitig ausfällt (bei mindestens drei Prüfungen).
"""

from __future__ import annotations

import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database, now_iso

KINDS = {"http": "Website / Web-Dienst", "tcp": "Anschluss (TCP)"}
FAILS_UNTIL_DOWN = 2
MAX_BODY = 300_000
Probe = Callable[[dict[str, Any]], tuple[bool, int, str]]


class MonitorError(ValueError):
    pass


def normalize_target(kind: str, target: str) -> str:
    """Ziel prüfen und vereinheitlichen. HTTP: vollständige Adresse; TCP: ``host:port``."""
    target = (target or "").strip()
    if kind == "http":
        if not re.match(r"^https?://", target, re.I):
            if "://" in target:
                raise MonitorError("Nur Adressen mit http:// oder https:// können überwacht werden.")
            target = "https://" + target
        u = urlparse(target)
        if u.scheme not in ("http", "https") or not u.hostname or " " in target or u.username or u.password:
            raise MonitorError("Bitte eine Adresse wie https://www.kunde.at angeben (ohne Zugangsdaten).")
        return target[:500]
    m = re.fullmatch(r"([A-Za-z0-9._\-]+|\[[0-9A-Fa-f:]+\]):(\d{1,5})", target)
    if not m or not (1 <= int(m.group(2)) <= 65535):
        raise MonitorError("Bitte Rechner und Anschluss angeben, z. B. mail.kunde.at:587.")
    return target.lower()


def probe(m: dict[str, Any]) -> tuple[bool, int, str]:
    """Eine Prüfung ausführen. Rückgabe: (in Ordnung, Antwortzeit in ms, kurze Erklärung)."""
    started = time.monotonic()
    ms = lambda: max(1, int((time.monotonic() - started) * 1000))  # noqa: E731
    if m["kind"] == "tcp":
        host, port = m["target"].rsplit(":", 1)
        try:
            with socket.create_connection((host.strip("[]"), int(port)), timeout=8):
                return True, ms(), "Verbindung angenommen"
        except socket.timeout:
            return False, ms(), "Zeitüberschreitung – keine Antwort"
        except ConnectionRefusedError:
            return False, ms(), "Verbindung abgelehnt – Dienst läuft nicht"
        except OSError as exc:
            return False, ms(), f"Nicht erreichbar: {exc.strerror or exc}"[:200]
    import httpx

    try:
        with httpx.Client(timeout=12, follow_redirects=True, max_redirects=5, headers={"User-Agent": "Cockpit-Ueberwachung/1.0"}) as c:
            with c.stream("GET", m["target"]) as r:
                body = b""
                if m.get("keyword"):
                    for chunk in r.iter_bytes():
                        body += chunk
                        if len(body) > MAX_BODY:
                            break
                took = ms()
                if r.status_code in (401, 403):  # Anmeldung verlangt → der Dienst läuft
                    return True, took, f"Antwort {r.status_code} (Anmeldung nötig – Dienst läuft)"
                if r.status_code >= 400:
                    return False, took, f"Antwort {r.status_code}"
                if m.get("keyword") and m["keyword"].lower() not in body.decode("utf-8", "ignore").lower():
                    return False, took, f"Suchtext „{m['keyword']}“ fehlt auf der Seite"
                return True, took, f"Antwort {r.status_code}"
    except httpx.TimeoutException:
        return False, ms(), "Zeitüberschreitung – keine Antwort"
    except httpx.ConnectError as exc:
        text = str(exc)
        return False, ms(), ("Sicherheitszertifikat ungültig oder abgelaufen" if "CERTIFICATE" in text.upper() else
                             "Name nicht auflösbar (DNS)" if "Name or service" in text or "getaddrinfo" in text else "Verbindung nicht möglich")
    except httpx.HTTPError as exc:
        return False, ms(), f"Fehler: {type(exc).__name__}"


def duration_text(seconds: int) -> str:
    if seconds < 90:
        return f"{max(1, seconds)} Sekunden"
    if seconds < 5400:
        return f"{round(seconds / 60)} Minuten"
    return f"{seconds / 3600:.1f} Stunden".replace(".", ",")


class MonitorIn(BaseModel):
    customer_id: Optional[int] = None
    name: str = Field(min_length=2, max_length=120)
    kind: str = Field("http", pattern="^(http|tcp)$")
    target: str = Field(min_length=3, max_length=500)
    keyword: str = Field("", max_length=120)
    interval_min: int = Field(5, ge=1, le=1440)
    active: bool = True
    portal_visible: bool = True


class Monitoring:
    def __init__(self, db: Database, probe_fn: Probe = probe):
        self.db, self.probe = db, probe_fn
        self._lock = threading.Lock()

    # -- Auswertung
    def stats(self, mid: int, days: int = 30) -> dict[str, Any]:
        since = (date.today() - timedelta(days=days - 1)).isoformat()
        rows = self.db.query("SELECT day, checks, fails, ms_sum FROM monitor_days WHERE monitor_id = ? AND day >= ? ORDER BY day", (mid, since))
        checks, fails = sum(r["checks"] for r in rows), sum(r["fails"] for r in rows)
        good = checks - fails
        by_day = {r["day"]: r for r in rows}
        strip = []
        for i in range(days):
            day = (date.today() - timedelta(days=days - 1 - i)).isoformat()
            r = by_day.get(day)
            strip.append({"day": day, "state": "" if not r or not r["checks"] else "ok" if not r["fails"] else "bad" if r["fails"] * 20 >= r["checks"] else "warn",
                          "uptime": None if not r or not r["checks"] else round(100 * (1 - r["fails"] / r["checks"]), 2)})
        return {"uptime": round(100 * good / checks, 2) if checks else None, "checks": checks,
                "avg_ms": round(sum(r["ms_sum"] for r in rows) / good) if good else None, "days": strip}

    def view(self, m: dict[str, Any], with_stats: bool = True) -> dict[str, Any]:
        out = {k: m[k] for k in ("id", "customer_id", "name", "kind", "target", "keyword", "interval_min", "active", "portal_visible", "status",
                                 "since", "last_check", "last_ms", "last_error", "ticket_id", "created_at")}
        out.update({"customer": m.get("customer") or "", "kind_label": KINDS.get(m["kind"], m["kind"]), "active": bool(m["active"]),
                    "portal_visible": bool(m["portal_visible"]),
                    "status_label": "pausiert" if not m["active"] else "Fehler – wird nachgeprüft" if m["status"] != "down" and (m["fails"] or 0) > 0
                    else {"ok": "erreichbar", "down": "gestört", "neu": "noch nicht geprüft"}.get(m["status"], m["status"])})
        if with_stats:
            out.update(self.stats(m["id"]))
        return out

    def list(self, customer_id: int | None = None) -> list[dict[str, Any]]:
        sql = "SELECT m.*, c.name AS customer FROM monitors m LEFT JOIN customers c ON c.id = m.customer_id "
        rows = self.db.query(sql + ("WHERE m.customer_id = ? " if customer_id else "") + "ORDER BY m.status = 'down' DESC, lower(c.name), lower(m.name)",
                             (customer_id,) if customer_id else ())
        return [self.view(m) for m in rows]

    # -- Prüfen
    def record(self, m: dict[str, Any], ok: bool, ms: int, detail: str) -> dict[str, Any]:
        """Ergebnis einer Prüfung verbuchen: Tageszähler, Zustandswechsel, Ticket bei Störung, Notiz bei Rückkehr."""
        now = now_iso()
        with self.db.connect() as conn:
            conn.execute("INSERT INTO monitor_days (monitor_id, day, checks, fails, ms_sum) VALUES (?, ?, 1, ?, ?) "
                         "ON CONFLICT(monitor_id, day) DO UPDATE SET checks = checks + 1, fails = fails + excluded.fails, ms_sum = ms_sum + excluded.ms_sum",
                         (m["id"], now[:10], 0 if ok else 1, ms if ok else 0))
        fails = 0 if ok else (m["fails"] or 0) + 1
        patch: dict[str, Any] = {"last_check": now, "last_ms": ms, "last_error": "" if ok else detail[:200], "fails": fails}
        if ok and m["status"] != "ok":
            patch.update({"status": "ok", "since": now})
            if m["status"] == "down":
                seconds = int((datetime.fromisoformat(now) - datetime.fromisoformat(m["since"] or now)).total_seconds())
                self.db.insert("monitor_events", {"monitor_id": m["id"], "at": now, "status": "up", "detail": detail[:200], "duration_s": seconds})
                self._note(m, f"Überwachung: „{m['name']}“ ist wieder erreichbar. Ausfall: {duration_text(seconds)}.")
        elif not ok and m["status"] != "down" and fails >= FAILS_UNTIL_DOWN:
            patch.update({"status": "down", "since": now})
            self.db.insert("monitor_events", {"monitor_id": m["id"], "at": now, "status": "down", "detail": detail[:200], "duration_s": 0})
            patch["ticket_id"] = self._ticket(m, detail)
        self.db.update("monitors", m["id"], patch)
        return {**m, **patch}

    def _ticket(self, m: dict[str, Any], detail: str) -> int | None:
        open_ticket = self.db.get("tickets", m["ticket_id"]) if m.get("ticket_id") else None
        if open_ticket and open_ticket["status"] != "geloest":
            self._note(m, f"Überwachung: „{m['name']}“ ist erneut gestört – {detail}.")
            return open_ticket["id"]
        tid = self.db.insert("tickets", {
            "customer_id": m["customer_id"], "title": f"Störung: {m['name']} nicht erreichbar"[:200], "status": "neu", "priority": "hoch",
            "category": "Überwachung",
            "description": (f"Die Überwachung meldet eine Störung.\n\nDienst: {m['name']}\nZiel: {m['target']}\nBefund: {detail}\n"
                            f"Seit: {datetime.now().strftime('%d.%m.%Y, %H:%M Uhr')}\n\nGeprüft wird alle {m['interval_min']} Minuten vom Cockpit-Server aus. "
                            "Sobald der Dienst wieder antwortet, steht die Ausfalldauer als Notiz in diesem Ticket.")})
        try:
            from .team import auto_assign

            auto_assign(self.db, tid)
        except Exception:  # noqa: BLE001 - Zuteilung ist Komfort
            pass
        return tid

    def _note(self, m: dict[str, Any], text: str) -> None:
        if not m.get("ticket_id") or not self.db.get("tickets", m["ticket_id"]):
            return
        self.db.insert("messages", {"channel": "notiz", "direction": "out", "status": "intern", "subject": "Notiz Überwachung", "body": text,
                                    "linked_type": "ticket", "linked_id": m["ticket_id"], "customer_id": m["customer_id"], "category": "support"})

    def check(self, mid: int) -> dict[str, Any] | None:
        m = self.db.get("monitors", mid)
        if not m:
            return None
        ok, ms, detail = self.probe(m)
        return self.record(m, ok, ms, detail)

    def due(self, now: datetime | None = None) -> list[dict[str, Any]]:
        now = now or datetime.now()
        out = []
        for m in self.db.query("SELECT * FROM monitors WHERE active = 1"):
            last = datetime.fromisoformat(m["last_check"]) if m["last_check"] else None
            # „gestört“ wird jede Minute nachgeprüft, damit die Rückkehr schnell auffällt
            wait = 1 if m["status"] == "down" or (m["fails"] or 0) > 0 else m["interval_min"]
            if not last or (now - last).total_seconds() >= wait * 60 - 5:
                out.append(m)
        return out

    def run_due(self) -> dict[str, int]:
        """Alle fälligen Prüfungen ausführen (parallel). Fällt alles gleichzeitig aus, liegt es am eigenen Anschluss → nichts verbuchen."""
        if not self._lock.acquire(blocking=False):
            return {"checked": 0, "failed": 0, "skipped": 1}
        try:
            todo = self.due()
            if not todo:
                return {"checked": 0, "failed": 0, "skipped": 0}
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda m: (m, *self.probe(m)), todo))
            failed = [r for r in results if not r[1]]
            if len(results) >= 3 and len(failed) == len(results):
                self.db.set_setting("monitoring_paused", {"at": now_iso(), "reason": "Alle Prüfungen gleichzeitig fehlgeschlagen – vermutlich der eigene Internetanschluss."})
                return {"checked": 0, "failed": len(failed), "skipped": len(results)}
            if self.db.get_setting("monitoring_paused", None):
                self.db.set_setting("monitoring_paused", None)
            for m, ok, ms, detail in results:
                self.record(m, ok, ms, detail)
            return {"checked": len(results), "failed": len(failed), "skipped": 0}
        finally:
            self._lock.release()

    def start(self) -> None:
        def loop() -> None:
            time.sleep(20)
            while True:
                try:
                    self.run_due()
                    old = (date.today() - timedelta(days=400)).isoformat()
                    self.db.query("DELETE FROM monitor_days WHERE day < ?", (old,))
                except Exception:  # noqa: BLE001 - die Überwachung darf nie selbst ausfallen
                    pass
                time.sleep(30)

        threading.Thread(target=loop, name="monitoring", daemon=True).start()


def register(app: FastAPI, ctx: Any, admin_only, start: bool = False) -> Monitoring:
    db: Database = ctx.db
    svc = Monitoring(db)
    app.state.monitoring = svc

    def need(mid: int) -> dict[str, Any]:
        m = db.query_one("SELECT m.*, c.name AS customer FROM monitors m LEFT JOIN customers c ON c.id = m.customer_id WHERE m.id = ?", (mid,))
        if not m:
            raise HTTPException(404, "Überwachung nicht gefunden")
        return m

    def clean(data: MonitorIn) -> dict[str, Any]:
        d = data.model_dump()
        if d["customer_id"] and not db.get("customers", d["customer_id"]):
            raise HTTPException(404, "Kunde nicht gefunden")
        try:
            d["target"] = normalize_target(d["kind"], d["target"])
        except MonitorError as exc:
            raise HTTPException(422, str(exc))
        if d["kind"] == "tcp":
            d["keyword"] = ""
        return d

    @app.get("/api/monitors")
    def list_monitors(customer_id: int = 0) -> dict:
        rows = svc.list(customer_id or None)
        active = [r for r in rows if r["active"]]
        ups = [r["uptime"] for r in active if r["uptime"] is not None]
        return {"items": rows, "kinds": KINDS, "paused": db.get_setting("monitoring_paused", None),
                "summary": {"total": len(active), "down": sum(1 for r in active if r["status"] == "down"),
                            "ok": sum(1 for r in active if r["status"] == "ok"), "uptime": round(sum(ups) / len(ups), 2) if ups else None}}

    @app.post("/api/monitors", status_code=201, dependencies=[Depends(admin_only)])
    def create(data: MonitorIn) -> dict:
        mid = db.insert("monitors", {**clean(data), "status": "neu", "since": now_iso(), "fails": 0})
        return svc.view(need(mid))

    @app.get("/api/monitors/{mid}")
    def one(mid: int) -> dict:
        m = need(mid)
        events = db.query("SELECT at, status, detail, duration_s FROM monitor_events WHERE monitor_id = ? ORDER BY id DESC LIMIT 30", (mid,))
        for e in events:
            e["duration"] = duration_text(e["duration_s"]) if e["status"] == "up" and e["duration_s"] else ""
        return {**svc.view(m), "events": events}

    @app.put("/api/monitors/{mid}", dependencies=[Depends(admin_only)])
    def update(mid: int, data: MonitorIn) -> dict:
        old = need(mid)
        d = clean(data)
        if d["target"] != old["target"] or d["kind"] != old["kind"]:
            d.update({"status": "neu", "since": now_iso(), "fails": 0, "last_error": ""})  # neues Ziel → Zustand neu ermitteln
        db.update("monitors", mid, d)
        return svc.view(need(mid))

    @app.delete("/api/monitors/{mid}", dependencies=[Depends(admin_only)])
    def delete(mid: int) -> dict:
        need(mid)
        db.delete("monitors", mid)
        return {"ok": True}

    @app.post("/api/monitors/{mid}/check")
    def check_now(mid: int) -> dict:
        need(mid)
        svc.check(mid)
        return one(mid)

    if start:
        svc.start()
    return svc
