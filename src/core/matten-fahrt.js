// Mattenwechsel: die Fahrt am Handy (P10) und der Abschluss je Stopp mit Unterschrift (P11) – rein rechnend, ohne
// Oberfläche (Tests: test/matten-fahrt.test.js). Plan: docs/MATTENWECHSEL-PLAN.md, Abschnitte 4.2, 5.1–5.3, P10/P11.
// Dieselben Rechenkerne nutzt später die Fahrerseite am Webspace (P10b) und das Büro, das daraus Einsätze und
// Fälligkeit nachführt (jobUpdatesFromTour, doneFromTours) – der Fahrer schreibt nur matten/touren/ und matten/fotos/.
//
// Tour und Stopp wie in core/matten-tour.js (Tourvorschlag, P8); dazu kommen beim Fahren:
//   Tour   status: freigegeben → unterwegs (startTour: startedAt, startedBy) → abgeschlossen (alle Stopps fertig:
//          finishedAt); driverEmail (Kopie aus den Stammdaten: Fahrer lesen die Mitarbeitenden nicht).
//   Stopp  status: geplant → unterwegs (Navigation gestartet) → in-bearbeitung (erster Liegeplatz bestätigt) →
//          abgeschlossen | teilweise | nicht-angetroffen | nicht-durchgefuehrt (abgeleitet aus den Liegeplätzen);
//          beim Abschluss (finishStop): finishedAt (ISO), finishedBy (Name), driverId, signature { name, role, svg, at }
//          oder unsigned { reason, at }, confirmation ('unterschrieben' | 'ohne-unterschrift'), outcome? (gewählte
//          Ausnahme), note (Bemerkung zum Stopp), totals { planned, actual }, deviations [Abweichung],
//          deliveryNote { state: 'offen' } (Merker für den Lieferschein, P12); updatedAt/By je Stopp (Zusammenführen);
//          corrections [{ at, by, reason, before }] (Korrektur im Büro).
//   Matte  items[i] (je Liegeplatz und Mattentyp): status geplant | gewechselt | nicht-moeglich, actual (Ist-Menge),
//          reason (nicht möglich), time (ISO). Bemerkung und Fotos je Liegeplatz am ersten Eintrag des Liegeplatzes
//          (note, photos [{ name, path, at, by, size?, queued?, url?, local? }]).
//
// Fotos: matten/fotos/<Jahr>/<placementId>/<Datum>_<TourId>_<NN>.jpg (photoPath).

import { TOUR_STATUS, STOP_STATUS } from './matten-tour.js'

export { TOUR_STATUS, STOP_STATUS }
export const ITEM_STATUS = { geplant: 'offen', gewechselt: 'gewechselt', 'nicht-moeglich': 'nicht möglich' }
/** Offene Stopps (der Fahrer arbeitet daran) und fertige (für den Fahrer fest, Korrektur nur im Büro). */
export const OPEN_STOP = ['geplant', 'unterwegs', 'in-bearbeitung']
export const FINAL_STOP = ['abgeschlossen', 'teilweise', 'nicht-angetroffen', 'nicht-durchgefuehrt']
/** Erlaubte Statusübergänge je Stopp (fertige nur über reopenStop im Büro). */
export const STOP_FLOW = {
  geplant: ['unterwegs', 'in-bearbeitung', ...FINAL_STOP],
  unterwegs: ['geplant', 'in-bearbeitung', ...FINAL_STOP],
  'in-bearbeitung': ['unterwegs', ...FINAL_STOP],
  abgeschlossen: [],
  teilweise: [],
  'nicht-angetroffen': [],
  'nicht-durchgefuehrt': [],
}
/** Erlaubte Statusübergänge je Tour (Entwurf und Freigabe macht das Büro, P9). */
export const TOUR_FLOW = { entwurf: ['freigegeben'], freigegeben: ['entwurf', 'unterwegs'], unterwegs: ['abgeschlossen'], abgeschlossen: ['unterwegs'] }
/** Ausnahmen beim Abschluss: offene Liegeplätze werden mit diesem Grund „nicht möglich“. */
export const OUTCOMES = { 'nicht-angetroffen': 'Kunde nicht angetroffen', teilweise: 'Teilweise erledigt', 'nicht-durchgefuehrt': 'Nicht durchgeführt' }
const OUTCOME_REASON = { 'nicht-angetroffen': 'Kunde nicht angetroffen', teilweise: 'nicht erledigt', 'nicht-durchgefuehrt': 'nicht durchgeführt' }
/** Vorschläge für „Nicht möglich“ (frei ergänzbar). */
export const NOT_POSSIBLE_REASONS = ['kein Zugang', 'Kunde nicht angetroffen', 'Matte nicht vorhanden', 'Liegeplatz belegt (Baustelle, Umbau)', 'Kunde wünscht keinen Wechsel']
/** Vorschläge für „ohne Unterschrift“. */
export const UNSIGNED_REASONS = ['niemand vor Ort', 'Kunde nicht angetroffen', 'keine Zeit beim Kunden', 'Bestätigung folgt per E-Mail']
export const SIGNER_ROLES = ['Kunde', 'Hausbetreuung', 'Portier', 'Hausverwaltung', 'Filialleitung']
/** Touren, die Fahrer sehen (Entwurf sieht nur das Büro). */
export const DRIVER_TOUR_STATUS = ['freigegeben', 'unterwegs']

const text = (v) => String(v ?? '').trim()
const lower = (v) => text(v).toLowerCase()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const int = (v) => Math.max(0, Math.round(Number(v) || 0))
const later = (a, b) => String(a || '') > String(b || '')

