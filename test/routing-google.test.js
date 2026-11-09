// Google-Routing des Mattenwechsels (Entscheidung E8 vom 9.11.2026): der Google-Anbieter in core/routing.js mit
// nachgestellter Antwort von routing.php (kein Netz, kein Schlüssel): Zuteilung eingebaut, je Tour eine Anfrage,
// Reihenfolge und Fahrzeiten übernommen, Zeitfenster geprüft (zweite Anfrage mit der Reihenfolge der App), Rückfall auf den
// eingebauten Anbieter bei jedem Ausfall (kein Schlüssel, Limits, Netz, Fehler von Google, falsche Antwort, über 25 Stopps),
// Abschnitte für spätere Änderungen von Hand (ohne Anfrage), „Fahrzeiten mit Google neu rechnen“, Adresssuche, Kosten.
// Alle Orte erfunden (Raum Salzburg).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { googleRetime, moveStop, proposeTours, retimeTour, timedByGoogle } from '../src/core/matten-tour.js'
import { createGoogleProvider, GOOGLE_LIMITS, GOOGLE_MAX_STOPS, GOOGLE_PRICES, googleCost, legsMatrix, planRoutes, registerRoutingProvider, routingFor, RoutingError } from '../src/core/routing.js'

const depot = { lat: 47.7745, lon: 13.07 }
const P = (id, lat, lon, extra = {}) => ({ id, lat, lon, minutes: 5, demand: 1, window: null, ...extra })
const stops = [P('a', 47.8095, 13.055), P('b', 47.79, 13.005), P('c', 47.742, 13.085), P('d', 47.823, 13.03), P('e', 47.80, 13.0), P('f', 47.76, 13.12)]
const twoDrivers = [
  { id: 'x', start: '07:00', end: '15:30' },
  { id: 'y', start: '07:00', end: '15:30' },
]
const NUTZUNG = { monat: '2026-11', routen: 3, geocode: 1, anfragen: 4, heute: 2, limitMonat: 1000, limitTag: 100 }
const STATUS = { eingerichtet: true, vollzugriff: true, schluesselEnde: 'abcd', limitMonat: 1000, limitTag: 100, nutzung: NUTZUNG, privat: { beschreibbar: true } }
const leg = (seconds = 600, meters = 5000) => ({ seconds, meters })

/**
 * Nachgestellter Durchreicher routing.php: handlers je Aktion (body) → { status, json } oder json (200); zählt Aufrufe.
 * Standard: eingerichtet; optimize dreht die Reihenfolge um (bzw. behält sie mit keepOrder), jeder Abschnitt 10 Minuten, 5 km.
 */
function webspace(handlers = {}) {
  const calls = []
  const base = {
    status: () => STATUS,
    optimize: (b) => {
      const ids = b.stops.map((s) => s.id)
      return { order: b.keepOrder ? ids : [...ids].reverse(), legs: ids.map(() => leg()).concat([leg()]), nutzung: { ...NUTZUNG, routen: NUTZUNG.routen + 1 } }
    },
    geocode: () => ({ hit: { lat: 47.8, lon: 13.04, label: 'Beispielweg 1, 5020 Salzburg, Österreich', precision: 'ROOFTOP' }, nutzung: NUTZUNG }),
  }
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://app.example/')
    const aktion = u.searchParams.get('aktion')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ path: u.pathname, aktion, method: init.method, headers: init.headers, body })
    const h = handlers[aktion] || base[aktion]
    const out = await h(body, calls)
    if (out instanceof Error) throw out
    const r = out && typeof out.status === 'number' && 'json' in out ? out : { status: 200, json: out }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => r.type || 'application/json; charset=utf-8' }, json: async () => r.json }
  }
  return { fetch, calls, of: (a) => calls.filter((c) => c.aktion === a) }
}
const provider = (ws, extra = {}) => createGoogleProvider({ fetch: ws.fetch, getToken: async () => 'eyJ.token.sig', ...extra })
const ids = (r) => r.stops.map((s) => s.id)

