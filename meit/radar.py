"""Umsatz-Radar: findet automatisch Verkaufschancen in Kunden- und Gerätedaten.

Bewusst regelbasiert (nachvollziehbar, ohne KI lauffähig). Jede Chance enthält
Begründung, passende Leistung aus dem Katalog und den geschätzten Wert.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from .db import Database, loads
from .knowledge import normalize

# (Suchmuster im Betriebssystem, Support-Ende, Anzeigename) – Herstellerangaben Microsoft.
EOL_TABLE = [
    ("windows server 2008", date(2020, 1, 14), "Windows Server 2008"),
    ("windows server 2012", date(2023, 10, 10), "Windows Server 2012/R2"),
    ("windows server 2016", date(2027, 1, 12), "Windows Server 2016"),
    ("windows server 2019", date(2029, 1, 9), "Windows Server 2019"),
    ("windows 7", date(2020, 1, 14), "Windows 7"),
    ("windows 8", date(2023, 1, 10), "Windows 8.1"),
    ("windows 10", date(2025, 10, 14), "Windows 10"),
    ("exchange 2016", date(2025, 10, 14), "Exchange Server 2016"),
    ("exchange 2019", date(2025, 10, 14), "Exchange Server 2019"),
    ("office 2016", date(2025, 10, 14), "Office 2016"),
    ("office 2019", date(2025, 10, 14), "Office 2019"),
]

SENSITIVE_INDUSTRIES = ("steuer", "gesundheit", "arzt", "ordination", "recht", "anwalt", "notar", "kanzlei", "versicherung", "bank")
# Sektoren aus NIS2-Anhang I/II (Auszug) – Betroffenheit ab 50 MA bzw. 10 Mio. € Umsatz.
NIS2_SECTORS = (
    "energie", "verkehr", "transport", "logistik", "bank", "finanz", "gesundheit", "krankenhaus", "labor",
    "wasser", "abwasser", "digital", "rechenzentrum", "cloud", "it-dienst", "verwaltung", "raumfahrt",
    "post", "kurier", "abfall", "chemie", "lebensmittel", "maschinenbau", "elektro", "fahrzeug",
    "medizinprodukt", "forschung",
)
CLIENT_TYPES = {"pc", "notebook", "laptop", "workstation", "client"}
NETWORK_TYPES = {"accesspoint", "switch", "firewall", "router"}

FALLBACK_PRICES = {"MW": 39, "SEC": 12, "BCK": 89, "AWR": 4, "NIS2GAP": 1900, "VCISO": 490, "WIN11": 180,
                   "NEWPC": 150, "SRVMOD": 3500, "NET": 2400, "KIWS": 1200, "KIBOX": 4900, "KIBOXM": 149,
                   "M365MIG": 95, "KIMA": 3900, "KIMAM": 249}
CONTACT_HEAVY = ("tourismus", "hotel", "handwerk", "steuer", "gesundheit", "ordination", "kanzlei", "handel",
                 "immobilien", "logistik", "spedition", "versicherung", "dienstleistung")


def eol_info(os_name: str) -> tuple[date, str] | None:
    text = normalize(os_name)
    for pattern, eol, label in EOL_TABLE:
        if pattern in text:
            return eol, label
    return None


def _parse(d: str | None) -> date | None:
    if not d:
        return None
    try:
        return datetime.fromisoformat(d[:10]).date()
    except ValueError:
        return None


class Radar:
    def __init__(self, db: Database):
        self.db = db

    def _prices(self) -> dict[str, dict[str, Any]]:
        rows = self.db.query("SELECT code, name, price, unit, recurring FROM services WHERE active = 1")
        return {r["code"]: r for r in rows}

    def scan(self, customer_id: int | None = None, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        services = self._prices()

        def price(code: str) -> float:
            return float(services.get(code, {}).get("price", FALLBACK_PRICES.get(code, 0)))

        def name(code: str) -> str:
            return services.get(code, {}).get("name", code)

        where, params = ("WHERE id = ?", (customer_id,)) if customer_id else ("", ())
        customers = self.db.query(f"SELECT * FROM customers {where}", params)
        opportunities: list[dict[str, Any]] = []

        def add(c: dict, kind: str, title: str, reason: str, code: str, once: float = 0.0,
                monthly: float = 0.0, priority: int = 2) -> None:
            opportunities.append({
                "customer_id": c["id"], "customer": c["name"], "kind": kind, "title": title,
                "reason": reason, "service_code": code, "service": name(code),
                "once": round(once, 2), "monthly": round(monthly, 2),
                "annual_value": round(once + 12 * monthly, 2), "priority": priority,
            })

        for c in customers:
            booked = set(loads(c.get("booked_services"), []))
            employees = int(c.get("employees") or 0)
            industry = normalize(c.get("industry", "") + " " + c.get("notes", ""))
            assets = self.db.query("SELECT * FROM assets WHERE customer_id = ?", (c["id"],))
            assessment = self.db.query_one(
                "SELECT score, created_at FROM assessments WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
                (c["id"],),
            )
            sec_score = assessment["score"] if assessment else None

            # --- Geräte: Support-Ende, Garantie, Alter ---------------------------
            eol_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
            soon_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
            old_clients: list[str] = []
            old_network: list[str] = []
            for a in assets:
                typ = (a.get("type") or "").lower()
                info = eol_info(a.get("os", ""))
                bought = _parse(a.get("purchase_date"))
                age_years = (today - bought).days / 365 if bought else 0
                warranty = _parse(a.get("warranty_end"))
                if info:
                    eol, label = info
                    group = (label, "server" if typ == "server" else "client")
                    if eol <= today:
                        eol_groups[group].append(a["name"])
                        continue
                    if eol <= today + timedelta(days=548):
                        soon_groups[group].append(a["name"])
                        continue
                warranty_out = warranty is not None and warranty <= today + timedelta(days=90)
                if typ in CLIENT_TYPES and age_years >= 5 and warranty_out:
                    old_clients.append(a["name"])
                elif typ in NETWORK_TYPES and age_years >= 6:
                    old_network.append(a["name"])

            for (label, typ), names in eol_groups.items():
                if typ == "server" or "server" in label.lower() or "exchange" in label.lower():
                    add(c, "lifecycle", f"{label} ablösen ({len(names)}×)",
                        f"{label} erhält keine Sicherheitsupdates mehr: {', '.join(names)}. Hohes Risiko, Versicherung/NIS2 kritisch.",
                        "SRVMOD", once=price("SRVMOD"), priority=3)
                else:
                    add(c, "lifecycle", f"{label}-Migration ({len(names)} {'Gerät' if len(names) == 1 else 'Geräte'})",
                        f"{label} ohne regulären Support seit Okt. 2025 (ESU nur gegen Aufpreis): {', '.join(names)}.",
                        "WIN11", once=price("WIN11") * len(names), priority=3)
            for (label, typ), names in soon_groups.items():
                eol_date = next(e for p_, e, l_ in EOL_TABLE if l_ == label)
                urgent = eol_date <= today + timedelta(days=120)
                add(c, "lifecycle", f"{label}-Ablöse planen ({len(names)}×)",
                    f"Support-Ende am {eol_date.strftime('%d.%m.%Y')}: {', '.join(names)}. "
                    + ("Jetzt umsetzen – die Zeit wird knapp." if urgent else "Jetzt budgetieren."),
                    "SRVMOD" if typ == "server" or "server" in label.lower() else "WIN11",
                    once=price("SRVMOD") if typ == "server" else price("WIN11") * len(names),
                    priority=3 if urgent else 2)
            if old_clients:
                add(c, "lifecycle", f"Hardware-Erneuerung ({len(old_clients)} Geräte)",
                    f"Geräte ≥ 5 Jahre alt und ohne Garantie: {', '.join(old_clients)}.",
                    "NEWPC", once=price("NEWPC") * len(old_clients), priority=2)
            if old_network:
                add(c, "lifecycle", "Netzwerk/WLAN modernisieren",
                    f"Netzwerkkomponenten ≥ 6 Jahre alt: {', '.join(old_network)}.",
                    "NET", once=price("NET"), priority=2)

            # --- Verträge & Pakete ------------------------------------------------
            if c.get("package", "keins") == "keins" and employees >= 5:
                add(c, "managed", "Auf Managed-Services-Vertrag umstellen",
                    f"Bisher Abrechnung auf Zuruf. {employees} Benutzer × Flatrate = planbarer Umsatz für beide Seiten.",
                    "MW", monthly=price("MW") * employees, priority=3)
            contract_end = _parse(c.get("contract_end"))
            if contract_end and today <= contract_end <= today + timedelta(days=60):
                add(c, "vertrag", "Vertragsverlängerung + Paket-Upgrade",
                    f"Vertrag endet am {contract_end.strftime('%d.%m.%Y')}. Jahresgespräch mit Bericht und Upgrade-Angebot.",
                    "MW", monthly=0.0, priority=3)

            # --- Sicherheit -----------------------------------------------------------
            if employees > 0 and "SEC" not in booked:
                prio = 3 if (sec_score is not None and sec_score < 60) else 2
                add(c, "security", "Security-Paket (EDR/MDR)",
                    "Kein EDR/MDR gebucht." + (f" Security-Score nur {sec_score:.0f}/100." if sec_score is not None else ""),
                    "SEC", monthly=price("SEC") * employees, priority=prio)
            if employees > 0 and "BCK" not in booked:
                add(c, "security", "Backup & Recovery einführen",
                    "Kein verwaltetes, unveränderbares Backup gebucht – größtes Ransomware-Risiko.",
                    "BCK", monthly=price("BCK"), priority=3)
            if employees >= 10 and "AWR" not in booked:
                add(c, "security", "Security-Awareness-Training",
                    "Die meisten Angriffe starten mit Phishing. Laufendes Training senkt das Risiko deutlich.",
                    "AWR", monthly=price("AWR") * employees, priority=1)

            # --- NIS2 / NISG 2026 -------------------------------------------------
            nis2_sector = any(s in industry for s in NIS2_SECTORS)
            checked_on = _parse(assessment["created_at"]) if assessment else None
            recent_check = bool(checked_on and checked_on >= today - timedelta(days=365) and (sec_score or 0) >= 80)
            if employees >= 50 and "VCISO" not in booked and not recent_check:
                add(c, "compliance", "NIS2/NISG-2026: Betroffenheit & Gap-Analyse",
                    f"{employees} Mitarbeiter" + (" in einem NIS2-Sektor" if nis2_sector else "") +
                    " – mögliche Registrierungs- und Nachweispflicht (NISG 2026 seit 1.10.2026). Geschäftsführung haftet persönlich.",
                    "NIS2GAP", once=price("NIS2GAP"), monthly=price("VCISO"), priority=3)
            elif 20 <= employees < 50 and "VCISO" not in booked:
                add(c, "compliance", "NIS2-Lieferketten-Check",
                    "Kunden/Auftraggeber, die NIS2-pflichtig sind, verlangen zunehmend Sicherheitsnachweise von Zulieferern.",
                    "NIS2GAP", once=price("NIS2GAP"), priority=1)

            # --- KI ---------------------------------------------------------------------
            sensitive = any(s in industry for s in SENSITIVE_INDUSTRIES)
            if employees >= 5 and "KIWS" not in booked:
                add(c, "ki", "KI-Workshop & AI-Act-Kompetenzschulung",
                    "Seit Feb. 2025 müssen Unternehmen, die KI einsetzen, für KI-Kompetenz ihrer Mitarbeiter sorgen (Art. 4 AI Act).",
                    "KIWS", once=price("KIWS"), priority=1 if not sensitive else 2)
            if (sensitive or re.search(r"\bki\b", industry)) and "KIBOX" not in booked:
                add(c, "ki", "Private KI-Box (lokal, DSGVO-konform)",
                    "Sensible Daten – KI-Nutzung nur ohne Cloud sinnvoll. Lokaler KI-Server mit Dokumentensuche.",
                    "KIBOX", once=price("KIBOX"), monthly=price("KIBOXM"), priority=2)

            if employees >= 5 and "KIMA" not in booked:
                contact_heavy = any(w in industry for w in CONTACT_HEAVY)
                add(c, "ki", "KI-Mitarbeiter für Routinearbeit",
                    "Posteingang sortieren, Anfragen ins CRM, Antwortentwürfe, Belege für den Steuerberater, "
                    "Angebote nachfassen – rund um die Uhr, lokal betrieben."
                    + (" Viel Kundenkontakt in der Branche – hoher Nutzen." if contact_heavy else ""),
                    "KIMA", once=price("KIMA"), monthly=price("KIMAM"), priority=2 if contact_heavy else 1)

            # --- Ticket-Muster -----------------------------------------------------------
            since = (today - timedelta(days=180)).isoformat()
            cats = Counter(r["category"] for r in self.db.query(
                "SELECT category FROM tickets WHERE customer_id = ? AND created_at >= ? AND category != ''",
                (c["id"], since)))
            pattern_map = {"Netzwerk": "NET", "Hardware": "NEWPC", "Sicherheit": "AWR", "E-Mail/M365": "M365MIG"}
            for cat, count in cats.items():
                if count >= 3 and cat in pattern_map:
                    code = pattern_map[cat]
                    add(c, "projekt", f"Wiederkehrende {cat}-Probleme lösen",
                        f"{count} Tickets der Kategorie {cat} in 6 Monaten – Ursache beheben statt Symptome.",
                        code, once=price(code) * (1 if code in ("NET",) else max(1, min(employees, 10))), priority=2)

        opportunities.sort(key=lambda o: (o["priority"], o["annual_value"]), reverse=True)
        return {
            "generated_at": today.isoformat(),
            "count": len(opportunities),
            "total_once": round(sum(o["once"] for o in opportunities), 2),
            "total_monthly": round(sum(o["monthly"] for o in opportunities), 2),
            "total_annual": round(sum(o["annual_value"] for o in opportunities), 2),
            "opportunities": opportunities,
        }
