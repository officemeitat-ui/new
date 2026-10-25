// Fälligkeiten am Fahrzeug: §57a-Begutachtung („Pickerl“), Service nach
// Datum oder km (was zuerst kommt) und weitere Termine (z. B. Leasingende,
// Tachograph, Verbandskasten). Werkstatttermine erledigen eine oder mehrere
// dieser Aufgaben, auch zusammen mit dem Reifenwechsel.
//
// Daten am Fahrzeug (fahrzeuge/fahrzeuge.json → vehicles[]):
//   cls: 'M1'|'N1'|'N2'|'N3'        Fahrzeugklasse laut Zulassungsschein (Feld J)
//   firstReg: 'JJJJ-MM'              Erstzulassung
//   pickerl: { next: 'JJJJ-MM', lastDate, result }   next = Monat auf der Plakette
//   service: { months, km, lastDate, lastKm, nextDate, nextKm }
//   kmLog:   [{ date, km }]          km-Stände (Termine, Eingaben)
//   dues:    [{ id, label, date, months, note }]     months = wiederholen
//
// Pickerl (§57a KFG, Stand Oktober 2026; maßgeblich ist immer die Plakette):
//   Pkw M1 bis 18.5.2027: 3-2-1 Jahre ab Erstzulassung; begutachten ab dem
//     Monat davor bis Ende des vierten Monats danach.
//   Pkw M1 ab 19.5.2027 (42. KFG-Novelle): 4-2-2-2-1; ab vier Monate vorher bis
//     Ende des Fälligkeitsmonats, keine Nachfrist. Stichtag Feb.–Juli 2027:
//     noch −1/+4 Monate.
//   Lkw N1–N3 (auch Kastenwagen bis 3,5 t): jährlich; ab drei Monate vorher bis
//     Ende des Fälligkeitsmonats.

import { addDays, parseDate, parseMonth } from './dates.js'
import { TASKS } from './vehicles.js'

export const VEHICLE_CLASSES = { M1: 'M1 · Pkw', N1: 'N1 · Lkw bis 3,5 t', N2: 'N2 · Lkw 3,5–12 t', N3: 'N3 · Lkw über 12 t' }
export const PICKERL_RESULTS = { ok: 'ohne Mängel', leicht: 'mit leichten Mängeln', schwer: 'schwere Mängel, keine Plakette' }
export const REFORM_DATE = '2027-05-19'
const LEAD_DAYS = 30
const LEAD_KM = 1500

// ---------------------------------------------------------------- Datum und Monat

export const monthAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const i = y * 12 + (m - 1) + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
const monthEnd = (ym) => addDays(`${monthAdd(ym, 1)}-01`, -1)
export const monthText = (ym) => (ym ? `${ym.slice(5, 7)}/${ym.slice(0, 4)}` : '')

/** Datum plus Monate (31. Jänner + 1 Monat = 28./29. Februar). */
export function addMonths(date, n) {
  const ym = monthAdd(date.slice(0, 7), n)
  const day = Math.min(Number(date.slice(8, 10)), Number(monthEnd(ym).slice(8, 10)))
  return `${ym}-${String(day).padStart(2, '0')}`
}

export { parseDate, parseMonth }

// ---------------------------------------------------------------- Pickerl

/** Fahrzeugklasse: eingetragen, sonst aus der Art geschätzt. */
export const classOf = (v) => v.cls || { pkw: 'M1', transporter: 'N1', lkw: 'N2' }[v.kind] || 'M1'

/** Zeitraum, in dem für einen Fälligkeitsmonat begutachtet werden darf: { from, to, grace } */
export function pickerlWindow(cls, due) {
  if (cls !== 'M1') return { from: `${monthAdd(due, -3)}-01`, to: monthEnd(due), grace: false }
  if (due <= '2027-07') return { from: `${monthAdd(due, -1)}-01`, to: monthEnd(monthAdd(due, 4)), grace: true }
  return { from: `${monthAdd(due, -4)}-01`, to: monthEnd(due), grace: false }
}

