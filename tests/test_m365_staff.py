"""Microsoft 365 der Kunden (Zustimmung, Abruf, Befunde, Lizenzabgleich) und Ein-/Austritte (Checkliste, Portal)."""

from __future__ import annotations

import dataclasses
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from meit.m365 import GraphError, analyze_rule, match_subscription
from meit.main import create_app

NOW = datetime.now(timezone.utc)
iso = lambda days: (NOW - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
SPB, BASIC, FREE = "sku-spb", "sku-basic", "sku-free"


def user(uid, name, sku=SPB, enabled=True, last=5, created=400, kind="Member"):
    return {"id": uid, "displayName": name, "userPrincipalName": f"{uid}@huber-demo.at", "accountEnabled": enabled,
            "userType": kind, "assignedLicenses": [{"skuId": sku}] if sku else [], "createdDateTime": iso(created),
            "signInActivity": {"lastSignInDateTime": iso(last) if last is not None else None}}


class FakeTenant:
    """Simulierter Kunden-Tenant (Antworten wie Microsoft Graph)."""

    def __init__(self, premium_report=False, fail=None):
        self.premium_report, self.fail, self.calls = premium_report, fail, []
        self.users = [user("franz", "Franz Huber"), user("anna", "Anna Berger"), user("karl", "Karl Admin"),
                      user("old", "Otto Alt", last=200), user("gone", "Gerda Weg", enabled=False),
                      user("gast", "Gast Extern", sku=None, last=None, created=400, kind="Guest")]

    def get(self, path, params=None):
        self.calls.append(path)
        if self.fail:
            raise self.fail
        if path == "/policies/identitySecurityDefaultsEnforcementPolicy":
            return {"isEnabled": False}
        raise GraphError(f"Graph 404: {path}", 404)

    def get_all(self, path, params=None, limit=5000):
        self.calls.append(path)
        if self.fail:
            raise self.fail
        if path == "/organization":
            return [{"id": "0f0f0f0f-1111-2222-3333-444455556666", "displayName": "Tischlerei Huber GmbH",
                     "verifiedDomains": [{"name": "huber-demo.at", "isDefault": True}, {"name": "huberdemo.onmicrosoft.com"}]}]
        if path == "/subscribedSkus":
            return [{"skuId": SPB, "skuPartNumber": "SPB", "prepaidUnits": {"enabled": 10}, "consumedUnits": 8},
                    {"skuId": BASIC, "skuPartNumber": "O365_BUSINESS_ESSENTIALS", "prepaidUnits": {"enabled": 2}, "consumedUnits": 2},
                    {"skuId": FREE, "skuPartNumber": "FLOW_FREE", "prepaidUnits": {"enabled": 10000}, "consumedUnits": 3}]
        if path == "/users":
            return self.users
        if path == "/directoryRoles":
            return [{"displayName": "Global Administrator", "members": [{"id": "franz"}, {"id": "karl"}]}]
        if path == "/reports/authenticationMethods/userRegistrationDetails":
            if not self.premium_report:
                raise GraphError("Graph 403: Entra ID P1 erforderlich", 403)
            return [{"id": "franz", "isMfaRegistered": True, "methodsRegistered": ["microsoftAuthenticatorPush"]}]
        if path.endswith("/authentication/methods"):
            uid = path.split("/")[2]
            kinds = ["passwordAuthenticationMethod"] + (["microsoftAuthenticatorAuthenticationMethod"] if uid in ("franz", "old") else [])
            return [{"@odata.type": f"#microsoft.graph.{k}"} for k in kinds]
        if path.endswith("/mailFolders/inbox/messageRules"):
            uid = path.split("/")[2]
            if uid == "anna":
                return [{"displayName": "Sync", "isEnabled": True,
                         "actions": {"forwardTo": [{"emailAddress": {"address": "anna.privat@gmail.com"}}]}}]
            if uid == "old":
                return [{"displayName": ".", "isEnabled": True, "conditions": {"subjectContains": ["Rechnung"]},
                         "actions": {"moveToFolder": "AAMkRSS", "markAsRead": True}}]
            if uid == "franz":  # interne Weiterleitung ist in Ordnung
                return [{"displayName": "Vertretung", "isEnabled": True,
                         "actions": {"forwardTo": [{"emailAddress": {"address": "office@huber-demo.at"}}]}}]
            return []
        if path == "/identity/conditionalAccess/policies":
            return []
        if path == "/security/secureScores":
            return [{"currentScore": 35.0, "maxScore": 100.0}]
        raise GraphError(f"Graph 404: {path}", 404)


@pytest.fixture()
def m365(settings):
    app = create_app(dataclasses.replace(settings, m365_client_id="app-id", m365_client_secret="geheim"))
    client = TestClient(app)
    db = app.state.ctx.db
    cid = db.insert("customers", {"name": "Tischlerei Huber Test", "email": "office@huber-demo.at", "employees": 6})
    sub = db.insert("subscriptions", {"customer_id": cid, "name": "Microsoft 365 Business Premium", "vendor": "Microsoft",
                                      "kind": "abo", "quantity": 6, "unit_price": 22.0, "unit_cost": 19.0,
                                      "billing_cycle": "monat", "billable": True, "per_user": True, "auto_renew": True})
    fake = FakeTenant()
    app.state.m365.factory = lambda tenant: fake
    return app, client, cid, sub, fake


def test_rule_and_matching_helpers():
    own = {"huber-demo.at"}
    assert analyze_rule({"actions": {"redirectTo": [{"emailAddress": {"address": "x@evil.example"}}]}}, own)[0].startswith("leitet extern")
    assert analyze_rule({"actions": {"forwardTo": [{"emailAddress": {"address": "chef@huber-demo.at"}}]}}, own) == []
    assert analyze_rule({"isEnabled": False, "actions": {"forwardTo": [{"emailAddress": {"address": "x@evil.example"}}]}}, own) == []
    subs = [{"id": 1, "name": "M365 Business Standard (Jahr)"}, {"id": 2, "name": "Office 365 E3"}, {"id": 3, "name": "Microsoft 365 E3"}]
    assert match_subscription("O365_BUSINESS_PREMIUM", subs, {})["id"] == 1
    assert match_subscription("SPE_E3", subs, {})["id"] == 3 and match_subscription("ENTERPRISEPACK", subs, {})["id"] == 2
    assert match_subscription("SPB", subs, {}) is None and match_subscription("SPB", subs, {"SPB": 2})["id"] == 2


def test_consent_flow(m365):
    app, client, cid, _, _ = m365
    assert client.put(f"/api/m365/{cid}", json={"tenant_id": "kein tenant"}).status_code == 422
    r = client.post(f"/api/m365/{cid}/consent-link", json={"tenant_id": "huber-demo.at"}).json()
    url = urlparse(r["url"])
    q = parse_qs(url.query)
    assert url.netloc == "login.microsoftonline.com" and url.path == "/huber-demo.at/v2.0/adminconsent"
    assert q["client_id"] == ["app-id"] and q["redirect_uri"][0].endswith("/api/public/m365/consent")
    page = client.get("/api/public/m365/consent", params={"state": q["state"][0], "tenant": "0f0f0f0f-1111-2222-3333-444455556666",
                                                          "admin_consent": "True"})
    assert page.status_code == 200 and "Zugriff erteilt" in page.text
    t = client.get(f"/api/m365/{cid}").json()["tenant"]
    assert t["status"] == "verbunden" and t["tenant_id"].startswith("0f0f0f0f") and t["consented_at"]
    # Link nur einmal gültig; Ablehnung wird vermerkt
    assert client.get("/api/public/m365/consent", params={"state": q["state"][0]}).status_code == 400
    q2 = parse_qs(urlparse(client.post(f"/api/m365/{cid}/consent-link").json()["url"]).query)
    assert client.get("/api/public/m365/consent", params={"state": q2["state"][0], "error": "access_denied",
                                                          "error_description": "Abgebrochen"}).status_code == 400
    assert client.get(f"/api/m365/{cid}").json()["tenant"]["status"] == "fehler"


def test_sync_findings_and_auto_ticket(m365):
    app, client, cid, sub, fake = m365
    client.put(f"/api/m365/{cid}", json={"tenant_id": "huber-demo.at"})
    r = client.post(f"/api/m365/{cid}/sync").json()
    assert r["users"] == 6 and r["tickets_created"] == 1 and r["critical"] == 2
    d = client.get(f"/api/m365/{cid}").json()
    keys = {f["key"]: f for f in d["findings"]}
    assert set(keys) >= {"forward:anna", "rule:old", "mfa-admin", "mfa-users", "mfa-policy", "admins-daily",
                         "licensed-disabled", "licensed-inactive", "guests-inactive", "secure-score",
                         "lic-under:SPB", "lic-unassigned:SPB", "lic-missing:O365_BUSINESS_ESSENTIALS"}
    assert "rule:franz" not in keys and "forward:franz" not in keys  # interne Weiterleitung
    assert keys["mfa-admin"]["users"] == ["Karl Admin"] and keys["mfa-users"]["users"] == ["Anna Berger"]
    assert keys["lic-under:SPB"]["gap_month"] == 44.0 and keys["lic-unassigned:SPB"]["savings_month"] == 38.0
    assert keys["licensed-disabled"]["savings_month"] == 22.0 and keys["secure-score"]["severity"] == "hoch"
    assert [f["severity"] for f in d["findings"]][:2] == ["kritisch", "kritisch"]
    s = d["summary"]
    assert s["mfa_pct"] == 50 and s["secure_score_pct"] == 35 and s["users"] == 4 and s["guests"] == 1
    # automatisches Ticket für die externe Weiterleitung (mögliche Konto-Übernahme), nur einmal
    t = client.get(f"/api/tickets/{keys['forward:anna']['ticket_id']}").json()
    assert t["priority"] == "kritisch" and "anna.privat@gmail.com" in t["description"] and t["category"] == "Sicherheit"
    assert client.post(f"/api/m365/{cid}/sync").json()["tickets_created"] == 0
    # MFA ohne Premium-Bericht über Einzelabfrage ermittelt
    assert any(c.endswith("/authentication/methods") for c in fake.calls)
    # Radar: Nachverrechnung + Absicherung
    radar = client.get(f"/api/radar?customer_id={cid}").json()["opportunities"]
    titles = [o["title"] for o in radar]
    assert any(x.startswith("Nachverrechnen: Microsoft 365 Business Premium (+2)") for x in titles)
    assert any(x.startswith("Microsoft 365 absichern") for x in titles)
    # Übersicht
    ov = client.get("/api/m365").json()
    row = next(x for x in ov["tenants"] if x["customer_id"] == cid)
    assert ov["configured"] and row["findings"]["kritisch"] == 2 and row["gap_month"] == 44.0


def test_license_reconciliation_and_actions(m365):
    app, client, cid, sub, _ = m365
    client.put(f"/api/m365/{cid}", json={"tenant_id": "huber-demo.at"})
    client.post(f"/api/m365/{cid}/sync")
    r = client.post(f"/api/m365/{cid}/licenses", json={"sku": "SPB"}).json()
    assert r["quantity"] == 8 and r["changed_from"] == 6
    created = client.post(f"/api/m365/{cid}/licenses", json={"sku": "O365_BUSINESS_ESSENTIALS"}).json()
    assert created["created"] and created["quantity"] == 2 and created["name"] == "Microsoft 365 Business Basic"
    keys = {f["key"] for f in client.get(f"/api/m365/{cid}").json()["findings"]}
    assert "lic-under:SPB" not in keys and "lic-missing:O365_BUSINESS_ESSENTIALS" not in keys
    # Befund ausblenden (z. B. bewusst akzeptiert) und Ticket anlegen
    client.post(f"/api/m365/{cid}/findings/admins-daily/ignore", json={"ignore": True})
    f = {x["key"]: x for x in client.get(f"/api/m365/{cid}").json()["findings"]}
    assert f["admins-daily"]["ignored"] and client.get("/api/m365").json()["tenants"][0]["findings"]["niedrig"] >= 0
    tid = client.post(f"/api/m365/{cid}/findings/mfa-admin/ticket").json()["ticket_id"]
    assert client.post(f"/api/m365/{cid}/findings/mfa-admin/ticket").json()["ticket_id"] == tid
    assert client.post(f"/api/m365/{cid}/findings/gibts-nicht/ticket").status_code == 404
    # fremde Lizenz kann nicht zugeordnet werden
    other = app.state.ctx.db.insert("subscriptions", {"customer_id": 1, "name": "Fremd", "quantity": 1})
    assert client.post(f"/api/m365/{cid}/licenses", json={"sku": "SPB", "subscription_id": other}).status_code == 422


def test_sync_errors(m365):
    app, client, cid, _, fake = m365
    assert client.post(f"/api/m365/{cid}/sync").status_code == 404  # noch nicht eingerichtet
    client.put(f"/api/m365/{cid}", json={"tenant_id": "huber-demo.at"})
    fake.fail = GraphError("Die Zustimmung des Kunden fehlt noch", 401)
    assert client.post(f"/api/m365/{cid}/sync").status_code == 502
    t = client.get(f"/api/m365/{cid}").json()["tenant"]
    assert t["status"] == "ausstehend" and "Zustimmung" in t["error"]


def test_not_configured(client):
    assert client.get("/api/m365").json()["configured"] is False
    assert client.post("/api/m365/1/consent-link").status_code == 409


def _portal(app, client, cid, email="chef@huber-demo.at"):
    pu = client.post(f"/api/customers/{cid}/portal-users", json={"name": "Chef", "email": email}).json()
    c = TestClient(app)
    assert c.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    return c


def test_staff_onboarding_flow(m365):
    app, client, cid, sub, _ = m365
    due = (date.today() + timedelta(days=10)).isoformat()
    r = client.post("/api/staff", json={"customer_id": cid, "kind": "eintritt", "person": "Max Muster", "due_date": due,
                                        "department": "Werkstatt", "subscription_id": sub, "device": "neu"})
    assert r.status_code == 201, r.text
    c = r.json()
    steps = [s["text"] for s in c["checklist"]]
    assert "Lizenz zuweisen: Microsoft 365 Business Premium" in steps
    assert any(s.startswith("Gerät: neues Gerät beschaffen") for s in steps) and not any("Telefon" in s for s in steps)
    assert "Benutzerkonto in Microsoft 365 anlegen (Max Muster, Abteilung Werkstatt)" in steps
    t = client.get(f"/api/tickets/{c['ticket_id']}").json()
    assert t["title"].startswith("Neuer Mitarbeiter: Max Muster ab ") and t["category"] == "Benutzerverwaltung"
    assert client.get(f"/api/staff?customer_id={cid}").json()[0]["days"] == 10
    for i in range(c["total"]):
        last = client.post(f"/api/staff/{c['id']}/check", json={"index": i, "done": True}).json()
    assert last["status"] == "erledigt" and any("Anzahl 6 → 7" in n for n in last["adjustments"])
    db = app.state.ctx.db
    assert db.get("subscriptions", sub)["quantity"] == 7 and db.get("customers", cid)["employees"] == 7
    assert client.get(f"/api/tickets/{c['ticket_id']}").json()["status"] == "geloest"
    assert client.post(f"/api/staff/{c['id']}/check", json={"index": 0, "done": False}).status_code == 409
    assert client.get("/api/staff").json() == [] or all(x["id"] != c["id"] for x in client.get("/api/staff").json())


def test_staff_offboarding_portal_and_templates(m365):
    app, client, cid, sub, _ = m365
    portal = _portal(app, client, cid)
    info = portal.get("/api/portal/staff").json()
    assert info["licenses"][0]["id"] == sub and info["m365"] is None
    r = portal.post("/api/portal/staff", json={"kind": "austritt", "person": "Otto Alt", "due_date": "2026-12-31",
                                               "subscription_id": sub, "mailbox": "freigegeben", "handover_to": "Franz Huber",
                                               "device": "vorhanden"})
    assert r.status_code == 201, r.text
    change = client.get(f"/api/staff/{r.json()['id']}").json()
    steps = [s["text"] for s in change["checklist"]]
    assert "Anmeldung zum Stichtag 31.12.2026 sperren und alle Sitzungen abmelden" in steps
    assert "Postfach: in freigegebenes Postfach umwandeln (Zugriff für Franz Huber)" in steps
    assert "OneDrive-/Dateien an Franz Huber übergeben" in steps and change["requested_by"].endswith("(Kundenportal)")
    assert portal.post("/api/portal/staff", json={"kind": "austritt", "person": "X Y", "subscription_id": 999}).status_code == 422
    assert portal.post("/api/portal/staff", json={"kind": "urlaub", "person": "X Y"}).status_code == 422
    done = client.post(f"/api/staff/{change['id']}/complete").json()
    assert done["status"] == "erledigt" and app.state.ctx.db.get("subscriptions", sub)["quantity"] == 5
    listed = portal.get("/api/portal/staff").json()["changes"][0]
    assert listed["status"] == "erledigt" and listed["kind_label"] == "Austritt" and listed["total"] == len(steps)
    # eigene Vorlage mit Bedingung, Schritt nachträglich ergänzen, Stornieren
    client.put("/api/staff/templates", json={"eintritt": ["Konto für {person}", "?telefon Telefon einrichten"], "austritt": []})
    tpl = client.get("/api/staff/templates").json()["templates"]
    assert tpl["eintritt"] == ["Konto für {person}", "?telefon Telefon einrichten"] and len(tpl["austritt"]) > 5
    n = client.post("/api/staff", json={"customer_id": cid, "kind": "eintritt", "person": "Eva Neu", "phone": True}).json()
    assert [s["text"] for s in n["checklist"]] == ["Konto für Eva Neu", "Telefon einrichten"]
    n = client.put(f"/api/staff/{n['id']}", json={"add_step": "Parkplatz-Karte"}).json()
    assert n["total"] == 3
    x = client.post(f"/api/staff/{n['id']}/cancel").json()
    assert x["status"] == "storniert" and app.state.ctx.db.get("customers", cid)["employees"] == 5
    assert client.post("/api/staff", json={"customer_id": cid, "kind": "eintritt", "person": "A B", "due_date": "31.12."}).status_code == 422


def test_portal_shows_m365_users(m365):
    app, client, cid, _, _ = m365
    client.put(f"/api/m365/{cid}", json={"tenant_id": "huber-demo.at"})
    client.post(f"/api/m365/{cid}/sync")
    portal = _portal(app, client, cid)
    users = portal.get("/api/portal/staff").json()["m365"]["users"]
    names = {u["name"]: u for u in users}
    assert "Gast Extern" not in names and names["Anna Berger"]["mfa"] == 0 and names["Franz Huber"]["licenses"] == ["Microsoft 365 Business Premium"]
    other = _portal(app, client, 1, email="it@anderer-demo.at")
    assert other.get("/api/portal/staff").json()["m365"] is None


def test_report_and_qbr_include_m365_and_staff(m365):
    app, client, cid, sub, _ = m365
    client.put(f"/api/m365/{cid}", json={"tenant_id": "huber-demo.at"})
    client.post(f"/api/m365/{cid}/sync")
    db = app.state.ctx.db
    t = db.query_one("SELECT id FROM m365_tenants WHERE customer_id = ?", (cid,))
    db.update("m365_tenants", t["id"], {"score_history": '[["2020-01-01", 20.0], ["%s", 35.0]]' % date.today().isoformat()})
    c = client.post("/api/staff", json={"customer_id": cid, "kind": "eintritt", "person": "Max Muster"}).json()
    client.post(f"/api/staff/{c['id']}/complete")
    text = client.post("/api/agents/report", json={"customer_id": cid}).json()["text"]
    assert "Zwei-Faktor-Anmeldung bei **50 %**" in text and "Secure Score **35 %** (vorher 20 %)" in text
    assert "kritische Sicherheitsbefunde in Microsoft 365: **2**" in text and "**1** Eintritt(e)" in text
    qbr = client.post("/api/agents/qbr", json={"customer_id": cid}).json()["text"]
    assert "Microsoft 365:" in qbr and "Eintritt(e)" in qbr
