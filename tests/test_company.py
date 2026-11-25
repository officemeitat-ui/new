"""Unternehmen: Kennzahlen, SWOT mit Vorschlägen aus den Zahlen, Ziele, Maßnahmen, Quartalsrückblick."""

from datetime import date, timedelta

from meit import company


def overview(client):
    r = client.get("/api/company")
    assert r.status_code == 200, r.text
    return r.json()


def test_metrics_come_from_the_cockpit(client, app):
    db = app.state.ctx.db
    m = {x["key"]: x for x in overview(client)["metrics"]}
    assert m["mrr"]["value"] == round(db.scalar("SELECT SUM(mrr) FROM customers"), 1) and m["mrr"]["unit"] == "€"
    assert m["contract_customers"]["value"] == db.scalar("SELECT COUNT(*) FROM customers WHERE mrr > 0")
    assert m["open_receivables"]["better"] == "niedrig" and m["top_customer_share"]["better"] == "niedrig"
    assert 0 < m["top_customer_share"]["value"] <= 100 and m["top_customer_share"]["customer"]
    # verrechenbare Quote aus den Zeitbuchungen der letzten 90 Tage
    today = date.today().isoformat()
    db.query("DELETE FROM time_entries")
    client.post("/api/time", json={"customer_id": 1, "date": today, "minutes": 180, "description": "Server", "billable": True})
    client.post("/api/time", json={"customer_id": 1, "date": today, "minutes": 60, "description": "intern", "billable": False})
    m = {x["key"]: x for x in overview(client)["metrics"]}
    assert m["billable_share"]["value"] == 75.0 and m["unbilled_hours"]["value"] == 3.0


def test_suggestions_follow_the_numbers_and_can_be_accepted_or_dismissed(client, app):
    db = app.state.ctx.db
    # Ein Kunde trägt fast alles: das Cockpit schlägt das Klumpenrisiko vor
    db.query("UPDATE customers SET mrr = 50")
    db.query("UPDATE customers SET mrr = 2000 WHERE id = 1")
    o = overview(client)
    keys = {s["key"]: s for s in o["suggestions"]}
    assert keys["klumpen"]["quadrant"] == "risiko" and "Tischlerei Huber" in keys["klumpen"]["text"] and keys["klumpen"]["kind"] == "zahl"
    assert keys["idee_nachweise"]["kind"] == "denkanstoss"  # Außensicht als Denkanstoß – die liefert keine Zahl
    assert "eine_person" in keys  # noch kein zweiter Benutzer angelegt

    item = client.post("/api/company/suggestions/klumpen/accept").json()
    assert item["quadrant"] == "risiko" and item["source"] == "klumpen"
    assert client.post("/api/company/suggestions/klumpen/accept").status_code == 409
    assert client.post("/api/company/suggestions/eine_person/dismiss").json() == {"ok": True}
    o = overview(client)
    left = {s["key"] for s in o["suggestions"]}
    assert "klumpen" not in left and "eine_person" not in left
    assert [i["text"] for i in o["swot"]["risiko"]] == [item["text"]]
    assert client.post("/api/company/suggestions/gibt_es_nicht/accept").status_code == 404

    # Zahlen ändern sich: der Vorschlag verschwindet von selbst, der übernommene Eintrag bleibt stehen
    db.query("UPDATE customers SET mrr = 500")
    assert "klumpen" not in {s["key"] for s in company.suggestions(db, company.metrics(db))}
    assert len(overview(client)["swot"]["risiko"]) == 1
    client.post("/api/company/suggestions/reset")
    assert "eine_person" in {s["key"] for s in overview(client)["suggestions"]}


def test_swot_entries_by_hand(client):
    made = client.post("/api/company/swot", json={"quadrant": "staerke", "text": "Persönlich erreichbar, kein Callcenter"}).json()
    assert client.post("/api/company/swot", json={"quadrant": "sonstiges", "text": "falsches Feld"}).status_code == 422
    client.put(f"/api/company/swot/{made['id']}", json={"quadrant": "staerke", "text": "Persönlich erreichbar – Antwort am selben Tag", "note": "aus Kundengesprächen"})
    o = overview(client)
    assert o["swot"]["staerke"][0]["text"].endswith("am selben Tag") and o["swot"]["staerke"][0]["note"] == "aus Kundengesprächen"
    action = client.post("/api/company/actions", json={"title": "Erreichbarkeit auf die Website schreiben", "swot_id": made["id"]}).json()
    assert overview(client)["swot"]["staerke"][0]["open_actions"] == 1
    client.delete(f"/api/company/swot/{made['id']}")
    o = overview(client)
    assert o["swot"]["staerke"] == [] and o["actions"][0]["id"] == action["id"] and o["actions"][0]["swot_text"] == ""  # Maßnahme bleibt


