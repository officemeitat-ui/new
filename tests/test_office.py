"""Office-Anbindung: Dokumente erzeugen, Vorlagen füllen, Discovery, WOPI (Token, Sperren, Speichern, Versionen)."""

from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree as ET

import httpx
import pytest
from fastapi.testclient import TestClient

from meit.office import editor_url, fill_template, fill_xml, letter_docx, new_docx, new_xlsx, parse_discovery, same_time

COLLABORA = """<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery><net-zone name="external-http">
<app name="writer"><action default="true" ext="docx" name="edit" urlsrc="https://office.me-it.test/browser/abc123/cool.html?"/>
<action ext="odt" name="edit" urlsrc="https://office.me-it.test/browser/abc123/cool.html?"/></app>
<app name="calc"><action ext="xlsx" name="edit" urlsrc="https://office.me-it.test/browser/abc123/cool.html?"/></app>
<app name="draw"><action ext="pdf" name="view_comment" urlsrc="https://office.me-it.test/browser/abc123/cool.html?"/></app>
</net-zone></wopi-discovery>"""

ONLYOFFICE = """<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery><net-zone name="external-https"><app name="Word">
<action name="view" ext="docx" urlsrc="https://oo.me-it.test/hosting/wopi/word/view?&amp;&lt;rs=DC_LLCC&amp;&gt;&lt;dchat=DISABLE_CHAT&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;"/>
<action name="edit" ext="docx" requires="locks,update" urlsrc="https://oo.me-it.test/hosting/wopi/word/edit?&amp;&lt;rs=DC_LLCC&amp;&gt;&lt;ui=UI_LLCC&amp;&gt;"/>
</app></net-zone></wopi-discovery>"""


class Resp:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


def parts(data: bytes) -> dict[str, str]:
    z = zipfile.ZipFile(io.BytesIO(data))
    return {n: z.read(n).decode("utf-8") for n in z.namelist()}


# ----------------------------------------------------------------------------- Dokumente und Vorlagen
def test_generated_documents_are_wellformed():
    for data, main in ((new_docx(), "word/document.xml"), (new_xlsx(), "xl/worksheets/sheet1.xml")):
        files = parts(data)
        assert "[Content_Types].xml" in files and "_rels/.rels" in files and main in files
        for name, xml in files.items():
            ET.fromstring(xml.encode())  # jede Teil-Datei ist gültiges XML
        assert main.split("/")[0] + "/" in files["_rels/.rels"]
    letter = parts(letter_docx({"name": "ME-IT & Co", "address": "Musterweg 1\n5400 Hallein"},
                               {"name": "Tischlerei <Huber>", "contact_name": "Franz Huber", "address": "Dorf 5, 5020 Salzburg"}))
    doc = letter["word/document.xml"]
    ET.fromstring(doc.encode())
    assert "ME-IT &amp; Co" in doc and "Tischlerei &lt;Huber&gt;" in doc and "5020 Salzburg" in doc and "Mit freundlichen Grüßen" in doc


def test_template_placeholders_also_when_split_into_runs():
    xml = ('<w:document xmlns:w="x"><w:p><w:r><w:t>Für {{kunde}} am {{ Datum }}</w:t></w:r></w:p>'
           '<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ansprechpartner</w:t></w:r><w:r><w:t>}} {{unbekannt}}</w:t></w:r></w:p></w:document>')
    out, n = fill_xml(xml, {"kunde": "Huber & Söhne", "datum": "19.11.2026", "ansprechpartner": "Franz"})
    ET.fromstring(out.encode())
    assert n == 3 and "Huber &amp; Söhne am 19.11.2026" in out and ">Franz" in out and "{{unbekannt}}" in out
    docx = new_docx(['<w:p><w:r><w:t>Vertrag mit {{kunde}}</w:t></w:r></w:p>'])
    filled, count = fill_template(docx, {"kunde": "Steiner GmbH"})
    assert count == 1 and "Vertrag mit Steiner GmbH" in parts(filled)["word/document.xml"]
    with pytest.raises(Exception):
        fill_template(b"kein zip", {})


