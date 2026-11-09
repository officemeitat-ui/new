// OpenRouteService als dritter Routing-Anbieter des Mattenwechsels (kostenlose Wahl, Zusatz zu E8 vom 9.11.2026): der
// Anbieter in core/routing.js mit nachgestellter Antwort von routing.php?anbieter=ors (kein Netz, kein Schlüssel):
// Zuteilung eingebaut, je Tour eine Anfrage mit Arbeit, Zeitfenster und Arbeitszeit, Reihenfolge und Abschnitte
// übernommen, Zeitfenster (Optimierung findet keine passende Reihenfolge → Reihenfolge der App; Reihenfolge verletzt eines
// → zweite Anfrage), Rückfall auf den eingebauten Anbieter bei jedem Ausfall (kein Schlüssel, Limits, Kontingent, Netz,
// falsche Antwort, über 50 Stopps), Abschnitte an der Tour (route.ors), „Fahrzeiten neu rechnen“, Adresssuche.
// Alle Orte erfunden (Raum Salzburg).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LEG_PROVIDERS, moveStop, proposeTours, retimeTour, routeRetime, timedBy, timedByGoogle, timesFromLegs } from '../src/core/matten-tour.js'
import {
  createGoogleProvider,
  createOrsProvider,
  ORS_ATTRIBUTION,
  ORS_FREE,
  ORS_KEY_PATTERN,
  ORS_LIMITS,
  ORS_MAX_STOPS,
  planRoutes,
  registerRoutingProvider,
  routingFor,
  routingProvider,
  routingProviders,
  routingRequest,
  RoutingError,
  WEBSPACE_PROVIDERS,
} from '../src/core/routing.js'

const depot = { lat: 47.7745, lon: 13.07 }
const P = (id, lat, lon, extra = {}) => ({ id, lat, lon, minutes: 5, demand: 1, window: null, ...extra })
const stops = [P('a', 47.8095, 13.055), P('b', 47.79, 13.005), P('c', 47.742, 13.085), P('d', 47.823, 13.03), P('e', 47.8, 13.0), P('f', 47.76, 13.12)]
const twoDrivers = [
  { id: 'x', start: '07:00', end: '15:30' },
  { id: 'y', start: '07:00', end: '12:00' },
]
const NUTZUNG = { monat: '2026-11', routen: 3, geocode: 1, anfragen: 4, heute: 2, limitMonat: 3000, limitTag: 200 }
const STATUS = { anbieter: 'ors', eingerichtet: true, vollzugriff: true, schluesselEnde: 'wxyz', limitMonat: 3000, limitTag: 200, nutzung: NUTZUNG, privat: { beschreibbar: true } }
const leg = (seconds = 480, meters = 4000) => ({ seconds, meters })
const err = (status, type, message, extra = {}) => ({ status, json: { type: 'error', error: { type, message, ...extra } } })

/**
 * Nachgestellter Durchreicher routing.php: handlers je Aktion (body) → { status, json } oder json (200); zählt Aufrufe.
 * Standard: eingerichtet; optimize dreht die Reihenfolge um (bzw. behält sie mit keepOrder), jeder Abschnitt 8 Minuten, 4 km.
 */
function webspace(handlers = {}) {
  const calls = []
  const base = {
    status: () => STATUS,
    optimize: (b) => {
      const ids = b.stops.map((s) => s.id)
      return { order: b.keepOrder ? ids : [...ids].reverse(), legs: ids.map(() => leg()).concat([leg()]), optimized: !b.keepOrder, nutzung: { ...NUTZUNG, routen: NUTZUNG.routen + 1 } }
    },
    geocode: () => ({ hit: { lat: 47.8, lon: 13.04, precision: 'hausnummer', partial: false }, nutzung: NUTZUNG }),
  }
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://app.example/')
    const aktion = u.searchParams.get('aktion')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ path: u.pathname, aktion, anbieter: u.searchParams.get('anbieter'), method: init.method, headers: init.headers, body })
    const h = handlers[aktion] || base[aktion]
    const out = await h(body, calls)
    if (out instanceof Error) throw out
    const r = out && typeof out.status === 'number' && 'json' in out ? out : { status: 200, json: out }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => r.type || 'application/json; charset=utf-8' }, json: async () => r.json }
  }
  return { fetch, calls, of: (a) => calls.filter((c) => c.aktion === a) }
}
const provider = (ws) => createOrsProvider({ fetch: ws.fetch, getToken: async () => 'eyJ.token.sig' })
const ids = (r) => r.stops.map((s) => s.id)

