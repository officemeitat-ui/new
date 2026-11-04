// Regressionstests für Befunde aus den Testläufen (Schnee-Alarm, Reklamationen, Leistungsnachweis,
// Import, Winterdienst-Fotos).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alarmFile } from '../src/core/weather.js'
import { dayOf, daysToDone } from '../src/core/complaints.js'
import { proofFor } from '../src/core/proof.js'
import { PlanState } from '../src/core/plan.js'
import { parseWeekdays } from '../src/core/importer.js'
import { photoPath } from '../src/core/winterlog.js'
import { absMinutes } from '../src/core/timeclock.js'

test('Schnee-Alarm: ausgeschiedene Personen werden nicht geweckt, auch wenn noch im Winterteam', () => {
  const loc = { name: 'Salzburg', lat: 47.81, lon: 13.05 }
  const objects = [{ id: 'o1', name: 'Wohnanlage', region: 'Salzburg', winter: { active: true, team: ['e1', 'e2'] } }]
  const employees = [{ id: 'e1', name: 'Anna', exitDate: '2026-10-31' }, { id: 'e2', name: 'Boris' }]
  const f = alarmFile({ alarm: { topics: { e1: 'a', e2: 'b' } }, locations: [loc], objects, employees, address: '', today: '2026-11-04' })
  assert.deepEqual(f.orte[0].stufe1.map((p) => p.name), ['Boris'])
  const before = alarmFile({ alarm: { topics: { e1: 'a', e2: 'b' } }, locations: [loc], objects, employees, address: '', today: '2026-10-31' })
  assert.deepEqual(before.orte[0].stufe1.map((p) => p.name), ['Anna', 'Boris'], 'am letzten Arbeitstag noch dabei')
})

test('Reklamationen: Tag in Wiener Zeit (00:30 am 1. November ist der 1., nicht der 31. Oktober)', () => {
  assert.equal(dayOf('2026-10-31T23:30:00.000Z'), '2026-11-01')
  assert.equal(dayOf('2026-07-31T22:30:00Z'), '2026-08-01', 'Sommerzeit +2')
  assert.equal(dayOf('2026-11-01'), '2026-11-01', 'reines Datum bleibt')
  assert.equal(dayOf(''), '')
  assert.equal(daysToDone({ received: '2026-10-31T23:30:00Z', doneAt: '2026-11-02T08:00:00Z' }), 1)
})

test('Leistungsnachweis: zwei Einsätze, zwei Stempelungen ohne Kennung – je eine pro Einsatz', () => {
  const inst = (key, start, startTime, endTime) => ({ key, objectId: 'o1', date: '2026-12-01', origDate: '2026-12-01', status: 'normal', start, startTime, endTime, label: key, net: 60, staff: 1 })
  // 06:00 und 18:00 Wiener Zeit (Winter: UTC+1)
  const instances = [inst('2026-12-01|frueh', absMinutes('2026-12-01T05:00:00Z'), '06:00', '07:00'), inst('2026-12-01|abend', absMinutes('2026-12-01T17:00:00Z'), '18:00', '19:00')]
  const state = new PlanState(instances, { '2026-12-01|frueh': [{ employeeId: 'x' }], '2026-12-01|abend': [{ employeeId: 'x' }] })
  const stamps = { a: { id: 'a', date: '2026-12-01', empId: 'x', objectId: 'o1', instKey: '', in: '2026-12-01T05:00:00Z', out: '2026-12-01T06:00:00Z' }, b: { id: 'b', date: '2026-12-01', empId: 'x', objectId: 'o1', instKey: '', in: '2026-12-01T17:02:00Z', out: '2026-12-01T18:00:00Z' } }
  const p = proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances, state, stamps, employeesById: new Map([['x', { name: 'X' }]]), today: '2027-01-05' })
  const byLabel = Object.fromEntries(p.rows.map((r) => [r.label, r]))
  assert.equal(byLabel['2026-12-01|frueh'].ist.length, 1)
  assert.equal(byLabel['2026-12-01|abend'].ist.length, 1)
  assert.equal(byLabel['2026-12-01|abend'].status, 'bestaetigt')
  assert.equal(byLabel['2026-12-01|abend'].ist[0].minutes, 58)
})

test('Import: Wochentage über das Wochenende („Fr-Mo“), normale Bereiche bleiben', () => {
  assert.deepEqual([...parseWeekdays('Fr-Mo')].sort(), [1, 5, 6, 7])
  assert.deepEqual([...parseWeekdays('Mo-Fr')].sort(), [1, 2, 3, 4, 5])
  assert.deepEqual([...parseWeekdays('So-Di')].sort(), [1, 2, 7])
  assert.deepEqual([...parseWeekdays('Mi')], [3])
})

test('Winterdienst-Fotos: „ß“ wird „ss“ im Dateinamen', () => {
  assert.equal(photoPath({ date: '2026-12-02', object: 'Hauptstraße 5' }, 'foto1.jpg'), 'exporte/Winterdienst/2026-12/2026-12-02_Hauptstrasse-5_foto1.jpg')
})
