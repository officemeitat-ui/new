"""Sicherheitsprüfung: Größenlimits, Browser-Schutzregel (CSP), CSV-Formeln, Passwörter, Zwei-Faktor-Anmeldung."""

from __future__ import annotations

import base64
import hashlib
import re
import time

from fastapi.testclient import TestClient

from meit import team
from meit.hardening import csv_safe, limit_for, script_hashes, totp_at, totp_verify
from meit.main import STATIC_DIR


def test_body_limits(client):
    assert limit_for("/api/public/inquiry") == 64 * 1024 and limit_for("/api/portal/tickets/5/attachments") == 21 * 1024 * 1024
    assert limit_for("/api/portal/tickets/5/comment") == 64 * 1024
    big = {"name": "A", "email": "a@b-demo.at", "message": "x" * 200_000}
    r = client.post("/api/public/inquiry", json=big)
    assert r.status_code == 413 and "zu groß" in r.json()["detail"]
    # ohne Content-Length (gestückelt gesendet) greift das Limit beim Einlesen
    r = client.post("/api/portal/login", content=(b"x" * 20_000 for _ in range(10)), headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert client.post("/api/public/inquiry", json={"name": "Eva", "email": "eva@neu-demo.at", "message": "Bitte um Rückruf"}).status_code == 201
    assert client.post("/api/inbox/upload", content=b"x" * (27 * 1024 * 1024), headers={"X-Filename": "a.eml"}).status_code == 413


def test_csp_and_headers(client):
    for path, page in (("/", "index.html"), ("/portal", "portal.html"), ("/anfrage", "anfrage.html")):
        r = client.get(path)
        csp = r.headers["content-security-policy"]
        assert "default-src 'self'" in csp and "object-src 'none'" in csp and "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]
        for h in script_hashes(STATIC_DIR / page):
            assert h in csp
        assert r.headers["x-content-type-options"] == "nosniff"
    portal = (STATIC_DIR / "portal.html").read_text(encoding="utf-8")
    inline = re.search(r"<script>(.*?)</script>", portal, re.S).group(1)
    expected = "'sha256-" + base64.b64encode(hashlib.sha256(inline.encode()).digest()).decode() + "'"
    assert script_hashes(STATIC_DIR / "portal.html") == [expected]
    assert "frame-ancestors 'none'" in client.get("/portal").headers["content-security-policy"]
    assert client.get("/portal").headers["x-frame-options"] == "DENY" and "x-frame-options" not in client.get("/anfrage").headers
    assert client.get("/api/auth/status").headers["cache-control"] == "no-store"
    # Rechnungsansicht ohne eingebettetes Skript
    inv = client.get("/api/invoices").json()
    assert client.get("/brand/print.js").status_code == 200
    if inv:
        html = client.get(f"/api/invoices/{inv[0]['id']}/html").text
        assert "onclick" not in html and "/brand/print.js" in html


def test_csv_formula_injection(app, client):
    assert csv_safe("=1+1") == "'=1+1" and csv_safe("@SUM(A1)") == "'@SUM(A1)" and csv_safe("Huber GmbH") == "Huber GmbH"
    assert csv_safe(12.5) == 12.5
    db = app.state.ctx.db
    db.insert("receipts", {"vendor": '=HYPERLINK("http://boese.example","Klick")', "invoice_no": "+4711", "invoice_date": "2026-11-01",
                           "amount": 10.0, "status": "geprueft", "note": "-2+3"})
    out = client.get("/api/receipts/export.csv?status=geprueft").text
    assert "'=HYPERLINK" in out and ";'+4711;" in out and "'-2+3" in out and ";=HYPERLINK" not in out


def _admin(client, password="Sehr-Geheim-2026"):
    r = client.post("/api/users", json={"name": "Chef", "email": "chef@me-it.test", "role": "admin", "password": password})
    assert r.status_code == 201, r.text
    assert client.post("/api/auth/login", json={"email": "chef@me-it.test", "password": password}).status_code == 200
    return r.json()


def test_password_rehash_and_timing_guard(app, client, monkeypatch):
    db = app.state.ctx.db
    u = _admin(client)
    old = team.hash_password.__globals__["PBKDF2_ROUNDS"]
    assert old >= 600_000
    monkeypatch.setattr(team, "PBKDF2_ROUNDS", 1000)
    weak = team.hash_password("Sehr-Geheim-2026")
    monkeypatch.setattr(team, "PBKDF2_ROUNDS", old)
    db.update("users", u["id"], {"password_hash": weak})
    assert team.needs_rehash(weak)
    assert TestClient(app).post("/api/auth/login", json={"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    assert not team.needs_rehash(db.get("users", u["id"])["password_hash"])  # beim Anmelden erneuert
    called = []
    monkeypatch.setattr(team, "dummy_verify", lambda pw: called.append(pw))
    assert TestClient(app).post("/api/auth/login", json={"email": "gibtsnicht@me-it.test", "password": "x"}).status_code == 401
    assert called == ["x"]


def test_totp_rfc_vector():
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert totp_at(secret, 59 // 30) == "287082"  # RFC 6238, SHA-1, T=59 (letzte 6 Stellen von 94287082)
    assert totp_verify(secret, "287 082", now=59) == 1 and totp_verify(secret, "287082", last_step=1, now=59) is None
    assert totp_verify(secret, "000000", now=59) is None and totp_verify(secret, "12345", now=59) is None


def test_two_factor_login_flow(app, client):
    db = app.state.ctx.db
    u = _admin(client)
    assert client.get("/api/auth/2fa").json() == {"available": True, "enabled": False, "recovery_left": 0}
    s = client.post("/api/auth/2fa/setup").json()
    secret = s["secret"].replace(" ", "")
    assert s["uri"].startswith("otpauth://totp/") and s["qr"].startswith("data:image/svg+xml")
    stored = db.get("users", u["id"])["totp_secret"]
    assert stored and secret not in stored  # verschlüsselt gespeichert
    assert client.post("/api/auth/2fa/enable", json={"code": "000000"}).status_code == 422
    now_step = int(time.time() // 30)
    r = client.post("/api/auth/2fa/enable", json={"code": totp_at(secret, now_step)}).json()
    codes = r["recovery_codes"]
    assert r["enabled"] and len(codes) == 10 and client.get("/api/users").json()[0]["totp_enabled"] is True

    fresh = TestClient(app)
    login = {"email": "chef@me-it.test", "password": "Sehr-Geheim-2026"}
    r = fresh.post("/api/auth/login", json=login)
    assert r.status_code == 401 and r.json()["totp_required"] is True and "meit_session" not in fresh.cookies
    assert fresh.post("/api/auth/login", json={**login, "code": "111111"}).status_code == 401
    # derselbe Code ein zweites Mal (Mitlesen/Wiederholung) wird abgelehnt
    assert fresh.post("/api/auth/login", json={**login, "code": totp_at(secret, now_step)}).status_code == 401
    ok = fresh.post("/api/auth/login", json={**login, "code": totp_at(secret, now_step + 1)})
    assert ok.status_code == 200 and fresh.get("/api/customers").status_code == 200
    # Wiederherstellungscode gilt genau einmal
    other = TestClient(app)
    assert other.post("/api/auth/login", json={**login, "code": codes[0]}).status_code == 200
    assert TestClient(app).post("/api/auth/login", json={**login, "code": codes[0]}).status_code in (401, 429)
    assert client.get("/api/auth/2fa").json()["recovery_left"] == 9
    # Verbindungs-Center meldet den Status; Admin kann zurücksetzen (Handy verloren)
    items = {i["key"]: i for i in fresh.get("/api/connections").json()["items"]}
    assert any("Alle Admins mit Zwei-Faktor-Anmeldung" in c["text"] for c in items["login"]["checks"])
    assert fresh.post(f"/api/users/{u['id']}/2fa/reset").json()["ok"]
    assert fresh.get("/api/customers").status_code == 401  # Sitzungen beendet
    assert TestClient(app).post("/api/auth/login", json=login).status_code == 200


def test_two_factor_disable_needs_password_and_code(app, client):
    u = _admin(client)
    secret = client.post("/api/auth/2fa/setup").json()["secret"].replace(" ", "")
    step = int(time.time() // 30)
    client.post("/api/auth/2fa/enable", json={"code": totp_at(secret, step)})
    assert client.post("/api/auth/2fa/disable", json={"password": "falsch", "code": totp_at(secret, step + 1)}).status_code == 403
    assert client.post("/api/auth/2fa/disable", json={"password": "Sehr-Geheim-2026", "code": "000000"}).status_code == 403
    assert client.post("/api/auth/2fa/disable", json={"password": "Sehr-Geheim-2026", "code": totp_at(secret, step + 1)}).json() == {"enabled": False}
    assert app.state.ctx.db.get("users", u["id"])["totp_secret"] == ""
