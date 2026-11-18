"""Sichere Anbindungen: Zertifikat-Anmeldung, Tresor, Verbindungs-Center (Rechte-Prüfung) und Microsoft To Do."""

from __future__ import annotations

import base64
import dataclasses
import json
import os
import stat

import httpx
import pytest
from fastapi.testclient import TestClient

from meit import msauth
from meit.main import create_app
from meit.vault import Vault, VaultError


def b64(d: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def fake_jwt(**claims) -> str:
    return f"{b64({'alg': 'none'})}.{b64(claims)}.sig"


class Resp:
    def __init__(self, data=None, status=200):
        self._data, self.status_code = data, status
        self.content = b"" if data is None else json.dumps(data).encode()
        self.headers = {}

    def json(self):
        if self._data is None:
            raise ValueError("leer")
        return self._data


@pytest.fixture(autouse=True)
def reset_msauth():
    yield
    msauth.configure("")


# ----------------------------------------------------------------------------- Zertifikat & Tresor
def test_certificate_assertion_is_valid_ps256(tmp_path):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    out = msauth.generate_certificate(tmp_path, name="probe", subject="ME-IT Test")
    assert out["thumbprint"] and (tmp_path / "probe.cer").read_bytes()[:1] == b"\x30"
    if os.name == "posix":
        assert stat.S_IMODE(os.stat(out["pem"]).st_mode) == 0o600
    cert = msauth.load_certificate(out["pem"])
    jwt = cert.assertion("client-123", "tenant-abc")
    head, body, sig = jwt.split(".")
    header = json.loads(base64.urlsafe_b64decode(head + "=="))
    claims = json.loads(base64.urlsafe_b64decode(body + "=="))
    assert header == {"alg": "PS256", "typ": "JWT", "x5t#S256": cert.thumbprint_s256}
    assert claims["aud"] == "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token"
    assert claims["iss"] == claims["sub"] == "client-123" and claims["exp"] - claims["nbf"] <= 600
    cert._key.public_key().verify(base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4)), f"{head}.{body}".encode(),
                                  padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())


def test_token_source_prefers_certificate_and_falls_back(tmp_path, monkeypatch):
    out = msauth.generate_certificate(tmp_path, name="c1")
    msauth.configure(out["pem"])
    sent = []

    def post(url, data=None, timeout=None):
        sent.append(data)
        if "client_assertion" in data:
            return Resp({"error": "invalid_client", "error_description": "AADSTS700027: Client assertion failed."}, 401)
        return Resp({"access_token": fake_jwt(roles=["Mail.Send"]), "expires_in": 3600})

    monkeypatch.setattr(httpx, "post", post)
    src = msauth.TokenSource("tenant", "client", "geheim")
    assert src.claims()["roles"] == ["Mail.Send"] and src.method == "geheimnis"
    assert sent[0]["client_assertion_type"].endswith("jwt-bearer") and sent[1]["client_secret"] == "geheim"
    assert msauth.last_status()["tenant|client"]["fallback"] is True
    with pytest.raises(msauth.MsAuthError, match="Zertifikat ist in der App-Registrierung nicht hinterlegt"):
        msauth.TokenSource("tenant", "client", "").token()


def test_vault_roundtrip_and_wrong_key(tmp_path):
    v = Vault(tmp_path, env_key="")
    token = v.encrypt("refresh-geheim")
    assert token != "refresh-geheim" and v.decrypt(token) == "refresh-geheim"
    if os.name == "posix":
        assert stat.S_IMODE(os.stat(tmp_path / "tresor.key").st_mode) == 0o600
    other = Vault(tmp_path / "anders", env_key="")
    with pytest.raises(VaultError):
        other.decrypt(token)


# ----------------------------------------------------------------------------- Verbindungs-Center
@pytest.fixture()
def ms_app(settings):
    s = dataclasses.replace(settings, graph_tenant_id="tenant-abc", graph_client_id="app-123", graph_client_secret="geheim",
                            bookstack_url="http://wiki.firma-demo.at", bookstack_token_id="id", bookstack_token_secret="sec")
    app = create_app(s)
    return app, TestClient(app)