// ---------------------------------------------------------------- Vorschlag mit Google

test('Google eingerichtet: Zuteilung wie der eingebaute Anbieter, je Tour eine Anfrage, Reihenfolge und Fahrzeiten von Google', async () => {
  const ws = webspace()
  const g = provider(ws)
  assert.equal(g.ready(), false, 'vor dem Lesen des Stands nicht bereit')
  assert.deepEqual(await g.refresh(), STATUS)
  assert.equal(g.ready(), true)
  const problem = { depot, stops, drivers: twoDrivers }
  const builtin = planRoutes(problem)
  const res = await g.optimize(problem)
  assert.equal(res.provider, 'google')
  assert.equal(res.notice, undefined)
  assert.equal(res.routes.length, builtin.routes.length)
  // Zuteilung bleibt (gleiche Stopps je Fahrer), Reihenfolge von Google (hier umgedreht)
  for (const [k, r] of res.routes.entries()) {
    assert.equal(r.driverId, builtin.routes[k].driverId)
    assert.equal(r.provider, 'google')
    assert.equal(r.notice, '')
    assert.deepEqual(ids(r), [...ids(builtin.routes[k])].reverse())
    assert.deepEqual(r.google.order, ids(r))
    assert.equal(r.google.legs.length, r.stops.length + 1)
    // echte Fahrzeit 10 Minuten + 5 Minuten Zuschlag (Parken, Gehen) je Abschnitt, 5 km
    assert.ok(r.stops.every((s) => s.travel === 15 && s.km === 5))
    assert.equal(r.stops[0].arrival, '07:15')
    assert.equal(r.stops[0].departure, '07:20')
    assert.equal(r.stops[1].arrival, '07:35')
    assert.deepEqual(r.back, { travel: 15, km: 5 })
    assert.equal(r.minutes, 15 * (r.stops.length + 1))
    assert.equal(r.km, 5 * (r.stops.length + 1))
  }
  assert.deepEqual(res.unassigned, builtin.unassigned)
  // je Tour genau eine Anfrage; nur Kennung und Koordinaten, Anmeldung im Kopf, kein Schlüssel
  const opt = ws.of('optimize')
  assert.equal(opt.length, res.routes.filter((r) => r.stops.length).length)
  for (const c of opt) {
    assert.equal(c.method, 'POST')
    assert.equal(c.path, '/routing.php')
    assert.equal(c.headers['X-Microsoft-Token'], 'eyJ.token.sig')
    assert.deepEqual(Object.keys(c.body).sort(), ['depot', 'stops'])
    assert.deepEqual(c.body.depot, depot)
    assert.ok(c.body.stops.every((s) => Object.keys(s).sort().join() === 'id,lat,lon'), JSON.stringify(c.body.stops))
    assert.ok(!('keepOrder' in c.body))
  }
  assert.equal(ws.of('status').length, 1)
  assert.equal(ws.of('status')[0].method, 'GET')
  // Nutzung aus der Antwort übernommen (für die Zeile über den Touren)
  assert.equal(g.status().nutzung.routen, NUTZUNG.routen + 1)
})

