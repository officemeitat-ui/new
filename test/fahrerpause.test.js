// Ruhepause der Fahrer im Tourvorschlag (§ 11 Abs. 1 AZG: mehr als 6 Stunden Arbeit → mindestens 30 Minuten Pause):
// routing.js pauseSettings, scheduleRoute, planRoutes (Schicht um die Pause kürzer, Zeiten mit Pause) und
// matten-tour.js recalcTimes (Pause am Stopp und an der Tour).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pauseSettings, planRoutes, scheduleRoute } from '../src/core/routing.js'
import { recalcTimes } from '../src/core/matten-tour.js'

// Matrix über [Betriebshof, ...Stopps]: jede Fahrt 10 Minuten, 5 km
const matrix = (n) => ({ minutes: Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === j ? 0 : 10))), km: Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === j ? 0 : 5))) })
const stops = (n, minutes = 50) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, lat: 47.8 + i / 100, lon: 13.0, minutes }))
const driver = { start: '07:00', end: '16:00' }

test('Einstellungen: Vorgabe 30 Minuten nach 6 Stunden, 0 = keine Pause, Grenzen', () => {
  assert.deepEqual(pauseSettings(), { minutes: 30, after: 360 })
  assert.deepEqual(pauseSettings({ pauseMinutes: 0 }), { minutes: 0, after: 360 })
  assert.deepEqual(pauseSettings({ pauseMinutes: '45', pauseAfter: 300 }), { minutes: 45, after: 300 })
  assert.deepEqual(pauseSettings({ pauseMinutes: 500, pauseAfter: 5 }), { minutes: 120, after: 60 })
})

test('Bis 6 Stunden keine Pause; länger: Pause nach dem letzten Stopp, der bis 6 Stunden fertig ist', () => {
  // 5 Stopps à (10 Fahrt + 50 Arbeit) + 10 zurück = 5 h 10
  const short = scheduleRoute({ depot: {}, stops: stops(5), driver, matrix: matrix(5) })
  assert.equal(short.pause, undefined)
  assert.equal(short.end, '12:10')
  // 7 Stopps: Abfahrt s6 13:00 (genau 6 h), s7 14:00, zurück 14:10 → Pause 13:00–13:30 nach s6
  const long = scheduleRoute({ depot: {}, stops: stops(7), driver, matrix: matrix(7) })
  assert.deepEqual(long.pause, { stopId: 's6', from: '13:00', to: '13:30', minutes: 30 })
  assert.deepEqual(long.stops[5].pause, { from: '13:00', to: '13:30', minutes: 30 })
  assert.equal(long.stops[6].arrival, '13:40')
  assert.equal(long.end, '14:40')
  assert.deepEqual(long.problems, [])
  // ohne Pause eingestellt
  assert.equal(scheduleRoute({ depot: {}, stops: stops(7), driver, matrix: matrix(7), settings: { pauseMinutes: 0 } }).end, '14:10')
})

test('Pause verschiebt Stopps über das Zeitfenster bzw. die Arbeitszeit → gemeldet, nicht verschwiegen', () => {
  const list = stops(7)
  list[6].window = { from: '13:00', to: '14:15' }
  const res = scheduleRoute({ depot: {}, stops: list, driver: { start: '07:00', end: '14:30' }, matrix: matrix(7) })
  assert.ok(res.problems.some((p) => p.code === 'zeitfenster' && p.id === 's7'), JSON.stringify(res.problems))
  assert.ok(res.problems.some((p) => p.code === 'arbeitszeit'), JSON.stringify(res.problems))
})

test('Optimierer: Schicht über 6 Stunden um die Pause kürzer; Zeiten der Route mit Pause wie scheduleRoute', () => {
  const list = stops(7)
  // 07:00–14:20: ohne Pause passen alle 7 (zurück 14:10), mit Pause (14:40) nicht mehr
  const res = planRoutes({ depot: {}, stops: list, drivers: [{ id: 'f1', start: '07:00', end: '14:20' }], matrix: matrix(7) })
  assert.equal(res.unassigned.length, 1, JSON.stringify(res.unassigned))
  const off = planRoutes({ depot: {}, stops: list, drivers: [{ id: 'f1', start: '07:00', end: '14:20' }], matrix: matrix(7), settings: { pauseMinutes: 0 } })
  assert.equal(off.unassigned.length, 0)
  const all = planRoutes({ depot: {}, stops: list, drivers: [{ id: 'f1', ...driver }], matrix: matrix(7) })
  const r = all.routes[0]
  assert.ok(r.pause && r.pause.minutes === 30, JSON.stringify(r.pause))
  const order = r.stops.map((s) => list.find((x) => x.id === s.id))
  const again = scheduleRoute({ depot: {}, stops: order, driver, matrix: matrix(7) })
  assert.deepEqual(again.stops, r.stops)
  assert.equal(again.end, r.end)
  assert.deepEqual(again.pause, r.pause)
})

test('Tour: recalcTimes schreibt die Pause an den Stopp und an die Tour; nach dem Kürzen ist sie weg', () => {
  const tour = { id: 't1', stops: stops(7).map((s) => ({ ...s, workMinutes: s.minutes })), route: { shift: { from: '07:00', to: '16:00' }, depot: {} } }
  const ids = ['depot', ...tour.stops.map((s) => s.id)]
  const m = matrix(7)
  const long = recalcTimes(tour, { ids, minutes: m.minutes, km: m.km })
  assert.deepEqual(long.route.pause, { stopId: 's6', from: '13:00', to: '13:30', minutes: 30 })
  assert.deepEqual(long.stops[5].times.pause, { from: '13:00', to: '13:30', minutes: 30 })
  assert.equal(long.stops[4].times.pause, undefined)
  const shortTour = { ...long, stops: long.stops.slice(0, 4) }
  const m4 = matrix(4)
  const short = recalcTimes(shortTour, { ids: ['depot', ...shortTour.stops.map((s) => s.id)], minutes: m4.minutes, km: m4.km })
  assert.equal(short.route.pause, undefined)
  assert.ok(short.stops.every((s) => !s.times.pause))
})