def test_connections_overview_and_role_check(ms_app, monkeypatch):
    app, client = ms_app
    data = client.get("/api/connections").json()
    items = {i["key"]: i for i in data["items"]}
    assert set(items) >= {"login", "microsoft", "sharepoint", "kunden_m365", "todo", "bookstack", "atera", "claude", "backup"}
    assert items["login"]["status"] == "bad"  # keine Benutzer, kein Passwort
    assert items["microsoft"]["status"] == "warn" and "Geheimnis" in items["microsoft"]["checks"][0]["text"]
    assert items["bookstack"]["status"] == "bad"  # http:// über das Internet
    roles = ["Mail.Send", "Mail.ReadWrite", "Sites.ReadWrite.All", "Directory.ReadWrite.All"]
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Resp({"access_token": fake_jwt(roles=roles), "expires_in": 3600}))
    r = client.post("/api/connections/microsoft/test").json()
    texts = " | ".join(c["text"] for c in r["checks"])
    assert r["status"] == "bad" and "Directory.ReadWrite.All: weit mehr als nötig" in texts
    assert "Sites.Selected" in texts and "RBAC" in texts and r["detail"]["roles"] == sorted(roles)
    assert client.get("/api/connections").json()["items"][1]["last_test"]["status"] == "bad"
    from datetime import datetime, timedelta

    for stamp in (datetime.now().isoformat(timespec="seconds"), (datetime.now() - timedelta(days=5)).isoformat() + "Z"):
        app.state.ctx.db.set_setting("backup_last", stamp)  # mit und ohne Zeitzone
        backup = {i["key"]: i for i in client.get("/api/connections").json()["items"]}["backup"]
        assert backup["checks"][0]["level"] in ("ok", "warn")
    assert "5 Tage alt" in backup["checks"][0]["text"]
    assert client.post("/api/connections/gibtsnicht/test").status_code == 404


def test_bookstack_admin_token_warning(ms_app, monkeypatch):
    app, client = ms_app
    from meit.bookstack import BookStack, BookStackError

    def req(self, method, path, **kw):
        if path == "/roles":
            raise BookStackError("403")
        return {"total": 4, "data": []}

    monkeypatch.setattr(BookStack, "_req", req)
    r = client.post("/api/connections/bookstack/test").json()
    texts = " | ".join(c["text"] for c in r["checks"])
    assert "4 Bücher" in texts and "Admin-Rechte (Benutzer verwalten, Audit-Log lesen)" in texts


def test_certificate_lifecycle(ms_app, monkeypatch):
    app, client = ms_app
    assert client.post("/api/connections/certificate/activate").status_code == 409  # noch keines erzeugt
    gen = client.post("/api/connections/certificate").json()
    assert gen["thumbprint"] and gen["download"].endswith("/cer")
    cer = client.get("/api/connections/certificate/cer")
    assert cer.status_code == 200 and cer.content[:1] == b"\x30" and b"PRIVATE" not in cer.content
    # Microsoft lehnt das Zertifikat ab (noch nicht hochgeladen) → bleibt inaktiv
    monkeypatch.setattr(httpx, "post", lambda url, data=None, timeout=None: Resp(
        {"error": "invalid_client", "error_description": "AADSTS700027: not found"}, 401))
    r = client.post("/api/connections/certificate/activate")
    assert r.status_code == 409 and "hochgeladen" in r.json()["detail"] and msauth.active_certificate() is None
    # hochgeladen → aktiv; Geheimnis wird nicht mehr gebraucht
    seen = []
    monkeypatch.setattr(httpx, "post", lambda url, data=None, timeout=None: (seen.append(data), Resp(
        {"access_token": fake_jwt(roles=["Sites.Selected", "Mail.Send"]), "expires_in": 3600}))[1])
    assert client.post("/api/connections/certificate/activate").json()["ok"]
    assert "client_assertion" in seen[-1] and "client_secret" not in seen[-1]
    assert app.state.ctx.db.get_setting("graph_cert_file", "").endswith(".pem")
    ms = client.post("/api/connections/microsoft/test").json()
    texts = " | ".join(c["text"] for c in ms["checks"])
    assert "Anmeldung per Zertifikat" in texts and "Anmeldung erfolgreich (Zertifikat)" in texts and "Sites.Selected: Zugriff nur" in texts
    # nach Neustart weiterhin aktiv
    msauth.configure("")
    create_app(app.state.settings)
    assert msauth.active_certificate() is not None
    client.post("/api/connections/certificate/deactivate")
    assert msauth.active_certificate() is None


def test_sharepoint_grant_info(ms_app):
    app, client = ms_app
    assert client.get("/api/connections/sharepoint/grant").status_code == 409
    docs = app.state.ctx.docs
    docs.save_conf({**docs.conf(), "target": "sharepoint", "sharepoint_site": "https://firma.sharepoint.com/sites/ME-IT"})
    g = client.get("/api/connections/sharepoint/grant").json()
    assert g["body"]["roles"] == ["write"] and g["body"]["grantedToIdentities"][0]["application"]["id"] == "app-123"
    assert g["site_id_request"] == "GET https://graph.microsoft.com/v1.0/sites/firma.sharepoint.com:/sites/ME-IT"


