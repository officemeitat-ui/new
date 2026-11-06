// Mattenwechsel: Fälligkeitsrechner (core/matten-plan.js) – Einsätze je Liegeplatz und Solltermin mit eindeutigem
// Schlüssel, fester Rhythmus und „ab letztem Wechsel“, Verschieben ohne Rhythmusänderung, Pausen und Betriebsurlaub,
// Nachholen, überfällig, erneutes Planen ohne Doppel, Kalender je Woche und Monat (docs/MATTENWECHSEL-PLAN.md, P6).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  calendarMonth,
  calendarWeek,
  dayAfterPause,
  daysOverdue,
  discardJob,
  dueDates,
  dueOn,
  groupByObject,
  isOpen,
  jobDate,
  jobKey,
  jobsFor,
  lastDone,
  markDone,
  markNotDone,
  nextDue,
  overdue,
  pauseOn,
  shiftJob,
  skipJob,
} from '../src/core/matten-plan.js'

const NOW = '2026-11-06T08:00:00.000Z'
const lp = (id, extra = {}) => ({ id, objectId: 'o1', active: true, intervalDays: 14, startDate: '2026-11-02', rule: 'rhythmus', pauses: [], ...extra })
const plan = (input) => jobsFor({ now: NOW, by: 'Büro', ...input })
const dues = (jobs, id) => jobs.filter((j) => j.placementId === id).map((j) => j.due)
const find = (jobs, key) => jobs.find((j) => j.key === key)

// ---------------------------------------------------------------- fester Rhythmus

test('14 Tage: Solltermine ab Starttermin, Schlüssel <Liegeplatz>:<Solltermin>, Status geplant', () => {
  const { jobs, added, review } = plan({ placements: [lp('L1')], von: '2026-11-01', bis: '2026-12-31' })
  assert.deepEqual(dues(jobs, 'L1'), ['2026-11-02', '2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28'])
  assert.equal(added.length, 5)
  assert.deepEqual(review, [])
  assert.deepEqual(jobs[0], { key: 'L1:2026-11-02', placementId: 'L1', due: '2026-11-02', status: 'geplant', createdAt: NOW, createdBy: 'Büro' })
  assert.equal(jobKey('L1', '2026-11-16'), 'L1:2026-11-16')
  assert.equal(new Set(jobs.map((j) => j.key)).size, jobs.length)
})

test('28 Tage: über ein halbes Jahr, Zeitraum mitten im Rhythmus, nichts vor dem Starttermin', () => {
  const p = lp('L2', { intervalDays: 28, startDate: '2026-01-05' })
  assert.deepEqual(dues(plan({ placements: [p], von: '2026-01-01', bis: '2026-06-30' }).jobs, 'L2'), ['2026-01-05', '2026-02-02', '2026-03-02', '2026-03-30', '2026-04-27', '2026-05-25', '2026-06-22'])
  // Zeitraum beginnt mitten im Rhythmus: die Termine bleiben im Raster ab dem Starttermin
  assert.deepEqual(dues(plan({ placements: [p], von: '2026-03-01', bis: '2026-03-31' }).jobs, 'L2'), ['2026-03-02', '2026-03-30'])
  assert.deepEqual(dueDates(lp('L3', { startDate: '2026-01-05' }), { von: '2026-03-01', bis: '2026-03-31' }), ['2026-03-02', '2026-03-16', '2026-03-30'])
  // Starttermin nach dem Zeitraum: nichts; von und bis gelten einschließlich
  assert.deepEqual(plan({ placements: [lp('L4', { startDate: '2027-01-04' })], von: '2026-11-01', bis: '2026-12-31' }).jobs, [])
  assert.deepEqual(dues(plan({ placements: [p], von: '2026-02-02', bis: '2026-03-02' }).jobs, 'L2'), ['2026-02-02', '2026-03-02'])
})

