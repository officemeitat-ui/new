// Fahrtenbuch je Firmenfahrzeug: Fahrten werden aus dem vorgeschlagen, was die App ohnehin weiß – Touren im
// Mattenwechsel, Winterdienst-Protokoll und Einsätze der festen Fahrerin bzw. des festen Fahrers im Dienstplan –, und
// nur noch bestätigt (km-Stand am Ende, Art, Zweck). Rein rechnend, ohne Netz testbar (test/fahrtenbuch.test.js);
// Oberfläche: Reiter „Fahrtenbuch“ in ui/views/fahrtenbuch.js.
//
// Abstellort je Fahrzeug (vehicles[].home, z. B. „Betriebshof Gnigl“): Start und Ende der Fahrten aus Dienstplan und
// Winterdienst; Touren bringen ihren Betriebshof mit. Ohne Abstellort beginnt die Strecke beim ersten Objekt.
//
// Daten (fahrzeuge/fahrtenbuch/<Jahr>.json, eine Datei je Jahr wie die Einsätze im Mattenwechsel):
//   trips: [{ id, vehicleId, date, driver, route, purpose, kind: 'dienst'|'privat'|'weg', kmStart, kmEnd, km, kmPlan,
//             kmEstimated?, suggestion? ('Fahrzeug|Datum' des Vorschlags), sources? [{ kind, ref }],
//             confirmedAt, confirmedBy, history? [{ at, by, changes: { feld: [vorher, nachher] } }],
//             cancelled? { at, by, reason } }]
//   Ein abgelehnter Vorschlag („nicht gefahren“) ist ein Eintrag { id, vehicleId, date, suggestion, dismissed: { at, by } }.
//
// Rechtlich (Österreich, Stand 2026): Ein Fahrtenbuch muss laufend und zeitnah geführt werden und je Fahrt Datum,
// km-Stand, gefahrene km, Ausgangs- und Zielpunkt sowie den Zweck zeigen; nachträgliche Änderungen müssen erkennbar
// sein. Darum löscht die App keine bestätigte Fahrt (stornieren mit Grund) und hält jede Änderung mit Zeit und Person
// fest. Für den Sachbezug zählen Privatfahrten und Fahrten Wohnung–Arbeitsstätte: im Jahresschnitt höchstens 500 km
// im Monat → halber Sachbezug (Sachbezugswerteverordnung § 4 Abs. 2). Ob das Fahrtenbuch reicht, mit der
// Steuerberatung abstimmen.

import { DETOUR, haversineKm, hasCoords } from './geo.js'
import { viennaParts } from './weather.js'

export const FB_KINDS = { dienst: 'Dienstfahrt', privat: 'Privatfahrt', weg: 'Wohnung–Arbeitsstätte' }
export const FB_SOURCES = { tour: 'Mattenwechsel', winter: 'Winterdienst', plan: 'Dienstplan', hand: 'von Hand' }
/** Privat-km im Monat (Jahresschnitt), bis zu denen der halbe Sachbezug gilt. */
export const PRIVATE_LIMIT = 500
/** Nach so vielen Tagen gilt ein unbestätigter Vorschlag als nicht mehr zeitnah. */
export const LATE_DAYS = 7

const pad2 = (n) => String(n).padStart(2, '0')
/** Zeitpunkt (ISO, UTC) → „JJJJ-MM-TT HH:MM“ in Wien; sonst wie gespeichert gekürzt (leer ohne Zeitpunkt). */
export function viennaClock(iso) {
  if (!iso) return ''
  if (!Number.isFinite(Date.parse(iso))) return String(iso).slice(0, 16).replace('T', ' ')
  const p = viennaParts(iso)
  return `${p.date} ${pad2(p.hour)}:${pad2(p.minute)}`
}
const FIELDS = ['date', 'driver', 'route', 'purpose', 'kind', 'kmStart', 'kmEnd', 'km']
const FIELD_LABEL = { date: 'Datum', driver: 'Fahrer/in', route: 'Strecke', purpose: 'Zweck', kind: 'Art', kmStart: 'km-Stand Beginn', kmEnd: 'km-Stand Ende', km: 'km' }

