# Erweitern

Der Dienstplan ist so gebaut, dass neue Regeln, Ansichten, Exporte oder eine andere Ablage jeweils **eine neue Datei** sind. Es gibt keinen Build-Schritt für den eigenen Code: ES-Module, die der Browser direkt lädt. Tests laufen mit `npm test` (Node, ohne Abhängigkeiten außer ExcelJS).

## Aufbau

```
src/
  core/        Fachlogik, ohne Browser (in Node testbar)
    dates.js         Datum/Zeit
    holidays.js      Feiertage Österreich
    plan.js          Stammplan → Einsätze, Feiertagsregeln, Einzeländerungen, PlanState
    rules.js         Regelkatalog (RULES), Prüfung, Fahrten (ctx.tripAfter, dayTrips)
    scheduler.js     Automatische Einteilung, Kandidaten-Ranking
    timesheet.js     Wochenzettel mit Anrechnung, Zuschlägen, Fahrzeit, Saldo
    reports.js       Monatsauswertung, Objekt-Controlling, Zeitkonto, Urlaub
    attention.js     Handlungsbedarf: Rhythmus-Kategorien, Auswirkung einer Abwesenheit,
                     Übergabe an eine Person, Saldo-Korrekturen
    importer.js      Excel-Import (Tabulator/CSV)
    merge.js         Zusammenführen bei gleichzeitigem Bearbeiten
  storage/     Ablage
    docstore-local.js        Browser (Demo/Test)
    docstore-sharepoint.js   SharePoint über Microsoft Graph
    data-service.js          Aufteilung in Dateien, Autosave, Konflikte
  auth/msal.js  Microsoft-Anmeldung
  export/excel.js  Excel-Wochenpläne (ExcelJS)
  data/demo.js  Beispieldaten
  ui/
    app.js        Start, Rahmen, Navigation
    context.js    App-Zustand, Registry (registerView, registerModal, registerActions)
    planning.js   Planen, Veröffentlichen
    shared.js     UI-Bausteine
    views/*.js    je Ansicht eine Datei (z. B. due.js: Periodische Leistungen)
    modals/*.js   Dialoge (absence.js: Abwesenheits-Assistent, todo.js: Zu erledigen)
themes/        Corporate Design (CSS-Tokens)
config.json    Laufzeit-Konfiguration
```

## Eine Prüfregel ergänzen

Regeln stehen in `RULES` (src/core/rules.js). Eine eigene Regel in einer neuen Datei, z. B. `src/core/rules-extra.js`:

```js
import { registerRule } from './rules.js'

registerRule({
  id: 'maxObjectsPerDay',
  title: 'Höchstens 4 Objekte pro Tag',
  law: 'betrieblich',
  description: 'Zu viele Wege an einem Tag.',
  check({ byDay, add }) {
    for (const [, items] of byDay) {
      const objects = new Set(items.map((i) => i.objectId))
      if (objects.size > 4) add('warning', 'MAX_OBJECTS', 'day', `${objects.size} Objekte an einem Tag`, items)
    }
  },
})
```

Dann die Datei in `src/ui/views/index.js` importieren (`import '../../core/rules-extra.js'`). Die Regel erscheint automatisch im Regelkatalog (ein-/ausschaltbar), im Prüfbericht und in „Wer kann einspringen?“. Die Automatik behandelt `error` als Ausschluss und `warning`/`info` als Hinweis.

Was `check` bekommt: `emp`, `items` (Einsätze sortiert), `ctx` (Objekte, Mitarbeitende, Feiertage, `travel(a, b)`), `r` (Regelwerte), `minor`, `limits`, `byDay`, `byWeek`, `byMonth`, `workOfDay(datum)`, `workOfItems(liste)`, `objName(einsatz)`, `add(severity, code, scope, text, einsätze, extra)`.

## Eine Ansicht ergänzen

```js
// src/ui/views/keys.js
import { app, registerView } from '../context.js'
import { esc } from '../shared.js'

registerView({
  id: 'keys',
  order: 95,                 // Position im Register
  label: 'Schlüssel',
  group: 'stamm',            // 'plan' | 'auswertung' | 'stamm'
  render: (c) => `<h2>Schlüssel</h2>${app.data.objects.map((o) => `<p>${esc(o.name)}: ${(o.keys || []).length}</p>`).join('')}`,
})
```

In `src/ui/views/index.js` importieren, fertig. `c` ist die berechnete Woche (Einsätze, Prüfung, Wochenzettel über `c.timesheet(emp)`). Klicks laufen über `data-action="name"` und `registerActions({ name: (el) => … }, { edit: true })`. Mit `edit: true` ist die Aktion im Lesemodus gesperrt. Änderungen an `app.data` mit `persist()` speichern und mit `renderNow()` neu zeichnen.

