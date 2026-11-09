// Mattenwechsel-Modul (Phase Stammdaten): Liegeplätze je Kunde → Objekt mit Matten, Intervall, Starttermin, Regel,
// Arbeitszeit, Zeitfenster, Pausen, Gebiet und Koordinaten. Reine Funktionen ohne Browser (test/matten.test.js);
// Ansicht: ui/views/matten.js, Übernahme aus dem Werkzeug: core/matten-import.js. Plan: docs/MATTENWECHSEL-PLAN.md.
//
// Fachbegriff: Liegeplatz = die konkrete Position einer Matte beim Kunden (z. B. „Haupteingang“). Das alte Werkzeug
// (werkzeuge/mattenwechsel/) nennt ihn „Standort“; in der App heißt er überall Liegeplatz.
//
// Datei matten/matten.json (Ordner matten/ für das Büro; Touren der Fahrer später unter matten/touren/):
//   { schema: 1,
//     settings: { closures: [{ from, to, reason, mode? }] (Betriebsurlaub für alle Liegeplätze), skip ('entfaellt' |
//                 'nachholen': Wechsel in einer Pause), planning: { von, bis, at, by } (letztes „Einsätze planen“) }
//                 – Planung und Kalender: core/matten-einsaetze.js; Betriebshof, Routing … ab der Tourenplanung
//     placements: [{ id, legacyId ('L-0001', nur aus der Übernahme), objectId, customerId,
//                    customer: { id, name, no }      schmale Kopie für Rollen ohne Fakturierung (Büro, Fahrer)
//                    name (Liegeplatz, z. B. „Haupteingang“), floor (Stockwerk), access (Zugang/Schlüssel), hint, active,
//                    mats: [{ articleId, qty, owner: 'wir'|'kunde', name, size?, color?, matKind?, legacy?: { groesse, farbe } }]
//                          articleId: Mattentyp = Artikel der Fakturierung mit group 'Matten' (matTypes, matLabel in
//                          core/invoicing.js); name/size/color/matKind: Kopie für Rollen ohne Fakturierung;
//                          legacy: Größe/Farbe aus dem Werkzeug, solange der Typ fehlt
//                    intervalDays (14 | 28, weitere erlaubt), startDate, rule ('rhythmus' | 'ab-ist'), workMinutes,
//                    window: { from, to, note } (Zeitfenster/Öffnungszeiten), pauses: [{ from, to, reason }],
//                    areaId (Gebiet = Tourrunde), lat, lon, geoQuality ('objekt' | 'adresse' | 'google' | 'ors' | 'hand' | 'werkzeug'),
//                    lastExchange: { date, tourId, source: 'werkzeug' } (letzter Wechsel, aus der Übernahme; zählt
//                          für den Fälligkeitsrechner als bestätigter Wechsel, doneFromPlacements),
//                    check: { reason } (aus dem Werkzeug „zu prüfen“), source: { system: 'mattenwechsel', quelle }
//                    createdAt, createdBy, updatedAt, updatedBy }],
//     areas: [{ id, name, active, legacyName?, createdAt, createdBy, updatedAt, updatedBy }] }
//
// IDs werden zufällig erzeugt (newId), nie hochgezählt: zwei Geräte legen nie dieselbe ID an.
// Fälligkeit (nächster Wechsel, Pausen) rechnet nur core/matten-plan.js; hier keine eigene Fälligkeitslogik.

import { addDays } from './dates.js'
import { matLabel, matTypes } from './invoicing.js'
import { nextDue, pauseOn, RULES as PLAN_RULES } from './matten-plan.js'

export const SCHEMA = 1
/** Vorschläge für das Intervall (Tage); andere Werte sind erlaubt. */
export const INTERVALS = [14, 28]
/** Regeln des Fälligkeitsrechners (core/matten-plan.js), hier mit kurzer Beschriftung für die Auswahl. */
export const RULES = Object.fromEntries(Object.keys(PLAN_RULES).map((k) => [k, k === 'rhythmus' ? 'fester Rhythmus' : 'ab letztem Wechsel']))
export const OWNERS = { wir: 'unsere Matte', kunde: 'Kundeneigentum' }
export const GEO = { objekt: 'vom Objekt', adresse: 'aus der Adresse (OpenStreetMap)', google: 'aus der Adresse (Google)', ors: 'aus der Adresse (OpenRouteService)', hand: 'von Hand', werkzeug: 'aus dem Werkzeug' }
/** Filter der Übersicht. */
export const STATUS_FILTERS = { '': 'alle aktiven', faellig: 'fällig in 7 Tagen', pruefen: 'zu prüfen', typ: 'Mattentyp fehlt', inaktiv: 'inaktiv' }

