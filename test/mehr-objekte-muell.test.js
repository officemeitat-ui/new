import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'
import { collectionDays, datesIn, detectWasteType, dutyText, parseDateList, parseIcs, rhythmOf, streamsFromEntries, streamText, wasteDuties, wasteRecurrence, wasteSummary } from '../src/core/waste.js'

const weekly = (weekday, everyWeeks = 1, anchor = '2026-11-02') => ({ type: 'weekly', weekdays: [weekday], everyWeeks, anchor })
const object = (waste, extra = {}) => ({ id: 'o1', name: 'Wohnanlage Lindenhof', short: 'Lindenhof', color: 1, waste, ...extra })
const cal = (...events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')

const types = [
  ['Restabfall', 'Restmüll'],
  ['Kompost / Grünschnitt', 'Biomüll'],
  ['Kartonage', 'Altpapier'],
  ['Gelbe Tonne', 'Leichtverpackung'],
  ['LVP-Sack', 'Leichtverpackung'],
  ['Altglas weiß', 'Glas'],
  ['Dosen', 'Metall'],
  ['Sperrmüllabholung', 'Sperrmüll'],
  ['Elektroaltgeräte', 'Sonstiges'],
  ['', 'Sonstiges'],
]
for (const [text, type] of types) test(`Müllart erkannt: „${text}“ → ${type}`, () => assert.equal(detectWasteType(text), type))

test('Müll-Rhythmus: monatlich am 2. Dienstag bzw. am letzten Sonntag, 4-wöchentlich', () => {
  assert.deepEqual(wasteRecurrence('m1', '2026-11-10'), { type: 'monthly', mode: 'nth', nth: 2, weekday: 2, everyMonths: 1, anchor: '2026-11-10' })
  const last = wasteRecurrence('m1', '2026-11-29')
  assert.deepEqual([last.nth, last.weekday], [-1, 7], '29. = 5. Sonntag → letzter')
  assert.equal(wasteRecurrence('w4', '2026-11-05').everyWeeks, 4)
  assert.equal(wasteRecurrence('wx', '2026-11-05').everyWeeks, 1, 'unbekannt: wöchentlich')
  assert.equal(streamText({ type: 'Biomüll', recurrence: wasteRecurrence('m1', '2026-11-10') }), 'Biomüll monatlich, 2. Di')
})

test('Müll-Rhythmus zurück ins Formular: über 4 Wochen als 4-wöchentlich, Termine mit erstem Datum', () => {
  assert.deepEqual(rhythmOf({ recurrence: { type: 'weekly', weekdays: [3], everyWeeks: 6, anchor: '2026-11-04' } }), { rhythm: 'w4', ref: '2026-11-04', dates: [] })
  assert.deepEqual(rhythmOf({ recurrence: { type: 'monthly', anchor: '2026-11-10' } }), { rhythm: 'm1', ref: '2026-11-10', dates: [] })
  assert.deepEqual(rhythmOf({ recurrence: { type: 'dates', dates: ['2026-12-01', '2026-12-15'] } }), { rhythm: 'dates', ref: '2026-12-01', dates: ['2026-12-01', '2026-12-15'] })
  assert.deepEqual(rhythmOf({}), { rhythm: 'w1', ref: '', dates: [] })
})

test('Müll-Kurztext: mehrere Tage, keine Termine', () => {
  assert.equal(streamText({ type: 'Restmüll', recurrence: { type: 'weekly', weekdays: [1, 4], everyWeeks: 1 } }), 'Restmüll wöchentlich Mo/Do')
  assert.equal(streamText({ type: 'Glas', recurrence: { type: 'dates', dates: [] } }), 'Glas: 0 Termine')
  assert.equal(streamText({ type: 'Glas', recurrence: { type: 'dates', dates: ['2026-11-03', '2026-12-01'] } }), 'Glas: 2 Termine')
})

test('Abfuhrtage: am selben Tag zusammengefasst, feste Reihenfolge, eigene Art hinten', () => {
  const holidays = holidayCalendar('2026-10-26', '2026-11-30')
  const o = object({ streams: [{ type: 'Glas', recurrence: weekly(2) }, { type: 'Altkleider', recurrence: weekly(2) }, { type: 'Restmüll', recurrence: weekly(2) }, { type: 'Biomüll', recurrence: { type: 'dates', dates: ['2026-11-03'] } }] })
  assert.deepEqual(collectionDays(o, '2026-11-02', '2026-11-08', holidays), [{ date: '2026-11-03', types: ['Restmüll', 'Biomüll', 'Glas', 'Altkleider'] }])
})

test('Abfuhrtage: Feiertag in der Vorwoche schiebt den Termin in den Zeitraum', () => {
  const holidays = holidayCalendar('2026-11-20', '2026-12-31')
  const o = object({ streams: [{ type: 'Restmüll', recurrence: weekly(2, 1, '2026-12-01') }] })
  // Di 8.12. Mariä Empfängnis → Mi 9.12.
  assert.deepEqual(collectionDays(o, '2026-12-09', '2026-12-14', holidays).map((d) => d.date), ['2026-12-09'])
  assert.deepEqual(collectionDays(o, '2026-12-08', '2026-12-08', holidays), [], 'am Feiertag selbst keine Abfuhr')
})

test('Abfuhrtage: Christtag am Freitag – nächster Werktag ist Montag 28.12. (Stefanitag und Wochenende übersprungen)', () => {
  const holidays = holidayCalendar('2026-12-01', '2027-01-31')
  const o = object({ streams: [{ type: 'Altpapier', recurrence: weekly(5, 1, '2026-12-04') }] })
  assert.deepEqual(collectionDays(o, '2026-12-21', '2027-01-03', holidays).map((d) => d.date), ['2026-12-28'], 'Neujahr wandert aus dem Zeitraum')
  assert.deepEqual(collectionDays(o, '2027-01-01', '2027-01-08', holidays).map((d) => d.date), ['2027-01-04', '2027-01-08'], 'Neujahr (Fr) → Mo 4.1.')
})

test('Müll-Zusammenfassung für die Objektkarte', () => {
  const holidays = holidayCalendar('2026-10-26', '2027-01-31')
  const o = object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], outWhen: 'abholtag', bringBack: false })
  assert.equal(wasteSummary(o, '2026-11-02', holidays), 'Restmüll wöchentlich Di · raus in der Früh · nächste Abfuhr Di 03.11.: Restmüll')
  assert.equal(wasteSummary(object({ streams: [] }), '2026-11-02', holidays), '')
  const later = object({ streams: [{ type: 'Glas', recurrence: { type: 'dates', dates: ['2027-06-01'] } }] })
  assert.equal(wasteSummary(later, '2026-11-02', holidays), 'Glas: 1 Termin · raus am Vorabend, rein am Abholtag', 'ohne Termin in den nächsten zwei Monaten')
})

