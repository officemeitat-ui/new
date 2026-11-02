"""KI-Agenten von ME-IT."""

from __future__ import annotations

import time
from typing import Any

from ..llm import LLMError
from ..security import evaluate, report_markdown
from .assistant import run_assistant
from .base import AgentContext
from .quote import create_quote
from .report import monthly_report
from .triage import rule_triage, triage_ticket

__all__ = [
    "AgentContext", "create_quote", "monthly_report", "rule_triage", "run_assistant", "run_security_check",
    "triage_ticket",
]


def run_security_check(ctx: AgentContext, customer_id: int, answers: dict[str, str]) -> dict[str, Any]:
    """Bewertet den Fragebogen (deterministisch) und lässt die KI eine Management-Zusammenfassung schreiben."""
    started = time.time()
    customer = ctx.db.get("customers", customer_id)
    if not customer:
        raise ValueError("Kunde nicht gefunden")
    result = evaluate(answers, int(customer.get("employees") or 0), customer.get("industry", ""))
    summary = ""
    provider = "regeln"
    llm = ctx.llm()
    if llm.available():
        top = "; ".join(g["fix"] for g in result["gaps"][:5])
        try:
            summary = llm.chat(
                [{"role": "user", "content":
                  f"Kunde {customer['name']} ({customer['industry']}, {customer['employees']} MA) hat im "
                  f"Security-Check {result['score']:.0f}/100 Punkten erreicht. Wichtigste Lücken: {top}. "
                  "Schreibe eine verständliche Zusammenfassung für die Geschäftsführung (max. 100 Wörter, Sie-Form): "
                  "Risiko in Alltagssprache, was zuerst zu tun ist. Keine Panikmache, keine Überschrift."}],
                system=f"Du bist Informationssicherheits-Berater bei {ctx.company} in Österreich.",
                temperature=0.3,
            )
            provider = f"{llm.provider}:{llm.model}"
        except LLMError:
            summary = ""
    report = report_markdown(customer["name"], result, summary)
    assessment_id = ctx.db.insert("assessments", {
        "customer_id": customer_id, "answers": answers, "score": result["score"],
        "level": result["level"], "report": report,
    })
    ctx.log("security", provider, {"customer_id": customer_id}, {"score": result["score"]}, True, started)
    return {**result, "id": assessment_id, "report": report, "provider": provider}
