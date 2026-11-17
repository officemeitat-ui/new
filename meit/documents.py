"""Dokumentenprozess mit Microsoft 365: Outlook → ME-IT Cockpit → SharePoint/OneDrive.

Ablauf
------
* **Ausgangsrechnungen**: beim „Stellen“ wird automatisch ein PDF im Corporate Design erzeugt, im lokalen
  Archiv (``data/archiv``) abgelegt und – falls eingerichtet – nach SharePoint bzw. OneDrive hochgeladen
  (Buchhaltung + Kundenordner). Versand per Outlook/Microsoft 365 (oder SMTP) mit PDF und ebInterface-XML.
* **Angebote, Berichte, QBR**: PDF auf Knopfdruck, Ablage im Kundenordner, Versand per Mail.
* **Eingangsrechnungen (Belege)**: PDFs aus dem Postfach landen automatisch in
  ``Buchhaltung/Eingangsrechnungen/<Jahr>/<Monat>`` – der Steuerberater sieht sie sofort.

SharePoint/OneDrive werden über Microsoft Graph angesprochen (dieselbe App-Registrierung wie für die Mail).
Benötigte Anwendungsberechtigung: ``Sites.Selected`` (empfohlen, mit Freigabe nur für die eine Site)
oder ``Files.ReadWrite.All``. Ohne Microsoft 365 funktioniert alles mit dem lokalen Archiv.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote, urlparse

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .billing import company_profile, period_bounds
from .branding import get_branding, logo_path
from .db import Database, loads, now_iso
from .mail import Attachment, MailError
from .pdf import invoice_pdf, markdown_pdf

MONTHS = ["01-Jänner", "02-Februar", "03-März", "04-April", "05-Mai", "06-Juni", "07-Juli", "08-August",
          "09-September", "10-Oktober", "11-November", "12-Dezember"]

DEFAULT_SETTINGS: dict[str, Any] = {
    "target": "local",          # local | sharepoint | onedrive
    "sharepoint_site": "",      # https://firma.sharepoint.com/sites/ME-IT
    "library": "",              # Dokumentbibliothek (leer = Standard „Dokumente“)
    "onedrive_user": "",        # UPN/E-Mail des OneDrive-Besitzers
    "base_folder": "ME-IT",
    "folders": {
        "rechnung": "Buchhaltung/Ausgangsrechnungen/{jahr}",
        "rechnung_kunde": "Kunden/{kunde}/Rechnungen/{jahr}",
        "beleg": "Buchhaltung/Eingangsrechnungen/{jahr}/{monat}",
        "angebot": "Kunden/{kunde}/Angebote/{jahr}",
        "bericht": "Kunden/{kunde}/Berichte/{jahr}",
        "mahnung": "Buchhaltung/Mahnungen/{jahr}",
    },
    "auto_invoice": True,       # Rechnung beim Stellen automatisch ablegen
    "auto_receipts": True,      # Beleg-PDFs aus dem Postfach automatisch ablegen
    "attach_xml": True,         # ebInterface-XML an Rechnungsmail anhängen
    "cc": "",                   # z. B. Buchhaltung/Steuerberater in Kopie
    "invoice_subject": "Rechnung {nummer} – {firma}",
    "invoice_text": ("{anrede}\n\nanbei erhalten Sie unsere Rechnung {nummer} über {betrag}, zahlbar bis {faellig}.\n\n"
                     "Bei Fragen melden Sie sich jederzeit gerne.\n\nFreundliche Grüße\n{firma}"),
    "quote_subject": "Angebot: {titel}",
    "quote_text": ("{anrede}\n\nvielen Dank für Ihr Interesse. Anbei erhalten Sie unser Angebot „{titel}“.\n\n"
                   "Gerne besprechen wir die Details in einem kurzen Termin – antworten Sie einfach auf diese Mail.\n\n"
                   "Freundliche Grüße\n{firma}"),
}
FOLDER_KEYS = set(DEFAULT_SETTINGS["folders"])
KINDS = {"rechnung", "angebot", "beleg", "bericht", "qbr", "mahnung", "sonstiges"}
SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024
CHUNK = 320 * 1024 * 16  # 5 MiB, Vielfaches von 320 KiB (Graph-Vorgabe)


class DocumentError(RuntimeError):
    pass


def safe_segment(value: str) -> str:
    """Ordner-/Dateinamen-Teil, der in SharePoint, OneDrive und Windows gültig ist."""
    value = re.sub(r'[\x00-\x1f"*:<>?/\\|#%]+', " ", str(value or ""))
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:80] or "Unbenannt"


def safe_filename(value: str) -> str:
    stem, dot, ext = str(value).rpartition(".")
    if not dot:
        return safe_segment(value).replace(" ", "_")
    return f"{safe_segment(stem).replace(' ', '_')}.{re.sub(r'[^A-Za-z0-9]', '', ext)[:8].lower()}"


def render_folder(template: str, *, kunde: str = "", day: date | None = None, nummer: str = "") -> str:
    day = day or date.today()
    values = {"kunde": kunde or "Ohne Kunde", "jahr": str(day.year), "monat": MONTHS[day.month - 1],
              "nummer": nummer or ""}
    parts = []
    for seg in (template or "").split("/"):
        seg = re.sub(r"\{(kunde|jahr|monat|nummer)\}", lambda m: values[m.group(1)], seg)
        if seg.strip():
            parts.append(safe_segment(seg))
    return "/".join(parts)


def fill_text(template: str, values: dict[str, str]) -> str:
    """Platzhalter {name} ersetzen – nur bekannte Schlüssel (kein str.format → keine Attribut-Zugriffe)."""
    return re.sub(r"\{([a-z_]+)\}", lambda m: values.get(m.group(1), m.group(0)), template or "")


def parse_site(value: str) -> tuple[str, str]:
    """„https://firma.sharepoint.com/sites/ME-IT“ oder „firma.sharepoint.com:/sites/ME-IT“ → (Host, Pfad)."""
    value = (value or "").strip()
    if not value:
        raise DocumentError("Keine SharePoint-Site eingetragen.")
    if "://" in value:
        u = urlparse(value)
        host, path = u.hostname or "", u.path
    else:
        host, _, path = value.partition(":")
    path = "/" + "/".join(p for p in path.split("/") if p and not p.endswith(".aspx"))
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("sites", "teams"):
        path = f"/{parts[0]}/{parts[1]}"
    if not host.endswith(".sharepoint.com") and not host.endswith(".sharepoint.us"):
        raise DocumentError("SharePoint-Adresse muss auf .sharepoint.com enden.")
    return host, ("" if path == "/" else path)


