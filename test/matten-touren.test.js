// Mattenwechsel: Tourenplanung im Büro (P9) – Rechenkern core/matten-touren.js (Bearbeiten, Freigabe-Prüfung,
// Einsätze in Tour und wieder frei, Zusammenführen, Fahrer, Betriebshof, Ladeliste, Google-Maps-Link) und die Ablage
// storage/matten-tourablage.js (eine Datei je Tour, Ordner auflisten, nur Geändertes lesen, eTag, Konflikt). Alle Daten
// erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { jobKey } from '../src/core/matten-plan.js'
import { nextWorkday, untouredSoon, withoutTour } from '../src/core/matten-einsaetze.js'
import { loadList, moveStop, proposeTours, recalcTimes, stopsFromJobs, tourFileName } from '../src/core/matten-tour.js'
import {
  addStop,
  assignJobs,
  dayDriversProblem,
  depotProblem,
  driversForDay,
  driversProblem,
  editableByOffice,
  freeJobs,
  isTourPath,
  keysInTours,
  lockedForOffice,
  mapsLinks,
  mergeOfficeTour,
  newTour,
  normalizeDrivers,
  releaseProblems,
  releaseTour,
  removeStop,
  setShift,
  setVehicle,
  sumLoadLists,
  TourLockedError,
  tourJobKeys,
  toursOn,
  tourYears,
  transferStop,
  vehicleLabel,
  withdrawTour,
} from '../src/core/matten-touren.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { OfficeTourStore } from '../src/storage/matten-tourablage.js'

const DAY = '2026-11-09'
const TODAY = '2026-11-06'
const NOW = '2026-11-06T08:00:00.000Z'
const depot = { name: 'Betriebshof (Beispiel)', address: 'Beispielweg 1, 5020 Salzburg', lat: 47.7745, lon: 13.07 }
const grau = { articleId: 'a-m1', name: 'Matte 85 × 150 grau', size: '85 × 150 cm', color: 'grau' }
const navy = { articleId: 'a-m2', name: 'Matte 60 × 90 navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg', lat: 47.79, lon: 13.005 },
  { id: 'o3', name: 'Bürohaus Nord', address: 'Nordweg 4, 5020 Salzburg', lat: 47.823, lon: 13.03 },
  { id: 'o4', name: 'Lager ohne Koordinaten', address: 'Irgendwo 1, 5020 Salzburg' },
]
const lp = (id, objectId, customer, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats: [{ ...grau, qty: 1, owner: 'wir' }], intervalDays: 14, startDate: DAY, rule: 'rhythmus', workMinutes: 5, ...extra })
const placements = [
  lp('Haupteingang', 'o1', hv, { mats: [{ ...grau, qty: 2, owner: 'wir' }] }),
  lp('Stiege 2', 'o1', hv, { mats: [{ ...navy, qty: 1, owner: 'wir' }] }),
  lp('Tiefgarage', 'o1', hv),
  lp('Schauraum', 'o2', ah, { mats: [{ ...grau, qty: 3, owner: 'wir' }], window: { from: '07:00', to: '09:00' } }),
  lp('Foyer', 'o3', hv),
  lp('Rampe', 'o4', ah),
]
const job = (placementId, due, extra = {}) => ({ id: jobKey(placementId, due), key: jobKey(placementId, due), placementId, due, status: 'geplant', ...extra })
const jobs = [
  job('Haupteingang', DAY),
  job('Stiege 2', DAY),
  job('Tiefgarage', DAY),
  job('Tiefgarage', '2026-11-02', { status: 'nachzuholen', planned: '2026-11-05' }),
  job('Schauraum', DAY),
  job('Foyer', DAY),
  job('Rampe', DAY),
]
let n = 0
const seqId = () => `mt${String(++n).padStart(12, '0')}`
const drivers = [
  { id: 'e1', name: 'Anna Beispiel', email: 'anna@example.invalid', start: '07:00', end: '15:30', vehicleId: 'v1' },
  { id: 'e2', name: 'Ben Muster', start: '07:00', end: '12:00', vehicleId: 'v2' },
]
const propose = async () => {
  n = 0
  const stops = stopsFromJobs({ jobs, placements, objects, date: DAY })
  return proposeTours({ stops, drivers, depot, date: DAY, newId: seqId, now: NOW, by: 'Büro' })
}
const opts = { now: NOW, by: 'Büro' }

