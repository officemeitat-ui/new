// Routing-Schnittstelle (core/routing.js, Mattenwechsel P8): Matrix aus der Luftlinie, Optimierung für mehrere Fahrer mit
// Zeitfenstern, Arbeitszeit und Kapazität, Gründe für nicht eingeplante Stopps, Anbieter-Register mit Rückfall von Google
// auf den eingebauten Anbieter, Navigation-Link, Determinismus und Laufzeit. Alle Orte erfunden (Raum Salzburg).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { estimateTravel, haversineKm } from '../src/core/geo.js'
import {
  airMatrix,
  createGoogleProvider,
  createLuftlinieProvider,
  googleRequest,
  navigationUrl,
  planRoutes,
  registerRoutingProvider,
  routingFor,
  routingProvider,
  routingProviders,
  RoutingError,
  scheduleRoute,
} from '../src/core/routing.js'

const depot = { lat: 47.7745, lon: 13.07 }
const stadt = { lat: 47.8095, lon: 13.055 }
const hallein = { lat: 47.6831, lon: 13.0962 }

/** Zufallszahlen mit festem Startwert: gleiche Testdaten bei jedem Lauf. */
function lcg(seed) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}
/** n Stopps verstreut um Salzburg (Breite 47,70–47,86, Länge 12,95–13,17). */
function scatter(n, seed = 7, extra = () => ({})) {
  const r = lcg(seed)
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, lat: 47.7 + r() * 0.16, lon: 12.95 + r() * 0.22, minutes: 5 + Math.floor(r() * 10), demand: 1 + Math.floor(r() * 3), ...extra(i, r) }))
}
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const ids = (res) => res.routes.flatMap((r) => r.stops.map((s) => s.id))

// ---------------------------------------------------------------- Matrix

test('Matrix: symmetrisch, Diagonale 0, gleiche Annahmen wie estimateTravel, fehlende Koordinaten null', () => {
  const pts = [depot, stadt, hallein, { lat: 47.8096, lon: 13.0551 }, { name: 'ohne' }]
  const m = airMatrix(pts)
  for (let i = 0; i < 4; i++) {
    assert.equal(m.minutes[i][i], 0)
    for (let j = 0; j < 4; j++) {
      assert.equal(m.minutes[i][j], m.minutes[j][i], `Minuten ${i}/${j}`)
      assert.equal(m.km[i][j], m.km[j][i], `km ${i}/${j}`)
    }
  }
  assert.deepEqual(m.missing, [4])
  assert.equal(m.minutes[1][4], null)
  assert.equal(m.minutes[4][4], null)
  assert.equal(m.minutes[1][3], 0, 'unter 100 m: 0 Minuten')
  // plausibel: Straße = Luftlinie × 1,35; 35 km/h + 5 Minuten Zuschlag
  const air = haversineKm(depot, hallein)
  assert.ok(Math.abs(m.km[0][2] - air * 1.35) < 0.1, String(m.km[0][2]))
  assert.equal(m.minutes[0][2], Math.ceil(5 + ((air * 1.35) / 35) * 60))
  assert.ok(m.minutes[0][2] > m.minutes[0][1], 'Hallein weiter als die Stadt')
  // auf 5 Minuten gerundet genau wie estimateTravel; Einstellungen überschreibbar
  const five = airMatrix(pts, { roundMin: 5 })
  assert.equal(five.minutes[1][2], estimateTravel(stadt, hallein).minutes)
  assert.equal(five.km[1][2], estimateTravel(stadt, hallein).km)
  const fast = airMatrix(pts, { speedKmh: 70, baseMin: 0, detour: 1 })
  assert.equal(fast.minutes[0][2], Math.ceil((air / 70) * 60))
})

test('Navigation: Google-Maps-Link mit Koordinaten, sonst Adresse kodiert', () => {
  assert.equal(navigationUrl({ lat: 47.8095, lon: 13.055, address: 'Beispielweg 1' }), 'https://www.google.com/maps/dir/?api=1&destination=47.8095,13.055')
  assert.equal(navigationUrl({ address: 'Beispielgasse 7, 5400 Hallein' }), 'https://www.google.com/maps/dir/?api=1&destination=Beispielgasse%207%2C%205400%20Hallein')
  assert.equal(navigationUrl({ lat: null, lon: 13, address: 'Muster-Allee 5 & Hof' }), 'https://www.google.com/maps/dir/?api=1&destination=Muster-Allee%205%20%26%20Hof')
  assert.equal(navigationUrl({}), '')
})

