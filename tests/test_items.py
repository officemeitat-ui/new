"""Artikel und Einmalpositionen: Material aus dem Arbeitsbericht landet auf der nächsten Rechnung – aber nie zu 0 €."""

from __future__ import annotations

from datetime import date


def _period() -> str:
    return date.today().strftime("%Y-%m")


def test_articles_catalog(client):
    a = client.post("/api/articles", json={"name": "Patchkabel Cat6 2 m", "unit": "Stk.", "price": 4.9, "cost": 1.8, "vendor": "Ingram"}).json()
    assert a["id"] and a["active"] == 1 and client.post("/api/articles", json={"name": "x"}).status_code == 422
    assert client.put(f"/api/articles/{a['id']}", json={"name": "Patchkabel Cat6 2 m", "unit": "Stk.", "price": 5.5, "cost": 1.8}).json()["price"] == 5.5
    b = client.post("/api/articles", json={"name": "Arbeitsspeicher 16 GB", "price": 79}).json()
    assert [x["name"] for x in client.get("/api/articles").json()] == ["Arbeitsspeicher 16 GB", "Patchkabel Cat6 2 m"]
    # unbenutzt → wirklich weg; benutzt → nur ausgeblendet
    assert client.delete(f"/api/articles/{b['id']}").json() == {"ok": True, "archived": False}
    client.post("/api/billing/items", json={"customer_id": 1, "description": "patchkabel cat6 2 m", "quantity": 2, "price": 5.5})
    assert client.delete(f"/api/articles/{a['id']}").json()["archived"] is True
    assert client.get("/api/articles").json() == [] and len(client.get("/api/articles?all=true").json()) == 1
    assert client.put("/api/articles/99999", json={"name": "nix da"}).status_code == 404


def test_one_off_items_flow_into_invoice_run(app, client):
    db = app.state.ctx.db
    assert client.post("/api/billing/items", json={"customer_id": 99999, "description": "Monitor"}).status_code == 404
    mon = client.post("/api/billing/items", json={"customer_id": 1, "description": "Monitor 27 Zoll", "quantity": 2, "price": 189.5, "cost": 150, "kind": "hardware"}).json()
    assert mon["total"] == 379.0 and mon["margin"] == 79.0 and mon["status"] == "offen" and mon["kind_label"] == "Hardware" and mon["customer"] == "Tischlerei Huber GmbH"
    nop = client.post("/api/billing/items", json={"customer_id": 1, "description": "Sonderkabel"}).json()
    assert nop["status"] == "Preis fehlt" and nop["total"] is None
    listed = client.get("/api/billing/items").json()
    assert {i["id"] for i in listed["items"]} == {mon["id"], nop["id"]} and listed["summary"]["value"] == 379.0 and listed["summary"]["unpriced"] == 1
    assert client.get("/api/billing/items?customer_id=2").json()["items"] == []
    before = client.get("/api/billing/unbilled").json()
    assert before["items"]["value"] == 379.0 and before["items"]["customers"][0]["customer"] == "Tischlerei Huber GmbH"
    # Rechnungslauf: Position mit Preis kommt auf den Entwurf, die ohne Preis bleibt offen
    run = client.post("/api/billing/run", json={"period": _period()}).json()
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_id"] == 1 and i["status"] == "entwurf")
    full = db.get("invoices", inv["id"])
    line = next(x for x in __import__("json").loads(full["items"]) if x["kind"] == "item")
    assert run["count"] >= 1 and line == {"kind": "item", "ref": mon["id"], "description": "Monitor 27 Zoll", "quantity": 2.0, "unit": "Stk.", "price": 189.5, "total": 379.0}
    after = {i["id"]: i for i in client.get("/api/billing/items?status=alle").json()["items"]}
    assert after[mon["id"]]["status"] == "verrechnet" and after[mon["id"]]["invoice"] == "Entwurf" and after[nop["id"]]["status"] == "Preis fehlt"
    assert client.get("/api/billing/unbilled").json()["items"]["value"] == 0
    # auf einer Rechnung → nicht mehr änderbar; Entwurf gelöscht → wieder offen
    assert client.put(f"/api/billing/items/{mon['id']}", json={"price": 1}).status_code == 409
    assert client.delete(f"/api/billing/items/{mon['id']}").status_code == 409
    client.delete(f"/api/invoices/{inv['id']}")
    assert client.get("/api/billing/items").json()["summary"]["value"] == 379.0
    # Preis nachtragen → beim nächsten Lauf dabei; löschen
    priced = client.put(f"/api/billing/items/{nop['id']}", json={"price": 12.5, "quantity": 4}).json()
    assert priced["status"] == "offen" and priced["total"] == 50.0
    assert client.delete(f"/api/billing/items/{mon['id']}").json() == {"ok": True} and client.delete("/api/billing/items/99999").status_code == 404
    client.post("/api/billing/run", json={"period": _period()})
    assert client.get("/api/billing/items").json()["items"] == []


