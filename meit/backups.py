"""Backup-Wächter: Sicherungsberichte aus dem Postfach automatisch auswerten.

* Erkennt Berichte von Veeam (B&R, Agent, M365), Synology Hyper Backup/Active Backup, Acronis und allgemeine
  Sicherungsmails („erfolgreich“, „fehlgeschlagen“, „warning“ …) – deutsch und englisch.
* Jeder Bericht wird einem **Sicherungsjob** zugeordnet (Kunde über Absender-Domain oder Gerätename); neue Jobs
  entstehen automatisch. Berichte erzeugen keine Tickets im Posteingang mehr – nur noch Fehler tun das.
* **Fehler** → Ticket (einmal je Job, weitere Fehler als Notiz), **Folgesicherung erfolgreich** → Ticket wird mit
  Vermerk geschlossen. **Bericht bleibt aus** (z. B. NAS aus, Mailversand kaputt) → Ticket „Backup-Bericht fehlt“.
* Ampel der letzten 14 Tage je Job, Quote im Monatsbericht/QBR, Status im Kundenportal, Chance im Radar.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database, now_iso

STATUS_RANK = {"ok": 0, "warnung": 1, "fehler": 2, "überfällig": 2}
GRACE_HOURS = 6
BACKUP_WORDS = ("backup", "sicherung", "datensicherung", "veeam", "hyper backup", "active backup", "acronis", "cyber protect",
                "datto", "altaro", "nakivo", "wbadmin", "windows server-sicherung", "replication", "replikation",
                "snapshot", "restore point", "wiederherstellungspunkt", "backup exec", "arcserve", "dropsuite", "afi.ai")
FAIL_WORDS = ("failed", "failure", "fehlgeschlagen", "fehler", "error", "abgebrochen", "aborted", "unsuccessful",
              "nicht erfolgreich", "critical")
WARN_WORDS = ("warning", "warnung", "partially", "teilweise", "with warnings", "mit warnungen", "skipped", "übersprungen")
OK_WORDS = ("success", "successful", "succeeded", "erfolgreich", "completed", "abgeschlossen", "beendet", "finished", " ok")
NOISE_WORDS = ("newsletter", "webinar", "angebot", "rabatt", "sale", "testversion", "trial", "lizenz läuft ab",
               "license expir", "renewal", "verlängerung", "einladung", "invitation", "unsubscribe", "abmelden")

VEEAM = re.compile(r"^\s*\[(success|warning|failed|erfolg(?:reich)?|warnung|fehler)\]\s*(.+?)\s*(?:\((\d+)\s*\w+\))?\s*$", re.I)
SYNOLOGY = re.compile(
    r"(?:backup task|sicherungsaufgabe|datensicherungsaufgabe|backup-aufgabe|aufgabe)\s+[\"„'“]?(?P<job>.+?)[\"“'”]?\s+"
    r"(?:on\s+(?P<host>[\w.-]+)\s+)?(?:has\s+|was\s+|wurde\s+|ist\s+|have\s+)?(?:auf\s+[\w.-]+\s+)?"
    r"(?P<st>successfully completed|completed successfully|partially completed|completed|succeeded|failed|"
    r"erfolgreich abgeschlossen|teilweise abgeschlossen|abgeschlossen|fehlgeschlagen)", re.I)
BRACKET_HOST = re.compile(r"^\s*\[([\w .-]{2,40})\]\s*")


def _status_from(text: str) -> str | None:
    t = f" {text.lower()} "
    if any(w in t for w in FAIL_WORDS):
        # „0 errors“ / „0 Fehler“ ist kein Fehler
        if not re.search(r"\b0\s+(?:errors?|fehler|failed)\b", t) or re.search(r"\b[1-9]\d*\s+(?:errors?|fehler|failed)\b", t):
            return "fehler"
    if any(w in t for w in WARN_WORDS):
        return "warnung"
    if any(w in t for w in OK_WORDS):
        return "ok"
    return None


def detect_report(subject: str, body: str = "", sender: str = "") -> dict[str, Any] | None:
    """Ist die Mail ein Sicherungsbericht? → {source, job, host, status, details} oder None."""
    subject = (subject or "").strip()
    low = f"{subject}\n{body[:3000]}".lower()
    if any(w in low for w in NOISE_WORDS) and not VEEAM.match(subject):
        return None
    m = VEEAM.match(subject)
    if m and ("veeam" in low or "backup" in low or "job" in low or "sicherung" in low or "agent" in low):
        word = m.group(1).lower()
        status = "ok" if word.startswith(("success", "erfolg")) else "warnung" if word.startswith(("warn",)) else "fehler"
        job = re.sub(r"^(?:backup job|agent backup job|backup copy job|job|sicherungsauftrag)\s*:?\s*", "", m.group(2), flags=re.I)
        return {"source": "veeam", "job": job.strip()[:120], "host": "", "status": status,
                "details": f"{m.group(3)} Objekt(e)" if m.group(3) else ""}
    s = SYNOLOGY.search(subject) or (SYNOLOGY.search(body[:2000]) if "synology" in low or "hyper backup" in low else None)
    if s:
        st = s.group("st").lower()
        status = "warnung" if ("partial" in st or "teilweise" in st) else "fehler" if ("fail" in st or "fehlgeschlagen" in st) else "ok"
        host = s.group("host") or ""
        hb = BRACKET_HOST.match(subject)
        if hb and not host:
            host = hb.group(1).strip()
        return {"source": "synology" if ("synology" in low or hb) else "allgemein", "job": s.group("job").strip()[:120],
                "host": host[:60], "status": status, "details": ""}
    if not any(w in low for w in BACKUP_WORDS):
        return None
    status = _status_from(subject) or _status_from(body[:1500])
    if not status:
        return None
    source = next((k for k, words in (("acronis", ("acronis", "cyber protect")), ("veeam", ("veeam",)),
                                      ("synology", ("synology", "hyper backup", "active backup")),
                                      ("windows", ("wbadmin", "windows server-sicherung", "windows server backup")),
                                      ("datto", ("datto",))) if any(w in low for w in words)), "allgemein")
    job = re.sub(r"\[[^\]]*\]|\b(?:success(?:ful)?|succeeded|failed|warning|erfolgreich|fehlgeschlagen|warnung|"
                 r"abgeschlossen|completed|error|fehler)\b|[:!\-–]+", " ", subject, flags=re.I)
    job = re.sub(r"\s+", " ", job).strip() or "Datensicherung"
    host = ""
    hb = BRACKET_HOST.match(subject)
    if hb:
        host = hb.group(1).strip()
    mh = re.search(r"(?:machine|maschine|computer|gerät|device|server)\s*[:'\"„]?\s*([\w.-]{3,40})", low)
    if mh and not host:
        host = mh.group(1)
    return {"source": source, "job": job[:120], "host": host[:60], "status": status, "details": ""}


def _key(source: str, host: str, job: str, sender: str) -> str:
    norm = lambda x: re.sub(r"[^a-z0-9]+", "-", (x or "").lower()).strip("-")  # noqa: E731
    origin = norm(host) or norm((sender or "").split("@")[-1])
    return f"{source}:{origin}:{norm(job)}"[:200]


class Backups:
    def __init__(self, db: Database):
        self.db = db

    def conf(self) -> dict[str, Any]:
        return {"auto_close": True, "ticket_on_warning": False, **(self.db.get_setting("backup_watch", {}) or {})}

    # ------------------------------------------------------------------ Bericht verbuchen
    def record(self, report: dict[str, Any], *, sender: str = "", customer_id: int | None = None, message_id: int | None = None,
               subject: str = "", at: str | None = None) -> dict[str, Any]:
        db = self.db
        key = _key(report["source"], report["host"], report["job"], sender)
        job = db.query_one("SELECT * FROM backup_jobs WHERE job_key = ?", (key,))
        if not job:
            if not customer_id and report["host"]:
                a = db.query_one("SELECT customer_id FROM assets WHERE lower(name) = lower(?) AND customer_id IS NOT NULL",
                                 (report["host"],))
                customer_id = a["customer_id"] if a else None
            jid = db.insert("backup_jobs", {"customer_id": customer_id, "job_key": key, "name": report["job"],
                                            "source": report["source"], "host": report["host"], "sender": sender.lower()})
            job = db.get("backup_jobs", jid)
        at = at or now_iso()
        rid = db.insert("backup_runs", {"job_id": job["id"], "status": report["status"], "at": at, "subject": subject[:300],
                                        "details": report.get("details", "")[:500], "message_id": message_id})
        patch: dict[str, Any] = {"last_status": report["status"], "last_at": at}
        if report["status"] == "ok":
            patch["last_success_at"] = at
        db.update("backup_jobs", job["id"], patch)
        job = db.get("backup_jobs", job["id"])
        self._tickets(job, report["status"], subject, at)
        return {"job_id": job["id"], "run_id": rid, "job": job["name"], "status": report["status"], "customer_id": job["customer_id"]}

    def _note(self, ticket_id: int, text: str) -> None:
        t = self.db.get("tickets", ticket_id)
        self.db.insert("messages", {"channel": "notiz", "direction": "out", "status": "intern", "body": text,
                                    "subject": "Notiz Backup-Wächter", "linked_type": "ticket", "linked_id": ticket_id,
                                    "customer_id": t["customer_id"] if t else None, "sent_at": now_iso()})

    def _tickets(self, job: dict[str, Any], status: str, subject: str, at: str) -> None:
        db, conf = self.db, self.conf()
        if not job["active"]:
            return
        open_ticket = db.get("tickets", job["ticket_id"]) if job["ticket_id"] else None
        if open_ticket and open_ticket["status"] == "geloest":
            open_ticket = None
        bad = status in ("fehler", "überfällig") or (status == "warnung" and conf["ticket_on_warning"])
        when = at[:16].replace("T", " ")
        if bad:
            if open_ticket:
                self._note(open_ticket["id"], f"Weiterer Bericht {when}: {status} – {subject}")
                return
            customer = db.get("customers", job["customer_id"]) if job["customer_id"] else None
            title = (f"Backup fehlgeschlagen: {job['name']}" if status == "fehler" else
                     f"Backup-Bericht fehlt: {job['name']}" if status == "überfällig" else f"Backup mit Warnung: {job['name']}")
            desc = (f"Sicherungsjob „{job['name']}“ ({job['source']}{', ' + job['host'] if job['host'] else ''})"
                    + (f" bei {customer['name']}" if customer else "") + f"\nStatus: {status} ({when})\n"
                    + (f"Betreff: {subject}\n" if subject else "")
                    + (f"Letzte erfolgreiche Sicherung: {job['last_success_at'][:16].replace('T', ' ')}\n" if job["last_success_at"]
                       else "Noch keine erfolgreiche Sicherung erfasst.\n")
                    + "\nPrüfen: Fehlerursache im Bericht/Gerät, Speicherplatz, Zugangsdaten, Netzwerk. Danach Sicherung neu starten.")
            tid = db.insert("tickets", {"customer_id": job["customer_id"], "title": title[:200], "description": desc,
                                        "status": "neu", "priority": "hoch", "category": "Backup"})
            try:
                from .team import auto_assign

                auto_assign(db, tid)
            except Exception:  # noqa: BLE001
                pass
            db.update("backup_jobs", job["id"], {"ticket_id": tid})
        elif status == "ok" and open_ticket:
            self._note(open_ticket["id"], f"Folgesicherung erfolgreich ({when}).")
            if conf["auto_close"]:
                db.update("tickets", open_ticket["id"], {"status": "geloest", "resolved_at": now_iso(),
                                                         "solution": open_ticket["solution"] or f"Folgesicherung am {when} erfolgreich "
                                                         "(automatisch vom Backup-Wächter geschlossen)."})
                db.query("UPDATE backup_jobs SET ticket_id = NULL WHERE id = ?", (job["id"],))

    # ------------------------------------------------------------------ Überfällige Berichte
    def check_overdue(self, now: datetime | None = None) -> int:
        now = now or datetime.now()
        created = 0
        for job in self.db.query("SELECT * FROM backup_jobs WHERE active = 1 AND last_at != '' AND expected_hours > 0"):
            try:
                last = datetime.fromisoformat(job["last_at"][:19])
            except ValueError:
                continue
            if now - last > timedelta(hours=job["expected_hours"] + GRACE_HOURS) and job["last_status"] != "überfällig":
                self.db.update("backup_jobs", job["id"], {"last_status": "überfällig"})
                job = self.db.get("backup_jobs", job["id"])
                self._tickets(job, "überfällig", "", now.isoformat(timespec="seconds"))
                created += 1
        return created

    # ------------------------------------------------------------------ Auswertung
    def grid(self, job: dict[str, Any], days: int = 14, today: date | None = None) -> list[dict[str, Any]]:
        today = today or date.today()
        start = today - timedelta(days=days - 1)
        runs = self.db.query("SELECT status, at FROM backup_runs WHERE job_id = ? AND at >= ?", (job["id"], start.isoformat()))
        by_day: dict[str, str] = {}
        for r in runs:
            d = r["at"][:10]
            if d not in by_day or STATUS_RANK[r["status"]] > STATUS_RANK[by_day[d]]:
                by_day[d] = r["status"]
        out = []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            st = by_day.get(d)
            if st is None:
                daily = job["expected_hours"] and job["expected_hours"] <= 24
                created = (job["created_at"] or "")[:10]
                st = "fehlt" if daily and created <= d and d < today.isoformat() and job["active"] else "–"
            out.append({"date": d, "status": st})
        return out

    def jobs(self, customer_id: int | None = None, today: date | None = None) -> list[dict[str, Any]]:
        sql = ("SELECT j.*, c.name AS customer FROM backup_jobs j LEFT JOIN customers c ON c.id = j.customer_id")
        params: list[Any] = []
        if customer_id:
            sql += " WHERE j.customer_id = ?"
            params.append(customer_id)
        rows = self.db.query(sql + " ORDER BY CASE j.last_status WHEN 'fehler' THEN 0 WHEN 'überfällig' THEN 1 "
                                   "WHEN 'warnung' THEN 2 ELSE 3 END, c.name, j.name", params)
        for r in rows:
            r["grid"] = self.grid(r, today=today)
            r["active"] = bool(r["active"])
        return rows

    def stats(self, customer_id: int, since: str, until: str) -> dict[str, Any]:
        rows = self.db.query("SELECT r.status, COUNT(*) AS n FROM backup_runs r JOIN backup_jobs j ON j.id = r.job_id "
                             "WHERE j.customer_id = ? AND j.active = 1 AND r.at >= ? AND r.at < ? GROUP BY r.status",
                             (customer_id, since, until))
        counts = {r["status"]: r["n"] for r in rows}
        total = sum(counts.values())
        last = self.db.scalar("SELECT MAX(last_success_at) FROM backup_jobs WHERE customer_id = ? AND active = 1", (customer_id,))
        jobs = self.db.scalar("SELECT COUNT(*) FROM backup_jobs WHERE customer_id = ? AND active = 1", (customer_id,)) or 0
        return {"jobs": jobs, "runs": total, "ok": counts.get("ok", 0), "warnung": counts.get("warnung", 0),
                "fehler": counts.get("fehler", 0), "quote": round(100 * counts.get("ok", 0) / total) if total else None,
                "last_success": last or ""}

    def summary(self) -> dict[str, Any]:
        rows = self.db.query("SELECT last_status, COUNT(*) AS n FROM backup_jobs WHERE active = 1 GROUP BY last_status")
        c = {r["last_status"] or "neu": r["n"] for r in rows}
        unassigned = self.db.scalar("SELECT COUNT(*) FROM backup_jobs WHERE customer_id IS NULL AND active = 1") or 0
        without = self.db.query("SELECT id, name FROM customers WHERE package != 'keins' AND id NOT IN "
                                "(SELECT customer_id FROM backup_jobs WHERE active = 1 AND customer_id IS NOT NULL) ORDER BY name")
        return {"jobs": sum(c.values()), "ok": c.get("ok", 0), "warnung": c.get("warnung", 0), "fehler": c.get("fehler", 0),
                "ueberfaellig": c.get("überfällig", 0), "unassigned": unassigned, "managed_without": without}


def report_lines(db: Database, customer_id: int, since: str, until: str) -> tuple[list[str], dict[str, Any]]:
    s = Backups(db).stats(customer_id, since, until)
    if not s["jobs"] or not s["runs"]:
        return [], {}
    line = (f"- Datensicherung: **{s['ok']} von {s['runs']}** Sicherungen erfolgreich ({s['quote']} %)"
            + (f", {s['fehler']} fehlgeschlagen – behoben bzw. in Arbeit" if s["fehler"] else "")
            + (f"; zuletzt erfolgreich am {datetime.fromisoformat(s['last_success'][:19]).strftime('%d.%m.%Y')}" if s["last_success"] else ""))
    return [line], {"sicherungen": s["runs"], "erfolgreich": s["ok"], "quote": s["quote"]}


class JobIn(BaseModel):
    customer_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    expected_hours: Optional[int] = Field(None, ge=0, le=24 * 31)
    active: Optional[bool] = None


class WatchConfIn(BaseModel):
    auto_close: Optional[bool] = None
    ticket_on_warning: Optional[bool] = None


def register(app: FastAPI, ctx: Any, admin_only, start: bool = False) -> Backups:
    db: Database = ctx.db
    svc = Backups(db)
    app.state.backups = svc
    ctx.backups = svc

    @app.get("/api/backups")
    def overview(customer_id: Optional[int] = None) -> dict:
        svc.check_overdue()
        return {"summary": svc.summary(), "jobs": svc.jobs(customer_id), "conf": svc.conf()}

    @app.put("/api/backups/settings", dependencies=[Depends(admin_only)])
    def settings(data: WatchConfIn) -> dict:
        db.set_setting("backup_watch", {**svc.conf(), **{k: v for k, v in data.model_dump().items() if v is not None}})
        return svc.conf()

    @app.put("/api/backups/jobs/{jid}")
    def update_job(jid: int, data: JobIn) -> dict:
        job = db.get("backup_jobs", jid)
        if not job:
            raise HTTPException(404, "Sicherungsjob nicht gefunden")
        patch = {k: v for k, v in data.model_dump().items() if v is not None}
        if "customer_id" in patch:
            if patch["customer_id"] and not db.get("customers", patch["customer_id"]):
                raise HTTPException(422, "Kunde nicht gefunden")
            if not patch["customer_id"]:
                db.query("UPDATE backup_jobs SET customer_id = NULL WHERE id = ?", (jid,))
                patch.pop("customer_id")
            elif job["ticket_id"]:
                db.update("tickets", job["ticket_id"], {"customer_id": patch["customer_id"]})
        db.update("backup_jobs", jid, patch)
        return db.get("backup_jobs", jid)

    @app.delete("/api/backups/jobs/{jid}", dependencies=[Depends(admin_only)])
    def delete_job(jid: int) -> dict:
        if not db.delete("backup_jobs", jid):
            raise HTTPException(404, "Sicherungsjob nicht gefunden")
        return {"ok": True}

    @app.get("/api/backups/jobs/{jid}/runs")
    def runs(jid: int, limit: int = 60) -> list[dict]:
        return db.query("SELECT r.*, m.from_email FROM backup_runs r LEFT JOIN messages m ON m.id = r.message_id "
                        "WHERE r.job_id = ? ORDER BY r.at DESC LIMIT ?", (jid, min(limit, 500)))

    @app.post("/api/backups/check")
    def check() -> dict:
        return {"overdue": svc.check_overdue(), "summary": svc.summary()}

    @app.post("/api/backups/test")
    def test(data: dict[str, Any]) -> dict:
        """Betreff/Text probehalber erkennen lassen (ohne zu speichern)."""
        return {"report": detect_report(str(data.get("subject", "")), str(data.get("body", "")), str(data.get("sender", "")))}

    if start:
        def loop() -> None:
            time.sleep(300)
            while True:
                try:
                    svc.check_overdue()
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(3600)

        threading.Thread(target=loop, name="backup-watch", daemon=True).start()
    return svc