// Formatierer je Zeitzone einmal anlegen (neu angelegt kostet er ein Vielfaches des Formatierens; Listen über alle Stopps)
const FORMATS = new Map()
const formatter = (kind, timeZone) => {
  const key = `${kind}|${timeZone}`
  if (!FORMATS.has(key)) FORMATS.set(key, kind === 'tag' ? new Intl.DateTimeFormat('sv-SE', { timeZone }) : new Intl.DateTimeFormat('de-AT', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  return FORMATS.get(key)
}
// Ergebnis je Zeitpunkt gemerkt (dieselben Abschlusszeiten kommen in jeder Auswertung der Touren wieder)
const SEEN = new Map()
function formatted(kind, iso, timeZone) {
  const key = `${kind}|${timeZone}|${iso}`
  let out = SEEN.get(key)
  if (out === undefined) {
    const t = Date.parse(iso || '')
    out = Number.isFinite(t) ? formatter(kind, timeZone).format(new Date(t)) : ''
    if (SEEN.size >= 200_000) SEEN.clear()
    SEEN.set(key, out)
  }
  return out
}
/** Tag eines Zeitpunkts in Wien (YYYY-MM-DD); ohne gültigen Zeitpunkt ''. */
export function localDate(iso, timeZone = 'Europe/Vienna') {
  return formatted('tag', iso, timeZone)
}
/** Uhrzeit eines Zeitpunkts in Wien (HH:MM). */
export function localTime(iso, timeZone = 'Europe/Vienna') {
  return formatted('zeit', iso, timeZone)
}

export const isFinal = (stop) => FINAL_STOP.includes(stop?.status)
export const isOpenStop = (stop) => !isFinal(stop)
export const stopLocked = isFinal
export const canMoveStop = (from, to) => (STOP_FLOW[from || 'geplant'] || []).includes(to)
export const canMoveTour = (from, to) => (TOUR_FLOW[from] || []).includes(to)

// ---------------------------------------------------------------- Wer fährt welche Tour

/** IDs der Mitarbeitenden mit dieser E-Mail (Konto → Person; nur wer die Stammdaten liest, kennt sie). */
export function employeeIdsFor(employees = [], email = '') {
  const e = lower(email)
  if (!e) return []
  return (employees || []).filter((x) => lower(x?.email) === e).map((x) => x.id)
}

/** Fährt diese Person die Tour? Über die E-Mail an der Tour (driverEmail) oder die ID aus den Stammdaten. */
export function isMyTour(tour, { email = '', employeeIds = [] } = {}) {
  if (!tour?.driverId && !tour?.driverEmail) return false
  if (tour.driverEmail && lower(tour.driverEmail) === lower(email) && lower(email)) return true
  return !!tour.driverId && (employeeIds || []).includes(tour.driverId)
}

const tourDate = (t) => (isDate(t?.date) ? t.date : '')

/**
 * Touren für die Ansicht, sortiert: vergangene offene zuerst (past: true, Hinweis), dann nach Datum und Fahrer.
 *  office: alle Touren außer Entwürfen (Mitschauen); sonst nur eigene (isMyTour) mit Status freigegeben/unterwegs.
 *  today, days: heute bis heute + days (Vorgabe 7); abgeschlossene nur von heute (zum Nachsehen), vergangene nur offene.
 *  all: true = Fahrer-Filter weglassen (Browser-Modus ohne Anmeldung).
 * Liefert [{ tour, past, finished }].
 */
export function toursFor(tours = [], { email = '', employeeIds = [], office = false, all = false, today, days = 7, back = 7 } = {}) {
  if (!isDate(today)) return []
  const until = addDaysIso(today, days)
  const since = addDaysIso(today, -back)
  const out = []
  for (const tour of tours || []) {
    const d = tourDate(tour)
    if (!d || !tour?.status || tour.status === 'entwurf') continue
    if (!office && !all && !isMyTour(tour, { email, employeeIds })) continue
    const finished = tour.status === 'abgeschlossen'
    const past = d < today && !finished
    if (d > until) continue
    if (finished && !(office ? d >= since : d === today)) continue
    if (!finished && !office && !DRIVER_TOUR_STATUS.includes(tour.status)) continue
    out.push({ tour, past, finished })
  }
  return out.sort((a, b) => Number(b.past) - Number(a.past) || Number(a.finished) - Number(b.finished) || tourDate(a.tour).localeCompare(tourDate(b.tour)) || String(a.tour.driverName || '').localeCompare(String(b.tour.driverName || ''), 'de') || String(a.tour.id).localeCompare(String(b.tour.id)))
}

function addDaysIso(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
}

/** Hinweis, wenn der Fahrer die Tour nicht sehen kann (kein Fahrer, keine E-Mail): '' wenn alles passt. */
export function driverProblem(tour) {
  if (!tour?.driverId) return 'Kein Fahrer zugewiesen.'
  // Fahrer ohne Konto: die Tour steht auf der Fahrerseite am Webspace (P10b, core/matten-webspace.js)
  if (/^[a-f0-9]{64}$/.test(String(tour.webspace?.hash || ''))) return ''
  if (!tour.driverEmail) return `${tour.driverName || 'Der Fahrer'} hat keine E-Mail in den Stammdaten: Die App erkennt die Tour am Handy nicht als seine.`
  return ''
}

// ---------------------------------------------------------------- Reihenfolge, Fortschritt

/** Stopps in der gespeicherten Reihenfolge (order; fehlende hinten in der Reihenfolge von stops). */
export function orderedStops(tour) {
  const stops = tour?.stops || []
  const at = new Map((tour?.order || []).map((id, i) => [id, i]))
  return stops
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (at.has(a.s.id) ? at.get(a.s.id) : 1e6 + a.i) - (at.has(b.s.id) ? at.get(b.s.id) : 1e6 + b.i))
    .map((x) => x.s)
}

/** Nächster offener Stopp nach afterId (sonst der erste offene; ältere übersprungene kommen am Ende dran); null = alle fertig. */
export function nextOpenStop(tour, afterId = '') {
  const list = orderedStops(tour)
  const i = afterId ? list.findIndex((s) => s.id === afterId) : -1
  const rest = [...list.slice(i + 1), ...list.slice(0, Math.max(0, i + 1))]
  return rest.find((s) => isOpenStop(s) && s.id !== afterId) || null
}

/** Fortschritt der Tour: Stopps gesamt, fertig, offen, nächster offener Stopp, Matten geplant/gewechselt. */
export function tourProgress(tour) {
  const stops = orderedStops(tour)
  const done = stops.filter(isFinal).length
  let planned = 0
  let actual = 0
  for (const s of stops) for (const it of s.items || []) {
    planned += int(it.planned)
    if (it.status === 'gewechselt') actual += actualOf(it)
  }
  return { stops: stops.length, done, open: stops.length - done, next: nextOpenStop(tour), planned, actual, finished: stops.length > 0 && done === stops.length }
}

// ---------------------------------------------------------------- Liegeplätze im Stopp

const actualOf = (it) => (it.actual === null || it.actual === undefined || it.actual === '' ? int(it.planned) : int(it.actual))

/** Abweichung eines Eintrags: Ist − Soll (gewechselt), −Soll (nicht möglich), sonst 0. */
export function itemDeviation(it) {
  if (it?.status === 'gewechselt') return actualOf(it) - int(it.planned)
  if (it?.status === 'nicht-moeglich') return -int(it.planned)
  return 0
}

/** Status eines Liegeplatzes aus seinen Matten: geplant | gewechselt | nicht-moeglich | teilweise (gemischt). */
function placementStatus(items) {
  const st = new Set(items.map((it) => it.status || 'geplant'))
  if (st.size === 1) return [...st][0]
  if (st.has('geplant')) return st.has('gewechselt') || st.has('nicht-moeglich') ? 'teilweise' : 'geplant'
  return 'teilweise'
}

/**
 * Liegeplätze eines Stopps (Matten je Liegeplatz zusammengefasst, Reihenfolge wie items):
 * [{ placementId, placementName, floor, access, hint, lead (Index des ersten Eintrags), indexes, items, status,
 *    planned, actual, deviation, reason, note, photos, time }].
 */
export function placementsOf(stop) {
  const map = new Map()
  ;(stop?.items || []).forEach((it, i) => {
    const k = it.placementId || `#${i}`
    if (!map.has(k)) map.set(k, { placementId: it.placementId || '', placementName: it.placementName || '', floor: it.floor || '', access: it.access || '', hint: it.hint || '', lead: i, indexes: [], items: [] })
    const p = map.get(k)
    p.indexes.push(i)
    p.items.push(it)
  })
  return [...map.values()].map((p) => {
    const lead = p.items[0]
    const status = placementStatus(p.items)
    return {
      ...p,
      status,
      planned: p.items.reduce((s, it) => s + int(it.planned), 0),
      actual: p.items.reduce((s, it) => s + (it.status === 'gewechselt' ? actualOf(it) : 0), 0),
      deviation: p.items.reduce((s, it) => s + itemDeviation(it), 0),
      reason: p.items.find((it) => it.status === 'nicht-moeglich' && it.reason)?.reason || '',
      note: text(lead.note),
      photos: lead.photos || [],
      time: p.items.map((it) => it.time || '').sort().at(-1) || '',
    }
  })
}

/** Abweichungen eines Stopps je Matte: [{ placementId, placementName, mat, planned, actual, diff, status, reason }]. */
export function stopDeviations(stop) {
  const out = []
  for (const it of stop?.items || []) {
    const diff = itemDeviation(it)
    if (!diff && it.status !== 'nicht-moeglich') continue
    out.push({ placementId: it.placementId || '', placementName: it.placementName || '', mat: it.mat ? { ...it.mat } : null, planned: int(it.planned), actual: it.status === 'gewechselt' ? actualOf(it) : 0, diff, status: it.status, ...(it.reason ? { reason: it.reason } : {}) })
  }
  return out
}

/**
 * Status des Stopps aus den Liegeplätzen: alle gewechselt → abgeschlossen; gemischt → teilweise; keiner gewechselt →
 * nicht-angetroffen (alle mit Grund „Kunde nicht angetroffen“) bzw. nicht-durchgefuehrt; noch offene → in-bearbeitung,
 * sobald einer erledigt ist, sonst der bisherige (geplant/unterwegs).
 */
export function derivedStopStatus(stop) {
  const items = stop?.items || []
  const open = items.filter((it) => (it.status || 'geplant') === 'geplant')
  const done = items.filter((it) => it.status === 'gewechselt')
  if (!items.length) return OPEN_STOP.includes(stop?.status) ? stop.status : 'geplant'
  if (open.length) {
    if (open.length < items.length) return 'in-bearbeitung'
    return OPEN_STOP.includes(stop?.status) ? stop.status || 'geplant' : 'geplant'
  }
  if (done.length === items.length) return 'abgeschlossen'
  if (done.length) return 'teilweise'
  return items.every((it) => it.reason === OUTCOME_REASON['nicht-angetroffen']) ? 'nicht-angetroffen' : 'nicht-durchgefuehrt'
}

/** Vorgeschlagener Abschluss: der abgeleitete Status, solange alles erledigt ist; sonst '' (Ausnahme wählen). */
export function suggestedOutcome(stop) {
  const st = derivedStopStatus(stop)
  return FINAL_STOP.includes(st) ? st : ''
}

// ---------------------------------------------------------------- Ändern (Kopien; Zeitstempel je Stopp)

const stamp = ({ now = new Date().toISOString(), by = '' } = {}) => ({ updatedAt: now, updatedBy: by })

/** Tour nach einer Änderung am Stopp: freigegebene Tour gilt als gestartet, alle fertig → abgeschlossen. */
export function normalizeTourStatus(tour, opts = {}) {
  const stops = tour?.stops || []
  const done = stops.length && stops.every(isFinal)
  const touched = stops.some((s) => s.status && s.status !== 'geplant')
  let next = tour
  if (done && ['freigegeben', 'unterwegs'].includes(tour.status)) {
    const last = stops.map((s) => s.finishedAt || '').sort().at(-1) || opts.now || new Date().toISOString()
    next = { ...tour, status: 'abgeschlossen', finishedAt: last, ...(tour.startedAt ? {} : { startedAt: opts.now || last, startedBy: opts.by || '' }) }
  } else if (!done && tour.status === 'abgeschlossen') {
    next = { ...tour, status: 'unterwegs' }
    delete next.finishedAt
  } else if (touched && tour.status === 'freigegeben') next = { ...tour, status: 'unterwegs', startedAt: opts.now || new Date().toISOString(), startedBy: opts.by || '' }
  return next
}

/**
 * Stopp ändern: fn(Kopie des Stopps) → neuer Stopp. Fertige Stopps sind fest (Fehler), außer force (Büro).
 * Setzt updatedAt/By am Stopp und an der Tour; leitet den Status aus den Liegeplätzen ab (offene Stopps).
 */
export function updateStop(tour, stopId, fn, opts = {}) {
  const stops = tour?.stops || []
  const i = stops.findIndex((s) => s.id === stopId)
  if (i < 0) throw new Error('Stopp nicht gefunden.')
  const before = stops[i]
  if (isFinal(before) && !opts.force) throw new Error('Der Stopp ist abgeschlossen. Korrigieren kann nur das Büro.')
  if (tour.status === 'entwurf') throw new Error('Die Tour ist noch nicht freigegeben.')
  let next = fn(clone(before))
  if (!opts.keepStatus && !isFinal(next)) {
    // alles erfasst heißt noch nicht abgeschlossen: das macht finishStop (Unterschrift bzw. Grund)
    const derived = derivedStopStatus(next)
    const st = OPEN_STOP.includes(derived) ? derived : 'in-bearbeitung'
    if (st !== next.status) next = { ...next, status: st }
  }
  if (same(next, before)) return tour
  next = { ...next, ...stamp(opts) }
  const list = [...stops]
  list[i] = next
  return normalizeTourStatus({ ...tour, stops: list, ...stamp(opts) }, opts)
}

const stopOf = (tour, stopId) => (tour?.stops || []).find((s) => s.id === stopId) || null
const indexesOf = (stop, placementId) => (stop.items || []).map((it, i) => (it.placementId === placementId ? i : -1)).filter((i) => i >= 0)

function mapItems(stop, placementId, fn) {
  const idx = new Set(indexesOf(stop, placementId))
  if (!idx.size) throw new Error('Liegeplatz nicht im Stopp.')
  return { ...stop, items: stop.items.map((it, i) => (idx.has(i) ? fn(it, i) : it)) }
}

/** Tour starten (freigegeben → unterwegs; startedAt, startedBy). */
export function startTour(tour, opts = {}) {
  if (tour?.status === 'unterwegs') return tour
  if (!canMoveTour(tour?.status, 'unterwegs')) throw new Error(tour?.status === 'abgeschlossen' ? 'Die Tour ist schon abgeschlossen.' : 'Die Tour ist noch nicht freigegeben.')
  return { ...tour, status: 'unterwegs', startedAt: opts.now || new Date().toISOString(), startedBy: opts.by || '', ...stamp(opts) }
}

/** Status eines offenen Stopps setzen (z. B. unterwegs beim Navigieren, in-bearbeitung beim Ankommen). */
export function setStopStatus(tour, stopId, status, opts = {}) {
  const s = stopOf(tour, stopId)
  if (!s) throw new Error('Stopp nicht gefunden.')
  if (s.status === status) return tour
  if (!OPEN_STOP.includes(status)) throw new Error('Abschließen geht über finishStop.')
  if (!canMoveStop(s.status, status)) throw new Error(`Vom Status „${STOP_STATUS[s.status] || s.status}“ nicht nach „${STOP_STATUS[status] || status}“.`)
  // in Bearbeitung mit erledigten Liegeplätzen bleibt in Bearbeitung
  if (status !== 'in-bearbeitung' && (s.items || []).some((it) => (it.status || 'geplant') !== 'geplant')) return tour
  return updateStop(tour, stopId, (x) => ({ ...x, status }), { ...opts, keepStatus: true })
}

/** Liegeplatz gewechselt: alle Matten des Liegeplatzes, Ist = Soll bzw. die vorher mit Plus/Minus eingestellte Menge. */
export function confirmPlacement(tour, stopId, placementId, opts = {}) {
  const now = opts.now || new Date().toISOString()
  return updateStop(tour, stopId, (s) => mapItems(s, placementId, (it) => {
    const preset = it.status !== 'nicht-moeglich' && it.actual !== null && it.actual !== undefined && it.actual !== ''
    const next = { ...it, status: 'gewechselt', actual: preset ? int(it.actual) : int(it.planned), time: it.status === 'gewechselt' && it.time ? it.time : now }
    delete next.reason
    return next
  }), { ...opts, now })
}

/**
 * Ist-Menge einer Matte (Index im Stopp) setzen. Noch offen: nur vorbelegt (gilt mit „Gewechselt“); schon gewechselt:
 * neue Ist-Menge (Abweichung zum Soll wird markiert); vorher „nicht möglich“: jetzt gewechselt.
 */
export function setQuantity(tour, stopId, index, qty, opts = {}) {
  const now = opts.now || new Date().toISOString()
  return updateStop(tour, stopId, (s) => {
    const it = s.items?.[index]
    if (!it) throw new Error('Matte nicht im Stopp.')
    const open = (it.status || 'geplant') === 'geplant'
    const next = open ? { ...it, actual: int(qty) } : { ...it, status: 'gewechselt', actual: int(qty), time: it.status === 'gewechselt' && it.time ? it.time : now }
    if (!open) delete next.reason
    const items = [...s.items]
    items[index] = next
    return { ...s, items }
  }, { ...opts, now })
}

/** Plus/Minus: Menge um delta ändern (ausgehend von der eingetragenen Menge, sonst vom Soll; nie unter 0). */
export function changeQuantity(tour, stopId, index, delta, opts = {}) {
  const it = stopOf(tour, stopId)?.items?.[index]
  if (!it) throw new Error('Matte nicht im Stopp.')
  const base = it.actual === null || it.actual === undefined || it.actual === '' ? int(it.planned) : int(it.actual)
  return setQuantity(tour, stopId, index, Math.max(0, base + Number(delta || 0)), opts)
}

/** Eingestellte Menge einer Matte (vorbelegt bzw. Ist), sonst das Soll – für die Anzeige am Plus/Minus. */
export const shownQuantity = (it) => (it?.status === 'nicht-moeglich' ? 0 : it?.actual === null || it?.actual === undefined || it?.actual === '' ? int(it?.planned) : int(it.actual))

/** Liegeplatz nicht möglich (mit Grund): alle Matten des Liegeplatzes, Ist 0. */
export function markNotPossible(tour, stopId, placementId, reason, opts = {}) {
  const r = text(reason)
  if (!r) throw new Error('Bitte einen Grund angeben.')
  const now = opts.now || new Date().toISOString()
  return updateStop(tour, stopId, (s) => mapItems(s, placementId, (it) => ({ ...it, status: 'nicht-moeglich', actual: 0, reason: r, time: now })), { ...opts, now })
}

/** Liegeplatz wieder offen (Eingabe zurücknehmen, solange der Stopp offen ist). */
export function resetPlacement(tour, stopId, placementId, opts = {}) {
  return updateStop(tour, stopId, (s) => {
    const next = mapItems(s, placementId, (it) => {
      const x = { ...it, status: 'geplant', actual: null }
      delete x.reason
      delete x.time
      return x
    })
    // nichts mehr erledigt: zurück auf den Status vor der Bearbeitung
    if (next.items.every((it) => (it.status || 'geplant') === 'geplant') && next.status === 'in-bearbeitung') next.status = 'unterwegs'
    return next
  }, { ...opts, keepStatus: false })
}

/** Bemerkung zum Liegeplatz (am ersten Eintrag des Liegeplatzes). */
export function setPlacementNote(tour, stopId, placementId, note, opts = {}) {
  return updateStop(tour, stopId, (s) => {
    const [lead] = indexesOf(s, placementId)
    if (lead === undefined) throw new Error('Liegeplatz nicht im Stopp.')
    const items = [...s.items]
    const n = text(note)
    items[lead] = { ...items[lead], ...(n ? { note: n } : {}) }
    if (!n) delete items[lead].note
    return { ...s, items }
  }, { ...opts, keepStatus: true })
}

/** Bemerkung zum Stopp (vor dem Abschluss). */
export function setStopNote(tour, stopId, note, opts = {}) {
  return updateStop(tour, stopId, (s) => {
    const n = text(note)
    const x = { ...s, ...(n ? { note: n } : {}) }
    if (!n) delete x.note
    return x
  }, { ...opts, keepStatus: true })
}

/** Foto zum Liegeplatz ({ name, path, at, by, size?, queued?, url?, local? }; gleicher Pfad wird ersetzt). */
export function addPlacementPhoto(tour, stopId, placementId, photo, opts = {}) {
  if (!photo?.path) throw new Error('Foto ohne Pfad.')
  return updateStop(tour, stopId, (s) => {
    const [lead] = indexesOf(s, placementId)
    if (lead === undefined) throw new Error('Liegeplatz nicht im Stopp.')
    const items = [...s.items]
    const list = (items[lead].photos || []).filter((p) => p.path !== photo.path)
    items[lead] = { ...items[lead], photos: [...list, { ...photo }] }
    return { ...s, items }
  }, { ...opts, keepStatus: true })
}

/** Foto entfernen (nur am offenen Stopp). */
export function removePlacementPhoto(tour, stopId, placementId, path, opts = {}) {
  return updateStop(tour, stopId, (s) => {
    const [lead] = indexesOf(s, placementId)
    if (lead === undefined) throw new Error('Liegeplatz nicht im Stopp.')
    const items = [...s.items]
    items[lead] = { ...items[lead], photos: (items[lead].photos || []).filter((p) => p.path !== path) }
    return { ...s, items }
  }, { ...opts, keepStatus: true })
}

const uploaded = (photo, url) => {
  const next = { ...photo, ...(url ? { url } : {}) }
  delete next.queued
  return next
}

/** Hochgeladene Fotos vermerken (aus der Warteschlange nachgeholt): queued weg, url dazu. done: [[Pfad, url]]. */
export function markPhotosUploaded(tour, done = []) {
  const urls = new Map(done)
  let changed = false
  const stops = (tour?.stops || []).map((s) => {
    let touched = false
    const items = (s.items || []).map((it) => {
      if (!(it.photos || []).some((p) => urls.has(p.path) && p.queued)) return it
      touched = changed = true
      return { ...it, photos: it.photos.map((p) => (urls.has(p.path) && p.queued ? uploaded(p, urls.get(p.path)) : p)) }
    })
    return touched ? { ...s, items } : s
  })
  return changed ? { ...tour, stops } : tour
}

// ---------------------------------------------------------------- Fotos

const pad2 = (n) => String(n).padStart(2, '0')
/** Nächste Nummer für ein Foto des Liegeplatzes in dieser Tour (über alle Stopps). */
export function nextPhotoNumber(tour, placementId) {
  let max = 0
  for (const s of tour?.stops || []) for (const it of s.items || []) for (const p of it.photos || []) {
    if (it.placementId !== placementId) continue
    const m = String(p.name || p.path || '').match(/_(\d{2,})\.\w+$/)
    max = Math.max(max, m ? Number(m[1]) : 0)
  }
  return max + 1
}

/** Pfad eines Fotos: matten/fotos/<Jahr>/<placementId>/<Datum>_<TourId>_<NN>.jpg (Datum = Tag der Aufnahme). */
export function photoPath({ tour, placementId, date, n, ext = 'jpg' }) {
  const d = isDate(date) ? date : tour?.date
  if (!isDate(d)) throw new Error('Foto ohne Datum.')
  const safe = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe(placementId) || !safe(tour?.id)) throw new Error('Foto ohne Liegeplatz oder Tour.')
  return `matten/fotos/${d.slice(0, 4)}/${safe(placementId)}/${d}_${safe(tour.id)}_${pad2(Math.max(1, Number(n) || 1))}.${safe(ext) || 'jpg'}`
}