test('Zeitfenster: verletzt die Reihenfolge von Google eines, gilt die der App mit den Fahrzeiten von Google (zweite Anfrage)', async () => {
  const ws = webspace()
  const g = provider(ws)
  // a muss bis 07:40 fertig sein: der eingebaute Anbieter fährt a zuerst; Google (umgedreht) käme zu spät
  const problem = { depot, stops: [P('a', 47.79, 13.06, { window: { from: '', to: '07:40' } }), P('b', 47.81, 13.04), P('c', 47.83, 13.02)], drivers: [{ id: 'x', start: '07:00', end: '15:30' }] }
  assert.equal(ids(planRoutes(problem).routes[0])[0], 'a')
  const res = await g.optimize(problem)
  const r = res.routes[0]
  assert.equal(r.provider, 'google')
  assert.equal(ids(r)[0], 'a', 'Reihenfolge der App')
  assert.equal(r.stops[0].arrival, '07:15', 'Fahrzeit von Google')
  assert.match(r.notice, /Reihenfolge von Google hätte Zeitfenster oder Arbeitszeit verletzt/)
  assert.match(res.notice, /Zeitfenster/)
  const opt = ws.of('optimize')
  assert.equal(opt.length, 2)
  assert.equal(opt[0].body.keepOrder, undefined)
  assert.equal(opt[1].body.keepOrder, true)
  assert.deepEqual(r.google.order, ['a', 'b', 'c'])
  // passt die Reihenfolge von Google, bleibt es bei einer Anfrage
  const ws2 = webspace({ optimize: (b) => ({ order: b.stops.map((s) => s.id), legs: b.stops.map(() => leg(300, 3000)).concat([leg(300, 3000)]) }) })
  const res2 = await provider(ws2).optimize(problem)
  assert.equal(ws2.of('optimize').length, 1)
  assert.equal(res2.routes[0].notice, '')
  assert.equal(res2.routes[0].stops[0].arrival, '07:10')
})

test('Fällt Google aus: Rückfall auf den eingebauten Anbieter mit Hinweis – der Vorschlag scheitert nie', async () => {
  const problem = { depot, stops, drivers: twoDrivers }
  const builtin = planRoutes(problem)
  const same = (res) => res.routes.every((r, k) => ids(r).join() === ids(builtin.routes[k]).join() && r.stops.every((s, i) => s.arrival === builtin.routes[k].stops[i].arrival))
  const cases = [
    ['kein Schlüssel am Webspace', { status: () => ({ ...STATUS, eingerichtet: false, schluesselEnde: null }) }, /noch nicht eingerichtet \(kein API-Schlüssel am Webspace\)/, 0],
    ['Monatslimit laut Stand', { status: () => ({ ...STATUS, nutzung: { ...NUTZUNG, anfragen: 1000 } }) }, /Monatslimit erreicht \(1000 Anfragen\)/, 0],
    ['Tageslimit laut Stand', { status: () => ({ ...STATUS, nutzung: { ...NUTZUNG, heute: 100 } }) }, /Tageslimit erreicht \(100 Anfragen\)/, 0],
    ['routing.php fehlt (PHP-Text statt JSON)', { status: () => ({ status: 200, json: null, type: 'text/plain' }) }, /nicht erreichbar \(routing\.php fehlt am Webspace/, 0],
    ['nicht angemeldet', { status: () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'Nicht angemeldet: Bitte die App neu laden und mit Microsoft anmelden.' } } }) }, /nicht erreichbar \(Nicht angemeldet/, 0],
    ['kein Netz', { status: () => new TypeError('Failed to fetch') }, /nicht erreichbar \(Webspace nicht erreichbar \(keine Verbindung\)\)/, 0],
    ['Monatslimit am Webspace (429)', { optimize: () => ({ status: 429, json: { type: 'error', error: { type: 'rate_limit_error', limit: 'monat', message: 'Monatslimit erreicht (1000 Anfragen an Google).' } } }) }, /Google-Routing: Monatslimit erreicht \(1000 Anfragen an Google\)\. – eingebauter Anbieter/, 1],
    ['Google lehnt den Schlüssel ab (502)', { optimize: () => ({ status: 502, json: { type: 'error', error: { type: 'google_error', google: 'INVALID_ARGUMENT', message: 'Google lehnt den API-Schlüssel ab (ungültig oder gelöscht).' } } }) }, /Google lehnt den API-Schlüssel ab/, 1],
    ['Netz bricht bei der Route ab', { optimize: () => new TypeError('network') }, /Webspace nicht erreichbar/, 1],
    ['Antwort unvollständig', { optimize: (b) => ({ order: b.stops.map((s) => s.id).slice(1), legs: [] }) }, /Antwort von routing\.php unvollständig/, 1],
  ]
  for (const [name, handlers, re, optimizeCalls] of cases) {
    const ws = webspace(handlers)
    const g = provider(ws)
    registerRoutingProvider('google', g)
    await g.refresh()
    // nicht bereit: routingFor wählt gleich den eingebauten (Hinweis am Anbieter); Fehler bei der Anfrage: Hinweis im Ergebnis
    const p = routingFor({ provider: 'google' })
    assert.equal(p.name, optimizeCalls ? 'google' : 'luftlinie', name)
    const res = await p.optimize(problem)
    const notice = res.notice || p.notice
    assert.equal(res.provider, 'luftlinie', name)
    assert.match(notice, re, `${name}: ${notice}`)
    assert.ok(same(res), `${name}: Ergebnis wie der eingebaute Anbieter`)
    // nach dem ersten Fehler keine weitere Anfrage für die übrigen Touren
    assert.equal(ws.of('optimize').length, optimizeCalls, name)
    // proposeTours: je Tour Anbieter und Hinweis
    const prop = await proposeTours({ stops: stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, workMinutes: 5, demand: 1 })), drivers: twoDrivers.map((d) => ({ ...d, name: d.id })), depot, settings: { routing: { provider: 'google' } }, date: '2026-11-10', newId: (() => { let i = 0; return () => `mt00000000000${i++}` })() })
    assert.ok(prop.tours.length > 0 && prop.tours.every((t) => t.route.provider === 'luftlinie' && re.test(t.notice) && !t.route.google), `${name}: ${JSON.stringify(prop.tours.map((t) => [t.route.provider, t.notice]))}`)
    assert.equal(prop.provider, 'luftlinie')
  }
})

