// Gesetzliche Feiertage in Österreich (§ 7 Abs 2 ARG). Seit 2019 ist der
// Karfreitag kein Feiertag mehr (stattdessen "persönlicher Feiertag" aus dem
// Urlaubskontingent). Landespatrone (z. B. Hl. Rupert, 24.9. in Salzburg) sind
// keine gesetzlichen Feiertage und können als betriebsfreie Tage ergänzt werden.

import { addDays, eachDay } from './dates.js'

const pad = (n) => String(n).padStart(2, '0')

/** Ostersonntag nach dem gregorianischen Algorithmus (Meeus/Jones/Butcher). */
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${pad(month)}-${pad(day)}`
}

export function austrianHolidays(year) {
  const easter = easterSunday(year)
  return [
    [`${year}-01-01`, 'Neujahr'],
    [`${year}-01-06`, 'Heilige Drei Könige'],
    [addDays(easter, 1), 'Ostermontag'],
    [`${year}-05-01`, 'Staatsfeiertag'],
    [addDays(easter, 39), 'Christi Himmelfahrt'],
    [addDays(easter, 50), 'Pfingstmontag'],
    [addDays(easter, 60), 'Fronleichnam'],
    [`${year}-08-15`, 'Mariä Himmelfahrt'],
    [`${year}-10-26`, 'Nationalfeiertag'],
    [`${year}-11-01`, 'Allerheiligen'],
    [`${year}-12-08`, 'Mariä Empfängnis'],
    [`${year}-12-25`, 'Christtag'],
    [`${year}-12-26`, 'Stefanitag'],
  ]
    .map(([date, name]) => ({ date, name, legal: true }))
    .sort((x, y) => x.date.localeCompare(y.date))
}

/**
 * Map Datum → { name, legal } für einen Zeitraum. `extraFreeDays` sind
 * betriebsfreie Tage ({ date, name }), die wie Feiertage Einsätze entfallen
 * lassen, aber keine Feiertagszuschläge auslösen.
 */
export function holidayCalendar(from, to, extraFreeDays = []) {
  const map = new Map()
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of austrianHolidays(y)) if (h.date >= from && h.date <= to) map.set(h.date, h)
  }
  for (const d of extraFreeDays) {
    if (d.date >= from && d.date <= to && !map.has(d.date)) map.set(d.date, { date: d.date, name: d.name, legal: false })
  }
  return map
}

export function holidaysInRange(from, to, extraFreeDays = []) {
  const cal = holidayCalendar(from, to, extraFreeDays)
  return eachDay(from, to).filter((d) => cal.has(d)).map((d) => cal.get(d))
}
