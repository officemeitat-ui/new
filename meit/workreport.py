"""Arbeitsbericht mit Unterschrift des Kunden – der Leistungsnachweis direkt nach dem Einsatz.

Ablauf: Techniker füllt den Bericht am Handy aus (Zeiten, Tätigkeiten, Material) → der Kunde unterschreibt
mit dem Finger am Bildschirm → das Cockpit erzeugt ein PDF im Firmendesign, legt es im Kundenordner ab,
bucht die Zeit und schließt den Termin ab. Auf Wunsch geht das PDF sofort per E-Mail an den Kunden.

- Nach der Unterschrift ist der Bericht unveränderlich (Prüfsumme des PDFs wird gespeichert).
- Ist niemand da, wird der Bericht „ohne Unterschrift“ mit Begründung abgeschlossen.
- Die Unterschrift wird als Bild geprüft und neu kodiert, bevor sie gespeichert wird.
"""

from __future__ import annotations

import base64
import io
import json
import re
from datetime import date, datetime
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

DAY = r"^\d{4}-\d{2}-\d{2}$"
CLOCK = r"^\d{2}:\d{2}$"
STATUS = {"entwurf": "Entwurf", "unterschrieben": "unterschrieben", "ohne_unterschrift": "ohne Unterschrift"}
KINDS = {"vor_ort": "Vor Ort", "remote": "Fernwartung", "telefon": "Telefon", "intern": "Intern"}
MAX_SIGNATURE = 600_000  # Bytes (Bild vom Bildschirm)


class ReportError(ValueError):
    pass


def clean_signature(data_url: str) -> str:
    """Unterschrift prüfen und als sauberes PNG neu kodieren. Rückgabe: Base64. Leere Bilder werden abgelehnt."""
    from PIL import Image

    m = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=\s]+)", data_url or "")
    if not m:
        raise ReportError("Unterschrift fehlt.")
    try:
        raw = base64.b64decode(m.group(1))
    except Exception as exc:  # noqa: BLE001
        raise ReportError("Unterschrift ist beschädigt.") from exc
    if len(raw) > MAX_SIGNATURE or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ReportError("Unterschrift ist kein gültiges Bild.")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format != "PNG" or not (40 <= img.width <= 3000 and 20 <= img.height <= 2000):
            raise ReportError("Unterschrift hat ein ungültiges Format.")
        img = img.convert("RGBA")
        flat = Image.new("RGBA", img.size, "white")
        flat.alpha_composite(img)
        gray = flat.convert("L")
    except ReportError:
        raise
    except Exception as exc:  # noqa: BLE001 - alles, was das Bild nicht lesbar macht
        raise ReportError("Unterschrift ist kein gültiges Bild.") from exc
    dark = sum(gray.histogram()[:140])
    if dark < 60:  # praktisch leere Fläche
        raise ReportError("Bitte im Feld unterschreiben.")
    gray.thumbnail((900, 360))
    out = io.BytesIO()
    gray.save(out, format="PNG", optimize=True)
    return base64.b64encode(out.getvalue()).decode()


def minutes_between(start: str, end: str) -> int:
    (h1, m1), (h2, m2) = (map(int, start.split(":")), map(int, end.split(":")))
    diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    return diff if diff > 0 else diff + 24 * 60  # über Mitternacht


def hours_text(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d} Std."


