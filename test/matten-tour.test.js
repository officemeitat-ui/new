// Mattenwechsel: Tourvorschlag und Tour-Datenmodell (core/matten-tour.js, P8) – Stopps je Objekt aus den Einsätzen des
// Tages, Tour für zwei Fahrer, mehrere Kunden je Tour, Gebiete getrennt, Rückfall von Google auf den eingebauten Anbieter,
// Ladeliste, Reihenfolge ändern und Zeiten neu rechnen, Probleme, Tour-IDs und Dateiname. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  areaGroups,
  assignDriver,
  loadList,
  moveStop,
  proposeTours,
  recalcTimes,
  stopsFromJobs,
  TOUR_ID_PATTERN,
  tourFileName,
  tourId,
  tourMatrix,
  tourProblems,
} from '../src/core/matten-tour.js'
import { jobKey } from '../src/core/matten-plan.js'
import { navigationUrl, registerRoutingProvider, routingProvider } from '../src/core/routing.js'

const DAY = '2026-11-09'
const NOW = '2026-11-06T08:00:00.000Z'
const depot = { name: 'Betriebshof (Beispiel)', address: 'Werkstraße 1, 5020 Salzburg', lat: 47.7745, lon: 13.07 }

const gross = { articleId: 'a-m1', name: 'Matte 85 × 150 grau', size: '85 × 150 cm', color: 'grau' }
const klein = { articleId: 'a-m2', name: 'Matte 60 × 90 navy', size: '60 × 90 cm', color: 'navy' }
const mat = (m, qty) => ({ ...m, qty, owner: 'wir' })

const kunde = (id, name, no) => ({ id, name, no })
const hv = kunde('c1', 'Hausverwaltung Beispiel GmbH', '10001')
const ah = kunde('c2', 'Autohaus Muster KG', '10002')
const bk = kunde('c3', 'Bäckerei Beispiel OG', '10003')
const pr = kunde('c4', 'Praxis Muster', '10004')

const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg', lat: 47.79, lon: 13.005 },
  { id: 'o3', name: 'Bäckerei Hallein', address: 'Beispielgasse 7, 5400 Hallein', lat: null, lon: null },
  { id: 'o4', name: 'Praxis Anif', address: 'Musterplatz 2, 5081 Anif', lat: 47.742, lon: 13.085 },
  { id: 'o5', name: 'Lager ohne Koordinaten', address: 'Irgendwo 1, 5020 Salzburg' },
  { id: 'o6', name: 'Bürohaus Nord', address: 'Nordweg 4, 5020 Salzburg', lat: 47.823, lon: 13.03 },
]

const lp = (id, objectId, customer, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats: [mat(gross, 1)], intervalDays: 14, startDate: '2026-11-09', rule: 'rhythmus', areaId: 'nord', ...extra })
const placements = [
  // ein Objekt mit drei Liegeplätzen
  lp('Haupteingang', 'o1', hv, { workMinutes: 10, mats: [mat(gross, 2)], window: { from: '07:00', to: '10:00', note: 'vor 10 Uhr' }, floor: 'EG', access: 'Schlüssel beim Hausbesorger', hint: 'alte Matten in den Bus' }),
  lp('Stiege 2', 'o1', hv, { workMinutes: 5, mats: [mat(klein, 1)], window: { from: '08:00', to: '11:00' } }),
  lp('Tiefgarage', 'o1', hv, { mats: [mat(gross, 1), mat(klein, 2)], lat: 47.8, lon: 13.0 }),
  lp('Schauraum', 'o2', ah, { workMinutes: 10, mats: [mat(gross, 3)] }),
  lp('Verkaufsraum', 'o3', bk, { workMinutes: 5, lat: 47.6831, lon: 13.0962, geoQuality: 'werkzeug', areaId: 'sued', window: { from: '05:00', to: '06:00' } }),
  lp('Wartezimmer', 'o4', pr, { workMinutes: 5, areaId: 'sued' }),
  lp('Rampe', 'o5', ah, { workMinutes: 5 }),
  lp('Foyer', 'o6', hv, { workMinutes: 5 }),
  lp('Inaktiv', 'o6', hv, { active: false }),
]
const job = (placementId, due, extra = {}) => ({ key: jobKey(placementId, due), placementId, due, status: 'geplant', ...extra })
const jobs = [
  job('Haupteingang', DAY),
  job('Stiege 2', '2026-11-05', { planned: DAY }), // verschoben auf den Tag
  job('Tiefgarage', '2026-11-02', { status: 'nachzuholen', planned: '2026-11-04' }), // überfällig, nachzuholen
  job('Tiefgarage', DAY),
  job('Schauraum', DAY),
  job('Verkaufsraum', DAY),
  job('Wartezimmer', DAY),
  job('Rampe', DAY),
  job('Foyer', DAY),
  job('Inaktiv', DAY),
  job('Schauraum', '2026-10-26', { status: 'erledigt' }),
  job('Foyer', '2026-11-12'), // anderer Tag
  job('Wartezimmer', '2026-10-26', { status: 'in-tour', planned: DAY }), // schon in einer Tour
]
const day = (extra = {}) => stopsFromJobs({ jobs, placements, objects, date: DAY, ...extra })

