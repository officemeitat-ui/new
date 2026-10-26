// Müllplanung: Abfuhrtage je Objekt (Rhythmus oder Termine aus dem
// Abfuhrkalender der Gemeinde) und daraus die Gänge zum Raus- und
// Reinstellen der Tonnen.
//
// Automatik: Ein Gang wird an einen Einsatz angehängt, der zur passenden
// Zeit ohnehin im Objekt stattfindet. Wer dort eingeteilt ist, erledigt es
// mit, die Minuten werden angerechnet. Gibt es keinen solchen Einsatz,
// entsteht ein eigener kurzer Einsatz, den die Automatik besetzt.
//
// object.waste = {
//   streams: [{ id, type: 'Restmüll', recurrence: { type: 'weekly', weekdays, everyWeeks, anchor } | { type: 'dates', dates: [] } | monthly }],
//   outWhen: 'vortag' | 'abholtag',   // rausstellen am Vorabend oder in der Früh
//   bringBack: true,                   // am Abholtag wieder reinstellen
//   minutes: 10,                       // Dauer je Gang
//   responsible: employeeId?,          // für eigene Einsätze (sonst Stammkraft des Objekts)
//   note: ''                           // z. B. „Müllraum im Hof, Schlüssel 3“
// }

import { addDays, dayIndex, eachDay, formatDate, formatTime, isoWeekday, toMinutes, WEEKDAY_SHORT } from './dates.js'
import { nextWorkday, taskOccursOn } from './recurrence.js'
import { fitsAvailability } from './rules.js'

export const WASTE_TYPES = ['Restmüll', 'Biomüll', 'Altpapier', 'Leichtverpackung', 'Glas', 'Metall', 'Sperrmüll', 'Sonstiges']
const TYPE_PATTERNS = [
  [/rest/i, 'Restmüll'],
  [/bio|kompost|grünschnitt/i, 'Biomüll'],
  [/papier|karton|kartonage/i, 'Altpapier'],
  [/gelb|leichtverpack|plastik|kunststoff|verpackung|lvp/i, 'Leichtverpackung'],
  [/glas/i, 'Glas'],
  [/metall|dose/i, 'Metall'],
  [/sperr/i, 'Sperrmüll'],
]
export const detectWasteType = (text) => TYPE_PATTERNS.find(([re]) => re.test(text || ''))?.[1] || 'Sonstiges'

export const WASTE_DEFAULTS = { outWhen: 'vortag', bringBack: true, minutes: 10 }

/** Zeitfenster je Gang (Minuten ab Mitternacht) und Uhrzeit für einen eigenen Einsatz. */
export const WASTE_WINDOWS = {
  'out-vortag': { from: 12 * 60, to: 24 * 60, at: '18:00', verb: 'rausstellen' },
  'out-abholtag': { from: 0, to: 8 * 60, at: '06:00', verb: 'rausstellen' },
  in: { from: 9 * 60, to: 24 * 60, at: '13:00', verb: 'reinstellen' },
}

export const wasteSettings = (object) => ({ ...WASTE_DEFAULTS, ...(object.waste || {}) })

// ---------------------------------------------------------------- Rhythmus einer Tonne (Eingabe)

export const WASTE_RHYTHMS = { w1: 'wöchentlich', w2: '14-tägig', w3: 'alle 3 Wochen', w4: '4-wöchentlich', m1: 'monatlich', dates: 'Termine' }

/** Rhythmus aus der Eingabe: Art (w1…w4, m1, dates) und ein bekannter Abfuhrtermin. */
export function wasteRecurrence(rhythm, ref, dates = []) {
  if (rhythm === 'dates') return { type: 'dates', dates: [...new Set(dates)].sort() }
  if (rhythm === 'm1') {
    const nth = Math.ceil(Number(ref.slice(8)) / 7)
    return { type: 'monthly', mode: 'nth', nth: nth > 4 ? -1 : nth, weekday: isoWeekday(ref), everyMonths: 1, anchor: ref }
  }
  return { type: 'weekly', weekdays: [isoWeekday(ref)], everyWeeks: Number(rhythm.slice(1)) || 1, anchor: ref }
}

/** Gegenstück zu wasteRecurrence: { rhythm, ref, dates } für das Formular. */
export function rhythmOf(stream) {
  const r = stream.recurrence || {}
  if (r.type === 'dates') return { rhythm: 'dates', ref: r.dates?.[0] || '', dates: r.dates || [] }
  if (r.type === 'monthly') return { rhythm: 'm1', ref: r.anchor || '', dates: [] }
  return { rhythm: `w${Math.min(4, r.everyWeeks || 1)}`, ref: r.anchor || '', dates: [] }
}