export const emptyMatten = () => ({ schema: SCHEMA, settings: {}, placements: [], areas: [] })

/** Datei auf den aktuellen Stand bringen (fehlende Listen, Schema). Ändert nichts an vorhandenen Einträgen. */
export function upgradeMatten(doc) {
  const d = doc || emptyMatten()
  d.schema ||= SCHEMA
  d.settings ||= {}
  d.placements ||= []
  d.areas ||= []
  return d
}

const text = (v) => String(v ?? '').trim()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))
const int = (v) => (v === '' || v === null || v === undefined ? NaN : Number(String(v).replace(',', '.')))

// ---------------------------------------------------------------- Mattentypen (Artikel der Fakturierung)

/** Matte am Liegeplatz mit Kopie von Bezeichnung, Größe, Farbe und Art des Typs (für Rollen ohne Fakturierung). */
export function matFromType(article, { qty = 1, owner = 'wir' } = {}) {
  return {
    articleId: article.id,
    qty: Math.max(1, Math.round(Number(qty) || 1)),
    owner: owner === 'kunde' ? 'kunde' : 'wir',
    name: matLabel(article),
    ...(article.size ? { size: text(article.size) } : {}),
    ...(article.color ? { color: text(article.color) } : {}),
    ...(article.matKind ? { matKind: text(article.matKind) } : {}),
  }
}

/** Anzeige einer Matte am Liegeplatz: { label, missing } – missing: Mattentyp fehlt (nur Größe/Farbe aus dem Werkzeug). */
export function matDisplay(mat = {}, articles = null) {
  const a = mat.articleId && articles ? articles.find((x) => x.id === mat.articleId) : null
  if (a) return { label: matLabel(a), missing: false }
  if (mat.articleId) return { label: text(mat.name) || 'Matte', missing: false }
  const legacy = [mat.legacy?.groesse, mat.legacy?.farbe].filter(Boolean).join(' ')
  return { label: text(mat.name) || legacy || 'Matte', missing: true }
}

