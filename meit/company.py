"""Unternehmen: am eigenen Betrieb arbeiten – nicht nur im Betrieb.

Vier Bausteine, die zusammengehören:

- **SWOT:** Stärken und Schwächen (innen), Chancen und Risiken (außen). Das Cockpit schlägt Einträge aus den eigenen
  Zahlen vor (Klumpenrisiko, verrechenbare Quote, überfällige Rechnungen …) – übernehmen oder verwerfen per Klick.
- **Ziele:** messbar, mit Termin. Der Stand kommt nach Möglichkeit direkt aus dem Cockpit (wiederkehrender Umsatz,
  Vertragskunden, Zufriedenheit …), sonst wird er von Hand nachgetragen.
- **Maßnahmen:** wer macht was bis wann – verknüpft mit einem Ziel oder einem SWOT-Eintrag. Eigene Maßnahmen
  erscheinen in „Mein Tag“.
- **Rückblick:** einmal im Quartal festhalten, was gut lief, was nicht und was sich ändert – mit einem Schnappschuss
  der Kennzahlen, damit die Entwicklung sichtbar bleibt.

Die Zahlen sind Näherungen aus dem, was im Cockpit erfasst ist; sie ersetzen keine Buchhaltung.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso
from .growth import health_overview, nrr, recurring_share
from .radar import Radar

QUADRANTS = {"staerke": "Stärken", "schwaeche": "Schwächen", "chance": "Chancen", "risiko": "Risiken"}
ACTION_STATES = ("offen", "laeuft", "erledigt", "verworfen")
GOAL_STATES = ("aktiv", "erreicht", "verworfen")
SNAPSHOT = ("mrr", "contract_customers", "recurring_share", "revenue_12m", "billable_share", "csat", "open_receivables", "top_customer_share")


def quarter_of(day: date) -> str:
    return f"{day.year}-Q{(day.month - 1) // 3 + 1}"


def euro(value: float) -> str:
    return f"{value:,.0f} €".replace(",", ".")


def de(value: float | None, unit: str = "") -> str:
    """Zahl in deutscher Schreibweise: 1.234,5 – ohne überflüssige Nachkommastelle."""
    if value is None:
        return "–"
    if unit == "€":
        return euro(value)
    text = f"{value:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")
    text = text[:-2] if text.endswith(",0") else text
    return f"{text}{' ' if unit in ('%', 'h') else ''}{unit}"


# ------------------------------------------------------------------ Kennzahlen
def metrics(db: Database, today: date | None = None) -> dict[str, dict[str, Any]]:
    """Die Zahlen, an denen sich der Betrieb messen lässt – jede mit Einheit und Richtung (höher oder niedriger ist besser)."""
    today = today or date.today()
    year_ago, quarter_ago = (today - timedelta(days=365)).isoformat(), (today - timedelta(days=90)).isoformat()
    out: dict[str, dict[str, Any]] = {}

    def add(key: str, label: str, value: float | None, unit: str, better: str = "hoch", hint: str = "", **extra: Any) -> None:
        out[key] = {"key": key, "label": label, "value": None if value is None else round(value, 1), "unit": unit, "better": better,
                    "hint": hint, **extra}

    mrr = db.scalar("SELECT COALESCE(SUM(mrr), 0) FROM customers") or 0
    customers = db.scalar("SELECT COUNT(*) FROM customers") or 0
    contract = db.scalar("SELECT COUNT(*) FROM customers WHERE mrr > 0") or 0
    add("mrr", "Wiederkehrender Umsatz je Monat", mrr, "€", hint="Summe aller Betreuungspauschalen")
    add("contract_customers", "Kunden mit Betreuungsvertrag", contract, "", hint=f"von {customers} Kunden", total=customers)

    share = recurring_share(db, today)
    add("recurring_share", "Anteil wiederkehrender Umsatz", share["share"], "%", hint="Schätzung: Pauschalen gegen Projekte und Stunden")
    retention = nrr(db, today)
    add("nrr", "Umsatz-Bindung (NRR)", retention["nrr"], "%", hint=retention.get("note") or "Bestandskunden heute gegen vor 12 Monaten")

    revenue = db.scalar("SELECT COALESCE(SUM(net), 0) FROM invoices WHERE status IN ('gestellt', 'bezahlt') AND date >= ?", (year_ago,)) or 0
    add("revenue_12m", "Gestellter Umsatz, 12 Monate", revenue, "€", hint="netto, aus den Rechnungen im Cockpit")

    booked = db.query("SELECT COALESCE(SUM(minutes), 0) AS total, COALESCE(SUM(CASE WHEN billable = 1 THEN minutes ELSE 0 END), 0) AS billable "
                      "FROM time_entries WHERE date >= ?", (quarter_ago,))[0]
    add("billable_share", "Verrechenbare Quote", 100 * booked["billable"] / booked["total"] if booked["total"] else None, "%",
        hint="verrechenbare Stunden an allen gebuchten, letzte 90 Tage", hours=round(booked["total"] / 60, 1))

    unbilled = db.query("SELECT COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(minutes / 60.0 * rate), 0) AS value FROM time_entries "
                        "WHERE billable = 1 AND invoice_id IS NULL")[0]
    add("unbilled_hours", "Noch nicht verrechnete Stunden", unbilled["minutes"] / 60, "h", better="niedrig",
        hint=f"rund {euro(unbilled['value'])}", amount=round(unbilled["value"], 2))

    receivable = db.query("SELECT COALESCE(SUM(gross), 0) AS open, COALESCE(SUM(CASE WHEN due_date != '' AND due_date < ? THEN gross ELSE 0 END), 0) "
                          "AS overdue FROM invoices WHERE status = 'gestellt'", (today.isoformat(),))[0]
    add("open_receivables", "Offene Rechnungen", receivable["open"], "€", better="niedrig",
        hint=f"davon {euro(receivable['overdue'])} überfällig", overdue=round(receivable["overdue"], 2))

    rating = db.query("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM csat_surveys WHERE rating IS NOT NULL AND rated_at >= ?", (year_ago,))[0]
    add("csat", "Kundenzufriedenheit", rating["avg"], "/5", hint=f"{rating['n']} Bewertungen in 12 Monaten", count=rating["n"])

    top = db.query("SELECT name, mrr FROM customers WHERE mrr > 0 ORDER BY mrr DESC LIMIT 1")
    add("top_customer_share", "Anteil des größten Kunden", 100 * top[0]["mrr"] / mrr if top and mrr else None, "%", better="niedrig",
        hint=f"{top[0]['name']} am wiederkehrenden Umsatz" if top else "noch kein Vertragskunde", customer=top[0]["name"] if top else "")

    health = health_overview(db, today)
    add("customers_at_risk", "Kunden im Risiko", health["counts"]["risiko"], "", better="niedrig",
        hint=f"{euro(health['mrr_at_risk'])} monatlicher Umsatz gefährdet", amount=health["mrr_at_risk"])
    return out


# ------------------------------------------------------------------ Vorschläge für die SWOT
THOUGHTS = [  # Denkanstöße für die Außensicht – die kann keine Zahl im Cockpit liefern
    ("idee_nachweise", "chance", "Kunden brauchen Sicherheitsnachweise (Versicherung, Auftraggeber, NIS2 über die Lieferkette) – ein Sicherheits-Paket mit Bericht lässt sich als Pauschale anbieten."),
    ("idee_erneuerung", "chance", "Geräte und Server am Support-Ende müssen ersetzt werden – planbare Projekte statt Notfälle, wenn man früh darauf anspricht."),
    ("idee_ki", "chance", "Betriebe fragen nach KI im Alltag (Copilot, lokale KI) – Beratung und Einführung sind neue Leistungen mit wenig Wettbewerb vor Ort."),
    ("idee_hersteller", "risiko", "Hersteller ändern Preise und Lizenzmodelle (Microsoft, Virtualisierung, Sicherheitssoftware) – Margen und Kundenbudgets geraten unter Druck."),
    ("idee_personal", "risiko", "Gute Techniker sind schwer zu finden – Wachstum und Vertretung hängen an wenigen Köpfen."),
    ("idee_haftung", "risiko", "Ein Sicherheitsvorfall bei einem Kunden fällt auf den Betreuer zurück – ohne dokumentierte Empfehlungen und eigene Absicherung wird es teuer."),
]


def suggestions(db: Database, m: dict[str, dict[str, Any]], today: date | None = None) -> list[dict[str, Any]]:
    """Was die eigenen Zahlen über Stärken, Schwächen, Chancen und Risiken sagen – als Vorschlag, nicht als Urteil."""
    today = today or date.today()
    out: list[dict[str, Any]] = []

    def add(key: str, quadrant: str, text: str, route: str = "") -> None:
        out.append({"key": key, "quadrant": quadrant, "text": text, "route": route, "kind": "zahl"})

    def val(key: str) -> float | None:
        return m[key]["value"]

    contract, customers = int(val("contract_customers") or 0), int(m["contract_customers"]["total"])
    if val("top_customer_share") is not None and val("top_customer_share") >= 30 and contract >= 2:
        add("klumpen", "risiko", f"Klumpenrisiko: {m['top_customer_share']['customer']} bringt {val('top_customer_share'):.0f} % des wiederkehrenden Umsatzes.", "rentabilitaet")
    if val("recurring_share") is not None:
        if val("recurring_share") >= 60:
            add("wiederkehrend_hoch", "staerke", f"{val('recurring_share'):.0f} % des Umsatzes sind wiederkehrend – planbare Einnahmen statt Monat für Monat bei null zu beginnen.", "wachstum")
        elif val("recurring_share") < 40:
            add("wiederkehrend_niedrig", "schwaeche", f"Nur {val('recurring_share'):.0f} % des Umsatzes sind wiederkehrend – das meiste muss jeden Monat neu verdient werden.", "wachstum")
    if val("csat") is not None and m["csat"]["count"] >= 5:
        if val("csat") >= 4.5:
            add("csat_hoch", "staerke", f"Kunden sind sehr zufrieden: {val('csat'):.1f} von 5 aus {m['csat']['count']} Bewertungen – gute Grundlage für Empfehlungen.", "dashboard")
        elif val("csat") < 3.8:
            add("csat_niedrig", "schwaeche", f"Kundenzufriedenheit nur {val('csat'):.1f} von 5 aus {m['csat']['count']} Bewertungen.", "dashboard")
    if val("billable_share") is not None and m["billable_share"]["hours"] >= 20:
        if val("billable_share") < 55:
            add("quote_niedrig", "schwaeche", f"Nur {val('billable_share'):.0f} % der gebuchten Stunden sind verrechenbar (letzte 90 Tage).", "auswertungen")
        elif val("billable_share") >= 75:
            add("quote_hoch", "staerke", f"{val('billable_share'):.0f} % der gebuchten Stunden sind verrechenbar – wenig Leerlauf.", "auswertungen")
    if customers and customers - contract >= 1:
        add("ohne_vertrag", "chance", f"{customers - contract} von {customers} Kunden haben keinen Betreuungsvertrag – Potenzial für Pauschalen.", "kunden")
    radar = Radar(db).scan(today=today)
    if radar["count"]:
        add("radar", "chance", f"{radar['count']} konkrete Verkaufschancen im Umsatz-Radar (rund {euro(radar['total_annual'])} im Jahr), z. B. Geräte am Support-Ende.", "radar")
    if m["open_receivables"]["overdue"] > 0:
        add("ueberfaellig", "schwaeche", f"{euro(m['open_receivables']['overdue'])} sind überfällig – Geld, das schon verdient ist.", "abrechnung")
    if (val("unbilled_hours") or 0) >= 10:
        add("unverrechnet", "schwaeche", f"{val('unbilled_hours'):.0f} verrechenbare Stunden ({euro(m['unbilled_hours']['amount'])}) sind noch nicht in Rechnung gestellt.", "abrechnung")
    if (db.scalar("SELECT COUNT(*) FROM users WHERE active = 1") or 0) <= 1:
        add("eine_person", "risiko", "Der Betrieb hängt an einer Person – Urlaub, Krankheit oder ein Großauftrag treffen sofort alle Kunden.")
    if (val("customers_at_risk") or 0) >= 1:
        add("kunden_risiko", "risiko", f"{val('customers_at_risk'):.0f} Kunden mit schlechtem Health Score – {euro(m['customers_at_risk']['amount'])} monatlicher Umsatz gefährdet.", "wachstum")
    if val("nrr") is not None:
        if val("nrr") > 105:
            add("nrr_hoch", "staerke", f"Bestandskunden wachsen: {val('nrr'):.0f} % Umsatz-Bindung über 12 Monate.", "wachstum")
        elif val("nrr") < 95:
            add("nrr_niedrig", "schwaeche", f"Bestandskunden schrumpfen: nur {val('nrr'):.0f} % Umsatz-Bindung über 12 Monate.", "wachstum")
    if customers and not db.scalar("SELECT COUNT(*) FROM leads WHERE created_at >= ?", ((today - timedelta(days=60)).isoformat(),)):
        add("keine_leads", "schwaeche", "Seit 60 Tagen kein neuer Interessent erfasst – Wachstum hängt an Zufall und Empfehlung.", "leads")
    ending = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(mrr), 0) AS mrr FROM customers WHERE mrr > 0 AND contract_end != '' AND contract_end BETWEEN ? AND ?",
                      (today.isoformat(), (today + timedelta(days=90)).isoformat()))[0]
    if ending["n"]:
        add("vertraege_laufen_aus", "risiko", f"{ending['n']} Verträge laufen in den nächsten 90 Tagen aus ({euro(ending['mrr'])} im Monat).", "kunden")
    out += [{"key": key, "quadrant": quadrant, "text": text, "route": "", "kind": "denkanstoss"} for key, quadrant, text in THOUGHTS]
    return out


# ------------------------------------------------------------------ Ziele
def goal_view(goal: dict[str, Any], m: dict[str, dict[str, Any]], users: dict[int, str], today: date) -> dict[str, Any]:
    live = m.get(goal["metric"])
    current = live["value"] if live and live["value"] is not None else goal["current_value"]
    start, target = goal["start_value"] or 0, goal["target_value"] or 0
    if target == start:
        progress = 100.0
    else:
        progress = max(0.0, min(100.0, 100 * ((current or 0) - start) / (target - start)))
    begin, due = date.fromisoformat(goal["created_at"][:10]), goal.get("due_date") or ""
    elapsed = None
    if due:
        span = (date.fromisoformat(due) - begin).days
        elapsed = 100.0 if span <= 0 else max(0.0, min(100.0, 100 * (today - begin).days / span))
    if goal["status"] != "aktiv":
        state = goal["status"]
    elif progress >= 100:
        state = "erreicht"
    elif due and due < today.isoformat():
        state = "überfällig"
    elif elapsed is not None and elapsed - progress > 20:
        state = "hinter Plan"
    else:
        state = "im Plan"
    return {**goal, "live": bool(live and live["value"] is not None), "current": current, "progress": round(progress), "elapsed": None if elapsed is None else round(elapsed),
            "state": state, "unit": live["unit"] if live else goal.get("unit") or "", "metric_label": live["label"] if live else "eigene Zahl",
            "owner_name": users.get(goal.get("owner_id") or 0, "")}


# ------------------------------------------------------------------ Text für Weitergabe
def plan_text(company: str, data: dict[str, Any]) -> str:
    lines = [f"# {company} – Unternehmensplan (Stand {data['today']})", "", "## Kennzahlen"]
    lines += [f"- {m['label']}: {de(m['value'], m['unit'])}" + (f" ({m['hint']})" if m["hint"] else "") for m in data["metrics"]]
    lines += ["", "## SWOT"]
    for key, label in QUADRANTS.items():
        lines.append(f"**{label}**")
        lines += [f"- {i['text']}" for i in data["swot"][key]] or ["- (noch nichts eingetragen)"]
        lines.append("")
    lines.append("## Ziele")
    lines += [f"- {g['title']}: {de(g['current'], g['unit'])} von {de(g['target_value'], g['unit'])} ({g['progress']} %, {g['state']})"
              + (f", bis {g['due_date']}" if g["due_date"] else "") for g in data["goals"] if g["status"] == "aktiv"] or ["- (noch keine Ziele)"]
    lines += ["", "## Maßnahmen"]
    lines += [f"- [{'x' if a['status'] == 'erledigt' else ' '}] {a['title']}" + (f" – {a['owner_name']}" if a["owner_name"] else "")
              + (f", bis {a['due_date']}" if a["due_date"] else "") for a in data["actions"] if a["status"] != "verworfen"] or ["- (noch keine Maßnahmen)"]
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ Eingaben
class SwotIn(BaseModel):
    quadrant: str
    text: str = Field(min_length=3, max_length=500)
    note: str = Field(default="", max_length=2000)


class GoalIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    metric: str = "manuell"
    unit: str = Field(default="", max_length=20)
    start_value: Optional[float] = None
    target_value: float
    current_value: Optional[float] = None
    due_date: str = ""
    owner_id: Optional[int] = None
    status: str = "aktiv"
    notes: str = Field(default="", max_length=2000)


class ActionIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=2000)
    owner_id: Optional[int] = None
    due_date: str = ""
    status: str = "offen"
    goal_id: Optional[int] = None
    swot_id: Optional[int] = None


class ReviewIn(BaseModel):
    good: str = Field(default="", max_length=4000)
    bad: str = Field(default="", max_length=4000)
    change: str = Field(default="", max_length=4000)


def _day(value: str) -> str:
    if not value:
        return ""
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError as exc:
        raise HTTPException(422, "Datum bitte als JJJJ-MM-TT angeben") from exc


def register(app: FastAPI, ctx: Any, admin_only) -> None:
    db: Database = ctx.db

    def user_names() -> dict[int, str]:
        return {u["id"]: u["name"] for u in db.query("SELECT id, name FROM users")}

    def action_rows(where: str = "", params: tuple = ()) -> list[dict[str, Any]]:
        users, today = user_names(), date.today().isoformat()
        goals = {g["id"]: g["title"] for g in db.query("SELECT id, title FROM company_goals")}
        swot = {s["id"]: s for s in db.query("SELECT id, text, quadrant FROM swot_items")}
        rows = db.query(f"SELECT * FROM company_actions {where} ORDER BY CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 1 WHEN 'erledigt' THEN 2 "
                        "ELSE 3 END, CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id", params)
        return [{**a, "owner_name": users.get(a.get("owner_id") or 0, ""), "goal_title": goals.get(a.get("goal_id") or 0, ""),
                 "swot_text": (swot.get(a.get("swot_id") or 0) or {}).get("text", ""), "swot_quadrant": (swot.get(a.get("swot_id") or 0) or {}).get("quadrant", ""),
                 "overdue": bool(a["due_date"]) and a["due_date"] < today and a["status"] in ("offen", "laeuft")} for a in rows]

    def overview() -> dict[str, Any]:
        today = date.today()
        m = metrics(db, today)
        items = db.query("SELECT * FROM swot_items ORDER BY id")
        linked = {r["swot_id"]: r["n"] for r in db.query("SELECT swot_id, COUNT(*) AS n FROM company_actions WHERE swot_id IS NOT NULL "
                                                         "AND status IN ('offen', 'laeuft') GROUP BY swot_id")}
        used = {i["source"] for i in items if i["source"]} | set(db.get_setting("company_swot_dismissed", []) or [])
        users = user_names()
        reviews = []
        rows = db.query("SELECT * FROM company_reviews ORDER BY id")
        for index, r in enumerate(rows):
            numbers, before = loads(r["numbers"], {}), loads(rows[index - 1]["numbers"], {}) if index else {}
            reviews.append({**r, "numbers": [{"key": k, "label": m[k]["label"], "unit": m[k]["unit"], "better": m[k]["better"], "value": numbers.get(k),
                                              "before": before.get(k)} for k in SNAPSHOT if k in m],
                            "author": users.get(r.get("created_by") or 0, "")})
        quarter = quarter_of(today)
        return {
            "today": today.isoformat(), "quarter": quarter, "review_due": not any(r["period"] == quarter for r in rows),
            "metrics": list(m.values()),
            "swot": {q: [{**i, "open_actions": linked.get(i["id"], 0)} for i in items if i["quadrant"] == q] for q in QUADRANTS},
            "suggestions": [s for s in suggestions(db, m, today) if s["key"] not in used],
            "goals": [goal_view(g, m, users, today) for g in db.query(
                "SELECT * FROM company_goals ORDER BY CASE status WHEN 'aktiv' THEN 0 ELSE 1 END, CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id")],
            "actions": action_rows(), "reviews": reviews[::-1],
            "demo": bool(db.scalar("SELECT COUNT(*) FROM customers WHERE email LIKE '%-demo.at'")),
        }

    @app.get("/api/company", dependencies=[Depends(admin_only)])
    def get_company() -> dict:
        return overview()

    @app.get("/api/company/plan", dependencies=[Depends(admin_only)])
    def get_plan() -> dict:
        return {"text": plan_text(ctx.company, overview())}

    # ---- SWOT
    def check_quadrant(q: str) -> str:
        if q not in QUADRANTS:
            raise HTTPException(422, "Feld muss staerke, schwaeche, chance oder risiko sein")
        return q

    @app.post("/api/company/swot", status_code=201, dependencies=[Depends(admin_only)])
    def add_swot(data: SwotIn) -> dict:
        return db.get("swot_items", db.insert("swot_items", {"quadrant": check_quadrant(data.quadrant), "text": data.text.strip(), "note": data.note}))

    @app.put("/api/company/swot/{sid}", dependencies=[Depends(admin_only)])
    def update_swot(sid: int, data: SwotIn) -> dict:
        if not db.get("swot_items", sid):
            raise HTTPException(404, "Eintrag nicht gefunden")
        db.update("swot_items", sid, {"quadrant": check_quadrant(data.quadrant), "text": data.text.strip(), "note": data.note})
        return db.get("swot_items", sid)

    @app.delete("/api/company/swot/{sid}", dependencies=[Depends(admin_only)])
    def delete_swot(sid: int) -> dict:
        db.query("UPDATE company_actions SET swot_id = NULL WHERE swot_id = ?", (sid,))
        db.delete("swot_items", sid)
        return {"ok": True}

    @app.post("/api/company/suggestions/{key}/accept", status_code=201, dependencies=[Depends(admin_only)])
    def accept(key: str) -> dict:
        hit = next((s for s in suggestions(db, metrics(db)) if s["key"] == key), None)
        if not hit:
            raise HTTPException(404, "Vorschlag gibt es nicht mehr – die Zahlen haben sich geändert")
        if db.scalar("SELECT COUNT(*) FROM swot_items WHERE source = ?", (key,)):
            raise HTTPException(409, "Schon übernommen")
        return db.get("swot_items", db.insert("swot_items", {"quadrant": hit["quadrant"], "text": hit["text"], "source": key}))

    @app.post("/api/company/suggestions/{key}/dismiss", dependencies=[Depends(admin_only)])
    def dismiss(key: str) -> dict:
        gone = set(db.get_setting("company_swot_dismissed", []) or [])
        db.set_setting("company_swot_dismissed", sorted(gone | {key[:60]}))
        return {"ok": True}

    @app.post("/api/company/suggestions/reset", dependencies=[Depends(admin_only)])
    def reset_dismissed() -> dict:
        db.set_setting("company_swot_dismissed", [])
        return {"ok": True}

    # ---- Ziele
    def goal_values(data: GoalIn, existing: dict[str, Any] | None = None) -> dict[str, Any]:
        if data.status not in GOAL_STATES:
            raise HTTPException(422, "Unbekannter Zustand")
        m = metrics(db)
        live = m.get(data.metric)
        if data.metric != "manuell" and not live:
            raise HTTPException(422, "Unbekannte Kennzahl")
        if data.owner_id and not db.get("users", data.owner_id):
            raise HTTPException(422, "Benutzer nicht gefunden")
        start = data.start_value
        if start is None:  # Ausgangswert: der Stand von heute (bei eigener Zahl der eingetragene Stand)
            start = existing["start_value"] if existing else (live["value"] if live and live["value"] is not None else data.current_value or 0)
        return {"title": data.title.strip(), "metric": data.metric, "unit": live["unit"] if live else data.unit, "start_value": start,
                "target_value": data.target_value, "current_value": data.current_value if data.current_value is not None else (existing or {}).get("current_value", start),
                "due_date": _day(data.due_date), "owner_id": data.owner_id, "status": data.status, "notes": data.notes}

    @app.post("/api/company/goals", status_code=201, dependencies=[Depends(admin_only)])
    def add_goal(data: GoalIn) -> dict:
        return db.get("company_goals", db.insert("company_goals", goal_values(data)))

    @app.put("/api/company/goals/{gid}", dependencies=[Depends(admin_only)])
    def update_goal(gid: int, data: GoalIn) -> dict:
        existing = db.get("company_goals", gid)
        if not existing:
            raise HTTPException(404, "Ziel nicht gefunden")
        db.update("company_goals", gid, goal_values(data, existing))
        return db.get("company_goals", gid)

    @app.delete("/api/company/goals/{gid}", dependencies=[Depends(admin_only)])
    def delete_goal(gid: int) -> dict:
        db.query("UPDATE company_actions SET goal_id = NULL WHERE goal_id = ?", (gid,))
        db.delete("company_goals", gid)
        return {"ok": True}

    # ---- Maßnahmen
    def action_values(data: ActionIn, existing: dict[str, Any] | None = None) -> dict[str, Any]:
        if data.status not in ACTION_STATES:
            raise HTTPException(422, "Unbekannter Zustand")
        if data.owner_id and not db.get("users", data.owner_id):
            raise HTTPException(422, "Benutzer nicht gefunden")
        if data.goal_id and not db.get("company_goals", data.goal_id):
            raise HTTPException(422, "Ziel nicht gefunden")
        if data.swot_id and not db.get("swot_items", data.swot_id):
            raise HTTPException(422, "SWOT-Eintrag nicht gefunden")
        done = (existing or {}).get("done_at") or ""
        if data.status == "erledigt" and not done:
            done = now_iso()
        elif data.status != "erledigt":
            done = ""
        return {"title": data.title.strip(), "description": data.description, "owner_id": data.owner_id, "due_date": _day(data.due_date),
                "status": data.status, "goal_id": data.goal_id, "swot_id": data.swot_id, "done_at": done}

    @app.post("/api/company/actions", status_code=201, dependencies=[Depends(admin_only)])
    def add_action(data: ActionIn) -> dict:
        return db.get("company_actions", db.insert("company_actions", action_values(data)))

    @app.put("/api/company/actions/{aid}", dependencies=[Depends(admin_only)])
    def update_action(aid: int, data: ActionIn) -> dict:
        existing = db.get("company_actions", aid)
        if not existing:
            raise HTTPException(404, "Maßnahme nicht gefunden")
        db.update("company_actions", aid, action_values(data, existing))
        return db.get("company_actions", aid)

    @app.delete("/api/company/actions/{aid}", dependencies=[Depends(admin_only)])
    def delete_action(aid: int) -> dict:
        db.delete("company_actions", aid)
        return {"ok": True}

    # Eigene Maßnahmen sieht und erledigt jeder Mitarbeiter in „Mein Tag“ – ohne Einblick in Zahlen und SWOT.
    @app.get("/api/my-company-actions")
    def my_actions(request: Request) -> list[dict]:
        u = getattr(request.state, "user", None)
        if not isinstance(u, dict):
            return []
        return [{k: a[k] for k in ("id", "title", "description", "due_date", "status", "overdue", "goal_title")}
                for a in action_rows("WHERE owner_id = ? AND status IN ('offen', 'laeuft')", (u["id"],))]

    @app.post("/api/company/actions/{aid}/done")
    def finish_action(aid: int, request: Request) -> dict:
        a = db.get("company_actions", aid)
        if not a:
            raise HTTPException(404, "Maßnahme nicht gefunden")
        u = getattr(request.state, "user", None)
        if isinstance(u, dict) and u.get("role") != "admin" and a.get("owner_id") != u["id"]:
            raise HTTPException(403, "Nur die eigene Maßnahme lässt sich abhaken")
        db.update("company_actions", aid, {"status": "erledigt", "done_at": now_iso()})
        return {"ok": True}

    # ---- Rückblick
    @app.post("/api/company/reviews", status_code=201, dependencies=[Depends(admin_only)])
    def add_review(data: ReviewIn, request: Request) -> dict:
        if not (data.good.strip() or data.bad.strip() or data.change.strip()):
            raise HTTPException(422, "Bitte mindestens ein Feld ausfüllen")
        m = metrics(db)
        u = getattr(request.state, "user", None)
        rid = db.insert("company_reviews", {"period": quarter_of(date.today()), "good": data.good.strip(), "bad": data.bad.strip(),
                                            "change": data.change.strip(), "numbers": json.dumps({k: m[k]["value"] for k in SNAPSHOT}),
                                            "created_by": u["id"] if isinstance(u, dict) else None})
        return db.get("company_reviews", rid)

    @app.delete("/api/company/reviews/{rid}", dependencies=[Depends(admin_only)])
    def delete_review(rid: int) -> dict:
        db.delete("company_reviews", rid)
        return {"ok": True}
