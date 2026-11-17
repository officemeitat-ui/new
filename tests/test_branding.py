"""Corporate Design: öffentliche Assets, Farben, Logo-Upload."""

import base64
import dataclasses

from fastapi.testclient import TestClient

from meit.main import create_app

PNG_1PX = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def test_public_assets_and_defaults(settings):
    app = create_app(dataclasses.replace(settings, app_password="geheim"))
    c = TestClient(app)
    assert c.get("/api/customers").status_code == 401
    b = c.get("/api/public/branding").json()  # öffentlich, auch mit Passwortschutz
    assert b["brand"] == "#00bcd4" and b["accent"] == "#f79007" and b["tagline"] == "sicher | innovativ | persönlich"
    assert c.get("/brand/logo").content[:4] == b"\x89PNG"
    assert c.get("/brand/fonts/Roboto-Regular.woff2").status_code == 200
    assert c.get("/brand/fonts/../main.py").status_code == 404
    assert c.get("/brand/fonts/evil.txt").status_code == 404


def test_update_colors_and_logo(client):
    r = client.put("/api/branding", json={"colors": {"accent": "#FF0000"}, "tagline": "Test-Claim"})
    assert r.json()["accent"] == "#ff0000" and r.json()["tagline"] == "Test-Claim"
    assert client.put("/api/branding", json={"colors": {"accent": "rot"}}).status_code == 422
    assert client.put("/api/branding", json={"colors": {"unbekannt": "#000000"}}).status_code == 422
    assert client.put("/api/branding/logo", content=b"<svg onload=alert(1)>", headers={"Content-Type": "image/svg+xml"}).status_code == 415
    assert client.put("/api/branding/logo", content=PNG_1PX, headers={"Content-Type": "image/png"}).status_code == 200
    assert client.get("/brand/logo").content == PNG_1PX
    client.post("/api/branding/reset")
    assert client.get("/api/public/branding").json()["accent"] == "#f79007"
    assert client.get("/brand/logo").content != PNG_1PX


def test_invoice_uses_branding(client):
    from datetime import date
    client.post("/api/billing/run", json={"period": date.today().strftime("%Y-%m")})
    inv = client.get("/api/invoices").json()[0]
    page = client.get(f"/api/invoices/{inv['id']}/html").text
    assert "/brand/logo" in page and "#00bcd4" in page and "https://www.meit.at" in page
