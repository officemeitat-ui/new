"""SLA: Geschäftszeiten, Fristen, Ampel, Quoten."""

from datetime import datetime

from meit.sla import DEFAULT_SLA, add_business_hours, business_hours_between, ticket_sla

BH = DEFAULT_SLA["business_hours"]
CFG = {"business_hours": BH, "packages": DEFAULT_SLA["packages"]}


def test_business_hours_math():
    fri = datetime(2026, 11, 13, 16, 0)  # Freitag 16:00
    assert add_business_hours(fri, 2, BH) == datetime(2026, 11, 16, 9, 0)  # Montag 9:00
    sat = datetime(2026, 11, 14, 10, 0)
    assert add_business_hours(sat, 1, BH) == datetime(2026, 11, 16, 9, 0)
    assert add_business_hours(datetime(2026, 11, 16, 6, 0), 1, BH) == datetime(2026, 11, 16, 9, 0)
    assert business_hours_between(fri, datetime(2026, 11, 16, 9, 0), BH) == 2
    assert business_hours_between(datetime(2026, 11, 16, 9, 0), fri, BH) == 0


def test_ticket_sla_states():
    t = {"created_at": "2026-11-16 08:00:00", "priority": "kritisch", "status": "neu", "first_response_at": "", "resolved_at": ""}
    s = ticket_sla(t, "pro", CFG, now=datetime(2026, 11, 16, 9, 0))  # Reaktion 2 h → noch 1 h
    assert s["response"]["state"] == "ok" and s["response"]["left_h"] == 1.0
    assert ticket_sla(t, "pro", CFG, now=datetime(2026, 11, 16, 9, 40))["response"]["state"] == "knapp"
    late = ticket_sla(t, "pro", CFG, now=datetime(2026, 11, 16, 11, 0))
    assert late["response"]["state"] == "verletzt" and late["response"]["left_h"] == -1.0
    done = {**t, "first_response_at": "2026-11-16 09:30:00", "status": "geloest", "resolved_at": "2026-11-16 15:30:00"}
    s = ticket_sla(done, "pro", CFG, now=datetime(2026, 11, 20))
    assert s["response"]["state"] == "erfüllt" and s["resolution"]["state"] == "erfüllt" and s["resolution"]["took_h"] == 7.5
    assert ticket_sla(t, "keins", CFG)["resolution"]["state"] == "keine Zusage"


def test_first_response_and_overview(client):
    t = client.post("/api/tickets", json={"customer_id": 2, "title": "Server down", "priority": "kritisch",
                                          "auto_triage": False}).json()
    row = next(x for x in client.get("/api/tickets").json() if x["id"] == t["id"])
    assert row["sla"]["package"] == "pro" and row["sla"]["response"]["target_h"] == 2
    client.put(f"/api/tickets/{t['id']}", json={"status": "in_arbeit"})
    assert client.get(f"/api/tickets/{t['id']}").json()["first_response_at"]
    ov = client.get("/api/sla").json()
    assert "breached_open" in ov and any(o["id"] == t["id"] for o in ov["open"])
    assert client.get("/api/dashboard").json()["sla"]["breached_open"] >= 0


def test_reply_counts_as_response(client):
    client.post("/api/inbox/process-new")
    msg = next(m for m in client.get("/api/inbox?direction=in").json() if m["category"] == "support")
    client.post(f"/api/inbox/{msg['id']}/approve", json={"text": "Wir sind dran.", "manual": True})
    assert client.get(f"/api/tickets/{msg['linked_id']}").json()["first_response_at"]


def test_sla_config_update(client):
    r = client.put("/api/sla/config", json={"packages": {"pro": {"kritisch": [1, 6]}}, "business_hours": {"start": 7, "end": 18}})
    cfg = r.json()
    assert cfg["packages"]["pro"]["kritisch"] == [1, 6] and cfg["packages"]["pro"]["hoch"] == [4, 16]
    assert cfg["business_hours"]["start"] == 7
    assert client.put("/api/sla/config", json={"business_hours": {"start": 18, "end": 7}}).status_code == 422


def test_qbr_and_report_mention_sla(client):
    t = client.post("/api/tickets", json={"customer_id": 2, "title": "Drucker", "auto_triage": False}).json()
    client.put(f"/api/tickets/{t['id']}", json={"status": "geloest", "solution": "ok"})
    assert "SLA eingehalten" in client.post("/api/agents/qbr", json={"customer_id": 2}).json()["text"]
    assert "SLA eingehalten" in client.post("/api/agents/report", json={"customer_id": 2}).json()["text"]
