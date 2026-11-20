"""Einsatzplanung: Termine, Überschneidungen, Zeit buchen, Terminbestätigung mit Kalenderdatei, Kalender-Abo, Portal."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from meit.planner import feed_hash, ics_calendar, ics_escape, ics_fold, parse_when, utc_stamp


def _day(offset: int = 1) -> str:
    return (datetime.now() + timedelta(days=offset)).strftime("%Y-%m-%d")


class FakeMailer:
    smtp_configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body, **kw):
        self.sent.append({"to": to, "subject": subject, "body": body, "attachments": kw.get("attachments") or []})
        return "id-1"


def test_ics_format():
    assert ics_escape("Büro; 1. Stock, links\nKlingel \\ Huber") == r"Büro\; 1. Stock\, links\nKlingel \\ Huber"
    folded = ics_fold("SUMMARY:" + "Überprüfung der Datensicherung für die Tischlerei " * 4)
    lines = folded.split("\r\n")
    assert len(lines) > 2 and all(len(line.encode()) <= 75 for line in lines) and all(line.startswith(" ") for line in lines[1:])
    assert "".join([lines[0]] + [line[1:] for line in lines[1:]]) == "SUMMARY:" + "Überprüfung der Datensicherung für die Tischlerei " * 4
    local = datetime(2026, 7, 1, 9, 30)
    assert utc_stamp("2026-07-01 09:30:00") == local.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    assert parse_when("2026-11-24T09:00") == parse_when("2026-11-24 09:00:00") == datetime(2026, 11, 24, 9, 0)
    a = {"uid": "abc", "title": "Server prüfen", "customer": "Huber", "kind": "vor_ort", "status": "abgesagt", "start_at": "2026-11-24 09:00:00",
         "end_at": "2026-11-24 10:00:00", "location": "Hallein", "sequence": 2, "customer_note": "Bitte Serverraum aufsperren", "user_name": "Mario",
         "ticket_id": 7, "ticket_title": "Backup"}
    cal = ics_calendar([a], "ME-IT", "cockpit.me-it.test")
    assert cal.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") and cal.endswith("END:VCALENDAR\r\n") and "\n\n" not in cal.replace("\r\n", "\n")
    for part in ("UID:abc@cockpit.me-it.test", "SUMMARY:Server prüfen – Huber", "STATUS:CANCELLED", "SEQUENCE:2", "LOCATION:Hallein", "DTSTART:2026112"):
        assert part in cal, part
    public = ics_calendar([{**a, "status": "bestaetigt"}], "Termin", public=True).replace("\r\n ", "")  # Umbrüche langer Zeilen auflösen
    assert "SUMMARY:Server prüfen\r\n" in public and "STATUS:CONFIRMED" in public and "Serverraum aufsperren" in public


def test_appointments_crud_and_time_booking(app, client):
    db = app.state.ctx.db
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "Neuer Arbeitsplatz"}).json()["id"]
    r = client.post("/api/appointments", json={"title": "PC aufstellen", "ticket_id": tid, "start_at": f"{_day()}T09:00", "duration_min": 90,
                                               "notes": "Schlüssel beim Empfang", "customer_note": "Bitte Platz freiräumen"})
    assert r.status_code == 201
    a = r.json()
    assert a["customer_id"] == 1 and a["customer"] == "Tischlerei Huber GmbH" and a["duration_min"] == 90 and a["status"] == "geplant"
    assert a["end_at"] == f"{_day()} 10:30:00" and a["kind_label"] == "Vor Ort" and "09:00–10:30 Uhr" in a["when"] and a["conflicts"] == []
    assert a["location"] == db.get("customers", 1)["address"].replace("\n", ", ")  # vor Ort: Adresse des Kunden
    assert client.post("/api/appointments", json={"title": "x1", "customer_id": 99999, "start_at": f"{_day()} 09:00"}).status_code == 404
    assert client.post("/api/appointments", json={"title": "x1", "start_at": "morgen früh"}).status_code == 422
    client.post("/api/appointments", json={"title": "Teambesprechung", "kind": "intern", "start_at": f"{_day(40)} 08:00", "duration_min": 30})
    week = client.get(f"/api/appointments?start={_day()}&end={_day()}").json()
    assert [x["title"] for x in week["items"]] == ["PC aufstellen"] and week["kinds"]["remote"] == "Fernwartung"
    assert client.get(f"/api/appointments?start={_day()}&end={_day(60)}&customer_id=2").json()["items"] == []
    assert len(client.get(f"/api/appointments?start={_day()}&end={_day(60)}&unassigned=true").json()["items"]) == 2
    assert client.get(f"/api/appointments?start={_day(5)}&end={_day()}").status_code == 422
    assert "items" in client.get("/api/appointments").json()  # ohne Angabe: die laufende Woche
    # verschieben: Dauer bleibt, Fassung zählt hoch
    moved = client.put(f"/api/appointments/{a['id']}", json={"start_at": f"{_day(2)} 14:00"}).json()
    assert moved["start_at"] == f"{_day(2)} 14:00:00" and moved["end_at"] == f"{_day(2)} 15:30:00" and moved["customer_needs_update"] is False
    assert db.get("appointments", a["id"])["sequence"] == 1
    assert client.put(f"/api/appointments/{a['id']}", json={"duration_min": 45}).json()["duration_min"] == 45
    assert client.put("/api/appointments/99999", json={"title": "nix"}).status_code == 404
    # erledigt: Zeit landet beim Kunden und am Ticket – genau einmal
    done = client.post(f"/api/appointments/{a['id']}/complete", json={"minutes": 60}).json()
    entry = db.get("time_entries", done["time_entry_id"])
    assert done["status"] == "erledigt" and entry["minutes"] == 60 and entry["customer_id"] == 1 and entry["ticket_id"] == tid
    assert entry["date"] == _day(2) and entry["description"] == "Vor Ort: PC aufstellen" and db.get("tickets", tid)["time_spent_min"] == 60
    again = client.post(f"/api/appointments/{a['id']}/complete", json={}).json()
    assert again["time_entry_id"] == done["time_entry_id"] and db.scalar("SELECT COUNT(*) FROM time_entries WHERE ticket_id = ?", (tid,)) == 1
    intern = client.get(f"/api/appointments?start={_day(40)}&end={_day(40)}").json()["items"][0]
    assert client.post(f"/api/appointments/{intern['id']}/complete", json={}).status_code == 422  # ohne Kunde keine Zeitbuchung
    assert client.post(f"/api/appointments/{intern['id']}/complete", json={"book_time": False}).json()["status"] == "erledigt"
    gone = client.post("/api/appointments", json={"title": "Absage", "customer_id": 2, "start_at": f"{_day(3)} 10:00"}).json()
    client.put(f"/api/appointments/{gone['id']}", json={"status": "abgesagt"})
    assert client.post(f"/api/appointments/{gone['id']}/complete", json={}).status_code == 409
    # in der Suche auffindbar; löschen
    assert "appointment" in {g["type"] for g in client.get("/api/search?q=aufstellen").json()["groups"]}
    assert client.delete(f"/api/appointments/{gone['id']}").json() == {"ok": True} and client.get(f"/api/appointments/{gone['id']}").status_code == 404
    ics = client.get(f"/api/appointments/{a['id']}/ics")
    assert ics.headers["content-type"].startswith("text/calendar") and "SUMMARY:PC aufstellen – Tischlerei Huber GmbH" in ics.text


def test_conflicts_and_technician_notice(app, client):
    db = app.state.ctx.db
    client.post("/api/users", json={"name": "Chefin", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    tech = client.post("/api/users", json={"name": "Mario Technik", "email": "mario@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"}).json()["id"]
    other = client.post("/api/users", json={"name": "Lisa Technik", "email": "lisa@me-it.test", "role": "technik", "password": "Auch-Geheim-2027"}).json()["id"]
    first = client.post("/api/appointments", json={"title": "Firewall tauschen", "customer_id": 1, "user_id": tech, "start_at": f"{_day()} 09:00", "duration_min": 120}).json()
    assert first["user_name"] == "Mario Technik" and first["conflicts"] == []
    clash = client.post("/api/appointments", json={"title": "Drucker einrichten", "customer_id": 2, "user_id": tech, "start_at": f"{_day()} 10:30"}).json()
    assert [c["title"] for c in clash["conflicts"]] == ["Firewall tauschen"] and clash["conflicts"][0]["customer"] == "Tischlerei Huber GmbH"
    assert client.get(f"/api/appointments/{first['id']}").json()["conflicts"][0]["id"] == clash["id"]
    # direkt anschließend ist keine Überschneidung; anderer Techniker oder abgesagt auch nicht
    assert client.post("/api/appointments", json={"title": "Danach", "user_id": tech, "start_at": f"{_day()} 11:30"}).json()["conflicts"] == []
    assert client.post("/api/appointments", json={"title": "Später", "user_id": tech, "start_at": f"{_day()} 12:30"}).json()["conflicts"] == []
    assert client.post("/api/appointments", json={"title": "Parallel", "user_id": other, "start_at": f"{_day()} 09:30"}).json()["conflicts"] == []
    client.put(f"/api/appointments/{clash['id']}", json={"status": "abgesagt"})
    assert client.get(f"/api/appointments/{first['id']}").json()["conflicts"] == []
    assert client.post("/api/appointments", json={"title": "Falsch", "user_id": 99999, "start_at": f"{_day()} 09:00"}).status_code == 404
    only = client.get(f"/api/appointments?start={_day()}&end={_day()}&user_id={other}").json()
    assert [x["title"] for x in only["items"]] == ["Parallel"] and {u["name"] for u in only["users"]} == {"Chefin", "Mario Technik", "Lisa Technik"}
    # der zugeteilte Techniker bekommt eine Meldung (Glocke) – bei Zuteilung, Verschiebung und Absage
    titles = [n["title"] for n in db.query("SELECT title FROM notifications WHERE kind = 'termin' AND user_id = ? ORDER BY id", (tech,))]
    assert titles[0] == "Neuer Termin: Firewall tauschen" and "Termin abgesagt: Drucker einrichten" in titles
    client.put(f"/api/appointments/{first['id']}", json={"start_at": f"{_day(2)} 08:00"})
    client.put(f"/api/appointments/{first['id']}", json={"user_id": other})
    assert db.scalar("SELECT COUNT(*) FROM notifications WHERE kind = 'termin' AND user_id = ? AND title = 'Termin verschoben: Firewall tauschen'", (tech,)) == 1
    assert db.scalar("SELECT COUNT(*) FROM notifications WHERE kind = 'termin' AND user_id = ? AND title = 'Neuer Termin: Firewall tauschen'", (other,)) == 1
    # eigenes Kalender-Abo: nur die eigenen Termine; nach dem Deaktivieren sofort tot
    mario = TestClient(app)
    assert mario.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    own = mario.post("/api/calendar/feeds", json={"scope": "own"}).json()
    public = TestClient(app)
    cal = public.get(own["url"].split("testserver")[1]).text
    assert "Später" in cal and "Danach" in cal and "Parallel" not in cal and "Mario Technik" in cal
    team = mario.post("/api/calendar/feeds", json={"scope": "team"}).json()
    assert "Parallel" in public.get(team["url"].split("testserver")[1]).text
    assert [f["scope"] for f in mario.get("/api/calendar/feeds").json()["feeds"]] == ["own", "team"]
    assert client.put(f"/api/users/{tech}", json={"name": "Mario Technik", "email": "mario@me-it.test", "role": "technik", "active": False}).status_code == 200
    assert public.get(own["url"].split("testserver")[1]).status_code == 404


def test_customer_confirmation_with_calendar_file(app, client):
    db = app.state.ctx.db
    a = client.post("/api/appointments", json={"title": "Wartung Server", "customer_id": 1, "start_at": f"{_day(3)} 08:30", "duration_min": 120,
                                               "notes": "INTERN: Admin-Kennwort im Tresor", "customer_note": "Der Server ist ca. 30 Minuten nicht erreichbar."}).json()
    assert client.post(f"/api/appointments/{a['id']}/notify", json={}).status_code == 409  # kein Mailversand eingerichtet
    mailer = FakeMailer()
    app.state.ctx.mailer = mailer
    sent = client.post(f"/api/appointments/{a['id']}/notify", json={"message": "Bitte parken Sie den Hof frei."}).json()
    mail = mailer.sent[0]
    assert sent["status"] == "bestaetigt" and sent["sent_to"] == "office@huber-demo.at" == mail["to"] and mail["subject"] == "Terminbestätigung: Wartung Server"
    assert "08:30–10:30 Uhr" in mail["body"] and "30 Minuten nicht erreichbar" in mail["body"] and "Hof frei" in mail["body"] and "INTERN" not in mail["body"]
    att = mail["attachments"][0]
    ics = att.data.decode()
    assert att.name == "Termin.ics" and att.content_type == "text/calendar" and "SUMMARY:Wartung Server\r\n" in ics and "INTERN" not in ics
    assert f"UID:{db.get('appointments', a['id'])['uid']}@" in ics and "STATUS:TENTATIVE" in ics
    # verschoben → Oberfläche soll nachfragen; neue Mail heißt „geändert“; Absage ebenso
    moved = client.put(f"/api/appointments/{a['id']}", json={"start_at": f"{_day(4)} 13:00"}).json()
    assert moved["customer_needs_update"] is True
    client.post(f"/api/appointments/{a['id']}/notify", json={"to": "franz@huber-demo.at"})
    assert mailer.sent[1]["subject"] == "Termin geändert: Wartung Server" and mailer.sent[1]["to"] == "franz@huber-demo.at"
    assert "SEQUENCE:1" in mailer.sent[1]["attachments"][0].data.decode()
    assert client.put(f"/api/appointments/{a['id']}", json={"status": "abgesagt"}).json()["customer_needs_update"] is True
    client.post(f"/api/appointments/{a['id']}/notify", json={})
    assert mailer.sent[2]["subject"] == "Termin abgesagt: Wartung Server" and "STATUS:CANCELLED" in mailer.sent[2]["attachments"][0].data.decode()
    nomail = client.post("/api/appointments", json={"title": "Intern ohne Kunde", "kind": "intern", "start_at": f"{_day(3)} 08:30"}).json()
    assert client.post(f"/api/appointments/{nomail['id']}/notify", json={}).status_code == 422


def test_calendar_feed_and_portal(app, client):
    db = app.state.ctx.db
    client.post("/api/appointments", json={"title": "Switch tauschen", "customer_id": 1, "start_at": f"{_day(2)} 10:00", "notes": "geheim-intern",
                                           "customer_note": "Kurzer Netzwerkausfall"})
    client.post("/api/appointments", json={"title": "Fremder Termin", "customer_id": 2, "start_at": f"{_day(2)} 11:00"})
    client.post("/api/appointments", json={"title": "Interne Vorbereitung", "customer_id": 1, "kind": "intern", "start_at": f"{_day(1)} 16:00"})
    client.post("/api/appointments", json={"title": "Vergangen", "customer_id": 1, "start_at": f"{_day(-3)} 10:00"})
    made = client.post("/api/calendar/feeds", json={"scope": "own"}).json()  # ohne Benutzerkonten: Team-Kalender
    token = made["url"].split("token=")[1]
    assert made["scope"] == "team" and made["webcal"].startswith("webcal://") and token not in str(db.query("SELECT * FROM calendar_feeds"))
    assert db.query_one("SELECT token_hash FROM calendar_feeds")["token_hash"] == feed_hash(token)
    public = TestClient(app)
    cal = public.get(f"/api/public/calendar.ics?token={token}")
    assert cal.status_code == 200 and cal.headers["content-type"].startswith("text/calendar") and cal.headers["cache-control"] == "no-store"
    assert cal.text.count("BEGIN:VEVENT") == 4 and "Switch tauschen – Tischlerei Huber GmbH" in cal.text and "geheim-intern" not in cal.text
    assert public.get("/api/public/calendar.ics?token=falsch").status_code == 404 and public.get("/api/public/calendar.ics").status_code == 404
    assert db.query_one("SELECT last_used_at FROM calendar_feeds")["last_used_at"]
    new = client.post("/api/calendar/feeds", json={"scope": "team"}).json()["url"].split("token=")[1]
    assert public.get(f"/api/public/calendar.ics?token={token}").status_code == 404  # neuer Link ersetzt den alten
    assert public.get(f"/api/public/calendar.ics?token={new}").status_code == 200
    assert client.delete("/api/calendar/feeds/team").json() == {"ok": True} and public.get(f"/api/public/calendar.ics?token={new}").status_code == 404
    # Kundenportal: nur eigene, kommende, nicht interne Termine – ohne interne Notizen
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    assert portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    mine = portal.get("/api/portal/appointments").json()
    assert [m["title"] for m in mine] == ["Switch tauschen"] and mine[0]["note"] == "Kurzer Netzwerkausfall" and "notes" not in mine[0]
    ics = portal.get(f"/api/portal/appointments/{mine[0]['id']}/ics")
    assert ics.status_code == 200 and "SUMMARY:Switch tauschen\r\n" in ics.text and "geheim-intern" not in ics.text
    foreign = db.query_one("SELECT id FROM appointments WHERE title = 'Fremder Termin'")["id"]
    assert portal.get(f"/api/portal/appointments/{foreign}/ics").status_code == 404
    assert TestClient(app).get("/api/portal/appointments").status_code == 401