// ---------------------------------------------------------------- Ablage, Jahre, Schlüssel

test('Tour-Dateien: Pfad, Jahre des Zeitraums, Touren eines Tages', () => {
  assert.ok(isTourPath('matten/touren/2026/mt0123456789ab.json'))
  assert.ok(!isTourPath('matten/touren/2026/sub/x.json') && !isTourPath('matten/matten.json') && !isTourPath('matten/touren/26/x.json'))
  assert.deepEqual(tourYears('2026-12-28', '2027-01-03'), ['2026', '2027'])
  assert.deepEqual(tourYears(DAY), ['2026'])
  assert.deepEqual(tourYears(''), [])
  const t = (id, date, driverName) => ({ id, date, driverName })
  assert.deepEqual(toursOn([t('a', DAY, 'Ben'), t('b', '2026-11-10', 'Anna'), t('c', DAY, 'Anna')], DAY).map((x) => x.id), ['c', 'a'])
})

test('Einsätze einer Tour; was schon in Touren steht (alte Entwürfe halten nichts fest)', async () => {
  const { tours } = await propose()
  const all = tours.flatMap(tourJobKeys)
  assert.equal(new Set(all).size, all.length)
  assert.ok(all.includes('Tiefgarage:2026-11-02'), 'ältere offene (alsoJobKeys) zählen mit')
  const keys = keysInTours(tours, { except: [tours[0].id], today: TODAY })
  assert.deepEqual([...keys].sort(), tourJobKeys(tours[1]).sort())
  const old = { ...tours[0], date: '2026-11-02' }
  assert.equal(keysInTours([old], { today: TODAY }).size, 0, 'Entwurf eines vergangenen Tages')
  assert.ok(keysInTours([{ ...old, status: 'freigegeben' }], { today: TODAY }).size > 0, 'freigegebene zählen immer')
})

// ---------------------------------------------------------------- Bearbeiten

test('Stopp entfernen, in andere Tour, hinzufügen (gleiches Objekt = derselbe Stopp), Zeiten neu', async () => {
  const { tours } = await propose()
  const [a, b] = tours
  const stopId = a.stops[0].id
  const r = transferStop(a, b, stopId, opts)
  assert.ok(!r.from.stops.some((s) => s.id === stopId) && r.to.stops.at(-1).id === stopId)
  assert.deepEqual(r.to.order, r.to.stops.map((s) => s.id))
  assert.equal(r.to.stops.at(-1).times, undefined, 'Zeiten gelten nicht mehr')
  assert.equal(r.from.route.manual, true)
  const timed = recalcTimes(r.to)
  assert.ok(timed.stops.every((s) => /^\d\d:\d\d$/.test(s.times.arrival)))
  assert.ok(timed.route.km > b.route.km)
  // entfernen und wieder hinzufügen: Objekt o1 mit einem fehlenden Liegeplatz → derselbe Stopp
  const o1 = [...a.stops, ...b.stops].find((s) => s.id === 'st-o1')
  const owner = a.stops.includes(o1) ? a : b
  const part = { ...o1, items: o1.items.filter((it) => it.placementId !== 'Stiege 2') }
  const one = stopsFromJobs({ jobs: [job('Stiege 2', DAY)], placements, objects, date: DAY })[0]
  const t0 = { ...owner, stops: owner.stops.map((s) => (s.id === 'st-o1' ? { ...part, workMinutes: 10, demand: 3 } : s)) }
  const t1 = addStop(t0, one, opts)
  assert.equal(t1.stops.length, t0.stops.length, 'kein zweiter Stopp für dasselbe Objekt')
  const merged = t1.stops.find((s) => s.id === 'st-o1')
  assert.equal(merged.items.length, o1.items.length)
  assert.equal(merged.workMinutes, 15)
  assert.equal(merged.demand, 4)
  assert.deepEqual(merged.mats.map((m) => [m.articleId, m.qty]), [['a-m2', 1], ['a-m1', 3]])
  const t2 = removeStop(t1, 'st-o1', opts)
  assert.equal(t2.stops.length, t1.stops.length - 1)
  assert.equal(removeStop(t2, 'gibt-es-nicht'), t2)
  // anderes Objekt: an die gewünschte Stelle
  const foyer = stopsFromJobs({ jobs: [job('Foyer', DAY)], placements, objects, date: DAY })[0]
  const t3 = addStop(removeStop(t1, 'st-o3'), foyer, { index: 0, ...opts })
  assert.equal(t3.stops[0].id, 'st-o3')
  assert.equal(t3.updatedBy, 'Büro')
})

