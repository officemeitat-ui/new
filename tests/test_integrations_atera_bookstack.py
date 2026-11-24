"""Atera (Sync + Splashtop-Sitzungen), BookStack (Doku + Wissen), Keeper-Links und Passwort-Wächter."""

from __future__ import annotations

import dataclasses
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from meit.atera import parse_duration, parse_dt, parse_sessions
from meit.main import create_app
from meit.secrets_guard import find_secrets, redact


class Resp:
    def __init__(self, data, status=200):
        self._data, self.status_code, self.content = data, status, b"x"

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError(f"{self.status_code}", request=None, response=None)


# ------------------------------------------------------------------ Atera
AT_CUSTOMERS = [{"CustomerID": 11, "CustomerName": "Tischlerei Huber GmbH"},
                {"CustomerID": 12, "CustomerName": "Bäckerei Neu KG", "City": "Hallein", "ZipCodeStr": "5400",
                 "Address": "Markt 1", "Phone": "06245 1"}]
AT_AGENTS = [{"AgentID": 501, "CustomerID": 11, "AgentName": "HUBER-SRV01", "OSType": "Server",
              "OS": "Windows Server 2019 Standard", "VendorSerialNumber": "CZ123", "LastSeen": "2026-11-16T08:00:00",
              "AppViewUrl": "https://app.atera.com/new/device/501"},
             {"AgentID": 502, "CustomerID": 12, "AgentName": "KASSA-PC", "OSType": "Work Station",
              "OS": "Windows 11 Pro", "LastSeen": "2026-11-17T08:00:00", "AppViewUrl": "javascript:alert(1)"}]
AT_ALERTS = [{"AlertID": 9001, "CustomerID": 11, "Title": "Backup fehlgeschlagen", "Severity": "Critical",
              "DeviceName": "HUBER-SRV01", "Archived": False},
             {"AlertID": 9002, "CustomerID": 11, "Title": "alt", "Archived": True}]


@pytest.fixture()
def atera_app(settings, monkeypatch):
    import httpx

    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append((url, headers))
        data = {"/customers": AT_CUSTOMERS, "/agents": AT_AGENTS, "/alerts": AT_ALERTS}.get(url.split("/v3")[1], [])  # Kontakte: keine
        page, size = params["page"], params["itemsInPage"]
        return Resp({"items": data[(page - 1) * size: page * size], "totalPages": 1, "page": page})

    monkeypatch.setattr(httpx, "get", fake_get)
    app = create_app(dataclasses.replace(settings, atera_api_key="key-123", atera_alert_tickets=True))
    app.state.atera_calls = calls
    return app


def test_atera_sync_customers_devices_alerts(atera_app):
    c = TestClient(atera_app)
    r = c.post("/api/atera/sync").json()
    assert r["customers_created"] == ["Bäckerei Neu KG"] and r["assets_created"] == 2 and r["alert_tickets"] == 1
    assert atera_app.state.atera_calls[0][1]["X-API-KEY"] == "key-123"
    srv = next(a for a in c.get("/api/assets").json() if a["name"] == "HUBER-SRV01")
    assert srv["type"] == "server" and srv["customer_id"] == 1 and srv["remote_url"].startswith("https://app.atera.com")
    pc = next(a for a in c.get("/api/assets").json() if a["name"] == "KASSA-PC")
    assert pc["remote_url"] == ""  # nur https-Links
    again = c.post("/api/atera/sync").json()
    assert again["assets_created"] == 0 and again["assets_updated"] == 2 and again["alert_tickets"] == 0
    t = next(t for t in c.get("/api/tickets").json() if t["title"].startswith("RMM: Backup"))
    assert t["priority"] == "hoch"


def test_atera_not_configured(client):
    assert client.post("/api/atera/sync").status_code == 409
    assert client.get("/api/atera/status").json()["configured"] is False


# ------------------------------------------------------------------ Splashtop-/Atera-Sitzungen
def test_session_parsers():
    assert parse_dt("11/05/2026 09:12:33 AM").isoformat() == "2026-11-05T09:12:33"
    assert parse_dt("05.11.2026 14:05").isoformat() == "2026-11-05T14:05:00"
    assert parse_dt("2026-11-05T09:12:33.123Z").isoformat() == "2026-11-05T09:12:33"
    assert parse_duration("00:29:13") == 29 and parse_duration("1h 5m") == 65 and parse_duration("1 Std. 30 Min.") == 90
    assert parse_duration("1753") == 29 and parse_duration("45") == 45 and parse_duration("") is None
    rows = parse_sessions(b"Start Time,End Time,Remote Computer,Technician\n"
                          b"11/05/2026 09:12:00 AM,11/05/2026 09:41:00 AM,HUBER-SRV01,Max Techniker\n")
    assert rows[0]["minutes"] == 29 and rows[0]["device"] == "HUBER-SRV01"
    with pytest.raises(ValueError):
        parse_sessions(b"foo,bar\n1,2\n")


