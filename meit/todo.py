"""Microsoft To Do: Cockpit-Aufgaben in der eigenen To-Do-Liste – am Handy, in Outlook und Teams.

Sicherheit
* **Delegiert statt App-Recht**: Jeder verbindet nur *seine eigenen* Aufgaben (Berechtigung ``Tasks.ReadWrite``,
  Anmeldung per Gerätecode). To Do bietet ohnehin keine App-weiten Rechte – das Cockpit kann also nie die
  Aufgaben anderer Mitarbeiter lesen.
* Das Anmelde-Token (Refresh-Token) wird **verschlüsselt** gespeichert (Tresor, Schlüssel außerhalb der Datenbank).
* Verbindung jederzeit trennbar; in Microsoft unter „Meine Apps/Kontoberechtigungen“ widerrufbar.

Was synchronisiert wird (Liste „ME-IT Cockpit“)
* Tickets (meine bzw. dringende), mit Link zurück ins Cockpit; wird ein Ticket gelöst, wird die Aufgabe erledigt.
* Ein-/Austritte als Aufgabe mit **Checkliste** (Stichtag = Fälligkeit). In To Do abgehakte Schritte werden im
  Cockpit abgehakt – und umgekehrt.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso
from .msauth import MsAuthError, device_code_poll, device_code_start, refresh_delegated
from .vault import Vault, VaultError

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE = "Tasks.ReadWrite User.Read offline_access"
LIST_NAME = "ME-IT Cockpit"
TZ = "W. Europe Standard Time"
DEFAULT_OPTIONS = {"tickets": "meine", "staff": "meine"}
OPTION_VALUES = {"tickets": ("meine", "dringend", "alle", "aus"), "staff": ("meine", "alle", "aus")}


class TodoError(RuntimeError):
    pass


class TodoService:
    def __init__(self, db: Database, settings: Any, vault: Vault, staff: Any = None):
        self.db, self.settings, self.vault, self.staff = db, settings, vault, staff
        self._pending: dict[int, dict[str, Any]] = {}
        self._access: dict[int, tuple[float, str]] = {}
        self._lock = threading.Lock()

    # -- Konfiguration
    @property
    def client_id(self) -> str:
        return self.settings.todo_client_id or self.settings.graph_client_id

    @property
    def tenant(self) -> str:
        return self.settings.graph_tenant_id or "organizations"

    @property
    def configured(self) -> bool:
        return bool(self.client_id)

    def account(self, user_key: int) -> dict[str, Any] | None:
        a = self.db.query_one("SELECT * FROM ms_accounts WHERE user_key = ?", (user_key,))
        if a:
            a["options"] = {**DEFAULT_OPTIONS, **(loads(a["options"], {}) or {})}
        return a

    def status(self, user_key: int) -> dict[str, Any]:
        a = self.account(user_key)
        links = self.db.query("SELECT state, COUNT(*) AS n FROM todo_links WHERE user_key = ? GROUP BY state", (user_key,))
        return {"configured": self.configured, "connected": bool(a and a["refresh_token"]),
                "account": {k: a[k] for k in ("upn", "display_name", "connected_at", "last_sync", "error", "options")} if a else None,
                "tasks": {r["state"]: r["n"] for r in links}, "pending": user_key in self._pending,
                "options_allowed": OPTION_VALUES}

    # -- Anmeldung (Gerätecode)
    def start(self, user_key: int, base_url: str) -> dict[str, Any]:
        if not self.configured:
            raise TodoError("App-Registrierung fehlt (GRAPH_CLIENT_ID bzw. TODO_CLIENT_ID in .env).")
        try:
            d = device_code_start(self.tenant, self.client_id, SCOPE)
        except MsAuthError as exc:
            raise TodoError(str(exc)) from exc
        self._pending[user_key] = {"device_code": d["device_code"], "interval": int(d.get("interval", 5)),
                                   "expires": time.time() + int(d.get("expires_in", 900)), "next": 0.0,
                                   "base_url": (self.settings.public_url or base_url).rstrip("/")}
        return {"user_code": d["user_code"], "verification_uri": d.get("verification_uri", "https://microsoft.com/devicelogin"),
                "expires_in": int(d.get("expires_in", 900)), "interval": int(d.get("interval", 5))}

    def poll(self, user_key: int) -> dict[str, Any]:
        p = self._pending.get(user_key)
        if not p:
            return {"status": "none"}
        if time.time() > p["expires"]:
            self._pending.pop(user_key, None)
            return {"status": "expired", "error": "Code abgelaufen – bitte neu starten."}
        if time.time() < p["next"]:
            return {"status": "pending"}
        p["next"] = time.time() + p["interval"]
        r = device_code_poll(self.tenant, self.client_id, p["device_code"])
        if r["status"] != "ok":
            if r["status"] in ("declined", "expired", "error"):
                self._pending.pop(user_key, None)
            return {"status": r["status"], "error": r.get("error", "")}
        self._pending.pop(user_key, None)
        access = r["access_token"]
        self._access[user_key] = (time.time() + int(r.get("expires_in", 3600)), access)
        me = self._call(access, "GET", "/me", params={"$select": "displayName,userPrincipalName"}) or {}
        list_id = self._ensure_list(access)
        existing = self.account(user_key)
        row = {"upn": me.get("userPrincipalName", ""), "display_name": me.get("displayName", ""),
               "refresh_token": self.vault.encrypt(r.get("refresh_token", "")), "list_id": list_id,
               "connected_at": now_iso(), "error": "",
               "options": json.dumps({**(existing or {}).get("options", DEFAULT_OPTIONS), "base_url": p["base_url"]})}
        if existing:
            self.db.update("ms_accounts", existing["id"], row)
        else:
            self.db.insert("ms_accounts", {"user_key": user_key, **row})
        from .team import log_activity

        log_activity(self.db, user_key or None, "todo_verbunden", "", None, f"Microsoft To Do verbunden ({row['upn']})")
        return {"status": "connected", "upn": row["upn"], "display_name": row["display_name"]}

    def disconnect(self, user_key: int) -> None:
        self.db.query("DELETE FROM ms_accounts WHERE user_key = ?", (user_key,))
        self.db.query("DELETE FROM todo_links WHERE user_key = ?", (user_key,))
        self._access.pop(user_key, None)

    def set_options(self, user_key: int, options: dict[str, str]) -> dict[str, Any]:
        a = self.account(user_key)
        if not a:
            raise TodoError("Nicht verbunden")
        for k, v in options.items():
            if k not in OPTION_VALUES or v not in OPTION_VALUES[k]:
                raise TodoError(f"Ungültige Einstellung: {k}={v}")
        self.db.update("ms_accounts", a["id"], {"options": json.dumps({**a["options"], **options})})
        return self.account(user_key)["options"]

    # -- Graph
    def _token(self, a: dict[str, Any]) -> str:
        cached = self._access.get(a["user_key"])
        if cached and cached[0] > time.time() + 60:
            return cached[1]
        try:
            refresh = self.vault.decrypt(a["refresh_token"])
            r = refresh_delegated(self.tenant, self.client_id, refresh, SCOPE)
        except (MsAuthError, VaultError) as exc:
            self.db.update("ms_accounts", a["id"], {"error": str(exc)[:500]})
            raise TodoError(str(exc)) from exc
        if r.get("refresh_token"):
            self.db.update("ms_accounts", a["id"], {"refresh_token": self.vault.encrypt(r["refresh_token"])})
        self._access[a["user_key"]] = (time.time() + int(r.get("expires_in", 3600)), r["access_token"])
        return r["access_token"]

    def _call(self, token: str, method: str, path: str, **kwargs) -> Any:
        import httpx

        try:
            resp = httpx.request(method, GRAPH + path, headers={"Authorization": f"Bearer {token}"}, timeout=30, **kwargs)
        except httpx.HTTPError as exc:
            raise TodoError(f"Microsoft To Do nicht erreichbar: {exc}") from exc
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", {}).get("message", "")
            except ValueError:
                detail = ""
            raise TodoError(f"Microsoft To Do {resp.status_code}: {detail or path}")
        return resp.json() if resp.content else {}

    def _ensure_list(self, token: str) -> str:
        lists = (self._call(token, "GET", "/me/todo/lists") or {}).get("value", [])
        found = next((l for l in lists if l.get("displayName") == LIST_NAME), None)
        if found:
            return found["id"]
        return self._call(token, "POST", "/me/todo/lists", json={"displayName": LIST_NAME})["id"]

    # -- Was gehört in die Liste?
    def desired(self, user_key: int, options: dict[str, Any], base: str) -> dict[str, dict[str, Any]]:
        items: dict[str, dict[str, Any]] = {}
        mode = options.get("tickets", "meine")
        if mode == "meine" and not user_key:
            mode = "dringend"  # ohne Benutzerverwaltung gibt es kein „meine“
        if mode != "aus":
            sql = ("SELECT t.id, t.title, t.priority, t.description, c.name AS customer FROM tickets t "
                   "LEFT JOIN customers c ON c.id = t.customer_id WHERE t.status != 'geloest'")
            params: list[Any] = []
            if mode == "meine":
                sql += " AND t.assigned_to = ?"
                params.append(user_key)
            elif mode == "dringend":
                sql += " AND t.priority IN ('hoch', 'kritisch')"
            for t in self.db.query(sql + " ORDER BY t.id DESC LIMIT 150", params):
                items[f"ticket:{t['id']}"] = {
                    "title": f"#{t['id']} {t['title']}" + (f" – {t['customer']}" if t["customer"] else ""),
                    "body": (t["description"] or "")[:1500], "due": "", "url": f"{base}/#/tickets?ticket={t['id']}",
                    "importance": "high" if t["priority"] in ("hoch", "kritisch") else "normal"}
        smode = options.get("staff", "meine")
        if smode != "aus":
            sql = ("SELECT s.id, s.kind, s.person, s.due_date, s.checklist, c.name AS customer, t.assigned_to FROM staff_changes s "
                   "JOIN customers c ON c.id = s.customer_id LEFT JOIN tickets t ON t.id = s.ticket_id "
                   "WHERE s.status IN ('offen', 'in_arbeit')")
            for s in self.db.query(sql):
                if smode == "meine" and user_key and s["assigned_to"] not in (None, user_key):
                    continue
                steps = loads(s["checklist"], [])
                items[f"staff:{s['id']}"] = {
                    "title": f"{'Eintritt' if s['kind'] == 'eintritt' else 'Austritt'}: {s['person']} – {s['customer']}",
                    "body": "Checkliste aus dem ME-IT Cockpit – Schritte hier abhaken, das Cockpit übernimmt sie.",
                    "due": s["due_date"] or "", "url": f"{base}/#/mitarbeiter?vorgang={s['id']}",
                    "importance": "normal", "steps": steps}
        return items

    def _source_open(self, ref: str) -> bool:
        kind, _, rid = ref.partition(":")
        if kind == "ticket":
            t = self.db.get("tickets", int(rid))
            return bool(t and t["status"] != "geloest")
        if kind == "staff":
            s = self.db.get("staff_changes", int(rid))
            return bool(s and s["status"] in ("offen", "in_arbeit"))
        return False

    # -- Abgleich
    def sync(self, user_key: int) -> dict[str, Any]:
        with self._lock:
            return self._sync(user_key)

    def _sync(self, user_key: int) -> dict[str, Any]:
        a = self.account(user_key)
        if not a or not a["refresh_token"]:
            raise TodoError("Microsoft To Do ist nicht verbunden.")
        token = self._token(a)
        list_id = a["list_id"]
        if not list_id or self._call(token, "GET", f"/me/todo/lists/{list_id}") is None:
            list_id = self._ensure_list(token)
            self.db.update("ms_accounts", a["id"], {"list_id": list_id})
            self.db.query("DELETE FROM todo_links WHERE user_key = ?", (user_key,))
        base = (self.settings.public_url or a["options"].get("base_url") or "").rstrip("/")
        want = self.desired(user_key, a["options"], base)
        links = {l["ref"]: l for l in self.db.query("SELECT * FROM todo_links WHERE user_key = ?", (user_key,))}
        stats = {"created": 0, "updated": 0, "completed": 0, "reopened": 0, "removed": 0, "steps_from_todo": 0,
                 "done_in_todo": 0}
        tasks = f"/me/todo/lists/{list_id}/tasks"
        name = a["display_name"] or a["upn"] or "To Do"

        for ref, item in want.items():
            link = links.get(ref)
            if link is None:
                body = {"title": item["title"][:255], "body": {"content": item["body"], "contentType": "text"},
                        "importance": item["importance"],
                        "linkedResources": [{"webUrl": item["url"], "applicationName": "ME-IT Cockpit",
                                             "displayName": "Im Cockpit öffnen", "externalId": ref}] if item["url"].startswith("http") else []}
                if item["due"]:
                    body["dueDateTime"] = {"dateTime": f"{item['due']}T08:00:00", "timeZone": TZ}
                task = self._call(token, "POST", tasks, json=body)
                meta: dict[str, Any] = {"items": {}}
                for i, step in enumerate(item.get("steps") or []):
                    ci = self._call(token, "POST", f"{tasks}/{task['id']}/checklistItems",
                                    json={"displayName": step["text"][:255], "isChecked": bool(step["done"])})
                    meta["items"][ci["id"]] = i
                self.db.insert("todo_links", {"user_key": user_key, "ref": ref, "task_id": task["id"], "list_id": list_id,
                                              "title": item["title"], "due": item["due"], "state": "offen",
                                              "meta": json.dumps(meta), "synced_at": now_iso()})
                stats["created"] += 1
                continue
            if link["state"] == "geloescht":
                continue  # in To Do bewusst gelöscht → nicht wieder anlegen
            task = self._call(token, "GET", f"{tasks}/{link['task_id']}")
            if task is None:
                self.db.update("todo_links", link["id"], {"state": "geloescht"})
                continue
            patch: dict[str, Any] = {}
            if item["title"] != link["title"]:
                patch["title"] = item["title"][:255]
            if item["due"] != link["due"]:
                patch["dueDateTime"] = {"dateTime": f"{item['due']}T08:00:00", "timeZone": TZ} if item["due"] else None
            meta = loads(link["meta"], {}) or {"items": {}}
            if ref.startswith("staff:"):
                stats["steps_from_todo"] += self._sync_steps(token, f"{tasks}/{link['task_id']}", int(ref.split(":")[1]),
                                                             item.get("steps") or [], meta, name)
            if task.get("status") == "completed" and link["state"] == "offen":
                stats["done_in_todo"] += 1
                meta["done_in_todo"] = True
                self._done_in_todo(ref, name, user_key)
                self.db.update("todo_links", link["id"], {"state": "erledigt", "meta": json.dumps(meta), "synced_at": now_iso()})
                continue
            if link["state"] == "erledigt" and task.get("status") == "completed" and self._source_open(ref) \
                    and not meta.get("done_in_todo"):
                patch["status"] = "notStarted"  # im Cockpit wieder geöffnet
                stats["reopened"] += 1
            if patch:
                self._call(token, "PATCH", f"{tasks}/{link['task_id']}", json=patch)
                stats["updated"] += 1
            self.db.update("todo_links", link["id"], {"title": item["title"], "due": item["due"], "meta": json.dumps(meta),
                                                      "state": "offen" if patch.get("status") == "notStarted" else link["state"],
                                                      "synced_at": now_iso()})

        for ref, link in links.items():
            if ref in want or link["state"] != "offen":
                continue
            if self._source_open(ref):  # z. B. Ticket jemand anderem zugewiesen → aus meiner Liste nehmen
                self._call(token, "DELETE", f"{tasks}/{link['task_id']}")
                self.db.query("DELETE FROM todo_links WHERE id = ?", (link["id"],))
                stats["removed"] += 1
            else:  # im Cockpit erledigt → in To Do abhaken
                if ref.startswith("staff:"):
                    meta = loads(link["meta"], {}) or {"items": {}}
                    s = self.db.get("staff_changes", int(ref.split(":")[1]))
                    if s:
                        self._sync_steps(token, f"{tasks}/{link['task_id']}", s["id"], loads(s["checklist"], []), meta, name,
                                         pull=False)
                if self._call(token, "PATCH", f"{tasks}/{link['task_id']}", json={"status": "completed"}) is not None:
                    stats["completed"] += 1
                self.db.update("todo_links", link["id"], {"state": "erledigt", "synced_at": now_iso()})
        self.db.update("ms_accounts", a["id"], {"last_sync": now_iso(), "error": ""})
        return stats

    def _sync_steps(self, token: str, task_path: str, sid: int, steps: list[dict[str, Any]], meta: dict[str, Any],
                    who: str, pull: bool = True) -> int:
        """Checkliste in beide Richtungen abgleichen. Rückgabe: in To Do abgehakte und im Cockpit übernommene Schritte."""
        items = (self._call(token, "GET", f"{task_path}/checklistItems") or {}).get("value", [])
        mapping: dict[str, int] = meta.setdefault("items", {})
        checked_remote = {i["id"]: bool(i.get("isChecked")) for i in items}
        pulled = 0
        for item_id, idx in list(mapping.items()):
            if item_id not in checked_remote or idx >= len(steps):
                continue
            if pull and checked_remote[item_id] and not steps[idx]["done"] and self.staff:
                try:
                    self.staff.check(sid, idx, True, f"{who} (To Do)")
                    steps[idx]["done"] = True
                    pulled += 1
                except (LookupError, ValueError):
                    pass
            elif steps[idx]["done"] and not checked_remote[item_id]:
                self._call(token, "PATCH", f"{task_path}/checklistItems/{item_id}", json={"isChecked": True})
        known = set(mapping.values())
        for i, step in enumerate(steps):
            if i not in known:  # im Cockpit ergänzter Schritt
                ci = self._call(token, "POST", f"{task_path}/checklistItems",
                                json={"displayName": step["text"][:255], "isChecked": bool(step["done"])})
                mapping[ci["id"]] = i
        return pulled

    def _done_in_todo(self, ref: str, who: str, user_key: int) -> None:
        from .team import log_activity

        kind, _, rid = ref.partition(":")
        if kind == "ticket":
            t = self.db.get("tickets", int(rid))
            if t and t["status"] == "neu":
                self.db.update("tickets", t["id"], {"status": "in_arbeit"})
            log_activity(self.db, user_key or None, "todo_erledigt", "ticket", int(rid),
                         f"In Microsoft To Do als erledigt markiert ({who}) – Ticket bitte mit Lösung abschließen")

    def sync_all(self) -> dict[str, Any]:
        done, errors = 0, []
        for a in self.db.query("SELECT user_key FROM ms_accounts WHERE refresh_token != ''"):
            try:
                self.sync(a["user_key"])
                done += 1
            except TodoError as exc:
                errors.append(str(exc))
        return {"done": done, "errors": errors}


class TodoOptionsIn(BaseModel):
    tickets: Optional[str] = Field(None, max_length=20)
    staff: Optional[str] = Field(None, max_length=20)


def user_key(request: Request) -> int:
    u = getattr(request.state, "user", None)
    return int(u["id"]) if isinstance(u, dict) and u.get("id") else 0


def register(app: FastAPI, ctx: Any, settings: Any, vault: Vault, start: bool = False) -> TodoService:
    svc = TodoService(ctx.db, settings, vault, getattr(app.state, "staff", None))
    app.state.todo = svc

    def err(exc: Exception) -> HTTPException:
        return HTTPException(502 if "nicht erreichbar" in str(exc) or "Microsoft To Do 5" in str(exc) else 409, str(exc))

    @app.get("/api/todo")
    def status(request: Request) -> dict:
        return svc.status(user_key(request))

    @app.post("/api/todo/connect")
    def connect(request: Request) -> dict:
        try:
            return svc.start(user_key(request), str(request.base_url))
        except TodoError as exc:
            raise err(exc)

    @app.post("/api/todo/connect/poll")
    def poll(request: Request) -> dict:
        try:
            r = svc.poll(user_key(request))
            if r["status"] == "connected":
                try:
                    r["sync"] = svc.sync(user_key(request))
                except TodoError as exc:
                    r["sync_error"] = str(exc)
            return r
        except TodoError as exc:
            raise err(exc)

    @app.put("/api/todo/options")
    def options(data: TodoOptionsIn, request: Request) -> dict:
        try:
            return svc.set_options(user_key(request), {k: v for k, v in data.model_dump().items() if v is not None})
        except TodoError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/todo/sync")
    def sync(request: Request) -> dict:
        try:
            return svc.sync(user_key(request))
        except TodoError as exc:
            raise err(exc)

    @app.delete("/api/todo")
    def disconnect(request: Request) -> dict:
        svc.disconnect(user_key(request))
        return {"ok": True, "hint": "Die Liste „ME-IT Cockpit“ bleibt in To Do erhalten und kann dort gelöscht werden."}

    if start and svc.configured and settings.todo_sync_minutes > 0:
        def loop() -> None:
            time.sleep(90)
            while True:
                try:
                    svc.sync_all()
                except Exception:  # noqa: BLE001 - Hintergrundabgleich darf nie abstürzen
                    pass
                time.sleep(settings.todo_sync_minutes * 60)

        threading.Thread(target=loop, name="todo-sync", daemon=True).start()
    return svc

