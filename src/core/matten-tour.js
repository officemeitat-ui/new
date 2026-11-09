// Mattenwechsel: Tourvorschlag und Tour-Datenmodell (P8, rein rechnend, ohne Oberfläche; Tests: test/matten-tour.test.js).
// Plan: docs/MATTENWECHSEL-PLAN.md, Abschnitte 4.2 (Tour-Schema), 4.4 (Routing), 5.1 (Ablauf) und Paket P8.
// Die Oberfläche (Reihenfolge ziehen, Fahrer zuweisen, Freigabe) folgt mit P9; Routing: core/routing.js.
//
// Eine Datei je Tour: matten/touren/<Jahr>/<TourId>.json (tourFileName)
//   { schema: 1, id (zufällig, tourId), date, driverId, driverName, driverEmail? (Kopie aus den Stammdaten: Fahrer lesen
//     die Mitarbeitenden nicht, die App erkennt „meine Tour“ über die E-Mail des Kontos), vehicleId, areaId?,
//     status: entwurf | freigegeben | unterwegs | abgeschlossen,
//     order: [stopId]                     gespeicherte Reihenfolge (= Reihenfolge von stops)
//     route: { provider ('luftlinie' | 'google' | 'ors': womit die Zeiten gerechnet sind), km, minutes (Fahrt), start, end (Rückkehr),
//              work, wait, load, back { travel, km }, shift { from, to } (Arbeitszeit), capacity?, depot { name, address,
//              lat, lon }, manual? (von Hand geändert), google? { order [stopId], legs [{ seconds, meters }] } (Abschnitte
//              von Google für genau diese Reihenfolge: gelten wieder, solange die Reihenfolge gleich ist), ors? (ebenso
//              von OpenRouteService; es gibt nur die zuletzt gerechneten) },
//     notice?, stops: [Stopp], createdAt/By, updatedAt/By }
//   Stopp { id, objectId, objectName, customer { id, name, no, deliveryNoteEmail? }, address, lat, lon, geoQuality,
//           window { from, to } | null (Schnittmenge der Liegeplätze), windowNote?, windowConflict?,
//           workMinutes (Summe), demand (Matten gesamt), areaId, mats [{ articleId, name, size, color, qty }],
//           times { arrival, start, departure, wait, travel, km } (geplant), status: 'geplant',
//           items [{ jobKey, alsoJobKeys?, placementId, placementName, floor, access, hint, mat { articleId, name, size, color },
//                    planned, actual: null, status: 'geplant', due, overdue? }] }
//
// Eingefroren wird, was der Fahrer braucht und auf dem Nachweis steht (Kunde, Adresse, Liegeplatz, Zugang, Hinweis, Matte):
// Fahrer lesen nur matten/touren/, nicht die Liegeplätze und nicht die Fakturierung.

import { toMinutes } from './dates.js'
import { deliveryNoteEmailOf } from './invoicing.js'
import { hasCoords } from './geo.js'
import { customerCopy } from './matten.js'
import { jobDate } from './matten-plan.js'
import { DEFAULT_SHIFT, legsMatrix, REASONS, routingFor, routingProvider, scheduleRoute } from './routing.js'

export const TOUR_SCHEMA = 1
export const TOUR_STATUS = { entwurf: 'Entwurf', freigegeben: 'freigegeben', unterwegs: 'unterwegs', abgeschlossen: 'abgeschlossen' }
export const STOP_STATUS = {
  geplant: 'geplant',
  unterwegs: 'unterwegs',
  'in-bearbeitung': 'in Bearbeitung',
  abgeschlossen: 'abgeschlossen',
  'nicht-angetroffen': 'nicht angetroffen',
  teilweise: 'teilweise',
  'nicht-durchgefuehrt': 'nicht durchgeführt',
}
/** Einsätze mit diesem Status kommen in den Tourvorschlag (in-tour ist schon eingeplant). */
export const TOUR_JOB_STATUS = ['geplant', 'nachzuholen', 'nicht-durchgefuehrt']
/** Arbeitszeit je Liegeplatz, wenn am Liegeplatz keine eingetragen ist (Minuten). */
export const DEFAULT_WORK_MINUTES = 5
/** Gründe für nicht eingeplante Stopps: die des Routings und „kein Fahrer für das Gebiet“. */
export const TOUR_REASONS = { ...REASONS, gebiet: 'kein Fahrer für das Gebiet frei' }

