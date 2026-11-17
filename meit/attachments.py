"""Anhänge, E-Mail-Upload und Ticket-Verlauf.

* E-Mails aus Outlook per Drag & Drop (.eml/.msg) in den Posteingang oder direkt in ein Ticket.
* Antworten von Kunden landen im **bestehenden Ticket** (In-Reply-To bzw. „[#123]“ im Betreff) statt ein
  neues Ticket zu erzeugen; ein gelöstes Ticket wird dabei wieder geöffnet.
* Ticket-Verlauf: eingehende Mails, Portal-Kommentare, Antworten, interne Notizen und Anhänge.
* Anhänge liegen im Datenordner (``data/anhaenge``); ausführbare Dateien werden nicht angenommen.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

MAX_SIZE = 20 * 1024 * 1024
BLOCKED = (".exe", ".scr", ".js", ".jse", ".vbs", ".vbe", ".bat", ".cmd", ".ps1", ".msi", ".hta", ".lnk", ".jar",
           ".com", ".pif", ".reg", ".wsf", ".dll", ".sys", ".cpl")
INLINE = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}
TICKET_REF = re.compile(r"\[#(\d{1,7})\]|\bTicket(?:nummer)?\s*#?(\d{1,7})\b", re.I)


def _safe_name(name: str) -> str:
    name = Path(unquote(name or "datei")).name
    name = re.sub(r"[^\w.\- äöüÄÖÜß()]+", "_", name).strip(" .") or "datei"
    return name[:150]


def _sniff(data: bytes, name: str) -> str:
    n = name.lower()
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for ext, ct in ((".eml", "message/rfc822"), (".msg", "application/vnd.ms-outlook"), (".txt", "text/plain"),
                    (".csv", "text/csv"), (".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
                    (".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), (".zip", "application/zip")):
        if n.endswith(ext):
            return ct
    return "application/octet-stream"


class Store:
    def __init__(self, db: Database, data_dir: Path):
        self.db = db
        self.root = (Path(data_dir) / "anhaenge").resolve()

    def save(self, ref_type: str, ref_id: int, filename: str, data: bytes, *, source: str = "team", visible: bool = True,
             message_id: int | None = None) -> dict[str, Any]:
        name = _safe_name(filename)
        if not data:
            raise ValueError("Leere Datei")
        if len(data) > MAX_SIZE:
            raise ValueError("Datei zu groß (max. 20 MB)")
        if name.lower().endswith(BLOCKED):
            raise ValueError("Ausführbare Dateien werden aus Sicherheitsgründen nicht angenommen")
        digest = hashlib.sha256(data).hexdigest()
        rel = Path(datetime.now().strftime("%Y/%m")) / f"{digest[:12]}_{name}"
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        aid = self.db.insert("attachments", {"ref_type": ref_type, "ref_id": ref_id, "filename": name,
                                             "content_type": _sniff(data, name), "size": len(data), "sha256": digest,
                                             "path": str(rel), "source": source, "customer_visible": visible,
                                             "message_id": message_id})
        return self.db.get("attachments", aid)

    def path(self, att: dict[str, Any]) -> Path:
        p = (self.root / att["path"]).resolve()
        if not p.is_relative_to(self.root) or not p.is_file():
            raise ValueError("Datei nicht gefunden")
        return p

    def response(self, att: dict[str, Any]) -> FileResponse:
        ctype = att["content_type"] if att["content_type"] in INLINE else "application/octet-stream"
        disposition = "inline" if ctype in INLINE else "attachment"
        return FileResponse(self.path(att), media_type=ctype, headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(att['filename'])}",
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
            "Cache-Control": "private, no-store"})

    def list(self, ref_type: str, ref_id: int, visible_only: bool = False) -> list[dict[str, Any]]:
        return self.db.query("SELECT id, ref_type, ref_id, filename, content_type, size, source, customer_visible, message_id, "
                             "created_at FROM attachments WHERE ref_type = ? AND ref_id = ?"
                             + (" AND customer_visible = 1" if visible_only else "") + " ORDER BY id", (ref_type, ref_id))


# ----------------------------------------------------------------------------- Ticket-Verlauf
def reopen(db: Database, ticket_id: int, actor_note: str) -> None:
    t = db.get("tickets", ticket_id)
    if t and t["status"] in ("geloest", "wartet"):
        db.update("tickets", ticket_id, {"status": "in_arbeit", "resolved_at": ""})
        from .team import log_activity

        log_activity(db, None, "kundenantwort", "ticket", ticket_id, f"{actor_note} – Ticket wieder in Arbeit")


def thread_ticket(db: Database, subject: str, in_reply_to: str, from_email: str) -> int | None:
    """Gehört eine eingehende Mail zu einem bestehenden Ticket? (Antwort auf unsere Mail oder „[#123]“)."""
    if in_reply_to:
        m = db.query_one("SELECT linked_id FROM messages WHERE direction = 'out' AND linked_type = 'ticket' "
                         "AND external_id = ? AND external_id != '' ORDER BY id DESC LIMIT 1", (in_reply_to.strip(),))
        if m and db.get("tickets", m["linked_id"]):
            return m["linked_id"]
    match = TICKET_REF.search(subject or "")
    if match:
        tid = int(match.group(1) or match.group(2))
        t = db.get("tickets", tid)
        if t:
            sender_domain = (from_email or "").rsplit("@", 1)[-1].lower()
            c = db.get("customers", t["customer_id"]) if t["customer_id"] else None
            known = {(c or {}).get("email", "").rsplit("@", 1)[-1].lower()} | {
                r["from_email"].rsplit("@", 1)[-1].lower() for r in db.query(
                    "SELECT from_email FROM messages WHERE linked_type = 'ticket' AND linked_id = ? AND from_email != ''", (tid,))}
            if not c or sender_domain in known:
                return tid
    return None


def link_to_ticket(db: Database, message_id: int, ticket_id: int) -> None:
    t = db.get("tickets", ticket_id)
    db.update("messages", message_id, {"linked_type": "ticket", "linked_id": ticket_id, "customer_id": t["customer_id"],
                                       "category": "support", "status": "zugeordnet"})
    reopen(db, ticket_id, "Antwort des Kunden")


def conversation(db: Database, store: Store, ticket_id: int, customer_view: bool = False) -> dict[str, Any]:
    sql = ("SELECT id, direction, channel, from_name, from_email, to_email, subject, body, status, created_at, sent_at "
           "FROM messages WHERE linked_type = 'ticket' AND linked_id = ?")
    if customer_view:
        sql += " AND channel != 'notiz' AND (direction = 'in' OR status IN ('gesendet', 'manuell'))"
    msgs = db.query(sql + " ORDER BY COALESCE(NULLIF(sent_at, ''), created_at), id", (ticket_id,))
    for m in msgs:
        m["internal"] = m["channel"] == "notiz"
    return {"messages": msgs, "attachments": store.list("ticket", ticket_id, visible_only=customer_view)}


def import_email(ctx: Any, store: Store, data: bytes, filename: str, ticket_id: int | None = None,
                 source: str = "team") -> dict[str, Any]:
    """.eml/.msg einlesen → Nachricht im Posteingang (bzw. im Ticket), Anhänge ablegen, Phishing-Bewertung."""
    from .agents.inbox import insert_incoming, process_message
    from .emails import analyze_phishing, body_text, load_email
    from .mail import _pdf_text, strip_quoted

    db = ctx.db
    mail = load_email(data, filename)
    analysis = analyze_phishing(mail)
    pdf_text = "\n".join(_pdf_text(b) for n, ct, b in mail["attachments"] if ct == "application/pdf" or b[:4] == b"%PDF")
    if mail["message_id"] and db.scalar("SELECT COUNT(*) FROM messages WHERE external_id = ?", (mail["message_id"],)):
        existing = db.query_one("SELECT id, linked_type, linked_id FROM messages WHERE external_id = ?", (mail["message_id"],))
        return {"message_id": existing["id"], "linked_type": existing["linked_type"], "linked_id": existing["linked_id"],
                "duplicate": True, "phishing": analysis}
    mid = insert_incoming(ctx, channel="email", from_name=mail["from_name"], from_email=mail["from_email"],
                          subject=mail["subject"], body=strip_quoted(body_text(mail)),
                          attachments=[n for n, _, _ in mail["attachments"]], external_id=mail["message_id"],
                          attachment_text=pdf_text[:8000])
    meta = loads(db.get("messages", mid)["ai_result"], {}) or {}
    meta["phishing"] = {"score": analysis["score"], "verdict": analysis["verdict"], "reasons": analysis["reasons"][:5]}
    db.update("messages", mid, {"ai_result": json.dumps(meta, ensure_ascii=False)})
    target = ticket_id or thread_ticket(db, mail["subject"], mail["in_reply_to"], mail["from_email"])
    if target:
        link_to_ticket(db, mid, target)
    elif analysis["verdict"] != "gefährlich":
        try:
            process_message(ctx, mid)
        except Exception:  # noqa: BLE001 - Nachricht bleibt im Posteingang
            pass
    m = db.get("messages", mid)
    ref_type, ref_id = ("ticket", m["linked_id"]) if m["linked_type"] == "ticket" else ("message", mid)
    saved = []
    for name, _, payload in mail["attachments"]:
        try:
            saved.append(store.save(ref_type, ref_id, name, payload, source="mail", message_id=mid)["id"])
        except ValueError:
            continue  # z. B. ausführbarer Anhang – wird bewusst nicht gespeichert
    if m["linked_type"] == "receipt" and ctx.docs:
        pdfs = [(n, b) for n, ct, b in mail["attachments"] if ct == "application/pdf" or b[:4] == b"%PDF"]
        if pdfs:
            ctx.docs.archive_receipt(m["linked_id"], pdfs)
    store.save(ref_type, ref_id, _safe_name(filename or "email.eml"), data, source=source, visible=False, message_id=mid)
    return {"message_id": mid, "linked_type": m["linked_type"], "linked_id": m["linked_id"], "category": m["category"],
            "attachments": len(saved), "phishing": analysis}


# ----------------------------------------------------------------------------- API (Cockpit)
class ReplyIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    internal: bool = False
    via: str = Field("email", pattern="^(email|portal)$")  # portal: nur im Kundenportal sichtbar, keine Mail
    wait: bool = False      # danach „wartet auf Kunde“
    resolve: bool = False   # danach „gelöst“


def register(app: FastAPI, ctx: Any, admin_only) -> Store:
    db: Database = ctx.db
    store = Store(db, ctx.docs.data_dir)
    app.state.attachments = store

    async def body(request: Request) -> tuple[bytes, str]:
        data = await request.body()
        if not data:
            raise HTTPException(422, "Leere Datei")
        if len(data) > MAX_SIZE:
            raise HTTPException(413, "Datei zu groß (max. 20 MB)")
        return data, unquote(request.headers.get("x-filename", "datei"))[:200]

    def ticket(tid: int) -> dict[str, Any]:
        t = db.get("tickets", tid)
        if not t:
            raise HTTPException(404, "Ticket nicht gefunden")
        return t

    @app.post("/api/inbox/upload", status_code=201)
    async def inbox_upload(request: Request) -> dict:
        data, name = await body(request)
        try:
            return import_email(ctx, store, data, name)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/phishing/check")
    async def phishing_check(request: Request, ai: bool = False) -> dict:
        """Regelprüfung (sofort, lokal). Mit ``?ai=true`` zusätzlich eine KI-Zweitmeinung (Aufgabe „Phishing-Prüfung“)."""
        from .emails import ai_opinion, analyze_phishing, load_email, phishing_markdown
        from .llm import LLMError

        data, name = await body(request)
        try:
            mail = load_email(data, name)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        result = analyze_phishing(mail)
        out = {**result, "markdown": phishing_markdown(result)}
        if ai:
            llm = ctx.llm("phishing")
            if not llm.available():
                out["ai"] = {"error": "Keine KI verfügbar (lokale KI aus, Claude nicht freigegeben)."}
            else:
                try:
                    out["ai"] = await run_in_threadpool(ai_opinion, llm, mail, result)
                except (LLMError, ValueError) as exc:
                    out["ai"] = {"error": f"KI-Zweitmeinung fehlgeschlagen: {exc}"}
        return out

    @app.get("/api/tickets/{tid}/conversation")
    def ticket_conversation(tid: int) -> dict:
        ticket(tid)
        return conversation(db, store, tid)

    @app.post("/api/tickets/{tid}/attachments", status_code=201)
    async def ticket_upload(tid: int, request: Request, visible: bool = True) -> dict:
        ticket(tid)
        data, name = await body(request)
        try:
            if name.lower().endswith((".eml", ".msg")):
                return import_email(ctx, store, data, name, ticket_id=tid)
            return store.save("ticket", tid, name, data, source="team", visible=visible)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/attachments/{aid}/download")
    def download(aid: int):
        att = db.get("attachments", aid)
        if not att:
            raise HTTPException(404, "Anhang nicht gefunden")
        try:
            return store.response(att)
        except ValueError as exc:
            raise HTTPException(404, str(exc))

    @app.put("/api/attachments/{aid}")
    def set_visible(aid: int, data: dict[str, Any]) -> dict:
        if not db.get("attachments", aid):
            raise HTTPException(404, "Anhang nicht gefunden")
        db.update("attachments", aid, {"customer_visible": bool(data.get("customer_visible"))})
        return db.get("attachments", aid)

    @app.delete("/api/attachments/{aid}")
    def delete(aid: int) -> dict:
        att = db.get("attachments", aid)
        if not att:
            raise HTTPException(404, "Anhang nicht gefunden")
        try:
            store.path(att).unlink()
        except (ValueError, OSError):
            pass
        db.delete("attachments", aid)
        return {"ok": True}

    @app.post("/api/tickets/{tid}/reply")
    def reply(tid: int, data: ReplyIn, request: Request) -> dict:
        t = ticket(tid)
        user = getattr(request.state, "user", None)
        ts = now_iso()
        if data.internal:
            mid = db.insert("messages", {"channel": "notiz", "direction": "out", "status": "intern", "body": data.text,
                                         "subject": f"Notiz {user['name'] if user else ''}".strip(), "linked_type": "ticket",
                                         "linked_id": tid, "customer_id": t["customer_id"], "sent_at": ts})
        elif data.via == "portal":
            mid = db.insert("messages", {"channel": "portal", "direction": "out", "status": "gesendet", "body": data.text,
                                         "subject": f"Antwort zu Ticket #{tid}", "linked_type": "ticket", "linked_id": tid,
                                         "customer_id": t["customer_id"], "sent_at": ts})
            db.query("UPDATE tickets SET first_response_at = ? WHERE id = ? AND (first_response_at IS NULL OR first_response_at = '')",
                     (ts, tid))
        else:
            if not (ctx.mailer and getattr(ctx.mailer, "smtp_configured", False)):
                raise HTTPException(409, "Kein Mailversand eingerichtet (Microsoft 365 oder SMTP).")
            last = db.query_one("SELECT from_email, external_id FROM messages WHERE linked_type = 'ticket' AND linked_id = ? "
                                "AND direction = 'in' AND from_email != '' ORDER BY id DESC LIMIT 1", (tid,))
            c = db.get("customers", t["customer_id"]) if t["customer_id"] else None
            to = (last or {}).get("from_email") or (c or {}).get("email") or ""
            if not to:
                raise HTTPException(422, "Keine E-Mail-Adresse des Kunden bekannt")
            subject = f"{re.sub(r'^(re|aw):\\s*', '', t['title'], flags=re.I)} [#{tid}]"
            try:
                external_id = ctx.mailer.send(to, f"Re: {subject}", data.text, in_reply_to=(last or {}).get("external_id", ""))
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(502, f"Versand fehlgeschlagen: {exc}")
            mid = db.insert("messages", {"channel": "email", "direction": "out", "status": "gesendet", "to_email": to,
                                         "subject": f"Re: {subject}", "body": data.text, "external_id": external_id or "",
                                         "linked_type": "ticket", "linked_id": tid, "customer_id": t["customer_id"],
                                         "sent_at": ts})
            db.query("UPDATE tickets SET first_response_at = ? WHERE id = ? AND (first_response_at IS NULL OR first_response_at = '')",
                     (ts, tid))
        status = "geloest" if data.resolve else "wartet" if data.wait else ("in_arbeit" if t["status"] == "neu" else None)
        if status and status != t["status"]:
            db.update("tickets", tid, {"status": status, "resolved_at": ts if status == "geloest" else ""})
            if status == "geloest" and getattr(app.state, "csat", None):
                try:
                    app.state.csat.on_resolved(tid)
                except Exception:  # noqa: BLE001
                    pass
        return {"message": db.get("messages", mid), "ticket_status": db.get("tickets", tid)["status"]}

    return store
