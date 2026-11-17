"""KI-Mitarbeiter: Posteingang, Leads, Belege, Nachfassen, Mail, Anfrageformular."""

import dataclasses
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from meit.agents.inbox import create_followups, parse_receipt, rule_classify, rule_qualification
from meit.mail import parse_raw
from meit.main import create_app


class FakeMailer:
    imap_configured = True
    smtp_configured = True

    def __init__(self, inbox=None):
        self.sent = []
        self.inbox = inbox or []

    def send(self, to, subject, body, in_reply_to="", reply_handle="", attachments=None, html="", cc=""):
        self.sent.append({"to": to, "subject": subject, "body": body, "in_reply_to": in_reply_to,
                          "reply_handle": reply_handle, "attachments": attachments or [], "html": html, "cc": cc})
        return f"<sent-{len(self.sent)}@test>"

    def fetch_unseen(self, limit=25):
        mails, self.inbox = self.inbox, []
        return mails


def _process_demo(client):
    r = client.post("/api/inbox/process-new").json()
    assert r == {"processed": 5, "failed": 0}
    return {m["subject"]: m for m in client.get("/api/inbox?direction=in").json()}


def test_demo_inbox_is_sorted_and_routed(client):
    msgs = _process_demo(client)
    support = msgs["Outlook geht schon wieder nicht"]
    assert support["category"] == "support" and support["linked_type"] == "ticket"
    assert support["customer_id"] == 1  # Domain huber-demo.at → Tischlerei Huber
    assert "Ticketnummer" in support["draft_reply"]
    ticket = client.get(f"/api/tickets/{support['linked_id']}").json()
    assert ticket["category"] == "E-Mail/M365"

    inquiry = msgs["Webanfrage: Neuer IT-Partner gesucht"]
    assert inquiry["category"] == "anfrage" and inquiry["status"] == "freigabe"
    lead = client.get(f"/api/leads/{inquiry['linked_id']}").json()
    assert lead["company"] == "Wagner Logistik GmbH" and lead["qualification"]["mitarbeiter"] == 25
    assert lead["score"] >= 60
    assert "Wie viele Arbeitsplätze" not in inquiry["draft_reply"]  # schon bekannt → nicht nachfragen

    receipt_msg = msgs["Ihre Rechnung RE-2026-1187"]
    assert receipt_msg["category"] == "beleg"
    receipt = client.get("/api/receipts").json()[0]
    assert receipt["amount"] == 1284.0 and receipt["invoice_no"] == "RE-2026-1187" and receipt["invoice_date"] == "2026-11-03"

    assert msgs["Webinar: Neue Firewall-Features 2027"]["status"] == "erledigt"  # Info läuft im Autopilot
    callback = msgs["Rückruf wegen KI für unsere Kanzlei"]
    assert callback["category"] == "termin" and callback["linked_type"] == "lead"


def test_reprocessing_does_not_duplicate(client):
    msgs = _process_demo(client)
    mid = msgs["Webanfrage: Neuer IT-Partner gesucht"]["id"]
    leads_before = len(client.get("/api/leads").json())
    client.post(f"/api/inbox/{mid}/process")
    assert len(client.get("/api/leads").json()) == leads_before


def test_approve_without_smtp_requires_manual(client):
    msgs = _process_demo(client)
    mid = msgs["Webanfrage: Neuer IT-Partner gesucht"]["id"]
    assert client.post(f"/api/inbox/{mid}/approve", json={"text": "Hallo"}).status_code == 409
    r = client.post(f"/api/inbox/{mid}/approve", json={"text": "Hallo", "manual": True}).json()
    assert r["sent"] is False and r["status"] == "beantwortet"
    lead = client.get(f"/api/leads/{msgs['Webanfrage: Neuer IT-Partner gesucht']['linked_id']}").json()
    assert lead["last_contact_at"]


