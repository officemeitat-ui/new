"""BookStack: IT-Dokumentation und Wissen an einem Ort – automatisch aktuell.

* **Kundendokumentation**: je Kunde ein Buch „IT-Doku: <Kunde>“ mit automatisch gepflegten Seiten
  (Übersicht, Geräte mit Atera- und Keeper-Links, Lizenzen & Verträge, Wartung & Nachweise).
  Eigene Seiten im selben Buch bleiben unberührt.
* **Wissensdatenbank** → Buch „ME-IT Wissensdatenbank“ (Cockpit-Artikel werden Seiten).
* **Wiki → KI**: Seiten aus gewählten Büchern werden als Wissen importiert, damit Triage, Assistent und
  Kundenportal-Hilfe sie nutzen (Bearbeiten weiterhin in BookStack).
* Passwort-Wächter: Zugangsdaten werden vor dem Export geschwärzt – Passwörter gehören in Keeper.

API-Token in BookStack: Profil → API-Tokens (Rolle mit „Zugriff auf System-API“). .env: BOOKSTACK_URL,
BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso
from .secrets_guard import redact

AUTO_TAG = {"name": "meit-quelle", "value": "cockpit"}
DEFAULT_CONF = {"kb_book": "ME-IT Wissensdatenbank", "customer_book": "IT-Doku: {kunde}", "push_customers": True,
                "push_kb": True, "import_books": ["ME-IT Wissensdatenbank"]}


class BookStackError(RuntimeError):
    pass


class BookStack:
    def __init__(self, url: str, token_id: str, token_secret: str):
        self.url = (url or "").rstrip("/")
        self.token = f"{token_id}:{token_secret}" if token_id and token_secret else ""

    @property
    def configured(self) -> bool:
        return bool(self.url and self.token)

    def _req(self, method: str, path: str, **kwargs) -> Any:
        if not self.configured:
            raise BookStackError("BookStack ist nicht eingerichtet (BOOKSTACK_URL, BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET).")
        try:
            r = httpx.request(method, f"{self.url}/api{path}", timeout=60,
                              headers={"Authorization": f"Token {self.token}", "Accept": "application/json"}, **kwargs)
            if r.status_code in (401, 403):
                raise BookStackError("BookStack lehnt den Zugriff ab (API-Token bzw. Rolle „Zugriff auf System-API“ prüfen).")
            r.raise_for_status()
            return r.json() if r.content else {}
        except httpx.HTTPError as exc:
            raise BookStackError(f"BookStack nicht erreichbar: {exc}") from exc

    def list(self, path: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        out, offset = [], 0
        params = {f"filter[{k}]": v for k, v in (filters or {}).items()}
        while True:
            data = self._req("GET", path, params={**params, "count": 500, "offset": offset})
            batch = data.get("data") or []
            out += batch
            offset += len(batch)
            if not batch or offset >= int(data.get("total") or 0):
                return out

    def book(self, name: str, description: str = "", create: bool = True) -> dict[str, Any] | None:
        found = [b for b in self.list("/books", {"name": name}) if b.get("name") == name]
        if found:
            return found[0]
        if not create:
            return None
        return self._req("POST", "/books", json={"name": name, "description": description, "tags": [AUTO_TAG]})

    def upsert_page(self, book: dict[str, Any], name: str, markdown: str, tags: list[dict[str, str]] | None = None,
                    page_id: int | None = None) -> dict[str, Any]:
        body = {"name": name, "markdown": markdown, "tags": [AUTO_TAG, *(tags or [])]}
        if not page_id:
            existing = [p for p in self.list("/pages", {"book_id": book["id"], "name": name}) if p.get("name") == name]
            page_id = existing[0]["id"] if existing else None
        if page_id:
            try:
                return self._req("PUT", f"/pages/{page_id}", json=body)
            except BookStackError as exc:
                if "404" not in str(exc):
                    raise
        return self._req("POST", "/pages", json={**body, "book_id": book["id"]})

    def page_url(self, book: dict[str, Any], page: dict[str, Any]) -> str:
        return f"{self.url}/books/{book.get('slug', '')}/page/{page.get('slug', '')}"


# ----------------------------------------------------------------------------- Inhalte
def _md_escape(v: Any) -> str:
    return str(v if v not in (None, "") else "–").replace("|", "/").replace("\n", " ")


def customer_pages(db: Database, customer: dict[str, Any]) -> dict[str, str]:
    from .radar import eol_info
    from .maintenance import INTERVALS, RESULTS

    stamp = datetime.now().strftime("%d.%m.%Y %H:%M")
    note = (f"> Automatisch aus dem ME-IT Cockpit erzeugt (Stand {stamp}). Diese Seite wird beim nächsten Abgleich "
            "überschrieben – eigene Seiten in diesem Buch bleiben unberührt. **Passwörter nie hier speichern – "
            "Zugangsdaten liegen in Keeper.**\n")
    services = {s["code"]: s["name"] for s in db.query("SELECT code, name FROM services")}
    booked = ", ".join(f"{services.get(c, c)} ({c})" for c in loads(customer.get("booked_services"), [])) or "–"
    keeper = f"[Keeper-Ordner öffnen]({customer['keeper_url']})" if customer.get("keeper_url") else "– (Keeper-Link im Cockpit hinterlegen)"
    overview = [f"# {customer['name']}", note, "| | |", "|---|---|",
                f"| Ansprechpartner | {_md_escape(customer.get('contact_name'))} |",
                f"| Telefon / E-Mail | {_md_escape(' · '.join(x for x in (customer.get('phone'), customer.get('email')) if x))} |",
                f"| Adresse | {_md_escape(customer.get('address'))} |",
                f"| Branche / Mitarbeiter | {_md_escape(customer.get('industry'))} / {customer.get('employees') or '–'} |",
                f"| Betreuungspaket | {_md_escape(customer.get('package'))} |",
                f"| Gebuchte Leistungen | {_md_escape(booked)} |",
                f"| Vertragsende | {_md_escape(customer.get('contract_end'))} |",
                f"| Zugangsdaten | {keeper} |"]
    if customer.get("notes"):
        overview += ["", "## Notizen", redact(customer["notes"])]

    assets = db.query("SELECT * FROM assets WHERE customer_id = ? ORDER BY type = 'server' DESC, name", (customer["id"],))
    today = date.today()
    dev = ["# Geräte", note, "| Gerät | Typ | Betriebssystem | Seriennr. | Garantie bis | Zuletzt online | Fernwartung | Zugang |",
           "|---|---|---|---|---|---|---|---|"]
    eol = []
    for a in assets:
        info = eol_info(a["os"] or "")
        if info and info[0] <= today:
            eol.append(f"- **{a['name']}**: {a['os']} – ohne Herstellersupport seit {info[0].strftime('%d.%m.%Y')}")
        remote = f"[Atera]({a['remote_url']})" if a.get("remote_url") else "–"
        keeper_link = f"[Keeper]({a['keeper_url']})" if a.get("keeper_url") else "–"
        dev.append(f"| {_md_escape(a['name'])} | {_md_escape(a['type'])} | {_md_escape(a['os'])} | {_md_escape(a['serial'])} | "
                   f"{_md_escape(a['warranty_end'])} | {_md_escape(a['last_seen'])} | {remote} | {keeper_link} |")
    if not assets:
        dev.append("| – | | | | | | | |")
    if eol:
        dev += ["", "## Achtung: Geräte ohne Herstellersupport", *eol]

    subs = db.query("SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY renewal_date", (customer["id"],))
    lic = ["# Lizenzen & Verträge", note, "| Lizenz/Vertrag | Hersteller | Anzahl | Verlängerung | Kündigungsfrist | Auto-Verlängerung |",
           "|---|---|---|---|---|---|"]
    lic += [f"| {_md_escape(s['name'])} | {_md_escape(s['vendor'])} | {s['quantity']:g} | {_md_escape(s['renewal_date'])} | "
            f"{s['notice_days']} Tage | {'ja' if s['auto_renew'] else 'nein'} |" for s in subs] or ["| – | | | | | |"]

    tasks = db.query("SELECT * FROM maintenance_tasks WHERE customer_id = ? AND active = 1 ORDER BY title", (customer["id"],))
    runs = db.query("SELECT r.*, (SELECT COALESCE(SUM(minutes), 0) FROM remote_sessions s WHERE s.maintenance_run_id = r.id) "
                    "AS remote FROM maintenance_runs r WHERE r.customer_id = ? AND r.status = 'erledigt' "
                    "ORDER BY r.done_at DESC LIMIT 24", (customer["id"],))
    wart = ["# Wartung & Nachweise", note, "## Wartungsplan", "| Prüfung | Rhythmus | Nächste Fälligkeit | Zuletzt | Ergebnis |",
            "|---|---|---|---|---|"]
    wart += [f"| {_md_escape(t['title'])} | {INTERVALS.get(t['interval'], t['interval'])} | {_md_escape(t['next_due'])} | "
             f"{_md_escape(t['last_done_at'][:10])} | {RESULTS.get(t['last_result'], '–')} |" for t in tasks] or ["| – | | | | |"]
    wart += ["", "## Durchgeführte Prüfungen", "| Datum | Prüfung | Ergebnis | Fernwartung (protokolliert) | Notiz |",
             "|---|---|---|---|---|"]
    wart += [f"| {r['done_at'][:10]} | {_md_escape(r['title'])} | {RESULTS.get(r['result'], r['result'])} | "
             f"{(str(r['remote']) + ' Min.') if r['remote'] else '–'} | {_md_escape(redact(r['note'] or ''))} |" for r in runs] \
        or ["| – | | | | |"]
    return {"Übersicht": redact("\n".join(overview)), "Geräte": redact("\n".join(dev)),
            "Lizenzen & Verträge": redact("\n".join(lic)), "Wartung & Nachweise": redact("\n".join(wart))}


class DocSync:
    def __init__(self, db: Database, client: BookStack):
        self.db, self.client = db, client

    def conf(self) -> dict[str, Any]:
        stored = self.db.get_setting("bookstack", {}) or {}
        return {**DEFAULT_CONF, **{k: v for k, v in stored.items() if k in DEFAULT_CONF}}

    def push_customer(self, customer_id: int) -> dict[str, Any]:
        c = self.db.get("customers", customer_id)
        if not c:
            raise ValueError("Kunde nicht gefunden")
        conf = self.conf()
        book = self.client.book(conf["customer_book"].replace("{kunde}", c["name"])[:255],
                                f"IT-Dokumentation {c['name']} – gepflegt vom ME-IT Cockpit")
        pages = customer_pages(self.db, c)
        for name, md in pages.items():
            self.client.upsert_page(book, name, md, [{"name": "kunde", "value": c["name"]}])
        url = f"{self.client.url}/books/{book.get('slug', '')}"
        self.db.update("customers", customer_id, {"bookstack_url": url})
        return {"customer": c["name"], "pages": len(pages), "url": url}

    def push_kb(self) -> dict[str, int]:
        conf = self.conf()
        book = self.client.book(conf["kb_book"], "Wissensdatenbank von ME-IT – Lösungen und Anleitungen")
        pushed = 0
        for a in self.db.query("SELECT * FROM kb_articles WHERE COALESCE(source, 'cockpit') = 'cockpit'"):
            if a["synced_at"] and a["synced_at"] >= (a["updated_at"] or ""):
                continue
            page_id = int(a["external_id"].split(":")[1]) if (a["external_id"] or "").startswith("bookstack:") else None
            tags = [{"name": "tag", "value": t.strip()} for t in (a["tags"] or "").split(",") if t.strip()][:10]
            page = self.client.upsert_page(book, a["title"], redact(a["content"] or ""), tags, page_id=page_id)
            self.db.query("UPDATE kb_articles SET external_id = ?, external_url = ?, synced_at = ? WHERE id = ?",
                          (f"bookstack:{page.get('id')}", self.client.page_url(book, page), now_iso(), a["id"]))
            pushed += 1
        return {"kb_pushed": pushed}

    def pull(self) -> dict[str, int]:
        from .mail import html_to_text

        imported = updated = removed = 0
        seen: set[str] = set()
        for name in self.conf()["import_books"]:
            book = self.client.book(name, create=False)
            if not book:
                continue
            for p in self.client.list("/pages", {"book_id": book["id"]}):
                if p.get("draft") or p.get("template"):
                    continue
                ext = f"bookstack:{p['id']}"
                local = self.db.query_one("SELECT id, source, synced_at FROM kb_articles WHERE external_id = ?", (ext,))
                if local and local["source"] != "bookstack":
                    continue  # eigene, aus dem Cockpit exportierte Seite
                seen.add(ext)
                if local and local["synced_at"] and local["synced_at"] >= str(p.get("updated_at") or "")[:19].replace("T", " "):
                    continue
                full = self.client._req("GET", f"/pages/{p['id']}")
                if any(t.get("name") == AUTO_TAG["name"] for t in full.get("tags") or []):
                    continue
                content = (full.get("markdown") or "").strip() or html_to_text(full.get("html") or "")
                row = {"title": full.get("name") or p.get("name") or "Ohne Titel", "content": redact(content)[:50000],
                       "tags": f"bookstack, {name}", "source": "bookstack", "external_id": ext,
                       "external_url": self.client.page_url(book, full), "embedding": "", "embedding_model": ""}
                if local:
                    self.db.update("kb_articles", local["id"], row)
                    self.db.query("UPDATE kb_articles SET synced_at = ? WHERE id = ?", (now_iso(), local["id"]))
                    updated += 1
                else:
                    aid = self.db.insert("kb_articles", {**row, "public": False})
                    self.db.query("UPDATE kb_articles SET synced_at = ? WHERE id = ?", (now_iso(), aid))
                    imported += 1
        for a in self.db.query("SELECT id, external_id FROM kb_articles WHERE source = 'bookstack'"):
            if a["external_id"] not in seen:
                self.db.delete("kb_articles", a["id"])
                removed += 1
        return {"kb_imported": imported, "kb_updated": updated, "kb_removed": removed}

    def run(self) -> dict[str, Any]:
        conf = self.conf()
        result: dict[str, Any] = {"at": now_iso()}
        if conf["push_kb"]:
            result.update(self.push_kb())
        result.update(self.pull())
        if conf["push_customers"]:
            customers = self.db.query("SELECT id FROM customers WHERE COALESCE(package, 'keins') != 'keins' "
                                      "OR EXISTS (SELECT 1 FROM assets a WHERE a.customer_id = customers.id)")
            result["customers"] = [self.push_customer(c["id"])["customer"] for c in customers]
        self.db.set_setting("bookstack_last_sync", result)
        return result


# ----------------------------------------------------------------------------- API
class ConfIn(BaseModel):
    kb_book: Optional[str] = Field(None, max_length=200)
    customer_book: Optional[str] = Field(None, max_length=200)
    push_customers: Optional[bool] = None
    push_kb: Optional[bool] = None
    import_books: Optional[list[str]] = None


def register(app: FastAPI, db: Database, settings: Any, admin_only) -> DocSync:
    client = BookStack(getattr(settings, "bookstack_url", ""), getattr(settings, "bookstack_token_id", ""),
                       getattr(settings, "bookstack_token_secret", ""))
    sync = DocSync(db, client)

    def guard(fn):
        try:
            return fn()
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except BookStackError as exc:
            db.set_setting("bookstack_error", str(exc))
            raise HTTPException(502, str(exc))

    @app.get("/api/bookstack/status")
    def status() -> dict:
        return {"configured": client.configured, "url": client.url, **sync.conf(),
                "last": db.get_setting("bookstack_last_sync", None), "error": db.get_setting("bookstack_error", "")}

    @app.put("/api/bookstack/settings", dependencies=[Depends(admin_only)])
    def save(data: ConfIn) -> dict:
        conf = {**sync.conf(), **{k: v for k, v in data.model_dump(exclude_none=True).items()}}
        if "{kunde}" not in conf["customer_book"]:
            raise HTTPException(422, "Buchname für Kunden muss {kunde} enthalten")
        conf["import_books"] = [b.strip()[:200] for b in conf["import_books"] if b.strip()][:20]
        db.set_setting("bookstack", conf)
        return {**status()}

    @app.post("/api/bookstack/sync", dependencies=[Depends(admin_only)])
    def run() -> dict:
        result = guard(sync.run)
        db.set_setting("bookstack_error", "")
        return result

    @app.post("/api/bookstack/customer/{cid}", dependencies=[Depends(admin_only)])
    def push_customer(cid: int) -> dict:
        return guard(lambda: sync.push_customer(cid))

    if client.configured and getattr(settings, "bookstack_sync_hours", 0) > 0:
        def loop() -> None:
            time.sleep(150)
            while True:
                try:
                    sync.run()
                    db.set_setting("bookstack_error", "")
                except Exception as exc:  # noqa: BLE001
                    db.set_setting("bookstack_error", str(exc))
                time.sleep(settings.bookstack_sync_hours * 3600)

        threading.Thread(target=loop, name="meit-bookstack-sync", daemon=True).start()
    return sync