test('Monatsgrenzen, Jahreswechsel und Schaltjahr', () => {
  assert.deepEqual(dueDates(lp('A', { startDate: '2028-02-01' }), { von: '2028-02-01', bis: '2028-03-20' }), ['2028-02-01', '2028-02-15', '2028-02-29', '2028-03-14'])
  assert.deepEqual(dueDates(lp('B', { startDate: '2028-02-01', intervalDays: 28 }), { von: '2028-02-01', bis: '2028-04-30' }), ['2028-02-01', '2028-02-29', '2028-03-28', '2028-04-25'])
  // kein Schaltjahr: 15.2. + 14 Tage = 1.3.
  assert.deepEqual(dueDates(lp('C', { startDate: '2026-02-15' }), { von: '2026-02-01', bis: '2026-03-05' }), ['2026-02-15', '2026-03-01'])
  // Jahreswechsel: Schlüssel mit dem neuen Jahr
  const { jobs } = plan({ placements: [lp('D', { startDate: '2026-12-21' })], von: '2026-12-01', bis: '2027-01-31' })
  assert.deepEqual(jobs.map((j) => j.key), ['D:2026-12-21', 'D:2027-01-04', 'D:2027-01-18'])
})

test('Verschobener Einsatz ändert den Rhythmus nicht', () => {
  let { jobs } = plan({ placements: [lp('L1')], von: '2026-11-01', bis: '2026-12-31' })
  const moved = shiftJob(find(jobs, 'L1:2026-11-16'), '2026-11-18', { now: NOW, by: 'Büro', reason: 'Kunde wünscht Mittwoch' })
  assert.equal(moved.key, 'L1:2026-11-16')
  assert.equal(moved.due, '2026-11-16')
  assert.equal(moved.planned, '2026-11-18')
  assert.equal(moved.reason, 'Kunde wünscht Mittwoch')
  assert.equal(jobDate(moved), '2026-11-18')
  jobs = jobs.map((j) => (j.key === moved.key ? moved : j))
  assert.deepEqual(dueOn(jobs, '2026-11-18').map((j) => j.key), ['L1:2026-11-16'])
  assert.deepEqual(dueOn(jobs, '2026-11-16'), [])
  // am verschobenen Tag gewechselt: der nächste Solltermin bleibt im Raster (30.11., nicht 2.12.)
  jobs = jobs.map((j) => (j.key === moved.key ? markDone(j, '2026-11-18', { now: NOW }) : j))
  const again = plan({ placements: [lp('L1')], jobs, done: [{ placementId: 'L1', date: '2026-11-18' }], von: '2026-11-01', bis: '2027-01-15' })
  assert.deepEqual(again.added.map((j) => j.due), ['2027-01-11'])
  assert.equal(find(again.jobs, 'L1:2026-11-16').status, 'erledigt')
  assert.equal(find(again.jobs, 'L1:2026-11-16').doneOn, '2026-11-18')
  assert.deepEqual(dues(again.jobs, 'L1'), ['2026-11-02', '2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28', '2027-01-11'])
  // zurück auf den Solltermin: planned fällt weg
  const back = shiftJob(moved, '2026-11-16', { now: NOW })
  assert.ok(!('planned' in back))
  assert.equal(shiftJob(moved, 'morgen'), moved, 'ungültiges Datum ändert nichts')
})

test('Ausgefallener Wechsel: nachzuholen bleibt offen und überfällig, bis erledigt oder verworfen', () => {
  let { jobs } = plan({ placements: [lp('L1')], von: '2026-11-01', bis: '2026-11-30' })
  jobs = jobs.map((j) => (j.key === 'L1:2026-11-02' ? markNotDone(j, { reason: 'kein Zugang', now: NOW, by: 'Fahrer' }) : j))
  const missed = find(jobs, 'L1:2026-11-02')
  assert.equal(missed.status, 'nachzuholen')
  assert.equal(missed.reason, 'kein Zugang')
  assert.ok(isOpen(missed))
  assert.deepEqual(overdue(jobs, '2026-11-06').map((j) => j.key), ['L1:2026-11-02'])
  assert.equal(daysOverdue(missed, '2026-11-06'), 4)
  assert.equal(daysOverdue(missed, '2026-11-02'), 0, 'am Termin selbst noch nicht überfällig')
  // erneutes Planen legt nichts neu an und lässt den Status stehen
  const again = plan({ placements: [lp('L1')], jobs, von: '2026-11-01', bis: '2026-11-30' })
  assert.deepEqual(again.added, [])
  assert.equal(find(again.jobs, 'L1:2026-11-02').status, 'nachzuholen')
  // nachgeholt am 9.11. (verschoben): erledigt, nicht mehr überfällig
  const caught = markDone(shiftJob(missed, '2026-11-09', { now: NOW }), '2026-11-09', { now: NOW })
  assert.equal(caught.status, 'erledigt')
  assert.deepEqual(overdue([caught], '2026-11-20'), [])
  // oder verworfen: abgeschlossen ohne Wechsel
  const dropped = discardJob(missed, { reason: 'Kunde verzichtet', now: NOW })
  assert.equal(dropped.status, 'verworfen')
  assert.ok(!isOpen(dropped))
  assert.deepEqual(overdue([dropped], '2026-11-20'), [])
  // teilweise erledigt zählt als Wechsel
  assert.equal(markDone(missed, '2026-11-03', { partial: true }).status, 'teilweise')
})

