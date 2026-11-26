// Mattenwechsel: Stammtouren (feste Touren wie „Tour 1 Luftseite, alle 2 Wochen am Dienstag“). Reine Funktionen ohne
// Oberfläche (Tests: test/matten-stammtouren.test.js); Ansicht: ui/views/matten-planung.js („Stammtouren“).
//
// In matten/matten.json:
//   routes: [{ id, name, weekday (1 = Montag … 7 = Sonntag), everyWeeks (1, 2, 3, 4 …), anchor (ein Tag, an dem sie fährt),
//              driverId, vehicleId, placementIds: [Liegeplatz-ID in fester Reihenfolge], active, note,
//              createdAt, createdBy, updatedAt, updatedBy }]
//
// Was eine Stammtour bewirkt:
//  - „Liegeplätze anpassen“: Intervall = Rhythmus der Tour, Regel „fester Rhythmus“, Starttermin = nächster Tag der Tour.
//    So fallen die Wechsel genau auf die Tage der Tour (die Fälligkeit rechnet weiter nur core/matten-plan.js).
//  - Tourvorschlag: An einem Tag der Tour gehen die Stopps mit ihren Liegeplätzen zuerst in eine eigene Tour für ihren
//    Fahrer (falls er an dem Tag fährt), in der Reihenfolge der Stammtour; innerhalb eines Stopps (z. B. viele Liegeplätze
//    am Flughafen) stehen die Liegeplätze ebenso in dieser Reihenfolge. Was übrig bleibt, plant der normale Vorschlag.

import { addDays, isoWeekday, weeksBetween } from './dates.js'
import { recalcTimes, TOUR_SCHEMA } from './matten-tour.js'