// ---------------------------------------------------------------- Abschluss des Stopps (P11)

/**
 * Prüfung vor dem Abschluss ('' = in Ordnung): alle Liegeplätze bestätigt oder eine Ausnahme gewählt; „Teilweise
 * erledigt“ braucht mindestens einen gewechselten; Unterschrift mit Name und Strich oder „ohne Unterschrift“ mit Grund
 * (bei „Kunde nicht angetroffen“ ist der Grund vorbelegt).
 */
export function finishProblem(stop, { signature = null, reason = '', outcome = '' } = {}) {
  if (!stop) return 'Stopp nicht gefunden.'
  if (isFinal(stop)) return 'Der Stopp ist schon abgeschlossen.'
  if (outcome && !OUTCOMES[outcome]) return 'Unbekannte Ausnahme.'
  const open = placementsOf(stop).filter((p) => p.items.some((it) => (it.status || 'geplant') === 'geplant'))
  if (open.length && !outcome) return `Noch offen: ${open.map((p) => p.placementName || 'Liegeplatz').join(', ')}. Bitte bestätigen, „Nicht möglich“ wählen oder eine Ausnahme angeben.`
  const oc = open.length ? outcome : ''
  const anyDone = (stop.items || []).some((it) => it.status === 'gewechselt')
  if (oc === 'teilweise' && !anyDone) return 'Für „Teilweise erledigt“ mindestens einen Liegeplatz als gewechselt bestätigen – sonst „Nicht durchgeführt“ wählen.'
  if (signature) {
    if (!text(signature.name)) return 'Bitte den Namen der Person eintragen, die unterschreibt.'
    if (!signature.svg) return 'Bitte im Feld „Unterschrift“ unterschreiben lassen.'
    return ''
  }
  if (!text(reason) && !defaultUnsigned(stop, oc)) return 'Bitte angeben, warum ohne Unterschrift abgeschlossen wird.'
  return ''
}