test('Überfällig: offene Einsätze vor heute (auch in Tour), nicht erledigte, ausgesetzte oder künftige', () => {
  const jobs = [
    { key: 'A:2026-11-02', placementId: 'A', due: '2026-11-02', status: 'geplant' },
    { key: 'B:2026-11-03', placementId: 'B', due: '2026-11-03', status: 'in-tour' },
    { key: 'C:2026-11-03', placementId: 'C', due: '2026-11-03', status: 'erledigt' },
    { key: 'D:2026-11-04', placementId: 'D', due: '2026-11-04', status: 'ausgesetzt' },
    { key: 'E:2026-11-04', placementId: 'E', due: '2026-11-04', planned: '2026-11-10', status: 'geplant' },
    { key: 'F:2026-11-06', placementId: 'F', due: '2026-11-06', status: 'geplant' },
  ]
  assert.deepEqual(overdue(jobs, '2026-11-06').map((j) => j.key), ['A:2026-11-02', 'B:2026-11-03'])
  assert.deepEqual(dueOn(jobs, '2026-11-06').map((j) => j.key), ['F:2026-11-06'])
  assert.deepEqual(dueOn(jobs, '2026-11-10').map((j) => j.key), ['E:2026-11-04'])
})

// ---------------------------------------------------------------- Pausen und Betriebsurlaub

test('Betriebsurlaub: Solltermin ausgesetzt (entfällt), Rhythmus läuft weiter', () => {
  const closures = [{ from: '2026-12-22', to: '2027-01-06', reason: 'Betriebsurlaub Weihnachten' }]
  const { jobs } = plan({ placements: [lp('L1')], closures, von: '2026-12-01', bis: '2027-01-31' })
  assert.deepEqual(jobs.map((j) => [j.due, j.status]), [['2026-12-14', 'geplant'], ['2026-12-28', 'ausgesetzt'], ['2027-01-11', 'geplant'], ['2027-01-25', 'geplant']])
  assert.equal(find(jobs, 'L1:2026-12-28').reason, 'Betriebsurlaub Weihnachten')
  assert.deepEqual(dueOn(jobs, '2026-12-28'), [], 'ausgesetzt ist nicht fällig')
  assert.deepEqual(overdue(jobs, '2027-01-05').map((j) => j.key), ['L1:2026-12-14'], 'und nicht überfällig')
  assert.equal(pauseOn(lp('L1'), '2027-01-06', closures).kind, 'betriebsurlaub', 'bis einschließlich')
  assert.equal(pauseOn(lp('L1'), '2027-01-07', closures), null)
})

test('Betriebsurlaub mit Nachholen: am ersten Tag danach, außer der nächste Wechsel kommt früher', () => {
  const closures = [{ from: '2026-12-22', to: '2027-01-06' }]
  let { jobs } = plan({ placements: [lp('L1')], closures, skip: 'nachholen', von: '2026-12-01', bis: '2027-01-31' })
  const j = find(jobs, 'L1:2026-12-28')
  assert.equal(j.status, 'nachzuholen')
  assert.equal(j.planned, '2027-01-07')
  assert.equal(j.reason, 'Betriebsurlaub: nachholen')
  assert.deepEqual(dueOn(jobs, '2027-01-07').map((x) => x.key), ['L1:2026-12-28'])
  // Urlaub bis kurz vor dem nächsten Solltermin: Nachholen wäre am selben Tag wie der reguläre Wechsel → ausgesetzt
  ;({ jobs } = plan({ placements: [lp('L1')], closures: [{ from: '2026-12-22', to: '2027-01-10' }], skip: 'nachholen', von: '2026-12-01', bis: '2027-01-31' }))
  assert.equal(find(jobs, 'L1:2026-12-28').status, 'ausgesetzt')
  assert.equal(find(jobs, 'L1:2027-01-11').status, 'geplant')
})

