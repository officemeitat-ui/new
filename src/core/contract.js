// Vertrag einer Person über die Zeit: Wochenstunden mit Gültigkeit und
// Eintritt/Austritt. Vergangene Wochen rechnen mit den damaligen Stunden
// (eine Erhöhung schreibt alte Mehrarbeit nicht um), vor dem Eintritt und nach
// dem Austritt gibt es kein Soll und keine Einteilung.
//
//   emp.hoursHistory  [{ from: 'JJJJ-MM-TT', weeklyHours }]  ab diesem Tag gültig
//   emp.entryDate     'JJJJ-MM-TT' (optional)
//   emp.exitDate      'JJJJ-MM-TT' (optional, letzter Arbeitstag)

import { addDays, eachDay, isoWeekday } from './dates.js'

/** Gesetzliche Normalarbeitszeit je Woche (§ 3 AZG); mehr kann kein Vertrags-Soll sein. */
export const MAX_WEEKLY_HOURS = 40

/** Wochenstunden laut Vertrag an einem Tag (ohne Verlauf: die aktuellen), höchstens 40. */
export function weeklyHoursAt(emp, date) {
  let hours = emp.weeklyHours || 0
  const history = [...(emp.hoursHistory || [])].sort((a, b) => a.from.localeCompare(b.from))
  for (const h of history) if (h.from <= date) hours = h.weeklyHours
  return Math.min(Number(hours) || 0, MAX_WEEKLY_HOURS)
}

/** An diesem Tag beschäftigt (zwischen Eintritt und Austritt)? */
export const employedOn = (emp, date) => (!emp.entryDate || date >= emp.entryDate) && (!emp.exitDate || date <= emp.exitDate)

/** In dieser Woche (Mo–So) mindestens einen Tag beschäftigt? */
export const employedInWeek = (emp, monday) => (!emp.entryDate || emp.entryDate <= addDays(monday, 6)) && (!emp.exitDate || emp.exitDate >= monday)

/**
 * Soll in Minuten für einen Zeitraum: je Werktag Mo–Fr ein Fünftel der an
 * diesem Tag gültigen Wochenstunden, nur an Tagen der Beschäftigung
 * (Feiertage zählen, sie werden angerechnet). Volle Woche = Wochenstunden.
 */
export function sollMinutes(emp, from, to) {
  let total = 0
  for (const d of eachDay(from, to)) if (isoWeekday(d) <= 5 && employedOn(emp, d)) total += (weeklyHoursAt(emp, d) * 60) / 5
  return Math.round(total)
}

/**
 * Wochenstunden ändern: alte Stunden bleiben bis zum Vortag gültig, die neuen
 * ab `from`. Spätere Einträge ab demselben Tag werden ersetzt.
 */
export function changeWeeklyHours(emp, weeklyHours, from) {
  const history = emp.hoursHistory?.length ? emp.hoursHistory.filter((h) => h.from < from) : [{ from: '0000-01-01', weeklyHours: emp.weeklyHours || 0 }]
  return { ...emp, weeklyHours, hoursHistory: [...history, { from, weeklyHours }] }
}
