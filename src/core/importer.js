// Import aus Excel: Zeilen in Excel markieren, kopieren und einfügen
// (Tabulator-getrennt) oder CSV mit Semikolon. Spalten werden über die
// Überschriften erkannt, die Reihenfolge ist egal.

import { WEEKDAY_SHORT } from './dates.js'

export const EMPLOYEE_TEMPLATE = ['Name', 'Personalnummer', 'Beschäftigung', 'Wochenstunden', 'E-Mail', 'Team', 'Qualifikationen', 'Tage', 'Von', 'Bis']
export const TASK_TEMPLATE = ['Objekt', 'Adresse', 'Revier', 'Leistung', 'Tage', 'Von', 'Bis', 'Personen', 'Stammkraft', 'Intervall', 'An Feiertagen', 'Art', 'Fahrzeit danach', 'Fahrtnotiz']

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

const ALIASES = {
  name: ['name', 'mitarbeiter', 'mitarbeiterin', 'mitarbeiterinnen'],
  personnelNo: ['personalnummer', 'persnr', 'pnr', 'nr'],
  type: ['beschaftigung', 'beschaeftigung', 'art', 'anstellung'],
  weeklyHours: ['wochenstunden', 'stunden', 'soll', 'stdwoche'],
  email: ['email', 'mail'],
  team: ['team', 'revier', 'gruppe', 'region'],
  skills: ['qualifikationen', 'qualifikation', 'skills'],
  days: ['tage', 'wochentage'],
  from: ['von', 'beginn', 'start'],
  to: ['bis', 'ende'],
  object: ['objekt', 'kunde', 'standort'],
  address: ['adresse', 'anschrift', 'ort'],
  label: ['leistung', 'tatigkeit', 'taetigkeit', 'bezeichnung'],
  staff: ['personen', 'anzahl', 'kopfe'],
  regulars: ['stammkraft', 'stammkrafte', 'stammpersonal'],
  every: ['intervall', 'rhythmus'],
  holiday: ['anfeiertagen', 'feiertag', 'feiertagsregel'],
  category: ['art', 'kategorie'],
  travel: ['fahrzeit', 'fahrzeitdanach', 'fahrzeitmin', 'fahrt'],
  travelNote: ['fahrtnotiz', 'notizfahrt', 'fahrthinweis'],
}

export function parseTable(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim())
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : ';'
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')))
  const header = rows[0]
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function pick(row, field, exclude = []) {
  const keys = Object.keys(row)
  for (const alias of ALIASES[field]) {
    const key = keys.find((k) => norm(k) === alias && !exclude.includes(k))
    if (key !== undefined) return row[key]
  }
  return ''
}

const toNumber = (v) => {
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const toTime = (v) => {
  const m = String(v).trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : null
}

/** "Mo-Fr", "Mo, Mi, Fr", "täglich", "Sa+So" → [1..7] */
export function parseWeekdays(text) {
  const t = String(text).toLowerCase().replace(/\s/g, '')
  if (!t) return []
  if (t.includes('taglich') || t.includes('täglich')) return [1, 2, 3, 4, 5, 6, 7]
  const idx = (s) => WEEKDAY_SHORT.findIndex((w) => s.startsWith(w.toLowerCase())) + 1
  const out = new Set()
  for (const part of t.split(/[,+/;]|und/)) {
    if (!part) continue
    const range = part.split(/[-–]/)
    if (range.length === 2) {
      const a = idx(range[0])
      const b = idx(range[1])
      if (a && b) for (let d = a; d <= b; d++) out.add(d)
    } else {
      const a = idx(part)
      if (a) out.add(a)
    }
  }
  return [...out].sort()
}

/** Fahrzeit: "30", "30 min", "0,5 h", "0,5" (Stunden, wie im bisherigen Plan) → Minuten */
export function travelMinutes(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(',', '.')
  if (!t) return null
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('h') || (n > 0 && n < 5)) return Math.round(n * 60)
  return Math.round(n)
}

/** "1", "wöchentlich", "14-tägig", "alle 2 Wochen", "monatlich" → Wochenintervall */
export function parseInterval(text) {
  const t = norm(text)
  if (!t) return 1
  if (t.includes('14') || t.includes('zweiwoch') || t.includes('alle2')) return 2
  if (t.includes('21') || t.includes('dreiwoch') || t.includes('alle3')) return 3
  if (t.includes('28') || t.includes('monat') || t.includes('vierwoch') || t.includes('alle4')) return 4
  const n = parseInt(t, 10)
  return n >= 1 && n <= 4 ? n : 1
}

/** "monatlich", "quartalsweise", "halbjährlich", "jährlich", "alle 2 Monate" → Monatsintervall, sonst null */
export function parseMonthInterval(text) {
  const t = norm(text)
  if (t.includes('quartal')) return 3
  if (t.includes('halbjahr') || t.includes('halbjaehr') || t.includes('halbjahrl')) return 6
  if (t.includes('jahr') || t.includes('jaehr') || t.includes('jahrl')) return 12
  const m = t.match(/alle(\d+)monat/)
  if (m) return Number(m[1])
  if (t.includes('zweimonat')) return 2
  if (t.includes('monat') && !/4|vierwoch/.test(t)) return 1
  return null
}

