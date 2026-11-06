// Mattenwechsel: Fälligkeitsrechner (rein rechnend, ohne Oberfläche; Tests: test/matten-plan.test.js).
// Plan: docs/MATTENWECHSEL-PLAN.md, Abschnitte 4.1/4.2 und Paket P6. Die Oberfläche (Kalender, Touren) baut darauf auf.
//
// Eingabe
//  placements[] { id, active, intervalDays, startDate, rule: 'rhythmus' | 'ab-ist', pauses: [{ from, to, reason, mode? }],
//                 objectId, … }  – Liegeplätze (matten/matten.json); fehlt rule, gilt 'rhythmus'
//  done[]       { placementId, date }  – bestätigte Wechsel (aus den Touren; Tag des tatsächlichen Wechsels)
//  jobs[]       vorhandene Einsätze (matten/einsaetze-<Jahr>.json), siehe unten
//  closures[]   { from, to, reason?, mode? }  – Betriebsurlaub für alle Liegeplätze
//  von, bis     Planungszeitraum (je einschließlich)
//
// Einsatz (job) { key: '<placementId>:<Solltermin>', placementId, due (Solltermin), planned (verschoben auf; fehlt =
//                 am Solltermin), status, reason, doneOn, tourId, createdAt/By, updatedAt/By }
//  status  geplant | in-tour | erledigt | teilweise | nicht-durchgefuehrt | ausgesetzt | nachzuholen | verworfen
//          offen (zählt für „fällig“ und „überfällig“): geplant, in-tour, nachzuholen, nicht-durchgefuehrt
//          erledigt und teilweise sind Wechsel; ausgesetzt und verworfen sind ohne Wechsel abgeschlossen.
//
// Regeln
//  - Der Schlüssel <placementId>:<Solltermin> ist eindeutig. jobsFor legt nur an, was fehlt: vorhandene Schlüssel
//    bleiben unverändert mit ihrem Status (erneutes Planen erzeugt keine Doppel).
//  - 'rhythmus' (fest ab Starttermin): Solltermine = startDate + n × intervalDays, unabhängig von Verschiebungen und
//    vom tatsächlichen Wechseltag.
//  - 'ab-ist' (ab letztem Wechsel): nächster Solltermin = letzter bestätigter Wechsel + Intervall, ohne Wechsel der
//    Starttermin. Weiter voraus ist nichts festgelegt, darum gibt es je Liegeplatz höchstens einen offenen Einsatz;
//    der nächste entsteht, wenn der vorige erledigt, ausgesetzt oder verworfen ist (Vorschau: dueDates).
//  - Verschieben setzt nur planned (shiftJob): Solltermin, Schlüssel und Rhythmus bleiben. Nachholen einplanen
//    (catchUpJob) ebenso, mit Status 'nachzuholen' (auch für ausgesetzte und verworfene Einsätze).
//  - Pause des Liegeplatzes oder Betriebsurlaub am Solltermin: Einsatz mit Status 'ausgesetzt' (Wechsel entfällt) oder –
//    eingestellt mit skip 'nachholen' bzw. mode 'nachholen' an der Pause – 'nachzuholen', geplant am ersten Tag nach der
//    Pause (liegt der in einer weiteren Pause, am ersten freien Tag danach). Pause ohne Ende: immer 'ausgesetzt'.
//  - Nicht durchgeführt (markNotDone): Status 'nachzuholen'; der Einsatz bleibt offen und sichtbar, bis er erledigt
//    oder verworfen ist, und ist ab dem Tag nach seinem Termin überfällig.
//  - Inaktive Liegeplätze bekommen keine neuen Einsätze; vorhandene bleiben (jobsFor meldet geplante unter review).

import { addDays, dayIndex, isoWeek, lastOfMonth, mondayOf } from './dates.js'

