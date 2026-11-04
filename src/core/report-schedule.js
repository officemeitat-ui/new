// Berichte automatisch per E-Mail: wann ein Abo fällig ist (reine Logik, getestet in test/report-schedule.test.js).
// Abo: { id, report, to, rhythm: 'woche' | 'werktag' | 'monat', weekday: 1–7 (Mo–So, bei 'woche'), hour: 0–23,
//        active, since: 'JJJJ-MM-TT' (angelegt), lastSent: 'JJJJ-MM-TT' (Termin, für den zuletzt gesendet wurde) }
// Ein verpasster Termin wird einmal nachgeholt, sobald jemand die App öffnet; ältere verpasste Termine nicht.

import { addDays, isoWeekday } from './dates.js'

export const RHYTHMS = [
  ['woche', 'wöchentlich'],
  ['werktag', 'jeden Werktag (Mo–Fr)'],
  ['monat', 'monatlich am 1.'],
]
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

/** Datum und Stunde in Wien. */
export function viennaNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

/** Letzter planmäßiger Termin (Tag) bis jetzt. */
export function lastSlot(abo, { day, hour }) {
  const h = Number(abo.hour ?? 7)
  if (abo.rhythm === 'monat') {
    const first = `${day.slice(0, 8)}01`
    if (day > first || hour >= h) return first
    const prev = addDays(first, -1)
    return `${prev.slice(0, 8)}01`
  }
  if (abo.rhythm === 'werktag') {
    let d = day
    if (isoWeekday(d) <= 5 && hour >= h) return d
    do d = addDays(d, -1)
    while (isoWeekday(d) > 5)
    return d
  }
  const wd = Math.min(7, Math.max(1, Number(abo.weekday) || 1))
  const back = (isoWeekday(day) - wd + 7) % 7
  return back === 0 && hour < h ? addDays(day, -7) : addDays(day, -back)
}

/** Nächster Termin nach dem letzten (für die Anzeige „nächster Versand“). */
export function nextSlot(abo, now) {
  let d = lastSlot(abo, now)
  for (let i = 0; i < 40; i++) {
    d = addDays(d, 1)
    if (lastSlot(abo, { day: d, hour: 23 }) === d) return d
  }
  return null
}

/** Fällig: aktiv, Termin erreicht, für diesen Termin noch nicht gesendet, nicht vor dem Anlegen. */
export function isDue(abo, now) {
  if (abo.active === false || !String(abo.to || '').trim()) return false
  const slot = lastSlot(abo, now)
  if (abo.since && slot < abo.since) return false
  return !abo.lastSent || abo.lastSent < slot
}

/** Nach einem Fehler nicht im Minutentakt wiederholen: frühestens nach `hours` Stunden. */
export const mayRetry = (abo, now = new Date(), hours = 6) => !abo.lastError || !abo.lastTry || now.getTime() - new Date(abo.lastTry).getTime() >= hours * 3600e3

/** „jeden Montag ab 7 Uhr“, „jeden Werktag ab 6 Uhr“, „am 1. jedes Monats ab 8 Uhr“ */
export function rhythmText(abo) {
  const h = `ab ${Number(abo.hour ?? 7)} Uhr`
  if (abo.rhythm === 'monat') return `am 1. jedes Monats ${h}`
  if (abo.rhythm === 'werktag') return `jeden Werktag ${h}`
  return `jeden ${WEEKDAYS[(Number(abo.weekday) || 1) - 1]} ${h}`
}