def test_goal_with_live_number_tracks_itself(client, app):
    db = app.state.ctx.db
    db.query("UPDATE customers SET mrr = 0")
    db.query("UPDATE customers SET mrr = 1000 WHERE id IN (1, 2)")
    due = (date.today() + timedelta(days=200)).isoformat()
    g = client.post("/api/company/goals", json={"title": "Wiederkehrenden Umsatz auf 4.000 € bringen", "metric": "mrr", "target_value": 4000, "due_date": due}).json()
    assert g["start_value"] == 2000 and g["unit"] == "€"  # Ausgangswert = Stand von heute
    view = overview(client)["goals"][0]
    assert (view["current"], view["progress"], view["state"], view["live"]) == (2000, 0, "im Plan", True)
    db.query("UPDATE customers SET mrr = 1500 WHERE id IN (1, 2)")  # neuer Vertrag – das Ziel bewegt sich ohne Zutun
    view = overview(client)["goals"][0]
    assert (view["current"], view["progress"]) == (3000, 50)
    db.query("UPDATE customers SET mrr = 2100 WHERE id IN (1, 2)")
    assert overview(client)["goals"][0]["state"] == "erreicht"
    assert client.post("/api/company/goals", json={"title": "Unbekannte Zahl", "metric": "gibts_nicht", "target_value": 1}).status_code == 422


def test_goal_states_overdue_and_behind_and_lower_is_better(client, app):
    db = app.state.ctx.db
    # eigene Zahl, die sinken soll: Reaktionszeit von 8 auf 4 Stunden
    g = client.post("/api/company/goals", json={"title": "Reaktionszeit halbieren", "metric": "manuell", "unit": "h", "start_value": 8,
                                                "current_value": 8, "target_value": 4, "due_date": (date.today() + timedelta(days=100)).isoformat()}).json()
    client.put(f"/api/company/goals/{g['id']}", json={"title": "Reaktionszeit halbieren", "metric": "manuell", "unit": "h", "target_value": 4, "current_value": 5,
                                                     "due_date": g["due_date"]})
    view = overview(client)["goals"][0]
    assert (view["start_value"], view["current"], view["progress"], view["live"], view["metric_label"]) == (8, 5, 75, False, "eigene Zahl")
    # vor 100 Tagen begonnen, kaum Fortschritt, in 10 Tagen fällig → hinter Plan; nach dem Termin → überfällig
    db.query("UPDATE company_goals SET created_at = ?, current_value = 7.5, due_date = ?", ((date.today() - timedelta(days=100)).isoformat() + " 08:00:00",
                                                                                      (date.today() + timedelta(days=10)).isoformat()))
    assert overview(client)["goals"][0]["state"] == "hinter Plan"
    db.query("UPDATE company_goals SET due_date = ?", ((date.today() - timedelta(days=1)).isoformat(),))
    assert overview(client)["goals"][0]["state"] == "überfällig"
    client.delete(f"/api/company/goals/{g['id']}")
    assert overview(client)["goals"] == []


