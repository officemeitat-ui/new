import { test } from 'node:test'
import assert from 'node:assert/strict'

import { coordsText, estimateTravel, haversineKm, nominatimUrl, parseCoords, parseNominatim } from '../src/core/geo.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { createContext } from '../src/core/rules.js'

// Salzburg Hauptbahnhof, Salzburg Mirabellplatz, Hallein Bayrhamerplatz (gerundet)
const hbf = { lat: 47.8132, lon: 13.0457 }
const mirabell = { lat: 47.8058, lon: 13.0425 }
const hallein = { lat: 47.6831, lon: 13.0972 }

test('Entfernung und geschätzte Fahrzeit: Stadt, Umland, gleiche Stelle, fehlende Koordinaten', () => {
  assert.ok(Math.abs(haversineKm(hbf, hallein) - 14.9) < 0.5, String(haversineKm(hbf, hallein)))
  const city = estimateTravel(hbf, mirabell)
  assert.ok(city.km > 0.9 && city.km < 1.3, String(city.km))
  assert.equal(city.minutes, 10, '5 min Zuschlag + gut 2 min Fahrt → auf 5 aufgerundet')
  const land = estimateTravel(hbf, hallein, { speedKmh: 45 })
  assert.equal(land.minutes, 35, `${land.km} km`)
  assert.deepEqual(estimateTravel(hbf, { lat: 47.81325, lon: 13.04572 }), { minutes: 0, km: 0 }, 'unter 100 m')
  assert.equal(estimateTravel(hbf, { lat: null, lon: 13 }), null)
})

test('Koordinaten lesen und schreiben, Suche bei OpenStreetMap', () => {
  assert.deepEqual(parseCoords('47.8095, 13.055'), { lat: 47.8095, lon: 13.055 })
  assert.deepEqual(parseCoords('47,8095 13,055'), { lat: 47.8095, lon: 13.055 })
  assert.deepEqual(parseCoords('47.8095;13.055'), { lat: 47.8095, lon: 13.055 })
  assert.equal(parseCoords('13.055, 47.8095'), null, 'vertauscht: nicht in Österreich')
  assert.equal(parseCoords('Salzburg'), null)
  assert.equal(coordsText({ lat: 47.8095, lon: 13.055 }), '47.80950, 13.05500')
  assert.equal(nominatimUrl('Rif 3, 5400 Hallein'), 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&q=Rif%203%2C%205400%20Hallein')
  assert.deepEqual(parseNominatim([{ lat: '47.6831234', lon: '13.0972345', display_name: 'Hallein' }]), { lat: 47.683123, lon: 13.097235, label: 'Hallein' })
  assert.equal(parseNominatim([]), null)
})

test('Fahrzeit im Plan: Strecke vor Schätzung vor Pauschale; Schätzung abschaltbar', () => {
  const objects = [{ id: 'a', ...hbf }, { id: 'b', ...hallein }, { id: 'c', name: 'ohne Koordinaten' }]
  const holidays = holidayCalendar('2026-11-01', '2026-11-30')
  const ctx = createContext({ employees: [], objects, rules: { travelSpeedKmh: 45 }, travel: { 'a|c': 12 } }, holidays)
  assert.deepEqual(ctx.travelInfo('a', 'b'), { minutes: 35, source: 'geschaetzt', km: estimateTravel(hbf, hallein).km })
  assert.equal(ctx.travel('b', 'a'), 35, 'beide Richtungen')
  assert.deepEqual(ctx.travelInfo('a', 'c'), { minutes: 12, source: 'strecke' })
  assert.deepEqual(ctx.travelInfo('b', 'c'), { minutes: 30, source: 'pauschale' })
  assert.deepEqual(ctx.travelInfo('a', 'a'), { minutes: 0, source: 'gleich' })
  const off = createContext({ employees: [], objects, rules: { travelFromDistance: false } }, holidays)
  assert.equal(off.travel('a', 'b'), 30)
})
