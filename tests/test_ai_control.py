"""Claude-Integration: Aufgaben-Routing, Effort, Verbrauch/Kosten, Budget, Pseudonymisierung, PDF-Belege.

Es wird ein simulierter Anthropic-Client verwendet – keine echten (kostenpflichtigen) API-Aufrufe.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from meit.ai_control import cost_usd


class FakeMessages:
    def __init__(self, store, kind, reply):
        self.store, self.kind, self.reply = store, kind, reply

    def create(self, **kw):
        self.store.append({"kind": self.kind, **kw})
        text = self.reply(kw) if callable(self.reply) else self.reply
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn",
                               model=kw["model"], usage=SimpleNamespace(input_tokens=1000, output_tokens=500,
                                                                        cache_read_input_tokens=2000,
                                                                        cache_creation_input_tokens=0))


class FakeClient:
    def __init__(self, reply="OK"):
        self.calls = []
        self.messages = FakeMessages(self.calls, "plain", reply)
        self.beta = SimpleNamespace(messages=FakeMessages(self.calls, "beta", reply))


class DownLLM:
    """Lokale KI ist aus (Ollama läuft nicht)."""
    provider, model, local = "ollama", "qwen3:14b", True

    def available(self):
        return False

    def status(self):
        return SimpleNamespace(available=False, detail="nicht erreichbar", __dict__={"available": False})


@pytest.fixture()
def claude(app, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    fake = FakeClient()
    router = app.state.ctx.router
    router.claude._client = fake
    router.claude._status_cache = None
    return fake


def _enable(client, **extra):
    r = client.put("/api/ai/settings", json={"cloud_enabled": True, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_cost_calculation():
    usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000, cache_read_input_tokens=1_000_000,
                            cache_creation_input_tokens=0)
    assert cost_usd("claude-opus-5-5", usage) == round(4 + 2 + 0.20, 6)
    assert cost_usd("claude-haiku-5-5", usage) == round(0.10 + 0.05 + 0.01, 6)
    assert cost_usd("claude-unbekannt-9", usage) == cost_usd("claude-opus-5-5", usage)


def test_routing_modes_and_usage(client, app, claude):
    router = app.state.ctx.router
    assert router.get("quote").provider != "anthropic"  # Cloud ist aus
    _enable(client, tasks={"quote": "claude", "portal": "lokal"}, effort={"quote": "high"})
    llm = router.get("quote")
    assert llm.provider == "anthropic" and llm.model == "claude-opus-5-5"
    assert llm.chat([{"role": "user", "content": "Angebot bitte"}], system="Du bist Vertrieb.") == "OK"
    sent = claude.calls[-1]
    assert sent["kind"] == "beta" and sent["fallbacks"] == "default" and sent["output_config"]["effort"] == "high"
    assert sent["cache_control"] == {"type": "ephemeral"} and "temperature" not in sent
    # „auto“: lokale KI bevorzugt, Claude nur wenn lokal aus
    assert router.get("triage") is router.primary or router.get("triage").provider == "anthropic"
    router.primary = DownLLM()
    assert router.get("triage").provider == "anthropic"
    assert router.get("portal").provider == "ollama"  # „lokal“: nie Cloud, auch wenn lokal aus
    usage = client.get("/api/ai/settings").json()["usage"]
    assert usage["calls"] == 1 and usage["by_task"][0]["task"] == "quote"
    assert usage["cost_usd"] == cost_usd("claude-opus-5-5", SimpleNamespace(
        input_tokens=1000, output_tokens=500, cache_read_input_tokens=2000, cache_creation_input_tokens=0))


def test_budget_stops_cloud(client, app, claude):
    _enable(client, tasks={"quote": "claude"}, budget_usd=0.001)
    router = app.state.ctx.router
    router.get("quote").chat([{"role": "user", "content": "x"}])
    assert router.claude_ok() is False
    assert router.get("quote").provider != "anthropic"
    s = client.get("/api/ai/settings").json()["usage"]
    assert s["budget_ok"] is False and s["budget_pct"] > 100


def test_pii_pseudonymized_and_restored(client, app, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    fake = FakeClient(reply=lambda kw: "Bitte an [E-MAIL-1] antworten, Rückruf unter [TELEFON-1].")
    router = app.state.ctx.router
    router.claude._client, router.claude._status_cache = fake, None
    _enable(client, tasks={"inbox": "claude"}, mask_pii=True)
    out = router.get("inbox").chat([{"role": "user", "content":
                                     "Mail von franz@huber-demo.at, Tel. +43 664 1234567, IBAN AT61 1904 3002 3457 3201, Passwort: Geheim#2026"}])
    sent = json.dumps(fake.calls[-1]["messages"], ensure_ascii=False)
    assert "franz@huber-demo.at" not in sent and "1234567" not in sent and "AT61" not in sent and "Geheim#2026" not in sent
    assert "[E-MAIL-1]" in sent and "[IBAN-1]" in sent
    assert out == "Bitte an franz@huber-demo.at antworten, Rückruf unter +43 664 1234567."


def test_haiku_without_server_fallback(client, app, claude):
    _enable(client, model="claude-haiku-5-5", tasks={"triage": "claude"})
    app.state.ctx.router.get("triage").chat([{"role": "user", "content": "x"}])
    sent = claude.calls[-1]
    assert sent["kind"] == "plain" and "fallbacks" not in sent and sent["model"] == "claude-haiku-5-5"


def test_settings_validation(client):
    assert client.put("/api/ai/settings", json={"model": "gpt-5"}).status_code == 422
    assert client.put("/api/ai/settings", json={"tasks": {"quote": "immer"}}).status_code == 422
    assert client.put("/api/ai/settings", json={"effort": {"unbekannt": "low"}}).status_code == 422
    s = client.get("/api/ai/settings").json()
    assert s["model"] == "claude-opus-5-5" and s["tasks"]["receipts"] == "lokal" and "quote" in s["task_labels"]


def test_receipt_pdf_read_by_claude(client, app, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    fake = FakeClient(reply=json.dumps({"lieferant": "A1 Telekom Austria AG", "rechnungsnummer": "R-2026-4711",
                                        "datum": "2026-11-03", "betrag_brutto": 59.9, "ust_betrag": 9.98,
                                        "waehrung": "EUR", "kategorie": "Telekom", "iban": ""}))
    router = app.state.ctx.router
    router.claude._client, router.claude._status_cache = fake, None
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=12)
    pdf.cell(0, 10, "Scan")
    data = bytes(pdf.output())
    r = client.post("/api/receipts/upload", content=data, headers={"X-Filename": "scan.pdf"}).json()
    rid = r["receipt"]["id"]
    assert client.post(f"/api/receipts/{rid}/claude").status_code == 409  # Cloud noch aus
    _enable(client, tasks={"receipts": "claude"})
    got = client.post(f"/api/receipts/{rid}/claude").json()
    assert got["vendor"] == "A1 Telekom Austria AG" and got["amount"] == 59.9 and got["invoice_date"] == "2026-11-03"
    sent = fake.calls[-1]
    block = sent["messages"][0]["content"][0]
    assert block["type"] == "document" and block["source"]["media_type"] == "application/pdf"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    # beim Upload direkt mit Claude gelesen
    r2 = client.post("/api/receipts/upload", content=data, headers={"X-Filename": "scan2.pdf"}).json()
    assert r2["receipt"]["vendor"] == "A1 Telekom Austria AG" and "Claude" in r2["receipt"]["note"]
