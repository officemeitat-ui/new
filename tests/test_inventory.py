"""Geräte-Check: Registrierung, Meldung, Befunde, Bereinigung – und die Zusage „nur lesend“ des Agent-Skripts."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from meit.inventory import AGENT_FILE, device_findings, sanitize

TODAY = date.today()
ago = lambda d: (datetime.now() - timedelta(days=d)).replace(microsecond=0).isoformat()  # noqa: E731


def snapshot(**over):
    base = {
        "agent_version": "1.0.0", "hostname": "HUBER-NB01", "domain": "huber.local", "user": "HUBER\\franz",
        "manufacturer": "Dell Inc.", "model": "Latitude 5540", "serial": "ABC1234", "chassis": "laptop", "cpu": "Intel Core i5",
        "ram_gb": 16, "os": {"caption": "Microsoft Windows 11 Pro", "version": "10.0.22631", "build": "22631",
                             "install_date": ago(400), "last_boot": ago(2), "server": False},
        "disks": [{"drive": "C:", "size_gb": 476.0, "free_gb": 210.5}],
        "bitlocker": {"os_drive": "on", "method": "XtsAes256"}, "tpm": {"present": True, "version": "2.0"}, "secure_boot": True,
        "antivirus": [{"name": "Windows Defender", "enabled": True, "up_to_date": True}],
        "defender": {"realtime": True, "signature_age_days": 0, "tamper": True},
        "firewall": {"domain": True, "private": True, "public": True},
        "updates": {"last_installed": ago(6), "pending_reboot": False},
        "local_admins": ["HUBER-NB01\\Administrator", "HUBER\\Domänen-Admins"], "rdp_enabled": False,
        "software": [{"name": "Mozilla Firefox", "version": "132.0", "publisher": "Mozilla"}], "collected_at": ago(0),
    }
    base.update(over)
    return base


def keys(data, last_seen=None):
    return [f["key"] for f in device_findings(sanitize(data), last_seen or ago(0), TODAY)]


def test_findings_rules():
    assert keys(snapshot()) == []
    bad = snapshot(bitlocker={"os_drive": "off"}, antivirus=[{"name": "Defender", "enabled": False, "up_to_date": False}],
                   defender={"realtime": False, "signature_age_days": 30}, firewall={"domain": True, "private": True, "public": False},
                   updates={"last_installed": ago(70), "pending_reboot": True},
                   disks=[{"drive": "C:", "size_gb": 238.0, "free_gb": 6.0}],
                   local_admins=["HUBER-NB01\\Administrator", "HUBER\\franz"], rdp_enabled=True, ram_gb=4,
                   os={"caption": "Microsoft Windows 10 Pro", "version": "10.0.19045", "last_boot": ago(40), "server": False},
                   tpm={"present": True, "version": "1.2"})
    found = device_findings(sanitize(bad), ago(0), TODAY)
    by = {f["key"]: f["severity"] for f in found}
    assert by == {"av-off": "kritisch", "os-eol": "hoch", "bitlocker": "hoch", "firewall": "hoch", "updates": "hoch", "disk": "hoch",
                  "admin-user": "mittel", "reboot": "niedrig", "rdp": "niedrig", "ram": "niedrig", "win11": "info"}
    assert found[0]["key"] == "av-off"  # nach Schwere sortiert
    # Desktop ohne BitLocker ist „mittel“, VM gar kein Befund; Server dürfen RDP haben
    assert device_findings(sanitize(snapshot(chassis="desktop", bitlocker={"os_drive": "off"})), ago(0), TODAY)[0]["severity"] == "mittel"
    assert keys(snapshot(chassis="vm", bitlocker={"os_drive": "off"})) == []
    assert keys(snapshot(chassis="server", rdp_enabled=True, os={"caption": "Microsoft Windows Server 2022", "server": True,
                                                                 "last_boot": ago(3)})) == []
    assert keys(snapshot(defender={"realtime": True, "signature_age_days": 12})) == ["av-old"]
    assert keys(snapshot(), last_seen=ago(30)) == ["offline"]
    # Fremdprodukt aktiv, Defender aus → kein Befund
    assert keys(snapshot(antivirus=[{"name": "ESET", "enabled": True, "up_to_date": True}], defender={"realtime": False})) == []


def test_sanitize_untrusted_input():
    evil = {"hostname": "X" * 500 + "\x00\x1b[31m", "chassis": "<script>", "os": "kein objekt", "ram_gb": "viel",
            "disks": [{"drive": "C:", "size_gb": "1e999"}] * 50, "software": [{"name": "A" * 1000}] * 1000 + ["kein dict"],
            "bitlocker": {"os_drive": "'; DROP TABLE"}, "local_admins": "kein array", "unbekannt": {"x": 1},
            "firewall": {"public": "ja"}}
    s = sanitize(evil)
    assert len(s["hostname"]) == 63 and "\x00" not in s["hostname"] and s["chassis"] == "desktop" and s["os"]["caption"] == ""
    assert s["ram_gb"] is None and len(s["disks"]) == 16 and s["disks"][0]["size_gb"] is None
    assert len(s["software"]) == 400 and len(s["software"][0]["name"]) == 120 and s["bitlocker"]["os_drive"] == "unknown"
    assert s["local_admins"] == [] and "unbekannt" not in s and s["firewall"]["public"] is None
    assert sanitize("kaputt")["hostname"] == "" and device_findings(sanitize(None), "", TODAY) == []


def test_enroll_checkin_and_cockpit(app, client):
    db = app.state.ctx.db
    k = client.post("/api/inventory/keys", json={"customer_id": 1, "days": 30}).json()
    assert k["key"].startswith("meit-") and "-Install" in k["command"] and k["key"] in k["command"]
    assert db.scalar("SELECT COUNT(*) FROM agent_keys WHERE key_hash = ?", (k["key"],)) == 0  # nur Prüfsumme gespeichert
    agent = TestClient(app)  # Gerät beim Kunden – ohne Cockpit-Anmeldung
    assert agent.post("/api/public/agent/enroll", json={"key": "meit-" + "0" * 40, "hostname": "X"}).status_code == 403
    e = agent.post("/api/public/agent/enroll", json={"key": k["key"], "hostname": "HUBER-NB01", "serial": "ABC1234"})
    assert e.status_code == 201 and set(e.json()) == {"token", "device_id", "interval_hours"}
    token = e.json()["token"]
    assert db.scalar("SELECT COUNT(*) FROM agent_devices WHERE token_hash = ?", (token,)) == 0
    assert agent.post("/api/public/agent/checkin", json=snapshot()).status_code == 401
    assert agent.post("/api/public/agent/checkin", json=snapshot(), headers={"Authorization": "Bearer falsch"}).status_code == 403
    r = agent.post("/api/public/agent/checkin", json=snapshot(bitlocker={"os_drive": "off"}), headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json() == {"ok": True, "interval_hours": 6}  # keine Befehle in der Antwort
    big = agent.post("/api/public/agent/checkin", content=b"x" * 600_000, headers={"Authorization": f"Bearer {token}"})
    assert big.status_code == 413

    ov = client.get("/api/inventory?customer_id=1").json()
    d = ov["devices"][0]
    assert ov["summary"] == {"devices": 1, "reported": 1, "healthy": 0, "critical": 0, "high": 1, "unencrypted": 1, "offline": 0}
    assert d["hostname"] == "HUBER-NB01" and d["os"] == "Windows 11 Pro" and d["score"] == 78 and d["top"].startswith("Festplatte nicht verschlüsselt")
    assert ov["keys"][0]["uses"] == 1 and ov["keys"][0]["hint"] == k["key"][-4:] and "key" not in ov["keys"][0]
    # Gerät erscheint im Inventar (neu angelegt), Folgemeldung aktualisiert es
    asset = db.get("assets", d["asset_id"])
    assert asset["name"] == "HUBER-NB01" and asset["type"] == "notebook" and asset["serial"] == "ABC1234" and "Windows 11 Pro" in asset["os"]
    full = client.get(f"/api/inventory/{d['id']}").json()
    assert full["data"]["software"][0]["name"] == "Mozilla Firefox" and full["findings"][0]["key"] == "bitlocker"
    # Ticket mit allen Befunden, nur einmal
    tid = client.post(f"/api/inventory/{d['id']}/ticket").json()["ticket_id"]
    assert client.post(f"/api/inventory/{d['id']}/ticket").json()["ticket_id"] == tid
    t = client.get(f"/api/tickets/{tid}").json()
    assert t["title"].startswith("Geräte-Check HUBER-NB01: Festplatte nicht verschlüsselt") and t["priority"] == "hoch"
    # Radar, Monatsbericht, Kundenportal
    opp = [o["title"] for o in client.get("/api/radar?customer_id=1").json()["opportunities"]]
    assert "Arbeitsplätze absichern (1 Geräte)" in opp
    assert "Geräte-Check: **0 von 1** Geräten ohne Befund (1 unverschlüsselt)" in client.post("/api/agents/report", json={"customer_id": 1}).json()["text"]
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]})
    pa = {a["name"]: a for a in portal.get("/api/portal/assets").json()}
    assert pa["HUBER-NB01"]["health"] == {"encrypted": False, "antivirus": True, "updates": True, "last_seen": str(TODAY)}
    assert "id" not in pa["HUBER-NB01"]
    # Befund ausblenden, Gerät sperren, Schlüssel widerrufen
    client.post(f"/api/inventory/{d['id']}/findings/bitlocker/ignore", json={"ignore": True})
    assert client.get("/api/inventory?customer_id=1").json()["summary"]["healthy"] == 1
    client.put(f"/api/inventory/{d['id']}/active", json={"ignore": True})
    assert agent.post("/api/public/agent/checkin", json=snapshot(), headers={"Authorization": f"Bearer {token}"}).status_code == 403
    client.delete(f"/api/inventory/keys/{ov['keys'][0]['id']}")
    assert agent.post("/api/public/agent/enroll", json={"key": k["key"], "hostname": "NEU"}).status_code == 403
    steps = {s["key"]: s for s in client.get("/api/setup").json()["steps"]}
    assert steps["agent"]["status"] == "ok"


def test_reenroll_rotates_token_and_expired_key(app, client):
    db = app.state.ctx.db
    k = client.post("/api/inventory/keys", json={"customer_id": 2}).json()["key"]
    agent = TestClient(app)
    first = agent.post("/api/public/agent/enroll", json={"key": k, "hostname": "PC-01", "serial": "S1"}).json()
    second = agent.post("/api/public/agent/enroll", json={"key": k, "hostname": "PC-01-NEU", "serial": "S1"}).json()
    assert second["device_id"] == first["device_id"] and second["token"] != first["token"]  # Neuinstallation = selbes Gerät
    assert agent.post("/api/public/agent/checkin", json=snapshot(), headers={"Authorization": f"Bearer {first['token']}"}).status_code == 403
    assert agent.post("/api/public/agent/checkin", json=snapshot(hostname="PC-01-NEU", serial="S1"),
                      headers={"Authorization": f"Bearer {second['token']}"}).status_code == 200
    assert len(client.get("/api/inventory?customer_id=2").json()["devices"]) == 1
    db.query("UPDATE agent_keys SET expires_at = '2020-01-01 00:00:00'")
    assert agent.post("/api/public/agent/enroll", json={"key": k, "hostname": "PC-02"}).status_code == 403
    assert client.get("/api/inventory?customer_id=2").json()["keys"][0]["valid"] is False
    assert client.post("/api/inventory/keys", json={"customer_id": 9999}).status_code == 404


def test_agent_script_is_read_only_and_well_formed(client):
    text = AGENT_FILE.read_text(encoding="utf-8")
    assert client.get("/api/inventory/agent.ps1").text == text
    # ohne Kommentare und Zeichenketten: Klammern müssen ausgeglichen sein (grobe Syntaxprüfung)
    code = re.sub(r"<#.*?#>", "", text, flags=re.S)
    code = "\n".join(re.sub(r'"(?:[^"`]|`.)*"|\'[^\']*\'', '""', line).split("#")[0] for line in code.splitlines())
    for a, b in ("{}", "()", "[]"):
        assert code.count(a) == code.count(b), f"Klammern {a}{b} nicht ausgeglichen"
    # „nur lesend“: kein Nachladen/Ausführen von Code, keine Änderungen am System außerhalb des eigenen Ordners
    low = text.lower()
    for forbidden in ("invoke-expression", "iex ", "downloadstring", "downloadfile", "start-process", "invoke-command", "set-itemproperty",
                      "new-itemproperty", "remove-itemproperty", "stop-service", "set-service", "restart-computer", "stop-computer",
                      "set-executionpolicy", "add-mppreference", "set-mppreference", "new-localuser", "add-localgroupmember",
                      "enable-psremoting", "invoke-webrequest", "frombase64string", "[scriptblock]::create", "netsh", "reg add"):
        assert forbidden not in low, f"Agent darf „{forbidden}“ nicht enthalten"
    writes = re.findall(r"(?i)\b(?:set-content|add-content|remove-item|copy-item|new-item|set-acl)\b[^\n;}]*", text)
    assert len(writes) >= 7 and all(re.search(r"\$(AgentDir|ConfigFile|LogFile|target)\b", w) for w in writes), writes  # nur im eigenen Ordner
    assert low.count("invoke-restmethod") == 1 and "/api/public/agent/checkin" in text and "/api/public/agent/enroll" in text
    assert "https://" in text and "-AllowHttp" in text and "S-1-5-18" in text