/** Mattentypen zur Auswahl: aus der Fakturierung (matTypes, wenn lesbar), sonst die an Liegeplätzen schon verwendeten (Kopie). */
export function knownTypes({ articles = null, placements = [] } = {}) {
  if (articles) return matTypes(articles).map((a) => ({ id: a.id, name: matLabel(a), size: a.size || '', color: a.color || '', matKind: a.matKind || '' }))
  const seen = new Map()
  for (const p of placements) for (const m of p.mats || []) if (m.articleId && !seen.has(m.articleId)) seen.set(m.articleId, { id: m.articleId, name: text(m.name) || 'Matte', size: m.size || '', color: m.color || '', matKind: m.matKind || '' })
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

// ---------------------------------------------------------------- Kunden (Fakturierung bzw. schmale Kopie)

export const customerName = (c = {}) => text(c.name) || [c.firstName, c.lastName].map(text).filter(Boolean).join(' ') || 'Kunde'
/** Schmale Kopie am Liegeplatz: was Büro und Fahrer ohne Fakturierung sehen. */
export const customerCopy = (c) => (c ? { id: c.id, name: customerName(c), no: text(c.customerNo) } : null)

/** Kunden zur Auswahl: aus der Fakturierung (wenn lesbar), sonst die Kopien an den Liegeplätzen. [{ id, name, no }] */
export function knownCustomers({ customers = null, placements = [] } = {}) {
  if (customers) return customers.filter((c) => c.active !== false).map(customerCopy).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const seen = new Map()
  for (const p of placements) if (p.customerId && !seen.has(p.customerId)) seen.set(p.customerId, { id: p.customerId, name: p.customer?.name || 'Kunde', no: p.customer?.no || '' })
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Kunde eines Objekts laut Fakturierung (customers[].objectIds; ein Objekt gehört genau einem Kunden). */
export const customerOfObject = (customers = [], objectId) => (customers || []).find((c) => (c.objectIds || []).includes(objectId)) || null

/**
 * Kopien der Kunden an den Liegeplätzen auffrischen (nur wer die Fakturierung liest). Liefert die Anzahl geänderter
 * Liegeplätze; ändert die Liste an Ort und Stelle.
 */
export function refreshCustomerCopies(placements = [], customers = []) {
  const byId = new Map((customers || []).map((c) => [c.id, c]))
  let n = 0
  for (const p of placements) {
    const c = byId.get(p.customerId)
    if (!c) continue
    const copy = customerCopy(c)
    if (JSON.stringify(copy) !== JSON.stringify(p.customer)) {
      p.customer = copy
      n++
    }
  }
  return n
}

// ---------------------------------------------------------------- Gebiete

export const areaOf = (doc, id) => (doc?.areas || []).find((a) => a.id === id) || null
export const activeAreas = (doc) => (doc?.areas || []).filter((a) => a.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'de'))
const areaKey = (s) => text(s).toLowerCase().replace(/\s+/g, ' ')
/** Gebiet nach Namen (Groß/klein egal). */
export const areaByName = (doc, name) => (doc?.areas || []).find((a) => areaKey(a.name) === areaKey(name) || (a.legacyName && areaKey(a.legacyName) === areaKey(name))) || null

/** Gebiet prüfen: Text des ersten Problems oder ''. */
export function areaProblem(doc, { id = '', name }) {
  if (!text(name)) return 'Bitte einen Namen für das Gebiet eintragen, z. B. Salzburg Nord.'
  const other = areaByName(doc, name)
  if (other && other.id !== id) return `Das Gebiet „${other.name}“ gibt es schon.`
  return ''
}

// ---------------------------------------------------------------- Liegeplatz prüfen und speichern

/** Eingaben eines Liegeplatzes säubern (Texte getrimmt, Zahlen als Zahl, leere Felder weg). */
export function normalizePlacement(input = {}) {
  const num = (v) => (Number.isFinite(int(v)) ? int(v) : '')
  const window = { from: text(input.window?.from), to: text(input.window?.to), note: text(input.window?.note) }
  const out = {
    objectId: text(input.objectId),
    customerId: text(input.customerId),
    name: text(input.name),
    floor: text(input.floor),
    access: text(input.access),
    hint: text(input.hint),
    active: input.active !== false,
    mats: (input.mats || []).map((m) => {
      const mat = { articleId: text(m.articleId), qty: num(m.qty), owner: m.owner === 'kunde' ? 'kunde' : 'wir', name: text(m.name) }
      if (m.size) mat.size = text(m.size)
      if (m.color) mat.color = text(m.color)
      if (m.matKind) mat.matKind = text(m.matKind)
      if (!mat.articleId && m.legacy) mat.legacy = { groesse: text(m.legacy.groesse), farbe: text(m.legacy.farbe) }
      return mat
    }),
    intervalDays: num(input.intervalDays),
    startDate: text(input.startDate),
    rule: RULES[input.rule] ? input.rule : 'rhythmus',
    workMinutes: num(input.workMinutes),
    window: window.from || window.to || window.note ? window : null,
    pauses: (input.pauses || []).map((x) => ({ from: text(x.from), to: text(x.to), reason: text(x.reason) })).filter((x) => x.from || x.to || x.reason),
    areaId: text(input.areaId),
    lat: Number.isFinite(Number(input.lat)) && input.lat !== '' && input.lat !== null && input.lat !== undefined ? Number(input.lat) : null,
    lon: Number.isFinite(Number(input.lon)) && input.lon !== '' && input.lon !== null && input.lon !== undefined ? Number(input.lon) : null,
    geoQuality: GEO[input.geoQuality] ? input.geoQuality : '',
  }
  if (out.workMinutes === '') delete out.workMinutes
  if (!out.window) delete out.window
  if (out.lat === null || out.lon === null) {
    delete out.lat
    delete out.lon
    delete out.geoQuality
  }
  return out
}

/** Liegeplatz prüfen, bevor er gespeichert wird (nach normalizePlacement): Text des ersten Problems oder ''. */
export function placementProblem(p) {
  if (!p.objectId) return 'Bitte das Objekt wählen.'
  if (!p.customerId) return 'Bitte den Kunden wählen.'
  if (!p.name) return 'Bitte den Liegeplatz benennen, z. B. Haupteingang oder Stiege 2.'
  if (!p.mats?.length) return 'Bitte mindestens eine Matte eintragen.'
  for (const m of p.mats) {
    if (!m.articleId && !m.legacy) return 'Bitte bei jeder Matte den Mattentyp wählen.'
    if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > 999) return 'Die Stückzahl je Matte muss zwischen 1 und 999 liegen.'
  }
  if (!Number.isInteger(p.intervalDays) || p.intervalDays < 1 || p.intervalDays > 365) return 'Bitte das Intervall in Tagen eintragen (z. B. 14 oder 28).'
  if (!p.startDate) return p.rule === 'ab-ist' ? 'Bitte den Starttermin eintragen (erster Wechsel; danach zählt der letzte Wechsel).' : 'Bitte den Starttermin eintragen (erster Wechsel, ab dem der Rhythmus zählt).'
  if (!isDate(p.startDate)) return 'Der Starttermin ist kein gültiges Datum.'
  if (p.workMinutes !== undefined && (!Number.isInteger(p.workMinutes) || p.workMinutes < 0 || p.workMinutes > 600)) return 'Die Arbeitszeit bitte in Minuten eintragen (0 bis 600).'
  if (p.window) {
    if ((p.window.from && !isTime(p.window.from)) || (p.window.to && !isTime(p.window.to))) return 'Das Zeitfenster bitte als Uhrzeit eintragen, z. B. 07:00 bis 10:00.'
    if (p.window.from && p.window.to && p.window.from >= p.window.to) return 'Das Zeitfenster endet vor seinem Beginn.'
  }
  for (const x of p.pauses || []) {
    if (!isDate(x.from)) return 'Bitte bei jeder Pause das Datum „von“ eintragen.'
    if (x.to && (!isDate(x.to) || x.to < x.from)) return 'Eine Pause endet vor ihrem Beginn.'
  }
  if (p.lat !== undefined && (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180)) return 'Die Koordinaten liegen außerhalb des gültigen Bereichs.'
  return ''
}

