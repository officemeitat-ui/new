"""Lizenzen & Verträge."""

from datetime import date, timedelta

from meit.subscriptions import add_months, enrich, next_renewal


def _d(days):
    return (date.today() + timedelta(days=days)).isoformat()


def test_helpers():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    sub = {"renewal_date": "2025-03-10", "auto_renew": 1, "billing_cycle": "jahr"}
    assert next_renewal(sub, date(2026, 11, 17)) == date(2027, 3, 10)
    assert next_renewal({**sub, "auto_renew": 0}, date(2026, 11, 17)) == date(2025, 3, 10)


def test_enrich_states_margin_seats():
    today = date(2026, 11, 17)
    base = {"quantity": 30, "unit_cost": 19.7, "unit_price": 22.0, "billing_cycle": "monat", "auto_renew": 0,
            "notice_days": 30, "per_user": 1, "kind": "lizenz", "name": "M365"}
    e = enrich({**base, "renewal_date": "2027-06-01"}, employees=28, today=today)
    assert e["state"] == "ok" and e["margin_month"] == round(30 * 2.3, 2) and e["seats"]["diff"] == 2
    assert enrich({**base, "renewal_date": "2026-12-20"}, 28, today)["state"] == "kündigungsfrist"  # Frist 20.11.
    assert enrich({**base, "renewal_date": "2027-01-10", "notice_days": 0}, 28, today)["state"] == "bald"
    assert enrich({**base, "renewal_date": "2026-11-01"}, 28, today)["state"] == "abgelaufen"
    assert enrich({**base, "renewal_date": "2027-06-01", "quantity": 25}, 28, today)["seats"]["hint"].startswith("unterlizenziert")
    yearly = enrich({**base, "billing_cycle": "jahr", "unit_price": 1200, "unit_cost": 600, "quantity": 1,
                     "renewal_date": "2027-06-01", "per_user": 0}, 0, today)
    assert yearly["price_month"] == 100 and yearly["margin_month"] == 50 and yearly["seats"] is None


def test_crud_and_summary(client):
    r = client.post("/api/subscriptions", json={"customer_id": 1, "name": "Microsoft 365 Business Basic", "vendor": "Microsoft",
                                                "quantity": 10, "unit_cost": 5.6, "unit_price": 6.5, "per_user": True,
                                                "renewal_date": _d(300)})
    assert r.status_code == 201
    sub = r.json()
    assert sub["seats"]["diff"] == -2 and sub["margin_month"] == 9.0  # Huber hat 12 Mitarbeiter
    assert client.post("/api/subscriptions", json={"customer_id": 1, "name": "x", "kind": "unsinn"}).status_code == 422
    assert client.post("/api/subscriptions", json={"customer_id": 999, "name": "x"}).status_code == 404
    upd = client.put(f"/api/subscriptions/{sub['id']}", json={**{k: sub[k] for k in ("customer_id", "name", "vendor",
                     "unit_cost", "unit_price", "renewal_date")}, "quantity": 12, "per_user": True}).json()
    assert upd["seats"]["diff"] == 0
    summary = client.get("/api/subscriptions/summary").json()
    assert summary["count"] == 6 and summary["margin_month"] > 0
    assert any(x["name"] == "Microsoft 365 Business Basic" for x in client.get("/api/subscriptions?customer_id=1").json())
    assert client.delete(f"/api/subscriptions/{sub['id']}").json()["ok"]


def test_renewals_in_dashboard_and_radar(client):
    d = client.get("/api/dashboard").json()
    names = [r["name"] for r in d["renewals"]]
    assert "SSL-Zertifikat hotel-alpenblick-demo.at" in names
    radar = client.get("/api/radar?customer_id=5").json()["opportunities"]
    assert any(o["title"].startswith("Verlängerung: SSL-Zertifikat") for o in radar)


def test_unterlizenziert_in_radar(client):
    client.post("/api/subscriptions", json={"customer_id": 3, "name": "EDR Endpoint", "quantity": 50, "unit_price": 8,
                                            "per_user": True, "renewal_date": _d(200)})
    radar = client.get("/api/radar?customer_id=3").json()["opportunities"]
    o = next(o for o in radar if o["title"].startswith("Unterlizenziert"))
    assert "15 fehlen" in o["title"] and o["monthly"] == 120.0


def test_yearly_license_billed_in_renewal_month_once(client):
    today = date.today()
    client.post("/api/subscriptions", json={"customer_id": 1, "name": "Firewall-Wartung", "billing_cycle": "jahr",
                                            "unit_price": 480, "renewal_date": today.isoformat()})
    period = today.strftime("%Y-%m")
    client.post("/api/billing/run", json={"period": period})
    inv = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Tischlerei"))
    assert any(i["kind"] == "subscription" and i["total"] == 480 for i in inv["items"])
    # Zweiter Lauf: nicht doppelt; nach Löschen des Entwurfs wieder abrechenbar
    client.post("/api/billing/run", json={"period": period})
    assert sum(1 for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Tischlerei")) == 1
    client.delete(f"/api/invoices/{inv['id']}")
    client.post("/api/billing/run", json={"period": period})
    inv2 = next(i for i in client.get("/api/invoices").json() if i["customer_name"].startswith("Tischlerei"))
    assert any(i["kind"] == "subscription" for i in inv2["items"])
    # Nächster Monat: Jahreslizenz nicht erneut
    nxt = (today.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    r = client.post("/api/billing/run", json={"period": nxt}).json()
    later = [i for i in client.get("/api/invoices").json() if i["period"] == nxt and i["customer_name"].startswith("Tischlerei")]
    assert all(it["description"].find("Firewall-Wartung") < 0 for i in later for it in i["items"]) and r is not None
