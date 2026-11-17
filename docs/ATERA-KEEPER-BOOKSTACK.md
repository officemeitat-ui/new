# Atera · Keeper · BookStack – der Werkzeugkasten, verbunden

Jedes Werkzeug macht das, was es am besten kann – das Cockpit verbindet sie:

| Werkzeug | Aufgabe | Was das Cockpit daraus macht |
|---|---|---|
| **Atera** (RMM + Splashtop) | Überwachung, Patches, Fernwartung | Kunden & Geräte inkl. Link zur Atera-Geräteseite, Alarme → Tickets, **Splashtop-Sitzungen als Wartungsnachweis**, Sitzungen ohne Zeitbuchung |
| **Keeper** | Passwörter & Zugangsdaten | Links je Kunde und Gerät („Keeper ↗“), **Passwort-Wächter**: keine Klartext-Passwörter in Tickets, Wiki oder Cloud-KI |
| **BookStack** | Dokumentation | Je Kunde ein automatisch aktuelles IT-Doku-Buch, Wissensartikel im Wiki, Wiki-Anleitungen als Wissen für KI-Triage, Assistent und Kundenportal |

## Wartung immer über Atera – mit Protokoll

```
Wartungsplan: Prüfung fällig ──► Ticket „Wartung: Backup-Restore-Test“
                                   mit Links zu den Atera-Geräteseiten des Kunden
        │
        ▼  Techniker: Atera-Gerät öffnen → Splashtop verbinden → Wartung durchführen
Atera/Splashtop protokolliert: Beginn, Ende, Techniker, Gerät
        │
        ▼  Protokoll (CSV) importieren – Wartung → Fernwartung → „Protokoll importieren“
Zuordnung: Gerät → Kunde → Wartung im Zeitfenster (Fälligkeit − Vorlauf … erledigt)
        │
        ├─► Wartungsnachweis: Minuten im Abschluss-Dialog vorbelegt, im Wartungsprotokoll-PDF
        │   („Fernwartung (Atera/Splashtop, protokolliert): 17.11.2026 08:05–08:41, 36 Min., Martin E.“),
        │   im Kundenportal und in der BookStack-Doku
        ├─► vorhandene Zeitbuchung am selben Tag erkannt → „gebucht“
        └─► sonst „ohne Zeitbuchung“ → 1 Klick „Zeit buchen“ (keine verschenkten Stunden)
```

**Export des Protokolls:** in Atera über die Berichte zu Fernzugriff/Remote-Sitzungen bzw. in der
Splashtop-Konsole unter *Logs → Sitzungen* als CSV. Die Spalten werden automatisch erkannt
(Beginn/Start, Ende oder Dauer, Techniker/Benutzer, Computer/Gerät, Kunde/Gruppe; deutsche und
US-Datumsformate). Mehrfach importieren ist unproblematisch – Duplikate werden erkannt.
Die Zuordnung zum Kunden läuft über den Gerätenamen (auch mit Domain, z. B. `srv01.firma.local`)
oder die Kundengruppe; was nicht passt, steht unter „Ohne Kunde“ zum Zuordnen.

### Atera-API einrichten
1. Atera → *Admin → API* → API-Schlüssel kopieren
2. `.env`:
   ```
   ATERA_API_KEY=…
   ATERA_SYNC_HOURS=6
   ATERA_ALERT_TICKETS=true
   ```
3. *Import & Datensicherung → Atera → Jetzt abgleichen*

Übernommen werden Kunden (Zuordnung per Name, fehlende werden angelegt), Agents als Geräte
(Name, Server/Arbeitsplatz, Betriebssystem, Seriennummer, zuletzt online, Link zur Atera-Geräteseite)
und – falls aktiviert – offene Alarme als Tickets (jeder Alarm nur einmal, „Critical“ → Priorität hoch).
Damit greifen Support-Ende-Erkennung, Umsatz-Radar, Health Score und Wartungsvorschläge auf echte Daten zu.

## Keeper – Passwörter bleiben im Tresor

- **Keine Passwörter im Cockpit.** Stattdessen je Kunde ein Link zum Keeper-Ordner und je Gerät ein Link
  zum Keeper-Eintrag (Kunde bearbeiten bzw. Gerät bearbeiten). Nur `https://`-Links werden akzeptiert.
- **Passwort-Wächter** (*Einstellungen*): findet Klartext-Zugangsdaten in Tickets, Wissen, Kunden- und
  Gerätenotizen, E-Mails und Wartungsnotizen („Passwort: …“, WLAN-Schlüssel, PIN, API-Keys, private
  Schlüssel, BitLocker-Wiederherstellungsschlüssel). Ablauf: Wert in Keeper übernehmen → „Schwärzen“.
- **Automatischer Schutz:** Vor dem Export nach BookStack und vor jedem Aufruf einer Cloud-KI werden
  Zugangsdaten durch „•••• (in Keeper)“ ersetzt. Die lokale KI (Ollama) sieht den Originaltext – er
  verlässt das Haus nicht.

## BookStack – IT-Doku, die sich selbst pflegt

1. BookStack → *Profil → API-Tokens* (die Rolle braucht „Zugriff auf System-API“)
2. `.env`:
   ```
   BOOKSTACK_URL=https://wiki.meit.at
   BOOKSTACK_TOKEN_ID=…
   BOOKSTACK_TOKEN_SECRET=…
   BOOKSTACK_SYNC_HOURS=6
   ```
3. *Import & Datensicherung → BookStack*: Buchnamen und zu übernehmende Bücher festlegen → „Jetzt abgleichen“

| Richtung | Inhalt |
|---|---|
| Cockpit → BookStack | Buch „IT-Doku: ‹Kunde›“ mit Seiten **Übersicht** (Kontakt, Paket, Leistungen, Keeper-Link), **Geräte** (inkl. Atera- und Keeper-Links, Warnung bei fehlendem Herstellersupport), **Lizenzen & Verträge**, **Wartung & Nachweise** (Plan + durchgeführte Prüfungen mit protokollierter Fernwartung) |
| Cockpit → BookStack | Wissensartikel → Buch „ME-IT Wissensdatenbank“ |
| BookStack → Cockpit | Seiten aus den gewählten Büchern werden Wissen für KI-Triage, Assistent und (nach Freigabe) die Kundenportal-Hilfe; bearbeitet wird weiter in BookStack |

Automatisch erzeugte Seiten sind markiert (Schlagwort `meit-quelle: cockpit`) und werden beim Abgleich
überschrieben – eigene Seiten in denselben Büchern bleiben unberührt. Pro Kunde gibt es im Cockpit
den Knopf „Doku → BookStack“ und den Link „IT-Doku in BookStack ↗“. Tipp: In BookStack Leserechte
pro Kundenbuch vergeben – so kann auch der Kunde selbst seine Doku sehen.
