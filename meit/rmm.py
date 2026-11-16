"""RMM-Anbindung: NinjaOne (NinjaRMM) Public API v2.

* Organisationen → Kunden (Zuordnung per Name, gespeichert), fehlende optional anlegen
* Geräte → Geräte im Cockpit (Name, Typ, Betriebssystem, Seriennummer, zuletzt gesehen) – Upsert
* Alarme → Tickets (optional, jeder Alarm nur einmal)

Einrichtung in NinjaOne: Administration → Apps → API → Client-App-ID (Typ „API Services“,
Grant „Client Credentials“, Scope „Monitoring“). Werte in .env: NINJA_URL, NINJA_CLIENT_ID, NINJA_CLIENT_SECRET.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException

from .db import Database, now_iso

NODE_TYPES = {
    "WINDOWS_SERVER": "server", "LINUX_SERVER": "server", "VMWARE_VM_GUEST": "server", "HYPERV_VMM_GUEST": "server",
    "VMWARE_VM_HOST": "server", "HYPERV_VMM_HOST": "server", "WINDOWS_WORKSTATION": "pc", "MAC": "pc",
    "LINUX_WORKSTATION": "pc", "NMS_SWITCH": "switch", "NMS_FIREWALL": "firewall", "NMS_ROUTER": "firewall",
    "NMS_PRINTER": "drucker", "NMS_WAP": "accesspoint", "NMS_NAS": "nas",
}


class RmmError(RuntimeError):
    pass


class NinjaOne:
    def __init__(self, url: str, client_id: str, client_secret: str):
        self.url = url.rstrip("/")
        self.client_id, self.client_secret = client_id, client_secret
        self._token: tuple[float, str] | None = None

    @property
    def configured(self) -> bool:
        return bool(self.url and self.client_id and self.client_secret)

    def _headers(self) -> dict[str, str]:
        if not self._token or self._token[0] < time.time() + 60:
            try:
                r = httpx.post(f"{self.url}/ws/oauth/token", data={
                    "grant_type": "client_credentials", "client_id": self.client_id,
                    "client_secret": self.client_secret, "scope": "monitoring"}, timeout=30)
                r.raise_for_status()
                data = r.json()
            except httpx.HTTPError as exc:
                raise RmmError(f"NinjaOne-Anmeldung fehlgeschlagen: {exc}") from exc
            self._token = (time.time() + int(data.get("expires_in", 3600)), data["access_token"])
        return {"Authorization": f"Bearer {self._token[1]}"}

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            r = httpx.get(f"{self.url}{path}", headers=self._headers(), params=params or {}, timeout=60)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as exc:
            raise RmmError(f"NinjaOne {path}: {exc}") from exc

    def organizations(self) -> list[dict[str, Any]]:
        return self.get("/v2/organizations") or []

    def devices(self, page_size: int = 500) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        after = 0
        for _ in range(200):  # Sicherheitsgrenze
            page = self.get("/v2/devices-detailed", {"pageSize": page_size, "after": after}) or []
            out += page
            if len(page) < page_size:
                break
            after = page[-1]["id"]
        return out

    def alerts(self) -> list[dict[str, Any]]:
        return self.get("/v2/alerts") or []


def _iso_from_epoch(v: Any) -> str:
    try:
        return datetime.fromtimestamp(float(v)).date().isoformat() if v else ""
    except (TypeError, ValueError, OSError):
        return ""


def sync(db: Database, client: NinjaOne, create_customers: bool = True, alert_tickets: bool = False) -> dict[str, Any]:
    mapping: dict[str, int] = {str(k): v for k, v in (db.get_setting("ninja_org_map", {}) or {}).items()}
    customers = {c["name"].strip().lower(): c["id"] for c in db.query("SELECT id, name FROM customers")}
    created_customers: list[str] = []
    for org in client.organizations():
        oid = str(org.get("id"))
        if oid in mapping and db.get("customers", mapping[oid]):
            continue
        name = (org.get("name") or "").strip()
        cid = customers.get(name.lower())
        if cid is None and create_customers and name:
            cid = db.insert("customers", {"name": name, "booked_services": [], "notes": "Aus NinjaOne übernommen"})
            customers[name.lower()] = cid
            created_customers.append(name)
        if cid:
            mapping[oid] = cid
    db.set_setting("ninja_org_map", mapping)

    created = updated = skipped = 0
    device_customer: dict[int, int] = {}
    for d in client.devices():
        cid = mapping.get(str(d.get("organizationId")))
        if not cid:
            skipped += 1
            continue
        device_customer[d.get("id")] = cid
        name = d.get("displayName") or d.get("systemName") or d.get("dnsName") or f"Gerät {d.get('id')}"
        data = {
            "name": name, "type": NODE_TYPES.get(str(d.get("nodeClass", "")).upper(), "pc"),
            "os": ((d.get("os") or {}).get("name") or "").strip(),
            "serial": ((d.get("system") or {}).get("serialNumber") or "").strip(),
            "last_seen": _iso_from_epoch(d.get("lastContact")),
        }
        existing = db.query_one("SELECT id FROM assets WHERE customer_id = ? AND lower(name) = lower(?)", (cid, name))
        if existing:
            db.update("assets", existing["id"], {k: v for k, v in data.items() if v})
            updated += 1
        else:
            db.insert("assets", {**data, "customer_id": cid, "notes": f"NinjaOne-ID {d.get('id')}"})
            created += 1

    tickets = 0
    if alert_tickets:
        seen = set(db.get_setting("ninja_alerts_seen", []) or [])
        for a in client.alerts():
            uid = str(a.get("uid") or a.get("id") or "")
            cid = device_customer.get(a.get("deviceId"))
            if not uid or uid in seen or not cid:
                continue
            msg = (a.get("message") or a.get("subject") or "RMM-Alarm").strip()
            severity = str(a.get("severity") or "").upper()
            db.insert("tickets", {"customer_id": cid, "title": f"RMM: {msg[:150]}", "status": "neu",
                                  "priority": "hoch" if severity in ("CRITICAL", "MAJOR") else "normal",
                                  "category": "Server/Backup" if "backup" in msg.lower() else "",
                                  "description": f"Automatisch aus NinjaOne-Alarm (Gerät {a.get('deviceId')}):\n{msg}"})
            seen.add(uid)
            tickets += 1
        db.set_setting("ninja_alerts_seen", sorted(seen)[-5000:])
    result = {"customers_created": created_customers, "assets_created": created, "assets_updated": updated,
              "devices_unmapped": skipped, "alert_tickets": tickets, "at": now_iso()}
    db.set_setting("ninja_last_sync", result)
    return result


def register(app: FastAPI, db: Database, settings, admin_only) -> NinjaOne:
    client = NinjaOne(settings.ninja_url, settings.ninja_client_id, settings.ninja_client_secret)

    @app.get("/api/rmm/status")
    def status() -> dict:
        return {"provider": "NinjaOne", "configured": client.configured, "url": settings.ninja_url,
                "sync_hours": settings.ninja_sync_hours, "alert_tickets": settings.ninja_alert_tickets,
                "last": db.get_setting("ninja_last_sync", None), "error": db.get_setting("ninja_error", "")}

    @app.post("/api/rmm/sync", dependencies=[Depends(admin_only)])
    def run_sync() -> dict:
        if not client.configured:
            raise HTTPException(409, "NinjaOne nicht eingerichtet (NINJA_URL, NINJA_CLIENT_ID, NINJA_CLIENT_SECRET in .env).")
        try:
            result = sync(db, client, alert_tickets=settings.ninja_alert_tickets)
            db.set_setting("ninja_error", "")
            return result
        except RmmError as exc:
            db.set_setting("ninja_error", str(exc))
            raise HTTPException(502, str(exc))

    if client.configured and settings.ninja_sync_hours > 0:
        def loop() -> None:
            time.sleep(90)
            while True:
                try:
                    sync(db, client, alert_tickets=settings.ninja_alert_tickets)
                    db.set_setting("ninja_error", "")
                except Exception as exc:  # noqa: BLE001
                    db.set_setting("ninja_error", str(exc))
                time.sleep(settings.ninja_sync_hours * 3600)

        threading.Thread(target=loop, name="meit-ninja-sync", daemon=True).start()
    return client
