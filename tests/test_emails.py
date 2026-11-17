"""E-Mails ins Cockpit und Kundenportal: .eml/.msg-Upload, Anhänge, Ticket-Verlauf, Antworten, Phishing-Check."""

from __future__ import annotations

import struct
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient

from meit.emails import analyze_phishing, load_email
from meit.mail import parse_raw

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class FakeMailer:
    imap_configured = smtp_configured = True

    def __init__(self, inbox=None):
        self.sent, self.inbox = [], inbox or []

    def send(self, to, subject, body, in_reply_to="", reply_handle="", attachments=None, html="", cc=""):
        self.sent.append({"to": to, "subject": subject, "body": body, "in_reply_to": in_reply_to})
        return f"<sent-{len(self.sent)}@me-it.test>"

    def fetch_unseen(self, limit=25):
        mails, self.inbox = self.inbox, []
        return mails


def make_eml(subject="Bildschirm flackert", sender="Franz Huber <franz.huber@huber-demo.at>", body="Hallo, der Bildschirm "
             "im Büro flackert seit heute früh. Foto anbei.", attachments=(("foto.png", PNG),), headers=None, html=None,
             msgid="<kunde-1@huber-demo.at>") -> bytes:
    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Message-ID"] = sender, "office@me-it.test", subject, msgid
    for k, v in (headers or {}).items():
        m[k] = v
    m.set_content(body)
    if html:
        m.add_alternative(html, subtype="html")
    for name, data in attachments:
        maintype, subtype = ("image", "png") if name.endswith(".png") else ("application", "octet-stream")
        m.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return m.as_bytes()


