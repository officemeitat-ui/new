"""Sicher teilen: Einmal-Links für Geheimnisse (verschlüsselt, Schlüssel nur im Link) und Datei-Freigaben."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from meit.share import decrypt, encrypt, token_hash


def _token(url: str) -> str:
    assert "/s#" in url
    return url.split("#", 1)[1]


def test_encryption_key_lives_only_in_the_link():
    payload = encrypt("WLAN: Sommer-2026!", "t" * 43)
    assert "Sommer" not in payload and decrypt(payload, "t" * 43) == "WLAN: Sommer-2026!"
    with pytest.raises(Exception):
        decrypt(payload, "x" * 43)
    with pytest.raises(Exception):  # ein Kennwort ist Teil des Schlüssels
        decrypt(encrypt("geheim", "t" * 43, "kennwort"), "t" * 43, "falsch")
    assert token_hash("abc") != token_hash("abd") and len(token_hash("abc")) == 64


def test_one_time_secret(app, client):
    db = app.state.ctx.db
    assert client.post("/api/shares", json={"kind": "secret", "text": "   "}).status_code == 422
    r = client.post("/api/shares", json={"kind": "secret", "text": "Benutzer: f.huber\nStartpasswort: Wm8#kq-27!", "label": "Startpasswort Franz",
                                         "customer_id": 1, "expires_hours": 24})
    assert r.status_code == 201
    made = r.json()
    token = _token(made["url"])
    assert made["status"] == "offen" and made["max_views"] == 1 and made["mail"] == "" and "payload" not in made
    row = db.query_one("SELECT * FROM shares WHERE id = ?", (made["id"],))
    assert token not in str(row) and "Wm8#kq" not in row["payload"] and row["token_hash"] == token_hash(token)  # nichts Lesbares in der Datenbank
    public = TestClient(app)  # der Empfänger: ohne Anmeldung
    page = public.get("/s")
    assert page.status_code == 200 and "script-src 'self' 'sha256-" in page.headers["content-security-policy"]
    assert page.headers["referrer-policy"] == "no-referrer" and page.headers["cache-control"] == "no-store"
    info = public.post("/api/public/share/info", json={"token": token})
    assert info.json() == {"kind": "secret", "needs_password": False, "expires_at": row["expires_at"], "views_left": 1,
                           "company": info.json()["company"], "from": "Cockpit"} and info.headers["cache-control"] == "no-store"
    assert public.post("/api/public/share/info", json={"token": token}).status_code == 200  # Ansehen der Seite verbraucht nichts
    opened = public.post("/api/public/share/open", json={"token": token}).json()
    assert opened == {"secret": "Benutzer: f.huber\nStartpasswort: Wm8#kq-27!", "views_left": 0}
    # danach: gelöscht, Link tot – für beide Wege dieselbe Antwort
    assert db.scalar("SELECT payload FROM shares WHERE id = ?", (made["id"],)) == ""
    for path in ("info", "open", "download"):
        again = public.post(f"/api/public/share/{path}", json={"token": token})
        assert again.status_code == 404 and "nicht mehr gültig" in again.json()["detail"]
    assert public.post("/api/public/share/info", json={"token": "x" * 43}).status_code == 404
    listed = client.get("/api/shares").json()[0]
    assert listed["status"] == "abgerufen" and listed["views"] == 1 and listed["last_view_at"] and listed["customer"] == "Tischlerei Huber GmbH"
    assert client.get("/api/shares?customer_id=2").json() == []
    log = client.get("/api/audit?limit=20").json()
    actions = [e["action"] for e in log["entries"]]
    assert "Freigabe geöffnet" in actions and "Freigabe-Link erstellt" in actions
    notes = client.get("/api/notifications?limit=10").json()["items"]
    assert any(n["title"] == "Geöffnet: Startpasswort Franz" for n in notes)


def test_password_lockout_views_expiry_and_revoke(app, client):
    db = app.state.ctx.db
    public = TestClient(app)
    locked = client.post("/api/shares", json={"kind": "secret", "text": "Tresor-PIN 4711", "password": "Apfelbaum", "max_views": 3}).json()
    token = _token(locked["url"])
    assert locked["has_password"] and public.post("/api/public/share/info", json={"token": token}).json()["needs_password"] is True
    first = public.post("/api/public/share/open", json={"token": token, "password": "falsch"})
    assert first.status_code == 403 and "noch 4 Versuch" in first.json()["detail"]
    assert public.post("/api/public/share/open", json={"token": token}).status_code == 403  # ohne Kennwort zählt ebenfalls
    assert public.post("/api/public/share/open", json={"token": token, "password": "Apfelbaum"}).json() == {"secret": "Tresor-PIN 4711", "views_left": 2}
    for _ in range(2):
        assert public.post("/api/public/share/open", json={"token": token, "password": "x"}).status_code == 403
    assert public.post("/api/public/share/open", json={"token": token, "password": "x"}).status_code == 404  # 5. Fehlversuch sperrt
    assert public.post("/api/public/share/open", json={"token": token, "password": "Apfelbaum"}).status_code == 404
    row = db.get("shares", locked["id"])
    assert row["payload"] == "" and next(s for s in client.get("/api/shares").json() if s["id"] == locked["id"])["status"] == "gesperrt"
    # mehrfach abrufbar – aber nicht öfter als erlaubt
    multi = _token(client.post("/api/shares", json={"kind": "secret", "text": "WLAN Gast", "max_views": 2}).json()["url"])
    assert [public.post("/api/public/share/open", json={"token": multi}).status_code for _ in range(3)] == [200, 200, 404]
    # abgelaufen
    old = client.post("/api/shares", json={"kind": "secret", "text": "alt", "expires_hours": 1}).json()
    db.query("UPDATE shares SET expires_at = datetime('now', 'localtime', '-1 hour') WHERE id = ?", (old["id"],))
    assert public.post("/api/public/share/open", json={"token": _token(old["url"])}).status_code == 404
    assert next(s for s in client.get("/api/shares").json() if s["id"] == old["id"])["status"] == "abgelaufen"
    assert db.get("shares", old["id"])["payload"] == ""  # Aufräumen löscht den Text abgelaufener Links
    db.query("UPDATE shares SET expires_at = '2020-01-01 00:00:00' WHERE id = ?", (old["id"],))
    assert all(s["id"] != old["id"] for s in client.get("/api/shares").json())  # nach 90 Tagen verschwindet der Eintrag ganz
    # widerrufen
    rev = client.post("/api/shares", json={"kind": "secret", "text": "zurückziehen"}).json()
    assert client.delete(f"/api/shares/{rev['id']}").json() == {"ok": True} and client.delete("/api/shares/99999").status_code == 404
    assert public.post("/api/public/share/open", json={"token": _token(rev["url"])}).status_code == 404
    assert next(s for s in client.get("/api/shares").json() if s["id"] == rev["id"])["status"] == "widerrufen"
    # Grenzen der Eingabe
    assert client.post("/api/shares", json={"kind": "secret", "text": "x", "expires_hours": 24 * 31}).status_code == 422
    assert client.post("/api/shares", json={"kind": "secret", "text": "x", "max_views": 0}).status_code == 422
    assert client.post("/api/shares", json={"kind": "secret", "text": "x", "email": "keine-adresse"}).status_code == 422
    assert "kein Mailversand" in client.post("/api/shares", json={"kind": "secret", "text": "x", "email": "kunde@huber-demo.at"}).json()["mail"]
    assert client.post("/api/shares", json={"kind": "secret", "text": "x", "customer_id": 99999}).status_code == 404


def test_file_share_and_login_boundary(app, client):
    f = client.post("/api/files/upload?ref_type=customer&ref_id=1", content=b"%PDF-1.4 Vertrag", headers={"X-Filename": "Wartungsvertrag 2026.pdf"}).json()
    assert client.post("/api/shares", json={"kind": "file", "attachment_id": 99999}).status_code == 404
    made = client.post("/api/shares", json={"kind": "file", "attachment_id": f["id"], "max_views": 2, "expires_hours": 48}).json()
    token = _token(made["url"])
    assert made["label"] == "Wartungsvertrag 2026.pdf" and made["customer_id"] == 1 and made["kind"] == "file"
    # Anmeldung im Cockpit einschalten: der Empfänger braucht keine, die Verwaltung der Links schon
    client.post("/api/users", json={"name": "Chef", "email": "chef@me-it.test", "role": "admin", "password": "Sehr-Geheim-2026"})
    public = TestClient(app)
    assert public.get("/api/shares").status_code == 401 and public.post("/api/shares", json={"kind": "secret", "text": "x"}).status_code == 401
    info = public.post("/api/public/share/info", json={"token": token}).json()
    assert info["filename"] == "Wartungsvertrag 2026.pdf" and info["size"] == len(b"%PDF-1.4 Vertrag") and info["views_left"] == 2
    assert public.post("/api/public/share/open", json={"token": token}).status_code == 404  # eine Datei ist kein Geheimnis
    got = public.post("/api/public/share/download", json={"token": token})
    assert got.status_code == 200 and got.content == b"%PDF-1.4 Vertrag" and got.headers["x-views-left"] == "1"
    assert "Wartungsvertrag%202026.pdf" in got.headers["content-disposition"] and got.headers["cache-control"] == "no-store"
    assert public.post("/api/public/share/download", json={"token": token}).status_code == 200
    assert public.post("/api/public/share/download", json={"token": token}).status_code == 404
    # zu viele Versuche von einer Adresse werden gebremst
    codes = [public.post("/api/public/share/open", json={"token": "y" * 43}).status_code for _ in range(32)]
    assert codes[0] == 404 and codes[-1] == 429
