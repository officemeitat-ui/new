import base64
import dataclasses
import json

from fastapi.testclient import TestClient

from meit.main import create_app


def test_health_and_dashboard(client):
    health = client.get("/api/health").json()
    assert health["ok"] is True
    assert health["llm"]["active_provider"] == "none"
    d = client.get("/api/dashboard").json()
    assert d["customers"] == 5
    assert d["mrr"] > 0
    assert d["assets_eol"] >= 1
    assert d["radar_count"] > 0 and d["radar_annual"] > 0


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "ME-IT Cockpit" in r.text
    assert client.get("/static/app.js").status_code == 200


def test_customer_crud(client):
    r = client.post("/api/customers", json={"name": "Testfirma", "employees": 8, "booked_services": ["MW"]})
    assert r.status_code == 201
    cid = r.json()["id"]
    assert r.json()["booked_services"] == ["MW"]
    detail = client.get(f"/api/customers/{cid}").json()
    assert detail["name"] == "Testfirma"
    assert any(o["service_code"] == "BCK" for o in detail["opportunities"])
    upd = client.put(f"/api/customers/{cid}", json={"name": "Testfirma GmbH", "employees": 9}).json()
    assert upd["name"] == "Testfirma GmbH"
    assert client.delete(f"/api/customers/{cid}").json()["ok"]
    assert client.get(f"/api/customers/{cid}").status_code == 404


def test_ticket_auto_triage_without_ai(client):
    r = client.post("/api/tickets", json={
        "customer_id": 1, "title": "Ransomware", "description": "Alle Dateien am Server sind verschlüsselt!"})
    assert r.status_code == 201
    t = r.json()
    assert t["priority"] == "kritisch"
    assert t["category"] == "Sicherheit"
    assert t["ai_suggestion"]["provider"] == "regeln"
    assert "vom Netzwerk trennen" in t["ai_suggestion"]["steps"][0]
    assert t["ai_suggestion"]["reply"].startswith("Guten Tag Franz Huber")


def test_ticket_resolve_and_to_kb(client):
    t = client.post("/api/tickets", json={"customer_id": 2, "title": "Teams Mikrofon geht nicht",
                                          "auto_triage": False}).json()
    assert client.get(f"/api/tickets/{t['id']}").json()["title"] == "Teams Mikrofon geht nicht"
    assert client.post(f"/api/tickets/{t['id']}/to-kb").status_code == 422  # noch keine Lösung
    done = client.put(f"/api/tickets/{t['id']}", json={"status": "geloest", "solution": "Datenschutz-Einstellung Mikrofon für Apps aktiviert."}).json()
    assert done["status"] == "geloest" and done["resolved_at"]
    article = client.post(f"/api/tickets/{t['id']}/to-kb")
    assert article.status_code == 201
    assert client.get("/api/kb/search", params={"q": "Teams Mikrofon"}).json()[0]["title"] == "Teams Mikrofon geht nicht"
    reopened = client.put(f"/api/tickets/{t['id']}", json={"status": "in_arbeit"}).json()
    assert reopened["resolved_at"] == ""


def test_ticket_validation(client):
    assert client.post("/api/tickets", json={"title": "x", "priority": "egal"}).status_code == 422
    assert client.put("/api/tickets/1", json={"status": "kaputt"}).status_code == 422
    assert client.post("/api/tickets", json={"title": "x", "customer_id": 999}).status_code == 404


def test_assets_have_eol_status(client):
    assets = client.get("/api/assets").json()
    by_name = {a["name"]: a for a in assets}
    assert by_name["STEINER-DC01"]["eol_status"] == "abgelaufen"
    assert by_name["HUBER-PC02"]["eol_status"] == "ok"
    r = client.post("/api/assets", json={"customer_id": 1, "name": "NEU-PC", "os": "Windows 11 Pro"})
    assert r.status_code == 201


def test_kb_keyword_search_finds_compound_words(client):
    hits = client.get("/api/kb/search", params={"q": "Drucker hängt"}).json()
    assert hits and "Drucker" in hits[0]["title"]
    assert hits[0]["mode"] == "stichwort"


def test_quote_without_ai_and_accept_updates_mrr(client):
    before = client.get("/api/customers/3").json()
    q = client.post("/api/agents/quote", json={"customer_id": 3, "need": "Backup fehlt, Schutz vor Ransomware"}).json()
    codes = {i["code"] for i in q["items"]}
    assert "BCK" in codes
    assert q["total_monthly"] == round(sum(i["total"] for i in q["items"] if i["recurring"]), 2)
    assert "€ " in q["text"] and "," in q["text"]
    r = client.put(f"/api/quotes/{q['id']}", json={"status": "angenommen"})
    assert r.status_code == 200
    after = client.get("/api/customers/3").json()
    assert after["mrr"] == round(before["mrr"] + q["total_monthly"], 2)
    assert "BCK" in after["booked_services"]
    assert after["package"] == "basis"


def test_quote_with_preselected_service(client):
    q = client.post("/api/agents/quote", json={"customer_id": 1, "need": "Radar", "service_codes": ["AWR"]}).json()
    assert [i["code"] for i in q["items"]] == ["AWR"]
    assert q["items"][0]["quantity"] == 12  # Mitarbeiter der Tischlerei