def _sessions_csv(rows) -> bytes:
    return ("Beginn;Dauer;Gerät;Techniker;Kunde\n" + "\n".join(";".join(r) for r in rows)).encode("cp1252")


def test_sessions_match_maintenance_and_unbooked(client, app):
    db = app.state.ctx.db
    srv = db.insert("assets", {"customer_id": 1, "name": "HUBER-SRV01", "type": "server", "remote_url": "https://app.atera.com/x"})
    db.update("customers", 1, {"booked_services": ["BCK"]})
    task = client.post("/api/maintenance/plan", json={"customer_id": 1}).json()["tasks"][0]
    db.update("maintenance_tasks", task["id"], {"next_due": date.today().isoformat()})
    run = next(r for r in client.get("/api/maintenance/runs?status=offen").json() if r["task_id"] == task["id"])
    ticket = client.get(f"/api/tickets/{run['ticket_id']}").json()
    assert "Atera (Splashtop)" in ticket["description"] and "https://app.atera.com/x" in ticket["description"]
    today = date.today().strftime("%d.%m.%Y")
    other = (date.today() - timedelta(days=60)).strftime("%d.%m.%Y")
    r = client.post("/api/sessions/import", content=_sessions_csv([
        [f"{today} 09:12", "00:29:00", "huber-srv01.huber.local", "Max", ""],          # → Wartung
        [f"{other} 14:00", "45 min", "UNBEKANNT-PC", "Max", "Ordination Dr. Berger"],   # → Kunde über Gruppe, ungebucht
        [f"{other} 16:00", "10 min", "GEISTER-PC", "Max", ""],                          # → ohne Kunde
    ]), headers={"X-Filename": "atera-sessions.csv"}).json()
    assert r["imported"] == 3 and r["maintenance"] == 1 and r["unbooked"] == 2
    assert client.post("/api/sessions/import", content=_sessions_csv([[f"{today} 09:12", "00:29:00", "huber-srv01.huber.local", "Max", ""]])).json()["duplicates"] == 1
    linked = client.get(f"/api/maintenance/runs/{run['id']}/sessions").json()
    assert len(linked) == 1 and linked[0]["asset_id"] == srv and linked[0]["minutes"] == 29
    assert client.get("/api/maintenance/runs?status=offen").json()[0]["remote_minutes"] == 29
    # Abschluss → Protokoll enthält den Splashtop-Nachweis
    client.post(f"/api/maintenance/runs/{run['id']}/complete", json={"done": [True] * 4, "result": "ok", "minutes": 29})
    import io

    pypdf = pytest.importorskip("pypdf")
    pdf = client.get("/api/maintenance/protocol.pdf?customer_id=1").content
    text = "\n".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(pdf)).pages)
    assert "Fernwartung" in text and "29 Min." in text
    # ungebuchte Sitzung buchen
    open_ = client.get("/api/sessions?status=offen").json()
    berger = next(s for s in open_ if s["customer_name"] == "Ordination Dr. Berger")
    booked = client.post(f"/api/sessions/{berger['id']}/book", json={}).json()
    assert booked["status"] == "gebucht" and booked["time_entry_id"]
    ghost = client.get("/api/sessions?status=ohne_kunde").json()[0]
    assert client.post(f"/api/sessions/{ghost['id']}/book", json={}).status_code == 422
    client.post(f"/api/sessions/{ghost['id']}/assign", json={"customer_id": 2})
    assert client.get("/api/atera/status").json()["sessions"]["unassigned"] == 0


def test_existing_time_entry_counts_as_booked(client, app):
    client.post("/api/time", json={"customer_id": 4, "minutes": 30, "description": "Fernwartung Drucker",
                                   "date": "2026-10-02"})
    r = client.post("/api/sessions/import", content=_sessions_csv([["02.10.2026 10:00", "25 min", "X", "Max", "Ordination Dr. Berger"]])).json()
    assert r["already_booked"] == 1 and r["unbooked"] == 0


