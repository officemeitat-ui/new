"""Globale Suche über das ganze Cockpit – auch im Inhalt abgelegter Dateien.

Eine Eingabe, alle Bereiche: Kunden, Tickets, Nachrichten, Geräte, Wissen, Dateien, Dokumente, Rechnungen,
Angebote, Leads, Lizenzen, Kontakte, Microsoft-365-Benutzer, Domains, Ein-/Austritte, Belege.

- Groß-/Kleinschreibung und Umlaute spielen keine Rolle („muller“ findet „Müller“, „strasse“ findet „Straße“).
- Mehrere Wörter müssen alle vorkommen; es wird auch mitten im Wort gesucht („vertrag“ findet „Wartungsvertrag“).
- Dateien werden beim Ablegen und Speichern ausgelesen (Word, Excel, PowerPoint, OpenDocument, PDF, Text).
"""

from __future__ import annotations

import html
import io
import re
import threading
import time
import zipfile
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request

from .db import Database, fold

MAX_TEXT = 200_000  # Zeichen je Datei im Suchindex
MAX_PART = 8 * 1024 * 1024  # entpackte Größe je Teil eines Office-Dokuments
MAX_PARTS = 400
TEXT_EXT = {"txt", "md", "csv", "log", "json", "xml", "ini", "cfg", "conf", "yml", "yaml", "html", "htm"}

_BREAK = re.compile(r"</(?:w:p|a:p|text:p|text:h|si|row|table:table-row|p|div|tr|li|h\d)>|<(?:w:br|w:tab|text:line-break|text:tab|br)\b[^>]*>", re.I)
_CELL = re.compile(r"</(?:c|t|table:table-cell|td|th)>", re.I)
_TAG = re.compile(r"<[^>]*>")
_SPACE = re.compile(r"[ \t\r\f\v]+")
_LINES = re.compile(r"\s*\n\s*")


def strip_markup(xml: str) -> str:
    """Text aus XML/HTML – ohne XML-Parser (keine Entitäten, keine Überraschungen bei kaputten Dateien)."""
    text = _BREAK.sub("\n", xml)
    text = _CELL.sub(" ", text)
    text = html.unescape(_TAG.sub("", text))
    return _LINES.sub("\n", _SPACE.sub(" ", text)).strip()


