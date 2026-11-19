"""Sicherheitslage je Kunde, Benachrichtigungen (Glocke/E-Mail/Teams) und Sicherheitsprotokoll."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx
from fastapi.testclient import TestClient

from meit.notify import teams_card
from test_backups_domains import GOOD, FakeResolver, cert
from test_inventory import snapshot


class FakeMailer:
    imap_configured = smtp_configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body, **kw):
        self.sent.append({"to": to, "subject": subject, "body": body})
        return "<id@test>"

    def fetch_unseen(self, limit=25):
        return []


# ----------------------------------------------------------------------------- Sicherheitslage
def _fill_sources(app, client, cid=1):
    """Geräte-Check, Sicherung und Domain für einen Kunden mit Testdaten füllen."""
    k = client.post("/api/inventory/keys", json={"customer_id": cid}).json()["key"]
    agent = TestClient(app)
    for host, over in (("NB01", {}), ("NB02", {"bitlocker": {"os_drive": "off"}}),
                       ("PC03", {"chassis": "desktop", "bitlocker": {"os_drive": "off"}})):
        e = agent.post("/api/public/agent/enroll", json={"key": k, "hostname": host, "serial": f"S-{host}"}).json()
        agent.post("/api/public/agent/checkin", json=snapshot(hostname=host, serial=f"S-{host}", **over),
                   headers={"Authorization": f"Bearer {e['token']}"})
    bk = app.state.backups
    now = datetime.now().replace(microsecond=0)
    for d, st in ((3, "ok"), (2, "ok"), (1, "fehler"), (0, "ok")):
        bk.record({"source": "veeam", "job": "Server", "host": "", "status": st, "details": ""}, customer_id=cid,
                  sender="veeam@huber-demo.at", at=(now - timedelta(days=d)).isoformat(sep=" "))
    dom = app.state.domains
    dom.resolver_factory = lambda: FakeResolver(txt={**GOOD.t, "_dmarc.huber-demo.at": []}, mx=GOOD.m, cname=GOOD.c)
    dom.cert_fetch = cert(200)
    did = dom.add(cid, "huber-demo.at")
    dom.check(did)


def test_posture_score_areas_and_history(app, client):
    empty = client.get("/api/posture/4").json()
    assert empty["coverage"] <= 1 and [a["key"] for a in empty["areas"]] == ["m365", "devices", "backup", "mail", "org"]
    assert next(a for a in empty["areas"] if a["key"] == "m365")["hint"].startswith("Microsoft 365 verbinden")
    _fill_sources(app, client)
    p = client.get("/api/posture/1").json()
    areas = {a["key"]: a for a in p["areas"]}
    assert areas["devices"]["score"] == round((100 + 78 + 90) / 3) and areas["devices"]["note"] == "1 von 3 ohne Befund"
    assert areas["backup"]["score"] == round(0.5 * 100 + 0.5 * 75) and areas["mail"]["score"] == 80
    assert areas["m365"]["score"] is None and areas["m365"]["level"] == "unbekannt"
    assert p["coverage"] >= 3 and p["level"] in ("gut", "mittel")
    titles = [m["title"] for m in p["measures"]]
    assert "Festplatte nicht verschlüsselt – 2 Geräte" in titles and "huber-demo.at: Kein DMARC" in titles
    assert p["measures"][0]["severity"] == "hoch" and p["counts"]["hoch"] >= 2
    # Verlauf: Vormonat eintragen → Trend
    db = app.state.ctx.db
    prev = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    db.insert("posture_history", {"customer_id": 1, "month": prev, "score": p["score"] - 12, "areas": {}})
    again = client.get("/api/posture/1").json()
    assert again["trend"] == 12 and [h["month"] for h in again["history"]][-2:] == [prev, date.today().strftime("%Y-%m")]
    assert db.scalar("SELECT COUNT(*) FROM posture_history WHERE customer_id = 1") == 2  # je Monat ein Eintrag
    # ein kritischer Befund deckelt die Gesamtnote
    k = client.post("/api/inventory/keys", json={"customer_id": 1}).json()["key"]
    agent = TestClient(app)
    e = agent.post("/api/public/agent/enroll", json={"key": k, "hostname": "PC09", "serial": "S9"}).json()
    agent.post("/api/public/agent/checkin", headers={"Authorization": f"Bearer {e['token']}"},
               json=snapshot(hostname="PC09", serial="S9", antivirus=[], defender={"realtime": False}))
    crit = client.get("/api/posture/1").json()
    assert crit["counts"]["kritisch"] == 1 and crit["score"] <= 59 and crit["level"] == "kritisch"


def test_posture_overview_report_quote_portal(app, client):
    _fill_sources(app, client)
    ov = client.get("/api/posture").json()
    row = next(r for r in ov["customers"] if r["customer_id"] == 1)
    assert row["areas"]["devices"] == 89 and row["coverage"] >= 3 and ov["summary"]["avg"] is not None
    assert ov["customers"][-1]["score"] is None or ov["customers"][0]["score"] <= ov["customers"][-1]["score"]
    r = client.get("/api/posture/1/report").json()
    text = r["text"]
    assert text.startswith("# IT-Sicherheitsbericht – Tischlerei Huber GmbH") and "## Gesamtbewertung" in text
    assert "| Geräte | 89 |" in text and "| Identität & Microsoft 365 | – | ⚪ unbekannt |" in text
    assert "## Handlungsbedarf – bitte zeitnah" in text and "Festplatte nicht verschlüsselt – 2 Geräte" in text
    assert "## Noch nicht erfasst" in text and "Microsoft 365 verbinden" in text
    pdf = client.get("/api/posture/1/report.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF" and len(pdf.content) > 3000
    q = client.post("/api/posture/1/quote")
    assert q.status_code == 201, q.text
    quote = q.json()
    assert quote["items"] and "IT-Sicherheitsbericht" in client.get("/api/quotes").json()[0]["need"]
    assert client.get("/api/posture/9999").status_code == 404
    # Kunde ohne Maßnahmen → kein Angebot
    new = client.post("/api/customers", json={"name": "Leer GmbH", "email": "office@leer-firma.at"}).json()
    assert client.post(f"/api/posture/{new['id']}/quote").status_code == 409
    assert "fehlen noch die Datenquellen" in client.get(f"/api/posture/{new['id']}/report").json()["text"]
    # Kundenportal: Note und wichtigste Maßnahmen, keine internen Details
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]})
    pv = portal.get("/api/portal/posture").json()["posture"]
    assert pv["score"] == r["score"] and len(pv["areas"]) == 5 and all(set(m) == {"title", "severity", "action"} for m in pv["measures"])


# ----------------------------------------------------------------------------- Benachrichtigungen
def test_notifications_scan_channels_and_bell(app, client, monkeypatch):
    mailer = FakeMailer()
    app.state.ctx.mailer = mailer
    posts = []
    monkeypatch.setattr(httpx, "post", lambda url, json=None, timeout=None, **kw: (posts.append((url, json)),
                                                                                    type("R", (), {"status_code": 202})())[1])
    assert client.get("/api/notifications").json() == {"unread": 0, "items": []}  # Bestand (Demo-Tickets) wird nicht gemeldet
    assert client.put("/api/notifications/settings", json={"teams_webhook": "http://unsicher"}).status_code == 422
    s = client.put("/api/notifications/settings", json={"email_to": "technik@me-it.test",
                                                        "teams_webhook": "https://prod.westeurope.logic.azure.com/workflows/abc"}).json()
    assert s["teams_set"] and s["teams_webhook"] == "" and s["teams_hint"] == "prod.westeurope.logic.azure.com" and s["mail_available"]
    low = client.post("/api/tickets", json={"customer_id": 1, "title": "Maus kaputt", "priority": "niedrig"}).json()
    t = client.post("/api/tickets", json={"customer_id": 1, "title": "Server brennt", "priority": "kritisch"}).json()
    n = client.get("/api/notifications").json()
    assert n["unread"] == 1 and n["items"][0]["title"] == f"🔴 #{t['id']} Server brennt" and n["items"][0]["link"] == f"tickets?ticket={t['id']}"
    assert str(low["id"]) not in n["items"][0]["title"]
    assert len(mailer.sent) == 1 and mailer.sent[0]["to"] == "technik@me-it.test" and mailer.sent[0]["subject"].startswith("[Cockpit] 🔴")
    assert f"/#/tickets?ticket={t['id']}" in mailer.sent[0]["body"]
    card = posts[0][1]["attachments"][0]["content"]
    assert posts[0][0].startswith("https://prod.westeurope") and card["type"] == "AdaptiveCard" and "Server brennt" in card["body"][0]["text"]
    assert card["actions"][0]["url"].endswith(f"/#/tickets?ticket={t['id']}")
    # dasselbe Ticket wird nie doppelt gemeldet
    assert client.get("/api/notifications").json()["unread"] == 1 and len(mailer.sent) == 1 and len(posts) == 1
    # Kundenportal-Kommentar → Glocke (ohne Mail/Teams laut Standard)
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]})
    portal.post(f"/api/portal/tickets/{t['id']}/comment", json={"text": "Es raucht schon!"})
    n = client.get("/api/notifications").json()
    assert n["unread"] == 2 and n["items"][0]["kind"] == "portal" and "Es raucht schon!" in n["items"][0]["body"] and len(mailer.sent) == 1
    assert client.post("/api/notifications/read", json={"ids": [n["items"][0]["id"]]}).json()["updated"] == 1
    assert client.get("/api/notifications?unread=true").json()["unread"] == 1
    assert client.post("/api/notifications/read", json={}).json()["updated"] == 1
    # Test-Knopf meldet je Kanal das Ergebnis; Kanal abschalten
    assert client.post("/api/notifications/test").json()["channels"] == {"app": "ok", "email": "ok", "teams": "ok"}
    client.put("/api/notifications/settings", json={"events": {"ticket": {"email": False, "teams": False}}, "min_priority": "kritisch"})
    client.post("/api/tickets", json={"customer_id": 1, "title": "Nur hoch", "priority": "hoch"})
    client.post("/api/tickets", json={"customer_id": 1, "title": "Wieder kritisch", "priority": "kritisch"})
    before = len(mailer.sent)
    n = client.get("/api/notifications?unread=true").json()
    assert [i["title"].split(" ", 2)[2] for i in n["items"] if i["kind"] == "ticket"] == ["Wieder kritisch"] and len(mailer.sent) == before
    assert teams_card("T", "B")["attachments"][0]["content"].get("actions") is None


def test_security_notifications_and_digest(app, client):
    mailer = FakeMailer()
    app.state.ctx.mailer = mailer
    client.put("/api/notifications/settings", json={"email_to": "chef@me-it.test", "digest": {"enabled": True, "hour": 7}})
    client.post("/api/users", json={"name": "Chef", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    for _ in range(5):
        assert TestClient(app).post("/api/auth/login", json={"email": "chef@me-it.test", "password": "falsch"}).status_code == 401
    admin = TestClient(app)
    assert admin.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    n = admin.get("/api/notifications").json()
    sec = [i for i in n["items"] if i["kind"] == "security"]
    assert len(sec) == 1 and "5 fehlgeschlagene Anmeldungen: chef@me-it.test" in sec[0]["title"] and sec[0]["severity"] == "hoch"
    assert any("fehlgeschlagene Anmeldungen" in m["subject"] for m in mailer.sent)
    # Tagesstart: nur einmal pro Tag, erst ab der eingestellten Stunde
    notifier = app.state.notifier
    app.state.backups.record({"source": "veeam", "job": "Server", "host": "", "status": "fehler", "details": ""}, customer_id=1)
    d = admin.get("/api/notifications/digest").json()
    assert "Datensicherung: 1 Problem(e)" in d["text"] and "Server (fehler)" in d["text"] and d["urgent"] >= 1
    today = datetime.now().replace(hour=6, minute=0)
    count = len(mailer.sent)
    assert notifier.maybe_send_digest(today) is False
    assert notifier.maybe_send_digest(today.replace(hour=8)) is True and notifier.maybe_send_digest(today.replace(hour=9)) is False
    assert len(mailer.sent) == count + 1 and mailer.sent[-1]["subject"].startswith("[Cockpit] Tagesstart")


# ----------------------------------------------------------------------------- Sicherheitsprotokoll
def test_audit_log(app, client):
    db = app.state.ctx.db
    client.post("/api/users", json={"name": "Chef", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    assert TestClient(app).post("/api/auth/login", json={"email": "wer@anders.test", "password": "x"}).status_code == 401
    assert TestClient(app).post("/api/auth/login", json={"email": "chef@me-it.test", "password": "falsch"}).status_code == 401
    admin = TestClient(app)
    admin.post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"})
    admin.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"})
    admin.get("/api/receipts/export.csv")
    admin.post("/api/inventory/keys", json={"customer_id": 1})
    admin.put("/api/users/1", json={"name": "Chef", "email": "chef@me-it.test", "role": "technik", "active": True})  # scheitert (letzter Admin)
    TestClient(app).post("/api/portal/login", json={"email": "franz@huber-demo.at", "password": "falsch"})
    data = admin.get("/api/audit").json()
    actions = [(e["action"], bool(e["ok"])) for e in data["entries"]]
    for expected in (("Anmeldung", True), ("Anmeldung fehlgeschlagen", False), ("Portal-Zugang angelegt", True), ("Belege exportiert", True),
                     ("Agent-Registrierungsschlüssel erzeugt", True), ("Benutzer geändert", False), ("Anmeldung fehlgeschlagen (Portal)", False)):
        assert expected in actions, expected
    login = next(e for e in data["entries"] if e["action"] == "Anmeldung")
    assert login["actor"] == "Chef" and login["target"] == "chef@me-it.test" and login["ip"]
    unknown = next(e for e in data["entries"] if e["detail"] == "unbekanntes Konto")
    assert unknown["target"] == "wer@anders.test"
    assert "Sehr-Geheim-2026" not in str(data) and "falsch" not in [e["detail"] for e in data["entries"]]  # nie Passwörter im Protokoll
    assert data["summary"]["logins_30d"] == 1 and data["summary"]["failed_30d"] == 3
    assert len(admin.get("/api/audit?failed=true").json()["entries"]) == 4
    assert all("Portal" in e["action"] or "portal" in e["target"] for e in admin.get("/api/audit?q=Portal").json()["entries"])
    csv_text = admin.get("/api/audit/export.csv").text
    assert csv_text.startswith("﻿Zeit;Wer;Adresse;Aktion") and "Belege exportiert" in csv_text
    assert any(e["action"] == "Sicherheitsprotokoll exportiert" for e in admin.get("/api/audit").json()["entries"])
    # nur Admins sehen das Protokoll; alte Einträge werden nach 400 Tagen entfernt
    admin.post("/api/users", json={"name": "Tech", "email": "tech@me-it.test", "role": "technik", "password": "Auch-Geheim-2026"})
    tech = TestClient(app)
    tech.post("/api/auth/login", json={"email": "tech@me-it.test", "password": "Auch-Geheim-2026"})
    assert tech.get("/api/audit").status_code == 403
    db.insert("audit_log", {"at": "2020-01-01 00:00:00", "action": "uralt"})
    from meit.audit import cleanup

    cleanup(db)
    assert db.scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'uralt'") == 0
