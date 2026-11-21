"""Projekte: größere Vorhaben mit Aufgaben, Stundenbudget und Fortschritt – vom Angebot bis zur Abnahme.

- **Vorlagen** für typische IT-Projekte (neuer Server, Microsoft-365-Umstieg, Büro-Umzug, neuer Arbeitsplatz)
  legen Phasen und Aufgaben in einem Schritt an.
- **Aufgaben** mit Phase, Zuständigem, Fälligkeit und Schätzung; der Fortschritt ergibt sich aus den erledigten Aufgaben.
- **Zeiten** zählen aufs Projekt – direkt gebucht oder über ein verknüpftes Ticket (auch Termine und Arbeitsberichte).
- **Budget:** verbrauchte Stunden gegen das Stundenbudget; Warnung ab 80 % und bei Überschreitung.
- **Abrechnung:** nach Aufwand (Stunden werden verrechnet), Fixpreis (Stunden zählen nur intern, der Preis kommt
  über das angenommene Angebot) oder intern.
- Der Kunde sieht freigegebene Projekte mit Fortschritt im Portal – ohne interne Notizen und ohne Stunden.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, now_iso

STATUS = {"geplant": "geplant", "laufend": "läuft", "pausiert": "pausiert", "abgeschlossen": "abgeschlossen", "abgebrochen": "abgebrochen"}
OPEN = ("geplant", "laufend", "pausiert")
BILLING = {"aufwand": "nach Aufwand", "fixpreis": "Fixpreis", "intern": "intern (nicht verrechnet)"}
TASK_STATUS = {"offen": "offen", "in_arbeit": "in Arbeit", "erledigt": "erledigt"}
DAY = r"^(\d{4}-\d{2}-\d{2})?$"

# Vorlagen: Phase → Aufgaben (Schätzung in Minuten)
TEMPLATES: dict[str, dict[str, Any]] = {
    "server": {"label": "Neuer Server / Server-Tausch", "budget_hours": 24, "phases": [
        ("Vorbereitung", [("Ist-Aufnahme: Dienste, Freigaben, Lizenzen, Abhängigkeiten", 120), ("Hardware und Lizenzen bestellen", 30),
                          ("Umstellungstermin mit dem Kunden fixieren", 15), ("Vollsicherung des alten Servers prüfen", 45)]),
        ("Aufbau", [("Server aufbauen, Firmware und Betriebssystem aktualisieren", 180), ("Rollen und Dienste einrichten", 180),
                    ("Datensicherung einrichten und Rücksicherung testen", 90), ("Überwachung und Virenschutz einrichten", 45)]),
        ("Umstellung", [("Daten und Freigaben übernehmen", 240), ("Arbeitsplätze umstellen (Laufwerke, Drucker)", 120),
                        ("Funktionstest mit dem Kunden", 60)]),
        ("Abschluss", [("Dokumentation aktualisieren (Zugänge, Netzplan)", 60), ("Altgerät datenschutzgerecht löschen und entsorgen", 45),
                       ("Abnahme durch den Kunden", 15)])]},
    "m365": {"label": "Umstieg auf Microsoft 365", "budget_hours": 16, "phases": [
        ("Vorbereitung", [("Postfächer, Verteiler und Größen erheben", 60), ("Lizenzen festlegen und bestellen", 30),
                          ("Domain prüfen, DNS-Zugang sichern", 30), ("Termin und Ablauf an die Mitarbeiter kommunizieren", 30)]),
        ("Einrichtung", [("Tenant einrichten, Domain verbinden", 60), ("Benutzer anlegen, Lizenzen zuweisen", 60),
                         ("Zwei-Faktor-Anmeldung und Grundschutz aktivieren", 60), ("SPF, DKIM und DMARC setzen", 45)]),
        ("Umstellung", [("Postfächer übernehmen", 180), ("DNS umstellen (MX)", 30), ("Outlook und Handys der Mitarbeiter einrichten", 180)]),
        ("Abschluss", [("Altes Mailsystem abschalten", 30), ("Kurzeinweisung der Mitarbeiter", 60), ("Dokumentation und Abnahme", 45)])]},
    "umzug": {"label": "Büro-Umzug / neuer Standort", "budget_hours": 20, "phases": [
        ("Planung", [("Begehung: Netzwerkdosen, Strom, Serverraum", 90), ("Internetanschluss bestellen (Vorlaufzeit beachten)", 30),
                     ("Netzwerkplan und Arbeitsplatzliste erstellen", 90)]),
        ("Vorbereitung", [("Netzwerk am neuen Standort aufbauen (Switch, WLAN, Firewall)", 240), ("Internet und Telefonie testen", 60)]),
        ("Umzug", [("Server und Geräte abbauen, transportieren, aufbauen", 300), ("Arbeitsplätze anschließen und testen", 180),
                   ("Drucker und Scanner einrichten", 60)]),
        ("Abschluss", [("Nachbetreuung am ersten Arbeitstag", 120), ("Dokumentation aktualisieren", 45), ("Abnahme durch den Kunden", 15)])]},
    "arbeitsplatz": {"label": "Neue Arbeitsplätze (Rollout)", "budget_hours": 6, "phases": [
        ("Vorbereitung", [("Geräte und Lizenzen bestellen", 20), ("Benutzer und Berechtigungen anlegen", 30)]),
        ("Einrichtung", [("Geräte aufsetzen, Updates, Standardsoftware", 120), ("Verschlüsselung und Virenschutz aktivieren", 30),
                         ("In Inventar und Überwachung aufnehmen", 20)]),
        ("Übergabe", [("Aufstellen, anschließen, Daten übernehmen", 90), ("Einweisung und Zugangsdaten sicher übergeben", 30)])]},
}


class ProjectIn(BaseModel):
    customer_id: Optional[int] = None
    title: str = Field(min_length=2, max_length=160)
    description: str = Field("", max_length=4000)
    status: str = Field("geplant", pattern="^(geplant|laufend|pausiert|abgeschlossen|abgebrochen)$")
    billing: str = Field("aufwand", pattern="^(aufwand|fixpreis|intern)$")
    manager_id: Optional[int] = None
    start_date: str = Field("", pattern=DAY)
    due_date: str = Field("", pattern=DAY)
    budget_hours: float = Field(0, ge=0, le=100_000)
    budget_amount: float = Field(0, ge=0, le=100_000_000)
    quote_id: Optional[int] = None
    portal_visible: bool = False
    template: str = Field("", max_length=30)


class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    phase: str = Field("", max_length=80)
    notes: str = Field("", max_length=2000)
    status: str = Field("offen", pattern="^(offen|in_arbeit|erledigt)$")
    assignee_id: Optional[int] = None
    due_date: str = Field("", pattern=DAY)
    estimate_min: int = Field(0, ge=0, le=100_000)


class TaskPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=200)
    phase: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=2000)
    status: Optional[str] = Field(None, pattern="^(offen|in_arbeit|erledigt)$")
    assignee_id: Optional[int] = None
    due_date: Optional[str] = Field(None, pattern=DAY)
    estimate_min: Optional[int] = Field(None, ge=0, le=100_000)


class LinkIn(BaseModel):
    ticket_id: int


class Projects:
    def __init__(self, db: Database):
        self.db = db

    def stats(self, p: dict[str, Any]) -> dict[str, Any]:
        today = date.today().isoformat()
        t = self.db.query_one("SELECT COUNT(*) AS total, SUM(status = 'erledigt') AS done, SUM(status != 'erledigt' AND due_date != '' AND due_date < ?) AS late, "
                              "SUM(estimate_min) AS estimate, MIN(CASE WHEN status != 'erledigt' AND due_date != '' THEN due_date END) AS next_due "
                              "FROM project_tasks WHERE project_id = ?", (today, p["id"]))
        e = self.db.query_one("SELECT COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(minutes / 60.0 * rate), 0) AS value, "
                              "COALESCE(SUM(CASE WHEN billable = 1 THEN minutes / 60.0 * rate ELSE 0 END), 0) AS billable_value "
                              "FROM time_entries WHERE project_id = ?", (p["id"],))
        total, done = t["total"] or 0, t["done"] or 0
        hours = round(e["minutes"] / 60, 2)
        used = round(100 * hours / p["budget_hours"]) if p["budget_hours"] else None
        open_ = p["status"] in OPEN
        overdue = bool(open_ and p["due_date"] and p["due_date"] < today)
        # Ampel: rot = Budget überzogen oder Termin vorbei; gelb = Budget fast verbraucht, aber noch viel offen, oder Aufgaben überfällig
        progress = round(100 * done / total) if total else 0
        if not open_:
            light = "aus"
        elif (used is not None and used > 100) or overdue:
            light = "rot"
        elif (used is not None and used >= 80 and progress < 80) or (t["late"] or 0) > 0:
            light = "gelb"
        else:
            light = "gruen"
        return {"tasks_total": total, "tasks_done": done, "tasks_late": t["late"] or 0, "progress": progress, "next_due": t["next_due"] or "",
                "hours": hours, "estimate_hours": round((t["estimate"] or 0) / 60, 1), "budget_used": used, "value": round(e["value"], 2),
                "billable_value": round(e["billable_value"], 2), "overdue": overdue, "light": light}

    def view(self, p: dict[str, Any]) -> dict[str, Any]:
        out = {k: p[k] for k in ("id", "customer_id", "title", "description", "status", "billing", "manager_id", "start_date", "due_date",
                                 "budget_hours", "budget_amount", "quote_id", "closed_at", "created_at")}
        out.update({"customer": p.get("customer") or "", "manager": p.get("manager") or "", "portal_visible": bool(p["portal_visible"]),
                    "status_label": STATUS.get(p["status"], p["status"]), "billing_label": BILLING.get(p["billing"], p["billing"]), **self.stats(p)})
        return out

    SELECT = ("SELECT p.*, c.name AS customer, u.name AS manager FROM projects p LEFT JOIN customers c ON c.id = p.customer_id "
              "LEFT JOIN users u ON u.id = p.manager_id ")

    def get(self, pid: int) -> dict[str, Any] | None:
        return self.db.query_one(self.SELECT + "WHERE p.id = ?", (pid,))

    def list(self, status: str = "offen", customer_id: int | None = None) -> list[dict[str, Any]]:
        where, params = [], []
        if status == "offen":
            where.append("p.status IN ('geplant', 'laufend', 'pausiert')")
        elif status in STATUS:
            where.append("p.status = ?")
            params.append(status)
        if customer_id:
            where.append("p.customer_id = ?")
            params.append(customer_id)
        rows = self.db.query(self.SELECT + ("WHERE " + " AND ".join(where) + " " if where else "")
                             + "ORDER BY p.status IN ('abgeschlossen', 'abgebrochen'), CASE WHEN p.due_date = '' THEN '9999' ELSE p.due_date END, p.id DESC", params)
        return [self.view(p) for p in rows]

    def tasks(self, pid: int) -> list[dict[str, Any]]:
        return self.db.query("SELECT t.*, u.name AS assignee FROM project_tasks t LEFT JOIN users u ON u.id = t.assignee_id "
                             "WHERE t.project_id = ? ORDER BY t.position, t.id", (pid,))

    def add_task(self, pid: int, data: dict[str, Any]) -> int:
        pos = (self.db.scalar("SELECT COALESCE(MAX(position), 0) FROM project_tasks WHERE project_id = ?", (pid,)) or 0) + 1
        return self.db.insert("project_tasks", {**data, "project_id": pid, "position": pos,
                                                "done_at": now_iso() if data.get("status") == "erledigt" else ""})

    def apply_template(self, pid: int, key: str) -> int:
        n = 0
        for phase, tasks in TEMPLATES[key]["phases"]:
            for title, minutes in tasks:
                self.add_task(pid, {"phase": phase, "title": title, "estimate_min": minutes, "status": "offen"})
                n += 1
        return n

    def link_ticket(self, pid: int, ticket_id: int) -> None:
        """Ticket ans Projekt hängen: schon gebuchte Zeiten zählen mit; bei Fixpreis/intern werden unverrechnete Zeiten nicht mehr verrechnet."""
        p = self.db.get("projects", pid)
        self.db.update("tickets", ticket_id, {"project_id": pid})
        self.db.query("UPDATE time_entries SET project_id = ? WHERE ticket_id = ? AND project_id IS NULL", (pid, ticket_id))
        if p["billing"] in ("fixpreis", "intern"):
            self.db.query("UPDATE time_entries SET billable = 0 WHERE ticket_id = ? AND project_id = ? AND invoice_id IS NULL", (ticket_id, pid))

    def budget_alerts(self, notifier: Any) -> None:
        """Einmalige Meldung, wenn ein Stundenbudget zu 80 % verbraucht oder überschritten ist."""
        if not notifier:
            return
        for p in self.list("offen"):
            if p["budget_used"] is None or p["budget_used"] < 80:
                continue
            level = 100 if p["budget_used"] >= 100 else 80
            try:
                notifier.emit("projekt", f"Projektbudget {'überschritten' if level == 100 else 'zu 80 % verbraucht'}: {p['title']}",
                              f"{p['hours']:g} von {p['budget_hours']:g} Stunden · {p['progress']} % der Aufgaben erledigt · {p['customer']}".replace(".", ","),
                              link=f"projekt/{p['id']}", severity="hoch" if level == 100 else "info", user_id=p["manager_id"], ref=f"projekt-{p['id']}-{level}")
            except Exception:  # noqa: BLE001 - Meldung ist Komfort
                pass


def register(app: FastAPI, ctx: Any) -> Projects:
    db: Database = ctx.db
    svc = Projects(db)
    app.state.projects = svc

    def need(pid: int) -> dict[str, Any]:
        p = svc.get(pid)
        if not p:
            raise HTTPException(404, "Projekt nicht gefunden")
        return p

    def check(d: dict[str, Any]) -> None:
        if d.get("customer_id") and not db.get("customers", d["customer_id"]):
            raise HTTPException(404, "Kunde nicht gefunden")
        if d.get("manager_id") and not db.get("users", d["manager_id"]):
            raise HTTPException(404, "Benutzer nicht gefunden")
        if d.get("start_date") and d.get("due_date") and d["due_date"] < d["start_date"]:
            raise HTTPException(422, "Das Ende liegt vor dem Beginn.")

    def detail(pid: int) -> dict[str, Any]:
        p = need(pid)
        tasks = svc.tasks(pid)
        phases: list[dict[str, Any]] = []
        for t in tasks:
            name = t["phase"] or "Aufgaben"
            if not phases or phases[-1]["name"] != name:
                phases.append({"name": name, "tasks": []})
            phases[-1]["tasks"].append({**{k: t[k] for k in ("id", "title", "notes", "status", "assignee_id", "due_date", "estimate_min", "done_at", "phase")},
                                        "assignee": t["assignee"] or "", "late": bool(t["status"] != "erledigt" and t["due_date"] and t["due_date"] < date.today().isoformat())})
        for ph in phases:
            ph["done"] = sum(1 for t in ph["tasks"] if t["status"] == "erledigt")
        by_user = db.query("SELECT COALESCE(u.name, 'ohne Benutzer') AS name, SUM(e.minutes) AS minutes FROM time_entries e LEFT JOIN users u ON u.id = e.user_id "
                           "WHERE e.project_id = ? GROUP BY e.user_id ORDER BY minutes DESC", (pid,))
        entries = db.query("SELECT e.id, e.date, e.minutes, e.description, e.billable, e.ticket_id, u.name AS user_name FROM time_entries e "
                           "LEFT JOIN users u ON u.id = e.user_id WHERE e.project_id = ? ORDER BY e.date DESC, e.id DESC LIMIT 25", (pid,))
        tickets = db.query("SELECT id, title, status, priority FROM tickets WHERE project_id = ? ORDER BY status = 'geloest', id DESC", (pid,))
        quote = db.get("quotes", p["quote_id"]) if p["quote_id"] else None
        return {**svc.view(p), "phases": phases, "time_by_user": by_user, "time_entries": entries, "tickets": tickets,
                "quote": {"id": quote["id"], "title": quote["title"], "status": quote["status"], "total_once": quote["total_once"]} if quote else None}

    @app.get("/api/projects/templates")
    def templates() -> dict:
        return {"templates": [{"key": k, "label": v["label"], "budget_hours": v["budget_hours"], "tasks": sum(len(t) for _, t in v["phases"]),
                               "phases": [name for name, _ in v["phases"]]} for k, v in TEMPLATES.items()],
                "status": STATUS, "billing": BILLING, "task_status": TASK_STATUS}

    @app.get("/api/projects")
    def list_projects(status: str = "offen", customer_id: int = 0) -> dict:
        svc.budget_alerts(getattr(app.state, "notifier", None))
        rows = svc.list(status, customer_id or None)
        open_rows = [r for r in rows if r["status"] in OPEN]
        return {"items": rows, "summary": {"open": len(open_rows), "red": sum(1 for r in open_rows if r["light"] == "rot"),
                                           "yellow": sum(1 for r in open_rows if r["light"] == "gelb"),
                                           "hours": round(sum(r["hours"] for r in open_rows), 1), "late_tasks": sum(r["tasks_late"] for r in open_rows)}}

    @app.post("/api/projects", status_code=201)
    def create(data: ProjectIn) -> dict:
        d = data.model_dump()
        template = d.pop("template")
        if template and template not in TEMPLATES:
            raise HTTPException(422, "Unbekannte Vorlage")
        check(d)
        if d["quote_id"]:
            q = db.get("quotes", d["quote_id"])
            if not q:
                raise HTTPException(404, "Angebot nicht gefunden")
            d["customer_id"] = d["customer_id"] or q["customer_id"]
            if not d["budget_amount"]:
                d["budget_amount"] = q["total_once"] or 0
        if template and not d["budget_hours"]:
            d["budget_hours"] = TEMPLATES[template]["budget_hours"]
        pid = db.insert("projects", {**d, "closed_at": ""})
        if template:
            svc.apply_template(pid, template)
        return detail(pid)

    @app.get("/api/projects/{pid}")
    def one(pid: int) -> dict:
        return detail(pid)

    @app.put("/api/projects/{pid}")
    def update(pid: int, data: ProjectIn) -> dict:
        old = need(pid)
        d = data.model_dump()
        d.pop("template")
        check(d)
        if d["status"] in ("abgeschlossen", "abgebrochen") and old["status"] in OPEN:
            d["closed_at"] = now_iso()
        elif d["status"] in OPEN:
            d["closed_at"] = ""
        db.update("projects", pid, d)
        return detail(pid)

    @app.delete("/api/projects/{pid}")
    def delete(pid: int) -> dict:
        need(pid)
        if db.scalar("SELECT COUNT(*) FROM time_entries WHERE project_id = ?", (pid,)):
            raise HTTPException(409, "Auf dieses Projekt sind Zeiten gebucht – bitte abschließen oder abbrechen statt löschen.")
        db.query("UPDATE tickets SET project_id = NULL WHERE project_id = ?", (pid,))
        db.delete("projects", pid)
        return {"ok": True}

    # --- Aufgaben ----------------------------------------------------------------------------------
    @app.post("/api/projects/{pid}/tasks", status_code=201)
    def add_task(pid: int, data: TaskIn) -> dict:
        need(pid)
        svc.add_task(pid, data.model_dump())
        return detail(pid)

    @app.post("/api/projects/{pid}/template/{key}")
    def add_template(pid: int, key: str) -> dict:
        need(pid)
        if key not in TEMPLATES:
            raise HTTPException(404, "Vorlage nicht gefunden")
        svc.apply_template(pid, key)
        return detail(pid)

    @app.put("/api/project-tasks/{tid}")
    def edit_task(tid: int, data: TaskPatch) -> dict:
        t = db.get("project_tasks", tid)
        if not t:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        patch = data.model_dump(exclude_unset=True)
        if "status" in patch and patch["status"] != t["status"]:
            patch["done_at"] = now_iso() if patch["status"] == "erledigt" else ""
        if patch:
            db.update("project_tasks", tid, patch)
        p = db.get("projects", t["project_id"])
        if p["status"] == "geplant" and patch.get("status") in ("in_arbeit", "erledigt"):
            db.update("projects", p["id"], {"status": "laufend"})  # die erste angefasste Aufgabe startet das Projekt
        return detail(t["project_id"])

    @app.delete("/api/project-tasks/{tid}")
    def drop_task(tid: int) -> dict:
        t = db.get("project_tasks", tid)
        if not t:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        db.delete("project_tasks", tid)
        return detail(t["project_id"])

    # --- Tickets -----------------------------------------------------------------------------------
    @app.post("/api/projects/{pid}/tickets")
    def link(pid: int, data: LinkIn) -> dict:
        need(pid)
        if not db.get("tickets", data.ticket_id):
            raise HTTPException(404, "Ticket nicht gefunden")
        svc.link_ticket(pid, data.ticket_id)
        return detail(pid)

    @app.delete("/api/projects/{pid}/tickets/{tid}")
    def unlink(pid: int, tid: int) -> dict:
        need(pid)
        db.query("UPDATE tickets SET project_id = NULL WHERE id = ? AND project_id = ?", (tid, pid))
        db.query("UPDATE time_entries SET project_id = NULL WHERE ticket_id = ? AND project_id = ?", (tid, pid))
        return detail(pid)

    @app.get("/api/my-project-tasks")
    def my_tasks(request: Request) -> list[dict]:
        """Offene Projektaufgaben des angemeldeten Benutzers (ohne Benutzerkonten: alle) – für „Mein Tag“."""
        u = getattr(request.state, "user", None)
        uid = u["id"] if isinstance(u, dict) else None
        rows = db.query("SELECT t.id, t.title, t.due_date, t.status, t.project_id, p.title AS project, c.name AS customer FROM project_tasks t "
                        "JOIN projects p ON p.id = t.project_id LEFT JOIN customers c ON c.id = p.customer_id "
                        "WHERE t.status != 'erledigt' AND p.status IN ('geplant', 'laufend') " + ("AND t.assignee_id = ? " if uid else "AND t.due_date != '' ")
                        + "ORDER BY CASE WHEN t.due_date = '' THEN '9999' ELSE t.due_date END, t.position LIMIT 12", (uid,) if uid else ())
        today = date.today().isoformat()
        return [{**r, "late": bool(r["due_date"] and r["due_date"] < today)} for r in rows]

    return svc
