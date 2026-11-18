"""Verbindungs-Center: alle Anbindungen auf einen Blick – mit Sicherheitsprüfung.

Für jede Anbindung (Microsoft 365, SharePoint/OneDrive, Kunden-Tenants, To Do, BookStack, Atera, Claude,
Cockpit-Zugang, Datensicherung) gibt es eine statische Prüfung (sofort) und einen Live-Test. Der Live-Test liest
bei Microsoft die **tatsächlich erteilten Berechtigungen** aus dem Token und warnt vor zu weitreichenden Rechten
(z. B. Zugriff auf *alle* SharePoint-Seiten statt nur auf die eine Site), bei BookStack vor Admin-Tokens.
Außerdem: Zertifikat für die Microsoft-Anmeldung erzeugen, herunterladen (nur öffentlicher Teil) und aktivieren.
"""

from __future__ import annotations

import ipaddress
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse

from . import msauth
from .db import Database, now_iso

CRITICAL_ROLES = {"Directory.ReadWrite.All", "User.ReadWrite.All", "Application.ReadWrite.All", "AppRoleAssignment.ReadWrite.All",
                  "RoleManagement.ReadWrite.Directory", "Sites.FullControl.All", "Group.ReadWrite.All", "Policy.ReadWrite.ConditionalAccess"}
BROAD_STORAGE = {"Sites.ReadWrite.All", "Files.ReadWrite.All", "Sites.Manage.All"}
MAIL_ROLES = {"Mail.ReadWrite", "Mail.Send", "Mail.Read", "Calendars.Read", "Calendars.ReadWrite", "MailboxSettings.ReadWrite"}


def check(level: str, text: str) -> dict[str, str]:
    return {"level": level, "text": text}


def overall(checks: list[dict[str, str]], configured: bool) -> str:
    if not configured:
        return "aus"
    levels = {c["level"] for c in checks}
    return "bad" if "bad" in levels else "warn" if "warn" in levels else "ok"


def url_checks(url: str, label: str) -> list[dict[str, str]]:
    u = urlparse(url or "")
    if not u.scheme:
        return []
    if u.scheme == "https":
        return [check("ok", f"{label} über HTTPS (verschlüsselt)")]
    host = (u.hostname or "").lower()
    private = host in ("localhost",) or host.endswith((".local", ".lan", ".intern", ".internal"))
    try:
        private = private or ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if private:
        return [check("warn", f"{label} ohne HTTPS (nur im internen Netz) – Token gehen unverschlüsselt durchs LAN")]
    return [check("bad", f"{label} ohne HTTPS über das Internet – Zugangsdaten werden im Klartext übertragen")]


def role_checks(roles: list[str], purpose: str, read_only: bool = False) -> list[dict[str, str]]:
    out = []
    rs = set(roles)
    if not rs:
        return [check("info", "Keine Anwendungsberechtigungen im Token")]
    out.append(check("info", "Erteilte Rechte: " + ", ".join(sorted(rs))))
    for r in sorted(rs & CRITICAL_ROLES):
        out.append(check("bad", f"{r}: weit mehr als nötig – entfernen (Vollzugriff auf Verzeichnis/Seiten)"))
    if read_only:
        for r in sorted(x for x in rs if "Write" in x or x.endswith(".Send") or "FullControl" in x):
            if r not in CRITICAL_ROLES:
                out.append(check("bad", f"{r}: Die {purpose} braucht nur Leserechte – entfernen"))
        return out
    broad = sorted(rs & BROAD_STORAGE)
    if broad:
        out.append(check("warn", f"{', '.join(broad)}: Zugriff auf alle SharePoint-Seiten/OneDrives des Tenants – "
                                 "besser „Sites.Selected“ und nur die Ablage-Site freigeben"))
    if "Sites.Selected" in rs:
        out.append(check("ok", "Sites.Selected: Zugriff nur auf ausdrücklich freigegebene SharePoint-Sites"))
    if rs & {"Mail.ReadWrite", "Mail.Send", "Mail.Read"}:
        out.append(check("warn", "Mail-Rechte sind tenant-weit erteilt (die App könnte jedes Postfach lesen) – per Exchange "
                                 "RBAC für Anwendungen auf das ME-IT-Postfach beschränken und die Entra-Berechtigung entfernen"))
    return out


