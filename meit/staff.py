"""Ein- und Austritte von Mitarbeitern beim Kunden – als Checkliste mit Ticket, ohne dass etwas vergessen wird.

* Eintritt: Konto, Lizenz, MFA, Gerät, Keeper, Berechtigungen, Einweisung.
* Austritt: Sperre zum Stichtag, Postfach (freigegeben/weiterleiten/löschen), Datenübergabe, Gerät zurück,
  Lizenz frei, Keeper-Zugänge prüfen.
* Beim Abschluss passt das Cockpit die **Lizenzanzahl** (und damit die nächste Rechnung) sowie die Mitarbeiterzahl an.
* Kunden können Ein-/Austritte im **Kundenportal** melden und den Fortschritt sehen.
Die Vorlagen sind unter Einstellungen anpassbar; „?geraet“ am Zeilenanfang = Schritt nur, wenn das Feld gesetzt ist.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso
from .team import log_activity

KINDS = {"eintritt": "Eintritt", "austritt": "Austritt"}
MAILBOX = {"freigegeben": "in freigegebenes Postfach umwandeln (Zugriff für {uebergabe})",
           "weiterleiten": "Weiterleitung an {weiterleitung} einrichten (befristet)", "loeschen": "nach Datensicherung löschen"}
DEVICE = {"neu": "neues Gerät beschaffen und einrichten", "vorhanden": "vorhandenes Gerät neu aufsetzen", "kein": ""}

DEFAULT_TEMPLATES = {
    "eintritt": [
        "Benutzerkonto in Microsoft 365 anlegen ({person}, Abteilung {abteilung})",
        "?lizenz Lizenz zuweisen: {lizenz}",
        "MFA einrichten (Authenticator-App) – beim ersten Anmelden begleiten",
        "?geraet Gerät: {geraet} (Intune/Autopilot, Updates, Virenschutz/EDR, BitLocker)",
        "?geraet Gerät im Cockpit erfassen (Inventar, Garantie)",
        "Gruppen, Teams, SharePoint- und Ordnerberechtigungen nach Vorgabe vergeben",
        "Zugänge in Keeper anlegen bzw. freigeben",
        "?telefon Telefon/Teams-Telefonie einrichten",
        "E-Mail-Signatur einrichten",
        "Kurzeinweisung + Security-Awareness (Phishing, Passwörter, Meldeweg)",
    ],
    "austritt": [
        "Anmeldung zum Stichtag {datum} sperren und alle Sitzungen abmelden",
        "Passwort zurücksetzen, MFA-Methoden entfernen",
        "?postfach Postfach: {postfach}",
        "Abwesenheitsnotiz mit neuem Ansprechpartner einrichten",
        "?uebergabe OneDrive-/Dateien an {uebergabe} übergeben",
        "Aus Gruppen, Teams und Verteilerlisten entfernen",
        "?lizenz Lizenz entfernen: {lizenz}",
        "Keeper: geteilte Zugänge prüfen, Passwörter gemeinsam genutzter Konten ändern",
        "Externe Zugänge (Banking, Portale, Lieferanten) beim Kunden abmelden lassen",
        "?geraet Gerät zurücknehmen, Daten sichern, zurücksetzen, Inventar aktualisieren",
    ],
}


def templates(db: Database) -> dict[str, list[str]]:
    stored = db.get_setting("staff_templates", {}) or {}
    return {k: [str(x) for x in stored.get(k) or []] or list(v) for k, v in DEFAULT_TEMPLATES.items()}


def build_checklist(tpl: list[str], values: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for line in tpl:
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^\?(\w+)\s+(.*)$", line)
        if m:
            if not (values.get(m.group(1)) or "").strip():
                continue
            line = m.group(2)
        text = re.sub(r"\{(\w+)\}", lambda x: (values.get(x.group(1)) or "–").strip() or "–", line)
        out.append({"text": text, "done": False, "done_at": "", "by": ""})
    return out


def _values(kind: str, person: str, due: str, d: dict[str, Any]) -> dict[str, str]:
    try:
        datum = date.fromisoformat(due).strftime("%d.%m.%Y") if due else ""
    except ValueError:
        datum = due
    uebergabe = d.get("handover_to") or ""
    postfach = (MAILBOX.get(d.get("mailbox") or "") or "").format(uebergabe=uebergabe or "Vorgesetzte/n",
                                                                     weiterleitung=d.get("forward_to") or uebergabe or "–")
    return {"person": person, "datum": datum, "abteilung": d.get("department") or "–", "lizenz": d.get("license") or "",
            "geraet": DEVICE.get(d.get("device") or "", d.get("device") or ""), "telefon": "ja" if d.get("phone") else "",
            "postfach": postfach, "uebergabe": uebergabe, "weiterleitung": d.get("forward_to") or ""}


class StaffIn(BaseModel):
    customer_id: int
    kind: str = Field(..., pattern="^(eintritt|austritt)$")
    person: str = Field(..., min_length=2, max_length=120)
    email: str = Field("", max_length=200)
    due_date: str = Field("", max_length=10)
    department: str = Field("", max_length=120)
    job_title: str = Field("", max_length=120)
    license: str = Field("", max_length=120)
    subscription_id: Optional[int] = None
    device: str = Field("", max_length=60)
    phone: bool = False
    mailbox: str = Field("", max_length=20)
    forward_to: str = Field("", max_length=200)
    handover_to: str = Field("", max_length=120)
    notes: str = Field("", max_length=3000)
    m365_user: str = Field("", max_length=80)
    adjust_license: bool = True


class CheckIn(BaseModel):
    index: int = Field(..., ge=0, le=100)
    done: bool = True


class StaffUpdate(BaseModel):
    due_date: Optional[str] = Field(None, max_length=10)
    notes: Optional[str] = Field(None, max_length=3000)
    subscription_id: Optional[int] = None
    add_step: Optional[str] = Field(None, max_length=300)


class TemplatesIn(BaseModel):
    eintritt: list[str] = Field(default_factory=list, max_length=60)
    austritt: list[str] = Field(default_factory=list, max_length=60)


class StaffService:
    def __init__(self, db: Database, triage: Any = None):
        self.db = db
        self.triage = triage

    def create(self, data: StaffIn, requested_by: str = "") -> dict[str, Any]:
        db = self.db
        c = db.get("customers", data.customer_id)
        if not c:
            raise ValueError("Kunde nicht gefunden")
        if data.due_date:
            try:
                date.fromisoformat(data.due_date)
            except ValueError:
                raise ValueError("Datum im Format JJJJ-MM-TT angeben")
        sub = None
        if data.subscription_id:
            sub = db.query_one("SELECT * FROM subscriptions WHERE id = ? AND customer_id = ?", (data.subscription_id, c["id"]))
            if not sub:
                raise ValueError("Lizenz gehört nicht zu diesem Kunden")
        details = {k: getattr(data, k) for k in ("department", "job_title", "license", "device", "phone", "mailbox",
                                                  "forward_to", "handover_to", "notes", "m365_user", "adjust_license")}
        if sub and not details["license"]:
            details["license"] = sub["name"]
        checklist = build_checklist(templates(db)[data.kind], _values(data.kind, data.person, data.due_date, details))
        when = f" {'ab' if data.kind == 'eintritt' else 'zum'} {_values(data.kind, '', data.due_date, {})['datum']}" if data.due_date else ""
        title = f"{'Neuer Mitarbeiter' if data.kind == 'eintritt' else 'Austritt'}: {data.person}{when}"
        desc = [f"{KINDS[data.kind]} bei {c['name']}" + (f" – gemeldet von {requested_by}" if requested_by else ""), ""]
        for label, key in (("E-Mail", "email"),):
            if getattr(data, key):
                desc.append(f"{label}: {getattr(data, key)}")
        for label, key in (("Abteilung", "department"), ("Funktion", "job_title"), ("Lizenz", "license"), ("Gerät", "device"),
                           ("Postfach", "mailbox"), ("Weiterleitung an", "forward_to"), ("Übergabe an", "handover_to")):
            if details.get(key):
                desc.append(f"{label}: {details[key]}")
        if data.notes:
            desc += ["", data.notes]
        desc += ["", "Checkliste:"] + [f"☐ {s['text']}" for s in checklist]
        tid = db.insert("tickets", {"customer_id": c["id"], "title": title[:200], "description": "\n".join(desc),
                                    "status": "neu", "priority": "normal", "category": "Benutzerverwaltung"})
        if self.triage:
            try:
                self.triage(tid, assign_only=True)
            except Exception:  # noqa: BLE001
                pass
        sid = db.insert("staff_changes", {"customer_id": c["id"], "kind": data.kind, "person": data.person.strip(),
                                          "email": data.email.strip(), "due_date": data.due_date, "details": details,
                                          "checklist": checklist, "status": "offen", "ticket_id": tid,
                                          "subscription_id": sub["id"] if sub else None, "requested_by": requested_by})
        log_activity(db, None, f"mitarbeiter_{data.kind}", "customer", c["id"], f"{title} (Ticket #{tid})")
        return self.get(sid)

    def get(self, sid: int) -> dict[str, Any] | None:
        r = self.db.query_one("SELECT s.*, c.name AS customer, t.status AS ticket_status, sub.name AS subscription, "
                              "sub.quantity AS subscription_quantity FROM staff_changes s "
                              "JOIN customers c ON c.id = s.customer_id LEFT JOIN tickets t ON t.id = s.ticket_id "
                              "LEFT JOIN subscriptions sub ON sub.id = s.subscription_id WHERE s.id = ?", (sid,))
        return self._enrich(r) if r else None

    def _enrich(self, r: dict[str, Any]) -> dict[str, Any]:
        r["details"] = loads(r["details"], {})
        r["checklist"] = loads(r["checklist"], [])
        r["done"] = sum(1 for s in r["checklist"] if s["done"])
        r["total"] = len(r["checklist"])
        r["kind_label"] = KINDS.get(r["kind"], r["kind"])
        try:
            r["days"] = (date.fromisoformat(r["due_date"]) - date.today()).days if r["due_date"] else None
        except ValueError:
            r["days"] = None
        r["overdue"] = r["days"] is not None and r["days"] < 0 and r["status"] not in ("erledigt", "storniert")
        return r

    def list(self, customer_id: int | None = None, open_only: bool = True) -> list[dict[str, Any]]:
        sql = ("SELECT s.*, c.name AS customer, t.status AS ticket_status, sub.name AS subscription, sub.quantity AS "
               "subscription_quantity FROM staff_changes s JOIN customers c ON c.id = s.customer_id "
               "LEFT JOIN tickets t ON t.id = s.ticket_id LEFT JOIN subscriptions sub ON sub.id = s.subscription_id WHERE 1 = 1")
        params: list[Any] = []
        if customer_id:
            sql += " AND s.customer_id = ?"
            params.append(customer_id)
        if open_only:
            sql += " AND s.status IN ('offen', 'in_arbeit')"
        sql += " ORDER BY CASE WHEN s.status IN ('offen', 'in_arbeit') THEN 0 ELSE 1 END, " \
               "COALESCE(NULLIF(s.due_date, ''), '9999'), s.id DESC LIMIT 300"
        return [self._enrich(r) for r in self.db.query(sql, params)]

    def check(self, sid: int, index: int, done: bool, user: str = "") -> dict[str, Any]:
        r = self.get(sid)
        if not r:
            raise LookupError("Vorgang nicht gefunden")
        if r["status"] in ("erledigt", "storniert"):
            raise ValueError("Vorgang ist bereits abgeschlossen")
        if index >= len(r["checklist"]):
            raise ValueError("Schritt nicht gefunden")
        step = r["checklist"][index]
        step.update({"done": done, "done_at": now_iso() if done else "", "by": user if done else ""})
        self.db.update("staff_changes", sid, {"checklist": r["checklist"], "status": "in_arbeit"})
        if r["ticket_id"]:
            t = self.db.get("tickets", r["ticket_id"])
            if t and t["status"] == "neu":
                self.db.update("tickets", t["id"], {"status": "in_arbeit"})
        if all(s["done"] for s in r["checklist"]):
            return self.complete(sid, user)
        return self.get(sid)

    def complete(self, sid: int, user: str = "") -> dict[str, Any]:
        r = self.get(sid)
        if not r:
            raise LookupError("Vorgang nicht gefunden")
        if r["status"] == "erledigt":
            return r
        notes = []
        d = r["details"]
        if r["subscription_id"] and d.get("adjust_license", True) and not r["license_adjusted"]:
            sub = self.db.get("subscriptions", r["subscription_id"])
            if sub:
                qty = max(0, float(sub["quantity"] or 0) + (1 if r["kind"] == "eintritt" else -1))
                self.db.update("subscriptions", sub["id"], {"quantity": qty})
                notes.append(f"{sub['name']}: Anzahl {sub['quantity']:g} → {qty:g}")
                self.db.update("staff_changes", sid, {"license_adjusted": True})
        c = self.db.get("customers", r["customer_id"])
        if c:
            emp = max(0, int(c["employees"] or 0) + (1 if r["kind"] == "eintritt" else -1))
            self.db.query("UPDATE customers SET employees = ? WHERE id = ?", (emp, c["id"]))
            notes.append(f"Mitarbeiter {c['employees']} → {emp}")
        ts = now_iso()
        self.db.update("staff_changes", sid, {"status": "erledigt", "completed_at": ts})
        if r["ticket_id"]:
            t = self.db.get("tickets", r["ticket_id"])
            if t and t["status"] != "geloest":
                done = "\n".join(f"✓ {s['text']}" for s in r["checklist"] if s["done"])
                self.db.update("tickets", t["id"], {"status": "geloest", "resolved_at": ts,
                                                    "solution": f"{r['kind_label']} abgeschlossen.\n{done}\n" + "; ".join(notes)})
        log_activity(self.db, None, f"mitarbeiter_{r['kind']}_erledigt", "customer", r["customer_id"],
                     f"{r['kind_label']} {r['person']} abgeschlossen" + (f" – {'; '.join(notes)}" if notes else ""))
        return {**self.get(sid), "adjustments": notes}

    def portal_list(self, customer_id: int) -> list[dict[str, Any]]:
        return [{"id": r["id"], "kind": r["kind"], "kind_label": r["kind_label"], "person": r["person"], "due_date": r["due_date"],
                 "status": r["status"], "done": r["done"], "total": r["total"], "created_at": r["created_at"],
                 "steps": [{"text": s["text"], "done": s["done"]} for s in r["checklist"]]}
                for r in self.list(customer_id, open_only=False)[:50]]


def register(app: FastAPI, ctx: Any, admin_only) -> StaffService:
    db: Database = ctx.db

    def triage(tid: int, assign_only: bool = False) -> None:
        from .team import auto_assign

        auto_assign(db, tid)

    svc = StaffService(db, triage)
    app.state.staff = svc

    def user_name(request: Request) -> str:
        u = getattr(request.state, "user", None)
        return (u or {}).get("name", "") if isinstance(u, dict) else ""

    @app.get("/api/staff")
    def list_changes(customer_id: Optional[int] = None, all: bool = False) -> list[dict]:  # noqa: A002
        return svc.list(customer_id, open_only=not all)

    @app.post("/api/staff", status_code=201)
    def create(data: StaffIn, request: Request) -> dict:
        try:
            return svc.create(data, requested_by=user_name(request))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/staff/templates")
    def get_templates() -> dict:
        return {"templates": templates(db), "defaults": DEFAULT_TEMPLATES}

    @app.put("/api/staff/templates", dependencies=[Depends(admin_only)])
    def put_templates(data: TemplatesIn) -> dict:
        db.set_setting("staff_templates", {"eintritt": [x.strip()[:300] for x in data.eintritt if x.strip()],
                                           "austritt": [x.strip()[:300] for x in data.austritt if x.strip()]})
        return {"templates": templates(db)}

    @app.get("/api/staff/{sid}")
    def get_change(sid: int) -> dict:
        r = svc.get(sid)
        if not r:
            raise HTTPException(404, "Vorgang nicht gefunden")
        return r

    @app.put("/api/staff/{sid}")
    def update(sid: int, data: StaffUpdate) -> dict:
        r = svc.get(sid)
        if not r:
            raise HTTPException(404, "Vorgang nicht gefunden")
        patch: dict[str, Any] = {}
        if data.due_date is not None:
            patch["due_date"] = data.due_date
        if data.notes is not None:
            patch["details"] = {**r["details"], "notes": data.notes}
        if data.subscription_id is not None:
            if data.subscription_id and not db.query_one("SELECT id FROM subscriptions WHERE id = ? AND customer_id = ?",
                                                         (data.subscription_id, r["customer_id"])):
                raise HTTPException(422, "Lizenz gehört nicht zu diesem Kunden")
            patch["subscription_id"] = data.subscription_id or None
        if data.add_step:
            patch["checklist"] = r["checklist"] + [{"text": data.add_step.strip(), "done": False, "done_at": "", "by": ""}]
        if patch:
            db.update("staff_changes", sid, patch)
            if "subscription_id" in patch and patch["subscription_id"] is None:
                db.query("UPDATE staff_changes SET subscription_id = NULL WHERE id = ?", (sid,))
        return svc.get(sid)

    @app.post("/api/staff/{sid}/check")
    def check(sid: int, data: CheckIn, request: Request) -> dict:
        try:
            return svc.check(sid, data.index, data.done, user_name(request))
        except LookupError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))

    @app.post("/api/staff/{sid}/complete")
    def complete(sid: int, request: Request) -> dict:
        try:
            return svc.complete(sid, user_name(request))
        except LookupError as exc:
            raise HTTPException(404, str(exc))

    @app.post("/api/staff/{sid}/cancel")
    def cancel(sid: int) -> dict:
        r = svc.get(sid)
        if not r:
            raise HTTPException(404, "Vorgang nicht gefunden")
        db.update("staff_changes", sid, {"status": "storniert"})
        if r["ticket_id"] and (t := db.get("tickets", r["ticket_id"])) and t["status"] != "geloest":
            db.update("tickets", t["id"], {"status": "geloest", "resolved_at": now_iso(), "solution": "Vorgang storniert."})
        return svc.get(sid)

    return svc



