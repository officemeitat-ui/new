"""Wachstums-Kennzahlen: Health Score, NRR, Anteil wiederkehrender Umsatz, Vertriebs-Kaskade.

Grundidee: Der größte ungehobene Umsatz liegt im Bestand (Customer Success), und der
Firmenwert wächst mit dem Anteil wiederkehrender Umsätze und einer NRR über 100 %.
Alle Werte werden nachvollziehbar im Code berechnet – jede Zahl hat eine Begründung.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from .db import Database, loads, now_iso
from .radar import eol_info

STAGE_ORDER = ["neu", "erstgespraech", "pitch", "angebot", "gewonnen"]
STAGE_LABELS = {"neu": "Neu", "erstgespraech": "Erstgespräch", "pitch": "Pitch", "angebot": "Angebotsbesprechung",
                "gewonnen": "Gewonnen", "verloren": "Verloren"}
# Annahmen, solange es zu wenige eigene Daten gibt (werden durch echte Quoten ersetzt).
DEFAULT_CONVERSION = {"erstgespraech": 0.6, "pitch": 0.8, "angebot": 0.75, "gewonnen": 0.5}


def _parse(d: str | None) -> date | None:
    if not d:
        return None
    try:
        return datetime.fromisoformat(d[:19].replace(" ", "T")).date()
    except ValueError:
        return None


# --------------------------------------------------------------------- MRR-Verlauf
def log_mrr(db: Database, customer_id: int, customer_name: str, old: float, new: float, reason: str) -> None:
    old, new = round(float(old or 0), 2), round(float(new or 0), 2)
    if old == new:
        return
    db.insert("mrr_history", {"customer_id": customer_id, "customer_name": customer_name, "old_mrr": old,
                              "new_mrr": new, "reason": reason})


def ensure_mrr_baseline(db: Database) -> None:
    """Bestehende Datenbanken: aktuellen MRR einmalig als Ausgangswert festhalten."""
    if db.scalar("SELECT COUNT(*) FROM mrr_history"):
        return
    for c in db.query("SELECT id, name, mrr FROM customers WHERE mrr > 0"):
        log_mrr(db, c["id"], c["name"], 0, c["mrr"], "bestand")


def mrr_at(db: Database, customer_id: int, when: str) -> float | None:
    row = db.query_one("SELECT new_mrr FROM mrr_history WHERE customer_id = ? AND created_at <= ? "
                       "ORDER BY created_at DESC, id DESC LIMIT 1", (customer_id, when))
    return row["new_mrr"] if row else None


def nrr(db: Database, today: date | None = None, months: int = 12) -> dict[str, Any]:
    """Net Revenue Retention: Wie hat sich der MRR der Kunden von vor 12 Monaten entwickelt?

    > 100 %: Upsells übersteigen Kündigungen – der Bestand wächst auch ohne Neukunden.
    """
    today = today or date.today()
    start = (today - timedelta(days=round(months * 30.44))).isoformat() + " 23:59:59"
    customer_ids = [r["customer_id"] for r in db.query("SELECT DISTINCT customer_id FROM mrr_history")]
    start_total = current_total = expansion = contraction = churn = 0.0
    cohort = 0
    for cid in customer_ids:
        before = mrr_at(db, cid, start)
        if not before:
            continue
        now = mrr_at(db, cid, now_iso()) or 0.0
        cohort += 1
        start_total += before
        current_total += now
        if now == 0:
            churn += before
        elif now > before:
            expansion += now - before
        else:
            contraction += before - now
    if not cohort:
        return {"nrr": None, "cohort": 0, "note": f"Noch kein MRR-Verlauf älter als {months} Monate – wird ab jetzt aufgezeichnet."}
    return {"nrr": round(100 * current_total / start_total, 1), "cohort": cohort, "start_mrr": round(start_total, 2),
            "current_mrr": round(current_total, 2), "expansion": round(expansion, 2),
            "contraction": round(contraction, 2), "churn": round(churn, 2), "note": ""}


def recurring_share(db: Database, today: date | None = None) -> dict[str, Any]:
    """Anteil wiederkehrender Umsätze (Schätzung aus Cockpit-Daten: MRR×12 vs. angenommene Einmal-Angebote)."""
    today = today or date.today()
    since = (today - timedelta(days=365)).isoformat()
    annual_recurring = (db.scalar("SELECT COALESCE(SUM(mrr), 0) FROM customers") or 0) * 12
    projects = db.scalar("SELECT COALESCE(SUM(total_once), 0) FROM quotes WHERE status = 'angenommen' AND created_at >= ?",
                         (since,)) or 0
    # Kunden ohne Vertrag zahlen nach Aufwand: Ticket-Zeit × Stundensatz zählt als Einmalumsatz.
    hourly = db.scalar("SELECT price FROM services WHERE code = 'STD'") or 110
    minutes = db.scalar("SELECT COALESCE(SUM(t.time_spent_min), 0) FROM tickets t JOIN customers c ON c.id = t.customer_id "
                        "WHERE c.package = 'keins' AND t.created_at >= ?", (since,)) or 0
    break_fix = minutes / 60 * hourly
    one_time = projects + break_fix
    total = annual_recurring + one_time
    return {"annual_recurring": round(annual_recurring, 2), "one_time_12m": round(one_time, 2),
            "projects_12m": round(projects, 2), "hourly_12m": round(break_fix, 2),
            "share": round(100 * annual_recurring / total, 1) if total else None}


# --------------------------------------------------------------------- Health Score
def health_score(db: Database, customer: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """0–100. Zeigt Churn-Risiko und den richtigen Moment für das nächste Gespräch."""
    today = today or date.today()
    cid = customer["id"]
    factors: list[dict[str, Any]] = []

    def factor(text: str, delta: int) -> None:
        factors.append({"text": text, "delta": delta})

    critical = db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND status != 'geloest' "
                         "AND priority = 'kritisch'", (cid,)) or 0
    high = db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND status != 'geloest' "
                     "AND priority = 'hoch'", (cid,)) or 0
    if critical or high:
        factor(f"{critical + high} dringende(s) offene(s) Ticket(s)", -min(30, 15 * critical + 10 * high))
    since90 = (today - timedelta(days=90)).isoformat()
    tickets90 = db.scalar("SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND created_at >= ?", (cid, since90)) or 0
    employees = max(int(customer.get("employees") or 0), 1)
    if tickets90 > max(3, employees):
        factor(f"Viele Tickets ({tickets90} in 90 Tagen) – Ursachen beheben", -10)
    sec = db.query_one("SELECT score FROM assessments WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", (cid,))
    if sec is None:
        factor("Noch kein Security-Check", -5)
    elif sec["score"] < 50:
        factor(f"Security-Score kritisch ({sec['score']:.0f}/100)", -20)
    elif sec["score"] < 80:
        factor(f"Security-Score ausbaufähig ({sec['score']:.0f}/100)", -10)
    else:
        factor(f"Security-Score gut ({sec['score']:.0f}/100)", +5)
    eol_assets = [a for a in db.query("SELECT os, type FROM assets WHERE customer_id = ?", (cid,))
                  if (info := eol_info(a["os"] or "")) and info[0] <= today]
    if eol_assets:
        servers = sum(1 for a in eol_assets if a["type"] == "server")
        factor(f"{len(eol_assets)} Gerät(e) ohne Herstellersupport",
               -min(25, 10 * servers + 5 * (len(eol_assets) - servers)))
    if (customer.get("package") or "keins") == "keins":
        factor("Kein Betreuungsvertrag (nur auf Zuruf)", -10)
    booked = loads(customer.get("booked_services"), [])
    if len(booked) >= 3:
        factor(f"{len(booked)} Leistungen gebucht – enge Bindung", +5)
    last_qbr = _parse(customer.get("last_qbr_at"))
    if (customer.get("package") or "keins") != "keins":
        if not last_qbr:
            factor("Noch nie ein Quartalsgespräch (QBR)", -10)
        elif last_qbr < today - timedelta(days=120):
            factor(f"Letztes QBR am {last_qbr.strftime('%d.%m.%Y')} – überfällig", -10)
        else:
            factor("QBR aktuell", +5)
    contract_end = _parse(customer.get("contract_end"))
    if contract_end and today <= contract_end <= today + timedelta(days=60):
        factor(f"Vertrag endet am {contract_end.strftime('%d.%m.%Y')}", -15)

    score = max(0, min(100, 100 + sum(f["delta"] for f in factors)))
    status = "gesund" if score >= 75 else ("beobachten" if score >= 50 else "risiko")
    return {"score": score, "status": status, "factors": factors}


def health_overview(db: Database, today: date | None = None) -> dict[str, Any]:
    rows = []
    for c in db.query("SELECT * FROM customers"):
        h = health_score(db, c, today)
        rows.append({"customer_id": c["id"], "customer": c["name"], "mrr": c["mrr"], **h})
    rows.sort(key=lambda r: r["score"])
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("gesund", "beobachten", "risiko")}
    mrr_at_risk = round(sum(r["mrr"] or 0 for r in rows if r["status"] == "risiko"), 2)
    return {"customers": rows, "counts": counts, "mrr_at_risk": mrr_at_risk}


# ------------------------------------------------------------- Vertriebs-Kaskade
def pipeline(db: Database, target_closings_per_week: float = 1.0) -> dict[str, Any]:
    """Pipeline nach Phasen + rückwärts geplante Wochen-Aktivitäten.

    'Erreicht' = Leads, die mindestens diese Phase erreicht haben (verlorene zählen bei 'neu').
    """
    leads = db.query("SELECT stage FROM leads")
    current = {s: sum(1 for l in leads if l["stage"] == s) for s in STAGE_ORDER + ["verloren"]}
    reached = {}
    for i, stage in enumerate(STAGE_ORDER):
        reached[stage] = sum(1 for l in leads if l["stage"] in STAGE_ORDER[i:]) + (current["verloren"] if i == 0 else 0)
    conversion = {}
    own_data = reached["neu"] >= 10
    for prev, stage in zip(STAGE_ORDER, STAGE_ORDER[1:]):
        if own_data and reached[prev]:
            conversion[stage] = round(reached[stage] / reached[prev], 2) or DEFAULT_CONVERSION[stage]
        else:
            conversion[stage] = DEFAULT_CONVERSION[stage]
    # Rückwärts planen: Wie viele Gespräche pro Woche braucht es für X Abschlüsse?
    needed = {"gewonnen": target_closings_per_week}
    for prev, stage in reversed(list(zip(STAGE_ORDER, STAGE_ORDER[1:]))):
        needed[prev] = needed[stage] / conversion[stage] if conversion[stage] else 0
    return {
        "stages": [{"stage": s, "label": STAGE_LABELS[s], "current": current[s], "reached": reached[s],
                    "conversion_in": conversion.get(s), "needed_per_week": round(needed[s], 1)} for s in STAGE_ORDER],
        "lost": current["verloren"],
        "own_data": own_data,
        "target_closings_per_week": target_closings_per_week,
    }
