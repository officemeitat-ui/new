import { test } from 'node:test'
import assert from 'node:assert/strict'

import { complaintList, complaintStats, daysToDone, defaultDue, hotspots, isOpen, isOverdue, KINDS, whoWorked } from '../src/core/complaints.js'
import { PlanState } from '../src/core/plan.js'

const c = (id, over = {}) => ({ id, objectId: 'o1', date: '2026-11-03', received: '2026-11-03T08:00:00.000Z', kind: 'Reinigung mangelhaft', due: '', status: 'offen', ...over })

const dues = [
  ['Reinigung mangelhaft', '2026-11-04'],
  ['Leistung nicht erbracht', '2026-11-04'],
  ['Nicht erschienen / zu spät', '2026-11-04'],
  ['Schlüssel / Sicherheit', '2026-11-04'],
  ['Schaden', '2026-11-06'],
  ['Verhalten', '2026-11-06'],
  ['Sonstiges', '2026-11-10'],
  ['ganz neue Art', '2026-11-06'],
]
for (const [kind, due] of dues) test(`Reklamation: Frist für „${kind}“ ab Eingang 3.11. → ${due}`, () => assert.equal(defaultDue(kind, '2026-11-03'), due))

test('Reklamation: jede Art aus der Auswahl hat eine eigene Frist (keine fällt auf den Standard)', () => {
  for (const kind of KINDS) assert.ok(defaultDue(kind, '2026-11-03') !== undefined)
  assert.equal(defaultDue('Sonstiges', '2026-12-28'), '2027-01-04', 'über den Jahreswechsel')
})

test('Reklamation überfällig: erst am Tag nach der Frist, „in Arbeit“ zählt als offen, erledigt nie', () => {
  assert.equal(isOverdue(c('a', { due: '2026-11-05' }), '2026-11-05'), false)
  assert.equal(isOverdue(c('a', { due: '2026-11-05' }), '2026-11-06'), true)
  assert.equal(isOverdue(c('a', { due: '2026-11-05', status: 'arbeit' }), '2026-11-06'), true)
  assert.equal(isOpen(c('a', { status: 'arbeit' })), true)
  assert.equal(isOverdue(c('a', { due: '2026-11-01', status: 'erledigt' }), '2026-11-06'), false)
  assert.equal(isOverdue(c('a'), '2030-01-01'), false, 'ohne Frist nie überfällig')
})

test('Reklamationsliste: überfällige zuerst, dann nach Frist, ohne Frist zuletzt, gleiche Frist nach Eingang', () => {
  const items = [
    c('ohneFrist'),
    c('spaeter', { due: '2026-11-12' }),
    c('frueh2', { due: '2026-11-08', received: '2026-11-04T09:00:00.000Z' }),
    c('frueh1', { due: '2026-11-08', received: '2026-11-04T07:00:00.000Z' }),
    c('ueber', { due: '2026-11-05' }),
    c('fertig', { status: 'erledigt', doneAt: '2026-11-06T10:00:00.000Z' }),
  ]
  assert.deepEqual(complaintList(items, { today: '2026-11-07' }).map((x) => x.id), ['ueber', 'frueh1', 'frueh2', 'spaeter', 'ohneFrist'])
  assert.deepEqual(complaintList(items, { status: 'alle', today: '2026-11-07' }).map((x) => x.id).at(-1), 'fertig', 'alle: offene vor erledigten')
  assert.deepEqual(complaintList(null, { today: '2026-11-07' }), [])
})

test('Reklamationsliste: erledigte neueste zuerst, ohne Datum zuletzt, Filter je Objekt', () => {
  const items = [c('a', { status: 'erledigt' }), c('b', { status: 'erledigt', doneAt: '2026-11-04T10:00:00.000Z' }), c('d', { status: 'erledigt', doneAt: '2026-11-09T10:00:00.000Z', objectId: 'o2' })]
  assert.deepEqual(complaintList(items, { status: 'erledigt', today: '2026-11-10' }).map((x) => x.id), ['d', 'b', 'a'])
  assert.deepEqual(complaintList(items, { status: 'erledigt', objectId: 'o1', today: '2026-11-10' }).map((x) => x.id), ['b', 'a'])
  assert.deepEqual(complaintList(items, { status: 'offen', today: '2026-11-10' }), [])
})

