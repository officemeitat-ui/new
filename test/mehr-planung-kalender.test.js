import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, dayIndex, daysInMonth, dstMinutes, eachDay, formatDate, formatHours, formatTime, isoWeek, isoWeekday, lastOfMonth, mondayOf, MONTH_LONG, monthsBetween, parseDate, parseMonth, toMinutes, weeksBetween } from '../src/core/dates.js'
import { austrianHolidays, easterSunday, holidayCalendar, holidaysInRange } from '../src/core/holidays.js'
import { NTH_LABEL, nextWorkday, taskOccursOn } from '../src/core/recurrence.js'

const at = (date, hh, mm = 0) => dayIndex(date) * 1440 + hh * 60 + mm
const occurrences = (recurrence, from, to) => eachDay(from, to).filter((d) => taskOccursOn({ recurrence }, d))
const byName = (year) => Object.fromEntries(austrianHolidays(year).map((h) => [h.name, h.date]))

// ---------------------------------------------------------------- Feiertage

test('Ostersonntag: Referenzdaten über zwei Jahrzehnte (frühester und spätester Termin)', () => {
  const ref = { 2008: '2008-03-23', 2011: '2011-04-24', 2016: '2016-03-27', 2019: '2019-04-21', 2020: '2020-04-12', 2021: '2021-04-04', 2022: '2022-04-17', 2023: '2023-04-09', 2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21', 2035: '2035-03-25', 2038: '2038-04-25' }
  for (const [year, date] of Object.entries(ref)) assert.equal(easterSunday(Number(year)), date, `Ostern ${year}`)
  // Ostersonntag ist immer ein Sonntag zwischen 22.3. und 25.4.
  for (let y = 2000; y <= 2060; y++) {
    const e = easterSunday(y)
    assert.equal(isoWeekday(e), 7, e)
    assert.ok(e >= `${y}-03-22` && e <= `${y}-04-25`, e)
  }
})

const MOVABLE = {
  2024: ['2024-04-01', '2024-05-09', '2024-05-20', '2024-05-30'],
  2025: ['2025-04-21', '2025-05-29', '2025-06-09', '2025-06-19'],
  2027: ['2027-03-29', '2027-05-06', '2027-05-17', '2027-05-27'],
  2028: ['2028-04-17', '2028-05-25', '2028-06-05', '2028-06-15'],
  2030: ['2030-04-22', '2030-05-30', '2030-06-10', '2030-06-20'],
}
for (const [year, [om, ch, pm, fl]] of Object.entries(MOVABLE)) {
  test(`Bewegliche Feiertage ${year}: Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam`, () => {
    const h = byName(Number(year))
    assert.deepEqual([h.Ostermontag, h['Christi Himmelfahrt'], h.Pfingstmontag, h.Fronleichnam], [om, ch, pm, fl])
    assert.equal(isoWeekday(h.Ostermontag), 1)
    assert.equal(isoWeekday(h['Christi Himmelfahrt']), 4)
    assert.equal(isoWeekday(h.Pfingstmontag), 1)
    assert.equal(isoWeekday(h.Fronleichnam), 4)
  })
}

test('Feiertage 2027: 13 gesetzliche Tage, sortiert; kein Karfreitag, kein Hl. Rupert, kein Heiliger Abend', () => {
  const list = austrianHolidays(2027)
  assert.equal(list.length, 13)
  assert.ok(list.every((h) => h.legal === true))
  assert.deepEqual(list.map((h) => h.date), [...list.map((h) => h.date)].sort())
  const dates = new Set(list.map((h) => h.date))
  assert.ok(!dates.has(addDays(easterSunday(2027), -2)), 'Karfreitag seit 2019 kein Feiertag')
  assert.ok(!dates.has('2027-09-24'), 'Landespatron Salzburg ist kein gesetzlicher Feiertag')
  assert.ok(!dates.has('2027-12-24') && !dates.has('2027-12-31'))
  const h = byName(2027)
  assert.deepEqual([h.Neujahr, h['Heilige Drei Könige'], h.Staatsfeiertag, h['Mariä Himmelfahrt'], h.Nationalfeiertag, h.Allerheiligen, h['Mariä Empfängnis'], h.Christtag, h.Stefanitag], ['2027-01-01', '2027-01-06', '2027-05-01', '2027-08-15', '2027-10-26', '2027-11-01', '2027-12-08', '2027-12-25', '2027-12-26'])
})

test('Feiertagskalender über den Jahreswechsel: Christtag, Stefanitag, Neujahr, Hl. Drei Könige', () => {
  const cal = holidayCalendar('2026-12-20', '2027-01-10')
  assert.deepEqual([...cal.keys()].sort(), ['2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06'])
  assert.equal(cal.get('2027-01-06').name, 'Heilige Drei Könige')
  assert.ok(!cal.has('2026-12-08'), 'außerhalb des Zeitraums')
})

test('Betriebsfreie Tage (z. B. Hl. Rupert in Salzburg): ohne Feiertagsstatus, überschreiben keinen gesetzlichen Feiertag', () => {
  const extra = [
    { date: '2026-09-24', name: 'Hl. Rupert (Landespatron)' },
    { date: '2026-12-25', name: 'Betrieb geschlossen' },
    { date: '2026-12-31', name: 'Silvester' },
    { date: '2027-02-01', name: 'außerhalb' },
  ]
  const cal = holidayCalendar('2026-09-01', '2026-12-31', extra)
  assert.deepEqual(cal.get('2026-09-24'), { date: '2026-09-24', name: 'Hl. Rupert (Landespatron)', legal: false })
  assert.deepEqual([cal.get('2026-12-25').name, cal.get('2026-12-25').legal], ['Christtag', true])
  assert.ok(!cal.has('2027-02-01'))
  const list = holidaysInRange('2026-12-20', '2027-01-02', extra)
  assert.deepEqual(list.map((h) => [h.date, h.legal]), [['2026-12-25', true], ['2026-12-26', true], ['2026-12-31', false], ['2027-01-01', true]])
})

// ---------------------------------------------------------------- Datumshilfen

test('ISO-Kalenderwoche am Jahreswechsel (2026 hat 53 Wochen)', () => {
  const cases = [
    ['2026-01-01', 2026, 1],
    ['2026-12-28', 2026, 53],
    ['2026-12-31', 2026, 53],
    ['2027-01-03', 2026, 53],
    ['2027-01-04', 2027, 1],
    ['2024-12-30', 2025, 1],
    ['2021-01-03', 2020, 53],
  ]
  for (const [date, year, week] of cases) assert.deepEqual(isoWeek(date), { year, week }, date)
})

test('Wochentag und Montag der Woche, auch über den Jahreswechsel', () => {
  assert.equal(isoWeekday('2026-11-08'), 7)
  assert.equal(isoWeekday('2026-11-02'), 1)
  assert.equal(mondayOf('2026-11-02'), '2026-11-02')
  assert.equal(mondayOf('2026-11-08'), '2026-11-02')
  assert.equal(mondayOf('2027-01-03'), '2026-12-28')
  assert.equal(mondayOf('2028-03-01'), '2028-02-28')
})

test('Tage addieren, Monatsende und Schaltjahre (2000 ja, 2100 nein)', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2027-02-28', 1), '2027-03-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addDays('2026-03-28', 2), '2026-03-30', 'Zeitumstellung ändert nichts am Datum')
  assert.equal(addDays('2026-01-01', 365), '2027-01-01')
  assert.equal(lastOfMonth('2028-02-10'), '2028-02-29')
  assert.equal(lastOfMonth('2026-04-30'), '2026-04-30')
  assert.deepEqual([daysInMonth('2000-02-01'), daysInMonth('2100-02-01'), daysInMonth('2026-12-15')], [29, 28, 31])
})

