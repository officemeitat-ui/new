"""Hilfe-Bibliothek: einige hundert fertige Anleitungen für den IT-Alltag, die mit dem Cockpit ausgeliefert werden.

Die Artikel liegen als Textdateien in ``meit/kb/`` (Format: ``meit/kb/FORMAT.md``) und werden in die Wissensdatenbank
eingelesen. Regeln beim Einlesen und Aktualisieren:

- Neue Artikel werden angelegt, geänderte aktualisiert.
- **Selbst angepasste Artikel bleiben, wie sie sind** – eine neue Fassung aus der Bibliothek überschreibt sie nicht.
- **Gelöschte Artikel kommen nicht wieder.**
- Artikel für Anwender (``zielgruppe: kunde``) sind für die Hilfe im Kundenportal freigegeben, Technik-Artikel nicht.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException

from .db import Database, fold, now_iso

LIB_DIR = Path(__file__).parent / "kb"
HEAD = re.compile(r"^=== ARTIKEL[ \t]*$", re.M)
AUDIENCES = ("kunde", "technik")
SOURCE = "bibliothek"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(text)).strip("-")[:80]


def content_hash(title: str, tags: str, content: str) -> str:
    return hashlib.sha256(f"{title}\n{tags}\n{content}".encode()).hexdigest()[:20]


def parse(text: str, source: str = "") -> tuple[list[dict[str, Any]], list[str]]:
    """Eine Bibliotheksdatei lesen. Rückgabe: (Artikel, Hinweise auf fehlerhafte Einträge)."""
    articles, problems = [], []
    for n, block in enumerate(HEAD.split(text.replace("\r\n", "\n"))[1:], 1):
        head, sep, body = block.strip("\n").partition("\n---")
        meta = {}
        for line in head.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip().lower()] = value.strip()
        body = body.lstrip("-").strip()
        title, area, audience = meta.get("titel", ""), meta.get("bereich", ""), meta.get("zielgruppe", "").lower()
        where = f"{source} Artikel {n}".strip()
        if not sep or not title or not area:
            problems.append(f"{where}: Kopf unvollständig (titel/bereich/Trennzeile fehlt)")
            continue
        if audience not in AUDIENCES:
            problems.append(f"{where} „{title}“: zielgruppe muss kunde oder technik sein")
            continue
        if len(body) < 200:
            problems.append(f"{where} „{title}“: Inhalt zu kurz")
            continue
        tags = ", ".join(t.strip().lower() for t in meta.get("tags", "").split(",") if t.strip())
        articles.append({"title": title[:200], "area": area[:80], "tags": tags[:300], "audience": audience, "content": body})
    return articles, problems


def load(directory: Path = LIB_DIR) -> tuple[list[dict[str, Any]], list[str]]:
    articles, problems, seen = [], [], set()
    for path in sorted(directory.glob("*.md")):
        if path.name.upper() == "FORMAT.MD":
            continue
        found, issues = parse(path.read_text(encoding="utf-8"), path.name)
        problems += issues
        for a in found:
            slug = slugify(a["title"])
            if not slug or slug in seen:
                problems.append(f"{path.name} „{a['title']}“: Titel doppelt")
                continue
            seen.add(slug)
            articles.append({**a, "external_id": f"lib:{slug}"})
    return articles, problems


def import_library(db: Database, articles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Bibliothek einlesen bzw. aktualisieren – in einem Durchgang, eigene Änderungen und Löschungen bleiben erhalten."""
    problems: list[str] = []
    if articles is None:
        articles, problems = load()
    hashes: dict[str, str] = dict(db.get_setting("kb_library_hashes", {}) or {})
    created = updated = unchanged = kept_modified = kept_deleted = 0
    now = now_iso()
    with db.connect() as conn:
        existing = {r["external_id"]: dict(r) for r in conn.execute(
            "SELECT id, external_id, title, tags, content FROM kb_articles WHERE source = ?", (SOURCE,))}
        for a in articles:
            ext, new_hash = a["external_id"], content_hash(a["title"], a["tags"], a["content"])
            row = existing.get(ext)
            if row is None:
                if ext in hashes:  # war schon einmal da und wurde gelöscht
                    kept_deleted += 1
                    continue
                conn.execute("INSERT INTO kb_articles (title, content, tags, area, public, source, external_id, embedding, embedding_model, "
                             "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)",
                             (a["title"], a["content"], a["tags"], a["area"], 1 if a["audience"] == "kunde" else 0, SOURCE, ext, now, now))
                created += 1
            else:
                current = content_hash(row["title"], row["tags"], row["content"])
                if current == new_hash:
                    unchanged += 1
                elif current == hashes.get(ext):  # seit dem letzten Einlesen nicht angefasst → neue Fassung übernehmen
                    conn.execute("UPDATE kb_articles SET title = ?, content = ?, tags = ?, area = ?, embedding = '', embedding_model = '', "
                                 "updated_at = ? WHERE id = ?", (a["title"], a["content"], a["tags"], a["area"], now, row["id"]))
                    updated += 1
                else:
                    kept_modified += 1
                    continue
            hashes[ext] = new_hash
    result = {"total": len(articles), "created": created, "updated": updated, "unchanged": unchanged, "kept_modified": kept_modified,
              "kept_deleted": kept_deleted, "problems": problems[:30], "at": now}
    db.set_setting("kb_library_hashes", hashes)
    db.set_setting("kb_library_last", {k: v for k, v in result.items() if k != "problems"})
    return result


