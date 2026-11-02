from __future__ import annotations

import dataclasses
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from meit.config import get_settings
from meit.llm import LLM, LLMStatus
from meit.main import create_app


class FakeLLM(LLM):
    """Simulierte KI: liefert vorab festgelegte Antworten der Reihe nach."""

    provider = "fake"

    def __init__(self, settings, replies: list[Any] | None = None):
        super().__init__(settings)
        self.replies = list(replies or [])
        self.calls: list[dict[str, Any]] = []

    @property
    def model(self) -> str:
        return "fake-model"

    def _probe(self) -> LLMStatus:
        return LLMStatus(self.provider, self.model, True, "test")

    def chat(self, messages, system=None, json_mode=False, temperature=0.2) -> str:
        self.calls.append({"messages": list(messages), "system": system, "json": json_mode})
        reply = self.replies.pop(0) if self.replies else "Standardantwort der Test-KI."
        return reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)


@pytest.fixture()
def settings(tmp_path):
    return dataclasses.replace(
        get_settings(), db_path=str(tmp_path / "test.db"), llm_provider="none",
        allow_cloud_fallback=False, seed_demo_data=True, app_password="",
    )


@pytest.fixture()
def app(settings):
    return create_app(settings)


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def use_fake_llm(app):
    """Ersetzt den KI-Provider durch FakeLLM mit den übergebenen Antworten."""

    def _install(replies: list[Any]) -> FakeLLM:
        fake = FakeLLM(app.state.settings, replies)
        app.state.ctx.router.primary = fake
        return fake

    return _install