test('Müll-Gänge am Rand des Zeitraums: Abfuhr am Tag danach, Rausstellen am Vorabend noch dabei', () => {
  const holidays = holidayCalendar('2026-10-26', '2026-11-30')
  const duties = wasteDuties([object({ streams: [{ type: 'Restmüll', recurrence: weekly(1) }] })], '2026-11-02', '2026-11-08', holidays)
  // Mo 2.11.: raus So 1.11. liegt vor dem Zeitraum; Mo 9.11.: raus So 8.11. ja, rein erst am 9.11. (nicht mehr)
  assert.deepEqual(duties.map((d) => [d.action, d.date, d.collection]), [['in', '2026-11-02', '2026-11-02'], ['out', '2026-11-08', '2026-11-09']])
  assert.equal(dutyText(duties[1]), 'Müll rausstellen: Restmüll')
  assert.ok(duties.every((d) => d.minutes === 10))
})

test('Müll-Gänge: Objekte ohne Tonnen bleiben aus, eigene Dauer je Gang', () => {
  const holidays = holidayCalendar('2026-10-26', '2026-11-30')
  const objects = [object({ streams: [{ type: 'Biomüll', recurrence: weekly(3) }], minutes: 25, outWhen: 'abholtag' }), { id: 'o2', name: 'ohne' }]
  const duties = wasteDuties(objects, '2026-11-02', '2026-11-08', holidays)
  assert.deepEqual(duties.map((d) => [d.objectId, d.action, d.window, d.date, d.minutes]), [['o1', 'out', 'out-abholtag', '2026-11-04', 25], ['o1', 'in', 'in', '2026-11-04', 25]])
})

// ---------------------------------------------------------------- an Einsätze anhängen

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id) => ({ id, name: id, type: 'Teilzeit', weeklyHours: 30, skills: [], trained: [], availability: allDays })
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })
function instances(objects, tasks) {
  const data = { employees: [emp('e1'), emp('e2')], objects, tasks, absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-26', '2026-11-30')
  const ctx = createContext(data, holidays)
  return new Map(buildInstances(data, '2026-11-02', '2026-11-08', holidays, ctx.rules).map((i) => [i.key, i]))
}

test('Müll am Vorabend: der Einsatz, der am spätesten endet, nimmt den Gang mit', () => {
  const by = instances([object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], bringBack: false })], [task('mittag', [1], '12:00', '13:00'), task('abend', [1], '17:00', '19:00')])
  assert.equal(by.get('2026-11-02|mittag').addOns, undefined)
  assert.equal(by.get('2026-11-02|abend').endTime, '19:10')
  assert.equal(by.has('2026-11-02|muell-o1-out'), false, 'kein eigener Gang')
})

test('Müll in der Früh: der früheste Einsatz bis 8 Uhr nimmt den Gang mit', () => {
  const by = instances([object({ streams: [{ type: 'Glas', recurrence: weekly(2) }], outWhen: 'abholtag', bringBack: false })], [task('zwei', [2], '06:30', '07:30'), task('eins', [2], '05:00', '06:00'), task('spaet', [2], '08:00', '09:00')])
  assert.deepEqual(by.get('2026-11-03|eins').addOns.map((d) => d.action), ['out'])
  assert.equal(by.get('2026-11-03|zwei').addOns, undefined)
  assert.equal(by.get('2026-11-03|spaet').addOns, undefined, 'beginnt um 8 Uhr: außerhalb des Fensters')
})