def test_approve_sends_via_smtp_and_beleg_approval(app, client):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    msgs = _process_demo(client)
    msg = msgs["Webanfrage: Neuer IT-Partner gesucht"]
    r = client.post(f"/api/inbox/{msg['id']}/approve", json={"text": "Danke für Ihre Anfrage!"}).json()
    assert r["sent"] is True
    assert fake.sent[0]["to"] == "s.wagner@wagner-logistik-demo.at"
    assert fake.sent[0]["subject"].startswith("Re: ")
    detail = client.get(f"/api/inbox/{msg['id']}").json()
    assert detail["status"] == "beantwortet" and detail["thread"][0]["body"] == "Danke für Ihre Anfrage!"
    beleg = msgs["Ihre Rechnung RE-2026-1187"]
    assert client.post(f"/api/inbox/{beleg['id']}/approve", json={}).json()["status"] == "erledigt"
    assert client.get("/api/receipts").json()[0]["status"] == "geprueft"


def test_autopilot_sends_automatically(app, client):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    client.put("/api/ki-mitarbeiter/modes", json={"modes": {"anfrage": "autopilot", "unsinn": "autopilot"}})
    modes = client.get("/api/ki-mitarbeiter/overview").json()["modes"]
    assert modes["anfrage"] == "autopilot" and "unsinn" not in modes
    m = client.post("/api/inbox", json={"from_name": "Eva Neu", "from_email": "eva@neu-demo.at",
                                         "subject": "Angebot für IT-Betreuung", "body": "Wir brauchen ein Angebot für 8 PCs."}).json()
    assert m["status"] == "beantwortet"
    assert fake.sent and fake.sent[0]["to"] == "eva@neu-demo.at"
    ov = client.get("/api/ki-mitarbeiter/overview").json()
    assert ov["auto_handled"] >= 1


def test_imap_fetch_dedupes(app, client):
    raw = (b"From: =?utf-8?q?J=C3=BCrgen_Test?= <juergen@kunde-demo.at>\r\nTo: office@me-it.at\r\n"
           b"Subject: Drucker geht nicht\r\nMessage-ID: <abc-1@kunde-demo.at>\r\n"
           b"Content-Type: text/plain; charset=utf-8\r\n\r\nDer Drucker druckt nicht mehr.\r\n> alte Mail\r\n")
    fake = FakeMailer(inbox=[parse_raw(raw), parse_raw(raw)])
    app.state.ctx.mailer = fake
    r = client.post("/api/inbox/fetch").json()
    assert r == {"fetched": 2, "new": 1, "errors": 0, "archived": 0, "threaded": 0}
    m = client.get("/api/inbox?direction=in").json()[0]
    assert m["from_name"] == "Jürgen Test" and "alte Mail" not in m["body"]


def test_fetch_without_imap_config(client):
    assert client.post("/api/inbox/fetch").status_code == 409


def test_followups_for_sent_quotes(app, client):
    q = client.post("/api/agents/quote", json={"customer_id": 2, "need": "Backup"}).json()
    client.put(f"/api/quotes/{q['id']}", json={"status": "versendet"})
    ctx = app.state.ctx
    assert create_followups(ctx) == []  # noch nicht fällig
    later = datetime.now() + timedelta(days=6)
    created = create_followups(ctx, now=later)
    assert [c["type"] for c in created] == ["quote"]
    assert create_followups(ctx, now=later) == []  # offener Entwurf → kein zweiter
    draft = client.get("/api/inbox?status=freigabe&direction=out").json()[0]
    assert draft["to_email"] == "kanzlei@gruber-demo.at" and draft["category"] == "nachfassen"


def test_lead_convert_and_won_on_accept(client):
    msgs = _process_demo(client)
    lead_id = msgs["Webanfrage: Neuer IT-Partner gesucht"]["linked_id"]
    assert client.put(f"/api/leads/{lead_id}", json={"stage": "pitch"}).json()["stage"] == "pitch"
    assert client.put(f"/api/leads/{lead_id}", json={"stage": "egal"}).status_code == 422
    cid = client.post(f"/api/leads/{lead_id}/convert").json()["customer_id"]
    customer = client.get(f"/api/customers/{cid}").json()
    assert customer["name"] == "Wagner Logistik GmbH" and customer["employees"] == 25
    q = client.post("/api/agents/quote", json={"customer_id": cid, "need": "Managed", "service_codes": ["MW"]}).json()
    client.put(f"/api/quotes/{q['id']}", json={"status": "angenommen"})
    assert client.get(f"/api/leads/{lead_id}").json()["stage"] == "gewonnen"


