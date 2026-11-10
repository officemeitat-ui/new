// Urlaubsplanung (core/urlaub.js): Sperrzeiten prüfen, gleichzeitig Abwesende, Resturlaub, Prüfung je Antrag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absentPerDay, blackoutsForPortal, blackoutsIn, makeBlackout, othersAbsent, requestCheck, vacationDays, vacationSettings } from '../src/core/urlaub.js'

test('Urlaub: Sperrzeit prüfen und finden', () => {
  assert.match(makeBlackout({ from: '2026-07-01' }).error, /Beginn und Ende/)
  assert.match(makeBlackout({ from: '2026-07-10', to: '2026-07-01', label: 'x' }).error, /vor dem Beginn/)
  assert.match(makeBlackout({ from: '2026-07-01', to: '2026-07-31', label: '  ' }).error, /Grund/)
  assert.match(makeBlackout({ from: '2026-01-01', to: '2027-03-01', label: 'x' }).error, /ein gutes Jahr/)
  const b = makeBlackout({ from: '2026-07-01', to: '2026-08-31', label: '  Grundreinigung   Schulen ' }, { newId: () => 'b1' }).blackout
  assert.deepEqual(b, { id: 'b1', from: '2026-07-01', to: '2026-08-31', label: 'Grundreinigung Schulen' })
  assert.deepEqual(blackoutsIn([b], '2026-06-25', '2026-07-02').map((x) => x.id), ['b1'])
  assert.deepEqual(blackoutsIn([b], '2026-09-01', '2026-09-05'), [])
  assert.deepEqual(vacationSettings({}), { maxParallel: 0, blackouts: [] })
  assert.deepEqual(blackoutsForPortal([b, { id: 'alt', from: '2025-07-01', to: '2025-07-31', label: 'alt' }], '2026-03-01'), [{ von: '2026-07-01', bis: '2026-08-31', text: 'Grundreinigung Schulen' }])
})

test('Urlaub: gleichzeitig Abwesende (ohne die Person selbst, nur aktive), Höchstzahl je Tag', () => {
  const absences = [
    { employeeId: 'a', from: '2026-11-16', to: '2026-11-20', type: 'Urlaub' },
    { employeeId: 'b', from: '2026-11-18', to: '2026-11-18', type: 'Krankenstand' },
    { employeeId: 'b', from: '2026-11-19', to: '2026-11-25', type: 'Urlaub' },
    { employeeId: 'c', from: '2026-11-01', to: '2026-11-30', type: 'Urlaub' },
    { employeeId: 'me', from: '2026-11-16', to: '2026-11-16', type: 'Urlaub' },
  ]
  const r = othersAbsent({ absences, employeeId: 'me', from: '2026-11-17', to: '2026-11-19', activeIds: new Set(['a', 'b', 'me']) })
  assert.deepEqual(r.people, [{ empId: 'a', from: '2026-11-17', to: '2026-11-19' }, { empId: 'b', from: '2026-11-18', to: '2026-11-19' }])
  assert.equal(r.max, 2)
  assert.equal(r.day, '2026-11-18')
  const perDay = absentPerDay(absences, ['2026-11-15', '2026-11-18'], new Set(['a', 'b', 'c']))
  assert.deepEqual([...perDay.values()], [1, 3])
})

test('Urlaub: Prüfung je Antrag mit Sperrzeit, Grenze und Resturlaub (Mo–Fr ohne Feiertage)', () => {
  assert.equal(vacationDays('2026-12-21', '2027-01-08', 2026), 8, '21.–31.12.: 9 Werktage, 25. Christtag … 8 ohne 25.12.')
  const employees = [{ id: 'me', vacationDaysYear: 25 }, { id: 'a' }, { id: 'b' }, { id: 'x', inactive: true }]
  const absences = [
    { employeeId: 'me', from: '2026-02-02', to: '2026-02-06', type: 'Urlaub' },
    { employeeId: 'a', from: '2026-07-13', to: '2026-07-17', type: 'Urlaub' },
    { employeeId: 'b', from: '2026-07-15', to: '2026-07-15', type: 'Zeitausgleich' },
    { employeeId: 'x', from: '2026-07-01', to: '2026-07-31', type: 'Urlaub' },
  ]
  const rules = { vacation: { maxParallel: 2, blackouts: [{ id: 'b1', from: '2026-07-01', to: '2026-08-31', label: 'Grundreinigung Schulen' }] } }
  const c = requestCheck({ request: { art: 'Urlaub', employeeId: 'me', von: '2026-07-13', bis: '2026-07-17' }, absences, employees, rules })
  assert.deepEqual(c.blackouts.map((b) => b.label), ['Grundreinigung Schulen'])
  assert.equal(c.others.max, 2)
  assert.equal(c.limit, 2)
  assert.equal(c.over, true, 'mit der Person wären es 3')
  assert.deepEqual(c.rest, { year: 2026, before: 20, days: 5, after: 15 })
  const za = requestCheck({ request: { art: 'Zeitausgleich', employeeId: 'me', von: '2026-09-07', bis: '2026-09-07' }, absences, employees, rules })
  assert.deepEqual([za.blackouts.length, za.others.max, za.over, za.rest], [0, 0, false, null])
  assert.equal(requestCheck({ request: { art: 'Urlaub', von: '2026-07-13', bis: '2026-07-13', employeeId: 'me' }, absences, employees, rules: {} }).over, false, 'ohne Grenze nie „zu viele“')
})