export const RULES = { rhythmus: 'fester Rhythmus ab Starttermin', 'ab-ist': 'ab letztem Wechsel' }
export const JOB_STATUS = {
  geplant: 'geplant',
  'in-tour': 'in Tour',
  erledigt: 'erledigt',
  teilweise: 'teilweise erledigt',
  'nicht-durchgefuehrt': 'nicht durchgeführt',
  ausgesetzt: 'ausgesetzt',
  nachzuholen: 'nachzuholen',
  verworfen: 'verworfen',
}
export const OPEN_STATUS = ['geplant', 'in-tour', 'nachzuholen', 'nicht-durchgefuehrt']
export const DONE_STATUS = ['erledigt', 'teilweise']
export const SKIP_MODES = { entfaellt: 'Wechsel entfällt', nachholen: 'am ersten Tag danach nachholen' }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isIso = (d) => typeof d === 'string' && ISO.test(d)
const LIMIT = 4000 // Schutz gegen Endlosschleifen (Pausenketten, sehr lange Zeiträume)

export const jobKey = (placementId, due) => `${placementId}:${due}`
/** Tag, an dem der Einsatz stattfinden soll: verschoben (planned), sonst der Solltermin. */
export const jobDate = (job) => job?.planned || job?.due || ''
export const isOpen = (job) => OPEN_STATUS.includes(job?.status)
export const ruleOf = (p) => (p?.rule === 'ab-ist' ? 'ab-ist' : 'rhythmus')
const intervalOf = (p) => {
  const n = Number(p?.intervalDays)
  return Number.isInteger(n) && n >= 1 ? n : 0
}
/** Liegeplatz plant mit: aktiv, gültiges Intervall und Starttermin. */
export const plannable = (p) => !!p && p.active !== false && !!p.id && intervalOf(p) > 0 && isIso(p.startDate)

const byDateKey = (a, b) => jobDate(a).localeCompare(jobDate(b)) || String(a.key).localeCompare(String(b.key))

// ---------------------------------------------------------------- Pausen

/** Pause bzw. Betriebsurlaub an diesem Tag (einschließlich von und bis; ohne bis: bis auf Weiteres). */
const covers = (pause, date) => !!pause && isIso(pause.from) && pause.from <= date && (!pause.to || date <= pause.to)

/** Erste Pause des Liegeplatzes, sonst erster Betriebsurlaub an diesem Tag: { ...pause, kind: 'pause' | 'betriebsurlaub' } oder null. */
export function pauseOn(placement, date, closures = []) {
  const own = (placement?.pauses || []).find((x) => covers(x, date))
  if (own) return { ...own, kind: 'pause' }
  const all = (closures || []).find((x) => covers(x, date))
  return all ? { ...all, kind: 'betriebsurlaub' } : null
}

/** Erster Tag nach der Pause, der in keiner weiteren Pause liegt; null bei einer Pause ohne Ende. */
export function dayAfterPause(placement, date, closures = []) {
  let d = date
  for (let i = 0; i < LIMIT; i++) {
    const p = pauseOn(placement, d, closures)
    if (!p) return d
    if (!p.to) return null
    d = addDays(p.to, 1)
  }
  return null
}

const pauseText = (p) => p.reason || (p.kind === 'betriebsurlaub' ? 'Betriebsurlaub' : 'Pause')

/**
 * Was eine Pause bzw. ein Betriebsurlaub am Tag date mit dem Einsatz zum Solltermin due macht: null (keine Pause), sonst
 * { status: 'nachzuholen', planned, reason } oder { status: 'ausgesetzt', reason }. Nachgeholt wird mit skip 'nachholen'
 * bzw. mode 'nachholen' an der Pause; beim festen Rhythmus nur, wenn der Tag nach der Pause vor dem nächsten Solltermin
 * liegt (sonst ersetzt der nächste reguläre Wechsel das Nachholen). Gilt beim Planen und für schon geplante Einsätze.
 */
export function pauseEffect(placement, date, due, { closures = [], skip = 'entfaellt' } = {}) {
  const p = pauseOn(placement, date, closures)
  if (!p) return null
  const mode = SKIP_MODES[p.mode] ? p.mode : SKIP_MODES[skip] ? skip : 'entfaellt'
  const after = mode === 'nachholen' ? dayAfterPause(placement, date, closures) : null
  const next = ruleOf(placement) === 'rhythmus' ? addDays(due, intervalOf(placement)) : ''
  if (after && (!next || after < next)) return { status: 'nachzuholen', planned: after, reason: `${pauseText(p)}: nachholen` }
  return { status: 'ausgesetzt', reason: pauseText(p) }
}

