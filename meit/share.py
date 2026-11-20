"""Sicher teilen: Passwörter und Zugangsdaten als Einmal-Link, Dateien als Freigabe-Link mit Ablaufdatum.

Warum: Startpasswörter, WLAN-Schlüssel oder Verträge gehören nicht im Klartext in eine E-Mail.

- **Geheimnis:** wird mit einem Schlüssel verschlüsselt, der nur im Link steckt. In der Datenbank liegt nur der
  verschlüsselte Text und eine Prüfsumme des Links – ohne den Link kann ihn niemand lesen, auch nicht mit
  Zugriff auf Datenbank oder Sicherung. Nach dem letzten erlaubten Abruf wird der Text gelöscht.
- **Der Link-Schlüssel steht hinter dem „#“** der Adresse. Dieser Teil wird vom Browser nie an einen Server
  gesendet und landet in keinem Protokoll. Link-Prüfer von Mailprogrammen lösen deshalb keinen Abruf aus –
  angezeigt wird erst nach einem Klick des Empfängers.
- **Datei-Freigabe:** Link auf eine abgelegte Datei, begrenzt nach Zeit und Anzahl der Abrufe.
- Optionales Kennwort (getrennt mitteilen), Sperre nach 5 Fehlversuchen, jederzeit widerrufbar, Abruf wird gemeldet.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .audit import record as audit
from .db import Database, now_iso
from .mitarbeiter_api import RateLimiter

GONE = "Dieser Link ist nicht mehr gültig – er ist abgelaufen, wurde widerrufen oder bereits geöffnet."
MAX_FAILED = 5
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def token_hash(token: str) -> str:
    return hashlib.sha256(("meit-share-id|" + token).encode()).hexdigest()


def _fernet(token: str, password: str = ""):
    from cryptography.fernet import Fernet

    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(f"meit-share-key|{token}|{password}".encode()).digest()))


def encrypt(text: str, token: str, password: str = "") -> str:
    return _fernet(token, password).encrypt(text.encode()).decode()


def decrypt(payload: str, token: str, password: str = "") -> str:
    return _fernet(token, password).decrypt(payload.encode()).decode()


def status_of(row: dict[str, Any], now: str | None = None) -> str:
    now = now or now_iso()
    if row["revoked_at"]:
        return "gesperrt" if row["failed"] >= MAX_FAILED else "widerrufen"
    if row["views"] >= row["max_views"]:
        return "abgerufen"
    if row["expires_at"] < now:
        return "abgelaufen"
    return "offen"


class ShareIn(BaseModel):
    kind: str = Field("secret", pattern="^(secret|file)$")
    text: str = Field("", max_length=10000)
    attachment_id: Optional[int] = None
    label: str = Field("", max_length=120)
    customer_id: Optional[int] = None
    expires_hours: int = Field(72, ge=1, le=24 * 30)
    max_views: int = Field(1, ge=1, le=20)
    password: str = Field("", max_length=200)
    email: str = Field("", max_length=200)


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    password: str = Field("", max_length=200)


class Shares:
    def __init__(self, db: Database, store: Any):
        self.db, self.store = db, store

    def cleanup(self) -> None:
        """Abgelaufene Geheimnisse sofort löschen, alte Einträge nach 90 Tagen ganz entfernen."""
        now = now_iso()
        self.db.query("UPDATE shares SET payload = '' WHERE payload != '' AND (expires_at < ? OR revoked_at != '')", (now,))
        old = (datetime.now() - timedelta(days=90)).replace(microsecond=0).isoformat(sep=" ")
        self.db.query("DELETE FROM shares WHERE expires_at < ?", (old,))

    def create(self, data: ShareIn, user: dict[str, Any] | None) -> tuple[dict[str, Any], str]:
        from .team import hash_password

        att = None
        if data.kind == "secret":
            if not data.text.strip():
                raise ValueError("Bitte den Text eingeben, der geteilt werden soll.")
        else:
            att = self.db.get("attachments", data.attachment_id or 0)
            if not att:
                raise LookupError("Datei nicht gefunden")
        if data.customer_id and not self.db.get("customers", data.customer_id):
            raise LookupError("Kunde nicht gefunden")
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(hours=data.expires_hours)).replace(microsecond=0).isoformat(sep=" ")
        label = data.label.strip() or (att["filename"] if att else "Vertrauliche Nachricht")
        customer_id = data.customer_id or (att["ref_id"] if att and att["ref_type"] == "customer" else None)
        sid = self.db.insert("shares", {
            "token_hash": token_hash(token), "kind": data.kind, "label": label,
            "payload": encrypt(data.text, token, data.password) if data.kind == "secret" else "",
            "attachment_id": att["id"] if att else None, "customer_id": customer_id,
            "pass_hash": hash_password(data.password) if data.password else "", "max_views": data.max_views, "expires_at": expires,
            "created_by": (user or {}).get("id"), "created_name": (user or {}).get("name") or "Cockpit"})
        self.cleanup()
        return self.db.get("shares", sid), token

    def view(self, row: dict[str, Any]) -> dict[str, Any]:
        out = {k: row[k] for k in ("id", "kind", "label", "customer_id", "max_views", "views", "expires_at", "created_name", "sent_to",
                                   "last_view_at", "last_view_ip", "created_at", "attachment_id")}
        out.update({"status": status_of(row), "has_password": bool(row["pass_hash"])})
        return out

    def find(self, token: str) -> dict[str, Any] | None:
        row = self.db.query_one("SELECT * FROM shares WHERE token_hash = ?", (token_hash(token),))
        return row if row and status_of(row) == "offen" else None

    def check_password(self, row: dict[str, Any], password: str) -> int:
        """0 = in Ordnung, sonst die Zahl der verbleibenden Versuche (−1 = jetzt gesperrt)."""
        from .team import verify_password

        if not row["pass_hash"] or (password and verify_password(password, row["pass_hash"])):
            return 0
        failed = row["failed"] + 1
        if failed >= MAX_FAILED:
            self.db.query("UPDATE shares SET failed = ?, revoked_at = ?, payload = '' WHERE id = ?", (failed, now_iso(), row["id"]))
            return -1
        self.db.query("UPDATE shares SET failed = ? WHERE id = ?", (failed, row["id"]))
        return MAX_FAILED - failed

    def consume(self, row: dict[str, Any], ip: str) -> dict[str, Any] | None:
        """Einen Abruf verbuchen – genau einmal, auch wenn zwei Anfragen gleichzeitig kommen."""
        with self.db.connect() as conn:
            cur = conn.execute("UPDATE shares SET views = views + 1, last_view_at = ?, last_view_ip = ? "
                               "WHERE id = ? AND views < max_views AND revoked_at = '' AND expires_at >= ?",
                               (now_iso(), ip[:60], row["id"], now_iso()))
            if cur.rowcount != 1:
                return None
            fresh = dict(conn.execute("SELECT * FROM shares WHERE id = ?", (row["id"],)).fetchone())
            if fresh["views"] >= fresh["max_views"]:
                conn.execute("UPDATE shares SET payload = '' WHERE id = ?", (row["id"],))  # nach dem letzten Abruf ist der Text weg
        return fresh

    def revoke(self, sid: int) -> bool:
        if not self.db.get("shares", sid):
            return False
        self.db.query("UPDATE shares SET revoked_at = ?, payload = '' WHERE id = ? AND revoked_at = ''", (now_iso(), sid))
        return True


def register(app: FastAPI, ctx: Any, settings: Any, static_dir: Any) -> Shares:
    db: Database = ctx.db
    svc = Shares(db, app.state.attachments)
    app.state.shares = svc
    company = getattr(settings, "company_name", "ME-IT")
    info_limiter = RateLimiter(limit=120, window_s=600)
    open_limiter = RateLimiter(limit=30, window_s=600)

    def user_of(request: Request) -> dict[str, Any] | None:
        u = getattr(request.state, "user", None)
        return u if isinstance(u, dict) else None

    def base_url(request: Request) -> str:
        return (getattr(settings, "public_url", "") or str(request.base_url)).rstrip("/")

    def ip_of(request: Request) -> str:
        return request.client.host if request.client else "?"

    def send_mail(to: str, row: dict[str, Any], url: str) -> str:
        mailer = getattr(ctx, "mailer", None)
        if not (mailer and getattr(mailer, "smtp_configured", False)):
            return "kein Mailversand eingerichtet – bitte den Link selbst weitergeben"
        what = "eine vertrauliche Nachricht" if row["kind"] == "secret" else f"die Datei „{row['label']}“"
        times = "einmal" if row["max_views"] == 1 else f"{row['max_views']}-mal"
        until = datetime.fromisoformat(row["expires_at"]).strftime("%d.%m.%Y, %H:%M Uhr")
        who = f"{row['created_name']} von {company}" if row["created_name"] and row["created_name"] != "Cockpit" else company
        body = (f"Guten Tag,\n\n{who} hat {what} für Sie bereitgestellt:\n\n{url}\n\n"
                f"Der Link ist bis {until} gültig und kann {times} geöffnet werden."
                + ("\nZum Öffnen brauchen Sie ein Kennwort – das erhalten Sie getrennt von uns (zum Beispiel telefonisch)." if row["pass_hash"] else "")
                + f"\n\nFreundliche Grüße\n{company}")
        try:
            mailer.send(to, f"Sichere Nachricht von {company}", body)
        except Exception as exc:  # noqa: BLE001 - der Link ist trotzdem erstellt
            return f"Versand fehlgeschlagen: {exc}"
        db.update("shares", row["id"], {"sent_to": to})
        return "gesendet"

    # --- Cockpit ------------------------------------------------------------------------------------
    @app.post("/api/shares", status_code=201)
    def create(data: ShareIn, request: Request) -> dict:
        if data.email and not EMAIL.match(data.email.strip()):
            raise HTTPException(422, "Bitte eine gültige E-Mail-Adresse eingeben.")
        try:
            row, token = svc.create(data, user_of(request))
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        url = f"{base_url(request)}/s#{token}"
        mail = send_mail(data.email.strip(), row, url) if data.email.strip() else ""
        return {**svc.view(db.get("shares", row["id"])), "url": url, "mail": mail}

    @app.get("/api/shares")
    def list_shares(customer_id: int = 0, limit: int = 100) -> list[dict]:
        svc.cleanup()
        rows = db.query("SELECT s.*, c.name AS customer FROM shares s LEFT JOIN customers c ON c.id = s.customer_id "
                        + ("WHERE s.customer_id = ? " if customer_id else "") + "ORDER BY s.id DESC LIMIT ?",
                        ((customer_id, min(limit, 500)) if customer_id else (min(limit, 500),)))
        return [{**svc.view(r), "customer": r["customer"] or ""} for r in rows]

    @app.delete("/api/shares/{sid}")
    def revoke(sid: int) -> dict:
        if not svc.revoke(sid):
            raise HTTPException(404, "Freigabe nicht gefunden")
        return {"ok": True}

    # --- Öffentlich: Seite des Empfängers ----------------------------------------------------------
    @app.get("/s", include_in_schema=False)
    def page() -> FileResponse:
        return FileResponse(static_dir / "share.html", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    def lookup(data: TokenIn, request: Request, limiter: RateLimiter) -> dict[str, Any]:
        if not limiter.allow(ip_of(request)):
            raise HTTPException(429, "Zu viele Anfragen – bitte später erneut versuchen.")
        row = svc.find(data.token)
        if not row:
            raise HTTPException(404, GONE)
        return row

    def guarded(data: TokenIn, request: Request) -> dict[str, Any]:
        row = lookup(data, request, open_limiter)
        left = svc.check_password(row, data.password)
        if left:
            audit(db, "Freigabe: falsches Kennwort", ip=ip_of(request), target=row["label"], ok=False)
            raise HTTPException(404, GONE) if left < 0 else HTTPException(403, f"Kennwort falsch – noch {left} Versuch(e).")
        return row

    def opened(row: dict[str, Any], fresh: dict[str, Any], request: Request) -> None:
        audit(db, "Freigabe geöffnet", ip=ip_of(request), target=row["label"],
              detail=f"{'Geheimnis' if row['kind'] == 'secret' else 'Datei'} · Abruf {fresh['views']} von {fresh['max_views']}")
        notifier = getattr(app.state, "notifier", None)
        if notifier:
            try:
                notifier.emit("share", f"Geöffnet: {row['label']}", f"Abruf {fresh['views']} von {fresh['max_views']} · von {ip_of(request)}",
                              link="teilen", user_id=row["created_by"], ref=f"share-{row['id']}-{fresh['views']}")
            except Exception:  # noqa: BLE001 - die Meldung darf den Abruf nicht verhindern
                pass

    @app.post("/api/public/share/info", include_in_schema=False)
    def info(data: TokenIn, request: Request) -> dict:
        row = lookup(data, request, info_limiter)
        out = {"kind": row["kind"], "needs_password": bool(row["pass_hash"]), "expires_at": row["expires_at"],
               "views_left": row["max_views"] - row["views"], "company": company, "from": row["created_name"]}
        if row["kind"] == "file":
            att = db.get("attachments", row["attachment_id"] or 0)
            if not att:
                raise HTTPException(404, GONE)
            out.update({"filename": att["filename"], "size": att["size"]})
        return out

    @app.post("/api/public/share/open", include_in_schema=False)
    def open_secret(data: TokenIn, request: Request) -> dict:
        row = guarded(data, request)
        if row["kind"] != "secret":
            raise HTTPException(404, GONE)
        try:
            text = decrypt(row["payload"], data.token, data.password)
        except Exception:  # noqa: BLE001 - beschädigt oder mit anderem Kennwort verschlüsselt
            raise HTTPException(404, GONE)
        fresh = svc.consume(row, ip_of(request))
        if not fresh:
            raise HTTPException(404, GONE)
        opened(row, fresh, request)
        return {"secret": text, "views_left": fresh["max_views"] - fresh["views"]}

    @app.post("/api/public/share/download", include_in_schema=False)
    def download(data: TokenIn, request: Request) -> Response:
        row = guarded(data, request)
        att = db.get("attachments", row["attachment_id"] or 0) if row["kind"] == "file" else None
        if not att:
            raise HTTPException(404, GONE)
        try:
            content = svc.store.read(att)
        except ValueError:
            raise HTTPException(404, GONE)
        fresh = svc.consume(row, ip_of(request))
        if not fresh:
            raise HTTPException(404, GONE)
        opened(row, fresh, request)
        return Response(content, media_type="application/octet-stream", headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(att['filename'])}", "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store", "X-Views-Left": str(fresh["max_views"] - fresh["views"])})

    return svc