// ---------------------------------------------------------------- Grundlagen

test('OpenRouteService: angemeldet, eigene Konstanten, Anfrage mit &anbieter=ors (Google unverändert ohne)', () => {
  assert.ok(routingProviders().includes('ors'))
  assert.equal(routingProvider('ors').name, 'ors')
  assert.equal(routingProvider('ors').label, 'OpenRouteService')
  assert.equal(ORS_MAX_STOPS, 50)
  assert.deepEqual(ORS_LIMITS, { month: 3000, day: 200 })
  assert.ok(ORS_LIMITS.day <= ORS_FREE.optimization && ORS_LIMITS.day <= ORS_FREE.geocode, 'Tageslimit unter dem Gratis-Kontingent')
  assert.equal(ORS_FREE.asOf, '2026-11-09')
  assert.match(ORS_ATTRIBUTION, /OpenStreetMap-Mitwirkende/)
  assert.deepEqual(Object.keys(WEBSPACE_PROVIDERS), ['google', 'ors'])
  // Schlüsselformate (erfunden): alt 56 Hex-Zeichen, neu Base64-Text; zu kurz, Leerzeichen, Sonderzeichen nicht
  assert.ok(ORS_KEY_PATTERN.test('0123456789abcdef'.repeat(3) + '01234567'))
  assert.ok(ORS_KEY_PATTERN.test(`eyJvcmciOi${'Beispiel'.repeat(8)}In0=`))
  for (const bad of ['kurz', 'a b'.repeat(20), `${'x'.repeat(40)}<`, 'x'.repeat(201)]) assert.ok(!ORS_KEY_PATTERN.test(bad), bad)
  assert.deepEqual(routingRequest('optimize', { depot }, { token: 't', provider: 'ors' }), { url: 'routing.php?aktion=optimize&anbieter=ors', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Microsoft-Token': 't' }, body: JSON.stringify({ depot }) })
  assert.equal(routingRequest('status', undefined, { provider: 'ors' }).url, 'routing.php?aktion=status&anbieter=ors')
  assert.equal(routingRequest('status').url, 'routing.php?aktion=status')
  assert.equal(createGoogleProvider().request('geocode', {}).url, 'routing.php?aktion=geocode')
  assert.equal(createOrsProvider({ endpoint: 'x.php' }).request('geocode', {}).url, 'x.php?aktion=geocode&anbieter=ors')
  assert.throws(() => routingRequest('status', undefined, { provider: 'azure' }), RoutingError)
  assert.deepEqual(LEG_PROVIDERS, ['google', 'ors'])
  // ohne gelesenen Stand nicht bereit: routingFor nimmt den eingebauten mit Hinweis
  const p = routingFor({ provider: 'ors' })
  assert.equal(p.name, 'luftlinie')
  assert.match(p.notice, /^OpenRouteService: noch nicht eingerichtet .* – eingebauter Anbieter \(Luftlinie\)\.$/)
})

// ---------------------------------------------------------------- Vorschlag mit OpenRouteService

test('OpenRouteService eingerichtet: Zuteilung eingebaut, je Tour eine Anfrage, Reihenfolge und Abschnitte übernommen', async () => {
  const ws = webspace()
  const o = provider(ws)
  assert.equal(o.ready(), false, 'vor dem Lesen des Stands nicht bereit')
  assert.deepEqual(await o.refresh(), STATUS)
  assert.equal(o.ready(), true)
  const problem = { depot, stops, drivers: twoDrivers, settings: { baseMin: 4 } }
  const builtin = planRoutes(problem)
  const res = await o.optimize(problem)
  assert.equal(res.provider, 'ors')
  assert.equal(res.notice, undefined)
  assert.deepEqual(res.unassigned, builtin.unassigned)
  for (const [k, r] of res.routes.entries()) {
    assert.equal(r.driverId, builtin.routes[k].driverId, 'Zuteilung bleibt')
    assert.equal(r.provider, 'ors')
    assert.equal(r.notice, '')
    assert.deepEqual(ids(r), [...ids(builtin.routes[k])].reverse(), 'Reihenfolge von OpenRouteService (umgedreht)')
    assert.deepEqual(r.ors, { order: ids(r), legs: ids(r).map(() => leg()).concat([leg()]) }, 'Abschnitte an der Tour, nur Reihenfolge und Abschnitte')
    assert.equal(r.google, undefined)
    // 8 Minuten Fahrt + 4 Minuten Zuschlag je Abschnitt, 4 km
    assert.ok(r.stops.every((s) => s.travel === 12 && s.km === 4))
    assert.equal(r.stops[0].arrival, '07:12')
    assert.equal(r.stops[0].departure, '07:17')
    assert.deepEqual(r.back, { travel: 12, km: 4 })
  }
  const opt = ws.of('optimize')
  assert.equal(opt.length, res.routes.filter((r) => r.stops.length).length, 'je Tour genau eine Anfrage')
  for (const [k, c] of opt.entries()) {
    assert.equal(c.anbieter, 'ors')
    assert.equal(c.path, '/routing.php')
    assert.equal(c.method, 'POST')
    assert.equal(c.headers['X-Microsoft-Token'], 'eyJ.token.sig')
    // an den Webspace: Koordinaten, Arbeit (Minuten), Arbeitszeit des Fahrers, Zuschlag – keine Namen, kein keepOrder
    assert.deepEqual(Object.keys(c.body).sort(), ['baseMin', 'depot', 'shift', 'stops'])
    assert.deepEqual(c.body.depot, depot)
    assert.equal(c.body.baseMin, 4)
    assert.deepEqual(c.body.shift, { from: '07:00', to: res.routes[k].driverId === 'x' ? '15:30' : '12:00' })
    assert.ok(c.body.stops.every((s) => Object.keys(s).sort().join() === 'id,lat,lon,minutes' && s.minutes === 5), JSON.stringify(c.body.stops))
  }
  assert.equal(ws.of('status')[0].anbieter, 'ors')
  assert.equal(o.status().nutzung.routen, NUTZUNG.routen + 1, 'Nutzung aus der Antwort übernommen')
})

test('Zeitfenster gehen mit; findet OpenRouteService keine passende Reihenfolge, bleibt die der App (Hinweis, eine Anfrage)', async () => {
  // a muss bis 07:40 fertig sein, b erst ab 09:00
  const problem = { depot, stops: [P('a', 47.79, 13.06, { window: { from: '', to: '07:40' } }), P('b', 47.81, 13.04, { window: { from: '09:00', to: '' } }), P('c', 47.83, 13.02)], drivers: [{ id: 'x', start: '07:00', end: '15:30' }] }
  const own = ids(planRoutes(problem).routes[0])
  const ws = webspace({ optimize: (b) => ({ order: b.stops.map((s) => s.id), legs: b.stops.map(() => leg(300, 3000)).concat([leg(300, 3000)]), optimized: false }) })
  const res = await provider(ws).optimize(problem)
  const r = res.routes[0]
  const body = ws.of('optimize')[0].body
  assert.deepEqual(body.stops.find((s) => s.id === 'a').window, { from: '', to: '07:40' })
  assert.deepEqual(body.stops.find((s) => s.id === 'b').window, { from: '09:00', to: '' })
  assert.equal(body.stops.find((s) => s.id === 'c').window, undefined)
  assert.equal(ws.of('optimize').length, 1)
  assert.equal(r.provider, 'ors')
  assert.deepEqual(ids(r), own, 'Reihenfolge der App')
  assert.match(r.notice, /^OpenRouteService: keine Reihenfolge gefunden, die alle Zeitfenster einhält – Reihenfolge der App mit den Fahrzeiten von OpenRouteService\.$/)
  assert.match(res.notice, /Zeitfenster/)
  assert.equal(r.stops[0].arrival, '07:10', '5 Minuten Fahrt + 5 Minuten Zuschlag')
  // optimiert, aber die Reihenfolge verletzt ein Zeitfenster der App: zweite Anfrage mit fester Reihenfolge
  const ws2 = webspace()
  const res2 = await provider(ws2).optimize({ ...problem, stops: problem.stops.map((s) => ({ ...s, window: s.id === 'a' ? s.window : null })) })
  assert.equal(ws2.of('optimize').length, 2)
  assert.equal(ws2.of('optimize')[1].body.keepOrder, true)
  assert.deepEqual(Object.keys(ws2.of('optimize')[1].body).sort(), ['depot', 'keepOrder', 'stops'], 'feste Reihenfolge: nur Koordinaten')
  assert.match(res2.routes[0].notice, /die Reihenfolge von OpenRouteService hätte Zeitfenster oder Arbeitszeit verletzt/)
  assert.equal(ids(res2.routes[0])[0], 'a')
})

test('Fällt OpenRouteService aus: Rückfall auf den eingebauten Anbieter mit Hinweis – der Vorschlag scheitert nie', async () => {
  const problem = { depot, stops, drivers: twoDrivers }
  const builtin = planRoutes(problem)
  const same = (res) => res.routes.every((r, k) => ids(r).join() === ids(builtin.routes[k]).join() && r.stops.every((s, i) => s.arrival === builtin.routes[k].stops[i].arrival))
  const cases = [
    ['kein Schlüssel am Webspace', { status: () => ({ ...STATUS, eingerichtet: false, schluesselEnde: null }) }, /OpenRouteService: noch nicht eingerichtet \(kein API-Schlüssel am Webspace\)/, 0],
    ['Monatslimit laut Stand', { status: () => ({ ...STATUS, nutzung: { ...NUTZUNG, anfragen: 3000 } }) }, /Monatslimit erreicht \(3000 Anfragen\)/, 0],
    ['Tageslimit laut Stand', { status: () => ({ ...STATUS, nutzung: { ...NUTZUNG, heute: 200 } }) }, /Tageslimit erreicht \(200 Anfragen\)/, 0],
    ['routing.php fehlt', { status: () => ({ status: 404, json: null, type: 'text/html' }) }, /nicht erreichbar \(routing\.php fehlt am Webspace/, 0],
    ['kein Netz', { status: () => new TypeError('Failed to fetch') }, /Webspace nicht erreichbar \(keine Verbindung\)/, 0],
    ['Tageslimit am Webspace (429)', { optimize: () => err(429, 'rate_limit_error', 'Tageslimit erreicht (200 Anfragen an OpenRouteService). Morgen geht es weiter.', { limit: 'tag' }) }, /^OpenRouteService: Tageslimit erreicht \(200 Anfragen an OpenRouteService\)\. Morgen geht es weiter\. – eingebauter Anbieter \(Luftlinie\)\./, 1],
    ['Tageskontingent des Gratis-Plans', { optimize: () => err(502, 'ors_error', 'Tageskontingent von OpenRouteService erschöpft (Optimierung, Gratis-Plan). Morgen geht es weiter; bis dahin rechnet der eingebaute Anbieter.', { ors: 'KONTINGENT' }) }, /Tageskontingent von OpenRouteService erschöpft/, 1],
    ['Schlüssel abgelehnt', { optimize: () => err(502, 'ors_error', 'OpenRouteService lehnt den Schlüssel ab (ungültig, gesperrt oder für diesen Dienst nicht freigeschaltet).', { ors: 'SCHLUESSEL' }) }, /lehnt den Schlüssel ab/, 1],
    ['Netz bricht bei der Route ab', { optimize: () => new TypeError('network') }, /Webspace nicht erreichbar/, 1],
    ['Antwort unvollständig', { optimize: (b) => ({ order: b.stops.map((s) => s.id), legs: [leg()] }) }, /Antwort von routing\.php unvollständig/, 1],
  ]
  for (const [name, handlers, re, optimizeCalls] of cases) {
    const ws = webspace(handlers)
    const o = provider(ws)
    registerRoutingProvider('ors', o)
    await o.refresh()
    const p = routingFor({ provider: 'ors' })
    assert.equal(p.name, optimizeCalls ? 'ors' : 'luftlinie', name)
    const res = await p.optimize(problem)
    const notice = res.notice || p.notice
    assert.equal(res.provider, 'luftlinie', name)
    assert.match(notice, re, `${name}: ${notice}`)
    assert.ok(same(res), `${name}: Ergebnis wie der eingebaute Anbieter`)
    assert.equal(ws.of('optimize').length, optimizeCalls, `${name}: nach dem ersten Fehler keine weitere Anfrage`)
    const prop = await proposeTours({ stops: stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, workMinutes: 5, demand: 1 })), drivers: twoDrivers.map((d) => ({ ...d, name: d.id })), depot, settings: { routing: { provider: 'ors' } }, date: '2026-11-10', newId: (() => { let i = 0; return () => `mt00000000000${i++}` })() })
    assert.ok(prop.tours.length > 0 && prop.tours.every((t) => t.route.provider === 'luftlinie' && re.test(t.notice) && !t.route.ors), `${name}: ${JSON.stringify(prop.tours.map((t) => [t.route.provider, t.notice]))}`)
    assert.equal(prop.provider, 'luftlinie')
  }
  registerRoutingProvider('ors', createOrsProvider())
})

