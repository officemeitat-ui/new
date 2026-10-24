# Einsatzplaner Gebäudereinigung (Prototyp)

Automatische Wochenplanung für Reinigungsbetriebe in Österreich: Stammplan pflegen, Woche automatisch einteilen, Vertretungen finden, Ruhezeiten und Arbeitszeitgrenzen prüfen, Wochenzettel im gewohnten Excel-Layout ausgeben.

Das Konzept dahinter steht in [docs/KONZEPT.md](docs/KONZEPT.md).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20. Es gibt keine weiteren Abhängigkeiten.

```bash
npm start      # http://localhost:8080
npm test       # Tests für Feiertage, Regeln, Automatik, Wochenzettel
```

Beim ersten Öffnen werden erfundene Beispieldaten für die kommende Woche geladen und automatisch eingeteilt. Unter **Export** lassen sie sich durch eigene Daten ersetzen oder wiederherstellen.

## Was drin ist

| Bereich | Datei |
|---|---|
| Feiertage Österreich (inkl. Ostern-Berechnung) | `src/core/holidays.js` |
| Einsätze aus dem Stammplan, Feiertagsregeln, Einzeländerungen | `src/core/plan.js` |
| Prüfregeln AZG/ARG/KJBG, Markierungen | `src/core/rules.js` |
| Automatische Einteilung und „Wer kann einspringen?“ | `src/core/scheduler.js` |
| Wochenzettel mit Anrechnung, Zuschlägen, Fahrzeit, Saldo | `src/core/timesheet.js` |
| Beispieldaten | `src/data/demo.js` |
| Oberfläche | `index.html`, `src/ui/` |

## Grenzen des Prototyps

- Daten werden nur im Browser gespeichert (localStorage). Datensicherung über **Export**.
- Keine Benutzer und Rechte, keine Mitarbeiter-App.
- Fahrzeit ist eine Pauschale zwischen zwei Objekten am selben Tag.
- Zuschläge und Grenzen sind Standardwerte und müssen mit dem Kollektivvertrag abgeglichen werden.
