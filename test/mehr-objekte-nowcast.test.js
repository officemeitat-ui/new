import { test } from 'node:test'
import assert from 'node:assert/strict'

import { frameStats, intensity, KIND, latticePoints, LEGEND, nowcastHint, parseNowcast, parsePoints, radarBbox, radarFrames, radarUrl, radarWindow, rateColor } from '../src/core/nowcast.js'

// 3.11.2026 13:00 UTC = 14:00 Wien (Winterzeit)
const T0 = Date.parse('2026-11-03T13:00:00Z')
const MIN = 60e3
const steps = (list, kind = KIND.rain) => list.map((rate, i) => ({ at: T0 + i * 15 * MIN, rate, kind: rate ? (Array.isArray(kind) ? kind[i] : kind) : KIND.none, t: 4 }))
const dry13 = Array(13).fill(0)

// ---------------------------------------------------------------- Hinweistexte

test('Nowcast-Text: „Leichter Regen ab ca. 14:45 (in 25 Min.)“', () => {
  const h = nowcastHint(steps([0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]), T0 + 20 * MIN)
  assert.equal(h.text, 'Leichter Regen ab ca. 14:45 (in 25 Min.)')
  assert.equal(h.short, 'Regen in 25 Min.')
  assert.deepEqual([h.state, h.inMinutes, h.untilMinutes, h.peak], ['soon', 25, 55, 1])
})

test('Nowcast-Text: „Trocken in den nächsten 3 Stunden“ bei vollem Nowcast', () => {
  const h = nowcastHint(steps(dry13), T0)
  assert.equal(h.text, 'Trocken in den nächsten 3 Stunden')
  assert.deepEqual([h.state, h.short, h.horizonMinutes, h.inMinutes], ['dry', 'trocken', 195, null])
})

test('Nowcast-Text: kürzerer Rest (Nowcast veraltet) – „in den nächsten 2 Stunden“ bzw. „in der nächsten Stunde“', () => {
  assert.equal(nowcastHint(steps(Array(8).fill(0)), T0).text, 'Trocken in den nächsten 2 Stunden')
  // nach zwei Stunden ohne neuen Nowcast bleibt gut eine Stunde übrig
  assert.equal(nowcastHint(steps(dry13), T0 + 120 * MIN).text, 'Trocken in der nächsten Stunde')
  assert.equal(nowcastHint(steps(Array(2).fill(0)), T0).text, 'Trocken in der nächsten Stunde', 'auch unter einer halben Stunde')
})

test('Nowcast-Text: es regnet bis zum Ende des Nowcasts („hält mindestens bis … an“)', () => {
  const h = nowcastHint(steps(Array(13).fill(1)), T0 + 5 * MIN)
  assert.equal(h.text, 'Jetzt leichter Regen, hält mindestens bis 17:15 an')
  assert.deepEqual([h.state, h.inMinutes, h.untilMinutes, h.short], ['now', 0, null, 'jetzt Regen'])
})

test('Nowcast-Text: starker Regen jetzt, hört um 14:45 auf', () => {
  const h = nowcastHint(steps([8, 9, 3, 0, ...Array(9).fill(0)]), T0 + 10 * MIN)
  assert.equal(h.text, 'Jetzt starker Regen, hört ca. 14:45 auf')
  assert.equal(h.peak, 9)
  assert.equal(h.untilMinutes, 35)
})

const roundCases = [
  [2, 5, 'gleich: mindestens 5 Min.'],
  [23, 25, 'auf 5 Minuten gerundet'],
  [37, 35, 'abgerundet'],
]
for (const [lead, shown, why] of roundCases)
  test(`Nowcast-Text: Regen in ${lead} Minuten wird als „in ${shown} Min.“ gezeigt (${why})`, () => {
    // Regen ab 15:00 Wien (Schritt 4)
    const h = nowcastHint(steps([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]), T0 + 60 * MIN - lead * MIN)
    assert.equal(h.inMinutes, shown)
    assert.equal(h.text, `Leichter Regen ab ca. 15:00 (in ${shown} Min.)`)
  })

const wordCases = [
  ['mäßiger Schneefall', [0, 1.5, 1.5], KIND.snow, 'Mäßiger Schneefall ab ca. 14:15'],
  ['starker Schneefall ab 2,5 mm/h', [0, 2.5], KIND.snow, 'Starker Schneefall ab ca. 14:15'],
  ['leichter gefrierender Regen', [0, 0, 0.5], KIND.freezing, 'Leichter gefrierender Regen ab ca. 14:30'],
  ['mäßiger Schneeregen', [0, 3], KIND.sleet, 'Mäßiger Schneeregen ab ca. 14:15'],
]
for (const [name, rates, kind, start] of wordCases)
  test(`Nowcast-Text: ${name}`, () => {
    const h = nowcastHint(steps([...rates, ...Array(13 - rates.length).fill(0)], kind), T0)
    assert.equal(h.kind, kind)
    assert.ok(h.text.startsWith(start), h.text)
  })

