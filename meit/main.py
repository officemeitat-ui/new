"""ME-IT Cockpit – FastAPI-Anwendung (API + Weboberfläche).

Start:  python -m meit   (oder: uvicorn meit.main:app --host 127.0.0.1 --port 8080)
"""

from __future__ import annotations

import base64
import json
import re
import secrets
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .agents import (
    AgentContext, create_quote, monthly_report, run_assistant, run_security_check, triage_ticket,
)
from .billing import add_time, register as register_billing, unbilled_overview
from .branding import register as register_branding
from .config import Settings, get_settings
from .data_tools import backup_dir, create_backup, import_csv, list_backups, mirror_archive, start_backup_scheduler
from .db import Database, loads, now_iso
from .agents.briefing import weekly_briefing
from .agents.qbr import create_qbr
from .growth import ensure_mrr_baseline, health_overview, health_score, log_mrr, nrr, pipeline, recurring_share
from .knowledge import KnowledgeBase
from .kb_library import register as register_kb_library
from .llm import Router
from .mail import make_mailer
from .mitarbeiter_api import RateLimiter, is_public_path, register as register_mitarbeiter, start_mail_poller
from .portal import register as register_portal
from .documents import DocumentService, register as register_documents
from .payments import register as register_payments
from .maintenance import register as register_maintenance
from .sepa import Sepa, register as register_sepa
from .atera import register as register_atera
from .bookstack import register as register_bookstack
from .secrets_guard import redact_row, scan as scan_secrets
from .profitability import register as register_profitability
from .projects import register as register_projects
from .reports import register as register_reports
from .company import register as register_company
from .attachments import register as register_attachments
from .audit import register as register_audit
from .backups import register as register_backups
from .domaincheck import register as register_domains
from .csat import register as register_csat
from .hardening import BodyLimit, content_security_policy, redact_access_log, script_hashes
from .inventory import register as register_inventory
from .items import register as register_items
from .m365 import register as register_m365
from .notify import register as register_notify
from .office import register as register_office
from .planner import register as register_planner
from .search import register as register_search
from .share import register as register_share
from .posture import register as register_posture
from .connections import register as register_connections
from .contacts import register as register_contacts
from .setup import register as register_setup
from .todo import register as register_todo
from .vault import Vault
from .workreport import register as register_workreport
from .staff import register as register_staff
from .mobile import register as register_mobile
from .monitoring import register as register_monitoring
from .myday import register as register_myday
from .ai_control import register as register_ai_control
from .branding import get_branding
from .team import (
    SESSION_COOKIE, current_user_id, log_activity, make_admin_dependency, register as register_team, user_from_token,
    users_exist,
)
from .radar import Radar, eol_info
from .rmm import register as register_rmm
from .subscriptions import list_enriched as list_subscriptions, register as register_subscriptions
from .security import QUESTIONS
from .sla import register as register_sla, sla_config, sla_overview, ticket_sla
from .seed import seed_all
from .training import build_dataset, stats as training_stats, to_jsonl

STATIC_DIR = Path(__file__).parent / "static"


# --- Eingabemodelle --------------------------------------------------------------
def https_link(value: str) -> str:
    """Nur https-Links (kein javascript:/data: – die Links werden in der Oberfläche klickbar)."""
    value = (value or "").strip()
    if value and not re.match(r"^https://[^\s<>\"']+$", value):
        raise ValueError("Link muss mit https:// beginnen")
    return value[:500]


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    industry: str = ""
    employees: int = 0
    package: str = "keins"
    mrr: float = 0
    contract_end: str = ""
    booked_services: list[str] = []
    notes: str = ""
    uid: str = ""
    supplier_no: str = ""  # unsere Lieferantennummer beim Kunden (E-Rechnung an Bund)
    keeper_url: str = ""   # Link auf den Keeper-Ordner des Kunden (Passwörter bleiben in Keeper)
    index_clause: bool = False      # Wertsicherung (VPI) vereinbart
    index_base_month: str = ""      # Basismonat JJJJ-MM (letzte Anpassung bzw. Vertragsbeginn)
    index_base_value: float = 0     # Indexwert im Basismonat (leer = aus der Indexliste)

    @field_validator("keeper_url")
    @classmethod
    def _https(cls, v: str) -> str:
        return https_link(v)

    @field_validator("index_base_month")
    @classmethod
    def _month(cls, v: str) -> str:
        if v and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", v):
            raise ValueError("Basismonat im Format JJJJ-MM")
        return v


class TicketIn(BaseModel):
    customer_id: Optional[int] = None
    title: str = Field(min_length=1)
    description: str = ""
    status: str = "neu"
    priority: str = "normal"
    category: str = ""
    solution: str = ""
    time_spent_min: int = 0
    auto_triage: bool = True


class TicketUpdate(BaseModel):
    customer_id: Optional[int] = None
    assigned_to: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    solution: Optional[str] = None
    time_spent_min: Optional[int] = None


class AssetIn(BaseModel):
    customer_id: int
    name: str = Field(min_length=1)
    type: str = "pc"
    os: str = ""
    serial: str = ""
    purchase_date: str = ""
    warranty_end: str = ""
    last_seen: str = ""
    notes: str = ""
    keeper_url: str = ""   # Keeper-Eintrag mit den Zugangsdaten dieses Geräts
    remote_url: str = ""   # Fernwartung (z. B. Atera-Geräteseite mit Splashtop)

    @field_validator("keeper_url", "remote_url")
    @classmethod
    def _https(cls, v: str) -> str:
        return https_link(v)


class RedactIn(BaseModel):
    table: str
    id: int
    field: str