/** Grund ohne Unterschrift, wenn keiner eingetragen ist: bei „Kunde nicht angetroffen“ dieser, sonst ''. */
function defaultUnsigned(stop, outcome) {
  if (outcome === 'nicht-angetroffen') return OUTCOMES['nicht-angetroffen']
  if (!outcome && derivedStopStatus(stop) === 'nicht-angetroffen') return OUTCOMES['nicht-angetroffen']
  return ''
}

/**
 * Stopp abschließen: offene Liegeplätze bekommen bei einer Ausnahme den Grund (nicht möglich), Status aus den
 * Liegeplätzen (abgeschlossen, teilweise, nicht angetroffen, nicht durchgeführt). Gespeichert: finishedAt (ISO),
 * finishedBy, driverId, signature { name, role, svg, at } oder unsigned { reason, at }, confirmation, outcome?, note,
 * totals { planned, actual }, deviations, deliveryNote { state: 'offen' } (Lieferschein entsteht später, P12).
 * Danach ist der Stopp für den Fahrer fest. Liefert die neue Tour (alle Stopps fertig → Tour abgeschlossen).
 */
export function finishStop(tour, stopId, { signature = null, reason = '', outcome = '', note, now = new Date().toISOString(), by = '', driverId = '' } = {}) {
  const stop = stopOf(tour, stopId)
  const problem = finishProblem(stop, { signature, reason, outcome })
  if (problem) throw new Error(problem)
  const oc = (stop.items || []).some((it) => (it.status || 'geplant') === 'geplant') ? outcome : ''
  return updateStop(tour, stopId, (s) => {
    const fill = oc ? OUTCOME_REASON[oc] : ''
    const items = (s.items || []).map((it) => ((it.status || 'geplant') === 'geplant' ? { ...it, status: 'nicht-moeglich', actual: 0, reason: fill, time: now } : it))
    const x = { ...s, items }
    const status = derivedStopStatus(x)
    const n = note === undefined ? text(s.note) : text(note)
    // nach einer Korrektur im Büro (reopenStop) bleibt der Wechsel am ersten Abschluss mit gewechselten Matten: Tag und
    // Preis des Lieferscheins, Fälligkeit und Bestand hängen daran; wann korrigiert wurde, steht in corrections bzw.
    // signature/unsigned.at. War damals nichts gewechselt (z. B. nicht angetroffen), gilt der neue Abschluss.
    const first = (s.corrections || []).find((c) => ['abgeschlossen', 'teilweise'].includes(c?.before?.status) && c.before.finishedAt)?.before.finishedAt
    const out = {
      ...x,
      status,
      finishedAt: first || now,
      finishedBy: by,
      ...(driverId || tour.driverId ? { driverId: driverId || tour.driverId } : {}),
      signature: signature ? { name: text(signature.name), role: text(signature.role), svg: signature.svg, at: now } : null,
      unsigned: signature ? null : { reason: text(reason) || defaultUnsigned(stop, oc), at: now },
      confirmation: signature ? 'unterschrieben' : 'ohne-unterschrift',
      ...(oc ? { outcome: oc } : {}),
      totals: { planned: items.reduce((a, it) => a + int(it.planned), 0), actual: items.reduce((a, it) => a + (it.status === 'gewechselt' ? actualOf(it) : 0), 0) },
      deviations: stopDeviations({ items }),
      // ein schon erstellter Lieferschein (P12) bleibt; „kein Lieferschein“ gilt nach einer Korrektur nicht mehr
      deliveryNote: ['erstellt', 'versendet'].includes(s.deliveryNote?.state) ? s.deliveryNote : { state: 'offen' },
    }
    if (n) out.note = n
    else delete out.note
    if (!oc) delete out.outcome
    return out
  }, { now, by, keepStatus: true })
}

