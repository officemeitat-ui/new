"""Team: Benutzer, Login, Rollen, Aktivitäten, Wochenrhythmus, Wochenbriefing."""

from datetime import date

from fastapi.testclient import TestClient

from meit.team import hash_password, iso_week, verify_password, week_range

ADMIN = {"name": "Chefin", "email": "chefin@me-it-demo.at", "role": "admin", "password": "sehr-geheim-123"}
TECH = {"name": "Tom Technik", "email": "tom@me-it-demo.at", "role": "technik", "password": "auch-geheim-456"}


def _login(client, user):
    r = client.post("/api/auth/login", json={"email": user["email"], "password": user["password"]})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_password_hashing():
    h = hash_password("geheimes-passwort")
    assert h.startswith("pbkdf2$") and verify_password("geheimes-passwort", h)
    assert not verify_password("falsch", h) and not verify_password("x", "kaputt")


def test_open_mode_until_first_user(client):
    assert client.get("/api/auth/status").json()["login_required"] is False
    assert client.get("/api/customers").status_code == 200
    bad = client.post("/api/users", json={**TECH})
    assert bad.status_code == 422 and "Admin" in bad.json()["detail"]  # erster Benutzer muss Admin sein
    assert client.post("/api/users", json={**ADMIN, "password": "kurz"}).status_code == 422
    assert client.post("/api/users", json=ADMIN).status_code == 201
    # ab jetzt Login-Pflicht
    assert client.get("/api/auth/status").json()["login_required"] is True
    assert client.get("/api/customers").status_code == 401
    assert client.get("/anfrage").status_code == 200  # öffentliches Formular bleibt offen
    assert client.post("/api/auth/login", json={"email": ADMIN["email"], "password": "falsch"}).status_code == 401
    user = _login(client, ADMIN)
    assert user["role"] == "admin" and "password_hash" not in user
    assert client.get("/api/customers").status_code == 200
    assert client.get("/api/auth/status").json()["user"]["email"] == ADMIN["email"]
    client.post("/api/auth/logout")
    assert client.get("/api/customers").status_code == 401


def test_roles_and_admin_only(client):
    client.post("/api/users", json=ADMIN)
    _login(client, ADMIN)
    tech = client.post("/api/users", json=TECH).json()
    assert client.post("/api/users", json=TECH).status_code == 409
    client.post("/api/auth/logout")
    _login(client, TECH)
    assert client.get("/api/tickets").status_code == 200
    assert client.post("/api/backup/run").status_code == 403
    assert client.post("/api/services", json={"code": "X1", "name": "x"}).status_code == 403
    assert client.post("/api/users", json={**TECH, "email": "x@y.at"}).status_code == 403
    assert client.delete("/api/customers/1").status_code == 403
    assert client.put("/api/ki-mitarbeiter/modes", json={"modes": {"info": "entwurf"}}).status_code == 403
    # eigenes Wochenziel ja, fremdes nein
    week = iso_week(date.today())
    assert client.put("/api/team/goals", json={"week": week, "user_id": tech["id"], "goals": {"anruf": 10}}).status_code == 200
    assert client.put("/api/team/goals", json={"week": week, "user_id": 1, "goals": {"anruf": 1}}).status_code == 403


def test_last_admin_cannot_be_demoted_and_deactivation_ends_sessions(client):
    admin = client.post("/api/users", json=ADMIN).json()
    _login(client, ADMIN)
    r = client.put(f"/api/users/{admin['id']}", json={**ADMIN, "role": "technik", "password": None})
    assert r.status_code == 422
    tech = client.post("/api/users", json=TECH).json()
    other = TestClient(client.app)
    _login(other, TECH)
    assert other.get("/api/tickets").status_code == 200
    client.put(f"/api/users/{tech['id']}", json={**TECH, "active": False, "password": None})
    assert other.get("/api/tickets").status_code == 401


def test_cross_origin_writes_blocked(client):
    client.post("/api/users", json=ADMIN)
    _login(client, ADMIN)
    r = client.post("/api/activities", json={"type": "anruf"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.post("/api/activities", json={"type": "anruf"}, headers={"Origin": "http://testserver"}).status_code == 201


def test_activities_and_week_review(client):
    client.post("/api/users", json=ADMIN)
    me = _login(client, ADMIN)
    week = iso_week(date.today())
    client.put("/api/team/goals", json={"week": week, "user_id": me["id"], "goals": {"anruf": 2, "erstgespraech": 1, "qbr": 1}})
    client.post("/api/activities", json={"type": "anruf", "note": "Wagner angerufen"})
    client.post("/api/activities", json={"type": "anruf"})
    assert client.post("/api/activities", json={"type": "unsinn"}).status_code == 422
    client.post("/api/inbox/process-new")
    lead = client.get("/api/leads").json()[0]
    client.put(f"/api/leads/{lead['id']}", json={"stage": "erstgespraech", "owner_id": me["id"], "next_step": "Pitch am Do",
                                                 "risk": "Budget unklar"})
    client.post("/api/agents/qbr", json={"customer_id": 2})
    t = client.post("/api/tickets", json={"customer_id": 1, "title": "Test", "auto_triage": False}).json()
    client.put(f"/api/tickets/{t['id']}", json={"assigned_to": me["id"]})
    client.put(f"/api/tickets/{t['id']}", json={"status": "geloest", "solution": "erledigt"})
    assert [x["id"] for x in client.get("/api/tickets?mine=true").json()] == [t["id"]]
    w = client.get(f"/api/team/week?week={week}").json()
    row = next(r for r in w["rows"] if r["user_id"] == me["id"])
    assert row["actual"]["anruf"] == 2 and row["actual"]["erstgespraech"] == 1 and row["actual"]["qbr"] == 1
    assert row["actual"]["ticket_geloest"] == 1 and row["fulfilled"] == "3/3"
    top = w["top_opportunities"][0]
    assert top["owner"] == "Chefin" and top["next_step"] == "Pitch am Do" and top["risk"] == "Budget unklar"
    assert client.get("/api/team/week?week=kaputt").status_code == 422


def test_week_range():
    assert week_range("2026-W46") == ("2026-11-09", "2026-11-16")


def test_briefing(client):
    client.post("/api/inbox/process-new")
    r = client.post("/api/agents/briefing", json={}).json()
    assert r["text"].startswith("# Wochenbriefing") and "## Prioritäten nächste Woche" in r["text"]
    assert len(r["priorities"]) == 3 and r["sent"] is False
    assert any("Kritische Tickets" in p or "Risiko" in p for p in r["priorities"])
    assert client.post("/api/agents/briefing", json={"send_to": "chef@me-it-demo.at"}).status_code == 409
