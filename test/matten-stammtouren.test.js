// Stammtouren des Mattenwechsels (core/matten-stammtouren.js): Tage der Tour, Liegeplätze anpassen (die Fälligkeit aus
// core/matten-plan.js fällt dann auf die Tour), Hinweise, Verteilen der Stopps eines Tages in fester Reihenfolge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignPlacements, newRoute, nextRunOn, routeHints, routeProblem, routeRunsOn, routesOn, splitByRoutes } from '../src/core/matten-stammtouren.js'
import { jobsFor } from '../src/core/matten-plan.js'

// Dienstag, 1.12.2026: alle 2 Wochen
const tour1 = { id: 'r1', name: 'Tour 1 Luftseite', weekday: 2, everyWeeks: 2, anchor: '2026-12-01', driverId: 'd1', vehicleId: 'v1', placementIds: ['p3', 'p1', 'p2'], active: true }

test('Tage der Tour: Wochentag und Rhythmus ab dem Anker, auch davor', () => {
  assert.ok(routeRunsOn(tour1, '2026-12-01'))
  assert.ok(routeRunsOn(tour1, '2026-12-15'))
  assert.ok(routeRunsOn(tour1, '2026-11-17'), 'zwei Wochen vor dem Anker')
  assert.ok(!routeRunsOn(tour1, '2026-12-08'), 'Woche dazwischen')
  assert.ok(!routeRunsOn(tour1, '2026-12-02'), 'Mittwoch')
  assert.ok(!routeRunsOn({ ...tour1, active: false }, '2026-12-01'))
  assert.equal(nextRunOn(tour1, '2026-11-26'), '2026-12-01')
  assert.equal(nextRunOn(tour1, '2026-12-02'), '2026-12-15')
  assert.deepEqual(routesOn([tour1, { ...tour1, id: 'r2', weekday: 3, anchor: '2026-12-02' }], '2026-12-15').map((r) => r.id), ['r1'])
})

test('Neue Tour und Prüfung: Anker auf den Wochentag, verständliche Fehler', () => {
  const r = newRoute({ id: 'x', name: 'Tour 2 Landseite', weekday: 4, everyWeeks: 4, from: '2026-11-26' })
  assert.equal(r.anchor, '2026-11-26', 'Donnerstag')
  assert.equal(routeProblem(r), 'Bitte mindestens einen Liegeplatz wählen.')
  assert.equal(routeProblem({ ...r, placementIds: ['p1'], anchor: '2026-11-27' }), 'Der Tag 27.11.2026 ist kein Donnerstag.')
  assert.equal(routeProblem({ ...r, placementIds: ['p1'] }), '')
  assert.match(routeProblem({ ...r, name: ' ' }), /Namen/)
})

test('Liegeplätze anpassen: Intervall, fester Rhythmus, Starttermin; danach fallen die Wechsel auf die Tour', () => {
  const placements = [
    { id: 'p1', active: true, intervalDays: 28, rule: 'ab-ist', startDate: '2026-11-26' },
    { id: 'p2', active: true, intervalDays: 14, rule: 'rhythmus', startDate: '2026-12-01' },
    { id: 'p3', active: true, intervalDays: 14, rule: 'rhythmus', startDate: '2026-11-30' },
    { id: 'p9', active: true, intervalDays: 28, rule: 'ab-ist', startDate: '2026-11-26' },
  ]
  const r = alignPlacements(placements, tour1, { from: '2026-11-26', now: 'jetzt', by: 'Petra' })
  assert.deepEqual(r.changed, ['p1', 'p3'])
  assert.deepEqual(r.placements.slice(0, 3).map((p) => [p.intervalDays, p.rule, p.startDate]), [[14, 'rhythmus', '2026-12-01'], [14, 'rhythmus', '2026-12-01'], [14, 'rhythmus', '2026-12-01']])
  assert.equal(r.placements[3], placements[3], 'nicht in der Tour: unverändert')
  const { jobs } = jobsFor({ placements: r.placements.slice(0, 3), von: '2026-11-26', bis: '2027-01-31' })
  assert.ok(jobs.length > 0)
  assert.ok(jobs.every((j) => routeRunsOn(tour1, j.due)), jobs.map((j) => j.due).join(','))
  assert.deepEqual(routeHints(tour1, { placements: r.placements, routes: [tour1] }), [])
})

test('Hinweise: Liegeplatz fehlt, steht doppelt, Intervall passt nicht', () => {
  const placements = [{ id: 'p1', active: true, intervalDays: 28, rule: 'rhythmus', startDate: '2026-12-01' }, { id: 'p2', active: false }, { id: 'p3', active: true, intervalDays: 14, rule: 'rhythmus', startDate: '2026-12-01' }]
  const other = { id: 'r9', name: 'andere', placementIds: ['p3'], active: true }
  const h = routeHints(tour1, { placements, routes: [tour1, other] })
  assert.deepEqual(h.map((x) => [x.kind, x.ids]), [['fehlt', ['p2']], ['doppelt', ['p3']], ['intervall', ['p1']]])
})

test('Stopps eines Tages: Stammtour zuerst, feste Reihenfolge (auch innerhalb eines Stopps), Rest normal', () => {
  const item = (placementId) => ({ placementId, jobKey: `${placementId}|2026-12-01` })
  const stops = [
    { id: 'st-flughafen', items: [item('p1'), item('p2'), item('x1')] },
    { id: 'st-bank', items: [item('p3')] },
    { id: 'st-sonst', items: [item('y1')] },
  ]
  const drivers = [{ id: 'd1', name: 'Isa' }, { id: 'd2', name: 'Marius' }]
  const r = splitByRoutes({ stops, routes: [tour1], drivers, date: '2026-12-01' })
  assert.equal(r.fixed.length, 1)
  assert.equal(r.fixed[0].driver.id, 'd1')
  assert.deepEqual(r.fixed[0].stops.map((s) => s.id), ['st-bank', 'st-flughafen'], 'p3 steht in der Tour vorne')
  assert.deepEqual(r.fixed[0].stops[1].items.map((i) => i.placementId), ['p1', 'p2', 'x1'], 'im Stopp in Tour-Reihenfolge, fremde Liegeplätze danach')
  assert.deepEqual(r.rest.map((s) => s.id), ['st-sonst'])
  // anderer Tag: nichts fest
  assert.equal(splitByRoutes({ stops, routes: [tour1], drivers, date: '2026-12-08' }).fixed.length, 0)
  // Fahrer fährt nicht: Hinweis, Stopps im normalen Vorschlag
  const s = splitByRoutes({ stops, routes: [tour1], drivers: [drivers[1]], date: '2026-12-01' })
  assert.equal(s.fixed.length, 0)
  assert.equal(s.rest.length, 3)
  assert.match(s.skipped[0].text, /Tour 1 Luftseite: Fahrer fährt an diesem Tag nicht/)
})