test('Nowcast-Art: gleich oft Regen und Schnee → Schneefall, sonst die häufigste Art', () => {
  const tie = nowcastHint(steps([0, 0.6, 0.6, 0.6, 0.6, 0, 0, 0, 0, 0, 0, 0, 0], [0, KIND.rain, KIND.snow, KIND.rain, KIND.snow]), T0)
  assert.equal(tie.kind, KIND.snow)
  assert.match(tie.text, /^Leichter Schneefall/)
  const rainy = nowcastHint(steps([0, 0.6, 0.6, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, KIND.rain, KIND.snow, KIND.rain]), T0)
  assert.equal(rainy.kind, KIND.rain)
})

test('Nowcast: Schritte ohne Wert und ohne Art zählen nicht als Niederschlag', () => {
  assert.equal(nowcastHint([{ at: T0, rate: null }, { at: T0 + 15 * MIN, rate: null }], T0).state, 'unknown')
  assert.equal(nowcastHint(null, T0).text, 'Kein Nowcast verfügbar')
  // Menge ohne Art (pt = keiner): trocken
  const h = nowcastHint([{ at: T0, rate: 2, kind: KIND.none }, { at: T0 + 15 * MIN, rate: 0, kind: KIND.none }], T0)
  assert.equal(h.state, 'dry')
})

const intensities = [
  [0.09, KIND.rain, ''],
  [2.49, KIND.rain, 'leicht'],
  [2.5, KIND.rain, 'mäßig'],
  [7.6, KIND.rain, 'stark'],
  [0.99, KIND.snow, 'leicht'],
  [1, KIND.snow, 'mäßig'],
  [2.5, KIND.snow, 'stark'],
  [3, KIND.sleet, 'mäßig'],
]
for (const [rate, kind, word] of intensities) test(`Stärke: ${rate} mm/h (Art ${kind}) → „${word || 'keine'}“`, () => assert.equal(intensity(rate, kind), word))

// ---------------------------------------------------------------- Antwort lesen

function pointsJson(startMs, rows) {
  const timestamps = rows[0].map((_, i) => new Date(startMs + i * 15 * MIN).toISOString())
  return { reference_time: timestamps[0], timestamps, features: rows.map((r, p) => ({ geometry: { coordinates: [13 + p / 10, 47.8] }, properties: { parameters: Object.fromEntries(['rr', 'pt', 't2m'].map((k) => [k, { data: r.map((x) => x[k] ?? null) }])) } })) }
}

test('Nowcast lesen: ohne Art (pt) entscheidet die Temperatur – Schnee, Schneeregen, Regen', () => {
  const rows = [[{ rr: 0.25, t2m: -1 }, { rr: 0.25, t2m: 1 }, { rr: 0.25, t2m: 2 }, { rr: 0.25 }, { rr: 0.02, t2m: -3 }, { rr: 0.25, pt: 2, t2m: -3 }, { rr: 0.25, pt: 7, t2m: 5 }]]
  const [p] = parseNowcast(pointsJson(T0, rows)).points
  assert.deepEqual(p.steps.map((s) => s.kind), [KIND.snow, KIND.sleet, KIND.rain, KIND.rain, KIND.none, KIND.snow, KIND.sleet], 'unbekannte Art 2: Temperatur; Art 7 gilt auch bei +5 °C')
  assert.ok(Math.abs(p.steps[4].rate - 0.08) < 1e-6, 'Spuren unter 0,1 mm/h: kein Niederschlag')
  assert.equal(p.steps[3].t, null)
  assert.ok(Math.abs(p.lon - 13) < 1e-6 && Math.abs(p.lat - 47.8) < 1e-5)
})

test('Nowcast lesen: Antwort ohne Werte oder mit kaputter Zeit wird abgelehnt', () => {
  const empty = { timestamps: [new Date(T0).toISOString()], features: [{ geometry: { coordinates: [13, 47] }, properties: { parameters: {} } }] }
  assert.throws(() => parsePoints(empty, ['rr']), /ohne Niederschlagswerte/)
  assert.throws(() => parsePoints({ ...empty, timestamps: ['gestern'] }, ['rr']), /Unerwartete Antwort/)
  const p = parsePoints({ ...empty, features: [{ properties: { parameters: { rr: { data: ['x', 0.5] } } } }] }, ['rr'])
  assert.ok(Number.isNaN(p.values.rr[0][0]), 'ungültiger Wert: NaN')
  assert.ok(Number.isNaN(p.lat[0]), 'Punkt ohne Koordinaten')
  assert.equal(p.reference, null)
})

// ---------------------------------------------------------------- Radar

test('Radar-Ausschnitt: ein Ort mit Rand, auf 0,05° gerundet', () => {
  assert.deepEqual(radarBbox([{ lat: 47.8095, lon: 13.055 }]), { s: 47.5, w: 12.6, n: 48.1, e: 13.5 })
  assert.deepEqual(radarBbox([{ lat: '47.8095', lon: '13.055' }, { lat: 'x', lon: 1 }]), { s: 47.5, w: 12.6, n: 48.1, e: 13.5 }, 'Texte als Zahl, ungültige Punkte fallen weg')
})

