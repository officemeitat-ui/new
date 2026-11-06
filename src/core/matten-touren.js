// Mattenwechsel: Tourenplanung im Büro (Paket P9, docs/MATTENWECHSEL-PLAN.md). Reine Funktionen ohne Oberfläche
// (Tests: test/matten-touren.test.js); Ansicht: ui/views/matten-planung.js, Ablage: storage/matten-tourablage.js.
// Baut auf dem Tourvorschlag core/matten-tour.js (P8) und den Einsätzen core/matten-einsaetze.js (P7) auf.
//
// Was hier steht:
//  - Ablage: Ordner und Jahre der Tour-Dateien (matten/touren/<Jahr>/<TourId>.json, tourFileName aus matten-tour.js)
//  - Zusammenführen bei gleichzeitiger Änderung (mergeOfficeTour – die eine Stelle, an der später mergeTour aus
//    core/matten-fahrt.js eingesetzt wird) und die Sperre, sobald die Tour unterwegs ist
//  - Bearbeiten einer Tour: Stopp entfernen, hinzufügen (gleiches Objekt → derselbe Stopp), in eine andere Tour,
//    Fahrzeug und Arbeitszeit, leere Tour
//  - Freigabe: Prüfung (Fahrer, Stopps, Tag, kein Einsatz in zwei Touren, Einsätze noch offen), Status setzen,
//    Einsätze der Stopps auf 'in-tour' mit tourId und beim Zurücknehmen bzw. Löschen wieder frei
//  - Fahrer des Mattenwechsels (settings.drivers in matten/matten.json: schmale Kopie aus den Mitarbeitenden,
//    das Büro liest die Stammdaten nicht), Betriebshof (settings.depot)
//  - Ladeliste des Tages, Google-Maps-Link mit Wegpunkten
//
// Zusätzliche Felder der Tour (zu Abschnitt 4.2): vehicleLabel (Kennzeichen und Bezeichnung als Kopie; Fahrer lesen den
// Fuhrpark nicht), driverEmail (Kopie, damit die Fahreransicht „meine Touren“ erkennt), releasedAt/releasedBy.
// Einsatz in einer Tour: status 'in-tour', tourId, beforeTour (Status davor: geplant, nachzuholen, nicht-durchgefuehrt).

import { hasCoords } from './geo.js'
import { TOUR_JOB_STATUS, TOUR_SCHEMA, tourFileName, tourId as newTourId } from './matten-tour.js'
import { DEFAULT_SHIFT } from './routing.js'

export const TOUR_DIR = 'matten/touren'
/** Diese Stände schreibt das Büro; ab 'unterwegs' gehört die Tour dem Fahrer. */
export const OFFICE_STATUS = ['entwurf', 'freigegeben']
export const LOCKED_STATUS = ['unterwegs', 'abgeschlossen']

const text = (v) => String(v ?? '').trim()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const touch = (tour, change, { now = new Date().toISOString(), by = '' } = {}) => ({ ...tour, ...change, updatedAt: now, updatedBy: by })
const dmy = (d) => (isDate(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '')

// ---------------------------------------------------------------- Ablage

/** Tour-Datei? matten/touren/<Jahr>/<Name>.json */
export const isTourPath = (p) => /^matten\/touren\/\d{4}\/[A-Za-z0-9_-]+\.json$/.test(String(p || ''))
/** Ordner eines Jahres. */
export const tourDir = (year) => `${TOUR_DIR}/${year}`
/** Jahr aus dem Pfad einer Tour-Datei ('' wenn keiner). */
export const yearOfPath = (p) => (isTourPath(p) ? String(p).split('/')[2] : '')
/** Jahre, deren Ordner für den Zeitraum gelesen werden (je Jahr des Tour-Datums). */
export function tourYears(von, bis = von) {
  const a = Number(String(von).slice(0, 4))
  const b = Number(String(bis || von).slice(0, 4))
  if (!a || !b) return []
  const out = []
  for (let y = Math.min(a, b); y <= Math.max(a, b) && out.length < 10; y++) out.push(String(y))
  return out
}
/** Pfad der Tour (wie tourFileName, ohne Fehler: '' bei ungültiger Tour). */
export function pathOfTour(tour) {
  try {
    return tourFileName(tour)
  } catch {
    return ''
  }
}

/** Touren eines Tages, nach Fahrer und Anlage sortiert. */
export const toursOn = (tours = [], date) => (tours || []).filter((t) => t?.date === date).sort((a, b) => byName(a.driverName, b.driverName) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))
/** Darf das Büro die Tour bearbeiten (Reihenfolge, Stopps, Fahrer)? Nur Entwürfe; freigegebene erst nach „Freigabe zurücknehmen“. */
export const editableByOffice = (tour) => tour?.status === 'entwurf'
/** Gehört die Tour dem Fahrer (unterwegs oder abgeschlossen)? Dann ändert das Büro nichts mehr. */
export const lockedForOffice = (tour) => LOCKED_STATUS.includes(tour?.status)

