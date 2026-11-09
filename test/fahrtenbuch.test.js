// Fahrtenbuch: Vorschläge aus Touren, Winterdienst und Dienstplan, Fahrt bestätigen, ändern mit Protokoll,
// stornieren, Lücken im km-Stand, Privat-km im Jahresschnitt, CSV (core/fahrtenbuch.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelTrip, changeText, dismissTrip, editTrip, fahrtenbuchCsv, kmSums, lastKm, makeTrip, parseKmStand, privateAverage, suggestTrips, tripChecks, tripsIn, visitsFromPlan, visitsFromTours, visitsFromWinter } from '../src/core/fahrtenbuch.js'

const vehicles = [
  { id: 'v1', plate: 'S-123AB', driverId: 'e1' },
  { id: 'v2', plate: 'S-456CD', driverId: 'e2' },
  { id: 'v3', plate: 'S-789EF', inactive: true, driverId: 'e3' },
]
const employees = [
  { id: 'e1', name: 'Anna Berger' },
  { id: 'e2', name: 'Ben Huber' },
  { id: 'e3', name: 'Cem Yilmaz' },
]
const objects = [
  { id: 'o1', name: 'Bürohaus Nord', lat: 47.81, lon: 13.04 },
  { id: 'o2', name: 'Praxis Süd', lat: 47.78, lon: 13.06 },
  { id: 'o3', name: 'Lager ohne Ort' },
]
const tour = {
  id: 't1',
  date: '2026-11-03',
  vehicleId: 'v2',
  driverName: 'Ben Huber',
  status: 'abgeschlossen',
  route: { km: 38.4, back: { km: 6.1 }, depot: { name: 'Betriebshof', lat: 47.8, lon: 13.0 } },
  stops: [
    { id: 's1', objectId: 'o1', objectName: 'Bürohaus Nord', lat: 47.81, lon: 13.04, times: { arrival: '08:10' } },
    { id: 's2', objectId: 'o2', objectName: 'Praxis Süd', lat: 47.78, lon: 13.06, times: { arrival: '09:00' } },
  ],
}
let n = 0
const newId = () => `id${++n}`

test('Fahrtenbuch: Besuche aus Touren (ohne Entwürfe), Winterdienst (Person über den Namen) und Dienstplan', () => {
  const t = visitsFromTours([tour, { ...tour, id: 't2', status: 'entwurf' }])
  assert.equal(t.length, 2)
  assert.equal(t[0].tourKm, 44.5)
  assert.equal(t[0].depot.name, 'Betriebshof')
  const w = visitsFromWinter([{ id: 'w1', date: '2026-11-04', objectId: 'o1', person: 'anna berger', at: '2026-11-04T05:10:00Z' }, { id: 'w2', date: '2026-11-04', objectId: 'o2', person: 'Unbekannt' }], { employees, objects })
  assert.deepEqual(w.map((x) => [x.empId, x.name, x.time]), [['e1', 'Bürohaus Nord', '05:10']])
  const p = visitsFromPlan([{ key: 'k1', date: '2026-11-05', start: '17:00', objectId: 'o2', empIds: ['e1', 'e9'] }, { key: 'k2', date: '2026-11-05', objectId: 'o1', empIds: ['e1'], status: 'cancelled' }], { objects, employees, drivers: new Set(['e1']) })
  assert.deepEqual(p.map((x) => [x.empId, x.place]), [['e1', 'o2']])
})

