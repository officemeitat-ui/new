"""Stoppuhr (Zeiterfassung) und Cockpit als App (Manifest, Service Worker, Icons)."""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from meit.main import create_app


def _rewind(app, minutes: int) -> None:
    started = (datetime.now() - timedelta(minutes=minutes)).replace(microsecond=0).isoformat(sep=" ")
    app.state.ctx.db.query("UPDATE timers SET started_at = ?", (started,))


def test_timer_on_ticket_books_time(client, app):
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "Server langsam"}).json()["id"]
    r = client.post("/api/timer/start", json={"ticket_id": tid}).json()
    assert r["timer"]["ticket_title"] == "Server langsam" and r["booked"] is None
    assert client.get(f"/api/tickets/{tid}").json()["status"] == "in_arbeit"
    _rewind(app, 25)
    assert 24 * 60 <= client.get("/api/timer").json()["timer"]["elapsed_s"] <= 26 * 60
    entry = client.post("/api/timer/stop", json={}).json()["entry"]
    assert entry["ticket_id"] == tid and entry["customer_id"] == 1 and 25 <= entry["minutes"] <= 26
    assert entry["description"] == "Server langsam"
    assert client.get(f"/api/tickets/{tid}").json()["time_spent_min"] >= 25
    assert client.get("/api/timer").json()["timer"] is None
    assert client.post("/api/timer/stop", json={}).status_code == 422


def test_starting_new_timer_books_running_one(client, app):
    client.post("/api/timer/start", json={"customer_id": 2, "note": "Telefonsupport"})
    _rewind(app, 10)
    r = client.post("/api/timer/start", json={"customer_id": 3}).json()
    assert r["booked"]["customer_id"] == 2 and r["booked"]["minutes"] >= 10 and r["booked"]["description"] == "Telefonsupport"
    assert r["timer"]["customer_id"] == 3
    assert client.delete("/api/timer").json() == {"ok": True}
    assert client.get("/api/timer").json()["timer"] is None


def test_timer_without_customer_needs_one_on_stop(client):
    client.post("/api/timer/start", json={"note": "Recherche"})
    assert client.post("/api/timer/stop", json={}).status_code == 422
    entry = client.post("/api/timer/stop", json={"customer_id": 4, "minutes": 30, "billable": True}).json()["entry"]
    assert entry["customer_id"] == 4 and entry["minutes"] == 30 and entry["billable"] == 1
    assert client.post("/api/timer/start", json={"ticket_id": 99999}).status_code == 404


def test_timers_are_per_user(settings):
    app = create_app(dataclasses.replace(settings))
    admin = TestClient(app)
    admin.post("/api/users", json={"name": "Chef", "email": "chef@me-it.at", "password": "geheim-123456", "role": "admin"})
    admin.post("/api/auth/login", json={"email": "chef@me-it.at", "password": "geheim-123456"})
    admin.post("/api/users", json={"name": "Tech", "email": "tech@me-it.at", "password": "geheim-123456", "role": "technik"})
    tech = TestClient(app)
    tech.post("/api/auth/login", json={"email": "tech@me-it.at", "password": "geheim-123456"})
    admin.post("/api/timer/start", json={"customer_id": 1})
    assert tech.get("/api/timer").json()["timer"] is None
    tech.post("/api/timer/start", json={"customer_id": 2})
    assert admin.get("/api/timer").json()["timer"]["customer_id"] == 1
    # App-Dateien sind ohne Anmeldung erreichbar (keine Daten darin)
    anon = TestClient(app)
    assert anon.get("/manifest.webmanifest").status_code == 200 and anon.get("/sw.js").status_code == 200
    assert anon.get("/api/timer").status_code == 401


def test_pwa_manifest_service_worker_icons(client):
    m = client.get("/manifest.webmanifest")
    assert m.headers["content-type"].startswith("application/manifest+json")
    data = m.json()
    assert data["display"] == "standalone" and data["start_url"] == "/" and data["theme_color"].startswith("#")
    assert {i["sizes"] for i in data["icons"]} == {"192x192", "512x512"} and any(i.get("purpose") == "maskable" for i in data["icons"])
    for icon in data["icons"]:
        r = client.get(icon["src"])
        assert r.status_code == 200 and r.content[:8] == b"\x89PNG\r\n\x1a\n"
    sw = client.get("/sw.js")
    assert sw.headers["content-type"].startswith("application/javascript") and "__VERSION__" not in sw.text
    assert 'url.pathname.startsWith("/api/")' in sw.text  # Kundendaten werden nie zwischengespeichert
    assert client.get("/brand/../main.py").status_code == 404 and client.get("/brand/geheim.png").status_code == 404
    index = client.get("/").text
    assert 'rel="manifest"' in index and "apple-touch-icon" in index