test('Keine Route für eine Tour (422): nur diese Tour fällt zurück, die anderen fragen weiter Google', async () => {
  let n = 0
  const ws = webspace({
    optimize: (b) => (n++ === 0 ? { status: 422, json: { type: 'error', error: { type: 'google_error', google: 'KEINE_ROUTE', message: 'Google findet keine Route zwischen diesen Punkten (Koordinaten prüfen).' } } } : { order: b.stops.map((s) => s.id), legs: b.stops.map(() => leg()).concat([leg()]) }),
  })
  const res = await provider(ws).optimize({ depot, stops, drivers: twoDrivers })
  assert.deepEqual(res.routes.map((r) => r.provider), ['luftlinie', 'google'])
  assert.match(res.routes[0].notice, /keine Route/)
  assert.equal(res.routes[1].notice, '')
  assert.equal(res.provider, 'google')
  assert.equal(ws.of('optimize').length, 2)
})

test(`Mehr als ${GOOGLE_MAX_STOPS} Stopps in einer Tour: diese Tour rechnet der eingebaute Anbieter (Grenze von Google)`, async () => {
  const many = Array.from({ length: 27 }, (_, i) => P(`s${i}`, 47.75 + (i % 9) * 0.01, 13.0 + Math.floor(i / 9) * 0.02, { minutes: 2 }))
  const ws = webspace()
  const res = await provider(ws).optimize({ depot, stops: many, drivers: [{ id: 'x', start: '06:00', end: '20:00' }] })
  assert.equal(res.routes[0].stops.length, 27)
  assert.equal(res.routes[0].provider, 'luftlinie')
  assert.match(res.routes[0].notice, /mehr als 25 Stopps/)
  assert.equal(ws.of('optimize').length, 0)
  await assert.rejects(() => provider(webspace()).legs({ depot, stops: many }), (err) => err instanceof RoutingError && err.code === 'anfrage')
})

// ---------------------------------------------------------------- Änderungen von Hand und Neurechnen