# ----------------------------------------------------------------------------- Microsoft To Do
class FakeTodo:
    """Simuliertes Microsoft Graph für To Do (nur die benötigten Aufrufe)."""

    def __init__(self):
        self.lists: dict[str, dict] = {}
        self.n = 0
        self.token_calls = []

    def nid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def post(self, url, data=None, timeout=None):
        self.token_calls.append(data)
        if url.endswith("/devicecode"):
            return Resp({"device_code": "dc-1", "user_code": "ABCD-1234", "verification_uri": "https://microsoft.com/devicelogin",
                         "expires_in": 900, "interval": 0})
        if data["grant_type"].endswith("device_code"):
            if sum(1 for c in self.token_calls if c.get("grant_type", "").endswith("device_code")) == 1:
                return Resp({"error": "authorization_pending"}, 400)
            return Resp({"access_token": "acc-1", "refresh_token": "ref-1", "expires_in": 3600})
        if data["grant_type"] == "refresh_token":
            return Resp({"access_token": "acc-2", "refresh_token": f"ref-{len(self.token_calls)}", "expires_in": 3600})
        return Resp({"error": "unsupported"}, 400)

    def request(self, method, url, headers=None, timeout=None, json=None, params=None):
        path = url.replace("https://graph.microsoft.com/v1.0", "")
        parts = path.strip("/").split("/")
        if path == "/me":
            return Resp({"displayName": "Mario Techniker", "userPrincipalName": "mario@me-it-demo.at"})
        if path == "/me/todo/lists":
            if method == "POST":
                lid = self.nid("L")
                self.lists[lid] = {"id": lid, "displayName": json["displayName"], "tasks": {}}
                return Resp({"id": lid, "displayName": json["displayName"]}, 201)
            return Resp({"value": [{"id": l["id"], "displayName": l["displayName"]} for l in self.lists.values()]})
        lst = self.lists.get(parts[3]) if len(parts) > 3 else None
        if lst is None:
            return Resp({"error": {"message": "not found"}}, 404)
        if len(parts) == 4:
            return Resp({"id": lst["id"]})
        if len(parts) == 5 and method == "POST":
            tid = self.nid("T")
            lst["tasks"][tid] = {**json, "id": tid, "status": "notStarted", "checklist": {}}
            return Resp({"id": tid}, 201)
        task = lst["tasks"].get(parts[5])
        if task is None:
            return Resp({"error": {"message": "not found"}}, 404)
        if len(parts) == 6:
            if method == "GET":
                return Resp({k: v for k, v in task.items() if k != "checklist"})
            if method == "PATCH":
                task.update(json)
                return Resp({"id": task["id"]})
            if method == "DELETE":
                del lst["tasks"][parts[5]]
                return Resp(None, 204)
        if parts[6] == "checklistItems":
            if len(parts) == 7 and method == "POST":
                cid = self.nid("C")
                task["checklist"][cid] = {"id": cid, "displayName": json["displayName"], "isChecked": json.get("isChecked", False)}
                return Resp(task["checklist"][cid], 201)
            if len(parts) == 7:
                return Resp({"value": list(task["checklist"].values())})
            task["checklist"][parts[7]].update(json)
            return Resp(task["checklist"][parts[7]])
        return Resp({"error": {"message": "unbekannt"}}, 400)


@pytest.fixture()
def todo(ms_app, monkeypatch):
    app, client = ms_app
    fake = FakeTodo()
    monkeypatch.setattr(httpx, "post", fake.post)
    monkeypatch.setattr(httpx, "request", fake.request)
    return app, client, fake


def _tasks(fake):
    lst = next(iter(fake.lists.values()))
    return lst["tasks"]


