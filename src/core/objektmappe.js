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
//                areas: [{ name, location, size, floor, services: [{ what, interval, minutes, method }],
//                          rooms: [{ no, name, size, floor, note }] }],        Raumbuch je Bereich
//                manager, deputy, serviceDays: ['Mo', 'Mi'], timeWindows: [{ days, from, to, note }], timeNote,
//                photos: [{ id, kind: 'ablauf'|'zugang', area, title, text, date, photo }],
//                version, reason, checkedAt, checkedBy,                       aktuelle Fassung
//                history: [{ version, at, by, reason, keys?, data }] } }      frühere Fassungen, neueste zuerst
//   customers: [{ nr, name, street, city, email }]   Kundenstamm (z. B. aus der Kundenverwaltung)
//   templates: [{ id, name, floor, note, services }]  eigene Bereichsvorlagen

import { todayISO } from './dates.js'
import { parseTable } from './importer.js'

/**
 * Häufigkeiten im Leistungsverzeichnis: dieselben 15 Kennungen wie im
 * Objektdoku-Tool (Schnittstelle, 1:1). perWeek = Einsätze je Woche; Monat und
 * Jahr über 52 Wochen. Bedarf und Witterung zählen nicht zu den Stunden.
 */
export const LV_INTERVALS = {
  t7: { label: 'täglich Mo–So', perWeek: 7 },
  t6: { label: '6× Woche', perWeek: 6 },
  t5: { label: 'täglich Mo–Fr', perWeek: 5 },
  w4: { label: '4× Woche', perWeek: 4 },
  w3: { label: '3× Woche', perWeek: 3 },
  w2: { label: '2× Woche', perWeek: 2 },
  w1: { label: 'wöchentlich', perWeek: 1 },
  w14: { label: '14-tägig', perWeek: 0.5 },
  m1: { label: 'monatlich', perWeek: 12 / 52 },
  m2: { label: '2-monatlich', perWeek: 6 / 52 },
  q1: { label: 'vierteljährlich', perWeek: 4 / 52 },
  h1: { label: 'halbjährlich', perWeek: 2 / 52 },
  j1: { label: 'jährlich', perWeek: 1 / 52 },
  bedarf: { label: 'nach Bedarf', perWeek: 0 },
  witter: { label: 'witterungsabhängig', perWeek: 0 },
}

export const ACCESS_TYPES = ['Schlüssel', 'Generalschlüssel', 'Transponder', 'Chip', 'Zahlencode', 'Schlüsseltresor', 'Sonstiges']
export const OWNERS = { eigen: 'eigen', Kunde: 'Kunde', gemietet: 'gemietet' }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Minuten pro Woche einer Leistung, eines Bereichs, einer Mappe. */
export const serviceMinutes = (s) => num(s.minutes) * (LV_INTERVALS[s.interval]?.perWeek ?? 0)
export const areaMinutes = (a) => (a.services || []).reduce((x, s) => x + serviceMinutes(s), 0)
export const lvMinutes = (m) => (m?.areas || []).reduce((x, a) => x + areaMinutes(a), 0)

/** Raumbuch: Fläche der Räume; die Bereichsfläche gilt, sonst die Summe der Räume. */
export const roomsSize = (a) => (a.rooms || []).reduce((x, r) => x + num(r.size), 0)
export const areaSize = (a) => num(a.size) || roomsSize(a)

// ---------------------------------------------------------------- Einsatztage und Vorlagen

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/** Gilt eine Leistung am Tag `today` (Gültig ab / Gültig bis der Wiederholung)? */
export const taskValidOn = (t, today) => !today || ((!t.recurrence?.from || t.recurrence.from <= today) && (!t.recurrence?.until || t.recurrence.until >= today))

/** Einsatztage 1–7 (Mo = 1): laut Mappe (Vertrag), sonst aus dem wöchentlichen Stammplan (nur gültige Leistungen). */
export function serviceWeekdays(m, tasks = [], objectId = null, today = todayISO()) {
  const own = (m?.serviceDays || []).map((d) => (typeof d === 'number' ? d : WEEKDAYS.indexOf(String(d).slice(0, 2)) + 1)).filter((d) => d >= 1 && d <= 7)
  if (own.length) return [...new Set(own)].sort()
  const days = new Set()
  for (const t of tasks) {
    const r = t.recurrence || {}
    if (t.objectId === objectId && t.category !== 'sonder' && r.type === 'weekly' && (r.everyWeeks || 1) === 1 && taskValidOn(t, today)) for (const d of r.weekdays || []) days.add(d)
  }
  return [...days].sort()
}