test('Fahrtenbuch: Vorschlag je Fahrzeug und Tag mit Strecke, Zweck und km; erledigte und künftige Tage fallen weg', () => {
  const visits = [
    ...visitsFromTours([tour]),
    ...visitsFromWinter([{ id: 'w1', date: '2026-11-04', objectId: 'o2', person: 'Anna Berger', at: '2026-11-04T06:00:00Z' }, { id: 'w2', date: '2026-11-04', objectId: 'o1', person: 'Anna Berger', at: '2026-11-04T05:00:00Z' }], { employees, objects }),
    ...visitsFromPlan([{ key: 'k1', date: '2026-11-04', start: '17:00', objectId: 'o2', empIds: ['e1'] }, { key: 'k3', date: '2026-11-20', start: '17:00', objectId: 'o2', empIds: ['e1'] }, { key: 'k4', date: '2026-11-04', objectId: 'o1', empIds: ['e3'] }], { objects, employees }),
  ]
  const s = suggestTrips({ visits, vehicles, from: '2026-11-01', to: '2026-11-30', today: '2026-11-09', base: { name: 'Büro', lat: 47.8, lon: 13.0 } })
  assert.deepEqual(s.map((x) => x.key), ['v2|2026-11-03', 'v1|2026-11-04'])
  const [t, w] = s
  assert.equal(t.route, 'Betriebshof – Bürohaus Nord – Praxis Süd – Betriebshof')
  assert.equal(t.kmPlan, 44.5)
  assert.equal(t.purpose, 'Mattenwechsel (2 Stopps)')
  // Winterdienst früh (Reihenfolge nach Uhrzeit), dann Reinigung am Abend; gleiche Stelle hintereinander nur einmal
  assert.equal(w.route, 'Büro – Bürohaus Nord – Praxis Süd – Büro')
  assert.equal(w.purpose, 'Winterdienst (2 Objekte); Reinigung (1 Objekt)')
  assert.ok(w.kmPlan > 5 && w.kmPlan < 20, String(w.kmPlan))
  assert.equal(w.kmUnsure, false)
  assert.equal(w.driver, 'Anna Berger')
  assert.equal(t.late, false)
  // bestätigt bzw. nicht gefahren → kein Vorschlag mehr; älter als 7 Tage → „late“
  const done = [{ id: 'x', suggestion: 'v2|2026-11-03', vehicleId: 'v2', date: '2026-11-03', km: 40 }, dismissTrip(w, { newId })]
  assert.equal(suggestTrips({ visits, vehicles, trips: done, from: '2026-11-01', to: '2026-11-30', today: '2026-11-09' }).length, 0)
  assert.equal(suggestTrips({ visits, vehicles, from: '2026-11-01', today: '2026-11-12' })[0].late, true)
  // stornierte Fahrt bringt den Vorschlag zurück
  assert.equal(suggestTrips({ visits, vehicles, trips: [{ ...done[0], cancelled: { reason: 'falsch' } }], from: '2026-11-01', today: '2026-11-09' }).length, 2)
  // Abstellort des Fahrzeugs als Start und Ende (vor base), Touren behalten ihren Betriebshof
  const withHome = suggestTrips({ visits, vehicles: vehicles.map((v) => (v.id === 'v1' || v.id === 'v2' ? { ...v, home: 'Garage Itzling' } : v)), from: '2026-11-01', today: '2026-11-09', base: { name: 'Büro' } })
  assert.equal(withHome.find((x) => x.vehicleId === 'v1').route, 'Garage Itzling – Bürohaus Nord – Praxis Süd – Garage Itzling')
  assert.equal(withHome.find((x) => x.vehicleId === 'v2').route, 'Betriebshof – Bürohaus Nord – Praxis Süd – Betriebshof')
  // ohne Abstellort und base: Strecke beginnt beim ersten Objekt
  assert.equal(suggestTrips({ visits, vehicles, from: '2026-11-01', today: '2026-11-09' }).find((x) => x.vehicleId === 'v1').route, 'Bürohaus Nord – Praxis Süd')
  // ohne Koordinaten: km unsicher
  const u = suggestTrips({ visits: visitsFromPlan([{ key: 'k', date: '2026-11-02', objectId: 'o3', empIds: ['e1'] }, { key: 'k2', date: '2026-11-02', start: '12:00', objectId: 'o1', empIds: ['e1'] }], { objects, employees }), vehicles, today: '2026-11-09' })
  assert.equal(u[0].kmUnsure, true)
})

test('Fahrtenbuch: Fahrt bestätigen – km aus dem km-Stand, sonst geschätzt; Prüfungen der Eingaben', () => {
  const s = { key: 'v1|2026-11-04', vehicleId: 'v1', date: '2026-11-04', driver: 'Anna Berger', route: 'Büro – Bürohaus Nord – Büro', purpose: 'Winterdienst (1 Objekt)', kmPlan: 12.4, sources: [{ kind: 'winter', ref: 'w1' }] }
  const a = makeTrip({ vehicleId: 'v1', date: s.date, kmStart: '12.300', kmEnd: '12.314,5' }, { suggestion: s, by: 'Büro', now: '2026-11-04T18:00:00Z', newId })
  assert.equal(a.trip.km, 14.5)
  assert.equal(a.trip.kmStart, 12300)
  assert.equal(a.trip.route, s.route)
  assert.equal(a.trip.suggestion, s.key)
  assert.equal(a.trip.kmEstimated, undefined)
  const b = makeTrip({ vehicleId: 'v1', date: s.date }, { suggestion: s, newId })
  assert.equal(b.trip.km, 12.4)
  assert.equal(b.trip.kmEstimated, true)
  assert.match(makeTrip({ vehicleId: 'v1', date: s.date, kmStart: 100, kmEnd: 90 }, { suggestion: s }).error, /kleiner/)
  assert.match(makeTrip({ vehicleId: 'v1', date: s.date, kind: 'dienst' }).error, /km-Stand am Ende/)
  assert.match(makeTrip({ vehicleId: 'v1', date: s.date, km: 10 }).error, /Strecke/)
  const p = makeTrip({ vehicleId: 'v1', date: '2026-11-08', kind: 'privat', km: '35' }, { newId })
  assert.equal(p.trip.purpose, 'Privatfahrt')
  assert.equal(parseKmStand(12345.6), 12345.6)
  assert.equal(parseKmStand('12.345,6'), 12345.6)
})