/** Alle Einsatz-Schlüssel einer Tour (je Liegeplatz der jüngste und die älteren offenen, alsoJobKeys). */
export function tourJobKeys(tour) {
  const out = new Set()
  for (const s of tour?.stops || []) for (const it of s.items || []) for (const k of [it.jobKey, ...(it.alsoJobKeys || [])]) if (k) out.add(k)
  return [...out]
}

/**
 * Einsätze, die schon in einer Tour stehen und darum nicht in einen neuen Vorschlag kommen: Schlüssel aller Touren
 * außer except (IDs, z. B. die Entwürfe, die ein neuer Vorschlag ersetzt). Entwürfe vergangener Tage (vor today)
 * halten nichts fest – ein liegen gebliebener Entwurf versteckt keinen überfälligen Einsatz.
 */
export function keysInTours(tours = [], { except = [], today = '' } = {}) {
  const skip = new Set(except)
  const out = new Set()
  for (const t of tours || []) {
    if (!t || skip.has(t.id)) continue
    if (t.status === 'entwurf' && today && t.date < today) continue
    for (const k of tourJobKeys(t)) out.add(k)
  }
  return out
}

// ---------------------------------------------------------------- Zusammenführen (eine Stelle)

/** Die Tour ist inzwischen unterwegs bzw. abgeschlossen: das Büro schreibt nicht mehr hinein. */
export class TourLockedError extends Error {
  constructor(tour) {
    super(`Die Tour ist schon ${tour?.status === 'abgeschlossen' ? 'abgeschlossen' : 'unterwegs'} – das Büro ändert sie nicht mehr (Korrektur einzelner Stopps folgt).`)
    this.name = 'TourLockedError'
    this.tour = tour
  }
}

// Felder, die zusammen gelten: die Reihenfolge der Stopps mit ihren Zeiten und der Summe der Route
const ROUTE_FIELDS = ['stops', 'order', 'route']
const STAMP_FIELDS = ['updatedAt', 'updatedBy']

/**
 * Gleichzeitige Änderung derselben Tour (Speichern mit eTag schlug fehl): base = Stand beim Lesen, mine = eigene
 * Fassung, theirs = Stand in SharePoint. Ist die Tour dort schon unterwegs oder abgeschlossen → TourLockedError.
 * Sonst je Feld: was ich geändert habe, gilt; sonst das Gespeicherte. Stopps, Reihenfolge und Route zählen als ein
 * Feld (meine Reihenfolge ganz oder ihre ganz). Ohne bekannte Basis gilt meine Fassung.
 * Hier wird später mergeTour(base, mine, theirs) aus core/matten-fahrt.js eingesetzt (je Stopp zusammenführen).
 */
export function mergeOfficeTour(base, mine, theirs) {
  if (lockedForOffice(theirs)) throw new TourLockedError(theirs)
  if (!theirs) return clone(mine)
  if (!base) return { ...clone(mine) }
  const out = clone(theirs)
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(base || {})])
  for (const k of keys) {
    if (ROUTE_FIELDS.includes(k) || STAMP_FIELDS.includes(k)) continue
    if (same(mine[k], base[k])) continue
    if (mine[k] === undefined) delete out[k]
    else out[k] = clone(mine[k])
  }
  if (ROUTE_FIELDS.some((k) => !same(mine[k], base[k]))) for (const k of ROUTE_FIELDS) out[k] = clone(mine[k])
  for (const k of STAMP_FIELDS) if (mine[k] !== undefined) out[k] = mine[k]
  return out
}

// ---------------------------------------------------------------- Stopps bearbeiten

