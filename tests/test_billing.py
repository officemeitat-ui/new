"""Zeiterfassung & Abrechnung."""

from datetime import date

from meit.billing import billed_hours, next_number, period_bounds


def _period():
    return date.today().strftime("%Y-%m")


def test_helpers():
    assert billed_hours(1) == 0.25 and billed_hours(15) == 0.25 and billed_hours(16) == 0.5 and billed_hours(60) == 1
    assert billed_hours(7, 5) == 10 / 60
    assert period_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))


def test_time_booking_defaults(client):
    t = client.post("/api/tickets", json={"customer_id": 3, "title": "NAS prüfen", "auto_triage": False}).json()
    e = client.post("/api/time", json={"ticket_id": t["id"], "minutes": 50}).json()
    assert e["customer_id"] == 3 and e["billable"] == 1 and e["rate"] == 110  # Steiner: kein Vertrag → verrechenbar
    assert client.get(f"/api/tickets/{t['id']}").json()["time_spent_min"] == 50
    m = client.post("/api/time", json={"customer_id": 2, "minutes": 30, "description": "Druckerfrage"}).json()
    assert m["billable"] == 0  # Gruber: Managed → durch Flatrate abgedeckt
    assert client.post("/api/time", json={"minutes": 30}).status_code == 422
    # manuell erhöhte Ticketzeit erzeugt Zeiteintrag für die Differenz
    client.put(f"/api/tickets/{t['id']}", json={"time_spent_min": 80})
    entries = client.get(f"/api/time?ticket_id={t['id']}").json()
    assert sorted(x["minutes"] for x in entries) == [30, 50]
    assert client.delete(f"/api/time/{e['id']}").json()["ok"]
    assert client.get(f"/api/tickets/{t['id']}").json()["time_spent_min"] == 30


def test_billing_run_finalize_and_numbering(client):
    client.put("/api/billing/profile", json={"name": "ME-IT e.U.", "address": "Linz", "uid": "ATU12345678",
                                             "iban": "AT00 0000 0000 0000 0000", "invoice_prefix": "RE-"})
    client.post("/api/time", json={"customer_id": 3, "minutes": 95, "description": "Server-Check"})
    q = client.post("/api/agents/quote", json={"customer_id": 3, "need": "NIS2", "service_codes": ["NIS2GAP"]}).json()
    client.put(f"/api/quotes/{q['id']}", json={"status": "angenommen"})
    unb = client.get("/api/billing/unbilled").json()
    steiner = next(h for h in unb["hours"] if h["customer_id"] == 3)
    assert steiner["minutes"] == 45 + 95 and unb["projects"][0]["id"] == q["id"]

    r = client.post("/api/billing/run", json={"period": _period()}).json()
    by_customer = {c["customer"]: c for c in r["created"]}
    assert "Maschinenbau Steiner GmbH" in by_customer and "Steuerberatung Gruber & Partner" in by_customer
    invs = {i["customer_name"]: i for i in client.get("/api/invoices").json()}
    st = invs["Maschinenbau Steiner GmbH"]
    kinds = [i["kind"] for i in st["items"]]
    assert kinds.count("hours") == 2 and "project" in kinds and "recurring" not in kinds  # Steiner hat keinen MRR
    hours_line = next(i for i in st["items"] if "Server-Check" in i["description"])
    assert hours_line["quantity"] == 1.75 and hours_line["total"] == round(1.75 * 110, 2)  # 95 min → 1,75 h
    assert st["vat"] == round(st["net"] * 0.2, 2) and st["gross"] == round(st["net"] + st["vat"], 2)
    gr = invs["Steuerberatung Gruber & Partner"]
    assert gr["items"][0]["kind"] == "recurring" and gr["items"][0]["total"] == 1680.0
    lic = next(i for i in gr["items"] if i["kind"] == "subscription")  # M365-Lizenzen laufen mit
    assert lic["quantity"] == 30 and lic["total"] == 660.0 and gr["net"] == 1680.0 + 660.0

    # zweiter Lauf im selben Monat: nichts doppelt
    assert client.post("/api/billing/run", json={"period": _period()}).json()["count"] == 0
    assert client.get("/api/billing/unbilled").json()["total_value"] == 0

    a = client.put(f"/api/invoices/{st['id']}", json={"status": "gestellt"}).json()
    b = client.put(f"/api/invoices/{gr['id']}", json={"status": "gestellt"}).json()
    year = date.today().year
    assert a["number"] == f"RE-{year}-0001" and b["number"] == f"RE-{year}-0002"
    assert client.put(f"/api/invoices/{st['id']}", json={"status": "gestellt"}).json()["number"] == a["number"]  # idempotent
    assert client.delete(f"/api/invoices/{st['id']}").status_code == 409  # gestellt → nur stornieren
    html = client.get(f"/api/invoices/{st['id']}/html").text
    assert f"Rechnung RE-{year}-0001" in html and "ATU12345678" in html and "zzgl. 20 % USt" in html
    client.put(f"/api/invoices/{gr['id']}", json={"status": "bezahlt"})
    csv_text = client.get(f"/api/invoices/export.csv?year={year}").text
    assert f"RE-{year}-0002" in csv_text and "bezahlt" in csv_text

    # Storno: Leistungen werden wieder abrechenbar
    client.put(f"/api/invoices/{st['id']}", json={"status": "storniert"})
    assert client.get("/api/billing/unbilled").json()["total_value"] > 0


def test_draft_delete_releases_and_kleinunternehmer(client):
    client.put("/api/billing/profile", json={"kleinunternehmer": True})
    client.post("/api/time", json={"customer_id": 3, "minutes": 60, "description": "Einsatz"})
    r = client.post("/api/billing/run", json={"period": _period()}).json()
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_name"] == "Maschinenbau Steiner GmbH")
    assert inv["vat"] == 0 and inv["gross"] == inv["net"]
    assert "Kleinunternehmer" in client.get(f"/api/invoices/{inv['id']}/html").text
    assert r["count"] >= 1
    client.delete(f"/api/invoices/{inv['id']}")
    assert any(h["customer_id"] == 3 for h in client.get("/api/billing/unbilled").json()["hours"])


def test_invoice_html_escapes(client):
    client.post("/api/customers", json={"name": "<script>alert(1)</script> GmbH", "mrr": 10})
    client.post("/api/billing/run", json={"period": _period()})
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("<script>"))
    page = client.get(f"/api/invoices/{inv['id']}/html").text
    assert "<script>alert(1)</script>" not in page and "&lt;script&gt;" in page


def test_next_number_ignores_foreign_formats(client, app):
    db = app.state.ctx.db
    db.insert("invoices", {"number": "RE-2030-0007", "status": "gestellt"})
    db.insert("invoices", {"number": "RE-2030-ALT", "status": "gestellt"})
    assert next_number(db, {"invoice_prefix": "RE-"}, 2030) == "RE-2030-0008"
