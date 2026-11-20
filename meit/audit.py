"""Sicherheitsprotokoll: Wer hat sich wann angemeldet, was wurde geändert, exportiert oder gelöscht?

* Anmeldungen (Cockpit und Kundenportal) mit Fehlversuchen, Zwei-Faktor-Änderungen
* sicherheitsrelevante Aktionen: Benutzer, Einstellungen, Zertifikat, Verbindungen, Exporte, Sicherungs-Download,
  Löschungen, Registrierungsschlüssel, gesperrte Geräte, Portal-Zugänge
* Nachweis für Versicherung/NIS2 („Protokollierung von Zugriffen“), Aufbewahrung 400 Tage

Die Aktionen werden zentral über die Adresse der Anfrage erkannt – neue Funktionen müssen nur in ``RULES`` ergänzt werden.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.responses import Response

from .db import Database, now_iso
from .hardening import csv_safe

RETENTION_DAYS = 400
# (Methode, Muster, Bezeichnung) – erste passende Regel gewinnt
RULES: list[tuple[str, re.Pattern, str]] = [(m, re.compile(p), label) for m, p, label in [
    ("POST", r"^/api/auth/logout$", "Abmeldung"),
    ("POST", r"^/api/shares$", "Freigabe-Link erstellt"),
    ("POST", r"^/api/calendar/feeds$", "Kalender-Abo erzeugt"),
    ("POST", r"^/api/monitors$", "Überwachung angelegt"),
    ("PUT", r"^/api/monitors/\d+$", "Überwachung geändert"),
    ("DELETE", r"^/api/monitors/\d+$", "Überwachung gelöscht"),
    ("POST", r"^/api/billing/items$", "Einmalposition angelegt"),
    ("PUT", r"^/api/billing/items/\d+$", "Einmalposition geändert"),
    ("DELETE", r"^/api/billing/items/\d+$", "Einmalposition gelöscht"),
    ("POST", r"^/api/work-reports/\d+/sign$", "Arbeitsbericht abgeschlossen"),
    ("POST", r"^/api/work-reports/\d+/send$", "Arbeitsbericht versendet"),
    ("DELETE", r"^/api/appointments/\d+$", "Termin gelöscht"),
    ("DELETE", r"^/api/shares/\d+$", "Freigabe-Link widerrufen"),
    ("POST", r"^/api/auth/2fa/enable$", "Zwei-Faktor-Anmeldung aktiviert"),
    ("POST", r"^/api/auth/2fa/disable$", "Zwei-Faktor-Anmeldung deaktiviert"),
    ("POST", r"^/api/users/\d+/2fa/reset$", "Zwei-Faktor-Anmeldung zurückgesetzt"),
    ("POST", r"^/api/users$", "Benutzer angelegt"),
    ("PUT", r"^/api/users/\d+$", "Benutzer geändert"),
    ("POST", r"^/api/customers/\d+/portal-users$", "Portal-Zugang angelegt"),
    ("PUT", r"^/api/portal-users/\d+$", "Portal-Zugang geändert"),
    ("DELETE", r"^/api/customers/\d+$", "Kunde gelöscht"),
    ("POST", r"^/api/setup/demo/remove$", "Demodaten entfernt"),
    ("PUT", r"^/api/ai/settings$", "KI-/Claude-Einstellungen geändert"),
    ("PUT", r"^/api/billing/profile$", "Firmendaten geändert"),
    ("PUT", r"^/api/documents/settings$", "Dokumentenablage geändert"),
    ("PUT", r"^/api/notifications/settings$", "Benachrichtigungen geändert"),
    ("PUT", r"^/api/office/settings$", "Office-Server geändert"),
    ("POST", r"^/api/files/\d+/versions/\d+/restore$", "Dateiversion wiederhergestellt"),
    ("POST", r"^/api/connections/certificate$", "Zertifikat erzeugt"),
    ("POST", r"^/api/connections/certificate/activate$", "Zertifikat aktiviert"),
    ("POST", r"^/api/connections/certificate/deactivate$", "Zertifikat deaktiviert"),
    ("POST", r"^/api/m365/\d+/consent-link$", "Microsoft-365-Zustimmungslink erzeugt"),
    ("DELETE", r"^/api/m365/\d+$", "Microsoft-365-Verbindung getrennt"),
    ("POST", r"^/api/todo/connect$", "Microsoft To Do: Verbindung gestartet"),
    ("DELETE", r"^/api/todo$", "Microsoft To Do getrennt"),
    ("POST", r"^/api/inventory/keys$", "Agent-Registrierungsschlüssel erzeugt"),
    ("DELETE", r"^/api/inventory/keys/\d+$", "Agent-Registrierungsschlüssel widerrufen"),
    ("PUT", r"^/api/inventory/\d+/active$", "Gerät gesperrt/zugelassen"),
    ("DELETE", r"^/api/inventory/\d+$", "Gerät entfernt"),
    ("GET", r"^/api/backup/download$", "Datensicherung heruntergeladen"),
    ("GET", r"^/api/receipts/export\.csv$", "Belege exportiert"),
    ("GET", r"^/api/invoices/export", "Rechnungen exportiert"),
    ("GET", r"^/api/audit/export\.csv$", "Sicherheitsprotokoll exportiert"),
    ("GET", r"^/api/training/export", "Trainingsdaten exportiert"),
    ("POST", r"^/api/security/secrets/redact$", "Zugangsdaten geschwärzt"),
    ("DELETE", r"^/api/attachments/\d+$", "Anhang gelöscht"),
    ("POST", r"^/api/sepa/batches", "SEPA-Einzugsdatei erstellt"),
]]


def record(db: Database, action: str, *, actor: str = "", user_id: int | None = None, ip: str = "", target: str = "",
           detail: str = "", ok: bool = True) -> int:
    return db.insert("audit_log", {"at": now_iso(), "actor": actor[:200], "user_id": user_id, "ip": ip[:60], "action": action[:120],
                                   "target": target[:200], "detail": detail[:500], "ok": ok})


def match(method: str, path: str) -> str | None:
    for m, pattern, label in RULES:
        if m == method and pattern.search(path):
            return label
    return None


def failed_logins(db: Database, minutes: int = 10) -> list[dict[str, Any]]:
    """Gehäufte Fehlversuche (≥ 5 je Konto oder Adresse) in den letzten Minuten – für die Benachrichtigung."""
    since = (datetime.now() - timedelta(minutes=minutes)).replace(microsecond=0).isoformat(sep=" ")
    rows = db.query("SELECT target, ip, COUNT(*) AS n FROM audit_log WHERE ok = 0 AND action LIKE 'Anmeldung%' AND at >= ? "
                    "GROUP BY target, ip HAVING COUNT(*) >= 5", (since,))
    return rows


def cleanup(db: Database) -> None:
    limit = (datetime.now() - timedelta(days=RETENTION_DAYS)).replace(microsecond=0).isoformat(sep=" ")
    db.query("DELETE FROM audit_log WHERE at < ?", (limit,))


def register(app: FastAPI, db: Database, admin_only) -> None:
    cleanup(db)

    @app.middleware("http")
    async def audit(request: Request, call_next):
        response = await call_next(request)
        label = match(request.method, request.url.path)
        if label:
            user = getattr(request.state, "user", None) or {}
            try:
                record(db, label, actor=user.get("name") or user.get("email") or "–", user_id=user.get("id"),
                       ip=request.client.host if request.client else "", target=request.url.path,
                       detail="" if response.status_code < 400 else f"HTTP {response.status_code}", ok=response.status_code < 400)
            except Exception:  # noqa: BLE001 - Protokollfehler darf die Anfrage nie stören
                pass
        return response

    def rows(q: str = "", only_failed: bool = False, limit: int = 200) -> list[dict[str, Any]]:
        sql, params = "SELECT * FROM audit_log WHERE 1 = 1", []
        if q:
            sql += " AND (action LIKE ? OR actor LIKE ? OR target LIKE ? OR ip LIKE ?)"
            params += [f"%{q}%"] * 4
        if only_failed:
            sql += " AND ok = 0"
        return db.query(sql + " ORDER BY id DESC LIMIT ?", [*params, max(1, min(limit, 5000))])

    @app.get("/api/audit", dependencies=[Depends(admin_only)])
    def list_audit(q: str = "", failed: bool = False, limit: int = 200) -> dict:
        since = (datetime.now() - timedelta(days=30)).replace(microsecond=0).isoformat(sep=" ")
        return {"entries": rows(q, failed, limit),
                "summary": {"logins_30d": db.scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'Anmeldung' AND ok = 1 AND at >= ?", (since,)) or 0,
                            "failed_30d": db.scalar("SELECT COUNT(*) FROM audit_log WHERE action LIKE 'Anmeldung%' AND ok = 0 AND at >= ?", (since,)) or 0,
                            "total": db.scalar("SELECT COUNT(*) FROM audit_log") or 0, "retention_days": RETENTION_DAYS}}

    @app.get("/api/audit/export.csv", dependencies=[Depends(admin_only)])
    def export(q: str = "", failed: bool = False) -> Response:
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        w.writerow(["Zeit", "Wer", "Adresse", "Aktion", "Ziel", "Hinweis", "Erfolgreich"])
        for r in rows(q, failed, 5000):
            w.writerow([r["at"], csv_safe(r["actor"]), csv_safe(r["ip"]), csv_safe(r["action"]), csv_safe(r["target"]),
                        csv_safe(r["detail"]), "ja" if r["ok"] else "nein"])
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="sicherheitsprotokoll.csv"'})