# ------------------------------------------------------------------ BookStack
class FakeBookStack:
    def __init__(self):
        self.books, self.pages, self.next_id = [], [], 100

    def __call__(self, method, url, params=None, json=None, headers=None, timeout=None):
        assert headers["Authorization"] == "Token tid:tsecret"
        path = url.split("/api", 1)[1]
        params = params or {}
        if method == "GET" and path == "/books":
            data = [b for b in self.books if params.get("filter[name]") in (None, b["name"])]
            return Resp({"data": data, "total": len(data)})
        if method == "POST" and path == "/books":
            self.next_id += 1
            b = {"id": self.next_id, "name": json["name"], "slug": json["name"].lower().replace(" ", "-").replace(":", "")}
            self.books.append(b)
            return Resp(b)
        if method == "GET" and path == "/pages":
            data = [p for p in self.pages if str(p["book_id"]) == str(params.get("filter[book_id]"))
                    and params.get("filter[name]") in (None, p["name"])]
            return Resp({"data": data, "total": len(data)})
        if method == "POST" and path == "/pages":
            self.next_id += 1
            p = {"id": self.next_id, "book_id": json["book_id"], "name": json["name"], "markdown": json["markdown"],
                 "tags": json.get("tags", []), "slug": f"p{self.next_id}", "updated_at": "2026-11-17T10:00:00.000000Z"}
            self.pages.append(p)
            return Resp(p)
        if method == "PUT" and path.startswith("/pages/"):
            p = next(p for p in self.pages if p["id"] == int(path.split("/")[2]))
            p.update({"name": json["name"], "markdown": json["markdown"], "tags": json.get("tags", [])})
            return Resp(p)
        if method == "GET" and path.startswith("/pages/"):
            return Resp(next(p for p in self.pages if p["id"] == int(path.split("/")[2])))
        raise AssertionError(f"unerwartet: {method} {path}")


@pytest.fixture()
def bs_app(settings, monkeypatch):
    import httpx

    fake = FakeBookStack()
    monkeypatch.setattr(httpx, "request", fake)
    app = create_app(dataclasses.replace(settings, bookstack_url="https://wiki.meit.at", bookstack_token_id="tid",
                                         bookstack_token_secret="tsecret"))
    app.state.fake_bs = fake
    return app


def test_bookstack_customer_docs_redact_and_link(bs_app):
    c = TestClient(bs_app)
    db = bs_app.state.ctx.db
    db.update("customers", 1, {"notes": "Server-Admin Passwort: Sommer2026! – bitte ändern",
                               "keeper_url": "https://keepersecurity.eu/vault/#detail/abc"})
    db.insert("assets", {"customer_id": 1, "name": "SRV", "type": "server", "os": "Windows Server 2012 R2",
                         "remote_url": "https://app.atera.com/new/device/1", "keeper_url": "https://keepersecurity.eu/vault/#detail/x"})
    r = c.post("/api/bookstack/customer/1").json()
    assert r["pages"] == 4 and r["url"].startswith("https://wiki.meit.at/books/")
    fake = bs_app.state.fake_bs
    assert fake.books[0]["name"] == "IT-Doku: Tischlerei Huber GmbH"
    pages = {p["name"]: p["markdown"] for p in fake.pages}
    assert "Sommer2026" not in pages["Übersicht"] and "•••• (in Keeper)" in pages["Übersicht"]
    assert "[Keeper-Ordner öffnen](https://keepersecurity.eu/vault/#detail/abc)" in pages["Übersicht"]
    assert "[Atera](https://app.atera.com/new/device/1)" in pages["Geräte"] and "ohne Herstellersupport" in pages["Geräte"]
    c.post("/api/bookstack/customer/1")
    assert len(fake.pages) == 4  # aktualisiert statt dupliziert
    assert c.get("/api/customers/1").json()["bookstack_url"] == r["url"]