test('Häufungen: Fenster in Tagen (Grenztag zählt mit), eigene Mindestzahl, meiste zuerst', () => {
  const items = [
    c('1', { received: '2026-08-05T08:00:00.000Z' }), // genau 90 Tage vor dem 3.11.
    c('2', { received: '2026-08-04T12:00:00.000Z' }), // einen Tag davor
    c('3'),
    c('4', { objectId: 'o2' }),
    c('5', { objectId: 'o2' }),
    c('6', { objectId: 'o2' }),
  ]
  assert.deepEqual(hotspots(items, { today: '2026-11-03' }), [{ objectId: 'o2', n: 3 }], 'o1: nur 2 im Fenster')
  assert.deepEqual(hotspots(items, { today: '2026-11-03', min: 2 }), [{ objectId: 'o2', n: 3 }, { objectId: 'o1', n: 2 }])
  assert.deepEqual(hotspots(items, { today: '2026-11-03', days: 7, min: 1 }), [{ objectId: 'o2', n: 3 }, { objectId: 'o1', n: 1 }])
  assert.deepEqual(hotspots(undefined, { today: '2026-11-03' }), [])
})

test('Bearbeitungsdauer: gleicher Tag 0, Erledigt vor Eingang nicht negativ, offen ohne Dauer', () => {
  assert.equal(daysToDone(c('a', { doneAt: '2026-11-03T17:00:00.000Z' })), 0)
  assert.equal(daysToDone(c('a', { doneAt: '2026-11-10T07:00:00.000Z' })), 7)
  assert.equal(daysToDone(c('a', { doneAt: '2026-11-01T07:00:00.000Z' })), 0)
  assert.equal(daysToDone(c('a')), null)
})

test('Reklamations-Kennzahlen: nur Eingang im Zeitraum, Durchschnitt auf eine Stelle', () => {
  const items = [
    c('a', { status: 'erledigt', doneAt: '2026-11-04T10:00:00.000Z' }),
    c('b', { status: 'erledigt', doneAt: '2026-11-05T10:00:00.000Z', kind: 'Schaden' }),
    c('d', { status: 'erledigt', doneAt: '2026-11-03T10:00:00.000Z', kind: 'Schaden' }),
    c('e', { status: 'arbeit', kind: 'Verhalten' }),
    c('f', { received: '2026-10-31T10:00:00.000Z' }),
  ]
  assert.deepEqual(complaintStats(items, { from: '2026-11-01', to: '2026-11-30' }), { total: 4, open: 1, done: 3, byKind: { 'Reinigung mangelhaft': 1, Schaden: 2, Verhalten: 1 }, avgDays: 1 })
  assert.deepEqual(complaintStats(items, { from: '2026-10-01', to: '2026-10-31' }), { total: 1, open: 1, done: 0, byKind: { 'Reinigung mangelhaft': 1 }, avgDays: null })
  const third = [c('x', { status: 'erledigt', doneAt: '2026-11-04T10:00:00.000Z' }), c('y', { status: 'erledigt', doneAt: '2026-11-04T10:00:00.000Z' }), c('z', { status: 'erledigt', doneAt: '2026-11-03T10:00:00.000Z' })]
  assert.equal(complaintStats(third, { from: '2026-11-01', to: '2026-11-30' }).avgDays, 0.7, '2/3 Tage')
})

test('Wer war im Objekt: mehrere Personen, abgesagte Einsätze und andere Tage nicht', () => {
  const inst = (key, date, objectId, start, extra = {}) => ({ key, date, objectId, start, startTime: extra.startTime || '06:00', endTime: extra.endTime || '08:00', label: extra.label ?? 'Reinigung', status: extra.status || 'normal' })
  const instances = [
    inst('d|abend', '2026-11-02', 'o1', 5000, { startTime: '18:00', endTime: '20:00', label: 'Abendreinigung' }),
    inst('d|frueh', '2026-11-03', 'o1', 6000),
    inst('d|weg', '2026-11-03', 'o1', 6100, { status: 'cancelled' }),
    inst('d|vorvortag', '2026-11-01', 'o1', 4000),
    inst('d|fremd', '2026-11-03', 'o2', 6000),
    inst('d|ohne', '2026-11-03', 'o1', 6200, { label: '' }),
  ]
  const state = new PlanState(instances, { 'd|abend': [{ employeeId: 'x' }], 'd|frueh': [{ employeeId: 'y' }, { employeeId: 'z' }], 'd|weg': [{ employeeId: 'w' }], 'd|vorvortag': [{ employeeId: 'v' }], 'd|fremd': [{ employeeId: 'u' }], 'd|ohne': [{ employeeId: 't' }] })
  const who = whoWorked({ instances, state, objectId: 'o1', date: '2026-11-03' })
  assert.deepEqual(who.map((w) => [w.empId, w.date, w.time, w.label]), [
    ['x', '2026-11-02', '18:00–20:00', 'Abendreinigung'],
    ['y', '2026-11-03', '06:00–08:00', 'Reinigung'],
    ['z', '2026-11-03', '06:00–08:00', 'Reinigung'],
    ['t', '2026-11-03', '06:00–08:00', ''],
  ])
})
