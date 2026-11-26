// Umplanung am Tag (core/matten-umplanung.js): welche Stopps sich abgeben lassen, raus aus der Quelltour (mit Vermerk),
// rein in die Zieltour (nie in einen angefangenen Stopp), Einsätze auf die Zieltour, Doppelte erkennen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateStops, handoverProblems, handoverTargets, jobsAfterHandover, movableProblem, movableStops, moveStopsIn, moveStopsOut } from '../src/core/matten-umplanung.js'
import { mergeTour } from '../src/core/matten-fahrt.js'

const item = (pl, day = '2026-11-30') => ({ jobKey: `${pl}|${day}`, placementId: pl, placementName: pl, planned: 1, mat: { name: 'Matte' }, status: 'geplant' })
const stop = (id, obj, cust, pls, extra = {}) => ({ id, objectId: obj, objectName: `Objekt ${obj}`, customer: { id: cust, name: `Kunde ${cust}` }, status: 'geplant', items: pls.map((p) => item(p)), workMinutes: 10, times: { arrival: '08:00' }, ...extra })
const A = () => ({ id: 'mtA', date: '2026-11-30', status: 'unterwegs', driverName: 'Anna', order: ['s1', 's2', 's3'], stops: [stop('s1', 'o1', 'c1', ['p1'], { status: 'abgeschlossen' }), stop('s2', 'o2', 'c2', ['p2']), stop('s3', 'o3', 'c3', ['p3', 'p4'])], route: {} })
const B = () => ({ id: 'mtB', date: '2026-11-30', status: 'unterwegs', driverName: 'Bernd', order: ['s1', 'st-o3'], stops: [stop('s1', 'o9', 'c9', ['p9'], { status: 'in-bearbeitung' }), stop('st-o3', 'o3', 'c3', ['p5'], { status: 'in-bearbeitung' })], route: {} })

test('Abgeben nur unberührte Stopps; Ziel gleicher Tag, andere, nicht abgeschlossene Tour', () => {
  const a = A()
  assert.deepEqual(movableStops(a).map((s) => s.id), ['s2', 's3'])
  assert.match(movableProblem(a.stops[0]), /abgeschlossen/)
  assert.match(movableProblem({ ...a.stops[1], status: 'unterwegs' }), /auf dem Weg/)
  assert.match(movableProblem({ ...a.stops[1], items: [{ ...a.stops[1].items[0], photos: [{ path: 'x' }] }] }), /Fotos/)
  assert.match(movableProblem({ ...a.stops[1], reports: [{ id: 'r' }] }), /Meldungen/)
  assert.deepEqual(movableStops({ ...a, status: 'entwurf' }), [])
  const tours = [a, B(), { ...B(), id: 'mtC', date: '2026-12-01' }, { ...B(), id: 'mtD', status: 'abgeschlossen' }]
  assert.deepEqual(handoverTargets(tours, a).map((t) => t.id), ['mtB'])
  assert.deepEqual(handoverProblems({ from: a, to: B(), stopIds: ['s2'] }), [])
  assert.match(handoverProblems({ from: a, to: B(), stopIds: ['s1'] }).join(), /abgeschlossen/)
  assert.match(handoverProblems({ from: { ...a, status: 'entwurf' }, to: B(), stopIds: ['s2'] }).join(), /Entwurf/)
  assert.match(handoverProblems({ from: a, to: { ...B(), date: '2026-12-01' }, stopIds: ['s2'] }).join(), /anderen Tag/)
})

