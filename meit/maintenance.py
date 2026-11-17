"""Wartungsplan: wiederkehrende Prüfungen je Kunde – mit Nachweis.

Warum: Bei Managed-Services sieht der Kunde meist nur „es läuft“. Der Wartungsplan macht die Arbeit
sichtbar (Restore-Test, Patch-Status, Firewall …) – im Monatsbericht, im QBR und im Kundenportal – und
sorgt dafür, dass nichts vergessen wird (NIS2: regelmäßige Überprüfung der Maßnahmen).

* Vorlagen werden passend zu den gebuchten Leistungen und Geräten vorgeschlagen.
* Bei Fälligkeit entsteht automatisch ein Ticket „Wartung: …“ mit Checkliste.
* Abschluss mit Checkliste, Ergebnis (in Ordnung / Hinweis / Problem), Notiz und Zeit; bei „Problem“
  wird auf Wunsch ein Folgeticket angelegt.
"""

from __future__ import annotations

import calendar
import json
import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

INTERVALS = {"woche": "wöchentlich", "monat": "monatlich", "quartal": "vierteljährlich",
             "halbjahr": "halbjährlich", "jahr": "jährlich"}
RESULTS = {"ok": "in Ordnung", "hinweis": "mit Hinweis", "problem": "Problem gefunden"}

TEMPLATES: dict[str, dict[str, Any]] = {
    "backup": {"title": "Backup-Kontrolle & Restore-Test", "interval": "monat", "estimate_min": 30,
               "services": {"BCK", "M365B"}, "checklist": [
                   "Backup-Jobs der letzten 30 Tage erfolgreich", "Stichprobe: Datei/Ordner wiederhergestellt",
                   "Offsite-/Cloud-Kopie vorhanden und aktuell", "Unveränderbare Kopie (Immutable) geprüft"]},
    "patch": {"title": "Patch- & Update-Status", "interval": "monat", "estimate_min": 20,
              "services": {"MW", "MON", "MS"}, "checklist": [
                  "Windows-Updates auf allen Geräten installiert", "Drittanbieter-Software (Browser, PDF, Java) aktuell",
                  "Geräte ohne Kontakt > 14 Tage geprüft", "Neustart-pflichtige Geräte nachgefasst"]},
    "security": {"title": "Security-Status (EDR, MFA, Admin-Konten)", "interval": "monat", "estimate_min": 20,
                 "services": {"SEC", "MW", "VCISO"}, "checklist": [
                     "EDR/Virenschutz auf allen Geräten aktiv, keine offenen Funde", "MFA für alle Benutzer aktiv",
                     "Admin-Konten geprüft (keine unbekannten)", "Microsoft Secure Score notiert"]},
    "server": {"title": "Server & Speicher", "interval": "monat", "estimate_min": 20, "services": {"MS"},
               "needs_server": True, "checklist": [
                   "Ereignisanzeige: keine kritischen Fehler", "Speicherplatz > 20 % frei", "RAID/SMART in Ordnung",
                   "Wichtige Dienste laufen"]},
    "firewall": {"title": "Firewall: Firmware, Regeln, VPN", "interval": "quartal", "estimate_min": 30,
                 "services": {"MFW"}, "checklist": [
                     "Firmware aktuell", "Regelwerk geprüft (keine offenen any-any-Regeln)", "VPN-Zugänge geprüft",
                     "Lizenz/Subscription gültig"]},
    "users": {"title": "Benutzer, Berechtigungen & Lizenzen", "interval": "quartal", "estimate_min": 30,
              "services": {"MW", "M365MIG", "VCISO"}, "checklist": [
                  "Ausgeschiedene Mitarbeiter deaktiviert", "Freigaben und gemeinsame Postfächer geprüft",
                  "Lizenzen mit Benutzern abgeglichen", "Gastzugänge geprüft"]},
    "ups": {"title": "USV-Test", "interval": "halbjahr", "estimate_min": 20, "services": set(), "needs_server": True,
            "checklist": ["Selbsttest durchgeführt", "Akkukapazität/Laufzeit ausreichend",
                          "Automatisches Herunterfahren getestet"]},
    "awareness": {"title": "Phishing-Simulation & Schulungsstand", "interval": "quartal", "estimate_min": 20,
                  "services": {"AWR"}, "checklist": [
                      "Simulation durchgeführt", "Klickrate notiert und mit Vorquartal verglichen",
                      "Nachschulung für Auffällige eingeplant"]},
    "kibox": {"title": "KI-Box: Updates & Modelle", "interval": "monat", "estimate_min": 20, "services": {"KIBOXM", "KIMAM"},
              "checklist": ["System- und Sicherheitsupdates", "Modell-Updates geprüft", "Backup der Konfiguration",
                            "Nutzung/Wirkung notiert"]},
    "docs": {"title": "Notfallplan & IT-Dokumentation", "interval": "jahr", "estimate_min": 60,
             "services": {"MW", "VCISO", "NIS2GAP"}, "checklist": [
                 "Ansprechpartner und Telefonnummern aktuell", "Netzwerkplan und Zugangsdaten-Verwaltung aktuell",
                 "Wiederanlauf-Reihenfolge geprüft", "NIS2-Maßnahmen und Nachweise dokumentiert"]},
}