test('Zeiträume: eachDay inklusive, Wochen und Monate dazwischen', () => {
  assert.deepEqual(eachDay('2028-02-27', '2028-03-01'), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01'])
  assert.deepEqual(eachDay('2026-11-05', '2026-11-04'), [])
  assert.equal(weeksBetween('2026-10-26', '2026-11-08'), 1)
  assert.equal(weeksBetween('2026-11-08', '2026-11-09'), 1, 'Sonntag → Montag ist die nächste Woche')
  assert.equal(weeksBetween('2026-11-09', '2026-11-02'), -1)
  assert.equal(weeksBetween('2026-12-28', '2027-01-04'), 1)
  assert.equal(monthsBetween('2026-11-30', '2027-02-01'), 3)
  assert.equal(monthsBetween('2027-02-01', '2026-11-30'), -3)
})

test('Uhrzeiten und Stunden im österreichischen Format', () => {
  assert.deepEqual([toMinutes('7'), toMinutes('07:30'), toMinutes('24:00')], [420, 450, 1440])
  assert.deepEqual([formatTime(0), formatTime(1500), formatTime(-30), formatTime(2 * 1440 + 75)], ['00:00', '01:00', '23:30', '01:15'])
  assert.deepEqual([formatHours(450), formatHours(20), formatHours(600), formatHours(659)], ['7,5', '0,33', '10', '10,98'])
})

test('Datumstext: Wochentag, Jahr, österreichische Monatsnamen', () => {
  assert.equal(formatDate('2026-11-03'), 'Di 03.11.')
  assert.equal(formatDate('2026-11-03', { year: true }), 'Di 03.11.2026')
  assert.equal(formatDate('2026-11-03', { weekday: false, year: true }), '03.11.2026')
  assert.equal(MONTH_LONG[0], 'Jänner')
  assert.equal(MONTH_LONG[11], 'Dezember')
})

test('Monat und Datum aus Eingaben lesen', () => {
  const months = [['03/2027', '2027-03'], ['3.2027', '2027-03'], ['15.03.2027', '2027-03'], ['2027-3', '2027-03'], ['2027-03-15', '2027-03'], ['13/2027', ''], ['', ''], [null, '']]
  for (const [input, out] of months) assert.equal(parseMonth(input), out, String(input))
  const dates = [['15.03.2027', '2027-03-15'], ['1.3.2027', '2027-03-01'], [' 2027-03-15 ', '2027-03-15'], ['2027-3-1', ''], ['15.03.27', ''], [undefined, '']]
  for (const [input, out] of dates) assert.equal(parseDate(input), out, String(input))
})

test('Zeitumstellung: Korrektur nur, wenn die Spanne die Umstellung ganz enthält', () => {
  // 2026: 29.3. (Sommerzeit) und 25.10.; 2027: 28.3. und 31.10.
  assert.equal(dstMinutes(at('2026-03-28', 22), at('2026-03-29', 6)), -60)
  assert.equal(dstMinutes(at('2027-10-30', 22), at('2027-10-31', 6)), 60)
  assert.equal(dstMinutes(at('2027-10-23', 22), at('2027-10-24', 6)), 0, 'eine Woche vor der Umstellung')
  assert.equal(dstMinutes(at('2026-03-29', 1), at('2026-03-29', 2, 30)), 0, 'endet vor 03:00')
  assert.equal(dstMinutes(at('2026-03-29', 3), at('2026-03-29', 8)), 0, 'beginnt nach der Umstellung')
  assert.equal(dstMinutes(at('2026-01-01', 0), at('2026-12-31', 0)), 0, 'ganzes Jahr: hebt sich auf')
  assert.equal(dstMinutes(at('2026-03-01', 0), at('2027-04-01', 0)), -60, 'zwei Frühjahre, ein Herbst')
  assert.equal(dstMinutes(at('2026-03-29', 6), at('2026-03-28', 22)), 0, 'umgekehrte Spanne')
})

// ---------------------------------------------------------------- Rhythmen

test('Rhythmus: letzter Freitag im Monat', () => {
  assert.equal(NTH_LABEL[-1], 'letzter')
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'nth', nth: -1, weekday: 5 }, '2026-11-01', '2027-01-31'), ['2026-11-27', '2026-12-25', '2027-01-29'])
})

