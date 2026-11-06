// Mattenwechsel: Einsätze speichern und Kalender (Paket P7, docs/MATTENWECHSEL-PLAN.md). Reine Funktionen ohne
// Oberfläche (Tests: test/matten-einsaetze.test.js); Ansicht: ui/views/matten-kalender.js. Gerechnet wird mit dem
// Fälligkeitsrechner core/matten-plan.js (jobsFor, shiftJob, skipJob, discardJob, catchUpJob, nextDue …); hier steht nur,
// was das Büro damit tut: planen und speichern, verschieben, aussetzen, nachholen, verwerfen, Kalender, Ladeliste.
//
// Ablage: je Jahr des Solltermins eine Datei matten/einsaetze-<Jahr>.json { schema: 1, jobs[] } (YEAR_DOCS.mattenJobs in
// storage/data-service.js, gespeichert und zusammengeführt wie jede Datei der App). In der App sind alle geladenen
// Einsätze eine Liste: app.data.mattenJobs. Ein verschobener Einsatz bleibt in der Datei seines Solltermins.
//
// Einsatz (job) wie im Rechner, dazu id (= key, damit das Zusammenführen je Einsatz wirkt):
//   { id, key: '<placementId>:<Solltermin>', placementId, due, planned?, status, reason?, doneOn?, tourId?,
//     createdAt, createdBy, updatedAt?, updatedBy? }
//
// Einstellungen in matten/matten.json → settings:
//   closures: [{ from, to, reason, mode? }]  Betriebsurlaub und Schließtage für alle Liegeplätze (mode wie bei Pausen)
//   skip: 'entfaellt' | 'nachholen'           was mit einem Wechsel in einer Pause bzw. im Betriebsurlaub geschieht
//   planning: { von, bis, at, by }            letzter Lauf von „Einsätze planen“

import { addDays, isoWeekday, WEEKDAY_LONG } from './dates.js'
import { matLabel, matSize } from './invoicing.js'
import {
  calendarMonth,
  calendarWeek,
  catchUpJob,
  DONE_STATUS,
  discardJob,
  isOpen,
  jobDate,
  jobsFor,
  nextDue,
  pauseEffect,
  plannable,
  shiftJob,
  SKIP_MODES,
  skipJob,
} from './matten-plan.js'

/** Vorgabe für „Einsätze planen“: die nächsten 8 Wochen. */
export const PLAN_WEEKS = 8
/** Hinweis „noch nicht geplant“: fehlen Einsätze in den nächsten 14 Tagen? */
export const AHEAD_DAYS = 14

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isIso = (d) => typeof d === 'string' && ISO.test(d)
const text = (v) => String(v ?? '').trim()

// ---------------------------------------------------------------- Einstellungen

/** Einstellungen der Planung aus matten.json: { closures, skip, planning }. */
export function planSettings(doc) {
  const s = doc?.settings || {}
  return {
    closures: (Array.isArray(s.closures) ? s.closures : []).filter((c) => isIso(c?.from)),
    skip: SKIP_MODES[s.skip] ? s.skip : 'entfaellt',
    planning: s.planning || null,
  }
}

/** Schließtage säubern: Texte getrimmt, ohne „bis“ ein einzelner Tag, leere Zeilen weg, nach Beginn sortiert. */
export function normalizeClosures(list = []) {
  return (list || [])
    .map((c) => {
      const out = { from: text(c.from), to: text(c.to) || text(c.from), reason: text(c.reason) }
      if (SKIP_MODES[c.mode]) out.mode = c.mode
      return out
    })
    .filter((c) => c.from || c.reason)
    .sort((a, b) => a.from.localeCompare(b.from))
}

