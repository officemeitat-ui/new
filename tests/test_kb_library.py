"""Hilfe-Bibliothek: Format der mitgelieferten Artikel, Einlesen, Aktualisieren, Liste und Suche."""

import re

from meit import kb_library as lib
from meit.knowledge import keyword_scores, related

SAMPLE = """=== ARTIKEL
titel: Drucker druckt nur leere Seiten aus dem Fach
bereich: Drucker & Scanner
tags: Drucker, leer, Toner
zielgruppe: kunde
---
**Symptom:** Der Drucker zieht Papier ein, die Seiten bleiben aber weiß.

**Häufige Ursachen:** leerer Toner, Transportsicherung nicht entfernt, falscher Treiber.

## Lösung
1. Tonerstand am Gerät prüfen und die Kartusche vorsichtig schwenken.
2. Testseite direkt am Gerät drucken.

## Wenn das nicht hilft
- Ticket anlegen und das Modell dazuschreiben.

=== ARTIKEL
titel: Druckserver neu aufsetzen und Warteschlangen übernehmen
bereich: Drucker & Scanner
tags: druckserver, migration
zielgruppe: technik
---
**Symptom:** Der alte Druckserver wird abgelöst, alle Warteschlangen sollen erhalten bleiben.

**Häufige Ursachen:** Hardwaretausch, neues Betriebssystem, Aufräumen alter Treiber.

## Lösung
1. Warteschlangen und Treiber mit der Druckverwaltung exportieren.
2. Auf dem neuen Server importieren und eine Testseite drucken.

## Wenn das nicht hilft
- Treiber einzeln neu installieren.
"""


def articles(text=SAMPLE):
    found, problems = lib.parse(text, "test.md")
    assert not problems
    return [{**a, "external_id": f"lib:{lib.slugify(a['title'])}"} for a in found]


def test_parse_reads_head_and_body():
    found, problems = lib.parse(SAMPLE, "test.md")
    assert not problems and len(found) == 2
    first = found[0]
    assert first["title"].startswith("Drucker druckt nur leere Seiten")
    assert first["area"] == "Drucker & Scanner" and first["audience"] == "kunde"
    assert first["tags"] == "drucker, leer, toner"  # klein geschrieben, sauber getrennt
    assert first["content"].startswith("**Symptom:**") and "=== ARTIKEL" not in first["content"]


def test_parse_reports_broken_articles_instead_of_importing_them():
    broken = ("=== ARTIKEL\ntitel: Ohne Bereich und Trennzeile\nzielgruppe: kunde\nText\n"
              "=== ARTIKEL\ntitel: Falsche Zielgruppe hier\nbereich: Test\nzielgruppe: alle\n---\n" + "Inhalt " * 60 + "\n"
              "=== ARTIKEL\ntitel: Viel zu kurzer Artikel\nbereich: Test\nzielgruppe: technik\n---\nkurz\n")
    found, problems = lib.parse(broken, "kaputt.md")
    assert found == [] and len(problems) == 3
    assert "kaputt.md" in problems[0] and "zielgruppe" in problems[1] and "zu kurz" in problems[2]


def test_shipped_library_is_large_and_well_formed():
    """Die mitgelieferten Dateien: viele Artikel, keine Formatfehler, einheitlicher Aufbau, nichts Riskantes für Anwender."""
    found, problems = lib.load()
    assert problems == []
    assert len(found) >= 580
    areas = {a["area"] for a in found}
    assert len(areas) == 20
    assert len({a["external_id"] for a in found}) == len(found)
    for a in found:
        words = len(a["content"].split())
        assert 100 <= words <= 320, (a["title"], words)
        assert 20 <= len(a["title"]) <= 100, a["title"]
        assert a["content"].startswith("**Symptom:**"), a["title"]
        assert "## Wenn das nicht hilft" in a["content"] or "## Für das Ticket notieren" in a["content"], a["title"]
        assert len([t for t in a["tags"].split(",") if t.strip()]) >= 3, a["title"]
        assert not re.search(r"<(script|img|a|iframe)\b", a["content"], re.I), a["title"]
    users = [a for a in found if a["audience"] == "kunde"]
    assert len(users) >= 200 and len(found) - len(users) >= 300
    # Anleitungen für Anwender landen im Kundenportal: keine Admin-Werkzeuge, keine Befehle mit Löschwirkung
    forbidden = re.compile(r"regedit|netsh |diskpart|\bdel /|format [a-z]:|Remove-|Set-Mailbox|als Administrator ausführen|net stop", re.I)
    for a in users:
        assert not forbidden.search(a["content"]), a["title"]


