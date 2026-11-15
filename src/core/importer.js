// Import aus Excel: Zeilen in Excel markieren, kopieren und einfügen
// (Tabulator-getrennt) oder CSV mit Semikolon. Spalten werden über die
// Überschriften erkannt, die Reihenfolge ist egal.

import { WEEKDAY_SHORT } from './dates.js'
import { DEFAULT_HOLIDAY_RULE } from './plan.js'
import { langInfo, LANGUAGES } from './sprachen.js'

export const EMPLOYEE_TEMPLATE = ['Name', 'Personalnummer', 'Beschäftigung', 'Wochenstunden', 'E-Mail', 'Team', 'Qualifikationen', 'Tage', 'Von', 'Bis', 'Sprache', 'Handy', 'Resturlaub', 'Zeitkonto']
export const TASK_TEMPLATE = ['Objekt', 'Adresse', 'Revier', 'Leistung', 'Tage', 'Von', 'Bis', 'Personen', 'Stammkraft', 'Intervall', 'An Feiertagen', 'Art', 'Fahrzeit danach', 'Fahrtnotiz', 'Pause']

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

const ALIASES = {
  name: ['name', 'mitarbeiter', 'mitarbeiterin', 'mitarbeiterinnen'],
  personnelNo: ['personalnummer', 'persnr', 'pnr', 'nr'],
  type: ['beschaftigung', 'beschaeftigung', 'art', 'anstellung'],
  weeklyHours: ['wochenstunden', 'stunden', 'soll', 'stdwoche'],
  email: ['email', 'mail'],
  phone: ['handy', 'mobil', 'telefon', 'tel', 'handynummer', 'mobilnummer', 'telefonnummer', 'whatsapp'],
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
  pause: ['pause', 'pausemin', 'pauseminuten', 'pausen'],
  vacationRest: ['resturlaub', 'urlaubrest', 'resturlaubstage', 'urlaubsrest'],
  startBalance: ['zeitkonto', 'startsaldo', 'zeitkontostartsaldo', 'zeitguthaben', 'gutstunden'],
  lang: ['sprache', 'sprachehandy', 'sprachamhandy', 'muttersprache', 'language'],
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
      // auch über das Wochenende: „Fr-Mo“ = Fr, Sa, So, Mo
      if (a && b) for (let i = 0, d = a; i < 7; i++, d = (d % 7) + 1) {
        out.add(d)
        if (d === b) break
      }
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
  if (t.includes('min') && !t.includes('h')) return Math.round(n) // „3 min“: ausdrücklich Minuten
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
  if (t.includes('quartal') || t.includes('viertelj')) return 3 // vor „jahr“: vierteljährlich ist nicht jährlich
  if (t.includes('halbjahr') || t.includes('halbjaehr') || t.includes('halbjahrl')) return 6
  if (t.includes('jahr') || t.includes('jaehr') || t.includes('jahrl')) return 12
  const m = t.match(/alle(\d+)monat/)
  if (m) return Number(m[1])
  if (t.includes('zweimonat')) return 2
  if (t.includes('monat') && !/4|vierwoch/.test(t)) return 1
  return null
}

// Sprache am Handy (employees[].lang, Kennungen aus core/sprachen.js): Bezeichnung auf Deutsch, Name in der Sprache selbst,
// Kennung oder übliche Kürzel. „BKS/Bosnisch/Kroatisch/Serbisch“ zählt einmal (alle Teile meinen dieselbe Sprache).
const LANG_WORDS = {
  de: ['deutsch', 'de', 'deu', 'ger', 'german', 'osterreichisch', 'oesterreichisch'],
  bks: ['bks', 'bosnisch', 'kroatisch', 'serbisch', 'serbokroatisch', 'bosanski', 'hrvatski', 'srpski', 'bs', 'hr', 'sr', 'hbs', 'bos', 'hrv', 'srp', 'bosnian', 'croatian', 'serbian', 'jugoslawisch'],
  ro: ['rumanisch', 'rumaenisch', 'romana', 'romaneste', 'ro', 'ron', 'rum', 'romanian', 'moldawisch'],
  tr: ['turkisch', 'tuerkisch', 'turkce', 'tr', 'tur', 'turkish'],
  hu: ['ungarisch', 'magyar', 'hu', 'hun', 'ung', 'hungarian'],
  en: ['englisch', 'english', 'en', 'eng'],
}
const LANG_BY_WORD = new Map(Object.entries(LANG_WORDS).flatMap(([id, words]) => words.map((w) => [w, id])))
for (const l of LANGUAGES) for (const w of [l.label, l.own]) LANG_BY_WORD.set(norm(w), l.id)

