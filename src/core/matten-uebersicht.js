// Mattenwechsel: Übersicht für das Büro (Paket P15, docs/MATTENWECHSEL-PLAN.md Abschnitte 5.3 und 7). Reine Funktionen
// ohne Oberfläche (Tests: test/matten-uebersicht.test.js); Ansicht: ui/views/matten-uebersicht.js. Gerechnet wird nur mit
// den vorhandenen Rechenkernen – Fälligkeit und Einsätze (matten-plan.js, matten-einsaetze.js), Touren und Stopps
// (matten-fahrt.js, matten-tour.js, matten-touren.js), Lieferscheine (matten-lieferschein.js) und Rechnungsentwürfe
// (matten-abrechnung.js). Hier wird nur zusammengezählt: keine eigene Fälligkeit, kein eigener Status.
//
// Stand aus den Touren: Die Fahrer schreiben die Einsätze nicht (matten/einsaetze-<Jahr>.json schreibt nur das Büro).
// Bis das Büro die Ergebnisse einer Tour übernimmt, steht ein Einsatz im Kalender „in Tour“. tourResults rechnet sie mit
// jobUpdatesFromTour (matten-fahrt.js) und markDone/markNotDone (matten-plan.js) dazu – nur für Einsätze, die noch „in
// Tour“ dieser Tour stehen. Die Übersicht zählt mit diesem Stand; „In die Einsätze übernehmen“ speichert ihn.
//
// Die neun Zahlen (Stichtag today; Listen für „Öffnen“, Definitionen auch in docs/MATTENWECHSEL-PLAN.md, Stand P15):
//  heute         offene Einsätze mit Tag heute (dueOn; verschobene am neuen Tag) und Wechsel, die laut Fälligkeitsrechner
//                heute dran sind, aber noch nicht im Kalender stehen (attention → missing)
//  geplant       Touren mit Status freigegeben (auch liegen gebliebene vergangener Tage) und Entwürfe ab heute
//  unterwegs     Touren mit Status unterwegs (Touren in Durchführung)
//  fertig        Touren mit Status abgeschlossen, Tag der Tour in den letzten 7 Tagen (wie „Matten-Touren“)
//  ueberfaellig  Liegeplätze, deren nächster Wechsel vor heute liegt (attention → overdue), ohne Einsätze in einer offenen
//                Tour (freigegeben, unterwegs) und ohne die nicht durchgeführten (eigene Zahl)
//  nicht         nicht durchgeführte Wechsel: Einsatz einer fertigen Tour ohne gewechselte Matte (Stopp „nicht
//                angetroffen“ oder „nicht durchgeführt“, Liegeplatz „nicht möglich“) bzw. offener Stopp einer
//                abgeschlossenen Tour – noch nicht nachgeholt (kein bestätigter Wechsel des Liegeplatzes an diesem Tag
//                oder danach; Einsatz weder erledigt noch ausgesetzt noch verworfen)
//  unversendet   festgeschriebene Lieferscheine aus dem Mattenwechsel ohne Versand (nur mit Recht auf die Fakturierung)
//  fehler        fehlerhafte SharePoint-Übertragungen: Lieferscheine mit Ablage „fehlgeschlagen“ (nur mit Fakturierung),
//                Touren, die dieses Gerät nicht speichern konnte (Fehler ohne Netzbezug, z. B. fehlendes Recht), und
//                Fotos, die seit über einem Tag in der Warteschlange stehen
//  entwuerfe     Rechnungen ohne Nummer mit Quelle Mattenwechsel: aus dem Abrechnungslauf, mit Positionen aus
//                Mattenwechsel-Lieferscheinen bzw. der Pauschale oder mit einem verknüpften Lieferschein (nur mit Fakturierung)

import { addDays, mondayOf } from './dates.js'
import { matSize } from './invoicing.js'
import { FLAT_TYPE, isMattenNote, NOTE_TYPE, reviewStep, RUN_TYPE } from './matten-abrechnung.js'
import { attention, confirmedExchanges, loadList as placementLoad, mergeJobs, withId } from './matten-einsaetze.js'
import { doneFromTours, isFinal, jobUpdatesFromTour, localDate, orderedStops, placementsOf, shownQuantity, STOP_STATUS, tourProgress } from './matten-fahrt.js'
import { DONE_STATUS, dueOn, isOpen, jobDate, markDone, markNotDone } from './matten-plan.js'
import { archiveState } from './matten-lieferschein.js'
import { loadList } from './matten-tour.js'
import { sumLoadLists, tourJobKeys, toursOn } from './matten-touren.js'

