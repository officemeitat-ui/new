"""Backup-Wächter (Sicherungsberichte aus Mails) und Domain-/E-Mail-Sicherheitscheck."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient

from meit.backups import Backups, detect_report
from meit.domaincheck import check_domain, spf_lookups


# ----------------------------------------------------------------------------- Erkennung
@pytest.mark.parametrize("subject,body,expected", [
    ("[Success] Daily Backup Server (3 VMs)", "Veeam Backup & Replication", ("veeam", "Daily Backup Server", "ok")),
    ("[Failed] Agent Backup Job PC-Buchhaltung", "Veeam Agent for Windows", ("veeam", "PC-Buchhaltung", "fehler")),
    ("[Warning] Backup Copy Job Offsite", "", ("veeam", "Offsite", "warnung")),
    ("[HUBER-NAS] Backup task Cloud-Sicherung on HUBER-NAS has failed", "", ("synology", "Cloud-Sicherung", "fehler")),
    ("[HUBER-NAS] Die Sicherungsaufgabe „USB-Kopie“ wurde erfolgreich abgeschlossen", "", ("synology", "USB-Kopie", "ok")),
    ("[HUBER-NAS] Backup task Nacht was partially completed", "", ("synology", "Nacht", "warnung")),
    ("Backup failed: Maschine PC-07", "Acronis Cyber Protect Cloud", ("acronis", None, "fehler")),
    ("Datensicherung erfolgreich – Server HUBER-SRV01", "", ("allgemein", None, "ok")),
    ("Backup completed with 0 errors", "Datto", ("datto", None, "ok")),
])
def test_detect_reports(subject, body, expected):
    r = detect_report(subject, body, "backup@huber-demo.at")
    assert r is not None, subject
    source, job, status = expected
    assert (r["source"], r["status"]) == (source, status)
    if job:
        assert r["job"] == job


@pytest.mark.parametrize("subject,body", [
    ("Veeam Webinar: Neue Features in v13", "Jetzt anmelden"),
    ("Ihre Acronis-Lizenz läuft ab", "Backup verlängern"),
    ("Drucker druckt nicht", "Seit heute früh Fehler 0x0000"),
    ("Angebot Backup-Lösung", "Rabatt 20 %"),
])
def test_no_false_positives(subject, body):
    assert detect_report(subject, body, "info@hersteller-demo.com") is None


def eml(subject: str, sender="veeam@huber-demo.at", body="Veeam Backup & Replication report", msgid=None) -> bytes:
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = sender, "office@me-it.test", subject
    m["Message-ID"] = msgid or f"<{abs(hash(subject + str(datetime.now())))}@huber-demo.at>"
    m.set_content(body)
    return m.as_bytes()


def upload(client, subject, **kw):
    r = client.post("/api/inbox/upload", content=eml(subject, **kw), headers={"X-Filename": "bericht.eml"})
    assert r.status_code == 201, r.text
    return r.json()


# ----------------------------------------------------------------------------- Backup-Wächter
def test_backup_reports_from_inbox(app, client):
    db = app.state.ctx.db
    tickets_before = db.scalar("SELECT COUNT(*) FROM tickets")
    r = upload(client, "[Success] Server-Backup (2 VMs)")
    assert r["linked_type"] == "backup"
    m = client.get(f"/api/inbox/{r['message_id']}").json()
    assert m["status"] == "erledigt" and m["category"] == "info" and m["customer_id"] == 1
    assert db.scalar("SELECT COUNT(*) FROM tickets") == tickets_before  # Erfolgsbericht → kein Ticket
    job = client.get("/api/backups").json()["jobs"][0]
    assert job["name"] == "Server-Backup" and job["customer_id"] == 1 and job["last_status"] == "ok"

    # Fehler → genau ein Ticket, weiterer Fehler → Notiz
    upload(client, "[Failed] Server-Backup (2 VMs)")
    job = client.get("/api/backups").json()["jobs"][0]
    assert job["last_status"] == "fehler" and job["ticket_id"]
    t = client.get(f"/api/tickets/{job['ticket_id']}").json()
    assert t["title"] == "Backup fehlgeschlagen: Server-Backup" and t["priority"] == "hoch" and t["category"] == "Backup"
    upload(client, "[Failed] Server-Backup (2 VMs)")
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE category = 'Backup'") == 1
    conv = client.get(f"/api/tickets/{job['ticket_id']}/conversation").json()["messages"]
    assert any(x["internal"] and "Weiterer Bericht" in x["body"] for x in conv)

    # Folgesicherung erfolgreich → Ticket automatisch geschlossen
    upload(client, "[Success] Server-Backup (2 VMs)")
    t = client.get(f"/api/tickets/{job['ticket_id']}").json()
    assert t["status"] == "geloest" and "Folgesicherung" in t["solution"]
    job = client.get("/api/backups").json()["jobs"][0]
    assert job["ticket_id"] is None and job["last_status"] == "ok"
    assert client.get(f"/api/backups/jobs/{job['id']}/runs").json()[0]["status"] == "ok"
    assert len(client.get(f"/api/backups/jobs/{job['id']}/runs").json()) == 4

    # Monatsbericht enthält die Quote
    text = client.post("/api/agents/report", json={"customer_id": 1}).json()["text"]
    assert "Datensicherung: **2 von 4** Sicherungen erfolgreich (50 %)" in text


def test_backup_overdue_unassigned_and_settings(app, client):
    db = app.state.ctx.db
    svc: Backups = app.state.backups
    upload(client, "[NAS-UNBEKANNT] Backup task Nacht on NAS-UNBEKANNT has completed", sender="nas@fremd-demo.at",
           body="Synology Hyper Backup")
    job = client.get("/api/backups").json()["jobs"][0]
    assert job["customer_id"] is None and client.get("/api/backups").json()["summary"]["unassigned"] == 1
    assert client.put(f"/api/backups/jobs/{job['id']}", json={"customer_id": 9999}).status_code == 422
    client.put(f"/api/backups/jobs/{job['id']}", json={"customer_id": 2, "expected_hours": 24})
    # Bericht bleibt 2 Tage aus → Ticket „Bericht fehlt“, nur einmal
    old = (datetime.now() - timedelta(days=2)).replace(microsecond=0).isoformat(sep=" ")
    db.update("backup_jobs", job["id"], {"last_at": old})
    assert svc.check_overdue() == 1 and svc.check_overdue() == 0
    j = db.get("backup_jobs", job["id"])
    assert j["last_status"] == "überfällig"
    t = db.get("tickets", j["ticket_id"])
    assert t["title"] == "Backup-Bericht fehlt: Nacht" and t["customer_id"] == 2
    # ohne automatisches Schließen bleibt das Ticket nach Erfolg offen
    client.put("/api/backups/settings", json={"auto_close": False})
    upload(client, "[NAS-UNBEKANNT] Backup task Nacht on NAS-UNBEKANNT has completed", sender="nas@fremd-demo.at",
           body="Synology Hyper Backup")
    assert db.get("tickets", t["id"])["status"] != "geloest"
    # Ampel: heute ok, gestern „fehlt“ (Job erwartet täglich)
    db.query("UPDATE backup_jobs SET created_at = ? WHERE id = ?", ((date.today() - timedelta(days=5)).isoformat(), job["id"]))
    grid = client.get("/api/backups?customer_id=2").json()["jobs"][0]["grid"]
    assert grid[-1]["status"] == "ok" and grid[-2]["status"] == "fehlt" and grid[0]["status"] == "–"
    # Kundenportal: nur eigene Sicherungen
    pu = client.post("/api/customers/2/portal-users", json={"name": "IT", "email": "it@kunde2-demo.at"}).json()
    portal = TestClient(app)
    portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]})
    pb = portal.get("/api/portal/backups").json()
    assert [b["name"] for b in pb] == ["Nacht"] and pb[0]["grid"][-1] == "ok"
    assert client.post("/api/backups/test", json={"subject": "[Failed] Job X", "body": "Veeam"}).json()["report"]["status"] == "fehler"


# ----------------------------------------------------------------------------- Domain-Check
class FakeResolver:
    def __init__(self, txt=None, mx=None, cname=None):
        self.t, self.m, self.c = txt or {}, mx or {}, cname or {}

    def txt(self, name):
        return self.t.get(name, [])

    def mx(self, name):
        return self.m.get(name, [])

    def cname(self, name):
        return self.c.get(name, "")


GOOD = FakeResolver(
    txt={"huber-demo.at": ["v=spf1 include:spf.protection.outlook.com -all", "MS=ms123"],
         "spf.protection.outlook.com": ["v=spf1 ip4:40.92.0.0/15 -all"],
         "_dmarc.huber-demo.at": ["v=DMARC1; p=reject; rua=mailto:dmarc@huber-demo.at"],
         "_mta-sts.huber-demo.at": ["v=STSv1; id=2026"], "_smtp._tls.huber-demo.at": ["v=TLSRPTv1; rua=mailto:tls@huber-demo.at"]},
    mx={"huber-demo.at": [(0, "huberdemo-at.mail.protection.outlook.com")]},
    cname={"selector1._domainkey.huber-demo.at": "selector1-huber-demo-at._domainkey.huber.onmicrosoft.com"})


def cert(days, verified=True, error=""):
    return lambda host: {"reachable": True, "verified": verified, "error": error, "issuer": "Let's Encrypt",
                         "not_after": (date.today() + timedelta(days=days)).isoformat(), "names": [host]}


def test_domain_check_good_and_bad():
    good = check_domain("huber-demo.at", GOOD, cert(200))
    assert good["score"] == 100 and good["findings"] == [] and good["provider"] == "Microsoft 365"
    assert good["dmarc"]["policy"] == "reject" and good["dkim"]["selectors"] == ["selector1"] and good["spf"]["lookups"] == 1
    bad_dns = FakeResolver(txt={"bad-demo.at": ["v=spf1 +all"]}, mx={"bad-demo.at": [(10, "bad-demo-at.mail.protection.outlook.com")]})
    bad = check_domain("bad-demo.at", bad_dns, cert(10))
    keys = [f["key"] for f in bad["findings"]]
    assert keys[0] == "spf-pass-all" and {"dmarc-missing", "dkim-missing", "mta-sts", "cert-expiring", "spf-m365"} <= set(keys)
    assert bad["score"] < 20
    expired = check_domain("huber-demo.at", GOOD, cert(-3, verified=False, error="certificate has expired"))
    assert [f["key"] for f in expired["findings"]] == ["cert-expired"]
    mismatch = check_domain("huber-demo.at", GOOD, cert(90, verified=False, error="Hostname mismatch"))
    assert mismatch["findings"][0]["key"] == "cert-invalid" and "Hostname mismatch" in mismatch["findings"][0]["detail"]


def test_spf_lookup_limit_and_parked_domain():
    txt = {"many-demo.at": ["v=spf1 " + " ".join(f"include:s{i}.demo" for i in range(6)) + " mx a -all"]}
    for i in range(6):
        txt[f"s{i}.demo"] = [f"v=spf1 include:t{i}.demo -all"]
        txt[f"t{i}.demo"] = ["v=spf1 ip4:10.0.0.1 -all"]
    r = FakeResolver(txt=txt, mx={"many-demo.at": [(10, "mx.many-demo.at")]})
    assert spf_lookups(r, txt["many-demo.at"][0]) == 14
    res = check_domain("many-demo.at", r, None)
    assert any(f["key"] == "spf-lookups" and f["severity"] == "hoch" for f in res["findings"])
    parked = check_domain("parkiert-demo.at", FakeResolver(), None)
    assert [f["key"] for f in parked["findings"]] == ["nomail-protect"] and not parked["mail"]
    safe = FakeResolver(txt={"geschuetzt-demo.at": ["v=spf1 -all"], "_dmarc.geschuetzt-demo.at": ["v=DMARC1; p=reject"]})
    assert check_domain("geschuetzt-demo.at", safe, None)["findings"] == []


def test_domain_api_radar_report(app, client):
    svc = app.state.domains
    resolvers = {"huber-demo.at": FakeResolver(txt={"huber-demo.at": ["v=spf1 include:spf.protection.outlook.com ~all"],
                                                     "spf.protection.outlook.com": ["v=spf1 ip4:40.92.0.0/15 -all"],
                                                     "_dmarc.huber-demo.at": ["v=DMARC1; p=none"]},
                                                mx={"huber-demo.at": [(0, "huberdemo-at.mail.protection.outlook.com")]})}
    merged = FakeResolver()
    for r in resolvers.values():
        merged.t.update(r.t)
        merged.m.update(r.m)
    svc.resolver_factory = lambda: merged
    svc.cert_fetch = cert(120)
    assert client.post("/api/domains", json={"customer_id": 1, "domain": "gmail.com"}).status_code == 422
    assert client.post("/api/domains", json={"customer_id": 1, "domain": "kein domain"}).status_code == 422
    added = client.post("/api/domains/discover").json()["added"]
    assert added >= 3  # Kunden-Mailadressen + Domains aus „Lizenzen & Verträge“
    rows = {d["domain"]: d for d in client.get("/api/domains").json()["domains"]}
    assert "huber-demo.at" in rows and rows["huber-demo.at"]["customer_id"] == 1
    d = client.post(f"/api/domains/{rows['huber-demo.at']['id']}/check").json()
    keys = {f["key"]: f for f in d["findings"]}
    assert {"dmarc-none", "dmarc-rua", "dkim-missing", "mta-sts"} <= set(keys) and d["score"] == 100 - 10 - 3 - 10 - 3
    tid = client.post(f"/api/domains/{d['id']}/findings/dmarc-none/ticket").json()["ticket_id"]
    assert client.post(f"/api/domains/{d['id']}/findings/dmarc-none/ticket").json()["ticket_id"] == tid
    assert client.get(f"/api/tickets/{tid}").json()["title"] == "huber-demo.at: DMARC nur im Beobachtungsmodus (p=none)"
    client.post(f"/api/domains/{d['id']}/findings/mta-sts/ignore", json={"ignore": True})
    assert client.get(f"/api/domains/{d['id']}").json()["counts"]["niedrig"] == 1  # nur noch dmarc-rua
    opp = [o["title"] for o in client.get("/api/radar?customer_id=1").json()["opportunities"]]
    assert any(o.startswith("E-Mail-Absicherung (SPF/DKIM/DMARC): huber-demo.at") for o in opp)
    text = client.post("/api/agents/report", json={"customer_id": 1}).json()["text"]
    assert "E-Mail-Absicherung: huber-demo.at nur Beobachtung (DMARC none)" in text
    assert client.delete(f"/api/domains/{d['id']}").json()["ok"]