test('Keine Route für eine Tour (422): nur diese Tour fällt zurück; über 50 Stopps rechnet der eingebaute Anbieter', async () => {
  let n = 0
  const ws = webspace({ optimize: (b) => (n++ === 0 ? err(422, 'ors_error', 'OpenRouteService findet bei einem Stopp keine befahrbare Straße in der Nähe (Koordinaten am Liegeplatz prüfen).', { ors: 'KEINE_ROUTE' }) : { order: b.stops.map((s) => s.id), legs: b.stops.map(() => leg()).concat([leg()]) }) })
  const res = await provider(ws).optimize({ depot, stops, drivers: twoDrivers })
  assert.deepEqual(res.routes.map((r) => r.provider), ['luftlinie', 'ors'])
  assert.match(res.routes[0].notice, /keine befahrbare Straße/)
  assert.equal(res.provider, 'ors')
  assert.equal(ws.of('optimize').length, 2)
  // 51 Stopps in einer Tour: keine Anfrage; 50 gehen noch (eine Anfrage)
  const many = (k) => Array.from({ length: k }, (_, i) => P(`s${i}`, 47.75 + (i % 10) * 0.005, 13.0 + Math.floor(i / 10) * 0.01, { minutes: 1 }))
  const ws51 = webspace()
  const r51 = await provider(ws51).optimize({ depot, stops: many(51), drivers: [{ id: 'x', start: '05:00', end: '22:00' }] })
  assert.equal(r51.routes[0].stops.length, 51)
  assert.equal(r51.routes[0].provider, 'luftlinie')
  assert.match(r51.routes[0].notice, /^OpenRouteService: mehr als 50 Stopps in der Tour – eingebauter Anbieter \(Luftlinie\)\.$/)
  assert.equal(ws51.of('optimize').length, 0)
  const ws50 = webspace()
  const r50 = await provider(ws50).optimize({ depot, stops: many(50), drivers: [{ id: 'x', start: '05:00', end: '22:00' }] })
  assert.equal(r50.routes[0].provider, 'ors')
  assert.equal(ws50.of('optimize').length, 1)
  assert.equal(ws50.of('optimize')[0].body.stops.length, 50)
  await assert.rejects(() => provider(webspace()).legs({ depot, stops: many(51) }), (e) => e instanceof RoutingError && e.code === 'anfrage')
})