test('Tour mit Google: Reihenfolge von Hand bleibt von Hand (ohne Anfrage), „Fahrzeiten mit Google neu rechnen“ fragt einmal', async () => {
  const ws = webspace()
  const g = provider(ws)
  registerRoutingProvider('google', g)
  await g.refresh()
  const tourStops = stops.slice(0, 4).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, workMinutes: 5, demand: 1, customer: { name: `Kunde ${s.id}` }, objectName: `Objekt ${s.id}` }))
  const { tours, provider: used } = await proposeTours({ stops: tourStops, drivers: [{ id: 'x', name: 'Fahrer X', start: '07:00', end: '15:30' }], depot, settings: { routing: { provider: 'google' } }, date: '2026-11-10', newId: () => 'mt000000000001' })
  assert.equal(used, 'google')
  const t0 = tours[0]
  assert.equal(t0.route.provider, 'google')
  assert.equal(t0.notice, undefined)
  assert.deepEqual(t0.route.google.order, t0.order)
  assert.ok(timedByGoogle(t0))
  assert.equal(t0.stops[0].times.arrival, '07:15')
  // keine Namen an Google
  assert.ok(!JSON.stringify(ws.of('optimize').map((c) => c.body)).includes('Kunde'))
  const before = ws.calls.length
  // Pfeil nach unten: Zeiten neu ohne Google (Luftlinie), Abschnitte bleiben gespeichert
  const moved = retimeTour(moveStop(t0, 0, 1))
  assert.equal(moved.route.provider, 'luftlinie')
  assert.equal(moved.route.manual, true)
  assert.ok(!timedByGoogle(moved))
  assert.deepEqual(moved.route.google, t0.route.google)
  assert.notEqual(moved.stops[0].times.arrival, '07:15')
  // wieder zurück: dieselbe Reihenfolge → Fahrzeiten von Google ohne Anfrage
  const back = retimeTour(moveStop(moved, 1, 0))
  assert.equal(back.route.provider, 'google')
  assert.deepEqual(back.stops.map((s) => s.times), t0.stops.map((s) => s.times))
  // neue Arbeitszeit, gleiche Reihenfolge: Google-Zeiten verschoben, ohne Anfrage
  const later = retimeTour({ ...t0, route: { ...t0.route, shift: { from: '08:00', to: '15:30' } } })
  assert.equal(later.stops[0].times.arrival, '08:15')
  assert.equal(ws.calls.length, before, 'Änderungen von Hand fragen Google nicht')
  // auf Klick: eine Anfrage mit fester Reihenfolge
  const fresh = await googleRetime(moved, g)
  const last = ws.calls.at(-1)
  assert.equal(ws.calls.length, before + 1)
  assert.equal(last.aktion, 'optimize')
  assert.equal(last.body.keepOrder, true)
  assert.deepEqual(last.body.stops.map((s) => s.id), moved.order)
  assert.equal(fresh.route.provider, 'google')
  assert.deepEqual(fresh.order, moved.order)
  assert.deepEqual(fresh.route.google.order, moved.order)
  assert.equal(fresh.stops[0].times.arrival, '07:15')
  assert.ok(timedByGoogle(fresh))
  // Google ändert trotz fester Reihenfolge die Reihenfolge: abgelehnt
  const bad = provider(webspace({ optimize: (b) => ({ order: b.stops.map((s) => s.id).reverse(), legs: b.stops.map(() => leg()).concat([leg()]) }) }))
  await assert.rejects(() => googleRetime(moved, bad), /Reihenfolge geändert/)
  // ohne Schlüssel: Fehler, die Tour bleibt (die Oberfläche meldet es)
  const none = provider(webspace({ status: () => ({ ...STATUS, eingerichtet: false }) }))
  await assert.rejects(() => googleRetime(moved, none), (err) => err.code === 'nicht-eingerichtet')
})

// ---------------------------------------------------------------- Adresssuche, Einrichten, Rechnen