class Connections:
    def __init__(self, app: FastAPI, ctx: Any, settings: Any, data_dir: Path):
        self.app, self.ctx, self.db, self.s, self.data_dir = app, ctx, ctx.db, settings, Path(data_dir)

    # ------------------------------------------------------------------ Zertifikat
    def cert_info(self) -> dict[str, Any]:
        active = msauth.active_certificate()
        generated = sorted(msauth.cert_dir(self.data_dir).glob("meit-graph*.pem"))
        latest = None
        if generated:
            try:
                c = msauth.load_certificate(generated[-1])
                latest = {"path": str(c.path), "thumbprint": c.thumbprint_sha1, "not_after": c.not_after.date().isoformat(),
                          "active": bool(active and active.path.resolve() == c.path.resolve())}
            except msauth.MsAuthError:
                latest = None
        return {"active": {"path": str(active.path), "thumbprint": active.thumbprint_sha1,
                           "not_after": active.not_after.date().isoformat(),
                           "days_left": (active.not_after.date() - date.today()).days} if active else None,
                "generated": latest, "from_env": bool(self.s.graph_cert_file)}

    def generate_cert(self) -> dict[str, Any]:
        name = f"meit-graph-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        out = msauth.generate_certificate(msauth.cert_dir(self.data_dir), name=name,
                                          subject=f"{getattr(self.s, 'company_name', 'ME-IT')} Cockpit")
        return {**out, "download": "/api/connections/certificate/cer"}

    def activate_cert(self) -> dict[str, Any]:
        info = self.cert_info()
        if not info["generated"]:
            raise ValueError("Noch kein Zertifikat erzeugt.")
        previous = msauth.active_certificate()
        path = info["generated"]["path"]
        msauth.configure(path)
        try:
            src = msauth.TokenSource(self.s.graph_tenant_id, self.s.graph_client_id, "")  # nur Zertifikat
            src.token()
        except msauth.MsAuthError as exc:
            msauth.configure(str(previous.path) if previous else "")
            raise ValueError(f"Anmeldung mit dem Zertifikat klappt noch nicht: {exc}. Wurde die .cer-Datei in der "
                             "App-Registrierung unter „Zertifikate & Geheimnisse → Zertifikate“ hochgeladen?") from exc
        self.db.set_setting("graph_cert_file", path)
        self._reset_clients()
        return {"ok": True, "thumbprint": info["generated"]["thumbprint"],
                "hint": "Aktiv. Das Geheimnis (GRAPH_CLIENT_SECRET) kann jetzt aus der .env und der App-Registrierung entfernt werden."}

    def deactivate_cert(self) -> None:
        self.db.set_setting("graph_cert_file", "")
        msauth.configure(self.s.graph_cert_file if self.s.graph_cert_file else "")
        self._reset_clients()

    def _reset_clients(self) -> None:
        mailer = getattr(self.ctx, "mailer", None)
        if mailer is not None and hasattr(mailer, "auth"):
            mailer.auth._token = None
        docs = getattr(self.ctx, "docs", None)
        if docs is not None:
            docs._drive = None

    # ------------------------------------------------------------------ Einzelprüfungen
    def _login(self, live: bool) -> dict[str, Any]:
        from .team import users_exist

        checks = []
        users = users_exist(self.db)
        if users:
            checks.append(check("ok", "Anmeldung mit Benutzern und Rollen aktiv"))
        elif self.s.app_password:
            checks.append(check("warn", "Nur ein gemeinsames Passwort (MEIT_PASSWORD) – besser Benutzer anlegen (Einstellungen)"))
        else:
            checks.append(check("bad", "Cockpit ohne Anmeldung – unter Einstellungen → Benutzer einen Admin anlegen"))
        host = os.environ.get("MEIT_HOST", "127.0.0.1")
        if host not in ("127.0.0.1", "localhost", "::1"):
            checks.append(check("info" if users else "bad", f"Cockpit lauscht auf {host} (im Netzwerk erreichbar)"
                                + ("" if users else " – ohne Anmeldung kann jeder im Netz zugreifen")))
        checks += url_checks(self.s.public_url, "Öffentliche Adresse (Formular/Portal)")
        if not self.s.public_url:
            checks.append(check("info", "PUBLIC_URL nicht gesetzt – Links in Mails/To Do zeigen auf die lokale Adresse"))
        return {"key": "login", "name": "Cockpit-Zugang", "configured": True, "checks": checks}

    def _microsoft(self, live: bool) -> dict[str, Any]:
        s = self.s
        configured = bool(s.graph_tenant_id and s.graph_client_id and msauth.has_credential(s.graph_client_secret))
        checks: list[dict[str, str]] = []
        cert = msauth.active_certificate()
        if cert:
            days = (cert.not_after.date() - date.today()).days
            checks.append(check("bad" if days < 0 else "warn" if days < 30 else "ok",
                                f"Anmeldung per Zertifikat ({cert.thumbprint_sha1[:12]}…), gültig bis "
                                f"{cert.not_after.strftime('%d.%m.%Y')}" + (" – ABGELAUFEN" if days < 0 else
                                                                         f" – in {days} Tagen erneuern" if days < 30 else "")))
            if s.graph_client_secret:
                checks.append(check("info", "Zusätzlich ist ein Geheimnis hinterlegt (Rückfallebene) – kann entfernt werden"))
        elif s.graph_client_secret:
            checks.append(check("warn", "Anmeldung per Geheimnis – Zertifikat ist sicherer (kann nicht abgefischt werden, "
                                        "bleibt am Server). Unten „Zertifikat erzeugen“."))
        detail: dict[str, Any] = {"certificate": self.cert_info(), "tenant": s.graph_tenant_id, "client_id": s.graph_client_id}
        if live and configured:
            try:
                src = msauth.TokenSource(s.graph_tenant_id, s.graph_client_id, s.graph_client_secret)
                claims = src.claims()
                checks.append(check("ok", f"Anmeldung erfolgreich ({'Zertifikat' if src.method == 'zertifikat' else 'Geheimnis'})"))
                if src.method == "geheimnis" and cert:
                    checks.append(check("warn", "Zertifikat ist aktiv, wurde aber abgelehnt – Anmeldung lief über das Geheimnis"))
                checks += role_checks(list(claims.get("roles") or []), "App")
                detail["roles"] = sorted(claims.get("roles") or [])
            except msauth.MsAuthError as exc:
                checks.append(check("bad", str(exc)))
        return {"key": "microsoft", "name": "Microsoft 365 (eigener Tenant)", "configured": configured, "checks": checks,
                "detail": detail}

    def _sharepoint(self, live: bool) -> dict[str, Any]:
        docs = getattr(self.ctx, "docs", None)
        conf = docs.conf() if docs else {"target": "lokal"}
        configured = conf.get("target") in ("sharepoint", "onedrive")
        checks = [check("info", f"Ablage: {'SharePoint ' + conf.get('sharepoint_site', '') if conf.get('target') == 'sharepoint' else 'OneDrive ' + conf.get('onedrive_user', '') if conf.get('target') == 'onedrive' else 'nur lokal'}")]
        detail: dict[str, Any] = {"target": conf.get("target")}
        if live and configured and docs:
            try:
                drive = docs.drive(conf)
                t = drive.test()
                checks.append(check("ok", f"Lesen: {t.get('url') or t.get('name')}"))
                w = drive.write_test()
                checks.append(check("ok", "Schreiben + Löschen einer Testdatei erfolgreich"))
                detail["url"] = t.get("url") or w.get("url")
                if conf.get("target") == "sharepoint":
                    try:
                        detail["site_id"] = drive.site_id()
                    except Exception:  # noqa: BLE001
                        pass
            except Exception as exc:  # noqa: BLE001 - Ergebnis anzeigen statt abbrechen
                checks.append(check("bad", f"{exc}"))
        return {"key": "sharepoint", "name": "SharePoint / OneDrive (Dokumente)", "configured": configured, "checks": checks,
                "detail": detail}

    def _customers(self, live: bool) -> dict[str, Any]:
        svc = getattr(self.app.state, "m365", None)
        configured = bool(svc and svc.configured)
        tenants = self.db.query("SELECT t.customer_id, t.tenant_id, t.domain, t.status, c.name FROM m365_tenants t "
                                "JOIN customers c ON c.id = t.customer_id ORDER BY t.last_sync DESC")
        connected = [t for t in tenants if t["status"] == "verbunden"]
        checks = [check("info", f"{len(connected)} von {len(tenants)} Kunden-Tenants verbunden")]
        if live and configured and connected:
            t = connected[0]
            try:
                claims = svc.factory(t["tenant_id"] or t["domain"]).auth.claims()
                checks.append(check("ok", f"Anmeldung bei {t['name']} erfolgreich"))
                checks += role_checks(list(claims.get("roles") or []), "Kunden-App", read_only=True)
            except AttributeError:
                checks.append(check("info", "Live-Prüfung der Rechte nicht möglich"))
            except Exception as exc:  # noqa: BLE001
                checks.append(check("bad", f"{t['name']}: {exc}"))
        return {"key": "kunden_m365", "name": "Microsoft 365 der Kunden (nur lesend)", "configured": configured, "checks": checks}

    def _todo(self, live: bool) -> dict[str, Any]:
        svc = getattr(self.app.state, "todo", None)
        configured = bool(svc and svc.configured)
        accounts = self.db.query("SELECT upn, last_sync, error FROM ms_accounts WHERE refresh_token != ''")
        checks = [check("ok", "Nur delegierte Rechte (Tasks.ReadWrite): jeder verbindet ausschließlich seine eigenen Aufgaben"),
                  check("info", f"{len(accounts)} Benutzer verbunden")]
        if svc:
            checks.append(check("ok", f"Anmeldungen verschlüsselt gespeichert (Schlüssel: {svc.vault.source})"))
        checks += [check("warn", f"{a['upn']}: {a['error']}") for a in accounts if a["error"]]
        return {"key": "todo", "name": "Microsoft To Do", "configured": configured, "checks": checks}

    def _bookstack(self, live: bool) -> dict[str, Any]:
        from .bookstack import BookStack, BookStackError

        s = self.s
        client = BookStack(s.bookstack_url, s.bookstack_token_id, s.bookstack_token_secret)
        checks = url_checks(s.bookstack_url, "BookStack")
        if live and client.configured:
            try:
                books = client._req("GET", "/books", params={"count": 1})
                checks.append(check("ok", f"Zugriff ok ({books.get('total', 0)} Bücher sichtbar)"))
                admin = []
                for path, label in (("/users", "Benutzer verwalten"), ("/roles", "Rollen verwalten"), ("/audit-log", "Audit-Log lesen")):
                    try:
                        client._req("GET", path, params={"count": 1})
                        admin.append(label)
                    except BookStackError:
                        pass
                if admin:
                    checks.append(check("warn", "Token hat Admin-Rechte (" + ", ".join(admin) + ") – eigenen API-Benutzer mit "
                                                "Rolle „Cockpit“ anlegen: nur System-API + Bücher/Seiten bearbeiten"))
                else:
                    checks.append(check("ok", "Token ohne Admin-Rechte (eingeschränkte Rolle)"))
            except BookStackError as exc:
                checks.append(check("bad", str(exc)))
        return {"key": "bookstack", "name": "BookStack (IT-Doku, Wissen)", "configured": client.configured, "checks": checks}

    def _atera(self, live: bool) -> dict[str, Any]:
        from .atera import Atera, AteraError

        client = Atera(self.s.atera_api_key)
        checks = [check("info", "Der Atera-API-Schlüssel hat Vollzugriff – nur in der .env auf diesem Server speichern, "
                                "bei Personalwechsel in Atera neu erzeugen")] if client.configured else []
        if live and client.configured:
            try:
                client.get("/customers", {"itemsInPage": 1})
                checks.append(check("ok", "Verbindung zu Atera erfolgreich"))
            except AteraError as exc:
                checks.append(check("bad", str(exc)))
        return {"key": "atera", "name": "Atera (RMM, Splashtop)", "configured": client.configured, "checks": checks}

    def _claude(self, live: bool) -> dict[str, Any]:
        control = getattr(self.ctx.router, "control", None)
        key = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
        checks = []
        if control is not None:
            c = control.conf()
            checks.append(check("info", "Cloud-KI ist " + ("eingeschaltet" if c["cloud_enabled"] else "aus (nichts verlässt das Haus)")))
            if c["cloud_enabled"]:
                checks.append(check("ok" if c["mask_pii"] else "warn", "Pseudonymisierung " + ("aktiv" if c["mask_pii"] else
                                                                                               "aus – E-Mail-Adressen, Telefonnummern und IBANs gehen im Klartext an Claude")))
                checks.append(check("ok", f"Monatsbudget {c['budget_usd']:.0f} USD, Passwörter werden immer geschwärzt"))
        return {"key": "claude", "name": "Claude (Cloud-KI)", "configured": key, "checks": checks}

    def _backup(self, live: bool) -> dict[str, Any]:
        last = self.db.get_setting("backup_last", "")
        checks = []
        if last:
            try:
                when = datetime.fromisoformat(last.replace("Z", "+00:00"))
                now = datetime.now(when.tzinfo) if when.tzinfo else datetime.now()
                age = (now - when).days
            except ValueError:
                age = 0
            checks.append(check("ok" if age <= 2 else "warn", f"Letzte Datensicherung {last[:10]}" + (f" ({age} Tage alt)" if age > 2 else "")))
        else:
            checks.append(check("warn", "Noch keine Datensicherung erstellt"))
        checks.append(check("info", "Tresor-Schlüssel (tresor.key) und Zertifikate liegen getrennt von der Datenbank – "
                                    "für eine Wiederherstellung separat und sicher (z. B. in Keeper) aufbewahren"))
        return {"key": "backup", "name": "Datensicherung", "configured": self.s.backup_hours > 0, "checks": checks}

    CHECKS: dict[str, str] = {"login": "_login", "microsoft": "_microsoft", "sharepoint": "_sharepoint",
                              "kunden_m365": "_customers", "todo": "_todo", "bookstack": "_bookstack", "atera": "_atera",
                              "claude": "_claude", "backup": "_backup"}

    def run(self, key: str, live: bool = False) -> dict[str, Any]:
        fn: Callable[[bool], dict[str, Any]] = getattr(self, self.CHECKS[key])
        r = fn(live)
        r["status"] = overall(r["checks"], r["configured"])
        if live:
            r["tested_at"] = now_iso()
            self.db.set_setting(f"conn_test_{key}", {"status": r["status"], "at": r["tested_at"], "checks": r["checks"]})
        else:
            last = self.db.get_setting(f"conn_test_{key}", None)
            if last:
                r["last_test"] = last
        return r

    def all(self) -> list[dict[str, Any]]:
        return [self.run(k) for k in self.CHECKS]