/** Einsatz für einen Solltermin, mit Pause: ausgesetzt bzw. nachzuholen (pauseEffect). */
function newJob(placement, due, { closures, skip, now, by }) {
  const job = { key: jobKey(placement.id, due), placementId: placement.id, due, status: 'geplant', createdAt: now, createdBy: by }
  const effect = pauseEffect(placement, due, due, { closures, skip })
  return effect ? { ...job, ...effect } : job
}

// ---------------------------------------------------------------- Solltermine

/** Letzter Tag mit Wechsel: bestätigte Wechsel und erledigte Einsätze (doneOn, sonst Termin) des Liegeplatzes. */
export function lastDone(placementId, { done = [], jobs = [] } = {}) {
  let last = ''
  for (const x of done || []) if (x?.placementId === placementId && isIso(x.date) && x.date > last) last = x.date
  for (const j of jobs || []) {
    if (j?.placementId !== placementId || !DONE_STATUS.includes(j.status)) continue
    const d = j.doneOn || jobDate(j)
    if (isIso(d) && d > last) last = d
  }
  return last
}

/** Erster Solltermin: 'ab-ist' letzter Wechsel + Intervall (nicht vor dem Starttermin), sonst der Starttermin. */
function firstDue(placement, { done = [], jobs = [] } = {}) {
  if (ruleOf(placement) !== 'ab-ist') return placement.startDate
  const last = lastDone(placement.id, { done, jobs })
  const next = last ? addDays(last, intervalOf(placement)) : ''
  return next > placement.startDate ? next : placement.startDate
}

/**
 * Solltermine eines Liegeplatzes im Zeitraum (ohne Pausen und vorhandene Einsätze zu prüfen, z. B. als Vorschau im
 * Kalender). 'rhythmus': startDate + n × Intervall; 'ab-ist': ab dem letzten Wechsel (done, erledigte jobs) bzw. dem
 * Starttermin fortgeschrieben – eine Annahme, die sich mit jedem tatsächlichen Wechsel verschiebt.
 */
export function dueDates(placement, { von, bis, done = [], jobs = [] } = {}) {
  const step = intervalOf(placement)
  if (!step || !isIso(placement?.startDate) || !isIso(von) || !isIso(bis) || von > bis) return []
  const first = firstDue(placement, { done, jobs })
  const skipN = Math.max(0, Math.ceil((dayIndex(von) - dayIndex(first)) / step))
  const out = []
  for (let d = addDays(first, skipN * step), i = 0; d <= bis && i < LIMIT; d = addDays(d, step), i++) out.push(d)
  return out
}

// ---------------------------------------------------------------- Einsätze erzeugen

/**
 * Einsätze für den Zeitraum von–bis (je einschließlich) ergänzen.
 * Liefert { jobs (vorhandene unverändert und neue), added (nur die neuen), review }, je nach Termin sortiert.
 * review: vorhandene, noch nicht eingeplante Einsätze (Status 'geplant'), die nicht mehr passen – Liegeplatz inaktiv oder
 * gelöscht, Termin jetzt in einer Pause bzw. im Betriebsurlaub: [{ key, why: 'inaktiv' | 'geloescht' | 'pause', text }].
 * Optionen: skip 'entfaellt' (Vorgabe) | 'nachholen' für Pausen ohne eigenes mode; now, by für createdAt/createdBy.
 * 'ab-ist': ein überfälliger nächster Termin vor von wird ebenfalls angelegt (sonst bliebe der Liegeplatz unsichtbar);
 * nie vor dem Starttermin.
 */
