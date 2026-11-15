"""CSV-Import (Kunden, Geräte, RMM-Export) und Datensicherung."""

import sqlite3

from meit.data_tools import map_columns, normalize_type, parse_date, parse_number, ASSET_FIELDS

CUSTOMERS_CSV = """Firma;Ansprechpartner;E-Mail;Mitarbeiter;Paket;MRR;Vertragsende
Bäckerei Mayr GmbH;Anna Mayr;office@mayr-demo.at;18;basis;"702,00";31.12.2027
Tischlerei Huber GmbH;Franz Huber;x@y.at;12;basis;468;
;ohne Namen;;;;;
"""

RMM_CSV = """Display Name,Organization,OS Name,Device Type,Serial Number,Last Contact,Warranty Expiration
MAYR-PC01,Bäckerei Mayr GmbH,Windows 10 Pro,Windows Desktop,ABC123,2026-11-10T08:00:00Z,03/31/2027
MAYR-SRV,Bäckerei Mayr GmbH,Windows Server 2016 Standard,Windows Server,SRV9,2026-11-10,
HUBER-PC01,Tischlerei Huber,Windows 11 Pro,Windows Desktop,,2026-11-12,
NEU-NB1,Neukunde Demo KG,Windows 11 Pro,Laptop,,,
"""


def test_helpers():
    assert parse_date("31.12.2027") == "2027-12-31"
    assert parse_date("03/31/2027") == "2027-03-31"  # US-Format, weil eindeutig
    assert parse_date("2026-11-10T08:00:00Z") == "2026-11-10"
    assert parse_date("kein datum") == ""
    assert parse_number("1.234,50") == 1234.5 and parse_number("1,234.50") == 1234.5 and parse_number("€ 39") == 39
    assert normalize_type("Windows Server") == "server" and normalize_type("Laptop") == "notebook"
    assert normalize_type("", "Windows Server 2022") == "server"
    m = map_columns(["Display Name", "Organization", "OS Name", "Serial Number"], ASSET_FIELDS)
    assert m == {"Display Name": "name", "Organization": "customer", "OS Name": "os", "Serial Number": "serial"}


def test_customer_import_preview_then_commit(client):
    r = client.post("/api/import/customers", json={"csv": CUSTOMERS_CSV}).json()
    assert r["committed"] is False and r["created"] == 1
    assert {s["reason"] for s in r["skipped"]} == {"kein Name", "Kunde „Tischlerei Huber GmbH“ existiert bereits"}
    assert client.get("/api/customers").json().__len__() == 5  # Vorschau ändert nichts
    r = client.post("/api/import/customers", json={"csv": CUSTOMERS_CSV, "commit": True}).json()
    mayr = next(c for c in client.get("/api/customers").json() if c["name"] == "Bäckerei Mayr GmbH")
    assert (mayr["employees"], mayr["mrr"], mayr["contract_end"], mayr["package"]) == (18, 702.0, "2027-12-31", "basis")


def test_rmm_asset_import_updates_and_creates(client):
    client.post("/api/import/customers", json={"csv": CUSTOMERS_CSV, "commit": True})
    r = client.post("/api/import/assets", json={"csv": RMM_CSV, "commit": True}).json()
    assert r["created"] == 3 and r["updated"] == 1  # HUBER-PC01 existiert → aktualisiert
    assert r["new_customers"] == ["Neukunde Demo KG"]
    assets = {a["name"]: a for a in client.get("/api/assets").json()}
    assert assets["MAYR-SRV"]["type"] == "server" and assets["MAYR-SRV"]["eol_status"] == "bald"
    assert assets["MAYR-PC01"]["warranty_end"] == "2027-03-31" and assets["MAYR-PC01"]["eol_status"] == "abgelaufen"
    assert assets["HUBER-PC01"]["os"] == "Windows 11 Pro"
    assert assets["NEU-NB1"]["type"] == "notebook"
    again = client.post("/api/import/assets", json={"csv": RMM_CSV, "commit": True}).json()
    assert again["created"] == 0 and again["updated"] == 4  # erneuter Import = Aktualisierung


def test_import_rejects_unknown(client):
    assert client.post("/api/import/tickets", json={"csv": "a;b\n1;2"}).status_code == 422
    assert client.post("/api/import/assets", json={"csv": "Foo;Bar\n1;2"}).status_code == 422


def test_backup(client, settings, tmp_path):
    r = client.post("/api/backup/run").json()
    assert r["backups"] and r["backups"][0]["file"] == r["file"]
    path = tmp_path / "backups" / r["file"]
    con = sqlite3.connect(path)
    assert con.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 5
    con.close()
    d = client.get("/api/backup/download")
    assert d.status_code == 200 and d.content[:15] == b"SQLite format 3"
