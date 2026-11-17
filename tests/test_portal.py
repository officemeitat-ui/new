"""Kundenportal: Zugang, Datentrennung, Tickets, Angebote, Rechnungen, KI-Hilfe."""

from datetime import date

from fastapi.testclient import TestClient


def _portal_user(client, customer_id=1, email="franz@huber-demo.at"):
    r = client.post(f"/api/customers/{customer_id}/portal-users", json={"name": "Franz", "email": email})
    assert r.status_code == 201
    return r.json()


def _login(app, email, password):
    c = TestClient(app)
    r = c.post("/api/portal/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_portal_requires_login_and_is_public_path(app, client):
    assert client.get("/portal").status_code == 200
    assert TestClient(app).get("/api/portal/me").status_code == 401
    pu = _portal_user(client)
    assert len(pu["password"]) >= 12
    assert TestClient(app).post("/api/portal/login", json={"email": pu["email"], "password": "falsch"}).status_code == 401
    c = _login(app, pu["email"], pu["password"])
    me = c.get("/api/portal/me").json()
    assert me["customer"] == "Tischlerei Huber GmbH" and me["devices"] == 4 and me["devices_eol"] == 2
    # Portal-Cookie öffnet KEINE Mitarbeiter-API, sobald Mitarbeiter-Login aktiv ist
    client.post("/api/users", json={"name": "Admin", "email": "a@me-it-demo.at", "role": "admin", "password": "sehr-geheim-1"})
    assert c.get("/api/customers").status_code == 401
    assert c.get("/api/portal/me").status_code == 200


def test_portal_data_is_isolated(app, client):
    huber = _portal_user(client, 1)
    other = _portal_user(client, 2, "eva@gruber-demo.at")
    q = client.post("/api/agents/quote", json={"customer_id": 2, "need": "Backup", "service_codes": ["BCK"]}).json()
    client.put(f"/api/quotes/{q['id']}", json={"status": "versendet"})
    c = _login(app, huber["email"], huber["password"])
    assert all(t["title"] for t in c.get("/api/portal/tickets").json())
    names = {a["name"] for a in c.get("/api/portal/assets").json()}
    assert names and all(n.startswith("HUBER") or n == "Drucker Werkstatt" for n in names)
    assert c.get("/api/portal/quotes").json() == []  # Angebot gehört Gruber
    assert c.post(f"/api/portal/quotes/{q['id']}/accept", json={}).status_code == 404
    g = _login(app, other["email"], other["password"])
    assert [x["id"] for x in g.get("/api/portal/quotes").json()] == [q["id"]]


def test_portal_ticket_and_triage(app, client):
    pu = _portal_user(client)
    c = _login(app, pu["email"], pu["password"])
    r = c.post("/api/portal/tickets", json={"title": "Drucker druckt nicht", "description": "Seit heute"})
    assert r.status_code == 201
    t = client.get(f"/api/tickets/{r.json()['id']}").json()
    assert t["customer_id"] == 1 and t["category"] == "Hardware" and "Kundenportal" in t["description"]
    assert c.post("/api/portal/tickets", json={"title": "x"}).status_code == 422  # zu kurz
    assert c.post("/api/portal/tickets", json={"title": "Test"}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_portal_accept_tiered_quote_updates_mrr(app, client):
    pu = _portal_user(client, 3, "it@steiner-demo.at")
    q = client.post("/api/agents/quote", json={"customer_id": 3, "need": "Betreuung", "service_codes": ["MW", "BCK"],
                                               "tiers": True}).json()
    client.put(f"/api/quotes/{q['id']}", json={"status": "versendet"})
    c = _login(app, pu["email"], pu["password"])
    quotes = c.get("/api/portal/quotes").json()
    assert [t["key"] for t in quotes[0]["tiers"]] == ["XL", "S", "M"] and "items" not in quotes[0]["tiers"][0]
    r = c.post(f"/api/portal/quotes/{q['id']}/accept", json={"tier": "S"}).json()
    assert r["status"] == "angenommen" and r["chosen_tier"] == "S"
    assert client.get("/api/customers/3").json()["mrr"] == 65 * 39  # Einstieg = nur Managed Workplace
    assert c.post(f"/api/portal/quotes/{q['id']}/accept", json={}).status_code == 409
    acts = client.get("/api/activities").json()
    assert any("online angenommen" in a["note"] for a in acts)


def test_portal_invoices_only_issued(app, client):
    pu = _portal_user(client, 2, "eva@gruber-demo.at")
    client.post("/api/billing/run", json={"period": date.today().strftime("%Y-%m")})
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Steuerberatung"))
    c = _login(app, pu["email"], pu["password"])
    assert c.get("/api/portal/invoices").json() == []  # Entwurf unsichtbar
    assert c.get(f"/api/portal/invoices/{inv['id']}/html").status_code == 404
    client.put(f"/api/invoices/{inv['id']}", json={"status": "gestellt"})
    rows = c.get("/api/portal/invoices").json()
    assert rows[0]["id"] == inv["id"]
    assert "Rechnung" in c.get(f"/api/portal/invoices/{inv['id']}/html").text
    other = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Tischlerei"))
    client.put(f"/api/invoices/{other['id']}", json={"status": "gestellt"})
    assert c.get(f"/api/portal/invoices/{other['id']}/html").status_code == 404
    pdf = c.get(f"/api/portal/invoices/{inv['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert c.get(f"/api/portal/invoices/{other['id']}/pdf").status_code == 404


def test_portal_ask_uses_only_public_articles(app, client, use_fake_llm):
    pu = _portal_user(client)
    c = _login(app, pu["email"], pu["password"])
    r = c.post("/api/portal/ask", json={"question": "Drucker hängt, Warteschlange"}).json()
    assert r["sources"][0]["title"].startswith("Drucker")
    internal = c.post("/api/portal/ask", json={"question": "Backup Restore-Test RTO RPO"}).json()
    assert all(not s["title"].startswith("Backup") for s in internal["sources"])  # interner Artikel nicht freigegeben
    fake = use_fake_llm(["1. Spooler neu starten lassen …"])
    r = c.post("/api/portal/ask", json={"question": "Outlook startet nicht"}).json()
    assert r["answer"].startswith("1.") and "Anleitungen" in fake.calls[0]["messages"][0]["content"]


def test_portal_user_management(app, client):
    pu = _portal_user(client)
    assert client.post("/api/customers/1/portal-users", json={"email": pu["email"]}).status_code == 409
    c = _login(app, pu["email"], pu["password"])
    new_pw = client.put(f"/api/portal-users/{pu['id']}", json={"reset_password": True}).json()["password"]
    assert c.get("/api/portal/me").status_code == 401  # alte Sitzung beendet
    c2 = _login(app, pu["email"], new_pw)
    client.put(f"/api/portal-users/{pu['id']}", json={"active": False})
    assert c2.get("/api/portal/me").status_code == 401