def test_discovery_and_editor_url():
    c = parse_discovery(COLLABORA)
    assert c["product"] == "Collabora Online" and c["editable"] == ["docx", "odt", "xlsx"] and "pdf" in c["viewable"]
    url = editor_url(c["actions"]["docx"]["edit"], "https://cockpit.me-it.test/wopi/files/7")
    assert url == "https://office.me-it.test/browser/abc123/cool.html?WOPISrc=https%3A%2F%2Fcockpit.me-it.test%2Fwopi%2Ffiles%2F7&lang=de"
    o = parse_discovery(ONLYOFFICE)
    assert o["product"] == "ONLYOFFICE Docs" and o["editable"] == ["docx"]
    ourl = editor_url(o["actions"]["docx"]["edit"], "https://cockpit.me-it.test/wopi/files/7")
    assert ourl.startswith("https://oo.me-it.test/hosting/wopi/word/edit?&rs=de-DE&ui=de-DE&WOPISrc=https%3A%2F%2F") and "<" not in ourl
    for bad in ("<html>nein</html>", "kein xml", '<!DOCTYPE x [<!ENTITY a "b">]><wopi-discovery/>'):
        with pytest.raises(Exception):
            parse_discovery(bad)
    assert same_time("2026-11-19T10:00:00.000000Z", "2026-11-19T10:00:00Z") and not same_time("2026-11-19T10:00:00Z", "2026-11-19T10:00:01Z")


# ----------------------------------------------------------------------------- Cockpit + simulierter Office-Server
@pytest.fixture()
def office(app, client, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda url, **kw: Resp(COLLABORA) if url.endswith("/hosting/discovery") else Resp("", 404))
    r = client.put("/api/office/settings", json={"enabled": True, "url": "https://office.me-it.test/",
                                                 "cockpit_url": "https://cockpit.me-it.test"})
    assert r.status_code == 200 and r.json()["product"] == "Collabora Online" and r.json()["url"] == "https://office.me-it.test"
    return app, client


def test_settings_validation_and_csp(app, client, monkeypatch):
    assert client.put("/api/office/settings", json={"url": "office ohne schema"}).status_code == 422
    assert client.put("/api/office/settings", json={"allowed_ips": ["kein-ip"]}).status_code == 422
    assert "office.me-it.test" not in client.get("/").headers["content-security-policy"]
    monkeypatch.setattr(httpx, "get", lambda url, **kw: Resp(COLLABORA))
    client.put("/api/office/settings", json={"enabled": True, "url": "https://office.me-it.test"})
    csp = client.get("/").headers["content-security-policy"]
    assert "frame-src 'self' https://office.me-it.test" in csp and "form-action 'self' https://office.me-it.test" in csp
    assert "office.me-it.test" not in client.get("/portal").headers["content-security-policy"]  # nur im Cockpit
    t = client.post("/api/office/test").json()
    assert t["product"] == "Collabora Online" and t["types"] == 4 and any("Erlaubte Adressen" in h for h in t["hints"])
    monkeypatch.setattr(httpx, "get", lambda url, **kw: Resp("", 404))
    assert client.post("/api/office/test").status_code == 502
    items = {i["key"]: i for i in client.get("/api/connections").json()["items"]}
    assert items["office"]["configured"] and any("Keine erlaubten Adressen" in c["text"] for c in items["office"]["checks"])