export const emptyFahrtenbuch = () => ({ schema: 1, trips: [] })
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const round1 = (n) => Math.round(n * 10) / 10
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  // Eingabe wie in Österreich üblich: Punkt trennt Tausender, Komma Dezimalstellen („12.345,6“)
  const n = Number(String(v).replace(/\s|\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}
export const parseKmStand = num
export const suggestionKey = (vehicleId, date) => `${vehicleId}|${date}`
const isTrip = (t) => t && !t.dismissed
const live = (t) => isTrip(t) && !t.cancelled
const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || (num(a.kmStart) ?? 0) - (num(b.kmStart) ?? 0) || String(a.confirmedAt || '').localeCompare(String(b.confirmedAt || ''))

// ---------------------------------------------------------------- Besuche aus den Quellen

/**
 * Touren im Mattenwechsel → Besuche. Nur Touren, die gefahren sind oder sein sollten (nicht „entwurf“). Je Tour
 * kennt die App die geplanten km (Fahrt plus Rückweg); sie gelten für die Tour als Ganzes.
 */
export function visitsFromTours(tours = []) {
  const out = []
  for (const t of tours || []) {
    if (!t?.date || !t.vehicleId || !t.status || t.status === 'entwurf') continue
    const stops = (t.stops || []).filter((s) => s?.objectName || s?.customer?.name)
    const km = round1((Number(t.route?.km) || 0) + (Number(t.route?.back?.km) || 0))
    const depot = t.route?.depot
    stops.forEach((s, i) =>
      out.push({
        kind: 'tour',
        ref: t.id,
        vehicleId: t.vehicleId,
        driver: text(t.driverName),
        date: t.date,
        time: s.times?.arrival || s.times?.start || '',
        order: i,
        name: text(s.objectName || s.customer?.name),
        place: s.objectId || s.placementId || s.id || '',
        ...(hasCoords(s) ? { lat: s.lat, lon: s.lon } : hasCoords(s.object) ? { lat: s.object.lat, lon: s.object.lon } : {}),
        ...(i === 0 ? { tourKm: km, tourStops: stops.length, ...(depot?.name ? { depot: { name: text(depot.name), ...(hasCoords(depot) ? { lat: depot.lat, lon: depot.lon } : {}) } } : {}) } : {}),
      }),
    )
  }
  return out
}

/** Winterdienst-Protokoll (Einträge mit person, at, objectId) → Besuche; die Person wird über den Namen gefunden. */
export function visitsFromWinter(entries = [], { employees = [], objects = [] } = {}) {
  const byName = new Map(employees.map((e) => [text(e.name).toLowerCase(), e]))
  const objOf = new Map(objects.map((o) => [o.id, o]))
  const out = []
  for (const e of entries || []) {
    const emp = byName.get(text(e?.person).toLowerCase())
    if (!emp || !e.date) continue
    const o = objOf.get(e.objectId)
    out.push({
      kind: 'winter',
      ref: e.id || `${e.date}|${e.objectId}`,
      empId: emp.id,
      driver: text(emp.name),
      date: e.date,
      // Uhrzeit in Wien wie die Zeiten aus Dienstplan und Touren (danach wird gereiht), nicht in UTC
      time: e.at ? viennaClock(e.at).slice(11) : '',
      name: text(o?.name || e.object),
      place: e.objectId || text(e.object),
      ...(hasCoords(o) ? { lat: o.lat, lon: o.lon } : {}),
    })
  }
  return out
}

/** Einsätze im Dienstplan ([{ key, date, start, objectId, empIds }]) → Besuche der eingeteilten Personen. */
export function visitsFromPlan(instances = [], { objects = [], employees = [], drivers = new Set() } = {}) {
  const objOf = new Map(objects.map((o) => [o.id, o]))
  const empOf = new Map(employees.map((e) => [e.id, e]))
  const out = []
  for (const i of instances || []) {
    if (!i?.date || i.status === 'cancelled') continue
    for (const empId of i.empIds || []) {
      if (drivers.size && !drivers.has(empId)) continue
      const o = objOf.get(i.objectId)
      out.push({ kind: 'plan', ref: i.key, empId, driver: text(empOf.get(empId)?.name), date: i.date, time: i.start || '', name: text(o?.name || i.objectId), place: i.objectId, ...(hasCoords(o) ? { lat: o.lat, lon: o.lon } : {}) })
    }
  }
  return out
}

// ---------------------------------------------------------------- Vorschläge

const legKm = (a, b) => (hasCoords(a) && hasCoords(b) ? round1(haversineKm(a, b) * DETOUR) : null)

/**
 * Vorschläge je Fahrzeug und Tag aus den Besuchen: { key, vehicleId, date, driver, stops, route, purpose, kmPlan,
 * kmUnsure, sources, late }. Besuche ohne Fahrzeug gehören zum Fahrzeug der festen Fahrerin bzw. des festen Fahrers
 * (vehicles[].driverId). Nur Tage von from bis today; Tage mit bestätigter Fahrt oder „nicht gefahren“ fallen weg.
 * Start und Ende: Betriebshof der Tour, sonst Abstellort des Fahrzeugs (vehicles[].home), sonst base { name, lat, lon }.
 */
export function suggestTrips({ visits = [], vehicles = [], trips = [], base = null, from = '', to = '', today = '' } = {}) {
  const active = vehicles.filter((v) => v && !v.inactive)
  const byDriver = new Map()
  for (const v of active) if (v.driverId && !byDriver.has(v.driverId)) byDriver.set(v.driverId, v)
  const known = new Set(active.map((v) => v.id))
  const vehicleOf = new Map(active.map((v) => [v.id, v]))
  const done = new Set((trips || []).filter((t) => t?.suggestion && (t.dismissed || live(t))).map((t) => t.suggestion))
  const last = to && today ? (to < today ? to : today) : to || today
  const groups = new Map()
  for (const x of visits) {
    const vehicleId = x.vehicleId && known.has(x.vehicleId) ? x.vehicleId : byDriver.get(x.empId)?.id
    if (!vehicleId || !x.date || (from && x.date < from) || (last && x.date > last)) continue
    const key = suggestionKey(vehicleId, x.date)
    if (done.has(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...x, vehicleId })
  }
  const out = []
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || (a.order ?? 0) - (b.order ?? 0))
    // gleiche Stelle hintereinander nur einmal
    const stops = list.filter((x, i) => i === 0 || (x.place || x.name) !== (list[i - 1].place || list[i - 1].name))
    const home = text(vehicleOf.get(list[0].vehicleId)?.home)
    const depot = list.find((x) => x.depot)?.depot || (home ? { name: home } : base) || null
    const points = [...(depot ? [depot] : []), ...stops, ...(depot ? [depot] : [])]
    // km: Touren mit ihren geplanten km, der Rest Luftlinie × Umweg zwischen den Stellen
    const tourKm = new Map()
    for (const x of list) if (x.kind === 'tour' && x.tourKm !== undefined) tourKm.set(x.ref, x.tourKm)
    let kmPlan = 0
    let unsure = false
    if (tourKm.size && list.every((x) => x.kind === 'tour')) kmPlan = [...tourKm.values()].reduce((s, k) => s + k, 0)
    else
      for (let i = 1; i < points.length; i++) {
        const k = legKm(points[i - 1], points[i])
        if (k === null) unsure = true
        else kmPlan += k
      }
    const kinds = [...new Set(list.map((x) => x.kind))]
    const purpose = kinds
      .map((k) => {
        const n = new Set(list.filter((x) => x.kind === k).map((x) => x.place || x.name)).size
        if (k === 'tour') return `Mattenwechsel (${n} ${n === 1 ? 'Stopp' : 'Stopps'})`
        if (k === 'winter') return `Winterdienst (${n} ${n === 1 ? 'Objekt' : 'Objekte'})`
        return `Reinigung (${n} ${n === 1 ? 'Objekt' : 'Objekte'})`
      })
      .join('; ')
    const [vehicleId, date] = key.split('|')
    const sources = [...new Map(list.map((x) => [`${x.kind}|${x.ref}`, { kind: x.kind, ref: x.ref }])).values()]
    out.push({
      key,
      vehicleId,
      date,
      driver: [...new Set(list.map((x) => x.driver).filter(Boolean))].join(', '),
      stops: stops.map((x) => x.name),
      route: points.map((p) => p.name).filter(Boolean).filter((n, i, a) => i === 0 || n !== a[i - 1]).join(' – '),
      purpose,
      kmPlan: round1(kmPlan),
      kmUnsure: unsure || (!kmPlan && points.length > 1),
      sources,
      late: !!today && daysBetween(date, today) > LATE_DAYS,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.vehicleId.localeCompare(b.vehicleId))
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)
}