test('Adresssuche über Google: nur die Adresse geht an den Webspace; Koordinaten-Text ohne Anfrage; kein Treffer → null', async () => {
  const ws = webspace()
  const g = provider(ws)
  assert.deepEqual(await g.geocode('47.8, 13.04'), { lat: 47.8, lon: 13.04, quality: 'hand' })
  assert.equal(ws.calls.length, 0)
  const hit = await g.geocode('  Beispielweg 1, 5020 Salzburg ')
  assert.deepEqual(hit, { lat: 47.8, lon: 13.04, quality: 'google', label: 'Beispielweg 1, 5020 Salzburg, Österreich', precision: 'ROOFTOP' })
  assert.deepEqual(ws.of('geocode')[0].body, { address: 'Beispielweg 1, 5020 Salzburg' })
  const none = provider(webspace({ geocode: () => ({ hit: null }) }))
  assert.equal(await none.geocode('Nirgendwo 1'), null)
  const limit = provider(webspace({ geocode: () => ({ status: 429, json: { type: 'error', error: { type: 'rate_limit_error', limit: 'tag', message: 'Tageslimit erreicht (100 Anfragen an Google).' } } }) }))
  await assert.rejects(() => limit.geocode('Beispielweg 1'), (err) => err.code === 'limit' && /Tageslimit/.test(err.message))
})

test('Einrichten: Schlüssel geht nur an aktion=einrichten, Stand danach aktuell; Fehler kommen verständlich zurück', async () => {
  const seen = []
  const ws = webspace({
    einrichten: (b) => {
      seen.push(b)
      if (!b.entfernen && b.schluessel === 'falsch') return { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Der API-Schlüssel sieht nicht richtig aus (39 Zeichen, beginnt mit AIza).' } } }
      return { ...STATUS, eingerichtet: !b.entfernen, limitMonat: b.limitMonat ?? 1000 }
    },
  })
  const g = provider(ws)
  const st = await g.setup({ schluessel: 'gültig-im-test', limitMonat: 500, limitTag: 50 })
  assert.equal(st.limitMonat, 500)
  assert.equal(g.status().eingerichtet, true)
  await assert.rejects(() => g.setup({ schluessel: 'falsch' }), (err) => err.code === 'anfrage' && /beginnt mit AIza/.test(err.message))
  await g.setup({ entfernen: true })
  assert.equal(g.ready(), false)
  assert.deepEqual(seen.map((b) => Object.keys(b).sort().join()), ['limitMonat,limitTag,schluessel', 'schluessel', 'entfernen'])
  assert.ok(ws.calls.every((c) => c.aktion === 'einrichten' || !JSON.stringify(c.body || {}).includes('gültig-im-test')))
})

test('legsMatrix: Fahrzeit von Google aufgerundet plus Zuschlag, gleicher Ort 0, nur die Abschnitte dieser Reihenfolge', () => {
  const m = legsMatrix([leg(61, 900), leg(0, 0), leg(1200, 15340)])
  assert.deepEqual(m.minutes, [
    [0, 7, null],
    [null, 0, 0],
    [25, null, 0],
  ])
  assert.deepEqual(m.km, [
    [0, 0.9, null],
    [null, 0, 0],
    [15.3, null, 0],
  ])
  assert.equal(legsMatrix([leg(600, 5000), leg(600, 5000)], { baseMin: 0 }).minutes[0][1], 10)
})

test('Kosten: Gratis-Anfragen abgezogen, Preise mit Stand-Datum, Vorgabe-Limit im Gratis-Kontingent', () => {
  assert.deepEqual(googleCost({ routen: 900, geocode: 100 }), { routes: 0, geocode: 0, total: 0 })
  assert.deepEqual(googleCost({ routen: 6000, geocode: 12000 }), { routes: 10, geocode: 10, total: 20 })
  assert.deepEqual(googleCost({ routen: 5250 }), { routes: 2.5, geocode: 0, total: 2.5 })
  assert.equal(GOOGLE_PRICES.asOf, '2026-11-09')
  assert.ok(GOOGLE_LIMITS.month <= GOOGLE_PRICES.routes.free, 'Monatslimit bleibt im Gratis-Kontingent')
  assert.deepEqual(GOOGLE_LIMITS, { month: 1000, day: 100 })
})
