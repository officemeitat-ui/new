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


def _int(name: str, default: int) -> int:
    try:
        return int((os.environ.get(name) or "").strip() or default)
    except ValueError:
        return default


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
    # --- KI-Mitarbeiter: E-Mail-Anbindung -------------------------------------
    mail_provider: str = "imap"  # "imap" (IMAP/SMTP) oder "graph" (Microsoft 365)
    graph_tenant_id: str = ""
    graph_client_id: str = ""
    graph_client_secret: str = ""
    graph_mailbox: str = ""
    mail_imap_host: str = ""
    mail_imap_port: int = 993
    mail_imap_user: str = ""
    mail_imap_password: str = ""
    mail_imap_folder: str = "INBOX"
    mail_smtp_host: str = ""
    mail_smtp_port: int = 587
    mail_smtp_user: str = ""
    mail_smtp_password: str = ""
    mail_from: str = ""
    mail_poll_minutes: int = 0
    # --- KI-Mitarbeiter: Kundenkontakt -----------------------------------------
    booking_url: str = ""
    followup_days: int = 5
    public_form_enabled: bool = True
    public_form_origins: tuple[str, ...] = ()
    # --- RMM (NinjaOne) & Kalender ---------------------------------------------
    ninja_url: str = ""
    ninja_client_id: str = ""
    ninja_client_secret: str = ""
    ninja_sync_hours: int = 0
    ninja_alert_tickets: bool = False
    # --- Atera (RMM mit Splashtop) ----------------------------------------------
    atera_api_key: str = ""
    atera_sync_hours: int = 0
    atera_alert_tickets: bool = False
    # --- BookStack (Dokumentations-Wiki) ----------------------------------------
    bookstack_url: str = ""
    bookstack_token_id: str = ""
    bookstack_token_secret: str = ""
    bookstack_sync_hours: int = 0
    # Öffentliche Adresse des Cockpits (für Links in Mails, z. B. Zufriedenheits-Umfrage)
    public_url: str = ""
    graph_calendar: bool = False
    # --- Microsoft 365 der Kunden (mandantenfähige App, nur Leserechte) ---------
    m365_client_id: str = ""      # leer = GRAPH_CLIENT_ID
    m365_client_secret: str = ""  # leer = GRAPH_CLIENT_SECRET
    m365_sync_hours: int = 24
    # --- Datensicherung -------------------------------------------------------
    backup_hours: int = 24
    backup_keep: int = 14
    backup_dir: str = ""
    # --- Dokumentenarchiv (PDF-Rechnungen, Belege, Berichte) -----------------
    # Leer = <Datenordner>/archiv. Tipp: auf einen per OneDrive-Client synchronisierten Ordner zeigen lassen.
    archive_dir: str = ""


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
        mail_provider=(os.environ.get("MAIL_PROVIDER") or "imap").strip().lower(),
        graph_tenant_id=os.environ.get("GRAPH_TENANT_ID", ""),
        graph_client_id=os.environ.get("GRAPH_CLIENT_ID", ""),
        graph_client_secret=os.environ.get("GRAPH_CLIENT_SECRET", ""),
        graph_mailbox=os.environ.get("GRAPH_MAILBOX", ""),
        mail_imap_host=os.environ.get("MAIL_IMAP_HOST", ""),
        mail_imap_port=_int("MAIL_IMAP_PORT", 993),
        mail_imap_user=os.environ.get("MAIL_IMAP_USER", ""),
        mail_imap_password=os.environ.get("MAIL_IMAP_PASSWORD", ""),
        mail_imap_folder=os.environ.get("MAIL_IMAP_FOLDER", "INBOX"),
        mail_smtp_host=os.environ.get("MAIL_SMTP_HOST", ""),
        mail_smtp_port=_int("MAIL_SMTP_PORT", 587),
        mail_smtp_user=os.environ.get("MAIL_SMTP_USER") or os.environ.get("MAIL_IMAP_USER", ""),
        mail_smtp_password=os.environ.get("MAIL_SMTP_PASSWORD") or os.environ.get("MAIL_IMAP_PASSWORD", ""),
        mail_from=os.environ.get("MAIL_FROM") or os.environ.get("MAIL_IMAP_USER", ""),
        mail_poll_minutes=_int("MAIL_POLL_MINUTES", 0),
        booking_url=os.environ.get("BOOKING_URL", ""),
        followup_days=_int("FOLLOWUP_DAYS", 5),
        public_form_enabled=_bool("PUBLIC_FORM_ENABLED", True),
        ninja_url=(os.environ.get("NINJA_URL") or "").rstrip("/"),
        ninja_client_id=os.environ.get("NINJA_CLIENT_ID", ""),
        ninja_client_secret=os.environ.get("NINJA_CLIENT_SECRET", ""),
        ninja_sync_hours=_int("NINJA_SYNC_HOURS", 0),
        ninja_alert_tickets=_bool("NINJA_ALERT_TICKETS", False),
        atera_api_key=os.environ.get("ATERA_API_KEY", ""),
        atera_sync_hours=_int("ATERA_SYNC_HOURS", 0),
        atera_alert_tickets=_bool("ATERA_ALERT_TICKETS", False),
        bookstack_url=(os.environ.get("BOOKSTACK_URL") or "").rstrip("/"),
        bookstack_token_id=os.environ.get("BOOKSTACK_TOKEN_ID", ""),
        bookstack_token_secret=os.environ.get("BOOKSTACK_TOKEN_SECRET", ""),
        bookstack_sync_hours=_int("BOOKSTACK_SYNC_HOURS", 0),
        public_url=(os.environ.get("PUBLIC_URL") or "").rstrip("/"),
        m365_client_id=os.environ.get("M365_CLIENT_ID", ""),
        m365_client_secret=os.environ.get("M365_CLIENT_SECRET", ""),
        m365_sync_hours=_int("M365_SYNC_HOURS", 24),
        graph_calendar=_bool("GRAPH_CALENDAR", False),
        backup_hours=_int("BACKUP_HOURS", 24),
        backup_keep=_int("BACKUP_KEEP", 14),
        backup_dir=_resolve(os.environ["BACKUP_DIR"]) if os.environ.get("BACKUP_DIR") else "",
        archive_dir=_resolve(os.environ["ARCHIVE_DIR"]) if os.environ.get("ARCHIVE_DIR") else "",
        public_form_origins=tuple(
            o.strip().rstrip("/") for o in os.environ.get("PUBLIC_FORM_ORIGINS", "").split(",") if o.strip()
        ),
    )