# ----------------------------------------------------------------------------- Outlook-.msg (Compound File)
def _cfb(streams: dict[str, bytes]) -> bytes:
    """Minimaler Compound-File-Schreiber (Version 3) – erzeugt eine echte .msg-Struktur für den Test."""
    SEC, MINI, END, FREE, FATSECT = 512, 64, 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD
    tree: dict[str, dict] = {"": {"kids": {}, "type": 5}}
    for path, data in streams.items():
        parts, node = path.split("/"), tree[""]
        for storage in parts[:-1]:
            node = node["kids"].setdefault(storage, {"kids": {}, "type": 1})
        node["kids"][parts[-1]] = {"type": 2, "data": data}
    entries: list[dict] = []

    def add(name: str, node: dict) -> int:
        idx = len(entries)
        entries.append({"name": name, **node, "child": FREE, "right": FREE})
        kids = sorted(node.get("kids", {}).items(), key=lambda kv: (len(kv[0]), kv[0].upper()))
        prev = None
        for kname, knode in kids:
            kid = add(kname, knode)
            if prev is None:
                entries[idx]["child"] = kid
            else:
                entries[prev]["right"] = kid
            prev = kid
        return idx

    add("Root Entry", tree[""])
    mini, minifat = bytearray(), []
    for e in entries:
        if e["type"] == 2:
            n = (len(e["data"]) + MINI - 1) // MINI
            e["start"], e["size"] = (len(mini) // MINI if n else END), len(e["data"])
            minifat += [len(mini) // MINI + i + 1 for i in range(n - 1)] + ([END] if n else [])
            mini += e["data"] + b"\x00" * (n * MINI - len(e["data"]))
    pad = lambda b: bytes(b) + b"\x00" * ((-len(b)) % SEC)  # noqa: E731
    dir_bytes = bytearray()
    for e in entries:
        name = e["name"].encode("utf-16-le") + b"\x00\x00"
        dir_bytes += (name.ljust(64, b"\x00") + struct.pack("<HBBIII", len(name), e["type"], 1, FREE, e["right"], e["child"])
                      + b"\x00" * 36 + struct.pack("<IQ", e.get("start", END) if e["type"] == 2 else 0, e.get("size", 0)))
    blobs = [pad(dir_bytes), pad(struct.pack(f"<{len(minifat)}I", *minifat) + b"\xff" * ((-len(minifat) * 4) % SEC)), pad(mini)]
    counts = [len(b) // SEC for b in blobs]
    first, pos = [], 1  # Sektor 0 = FAT
    for c in counts:
        first.append(pos)
        pos += c
    fat = [FATSECT]
    for start, c in zip(first, counts):
        fat += [start + i + 1 for i in range(c - 1)] + [END]
    fat += [FREE] * (SEC // 4 - len(fat))
    entries_root = bytearray(blobs[0])
    struct.pack_into("<IQ", entries_root, 116, first[2], len(mini))  # Root Entry → Mini-Stream
    header = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 16 + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\x00" * 6
              + struct.pack("<IIIIIIIII", 0, 1, first[0], 0, 4096, first[1], counts[1], END, 0)
              + struct.pack("<109I", 0, *([FREE] * 108)))
    return header + struct.pack(f"<{len(fat)}I", *fat) + bytes(entries_root) + blobs[1] + blobs[2]


def make_msg() -> bytes:
    u = lambda s: s.encode("utf-16-le")  # noqa: E731
    return _cfb({
        "__substg1.0_0037001F": u("Server langsam seit Update"),
        "__substg1.0_0C1A001F": u("Franz Huber"),
        "__substg1.0_5D01001F": u("franz.huber@huber-demo.at"),
        "__substg1.0_1000001F": u("Seit dem Update gestern ist der Server sehr langsam. Bitte um Hilfe."),
        "__substg1.0_007D001F": u("Message-ID: <outlook-77@huber-demo.at>\r\nDate: Tue, 17 Nov 2026 08:00:00 +0100\r\n"),
        "__attach_version1.0_#00000000/__substg1.0_3707001F": u("fehler.png"),
        "__attach_version1.0_#00000000/__substg1.0_370E001F": u("image/png"),
        "__attach_version1.0_#00000000/__substg1.0_37010102": PNG,
    })


# ----------------------------------------------------------------------------- Tests
def test_msg_and_eml_are_read():
    m = load_email(make_msg(), "Mail.msg")
    assert m["subject"] == "Server langsam seit Update" and m["from_email"] == "franz.huber@huber-demo.at"
    assert m["message_id"] == "<outlook-77@huber-demo.at>" and "sehr langsam" in m["text"]
    assert m["attachments"] == [("fehler.png", "image/png", PNG)]
    e = load_email(make_eml(), "mail.eml")
    assert e["from_name"] == "Franz Huber" and e["attachments"][0][0] == "foto.png"
    with pytest.raises(ValueError):
        load_email(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1kaputt", "x.msg")


def test_upload_creates_ticket_with_attachments(client):
    raw = make_eml(attachments=(("foto.png", PNG), ("rechnung.pdf.exe", b"MZ" + b"\x00" * 50)))
    r = client.post("/api/inbox/upload", content=raw, headers={"X-Filename": "Bildschirm.eml"})
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["linked_type"] == "ticket" and res["phishing"]["verdict"] == "verdächtig"  # .pdf.exe-Anhang
    tid = res["linked_id"]
    conv = client.get(f"/api/tickets/{tid}/conversation").json()
    names = {a["filename"]: a for a in conv["attachments"]}
    assert "foto.png" in names and "rechnung.pdf.exe" not in names  # ausführbare Anhänge werden nicht gespeichert
    assert names["Bildschirm.eml"]["customer_visible"] == 0  # Original-Mail nur intern
    assert conv["messages"][0]["direction"] == "in" and "flackert" in conv["messages"][0]["body"]
    img = client.get(f"/api/attachments/{names['foto.png']['id']}/download")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content == PNG
    # dieselbe Mail erneut hochgeladen → kein Duplikat
    again = client.post("/api/inbox/upload", content=raw, headers={"X-Filename": "Bildschirm.eml"}).json()
    assert again["duplicate"] is True and again["linked_id"] == tid
    # Outlook-.msg direkt in ein Ticket ziehen
    r = client.post(f"/api/tickets/{tid}/attachments", content=make_msg(), headers={"X-Filename": "Nachtrag.msg"}).json()
    assert r["linked_type"] == "ticket" and r["linked_id"] == tid
    conv = client.get(f"/api/tickets/{tid}/conversation").json()
    assert len(conv["messages"]) == 2 and any(a["filename"] == "fehler.png" for a in conv["attachments"])
    # normale Datei, gesperrte Datei, leere Datei
    assert client.post(f"/api/tickets/{tid}/attachments", content=b"Protokoll", headers={"X-Filename": "log.txt"}).status_code == 201
    assert client.post(f"/api/tickets/{tid}/attachments", content=b"x", headers={"X-Filename": "setup.exe"}).status_code == 422
    assert client.post("/api/inbox/upload", content=b"", headers={"X-Filename": "leer.eml"}).status_code == 422


def test_reply_threading_and_reopen(app, client):
    fake = FakeMailer()
    app.state.ctx.mailer = fake
    tid = client.post("/api/inbox/upload", content=make_eml(), headers={"X-Filename": "a.eml"}).json()["linked_id"]
    r = client.post(f"/api/tickets/{tid}/reply", json={"text": "Wir sehen uns das heute an.", "wait": True}).json()
    assert r["ticket_status"] == "wartet"
    sent = fake.sent[-1]
    assert sent["to"] == "franz.huber@huber-demo.at" and f"[#{tid}]" in sent["subject"]
    assert sent["in_reply_to"] == "<kunde-1@huber-demo.at>"
    assert client.get(f"/api/tickets/{tid}").json()["first_response_at"]
    # Antwort des Kunden (In-Reply-To unserer Mail) → selbes Ticket, Ticket wieder in Arbeit
    reply = make_eml(subject="AW: Bildschirm flackert", body="Danke, er flackert immer noch.", attachments=(),
                     headers={"In-Reply-To": "<sent-1@me-it.test>"}, msgid="<kunde-2@huber-demo.at>")
    fake.inbox = [parse_raw(reply)]
    res = client.post("/api/inbox/fetch").json()
    assert res["threaded"] == 1 and res["new"] == 1
    assert client.get(f"/api/tickets/{tid}").json()["status"] == "in_arbeit"
    tickets_before = client.get("/api/tickets").json()
    # Ticketnummer im Betreff (z. B. aus einer neuen Mail) → ebenfalls zugeordnet; fremde Domain nicht
    tagged = make_eml(subject=f"Nochmal wegen [#{tid}]", attachments=(("screen.png", PNG),), msgid="<kunde-3@huber-demo.at>")
    assert client.post("/api/inbox/upload", content=tagged, headers={"X-Filename": "b.eml"}).json()["linked_id"] == tid
    foreign = make_eml(subject=f"Frage [#{tid}]", sender="Fremd <x@fremd-demo.at>", msgid="<f-1@fremd-demo.at>")
    assert client.post("/api/inbox/upload", content=foreign, headers={"X-Filename": "c.eml"}).json()["linked_id"] != tid
    conv = client.get(f"/api/tickets/{tid}/conversation").json()
    assert [m["direction"] for m in conv["messages"]] == ["in", "out", "in", "in"]
    assert any(a["filename"] == "screen.png" for a in conv["attachments"])
    assert len(client.get("/api/tickets").json()) <= len(tickets_before) + 1


def test_reply_without_mailer_and_internal_note(app, client):
    app.state.ctx.mailer = None
    tid = client.post("/api/inbox/upload", content=make_eml(), headers={"X-Filename": "a.eml"}).json()["linked_id"]
    assert client.post(f"/api/tickets/{tid}/reply", json={"text": "Hallo"}).status_code == 409
    assert client.post(f"/api/tickets/{tid}/reply", json={"text": "Notiz: Monitor tauschen", "internal": True}).status_code == 200
    r = client.post(f"/api/tickets/{tid}/reply", json={"text": "Wir tauschen den Monitor.", "via": "portal", "resolve": True})
    assert r.json()["ticket_status"] == "geloest"
    conv = client.get(f"/api/tickets/{tid}/conversation").json()
    assert [m["internal"] for m in conv["messages"]] == [False, True, False]


def _portal(app, client, customer_id=1, email="franz@huber-demo.at"):
    pu = client.post(f"/api/customers/{customer_id}/portal-users", json={"name": "Franz", "email": email}).json()
    c = TestClient(app)
    assert c.post("/api/portal/login", json={"email": pu["email"], "password": pu["password"]}).status_code == 200
    return c


def test_portal_conversation_comment_upload(app, client):
    app.state.ctx.mailer = None
    tid = client.post("/api/inbox/upload", content=make_eml(), headers={"X-Filename": "a.eml"}).json()["linked_id"]
    client.post(f"/api/tickets/{tid}/reply", json={"text": "Intern: Kunde zahlt Monitor selbst", "internal": True})
    client.post(f"/api/tickets/{tid}/reply", json={"text": "Neuer Monitor ist bestellt.", "via": "portal", "resolve": True})
    portal = _portal(app, client)
    listed = {t["id"]: t for t in portal.get("/api/portal/tickets").json()}
    assert listed[tid]["replies"] == 1 and listed[tid]["files"] == 1
    conv = portal.get(f"/api/portal/tickets/{tid}/conversation").json()
    texts = [m["text"] for m in conv["messages"]]
    assert "Neuer Monitor ist bestellt." in texts and not any("Intern" in t for t in texts)
    assert [f["name"] for f in conv["files"]] == ["foto.png"]  # Original-Mail bleibt intern
    assert portal.get(f"/api/portal/attachments/{conv['files'][0]['id']}").content == PNG
    hidden = [a for a in client.get(f"/api/tickets/{tid}/conversation").json()["attachments"] if not a["customer_visible"]][0]
    assert portal.get(f"/api/portal/attachments/{hidden['id']}").status_code == 404
    # Kommentar öffnet das gelöste Ticket wieder
    r = portal.post(f"/api/portal/tickets/{tid}/comment", json={"text": "Der neue Monitor flackert auch."})
    assert r.status_code == 201 and client.get(f"/api/tickets/{tid}").json()["status"] == "in_arbeit"
    up = portal.post(f"/api/portal/tickets/{tid}/attachments", content=PNG, headers={"X-Filename": "neu.png"})
    assert up.status_code == 201
    assert portal.post(f"/api/portal/tickets/{tid}/attachments", content=b"MZ", headers={"X-Filename": "tool.exe"}).status_code == 422
    team = client.get(f"/api/tickets/{tid}/conversation").json()
    assert team["messages"][-1]["channel"] == "portal" and any(a["filename"] == "neu.png" for a in team["attachments"])
    # fremde Kunden sehen nichts
    other = _portal(app, client, customer_id=2, email="it@anderer-demo.at")
    assert other.get(f"/api/portal/tickets/{tid}/conversation").status_code == 404
    assert other.post(f"/api/portal/tickets/{tid}/comment", json={"text": "x"}).status_code == 404
    assert other.get(f"/api/portal/attachments/{conv['files'][0]['id']}").status_code == 404


PHISH_HTML = ('<p>Ihr Microsoft 365 Konto wird gesperrt! Bestätigen Sie innerhalb von 24 Stunden Ihr Passwort.</p>'
              '<a href="http://bit.ly/3xYz">https://login.microsoftonline.com</a> '
              '<a href="http://185.22.33.44/office/login.php">Jetzt anmelden</a>')


def phishing_mail() -> bytes:
    return make_eml(subject="Letzte Warnung: Ihr Postfach wird gesperrt", sender="Microsoft 365 <security@micros0ft-support.xyz>",
                    body="Ihr Konto wird gesperrt. Bitte Passwort bestätigen.", html=PHISH_HTML,
                    attachments=(("Rechnung.html", b"<html><form>Passwort</form></html>"),),
                    headers={"Reply-To": "billing@anderer-host.top",
                             "Authentication-Results": "mx.me-it.test; spf=fail smtp.mailfrom=micros0ft-support.xyz; "
                                                       "dkim=fail; dmarc=fail"},
                    msgid="<phish-1@micros0ft-support.xyz>")


def test_phishing_analysis():
    bad = analyze_phishing(load_email(phishing_mail(), "x.eml"))
    assert bad["verdict"] == "gefährlich" and bad["score"] >= 60
    text = " ".join(bad["reasons"]).lower()
    assert "spf" in text and "microsoft" in text
    issues = {link["domain"]: link["issue"] for link in bad["links"]}
    assert "bit.ly" in issues and "185.22.33.44" in issues
    good = analyze_phishing(load_email(make_eml(), "y.eml"))
    assert good["verdict"] == "unauffällig" and good["score"] < 30


def test_phishing_endpoints(app, client):
    r = client.post("/api/phishing/check", content=phishing_mail(), headers={"X-Filename": "verdacht.eml"}).json()
    assert r["verdict"] == "gefährlich" and "gefährlich" in r["markdown"].lower()
    # eine gefährliche Mail im Posteingang erzeugt KEIN Ticket/keinen Lead automatisch
    up = client.post("/api/inbox/upload", content=phishing_mail(), headers={"X-Filename": "verdacht.eml"}).json()
    assert up["phishing"]["verdict"] == "gefährlich" and not up["linked_type"]
    # Kunde meldet im Portal → Ticket mit höchster Priorität + Original-Mail
    portal = _portal(app, client)
    res = portal.post("/api/portal/phishing", content=phishing_mail(), headers={"X-Filename": "verdacht.eml"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["verdict"] == "gefährlich" and body["advice"]
    t = client.get(f"/api/tickets/{body['ticket_id']}").json()
    assert t["priority"] == "kritisch" and t["title"].startswith("Phishing-Verdacht") and t["customer_id"] == 1
    files = client.get(f"/api/tickets/{body['ticket_id']}/conversation").json()["attachments"]
    assert files and files[0]["filename"] == "verdacht.eml"
    assert portal.post("/api/portal/phishing", content=b"kein mail", headers={"X-Filename": "x.msg"}).status_code == 422


def test_phishing_ai_second_opinion(client, use_fake_llm):
    r = client.post("/api/phishing/check?ai=true", content=phishing_mail(), headers={"X-Filename": "v.eml"}).json()
    assert r["verdict"] == "gefährlich" and "error" in r["ai"]  # keine KI konfiguriert → Regeln reichen
    fake = use_fake_llm([{"einschaetzung": "phishing", "sicherheit": 97, "begruendung": ["Domain imitiert Microsoft"],
                          "empfehlung": "Löschen und Passwort nicht eingeben."}])
    r = client.post("/api/phishing/check?ai=true", content=phishing_mail(), headers={"X-Filename": "v.eml"}).json()
    assert r["ai"]["verdict"] == "Phishing" and r["ai"]["confidence"] == 97 and r["ai"]["reasons"] == ["Domain imitiert Microsoft"]
    prompt = fake.calls[-1]["messages"][0]["content"]
    assert "Absender-Domain: micros0ft-support.xyz" in prompt and "Regelprüfung: gefährlich" in prompt and "bit.ly" in prompt
    # ohne ?ai bleibt es bei der schnellen, lokalen Regelprüfung
    calls = len(fake.calls)
    assert "ai" not in client.post("/api/phishing/check", content=phishing_mail(), headers={"X-Filename": "v.eml"}).json()
    assert len(fake.calls) == calls
