// Objektmappe (nach dem Objektdoku-Tool): je Objekt Kunde, Ansprechpartner,
// Zugang (ohne Codes), Geräte, Hinweise, Anhänge und das Leistungsverzeichnis
// (Bereiche mit Leistungen, Häufigkeit und Richtzeit). Stunden werden nie
// getippt, sondern gerechnet und mit dem Dienstplan verglichen.
//
// Daten (objektmappe/objektmappe.json):
//   objects:   { objektId: { customerNo, customer, objectNo, kind, contract, validFrom, street, hvEmail, notes,
//                contacts: [{ name, role, phone, mail, note, internal }],
//                access: [{ label, number, type, count, place, note, confidential }],
//                devices: [{ label, place, inventoryNo, owner: 'eigen'|'Kunde', condition }],
//                attachments: [{ name, url }],
//                areas: [{ name, location, size, floor, services: [{ what, interval, minutes, method }] }],
//                checkedAt?, checkedBy? } }
//   customers: [{ nr, name, street, city, email }]   Kundenstamm (z. B. aus der Kundenverwaltung)

import { parseTable } from './importer.js'

/** Häufigkeiten im Leistungsverzeichnis: Einsätze pro Woche (Bedarf/Witterung: nicht planbar). */
export const LV_INTERVALS = {
  t7: { label: 'täglich (7× pro Woche)', perWeek: 7 },
  t6: { label: '6× pro Woche', perWeek: 6 },
  t5: { label: 'werktags (5× pro Woche)', perWeek: 5 },
  w4: { label: '4× pro Woche', perWeek: 4 },
  w3: { label: '3× pro Woche', perWeek: 3 },
  w2: { label: '2× pro Woche', perWeek: 2 },
  w1: { label: 'wöchentlich', perWeek: 1 },
  w14: { label: '14-tägig', perWeek: 0.5 },
  m2: { label: '2× im Monat', perWeek: 24 / 52 },
  m1: { label: 'monatlich', perWeek: 12 / 52 },
  q1: { label: 'quartalsweise', perWeek: 4 / 52 },
  h1: { label: 'halbjährlich', perWeek: 2 / 52 },
  j1: { label: 'jährlich', perWeek: 1 / 52 },
  bedarf: { label: 'nach Bedarf', perWeek: 0 },
  witter: { label: 'witterungsabhängig', perWeek: 0 },
}

export const ACCESS_TYPES = ['Schlüssel', 'Transponder', 'Karte', 'Code']

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Minuten pro Woche einer Leistung, eines Bereichs, einer Mappe. */
export const serviceMinutes = (s) => num(s.minutes) * (LV_INTERVALS[s.interval]?.perWeek ?? 0)
export const areaMinutes = (a) => (a.services || []).reduce((x, s) => x + serviceMinutes(s), 0)
export const lvMinutes = (m) => (m?.areas || []).reduce((x, a) => x + areaMinutes(a), 0)

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Geplante Minuten pro Woche laut Dienstplan (Stammplan, ohne Sonderleistungen und Einmaliges). */
export function plannedMinutes(tasks, objectId) {
  let sum = 0
  for (const t of tasks) {
    if (t.objectId !== objectId || t.category === 'sonder') continue
    let dur = toMin(t.end) - toMin(t.start)
    if (dur <= 0) dur += 1440
    const r = t.recurrence || {}
    const perWeek = r.type === 'weekly' ? (r.weekdays || []).length / (r.everyWeeks || 1) : r.type === 'monthly' ? 12 / 52 / (r.everyMonths || 1) : 0
    sum += dur * (t.staff || 1) * perWeek
  }
  return Math.round(sum)
}

/** Vergleich Leistungsverzeichnis ↔ Dienstplan: Abweichung in Minuten und Prozent. */
export function compareHours(mappe, tasks, objectId) {
  const lv = Math.round(lvMinutes(mappe))
  const plan = plannedMinutes(tasks, objectId)
  const diff = plan - lv
  return { lv, plan, diff, pct: lv ? Math.round((diff / lv) * 100) : null, warn: lv > 0 && plan > 0 && Math.abs(diff) > Math.max(30, lv * 0.1) }
}

