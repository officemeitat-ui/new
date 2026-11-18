"""Anmeldung bei Microsoft (Entra ID) – gemeinsam für Postfach, SharePoint/OneDrive, Kunden-Tenants und To Do.

Sicherheit
* **Zertifikat statt Geheimnis** (von Microsoft empfohlen): Das Cockpit erzeugt Schlüssel + Zertifikat selbst,
  hochgeladen wird nur der öffentliche Teil (.cer). Der private Schlüssel verlässt den Server nie, kann nicht
  abgefischt werden und läuft nicht unbemerkt ab. Signatur PS256, Kopf ``x5t#S256`` (laut Microsoft-Doku).
* Ist ein Zertifikat aktiv, wird es zuerst verwendet; ein hinterlegtes Geheimnis dient nur als Rückfallebene
  (und wird im Verbindungs-Center als Hinweis angezeigt).
* ``token_claims`` liest die tatsächlich erteilten Berechtigungen (``roles``/``scp``) aus dem eigenen Token –
  damit prüft das Verbindungs-Center, ob eine App mehr darf als nötig.
"""

from __future__ import annotations

import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
LOGIN = "https://login.microsoftonline.com"


class MsAuthError(RuntimeError):
    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def token_claims(token: str) -> dict[str, Any]:
    """Nutzdaten eines (eigenen) Zugriffstokens lesen – ohne Signaturprüfung, nur zur Anzeige der Rechte."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}


# ----------------------------------------------------------------------------- Zertifikat
@dataclass
class Certificate:
    path: Path
    thumbprint_sha1: str
    thumbprint_s256: str
    not_after: datetime
    subject: str
    _key: Any = field(default=None, repr=False)

    def assertion(self, client_id: str, tenant: str) -> str:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        now = int(time.time())
        header = {"alg": "PS256", "typ": "JWT", "x5t#S256": self.thumbprint_s256}
        claims = {"aud": f"{LOGIN}/{tenant}/oauth2/v2.0/token", "iss": client_id, "sub": client_id,
                  "jti": str(uuid.uuid4()), "nbf": now, "iat": now, "exp": now + 300}
        signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}." \
                        f"{_b64url(json.dumps(claims, separators=(',', ':')).encode())}"
        signature = self._key.sign(signing_input.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                                                                       salt_length=32), hashes.SHA256())
        return f"{signing_input}.{_b64url(signature)}"


def load_certificate(path: str | Path) -> Certificate:
    """PEM-Datei mit privatem Schlüssel und Zertifikat laden."""
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
    except ImportError as exc:  # pragma: no cover - in requirements.txt
        raise MsAuthError("Für Zertifikate fehlt das Paket cryptography (pip install cryptography).") from exc
    p = Path(path)
    try:
        pem = p.read_bytes()
    except OSError as exc:
        raise MsAuthError(f"Zertifikatsdatei nicht lesbar: {p}") from exc
    try:
        key = serialization.load_pem_private_key(pem, password=None)
        cert = x509.load_pem_x509_certificate(pem[pem.index(b"-----BEGIN CERTIFICATE-----"):])
    except (ValueError, TypeError) as exc:
        raise MsAuthError("Die PEM-Datei muss privaten Schlüssel und Zertifikat enthalten (ohne Kennwort).") from exc
    der = cert.public_bytes(serialization.Encoding.DER)
    return Certificate(path=p, thumbprint_sha1=cert.fingerprint(hashes.SHA1()).hex().upper(),
                       thumbprint_s256=_b64url(cert.fingerprint(hashes.SHA256())),
                       not_after=cert.not_valid_after_utc, subject=cert.subject.rfc4514_string(), _key=key)


def generate_certificate(directory: str | Path, name: str = "meit-graph", subject: str = "ME-IT Cockpit",
                         years: int = 2) -> dict[str, Any]:
    """Schlüssel + selbstsigniertes Zertifikat erzeugen. ``<name>.pem`` (privat, nur Server) und ``<name>.cer`` (hochladen)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    now = datetime.now(timezone.utc)
    subj = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject)])
    cert = (x509.CertificateBuilder().subject_name(subj).issuer_name(subj).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=365 * years))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    pem_path, cer_path = d / f"{name}.pem", d / f"{name}.cer"
    key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(pem_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key_pem + cert.public_bytes(serialization.Encoding.PEM))
    try:
        os.chmod(pem_path, 0o600)
    except OSError:  # Windows
        pass
    cer_path.write_bytes(cert.public_bytes(serialization.Encoding.DER))
    c = load_certificate(pem_path)
    return {"pem": str(pem_path), "cer": str(cer_path), "thumbprint": c.thumbprint_sha1,
            "not_after": c.not_after.date().isoformat(), "subject": c.subject}


