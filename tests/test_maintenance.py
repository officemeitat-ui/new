"""Wartungsplan: Vorlagen, Fälligkeit → Ticket, Abschluss mit Nachweis, Bericht/QBR/Health/Portal."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from meit.maintenance import add_interval


def _plan(client, customer_id=1) -> list[dict]:
    r = client.post("/api/maintenance/plan", json={"customer_id": customer_id})
    assert r.status_code == 201
    return r.json()["tasks"]


def _book(app, customer_id: int, services: list[str]) -> None:
    app.state.ctx.db.update("customers", customer_id, {"booked_services": services})


def _make_due(app, task_id: int, days_ago: int = 0) -> None:
    app.state.ctx.db.update("maintenance_tasks", task_id, {"next_due": (date.today() - timedelta(days=days_ago)).isoformat()})


def test_add_interval():
    assert add_interval(date(2026, 1, 31), "monat") == date(2026, 2, 28)
    assert add_interval(date(2026, 11, 15), "quartal") == date(2027, 2, 15)
    assert add_interval(date(2026, 8, 31), "halbjahr") == date(2027, 2, 28)
    assert add_interval(date(2026, 3, 1), "jahr") == date(2027, 3, 1)
    assert add_interval(date(2026, 3, 1), "woche") == date(2026, 3, 8)


def test_suggestions_follow_booked_services(client, app):
    _book(app, 1, ["MW", "BCK", "MFW"])
    keys = {t["key"] for t in client.get("/api/maintenance/suggest/1").json()["templates"]}
    assert {"backup", "patch", "security", "firewall", "users", "docs"} <= keys
    tasks = _plan(client)
    assert len(tasks) == len(keys) and all(t["next_due"] > date.today().isoformat() for t in tasks)
    fw = next(t for t in tasks if t["template"] == "firewall")
    assert fw["interval"] == "quartal" and fw["checklist"]
    assert client.post("/api/maintenance/plan", json={"customer_id": 1}).json()["created"] == 0  # idempotent
    assert client.get("/api/maintenance/suggest/1").json()["templates"] == []


def test_due_task_creates_ticket_once_and_completion_is_documented(client, app):
    _book(app, 1, ["BCK"])
    task = next(t for t in _plan(client) if t["template"] == "backup")
    _make_due(app, task["id"])
    runs = client.get("/api/maintenance/runs?status=offen").json()
    run = next(r for r in runs if r["task_id"] == task["id"])
    assert len([r for r in client.get("/api/maintenance/runs?status=offen").json() if r["task_id"] == task["id"]]) == 1
    ticket = client.get(f"/api/tickets/{run['ticket_id']}").json()
    assert ticket["title"] == "Wartung: Backup-Kontrolle & Restore-Test" and ticket["category"] == "Wartung"
    assert "- [ ] Stichprobe: Datei/Ordner wiederhergestellt" in ticket["description"]

    r = client.post(f"/api/maintenance/runs/{run['id']}/complete", json={
        "done": [True, True, False, True], "result": "problem", "note": "Offsite-Kopie seit 5 Tagen nicht gelaufen",
        "minutes": 25, "followup": True})
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "erledigt" and done["followup_ticket_id"]
    assert [i["done"] for i in done["checklist"]] == [True, True, False, True]
    follow = client.get(f"/api/tickets/{done['followup_ticket_id']}").json()
    assert follow["priority"] == "hoch" and "Offsite" in follow["description"]
    closed = client.get(f"/api/tickets/{run['ticket_id']}").json()
    assert closed["status"] == "geloest" and "[ ] Offsite" in closed["solution"]
    assert any(t["minutes"] == 25 and t["ticket_id"] == run["ticket_id"] for t in client.get("/api/time").json())
    t = next(x for x in client.get("/api/maintenance/tasks?customer_id=1").json() if x["id"] == task["id"])
    assert t["next_due"] > date.today().isoformat() and t["last_result"] == "problem"
    assert client.post(f"/api/maintenance/runs/{run['id']}/complete", json={"result": "ok"}).status_code == 422


def test_maintenance_ticket_not_counted_in_sla(client, app):
    _book(app, 1, ["BCK"])
    task = _plan(client)[0]
    _make_due(app, task["id"])
    run = client.get("/api/maintenance/runs?status=offen").json()[0]
    sla_open = client.get("/api/sla").json()["open"]
    entry = next(o for o in sla_open if o["id"] == run["ticket_id"])
    assert entry["sla"]["response"]["state"] == "keine Zusage"


def test_report_qbr_health_and_protocol(client, app):
    _book(app, 1, ["MW"])
    tasks = _plan(client)
    for t in tasks[:2]:
        _make_due(app, t["id"])
    runs = [r for r in client.get("/api/maintenance/runs?status=offen").json() if r["customer_id"] == 1]
    client.post(f"/api/maintenance/runs/{runs[0]['id']}/complete", json={"done": [True] * 4, "result": "ok"})
    report = client.post("/api/agents/report", json={"customer_id": 1}).json()["text"]
    assert "## Wartung & Prüfungen" in report and runs[0]["title"] in report
    qbr = client.post("/api/agents/qbr", json={"customer_id": 1}).json()["text"]
    assert "Vorbeugende Wartung: **1 Prüfungen**" in qbr
    health = client.get("/api/customers/1").json()["health"]["factors"]
    assert any("Wartungsplan eingehalten" in f["text"] for f in health)
    # zweite Prüfung bleibt liegen → nach 7 Tagen negativ im Health Score
    app.state.ctx.db.update("maintenance_runs", runs[1]["id"], {"due_date": (date.today() - timedelta(days=10)).isoformat()})
    health = client.get("/api/customers/1").json()["health"]["factors"]
    assert any("überfällig" in f["text"] and f["delta"] < 0 for f in health)
    pdf = client.get("/api/maintenance/protocol.pdf?customer_id=1")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    doc = client.post("/api/maintenance/protocol", json={"customer_id": 1}).json()
    assert "/Berichte/" in doc["local_path"] and doc["title"].startswith("Wartungsprotokoll")


def test_skip_and_custom_task_crud(client, app):
    r = client.post("/api/maintenance/tasks", json={"customer_id": 2, "title": "Zertifikat Webshop prüfen",
                                                    "checklist": ["Ablaufdatum", "Kette"], "interval": "woche",
                                                    "next_due": date.today().isoformat()})
    assert r.status_code == 201
    task = r.json()
    assert task["interval"] == "woche" and task["checklist"] == ["Ablaufdatum", "Kette"]
    assert client.put(f"/api/maintenance/tasks/{task['id']}", json={"interval": "täglich"}).status_code == 422
    assert client.put(f"/api/maintenance/tasks/{task['id']}", json={"next_due": "morgen"}).status_code == 422
    run = next(r for r in client.get("/api/maintenance/runs?status=offen").json() if r["task_id"] == task["id"])
    skipped = client.post(f"/api/maintenance/runs/{run['id']}/complete", json={"skip": True, "note": "Kunde im Urlaub"}).json()
    assert skipped["status"] == "uebersprungen"
    t = client.put(f"/api/maintenance/tasks/{task['id']}", json={"active": False}).json()
    assert t["active"] == 0 and t["next_due"] == (date.today() + timedelta(days=7)).isoformat()
    ov = client.get("/api/maintenance").json()
    assert "backup" in ov["templates"] and ov["intervals"]["quartal"] == "vierteljährlich"
    assert client.delete(f"/api/maintenance/tasks/{task['id']}").json() == {"ok": True}


def test_portal_shows_only_own_maintenance(client, app):
    _book(app, 1, ["BCK"])
    _book(app, 2, ["MFW"])
    t1, t2 = _plan(client, 1)[0], _plan(client, 2)[0]
    _make_due(app, t1["id"])
    run = next(r for r in client.get("/api/maintenance/runs?status=offen").json() if r["task_id"] == t1["id"])
    client.post(f"/api/maintenance/runs/{run['id']}/complete", json={"done": [True, True, True, True], "result": "ok",
                                                                    "note": "intern: Passwort im Tresor geändert"})
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    c = TestClient(app)
    assert c.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    m = c.get("/api/portal/maintenance").json()
    titles = [p["title"] for p in m["plan"]]
    assert t1["title"] in titles and "Firewall: Firmware, Regeln, VPN" not in titles  # nur eigene Prüfungen
    assert m["done"][0]["checked"] == 4 and m["done"][0]["result_label"] == "in Ordnung"
    assert "note" not in m["done"][0]