/** Pflegestand: was fehlt noch in der Mappe? */
export function completeness(m = {}, object = {}) {
  const checks = [
    ['Kunde', !!m.customer],
    ['Ansprechpartner', !!m.contacts?.length],
    ['Zugang / Schlüssel', !!(m.access?.length || object.keys?.length)],
    ['Hinweise', !!(m.notes || object.instructions)],
    ['Leistungsverzeichnis', !!m.areas?.some((a) => a.services?.length)],
  ]
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label)
  return { pct: Math.round(((checks.length - missing.length) / checks.length) * 100), missing }
}

// ---------------------------------------------------------------- Objektblatt

/** Abschnitte des Objektblatts; confidential = nie in der Kundenfassung. */
export const SECTIONS = [
  { id: 'objekt', label: 'Objektdaten' },
  { id: 'kontakte', label: 'Ansprechpartner', confidential: true },
  { id: 'zeiten', label: 'Reinigungszeiten' },
  { id: 'zugang', label: 'Schlüssel und Zugang', confidential: true },
  { id: 'hinweise', label: 'Hinweise' },
  { id: 'leistungen', label: 'Bereiche und Leistungen' },
  { id: 'stunden', label: 'Richtzeiten und Stunden', confidential: true },
  { id: 'geraete', label: 'Geräte' },
  { id: 'muell', label: 'Müllplan' },
  { id: 'zaehler', label: 'Zählerstellen' },
  { id: 'kontrolle', label: 'Letzte Kontrolle und offene Mängel', confidential: true },
  { id: 'anhaenge', label: 'Anhangsverzeichnis' },
  { id: 'unterschrift', label: 'Unterschriftsfeld' },
]

export const PRESETS = {
  mitarbeiter: { label: 'Mitarbeiter (Objektblatt fürs Personal)', sections: ['objekt', 'kontakte', 'zeiten', 'zugang', 'hinweise', 'leistungen', 'geraete', 'muell', 'zaehler'] },
  kunde: { label: 'Kunde (Leistungsverzeichnis, nichts Vertrauliches)', sections: ['objekt', 'zeiten', 'hinweise', 'leistungen', 'anhaenge', 'unterschrift'], customer: true },
  akte: { label: 'Akte (Büro, alles)', sections: SECTIONS.map((s) => s.id) },
}

/** Gewählte Abschnitte; in der Kundenfassung werden vertrauliche nie ausgegeben. */
export function sheetSections(preset, chosen) {
  const p = PRESETS[preset] || PRESETS.mitarbeiter
  const list = chosen?.length ? chosen : p.sections
  return SECTIONS.filter((s) => list.includes(s.id) && !(p.customer && s.confidential)).map((s) => s.id)
}

// ---------------------------------------------------------------- Kundenstamm

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const pick = (row, ...names) => {
  const key = Object.keys(row).find((k) => names.includes(norm(k)))
  return key === undefined ? '' : String(row[key] ?? '').trim()
}

/**
 * Kundenstamm einlesen: Kunden.json aus dem Prüfprotokoll-Tool ({ nr, name,
 * strasse, ort, email }) oder CSV/Excel mit Überschriften.
 */
export function importCustomers(text) {
  let rows
  try {
    const json = JSON.parse(text)
    rows = Array.isArray(json) ? json : json.kunden || json.customers || []
  } catch {
    rows = parseTable(text)
  }
  const out = []
  for (const row of rows) {
    const c = { nr: pick(row, 'nr', 'kundennr', 'kundennummer', 'nummer'), name: pick(row, 'name', 'kunde', 'firma'), street: pick(row, 'strasse', 'street', 'adresse'), city: pick(row, 'ort', 'city', 'plzort'), email: pick(row, 'email', 'mail', 'emailadresse') }
    if (c.name) out.push(c)
  }
  return out
}
