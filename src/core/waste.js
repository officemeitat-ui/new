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

import { addDays, dayIndex, daysInMonth, eachDay, formatDate, formatTime, isoWeekday, toMinutes, WEEKDAY_SHORT, weeksBetween } from './dates.js'
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
function wasteRegulars(object, tasks, employees, inst, cache = null) {
  if (object.waste?.responsible) return [object.waste.responsible]
  // je Lauf einmal: Mitarbeitende nach ID, Stammkräfte je Objekt nach Häufigkeit (sonst je Gang über alle Leistungen)
  const byId = cache ? (cache.byId ||= new Map(employees.map((e) => [e.id, e]))) : new Map(employees.map((e) => [e.id, e]))
  let ranked = cache?.ranked?.get(object.id)
  if (!ranked) {
    const count = new Map()
    for (const t of tasks) if (t.objectId === object.id) for (const id of t.regulars || []) count.set(id, (count.get(id) || 0) + 1)
    ranked = [...count].sort((a, b) => b[1] - a[1])
    if (cache) (cache.ranked ||= new Map()).set(object.id, ranked)
  }
  const best = ranked.find(([id]) => byId.has(id) && fitsAvailability(byId.get(id), inst))
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
  const duties = wasteDuties(objects, from, to, holidays)
  if (!duties.length) return instances
  // Einsätze je Objekt und Tag einmal nachschlagen statt je Gang alle Einsätze durchsuchen (12 Monate: zehntausende).
  // Neu angelegte Müll-Gänge kommen nicht hinein: sie sind nie Gastgeber (Kategorie „muell“).
  const withWaste = new Set(duties.map((d) => d.objectId))
  const byDay = new Map()
  for (const i of instances) {
    if (!withWaste.has(i.objectId)) continue
    const k = `${i.objectId}|${i.date}`
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(i)
  }
  const cache = {}
  for (const duty of duties) {
    const w = WASTE_WINDOWS[duty.window]
    const base = dayIndex(duty.date) * 1440
    const fits = (byDay.get(`${duty.objectId}|${duty.date}`) || []).filter((i) => i.status !== 'cancelled' && i.staff === 1 && i.category !== 'muell' && i.end - base > w.from && i.start - base < w.to)
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
    inst.regulars = wasteRegulars(object, tasks, employees, inst, cache)
    inst.waste = duty
    instances.push(inst)
  }
  return instances
}

// ---------------------------------------------------------------- Abfuhrkalender einlesen

const VIENNA = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' })
const ICS_WEEKDAYS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
/** Wiederholung ohne Ende: so weit wird aufgelöst (Abfuhrkalender gelten meist ein Jahr). */
const ICS_HORIZON_DAYS = 731

/** Datum eines .ics-Werts: ganztägig oder Ortszeit wie angegeben, UTC (…Z) in Wiener Zeit umgerechnet. */
function icsDate(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
  if (!m) return null
  if (!m[7]) return `${m[1]}-${m[2]}-${m[3]}`
  return VIENNA.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0))))
}

/** Termine einer Wiederholung (RRULE FREQ=DAILY/WEEKLY mit INTERVAL, COUNT/UNTIL, BYDAY); andere nur der erste Termin. */
function expandRule(start, rule) {
  const r = Object.fromEntries(String(rule || '').split(';').map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v || '').toUpperCase()]))
  if (r.FREQ !== 'DAILY' && r.FREQ !== 'WEEKLY') return [start]
  const every = Math.max(1, Number(r.INTERVAL) || 1)
  const count = Number(r.COUNT) || Infinity
  const end = [r.UNTIL ? icsDate(r.UNTIL) : null, addDays(start, ICS_HORIZON_DAYS)].filter(Boolean).sort()[0]
  const days = r.FREQ === 'WEEKLY' ? (r.BYDAY ? r.BYDAY.split(',').map((d) => ICS_WEEKDAYS[d.replace(/[^A-Z]/g, '')]).filter(Boolean) : [isoWeekday(start)]) : null
  const out = []
  for (let d = start; d <= end && out.length < count; d = addDays(d, 1)) {
    const hit = days ? days.includes(isoWeekday(d)) && weeksBetween(start, d) % every === 0 : (dayIndex(d) - dayIndex(start)) % every === 0
    if (d === start || hit) out.push(d)
  }
  return out
}

/**
 * iCalendar (.ics) des Abfuhrkalenders: [{ date, summary, type }], nach Datum.
 * Wiederholungen (RRULE) werden aufgelöst, EXDATE und abgesagte Termine
 * (STATUS:CANCELLED) fallen weg, ein verschobener Einzeltermin (RECURRENCE-ID)
 * ersetzt den ursprünglichen. Zeiten in UTC zählen nach Wiener Datum.
 */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events = []
  let cur = null
  let nested = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] }
      nested = 0
    } else if (line === 'END:VEVENT') {
      if (cur) events.push(cur)
      cur = null
    } else if (cur && /^BEGIN:/i.test(line)) nested++
    else if (cur && /^END:/i.test(line)) nested = Math.max(0, nested - 1)
    else if (cur && !nested) {
      // Eigenschaften im Termin selbst (nicht in einer Erinnerung VALARM)
      const i = line.indexOf(':')
      if (i < 0) continue
      const name = line.slice(0, i).split(';')[0].toUpperCase()
      const value = line.slice(i + 1).trim()
      if (name === 'EXDATE') cur.exdates.push(...value.split(',').map(icsDate).filter(Boolean))
      else if (name === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim()
      else cur[name] = value
    }
  }
  // verschobene oder abgesagte Einzeltermine: der ursprüngliche Termin der Serie fällt weg
  const replaced = new Set(events.filter((e) => e['RECURRENCE-ID']).map((e) => `${e.UID || ''}|${icsDate(e['RECURRENCE-ID'])}`))
  const out = []
  for (const e of events) {
    const start = icsDate(e.DTSTART)
    if (!start || /^CANCELLED$/i.test(e.STATUS || '')) continue
    const dates = e['RECURRENCE-ID'] ? [start] : expandRule(start, e.RRULE).filter((d) => !e.exdates.includes(d) && !replaced.has(`${e.UID || ''}|${d}`))
    for (const date of dates) out.push({ date, summary: e.summary || '', type: detectWasteType(e.summary) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Alle Daten in einem Text (z. B. „03.11.2026, 17.11.2026“), als ISO-Datum. */
export function datesIn(text) {
  return [...String(text).matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{4})/g)].map((m) => (m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2, '0')}-${m[4].padStart(2, '0')}`))
}

/** Gültiges Datum aus Tag, Monat, Jahr (zweistelliges Jahr = 20xx), sonst null (z. B. 31.11.). */
function validDate(y, m, d) {
  const year = String(y).length === 2 ? 2000 + Number(y) : Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1) return null
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return day <= daysInMonth(`${date.slice(0, 8)}01`) ? date : null
}

/** Eingefügte Termine, z. B. „03.11.2026 Restmüll“, „03.11.26 Bio“ oder „2026-11-17 Papier“ (eine Zeile je Termin). */
export function parseDateList(text, defaultType = 'Restmüll') {
  const out = []
  for (const line of String(text).split(/\n|;/)) {
    const iso = line.match(/(\d{4})-(\d{2})-(\d{2})/)
    const de = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/)
    const date = iso ? validDate(iso[1], iso[2], iso[3]) : de ? validDate(de[3], de[2], de[1]) : null
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
