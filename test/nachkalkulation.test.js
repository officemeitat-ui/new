// Nachkalkulation: kalkulierte gegen gerechnete Stunden je Objekt, Vorschlag für Leistungswerte je Raumart
// (core/nachkalkulation.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nachkalkulation, suggestPerformance } from '../src/core/nachkalkulation.js'

const settings = { setupPct: 0, performance: { buero: 200, sanitaer: 60 } }
// Büro 1000 m² 5×/Woche: 1000/200 × 5 × 4,333 = 108,3 h; Sanitär 60 m² 5×: 21,7 h → 130 h je Monat
const calcObjects = {
  o1: { areas: [{ type: 'buero', m2: 1000, perWeek: 5 }, { type: 'sanitaer', m2: 60, perWeek: 5 }] },
  o2: { areas: [{ type: 'buero', m2: 500, perWeek: 5 }] }, // 54,2 h
  o3: { areas: [{ type: 'buero', m2: 400, perWeek: 5, value: 100 }] }, // eigener Leistungswert
  o9: { areas: [{ type: 'buero', m2: 100, perWeek: 1 }] }, // Objekt gibt es nicht mehr
}
const objects = [{ id: 'o1', name: 'Büro A' }, { id: 'o2', name: 'Büro B' }, { id: 'o3', name: 'Büro C' }]
const min = (h) => h * 60

test('Je Objekt: kalkuliert, geplant, gerechnet je Monat, Faktor, Verlässlichkeit', () => {
  const hours = new Map([
    ['o1', { planned: min(390), used: min(3 * 156), stamped: min(400), pairs: 10, stampedPairs: 8 }], // 3 Monate, 156 h/Monat
    ['o2', { planned: min(162), used: min(162), stamped: 0, pairs: 10, stampedPairs: 0 }], // nur Plan
  ])
  const rows = nachkalkulation({ objects, calcObjects, settings, hours, months: 3 })
  const by = Object.fromEntries(rows.map((r) => [r.objectId, r]))
  assert.deepEqual(Object.keys(by).sort(), ['o1', 'o2', 'o3'])
  assert.equal(by.o1.calcHours, 130)
  assert.equal(by.o1.usedHours, 156)
  assert.equal(by.o1.plannedHours, 130)
  assert.ok(Math.abs(by.o1.factor - 130 / 156) < 1e-9)
  assert.ok(Math.abs(by.o1.deviation - 0.2) < 1e-9)
  assert.equal(by.o1.reliable, true)
  assert.equal(by.o2.reliable, false) // nicht gestempelt
  assert.equal(by.o3.factor, null) // keine Stunden
  assert.equal(rows[0].objectId, 'o1') // größte Abweichung zuerst
})

test('Vorschlag je Raumart: gewichtet, gerundet, begrenzt, eigene Werte ausgenommen', () => {
  const hours = new Map([
    ['o1', { planned: 0, used: min(156), stamped: min(156), pairs: 4, stampedPairs: 4 }],
    ['o3', { planned: 0, used: min(10), stamped: min(10), pairs: 4, stampedPairs: 4 }],
  ])
  const rows = nachkalkulation({ objects, calcObjects, settings, hours, months: 1 })
  const s = suggestPerformance(rows, settings.performance)
  const by = Object.fromEntries(s.map((x) => [x.type, x]))
  // o1 ist 20 % langsamer: Faktor 0,833 → Büro 200 × 0,833 = 166,7 → 165; Sanitär 60 × 0,833 = 50
  assert.equal(by.buero.suggested, 165)
  assert.equal(by.sanitaer.suggested, 50)
  assert.equal(by.buero.objects, 1) // o3 hat einen eigenen Leistungswert und zählt nicht
  // Begrenzung auf ± 40 %: viel zu schnell
  const fast = nachkalkulation({ objects, calcObjects, settings, hours: new Map([['o2', { planned: 0, used: min(10), stamped: min(10), pairs: 1, stampedPairs: 1 }]]), months: 1 })
  assert.equal(suggestPerformance(fast, settings.performance).find((x) => x.type === 'buero').suggested, 280)
  assert.deepEqual(suggestPerformance([], settings.performance), [])
})
