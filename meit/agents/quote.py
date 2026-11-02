"""Angebots-Agent: aus einer Bedarfsbeschreibung ein fertiges Angebot erstellen.

Die KI wählt Leistungen aus dem Katalog und schreibt den Text – **gerechnet wird
immer im Code** (Sprachmodelle verrechnen sich gern). Ohne KI wird per
Stichwortabgleich ein Angebotsentwurf erzeugt.
"""

from __future__ import annotations

import json
import time
from typing import Any

from ..db import loads
from ..knowledge import keyword_scores, normalize
from ..llm import LLMError
from .base import AgentContext


def eur(value: float) -> str:
    """Österreichisches Format: € 1.234,50"""
    return "€ " + f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _default_quantity(service: dict[str, Any], customer: dict[str, Any], devices: int, servers: int) -> float:
    unit = normalize(service["unit"])
    employees = max(int(customer.get("employees") or 1), 1)
    if unit.startswith("user"):
        return employees
    if unit.startswith("geraet"):
        return max(devices, 1)
    if unit.startswith("server"):
        return max(servers, 1)
    if unit.startswith("stunde"):
        return 4
    return 1


def build_items(selection: list[dict[str, Any]], services: dict[str, dict[str, Any]],
                customer: dict[str, Any], devices: int, servers: int) -> list[dict[str, Any]]:
    items = []
    seen = set()
    for entry in selection:
        code = str(entry.get("code") or entry.get("service") or "").upper()
        if code not in services or code in seen:
            continue
        seen.add(code)
        svc = services[code]
        try:
            qty = float(entry.get("menge") or entry.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            qty = _default_quantity(svc, customer, devices, servers)
        qty = min(qty, 10000)
        items.append({
            "code": code, "name": svc["name"], "description": svc["description"], "unit": svc["unit"],
            "quantity": qty, "price": svc["price"], "recurring": bool(svc["recurring"]),
            "total": round(qty * svc["price"], 2), "reason": str(entry.get("begruendung") or entry.get("reason") or ""),
        })
    return items


def create_quote(ctx: AgentContext, customer_id: int, need: str,
                 service_codes: list[str] | None = None) -> dict[str, Any]:
    started = time.time()
    customer = ctx.db.get("customers", customer_id)
    if not customer:
        raise ValueError("Kunde nicht gefunden")
    services = {s["code"]: s for s in ctx.db.query("SELECT * FROM services WHERE active = 1")}
    devices = ctx.db.scalar("SELECT COUNT(*) FROM assets WHERE customer_id = ? AND type IN ('pc','notebook')",
                            (customer_id,)) or 0
    servers = ctx.db.scalar("SELECT COUNT(*) FROM assets WHERE customer_id = ? AND type = 'server'",
                            (customer_id,)) or 0
    booked = loads(customer.get("booked_services"), [])

    preselected = [c.upper() for c in (service_codes or []) if c.upper() in services]
    title = ""
    intro = ""
    notes = ""
    selection: list[dict[str, Any]] = []
    provider = "regeln"
    error = ""

    llm = ctx.llm()
    if llm.available():
        catalog = [{"code": s["code"], "name": s["name"], "einheit": s["unit"], "preis": s["price"],
                    "beschreibung": s["description"]} for s in services.values()]
        prompt = (
            f"Kunde: {customer['name']} ({customer['industry']}, {customer['employees']} Mitarbeiter, "
            f"{devices} PCs/Notebooks, {servers} Server). Bereits gebucht: {booked}.\n"
            f"Bedarf laut Gespräch: {need}\n"
            + (f"Vorausgewählte Leistungen (unbedingt berücksichtigen): {preselected}\n" if preselected else "")
            + "\n"
            f"Leistungskatalog:\n{json.dumps(catalog, ensure_ascii=False)}\n\n"
            "Stelle ein passendes Angebot zusammen. Nur Codes aus dem Katalog, nichts doppelt anbieten, "
            "was bereits gebucht ist. Antworte nur mit JSON:\n"
            '{"titel": "...", "einleitung": "2-4 Sätze, Nutzen für den Kunden, Sie-Form", '
            '"positionen": [{"code": "MW", "menge": 12, "begruendung": "..."}], '
            '"hinweise": "Annahmen, Voraussetzungen"}'
        )
        try:
            data = llm.chat_json(
                [{"role": "user", "content": prompt}],
                system=f"Du bist Vertriebsprofi bei {ctx.company} (IT-Dienstleister, Österreich). Ehrlich, kein Upselling ohne Nutzen.",
            )
            selection = data.get("positionen") or []
            title = str(data.get("titel") or "")
            intro = str(data.get("einleitung") or "")
            notes = str(data.get("hinweise") or "")
            provider = f"{llm.provider}:{llm.model}"
        except (LLMError, AttributeError, TypeError) as exc:
            error = f"KI nicht nutzbar, Stichwort-Angebot erstellt: {exc}"
            selection = []

    if not selection and preselected:
        selection = [{"code": c} for c in preselected]
    if not selection:
        svc_list = list(services.values())
        scores = keyword_scores(need, [f"{s['name']} {s['keywords']} {s['description']}" for s in svc_list])
        ranked = sorted(zip(scores, svc_list), key=lambda x: x[0], reverse=True)
        best = ranked[0][0] if ranked else 0
        selection = [{"code": s["code"]} for score, s in ranked if score > 0 and score >= best * 0.35
                     and s["code"] not in booked and s["code"] != "STD"][:5]
        if not selection:
            selection = [{"code": "STD", "menge": 4}]

    items = build_items(selection, services, customer, devices, servers)
    total_once = round(sum(i["total"] for i in items if not i["recurring"]), 2)
    total_monthly = round(sum(i["total"] for i in items if i["recurring"]), 2)
    if not title:
        title = "Angebot: " + ", ".join(i["name"] for i in items[:3])
    if not intro:
        intro = ("vielen Dank für Ihr Interesse. Auf Basis unseres Gesprächs unterbreiten wir Ihnen gerne "
                 "folgendes Angebot. Ziel ist eine sichere, planbare IT – ohne Überraschungen bei den Kosten.")

    lines = [f"# {title}", "", f"**Kunde:** {customer['name']}  ", f"**Ansprechpartner:** {customer['contact_name']}", "",
             f"Guten Tag {customer['contact_name']}," if customer.get("contact_name") else "Guten Tag,", "", intro, "",
             "| Pos. | Leistung | Menge | Einheit | Einzelpreis | Gesamt |", "|---|---|---|---|---|---|"]
    for n, item in enumerate(items, 1):
        lines.append(f"| {n} | {item['name']} | {item['quantity']:g} | {item['unit']} | "
                     f"{eur(item['price'])} | {eur(item['total'])} |")
    lines += ["", f"**Einmalig: {eur(total_once)} netto**  ", f"**Monatlich: {eur(total_monthly)} netto**", "",
              "**Leistungsbeschreibung:**"]
    lines += [f"- **{i['name']}:** {i['description']}" + (f" – {i['reason']}" if i["reason"] else "") for i in items]
    lines.append("")
    if notes:
        lines += ["**Hinweise:** " + notes, ""]
    lines += ["Alle Preise in EUR zzgl. 20 % USt. Angebot gültig 30 Tage.", "",
              f"Freundliche Grüße  \nIhr {ctx.company}-Team"]
    text = "\n".join(lines)

    quote_id = ctx.db.insert("quotes", {
        "customer_id": customer_id, "title": title, "need": need, "items": items,
        "total_once": total_once, "total_monthly": total_monthly, "text": text, "status": "entwurf",
    })
    result = {"id": quote_id, "title": title, "items": items, "total_once": total_once,
              "total_monthly": total_monthly, "text": text, "provider": provider}
    if error:
        result["error"] = error
    ctx.log("angebot", provider, need, result, not error, started)
    return result
