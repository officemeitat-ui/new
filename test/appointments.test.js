import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addMinutes, appointmentsBetween, conflicts, dayPart, daysOf, employeesOf, graphEvent, inviteList, minutesFrom, outlookState, validateAppointment, whenText } from '../src/core/appointments.js'
import { dayIndex } from '../src/core/dates.js'
import { staffWeek } from '../src/core/staffplan.js'

const emps = [
  { id: 'e1', name: 'Ana', email: 'Ana@Cleanos.at' },
  { id: 'e2', name: 'Markus' },
]

test('Termine: Zeiten rechnen, auch über Mitternacht', () => {
  assert.equal(addMinutes('2026-11-04T23:30', 45), '2026-11-05T00:15')
  assert.equal(minutesFrom('2026-11-04', '2026-11-05T01:00'), 1500)
  assert.deepEqual(dayPart({ start: '2026-11-04T22:00', end: '2026-11-05T02:00' }, '2026-11-05'), { start: 0, end: 120 })
  assert.deepEqual(daysOf({ start: '2026-11-04T10:00', end: '2026-11-05T00:00' }), { from: '2026-11-04', to: '2026-11-04' })
  assert.deepEqual(daysOf({ allDay: true, start: '2026-11-04T00:00', end: '2026-11-06T00:00' }), { from: '2026-11-04', to: '2026-11-06' })
})

test('Termine: Prüfung der Eingaben', () => {
  assert.deepEqual(validateAppointment({ title: 'X', start: '2026-11-04T12:00', end: '2026-11-04T13:00' }), [])
  assert.match(validateAppointment({ title: '', start: '2026-11-04T12:00', end: '2026-11-04T11:00' }).join(' '), /Titel.*Ende liegt vor/)
  assert.match(validateAppointment({ title: 'X', start: '2026-11-04T12:00', end: '2026-11-04T13:00', attendees: [{ email: 'kaputt' }] }).join(), /keine gültige|Keine gültige/i)
  assert.deepEqual(validateAppointment({ title: 'Messe', allDay: true, start: '2026-11-04T00:00', end: '2026-11-04T00:00' }), [])
})

test('Termine: Einladungsliste ohne Doppelte, Mitarbeitende über E-Mail erkannt', () => {
  const a = { attendees: [{ email: 'ana@cleanos.at', name: 'Ana' }, { email: 'hv@x.at', name: 'HV' }], employeeIds: ['e1', 'e2'] }
  assert.deepEqual(inviteList(a, new Map(emps.map((e) => [e.id, e]))).map((x) => x.email), ['ana@cleanos.at', 'hv@x.at'])
  assert.deepEqual(employeesOf({ attendees: [{ email: 'ANA@cleanos.at' }] }, emps), ['e1'])
})

test('Termine: Outlook-Inhalt in Wiener Zeit, ganztägig bis 00:00 des Folgetags', () => {
  const ev = graphEvent({ title: 'Begehung', start: '2026-11-04T12:00', end: '2026-11-04T13:00', employeeIds: ['e1'], online: true, reminder: 30 }, { employeesById: new Map(emps.map((e) => [e.id, e])), location: 'Lehen' })
  assert.deepEqual(ev.start, { dateTime: '2026-11-04T12:00:00', timeZone: 'W. Europe Standard Time' })
  assert.equal(ev.attendees[0].emailAddress.address, 'ana@cleanos.at')
  assert.equal(ev.isOnlineMeeting, true)
  assert.equal(ev.reminderMinutesBeforeStart, 30)
  assert.equal(ev.location.displayName, 'Lehen')
  const all = graphEvent({ title: 'Messe', allDay: true, start: '2026-11-04T00:00', end: '2026-11-05T00:00', reminder: 0 })
  assert.equal(all.isAllDay, true)
  assert.equal(all.end.dateTime, '2026-11-06T00:00:00')
  assert.equal(all.isReminderOn, false)
})

test('Termine: Zeitraum, Konflikte mit Einsätzen, Stand in Outlook', () => {
  const items = [
    { id: 'a', title: 'A', start: '2026-11-04T12:00', end: '2026-11-04T13:00' },
    { id: 'b', title: 'B', start: '2026-11-02T08:00', end: '2026-11-02T09:00', cancelled: true },
    { id: 'c', title: 'C', allDay: true, start: '2026-11-03T00:00', end: '2026-11-05T00:00' },
  ]
  assert.deepEqual(appointmentsBetween(items, '2026-11-04', '2026-11-04').map((a) => a.id), ['c', 'a'])
  const base = dayIndex('2026-11-04') * 1440
  const inst = { start: base + 11 * 60, end: base + 12 * 60 + 30, startTime: '11:00', endTime: '12:30' }
  const found = conflicts(items[0], { employeeIds: ['e1'], instancesOf: () => [inst], dayIndexOf: dayIndex })
  assert.equal(found.length, 1)
  assert.equal(conflicts(items[0], { employeeIds: ['e1'], instancesOf: () => [{ ...inst, end: base + 12 * 60 }], dayIndexOf: dayIndex }).length, 0, 'endet genau zum Beginn')
  assert.equal(outlookState({}), 'offen')
  assert.equal(outlookState({ outlook: { id: 'x' } }), 'ok')
  assert.equal(outlookState({ outlook: { id: 'x', error: 'kein Recht' } }), 'fehler')
  assert.match(whenText(items[0], (d) => d), /2026-11-04 12:00–13:00/)
})

