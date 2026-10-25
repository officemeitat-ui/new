import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'
import { autoPlan } from '../src/core/scheduler.js'
import { buildTimesheet } from '../src/core/timesheet.js'
import { collectionDays, datesIn, parseDateList, parseIcs, rhythmOf, streamsFromEntries, streamText, wasteDuties, wasteRecurrence } from '../src/core/waste.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Teilzeit', weeklyHours: 30, skills: [], trained: [], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })
const weekly = (weekday, everyWeeks = 1, anchor = '2026-11-02') => ({ type: 'weekly', weekdays: [weekday], everyWeeks, anchor })
const object = (waste, extra = {}) => ({ id: 'o1', name: 'Wohnanlage', short: 'Wohnanlage', color: 1, waste, ...extra })

function setup({ employees = [emp('e1')], objects, tasks = [], overrides = {} }) {
  const data = { employees, objects, tasks, absences: [], rules: {}, travel: {}, trips: {}, overrides }
  const holidays = holidayCalendar('2026-10-26', '2026-12-31')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-02', '2026-11-15', holidays, ctx.rules)
  return { data, ctx, instances, byKey: new Map(instances.map((i) => [i.key, i])) }
}

test('Müll: Abfuhrtage aus Rhythmus, Feiertag schiebt auf den nächsten Werktag', () => {
  const holidays = holidayCalendar('2026-11-20', '2026-12-31')
  const o = object({ streams: [{ type: 'Restmüll', recurrence: weekly(2, 1, '2026-12-01') }, { type: 'Altpapier', recurrence: weekly(2, 2, '2026-12-01') }] })
  // 8.12. (Di) ist Mariä Empfängnis: Abholung am Mittwoch
  assert.deepEqual(collectionDays(o, '2026-12-01', '2026-12-16', holidays), [
    { date: '2026-12-01', types: ['Restmüll', 'Altpapier'] },
    { date: '2026-12-09', types: ['Restmüll'] },
    { date: '2026-12-15', types: ['Restmüll', 'Altpapier'] },
  ])
  // Termine aus dem Abfuhrkalender gelten wie angegeben
  const dates = object({ streams: [{ type: 'Glas', recurrence: { type: 'dates', dates: ['2026-12-08', '2026-12-30'] } }] })
  assert.deepEqual(collectionDays(dates, '2026-12-01', '2026-12-31', holidays).map((d) => d.date), ['2026-12-08', '2026-12-30'])
})

test('Müll: rausstellen am Vorabend oder in der Früh, reinstellen optional', () => {
  const holidays = holidayCalendar('2026-10-26', '2026-11-30')
  const streams = [{ type: 'Restmüll', recurrence: weekly(2) }]
  const vortag = wasteDuties([object({ streams })], '2026-11-02', '2026-11-08', holidays)
  assert.deepEqual(vortag.map((d) => [d.action, d.date, d.window]), [['out', '2026-11-02', 'out-vortag'], ['in', '2026-11-03', 'in']])
  const frueh = wasteDuties([object({ streams, outWhen: 'abholtag', bringBack: false })], '2026-11-02', '2026-11-08', holidays)
  assert.deepEqual(frueh.map((d) => [d.action, d.date, d.window]), [['out', '2026-11-03', 'out-abholtag']])
  // Abholung am Montag: rausstellen am Sonntag davor gehört noch in die Woche
  const montag = wasteDuties([object({ streams: [{ type: 'Biomüll', recurrence: weekly(1) }] })], '2026-11-02', '2026-11-08', holidays)
  assert.deepEqual(montag.filter((d) => d.action === 'out').map((d) => d.date), ['2026-11-08'])
})

test('Müll: Gang läuft mit einem Einsatz im Objekt mit, sonst eigener Gang', () => {
  const { byKey } = setup({
    objects: [object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], note: 'Müllraum im Hof' })],
    tasks: [task('abend', 'o1', [1], '17:00', '19:00', { regulars: ['e1'] })],
  })
  const host = byKey.get('2026-11-02|abend')
  assert.equal(host.addOns.length, 1)
  assert.equal(host.endTime, '19:10')
  assert.equal(host.net, 130)
  const own = byKey.get('2026-11-03|muell-o1-in')
  assert.equal(own.category, 'muell')
  assert.equal(`${own.startTime}–${own.endTime}`, '13:00–13:10')
  assert.equal(own.label, 'Müll reinstellen: Restmüll')
  assert.deepEqual(own.regulars, ['e1'])
})

test('Müll: Einsatz mit zwei Personen oder außerhalb des Zeitfensters bekommt den Gang nicht', () => {
  const { byKey } = setup({
    objects: [object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }], bringBack: false })],
    tasks: [task('team', 'o1', [1], '17:00', '19:00', { staff: 2 }), task('frueh', 'o1', [1], '06:00', '08:00')],
  })
  assert.equal(byKey.get('2026-11-02|team').addOns, undefined)
  assert.equal(byKey.get('2026-11-02|frueh').addOns, undefined)
  assert.equal(byKey.get('2026-11-02|muell-o1-out').startTime, '18:00')
})

test('Müll: eigener Gang lässt sich wie jeder Einsatz absagen oder verschieben', () => {
  const objects = [object({ streams: [{ type: 'Restmüll', recurrence: weekly(2) }] })]
  const { byKey } = setup({ objects, overrides: { '2026-11-03|muell-o1-in': { cancelled: true }, '2026-11-02|muell-o1-out': { start: '19:30', end: '19:40' } } })
  assert.equal(byKey.get('2026-11-03|muell-o1-in').status, 'cancelled')
  assert.equal(byKey.get('2026-11-02|muell-o1-out').startTime, '19:30')
})

