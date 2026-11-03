import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, dayIndex } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, clockTime, DEFAULT_HOLIDAY_RULE, PlanState } from '../src/core/plan.js'
import { mergeRules } from '../src/core/rules.js'

const OBJECTS = [{ id: 'o1', name: 'Bürohaus Itzling' }, { id: 'o2', name: 'Praxis Aigen' }]
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], ...extra })

function build(tasks, from, to, { overrides = {}, extraFreeDays = [], rules = {}, objects = OBJECTS } = {}) {
  const holidays = holidayCalendar(addDays(from, -7), addDays(to, 14), extraFreeDays)
  const list = buildInstances({ objects, tasks, overrides }, from, to, holidays, mergeRules(rules))
  return { list, byKey: new Map(list.map((i) => [i.key, i])) }
}
const minuteOf = (date, time) => dayIndex(date) * 1440 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

test('Feiertag „verschieben“: Christtag (Fr) → Montag, Stefanitag und Sonntag übersprungen, Schlüssel bleibt', () => {
  const { byKey } = build([task('t', [5], '17:00', '19:00', { holidayRule: 'verschieben' })], '2026-12-21', '2026-12-27')
  const inst = byKey.get('2026-12-25|t')
  assert.deepEqual([inst.origDate, inst.date, inst.weekday, inst.status, inst.reason], ['2026-12-25', '2026-12-28', 1, 'moved', 'holiday'])
  assert.equal(inst.origHoliday.name, 'Christtag')
  assert.equal(inst.holiday, null, 'am neuen Tag kein Feiertag')
  assert.equal(inst.start, minuteOf('2026-12-28', '17:00'))
})

test('Feiertag „verschieben“ am Sonntag (Allerheiligen 2026): Montag, dann kein Sonntagseinsatz mehr', () => {
  const { byKey } = build([task('so', [7], '08:00', '10:00', { holidayRule: 'verschieben' })], '2026-10-26', '2026-11-01')
  const inst = byKey.get('2026-11-01|so')
  assert.deepEqual([inst.date, inst.status, inst.isSunday, inst.weekday], ['2026-11-02', 'moved', false, 1])
})

test(`Feiertag ohne Einstellung: Leistung findet statt (Standard „${DEFAULT_HOLIDAY_RULE}“), Feiertag und Sonntag markiert`, () => {
  const { byKey } = build([task('t', [5, 7], '08:00', '10:00')], '2026-04-27', '2026-05-03')
  const fr = byKey.get('2026-05-01|t')
  assert.deepEqual([fr.status, fr.reason, fr.holiday.name, fr.holiday.legal, fr.isSunday], ['normal', null, 'Staatsfeiertag', true, false])
  const so = byKey.get('2026-05-03|t')
  assert.deepEqual([so.isSunday, so.holiday], [true, null])
})

test('Betriebsfreier Tag: Einsätze entfallen unabhängig von der Feiertagsregel, „trotzdem stattfinden“ geht vor', () => {
  const extraFreeDays = [{ date: '2026-12-24', name: 'Heiliger Abend (betriebsfrei)' }]
  const tasks = [task('statt', [4], '08:00', '10:00', { holidayRule: 'findet_statt' }), task('versch', [4], '10:00', '12:00', { holidayRule: 'verschieben' })]
  const closed = build(tasks, '2026-12-21', '2026-12-27', { extraFreeDays })
  for (const key of ['2026-12-24|statt', '2026-12-24|versch']) {
    const i = closed.byKey.get(key)
    assert.deepEqual([i.status, i.reason, i.date, i.origHoliday.legal], ['cancelled', 'holiday', '2026-12-24', false], key)
  }
  const open = build(tasks, '2026-12-21', '2026-12-27', { extraFreeDays, overrides: { '2026-12-24|versch': { work: true } } })
  assert.equal(open.byKey.get('2026-12-24|versch').status, 'normal')
  assert.equal(open.byKey.get('2026-12-24|statt').status, 'cancelled')
})

test('Einmalige Leistung am Feiertag: Feiertagsregel gilt nicht, Einsatz bleibt', () => {
  const once = { ...task('gr', [], '08:00', '14:00', { holidayRule: 'entfaellt' }), recurrence: { type: 'once', date: '2026-12-08' } }
  const { list } = build([once], '2026-12-07', '2026-12-13')
  assert.equal(list.length, 1)
  assert.deepEqual([list[0].status, list[0].holiday.name], ['normal', 'Mariä Empfängnis'])
})