test('Pause des Liegeplatzes: eigener Grund und eigene Einstellung, Ketten von Pausen, Pause ohne Ende', () => {
  const p = lp('L1', { pauses: [{ from: '2026-11-14', to: '2026-11-20', reason: 'Umbau Eingang', mode: 'nachholen' }] })
  const { jobs } = plan({ placements: [p], von: '2026-11-01', bis: '2026-11-30' })
  assert.deepEqual(jobs.map((j) => [j.due, j.status, j.planned || '']), [['2026-11-02', 'geplant', ''], ['2026-11-16', 'nachzuholen', '2026-11-21'], ['2026-11-30', 'geplant', '']])
  assert.equal(find(jobs, 'L1:2026-11-16').reason, 'Umbau Eingang: nachholen')
  // Pause endet, gleich danach Betriebsurlaub: erster freier Tag
  assert.equal(dayAfterPause(p, '2026-11-16', [{ from: '2026-11-21', to: '2026-11-23' }]), '2026-11-24')
  // Pause ohne Ende: bis auf Weiteres ausgesetzt, auch mit Nachholen
  const open = lp('L2', { pauses: [{ from: '2026-11-10', to: '', reason: 'Geschäft geschlossen' }] })
  const r = plan({ placements: [open], skip: 'nachholen', von: '2026-11-01', bis: '2026-12-31' })
  assert.deepEqual(r.jobs.map((j) => j.status), ['geplant', 'ausgesetzt', 'ausgesetzt', 'ausgesetzt', 'ausgesetzt'])
  assert.equal(dayAfterPause(open, '2026-11-16'), null)
})

test('Pause nachträglich eingetragen: geplante Einsätze bleiben, stehen aber unter review', () => {
  const first = plan({ placements: [lp('L1')], von: '2026-11-01', bis: '2026-11-30' })
  const paused = lp('L1', { pauses: [{ from: '2026-11-15', to: '2026-11-17', reason: 'Messe' }] })
  const again = plan({ placements: [paused], jobs: first.jobs, von: '2026-11-01', bis: '2026-11-30' })
  assert.deepEqual(again.added, [])
  assert.equal(find(again.jobs, 'L1:2026-11-16').status, 'geplant')
  assert.deepEqual(again.review, [{ key: 'L1:2026-11-16', why: 'pause', text: 'Messe am Termin' }])
})

// ---------------------------------------------------------------- ab letztem Wechsel

test('ab-ist: nächster Termin = letzter Wechsel + Intervall, höchstens ein offener Einsatz', () => {
  const p = lp('L1', { rule: 'ab-ist', intervalDays: 28, startDate: '2026-10-01' })
  const done = [{ placementId: 'L1', date: '2026-09-20' }, { placementId: 'L1', date: '2026-10-05' }, { placementId: 'X', date: '2026-10-30' }]
  assert.equal(lastDone('L1', { done }), '2026-10-05')
  let r = plan({ placements: [p], done, von: '2026-11-01', bis: '2026-12-31' })
  assert.deepEqual(r.jobs.map((j) => j.key), ['L1:2026-11-02'])
  assert.deepEqual(dueDates(p, { von: '2026-11-01', bis: '2026-12-31', done }), ['2026-11-02', '2026-11-30', '2026-12-28'], 'Vorschau')
  // erneut: nichts dazu, solange der Einsatz offen ist
  assert.deepEqual(plan({ placements: [p], done, jobs: r.jobs, von: '2026-11-01', bis: '2026-12-31' }).added, [])
  // zwei Tage später gewechselt: der nächste Termin rechnet ab dem tatsächlichen Wechsel
  const jobs = r.jobs.map((j) => markDone(j, '2026-11-04', { now: NOW }))
  r = plan({ placements: [p], done: [...done, { placementId: 'L1', date: '2026-11-04' }], jobs, von: '2026-11-01', bis: '2026-12-31' })
  assert.deepEqual(r.added.map((j) => j.key), ['L1:2026-12-02'])
  // auch ohne Eintrag in done zählt ein erledigter Einsatz als Wechsel
  assert.deepEqual(plan({ placements: [p], jobs, von: '2026-11-01', bis: '2026-12-31' }).added.map((j) => j.key), ['L1:2026-12-02'])
})