## Andere Ablage (z. B. eigene Datenbank)

Eine Ablage braucht vier Methoden, siehe `docstore-local.js`:

- `init()`
- `read(path)` → `{ data, etag } | null`
- `write(path, data, etag)` → `neuerEtag`; wirft `ConflictError`, wenn der eTag nicht passt
- `upload(path, blob, type)` → `{ webUrl }`

Der `DataService` kümmert sich um Aufteilung, Autosave, Zusammenführen und Nachladen. Eine REST-API oder Azure Blob Storage sind damit je eine Datei.

## Handlungsbedarf („Zu erledigen“) erweitern

Die Glocke sammelt Punkte aus `computeTodo()` in `src/ui/modals/todo.js`: Abwesenheiten (`absenceImpact`), periodische Leistungen (`periodicDue` mit Status `zugeteilt`, `stammkraft`, `zuteilen`, `entfaellt`) und geänderte veröffentlichte Wochen. Ein weiterer Punkt (z. B. „Schlüssel nicht zurückgegeben“) ist eine weitere Liste in `computeTodo` mit einer eindeutigen `id`; das Popup beim Start erscheint, sobald eine `id` neu ist. Die Frist für periodische Leistungen steht in den Regeln (`dueLeadDays`, Standard 7 Tage).

Eine Woche gilt als eingeteilt, sobald die Automatik dort geplant hat (nicht fixierte Einteilungen). Händische Einteilungen und Übergaben aus dem Abwesenheits-Assistenten sind fixiert, damit „Woche planen“ die Woche danach trotzdem vollständig einteilt und die Übergaben behält.

## Corporate Design

`themes/cleanos.css` überschreibt nur Farb- und Schrift-Tokens (`--accent`, `--bg`, `--font-display`, …) und die Kopfzeile. Logo: `assets/cleanos-logo.svg` bzw. `brand.logo` in `config.json`. Ein weiteres Theme: neue Datei `themes/name.css` mit `:root[data-brand='name']` und in `config.json` `"theme": "name"`.

## Datenmodell (Auszug)

```js
employee = { id, name, personnelNo, type, weeklyHours, maxMonthHours?, minor?, team, email?, skills[], trained[objectId], availability{1..7: {from, to}}, vacationDaysYear, startBalanceHours }
object   = { id, name, short, address, region, color, onlyTrained, budgetHoursMonth, instructions, contact, keys[{ id, label, holderId }] }
task     = { id, objectId, label, category: 'reinigung'|'sonder', recurrence, start, end, staff, regulars[employeeId], skills[], holidayRule: 'entfaellt'|'findet_statt'|'verschieben', travelAfterMin?, travelNote? }
recurrence = { type: 'weekly', weekdays[], everyWeeks, anchor, until? }
           | { type: 'monthly', mode: 'nth', nth: 1..4|-1, weekday: 1..7, everyMonths, anchor, until? }   // z. B. 1. Samstag, quartalsweise
           | { type: 'monthly', mode: 'day', day: 1..31, everyMonths, anchor, until? }                   // 31 = Monatsletzter
           | { type: 'once', date }
absence  = { id, employeeId, type, from, to, note? }
assignments[`${datum}|${taskId}`] = [{ employeeId, locked }]
overrides[`${datum}|${taskId}`]   = { date?, start?, end?, cancelled?, note? }
trips[`${datum}|${taskId}|${employeeId}`] = { min?, note? }   // geplante Fahrt nach dem Einsatz (Woche)
published[montag] = { status, publishedAt, publishedBy, saldi{empId: min}, snapshot{empId: signatur}, correctedAt?, corrections?[{ empId, before, after, delta, at, by }] }
travel[`${objA}|${objB}`] = minuten
```

## Ideen für nächste Module

- **Mitarbeiter-App** (PWA): eigener Wochenplan, Push bei Änderungen, Urlaubsantrag. Braucht einen kleinen Server für Rechte je Person.
- **Teams Shifts**: veröffentlichte Wochen über die Graph-Shifts-API nach Microsoft Teams schreiben. Die Anmeldung dafür ist schon vorhanden.
- **Zeiterfassung im Objekt** per QR/NFC → Ist-Stunden gegen Plan.
- **Objektkalkulation**: Fläche × Leistungswert (m²/h) × Intervall → Budget je Objekt.
- **Lohnarten-Mapping** für den BMD-/RZL-Import (Spalten in `PAYROLL_COLUMNS`, src/core/reports.js).