test('Fahrzeug, Arbeitszeit, leere Tour', () => {
  assert.equal(vehicleLabel({ plate: 'S-123AB', label: 'Transporter' }), 'S-123AB · Transporter')
  const t = newTour({ date: DAY, driver: drivers[0], vehicle: { id: 'v1', plate: 'S-123AB', label: 'Transporter' }, depot, newId: () => 'mt000000000099', ...opts })
  assert.deepEqual([t.id, t.status, t.driverId, t.driverEmail, t.vehicleId, t.vehicleLabel, t.stops.length], ['mt000000000099', 'entwurf', 'e1', 'anna@example.invalid', 'v1', 'S-123AB · Transporter', 0])
  assert.deepEqual(t.route.shift, { from: '07:00', to: '15:30' })
  assert.deepEqual(t.route.depot, depot)
  assert.equal(tourFileName(t), 'matten/touren/2026/mt000000000099.json')
  const v = setVehicle(t, null, opts)
  assert.equal(v.vehicleId, '')
  assert.equal(v.vehicleLabel, undefined)
  const s = setShift(t, { from: '06:00', to: '13:00', capacity: '30' }, opts)
  assert.deepEqual([s.route.shift, s.route.capacity], [{ from: '06:00', to: '13:00' }, 30])
  assert.equal(setShift(s, { from: 'x', capacity: '' }, opts).route.capacity, undefined)
  assert.equal(setShift(s, { from: 'x' }, opts).route.shift.from, '06:00')
})

// ---------------------------------------------------------------- Freigabe