# ----------------------------------------------------------------------------- Microsoft Graph
class GraphDrive:
    """Upload in eine SharePoint-Dokumentbibliothek oder ein OneDrive über Microsoft Graph."""

    GRAPH = "https://graph.microsoft.com/v1.0"

    def __init__(self, settings: Any, conf: dict[str, Any]):
        self.s, self.conf = settings, conf
        self._token: tuple[float, str] | None = None
        self._base: str | None = None

    @property
    def credentials(self) -> bool:
        s = self.s
        return bool(s and s.graph_tenant_id and s.graph_client_id and s.graph_client_secret)

    def _headers(self) -> dict[str, str]:
        import time

        import httpx

        if not self.credentials:
            raise DocumentError("Microsoft 365 ist nicht eingerichtet (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, "
                                "GRAPH_CLIENT_SECRET in der .env).")
        if not self._token or self._token[0] < time.time() + 60:
            try:
                resp = httpx.post(f"https://login.microsoftonline.com/{self.s.graph_tenant_id}/oauth2/v2.0/token",
                                  data={"grant_type": "client_credentials", "client_id": self.s.graph_client_id,
                                        "client_secret": self.s.graph_client_secret,
                                        "scope": "https://graph.microsoft.com/.default"}, timeout=30)
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as exc:
                raise DocumentError(f"Anmeldung bei Microsoft 365 fehlgeschlagen: {exc}") from exc
            self._token = (time.time() + int(data.get("expires_in", 3600)), data["access_token"])
        return {"Authorization": f"Bearer {self._token[1]}"}

    def _call(self, method: str, url: str, **kwargs):
        import httpx

        if not url.startswith("https://"):
            url = self.GRAPH + url
        try:
            resp = httpx.request(method, url, headers={**self._headers(), **kwargs.pop("headers", {})},
                                 timeout=kwargs.pop("timeout", 60), **kwargs)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                detail = exc.response.json().get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001
                pass
            hint = ""
            if exc.response.status_code in (401, 403):
                hint = (" – Berechtigung fehlt: Sites.Selected (mit Freigabe für die Site) bzw. "
                        "Files.ReadWrite.All als Anwendungsberechtigung mit Administratorzustimmung.")
            raise DocumentError(f"Microsoft Graph {exc.response.status_code}: {detail or exc}{hint}") from exc
        except httpx.HTTPError as exc:
            raise DocumentError(f"Microsoft Graph nicht erreichbar: {exc}") from exc

    def base(self) -> str:
        """Drive-Pfad, z. B. /sites/{id}/drive oder /users/{upn}/drive."""
        if self._base:
            return self._base
        target = self.conf.get("target")
        if target == "onedrive":
            user = (self.conf.get("onedrive_user") or getattr(self.s, "graph_mailbox", "") or "").strip()
            if not user:
                raise DocumentError("Kein OneDrive-Benutzer eingetragen.")
            self._base = f"/users/{quote(user)}/drive"
        elif target == "sharepoint":
            host, path = parse_site(self.conf.get("sharepoint_site", ""))
            site = self._call("GET", f"/sites/{host}:{path}" if path else f"/sites/{host}").json()
            site_id = site["id"]
            library = (self.conf.get("library") or "").strip()
            if library:
                drives = self._call("GET", f"/sites/{site_id}/drives").json().get("value", [])
                match = next((d for d in drives if d.get("name", "").lower() == library.lower()), None)
                if not match:
                    names = ", ".join(d.get("name", "") for d in drives)
                    raise DocumentError(f"Bibliothek „{library}“ nicht gefunden. Vorhanden: {names}")
                self._base = f"/drives/{match['id']}"
            else:
                self._base = f"/sites/{site_id}/drive"
        else:
            raise DocumentError("Ablageziel ist „nur lokal“.")
        return self._base

    def upload(self, path: str, data: bytes, content_type: str = "application/octet-stream") -> dict[str, Any]:
        item_path = quote(path.strip("/"))
        base = self.base()
        if len(data) <= SIMPLE_UPLOAD_LIMIT:
            resp = self._call("PUT", f"{base}/root:/{item_path}:/content?@microsoft.graph.conflictBehavior=replace",
                              content=data, headers={"Content-Type": content_type})
            item = resp.json()
        else:
            session = self._call("POST", f"{base}/root:/{item_path}:/createUploadSession",
                                 json={"item": {"@microsoft.graph.conflictBehavior": "replace"}}).json()
            import httpx

            item, total = {}, len(data)
            for start in range(0, total, CHUNK):
                chunk = data[start:start + CHUNK]
                # Upload-URL ist vorsigniert – ohne Authorization-Header senden.
                resp = httpx.put(session["uploadUrl"], content=chunk, timeout=120, headers={
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start}-{start + len(chunk) - 1}/{total}"})
                if resp.status_code >= 400:
                    raise DocumentError(f"Upload abgebrochen ({resp.status_code}).")
                if resp.status_code in (200, 201):
                    item = resp.json()
        return {"id": item.get("id", ""), "url": item.get("webUrl", "")}

    def test(self) -> dict[str, Any]:
        root = self._call("GET", f"{self.base()}/root").json()
        return {"ok": True, "url": root.get("webUrl", ""), "name": root.get("name", "")}


# ----------------------------------------------------------------------------- Service
class DocumentService:
    def __init__(self, db: Database, settings: Any, data_dir: Path, company: str = "ME-IT",
                 drive_factory: Callable[[Any, dict], Any] = GraphDrive):
        self.db, self.settings, self.company = db, settings, company
        self.data_dir = Path(data_dir)
        custom = getattr(settings, "archive_dir", "") if settings else ""
        self.archive_dir = Path(custom) if custom else self.data_dir / "archiv"
        self.drive_factory = drive_factory
        self._drive: tuple[str, Any] | None = None

    # -- Einstellungen
    def conf(self) -> dict[str, Any]:
        stored = self.db.get_setting("documents", {}) or {}
        merged = {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}
        merged["folders"] = {**DEFAULT_SETTINGS["folders"], **(stored.get("folders") or {})}
        return merged

    def save_conf(self, data: dict[str, Any]) -> dict[str, Any]:
        current = self.conf()
        for key, value in data.items():
            if key == "folders" and isinstance(value, dict):
                current["folders"].update({k: str(v)[:200] for k, v in value.items() if k in FOLDER_KEYS})
            elif key in DEFAULT_SETTINGS and key != "folders":
                current[key] = value if isinstance(DEFAULT_SETTINGS[key], bool) else str(value or "")[:2000]
        if current["target"] not in ("local", "sharepoint", "onedrive"):
            raise DocumentError("Ablageziel muss local, sharepoint oder onedrive sein.")
        if current["target"] == "sharepoint" and current["sharepoint_site"]:
            parse_site(current["sharepoint_site"])
        self.db.set_setting("documents", current)
        self._drive = None
        return current

    def drive(self, conf: dict[str, Any] | None = None):
        conf = conf or self.conf()
        key = json.dumps([conf["target"], conf["sharepoint_site"], conf["library"], conf["onedrive_user"]])
        if not self._drive or self._drive[0] != key:
            self._drive = (key, self.drive_factory(self.settings, conf))
        return self._drive[1]

    def status(self) -> dict[str, Any]:
        conf = self.conf()
        s = self.settings
        creds = bool(s and s.graph_tenant_id and s.graph_client_id and s.graph_client_secret)
        stats = self.db.query_one(
            "SELECT COUNT(*) AS total, SUM(CASE WHEN remote_status = 'fehler' THEN 1 ELSE 0 END) AS errors, "
            "SUM(CASE WHEN remote_status = 'ok' THEN 1 ELSE 0 END) AS synced FROM documents") or {}
        return {**conf, "graph_credentials": creds, "archive_dir": str(self.archive_dir),
                "total": stats.get("total") or 0, "errors": stats.get("errors") or 0, "synced": stats.get("synced") or 0}

    # -- Ablage
    def store(self, kind: str, filename: str, data: bytes, *, title: str = "", customer_id: int | None = None,
              ref_type: str = "", ref_id: int | None = None, day: date | None = None, nummer: str = "",
              folder_keys: tuple[str, ...] | None = None, content_type: str = "application/pdf",
              upload: bool = True) -> dict[str, Any]:
        """Datei lokal archivieren und (falls eingerichtet) nach SharePoint/OneDrive hochladen."""
        conf = self.conf()
        kunde = ""
        if customer_id:
            kunde = self.db.scalar("SELECT name FROM customers WHERE id = ?", (customer_id,)) or ""
        keys = folder_keys or (kind if kind in FOLDER_KEYS else "bericht",)
        folders = [f for f in (render_folder(conf["folders"].get(k, ""), kunde=kunde, day=day, nummer=nummer)
                               for k in keys) if f]
        if not folders:
            folders = [render_folder("Sonstiges/{jahr}", day=day)]
        filename = safe_filename(filename)
        local_dir = (self.archive_dir / folders[0]).resolve()
        if not str(local_dir).startswith(str(self.archive_dir.resolve())):
            raise DocumentError("Ungültiger Ordner")
        local_dir.mkdir(parents=True, exist_ok=True)
        (local_dir / filename).write_bytes(data)
        existing = None
        if ref_type and ref_id:
            existing = self.db.query_one("SELECT id FROM documents WHERE ref_type = ? AND ref_id = ? AND kind = ? "
                                         "AND filename = ?", (ref_type, ref_id, kind, filename))
        row = {"kind": kind, "title": title or filename, "filename": filename, "customer_id": customer_id,
               "ref_type": ref_type, "ref_id": ref_id, "folder": folders[0],
               "local_path": str((local_dir / filename).relative_to(self.archive_dir.resolve())),
               "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "remote": conf["target"],
               "remote_status": "" if conf["target"] == "local" else "ausstehend", "remote_error": ""}
        if existing:
            self.db.update("documents", existing["id"], row)
            doc_id = existing["id"]
        else:
            doc_id = self.db.insert("documents", row)
        if upload and conf["target"] != "local":
            self._upload(doc_id, data, folders, content_type, conf)
        return self.db.get("documents", doc_id)

    def _upload(self, doc_id: int, data: bytes, folders: list[str], content_type: str, conf: dict[str, Any]) -> None:
        doc = self.db.get("documents", doc_id)
        base = render_folder(conf.get("base_folder") or "")
        try:
            drive = self.drive(conf)
            first: dict[str, Any] = {}
            for folder in folders:
                result = drive.upload("/".join(p for p in (base, folder, doc["filename"]) if p), data, content_type)
                first = first or result
            self.db.update("documents", doc_id, {"remote_status": "ok", "remote_url": first.get("url", ""),
                                                 "remote_id": first.get("id", ""), "remote_error": ""})
        except Exception as exc:  # noqa: BLE001 - lokale Ablage bleibt gültig, Upload wird wiederholbar
            self.db.update("documents", doc_id, {"remote_status": "fehler", "remote_error": str(exc)[:500]})

    def local_file(self, doc: dict[str, Any]) -> Path:
        path = (self.archive_dir / doc["local_path"]).resolve()
        if not str(path).startswith(str(self.archive_dir.resolve())) or not path.is_file():
            raise DocumentError("Datei nicht im Archiv gefunden.")
        return path

    def retry(self, doc_id: int) -> dict[str, Any]:
        doc = self.db.get("documents", doc_id)
        if not doc:
            raise DocumentError("Dokument nicht gefunden")
        conf = self.conf()
        if conf["target"] == "local":
            raise DocumentError("Ablageziel ist „nur lokal“ – nichts hochzuladen.")
        data = self.local_file(doc).read_bytes()
        folders = [doc["folder"]]
        if doc["kind"] == "rechnung" and doc["ref_type"] == "invoice":
            inv = self.db.get("invoices", doc["ref_id"]) or {}
            day = date.fromisoformat(inv["date"]) if inv.get("date") else None
            extra = render_folder(conf["folders"].get("rechnung_kunde", ""), kunde=inv.get("customer_name", ""), day=day)
            if extra and extra not in folders:
                folders.append(extra)
        ctype = "application/xml" if doc["filename"].endswith(".xml") else "application/pdf"
        self.db.update("documents", doc_id, {"remote": conf["target"]})
        self._upload(doc_id, data, folders, ctype, conf)
        return self.db.get("documents", doc_id)

    def retry_failed(self, limit: int = 20) -> dict[str, int]:
        ids = [r["id"] for r in self.db.query(
            "SELECT id FROM documents WHERE remote_status IN ('fehler', 'ausstehend') ORDER BY id LIMIT ?", (limit,))]
        ok = 0
        for did in ids:
            try:
                ok += self.retry(did)["remote_status"] == "ok"
            except DocumentError:
                pass
        return {"tried": len(ids), "ok": ok}

    # -- PDFs
    def _brand(self) -> tuple[dict[str, Any], dict[str, Any], Path]:
        profile = company_profile(self.db, self.company)
        return profile, get_branding(self.db, profile.get("name") or self.company), logo_path(self.data_dir)

    def invoice_pdf(self, inv: dict[str, Any]) -> bytes:
        profile, branding, logo = self._brand()
        customer = self.db.get("customers", inv["customer_id"]) if inv.get("customer_id") else None
        period = period_bounds(inv["period"]) if inv.get("period") else None
        return invoice_pdf(inv, loads(inv["items"], []), customer or {"name": inv.get("customer_name", "")},
                           profile, branding, logo, period)

    def quote_pdf(self, q: dict[str, Any]) -> bytes:
        profile, branding, logo = self._brand()
        sub = f"Angebot Nr. A-{q['id']:04d} · {datetime.fromisoformat(q['created_at']).strftime('%d.%m.%Y')}"
        return markdown_pdf(f"Angebot: {q['title']}", q["text"] or q["title"], profile, branding, logo, subtitle=sub)

    def text_pdf(self, title: str, text: str, subtitle: str = "") -> bytes:
        profile, branding, logo = self._brand()
        return markdown_pdf(title, text, profile, branding, logo, subtitle=subtitle)

    @staticmethod
    def quote_filename(q: dict[str, Any]) -> str:
        title = re.sub(r"^\s*Angebot\s*:?\s*", "", q.get("title") or "", flags=re.I)
        if len(title) > 50:
            title = title[:50].rsplit(" ", 1)[0]
        title = re.sub(r"[\s,;:(\[–-]+$", "", title)
        return safe_filename(f"Angebot_A-{q['id']:04d}_{title or 'IT'}.pdf")

    @staticmethod
    def invoice_filename(inv: dict[str, Any]) -> str:
        return f"Rechnung_{inv['number'] or 'Entwurf-' + str(inv['id'])}_{safe_segment(inv.get('customer_name') or '')}.pdf"

    def archive_invoice(self, invoice_id: int) -> dict[str, Any]:
        inv = self.db.get("invoices", invoice_id)
        if not inv:
            raise DocumentError("Rechnung nicht gefunden")
        if inv["status"] == "entwurf":
            raise DocumentError("Entwürfe werden nicht archiviert – Rechnung zuerst stellen.")
        day = date.fromisoformat(inv["date"]) if inv["date"] else date.today()
        return self.store("rechnung", self.invoice_filename(inv), self.invoice_pdf(inv), title=f"Rechnung {inv['number']}",
                          customer_id=inv["customer_id"], ref_type="invoice", ref_id=invoice_id, day=day,
                          nummer=inv["number"], folder_keys=("rechnung", "rechnung_kunde"))

    def archive_quote(self, quote_id: int) -> dict[str, Any]:
        q = self.db.get("quotes", quote_id)
        if not q:
            raise DocumentError("Angebot nicht gefunden")
        return self.store("angebot", self.quote_filename(q), self.quote_pdf(q),
                          title=f"Angebot: {q['title']}", customer_id=q["customer_id"], ref_type="quote", ref_id=quote_id)

    def archive_text(self, title: str, text: str, *, kind: str = "bericht", customer_id: int | None = None,
                     ref_type: str = "", ref_id: int | None = None) -> dict[str, Any]:
        stamp = date.today().isoformat()
        pdf = self.text_pdf(title, text, subtitle=f"Erstellt am {date.today().strftime('%d.%m.%Y')}")
        return self.store(kind if kind in KINDS else "bericht", f"{stamp}_{title}.pdf", pdf, title=title,
                          customer_id=customer_id, ref_type=ref_type, ref_id=ref_id, folder_keys=("bericht",))

    def archive_receipt(self, receipt_id: int, files: list[tuple[str, bytes]]) -> list[dict[str, Any]]:
        """Beleg-PDFs aus dem Postfach in Buchhaltung/Eingangsrechnungen ablegen."""
        r = self.db.get("receipts", receipt_id)
        if not r or not files:
            return []
        try:
            day = date.fromisoformat(r["invoice_date"]) if r["invoice_date"] else date.today()
        except ValueError:
            day = date.today()
        docs = []
        for n, (name, data) in enumerate(files[:5], 1):
            parts = [day.isoformat(), r["vendor"] or "Lieferant", r["invoice_no"] or Path(name).stem]
            suffix = f"_{n}" if len(files) > 1 else ""
            doc = self.store("beleg", "_".join(p for p in parts if p) + suffix + ".pdf", data,
                             title=f"Beleg {r['vendor']} {r['invoice_no']}".strip(), ref_type="receipt",
                             ref_id=receipt_id, day=day, folder_keys=("beleg",))
            docs.append(doc)
        if docs:
            self.db.update("receipts", receipt_id, {"document_id": docs[0]["id"]})
        return docs

    # -- Versand
    def mail_html(self, text: str) -> str:
        profile, b, _ = self._brand()
        e = html.escape
        paragraphs = "".join(f'<p style="margin:0 0 14px">{e(p).replace(chr(10), "<br>")}</p>'
                             for p in text.strip().split("\n\n"))
        contact = " · ".join(e(x) for x in (profile.get("phone"), profile.get("email"), b.get("website")) if x)
        address = e(" · ".join(l.strip() for l in (profile.get("address") or "").splitlines() if l.strip()))
        return f"""<!doctype html><html lang="de"><body style="margin:0;background:#f3f7f8;font-family:Roboto,Segoe UI,Arial,sans-serif;color:{b['dark']}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f8;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-top:5px solid {b['brand']};border-radius:6px">
<tr><td style="padding:28px 32px 8px"><img src="cid:logo" alt="{e(profile.get('name') or '')}" height="56" style="display:block;height:56px;width:auto;border:0"></td></tr>
<tr><td style="padding:12px 32px 8px;font-size:15px;line-height:1.55">{paragraphs}</td></tr>
<tr><td style="padding:8px 32px 28px"><div style="width:40px;height:3px;background:{b['accent']};margin-bottom:12px"></div>
<div style="font-size:12px;color:{b['anthracite']};line-height:1.5"><strong>{e(profile.get('name') or '')}</strong> – {e(b.get('tagline') or '')}<br>{address}<br>{contact}</div></td></tr>
</table></td></tr></table></body></html>"""

    def _logo_attachment(self) -> Attachment:
        logo = logo_path(self.data_dir)
        ctype = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(logo.suffix.lower(), "image/png")
        return Attachment(f"logo{logo.suffix}", logo.read_bytes(), ctype, inline_id="logo")

    def _values(self, customer: dict[str, Any] | None) -> dict[str, str]:
        profile, _, _ = self._brand()
        contact = (customer or {}).get("contact_name") or ""
        return {"anrede": f"Guten Tag {contact}," if contact else "Guten Tag,", "firma": profile.get("name") or self.company,
                "kunde": (customer or {}).get("name", "")}

    def invoice_mail(self, inv: dict[str, Any]) -> dict[str, str]:
        from .pdf import _d, _eur

        conf = self.conf()
        customer = self.db.get("customers", inv["customer_id"]) if inv.get("customer_id") else None
        values = {**self._values(customer), "nummer": inv["number"] or "", "betrag": _eur(inv["gross"]),
                  "faellig": _d(inv["due_date"]) if inv.get("due_date") else "–"}
        return {"to": (customer or {}).get("email", ""), "cc": conf["cc"],
                "subject": fill_text(conf["invoice_subject"], values), "text": fill_text(conf["invoice_text"], values),
                "attach_xml": conf["attach_xml"]}

    def quote_mail(self, q: dict[str, Any]) -> dict[str, str]:
        conf = self.conf()
        customer = self.db.get("customers", q["customer_id"]) if q.get("customer_id") else None
        values = {**self._values(customer), "titel": q["title"]}
        return {"to": (customer or {}).get("email", ""), "cc": conf["cc"],
                "subject": fill_text(conf["quote_subject"], values), "text": fill_text(conf["quote_text"], values)}

    def send_branded(self, mailer: Any, to: str, cc: str, subject: str, text: str, attachments: list[Attachment]) -> str:
        if mailer is None or not getattr(mailer, "smtp_configured", False):
            raise MailError("Kein Mailversand eingerichtet (Microsoft 365 oder SMTP in der .env).")
        if not re.fullmatch(r"[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+", to or ""):
            raise MailError("Gültige Empfängeradresse angeben.")
        cc_list = [c.strip() for c in re.split(r"[,;]", cc or "") if c.strip()]
        if any(not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", c) for c in cc_list):
            raise MailError("Ungültige Kopie-Adresse (CC).")
        try:
            attachments = [*attachments, self._logo_attachment()]
        except OSError:
            pass
        return mailer.send(to, subject, text, attachments=attachments, html=self.mail_html(text), cc=", ".join(cc_list))

    def send_invoice(self, mailer: Any, invoice_id: int, *, to: str, cc: str = "", subject: str, text: str,
                     attach_xml: bool = True) -> dict[str, Any]:
        inv = self.db.get("invoices", invoice_id)
        if not inv:
            raise DocumentError("Rechnung nicht gefunden")
        if inv["status"] not in ("gestellt", "bezahlt"):
            raise DocumentError("Nur gestellte Rechnungen können versendet werden.")
        pdf = self.invoice_pdf(inv)
        attachments = [Attachment(self.invoice_filename(inv), pdf, "application/pdf")]
        xml_note = ""
        if attach_xml:
            try:
                from .einvoice import ebinterface_xml

                attachments.append(Attachment(f"ebInterface_{inv['number']}.xml",
                                              ebinterface_xml(self.db, inv, company_profile(self.db, self.company)),
                                              "application/xml"))
            except ValueError as exc:
                xml_note = f"ebInterface nicht angehängt: {exc}"
        external_id = self.send_branded(mailer, to, cc, subject, text, attachments)
        ts = now_iso()
        self.db.update("invoices", invoice_id, {"sent_at": ts, "sent_to": to})
        self.log_out(to, subject, text, inv["customer_id"], "invoice", invoice_id, external_id, len(attachments))
        doc = None
        if not self.db.query_one("SELECT id FROM documents WHERE ref_type = 'invoice' AND ref_id = ?", (invoice_id,)):
            doc = self.archive_invoice(invoice_id)
        return {"sent": True, "to": to, "sent_at": ts, "attachments": [a.name for a in attachments],
                "note": xml_note, "document": doc}

    def send_quote(self, mailer: Any, quote_id: int, *, to: str, cc: str = "", subject: str, text: str) -> dict[str, Any]:
        q = self.db.get("quotes", quote_id)
        if not q:
            raise DocumentError("Angebot nicht gefunden")
        if q["status"] in ("angenommen", "abgelehnt"):
            raise DocumentError("Angebot ist bereits abgeschlossen.")
        pdf = self.quote_pdf(q)
        name = self.quote_filename(q)
        external_id = self.send_branded(mailer, to, cc, subject, text, [Attachment(name, pdf, "application/pdf")])
        self.log_out(to, subject, text, q["customer_id"], "quote", quote_id, external_id, 1)
        doc = self.archive_quote(quote_id)
        return {"sent": True, "to": to, "attachments": [name], "document": doc}

    def log_out(self, to: str, subject: str, text: str, customer_id: int | None, ref_type: str, ref_id: int,
                 external_id: str, n_attachments: int) -> None:
        self.db.insert("messages", {"channel": "email", "direction": "out", "external_id": external_id or "",
                                    "to_email": to, "subject": subject, "body": text, "status": "gesendet",
                                    "customer_id": customer_id, "linked_type": ref_type, "linked_id": ref_id,
                                    "attachments": [f"{n_attachments} Anhang/Anhänge"], "sent_at": now_iso()})


# ----------------------------------------------------------------------------- API
class DocSettingsIn(BaseModel):
    target: Optional[str] = None
    sharepoint_site: Optional[str] = Field(None, max_length=300)
    library: Optional[str] = Field(None, max_length=120)
    onedrive_user: Optional[str] = Field(None, max_length=200)
    base_folder: Optional[str] = Field(None, max_length=120)
    folders: Optional[dict[str, str]] = None
    auto_invoice: Optional[bool] = None
    auto_receipts: Optional[bool] = None
    attach_xml: Optional[bool] = None
    cc: Optional[str] = Field(None, max_length=300)
    invoice_subject: Optional[str] = Field(None, max_length=200)
    invoice_text: Optional[str] = Field(None, max_length=3000)
    quote_subject: Optional[str] = Field(None, max_length=200)
    quote_text: Optional[str] = Field(None, max_length=3000)


class SendIn(BaseModel):
    to: str = Field(..., max_length=200)
    cc: str = Field("", max_length=300)
    subject: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=10000)
    attach_xml: bool = True


class ReportIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=100000)
    kind: str = "bericht"
    customer_id: Optional[int] = None
    ref_type: str = Field("", max_length=30)
    ref_id: Optional[int] = None


