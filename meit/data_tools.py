"""Daten rein, Daten sicher: CSV-Import (Kunden, Geräte, RMM-Exporte) und Datensicherung."""

from __future__ import annotations

import csv
import io
import re
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .db import Database, now_iso
from .growth import log_mrr

CUSTOMER_FIELDS = {
    "name": ["name", "kunde", "firma", "firmenname", "unternehmen", "organization", "organisation", "company", "customer"],
    "contact_name": ["ansprechpartner", "kontakt", "kontaktperson", "contact", "contact name"],
    "email": ["email", "e-mail", "mail", "e-mail-adresse", "emailadresse"],
    "phone": ["telefon", "tel", "phone", "telefonnummer", "mobil"],
    "address": ["adresse", "anschrift", "address", "strasse", "straße"],
    "industry": ["branche", "industry", "sektor"],
    "employees": ["mitarbeiter", "ma", "anzahl mitarbeiter", "employees", "benutzer", "user"],
    "package": ["paket", "package", "vertrag"],
    "mrr": ["mrr", "monatlich", "monatsumsatz", "monthly"],
    "contract_end": ["vertragsende", "contract end", "laufzeit bis"],
    "notes": ["notizen", "notiz", "notes", "bemerkung"],
}
ASSET_FIELDS = {
    "customer": ["kunde", "firma", "organization", "organisation", "organization name", "customer", "company",
                 "client", "mandant"],
    "name": ["name", "gerätename", "geraetename", "hostname", "computername", "device name", "display name",
             "system name", "gerät", "geraet", "device", "computer"],
    "type": ["typ", "type", "gerätetyp", "geraetetyp", "device type", "node class", "class", "rolle", "role"],
    "os": ["betriebssystem", "os", "os name", "operating system", "firmware", "os version", "system"],
    "serial": ["seriennummer", "serial", "serial number", "sn", "seriennr", "service tag"],
    "purchase_date": ["kaufdatum", "purchase date", "anschaffung", "install date", "installationsdatum"],
    "warranty_end": ["garantie bis", "garantie", "garantieende", "warranty", "warranty end", "warranty expiration"],
    "last_seen": ["zuletzt gesehen", "last seen", "last contact", "last online", "letzter kontakt", "last boot"],
    "notes": ["notizen", "notes", "bemerkung"],
}
TYPE_MAP = [
    ("server", "server"), ("laptop", "notebook"), ("notebook", "notebook"), ("firewall", "firewall"),
    ("switch", "switch"), ("access point", "accesspoint"), ("accesspoint", "accesspoint"), ("wlan", "accesspoint"),
    ("nas", "nas"), ("printer", "drucker"), ("drucker", "drucker"), ("phone", "smartphone"), ("handy", "smartphone"),
    ("workstation", "pc"), ("desktop", "pc"), ("pc", "pc"), ("client", "pc"),
]


def _norm_header(h: str) -> str:
    return re.sub(r"[\s_]+", " ", (h or "").replace("﻿", "").strip().lower())


def map_columns(headers: list[str], fields: dict[str, list[str]]) -> dict[str, str]:
    """Spaltenname → Feld. Erst exakte Synonyme, dann 'enthält'."""
    mapping: dict[str, str] = {}
    used: set[str] = set()
    normed = {h: _norm_header(h) for h in headers}
    for field, synonyms in fields.items():
        for h, n in normed.items():
            if h not in mapping and n in synonyms and field not in used:
                mapping[h] = field
                used.add(field)
    for field, synonyms in fields.items():
        if field in used:
            continue
        for h, n in normed.items():
            if h not in mapping and any(len(s) > 3 and s in n for s in synonyms):
                mapping[h] = field
                used.add(field)
                break
    return mapping