const matKey = (m = {}) => m.articleId || `${text(m.size)}|${text(m.color)}|${text(m.name)}`

/** Summen eines Stopps aus seinen Liegeplätzen neu: Matten je Typ und Gesamtzahl. */
function sumMats(items) {
  const mats = new Map()
  for (const it of items) {
    if (!it.mat) continue
    const k = matKey(it.mat)
    if (!mats.has(k)) mats.set(k, { ...it.mat, qty: 0 })
    mats.get(k).qty += Number(it.planned) || 0
  }
  return { mats: [...mats.values()].sort((a, b) => byName(a.size, b.size) || byName(a.color, b.color) || byName(a.name, b.name)), demand: items.reduce((s, it) => s + (Number(it.planned) || 0), 0) }
}

/** Zwei Stopps desselben Objekts und Kunden zu einem: Liegeplätze zusammen, Arbeitszeit addiert, Zeitfenster geschnitten. */
export function mergeStops(a, b) {
  const has = (it) => a.items.some((x) => x.jobKey === it.jobKey && x.placementId === it.placementId && same(x.mat, it.mat))
  const added = (b.items || []).filter((it) => !has(it))
  const items = [...(a.items || []), ...added]
  const newPlacements = new Set(added.map((it) => it.placementId))
  const known = new Set((a.items || []).map((it) => it.placementId))
  const extraWork = [...newPlacements].some((id) => !known.has(id)) ? Number(b.workMinutes) || 0 : 0
  const froms = [a.window?.from, b.window?.from].filter(isTime).sort()
  const tos = [a.window?.to, b.window?.to].filter(isTime).sort()
  const from = froms.at(-1) || ''
  const to = tos[0] || ''
  const notes = [...new Set([a.windowNote, b.windowNote].map(text).filter(Boolean))]
  const out = { ...clone(a), items: clone(items), workMinutes: (Number(a.workMinutes) || 0) + extraWork, ...sumMats(items), window: from || to ? { from, to } : null }
  if (notes.length) out.windowNote = notes.join(' · ')
  else delete out.windowNote
  if (from && to && from >= to) out.windowConflict = true
  else delete out.windowConflict
  if (!hasCoords(out) && hasCoords(b)) Object.assign(out, { lat: b.lat, lon: b.lon, geoQuality: b.geoQuality })
  return out
}

const sameObject = (a, b) => a.id === b.id || (!!a.objectId && a.objectId === b.objectId && (a.customer?.id || '') === (b.customer?.id || ''))

/** Stopp aus der Tour nehmen (Kopie; Zeiten danach mit recalcTimes neu rechnen). */
export function removeStop(tour, stopId, opts = {}) {
  const stops = (tour?.stops || []).filter((s) => s.id !== stopId)
  if (stops.length === (tour?.stops || []).length) return tour
  return touch(tour, { stops, order: stops.map((s) => s.id), route: { ...(tour.route || {}), manual: true } }, opts)
}

/**
 * Stopp in die Tour (Kopie): gibt es dort schon einen Stopp desselben Objekts und Kunden, kommen die Liegeplätze
 * dazu (ein Stopp je Objekt); sonst an Stelle index (Vorgabe: ans Ende). Zeiten danach mit recalcTimes.
 */
export function addStop(tour, stop, { index, ...opts } = {}) {
  const stops = [...(tour?.stops || [])]
  const fresh = clone(stop)
  delete fresh.times
  const at = stops.findIndex((s) => sameObject(s, fresh))
  if (at >= 0) stops[at] = mergeStops(stops[at], fresh)
  else {
    const i = Number.isInteger(index) ? Math.max(0, Math.min(stops.length, index)) : stops.length
    stops.splice(i, 0, { ...fresh, status: fresh.status || 'geplant' })
  }
  return touch(tour, { stops, order: stops.map((s) => s.id), route: { ...(tour.route || {}), manual: true } }, opts)
}

/** Stopp von einer Tour in eine andere: { from, to } (Kopien; beide danach mit recalcTimes neu rechnen). */
export function transferStop(from, to, stopId, opts = {}) {
  const stop = (from?.stops || []).find((s) => s.id === stopId)
  if (!stop || from.id === to?.id) return { from, to }
  return { from: removeStop(from, stopId, opts), to: addStop(to, stop, opts) }
}

