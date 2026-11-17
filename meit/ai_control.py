"""Steuerung der KI: welche Aufgabe läuft lokal, welche mit Claude – und was kostet es.

* **Aufgaben-Routing**: je Agent „lokal“ (nie Cloud), „auto“ (lokal, Claude nur als Ersatz) oder „claude“
  (Claude bevorzugt) – plus Denktiefe (effort) je Aufgabe. Modell: Standard ``claude-opus-5-5``.
* **Kosten**: jeder Claude-Aufruf wird mit Tokens (inkl. Cache) und Kosten protokolliert; Monatsbudget –
  ist es erreicht, arbeitet das Cockpit automatisch lokal bzw. mit Regeln weiter.
* **Datenschutz**: Zugangsdaten werden immer geschwärzt; optional werden E-Mail-Adressen, Telefonnummern und
  IBANs pseudonymisiert ([E-MAIL-1] …) und in der Antwort wieder eingesetzt.
* **Belege mit Claude lesen**: PDF (auch gescannt) direkt an Claude, strukturierte Ausgabe.
"""

from __future__ import annotations

import time
from datetime import date
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database

TASKS = {
    "triage": "Tickets einordnen", "inbox": "Posteingang (E-Mails, Anfragen)", "assistant": "KI-Assistent",
    "quote": "Angebote", "report": "Monatsberichte", "qbr": "Quartalsgespräche", "briefing": "Wochenbriefing",
    "security": "Security-Bericht", "portal": "Kundenportal-Hilfe", "receipts": "Belege lesen (PDF)",
    "phishing": "Phishing-Prüfung",
}
MODES = ("lokal", "auto", "claude")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
MODELS = {"claude-opus-5-5": "Claude Opus 5.5 (Standard)", "claude-sonnet-5-5": "Claude Sonnet 5.5",
          "claude-haiku-5-5": "Claude Haiku 5.5"}
# USD je 1 Mio. Tokens: Eingabe, Ausgabe, Cache-Lesen, Cache-Schreiben (5 Min.)
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0), "claude-sonnet-5-5": (2.0, 10.0, 0.10, 2.5),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125), "claude-opus-5": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-4-8": (5.0, 25.0, 0.50, 6.25), "claude-sonnet-5": (2.0, 10.0, 0.20, 2.5),
    "claude-fable-5-2": (8.0, 40.0, 0.20, 10.0),
}
DEFAULT_EFFORT = {"triage": "low", "inbox": "low", "assistant": "medium", "quote": "high", "report": "medium",
                  "qbr": "high", "briefing": "medium", "security": "medium", "portal": "low", "receipts": "low",
                  "phishing": "medium"}


def price_for(model: str) -> tuple[float, float, float, float]:
    for key, value in PRICES.items():
        if model.startswith(key):
            return value
    return PRICES["claude-opus-5-5"]  # unbekannt → konservativ mit Opus-Preisen schätzen


def cost_usd(model: str, usage: Any) -> float:
    pin, pout, pread, pwrite = price_for(model)
    get = lambda k: int(getattr(usage, k, 0) or 0)  # noqa: E731
    return round((get("input_tokens") * pin + get("output_tokens") * pout + get("cache_read_input_tokens") * pread
                  + get("cache_creation_input_tokens") * pwrite) / 1_000_000, 6)