def parse_date(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", value)
    if m:
        y, mo, d = (int(x) for x in m.groups())
    else:
        m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{2,4})", value)
        if not m:
            return ""
        a, b, y = (int(x) for x in m.groups())
        d, mo = (a, b) if b <= 12 else (b, a)  # US-Format nur, wenn eindeutig
        y = y + 2000 if y < 100 else y
    try:
        return datetime(y, mo, d).date().isoformat()
    except ValueError:
        return ""


def parse_number(value: str) -> float:
    v = re.sub(r"[^\d,.\-]", "", value or "")
    if not v:
        return 0.0
    if "," in v and "." in v:
        v = v.replace(".", "").replace(",", ".") if v.rfind(",") > v.rfind(".") else v.replace(",", "")
    elif "," in v:
        v = v.replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return 0.0


def normalize_type(value: str, os_name: str = "") -> str:
    text = f"{value} {os_name}".lower()
    for needle, typ in TYPE_MAP:
        if needle in text:
            return typ
    return "pc"


def read_csv(text: str) -> tuple[list[str], list[dict[str, str]]]:
    text = text.lstrip("﻿")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = [{k: (v or "").strip() for k, v in row.items() if k} for row in reader]
    return list(reader.fieldnames or []), rows


def import_csv(db: Database, kind: str, text: str, commit: bool = False, create_customers: bool = True) -> dict[str, Any]:
    if kind not in ("customers", "assets"):
        raise ValueError("Art muss 'customers' oder 'assets' sein")
    headers, rows = read_csv(text)
    if not headers:
        raise ValueError("Keine Spaltenüberschriften gefunden")
    mapping = map_columns(headers, CUSTOMER_FIELDS if kind == "customers" else ASSET_FIELDS)
    if "name" not in mapping.values():
        raise ValueError("Keine Namensspalte erkannt (z. B. 'Firma', 'Name', 'Hostname', 'Device Name').")
    customers = {c["name"].strip().lower(): c["id"] for c in db.query("SELECT id, name FROM customers")}
    created = updated = 0
    skipped: list[dict[str, Any]] = []
    preview: list[dict[str, Any]] = []
    new_customers: list[str] = []

    for idx, raw in enumerate(rows, start=2):  # Zeile 1 = Überschrift
        rec = {field: raw.get(col, "") for col, field in mapping.items()}
        name = rec.get("name", "").strip()
        if not name:
            skipped.append({"row": idx, "reason": "kein Name"})
            continue
        if kind == "customers":
            data = {
                "name": name, "contact_name": rec.get("contact_name", ""), "email": rec.get("email", ""),
                "phone": rec.get("phone", ""), "address": rec.get("address", ""), "industry": rec.get("industry", ""),
                "employees": int(parse_number(rec.get("employees", ""))), "notes": rec.get("notes", ""),
                "package": (rec.get("package") or "keins").lower() if (rec.get("package") or "keins").lower() in
                ("keins", "basis", "pro", "premium") else "keins",
                "mrr": round(parse_number(rec.get("mrr", "")), 2), "contract_end": parse_date(rec.get("contract_end", "")),
                "booked_services": [],
            }
            if len(preview) < 20:
                preview.append(data)
            if name.lower() in customers:
                skipped.append({"row": idx, "reason": f"Kunde „{name}“ existiert bereits"})
                continue
            if commit:
                cid = db.insert("customers", data)
                customers[name.lower()] = cid
                log_mrr(db, cid, name, 0, data["mrr"], "import")
            created += 1
        else:
            cust_name = rec.get("customer", "").strip()
            cid = customers.get(cust_name.lower()) if cust_name else None
            if cid is None and cust_name:
                cid = next((v for k, v in customers.items() if k.startswith(cust_name.lower()) or cust_name.lower().startswith(k)), None)
            data = {
                "name": name, "os": rec.get("os", ""), "type": normalize_type(rec.get("type", ""), rec.get("os", "")),
                "serial": rec.get("serial", ""), "purchase_date": parse_date(rec.get("purchase_date", "")),
                "warranty_end": parse_date(rec.get("warranty_end", "")), "last_seen": parse_date(rec.get("last_seen", "")),
                "notes": rec.get("notes", ""),
            }
            if len(preview) < 20:
                preview.append({**data, "customer": cust_name or "–"})
            if cid is None:
                if not cust_name:
                    skipped.append({"row": idx, "reason": "keine Kundenspalte/kein Kunde"})
                    continue
                if not create_customers:
                    skipped.append({"row": idx, "reason": f"Kunde „{cust_name}“ unbekannt"})
                    continue
                if commit:
                    cid = db.insert("customers", {"name": cust_name, "booked_services": [], "notes": "Aus Geräte-Import angelegt"})
                else:
                    cid = -len(new_customers) - 1
                customers[cust_name.lower()] = cid
                new_customers.append(cust_name)
            existing = db.query_one("SELECT id FROM assets WHERE customer_id = ? AND lower(name) = lower(?)", (cid, name)) \
                if cid and cid > 0 else None
            if existing:
                if commit:
                    db.update("assets", existing["id"], {k: v for k, v in data.items() if v and k != "name"})
                updated += 1
            else:
                if commit:
                    db.insert("assets", {**data, "customer_id": cid})
                created += 1
    return {"kind": kind, "columns": mapping, "total": len(rows), "created": created, "updated": updated,
            "skipped": skipped, "new_customers": new_customers, "preview": preview, "committed": commit}


