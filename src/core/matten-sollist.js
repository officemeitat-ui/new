// Mattenwechsel: Soll-Ist der Tour – rein rechnend, ohne Oberfläche (Tests: test/matten-sollist.test.js).
// Geplant ist je Stopp die Abfahrt (times.departure, sonst die Ankunft); tatsächlich der Abschluss des Stopps am
// Handy (finishedAt, Zeit in Wien). Daraus je Stopp die Abweichung in Minuten und für die Tour: wie viele pünktlich
// waren (innerhalb der Toleranz), die mittlere Abweichung und das geplante gegen das tatsächliche Ende.
// Es werden keine Standorte aufgezeichnet: verglichen wird nur, was der Fahrer ohnehin bestätigt.

import { isFinal, localDate, localTime, orderedStops } from './matten-fahrt.js'

export const TOLERANCE_MIN = 15

const toMin = (hhmm) => (/^\d{1,2}:\d{2}$/.test(String(hhmm || '')) ? Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]) : null)

/**
 * Soll-Ist eines Stopps: { planned ('HH:MM'), actual ('HH:MM'), diff (Minuten, + = später), onTime } oder null
 * (nicht abgeschlossen, ohne geplante Zeit oder an einem anderen Tag abgeschlossen als die Tour).
 */
export function stopSollIst(stop, tourDate = '', { tolerance = TOLERANCE_MIN } = {}) {
  if (!stop || !isFinal(stop) || !stop.finishedAt) return null
  const planned = stop.times?.departure || stop.times?.arrival || ''
  const p = toMin(planned)
  const actual = localTime(stop.finishedAt)
  const a = toMin(actual)
  if (p === null || a === null) return null
  if (tourDate && localDate(stop.finishedAt) !== tourDate) return null
  const diff = a - p
  return { planned, actual, diff, onTime: Math.abs(diff) <= tolerance }
}

/** „+12 Min.“, „−5 Min.“, „pünktlich“ (innerhalb der Toleranz steht die Zahl dabei, wenn sie nicht 0 ist). */
export function diffText(diff, { tolerance = TOLERANCE_MIN } = {}) {
  if (!Number.isFinite(diff)) return ''
  const n = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)} Min.`
  return Math.abs(diff) <= tolerance ? (diff ? `pünktlich (${n})` : 'pünktlich') : n
}

/**
 * Soll-Ist der Tour: { stops [{ stopId, name, ...stopSollIst }], measured, onTime, late, early, avg (mittlere
 * Abweichung in Minuten, gerundet), plannedEnd, actualEnd, endDiff } oder null, solange kein Stopp vergleichbar ist.
 * plannedEnd ist die geplante Rückkehr (route.end), actualEnd der Abschluss der Tour (finishedAt) – nur wenn fertig.
 */
export function tourSollIst(tour, opts = {}) {
  const stops = orderedStops(tour)
    .map((s) => ({ stopId: s.id, name: s.customer?.name || s.objectName || 'Stopp', ...(stopSollIst(s, tour?.date, opts) || { diff: null }) }))
    .filter((s) => s.diff !== null)
  if (!stops.length) return null
  const tolerance = opts.tolerance ?? TOLERANCE_MIN
  const late = stops.filter((s) => s.diff > tolerance).length
  const early = stops.filter((s) => s.diff < -tolerance).length
  const out = { stops, measured: stops.length, onTime: stops.length - late - early, late, early, avg: Math.round(stops.reduce((x, s) => x + s.diff, 0) / stops.length) }
  const pe = toMin(tour?.route?.end)
  const ae = tour?.status === 'abgeschlossen' && tour.finishedAt && localDate(tour.finishedAt) === tour.date ? toMin(localTime(tour.finishedAt)) : null
  if (pe !== null && ae !== null) Object.assign(out, { plannedEnd: tour.route.end, actualEnd: localTime(tour.finishedAt), endDiff: ae - pe })
  return out
}

/** Ein Satz für die Tour: „4 von 5 Stopps pünktlich, 1 später · im Schnitt +9 Min.“ ('' ohne Vergleich). */
export function sollIstText(sum) {
  if (!sum) return ''
  const parts = [`${sum.onTime} von ${sum.measured} ${sum.measured === 1 ? 'Stopp' : 'Stopps'} pünktlich`, sum.late ? `${sum.late} später` : '', sum.early ? `${sum.early} früher` : ''].filter(Boolean).join(', ')
  const avg = sum.avg ? `im Schnitt ${sum.avg > 0 ? '+' : '−'}${Math.abs(sum.avg)} Min.` : 'im Schnitt wie geplant'
  const end = sum.plannedEnd ? `Ende ${sum.actualEnd} statt ${sum.plannedEnd} Uhr` : ''
  return [parts, avg, end].filter(Boolean).join(' · ')
}