def test_import_is_idempotent_and_marks_user_articles_public(app):
    db = app.state.ctx.db
    before = db.scalar("SELECT COUNT(*) FROM kb_articles")
    first = lib.import_library(db, articles())
    assert (first["created"], first["updated"], first["unchanged"]) == (2, 0, 0)
    rows = {r["title"]: r for r in db.query("SELECT * FROM kb_articles WHERE source = 'bibliothek'")}
    assert len(rows) == 2 and db.scalar("SELECT COUNT(*) FROM kb_articles") == before + 2
    user = rows["Drucker druckt nur leere Seiten aus dem Fach"]
    assert user["public"] == 1 and user["area"] == "Drucker & Scanner" and user["external_id"].startswith("lib:")
    assert rows["Druckserver neu aufsetzen und Warteschlangen übernehmen"]["public"] == 0  # Technik bleibt intern
    again = lib.import_library(db, articles())
    assert (again["created"], again["updated"], again["unchanged"]) == (0, 0, 2)
    assert db.get_setting("kb_library_last")["total"] == 2


def test_update_keeps_own_changes_and_deletions(app):
    db = app.state.ctx.db
    lib.import_library(db, articles())
    rows = {r["title"]: r for r in db.query("SELECT * FROM kb_articles WHERE source = 'bibliothek'")}
    edited = rows["Drucker druckt nur leere Seiten aus dem Fach"]
    deleted = rows["Druckserver neu aufsetzen und Warteschlangen übernehmen"]
    db.update("kb_articles", edited["id"], {"content": edited["content"] + "\n\nBei uns: Toner liegt im Lager, Regal 3."})
    db.delete("kb_articles", deleted["id"])

    newer = articles(SAMPLE.replace("Testseite direkt am Gerät drucken.", "Testseite direkt am Gerät drucken und aufheben."))
    result = lib.import_library(db, newer)
    assert (result["created"], result["updated"], result["kept_modified"], result["kept_deleted"]) == (0, 0, 1, 1)
    assert "Regal 3" in db.get("kb_articles", edited["id"])["content"]  # eigene Fassung bleibt
    assert db.scalar("SELECT COUNT(*) FROM kb_articles WHERE source = 'bibliothek'") == 1  # Gelöschtes kommt nicht wieder
    assert lib.import_library(db, newer)["kept_modified"] == 1  # … auch beim nächsten Mal nicht


def test_untouched_article_gets_the_new_version(app):
    db = app.state.ctx.db
    lib.import_library(db, articles())
    row = db.query("SELECT * FROM kb_articles WHERE title LIKE 'Drucker druckt nur%'")[0]
    db.update("kb_articles", row["id"], {"public": 0})  # nur die Portal-Freigabe geändert – das ist keine eigene Fassung
    result = lib.import_library(db, articles(SAMPLE.replace("vorsichtig schwenken", "leicht schütteln")))
    assert result["updated"] == 1 and result["unchanged"] == 1
    fresh = db.get("kb_articles", row["id"])
    assert "leicht schütteln" in fresh["content"] and fresh["public"] == 0 and fresh["embedding"] == ""


def test_overview_list_and_article_endpoints(client, app):
    db = app.state.ctx.db
    own = db.scalar("SELECT COUNT(*) FROM kb_articles")
    lib.import_library(db, articles())
    o = client.get("/api/kb/overview").json()
    assert o["total"] == own + 2 and o["library"] == 2
    area = {a["area"]: a for a in o["areas"]}
    assert area["Drucker & Scanner"] == {"area": "Drucker & Scanner", "n": 2, "public": 1}
    if own:
        assert o["areas"][0]["area"] == "Eigene Artikel"  # eigene Artikel stehen vorne

    listing = client.get("/api/kb/list", params={"area": "Drucker & Scanner"}).json()
    assert listing["total"] == 2 and "content" not in listing["items"][0] and listing["items"][0]["snippet"]
    only_users = client.get("/api/kb/list", params={"area": "Drucker & Scanner", "audience": "kunde"}).json()
    assert [i["public"] for i in only_users["items"]] == [True]
    page = client.get("/api/kb/list", params={"limit": 1, "offset": 1}).json()
    assert len(page["items"]) == 1 and page["total"] == own + 2

    found = client.get("/api/kb/list", params={"q": "druckserver warteschlangen"}).json()
    assert found["items"][0]["title"].startswith("Druckserver neu aufsetzen") and found["mode"] == "stichwort"
    assert client.get("/api/kb/list", params={"q": "druckserver", "audience": "kunde"}).json()["items"] == [] or all(
        i["public"] for i in client.get("/api/kb/list", params={"q": "druckserver", "audience": "kunde"}).json()["items"])

    full = client.get(f"/api/kb/{found['items'][0]['id']}").json()
    assert full["content"].startswith("**Symptom:**") and full["source"] == "bibliothek" and full["area"] == "Drucker & Scanner"
    assert client.get("/api/kb/999999").status_code == 404