/** Neuer Liegeplatz mit zufälliger ID und Anlage-Vermerk. */
export function createPlacement(fields, { newId, now, user }) {
  return { id: newId('mw'), ...fields, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }
}

/** Liegeplatz ändern: Felder ersetzen, Herkunft (legacyId, lastExchange, source, check) und Anlage bleiben. */
export function updatePlacement(existing, fields, { now, user }) {
  const out = { ...existing, ...fields, updatedAt: now, updatedBy: user }
  for (const k of ['window', 'workMinutes', 'lat', 'lon', 'geoQuality']) if (!(k in fields)) delete out[k]
  return out
}

// ---------------------------------------------------------------- Nächster Wechsel (Fälligkeitsrechner core/matten-plan.js)

/**
 * Bestätigte Wechsel aus den Liegeplätzen für den Fälligkeitsrechner: der letzte Wechsel aus der Übernahme
 * (lastExchange). Mit den Touren zusammen: confirmedExchanges in core/matten-einsaetze.js.
 */
export const doneFromPlacements = (placements = []) => (placements || []).filter((p) => p?.lastExchange?.date).map((p) => ({ placementId: p.id, date: p.lastExchange.date }))

/**
 * Nächster Wechsel eines Liegeplatzes (nextDue aus core/matten-plan.js) und ob heute eine Pause gilt:
 * { next: { date, due, key, job, overdue } | null, paused }. done/jobs/closures/skip wie im Fälligkeitsrechner: ein
 * gespeicherter offener Einsatz geht vor (verschoben: am neuen Tag), ausgesetzte und verworfene zählen nicht.
 */
export function nextOf(p, { today, done = [], jobs = [], closures = [], skip = 'entfaellt' } = {}) {
  return { next: p?.active === false ? null : nextDue(p, { done, jobs, closures, today, skip }), paused: !!pauseOn(p, today, closures) }
}

/** Zustand für die Anzeige: 'inaktiv' | 'pausiert' | 'ueberfaellig' | 'faellig' (bis 7 Tage) | 'geplant' | 'ohne' (kein Termin). */
export function nextState({ next, paused }, p, today) {
  if (p?.active === false) return 'inaktiv'
  if (paused) return 'pausiert'
  if (!next) return 'ohne'
  if (next.overdue) return 'ueberfaellig'
  if (next.date <= addDays(today, 7)) return 'faellig'
  return 'geplant'
}

/** „alle 14 Tage“, „alle 4 Wochen“ (28 Tage). */
export const intervalText = (days) => {
  const n = Number(days) || 0
  if (!n) return '–'
  return n % 7 === 0 && n >= 14 ? `alle ${n / 7} Wochen (${n} Tage)` : `alle ${n} Tage`
}

// ---------------------------------------------------------------- Liste je Kunde → Objekt

/**
 * Zeilen der Übersicht: [{ placement, object, customer: { id, name, no }, area, mats: [{ label, qty, owner, missing }],
 * qty, next (nextDue), paused, state, missingType }]. customers/articles: aus der Fakturierung, wenn lesbar (sonst null →
 * Kopien). done/jobs/closures/skip für den Fälligkeitsrechner (gespeicherte Einsätze, Betriebsurlaub); ohne done gilt
 * der letzte Wechsel aus der Übernahme.
 */