def test_receipts_csv_export(client):
    _process_demo(client)
    rid = client.get("/api/receipts").json()[0]["id"]
    client.put(f"/api/receipts/{rid}", json={"status": "geprueft"})
    r = client.get("/api/receipts/export.csv?status=geprueft&mark=true")
    lines = r.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("Belegdatum;Lieferant")
    assert lines[1].startswith("03.11.2026;Distributor Demo GmbH;RE-2026-1187;1284,00;EUR")
    assert client.get("/api/receipts").json()[0]["status"] == "exportiert"


def test_public_inquiry_flow(settings):
    app = create_app(dataclasses.replace(settings, app_password="geheim", public_form_origins=("https://www.me-it-demo.at",)))
    c = TestClient(app)
    assert c.get("/api/inbox").status_code == 401  # intern geschützt
    assert c.get("/anfrage").status_code == 200  # Formular öffentlich
    body = {"name": "Max", "email": "max@firma-demo.at", "message": "Wir brauchen IT-Betreuung für 10 Leute"}
    r = c.post("/api/public/inquiry", json=body, headers={"Origin": "https://www.me-it-demo.at"})
    assert r.status_code == 201 and r.headers["access-control-allow-origin"] == "https://www.me-it-demo.at"
    assert c.options("/api/public/inquiry", headers={"Origin": "https://boese-demo.example"}).status_code == 403
    assert c.post("/api/public/inquiry", json={**body, "website": "spam"}).json() == {"ok": True}
    assert c.post("/api/public/inquiry", json={**body, "email": "kaputt"}).status_code == 422
    for _ in range(5):
        c.post("/api/public/inquiry", json=body)
    assert c.post("/api/public/inquiry", json=body).status_code == 429
    token = __import__("base64").b64encode(b"x:geheim").decode()
    msgs = c.get("/api/inbox?direction=in", headers={"Authorization": f"Basic {token}"}).json()
    web = [m for m in msgs if m["from_email"] == "max@firma-demo.at"]
    assert len(web) == 3  # 5 erlaubte Versuche, davon Honeypot und ungültige Mail nicht gespeichert
    assert all(m["category"] == "anfrage" for m in web)  # im Hintergrund bearbeitet


def test_rule_helpers():
    assert rule_classify("Rechnung 4711", "Betrag € 12,00", ["r.pdf"], "x@y.at", False) == "beleg"
    assert rule_classify("Newsletter", "Jetzt abmelden", [], "news@y.at", False) == "info"
    assert rule_classify("Bitte um Rückruf", "Rufen Sie mich zurück", [], "a@b.at", False) == "termin"
    assert rule_classify("Hilfe", "Outlook funktioniert nicht", [], "a@kunde.at", True) == "support"
    assert rule_classify("Angebot", "Was kostet eine Betreuung?", [], "a@neu.at", False) == "anfrage"
    assert rule_qualification("Wir sind 40 Mitarbeiter und brauchen das sofort") == {"mitarbeiter": 40, "zeitrahmen": "sofort"}
    r = parse_receipt("Rechnungsnummer: AB-12/3\nDatum 05.10.2026\nGesamtbetrag EUR 2.340,50\nMicrosoft Lizenz")
    assert (r["invoice_no"], r["invoice_date"], r["amount"], r["category"]) == ("AB-12/3", "2026-10-05", 2340.5, "Software/Lizenzen")


def test_parse_raw_html_and_attachment():
    raw = (b"From: Lieferant <rechnung@lief-demo.at>\r\nSubject: =?utf-8?q?Rechnung_M=C3=A4rz?=\r\nMIME-Version: 1.0\r\n"
           b"Content-Type: multipart/mixed; boundary=XX\r\n\r\n--XX\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
           b"<p>Hallo<br>Summe: 99,00 &euro;</p><script>x()</script>\r\n--XX\r\nContent-Type: application/pdf\r\n"
           b"Content-Disposition: attachment; filename=re.pdf\r\n\r\nJVBERi0=\r\n--XX--\r\n")
    m = parse_raw(raw)
    assert m.subject == "Rechnung März" and m.from_email == "rechnung@lief-demo.at"
    assert "Summe: 99,00 €" in m.body and "x()" not in m.body
    assert m.attachments == ["re.pdf"]