/** Darf das Büro den Stopp wieder öffnen? '' = ja. Ein schon erstellter Lieferschein (P12) sperrt. */
export function reopenProblem(stop) {
  if (!stop) return 'Stopp nicht gefunden.'
  if (!isFinal(stop)) return 'Der Stopp ist noch offen.'
  if (['erstellt', 'versendet'].includes(stop.deliveryNote?.state)) return 'Zu diesem Stopp gibt es schon einen Lieferschein. Bitte dort korrigieren.'
  return ''
}

/**
 * Korrektur im Büro: abgeschlossenen Stopp wieder öffnen (in Bearbeitung). Der bisherige Abschluss (Status,
 * Unterschrift bzw. Grund, Zeitpunkt) bleibt in corrections[] nachvollziehbar; die Eingaben je Liegeplatz bleiben.
 */
export function reopenStop(tour, stopId, { reason = '', now = new Date().toISOString(), by = '' } = {}) {
  const stop = stopOf(tour, stopId)
  const problem = reopenProblem(stop)
  if (problem) throw new Error(problem)
  if (!text(reason)) throw new Error('Bitte den Grund der Korrektur angeben.')
  return updateStop(tour, stopId, (s) => {
    const before = { status: s.status, finishedAt: s.finishedAt || '', finishedBy: s.finishedBy || '', confirmation: s.confirmation || '', signature: s.signature || null, unsigned: s.unsigned || null, ...(s.outcome ? { outcome: s.outcome } : {}) }
    const x = { ...s, status: 'in-bearbeitung', corrections: [...(s.corrections || []), { at: now, by, reason: text(reason), before }] }
    for (const k of ['finishedAt', 'finishedBy', 'signature', 'unsigned', 'confirmation', 'outcome', 'totals', 'deviations']) delete x[k]
    return x
  }, { now, by, force: true, keepStatus: true })
}

