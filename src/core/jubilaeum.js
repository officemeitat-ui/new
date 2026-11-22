// Dienstjubiläen aus dem Eintrittsdatum im Stammblatt: runde Dienstjahre, die bald erreicht werden – zum Gratulieren
// und, ab 25 Dienstjahren, zum Prüfen des Urlaubsanspruchs (Urlaubsgesetz § 2 Abs. 1: sechs statt fünf Wochen nach
// Vollendung des 25. Dienstjahres; angerechnete Vordienstzeiten nach § 3 zählen mit, stehen aber nicht in der App –
// darum nur ein Hinweis, die App ändert keinen Anspruch). Geburtstage gibt es bewusst nicht: Das Stammblatt hat kein
// Geburtsdatum. Rein rechnend (test/jubilaeum.test.js).

import { addDays, dayIndex } from './dates.js'

export const JUBILEE_YEARS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
export const SIXTH_WEEK_FROM = 25
const ISO = /^\d{4}-\d{2}-\d{2}$/
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Jahrestag des Eintritts im Jahr `year`; Eintritt am 29.2. zählt in Jahren ohne Schalttag am 28.2. */
export function anniversary(entryDate, year) {
  const [, m, d] = entryDate.split('-')
  return `${String(year).padStart(4, '0')}-${m}-${m === '02' && d === '29' && !leap(year) ? '28' : d}`
}

/** Volle Dienstjahre am Stichtag (0 vor dem ersten Jahrestag, null ohne gültigen Eintritt oder vor dem Eintritt). */
export function serviceYears(entryDate, date) {
  if (!ISO.test(entryDate || '') || !ISO.test(date || '') || date < entryDate) return null
  const y = Number(date.slice(0, 4))
  const n = y - Number(entryDate.slice(0, 4))
  return date >= anniversary(entryDate, y) ? n : n - 1
}

/**
 * Jubiläen im Fenster [today − back, today + lead], nach Datum sortiert:
 * [{ emp, years, date, days (bis dahin; negativ = war schon), sixthWeek (ab 25 Jahren) }].
 * Ohne Personen ohne Eintrittsdatum und ohne solche, die am Jahrestag schon ausgetreten sind.
 */
export function jubilees(employees = [], today, { lead = 14, back = 2, years = JUBILEE_YEARS } = {}) {
  if (!ISO.test(today || '')) return []
  const from = addDays(today, -back)
  const to = addDays(today, lead)
  const out = []
  for (const emp of employees || []) {
    if (!emp || !ISO.test(emp.entryDate || '')) continue
    for (const y of new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])) {
      const n = y - Number(emp.entryDate.slice(0, 4))
      if (!years.includes(n)) continue
      const date = anniversary(emp.entryDate, y)
      if (date < from || date > to) continue
      if (emp.exitDate && emp.exitDate < date) continue
      out.push({ emp, years: n, date, days: dayIndex(date) - dayIndex(today), sixthWeek: n >= SIXTH_WEEK_FROM })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.emp.name || '').localeCompare(String(b.emp.name || ''), 'de'))
}

/** „in 5 Tagen“, „morgen“, „heute“, „gestern“, „vor 2 Tagen“. */
export function daysText(days) {
  if (days === 0) return 'heute'
  if (days === 1) return 'morgen'
  if (days === -1) return 'gestern'
  return days > 0 ? `in ${days} Tagen` : `vor ${-days} Tagen`
}
