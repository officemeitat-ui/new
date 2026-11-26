// Mattenwechsel: Umplanung am Tag – offene Stopps einer freigegebenen oder laufenden Tour an eine andere Tour desselben
// Tages (bzw. eine neue Tour für einen anderen Fahrer) geben, z. B. Fahrer krank, Fahrzeug kaputt, zu viel für einen.
// Reine Funktionen ohne Oberfläche (Tests: test/matten-umplanung.test.js); Dialog in ui/views/matten-planung.js.
//
// Ablauf (Oberfläche): (1) Rückmeldungen der Fahrerseite am Webspace abholen und die Quelltour frisch lesen;
// (2) Stopps in die Zieltour (zuerst, damit kein Stopp verloren geht); (3) aus der Quelltour nehmen (prüft frisch, ob der
// Stopp noch unberührt ist); (4) Einsätze auf die Zieltour; (5) beide Touren neu an die Fahrerseite am Webspace.
// Gespeichert wird über die gemeinsame Touren-Ablage mit Zusammenführen (TourStore.update), auch für Touren unterwegs.
//
// Felder: an der Quelltour handovers [{ stopId, label, toTourId, toDriver, at, by }] (der Fahrer sieht, was das Büro
// weggenommen hat); am übernommenen Stopp handedFrom { tourId, driverName, at, by }.
//
// Grenze: Arbeitet der Fahrer der Quelltour ohne Netz am selben Stopp weiter, kommt der Stopp beim Zusammenführen
// zurück (seine Änderung geht vor). Dann steht er in zwei Touren: duplicateStops meldet das, das Büro entfernt einen.

import { isFinal } from './matten-fahrt.js'
import { tourJobKeys } from './matten-touren.js'
import { TOUR_JOB_STATUS } from './matten-tour.js'

const text = (v) => String(v ?? '').trim()
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const touch = (tour, change, { now = new Date().toISOString(), by = '' } = {}) => ({ ...tour, ...change, updatedAt: now, updatedBy: by })
export const stopLabel = (s) => [s?.customer?.name, s?.objectName].filter(Boolean).join(', ') || 'Stopp'
/** Touren, aus denen umgeplant werden kann (Entwürfe ändert die Tourenplanung direkt). */
export const HANDOVER_FROM = ['freigegeben', 'unterwegs']

/** Lässt sich der Stopp abgeben? '' = ja, sonst der Grund. Nur ganz unberührte Stopps (noch nicht angefahren). */
export function movableProblem(stop) {
  if (!stop) return 'Stopp nicht gefunden.'
  if (isFinal(stop)) return 'Der Stopp ist schon abgeschlossen.'
  if ((stop.status || 'geplant') !== 'geplant') return 'Der Fahrer ist schon auf dem Weg dorthin bzw. arbeitet dort.'
  const items = stop.items || []
  if (items.some((it) => (it.status || 'geplant') !== 'geplant')) return 'Am Stopp ist schon etwas erfasst.'
  if (items.some((it) => (it.photos || []).length || text(it.note))) return 'Am Stopp gibt es schon Fotos oder Bemerkungen.'
  if ((stop.reports || []).length || text(stop.note) || stop.web) return 'Am Stopp gibt es schon Meldungen des Fahrers.'
  return ''
}

/** Stopps der Tour, die sich abgeben lassen. */
export const movableStops = (tour) => (HANDOVER_FROM.includes(tour?.status) ? (tour.stops || []).filter((s) => !movableProblem(s)) : [])

/** Mögliche Zieltouren: gleicher Tag, andere Tour, nicht abgeschlossen. */
export const handoverTargets = (tours = [], from) => (tours || []).filter((t) => t && from && t.id !== from.id && t.date === from.date && t.status !== 'abgeschlossen')

/** Fehler vor dem Umplanen als Liste von Texten (leer = geht). */
export function handoverProblems({ from, to, stopIds = [] } = {}) {
  const out = []
  if (!from || !HANDOVER_FROM.includes(from.status)) out.push('Umplanen geht aus freigegebenen und laufenden Touren; einen Entwurf ändert die Tourenplanung direkt.')
  if (!to) out.push('Bitte die Tour wählen, die die Stopps übernimmt.')
  else {
    if (from && to.id === from.id) out.push('Bitte eine andere Tour wählen.')
    if (from && to.date !== from.date) out.push('Die Zieltour ist an einem anderen Tag.')
    if (to.status === 'abgeschlossen') out.push('Die Zieltour ist schon abgeschlossen.')
  }
  if (!stopIds.length) out.push('Bitte mindestens einen Stopp wählen.')
  for (const id of stopIds) {
    const s = (from?.stops || []).find((x) => x.id === id)
    const p = movableProblem(s)
    if (p) out.push(`${s ? stopLabel(s) : id}: ${p}`)
  }
  return out
}

/**
 * Stopps aus der Quelltour nehmen (Kopie); prüft je Stopp frisch, ob er noch unberührt ist (sonst Fehler, nichts
 * geändert). to: { id, driverName } für den Vermerk.
 */