// ---------------------------------------------------------------- Fahrten

/** km-Stand am Ende der letzten Fahrt des Fahrzeugs vor bzw. am Tag (oder null). */
export function lastKm(trips = [], vehicleId, date = '9999-12-31') {
  const list = (trips || []).filter((t) => live(t) && t.vehicleId === vehicleId && t.date <= date && num(t.kmEnd) !== null).sort(byDate)
  return list.length ? num(list.at(-1).kmEnd) : null
}

/**
 * Eingaben prüfen und Fahrt bauen. input: { vehicleId, date, driver, route, purpose, kind, kmStart, kmEnd, km }
 * suggestion: Vorschlag (oder null bei „von Hand“). Gibt { trip } oder { error } zurück.
 */
export function makeTrip(input = {}, { suggestion = null, by = '', now = new Date().toISOString(), newId = () => `fb${Date.now().toString(36)}` } = {}) {
  const kind = FB_KINDS[input.kind] ? input.kind : 'dienst'
  const kmStart = num(input.kmStart)
  const kmEnd = num(input.kmEnd)
  let km = num(input.km)
  if (!input.vehicleId) return { error: 'Bitte ein Fahrzeug wählen.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ''))) return { error: 'Bitte das Datum angeben.' }
  if (kmStart !== null && kmEnd !== null) {
    if (kmEnd < kmStart) return { error: 'Der km-Stand am Ende ist kleiner als am Beginn.' }
    km = round1(kmEnd - kmStart)
  }
  const estimated = km === null && suggestion?.kmPlan > 0
  if (km === null && estimated) km = suggestion.kmPlan
  if (km === null) return { error: 'Bitte den km-Stand am Ende (oder die gefahrenen km) angeben.' }
  if (km > 2000) return { error: 'Mehr als 2.000 km an einem Tag? Bitte den km-Stand prüfen.' }
  const route = text(input.route) || suggestion?.route || ''
  if (!route && kind === 'dienst') return { error: 'Bitte die Strecke angeben (von – nach).' }
  const purpose = text(input.purpose) || (kind === 'dienst' ? suggestion?.purpose || '' : FB_KINDS[kind])
  if (!purpose) return { error: 'Bitte den Zweck der Fahrt angeben.' }
  return {
    trip: {
      id: newId(),
      vehicleId: input.vehicleId,
      date: input.date,
      driver: text(input.driver) || suggestion?.driver || '',
      route,
      purpose,
      kind,
      kmStart,
      kmEnd,
      km,
      ...(suggestion ? { kmPlan: suggestion.kmPlan, suggestion: suggestion.key, sources: suggestion.sources } : {}),
      ...(estimated ? { kmEstimated: true } : {}),
      confirmedAt: now,
      confirmedBy: by,
    },
  }
}

/** Vorschlag als „nicht gefahren“ vermerken (bleibt als Eintrag, damit der Vorschlag nicht wiederkommt). */
export const dismissTrip = (s, { by = '', now = new Date().toISOString(), newId = () => `fb${Date.now().toString(36)}` } = {}) => ({ id: newId(), vehicleId: s.vehicleId, date: s.date, suggestion: s.key, dismissed: { at: now, by } })

/** Bestätigte Fahrt ändern: neue Fassung mit Eintrag im Änderungsprotokoll (nur geänderte Felder) oder { error }. */
export function editTrip(trip, input = {}, { by = '', now = new Date().toISOString() } = {}) {
  if (!isTrip(trip)) return { error: 'Diese Fahrt gibt es nicht.' }
  if (trip.cancelled) return { error: 'Eine stornierte Fahrt bleibt, wie sie ist.' }
  const res = makeTrip({ ...trip, ...input, vehicleId: trip.vehicleId }, { by, now, newId: () => trip.id, suggestion: trip.kmPlan ? { kmPlan: trip.kmPlan, key: trip.suggestion, sources: trip.sources, route: trip.route, purpose: trip.purpose, driver: trip.driver } : null })
  if (res.error) return res
  const next = res.trip
  const changes = {}
  for (const f of FIELDS) if (String(trip[f] ?? '') !== String(next[f] ?? '')) changes[f] = [trip[f] ?? null, next[f] ?? null]
  if (!Object.keys(changes).length) return { trip }
  return { trip: { ...trip, ...Object.fromEntries(FIELDS.map((f) => [f, next[f]])), kmEstimated: next.kmEstimated || undefined, history: [...(trip.history || []), { at: now, by, changes }] }, changes }
}

/** Stornieren (bleibt sichtbar, mit Grund). */
export function cancelTrip(trip, reason, { by = '', now = new Date().toISOString() } = {}) {
  if (!isTrip(trip) || trip.cancelled) return { error: 'Diese Fahrt ist schon storniert.' }
  if (!text(reason)) return { error: 'Bitte einen Grund angeben.' }
  return { trip: { ...trip, cancelled: { at: now, by, reason: text(reason) } } }
}

/** Änderungen als Text: „km-Stand Ende 12.345 → 12.354“. */
export const changeText = (changes = {}) =>
  Object.entries(changes)
    .map(([f, [a, b]]) => `${FIELD_LABEL[f] || f} ${a === null || a === '' ? '–' : f === 'kind' ? FB_KINDS[a] || a : a} → ${b === null || b === '' ? '–' : f === 'kind' ? FB_KINDS[b] || b : b}`)
    .join('; ')

// ---------------------------------------------------------------- Prüfen und zusammenzählen

/**
 * Prüfungen je Fahrzeug: Lücke (km-Stand am Beginn höher als am Ende der Fahrt davor: nicht erfasste Fahrt?),
 * Rücksprung (niedriger: Tippfehler?), geschätzte km. [{ level, tripId, date, text }]
 */
export function tripChecks(trips = [], vehicleId) {
  const list = (trips || []).filter((t) => live(t) && t.vehicleId === vehicleId).sort(byDate)
  const out = []
  let prev = null
  for (const t of list) {
    const start = num(t.kmStart)
    const end = num(t.kmEnd)
    if (prev !== null && start !== null) {
      if (start > prev + 0.5) out.push({ level: 'warning', tripId: t.id, date: t.date, gap: round1(start - prev), text: `${fmtKm(start - prev)} zwischen den Fahrten nicht erfasst (Privatfahrt oder fehlende Fahrt?)` })
      else if (start < prev - 0.5) out.push({ level: 'error', tripId: t.id, date: t.date, text: `km-Stand am Beginn (${fmtKm(start)}) kleiner als am Ende der Fahrt davor (${fmtKm(prev)})` })
    }
    if (t.kmEstimated) out.push({ level: 'info', tripId: t.id, date: t.date, text: 'km geschätzt (ohne km-Stand)' })
    if (end !== null) prev = end
  }
  return out
}

export const fmtKm = (n) => `${(Math.round(Number(n) * 10) / 10).toLocaleString('de-AT')} km`

/** Summen je Art für Fahrten (z. B. eines Monats): { dienst, privat, weg, total, count }. */
export function kmSums(trips = []) {
  const s = { dienst: 0, privat: 0, weg: 0, total: 0, count: 0 }
  for (const t of trips) {
    if (!live(t)) continue
    const k = num(t.km) || 0
    s[FB_KINDS[t.kind] ? t.kind : 'dienst'] += k
    s.total += k
    s.count++
  }
  for (const k of ['dienst', 'privat', 'weg', 'total']) s[k] = round1(s[k])
  return s
}

/**
 * Privat-km (privat + Wohnung–Arbeitsstätte) im Jahresschnitt bis zum Monat: { months, privateKm, perMonth, over }.
 * Gezählt werden die Monate von Jänner (bzw. dem ersten Monat mit Fahrt) bis zum Monat.
 */
export function privateAverage(trips = [], vehicleId, month) {
  const year = String(month).slice(0, 4)
  const list = (trips || []).filter((t) => live(t) && t.vehicleId === vehicleId && String(t.date).startsWith(year) && t.date.slice(0, 7) <= month)
  if (!list.length) return { months: 0, privateKm: 0, perMonth: 0, over: false }
  const first = list.reduce((m, t) => (t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m), month)
  const months = Number(month.slice(5, 7)) - Number(first.slice(5, 7)) + 1
  const privateKm = round1(list.filter((t) => t.kind === 'privat' || t.kind === 'weg').reduce((s, t) => s + (num(t.km) || 0), 0))
  const perMonth = round1(privateKm / months)
  return { months, privateKm, perMonth, over: perMonth > PRIVATE_LIMIT }
}

/** Fahrten eines Zeitraums (ohne „nicht gefahren“), sortiert. */
export const tripsIn = (trips = [], { from = '', to = '9999-12-31', vehicleId = '' } = {}) => (trips || []).filter((t) => isTrip(t) && t.date >= from && t.date <= to && (!vehicleId || t.vehicleId === vehicleId)).sort((a, b) => String(a.vehicleId).localeCompare(String(b.vehicleId)) || byDate(a, b))

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s
}
const kmCell = (v) => (num(v) === null ? '' : String(num(v)).replace('.', ','))