/** Kurztext, z. B. „Restmüll 14-tägig Di“ oder „Altpapier: 13 Termine“. */
export function streamText(stream) {
  const r = stream.recurrence || {}
  if (r.type === 'dates') return `${stream.type}: ${r.dates?.length === 1 ? '1 Termin' : `${r.dates?.length || 0} Termine`}`
  if (r.type === 'monthly') return `${stream.type} monatlich, ${r.nth === -1 ? 'letzter' : `${r.nth}.`} ${WEEKDAY_SHORT[r.weekday - 1]}`
  return `${stream.type} ${WASTE_RHYTHMS[`w${Math.min(4, r.everyWeeks || 1)}`]} ${(r.weekdays || []).map((d) => WEEKDAY_SHORT[d - 1]).join('/')}`
}

/** Zusammenfassung für die Objektkarte. */
export function wasteSummary(object, today, holidays) {
  if (!object.waste?.streams?.length) return ''
  const s = wasteSettings(object)
  const next = collectionDays(object, today, addDays(today, 62), holidays)[0]
  return [
    object.waste.streams.map(streamText).join(' · '),
    `raus ${s.outWhen === 'abholtag' ? 'in der Früh' : 'am Vorabend'}${s.bringBack ? ', rein am Abholtag' : ''}`,
    next ? `nächste Abfuhr ${formatDate(next.date)}: ${next.types.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function streamOccursOn(stream, date) {
  const r = stream.recurrence || {}
  if (r.type === 'dates') return (r.dates || []).includes(date)
  if (!r.type) return false
  return taskOccursOn({ recurrence: r }, date)
}

/**
 * Abfuhrtage eines Objekts im Zeitraum: [{ date, types[] }]. Fällt ein
 * Termin aus einem Rhythmus auf einen Feiertag, wird er auf den nächsten
 * Werktag verschoben; Termine aus dem Abfuhrkalender gelten wie angegeben.
 */
export function collectionDays(object, from, to, holidays) {
  const byDate = new Map()
  for (const stream of object.waste?.streams || []) {
    for (const date of eachDay(addDays(from, -7), to)) {
      if (!streamOccursOn(stream, date)) continue
      const actual = stream.recurrence?.type !== 'dates' && holidays.get(date)?.legal ? nextWorkday(date, holidays) : date
      if (actual < from || actual > to) continue
      if (!byDate.has(actual)) byDate.set(actual, new Set())
      byDate.get(actual).add(stream.type || 'Sonstiges')
    }
  }
  return [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([date, types]) => ({ date, types: WASTE_TYPES.filter((t) => types.has(t)).concat([...types].filter((t) => !WASTE_TYPES.includes(t))) }))
}

/** Gänge (raus/rein) aller Objekte, deren Tag im Zeitraum liegt. */
export function wasteDuties(objects, from, to, holidays) {
  const duties = []
  for (const object of objects) {
    if (!object.waste?.streams?.length) continue
    const s = wasteSettings(object)
    for (const day of collectionDays(object, from, addDays(to, 1), holidays)) {
      const out = { objectId: object.id, action: 'out', window: s.outWhen === 'abholtag' ? 'out-abholtag' : 'out-vortag', date: s.outWhen === 'abholtag' ? day.date : addDays(day.date, -1), collection: day.date, types: day.types, minutes: s.minutes }
      if (out.date >= from && out.date <= to) duties.push(out)
      if (s.bringBack && day.date <= to) duties.push({ objectId: object.id, action: 'in', window: 'in', date: day.date, collection: day.date, types: day.types, minutes: s.minutes })
    }
  }
  return duties
}

export const dutyText = (d) => `Müll ${WASTE_WINDOWS[d.window].verb}: ${d.types.join(', ')}`

/**
 * Stammkraft für einen eigenen Müll-Gang: die festgelegte Person, sonst wer im
 * Objekt am häufigsten Stammkraft ist und zu dieser Zeit verfügbar ist. Passt
 * niemand, bleibt die Liste leer und die Automatik sucht die beste Person
 * (bevorzugt, wer an dem Tag ohnehin im Objekt ist).
 */
function wasteRegulars(object, tasks, employees, inst) {
  if (object.waste?.responsible) return [object.waste.responsible]
  const count = new Map()
  for (const t of tasks) if (t.objectId === object.id) for (const id of t.regulars || []) count.set(id, (count.get(id) || 0) + 1)
  const byId = new Map(employees.map((e) => [e.id, e]))
  const best = [...count].sort((a, b) => b[1] - a[1]).find(([id]) => byId.has(id) && fitsAvailability(byId.get(id), inst))
  return best ? [best[0]] : []
}

/**
 * Gänge in die Einsätze einplanen. Verändert `instances`:
 *  - passender Einsatz im Objekt (eine Person, im Zeitfenster): Gang wird angehängt
 *    (inst.addOns, Ende und Arbeitszeit verlängern sich)
 *  - sonst: eigener Einsatz (Kategorie „muell“) über `make(task, date)`
 */
export function applyWaste(instances, { objects, tasks, employees = [], from, to, holidays, make, rules }) {
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  for (const duty of wasteDuties(objects, from, to, holidays)) {
    const w = WASTE_WINDOWS[duty.window]
    const base = dayIndex(duty.date) * 1440
    const fits = instances.filter((i) => i.objectId === duty.objectId && i.date === duty.date && i.status !== 'cancelled' && i.staff === 1 && i.category !== 'muell' && i.end - base > w.from && i.start - base < w.to)
    const host = duty.window === 'out-vortag' ? fits.sort((a, b) => b.end - a.end)[0] : fits.sort((a, b) => a.start - b.start)[0]
    if (host) {
      host.addOns = [...(host.addOns || []), duty]
      host.end += duty.minutes
      host.duration += duty.minutes
      host.net += duty.minutes
      // länger als 6 h: Pause nachziehen
      if (rules && host.duration > rules.breakAfterH * 60 && host.breakMin < rules.breakMin) {
        host.net -= rules.breakMin - host.breakMin
        host.breakMin = rules.breakMin
      }
      host.endTime = formatTime(host.end)
      continue
    }
    const object = objectsById.get(duty.objectId)
    const start = w.at
    const task = {
      id: `muell-${duty.objectId}-${duty.action}`,
      objectId: duty.objectId,
      label: dutyText(duty),
      category: 'muell',
      recurrence: { type: 'once', date: duty.date },
      start,
      end: formatTime(toMinutes(start) + duty.minutes),
      staff: 1,
      regulars: [],
      skills: [],
      holidayRule: 'findet_statt',
    }
    const inst = make(task, duty.date)
    inst.regulars = wasteRegulars(object, tasks, employees, inst)
    inst.waste = duty
    instances.push(inst)
  }
  return instances
}

// ---------------------------------------------------------------- Abfuhrkalender einlesen

/** iCalendar (.ics) des Abfuhrkalenders: [{ date, summary, type }] */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events = []
  let cur = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT') {
      if (cur?.date) events.push({ date: cur.date, summary: cur.summary || '', type: detectWasteType(cur.summary) })
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      const name = line.slice(0, i).split(';')[0].toUpperCase()
      const value = line.slice(i + 1)
      if (name === 'DTSTART') {
        const m = value.match(/^(\d{4})(\d{2})(\d{2})/)
        if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`
      } else if (name === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim()
    }
  }
  return events
}