test('Freigabe: Prüfung (Fahrer, Stopps, Tag, doppelt, offen), Status, Einsätze in Tour und wieder frei', async () => {
  const { tours } = await propose()
  const [a, b] = tours
  assert.deepEqual(releaseProblems({ tour: a, tours, jobs, today: TODAY }), [])
  // ohne Fahrer, leer, vergangen, schon freigegeben
  const codes = (t, extra = {}) => releaseProblems({ tour: t, tours, jobs, today: TODAY, ...extra }).map((p) => p.code)
  assert.deepEqual(codes({ ...a, driverId: '' }), ['fahrer'])
  assert.deepEqual(codes({ ...a, stops: [] }), ['stopps'])
  assert.deepEqual(codes(a, { today: '2026-11-10' }), ['tag'])
  assert.deepEqual(codes({ ...a, status: 'freigegeben' }), ['status'])
  // derselbe Einsatz in zwei Touren
  const dup = addStop(b, a.stops[0], opts)
  const p = releaseProblems({ tour: dup, tours: [a, dup], jobs, today: TODAY })
  assert.ok(p.length >= 1 && p.every((x) => x.code === 'doppelt' && x.tourId === a.id))
  assert.match(p[0].text, /steht schon in der Tour von Anna Beispiel am 09\.11\.2026 \(Entwurf\)/)
  // Einsatz schon erledigt bzw. in einer anderen (freigegebenen) Tour bzw. gelöscht
  const k = tourJobKeys(a)[0]
  assert.deepEqual(codes(a, { jobs: jobs.map((j) => (j.key === k ? { ...j, status: 'erledigt' } : j)) }), ['offen'])
  assert.deepEqual(codes(a, { jobs: jobs.map((j) => (j.key === k ? { ...j, status: 'in-tour', tourId: 'mtanders' } : j)) }), ['doppelt'])
  assert.deepEqual(codes(a, { jobs: jobs.filter((j) => j.key !== k) }), ['einsatz'])

  const rel = releaseTour(a, { ...opts, driver: drivers[0] })
  assert.deepEqual([rel.status, rel.releasedBy, rel.releasedAt, rel.driverEmail], ['freigegeben', 'Büro', NOW, 'anna@example.invalid'])
  assert.ok(!editableByOffice(rel) && editableByOffice(a))
  const changed = assignJobs(jobs, rel, opts)
  assert.deepEqual(changed.map((j) => j.key).sort(), tourJobKeys(a).sort())
  assert.ok(changed.every((j) => j.status === 'in-tour' && j.tourId === a.id && j.id === j.key && j.updatedBy === 'Büro'))
  const late = changed.find((j) => j.key === 'Tiefgarage:2026-11-02')
  if (late) assert.equal(late.beforeTour, 'nachzuholen')
  // ein zweites Mal: nichts zu ändern; Einsätze anderer Touren bleiben
  const after = jobs.map((j) => changed.find((c) => c.key === j.key) || j)
  assert.deepEqual(assignJobs(after, rel, opts), [])
  assert.deepEqual(codes(b, { jobs: after, tours: [rel, b] }), [], 'die zweite Tour bleibt freigebbar')
  // zweite Freigabe desselben Einsatzes verhindert
  assert.deepEqual([...new Set(codes(addStop(b, a.stops[0], opts), { jobs: after, tours: [rel] }))], ['doppelt'])
  // zurücknehmen: wieder Entwurf, Einsätze frei mit dem Status davor
  const back = withdrawTour(rel, opts)
  assert.deepEqual([back.status, back.releasedAt, back.releasedBy], ['entwurf', undefined, undefined])
  const freed = freeJobs(after, back, opts)
  assert.equal(freed.length, changed.length)
  for (const j of freed) {
    const before = jobs.find((x) => x.key === j.key)
    assert.equal(j.status, before.status)
    assert.ok(!('tourId' in j) && !('beforeTour' in j))
  }
  assert.deepEqual(freeJobs(jobs, 'mtanders', opts), [])
})

test('Zusammenführen bei gleichzeitiger Änderung: je Feld, Reihenfolge als Ganzes, unterwegs gesperrt', async () => {
  const { tours } = await propose()
  const base = tours[0]
  const mine = { ...moveStop(base, 0, base.stops.length - 1, opts), vehicleId: 'v9' }
  const theirs = { ...base, driverName: 'Anna B.', updatedBy: 'Kollegin' }
  const m = mergeOfficeTour(base, mine, theirs)
  assert.deepEqual(m.order, mine.order, 'meine Reihenfolge')
  assert.equal(m.vehicleId, 'v9')
  assert.equal(m.driverName, 'Anna B.', 'ihre Änderung bleibt')
  assert.equal(m.updatedBy, 'Büro')
  // beide ändern die Reihenfolge: meine gilt ganz
  const theirs2 = moveStop(base, 1, 0, { now: NOW, by: 'Kollegin' })
  assert.deepEqual(mergeOfficeTour(base, mine, theirs2).order, mine.order)
  // nur sie: ihre Reihenfolge
  assert.deepEqual(mergeOfficeTour(base, { ...base, vehicleId: 'v9' }, theirs2).order, theirs2.order)
  // ohne Basis: meine Fassung
  assert.deepEqual(mergeOfficeTour(null, mine, theirs).order, mine.order)
  for (const status of ['unterwegs', 'abgeschlossen']) {
    assert.throws(() => mergeOfficeTour(base, mine, { ...theirs, status }), TourLockedError)
    assert.ok(lockedForOffice({ status }))
  }
})