// ---------------------------------------------------------------- Optimierung

test('Optimierung: deutlich kürzer als die Eingabereihenfolge, jeder Stopp genau einmal', () => {
  const stops = scatter(30)
  const driver = { id: 'f1', start: '06:00', end: '20:00' }
  const before = scheduleRoute({ depot, stops, driver })
  const res = planRoutes({ depot, stops, drivers: [driver] })
  assert.equal(res.unassigned.length, 0)
  assert.deepEqual([...ids(res)].sort(), stops.map((s) => s.id).sort())
  assert.ok(res.minutes < before.minutes * 0.6, `optimiert ${res.minutes} Min., Eingabe ${before.minutes} Min.`)
  assert.ok(res.km < before.km * 0.6, `optimiert ${res.km} km, Eingabe ${before.km} km`)
  // Zeiten der Route stimmen mit dem Zeitplan der gefundenen Reihenfolge überein
  const order = res.routes[0].stops.map((s) => stops.find((x) => x.id === s.id))
  const again = scheduleRoute({ depot, stops: order, driver })
  assert.deepEqual(again.stops, res.routes[0].stops)
  assert.equal(again.end, res.routes[0].end)
  assert.deepEqual(again.problems, [])
})

test('Zeitfenster: Arbeit im Fenster; unerreichbares Fenster und leere Schnittmenge → nicht eingeplant mit Grund', () => {
  const stops = scatter(12, 11, (i) => (i === 3 ? { window: { from: '07:00', to: '07:50' } } : i === 7 ? { window: { from: '11:00', to: '12:00' } } : i === 9 ? { window: { from: '09:00', to: '10:00' } } : {}))
  stops.push({ id: 'frueh', ...stadt, minutes: 10, window: { from: '05:00', to: '06:30' } })
  stops.push({ id: 'leer', ...hallein, minutes: 10, window: { from: '10:00', to: '09:00' } })
  const res = planRoutes({ depot, stops, drivers: [{ id: 'f1', start: '07:00', end: '15:30' }] })
  const done = res.routes[0].stops
  for (const s of done) {
    const w = stops.find((x) => x.id === s.id).window
    if (!w) continue
    assert.ok(toMin(s.start) >= toMin(w.from), `${s.id} beginnt ${s.start}, Fenster ab ${w.from}`)
    assert.ok(toMin(s.departure) <= toMin(w.to), `${s.id} fertig ${s.departure}, Fenster bis ${w.to}`)
  }
  assert.ok(done.some((s) => s.id === 's4') && done.some((s) => s.id === 's8') && done.some((s) => s.id === 's10'))
  assert.ok(done.findIndex((s) => s.id === 's4') < done.findIndex((s) => s.id === 's10'), 'frühes Fenster zuerst')
  assert.ok(done.find((s) => s.id === 's8').wait >= 0)
  assert.deepEqual(res.unassigned.map((u) => [u.id, u.reason]), [['frueh', 'zeitfenster'], ['leer', 'zeitfenster']])
  assert.match(res.unassigned[0].text, /05:00–06:30/)
  assert.match(res.unassigned[1].text, /überschneiden sich nicht/)
})

test('Arbeitszeit-Ende: Rückkehr vor dem Ende, Rest mit Grund; zu weit für die Arbeitszeit', () => {
  const stops = scatter(14, 3, () => ({ minutes: 15 }))
  stops.push({ id: 'weit', lat: 47.71, lon: 13.62, minutes: 10 }) // gut 40 km Luftlinie: hin und zurück über 3 Stunden
  const res = planRoutes({ depot, stops, drivers: [{ id: 'f1', start: '07:00', end: '09:30' }] })
  const r = res.routes[0]
  assert.ok(r.stops.length >= 3, `${r.stops.length} Stopps`)
  assert.ok(toMin(r.end) <= toMin('09:30'), `zurück ${r.end}`)
  assert.equal(r.stops.length + res.unassigned.length, stops.length)
  assert.ok(res.unassigned.every((u) => u.reason === 'arbeitszeit'), JSON.stringify(res.unassigned))
  assert.match(res.unassigned.find((u) => u.id === 'weit').text, /Hin- und Rückfahrt/)
})

