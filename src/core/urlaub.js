// Urlaubsplanung: Sperrzeiten (z. B. Grundreinigung der Schulen im Sommer, Winterdienst-Spitze) und wie viele
// Personen höchstens gleichzeitig abwesend sein sollen. Daraus die Prüfung je Antrag (Plan am Handy → „Zu erledigen“):
// Sperrzeit, wer im Zeitraum schon abwesend ist (ohne Grund – Krankenstand ist ein Gesundheitsdatum), Resturlaub
// davor und danach. Nur Hinweise: Urlaub wird vereinbart (§ 4 UrlG), die App entscheidet nichts.
//
// Einstellungen in rules.vacation: { maxParallel: 0 (= keine Grenze), blackouts: [{ id, from, to, label }] }.
// Rein rechnend (test/urlaub.test.js).

import { eachDay, isoWeekday } from './dates.js'
import { holidayCalendar } from './holidays.js'
import { vacationSummary } from './reports.js'

export const VACATION_DEFAULTS = { maxParallel: 0, blackouts: [] }
export const vacationSettings = (rules) => ({ ...VACATION_DEFAULTS, ...(rules?.vacation || {}) })
const LABEL = 80
const MAX_DAYS = 400

/** Sperrzeit prüfen: { blackout } oder { error }. */
export function makeBlackout({ from, to, label } = {}, { newId = () => `us${Date.now().toString(36)}` } = {}) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))
  if (!ok(from) || !ok(to)) return { error: 'Bitte Beginn und Ende angeben.' }
  if (to < from) return { error: 'Das Ende liegt vor dem Beginn.' }
  if (eachDay(from, to).length > MAX_DAYS) return { error: 'Eine Sperrzeit dauert höchstens ein gutes Jahr.' }
  const text = String(label || '').replace(/\s+/g, ' ').trim().slice(0, LABEL)
  if (!text) return { error: 'Bitte einen Grund angeben, z. B. „Grundreinigung Schulen“.' }
  return { blackout: { id: newId(), from, to, label: text } }
}

/** Sperrzeiten, die den Zeitraum berühren. */
export const blackoutsIn = (blackouts = [], from, to) => (blackouts || []).filter((b) => b?.from && b.to && b.from <= to && b.to >= from)

/**
 * Wer außer employeeId im Zeitraum abwesend ist (alle Arten, aktive Personen): people [{ empId, from, to }] (je
 * Person die Überschneidung), max: höchste Zahl anderer Abwesender an einem Tag, day: der erste Tag mit max.
 */
export function othersAbsent({ absences = [], employeeId, from, to, activeIds = null }) {
  const days = from && to && to >= from ? eachDay(from, to).slice(0, MAX_DAYS) : []
  const own = (absences || []).filter((a) => a && a.employeeId !== employeeId && a.from <= to && a.to >= from && (!activeIds || activeIds.has(a.employeeId)))
  const byEmp = new Map()
  for (const a of own) {
    const s = a.from > from ? a.from : from
    const e = a.to < to ? a.to : to
    const x = byEmp.get(a.employeeId)
    byEmp.set(a.employeeId, x ? { empId: a.employeeId, from: s < x.from ? s : x.from, to: e > x.to ? e : x.to } : { empId: a.employeeId, from: s, to: e })
  }
  let max = 0
  let day = ''
  for (const d of days) {
    const n = new Set(own.filter((a) => a.from <= d && a.to >= d).map((a) => a.employeeId)).size
    if (n > max) {
      max = n
      day = d
    }
  }
  return { people: [...byEmp.values()].sort((a, b) => a.from.localeCompare(b.from)), max, day }
}

/** Urlaubstage eines Zeitraums in einem Jahr (Mo–Fr ohne gesetzliche Feiertage, wie vacationSummary). */
export function vacationDays(from, to, year, extraFreeDays = []) {
  const s = from > `${year}-01-01` ? from : `${year}-01-01`
  const e = to < `${year}-12-31` ? to : `${year}-12-31`
  if (s > e) return 0
  const cal = holidayCalendar(`${year}-01-01`, `${year}-12-31`, extraFreeDays)
  return eachDay(s, e).filter((d) => isoWeekday(d) <= 5 && !cal.get(d)?.legal).length
}

/**
 * Prüfung eines Antrags (art: Urlaub, Zeitausgleich …; von/bis): blackouts, others (othersAbsent), limit und over
 * (mit der Person mehr als erlaubt gleichzeitig weg), rest (nur Urlaub: Resturlaub im Jahr des Beginns vorher und
 * nachher; null ohne Person).
 */
export function requestCheck({ request = {}, absences = [], employees = [], rules = {}, extraFreeDays = [] }) {
  const v = vacationSettings(rules)
  const { von: from, bis: to = from, employeeId } = request
  if (!from || !to) return null
  const activeIds = new Set(employees.filter((e) => !e.inactive).map((e) => e.id))
  const others = othersAbsent({ absences, employeeId, from, to, activeIds })
  const limit = Math.max(0, Math.round(Number(v.maxParallel) || 0))
  const emp = employees.find((e) => e.id === employeeId)
  let rest = null
  if (request.art === 'Urlaub' && emp) {
    const year = Number(from.slice(0, 4))
    const before = vacationSummary(emp, absences, year, extraFreeDays).rest
    const days = vacationDays(from, to, year, extraFreeDays)
    rest = { year, before, days, after: before - days }
  }
  return { blackouts: blackoutsIn(v.blackouts, from, to), others, limit, over: limit > 0 && others.max + 1 > limit, rest }
}

/** Abwesende je Tag (aktive Personen, alle Arten) für den Kalender: Map Datum → Anzahl. */
export function absentPerDay(absences = [], days = [], activeIds = null) {
  const out = new Map()
  for (const d of days) out.set(d, new Set((absences || []).filter((a) => a && a.from <= d && a.to >= d && (!activeIds || activeIds.has(a.employeeId))).map((a) => a.employeeId)).size)
  return out
}

/** Sperrzeiten für das Handy (Plan am Handy): nur kommende, ohne Kennung, höchstens 12. */
export function blackoutsForPortal(blackouts = [], today) {
  return (blackouts || [])
    .filter((b) => b?.to >= today)
    .sort((a, b) => a.from.localeCompare(b.from))
    .slice(0, 12)
    .map((b) => ({ von: b.from, bis: b.to, text: String(b.label || '').slice(0, LABEL) }))
}