// ---------------------------------------------------------------- Fahrer, Betriebshof

test('Fahrer: Liste säubern, prüfen, Auswahl des Tages', () => {
  const list = normalizeDrivers([{ id: 'd2', name: ' Ben Muster ', email: 'BEN@example.invalid', start: '07:00', end: '12:00', capacity: '0' }, { id: 'd1', name: 'Anna Beispiel', employeeId: 'e1', vehicleId: 'v1', capacity: 30, active: false }, { id: '', name: 'ohne ID' }])
  assert.deepEqual(list.map((d) => [d.id, d.name, d.email, d.capacity, d.active, d.employeeId]), [['d1', 'Anna Beispiel', '', 30, false, 'e1'], ['d2', 'Ben Muster', 'ben@example.invalid', null, true, undefined]])
  assert.equal(driversProblem(list), '')
  assert.match(driversProblem([{ name: 'X', email: 'kaputt' }]), /E-Mail/)
  assert.match(driversProblem([{ name: 'X', start: '12:00', end: '08:00' }]), /endet vor/)
  assert.match(driversProblem([{ name: 'X', email: 'x@example.invalid' }, { name: 'Y', email: 'x@example.invalid' }]), /doppelt/)
  const active = list.map((d) => ({ ...d, active: true }))
  const day = driversForDay(active, { d1: { on: true, start: '06:00', vehicleId: 'v7' }, d2: { on: false } }, { workday: { from: '07:30', to: '15:00' } })
  assert.deepEqual(day, [{ id: 'd1', name: 'Anna Beispiel', start: '06:00', end: '15:00', vehicleId: 'v7', capacity: 30 }])
  assert.equal(driversForDay(list, {}).length, 1, 'inaktive nicht')
  assert.equal(driversForDay(active, {}).length, 2, 'ohne Auswahl: alle aktiven')
  assert.match(dayDriversProblem([]), /mindestens einen Fahrer/)
  assert.match(dayDriversProblem([{ name: 'X', start: '10:00', end: '09:00' }]), /Arbeitszeit/)
  assert.match(depotProblem(null), /Betriebshof eintragen/)
  assert.match(depotProblem({ address: 'Beispielweg 1' }), /Koordinaten/)
  assert.equal(depotProblem(depot), '')
})

// ---------------------------------------------------------------- Ladeliste, Google Maps, ohne Tour

test('Ladeliste des Tages, Google-Maps-Link mit Wegpunkten (mehrere Teile bei vielen Stopps)', async () => {
  const { tours } = await propose()
  const day = sumLoadLists(tours.map(loadList))
  assert.deepEqual(day.map((r) => [r.size, r.color, r.qty]), [['60 × 90 cm', 'navy', 1], ['85 × 150 cm', 'grau', 7]], 'Rampe ohne Koordinaten ist nicht eingeplant')
  const t = tours.find((x) => x.stops.length >= 2)
  const [link] = mapsLinks(t)
  const u = new URL(link.url)
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/')
  assert.equal(u.searchParams.get('api'), '1')
  assert.equal(u.searchParams.get('origin'), '47.7745,13.07')
  assert.equal(u.searchParams.get('destination'), '47.7745,13.07')
  assert.equal(u.searchParams.get('travelmode'), 'driving')
  assert.deepEqual(u.searchParams.get('waypoints').split('|'), t.stops.map((s) => (s.lat ? `${s.lat},${s.lon}` : s.address)))
  assert.match(link.url, /waypoints=[^&]*%7C/, 'Trennzeichen kodiert')
  // ohne Koordinaten die Adresse
  const noGeo = { ...t, stops: [{ ...t.stops[0], lat: undefined, lon: undefined, address: 'Musterstraße 3, 5020 Salzburg' }] }
  assert.equal(new URL(mapsLinks(noGeo)[0].url).searchParams.get('waypoints'), 'Musterstraße 3, 5020 Salzburg')
  // 20 Stopps: drei Teile, jeweils höchstens 9 Wegpunkte, lückenlos aneinander
  const many = { ...t, stops: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, lat: 47.7 + i / 100, lon: 13 })) }
  const parts = mapsLinks(many)
  assert.equal(parts.length, 3)
  for (const p of parts) assert.ok((new URL(p.url).searchParams.get('waypoints') || '').split('|').length <= 9)
  assert.deepEqual(parts.map((p) => [p.from, p.to]), [[1, 10], [10, 20], [20, 20]])
  assert.equal(new URL(parts[1].url).searchParams.get('origin'), new URL(parts[0].url).searchParams.get('destination'))
  assert.equal(new URL(parts[2].url).searchParams.get('destination'), '47.7745,13.07')
  assert.deepEqual(mapsLinks({ ...t, stops: [] }), [])
})