const years = (firstReg, list) => list.map((y) => monthAdd(firstReg, 12 * y))
const OLD_YEARS = [3, 5, ...Array.from({ length: 38 }, (_, i) => 6 + i)]
const NEW_YEARS = [4, 6, 8, 10, ...Array.from({ length: 30 }, (_, i) => 11 + i)]
const afterReform = (d) => `${d}-01` >= REFORM_DATE

/** Fälligkeitsmonate ab Erstzulassung, aufsteigend (bis 40 Jahre): Pkw bis zur Novelle 3-2-1, danach 4-2-2-2-1. */
export function pickerlSchedule(cls, firstReg) {
  if (cls !== 'M1') return years(firstReg, Array.from({ length: 40 }, (_, i) => i + 1))
  return [...new Set([...years(firstReg, OLD_YEARS).filter((d) => !afterReform(d)), ...years(firstReg, NEW_YEARS).filter(afterReform)])].sort()
}

/**
 * Vorschlag für den nächsten Fälligkeitsmonat nach einer Begutachtung am
 * Datum `done`: der früheste, der nicht schon von ihr abgedeckt ist. Wurde
 * ein Pkw noch nach altem Recht begutachtet, zählt auch dessen nächster
 * Termin (im Zweifel lieber früher erinnern). Der gestanzte Monat der neuen
 * Plakette ersetzt den Vorschlag.
 */
export function suggestPickerl(v, done) {
  const cls = classOf(v)
  if (v.firstReg) {
    const list = cls === 'M1' && done < REFORM_DATE ? [...pickerlSchedule(cls, v.firstReg), ...years(v.firstReg, OLD_YEARS)] : pickerlSchedule(cls, v.firstReg)
    return list.filter((d) => pickerlWindow(cls, d).from > done).sort()[0] || null
  }
  const base = v.pickerl?.next || done.slice(0, 7)
  let next = monthAdd(base, 12)
  while (pickerlWindow(cls, next).from <= done) next = monthAdd(next, 12)
  return next
}

/** Nächster Fälligkeitsmonat: Plakette, sonst aus Erstzulassung und letzter Begutachtung. */
export function pickerlDue(v, today) {
  if (v.pickerl?.next) return v.pickerl.next
  if (!v.firstReg) return null
  const cls = classOf(v)
  const last = v.pickerl?.lastDate
  if (last) return suggestPickerl(v, last)
  return pickerlSchedule(cls, v.firstReg).find((d) => pickerlWindow(cls, d).to >= today) || null
}

/**
 * Stand der Begutachtung:
 *   status: 'ok' | 'bald' | 'faellig' | 'nachfrist' | 'abgelaufen' | 'unbekannt'
 */
export function pickerlStatus(v, today) {
  const due = pickerlDue(v, today)
  if (!due) return { status: 'unbekannt', due: null }
  const cls = classOf(v)
  const w = pickerlWindow(cls, due)
  const end = monthEnd(due)
  const status = today > w.to ? 'abgelaufen' : today > end ? 'nachfrist' : today >= w.from ? 'faellig' : today >= addDays(w.from, -LEAD_DAYS) ? 'bald' : 'ok'
  return { status, due, cls, ...w, end, guessed: !v.pickerl?.next }
}

// ---------------------------------------------------------------- km und Service

/** Letzter km-Stand { km, date } oder null. */
export function currentKm(v) {
  const log = (v.kmLog || []).filter((x) => Number.isFinite(Number(x.km)) && x.date).sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km)
  return log.length ? { km: Number(log.at(-1).km), date: log.at(-1).date } : null
}

/** Durchschnittliche km pro Tag (aus km-Ständen über mindestens 30 Tage) oder null. */
export function kmPerDay(v) {
  const log = (v.kmLog || []).filter((x) => Number.isFinite(Number(x.km)) && x.date).sort((a, b) => a.date.localeCompare(b.date))
  if (log.length < 2) return null
  const a = log[0]
  const b = log.at(-1)
  const days = (new Date(b.date) - new Date(a.date)) / 864e5
  return days >= 30 && b.km > a.km ? (b.km - a.km) / days : null
}