/** Touren, die noch laufen (Einsätze darin gelten nicht als überfällig). */
export const OPEN_TOURS = ['freigegeben', 'unterwegs']
/** „Abgeschlossene Touren“: so viele Tage zurück (wie das Büro in „Matten-Touren“). */
export const DONE_DAYS = 7
/** Ein Foto gilt als nicht übertragen, wenn es länger als so viele Stunden in der Warteschlange steht. */
export const PHOTO_HOURS = 24
/** Die neun Zahlen in der Reihenfolge des Konzepts (Abschnitt 10). */
export const CARDS = ['heute', 'geplant', 'unterwegs', 'fertig', 'ueberfaellig', 'nicht', 'unversendet', 'fehler', 'entwuerfe']
/** Zahlen aus der Fakturierung (nur mit Leserecht; ohne fehlt die Zahl, bei „fehler“ der Teil der Lieferscheine). */
export const FAK_CARDS = ['unversendet', 'entwuerfe']

const ENDED = ['erledigt', 'teilweise', 'ausgesetzt', 'verworfen']
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })

// ---------------------------------------------------------------- Rechte

/**
 * Was die Person in der Übersicht sieht: view (Modul Mattenwechsel des Büros – Fahrer nicht), fak (Zahlen aus der
 * Fakturierung: Lieferscheine und Rechnungsentwürfe), edit (Ergebnisse der Touren in die Einsätze übernehmen).
 * access aus resolveAccess; ohne (Browser-Modus) alles.
 */
export function overviewRights(access) {
  if (!access) return { view: true, fak: true, edit: true }
  const view = access.sees('matten')
  return { view, fak: view && access.sees('fakturierung'), edit: view && access.canEdit('matten') }
}

// ---------------------------------------------------------------- Stand aus den Touren

/**
 * Ergebnisse fertiger Stopps für Einsätze, die noch „in Tour“ stehen: jobUpdatesFromTour je Tour → erledigt bzw.
 * teilweise (markDone mit dem Tag des Abschlusses) oder nachzuholen (markNotDone mit Grund). Nur Einsätze mit Status
 * in-tour derselben Tour (tourId); was das Büro inzwischen anders gesetzt hat, bleibt. Liefert die geänderten Einsätze.
 */
export function tourResults(jobs = [], tours = [], { now = '', by = '' } = {}) {
  const byKey = new Map((jobs || []).map((j) => [j?.key, j]))
  // nur Touren, die einen Einsatz „in Tour“ berühren (jobUpdatesFromTour liefert nur Schlüssel ihrer Positionen)
  const inTour = new Set([...byKey].filter(([, j]) => j?.status === 'in-tour').map(([k]) => k))
  const out = new Map()
  for (const tour of tours || []) {
    if (!tour?.id || tour.status === 'entwurf' || !touchesKeys(tour, inTour)) continue
    for (const u of jobUpdatesFromTour(tour)) {
      const job = byKey.get(u.key)
      if (!job || job.status !== 'in-tour' || out.has(u.key)) continue
      if (job.tourId && job.tourId !== u.tourId) continue
      const next = u.status === 'nachzuholen' ? markNotDone(job, { reason: u.reason || '', now, by }) : markDone(job, u.date, { partial: u.status === 'teilweise', now, by })
      out.set(u.key, withId({ ...next, tourId: job.tourId || u.tourId }))
    }
  }
  return [...out.values()]
}

/** Nennt eine Position der Tour (mit Einsatz) einen dieser Schlüssel (jobKey bzw. alsoJobKeys)? */
const touchesKeys = (tour, keys) => keys.size > 0 && (tour.stops || []).some((s) => (s.items || []).some((it) => it.jobKey && (keys.has(it.jobKey) || (it.alsoJobKeys || []).some((k) => keys.has(k)))))

/**
 * Kann die Tour einen nicht durchgeführten Wechsel liefern (notDoneList)? Nur mit einem fertigen Stopp, in dem eine Position
 * mit Einsatz nicht gewechselt ist (sonst gibt jobUpdatesFromTour kein „nachzuholen“), bzw. abgeschlossen mit offenem Stopp.
 */
