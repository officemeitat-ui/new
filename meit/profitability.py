"""Rentabilität je Kunde und Wertsicherung (Indexanpassung) der Pauschalen.

Rentabilität (letzte 12 Monate):
  Umsatz (gestellte Rechnungen, netto) − Arbeitszeit × interner Kostensatz − Lizenz-Einkauf
  = Deckungsbeitrag; effektiver Stundensatz = (Umsatz − Lizenz-Einkauf) / Stunden.
  Ungebuchte Fernwartung (Splashtop-Protokoll) zählt als Aufwand mit – sie kostet auch, wenn sie nicht
  verrechnet wird. Managed-Kunden mit zu niedrigem effektivem Stundensatz bekommen einen Preisvorschlag.

Wertsicherung: Österreichische Betreuungsverträge enthalten meist eine Klausel auf Basis des
Verbraucherpreisindex (VPI 2020, Statistik Austria). Überschreitet die Veränderung seit der letzten
Anpassung die vereinbarte Schwelle, ändert sich die Pauschale im vollen Ausmaß; die neue Basis ist
der erreichte Indexwert. Die Indexwerte trägst du monatlich ein (Statistik Austria veröffentlicht sie).
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .billing import company_profile, hourly_rate
from .db import Database, loads, now_iso

DEFAULT_PROFIT = {"cost_rate": 55.0, "target_rate": 0.0, "months": 12}
DEFAULT_INDEX = {
    "name": "VPI 2020", "threshold": 3.0, "values": {},
    "subject": "Wertsicherung Ihres IT-Betreuungsvertrags",
    "text": ("{anrede}\n\ngemäß der in unserem Betreuungsvertrag vereinbarten Wertsicherung ({index}) passen wir die "
             "monatliche Pauschale an die Entwicklung des Index an. Seit der letzten Anpassung (Basis {basis_monat}: "
             "{basis_wert}) hat sich der Index bis {aktuell_monat} auf {aktuell_wert} verändert ({prozent}). Die "
             "vereinbarte Schwelle von {schwelle} wurde damit erreicht.\n\nIhre Pauschale ändert sich ab {ab} von "
             "{alt} auf {neu} (netto). Alle anderen Vertragsbedingungen bleiben unverändert.\n\nWir investieren "
             "laufend in Sicherheit, Werkzeuge und Weiterbildung, damit Ihre IT zuverlässig läuft – danke für Ihr "
             "Vertrauen.\n\nFreundliche Grüße\n{firma}"),
}


def _months_back(today: date, months: int) -> date:
    m = today.month - 1 - months
    return date(today.year + m // 12, m % 12 + 1, 1)


def profitability(db: Database, months: int = 12, today: date | None = None) -> dict[str, Any]:
    from .subscriptions import monthly

    today = today or date.today()
    conf = {**DEFAULT_PROFIT, **(db.get_setting("profitability", {}) or {})}
    cost_rate = float(conf["cost_rate"])
    target = float(conf["target_rate"] or 0) or hourly_rate(db)
    since = _months_back(today, months).isoformat()
    revenue = {r["customer_id"]: r["net"] for r in db.query(
        "SELECT customer_id, SUM(net) AS net FROM invoices WHERE status IN ('gestellt', 'bezahlt') AND date >= ? "
        "GROUP BY customer_id", (since,))}
    minutes = {r["customer_id"]: r["m"] for r in db.query(
        "SELECT customer_id, SUM(minutes) AS m FROM time_entries WHERE date >= ? GROUP BY customer_id", (since,))}
    unbooked = {r["customer_id"]: r["m"] for r in db.query(
        "SELECT customer_id, SUM(minutes) AS m FROM remote_sessions WHERE status = 'offen' AND customer_id IS NOT NULL "
        "AND started_at >= ? GROUP BY customer_id", (since,))}
    tickets = {r["customer_id"]: r["n"] for r in db.query(
        "SELECT customer_id, COUNT(*) AS n FROM tickets WHERE created_at >= ? AND COALESCE(category, '') != 'Wartung' "
        "GROUP BY customer_id", (since,))}
    rows = []
    for c in db.query("SELECT * FROM customers ORDER BY name"):
        cid = c["id"]
        lic = sum(monthly(float(s["unit_cost"] or 0) * float(s["quantity"] or 0), s["billing_cycle"]) * months
                  for s in db.query("SELECT unit_cost, quantity, billing_cycle FROM subscriptions WHERE customer_id = ?", (cid,)))
        rev = float(revenue.get(cid) or 0)
        estimated = False
        if rev == 0 and (c["mrr"] or 0) > 0:
            rev, estimated = float(c["mrr"]) * months, True  # noch keine Rechnungen im Cockpit → Schätzung aus MRR
        hours = round((minutes.get(cid) or 0) / 60, 1)
        hidden = round((unbooked.get(cid) or 0) / 60, 1)
        effort = hours + hidden
        labor = effort * cost_rate
        margin = rev - labor - lic
        pct = round(100 * margin / rev, 1) if rev else None
        eff = round((rev - lic) / effort, 2) if effort else None
        managed = (c["package"] or "keins") != "keins"
        if not rev and not effort:
            continue
        rating = ("kritisch" if (pct is not None and pct < 15) or (eff is not None and eff < cost_rate * 1.2)
                  else "gut" if pct is not None and pct >= 40 else "ok")
        advice = ""
        if managed and eff is not None and eff < target and c["mrr"]:
            proposed = min(round(c["mrr"] * target / eff, -1), round(c["mrr"] * 1.3, -1))
            advice = (f"Effektiv {eff:.0f} €/h statt Ziel {target:.0f} €/h – Pauschale prüfen (z. B. € {proposed:,.0f})"
                      .replace(",", "."))
            if (tickets.get(cid) or 0) / months > max(2, (c["employees"] or 1) / 4):
                advice += f"; {tickets[cid]} Tickets in {months} Monaten → Ursachen beheben (Standardisierung, Schulung)"
        elif not managed and effort > 20 and rev / max(effort, 1) < target:
            advice = "Viel Aufwand ohne Vertrag – Managed-Paket anbieten (planbarer Umsatz)"
        if hidden >= 2:
            advice = (advice + "; " if advice else "") + f"{hidden:g} h Fernwartung ohne Zeitbuchung"
        rows.append({"customer_id": cid, "customer": c["name"], "package": c["package"], "mrr": c["mrr"] or 0,
                     "revenue": round(rev, 2), "estimated": estimated, "hours": hours, "hidden_hours": hidden,
                     "labor_cost": round(labor, 2), "license_cost": round(lic, 2), "margin": round(margin, 2),
                     "margin_pct": pct, "effective_rate": eff, "tickets": tickets.get(cid) or 0, "rating": rating,
                     "advice": advice})
    rows.sort(key=lambda r: (r["margin_pct"] if r["margin_pct"] is not None else -999))
    tot_rev = sum(r["revenue"] for r in rows)
    tot_margin = sum(r["margin"] for r in rows)
    tot_effort = sum(r["hours"] + r["hidden_hours"] for r in rows)
    return {"months": months, "since": since, "cost_rate": cost_rate, "target_rate": target, "rows": rows,
            "totals": {"revenue": round(tot_rev, 2), "margin": round(tot_margin, 2),
                       "margin_pct": round(100 * tot_margin / tot_rev, 1) if tot_rev else None,
                       "hours": round(tot_effort, 1),
                       "effective_rate": round(sum(r["revenue"] - r["license_cost"] for r in rows) / tot_effort, 2) if tot_effort else None,
                       "critical": sum(1 for r in rows if r["rating"] == "kritisch")}}


# ----------------------------------------------------------------------------- Wertsicherung
def index_conf(db: Database) -> dict[str, Any]:
    stored = db.get_setting("index", {}) or {}
    conf = {**DEFAULT_INDEX, **{k: v for k, v in stored.items() if k in DEFAULT_INDEX}}
    conf["values"] = dict(sorted((conf.get("values") or {}).items()))
    return conf


def _pct(v: float) -> str:
    return f"{v:+.1f} %".replace(".", ",")


def _eur(v: float) -> str:
    return "€ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def promote_scheduled(db: Database, today: date | None = None) -> int:
    """Geplante Pauschalen werden am Stichtag zur aktuellen Pauschale (inkl. MRR-Verlauf)."""
    from .growth import log_mrr

    today = (today or date.today()).isoformat()
    n = 0
    for c in db.query("SELECT * FROM customers WHERE mrr_next IS NOT NULL AND mrr_next_from != '' AND mrr_next_from <= ?",
                      (today,)):
        log_mrr(db, c["id"], c["name"], c["mrr"] or 0, c["mrr_next"], "indexanpassung")
        db.query("UPDATE customers SET mrr = ?, mrr_next = NULL, mrr_next_from = '' WHERE id = ?", (c["mrr_next"], c["id"]))
        n += 1
    return n


def index_proposals(db: Database) -> dict[str, Any]:
    conf = index_conf(db)
    values = conf["values"]
    latest = max(values) if values else None
    out = []
    for c in db.query("SELECT * FROM customers WHERE index_clause = 1 ORDER BY name"):
        base_month = c["index_base_month"] or ""
        base = float(c["index_base_value"] or 0) or float(values.get(base_month) or 0)
        row = {"customer_id": c["id"], "customer": c["name"], "mrr": c["mrr"] or 0, "base_month": base_month,
               "base_value": base or None, "current_month": latest, "current_value": values.get(latest) if latest else None,
               "scheduled": {"mrr": c["mrr_next"], "from": c["mrr_next_from"]} if c["mrr_next"] is not None else None}
        if not base or not latest:
            row["status"] = "Basiswert fehlt" if not base else "keine Indexwerte"
        elif latest <= base_month:
            row["status"] = "aktuell"
        else:
            change = values[latest] / base - 1
            row.update({"change_pct": round(change * 100, 2), "new_mrr": round((c["mrr"] or 0) * (1 + change), 2)})
            row["status"] = "anpassen" if abs(change * 100) >= float(conf["threshold"]) - 1e-9 and c["mrr"] else "unter Schwelle"
        out.append(row)
    return {"conf": conf, "latest": latest, "rows": out}


def index_letter(db: Database, company: str, customer: dict[str, Any], row: dict[str, Any], effective: date,
                 conf: dict[str, Any]) -> tuple[str, str]:
    from .documents import fill_text

    profile = company_profile(db, company)
    contact = customer.get("contact_name") or ""
    month = lambda m: f"{m[5:7]}/{m[:4]}" if m else "–"  # noqa: E731
    values = {"anrede": f"Guten Tag {contact}," if contact else "Guten Tag,", "index": conf["name"],
              "basis_monat": month(row["base_month"]), "basis_wert": f"{row['base_value']:.1f}".replace(".", ","),
              "aktuell_monat": month(row["current_month"]), "aktuell_wert": f"{row['current_value']:.1f}".replace(".", ","),
              "prozent": _pct(row["change_pct"]), "schwelle": f"{float(conf['threshold']):g} %".replace(".", ","),
              "ab": effective.strftime("%d.%m.%Y"), "alt": _eur(row["mrr"]), "neu": _eur(row["new_mrr"]),
              "firma": profile.get("name") or company, "kunde": customer["name"]}
    return fill_text(conf["subject"], values), fill_text(conf["text"], values)


# ----------------------------------------------------------------------------- API
class ProfitConf(BaseModel):
    cost_rate: Optional[float] = Field(None, ge=0, le=500)
    target_rate: Optional[float] = Field(None, ge=0, le=1000)


class IndexConf(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    threshold: Optional[float] = Field(None, ge=0, le=50)
    values: Optional[dict[str, Optional[float]]] = None  # wird ergänzt; Wert null = Monat löschen
    subject: Optional[str] = Field(None, max_length=200)
    text: Optional[str] = Field(None, max_length=5000)


class IndexApply(BaseModel):
    customer_ids: list[int] = Field(..., min_length=1, max_length=500)
    effective: str
    send_mail: bool = False


def register(app: FastAPI, ctx: Any, admin_only) -> None:
    db: Database = ctx.db
    promote_scheduled(db)

    @app.get("/api/profitability")
    def get_profit(months: int = 12) -> dict:
        return profitability(db, max(1, min(months, 36)))

    @app.put("/api/profitability/settings", dependencies=[Depends(admin_only)])
    def save_profit(data: ProfitConf) -> dict:
        conf = {**DEFAULT_PROFIT, **(db.get_setting("profitability", {}) or {}), **data.model_dump(exclude_none=True)}
        db.set_setting("profitability", conf)
        return profitability(db)

    @app.get("/api/indexation")
    def get_index() -> dict:
        promote_scheduled(db)
        return index_proposals(db)

    @app.put("/api/indexation/settings", dependencies=[Depends(admin_only)])
    def save_index(data: IndexConf) -> dict:
        conf = index_conf(db)
        upd = data.model_dump(exclude_none=True)
        if "values" in upd:
            bad = [k for k in upd["values"] if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", k)]
            if bad:
                raise HTTPException(422, f"Monat im Format JJJJ-MM: {', '.join(bad[:3])}")
            if any(v is not None and v <= 0 for v in upd["values"].values()):
                raise HTTPException(422, "Indexwerte müssen positiv sein")
            merged = dict(conf["values"])
            for k, v in upd.pop("values").items():
                if v is None:
                    merged.pop(k, None)
                else:
                    merged[k] = float(v)
            conf["values"] = dict(sorted(merged.items()))
        conf.update(upd)
        db.set_setting("index", conf)
        return index_proposals(db)

    @app.post("/api/indexation/apply", dependencies=[Depends(admin_only)])
    def apply(data: IndexApply, request: Request) -> dict:
        try:
            effective = date.fromisoformat(data.effective)
        except ValueError:
            raise HTTPException(422, "Stichtag im Format JJJJ-MM-TT")
        if effective.day != 1:
            raise HTTPException(422, "Stichtag muss ein Monatserster sein (Abrechnung je Monat)")
        prop = index_proposals(db)
        conf = prop["conf"]
        rows = {r["customer_id"]: r for r in prop["rows"] if r["status"] == "anpassen"}
        done, errors = [], []
        user = getattr(request.state, "user", None)
        from .team import log_activity

        for cid in data.customer_ids:
            row = rows.get(cid)
            if not row:
                errors.append({"customer_id": cid, "error": "keine Anpassung fällig"})
                continue
            c = db.get("customers", cid)
            subject, text = index_letter(db, ctx.company, c, row, effective, conf)
            db.query("UPDATE customers SET mrr_next = ?, mrr_next_from = ?, index_base_month = ?, index_base_value = ? "
                     "WHERE id = ?", (row["new_mrr"], effective.isoformat(), row["current_month"], row["current_value"], cid))
            address = "  \n".join(x.strip() for x in re.split(r"[\n,]", c["address"] or "") if x.strip())
            letter = f"# {subject}\n\n**{c['name']}**  \n{address}\n\n{text}"
            doc = ctx.docs.archive_text(f"Wertsicherung {effective.year} – {c['name']}", letter, kind="bericht",
                                        customer_id=cid)
            sent = False
            if data.send_mail:
                try:
                    from .mail import Attachment

                    pdf = ctx.docs.local_file(doc).read_bytes()
                    ctx.docs.send_branded(ctx.mailer, c["email"] or "", ctx.docs.conf().get("cc", ""), subject, text,
                                          [Attachment(doc["filename"], pdf, "application/pdf")])
                    ctx.docs.log_out(c["email"], subject, text, cid, "customer", cid, "", 1)
                    sent = True
                except Exception as exc:  # noqa: BLE001 - Anpassung bleibt gültig, Versand später manuell
                    errors.append({"customer_id": cid, "error": f"Mail nicht gesendet: {exc}"})
            log_activity(db, user["id"] if user else None, "indexanpassung", "customer", cid,
                         f"{_eur(row['mrr'])} → {_eur(row['new_mrr'])} ab {effective.strftime('%d.%m.%Y')}")
            done.append({"customer_id": cid, "customer": c["name"], "new_mrr": row["new_mrr"], "document": doc["id"],
                         "sent": sent})
        promote_scheduled(db)
        return {"applied": done, "errors": errors}
