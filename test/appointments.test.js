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
