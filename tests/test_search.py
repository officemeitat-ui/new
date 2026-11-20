"""Globale Suche: Textauszug aus Dateien, Umlaute/Groß-Klein, alle Bereiche, Dateiinhalt bleibt aktuell."""

from __future__ import annotations

import io
import zipfile

from fpdf import FPDF

from meit.db import fold
from meit.office import new_docx
from meit.search import extract_text, like, snippet, strip_markup, terms_of


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def test_fold_terms_and_snippet():
    assert fold("Müller Straße ÀÉÎ") == "muller strasse aei" and fold(None) == "" and fold(42) == "42"
    assert terms_of("  Müller   müller a 7 Wartung ") == ["muller", "7", "wartung"]  # doppelte und einzelne Buchstaben fallen weg
    assert like("100%_x\\") == "%100\\%\\_x\\\\%"
    text = "Einleitung. " * 30 + "Der Glasfaseranschluss wird am Montag geschaltet. " + "Schluss. " * 30
    s = snippet(text, ["glasfaser"])
    assert "Glasfaseranschluss" in s and s.startswith("… ") and s.endswith(" …") and len(s) < 170
    assert "Bäckerei" in snippet("Die Bäckerei Müller öffnet früh", ["backerei"])  # Treffer nur über Umlaut-Faltung
    assert strip_markup("<p>Eins &amp; zwei</p><p>drei<br/>vier</p>") == "Eins & zwei\ndrei\nvier"


