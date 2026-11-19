"""Geräte-Check mit eigenem Inventar-Agenten – **nur lesend**.

Der Agent (PowerShell, geplanter Task als SYSTEM) meldet alle paar Stunden den Zustand des Geräts ans Cockpit:
Hardware, Windows-Version, Verschlüsselung (BitLocker), Virenschutz, Firewall, Updates, Speicherplatz, lokale
Administratoren, installierte Software. Das Cockpit leitet daraus Befunde ab.

Sicherheitsprinzipien
* **Einbahnstraße**: Der Agent sendet Daten, das Cockpit antwortet nur mit „ok“. Es gibt keinen Befehlskanal –
  über diesen Weg kann niemand Software verteilen oder Geräte steuern (anders als bei einem RMM-Agenten).
* Verbindung nur vom Gerät nach außen (HTTPS), beim Kunden muss kein Port geöffnet werden.
* **Registrierung** mit einem Schlüssel je Kunde (befristet, widerrufbar). Danach hat jedes Gerät ein eigenes
  Token; im Cockpit sind nur Prüfsummen gespeichert. Ein Gerät lässt sich einzeln sperren.
* Eingehende Daten werden begrenzt und bereinigt (Größe, Felder, Längen) und zählen als nicht vertrauenswürdig.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso
from .radar import eol_info

AGENT_FILE = Path(__file__).parent / "static" / "agent" / "meit-agent.ps1"
INTERVAL_HOURS = 6
OFFLINE_DAYS = 14
SEVERITY = {"kritisch": 0, "hoch": 1, "mittel": 2, "niedrig": 3, "info": 4}
WEIGHT = {"kritisch": 45, "hoch": 22, "mittel": 10, "niedrig": 4, "info": 0}
BUILTIN_ADMIN = re.compile(r"(\\|^)(administrator|administratoren|domain admins|domänen-admins|dom[äa]nen-admins|"
                           r"enterprise admins|organisations-admins)$", re.I)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ----------------------------------------------------------------------------- Eingehende Daten bereinigen
def _s(v: Any, n: int = 200) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(v if v is not None else ""))[:n].strip()


def _f(v: Any) -> float | None:
    try:
        x = float(v)
        return x if -1e12 < x < 1e12 else None
    except (TypeError, ValueError):
        return None


def _b(v: Any) -> bool | None:
    return v if isinstance(v, bool) else None


def sanitize(raw: Any) -> dict[str, Any]:
    """Nur bekannte Felder, begrenzte Längen – der Agent läuft auf fremden Geräten."""
    d = raw if isinstance(raw, dict) else {}
    os_ = d.get("os") if isinstance(d.get("os"), dict) else {}
    upd = d.get("updates") if isinstance(d.get("updates"), dict) else {}
    bl = d.get("bitlocker") if isinstance(d.get("bitlocker"), dict) else {}
    tpm = d.get("tpm") if isinstance(d.get("tpm"), dict) else {}
    df = d.get("defender") if isinstance(d.get("defender"), dict) else {}
    fw = d.get("firewall") if isinstance(d.get("firewall"), dict) else {}
    lst = lambda key, n: [x for x in (d.get(key) if isinstance(d.get(key), list) else [])][:n]  # noqa: E731
    return {
        "agent_version": _s(d.get("agent_version"), 20), "hostname": _s(d.get("hostname"), 63), "domain": _s(d.get("domain"), 120),
        "user": _s(d.get("user"), 120), "manufacturer": _s(d.get("manufacturer"), 80), "model": _s(d.get("model"), 120),
        "serial": _s(d.get("serial"), 80), "cpu": _s(d.get("cpu"), 120), "ram_gb": _f(d.get("ram_gb")),
        "chassis": _s(d.get("chassis"), 12) if _s(d.get("chassis"), 12) in ("laptop", "desktop", "server", "vm") else "desktop",
        "os": {"caption": _s(os_.get("caption"), 120), "version": _s(os_.get("version"), 40), "build": _s(os_.get("build"), 20),
               "install_date": _s(os_.get("install_date"), 25), "last_boot": _s(os_.get("last_boot"), 25),
               "server": bool(os_.get("server"))},
        "disks": [{"drive": _s(x.get("drive"), 8), "size_gb": _f(x.get("size_gb")), "free_gb": _f(x.get("free_gb"))}
                  for x in lst("disks", 16) if isinstance(x, dict)],
        "bitlocker": {"os_drive": _s(bl.get("os_drive"), 10) if _s(bl.get("os_drive"), 10) in ("on", "off") else "unknown",
                      "method": _s(bl.get("method"), 40)},
        "tpm": {"present": _b(tpm.get("present")), "version": _s(tpm.get("version"), 10)},
        "secure_boot": _b(d.get("secure_boot")),
        "antivirus": [{"name": _s(x.get("name"), 80), "enabled": _b(x.get("enabled")), "up_to_date": _b(x.get("up_to_date"))}
                      for x in lst("antivirus", 8) if isinstance(x, dict)],
        "defender": {"realtime": _b(df.get("realtime")), "signature_age_days": _f(df.get("signature_age_days")),
                     "tamper": _b(df.get("tamper"))},
        "firewall": {k: _b(fw.get(k)) for k in ("domain", "private", "public")},
        "updates": {"last_installed": _s(upd.get("last_installed"), 25), "pending_reboot": _b(upd.get("pending_reboot"))},
        "local_admins": [_s(x, 120) for x in lst("local_admins", 30)],
        "rdp_enabled": _b(d.get("rdp_enabled")),
        "software": [{"name": _s(x.get("name"), 120), "version": _s(x.get("version"), 40), "publisher": _s(x.get("publisher"), 80)}
                     for x in lst("software", 400) if isinstance(x, dict) and _s(x.get("name"), 120)],
        "collected_at": _s(d.get("collected_at"), 25),
    }


def _date(value: str) -> date | None:
    try:
        return datetime.fromisoformat((value or "")[:19]).date()
    except ValueError:
        return None


# ----------------------------------------------------------------------------- Befunde
def device_findings(data: dict[str, Any], last_seen: str, today: date | None = None) -> list[dict[str, Any]]:
    today = today or date.today()
    out: list[dict[str, Any]] = []

    def add(key: str, severity: str, title: str, detail: str, action: str) -> None:
        out.append({"key": key, "severity": severity, "title": title, "detail": detail, "action": action})

    seen = _date(last_seen)
    if seen and (today - seen).days > OFFLINE_DAYS:
        add("offline", "niedrig", f"Seit {(today - seen).days} Tagen keine Meldung",
            "Gerät ausgeschaltet, außer Betrieb oder der Agent läuft nicht mehr – die übrigen Angaben sind veraltet.",
            "Klären, ob das Gerät noch im Einsatz ist; sonst aus dem Geräte-Check entfernen.")
    os_ = data.get("os") or {}
    server = bool(os_.get("server")) or data.get("chassis") == "server"
    vm = data.get("chassis") == "vm"
    laptop = data.get("chassis") == "laptop"

    info = eol_info(os_.get("caption", ""))
    if info:
        eol, label = info
        if eol <= today:
            add("os-eol", "hoch", f"{label}: keine Sicherheitsupdates mehr", f"Herstellersupport endete am {eol.strftime('%d.%m.%Y')}.",
                "Auf eine unterstützte Version umstellen bzw. Gerät ersetzen.")
        elif eol <= today + timedelta(days=180):
            add("os-eol", "mittel", f"{label}: Support endet am {eol.strftime('%d.%m.%Y')}", "Umstellung rechtzeitig einplanen.",
                "Upgrade oder Ersatz planen.")

    bl = (data.get("bitlocker") or {}).get("os_drive")
    if bl == "off" and not vm:
        add("bitlocker", "hoch" if laptop else "mittel", "Festplatte nicht verschlüsselt (BitLocker aus)",
            "Bei Verlust oder Diebstahl sind alle Daten lesbar" + (" – bei Notebooks besonders kritisch (DSGVO-Meldepflicht)." if laptop else "."),
            "BitLocker aktivieren, Wiederherstellungsschlüssel sicher ablegen (Entra ID bzw. Keeper).")

    avs = data.get("antivirus") or []
    df = data.get("defender") or {}
    av_on = any(a.get("enabled") for a in avs) or df.get("realtime") is True
    av_known = bool(avs) or df.get("realtime") is not None
    if av_known and not av_on:
        add("av-off", "kritisch", "Kein aktiver Virenschutz", "Weder Defender-Echtzeitschutz noch ein anderes Schutzprogramm ist aktiv.",
            "Virenschutz/EDR sofort aktivieren und Gerät prüfen.")
    else:
        age = df.get("signature_age_days")
        stale = [a["name"] for a in avs if a.get("enabled") and a.get("up_to_date") is False]
        if (age is not None and age > 7) or stale:
            add("av-old", "mittel", "Virenschutz nicht aktuell",
                f"Signaturen {int(age)} Tage alt." if age is not None and age > 7 else f"Nicht aktuell: {', '.join(stale)}.",
                "Update-Verbindung des Virenschutzes prüfen.")

    fw = data.get("firewall") or {}
    off = [k for k in ("domain", "private", "public") if fw.get(k) is False]
    if off:
        names = {"domain": "Domäne", "private": "Privat", "public": "Öffentlich"}
        add("firewall", "hoch" if "public" in off else "mittel", "Windows-Firewall teilweise aus",
            "Deaktivierte Profile: " + ", ".join(names[k] for k in off) + ".", "Firewall-Profile aktivieren (Richtlinie prüfen).")

    last_upd = _date((data.get("updates") or {}).get("last_installed", ""))
    ref = seen or today
    if last_upd:
        days = (ref - last_upd).days
        if days > 45:
            add("updates", "hoch", f"Seit {days} Tagen keine Updates installiert", "Monatliche Sicherheitsupdates fehlen.",
                "Windows Update/Patch-Management prüfen, Updates einspielen.")
        elif days > 35:
            add("updates", "mittel", f"Letztes Update vor {days} Tagen", "Der letzte Patchday wurde noch nicht eingespielt.",
                "Updates einspielen.")
    boot = _date(os_.get("last_boot", ""))
    if (data.get("updates") or {}).get("pending_reboot") and boot and (ref - boot).days > 14:
        add("reboot", "niedrig", f"Neustart seit {(ref - boot).days} Tagen ausständig",
            "Updates sind installiert, werden aber erst nach einem Neustart wirksam.", "Neustart mit dem Benutzer abstimmen.")

    system = next((x for x in data.get("disks") or [] if (x.get("drive") or "").upper().startswith("C")), None) or \
        next(iter(data.get("disks") or []), None)
    if system and system.get("size_gb") and system.get("free_gb") is not None:
        pct = 100 * system["free_gb"] / system["size_gb"]
        if pct < 10 or system["free_gb"] < 10:
            add("disk", "hoch", f"Laufwerk {system['drive']} fast voll ({system['free_gb']:.0f} GB frei)",
                "Updates schlagen fehl, das System wird instabil.", "Aufräumen bzw. Speicher erweitern.")
        elif pct < 15:
            add("disk", "mittel", f"Laufwerk {system['drive']}: nur noch {pct:.0f} % frei", "Speicherplatz wird knapp.", "Aufräumen einplanen.")

    admins = [a for a in data.get("local_admins") or [] if a]
    user = (data.get("user") or "").lower()
    if user and not server and any(a.lower() == user for a in admins):
        add("admin-user", "mittel", "Benutzer arbeitet mit Administratorrechten",
            f"{data.get('user')} ist Mitglied der lokalen Administratoren – Schadsoftware erhält damit sofort volle Rechte.",
            "Auf Standardbenutzer umstellen, Admin-Aufgaben über getrenntes Konto.")
    extra = [a for a in admins if not BUILTIN_ADMIN.search(a)]
    if len(extra) > 3:
        add("admins-many", "niedrig", f"{len(extra)} zusätzliche lokale Administratoren", ", ".join(extra[:8]),
            "Mitglieder der Administratorengruppe bereinigen.")
    if data.get("rdp_enabled") and not server:
        add("rdp", "niedrig", "Remotedesktop (RDP) ist aktiviert", "Auf Arbeitsplätzen selten nötig und ein beliebtes Angriffsziel.",
            "Deaktivieren, wenn nicht benötigt; niemals direkt aus dem Internet erreichbar machen.")
    caption = (os_.get("caption") or "").lower()
    tpm = data.get("tpm") or {}
    if "windows 10" in caption and not vm and (tpm.get("present") is False or (tpm.get("version") and not tpm["version"].startswith("2"))
                                              or data.get("secure_boot") is False):
        add("win11", "info", "Nicht Windows-11-fähig (TPM 2.0/Secure Boot)", "Ein Upgrade auf Windows 11 ist auf dieser Hardware nicht möglich.",
            "Ersatzgerät einplanen.")
    if data.get("ram_gb") and data["ram_gb"] < 8 and not server and not vm:
        add("ram", "niedrig", f"Nur {data['ram_gb']:.0f} GB Arbeitsspeicher", "Für aktuelle Office-/Teams-Nutzung zu wenig.", "Aufrüsten oder ersetzen.")
    out.sort(key=lambda f: SEVERITY[f["severity"]])
    return out


def score_of(findings: list[dict[str, Any]]) -> int:
    return max(0, 100 - sum(WEIGHT[f["severity"]] for f in findings))


# ----------------------------------------------------------------------------- Dienst
class Inventory:
    def __init__(self, db: Database):
        self.db = db

    # -- Registrierungsschlüssel
    def create_key(self, customer_id: int, days: int = 30) -> dict[str, Any]:
        key = "meit-" + secrets.token_hex(20)
        expires = (datetime.now() + timedelta(days=days)).replace(microsecond=0).isoformat(sep=" ") if days else ""
        kid = self.db.insert("agent_keys", {"customer_id": customer_id, "key_hash": _hash(key), "hint": key[-4:], "expires_at": expires})
        return {"id": kid, "key": key, "expires_at": expires}

    def keys(self, customer_id: int | None = None) -> list[dict[str, Any]]:
        sql = ("SELECT k.id, k.customer_id, c.name AS customer, k.hint, k.expires_at, k.uses, k.active, k.created_at FROM agent_keys k "
               "JOIN customers c ON c.id = k.customer_id")
        rows = self.db.query(sql + (" WHERE k.customer_id = ?" if customer_id else "") + " ORDER BY k.id DESC",
                             (customer_id,) if customer_id else ())
        now = now_iso()
        for r in rows:
            r["valid"] = bool(r["active"]) and (not r["expires_at"] or r["expires_at"] > now)
        return rows

    # -- Agent
    def enroll(self, key: str, hostname: str, serial: str, ip: str = "") -> dict[str, Any]:
        k = self.db.query_one("SELECT * FROM agent_keys WHERE key_hash = ? AND active = 1", (_hash(key or ""),))
        if not k or (k["expires_at"] and k["expires_at"] <= now_iso()):
            raise PermissionError("Registrierungsschlüssel ungültig oder abgelaufen.")
        hostname, serial = _s(hostname, 63), _s(serial, 80)
        if not hostname:
            raise ValueError("Gerätename fehlt.")
        token = secrets.token_urlsafe(32)
        existing = None
        if serial and serial.lower() not in ("to be filled by o.e.m.", "default string", "system serial number", "none", "0"):
            existing = self.db.query_one("SELECT id FROM agent_devices WHERE customer_id = ? AND serial = ? AND serial != ''",
                                         (k["customer_id"], serial))
        if not existing:
            existing = self.db.query_one("SELECT id FROM agent_devices WHERE customer_id = ? AND lower(hostname) = lower(?)",
                                         (k["customer_id"], hostname))
        fields = {"hostname": hostname, "serial": serial, "token_hash": _hash(token), "enrolled_at": now_iso(), "last_ip": ip,
                  "active": True}
        if existing:  # Neuinstallation: altes Token wird ungültig
            self.db.update("agent_devices", existing["id"], fields)
            did = existing["id"]
        else:
            did = self.db.insert("agent_devices", {"customer_id": k["customer_id"], **fields})
        self.db.query("UPDATE agent_keys SET uses = uses + 1 WHERE id = ?", (k["id"],))
        return {"token": token, "device_id": did, "interval_hours": INTERVAL_HOURS}

    def checkin(self, token: str, payload: Any, ip: str = "") -> dict[str, Any]:
        dev = self.db.query_one("SELECT * FROM agent_devices WHERE token_hash = ?", (_hash(token or ""),)) if token else None
        if not dev:
            raise PermissionError("Unbekanntes Gerät.")
        if not dev["active"]:
            raise PermissionError("Gerät ist gesperrt.")
        data = sanitize(payload)
        patch = {"data": json.dumps(data, ensure_ascii=False), "last_seen": now_iso(), "last_ip": ip,
                 "agent_version": data["agent_version"]}
        if data["hostname"]:
            patch["hostname"] = data["hostname"]
        if data["serial"]:
            patch["serial"] = data["serial"]
        self.db.update("agent_devices", dev["id"], patch)
        self._sync_asset({**dev, **patch}, data)
        return {"ok": True, "interval_hours": INTERVAL_HOURS}

    def _sync_asset(self, dev: dict[str, Any], data: dict[str, Any]) -> None:
        db = self.db
        asset = db.get("assets", dev["asset_id"]) if dev.get("asset_id") else None
        if not asset and data["serial"]:
            asset = db.query_one("SELECT * FROM assets WHERE customer_id = ? AND serial = ? AND serial != ''",
                                 (dev["customer_id"], data["serial"]))
        if not asset:
            asset = db.query_one("SELECT * FROM assets WHERE customer_id = ? AND lower(name) = lower(?)",
                                 (dev["customer_id"], dev["hostname"]))
        os_text = " ".join(x for x in ((data["os"]["caption"] or "").replace("Microsoft ", ""), data["os"]["version"]) if x)[:120]
        kind = {"laptop": "notebook", "server": "server", "vm": "server"}.get(data["chassis"], "pc")
        fields = {"os": os_text, "serial": data["serial"], "last_seen": dev["last_seen"]}
        if asset:
            db.update("assets", asset["id"], {k: v for k, v in fields.items() if v})
            aid = asset["id"]
        else:
            note = " ".join(x for x in (data["manufacturer"], data["model"]) if x)
            aid = db.insert("assets", {"customer_id": dev["customer_id"], "name": dev["hostname"], "type": kind,
                                       "notes": f"{note} · vom Inventar-Agenten angelegt".strip(" ·"), **fields})
        if dev.get("asset_id") != aid:
            db.update("agent_devices", dev["id"], {"asset_id": aid})

    # -- Auswertung
    def _view(self, r: dict[str, Any], today: date | None = None, full: bool = False) -> dict[str, Any]:
        data = loads(r["data"], {}) or {}
        ignored = set(loads(r["ignored"], []) or [])
        fs = [{**f, "ignored": f["key"] in ignored} for f in device_findings(data, r["last_seen"], today)] if data else []
        open_ = [f for f in fs if not f["ignored"] and f["severity"] != "info"]
        os_ = data.get("os") or {}
        system = next((x for x in data.get("disks") or [] if (x.get("drive") or "").upper().startswith("C")), None)
        out = {"id": r["id"], "customer_id": r["customer_id"], "customer": r.get("customer"), "asset_id": r["asset_id"],
               "hostname": r["hostname"], "serial": r["serial"], "active": bool(r["active"]), "last_seen": r["last_seen"],
               "enrolled_at": r["enrolled_at"], "agent_version": r["agent_version"], "ticket_id": r["ticket_id"],
               "reported": bool(data), "os": (os_.get("caption") or "").replace("Microsoft ", ""), "model": data.get("model", ""),
               "chassis": data.get("chassis", ""), "user": data.get("user", ""),
               "bitlocker": (data.get("bitlocker") or {}).get("os_drive", "unknown"),
               "disk_free_gb": system.get("free_gb") if system else None,
               "score": score_of(open_) if data else None, "findings": fs,
               "counts": {s: len([f for f in open_ if f["severity"] == s]) for s in ("kritisch", "hoch", "mittel", "niedrig")},
               "top": open_[0]["title"] if open_ else ""}
        if full:
            out["data"] = data
        return out

    def devices(self, customer_id: int | None = None, today: date | None = None) -> list[dict[str, Any]]:
        sql = "SELECT d.*, c.name AS customer FROM agent_devices d JOIN customers c ON c.id = d.customer_id"
        rows = self.db.query(sql + (" WHERE d.customer_id = ?" if customer_id else "") + " ORDER BY c.name, d.hostname",
                             (customer_id,) if customer_id else ())
        out = [self._view(r, today) for r in rows]
        out.sort(key=lambda d: (d["score"] if d["score"] is not None else 101, d["hostname"].lower()))
        return out

    def get(self, did: int, full: bool = True) -> dict[str, Any] | None:
        r = self.db.query_one("SELECT d.*, c.name AS customer FROM agent_devices d JOIN customers c ON c.id = d.customer_id "
                              "WHERE d.id = ?", (did,))
        return self._view(r, full=full) if r else None

    def summary(self, devices: list[dict[str, Any]]) -> dict[str, Any]:
        rep = [d for d in devices if d["reported"] and d["active"]]
        return {"devices": len(devices), "reported": len(rep), "healthy": len([d for d in rep if not any(d["counts"].values())]),
                "critical": sum(d["counts"]["kritisch"] for d in rep), "high": sum(d["counts"]["hoch"] for d in rep),
                "unencrypted": len([d for d in rep if d["bitlocker"] == "off"]),
                "offline": len([d for d in rep if any(f["key"] == "offline" for f in d["findings"])])}

    def ticket_for(self, did: int) -> int:
        d = self.get(did)
        if not d:
            raise LookupError("Gerät nicht gefunden")
        if d["ticket_id"] and (t := self.db.get("tickets", d["ticket_id"])) and t["status"] != "geloest":
            return d["ticket_id"]
        open_ = [f for f in d["findings"] if not f["ignored"] and f["severity"] != "info"]
        if not open_:
            raise ValueError("Keine offenen Befunde")
        prio = {"kritisch": "kritisch", "hoch": "hoch", "mittel": "normal"}.get(open_[0]["severity"], "niedrig")
        lines = [f"Gerät {d['hostname']} ({d['model'] or d['os']}), Benutzer {d['user'] or '–'}", ""]
        for f in open_:
            lines += [f"• [{f['severity']}] {f['title']}", f"  {f['detail']}", f"  → {f['action']}", ""]
        tid = self.db.insert("tickets", {"customer_id": d["customer_id"], "title": f"Geräte-Check {d['hostname']}: {open_[0]['title']}"
                                         + (f" (+{len(open_) - 1})" if len(open_) > 1 else ""), "description": "\n".join(lines).strip(),
                                         "status": "neu", "priority": prio, "category": "Sicherheit"})
        self.db.update("agent_devices", did, {"ticket_id": tid})
        return tid

    def opportunities(self, customer_id: int, today: date | None = None) -> list[dict[str, Any]]:
        devs = [d for d in self.devices(customer_id, today) if d["reported"] and d["active"]]
        keys = ("bitlocker", "av-off", "av-old", "firewall", "admin-user", "updates")
        hit = [d for d in devs if any(f["key"] in keys and not f["ignored"] for f in d["findings"])]
        if not hit:
            return []
        parts = []
        for key, label in (("bitlocker", "ohne Verschlüsselung"), ("av-off", "ohne Virenschutz"), ("updates", "ohne aktuelle Updates"),
                           ("admin-user", "mit Admin-Benutzer"), ("firewall", "Firewall aus")):
            n = len([d for d in hit if any(f["key"] == key and not f["ignored"] for f in d["findings"])])
            if n:
                parts.append(f"{n} {label}")
        critical = any(d["counts"]["kritisch"] for d in hit)
        return [{"kind": "security", "title": f"Arbeitsplätze absichern ({len(hit)} Geräte)",
                 "reason": "Geräte-Check: " + ", ".join(parts) + ".", "code": "STD", "hours": round(0.75 * len(hit) + 1, 1),
                 "priority": 3 if critical or len(hit) >= 3 else 2}]

    def portal_health(self, customer_id: int) -> dict[int, dict[str, Any]]:
        out = {}
        for d in self.devices(customer_id):
            if not (d["asset_id"] and d["reported"] and d["active"]):
                continue
            keys = {f["key"] for f in d["findings"] if not f["ignored"]}
            out[d["asset_id"]] = {"encrypted": None if d["bitlocker"] == "unknown" else d["bitlocker"] == "on",
                                  "antivirus": "av-off" not in keys and "av-old" not in keys,
                                  "updates": "updates" not in keys and "os-eol" not in keys, "last_seen": d["last_seen"][:10]}
        return out


def report_lines(db: Database, customer_id: int) -> tuple[list[str], dict[str, Any]]:
    inv = Inventory(db)
    s = inv.summary(inv.devices(customer_id))
    if not s["reported"]:
        return [], {}
    line = f"- Geräte-Check: **{s['healthy']} von {s['reported']}** Geräten ohne Befund"
    extra = [x for x in (f"{s['unencrypted']} unverschlüsselt" if s["unencrypted"] else "",
                         f"{s['critical']} kritische Befunde" if s["critical"] else "") if x]
    return [line + (f" ({', '.join(extra)})" if extra else "")], {"geraete": s["reported"], "ohne_befund": s["healthy"]}


# ----------------------------------------------------------------------------- API
class KeyIn(BaseModel):
    customer_id: int
    days: int = Field(30, ge=0, le=365)


class EnrollIn(BaseModel):
    key: str = Field(..., min_length=10, max_length=80)
    hostname: str = Field(..., min_length=1, max_length=63)
    serial: str = Field("", max_length=80)


class IgnoreIn(BaseModel):
    ignore: bool = True


def register(app: FastAPI, ctx: Any, settings: Any, admin_only) -> Inventory:
    from .mitarbeiter_api import RateLimiter

    db: Database = ctx.db
    svc = Inventory(db)
    app.state.inventory = svc
    enroll_limiter = RateLimiter(limit=30, window_s=3600)
    checkin_limiter = RateLimiter(limit=20, window_s=3600)

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "?"

    def base_url(request: Request) -> str:
        return (settings.public_url or str(request.base_url)).rstrip("/")

    # --- Agent (öffentlich erreichbar, eigene Anmeldung per Schlüssel/Token) ---------------------
    @app.post("/api/public/agent/enroll", status_code=201)
    def enroll(data: EnrollIn, request: Request) -> dict:
        ip = client_ip(request)
        if not enroll_limiter.allow(f"enroll:{ip}"):
            raise HTTPException(429, "Zu viele Registrierungen – bitte später erneut.")
        try:
            return svc.enroll(data.key, data.hostname, data.serial, ip)
        except PermissionError as exc:
            raise HTTPException(403, str(exc))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.post("/api/public/agent/checkin")
    async def checkin(request: Request) -> dict:
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not token:
            raise HTTPException(401, "Token fehlt.")
        if not checkin_limiter.allow(f"checkin:{_hash(token)[:16]}"):
            raise HTTPException(429, "Zu viele Meldungen.")
        try:
            payload = json.loads(await request.body() or b"{}")
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "Ungültige Daten.")
        try:
            return svc.checkin(token, payload, client_ip(request))  # Antwort enthält bewusst keine Befehle
        except PermissionError as exc:
            raise HTTPException(403, str(exc))

    # --- Cockpit ----------------------------------------------------------------------------------
    @app.get("/api/inventory")
    def overview(customer_id: Optional[int] = None) -> dict:
        devices = svc.devices(customer_id)
        return {"summary": svc.summary(devices), "devices": devices, "keys": svc.keys(customer_id)}

    @app.get("/api/inventory/agent.ps1")
    def agent_script() -> Response:
        return Response(AGENT_FILE.read_bytes(), media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="meit-agent.ps1"'})

    @app.post("/api/inventory/keys", status_code=201)
    def new_key(data: KeyIn, request: Request) -> dict:
        if not db.get("customers", data.customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        k = svc.create_key(data.customer_id, data.days)
        server = base_url(request)
        return {**k, "server": server, "https": server.startswith("https://"),
                "command": f'powershell -ExecutionPolicy Bypass -File meit-agent.ps1 -Install -Server "{server}" -Key "{k["key"]}"'}

    @app.delete("/api/inventory/keys/{kid}")
    def revoke_key(kid: int) -> dict:
        if not db.get("agent_keys", kid):
            raise HTTPException(404, "Schlüssel nicht gefunden")
        db.update("agent_keys", kid, {"active": False})
        return {"ok": True}

    @app.get("/api/inventory/{did}")
    def device(did: int) -> dict:
        d = svc.get(did)
        if not d:
            raise HTTPException(404, "Gerät nicht gefunden")
        return d

    @app.post("/api/inventory/{did}/findings/{key}/ignore")
    def ignore(did: int, key: str, data: IgnoreIn) -> dict:
        r = db.get("agent_devices", did)
        if not r:
            raise HTTPException(404, "Gerät nicht gefunden")
        keys = set(loads(r["ignored"], []) or [])
        db.update("agent_devices", did, {"ignored": sorted(keys | {key} if data.ignore else keys - {key})})
        return {"ok": True}

    @app.post("/api/inventory/{did}/ticket", status_code=201)
    def ticket(did: int) -> dict:
        try:
            return {"ticket_id": svc.ticket_for(did)}
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))

    @app.put("/api/inventory/{did}/active")
    def set_active(did: int, data: IgnoreIn) -> dict:
        """Gerät sperren (ignore=true) bzw. wieder zulassen – ein gesperrtes Gerät kann nichts mehr melden."""
        if not db.get("agent_devices", did):
            raise HTTPException(404, "Gerät nicht gefunden")
        db.update("agent_devices", did, {"active": not data.ignore})
        return svc.get(did, full=False)

    @app.delete("/api/inventory/{did}", dependencies=[Depends(admin_only)])
    def delete(did: int) -> dict:
        if not db.delete("agent_devices", did):
            raise HTTPException(404, "Gerät nicht gefunden")
        return {"ok": True}

    return svc