/**
 * Sprache aus einer Zelle: Kennung aus core/sprachen.js ('de' für Deutsch), '' (leer) oder null (nicht erkannt).
 * Mehrere Teile („BKS/Bosnisch“, „Türkisch (Türkçe)“) müssen dieselbe Sprache meinen.
 */
export function parseLanguage(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const whole = LANG_BY_WORD.get(norm(text))
  if (whole) return whole
  const parts = text.split(/[\s/,;+()|-]+/).map(norm).filter(Boolean)
  const ids = new Set(parts.map((p) => LANG_BY_WORD.get(p) || '?'))
  return ids.size === 1 && !ids.has('?') ? [...ids][0] : null
}
const LANG_HINT = LANGUAGES.map((l) => l.label).join(', ')

const TYPES = ['Vollzeit', 'Teilzeit', 'Geringfügig', 'Lehrling']
const normalizeType = (v) => TYPES.find((t) => norm(t) === norm(v) || norm(v).startsWith(norm(t).slice(0, 5))) || 'Teilzeit'

const weekdaysOf = (r) => (r.type === 'monthly' ? !!r.weekday : r.weekdays.length > 0)

/**
 * Mitarbeitende aus Tabelle. Liefert { items, errors }. Spalte „Sprache“ (optional): erkannte Sprache als lang
 * ('' = Deutsch); leere Zelle oder unbekannter Wert: kein lang (bestehende Personen behalten ihre Sprache), ein
 * unbekannter Wert steht als Hinweis in errors.
 */
export function importEmployees(text, { today = '' } = {}) {
  const errors = []
  const items = parseTable(text).map((row, i) => {
    const name = pick(row, 'name')
    if (!name) errors.push(`Zeile ${i + 2}: Name fehlt`)
    const rawLang = pick(row, 'lang')
    const lang = parseLanguage(rawLang)
    if (lang === null) errors.push(`Zeile ${i + 2}${name ? ` (${name})` : ''}: Sprache „${String(rawLang).trim()}“ nicht erkannt, bleibt unverändert (möglich: ${LANG_HINT})`)
    const days = parseWeekdays(pick(row, 'days') || 'Mo-Fr')
    const from = toTime(pick(row, 'from')) || '06:00'
    const to = toTime(pick(row, 'to')) || '20:00'
    // Welche Angaben stehen in dieser Zeile wirklich? Beim Aktualisieren einer bestehenden Person zählen nur diese
    // (eine Teilliste, z. B. nur Name und Handy, darf Stunden, E-Mail oder Qualifikationen nicht leeren).
    const has = (k) => String(pick(row, k) ?? '').trim() !== ''
    const given = ['personnelNo', 'type', 'weeklyHours', 'email', 'phone', 'team', 'skills'].filter(has)
    if (has('days') || has('from') || has('to')) given.push('availability')
    if (lang) given.push('lang')
    // Startwerte: Resturlaub (Tage, gilt ab heute als Stichtag) und Zeitkonto (Stunden)
    const start = {}
    const restDays = toNumber(pick(row, 'vacationRest'))
    if (has('vacationRest') && restDays !== null && today) {
      start.vacationBase = { date: today, days: restDays }
      given.push('vacationBase')
    }
    const saldo = toNumber(pick(row, 'startBalance'))
    if (has('startBalance') && saldo !== null) {
      start.startBalanceHours = saldo
      given.push('startBalanceHours')
    }
    return {
      ...start,
      given,
      givenTimes: has('from') || has('to'),
      name,
      personnelNo: pick(row, 'personnelNo') || undefined,
      type: normalizeType(pick(row, 'type')),
      weeklyHours: toNumber(pick(row, 'weeklyHours')) ?? 0,
      email: pick(row, 'email') || undefined,
      phone: pick(row, 'phone') || undefined,
      team: pick(row, 'team') || undefined,
      skills: pick(row, 'skills').split(/[,/]/).map((s) => s.trim()).filter(Boolean),
      availability: Object.fromEntries(days.map((d) => [d, { from, to }])),
      trained: [],
      ...(lang ? { lang: lang === 'de' ? '' : lang } : {}),
    }
  })
  return { items: items.filter((e) => e.name), errors }
}