def test_files_new_upload_template_versions(office):
    app, client = office
    f = client.post("/api/files/new", json={"ref_type": "library", "kind": "text", "name": "Vertrag Vorlage"}).json()
    assert f["filename"] == "Vertrag Vorlage.docx" and f["office"] == "edit" and f["versions"] == 0
    t = client.post("/api/files/new", json={"ref_type": "customer", "ref_id": 1, "kind": "table"}).json()
    assert t["ext"] == "xlsx" and t["ref_id"] == 1
    letter = client.post("/api/files/new", json={"ref_type": "customer", "ref_id": 1, "kind": "letter", "name": "Kündigung"}).json()
    assert "Tischlerei Huber GmbH" in parts(client.get(f"/api/attachments/{letter['id']}/download").content)["word/document.xml"]
    assert client.post("/api/files/new", json={"ref_type": "customer", "ref_id": 9999}).status_code == 404
    # Vorlage hochladen, als Vorlage markieren, für einen Kunden ausfüllen
    tpl_data = new_docx(['<w:p><w:r><w:t>Wartungsvertrag {{kunde}}, {{datum}} – {{firma}}</w:t></w:r></w:p>'])
    up = client.post("/api/files/upload?ref_type=library", content=tpl_data, headers={"X-Filename": "Wartungsvertrag.docx"}).json()
    assert client.put(f"/api/files/{up['id']}", json={"template": True}).json()["template"] is True
    made = client.post(f"/api/files/{up['id']}/from-template", json={"customer_id": 2}).json()
    assert made["replaced"] == 3 and made["ref_type"] == "customer" and made["ref_id"] == 2 and made["filename"].startswith("Wartungsvertrag – ")
    text = parts(client.get(f"/api/attachments/{made['id']}/download").content)["word/document.xml"]
    assert "Wartungsvertrag Steuerberatung Gruber &amp; Partner" in text and "{{" not in text
    lib = client.get("/api/files?ref_type=library").json()
    assert lib["office"] is True and [x["filename"] for x in lib["files"]][0] == "Wartungsvertrag.docx"  # Vorlagen zuerst
    assert len(client.get("/api/files?ref_type=customer&ref_id=1").json()["files"]) == 2
    # Umbenennen behält die Endung; gefährliche Namen/Uploads werden abgelehnt
    assert client.put(f"/api/files/{f['id']}", json={"filename": "Rahmenvertrag.exe"}).json()["filename"] == "Rahmenvertrag.exe.docx"
    assert client.post("/api/files/upload?ref_type=library", content=b"MZ", headers={"X-Filename": "tool.exe"}).status_code == 422
    assert client.get("/api/files?ref_type=quatsch").status_code == 422


