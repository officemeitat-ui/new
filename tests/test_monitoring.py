"""Überwachung: Zustandswechsel erst nach zwei Fehlern, Ticket bei Störung, Notiz bei Rückkehr, Verfügbarkeit, Portal."""

from __future__ import annotations

import socket
import threading
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from meit.monitoring import MonitorError, duration_text, normalize_target, probe


class FakeProbe:
    """Spielt die Außenwelt: je Ziel ein fester Zustand."""

    def __init__(self):
        self.down: dict[str, str] = {}

    def __call__(self, m):
        return (False, 0, self.down[m["target"]]) if m["target"] in self.down else (True, 120, "Antwort 200")


def test_targets_and_real_probe_against_local_socket():
    assert normalize_target("http", "www.huber.at") == "https://www.huber.at" and normalize_target("http", "http://intranet:8080/x") == "http://intranet:8080/x"
    assert normalize_target("tcp", "Mail.Kunde.at:587") == "mail.kunde.at:587"
    for kind, bad in (("http", "ftp://x"), ("http", "https://user:pw@x.at"), ("http", "https://a b.at"), ("tcp", "ohne-port"), ("tcp", "host:99999"), ("tcp", "host:0")):
        with pytest.raises(MonitorError):
            normalize_target(kind, bad)
    assert duration_text(40) == "40 Sekunden" and duration_text(720) == "12 Minuten" and duration_text(9000) == "2,5 Stunden"
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    threading.Thread(target=lambda: server.accept(), daemon=True).start()
    ok, ms, detail = probe({"kind": "tcp", "target": f"127.0.0.1:{port}"})
    assert ok and ms >= 0 and detail == "Verbindung angenommen"
    server.close()
    closed = probe({"kind": "tcp", "target": f"127.0.0.1:{port}"})
    assert closed[0] is False and "abgelehnt" in closed[2]
    assert probe({"kind": "http", "target": f"http://127.0.0.1:{port}/", "keyword": ""})[0] is False


def test_outage_creates_ticket_and_recovery_note(app, client):
    db, svc = app.state.ctx.db, app.state.monitoring
    world = FakeProbe()
    svc.probe = world
    assert client.post("/api/monitors", json={"name": "Webshop", "target": "kein ziel mit leerzeichen"}).status_code == 422
    assert client.post("/api/monitors", json={"name": "Webshop", "customer_id": 99999, "target": "shop.at"}).status_code == 404
    shop = client.post("/api/monitors", json={"customer_id": 1, "name": "Webshop", "target": "shop.huber-demo.at", "keyword": "Warenkorb"}).json()
    mail = client.post("/api/monitors", json={"customer_id": 1, "name": "Mailserver", "kind": "tcp", "target": "mail.huber-demo.at:587", "keyword": "egal"}).json()
    assert shop["target"] == "https://shop.huber-demo.at" and shop["status"] == "neu" and shop["uptime"] is None and mail["keyword"] == ""
    assert svc.run_due() == {"checked": 2, "failed": 0, "skipped": 0}
    assert svc.run_due()["checked"] == 0  # erst nach dem Intervall wieder fällig
    assert client.get(f"/api/monitors/{shop['id']}").json()["status"] == "ok"
    # erster Aussetzer: noch keine Störung, aber schon nach einer Minute Nachprüfung
    world.down["https://shop.huber-demo.at"] = "Antwort 503"
    one = client.post(f"/api/monitors/{shop['id']}/check").json()
    assert one["status"] == "ok" and one["last_error"] == "Antwort 503" and one["ticket_id"] is None
    assert one["status_label"] == "Fehler – wird nachgeprüft"
    db.query("UPDATE monitors SET last_check = datetime('now', 'localtime', '-61 seconds') WHERE id = ?", (shop["id"],))
    assert [m["id"] for m in svc.due()] == [shop["id"]]
    # zweiter Fehler in Folge: Störung, dringendes Ticket
    assert svc.run_due() == {"checked": 1, "failed": 1, "skipped": 0}
    down = client.get(f"/api/monitors/{shop['id']}").json()
    ticket = db.get("tickets", down["ticket_id"])
    assert down["status"] == "down" and down["status_label"] == "gestört" and down["events"][0]["status"] == "down"
    assert ticket["priority"] == "hoch" and ticket["customer_id"] == 1 and ticket["title"] == "Störung: Webshop nicht erreichbar" and "Antwort 503" in ticket["description"]
    listing = client.get("/api/monitors").json()
    assert listing["summary"] == {"total": 2, "down": 1, "ok": 1, "uptime": listing["summary"]["uptime"]} and listing["items"][0]["name"] == "Webshop"
    # weitere Fehler: kein zweites Ticket
    client.post(f"/api/monitors/{shop['id']}/check")
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE category = 'Überwachung'") == 1
    # Rückkehr: Ereignis mit Ausfalldauer, Notiz im Ticket
    db.query("UPDATE monitors SET since = datetime('now', 'localtime', '-12 minutes') WHERE id = ?", (shop["id"],))
    world.down.clear()
    up = client.post(f"/api/monitors/{shop['id']}/check").json()
    assert up["status"] == "ok" and up["events"][0]["status"] == "up" and up["events"][0]["duration"] == "12 Minuten"
    note = db.query_one("SELECT * FROM messages WHERE linked_type = 'ticket' AND linked_id = ? ORDER BY id DESC", (ticket["id"],))
    assert note["channel"] == "notiz" and "wieder erreichbar" in note["body"] and "12 Minuten" in note["body"]
    assert db.get("tickets", ticket["id"])["status"] != "geloest"  # schließen entscheidet ein Mensch
    # Verfügbarkeit: 5 Prüfungen, 3 Fehler
    stats = client.get(f"/api/monitors/{shop['id']}").json()
    assert stats["checks"] == 5 and stats["uptime"] == 40.0 and stats["avg_ms"] == 120 and len(stats["days"]) == 30 and stats["days"][-1]["state"] == "bad"
    # erneute Störung bei noch offenem Ticket: Notiz statt neuem Ticket
    world.down["https://shop.huber-demo.at"] = "Zeitüberschreitung – keine Antwort"
    client.post(f"/api/monitors/{shop['id']}/check")
    client.post(f"/api/monitors/{shop['id']}/check")
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE category = 'Überwachung'") == 1
    assert "erneut gestört" in db.query_one("SELECT body FROM messages WHERE linked_id = ? AND channel = 'notiz' ORDER BY id DESC", (ticket["id"],))["body"]