// ---------------------------------------------------------------- Stopps

test('Objekt mit 3 fälligen Liegeplätzen = 1 Stopp: Arbeitszeit summiert, Zeitfenster geschnitten, Matten je Typ', () => {
  const stops = day()
  const o1 = stops.filter((s) => s.objectId === 'o1')
  assert.equal(o1.length, 1)
  const s = o1[0]
  assert.equal(s.id, 'st-o1')
  assert.equal(s.workMinutes, 10 + 5 + 5, 'Tiefgarage ohne Arbeitszeit: Vorgabe 5 Minuten')
  assert.deepEqual(s.window, { from: '08:00', to: '10:00' })
  assert.equal(s.windowNote, 'vor 10 Uhr')
  assert.deepEqual(s.mats, [
    { articleId: 'a-m2', name: klein.name, size: '60 × 90 cm', color: 'navy', qty: 3 },
    { articleId: 'a-m1', name: gross.name, size: '85 × 150 cm', color: 'grau', qty: 3 },
  ])
  assert.equal(s.demand, 6)
  assert.deepEqual(s.customer, { id: 'c1', name: hv.name, no: '10001' })
  assert.equal(s.address, 'Beispielweg 12, 5020 Salzburg')
  assert.deepEqual([s.lat, s.lon, s.geoQuality], [47.8095, 13.055, 'objekt'], 'Objekt vor Liegeplatz')
  assert.equal(s.status, 'geplant')
  // ein Eintrag je Liegeplatz und Matte, eingefroren mit allem, was der Fahrer braucht
  assert.deepEqual(s.items.map((i) => [i.placementName, i.mat.articleId, i.planned]), [
    ['Haupteingang', 'a-m1', 2],
    ['Stiege 2', 'a-m2', 1],
    ['Tiefgarage', 'a-m1', 1],
    ['Tiefgarage', 'a-m2', 2],
  ])
  const first = s.items[0]
  assert.deepEqual(first, { jobKey: 'Haupteingang:2026-11-09', placementId: 'Haupteingang', placementName: 'Haupteingang', floor: 'EG', access: 'Schlüssel beim Hausbesorger', hint: 'alte Matten in den Bus', mat: { articleId: 'a-m1', name: gross.name, size: '85 × 150 cm', color: 'grau' }, planned: 2, actual: null, status: 'geplant', due: DAY })
  // Tiefgarage: zwei offene Einsätze (überfällig + heute) = ein Wechsel
  const tg = s.items.find((i) => i.placementId === 'Tiefgarage')
  assert.equal(tg.jobKey, 'Tiefgarage:2026-11-09')
  assert.deepEqual(tg.alsoJobKeys, ['Tiefgarage:2026-11-02'])
  assert.equal(tg.overdue, true)
  assert.equal(s.items[1].due, '2026-11-05', 'verschobener Einsatz behält seinen Solltermin')
})

