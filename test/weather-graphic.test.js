import { test } from 'node:test'
import assert from 'node:assert/strict'

import { forecastDays, hourSlots, isNight, parseForecast, sunTimes, weatherKind } from '../src/core/weather.js'
import { apiTime, framePixels, frameStats, KIND, latticePoints, nowcastHint, nowcastProxyUrl, nowcastUrl, parseNowcast, parsePoints, radarBbox, radarFrames, radarProxyUrl, radarUrl, radarWindow, rasterFor, rateColor } from '../src/core/nowcast.js'
import { dayCards, hourlyChart, nowcastStrip } from '../src/ui/weather-charts.js'

const iso = (ms) => new Date(ms).toISOString().replace(/:00\.000Z$/, '+00:00')

// Antwort des Data Hub (GeoJSON) mit mehreren Punkten: rows[Punkt][Zeit] = { name: Wert }
function pointsJson(startMs, stepMin, rows, coords) {
  const n = rows[0].length
  const timestamps = Array.from({ length: n }, (_, i) => iso(startMs + i * stepMin * 60e3))
  const names = Object.keys(rows[0][0])
  return {
    reference_time: timestamps[0],
    type: 'FeatureCollection',
    timestamps,
    features: rows.map((r, p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [coords[p][1], coords[p][0]] }, properties: { parameters: Object.fromEntries(names.map((k) => [k, { name: k, unit: '', data: r.map((x) => x[k] ?? null) }])) } })),
  }
}

test('Wetter grafisch: Vorhersage mit Bewölkung, Symbol, Schneefallgrenze und Wind (u/v → km/h, Richtung)', () => {
  const start = Date.parse('2026-12-01T00:00:00Z')
  const json = {
    timestamps: [iso(start), iso(start + 3600e3)],
    features: [{ properties: { parameters: {
      '2t': { unit: 'degree Celsius', data: [1, 2] }, tp: { unit: 'kg m-2', data: [null, 0.5] }, sf: { unit: 'kg m-2', data: [null, 0.4] }, '10fg': { unit: 'm s-1', data: [null, 10] },
      tcc: { unit: '%', data: [40, 100] }, sy: { unit: '1', data: [null, 14] }, snowlmt: { unit: 'm', data: [600, 650] },
      '10u': { unit: 'm s-1', data: [0, -3] }, '10v': { unit: 'm s-1', data: [-5, 0] },
    } } }],
  }
  const h = parseForecast(json)
  assert.equal(h[0].cloud, 40)
  assert.equal(h[1].symbol, 14)
  assert.equal(h[0].snowLimit, 600)
  assert.equal(h[0].wind, 18) // 5 m/s
  assert.equal(h[0].windFrom, 0, 'v = −5: Wind weht nach Süden, kommt also aus Norden')
  assert.equal(h[1].windFrom, 90, 'u = −3: kommt aus Osten')
  // Stunde [0, 1): Temperatur vom Beginn, Niederschlag/Symbol vom Ende
  const slots = hourSlots(h, { from: start })
  assert.equal(slots.length, 1)
  assert.deepEqual([slots[0].t, slots[0].precip, slots[0].snow, slots[0].symbol, Math.round(slots[0].gust)], [1, 0.5, 0.4, 14, 36])
  assert.equal(weatherKind(slots[0]).label, 'Leichter Schneefall')
})

test('Wetter grafisch: Wetterart aus Symbol, sonst aus Niederschlag und Bewölkung', () => {
  assert.equal(weatherKind({ symbol: 1 }).kind, 'clear')
  assert.equal(weatherKind({ symbol: 27 }).kind, 'thunder')
  assert.equal(weatherKind({ symbol: 21 }).kind, 'sleet')
  assert.equal(weatherKind({ precip: 3, snow: 3 }).kind, 'snow')
  assert.equal(weatherKind({ precip: 5, snow: 0 }).kind, 'heavyrain')
  assert.equal(weatherKind({ precip: 0, cloud: 90 }).kind, 'overcast')
  assert.equal(weatherKind({ precip: 0, cloud: 10 }).kind, 'clear')
  assert.equal(weatherKind({}), null)
})

test('Wetter grafisch: Sonnenauf- und -untergang Salzburg (NOAA-Näherung)', () => {
  const s = sunTimes('2026-11-03', 47.8095, 13.055)
  // Salzburg 3.11.: Aufgang ca. 6:57, Untergang ca. 16:48 (MEZ)
  assert.ok(Math.abs(s.rise - Date.parse('2026-11-03T05:57:00Z')) < 6 * 60e3)
  assert.ok(Math.abs(s.set - Date.parse('2026-11-03T15:48:00Z')) < 6 * 60e3)
  assert.equal(isNight(Date.parse('2026-11-03T21:00:00Z'), 47.8, 13.05), true)
  assert.equal(isNight(Date.parse('2026-11-03T11:00:00Z'), 47.8, 13.05), false)
})

