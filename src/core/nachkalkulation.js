// Nachkalkulation (Kalkulation → Reiter „Nachkalkulation“): je Objekt mit Kalkulation die kalkulierten Stunden je Monat
// gegen die geplanten und die gerechneten Stunden (gestempelt, sonst Plan; core/rentabilitaet.js hoursByObject). Daraus
// ein Vorschlag, die Leistungswerte (m² je Stunde) je Raumart anzupassen: Die Kalkulation lernt aus der Praxis.
//
// Faktor je Objekt = kalkulierte ÷ gerechnete Stunden (> 1: schneller als kalkuliert, < 1: langsamer). Für den
// Vorschlag zählen nur Objekte, bei denen mindestens die Hälfte der Einsätze gestempelt ist (sonst wäre es nur der
// Plan). Je Raumart: neuer Leistungswert = bisheriger × gewichteter Faktor (Gewicht = kalkulierte Minuten dieser Raumart
// im Objekt), gerundet auf 5 m²/h, begrenzt auf ± 40 % je Schritt. Übernommen wird nur, was die Person bestätigt.
// Rein und getestet (test/nachkalkulation.test.js).

import { AREA_TYPES, calculate } from './calculation.js'

export const NK_MIN_STAMPED = 0.5
export const NK_MAX_STEP = 0.4
const r1 = (n) => Math.round(n * 10) / 10

/**
 * Zeilen je Objekt: [{ objectId, name, calcHours, plannedHours, usedHours, stampedShare, factor, deviation, reliable }]
 * (Stunden je Monat). calcObjects: { objectId: { areas } }, hours: Map objectId → { planned, used, stamped, pairs,
 * stampedPairs } in Minuten über den ganzen Zeitraum, months: Länge des Zeitraums in Monaten.
 */
export function nachkalkulation({ objects = [], calcObjects = {}, settings = {}, hours = new Map(), months = 1, wage = 0 }) {
  const names = new Map(objects.map((o) => [o.id, o.name]))
  const rows = []
  for (const [objectId, c] of Object.entries(calcObjects || {})) {
    if (!c?.areas?.length || !names.has(objectId)) continue
    const calc = calculate({ areas: c.areas, settings, wage })
    if (!calc.hours) continue
    const h = hours.get(objectId) || { planned: 0, used: 0, stamped: 0, pairs: 0, stampedPairs: 0 }
    const plannedHours = r1(h.planned / 60 / months)
    const usedHours = r1(h.used / 60 / months)
    const stampedShare = h.pairs ? h.stampedPairs / h.pairs : null
    const factor = usedHours > 0 ? calc.hours / usedHours : null
    rows.push({
      objectId,
      name: names.get(objectId),
      calcHours: calc.hours,
      plannedHours,
      usedHours,
      stampedShare,
      factor,
      deviation: factor === null ? null : usedHours / calc.hours - 1,
      reliable: factor !== null && stampedShare !== null && stampedShare >= NK_MIN_STAMPED,
      rows: calc.rows,
    })
  }
  return rows.sort((a, b) => Math.abs(b.deviation ?? 0) - Math.abs(a.deviation ?? 0) || a.name.localeCompare(b.name, 'de'))
}

/**
 * Vorschlag je Raumart aus den verlässlichen Objekten: [{ type, label, current, suggested, factor, objects, minutes }].
 * Nur Raumarten mit Fläche in mindestens einem verlässlichen Objekt; eigene Leistungswerte einer Fläche (value)
 * zählen nicht (die Fläche hat dann ihren eigenen Wert).
 */
export function suggestPerformance(rows, performance = {}) {
  const acc = new Map()
  for (const r of rows.filter((x) => x.reliable)) {
    for (const line of r.rows) {
      if (Number(line.area.value) > 0) continue
      const t = line.area.type
      const x = acc.get(t) || { weight: 0, sum: 0, objects: new Set() }
      x.weight += line.minutes
      x.sum += line.minutes * r.factor
      x.objects.add(r.objectId)
      acc.set(t, x)
    }
  }
  const out = []
  for (const [type, x] of acc) {
    if (!x.weight) continue
    const current = Number(performance[type]) || AREA_TYPES[type]?.[1] || 150
    const factor = Math.min(1 + NK_MAX_STEP, Math.max(1 - NK_MAX_STEP, x.sum / x.weight))
    const suggested = Math.max(5, Math.round((current * factor) / 5) * 5)
    out.push({ type, label: AREA_TYPES[type]?.[0] || type, current, suggested, factor, objects: x.objects.size, minutes: Math.round(x.weight) })
  }
  return out.sort((a, b) => Math.abs(b.factor - 1) - Math.abs(a.factor - 1))
}