test('ab-ist: ohne Wechsel der Starttermin (auch überfällig vor dem Zeitraum), nie vor dem Starttermin', () => {
  const p = lp('L1', { rule: 'ab-ist', intervalDays: 28, startDate: '2026-10-15' })
  const r = plan({ placements: [p], von: '2026-11-01', bis: '2026-11-30' })
  assert.deepEqual(r.jobs.map((j) => j.key), ['L1:2026-10-15'])
  assert.deepEqual(overdue(r.jobs, '2026-11-06').map((j) => j.key), ['L1:2026-10-15'])
  // letzter Wechsel lange vor dem Starttermin: ab dem Starttermin
  const done = [{ placementId: 'L1', date: '2026-08-01' }]
  assert.deepEqual(plan({ placements: [p], done, von: '2026-10-01', bis: '2026-10-31' }).jobs.map((j) => j.due), ['2026-10-15'])
  // Starttermin nach dem Zeitraum: nichts
  assert.deepEqual(plan({ placements: [p], von: '2026-09-01', bis: '2026-09-30' }).jobs, [])
})

test('ab-ist: Termin im Betriebsurlaub ausgesetzt, der nächste entsteht im selben Lauf; mit Nachholen danach', () => {
  const p = lp('L1', { rule: 'ab-ist', intervalDays: 14, startDate: '2026-12-01' })
  const done = [{ placementId: 'L1', date: '2026-12-14' }]
  const closures = [{ from: '2026-12-24', to: '2027-01-06' }]
  let r = plan({ placements: [p], done, closures, von: '2026-12-15', bis: '2027-01-31' })
  assert.deepEqual(r.jobs.map((j) => [j.due, j.status]), [['2026-12-28', 'ausgesetzt'], ['2027-01-11', 'geplant']])
  assert.deepEqual(plan({ placements: [p], done, closures, jobs: r.jobs, von: '2026-12-15', bis: '2027-01-31' }).added, [])
  r = plan({ placements: [p], done, closures, skip: 'nachholen', von: '2026-12-15', bis: '2027-01-31' })
  assert.deepEqual(r.jobs.map((j) => [j.due, j.status, j.planned]), [['2026-12-28', 'nachzuholen', '2027-01-07']])
})

// ---------------------------------------------------------------- erneut planen, inaktiv, mehrere Liegeplätze

test('Erneutes Planen: keine Doppel, vorhandene Einsätze bleiben mit Status, überlappende Zeiträume', () => {
  const placements = [lp('L1'), lp('L2', { intervalDays: 28, startDate: '2026-11-09' })]
  const first = plan({ placements, von: '2026-11-01', bis: '2026-12-31' })
  const jobs = first.jobs.map((j) => (j.key === 'L1:2026-11-02' ? { ...j, status: 'in-tour', tourId: 'T1' } : j.key === 'L2:2026-11-09' ? { ...j, status: 'erledigt' } : j))
  const again = jobsFor({ placements, jobs, von: '2026-11-01', bis: '2026-12-31', now: '2026-11-07T00:00:00.000Z' })
  assert.deepEqual(again.added, [])
  assert.equal(again.jobs.length, first.jobs.length)
  assert.deepEqual(find(again.jobs, 'L1:2026-11-02'), { ...find(first.jobs, 'L1:2026-11-02'), status: 'in-tour', tourId: 'T1' })
  assert.equal(find(again.jobs, 'L2:2026-11-09').status, 'erledigt')
  assert.equal(find(again.jobs, 'L1:2026-11-16').createdAt, NOW, 'Anlagezeit bleibt')
  // nächster Zeitraum überlappt: nur die neuen Termine im Jänner kommen dazu
  const next = plan({ placements, jobs: again.jobs, von: '2026-12-01', bis: '2027-01-31' })
  assert.deepEqual(next.added.map((j) => j.key), ['L2:2027-01-04', 'L1:2027-01-11', 'L1:2027-01-25'])
  assert.equal(new Set(next.jobs.map((j) => j.key)).size, next.jobs.length)
  // Reihenfolge nach Termin
  assert.deepEqual(next.jobs.map(jobDate), [...next.jobs.map(jobDate)].sort())
})

