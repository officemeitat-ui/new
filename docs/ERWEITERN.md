# Erweitern

Der Dienstplan ist so gebaut, dass neue Regeln, Ansichten, Exporte oder eine andere Ablage jeweils **eine neue Datei** sind. Beim Entwickeln gibt es keinen Build-Schritt: ES-Module, die der Browser direkt lädt (`npm start`). Für den Betrieb bündelt `npm run build` alles mit esbuild. Tests laufen mit `npm test` (Node). Unter Windows (z. B. mit VS Code oder Codex) läuft alles gleich: `npm start` liefert auch mit Windows-Pfaden aus (`scripts/serve.js`, Test `test/serve.test.js`), und `.gitattributes` hält die Zeilenenden auch im Windows-Arbeitsordner bei LF; die Werkzeuge in `werkzeuge/*/index.html` bleiben Byte für Byte unverändert. Arbeiten mehrere Helfer (Claude, Codex) am selben Zweig, nacheinander: vorher den neuesten Stand holen (`git pull`), danach pushen.

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
    uploads.js       Ohne Netz aufgenommene Dateien nach dem Hochladen im Modul vermerken (queued → url)
  storage/     Ablage
    docstore-local.js        Browser (Demo/Test)
    docstore-sharepoint.js   SharePoint über Microsoft Graph
    data-service.js          Aufteilung in Dateien, Autosave, Konflikte, Nachholen wartender Uploads
    offline.js               Gerätespeicher: letzter Stand, Ungespeichertes, Warteschlange für Fotos
  auth/msal.js        Microsoft-Anmeldung (übernimmt die Anmeldung des Hostings)
  auth/graph-mail.js  E-Mail mit Anhang über Microsoft Graph
  export/excel.js  Excel-Wochenpläne (ExcelJS)
  export/pdf.js    PDF-Wochenpläne (Dokumentbeschreibung für pdfmake, in Node testbar)
  data/demo.js  Beispieldaten
  ui/
    app.js        Start, Rahmen, Navigation
    context.js    App-Zustand, Registry (registerView, registerModal, registerActions, registerUploadHook)
    uploads.js    Nachgeholte Fotos: Start-Aufruf, Vermerk im Modul, Fehlgeschlagenes in „Zu erledigen“
    planning.js   Planen, Veröffentlichen, Dateiexport
    flow.js       Ablauf-Leiste der Woche
    mobile.js     Handy: Kopfzeile, Leiste unten, Menü, Wischen, App installieren
    pdf.js        PDF im Browser erzeugen, ZIP
    shared.js     UI-Bausteine
    views/*.js    je Ansicht eine Datei (z. B. due.js: Periodische Leistungen)
    views/lazy.js Ansichten, die erst bei Bedarf geladen werden (Kopfdaten, siehe „Später laden“)
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
  order: 95,                 // Position in der Seitenleiste
  label: 'Schlüssel',
  group: 'stamm',            // 'plan' | 'service' | 'fuhrpark' | 'auswertung' | 'stamm'
  icon: '<path d="M4 12h16"/>', // optional: Symbol in der Seitenleiste (SVG-Inhalt, 24er-Raster)
  render: (c) => `<h2>Schlüssel</h2>${app.data.objects.map((o) => `<p>${esc(o.name)}: ${(o.keys || []).length}</p>`).join('')}`,
})
```

In `src/ui/views/index.js` importieren, fertig. `c` ist die berechnete Woche (Einsätze, Prüfung, Wochenzettel über `c.timesheet(emp)`). Klicks laufen über `data-action="name"` und `registerActions({ name: (el) => … }, { edit: 'planung' })`. Mit `edit: '<Modul>'` (oder einer Liste, `'*'` = nur Vollzugriff) ist die Aktion ohne Schreibrecht in diesem Bereich gesperrt, egal aus welcher Ansicht sie kommt (Suche und Übersicht öffnen Dialoge aller Bereiche). Dialoge geben ihren Bereich mit: `registerModal('typ', render, { module: 'planung' })`; dann blendet die App `.edit-only` im Dialog nach diesem Recht aus. `edit: true` richtet sich nur nach der aktuellen Ansicht und passt nur für Aktionen, die es ausschließlich dort gibt. Änderungen an `app.data` mit `persist()` speichern und mit `renderNow()` neu zeichnen.

**Namen von Aktionen und Dialogen gelten app-weit.** Jedes Modul nimmt ein eigenes Kürzel (`ek-` Einkauf, `kasse-` Kassenbuch, `kb-` Kundenbereich, `fak-` Fakturierung …). Ein zweites Modul mit demselben Namen würde das erste stillschweigend überschreiben; `registerActions`/`registerModal` warnen dann in der Konsole (`NAME_CLASHES` in `context.js`), und `test/lazy.test.js` schlägt fehl.

**Kein Knopf ohne Aktion.** `test/aktionen.test.js` liest die Quellen und verlangt zu jedem `data-action`, `data-change`, `data-input`, `data-of`, `action: '…'` (Menü, Reiter, Hilfe-Thema) und `ACTIONS['…']` eine registrierte Aktion. Wird ein Name erst beim Zeichnen zusammengesetzt (`data-action="${x}"`, `ACTIONS[x]`), gehört die Stelle mit der Herkunft der Namen in `DYNAMISCH` in diesem Test (z. B. ein Helfer, dessen feste Argumente der Test dann prüft). Fehler einer Aktion zeigt die App als Hinweis (`runAction` in `context.js`); was nach einem Fehler nicht doppelt geschehen darf (Speichern, dann PDF), ordnet die Aktion selbst: erst speichern und schließen, dann das PDF.

**Knöpfe gliedern** (src/ui/shared.js, Verhalten in src/ui/menus.js): Neben dem einen Hauptknopf kommen weitere Aktionen in ein Aufklappmenü, seltene Zeilen-Aktionen in „⋯“, viele Reiter in Gruppen.

```js
import { menu, rowMenu, tabBar, ICON } from '../shared.js'

menu({ label: 'Export', icon: ICON.download, items: [
  { heading: 'Liste' },                                      // Überschrift
  { label: 'CSV', action: 'keys-csv', hint: 'für Excel' },   // label/hint sind HTML (Daten mit esc)
  ed && { label: 'Löschen', action: 'keys-del', data: { id }, danger: true }, // false fällt weg
  '-',                                                       // Trennlinie
] })
rowMenu([{ label: 'PDF', action: 'x-pdf', data: { id } }])    // „⋯“ in einer Tabellenzeile
tabBar({ action: 'x-tab', current, tabs: ['a', { label: 'Gruppe', items: [{ id: 'b', label: 'B', flag: 2 }] }].map(…) })
```

Leere Menüs ergeben `''`, ein einzelner Eintrag wird als normaler Knopf gezeigt; Überschriften ohne Einträge darunter fallen weg. Einträge rufen die Aktion wie ein Knopf (`data` landet in `el.dataset`).

### Später laden (große, selten gebrauchte Ansichten)

Was in `views/index.js` steht, lädt beim Start. Eine große Ansicht, die nicht jeder gleich braucht (z. B. Fakturierung, Material, Anleitung), kommt stattdessen erst, wenn ihre Ansicht, ein Dialog oder eine Aktion zum ersten Mal gebraucht wird, spätestens kurz nach dem Start im Hintergrund, und nur für Rollen, die den Bereich sehen. Die Datei selbst bleibt, wie sie ist:

1. In `src/ui/views/index.js` den Import entfernen und das Modul stattdessen in `views/lazy-buero.js` importieren (`lazy-alle.js`: Ansichten, die jede Rolle sieht). Ein Paket statt vieler Einzeldateien hält den Start in wenigen Dateien.
2. In `src/ui/views/lazy.js` die Kopfdaten eintragen: `lazy(BUERO, { views: [{ id, order, label, group, module, icon, noWeek, text }], modals: 'typ1 typ2', actions: 'aktion1 aktion2 …', hints: true, todo: ['kennung'] })`. `views` wie bei `registerView`, aber ohne `render` (`badge`, `range` und `actions` dürfen fehlen; der Zähler erscheint dann nach dem Laden). `modals` und `actions`: **alle** Namen, die das Modul registriert. `hints`, wenn es `registerObjectHint` aufruft, `todo` mit den Kennungen von `registerTodo`. Die Stelle in `lazy.js` bestimmt die Reihenfolge in „Zu erledigen“.
3. `npm test`: `test/lazy.test.js` lädt das Modul und vergleicht. Fehlt eine Aktion, ist eine Beschriftung anders oder steht eine Kennung zu viel da, sagt der Test genau was. Er prüft auch, dass der Build das Modul nicht doch in den Start zieht (statischer Import aus einer Datei, die immer lädt).

Bis zum Laden stehen Platzhalter in `VIEWS`, `MODALS` und `ACTIONS` (`registerLazy` in `context.js`): Seitenleiste, Suche, Cleo, Schnellfunktionen und Rollen sehen alles wie gewohnt, ein Klick lädt das Modul und führt dann die echte Aktion aus (mit ihrer Rechteprüfung). Platzhalter-Aktionen warten auf die echte und geben ihr Ergebnis (Promise) zurück. Wer eine Ansicht oder einen Dialog direkt aufruft, ohne dass jemand sie geöffnet hat (z. B. ein Bericht im Hintergrund), holt sie vorher mit `await ensureView(id)`, `await ensureModal(typ)` bzw. `await ensureAction(name)` aus `context.js`. Wird später im Modul eine Aktion ergänzt, gehört ihr Name auch nach `lazy.js`; der Test erinnert daran. Ein Modul, das andere Dateien beim Start brauchen (z. B. `appointmentsOfDay` für die Übersicht), bleibt in `index.js`.

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

Ab 701 px Breite stehen alle Ansichten in der Seitenleiste (`src/ui/sidebar.js`, zwischen 701 und 1180 px nur mit Symbolen), darüber eine schlanke Kopfleiste (`topbar` in `src/ui/app.js`) mit Titel, Wochenwahl und dem Menü „⋯“. Unter 700 px Breite zeigt `isMobile()` (src/ui/mobile.js) die Handy-Ansicht: eigene Kopfzeile, Leiste unten, Menü „Mehr“ mit allen registrierten Ansichten. Eine neue Ansicht erscheint an beiden Stellen automatisch. Tabellen mit `class="data"` werden am Handy zu Karten; die Spaltenüberschrift kommt als `data-label` in jede Zelle (`labelTables()`). Eine Ansicht kann am Handy eine eigene Darstellung liefern, wie die Wochenübersicht mit `isMobile() ? mobileWeek(c) : …`.

Installierbar (PWA): `npm run build` schreibt `manifest.webmanifest` (aus `config.json` → brand: Name, Farbe, `appIcons`, `appleTouchIcon`) und `sw.js` (hält die gebündelten Dateien vor; Seite, Anmeldung und Daten kommen immer aus dem Netz; als `index.html` vorgehalten wird nur die App-Seite selbst, `*.php` und andere Seiten am Webspace fängt er nicht ab). Logik in `scripts/pwa.js`.

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

Am einfachsten aus der eigenen Website: `npm run theme -- https://www.firma.at` (oder Pfad zu einer gespeicherten Seite). Das Skript (`scripts/theme-from-site.js`, Logik in `scripts/theme/`) erkennt Farben aus Baukasten-Variablen (Elementor, WordPress) oder aus Häufigkeit und wichtigen Selektoren (Kopfzeile, Knöpfe, Links), Schriften aus Google Fonts oder `@font-face`, das Logo in der Kopfzeile und ob die Kopfzeile hell oder farbig ist. Es schreibt `themes/<name>.css` und in `config.json` `brand.theme`, `brand.themes` (Name und Vorschaufarben fürs Auswahlfenster), `brand.logo`, `brand.logoOnLight` (Logo für helle Flächen, z. B. im PDF) und `brand.colors` (Primär- und Akzentfarbe, auch fürs PDF).

Drei Attribute am `<html>` steuern das Aussehen (gesetzt von `applyTheme` in `src/ui/theme.js`): `data-skin` (Farbschema, von jeder Person wählbar), `data-theme` (`light`/`dark`, fehlt bei „wie das Gerät“) `data-scale` (`gross`) und `data-look` (`modern`/`schlicht`; Kontrast-Schemata immer `schlicht`). Der Stil Modern steht am Ende von `src/ui/styles.css` unter `:root[data-look='modern']` und arbeitet nur mit den Tokens (`--accent`, `--brand-primary`, `--brand-night`, `--sec` für die Bereichsfarbe aus `data-section`), passt also zu jedem Farbschema. `data-brand` bleibt fest und gilt nur für Logo-Regeln. Die eingebauten Farbschemata Standard, Ruhig und Hoher Kontrast stehen in `src/ui/styles.css`, die Marken-Farbschemata in `themes/<marke>.css`; diese Datei wird immer geladen und enthält alle Farbschemata der Marke (bei Cleanos `cleanos` und `cleanos-nacht`). Ein Farbschema überschreibt nur Tokens (`--accent`, `--bg`, `--font-display`, …), Kopfzeile und wenige Formen. Ein weiteres: in `themes/<marke>.css` einen Block `:root[data-skin='name']` (und für dunkel `[data-skin='name'][data-theme='dark']` plus die Medienabfrage) ergänzen und in `config.json` unter `brand.themes.name` Bezeichnung, Hinweis und Vorschaufarben eintragen. Logo: `brand.logo`, Symbol im Browser-Tab: `brand.icon`.

## Datenmodell (Auszug)

```js
employee = { id, name, personnelNo, type, weeklyHours, maxMonthHours?, minor?, team, email?, lang?, skills[], trained[objectId], availability{1..7: {from, to}}, vacationDaysYear, startBalanceHours, wageGroup?, hourlyWage?, ueMode?, mehrMode? }   // email: Versand der PDF-Wochenpläne; lang: Sprache am Handy (bks|ro|tr|hu|en, leer = de)
object   = { id, name, short, address, region, color, onlyTrained, budgetHoursMonth, instructions, instructionsI18n?{ <lang>: { text, source, at?, by?, ki? } }, contact, keys[{ id, label, holderId }], waste? }   // source: Kennwert des deutschen Texts (core/sprachen.js), sonst veraltet
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
                   sent?{ office?: { at, by, via, to, sig, total }, people?{empId: { at, by, via, sig }} } }   // Monatsabschlüsse und Versand (lohn/zeitkonto.json)
settings = { payrollMail? }   // Adresse(n) der Lohnverrechnung für den Versand der Auszahlungen
rules.pay = { fullTimeWeeklyH, dailyNormalH, longDayH, mehrPct, mehrBalanceMonths, nightFrom, nightTo, nightPct, ueTag … ue11Feiertag, bonusAs, ueMode, mehrMode, taxFreeHours, taxFreeMax }
rules.wages = { 1: 15.12, …, 6: 12.37 }   // KV-Stundenlöhne je Lohngruppe
```

## Ein Modul ergänzen (Plattform)

Ein Modul ist eine oder mehrere Ansichten mit eigener Datei und eigenen Rechten. Beispiel: `src/ui/views/vehicles.js` (Fahrzeuge & Reifen).

Ein **eigenes Werkzeug** (fertige HTML-Datei wie Wasserzähler oder Mattenwechsel) braucht keinen Code in der App: Datei nach `werkzeuge/<name>/index.html`, in `scripts/werkzeuge.js` (`WERKZEUGE`) und `src/ui/views/tools.js` (`TOOLS`, mit Modul für die Rolle) eintragen. Siehe `werkzeuge/LIESMICH.md`.

1. **Rolle und Modul:** in `src/core/access.js` das Modul in `MODULES` eintragen und in `DEFAULT_ROLES` festlegen, wer es sieht (`modules`) und ändern darf (`edit`).
2. **Datei:** in `src/storage/data-service.js` unter `MODULE_DOCS` einen Schlüssel mit Pfad und leerem Inhalt anlegen, z. B. `lager: { path: 'lager/lager.json', empty: () => ({ items: [] }) }`. Der Inhalt steht dann in `app.data.lager`, wird automatisch gespeichert, zusammengeführt und in der Datensicherung mitgenommen. Ohne Leserecht (403) bleibt er leer und wird nie geschrieben. Wächst eine Liste Jahr für Jahr (z. B. die Einsätze des Mattenwechsels), statt dessen unter `YEAR_DOCS` eine Datei je Jahr anlegen (`prefix`, `list`, `yearOf`, `order`, `empty`): `app.data[key]` ist dann eine Liste aller geladenen Einträge (mit `id`), gespeichert wird je Jahr in `<prefix><Jahr>.json`; die App lädt Vorjahr, laufendes und nächstes Jahr, weitere mit `app.service.ensureYears(key, jahre)`.
3. **Ansicht:** `registerView({ id, label, group: 'service', module: 'lager', noWeek: true, mobile: { icon, label }, badge, render })`. `noWeek` zeigt oben den Pfad („Objektservice / …“) statt der Wochenwahl, `icon` das Symbol in der Seitenleiste (sonst aus `NAV_ICONS` in `src/ui/sidebar.js`), `mobile` setzt den Knopf in der Leiste unten.
4. **Aktionen:** `registerActions({ … }, { edit: 'lager' })` sperrt sie ohne Schreibrecht im Modul (unabhängig von der gerade offenen Ansicht).
5. **Zu erledigen:** `registerTodo({ id, module, title, compute(today) → [{ id, … }], render(items) })`. Die `id` eines Punkts ändert sich, wenn er neu gemeldet werden soll.
6. **Hinweis im Einsatz:** `registerObjectHint({ module, html(objectId) })` zeigt im Einsatz-Dialog etwas zum Objekt.
7. **Suche:** in `src/ui/search.js` eine Gruppe ergänzen.
8. **Fotos und Dateien:** `await app.store.upload(pfad, blob, typ)` liefert `{ webUrl }`; ohne Netz stellt die Ablage die Datei in die Warteschlange im Gerät und liefert `{ queued: true }`. Am Eintrag im Modul `{ path, name, type, size, at, by, url?, queued? }` speichern (so machen es Regiebericht, Anlagen, Qualitätsmessung, Arbeitsschutz, Bewerbungen). Mehr ist nicht zu tun: Der Abgleich holt die Datei nach (`DataService.flushQueuedUploads`, auch beim Start und wenn das Netz wiederkommt), `uploadDone` in `context.js` sucht den Pfad in allen Moduldaten (`markUploaded` in `src/core/uploads.js`), nimmt `queued` weg, setzt `url` und speichert. Liegen die Daten **nicht** in `app.data` (eigene Ablage wie die Matten-Touren), meldet sich das Modul mit `registerUploadHook((path, url) => …)` an und gibt `true` zurück, wenn es die Datei kennt und vermerkt hat; bei `false` merkt sich die Ablage die Datei und meldet sie dem nächsten Aufrufer von `flushUploads` noch einmal. Was SharePoint ablehnt (z. B. kein Schreibrecht), steht in „Zu erledigen“ und im Systemcheck (`src/ui/uploads.js`).
9. **Ladezeit:** Ist das Modul groß und nur für wenige Rollen, erst bei Bedarf laden (siehe „Später laden“ unter „Eine Ansicht ergänzen“).

## Ideen für nächste Module

- **Mitarbeiter-App** (PWA): eigener Wochenplan, Push bei Änderungen, Urlaubsantrag. Braucht einen kleinen Server für Rechte je Person.
- **Teams Shifts**: veröffentlichte Wochen über die Graph-Shifts-API nach Microsoft Teams schreiben. Die Anmeldung dafür ist schon vorhanden.
- **Zeiterfassung im Objekt** per QR/NFC → Ist-Stunden gegen Plan.
- **Objektkalkulation**: Fläche × Leistungswert (m²/h) × Intervall → Budget je Objekt.
- **Lohnarten-Mapping** für den BMD-/RZL-Import (Spalten in `PAYROLL_COLUMNS`, src/core/reports.js).