def add_interval(day: date, interval: str) -> date:
    if interval == "woche":
        return day + timedelta(days=7)
    months = {"monat": 1, "quartal": 3, "halbjahr": 6, "jahr": 12}.get(interval, 1)
    m = day.month - 1 + months
    year, month = day.year + m // 12, m % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def suggest_templates(db: Database, customer: dict[str, Any]) -> list[str]:
    booked = set(loads(customer.get("booked_services"), []))
    managed = (customer.get("package") or "keins") != "keins"
    has_server = bool(db.scalar("SELECT COUNT(*) FROM assets WHERE customer_id = ? AND type = 'server'", (customer["id"],)))
    existing = {r["template"] for r in db.query("SELECT template FROM maintenance_tasks WHERE customer_id = ?",
                                                (customer["id"],))}
    keys = []
    for key, t in TEMPLATES.items():
        if key in existing:
            continue
        if t.get("needs_server") and not has_server:
            continue
        if t["services"] & booked or (managed and key in ("patch", "security", "users", "docs")) or \
                (key in ("server", "ups") and has_server and managed):
            keys.append(key)
    return keys


def _first_due(customer_id: int, interval: str, today: date) -> date:
    # Kunden über den Monat verteilen (nicht alle Prüfungen am selben Tag)
    day = 3 + (customer_id * 5) % 22
    nxt = date(today.year + (today.month // 12), today.month % 12 + 1, day)
    return nxt if interval != "woche" else today + timedelta(days=7)


class Maintenance:
    def __init__(self, db: Database):
        self.db = db

    def create_task(self, customer_id: int, *, template: str = "", title: str = "", checklist: list[str] | None = None,
                    interval: str | None = None, next_due: str | None = None, assigned_to: int | None = None,
                    estimate_min: int | None = None, lead_days: int = 3, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        tpl = TEMPLATES.get(template, {})
        interval = interval if interval in INTERVALS else tpl.get("interval", "monat")
        title = (title or tpl.get("title") or "").strip()
        if not title:
            raise ValueError("Titel fehlt")
        due = next_due or _first_due(customer_id, interval, today).isoformat()
        tid = self.db.insert("maintenance_tasks", {
            "customer_id": customer_id, "template": template, "title": title[:200],
            "checklist": [c[:200] for c in (checklist if checklist is not None else tpl.get("checklist", []))][:20],
            "interval": interval, "next_due": due, "lead_days": max(0, min(int(lead_days), 30)),
            "assigned_to": assigned_to, "estimate_min": estimate_min or tpl.get("estimate_min", 15), "active": True})
        return self.task(tid)

    def task(self, tid: int) -> dict[str, Any]:
        t = self.db.get("maintenance_tasks", tid)
        if not t:
            raise ValueError("Wartungsaufgabe nicht gefunden")
        t["checklist"] = loads(t["checklist"], [])
        return t

    def apply_plan(self, customer_id: int, keys: list[str] | None = None, today: date | None = None) -> list[dict]:
        customer = self.db.get("customers", customer_id)
        if not customer:
            raise ValueError("Kunde nicht gefunden")
        keys = keys if keys is not None else suggest_templates(self.db, customer)
        existing = {r["template"] for r in self.db.query("SELECT template FROM maintenance_tasks WHERE customer_id = ?",
                                                         (customer_id,))}
        return [self.create_task(customer_id, template=k, today=today) for k in keys if k in TEMPLATES and k not in existing]

    # -- Fälligkeiten
    def generate_due(self, today: date | None = None) -> list[int]:
        """Legt für fällige Aufgaben einen Wartungslauf + Ticket an (idempotent)."""
        today = today or date.today()
        created = []
        for t in self.db.query("SELECT * FROM maintenance_tasks WHERE active = 1"):
            if date.fromisoformat(t["next_due"]) - timedelta(days=int(t["lead_days"] or 0)) > today:
                continue
            if self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE task_id = ? AND status = 'offen'", (t["id"],)):
                continue
            if self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE task_id = ? AND due_date = ?",
                              (t["id"], t["next_due"])):
                continue
            checklist = loads(t["checklist"], [])
            desc = "\n".join([f"Wiederkehrende Prüfung ({INTERVALS.get(t['interval'], t['interval'])}), "
                              f"fällig am {date.fromisoformat(t['next_due']).strftime('%d.%m.%Y')}.", "",
                              *[f"- [ ] {c}" for c in checklist], "",
                              "Abschluss mit Ergebnis unter „Wartung“ – erscheint als Nachweis im Monatsbericht."])
            ticket_id = self.db.insert("tickets", {
                "customer_id": t["customer_id"], "title": f"Wartung: {t['title']}"[:200], "description": desc,
                "status": "neu", "priority": "normal", "category": "Wartung", "assigned_to": t["assigned_to"]})
            if not t["assigned_to"]:
                try:
                    from .team import auto_assign

                    auto_assign(self.db, ticket_id)
                except Exception:  # noqa: BLE001 - Zuweisung ist optional
                    pass
            created.append(self.db.insert("maintenance_runs", {
                "task_id": t["id"], "customer_id": t["customer_id"], "ticket_id": ticket_id, "title": t["title"],
                "due_date": t["next_due"], "status": "offen",
                "checklist": [{"item": c, "done": False} for c in checklist]}))
        return created

    def _advance(self, t: dict[str, Any], today: date) -> str:
        nxt = add_interval(date.fromisoformat(t["next_due"]), t["interval"])
        while nxt <= today:
            nxt = add_interval(nxt, t["interval"])
        return nxt.isoformat()

    def complete(self, run_id: int, *, done: list[bool], result: str, note: str = "", minutes: int = 0,
                 user_id: int | None = None, followup: bool = False, skip: bool = False,
                 today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        run = self.db.get("maintenance_runs", run_id)
        if not run:
            raise ValueError("Wartungslauf nicht gefunden")
        if run["status"] != "offen":
            raise ValueError("Wartung ist bereits abgeschlossen")
        if not skip and result not in RESULTS:
            raise ValueError("Ergebnis: ok, hinweis oder problem")
        items = loads(run["checklist"], [])
        for i, item in enumerate(items):
            item["done"] = bool(done[i]) if i < len(done) else False
        ts = now_iso()
        t = self.db.get("maintenance_tasks", run["task_id"])
        self.db.update("maintenance_runs", run_id, {
            "status": "uebersprungen" if skip else "erledigt", "result": "" if skip else result, "checklist": items,
            "note": note[:2000], "minutes": max(0, int(minutes)), "done_at": ts, "done_by": user_id})
        if minutes > 0 and not skip:
            from .billing import add_time

            add_time(self.db, customer_id=run["customer_id"], minutes=int(minutes), description=f"Wartung: {run['title']}",
                     ticket_id=run["ticket_id"], user_id=user_id)
        if run["ticket_id"] and self.db.get("tickets", run["ticket_id"]):
            summary = ("Übersprungen" if skip else f"Ergebnis: {RESULTS[result]}") + (f" – {note}" if note else "")
            checklist_txt = "\n".join(f"- [{'x' if i['done'] else ' '}] {i['item']}" for i in items)
            self.db.update("tickets", run["ticket_id"], {"status": "geloest", "resolved_at": ts,
                                                         "solution": f"{summary}\n\n{checklist_txt}"[:5000]})
        follow_id = None
        if followup and result == "problem" and not skip:
            follow_id = self.db.insert("tickets", {
                "customer_id": run["customer_id"], "title": f"Folgeaufgabe Wartung: {run['title']}"[:200],
                "description": f"Bei der Wartung am {today.strftime('%d.%m.%Y')} festgestellt:\n\n{note}",
                "status": "neu", "priority": "hoch", "category": "Wartung"})
        if t:
            self.db.update("maintenance_tasks", t["id"], {
                "next_due": self._advance(t, today),
                **({} if skip else {"last_done_at": ts, "last_result": result})})
        out = self.db.get("maintenance_runs", run_id)
        out["checklist"] = loads(out["checklist"], [])
        out["followup_ticket_id"] = follow_id
        return out

    # -- Auswertung
    def runs(self, *, status: str | None = None, customer_id: int | None = None, since: str | None = None,
             until: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        sql = ("SELECT r.*, c.name AS customer_name, u.name AS done_by_name, t.interval, t.assigned_to, "
               "a.name AS assigned_name, k.status AS ticket_status FROM maintenance_runs r "
               "LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.done_by "
               "LEFT JOIN maintenance_tasks t ON t.id = r.task_id LEFT JOIN users a ON a.id = t.assigned_to "
               "LEFT JOIN tickets k ON k.id = r.ticket_id WHERE 1=1")
        params: list[Any] = []
        if status:
            sql += " AND r.status = ?"
            params.append(status)
        if customer_id:
            sql += " AND r.customer_id = ?"
            params.append(customer_id)
        if since:
            sql += " AND substr(r.done_at, 1, 10) >= ?"
            params.append(since)
        if until:
            sql += " AND substr(r.done_at, 1, 10) <= ?"
            params.append(until)
        order = " ORDER BY r.due_date, r.id" if status == "offen" else " ORDER BY r.done_at DESC, r.id DESC"
        rows = self.db.query(sql + order + " LIMIT ?", [*params, min(limit, 2000)])
        today = date.today().isoformat()
        for r in rows:
            r["checklist"] = loads(r["checklist"], [])
            r["overdue"] = r["status"] == "offen" and r["due_date"] < today
        return rows

    def summary(self, customer_id: int, start: date, end: date) -> dict[str, Any]:
        done = self.runs(customer_id=customer_id, since=start.isoformat(), until=end.isoformat())
        done = [r for r in done if r["status"] == "erledigt"]
        overdue = self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE customer_id = ? AND status = 'offen' "
                                 "AND due_date < ?", (customer_id, date.today().isoformat())) or 0
        tasks = self.db.scalar("SELECT COUNT(*) FROM maintenance_tasks WHERE customer_id = ? AND active = 1",
                               (customer_id,)) or 0
        return {"tasks": tasks, "done": done, "count": len(done), "overdue": overdue,
                "problems": [r for r in done if r["result"] == "problem"]}

    def overview(self) -> dict[str, Any]:
        today = date.today().isoformat()
        week = (date.today() + timedelta(days=7)).isoformat()
        month_start = date.today().replace(day=1).isoformat()
        return {
            "open": self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE status = 'offen'") or 0,
            "overdue": self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE status = 'offen' AND due_date < ?",
                                      (today,)) or 0,
            "next_7_days": self.db.scalar("SELECT COUNT(*) FROM maintenance_tasks WHERE active = 1 AND next_due <= ?",
                                          (week,)) or 0,
            "done_this_month": self.db.scalar("SELECT COUNT(*) FROM maintenance_runs WHERE status = 'erledigt' "
                                              "AND substr(done_at, 1, 10) >= ?", (month_start,)) or 0,
            "tasks": self.db.scalar("SELECT COUNT(*) FROM maintenance_tasks WHERE active = 1") or 0,
            "customers_without_plan": self.db.scalar(
                "SELECT COUNT(*) FROM customers c WHERE COALESCE(c.package, 'keins') != 'keins' AND NOT EXISTS "
                "(SELECT 1 FROM maintenance_tasks t WHERE t.customer_id = c.id AND t.active = 1)") or 0,
        }


def report_lines(summary: dict[str, Any], heading: str = "## Wartung & Prüfungen") -> list[str]:
    """Abschnitt für Monatsbericht/QBR: was wurde geprüft, mit welchem Ergebnis."""
    if not summary["tasks"] and not summary["done"]:
        return []
    lines = ["", heading]
    if summary["done"]:
        hints = sum(1 for r in summary["done"] if r["result"] == "hinweis")
        lines.append(f"Durchgeführt: **{summary['count']} Prüfung(en)**"
                     + (f", davon {len(summary['problems'])} mit Handlungsbedarf" if summary["problems"] else
                        f", davon {hints} mit Hinweis" if hints else " – alles in Ordnung") + ".")
        lines.append("")
        for r in summary["done"][:15]:
            day = datetime.fromisoformat(r["done_at"]).strftime("%d.%m.")
            lines.append(f"- {r['title']} ({day}): {RESULTS.get(r['result'], r['result'])}"
                         + (f" – {r['note']}" if r["note"] and r["result"] != "ok" else ""))
    else:
        lines.append("In diesem Zeitraum waren keine Prüfungen fällig.")
    if summary["overdue"]:
        lines += ["", f"_{summary['overdue']} Prüfung(en) sind noch offen und werden nachgeholt._"]
    return lines


def protocol_markdown(db: Database, customer: dict[str, Any], runs: list[dict[str, Any]], period: str) -> str:
    lines = [f"# Wartungsprotokoll {period}", "", f"**Kunde:** {customer['name']}", ""]
    if not runs:
        return "\n".join(lines + ["Im Zeitraum wurden keine Wartungen durchgeführt."])
    lines += ["| Datum | Prüfung | Ergebnis | Durchgeführt von |", "|---|---|---|---|"]
    for r in runs:
        lines.append(f"| {datetime.fromisoformat(r['done_at']).strftime('%d.%m.%Y')} | {r['title']} | "
                     f"{RESULTS.get(r['result'], r['status'])} | {r.get('done_by_name') or '–'} |")
    for r in runs:
        lines += ["", f"## {r['title']} – {datetime.fromisoformat(r['done_at']).strftime('%d.%m.%Y')}"]
        lines += [f"- {'erledigt' if i['done'] else 'nicht geprüft'}: {i['item']}" for i in r["checklist"]]
        if r["note"]:
            lines += ["", f"**Notiz:** {r['note']}"]
    return "\n".join(lines)


def start_scheduler(m: Maintenance) -> threading.Thread:
    def loop() -> None:
        time.sleep(90)
        while True:
            try:
                m.generate_due()
            except Exception as exc:  # noqa: BLE001 - sichtbar machen, Schleife läuft weiter
                m.db.set_setting("maintenance_error", str(exc))
            time.sleep(3600)

    thread = threading.Thread(target=loop, name="meit-maintenance", daemon=True)
    thread.start()
    return thread


# ----------------------------------------------------------------------------- API
class TaskIn(BaseModel):
    customer_id: int
    template: str = ""
    title: str = Field("", max_length=200)
    checklist: Optional[list[str]] = None
    interval: Optional[str] = None
    next_due: Optional[str] = None
    assigned_to: Optional[int] = None
    estimate_min: Optional[int] = Field(None, ge=0, le=600)
    lead_days: int = Field(3, ge=0, le=30)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    checklist: Optional[list[str]] = None
    interval: Optional[str] = None
    next_due: Optional[str] = None
    assigned_to: Optional[int] = None
    estimate_min: Optional[int] = Field(None, ge=0, le=600)
    lead_days: Optional[int] = Field(None, ge=0, le=30)
    active: Optional[bool] = None


class CompleteIn(BaseModel):
    done: list[bool] = Field(default_factory=list)
    result: str = "ok"
    note: str = Field("", max_length=2000)
    minutes: int = Field(0, ge=0, le=1440)
    followup: bool = False
    skip: bool = False


class PlanIn(BaseModel):
    customer_id: int
    templates: Optional[list[str]] = None


class ProtocolIn(BaseModel):
    customer_id: int
    month: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}$")


def month_bounds(month: str | None) -> tuple[date, date, str]:
    month = month or date.today().strftime("%Y-%m")
    y, m = int(month[:4]), int(month[5:7])
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1]), month