// ---------------------------------------------------------------- An der Tour: Abschnitte, Neurechnen

test('Tour mit OpenRouteService: route.provider „ors“, Abschnitte route.ors; von Hand ohne Anfrage, neu rechnen auf Klick', async () => {
  const ws = webspace()
  const o = provider(ws)
  registerRoutingProvider('ors', o)
  await o.refresh()
  const tourStops = stops.slice(0, 4).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, workMinutes: 5, demand: 1, window: s.id === 'b' ? { from: '07:00', to: '12:00' } : null, customer: { name: `Kunde ${s.id}` }, objectName: `Objekt ${s.id}`, address: `Beispielweg ${s.id}` }))
  const { tours, provider: used } = await proposeTours({ stops: tourStops, drivers: [{ id: 'x', name: 'Fahrer X', start: '07:00', end: '15:30' }], depot, settings: { routing: { provider: 'ors' } }, date: '2026-11-10', newId: () => 'mt000000000001' })
  assert.equal(used, 'ors')
  const t0 = tours[0]
  assert.equal(t0.route.provider, 'ors')
  assert.deepEqual(t0.route.ors.order, t0.order)
  assert.equal(t0.route.google, undefined)
  assert.equal(timedBy(t0), 'ors')
  assert.equal(timedByGoogle(t0), false)
  assert.equal(t0.stops[0].times.arrival, '07:13', '8 Minuten Fahrt + 5 Minuten Zuschlag')
  // keine Namen und keine Adressen an den Webspace (für OpenRouteService)
  const sent = JSON.stringify(ws.of('optimize').map((c) => c.body))
  assert.ok(!/Kunde|Objekt|Beispielweg|Fahrer X/.test(sent), sent)
  assert.deepEqual(ws.of('optimize')[0].body.stops.find((s) => s.id === 'b').window, { from: '07:00', to: '12:00' })
  const before = ws.calls.length
  // Pfeil nach unten: Luftlinie, Abschnitte bleiben; zurück: Fahrzeiten von OpenRouteService ohne Anfrage
  const moved = retimeTour(moveStop(t0, 0, 1))
  assert.equal(moved.route.provider, 'luftlinie')
  assert.equal(timedBy(moved), '')
  assert.deepEqual(moved.route.ors, t0.route.ors)
  const back = retimeTour(moveStop(moved, 1, 0))
  assert.equal(back.route.provider, 'ors')
  assert.deepEqual(back.stops.map((s) => s.times), t0.stops.map((s) => s.times))
  assert.equal(ws.calls.length, before, 'Änderungen von Hand fragen nicht')
  // auf Klick: eine Anfrage mit fester Reihenfolge (nur Kennung und Koordinaten)
  const fresh = await routeRetime(moved, o)
  const last = ws.calls.at(-1)
  assert.equal(ws.calls.length, before + 1)
  assert.equal(last.anbieter, 'ors')
  assert.equal(last.body.keepOrder, true)
  assert.ok(last.body.stops.every((s) => Object.keys(s).sort().join() === 'id,lat,lon'))
  assert.equal(fresh.route.provider, 'ors')
  assert.deepEqual(fresh.route.ors.order, moved.order)
  assert.equal(timedBy(fresh), 'ors')
  // mit Google neu gerechnet: es gelten die Abschnitte von Google, die von OpenRouteService fallen weg
  const g = timesFromLegs(fresh, { order: fresh.order, legs: fresh.order.map(() => leg(600, 5000)).concat([leg(600, 5000)]) }, {}, 'google')
  assert.equal(g.route.provider, 'google')
  assert.equal(g.route.ors, undefined)
  assert.equal(timedBy(g), 'google')
  assert.ok(timedByGoogle(g))
  // ohne Schlüssel: Fehler, die Tour bleibt (die Oberfläche meldet es)
  const none = provider(webspace({ status: () => ({ ...STATUS, eingerichtet: false }) }))
  await assert.rejects(() => routeRetime(moved, none), (e) => e.code === 'nicht-eingerichtet')
  registerRoutingProvider('ors', createOrsProvider())
})