export function jobsFor({ placements = [], done = [], jobs = [], closures = [], von, bis, skip = 'entfaellt', now = new Date().toISOString(), by = '' } = {}) {
  const have = new Map((jobs || []).filter((j) => j?.key).map((j) => [j.key, j]))
  const added = []
  const opts = { closures, skip: SKIP_MODES[skip] ? skip : 'entfaellt', now, by }
  const add = (job) => {
    if (have.has(job.key)) return false
    have.set(job.key, job)
    added.push(job)
    return true
  }
  if (isIso(von) && isIso(bis) && von <= bis) {
    for (const p of placements || []) {
      if (!plannable(p)) continue
      if (ruleOf(p) === 'rhythmus') {
        for (const due of dueDates(p, { von, bis })) add(newJob(p, due, opts))
        continue
      }
      // ab-ist: höchstens ein offener Einsatz; ausgesetzte bzw. verworfene Termine zählen als durchlaufen
      const step = intervalOf(p)
      const mine = [...have.values()].filter((j) => j.placementId === p.id)
      if (mine.some(isOpen)) continue
      let due = firstDue(p, { done, jobs: mine })
      for (let i = 0; i < LIMIT && due <= bis; i++) {
        const old = have.get(jobKey(p.id, due))
        const job = old || newJob(p, due, opts)
        if (!old) add(job)
        if (isOpen(job)) break
        if (DONE_STATUS.includes(job.status)) break // Wechsel an diesem Termin: lastDone zählt ihn beim nächsten Lauf
        due = addDays(due, step)
      }
    }
  }
  const byId = new Map((placements || []).map((p) => [p?.id, p]))
  const review = []
  for (const j of jobs || []) {
    if (j?.status !== 'geplant') continue
    const p = byId.get(j.placementId)
    if (!p) review.push({ key: j.key, why: 'geloescht', text: 'Liegeplatz gibt es nicht mehr' })
    else if (p.active === false) review.push({ key: j.key, why: 'inaktiv', text: 'Liegeplatz ist inaktiv' })
    else {
      const pause = pauseOn(p, jobDate(j), closures)
      if (pause) review.push({ key: j.key, why: 'pause', text: `${pauseText(pause)} am Termin` })
    }
  }
  return { jobs: [...have.values()].sort(byDateKey), added: added.sort(byDateKey), review }
}

// ---------------------------------------------------------------- Einsätze ändern (liefern eine geänderte Kopie)

const touch = (job, change, { now = new Date().toISOString(), by = '' } = {}) => ({ ...job, ...change, updatedAt: now, updatedBy: by })

/** Verschieben auf einen anderen Tag: nur planned ändert sich (zurück auf den Solltermin entfernt planned). */
export function shiftJob(job, date, opts = {}) {
  if (!isIso(date)) return job
  const out = touch(job, {}, opts)
  if (date === job.due) delete out.planned
  else out.planned = date
  if (opts.reason !== undefined) out.reason = opts.reason
  return out
}

/** Nicht durchgeführt (z. B. kein Zugang): bleibt als 'nachzuholen' offen, bis erledigt oder verworfen. */
export const markNotDone = (job, { reason = '', ...opts } = {}) => touch(job, { status: 'nachzuholen', reason: reason || 'nicht durchgeführt' }, opts)

/** Wechsel bestätigt (oder nur teilweise): Status und Tag des Wechsels. */
export const markDone = (job, date, { partial = false, ...opts } = {}) => touch(job, { status: partial ? 'teilweise' : 'erledigt', doneOn: isIso(date) ? date : jobDate(job) }, opts)

/**
 * Nachholen einplanen: ein ausgesetzter, verworfener oder offener Einsatz wird 'nachzuholen' am Tag date (Solltermin,
 * Schlüssel und Rhythmus bleiben; date gleich dem Solltermin entfernt planned).
 */
export function catchUpJob(job, date, { reason = '', ...opts } = {}) {
  if (!isIso(date)) return job
  return { ...shiftJob(job, date, opts), status: 'nachzuholen', reason: reason || 'nachholen' }
}

/** Von Hand aussetzen (Wechsel entfällt) bzw. einen nachzuholenden Einsatz verwerfen. */
export const skipJob = (job, { reason = '', ...opts } = {}) => touch(job, { status: 'ausgesetzt', reason: reason || job.reason || 'ausgesetzt' }, opts)
export const discardJob = (job, { reason = '', ...opts } = {}) => touch(job, { status: 'verworfen', reason: reason || job.reason || 'verworfen' }, opts)

// ---------------------------------------------------------------- Abfragen

/** Offene Einsätze an diesem Tag (verschobene am neuen Tag). */
export const dueOn = (jobs = [], date) => (jobs || []).filter((j) => isOpen(j) && jobDate(j) === date).sort(byDateKey)

/** Offene Einsätze mit Termin vor heute (auch nachzuholende), älteste zuerst. */
export const overdue = (jobs = [], today) => (jobs || []).filter((j) => isOpen(j) && jobDate(j) < today).sort(byDateKey)