def test_security_assessment(client):
    questions = client.get("/api/security/questions").json()
    answers = {q["id"]: "ja" for q in questions}
    r = client.post("/api/security/assess", json={"customer_id": 3, "answers": answers}).json()
    assert r["score"] == 100 and r["level"] == "gut" and not r["gaps"]
    answers["mfa"] = "nein"
    answers["backup"] = "teilweise"
    r = client.post("/api/security/assess", json={"customer_id": 3, "answers": answers}).json()
    assert r["score"] < 100
    assert r["gaps"][0]["id"] == "mfa"
    assert "NIS2" in r["report"]
    stored = client.get(f"/api/security/assessments/{r['id']}").json()
    assert stored["answers"]["mfa"] == "nein"


def test_monthly_report_without_ai(client):
    r = client.post("/api/agents/report", json={"customer_id": 1}).json()
    assert r["provider"] == "vorlage"
    assert "IT-Monatsbericht" in r["text"]


def test_assistant_offline_fallback(client):
    r = client.post("/api/agents/assistant", json={"messages": [{"role": "user", "content": "VPN verbindet nicht"}]}).json()
    assert r["provider"] == "offline"
    assert "VPN" in r["answer"]


def test_training_export_is_pseudonymized(client):
    client.post("/api/tickets", json={"customer_id": 2, "title": "Mail an eva@gruber-demo.at geht nicht",
                                      "description": "Frau Gruber erreicht man unter +43 664 1234567, Server 81.10.20.30",
                                      "status": "geloest", "auto_triage": False,
                                      "solution": "Postfach von Mag. Eva Gruber war voll, Archivierung eingerichtet. Intern 192.168.1.10."})
    body = client.get("/api/training/export").text
    lines = [json.loads(line) for line in body.strip().splitlines()]
    assert lines and all(len(x["messages"]) == 3 for x in lines)
    assert "eva@gruber-demo.at" not in body
    assert "Gruber" not in body
    assert "+43 664" not in body
    assert "81.10.20.30" not in body
    assert "192.168.1.10" in body  # private Adressen bleiben (technisch relevant)
    stats = client.get("/api/training/stats").json()
    assert stats["examples"] == len(lines)


def test_services_catalog(client):
    services = client.get("/api/services").json()
    assert any(s["code"] == "KIBOX" for s in services)
    assert client.post("/api/services", json={"code": "mw", "name": "Doppelt"}).status_code == 409
    r = client.post("/api/services", json={"code": "test1", "name": "Testleistung", "price": 10, "recurring": True})
    assert r.status_code == 201 and r.json()["code"] == "TEST1"


def test_password_protection(settings):
    app = create_app(dataclasses.replace(settings, app_password="geheim"))
    c = TestClient(app)
    assert c.get("/api/health").status_code == 401
    token = base64.b64encode(b"admin:geheim").decode()
    assert c.get("/api/health", headers={"Authorization": f"Basic {token}"}).status_code == 200
    wrong = base64.b64encode(b"admin:falsch").decode()
    assert c.get("/api/health", headers={"Authorization": f"Basic {wrong}"}).status_code == 401


def test_three_tier_quote_and_accept_premium(client):
    q = client.post("/api/agents/quote", json={"customer_id": 3, "need": "Backup", "service_codes": ["MW", "BCK"],
                                               "tiers": True}).json()
    keys = [t["key"] for t in q["tiers"]]
    assert keys == ["XL", "S", "M"]  # Anker zuerst, Empfehlung zuletzt
    tiers = {t["key"]: t for t in q["tiers"]}
    assert [i["code"] for i in tiers["M"]["items"]] == ["MW", "BCK"]
    assert [i["code"] for i in tiers["S"]["items"]] == ["MW"]
    assert len(tiers["XL"]["items"]) > 2 and tiers["XL"]["total_monthly"] > tiers["M"]["total_monthly"]
    assert "## Ihre Optionen" in q["text"] and "(unsere Empfehlung)" in q["text"]
    before = client.get("/api/customers/3").json()["mrr"]
    assert client.put(f"/api/quotes/{q['id']}", json={"status": "angenommen", "tier": "ZZ"}).status_code == 422
    r = client.put(f"/api/quotes/{q['id']}", json={"status": "angenommen", "tier": "XL"}).json()
    assert r["chosen_tier"] == "XL" and r["total_monthly"] == tiers["XL"]["total_monthly"]
    after = client.get("/api/customers/3").json()
    assert after["mrr"] == round(before + tiers["XL"]["total_monthly"], 2)
    assert set(i["code"] for i in tiers["XL"]["items"] if i["recurring"]) <= set(after["booked_services"])


def test_single_item_quote_without_addons_has_no_tiers(client):
    q = client.post("/api/agents/quote", json={"customer_id": 1, "need": "Stunden", "service_codes": ["STD"], "tiers": True}).json()
    assert q["tiers"] == []


def test_premium_falls_back_to_generic_addons(client):
    # Hotel hat MW + MFW gebucht; Backup/Security/Awareness haben keine weiteren passenden Ergänzungen
    q = client.post("/api/agents/quote", json={"customer_id": 5, "need": "Sicherheit",
                                               "service_codes": ["BCK", "SEC", "M365B", "AWR"], "tiers": True}).json()
    xl = next(t for t in q["tiers"] if t["key"] == "XL")
    assert {i["code"] for i in xl["items"]} - {"BCK", "SEC", "M365B", "AWR"} == {"VCISO", "MON"}