def test_own_outage_is_not_reported_and_admin_portal_views(app, client):
    db, svc = app.state.ctx.db, app.state.monitoring
    world = FakeProbe()
    svc.probe = world
    ids = [client.post("/api/monitors", json={"customer_id": c, "name": f"Dienst {c}", "target": f"dienst{c}.test"}).json()["id"] for c in (1, 1, 2)]
    intern = client.post("/api/monitors", json={"customer_id": 1, "name": "Intern NAS", "kind": "tcp", "target": "192.168.10.5:445", "portal_visible": False}).json()
    svc.run_due()
    # alles gleichzeitig weg → eigener Anschluss: nichts verbuchen, kein Ticket, Hinweis in der Übersicht
    for m in db.query("SELECT target FROM monitors"):
        world.down[m["target"]] = "Zeitüberschreitung – keine Antwort"
    db.query("UPDATE monitors SET last_check = datetime('now', 'localtime', '-10 minutes')")
    assert svc.run_due() == {"checked": 0, "failed": 4, "skipped": 4}
    assert "eigene Internetanschluss" in client.get("/api/monitors").json()["paused"]["reason"]
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE category = 'Überwachung'") == 0 and db.scalar("SELECT SUM(fails) FROM monitor_days") == 0
    world.down.clear()
    svc.run_due()
    assert client.get("/api/monitors").json()["paused"] is None
    # ändern: neues Ziel setzt den Zustand zurück; pausieren; löschen räumt mit auf
    changed = client.put(f"/api/monitors/{ids[0]}", json={"customer_id": 1, "name": "Dienst 1", "target": "neu.dienst1.test", "active": False}).json()
    assert changed["status"] == "neu" and changed["status_label"] == "pausiert" and ids[0] not in [m["id"] for m in svc.due()]
    assert client.get("/api/monitors?customer_id=2").json()["items"][0]["customer"] == "Steuerberatung Gruber & Partner"
    assert "monitor" in {g["type"] for g in client.get("/api/search?q=dienst").json()["groups"]}
    assert client.delete(f"/api/monitors/{ids[2]}").json() == {"ok": True} and db.scalar("SELECT COUNT(*) FROM monitor_days WHERE monitor_id = ?", (ids[2],)) == 0
    assert client.get(f"/api/monitors/{ids[2]}").status_code == 404
    # Kundenportal: nur eigene, aktive, freigegebene Dienste – ohne Adressen
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    assert portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    mine = portal.get("/api/portal/monitors").json()
    assert [m["name"] for m in mine] == ["Dienst 1"] and mine[0]["status"] == "ok" and "target" not in mine[0] and len(mine[0]["days"]) == 30
    assert intern["id"] and TestClient(app).get("/api/portal/monitors").status_code == 401


def test_real_http_probe_against_local_server():
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            code = {"/ok": 200, "/login": 401, "/weg": 404, "/kaputt": 500}.get(self.path, 200)
            body = b"<html><h1>Warenkorb</h1></html>" if self.path == "/ok" else b"Fehler"
            self.send_response(code)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        ok = probe({"kind": "http", "target": f"{base}/ok", "keyword": "warenkorb"})
        assert ok[0] is True and ok[1] >= 1 and ok[2] == "Antwort 200"
        assert probe({"kind": "http", "target": f"{base}/ok", "keyword": "Kasse"}) [2] == "Suchtext „Kasse“ fehlt auf der Seite"
        assert probe({"kind": "http", "target": f"{base}/login", "keyword": ""})[0] is True  # Anmeldung verlangt = Dienst läuft
        assert probe({"kind": "http", "target": f"{base}/weg", "keyword": ""})[::2] == (False, "Antwort 404")
        assert probe({"kind": "http", "target": f"{base}/kaputt", "keyword": ""})[::2] == (False, "Antwort 500")
    finally:
        server.shutdown()
