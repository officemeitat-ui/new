"""„Mein Tag“: persönliche Startseite – Termine, eigene Tickets, offene Arbeitsberichte, gebuchte Zeit."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from meit.myday import greeting


def _at(days: int, clock: str) -> str:
    return f"{(datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')} {clock}"


def test_greeting():
    assert greeting(datetime(2026, 11, 20, 7, 30), "Mario Gruber") == "Guten Morgen, Mario"
    assert greeting(datetime(2026, 11, 20, 12, 0)) == "Mahlzeit" and greeting(datetime(2026, 11, 20, 16, 0), "Lisa") == "Guten Tag, Lisa"
    assert greeting(datetime(2026, 11, 20, 20, 0), "") == "Guten Abend"


def test_my_day_without_user_accounts(app, client):
    db = app.state.ctx.db
    client.post("/api/appointments", json={"title": "Heute spät", "customer_id": 1, "start_at": _at(0, "23:00"), "duration_min": 30})
    client.post("/api/appointments", json={"title": "Morgen früh", "customer_id": 2, "start_at": _at(1, "08:00")})
    gone = client.post("/api/appointments", json={"title": "Abgesagt", "customer_id": 2, "start_at": _at(0, "23:10")}).json()
    client.put(f"/api/appointments/{gone['id']}", json={"status": "abgesagt"})
    client.post("/api/appointments", json={"title": "Übermorgen", "customer_id": 2, "start_at": _at(2, "08:00")})
    crit = client.post("/api/tickets", json={"customer_id": 1, "title": "Server steht", "priority": "kritisch"}).json()["id"]
    client.post("/api/work-reports", json={"customer_id": 1, "minutes": 30, "work": "Entwurf wartet\nzweite Zeile"})
    client.post("/api/time", json={"customer_id": 1, "minutes": 45, "description": "Test"})
    d = client.get("/api/my-day").json()
    assert d["personal"] is False and d["greeting"] in ("Guten Morgen", "Mahlzeit", "Guten Tag", "Guten Abend") and d["date"] == _at(0, "")[:10]
    assert [a["title"] for a in d["today"]] == ["Heute spät"] and [a["title"] for a in d["tomorrow"]] == ["Morgen früh"]
    assert d["next"]["title"] == "Heute spät" and d["planned_today"] == 30
    prios = [t["priority"] for t in d["tickets"]]
    assert prios == sorted(prios, key=["kritisch", "hoch", "normal", "niedrig"].index) and prios[0] == "kritisch"  # Dringendes zuerst
    own = next(t for t in d["tickets"] if t["id"] == crit)
    assert own["customer"] == "Tischlerei Huber GmbH" and own["age_days"] == 0
    assert d["open_tickets"] >= len(d["tickets"]) > 0 and d["unassigned"] == 0 and all(t["status"] != "geloest" for t in d["tickets"])
    assert d["drafts"][0]["work"] == "Entwurf wartet" and d["drafts"][0]["customer"] == "Tischlerei Huber GmbH"
    assert d["minutes_today"] == 45 and d["minutes_week"] >= 45
    assert all(m["due_date"] <= _at(7, "")[:10] for m in d["maintenance"])
    db.query("UPDATE maintenance_runs SET due_date = '2020-01-01' WHERE id = (SELECT MIN(id) FROM maintenance_runs WHERE status = 'offen')")
    late = client.get("/api/my-day").json()["maintenance"]
    assert not late or late[0]["overdue"] is True


def test_my_day_is_personal_with_accounts(app, client):
    client.post("/api/users", json={"name": "Maria Chefin", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    mario_id = client.post("/api/users", json={"name": "Mario Gruber", "email": "mario@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"}).json()["id"]
    client.post("/api/appointments", json={"title": "Marios Einsatz", "customer_id": 1, "user_id": mario_id, "start_at": _at(0, "23:00"), "duration_min": 20})
    client.post("/api/appointments", json={"title": "Einsatz der Chefin", "customer_id": 2, "start_at": _at(0, "23:20"), "duration_min": 20})
    mine = client.post("/api/tickets", json={"customer_id": 1, "title": "Marios Ticket", "priority": "hoch"}).json()["id"]
    client.put(f"/api/tickets/{mine}", json={"assigned_to": mario_id})
    mario = TestClient(app)
    assert mario.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    d = mario.get("/api/my-day").json()
    assert d["personal"] is True and d["greeting"].endswith(", Mario")
    assert [a["title"] for a in d["today"]] == ["Marios Einsatz"] and d["next"]["title"] == "Marios Einsatz"
    assert [t["id"] for t in d["tickets"]] == [mine] and d["open_tickets"] == 1 and d["unassigned"] >= 1
    assert d["minutes_today"] == 0 and d["drafts"] == []
    assert TestClient(app).get("/api/my-day").status_code == 401