class AiControl:
    def __init__(self, db: Database, settings: Any):
        self.db, self.settings = db, settings
        self._cache: tuple[float, dict[str, Any]] | None = None

    def defaults(self) -> dict[str, Any]:
        cloud = bool(getattr(self.settings, "allow_cloud_fallback", False)) or getattr(self.settings, "llm_provider", "") == "anthropic"
        model = getattr(self.settings, "anthropic_model", "") or "claude-opus-5-5"
        return {"cloud_enabled": cloud, "model": model, "mask_pii": True, "budget_usd": 50.0,
                "tasks": {t: ("lokal" if t in ("receipts", "portal") else "auto") for t in TASKS},
                "effort": dict(DEFAULT_EFFORT)}

    def conf(self) -> dict[str, Any]:
        if self._cache and time.time() - self._cache[0] < 5:
            return self._cache[1]
        d = self.defaults()
        stored = self.db.get_setting("ai", {}) or {}
        conf = {**d, **{k: v for k, v in stored.items() if k in d and k not in ("tasks", "effort")}}
        conf["tasks"] = {**d["tasks"], **{k: v for k, v in (stored.get("tasks") or {}).items() if k in TASKS and v in MODES}}
        conf["effort"] = {**d["effort"], **{k: v for k, v in (stored.get("effort") or {}).items() if k in TASKS and v in EFFORTS}}
        self._cache = (time.time(), conf)
        return conf

    def save(self, data: dict[str, Any]) -> dict[str, Any]:
        conf = self.conf()
        stored = self.db.get_setting("ai", {}) or {}
        if "model" in data and data["model"] not in MODELS:
            raise ValueError("Unbekanntes Modell")
        for key in ("cloud_enabled", "mask_pii"):
            if key in data:
                stored[key] = bool(data[key])
        if "model" in data:
            stored["model"] = data["model"]
        if "budget_usd" in data:
            stored["budget_usd"] = max(0.0, min(float(data["budget_usd"]), 100000.0))
        for key, allowed in (("tasks", MODES), ("effort", EFFORTS)):
            if key in data:
                bad = {k: v for k, v in data[key].items() if k not in TASKS or v not in allowed}
                if bad:
                    raise ValueError(f"Ungültig: {bad}")
                stored[key] = {**conf[key], **data[key]}
        self.db.set_setting("ai", stored)
        self._cache = None
        return self.conf()

    def mode(self, task: str | None) -> str:
        return self.conf()["tasks"].get(task or "", "auto")

    def configure(self, claude: Any, task: str) -> Any:
        conf = self.conf()
        return claude.for_task(task, effort=conf["effort"].get(task) or getattr(self.settings, "anthropic_effort", "medium"),
                               model=conf["model"], mask_pii=conf["mask_pii"], usage_hook=self.record)

    def record(self, task: str, model: str, usage: Any) -> None:
        get = lambda k: int(getattr(usage, k, 0) or 0)  # noqa: E731
        self.db.insert("ai_usage", {"task": task, "model": model, "input_tokens": get("input_tokens"),
                                    "output_tokens": get("output_tokens"), "cache_read": get("cache_read_input_tokens"),
                                    "cache_write": get("cache_creation_input_tokens"), "cost_usd": cost_usd(model, usage)})

    def month_cost(self, month: str | None = None) -> float:
        month = month or date.today().strftime("%Y-%m")
        return round(self.db.scalar("SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage WHERE substr(created_at, 1, 7) = ?",
                                    (month,)) or 0, 4)

    def budget_ok(self) -> bool:
        budget = float(self.conf()["budget_usd"] or 0)
        return budget <= 0 or self.month_cost() < budget

    def usage_summary(self) -> dict[str, Any]:
        month = date.today().strftime("%Y-%m")
        rows = self.db.query("SELECT task, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, "
                             "SUM(cache_read) AS cache_read, SUM(cost_usd) AS cost FROM ai_usage "
                             "WHERE substr(created_at, 1, 7) = ? GROUP BY task ORDER BY cost DESC", (month,))
        for r in rows:
            r["label"] = TASKS.get(r["task"], r["task"])
            r["cost"] = round(r["cost"] or 0, 4)
        budget = float(self.conf()["budget_usd"] or 0)
        cost = self.month_cost()
        return {"month": month, "cost_usd": cost, "budget_usd": budget, "budget_ok": self.budget_ok(),
                "budget_pct": round(100 * cost / budget, 1) if budget else None,
                "calls": sum(r["calls"] for r in rows), "by_task": rows,
                "last": self.db.query("SELECT task, model, input_tokens, output_tokens, cache_read, cost_usd, created_at "
                                      "FROM ai_usage ORDER BY id DESC LIMIT 15")}


RECEIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "lieferant": {"type": "string"},
        "rechnungsnummer": {"type": "string"},
        "datum": {"type": "string", "description": "Rechnungsdatum als JJJJ-MM-TT, leer wenn unbekannt"},
        "betrag_brutto": {"type": "number"},
        "ust_betrag": {"type": "number"},
        "waehrung": {"type": "string"},
        "kategorie": {"type": "string", "description": "z. B. Telekom, Software/Lizenzen, Hardware, Büro, KFZ, Miete, Sonstiges"},
        "iban": {"type": "string"},
    },
    "required": ["lieferant", "rechnungsnummer", "datum", "betrag_brutto", "ust_betrag", "waehrung", "kategorie", "iban"],
    "additionalProperties": False,
}
RECEIPT_PROMPT = ("Lies diese Eingangsrechnung (österreichischer IT-Betrieb ist der Empfänger) und gib die Felder zurück. "
                  "Betrag = Gesamtbetrag brutto. Fehlende Werte als leerer Text bzw. 0.")


def claude_receipt(ctx: Any, data: bytes, media_type: str = "application/pdf") -> dict[str, Any]:
    """Beleg-PDF (auch Scan) mit Claude auslesen → Felder für die Tabelle ``receipts``."""
    import re

    router = ctx.router
    if not router.claude_ok():
        raise ValueError("Claude ist nicht verfügbar (Cloud freigeben, ANTHROPIC_API_KEY setzen, Budget prüfen).")
    llm = router.claude_for("receipts")
    raw = llm.extract_document(data, media_type, RECEIPT_PROMPT, RECEIPT_SCHEMA)
    out = {"vendor": str(raw.get("lieferant") or "")[:200], "invoice_no": str(raw.get("rechnungsnummer") or "")[:100],
           "amount": round(float(raw.get("betrag_brutto") or 0), 2), "currency": (str(raw.get("waehrung") or "EUR")[:3] or "EUR").upper(),
           "category": str(raw.get("kategorie") or "")[:60]}
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(raw.get("datum") or "")):
        out["invoice_date"] = raw["datum"]
    return {k: v for k, v in out.items() if v not in ("", None)}


class AiConfIn(BaseModel):
    cloud_enabled: Optional[bool] = None
    mask_pii: Optional[bool] = None
    model: Optional[str] = None
    budget_usd: Optional[float] = Field(None, ge=0, le=100000)
    tasks: Optional[dict[str, str]] = None
    effort: Optional[dict[str, str]] = None


def register(app: FastAPI, ctx: Any, admin_only) -> AiControl:
    db: Database = ctx.db
    control = AiControl(db, ctx.settings)
    ctx.router.control = control

    @app.get("/api/ai/settings")
    def get_settings() -> dict:
        router = ctx.router
        return {**control.conf(), "task_labels": TASKS, "models": MODELS, "efforts": list(EFFORTS),
                "claude": {"available": router.claude.available(), "detail": router.claude.status().detail},
                "local": router.primary.status().__dict__, "usage": control.usage_summary()}

    @app.put("/api/ai/settings", dependencies=[Depends(admin_only)])
    def save_settings(data: AiConfIn) -> dict:
        try:
            control.save(data.model_dump(exclude_none=True))
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return get_settings()

    @app.post("/api/ai/test", dependencies=[Depends(admin_only)])
    def test() -> dict:
        router = ctx.router
        if not router.claude.available():
            raise HTTPException(409, router.claude.status().detail)
        started = time.time()
        try:
            text = control.configure(router.claude, "test").chat(
                [{"role": "user", "content": "Antworte nur mit: Verbindung OK"}], system="Kurz antworten.")
        except Exception as exc:  # noqa: BLE001 - Fehler im Test anzeigen
            raise HTTPException(502, str(exc))
        return {"ok": True, "answer": text[:200], "ms": int((time.time() - started) * 1000),
                "model": control.conf()["model"], "month_cost_usd": control.month_cost()}

    @app.post("/api/receipts/{rid}/claude", dependencies=[Depends(admin_only)])
    def receipt_with_claude(rid: int) -> dict:
        r = db.get("receipts", rid)
        if not r:
            raise HTTPException(404, "Beleg nicht gefunden")
        if not r.get("document_id"):
            raise HTTPException(422, "Zu diesem Beleg ist kein PDF abgelegt")
        doc = db.get("documents", r["document_id"])
        try:
            fields = claude_receipt(ctx, ctx.docs.local_file(doc).read_bytes())
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Claude konnte den Beleg nicht lesen: {exc}")
        db.update("receipts", rid, {**fields, "note": ((r["note"] or "") + " · mit Claude gelesen").strip(" ·")})
        return db.get("receipts", rid)

    return control