test('Rhythmus: erster Samstag monatlich, zweiter Freitag quartalsweise ab dem Anker', () => {
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'nth', nth: 1, weekday: 6, everyMonths: 1, anchor: '2026-11-01' }, '2026-11-01', '2027-01-31'), ['2026-11-07', '2026-12-05', '2027-01-02'])
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'nth', nth: 2, weekday: 5, everyMonths: 3, anchor: '2026-11-01' }, '2026-11-01', '2027-05-31'), ['2026-11-13', '2027-02-12', '2027-05-14'])
})

test('Rhythmus: „am 31.“ fällt auf den letzten Tag kürzerer Monate (auch 29.2.)', () => {
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'day', day: 31 }, '2027-01-01', '2027-04-30'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'day', day: 31 }, '2028-02-01', '2028-02-29'), ['2028-02-29'])
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'day', day: 15, everyMonths: 3, anchor: '2026-01-01' }, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
})

test('Rhythmus: alle 3 Wochen, auch in Wochen vor dem Anker', () => {
  const r = { type: 'weekly', weekdays: [1], everyWeeks: 3, anchor: '2026-11-02' }
  assert.deepEqual(occurrences(r, '2026-10-01', '2026-12-31'), ['2026-10-12', '2026-11-02', '2026-11-23', '2026-12-14'])
  // ohne Anker gilt der Beginn (from) als Anker
  assert.deepEqual(occurrences({ type: 'weekly', weekdays: [3], everyWeeks: 2, from: '2026-11-04' }, '2026-10-01', '2026-12-06'), ['2026-11-04', '2026-11-18', '2026-12-02'])
})

test('Rhythmus: Beginn und Ende (from/until) gelten einschließlich, auch monatlich', () => {
  assert.deepEqual(occurrences({ type: 'weekly', weekdays: [1, 4], from: '2026-11-05', until: '2026-11-16' }, '2026-11-01', '2026-11-30'), ['2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16'])
  assert.deepEqual(occurrences({ type: 'monthly', mode: 'day', day: 1, from: '2026-12-01', until: '2027-02-01' }, '2026-11-01', '2027-03-31'), ['2026-12-01', '2027-01-01', '2027-02-01'])
  assert.deepEqual(occurrences({ type: 'once', date: '2026-11-18' }, '2026-11-01', '2026-11-30'), ['2026-11-18'])
})

test('Nächster Werktag: über Wochenende, Feiertage und betriebsfreie Tage', () => {
  const xmas = holidayCalendar('2026-12-01', '2027-01-31')
  assert.equal(nextWorkday('2026-11-06', new Map()), '2026-11-09')
  assert.equal(nextWorkday('2026-12-24', xmas), '2026-12-28', 'Christtag Fr, Stefanitag Sa, Sonntag')
  assert.equal(nextWorkday('2026-12-24', holidayCalendar('2026-12-01', '2027-01-31', [{ date: '2026-12-28', name: 'Betriebsurlaub' }])), '2026-12-29')
  assert.equal(nextWorkday('2026-04-03', holidayCalendar('2026-04-01', '2026-04-30')), '2026-04-07', 'Ostermontag übersprungen')
  assert.equal(nextWorkday('2027-01-05', xmas), '2027-01-07', 'Hl. Drei Könige (Mi) übersprungen')
})
