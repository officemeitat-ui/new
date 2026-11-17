"""Dokumentenprozess: PDFs im Corporate Design, Archiv, SharePoint/OneDrive-Upload, Versand per Mail."""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from meit.documents import (DocumentError, DocumentService, GraphDrive, parse_site, render_folder, safe_filename,
                            fill_text)
from meit.mail import ParsedMail
from meit.pdf import clean


class FakeMailer:
    imap_configured = True
    smtp_configured = True

    def __init__(self, inbox=None):
        self.sent, self.inbox = [], inbox or []

    def send(self, to, subject, body, in_reply_to="", reply_handle="", attachments=None, html="", cc=""):
        self.sent.append({"to": to, "subject": subject, "body": body, "attachments": attachments or [], "html": html,
                          "cc": cc})
        return f"<sent-{len(self.sent)}@test>"

    def fetch_unseen(self, limit=25):
        mails, self.inbox = self.inbox, []
        return mails


class FakeDrive:
    def __init__(self, fail: bool = False):
        self.fail, self.uploads = fail, []

    def upload(self, path, data, content_type="application/octet-stream"):
        if self.fail:
            raise DocumentError("Microsoft Graph 403: Access denied")
        self.uploads.append((path, len(data), content_type))
        return {"id": f"item-{len(self.uploads)}", "url": f"https://firma.sharepoint.com/sites/ME-IT/{path}"}

    def test(self):
        return {"ok": True, "url": "https://firma.sharepoint.com/sites/ME-IT/Dokumente", "name": "Dokumente"}


def _stell_rechnung(client) -> dict:
    client.put("/api/billing/profile", json={"address": "Musterstraße 1\n5400 Hallein", "uid": "ATU12345678",
                                             "iban": "AT611904300234573201", "bic": "BKAUATWW"})
    assert client.post("/api/billing/run", json={"period": "2026-10"}).json()["count"] >= 1
    inv = client.get("/api/invoices?status=entwurf").json()[0]
    r = client.put(f"/api/invoices/{inv['id']}", json={"status": "gestellt"})
    assert r.status_code == 200
    return r.json()


def _use_drive(app, drive):
    docs = app.state.ctx.docs
    docs.drive_factory = lambda settings, conf: drive
    docs._drive = None
    return docs


# ------------------------------------------------------------------ Hilfsfunktionen
def test_folder_and_filename_sanitizing():
    assert render_folder("Kunden/{kunde}/Rechnungen/{jahr}", kunde='A/B: "C" <GmbH>') .startswith("Kunden/A B C GmbH/Rechnungen/")
    assert render_folder("Buchhaltung/{jahr}/{monat}").count("/") == 2
    assert render_folder("../../{kunde}", kunde="..") == "Unbenannt/Unbenannt/Unbenannt"
    assert "/" not in safe_filename("../../etc/passwd.pdf") and safe_filename("Rechnung 1.PDF") == "Rechnung_1.pdf"
    assert fill_text("{anrede} {nummer} {x.__class__} {unbekannt}", {"anrede": "Hallo", "nummer": "1"}) == \
        "Hallo 1 {x.__class__} {unbekannt}"


def test_parse_sharepoint_site():
    assert parse_site("https://firma.sharepoint.com/sites/ME-IT/Shared%20Documents/Forms/AllItems.aspx") == \
        ("firma.sharepoint.com", "/sites/ME-IT")
    assert parse_site("firma.sharepoint.com:/teams/Buchhaltung") == ("firma.sharepoint.com", "/teams/Buchhaltung")
    with pytest.raises(DocumentError):
        parse_site("https://evil.example.com/sites/x")


def test_pdf_clean_removes_unsupported_glyphs():
    assert clean("Backup ✓ ok ✅ Trend ▲ 5 % 🚀") == "Backup ok Trend + 5 %"
    assert clean("Grüße – € „Zitat“") == "Grüße – € „Zitat“"


# ------------------------------------------------------------------ PDFs & Archiv
def test_invoice_finalize_archives_pdf(client, app):
    inv = _stell_rechnung(client)
    docs = client.get(f"/api/documents?ref_type=invoice&ref_id={inv['id']}").json()
    assert len(docs) == 1 and docs[0]["kind"] == "rechnung" and docs[0]["remote"] == "local"
    assert docs[0]["folder"].startswith("Buchhaltung/Ausgangsrechnungen/")
    path = app.state.ctx.docs.archive_dir / docs[0]["local_path"]
    assert path.read_bytes().startswith(b"%PDF")
    dl = client.get(f"/api/documents/{docs[0]['id']}/download")
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF")
    pdf = client.get(f"/api/invoices/{inv['id']}/pdf")
    assert pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    assert inv["number"] in pdf.headers["content-disposition"]