def test_todo_connect_and_two_way_sync(todo):
    app, client, fake = todo
    db = app.state.ctx.db
    st = client.get("/api/todo").json()
    assert st["configured"] and not st["connected"]
    s = client.post("/api/todo/connect").json()
    assert s["user_code"] == "ABCD-1234" and s["verification_uri"] == "https://microsoft.com/devicelogin"
    assert client.post("/api/todo/connect/poll").json()["status"] == "pending"
    r = client.post("/api/todo/connect/poll").json()
    assert r["status"] == "connected" and r["upn"] == "mario@me-it-demo.at"
    assert fake.token_calls[0]["scope"] == "Tasks.ReadWrite User.Read offline_access"
    assert "client_secret" not in fake.token_calls[1]  # öffentlicher Client, kein Geheimnis
    acc = db.query_one("SELECT * FROM ms_accounts WHERE user_key = 0")
    assert acc["refresh_token"] and "ref-1" not in acc["refresh_token"]
    assert app.state.todo.vault.decrypt(acc["refresh_token"]) == "ref-1"
    assert next(iter(fake.lists.values()))["displayName"] == "ME-IT Cockpit"
    urgent = db.query("SELECT id FROM tickets WHERE status != 'geloest' AND priority IN ('hoch', 'kritisch')")
    assert r["sync"]["created"] == len(urgent) > 0  # ohne Benutzerverwaltung: dringende Tickets
    t = next(t for t in _tasks(fake).values() if t["title"].startswith(f"#{urgent[0]['id']} "))
    assert t["importance"] == "high" and t["linkedResources"][0]["externalId"] == f"ticket:{urgent[0]['id']}"
    assert t["linkedResources"][0]["webUrl"].startswith("http://testserver/#/tickets?ticket=")

    # Eintritt mit Checkliste → Aufgabe mit Unterpunkten und Fälligkeit
    change = client.post("/api/staff", json={"customer_id": 1, "kind": "eintritt", "person": "Max Muster",
                                             "due_date": "2026-12-01", "device": "neu"}).json()
    app.state.todo._access.clear()  # erzwingt Token-Erneuerung über das verschlüsselte Refresh-Token
    stats = client.post("/api/todo/sync").json()
    assert stats["created"] == 1
    task = next(t for t in _tasks(fake).values() if t["title"].startswith("Eintritt: Max Muster"))
    assert task["dueDateTime"] == {"dateTime": "2026-12-01T08:00:00", "timeZone": "W. Europe Standard Time"}
    items = list(task["checklist"].values())
    assert len(items) == change["total"] and items[0]["displayName"] == change["checklist"][0]["text"]
    acc2 = db.query_one("SELECT refresh_token FROM ms_accounts WHERE user_key = 0")["refresh_token"]
    assert app.state.todo.vault.decrypt(acc2) != "ref-1"  # rotiertes Token gespeichert

    # am Handy zwei Schritte abgehakt → im Cockpit abgehakt
    items[0]["isChecked"] = items[1]["isChecked"] = True
    assert client.post("/api/todo/sync").json()["steps_from_todo"] == 2
    c = client.get(f"/api/staff/{change['id']}").json()
    assert c["done"] == 2 and c["checklist"][0]["by"] == "Mario Techniker (To Do)"
    # im Cockpit abgehakt → in To Do abgehakt
    client.post(f"/api/staff/{change['id']}/check", json={"index": 2, "done": True})
    client.post("/api/todo/sync")
    assert items[2]["isChecked"] is True

    # Ticket im Cockpit gelöst → Aufgabe erledigt
    tid = urgent[0]["id"]
    client.put(f"/api/tickets/{tid}", json={"status": "geloest", "solution": "erledigt"})
    assert client.post("/api/todo/sync").json()["completed"] == 1
    assert t["status"] == "completed"
    # Aufgabe in To Do erledigt → Hinweis im Cockpit, Ticket bleibt offen (Lösung fehlt)
    if len(urgent) > 1:
        other = next(x for x in _tasks(fake).values() if x["title"].startswith(f"#{urgent[1]['id']} "))
        other["status"] = "completed"
        assert client.post("/api/todo/sync").json()["done_in_todo"] == 1
        assert db.get("tickets", urgent[1]["id"])["status"] != "geloest"
        assert db.query_one("SELECT note FROM activities WHERE type = 'todo_erledigt'")["note"].startswith("In Microsoft To Do")
    # in To Do gelöschte Aufgabe wird nicht wieder angelegt
    del next(iter(fake.lists.values()))["tasks"][next(k for k, v in _tasks(fake).items() if v["title"].startswith("Eintritt"))]
    client.post("/api/todo/sync")
    assert client.post("/api/todo/sync").json()["created"] == 0

    # Einstellungen: Tickets aus → offene Ticket-Aufgaben verschwinden aus der Liste
    assert client.put("/api/todo/options", json={"tickets": "immer"}).status_code == 422
    client.put("/api/todo/options", json={"tickets": "aus"})
    client.post("/api/todo/sync")
    assert not any(x["title"].startswith("#") and x["status"] != "completed" for x in _tasks(fake).values())
    # Trennen
    client.delete("/api/todo")
    assert client.get("/api/todo").json()["connected"] is False and not db.query("SELECT id FROM todo_links")
    conn = {i["key"]: i for i in client.get("/api/connections").json()["items"]}["todo"]
    assert conn["checks"][0]["level"] == "ok" and "Tasks.ReadWrite" in conn["checks"][0]["text"]


def test_todo_public_client_hint(ms_app, monkeypatch):
    app, client = ms_app
    monkeypatch.setattr(httpx, "post", lambda url, data=None, timeout=None: Resp(
        {"error": "invalid_client", "error_description": "AADSTS7000218: The request body must contain client_assertion."}, 401))
    r = client.post("/api/todo/connect")
    assert r.status_code == 409 and "Öffentliche Clientflows zulassen" in r.json()["detail"]
    assert client.post("/api/todo/sync").status_code == 409
