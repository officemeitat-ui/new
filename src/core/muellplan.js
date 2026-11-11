// Müllplan je Person und Woche – aufgebaut wie die bisherigen Word-Pläne des Büros: je Tag, je Ort die Gänge
// „Biomüll raus – Davisstraße 7, 9, 11“ (gleiche Straße zusammengefasst, zuerst „zurück“, dann „raus“).
// Grundlage sind die Müll-Gänge der Woche (core/waste.js) mit der eingeteilten Person.

import { addDays } from './dates.js'
import { WASTE_TYPES } from './waste.js'

/** Kurze Namen wie auf den bisherigen Plänen. */
export const WASTE_SHORT = { Altpapier: 'Papier', Leichtverpackung: 'Plastik' }
export const ACTION_TEXT = { out: 'raus', in: 'zurück' }

const PLZ = /^(?:[A-Z]{1,2}-)?\d{4,5}\s+(.+)$/

/**
 * Adresse zerlegen: „Davisstraße 9, 5400 Hallein“ → { street: 'Davisstraße', no: '9', town: 'Hallein' }.
 * Auch ohne Komma („Markt 303 5441 Abtenau“) oder ohne Postleitzahl („Davisstraße 9, Hallein“).
 */
export function splitAddress(address = '') {
  const parts = String(address || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  let first = parts[0] || ''
  let town = ''
  for (const p of parts.slice(1)) {
    const m = p.match(PLZ)
    if (m) {
      town = m[1].trim()
      break
    }
  }
  if (!town && parts.length === 1) {
    const m = first.match(/^(.*?\S)\s+(?:[A-Z]{1,2}-)?\d{4,5}\s+(\D.*)$/)
    if (m) {
      first = m[1].trim()
      town = m[2].trim()
    }
  }
  if (!town && parts.length > 1 && !/\d/.test(parts.at(-1))) town = parts.at(-1)
  const m = first.match(/^(.*?\D)\s*(\d+\s*[a-z]?(?:\s*[/-]\s*\d+\s*[a-z]?)?)$/i)
  return m ? { street: m[1].trim(), no: m[2].replace(/\s+/g, ''), town } : { street: first, no: '', town }
}

/** Orte zusammenfassen: Davisstraße 7, Davisstraße 9, Thunstraße → „Davisstraße 7, 9, Thunstraße“. */
export function joinStreets(places = []) {
  const groups = []
  for (const p of places) {
    if (!p.street) continue
    let g = groups.find((x) => x.street === p.street)
    if (!g) groups.push((g = { street: p.street, nos: [] }))
    if (p.no && !g.nos.includes(p.no)) g.nos.push(p.no)
  }
  return groups
    .map((g) => {
      const nos = [...g.nos].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b, 'de'))
      return nos.length ? `${g.street} ${nos.join(', ')}` : g.street
    })
    .join(', ')
}

/**
 * Plan einer Person für die Woche ab `monday`.
 *  duties:  Gänge der Person [{ date, action: 'out' | 'in', types: [...], objectId }]
 *  objects: Objekte [{ id, name, short, address }]
 * → { towns: [Orte in der Reihenfolge des ersten Vorkommens], days: [7 × { date, groups: [{ town, lines: [{ type, label,
 *    action, text }] }] }] }
 */
export function personWastePlan(duties = [], objects = [], monday) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), groups: [] }))
  const towns = []
  for (const d of duties) {
    const day = days.find((x) => x.date === d.date)
    if (!day) continue
    const o = byId.get(d.objectId) || {}
    const a = splitAddress(o.address)
    const place = a.street ? a : { street: o.short || o.name || '', no: '', town: a.town }
    if (place.town && !towns.includes(place.town)) towns.push(place.town)
    let g = day.groups.find((x) => x.town === place.town)
    if (!g) day.groups.push((g = { town: place.town, lines: [] }))
    for (const type of d.types || []) {
      let line = g.lines.find((l) => l.type === type && l.action === d.action)
      if (!line) g.lines.push((line = { type, label: WASTE_SHORT[type] || type, action: d.action, places: [] }))
      if (!line.places.some((p) => p.street === place.street && p.no === place.no)) line.places.push(place)
    }
  }
  const order = (t) => (WASTE_TYPES.includes(t) ? WASTE_TYPES.indexOf(t) : WASTE_TYPES.length)
  for (const day of days) {
    day.groups.sort((a, b) => towns.indexOf(a.town) - towns.indexOf(b.town))
    for (const g of day.groups) {
      g.lines.sort((a, b) => Number(a.action === 'out') - Number(b.action === 'out') || order(a.type) - order(b.type))
      g.lines = g.lines.map(({ places, ...l }) => ({ ...l, text: joinStreets(places) }))
    }
  }
  return { towns, days }
}

/** Überschrift wie bisher: „Müllplan Hallein + Golling“. */
export const wastePlanTitle = (plan) => (plan.towns.length ? `Müllplan ${plan.towns.join(' + ')}` : 'Müllplan')

/** Hat der Plan überhaupt einen Gang? */
export const hasDuties = (plan) => plan.days.some((d) => d.groups.some((g) => g.lines.length))