def test_draft_invoice_pdf_preview_but_no_archive(client):
    client.post("/api/billing/run", json={"period": "2026-10"})
    draft = client.get("/api/invoices?status=entwurf").json()[0]
    assert client.get(f"/api/invoices/{draft['id']}/pdf").content.startswith(b"%PDF")
    assert client.post(f"/api/invoices/{draft['id']}/archive").status_code == 422


def test_quote_and_report_pdf(client, app):
    q = client.post("/api/agents/quote", json={"customer_id": 1, "need": "Backup und Firewall", "tiers": True}).json()
    r = client.get(f"/api/quotes/{q['id']}/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    doc = client.post(f"/api/quotes/{q['id']}/archive").json()
    assert doc["folder"].startswith("Kunden/Tischlerei Huber GmbH/Angebote/") and doc["filename"].startswith("Angebot_A-")
    rep = client.post("/api/documents/report", json={"title": "Monatsbericht ✓", "customer_id": 1, "kind": "qbr",
                                                     "text": "# Bericht\n\n| A | B |\n|---|---|\n| x | 1 |\n\n- Punkt ✅"})
    assert rep.status_code == 201 and "/Berichte/" in rep.json()["local_path"]
    assert len(client.get("/api/documents?customer_id=1").json()) == 2


def test_download_rejects_path_outside_archive(client, app):
    db = app.state.ctx.db
    did = db.insert("documents", {"kind": "bericht", "filename": "x.pdf", "local_path": "../../test.db"})
    assert client.get(f"/api/documents/{did}/download").status_code == 422


# ------------------------------------------------------------------ SharePoint / OneDrive
def test_sharepoint_upload_and_retry(client, app):
    assert client.put("/api/documents/settings", json={"target": "sharepoint",
                                                       "sharepoint_site": "https://firma.sharepoint.com/sites/ME-IT"}).status_code == 200
    failing = FakeDrive(fail=True)
    _use_drive(app, failing)
    inv = _stell_rechnung(client)
    doc = client.get(f"/api/documents?ref_type=invoice&ref_id={inv['id']}").json()[0]
    assert doc["remote_status"] == "fehler" and "403" in doc["remote_error"]
    assert client.get("/api/documents/settings").json()["errors"] == 1

    ok = FakeDrive()
    _use_drive(app, ok)
    doc = client.post(f"/api/documents/{doc['id']}/retry").json()
    assert doc["remote_status"] == "ok" and doc["remote_url"].startswith("https://firma.sharepoint.com/")
    paths = [p for p, _, _ in ok.uploads]
    year = inv["date"][:4]
    assert paths[0].startswith(f"ME-IT/Buchhaltung/Ausgangsrechnungen/{year}/Rechnung_{inv['number']}")
    assert paths[1].startswith(f"ME-IT/Kunden/{inv['customer_name']}/Rechnungen/{year}/")
    assert client.post("/api/documents/test").json()["ok"] is True


def test_settings_validation(client):
    assert client.put("/api/documents/settings", json={"target": "dropbox"}).status_code == 422
    assert client.put("/api/documents/settings", json={"target": "sharepoint",
                                                       "sharepoint_site": "https://example.com/x"}).status_code == 422
    s = client.put("/api/documents/settings", json={"folders": {"beleg": "Steuerberater/{jahr}", "hack": "x"},
                                                    "auto_receipts": False}).json()
    assert s["folders"]["beleg"] == "Steuerberater/{jahr}" and "hack" not in s["folders"] and s["auto_receipts"] is False


class FakeResponse:
    def __init__(self, data, status=200):
        self._data, self.status_code = data, status

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


def test_graph_drive_resolves_site_and_uploads(monkeypatch, settings):
    import httpx

    calls = []
    s = dataclasses.replace(settings, graph_tenant_id="t", graph_client_id="c", graph_client_secret="x")
    monkeypatch.setattr(httpx, "post", lambda url, **kw: FakeResponse({"access_token": "tok", "expires_in": 3600}))

    def fake_request(method, url, headers=None, **kw):
        calls.append((method, url, headers.get("Authorization"), kw.get("content")))
        if url.endswith("/sites/firma.sharepoint.com:/sites/ME-IT"):
            return FakeResponse({"id": "site-1"})
        if url.endswith("/sites/site-1/drives"):
            return FakeResponse({"value": [{"id": "drv-9", "name": "Buchhaltung"}]})
        return FakeResponse({"id": "item-1", "webUrl": "https://firma.sharepoint.com/x.pdf"})

    monkeypatch.setattr(httpx, "request", fake_request)
    drive = GraphDrive(s, {"target": "sharepoint", "sharepoint_site": "https://firma.sharepoint.com/sites/ME-IT",
                           "library": "buchhaltung"})
    result = drive.upload("ME-IT/Kunden/Müller & Co/Rechnung 1.pdf", b"%PDF-1.4 test", "application/pdf")
    assert result == {"id": "item-1", "url": "https://firma.sharepoint.com/x.pdf"}
    method, url, auth, content = calls[-1]
    assert method == "PUT" and auth == "Bearer tok" and content == b"%PDF-1.4 test"
    assert url.startswith("https://graph.microsoft.com/v1.0/drives/drv-9/root:/ME-IT/Kunden/M%C3%BCller%20%26%20Co/")
    assert url.endswith(":/content?@microsoft.graph.conflictBehavior=replace")


def test_graph_drive_large_upload_uses_session(monkeypatch, settings):
    import httpx

    s = dataclasses.replace(settings, graph_tenant_id="t", graph_client_id="c", graph_client_secret="x")
    monkeypatch.setattr(httpx, "post", lambda url, **kw: FakeResponse({"access_token": "tok", "expires_in": 3600}))
    monkeypatch.setattr(httpx, "request", lambda method, url, headers=None, **kw: FakeResponse(
        {"uploadUrl": "https://upload.example/session"}))
    chunks = []

    def fake_put(url, content=None, headers=None, timeout=None):
        chunks.append(headers["Content-Range"])
        done = headers["Content-Range"].split("-")[1].split("/")
        final = int(done[0]) + 1 == int(done[1])
        return FakeResponse({"id": "big", "webUrl": "https://x/big.pdf"} if final else {}, 201 if final else 202)

    monkeypatch.setattr(httpx, "put", fake_put)
    drive = GraphDrive(s, {"target": "onedrive", "onedrive_user": "office@firma.at"})
    data = b"x" * (11 * 1024 * 1024)
    assert drive.upload("ME-IT/gross.pdf", data)["id"] == "big"
    assert len(chunks) == 3 and chunks[-1].endswith(f"/{len(data)}")


def test_graph_drive_without_credentials(settings):
    drive = GraphDrive(dataclasses.replace(settings, graph_tenant_id=""), {"target": "onedrive", "onedrive_user": "a@b.at"})
    with pytest.raises(DocumentError, match="nicht eingerichtet"):
        drive.upload("x.pdf", b"1")


# ------------------------------------------------------------------ Versand
def test_send_invoice_with_pdf_xml_and_branded_html(client, app):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    client.put("/api/customers/1", json={"uid": "ATU87654321"})
    inv = _stell_rechnung(client)
    preset = client.get(f"/api/invoices/{inv['id']}/mail").json()
    assert preset["to"] and inv["number"] in preset["subject"] and "Guten Tag" in preset["text"]
    r = client.post(f"/api/invoices/{inv['id']}/send", json={**preset, "cc": "stb@kanzlei.at"})
    assert r.status_code == 200, r.text
    sent = fake.sent[0]
    names = [a.name for a in sent["attachments"]]
    assert names[0].startswith(f"Rechnung_{inv['number']}") and sent["attachments"][0].data.startswith(b"%PDF")
    assert any(n.startswith("ebInterface_") for n in names)
    logo = [a for a in sent["attachments"] if a.inline_id == "logo"]
    assert logo and "cid:logo" in sent["html"] and sent["cc"] == "stb@kanzlei.at"
    row = client.get("/api/invoices").json()
    assert next(i for i in row if i["id"] == inv["id"])["sent_to"] == preset["to"]
    out = client.get("/api/inbox?direction=out").json()
    assert any(m["linked_type"] == "invoice" and m["linked_id"] == inv["id"] for m in out)


def test_send_rejects_drafts_bad_addresses_and_missing_mailer(client, app):
    client.post("/api/billing/run", json={"period": "2026-10"})
    draft = client.get("/api/invoices?status=entwurf").json()[0]
    body = {"to": "kunde@firma.at", "subject": "Rechnung", "text": "Hallo"}
    app.state.ctx.mailer = FakeMailer()
    assert client.post(f"/api/invoices/{draft['id']}/send", json=body).status_code == 422
    inv = client.put(f"/api/invoices/{draft['id']}", json={"status": "gestellt"}).json()
    assert client.post(f"/api/invoices/{inv['id']}/send", json={**body, "to": "kein-mail"}).status_code == 422
    assert client.post(f"/api/invoices/{inv['id']}/send", json={**body, "cc": "a@b.at; x"}).status_code == 422
    app.state.ctx.mailer = None
    assert "Mailversand" in client.post(f"/api/invoices/{inv['id']}/send", json=body).json()["detail"]


def test_send_quote_marks_as_sent(client, app):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    q = client.post("/api/agents/quote", json={"customer_id": 1, "need": "Firewall"}).json()
    preset = client.get(f"/api/quotes/{q['id']}/mail").json()
    assert q["title"] in preset["subject"]
    assert client.post(f"/api/quotes/{q['id']}/send", json=preset).status_code == 200
    quote = next(x for x in client.get("/api/quotes").json() if x["id"] == q["id"])
    assert quote["status"] == "versendet" and quote["sent_at"]
    assert fake.sent[0]["attachments"][0].name.startswith("Angebot_A-")
    assert client.get(f"/api/documents?ref_type=quote&ref_id={q['id']}").json()


# ------------------------------------------------------------------ Belege
def _pdf_bytes() -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=12)
    pdf.cell(0, 10, "Rechnung Nr. 2026-4711  Betrag EUR 119,00")
    return bytes(pdf.output())