def pdf_response(data: bytes, filename: str, download: bool = False) -> Response:
    disposition = "attachment" if download else "inline"
    ascii_name = filename.encode("ascii", "replace").decode().replace("?", "_").replace('"', "")
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "no-store"})


def register(app: FastAPI, ctx: Any, admin_only, apply_quote_status: Callable[..., dict]) -> DocumentService:
    db: Database = ctx.db
    svc: DocumentService = ctx.docs

    def guard(fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except (DocumentError, MailError) as exc:
            raise HTTPException(422, str(exc))

    def actor(request: Request) -> int | None:
        user = getattr(request.state, "user", None)
        return user["id"] if user else None

    @app.get("/api/documents/settings")
    def doc_settings() -> dict:
        return svc.status()

    @app.put("/api/documents/settings", dependencies=[Depends(admin_only)])
    def save_doc_settings(data: DocSettingsIn) -> dict:
        guard(lambda: svc.save_conf(data.model_dump(exclude_none=True)))
        return svc.status()

    @app.post("/api/documents/test", dependencies=[Depends(admin_only)])
    def test_drive() -> dict:
        conf = svc.conf()
        if conf["target"] == "local":
            return {"ok": True, "url": "", "name": "Lokales Archiv", "local": str(svc.archive_dir)}
        return guard(lambda: svc.drive(conf).test())

    @app.get("/api/documents")
    def list_documents(customer_id: Optional[int] = None, kind: Optional[str] = None, ref_type: Optional[str] = None,
                       ref_id: Optional[int] = None, q: Optional[str] = None, limit: int = 200) -> list[dict]:
        sql = ("SELECT d.*, c.name AS customer_name FROM documents d LEFT JOIN customers c ON c.id = d.customer_id "
               "WHERE 1=1")
        params: list[Any] = []
        for col, val in (("d.customer_id", customer_id), ("d.kind", kind), ("d.ref_type", ref_type), ("d.ref_id", ref_id)):
            if val:
                sql += f" AND {col} = ?"
                params.append(val)
        if q:
            sql += " AND (d.title LIKE ? OR d.filename LIKE ?)"
            params += [f"%{q}%", f"%{q}%"]
        return db.query(sql + " ORDER BY d.id DESC LIMIT ?", [*params, min(limit, 1000)])

    @app.get("/api/documents/{doc_id}/download")
    def download(doc_id: int, inline: bool = True) -> FileResponse:
        doc = db.get("documents", doc_id)
        if not doc:
            raise HTTPException(404, "Dokument nicht gefunden")
        path = guard(lambda: svc.local_file(doc))
        media = "application/pdf" if doc["filename"].endswith(".pdf") else "application/octet-stream"
        return FileResponse(path, media_type=media, filename=doc["filename"],
                            content_disposition_type="inline" if inline else "attachment")

    @app.post("/api/documents/{doc_id}/retry", dependencies=[Depends(admin_only)])
    def retry(doc_id: int) -> dict:
        return guard(lambda: svc.retry(doc_id))

    @app.post("/api/documents/retry-failed", dependencies=[Depends(admin_only)])
    def retry_failed() -> dict:
        return svc.retry_failed()

    @app.post("/api/documents/report", status_code=201)
    def archive_report(data: ReportIn) -> dict:
        if data.customer_id and not db.get("customers", data.customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        return guard(lambda: svc.archive_text(data.title, data.text, kind=data.kind, customer_id=data.customer_id,
                                              ref_type=data.ref_type, ref_id=data.ref_id))

    # Rechnungen
    def invoice(iid: int) -> dict:
        inv = db.get("invoices", iid)
        if not inv:
            raise HTTPException(404, "Rechnung nicht gefunden")
        return inv

    @app.get("/api/invoices/{iid}/pdf")
    def invoice_pdf_view(iid: int, download: bool = False) -> Response:
        inv = invoice(iid)
        return pdf_response(svc.invoice_pdf(inv), svc.invoice_filename(inv), download)

    @app.post("/api/invoices/{iid}/archive", dependencies=[Depends(admin_only)])
    def invoice_archive(iid: int) -> dict:
        invoice(iid)
        return guard(lambda: svc.archive_invoice(iid))

    @app.get("/api/invoices/{iid}/mail")
    def invoice_mail(iid: int) -> dict:
        return svc.invoice_mail(invoice(iid))

    @app.post("/api/invoices/{iid}/send", dependencies=[Depends(admin_only)])
    def invoice_send(iid: int, data: SendIn, request: Request) -> dict:
        invoice(iid)
        result = guard(lambda: svc.send_invoice(ctx.mailer, iid, to=data.to.strip(), cc=data.cc, subject=data.subject,
                                                text=data.text, attach_xml=data.attach_xml))
        from .team import log_activity

        log_activity(db, actor(request), "rechnung", "invoice", iid, f"versendet an {data.to.strip()}")
        return result

    # Angebote
    def quote_row(qid: int) -> dict:
        q = db.get("quotes", qid)
        if not q:
            raise HTTPException(404, "Angebot nicht gefunden")
        return q

    @app.get("/api/quotes/{qid}/pdf")
    def quote_pdf_view(qid: int, download: bool = False) -> Response:
        q = quote_row(qid)
        return pdf_response(svc.quote_pdf(q), svc.quote_filename(q), download)

    @app.post("/api/quotes/{qid}/archive")
    def quote_archive(qid: int) -> dict:
        quote_row(qid)
        return guard(lambda: svc.archive_quote(qid))

    @app.get("/api/quotes/{qid}/mail")
    def quote_mail(qid: int) -> dict:
        return svc.quote_mail(quote_row(qid))

    @app.post("/api/quotes/{qid}/send")
    def quote_send(qid: int, data: SendIn, request: Request) -> dict:
        quote_row(qid)
        result = guard(lambda: svc.send_quote(ctx.mailer, qid, to=data.to.strip(), cc=data.cc, subject=data.subject,
                                              text=data.text))
        if quote_row(qid)["status"] == "entwurf":
            apply_quote_status(qid, "versendet", actor=actor(request), via=" (per Mail)")
        return result

    # Belege manuell hochladen (z. B. Papierrechnung gescannt)
    @app.post("/api/receipts/upload", status_code=201)
    async def upload_receipt(request: Request) -> dict:
        from .agents.inbox import parse_receipt
        from .mail import _pdf_text

        data = await request.body()
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(413, "Datei zu groß (max. 20 MB)")
        if not data.startswith(b"%PDF"):
            raise HTTPException(415, "Nur PDF-Dateien")
        from urllib.parse import unquote

        name = unquote(request.headers.get("x-filename", "beleg.pdf"))[:120] or "beleg.pdf"
        text = _pdf_text(data)
        parsed = parse_receipt(f"{name}\n{text}", "")
        rid = db.insert("receipts", {**parsed, "note": f"Hochgeladen: {name}"})
        docs = guard(lambda: svc.archive_receipt(rid, [(name, data)]))
        return {"receipt": db.get("receipts", rid), "documents": docs, "text_found": bool(text)}

    return svc
