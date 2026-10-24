# Cleanos Dienstplan

Einsatzplanung für die Gebäudereinigung: Stammplan pflegen, Wochen automatisch einteilen, Vertretungen finden, Arbeitsrecht prüfen (AZG, ARG, KJBG), Wochenzettel im gewohnten Layout veröffentlichen und als PDF an die Mitarbeitenden schicken. Ablage in SharePoint, die ganze Seite nur nach Microsoft-365-Anmeldung, Betrieb auf `dienstplan.cleanos.at`.

- **Konzept und Recherche:** [docs/KONZEPT.md](docs/KONZEPT.md)
- **Einrichtung** (SharePoint, Entra ID, Domain): [docs/EINRICHTUNG.md](docs/EINRICHTUNG.md)
- **Erweitern** (Regeln, Ansichten, Ablage, Design): [docs/ERWEITERN.md](docs/ERWEITERN.md)

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm ci
npm start        # http://localhost:8080 – Demo mit 35 Mitarbeitenden, Daten im Browser
npm test         # 54 Tests: Feiertage, Regeln, Fahrten, Rhythmen, Abwesenheit, Automatik, Wochenzettel, PDF, E-Mail, Excel, SharePoint
npm run build    # dist/ zum Hochladen: gebündelt, minimiert, mit Anmeldeschutz
```

Ob die App im Browser oder in SharePoint speichert, legt `config.json` fest (`"storage": "local"` oder `"sharepoint"`). Die Datei kann am Server ohne neuen Build geändert werden.

## Funktionen

| Planung | Auswertung | Stammdaten |
|---|---|---|
| Ablauf-Leiste: Einteilen → Offene → Prüfen → Veröffentlichen → Versenden | Objekt-Controlling: Budget gegen Plan je Objekt | Mitarbeitende inkl. Import aus Excel |
| Wochenübersicht mit Revier-Filter, Saldo und Zeitkonto; Einsätze per Ziehen umverteilen | | |
| Zeitlinie je Tag: Einsätze und Fahrten als Balken | | |
| Wochenzettel wie bisher (PDF, Excel, Druck) | Monatsauswertung für die Lohnverrechnung (CSV) | Objekte & Leistungen, Objektmappe, Schlüssel, Budget |
| Versand: PDF je Person per E-Mail, Teilen (WhatsApp) oder ZIP, mit Versandstand | | |
| Objektplan | | Abwesenheiten mit Kalender und Resturlaub |
| Vertretungs-Cockpit mit Vorschlägen | Nachträgliche Korrekturen für die Lohnverrechnung | Regeln, Regelkatalog, Fahrzeiten, Feiertage |
| Periodische Leistungen (14-tägig, monatlich, quartalsweise) mit Frist | | |
| Prüfbericht | | |

Fahrten sind planbar: Nach jedem Einsatz lässt sich die Fahrt mit Dauer und eigener Notiz eintragen, für diese Woche oder als Standard der Leistung. Ohne Eintrag gilt die Fahrzeit-Matrix bzw. Pauschale. Passt eine Fahrt nicht bis zum nächsten Einsatz, wird sie rot markiert.

**Urlaub und Krankenstand:** Wird eine Abwesenheit eingetragen (auch rückwirkend, auch direkt im Einsatz mit „Abwesend“), öffnet sich sofort der Assistent. Er zeigt, welche Einsätze und wie viele Stunden neu zu planen sind, übergibt die Fixobjekte gesammelt an eine Person (sortiert nach: wer übernimmt die meisten Stunden regelkonform, mit wie vielen Mehrstunden), verteilt automatisch oder schlägt je Einsatz eine Vertretung vor. Betrifft die Abwesenheit schon veröffentlichte Wochen, wird dort die Korrektur gebucht: Zeitkonto und Monatsauswertung („Nachträgliche Korrekturen“) stimmen danach.

**Zu erledigen:** Die Glocke in der Kopfzeile zählt, was zugeteilt werden muss: Abwesenheiten mit offenen Stunden, periodische Leistungen ohne Besetzung (spätestens 7 Tage vorher, einstellbar) und veröffentlichte Wochen mit späteren Änderungen. Gibt es Neues, öffnet sich die Liste beim Start von selbst.

**Einfach planen:** Einsätze lassen sich in der Wochenübersicht auf eine andere Person ziehen. Beim Ziehen zeigt jede Zelle sofort, ob die Person passt (grün), geprüft werden sollte (gelb) oder gegen eine Regel verstößt (rot). Jede Planänderung lässt sich mit „Rückgängig“ oder Strg+Z zurücknehmen. Vorschläge sind begründet, z. B. „noch 6 h frei laut Vertrag · kennt das Objekt (4×) · Zeitkonto −8 h: gleicht Minusstunden aus“. Die Automatik bevorzugt Stammkräfte, Personen mit freien Vertragsstunden oder Minusstunden, das eigene Revier und wer das Objekt schon kennt.

**PDF und Versand:** Je Person eine A4-Seite im gewohnten Layout (Feiertage durchgestrichen, Vertretungen rot, Sonderleistungen grün), mit Objektadressen, Hinweisen für Vertretungen, Saldo und Zeitkonto. Nach dem Veröffentlichen öffnet sich der Versand: E-Mail mit PDF-Anhang über Microsoft 365, „Teilen“ am Handy (z. B. WhatsApp), Sammel-PDF zum Drucken oder ZIP. Wird ein Plan nach dem Versand geändert, steht die Person wieder auf „zu versenden“.

**Geschützt:** Auf Azure Static Web Apps wird jede Datei erst nach der Microsoft-Anmeldung ausgeliefert, nur für Konten aus dem eigenen Tenant. Die App übernimmt diese Anmeldung für SharePoint, ohne zweite Eingabe.

Dazu kommen: Veröffentlichen mit Excel- und PDF-Export nach SharePoint, Markierung späterer Änderungen, Änderungsprotokoll, Leserechte für Nicht-Disponent:innen und automatisches Zusammenführen, wenn zwei Personen gleichzeitig planen.

## Corporate Design

Logo und Farben in `assets/cleanos-logo.svg` und `themes/cleanos.css` sind **Platzhalter**. Bitte durch das echte Cleanos-CD ersetzen: Logo als SVG oder PNG, Primär- und Akzentfarbe, Schrift.

## Technik

Reines HTML/JavaScript (ES-Module), ohne Framework und ohne eigenen Server. `npm start` liefert den Quellcode direkt aus. `npm run build` bündelt ihn mit esbuild zu wenigen minimierten Dateien mit Inhalts-Hash (4 statt rund 50 Anfragen, dauerhaft cachebar). Bibliotheken werden erst bei Bedarf geladen: MSAL.js (Anmeldung), ExcelJS (Excel), pdfmake (PDF) und JSZip (ZIP).
