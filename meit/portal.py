"""Kundenportal: Kunden sehen ihre Tickets, Geräte, Angebote, Rechnungen und erhalten KI-Hilfe.

Sicherheit: eigene Zugänge (getrennt von Mitarbeitern), jede Abfrage ist auf die customer_id
des angemeldeten Portal-Benutzers beschränkt. Die KI-Hilfe nutzt nur freigegebene Wissensartikel.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from .agents.base import AgentContext
from .agents.triage import triage_ticket
from .billing import company_profile, invoice_html
from .db import loads, now_iso
from .llm import LLMError
from .mitarbeiter_api import RateLimiter
from .radar import eol_info
from .team import _token_hash, hash_password, verify_password

STATIC_DIR = Path(__file__).parent / "static"
COOKIE = "meit_portal"
SESSION_DAYS = 30
TICKET_STATUS = {"neu": "eingegangen", "in_arbeit": "in Bearbeitung", "wartet": "wartet auf Rückmeldung",
                 "geloest": "gelöst"}


class PortalLoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class PortalTicketIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field("", max_length=5000)


class PortalAskIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)


class PortalAcceptIn(BaseModel):
    tier: Optional[str] = None


class PortalUserIn(BaseModel):
    name: str = Field("", max_length=120)
    email: str = Field(min_length=3, max_length=200)


class PortalUserUpdate(BaseModel):
    active: Optional[bool] = None
    reset_password: bool = False


def _new_password() -> str:
    return secrets.token_urlsafe(12)


def register(app: FastAPI, ctx: AgentContext, admin_only: Callable, accept_quote: Callable) -> None:
    db = ctx.db
    login_limiter = RateLimiter(limit=10, window_s=600)
    ask_limiter = RateLimiter(limit=20, window_s=600)
    ticket_limiter = RateLimiter(limit=10, window_s=3600)

    def portal_user(request: Request) -> dict[str, Any]:
        token = request.cookies.get(COOKIE)
        row = db.query_one(
            "SELECT p.id, p.name, p.email, p.customer_id, s.expires_at, c.name AS customer FROM portal_sessions s "
            "JOIN portal_users p ON p.id = s.portal_user_id JOIN customers c ON c.id = p.customer_id "
            "WHERE s.token_hash = ? AND p.active = 1", (_token_hash(token),)) if token else None
        if not row or row["expires_at"] < now_iso():
            raise HTTPException(401, "Bitte anmelden.")
        if request.method not in ("GET", "HEAD") and request.headers.get("origin") and \
                request.headers["origin"].split("://")[-1].rstrip("/") != request.headers.get("host", ""):
            raise HTTPException(403, "Anfrage von fremder Herkunft blockiert.")
        return dict(row)

    # ------------------------------------------------------------ Seite & Login
    @app.get("/portal", include_in_schema=False)
    def portal_page() -> FileResponse:
        return FileResponse(STATIC_DIR / "portal.html")

    @app.post("/api/portal/login")
    def login(data: PortalLoginIn, request: Request, response: Response) -> dict:
        client = request.client.host if request.client else "?"
        if not login_limiter.allow(client):
            raise HTTPException(429, "Zu viele Versuche – bitte später erneut.")
        u = db.query_one("SELECT * FROM portal_users WHERE lower(email) = lower(?) AND active = 1", (data.email.strip(),))
        if not u or not verify_password(data.password, u["password_hash"]):
            raise HTTPException(401, "E-Mail oder Passwort falsch.")
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat(sep=" ")
        with db.connect() as conn:
            conn.execute("INSERT INTO portal_sessions (token_hash, portal_user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                         (_token_hash(token), u["id"], expires, now_iso()))
            conn.execute("DELETE FROM portal_sessions WHERE expires_at < ?", (now_iso(),))
        db.update("portal_users", u["id"], {"last_login_at": now_iso()})
        response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
                            secure=request.url.scheme == "https", path="/")
        return {"ok": True}

    @app.post("/api/portal/logout")
    def logout(request: Request, response: Response) -> dict:
        token = request.cookies.get(COOKIE)
        if token:
            with db.connect() as conn:
                conn.execute("DELETE FROM portal_sessions WHERE token_hash = ?", (_token_hash(token),))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    # ------------------------------------------------------------------ Daten
    @app.get("/api/portal/me")
    def me(u: dict = Depends(portal_user)) -> dict:
        cid = u["customer_id"]
        c = db.get("customers", cid)
        sec = db.query_one("SELECT score, level, created_at FROM assessments WHERE customer_id = ? "
                           "ORDER BY created_at DESC, id DESC LIMIT 1", (cid,))
        today = date.today()
        eol = sum(1 for a in db.query("SELECT os FROM assets WHERE customer_id = ?", (cid,))
                  if (i := eol_info(a["os"] or "")) and i[0] <= today)
        return {
            "user": {"name": u["name"], "email": u["email"]}, "customer": c["name"], "company": ctx.company,
            "package": c["package"], "booked_services": loads(c["booked_services"], []),
            "open_tickets": db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND status != 'geloest'", (cid,)),
            "devices": db.scalar("SELECT COUNT(*) FROM assets WHERE customer_id = ?", (cid,)), "devices_eol": eol,
            "security": sec, "open_quotes": db.scalar("SELECT COUNT(*) FROM quotes WHERE customer_id = ? AND status = 'versendet'", (cid,)),
            "open_invoices": db.scalar("SELECT COALESCE(SUM(gross), 0) FROM invoices WHERE customer_id = ? AND status = 'gestellt'", (cid,)),
        }

    @app.get("/api/portal/tickets")
    def tickets(u: dict = Depends(portal_user)) -> list[dict]:
        rows = db.query("SELECT id, title, description, status, priority, category, solution, created_at, resolved_at "
                        "FROM tickets WHERE customer_id = ? ORDER BY CASE status WHEN 'geloest' THEN 1 ELSE 0 END, id DESC "
                        "LIMIT 100", (u["customer_id"],))
        for r in rows:
            r["status_label"] = TICKET_STATUS.get(r["status"], r["status"])
            if r["status"] != "geloest":
                r["solution"] = ""
        return rows

    @app.post("/api/portal/tickets", status_code=201)
    def new_ticket(data: PortalTicketIn, u: dict = Depends(portal_user)) -> dict:
        if not ticket_limiter.allow(f"t{u['id']}"):
            raise HTTPException(429, "Zu viele neue Tickets in kurzer Zeit – bitte rufen Sie uns an.")
        tid = db.insert("tickets", {"customer_id": u["customer_id"], "title": data.title,
                                    "description": f"{data.description}\n\n— über das Kundenportal von {u['name'] or u['email']}",
                                    "status": "neu"})
        try:
            triage_ticket(ctx, tid)
        except Exception:  # noqa: BLE001 - Ticket bleibt bestehen
            pass
        t = db.get("tickets", tid)
        return {"id": tid, "title": t["title"], "priority": t["priority"], "status_label": TICKET_STATUS["neu"]}

    @app.get("/api/portal/assets")
    def assets(u: dict = Depends(portal_user)) -> list[dict]:
        today = date.today()
        rows = db.query("SELECT name, type, os, warranty_end FROM assets WHERE customer_id = ? ORDER BY name", (u["customer_id"],))
        for r in rows:
            info = eol_info(r["os"] or "")
            r["support"] = ("abgelaufen" if info and info[0] <= today else
                            f"endet {info[0].strftime('%d.%m.%Y')}" if info and info[0] <= today + timedelta(days=548) else "ok")
        return rows

    @app.get("/api/portal/quotes")
    def quotes(u: dict = Depends(portal_user)) -> list[dict]:
        rows = db.query("SELECT id, title, text, status, total_once, total_monthly, tiers, chosen_tier, created_at FROM quotes "
                        "WHERE customer_id = ? AND status IN ('versendet', 'angenommen') ORDER BY id DESC", (u["customer_id"],))
        for r in rows:
            r["tiers"] = [{k: t[k] for k in ("key", "label", "total_once", "total_monthly", "recommended")}
                          for t in loads(r["tiers"], [])]
        return rows

    @app.post("/api/portal/quotes/{qid}/accept")
    def accept(qid: int, data: PortalAcceptIn, u: dict = Depends(portal_user)) -> dict:
        q = db.get("quotes", qid)
        if not q or q["customer_id"] != u["customer_id"]:
            raise HTTPException(404, "Angebot nicht gefunden")
        if q["status"] != "versendet":
            raise HTTPException(409, "Dieses Angebot kann nicht (mehr) angenommen werden.")
        accept_quote(qid, "angenommen", data.tier, None, f" – online angenommen von {u['name'] or u['email']}")
        r = db.get("quotes", qid)
        return {"ok": True, "status": r["status"], "chosen_tier": r["chosen_tier"]}

    @app.get("/api/portal/invoices")
    def invoices(u: dict = Depends(portal_user)) -> list[dict]:
        rows = db.query("SELECT id, number, period, date, due_date, gross, status FROM invoices WHERE customer_id = ? "
                        "AND status IN ('gestellt', 'bezahlt') ORDER BY date DESC", (u["customer_id"],))
        today = date.today().isoformat()
        for r in rows:
            r["overdue"] = r["status"] == "gestellt" and bool(r["due_date"]) and r["due_date"] < today
        return rows

    @app.get("/api/portal/invoices/{iid}/html", response_class=HTMLResponse)
    def invoice(iid: int, u: dict = Depends(portal_user)) -> str:
        inv = db.get("invoices", iid)
        if not inv or inv["customer_id"] != u["customer_id"] or inv["status"] not in ("gestellt", "bezahlt"):
            raise HTTPException(404, "Rechnung nicht gefunden")
        return invoice_html(db, inv, company_profile(db, ctx.company))

    @app.get("/api/portal/invoices/{iid}/pdf")
    def invoice_pdf(iid: int, u: dict = Depends(portal_user)):
        from .documents import pdf_response

        inv = db.get("invoices", iid)
        if not inv or inv["customer_id"] != u["customer_id"] or inv["status"] not in ("gestellt", "bezahlt"):
            raise HTTPException(404, "Rechnung nicht gefunden")
        return pdf_response(ctx.docs.invoice_pdf(inv), ctx.docs.invoice_filename(inv))

    @app.get("/api/portal/quotes/{qid}/pdf")
    def quote_pdf(qid: int, u: dict = Depends(portal_user)):
        from .documents import pdf_response

        q = db.get("quotes", qid)
        if not q or q["customer_id"] != u["customer_id"] or q["status"] not in ("versendet", "angenommen"):
            raise HTTPException(404, "Angebot nicht gefunden")
        return pdf_response(ctx.docs.quote_pdf(q), ctx.docs.quote_filename(q))

    @app.post("/api/portal/ask")
    def ask(data: PortalAskIn, u: dict = Depends(portal_user)) -> dict:
        if not ask_limiter.allow(f"a{u['id']}"):
            raise HTTPException(429, "Zu viele Fragen in kurzer Zeit – bitte später erneut.")
        hits = ctx.kb.search(data.question, limit=3, public_only=True)
        sources = [{"title": h["title"]} for h in hits]
        llm = ctx.llm()
        if llm.available() and hits:
            context = "\n\n".join(f"### {h['title']}\n{h['content'][:2500]}" for h in hits)
            try:
                answer = llm.chat(
                    [{"role": "user", "content": f"Frage eines Kunden: {data.question}\n\nFreigegebene Anleitungen:\n{context}"}],
                    system=(f"Du bist die Hilfe-Funktion im Kundenportal von {ctx.company} (IT-Dienstleister). Antworte "
                            "freundlich in Sie-Form, kurz, mit nummerierten Schritten, NUR auf Basis der Anleitungen. "
                            "Keine Schritte, die Administratorrechte, Registry oder Server betreffen – dann auf ein Ticket "
                            "verweisen. Wenn die Anleitungen nicht passen: ehrlich sagen und ein Ticket empfehlen. "
                            "Bei Verdacht auf Virus/Phishing: sofort Gerät vom Netz trennen und uns anrufen."),
                    temperature=0.2)
                return {"answer": answer, "sources": sources, "suggest_ticket": True, "provider": f"{llm.provider}"}
            except LLMError:
                pass
        if hits:
            answer = "Diese Anleitungen könnten helfen:\n\n" + "\n\n".join(f"### {h['title']}\n{h['content']}" for h in hits)
        else:
            answer = ("Dazu habe ich keine passende Anleitung gefunden. Legen Sie am besten ein Ticket an – "
                      "wir kümmern uns darum.")
        return {"answer": answer, "sources": sources, "suggest_ticket": True, "provider": "wissen"}

    # ------------------------------------------- Verwaltung durch Mitarbeiter
    @app.get("/api/customers/{cid}/portal-users")
    def list_portal_users(cid: int) -> list[dict]:
        return db.query("SELECT id, name, email, active, last_login_at, created_at FROM portal_users WHERE customer_id = ? "
                        "ORDER BY id", (cid,))

    @app.post("/api/customers/{cid}/portal-users", status_code=201, dependencies=[Depends(admin_only)])
    def add_portal_user(cid: int, data: PortalUserIn) -> dict:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        if db.query_one("SELECT id FROM portal_users WHERE lower(email) = lower(?)", (data.email.strip(),)):
            raise HTTPException(409, "E-Mail hat bereits einen Portalzugang")
        password = _new_password()
        pid = db.insert("portal_users", {"customer_id": cid, "name": data.name, "email": data.email.strip().lower(),
                                         "password_hash": hash_password(password), "active": True})
        return {"id": pid, "email": data.email.strip().lower(), "password": password}

    @app.put("/api/portal-users/{pid}", dependencies=[Depends(admin_only)])
    def update_portal_user(pid: int, data: PortalUserUpdate) -> dict:
        pu = db.get("portal_users", pid)
        if not pu:
            raise HTTPException(404, "Portalzugang nicht gefunden")
        result: dict[str, Any] = {"id": pid}
        if data.active is not None:
            db.update("portal_users", pid, {"active": data.active})
        if data.reset_password:
            password = _new_password()
            db.update("portal_users", pid, {"password_hash": hash_password(password)})
            result["password"] = password
        if data.reset_password or data.active is False:
            with db.connect() as conn:
                conn.execute("DELETE FROM portal_sessions WHERE portal_user_id = ?", (pid,))
        return result