const BY_DAYS = { 7: 't7', 6: 't6', 5: 't5', 4: 'w4', 3: 'w3', 2: 'w2', 1: 'w1' }

/** Häufigkeit an die Einsatztage anpassen: „täglich Mo–Fr“ bei 3 Einsatztagen wird „3× Woche“. */
export function fitInterval(code, days) {
  const per = LV_INTERVALS[code]?.perWeek ?? 0
  return days && per > days ? BY_DAYS[days] || code : code
}

/** Bereich aus einer Vorlage; fitted = Leistungen, deren Häufigkeit angepasst wurde. */
export function areaFromTemplate(tpl, days = 0) {
  const services = (tpl.services || []).map((s) => ({ what: s.what, interval: fitInterval(s.interval, days), minutes: s.minutes ?? '', method: s.method || '', ...(s.note ? { note: s.note } : {}) }))
  return { area: { name: tpl.name, location: '', size: '', floor: tpl.floor || '', services, rooms: [] }, fitted: services.filter((s, i) => s.interval !== tpl.services[i].interval).length }
}

/** Bereich als Vorlage (ohne Lage, Fläche und Räume). */
export const templateFromArea = (a, id) => ({ id, name: a.name, floor: a.floor || '', note: '', services: (a.services || []).filter((s) => s.what).map(({ what, interval, minutes, method }) => ({ what, interval, minutes, method })) })

// ---------------------------------------------------------------- Fassungen

const HISTORY_MAX = 50
const NOT_CONTENT = ['history', 'sent', 'version', 'reason', 'checkedAt', 'checkedBy', 'photos', 'legacyId', 'source']
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Inhalt einer Fassung: ohne Verlauf, Versand, Zeitstempel und Fotos (Fotos gehören zum Objekt, nicht zur Fassung). */
export function snapshot(m = {}) {
  const out = {}
  for (const [k, v] of Object.entries(m)) if (!NOT_CONTENT.includes(k) && v !== undefined) out[k] = structuredClone(v)
  return out
}

const isEmpty = (snap) => Object.values(snap).every((v) => v === '' || v === null || v === false || (Array.isArray(v) && !v.length))

/**
 * Speichern als neue Fassung. Die bisherige wandert in den Verlauf, aber nur
 * mit den Teilen, die sich geändert haben (keys); so bleibt die Datei klein,
 * auch mit 50 Fassungen je Objekt. Übernommene Fassungen aus dem Objektdoku
 * sind vollständig (ohne keys).
 */
export function saveVersion(prev = {}, next, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  const before = snapshot(prev)
  const after = snapshot(next)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !same(before[k], after[k]))
  const out = { ...next, checkedAt: at, ...(by ? { checkedBy: by } : {}) }
  if (!keys.length) return { ...out, version: prev.version || next.version || 1, history: prev.history || [] }
  const history = [...(prev.history || [])]
  // eine leere Fassung mitten im Verlauf gehört dazu, sonst fehlt beim Zurückrechnen ein Schritt
  if (!isEmpty(before) || history.length) history.unshift({ version: prev.version || 1, at: prev.checkedAt || '', by: prev.checkedBy || '', reason: prev.reason || '', keys, data: Object.fromEntries(keys.filter((k) => k in before).map((k) => [k, before[k]])) })
  return { ...out, version: (prev.version || (isEmpty(before) ? 0 : 1)) + 1, reason, history: history.slice(0, HISTORY_MAX) }
}

/** Alle Fassungen, neueste zuerst: [{ version, at, by, reason, data, current? }] mit vollem Inhalt. */
export function versions(m = {}) {
  let state = snapshot(m)
  const out = [{ version: m.version || 1, at: m.checkedAt || '', by: m.checkedBy || '', reason: m.reason || '', data: state, current: true }]
  for (const e of m.history || []) {
    if (e.keys) {
      state = structuredClone(state)
      for (const k of e.keys) {
        if (k in (e.data || {})) state[k] = structuredClone(e.data[k])
        else delete state[k]
      }
    } else state = snapshot(e.data || {})
    out.push({ version: e.version, at: e.at, by: e.by, reason: e.reason, data: state })
  }
  return out
}