/** Bezeichnung eines Fahrzeugs aus dem Fuhrpark: „S-123AB · Transporter“. */
export const vehicleLabel = (v) => (v ? [text(v.plate), text(v.label)].filter(Boolean).join(' · ') : '')

/** Fahrzeug setzen (Fuhrpark-Eintrag oder null): vehicleId und vehicleLabel als Kopie. */
export function setVehicle(tour, vehicle, opts = {}) {
  const next = touch(tour, { vehicleId: text(vehicle?.id) }, opts)
  const label = vehicleLabel(vehicle)
  if (label) next.vehicleLabel = label
  else delete next.vehicleLabel
  return next
}

/** Arbeitszeit und Kapazität der Tour (von, bis 'HH:MM'; capacity Matten, leer = ohne Grenze). */
export function setShift(tour, { from, to, capacity } = {}, opts = {}) {
  const route = { ...(tour?.route || {}) }
  route.shift = { from: isTime(from) ? from : route.shift?.from || DEFAULT_SHIFT.start, to: isTime(to) ? to : route.shift?.to || DEFAULT_SHIFT.end }
  if (Number(capacity) > 0) route.capacity = Math.round(Number(capacity))
  else delete route.capacity
  return touch(tour, { route }, opts)
}

const depotCopy = (d) => (d ? { name: text(d.name), address: text(d.address), ...(hasCoords(d) ? { lat: d.lat, lon: d.lon } : {}) } : null)

/**
 * Leere Tour (Entwurf) für einen Fahrer, z. B. um Stopps von Hand einzuplanen. driver wie in den Einstellungen
 * ({ id, name, email, start, end, capacity }), vehicle aus dem Fuhrpark (oder null), depot = Betriebshof.
 */
export function newTour({ date, driver = null, vehicle = null, depot = null, settings = {}, newId = () => newTourId(), now = new Date().toISOString(), by = '' } = {}) {
  const shift = { from: driver?.start || settings?.workday?.from || DEFAULT_SHIFT.start, to: driver?.end || settings?.workday?.to || DEFAULT_SHIFT.end }
  const cap = Number(driver?.capacity) > 0 ? Math.round(Number(driver.capacity)) : null
  const tour = {
    schema: TOUR_SCHEMA,
    id: newId(),
    date,
    driverId: text(driver?.id),
    driverName: text(driver?.name),
    ...(text(driver?.email) ? { driverEmail: text(driver.email).toLowerCase() } : {}),
    vehicleId: text(vehicle?.id),
    ...(vehicleLabel(vehicle) ? { vehicleLabel: vehicleLabel(vehicle) } : {}),
    status: 'entwurf',
    order: [],
    route: { provider: 'luftlinie', km: 0, minutes: 0, start: shift.from, end: shift.from, work: 0, wait: 0, load: 0, back: { travel: 0, km: 0 }, shift, ...(cap ? { capacity: cap } : {}), depot: depotCopy(depot || settings?.depot), manual: true },
    stops: [],
    createdAt: now,
    createdBy: by,
    updatedAt: now,
    updatedBy: by,
  }
  return tour
}

// ---------------------------------------------------------------- Freigabe

const placementLabel = (tour, key) => {
  for (const s of tour?.stops || []) for (const it of s.items || []) if (it.jobKey === key || (it.alsoJobKeys || []).includes(key)) return [it.placementName, s.objectName || s.customer?.name].filter(Boolean).join(', ')
  return key
}
const JOB_TEXT = { erledigt: 'schon erledigt', teilweise: 'schon (teilweise) erledigt', ausgesetzt: 'ausgesetzt', verworfen: 'verworfen' }

/**
 * Darf die Tour freigegeben werden? Liste der Gründe dagegen [{ code, text, key? }] (leer = ja). Geprüft: Status
 * Entwurf, Fahrer, mindestens ein Stopp, Tag ab heute, kein Einsatz in einer anderen Tour (tours: alle bekannten,
 * frisch geladen), jeder Einsatz noch offen und nicht in einer anderen Tour (jobs: alle geladenen Einsätze).
 */