test('Kapazität, keine Koordinaten, kein Fahrer, Betriebshof ohne Koordinaten', () => {
  const stops = [
    { id: 'a', ...stadt, minutes: 5, demand: 4 },
    { id: 'b', lat: 47.82, lon: 13.04, minutes: 5, demand: 4 },
    { id: 'c', lat: 47.8, lon: 13.02, minutes: 5, demand: 4 },
    { id: 'gross', lat: 47.79, lon: 13.06, minutes: 5, demand: 12 },
    { id: 'ohne', minutes: 5, demand: 1 },
  ]
  const res = planRoutes({ depot, stops, drivers: [{ id: 'f1', start: '07:00', end: '15:30', capacity: 10 }] })
  assert.equal(res.routes[0].stops.length, 2)
  assert.ok(res.routes[0].load <= 10)
  const why = Object.fromEntries(res.unassigned.map((u) => [u.id, u.reason]))
  assert.equal(Object.values(why).filter((x) => x === 'kapazitaet').length, 2)
  assert.equal(why.gross, 'kapazitaet')
  assert.equal(why.ohne, 'koordinaten')
  assert.match(res.unassigned.find((u) => u.id === 'gross').text, /12 Matten/)
  assert.deepEqual(planRoutes({ depot, stops: stops.slice(0, 2), drivers: [] }).unassigned.map((u) => u.reason), ['fahrer', 'fahrer'])
  assert.deepEqual(planRoutes({ depot, stops: stops.slice(0, 2), drivers: [{ id: 'f', start: '10:00', end: '09:00' }] }).unassigned.map((u) => u.reason), ['fahrer', 'fahrer'])
  assert.deepEqual(planRoutes({ depot: { name: 'ohne' }, stops: stops.slice(0, 1), drivers: [{ id: 'f' }] }).unassigned.map((u) => u.reason), ['betriebshof'])
})

test('Zwei Fahrer teilen 20 Stopps sinnvoll: beide genutzt, je Fahrer ein Gebiet, nichts doppelt', () => {
  const r = lcg(5)
  const nord = Array.from({ length: 10 }, (_, i) => ({ id: `nord${i + 1}`, lat: 47.82 + r() * 0.03, lon: 13.01 + r() * 0.05, minutes: 15, demand: 2 }))
  const sued = Array.from({ length: 10 }, (_, i) => ({ id: `sued${i + 1}`, lat: 47.67 + r() * 0.03, lon: 13.07 + r() * 0.05, minutes: 15, demand: 2 }))
  const stops = nord.flatMap((n, i) => [n, sued[i]]) // gemischte Eingabe
  const drivers = [{ id: 'anna', start: '07:00', end: '15:30' }, { id: 'ben', start: '07:00', end: '15:30' }]
  const res = planRoutes({ depot, stops, drivers })
  assert.equal(res.unassigned.length, 0)
  assert.equal(res.routes.length, 2)
  assert.ok(res.routes.every((x) => x.stops.length > 0), 'beide Fahrer genutzt')
  const all = ids(res)
  assert.equal(new Set(all).size, all.length, 'kein Stopp doppelt')
  assert.equal(all.length, 20)
  for (const route of res.routes) {
    const areas = new Set(route.stops.map((s) => s.id.replace(/\d+$/, '')))
    assert.equal(areas.size, 1, `${route.driverId} fährt nur ein Gebiet: ${route.stops.map((s) => s.id).join(', ')}`)
    assert.ok(toMin(route.end) <= toMin('15:30'))
  }
  // dichtes Gebiet, das ein Fahrer allein nicht schafft: beide genutzt, alle zugeteilt oder begründet
  const dense = scatter(20, 21, () => ({ minutes: 25 }))
  const two = planRoutes({ depot, stops: dense, drivers })
  assert.ok(two.routes.every((x) => x.stops.length >= 5), two.routes.map((x) => x.stops.length).join('/'))
  const got = ids(two)
  assert.equal(new Set(got).size, got.length)
  assert.equal(got.length + two.unassigned.length, 20)
  assert.ok(two.unassigned.every((u) => u.reason && u.text))
})