/** Schließtage prüfen (nach normalizeClosures): Text des ersten Problems oder ''. */
export function closuresProblem(list = []) {
  for (const c of list) {
    if (!isIso(c.from)) return 'Bitte bei jedem Betriebsurlaub das Datum „von“ eintragen.'
    if (!isIso(c.to) || c.to < c.from) return 'Ein Betriebsurlaub endet vor seinem Beginn.'
    if (c.to > addDays(c.from, 366)) return 'Ein Betriebsurlaub dauert höchstens ein Jahr. Für einen einzelnen Liegeplatz die Pause am Liegeplatz verwenden.'
  }
  return ''
}

// ---------------------------------------------------------------- Bestätigte Wechsel

/**
 * Bestätigte Wechsel für den Fälligkeitsrechner: [{ placementId, date }]. Heute der letzte Wechsel aus der Übernahme
 * (lastExchange am Liegeplatz); mit den Touren des Moduls (Phase Fahrer) zusätzlich jeder bestätigte Liegeplatz einer
 * Tour (stops[].items[] mit Status erledigt oder teilweise; Tag = Zeitpunkt der Bestätigung, sonst Tag der Tour).
 */
export function confirmedExchanges({ placements = [], tours = [] } = {}) {
  const out = []
  for (const p of placements || []) if (p?.id && isIso(p.lastExchange?.date)) out.push({ placementId: p.id, date: p.lastExchange.date })
  for (const t of tours || []) {
    for (const s of t?.stops || []) {
      for (const it of s?.items || []) {
        if (!it?.placementId || !DONE_STATUS.includes(it.status)) continue
        const date = isIso(String(it.time || '').slice(0, 10)) ? String(it.time).slice(0, 10) : t.date
        if (isIso(date)) out.push({ placementId: it.placementId, date })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- Speichern

/** Einsatz mit id (= Schlüssel) für die Ablage. */
export const withId = (job) => (job.id === job.key ? job : { id: job.key, ...job })

/** Geänderte bzw. neue Einsätze in die Liste übernehmen (je Schlüssel ersetzt, neue hinten an). Liefert eine neue Liste. */
export function mergeJobs(all = [], changed = []) {
  const byKey = new Map(changed.map((j) => [j.key, withId(j)]))
  const out = (all || []).map((j) => {
    const c = byKey.get(j.key)
    if (!c) return j
    byKey.delete(j.key)
    return c
  })
  return [...out, ...byKey.values()]
}

/** Zeitraum für „Einsätze planen“: ab heute die nächsten weeks Wochen (je einschließlich). */
export const planRange = (today, weeks = PLAN_WEEKS) => ({ von: today, bis: addDays(today, Math.max(1, Number(weeks) || PLAN_WEEKS) * 7 - 1) })

/** Jahre, deren Dateien für den Zeitraum geladen sein müssen (Vorjahr von „von“: verschobene und überfällige Einsätze). */
export function yearsFor(von, bis) {
  const a = Number(String(von).slice(0, 4)) - 1
  const b = Number(String(bis || von).slice(0, 4))
  const out = []
  for (let y = a; y <= b && out.length < 20; y++) out.push(String(y))
  return out
}

/** Zeitraum prüfen: Text des ersten Problems oder ''. */
export function rangeProblem(von, bis) {
  if (!isIso(von) || !isIso(bis)) return 'Bitte den Zeitraum mit „von“ und „bis“ eintragen.'
  if (bis < von) return 'Der Zeitraum endet vor seinem Beginn.'
  if (bis > addDays(von, 371)) return 'Bitte höchstens ein Jahr auf einmal planen.'
  return ''
}

/**
 * „Einsätze planen“ für von–bis (jobsFor mit Betriebsurlaub und Einstellung skip aus doc.settings). Erneutes Planen
 * erzeugt keine Doppel: vorhandene Schlüssel bleiben unverändert mit ihrem Status.
 * Liefert { jobs (alle, mit den neuen), added (neu, mit id), unchanged (vorhandene mit Solltermin im Zeitraum),
 * review: [{ key, why, text, job, placement }] (geplante, die nicht mehr passen), counts: { neu, unveraendert, pruefen } }.
 */
export function planJobs({ doc, jobs = [], done = [], von, bis, now = new Date().toISOString(), by = '' } = {}) {
  const { closures, skip } = planSettings(doc)
  const placements = doc?.placements || []
  const r = jobsFor({ placements, done, jobs, closures, von, bis, skip, now, by })
  const added = r.added.map(withId)
  const unchanged = (jobs || []).filter((j) => j?.due >= von && j.due <= bis)
  const byKey = new Map((jobs || []).map((j) => [j.key, j]))
  const byId = new Map(placements.map((p) => [p.id, p]))
  const review = r.review.map((x) => ({ ...x, job: byKey.get(x.key), placement: byId.get(byKey.get(x.key)?.placementId) || null }))
  return { jobs: mergeJobs(jobs, added), added, unchanged, review, counts: { neu: added.length, unveraendert: unchanged.length, pruefen: review.length } }
}

/**
 * Pause des Liegeplatzes bzw. Betriebsurlaub auf schon geplante Einsätze anwenden: Einsätze mit Status 'geplant' ab dem
 * Tag from, deren Tag in eine Pause fällt, werden ausgesetzt bzw. nachzuholen (pauseEffect, wie beim Planen). Liefert die
 * geänderten Einsätze.
 */
export function applyPauses(jobs = [], { doc, from = '', now = new Date().toISOString(), by = '' } = {}) {
  const { closures, skip } = planSettings(doc)
  const byId = new Map((doc?.placements || []).map((p) => [p.id, p]))
  const out = []
  for (const j of jobs || []) {
    if (j?.status !== 'geplant' || jobDate(j) < from) continue
    const p = byId.get(j.placementId)
    if (!p) continue
    const effect = pauseEffect(p, jobDate(j), j.due, { closures, skip })
    if (!effect) continue
    if (effect.status === 'nachzuholen') out.push({ ...catchUpJob(j, effect.planned, { reason: effect.reason, now, by }) })
    else out.push(skipJob(j, { reason: effect.reason, now, by }))
  }
  return out
}

/**
 * Zur Prüfung gemeldete Einsätze (planJobs → review) anpassen: Pause bzw. Betriebsurlaub → ausgesetzt oder nachzuholen
 * (wie beim Planen), Liegeplatz inaktiv oder gelöscht → verworfen. Liefert die geänderten Einsätze.
 */
export function resolveReview(review = [], { doc, jobs = [], now = new Date().toISOString(), by = '' } = {}) {
  const byKey = new Map((jobs || []).map((j) => [j.key, j]))
  const pauses = review.filter((x) => x.why === 'pause').map((x) => byKey.get(x.key)).filter(Boolean)
  const out = applyPauses(pauses, { doc, now, by })
  for (const x of review) {
    const j = byKey.get(x.key)
    if (!j || x.why === 'pause') continue
    out.push(discardJob(j, { reason: x.text, now, by }))
  }
  return out
}

// ---------------------------------------------------------------- Bearbeiten (Kalender)

/** Was das Büro mit einem Einsatz tun kann. needs: 'date' (Tag wählen) bzw. 'reason' (Grund Pflicht). */
export const JOB_ACTIONS = {
  verschieben: { label: 'Verschieben', verb: 'verschoben', needs: 'date', hint: 'Nur dieser Termin wandert; der Rhythmus und die folgenden Wechsel bleiben.' },
  aussetzen: { label: 'Aussetzen', verb: 'ausgesetzt', needs: 'reason', hint: 'Der Wechsel entfällt (z. B. Kunde geschlossen). Der nächste Wechsel bleibt im Rhythmus.' },
  nachholen: { label: 'Nachholen', verb: 'zum Nachholen eingeplant', needs: 'date', hint: 'Ein ausgesetzter, überfälliger oder nicht durchgeführter Wechsel wird an diesem Tag nachgeholt.' },
  verwerfen: { label: 'Verwerfen', verb: 'verworfen', needs: 'reason', hint: 'Der Wechsel wird nicht mehr gemacht und verschwindet aus Kalender und Hinweisen.' },
}

/** Passt die Aktion zum Einsatz? Einsätze in einer Tour ändert die Tourenplanung, erledigte niemand mehr. */
export function canApply(action, job, today) {
  if (!job || job.status === 'in-tour' || DONE_STATUS.includes(job.status)) return false
  if (action === 'nachholen') return ['ausgesetzt', 'verworfen', 'nachzuholen', 'nicht-durchgefuehrt'].includes(job.status) || (job.status === 'geplant' && jobDate(job) < today)
  return isOpen(job)
}

/** Eingaben einer Aktion prüfen: Text des ersten Problems oder ''. */
export function actionProblem(action, { date = '', reason = '', today = '' } = {}) {
  const a = JOB_ACTIONS[action]
  if (!a) return 'Bitte eine Aktion wählen.'
  if (a.needs === 'date') {
    if (!isIso(date)) return 'Bitte den neuen Tag wählen.'
    if (today && date < today) return 'Bitte einen Tag ab heute wählen.'
  }
  if (a.needs === 'reason' && !text(reason)) return action === 'aussetzen' ? 'Bitte den Grund eintragen, z. B. Kunde geschlossen.' : 'Bitte den Grund eintragen, z. B. Kunde hat gekündigt.'
  return ''
}

/**
 * Aktion auf einen oder mehrere Einsätze (Schlüssel keys): { changed (geänderte Einsätze), skipped (passen nicht zur
 * Aktion) }. Verschieben und Nachholen ändern nur den Tag (planned), nie Solltermin, Schlüssel oder Rhythmus.
 */
export function applyJobAction(jobs = [], keys = [], action, { date = '', reason = '', today = '', now = new Date().toISOString(), by = '' } = {}) {
  const want = new Set(keys)
  const changed = []
  const skipped = []
  const opts = { now, by }
  for (const j of jobs || []) {
    if (!want.has(j.key)) continue
    if (!canApply(action, j, today)) {
      skipped.push(j)
      continue
    }
    const why = text(reason)
    if (action === 'verschieben') changed.push(shiftJob(j, date, { ...opts, ...(why ? { reason: why } : {}) }))
    else if (action === 'nachholen') changed.push(catchUpJob(j, date, { ...opts, reason: why || 'nachholen' }))
    else if (action === 'aussetzen') changed.push(skipJob(j, { ...opts, reason: why }))
    else if (action === 'verwerfen') changed.push(discardJob(j, { ...opts, reason: why }))
  }
  return { changed: changed.map(withId), skipped }
}

// ---------------------------------------------------------------- Anzeige

/** Status für Farbe und Text im Kalender. */
export const DISPLAY = {
  geplant: 'geplant',
  verschoben: 'verschoben',
  'in-tour': 'in Tour',
  ueberfaellig: 'überfällig',
  nachzuholen: 'nachzuholen',
  'nicht-durchgefuehrt': 'nicht durchgeführt',
  ausgesetzt: 'ausgesetzt',
  erledigt: 'erledigt',
  teilweise: 'teilweise erledigt',
  verworfen: 'verworfen',
}

/** Status eines Einsatzes für die Anzeige (offene mit Tag vor heute: überfällig; verschobene geplante: verschoben). */
export function displayStatus(job, today) {
  const s = job?.status
  if (DONE_STATUS.includes(s) || s === 'ausgesetzt' || s === 'verworfen') return s
  if (isOpen(job) && jobDate(job) < today) return 'ueberfaellig'
  if (s === 'nachzuholen' || s === 'nicht-durchgefuehrt' || s === 'in-tour') return s
  return job?.planned && job.planned !== job.due ? 'verschoben' : 'geplant'
}

// ---------------------------------------------------------------- Ladeliste

const areaOfSize = (size) => {
  const m = /(\d+(?:,\d+)?)\s*×\s*(\d+(?:,\d+)?)/.exec(matSize(size))
  return m ? Number(m[1].replace(',', '.')) * Number(m[2].replace(',', '.')) : Infinity
}

/** Matte eines Liegeplatzes als Zeile der Ladeliste: { key, size, color, label }. */
function matLine(mat = {}) {
  const size = mat.size ? matSize(mat.size) : text(mat.legacy?.groesse)
  const color = text(mat.color || mat.legacy?.farbe)
  const kind = mat.matKind && mat.matKind !== 'Standard' ? text(mat.matKind) : ''
  const label = mat.size ? matLabel({ size: mat.size, color: mat.color, matKind: mat.matKind }) : [size, color].filter(Boolean).join(' ') || text(mat.name) || 'Matte'
  const key = size ? [size, color, kind].join('|').toLowerCase() : `name|${label.toLowerCase()}`
  return { key, size, color, label }
}

/**
 * Ladeliste (Tagesbedarf): Matten je Größe und Farbe für die offenen Einsätze (Stückzahl laut Liegeplatz).
 * [{ key, size, color, label, qty, kunde (davon Kundeneigentum), placements (Anzahl Liegeplätze) }], nach Größe (Fläche),
 * dann Farbe. Ohne Mattentyp zählen Größe und Farbe aus dem Werkzeug. Auch für die Tourenplanung (P9): je Tour die
 * Einsätze der Tour übergeben. all: auch erledigte und ausgesetzte Einsätze zählen.
 */
export function loadList(jobs = [], placements = [], { all = false } = {}) {
  const byId = new Map((placements || []).map((p) => [p?.id, p]))
  const out = new Map()
  for (const j of jobs || []) {
    if (!all && !isOpen(j)) continue
    const p = byId.get(j.placementId)
    if (!p) continue
    for (const m of p.mats || []) {
      const qty = Math.max(0, Math.round(Number(m.qty) || 0))
      if (!qty) continue
      const line = matLine(m)
      const row = out.get(line.key) || { ...line, qty: 0, kunde: 0, placements: new Set() }
      row.qty += qty
      if (m.owner === 'kunde') row.kunde += qty
      row.placements.add(p.id)
      out.set(line.key, row)
    }
  }
  return [...out.values()]
    .map((r) => ({ ...r, placements: r.placements.size }))
    .sort((a, b) => areaOfSize(a.size) - areaOfSize(b.size) || a.size.localeCompare(b.size, 'de') || a.color.localeCompare(b.color, 'de') || a.label.localeCompare(b.label, 'de'))
}

/** Summe der Matten einer Ladeliste. */
export const loadTotal = (list = []) => list.reduce((s, r) => s + r.qty, 0)

// ---------------------------------------------------------------- Kalender

const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })

/**
 * Einsätze eines Tages je Gebiet → Objekt: [{ areaId, name, objects: [{ objectId, name, address, items: [{ job,
 * placement, status }], placements (Anzahl Liegeplätze), load (Ladeliste der offenen) }] }]. Gebiete nach Namen („ohne
 * Gebiet“ zuletzt), Objekte nach Namen, Liegeplätze nach Namen. Verworfene stehen nicht im Kalender.
 */
export function dayGroups(jobs = [], { placements = [], objects = [], areas = [], today = '' } = {}) {
  const pById = new Map((placements || []).map((p) => [p?.id, p]))
  const oById = new Map((objects || []).map((o) => [o?.id, o]))
  const aById = new Map((areas || []).map((a) => [a?.id, a]))
  const groups = new Map()
  for (const job of jobs || []) {
    if (job?.status === 'verworfen') continue
    const placement = pById.get(job.placementId) || null
    const areaId = placement?.areaId && aById.has(placement.areaId) ? placement.areaId : ''
    if (!groups.has(areaId)) groups.set(areaId, { areaId, name: areaId ? aById.get(areaId).name : 'ohne Gebiet', objects: new Map() })
    const g = groups.get(areaId)
    const objectId = placement?.objectId || ''
    if (!g.objects.has(objectId)) {
      const o = oById.get(objectId)
      g.objects.set(objectId, { objectId, name: o?.name || (placement ? 'Objekt fehlt' : 'Liegeplatz gelöscht'), address: o?.address || '', items: [] })
    }
    g.objects.get(objectId).items.push({ job, placement, status: displayStatus(job, today) })
  }
  return [...groups.values()]
    .sort((a, b) => (a.areaId ? 0 : 1) - (b.areaId ? 0 : 1) || byName(a.name, b.name))
    .map((g) => ({
      areaId: g.areaId,
      name: g.name,
      objects: [...g.objects.values()]
        .sort((a, b) => byName(a.name, b.name))
        .map((o) => ({
          ...o,
          items: o.items.sort((a, b) => byName(a.placement?.name, b.placement?.name) || String(a.job.key).localeCompare(String(b.job.key))),
          placements: new Set(o.items.map((x) => x.job.placementId)).size,
          load: loadList(o.items.map((x) => x.job), placements),
        })),
    }))
}

/** Zähler je Anzeige-Status eines Tages: { geplant: 2, ueberfaellig: 1, … }. */
export function statusCounts(jobs = [], today = '') {
  const out = {}
  for (const j of jobs || []) {
    if (j?.status === 'verworfen') continue
    const s = displayStatus(j, today)
    out[s] = (out[s] || 0) + 1
  }
  return out
}

/**
 * Kalender für die Ansicht. mode 'woche': 7 Tage ab dem Montag der Woche von date; 'monat': der Monat von date in ganzen
 * Wochen (Montag bis Sonntag). Je Tag { date, inMonth, weekend, groups (dayGroups), moved (von diesem Solltermin weg
 * verschoben: [{ job, placement }]), counts (statusCounts), open (offene Einsätze), objects (Anzahl), load (Ladeliste
 * der offenen), mats (Summe) }. Liefert { mode, from, to, days, weeks (nur Monat: [{ monday, week, days }]) }.
 */
export function calendarView({ jobs = [], placements = [], objects = [], areas = [], today = '', mode = 'woche', date } = {}) {
  const shown = (jobs || []).filter((j) => j?.status !== 'verworfen')
  const pById = new Map((placements || []).map((p) => [p?.id, p]))
  const moved = new Map()
  for (const j of shown) {
    if (!j.planned || j.planned === j.due) continue
    if (!moved.has(j.due)) moved.set(j.due, [])
    moved.get(j.due).push({ job: j, placement: pById.get(j.placementId) || null })
  }
  const day = (d, inMonth = true) => {
    const list = d.jobs
    const open = list.filter(isOpen)
    const groups = dayGroups(list, { placements, objects, areas, today })
    const load = loadList(open, placements)
    return {
      date: d.date,
      inMonth,
      weekend: isoWeekday(d.date) > 5,
      groups,
      moved: (moved.get(d.date) || []).sort((a, b) => byName(a.placement?.name, b.placement?.name)),
      counts: statusCounts(list, today),
      jobs: list.length,
      open: open.length,
      objects: groups.reduce((s, g) => s + g.objects.length, 0),
      load,
      mats: loadTotal(load),
    }
  }
  if (mode === 'monat') {
    const m = calendarMonth(shown, String(date).slice(0, 7))
    const weeks = m.weeks.map((w) => ({ monday: w.monday, week: w.week, days: w.days.map((d) => day(d, d.inMonth)) }))
    const days = weeks.flatMap((w) => w.days)
    return { mode: 'monat', month: m.month, from: days[0].date, to: days.at(-1).date, weeks, days }
  }
  const w = calendarWeek(shown, date)
  const days = w.days.map((d) => day(d))
  return { mode: 'woche', week: w.week, monday: w.monday, from: days[0].date, to: days.at(-1).date, days }
}

/**
 * Hinweisliste über dem Kalender: { overdue (offene Einsätze mit Tag vor heute, älteste zuerst), catchUp (nachzuholende
 * bzw. nicht durchgeführte ab heute) } – je [{ job, placement }].
 */
export function hintList(jobs = [], { placements = [], today = '' } = {}) {
  const pById = new Map((placements || []).map((p) => [p?.id, p]))
  const sort = (a, b) => jobDate(a).localeCompare(jobDate(b)) || String(a.key).localeCompare(String(b.key))
  const wrap = (j) => ({ job: j, placement: pById.get(j.placementId) || null })
  const open = (jobs || []).filter(isOpen)
  return {
    overdue: open.filter((j) => jobDate(j) < today).sort(sort).map(wrap),
    catchUp: open.filter((j) => jobDate(j) >= today && ['nachzuholen', 'nicht-durchgefuehrt'].includes(j.status)).sort(sort).map(wrap),
  }
}

// ---------------------------------------------------------------- Zu erledigen, digitaler Mitarbeiter

/**
 * Offene Einsätze eines Tages ohne freigegebene Tour (geplant, nachzuholen, nicht durchgeführt; Einsätze einer
 * freigegebenen Tour haben den Status 'in-tour'). Für „Morgen fällige Einsätze ohne freigegebene Tour“ (Tourenplanung,
 * ui/views/matten-planung.js). Ein Entwurf hält keinen Einsatz fest – er zählt hier mit.
 */
export function withoutTour(jobs = [], date = '') {
  return (jobs || []).filter((j) => ['geplant', 'nachzuholen', 'nicht-durchgefuehrt'].includes(j?.status) && jobDate(j) === date).sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

/** Nächster Arbeitstag (Montag bis Freitag) nach dem Tag d. */
export function nextWorkday(d) {
  let x = addDays(d, 1)
  while (isoWeekday(x) > 5) x = addDays(x, 1)
  return x
}

/**
 * „Morgen fällige Einsätze ohne freigegebene Tour“ (Zu erledigen, digitaler Mitarbeiter): offene Einsätze von morgen bis
 * zum nächsten Arbeitstag (am Freitag also bis Montag, mit dem Wochenende), die in keiner freigegebenen Tour stehen.
 * Liefert { date (nächster Arbeitstag), days, jobs, title }.
 */
export function untouredSoon(jobs = [], today) {
  const date = nextWorkday(today)
  const days = []
  for (let d = addDays(today, 1); d <= date; d = addDays(d, 1)) days.push(d)
  const list = days.flatMap((d) => withoutTour(jobs, d))
  const title = date === addDays(today, 1) ? 'Morgen fällige Einsätze ohne freigegebene Tour' : `Bis ${WEEKDAY_LONG[isoWeekday(date) - 1]} fällige Einsätze ohne freigegebene Tour`
  return { date, days, jobs: list, title }
}

/**
 * Was das Büro tun sollte: { overdue: [{ placement, next }] (Liegeplätze, deren nächster Wechsel überfällig ist – offener
 * Einsatz vor heute bzw. „ab dem letzten Wechsel“ vorbei), missing (Einsätze der nächsten ahead Tage, die noch nicht
 * geplant sind; ohne die, die ohnehin ausfallen), until (letzter Tag dieses Blicks) }.
 */
export function attention({ doc, jobs = [], done = [], today, ahead = AHEAD_DAYS } = {}) {
  const { closures, skip } = planSettings(doc)
  const placements = (doc?.placements || []).filter(plannable)
  const overdue = []
  for (const p of placements) {
    const next = nextDue(p, { done, jobs, closures, today, skip })
    if (next?.overdue) overdue.push({ placement: p, next })
  }
  const until = addDays(today, Math.max(1, ahead) - 1)
  const missing = jobsFor({ placements, done, jobs, closures, skip, von: today, bis: until, now: '', by: '' }).added.filter(isOpen)
  return { overdue: overdue.sort((a, b) => a.next.date.localeCompare(b.next.date) || byName(a.placement.name, b.placement.name)), missing, until }
}