/** Sprachen der erkannten Personen für die Vorschau: „2 × Türkisch, 1 × Deutsch“ (nur Zeilen mit Sprache). */
export function languageSummary(items = []) {
  const n = new Map()
  for (const e of items) if (e.lang !== undefined) n.set(e.lang || 'de', (n.get(e.lang || 'de') || 0) + 1)
  return LANGUAGES.filter((l) => n.has(l.id)).map((l) => `${n.get(l.id)} × ${langInfo(l.id).label}`).join(', ')
}

const HOLIDAY = { entfallt: 'entfaellt', entfaellt: 'entfaellt', nein: 'entfaellt', geschlossen: 'entfaellt', findetstatt: 'findet_statt', ja: 'findet_statt', arbeiten: 'findet_statt', verschieben: 'verschieben', verschoben: 'verschieben' }

/**
 * Eingefügte Person auf eine bestehende übertragen: nur die Angaben, die in der Zeile standen (item.given). Geänderte
 * Wochenstunden gelten ab `from` (bisherige Wochen behalten ihr Soll). → neue Fassung der Person
 */
export function mergeEmployee(existing, item, { from, changeHours = (e, h) => ({ ...e, weeklyHours: h }) } = {}) {
  let out = { ...existing }
  for (const key of item.given || []) {
    if (key === 'weeklyHours') {
      if ((existing.weeklyHours || 0) !== item.weeklyHours) out = changeHours(out, item.weeklyHours, from)
    } else if (key === 'lang') {
      if (item.lang) out.lang = item.lang
      else delete out.lang // Deutsch = kein Feld
    } else if (key === 'availability') {
      // genannte Tage ersetzen die Verfügbarkeit; fehlen Von/Bis, bleiben die bisherigen Zeiten des Tages
      out.availability = Object.fromEntries(Object.entries(item.availability).map(([d, t]) => [d, existing.availability?.[d] && !item.givenTimes ? existing.availability[d] : t]))
    } else out[key] = item[key]
  }
  return out
}

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
    // Welche Angaben stehen wirklich in der Zeile? Beim Aktualisieren einer vorhandenen Leistung zählen nur diese.
    const has = (k) => String(pick(row, k) ?? '').trim() !== ''
    return {
      given: ['staff', 'regulars', 'holiday', 'category'].filter(has),
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
        holidayRule: HOLIDAY[norm(pick(row, 'holiday'))] || DEFAULT_HOLIDAY_RULE,
        ...(travelMinutes(pick(row, 'travel')) !== null ? { travelAfterMin: travelMinutes(pick(row, 'travel')) } : {}),
        ...(pick(row, 'travelNote') ? { travelNote: pick(row, 'travelNote') } : {}),
        // Pause wie die Fahrzeit: „60“, „60 min“, „1 h“, „0,5“ (Stunden) → Minuten, unbezahlt; ohne Angabe gilt die Regel
        ...(travelMinutes(pick(row, 'pause')) > 0 ? { breakMin: Math.min(240, travelMinutes(pick(row, 'pause'))) } : {}),
      },
    }
  })
  return { items: items.filter((t) => t.object && weekdaysOf(t.task.recurrence) && t.task.start && t.task.end), errors }
}

// ---------------------------------------------------------------- Übernehmen ohne Doppelte

