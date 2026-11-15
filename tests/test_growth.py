"""Wachstum: Health Score, NRR, wiederkehrender Anteil, Pipeline-Kaskade, QBR."""

from datetime import date

from meit.db import Database
from meit.growth import health_score, log_mrr, nrr, pipeline, recurring_share
from meit.seed import seed_services


def _db(tmp_path):
    db = Database(str(tmp_path / "g.db"))
    db.init_schema()
    seed_services(db)
    return db


def _history(db, cid, name, old, new, when):
    with db.connect() as conn:
        conn.execute("INSERT INTO mrr_history (customer_id, customer_name, old_mrr, new_mrr, reason, created_at) "
                     "VALUES (?, ?, ?, ?, 'test', ?)", (cid, name, old, new, when))


def test_nrr_counts_upsell_and_churn(tmp_path):
    db = _db(tmp_path)
    _history(db, 1, "A", 0, 1000, "2025-01-01 10:00:00")
    _history(db, 1, "A", 1000, 1500, "2026-06-01 10:00:00")   # Upsell
    _history(db, 2, "B", 0, 500, "2025-02-01 10:00:00")
    _history(db, 2, "B", 500, 0, "2026-03-01 10:00:00")       # Kündigung
    _history(db, 3, "C", 0, 800, "2026-09-01 10:00:00")       # Neukunde → nicht in der Kohorte
    r = nrr(db, today=date(2026, 11, 15))
    assert r["cohort"] == 2
    assert r["start_mrr"] == 1500 and r["current_mrr"] == 1500
    assert r["expansion"] == 500 and r["churn"] == 500
    assert r["nrr"] == 100.0


def test_nrr_without_history(tmp_path):
    assert nrr(_db(tmp_path))["nrr"] is None


def test_log_mrr_ignores_no_change(tmp_path):
    db = _db(tmp_path)
    log_mrr(db, 1, "A", 100, 100, "x")
    assert db.scalar("SELECT COUNT(*) FROM mrr_history") == 0


def test_recurring_share_includes_hourly_billing(tmp_path):
    db = _db(tmp_path)
    db.insert("customers", {"name": "Vertrag", "mrr": 1000, "package": "pro", "booked_services": "[]"})
    cid = db.insert("customers", {"name": "Zuruf", "mrr": 0, "package": "keins", "booked_services": "[]"})
    db.insert("tickets", {"customer_id": cid, "title": "x", "time_spent_min": 600})  # 10 h × 110 €
    r = recurring_share(db)
    assert r["annual_recurring"] == 12000 and r["hourly_12m"] == 1100
    assert r["share"] == round(100 * 12000 / 13100, 1)


def test_health_score_factors(tmp_path):
    db = _db(tmp_path)
    cid = db.insert("customers", {"name": "Risiko GmbH", "employees": 10, "package": "keins", "booked_services": "[]"})
    db.insert("tickets", {"customer_id": cid, "title": "Server down", "priority": "kritisch"})
    db.insert("assets", {"customer_id": cid, "name": "SRV", "type": "server", "os": "Windows Server 2012 R2"})
    db.insert("assessments", {"customer_id": cid, "score": 30, "level": "kritisch"})
    h = health_score(db, db.get("customers", cid), today=date(2026, 11, 15))
    assert h["status"] == "risiko"
    texts = " ".join(f["text"] for f in h["factors"])
    assert "dringende" in texts and "ohne Herstellersupport" in texts and "Kein Betreuungsvertrag" in texts
    good = db.insert("customers", {"name": "Gut", "employees": 10, "package": "pro", "last_qbr_at": "2026-10-01 10:00:00",
                                   "booked_services": '["MW","SEC","BCK"]'})
    db.insert("assessments", {"customer_id": good, "score": 90, "level": "gut"})
    g = health_score(db, db.get("customers", good), today=date(2026, 11, 15))
    assert g["score"] == 100 and g["status"] == "gesund"


def test_pipeline_cascade_backwards(tmp_path):
    db = _db(tmp_path)
    p = pipeline(db, target_closings_per_week=2)
    needed = {s["stage"]: s["needed_per_week"] for s in p["stages"]}
    assert needed["gewonnen"] == 2
    assert needed["angebot"] == 4.0          # 2 / 0,5
    assert needed["erstgespraech"] > needed["pitch"] > needed["angebot"]
    assert p["own_data"] is False


def test_qbr_and_growth_api(client):
    g = client.get("/api/growth").json()
    assert g["nrr"]["nrr"] > 100  # Demo: Upsells vor 5 Monaten
    assert g["health"]["counts"]["risiko"] >= 1
    r = client.post("/api/agents/qbr", json={"customer_id": 2}).json()
    assert "## 1. Das war der Plan" in r["text"] and "## 4. Der nächste Hebel" in r["text"]
    assert r["next_steps"]
    customer = client.get("/api/customers/2").json()
    assert customer["last_qbr_at"] and customer["qbrs"][0]["id"] == r["id"]
    assert any("QBR aktuell" in f["text"] for f in customer["health"]["factors"])
    # Zweites QBR übernimmt die Hebel des ersten als "Plan"
    r2 = client.post("/api/agents/qbr", json={"customer_id": 2}).json()
    assert r["next_steps"][0] in r2["text"].split("## 2.")[0]
    s = client.put("/api/growth/settings", json={"target_closings_per_week": 3, "selfcheck": {"s1": True}}).json()
    assert s["pipeline"]["target_closings_per_week"] == 3 and s["selfcheck"] == {"s1": True}


def test_mrr_logged_on_customer_changes(client):
    c = client.post("/api/customers", json={"name": "Neu GmbH", "mrr": 300}).json()
    client.put(f"/api/customers/{c['id']}", json={"name": "Neu GmbH", "mrr": 450})
    client.delete(f"/api/customers/{c['id']}")
    hist = [h for h in client.get("/api/growth").json()["mrr_history"] if h["customer_name"] == "Neu GmbH"]
    assert [h["reason"] for h in hist] == ["kündigung", "upsell", "neukunde"]