test('Deterministisch: gleiche Eingabe → gleiches Ergebnis', async () => {
  const stops = scatter(40, 9, (i) => (i % 6 === 0 ? { window: { from: '08:00', to: '11:00' } } : {}))
  const drivers = [{ id: 'a', start: '07:00', end: '15:30', capacity: 40 }, { id: 'b', start: '07:30', end: '14:00', capacity: 30 }]
  const one = planRoutes({ depot, stops, drivers })
  const two = planRoutes({ depot, stops: JSON.parse(JSON.stringify(stops)), drivers: JSON.parse(JSON.stringify(drivers)) })
  assert.deepEqual(two, one)
  assert.deepEqual(await routingProvider('luftlinie').optimize({ depot, stops, drivers }), one)
})

test('Feste Reihenfolge: Verstöße werden gemeldet, nicht korrigiert', () => {
  const stops = [
    { id: 'spaet', ...hallein, minutes: 30, window: { from: '07:00', to: '07:20' } },
    { id: 'ohne', minutes: 10 },
    { id: 'mitte', ...stadt, minutes: 10, demand: 9 },
  ]
  const res = scheduleRoute({ depot, stops, driver: { start: '07:00', end: '08:00', capacity: 5 } })
  const codes = res.problems.map((p) => `${p.code}:${p.id || ''}`)
  assert.deepEqual(codes, ['zeitfenster:spaet', 'koordinaten:ohne', 'arbeitszeit:', 'kapazitaet:'])
  assert.equal(res.stops[1].travel, 0)
  assert.equal(res.stops[1].arrival, res.stops[0].departure)
})

// ---------------------------------------------------------------- Anbieter

test('Anbieter-Register: luftlinie und google angemeldet, eigene Anbieter möglich, unvollständige abgelehnt', async () => {
  assert.ok(routingProviders().includes('luftlinie'))
  assert.ok(routingProviders().includes('google'))
  assert.equal(routingFor().name, 'luftlinie')
  assert.equal(routingFor({ provider: 'luftlinie' }), routingProvider('luftlinie'))
  assert.throws(() => registerRoutingProvider('halb', { geocode: async () => null }), RoutingError)
  assert.throws(() => registerRoutingProvider('', {}), RoutingError)
  const m = await routingProvider('luftlinie').matrix([depot, stadt])
  assert.deepEqual(m, airMatrix([depot, stadt]))
  // ein eingerichteter fremder Anbieter wird benutzt; scheitert er, rechnet der eingebaute mit Hinweis
  const calls = []
  registerRoutingProvider('probe', { label: 'Probe', ready: () => true, geocode: async () => ({ lat: 1, lon: 2, quality: 'adresse' }), matrix: async () => airMatrix([]), optimize: async (p) => (calls.push(p), Promise.reject(new Error('Zeitüberschreitung'))) })
  const probe = routingFor({ provider: 'probe' })
  assert.equal(probe.name, 'probe')
  assert.deepEqual(await probe.geocode('x'), { lat: 1, lon: 2, quality: 'adresse' })
  const res = await probe.optimize({ depot, stops: [{ id: 'a', ...stadt, minutes: 5 }], drivers: [{ id: 'f' }] })
  assert.equal(calls.length, 1)
  assert.equal(res.provider, 'luftlinie')
  assert.match(res.notice, /Probe: Zeitüberschreitung/)
  assert.equal(routingFor({ provider: 'gibtsnicht' }).name, 'luftlinie')
  assert.match(routingFor({ provider: 'gibtsnicht' }).notice, /unbekannt/)
})