test('Radar-Ausschnitt: am Rand von Österreich abgeschnitten, ohne gültige Orte keiner', () => {
  assert.deepEqual(radarBbox([{ lat: 47.4, lon: 9.2 }]), { s: 47.1, w: 9, n: 47.7, e: 9.65 }, 'Westgrenze 9°')
  assert.equal(radarBbox([{ lat: 49.3, lon: 15 }]).n, 49.4, 'Nordgrenze 49,4°')
  assert.equal(radarBbox([{ lat: null, lon: undefined }]), null)
  assert.equal(radarBbox([{ lat: 60, lon: 30 }]), null, 'ganz außerhalb: nichts übrig')
})

test('Radar: Zeitfenster je Quelle, Nowcast ohne Zeitraum, Raster liegt im Ausschnitt', () => {
  const now = Date.parse('2026-11-03T13:40:00Z')
  assert.equal(radarWindow('nowcast', now), null)
  assert.deepEqual(radarWindow('inca', now), { start: '2026-11-03T10:00', end: '2026-11-03T13:00' })
  const b = { s: 47.5, w: 12.6, n: 48.1, e: 13.5 }
  assert.ok(!/start=/.test(radarUrl('nowcast', { bbox: b, now })))
  assert.match(radarUrl('modell', { bbox: b, now }), /grid\/forecast\/nwp-v2-1h-1km\?parameters=tp,sf&bbox=47\.5,12\.6,48\.1,13\.5&start=2026-11-03T16:00&end=2026-11-03T22:00/)
  const pts = latticePoints(b, 4)
  assert.equal(pts.length, 16)
  assert.ok(pts.every((p) => p.lat > b.s && p.lat < b.n && p.lon > b.w && p.lon < b.e))
  assert.deepEqual(pts[0], { lat: 47.575, lon: 12.7125 }, 'Mitte der ersten Zelle')
})

test('Radarfarben: Regen nach Stärke, Schnee lila, Schneeregen und gefrierender Regen eigene Farbe', () => {
  assert.deepEqual(rateColor(0.1, KIND.rain), [130, 200, 255, 150])
  assert.deepEqual(rateColor(0.49, KIND.rain), [130, 200, 255, 150])
  assert.deepEqual(rateColor(0.5, KIND.rain), [70, 160, 245, 185])
  assert.deepEqual(rateColor(80, KIND.rain), [170, 20, 150, 245], 'über 50 mm/h violett')
  assert.deepEqual(rateColor(6, KIND.snow), [90, 30, 190, 240])
  assert.deepEqual(rateColor(0.2, KIND.sleet), rateColor(30, KIND.sleet), 'Schneeregen unabhängig von der Stärke')
  assert.notDeepEqual(rateColor(1, KIND.freezing), rateColor(1, KIND.sleet))
  assert.equal(rateColor(5, KIND.none), null)
  assert.equal(LEGEND.rain.length, 8)
  assert.equal(LEGEND.sleet, 'rgb(255 120 200)')
})

test('Radarbild: höchster Wert, nasse Fläche und Schneeanteil', () => {
  const frame = { rate: new Float32Array([0, 0.5, 2.25, 0.05]), type: new Uint8Array([KIND.none, KIND.snow, KIND.rain, KIND.rain]) }
  assert.deepEqual(frameStats(frame), { max: 2.3, wetShare: 0.5, snowShare: 0.5 })
  assert.deepEqual(frameStats({ rate: new Float32Array(0), type: new Uint8Array(0) }), { max: 0, wetShare: 0, snowShare: 0 })
})

test('Radarbilder nur aus INCA: das letzte vergangene Bild gilt als „jetzt“', () => {
  const bbox = { s: 47.7, w: 13.0, n: 47.9, e: 13.2 }
  const coords = latticePoints(bbox, 2)
  const json = { timestamps: Array.from({ length: 4 }, (_, i) => new Date(Date.parse('2026-11-03T10:00:00Z') + i * 3600e3).toISOString()), features: coords.map((c, p) => ({ geometry: { coordinates: [c.lon, c.lat] }, properties: { parameters: { RR: { data: [p === 0 ? 1 : 0, 0, 0, 2] }, T2M: { data: [-2, -2, -2, 5] } } } })) }
  const inca = parsePoints(json, ['RR', 'T2M'])
  const frames = radarFrames({ inca: { points: inca, lattice: 2 } }, { bbox, now: Date.parse('2026-11-03T13:20:00Z') })
  assert.deepEqual(frames.map((f) => f.kind), ['past', 'past', 'past', 'past'])
  assert.deepEqual(frames.map((f) => !!f.current), [false, false, false, true])
  assert.equal(frames[0].type[0], KIND.snow, 'kalt: Schnee')
  assert.equal(frames[3].type[0], KIND.rain, '+5 °C: Regen')
  assert.equal(frames[0].source, 'INCA')
})