// ---------------------------------------------------------------- Für das Büro: Einsätze und Fälligkeit nachführen

/** Tag des Wechsels eines Stopps: Abschluss (Wien), sonst Datum der Tour. */
const stopDay = (tour, stop) => localDate(stop?.finishedAt) || tourDate(tour)

/**
 * Ergebnisse der abgeschlossenen Stopps für die Einsätze (matten/einsaetze-<Jahr>.json schreibt das Büro):
 * je Einsatz-Schlüssel (jobKey und alsoJobKeys – ein Wechsel erledigt auch ältere offene Einsätze des Liegeplatzes)
 * [{ key, status: 'erledigt' | 'teilweise' | 'nachzuholen', date, actual, planned, placementId, tourId, stopId,
 *    mats [{ articleId, planned, actual }], reason?, also? }]. erledigt = alle Matten gewechselt, mindestens Soll;
 * teilweise = etwas gewechselt; nachzuholen = nichts gewechselt (nicht möglich, nicht angetroffen). Offene Stopps fehlen.
 */
export function jobUpdatesFromTour(tour) {
  const out = []
  for (const stop of orderedStops(tour)) {
    if (!isFinal(stop)) continue
    const byKey = new Map()
    for (const it of stop.items || []) {
      if (!it.jobKey) continue
      if (!byKey.has(it.jobKey)) byKey.set(it.jobKey, { also: new Set(), items: [] })
      const g = byKey.get(it.jobKey)
      g.items.push(it)
      for (const k of it.alsoJobKeys || []) g.also.add(k)
    }
    for (const [key, g] of byKey) {
      const planned = g.items.reduce((s, it) => s + int(it.planned), 0)
      const actual = g.items.reduce((s, it) => s + (it.status === 'gewechselt' ? actualOf(it) : 0), 0)
      const exchanged = g.items.filter((it) => it.status === 'gewechselt' && actualOf(it) > 0)
      const all = g.items.every((it) => it.status === 'gewechselt' && actualOf(it) >= int(it.planned))
      const status = exchanged.length && all ? 'erledigt' : exchanged.length ? 'teilweise' : 'nachzuholen'
      const reason = status === 'nachzuholen' ? g.items.find((it) => it.reason)?.reason || STOP_STATUS[stop.status] || '' : ''
      const base = { status, date: stopDay(tour, stop), actual, planned, placementId: g.items[0].placementId || '', tourId: tour.id || '', stopId: stop.id, mats: g.items.map((it) => ({ articleId: it.mat?.articleId || '', planned: int(it.planned), actual: it.status === 'gewechselt' ? actualOf(it) : 0 })), ...(reason ? { reason } : {}) }
      out.push({ key, ...base })
      for (const k of g.also) if (k !== key) out.push({ key: k, ...base, also: true })
    }
  }
  return out
}