test('Müll-Gang verlängert über 6 Stunden: Pause (30 min) wird nachgezogen', () => {
  const by = instances([object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], bringBack: false })], [task('lang', [1], '08:00', '14:00')])
  const host = by.get('2026-11-02|lang')
  assert.deepEqual([host.endTime, host.duration, host.breakMin, host.net], ['14:10', 370, 30, 340])
})

test('Eigener Müll-Gang: festgelegte Person geht vor der Stammkraft im Objekt', () => {
  const by = instances([object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], responsible: 'e2', bringBack: false })], [task('vormittag', [3], '08:00', '10:00', { regulars: ['e1'] })])
  const own = by.get('2026-11-02|muell-o1-out')
  assert.deepEqual([own.startTime, own.endTime, own.regulars, own.category], ['18:00', '18:10', ['e2'], 'muell'])
  const none = instances([object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], bringBack: false })], [])
  assert.deepEqual(none.get('2026-11-02|muell-o1-out').regulars, [], 'niemand im Objekt: Automatik sucht')
})

// ---------------------------------------------------------------- Abfuhrkalender einlesen

test('Abfuhrkalender (.ics): Sonderzeichen im Titel, mehrere Ausnahmen in einer Zeile', () => {
  const list = parseIcs(cal(['DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;VALUE=DATE:20261110,20261117', 'SUMMARY:Bio\\; Kompost\\nTonne']))
  assert.deepEqual(list.map((e) => e.date), ['2026-11-03', '2026-11-24'], 'COUNT zählt die Ausnahmen mit')
  assert.equal(list[0].summary, 'Bio; Kompost Tonne')
  assert.equal(list[0].type, 'Biomüll')
})

test('Abfuhrkalender (.ics): monatliche Wiederholung nur als erster Termin, ohne Ende höchstens zwei Jahre', () => {
  assert.deepEqual(parseIcs(cal(['DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=MONTHLY;BYDAY=1TU', 'SUMMARY:Glas'])).map((e) => e.date), ['2026-11-03'])
  const endless = parseIcs(cal(['DTSTART;VALUE=DATE:20261103', 'RRULE:FREQ=WEEKLY;INTERVAL=4', 'SUMMARY:Papier']))
  assert.equal(endless.at(-1).date <= '2028-11-03', true)
  assert.equal(endless.length, 27, 'alle 4 Wochen über 731 Tage')
})

test('Abfuhrkalender (.ics): UNTIL in UTC, Termine ohne Datum und kaputte Zeilen werden übersprungen', () => {
  const list = parseIcs(cal(['DTSTART;VALUE=DATE:20261102', 'RRULE:FREQ=DAILY;INTERVAL=7;UNTIL=20261116T225959Z', 'SUMMARY:Restmüll', 'kaputte Zeile ohne Doppelpunkt'], ['SUMMARY:ohne Datum'], ['DTSTART:kein-datum', 'SUMMARY:x']))
  assert.deepEqual(list.map((e) => e.date), ['2026-11-02', '2026-11-09', '2026-11-16'], 'UNTIL 16.11. 23:59 UTC = 17.11. Wien, 16.11. ist dabei')
})

test('Termine im Text: beide Schreibweisen gemischt, ohne Datum leer', () => {
  assert.deepEqual(datesIn('Abfuhr: 3.11.2026; 2026-11-17 und 1.12.2026'), ['2026-11-03', '2026-11-17', '2026-12-01'])
  assert.deepEqual(datesIn('keine Termine'), [])
})

test('Eingefügte Termine: Semikolon trennt, Schaltjahr geprüft, Art aus dem Rest der Zeile', () => {
  const list = parseDateList('29.02.2027 Glas; 29.02.2028 Glas; 1.2.27 Papier; 2026-12-01', 'Restmüll')
  assert.deepEqual(list.map((e) => [e.date, e.type, e.summary]), [['2028-02-29', 'Glas', 'Glas'], ['2027-02-01', 'Altpapier', 'Papier'], ['2026-12-01', 'Restmüll', '']])
})

test('Termine je Tonne: neue Tonne mit eigener Kennung, Termine sortiert', () => {
  const streams = streamsFromEntries([{ date: '2026-12-15', type: 'Glas' }, { date: '2026-12-01', type: 'Glas' }, { date: '2026-12-01', type: 'Glas' }, { date: '2026-11-20', type: 'Sperrmüll' }])
  assert.deepEqual(streams, [
    { id: 'w1gla', type: 'Glas', recurrence: { type: 'dates', dates: ['2026-12-01', '2026-12-15'] } },
    { id: 'w2spe', type: 'Sperrmüll', recurrence: { type: 'dates', dates: ['2026-11-20'] } },
  ])
})