# ------------------------------------------------------------------ Datensicherung
def backup_dir(db_path: str, configured: str = "") -> Path:
    return Path(configured) if configured else Path(db_path).resolve().parent / "backups"


def create_backup(db_path: str, target_dir: Path, keep: int = 14) -> Path:
    """Konsistente Kopie per SQLite-Backup-API (funktioniert auch im laufenden Betrieb)."""
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"meit-{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.db"
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    backups = sorted(target_dir.glob("meit-*.db"))
    for old in backups[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)
    return target


def mirror_archive(archive_dir: Path, target_dir: Path) -> int:
    """Dokumentenarchiv inkrementell spiegeln (nur neue/geänderte Dateien, nichts wird gelöscht).

    Belege und Rechnungen unterliegen der 7-jährigen Aufbewahrungspflicht (§ 132 BAO) – darum wird im
    Sicherungsordner nie gelöscht, auch wenn eine Datei im Archiv entfernt wurde.
    """
    import shutil

    if not archive_dir.exists():
        return 0
    copied = 0
    for src in archive_dir.rglob("*"):
        if not src.is_file():
            continue
        dst = target_dir / src.relative_to(archive_dir)
        st = src.stat()
        if dst.exists() and dst.stat().st_size == st.st_size and dst.stat().st_mtime >= st.st_mtime:
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return copied


def list_backups(target_dir: Path) -> list[dict[str, Any]]:
    if not target_dir.exists():
        return []
    return [{"file": f.name, "size_kb": round(f.stat().st_size / 1024, 1),
             "created": datetime.fromtimestamp(f.stat().st_mtime).isoformat(sep=" ", timespec="seconds")}
            for f in sorted(target_dir.glob("meit-*.db"), reverse=True)]


def start_backup_scheduler(db: Database, db_path: str, target_dir: Path, hours: int, keep: int,
                           archive_dir: Path | None = None) -> threading.Thread:
    def loop() -> None:
        time.sleep(60)
        while True:
            try:
                create_backup(db_path, target_dir, keep)
                if archive_dir:
                    mirror_archive(archive_dir, target_dir / "archiv")
                db.set_setting("backup_last", now_iso())
                db.set_setting("backup_error", "")
            except Exception as exc:  # noqa: BLE001 - Fehler sichtbar machen, Schleife läuft weiter
                db.set_setting("backup_error", str(exc))
            time.sleep(max(1, hours) * 3600)

    thread = threading.Thread(target=loop, name="meit-backup", daemon=True)
    thread.start()
    return thread
