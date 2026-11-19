"""Erste Schritte: Live-Status der Inbetriebnahme und sauberes Entfernen der Demodaten."""

from __future__ import annotations

from meit.main import create_app


def test_setup_steps_reflect_state(app, client):
    d = client.get("/api/setup").json()
    steps = {s["key"]: s for s in d["steps"]}
    assert steps["admin"]["status"] == "offen" and steps["demo"]["status"] == "offen" and steps["demo"]["action"] == "demo"
    assert steps["ai"]["status"] == "optional" and steps["company"]["status"] == "offen" and "IBAN fehlt" in steps["company"]["detail"]
    assert d["next"]["key"] == "admin" and d["percent"] < 50 and d["total"] == len([s for s in d["steps"] if s["status"] != "optional"])
    assert steps["mail"]["env"] and "Einstellungen" in steps["admin"]["where"]
    # Firmendaten ausfüllen, Schritt von Hand abhaken
    prof = client.get("/api/billing/profile").json()
    client.put("/api/billing/profile", json={**prof, "address": "Musterweg 1, 5400 Hallein", "uid": "ATU12345678",
                                             "iban": "AT611904300234573201"})
    assert client.post("/api/setup/steps/admin", json={"done": True}).status_code == 422  # wird automatisch geprüft
    client.post("/api/setup/steps/steuer", json={"done": True})
    steps = {s["key"]: s for s in client.get("/api/setup").json()["steps"]}
    assert steps["company"]["status"] == "ok" and steps["steuer"]["status"] == "ok" and steps["services"]["status"] == "offen"
    client.post("/api/setup/dismiss", json={"done": True})
    assert client.get("/api/setup").json()["dismissed"] is True


def test_remove_demo_data_keeps_real_data(app, client, settings):
    db = app.state.ctx.db
    real = client.post("/api/customers", json={"name": "Echt GmbH", "email": "office@echt-firma.at", "employees": 4}).json()
    client.post("/api/tickets", json={"customer_id": real["id"], "title": "Echtes Ticket"})
    client.post("/api/inbox/process-new")  # Demo-Posteingang erzeugt Tickets, Lead, Beleg
    before = client.get("/api/setup").json()["demo"]
    assert before["present"] and before["customers"] == 5 and before["tickets"] > 0 and before["messages"] >= 5
    assert client.post("/api/setup/demo/remove", json={"confirm": "ja"}).status_code == 422
    removed = client.post("/api/setup/demo/remove", json={"confirm": "demo löschen"}).json()["removed"]
    assert removed["customers"] == 5 and removed["messages"] >= 5 and removed["assets"] > 0
    customers = client.get("/api/customers").json()
    assert [c["name"] for c in customers] == ["Echt GmbH"]
    assert [t["title"] for t in client.get("/api/tickets").json()] == ["Echtes Ticket"]
    assert db.scalar("SELECT COUNT(*) FROM messages") == 0 and db.scalar("SELECT COUNT(*) FROM assets") == 0
    assert db.scalar("SELECT COUNT(*) FROM leads") == 0 and db.scalar("SELECT COUNT(*) FROM subscriptions") == 0
    assert db.scalar("SELECT COUNT(*) FROM services") > 5 and db.scalar("SELECT COUNT(*) FROM kb_articles") > 0  # Katalog/Wissen bleiben
    after = client.get("/api/setup").json()
    steps = {s["key"]: s for s in after["steps"]}
    assert steps["demo"]["status"] == "ok" and steps["customers"]["status"] == "ok" and not after["demo"]["present"]
    assert client.post("/api/setup/demo/remove", json={"confirm": "DEMO LÖSCHEN"}).status_code == 409
    # nach einem Neustart entstehen keine neuen Demodaten – auch wenn alle Kunden gelöscht werden
    client.delete(f"/api/customers/{real['id']}")
    again = create_app(settings)
    assert again.state.ctx.db.scalar("SELECT COUNT(*) FROM customers") == 0