def test_import_endpoint_reads_the_shipped_library_and_is_admin_only(client, app):
    db = app.state.ctx.db
    r = client.post("/api/kb/library/import").json()
    assert r["created"] >= 580 and r["problems"] == []
    o = client.get("/api/kb/overview").json()
    assert o["library"] == r["created"] and o["public"] >= 200 and len(o["areas"]) >= 20
    assert client.post("/api/kb/library/import").json()["unchanged"] == r["created"]

    # Suche über die ganze Bibliothek: das naheliegende Thema steht oben
    for question, expected in (("drucker offline", "Offline"), ("kennwort vergessen", "Passwort"), ("vpn verbindet nicht", "VPN")):
        items = client.get("/api/kb/list", params={"q": question}).json()["items"]
        assert expected.lower() in items[0]["title"].lower(), (question, items[0]["title"])
    # Die Hilfe im Portal bekommt nur Anleitungen für Anwender
    hits = app.state.ctx.kb.search("konto gesperrt passwort", limit=5, public_only=True)
    assert hits and all(h["public"] for h in hits)

    client.post("/api/users", json={"name": "Chefin", "email": "chefin@me-it.test", "password": "Sehr-Geheim-2026", "role": "admin"})
    assert client.post("/api/auth/login", json={"email": "chefin@me-it.test", "password": "Sehr-Geheim-2026"}).status_code == 200
    client.post("/api/users", json={"name": "Tom", "email": "tom@me-it.test", "password": "Auch-Geheim-2026", "role": "technik"})
    assert client.post("/api/auth/login", json={"email": "tom@me-it.test", "password": "Auch-Geheim-2026"}).status_code == 200
    assert client.post("/api/kb/library/import").status_code == 403
    assert client.get("/api/kb/overview").status_code == 200  # lesen darf jeder Mitarbeiter


def test_article_area_can_be_set_by_hand(client):
    created = client.post("/api/kb", json={"title": "Türcode Serverraum", "content": "Der Code hängt im Tresor.", "tags": "intern", "area": "Interne Abläufe"}).json()
    assert client.get(f"/api/kb/{created['id']}").json()["area"] == "Interne Abläufe"
    client.put(f"/api/kb/{created['id']}", json={"title": "Türcode Serverraum", "content": "Der Code hängt im Tresor.", "tags": "intern", "public": False})
    assert client.get(f"/api/kb/{created['id']}").json()["area"] == "Interne Abläufe"  # ein Speichern ohne Bereich löscht ihn nicht


def test_search_understands_word_forms_and_synonyms():
    docs = ["Outlook sendet keine Nachrichten mehr", "Kennwort für das WLAN ändern", "Urlaubsplanung im Kalender"]
    assert related("sendet", "senden") and related("drucker", "druckertreiber") and not related("konto", "kontakt")
    assert keyword_scores("senden", docs)[0] > 0 and keyword_scores("senden", docs)[2] == 0
    scores = keyword_scores("passwort wifi", docs)
    assert scores[1] > 0 and scores[0] == 0  # „Passwort“ findet „Kennwort“, „wifi“ findet „WLAN“
    assert keyword_scores("", docs) == [0.0, 0.0, 0.0]


def test_ticket_gets_matching_guides_without_ai(client, app):
    client.post("/api/kb/library/import")
    ticket = client.post("/api/tickets", json={"title": "Drucker im Empfang zeigt offline", "customer_id": 1,
                                               "description": "Seit heute früh druckt niemand mehr, die Warteschlange ist voll."}).json()
    k = client.get(f"/api/tickets/{ticket['id']}/knowledge").json()
    assert 1 <= len(k["items"]) <= 4
    assert "drucker" in k["items"][0]["title"].lower() and "content" not in k["items"][0]
    # Kein Treffer ist besser als ein zufälliger: Allerweltswörter in der Beschreibung reichen nicht für eine Empfehlung
    quiet = client.post("/api/tickets", json={"title": "Frage zu KI für Arztbriefe", "customer_id": 1,
                                              "description": "Gibt es eine Möglichkeit, das ohne Cloud zu machen? Bitte um Rückruf."}).json()
    assert client.get(f"/api/tickets/{quiet['id']}/knowledge").json()["items"] == []
    assert client.get("/api/tickets/999999/knowledge").status_code == 404
