"""Atera-Datenübernahme: Vorschau ohne Schreiben, Ansprechpartner, gespiegelte Tickets, Diagnose, Optionen."""

from __future__ import annotations

import copy
import dataclasses
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from meit.atera import ci, local_time, pick
from meit.main import create_app

CUSTOMERS = [{"CustomerID": 11, "CustomerName": "Tischlerei Huber GmbH"},
             {"CustomerID": 12, "CustomerName": "Bäckerei Neu KG", "City": "Hallein", "ZipCodeStr": "5400", "Address": "Markt 1"}]
AGENTS = [{"AgentID": 501, "CustomerID": 11, "AgentName": "HUBER-SRV01", "OSType": "Server", "OS": "Windows Server 2019"},
          {"AgentID": 502, "CustomerID": 12, "AgentName": "KASSA-PC", "OSType": "Work Station", "OS": "Windows 11 Pro"}]
CONTACTS = [{"EndUserID": 1, "CustomerID": 12, "Firstname": "Bernd", "Lastname": "Back", "Email": "bernd@neu.test"},
            {"EndUserID": 2, "CustomerID": 12, "Firstname": "Anna", "Lastname": "Neu", "Email": "anna@neu.test", "Phone": "0664 111",
             "JobTitle": "Geschäftsführung", "IsContactPerson": True},
            {"EndUserID": 3, "CustomerID": 11, "FirstName": "Franz", "LastName": "Huber", "email": "franz@huber-demo.at"},  # andere Schreibweise
            {"EndUserID": 4, "CustomerID": 99, "Firstname": "Fremd", "Lastname": "Kunde", "Email": "x@y.test"}]
TICKETS = [{"TicketID": 7001, "TicketTitle": "Drucker offline", "TicketStatus": "Open", "TicketPriority": "High", "TicketType": "Incident",
            "CustomerID": 11, "EndUserFirstName": "Franz", "EndUserLastName": "Huber", "FirstComment": "Der Drucker im Büro druckt nicht.",
            "TicketCreatedDate": "2026-11-10T08:15:00Z"},
           {"TicketID": 7002, "TicketTitle": "VPN bricht ab", "TicketStatus": "Pending", "TicketPriority": "Low", "CustomerID": 12},
           {"TicketID": 7003, "TicketTitle": "Längst erledigt", "TicketStatus": "Closed", "CustomerID": 11},
           {"TicketID": 7004, "TicketTitle": "Fremder Kunde", "TicketStatus": "Open", "CustomerID": 99}]


class Resp:
    def __init__(self, data, status=200):
        self._data, self.status_code = data, status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError(str(self.status_code), request=None, response=None)


