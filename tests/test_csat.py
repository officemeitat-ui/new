"""Kundenzufriedenheit: Umfrage beim Lösen, 1-Klick-Bewertung, Rückruf bei schlechter Bewertung, Kennzahlen."""

from __future__ import annotations

import dataclasses
import re

import pytest
from fastapi.testclient import TestClient

from meit.main import create_app


class FakeMailer:
    imap_configured = smtp_configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body, in_reply_to="", reply_handle="", attachments=None, html="", cc=""):
        self.sent.append({"to": to, "subject": subject, "body": body, "html": html})
        return "<x@test>"


@pytest.fixture()
def mail_app(settings):
    app = create_app(dataclasses.replace(settings, public_url="https://cockpit.meit.at"))
    app.state.ctx.mailer = FakeMailer()
    return app


def _ticket(c, customer_id=1, title="Drucker druckt nicht", **kw) -> int:
    return c.post("/api/tickets", json={"customer_id": customer_id, "title": title, "description": "x", **kw}).json()["id"]


def _resolve(c, tid):
    r = c.put(f"/api/tickets/{tid}", json={"status": "geloest", "solution": "Treiber neu"})
    assert r.status_code == 200
    return r.json()


def test_survey_without_public_url_is_portal_only(client):
    tid = _ticket(client)
    _resolve(client, tid)
    t = client.get(f"/api/tickets/{tid}").json()
    assert t["csat"] and t["csat"]["sent_at"] == "" and t["csat"]["rating"] is None


def test_mail_one_click_rating_and_followup(mail_app):
    c = TestClient(mail_app)
    tid = _ticket(c)
    _resolve(c, tid)
    mail = mail_app.state.ctx.mailer.sent[0]
    assert mail["to"] == "office@huber-demo.at" and "Drucker druckt nicht" in mail["subject"]
    token = re.search(r"/bewertung\?t=([\w-]+)&r=5", mail["body"]).group(1)
    assert mail["html"].count("/bewertung?t=") == 5 and mail["html"].index("😀") < mail["html"].index("Freundliche Grüße")
    assert c.get("/bewertung").status_code == 200
    info = c.get(f"/api/public/csat/{token}").json()
    assert info["title"] == "Drucker druckt nicht" and info["rating"] is None
    assert c.post(f"/api/public/csat/{token}", json={"rating": 5}).json()["rating"] == 5
    assert c.get(f"/api/tickets/{tid}").json()["csat"]["rating"] == 5
    # schlechte Bewertung → genau ein Rückruf-Ticket
    tid2 = _ticket(c, title="VPN langsam")
    _resolve(c, tid2)
    token2 = re.search(r"t=([\w-]+)&r=1", mail_app.state.ctx.mailer.sent[1]["body"]).group(1)
    c.post(f"/api/public/csat/{token2}", json={"rating": 2})
    c.post(f"/api/public/csat/{token2}", json={"rating": 1, "comment": "Hat zwei Tage gedauert"})
    follow = [t for t in c.get("/api/tickets").json() if t["title"].startswith("Kundenfeedback:")]
    assert len(follow) == 1 and follow[0]["priority"] == "hoch"
    assert "zwei Tage" in c.get(f"/api/tickets/{follow[0]['id']}").json()["description"]
    # das Rückruf-Ticket selbst löst keine weitere Umfrage aus
    _resolve(c, follow[0]["id"])
    assert len(mail_app.state.ctx.mailer.sent) == 2
    assert c.get("/api/public/csat/unbekannt-token-123456").status_code == 404
    assert c.post(f"/api/public/csat/{token}", json={"rating": 9}).status_code == 422


def test_no_survey_for_maintenance_and_rmm(mail_app):
    c = TestClient(mail_app)
    for title, cat in (("Wartung: Patch-Status", "Wartung"), ("RMM: Backup fehlgeschlagen", "")):
        tid = _ticket(c, title=title, category=cat)
        _resolve(c, tid)
        assert c.get(f"/api/tickets/{tid}").json()["csat"] is None
    assert mail_app.state.ctx.mailer.sent == []


def test_portal_rating_and_kpis(client, app):
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]})
    open_tid = _ticket(client, title="Noch offen")
    assert portal.post(f"/api/portal/tickets/{open_tid}/rating", json={"rating": 5}).status_code == 404
    other = _ticket(client, customer_id=2, title="Fremd")
    _resolve(client, other)
    assert portal.post(f"/api/portal/tickets/{other}/rating", json={"rating": 5}).status_code == 404
    for title in ("A", "B"):
        tid = _ticket(client, title=title)
        _resolve(client, tid)
        assert portal.post(f"/api/portal/tickets/{tid}/rating", json={"rating": 5}).json()["rating"] == 5
    rows = {t["title"]: t for t in portal.get("/api/portal/tickets").json()}
    assert rows["A"]["rating"] == 5
    factors = client.get("/api/customers/1").json()["health"]["factors"]
    assert any("Zufriedenheit sehr hoch" in f["text"] and f["delta"] == 5 for f in factors)
    assert "Ihre Zufriedenheit: **Ø 5,0 von 5**" in client.post("/api/agents/report", json={"customer_id": 1}).json()["text"]
    assert "Zufriedenheit Ihrer Mitarbeiter" in client.post("/api/agents/qbr", json={"customer_id": 1}).json()["text"]
    ov = client.get("/api/csat").json()
    assert ov["count"] == 2 and ov["avg"] == 5 and ov["positive_pct"] == 100
    assert client.put("/api/csat/settings", json={"low_threshold": 3}).json()["low_threshold"] == 3