/** Frühere Fassung als Entwurf: Inhalt von damals, Fotos, Verlauf und Versand von heute. */
export function restoreVersion(current, data) {
  const keep = Object.fromEntries(NOT_CONTENT.filter((k) => k in current).map((k) => [k, current[k]]))
  return { ...structuredClone(data), ...structuredClone(keep) }
}

const FIELDS = { customer: 'Kunde', customerNo: 'Kunden-Nr.', objectNo: 'Objekt-Nr.', kind: 'Objektart', street: 'Straße', contract: 'Vertrag', validFrom: 'Gültig ab', hvEmail: 'E-Mail Hausverwaltung', customerEmail: 'E-Mail Kunde', notes: 'Hinweise', timeNote: 'Hinweis zu den Zeiten', manager: 'Objektleitung', deputy: 'Vertretung' }
const LISTS = { contacts: ['Ansprechpartner', (x) => x.name], access: ['Zugang', (x) => x.label], devices: ['Geräte', (x) => x.label], attachments: ['Dokumente', (x) => x.name], timeWindows: ['Zeitfenster', (x) => `${x.days} ${x.from}–${x.to}`.trim()] }
const short = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? `„${s.length > 40 ? `${s.slice(0, 38)}…` : s}“` : 'leer'
}
const fmtH = (min) => (Math.round((min / 60) * 100) / 100).toLocaleString('de-AT')

function listDiff(a = [], b = [], keyOf) {
  const key = (x, i) => String(keyOf(x) || `#${i}`)
  const ma = new Map(a.map((x, i) => [key(x, i), x]))
  const mb = new Map(b.map((x, i) => [key(x, i), x]))
  return {
    added: [...mb.keys()].filter((k) => !ma.has(k)),
    removed: [...ma.keys()].filter((k) => !mb.has(k)),
    changed: [...mb.keys()].filter((k) => ma.has(k) && !same(ma.get(k), mb.get(k))),
    ma,
    mb,
  }
}

const listText = (d) => [d.added.length ? `neu ${d.added.join(', ')}` : '', d.removed.length ? `entfernt ${d.removed.join(', ')}` : '', d.changed.length ? `geändert ${d.changed.join(', ')}` : ''].filter(Boolean).join('; ')

/** Unterschiede zwischen zwei Fassungen, in Worten: ['Kunde: „A“ → „B“', 'Stiegenhaus: Böden … wöchentlich → 2× Woche', …] */
export function diffMappe(a = {}, b = {}) {
  const out = []
  const ha = lvMinutes(a)
  const hb = lvMinutes(b)
  if (Math.round(ha) !== Math.round(hb)) out.push(`Stunden/Woche: ${fmtH(ha)} → ${fmtH(hb)}`)
  for (const [k, label] of Object.entries(FIELDS)) if (!same(a[k] || '', b[k] || '')) out.push(`${label}: ${short(a[k])} → ${short(b[k])}`)
  if (!same(a.serviceDays || [], b.serviceDays || [])) out.push(`Einsatztage: ${(a.serviceDays || []).join(', ') || 'keine'} → ${(b.serviceDays || []).join(', ') || 'keine'}`)
  for (const [k, [label, keyOf]] of Object.entries(LISTS)) {
    const d = listDiff(a[k], b[k], keyOf)
    const text = listText(d)
    if (text) out.push(`${label}: ${text}`)
  }
  const areas = listDiff(a.areas, b.areas, (x) => x.name)
  if (areas.added.length) out.push(`Bereich neu: ${areas.added.join(', ')}`)
  if (areas.removed.length) out.push(`Bereich entfernt: ${areas.removed.join(', ')}`)
  for (const name of areas.changed) {
    const x = areas.ma.get(name)
    const y = areas.mb.get(name)
    const parts = []
    for (const [f, label] of [['location', 'Lage'], ['size', 'Fläche'], ['floor', 'Boden']]) if (!same(x[f] || '', y[f] || '')) parts.push(`${label} ${short(x[f])} → ${short(y[f])}`)
    const s = listDiff(x.services, y.services, (v) => v.what)
    if (s.added.length) parts.push(`neu ${s.added.join(', ')}`)
    if (s.removed.length) parts.push(`entfernt ${s.removed.join(', ')}`)
    for (const what of s.changed) {
      const p = s.ma.get(what)
      const q = s.mb.get(what)
      const ch = [p.interval !== q.interval ? `${LV_INTERVALS[p.interval]?.label || p.interval} → ${LV_INTERVALS[q.interval]?.label || q.interval}` : '', !same(p.minutes, q.minutes) ? `${p.minutes || 0} → ${q.minutes || 0} min` : '', !same(p.method || '', q.method || '') ? `Methode ${short(p.method)} → ${short(q.method)}` : ''].filter(Boolean)
      parts.push(`${what} ${ch.join(', ') || 'geändert'}`)
    }
    if (!same(x.rooms || [], y.rooms || [])) {
      const n = (y.rooms || []).length
      parts.push(`Raumbuch ${(x.rooms || []).length} → ${n} ${n === 1 ? 'Raum' : 'Räume'}`)
    }
    if (parts.length) out.push(`${name}: ${parts.join('; ')}`)
  }
  return out
}

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}

