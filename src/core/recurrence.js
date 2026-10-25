// Wiederkehrende Termine: wöchentlich, alle n Wochen, monatlich, einmalig.
// Genutzt für Leistungen (Stammplan) und Abfuhrtage (Müllplan).

import { addDays, daysInMonth, isoWeekday, monthsBetween, weeksBetween } from './dates.js'

export const NTH_LABEL = { 1: '1.', 2: '2.', 3: '3.', 4: '4.', [-1]: 'letzter' }

/**
 * Rhythmus einer Leistung:
 *   { type: 'weekly', weekdays, everyWeeks, anchor }        jede / jede 2. … Woche
 *   { type: 'monthly', mode: 'nth', nth, weekday, everyMonths, anchor }   z. B. 1. Samstag, quartalsweise
 *   { type: 'monthly', mode: 'day', day, everyMonths, anchor }            z. B. am 15. (31 = letzter Tag)
 *   { type: 'once', date }
 */
export function taskOccursOn(task, date) {
  const r = task.recurrence
  if (r.type === 'once') return r.date === date
  if (r.type === 'monthly') return monthlyOccursOn(r, date)
  if (!r.weekdays.includes(isoWeekday(date))) return false
  if (r.from && date < r.from) return false
  if (r.until && date > r.until) return false
  const every = r.everyWeeks || 1
  if (every > 1) {
    const diff = weeksBetween(r.anchor || r.from || date, date)
    return ((diff % every) + every) % every === 0
  }
  return true
}

function monthlyOccursOn(r, date) {
  if (r.from && date < r.from) return false
  if (r.until && date > r.until) return false
  const every = r.everyMonths || 1
  if (every > 1) {
    const diff = monthsBetween(r.anchor || r.from || date, date)
    if (((diff % every) + every) % every !== 0) return false
  }
  const day = Number(date.slice(8))
  if (r.mode === 'day') return day === Math.min(r.day || 1, daysInMonth(date))
  if (isoWeekday(date) !== r.weekday) return false
  if (r.nth === -1) return day + 7 > daysInMonth(date)
  return Math.ceil(day / 7) === r.nth
}

export function nextWorkday(date, holidays) {
  let d = addDays(date, 1)
  while (isoWeekday(d) > 5 || holidays.has(d)) d = addDays(d, 1)
  return d
}
