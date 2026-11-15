"""API des KI-Mitarbeiters: Posteingang, Leads, Belege, Nachfassen, öffentliches Anfrageformular."""

from __future__ import annotations

import csv
import io
import threading
import time
from collections import defaultdict, deque
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .agents.base import AgentContext
from .agents.inbox import (
    CATEGORIES, create_followups, fetch_and_process, insert_incoming, message_out, overview, process_message,
    send_message_reply,
)
from .db import loads
from .mail import MailError

STATIC_DIR = Path(__file__).parent / "static"
# Phasen nach dem 3-Gespräche-Prinzip: Erstgespräch (Diagnose) → Pitch → Angebotsbesprechung
LEAD_STAGES = ["neu", "erstgespraech", "pitch", "angebot", "gewonnen", "verloren"]
PUBLIC_PREFIXES = ("/anfrage", "/api/public/")


class ManualMessageIn(BaseModel):
    from_name: str = Field("", max_length=200)
    from_email: str = Field("", max_length=200)
    phone: str = Field("", max_length=60)
    company: str = Field("", max_length=200)
    subject: str = Field("", max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    channel: str = Field("manuell", max_length=20)
    process: bool = True


class ApproveIn(BaseModel):
    text: str = Field("", max_length=20000)
    manual: bool = False


class DraftIn(BaseModel):
    text: str = Field("", max_length=20000)


class LeadIn(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    need: Optional[str] = None
    stage: Optional[str] = None
    notes: Optional[str] = None
    score: Optional[int] = None


class ReceiptIn(BaseModel):
    vendor: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_date: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None


class ModesIn(BaseModel):
    modes: dict[str, str]


class PublicInquiryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=5, max_length=200)
    phone: str = Field("", max_length=60)
    company: str = Field("", max_length=160)
    message: str = Field(min_length=5, max_length=5000)
    website: str = Field("", max_length=200)  # Honeypot für Bots – Menschen lassen es leer


def is_public_path(path: str) -> bool:
    return path == "/anfrage" or path.startswith("/api/public/")


class RateLimiter:
    def __init__(self, limit: int = 5, window_s: int = 600):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


def start_mail_poller(ctx: AgentContext, minutes: int) -> threading.Thread:
    def loop() -> None:
        time.sleep(10)
        while True:
            try:
                fetch_and_process(ctx)
            except Exception:  # noqa: BLE001 - Fehler wird in mail_last_error vermerkt, Schleife läuft weiter
                pass
            time.sleep(max(1, minutes) * 60)

    thread = threading.Thread(target=loop, name="meit-mail-poller", daemon=True)
    thread.start()
    return thread


def register(app: FastAPI, ctx: AgentContext) -> None:
    db = ctx.db
    settings = ctx.settings
    limiter = RateLimiter()

    def must(row: dict | None, what: str = "Eintrag") -> dict:
        if not row:
            raise HTTPException(404, f"{what} nicht gefunden")
        return row

    # ------------------------------------------------------------- Posteingang
    @app.get("/api/inbox")
    def list_inbox(status: Optional[str] = None, direction: Optional[str] = None, limit: int = 200) -> list[dict]:
        sql = ("SELECT m.*, c.name AS customer_name FROM messages m LEFT JOIN customers c ON c.id = m.customer_id "
               "WHERE 1=1")
        params: list[Any] = []
        if status:
            states = [s for s in status.split(",") if s]
            sql += f" AND m.status IN ({','.join('?' for _ in states)})"
            params += states
        if direction in ("in", "out"):
            sql += " AND m.direction = ?"
            params.append(direction)
        sql += " ORDER BY m.id DESC LIMIT ?"
        params.append(min(limit, 1000))
        return [message_out(r) for r in db.query(sql, params)]

    @app.get("/api/inbox/{mid}")
    def get_message(mid: int) -> dict:
        m = message_out(must(db.get("messages", mid), "Nachricht"))
        m["thread"] = [message_out(r) for r in db.query(
            "SELECT * FROM messages WHERE reply_to_id = ? ORDER BY id", (mid,))]
        if m["linked_type"] in ("ticket", "lead", "receipt", "quote") and m["linked_id"]:
            table = {"ticket": "tickets", "lead": "leads", "receipt": "receipts", "quote": "quotes"}[m["linked_type"]]
            m["linked"] = db.get(table, m["linked_id"])
        if m["customer_id"]:
            c = db.get("customers", m["customer_id"])
            m["customer_name"] = c["name"] if c else ""
        return m

    @app.post("/api/inbox", status_code=201)
    def add_message(data: ManualMessageIn) -> dict:
        mid = insert_incoming(ctx, channel=data.channel if data.channel in ("manuell", "telefon", "email", "web") else "manuell",
                              from_name=data.from_name, from_email=data.from_email, phone=data.phone,
                              company=data.company, subject=data.subject, body=data.body)
        if data.process:
            return process_message(ctx, mid)
        return message_out(db.get("messages", mid))

    @app.post("/api/inbox/process-new")
    def process_new(limit: int = 20) -> dict:
        ids = [r["id"] for r in db.query(
            "SELECT id FROM messages WHERE direction = 'in' AND status = 'neu' ORDER BY id LIMIT ?", (min(limit, 100),))]
        done, failed = 0, 0
        for mid in ids:
            try:
                process_message(ctx, mid)
                done += 1
            except Exception:  # noqa: BLE001
                failed += 1
        return {"processed": done, "failed": failed}

    @app.post("/api/inbox/{mid}/process")
    def reprocess(mid: int) -> dict:
        m = must(db.get("messages", mid), "Nachricht")
        if m["direction"] != "in":
            raise HTTPException(422, "Nur eingehende Nachrichten können analysiert werden")
        return process_message(ctx, mid)

    @app.put("/api/inbox/{mid}/draft")
    def save_draft(mid: int, data: DraftIn) -> dict:
        m = must(db.get("messages", mid), "Nachricht")
        fields = {"draft_reply": data.text}
        if m["direction"] == "out":
            fields["body"] = data.text
        db.update("messages", mid, fields)
        return message_out(db.get("messages", mid))

    @app.post("/api/inbox/{mid}/approve")
    def approve(mid: int, data: ApproveIn) -> dict:
        m = must(db.get("messages", mid), "Nachricht")
        needs_text = (m["direction"] == "out") or (m["category"] in ("support", "anfrage", "termin") and m["from_email"])
        if not needs_text:
            # Beleg/Info: Freigabe bedeutet "geprüft, erledigt"
            ai = loads(m["ai_result"], {}) or {}
            ai["handled_by"] = "freigabe"
            import json as _json
            db.update("messages", mid, {"status": "erledigt", "ai_result": _json.dumps(ai, ensure_ascii=False)})
            if m["linked_type"] == "receipt" and m["linked_id"]:
                db.update("receipts", m["linked_id"], {"status": "geprueft"})
            return {"sent": False, "status": "erledigt"}
        text = data.text or m["draft_reply"] or (m["body"] if m["direction"] == "out" else "")
        try:
            result = send_message_reply(ctx, mid, text, manual=data.manual)
        except MailError as exc:
            raise HTTPException(409, f"{exc} – Text kopieren und manuell senden, dann 'Manuell erledigt' wählen.")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return {**result, "status": db.get("messages", mid)["status"]}

    @app.post("/api/inbox/{mid}/ignore")
    def ignore(mid: int) -> dict:
        must(db.get("messages", mid), "Nachricht")
        db.update("messages", mid, {"status": "ignoriert"})
        return {"ok": True}

    @app.delete("/api/inbox/{mid}")
    def delete_message(mid: int) -> dict:
        if not db.delete("messages", mid):
            raise HTTPException(404, "Nachricht nicht gefunden")
        return {"ok": True}

    @app.post("/api/inbox/fetch")
    def fetch_mail() -> dict:
        if not (ctx.mailer and ctx.mailer.imap_configured):
            raise HTTPException(409, "Postfach nicht verbunden: MAIL_IMAP_HOST, MAIL_IMAP_USER und MAIL_IMAP_PASSWORD in .env setzen.")
        try:
            return fetch_and_process(ctx)
        except MailError as exc:
            raise HTTPException(502, str(exc))

    @app.post("/api/agents/followups")
    def followups() -> dict:
        created = create_followups(ctx)
        return {"created": len(created), "items": created}

    # ------------------------------------------------------------------- Leads
    @app.get("/api/leads")
    def list_leads(stage: Optional[str] = None) -> list[dict]:
        sql, params = "SELECT * FROM leads", ()
        if stage:
            sql, params = sql + " WHERE stage = ?", (stage,)
        rows = db.query(sql + " ORDER BY CASE stage WHEN 'neu' THEN 0 WHEN 'erstgespraech' THEN 1 WHEN 'pitch' THEN 2 "
                        "WHEN 'angebot' THEN 3 ELSE 4 END, score DESC, id DESC", params)
        for r in rows:
            r["qualification"] = loads(r["qualification"], {})
        return rows

    @app.get("/api/leads/{lid}")
    def get_lead(lid: int) -> dict:
        lead = must(db.get("leads", lid), "Lead")
        lead["qualification"] = loads(lead["qualification"], {})
        lead["messages"] = [message_out(m) for m in db.query(
            "SELECT * FROM messages WHERE linked_type = 'lead' AND linked_id = ? ORDER BY id DESC", (lid,))]
        return lead

    @app.put("/api/leads/{lid}")
    def update_lead(lid: int, data: LeadIn) -> dict:
        must(db.get("leads", lid), "Lead")
        payload = {k: v for k, v in data.model_dump().items() if v is not None}
        if "stage" in payload and payload["stage"] not in LEAD_STAGES:
            raise HTTPException(422, "Ungültige Phase")
        db.update("leads", lid, payload)
        return get_lead(lid)

    @app.delete("/api/leads/{lid}")
    def delete_lead(lid: int) -> dict:
        if not db.delete("leads", lid):
            raise HTTPException(404, "Lead nicht gefunden")
        return {"ok": True}

    @app.post("/api/leads/{lid}/convert", status_code=201)
    def convert_lead(lid: int) -> dict:
        lead = must(db.get("leads", lid), "Lead")
        if lead["customer_id"] and db.get("customers", lead["customer_id"]):
            return {"customer_id": lead["customer_id"], "existing": True}
        qual = loads(lead["qualification"], {})
        try:
            employees = int(qual.get("mitarbeiter") or 0)
        except (TypeError, ValueError):
            employees = 0
        cid = db.insert("customers", {
            "name": lead["company"] or lead["name"] or lead["email"], "contact_name": lead["name"],
            "email": lead["email"], "phone": lead["phone"], "employees": employees, "package": "keins",
            "booked_services": [], "notes": f"Aus Lead #{lid}: {lead['need'][:500]}"})
        db.update("leads", lid, {"customer_id": cid})
        db.query("UPDATE messages SET customer_id = ? WHERE linked_type = 'lead' AND linked_id = ?", (cid, lid))
        return {"customer_id": cid, "existing": False}

    # ------------------------------------------------------------------ Belege
    @app.get("/api/receipts")
    def list_receipts(status: Optional[str] = None) -> list[dict]:
        sql, params = "SELECT * FROM receipts", ()
        if status:
            sql, params = sql + " WHERE status = ?", (status,)
        return db.query(sql + " ORDER BY id DESC", params)

    @app.put("/api/receipts/{rid}")
    def update_receipt(rid: int, data: ReceiptIn) -> dict:
        must(db.get("receipts", rid), "Beleg")
        payload = {k: v for k, v in data.model_dump().items() if v is not None}
        if "status" in payload and payload["status"] not in ("offen", "geprueft", "exportiert"):
            raise HTTPException(422, "Ungültiger Status")
        db.update("receipts", rid, payload)
        return db.get("receipts", rid)

    @app.delete("/api/receipts/{rid}")
    def delete_receipt(rid: int) -> dict:
        if not db.delete("receipts", rid):
            raise HTTPException(404, "Beleg nicht gefunden")
        return {"ok": True}

    @app.get("/api/receipts/export.csv")
    def export_receipts(status: str = "geprueft", mark: bool = False) -> Response:
        """CSV für Steuerberater/Buchhaltung (Excel-tauglich: Semikolon, Dezimalkomma, UTF-8 mit BOM)."""
        rows = db.query("SELECT * FROM receipts WHERE status = ? ORDER BY invoice_date, id", (status,)) if status != "alle" \
            else db.query("SELECT * FROM receipts ORDER BY invoice_date, id")
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        writer.writerow(["Belegdatum", "Lieferant", "Rechnungsnummer", "Betrag", "Währung", "Kategorie", "Notiz", "Beleg-ID"])
        for r in rows:
            d = r["invoice_date"]
            writer.writerow([f"{d[8:10]}.{d[5:7]}.{d[0:4]}" if len(d) == 10 else d, r["vendor"], r["invoice_no"],
                             f"{r['amount']:.2f}".replace(".", ","), r["currency"], r["category"], r["note"], r["id"]])
        if mark and rows:
            for r in rows:
                db.update("receipts", r["id"], {"status": "exportiert"})
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8", headers={
            "Content-Disposition": f'attachment; filename="belege-{date.today().isoformat()}.csv"'})

    # ------------------------------------------------------- Steuerung/Übersicht
    @app.get("/api/ki-mitarbeiter/overview")
    def km_overview(days: int = 7) -> dict:
        data = overview(ctx, days=max(1, min(days, 90)))
        data["categories"] = CATEGORIES
        data["booking_url"] = settings.booking_url
        data["followup_days"] = settings.followup_days
        data["public_form_enabled"] = settings.public_form_enabled
        data["poll_minutes"] = settings.mail_poll_minutes
        return data

    @app.put("/api/ki-mitarbeiter/modes")
    def set_modes(data: ModesIn) -> dict:
        clean = {k: v for k, v in data.modes.items() if k in CATEGORIES and v in ("entwurf", "autopilot")}
        current = db.get_setting("inbox_modes", {}) or {}
        current.update(clean)
        db.set_setting("inbox_modes", current)
        return overview(ctx)["modes"]

    # ---------------------------------------------------- Öffentliches Formular
    @app.get("/anfrage", include_in_schema=False)
    def public_form() -> FileResponse:
        if not settings.public_form_enabled:
            raise HTTPException(404, "Nicht verfügbar")
        return FileResponse(STATIC_DIR / "anfrage.html")

    @app.get("/api/public/info")
    def public_info() -> dict:
        if not settings.public_form_enabled:
            raise HTTPException(404, "Nicht verfügbar")
        return {"company": settings.company_name, "booking_url": settings.booking_url}

    @app.post("/api/public/inquiry", status_code=201)
    def public_inquiry(data: PublicInquiryIn, request: Request, background: BackgroundTasks) -> dict:
        if not settings.public_form_enabled:
            raise HTTPException(404, "Nicht verfügbar")
        client = request.client.host if request.client else "?"
        if not limiter.allow(client):
            raise HTTPException(429, "Zu viele Anfragen – bitte später erneut versuchen.")
        if data.website:  # Bot: so tun, als hätte es geklappt
            return {"ok": True}
        if "@" not in data.email or "." not in data.email.split("@")[-1]:
            raise HTTPException(422, "Bitte eine gültige E-Mail-Adresse angeben.")
        first_line = data.message.strip().splitlines()[0][:80]
        mid = insert_incoming(ctx, channel="web", from_name=data.name, from_email=data.email, phone=data.phone,
                              company=data.company, subject=f"Webanfrage: {first_line}", body=data.message)
        background.add_task(_safe_process, ctx, mid)
        return {"ok": True}


def _safe_process(ctx: AgentContext, mid: int) -> None:
    try:
        process_message(ctx, mid)
    except Exception:  # noqa: BLE001 - Nachricht bleibt als "neu" im Posteingang
        pass