test('Inaktiver, gelöschter oder unvollständiger Liegeplatz: keine neuen Einsätze, geplante unter review', () => {
  const first = plan({ placements: [lp('L1'), lp('L2')], von: '2026-11-01', bis: '2026-11-20' })
  const r = plan({ placements: [lp('L1', { active: false })], jobs: first.jobs, von: '2026-11-01', bis: '2026-12-31' })
  assert.deepEqual(r.added, [])
  assert.equal(r.jobs.length, first.jobs.length, 'vorhandene bleiben')
  assert.deepEqual(r.review.map((x) => [x.key, x.why]), [['L1:2026-11-02', 'inaktiv'], ['L2:2026-11-02', 'geloescht'], ['L1:2026-11-16', 'inaktiv'], ['L2:2026-11-16', 'geloescht']])
  for (const bad of [lp('A', { intervalDays: 0 }), lp('B', { intervalDays: '' }), lp('C', { startDate: '' }), lp('D', { intervalDays: 2.5 }), { intervalDays: 14, startDate: '2026-11-02' }]) {
    assert.deepEqual(plan({ placements: [bad], von: '2026-11-01', bis: '2026-12-31' }).jobs, [], JSON.stringify(bad))
  }
  assert.deepEqual(plan({ placements: [lp('L1')], von: '2026-12-31', bis: '2026-11-01' }).jobs, [], 'von nach bis')
  assert.equal(nextDue(lp('L1', { active: false }), { today: '2026-11-06' }), null)
})

test('Mehrere Liegeplätze je Objekt: je Liegeplatz ein Schlüssel, am Tag ein Stopp je Objekt', () => {
  const placements = [
    lp('L1', { objectId: 'o1' }),
    lp('L2', { objectId: 'o1', intervalDays: 28 }),
    lp('L3', { objectId: 'o1', intervalDays: 28, startDate: '2026-11-16' }),
    lp('L4', { objectId: 'o2', intervalDays: 28 }),
  ]
  const { jobs } = plan({ placements, von: '2026-11-01', bis: '2026-11-30' })
  assert.deepEqual(jobs.map((j) => j.key), ['L1:2026-11-02', 'L2:2026-11-02', 'L4:2026-11-02', 'L1:2026-11-16', 'L3:2026-11-16', 'L1:2026-11-30', 'L2:2026-11-30', 'L4:2026-11-30'])
  const day = dueOn(jobs, '2026-11-02')
  assert.deepEqual(groupByObject(day, placements).map((g) => [g.objectId, g.jobs.map((j) => j.placementId)]), [['o1', ['L1', 'L2']], ['o2', ['L4']]])
  assert.deepEqual(groupByObject(dueOn(jobs, '2026-11-16'), placements).map((g) => [g.objectId, g.jobs.length]), [['o1', 2]])
})

// ---------------------------------------------------------------- nächster Wechsel