/** Tage überfällig (0, wenn nicht überfällig). */
export const daysOverdue = (job, today) => (isOpen(job) && jobDate(job) < today ? dayIndex(today) - dayIndex(jobDate(job)) : 0)

/**
 * Nächster Wechsel eines Liegeplatzes ab heute: { date (Tag), due (Solltermin), key, job (vorhandener Einsatz oder null),
 * overdue } oder null (inaktiv, ohne Intervall, Pause ohne Ende). Ein offener Einsatz geht vor (auch überfällig);
 * sonst der nächste Solltermin ab heute, der nicht ausfällt (Pausen und Betriebsurlaub wie jobsFor).
 */
export function nextDue(placement, { done = [], jobs = [], closures = [], today, skip = 'entfaellt' } = {}) {
  if (!plannable(placement) || !isIso(today)) return null
  const mine = (jobs || []).filter((j) => j?.placementId === placement.id)
  const open = mine.filter(isOpen).sort(byDateKey)[0]
  if (open) return { date: jobDate(open), due: open.due, key: open.key, job: open, overdue: jobDate(open) < today }
  const have = new Map(mine.map((j) => [j.key, j]))
  const step = intervalOf(placement)
  let due = firstDue(placement, { done, jobs: mine })
  if (ruleOf(placement) === 'rhythmus' && due < today) due = addDays(due, Math.ceil((dayIndex(today) - dayIndex(due)) / step) * step)
  for (let i = 0; i < LIMIT; i++, due = addDays(due, step)) {
    const old = have.get(jobKey(placement.id, due))
    if (old && !isOpen(old)) continue // schon erledigt, ausgesetzt oder verworfen
    const job = newJob(placement, due, { closures, skip: SKIP_MODES[skip] ? skip : 'entfaellt', now: '', by: '' })
    if (job.status === 'ausgesetzt') continue
    const date = jobDate(job)
    return { date, due, key: job.key, job: null, overdue: date < today }
  }
  return null
}

// ---------------------------------------------------------------- Kalender

/** Einsätze je Tag (Tag = jobDate): Map 'YYYY-MM-DD' → Einsätze, sortiert. */
export function byDate(jobs = []) {
  const out = new Map()
  for (const j of [...(jobs || [])].sort(byDateKey)) {
    const d = jobDate(j)
    if (!out.has(d)) out.set(d, [])
    out.get(d).push(j)
  }
  return out
}

/** Einsätze eines Tages je Objekt (ein Stopp je Objekt): [{ objectId, jobs }], Reihenfolge nach erstem Schlüssel. */
export function groupByObject(jobs = [], placements = []) {
  const objOf = new Map((placements || []).map((p) => [p?.id, p?.objectId || '']))
  const out = new Map()
  for (const j of [...(jobs || [])].sort(byDateKey)) {
    const o = objOf.get(j.placementId) ?? ''
    if (!out.has(o)) out.set(o, [])
    out.get(o).push(j)
  }
  return [...out].map(([objectId, list]) => ({ objectId, jobs: list }))
}

const weekLabel = (monday) => {
  const w = isoWeek(monday)
  return `${w.year}-W${String(w.week).padStart(2, '0')}`
}

/** Woche ab dem Montag des Tages: { monday, week: '2026-W45', days: [{ date, jobs }] × 7 }. */
export function calendarWeek(jobs = [], date) {
  const monday = mondayOf(date)
  const map = byDate(jobs)
  return { monday, week: weekLabel(monday), days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => ({ date: d, jobs: map.get(d) || [] })) }
}

/**
 * Monat als Raster aus ganzen Wochen (Montag bis Sonntag): { month: 'YYYY-MM', weeks: [{ monday, week, days: [{ date,
 * inMonth, jobs }] }], count (offene Einsätze im Monat) }.
 */
export function calendarMonth(jobs = [], ym) {
  const first = `${ym}-01`
  const last = lastOfMonth(first)
  const map = byDate(jobs)
  const weeks = []
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push({ monday, week: weekLabel(monday), days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => ({ date: d, inMonth: d.slice(0, 7) === ym, jobs: map.get(d) || [] })) })
  }
  const count = (jobs || []).filter((j) => isOpen(j) && jobDate(j).slice(0, 7) === ym).length
  return { month: ym, weeks, count }
}