test('Morgen fällige Einsätze ohne freigegebene Tour', () => {
  const list = [job('Haupteingang', DAY), job('Foyer', DAY, { status: 'in-tour', tourId: 'mt1' }), job('Rampe', '2026-11-01', { planned: DAY, status: 'nachzuholen' }), job('Schauraum', DAY, { status: 'erledigt' }), job('Stiege 2', '2026-11-10')]
  assert.deepEqual(withoutTour(list, DAY).map((j) => j.placementId), ['Haupteingang', 'Rampe'])
  // Donnerstag: morgen; Freitag: bis Montag (mit dem Wochenende)
  assert.equal(nextWorkday('2026-11-05'), '2026-11-06')
  assert.equal(nextWorkday('2026-11-06'), '2026-11-09')
  const thu = untouredSoon([job('Foyer', '2026-11-06'), job('Rampe', '2026-11-09')], '2026-11-05')
  assert.deepEqual([thu.date, thu.days, thu.jobs.length, thu.title], ['2026-11-06', ['2026-11-06'], 1, 'Morgen fällige Einsätze ohne freigegebene Tour'])
  const fri = untouredSoon(list, '2026-11-06')
  assert.deepEqual([fri.date, fri.days.length, fri.jobs.map((j) => j.placementId), fri.title], [DAY, 3, ['Haupteingang', 'Rampe'], 'Bis Montag fällige Einsätze ohne freigegebene Tour'])
  assert.equal(untouredSoon(list.map((j) => ({ ...j, status: 'in-tour' })), '2026-11-06').jobs.length, 0)
})

// ---------------------------------------------------------------- Ablage

/** Browser-Speicher wie localStorage (mit key/length), dazu Zähler der Lesezugriffe. */
function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size } }
}
function spyStore() {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const reads = []
  const read = store.read.bind(store)
  store.read = (p) => (reads.push(p), read(p))
  return { store, reads }
}