test('Raus mit Vermerk, rein als eigener Stopp (nie in einen angefangenen), ohne Zeiten, mit Herkunft', () => {
  const a = A()
  const b = B()
  const out = moveStopsOut(a, ['s2', 's3'], { to: b, now: 'T1', by: 'Petra' })
  assert.deepEqual(out.order, ['s1'])
  assert.deepEqual(out.handovers.map((h) => [h.stopId, h.label, h.toTourId, h.toDriver]), [['s2', 'Kunde c2, Objekt o2', 'mtB', 'Bernd'], ['s3', 'Kunde c3, Objekt o3', 'mtB', 'Bernd']])
  assert.throws(() => moveStopsOut(a, ['s1'], { to: b }), /abgeschlossen/)
  assert.throws(() => moveStopsOut(a, ['sx'], { to: b }), /nicht mehr in der Tour/)
  const into = moveStopsIn(b, a.stops.filter((s) => ['s2', 's3'].includes(s.id)), { from: a, now: 'T1', by: 'Petra' })
  // o3 gibt es in B schon, aber angefangen: eigener Stopp mit freier ID
  assert.deepEqual(into.order, ['s1', 'st-o3', 's2', 's3'])
  const s3 = into.stops.find((s) => s.id === 's3')
  assert.equal(s3.times, undefined)
  assert.deepEqual(s3.handedFrom, { tourId: 'mtA', driverName: 'Anna', at: 'T1', by: 'Petra' })
  // gleiche ID in der Zieltour → freie ID
  const clash = moveStopsIn({ ...b, stops: [stop('s2', 'o7', 'c7', ['p7'], { status: 'abgeschlossen' })] }, [a.stops[1]], { from: a })
  assert.deepEqual(clash.order, ['s2', 's2-c2'])
  // unberührter Stopp desselben Objekts und Kunden in einer freigegebenen Zieltour: Liegeplätze dazu
  const free = { ...b, status: 'freigegeben', stops: [stop('st-o3', 'o3', 'c3', ['p5'])] }
  const merged = moveStopsIn(free, [a.stops[2]], { from: a })
  assert.equal(merged.stops.length, 1)
  assert.deepEqual(merged.stops[0].items.map((i) => i.placementId), ['p5', 'p3', 'p4'])
  assert.equal(merged.stops[0].workMinutes, 20)
})

test('Einsätze: Zieltour freigegeben/unterwegs → in Tour mit deren ID; Entwurf → wieder frei', () => {
  const jobs = [
    { id: 'p2|2026-11-30', key: 'p2|2026-11-30', status: 'in-tour', tourId: 'mtA', beforeTour: 'nachzuholen' },
    { id: 'p3|2026-11-30', key: 'p3|2026-11-30', status: 'in-tour', tourId: 'mtA', beforeTour: 'geplant' },
    { id: 'p9|2026-11-30', key: 'p9|2026-11-30', status: 'in-tour', tourId: 'mtB', beforeTour: 'geplant' },
  ]
  const stops = A().stops.filter((s) => ['s2', 's3'].includes(s.id))
  const live = jobsAfterHandover(jobs, stops, B(), { now: 'T', by: 'P' })
  assert.deepEqual(live.map((j) => [j.key, j.status, j.tourId, j.beforeTour]), [['p2|2026-11-30', 'in-tour', 'mtB', 'nachzuholen'], ['p3|2026-11-30', 'in-tour', 'mtB', 'geplant']])
  const draft = jobsAfterHandover(jobs, stops, { ...B(), status: 'entwurf' })
  assert.deepEqual(draft.map((j) => [j.key, j.status, 'tourId' in j]), [['p2|2026-11-30', 'nachzuholen', false], ['p3|2026-11-30', 'geplant', false]])
})

test('Fahrer arbeitet ohne Netz am abgegebenen Stopp weiter: Stopp kommt zurück → als doppelt gemeldet', () => {
  const base = A()
  const office = moveStopsOut(base, ['s2'], { to: B(), now: '2026-11-30T09:00:00Z', by: 'Petra' })
  const driver = { ...base, stops: base.stops.map((s) => (s.id === 's2' ? { ...s, status: 'in-bearbeitung', updatedAt: '2026-11-30T09:05:00Z' } : s)), updatedAt: '2026-11-30T09:05:00Z' }
  const merged = mergeTour(base, office, driver)
  assert.ok(merged.stops.some((s) => s.id === 's2'), 'Änderung des Fahrers geht vor')
  const b = moveStopsIn(B(), [base.stops[1]], { from: base })
  assert.deepEqual(duplicateStops([merged, b], '2026-11-30').map((d) => [d.key, d.tours.map((t) => t.id)]), [['p2|2026-11-30', ['mtA', 'mtB']]])
  // ohne Weiterarbeiten: weg aus A, keine Doppelten
  const clean = mergeTour(base, office, base)
  assert.ok(!clean.stops.some((s) => s.id === 's2'))
  assert.deepEqual(duplicateStops([clean, b], '2026-11-30'), [])
})
