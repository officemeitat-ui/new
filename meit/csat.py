"""Kundenzufriedenheit (CSAT): nach jedem gelösten Ticket eine Bewertung mit einem Klick.

* Beim Lösen eines Kundentickets entsteht eine Umfrage; mit PUBLIC_URL und Mailversand geht eine kurze
  Mail im Corporate Design hinaus (5 Smileys → öffentliche Bewertungsseite, kein Login nötig).
* Im Kundenportal kann jedes erledigte Ticket direkt bewertet werden.
* Schlechte Bewertung (≤ 2) → sofort ein Ticket „Kundenfeedback“ mit Priorität hoch (Rückruf, Service Recovery).
* Kennzahlen fließen in Health Score, Monatsbericht, QBR und Dashboard.
"""

from __future__ import annotations

import html
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .db import Database, now_iso

FACES = {5: ("😀", "sehr zufrieden"), 4: ("🙂", "zufrieden"), 3: ("😐", "geht so"), 2: ("🙁", "unzufrieden"),
         1: ("😞", "sehr unzufrieden")}
DEFAULT = {
    "enabled": True, "low_threshold": 2, "valid_days": 30,
    "subject": "Ihr Anliegen „{titel}“ ist erledigt – wie zufrieden waren Sie?",
    "text": ("{anrede}\n\nwir haben Ihr Anliegen „{titel}“ (Ticket #{ticket}) erledigt. Wie zufrieden waren Sie mit "
             "unserer Unterstützung? Ein Klick genügt – das hilft uns, noch besser zu werden.\n\nFreundliche Grüße\n{firma}"),
}


def csat_conf(db: Database) -> dict[str, Any]:
    return {**DEFAULT, **{k: v for k, v in (db.get_setting("csat", {}) or {}).items() if k in DEFAULT}}


def stats(db: Database, customer_id: int | None = None, days: int = 90, today: date | None = None,
          since: str | None = None, until: str | None = None) -> dict[str, Any]:
    today = today or date.today()
    since = since or (today - timedelta(days=days)).isoformat()
    sql = "SELECT rating FROM csat_surveys WHERE rating IS NOT NULL AND substr(rated_at, 1, 10) >= ?"
    params: list[Any] = [since]
    if until:
        sql += " AND substr(rated_at, 1, 10) <= ?"
        params.append(until)
    if customer_id:
        sql += " AND customer_id = ?"
        params.append(customer_id)
    ratings = [r["rating"] for r in db.query(sql, params)]
    sent = db.scalar("SELECT COUNT(*) FROM csat_surveys WHERE created_at >= ?" + (" AND customer_id = ?" if customer_id else ""),
                     [since, *([customer_id] if customer_id else [])]) or 0
    return {"count": len(ratings), "avg": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "positive_pct": round(100 * sum(1 for r in ratings if r >= 4) / len(ratings)) if ratings else None,
            "surveys": sent, "response_pct": round(100 * len(ratings) / sent) if sent else None}


def fmt_avg(v: float | None) -> str:
    return f"{v:.1f}".replace(".", ",") if v is not None else "–"


