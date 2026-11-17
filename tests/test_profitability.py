"""Rentabilität je Kunde und Wertsicherung (VPI-Indexanpassung) der Pauschalen."""

from __future__ import annotations

from datetime import date, timedelta

from meit.profitability import profitability, promote_scheduled


def _next_month_first(today: date | None = None) -> date:
    today = today or date.today()
    return date(today.year + (today.month // 12), today.month % 12 + 1, 1)


def test_profitability_numbers_and_advice(client, app):
    db = app.state.ctx.db
    client.put("/api/profitability/settings", json={"cost_rate": 60, "target_rate": 110})
    huber = db.get("customers", 1)  # Managed (basis), MRR 468
    db.query("DELETE FROM time_entries WHERE customer_id = 1")
    db.query("DELETE FROM subscriptions WHERE customer_id = 1")
    # 12 Monate: 76 h Aufwand (inkl. 4 h ungebuchter Fernwartung), Lizenzen 20 €/Monat Einkauf
    for i in range(72):
        db.insert("time_entries", {"customer_id": 1, "date": (date.today() - timedelta(days=5 * i)).isoformat(),
                                   "minutes": 60, "billable": False, "rate": 110})
    db.insert("subscriptions", {"customer_id": 1, "name": "M365 Business Premium", "quantity": 10, "unit_cost": 2,
                                "unit_price": 3, "billing_cycle": "monat"})
    db.insert("remote_sessions", {"started_at": f"{date.today().isoformat()} 09:00:00", "minutes": 240, "customer_id": 1,
                                  "status": "offen", "dedupe_key": "x1"})
    r = client.get("/api/profitability").json()
    row = next(x for x in r["rows"] if x["customer_id"] == 1)
    assert row["estimated"] is True and row["revenue"] == round(huber["mrr"] * 12, 2)  # noch keine Rechnungen
    assert row["hours"] == 72 and row["hidden_hours"] == 4 and row["license_cost"] == 240
    assert row["labor_cost"] == 76 * 60
    assert row["margin"] == round(row["revenue"] - 76 * 60 - 240, 2)
    assert row["effective_rate"] == round((row["revenue"] - 240) / 76, 2)
    assert "Pauschale prüfen" in row["advice"] and "Fernwartung ohne Zeitbuchung" in row["advice"]
    assert r["totals"]["critical"] >= 1 and r["target_rate"] == 110


def test_profitability_uses_invoices(client, app):
    client.post("/api/billing/run", json={"period": "2026-10"})
    inv = next(i for i in client.get("/api/invoices?status=entwurf").json() if i["customer_id"] == 2)
    inv = client.put(f"/api/invoices/{inv['id']}", json={"status": "gestellt"}).json()
    row = next(x for x in profitability(app.state.ctx.db)["rows"] if x["customer_id"] == 2)
    assert row["estimated"] is False and row["revenue"] == inv["net"]


def _index_setup(client, app, values: dict[str, float]) -> None:
    db = app.state.ctx.db
    db.update("customers", 1, {"index_clause": True, "index_base_month": "2025-01"})
    db.update("customers", 2, {"index_clause": True, "index_base_month": "2025-01", "index_base_value": 0})
    r = client.put("/api/indexation/settings", json={"threshold": 3, "values": values})
    assert r.status_code == 200, r.text


def test_index_proposals_threshold(client, app):
    _index_setup(client, app, {"2025-01": 100.0, "2025-12": 102.0})
    rows = {r["customer_id"]: r for r in client.get("/api/indexation").json()["rows"]}
    assert rows[1]["status"] == "unter Schwelle" and rows[1]["change_pct"] == 2.0
    client.put("/api/indexation/settings", json={"values": {"2026-09": 104.0}})
    rows = {r["customer_id"]: r for r in client.get("/api/indexation").json()["rows"]}
    huber = app.state.ctx.db.get("customers", 1)
    assert rows[1]["status"] == "anpassen" and rows[1]["new_mrr"] == round(huber["mrr"] * 1.04, 2)
    assert client.put("/api/indexation/settings", json={"values": {"2026-13": 1}}).status_code == 422
    assert client.put("/api/indexation/settings", json={"values": {"2026-10": 0}}).status_code == 422


def test_index_apply_schedules_mrr_and_letter(client, app):
    db = app.state.ctx.db
    _index_setup(client, app, {"2025-01": 100.0, "2026-09": 105.0})
    old = db.get("customers", 1)["mrr"]
    eff = _next_month_first()
    assert client.post("/api/indexation/apply", json={"customer_ids": [1], "effective": eff.replace(day=2).isoformat()}).status_code == 422
    r = client.post("/api/indexation/apply", json={"customer_ids": [1, 3], "effective": eff.isoformat()}).json()
    assert r["applied"][0]["new_mrr"] == round(old * 1.05, 2) and r["errors"][0]["customer_id"] == 3
    c = db.get("customers", 1)
    assert c["mrr"] == old and c["mrr_next"] == round(old * 1.05, 2) and c["index_base_month"] == "2026-09"
    doc = db.get("documents", r["applied"][0]["document"])
    assert doc["folder"].startswith("Kunden/Tischlerei Huber GmbH/Berichte/")
    # Rechnungslauf vor dem Stichtag: alte Pauschale, ab Stichtag: neue
    from meit.billing import billing_run, company_profile

    profile = company_profile(db)
    before = (eff - timedelta(days=1)).strftime("%Y-%m")
    billing_run(db, before, profile)
    billing_run(db, eff.strftime("%Y-%m"), profile)
    prices = {i["period"]: i["items"] for i in client.get("/api/invoices").json() if i["customer_id"] == 1}
    assert prices[before][0]["price"] == old and prices[eff.strftime("%Y-%m")][0]["price"] == round(old * 1.05, 2)
    # am Stichtag wird die neue Pauschale zur aktuellen (mit MRR-Verlauf)
    assert promote_scheduled(db, eff) == 1
    c = db.get("customers", 1)
    assert c["mrr"] == round(old * 1.05, 2) and c["mrr_next"] is None
    assert db.query_one("SELECT reason FROM mrr_history WHERE customer_id = 1 ORDER BY id DESC LIMIT 1")["reason"] == "indexanpassung"
    assert next(r for r in client.get("/api/indexation").json()["rows"] if r["customer_id"] == 1)["status"] == "aktuell"


def test_customer_form_index_fields(client):
    c = client.get("/api/customers/1").json()
    payload = {k: c[k] for k in ("name", "contact_name", "email", "phone", "address", "industry", "employees", "package",
                                 "mrr", "contract_end", "notes", "uid", "supplier_no", "booked_services", "keeper_url")}
    assert client.put("/api/customers/1", json={**payload, "index_clause": True, "index_base_month": "2025-13"}).status_code == 422
    ok = client.put("/api/customers/1", json={**payload, "index_clause": True, "index_base_month": "2025-04"}).json()
    assert ok["index_clause"] == 1 and ok["index_base_month"] == "2025-04"
