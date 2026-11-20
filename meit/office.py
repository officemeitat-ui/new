"""Office im Cockpit: Word-, Excel- und PowerPoint-Dateien im Browser bearbeiten – mit dem eigenen Office-Server.

Das Cockpit ist der **WOPI-Host** (Dateiablage), der Office-Server (Collabora Online oder ONLYOFFICE Docs mit aktiviertem
WOPI) der Editor. Ablauf:
1. Das Cockpit fragt die Fähigkeiten des Office-Servers ab (``/hosting/discovery``).
2. Beim Öffnen einer Datei erzeugt das Cockpit ein **Zugriffstoken nur für diese Datei** (zufällig, befristet, im
   Cockpit nur als Prüfsumme gespeichert) und lädt den Editor in einem Rahmen.
3. Der Office-Server holt und speichert die Datei über ``/wopi/files/<id>`` – ausschließlich mit diesem Token.

Sicherheit: Token je Datei und Benutzer (Schreib- oder Leserecht), Ablauf nach 10 Stunden, optionale Liste erlaubter
Adressen des Office-Servers, Dateisperren gegen gleichzeitiges Überschreiben, jede Speicherung mit Versionen.
Dazu: eigene Ablage und Dateien je Kunde, neue Dokumente (Text, Tabelle, Brief) und Vorlagen mit Platzhaltern.
"""

from __future__ import annotations

import hashlib
import io
import ipaddress
import re
import secrets
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Any, Optional
from urllib.parse import quote, urlparse
from xml.etree import ElementTree as ET

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .attachments import MAX_SIZE, Store
from .billing import company_profile
from .db import Database, now_iso

TOKEN_HOURS = 10
LOCK_MINUTES = 30
EDITABLE_HINT = ("docx", "xlsx", "pptx", "odt", "ods", "odp", "doc", "xls", "ppt", "rtf", "txt", "csv")
REF_TYPES = {"customer": "Kunde", "library": "Eigene Ablage", "ticket": "Ticket"}
DEFAULT = {"enabled": False, "url": "", "cockpit_url": "", "allowed_ips": [], "lang": "de"}
PLACEHOLDERS = {"kunde": "Name des Kunden", "ansprechpartner": "Ansprechperson", "adresse": "Adresse des Kunden",
                "email": "E-Mail des Kunden", "datum": "heutiges Datum", "firma": "eigene Firma", "firma_adresse": "eigene Adresse"}


class OfficeError(RuntimeError):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


# ----------------------------------------------------------------------------- Neue Dokumente (OOXML, ohne Zusatzpaket)
_CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
_RELS = (_CT + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
         'Target="{target}"/></Relationships>')


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def _para(text: str = "", bold: bool = False, size: int = 22, align: str = "") -> str:
    props = (f'<w:pPr><w:jc w:val="{align}"/></w:pPr>' if align else "")
    run = (f'<w:r><w:rPr>{"<w:b/>" if bold else ""}<w:sz w:val="{size}"/></w:rPr>'
           f'<w:t xml:space="preserve">{escape(text)}</w:t></w:r>') if text else ""
    return f"<w:p>{props}{run}</w:p>"