class Csat:
    def __init__(self, ctx: Any):
        self.ctx, self.db = ctx, ctx.db

    def _recipient(self, ticket: dict[str, Any]) -> str:
        m = self.db.query_one("SELECT from_email FROM messages WHERE direction = 'in' AND linked_type = 'ticket' "
                              "AND linked_id = ? AND from_email != '' ORDER BY id LIMIT 1", (ticket["id"],))
        if m:
            return m["from_email"]
        c = self.db.get("customers", ticket["customer_id"]) if ticket.get("customer_id") else None
        return (c or {}).get("email") or ""

    def survey_for(self, ticket_id: int) -> dict[str, Any] | None:
        t = self.db.get("tickets", ticket_id)
        internal = ("RMM:", "Kundenfeedback:", "Wartung:", "Folgeaufgabe Wartung:")
        if not t or not t["customer_id"] or t.get("category") == "Wartung" or str(t["title"]).startswith(internal):
            return None  # nur echte Kundenanliegen
        existing = self.db.query_one("SELECT * FROM csat_surveys WHERE ticket_id = ?", (ticket_id,))
        if existing:
            return existing
        sid = self.db.insert("csat_surveys", {"ticket_id": ticket_id, "customer_id": t["customer_id"],
                                              "email": self._recipient(t), "token": secrets.token_urlsafe(24)})
        return self.db.get("csat_surveys", sid)

    def on_resolved(self, ticket_id: int) -> dict[str, Any] | None:
        conf = csat_conf(self.db)
        survey = self.survey_for(ticket_id)
        if not survey or survey["sent_at"] or survey["rating"] or not conf["enabled"]:
            return survey
        base = getattr(self.ctx.settings, "public_url", "") if self.ctx.settings else ""
        mailer = self.ctx.mailer
        if not base or not survey["email"] or not (mailer and getattr(mailer, "smtp_configured", False)):
            return survey  # Bewertung dann im Kundenportal möglich
        self.send(survey, base, conf)
        return self.db.get("csat_surveys", survey["id"])

    def send(self, survey: dict[str, Any], base: str, conf: dict[str, Any]) -> None:
        from .billing import company_profile
        from .branding import get_branding
        from .documents import fill_text

        t = self.db.get("tickets", survey["ticket_id"])
        customer = self.db.get("customers", survey["customer_id"]) or {}
        profile = company_profile(self.db, self.ctx.company)
        b = get_branding(self.db, profile.get("name") or self.ctx.company)
        contact = customer.get("contact_name") or ""
        values = {"anrede": f"Guten Tag {contact}," if contact else "Guten Tag,", "titel": t["title"],
                  "ticket": str(t["id"]), "firma": profile.get("name") or self.ctx.company}
        subject, text = fill_text(conf["subject"], values), fill_text(conf["text"], values)
        buttons = "".join(
            f'<a href="{html.escape(base)}/bewertung?t={survey["token"]}&amp;r={n}" style="display:inline-block;margin:4px;'
            f'padding:10px 12px;border:1px solid #d6e4e7;border-radius:10px;text-decoration:none;color:{b["dark"]};'
            f'font-size:14px;text-align:center;min-width:76px"><span style="font-size:28px;line-height:1.2">{face}</span>'
            f'<br>{label}</a>' for n, (face, label) in FACES.items())
        plain = text + "\n\n" + "\n".join(f"{n} – {label}: {base}/bewertung?t={survey['token']}&r={n}"
                                          for n, (_, label) in FACES.items())
        docs = self.ctx.docs
        mail_html = docs.mail_html(text, f'<p style="margin:0 0 18px;text-align:center">{buttons}</p>')
        attachments = []
        try:
            attachments.append(docs._logo_attachment())
        except OSError:
            pass
        external_id = self.ctx.mailer.send(survey["email"], subject, plain, attachments=attachments, html=mail_html)
        self.db.update("csat_surveys", survey["id"], {"sent_at": now_iso(), "channel": "mail"})
        docs.log_out(survey["email"], subject, plain, survey["customer_id"], "ticket", survey["ticket_id"], external_id or "", 0)

    def rate(self, survey: dict[str, Any], rating: int, comment: str = "", channel: str = "web") -> dict[str, Any]:
        if rating not in FACES:
            raise ValueError("Bewertung 1 bis 5")
        conf = csat_conf(self.db)
        created = datetime.fromisoformat(survey["created_at"])
        if datetime.now() - created > timedelta(days=int(conf["valid_days"]) + 30):
            raise ValueError("Diese Umfrage ist abgelaufen.")
        self.db.update("csat_surveys", survey["id"], {"rating": rating, "comment": comment[:2000], "rated_at": now_iso(),
                                                     "channel": survey["channel"] or channel})
        survey = self.db.get("csat_surveys", survey["id"])
        if rating <= int(conf["low_threshold"]) and not survey["followup_ticket_id"]:
            t = self.db.get("tickets", survey["ticket_id"]) or {"title": "", "id": survey["ticket_id"]}
            fid = self.db.insert("tickets", {
                "customer_id": survey["customer_id"], "priority": "hoch", "status": "neu", "category": "Kundenfeedback",
                "title": f"Kundenfeedback: {rating}/5 zu „{t['title']}“"[:200],
                "description": (f"Der Kunde hat Ticket #{t['id']} mit {rating} von 5 bewertet ({FACES[rating][1]}).\n\n"
                                f"Kommentar: {comment or '–'}\n\nBitte zeitnah anrufen und klären – zufriedene Kunden "
                                "bleiben, unzufriedene erzählen es weiter.")})
            self.db.update("csat_surveys", survey["id"], {"followup_ticket_id": fid})
            from .team import log_activity

            log_activity(self.db, None, "kundenfeedback", "ticket", fid, f"{rating}/5 zu Ticket #{t['id']}")
        elif comment and survey["followup_ticket_id"]:
            self.db.query("UPDATE tickets SET description = description || ? WHERE id = ?",
                          (f"\n\nNachtrag Kommentar: {comment[:2000]}", survey["followup_ticket_id"]))
        return self.db.get("csat_surveys", survey["id"])


class RateIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str = Field("", max_length=2000)


class CsatConfIn(BaseModel):
    enabled: Optional[bool] = None
    low_threshold: Optional[int] = Field(None, ge=1, le=4)
    subject: Optional[str] = Field(None, max_length=200)
    text: Optional[str] = Field(None, max_length=3000)


def register(app: FastAPI, ctx: Any, admin_only, static_dir) -> Csat:
    from .mitarbeiter_api import RateLimiter

    db: Database = ctx.db
    csat = Csat(ctx)
    limiter = RateLimiter(limit=30, window_s=600)

    def by_token(token: str) -> dict[str, Any]:
        s = db.query_one("SELECT * FROM csat_surveys WHERE token = ?", (token,)) if 16 <= len(token) <= 64 else None
        if not s:
            raise HTTPException(404, "Umfrage nicht gefunden oder abgelaufen")
        return s

    @app.get("/bewertung", include_in_schema=False)
    def page() -> FileResponse:
        return FileResponse(static_dir / "bewertung.html")

    @app.get("/api/public/csat/{token}")
    def public_get(token: str) -> dict:
        s = by_token(token)
        t = db.get("tickets", s["ticket_id"]) or {}
        return {"ticket": t.get("id"), "title": t.get("title", ""), "rating": s["rating"], "comment": s["comment"],
                "company": ctx.company}

    @app.post("/api/public/csat/{token}")
    def public_rate(token: str, data: RateIn, request: Request) -> dict:
        if not limiter.allow(f"csat:{request.client.host if request.client else '?'}"):
            raise HTTPException(429, "Zu viele Anfragen")
        try:
            s = csat.rate(by_token(token), data.rating, data.comment, "mail")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return {"ok": True, "rating": s["rating"]}

    @app.get("/api/csat")
    def overview(days: int = 90) -> dict:
        rows = db.query("SELECT s.*, t.title, c.name AS customer_name FROM csat_surveys s LEFT JOIN tickets t ON t.id = s.ticket_id "
                        "LEFT JOIN customers c ON c.id = s.customer_id WHERE s.rating IS NOT NULL ORDER BY s.rated_at DESC LIMIT 100")
        return {**stats(db, days=max(1, min(days, 730))), "conf": csat_conf(db),
                "mail_ready": bool(getattr(ctx.settings, "public_url", "")), "latest": rows}

    @app.put("/api/csat/settings", dependencies=[Depends(admin_only)])
    def save(data: CsatConfIn) -> dict:
        conf = {**csat_conf(db), **data.model_dump(exclude_none=True)}
        db.set_setting("csat", conf)
        return conf

    return csat