def test_wopi_roundtrip_locks_and_versions(office):
    app, client = office
    db = app.state.ctx.db
    f = client.post("/api/files/new", json={"ref_type": "customer", "ref_id": 1, "kind": "text", "name": "Protokoll"}).json()
    o = client.post(f"/api/office/open/{f['id']}").json()
    assert o["mode"] == "edit" and o["wopi_src"] == f"https://cockpit.me-it.test/wopi/files/{f['id']}"
    assert o["action_url"].startswith("https://office.me-it.test/browser/abc123/cool.html?WOPISrc=https%3A%2F%2Fcockpit")
    assert o["access_token_ttl"] > 1_700_000_000_000 and db.scalar("SELECT COUNT(*) FROM office_tokens WHERE token_hash = ?", (o["access_token"],)) == 0
    server = TestClient(app)  # der Office-Server: keine Cockpit-Anmeldung, nur das Token
    base, tok = f"/wopi/files/{f['id']}", {"access_token": o["access_token"]}
    assert server.get(base).status_code == 401 and server.get(base, params={"access_token": "falsch"}).status_code == 401
    info = server.get(base, params=tok).json()
    assert info["BaseFileName"] == "Protokoll.docx" and info["UserCanWrite"] is True and info["SupportsLocks"] is True
    assert info["Size"] == f["size"] and info["UserFriendlyName"] == "Cockpit" and info["PostMessageOrigin"] == "https://cockpit.me-it.test"
    original = server.get(base + "/contents", params=tok)
    assert original.status_code == 200 and original.content[:2] == b"PK"
    # Sperren: setzen, fremde Sperre → 409 mit aktueller Sperre, abfragen, verlängern
    lock = {"X-WOPI-Override": "LOCK", "X-WOPI-Lock": "sitzung-A"}
    assert server.post(base, params=tok, headers=lock).status_code == 200
    other = server.post(base, params=tok, headers={"X-WOPI-Override": "LOCK", "X-WOPI-Lock": "sitzung-B"})
    assert other.status_code == 409 and other.headers["x-wopi-lock"] == "sitzung-A"
    assert server.post(base, params=tok, headers={"X-WOPI-Override": "GET_LOCK"}).headers["x-wopi-lock"] == "sitzung-A"
    assert server.post(base, params=tok, headers={"X-WOPI-Override": "REFRESH_LOCK", "X-WOPI-Lock": "sitzung-A"}).status_code == 200
    assert client.get(f"/api/files?ref_type=customer&ref_id=1").json()["files"][0]["locked"] is True
    # Speichern: ohne passende Sperre abgelehnt, mit Sperre gespeichert, vorheriger Stand als Version
    new_content = new_docx(['<w:p><w:r><w:t>Besprechung vom 19.11.</w:t></w:r></w:p>'])
    put = {"X-WOPI-Override": "PUT", "X-WOPI-Lock": "sitzung-A"}
    assert server.post(base + "/contents", params=tok, content=new_content, headers={"X-WOPI-Override": "PUT", "X-WOPI-Lock": "falsch"}).status_code == 409
    saved = server.post(base + "/contents", params=tok, content=new_content, headers={**put, "X-COOL-WOPI-Timestamp": info["LastModifiedTime"]})
    assert saved.status_code == 200 and saved.json()["LastModifiedTime"].endswith("Z")
    assert client.get(f"/api/attachments/{f['id']}/download").content == new_content
    after = client.get(f"/api/files?ref_type=customer&ref_id=1").json()["files"][0]
    assert after["versions"] == 1 and after["updated_by"] == "Cockpit" and after["size"] == len(new_content)
    # zwischenzeitlich geändert (alter Zeitstempel) → Konflikt statt Überschreiben
    stale = server.post(base + "/contents", params=tok, content=b"PK-alt", headers={**put, "X-COOL-WOPI-Timestamp": "2020-01-01T00:00:00.000000Z"})
    assert stale.status_code == 409 and stale.json()["COOLStatusCode"] == 1010
    # automatisches Speichern kurz danach erzeugt keine weitere Version
    again = new_docx(['<w:p><w:r><w:t>Besprechung, ergänzt</w:t></w:r></w:p>'])
    assert server.post(base + "/contents", params=tok, content=again, headers=put).status_code == 200
    assert len(client.get(f"/api/files/{f['id']}/versions").json()) == 1
    # Wiederherstellen ist gesperrt, solange der Editor offen ist; nach dem Entsperren möglich
    vid = client.get(f"/api/files/{f['id']}/versions").json()[0]["id"]
    assert client.post(f"/api/files/{f['id']}/versions/{vid}/restore").status_code == 409
    assert server.post(base, params=tok, headers={"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": "falsch"}).status_code == 409
    assert server.post(base, params=tok, headers={"X-WOPI-Override": "UNLOCK", "X-WOPI-Lock": "sitzung-A"}).status_code == 200
    restored = client.post(f"/api/files/{f['id']}/versions/{vid}/restore").json()
    assert restored["size"] == f["size"] and client.get(f"/api/attachments/{f['id']}/download").content == original.content
    # Speichern nach dem Entsperren (Collabora entsperrt teils vor dem letzten Speichern) wird angenommen
    assert server.post(base + "/contents", params=tok, content=again, headers={"X-WOPI-Override": "PUT"}).status_code == 200
    assert server.post(base, params=tok, headers={"X-WOPI-Override": "PUT_RELATIVE"}).status_code == 501