def report_pdf(r: dict[str, Any], customer: dict[str, Any], profile: dict[str, Any], branding: dict[str, Any], logo: Any) -> bytes:
    from .pdf import BrandPDF, _recipient, clean

    pdf = BrandPDF(branding, profile, logo, f"Arbeitsbericht {r['number']}")
    pdf.alias_nb_pages()
    pdf.add_page()
    _recipient(pdf, customer)
    pdf.heading(f"Arbeitsbericht {r['number']}")
    day = datetime.fromisoformat(r["date"]).strftime("%d.%m.%Y")
    facts = [("Datum", day), ("Zeit", f"{r['start_time']}–{r['end_time']} Uhr" if r["start_time"] and r["end_time"] else ""),
             ("Dauer", hours_text(r["minutes"])), ("Techniker", r["technician"]), ("Art", KINDS.get(r["kind"], r["kind"])),
             ("Ort", r["location"]), ("Ticket", f"#{r['ticket_id']}" + (f" – {r.get('ticket_title')}" if r.get("ticket_title") else "") if r["ticket_id"] else ""),
             ("Anfahrt", f"{r['travel_km']:g} km".replace(".", ",") if r["travel_km"] else "")]
    for label, value in facts:
        if not value:
            continue
        pdf.set_font("Roboto", "B", 10)
        pdf.cell(32, 6, clean(label))
        pdf.set_font("Roboto", "", 10)
        pdf.multi_cell(0, 6, clean(str(value)), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.heading("Durchgeführte Arbeiten", size=12, accent=False)
    pdf.set_font("Roboto", "", 10)
    pdf.multi_cell(0, 5, clean(r["work"] or "–"), new_x="LMARGIN", new_y="NEXT")
    materials = loads(r["materials"], [])
    if materials:
        pdf.ln(4)
        pdf.heading("Material", size=12, accent=False)
        pdf.set_font("Roboto", "B", 9)
        pdf.set_fill_color(*pdf.color("brand"))
        pdf.set_text_color(255, 255, 255)
        pdf.cell(130, 6, "Bezeichnung", fill=True)
        pdf.cell(40, 6, "Menge", fill=True, align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(*pdf.color("dark"))
        pdf.set_font("Roboto", "", 10)
        for m in materials:
            qty = f"{m.get('qty', 1):g}".replace(".", ",") + (f" {m['unit']}" if m.get("unit") else "")
            y = pdf.get_y()
            pdf.multi_cell(130, 6, clean(str(m.get("name", ""))), new_x="RIGHT", new_y="TOP")
            bottom = pdf.get_y()
            pdf.set_xy(pdf.l_margin + 130, y)
            pdf.cell(40, 6, clean(qty), align="R", new_x="LMARGIN", new_y="NEXT")
            pdf.set_y(max(bottom, pdf.get_y()) if bottom > y + 6 else pdf.get_y())
            pdf.set_draw_color(*pdf.color("anthracite"))
            pdf.set_line_width(0.1)
            pdf.line(pdf.l_margin, pdf.get_y(), 190, pdf.get_y())
    if r["remark"]:
        pdf.ln(4)
        pdf.heading("Anmerkungen", size=12, accent=False)
        pdf.set_font("Roboto", "", 10)
        pdf.multi_cell(0, 5, clean(r["remark"]), new_x="LMARGIN", new_y="NEXT")
    # Unterschrift – nie über einen Seitenumbruch hinweg
    if pdf.get_y() > 205:
        pdf.add_page()
    pdf.ln(8)
    top = pdf.get_y()
    pdf.set_font("Roboto", "", 9)
    pdf.set_text_color(*pdf.color("anthracite"))
    if r["status"] == "unterschrieben" and r["signature"]:
        pdf.multi_cell(0, 4.5, clean("Mit der Unterschrift bestätigt der Auftraggeber, dass die angeführten Arbeiten durchgeführt wurden."),
                       new_x="LMARGIN", new_y="NEXT")
        top = pdf.get_y() + 2
        try:
            pdf.image(io.BytesIO(base64.b64decode(r["signature"])), x=pdf.l_margin, y=top, w=62, h=25, keep_aspect_ratio=True)
        except Exception:  # noqa: BLE001 - ein defektes Bild darf den Bericht nicht verhindern
            pass
        pdf.set_draw_color(*pdf.color("dark"))
        pdf.set_line_width(0.3)
        pdf.line(pdf.l_margin, top + 27, pdf.l_margin + 75, top + 27)
        pdf.line(115, top + 27, 190, top + 27)
        pdf.set_xy(pdf.l_margin, top + 28)
        signed = datetime.fromisoformat(r["signed_at"]).strftime("%d.%m.%Y, %H:%M Uhr") if r["signed_at"] else day
        pdf.cell(95, 4.5, clean(f"{r['signer_name']} · {signed}"))
        pdf.cell(75, 4.5, clean(f"{r['technician']} · {profile.get('name', '')}"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_x(pdf.l_margin)
        pdf.cell(95, 4.5, "Auftraggeber")
        pdf.cell(75, 4.5, "Auftragnehmer")
    elif r["status"] == "entwurf":
        pdf.set_font("Roboto", "B", 10)
        pdf.multi_cell(0, 5, "ENTWURF – noch nicht abgeschlossen und nicht unterschrieben.", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.multi_cell(0, 4.5, clean(f"Ohne Unterschrift des Auftraggebers abgeschlossen. Grund: {r['no_signature_reason'] or 'nicht angegeben'}"),
                       new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 4.5, clean(f"{r['technician']} · {profile.get('name', '')}"))
    return bytes(pdf.output())


class MaterialIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    qty: float = Field(1, gt=0, le=100000)
    unit: str = Field("", max_length=20)


class ReportIn(BaseModel):
    customer_id: Optional[int] = None
    appointment_id: Optional[int] = None
    ticket_id: Optional[int] = None
    date: Optional[str] = Field(None, pattern=DAY)
    start_time: str = Field("", pattern=r"^(\d{2}:\d{2})?$")
    end_time: str = Field("", pattern=r"^(\d{2}:\d{2})?$")
    minutes: Optional[int] = Field(None, ge=1, le=24 * 60)
    kind: Optional[str] = Field(None, pattern="^(vor_ort|remote|telefon|intern)$")
    location: str = Field("", max_length=300)
    travel_km: float = Field(0, ge=0, le=5000)
    work: str = Field("", max_length=6000)
    materials: list[MaterialIn] = Field(default_factory=list, max_length=40)
    remark: str = Field("", max_length=2000)


class SignIn(BaseModel):
    signer_name: str = Field("", max_length=120)
    signature: str = Field("", max_length=900_000)
    no_signature_reason: str = Field("", max_length=300)
    book_time: bool = True
    billable: Optional[bool] = None
    send_to: str = Field("", max_length=200)


class SendIn(BaseModel):
    to: str = Field("", max_length=200)


class WorkReports:
    SELECT = ("SELECT r.*, c.name AS customer, t.title AS ticket_title FROM work_reports r "
              "LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN tickets t ON t.id = r.ticket_id ")

    def __init__(self, db: Database, docs: Any):
        self.db, self.docs = db, docs

    def get(self, rid: int) -> dict[str, Any] | None:
        return self.db.query_one(self.SELECT + "WHERE r.id = ?", (rid,))

    def view(self, r: dict[str, Any]) -> dict[str, Any]:
        out = {k: r[k] for k in ("id", "number", "customer_id", "appointment_id", "ticket_id", "user_id", "technician", "date", "start_time",
                                 "end_time", "minutes", "kind", "location", "travel_km", "work", "remark", "status", "signer_name", "signed_at",
                                 "no_signature_reason", "document_id", "time_entry_id", "sent_to", "sent_at", "created_at")}
        out.update({"customer": r.get("customer") or "", "ticket_title": r.get("ticket_title") or "", "materials": loads(r["materials"], []),
                    "status_label": STATUS.get(r["status"], r["status"]), "duration": hours_text(r["minutes"]), "signed": bool(r["signature"])})
        return out

    def next_number(self, day: str) -> str:
        year = day[:4]
        last = self.db.scalar("SELECT number FROM work_reports WHERE number LIKE ? ORDER BY number DESC LIMIT 1", (f"AB-{year}-%",))
        return f"AB-{year}-{(int(last.rsplit('-', 1)[1]) + 1 if last else 1):04d}"

    def fields(self, data: ReportIn, user: dict[str, Any] | None) -> dict[str, Any]:
        d = data.model_dump()
        appt = self.db.get("appointments", d["appointment_id"]) if d["appointment_id"] else None
        if d["appointment_id"] and not appt:
            raise LookupError("Termin nicht gefunden")
        ticket = self.db.get("tickets", d["ticket_id"] or (appt or {}).get("ticket_id") or 0)
        if d["ticket_id"] and not ticket:
            raise LookupError("Ticket nicht gefunden")
        d["ticket_id"] = ticket["id"] if ticket else None
        d["customer_id"] = d["customer_id"] or (appt or {}).get("customer_id") or (ticket or {}).get("customer_id")
        customer = self.db.get("customers", d["customer_id"] or 0)
        if not customer:
            raise ReportError("Ein Arbeitsbericht braucht einen Kunden.")
        if appt:  # fehlende Angaben aus dem Termin übernehmen
            d["date"] = d["date"] or appt["start_at"][:10]
            d["start_time"] = d["start_time"] or appt["start_at"][11:16]
            d["end_time"] = d["end_time"] or appt["end_at"][11:16]
            d["location"] = d["location"] or appt["location"]
        d["kind"] = d["kind"] or (appt or {}).get("kind") or "vor_ort"
        d["date"] = d["date"] or date.today().isoformat()
        if not d["minutes"]:
            if not (d["start_time"] and d["end_time"]):
                raise ReportError("Bitte Dauer oder Beginn und Ende angeben.")
            d["minutes"] = minutes_between(d["start_time"], d["end_time"])
        if d["kind"] == "vor_ort" and not d["location"]:
            d["location"] = (customer["address"] or "").replace("\n", ", ")
        d["materials"] = json.dumps(d["materials"], ensure_ascii=False)
        tech_id = (appt or {}).get("user_id") or (user or {}).get("id")
        tech = self.db.get("users", tech_id) if tech_id else None
        d.update({"user_id": tech_id, "technician": (tech or {}).get("name") or (user or {}).get("name") or ""})
        return d

    def create(self, data: ReportIn, user: dict[str, Any] | None) -> dict[str, Any]:
        d = self.fields(data, user)
        rid = self.db.insert("work_reports", {**d, "number": self.next_number(d["date"]), "status": "entwurf"})
        return self.get(rid)

    def update(self, rid: int, data: ReportIn, user: dict[str, Any] | None) -> dict[str, Any]:
        r = self.db.get("work_reports", rid)
        if r["status"] != "entwurf":
            raise PermissionError("Ein abgeschlossener Arbeitsbericht kann nicht mehr geändert werden.")
        d = self.fields(data, user)
        d["appointment_id"] = d["appointment_id"] or r["appointment_id"]
        if r["technician"]:  # wer den Einsatz gemacht hat, ändert sich nicht dadurch, dass jemand anderer den Entwurf korrigiert
            d["user_id"], d["technician"] = r["user_id"], r["technician"]
        self.db.update("work_reports", rid, d)
        return self.get(rid)

    def pdf(self, r: dict[str, Any]) -> bytes:
        profile, branding, logo = self.docs._brand()
        customer = self.db.get("customers", r["customer_id"]) or {"name": r.get("customer") or ""}
        return report_pdf(r, customer, profile, branding, logo)

    def sign(self, rid: int, data: SignIn) -> dict[str, Any]:
        """Abschließen: Unterschrift speichern, PDF ablegen, Zeit buchen, Termin erledigen – alles genau einmal."""
        from .billing import add_time

        r = self.db.get("work_reports", rid)
        if r["status"] != "entwurf":
            raise PermissionError("Dieser Arbeitsbericht ist bereits abgeschlossen.")
        if not (r["work"] or "").strip():
            raise ReportError("Bitte die durchgeführten Arbeiten eintragen.")
        patch: dict[str, Any] = {"signed_at": now_iso()}
        if data.signature:
            if not data.signer_name.strip():
                raise ReportError("Bitte den Namen der unterschreibenden Person eintragen.")
            patch.update({"signature": clean_signature(data.signature), "signer_name": data.signer_name.strip(), "status": "unterschrieben"})
        else:
            if not data.no_signature_reason.strip():
                raise ReportError("Bitte unterschreiben lassen oder angeben, warum keine Unterschrift möglich ist.")
            patch.update({"no_signature_reason": data.no_signature_reason.strip(), "status": "ohne_unterschrift"})
        with self.db.connect() as conn:  # nur wer den Entwurf als Erster abschließt, kommt weiter
            cur = conn.execute(f"UPDATE work_reports SET {', '.join(f'{k} = ?' for k in patch)} WHERE id = ? AND status = 'entwurf'",
                               [*patch.values(), rid])
            if cur.rowcount != 1:
                raise PermissionError("Dieser Arbeitsbericht ist bereits abgeschlossen.")
        appt = self.db.get("appointments", r["appointment_id"]) if r["appointment_id"] else None
        entry = appt["time_entry_id"] if appt and appt["time_entry_id"] else None  # Termin hat die Zeit schon gebucht
        if data.book_time and not entry:
            entry = add_time(self.db, customer_id=r["customer_id"], minutes=r["minutes"],
                             description=f"Arbeitsbericht {r['number']}: {(r['work'] or '').splitlines()[0][:300]}",
                             ticket_id=r["ticket_id"], user_id=r["user_id"], day=r["date"], billable=data.billable)
        if entry:
            self.db.update("work_reports", rid, {"time_entry_id": entry})
        if appt and appt["status"] != "abgesagt":
            self.db.update("appointments", appt["id"], {"status": "erledigt", "time_entry_id": entry or appt["time_entry_id"]})
        fresh = self.get(rid)
        doc = self.docs.store("bericht", f"{fresh['date']}_Arbeitsbericht_{fresh['number']}.pdf", self.pdf(fresh),
                              title=f"Arbeitsbericht {fresh['number']}", customer_id=fresh["customer_id"], ref_type="work_report", ref_id=rid,
                              day=date.fromisoformat(fresh["date"]), nummer=fresh["number"], folder_keys=("bericht",))
        self.db.update("work_reports", rid, {"document_id": doc["id"]})
        return self.get(rid)


def register(app: FastAPI, ctx: Any, settings: Any) -> WorkReports:
    db: Database = ctx.db
    svc = WorkReports(db, ctx.docs)
    app.state.work_reports = svc
    company = getattr(settings, "company_name", "ME-IT")

    def user_of(request: Request) -> dict[str, Any] | None:
        u = getattr(request.state, "user", None)
        return u if isinstance(u, dict) else None

    def need(rid: int) -> dict[str, Any]:
        r = svc.get(rid)
        if not r:
            raise HTTPException(404, "Arbeitsbericht nicht gefunden")
        return r

    def guard(fn):
        try:
            return fn()
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except PermissionError as exc:
            raise HTTPException(409, str(exc))
        except ReportError as exc:
            raise HTTPException(422, str(exc))

    def send(r: dict[str, Any], to: str) -> str:
        from .mail import Attachment

        customer = db.get("customers", r["customer_id"]) or {}
        to = (to or customer.get("email") or "").strip()
        hello = f"Guten Tag{' ' + customer['contact_name'] if customer.get('contact_name') else ''},"
        day = datetime.fromisoformat(r["date"]).strftime("%d.%m.%Y")
        text = (f"{hello}\n\nim Anhang erhalten Sie den Arbeitsbericht {r['number']} zu unserem Einsatz vom {day} "
                f"({hours_text(r['minutes'])}).\n\nBei Fragen sind wir gerne für Sie da.\n\nFreundliche Grüße\n{company}")
        doc = db.get("documents", r["document_id"]) if r["document_id"] else None
        data = svc.docs.local_file(doc).read_bytes() if doc else svc.pdf(r)
        svc.docs.send_branded(getattr(ctx, "mailer", None), to, "", f"Arbeitsbericht {r['number']} vom {day}", text,
                              [Attachment(f"Arbeitsbericht_{r['number']}.pdf", data, "application/pdf")])
        db.update("work_reports", r["id"], {"sent_to": to, "sent_at": now_iso()})
        return to

    @app.get("/api/work-reports")
    def list_reports(customer_id: int = 0, limit: int = 50) -> list[dict]:
        sql, params = svc.SELECT, []
        if customer_id:
            sql, params = sql + "WHERE r.customer_id = ? ", [customer_id]
        return [svc.view(r) for r in db.query(sql + "ORDER BY r.id DESC LIMIT ?", [*params, max(1, min(limit, 500))])]

    @app.post("/api/work-reports", status_code=201)
    def create(data: ReportIn, request: Request) -> dict:
        return svc.view(guard(lambda: svc.create(data, user_of(request))))

    @app.get("/api/work-reports/{rid}")
    def one(rid: int) -> dict:
        return svc.view(need(rid))

    @app.put("/api/work-reports/{rid}")
    def update(rid: int, data: ReportIn, request: Request) -> dict:
        need(rid)
        return svc.view(guard(lambda: svc.update(rid, data, user_of(request))))

    @app.delete("/api/work-reports/{rid}")
    def delete(rid: int) -> dict:
        r = need(rid)
        if r["status"] != "entwurf":
            raise HTTPException(409, "Abgeschlossene Arbeitsberichte werden nicht gelöscht – sie sind der Leistungsnachweis.")
        db.delete("work_reports", rid)
        return {"ok": True}

    @app.post("/api/work-reports/{rid}/sign")
    def sign(rid: int, data: SignIn) -> dict:
        need(rid)
        r = guard(lambda: svc.sign(rid, data))
        mail = ""
        if data.send_to.strip():  # „kunde“ = an die beim Kunden hinterlegte Adresse
            try:
                mail = f"gesendet an {send(r, '' if data.send_to.strip() == 'kunde' else data.send_to)}"
            except Exception as exc:  # noqa: BLE001 - der Bericht ist abgeschlossen, auch wenn der Versand scheitert
                mail = f"nicht gesendet: {exc}"
        return {**svc.view(need(rid)), "mail": mail}

    @app.post("/api/work-reports/{rid}/send")
    def send_report(rid: int, data: SendIn) -> dict:
        from .mail import MailError

        r = need(rid)
        if r["status"] == "entwurf":
            raise HTTPException(409, "Erst abschließen, dann senden.")
        try:
            to = send(r, data.to)
        except MailError as exc:
            raise HTTPException(422, str(exc))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Versand fehlgeschlagen: {exc}")
        return {**svc.view(need(rid)), "sent_to": to}

    @app.get("/api/work-reports/{rid}/pdf")
    def pdf(rid: int, download: bool = False):
        from .documents import pdf_response

        r = need(rid)
        doc = db.get("documents", r["document_id"]) if r["document_id"] else None
        try:
            data = svc.docs.local_file(doc).read_bytes() if doc else svc.pdf(r)  # abgelegte Fassung ist die verbindliche
        except OSError:
            data = svc.pdf(r)
        return pdf_response(data, f"Arbeitsbericht_{r['number']}.pdf", download)

    return svc