// ---------------------------------------------------------------- Adresssuche und Einrichten

test('Adresssuche über OpenRouteService: nur die Adresse, Treffer mit Genauigkeit; Koordinaten-Text ohne Anfrage', async () => {
  const ws = webspace()
  const o = provider(ws)
  assert.deepEqual(await o.geocode('47.8, 13.04'), { lat: 47.8, lon: 13.04, quality: 'hand' })
  assert.equal(ws.calls.length, 0)
  assert.deepEqual(await o.geocode('  Beispielweg 1, 5020 Salzburg '), { lat: 47.8, lon: 13.04, quality: 'ors', label: '', precision: 'hausnummer', partial: false })
  const c = ws.of('geocode')[0]
  assert.deepEqual(c.body, { address: 'Beispielweg 1, 5020 Salzburg' })
  assert.equal(c.anbieter, 'ors')
  const vague = provider(webspace({ geocode: () => ({ hit: { lat: 47.7, lon: 13.1, precision: 'ort', partial: true } }) }))
  assert.deepEqual(await vague.geocode('Irgendwo 1'), { lat: 47.7, lon: 13.1, quality: 'ors', label: '', precision: 'ort', partial: true })
  assert.equal(await provider(webspace({ geocode: () => ({ hit: null }) })).geocode('Nirgendwo 1'), null)
  const quota = provider(webspace({ geocode: () => err(502, 'ors_error', 'Tageskontingent von OpenRouteService erschöpft (Adresssuche, Gratis-Plan).', { ors: 'KONTINGENT' }) }))
  await assert.rejects(() => quota.geocode('Beispielweg 1'), (e) => e.code === 'ors' && /Tageskontingent/.test(e.message))
})

test('Einrichten: Schlüssel geht nur an aktion=einrichten&anbieter=ors; Google und OpenRouteService getrennt', async () => {
  const seen = []
  const ws = webspace({
    einrichten: (b, calls) => {
      seen.push([calls.at(-1).anbieter, b])
      return { ...STATUS, eingerichtet: !b.entfernen, limitMonat: b.limitMonat ?? 3000 }
    },
  })
  const o = provider(ws)
  const st = await o.setup({ schluessel: 'nur-im-test', limitMonat: 2000, limitTag: 150 })
  assert.equal(st.limitMonat, 2000)
  assert.equal(o.ready(), true)
  await o.setup({ entfernen: true })
  assert.equal(o.ready(), false)
  assert.deepEqual(seen.map(([a, b]) => [a, Object.keys(b).sort().join()]), [['ors', 'limitMonat,limitTag,schluessel'], ['ors', 'entfernen']])
  // der Google-Anbieter fragt weiter ohne Parameter (= Google)
  const ws2 = webspace()
  await createGoogleProvider({ fetch: ws2.fetch }).refresh()
  assert.equal(ws2.calls[0].anbieter, null)
})