def register(app: FastAPI, ctx: Any, admin_only, start: bool = True) -> Maintenance:
    db: Database = ctx.db
    m = Maintenance(db)

    def user_id(request: Request) -> int | None:
        user = getattr(request.state, "user", None)
        return user["id"] if user else None

    def guard(fn):
        try:
            return fn()
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/maintenance")
    def overview() -> dict:
        m.generate_due()
        return {**m.overview(), "intervals": INTERVALS, "results": RESULTS,
                "templates": {k: {"title": v["title"], "interval": v["interval"]} for k, v in TEMPLATES.items()}}

    @app.get("/api/maintenance/tasks")
    def tasks(customer_id: Optional[int] = None) -> list[dict]:
        sql = ("SELECT t.*, c.name AS customer_name, u.name AS assigned_name FROM maintenance_tasks t "
               "LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to")
        rows = db.query(sql + (" WHERE t.customer_id = ?" if customer_id else "") + " ORDER BY c.name, t.next_due",
                        (customer_id,) if customer_id else ())
        for r in rows:
            r["checklist"] = loads(r["checklist"], [])
        return rows

    @app.post("/api/maintenance/tasks", status_code=201)
    def create(data: TaskIn) -> dict:
        if not db.get("customers", data.customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        return guard(lambda: m.create_task(data.customer_id, template=data.template, title=data.title,
                                           checklist=data.checklist, interval=data.interval, next_due=data.next_due,
                                           assigned_to=data.assigned_to, estimate_min=data.estimate_min,
                                           lead_days=data.lead_days))

    @app.put("/api/maintenance/tasks/{tid}")
    def update(tid: int, data: TaskUpdate) -> dict:
        guard(lambda: m.task(tid))
        upd = data.model_dump(exclude_none=True)
        if "interval" in upd and upd["interval"] not in INTERVALS:
            raise HTTPException(422, "Ungültiges Intervall")
        if "next_due" in upd:
            try:
                date.fromisoformat(upd["next_due"])
            except ValueError:
                raise HTTPException(422, "Datum im Format JJJJ-MM-TT")
        if "checklist" in upd:
            upd["checklist"] = [c.strip()[:200] for c in upd["checklist"] if c.strip()][:20]
        db.update("maintenance_tasks", tid, upd)
        return m.task(tid)

    @app.delete("/api/maintenance/tasks/{tid}")
    def delete(tid: int) -> dict:
        if not db.delete("maintenance_tasks", tid):
            raise HTTPException(404, "Wartungsaufgabe nicht gefunden")
        return {"ok": True}

    @app.get("/api/maintenance/suggest/{customer_id}")
    def suggest(customer_id: int) -> dict:
        c = db.get("customers", customer_id)
        if not c:
            raise HTTPException(404, "Kunde nicht gefunden")
        keys = suggest_templates(db, c)
        return {"templates": [{"key": k, "title": TEMPLATES[k]["title"], "interval": TEMPLATES[k]["interval"],
                               "checklist": TEMPLATES[k]["checklist"]} for k in keys]}

    @app.post("/api/maintenance/plan", status_code=201)
    def plan(data: PlanIn) -> dict:
        created = guard(lambda: m.apply_plan(data.customer_id, data.templates))
        return {"created": len(created), "tasks": created}

    @app.get("/api/maintenance/runs")
    def runs(status: Optional[str] = None, customer_id: Optional[int] = None, limit: int = 300) -> list[dict]:
        if status == "offen":
            m.generate_due()
        return m.runs(status=status, customer_id=customer_id, limit=limit)

    @app.post("/api/maintenance/runs/{rid}/complete")
    def complete(rid: int, data: CompleteIn, request: Request) -> dict:
        return guard(lambda: m.complete(rid, done=data.done, result=data.result, note=data.note, minutes=data.minutes,
                                        user_id=user_id(request), followup=data.followup, skip=data.skip))

    @app.get("/api/maintenance/protocol.pdf")
    def protocol_pdf(customer_id: int, month: Optional[str] = None):
        from .documents import pdf_response

        c = db.get("customers", customer_id)
        if not c:
            raise HTTPException(404, "Kunde nicht gefunden")
        start_, end_, label = month_bounds(month)
        runs_ = [r for r in m.runs(customer_id=customer_id, since=start_.isoformat(), until=end_.isoformat())
                 if r["status"] == "erledigt"]
        data = ctx.docs.text_pdf(f"Wartungsprotokoll {label}", protocol_markdown(db, c, list(reversed(runs_)), label),
                                 subtitle=f"Erstellt am {date.today().strftime('%d.%m.%Y')}")
        return pdf_response(data, f"Wartungsprotokoll_{label}_{c['name']}.pdf".replace(" ", "_"))

    @app.post("/api/maintenance/protocol", status_code=201)
    def protocol_archive(data: ProtocolIn) -> dict:
        c = db.get("customers", data.customer_id)
        if not c:
            raise HTTPException(404, "Kunde nicht gefunden")
        start_, end_, label = month_bounds(data.month)
        runs_ = [r for r in m.runs(customer_id=c["id"], since=start_.isoformat(), until=end_.isoformat())
                 if r["status"] == "erledigt"]
        return ctx.docs.archive_text(f"Wartungsprotokoll {label} – {c['name']}",
                                     protocol_markdown(db, c, list(reversed(runs_)), label), kind="bericht",
                                     customer_id=c["id"])

    if start:
        start_scheduler(m)
    return m
