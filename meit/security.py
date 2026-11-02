"""Security- & NIS2-Schnellcheck für Kunden.

15 Fragen, orientiert an den Risikomanagement-Maßnahmen aus NIS2 Art. 21 bzw. NISG 2026.
Ergebnis: Score 0–100, priorisierte Lücken, passende Leistungen – ideal als
Gesprächsgrundlage beim Kunden (und als Einstieg in ein Security-Paket).

Hinweis: Der Check ersetzt keine Rechtsberatung oder formale Gap-Analyse.
"""

from __future__ import annotations

from typing import Any

# id, Bereich, Frage, Gewicht (1–5), Leistungscode, Empfehlung
QUESTIONS: list[dict[str, Any]] = [
    {"id": "mfa", "area": "Zugang", "weight": 5, "service": "SEC",
     "question": "Ist Mehrfaktor-Authentifizierung (MFA) für alle Benutzer und Admins aktiv?",
     "fix": "MFA für alle Konten (M365, VPN, Fernwartung) erzwingen, Legacy-Anmeldung blockieren."},
    {"id": "backup", "area": "Backup", "weight": 5, "service": "BCK",
     "question": "Gibt es ein tägliches Backup mit mindestens einer unveränderbaren/Offline-Kopie?",
     "fix": "3-2-1-1-0-Backup mit unveränderbarer Offsite-Kopie einführen."},
    {"id": "restore", "area": "Backup", "weight": 4, "service": "BCK",
     "question": "Wird die Wiederherstellung regelmäßig (mind. vierteljährlich) getestet und dokumentiert?",
     "fix": "Vierteljährliche Restore-Tests mit Protokoll (RTO/RPO) etablieren."},
    {"id": "patch", "area": "Betrieb", "weight": 5, "service": "MON",
     "question": "Werden Betriebssysteme und Software automatisch und zeitnah gepatcht?",
     "fix": "Zentrales Patch-Management mit Monitoring und Reporting."},
    {"id": "eol", "area": "Betrieb", "weight": 4, "service": "WIN11",
     "question": "Sind alle Systeme noch im Herstellersupport (kein Windows 10 ohne ESU, kein Server 2012)?",
     "fix": "Veraltete Systeme ablösen oder isolieren; Lifecycle-Plan erstellen."},
    {"id": "edr", "area": "Schutz", "weight": 4, "service": "SEC",
     "question": "Ist auf allen Endgeräten und Servern ein EDR/MDR mit Überwachung im Einsatz?",
     "fix": "EDR/MDR mit 24/7-Alarmierung auf allen Geräten ausrollen."},
    {"id": "firewall", "area": "Netzwerk", "weight": 3, "service": "MFW",
     "question": "Gibt es eine aktuelle, verwaltete Firewall und ein getrenntes Gäste-/IoT-Netz?",
     "fix": "Managed Firewall, Netzsegmentierung (VLANs) für Gäste, IoT und Produktion."},
    {"id": "admin", "area": "Zugang", "weight": 4, "service": "MW",
     "question": "Arbeiten Benutzer ohne lokale Administratorrechte; sind Admin-Konten getrennt?",
     "fix": "Lokale Adminrechte entziehen, getrennte Admin-Konten, LAPS einsetzen."},
    {"id": "awareness", "area": "Mensch", "weight": 3, "service": "AWR",
     "question": "Erhalten Mitarbeiter regelmäßig Security-Awareness-Schulungen / Phishing-Tests?",
     "fix": "Laufendes Awareness-Programm mit Phishing-Simulation."},
    {"id": "incident", "area": "Organisation", "weight": 4, "service": "VCISO",
     "question": "Gibt es einen Notfallplan (Incident Response) inkl. Meldewegen und Kontaktliste?",
     "fix": "Notfallhandbuch erstellen; NIS2-Meldefristen (24 h / 72 h / 1 Monat) abbilden."},
    {"id": "inventory", "area": "Organisation", "weight": 3, "service": "MON",
     "question": "Existiert ein aktuelles Inventar aller Geräte, Software und Cloud-Dienste?",
     "fix": "Automatische Inventarisierung über RMM; Software- und Lizenzverzeichnis."},
    {"id": "mail", "area": "Schutz", "weight": 3, "service": "SEC",
     "question": "Sind SPF, DKIM und DMARC für die E-Mail-Domain korrekt konfiguriert?",
     "fix": "SPF/DKIM/DMARC einrichten, DMARC schrittweise auf 'reject' stellen."},
    {"id": "encryption", "area": "Schutz", "weight": 3, "service": "MW",
     "question": "Sind Notebooks und mobile Datenträger verschlüsselt (z. B. BitLocker)?",
     "fix": "BitLocker/FileVault zentral erzwingen, Wiederherstellungsschlüssel sichern."},
    {"id": "supplier", "area": "Organisation", "weight": 2, "service": "VCISO",
     "question": "Werden Sicherheitsanforderungen an Lieferanten/Dienstleister vertraglich geregelt?",
     "fix": "Lieferantenbewertung und Sicherheitsklauseln in Verträgen (NIS2-Lieferkette)."},
    {"id": "policy", "area": "Organisation", "weight": 3, "service": "VCISO",
     "question": "Gibt es eine von der Geschäftsführung freigegebene IT-Sicherheitsrichtlinie (inkl. KI-Nutzung)?",
     "fix": "Sicherheits- und KI-Richtlinie erstellen; Geschäftsführung schulen (Haftung!)."},
]