test('Einzeländerungen: verschieben, zurück auf den Tag, absagen, andere Zeit, Notiz', () => {
  const overrides = {
    '2026-11-03|a': { date: '2026-11-05', note: 'Kunde wünscht Donnerstag' },
    '2026-11-10|a': { date: '2026-11-10' },
    '2026-11-17|a': { cancelled: true },
    '2026-11-24|a': { start: '07:15', end: '09:45' },
  }
  const { byKey } = build([task('a', [2], '08:00', '10:00')], '2026-11-02', '2026-11-29', { overrides })
  const moved = byKey.get('2026-11-03|a')
  assert.deepEqual([moved.date, moved.weekday, moved.status, moved.reason, moved.note], ['2026-11-05', 4, 'moved', 'manual', 'Kunde wünscht Donnerstag'])
  assert.equal(moved.start, minuteOf('2026-11-05', '08:00'))
  assert.deepEqual([byKey.get('2026-11-10|a').status, byKey.get('2026-11-10|a').reason], ['normal', null])
  assert.deepEqual([byKey.get('2026-11-17|a').status, byKey.get('2026-11-17|a').reason], ['cancelled', 'manual'])
  const retimed = byKey.get('2026-11-24|a')
  assert.deepEqual([retimed.startTime, retimed.endTime, retimed.duration, retimed.timeChanged, retimed.baseStart, retimed.status], ['07:15', '09:45', 150, true, '08:00', 'normal'])
  assert.equal(byKey.get('2026-11-10|a').timeChanged, false)
})

test('Einzeländerung auf einem schon wegen Feiertag verschobenen Einsatz: Grund bleibt „Feiertag“', () => {
  const overrides = { '2026-12-25|t': { date: '2026-12-28', start: '06:00' } }
  const { byKey } = build([task('t', [5], '08:00', '10:00', { holidayRule: 'verschieben' })], '2026-12-21', '2026-12-27', { overrides })
  const inst = byKey.get('2026-12-25|t')
  assert.deepEqual([inst.date, inst.status, inst.reason, inst.startTime, inst.timeChanged], ['2026-12-28', 'moved', 'holiday', '06:00', true])
})

test('Uhrzeiten aus Daten: gültig normalisiert, Ungültiges fällt auf den Ersatzwert zurück', () => {
  const cases = [['7:05', '07:05'], [' 9:30 ', '09:30'], ['24:00', '24:00'], ['00:00', '00:00'], ['24:01', 'X'], ['25:00', 'X'], ['12:60', 'X'], ['9:5', 'X'], ['abc', 'X'], [null, 'X'], ['08:00:00', 'X']]
  for (const [input, out] of cases) assert.equal(clockTime(input, 'X'), out, String(input))
  // manipulierte Zeit im Einzeländerungs-Eintrag: die Zeit der Leistung bleibt
  const { byKey } = build([task('a', [2], '08:00', '10:00')], '2026-11-02', '2026-11-08', { overrides: { '2026-11-03|a': { start: '8 Uhr' } } })
  assert.equal(byKey.get('2026-11-03|a').startTime, '08:00')
})

test('Nachtdienst über Mitternacht: gehört zum Beginntag, Ende am Folgetag', () => {
  const { byKey } = build([task('n', [2], '22:00', '02:00')], '2026-11-02', '2026-11-08')
  const n = byKey.get('2026-11-03|n')
  assert.deepEqual([n.date, n.start, n.end - n.start, n.duration, n.breakMin, n.net], ['2026-11-03', minuteOf('2026-11-03', '22:00'), 240, 240, 0, 240])
})

test('Nachtdienst in der Nacht der Zeitumstellung: März eine Stunde weniger, Oktober eine mehr (inkl. Pause)', () => {
  const march = build([task('n', [6], '22:00', '06:00'), task('tag', [7], '08:00', '12:00')], '2027-03-22', '2027-03-28')
  const m = march.byKey.get('2027-03-27|n')
  assert.deepEqual([m.duration, m.breakMin, m.net], [420, 30, 390], '8 h Wanduhr = 7 h echt, über 6 h: 30 min Pause')
  assert.equal(march.byKey.get('2027-03-28|tag').duration, 240, 'Tagdienst nach der Umstellung unverändert')
  const oct = build([task('n', [6], '22:00', '06:00')], '2026-10-19', '2026-10-25').byKey.get('2026-10-24|n')
  assert.deepEqual([oct.duration, oct.net], [540, 510])
})

