"""Sprachnotizen (Spracherkennung gemockt)."""

import os

import meit.speech as speech


def test_voice_note_to_inbox(client, monkeypatch):
    seen = {}

    def fake_transcribe(path, language="de"):
        seen["exists"] = os.path.exists(path)
        seen["path"] = path
        return "Hallo hier ist Franz Huber, der Drucker in der Werkstatt druckt schon wieder nicht, bitte um Rückruf."

    monkeypatch.setattr(speech, "transcribe", fake_transcribe)
    r = client.post("/api/voice?from_name=Franz%20Huber&phone=0664%20123456&from_email=franz.huber@huber-demo.at",
                    content=b"\x1aE\xdf\xa3fake-webm", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert seen["exists"] and seen["path"].endswith(".webm") and not os.path.exists(seen["path"])  # Audio gelöscht
    assert m["channel"] == "telefon" and m["subject"].startswith("Telefonnotiz: Hallo hier ist Franz Huber")
    assert "Anrufer: Franz Huber, 0664 123456" in m["body"] and m["customer_id"] == 1
    assert m["category"] in ("support", "termin") and m["linked_type"] in ("ticket",)


def test_voice_errors(client, monkeypatch):
    assert client.post("/api/voice", content=b"", headers={"Content-Type": "audio/webm"}).status_code == 422

    def unavailable(path, language="de"):
        raise speech.SpeechUnavailable("Spracherkennung nicht installiert")

    monkeypatch.setattr(speech, "transcribe", unavailable)
    r = client.post("/api/voice", content=b"abc", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 501 and "nicht installiert" in r.json()["detail"]
    monkeypatch.setattr(speech, "transcribe", lambda path, language="de": "")
    assert client.post("/api/voice", content=b"abc", headers={"Content-Type": "audio/ogg"}).status_code == 422
    assert client.get("/api/voice/status").json()["available"] in (True, False)