const mayHaveNotDone = (tour) =>
  (tour.stops || []).some((s) => (isFinal(s) ? (s.items || []).some((it) => it.jobKey && !(it.status === 'gewechselt' && shownQuantity(it) > 0)) : tour.status === 'abgeschlossen'))

/** Einsätze mit den Ergebnissen der Touren (tourResults), wie sie nach dem Übernehmen gespeichert wären. */
export const jobsWithTours = (jobs = [], tours = []) => mergeJobs(jobs || [], tourResults(jobs, tours))

/** Bestätigte Wechsel für den Fälligkeitsrechner: letzter Wechsel aus der Übernahme und jeder gewechselte Liegeplatz der Touren. */
export const doneOf = (placements = [], tours = []) => [...confirmedExchanges({ placements }), ...doneFromTours(tours)]

/**
 * Nicht durchgeführte Wechsel aus den Touren: je Einsatz-Schlüssel der jüngste Fall – fertiger Stopp ohne gewechselte
 * Matte für diesen Einsatz (jobUpdatesFromTour → nachzuholen) oder ein offener Stopp einer abgeschlossenen Tour.
 * Ohne die schon nachgeholten (bestätigter Wechsel des Liegeplatzes an diesem Tag oder danach) und ohne Einsätze, die
 * erledigt, ausgesetzt oder verworfen sind. jobs: Einsätze mit dem Stand der Touren (jobsWithTours).
 * Liefert [{ key, placementId, placementName, floor, objectName, customerName, date, reason, tourId, stopId,
 * driverName, stopStatus, job, planned (Tag, an dem nachgeholt wird: ab heute in einer Tour oder im Kalender) }],
 * älteste zuerst.
 */
