// Mattenwechsel: Daten für die Karte der Touren eines Tages (core/matten-karte.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bboxOf, TOUR_COLORS, tourMapData } from '../src/core/matten-karte.js'

const depot = { name: 'Betriebshof', address: 'Beispielweg 1, 5020 Salzburg', lat: 47.7745, lon: 13.07 }
const stop = (id, name, lat, lon, extra = {}) => ({ id, customer: { name }, objectName: `${name} Haus`, ...(lat ? { lat, lon } : {}), status: 'geplant', items: [], ...extra })
const tour = (id, driverName, stops, extra = {}) => ({ id, driverName, order: stops.map((s) => s.id), stops, route: { depot }, ...extra })

test('Karte: Stopps in Fahrreihenfolge mit Nummer, Linie über den Betriebshof, je Tour eine Farbe', () => {
  const a = tour('t1', 'Markus Huber', [stop('s1', 'Bäckerei', 47.80, 13.04, { times: { arrival: '07:20' } }), stop('s2', 'Praxis', 47.81, 13.05, { status: 'abgeschlossen' })], { order: ['s2', 's1'] })
  const b = tour('t2', '', [stop('s3', 'Autohaus', 47.79, 13.01)])
  const d = tourMapData([a, b])
  assert.deepEqual(d.marks.map((m) => [m.kind, m.text, m.color || '']), [['depot', 'B', ''], ['stopp', '1', TOUR_COLORS[0]], ['stopp', '2', TOUR_COLORS[0]], ['stopp', '1', TOUR_COLORS[1]]])
  // Reihenfolge laut tour.order: zuerst die Praxis (erledigt), dann die Bäckerei
  assert.equal(d.marks[1].stopId, 's2')
  assert.equal(d.marks[1].done, true)
  assert.equal(d.marks[2].done, false)
  assert.equal(d.marks[2].title, '2. Bäckerei · Bäckerei Haus, ca. 07:20 Uhr (Markus Huber)')
  assert.match(d.marks[0].title, /^Betriebshof: Betriebshof, Beispielweg 1/)
  assert.deepEqual(d.paths.map((p) => [p.tourId, p.color, p.points.length]), [['t1', TOUR_COLORS[0], 4], ['t2', TOUR_COLORS[1], 3]])
  assert.deepEqual(d.paths[0].points[0], { lat: depot.lat, lon: depot.lon })
  assert.deepEqual(d.paths[0].points.at(-1), { lat: depot.lat, lon: depot.lon })
  assert.deepEqual(d.legend, [{ tourId: 't1', color: TOUR_COLORS[0], label: 'Markus Huber', stops: 2, placed: 2 }, { tourId: 't2', color: TOUR_COLORS[1], label: 'ohne Fahrer', stops: 1, placed: 1 }])
  assert.deepEqual(d.missing, [])
  // Ausschnitt umfasst alle Punkte mit Rand
  assert.ok(d.bbox.n > 47.81 && d.bbox.s < 47.7745 && d.bbox.w < 13.01 && d.bbox.e > 13.07)
})

test('Karte: Stopps ohne Koordinaten fehlen auf der Karte und werden genannt; Betriebshof aus den Einstellungen als Rückfall', () => {
  const t = { id: 't1', driverName: 'Markus Huber', order: ['s1', 's2'], stops: [stop('s1', 'Bäckerei'), stop('s2', 'Praxis', 47.81, 13.05)], route: {} }
  const d = tourMapData([t], { depot })
  assert.deepEqual(d.missing, [{ tourId: 't1', stopId: 's1', n: 1, name: 'Bäckerei' }])
  assert.deepEqual(d.marks.map((m) => [m.kind, m.text]), [['depot', 'B'], ['stopp', '2']])
  assert.deepEqual(d.legend[0], { tourId: 't1', color: TOUR_COLORS[0], label: 'Markus Huber', stops: 2, placed: 1 })
  assert.equal(d.paths[0].points.length, 3)
  // ohne Betriebshof und mit nur einem Punkt: keine Linie, aber ein Ausschnitt
  const single = tourMapData([t])
  assert.deepEqual(single.paths, [])
  assert.ok(single.bbox.n - single.bbox.s >= 0.004 && single.bbox.e - single.bbox.w >= 0.006)
  // gar nichts zu zeigen
  const none = tourMapData([{ id: 't9', stops: [stop('s1', 'Bäckerei')], order: ['s1'] }])
  assert.equal(none.bbox, null)
  assert.deepEqual(none.marks, [])
  assert.deepEqual(tourMapData([]).legend, [])
})

test('Karte: mehr Touren als Farben beginnen wieder vorn; Ausschnitt ohne Punkte', () => {
  const tours = Array.from({ length: TOUR_COLORS.length + 1 }, (_, i) => tour(`t${i}`, `Fahrer ${i}`, [stop(`s${i}`, 'Kunde', 47.8 + i / 100, 13.05)]))
  const d = tourMapData(tours)
  assert.equal(d.legend.at(-1).color, TOUR_COLORS[0])
  assert.equal(bboxOf([]), null)
  assert.equal(bboxOf([{ lat: 'x', lon: 1 }]), null)
})