class World:
    """Simuliertes Atera: Daten lassen sich zwischen zwei Abgleichen ändern."""

    def __init__(self):
        self.data = {"/customers": copy.deepcopy(CUSTOMERS), "/agents": copy.deepcopy(AGENTS), "/contacts": copy.deepcopy(CONTACTS),
                     "/tickets": copy.deepcopy(TICKETS), "/alerts": []}
        self.honor_filter, self.status, self.calls = True, 200, []

    def get(self, url, params=None, headers=None, timeout=None):
        path = url.split("/v3")[1]
        self.calls.append((path, dict(params or {})))
        if self.status != 200:
            return Resp({}, self.status)
        if path.startswith("/tickets/"):
            hit = [t for t in self.data["/tickets"] if str(t["TicketID"]) == path.rsplit("/", 1)[1]]
            return Resp(hit[0]) if hit else Resp({}, 404)
        items = self.data[path]
        if path == "/tickets" and self.honor_filter and params.get("ticketStatus"):
            items = [t for t in items if t["TicketStatus"] == params["ticketStatus"]]
        page, size = params["page"], params["itemsInPage"]
        return Resp({"items": items[(page - 1) * size: page * size], "totalItemCount": len(items), "page": page,
                     "totalPages": max(1, -(-len(items) // size))})


@pytest.fixture()
def atera(settings, monkeypatch):
    import httpx

    world = World()
    monkeypatch.setattr(httpx, "get", world.get)
    app = create_app(dataclasses.replace(settings, atera_api_key="key-123"))
    return app, TestClient(app), world


def test_helpers():
    item = ci({"FirstName": "Anna", "EMAIL": "", "Phone": None})
    assert pick(item, "Firstname") == "Anna" and pick(item, "Email", "Phone", default="-") == "-"
    local = datetime(2026, 11, 10, 8, 15, tzinfo=timezone.utc).astimezone().replace(tzinfo=None).isoformat(sep=" ")
    assert local_time("2026-11-10T08:15:00Z") == local == local_time("2026-11-10T08:15:00.1234567Z")
    assert local_time("2026-11-10T09:15:00") == "2026-11-10 09:15:00" and local_time("") == "" and local_time("kein Datum") == ""


def test_preview_writes_nothing(atera):
    app, client, world = atera
    db = app.state.ctx.db
    assert client.put("/api/atera/options", json={"tickets": True}).json() == {"contacts": True, "tickets": True, "alert_tickets": False}
    before = {t: db.scalar(f"SELECT COUNT(*) FROM {t}") for t in ("customers", "assets", "contacts", "tickets")}
    r = client.post("/api/atera/sync?dry_run=true").json()
    assert r["dry_run"] is True and r["customers_created"] == ["Bäckerei Neu KG"] and r["customers_matched"] == 1
    assert r["assets_created"] == 2 and r["contacts"] == {"created": 3, "updated": 0, "unmapped": 1, "customers_filled": 0}
    assert r["tickets"] == {"created": 2, "updated": 0, "closed": 0, "unmapped": 1}
    assert before == {t: db.scalar(f"SELECT COUNT(*) FROM {t}") for t in before}  # nichts gespeichert
    assert db.get_setting("atera_last_sync", None) is None and db.get_setting("atera_customer_map", None) is None
    assert client.get("/api/atera/status").json()["last"] is None


def test_contacts_and_mirrored_tickets(atera):
    app, client, world = atera
    db = app.state.ctx.db
    client.put("/api/atera/options", json={"tickets": True})
    huber_before = db.get("customers", 1)
    r = client.post("/api/atera/sync").json()
    assert r["dry_run"] is False and r["customers_created"] == ["Bäckerei Neu KG"]
    assert r["contacts"] == {"created": 3, "updated": 0, "unmapped": 1, "customers_filled": 1}
    neu = db.query_one("SELECT * FROM customers WHERE name = 'Bäckerei Neu KG'")
    # Hauptkontakt füllt nur leere Felder; vorhandene Angaben beim Kunden bleiben unangetastet
    assert (neu["contact_name"], neu["email"], neu["phone"]) == ("Anna Neu", "anna@neu.test", "0664 111")
    huber = db.get("customers", 1)
    assert huber["contact_name"] == huber_before["contact_name"] and huber["email"] == huber_before["email"]
    people = client.get(f"/api/customers/{neu['id']}/contacts").json()
    assert [(p["name"], p["is_primary"], p["source"]) for p in people] == [("Anna Neu", 1, "atera"), ("Bernd Back", 0, "atera")]
    assert client.get("/api/customers/1/contacts").json()[0]["email"] == "franz@huber-demo.at"  # andere Schreibweise der Felder verstanden
    # Tickets: nur offene/wartende, mit Herkunft, Priorität, Anlagedatum und Melder
    assert r["tickets"] == {"created": 2, "updated": 0, "closed": 0, "unmapped": 1}
    t1 = db.query_one("SELECT * FROM tickets WHERE external_id = 'atera:7001'")
    t2 = db.query_one("SELECT * FROM tickets WHERE external_id = 'atera:7002'")
    assert (t1["title"], t1["status"], t1["priority"], t1["source"], t1["customer_id"], t1["category"]) == ("Drucker offline", "neu", "hoch", "atera", 1, "Incident")
    assert t1["description"].startswith("Gemeldet von Franz Huber") and "druckt nicht" in t1["description"] and t1["created_at"] == local_time("2026-11-10T08:15:00Z")
    assert (t2["status"], t2["priority"], t2["customer_id"]) == ("wartet", "niedrig", neu["id"])
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE source = 'atera'") == 2  # das geschlossene und das fremde nicht
    assert client.get("/api/atera/status").json()["mirrored_tickets"] == 2
    listed = {t["id"]: t for t in client.get("/api/tickets").json()}
    assert listed[t1["id"]]["source"] == "atera" and listed[t1["id"]]["external_id"] == "atera:7001"
    # zweiter Abgleich: Titel geändert, eines in Atera gelöst → kein Duplikat, Zustand folgt Atera, eigene Notizen bleiben
    client.put(f"/api/tickets/{t1['id']}", json={"solution": "Treiber neu installiert"})
    world.data["/tickets"][0]["TicketTitle"] = "Drucker offline (Werkstatt)"
    world.data["/tickets"][1].update({"TicketStatus": "Resolved", "TicketResolvedDate": "2026-11-12T10:00:00Z"})
    again = client.post("/api/atera/sync").json()
    assert again["tickets"] == {"created": 0, "updated": 2, "closed": 1, "unmapped": 1} and again["contacts"]["created"] == 0 and again["contacts"]["updated"] == 3
    t1b, t2b = db.get("tickets", t1["id"]), db.get("tickets", t2["id"])
    assert t1b["title"] == "Drucker offline (Werkstatt)" and t1b["solution"] == "Treiber neu installiert" and t1b["created_at"] == t1["created_at"]
    assert t2b["status"] == "geloest" and t2b["resolved_at"] == local_time("2026-11-12T10:00:00Z")
    assert db.scalar("SELECT COUNT(*) FROM tickets WHERE source = 'atera'") == 2 and db.scalar("SELECT COUNT(*) FROM contacts") == 3
    assert ("/tickets/7002", {}) in world.calls  # einzeln nachgesehen, weil es aus der offenen Liste verschwunden ist


def test_filter_is_checked_locally_and_errors_are_reported(atera):
    app, client, world = atera
    db = app.state.ctx.db
    client.put("/api/atera/options", json={"tickets": True, "contacts": False})
    world.honor_filter = False  # Atera beachtet den Zustandsfilter nicht → trotzdem nur offene, keine Doppelten
    r = client.post("/api/atera/sync").json()
    assert r["contacts"] is None and r["tickets"]["created"] == 2 and db.scalar("SELECT COUNT(*) FROM tickets WHERE source = 'atera'") == 2
    assert db.scalar("SELECT COUNT(*) FROM contacts") == 0
    world.status = 401
    bad = client.post("/api/atera/sync?dry_run=true")
    assert bad.status_code == 502 and "API-Schlüssel" in bad.json()["detail"] and client.get("/api/atera/status").json()["error"] == ""
    assert client.post("/api/atera/sync").status_code == 502 and "API-Schlüssel" in client.get("/api/atera/status").json()["error"]


def test_diagnose_shows_field_names_without_content(atera):
    app, client, world = atera
    d = client.get("/api/atera/diagnose").json()
    assert set(d) == {"Kunden", "Geräte", "Kontakte", "Tickets", "Alarme"}
    assert d["Kunden"] == {"ok": True, "total": 2, "fields": ["CustomerID", "CustomerName"]}
    assert "TicketStatus" in d["Tickets"]["fields"] and d["Tickets"]["total"] == 4 and d["Alarme"] == {"ok": True, "total": 0, "fields": []}
    assert "Huber" not in str(d) and "Drucker" not in str(d)  # keine Inhalte
    world.status = 500
    assert client.get("/api/atera/diagnose").json()["Kunden"]["ok"] is False


def test_contacts_by_hand_and_search(client):
    assert client.post("/api/customers/99999/contacts", json={"name": "Niemand"}).status_code == 404
    assert client.post("/api/customers/1/contacts", json={"name": "Eva Maier", "email": "keine-adresse"}).status_code == 422
    eva = client.post("/api/customers/1/contacts", json={"name": "Eva Maier", "email": "eva@huber-demo.at", "job_title": "Büroleitung", "is_primary": True}).json()
    tom = client.post("/api/customers/1/contacts", json={"name": "Tom Berger", "phone": "0664 222", "is_primary": True}).json()
    people = client.get("/api/customers/1/contacts").json()
    assert [(p["name"], p["is_primary"]) for p in people] == [("Tom Berger", 1), ("Eva Maier", 0)] and eva["source"] == "cockpit"  # nur einer ist Hauptkontakt
    assert client.put(f"/api/contacts/{eva['id']}", json={"name": "Eva Maier-Huber", "email": "eva@huber-demo.at", "job_title": "Büroleitung"}).json()["name"] == "Eva Maier-Huber"
    hit = client.get("/api/search?q=maier buroleitung").json()
    assert hit["groups"][0]["type"] == "person" and hit["groups"][0]["items"][0]["customer_id"] == 1
    assert client.delete(f"/api/contacts/{tom['id']}").json() == {"ok": True} and client.delete(f"/api/contacts/{tom['id']}").status_code == 404