export function notDoneList({ tours = [], jobs = [], done = [], today = '' } = {}) {
  const byKey = new Map((jobs || []).map((j) => [j?.key, j]))
  const last = new Map()
  for (const d of done || []) if (d?.placementId && String(d.date) > (last.get(d.placementId) || '')) last.set(d.placementId, d.date)
  const found = new Map()
  const add = (e) => {
    if (!e.key || !isDate(e.date)) return
    const old = found.get(e.key)
    if (!old || e.date >= old.date) found.set(e.key, e)
  }
  for (const tour of tours || []) {
    if (!tour?.id || tour.status === 'entwurf' || !mayHaveNotDone(tour)) continue
    const stops = new Map((tour.stops || []).map((s) => [s.id, s]))
    for (const u of jobUpdatesFromTour(tour)) {
      if (u.status !== 'nachzuholen' || u.also) continue
      const stop = stops.get(u.stopId)
      const it = (stop?.items || []).find((x) => x.jobKey === u.key) || {}
      add({ key: u.key, placementId: u.placementId, placementName: it.placementName || '', floor: it.floor || '', date: u.date, reason: u.reason || '', tour, stop })
    }
    // abgeschlossene Tour mit offenem Stopp: die Liegeplätze wurden nie bestätigt
    if (tour.status !== 'abgeschlossen') continue
    for (const stop of orderedStops(tour)) {
      if (isFinal(stop)) continue
      for (const p of placementsOf(stop)) add({ key: p.items[0]?.jobKey || '', placementId: p.placementId, placementName: p.placementName, floor: p.floor, date: tour.date, reason: 'nicht bestätigt', tour, stop })
    }
  }
  const tourDay = new Map((tours || []).filter((t) => t?.id && isDate(t.date)).map((t) => [t.id, t.date]))
  const out = []
  for (const e of found.values()) {
    const job = byKey.get(e.key) || null
    if (job && ENDED.includes(job.status)) continue
    if ((last.get(e.placementId) || '') >= e.date) continue
    // nachholen eingeplant: der Einsatz hat einen neuen Tag ab heute (Kalender „Nachholen“ oder eine neue Tour – dort
    // bleibt der Solltermin, es zählt der Tag der Tour)
    const other = job?.status === 'in-tour' && job.tourId && job.tourId !== e.tour.id ? tourDay.get(job.tourId) || '' : ''
    const again = other ? (other >= today ? other : '') : job && isOpen(job) && jobDate(job) >= today && jobDate(job) !== e.date ? jobDate(job) : ''
    out.push({
      key: e.key,
      placementId: e.placementId,
      placementName: e.placementName,
      floor: e.floor,
      objectName: e.stop?.objectName || '',
      customerName: e.stop?.customer?.name || '',
      date: e.date,
      reason: e.reason,
      tourId: e.tour.id,
      stopId: e.stop?.id || '',
      driverName: e.tour.driverName || e.stop?.finishedBy || '',
      stopStatus: e.stop?.status || '',
      job,
      planned: again,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || byName(a.objectName, b.objectName) || byName(a.placementName, b.placementName))
}

/** Touren vergangener Tage, die noch nicht abgeschlossen sind (freigegeben oder unterwegs), älteste zuerst. */
export const staleTours = (tours = [], today = '') =>
  (tours || []).filter((t) => OPEN_TOURS.includes(t?.status) && isDate(t.date) && t.date < today).sort((a, b) => a.date.localeCompare(b.date) || byName(a.driverName, b.driverName))

/**
 * Stand für Übersicht, „Zu erledigen“ und Kalender: { jobs (mit dem Stand der Touren), applied (Einsätze, die das
 * Übernehmen ändern würde), done, attention (wie matten-einsaetze.js), overdue (ohne offene Touren und nicht
 * durchgeführte), notDone, stale }. toursLoaded: false, solange die Touren nicht gelesen sind – dann wie bisher nur mit
 * den gespeicherten Einsätzen (keine Touren, nichts „nicht durchgeführt“, Einsätze „in Tour“ zählen weiter als überfällig).
 */
export function mattenStateOf({ doc, jobs = [], tours = [], today, toursLoaded = true } = {}) {
  const list = toursLoaded ? tours || [] : []
  const applied = tourResults(jobs, list)
  const eff = applied.length ? mergeJobs(jobs || [], applied) : jobs || []
  const placements = doc?.placements || []
  const done = doneOf(placements, list)
  const att = attention({ doc: { settings: {}, ...(doc || {}), placements }, jobs: eff, done, today })
  const notDone = toursLoaded ? notDoneList({ tours: list, jobs: eff, done, today }) : []
  const notKeys = new Set(notDone.map((x) => x.key))
  const open = new Set(list.filter((t) => OPEN_TOURS.includes(t?.status)).map((t) => t.id))
  const overdue = att.overdue.filter((x) => {
    if (notKeys.has(x.next.key)) return false
    const job = x.next.job
    return !(toursLoaded && job?.status === 'in-tour' && open.has(job.tourId))
  })
  return { today, toursLoaded, jobs: eff, applied, done, attention: att, overdue, notDone, stale: toursLoaded ? staleTours(list, today) : [] }
}

// ---------------------------------------------------------------- Belege der Fakturierung

/** Alle Lieferscheine aus dem Mattenwechsel (auch ohne Nummer), für die Verknüpfung mit Rechnungen. */
const mattenNoteIds = (docs) => new Set((docs || []).filter((d) => d?.kind === 'lieferschein' && d.source?.type === NOTE_TYPE).map((d) => d.id))

/** Rechnung mit Quelle Mattenwechsel (Lauf, Positionen aus Lieferscheinen bzw. Pauschale, verknüpfter Lieferschein)? */
export function isMattenInvoice(d, noteIds = new Set()) {
  if (d?.kind !== 'rechnung') return false
  if (d.source?.type === RUN_TYPE) return true
  if ((d.lines || []).some((l) => l?.source?.type === NOTE_TYPE || l?.source?.type === FLAT_TYPE)) return true
  return (d.deliveryNotes || []).some((n) => noteIds.has(n?.id)) || noteIds.has(d.refId)
}

/** Offene Rechnungsentwürfe aus dem Mattenwechsel: [{ doc, step (entwurf | geprueft | freigegeben) }], neueste zuerst. */
export function mattenDrafts(docs = []) {
  const ids = mattenNoteIds(docs)
  return (docs || [])
    .filter((d) => isMattenInvoice(d, ids) && !d.number && d.status !== 'storniert' && !d.cancelledAt)
    .map((doc) => ({ doc, step: reviewStep(doc) }))
    .sort((a, b) => String(b.doc.date || '').localeCompare(String(a.doc.date || '')) || String(a.doc.id).localeCompare(String(b.doc.id)))
}

/** Festgeschriebene Rechnungen aus dem Mattenwechsel mit ihren Stornos und Korrekturen (für den Umsatz). */
export function mattenInvoices(docs = []) {
  const ids = mattenNoteIds(docs)
  const inv = (docs || []).filter((d) => isMattenInvoice(d, ids) && d.number)
  const have = new Set(inv.map((d) => d.id))
  return [...inv, ...(docs || []).filter((d) => (d?.kind === 'storno' || d?.kind === 'korrektur') && d.number && have.has(d.refId))]
}

// ---------------------------------------------------------------- Übersicht

const tourRow = (tour, today) => ({ tour, progress: tourProgress(tour), past: isDate(tour.date) && tour.date < today })
const placementInfo = (placements) => {
  const byId = new Map((placements || []).map((p) => [p?.id, p]))
  return (id) => byId.get(id) || null
}

/**
 * Die neun Zahlen mit den Listen dahinter, „Heute“ (Touren des Tages mit Fortschritt, Ladeliste) und die Woche.
 *  doc        matten/matten.json; jobs: gespeicherte Einsätze; tours: gelesene Touren (toursLoaded: gelesen?)
 *  docs       Belege der Fakturierung (null = ohne Leserecht: unversendet und entwuerfe fehlen, fehler ohne Lieferscheine)
 *  tourErrors Touren, die dieses Gerät nicht speichern konnte: [{ id, path, error, tour? }]
 *  now        Zeitpunkt (ISO) für die Warteschlange der Fotos; today: Stichtag
 * Liefert { today, toursLoaded, fak, cards: { <Name>: { n, list, … } }, todayTours, load, week, applied, state }.
 * Fehlt eine Zahl (Recht), steht sie nicht in cards.
 */
export function overviewOf({ doc, jobs = [], tours = [], toursLoaded = true, docs = null, tourErrors = [], today, now = new Date().toISOString() } = {}) {
  const state = mattenStateOf({ doc, jobs, tours, today, toursLoaded })
  const list = toursLoaded ? tours || [] : []
  const pOf = placementInfo(doc?.placements)
  const cards = {}

  // 1. heute fällig
  const dueToday = dueOn(state.jobs, today).map((job) => ({ key: job.key, placementId: job.placementId, placement: pOf(job.placementId), job, inTour: job.status === 'in-tour', unplanned: false }))
  const have = new Set(dueToday.map((x) => x.key))
  for (const job of state.attention.missing) if (jobDate(job) === today && !have.has(job.key)) dueToday.push({ key: job.key, placementId: job.placementId, placement: pOf(job.placementId), job, inTour: false, unplanned: true })
  cards.heute = { n: dueToday.length, list: dueToday, inTour: dueToday.filter((x) => x.inTour).length, unplanned: dueToday.filter((x) => x.unplanned).length }

  // 2.–4. Touren
  const sorted = [...list].filter((t) => t?.id && isDate(t.date)).sort((a, b) => a.date.localeCompare(b.date) || byName(a.driverName, b.driverName) || String(a.id).localeCompare(String(b.id)))
  const planned = sorted.filter((t) => t.status === 'freigegeben' || (t.status === 'entwurf' && t.date >= today)).map((t) => tourRow(t, today))
  cards.geplant = { n: planned.length, list: planned, drafts: planned.filter((x) => x.tour.status === 'entwurf').length, past: planned.filter((x) => x.past).length, next: planned.find((x) => !x.past)?.tour.date || planned[0]?.tour.date || '' }
  const running = sorted.filter((t) => t.status === 'unterwegs').map((t) => tourRow(t, today))
  cards.unterwegs = { n: running.length, list: running, past: running.filter((x) => x.past).length }
  const since = addDays(today, -DONE_DAYS)
  const finished = sorted.filter((t) => t.status === 'abgeschlossen' && t.date >= since && t.date <= today).reverse().map((t) => tourRow(t, today))
  cards.fertig = { n: finished.length, list: finished, today: finished.filter((x) => x.tour.date === today).length }

  // 5.–6. überfällig, nicht durchgeführt
  cards.ueberfaellig = { n: state.overdue.length, list: state.overdue, oldest: state.overdue[0]?.next.date || '' }
  cards.nicht = { n: state.notDone.length, list: state.notDone, open: state.notDone.filter((x) => !x.planned).length }

  // 7., 9. Lieferscheine und Rechnungsentwürfe (nur mit Recht auf die Fakturierung)
  const fak = Array.isArray(docs)
  const notes = fak ? docs.filter(isMattenNote) : []
  if (fak) {
    const unsent = notes.filter((d) => !(d.sent || []).length).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.number).localeCompare(String(b.number)))
    cards.unversendet = { n: unsent.length, list: unsent, oldest: unsent[0]?.date || '' }
  }

  // 8. fehlerhafte SharePoint-Übertragungen
  const failed = []
  for (const d of notes) if (archiveState(d) === 'fehler') failed.push({ kind: 'lieferschein', doc: d, text: d.integration?.ablage?.lastError || '' })
  for (const e of tourErrors || []) failed.push({ kind: 'tour', id: e.id || '', path: e.path || '', tour: e.tour || null, text: e.error || '' })
  const limit = Date.parse(now) - PHOTO_HOURS * 3600e3
  for (const tour of list) {
    for (const stop of tour.stops || []) {
      for (const it of stop.items || []) {
        for (const ph of it.photos || []) {
          const at = Date.parse(ph?.at || '')
          if (ph?.queued && Number.isFinite(at) && at < limit) failed.push({ kind: 'foto', tour, stop, placementName: it.placementName || '', photo: ph, text: 'seit über einem Tag in der Warteschlange' })
        }
      }
    }
  }
  const kinds = new Set(failed.map((x) => x.kind))
  cards.fehler = { n: failed.length, list: failed, notes: failed.filter((x) => x.kind === 'lieferschein').length, onlyNotes: kinds.size === 1 && kinds.has('lieferschein'), partial: !fak }

  if (fak) {
    const drafts = mattenDrafts(docs)
    cards.entwuerfe = { n: drafts.length, list: drafts, released: drafts.filter((x) => x.step === 'freigegeben').length }
  }

  // Heute: Touren des Tages mit Fahrer und Fortschritt, Ladeliste der freigegebenen
  const todays = toursOn(list, today)
  const todayTours = todays.map((t) => tourRow(t, today))
  const load = sumLoadLists(todays.filter((t) => t.status !== 'entwurf').map((t) => loadList(t)))

  return { today, toursLoaded: state.toursLoaded, fak, cards, todayTours, load, week: weekOf(state, list, today), applied: state.applied, state }
}