export function releaseProblems({ tour, tours = [], jobs = [], today = '' } = {}) {
  const out = []
  if (!tour) return [{ code: 'tour', text: 'Diese Tour gibt es nicht mehr.' }]
  if (tour.status !== 'entwurf') out.push({ code: 'status', text: tour.status === 'freigegeben' ? 'Die Tour ist schon freigegeben.' : 'Die Tour ist schon unterwegs bzw. abgeschlossen.' })
  if (!tour.driverId) out.push({ code: 'fahrer', text: 'Bitte zuerst einen Fahrer zuweisen.' })
  if (!(tour.stops || []).length) out.push({ code: 'stopps', text: 'Die Tour hat keinen Stopp.' })
  if (today && tour.date < today) out.push({ code: 'tag', text: 'Touren für vergangene Tage lassen sich nicht mehr freigeben.' })
  const mine = tourJobKeys(tour)
  const reported = new Set()
  for (const other of tours || []) {
    if (!other || other.id === tour.id) continue
    const theirs = new Set(tourJobKeys(other))
    for (const k of mine) {
      if (!theirs.has(k) || reported.has(k)) continue
      reported.add(k)
      const who = other.driverName || 'ohne Fahrer'
      const state = other.status === 'entwurf' ? 'Entwurf' : other.status
      out.push({ code: 'doppelt', key: k, tourId: other.id, text: `${placementLabel(tour, k)}: steht schon in der Tour von ${who} am ${dmy(other.date)} (${state}). Dort zuerst entfernen.` })
    }
  }
  const byKey = new Map((jobs || []).map((j) => [j.key, j]))
  for (const k of mine) {
    if (reported.has(k)) continue
    const j = byKey.get(k)
    if (!j) {
      out.push({ code: 'einsatz', key: k, text: `${placementLabel(tour, k)}: Einsatz nicht gefunden (inzwischen gelöscht?). Stopp entfernen und neu einplanen.` })
      continue
    }
    if (j.status === 'in-tour' && j.tourId && j.tourId !== tour.id) {
      out.push({ code: 'doppelt', key: k, tourId: j.tourId, text: `${placementLabel(tour, k)}: ist schon in einer anderen freigegebenen Tour.` })
      continue
    }
    if (!TOUR_JOB_STATUS.includes(j.status) && j.status !== 'in-tour') out.push({ code: 'offen', key: k, text: `${placementLabel(tour, k)}: Einsatz ist ${JOB_TEXT[j.status] || j.status}.` })
  }
  return out
}

/** Tour freigeben (Kopie): Status 'freigegeben', wer und wann; driver (aus den Einstellungen) ergänzt die E-Mail-Kopie. */
export function releaseTour(tour, { now = new Date().toISOString(), by = '', driver = null } = {}) {
  const next = touch(tour, { status: 'freigegeben', releasedAt: now, releasedBy: by }, { now, by })
  const mail = text(driver?.email || tour.driverEmail).toLowerCase()
  if (mail) next.driverEmail = mail
  return next
}

/** Freigabe zurücknehmen (Kopie): wieder Entwurf. Nur solange die Tour nicht unterwegs ist (prüft die Ablage frisch). */
export function withdrawTour(tour, opts = {}) {
  const next = touch(tour, { status: 'entwurf' }, opts)
  delete next.releasedAt
  delete next.releasedBy
  return next
}

/**
 * Einsätze der Stopps einer freigegebenen Tour: Status 'in-tour' mit tourId; der Status davor bleibt in beforeTour
 * (für „Freigabe zurücknehmen“). Liefert nur die geänderten Einsätze (mit id = Schlüssel, für mergeJobs).
 */
export function assignJobs(jobs = [], tour, { now = new Date().toISOString(), by = '' } = {}) {
  const keys = new Set(tourJobKeys(tour))
  const out = []
  for (const j of jobs || []) {
    if (!keys.has(j.key)) continue
    if (j.status === 'in-tour' && j.tourId === tour.id) continue
    if (!TOUR_JOB_STATUS.includes(j.status)) continue
    out.push({ ...(j.id === j.key ? {} : { id: j.key }), ...j, status: 'in-tour', tourId: tour.id, beforeTour: j.status, updatedAt: now, updatedBy: by })
  }
  return out
}

/**
 * Einsätze wieder frei (Freigabe zurückgenommen, Entwurf gelöscht): alle mit status 'in-tour' und dieser tourId
 * bekommen ihren Status von vorher (beforeTour, sonst 'geplant'), ohne tourId. Liefert die geänderten Einsätze.
 */
