"""Erste Schritte: Inbetriebnahme-Assistent mit Live-Status – was ist erledigt, was fehlt, **wo** stellt man es ein.

Jeder Schritt prüft den tatsächlichen Zustand (Benutzer vorhanden? Postfach verbunden? Sicherung gelaufen?).
Schritte, die sich nicht automatisch prüfen lassen (Steuerberater, Verträge), werden von Hand abgehakt.
Außerdem: Demodaten sauber entfernen (inkl. aller daran hängenden Tickets, Nachrichten, Belege).
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import msauth
from .billing import company_profile
from .db import Database

DEMO_MAIL = ("%-demo.at", "%-demo.com", "%.demo@%")
MANUAL = {"services", "steuer", "avv"}
CONFIRM = "DEMO LÖSCHEN"


def demo_customer_ids(db: Database) -> list[int]:
    return [r["id"] for r in db.query("SELECT id FROM customers WHERE email LIKE ? OR email LIKE ?", DEMO_MAIL[:2])]


def _tables_with(db: Database, column: str) -> list[str]:
    out = []
    for t in db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"):
        with db.connect() as conn:
            if any(row[1] == column for row in conn.execute(f"PRAGMA table_info({t['name']})")):
                out.append(t["name"])
    return out


def demo_preview(db: Database) -> dict[str, Any]:
    ids = demo_customer_ids(db)
    marks = ", ".join("?" for _ in ids) or "NULL"
    count = lambda sql, params=(): db.scalar(sql, params) or 0  # noqa: E731
    msgs = count("SELECT COUNT(*) FROM messages WHERE from_email LIKE ? OR from_email LIKE ? OR from_email LIKE ?", DEMO_MAIL)
    return {
        "customers": len(ids),
        "names": [r["name"] for r in db.query(f"SELECT name FROM customers WHERE id IN ({marks}) ORDER BY name", ids)],
        "tickets": count(f"SELECT COUNT(*) FROM tickets WHERE customer_id IN ({marks})", ids),
        "assets": count(f"SELECT COUNT(*) FROM assets WHERE customer_id IN ({marks})", ids),
        "invoices": count(f"SELECT COUNT(*) FROM invoices WHERE customer_id IN ({marks})", ids),
        "invoices_final": count(f"SELECT COUNT(*) FROM invoices WHERE customer_id IN ({marks}) AND COALESCE(number, '') != ''", ids),
        "messages": msgs,
        "leads": count("SELECT COUNT(*) FROM leads WHERE email LIKE ? OR email LIKE ? OR email LIKE ?", DEMO_MAIL),
        "present": bool(ids or msgs), "confirm": CONFIRM,
    }


def remove_demo(db: Database) -> dict[str, int]:
    """Demokunden samt allem, was an ihnen hängt, löschen. Echte Kunden bleiben unberührt."""
    ids = demo_customer_ids(db)
    removed: dict[str, int] = {}
    with db.connect() as conn:
        demo_msgs = [r[0] for r in conn.execute(
            "SELECT id FROM messages WHERE from_email LIKE ? OR from_email LIKE ? OR from_email LIKE ?", DEMO_MAIL)]
        m_marks = ", ".join("?" for _ in demo_msgs) or "NULL"
        # aus Demo-Nachrichten entstandene Tickets/Leads/Belege ohne Kunden
        for linked, table in (("ticket", "tickets"), ("lead", "leads"), ("receipt", "receipts")):
            cur = conn.execute(f"DELETE FROM {table} WHERE id IN (SELECT linked_id FROM messages WHERE linked_type = ? "
                               f"AND id IN ({m_marks}))", [linked, *demo_msgs])
            removed[table] = removed.get(table, 0) + cur.rowcount
        cur = conn.execute("DELETE FROM leads WHERE email LIKE ? OR email LIKE ? OR email LIKE ?", DEMO_MAIL)
        removed["leads"] = removed.get("leads", 0) + cur.rowcount
        if ids:
            marks = ", ".join("?" for _ in ids)
            tickets = [r[0] for r in conn.execute(f"SELECT id FROM tickets WHERE customer_id IN ({marks})", ids)]
            if tickets:
                t_marks = ", ".join("?" for _ in tickets)
                conn.execute(f"DELETE FROM messages WHERE linked_type = 'ticket' AND linked_id IN ({t_marks})", tickets)
                conn.execute(f"DELETE FROM attachments WHERE ref_type = 'ticket' AND ref_id IN ({t_marks})", tickets)
            for table in _tables_with(db, "customer_id"):
                if table == "customers":
                    continue
                cur = conn.execute(f"DELETE FROM {table} WHERE customer_id IN ({marks})", ids)
                removed[table] = removed.get(table, 0) + cur.rowcount
            cur = conn.execute(f"DELETE FROM customers WHERE id IN ({marks})", ids)
            removed["customers"] = cur.rowcount
        cur = conn.execute(f"DELETE FROM messages WHERE id IN ({m_marks})", demo_msgs)
        removed["messages"] = removed.get("messages", 0) + cur.rowcount
    db.set_setting("demo_removed", True)  # verhindert, dass beim nächsten Start neue Demodaten entstehen
    return {k: v for k, v in removed.items() if v}


class Setup:
    def __init__(self, app: FastAPI, ctx: Any, settings: Any):
        self.app, self.ctx, self.db, self.s = app, ctx, ctx.db, settings

    def steps(self) -> list[dict[str, Any]]:
        db, s = self.db, self.s
        manual = set(db.get_setting("setup_done", []) or [])
        scalar = lambda sql, p=(): db.scalar(sql, p) or 0  # noqa: E731
        users = scalar("SELECT COUNT(*) FROM users WHERE active = 1")
        admins_no_2fa = scalar("SELECT COUNT(*) FROM users WHERE active = 1 AND role = 'admin' AND totp_enabled = 0")
        prof = company_profile(db, s.company_name)
        demo = demo_customer_ids(db)
        real = scalar("SELECT COUNT(*) FROM customers") - len(demo)
        mailer = getattr(self.ctx, "mailer", None)
        mail_ok = bool(mailer and getattr(mailer, "imap_configured", False))
        last_backup = db.get_setting("backup_last", "") or ""
        try:
            backup_age = (datetime.now() - datetime.fromisoformat(last_backup[:19])).days if last_backup else None
        except ValueError:
            backup_age = None
        router = self.ctx.router
        ai_local = bool(router.primary.available()) if getattr(router, "primary", None) else False
        ai_cloud = bool(router.claude_ok()) if hasattr(router, "claude_ok") else False
        docs_conf = self.ctx.docs.conf() if getattr(self.ctx, "docs", None) else {"target": "local"}
        graph = bool(s.graph_tenant_id and s.graph_client_id)

        def step(key: str, group: str, title: str, ok: bool, where: str, route: str = "", detail: str = "",
                 optional: bool = False, env: list[str] | None = None, action: str = "") -> dict[str, Any]:
            done = ok or key in manual
            return {"key": key, "group": group, "title": title, "status": "ok" if done else "optional" if optional else "offen",
                    "where": where, "route": route, "detail": detail, "env": env or [], "manual": key in MANUAL, "action": action}

        return [
            step("admin", "Sicherheit", "Admin-Benutzer anlegen", users > 0, "Einstellungen → Benutzer & Rollen → + Benutzer",
                 "einstellungen", "Ab dem ersten Benutzer ist eine Anmeldung Pflicht." if not users else f"{users} Benutzer aktiv"),
            step("2fa", "Sicherheit", "Zwei-Faktor-Anmeldung für Admins", users > 0 and not admins_no_2fa,
                 "Einstellungen → Meine Zwei-Faktor-Anmeldung → Jetzt einrichten", "einstellungen",
                 "Zuerst einen Benutzer anlegen." if not users else f"{admins_no_2fa} Admin(s) ohne zweiten Faktor" if admins_no_2fa else "aktiv"),
            step("backup", "Sicherheit", "Datensicherung läuft", backup_age is not None and backup_age <= 2,
                 "Import & Sicherung → Sicherung jetzt erstellen (danach täglich automatisch)", "daten",
                 f"letzte Sicherung {last_backup[:10]}" if last_backup else "noch keine Sicherung – Ordner data/backups zusätzlich extern sichern"),
            step("company", "Stammdaten", "Firmendaten für Rechnungen (Adresse, UID, IBAN)",
                 bool(prof["address"] and prof["iban"] and (prof["uid"] or prof["kleinunternehmer"])),
                 "Abrechnung → Firmendaten", "abrechnung",
                 ", ".join(x for x, v in (("Adresse fehlt", prof["address"]), ("IBAN fehlt", prof["iban"]),
                                           ("UID fehlt", prof["uid"] or prof["kleinunternehmer"])) if not v) or "vollständig"),
            step("services", "Stammdaten", "Leistungen & Preise geprüft", False, "Einstellungen → Leistungskatalog (eigene Preise eintragen)",
                 "einstellungen", "von Hand abhaken, sobald die Preise stimmen"),
            step("demo", "Stammdaten", "Demodaten entfernen", not demo, "Erste Schritte → Demodaten entfernen", "",
                 f"{len(demo)} Demokunden vorhanden" if demo else "keine Demodaten", action="demo" if demo else ""),
            step("customers", "Stammdaten", "Echte Kunden anlegen oder importieren", real > 0,
                 "Import & Sicherung → CSV-Import (auch RMM-Export) · oder Kunden → + Kunde · oder Atera-Abgleich", "daten",
                 f"{real} Kunde(n)" if real else "noch keine eigenen Kunden"),
            step("mail", "Anbindungen", "Postfach verbinden (Posteingang, Versand)", mail_ok,
                 "Datei .env am Server: Microsoft 365 (GRAPH_*) oder IMAP/SMTP (MAIL_*), danach Cockpit neu starten", "ki-mitarbeiter",
                 "verbunden" if mail_ok else "nicht eingerichtet",
                 env=["MAIL_PROVIDER=graph", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_MAILBOX"]),
            step("cert", "Anbindungen", "Microsoft-Anmeldung per Zertifikat statt Geheimnis", msauth.active_certificate() is not None,
                 "Verbindungen & Sicherheit → Microsoft 365 → Zertifikat erzeugen → hochladen → Aktivieren", "verbindungen",
                 "aktiv" if msauth.active_certificate() else "noch per Geheimnis" if graph else "erst Microsoft 365 verbinden",
                 optional=not graph),
            step("ai", "Anbindungen", "KI einrichten (lokal mit Ollama oder Claude)", ai_local or ai_cloud,
                 "Lokal: Ollama installieren (docs/OFFLINE-KI-PC.md) · Cloud: ANTHROPIC_API_KEY in .env, dann Einstellungen → Claude",
                 "einstellungen", "lokale KI aktiv" if ai_local else "Claude aktiv" if ai_cloud else "ohne KI läuft alles regelbasiert",
                 optional=True, env=["OLLAMA_MODEL", "ANTHROPIC_API_KEY"]),
            step("docs", "Anbindungen", "Dokumentenablage in SharePoint/OneDrive", docs_conf.get("target") in ("sharepoint", "onedrive"),
                 "Einstellungen → Dokumentenablage", "einstellungen",
                 "lokal im Ordner data/archiv" if docs_conf.get("target") not in ("sharepoint", "onedrive") else docs_conf.get("target"),
                 optional=True),
            step("office", "Anbindungen", "Eigenen Office-Server verbinden (Word/Excel im Cockpit bearbeiten)",
                 bool((db.get_setting("office", {}) or {}).get("enabled")),
                 "Office → Einstellungen: Adresse des Collabora- bzw. ONLYOFFICE-Servers eintragen", "office", optional=True),
            step("public", "Kunden", "Öffentliche Adresse mit HTTPS (Kundenportal, Anfrageformular)",
                 (s.public_url or "").startswith("https://"),
                 "Vorlage deploy/Caddyfile (nur Portal + Formular nach außen), in .env PUBLIC_URL setzen", "verbindungen",
                 s.public_url or "nicht gesetzt – Portal nur im Firmennetz erreichbar", env=["PUBLIC_URL=https://portal.ihre-domain.at"]),
            step("portal", "Kunden", "Ersten Kundenportal-Zugang anlegen", scalar("SELECT COUNT(*) FROM portal_users") > 0,
                 "Kunden → Kunde öffnen → Kundenportal → + Zugang", "kunden"),
            step("backups", "Kunden", "Sicherungsberichte der Kunden ans Cockpit leiten", scalar("SELECT COUNT(*) FROM backup_jobs") > 0,
                 "Berichte (Veeam, Synology …) an das Cockpit-Postfach senden – erscheinen unter Datensicherung", "backups", optional=True),
            step("m365", "Kunden", "Microsoft 365 eines Kunden verbinden",
                 scalar("SELECT COUNT(*) FROM m365_tenants WHERE status = 'verbunden'") > 0,
                 "Microsoft 365 → + Kunde verbinden (Zustimmungs-Link an den Kunden-Admin)", "m365", optional=True,
                 env=["M365_CLIENT_ID", "M365_CLIENT_SECRET"]),
            step("agent", "Kunden", "Inventar-Agent auf den ersten Geräten", scalar("SELECT COUNT(*) FROM agent_devices") > 0,
                 "Geräte-Check → Agent installieren (Skript je Kunde, z. B. über Atera verteilen)", "inventar", optional=True),
            step("steuer", "Recht & Steuer", "Rechnungslayout und Mahnspesen mit dem Steuerberater abgestimmt", False,
                 "Abrechnung → Rechnung als PDF ansehen und weiterleiten", "abrechnung", "von Hand abhaken"),
            step("avv", "Recht & Steuer", "Auftragsverarbeitungs-Vertrag mit den Kunden (Portal, Microsoft-365-Check)", False,
                 "eigene Vertragsvorlage – vor dem ersten Kunden im Portal", "", "von Hand abhaken"),
        ]

    def overview(self) -> dict[str, Any]:
        steps = self.steps()
        required = [x for x in steps if x["status"] != "optional"]
        done = [x for x in required if x["status"] == "ok"]
        return {"steps": steps, "done": len(done), "total": len(required),
                "percent": round(100 * len(done) / len(required)) if required else 100,
                "next": next((x for x in steps if x["status"] == "offen"), None),
                "dismissed": bool(self.db.get_setting("setup_dismissed", False)),
                "host": os.environ.get("MEIT_HOST", "127.0.0.1"), "demo": demo_preview(self.db)}


class StepIn(BaseModel):
    done: bool = True


class DemoIn(BaseModel):
    confirm: str = Field("", max_length=40)


def register(app: FastAPI, ctx: Any, settings: Any, admin_only) -> Setup:
    db: Database = ctx.db
    svc = Setup(app, ctx, settings)
    app.state.setup = svc

    @app.get("/api/setup")
    def overview() -> dict:
        return svc.overview()

    @app.post("/api/setup/steps/{key}", dependencies=[Depends(admin_only)])
    def mark(key: str, data: StepIn) -> dict:
        if key not in MANUAL:
            raise HTTPException(422, "Dieser Schritt wird automatisch geprüft.")
        done = set(db.get_setting("setup_done", []) or [])
        db.set_setting("setup_done", sorted(done | {key} if data.done else done - {key}))
        return svc.overview()

    @app.post("/api/setup/dismiss", dependencies=[Depends(admin_only)])
    def dismiss(data: StepIn) -> dict:
        db.set_setting("setup_dismissed", data.done)
        return {"dismissed": data.done}

    @app.post("/api/setup/demo/remove", dependencies=[Depends(admin_only)])
    def demo_remove(data: DemoIn) -> dict:
        if data.confirm.strip().upper() != CONFIRM:
            raise HTTPException(422, f"Zur Bestätigung bitte „{CONFIRM}“ eingeben.")
        if not demo_preview(db)["present"]:
            raise HTTPException(409, "Es sind keine Demodaten vorhanden.")
        return {"removed": remove_demo(db)}

    return svc
