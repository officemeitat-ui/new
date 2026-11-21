"""Projekte: Vorlagen, Aufgaben und Fortschritt, Zeiten über Projekt und Ticket, Budget-Ampel, Abrechnungsart, Portal."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def test_templates_tasks_and_progress(app, client):
    tpl = client.get("/api/projects/templates").json()
    assert {t["key"] for t in tpl["templates"]} == {"server", "m365", "umzug", "arbeitsplatz"} and tpl["billing"]["fixpreis"] == "Fixpreis"
    assert client.post("/api/projects", json={"title": "x1", "template": "gibtsnicht"}).status_code == 422
    assert client.post("/api/projects", json={"title": "x1", "customer_id": 99999}).status_code == 404
    assert client.post("/api/projects", json={"title": "x1", "start_date": _day(5), "due_date": _day(1)}).status_code == 422
    p = client.post("/api/projects", json={"customer_id": 1, "title": "Neuer Server 2027", "template": "server", "due_date": _day(30)}).json()
    assert p["status"] == "geplant" and p["budget_hours"] == 24 and p["tasks_total"] == 14 and p["progress"] == 0 and p["light"] == "gruen"
    assert [ph["name"] for ph in p["phases"]] == ["Vorbereitung", "Aufbau", "Umstellung", "Abschluss"] and p["estimate_hours"] > 20
    first = p["phases"][0]["tasks"][0]
    # erste angefasste Aufgabe startet das Projekt; Fortschritt aus erledigten Aufgaben
    after = client.put(f"/api/project-tasks/{first['id']}", json={"status": "erledigt"}).json()
    assert after["status"] == "laufend" and after["tasks_done"] == 1 and after["progress"] == 7 and after["phases"][0]["done"] == 1
    assert after["phases"][0]["tasks"][0]["done_at"] and client.put(f"/api/project-tasks/{first['id']}", json={"status": "offen"}).json()["tasks_done"] == 0
    # eigene Aufgabe mit Fälligkeit in der Vergangenheit → überfällig, Ampel gelb
    late = client.post(f"/api/projects/{p['id']}/tasks", json={"title": "USV bestellen", "phase": "Vorbereitung", "due_date": _day(-2), "estimate_min": 20}).json()
    assert late["tasks_total"] == 15 and late["tasks_late"] == 1 and late["light"] == "gelb" and late["next_due"] == _day(-2)
    task = next(t for ph in late["phases"] for t in ph["tasks"] if t["title"] == "USV bestellen")
    assert task["late"] is True and client.delete(f"/api/project-tasks/{task['id']}").json()["tasks_total"] == 14
    assert client.put("/api/project-tasks/99999", json={"status": "erledigt"}).status_code == 404
    # zweite Vorlage dazuladen, Termin überschritten → rot
    assert client.post(f"/api/projects/{p['id']}/template/arbeitsplatz").json()["tasks_total"] == 21
    red = client.put(f"/api/projects/{p['id']}", json={"customer_id": 1, "title": "Neuer Server 2027", "status": "laufend", "due_date": _day(-1), "budget_hours": 24}).json()
    assert red["overdue"] is True and red["light"] == "rot"
    listing = client.get("/api/projects").json()
    assert listing["summary"]["open"] == 1 and listing["summary"]["red"] == 1 and listing["items"][0]["customer"] == "Tischlerei Huber GmbH"
    assert "project" in {g["type"] for g in client.get("/api/search?q=server 2027").json()["groups"]}
    tasks = client.get("/api/my-project-tasks").json()  # ohne Benutzerkonten: nur Aufgaben mit Fälligkeit
    assert tasks == []


def test_time_budget_and_billing_modes(app, client):
    db = app.state.ctx.db
    fix = client.post("/api/projects", json={"customer_id": 1, "title": "M365-Umstieg", "billing": "fixpreis", "budget_hours": 2, "status": "laufend"}).json()
    client.post(f"/api/projects/{fix['id']}/tasks", json={"title": "Postfächer übernehmen"})
    assert client.post("/api/time", json={"project_id": 99999, "minutes": 10}).status_code == 404
    e = client.post("/api/time", json={"project_id": fix["id"], "minutes": 100, "description": "Tenant eingerichtet"}).json()
    assert e["project_id"] == fix["id"] and e["customer_id"] == 1 and e["billable"] == 0  # Fixpreis: Stunden zählen nur intern
    forced = client.post("/api/time", json={"project_id": fix["id"], "minutes": 6, "billable": True}).json()
    assert forced["billable"] == 1  # ausdrücklich gewählt bleibt gewählt
    one = client.get(f"/api/projects/{fix['id']}").json()
    assert one["hours"] == 1.77 and one["budget_used"] == 88 and one["light"] == "gelb" and one["time_entries"][0]["minutes"] in (6, 100)
    # Ticket verknüpfen: schon gebuchte Zeit zählt mit und wird bei Fixpreis nicht mehr einzeln verrechnet
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "DNS umstellen"}).json()["id"]
    old = client.post("/api/time", json={"ticket_id": tid, "minutes": 30, "billable": True}).json()
    assert old["project_id"] is None
    linked = client.post(f"/api/projects/{fix['id']}/tickets", json={"ticket_id": tid}).json()
    assert [t["id"] for t in linked["tickets"]] == [tid] and linked["hours"] == 2.27 and linked["budget_used"] == 114 and linked["light"] == "rot"
    assert db.get("time_entries", old["id"])["billable"] == 0 and db.get("time_entries", old["id"])["project_id"] == fix["id"]
    # neue Zeit am Ticket (auch über einen Termin) landet automatisch im Projekt
    appt = client.post("/api/appointments", json={"title": "DNS umstellen", "ticket_id": tid, "start_at": f"{_day(1)} 09:00", "duration_min": 30}).json()
    done = client.post(f"/api/appointments/{appt['id']}/complete", json={}).json()
    assert db.get("time_entries", done["time_entry_id"])["project_id"] == fix["id"] and db.get("time_entries", done["time_entry_id"])["billable"] == 0
    assert client.get(f"/api/projects/{fix['id']}").json()["hours"] == 2.77
    assert client.post(f"/api/projects/{fix['id']}/tickets", json={"ticket_id": 99999}).status_code == 404
    # Budget-Meldungen: je Schwelle genau einmal
    client.get("/api/projects")
    client.get("/api/projects")
    titles = [n["title"] for n in db.query("SELECT title FROM notifications WHERE kind = 'projekt'")]
    assert titles == ["Projektbudget überschritten: M365-Umstieg"]
    # lösen der Verknüpfung nimmt die Zeiten wieder heraus; löschen geht nur ohne gebuchte Zeit
    unlinked = client.delete(f"/api/projects/{fix['id']}/tickets/{tid}").json()
    assert unlinked["tickets"] == [] and unlinked["hours"] == 1.77
    assert client.delete(f"/api/projects/{fix['id']}").status_code == 409
    closed = client.put(f"/api/projects/{fix['id']}", json={"customer_id": 1, "title": "M365-Umstieg", "billing": "fixpreis", "status": "abgeschlossen", "budget_hours": 2}).json()
    assert closed["closed_at"] and closed["light"] == "aus" and client.get("/api/projects").json()["items"] == []
    assert [p["id"] for p in client.get("/api/projects?status=abgeschlossen").json()["items"]] == [fix["id"]]
    # nach Aufwand: Zeit folgt der üblichen Regel des Kunden; internes Projekt nie verrechenbar
    intern = client.post("/api/projects", json={"title": "Werkstatt aufräumen", "billing": "intern"}).json()
    assert client.post("/api/time", json={"project_id": intern["id"], "customer_id": 1, "minutes": 20}).json()["billable"] == 0
    empty = client.post("/api/projects", json={"customer_id": 2, "title": "Leer"}).json()
    fresh = client.post("/api/tickets", json={"customer_id": 2, "title": "Ohne Zeit"}).json()["id"]
    client.post(f"/api/projects/{empty['id']}/tickets", json={"ticket_id": fresh})
    assert client.delete(f"/api/projects/{empty['id']}").json() == {"ok": True} and db.get("tickets", fresh)["project_id"] is None


def test_project_from_quote_my_tasks_and_portal(app, client):
    db = app.state.ctx.db
    qid = db.insert("quotes", {"customer_id": 1, "title": "Angebot Server-Tausch", "need": "", "items": "[]", "total_once": 4800, "total_monthly": 0,
                               "text": "", "status": "angenommen"})
    p = client.post("/api/projects", json={"title": "Server-Tausch", "quote_id": qid, "billing": "fixpreis", "template": "server", "portal_visible": True}).json()
    assert p["customer_id"] == 1 and p["budget_amount"] == 4800 and p["quote"]["title"] == "Angebot Server-Tausch"
    hidden = client.post("/api/projects", json={"customer_id": 1, "title": "Internes Vorprojekt"}).json()
    other = client.post("/api/projects", json={"customer_id": 2, "title": "Fremdes Projekt", "portal_visible": True}).json()
    t0 = p["phases"][0]["tasks"][0]
    client.put(f"/api/project-tasks/{t0['id']}", json={"status": "erledigt", "notes": "INTERN: Admin-Kennwort im Tresor"})
    # Benutzerkonten: „meine Aufgaben“
    client.post("/api/users", json={"name": "Maria Chefin", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    mario = client.post("/api/users", json={"name": "Mario Gruber", "email": "mario@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"}).json()["id"]
    t1 = p["phases"][0]["tasks"][1]
    client.put(f"/api/project-tasks/{t1['id']}", json={"assignee_id": mario, "due_date": _day(-1)})
    mc = TestClient(app)
    assert mc.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    mine = mc.get("/api/my-project-tasks").json()
    assert [m["id"] for m in mine] == [t1["id"]] and mine[0]["late"] is True and mine[0]["project"] == "Server-Tausch" and mine[0]["customer"] == "Tischlerei Huber GmbH"
    assert client.get("/api/my-project-tasks").json() == []  # die Chefin hat keine zugeteilt
    # Kundenportal: nur freigegebene eigene Projekte, ohne Notizen, Stunden und Beträge
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    assert portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    seen = portal.get("/api/portal/projects").json()
    assert [s["title"] for s in seen] == ["Server-Tausch"] and seen[0]["progress"] == 7 and seen[0]["phases"][0]["tasks"][0] == {"title": t0["title"], "done": True}
    assert "INTERN" not in str(seen) and "budget" not in str(seen) and "hours" not in str(seen)
    assert hidden["id"] and other["id"] and TestClient(app).get("/api/portal/projects").status_code == 401