test('Pause (§ 11 AZG): erst über 6 h, eigene längere Pause der Leistung zählt, einstellbare Grenze', () => {
  const tasks = [
    task('sieben', [1], '08:00', '15:00', { breakMin: 45 }),
    task('vier', [2], '08:00', '12:00', { breakMin: 15 }),
    task('knapp', [3], '08:00', '14:01'),
    task('sechs', [4], '08:00', '14:00'),
  ]
  const { byKey } = build(tasks, '2026-11-02', '2026-11-08')
  const net = (k) => [byKey.get(k).breakMin, byKey.get(k).net]
  assert.deepEqual(net('2026-11-02|sieben'), [45, 375])
  assert.deepEqual(net('2026-11-03|vier'), [15, 225], 'vereinbarte Pause gilt auch bei kurzen Einsätzen')
  assert.deepEqual(net('2026-11-04|knapp'), [30, 331])
  assert.deepEqual(net('2026-11-05|sechs'), [0, 360])
  const later = build([task('sieben', [1], '08:00', '15:00')], '2026-11-02', '2026-11-08', { rules: { breakAfterH: 8 } })
  assert.deepEqual([later.list[0].breakMin, later.list[0].net], [0, 420])
})

test('Einsatzfelder: Vorgaben für Personen, Kategorie, Fahrt nach dem Einsatz, Arbeit im Freien', () => {
  const tasks = [
    { id: 'roh', objectId: 'o1', recurrence: { type: 'weekly', weekdays: [2] }, start: '08:00', end: '09:00' },
    task('aussen', [3], '08:00', '09:00', { staff: 2, category: 'sonder', outdoor: true, travelAfterMin: 0, travelNote: 'Fußweg', skills: ['Glasreinigung'], regulars: ['e1'] }),
  ]
  const { byKey } = build(tasks, '2026-11-02', '2026-11-08')
  const roh = byKey.get('2026-11-03|roh')
  assert.deepEqual([roh.staff, roh.category, roh.skills, roh.regulars, roh.travelAfterMin, roh.outdoor, roh.travelNote], [1, 'reinigung', [], [], null, false, ''])
  const aussen = byKey.get('2026-11-04|aussen')
  assert.deepEqual([aussen.staff, aussen.category, aussen.outdoor, aussen.travelAfterMin, aussen.travelNote, aussen.skills, aussen.regulars], [2, 'sonder', true, 0, 'Fußweg', ['Glasreinigung'], ['e1']])
})

test('Einsätze: monatliche Leistung im Zeitraum, Leistung ohne bekanntes Objekt wird übersprungen', () => {
  const tasks = [
    { ...task('gr', [], '08:00', '13:00'), recurrence: { type: 'monthly', mode: 'nth', nth: 1, weekday: 6, everyMonths: 1, anchor: '2026-11-01' } },
    task('weg', [1, 2, 3, 4, 5], '08:00', '09:00', { objectId: 'gibt-es-nicht' }),
  ]
  const { list } = build(tasks, '2026-11-01', '2026-11-30')
  assert.deepEqual(list.map((i) => i.key), ['2026-11-07|gr'])
})

test('Planungszustand: zuteilen, fixieren, freigeben; abgesagte Einsätze zählen nicht', () => {
  const { list } = build([task('a', [2], '08:00', '10:00'), task('b', [3], '08:00', '10:00')], '2026-11-02', '2026-11-08', { overrides: { '2026-11-04|b': { cancelled: true } } })
  const input = { '2026-11-03|a': [{ employeeId: 'x' }] }
  const st = new PlanState(list, input)
  st.assign('x', '2026-11-03|a')
  st.assign('y', '2026-11-03|a', true)
  assert.equal(st.count('2026-11-03|a'), 2, 'doppelte Zuteilung wird ignoriert')
  assert.ok(st.isLocked('y', '2026-11-03|a') && !st.isLocked('x', '2026-11-03|a'))
  st.setLocked('x', '2026-11-03|a', true)
  assert.ok(st.isLocked('x', '2026-11-03|a'))
  assert.deepEqual(input['2026-11-03|a'], [{ employeeId: 'x' }], 'Eingabe bleibt unverändert')

  st.assign('x', '2026-11-04|b')
  assert.ok(st.has('x', '2026-11-04|b'))
  assert.deepEqual(st.instancesOf('x').map((i) => i.key), ['2026-11-03|a'], 'abgesagter Einsatz zählt nicht für die Person')

  st.unassign('y', '2026-11-03|a')
  st.unassign('x', '2026-11-04|b')
  assert.deepEqual(st.toObject(), { '2026-11-03|a': [{ employeeId: 'x', locked: true }] })
  st.unassign('x', '2026-11-03|a')
  assert.deepEqual([st.toObject(), st.instancesOf('x'), st.assigned('2026-11-03|a')], [{}, [], []])
})