def test_wopi_token_scope_readonly_expiry_and_ip(office):
    app, client = office
    db = app.state.ctx.db
    a = client.post("/api/files/new", json={"ref_type": "library", "kind": "text", "name": "A"}).json()
    b = client.post("/api/files/new", json={"ref_type": "library", "kind": "table", "name": "B"}).json()
    server = TestClient(app)
    tok_a = client.post(f"/api/office/open/{a['id']}").json()["access_token"]
    # Token gilt nur für genau diese Datei
    assert server.get(f"/wopi/files/{b['id']}", params={"access_token": tok_a}).status_code == 401
    assert server.get(f"/wopi/files/{b['id']}/contents", params={"access_token": tok_a}).status_code == 401
    # Nur-Lesen: kein Speichern, kein Sperren
    ro = client.post(f"/api/office/open/{a['id']}?view=true").json()
    assert ro["mode"] == "view" and ro["action"] == "edit"  # Collabora bietet für docx nur „edit“ – das Recht steckt im Token
    rt = {"access_token": ro["access_token"]}
    assert server.get(f"/wopi/files/{a['id']}", params=rt).json()["UserCanWrite"] is False
    assert server.post(f"/wopi/files/{a['id']}/contents", params=rt, content=b"x", headers={"X-WOPI-Override": "PUT"}).status_code == 401
    pdf = client.post("/api/files/upload?ref_type=library", content=b"%PDF-1.4 test", headers={"X-Filename": "info.pdf"}).json()
    view = client.post(f"/api/office/open/{pdf['id']}").json()
    assert view["mode"] == "view" and view["action"] == "view_comment"
    vt = {"access_token": view["access_token"]}
    assert server.get(f"/wopi/files/{pdf['id']}", params=vt).json()["UserCanWrite"] is False
    assert server.post(f"/wopi/files/{pdf['id']}/contents", params=vt, content=b"x", headers={"X-WOPI-Override": "PUT"}).status_code == 401
    assert server.post(f"/wopi/files/{pdf['id']}", params=vt, headers={"X-WOPI-Override": "LOCK", "X-WOPI-Lock": "L"}).status_code == 401
    # nicht unterstützter Dateityp
    z = client.post("/api/files/upload?ref_type=library", content=b"PK\x03\x04zip", headers={"X-Filename": "archiv.zip"}).json()
    assert z["office"] == "" and client.post(f"/api/office/open/{z['id']}").status_code == 409
    # abgelaufenes Token
    db.query("UPDATE office_tokens SET expires_at = '2020-01-01 00:00:00'")
    assert server.get(f"/wopi/files/{a['id']}", params={"access_token": tok_a}).status_code == 401
    # erlaubte Adressen: der Test-Client kommt von „testclient“ → abgelehnt, sobald eine Liste gesetzt ist
    client.put("/api/office/settings", json={"allowed_ips": ["10.0.0.5", "192.168.10.0/24"]})
    fresh = client.post(f"/api/office/open/{a['id']}").json()["access_token"]
    assert server.get(f"/wopi/files/{a['id']}", params={"access_token": fresh}).status_code == 401
    client.put("/api/office/settings", json={"allowed_ips": []})
    assert server.get(f"/wopi/files/{a['id']}", params={"access_token": fresh}).status_code == 200
    # zu große Datei beim Speichern; Löschen räumt Token, Sperren und Versionen mit auf
    big = server.post(f"/wopi/files/{a['id']}/contents", params={"access_token": fresh}, content=b"x" * (22 * 1024 * 1024),
                      headers={"X-WOPI-Override": "PUT"})
    assert big.status_code == 413
    client.delete(f"/api/attachments/{a['id']}")
    assert db.scalar("SELECT COUNT(*) FROM office_tokens WHERE attachment_id = ?", (a["id"],)) == 0
    assert server.get(f"/wopi/files/{a['id']}", params={"access_token": fresh}).status_code == 401


def test_office_not_configured(client):
    f = client.post("/api/files/new", json={"ref_type": "library", "kind": "text", "name": "X"}).json()
    assert f["office"] == "" and client.get("/api/files").json()["office"] is False
    r = client.post(f"/api/office/open/{f['id']}")
    assert r.status_code == 409 and "nicht eingerichtet" in r.json()["detail"]
    assert client.get(f"/api/attachments/{f['id']}/download").status_code == 200  # Herunterladen geht immer