def test_materials_from_work_report_become_billing_items(app, client):
    db = app.state.ctx.db
    ram = client.post("/api/articles", json={"name": "Arbeitsspeicher 16 GB", "unit": "Stk.", "price": 79, "cost": 52}).json()
    r = client.post("/api/work-reports", json={"customer_id": 1, "minutes": 60, "work": "Rechner aufgerüstet", "materials": [
        {"name": "arbeitsspeicher 16 gb", "qty": 2},                       # Preis aus dem Artikel (Schreibweise egal)
        {"name": "SSD 1 TB", "qty": 1, "unit": "Stk.", "price": 119.9},     # Preis vom Techniker eingetragen
        {"name": "Kleinmaterial", "qty": 1}]}).json()                      # kein Preis bekannt
    assert r["materials"][0] == {"name": "arbeitsspeicher 16 gb", "qty": 2.0, "unit": ""} and r["materials"][1]["price"] == 119.9
    assert client.get("/api/billing/items").json()["items"] == []  # erst der abgeschlossene Bericht zählt
    client.post(f"/api/work-reports/{r['id']}/sign", json={"no_signature_reason": "Kunde nicht da"})
    items = {i["description"]: i for i in client.get("/api/billing/items").json()["items"]}
    art = items["Arbeitsspeicher 16 GB"]  # Bezeichnung einheitlich aus dem Artikel
    assert art["price"] == 79 and art["cost"] == 52 and art["article_id"] == ram["id"]
    assert art["total"] == 158 and art["unit"] == "Stk." and art["report"] == r["number"]
    assert items["SSD 1 TB"]["price"] == 119.9 and items["Kleinmaterial"]["status"] == "Preis fehlt"
    assert all(i["kind"] == "material" and i["work_report_id"] == r["id"] and i["date"] == r["date"] for i in items.values())
    # nie doppelt; „nicht verrechnen“ legt nichts an
    from meit.items import from_report

    assert from_report(db, db.get("work_reports", r["id"])) == 0 and db.scalar("SELECT COUNT(*) FROM billing_items") == 3
    free = client.post("/api/work-reports", json={"customer_id": 2, "minutes": 30, "work": "Kulanz", "materials": [{"name": "Kabelbinder", "qty": 10, "price": 0.1}]}).json()
    client.post(f"/api/work-reports/{free['id']}/sign", json={"no_signature_reason": "Fernwartung", "bill_materials": False})
    assert db.scalar("SELECT COUNT(*) FROM billing_items WHERE customer_id = 2") == 0
    # im Rechnungslauf: die beiden Positionen mit Preis, die ohne Preis bleibt als Erinnerung offen
    client.post("/api/billing/run", json={"period": _period()})
    left = client.get("/api/billing/items").json()
    assert [i["description"] for i in left["items"]] == ["Kleinmaterial"] and left["summary"]["unpriced"] == 1