def snippet_of(content: str, width: int = 170) -> str:
    text = re.sub(r"[#*`|>]", "", content or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:width] + (" …" if len(text) > width else "")


def register(app: FastAPI, ctx: Any, admin_only, auto_import: bool = False) -> None:
    db: Database = ctx.db

    if auto_import:
        try:
            available = sum(1 for p in LIB_DIR.glob("*.md") if p.name.upper() != "FORMAT.MD")
            marker = "|".join(f"{p.name}:{p.stat().st_size}" for p in sorted(LIB_DIR.glob("*.md")))
            if available and db.get_setting("kb_library_files", "") != marker:  # nur wenn sich die Dateien geändert haben
                import_library(db)
                db.set_setting("kb_library_files", marker)
        except Exception as exc:  # noqa: BLE001 - das Cockpit startet auch ohne Bibliothek
            db.set_setting("kb_library_error", str(exc))

    def row_view(r: dict[str, Any], snippet: str | None = None) -> dict[str, Any]:
        return {"id": r["id"], "title": r["title"], "area": r.get("area") or "", "tags": r.get("tags") or "", "public": bool(r.get("public")),
                "source": r.get("source") or "cockpit", "updated_at": r.get("updated_at") or "",
                "snippet": snippet if snippet is not None else snippet_of(r.get("content") or "")}

    @app.get("/api/kb/overview")
    def overview() -> dict:
        areas = db.query("SELECT COALESCE(NULLIF(area, ''), 'Eigene Artikel') AS area, COUNT(*) AS n, SUM(public) AS public FROM kb_articles "
                         "GROUP BY 1 ORDER BY CASE WHEN COALESCE(area, '') = '' THEN 0 ELSE 1 END, 1")
        total = db.scalar("SELECT COUNT(*) FROM kb_articles") or 0
        return {"total": total, "public": db.scalar("SELECT COUNT(*) FROM kb_articles WHERE public = 1") or 0,
                "library": db.scalar("SELECT COUNT(*) FROM kb_articles WHERE source = ?", (SOURCE,)) or 0,
                "areas": [{"area": a["area"], "n": a["n"], "public": a["public"] or 0} for a in areas],
                "last_import": db.get_setting("kb_library_last", None)}

    @app.get("/api/kb/list")
    def list_articles(area: str = "", audience: str = "", q: str = "", limit: int = 40, offset: int = 0) -> dict:
        limit, offset = max(1, min(limit, 200)), max(0, offset)
        if q.strip():
            hits = ctx.kb.search(q, limit=200)
            ids = [h["id"] for h in hits]
            rows = {r["id"]: r for r in db.query(
                f"SELECT * FROM kb_articles WHERE id IN ({','.join('?' for _ in ids)})", ids)} if ids else {}
            items = [rows[i] for i in ids if i in rows]
            if area:
                items = [r for r in items if (r.get("area") or "Eigene Artikel") == area]
            if audience in AUDIENCES:
                items = [r for r in items if bool(r["public"]) == (audience == "kunde")]
            return {"total": len(items), "items": [row_view(r) for r in items[offset:offset + limit]], "mode": hits[0]["mode"] if hits else ""}
        where, params = [], []
        if area:
            where.append("COALESCE(NULLIF(area, ''), 'Eigene Artikel') = ?")
            params.append(area)
        if audience in AUDIENCES:
            where.append("public = ?")
            params.append(1 if audience == "kunde" else 0)
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        total = db.scalar(f"SELECT COUNT(*) FROM kb_articles{clause}", params) or 0
        rows = db.query(f"SELECT * FROM kb_articles{clause} ORDER BY CASE WHEN COALESCE(area, '') = '' THEN 0 ELSE 1 END, area, lower(title) "
                        "LIMIT ? OFFSET ?", [*params, limit, offset])
        return {"total": total, "items": [row_view(r) for r in rows], "mode": ""}

    @app.get("/api/tickets/{tid}/knowledge")
    def for_ticket(tid: int, limit: int = 4) -> dict:
        """Passende Anleitungen zu einem Ticket – aus Titel und Beschreibung, auch ohne KI und für gespiegelte Tickets."""
        t = db.get("tickets", tid)
        if not t:
            raise HTTPException(404, "Ticket nicht gefunden")
        hits = ctx.kb.suggest(t["title"], t.get("description") or "", limit=max(1, min(limit, 8)))
        return {"items": [row_view(h) for h in hits]}

    @app.post("/api/kb/library/import", dependencies=[Depends(admin_only)])
    def run_import() -> dict:
        return import_library(db)

    @app.get("/api/kb/{aid}")
    def one(aid: int) -> dict:
        r = db.get("kb_articles", aid)
        if not r:
            raise HTTPException(404, "Artikel nicht gefunden")
        return {**row_view(r), "content": r["content"], "external_url": r.get("external_url") or ""}
