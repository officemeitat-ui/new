"""Auswertungen: Monatsverlauf, Auslastung je Techniker, Kunden nach Zeit – nur für Admins."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from meit.reports import label, month_list, workdays


def test_month_helpers():
    assert month_list(4, date(2027, 2, 10)) == ["2026-11", "2026-12", "2027-01", "2027-02"] and label("2027-01") == "Jän 27"
    assert workdays("2026-11") == 21 and workdays("2026-11", date(2026, 11, 6)) == 5 and workdays("2026-02") == 20


def test_overview_numbers(app, client):
    db = app.state.ctx.db
    db.query("DELETE FROM time_entries")
    client.post("/api/users", json={"name": "Maria Chefin", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    mario = client.post("/api/users", json={"name": "Mario Gruber", "email": "mario@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"}).json()["id"]
    this = date.today().strftime("%Y-%m")
    db.insert("time_entries", {"customer_id": 1, "user_id": mario, "date": f"{this}-01", "minutes": 600, "billable": 1, "rate": 100, "description": "a"})
    db.insert("time_entries", {"customer_id": 1, "user_id": mario, "date": f"{this}-01", "minutes": 300, "billable": 0, "rate": 100, "description": "b"})
    db.insert("time_entries", {"customer_id": 2, "user_id": None, "date": f"{this}-01", "minutes": 60, "billable": 1, "rate": 90, "description": "c"})
    db.insert("invoices", {"customer_id": 1, "customer_name": "Huber", "period": this, "date": f"{this}-01", "items": "[]", "net": 1500, "vat_rate": 20,
                           "vat": 300, "gross": 1800, "status": "gestellt", "number": "T-1"})
    db.insert("invoices", {"customer_id": 1, "customer_name": "Huber", "period": this, "date": f"{this}-01", "items": "[]", "net": 999, "vat_rate": 20,
                           "vat": 0, "gross": 999, "status": "entwurf"})
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "Auswertung", "category": "Netzwerk"}).json()["id"]
    client.put(f"/api/tickets/{tid}", json={"status": "geloest", "solution": "erledigt"})
    o = client.get("/api/reports/overview?months=3").json()
    cur = o["months"][-1]
    assert len(o["months"]) == 3 and cur["month"] == this and cur["hours"] == 16.0 and cur["hours_billable"] == 11.0 and cur["hours_other"] == 5.0
    assert cur["billable_share"] == 69 and cur["hours_value"] == 1090.0 and cur["revenue"] == 1500.0  # Entwürfe zählen nicht zum Umsatz
    assert cur["tickets_new"] >= 1 and cur["tickets_resolved"] >= 1 and cur["resolution_hours"] is not None
    assert o["months"][0]["hours"] == 0 and o["months"][0]["billable_share"] is None
    now, before = o["technicians"]
    people = {p["name"]: p for p in now["people"]}
    assert now["current"] is True and before["current"] is False and now["available_hours"] == round(now["workdays"] * 38.5 / 5, 1)
    assert people["Mario Gruber"]["hours"] == 15.0 and people["Mario Gruber"]["hours_billable"] == 10.0 and people["Maria Chefin"]["hours"] == 0
    assert people["Mario Gruber"]["billable_share"] == round(100 * 10 / now["available_hours"]) and people["ohne Benutzer"]["hours"] == 1.0
    assert o["customers"][0]["name"] == "Tischlerei Huber GmbH" and o["customers"][0]["hours"] == 15.0 and o["customers"][0]["billable_share"] == 67
    assert any(c["category"] == "Netzwerk" for c in o["categories"]) and o["summary"]["revenue"] == 1500.0
    # Wochenstunden einstellbar; nur für Admins
    assert client.put("/api/reports/settings", json={"week_hours": 30}).json() == {"week_hours": 30.0}
    assert client.get("/api/reports/overview").json()["technicians"][0]["available_hours"] == round(now["workdays"] * 30 / 5, 1)
    tech = TestClient(app)
    assert tech.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    assert tech.get("/api/reports/overview").status_code == 403