def test_version_download_and_portal_share(office):
    app, client = office
    db = app.state.ctx.db
    f = client.post("/api/files/new", json={"ref_type": "customer", "ref_id": 1, "kind": "text", "name": "Übergabe & Protokoll"}).json()
    assert f["filename"] == "Übergabe & Protokoll.docx"  # „&“ und Umlaute bleiben im Namen erhalten
    first = client.get(f"/api/attachments/{f['id']}/download").content
    tok = {"access_token": client.post(f"/api/office/open/{f['id']}").json()["access_token"]}
    server = TestClient(app)
    changed = new_docx(['<w:p><w:r><w:t>Neu</w:t></w:r></w:p>'])
    assert server.post(f"/wopi/files/{f['id']}/contents", params=tok, content=changed, headers={"X-WOPI-Override": "PUT"}).status_code == 200
    vid = client.get(f"/api/files/{f['id']}/versions").json()[0]["id"]
    old = client.get(f"/api/files/{f['id']}/versions/{vid}/download")
    assert old.status_code == 200 and old.content == first and "Version" in old.headers["content-disposition"]
    assert client.get(f"/api/files/{f['id']}/versions/99999/download").status_code == 404
    other = client.post("/api/files/new", json={"ref_type": "library", "kind": "text", "name": "Fremd"}).json()
    assert client.get(f"/api/files/{other['id']}/versions/{vid}/download").status_code == 404  # Version gehört zu einer anderen Datei
    # Kundenportal: nur ausdrücklich freigegebene Dateien des eigenen Kunden
    def portal_login(customer_id: int, email: str) -> TestClient:
        pu = client.post(f"/api/customers/{customer_id}/portal-users", json={"name": "Portal Nutzer", "email": email}).json()
        c = TestClient(app)
        assert c.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
        return c

    mine, foreign = portal_login(1, "chef@huber-demo.at"), portal_login(2, "office@gruber-demo.at")
    assert mine.get("/api/portal/files").json() == [] and mine.get(f"/api/portal/attachments/{f['id']}").status_code == 404
    client.put(f"/api/files/{f['id']}", json={"customer_visible": True})
    shared = mine.get("/api/portal/files").json()
    assert [s["name"] for s in shared] == ["Übergabe & Protokoll.docx"]
    assert mine.get(f"/api/portal/attachments/{f['id']}").content == changed
    assert foreign.get("/api/portal/files").json() == [] and foreign.get(f"/api/portal/attachments/{f['id']}").status_code == 404
    # Vorlagen und die eigene Ablage sind nie im Portal sichtbar, auch nicht mit Freigabe-Haken
    client.put(f"/api/files/{other['id']}", json={"customer_visible": True})
    assert mine.get(f"/api/portal/attachments/{other['id']}").status_code == 404


def test_tokens_of_deactivated_users_and_log_redaction(office):
    import logging

    from meit.hardening import RedactTokens

    app, client = office
    db = app.state.ctx.db
    f = client.post("/api/files/new", json={"ref_type": "library", "kind": "text", "name": "Intern"}).json()
    tok = client.post(f"/api/office/open/{f['id']}").json()["access_token"]
    uid = db.insert("users", {"name": "Ehemalige Kollegin", "email": "alt@me-it.test", "role": "technik", "password_hash": "x", "active": 1})
    db.query("UPDATE office_tokens SET user_id = ?", (uid,))
    server = TestClient(app)
    assert server.get(f"/wopi/files/{f['id']}", params={"access_token": tok}).status_code == 200
    db.update("users", uid, {"active": 0})
    assert server.get(f"/wopi/files/{f['id']}", params={"access_token": tok}).status_code == 401
    # Zugriffstoken tauchen nicht im Zugriffsprotokoll auf
    assert any(isinstance(flt, RedactTokens) for flt in logging.getLogger("uvicorn.access").filters)
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("10.0.0.5:1", "GET", f"/wopi/files/7/contents?access_token={tok}&x=1", "1.1", 200), None)
    RedactTokens().filter(rec)
    assert tok not in rec.getMessage() and "access_token=***&x=1" in rec.getMessage()
