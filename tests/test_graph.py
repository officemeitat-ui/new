"""Microsoft-365-Anbindung (Graph) mit gemockten HTTP-Aufrufen."""

import dataclasses

import httpx
import pytest

from meit.config import get_settings
from meit.mail import GraphMailer, MailError, Mailer, make_mailer


class Resp:
    def __init__(self, data=None, status=200):
        self._data, self.status_code = data or {}, status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            req = httpx.Request("GET", "https://graph.microsoft.com")
            raise httpx.HTTPStatusError("err", request=req, response=httpx.Response(self.status_code, json=self._data, request=req))


@pytest.fixture()
def settings():
    return dataclasses.replace(get_settings(), mail_provider="graph", graph_tenant_id="tenant", graph_client_id="app",
                               graph_client_secret="geheim", graph_mailbox="office@me-it-demo.at")


def test_factory(settings):
    assert isinstance(make_mailer(settings), GraphMailer)
    assert isinstance(make_mailer(dataclasses.replace(settings, mail_provider="imap")), Mailer)
    assert not GraphMailer(dataclasses.replace(settings, graph_client_secret="")).configured


def test_fetch_marks_read_and_reply_in_thread(settings, monkeypatch):
    calls = []

    def fake_post(url, data=None, timeout=None, **_):
        calls.append(("TOKEN", url, data["scope"]))
        return Resp({"access_token": "tok", "expires_in": 3600})

    def fake_request(method, url, headers=None, timeout=None, **kw):
        calls.append((method, url, kw.get("params"), kw.get("json"), headers.get("Authorization")))
        if method == "GET" and url.endswith("/mailFolders/inbox/messages"):
            return Resp({"value": [{
                "id": "AAMk1", "internetMessageId": "<m1@kunde>", "subject": "Server langsam", "hasAttachments": False,
                "from": {"emailAddress": {"name": "Eva Kunde", "address": "Eva@Kunde-Demo.at"}},
                "body": {"contentType": "text", "content": "Unser Server ist sehr langsam.\n> alt"}}]})
        return Resp({})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "request", fake_request)
    g = GraphMailer(settings)
    mails = g.fetch_unseen()
    assert len(mails) == 1
    m = mails[0]
    assert (m.from_email, m.message_id, m.handle, m.body) == ("eva@kunde-demo.at", "<m1@kunde>", "AAMk1",
                                                                "Unser Server ist sehr langsam.")
    assert ("PATCH", "https://graph.microsoft.com/v1.0/users/office%40me-it-demo.at/messages/AAMk1", None,
            {"isRead": True}, "Bearer tok") in calls
    assert sum(1 for c in calls if c[0] == "TOKEN") == 1  # Token wird wiederverwendet
    g.send("eva@kunde-demo.at", "Re: Server langsam", "Wir schauen uns das an.", reply_handle="AAMk1")
    assert calls[-1][0] == "POST" and calls[-1][1].endswith("/messages/AAMk1/reply")
    assert calls[-1][3] == {"comment": "Wir schauen uns das an."}
    g.send("neu@firma-demo.at", "Angebot", "Text")
    assert calls[-1][1].endswith("/sendMail") and calls[-1][3]["message"]["toRecipients"][0]["emailAddress"]["address"] == "neu@firma-demo.at"


def test_graph_errors_become_mail_error(settings, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Resp({"access_token": "t", "expires_in": 3600}))
    monkeypatch.setattr(httpx, "request", lambda *a, **k: Resp({"error": {"message": "Access is denied."}}, 403))
    with pytest.raises(MailError, match="403: Access is denied"):
        GraphMailer(settings).fetch_unseen()


def test_end_to_end_reply_uses_graph_handle(settings, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from meit.main import create_app

    sent = []

    def fake_request(method, url, headers=None, timeout=None, **kw):
        if method == "GET" and url.endswith("/messages"):
            return Resp({"value": [{"id": "G1", "internetMessageId": "<x1@neu>", "subject": "Anfrage IT-Betreuung",
                                    "hasAttachments": False, "from": {"emailAddress": {"name": "Neu", "address": "neu@firma-demo.at"}},
                                    "body": {"contentType": "text", "content": "Wir suchen ein Angebot für 9 Arbeitsplätze."}}]})
        if method == "POST":
            sent.append((url, kw.get("json")))
        return Resp({})

    monkeypatch.setattr(httpx, "post", lambda *a, **k: Resp({"access_token": "t", "expires_in": 3600}))
    monkeypatch.setattr(httpx, "request", fake_request)
    app = create_app(dataclasses.replace(settings, db_path=str(tmp_path / "g.db"), llm_provider="none", app_password=""))
    c = TestClient(app)
    assert c.post("/api/inbox/fetch").json()["new"] == 1
    msg = [m for m in c.get("/api/inbox?direction=in").json() if m["external_id"] == "<x1@neu>"][0]
    assert msg["category"] == "anfrage"
    r = c.post(f"/api/inbox/{msg['id']}/approve", json={"text": "Danke!"}).json()
    assert r["sent"] is True and sent[-1][0].endswith("/messages/G1/reply")