test('Plan am Handy: Termine der Person je Tag', () => {
  const ts = { monday: '2026-11-02', days: [{ date: '2026-11-04', lines: [] }, { date: '2026-11-05', lines: [] }], totals: { ist: 0, soll: 0 } }
  const week = staffWeek(ts, { appointments: [{ id: 'a', title: 'Schulung', start: '2026-11-04T07:00', end: '2026-11-04T08:30', where: 'Büro' }, { id: 'm', title: 'Messe', allDay: true, start: '2026-11-04T00:00', end: '2026-11-05T00:00' }] })
  assert.deepEqual(week.tage[0].termine, [{ id: 'a', titel: 'Schulung', beginn: '07:00', zeit: '07:00–08:30', ort: 'Büro' }, { id: 'm', titel: 'Messe', ganztags: true }])
  assert.deepEqual(week.tage[1].termine, [{ id: 'm', titel: 'Messe', ganztags: true }])
})

import { graphRecurrence, occurrences, repeatText, rruleOf } from '../src/core/appointments.js'

test('Serientermine: wöchentlich, 14-tägig, monatlich, n-ter Wochentag, Ende und Ausnahmen', () => {
  const base = { id: 's1', title: 'Team', start: '2026-11-02T07:00', end: '2026-11-02T08:00' } // Montag
  const weekly = occurrences({ ...base, repeat: { freq: 'weekly', until: '2026-11-30' }, exdates: ['2026-11-16'] }, '2026-11-01', '2026-12-31')
  assert.deepEqual(weekly.map((o) => o.start), ['2026-11-02T07:00', '2026-11-09T07:00', '2026-11-23T07:00', '2026-11-30T07:00'])
  assert.equal(weekly[1].end, '2026-11-09T08:00')
  assert.equal(weekly[1].series, 's1')
  assert.deepEqual(occurrences({ ...base, repeat: { freq: 'biweekly', count: 3 } }, '2026-11-01', '2027-03-01').map((o) => o.occ), ['2026-11-02', '2026-11-16', '2026-11-30'])
  // am 31.: Monate ohne 31. fallen weg
  const m31 = occurrences({ ...base, start: '2026-10-31T09:00', end: '2026-10-31T10:00', repeat: { freq: 'monthly' } }, '2026-10-01', '2027-01-31').map((o) => o.occ)
  assert.deepEqual(m31, ['2026-10-31', '2026-12-31', '2027-01-31'])
  // 1. Dienstag im Monat
  const nth = occurrences({ ...base, start: '2026-11-03T09:00', end: '2026-11-03T10:00', repeat: { freq: 'monthlyNth' } }, '2026-11-01', '2027-02-28').map((o) => o.occ)
  assert.deepEqual(nth, ['2026-11-03', '2026-12-01', '2027-01-05', '2027-02-02'])
  // letzter Montag
  const last = occurrences({ ...base, start: '2026-11-30T09:00', end: '2026-11-30T10:00', repeat: { freq: 'monthlyNth' } }, '2026-11-01', '2027-01-31').map((o) => o.occ)
  assert.deepEqual(last, ['2026-11-30', '2026-12-28', '2027-01-25'])
  // Zeitraum mitten in der Serie
  assert.deepEqual(occurrences({ ...base, repeat: { freq: 'weekly' } }, '2027-06-01', '2027-06-14').map((o) => o.occ), ['2027-06-07', '2027-06-14'])
})

test('Serientermine: Outlook-Serie, RRULE und Text', () => {
  const a = { start: '2026-11-03T09:00', end: '2026-11-03T10:00', repeat: { freq: 'monthlyNth', until: '2027-06-30' } }
  assert.deepEqual(graphRecurrence(a), { pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'first' }, range: { type: 'endDate', startDate: '2026-11-03', endDate: '2027-06-30' } })
  assert.deepEqual(graphRecurrence({ start: '2026-11-02T07:00', repeat: { freq: 'biweekly' } }).pattern, { type: 'weekly', interval: 2, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' })
  assert.equal(graphRecurrence({ start: '2026-11-02T07:00', repeat: { freq: 'weekly', count: 5 } }).range.numberOfOccurrences, 5)
  assert.equal(rruleOf(a), 'FREQ=MONTHLY;BYDAY=1TU;UNTIL=20270630T235959')
  assert.equal(rruleOf({ start: '2026-11-30T09:00', repeat: { freq: 'monthlyNth' } }), 'FREQ=MONTHLY;BYDAY=-1MO')
  assert.equal(repeatText(a, (d) => d), 'jeden 1. Dienstag im Monat bis 2027-06-30')
})
