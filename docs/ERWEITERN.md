# Erweitern

Der Dienstplan ist so gebaut, dass neue Regeln, Ansichten, Exporte oder eine andere Ablage jeweils **eine neue Datei** sind. Beim Entwickeln gibt es keinen Build-Schritt: ES-Module, die der Browser direkt lädt (`npm start`). Für den Betrieb bündelt `npm run build` alles mit esbuild. Tests laufen mit `npm test` (Node).

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
  auth/msal.js        Microsoft-Anmeldung (übernimmt die Anmeldung des Hostings)
  auth/graph-mail.js  E-Mail mit Anhang über Microsoft Graph
  export/excel.js  Excel-Wochenpläne (ExcelJS)
  export/pdf.js    PDF-Wochenpläne (Dokumentbeschreibung für pdfmake, in Node testbar)
  data/demo.js  Beispieldaten
  ui/
    app.js        Start, Rahmen, Navigation
    context.js    App-Zustand, Registry (registerView, registerModal, registerActions)
    planning.js   Planen, Veröffentlichen, Dateiexport
    flow.js       Ablauf-Leiste der Woche
    mobile.js     Handy: Kopfzeile, Leiste unten, Menü, Wischen, App installieren
    pdf.js        PDF im Browser erzeugen, ZIP
    shared.js     UI-Bausteine
    views/*.js    je Ansicht eine Datei (z. B. due.js: Periodische Leistungen)
    modals/*.js   Dialoge (absence.js: Abwesenheits-Assistent, todo.js: Zu erledigen, send.js: Versand)
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

## Vorschläge der Automatik anpassen

Wie gut eine Person zu einem Einsatz passt, steht in `candidateFactors()` (src/core/scheduler.js): eine Liste von Gründen mit Punkten (negativ = spricht dafür). Die Summe ist die Kosten für die Automatik, die Texte erscheinen als Begründung im Einsatz-Dialog, bei den Vertretungen und im Abwesenheits-Assistenten. Ein neuer Grund ist eine Zeile `add('code', punkte, 'Text')`, z. B. ein Bonus für Führerschein bei Objekten außerhalb der Stadt.

## Handy und Tablet

Unter 700 px Breite zeigt `isMobile()` (src/ui/mobile.js) die Handy-Ansicht: eigene Kopfzeile, Leiste unten, Menü „Mehr“ mit allen registrierten Ansichten. Eine neue Ansicht erscheint dort automatisch. Tabellen mit `class="data"` werden am Handy zu Karten; die Spaltenüberschrift kommt als `data-label` in jede Zelle (`labelTables()`). Eine Ansicht kann am Handy eine eigene Darstellung liefern, wie die Wochenübersicht mit `isMobile() ? mobileWeek(c) : …`.

Installierbar (PWA): `npm run build` schreibt `manifest.webmanifest` (aus `config.json` → brand: Name, Farbe, `appIcons`, `appleTouchIcon`) und `sw.js` (hält die gebündelten Dateien vor; Seite, Anmeldung und Daten kommen immer aus dem Netz). Logik in `scripts/pwa.js`.

## Rückgängig

Jede Planänderung ruft vorher `recordUndo('Text')` (src/ui/context.js). `mutateAssignments()` macht das automatisch. Gemerkt werden Einteilungen, Einzeländerungen und Fahrten der geladenen Wochen; Änderungen anderer Personen leeren den Verlauf.

## Handlungsbedarf („Zu erledigen“) erweitern

Die Glocke sammelt Punkte aus `computeTodo()` in `src/ui/modals/todo.js`: Abwesenheiten (`absenceImpact`), periodische Leistungen (`periodicDue` mit Status `zugeteilt`, `stammkraft`, `zuteilen`, `entfaellt`) und geänderte veröffentlichte Wochen. Ein weiterer Punkt (z. B. „Schlüssel nicht zurückgegeben“) ist eine weitere Liste in `computeTodo` mit einer eindeutigen `id`; das Popup beim Start erscheint, sobald eine `id` neu ist. Die Frist für periodische Leistungen steht in den Regeln (`dueLeadDays`, Standard 7 Tage).

Eine Woche gilt als eingeteilt, sobald die Automatik dort geplant hat (nicht fixierte Einteilungen). Händische Einteilungen und Übergaben aus dem Abwesenheits-Assistenten sind fixiert, damit „Woche planen“ die Woche danach trotzdem vollständig einteilt und die Übergaben behält.

## Zuweisung im Stammplan anpassen

Logik in `src/core/assign.js` (getestet in `test/assign.test.js`), Ansicht in `src/ui/views/assign.js`. `evaluateRegular()` liefert Ausschlussgründe (`blockers`) und Gründe mit Punkten (`factors`, negativ = spricht dafür) wie `candidateFactors()` der Wochenplanung. Ein neuer Grund ist eine Zeile `add('code', punkte, 'Text')`, ein neuer Ausschluss ein `blockers.push('Text')`. `suggestRegulars()` verteilt alle offenen Leistungen.

## Müllplanung anpassen

Logik in `src/core/waste.js`, Eingabe in `src/ui/waste-form.js`, Ansicht in `src/ui/views/waste.js`. Die Gänge entstehen beim Berechnen der Einsätze (`buildInstances` → `applyWaste`), es wird nichts zusätzlich gespeichert: Ändert sich der Stammplan, wandern die Gänge mit.

- **Zeitfenster** (wann ein Einsatz den Gang mitnehmen kann, Uhrzeit für eigene Gänge): `WASTE_WINDOWS`
- **Arten von Tonnen** und Erkennung aus dem Abfuhrkalender: `WASTE_TYPES`, `TYPE_PATTERNS`
- **Wer einen eigenen Gang bekommt**: `wasteRegulars()`; in der Automatik zählt zusätzlich „an dem Tag ohnehin im Objekt“ (`candidateFactors`)
- Ein angehängter Gang steht am Einsatz in `inst.addOns[]`, ein eigener Gang ist ein Einsatz mit `category: 'muell'` und `inst.waste`.

## Überstunden und Zuschläge anpassen

Logik in `src/core/overtime.js` (rein rechnend, getestet in `test/overtime.test.js`), Ansicht in `src/ui/views/overtime.js`.

- `classifyWeek()` ordnet eine Woche ein (Tagesgrenze, Wochengrenze, Zeitklassen). Ein anderes Modell, etwa eine Durchrechnung über mehrere Wochen, ist eine eigene Funktion mit demselben Ergebnis (`parts[{ date, type, cls, min }]`).
- `premiumPct()` liefert den Satz je Stundenart und Zeitklasse aus `rules.pay`. Eine weitere Zeitklasse (z. B. Sonntagnacht) braucht einen Eintrag in `TIME_CLASSES`, eine Zeile in `timeClasses()` und die Sätze in `rules.pay`.
- `payMonth()` macht daraus Lohnzeilen, Betrag, Steuerhinweis und die Buchung ins Zeitkonto; `OVERTIME_COLUMNS` in der Ansicht legt die CSV-Spalten fest.
- Versand: Texte und Auswahl in `src/core/payout.js`, PDFs in `src/export/payout-pdf.js`, Dialog in `src/ui/modals/payout.js`.

## Corporate Design

Am einfachsten aus der eigenen Website: `npm run theme -- https://www.firma.at` (oder Pfad zu einer gespeicherten Seite). Das Skript (`scripts/theme-from-site.js`, Logik in `scripts/theme/`) erkennt Farben aus Baukasten-Variablen (Elementor, WordPress) oder aus Häufigkeit und wichtigen Selektoren (Kopfzeile, Knöpfe, Links), Schriften aus Google Fonts oder `@font-face`, das Logo in der Kopfzeile und ob die Kopfzeile hell oder farbig ist. Es schreibt `themes/<name>.css` und in `config.json` `brand.theme`, `brand.logo`, `brand.logoOnLight` (Logo für helle Flächen, z. B. im PDF) und `brand.colors` (Primär- und Akzentfarbe, auch fürs PDF).

`themes/cleanos.css` überschreibt nur Farb- und Schrift-Tokens (`--accent`, `--bg`, `--font-display`, …) und die Kopfzeile. Logo: `assets/cleanos-logo.png` bzw. `brand.logo` in `config.json`, Symbol im Browser-Tab: `brand.icon`. Ein weiteres Theme: neue Datei `themes/name.css` mit `:root[data-brand='name']` und in `config.json` `"theme": "name"`.

## Datenmodell (Auszug)

```js
employee = { id, name, personnelNo, type, weeklyHours, maxMonthHours?, minor?, team, email?, skills[], trained[objectId], availability{1..7: {from, to}}, vacationDaysYear, startBalanceHours, wageGroup?, hourlyWage?, ueMode?, mehrMode? }   // email: Versand der PDF-Wochenpläne
object   = { id, name, short, address, region, color, onlyTrained, budgetHoursMonth, instructions, contact, keys[{ id, label, holderId }], waste? }
waste    = { streams[{ id, type: 'Restmüll'|'Biomüll'|'Altpapier'|'Leichtverpackung'|'Glas'|'Metall'|'Sperrmüll'|'Sonstiges', recurrence }],
             outWhen: 'vortag'|'abholtag', bringBack, minutes, responsible?: employeeId, note? }   // recurrence wie unten oder { type: 'dates', dates[] }
task     = { id, objectId, label, category: 'reinigung'|'sonder', recurrence, start, end, staff, regulars[employeeId], skills[], holidayRule: 'entfaellt'|'findet_statt'|'verschieben', travelAfterMin?, travelNote? }
recurrence = { type: 'weekly', weekdays[], everyWeeks, anchor, until? }
           | { type: 'monthly', mode: 'nth', nth: 1..4|-1, weekday: 1..7, everyMonths, anchor, until? }   // z. B. 1. Samstag, quartalsweise
           | { type: 'monthly', mode: 'day', day: 1..31, everyMonths, anchor, until? }                   // 31 = Monatsletzter
           | { type: 'once', date }
absence  = { id, employeeId, type, from, to, note? }
assignments[`${datum}|${taskId}`] = [{ employeeId, locked }]   // eigene Müll-Gänge: taskId = muell-<objectId>-out|in
overrides[`${datum}|${taskId}`]   = { date?, start?, end?, cancelled?, note? }
trips[`${datum}|${taskId}|${employeeId}`] = { min?, note? }   // geplante Fahrt nach dem Einsatz (Woche)
published[montag] = { status, publishedAt, publishedBy, saldi{empId: min}, snapshot{empId: signatur}, correctedAt?, corrections?[{ empId, before, after, delta, at, by }], sent?{empId: { at, by, via: 'E-Mail'|'Teilen'|'PDF'|'manuell', sig }}, files? }
travel[`${objA}|${objB}`] = minuten
payroll[monat] = { modes?{empId: { ue, mehr }}, closedAt?, by?, rows?{empId: { mehrPaid, mehrPaidEntries[], uePaid, zaBonus, amount, taxFree, accountDelta, lines[] }},
                   sent?{ office?: { at, by, via, to, sig, total }, people?{empId: { at, by, via, sig }} } }   // Monatsabschlüsse und Versand (daten/zeitkonto.json)
settings = { payrollMail? }   // Adresse(n) der Lohnverrechnung für den Versand der Auszahlungen
rules.pay = { fullTimeWeeklyH, dailyNormalH, longDayH, mehrPct, mehrBalanceMonths, nightFrom, nightTo, nightPct, ueTag … ue11Feiertag, bonusAs, ueMode, mehrMode, taxFreeHours, taxFreeMax }
rules.wages = { 1: 15.12, …, 6: 12.37 }   // KV-Stundenlöhne je Lohngruppe
```

## Ein Modul ergänzen (Plattform)

Ein Modul ist eine oder mehrere Ansichten mit eigener Datei und eigenen Rechten. Beispiele: `src/ui/views/meters.js` (Zählerstände), `inspections.js` (Objektkontrolle), `objektmappe.js`.

1. **Rolle und Modul:** in `src/core/access.js` das Modul in `MODULES` eintragen und in `DEFAULT_ROLES` festlegen, wer es sieht (`modules`) und ändern darf (`edit`).
2. **Datei:** in `src/storage/data-service.js` unter `MODULE_DOCS` einen Schlüssel mit Pfad und leerem Inhalt anlegen, z. B. `matten: { path: 'matten/matten.json', empty: () => ({ items: [] }) }`. Der Inhalt steht dann in `app.data.matten`, wird automatisch gespeichert, zusammengeführt und in der Datensicherung mitgenommen. Ohne Leserecht (403) bleibt er leer und wird nie geschrieben.
3. **Ansicht:** `registerView({ id, label, group: 'service', module: 'matten', noWeek: true, mobile: { icon, label }, badge, render })`. `noWeek` zeigt oben den Titel statt der Wochenwahl, `mobile` setzt den Knopf in der Leiste unten.
4. **Aktionen:** `registerActions({ … }, { edit: 'matten' })` sperrt sie ohne Schreibrecht im Modul (unabhängig von der gerade offenen Ansicht).
5. **Zu erledigen:** `registerTodo({ id, module, title, compute(today) → [{ id, … }], render(items) })`. Die `id` eines Punkts ändert sich, wenn er neu gemeldet werden soll.
6. **Hinweis im Einsatz:** `registerObjectHint({ module, html(objectId) })` zeigt im Einsatz-Dialog etwas zum Objekt.
7. **Suche:** in `src/ui/search.js` eine Gruppe ergänzen.
8. **Fotos und Unterschriften:** `storePhoto(file, 'matten/fotos/…')` aus `src/ui/photo.js` (SharePoint: Datei, Browser: kleines Vorschaubild), `signaturePad()` aus `src/ui/signature.js`.

## Ideen für nächste Module

- **Mitarbeiter-App** (PWA): eigener Wochenplan, Push bei Änderungen, Urlaubsantrag. Braucht einen kleinen Server für Rechte je Person.
- **Teams Shifts**: veröffentlichte Wochen über die Graph-Shifts-API nach Microsoft Teams schreiben. Die Anmeldung dafür ist schon vorhanden.
- **Zeiterfassung im Objekt** per QR/NFC → Ist-Stunden gegen Plan.
- **Objektkalkulation**: Fläche × Leistungswert (m²/h) × Intervall → Budget je Objekt.
- **Lohnarten-Mapping** für den BMD-/RZL-Import (Spalten in `PAYROLL_COLUMNS`, src/core/reports.js).