/**
 * Kleine Woche (Montag bis Sonntag der Woche von today): je Tag { date, faellig, geplant, erledigt }.
 *  faellig  Einsätze mit Tag an diesem Tag (ohne ausgesetzte und verworfene), ab heute auch die noch nicht geplanten
 *  geplant  davon in einer freigegebenen Tour (Status in Tour bzw. in einer Tour dieses Tages, ohne Entwürfe) oder schon erledigt
 *  erledigt davon erledigt oder teilweise erledigt
 */
export function weekOf(state, tours = [], today) {
  const monday = mondayOf(today)
  // Einsätze in einer Tour dieses Tages (ein später nachzuholender Einsatz steht noch in der alten Tour: zählt dort nicht)
  const byDay = new Map()
  for (const t of tours || []) {
    if (!t?.status || t.status === 'entwurf' || !isDate(t.date)) continue
    const set = byDay.get(t.date) || new Set()
    for (const k of tourJobKeys(t)) set.add(k) // alle Einsätze der Tour, auch die fertiger Stopps
    byDay.set(t.date, set)
  }
  const days = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i)
    const list = state.jobs.filter((j) => jobDate(j) === date && j.status !== 'ausgesetzt' && j.status !== 'verworfen')
    const keys = new Set(list.map((j) => j.key))
    for (const j of state.attention.missing) if (jobDate(j) === date && !keys.has(j.key)) list.push(j)
    const inTour = byDay.get(date) || new Set()
    days.push({
      date,
      today: date === today,
      faellig: list.length,
      geplant: list.filter((j) => j.status === 'in-tour' || inTour.has(j.key) || DONE_STATUS.includes(j.status)).length,
      erledigt: list.filter((j) => DONE_STATUS.includes(j.status)).length,
    })
  }
  return { monday, days }
}

