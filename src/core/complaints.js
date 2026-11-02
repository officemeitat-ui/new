// Reklamationen je Objekt: erfassen, wer laut Plan dort war, Maßnahme mit Frist, erledigen mit
// Ergebnis (Rückmeldung an den Kunden). Datei reklamationen/reklamationen.json:
//   { items: [{ id, objectId, date, received, source, kind, text, contact, employees: [empId],
//               measure, due, status, doneAt, result, informed, by, history: [{ at, by, text }] }] }

import { addDays } from './dates.js'

export const SOURCES = ['Kunde (Telefon)', 'Kunde (E-Mail)', 'Kunde (vor Ort)', 'Objektkontrolle', 'Intern']
export const KINDS = ['Reinigung mangelhaft', 'Leistung nicht erbracht', 'Nicht erschienen / zu spät', 'Schaden', 'Schlüssel / Sicherheit', 'Verhalten', 'Sonstiges']
export const STATUS = { offen: 'offen', arbeit: 'in Arbeit', erledigt: 'erledigt' }

/** Frist für die Maßnahme ab Eingang: Mängel an der Reinigung schnell, Schäden etwas länger. */
const DUE_DAYS = { 'Reinigung mangelhaft': 1, 'Leistung nicht erbracht': 1, 'Nicht erschienen / zu spät': 1, 'Schlüssel / Sicherheit': 1, Schaden: 3, Verhalten: 3, Sonstiges: 7 }
export const defaultDue = (kind, received) => addDays(received, DUE_DAYS[kind] ?? 3)

export const isOpen = (c) => c.status !== 'erledigt'
export const isOverdue = (c, today) => isOpen(c) && !!c.due && c.due < today

/**
 * Wer laut Plan am Tag des Mangels (und am Vortag, z. B. Abendreinigung) im Objekt war:
 * [{ empId, date, time, label }] sortiert nach Tag und Beginn.
 */
export function whoWorked({ instances, state, objectId, date }) {
  const days = [addDays(date, -1), date]
  const out = []
  for (const inst of instances) {
    if (inst.objectId !== objectId || inst.status === 'cancelled' || !days.includes(inst.date)) continue
    for (const a of state.assigned(inst.key)) out.push({ empId: a.employeeId, date: inst.date, time: `${inst.startTime}–${inst.endTime}`, label: inst.label || '', start: inst.start })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Liste gefiltert und sortiert: offene (überfällige zuerst, dann nach Frist), dann erledigte (neueste zuerst). */
export function complaintList(items, { status = 'offen', objectId = '', today }) {
  const list = (items || []).filter((c) => (status === 'alle' ? true : status === 'erledigt' ? !isOpen(c) : isOpen(c)) && (!objectId || c.objectId === objectId))
  return list.sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1
    if (isOpen(a)) return Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || (a.due || '9').localeCompare(b.due || '9') || a.received.localeCompare(b.received)
    return (b.doneAt || '').localeCompare(a.doneAt || '')
  })
}

/** Häufungen: Objekte mit mindestens min Reklamationen in den letzten days Tagen. */
export function hotspots(items, { today, days = 90, min = 3 }) {
  const from = addDays(today, -days)
  const count = new Map()
  for (const c of items || []) if (c.received.slice(0, 10) >= from) count.set(c.objectId, (count.get(c.objectId) || 0) + 1)
  return [...count].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([objectId, n]) => ({ objectId, n }))
}

/** Tage vom Eingang bis erledigt (für die Auswertung). */
export const daysToDone = (c) => (c.doneAt ? Math.max(0, Math.round((Date.parse(c.doneAt.slice(0, 10)) - Date.parse(c.received.slice(0, 10))) / 86400e3)) : null)

/** Kennzahlen eines Zeitraums (Eingang von–bis). */
export function complaintStats(items, { from, to }) {
  const list = (items || []).filter((c) => c.received.slice(0, 10) >= from && c.received.slice(0, 10) <= to)
  const done = list.filter((c) => !isOpen(c))
  const byKind = {}
  for (const c of list) byKind[c.kind] = (byKind[c.kind] || 0) + 1
  const durations = done.map(daysToDone).filter((d) => d !== null)
  return { total: list.length, open: list.length - done.length, done: done.length, byKind, avgDays: durations.length ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10 : null }
}
