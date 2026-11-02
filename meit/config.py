"""Konfiguration über Umgebungsvariablen (oder eine .env-Datei im Projektordner)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Minimaler .env-Loader, damit keine Zusatzabhängigkeit nötig ist."""
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _resolve(path: str) -> str:
    """Relative Pfade beziehen sich auf den Projektordner (egal, von wo gestartet wird)."""
    if path == ":memory:" or Path(path).is_absolute():
        return path
    return str(BASE_DIR / path)


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "ja", "on"}


@dataclass(frozen=True)
class Settings:
    db_path: str
    company_name: str
    # KI-Provider: "ollama" (offline, Standard), "openai" (OpenAI-kompatibler Server,
    # z. B. LM Studio, llama.cpp, vLLM), "anthropic" (Claude, Cloud) oder "none".
    llm_provider: str
    ollama_url: str
    ollama_model: str
    embed_model: str
    openai_base_url: str
    openai_api_key: str
    openai_model: str
    anthropic_model: str
    anthropic_effort: str
    # Cloud-Fallback nur, wenn ausdrücklich erlaubt (DSGVO: Kundendaten bleiben lokal).
    allow_cloud_fallback: bool
    llm_timeout: float
    seed_demo_data: bool
    app_password: str


def get_settings() -> Settings:
    _load_dotenv()
    return Settings(
        db_path=_resolve(os.environ.get("MEIT_DB", "data/meit.db")),
        company_name=os.environ.get("MEIT_COMPANY", "ME-IT"),
        llm_provider=os.environ.get("LLM_PROVIDER", "ollama").strip().lower(),
        ollama_url=os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
        ollama_model=os.environ.get("OLLAMA_MODEL", "qwen3:14b"),
        embed_model=os.environ.get("EMBED_MODEL", "bge-m3"),
        openai_base_url=os.environ.get("OPENAI_BASE_URL", "http://localhost:1234/v1").rstrip("/"),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "lm-studio"),
        openai_model=os.environ.get("OPENAI_MODEL", "local-model"),
        anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5"),
        anthropic_effort=os.environ.get("ANTHROPIC_EFFORT", "medium"),
        allow_cloud_fallback=_bool("ALLOW_CLOUD_FALLBACK", False),
        llm_timeout=float(os.environ.get("LLM_TIMEOUT", "180")),
        seed_demo_data=_bool("MEIT_SEED_DEMO", True),
        app_password=os.environ.get("MEIT_PASSWORD", ""),
    )