ANSWER_FACTOR = {"ja": 1.0, "teilweise": 0.5, "nein": 0.0, "unbekannt": 0.0}


def evaluate(answers: dict[str, str], employees: int = 0, industry: str = "") -> dict[str, Any]:
    total_weight = sum(q["weight"] for q in QUESTIONS)
    achieved = 0.0
    gaps = []
    for q in QUESTIONS:
        answer = (answers.get(q["id"]) or "unbekannt").strip().lower()
        factor = ANSWER_FACTOR.get(answer, 0.0)
        achieved += q["weight"] * factor
        if factor < 1.0:
            gaps.append({
                "id": q["id"], "area": q["area"], "question": q["question"], "answer": answer,
                "weight": q["weight"], "fix": q["fix"], "service": q["service"],
                "urgency": "hoch" if q["weight"] >= 4 and factor == 0 else ("mittel" if q["weight"] >= 3 else "niedrig"),
            })
    score = round(100 * achieved / total_weight, 1)
    level = "gut" if score >= 80 else ("mittel" if score >= 50 else "kritisch")
    gaps.sort(key=lambda g: (g["weight"] * (1 - ANSWER_FACTOR.get(g["answer"], 0))), reverse=True)

    if employees >= 50:
        nis2 = ("Mit {} Mitarbeitern ist eine NIS2-Betroffenheit (NISG 2026) wahrscheinlich, wenn das Unternehmen "
                "in einem der 18 Sektoren tätig ist. Selbsteinstufung und ggf. Registrierung prüfen; "
                "die Geschäftsführung haftet für die Umsetzung.").format(employees)
    elif employees >= 20:
        nis2 = ("Direkte NIS2-Pflicht eher unwahrscheinlich (< 50 MA), aber als Zulieferer von NIS2-Unternehmen "
                "werden Sicherheitsnachweise zunehmend vertraglich gefordert.")
    else:
        nis2 = "Keine direkte NIS2-Pflicht zu erwarten – die Maßnahmen sind trotzdem Stand der Technik (Versicherung, DSGVO)."

    services = sorted({g["service"] for g in gaps if g["urgency"] in ("hoch", "mittel")})
    return {"score": score, "level": level, "gaps": gaps, "nis2": nis2, "recommended_services": services}


def report_markdown(customer_name: str, result: dict[str, Any], summary: str = "") -> str:
    lines = [
        f"# Security- & NIS2-Check: {customer_name}",
        "",
        f"**Ergebnis: {result['score']:.0f}/100 – {result['level'].upper()}**",
        "",
    ]
    if summary:
        lines += ["## Zusammenfassung", summary.strip(), ""]
    lines += ["## NIS2-Einschätzung", result["nis2"], "", "## Handlungsbedarf (priorisiert)"]
    if not result["gaps"]:
        lines.append("Keine Lücken festgestellt – regelmäßig wiederholen.")
    for i, gap in enumerate(result["gaps"], 1):
        lines.append(f"{i}. **[{gap['urgency']}] {gap['area']}:** {gap['fix']}")
    lines += ["", "_Hinweis: Schnellcheck auf Basis der Kundenangaben, ersetzt keine formale Gap-Analyse._"]
    return "\n".join(lines)
