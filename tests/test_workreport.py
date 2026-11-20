"""Arbeitsbericht mit Kundenunterschrift: Entwurf, Unterschrift, PDF, Zeitbuchung, Unveränderlichkeit, Versand, Portal."""

from __future__ import annotations

import base64
import io
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from pypdf import PdfReader

from meit.workreport import ReportError, clean_signature, minutes_between


def _signature(blank: bool = False, fmt: str = "PNG", size=(600, 220)) -> str:
    img = Image.new("RGBA", size, (255, 255, 255, 0))
    if not blank:
        d = ImageDraw.Draw(img)
        d.line([(40, 150), (120, 60), (200, 160), (280, 70), (360, 150), (520, 110)], fill=(20, 20, 60, 255), width=5)
    buf = io.BytesIO()
    (img.convert("RGB") if fmt == "JPEG" else img).save(buf, format=fmt)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


class FakeMailer:
    smtp_configured = True

    def __init__(self):
        self.sent = []

    def send(self, to, subject, body, **kw):
        self.sent.append({"to": to, "subject": subject, "body": body, "attachments": kw.get("attachments") or []})
        return "id-1"


def test_signature_is_validated_and_reencoded():
    clean = base64.b64decode(clean_signature(_signature()))
    img = Image.open(io.BytesIO(clean))
    assert clean[:8] == b"\x89PNG\r\n\x1a\n" and img.mode == "L" and img.width <= 900
    for bad in ("", "data:image/png;base64,AAAA", _signature(blank=True), _signature(fmt="JPEG"), "data:text/html;base64,PGI+",
                _signature(size=(10, 10)), "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 700_000).decode()):
        with pytest.raises(ReportError):
            clean_signature(bad)
    assert minutes_between("08:30", "10:00") == 90 and minutes_between("22:30", "01:00") == 150


def test_report_from_appointment_to_signed_pdf(app, client):
    db = app.state.ctx.db
    day = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    tid = client.post("/api/tickets", json={"customer_id": 1, "title": "Firewall defekt"}).json()["id"]
    appt = client.post("/api/appointments", json={"title": "Firewall tauschen", "ticket_id": tid, "start_at": f"{day} 08:30", "duration_min": 120}).json()
    r = client.post("/api/work-reports", json={"appointment_id": appt["id"], "work": "Alte Firewall abgebaut, neue eingebaut und Regeln übernommen.\nVPN getestet.",
                                               "materials": [{"name": "Firewall FortiGate 40F", "qty": 1, "unit": "Stk."}, {"name": "Patchkabel Cat6 2 m", "qty": 3}],
                                               "travel_km": 24.5, "remark": "Altgerät wird entsorgt."})
    assert r.status_code == 201
    rep = r.json()
    year = day[:4]
    assert rep["number"] == f"AB-{year}-0001" and rep["status"] == "entwurf" and rep["customer"] == "Tischlerei Huber GmbH" and rep["ticket_id"] == tid
    assert (rep["date"], rep["start_time"], rep["end_time"], rep["minutes"], rep["duration"]) == (day, "08:30", "10:30", 120, "2:00 Std.")
    assert rep["location"] == appt["location"] and rep["materials"][1] == {"name": "Patchkabel Cat6 2 m", "qty": 3.0, "unit": ""}
    # Entwurf ändern (tatsächliche Zeiten), Vorschau als PDF
    rep = client.put(f"/api/work-reports/{rep['id']}", json={"appointment_id": appt["id"], "start_time": "08:30", "end_time": "11:15",
                                                             "work": rep["work"], "materials": rep["materials"], "travel_km": 24.5, "remark": rep["remark"]}).json()
    assert rep["minutes"] == 165
    preview = client.get(f"/api/work-reports/{rep['id']}/pdf")
    assert preview.headers["content-type"] == "application/pdf" and preview.content[:4] == b"%PDF" and "ENTWURF" in _pdf_text(preview.content)
    # Abschluss braucht Unterschrift + Namen oder einen Grund
    assert client.post(f"/api/work-reports/{rep['id']}/sign", json={}).status_code == 422
    assert client.post(f"/api/work-reports/{rep['id']}/sign", json={"signature": _signature()}).status_code == 422
    assert client.post(f"/api/work-reports/{rep['id']}/sign", json={"signature": _signature(blank=True), "signer_name": "Franz Huber"}).status_code == 422
    done = client.post(f"/api/work-reports/{rep['id']}/sign", json={"signature": _signature(), "signer_name": "Franz Huber", "send_to": "kunde"}).json()
    assert done["status"] == "unterschrieben" and done["signed"] and done["signer_name"] == "Franz Huber" and "nicht gesendet" in done["mail"]
    # Zeit gebucht (einmal), Termin erledigt, PDF im Kundenordner abgelegt
    entry = db.get("time_entries", done["time_entry_id"])
    assert entry["minutes"] == 165 and entry["ticket_id"] == tid and entry["date"] == day and entry["description"].startswith(f"Arbeitsbericht AB-{year}-0001: Alte Firewall")
    after = client.get(f"/api/appointments/{appt['id']}").json()
    assert after["status"] == "erledigt" and after["time_entry_id"] == done["time_entry_id"]
    doc = db.get("documents", done["document_id"])
    assert doc["kind"] == "bericht" and doc["customer_id"] == 1 and doc["ref_type"] == "work_report" and "Tischlerei Huber GmbH" in doc["folder"]
    pdf = client.get(f"/api/work-reports/{rep['id']}/pdf").content
    text = _pdf_text(pdf)
    for part in (f"Arbeitsbericht AB-{year}-0001", "Tischlerei Huber GmbH", "2:45 Std.", "FortiGate 40F", "3", "24,5 km", "VPN getestet", "Altgerät wird entsorgt",
                 "Franz Huber", "Auftraggeber"):
        assert part in text, part
    assert b"/Subtype /Image" in pdf  # die Unterschrift ist als Bild eingebettet
    # danach unveränderlich
    assert client.put(f"/api/work-reports/{rep['id']}", json={"customer_id": 1, "minutes": 5, "work": "manipuliert"}).status_code == 409
    assert client.delete(f"/api/work-reports/{rep['id']}").status_code == 409
    assert client.post(f"/api/work-reports/{rep['id']}/sign", json={"signature": _signature(), "signer_name": "X"}).status_code == 409
    assert client.post(f"/api/appointments/{appt['id']}/complete", json={}).json()["time_entry_id"] == done["time_entry_id"]
    assert db.scalar("SELECT COUNT(*) FROM time_entries WHERE ticket_id = ?", (tid,)) == 1
    # ein Bericht zu einem Fernwartungs-Termin übernimmt dessen Art, wenn nichts anderes angegeben ist
    remote = client.post("/api/appointments", json={"title": "Fernwartung", "customer_id": 1, "kind": "remote", "start_at": f"{day} 13:00"}).json()
    rr = client.post("/api/work-reports", json={"appointment_id": remote["id"], "work": "Updates"}).json()
    assert rr["kind"] == "remote" and client.post("/api/work-reports", json={"appointment_id": remote["id"], "kind": "vor_ort", "work": "doch vor Ort"}).json()["kind"] == "vor_ort"


def test_without_signature_standalone_send_and_portal(app, client):
    db = app.state.ctx.db
    assert client.post("/api/work-reports", json={"work": "ohne Kunde", "minutes": 30}).status_code == 422
    assert client.post("/api/work-reports", json={"customer_id": 1, "work": "ohne Dauer"}).status_code == 422
    assert client.post("/api/work-reports", json={"appointment_id": 99999, "work": "x"}).status_code == 404
    a = client.post("/api/work-reports", json={"customer_id": 1, "kind": "remote", "minutes": 45, "work": "Outlook-Profil neu erstellt"}).json()
    b = client.post("/api/work-reports", json={"customer_id": 2, "minutes": 30, "work": "Router neu gestartet"}).json()
    empty = client.post("/api/work-reports", json={"customer_id": 1, "minutes": 15}).json()
    assert [a["number"][-4:], b["number"][-4:], empty["number"][-4:]] == ["0001", "0002", "0003"] and a["location"] == ""
    assert client.post(f"/api/work-reports/{empty['id']}/sign", json={"no_signature_reason": "niemand da"}).status_code == 422  # ohne Tätigkeit
    assert client.delete(f"/api/work-reports/{empty['id']}").json() == {"ok": True}
    assert client.post(f"/api/work-reports/{a['id']}/send", json={}).status_code == 409  # Entwurf
    done = client.post(f"/api/work-reports/{a['id']}/sign", json={"no_signature_reason": "Fernwartung – Kunde nicht vor Ort", "book_time": False}).json()
    assert done["status"] == "ohne_unterschrift" and done["time_entry_id"] is None and not done["signed"] and done["mail"] == ""
    assert "Ohne Unterschrift des Auftraggebers" in _pdf_text(client.get(f"/api/work-reports/{a['id']}/pdf").content)
    assert client.post(f"/api/work-reports/{a['id']}/send", json={}).status_code == 422  # kein Mailversand eingerichtet
    mailer = FakeMailer()
    app.state.ctx.mailer = mailer
    sent = client.post(f"/api/work-reports/{a['id']}/send", json={}).json()
    mail = mailer.sent[0]
    assert sent["sent_to"] == "office@huber-demo.at" == mail["to"] and mail["subject"].startswith(f"Arbeitsbericht {a['number']} vom ")
    assert mail["attachments"][0].name == f"Arbeitsbericht_{a['number']}.pdf" and mail["attachments"][0].data[:4] == b"%PDF"
    assert client.post(f"/api/work-reports/{a['id']}/send", json={"to": "keine-adresse"}).status_code == 422
    assert [r["id"] for r in client.get("/api/work-reports?customer_id=1").json()] == [a["id"]] and len(client.get("/api/work-reports").json()) == 2
    # Kundenportal: nur eigene, abgeschlossene Berichte
    pu = client.post("/api/customers/1/portal-users", json={"name": "Franz", "email": "franz@huber-demo.at"}).json()
    portal = TestClient(app)
    assert portal.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    mine = portal.get("/api/portal/work-reports").json()
    assert [m["number"] for m in mine] == [a["number"]] and mine[0]["summary"] == "Outlook-Profil neu erstellt" and mine[0]["minutes"] == 45
    assert portal.get(f"/api/portal/work-reports/{a['id']}/pdf").content[:4] == b"%PDF"
    assert portal.get(f"/api/portal/work-reports/{b['id']}/pdf").status_code == 404  # fremder Kunde und noch Entwurf
    assert db.scalar("SELECT COUNT(*) FROM work_reports") == 2