/**
 * Geplante Minuten pro Woche laut Dienstplan (Stammplan, ohne Sonderleistungen
 * und Einmaliges, nur Leistungen, die am Tag `today` gelten).
 */
export function plannedMinutes(tasks, objectId, today = todayISO()) {
  let sum = 0
  for (const t of tasks) {
    if (t.objectId !== objectId || t.category === 'sonder' || !taskValidOn(t, today)) continue
    let dur = toMin(t.end) - toMin(t.start)
    // über Mitternacht (22:00–00:30); Beginn = Ende ist kein 24-h-Einsatz, sondern leer
    if (dur < 0) dur += 1440
    const r = t.recurrence || {}
    const perWeek = r.type === 'weekly' ? (r.weekdays || []).length / (r.everyWeeks || 1) : r.type === 'monthly' ? 12 / 52 / (r.everyMonths || 1) : 0
    sum += dur * (t.staff || 1) * perWeek
  }
  return Math.round(sum)
}

/** Vergleich Leistungsverzeichnis ↔ Dienstplan: Abweichung in Minuten und Prozent. */
export function compareHours(mappe, tasks, objectId, today = todayISO()) {
  const lv = Math.round(lvMinutes(mappe))
  const plan = plannedMinutes(tasks, objectId, today)
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
  { id: 'raeume', label: 'Raumbuch' },
  { id: 'fotos', label: 'Ablauf-Fotos' },
  { id: 'stunden', label: 'Richtzeiten und Stunden', confidential: true },
  { id: 'geraete', label: 'Geräte' },
  { id: 'muell', label: 'Müllplan' },
  { id: 'zaehler', label: 'Zählerstellen' },
  { id: 'kontrolle', label: 'Letzte Kontrolle und offene Mängel', confidential: true },
  { id: 'anhaenge', label: 'Anhangsverzeichnis' },
  { id: 'unterschrift', label: 'Unterschriftsfeld' },
]

export const PRESETS = {
  mitarbeiter: { label: 'Mitarbeiter (Objektblatt fürs Personal)', sections: ['objekt', 'kontakte', 'zeiten', 'zugang', 'hinweise', 'leistungen', 'fotos', 'geraete', 'muell', 'zaehler'] },
  kunde: { label: 'Kunde (Leistungsverzeichnis, nichts Vertrauliches)', sections: ['objekt', 'zeiten', 'hinweise', 'leistungen', 'raeume', 'anhaenge', 'unterschrift'], customer: true },
  akte: { label: 'Akte (Büro, alles)', sections: SECTIONS.map((s) => s.id) },
}

/** Gewählte Abschnitte; in der Kundenfassung werden vertrauliche nie ausgegeben. */
export function sheetSections(preset, chosen) {
  const p = PRESETS[preset] || PRESETS.mitarbeiter
  const list = chosen?.length ? chosen : p.sections
  return SECTIONS.filter((s) => list.includes(s.id) && !(p.customer && s.confidential)).map((s) => s.id)
}

// ---------------------------------------------------------------- Kundenstamm

// ß → ss vor dem Entfernen der Sonderzeichen, sonst wird „Straße“ zu „strae“
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
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