test('Google: nur Schnittstelle, wirft „noch nicht eingerichtet“, die Fabrik fällt auf luftlinie zurück; kein Schlüssel im Code', async () => {
  const google = routingProvider('google')
  assert.equal(google.ready(), false)
  await assert.rejects(() => google.optimize({ depot, stops: [], drivers: [] }), (err) => err instanceof RoutingError && err.code === 'nicht-eingerichtet' && /noch nicht eingerichtet/.test(err.message))
  await assert.rejects(() => google.geocode('Beispielweg 1'), /noch nicht eingerichtet/)
  await assert.rejects(() => google.matrix([depot]), /noch nicht eingerichtet/)
  const p = routingFor({ provider: 'google' })
  assert.equal(p.name, 'luftlinie')
  assert.equal(p.requested, 'google')
  assert.match(p.notice, /noch nicht eingerichtet/)
  const res = await p.optimize({ depot, stops: [{ id: 'a', ...stadt, minutes: 5 }], drivers: [{ id: 'f' }] })
  assert.equal(res.provider, 'luftlinie')
  assert.deepEqual(ids(res), ['a'])
  // künftige Anfrage an den Durchreicher am Webspace: Anmeldung im Kopf, kein Schlüssel
  assert.deepEqual(googleRequest('matrix', { points: [depot] }, { token: 'abc' }), { url: 'routing.php?aktion=matrix', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Microsoft-Token': 'abc' }, body: JSON.stringify({ points: [depot] }) })
  assert.equal(createGoogleProvider({ endpoint: 'x.php' }).request('geocode', { address: 'A' }).url, 'x.php?aktion=geocode')
  assert.throws(() => googleRequest('loeschen'), RoutingError)
  const source = readFileSync(new URL('../src/core/routing.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}|[?&]key=/, 'kein API-Schlüssel im Code')
})

test('Geokodierung (eingebaut): Koordinaten-Text direkt, sonst OpenStreetMap mit Pause zwischen Anfragen', async () => {
  const urls = []
  const waits = []
  let clock = 1000
  const fake = createLuftlinieProvider({
    minInterval: 1100,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    fetch: async (url) => {
      urls.push(url)
      if (url.includes('Fehler')) return { ok: false, status: 503 }
      return { ok: true, json: async () => (url.includes('Nirgends') ? [] : [{ lat: '47.6831234', lon: '13.0972345', display_name: 'Beispielgasse, Hallein' }]) }
    },
  })
  assert.deepEqual(await fake.geocode('47.8095, 13.055'), { lat: 47.8095, lon: 13.055, quality: 'hand' })
  assert.equal(await fake.geocode('  '), null)
  assert.deepEqual(await fake.geocode('Beispielgasse 7, 5400 Hallein'), { lat: 47.683123, lon: 13.097235, quality: 'adresse', label: 'Beispielgasse, Hallein' })
  assert.equal(await fake.geocode('Nirgends 1'), null)
  await assert.rejects(() => fake.geocode('Fehler 1'), /503/)
  assert.equal(urls.length, 3)
  assert.match(urls[0], /^https:\/\/nominatim\.openstreetmap\.org\/search\?.*countrycodes=at&q=Beispielgasse%207/)
  assert.deepEqual(waits, [1100, 1100], 'höchstens eine Anfrage je Sekunde')
})

// ---------------------------------------------------------------- Laufzeit

test('Laufzeit: 150 Stopps unter 2 Sekunden (6 Fahrer: alle eingeplant; 1 Fahrer: Rest begründet)', () => {
  const stops = scatter(150, 17, (i) => (i % 7 === 0 ? { window: { from: '07:30', to: '10:30' } } : i % 11 === 0 ? { window: { from: '12:00', to: '14:00' } } : {}))
  const drivers = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, start: '06:00', end: '17:00', capacity: 120 }))
  let t0 = performance.now()
  const res = planRoutes({ depot, stops, drivers })
  let ms = performance.now() - t0
  assert.ok(ms < 2000, `${Math.round(ms)} ms`)
  const all = ids(res)
  assert.equal(new Set(all).size, 150)
  assert.equal(res.unassigned.length, 0)
  assert.ok(res.routes.every((r) => r.stops.length >= 15 && toMin(r.end) <= toMin('17:00') && r.load <= 120), res.routes.map((r) => r.stops.length).join('/'))
  // ein Fahrer mit langem Tag: viel weniger Platz, gleiche Laufzeitgrenze
  t0 = performance.now()
  const solo = planRoutes({ depot, stops, drivers: [{ id: 'x', start: '05:00', end: '20:00' }] })
  ms = performance.now() - t0
  assert.ok(ms < 2000, `${Math.round(ms)} ms`)
  assert.equal(ids(solo).length + solo.unassigned.length, 150)
  assert.ok(solo.unassigned.every((u) => ['arbeitszeit', 'zeitfenster'].includes(u.reason)))
})