def test_extract_text_from_office_pdf_and_text_files():
    docx = new_docx(['<w:p><w:r><w:t>Wartungsvertrag für die Tischlerei</w:t></w:r></w:p>', '<w:p><w:r><w:t>Laufzeit &amp; Kündigung</w:t></w:r></w:p>'])
    assert extract_text(docx, "Vertrag.docx") == "Wartungsvertrag für die Tischlerei\nLaufzeit & Kündigung"
    xlsx = _zip({"xl/sharedStrings.xml": '<sst><si><t>Artikel</t></si><si><t>Switch 24 Port</t></si></sst>',
                 "xl/workbook.xml": '<workbook><sheets><sheet name="Preisliste 2026" sheetId="1"/></sheets></workbook>',
                 "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="inlineStr"><is><t>Firewall</t></is></c><c><v>1234.5</v></c></row></sheetData></worksheet>'})
    out = extract_text(xlsx, "Preise.xlsx")
    assert "Switch 24 Port" in out and "Preisliste 2026" in out and "Firewall" in out and "1234.5" not in out
    pptx = _zip({"ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Projektstart Serverumzug</a:t></a:r></a:p></p:sld>", "ppt/media/x.bin": "nicht lesen"})
    assert extract_text(pptx, "Kickoff.pptx") == "Projektstart Serverumzug"
    odt = _zip({"content.xml": "<office:document-content><text:p>Netzwerkplan Erdgeschoss</text:p><text:p>VLAN 20</text:p></office:document-content>"})
    assert extract_text(odt, "Plan.odt") == "Netzwerkplan Erdgeschoss\nVLAN 20"
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 10, "Seriennummer SN-4711-XY Firewall")
    assert "SN-4711-XY" in extract_text(bytes(pdf.output()), "Lieferschein.pdf")
    assert extract_text("Zeile eins\nZeile  zwei".encode(), "notiz.txt") == "Zeile eins\nZeile zwei"
    # Unbekanntes, Defektes und Übergroßes stört nie
    assert extract_text(b"\x89PNG....", "bild.png") == "" and extract_text(b"kein zip", "kaputt.docx") == "" and extract_text(b"%PDF-kaputt", "x.pdf") == ""
    bomb = _zip({"word/document.xml": "<w:p><w:r><w:t>" + "A" * (12 * 1024 * 1024) + "</w:t></w:r></w:p>"})
    assert len(bomb) < 100_000 and len(extract_text(bomb, "bombe.docx")) <= 200_000


def test_search_across_areas(client):
    assert client.get("/api/search?q=").json()["groups"] == [] and client.get("/api/search?q=a").json()["total"] == 0
    r = client.get("/api/search?q=huber").json()
    types = {g["type"]: g for g in r["groups"]}
    assert types["customer"]["items"][0]["title"] == "Tischlerei Huber GmbH" and types["customer"]["items"][0]["customer_id"] == 1
    assert r["groups"][0]["type"] == "customer" and r["took_ms"] < 2000
    # Umlaute und Groß-/Kleinschreibung egal, mehrere Wörter müssen alle passen, Suche mitten im Wort
    cid = client.post("/api/customers", json={"name": "Bäckerei Müller & Söhne", "contact_name": "Jörg Müller", "email": "j@mueller.test"}).json()["id"]
    for q in ("muller", "MÜLLER backerei", "ckerei sohne", "jorg"):
        hit = client.get(f"/api/search?q={q}&type=customer").json()
        assert [i["id"] for g in hit["groups"] for i in g["items"]] == [cid], q
    assert client.get("/api/search?q=muller zahnarzt").json()["total"] == 0
    # Ticket über Nummer und über Text; der Kunde steht im Untertitel
    tid = client.post("/api/tickets", json={"customer_id": cid, "title": "Kassensystem startet nicht", "description": "Bondrucker Epson TM-T88 blinkt rot"}).json()["id"]
    by_no = client.get(f"/api/search?q=%23{tid}").json()
    assert by_no["groups"][0]["type"] == "ticket" and by_no["groups"][0]["items"][0]["id"] == tid
    by_text = client.get("/api/search?q=tm-t88").json()["groups"][0]["items"][0]
    assert by_text["id"] == tid and "Bäckerei Müller" in by_text["subtitle"] and "Epson TM-T88" in by_text["snippet"]
    # Platzhalterzeichen sind normale Zeichen (kein „alles gefunden“)
    assert client.get("/api/search?q=%25%25").json()["total"] == 0 and client.get("/api/search?q=__").json()["total"] == 0
    # weitere Bereiche
    client.post("/api/kb", json={"title": "Drucker spoolt endlos", "content": "Dienst Druckwarteschlange neu starten", "tags": "drucker"})
    assert "article" in {g["type"] for g in client.get("/api/search?q=druckwarteschlange").json()["groups"]}
    assert client.get("/api/search?q=huber&type=quatsch").status_code == 422
    many = client.get("/api/search?q=demo&limit=2").json()
    assert all(len(g["items"]) <= 2 for g in many["groups"]) and any(g["more"] for g in many["groups"])
    only = client.get("/api/search?q=demo&type=customer&limit=50").json()
    assert [g["type"] for g in only["groups"]] == ["customer"] and len(only["groups"][0]["items"]) >= 5


def test_file_contents_are_searchable_and_stay_current(app, client):
    store, db = app.state.attachments, app.state.ctx.db
    docx = new_docx(['<w:p><w:r><w:t>Der Glasfaseranschluss wird im März geschaltet.</w:t></w:r></w:p>'])
    f = client.post("/api/files/upload?ref_type=customer&ref_id=1", content=docx, headers={"X-Filename": "Besprechung.docx"}).json()
    client.post("/api/files/upload?ref_type=library", content=b"Checkliste Serverraum: USV pruefen", headers={"X-Filename": "Checkliste.txt"})
    hit = client.get("/api/search?q=glasfaser marz").json()
    files = next(g for g in hit["groups"] if g["type"] == "file")["items"]
    assert files[0]["id"] == f["id"] and files[0]["title"] == "Besprechung.docx" and "Tischlerei Huber" in files[0]["subtitle"]
    assert "Glasfaseranschluss" in files[0]["snippet"] and files[0]["customer_id"] == 1 and hit["pending"] == 0
    by_name = next(g for g in client.get("/api/search?q=checkliste").json()["groups"] if g["type"] == "file")["items"][0]
    assert by_name["subtitle"].startswith("Eigene Ablage") and by_name["snippet"] == ""  # Treffer im Namen braucht keinen Ausschnitt
    assert client.get(f"/api/files/{f['id']}").json()["filename"] == "Besprechung.docx" and client.get("/api/files/99999").status_code == 404
    # Inhalt geändert (z. B. im Office-Editor gespeichert) → alter Text nicht mehr auffindbar, neuer schon
    store.replace(db.get("attachments", f["id"]), new_docx(['<w:p><w:r><w:t>Jetzt geht es um die Telefonanlage.</w:t></w:r></w:p>']), author="Test")
    assert not [g for g in client.get("/api/search?q=glasfaser").json()["groups"] if g["type"] == "file"]
    assert [g for g in client.get("/api/search?q=telefonanlage").json()["groups"] if g["type"] == "file"]
    st = client.get("/api/search/status").json()
    assert st["pending"] == 0 and st["with_text"] >= 2 and st["types"]["file"] == "Dateien"
    # Gelöschte Datei verschwindet samt Index; Neuaufbau liest alles wieder ein
    client.delete(f"/api/attachments/{f['id']}")
    assert db.scalar("SELECT COUNT(*) FROM file_texts WHERE attachment_id = ?", (f["id"],)) == 0
    assert client.get("/api/search?q=telefonanlage").json()["total"] == 0
    assert client.post("/api/search/reindex").json()["pending"] == 0
    assert [g for g in client.get("/api/search?q=usv pruefen").json()["groups"] if g["type"] == "file"]