const TYPES = ['Vollzeit', 'Teilzeit', 'Geringfügig', 'Lehrling']
const normalizeType = (v) => TYPES.find((t) => norm(t) === norm(v) || norm(v).startsWith(norm(t).slice(0, 5))) || 'Teilzeit'

const weekdaysOf = (r) => (r.type === 'monthly' ? !!r.weekday : r.weekdays.length > 0)

/** Mitarbeitende aus Tabelle. Liefert { items, errors }. */
export function importEmployees(text) {
  const errors = []
  const items = parseTable(text).map((row, i) => {
    const name = pick(row, 'name')
    if (!name) errors.push(`Zeile ${i + 2}: Name fehlt`)
    const days = parseWeekdays(pick(row, 'days') || 'Mo-Fr')
    const from = toTime(pick(row, 'from')) || '06:00'
    const to = toTime(pick(row, 'to')) || '20:00'
    return {
      name,
      personnelNo: pick(row, 'personnelNo') || undefined,
      type: normalizeType(pick(row, 'type')),
      weeklyHours: toNumber(pick(row, 'weeklyHours')) ?? 0,
      email: pick(row, 'email') || undefined,
      team: pick(row, 'team') || undefined,
      skills: pick(row, 'skills').split(/[,/]/).map((s) => s.trim()).filter(Boolean),
      availability: Object.fromEntries(days.map((d) => [d, { from, to }])),
      trained: [],
    }
  })
  return { items: items.filter((e) => e.name), errors }
}

const HOLIDAY = { entfallt: 'entfaellt', entfaellt: 'entfaellt', findetstatt: 'findet_statt', ja: 'findet_statt', verschieben: 'verschieben', verschoben: 'verschieben' }

/**
 * Objekte + Leistungen aus Tabelle. Stammkräfte werden über den Namen zugeordnet.
 * Monatliche Rhythmen ("monatlich", "quartalsweise") werden zum ersten Wochentag
 * aus "Tage" im Monat, ab dem Monat von `anchor`.
 */
export function importTasks(text, employees, { anchor } = {}) {
  const errors = []
  const items = parseTable(text).map((row, i) => {
    const line = i + 2
    const object = pick(row, 'object')
    const weekdays = parseWeekdays(pick(row, 'days'))
    const start = toTime(pick(row, 'from'))
    const end = toTime(pick(row, 'to'))
    if (!object) errors.push(`Zeile ${line}: Objekt fehlt`)
    if (!weekdays.length) errors.push(`Zeile ${line}: Tage nicht erkannt („${pick(row, 'days')}“)`)
    if (!start || !end) errors.push(`Zeile ${line}: Uhrzeit nicht erkannt`)
    const regularNames = pick(row, 'regulars').split(/[,/]/).map((s) => s.trim()).filter(Boolean)
    const regulars = []
    for (const n of regularNames) {
      const emp = employees.find((e) => norm(e.name) === norm(n)) || employees.find((e) => norm(e.name).startsWith(norm(n)))
      if (emp) regulars.push(emp.id)
      else errors.push(`Zeile ${line}: Stammkraft „${n}“ nicht gefunden`)
    }
    const every = parseInterval(pick(row, 'every'))
    const months = parseMonthInterval(pick(row, 'every'))
    const recurrence = months
      ? { type: 'monthly', mode: 'nth', nth: 1, weekday: weekdays[0], everyMonths: months, ...(anchor ? { anchor: `${anchor.slice(0, 7)}-01` } : {}) }
      : { type: 'weekly', weekdays, everyWeeks: every, ...(anchor && every > 1 ? { anchor } : {}) }
    const category = /sonder|blume|garten/i.test(pick(row, 'category') + pick(row, 'label')) ? 'sonder' : 'reinigung'
    return {
      object,
      address: pick(row, 'address'),
      region: pick(row, 'team'),
      task: {
        label: pick(row, 'label') || 'Unterhaltsreinigung',
        category,
        recurrence,
        start,
        end,
        staff: Math.max(1, parseInt(pick(row, 'staff'), 10) || regulars.length || 1),
        regulars,
        skills: [],
        holidayRule: HOLIDAY[norm(pick(row, 'holiday'))] || 'entfaellt',
        ...(travelMinutes(pick(row, 'travel')) !== null ? { travelAfterMin: travelMinutes(pick(row, 'travel')) } : {}),
        ...(pick(row, 'travelNote') ? { travelNote: pick(row, 'travelNote') } : {}),
      },
    }
  })
  return { items: items.filter((t) => t.object && weekdaysOf(t.task.recurrence) && t.task.start && t.task.end), errors }
}