test('Stopps des Tages: fällig, verschoben, nachzuholen; erledigt, anderer Tag, in Tour, inaktiv und ausgeschlossen nicht', () => {
  const stops = day()
  assert.deepEqual(stops.map((s) => s.id), ['st-o2', 'st-o5', 'st-o3', 'st-o6', 'st-o1', 'st-o4'], 'nach Kunde, dann Objekt')
  const keys = stops.flatMap((s) => s.items.map((i) => i.jobKey))
  assert.ok(!keys.includes('Inaktiv:2026-11-09'))
  assert.ok(!keys.includes('Foyer:2026-11-12'))
  assert.equal(stops.find((s) => s.id === 'st-o4').items.length, 1, 'Einsatz in Tour zählt nicht')
  // ohne überfällige: Tiefgarage nur mit dem heutigen Einsatz
  const tg = day({ overdue: false }).find((s) => s.id === 'st-o1').items.find((i) => i.placementId === 'Tiefgarage')
  assert.equal(tg.alsoJobKeys, undefined)
  assert.equal(tg.overdue, undefined)
  // nur der überfällige: nachzuholen kommt allein in den Tag
  const late = stopsFromJobs({ jobs: [jobs[2]], placements, objects, date: DAY })
  assert.equal(late.length, 1)
  assert.equal(late[0].items[0].jobKey, 'Tiefgarage:2026-11-02')
  // schon in anderen Touren: ausgeschlossen
  assert.equal(day({ exclude: ['Schauraum:2026-11-09'] }).find((s) => s.id === 'st-o2'), undefined)
  // Koordinaten vom Liegeplatz, wenn das Objekt keine hat; ohne beides keine
  const o3 = stops.find((s) => s.id === 'st-o3')
  assert.deepEqual([o3.lat, o3.lon, o3.geoQuality], [47.6831, 13.0962, 'werkzeug'])
  const o5 = stops.find((s) => s.id === 'st-o5')
  assert.equal(o5.lat, undefined)
  assert.deepEqual(stopsFromJobs({ jobs, placements, objects, date: '9.11.2026' }), [])
})