export const ROUTE_RHYTHMS = { 1: 'jede Woche', 2: 'alle 2 Wochen', 3: 'alle 3 Wochen', 4: 'alle 4 Wochen', 8: 'alle 8 Wochen' }
export const WEEKDAYS = { 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag', 7: 'Sonntag' }

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const text = (v) => String(v ?? '').trim()
const weeksOf = (r) => Math.max(1, Math.min(52, Math.round(Number(r?.everyWeeks) || 1)))

/** Gültige Stammtour? Liefert den ersten Fehler als Text oder ''. */
export function routeProblem(route) {
  if (!text(route?.name)) return 'Bitte einen Namen eintragen (z. B. Tour 1 Luftseite).'
  if (!WEEKDAYS[route?.weekday]) return 'Bitte den Wochentag wählen.'
  if (!isDate(route?.anchor)) return 'Bitte den nächsten Tag der Tour eintragen.'
  if (isoWeekday(route.anchor) !== Number(route.weekday)) return `Der Tag ${route.anchor.split('-').reverse().join('.')} ist kein ${WEEKDAYS[route.weekday]}.`
  if (!(route.placementIds || []).length) return 'Bitte mindestens einen Liegeplatz wählen.'
  return ''
}

/** Fährt die Stammtour an diesem Tag? (Wochentag und Rhythmus ab dem Anker, auch vor dem Anker) */
export function routeRunsOn(route, date) {
  if (!route || route.active === false || !isDate(date) || !isDate(route.anchor) || isoWeekday(date) !== Number(route.weekday)) return false
  const w = weeksBetween(route.anchor, date)
  return ((w % weeksOf(route)) + weeksOf(route)) % weeksOf(route) === 0
}

/** Nächster Tag der Stammtour ab „from“ (einschließlich), sonst ''. */
export function nextRunOn(route, from) {
  if (!isDate(from)) return ''
  for (let i = 0; i < 7 * weeksOf(route) + 7; i++) {
    const d = addDays(from, i)
    if (routeRunsOn(route, d)) return d
  }
  return ''
}

/** Stammtouren, die an diesem Tag fahren. */
export const routesOn = (routes = [], date) => (routes || []).filter((r) => routeRunsOn(r, date))

/**
 * Liegeplätze an die Stammtour anpassen: Intervall = Rhythmus × 7 Tage, Regel „fester Rhythmus“, Starttermin = nächster
 * Tag der Tour ab „from“. Liefert { placements (neue Liste), changed: [ID] }; andere Liegeplätze bleiben unverändert.
 */
export function alignPlacements(placements = [], route, { from, now = '', by = '' } = {}) {
  const ids = new Set(route?.placementIds || [])
  const start = nextRunOn(route, from)
  const days = weeksOf(route) * 7
  const changed = []
  const out = placements.map((p) => {
    if (!ids.has(p.id) || !start) return p
    if (Number(p.intervalDays) === days && p.rule !== 'ab-ist' && p.startDate === start) return p
    changed.push(p.id)
    return { ...p, intervalDays: days, rule: 'rhythmus', startDate: start, updatedAt: now, updatedBy: by }
  })
  return { placements: out, changed }
}

/**
 * Hinweise zu einer Stammtour (für die Liste): Liegeplätze, die es nicht mehr gibt oder die inaktiv sind, die in einer
 * anderen Stammtour stehen, oder deren Intervall nicht zum Rhythmus passt (dann fallen ihre Wechsel nicht auf die Tour).
 * → [{ kind: 'fehlt' | 'doppelt' | 'intervall', ids: [ID], text }]
 */
export function routeHints(route, { placements = [], routes = [] } = {}) {
  const byId = new Map(placements.map((p) => [p.id, p]))
  const ids = route?.placementIds || []
  const out = []
  const missing = ids.filter((id) => !byId.get(id) || byId.get(id).active === false)
  if (missing.length) out.push({ kind: 'fehlt', ids: missing, text: `${missing.length === 1 ? '1 Liegeplatz gibt' : `${missing.length} Liegeplätze gibt`} es nicht mehr oder ${missing.length === 1 ? 'ist' : 'sind'} inaktiv.` })
  const others = new Set(routes.filter((r) => r.id !== route?.id && r.active !== false).flatMap((r) => r.placementIds || []))
  const twice = ids.filter((id) => others.has(id))
  if (twice.length) out.push({ kind: 'doppelt', ids: twice, text: `${twice.length === 1 ? '1 Liegeplatz steht' : `${twice.length} Liegeplätze stehen`} auch in einer anderen Stammtour.` })
  const days = weeksOf(route) * 7
  const off = ids.filter((id) => byId.get(id) && byId.get(id).active !== false && (Number(byId.get(id).intervalDays) !== days || byId.get(id).rule === 'ab-ist' || (isDate(byId.get(id).startDate) && !routeRunsOn(route, byId.get(id).startDate))))
  if (off.length) out.push({ kind: 'intervall', ids: off, text: `Bei ${off.length === 1 ? '1 Liegeplatz passen' : `${off.length} Liegeplätzen passen`} Intervall oder Starttermin nicht zur Tour: „Liegeplätze anpassen“.` })
  return out
}

/**
 * Stopps eines Tages auf die Stammtouren verteilen. stops aus stopsFromJobs (je Stopp items mit placementId);
 * drivers: Fahrer, die an dem Tag fahren. Ein Stopp gehört zu der Stammtour, in der sein erster Liegeplatz steht.
 * → { fixed: [{ route, driver, stops (in der Reihenfolge der Tour, Liegeplätze im Stopp ebenso) }], rest: [Stopp],
 *     skipped: [{ route, text }] (Stammtour fährt heute, aber ihr Fahrer nicht) }
 */
export function splitByRoutes({ stops = [], routes = [], drivers = [], date }) {
  const today = routesOn(routes, date)
  const pos = new Map()
  for (const r of today) (r.placementIds || []).forEach((id, i) => !pos.has(id) && pos.set(id, { route: r, i }))
  const byRoute = new Map()
  const rest = []
  for (const s of stops) {
    const hits = (s.items || []).map((it) => pos.get(it.placementId)).filter(Boolean)
    if (!hits.length) {
      rest.push(s)
      continue
    }
    const route = hits.sort((a, b) => a.i - b.i)[0].route
    const rank = (it) => (pos.get(it.placementId)?.route === route ? pos.get(it.placementId).i : 1e6)
    const items = [...s.items].sort((a, b) => rank(a) - rank(b))
    const list = byRoute.get(route.id) || []
    list.push({ stop: { ...s, items }, first: Math.min(...items.map(rank)) })
    byRoute.set(route.id, list)
  }
  const fixed = []
  const skipped = []
  for (const r of today) {
    const list = (byRoute.get(r.id) || []).sort((a, b) => a.first - b.first).map((x) => x.stop)
    if (!list.length) continue
    const driver = drivers.find((d) => d.id === r.driverId)
    if (!driver) {
      skipped.push({ route: r, text: `${r.name}: Fahrer fährt an diesem Tag nicht, Stopps im normalen Vorschlag.` })
      rest.push(...list)
      continue
    }
    fixed.push({ route: r, driver, stops: list })
  }
  return { fixed, rest, skipped }
}

/** Neue Stammtour mit Vorgaben (nächster Montag als Anker, wenn keiner angegeben). */
export function newRoute({ id, name = '', weekday = 1, everyWeeks = 2, from, driverId = '', vehicleId = '', placementIds = [], now = '', by = '' }) {
  const wd = WEEKDAYS[weekday] ? Number(weekday) : 1
  let anchor = isDate(from) ? from : ''
  for (let i = 0; anchor && i < 7 && isoWeekday(anchor) !== wd; i++) anchor = addDays(anchor, 1)
  return { id, name: text(name), weekday: wd, everyWeeks: Math.max(1, Number(everyWeeks) || 1), anchor, driverId, vehicleId, placementIds: [...placementIds], active: true, note: '', createdAt: now, createdBy: by, updatedAt: now, updatedBy: by }
}

/**
 * Tour aus einer Stammtour (Entwurf wie beim Tourvorschlag): Fahrer, Fahrzeug (der Stammtour, sonst des Fahrers),
 * Stopps in der Reihenfolge der Stammtour, Zeiten mit recalcTimes (Luftlinie; Google bzw. OpenRouteService später auf
 * Klick wie bei jeder Tour). routeId/routeName merken die Stammtour.
 */
export function fixedTour({ route, driver, stops, depot = null, shift, capacity = null, date, routing = {}, newId, now = '', by = '' }) {
  const areas = [...new Set(stops.map((s) => s.areaId || ''))]
  const tour = {
    schema: TOUR_SCHEMA,
    id: newId(),
    date,
    driverId: driver.id,
    driverName: text(driver.name),
    ...(text(driver.email) ? { driverEmail: text(driver.email).toLowerCase() } : {}),
    vehicleId: text(route.vehicleId) || text(driver.vehicleId),
    ...(areas.length === 1 && areas[0] ? { areaId: areas[0] } : {}),
    routeId: route.id,
    routeName: text(route.name),
    status: 'entwurf',
    order: stops.map((s) => s.id),
    route: { provider: 'luftlinie', shift, ...(capacity ? { capacity } : {}), depot: depot ? { name: text(depot.name), address: text(depot.address), ...(Number.isFinite(depot.lat) && Number.isFinite(depot.lon) ? { lat: depot.lat, lon: depot.lon } : {}) } : null },
    stops: stops.map((s) => ({ ...s })),
    createdAt: now,
    createdBy: by,
    updatedAt: now,
    updatedBy: by,
  }
  return recalcTimes(tour, null, routing)
}