# ----------------------------------------------------------------------------- Prozessweite Einstellung
_state: dict[str, Any] = {"cert_file": "", "cert": None, "status": {}}


def configure(cert_file: str = "") -> Certificate | None:
    """Aktives Zertifikat setzen (beim Start aus GRAPH_CERT_FILE bzw. nach „Zertifikat aktivieren“)."""
    _state["cert_file"], _state["cert"] = cert_file or "", None
    if cert_file:
        _state["cert"] = load_certificate(cert_file)
    return _state["cert"]


def active_certificate() -> Certificate | None:
    return _state["cert"]


def has_credential(secret: str) -> bool:
    return bool(secret or _state["cert"])


def last_status() -> dict[str, Any]:
    return dict(_state["status"])


def _explain(data: dict[str, Any], status: int) -> str:
    desc = (data.get("error_description") or "").splitlines()[0] if data.get("error_description") else ""
    code = desc.split(":")[0] if desc.startswith("AADSTS") else ""
    hints = {
        "AADSTS7000215": "Geheimnis ist falsch oder abgelaufen.",
        "AADSTS7000222": "Geheimnis ist abgelaufen – neues erstellen oder auf Zertifikat umstellen.",
        "AADSTS700027": "Zertifikat ist in der App-Registrierung nicht hinterlegt (bzw. Signatur ungültig).",
        "AADSTS700016": "App im Tenant nicht gefunden – Zustimmung fehlt oder falsche Client-ID.",
        "AADSTS90002": "Tenant nicht gefunden – Tenant-ID/Domain prüfen.",
        "AADSTS7000218": "„Öffentliche Clientflows zulassen“ ist in der App-Registrierung (Authentifizierung) nicht aktiviert.",
        "AADSTS65001": "Zustimmung (Admin-Consent) für die Berechtigungen fehlt.",
    }
    return hints.get(code, desc or f"HTTP {status}")


