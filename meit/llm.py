"""KI-Provider-Schicht.

Standard ist **Ollama** – läuft komplett offline auf dem eigenen PC, Kundendaten
verlassen das Haus nicht (DSGVO). Optional:
  * ``openai``    – jeder OpenAI-kompatible Server (LM Studio, llama.cpp, vLLM, ...)
  * ``anthropic`` – Claude (Cloud) für komplexe, nicht sensible Aufgaben
  * ``none``      – keine KI, die App arbeitet mit Regeln/Stichwortsuche weiter

Alle Agenten sprechen nur mit der Klasse ``LLM`` und funktionieren daher mit
jedem Provider gleich.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


class LLMError(RuntimeError):
    pass


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def strip_think(text: str) -> str:
    """Entfernt <think>-Blöcke von Reasoning-Modellen (z. B. Qwen3, DeepSeek-R1)."""
    return _THINK_RE.sub("", text or "").strip()


def extract_json(text: str) -> Any:
    """Holt das erste gültige JSON-Objekt/-Array aus einer Modellantwort.

    Kleine lokale Modelle schreiben gern Text oder ```json-Zäune drumherum –
    deshalb suchen wir tolerant nach der ersten balancierten Klammerstruktur.
    """
    text = strip_think(text)
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidates = [fence.group(1)] if fence else []
    candidates.append(text)
    for candidate in candidates:
        candidate = candidate.strip()
        try:
            return json.loads(candidate)
        except ValueError:
            pass
        for opener, closer in (("{", "}"), ("[", "]")):
            start = candidate.find(opener)
            while start != -1:
                depth = 0
                in_str = False
                escape = False
                for i in range(start, len(candidate)):
                    ch = candidate[i]
                    if in_str:
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_str = False
                        continue
                    if ch == '"':
                        in_str = True
                    elif ch == opener:
                        depth += 1
                    elif ch == closer:
                        depth -= 1
                        if depth == 0:
                            try:
                                return json.loads(candidate[start : i + 1])
                            except ValueError:
                                break
                start = candidate.find(opener, start + 1)
    raise LLMError("Keine gültige JSON-Antwort vom Modell erhalten.")


@dataclass
class LLMStatus:
    provider: str
    model: str
    available: bool
    detail: str = ""
    local: bool = True


class LLM:
    """Basisklasse. ``chat`` liefert reinen Text, ``chat_json`` ein geparstes Objekt."""

    provider = "none"
    local = True

    def __init__(self, settings: Settings):
        self.settings = settings
        self._status_cache: tuple[float, LLMStatus] | None = None

    @property
    def model(self) -> str:
        return ""

    def status(self) -> LLMStatus:
        if self._status_cache and time.time() - self._status_cache[0] < 15:
            return self._status_cache[1]
        status = self._probe()
        self._status_cache = (time.time(), status)
        return status

    def available(self) -> bool:
        return self.status().available

    def _probe(self) -> LLMStatus:
        return LLMStatus(self.provider, self.model, False, "Keine KI konfiguriert", self.local)

    def chat(
        self,
        messages: list[dict[str, str]],
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
    ) -> str:
        raise LLMError("Keine KI verfügbar (LLM_PROVIDER=none).")

    def chat_json(
        self, messages: list[dict[str, str]], system: str | None = None, temperature: float = 0.1
    ) -> Any:
        raw = self.chat(messages, system=system, json_mode=True, temperature=temperature)
        try:
            return extract_json(raw)
        except LLMError:
            # Ein zweiter Versuch mit klarer Korrektur-Anweisung hilft kleinen Modellen.
            retry = messages + [
                {"role": "assistant", "content": raw[:2000]},
                {
                    "role": "user",
                    "content": "Antworte AUSSCHLIESSLICH mit gültigem JSON, ohne Text davor oder danach.",
                },
            ]
            return extract_json(self.chat(retry, system=system, json_mode=True, temperature=0))

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        return None


def _protect(messages: list[dict[str, Any]], system: str | None) -> tuple[list[dict[str, Any]], str | None]:
    """Vor dem Versand an eine Cloud-KI: Klartext-Zugangsdaten schwärzen (Passwort-Wächter)."""
    from .secrets_guard import redact

    safe = [{**m, "content": redact(m["content"]) if isinstance(m.get("content"), str) else m.get("content")}
            for m in messages]
    return safe, (redact(system) if system else system)


class NoLLM(LLM):
    provider = "none"


class OllamaLLM(LLM):
    provider = "ollama"
    local = True

    @property
    def model(self) -> str:
        return self.settings.ollama_model

    def _probe(self) -> LLMStatus:
        try:
            resp = httpx.get(f"{self.settings.ollama_url}/api/tags", timeout=3)
            resp.raise_for_status()
            names = [m.get("name", "") for m in resp.json().get("models", [])]
        except Exception as exc:  # noqa: BLE001 - jede Verbindungsart abfangen
            return LLMStatus(self.provider, self.model, False, f"Ollama nicht erreichbar: {exc}")
        base = self.model.split(":")[0]
        installed = any(n == self.model or n.split(":")[0] == base for n in names)
        if not installed:
            return LLMStatus(
                self.provider,
                self.model,
                False,
                f"Modell nicht installiert. Bitte ausführen: ollama pull {self.model}",
            )
        return LLMStatus(self.provider, self.model, True, f"{len(names)} Modelle installiert")

    def list_models(self) -> list[str]:
        try:
            resp = httpx.get(f"{self.settings.ollama_url}/api/tags", timeout=3)
            resp.raise_for_status()
            return sorted(m.get("name", "") for m in resp.json().get("models", []))
        except Exception:  # noqa: BLE001
            return []

    def chat(self, messages, system=None, json_mode=False, temperature=0.2) -> str:
        if not self.local:
            messages, system = _protect(messages, system)
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": msgs,
            "stream": False,
            "options": {"temperature": temperature, "num_ctx": 8192},
        }
        if json_mode:
            payload["format"] = "json"
        try:
            resp = httpx.post(
                f"{self.settings.ollama_url}/api/chat", json=payload, timeout=self.settings.llm_timeout
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMError(f"Ollama-Fehler: {exc}") from exc
        return strip_think(resp.json().get("message", {}).get("content", ""))

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        if not texts:
            return []
        try:
            resp = httpx.post(
                f"{self.settings.ollama_url}/api/embed",
                json={"model": self.settings.embed_model, "input": texts},
                timeout=self.settings.llm_timeout,
            )
            resp.raise_for_status()
            vectors = resp.json().get("embeddings")
            return vectors if vectors and len(vectors) == len(texts) else None
        except Exception:  # noqa: BLE001 - ohne Embeddings fällt die Suche auf Stichworte zurück
            return None


class OpenAICompatLLM(LLM):
    """LM Studio, llama.cpp-Server, vLLM, LocalAI, ... (alle sprechen /v1/chat/completions)."""

    provider = "openai"

    @property
    def local(self) -> bool:  # type: ignore[override]
        host = self.settings.openai_base_url
        return any(h in host for h in ("localhost", "127.0.0.1", "0.0.0.0", "192.168.", "10.", ".local"))

    @property
    def model(self) -> str:
        return self.settings.openai_model

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.settings.openai_api_key}"}

    def _probe(self) -> LLMStatus:
        try:
            resp = httpx.get(f"{self.settings.openai_base_url}/models", headers=self._headers(), timeout=3)
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            return LLMStatus(self.provider, self.model, False, f"Server nicht erreichbar: {exc}", self.local)
        return LLMStatus(self.provider, self.model, True, self.settings.openai_base_url, self.local)

    def chat(self, messages, system=None, json_mode=False, temperature=0.2) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        try:
            resp = httpx.post(
                f"{self.settings.openai_base_url}/chat/completions",
                headers=self._headers(),
                json={"model": self.model, "messages": msgs, "temperature": temperature},
                timeout=self.settings.llm_timeout,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMError(f"OpenAI-kompatibler Server: {exc}") from exc
        choices = resp.json().get("choices") or [{}]
        return strip_think(choices[0].get("message", {}).get("content", "") or "")

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        try:
            resp = httpx.post(
                f"{self.settings.openai_base_url}/embeddings",
                headers=self._headers(),
                json={"model": self.settings.embed_model, "input": texts},
                timeout=self.settings.llm_timeout,
            )
            resp.raise_for_status()
            data = sorted(resp.json().get("data", []), key=lambda d: d.get("index", 0))
            vectors = [d["embedding"] for d in data]
            return vectors if len(vectors) == len(texts) else None
        except Exception:  # noqa: BLE001
            return None


class AnthropicLLM(LLM):
    """Claude über das offizielle Anthropic-SDK (Cloud – nur für nicht sensible Daten)."""

    provider = "anthropic"
    local = False

    def __init__(self, settings: Settings):
        super().__init__(settings)
        self._client = None

    @property
    def model(self) -> str:
        return self.settings.anthropic_model

    def _get_client(self):
        if self._client is None:
            try:
                import anthropic
            except ImportError as exc:
                raise LLMError("Paket 'anthropic' fehlt: pip install anthropic") from exc
            # Liest ANTHROPIC_API_KEY (oder ein `ant auth login`-Profil) aus der Umgebung.
            self._client = anthropic.Anthropic()
        return self._client

    def _probe(self) -> LLMStatus:
        import os

        try:
            import anthropic  # noqa: F401
        except ImportError:
            return LLMStatus(self.provider, self.model, False, "pip install anthropic", False)
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            return LLMStatus(self.provider, self.model, False, "ANTHROPIC_API_KEY nicht gesetzt", False)
        return LLMStatus(self.provider, self.model, True, "Cloud (Anthropic)", False)

    def chat(self, messages, system=None, json_mode=False, temperature=0.2) -> str:
        import anthropic

        messages, system = _protect(messages, system)  # Cloud: Zugangsdaten nie übertragen
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "messages": messages,
            "output_config": {"effort": self.settings.anthropic_effort},
            # Bei einer Sicherheits-Ablehnung springt serverseitig ein passendes Modell ein.
            "betas": ["server-side-fallback-2026-07-01"],
            "fallbacks": "default",
        }
        if system:
            kwargs["system"] = system
        try:
            response = client.beta.messages.create(**kwargs)
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude: Rate-Limit erreicht, bitte später erneut versuchen.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API-Fehler ({exc.status_code}): {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Claude nicht erreichbar (Internetverbindung?).") from exc
        if response.stop_reason == "refusal":
            raise LLMError("Claude hat die Anfrage abgelehnt.")
        return "".join(block.text for block in response.content if block.type == "text").strip()


def _make(provider: str, settings: Settings) -> LLM:
    return {
        "ollama": OllamaLLM,
        "openai": OpenAICompatLLM,
        "anthropic": AnthropicLLM,
    }.get(provider, NoLLM)(settings)


class Router:
    """Wählt den Provider: primär lokal, Cloud nur wenn erlaubt und lokal nicht verfügbar."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.primary = _make(settings.llm_provider, settings)
        self.cloud = AnthropicLLM(settings) if settings.allow_cloud_fallback else None
        # Embeddings immer lokal (Ollama), außer der Primär-Provider kann es selbst.
        self.embedder: LLM = (
            self.primary if isinstance(self.primary, (OllamaLLM, OpenAICompatLLM)) else OllamaLLM(settings)
        )

    def get(self) -> LLM:
        if self.primary.available():
            return self.primary
        if self.cloud is not None and self.cloud is not self.primary and self.cloud.available():
            return self.cloud
        return self.primary

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        status = self.embedder.status()
        # Läuft der Server, fehlt aber nur das Chat-Modell, klappen Embeddings trotzdem.
        if not status.available and "nicht erreichbar" in status.detail:
            return None
        return self.embedder.embed(texts)

    def status(self) -> dict[str, Any]:
        primary = self.primary.status()
        active = self.get()
        return {
            "primary": primary.__dict__,
            "active_provider": active.provider if active.available() else "none",
            "active_model": active.model if active.available() else "",
            "active_local": active.local,
            "cloud_fallback_allowed": self.settings.allow_cloud_fallback,
            "embed_model": self.settings.embed_model,
            "installed_models": self.primary.list_models() if isinstance(self.primary, OllamaLLM) else [],
        }
