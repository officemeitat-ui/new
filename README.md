# Cleanos Dienstplan

Einsatzplanung für die Gebäudereinigung: Stammplan pflegen, Wochen automatisch einteilen, Vertretungen finden, Arbeitsrecht prüfen (AZG, ARG, KJBG), Wochenzettel im gewohnten Excel-Layout veröffentlichen. Ablage in SharePoint, Anmeldung mit Microsoft 365, Betrieb auf `dienstplan.cleanos.at`.

- **Konzept und Recherche:** [docs/KONZEPT.md](docs/KONZEPT.md)
- **Einrichtung** (SharePoint, Entra ID, Domain): [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)
- **Erweitern** (Regeln, Ansichten, Ablage, Design): [docs/ERWEITERN.md](docs/ERWEITERN.md)

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm ci
npm start        # http://localhost:8080 – Demo mit 35 Mitarbeitenden, Daten im Browser
npm test         # 41 Tests: Feiertage, Regeln, Fahrten, Automatik, Wochenzettel, Excel, SharePoint-Ablage
npm run build    # dist/ zum Hochladen auf den Webserver
```

Ob die App im Browser oder in SharePoint speichert, legt `config.json` fest (`"storage": "local"` oder `"sharepoint"`). Die Datei kann am Server ohne neuen Build geändert werden.

## Funktionen

| Planung | Auswertung | Stammdaten |
|---|---|---|
| Wochenübersicht mit Revier-Filter, Saldo und Zeitkonto | Objekt-Controlling: Budget gegen Plan je Objekt | Mitarbeitende inkl. Import aus Excel |
| Zeitlinie je Tag: Einsätze und Fahrten als Balken | | |
| Wochenzettel wie bisher (Excel, Druck/PDF) | Monatsauswertung für die Lohnverrechnung (CSV) | Objekte & Leistungen, Objektmappe, Schlüssel, Budget |
| Objektplan | | Abwesenheiten mit Kalender und Resturlaub |
| Vertretungs-Cockpit mit Vorschlägen | | Regeln, Regelkatalog, Fahrzeiten, Feiertage |
| Prüfbericht | | |

Fahrten sind planbar: Nach jedem Einsatz lässt sich die Fahrt mit Dauer und eigener Notiz eintragen, für diese Woche oder als Standard der Leistung. Ohne Eintrag gilt die Fahrzeit-Matrix bzw. Pauschale. Passt eine Fahrt nicht bis zum nächsten Einsatz, wird sie rot markiert.

Dazu kommen: Veröffentlichen mit Excel-Export nach SharePoint, Markierung späterer Änderungen, Änderungsprotokoll, Leserechte für Nicht-Disponent:innen und automatisches Zusammenführen, wenn zwei Personen gleichzeitig planen.

## Corporate Design

Logo und Farben in `assets/cleanos-logo.svg` und `themes/cleanos.css` sind **Platzhalter**. Bitte durch das echte Cleanos-CD ersetzen: Logo als SVG oder PNG, Primär- und Akzentfarbe, Schrift.

## Technik

Reines HTML/JavaScript (ES-Module), ohne Framework und ohne eigenen Server. Bibliotheken: MSAL.js (Microsoft-Anmeldung) und ExcelJS (Excel-Export), beide werden erst bei Bedarf geladen.