def new_docx(paragraphs: list[str] | None = None) -> bytes:
    """Leeres bzw. vorbefülltes Word-Dokument. ``paragraphs`` sind fertige ``<w:p>``-Blöcke (siehe ``_para``)."""
    body = "".join(paragraphs or [_para()])
    document = (_CT + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
                '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" '
                'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
    return _zip({
        "[Content_Types].xml": _CT + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": _RELS.format(target="word/document.xml"), "word/document.xml": document})


def new_xlsx(sheet: str = "Tabelle1") -> bytes:
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    return _zip({
        "[Content_Types].xml": _CT + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": _RELS.format(target="xl/workbook.xml"),
        "xl/workbook.xml": _CT + f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{escape(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": _CT + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": _CT + f'<worksheet xmlns="{ns}"><sheetData/></worksheet>'})


def letter_docx(profile: dict[str, Any], customer: dict[str, Any] | None, today: date | None = None) -> bytes:
    """Brief mit eigenem Absender und Empfänger – als Startpunkt zum Weiterschreiben."""
    today = today or date.today()
    c = customer or {}
    recipient = [x for x in [c.get("name", ""), c.get("contact_name", ""), *(c.get("address", "") or "").replace(",", "\n").splitlines()]
                 if x.strip()]
    paras = [_para(profile.get("name", ""), bold=True, size=28)]
    paras += [_para(line.strip(), size=18) for line in (profile.get("address", "") or "").splitlines() if line.strip()]
    paras += [_para(), _para()] + [_para(line.strip()) for line in recipient] + [_para(), _para(today.strftime("%d.%m.%Y"), align="right"),
              _para(), _para("Betreff", bold=True), _para(),
              _para("Sehr geehrte Damen und Herren,"), _para(), _para("…"), _para(),
              _para("Mit freundlichen Grüßen"), _para(), _para(profile.get("name", ""))]
    return new_docx(paras)


# ----------------------------------------------------------------------------- Vorlagen mit Platzhaltern
_PH = re.compile(r"\{\{((?:<[^>]+>|[^<{}])*)\}\}")
_TEMPLATE_PARTS = re.compile(r"^(word/(document|header\d*|footer\d*)\.xml|xl/sharedStrings\.xml|xl/worksheets/sheet\d+\.xml|"
                             r"ppt/slides/slide\d+\.xml|content\.xml|styles\.xml)$")


def fill_xml(xml: str, values: dict[str, str]) -> tuple[str, int]:
    """``{{platzhalter}}`` ersetzen – auch wenn das Office-Programm den Platzhalter intern in mehrere Stücke geteilt hat."""
    count = 0

    def repl(m: re.Match) -> str:
        nonlocal count
        key = re.sub(r"<[^>]+>", "", m.group(1)).strip().lower()
        if key not in values:
            return m.group(0)
        count += 1
        return escape(values[key])

    out = _PH.sub(repl, xml)
    if count and out != xml:
        try:
            ET.fromstring(out.encode("utf-8"))
        except ET.ParseError:  # geteilte Platzhalter ließen sich nicht sauber zusammenführen → nur die einfachen ersetzen
            count = 0
            simple = xml
            for key, value in values.items():
                n = len(re.findall(r"\{\{\s*" + re.escape(key) + r"\s*\}\}", simple, flags=re.I))
                simple = re.sub(r"\{\{\s*" + re.escape(key) + r"\s*\}\}", lambda _m: escape(value), simple, flags=re.I)
                count += n
            return simple, count
    return out, count


def fill_template(data: bytes, values: dict[str, str]) -> tuple[bytes, int]:
    try:
        src = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise OfficeError("Vorlagen müssen im Format docx, xlsx, pptx, odt oder ods vorliegen.") from exc
    buf, total = io.BytesIO(), 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            content = src.read(item.filename)
            if _TEMPLATE_PARTS.match(item.filename) and len(content) < 20 * 1024 * 1024:
                text, n = fill_xml(content.decode("utf-8", errors="replace"), values)
                total += n
                content = text.encode("utf-8")
            # „mimetype“ muss in ODF-Dateien unkomprimiert bleiben
            dst.writestr(item, content, zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED)
    return buf.getvalue(), total


def template_values(db: Database, company: str, customer: dict[str, Any] | None, today: date | None = None) -> dict[str, str]:
    prof = company_profile(db, company)
    c = customer or {}
    return {"kunde": c.get("name", ""), "ansprechpartner": c.get("contact_name", ""), "adresse": c.get("address", ""),
            "email": c.get("email", ""), "datum": (today or date.today()).strftime("%d.%m.%Y"), "firma": prof.get("name", ""),
            "firma_adresse": prof.get("address", "")}


# ----------------------------------------------------------------------------- Discovery
def parse_discovery(xml_text: str) -> dict[str, Any]:
    """Fähigkeiten des Office-Servers: je Dateiendung die Adressen zum Bearbeiten/Ansehen."""
    if len(xml_text) > 2_000_000 or "<!DOCTYPE" in xml_text or "<!ENTITY" in xml_text:
        raise OfficeError("Unerwartete Antwort des Office-Servers (Discovery).")
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except ET.ParseError as exc:
        raise OfficeError("Der Office-Server liefert keine gültige Discovery-Antwort.") from exc
    actions: dict[str, dict[str, str]] = {}
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] != "action":
            continue
        ext, name, url = (el.get("ext") or "").lower(), (el.get("name") or "").lower(), el.get("urlsrc") or ""
        if ext and url and name:
            actions.setdefault(ext, {}).setdefault(name, url)
    if not actions:
        raise OfficeError("Die Discovery-Antwort enthält keine Dateitypen.")
    sample = next(iter(next(iter(actions.values())).values()))
    product = ("Collabora Online" if re.search(r"/(cool|loleaflet)\.html|/browser/", sample) else
               "ONLYOFFICE Docs" if "/hosting/wopi" in sample else "Office-Server")
    return {"product": product, "actions": actions, "editable": sorted(e for e, a in actions.items() if "edit" in a),
            "viewable": sorted(actions)}


def editor_url(urlsrc: str, wopi_src: str, lang: str = "de") -> str:
    """Adresse des Editors: Platzhalter der Discovery auflösen, ``WOPISrc`` anhängen."""
    locale = {"de": "de-DE", "en": "en-US"}.get(lang, lang)

    def placeholder(m: re.Match) -> str:
        key = m.group(1).split("=", 1)[0].lower()
        return f"{key}={locale}&" if key in ("ui", "rs") else ""

    url = re.sub(r"<([^>]*)>", placeholder, urlsrc)
    url += "" if url.endswith(("?", "&")) else ("&" if "?" in url else "?")
    return f"{url}WOPISrc={quote(wopi_src, safe='')}&lang={quote(lang)}"


# ----------------------------------------------------------------------------- Dienst
class Office:
    def __init__(self, db: Database, store: Store, settings: Any):
        self.db, self.store, self.s = db, store, settings
        self._discovery: tuple[float, str, dict[str, Any]] | None = None

    # -- Einstellungen
    def conf(self) -> dict[str, Any]:
        return {**DEFAULT, **(self.db.get_setting("office", {}) or {})}

    def save_conf(self, patch: dict[str, Any]) -> dict[str, Any]:
        conf = {**self.conf(), **{k: v for k, v in patch.items() if v is not None}}
        for key in ("url", "cockpit_url"):
            conf[key] = (conf[key] or "").strip().rstrip("/")
            if conf[key] and not re.match(r"^https?://[^\s/]+", conf[key]):
                raise OfficeError("Adressen müssen mit http:// oder https:// beginnen.")
        ips = []
        for raw in conf.get("allowed_ips") or []:
            raw = str(raw).strip()
            if raw:
                try:
                    ips.append(str(ipaddress.ip_network(raw, strict=False)))
                except ValueError as exc:
                    raise OfficeError(f"Ungültige Adresse: {raw}") from exc
        conf["allowed_ips"] = ips
        conf["enabled"] = bool(conf["enabled"]) and bool(conf["url"])
        self.db.set_setting("office", conf)
        self._discovery = None
        return conf

    def origin(self) -> str:
        """Adresse des Office-Servers für die Browser-Schutzregel (nur wenn aktiv)."""
        conf = self.conf()
        if not (conf["enabled"] and conf["url"]):
            return ""
        u = urlparse(conf["url"])
        return f"{u.scheme}://{u.netloc}"

    def cockpit_url(self, request_base: str = "") -> str:
        return (self.conf()["cockpit_url"] or getattr(self.s, "public_url", "") or request_base).rstrip("/")

    def discovery(self, force: bool = False) -> dict[str, Any]:
        conf = self.conf()
        if not conf["url"]:
            raise OfficeError("Kein Office-Server eingetragen.")
        if not force and self._discovery and self._discovery[1] == conf["url"] and time.time() - self._discovery[0] < 3600:
            return self._discovery[2]
        import httpx

        try:
            r = httpx.get(conf["url"] + "/hosting/discovery", timeout=15, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise OfficeError(f"Office-Server nicht erreichbar: {exc}") from exc
        if r.status_code != 200:
            raise OfficeError(f"Office-Server antwortet mit HTTP {r.status_code} (bei ONLYOFFICE: WOPI in der Konfiguration aktivieren).")
        d = parse_discovery(r.text)
        self._discovery = (time.time(), conf["url"], d)
        return d

    def can_edit(self, filename: str) -> str:
        """„edit“, „view“ oder „“ – je nachdem, was der Office-Server für diese Dateiendung anbietet."""
        if not self.conf()["enabled"]:
            return ""
        try:
            a = self.discovery()["actions"].get(ext_of(filename), {})
        except OfficeError:
            return ""
        return "edit" if "edit" in a else "view" if a else ""

    # -- Zugriffstoken
    def open(self, att: dict[str, Any], user: dict[str, Any] | None, request_base: str, write: bool = True) -> dict[str, Any]:
        conf = self.conf()
        if not conf["enabled"]:
            raise OfficeError("Die Office-Anbindung ist nicht eingerichtet (Verbindungen & Sicherheit → Office-Server).")
        actions = self.discovery()["actions"].get(ext_of(att["filename"]), {})
        if write and "edit" in actions:
            action = "edit"
        else:  # Collabora kennt für die meisten Formate nur „edit“ – das Leserecht steckt dann im Token (UserCanWrite)
            action = next((a for a in ("view", "view_comment", "embedview", "edit") if a in actions), "")
        can_write = write and action == "edit"
        if not action:
            raise OfficeError(f"Der Office-Server kann .{ext_of(att['filename'])}-Dateien nicht öffnen.")
        token = secrets.token_urlsafe(32)
        expires = datetime.now() + timedelta(hours=TOKEN_HOURS)
        self.db.query("DELETE FROM office_tokens WHERE expires_at < ?", (now_iso(),))
        self.db.insert("office_tokens", {"token_hash": _hash(token), "attachment_id": att["id"], "user_id": (user or {}).get("id"),
                                         "user_name": (user or {}).get("name") or "Cockpit", "can_write": can_write,
                                         "expires_at": expires.replace(microsecond=0).isoformat(sep=" ")})
        base = self.cockpit_url(request_base)
        wopi_src = f"{base}/wopi/files/{att['id']}"
        return {"action_url": editor_url(actions[action], wopi_src, conf["lang"]), "access_token": token,
                "access_token_ttl": int(expires.timestamp() * 1000), "filename": att["filename"], "mode": "edit" if can_write else "view", "action": action,
                "wopi_src": wopi_src, "warning": ("Der Editor (https) kann eine http-Adresse des Cockpits meist nicht erreichen."
                                                  if conf["url"].startswith("https://") and base.startswith("http://") else "")}

    def session(self, token: str, attachment_id: int, ip: str = "") -> tuple[dict[str, Any], dict[str, Any]]:
        """Token prüfen → (Sitzung, Datei). Wirft ``PermissionError``."""
        conf = self.conf()
        if conf["allowed_ips"]:
            try:
                addr = ipaddress.ip_address(ip)
                if not any(addr in ipaddress.ip_network(n) for n in conf["allowed_ips"]):
                    raise PermissionError("Adresse nicht erlaubt")
            except ValueError as exc:
                raise PermissionError("Adresse nicht erlaubt") from exc
        row = self.db.query_one("SELECT * FROM office_tokens WHERE token_hash = ?", (_hash(token or ""),)) if token else None
        if not row or row["attachment_id"] != attachment_id or row["expires_at"] < now_iso():
            raise PermissionError("Token ungültig oder abgelaufen")
        if row["user_id"]:
            user = self.db.get("users", row["user_id"])
            if not user or not user["active"]:
                raise PermissionError("Benutzer nicht mehr aktiv")
        att = self.db.get("attachments", attachment_id)
        if not att:
            raise PermissionError("Datei nicht gefunden")
        return row, att

    # -- Sperren
    def current_lock(self, attachment_id: int) -> str:
        row = self.db.query_one("SELECT lock_id, expires_at FROM office_locks WHERE attachment_id = ?", (attachment_id,))
        if row and row["expires_at"] < now_iso():
            self.db.query("DELETE FROM office_locks WHERE attachment_id = ?", (attachment_id,))
            return ""
        return row["lock_id"] if row else ""

    def set_lock(self, attachment_id: int, lock_id: str) -> None:
        expires = (datetime.now() + timedelta(minutes=LOCK_MINUTES)).replace(microsecond=0).isoformat(sep=" ")
        with self.db.connect() as conn:
            conn.execute("INSERT INTO office_locks (attachment_id, lock_id, expires_at) VALUES (?, ?, ?) "
                         "ON CONFLICT(attachment_id) DO UPDATE SET lock_id = excluded.lock_id, expires_at = excluded.expires_at",
                         (attachment_id, lock_id[:1024], expires))

    # -- Dateien
    def file_view(self, a: dict[str, Any]) -> dict[str, Any]:
        return {**{k: a[k] for k in ("id", "ref_type", "ref_id", "filename", "content_type", "size", "source", "customer_visible",
                                     "created_at")}, "updated_at": a.get("updated_at") or "", "updated_by": a.get("updated_by") or "",
                "template": bool(a.get("template")), "ext": ext_of(a["filename"]), "office": self.can_edit(a["filename"]),
                "versions": self.db.scalar("SELECT COUNT(*) FROM file_versions WHERE attachment_id = ?", (a["id"],)) or 0,
                "locked": bool(self.current_lock(a["id"]))}

    def files(self, ref_type: str, ref_id: int) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM attachments WHERE ref_type = ? AND ref_id = ? ORDER BY template DESC, lower(filename)",
                             (ref_type, ref_id))
        return [self.file_view(a) for a in rows]


def last_modified(att: dict[str, Any]) -> str:
    """Änderungszeit im ISO-8601-Format (UTC) – der Editor erkennt damit zwischenzeitliche Änderungen."""
    raw = (att.get("updated_at") or att.get("created_at") or "")[:19]
    try:
        dt = datetime.fromisoformat(raw).astimezone(timezone.utc)
    except ValueError:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def same_time(a: str, b: str) -> bool:
    """Zwei ISO-Zeitstempel auf die Sekunde vergleichen (Editoren schreiben Bruchteile unterschiedlich)."""
    def norm(v: str) -> str:
        return re.sub(r"(\.\d+)?(Z|[+-]\d\d:?\d\d)?$", "", (v or "").strip())[:19]

    return bool(a and b) and norm(a) == norm(b)


# ----------------------------------------------------------------------------- API
class OfficeConfIn(BaseModel):
    enabled: Optional[bool] = None
    url: Optional[str] = Field(None, max_length=300)
    cockpit_url: Optional[str] = Field(None, max_length=300)
    allowed_ips: Optional[list[str]] = Field(None, max_length=20)


class NewFileIn(BaseModel):
    ref_type: str = Field("library", pattern="^(customer|library)$")
    ref_id: int = 0
    kind: str = Field("text", pattern="^(text|table|letter)$")
    name: str = Field("", max_length=120)


class FromTemplateIn(BaseModel):
    customer_id: int
    name: str = Field("", max_length=120)


class FilePatchIn(BaseModel):
    filename: Optional[str] = Field(None, min_length=1, max_length=150)
    template: Optional[bool] = None
    customer_visible: Optional[bool] = None


def register(app: FastAPI, ctx: Any, settings: Any, admin_only) -> Office:
    db: Database = ctx.db
    store: Store = app.state.attachments
    svc = Office(db, store, settings)
    app.state.office = svc
    company = getattr(settings, "company_name", "ME-IT")

    def user_of(request: Request) -> dict[str, Any] | None:
        u = getattr(request.state, "user", None)
        return u if isinstance(u, dict) else None

    def need_file(aid: int) -> dict[str, Any]:
        a = db.get("attachments", aid)
        if not a:
            raise HTTPException(404, "Datei nicht gefunden")
        return a

    def check_ref(ref_type: str, ref_id: int) -> None:
        if ref_type == "customer" and not db.get("customers", ref_id):
            raise HTTPException(404, "Kunde nicht gefunden")

    # --- Einstellungen ---------------------------------------------------------------------------
    def status() -> dict[str, Any]:
        conf = svc.conf()
        out: dict[str, Any] = {**conf, "product": "", "editable": [], "viewable": [], "error": "", "placeholders": PLACEHOLDERS}
        if conf["url"]:
            try:
                d = svc.discovery()
                out.update({"product": d["product"], "editable": d["editable"], "viewable": d["viewable"]})
            except OfficeError as exc:
                out["error"] = str(exc)
        return out

    @app.get("/api/office/settings")
    def get_settings() -> dict:
        return status()

    @app.put("/api/office/settings", dependencies=[Depends(admin_only)])
    def put_settings(data: OfficeConfIn) -> dict:
        try:
            svc.save_conf(data.model_dump(exclude_none=True))
        except OfficeError as exc:
            raise HTTPException(422, str(exc))
        return status()

    @app.post("/api/office/test", dependencies=[Depends(admin_only)])
    def test(request: Request) -> dict:
        try:
            d = svc.discovery(force=True)
        except OfficeError as exc:
            raise HTTPException(502, str(exc))
        base = svc.cockpit_url(str(request.base_url))
        conf = svc.conf()
        hints = []
        if conf["url"].startswith("https://") and base.startswith("http://"):
            hints.append("Der Office-Server läuft unter https, das Cockpit unter http – im Browser wird der Editor dann meist blockiert.")
        if urlparse(base).hostname in ("localhost", "127.0.0.1"):
            hints.append("Die Cockpit-Adresse ist „localhost“ – der Office-Server erreicht sie nur, wenn er auf demselben Rechner läuft "
                         "(nicht aus einem Docker-Container). Sonst „Adresse des Cockpits“ eintragen.")
        if not conf["allowed_ips"]:
            hints.append("Tipp: die Adresse des Office-Servers unter „Erlaubte Adressen“ eintragen – dann nimmt das Cockpit "
                         "Dateizugriffe nur von dort an.")
        return {"product": d["product"], "editable": d["editable"], "types": len(d["viewable"]), "cockpit_url": base, "hints": hints}

    # --- Dateien ---------------------------------------------------------------------------------
    @app.get("/api/files")
    def list_files(ref_type: str = "library", ref_id: int = 0) -> dict:
        if ref_type not in REF_TYPES:
            raise HTTPException(422, "Unbekannte Ablage")
        return {"files": svc.files(ref_type, ref_id), "office": svc.conf()["enabled"]}

    @app.post("/api/files/upload", status_code=201)
    async def upload(request: Request, ref_type: str = "library", ref_id: int = 0) -> dict:
        from urllib.parse import unquote

        if ref_type not in ("customer", "library"):
            raise HTTPException(422, "Unbekannte Ablage")
        check_ref(ref_type, ref_id)
        data = await request.body()
        try:
            a = store.save(ref_type, ref_id if ref_type == "customer" else 0, unquote(request.headers.get("x-filename", "datei"))[:200],
                           data, source="team", visible=False)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return svc.file_view(a)

    @app.post("/api/files/new", status_code=201)
    def new_file(data: NewFileIn) -> dict:
        check_ref(data.ref_type, data.ref_id)
        customer = db.get("customers", data.ref_id) if data.ref_type == "customer" else None
        label = {"text": "Dokument", "table": "Tabelle", "letter": "Brief"}[data.kind]
        name = (data.name.strip() or f"{label} {date.today().strftime('%Y-%m-%d')}")
        ext = "xlsx" if data.kind == "table" else "docx"
        if not name.lower().endswith(f".{ext}"):
            name += f".{ext}"
        content = (new_xlsx() if data.kind == "table" else
                   letter_docx(company_profile(db, company), customer) if data.kind == "letter" else new_docx())
        try:
            a = store.save(data.ref_type, data.ref_id if data.ref_type == "customer" else 0, name, content, source="team", visible=False)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return svc.file_view(a)

    @app.post("/api/files/{aid}/from-template", status_code=201)
    def from_template(aid: int, data: FromTemplateIn) -> dict:
        tpl = need_file(aid)
        customer = db.get("customers", data.customer_id)
        if not customer:
            raise HTTPException(404, "Kunde nicht gefunden")
        try:
            content, replaced = fill_template(store.read(tpl), template_values(db, company, customer))
        except (OfficeError, ValueError) as exc:
            raise HTTPException(422, str(exc))
        ext = ext_of(tpl["filename"])
        base = data.name.strip() or f"{tpl['filename'].rsplit('.', 1)[0]} – {customer['name']}"
        name = base if base.lower().endswith(f".{ext}") else f"{base}.{ext}"
        a = store.save("customer", customer["id"], name, content, source="team", visible=False)
        return {**svc.file_view(a), "replaced": replaced}

    @app.get("/api/files/{aid}")
    def one_file(aid: int) -> dict:
        return svc.file_view(need_file(aid))

    @app.put("/api/files/{aid}")
    def patch_file(aid: int, data: FilePatchIn) -> dict:
        a = need_file(aid)
        patch: dict[str, Any] = {}
        if data.filename is not None:
            from .attachments import BLOCKED, _safe_name

            name = _safe_name(data.filename)
            if ext_of(name) != ext_of(a["filename"]):
                name = f"{name}.{ext_of(a['filename'])}" if ext_of(a["filename"]) else name
            if name.lower().endswith(BLOCKED):
                raise HTTPException(422, "Dieser Dateiname ist nicht erlaubt")
            patch["filename"] = name
        if data.template is not None:
            patch["template"] = data.template
        if data.customer_visible is not None:
            patch["customer_visible"] = data.customer_visible
        if patch:
            db.update("attachments", aid, patch)
        return svc.file_view(db.get("attachments", aid))

    @app.get("/api/files/{aid}/versions")
    def versions(aid: int) -> list[dict]:
        need_file(aid)
        return db.query("SELECT id, size, author, created_at FROM file_versions WHERE attachment_id = ? ORDER BY id DESC", (aid,))

    def version_bytes(aid: int, vid: int) -> bytes:
        v = db.query_one("SELECT * FROM file_versions WHERE id = ? AND attachment_id = ?", (vid, aid))
        if not v:
            raise HTTPException(404, "Version nicht gefunden")
        try:
            data = (store.root / v["path"]).resolve()
            if not data.is_relative_to(store.root.resolve()):
                raise ValueError
            return data.read_bytes()
        except (OSError, ValueError):
            raise HTTPException(404, "Die Datei dieser Version ist nicht mehr vorhanden")

    @app.get("/api/files/{aid}/versions/{vid}/download")
    def version_download(aid: int, vid: int) -> Response:
        from urllib.parse import quote

        a = need_file(aid)
        stem, _, ext = a["filename"].rpartition(".")
        name = f"{stem or a['filename']} (Version {vid}){'.' + ext if stem else ''}"
        return Response(version_bytes(aid, vid), media_type="application/octet-stream",
                        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}", "X-Content-Type-Options": "nosniff"})

    @app.post("/api/files/{aid}/versions/{vid}/restore")
    def restore(aid: int, vid: int, request: Request) -> dict:
        a = need_file(aid)
        content = version_bytes(aid, vid)
        if svc.current_lock(aid):
            raise HTTPException(409, "Die Datei ist gerade im Editor geöffnet – bitte zuerst schließen.")
        u = user_of(request)
        return svc.file_view(store.replace(a, content, author=f"{(u or {}).get('name') or 'Cockpit'} (wiederhergestellt)",
                                           version_gap_min=0))

    @app.post("/api/office/open/{aid}")
    def open_file(aid: int, request: Request, view: bool = False) -> dict:
        a = need_file(aid)
        try:
            return svc.open(a, user_of(request), str(request.base_url), write=not view)
        except OfficeError as exc:
            raise HTTPException(409, str(exc))

    # --- WOPI (ruft der Office-Server auf; Anmeldung ausschließlich über das Zugriffstoken) --------------
    def wopi_auth(request: Request, fid: int) -> tuple[dict[str, Any], dict[str, Any]]:
        token = request.query_params.get("access_token", "")
        if not token:
            auth = request.headers.get("authorization", "")
            token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        try:
            return svc.session(token, fid, request.client.host if request.client else "")
        except PermissionError as exc:
            raise HTTPException(401, str(exc))

    def conflict(lock: str, reason: str = "") -> Response:
        # Kopfzeilen müssen reines ASCII sein (Sperr-Kennungen kommen vom Office-Server und sind es ohnehin)
        clean = lambda v: v.encode("ascii", "ignore").decode()[:1024]
        return Response(status_code=409, headers={"X-WOPI-Lock": clean(lock), "X-WOPI-LockFailureReason": clean(reason)})

    @app.get("/wopi/files/{fid}", include_in_schema=False)
    def check_file_info(fid: int, request: Request) -> dict:
        sess, a = wopi_auth(request, fid)
        return {
            "BaseFileName": a["filename"], "Size": a["size"], "Version": a["sha256"][:16] or "0", "OwnerId": "cockpit",
            "UserId": str(sess["user_id"] or 0), "UserFriendlyName": sess["user_name"], "UserCanWrite": bool(sess["can_write"]),
            "ReadOnly": not sess["can_write"], "SupportsUpdate": True, "SupportsLocks": True, "SupportsGetLock": True,
            "SupportsExtendedLockLength": True, "SupportsRename": False, "UserCanNotWriteRelative": True, "UserCanRename": False,
            "LastModifiedTime": last_modified(a), "PostMessageOrigin": svc.cockpit_url(str(request.base_url)),
            "SHA256": "",
        }

    @app.get("/wopi/files/{fid}/contents", include_in_schema=False)
    def get_file(fid: int, request: Request) -> Response:
        _, a = wopi_auth(request, fid)
        try:
            data = store.read(a)
        except ValueError:
            raise HTTPException(404, "Datei nicht gefunden")
        return Response(data, media_type="application/octet-stream", headers={"X-WOPI-ItemVersion": a["sha256"][:16]})

    @app.post("/wopi/files/{fid}/contents", include_in_schema=False)
    async def put_file(fid: int, request: Request) -> Response:
        sess, a = wopi_auth(request, fid)
        if not sess["can_write"]:
            raise HTTPException(401, "Nur Lesezugriff")
        lock = svc.current_lock(fid)
        given = request.headers.get("x-wopi-lock", "")
        if lock and given != lock:
            return conflict(lock, "File is locked by another session")
        # Collabora: Zeitstempel des geladenen Stands – weicht er ab, wurde die Datei zwischenzeitlich geändert
        stamp = request.headers.get("x-cool-wopi-timestamp") or request.headers.get("x-lool-wopi-timestamp") or ""
        if stamp and not same_time(stamp, last_modified(a)):
            return JSONResponse({"COOLStatusCode": 1010, "LOOLStatusCode": 1010}, status_code=409)
        data = await request.body()
        if len(data) > MAX_SIZE:
            raise HTTPException(413, "Datei zu groß (max. 20 MB)")
        try:
            a = store.replace(a, data, author=sess["user_name"])
        except ValueError as exc:
            raise HTTPException(413, str(exc))
        return JSONResponse({"LastModifiedTime": last_modified(a)}, headers={"X-WOPI-ItemVersion": a["sha256"][:16]})

    @app.post("/wopi/files/{fid}", include_in_schema=False)
    def file_operation(fid: int, request: Request) -> Response:
        sess, _ = wopi_auth(request, fid)
        op = (request.headers.get("x-wopi-override") or "").upper()
        given, old = request.headers.get("x-wopi-lock", ""), request.headers.get("x-wopi-oldlock", "")
        lock = svc.current_lock(fid)
        if op == "GET_LOCK":
            return Response(status_code=200, headers={"X-WOPI-Lock": lock})
        if op in ("LOCK", "REFRESH_LOCK", "UNLOCK") and not sess["can_write"]:
            raise HTTPException(401, "Nur Lesezugriff")
        if op == "LOCK":
            if old:  # UnlockAndRelock
                if lock != old:
                    return conflict(lock, "Lock mismatch")
            elif lock and lock != given:
                return conflict(lock, "File is already locked")
            if not given:
                raise HTTPException(400, "X-WOPI-Lock fehlt")
            svc.set_lock(fid, given)
            return Response(status_code=200)
        if op == "REFRESH_LOCK":
            if not lock or lock != given:
                return conflict(lock, "Lock mismatch")
            svc.set_lock(fid, given)
            return Response(status_code=200)
        if op == "UNLOCK":
            if lock != given:
                return conflict(lock, "Lock mismatch")
            db.query("DELETE FROM office_locks WHERE attachment_id = ?", (fid,))
            return Response(status_code=200)
        return Response(status_code=501)  # PUT_RELATIVE, RENAME_FILE usw. werden bewusst nicht angeboten

    return svc