def _zip_parts(data: bytes, wanted) -> list[str]:
    out: list[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = sorted(n for n in z.namelist() if wanted(n))[:MAX_PARTS]
            total = 0
            for name in names:
                with z.open(name) as f:
                    raw = f.read(MAX_PART + 1)[:MAX_PART]  # begrenzt lesen – schützt vor „Zip-Bomben“
                total += len(raw)
                out.append(raw.decode("utf-8", "ignore"))
                if total > 5 * MAX_PART:
                    break
    except (zipfile.BadZipFile, OSError, KeyError, RuntimeError, ValueError):
        return []
    return out


def extract_text(data: bytes, filename: str) -> str:
    """Lesbaren Text einer Datei für die Suche gewinnen. Unbekannte oder defekte Dateien ergeben „“."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    text = ""
    try:
        if ext in ("docx", "docm", "dotx"):
            parts = _zip_parts(data, lambda n: re.match(r"word/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$", n))
            text = "\n".join(strip_markup(p) for p in parts)
        elif ext in ("xlsx", "xlsm", "xltx"):
            parts = _zip_parts(data, lambda n: n in ("xl/sharedStrings.xml", "xl/workbook.xml") or re.match(r"xl/worksheets/sheet\d+\.xml$", n))
            chunks = []
            for p in parts:
                if "<sst" in p[:2000] or "<si>" in p:
                    chunks.append(strip_markup(p))
                else:  # Tabellenblätter: nur direkt eingetragene Texte und Blattnamen, keine Zahlenkolonnen
                    chunks += [html.unescape(m) for m in re.findall(r"<is>\s*<t[^>]*>([^<]*)</t>", p)]
                    chunks += [html.unescape(m) for m in re.findall(r'<sheet\b[^>]*\bname="([^"]*)"', p)]
            text = "\n".join(c for c in chunks if c)
        elif ext in ("pptx", "ppsx", "potx"):
            parts = _zip_parts(data, lambda n: re.match(r"ppt/(slides/slide\d+|notesSlides/notesSlide\d+)\.xml$", n))
            text = "\n".join(strip_markup(p) for p in parts)
        elif ext in ("odt", "ods", "odp", "ott", "ots"):
            text = "\n".join(strip_markup(p) for p in _zip_parts(data, lambda n: n == "content.xml"))
        elif ext == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            pages = []
            for page in reader.pages[:80]:
                pages.append(page.extract_text() or "")
                if sum(len(p) for p in pages) > MAX_TEXT:
                    break
            text = "\n".join(pages)
        elif ext in TEXT_EXT:
            raw = data[: MAX_TEXT * 4].decode("utf-8", "ignore")
            text = strip_markup(raw) if ext in ("xml", "html", "htm") else raw
    except Exception:  # noqa: BLE001 - eine defekte Datei darf die Suche nie stören
        text = ""
    return _LINES.sub("\n", _SPACE.sub(" ", text.replace("\x00", " "))).strip()[:MAX_TEXT]


@dataclass(frozen=True)
class Source:
    type: str
    label: str
    table: str  # FROM-Teil, Hauptzeile heißt „t“
    fields: tuple[str, ...]  # durchsuchte Spalten
    title: str
    subtitle: str = "''"
    customer: str = "t.customer_id"
    order: str = "t.id DESC"
    where: str = ""


_C = " LEFT JOIN customers c ON c.id = t.customer_id"
SOURCES: tuple[Source, ...] = (
    Source("customer", "Kunden", "customers t", ("t.name", "t.contact_name", "t.email", "t.phone", "t.address", "t.industry", "t.notes"),
           "t.name", "trim(coalesce(t.contact_name,'') || ' · ' || coalesce(t.email,''), ' ·')", "t.id", "t.name"),
    Source("ticket", "Tickets", "tickets t" + _C, ("'#' || t.id", "t.title", "t.description", "t.solution", "c.name"),
           "'#' || t.id || ' ' || t.title", "coalesce(c.name,'') || ' · ' || t.status"),
    Source("message", "Nachrichten", "messages t" + _C, ("t.subject", "t.body", "t.from_name", "t.from_email", "t.company", "t.note"),
           "coalesce(nullif(t.subject,''), '(ohne Betreff)')",
           "coalesce(nullif(t.from_name,''), nullif(t.from_email,''), nullif(t.to_email,''), '') || ' · ' || substr(t.created_at, 1, 10)"),
    Source("asset", "Geräte", "assets t" + _C, ("t.name", "t.type", "t.os", "t.serial", "t.notes", "c.name"),
           "t.name", "coalesce(c.name,'') || ' · ' || coalesce(t.type,'') || ' ' || coalesce(t.os,'')"),
    Source("device", "Geräte-Check", "agent_devices t" + _C, ("t.hostname", "t.serial", "t.last_ip", "c.name"),
           "t.hostname", "coalesce(c.name,'') || ' · zuletzt ' || substr(coalesce(t.last_seen,''), 1, 10)", where="t.active = 1"),
    Source("article", "Wissen", "kb_articles t", ("t.title", "t.content", "t.tags"), "t.title", "coalesce(t.tags,'')", "NULL"),
    Source("document", "Dokumente", "documents t" + _C, ("t.title", "t.filename", "t.kind", "c.name"),
           "t.title", "coalesce(c.name,'') || ' · ' || t.kind || ' · ' || substr(t.created_at, 1, 10)"),
    Source("invoice", "Rechnungen", "invoices t", ("t.number", "t.customer_name", "t.period", "t.note"),
           "'Rechnung ' || coalesce(nullif(t.number,''), 'Entwurf') || ' – ' || t.customer_name",
           "t.period || ' · ' || t.status || ' · ' || printf('%.2f €', t.gross)"),
    Source("quote", "Angebote", "quotes t" + _C, ("t.title", "t.need", "t.text", "c.name"), "t.title", "coalesce(c.name,'') || ' · ' || t.status"),
    Source("lead", "Leads", "leads t", ("t.name", "t.company", "t.email", "t.phone", "t.need", "t.notes"),
           "trim(coalesce(t.company,'') || ' – ' || coalesce(t.name,''), ' –')", "t.stage || ' · ' || coalesce(t.email,'')"),
    Source("subscription", "Lizenzen & Verträge", "subscriptions t" + _C, ("t.name", "t.vendor", "t.notes", "c.name"),
           "t.name", "coalesce(c.name,'') || ' · ' || coalesce(t.vendor,'')"),
    Source("contact", "Kontakte (Portal)", "portal_users t" + _C, ("t.name", "t.email", "c.name"),
           "coalesce(nullif(t.name,''), t.email)", "coalesce(c.name,'') || ' · ' || t.email"),
    Source("m365user", "Microsoft-365-Benutzer", "m365_users t" + _C, ("t.display_name", "t.upn", "t.department", "t.job_title"),
           "coalesce(nullif(t.display_name,''), t.upn)", "coalesce(c.name,'') || ' · ' || t.upn"),
    Source("domain", "Domains", "domain_checks t" + _C, ("t.domain", "c.name"), "t.domain", "coalesce(c.name,'')"),
    Source("staff", "Ein- & Austritte", "staff_changes t" + _C, ("t.person", "t.email", "t.details", "c.name"),
           "t.person", "coalesce(c.name,'') || ' · ' || t.kind || ' · ' || t.status"),
    Source("appointment", "Termine", "appointments t" + _C, ("t.title", "t.location", "t.notes", "t.customer_note", "c.name"),
           "substr(t.start_at, 9, 2) || '.' || substr(t.start_at, 6, 2) || '.' || substr(t.start_at, 1, 4) || ' ' || substr(t.start_at, 12, 5) || ' ' || t.title",
           "coalesce(c.name,'') || ' · ' || t.status", order="t.start_at DESC"),
    Source("workreport", "Arbeitsberichte", "work_reports t" + _C, ("t.number", "t.work", "t.remark", "t.materials", "t.signer_name", "c.name"),
           "'Arbeitsbericht ' || t.number", "coalesce(c.name,'') || ' · ' || t.date", where="t.status != 'entwurf'"),
    Source("monitor", "Überwachung", "monitors t" + _C, ("t.name", "t.target", "c.name"), "t.name",
           "coalesce(c.name,'') || ' · ' || t.target"),
    Source("project", "Projekte", "projects t" + _C, ("t.title", "t.description", "c.name"), "t.title",
           "coalesce(c.name,'') || ' · ' || t.status"),
    Source("person", "Ansprechpartner", "contacts t" + _C, ("t.name", "t.email", "t.phone", "t.job_title", "c.name"), "t.name",
           "coalesce(c.name,'') || ' · ' || trim(coalesce(t.job_title,'') || ' ' || coalesce(t.email,'') || ' ' || coalesce(t.phone,''))"),
    Source("receipt", "Belege", "receipts t", ("t.vendor", "t.invoice_no", "t.note"),
           "coalesce(nullif(t.vendor,''), 'Beleg') || ' ' || coalesce(t.invoice_no,'')", "coalesce(t.invoice_date,'') || ' · ' || t.status", "NULL"),
)
FILE_LABEL = "Dateien"
TYPES = {s.type: s.label for s in SOURCES} | {"file": FILE_LABEL}


def like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def terms_of(query: str) -> list[str]:
    """Suchwörter (zusammengefaltet, höchstens 6) – ein einzelnes Zeichen sucht nichts."""
    out: list[str] = []
    for raw in fold(query).split():
        if raw not in out and (len(raw) > 1 or raw.isdigit()):
            out.append(raw[:60])
    return out[:6]


def snippet(text: str, terms: list[str], width: int = 150) -> str:
    """Ausschnitt um den ersten Treffer (für die Ergebnisliste)."""
    flat = _SPACE.sub(" ", (text or "").replace("\n", " ")).strip()
    if not flat:
        return ""
    low = flat.lower()
    pos = min((p for p in (low.find(t) for t in terms) if p >= 0), default=-1)
    if pos < 0:  # Treffer nur über Umlaut-Faltung: Position im gefalteten Text suchen (Längen weichen kaum ab)
        folded = fold(flat)
        pos = min((p for p in (folded.find(t) for t in terms) if p >= 0), default=0)
    start = max(0, pos - width // 3)
    cut = flat[start:start + width]
    return ("… " if start else "") + cut.strip() + (" …" if start + width < len(flat) else "")


class Search:
    def __init__(self, db: Database, store: Any):
        self.db, self.store = db, store
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None

    # -- Dateiinhalte
    def pending(self) -> int:
        return self.db.scalar("SELECT COUNT(*) FROM attachments a LEFT JOIN file_texts t ON t.attachment_id = a.id "
                              "WHERE t.attachment_id IS NULL OR t.sha256 != a.sha256") or 0

    def sync(self, limit: int = 40, budget_s: float = 1.5) -> int:
        """Neue und geänderte Dateien auslesen. Rückgabe: Anzahl, die noch aussteht."""
        if not self._lock.acquire(blocking=False):
            return self.pending()
        try:
            started = time.monotonic()
            rows = self.db.query("SELECT a.* FROM attachments a LEFT JOIN file_texts t ON t.attachment_id = a.id "
                                 "WHERE t.attachment_id IS NULL OR t.sha256 != a.sha256 ORDER BY a.id DESC LIMIT ?", (limit,))
            for a in rows:
                try:
                    text = extract_text(self.store.read(a), a["filename"])
                except Exception:  # noqa: BLE001 - fehlende Datei: als „ohne Text“ merken, nicht endlos neu versuchen
                    text = ""
                with self.db.connect() as conn:
                    conn.execute("INSERT INTO file_texts (attachment_id, sha256, chars, content, folded) VALUES (?, ?, ?, ?, ?) "
                                 "ON CONFLICT(attachment_id) DO UPDATE SET sha256 = excluded.sha256, chars = excluded.chars, "
                                 "content = excluded.content, folded = excluded.folded",
                                 (a["id"], a["sha256"], len(text), text, fold(text)))
                if time.monotonic() - started > budget_s:
                    break
            return self.pending()
        finally:
            self._lock.release()

    def sync_in_background(self) -> None:
        """Rest im Hintergrund auslesen (z. B. nach dem ersten Start mit vielen vorhandenen Dateien)."""
        if self._worker and self._worker.is_alive():
            return

        def run() -> None:
            for _ in range(2000):
                try:
                    if not self.sync(limit=25, budget_s=5):
                        return
                except Exception:  # noqa: BLE001
                    return
                time.sleep(0.2)

        self._worker = threading.Thread(target=run, name="search-index", daemon=True)
        self._worker.start()

    # -- Suche
    def _source(self, s: Source, terms: list[str], whole: str, limit: int) -> list[dict[str, Any]]:
        concat = " || ' ' || ".join(f"coalesce({f}, '')" for f in s.fields)
        conds = [f"fold({concat}) LIKE ? ESCAPE '\\'" for _ in terms]
        if s.where:
            conds.insert(0, s.where)
        sql = (f"SELECT t.id AS id, {s.title} AS title, {s.subtitle} AS subtitle, {s.customer} AS customer_id, "
               f"substr({concat}, 1, 4000) AS body FROM {s.table} WHERE {' AND '.join(conds)} "
               f"ORDER BY CASE WHEN fold({s.title}) LIKE ? ESCAPE '\\' THEN 0 WHEN fold({s.title}) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, "
               f"{s.order} LIMIT ?")
        params = [like(t) for t in terms] + [like(whole)[1:], like(whole), limit]
        out = []
        for r in self.db.query(sql, params):
            title, subtitle = (r["title"] or "").strip(), (r["subtitle"] or "").strip(" ·")
            visible = all(t in fold(f"{title} {subtitle}") for t in terms)  # Treffer schon in Titel/Untertitel sichtbar → kein Ausschnitt
            out.append({"type": s.type, "id": r["id"], "title": title[:160], "subtitle": subtitle[:160],
                        "customer_id": r["customer_id"], "snippet": "" if visible else snippet(r["body"], terms)})
        return out

    def _files(self, terms: list[str], whole: str, limit: int) -> list[dict[str, Any]]:
        conds = " AND ".join("(fold(a.filename) LIKE ? ESCAPE '\\' OR t.folded LIKE ? ESCAPE '\\')" for _ in terms)
        params: list[Any] = []
        for t in terms:
            params += [like(t), like(t)]
        rows = self.db.query(
            "SELECT a.id, a.filename, a.ref_type, a.ref_id, a.size, a.updated_at, a.created_at, coalesce(t.content, '') AS content, "
            "c.name AS customer, k.customer_id AS ticket_customer FROM attachments a LEFT JOIN file_texts t ON t.attachment_id = a.id "
            "LEFT JOIN customers c ON a.ref_type = 'customer' AND c.id = a.ref_id "
            "LEFT JOIN tickets k ON a.ref_type = 'ticket' AND k.id = a.ref_id "
            f"WHERE {conds} ORDER BY CASE WHEN fold(a.filename) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, a.id DESC LIMIT ?",
            params + [like(whole), limit])
        out = []
        for r in rows:
            where = (f"Kunde {r['customer']}" if r["ref_type"] == "customer" and r["customer"] else
                     "Eigene Ablage" if r["ref_type"] == "library" else
                     f"Ticket #{r['ref_id']}" if r["ref_type"] == "ticket" else "E-Mail-Anhang" if r["ref_type"] == "message" else r["ref_type"])
            in_name = all(t in fold(f"{r['filename']} {where}") for t in terms)
            out.append({"type": "file", "id": r["id"], "title": r["filename"], "subtitle": f"{where} · {(r['updated_at'] or r['created_at'])[:10]}",
                        "customer_id": r["ref_id"] if r["ref_type"] == "customer" else r["ticket_customer"],
                        "ref_type": r["ref_type"], "ref_id": r["ref_id"],
                        "snippet": "" if in_name else snippet(r["content"], terms)})
        return out

    def search(self, query: str, limit: int = 6, only: str = "") -> dict[str, Any]:
        started = time.monotonic()
        terms = terms_of(query)
        if not terms:
            return {"query": query, "groups": [], "total": 0, "took_ms": 0, "pending": 0}
        whole = " ".join(terms)
        if self.sync(limit=20, budget_s=1.0):
            self.sync_in_background()
        per = min(max(limit, 1), 50)
        groups = []
        for s in SOURCES:
            if only and only != s.type:
                continue
            items = self._source(s, terms, whole, per + 1)
            if items:
                groups.append({"type": s.type, "label": s.label, "items": items[:per], "more": len(items) > per})
        if not only or only == "file":
            items = self._files(terms, whole, per + 1)
            if items:
                groups.insert(min(len(groups), 2), {"type": "file", "label": FILE_LABEL, "items": items[:per], "more": len(items) > per})
        # Ticketnummer direkt eingegeben („#12“ oder „12“): genau dieses Ticket zuerst
        m = re.fullmatch(r"#?(\d{1,7})", query.strip())
        if m:
            for g in groups:
                if g["type"] == "ticket":
                    g["items"].sort(key=lambda it: it["id"] != int(m.group(1)))
            groups.sort(key=lambda g: g["type"] != "ticket")
        return {"query": query, "groups": groups, "total": sum(len(g["items"]) for g in groups),
                "took_ms": int((time.monotonic() - started) * 1000), "pending": self.pending()}


def register(app: FastAPI, ctx: Any, admin_only, start: bool = False) -> Search:
    db: Database = ctx.db
    svc = Search(db, app.state.attachments)
    app.state.search = svc

    @app.get("/api/search")
    def search(q: str = "", limit: int = 6, type: str = "") -> dict:  # noqa: A002 - Name ist Teil der Adresse
        if type and type not in TYPES:
            raise HTTPException(422, "Unbekannter Bereich")
        return svc.search(q[:200], limit, type)

    @app.get("/api/search/status")
    def status() -> dict:
        return {"files": db.scalar("SELECT COUNT(*) FROM file_texts") or 0,
                "with_text": db.scalar("SELECT COUNT(*) FROM file_texts WHERE chars > 0") or 0, "pending": svc.pending(), "types": TYPES}

    @app.post("/api/search/reindex", dependencies=[Depends(admin_only)])
    def reindex(request: Request) -> dict:
        db.query("DELETE FROM file_texts")
        remaining = svc.sync(limit=40, budget_s=2.0)
        if remaining:
            svc.sync_in_background()
        return {"pending": remaining}

    if start:
        svc.sync_in_background()
    return svc
