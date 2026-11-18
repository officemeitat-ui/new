"""Tresor für gespeicherte Anmeldungen (z. B. Microsoft-To-Do-Verbindung je Benutzer).

Verschlüsselung mit Fernet (AES-128-CBC + HMAC-SHA256, Paket ``cryptography``). Der Schlüssel liegt **nicht**
in der Datenbank: entweder ``MEIT_SECRET_KEY`` in der .env oder die Datei ``<Datenordner>/tresor.key``
(nur für den Dienst lesbar). Eine Datenbank-Sicherung allein enthält damit keine verwendbaren Anmeldungen.
"""

from __future__ import annotations

import os
from pathlib import Path


class VaultError(RuntimeError):
    pass


class Vault:
    def __init__(self, data_dir: str | Path, env_key: str = ""):
        self.path = Path(data_dir) / "tresor.key"
        self._env_key = env_key or os.environ.get("MEIT_SECRET_KEY", "")
        self._fernet = None

    @property
    def source(self) -> str:
        return "MEIT_SECRET_KEY (.env)" if self._env_key else str(self.path)

    def _f(self):
        if self._fernet is None:
            try:
                from cryptography.fernet import Fernet
            except ImportError as exc:  # pragma: no cover
                raise VaultError("Paket cryptography fehlt (pip install cryptography).") from exc
            key = self._env_key.encode() if self._env_key else None
            if key is None:
                if self.path.exists():
                    key = self.path.read_bytes().strip()
                else:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    key = Fernet.generate_key()
                    fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, "wb") as f:
                        f.write(key)
            try:
                self._fernet = Fernet(key)
            except (ValueError, TypeError) as exc:
                raise VaultError("Tresor-Schlüssel ist ungültig (MEIT_SECRET_KEY bzw. tresor.key).") from exc
        return self._fernet

    def encrypt(self, text: str) -> str:
        return self._f().encrypt(text.encode()).decode()

    def decrypt(self, token: str) -> str:
        from cryptography.fernet import InvalidToken

        try:
            return self._f().decrypt(token.encode()).decode()
        except InvalidToken as exc:
            raise VaultError("Gespeicherte Anmeldung lässt sich nicht entschlüsseln (Tresor-Schlüssel geändert?) – "
                             "bitte neu verbinden.") from exc