class TokenSource:
    """App-Token (Client-Credentials) mit Cache – je Client-Instanz, damit Tests und Mandanten getrennt bleiben."""

    def __init__(self, tenant: str, client_id: str, secret: str = "", scope: str = GRAPH_SCOPE):
        self.tenant, self.client_id, self.secret, self.scope = tenant, client_id, secret, scope
        self._token: tuple[float, str] | None = None
        self.method = ""

    @property
    def configured(self) -> bool:
        return bool(self.tenant and self.client_id and has_credential(self.secret))

    def _request(self, extra: dict[str, str]) -> tuple[int, dict[str, Any]]:
        import httpx

        try:
            resp = httpx.post(f"{LOGIN}/{self.tenant}/oauth2/v2.0/token", timeout=30,
                              data={"grant_type": "client_credentials", "client_id": self.client_id, "scope": self.scope, **extra})
        except httpx.HTTPError as exc:
            raise MsAuthError(f"Microsoft-Anmeldung nicht erreichbar: {exc}") from exc
        try:
            data = resp.json()
        except ValueError:
            data = {}
        return resp.status_code, data

    def token(self) -> str:
        if self._token and self._token[0] > time.time() + 60:
            return self._token[1]
        if not self.tenant or not self.client_id:
            raise MsAuthError("Tenant oder Client-ID fehlt.")
        attempts: list[tuple[str, dict[str, str]]] = []
        cert = _state["cert"]
        if cert:
            attempts.append(("zertifikat", {"client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                                            "client_assertion": cert.assertion(self.client_id, self.tenant)}))
        if self.secret:
            attempts.append(("geheimnis", {"client_secret": self.secret}))
        if not attempts:
            raise MsAuthError("Kein Zertifikat und kein Geheimnis hinterlegt.")
        errors = []
        for method, extra in attempts:
            status, data = self._request(extra)
            if status == 200 and data.get("access_token"):
                self._token = (time.time() + int(data.get("expires_in", 3600)), data["access_token"])
                self.method = method
                _state["status"][f"{self.tenant}|{self.client_id}"] = {
                    "method": method, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "fallback": method == "geheimnis" and cert is not None, "error": "; ".join(errors)}
                return self._token[1]
            errors.append(f"{'Zertifikat' if method == 'zertifikat' else 'Geheimnis'}: {_explain(data, status)}")
        raise MsAuthError("Anmeldung bei Microsoft fehlgeschlagen – " + "; ".join(errors), code=",".join(errors))

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token()}"}

    def claims(self) -> dict[str, Any]:
        return token_claims(self.token())


# ----------------------------------------------------------------------------- Delegiert (Gerätecode, z. B. To Do)
def device_code_start(tenant: str, client_id: str, scope: str) -> dict[str, Any]:
    import httpx

    try:
        r = httpx.post(f"{LOGIN}/{tenant}/oauth2/v2.0/devicecode", data={"client_id": client_id, "scope": scope}, timeout=30)
        data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MsAuthError(f"Microsoft-Anmeldung nicht erreichbar: {exc}") from exc
    if r.status_code != 200 or "device_code" not in data:
        raise MsAuthError(_explain(data, r.status_code))
    return data


def device_code_poll(tenant: str, client_id: str, device_code: str) -> dict[str, Any]:
    """Ein Abfrageversuch: {"status": "pending"|"ok"|"declined"|"expired"|"error", ...tokens}."""
    import httpx

    try:
        r = httpx.post(f"{LOGIN}/{tenant}/oauth2/v2.0/token", timeout=30, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "client_id": client_id, "device_code": device_code})
        data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        return {"status": "error", "error": f"Microsoft-Anmeldung nicht erreichbar: {exc}"}
    if r.status_code == 200 and data.get("access_token"):
        return {"status": "ok", **data}
    err = data.get("error", "")
    if err in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    if err == "authorization_declined":
        return {"status": "declined", "error": "Anmeldung wurde abgelehnt."}
    if err in ("expired_token", "bad_verification_code"):
        return {"status": "expired", "error": "Code abgelaufen – bitte neu starten."}
    return {"status": "error", "error": _explain(data, r.status_code)}


def refresh_delegated(tenant: str, client_id: str, refresh_token: str, scope: str) -> dict[str, Any]:
    import httpx

    try:
        r = httpx.post(f"{LOGIN}/{tenant}/oauth2/v2.0/token", timeout=30, data={
            "grant_type": "refresh_token", "client_id": client_id, "refresh_token": refresh_token, "scope": scope})
        data = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MsAuthError(f"Microsoft-Anmeldung nicht erreichbar: {exc}") from exc
    if r.status_code != 200 or not data.get("access_token"):
        raise MsAuthError("Anmeldung abgelaufen oder widerrufen – bitte neu verbinden. " + _explain(data, r.status_code),
                          code=data.get("error", ""))
    return data


def cert_dir(data_dir: str | Path) -> Path:
    return Path(data_dir) / "zertifikate"


def main() -> None:  # python -m meit.msauth zertifikat [ordner]
    import sys

    if len(sys.argv) >= 2 and sys.argv[1] in ("zertifikat", "certificate"):
        out = generate_certificate(sys.argv[2] if len(sys.argv) > 2 else "data/zertifikate")
        print(f"Privat (bleibt am Server): {out['pem']}\nHochladen in Entra ID:    {out['cer']}\n"
              f"Fingerabdruck: {out['thumbprint']}  gültig bis {out['not_after']}\n"
              f"In .env: GRAPH_CERT_FILE={out['pem']}")
    else:
        print("Verwendung: python -m meit.msauth zertifikat [ordner]")


if __name__ == "__main__":
    main()
