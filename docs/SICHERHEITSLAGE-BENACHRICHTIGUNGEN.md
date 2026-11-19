# Sicherheitslage je Kunde · Benachrichtigungen · Sicherheitsprotokoll

## Sicherheitslage

Eine Note (0–100) je Kunde aus allen angebundenen Quellen:

| Bereich | Quelle | Note |
|---|---|---|
| Identität & Microsoft 365 | Tenant-Check (MFA, Weiterleitungen, Admin-Konten, Secure Score) | 100 minus Abzüge je Befund |
| Geräte | Geräte-Check (Inventar-Agent) | Durchschnitt der Geräte-Punkte |
| Datensicherung | Backup-Wächter | letzter Status und Erfolgsquote der letzten 30 Tage |
| E-Mail & Domain | Domain-Check (SPF, DKIM, DMARC, Zertifikat) | Durchschnitt der Domains |
| Organisation & Richtlinien | Security-/NIS2-Check (Fragebogen) | Ergebnis des Checks |

- **Gesamtnote** = Durchschnitt der erfassten Bereiche. Gibt es einen **kritischen** Befund, ist die Note auf höchstens
  59 („kritisch“) gedeckelt – ein offenes Scheunentor wird nicht von guten Bereichen weggemittelt.
- **„–“ = nicht erfasst**: Die Quelle ist bei diesem Kunden noch nicht angebunden. Die Übersicht *Sicherheitslage* zeigt
  damit auf einen Blick die blinden Flecken (und Verkaufschancen) je Kunde.
- **Verlauf**: Der Stand wird je Monat gespeichert; Kundenseite, Bericht und Portal zeigen die Veränderung zum Vormonat.
- **Maßnahmenplan**: alle offenen Befunde, nach Dringlichkeit sortiert; gleiche Befunde auf mehreren Geräten werden
  zusammengefasst („Festplatte nicht verschlüsselt – 4 Geräte“). Ausgeblendete Befunde zählen nicht.

### IT-Sicherheitsbericht

*Kunde → Sicherheitslage → Sicherheitsbericht* (oder in der Übersicht „Bericht“): Gesamtbewertung, Tabelle der Bereiche,
„Das läuft gut“, „Handlungsbedarf“ mit Empfehlung, „Noch nicht erfasst“. Als Text kopieren, **als PDF im ME-IT-Design**
ansehen oder im Kundenordner ablegen (lokal + SharePoint/OneDrive).

**Angebot aus Maßnahmen** erstellt aus dem Maßnahmenplan direkt einen Angebotsentwurf: Leistungen aus dem Katalog
(passend zu den Befunden laut Umsatz-Radar), die Befunde als Begründung. Preise rechnet wie immer der Code, nicht die KI.

Im **Kundenportal** sieht der Kunde auf der Übersicht „Ihre IT-Sicherheit“: Note, Bereiche und die wichtigsten
Maßnahmen – ohne interne Details.

Der Bericht ist eine Momentaufnahme aus automatischen Prüfungen und ersetzt kein Audit; das steht auch im Bericht.

## Benachrichtigungen

Glocke oben rechts im Cockpit, dazu E-Mail und Microsoft Teams – einzustellen unter *Einstellungen → Benachrichtigungen*.

| Ereignis | Standard |
|---|---|
| Tickets ab Priorität „hoch“ – das schließt fehlgeschlagene Sicherungen, externe Weiterleitungen in Microsoft 365 und Phishing-Meldungen ein | Glocke, E-Mail, Teams |
| Nachricht oder Ein-/Austritt aus dem Kundenportal | Glocke |
| Sicherheit: 5 Fehlanmeldungen in 10 Minuten, zurückgesetzte Zwei-Faktor-Anmeldung | Glocke, E-Mail, Teams |
| Tagesstart (Zusammenfassung per E-Mail zur gewählten Stunde) | aus |

- Jedes Ereignis wird nur **einmal** gemeldet. Was beim ersten Start schon vorhanden war, wird nicht nachgemeldet.
- **E-Mail** geht über das verbundene Postfach an die eingetragene Adresse.
- **Teams**: in Teams einen Workflow „Beim Empfang einer Teams-Webhookanforderung → Nachricht in einem Kanal posten“
  anlegen und die Adresse (https://…) eintragen. Gesendet wird eine Karte mit Titel, Text und Knopf „Im Cockpit öffnen“.
  Die Adresse wird nach dem Speichern nicht mehr angezeigt. *Mit echtem Teams noch nicht getestet.*
- „Speichern & testen“ zeigt je Kanal, ob es geklappt hat; Fehler eines Kanals stören das Cockpit nie.
- Links in Mails/Teams brauchen die Adresse des Cockpits (`PUBLIC_URL`, sonst die zuletzt im Browser verwendete).
- Die automatische Einordnung stuft eine bewusst gesetzte Priorität „hoch/kritisch“ nicht mehr herab.

## Sicherheitsprotokoll

*Verbindungen & Sicherheit → Sicherheitsprotokoll* (nur Admins): Anmeldungen im Cockpit und im Kundenportal mit
Fehlversuchen, Zwei-Faktor-Änderungen, Benutzer- und Portal-Zugänge, geänderte Einstellungen, Zertifikat, Exporte
(Belege, Rechnungen, Datensicherung, das Protokoll selbst), Löschungen, Registrierungsschlüssel und gesperrte Geräte –
jeweils mit Zeit, Person und Adresse. Suche, Filter „nur Fehlgeschlagene“, CSV-Export, Aufbewahrung 400 Tage.
Passwörter und Codes stehen nie im Protokoll.
