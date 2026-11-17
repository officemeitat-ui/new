# Wartungsplan – vorbeugende Prüfungen mit Nachweis

**Problem:** Bei Managed-Services sieht der Kunde nur „es läuft“. Genau dann fragt er sich bei der
Vertragsverlängerung, wofür er monatlich zahlt. Gleichzeitig verlangen NIS2/NISG 2026, Versicherer und
Wirtschaftsprüfer zunehmend **Nachweise**, dass Backups getestet und Systeme gepflegt werden.

**Lösung:** Wiederkehrende Prüfungen je Kunde, die automatisch zu Tickets werden – und deren Ergebnis
im Monatsbericht, im QBR und im Kundenportal erscheint.

## Ablauf

```
Standard-Plan (passend zu gebuchten Leistungen)          z. B. Backup-Restore-Test · monatlich
        │
        ▼  3 Tage vor Fälligkeit (stündlich geprüft)
Ticket „Wartung: …“ mit Checkliste ──► Techniker (Zuständig bzw. automatische Zuweisung)
        │
        ▼
Abschließen: Checkliste · Ergebnis (in Ordnung / Hinweis / Problem) · Notiz · Zeit
        │            └─ Problem → Folgeticket mit Priorität „hoch“
        ▼
Nachweis ──► Monatsbericht „Wartung & Prüfungen“ · QBR „Vorbeugende Wartung“
         ──► Kundenportal „Wartung“ (Plan + Nachweise, ohne interne Notizen)
         ──► Wartungsprotokoll-PDF im ME-IT-Design (Kundenordner / SharePoint)
         ──► Health Score: +5 „Wartungsplan eingehalten“ bzw. Abzug bei Überfälligkeit
```

## Vorlagen

| Prüfung | Rhythmus | vorgeschlagen bei |
|---|---|---|
| Backup-Kontrolle & Restore-Test | monatlich | Backup & Recovery, M365-Backup |
| Patch- & Update-Status | monatlich | Managed Workplace/Server, Monitoring, jedem Betreuungsvertrag |
| Security-Status (EDR, MFA, Admin-Konten) | monatlich | Security-Paket, vCISO, jedem Betreuungsvertrag |
| Server & Speicher | monatlich | Managed Server (mit Server im Bestand) |
| Firewall: Firmware, Regeln, VPN | vierteljährlich | Managed Firewall |
| Benutzer, Berechtigungen & Lizenzen | vierteljährlich | jedem Betreuungsvertrag, M365-Einführung |
| Phishing-Simulation & Schulungsstand | vierteljährlich | Security-Awareness |
| KI-Box: Updates & Modelle | monatlich | KI-Box / KI-Mitarbeiter-Betrieb |
| USV-Test | halbjährlich | Server im Bestand |
| Notfallplan & IT-Dokumentation | jährlich | jedem Betreuungsvertrag, NIS2 |

Alle Prüfungen sind frei anpassbar (Titel, Checkliste, Rhythmus, Fälligkeit, Zuständigkeit) – eigene
Prüfungen über „+ Prüfung“. Fälligkeiten werden über den Monat verteilt, damit nicht alles am Ersten anfällt.

## Regeln

- Geplante Wartung zählt **nicht** in die SLA (sie ist keine Störung).
- Zeit wird beim Abschluss automatisch gebucht – bei Managed-Kunden als Flatrate (nicht verrechenbar),
  sonst verrechenbar. So siehst du auch, was die Betreuung wirklich kostet.
- Übersprungen (z. B. Betriebsurlaub) wird mit Begründung dokumentiert, der nächste Termin wird geplant.
- Im Portal sieht der Kunde Ergebnis und Checkliste (x/y Punkte), aber keine internen Notizen.

## Verkaufsargument

„Wir prüfen jeden Monat, ob Ihre Datensicherung wirklich wiederherstellbar ist – hier ist das Protokoll.“
Das ist der Unterschied zwischen *IT-Betreuung* und *Nachweis der Sorgfaltspflicht* (Geschäftsführerhaftung
unter NIS2) – und ein starkes Argument für den Wechsel von „auf Zuruf“ zu einem Managed-Vertrag.