/** CSV (Semikolon, für Excel) – stornierte Fahrten bleiben mit Grund drin, Änderungen stehen in der letzten Spalte. */
export function fahrtenbuchCsv(trips = [], vehicles = []) {
  const plate = new Map(vehicles.map((v) => [v.id, v.plate || v.label || v.id]))
  const head = ['Datum', 'Kennzeichen', 'Fahrer/in', 'Art', 'Strecke', 'Zweck', 'km-Stand Beginn', 'km-Stand Ende', 'km', 'km geschätzt', 'bestätigt am', 'bestätigt von', 'storniert', 'Änderungen']
  const rows = trips.filter(isTrip).map((t) => [
    t.date,
    plate.get(t.vehicleId) || t.vehicleId,
    t.driver,
    FB_KINDS[t.kind] || t.kind,
    t.route,
    t.purpose,
    kmCell(t.kmStart),
    kmCell(t.kmEnd),
    kmCell(t.km),
    t.kmEstimated ? 'ja' : '',
    viennaClock(t.confirmedAt),
    t.confirmedBy,
    t.cancelled ? `${[viennaClock(t.cancelled.at).slice(0, 10), t.cancelled.by].filter(Boolean).join(' ')}: ${t.cancelled.reason}` : '',
    (t.history || []).map((h) => `${[viennaClock(h.at), h.by].filter(Boolean).join(' ')}: ${changeText(h.changes)}`).join(' | '),
  ])
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`
}