/** Bestätigte Wechsel aus den Touren für den Fälligkeitsrechner (matten-plan.js, done): [{ placementId, date }]. */
export function doneFromTours(tours = []) {
  const seen = new Set()
  const out = []
  for (const tour of tours || []) {
    for (const stop of tour?.stops || []) {
      if (!isFinal(stop)) continue
      const date = stopDay(tour, stop)
      if (!isDate(date)) continue
      for (const it of stop.items || []) {
        if (it.status !== 'gewechselt' || actualOf(it) <= 0 || !it.placementId) continue
        const k = `${it.placementId}|${date}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ placementId: it.placementId, date })
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.placementId.localeCompare(b.placementId))
}

// ---------------------------------------------------------------- Zusammenführen (gleichzeitige Änderungen)

const TOP_SKIP = new Set(['stops', 'order', 'updatedAt', 'updatedBy'])

/**
 * Zusammenführen je Stopp (Drei-Wege, base = gemeinsamer Stand): Hat nur eine Seite einen Stopp geändert, gilt ihre
 * Fassung; haben beide ihn geändert, gewinnt für diesen Stopp, wer ihn zuletzt geändert hat (updatedAt am Stopp, bei
 * Gleichstand mine). Neue Stopps beider Seiten bleiben; ein auf einer Seite entfernter Stopp bleibt nur, wenn die andere
 * ihn geändert hat. Felder der Tour ebenso je Feld (beide geändert: die neuere Tour). Reihenfolge: geänderte Seite;
 * danach Status der Tour passend zu den Stopps (alle fertig → abgeschlossen).
 */
export function mergeTour(base, mine, theirs) {
  if (!theirs) return clone(mine)
  if (!mine) return clone(theirs)
  const b = base || {}
  const mineNewer = !later(theirs.updatedAt, mine.updatedAt)
  const out = {}
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(b)])
  for (const k of keys) {
    if (TOP_SKIP.has(k)) continue
    const m = mine[k]
    const t = theirs[k]
    const v = same(m, b[k]) ? t : same(t, b[k]) ? m : mineNewer ? m : t
    if (v !== undefined) out[k] = clone(v)
  }
  // Stopps je ID; alte Touren mit doppelter Stopp-ID (duplicateStopIds): der zweite „st-o1“ zählt als eigener Stopp,
  // so geht beim Zusammenführen keiner verloren (zusammengelegt wird nichts)
  const nth = (ids) => {
    const n = new Map()
    return ids.map((id) => (n.set(id, (n.get(id) || 0) + 1), n.get(id) > 1 ? `${id}\u0000${n.get(id)}` : id))
  }
  const keyed = (stops) => {
    const keys = nth((stops || []).map((s) => s.id))
    return (stops || []).map((s, i) => [keys[i], s])
  }
  const bs = new Map(keyed(b.stops))
  const ms = new Map(keyed(mine.stops))
  const ts = new Map(keyed(theirs.stops))
  const pick = (id) => {
    const bb = bs.get(id)
    const m = ms.get(id)
    const t = ts.get(id)
    if (m && t) return same(m, bb) ? t : same(t, bb) ? m : later(t.updatedAt, m.updatedAt) ? t : m
    if (m) return bb && same(m, bb) ? null : m // auf der anderen Seite entfernt: nur behalten, wenn hier geändert
    if (t) return bb && same(t, bb) ? null : t
    return null
  }
  const order = same(mine.order, b.order) ? theirs.order : mine.order
  const ids = [...new Set([...nth(order || []), ...ms.keys(), ...ts.keys()])]
  const stops = ids.map(pick).filter(Boolean).map(clone)
  const has = new Set(stops.map((s) => s.id))
  out.stops = stops
  if (order) out.order = [...order.filter((id) => has.has(id)), ...stops.map((s) => s.id).filter((id) => !order.includes(id))]
  const newer = later(theirs.updatedAt, mine.updatedAt) ? theirs : mine
  if (newer.updatedAt !== undefined) out.updatedAt = newer.updatedAt
  if (newer.updatedBy !== undefined) out.updatedBy = newer.updatedBy
  return normalizeTourStatus(out, { now: out.updatedAt, by: out.updatedBy })
}