test('Ablage: eine Datei je Tour, Ordner auflisten, nur Neues und Geändertes lesen, löschen', async () => {
  const { store, reads } = spyStore()
  const office = new OfficeTourStore({ store })
  const { tours } = await propose()
  for (const t of tours) await office.save(t)
  assert.deepEqual((await store.list('matten/touren/')).sort(), tours.map(tourFileName).sort())
  assert.equal((await store.read(tourFileName(tours[0]))).data.id, tours[0].id)
  // zweite Sitzung: liest beim ersten Mal alles, danach nur Geändertes
  const other = new OfficeTourStore({ store })
  reads.length = 0
  await other.load(['2026'])
  assert.equal(other.tours().length, tours.length)
  assert.equal(reads.length, tours.length)
  reads.length = 0
  await other.load(['2026'])
  assert.equal(reads.length, 0, 'schon geladen')
  await office.save({ ...tours[0], vehicleId: 'v5' })
  await other.load(['2026'], { force: true })
  assert.deepEqual(reads, [tourFileName(tours[0])], 'nur die geänderte Datei')
  assert.equal(other.byId(tours[0].id).vehicleId, 'v5')
  // anderes Jahr: leerer Ordner
  await other.load(['2027'])
  assert.ok(other.loaded('2027'))
  // löschen: nur, wenn die Prüfung am frischen Stand nichts meldet
  await assert.rejects(other.remove(tours[1], { check: () => 'Die Tour ist schon unterwegs.' }), /unterwegs/)
  assert.ok(await other.remove(tours[1], { check: (t) => (t.status === 'entwurf' ? '' : 'nein') }))
  assert.equal(await store.read(tourFileName(tours[1])), null)
  await office.load(['2026'], { force: true })
  assert.equal(office.byId(tours[1].id), null, 'gelöscht: auch in der anderen Sitzung weg')
})

test('Ablage: gleichzeitig geändert → zusammengeführt (eine Stelle), unterwegs → gesperrt, Schreibrecht', async () => {
  const { store } = spyStore()
  const a = new OfficeTourStore({ store })
  const b = new OfficeTourStore({ store })
  const { tours } = await propose()
  const t = tours[0]
  await a.save(t)
  await b.load(['2026'])
  // a ändert die Reihenfolge, b (veraltet) das Fahrzeug
  await a.save(moveStop(a.byId(t.id), 0, 1, opts))
  const saved = await b.save({ ...b.byId(t.id), vehicleId: 'v9' })
  assert.equal(saved.vehicleId, 'v9')
  const stored = (await store.read(tourFileName(t))).data
  assert.deepEqual([stored.vehicleId, stored.order], ['v9', a.byId(t.id).order], 'beide Änderungen da')
  // eigene Zusammenführung (z. B. später mergeTour) wird benutzt
  const calls = []
  const c = new OfficeTourStore({ store, merge: (base, mine, theirs) => (calls.push([base?.id, mine.id, theirs.id]), { ...theirs, note: 'zusammengeführt' }) })
  await c.load(['2026'])
  await a.save({ ...a.byId(t.id), vehicleId: 'v8' })
  await c.save({ ...c.byId(t.id), vehicleId: 'v2' })
  assert.equal(calls.length, 1)
  assert.equal((await store.read(tourFileName(t))).data.note, 'zusammengeführt')
  // der Fahrer hat inzwischen gestartet: das Büro schreibt nicht mehr
  await b.load(['2026'], { force: true })
  const cur = (await store.read(tourFileName(t)))
  await store.write(tourFileName(t), { ...cur.data, status: 'unterwegs' }, cur.etag)
  await assert.rejects(b.save({ ...b.byId(t.id), vehicleId: 'v3' }), TourLockedError)
  assert.equal(b.byId(t.id).status, 'unterwegs', 'danach gilt der Stand der Ablage')
  assert.equal((await store.read(tourFileName(t))).data.vehicleId, cur.data.vehicleId)
  // ohne Schreibrecht nichts
  const ro = new OfficeTourStore({ store, canWrite: () => false })
  await assert.rejects(ro.save(tours[1]), /Keine Schreibrechte/)
  assert.equal(await store.read(tourFileName(tours[1])), null)
})

test('Ablage: mehrere Änderungen schnell hintereinander werden der Reihe nach geschrieben', async () => {
  const { store } = spyStore()
  const office = new OfficeTourStore({ store })
  const { tours } = await propose()
  const t = tours[0]
  await office.save(t)
  const p = []
  let cur = office.byId(t.id)
  for (const v of ['v1', 'v2', 'v3']) {
    cur = { ...cur, vehicleId: v }
    p.push(office.save(cur))
  }
  await Promise.all(p)
  assert.equal((await store.read(tourFileName(t))).data.vehicleId, 'v3')
  assert.equal(office.local.size, 0)
})