test('Müll: Automatik teilt eigene Gänge einer verfügbaren Stammkraft zu, Wochenzettel zeigt den Gang', () => {
  const employees = [
    emp('e1', { availability: { 2: { from: '06:00', to: '20:00' } } }),
    emp('e2', { availability: { 1: { from: '06:00', to: '20:00' }, 4: { from: '06:00', to: '20:00' } } }),
    emp('e3'),
  ]
  const tasks = [task('vormittag', 'o1', [2], '08:00', '11:00', { regulars: ['e1'] }), task('mo', 'o1', [1], '17:00', '19:00', { regulars: ['e2'] }), task('do', 'o1', [4], '09:00', '11:00', { regulars: ['e2'] })]
  const { data, ctx, instances, byKey } = setup({ employees, tasks, objects: [object({ streams: [{ type: 'Restmüll', recurrence: weekly(3) }], note: 'Tonnen an den Gehsteig' })] })
  // Abholung Mi: rausstellen Di 18:00 (eigener Gang). e2 ist öfter im Objekt, aber Di nicht verfügbar → e1
  const out = byKey.get('2026-11-03|muell-o1-out')
  assert.deepEqual(out.regulars, ['e1'])
  const res = autoPlan(ctx, instances, {}, { from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(res.assignments['2026-11-03|muell-o1-out'].map((a) => a.employeeId), ['e1'])
  const sheet = buildTimesheet(ctx, data.employees[0], '2026-11-02', instances, new PlanState(instances, res.assignments))
  const line = sheet.days[1].lines.find((l) => l.text.includes('Müll rausstellen'))
  assert.ok(line, 'Müll-Gang im Wochenzettel')
  assert.ok(line.notes.includes('Tonnen an den Gehsteig'))
})

test('Müll: Abfuhrkalender als .ics (gefaltete Zeilen) und als eingefügte Termine', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261103', 'SUMMARY:Restabfall Haus', ' halt', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261105T060000', 'SUMMARY:Altpapier\\, Karton', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261110', 'SUMMARY:Gelber Sack', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  assert.deepEqual(parseIcs(ics), [
    { date: '2026-11-03', summary: 'Restabfall Haushalt', type: 'Restmüll' },
    { date: '2026-11-05', summary: 'Altpapier, Karton', type: 'Altpapier' },
    { date: '2026-11-10', summary: 'Gelber Sack', type: 'Leichtverpackung' },
  ])
  const list = parseDateList('03.11.2026 Restmüll\n2026-11-17 Biotonne\n5.11.2026\n\nkein Termin', 'Glas')
  assert.deepEqual(list.map((e) => [e.date, e.type]), [['2026-11-03', 'Restmüll'], ['2026-11-17', 'Biomüll'], ['2026-11-05', 'Glas']])
  // Terminliste im Formular: durch Komma getrennt
  assert.deepEqual(datesIn('29.10.2026, 12.11.2026,2026-11-26'), ['2026-10-29', '2026-11-12', '2026-11-26'])
})

test('Müll: Termine werden je Tonne gesammelt, ohne Doppelte', () => {
  const existing = [{ id: 'w1', type: 'Restmüll', recurrence: { type: 'dates', dates: ['2026-11-17'] } }, { id: 'w2', type: 'Biomüll', recurrence: weekly(3) }]
  const streams = streamsFromEntries([{ date: '2026-11-03', type: 'Restmüll' }, { date: '2026-11-17', type: 'Restmüll' }, { date: '2026-11-05', type: 'Altpapier' }], existing)
  assert.deepEqual(streams.map((s) => [s.type, s.recurrence.type, s.recurrence.dates]), [
    ['Restmüll', 'dates', ['2026-11-03', '2026-11-17']],
    ['Biomüll', 'weekly', undefined],
    ['Altpapier', 'dates', ['2026-11-05']],
  ])
  assert.deepEqual(existing[0].recurrence.dates, ['2026-11-17'], 'Eingabe bleibt unverändert')
})

test('Müll: Rhythmus aus der Eingabe und zurück', () => {
  const r14 = wasteRecurrence('w2', '2026-11-03')
  assert.deepEqual(r14, { type: 'weekly', weekdays: [2], everyWeeks: 2, anchor: '2026-11-03' })
  assert.deepEqual(rhythmOf({ recurrence: r14 }), { rhythm: 'w2', ref: '2026-11-03', dates: [] })
  const last = wasteRecurrence('m1', '2026-11-30')
  assert.equal(last.nth, -1)
  assert.equal(last.weekday, 1)
  assert.equal(streamText({ type: 'Altpapier', recurrence: last }), 'Altpapier monatlich, letzter Mo')
  assert.equal(streamText({ type: 'Restmüll', recurrence: r14 }), 'Restmüll 14-tägig Di')
  assert.equal(streamText({ type: 'Glas', recurrence: { type: 'dates', dates: ['2026-11-03'] } }), 'Glas: 1 Termin')
  assert.deepEqual(wasteRecurrence('dates', '', ['2026-11-17', '2026-11-03', '2026-11-17']), { type: 'dates', dates: ['2026-11-03', '2026-11-17'] })
})