def test_bookstack_kb_push_and_pull(bs_app):
    c = TestClient(bs_app)
    db = bs_app.state.ctx.db
    c.put("/api/bookstack/settings", json={"push_customers": False, "import_books": ["ME-IT Wissensdatenbank", "Anleitungen"]})
    r = c.post("/api/bookstack/sync").json()
    n_kb = db.scalar("SELECT COUNT(*) FROM kb_articles WHERE source = 'cockpit'")
    assert r["kb_pushed"] == n_kb and r["kb_imported"] == 0  # eigene Seiten werden nicht re-importiert
    fake = bs_app.state.fake_bs
    # im Wiki von Hand angelegte Anleitung → wird als KI-Wissen übernommen
    fake.books.append({"id": 900, "name": "Anleitungen", "slug": "anleitungen"})
    fake.pages.append({"id": 901, "book_id": 900, "name": "VPN einrichten (FortiClient)", "slug": "vpn",
                       "markdown": "1. FortiClient installieren\n2. Server vpn.kunde.at\nPSK: geheimesPSK123",
                       "tags": [], "updated_at": "2026-11-17T11:00:00.000000Z"})
    r = c.post("/api/bookstack/sync").json()
    assert r["kb_pushed"] == 0 and r["kb_imported"] == 1
    art = next(a for a in c.get("/api/kb").json() if a["title"].startswith("VPN"))
    assert art["source"] == "bookstack" and art["external_url"] == "https://wiki.meit.at/books/anleitungen/page/vpn"
    assert "geheimesPSK123" not in art["content"]
    assert c.put(f"/api/kb/{art['id']}", json={"title": "x", "content": "y"}).status_code == 409
    ok = c.put(f"/api/kb/{art['id']}", json={"title": art["title"], "content": art["content"], "public": True})
    assert ok.status_code == 200 and ok.json()["public"] == 1
    assert c.post("/api/bookstack/sync").json()["kb_updated"] == 0
    fake.pages = [p for p in fake.pages if p["id"] != 901]
    assert c.post("/api/bookstack/sync").json()["kb_removed"] == 1


def test_bookstack_settings_validation(bs_app):
    c = TestClient(bs_app)
    assert c.put("/api/bookstack/settings", json={"customer_book": "Doku"}).status_code == 422


# ------------------------------------------------------------------ Keeper & Passwort-Wächter
def test_secret_detection():
    assert find_secrets("Admin-Passwort: Sommer2026!") and not find_secrets("Kunde hat Passwort vergessen")
    assert not find_secrets("Passwort ist nicht korrekt") and not find_secrets("Rechnung 2026-0001")
    assert redact("WLAN-Key = abcd1234efgh, Router 192.168.1.1") == "WLAN-Key = •••• (in Keeper), Router 192.168.1.1"
    assert "PRIVATE KEY" in redact("-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----")
    assert "MIIEv" not in redact("-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----")


def test_keeper_links_https_only_and_scan(client, app):
    c = client.get("/api/customers/1").json()
    payload = {k: c[k] for k in ("name", "contact_name", "email", "phone", "address", "industry", "employees", "package",
                                 "mrr", "contract_end", "notes", "uid", "supplier_no")}
    payload["booked_services"] = c["booked_services"]
    assert client.put("/api/customers/1", json={**payload, "keeper_url": "javascript:alert(1)"}).status_code == 422
    ok = client.put("/api/customers/1", json={**payload, "keeper_url": "https://keepersecurity.eu/vault/#detail/abc"})
    assert ok.status_code == 200 and ok.json()["keeper_url"].startswith("https://keepersecurity.eu")
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "VPN geht nicht",
                                            "description": "Zugang: user max, Passwort: Geheim#2026"}).json()["id"]
    found = client.get("/api/security/secrets").json()
    hit = next(f for f in found["findings"] if f["table"] == "tickets" and f["id"] == tid)
    assert hit["field"] == "description" and "Geheim#2026" not in hit["preview"]
    assert client.post("/api/security/secrets/redact", json={"table": "tickets", "id": tid, "field": "description"}).json()["changed"]
    assert "Geheim#2026" not in client.get(f"/api/tickets/{tid}").json()["description"]
    assert client.post("/api/security/secrets/redact", json={"table": "users", "id": 1, "field": "password_hash"}).status_code == 422


def test_cloud_llm_gets_redacted_text(settings, monkeypatch):
    from meit.llm import AnthropicLLM, OpenAICompatLLM

    sent = {}

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)

            class R:
                content = [type("B", (), {"type": "text", "text": "ok"})()]
                stop_reason = "end_turn"
            return R()

    llm = AnthropicLLM(settings)
    beta = type("Beta", (), {"messages": FakeMessages()})()
    monkeypatch.setattr(llm, "_get_client", lambda: type("C", (), {"beta": beta})())
    assert llm.chat([{"role": "user", "content": "Server-Passwort: Sommer2026! – was tun?"}], system="pw=abc12345") == "ok"
    assert sent["messages"][0]["content"] == "Server-Passwort: •••• (in Keeper) – was tun?"
    assert sent["system"] == "pw=•••• (in Keeper)"
    local = OpenAICompatLLM(dataclasses.replace(settings, openai_base_url="http://localhost:1234/v1"))
    assert local.local is True  # lokale Modelle bekommen den Originaltext (bleibt im Haus)