// ---------------------------------------------------------------- Kennzahlen

const inMonth = (d, m) => isDate(d) && d >= m.from && d <= m.to

/**
 * Kennzahlen des Mattenwechsels je Monat (months wie lastMonths in core/kpi.js: [{ key, from, to }]):
 *  [{ key, soll (Einsätze mit Solltermin im Monat, ohne ausgesetzte und verworfene), ist (bestätigte Wechsel: Liegeplatz
 *  und Tag aus den Touren bzw. erledigte Einsätze), erledigt (erledigte Einsätze), puenktlich (davon gewechselt bis
 *  Solltermin + tolerance Tage), rate (Pünktlichkeitsquote, null ohne erledigte), nicht (nicht durchgeführte Fälle aus den
 *  Touren, auch später nachgeholte) }]. Dazu sizes: Matten an aktiven Liegeplätzen je Größe ({ size, qty, placements })
 *  und exchanged: im Zeitraum gewechselte Matten je Größe ({ size, qty }).
 *  state: mattenStateOf (Einsätze mit dem Stand der Touren); tolerance: Tage (settings.toleranceDays, Vorgabe 0).
 */
export function mattenKpi({ doc, state, tours = [], months = [], tolerance = 0 } = {}) {
  const tol = Math.max(0, Math.round(Number(tolerance) || 0))
  const ist = new Set()
  for (const d of doneFromTours(tours)) ist.add(`${d.placementId}|${d.date}`)
  const done = state.jobs.filter((j) => DONE_STATUS.includes(j.status) && isDate(j.doneOn))
  for (const j of done) ist.add(`${j.placementId}|${j.doneOn}`)
  const istDates = [...ist].map((k) => k.split('|')[1])
  const failed = []
  for (const tour of tours || []) if (tour?.status !== 'entwurf') for (const u of jobUpdatesFromTour(tour)) if (u.status === 'nachzuholen' && !u.also) failed.push(u.date)
  const rows = months.map((m) => {
    const fin = done.filter((j) => inMonth(j.doneOn, m))
    const punctual = fin.filter((j) => isDate(j.due) && j.doneOn <= addDays(j.due, tol)).length
    return {
      key: m.key,
      soll: state.jobs.filter((j) => inMonth(j.due, m) && j.status !== 'ausgesetzt' && j.status !== 'verworfen').length,
      ist: istDates.filter((d) => inMonth(d, m)).length,
      erledigt: fin.length,
      puenktlich: punctual,
      rate: fin.length ? punctual / fin.length : null,
      nicht: failed.filter((d) => inMonth(d, m)).length,
    }
  })
  // Matten je Größe: Bestand an den aktiven Liegeplätzen (Ladeliste aller Liegeplätze, nach Größe zusammengefasst)
  const active = (doc?.placements || []).filter((p) => p?.id && p.active !== false)
  const sizes = new Map()
  for (const r of placementLoad(active.map((p) => ({ placementId: p.id, status: 'geplant' })), active)) {
    const size = r.size || r.label
    const s = sizes.get(size) || { size, qty: 0, placements: 0 }
    s.qty += r.qty
    s.placements += r.placements
    sizes.set(size, s)
  }
  const from = months[0]?.from || ''
  const to = months.at(-1)?.to || ''
  const exchanged = new Map()
  for (const tour of tours || []) {
    for (const stop of tour?.stops || []) {
      if (!isFinal(stop)) continue
      const day = localDate(stop.finishedAt) || tour.date
      if (!isDate(day) || day < from || day > to) continue
      for (const it of stop.items || []) {
        if (it.status !== 'gewechselt') continue
        const qty = it.actual === null || it.actual === undefined || it.actual === '' ? Number(it.planned) || 0 : Number(it.actual) || 0
        if (qty <= 0) continue
        const size = matSize(it.mat?.size || '') || it.mat?.name || 'Matte'
        exchanged.set(size, (exchanged.get(size) || 0) + qty)
      }
    }
  }
  const bySize = (a, b) => byName(a.size, b.size)
  return {
    months: rows,
    sizes: [...sizes.values()].sort((a, b) => b.qty - a.qty || bySize(a, b)),
    exchanged: [...exchanged.entries()].map(([size, qty]) => ({ size, qty })).sort((a, b) => b.qty - a.qty || bySize(a, b)),
    tolerance: tol,
  }
}

/** Kurztext des Stopp-Status (für Listen). */
export const stopText = (status) => STOP_STATUS[status] || status || ''
