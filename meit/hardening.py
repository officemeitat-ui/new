"""Härtung der von außen erreichbaren Teile (Ergebnis der Sicherheitsprüfung).

* ``BodyLimit`` – begrenzt die Größe eingehender Anfragen, bevor sie in den Speicher gelesen werden
  (öffentliche Formulare/Logins klein, Datei-Uploads bis 21 MB).
* ``content_security_policy`` – Browser-Schutzregel (CSP): nur eigene Skripte, eingebettete Skripte der
  ausgelieferten Seiten per Prüfsumme freigegeben. Eingeschleuster Code wird vom Browser nicht ausgeführt.
* ``csv_safe`` – verhindert, dass Texte aus E-Mails (Lieferant, Notiz) in Excel als Formel ausgeführt werden.
* TOTP (RFC 6238) für die Zwei-Faktor-Anmeldung im Cockpit – ohne Zusatzpaket.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import struct
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

MB = 1024 * 1024
UPLOAD_LIMIT = 21 * MB
PUBLIC_JSON_LIMIT = 64 * 1024
AGENT_LIMIT = 512 * 1024
DEFAULT_LIMIT = 26 * MB
UPLOAD_SUFFIXES = ("/attachments", "/phishing", "/upload", "/import")


def limit_for(path: str) -> int:
    """Maximale Größe einer Anfrage je Pfad."""
    if path.startswith("/api/public/agent/"):
        return AGENT_LIMIT
    if path.startswith("/wopi/"):
        return UPLOAD_LIMIT  # Speichern aus dem Office-Editor
    if path.startswith("/api/public/") or path in ("/api/portal/login", "/api/auth/login"):
        return PUBLIC_JSON_LIMIT
    if path.startswith("/api/portal/"):
        return UPLOAD_LIMIT if path.endswith(UPLOAD_SUFFIXES) else PUBLIC_JSON_LIMIT
    return DEFAULT_LIMIT


class _TooLarge(Exception):
    pass


class BodyLimit:
    """ASGI-Middleware: lehnt zu große Anfragen ab (auch ohne Content-Length, z. B. chunked)."""

    def __init__(self, app: Any, limit_for: Callable[[str], int] = limit_for):
        self.app, self.limit_for = app, limit_for

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        limit = self.limit_for(scope.get("path", ""))
        declared = dict(scope.get("headers") or []).get(b"content-length", b"")
        started = False

        async def reject() -> None:
            body = json.dumps({"detail": f"Anfrage zu groß (max. {max(1, limit // 1024)} KB)."}).encode()
            await send({"type": "http.response.start", "status": 413,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                    (b"connection", b"close")]})
            await send({"type": "http.response.body", "body": body})

        if declared.isdigit() and int(declared) > limit:
            await reject()
            return
        received = 0
        exceeded = False

        async def limited_receive() -> dict:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body") or b"")
                if received > limit:
                    exceeded = True
                    raise _TooLarge()  # die Anwendung bekommt den Rest nie zu sehen (keine halben Uploads)
            return message

        async def tracking_send(message: dict) -> None:
            nonlocal started
            if exceeded:  # die Anwendung hat den Abbruch evtl. in einen 400er verwandelt → einheitlich 413
                if not started:
                    started = True
                    await reject()
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not started:
                await reject()


# ----------------------------------------------------------------------------- Content-Security-Policy
SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)


def script_hashes(html_file: Path) -> list[str]:
    """Prüfsummen der eingebetteten Skripte einer HTML-Datei (für script-src)."""
    try:
        text = html_file.read_text(encoding="utf-8")
    except OSError:
        return []
    return ["'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'"
            for m in SCRIPT_RE.finditer(text)]


def content_security_policy(hashes: list[str] | None = None, frame_ancestors: str = "'none'", office: str = "") -> str:
    """``office``: Adresse des eigenen Office-Servers – nur dieser darf zusätzlich eingebettet und per Formular
    angesprochen werden (Editor im Cockpit)."""
    extra = f" {office}" if office else ""
    parts = [
        "default-src 'self'",
        "script-src 'self'" + ("".join(" " + h for h in hashes) if hashes else ""),
        "style-src 'self' 'unsafe-inline'",  # style-Attribute der Oberfläche; Skripte bleiben gesperrt
        "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob:", "connect-src 'self'",
        "worker-src 'self'", "manifest-src 'self'", f"frame-src 'self'{extra}", "object-src 'none'", "base-uri 'self'",
        f"form-action 'self'{extra}",
    ]
    if frame_ancestors:
        parts.append(f"frame-ancestors {frame_ancestors}")
    return "; ".join(parts)


# ----------------------------------------------------------------------------- CSV
def csv_safe(value: Any) -> Any:
    """Text für CSV-Exporte entschärfen: Zellen, die Excel als Formel deuten würde, bekommen ein Hochkomma."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


# ----------------------------------------------------------------------------- TOTP (RFC 6238)
TOTP_STEP = 30
TOTP_DIGITS = 6


def totp_new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def totp_at(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10 ** TOTP_DIGITS).zfill(TOTP_DIGITS)


def totp_verify(secret: str, code: str, last_step: int = 0, now: float | None = None, window: int = 1) -> int | None:
    """Gültig? → verwendeter Zeitschritt (für den Wiederholungsschutz), sonst None."""
    code = re.sub(r"\D", "", code or "")
    if len(code) != TOTP_DIGITS:
        return None
    current = int((now if now is not None else time.time()) // TOTP_STEP)
    for step in range(current - window, current + window + 1):
        if step > last_step and hmac.compare_digest(totp_at(secret, step), code):
            return step
    return None


def otpauth_uri(secret: str, account: str, issuer: str) -> str:
    return (f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}"
            f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_STEP}")


def new_recovery_codes(n: int = 10) -> list[str]:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(n)]


def recovery_hash(code: str) -> str:
    return hashlib.sha256(re.sub(r"[^0-9a-f]", "", (code or "").lower()).encode()).hexdigest()


# ----------------------------------------------------------------------------- Protokoll ohne Zugriffstoken
_TOKEN_IN_URL = re.compile(r"((?:access_token|token)=)[^&\s\"']+", re.I)


class RedactTokens(logging.Filter):
    """Entfernt Zugriffstoken aus Protokollzeilen (der Office-Server schickt sein Token in der Adresse)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(_TOKEN_IN_URL.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args)
        if isinstance(record.msg, str):
            record.msg = _TOKEN_IN_URL.sub(r"\1***", record.msg)
        return True


def redact_access_log() -> None:
    """Filter einmalig am Zugriffsprotokoll des Webservers anbringen."""
    log = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactTokens) for f in log.filters):
        log.addFilter(RedactTokens())