export function freeJobs(jobs = [], tour, { now = new Date().toISOString(), by = '' } = {}) {
  const id = typeof tour === 'string' ? tour : tour?.id
  const out = []
  for (const j of jobs || []) {
    if (j.status !== 'in-tour' || j.tourId !== id) continue
    const next = { ...(j.id === j.key ? {} : { id: j.key }), ...j, status: TOUR_JOB_STATUS.includes(j.beforeTour) ? j.beforeTour : 'geplant', updatedAt: now, updatedBy: by }
    delete next.tourId
    delete next.beforeTour
    out.push(next)
  }
  return out
}

// ---------------------------------------------------------------- Anzeige

/** Ladeliste mehrerer Touren (z. B. des Tages): Zeilen von loadList je Tour zusammengezählt. */
export function sumLoadLists(lists = []) {
  const rows = new Map()
  for (const list of lists)
    for (const r of list || []) {
      const k = r.articleId || `${r.size}|${r.color}|${r.name}`
      if (!rows.has(k)) rows.set(k, { ...r, qty: 0, stops: 0 })
      rows.get(k).qty += r.qty
      rows.get(k).stops += r.stops
    }
  return [...rows.values()].sort((a, b) => byName(a.size, b.size) || byName(a.color, b.color) || byName(a.name, b.name))
}

/** Text einer Matte der Ladeliste: „85 × 150 cm, grau“ (sonst der Name). */
export const loadLabel = (r) => [r.size, r.color].filter(Boolean).join(', ') || r.name || 'Matte'

/** Höchstens so viele Wegpunkte nimmt ein Google-Maps-Link (am Handy weniger; dann je Teil ein Link). */
export const MAPS_WAYPOINTS = 9
const MAPS = 'https://www.google.com/maps/dir/?api=1'
const pointText = (p) => (hasCoords(p) ? `${p.lat},${p.lon}` : text(p?.address))

/**
 * Google-Maps-Links für die ganze Route (Betriebshof → Stopps der Reihe nach → Betriebshof): je Link Start, bis zu
 * max Wegpunkte und Ziel; mehr Stopps ergeben mehrere Teile (der nächste beginnt, wo der vorige endet). Koordinaten
 * bevorzugt, sonst die Adresse; Stopps ohne beides fehlen. Kein Schlüssel nötig. [{ url, part, parts, from, to }]
 * (from/to: Nummer des ersten und letzten Stopps im Teil, 0 = Betriebshof).
 */
export function mapsLinks(tour, { max = MAPS_WAYPOINTS } = {}) {
  const depot = tour?.route?.depot
  const pts = []
  if (pointText(depot)) pts.push({ text: pointText(depot), n: 0 })
  ;(tour?.stops || []).forEach((s, i) => pointText(s) && pts.push({ text: pointText(s), n: i + 1 }))
  if (!pts.some((p) => p.n)) return []
  if (pointText(depot)) pts.push({ text: pointText(depot), n: 0 })
  if (pts.length < 2) return []
  const per = Math.max(1, Math.round(max)) + 2
  const chunks = []
  for (let i = 0; i < pts.length - 1; i += per - 1) chunks.push(pts.slice(i, i + per))
  if (chunks.length > 1 && chunks.at(-1).length < 2) chunks.pop()
  return chunks.map((c, k) => {
    const mid = c.slice(1, -1).map((p) => p.text)
    const url = `${MAPS}&origin=${encodeURIComponent(c[0].text)}&destination=${encodeURIComponent(c.at(-1).text)}&travelmode=driving${mid.length ? `&waypoints=${encodeURIComponent(mid.join('|'))}` : ''}`
    const nums = c.map((p) => p.n).filter(Boolean)
    return { url, part: k + 1, parts: chunks.length, from: nums[0] || 0, to: nums.at(-1) || 0 }
  })
}

// ---------------------------------------------------------------- Fahrer und Betriebshof (Einstellungen)

/**
 * Fahrer des Mattenwechsels aus matten.json → settings.drivers, gesäubert: [{ id, employeeId?, name, email, start,
 * end, vehicleId, capacity, areaId, active }] nach Namen. Die Liste ist die Markierung „Mattenfahrer“: eine schmale
 * Kopie aus den Mitarbeitenden (das Büro liest die Stammdaten nicht), gepflegt im Dialog „Fahrer“.
 */
