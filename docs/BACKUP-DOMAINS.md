# Backup-Wächter · Domain- & E-Mail-Sicherheitscheck

## Backup-Wächter

Sicherungsberichte landen ohnehin täglich im Postfach – meist ungelesen. Das Cockpit wertet sie aus:

1. Berichte aller Kunden an das Cockpit-Postfach senden oder per Regel weiterleiten (bzw. `.eml`/`.msg` in den
   Posteingang ziehen). Erkannt werden **Veeam** (B&R, Agent, Microsoft 365: Betreff `[Success]`/`[Warning]`/`[Failed]`),
   **Synology** Hyper Backup/Active Backup (deutsch und englisch), **Acronis**, **Datto**, Windows Server-Sicherung und
   allgemeine Berichte mit „erfolgreich/fehlgeschlagen/Warnung“. Werbung („Webinar“, „Lizenz läuft ab“) wird ignoriert.
2. Jeder Bericht wird einem **Sicherungsjob** zugeordnet – Kunde über die Absender-Domain oder den Gerätenamen
   (Geräteliste). Unbekannte Jobs erscheinen als „zuordnen“.
3. Berichte erzeugen **keine** Tickets mehr im Posteingang. Stattdessen:
   - **Fehler** → ein Ticket „Backup fehlgeschlagen: …“ (Priorität hoch, Kategorie Backup); weitere Fehlberichte
     werden als interne Notiz angehängt.
   - **Folgesicherung erfolgreich** → Ticket wird mit Vermerk geschlossen (abschaltbar).
   - **Bericht bleibt aus** (täglich/2 Tage/wöchentlich/monatlich + 6 h Toleranz) → Ticket „Backup-Bericht fehlt“ –
     der häufigste unbemerkte Fall (NAS aus, Mailversand defekt, Job deaktiviert).
   - Warnungen färben die Ampel gelb; auf Wunsch auch mit Ticket.
4. **Ampel der letzten 14 Tage** je Job (Datensicherung, Kundenseite, Kundenportal), gestreift = erwarteter Bericht fehlt.
5. Monatsbericht und QBR: „Datensicherung: 30 von 31 Sicherungen erfolgreich (97 %)“. Managed-Kunden ohne überwachte
   Sicherung werden gelistet.

„Bericht testen“ zeigt für einen beliebigen Betreff, wie er eingeordnet würde.

## Domain- & E-Mail-Sicherheitscheck

Frage: *Kann man im Namen des Kunden Mails fälschen?* Gefälschte Rechnungen mit der Absenderdomain des Kunden sind einer
der teuersten Betrugsfälle – und ohne DMARC leicht.

Domains kommen automatisch aus Kunden-Mailadressen, verbundenen Microsoft-365-Tenants und „Lizenzen & Verträge“
(„Domains finden“) oder werden manuell ergänzt. Geprüft werden nur **öffentliche DNS-Einträge** und das
Website-Zertifikat, wöchentlich automatisch:

| Prüfung | Befund |
|---|---|
| SPF fehlt / mehrfach / `+all` / ohne Abschluss / > 10 DNS-Abfragen / ohne Microsoft-Eintrag bei M365 | hoch bis kritisch |
| DMARC fehlt (hoch), `p=none` (mittel), ohne Berichte `rua` (niedrig), `pct` < 100 | |
| DKIM bei Microsoft 365 (`selector1/2`) bzw. Google nicht eingerichtet | mittel |
| Domain **ohne Mailbetrieb** ohne `v=spf1 -all` + `DMARC p=reject` | hoch – auch geparkte Domains werden missbraucht |
| MTA-STS fehlt | niedrig |
| Website-Zertifikat abgelaufen / ungültig / läuft in ≤ 14 bzw. ≤ 30 Tagen ab | kritisch / hoch / mittel |

Ergebnis: Punkte 0–100, Befunde mit Empfehlung → **Ticket** oder **Ausblenden**. Schwache Domains erscheinen im
**Umsatz-Radar** als „E-Mail-Absicherung (SPF/DKIM/DMARC)“, ablaufende Zertifikate als „Zertifikat erneuern“.
Der Monatsbericht zeigt den Schutzstatus („huber-demo.at geschützt (DMARC reject)“).

DNS-Abfragen laufen über den DNS-Server des Cockpit-Rechners (Paket `dnspython`).
