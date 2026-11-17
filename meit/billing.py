"""Zeiterfassung & Abrechnung: keine verschenkten Stunden mehr.

* Zeiten werden pro Ticket/Kunde gebucht. Bei Kunden ohne Vertrag ist Zeit standardmäßig verrechenbar,
  bei Managed-Kunden durch die Flatrate abgedeckt (pro Eintrag änderbar).
* Monatlicher Rechnungslauf: Betreuungspauschale (MRR) + verrechenbare Stunden + angenommene Projekte.
* Rechnungsnummern werden erst beim „Stellen“ vergeben → fortlaufend und lückenlos.
* Rechnung mit den Pflichtangaben nach § 11 UStG (Österreich) – als PDF siehe ``meit.documents``.
"""

from __future__ import annotations

import calendar
import csv
import html
import io
import math
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

COMPANY_DEFAULT = {
    "name": "ME-IT", "address": "", "uid": "", "email": "", "phone": "", "iban": "", "bic": "", "bank": "",
    "invoice_prefix": "", "payment_days": 14, "vat_rate": 20.0, "kleinunternehmer": False,
    "footer": "Vielen Dank für Ihr Vertrauen!", "round_minutes": 15,
}
MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
          "November", "Dezember"]


def company_profile(db: Database, company_name: str = "ME-IT") -> dict[str, Any]:
    return {**COMPANY_DEFAULT, "name": company_name, **(db.get_setting("company_profile", {}) or {})}


def hourly_rate(db: Database) -> float:
    return float(db.scalar("SELECT price FROM services WHERE code = 'STD'") or 110)


def default_billable(db: Database, customer_id: int | None) -> bool:
    if not customer_id:
        return True
    pkg = db.scalar("SELECT package FROM customers WHERE id = ?", (customer_id,))
    return (pkg or "keins") == "keins"


def add_time(db: Database, *, customer_id: int, minutes: int, description: str = "", ticket_id: int | None = None,
             user_id: int | None = None, day: str | None = None, billable: bool | None = None,
             rate: float | None = None, touch_ticket: bool = True) -> int:
    if minutes <= 0:
        raise ValueError("Minuten müssen größer als 0 sein")
    if billable is None:
        billable = default_billable(db, customer_id)
    tid = db.insert("time_entries", {
        "customer_id": customer_id, "ticket_id": ticket_id, "user_id": user_id, "date": day or date.today().isoformat(),
        "minutes": int(minutes), "description": description[:500], "billable": billable,
        "rate": rate if rate is not None else hourly_rate(db)})
    if ticket_id and touch_ticket:
        db.query("UPDATE tickets SET time_spent_min = COALESCE(time_spent_min, 0) + ? WHERE id = ?", (int(minutes), ticket_id))
    return tid


def billed_hours(minutes: int, round_minutes: int = 15) -> float:
    """Abrechnung im Takt (Standard: angefangene Viertelstunde)."""
    step = max(1, int(round_minutes or 1))
    return math.ceil(minutes / step) * step / 60