test('Fahrtenbuch: ändern mit Protokoll, stornieren mit Grund, Lücken und Rücksprünge im km-Stand', () => {
  const t1 = makeTrip({ vehicleId: 'v1', date: '2026-11-03', route: 'A – B', purpose: 'Reinigung', kmStart: 1000, kmEnd: 1020 }, { by: 'Büro', newId }).trip
  const t2 = makeTrip({ vehicleId: 'v1', date: '2026-11-04', route: 'A – C', purpose: 'Reinigung', kmStart: 1050, kmEnd: 1070 }, { by: 'Büro', newId }).trip
  const t3 = makeTrip({ vehicleId: 'v1', date: '2026-11-05', route: 'A – D', purpose: 'Reinigung', kmStart: 1065, kmEnd: 1080 }, { by: 'Büro', newId }).trip
  const checks = tripChecks([t3, t1, t2], 'v1')
  assert.deepEqual(checks.map((c) => [c.level, c.date, c.gap ?? null]), [['warning', '2026-11-04', 30], ['error', '2026-11-05', null]])
  assert.equal(lastKm([t1, t2, t3], 'v1', '2026-11-04'), 1070)
  const e = editTrip(t3, { kmStart: '1.070', kmEnd: '1.085' }, { by: 'Chefin', now: '2026-11-06T08:00:00Z' })
  assert.deepEqual(e.changes, { kmStart: [1065, 1070], kmEnd: [1080, 1085] })
  assert.equal(e.trip.history.length, 1)
  assert.equal(changeText(e.trip.history[0].changes), 'km-Stand Beginn 1065 → 1070; km-Stand Ende 1080 → 1085')
  assert.equal(editTrip(e.trip, { purpose: 'Reinigung' }).trip, e.trip)
  const c = cancelTrip(t1, 'doppelt erfasst', { by: 'Büro', now: '2026-11-06T09:00:00Z' })
  assert.equal(c.trip.cancelled.reason, 'doppelt erfasst')
  assert.match(cancelTrip(c.trip, 'x').error, /schon storniert/)
  assert.match(editTrip(c.trip, { km: 5 }).error, /storniert/)
  assert.match(cancelTrip(t2, ' ').error, /Grund/)
  // storniert zählt nicht, bleibt aber in der Liste
  assert.equal(kmSums([c.trip, t2, e.trip]).total, 35)
  assert.equal(tripsIn([c.trip, t2, e.trip, dismissTrip({ key: 'v1|2026-11-07', vehicleId: 'v1', date: '2026-11-07' }, { newId })], { from: '2026-11-01', to: '2026-11-30' }).length, 3)
})

test('Fahrtenbuch: Privat-km im Jahresschnitt (500 km), CSV mit Storno und Änderungen', () => {
  const mk = (date, kind, km) => makeTrip({ vehicleId: 'v1', date, kind, km, route: 'X – Y', purpose: 'Fahrt' }, { newId }).trip
  const trips = [mk('2026-01-10', 'privat', 400), mk('2026-02-10', 'weg', 500), mk('2026-02-11', 'dienst', 900), mk('2026-03-01', 'privat', 800)]
  assert.deepEqual(privateAverage(trips, 'v1', '2026-02'), { months: 2, privateKm: 900, perMonth: 450, over: false })
  assert.equal(privateAverage(trips, 'v1', '2026-03').over, true)
  assert.equal(privateAverage(trips, 'v2', '2026-03').months, 0)
  const ed = editTrip(trips[2], { purpose: 'Mattenwechsel' }, { by: 'Büro', now: '2026-02-12T10:00:00Z' }).trip
  const st = cancelTrip(trips[0], '=falsch', { by: 'Büro', now: '2026-01-11T10:00:00Z' }).trip
  const csv = fahrtenbuchCsv([st, ed], vehicles)
  const lines = csv.trimEnd().split('\r\n')
  assert.ok(lines[0].startsWith('﻿Datum;Kennzeichen;Fahrer/in;Art;Strecke'))
  assert.match(lines[1], /^2026-01-10;S-123AB;;Privatfahrt;/)
  assert.match(lines[1], /2026-01-11 Büro: =falsch/)
  assert.match(lines[2], /Dienstfahrt;X – Y;Mattenwechsel;;;900;/)
  assert.match(lines[2], /2026-02-12 10:00 Büro: Zweck Fahrt → Mattenwechsel/)
})
