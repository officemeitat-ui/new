"""Prüft die HTTP-Formate der lokalen Provider ohne echten Server (httpx wird gemockt)."""

import dataclasses

import httpx
import pytest

from meit.config import get_settings
from meit.llm import LLMError, OllamaLLM, OpenAICompatLLM, Router


class Resp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("fehler", request=httpx.Request("POST", "http://x"), response=None)


@pytest.fixture()
def settings():
    return dataclasses.replace(get_settings(), llm_provider="ollama", ollama_url="http://ollama:11434",
                               ollama_model="qwen3:14b", embed_model="bge-m3")


def test_ollama_chat_payload_and_think_stripping(settings, monkeypatch):
    seen = {}

    def fake_post(url, json=None, timeout=None, **_):
        seen["url"], seen["json"] = url, json
        return Resp({"message": {"content": "<think>hmm</think>{\"final\": \"ok\"}"}})

    monkeypatch.setattr(httpx, "post", fake_post)
    llm = OllamaLLM(settings)
    out = llm.chat([{"role": "user", "content": "hi"}], system="sys", json_mode=True)
    assert out == '{"final": "ok"}'
    assert seen["url"] == "http://ollama:11434/api/chat"
    assert seen["json"]["format"] == "json"
    assert seen["json"]["messages"][0] == {"role": "system", "content": "sys"}
    assert seen["json"]["stream"] is False


def test_ollama_probe_detects_missing_model(settings, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None, **_: Resp({"models": [{"name": "bge-m3:latest"}]}))
    status = OllamaLLM(settings).status()
    assert not status.available and "ollama pull qwen3:14b" in status.detail
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None, **_: Resp({"models": [{"name": "qwen3:14b"}]}))
    assert OllamaLLM(settings).status().available


def test_ollama_embed(settings, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda url, json=None, timeout=None, **_: Resp({"embeddings": [[0.1, 0.2]] * len(json["input"])}))
    assert OllamaLLM(settings).embed(["a", "b"]) == [[0.1, 0.2], [0.1, 0.2]]


def test_ollama_error_becomes_llm_error(settings, monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("weg")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(LLMError):
        OllamaLLM(settings).chat([{"role": "user", "content": "x"}])


def test_openai_compatible(settings, monkeypatch):
    s = dataclasses.replace(settings, llm_provider="openai", openai_base_url="http://localhost:1234/v1",
                            openai_model="qwen")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None, **_):
        seen["url"], seen["json"] = url, json
        return Resp({"choices": [{"message": {"content": "Antwort"}}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    llm = OpenAICompatLLM(s)
    assert llm.local is True
    assert llm.chat([{"role": "user", "content": "x"}]) == "Antwort"
    assert seen["url"].endswith("/chat/completions") and seen["json"]["model"] == "qwen"


def test_router_never_uses_cloud_without_permission(settings, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("aus")))
    router = Router(settings)
    assert router.cloud is None
    assert router.get().provider == "ollama"  # bleibt lokal, auch wenn offline
    assert router.embed(["x"]) is None