/** km-Stand eintragen (nur wenn neuer oder gleich wie der letzte). */
export function addKm(v, date, km) {
  const n = Number(km)
  if (!Number.isFinite(n) || n <= 0 || !date) return v
  const log = (v.kmLog || []).filter((x) => x.date !== date)
  return { ...v, kmLog: [...log, { date, km: n }].sort((a, b) => a.date.localeCompare(b.date)).slice(-24) }
}

/** Nächstes Service: { date, km } aus Eintrag oder Intervall. */
export function serviceNext(s = {}) {
  return {
    date: s.nextDate || (s.lastDate && Number(s.months) ? addMonths(s.lastDate, Number(s.months)) : ''),
    km: Number(s.nextKm) || (Number(s.lastKm) >= 0 && s.lastKm !== '' && Number(s.km) ? Number(s.lastKm) + Number(s.km) : 0),
  }
}

/**
 * Service fällig nach Datum oder km, was zuerst kommt. Mit km-Hochrechnung:
 * „bei rund 1.200 km im Monat etwa ab 03/2027“.
 *   status: 'ok' | 'bald' | 'faellig' | 'unbekannt'
 */
export function serviceStatus(v, today) {
  const next = serviceNext(v.service)
  if (!next.date && !next.km) return { status: 'unbekannt', ...next }
  const cur = currentKm(v)
  const perDay = kmPerDay(v)
  let kmDate = ''
  if (next.km && cur && perDay) kmDate = addDays(cur.date, Math.max(0, Math.ceil((next.km - cur.km) / perDay)))
  const left = next.km && cur ? next.km - cur.km : null
  const projectedKm = cur && perDay ? cur.km + perDay * Math.max(0, (new Date(today) - new Date(cur.date)) / 864e5) : cur?.km
  const reached = (next.date && today >= next.date) || (next.km && projectedKm !== undefined && projectedKm >= next.km)
  const soon = (next.date && today >= addDays(next.date, -LEAD_DAYS)) || (left !== null && left <= LEAD_KM) || (kmDate && today >= addDays(kmDate, -LEAD_DAYS))
  const by = [next.date, kmDate].filter(Boolean).sort()[0] || ''
  return { status: reached ? 'faellig' : soon ? 'bald' : 'ok', ...next, kmDate, left, current: cur, perMonth: perDay ? Math.round(perDay * 30.4) : null, by }
}

// ---------------------------------------------------------------- Weitere Fälligkeiten

export function dueStatus(d, today) {
  if (!d?.date) return 'unbekannt'
  return today >= d.date ? 'faellig' : today >= addDays(d.date, -LEAD_DAYS) ? 'bald' : 'ok'
}

// ---------------------------------------------------------------- Alles zusammen

export const DUE_LABEL = { ok: 'in Ordnung', bald: 'bald fällig', faellig: 'fällig', nachfrist: 'in der Nachfrist', abgelaufen: 'abgelaufen', unbekannt: 'nicht eingetragen', geplant: 'Termin geplant' }
export const DUE_CLASS = { ok: 'ok', bald: 'info', faellig: 'warning', nachfrist: 'warning', abgelaufen: 'error', unbekannt: 'na', geplant: 'info' }
const ORDER = { abgelaufen: 0, nachfrist: 1, faellig: 2, bald: 3, ok: 4, unbekannt: 5 }

/** Geplanter Termin, der eine Aufgabe (service, pickerl, due:ID) mit erledigt. */
export const coveringChange = (fz, vehicleId, task) => (fz?.changes || []).find((c) => c.vehicleId === vehicleId && c.status === 'geplant' && (c.tasks || []).includes(task)) || null