export function normalizeDrivers(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((d) => {
      const out = { id: text(d?.id), name: text(d?.name), email: text(d?.email).toLowerCase(), start: isTime(d?.start) ? d.start : '', end: isTime(d?.end) ? d.end : '', vehicleId: text(d?.vehicleId), capacity: Number(d?.capacity) > 0 ? Math.round(Number(d.capacity)) : null, areaId: text(d?.areaId), active: d?.active !== false }
      if (text(d?.employeeId)) out.employeeId = text(d.employeeId)
      return out
    })
    .filter((d) => d.id && d.name)
    .sort((a, b) => byName(a.name, b.name))
}

/** Fahrer-Liste prüfen: Text des ersten Problems oder ''. */
export function driversProblem(list = []) {
  const seen = new Set()
  for (const d of list) {
    if (!text(d.name)) return 'Bitte bei jedem Fahrer den Namen eintragen.'
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return `${d.name}: E-Mail-Adresse prüfen.`
    if ((d.start && !isTime(d.start)) || (d.end && !isTime(d.end))) return `${d.name}: Arbeitszeit als Uhrzeit (z. B. 07:00) eintragen.`
    if (d.start && d.end && d.end <= d.start) return `${d.name}: Arbeitszeit endet vor ihrem Beginn.`
    const key = d.email || d.employeeId || d.name.toLowerCase()
    if (seen.has(key)) return `${d.name} steht doppelt in der Liste.`
    seen.add(key)
  }
  return ''
}

/**
 * Fahrer eines Tages für den Vorschlag: aus den Fahrern der Einstellungen (normalizeDrivers) und der Auswahl des
 * Tages ({ [id]: { on, start, end, vehicleId, capacity } }; ohne Eintrag: dabei mit den Vorgaben). Liefert die
 * gewählten im Format von proposeTours: [{ id, name, email, start, end, vehicleId, capacity, areaId }].
 */
export function driversForDay(drivers = [], choice = {}, settings = {}) {
  const out = []
  for (const d of drivers) {
    if (d.active === false) continue
    const c = choice?.[d.id] || {}
    if (c.on === false) continue
    const start = isTime(c.start) ? c.start : d.start || settings?.workday?.from || DEFAULT_SHIFT.start
    const end = isTime(c.end) ? c.end : d.end || settings?.workday?.to || DEFAULT_SHIFT.end
    const cap = c.capacity !== undefined ? c.capacity : d.capacity
    out.push({ id: d.id, name: d.name, ...(d.email ? { email: d.email } : {}), start, end, vehicleId: c.vehicleId !== undefined ? text(c.vehicleId) : d.vehicleId, capacity: Number(cap) > 0 ? Math.round(Number(cap)) : null, ...(d.areaId ? { areaId: d.areaId } : {}) })
  }
  return out
}

/** Arbeitszeiten der gewählten Fahrer prüfen: Text des ersten Problems oder ''. */
export function dayDriversProblem(list = []) {
  if (!list.length) return 'Bitte mindestens einen Fahrer für den Tag wählen.'
  for (const d of list) if (!isTime(d.start) || !isTime(d.end) || d.end <= d.start) return `${d.name}: Arbeitszeit von–bis prüfen.`
  return ''
}

/** Betriebshof prüfen (Start und Ziel jeder Tour): Text des ersten Problems oder ''. */
export function depotProblem(depot) {
  if (!depot || (!text(depot.address) && !hasCoords(depot))) return 'Bitte zuerst den Betriebshof eintragen (Start und Ziel jeder Tour).'
  if (!hasCoords(depot)) return 'Der Betriebshof hat noch keine Koordinaten: im Dialog „Betriebshof“ „Suchen“ klicken oder die Koordinaten eintragen.'
  return ''
}

/** Kurze Zusammenfassung einer Tour für Hinweise: „Anna Fahrerin, 4 Stopps, 23 km“. */
export const tourSummary = (t) => [t?.driverName || 'ohne Fahrer', plural((t?.stops || []).length, 'Stopp', 'Stopps'), t?.route?.km ? `${String(t.route.km).replace('.', ',')} km` : ''].filter(Boolean).join(', ')