class ArticleIn(BaseModel):
    title: str = Field(min_length=1)
    content: str = ""
    tags: str = ""
    public: bool = False  # im Kundenportal für die KI-Hilfe freigegeben
    area: Optional[str] = Field(None, max_length=80)  # Bereich in der Wissens-Ansicht; None = unverändert lassen


class ServiceIn(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    unit: str = "Pauschal"
    price: float = 0
    recurring: bool = False
    keywords: str = ""
    active: bool = True


class ChatIn(BaseModel):
    messages: list[dict[str, str]]


class QuoteIn(BaseModel):
    customer_id: int
    need: str = Field(min_length=3)
    service_codes: list[str] = []
    tiers: bool = False


class GrowthSettingsIn(BaseModel):
    target_closings_per_week: Optional[float] = None
    selfcheck: Optional[dict[str, bool]] = None


class BriefingIn(BaseModel):
    send_to: Optional[str] = None


class ImportIn(BaseModel):
    csv: str = Field(min_length=1, max_length=20_000_000)
    commit: bool = False
    create_customers: bool = True


class QuoteStatus(BaseModel):
    status: str
    tier: Optional[str] = None  # bei 3-Stufen-Angeboten: gewähltes Paket (XL, S, M)


class SecurityIn(BaseModel):
    customer_id: int
    answers: dict[str, str]


class ReportIn(BaseModel):
    customer_id: int
    month: Optional[str] = None


TICKET_STATUSES = {"neu", "in_arbeit", "wartet", "geloest"}
PRIORITIES = {"niedrig", "normal", "hoch", "kritisch"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    redact_access_log()
    db = Database(settings.db_path)
    db.init_schema()
    seed_all(db, demo=settings.seed_demo_data and not db.get_setting("demo_removed", False))
    ensure_mrr_baseline(db)
    router = Router(settings)
    kb = KnowledgeBase(db, router)
    radar = Radar(db)
    mailer = make_mailer(settings)
    data_dir = Path(settings.db_path).resolve().parent
    docs = DocumentService(db, settings, data_dir, settings.company_name)
    sepa = Sepa(db, settings.company_name)
    ctx = AgentContext(db=db, router=router, kb=kb, radar=radar, company=settings.company_name,
                       settings=settings, mailer=mailer, docs=docs)

    app = FastAPI(title=f"{settings.company_name} Cockpit", version=__version__)
    app.state.ctx = ctx
    app.state.settings = settings

    # --- optionaler Passwortschutz (HTTP Basic), wenn im LAN erreichbar ----------
    @app.middleware("http")
    async def basic_auth(request: Request, call_next):
        path = request.url.path
        if is_public_path(path):
            # Öffentliches Anfrageformular: ohne Passwort, CORS nur für freigegebene Websites.
            origin = (request.headers.get("origin") or "").rstrip("/")
            cors = {}
            if origin and origin in settings.public_form_origins:
                cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type"}
            if request.method == "OPTIONS":
                return Response(status_code=204 if cors else 403, headers=cors)
            response = await call_next(request)
            for key, value in cors.items():
                response.headers[key] = value
            return response
        if settings.app_password:
            header = request.headers.get("authorization", "")
            ok = False
            if header.lower().startswith("basic "):
                try:
                    _, _, password = base64.b64decode(header[6:]).decode().partition(":")
                    ok = secrets.compare_digest(password, settings.app_password)
                except (ValueError, UnicodeDecodeError):
                    ok = False
            if not ok:
                return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="ME-IT"'})
        # Benutzer-Anmeldung (aktiv, sobald der erste Benutzer angelegt ist)
        request.state.user = user_from_token(db, request.cookies.get(SESSION_COOKIE))
        if path.startswith("/api/") and not path.startswith("/api/auth/") and users_exist(db):
            if not request.state.user:
                return JSONResponse({"detail": "Bitte anmelden."}, status_code=401)
            origin = request.headers.get("origin")
            if request.method not in ("GET", "HEAD", "OPTIONS") and origin and \
                    origin.split("://")[-1].rstrip("/") != request.headers.get("host", ""):
                return JSONResponse({"detail": "Anfrage von fremder Herkunft blockiert."}, status_code=403)
        return await call_next(request)

    # Eingebettete Skripte der ausgelieferten Seiten per Prüfsumme freigeben (alles andere blockt der Browser)
    page_scripts = {"/portal": script_hashes(STATIC_DIR / "portal.html"), "/anfrage": script_hashes(STATIC_DIR / "anfrage.html"),
                    "/bewertung": script_hashes(STATIC_DIR / "bewertung.html"), "/": script_hashes(STATIC_DIR / "index.html"),
                    "/s": script_hashes(STATIC_DIR / "share.html")}
    form_frames = " ".join(["'self'", *settings.public_form_origins]) if settings.public_form_origins else ""

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)")
        if path != "/anfrage":  # das Formular darf eingebettet werden, alles andere nicht
            response.headers.setdefault("X-Frame-Options", "DENY")
        if response.headers.get("content-type", "").startswith("text/html"):
            svc = getattr(app.state, "office", None)  # der eigene Office-Server darf im Cockpit eingebettet werden
            response.headers.setdefault("Content-Security-Policy", content_security_policy(
                page_scripts.get(path), form_frames if path == "/anfrage" else "'none'",
                office=svc.origin() if svc and path == "/" else ""))
        if path.startswith(("/api/auth/", "/api/portal/", "/api/public/share/")):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(BodyLimit)  # äußerste Schicht: zu große Anfragen gar nicht erst einlesen

    def must(row: dict | None, what: str = "Eintrag") -> dict:
        if not row:
            raise HTTPException(404, f"{what} nicht gefunden")
        return row

    admin_only = make_admin_dependency(db)
    ai_control = register_ai_control(app, ctx, admin_only)  # KI-Routing je Aufgabe, Claude-Budget, Verbrauch
    vault = Vault(data_dir)  # verschlüsselt gespeicherte Anmeldungen (2FA-Schlüssel, To-Do-Verbindungen)
    register_team(app, db, RateLimiter(limit=10, window_s=600), vault, settings.company_name)
    def invoice_finalized(invoice_id: int) -> None:
        # Kunde mit SEPA-Mandat → Rechnung zur Lastschrift vormerken (Rechnung = Vorabankündigung)
        try:
            sepa.on_finalized(invoice_id)
        except Exception as exc:  # noqa: BLE001 - Stellen darf nicht scheitern
            db.set_setting("sepa_last_error", f"Rechnung {invoice_id}: {exc}")
        # Gestellte Rechnung sofort als PDF archivieren (lokal + SharePoint/OneDrive)
        if docs.conf().get("auto_invoice"):
            try:
                docs.archive_invoice(invoice_id)
            except Exception as exc:  # noqa: BLE001 - Archiv darf das Stellen nicht verhindern
                db.set_setting("documents_last_error", f"Rechnung {invoice_id}: {exc}")

    register_billing(app, db, settings.company_name, admin_only, on_finalized=invoice_finalized)
    register_sla(app, db, admin_only)
    register_rmm(app, db, settings, admin_only)
    register_subscriptions(app, db, admin_only)
    register_branding(app, db, settings.company_name, data_dir, admin_only)

    def customer_out(c: dict) -> dict:
        c["booked_services"] = loads(c.get("booked_services"), [])
        return c

    # --- System -------------------------------------------------------------------
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "version": __version__, "company": settings.company_name, "llm": router.status()}

    @app.get("/api/settings")
    def get_app_settings() -> dict[str, Any]:
        return {
            "company": settings.company_name, "llm_provider": settings.llm_provider,
            "ollama_url": settings.ollama_url, "ollama_model": settings.ollama_model,
            "embed_model": settings.embed_model, "openai_base_url": settings.openai_base_url,
            "openai_model": settings.openai_model, "anthropic_model": settings.anthropic_model,
            "allow_cloud_fallback": settings.allow_cloud_fallback, "db_path": settings.db_path,
            "password_protected": bool(settings.app_password), "llm": router.status(),
        }

    # --- Dashboard ----------------------------------------------------------------
    @app.get("/api/dashboard")
    def dashboard() -> dict[str, Any]:
        today = date.today()
        assets = db.query("SELECT os, warranty_end FROM assets")
        eol = sum(1 for a in assets if (info := eol_info(a["os"] or "")) and info[0] <= today)
        eol_soon = sum(1 for a in assets if (info := eol_info(a["os"] or "")) and today < info[0] <= today + timedelta(days=548))
        warranty_soon = sum(1 for a in assets if a["warranty_end"] and today.isoformat() <= a["warranty_end"][:10]
                            <= (today + timedelta(days=90)).isoformat())
        scan = radar.scan()
        resolved = db.query("SELECT created_at, resolved_at FROM tickets WHERE status = 'geloest' AND resolved_at != ''")
        return {
            "customers": db.scalar("SELECT COUNT(*) FROM customers"),
            "managed_customers": db.scalar("SELECT COUNT(*) FROM customers WHERE package != 'keins'"),
            "mrr": db.scalar("SELECT COALESCE(SUM(mrr), 0) FROM customers"),
            "open_tickets": db.scalar("SELECT COUNT(*) FROM tickets WHERE status != 'geloest'"),
            "critical_tickets": db.scalar(
                "SELECT COUNT(*) FROM tickets WHERE status != 'geloest' AND priority IN ('kritisch', 'hoch')"),
            "resolved_tickets": len(resolved),
            "assets": len(assets), "assets_eol": eol, "assets_eol_soon": eol_soon, "warranty_soon": warranty_soon,
            "radar_count": scan["count"], "radar_once": scan["total_once"], "radar_monthly": scan["total_monthly"],
            "radar_annual": scan["total_annual"], "top_opportunities": scan["opportunities"][:5],
            "contracts_ending": db.query(
                "SELECT id, name, contract_end FROM customers WHERE contract_end != '' AND contract_end BETWEEN ? AND ? "
                "ORDER BY contract_end", (today.isoformat(), (today + timedelta(days=90)).isoformat())),
            "recent_agent_runs": db.query(
                "SELECT agent, provider, ok, duration_ms, created_at FROM agent_log ORDER BY id DESC LIMIT 8"),
            "llm": router.status(),
            "unbilled_value": unbilled_overview(db)["total_value"],
            "renewals": [{k: r[k] for k in ("id", "customer_id", "customer_name", "name", "next_renewal", "state", "notice_deadline")}
                         for r in list_subscriptions(db) if r["state"] in ("kündigungsfrist", "abgelaufen", "bald")][:8],
            "sla": {k: v for k, v in sla_overview(db, days=30).items() if k in ("breached_open", "at_risk_open", "quote")},
            "nrr": nrr(db),
            "recurring_share": recurring_share(db),
            "health": {k: v for k, v in health_overview(db).items() if k != "customers"},
        }

    # --- Wachstum (Customer Success, Pipeline, Firmenwert) ------------------------
    @app.get("/api/growth")
    def growth() -> dict[str, Any]:
        target = float(db.get_setting("target_closings_per_week", 1.0) or 1.0)
        return {"nrr": nrr(db), "recurring_share": recurring_share(db), "health": health_overview(db),
                "pipeline": pipeline(db, target),
                "mrr_history": db.query("SELECT * FROM mrr_history ORDER BY created_at DESC, id DESC LIMIT 50"),
                "selfcheck": db.get_setting("selfcheck", {})}

    @app.put("/api/growth/settings")
    def growth_settings(data: GrowthSettingsIn) -> dict[str, Any]:
        if data.target_closings_per_week is not None:
            db.set_setting("target_closings_per_week", max(0.1, min(data.target_closings_per_week, 50)))
        if data.selfcheck is not None:
            db.set_setting("selfcheck", {k: bool(v) for k, v in data.selfcheck.items()})
        return growth()

    @app.post("/api/agents/qbr", status_code=201)
    def qbr(data: ReportIn, request: Request) -> dict:
        customer = must(db.get("customers", data.customer_id), "Kunde")
        result = create_qbr(ctx, data.customer_id)
        log_activity(db, current_user_id(request), "qbr", "customer", data.customer_id, customer["name"])
        return result

    @app.post("/api/agents/briefing")
    def briefing(data: BriefingIn) -> dict:
        result = weekly_briefing(ctx)
        result["sent"] = False
        if data.send_to:
            if not (mailer and mailer.smtp_configured):
                raise HTTPException(409, "Kein E-Mail-Versand eingerichtet – Briefing kopieren.")
            try:
                mailer.send(data.send_to, f"Wochenbriefing {result['week']}", result["text"])
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(502, f"Versand fehlgeschlagen: {exc}")
            result["sent"] = True
        return result

    @app.get("/api/qbrs/{qid}")
    def get_qbr(qid: int) -> dict:
        row = must(db.get("qbrs", qid), "QBR")
        row["next_steps"] = loads(row["next_steps"], [])
        return row

    # --- Kunden -------------------------------------------------------------------
    @app.get("/api/customers")
    def list_customers() -> list[dict]:
        rows = db.query(
            "SELECT c.*, (SELECT COUNT(*) FROM tickets t WHERE t.customer_id = c.id AND t.status != 'geloest') AS open_tickets, "
            "(SELECT COUNT(*) FROM assets a WHERE a.customer_id = c.id) AS asset_count FROM customers c ORDER BY c.name")
        for r in rows:
            h = health_score(db, r)
            r["health_score"], r["health_status"] = h["score"], h["status"]
        return [customer_out(r) for r in rows]

    @app.post("/api/customers", status_code=201)
    def add_customer(data: CustomerIn) -> dict:
        cid = db.insert("customers", data.model_dump())
        log_mrr(db, cid, data.name, 0, data.mrr, "neukunde")
        return customer_out(db.get("customers", cid))

    @app.get("/api/customers/{cid}")
    def get_customer(cid: int) -> dict:
        c = customer_out(must(db.get("customers", cid), "Kunde"))
        c["assets"] = db.query("SELECT * FROM assets WHERE customer_id = ? ORDER BY name", (cid,))
        c["tickets"] = db.query("SELECT * FROM tickets WHERE customer_id = ? ORDER BY id DESC LIMIT 50", (cid,))
        c["quotes"] = db.query("SELECT id, title, total_once, total_monthly, status, created_at FROM quotes "
                               "WHERE customer_id = ? ORDER BY id DESC", (cid,))
        c["assessments"] = db.query("SELECT id, score, level, created_at FROM assessments WHERE customer_id = ? "
                                    "ORDER BY id DESC", (cid,))
        c["opportunities"] = radar.scan(cid)["opportunities"]
        c["health"] = health_score(db, c)
        c["qbrs"] = db.query("SELECT id, period, health_score, created_at FROM qbrs WHERE customer_id = ? ORDER BY id DESC",
                             (cid,))
        return c

    @app.put("/api/customers/{cid}")
    def update_customer(cid: int, data: CustomerIn) -> dict:
        before = must(db.get("customers", cid), "Kunde")
        db.update("customers", cid, data.model_dump())
        old_mrr = before["mrr"] or 0
        reason = "kündigung" if data.mrr == 0 else ("upsell" if data.mrr > old_mrr else "reduktion")
        log_mrr(db, cid, data.name, old_mrr, data.mrr, reason)
        return customer_out(db.get("customers", cid))

    @app.delete("/api/customers/{cid}", dependencies=[Depends(admin_only)])
    def delete_customer(cid: int) -> dict:
        existing = db.get("customers", cid)
        if existing:
            log_mrr(db, cid, existing["name"], existing["mrr"] or 0, 0, "kündigung")
        if not db.delete("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        return {"ok": True}

    # --- Tickets ------------------------------------------------------------------
    @app.get("/api/tickets")
    def list_tickets(request: Request, status: Optional[str] = None, customer_id: Optional[int] = None,
                     open_only: bool = False, mine: bool = False) -> list[dict]:
        sql = ("SELECT t.*, c.name AS customer_name, u.name AS assigned_name FROM tickets t "
               "LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to WHERE 1=1")
        params: list[Any] = []
        if mine and current_user_id(request):
            sql += " AND t.assigned_to = ?"
            params.append(current_user_id(request))
        if status:
            sql += " AND t.status = ?"
            params.append(status)
        if open_only:
            sql += " AND t.status != 'geloest'"
        if customer_id:
            sql += " AND t.customer_id = ?"
            params.append(customer_id)
        sql += (" ORDER BY CASE t.status WHEN 'geloest' THEN 1 ELSE 0 END, "
                "CASE t.priority WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id DESC")
        rows = db.query(sql, params)
        cfg = sla_config(db)
        packages = {c["id"]: c["package"] for c in db.query("SELECT id, package FROM customers")}
        for r in rows:
            r["ai_suggestion"] = loads(r.get("ai_suggestion"), None)
            r["sla"] = ticket_sla(r, packages.get(r["customer_id"], "keins"), cfg)
        return rows

    @app.post("/api/tickets", status_code=201)
    def add_ticket(data: TicketIn) -> dict:
        payload = data.model_dump(exclude={"auto_triage"})
        if payload["status"] not in TICKET_STATUSES or payload["priority"] not in PRIORITIES:
            raise HTTPException(422, "Ungültiger Status oder Priorität")
        if payload.get("customer_id"):
            must(db.get("customers", payload["customer_id"]), "Kunde")
        tid = db.insert("tickets", payload)
        if data.auto_triage:
            try:
                triage_ticket(ctx, tid)
            except Exception:  # noqa: BLE001 - Ticket bleibt auch ohne Triage gespeichert
                pass
        row = db.get("tickets", tid)
        row["ai_suggestion"] = loads(row.get("ai_suggestion"), None)
        return row

    @app.get("/api/tickets/{tid}")
    def get_ticket(tid: int) -> dict:
        row = must(db.query_one(
            "SELECT t.*, c.name AS customer_name, u.name AS assigned_name FROM tickets t "
            "LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to "
            "WHERE t.id = ?", (tid,)), "Ticket")
        row["ai_suggestion"] = loads(row.get("ai_suggestion"), None)
        row["csat"] = db.query_one("SELECT rating, comment, rated_at, sent_at, followup_ticket_id FROM csat_surveys "
                                   "WHERE ticket_id = ?", (tid,))
        return row

    @app.put("/api/tickets/{tid}")
    def update_ticket(tid: int, data: TicketUpdate, request: Request) -> dict:
        ticket = must(db.get("tickets", tid), "Ticket")
        payload = {k: v for k, v in data.model_dump().items() if v is not None}
        if "status" in payload and payload["status"] not in TICKET_STATUSES:
            raise HTTPException(422, "Ungültiger Status")
        if "priority" in payload and payload["priority"] not in PRIORITIES:
            raise HTTPException(422, "Ungültige Priorität")
        if payload.get("assigned_to") == 0:
            payload["assigned_to"] = None
            db.query("UPDATE tickets SET assigned_to = NULL WHERE id = ?", (tid,))
        delta = (payload.get("time_spent_min") or 0) - (ticket["time_spent_min"] or 0)
        if "time_spent_min" in payload and delta > 0 and (payload.get("customer_id") or ticket["customer_id"]):
            # Manuell erhöhte Ticketzeit wird als Zeiteintrag erfasst (für die Abrechnung)
            add_time(db, customer_id=payload.get("customer_id") or ticket["customer_id"], minutes=delta,
                     description=ticket["title"], ticket_id=tid, user_id=current_user_id(request), touch_ticket=False)
        if payload.get("status") and payload["status"] != "neu" and not ticket.get("first_response_at"):
            db.query("UPDATE tickets SET first_response_at = ? WHERE id = ?", (now_iso(), tid))  # SLA: Reaktion
        if payload.get("status") == "geloest" and ticket["status"] != "geloest":
            payload["resolved_at"] = now_iso()
            log_activity(db, payload.get("assigned_to") or ticket.get("assigned_to") or current_user_id(request),
                         "ticket_geloest", "ticket", tid, ticket["title"])
        elif payload.get("status") and payload["status"] != "geloest":
            payload["resolved_at"] = ""
        db.update("tickets", tid, payload)
        if payload.get("status") == "geloest" and ticket["status"] != "geloest" and getattr(app.state, "csat", None):
            try:
                app.state.csat.on_resolved(tid)  # Zufriedenheits-Umfrage (Mail bzw. Kundenportal)
            except Exception as exc:  # noqa: BLE001 - Umfrage darf das Lösen nie verhindern
                db.set_setting("csat_last_error", f"Ticket {tid}: {exc}")
        row = db.get("tickets", tid)
        row["ai_suggestion"] = loads(row.get("ai_suggestion"), None)
        return row

    @app.delete("/api/tickets/{tid}")
    def delete_ticket(tid: int) -> dict:
        if not db.delete("tickets", tid):
            raise HTTPException(404, "Ticket nicht gefunden")
        return {"ok": True}

    @app.post("/api/tickets/{tid}/triage")
    def triage(tid: int, apply: bool = True) -> dict:
        must(db.get("tickets", tid), "Ticket")
        return triage_ticket(ctx, tid, apply=apply)

    # --- Geräte -------------------------------------------------------------------
    @app.get("/api/assets")
    def list_assets(customer_id: Optional[int] = None) -> list[dict]:
        sql = "SELECT a.*, c.name AS customer_name FROM assets a LEFT JOIN customers c ON c.id = a.customer_id"
        params: tuple = ()
        if customer_id:
            sql += " WHERE a.customer_id = ?"
            params = (customer_id,)
        rows = db.query(sql + " ORDER BY c.name, a.name", params)
        today = date.today()
        for r in rows:
            info = eol_info(r["os"] or "")
            r["eol_date"] = info[0].isoformat() if info else ""
            r["eol_status"] = ("abgelaufen" if info and info[0] <= today else
                               "bald" if info and info[0] <= today + timedelta(days=548) else "ok")
        return rows

    @app.post("/api/assets", status_code=201)
    def add_asset(data: AssetIn) -> dict:
        must(db.get("customers", data.customer_id), "Kunde")
        return db.get("assets", db.insert("assets", data.model_dump()))

    @app.put("/api/assets/{aid}")
    def update_asset(aid: int, data: AssetIn) -> dict:
        must(db.get("assets", aid), "Gerät")
        db.update("assets", aid, data.model_dump())
        return db.get("assets", aid)

    @app.delete("/api/assets/{aid}")
    def delete_asset(aid: int) -> dict:
        if not db.delete("assets", aid):
            raise HTTPException(404, "Gerät nicht gefunden")
        return {"ok": True}

    # --- Wissensdatenbank -------------------------------------------------------
    @app.get("/api/kb")
    def list_articles() -> list[dict]:
        return db.query("SELECT id, title, tags, content, public, updated_at, source, external_url FROM kb_articles "
                        "ORDER BY title")

    @app.get("/api/kb/search")
    def search_articles(q: str = Query(min_length=1), limit: int = 5) -> list[dict]:
        return kb.search(q, limit=min(limit, 20))

    @app.post("/api/kb", status_code=201)
    def add_article(data: ArticleIn) -> dict:
        return db.get("kb_articles", db.insert("kb_articles", data.model_dump(exclude_none=True)))

    @app.put("/api/kb/{aid}")
    def update_article(aid: int, data: ArticleIn) -> dict:
        article = must(db.get("kb_articles", aid), "Artikel")
        if article.get("source") == "bookstack":
            if article["title"] == data.title and article["content"] == data.content:
                db.update("kb_articles", aid, {"public": data.public})  # Freigabe fürs Portal darf hier gesetzt werden
                return db.get("kb_articles", aid)
            raise HTTPException(409, "Dieser Artikel kommt aus BookStack – bitte dort bearbeiten (wird automatisch übernommen).")
        db.update("kb_articles", aid, {**data.model_dump(exclude_none=True), "embedding": "", "embedding_model": ""})
        return db.get("kb_articles", aid)

    @app.delete("/api/kb/{aid}")
    def delete_article(aid: int) -> dict:
        if not db.delete("kb_articles", aid):
            raise HTTPException(404, "Artikel nicht gefunden")
        return {"ok": True}

    register_kb_library(app, ctx, admin_only, auto_import=settings.kb_library)  # mitgelieferte Hilfe-Bibliothek, Übersicht, Liste

    @app.post("/api/kb/reindex")
    def reindex() -> dict:
        db.query("UPDATE kb_articles SET embedding = '', embedding_model = ''")
        return {"indexed": kb.ensure_embeddings()}

    @app.post("/api/tickets/{tid}/to-kb", status_code=201)
    def ticket_to_kb(tid: int) -> dict:
        """Gelöstes Ticket als Wissensartikel übernehmen – so lernt das System mit."""
        t = must(db.get("tickets", tid), "Ticket")
        if not t["solution"]:
            raise HTTPException(422, "Ticket hat noch keine Lösung")
        content = f"## Problem\n{t['description']}\n\n## Lösung\n{t['solution']}\n"
        return db.get("kb_articles", db.insert("kb_articles", {
            "title": t["title"], "content": content, "tags": (t["category"] or "").lower()}))

    # --- Leistungskatalog -------------------------------------------------------
    @app.get("/api/services")
    def list_services() -> list[dict]:
        return db.query("SELECT * FROM services ORDER BY recurring DESC, code")

    @app.post("/api/services", status_code=201, dependencies=[Depends(admin_only)])
    def add_service(data: ServiceIn) -> dict:
        if db.query_one("SELECT id FROM services WHERE code = ?", (data.code.upper(),)):
            raise HTTPException(409, "Code existiert bereits")
        return db.get("services", db.insert("services", {**data.model_dump(), "code": data.code.upper()}))

    @app.put("/api/services/{sid}", dependencies=[Depends(admin_only)])
    def update_service(sid: int, data: ServiceIn) -> dict:
        must(db.get("services", sid), "Leistung")
        db.update("services", sid, {**data.model_dump(), "code": data.code.upper()})
        return db.get("services", sid)

    # --- Umsatz-Radar -----------------------------------------------------------
    @app.get("/api/radar")
    def get_radar(customer_id: Optional[int] = None) -> dict:
        return radar.scan(customer_id)

    # --- Agenten ----------------------------------------------------------------
    @app.post("/api/agents/assistant")
    def assistant(data: ChatIn) -> dict:
        if not data.messages:
            raise HTTPException(422, "Keine Nachricht")
        return run_assistant(ctx, data.messages)

    @app.post("/api/agents/quote", status_code=201)
    def quote(data: QuoteIn, request: Request) -> dict:
        must(db.get("customers", data.customer_id), "Kunde")
        result = create_quote(ctx, data.customer_id, data.need, data.service_codes, tiers=data.tiers)
        log_activity(db, current_user_id(request), "angebot_erstellt", "quote", result["id"], result["title"])
        return result

    @app.post("/api/agents/report")
    def report(data: ReportIn) -> dict:
        must(db.get("customers", data.customer_id), "Kunde")
        return monthly_report(ctx, data.customer_id, data.month)

    @app.get("/api/agents/log")
    def agent_log(limit: int = 50) -> list[dict]:
        return db.query("SELECT * FROM agent_log ORDER BY id DESC LIMIT ?", (min(limit, 500),))

    # --- Angebote ---------------------------------------------------------------
    @app.get("/api/quotes")
    def list_quotes() -> list[dict]:
        rows = db.query("SELECT q.*, c.name AS customer_name FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id "
                        "ORDER BY q.id DESC")
        for r in rows:
            r["items"] = loads(r["items"], [])
            r["tiers"] = loads(r.get("tiers"), [])
        return rows

    @app.put("/api/quotes/{qid}")
    def set_quote_status(qid: int, data: QuoteStatus, request: Request) -> dict:
        return apply_quote_status(qid, data.status, data.tier, current_user_id(request))

    def apply_quote_status(qid: int, status: str, tier: Optional[str] = None, actor: Optional[int] = None,
                           via: str = "") -> dict:
        """Statuswechsel eines Angebots – auch vom Kundenportal genutzt (Annahme online)."""
        if status not in {"entwurf", "versendet", "angenommen", "abgelehnt"}:
            raise HTTPException(422, "Ungültiger Status")
        q = must(db.get("quotes", qid), "Angebot")
        update: dict[str, Any] = {"status": status}
        tiers = loads(q.get("tiers"), [])
        if status == "angenommen" and q["status"] != "angenommen" and tiers:
            chosen = next((t for t in tiers if t["key"] == (tier or "M")), None)
            if not chosen:
                raise HTTPException(422, "Unbekanntes Paket")
            update.update({"items": chosen["items"], "total_once": chosen["total_once"],
                           "total_monthly": chosen["total_monthly"], "chosen_tier": chosen["key"]})
            q = {**q, "items": json.dumps(chosen["items"]), "total_once": chosen["total_once"],
                 "total_monthly": chosen["total_monthly"]}
        if status == "versendet" and q["status"] != "versendet":
            update.update({"sent_at": now_iso(), "followup_count": 0, "last_followup_at": ""})
        db.update("quotes", qid, update)
        if status == "angenommen" and q["status"] != "angenommen":
            # Angenommene wiederkehrende Leistungen erhöhen automatisch den MRR des Kunden.
            customer = db.get("customers", q["customer_id"])
            if customer:
                items = loads(q["items"], [])
                booked = set(loads(customer["booked_services"], []))
                booked.update(i["code"] for i in items if i.get("recurring"))
                log_mrr(db, customer["id"], customer["name"], customer["mrr"] or 0,
                        round((customer["mrr"] or 0) + (q["total_monthly"] or 0), 2), f"angebot #{qid}")
                db.update("customers", customer["id"], {
                    "mrr": round((customer["mrr"] or 0) + (q["total_monthly"] or 0), 2),
                    "booked_services": sorted(booked),
                    "package": customer["package"] if customer["package"] != "keins" or not q["total_monthly"] else "basis",
                })
                db.query("UPDATE leads SET stage = 'gewonnen' WHERE customer_id = ? AND stage != 'gewonnen'",
                         (customer["id"],))
                log_activity(db, actor, "abschluss", "quote", qid, f"{q['title']} ({customer['name']}){via}")
        return db.get("quotes", qid)

    @app.delete("/api/quotes/{qid}")
    def delete_quote(qid: int) -> dict:
        if not db.delete("quotes", qid):
            raise HTTPException(404, "Angebot nicht gefunden")
        return {"ok": True}

    # --- Security / NIS2 --------------------------------------------------------
    @app.get("/api/security/questions")
    def security_questions() -> list[dict]:
        return QUESTIONS

    @app.post("/api/security/assess", status_code=201)
    def security_assess(data: SecurityIn) -> dict:
        must(db.get("customers", data.customer_id), "Kunde")
        return run_security_check(ctx, data.customer_id, data.answers)

    @app.get("/api/security/assessments/{aid}")
    def get_assessment(aid: int) -> dict:
        a = must(db.get("assessments", aid), "Bewertung")
        a["answers"] = loads(a["answers"], {})
        return a

    # --- Training ---------------------------------------------------------------
    @app.get("/api/training/stats")
    def get_training_stats() -> dict:
        return training_stats(db)

    @app.get("/api/training/export")
    def export_training(include_kb: bool = True) -> PlainTextResponse:
        body = to_jsonl(build_dataset(db, include_kb=include_kb))
        return PlainTextResponse(body, media_type="application/jsonl", headers={
            "Content-Disposition": f'attachment; filename="meit-training-{date.today().isoformat()}.jsonl"'})

    # --- Daten: Import & Sicherung ------------------------------------------------
    bdir = backup_dir(settings.db_path, settings.backup_dir)

    @app.post("/api/import/{kind}", dependencies=[Depends(admin_only)])
    def import_data(kind: str, data: ImportIn) -> dict:
        try:
            return import_csv(db, kind, data.csv, commit=data.commit, create_customers=data.create_customers)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/backup")
    def backup_status() -> dict:
        return {"dir": str(bdir), "hours": settings.backup_hours, "keep": settings.backup_keep,
                "last": db.get_setting("backup_last", ""), "error": db.get_setting("backup_error", ""),
                "backups": list_backups(bdir), "archive_mirror": str(bdir / "archiv")}

    @app.post("/api/backup/run", status_code=201, dependencies=[Depends(admin_only)])
    def backup_now() -> dict:
        target = create_backup(settings.db_path, bdir, settings.backup_keep)
        copied = mirror_archive(docs.archive_dir, bdir / "archiv")
        db.set_setting("backup_last", now_iso())
        return {"file": target.name, "archive_copied": copied, **backup_status()}

    @app.get("/api/backup/download", dependencies=[Depends(admin_only)])
    def backup_download() -> FileResponse:
        target = create_backup(settings.db_path, bdir, settings.backup_keep)
        db.set_setting("backup_last", now_iso())
        return FileResponse(target, media_type="application/octet-stream", filename=target.name)

    if settings.backup_hours > 0 and settings.db_path != ":memory:":
        start_backup_scheduler(db, settings.db_path, bdir, settings.backup_hours, settings.backup_keep,
                               archive_dir=docs.archive_dir)

    # --- Kundenportal ------------------------------------------------------------
    register_portal(app, ctx, admin_only, apply_quote_status)

    # --- Dokumentenprozess (PDF, SharePoint/OneDrive, Versand per Outlook) ------
    register_documents(app, ctx, admin_only, apply_quote_status)

    # --- E-Mails & Anhänge: .eml/.msg-Upload, Ticket-Verlauf, Antworten, Phishing-Check ----
    ctx.attachments = register_attachments(app, ctx, admin_only)

    # --- Office im Cockpit: eigener Office-Server (Collabora/ONLYOFFICE) bearbeitet Dateien über WOPI --------
    office = register_office(app, ctx, settings, admin_only)
    register_search(app, ctx, admin_only, start=settings.db_path != ":memory:")  # eine Suche über alles, auch Dateiinhalte
    register_share(app, ctx, settings, STATIC_DIR)  # Passwörter als Einmal-Link, Dateien als Freigabe-Link
    register_planner(app, ctx, settings)  # Einsatzplanung: Termine, Kalender-Abo, Terminbestätigung
    register_workreport(app, ctx, settings)  # Arbeitsbericht mit Unterschrift des Kunden (Leistungsnachweis)
    register_myday(app, ctx)  # „Mein Tag“: persönliche Startseite
    register_projects(app, ctx)  # Projekte: Aufgaben, Vorlagen, Stundenbudget, Fortschritt
    register_reports(app, ctx, admin_only)  # Auswertungen: Auslastung, verrechenbare Stunden, Umsatz, Tickets
    register_company(app, ctx, admin_only)  # Unternehmen: SWOT, Ziele, Maßnahmen, Quartalsrückblick
    register_items(app, ctx, admin_only)  # Artikel und Einmalpositionen (Material, Hardware) für die Rechnung
    register_monitoring(app, ctx, admin_only, start=settings.db_path != ":memory:")  # Erreichbarkeit von Websites/Diensten der Kunden

    # --- Backup-Wächter (Sicherungsberichte aus dem Postfach) -----------------------------------
    register_backups(app, ctx, admin_only, start=settings.db_path != ":memory:")
    radar.extra.append(register_domains(app, ctx, admin_only, start=settings.db_path != ":memory:"))

    # --- Geldkreislauf: Kontoauszug, Zahlungsabgleich, Mahnwesen -------------------
    register_payments(app, ctx, admin_only, start_scheduler=settings.db_path != ":memory:")

    # --- SEPA-Lastschrift (Mandate, Einzugsdatei, Rücklastschriften) -----------------
    register_sepa(app, ctx, admin_only, sepa)

    # --- Wartungsplan (wiederkehrende Prüfungen mit Nachweis) -----------------------
    register_maintenance(app, ctx, admin_only, start=settings.db_path != ":memory:")

    # --- Atera (RMM + Splashtop-Sitzungsprotokolle), BookStack (Doku-Wiki) -----------
    register_atera(app, db, settings, admin_only)
    register_contacts(app, ctx)  # Ansprechpartner je Kunde (aus Atera oder von Hand)
    register_bookstack(app, db, settings, admin_only)

    # --- Microsoft 365 der Kunden (Sicherheit, Lizenzabgleich) + Ein-/Austritte -----------
    radar.m365 = register_m365(app, db, settings, admin_only, start=settings.db_path != ":memory:")
    register_staff(app, ctx, admin_only)

    # --- Microsoft To Do je Benutzer, Verbindungs-Center (Zertifikat, Rechte-Prüfung) -------
    register_todo(app, ctx, settings, vault, start=settings.db_path != ":memory:")
    register_connections(app, ctx, settings, admin_only, ctx.docs.data_dir)

    # --- Geräte-Check: eigener Inventar-Agent (nur lesend, kein Befehlskanal) ----------------
    radar.extra.append(register_inventory(app, ctx, settings, admin_only))

    # --- Sicherheitslage je Kunde (Gesamtnote, Bericht, Angebot), Benachrichtigungen, Sicherheitsprotokoll ----
    register_posture(app, ctx, admin_only, start=settings.db_path != ":memory:")
    register_notify(app, ctx, settings, admin_only, start=settings.db_path != ":memory:")
    register_audit(app, db, admin_only)

    # --- Erste Schritte: Inbetriebnahme mit Live-Status, Demodaten entfernen -----------------
    register_setup(app, ctx, settings, admin_only)

    # --- Rentabilität je Kunde, Wertsicherung (VPI) -----------------------------------
    register_profitability(app, ctx, admin_only)

    # --- Kundenzufriedenheit nach gelösten Tickets ------------------------------------
    csat = register_csat(app, ctx, admin_only, STATIC_DIR)
    app.state.csat = csat

    # --- Unterwegs: Stoppuhr, Cockpit als App (PWA) -----------------------------------
    register_mobile(app, db, STATIC_DIR, lambda: get_branding(db, settings.company_name))

    # --- Passwort-Wächter: Klartext-Zugangsdaten finden und schwärzen (→ Keeper) ------
    @app.get("/api/security/secrets", dependencies=[Depends(admin_only)])
    def secrets_scan() -> dict:
        findings = scan_secrets(db)
        return {"findings": findings, "count": len(findings)}

    @app.post("/api/security/secrets/redact", dependencies=[Depends(admin_only)])
    def secrets_redact(data: RedactIn) -> dict:
        try:
            changed = redact_row(db, data.table, data.id, data.field)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return {"changed": changed}

    # --- KI-Mitarbeiter (Posteingang, Leads, Belege, Anfrageformular) -----------
    register_mitarbeiter(app, ctx)
    if settings.mail_poll_minutes > 0 and mailer.imap_configured:
        start_mail_poller(ctx, settings.mail_poll_minutes)

    # --- Weboberfläche ----------------------------------------------------------
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.exception_handler(ValueError)
    async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    return app


def __getattr__(name: str):
    """``uvicorn meit.main:app`` – App wird erst beim ersten Zugriff erzeugt (Tests bleiben isoliert)."""
    if name == "app":
        instance = create_app()
        globals()["app"] = instance
        return instance
    raise AttributeError(name)