test('Kunde aus der Fakturierung mit Lieferschein-Mail; Zeitfenster ohne Schnittmenge; Liegeplatz ohne Objekt', () => {
  const customers = [{ id: 'c1', name: 'Hausverwaltung Beispiel GmbH', customerNo: '10001', email: 'rechnung@example.invalid', deliveryNoteEmail: 'lieferschein@example.invalid' }]
  const s = stopsFromJobs({ jobs, placements, objects, customers, date: DAY }).find((x) => x.id === 'st-o1')
  assert.deepEqual(s.customer, { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001', deliveryNoteEmail: 'lieferschein@example.invalid' })
  const ps = [lp('A', 'o4', pr, { window: { from: '07:00', to: '08:00' } }), lp('B', 'o4', pr, { window: { from: '09:00', to: '10:00' } }), lp('C', '', pr, { lat: 47.8, lon: 13.0 })]
  const stops = stopsFromJobs({ jobs: [job('A', DAY), job('B', DAY), job('C', DAY)], placements: ps, objects, date: DAY })
  const conflict = stops.find((x) => x.id === 'st-o4')
  assert.deepEqual(conflict.window, { from: '09:00', to: '08:00' })
  assert.equal(conflict.windowConflict, true)
  const loose = stops.find((x) => x.id === 'st-C')
  assert.equal(loose.objectId, '')
  assert.equal(loose.objectName, 'C')
})

// ---------------------------------------------------------------- Tourvorschlag

let counter = 0
const seqId = () => `mt${String(++counter).padStart(12, '0')}`
const drivers = [
  { id: 'e1', name: 'Anna Beispiel', start: '07:00', end: '15:30', vehicleId: 'v1', capacity: 40 },
  { id: 'e2', name: 'Ben Muster', start: '07:00', end: '12:00', vehicleId: 'v2' },
]

test('Tour für 2 Fahrer: Entwurf mit Reihenfolge, Zeiten, Route; Objekt mit 3 Liegeplätzen = 1 Stopp; Rest mit Grund', async () => {
  counter = 0
  const stops = day()
  const res = await proposeTours({ stops, drivers, depot, date: DAY, newId: seqId, now: NOW, by: 'Büro' })
  assert.equal(res.provider, 'luftlinie')
  assert.equal(res.notice, undefined)
  assert.equal(res.tours.length, 2)
  const [t1, t2] = res.tours
  assert.equal(t1.id, 'mt000000000001')
  assert.deepEqual([t1.driverId, t1.driverName, t1.vehicleId, t1.status, t1.schema, t1.date], ['e1', 'Anna Beispiel', 'v1', 'entwurf', 1, DAY])
  assert.equal(t2.driverId, 'e2')
  for (const t of res.tours) {
    assert.deepEqual(t.order, t.stops.map((s) => s.id))
    assert.equal(t.route.provider, 'luftlinie')
    assert.ok(t.route.km > 0 && t.route.minutes > 0)
    assert.deepEqual(t.route.depot, depot)
    assert.ok(t.stops.every((s) => /^\d\d:\d\d$/.test(s.times.arrival) && s.times.departure >= s.times.start))
    assert.deepEqual(tourProblems(t), [])
    assert.equal(t.createdBy, 'Büro')
  }
  assert.deepEqual(t1.route.shift, { from: '07:00', to: '15:30' })
  assert.equal(t1.route.capacity, 40)
  assert.equal(t2.route.capacity, undefined)
  const planned = res.tours.flatMap((t) => t.order)
  assert.equal(new Set(planned).size, planned.length, 'kein Stopp doppelt')
  assert.equal(planned.filter((id) => id === 'st-o1').length, 1)
  const o1 = res.tours.flatMap((t) => t.stops).find((s) => s.id === 'st-o1')
  assert.ok(o1.times.start >= '08:00' && o1.times.departure <= '10:00', `${o1.times.start}–${o1.times.departure}`)
  assert.deepEqual(res.unassigned.map((u) => [u.stopId, u.reason]).sort(), [['st-o3', 'zeitfenster'], ['st-o5', 'koordinaten']])
  assert.equal(res.unassigned.find((u) => u.stopId === 'st-o5').stop.objectName, 'Lager ohne Koordinaten')
  assert.equal(planned.length + res.unassigned.length, stops.length)
})

test('Mehrere Kunden je Tour; Fahrer ohne Arbeitszeit nach den Einstellungen; deterministisch', async () => {
  const stops = day().filter((s) => s.lat !== undefined && s.id !== 'st-o3')
  const settings = { workday: { from: '06:30', to: '14:00' } }
  counter = 0
  const res = await proposeTours({ stops, drivers: [{ id: 'e1', name: 'Anna Beispiel' }], depot, settings, date: DAY, newId: seqId, now: NOW })
  assert.equal(res.tours.length, 1)
  const t = res.tours[0]
  assert.deepEqual(t.route.shift, { from: '06:30', to: '14:00' })
  assert.equal(t.stops.length, stops.length)
  assert.ok(new Set(t.stops.map((s) => s.customer.id)).size >= 3, 'Stopps mehrerer Kunden in einer Tour')
  counter = 0
  const again = await proposeTours({ stops, drivers: [{ id: 'e1', name: 'Anna Beispiel' }], depot, settings, date: DAY, newId: seqId, now: NOW })
  assert.deepEqual(again, res)
  // Betriebshof aus den Einstellungen
  const viaSettings = await proposeTours({ stops, drivers: [{ id: 'e1' }], settings: { depot }, date: DAY, newId: seqId })
  assert.equal(viaSettings.tours[0].stops.length, stops.length)
})

test('Nach Gebiet trennen: Fahrer mit Stammgebiet, freie Fahrer zum Gebiet mit Arbeit, Gebiet ohne Fahrer mit Grund', async () => {
  const stops = day().filter((s) => s.lat !== undefined)
  const groups = areaGroups(stops, [{ id: 'x', areaId: 'sued' }, { id: 'y' }])
  assert.deepEqual(groups.map((g) => [g.areaId, g.drivers.map((d) => d.id)]), [['nord', ['y']], ['sued', ['x']]])
  assert.deepEqual(areaGroups(stops, [{ id: 'y' }]).map((g) => [g.areaId, g.drivers.length]), [['nord', 1], ['sued', 0]])
  const res = await proposeTours({ stops, drivers: [{ id: 'x', areaId: 'sued' }, { id: 'y' }], depot, settings: { splitByArea: true }, date: DAY, newId: seqId })
  for (const t of res.tours) assert.ok(t.stops.every((s) => s.areaId === t.areaId), `${t.areaId}: ${t.stops.map((s) => s.areaId)}`)
  assert.deepEqual(res.tours.map((t) => [t.driverId, t.areaId]).sort(), [['x', 'sued'], ['y', 'nord']])
  const lonely = await proposeTours({ stops, drivers: [{ id: 'y' }], depot, settings: { splitByArea: true }, date: DAY, newId: seqId })
  assert.deepEqual(lonely.unassigned.map((u) => [u.stopId, u.reason]).sort(), [['st-o3', 'gebiet'], ['st-o4', 'gebiet']])
  assert.ok(lonely.tours.every((t) => t.areaId === 'nord'))
})

test('Google eingestellt: Rückfall auf den eingebauten Anbieter mit Hinweis (auch bei Fehler im Anbieter)', async () => {
  const stops = day().filter((s) => s.lat !== undefined && s.id !== 'st-o3')
  const res = await proposeTours({ stops, drivers: drivers.slice(0, 1), depot, settings: { routing: { provider: 'google' } }, date: DAY, newId: seqId })
  assert.equal(res.provider, 'luftlinie')
  assert.match(res.notice, /noch nicht eingerichtet/)
  assert.equal(res.tours[0].route.provider, 'luftlinie')
  assert.match(res.tours[0].notice, /noch nicht eingerichtet/)
  // Anbieter-Objekt direkt übergeben (Google-Stub): wirft → luftlinie
  const direct = await proposeTours({ stops, drivers: drivers.slice(0, 1), depot, provider: routingProvider('google'), date: DAY, newId: seqId })
  assert.equal(direct.provider, 'luftlinie')
  assert.match(direct.notice, /noch nicht eingerichtet/)
  assert.equal(direct.tours[0].stops.length, stops.length)
  // ein angemeldeter Anbieter mit eigenem Ergebnis wird übernommen
  registerRoutingProvider('test-fix', {
    label: 'Test',
    geocode: async () => null,
    matrix: async () => ({ minutes: [], km: [] }),
    optimize: async (p) => ({ provider: 'test-fix', routes: [{ driverId: p.drivers[0].id, stops: p.stops.map((s) => ({ id: s.id, arrival: '08:00', start: '08:00', departure: '08:10', wait: 0, travel: 5, km: 1 })), start: '07:00', end: '12:00', minutes: 10, km: 2, work: 10, wait: 0, load: 1, back: { travel: 5, km: 1 } }], unassigned: [], minutes: 10, km: 2 }),
  })
  const own = await proposeTours({ stops: stops.slice(0, 2), drivers: drivers.slice(0, 1), depot, provider: 'test-fix', date: DAY, newId: seqId })
  assert.equal(own.provider, 'test-fix')
  assert.equal(own.tours[0].route.provider, 'test-fix')
})

// ---------------------------------------------------------------- Hilfen

test('Ladeliste je Größe/Farbe über alle Stopps', async () => {
  const stops = day().filter((s) => ['st-o1', 'st-o2', 'st-o6'].includes(s.id))
  const { tours } = await proposeTours({ stops, drivers: drivers.slice(0, 1), depot, date: DAY, newId: seqId })
  assert.deepEqual(loadList(tours[0]), [
    { articleId: 'a-m2', name: klein.name, size: '60 × 90 cm', color: 'navy', qty: 3, stops: 1 },
    { articleId: 'a-m1', name: gross.name, size: '85 × 150 cm', color: 'grau', qty: 3 + 3 + 1, stops: 3 },
  ])
  assert.deepEqual(loadList({}), [])
})

test('Reihenfolge ändern, Fahrer zuweisen, Zeiten neu rechnen, Probleme erkennen', async () => {
  const stops = day().filter((s) => ['st-o1', 'st-o2', 'st-o4', 'st-o6'].includes(s.id))
  const { tours } = await proposeTours({ stops, drivers: drivers.slice(0, 1), depot, date: DAY, newId: seqId, now: NOW })
  const tour = tours[0]
  assert.deepEqual(tourProblems(tour), [])
  // Stopp mit Zeitfenster bis 10:00 ans Ende, dazu lange Arbeit davor → nach dem Neurechnen zu spät
  const last = tour.stops.length - 1
  const original = JSON.stringify(tour)
  let moved = moveStop(tour, 'st-o1', last, { now: NOW, by: 'Büro' })
  assert.equal(moved.order[last], 'st-o1')
  assert.deepEqual(moved.order, moved.stops.map((s) => s.id))
  assert.equal(moved.route.manual, true)
  assert.equal(moved.updatedBy, 'Büro')
  assert.equal(JSON.stringify(tour), original, 'Original unverändert')
  moved = { ...moved, stops: moved.stops.map((s) => (s.id === 'st-o1' ? s : { ...s, workMinutes: 60 })) }
  const late = recalcTimes(moved)
  assert.ok(late.stops[last].times.departure > '10:00', late.stops[last].times.departure)
  assert.deepEqual(tourProblems(late).map((p) => [p.code, p.stopId]), [['zeitfenster', 'st-o1']])
  // zurück an den Anfang: passt wieder
  const back = recalcTimes(moveStop(late, last, 0))
  assert.equal(back.order[0], 'st-o1')
  assert.deepEqual(tourProblems(back), [])
  assert.equal(moveStop(tour, 9, 0), tour, 'ungültiger Index ändert nichts')
  assert.equal(moveStop(tour, 'st-o1', 'gibtsnicht'), tour)
  // Zeiten mit einer Matrix des Anbieters (nach IDs) = Luftlinie direkt
  const m = await tourMatrix(tour)
  assert.equal(m.ids[0], 'depot')
  assert.deepEqual(recalcTimes(moveStop(tour, 0, 2, { now: NOW }), m), recalcTimes(moveStop(tour, 0, 2, { now: NOW })))
  // anderer Fahrer mit kürzerer Arbeitszeit → Arbeitszeit überschritten; ohne Fahrer → Hinweis
  const short = recalcTimes(assignDriver(tour, { id: 'e3', name: 'Cem Beispiel', start: '07:00', end: '08:00', capacity: 2 }))
  assert.deepEqual([short.driverId, short.driverName, short.vehicleId, short.route.capacity], ['e3', 'Cem Beispiel', 'v1', 2])
  assert.deepEqual(tourProblems(short).map((p) => p.code), ['arbeitszeit', 'kapazitaet'])
  assert.deepEqual(tourProblems(assignDriver(tour, null)).map((p) => p.code), ['fahrer'])
  // Stopp ohne Koordinaten (von Hand dazu genommen)
  const withLoose = recalcTimes({ ...tour, stops: [...tour.stops, day().find((s) => s.id === 'st-o5')] })
  assert.deepEqual(tourProblems(withLoose).map((p) => [p.code, p.stopId]), [['koordinaten', 'st-o5']])
  assert.equal(navigationUrl(tour.stops[0]), `https://www.google.com/maps/dir/?api=1&destination=${tour.stops[0].lat},${tour.stops[0].lon}`)
})

test('Tour-IDs zufällig und eindeutig, Dateiname matten/touren/<Jahr>/<TourId>.json', () => {
  const many = new Set(Array.from({ length: 200 }, () => tourId()))
  assert.equal(many.size, 200)
  for (const id of many) assert.match(id, TOUR_ID_PATTERN)
  assert.equal(tourId(() => [0, 1, 2, 171, 205, 239]), 'mt000102abcdef')
  assert.equal(tourFileName({ id: 'mt000102abcdef', date: '2026-11-09' }), 'matten/touren/2026/mt000102abcdef.json')
  assert.equal(tourFileName({ id: 'mt1', date: '2027-01-04' }), 'matten/touren/2027/mt1.json')
  assert.throws(() => tourFileName({ id: '../x', date: '2026-11-09' }), /ID/)
  assert.throws(() => tourFileName({ id: 'mt1', date: '' }), /Datum/)
})