test('nextDue: offener Einsatz geht vor, sonst nächster Solltermin ab heute ohne ausgesetzte', () => {
  const p = lp('L1')
  assert.deepEqual(nextDue(p, { today: '2026-11-06' }), { date: '2026-11-16', due: '2026-11-16', key: 'L1:2026-11-16', job: null, overdue: false })
  assert.equal(nextDue(p, { today: '2026-11-16' }).date, '2026-11-16', 'heute fällig')
  assert.equal(nextDue(lp('L1', { startDate: '2026-12-01' }), { today: '2026-11-06' }).date, '2026-12-01', 'Start in der Zukunft')
  // offener, überfälliger Einsatz
  const jobs = [markNotDone({ key: 'L1:2026-11-02', placementId: 'L1', due: '2026-11-02', status: 'geplant' }, { now: NOW })]
  const n = nextDue(p, { jobs, today: '2026-11-06' })
  assert.equal(n.key, 'L1:2026-11-02')
  assert.equal(n.overdue, true)
  assert.equal(n.job.status, 'nachzuholen')
  // erledigt bzw. ausgesetzt: nächster Termin im Raster; im Betriebsurlaub übersprungen bzw. nachgeholt
  const closed = [{ key: 'L1:2026-11-16', placementId: 'L1', due: '2026-11-16', status: 'erledigt' }]
  assert.equal(nextDue(p, { jobs: closed, today: '2026-11-10' }).date, '2026-11-30')
  const closures = [{ from: '2026-11-14', to: '2026-11-18' }]
  assert.equal(nextDue(p, { closures, today: '2026-11-10' }).date, '2026-11-30')
  assert.deepEqual(nextDue(p, { closures, today: '2026-11-10', skip: 'nachholen' }), { date: '2026-11-19', due: '2026-11-16', key: 'L1:2026-11-16', job: null, overdue: false })
  // ab-ist
  const q = lp('Q', { rule: 'ab-ist', intervalDays: 28, startDate: '2026-01-01' })
  assert.equal(nextDue(q, { done: [{ placementId: 'Q', date: '2026-10-20' }], today: '2026-11-06' }).date, '2026-11-17')
  assert.equal(nextDue(q, { done: [{ placementId: 'Q', date: '2026-09-20' }], today: '2026-11-06' }).overdue, true)
  assert.equal(nextDue(lp('Z', { pauses: [{ from: '2026-11-01' }] }), { today: '2026-11-06' }), null, 'Pause ohne Ende')
})

test('skipJob setzt von Hand aus, discardJob verwirft; beide nicht mehr offen', () => {
  const j = { key: 'L1:2026-11-16', placementId: 'L1', due: '2026-11-16', status: 'geplant' }
  const s = skipJob(j, { reason: 'Kunde im Urlaub', now: NOW, by: 'Büro' })
  assert.deepEqual([s.status, s.reason, s.updatedAt, s.updatedBy], ['ausgesetzt', 'Kunde im Urlaub', NOW, 'Büro'])
  assert.ok(!isOpen(s) && !isOpen(discardJob(j)))
  assert.equal(j.status, 'geplant', 'Original unverändert')
})

// ---------------------------------------------------------------- Kalender

test('Kalender: Woche Montag bis Sonntag, Monat in ganzen Wochen (Schaltjahr-Februar)', () => {
  const { jobs } = plan({ placements: [lp('L1', { startDate: '2028-02-01' }), lp('L2', { startDate: '2028-02-03', intervalDays: 28 })], von: '2028-02-01', bis: '2028-03-31' })
  const w = calendarWeek(jobs, '2028-02-03')
  assert.equal(w.monday, '2028-01-31')
  assert.equal(w.week, '2028-W05')
  assert.deepEqual(w.days.map((d) => d.date), ['2028-01-31', '2028-02-01', '2028-02-02', '2028-02-03', '2028-02-04', '2028-02-05', '2028-02-06'])
  assert.deepEqual(w.days.map((d) => d.jobs.length), [0, 1, 0, 1, 0, 0, 0])
  const m = calendarMonth(jobs, '2028-02')
  assert.equal(m.weeks.length, 5)
  assert.equal(m.weeks[0].monday, '2028-01-31')
  assert.equal(m.weeks.at(-1).days.at(-1).date, '2028-03-05')
  const all = m.weeks.flatMap((x) => x.days)
  assert.equal(all.filter((d) => d.inMonth).length, 29)
  assert.deepEqual(all.filter((d) => d.jobs.length).map((d) => d.date), ['2028-02-01', '2028-02-03', '2028-02-15', '2028-02-29', '2028-03-02'])
  assert.equal(m.count, 4, 'offene Einsätze im Februar (der 2.3. zählt zum März)')
  // verschobene Einsätze stehen am neuen Tag
  const moved = jobs.map((j) => (j.key === 'L1:2028-02-15' ? shiftJob(j, '2028-02-16', { now: NOW }) : j))
  assert.deepEqual(calendarWeek(moved, '2028-02-14').days.map((d) => d.jobs.length), [0, 0, 1, 0, 0, 0, 0])
  // Monat, der am Montag beginnt und am Sonntag endet (Februar 2027): genau 4 Wochen
  assert.equal(calendarMonth([], '2027-02').weeks.length, 4)
  assert.equal(calendarWeek([], '2026-12-31').week, '2026-W53')
})
