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

import base64
import copy
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

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


PII_PATTERNS = [
    ("E-MAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b")),
    ("TELEFON", re.compile(r"(?<![\w/.#-])(?:\+\d{2}[ /-]?|0)\d{1,4}(?:[ /-]?\d{2,})+(?![\w-])")),
]


def pseudonymize(text: str, mapping: dict[str, str]) -> str:
    """E-Mail, IBAN, Telefon → Platzhalter ([E-MAIL-1] …); gleiche Werte bekommen denselben Platzhalter."""
    reverse = {v: k for k, v in mapping.items()}
    for label, rx in PII_PATTERNS:
        def repl(m: re.Match) -> str:
            value = m.group(0)
            if label == "TELEFON" and sum(ch.isdigit() for ch in value) < 7:
                return value  # z. B. Ticket-/Postleitzahlen
            if value not in reverse:
                key = f"[{label}-{sum(1 for k in mapping if k.startswith(f'[{label}-')) + 1}]"
                mapping[key], reverse[value] = value, key
            return reverse[value]
        text = rx.sub(repl, text)
    return text


def restore(text: str, mapping: dict[str, str]) -> str:
    for key, value in mapping.items():
        text = text.replace(key, value)
    return text


def _protect(messages: list[dict[str, Any]], system: str | None,
             mapping: dict[str, str] | None = None) -> tuple[list[dict[str, Any]], str | None]:
    """Vor dem Versand an eine Cloud-KI: Zugangsdaten schwärzen (Passwort-Wächter) und – wenn ``mapping``
    übergeben wird – personenbezogene Kontaktdaten pseudonymisieren (Rückübersetzung mit ``restore``)."""
    from .secrets_guard import redact

    def clean(text: str) -> str:
        text = redact(text)
        return pseudonymize(text, mapping) if mapping is not None else text

    safe = [{**m, "content": clean(m["content"]) if isinstance(m.get("content"), str) else m.get("content")}
            for m in messages]
    return safe, (clean(system) if system else system)


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
        self.task = ""
        self.effort: str | None = None          # je Aufgabe (low … max); sonst ANTHROPIC_EFFORT
        self.model_override: str | None = None  # je Einstellung; sonst ANTHROPIC_MODEL (Standard claude-opus-5-5)
        self.mask_pii = False
        self.usage_hook: Callable[[str, str, Any], None] | None = None

    @property
    def model(self) -> str:
        return self.model_override or self.settings.anthropic_model

    def for_task(self, task: str, *, effort: str | None = None, model: str | None = None, mask_pii: bool = False,
                 usage_hook: Callable[[str, str, Any], None] | None = None) -> "AnthropicLLM":
        """Kopie mit aufgabenspezifischer Konfiguration (teilt Client und Status-Cache)."""
        clone = copy.copy(self)
        clone.task, clone.effort, clone.model_override = task, effort, model
        clone.mask_pii, clone.usage_hook = mask_pii, usage_hook
        return clone

    def _create(self, client: Any, kwargs: dict[str, Any]) -> Any:
        """Opus/Sonnet/Fable: serverseitiger Fallback bei Ablehnung; Haiku hat keinen – normaler Aufruf."""
        if self.model.startswith("claude-haiku"):
            return client.messages.create(**kwargs)
        return client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)

    def _report(self, response: Any) -> None:
        if self.usage_hook and getattr(response, "usage", None) is not None:
            try:
                self.usage_hook(self.task or "allgemein", getattr(response, "model", "") or self.model, response.usage)
            except Exception:  # noqa: BLE001 - Verbrauchsprotokoll darf nie die Antwort verhindern
                pass

    def extract_document(self, data: bytes, media_type: str, instruction: str, schema: dict[str, Any]) -> dict[str, Any]:
        """PDF/Bild direkt an Claude (Dokument- bzw. Bild-Block) mit strukturierter JSON-Ausgabe."""
        import anthropic

        b64 = base64.standard_b64encode(data).decode("ascii")
        block = ({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
                 if media_type == "application/pdf" else
                 {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}})
        kwargs: dict[str, Any] = {
            "model": self.model, "max_tokens": 16000,
            "messages": [{"role": "user", "content": [block, {"type": "text", "text": instruction}]}],
            "output_config": {"effort": self.effort or "low",
                              "format": {"type": "json_schema", "schema": schema}},
        }
        try:
            response = self._create(self._get_client(), kwargs)
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude: Rate-Limit erreicht, bitte später erneut versuchen.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API-Fehler ({exc.status_code}): {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Claude nicht erreichbar (Internetverbindung?).") from exc
        self._report(response)
        if response.stop_reason == "refusal":
            raise LLMError("Claude hat die Anfrage abgelehnt.")
        if response.stop_reason == "max_tokens":
            raise LLMError("Claude-Antwort unvollständig (max_tokens).")
        text = next((b.text for b in response.content if b.type == "text"), "")
        return json.loads(text)

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
        from pathlib import Path

        if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
            return LLMStatus(self.provider, self.model, True, "Cloud (Anthropic, API-Schlüssel)", False)
        if os.environ.get("ANTHROPIC_PROFILE") or (Path.home() / ".config" / "anthropic").is_dir():
            return LLMStatus(self.provider, self.model, True, "Cloud (Anthropic, Anmeldung über ant auth login)", False)
        return LLMStatus(self.provider, self.model, False, "ANTHROPIC_API_KEY nicht gesetzt (oder „ant auth login“)", False)

    def chat(self, messages, system=None, json_mode=False, temperature=0.2) -> str:
        import anthropic

        mapping: dict[str, str] | None = {} if self.mask_pii else None
        messages, system = _protect(messages, system, mapping)  # Cloud: Zugangsdaten nie, Kontaktdaten optional nicht
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "messages": messages,
            "output_config": {"effort": self.effort or self.settings.anthropic_effort},
            "cache_control": {"type": "ephemeral"},  # gleichbleibende Agenten-Prompts günstiger (Prompt-Caching)
        }
        if system:
            kwargs["system"] = system
        try:
            # Bei einer Sicherheits-Ablehnung springt serverseitig ein passendes Modell ein (außer Haiku).
            response = self._create(client, kwargs)
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude: Rate-Limit erreicht, bitte später erneut versuchen.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API-Fehler ({exc.status_code}): {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Claude nicht erreichbar (Internetverbindung?).") from exc
        self._report(response)
        if response.stop_reason == "refusal":
            raise LLMError("Claude hat die Anfrage abgelehnt.")
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        return restore(text, mapping) if mapping else text


def _make(provider: str, settings: Settings) -> LLM:
    return {
        "ollama": OllamaLLM,
        "openai": OpenAICompatLLM,
        "anthropic": AnthropicLLM,
    }.get(provider, NoLLM)(settings)


class Router:
    """Wählt die KI je Aufgabe: lokal (Ollama/LM Studio) oder Claude (Cloud).

    Modi je Aufgabe (Einstellungen → KI): „lokal“ (nie Cloud), „auto“ (lokal, Claude nur wenn lokal nicht läuft),
    „claude“ (Claude bevorzugt). Cloud nur, wenn freigegeben und das Monatsbudget nicht erreicht ist.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.primary = _make(settings.llm_provider, settings)
        self.claude = self.primary if isinstance(self.primary, AnthropicLLM) else AnthropicLLM(settings)
        self.control: Any = None  # meit.ai_control.AiControl (Aufgaben-Routing, Budget, Verbrauch)
        # Embeddings immer lokal (Ollama), außer der Primär-Provider kann es selbst.
        self.embedder: LLM = (
            self.primary if isinstance(self.primary, (OllamaLLM, OpenAICompatLLM)) else OllamaLLM(settings)
        )

    @property
    def cloud_enabled(self) -> bool:
        if self.control is not None:
            return bool(self.control.conf()["cloud_enabled"])
        return self.settings.allow_cloud_fallback or isinstance(self.primary, AnthropicLLM)

    @property
    def cloud(self) -> "AnthropicLLM | None":
        return self.claude if self.cloud_enabled else None

    def claude_ok(self) -> bool:
        if not self.cloud_enabled or not self.claude.available():
            return False
        return self.control.budget_ok() if self.control is not None else True

    def claude_for(self, task: str | None) -> AnthropicLLM:
        if self.control is None:
            return self.claude
        return self.control.configure(self.claude, task or "allgemein")

    def get(self, task: str | None = None) -> LLM:
        mode = self.control.mode(task) if (self.control is not None and task) else "auto"
        if isinstance(self.primary, AnthropicLLM):
            return self.claude_for(task) if self.claude_ok() and mode != "lokal" else NoLLM(self.settings)
        if mode == "claude" and self.claude_ok():
            return self.claude_for(task)
        if self.primary.available():
            return self.primary
        if mode != "lokal" and self.claude_ok():
            return self.claude_for(task)
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
            "cloud_fallback_allowed": self.cloud_enabled,
            "claude": {"available": self.claude.available(), "model": self.claude_for(None).model,
                       "detail": self.claude.status().detail, "budget_ok": self.control.budget_ok() if self.control else True},
            "embed_model": self.settings.embed_model,
            "installed_models": self.primary.list_models() if isinstance(self.primary, OllamaLLM) else [],
        }