/** Alle Daten in einem Text (z. B. „03.11.2026, 17.11.2026“), als ISO-Datum. */
export function datesIn(text) {
  return [...String(text).matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4})/g)].map((m) => (m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2, '0')}-${m[4].padStart(2, '0')}`))
}

/** Eingefügte Termine, z. B. „03.11.2026 Restmüll“ oder „2026-11-17 Papier“ (eine Zeile je Termin). */
export function parseDateList(text, defaultType = 'Restmüll') {
  const out = []
  for (const line of String(text).split(/\n|;/)) {
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})/)
    const de = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : de ? `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}` : null
    if (!date) continue
    const rest = line.replace(iso?.[0] || de?.[0], '')
    out.push({ date, summary: rest.trim(), type: /[a-zäöü]/i.test(rest) ? detectWasteType(rest) : defaultType })
  }
  return out
}

/** Termine aus dem Abfuhrkalender in Tonnen (je Art eine Liste von Terminen) umwandeln. */
export function streamsFromEntries(entries, existing = []) {
  const streams = existing.map((s) => ({ ...s, recurrence: { ...s.recurrence, ...(s.recurrence?.dates ? { dates: [...s.recurrence.dates] } : {}) } }))
  for (const e of entries) {
    let stream = streams.find((s) => s.type === e.type && s.recurrence?.type === 'dates')
    if (!stream) {
      stream = { id: `w${streams.length + 1}${e.type.slice(0, 3).toLowerCase()}`, type: e.type, recurrence: { type: 'dates', dates: [] } }
      streams.push(stream)
    }
    if (!stream.recurrence.dates.includes(e.date)) stream.recurrence.dates.push(e.date)
  }
  for (const s of streams) if (s.recurrence?.type === 'dates') s.recurrence.dates.sort()
  return streams
}
