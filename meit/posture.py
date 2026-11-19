"""Sicherheitslage je Kunde: eine Note aus allen Quellen – für die eigene Übersicht, den Kunden und den Verkauf.

Bereiche (jeweils 0–100, „nicht erfasst“ wenn die Quelle fehlt):
* **Identität & Microsoft 365** – Befunde aus dem Tenant-Check (MFA, Weiterleitungen, Admin-Konten, Secure Score)
* **Geräte** – Geräte-Check des Inventar-Agenten (Verschlüsselung, Virenschutz, Updates …)
* **Datensicherung** – Backup-Wächter (letzter Status und Erfolgsquote der letzten 30 Tage)
* **E-Mail & Domain** – SPF/DKIM/DMARC, Zertifikate
* **Organisation** – Security-/NIS2-Check (Fragebogen)

Daraus: Gesamtnote mit Ampel und Verlauf (monatlich gespeichert), Abdeckung („was ist bei diesem Kunden angebunden?“),
priorisierter Maßnahmenplan, **IT-Sicherheitsbericht** als Text/PDF im ME-IT-Design und ein **Angebot aus den Maßnahmen**.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, timedelta
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from .db import Database, now_iso

AREAS = {"m365": "Identität & Microsoft 365", "devices": "Geräte", "backup": "Datensicherung", "mail": "E-Mail & Domain",
         "org": "Organisation & Richtlinien"}
CONNECT_HINT = {
    "m365": "Microsoft 365 verbinden (Zustimmungs-Link) – zeigt MFA, Weiterleitungen und Lizenzen",
    "devices": "Inventar-Agent verteilen – zeigt Verschlüsselung, Virenschutz und Updates je Gerät",
    "backup": "Sicherungsberichte ans Cockpit leiten – überwacht jede Sicherung",
    "mail": "Domain prüfen – SPF, DKIM, DMARC und Zertifikat",
    "org": "Security-/NIS2-Check durchführen (15 Fragen)",
}
WEIGHT = {"kritisch": 40, "hoch": 20, "mittel": 10, "niedrig": 3, "info": 0}
SEVERITY = {"kritisch": 0, "hoch": 1, "mittel": 2, "niedrig": 3, "info": 4}
BACKUP_STATUS = {"ok": 100, "warnung": 70, "fehler": 20, "überfällig": 10, "": 60}


def level(score: int | None) -> str:
    return "unbekannt" if score is None else "gut" if score >= 80 else "mittel" if score >= 60 else "kritisch"


class Posture:
    def __init__(self, app: FastAPI, ctx: Any):
        self.app, self.ctx, self.db = app, ctx, ctx.db

    def _svc(self, name: str) -> Any:
        return getattr(self.app.state, name, None)

    # ------------------------------------------------------------------ Bereiche
    def compute(self, customer_id: int, today: date | None = None, store: bool = True) -> dict[str, Any]:
        today = today or date.today()
        db = self.db
        c = db.get("customers", customer_id)
        if not c:
            raise LookupError("Kunde nicht gefunden")
        areas: dict[str, dict[str, Any]] = {}
        measures: list[dict[str, Any]] = []

        def measure(area: str, f: dict[str, Any], prefix: str = "") -> None:
            if f.get("ignored") or f.get("severity") == "info":
                return
            measures.append({"area": area, "area_label": AREAS[area], "severity": f["severity"],
                             "title": (prefix + f["title"])[:200], "detail": f.get("detail", ""), "action": f.get("action", "")})

        # --- Microsoft 365
        m365 = self._svc("m365")
        t = m365.tenant(customer_id) if m365 else None
        if t and t["last_sync"]:
            found = [f for f in m365.findings(customer_id, today) if not f["ignored"] and not f["key"].startswith("lic-")]
            score = max(0, 100 - sum(WEIGHT[f["severity"]] for f in found))
            s = m365.summary(customer_id, today) or {}
            areas["m365"] = {"score": score, "note": f"MFA {s.get('mfa_pct')} %" if s.get("mfa_pct") is not None else "",
                             "facts": [x for x in (f"{s.get('users', 0)} Benutzer", f"Secure Score {s['secure_score_pct']} %"
                                                   if s.get("secure_score_pct") is not None else "") if x]}
            for f in found:
                measure("m365", f)
        # --- Geräte
        inv = self._svc("inventory")
        devices = [d for d in (inv.devices(customer_id, today) if inv else []) if d["reported"] and d["active"]]
        if devices:
            score = round(sum(d["score"] for d in devices) / len(devices))
            healthy = len([d for d in devices if not any(d["counts"].values())])
            areas["devices"] = {"score": score, "note": f"{healthy} von {len(devices)} ohne Befund", "facts": [f"{len(devices)} Geräte mit Agent"]}
            grouped: dict[str, dict[str, Any]] = {}
            for d in devices:
                for f in d["findings"]:
                    if f["ignored"] or f["severity"] == "info" or f["key"] == "offline":
                        continue
                    g = grouped.setdefault(f["key"], {**f, "hosts": []})
                    g["hosts"].append(d["hostname"])
                    if SEVERITY[f["severity"]] < SEVERITY[g["severity"]]:
                        g["severity"] = f["severity"]
            for g in grouped.values():
                n = len(g["hosts"])
                title = g["title"] if n == 1 else f"{g['title'].split(' (')[0]} – {n} Geräte"
                measure("devices", {**g, "title": title, "detail": f"Betroffen: {', '.join(g['hosts'][:8])}" + (" …" if n > 8 else "")})
        # --- Datensicherung
        bk = self._svc("backups")
        jobs = [j for j in (bk.jobs(customer_id, today) if bk else []) if j["active"]]
        if jobs:
            stats = bk.stats(customer_id, (today - timedelta(days=30)).isoformat(), (today + timedelta(days=1)).isoformat())
            status = sum(BACKUP_STATUS.get(j["last_status"], 60) for j in jobs) / len(jobs)
            score = round(0.5 * status + 0.5 * stats["quote"]) if stats["quote"] is not None else round(status)
            areas["backup"] = {"score": score, "note": f"{stats['quote']} % erfolgreich (30 Tage)" if stats["quote"] is not None else "",
                               "facts": [f"{len(jobs)} überwachte Sicherung(en)"]}
            for j in jobs:
                if j["last_status"] in ("fehler", "überfällig"):
                    measure("backup", {"severity": "hoch", "title": f"Sicherung „{j['name']}“: "
                                       + ("fehlgeschlagen" if j["last_status"] == "fehler" else "kein Bericht mehr"),
                                       "detail": f"Letzte erfolgreiche Sicherung: {(j['last_success_at'] or 'nie')[:10]}.",
                                       "action": "Ursache beheben und Sicherung neu starten; Wiederherstellung testen."})
        # --- E-Mail & Domain
        dom = self._svc("domains")
        rows = [r for r in (dom.rows(customer_id) if dom else []) if r["last_check"]]
        if rows:
            areas["mail"] = {"score": round(sum(r["score"] for r in rows) / len(rows)), "note": ", ".join(r["domain"] for r in rows[:3]),
                             "facts": [f"{len(rows)} Domain(s) geprüft"]}
            for r in rows:
                for f in r["findings"]:
                    measure("mail", f, prefix=f"{r['domain']}: ")
        # --- Organisation
        a = db.query_one("SELECT score, level, created_at FROM assessments WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
                         (customer_id,))
        if a:
            areas["org"] = {"score": round(a["score"]), "note": f"Security-Check vom {a['created_at'][:10]}", "facts": []}
            if a["score"] < 60:
                measure("org", {"severity": "hoch" if a["score"] < 40 else "mittel", "title": "Organisatorische Sicherheit ausbaufähig",
                                "detail": f"Security-/NIS2-Check: {a['score']:.0f} von 100 Punkten.",
                                "action": "Maßnahmen aus dem Security-Bericht umsetzen (Richtlinien, Schulung, Notfallplan)."})
        # --- Geräte ohne Herstellersupport (auch ohne Agent sichtbar)
        from .radar import eol_info

        if "devices" not in areas:
            eol = [x["name"] for x in db.query("SELECT name, os FROM assets WHERE customer_id = ?", (customer_id,))
                   if (i := eol_info(x["os"] or "")) and i[0] <= today]
            if eol:
                measure("devices", {"severity": "hoch", "title": f"{len(eol)} Gerät(e) ohne Herstellersupport",
                                    "detail": ", ".join(eol[:8]), "action": "Auf unterstützte Systeme umstellen bzw. ersetzen."})

        for key in AREAS:
            a_ = areas.setdefault(key, {"score": None, "note": "nicht erfasst", "facts": []})
            a_.update({"key": key, "label": AREAS[key], "level": level(a_["score"]),
                       "hint": CONNECT_HINT[key] if a_["score"] is None else ""})
        scored = [a_["score"] for a_ in areas.values() if a_["score"] is not None]
        score = round(sum(scored) / len(scored)) if scored else None
        # ein kritischer Befund darf nicht von guten Bereichen „weggemittelt“ werden
        if score is not None and any(m["severity"] == "kritisch" for m in measures):
            score = min(score, 59)
        measures.sort(key=lambda m: (SEVERITY[m["severity"]], m["area"]))
        month = today.strftime("%Y-%m")
        if store and score is not None:
            with db.connect() as conn:
                conn.execute("INSERT INTO posture_history (customer_id, month, score, areas, updated_at) VALUES (?, ?, ?, ?, ?) "
                             "ON CONFLICT(customer_id, month) DO UPDATE SET score = excluded.score, areas = excluded.areas, "
                             "updated_at = excluded.updated_at",
                             (customer_id, month, score, json.dumps({k: v["score"] for k, v in areas.items()}), now_iso()))
        history = [{"month": h["month"], "score": h["score"]} for h in db.query(
            "SELECT month, score FROM posture_history WHERE customer_id = ? ORDER BY month DESC LIMIT 12", (customer_id,))][::-1]
        previous = next((h["score"] for h in reversed(history) if h["month"] < month), None)
        return {"customer_id": customer_id, "customer": c["name"], "score": score, "level": level(score),
                "coverage": len(scored), "areas": [areas[k] for k in AREAS], "measures": measures,
                "counts": {s: len([m for m in measures if m["severity"] == s]) for s in ("kritisch", "hoch", "mittel", "niedrig")},
                "history": history, "trend": None if previous is None or score is None else score - previous}

    def overview(self) -> dict[str, Any]:
        rows = []
        for c in self.db.query("SELECT id, name, package FROM customers ORDER BY name"):
            p = self.compute(c["id"])
            rows.append({"customer_id": c["id"], "customer": c["name"], "package": c["package"], "score": p["score"], "level": p["level"],
                         "coverage": p["coverage"], "trend": p["trend"], "counts": p["counts"],
                         "areas": {a["key"]: a["score"] for a in p["areas"]}, "top": p["measures"][0]["title"] if p["measures"] else ""})
        rows.sort(key=lambda r: (r["score"] is None, r["score"] if r["score"] is not None else 0))
        scored = [r["score"] for r in rows if r["score"] is not None]
        return {"customers": rows, "area_labels": AREAS,
                "summary": {"avg": round(sum(scored) / len(scored)) if scored else None, "critical": len([r for r in rows if r["level"] == "kritisch"]),
                            "uncovered": len([r for r in rows if r["coverage"] == 0]),
                            "full": len([r for r in rows if r["coverage"] == len(AREAS)])}}

    # ------------------------------------------------------------------ Bericht
    def report(self, customer_id: int, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        p = self.compute(customer_id, today)
        company = getattr(self.ctx, "company", "ME-IT")
        emoji = {"gut": "🟢", "mittel": "🟡", "kritisch": "🔴", "unbekannt": "⚪"}
        lines = [f"# IT-Sicherheitsbericht – {p['customer']}", "", f"Stand: {today.strftime('%d.%m.%Y')}", ""]
        if p["score"] is None:
            lines += ["Für eine Bewertung fehlen noch die Datenquellen. Empfohlene erste Schritte:", ""]
            lines += [f"- {a['hint']}" for a in p["areas"]]
        else:
            trend = "" if p["trend"] is None else f" ({'+' if p['trend'] >= 0 else ''}{p['trend']} seit dem Vormonat)"
            lines += ["## Gesamtbewertung", "", f"**{p['score']} von 100 Punkten – {p['level']}**{trend}", ""]
            summary = self._summary(p)
            if summary:
                lines += [summary, ""]
            lines += ["| Bereich | Punkte | Bewertung | Hinweis |", "|---|---|---|---|"]
            for a in p["areas"]:
                lines.append(f"| {a['label']} | {a['score'] if a['score'] is not None else '–'} | {emoji[a['level']]} {a['level']} | "
                             f"{a['note'] or '–'} |")
            flagged = {m["area"] for m in p["measures"] if m["severity"] in ("kritisch", "hoch")}
            good = [a for a in p["areas"] if a["score"] is not None and a["score"] >= 80 and a["key"] not in flagged]
            if good:
                lines += ["", "## Das läuft gut"] + [f"- **{a['label']}**: {a['note'] or 'ohne Auffälligkeiten'}" for a in good]
            urgent = [m for m in p["measures"] if m["severity"] in ("kritisch", "hoch")]
            rest = [m for m in p["measures"] if m["severity"] not in ("kritisch", "hoch")]
            if urgent:
                lines += ["", "## Handlungsbedarf – bitte zeitnah"]
                for i, m in enumerate(urgent[:12], 1):
                    detail = f" – {m['detail']}" if m["detail"] else ""
                    lines.append(f"{i}. **{m['title']}** ({m['area_label']}, {m['severity']}){detail} **Empfehlung:** {m['action']}")
            if rest:
                lines += ["", "## Weitere Empfehlungen"] + [f"- **{m['title']}** – {m['action']}" for m in rest[:12]]
            missing = [a for a in p["areas"] if a["score"] is None]
            if missing:
                lines += ["", "## Noch nicht erfasst", "Diese Bereiche fließen noch nicht in die Bewertung ein:"]
                lines += [f"- **{a['label']}**: {a['hint']}" for a in missing]
            if not urgent and not rest:
                lines += ["", "Aktuell gibt es keinen Handlungsbedarf. Wir überwachen die Systeme laufend weiter."]
        lines += ["", "## So geht es weiter", "Wir besprechen die Punkte gerne mit Ihnen und setzen die Maßnahmen nach Ihrer Freigabe um.",
                  "", f"_Erstellt von {company} auf Basis automatischer Prüfungen (Microsoft 365, Geräte, Datensicherung, "
                      f"E-Mail-Domain) – Momentaufnahme, keine Garantie für Vollständigkeit._"]
        return {**p, "title": f"IT-Sicherheitsbericht {today.strftime('%m/%Y')} – {p['customer']}", "text": "\n".join(lines)}

    def _summary(self, p: dict[str, Any]) -> str:
        c = p["counts"]
        worst = min((a for a in p["areas"] if a["score"] is not None), key=lambda a: a["score"], default=None)
        parts = []
        if c["kritisch"]:
            parts.append("Es gibt **einen kritischen Punkt**, der sofort angegangen werden sollte." if c["kritisch"] == 1 else
                         f"Es gibt **{c['kritisch']} kritische Punkte**, die sofort angegangen werden sollten.")
        elif c["hoch"]:
            parts.append("Es gibt einen wichtigen Punkt mit zeitnahem Handlungsbedarf." if c["hoch"] == 1 else
                         f"Es gibt {c['hoch']} wichtige Punkte mit zeitnahem Handlungsbedarf.")
        else:
            parts.append("Es gibt keine kritischen Punkte.")
        if worst and worst["score"] < 80:
            parts.append(f"Den größten Hebel sehen wir im Bereich „{worst['label']}“ ({worst['score']} Punkte).")
        if p["coverage"] < len(AREAS):
            parts.append(f"{p['coverage']} von {len(AREAS)} Bereichen sind bisher erfasst.")
        return " ".join(parts)

    def quote(self, customer_id: int) -> dict[str, Any]:
        """Angebot aus dem Maßnahmenplan: Leistungen aus dem Umsatz-Radar, Begründung aus den Befunden."""
        from .agents.quote import create_quote

        p = self.compute(customer_id)
        urgent = [m for m in p["measures"] if m["severity"] in ("kritisch", "hoch", "mittel")]
        if not urgent:
            raise ValueError("Keine offenen Maßnahmen – kein Angebot nötig.")
        scan = self.ctx.radar.scan(customer_id)
        codes: list[str] = []
        for o in scan["opportunities"]:
            if o["kind"] in ("security", "compliance", "lifecycle") and o["service_code"] not in codes:
                codes.append(o["service_code"])
        need = (f"Maßnahmen aus dem IT-Sicherheitsbericht ({p['score']} von 100 Punkten):\n"
                + "\n".join(f"- {m['title']} ({m['area_label']}): {m['action']}" for m in urgent[:15]))
        return create_quote(self.ctx, customer_id, need, codes[:8] or ["STD"], tiers=False)

    def portal_view(self, customer_id: int) -> dict[str, Any] | None:
        p = self.compute(customer_id, store=False)
        if p["score"] is None:
            return None
        return {"score": p["score"], "level": p["level"], "trend": p["trend"],
                "areas": [{"label": a["label"], "score": a["score"], "level": a["level"]} for a in p["areas"]],
                "measures": [{"title": m["title"], "severity": m["severity"], "action": m["action"]}
                             for m in p["measures"] if m["severity"] in ("kritisch", "hoch")][:5],
                "history": p["history"]}

    def snapshot_all(self) -> int:
        n = 0
        for c in self.db.query("SELECT id FROM customers"):
            try:
                self.compute(c["id"])
                n += 1
            except Exception:  # noqa: BLE001
                continue
        return n


def register(app: FastAPI, ctx: Any, admin_only, start: bool = False) -> Posture:
    db: Database = ctx.db
    svc = Posture(app, ctx)
    app.state.posture = svc

    def need(cid: int) -> None:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")

    @app.get("/api/posture")
    def overview() -> dict:
        return svc.overview()

    @app.get("/api/posture/{cid}")
    def detail(cid: int) -> dict:
        need(cid)
        return svc.compute(cid)

    @app.get("/api/posture/{cid}/report")
    def report(cid: int) -> dict:
        need(cid)
        return svc.report(cid)

    @app.get("/api/posture/{cid}/report.pdf")
    def report_pdf(cid: int) -> Response:
        need(cid)
        r = svc.report(cid)
        pdf = ctx.docs.text_pdf(r["title"], r["text"])
        return Response(bytes(pdf), media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="IT-Sicherheitsbericht-{cid}.pdf"'})

    @app.post("/api/posture/{cid}/quote", status_code=201)
    def quote(cid: int, request: Request) -> dict:
        need(cid)
        try:
            q = svc.quote(cid)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        from .team import current_user_id, log_activity

        log_activity(db, current_user_id(request), "angebot_erstellt", "quote", q["id"], q["title"])
        return q

    if start:
        def loop() -> None:
            time.sleep(900)
            while True:
                try:
                    svc.snapshot_all()  # Verlauf: Stand je Monat festhalten
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(24 * 3600)

        threading.Thread(target=loop, name="posture", daemon=True).start()
    return svc