export function moveStopsOut(from, stopIds = [], { to = null, now = new Date().toISOString(), by = '' } = {}) {
  const ids = new Set(stopIds)
  const taken = (from?.stops || []).filter((s) => ids.has(s.id))
  if (taken.length !== ids.size) throw new Error('Ein Stopp ist nicht mehr in der Tour (inzwischen geändert). Bitte neu laden.')
  for (const s of taken) {
    const p = movableProblem(s)
    if (p) throw new Error(`${stopLabel(s)}: ${p}`)
  }
  const stops = from.stops.filter((s) => !ids.has(s.id))
  const handovers = [...(from.handovers || []), ...taken.map((s) => ({ stopId: s.id, label: stopLabel(s), toTourId: to?.id || '', toDriver: text(to?.driverName), at: now, by }))]
  return touch(from, { stops, order: stops.map((s) => s.id), handovers, route: { ...(from.route || {}), manual: true } }, { now, by })
}

const sameStop = (a, b) => (a.customer?.id || '') === (b.customer?.id || '') && !!a.objectId && a.objectId === b.objectId

/** Stopp-ID, die in der Tour noch frei ist (wie in matten-touren.js). */
function freeId(stops, stop) {
  const ids = new Set(stops.map((s) => s.id))
  if (!ids.has(stop.id)) return stop.id
  const base = `${stop.id}-${stop.customer?.id || 'ohne'}`
  let id = base
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Stopps in die Zieltour (Kopie): Gibt es dort einen noch unberührten Stopp desselben Objekts und Kunden, kommen die
 * Liegeplätze dazu; sonst ein eigener Stopp am Ende (bei einer laufenden Tour nie in einen angefangenen Stopp). Zeiten
 * der übernommenen Stopps fallen weg (neu rechnen: Tourenplanung; bei einer laufenden Tour ohne Zeit).
 */
export function moveStopsIn(to, stops = [], { from = null, now = new Date().toISOString(), by = '' } = {}) {
  const list = [...(to?.stops || [])]
  for (const s0 of stops) {
    const s = clone(s0)
    delete s.times
    s.handedFrom = { tourId: from?.id || '', driverName: text(from?.driverName), at: now, by }
    s.status = 'geplant'
    s.updatedAt = now
    s.updatedBy = by
    const at = list.findIndex((x) => sameStop(x, s) && !movableProblem(x))
    if (at >= 0) {
      const have = new Set((list[at].items || []).map((it) => `${it.jobKey}|${it.placementId}`))
      const items = [...(list[at].items || []), ...(s.items || []).filter((it) => !have.has(`${it.jobKey}|${it.placementId}`))]
      list[at] = { ...list[at], items, workMinutes: (Number(list[at].workMinutes) || 0) + (Number(s.workMinutes) || 0), updatedAt: now, updatedBy: by }
    } else list.push({ ...s, id: freeId(list, s) })
  }
  return touch(to, { stops: list, order: list.map((s) => s.id), route: { ...(to?.route || {}), manual: true } }, { now, by })
}

/**
 * Einsätze der abgegebenen Stopps auf die Zieltour: freigegeben bzw. unterwegs → 'in-tour' mit deren tourId; Zieltour
 * ein Entwurf → wieder frei (Status von vorher), die Freigabe der Zieltour nimmt sie dann. Liefert die geänderten.
 */
export function jobsAfterHandover(jobs = [], stops = [], to, { now = new Date().toISOString(), by = '' } = {}) {
  const keys = new Set(tourJobKeys({ stops }))
  const live = ['freigegeben', 'unterwegs'].includes(to?.status)
  const out = []
  for (const j of jobs || []) {
    if (!keys.has(j.key)) continue
    const base = { ...(j.id === j.key ? {} : { id: j.key }), ...j, updatedAt: now, updatedBy: by }
    if (live) {
      if (j.status === 'in-tour' && j.tourId === to.id) continue
      if (j.status !== 'in-tour' && !TOUR_JOB_STATUS.includes(j.status)) continue
      out.push({ ...base, status: 'in-tour', tourId: to.id, beforeTour: j.status === 'in-tour' ? j.beforeTour || 'geplant' : j.status })
    } else if (j.status === 'in-tour') {
      const next = { ...base, status: TOUR_JOB_STATUS.includes(j.beforeTour) ? j.beforeTour : 'geplant' }
      delete next.tourId
      delete next.beforeTour
      out.push(next)
    }
  }
  return out
}

/**
 * Einsätze, die an einem Tag in offenen Stopps mehrerer Touren stehen (z. B. nach einer Umplanung, während der Fahrer
 * ohne Netz am Stopp weitergearbeitet hat): [{ key, label, tours: [{ id, driverName }] }].
 */
export function duplicateStops(tours = [], date = '') {
  const seen = new Map()
  for (const t of tours || []) {
    if (!t || (date && t.date !== date) || t.status === 'entwurf') continue
    for (const s of t.stops || []) {
      if (isFinal(s)) continue
      for (const k of tourJobKeys({ stops: [s] })) {
        if (!seen.has(k)) seen.set(k, { key: k, label: stopLabel(s), tours: [] })
        const e = seen.get(k)
        if (!e.tours.some((x) => x.id === t.id)) e.tours.push({ id: t.id, driverName: t.driverName || '' })
      }
    }
  }
  return [...seen.values()].filter((e) => e.tours.length > 1)
}
