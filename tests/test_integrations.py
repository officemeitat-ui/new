"""NinjaOne-Abgleich und M365-Terminvorschläge (HTTP gemockt)."""

import dataclasses
from datetime import datetime

import httpx
from fastapi.testclient import TestClient

from meit.config import get_settings
from meit.mail import GraphMailer
from meit.main import create_app
from meit.rmm import NinjaOne, sync


class Resp:
    def __init__(self, data, status=200):
        self._d, self.status_code = data, status

    def json(self):
        return self._d

    def raise_for_status(self):
        if self.status_code >= 400:
            req = httpx.Request("GET", "https://x")
            raise httpx.HTTPStatusError("err", request=req, response=httpx.Response(self.status_code, request=req))


ORGS = [{"id": 11, "name": "Tischlerei Huber GmbH"}, {"id": 12, "name": "Neu aus Ninja GmbH"}]
DEVICES = [
    {"id": 1, "organizationId": 11, "systemName": "HUBER-PC01", "nodeClass": "WINDOWS_WORKSTATION",
     "os": {"name": "Windows 11 Pro"}, "system": {"serialNumber": "SN1"}, "lastContact": 1763280000},
    {"id": 2, "organizationId": 12, "systemName": "NEU-SRV", "nodeClass": "WINDOWS_SERVER",
     "os": {"name": "Windows Server 2016 Standard"}, "system": {"serialNumber": "SN2"}, "lastContact": 1763280000},
    {"id": 3, "organizationId": 99, "systemName": "FREMD", "nodeClass": "MAC"},
]
ALERTS = [{"uid": "a-1", "deviceId": 2, "message": "Backup fehlgeschlagen", "severity": "CRITICAL"},
          {"uid": "a-2", "deviceId": 3, "message": "unbekanntes Gerät"}]


def _mock_ninja(monkeypatch, calls):
    monkeypatch.setattr(httpx, "post", lambda url, data=None, timeout=None, **k: (calls.append(("TOKEN", data["scope"])),
                                                                             Resp({"access_token": "t", "expires_in": 3600}))[1])

    def fake_get(url, headers=None, params=None, timeout=None, **k):
        calls.append(("GET", url, params))
        if url.endswith("/v2/organizations"):
            return Resp(ORGS)
        if url.endswith("/v2/devices-detailed"):
            return Resp(DEVICES if params.get("after") == 0 else [])
        if url.endswith("/v2/alerts"):
            return Resp(ALERTS)
        return Resp({}, 404)

    monkeypatch.setattr(httpx, "get", fake_get)


def test_ninja_sync(app, monkeypatch):
    calls = []
    _mock_ninja(monkeypatch, calls)
    db = app.state.ctx.db
    client = NinjaOne("https://eu.ninjarmm.com", "id", "secret")
    r = sync(db, client, alert_tickets=True)
    assert r["customers_created"] == ["Neu aus Ninja GmbH"] and r["assets_updated"] == 1 and r["assets_created"] == 1
    assert r["devices_unmapped"] == 1 and r["alert_tickets"] == 1
    assets = {a["name"]: a for a in db.query("SELECT * FROM assets")}
    assert assets["HUBER-PC01"]["os"] == "Windows 11 Pro" and assets["HUBER-PC01"]["serial"] == "SN1"
    assert assets["NEU-SRV"]["type"] == "server" and assets["NEU-SRV"]["last_seen"]
    t = db.query_one("SELECT * FROM tickets WHERE title LIKE 'RMM:%'")
    assert t["priority"] == "hoch" and t["category"] == "Server/Backup"
    again = sync(db, client, alert_tickets=True)
    assert again["alert_tickets"] == 0 and again["customers_created"] == [] and again["assets_created"] == 0
    assert sum(1 for c in calls if c[0] == "TOKEN") == 1  # Token wiederverwendet


def test_rmm_api_requires_config(client):
    assert client.get("/api/rmm/status").json()["configured"] is False
    assert client.post("/api/rmm/sync").status_code == 409


def test_rmm_api_sync(settings, monkeypatch):
    _mock_ninja(monkeypatch, [])
    app = create_app(dataclasses.replace(settings, ninja_url="https://eu.ninjarmm.com", ninja_client_id="i",
                                         ninja_client_secret="s"))
    c = TestClient(app)
    r = c.post("/api/rmm/sync").json()
    assert r["assets_created"] == 1 and c.get("/api/rmm/status").json()["last"]["assets_created"] == 1


def test_calendar_free_slots(monkeypatch):
    s = dataclasses.replace(get_settings(), mail_provider="graph", graph_tenant_id="t", graph_client_id="c",
                            graph_client_secret="s", graph_mailbox="office@me-it-demo.at")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Resp({"access_token": "t", "expires_in": 3600}))
    events = {"value": [
        {"start": {"dateTime": "2026-11-17T09:00:00.0000000"}, "end": {"dateTime": "2026-11-17T12:00:00.0000000"}, "showAs": "busy"},
        {"start": {"dateTime": "2026-11-18T09:00:00.0000000"}, "end": {"dateTime": "2026-11-18T10:00:00.0000000"}, "showAs": "free"},
    ]}
    monkeypatch.setattr(httpx, "request", lambda method, url, headers=None, timeout=None, **k: Resp(events))
    slots = GraphMailer(s).free_slots(now=datetime(2026, 11, 16, 15, 30))  # Mo 15:30 → frühestens 17:30
    assert slots == [datetime(2026, 11, 17, 12, 0), datetime(2026, 11, 18, 9, 0), datetime(2026, 11, 19, 9, 0)]


def test_reply_contains_calendar_slots(settings):
    class CalMailer:
        configured = imap_configured = smtp_configured = False
        provider = "graph"

        def free_slots(self):
            return [datetime(2026, 11, 17, 10, 0), datetime(2026, 11, 18, 9, 0)]

    app = create_app(dataclasses.replace(settings, graph_calendar=True))
    app.state.ctx.mailer = CalMailer()
    app.state.ctx.mailer.configured = True
    c = TestClient(app)
    m = c.post("/api/inbox", json={"from_name": "Neu", "from_email": "neu@firma-demo.at", "subject": "Rückruf bitte",
                                   "body": "Bitte rufen Sie mich zurück wegen IT-Betreuung."}).json()
    assert m["category"] == "termin"
    assert "Di, 17.11. um 10:00 Uhr" in m["draft_reply"] and "Mi, 18.11. um 09:00 Uhr" in m["draft_reply"]