def period_bounds(period: str) -> tuple[date, date]:
    y, m = (int(x) for x in period.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def unbilled_overview(db: Database) -> dict[str, Any]:
    rows = db.query(
        "SELECT t.customer_id, c.name AS customer, SUM(t.minutes) AS minutes, SUM(t.minutes / 60.0 * t.rate) AS value, "
        "MIN(t.date) AS since FROM time_entries t LEFT JOIN customers c ON c.id = t.customer_id "
        "WHERE t.billable = 1 AND t.invoice_id IS NULL GROUP BY t.customer_id ORDER BY value DESC")
    projects = db.query("SELECT q.id, q.title, q.total_once, c.name AS customer FROM quotes q "
                        "LEFT JOIN customers c ON c.id = q.customer_id WHERE q.status = 'angenommen' AND q.total_once > 0 "
                        "AND q.invoice_id IS NULL")
    return {"hours": [{**r, "hours": round(r["minutes"] / 60, 2), "value": round(r["value"] or 0, 2)} for r in rows],
            "projects": projects,
            "total_value": round(sum(r["value"] or 0 for r in rows) + sum(p["total_once"] for p in projects), 2)}


def _totals(items: list[dict[str, Any]], profile: dict[str, Any]) -> dict[str, float]:
    net = round(sum(i["total"] for i in items), 2)
    rate = 0.0 if profile.get("kleinunternehmer") else float(profile.get("vat_rate") or 20)
    vat = round(net * rate / 100, 2)
    return {"net": net, "vat_rate": rate, "vat": vat, "gross": round(net + vat, 2)}


def billing_run(db: Database, period: str, profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Legt Rechnungsentwürfe für alle Kunden mit offenen Leistungen bis Monatsende an."""
    start, end = period_bounds(period)
    created = []
    for c in db.query("SELECT * FROM customers ORDER BY name"):
        items: list[dict[str, Any]] = []
        has_period_invoice = db.scalar(
            "SELECT COUNT(*) FROM invoices WHERE customer_id = ? AND period = ? AND status != 'storniert'", (c["id"], period))
        if (c["mrr"] or 0) > 0 and not has_period_invoice:
            booked = ", ".join(loads(c.get("booked_services"), [])) or "laut Vertrag"
            items.append({"kind": "recurring", "description": f"IT-Betreuung Paket „{c['package']}“ – "
                          f"{MONTHS[start.month - 1]} {start.year} ({booked})", "quantity": 1, "unit": "Monat",
                          "price": round(c["mrr"], 2), "total": round(c["mrr"], 2)})
        entries = db.query("SELECT * FROM time_entries WHERE customer_id = ? AND billable = 1 AND invoice_id IS NULL "
                           "AND date <= ? ORDER BY date, id", (c["id"], end.isoformat()))
        for e in entries:
            hours = billed_hours(e["minutes"], profile.get("round_minutes", 15))
            d = e["date"]
            items.append({"kind": "hours", "ref": e["id"], "description": f"{d[8:10]}.{d[5:7]}.: {e['description'] or 'Technikereinsatz'}",
                          "quantity": round(hours, 2), "unit": "Std.", "price": round(e["rate"], 2),
                          "total": round(hours * e["rate"], 2)})
        from .subscriptions import billable_items

        subs = billable_items(db, c["id"], period)
        items += subs
        quotes = db.query("SELECT * FROM quotes WHERE customer_id = ? AND status = 'angenommen' AND total_once > 0 "
                          "AND invoice_id IS NULL", (c["id"],))
        for q in quotes:
            items.append({"kind": "project", "ref": q["id"], "description": f"Projekt: {q['title']}", "quantity": 1,
                          "unit": "Pauschal", "price": round(q["total_once"], 2), "total": round(q["total_once"], 2)})
        if not items:
            continue
        inv_id = db.insert("invoices", {"customer_id": c["id"], "customer_name": c["name"], "period": period,
                                        "items": items, "status": "entwurf", **_totals(items, profile)})
        if entries:
            db.query(f"UPDATE time_entries SET invoice_id = ? WHERE id IN ({','.join('?' for _ in entries)})",
                     [inv_id, *[e["id"] for e in entries]])
        for q in quotes:
            db.update("quotes", q["id"], {"invoice_id": inv_id})
        for it in subs:
            db.query("INSERT INTO subscription_billing (subscription_id, period, invoice_id) VALUES (?, ?, ?)",
                     (it["ref"], period, inv_id))
        created.append({"id": inv_id, "customer": c["name"], "net": _totals(items, profile)["net"], "items": len(items)})
    return created


def next_number(db: Database, profile: dict[str, Any], year: int) -> str:
    prefix = f"{profile.get('invoice_prefix') or ''}{year}-"
    rows = db.query("SELECT number FROM invoices WHERE number LIKE ?", (f"{prefix}%",))
    seq = max((int(r["number"][len(prefix):]) for r in rows if r["number"][len(prefix):].isdigit()), default=0) + 1
    return f"{prefix}{seq:04d}"


def finalize(db: Database, invoice_id: int, profile: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    inv = db.get("invoices", invoice_id)
    if not inv:
        raise ValueError("Rechnung nicht gefunden")
    if inv["status"] != "entwurf":
        raise ValueError("Nur Entwürfe können gestellt werden")
    today = today or date.today()
    db.update("invoices", invoice_id, {
        "number": next_number(db, profile, today.year), "date": today.isoformat(),
        "due_date": (today + timedelta(days=int(profile.get("payment_days") or 14))).isoformat(), "status": "gestellt"})
    return db.get("invoices", invoice_id)


def release(db: Database, invoice_id: int) -> None:
    """Entwurf löschen oder Rechnung stornieren: Leistungen werden wieder abrechenbar."""
    db.query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?", (invoice_id,))
    db.query("UPDATE quotes SET invoice_id = NULL WHERE invoice_id = ?", (invoice_id,))
    db.query("DELETE FROM subscription_billing WHERE invoice_id = ?", (invoice_id,))


def _eur(v: float) -> str:
    return "€ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _d(iso: str) -> str:
    return f"{iso[8:10]}.{iso[5:7]}.{iso[0:4]}" if iso and len(iso) >= 10 else "–"


def invoice_html(db: Database, inv: dict[str, Any], profile: dict[str, Any]) -> str:
    from .branding import get_branding

    b = get_branding(db, profile.get("name", ""))
    e = html.escape
    c = db.get("customers", inv["customer_id"]) if inv["customer_id"] else None
    items = loads(inv["items"], [])
    start, end = period_bounds(inv["period"]) if inv["period"] else (None, None)
    draft = inv["status"] == "entwurf"
    rows = "".join(
        f"<tr><td>{i}</td><td>{e(it['description'])}</td><td class=n>{str(it['quantity']).replace('.', ',')} {e(it['unit'])}</td>"
        f"<td class=n>{_eur(it['price'])}</td><td class=n>{_eur(it['total'])}</td></tr>" for i, it in enumerate(items, 1))
    uid_customer = (c or {}).get("uid", "")
    tax_line = ("<tr><td colspan=4>Umsatzsteuerfrei – Kleinunternehmer gem. § 6 Abs. 1 Z 27 UStG</td><td></td></tr>"
                if profile.get("kleinunternehmer") else
                f"<tr><td colspan=4 class=n>zzgl. {str(inv['vat_rate']).rstrip('0').rstrip('.')} % USt</td><td class=n>{_eur(inv['vat'])}</td></tr>")
    return f"""<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Rechnung {e(inv['number'] or 'Entwurf')}</title>
<style>
@font-face{{font-family:"Roboto";src:url("/brand/fonts/Roboto-Regular.woff2") format("woff2");font-weight:400}}
@font-face{{font-family:"Roboto";src:url("/brand/fonts/Roboto-Bold.woff2") format("woff2");font-weight:700}}
body{{font:14px/1.45 "Roboto",system-ui,-apple-system,"Segoe UI",sans-serif;color:{b['dark']};margin:0;background:#f3f7f8}}
.page{{border-top:6px solid {b['brand']}}} .logo{{height:72px;width:auto}} .claim{{color:{b['anthracite']};font-size:11px;letter-spacing:.06em}}
h1 .nr{{color:{b['primary']}}} thead th{{border-bottom:2px solid {b['brand']}}} .sum td{{border-top:2px solid {b['brand']} !important}}
.accent{{display:block;width:48px;height:3px;background:{b['accent']};margin:6px 0 0}}
.page{{max-width:800px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 2px 12px rgba(0,0,0,.08)}}
.head{{display:flex;justify-content:space-between;gap:24px}} .from{{text-align:right;font-size:12px;color:#444;white-space:pre-line}}
h1{{font-size:22px;margin:32px 0 4px}} .meta{{color:#444;font-size:13px}} .to{{white-space:pre-line;margin-top:24px}}
table{{width:100%;border-collapse:collapse;margin-top:24px}} th,td{{padding:8px 6px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:top}}
th{{font-size:12px;text-transform:uppercase;color:#555}} .n{{text-align:right;white-space:nowrap}} tfoot td{{border:0}}
.sum td{{font-weight:700;font-size:16px;border-top:2px solid #111}} .foot{{margin-top:36px;font-size:12px;color:#444;white-space:pre-line}}
.draft{{color:#b45309;font-weight:700;letter-spacing:.1em}} .print{{position:fixed;right:16px;top:16px}}
@media print{{body{{background:#fff}} .page{{box-shadow:none;margin:0;padding:24px}} .print{{display:none}}}}
</style></head><body>
<button class="print" onclick="window.print()">Drucken / als PDF speichern</button>
<div class="page">
<div class="head"><div><img class="logo" src="/brand/logo" alt="{e(profile['name'])}"></div>
<div class="from">{e(profile['address'])}
{('UID: ' + e(profile['uid'])) if profile.get('uid') else ''}
{e(profile.get('email') or '')} {e(profile.get('phone') or '')}
{e(b.get('website') or '')}</div></div>
<div class="to"><strong>{e(c['name'] if c else inv['customer_name'])}</strong>
{e((c or {}).get('contact_name') or '')}
{e((c or {}).get('address') or '')}
{('UID: ' + e(uid_customer)) if uid_customer else ''}</div>
<h1>{'<span class="draft">ENTWURF</span>' if draft else 'Rechnung <span class="nr">' + e(inv['number']) + '</span>'}<span class="accent"></span></h1>
<div class="meta">Rechnungsdatum: {_d(inv['date']) if inv['date'] else '–'} · Leistungszeitraum: {(_d(start.isoformat()) + ' – ' + _d(end.isoformat())) if start else '–'}
{(' · Fällig: ' + _d(inv['due_date'])) if inv['due_date'] else ''}</div>
<table><thead><tr><th>Pos.</th><th>Leistung</th><th class=n>Menge</th><th class=n>Einzelpreis</th><th class=n>Gesamt</th></tr></thead>
<tbody>{rows}</tbody>
<tfoot><tr><td colspan=4 class=n>Summe netto</td><td class=n>{_eur(inv['net'])}</td></tr>{tax_line}
<tr class="sum"><td colspan=4 class=n>Gesamtbetrag</td><td class=n>{_eur(inv['gross'])}</td></tr></tfoot></table>
{('<p style="margin-top:16px">' + e(inv['note']) + '</p>') if inv['note'] else ''}
<div class="foot">Zahlbar ohne Abzug bis {_d(inv['due_date']) if inv['due_date'] else '–'} auf {e(profile.get('bank') or '')} IBAN {e(profile.get('iban') or '–')} {('BIC ' + e(profile['bic'])) if profile.get('bic') else ''}
Verwendungszweck: {e(inv['number'] or '')}
{e(profile.get('footer') or '')}</div>
</div></body></html>"""


def export_csv(db: Database, year: Optional[int] = None) -> str:
    sql = "SELECT * FROM invoices WHERE status IN ('gestellt', 'bezahlt', 'storniert')"
    params: list[Any] = []
    if year:
        sql += " AND substr(date, 1, 4) = ?"
        params.append(str(year))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(["Rechnungsnummer", "Rechnungsdatum", "Kunde", "Leistungszeitraum", "Netto", "USt-Satz", "USt", "Brutto",
                "Fällig", "Status", "Bezahlt am"])
    num = lambda v: f"{v:.2f}".replace(".", ",")  # noqa: E731
    for r in db.query(sql + " ORDER BY number", params):
        w.writerow([r["number"], _d(r["date"]), r["customer_name"], r["period"], num(r["net"]), num(r["vat_rate"]),
                    num(r["vat"] if r["status"] != "storniert" else 0), num(r["gross"] if r["status"] != "storniert" else 0),
                    _d(r["due_date"]), r["status"], _d(r["paid_at"]) if r["paid_at"] else ""])
    return "﻿" + buf.getvalue()


# ------------------------------------------------------------------------ API
class TimeIn(BaseModel):
    customer_id: Optional[int] = None
    ticket_id: Optional[int] = None
    minutes: int = Field(gt=0, le=24 * 60)
    description: str = Field("", max_length=500)
    date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    billable: Optional[bool] = None
    rate: Optional[float] = Field(None, ge=0)


class RunIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")


class InvoiceUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = Field(None, max_length=2000)
    order_ref: Optional[str] = Field(None, max_length=100)  # Auftragsreferenz/Bestellnummer (E-Rechnung an Bund)


def register(app: FastAPI, db: Database, company_name: str, admin_only, on_finalized=None) -> None:
    def profile() -> dict[str, Any]:
        return company_profile(db, company_name)

    def user_id(request: Request) -> int | None:
        user = getattr(request.state, "user", None)
        return user["id"] if user else None

    @app.get("/api/billing/profile")
    def get_profile() -> dict:
        return profile()

    @app.put("/api/billing/profile", dependencies=[Depends(admin_only)])
    def set_profile(data: dict[str, Any]) -> dict:
        clean = {k: v for k, v in data.items() if k in COMPANY_DEFAULT}
        if "payment_days" in clean:
            clean["payment_days"] = max(0, min(int(clean["payment_days"] or 14), 120))
        if "vat_rate" in clean:
            clean["vat_rate"] = float(clean["vat_rate"] or 20)
        if "round_minutes" in clean:
            clean["round_minutes"] = max(1, min(int(clean["round_minutes"] or 15), 60))
        db.set_setting("company_profile", {**(db.get_setting("company_profile", {}) or {}), **clean})
        return profile()

    @app.get("/api/time")
    def list_time(customer_id: Optional[int] = None, ticket_id: Optional[int] = None, unbilled: bool = False,
                  limit: int = 200) -> list[dict]:
        sql = ("SELECT t.*, c.name AS customer_name, u.name AS user_name FROM time_entries t "
               "LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.user_id WHERE 1=1")
        params: list[Any] = []
        if customer_id:
            sql += " AND t.customer_id = ?"
            params.append(customer_id)
        if ticket_id:
            sql += " AND t.ticket_id = ?"
            params.append(ticket_id)
        if unbilled:
            sql += " AND t.invoice_id IS NULL"
        return db.query(sql + " ORDER BY t.date DESC, t.id DESC LIMIT ?", [*params, min(limit, 2000)])

    @app.post("/api/time", status_code=201)
    def book_time(data: TimeIn, request: Request) -> dict:
        customer_id = data.customer_id
        if data.ticket_id:
            ticket = db.get("tickets", data.ticket_id)
            if not ticket:
                raise HTTPException(404, "Ticket nicht gefunden")
            customer_id = customer_id or ticket["customer_id"]
        if not customer_id or not db.get("customers", customer_id):
            raise HTTPException(422, "Kunde angeben (oder Ticket mit Kunde)")
        desc = data.description or (db.get("tickets", data.ticket_id)["title"] if data.ticket_id else "")
        tid = add_time(db, customer_id=customer_id, minutes=data.minutes, description=desc, ticket_id=data.ticket_id,
                       user_id=user_id(request), day=data.date, billable=data.billable, rate=data.rate)
        return db.get("time_entries", tid)

    @app.delete("/api/time/{eid}")
    def delete_time(eid: int) -> dict:
        e = db.get("time_entries", eid)
        if not e:
            raise HTTPException(404, "Eintrag nicht gefunden")
        if e["invoice_id"]:
            raise HTTPException(409, "Bereits abgerechnet")
        if e["ticket_id"]:
            db.query("UPDATE tickets SET time_spent_min = MAX(0, COALESCE(time_spent_min, 0) - ?) WHERE id = ?",
                     (e["minutes"], e["ticket_id"]))
        db.delete("time_entries", eid)
        return {"ok": True}

    @app.get("/api/billing/unbilled")
    def unbilled() -> dict:
        return unbilled_overview(db)

    @app.post("/api/billing/run", dependencies=[Depends(admin_only)])
    def run(data: RunIn) -> dict:
        created = billing_run(db, data.period, profile())
        return {"created": created, "count": len(created)}

    @app.get("/api/invoices")
    def list_invoices(status: Optional[str] = None) -> list[dict]:
        sql, params = "SELECT * FROM invoices", ()
        if status:
            sql, params = sql + " WHERE status = ?", (status,)
        rows = db.query(sql + " ORDER BY CASE status WHEN 'entwurf' THEN 0 ELSE 1 END, id DESC", params)
        today = date.today().isoformat()
        for r in rows:
            r["items"] = loads(r["items"], [])
            r["overdue"] = r["status"] == "gestellt" and r["due_date"] and r["due_date"] < today
        return rows

    @app.get("/api/invoices/export.csv")
    def invoices_csv(year: Optional[int] = None) -> Response:
        return Response(export_csv(db, year), media_type="text/csv; charset=utf-8", headers={
            "Content-Disposition": f'attachment; filename="rechnungen-{year or "alle"}.csv"'})

    @app.get("/api/invoices/{iid}/html", response_class=HTMLResponse)
    def invoice_page(iid: int) -> str:
        inv = db.get("invoices", iid)
        if not inv:
            raise HTTPException(404, "Rechnung nicht gefunden")
        return invoice_html(db, inv, profile())

    @app.get("/api/invoices/{iid}/ebinterface.xml")
    def invoice_ebinterface(iid: int) -> Response:
        from .einvoice import ebinterface_xml

        inv = db.get("invoices", iid)
        if not inv:
            raise HTTPException(404, "Rechnung nicht gefunden")
        try:
            body = ebinterface_xml(db, inv, profile())
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return Response(body, media_type="application/xml", headers={
            "Content-Disposition": f'attachment; filename="ebinterface-{inv["number"]}.xml"'})

    @app.put("/api/invoices/{iid}", dependencies=[Depends(admin_only)])
    def update_invoice(iid: int, data: InvoiceUpdate) -> dict:
        inv = db.get("invoices", iid)
        if not inv:
            raise HTTPException(404, "Rechnung nicht gefunden")
        if data.note is not None:
            db.update("invoices", iid, {"note": data.note})
        if data.order_ref is not None:
            db.update("invoices", iid, {"order_ref": data.order_ref.strip()})
        if data.status and data.status != inv["status"]:
            if data.status == "gestellt":
                try:
                    finalize(db, iid, profile())
                except ValueError as exc:
                    raise HTTPException(422, str(exc))
                if on_finalized:
                    on_finalized(iid)
            elif data.status == "bezahlt" and inv["status"] == "gestellt":
                db.update("invoices", iid, {"status": "bezahlt", "paid_at": now_iso(), "paid_amount": inv["gross"]})
            elif data.status == "storniert" and inv["status"] in ("gestellt", "bezahlt"):
                db.update("invoices", iid, {"status": "storniert"})
                release(db, iid)
            else:
                raise HTTPException(422, f"Statuswechsel {inv['status']} → {data.status} nicht möglich")
        row = db.get("invoices", iid)
        row["items"] = loads(row["items"], [])
        return row

    @app.delete("/api/invoices/{iid}", dependencies=[Depends(admin_only)])
    def delete_invoice(iid: int) -> dict:
        inv = db.get("invoices", iid)
        if not inv:
            raise HTTPException(404, "Rechnung nicht gefunden")
        if inv["status"] != "entwurf":
            raise HTTPException(409, "Gestellte Rechnungen werden storniert, nicht gelöscht (Aufbewahrungspflicht).")
        release(db, iid)
        db.delete("invoices", iid)
        return {"ok": True}

