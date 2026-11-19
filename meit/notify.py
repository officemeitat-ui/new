"""Benachrichtigungen: Glocke im Cockpit, E-Mail und Microsoft Teams – damit Kritisches nicht liegen bleibt.

Ereignisse
* **Ticket** ab der eingestellten Priorität (Standard: hoch und kritisch). Darunter fallen automatisch auch
  fehlgeschlagene Sicherungen, externe Weiterleitungen in Microsoft 365 und Phishing-Meldungen aus dem Portal,
  weil diese als Ticket mit hoher Priorität angelegt werden.
* **Portal**: Kunde schreibt einen Kommentar bzw. meldet einen Ein-/Austritt.
* **Sicherheit**: gehäufte Fehlanmeldungen, zurückgesetzte Zwei-Faktor-Anmeldung.
* **Tagesstart** (optional): Zusammenfassung per E-Mail zur eingestellten Stunde.

Die Ereignisse werden aus den Daten gelesen (kein Eingriff in die einzelnen Funktionen) und je Ereignis nur einmal
gemeldet. Fehler eines Kanals (Mail/Teams nicht erreichbar) stören das Cockpit nie – sie stehen in den Einstellungen.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, now_iso

KINDS = {"ticket": "Dringende Tickets", "portal": "Nachrichten aus dem Kundenportal", "security": "Sicherheitsereignisse",
         "test": "Test"}
CHANNELS = ("app", "email", "teams")
PRIORITY_ORDER = ["niedrig", "normal", "hoch", "kritisch"]
DEFAULT = {
    "email_to": "", "teams_webhook": "", "min_priority": "hoch",
    "events": {"ticket": {"app": True, "email": True, "teams": True}, "portal": {"app": True, "email": False, "teams": False},
               "security": {"app": True, "email": True, "teams": True}},
    "digest": {"enabled": False, "hour": 7},
}


def teams_card(title: str, body: str, url: str = "", severity: str = "info") -> dict[str, Any]:
    """Adaptive Card für Teams-Webhooks (Workflows „Beim Empfang einer Teams-Webhookanforderung“)."""
    color = {"kritisch": "Attention", "hoch": "Warning"}.get(severity, "Accent")
    content: dict[str, Any] = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
        "body": [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True, "color": color},
                 {"type": "TextBlock", "text": body or " ", "wrap": True}]}
    if url.startswith("http"):
        content["actions"] = [{"type": "Action.OpenUrl", "title": "Im Cockpit öffnen", "url": url}]
    return {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": content}]}


class Notifier:
    def __init__(self, ctx: Any, settings: Any):
        self.ctx, self.db, self.s = ctx, ctx.db, settings
        self._lock = threading.Lock()

    # -- Einstellungen
    def conf(self) -> dict[str, Any]:
        stored = self.db.get_setting("notify", None)
        if stored is None:  # erster Start: nur Neues melden, nicht den Bestand (Marke je Tabelle)
            top = lambda table: self.db.scalar(f"SELECT COALESCE(MAX(id), 0) FROM {table}") or 0  # noqa: E731
            stored = {"since": now_iso(), "since_ids": {"tickets": top("tickets"), "messages": top("messages"),
                                                         "staff_changes": top("staff_changes"), "audit_log": top("audit_log")}}
            self.db.set_setting("notify", stored)
        conf = {**DEFAULT, **stored}
        conf["events"] = {k: {**v, **(stored.get("events", {}).get(k) or {})} for k, v in DEFAULT["events"].items()}
        conf["digest"] = {**DEFAULT["digest"], **(stored.get("digest") or {})}
        return conf

    def save(self, patch: dict[str, Any]) -> dict[str, Any]:
        conf = self.conf()
        for key in ("email_to", "teams_webhook", "min_priority"):
            if patch.get(key) is not None:
                conf[key] = str(patch[key]).strip()
        if conf["teams_webhook"] and not conf["teams_webhook"].startswith("https://"):
            raise ValueError("Teams-Webhook muss mit https:// beginnen.")
        if conf["email_to"] and "@" not in conf["email_to"]:
            raise ValueError("Bitte eine gültige E-Mail-Adresse angeben.")
        if conf["min_priority"] not in PRIORITY_ORDER:
            raise ValueError("Unbekannte Priorität")
        for kind, channels in (patch.get("events") or {}).items():
            if kind in conf["events"] and isinstance(channels, dict):
                conf["events"][kind] = {**conf["events"][kind], **{c: bool(v) for c, v in channels.items() if c in CHANNELS}}
        if isinstance(patch.get("digest"), dict):
            d = {**conf["digest"], **patch["digest"]}
            conf["digest"] = {"enabled": bool(d.get("enabled")), "hour": max(0, min(23, int(d.get("hour", 7))))}
        self.db.set_setting("notify", conf)
        return conf

    def public_conf(self) -> dict[str, Any]:
        c = self.conf()
        mailer = getattr(self.ctx, "mailer", None)
        hook = c["teams_webhook"]
        return {**c, "teams_webhook": "", "teams_set": bool(hook), "teams_hint": (hook.split("/")[2] if hook else ""),
                "mail_available": bool(mailer and getattr(mailer, "smtp_configured", False)), "kinds": KINDS,
                "last_error": self.db.get_setting("notify_last_error", ""), "base_url": self.base_url()}

    def base_url(self) -> str:
        return (getattr(self.s, "public_url", "") or self.db.get_setting("notify_base_url", "") or "").rstrip("/")

    # -- Senden
    def _channel_error(self, channel: str, exc: Exception) -> str:
        text = f"{now_iso()} {channel}: {exc}"[:400]
        self.db.set_setting("notify_last_error", text)
        return text

    def send_email(self, subject: str, body: str, conf: dict[str, Any]) -> str:
        mailer = getattr(self.ctx, "mailer", None)
        if not conf["email_to"]:
            return "keine Adresse eingetragen"
        if not (mailer and getattr(mailer, "smtp_configured", False)):
            return "kein Mailversand eingerichtet"
        try:
            mailer.send(conf["email_to"], subject, body)
            return "ok"
        except Exception as exc:  # noqa: BLE001
            return self._channel_error("E-Mail", exc)

    def send_teams(self, title: str, body: str, url: str, severity: str, conf: dict[str, Any]) -> str:
        if not conf["teams_webhook"]:
            return "kein Webhook eingetragen"
        import httpx

        try:
            r = httpx.post(conf["teams_webhook"], json=teams_card(title, body, url, severity), timeout=15)
            if r.status_code >= 300:
                return self._channel_error("Teams", RuntimeError(f"HTTP {r.status_code}"))
            return "ok"
        except httpx.HTTPError as exc:
            return self._channel_error("Teams", exc)

    def emit(self, kind: str, title: str, body: str = "", *, link: str = "", severity: str = "info", ref: str = "",
             user_id: int | None = None, force: bool = False) -> dict[str, str] | None:
        """Ein Ereignis melden. ``ref`` verhindert Doppelmeldungen. Rückgabe: Ergebnis je Kanal (None = schon gemeldet)."""
        if ref and not force and self.db.scalar("SELECT COUNT(*) FROM notifications WHERE kind = ? AND ref = ?", (kind, ref)):
            return None
        conf = self.conf()
        channels = conf["events"].get(kind) or {"app": True, "email": force, "teams": force}
        result: dict[str, str] = {}
        # Eintrag immer anlegen (auch als Merker gegen Doppelmeldungen); ohne „app“ gilt er sofort als gelesen
        self.db.insert("notifications", {"user_id": user_id, "kind": kind, "severity": severity, "title": title[:200],
                                         "body": body[:1000], "link": link[:200], "ref": ref[:120],
                                         "read_at": "" if channels.get("app", True) else now_iso()})
        result["app"] = "ok" if channels.get("app", True) else "aus"
        base = self.base_url()
        url = f"{base}/#/{link}" if base and link else ""
        if channels.get("email"):
            result["email"] = self.send_email(f"[Cockpit] {title}", body + (f"\n\n{url}" if url else ""), conf)
        if channels.get("teams"):
            result["teams"] = self.send_teams(title, body, url, severity, conf)
        return result

    # -- Ereignisse aus den Daten lesen
    def scan(self) -> int:
        with self._lock:
            return self._scan()

    def _scan(self) -> int:
        db, conf = self.db, self.conf()
        mark = {"tickets": 0, "messages": 0, "staff_changes": 0, "audit_log": 0, **(conf.get("since_ids") or {})}
        window = (datetime.now() - timedelta(days=2)).replace(microsecond=0).isoformat(sep=" ")
        emitted = 0
        prios = PRIORITY_ORDER[PRIORITY_ORDER.index(conf["min_priority"]):]
        marks = ", ".join("?" for _ in prios)
        for t in db.query(f"SELECT t.id, t.title, t.priority, t.assigned_to, t.description, c.name AS customer FROM tickets t "
                          f"LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id > ? AND t.created_at >= ? AND t.status != 'geloest' "
                          f"AND t.priority IN ({marks}) ORDER BY t.id", [mark["tickets"], window, *prios]):
            r = self.emit("ticket", f"{'🔴' if t['priority'] == 'kritisch' else '🟠'} #{t['id']} {t['title']}",
                          (f"{t['customer']} · " if t["customer"] else "") + f"Priorität {t['priority']}\n"
                          + (t["description"] or "")[:400], link=f"tickets?ticket={t['id']}", severity=t["priority"],
                          ref=f"ticket:{t['id']}", user_id=None)
            emitted += r is not None
        for m in db.query("SELECT m.id, m.from_name, m.from_email, m.body, m.linked_id, t.title, t.assigned_to FROM messages m "
                          "LEFT JOIN tickets t ON t.id = m.linked_id WHERE m.channel = 'portal' AND m.direction = 'in' "
                          "AND m.linked_type = 'ticket' AND m.id > ? AND m.created_at >= ? ORDER BY m.id", (mark["messages"], window)):
            r = self.emit("portal", f"Portal: {m['from_name'] or m['from_email']} zu #{m['linked_id']} {m['title'] or ''}".strip(),
                          (m["body"] or "")[:400], link=f"tickets?ticket={m['linked_id']}", ref=f"msg:{m['id']}",
                          user_id=m["assigned_to"])
            emitted += r is not None
        for s in db.query("SELECT s.id, s.kind, s.person, s.due_date, c.name AS customer FROM staff_changes s "
                          "JOIN customers c ON c.id = s.customer_id WHERE s.requested_by LIKE '%(Kundenportal)' AND s.id > ? "
                          "AND s.created_at >= ?", (mark["staff_changes"], window)):
            r = self.emit("portal", f"Portal: {'Eintritt' if s['kind'] == 'eintritt' else 'Austritt'} {s['person']} – {s['customer']}",
                          f"Stichtag {s['due_date'] or 'offen'}", link=f"mitarbeiter?vorgang={s['id']}", ref=f"staff:{s['id']}")
            emitted += r is not None
        from .audit import failed_logins

        hour = datetime.now().strftime("%Y-%m-%dT%H")
        for f in failed_logins(db):
            r = self.emit("security", f"⚠ {f['n']} fehlgeschlagene Anmeldungen: {f['target']}",
                          f"In den letzten 10 Minuten von {f['ip'] or 'unbekannter Adresse'}. Wenn das nicht du warst: Passwort ändern, "
                          "Zwei-Faktor-Anmeldung prüfen.", link="verbindungen", severity="hoch", ref=f"login:{f['target']}:{f['ip']}:{hour}")
            emitted += r is not None
        for a in db.query("SELECT id, actor, target, at FROM audit_log WHERE action = 'Zwei-Faktor-Anmeldung zurückgesetzt' AND ok = 1 "
                          "AND id > ? AND at >= ?", (mark["audit_log"], window)):
            r = self.emit("security", "Zwei-Faktor-Anmeldung wurde zurückgesetzt", f"Durch {a['actor']} ({a['at']}).",
                          link="verbindungen", severity="hoch", ref=f"audit:{a['id']}")
            emitted += r is not None
        return emitted

    # -- Tagesstart
    def digest(self) -> dict[str, Any]:
        db = self.db
        tickets = db.query("SELECT t.id, t.title, t.priority, c.name AS customer FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id "
                           "WHERE t.status != 'geloest' AND t.priority IN ('hoch', 'kritisch') "
                           "ORDER BY CASE t.priority WHEN 'kritisch' THEN 0 ELSE 1 END, t.id LIMIT 15")
        open_all = db.scalar("SELECT COUNT(*) FROM tickets WHERE status != 'geloest'") or 0
        backups = db.query("SELECT j.name, j.last_status, c.name AS customer FROM backup_jobs j LEFT JOIN customers c ON c.id = j.customer_id "
                           "WHERE j.active = 1 AND j.last_status IN ('fehler', 'überfällig') ORDER BY c.name")
        soon = (date.today() + timedelta(days=7)).isoformat()
        staff = db.query("SELECT s.kind, s.person, s.due_date, c.name AS customer FROM staff_changes s JOIN customers c ON c.id = s.customer_id "
                         "WHERE s.status IN ('offen', 'in_arbeit') AND s.due_date != '' AND s.due_date <= ? ORDER BY s.due_date", (soon,))
        approvals = db.scalar("SELECT COUNT(*) FROM messages WHERE status = 'freigabe'") or 0
        lines = [f"Guten Morgen! Stand {date.today().strftime('%d.%m.%Y')}:", "",
                 f"Offene Tickets: {open_all} (davon {len(tickets)} dringend)"]
        lines += [f"  • [{t['priority']}] #{t['id']} {t['title']}" + (f" – {t['customer']}" if t["customer"] else "") for t in tickets]
        lines += ["", f"Datensicherung: {len(backups)} Problem(e)" if backups else "Datensicherung: alles in Ordnung"]
        lines += [f"  • {b['customer'] or 'ohne Kunde'}: {b['name']} ({b['last_status']})" for b in backups]
        if staff:
            lines += ["", "Ein-/Austritte in den nächsten 7 Tagen:"] + [
                f"  • {s['due_date']} {'Eintritt' if s['kind'] == 'eintritt' else 'Austritt'} {s['person']} – {s['customer']}" for s in staff]
        if approvals:
            lines += ["", f"Posteingang: {approvals} Antwort(en) warten auf Freigabe"]
        base = self.base_url()
        if base:
            lines += ["", base]
        return {"subject": f"[Cockpit] Tagesstart: {len(tickets)} dringend, {len(backups)} Backup-Problem(e)",
                "text": "\n".join(lines), "urgent": len(tickets), "backups": len(backups)}

    def maybe_send_digest(self, now: datetime | None = None) -> bool:
        now = now or datetime.now()
        conf = self.conf()
        if not conf["digest"]["enabled"] or now.hour < conf["digest"]["hour"]:
            return False
        today = now.date().isoformat()
        if self.db.get_setting("notify_digest_last", "") == today:
            return False
        d = self.digest()
        self.db.set_setting("notify_digest_last", today)
        return self.send_email(d["subject"], d["text"], conf) == "ok"

    # -- Liste für die Glocke
    def items(self, user_id: int, limit: int = 30, unread_only: bool = False) -> dict[str, Any]:
        where = "(user_id IS NULL OR user_id = ? OR ? = 0)"
        unread = self.db.scalar(f"SELECT COUNT(*) FROM notifications WHERE read_at = '' AND {where}", (user_id, user_id)) or 0
        rows = self.db.query(f"SELECT id, kind, severity, title, body, link, read_at, created_at FROM notifications WHERE {where} "
                             + ("AND read_at = '' " if unread_only else "") + "ORDER BY id DESC LIMIT ?",
                             (user_id, user_id, max(1, min(limit, 200))))
        return {"unread": unread, "items": rows}

    def mark_read(self, user_id: int, ids: list[int] | None = None) -> int:
        where = "read_at = '' AND (user_id IS NULL OR user_id = ? OR ? = 0)"
        params: list[Any] = [now_iso(), user_id, user_id]
        if ids:
            where += f" AND id IN ({', '.join('?' for _ in ids)})"
            params += ids
        with self.db.connect() as conn:
            return conn.execute(f"UPDATE notifications SET read_at = ? WHERE {where}", params).rowcount


class ReadIn(BaseModel):
    ids: Optional[list[int]] = Field(None, max_length=200)


class NotifyConfIn(BaseModel):
    email_to: Optional[str] = Field(None, max_length=200)
    teams_webhook: Optional[str] = Field(None, max_length=1000)
    min_priority: Optional[str] = Field(None, max_length=20)
    events: Optional[dict[str, dict[str, bool]]] = None
    digest: Optional[dict[str, Any]] = None


def register(app: FastAPI, ctx: Any, settings: Any, admin_only, start: bool = False) -> Notifier:
    svc = Notifier(ctx, settings)
    app.state.notifier = svc
    svc.conf()  # legt beim ersten Start den Zeitpunkt „ab jetzt melden“ fest

    def uid(request: Request) -> int:
        u = getattr(request.state, "user", None)
        return int(u["id"]) if isinstance(u, dict) and u.get("id") else 0

    @app.get("/api/notifications")
    def list_notifications(request: Request, unread: bool = False, limit: int = 30) -> dict:
        if not settings.public_url and not ctx.db.get_setting("notify_base_url", ""):
            ctx.db.set_setting("notify_base_url", str(request.base_url).rstrip("/"))
        try:
            svc.scan()
        except Exception:  # noqa: BLE001 - die Glocke darf nie einen Fehler zeigen
            pass
        return svc.items(uid(request), limit, unread)

    @app.post("/api/notifications/read")
    def read(data: ReadIn, request: Request) -> dict:
        return {"updated": svc.mark_read(uid(request), data.ids)}

    @app.get("/api/notifications/settings", dependencies=[Depends(admin_only)])
    def get_settings() -> dict:
        return svc.public_conf()

    @app.put("/api/notifications/settings", dependencies=[Depends(admin_only)])
    def put_settings(data: NotifyConfIn) -> dict:
        patch = data.model_dump(exclude_none=True)
        if patch.get("teams_webhook") == "":
            patch.pop("teams_webhook")  # leer = unverändert lassen; Löschen über „-“
        elif patch.get("teams_webhook") == "-":
            patch["teams_webhook"] = ""
        try:
            svc.save(patch)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc))
        return svc.public_conf()

    @app.post("/api/notifications/test", dependencies=[Depends(admin_only)])
    def test() -> dict:
        return {"channels": svc.emit("test", "Test-Benachrichtigung", "Wenn du das liest, funktioniert dieser Kanal.",
                                     link="einstellungen", force=True)}

    @app.get("/api/notifications/digest", dependencies=[Depends(admin_only)])
    def digest_preview() -> dict:
        return svc.digest()

    if start:
        def loop() -> None:
            time.sleep(45)
            while True:
                try:
                    svc.scan()
                    svc.maybe_send_digest()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(60)

        threading.Thread(target=loop, name="notify", daemon=True).start()
    return svc