test('Wetter grafisch: Tageskarten nehmen das merklichste Wetter am Tag', () => {
  const start = Date.parse('2026-12-01T23:00:00Z') // 2.12. 0 Uhr Wien
  const n = 30
  const json = { timestamps: Array.from({ length: n }, (_, i) => iso(start + i * 3600e3)), features: [{ properties: { parameters: { '2t': { data: Array.from({ length: n }, (_, i) => -2 + i * 0.2) }, tp: { data: Array.from({ length: n }, (_, i) => (i === 12 ? 1.2 : 0)) }, sf: { data: Array.from({ length: n }, (_, i) => (i === 12 ? 1.2 : 0)) }, sy: { data: Array.from({ length: n }, (_, i) => (i === 12 ? 15 : 3)) } } } }] }
  const entry = { hours: parseForecast(json), warnings: [] }
  const [d] = forecastDays(entry, ['2026-12-02'], { lat: 47.8, lon: 13.05 })
  assert.equal(d.kind.kind, 'snow')
  assert.equal(d.wetHours, 1)
  assert.equal(d.snow, 1.2)
  assert.ok(d.sun.rise < d.sun.set)
})

test('Nowcast: Hinweis „Regen in X Minuten“, „jetzt … hört auf“, „trocken“', () => {
  const t0 = Date.parse('2026-11-03T13:00:00Z')
  const steps = (list) => list.map((rate, i) => ({ at: t0 + i * 15 * 60e3, rate, kind: rate ? KIND.rain : KIND.none, t: 5 }))
  const dry = nowcastHint(steps(Array(13).fill(0)), t0 + 10 * 60e3)
  assert.equal(dry.state, 'dry')
  assert.match(dry.text, /^Trocken in den nächsten 3 Stunden/)
  const soon = nowcastHint(steps([0, 0, 0, 0, 1.2, 1.6, 0, 0, 0, 0, 0, 0, 0]), t0 + 5 * 60e3)
  assert.equal(soon.state, 'soon')
  assert.equal(soon.inMinutes, 55)
  assert.match(soon.text, /^Leichter Regen ab ca\. 15:00 \(in 55 Min\.\)$/)
  const now = nowcastHint(steps([0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), t0 + 20 * 60e3)
  assert.equal(now.state, 'now')
  assert.match(now.text, /^Jetzt mäßiger Regen, hört ca\. 14:45 auf$/)
  // Schritte, die schon vorbei sind (Nowcast erscheint verspätet), zählen nicht
  assert.equal(nowcastHint(steps([5, 0, 0]), t0 + 20 * 60e3).state, 'dry')
  assert.equal(nowcastHint([], t0).state, 'unknown')
  const snow = nowcastHint([{ at: t0, rate: 0, kind: KIND.none }, { at: t0 + 15 * 60e3, rate: 0.6, kind: KIND.snow }], t0)
  assert.match(snow.text, /^Leichter Schneefall ab ca\./)
})

test('Nowcast: Antwort lesen (rr je 15 min → mm/h, Art aus pt, Temperatur)', () => {
  const t0 = Date.parse('2026-11-03T12:00:00Z')
  const rows = [Array.from({ length: 13 }, (_, i) => ({ rr: i < 2 ? 0 : 0.25, pt: i < 2 ? 255 : 5, t2m: -0.5 })), Array.from({ length: 13 }, () => ({ rr: 0, pt: 255, t2m: 6 }))]
  const nc = parseNowcast(pointsJson(t0, 15, rows, [[47.8, 13.05], [47.68, 13.1]]))
  assert.equal(nc.points.length, 2)
  assert.equal(nc.points[0].steps.length, 13)
  assert.equal(nc.points[0].steps[2].rate, 1)
  assert.equal(nc.points[0].steps[2].kind, KIND.snow)
  assert.equal(nc.points[0].steps[0].kind, KIND.none)
  assert.equal(nc.points[1].steps[5].t, 6)
  assert.throws(() => parseNowcast({ timestamps: [], features: [] }), /Unerwartete Antwort/)
})

test('Radar: Ausschnitt um die Orte, auf Österreich und Höchstgröße begrenzt, Adressen', () => {
  const b = radarBbox([{ lat: 47.8095, lon: 13.055 }, { lat: 47.6833, lon: 13.097 }])
  assert.deepEqual(b, { s: 47.4, w: 12.6, n: 48.1, e: 13.55 })
  // in der Form einer breiten Karte: nach Osten und Westen erweitert, höchstens 1,8°
  const wide = radarBbox([{ lat: 47.8095, lon: 13.055 }, { lat: 47.6833, lon: 13.097 }], { aspect: 3 })
  assert.ok(Math.abs(wide.e - wide.w - 1.8) < 0.051 && wide.n - wide.s === b.n - b.s, JSON.stringify(wide))
  const tall = radarBbox([{ lat: 47.8, lon: 13 }, { lat: 47.8, lon: 14 }], { aspect: 0.5 })
  assert.ok(tall.n - tall.s > 1 && tall.n - tall.s <= 1.15, JSON.stringify(tall))
  // ganz Österreich: auf 1,6° × 2,4° um die Mitte gekürzt
  const big = radarBbox([{ lat: 46.6, lon: 9.7 }, { lat: 48.6, lon: 16.9 }])
  assert.ok(big.n - big.s <= 1.6 + 1e-9 && big.e - big.w <= 2.4 + 1e-9)
  assert.equal(radarBbox([]), null)
  const now = Date.parse('2026-11-03T13:20:00Z')
  assert.equal(radarUrl('nowcast', { bbox: b, now }), 'https://dataset.api.hub.geosphere.at/v1/grid/forecast/nowcast-v1-15min-1km?parameters=rr,pt&bbox=47.4,12.6,48.1,13.55&output_format=geojson')
  assert.equal(radarUrl('inca', { bbox: b, now }), 'https://dataset.api.hub.geosphere.at/v1/grid/historical/inca-v1-1h-1km?parameters=RR,T2M&bbox=47.4,12.6,48.1,13.55&start=2026-11-03T10:00&end=2026-11-03T13:00&output_format=geojson')
  assert.deepEqual(radarWindow('modell', now), { start: '2026-11-03T16:00', end: '2026-11-03T22:00' })
  assert.equal(apiTime(Date.parse('2026-01-05T07:05:00Z')), '2026-01-05T07:05')
  const pts = latticePoints(b, 3)
  assert.equal(pts.length, 9)
  assert.match(radarUrl('nowcast', { bbox: b, points: pts, now }), /^https:\/\/dataset\.api\.hub\.geosphere\.at\/v1\/timeseries\/forecast\/nowcast-v1-15min-1km\?parameters=rr,pt&lat_lon=47\.5167,12\.7583&lat_lon=/)
  assert.equal(radarProxyUrl('modell', { bbox: b, lattice: 12 }), 'wetter.php?art=raster&quelle=modell&bbox=47.4,12.6,48.1,13.55&raster=12')
  assert.equal(nowcastProxyUrl([{ lat: 47.8095, lon: 13.055 }, { lat: 47.6833, lon: 13.097 }]), 'wetter.php?art=nowcast&punkte=47.8095,13.055;47.6833,13.097')
  assert.match(nowcastUrl([{ lat: 47.8, lon: 13 }]), /lat_lon=47\.8,13&parameters=rr,pt,t2m&output_format=geojson$/)
})

test('Radar: Bilder aus INCA, Nowcast und Modell in zeitlicher Reihenfolge, Farben und Pixel', () => {
  const now = Date.parse('2026-11-03T13:20:00Z')
  const bbox = { s: 47.7, w: 13.0, n: 47.9, e: 13.2 }
  const coords = latticePoints(bbox, 2).map((p) => [p.lat, p.lon])
  const four = (fn) => coords.map((_, p) => fn(p))
  const inca = parsePoints(pointsJson(Date.parse('2026-11-03T10:00:00Z'), 60, four((p) => Array.from({ length: 4 }, (_, t) => ({ RR: p === 0 ? t : 0, T2M: p === 1 ? -2 : 4 }))), coords), ['RR', 'T2M'])
  const nowcast = parsePoints(pointsJson(Date.parse('2026-11-03T12:45:00Z'), 15, four((p) => Array.from({ length: 13 }, () => ({ rr: p === 2 ? 0.5 : 0, pt: p === 2 ? 1 : 255 }))), coords), ['rr', 'pt'])
  const modell = parsePoints(pointsJson(Date.parse('2026-11-03T16:00:00Z'), 60, four((p) => Array.from({ length: 7 }, () => ({ tp: p === 3 ? 2 : 0, sf: p === 3 ? 2 : 0 }))), coords), ['tp', 'sf'])
  const frames = radarFrames({ inca: { points: inca, lattice: 2 }, nowcast: { points: nowcast, lattice: 2 }, modell: { points: modell, lattice: 2 } }, { bbox, now })
  const kinds = frames.map((f) => f.kind)
  assert.deepEqual([...new Set(kinds)], ['past', 'now', 'nowcast', 'model'])
  assert.ok(frames.every((f, i) => !i || f.at > frames[i - 1].at), 'zeitlich sortiert, keine doppelten Zeitpunkte')
  assert.equal(frames.filter((f) => f.kind === 'now').length, 1)
  // INCA bis zum Beginn des Nowcasts, Modell erst nach dem Nowcast
  assert.ok(frames.filter((f) => f.kind === 'past').every((f) => f.at < Date.parse('2026-11-03T13:15:00Z')))
  assert.ok(frames.filter((f) => f.kind === 'model').every((f) => f.at > Date.parse('2026-11-03T15:45:00Z')))
  const n = frames.find((f) => f.kind === 'now')
  assert.equal(n.rate[2], 2)
  assert.equal(n.type[2], KIND.rain)
  assert.equal(frames.find((f) => f.kind === 'model').type[3], KIND.snow)
  const pastCold = frames.filter((f) => f.kind === 'past').at(-1)
  assert.equal(pastCold.type[1], KIND.none, 'kalt, aber trocken')
  // Raster 2 × 2 mit allen vier Punkten
  assert.equal(n.raster.w, 2)
  assert.equal(n.raster.h, 2)
  assert.ok([...n.raster.index].every((i) => i >= 0))
  const px = framePixels(n)
  assert.equal(px.length, 16)
  assert.equal(px.filter((_, i) => i % 4 === 3 && px[i] > 0).length, 1, 'genau eine nasse Zelle')
  assert.equal(frameStats(n).wetShare, 0.25)
  assert.equal(rateColor(0.05, KIND.rain), null)
  assert.notDeepEqual(rateColor(0.3, KIND.rain), rateColor(12, KIND.rain))
  assert.notDeepEqual(rateColor(1, KIND.snow), rateColor(1, KIND.rain))
})

test('Radar: Lambert-Gitter auf Grad-Raster, Lücken mit Nachbarn gefüllt', () => {
  const bbox = { s: 47, w: 13, n: 47.03, e: 13.03 }
  const pts = { lat: new Float32Array([47.025, 47.015]), lon: new Float32Array([13.005, 13.005]) }
  const r = rasterFor(pts, { bbox, cellLat: 0.01, cellLon: 0.01 })
  assert.equal(r.w, 3)
  assert.equal(r.h, 3)
  assert.equal(r.index[0], 0)
  assert.equal(r.index[3], 1)
  assert.equal(r.index[1], 0, 'Nachbar rechts gefüllt')
  assert.equal(r.index[8], -1, 'zu weit weg bleibt leer')
})

test('Wetter grafisch: Diagramm, Tageskarten und Nowcast-Streifen als HTML', () => {
  const start = Date.parse('2026-12-01T11:00:00Z')
  const n = 30
  const json = { timestamps: Array.from({ length: n }, (_, i) => iso(start + i * 3600e3)), features: [{ properties: { parameters: { '2t': { data: Array.from({ length: n }, (_, i) => 2 - i * 0.2) }, tp: { data: Array.from({ length: n }, (_, i) => (i >= 5 && i < 9 ? 1.5 : 0)) }, sf: { data: Array.from({ length: n }, (_, i) => (i >= 7 && i < 9 ? 1.5 : 0)) }, '10fg': { data: Array.from({ length: n }, () => 20) }, sy: { data: Array.from({ length: n }, (_, i) => (i >= 5 && i < 9 ? 9 : 2)) } } } }] }
  const entry = { hours: parseForecast(json), warnings: [] }
  const now = start + 30 * 60e3
  const svg = hourlyChart(entry, { lat: 47.8, lon: 13.05 }, { now })
  assert.match(svg, /<svg class="wx-chart"/)
  assert.ok((svg.match(/class="wx-c-rain"/g) || []).length >= 2)
  assert.ok((svg.match(/class="wx-c-snow"/g) || []).length >= 2)
  assert.match(svg, /class="wx-c-now"/)
  assert.match(svg, /class="wx-c-zero"/, '0 °C-Linie, wenn die Temperatur unter null fällt')
  assert.match(svg, /class="wx-c-gust( warn)?"/)
  assert.match(hourlyChart({ hours: [] }, null), /fehlen Daten/)
  const cards = dayCards(entry, { lat: 47.8, lon: 13.05 }, ['2026-12-01', '2026-12-02', '2026-12-03'], '2026-12-01')
  assert.match(cards, /Heute/)
  assert.match(cards, /Neuschnee/)
  const t0 = Date.parse('2026-12-01T12:00:00Z')
  const point = { steps: Array.from({ length: 13 }, (_, i) => ({ at: t0 + i * 15 * 60e3, rate: i >= 3 ? 2 : 0, kind: i >= 3 ? KIND.snow : KIND.none, t: -1 })) }
  const strip = nowcastStrip(point, { now: t0 })
  assert.match(strip, /Schneefall ab ca\. 13:45 \(in 45 Min\.\)/)
  assert.equal((strip.match(/class="wx-now-cell"/g) || []).length, 12)
})