def register(app: FastAPI, ctx: Any, settings: Any, admin_only, data_dir: Path) -> Connections:
    conn = Connections(app, ctx, settings, data_dir)
    app.state.connections = conn
    db: Database = ctx.db

    # Zertifikat beim Start aktivieren (.env hat Vorrang vor der Einstellung im Cockpit)
    path = settings.graph_cert_file or db.get_setting("graph_cert_file", "") or ""
    try:
        msauth.configure(path)
        db.set_setting("graph_cert_error", "")
    except msauth.MsAuthError as exc:
        msauth.configure("")
        db.set_setting("graph_cert_error", str(exc))

    @app.get("/api/connections", dependencies=[Depends(admin_only)])
    def overview() -> dict:
        items = conn.all()
        return {"items": items, "summary": {s: len([i for i in items if i["status"] == s]) for s in ("ok", "warn", "bad", "aus")},
                "cert_error": db.get_setting("graph_cert_error", "")}

    @app.post("/api/connections/{key}/test", dependencies=[Depends(admin_only)])
    def test(key: str) -> dict:
        if key not in Connections.CHECKS:
            raise HTTPException(404, "Unbekannte Verbindung")
        return conn.run(key, live=True)

    @app.get("/api/connections/certificate", dependencies=[Depends(admin_only)])
    def cert_info() -> dict:
        return conn.cert_info()

    @app.post("/api/connections/certificate", status_code=201, dependencies=[Depends(admin_only)])
    def cert_generate() -> dict:
        return conn.generate_cert()

    @app.get("/api/connections/certificate/cer", dependencies=[Depends(admin_only)])
    def cert_download() -> FileResponse:
        info = conn.cert_info()
        if not info["generated"]:
            raise HTTPException(404, "Noch kein Zertifikat erzeugt")
        cer = Path(info["generated"]["path"]).with_suffix(".cer")
        return FileResponse(cer, media_type="application/pkix-cert", filename="ME-IT-Cockpit.cer")

    @app.post("/api/connections/certificate/activate", dependencies=[Depends(admin_only)])
    def cert_activate() -> dict:
        try:
            return conn.activate_cert()
        except ValueError as exc:
            raise HTTPException(409, str(exc))

    @app.post("/api/connections/certificate/deactivate", dependencies=[Depends(admin_only)])
    def cert_deactivate() -> dict:
        conn.deactivate_cert()
        return {"ok": True}

    @app.get("/api/connections/sharepoint/grant", dependencies=[Depends(admin_only)])
    def sharepoint_grant() -> dict:
        """Freigabe „Sites.Selected“: genau diese eine Site für die App freischalten (einmalig durch einen Admin)."""
        docs = ctx.docs
        conf = docs.conf()
        if conf.get("target") != "sharepoint":
            raise HTTPException(409, "Als Ablage ist keine SharePoint-Site eingetragen")
        site_id = ""
        try:
            site_id = docs.drive(conf).site_id()
        except Exception:  # noqa: BLE001 - ohne Zugriff kennt die App die Site-ID noch nicht
            pass
        app_id = settings.graph_client_id
        body = {"roles": ["write"], "grantedToIdentities": [{"application": {"id": app_id, "displayName": "ME-IT Cockpit"}}]}
        return {"site": conf.get("sharepoint_site"), "site_id": site_id, "app_id": app_id,
                "request": f"POST https://graph.microsoft.com/v1.0/sites/{site_id or '{site-id}'}/permissions", "body": body,
                "site_id_request": "GET https://graph.microsoft.com/v1.0/sites/" + conf.get("sharepoint_site", "")
                .replace("https://", "").replace(".sharepoint.com/", ".sharepoint.com:/", 1)}

    return conn