/** Fälligkeiten eines Fahrzeugs, dringendste zuerst: [{ task, label, status, date, text, change }] */
export function vehicleDues(fz, v, today) {
  const out = []
  const p = pickerlStatus(v, today)
  if (p.status !== 'unbekannt') out.push({ task: 'pickerl', label: 'Pickerl', status: p.status, date: p.status === 'abgelaufen' || p.status === 'nachfrist' ? p.to : p.from, info: p })
  const s = serviceStatus(v, today)
  if (s.status !== 'unbekannt') out.push({ task: 'service', label: 'Service', status: s.status, date: s.by || s.date, info: s })
  for (const d of v.dues || []) out.push({ task: `due:${d.id}`, label: d.label || 'Termin', status: dueStatus(d, today), date: d.date, info: d })
  return out.map((x) => ({ ...x, change: coveringChange(fz, v.id, x.task) })).sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.date || '').localeCompare(b.date || ''))
}

/** Aufgaben, die jetzt in einen Werkstatttermin gehören (fällig oder bald, noch ohne Termin). */
export const openTasks = (fz, v, today) => vehicleDues(fz, v, today).filter((d) => !d.change && ['abgelaufen', 'nachfrist', 'faellig', 'bald'].includes(d.status))

export function taskLabel(v, task) {
  if (TASKS[task]) return TASKS[task]
  if (task.startsWith('due:')) return (v.dues || []).find((d) => `due:${d.id}` === task)?.label || 'Termin'
  return task
}

/**
 * Nach dem Werkstatttermin: Service, Pickerl und weitere Fälligkeiten am
 * Fahrzeug nachtragen. results: { service: { nextDate, nextKm }, pickerl: { result, next }, done: ['due:…'] }
 */
export function applyTasksDone(v, change, results = {}) {
  let out = structuredClone(v)
  const date = change.doneAt || change.date
  if (change.km) out = addKm(out, date, change.km)
  for (const task of change.tasks || []) {
    if (task === 'service' && results.service) {
      out.service = { ...(out.service || {}), lastDate: date, lastKm: change.km ? Number(change.km) : out.service?.lastKm ?? '', nextDate: results.service.nextDate || '', nextKm: results.service.nextKm ? Number(results.service.nextKm) : '' }
    }
    if (task === 'pickerl' && results.pickerl) {
      const passed = results.pickerl.result !== 'schwer'
      out.pickerl = { ...(out.pickerl || {}), result: results.pickerl.result || 'ok', ...(passed ? { lastDate: date, next: results.pickerl.next || suggestPickerl(out, date) || '' } : {}) }
    }
    if (task.startsWith('due:') && (results.done || []).includes(task)) {
      const id = task.slice(4)
      out.dues = (out.dues || []).flatMap((d) => (d.id !== id ? [d] : Number(d.months) ? [{ ...d, date: addMonths(d.date || date, Number(d.months)) }] : []))
    }
  }
  return out
}

// ---------------------------------------------------------------- Liste

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '')

/** Fahrzeugliste mit Pickerl, Service und weiteren Fälligkeiten für Excel. rows: [{ vehicle, driver, today, change }] */
export function fleetCsv(rows) {
  const head = ['Kennzeichen', 'Fahrzeug', 'Klasse', 'Fahrer/in', 'Erstzulassung', 'km-Stand', 'km am', 'Pickerl fällig', 'Pickerl', 'Service am', 'Service bei km', 'Service', 'Weitere Fälligkeiten', 'Nächster Termin']
  const lines = rows.map(({ vehicle: v, driver, today, change }) => {
    const p = pickerlStatus(v, today)
    const s = serviceStatus(v, today)
    const km = currentKm(v)
    return [v.plate, v.label, classOf(v), driver || '', monthText(v.firstReg), km?.km ?? '', dmy(km?.date), monthText(p.due), DUE_LABEL[p.status], dmy(s.date), s.km || '', DUE_LABEL[s.status], (v.dues || []).map((d) => `${d.label} ${dmy(d.date)}`).join(', '), change ? `${dmy(change.date)} ${change.time}` : '']
  })
  return `﻿${[head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`
}