def test_actions_owner_due_and_my_day(client):
    client.post("/api/users", json={"name": "Maria Chefin", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    mario = client.post("/api/users", json={"name": "Mario Gruber", "email": "mario@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"}).json()["id"]
    goal = client.post("/api/company/goals", json={"title": "Zehn Vertragskunden", "metric": "contract_customers", "target_value": 10}).json()
    late = (date.today() - timedelta(days=3)).isoformat()
    a = client.post("/api/company/actions", json={"title": "Drei Kunden ohne Vertrag anrufen", "owner_id": mario, "due_date": late, "goal_id": goal["id"]}).json()
    client.post("/api/company/actions", json={"title": "Preisliste überarbeiten", "status": "laeuft"})
    assert client.post("/api/company/actions", json={"title": "Unbekanntes Ziel", "goal_id": 999}).status_code == 422
    rows = overview(client)["actions"]
    assert [r["title"] for r in rows] == ["Preisliste überarbeiten", "Drei Kunden ohne Vertrag anrufen"]  # laufende zuerst
    mine = next(r for r in rows if r["id"] == a["id"])
    assert mine["overdue"] and mine["owner_name"] == "Mario Gruber" and mine["goal_title"] == "Zehn Vertragskunden"

    # Der Techniker sieht seine Maßnahme in „Mein Tag“ und hakt sie ab – Zahlen und SWOT bleiben der Verwaltung vorbehalten
    assert client.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    todo = client.get("/api/my-company-actions").json()
    assert [t["title"] for t in todo] == ["Drei Kunden ohne Vertrag anrufen"] and todo[0]["overdue"] and "owner_id" not in todo[0]
    for method, url in (("get", "/api/company"), ("get", "/api/company/plan"), ("post", "/api/company/swot"), ("post", "/api/company/goals"),
                        ("post", "/api/company/actions"), ("post", "/api/company/reviews")):
        assert getattr(client, method)(url, **({"json": {}} if method == "post" else {})).status_code == 403, url
    other = overview_as_admin_action(client, "Preisliste überarbeiten")
    assert client.post(f"/api/company/actions/{other}/done").status_code == 403  # fremde Maßnahme
    assert client.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    assert client.post(f"/api/company/actions/{a['id']}/done").json() == {"ok": True}
    assert client.get("/api/my-company-actions").json() == []
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    done = next(r for r in overview(client)["actions"] if r["id"] == a["id"])
    assert done["status"] == "erledigt" and done["done_at"] and not done["overdue"]


def overview_as_admin_action(client, title):
    """Kurz als Verwaltung nachsehen, welche Nummer eine Maßnahme hat – danach wieder als Techniker anmelden."""
    client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"})
    aid = next(r["id"] for r in overview(client)["actions"] if r["title"] == title)
    client.post("/api/auth/login", json={"email": "mario@me-it.test", "password": "Auch-Geheim-2026"})
    return aid


def test_quarterly_review_keeps_a_snapshot_of_the_numbers(client, app):
    db = app.state.ctx.db
    db.query("UPDATE customers SET mrr = 0")
    db.query("UPDATE customers SET mrr = 1000 WHERE id = 1")
    o = overview(client)
    assert o["review_due"] and o["quarter"] == company.quarter_of(date.today())
    assert client.post("/api/company/reviews", json={"good": " ", "bad": "", "change": ""}).status_code == 422
    client.post("/api/company/reviews", json={"good": "Zwei neue Verträge", "bad": "Zu viele Zurufe", "change": "Tickets konsequent anlegen"})
    db.query("UPDATE customers SET mrr = 1400 WHERE id = 1")
    client.post("/api/company/reviews", json={"good": "Pauschale erhöht", "bad": "", "change": ""})
    o = overview(client)
    assert not o["review_due"] and len(o["reviews"]) == 2
    newest, first = o["reviews"]
    mrr_now = next(n for n in newest["numbers"] if n["key"] == "mrr")
    assert (mrr_now["value"], mrr_now["before"]) == (1400, 1000)  # Entwicklung gegenüber dem letzten Rückblick
    assert next(n for n in first["numbers"] if n["key"] == "mrr")["before"] is None and first["bad"] == "Zu viele Zurufe"
    client.delete(f"/api/company/reviews/{newest['id']}")
    assert len(overview(client)["reviews"]) == 1


def test_plan_as_text_for_sharing(client):
    client.post("/api/company/swot", json={"quadrant": "chance", "text": "Zwei Steuerberater im Ort suchen einen Betreuer"})
    client.post("/api/company/goals", json={"title": "Zehn Vertragskunden", "metric": "contract_customers", "target_value": 10, "due_date": "2027-06-30"})
    client.post("/api/company/actions", json={"title": "Steuerberater anrufen", "due_date": "2026-12-15"})
    text = client.get("/api/company/plan").json()["text"]
    assert "Unternehmensplan" in text and "## SWOT" in text and "**Chancen**" in text
    assert "- Zwei Steuerberater im Ort suchen einen Betreuer" in text
    assert "Zehn Vertragskunden:" in text and "bis 2027-06-30" in text and "- [ ] Steuerberater anrufen, bis 2026-12-15" in text
    assert "**Schwächen**\n- (noch nichts eingetragen)" in text


def test_quarter_helper():
    assert company.quarter_of(date(2026, 1, 1)) == "2026-Q1" and company.quarter_of(date(2026, 11, 25)) == "2026-Q4"