def test_receipt_pdf_from_mailbox_is_archived(client, app):
    pm = ParsedMail(message_id="<beleg-1@a1.at>", from_name="A1 Telekom", from_email="rechnung@a1.at",
                    subject="Ihre Rechnung 2026-4711", body="Ihre Rechnung über € 119,00 liegt bei. Rechnungsnummer 2026-4711",
                    attachments=["Rechnung.pdf"], files=[("Rechnung.pdf", _pdf_bytes())])
    app.state.ctx.mailer = FakeMailer([pm])
    r = client.post("/api/inbox/fetch").json()
    assert r["new"] == 1 and r["archived"] == 1
    receipt = client.get("/api/receipts").json()[0]
    assert receipt["document_id"]
    doc = client.get(f"/api/documents?kind=beleg").json()[0]
    assert doc["folder"].startswith("Buchhaltung/Eingangsrechnungen/") and doc["ref_id"] == receipt["id"]
    assert client.get(f"/api/documents/{doc['id']}/download").content.startswith(b"%PDF")


def test_receipt_upload(client):
    r = client.post("/api/receipts/upload", content=_pdf_bytes(),
                    headers={"Content-Type": "application/pdf", "X-Filename": "Gr%C3%BC%C3%9Fe%20Rechnung.pdf"})
    assert r.status_code == 201
    assert r.json()["documents"][0]["kind"] == "beleg" and "Größe" not in r.json()["receipt"]["note"]
    assert "Grüße Rechnung.pdf" in r.json()["receipt"]["note"]
    assert client.post("/api/receipts/upload", content=b"GIF89a", headers={"Content-Type": "image/gif"}).status_code == 415


def test_service_without_settings_object(tmp_path):
    from meit.db import Database

    db = Database(str(tmp_path / "x.db"))
    db.init_schema()
    svc = DocumentService(db, None, tmp_path)
    assert svc.archive_dir == tmp_path / "archiv"
    doc = svc.archive_text("Notiz", "# Hallo\n\nText")
    assert (Path(svc.archive_dir) / doc["local_path"]).read_bytes().startswith(b"%PDF")


def test_backup_mirrors_archive(client, tmp_path):
    doc = client.post("/api/documents/report", json={"title": "Bericht", "text": "Text", "customer_id": 1}).json()
    r = client.post("/api/backup/run").json()
    assert r["archive_copied"] == 1
    assert (tmp_path / "backups" / "archiv" / doc["local_path"]).read_bytes().startswith(b"%PDF")
    assert client.post("/api/backup/run").json()["archive_copied"] == 0