export function placementRows({ doc, objects = [], customers = null, articles = null, today, done = null, jobs = [], closures = [], skip = 'entfaellt' }) {
  const confirmed = done || doneFromPlacements(doc?.placements)
  const objById = new Map(objects.map((o) => [o.id, o]))
  const custById = new Map((customers || []).map((c) => [c.id, c]))
  return (doc?.placements || []).map((p) => {
    const c = custById.get(p.customerId)
    const customer = c ? customerCopy(c) : { id: p.customerId || '', name: p.customer?.name || (p.customerId ? 'Kunde' : 'ohne Kunde'), no: p.customer?.no || '' }
    const mats = (p.mats || []).map((m) => ({ ...matDisplay(m, articles), qty: Number(m.qty) || 0, owner: m.owner === 'kunde' ? 'kunde' : 'wir' }))
    const n = nextOf(p, { today, done: confirmed, jobs, closures, skip })
    return {
      placement: p,
      object: objById.get(p.objectId) || null,
      customer,
      area: areaOf(doc, p.areaId),
      mats,
      qty: mats.reduce((s, m) => s + m.qty, 0),
      next: n.next,
      paused: n.paused,
      state: nextState(n, p, today),
      missingType: mats.some((m) => m.missing),
    }
  })
}

/** Passt eine Zeile zum Status-Filter (STATUS_FILTERS)? Leer = alle aktiven. */
export function matchStatus(row, status = '') {
  const active = row.placement.active !== false
  if (status === 'inaktiv') return !active
  if (!active) return false
  if (status === 'faellig') return ['ueberfaellig', 'faellig'].includes(row.state)
  if (status === 'pruefen') return !!row.placement.check
  if (status === 'typ') return row.missingType
  return true
}

const norm = (s) => text(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Filter der Übersicht: Kunde, Gebiet, Status, Suchtext (Liegeplatz, Objekt, Kunde, Matte, Hinweis). */
export function filterRows(rows, { customerId = '', areaId = '', status = '', q = '' } = {}) {
  const n = norm(q)
  return rows.filter((r) => {
    if (customerId && r.customer.id !== customerId) return false
    if (areaId && (r.placement.areaId || '') !== areaId) return false
    if (!matchStatus(r, status)) return false
    if (!n) return true
    const hay = [r.placement.name, r.placement.floor, r.placement.hint, r.placement.access, r.placement.legacyId, r.object?.name, r.object?.address, r.customer.name, r.customer.no, ...r.mats.map((m) => m.label)].map(norm).join(' ')
    return hay.includes(n)
  })
}

const byName = (a, b) => (a || '').localeCompare(b || '', 'de', { numeric: true })

/** Je Kunde → Objekt: [{ customer, objects: [{ objectId, object, rows }] }], nach Namen sortiert. */
export function groupRows(rows) {
  const custs = new Map()
  for (const r of rows) {
    const key = r.customer.id || '-'
    if (!custs.has(key)) custs.set(key, { customer: r.customer, objects: new Map() })
    const g = custs.get(key)
    const ok = r.placement.objectId || '-'
    if (!g.objects.has(ok)) g.objects.set(ok, { objectId: r.placement.objectId || '', object: r.object, rows: [] })
    g.objects.get(ok).rows.push(r)
  }
  return [...custs.values()]
    .map((g) => ({ customer: g.customer, objects: [...g.objects.values()].map((o) => ({ ...o, rows: o.rows.sort((a, b) => byName(a.placement.name, b.placement.name)) })).sort((a, b) => byName(a.object?.name, b.object?.name)) }))
    .sort((a, b) => byName(a.customer.name, b.customer.name))
}

/** Zahlen für die Kacheln: aktive Liegeplätze, Matten (Stück), Kunden, zu prüfen, Mattentyp fehlt. */
export function counts(rows) {
  const active = rows.filter((r) => r.placement.active !== false)
  return {
    aktiv: active.length,
    matten: active.reduce((s, r) => s + r.qty, 0),
    kunden: new Set(active.map((r) => r.customer.id).filter(Boolean)).size,
    pruefen: active.filter((r) => r.placement.check).length,
    typ: active.filter((r) => r.missingType).length,
  }
}

/** Koordinaten für einen Liegeplatz: vom Objekt, wenn es welche hat. { lat, lon, geoQuality } oder null. */
export function coordsFromObject(object) {
  return Number.isFinite(object?.lat) && Number.isFinite(object?.lon) ? { lat: object.lat, lon: object.lon, geoQuality: 'objekt' } : null
}