const GENERIC = new Set(['objekt', 'dr', 'fa', 'firma', 'stiegenhaus', 'privathaus', 'buro', 'ordination', 'container', 'tankstelle', 'haus', 'wohnanlage', 'am', 'im', 'zum', 'zur', 'der', 'die', 'das'])

/**
 * Kurzname eines Objekts für den Plan: so viele Wörter vom Namen, bis er aussagt, was es ist, noch frei ist und kein
 * anderes Objekt genauso beginnt („Leikermoser Tankstelle Wals“ und „Leikermoser Tankstelle Anif“ bleiben unterscheidbar).
 * taken: schon vergebene Kurznamen; others: Namen der anderen Objekte (bestehende und mit eingefügte). Höchstens
 * 30 Zeichen; zur Not mit Nummer.
 */
export function uniqueShort(name, taken = [], others = []) {
  const MAX = 30
  const low = (x) => String(x || '').trim().toLowerCase()
  const used = new Set([...taken].map(low).filter(Boolean))
  const clean = (x) => String(x || '').replace(/[,;(/].*$/, '').replace(/\s+-\s*.*$/, '').replace(/\s+/g, ' ').trim()
  const words = clean(name).split(' ').filter(Boolean)
  if (!words.length) return ''
  const full = low(clean(name))
  const rivals = [...others].map((o) => low(clean(o))).filter((o) => o && o !== full)
  const weak = (w) => GENERIC.has(norm(w)) || /^\d+[.)]?$/.test(w) || w.length < 3
  const shared = (p) => rivals.some((o) => o === p || o.startsWith(`${p} `))
  let short = ''
  let free = ''
  for (let n = 1; n <= words.length; n++) {
    const next = words.slice(0, n).join(' ')
    if (next.length > MAX && short) break
    short = next.slice(0, MAX).trim()
    if (words.slice(0, n).every(weak) || used.has(low(short))) continue
    free ||= short // sagt etwas aus und ist frei – aber vielleicht beginnt ein anderes Objekt genauso
    if (!shared(low(short))) return short
  }
  if (!used.has(low(short))) return short // ganzer (gekürzter) Name: so genau wie möglich
  if (free) return free
  for (let i = 2; ; i++) {
    const numbered = `${short.slice(0, MAX - 3).trim()} ${i}`
    if (!used.has(low(numbered))) return numbered
  }
}

/**
 * Eingefügte Leistung auf eine vorhandene übertragen: nur was in der Zeile stand (item.given) – eine Liste ohne
 * Spalte „Stammkraft“ leert die Stammkräfte nicht. Rhythmus, Starttermin und Qualifikationen bleiben immer.
 */
export function mergeTask(existing, item) {
  const given = item.given || []
  const t = item.task
  const out = { ...existing }
  if (given.includes('regulars')) out.regulars = t.regulars
  if (given.includes('staff') || given.includes('regulars')) out.staff = given.includes('staff') ? t.staff : Math.max(existing.staff || 1, t.regulars.length)
  if (given.includes('holiday')) out.holidayRule = t.holidayRule
  if (given.includes('category')) out.category = t.category
  for (const k of ['travelAfterMin', 'travelNote', 'breakMin']) if (t[k] !== undefined) out[k] = t[k]
  return out
}

/** Dieselbe Leistung? Gleiches Objekt, gleiche Bezeichnung, gleiche Zeit und gleicher Rhythmus (ohne Starttermin). */
export function sameTask(a, b) {
  const rhythm = (r = {}) => (r.type === 'monthly' ? `m${r.everyMonths || 1}:${r.mode || ''}:${r.nth || ''}:${r.weekday || ''}:${r.day || ''}` : `w${r.everyWeeks || 1}:${[...(r.weekdays || [])].sort().join('')}`)
  return a.objectId === b.objectId && norm(a.label) === norm(b.label) && a.start === b.start && a.end === b.end && (a.recurrence?.type || 'weekly') === (b.recurrence?.type || 'weekly') && rhythm(a.recurrence) === rhythm(b.recurrence)
}
