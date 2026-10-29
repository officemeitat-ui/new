// Vertrag einer Person über die Zeit: Wochenstunden mit Gültigkeit und
// Eintritt/Austritt. Vergangene Wochen rechnen mit den damaligen Stunden
// (eine Erhöhung schreibt alte Mehrarbeit nicht um), vor dem Eintritt und nach
// dem Austritt gibt es kein Soll und keine Einteilung.
//
//   emp.hoursHistory  [{ from: 'JJJJ-MM-TT', weeklyHours }]  ab diesem Tag gültig
//   emp.entryDate     'JJJJ-MM-TT' (optional)
//   emp.exitDate      'JJJJ-MM-TT' (optional, letzter Arbeitstag)
//   emp.durchrechnung { start: Montag, weeks }  Durchrechnung der Normalarbeitszeit (KV)

import { addDays, dayIndex, eachDay, isoWeekday, mondayOf } from './dates.js'

/** Gesetzliche Normalarbeitszeit je Woche (§ 3 AZG); mehr kann kein Vertrags-Soll sein. */
export const MAX_WEEKLY_HOURS = 40

/** Wochenstunden laut Vertrag an einem Tag (ohne Verlauf: die aktuellen), höchstens 40. */
export function weeklyHoursAt(emp, date) {
  let hours = emp.weeklyHours || 0
  const history = [...(emp.hoursHistory || [])].sort((a, b) => a.from.localeCompare(b.from))
  for (const h of history) if (h.from <= date) hours = h.weeklyHours
  return Math.min(Number(hours) || 0, MAX_WEEKLY_HOURS)
}

/**
 * Durchrechnung der Normalarbeitszeit (KV Denkmal-, Fassaden- und
 * Gebäudereinigung, flexible Arbeitszeit): Vollzeit, per Betriebsvereinbarung
 * oder schriftlicher Vereinbarung; 35 bis 45 Normalstunden pro Woche, im
 * Schnitt des Zeitraums höchstens 40. Zeiträume folgen ab `start` lückenlos
 * aufeinander. Liefert den Zeitraum, in den `date` fällt, oder null.
 */
export const DR_LIMITS = { bandMinH: 35, bandMaxH: 45, maxWeeks: 52, maxWeeksOther: 26, longGroups: ['2'] }
export function drPeriod(emp, date) {
  const d = emp?.durchrechnung
  if (!d?.start || !(d.weeks > 0) || emp.type !== 'Vollzeit') return null
  const first = mondayOf(d.start)
  if (date < first) return null
  const days = Math.round(d.weeks) * 7
  const k = Math.floor((dayIndex(date) - dayIndex(first)) / days)
  const start = addDays(first, k * days)
  return { start, end: addDays(start, days - 1), weeks: Math.round(d.weeks) }
}

/** Längster Zeitraum laut KV für die Lohngruppe: 52 Wochen (Lohngruppe 2), sonst 26. */
export const drMaxWeeks = (emp) => (DR_LIMITS.longGroups.includes(String(emp?.wageGroup)) ? DR_LIMITS.maxWeeks : DR_LIMITS.maxWeeksOther)

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