const text = (v) => String(v ?? '').trim()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })
const clone = (x) => JSON.parse(JSON.stringify(x))

// ---------------------------------------------------------------- IDs und Dateien

/** Zufällige Tour-ID, z. B. „mt3f9a1c07d2e4“ (nie hochgezählt: zwei Geräte legen nie dieselbe an). */
export function tourId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `mt${[...random(6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
export const TOUR_ID_PATTERN = /^mt[a-f0-9]{12}$/

/** Datei der Tour: matten/touren/<Jahr>/<TourId>.json (Jahr aus dem Datum der Tour). */
export function tourFileName(tour) {
  const year = String(tour?.date || '').slice(0, 4)
  if (!isDate(tour?.date)) throw new Error('Tour ohne gültiges Datum')
  if (!/^[A-Za-z0-9_-]+$/.test(String(tour?.id || ''))) throw new Error('Tour ohne gültige ID')
  return `matten/touren/${year}/${tour.id}.json`
}

// ---------------------------------------------------------------- Stopps aus den Einsätzen

const matKey = (m = {}) => m.articleId || `${text(m.size)}|${text(m.color)}|${text(m.name)}`
const matCopy = (m) => (m ? { articleId: m.articleId || '', name: text(m.name), size: text(m.size || m.legacy?.groesse), color: text(m.color || m.legacy?.farbe) } : null)

function customerOf(p, byCustomer) {
  const c = byCustomer.get(p.customerId)
  if (c) {
    const mail = deliveryNoteEmailOf(c)
    return { ...customerCopy(c), ...(mail ? { deliveryNoteEmail: mail } : {}) }
  }
  return { id: p.customerId || '', name: p.customer?.name || (p.customerId ? 'Kunde' : 'ohne Kunde'), no: p.customer?.no || '' }
}

/** Häufigster Wert (bei Gleichstand der erste), leere zählen nicht. */
const mostCommon = (list) => {
  const n = new Map()
  for (const v of list) if (v) n.set(v, (n.get(v) || 0) + 1)
  let best = ''
  for (const [v, k] of n) if (!best || k > n.get(best)) best = v
  return best
}

function buildStop({ objectId, entries }, { byObject, byCustomer, date, workMinutes }) {
  const object = byObject.get(objectId) || null
  const byPlacement = new Map()
  for (const e of entries) {
    if (!byPlacement.has(e.placement.id)) byPlacement.set(e.placement.id, { placement: e.placement, jobs: [] })
    byPlacement.get(e.placement.id).jobs.push(e.job)
  }
  const list = [...byPlacement.values()].sort((a, b) => byName(a.placement.name, b.placement.name) || byName(a.placement.id, b.placement.id))
  const ps = list.map((x) => x.placement)
  // Koordinaten: Objekt vor Liegeplatz
  const withCoords = ps.find((p) => hasCoords(p))
  const geo = hasCoords(object) ? { lat: object.lat, lon: object.lon, geoQuality: 'objekt' } : withCoords ? { lat: withCoords.lat, lon: withCoords.lon, geoQuality: withCoords.geoQuality || 'liegeplatz' } : null
  // Zeitfenster: Schnittmenge (spätester Beginn, frühestes Ende)
  const froms = ps.map((p) => p.window?.from).filter(isTime).sort()
  const tos = ps.map((p) => p.window?.to).filter(isTime).sort()
  const from = froms[froms.length - 1] || ''
  const to = tos[0] || ''
  const notes = [...new Set(ps.map((p) => text(p.window?.note)).filter(Boolean))]
  const items = []
  for (const { placement: p, jobs } of list) {
    const sorted = [...jobs].sort((a, b) => jobDate(a).localeCompare(jobDate(b)) || String(a.key).localeCompare(String(b.key)))
    const job = sorted[sorted.length - 1] // jüngster Einsatz; ältere offene werden mit erledigt (ein Wechsel)
    const also = sorted.slice(0, -1).map((j) => j.key)
    const mats = p.mats?.length ? p.mats : [null]
    for (const m of mats) {
      items.push({
        jobKey: job.key,
        ...(also.length ? { alsoJobKeys: also } : {}),
        placementId: p.id,
        placementName: text(p.name),
        floor: text(p.floor),
        access: text(p.access),
        hint: text(p.hint),
        mat: matCopy(m),
        planned: m ? Math.max(0, Math.round(Number(m.qty) || 0)) : 0,
        actual: null,
        status: 'geplant',
        due: job.due || jobDate(job),
        ...(sorted.some((j) => jobDate(j) < date) ? { overdue: true } : {}),
      })
    }
  }
  const mats = new Map()
  for (const it of items) {
    if (!it.mat) continue
    const k = matKey(it.mat)
    if (!mats.has(k)) mats.set(k, { ...it.mat, qty: 0 })
    mats.get(k).qty += it.planned
  }
  const first = ps[0]
  return {
    id: '',
    objectId: objectId || '',
    objectName: text(object?.name) || (objectId ? '' : text(first.name)),
    customer: customerOf(first, byCustomer),
    address: text(object?.address),
    ...(geo ? geo : {}),
    window: from || to ? { from, to } : null,
    ...(notes.length ? { windowNote: notes.join(' · ') } : {}),
    ...(from && to && from >= to ? { windowConflict: true } : {}),
    workMinutes: ps.reduce((s, p) => s + (Number.isFinite(Number(p.workMinutes)) && p.workMinutes !== '' && p.workMinutes !== null && p.workMinutes !== undefined ? Number(p.workMinutes) : workMinutes), 0),
    demand: items.reduce((s, it) => s + it.planned, 0),
    areaId: mostCommon(ps.map((p) => p.areaId)),
    mats: [...mats.values()].sort((a, b) => byName(a.size, b.size) || byName(a.color, b.color) || byName(a.name, b.name)),
    status: 'geplant',
    items,
  }
}

/**
 * Stopps eines Tages aus den Einsätzen: offene Einsätze (TOUR_JOB_STATUS) mit Termin an diesem Tag (fällig, verschoben,
 * nachzuholen) und – mit overdue (Vorgabe) – ältere offene, die noch in keiner Tour sind. Mehrere Liegeplätze desselben
 * Objekts (und Kunden) = ein Stopp: Arbeitsminuten summiert (fehlt sie am Liegeplatz: workMinutes), Zeitfenster =
 * Schnittmenge (leer → windowConflict), Matten je Mattentyp summiert. Kunde als Kopie (aus customers der Fakturierung,
 * wenn lesbar, mit Lieferschein-Mail; sonst die Kopie am Liegeplatz), Adresse und Koordinaten vom Objekt, sonst
 * Koordinaten vom Liegeplatz. Hat ein Liegeplatz mehrere offene Einsätze, gibt es ihn einmal (jobKey = jüngster,
 * alsoJobKeys = ältere). exclude: Schlüssel, die schon in anderen Touren stehen. Inaktive bzw. unbekannte Liegeplätze
 * fallen weg. Sortiert nach Kunde, Objekt; Stopp-ID 'st-<objectId>' (je Tour eindeutig, gleiche Eingabe → gleiche IDs).
 */
export function stopsFromJobs({ jobs = [], placements = [], objects = [], customers = null, date, overdue = true, exclude = [], workMinutes = DEFAULT_WORK_MINUTES } = {}) {
  if (!isDate(date)) return []
  const skip = new Set(exclude || [])
  const byPlacement = new Map((placements || []).map((p) => [p?.id, p]))
  const ctx = { byObject: new Map((objects || []).map((o) => [o?.id, o])), byCustomer: new Map((customers || []).map((c) => [c?.id, c])), date, workMinutes: Math.max(0, Number(workMinutes) || 0) }
  const groups = new Map()
  for (const job of jobs || []) {
    if (!TOUR_JOB_STATUS.includes(job?.status) || skip.has(job.key)) continue
    const d = jobDate(job)
    if (!(d === date || (overdue && isDate(d) && d < date))) continue
    const p = byPlacement.get(job.placementId)
    if (!p || p.active === false) continue
    const objectId = text(p.objectId)
    const key = `${objectId || `lp:${p.id}`}|${text(p.customerId)}`
    if (!groups.has(key)) groups.set(key, { key, objectId, entries: [] })
    groups.get(key).entries.push({ job, placement: p })
  }
  const stops = [...groups.values()].map((g) => ({ key: g.key, stop: buildStop(g, ctx) }))
  // IDs: st-<Objekt> (bzw. st-<Liegeplatz> ohne Objekt); teilen sich zwei Kunden ein Objekt, kommt der Kunde dazu
  const base = (x) => `st-${x.stop.objectId || x.key.split('|')[0].slice(3)}`
  const count = new Map()
  for (const x of stops) count.set(base(x), (count.get(base(x)) || 0) + 1)
  for (const x of stops) x.stop.id = count.get(base(x)) > 1 ? `${base(x)}-${x.stop.customer.id || 'ohne'}` : base(x)
  return stops.map((x) => x.stop).sort((a, b) => byName(a.customer.name, b.customer.name) || byName(a.objectName, b.objectName) || byName(a.id, b.id))
}

// ---------------------------------------------------------------- Tourvorschlag

const routingStop = (s) => ({ id: s.id, lat: s.lat, lon: s.lon, window: s.window || null, minutes: Number(s.workMinutes) || 0, demand: Number(s.demand) || 0 })
const shiftOf = (d, settings) => ({ from: d?.start || settings?.workday?.from || DEFAULT_SHIFT.start, to: d?.end || settings?.workday?.to || DEFAULT_SHIFT.end })
const capacityOf = (d) => (Number(d?.capacity) > 0 ? Number(d.capacity) : null)
const depotCopy = (d) => (d ? { name: text(d.name), address: text(d.address), ...(hasCoords(d) ? { lat: d.lat, lon: d.lon } : {}) } : null)

/**
 * Gebiete als Vorgruppierung: je Gebiet (areaId, ohne = eigene Gruppe) die Stopps und Fahrer. Fahrer mit areaId
 * (Stammgebiet) fahren ihr Gebiet; die übrigen bekommen zuerst je ein Gebiet ohne Fahrer (das mit der meisten Arbeit
 * zuerst), weitere dorthin, wo je Fahrer am meisten Arbeit liegt. Gebiete ohne Fahrer: Stopps nicht eingeplant.
 */
export function areaGroups(stops = [], drivers = []) {
  const areas = new Map()
  for (const s of stops || []) {
    const k = s.areaId || ''
    if (!areas.has(k)) areas.set(k, [])
    areas.get(k).push(s)
  }
  const work = (k) => areas.get(k).reduce((x, s) => x + (Number(s.workMinutes) || 0) + 15, 0)
  const keys = [...areas.keys()].sort((a, b) => work(b) - work(a) || byName(a, b))
  const assigned = new Map(keys.map((k) => [k, []]))
  const free = []
  for (const d of drivers || []) {
    if (d.areaId && assigned.has(d.areaId)) assigned.get(d.areaId).push(d)
    else free.push(d)
  }
  for (const k of keys) if (!assigned.get(k).length && free.length) assigned.get(k).push(free.shift())
  while (free.length && keys.length) {
    const k = keys.reduce((best, x) => (work(x) / assigned.get(x).length > work(best) / assigned.get(best).length ? x : best), keys[0])
    assigned.get(k).push(free.shift())
  }
  return keys.map((k) => ({ areaId: k, stops: areas.get(k), drivers: assigned.get(k) }))
}

/**
 * Tourvorschlag für einen Tag: { tours, unassigned [{ stopId, reason, text, stop }], provider, notice? }.
 * stops aus stopsFromJobs; drivers [{ id, name, start, end, vehicleId, capacity, areaId? }] (ohne start/end:
 * settings.workday bzw. 07:00–15:30); depot (Betriebshof { name, address, lat, lon }, sonst settings.depot);
 * provider: Name, Anbieter-Objekt oder leer (settings.routing.provider, Vorgabe 'luftlinie'; nicht eingerichtet bzw.
 * Fehler → 'luftlinie' mit notice); settings wie matten.json: { depot, workday { from, to }, routing { provider,
 * speedKmh, baseMin, detour, balance }, splitByArea (nach Gebiet trennen) }. Jede Tour bekommt eine zufällige ID
 * (newId, Vorgabe tourId) und den Status 'entwurf'; Fahrer ohne Stopp bekommen keine Tour.
 */
export async function proposeTours({ stops = [], drivers = [], depot = null, provider = null, settings = {}, date = '', newId = () => tourId(), now = new Date().toISOString(), by = '' } = {}) {
  const cfg = settings || {}
  const home = depot || cfg.depot || null
  const routing = cfg.routing || {}
  let prov = provider && typeof provider === 'object' ? provider : routingFor({ ...routing, ...(provider ? { provider } : {}) })
  let notice = prov.notice || ''
  const groups = cfg.splitByArea ? areaGroups(stops, drivers) : [{ areaId: '', stops: stops || [], drivers: drivers || [] }]
  const tours = []
  const unassigned = []
  for (const g of groups) {
    if (!g.stops.length) continue
    if (!g.drivers.length) {
      for (const s of g.stops) unassigned.push({ stopId: s.id, reason: 'gebiet', text: TOUR_REASONS.gebiet, stop: clone(s) })
      continue
    }
    const problem = { depot: home, stops: g.stops.map(routingStop), drivers: g.drivers.map((d) => ({ id: d.id, start: shiftOf(d, cfg).from, end: shiftOf(d, cfg).to, capacity: capacityOf(d) })), settings: routing }
    let res
    try {
      res = await prov.optimize(problem)
    } catch (err) {
      if (prov.name === 'luftlinie') throw err
      notice = `${prov.label || prov.name}: ${err?.message || 'Fehler'} – eingebauter Anbieter (Luftlinie).`
      prov = routingProvider('luftlinie')
      res = await prov.optimize(problem)
    }
    if (res.notice) notice = res.notice
    const byId = new Map(g.stops.map((s) => [s.id, s]))
    for (const r of res.routes || []) {
      if (!r.stops?.length) continue
      const d = g.drivers.find((x) => x.id === r.driverId) || {}
      const tourStops = r.stops.map((x) => ({ ...clone(byId.get(x.id)), times: { arrival: x.arrival, start: x.start, departure: x.departure, wait: x.wait, travel: x.travel, km: x.km } }))
      const areas = [...new Set(tourStops.map((s) => s.areaId || ''))]
      const areaId = g.areaId || (areas.length === 1 ? areas[0] : '')
      const cap = capacityOf(d)
      // Anbieter je Tour (Google bzw. OpenRouteService kann für einzelne Touren auf den eingebauten zurückfallen): Hinweis der Tour, sonst der allgemeine
      const own = r.notice !== undefined ? r.notice : notice
      tours.push({
        schema: TOUR_SCHEMA,
        id: newId(),
        date,
        driverId: d.id || r.driverId,
        driverName: text(d.name),
        ...(text(d.email) ? { driverEmail: text(d.email).toLowerCase() } : {}),
        vehicleId: text(d.vehicleId),
        ...(areaId ? { areaId } : {}),
        status: 'entwurf',
        order: tourStops.map((s) => s.id),
        route: {
          provider: r.provider || res.provider || prov.name || 'luftlinie',
          km: r.km,
          minutes: r.minutes,
          start: r.start,
          end: r.end,
          work: r.work,
          wait: r.wait,
          load: r.load,
          back: r.back,
          shift: shiftOf(d, cfg),
          ...(cap ? { capacity: cap } : {}),
          depot: depotCopy(home),
          ...(r.google ? { google: clone(r.google) } : {}),
          ...(r.ors ? { ors: clone(r.ors) } : {}),
        },
        ...(own ? { notice: own } : {}),
        stops: tourStops,
        createdAt: now,
        createdBy: by,
        updatedAt: now,
        updatedBy: by,
      })
    }
    for (const x of res.unassigned || []) unassigned.push({ stopId: x.id, reason: x.reason, text: x.text, stop: clone(byId.get(x.id)) })
  }
  const used = [...new Set(tours.map((t) => t.route.provider))]
  return { tours, unassigned, provider: used.length === 1 ? used[0] : prov.name || 'luftlinie', ...(notice ? { notice } : {}) }
}

// ---------------------------------------------------------------- Hilfen für die Tour

/** Ladeliste: Matten je Mattentyp (Größe, Farbe) über alle Stopps: [{ articleId, name, size, color, qty, stops }]. */
export function loadList(tour) {
  const rows = new Map()
  for (const s of tour?.stops || []) {
    for (const it of s.items || []) {
      if (!it.mat) continue
      const k = matKey(it.mat)
      if (!rows.has(k)) rows.set(k, { articleId: it.mat.articleId || '', name: it.mat.name || '', size: it.mat.size || '', color: it.mat.color || '', qty: 0, stops: new Set() })
      const r = rows.get(k)
      r.qty += Number(it.planned) || 0
      r.stops.add(s.id)
    }
  }
  return [...rows.values()].map((r) => ({ ...r, stops: r.stops.size })).sort((a, b) => byName(a.size, b.size) || byName(a.color, b.color) || byName(a.name, b.name))
}

const touch = (tour, change, { now = new Date().toISOString(), by = '' } = {}) => ({ ...tour, ...change, updatedAt: now, updatedBy: by })

/**
 * Stopp verschieben (Index oder Stopp-ID für from; to = Zielindex oder ID des Stopps, dessen Platz er einnimmt).
 * Liefert eine Kopie mit neuer Reihenfolge (order) und route.manual; Zeiten danach mit recalcTimes neu rechnen.
 */
export function moveStop(tour, from, to, opts = {}) {
  const stops = [...(tour?.stops || [])]
  const index = (x) => (typeof x === 'string' ? stops.findIndex((s) => s.id === x) : Number(x))
  const i = index(from)
  if (!Number.isInteger(i) || i < 0 || i >= stops.length) return tour
  let j = index(to)
  if (!Number.isInteger(j) || (typeof to === 'string' && j < 0)) return tour
  j = Math.max(0, Math.min(stops.length - 1, j))
  if (i === j) return tour
  const [s] = stops.splice(i, 1)
  stops.splice(j, 0, s)
  return touch(tour, { stops, order: stops.map((x) => x.id), route: { ...(tour.route || {}), manual: true } }, opts)
}

/**
 * Fahrer zuweisen ({ id, name, email?, vehicleId?, start?, end?, capacity? }; null = keiner): Kopie mit driverId,
 * driverName, driverEmail (für „meine Touren“ am Handy), Fahrzeug (das des Fahrers, sonst das bisherige) und
 * Arbeitszeit/Kapazität; Zeiten danach mit recalcTimes neu rechnen.
 */
export function assignDriver(tour, driver, opts = {}) {
  const route = { ...(tour?.route || {}) }
  if (driver) {
    route.shift = { from: driver.start || route.shift?.from || DEFAULT_SHIFT.start, to: driver.end || route.shift?.to || DEFAULT_SHIFT.end }
    const cap = capacityOf(driver)
    if (cap) route.capacity = cap
    else delete route.capacity
  }
  const next = touch(tour, { driverId: driver?.id || '', driverName: text(driver?.name), vehicleId: text(driver?.vehicleId) || text(tour?.vehicleId), route }, opts)
  if (text(driver?.email)) next.driverEmail = text(driver.email).toLowerCase()
  else delete next.driverEmail
  return next
}

/** Matrix über ['depot', ...Stopp-IDs] in eine nach Reihenfolge ausgerichtete umbauen ({ ids, minutes, km } oder Funktion). */
function alignMatrix(matrix, ids) {
  if (!matrix) return null
  if (typeof matrix === 'function') {
    const cells = ids.map((a) => ids.map((b) => (a === b ? { minutes: 0, km: 0 } : matrix(a, b) || null)))
    return { minutes: cells.map((row) => row.map((c) => (c ? c.minutes : null))), km: cells.map((row) => row.map((c) => (c ? c.km : null))) }
  }
  if (Array.isArray(matrix.ids)) {
    const at = new Map(matrix.ids.map((id, i) => [id, i]))
    const pick = (grid) => ids.map((a) => ids.map((b) => (at.has(a) && at.has(b) ? (grid?.[at.get(a)]?.[at.get(b)] ?? null) : null)))
    return { minutes: pick(matrix.minutes), km: pick(matrix.km) }
  }
  return matrix
}

/** Fahrzeiten der Tour über einen Anbieter: { ids: ['depot', ...Stopp-IDs], minutes, km } (für recalcTimes nach Änderungen). */
export async function tourMatrix(tour, provider = null, settings = {}) {
  const prov = provider && typeof provider === 'object' ? provider : routingFor({ ...settings, ...(provider ? { provider } : {}) })
  const stops = tour?.stops || []
  const m = await prov.matrix([tour?.route?.depot || {}, ...stops], settings)
  return { ids: ['depot', ...stops.map((s) => s.id)], minutes: m.minutes, km: m.km }
}

/**
 * Ankunftszeiten nach einer Änderung neu rechnen (Reihenfolge wie stops): Kopie mit times je Stopp und route (km,
 * minutes, start, end, work, wait, load, back). matrix: { ids, minutes, km } (tourMatrix), Funktion (a, b) → { minutes, km }
 * oder null = Luftlinie mit settings. Verstöße meldet tourProblems.
 */
export function recalcTimes(tour, matrix = null, settings = {}) {
  const stops = tour?.stops || []
  const route = tour?.route || {}
  const shift = route.shift || { from: DEFAULT_SHIFT.start, to: DEFAULT_SHIFT.end }
  const res = scheduleRoute({
    depot: route.depot || {},
    stops: stops.map(routingStop),
    driver: { start: shift.from, end: shift.to, capacity: route.capacity },
    matrix: alignMatrix(matrix, ['depot', ...stops.map((s) => s.id)]),
    settings,
  })
  const next = stops.map((s, k) => {
    const x = res.stops[k]
    return { ...s, times: { arrival: x.arrival, start: x.start, departure: x.departure, wait: x.wait, travel: x.travel, km: x.km } }
  })
  return { ...tour, stops: next, order: next.map((s) => s.id), route: { ...route, km: res.km, minutes: res.minutes, start: res.start, end: res.end, work: res.work, wait: res.wait, load: res.load, back: res.back } }
}

// ---------------------------------------------------------------- Fahrzeiten von Google bzw. OpenRouteService (E8)

/** Anbieter, deren Abschnitte an der Tour gespeichert werden (route.google bzw. route.ors). */
export const LEG_PROVIDERS = ['google', 'ors']
const legKey = (name) => (LEG_PROVIDERS.includes(name) ? name : 'google')

const sameOrder = (google, tour) => {
  const ids = (tour?.stops || []).map((s) => s.id)
  return !!google && Array.isArray(google.order) && Array.isArray(google.legs) && google.legs.length === ids.length + 1 && google.order.length === ids.length && google.order.every((id, i) => id === ids[i])
}

/**
 * Zeiten aus Abschnitten eines Anbieters ({ order, legs } für genau diese Reihenfolge): Kopie mit route.provider
 * ('google' bzw. 'ors') und den Abschnitten unter route.google bzw. route.ors; die eines anderen Anbieters fallen weg
 * (es gelten die zuletzt gerechneten).
 */
export function timesFromLegs(tour, google, settings = {}, provider = 'google') {
  const key = legKey(provider)
  const ids = ['depot', ...(tour?.stops || []).map((s) => s.id)]
  const m = legsMatrix(google.legs, settings)
  const next = recalcTimes(tour, { ids, minutes: m.minutes, km: m.km }, settings)
  const route = { ...next.route, provider: key, [key]: { order: [...google.order], legs: google.legs.map((l) => ({ seconds: l.seconds, meters: l.meters })) } }
  for (const k of LEG_PROVIDERS) if (k !== key) delete route[k]
  return { ...next, route }
}

/**
 * Zeiten nach einer Änderung von Hand – ohne Anfrage an Google bzw. OpenRouteService (die Reihenfolge bleibt, wie das
 * Büro sie gesetzt hat): passt die Reihenfolge noch zu den gespeicherten Abschnitten (route.google bzw. route.ors),
 * gelten deren Fahrzeiten (z. B. nach neuer Arbeitszeit oder wieder zurückgeschobenem Stopp); sonst Luftlinie
 * (route.provider 'luftlinie', die Abschnitte bleiben für später). Neu rechnen nur auf Klick: routeRetime.
 */
export function retimeTour(tour, settings = {}) {
  const r = tour?.route || {}
  if ((tour?.stops || []).length) {
    const keys = [...new Set([r.provider, ...LEG_PROVIDERS])].filter((k) => LEG_PROVIDERS.includes(k))
    for (const k of keys) if (sameOrder(r[k], tour)) return timesFromLegs(tour, r[k], settings, k)
  }
  const next = recalcTimes(tour, null, settings)
  return { ...next, route: { ...next.route, provider: 'luftlinie' } }
}

/** Sind die Zeiten der Tour von Google (gleiche Reihenfolge wie die gespeicherten Abschnitte)? */
export const timedByGoogle = (tour) => tour?.route?.provider === 'google' && sameOrder(tour.route.google, tour)

/** Womit die Zeiten der Tour gerechnet sind, wenn mit echten Fahrzeiten: 'google' | 'ors'; sonst ''. */
export const timedBy = (tour) => {
  const p = tour?.route?.provider
  return LEG_PROVIDERS.includes(p) && sameOrder(tour.route[p], tour) ? p : ''
}

/**
 * „Fahrzeiten neu rechnen“ (auf Klick): eine Anfrage für die feste Reihenfolge der Tour (ohne Optimierung) beim
 * Anbieter provider (Google bzw. OpenRouteService, legs), danach Ankunftszeiten wie recalcTimes. Wirft bei Fehler
 * (die Tour bleibt dann).
 */
export async function routeRetime(tour, provider, settings = {}) {
  const stops = tour?.stops || []
  if (!stops.length) return tour
  const res = await provider.legs({ depot: tour.route?.depot, stops: stops.map(routingStop), optimize: false })
  return timesFromLegs(tour, { order: stops.map((s) => s.id), legs: res.legs }, settings, provider?.name)
}

/** „Fahrzeiten mit Google neu rechnen“ (wie routeRetime). */
export const googleRetime = routeRetime

const stopLabel = (s) => [s.customer?.name, s.objectName].filter(Boolean).join(', ') || s.id

/**
 * Stopp-IDs, die in einer Tour mehrfach vorkommen: [{ id, count }]. Seit der Prüfrunde vom 9.11.2026 vergibt addStop
 * eindeutige IDs; ältere Touren können noch zwei Stopps mit derselben ID haben (zweiter Kunde am selben Objekt). Die App
 * erkennt sie beim Laden und zeigt einen Hinweis; geändert oder zusammengeführt wird nichts.
 */
export function duplicateStopIds(tour) {
  const n = new Map()
  for (const s of tour?.stops || []) n.set(s?.id, (n.get(s?.id) || 0) + 1)
  return [...n].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }))
}

/**
 * Probleme einer Tour (aus den gespeicherten Zeiten, ohne neu zu rechnen): [{ code, stopId?, text }] mit code
 * fahrer (keiner zugewiesen), koordinaten (Stopp ohne Koordinaten), zeitfenster (Arbeit nicht im Zeitfenster bzw.
 * Zeitfenster der Liegeplätze ohne Schnittmenge), arbeitszeit (Rückkehr nach dem Arbeitsende), kapazitaet (zu viele Matten),
 * stopp-id (alte Tour mit doppelter Stopp-ID, siehe duplicateStopIds).
 */
export function tourProblems(tour) {
  const out = []
  for (const d of duplicateStopIds(tour)) out.push({ code: 'stopp-id', stopId: d.id, text: `Stopp-ID ${d.id} steht ${d.count}-mal in dieser Tour (gespeichert vor der Korrektur vom 9.11.2026). Die App führt die Stopps nicht zusammen: bitte Stopps, Lieferscheine und Abrechnung dieser Tour prüfen.` })
  const r = tour?.route || {}
  // gespeicherte Zeiten sind Uhrzeiten (HH:MM): was vor dem Beginn der Tour liegt, ist nach Mitternacht (+24 Stunden)
  const begin = isTime(r.start) ? toMinutes(r.start) : isTime(r.shift?.from) ? toMinutes(r.shift.from) : 0
  const clock = (hm) => (toMinutes(hm) < begin ? toMinutes(hm) + 1440 : toMinutes(hm))
  const shown = (hm) => (toMinutes(hm) < begin ? `${hm} (nach Mitternacht)` : hm)
  if (!tour?.driverId) out.push({ code: 'fahrer', text: 'Kein Fahrer zugewiesen' })
  for (const s of tour?.stops || []) {
    if (!hasCoords(s)) out.push({ code: 'koordinaten', stopId: s.id, text: `${stopLabel(s)}: keine Koordinaten` })
    if (s.windowConflict) out.push({ code: 'zeitfenster', stopId: s.id, text: `${stopLabel(s)}: Zeitfenster der Liegeplätze überschneiden sich nicht` })
    else if (isTime(s.window?.to) && isTime(s.times?.departure) && clock(s.times.departure) > toMinutes(s.window.to)) out.push({ code: 'zeitfenster', stopId: s.id, text: `${stopLabel(s)}: fertig ${shown(s.times.departure)}, Zeitfenster bis ${s.window.to}` })
    else if (isTime(s.window?.from) && isTime(s.times?.start) && clock(s.times.start) < toMinutes(s.window.from)) out.push({ code: 'zeitfenster', stopId: s.id, text: `${stopLabel(s)}: Beginn ${s.times.start}, Zeitfenster ab ${s.window.from}` })
  }
  if (isTime(r.end) && isTime(r.shift?.to) && clock(r.end) > toMinutes(r.shift.to)) out.push({ code: 'arbeitszeit', text: `Rückkehr ${shown(r.end)}, Arbeitszeit bis ${r.shift.to}` })
  const load = (tour?.stops || []).reduce((x, s) => x + (Number(s.demand) || 0), 0)
  if (Number(r.capacity) > 0 && load > Number(r.capacity)) out.push({ code: 'kapazitaet', text: `${load} Matten, Platz für ${r.capacity}` })
  return out
}
