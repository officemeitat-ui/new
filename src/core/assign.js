// Zuweisung im Stammplan: Wer übernimmt eine Leistung dauerhaft (Stammkraft)?
// Grundlage ist der Reinigungsplan (Objekt, Rhythmus, Zeit, Personen). Eine
// Person kommt infrage, wenn sie zu den Zeiten verfügbar ist, die Qualifikation
// hat und sich nichts mit ihren anderen Stammeinsätzen überschneidet (inkl.
// Fahrzeit). Unter diesen gewinnt, wer noch Vertragsstunden frei hat, im
// Revier ist, das Objekt kennt und direkt davor oder danach in der Nähe ist.

import { addDays, formatHours, isoWeekday, mondayOf, toMinutes, WEEKDAY_SHORT, weeksBetween } from './dates.js'
import { buildInstances, PlanState } from './plan.js'
import { evaluateEmployee, fitsWindow } from './rules.js'

/** Probe: 6 Wochen mit allen Stammeinsätzen + der neuen Leistung einplanen und mit den Prüfregeln bewerten. */
function probeErrors(ctx, task, emp, mine) {
  const from = mondayOf(task.recurrence.anchor || task.recurrence.date || '2026-01-05')
  const tasks = [...mine.tasks.filter((t) => t.id !== task.id), task].map((t) => ({ ...t, regulars: [emp.id] }))
  const insts = buildInstances({ objects: [...ctx.objectsById.values()], tasks }, from, addDays(from, 41), new Map(), ctx.rules)
  const st = new PlanState(insts, Object.fromEntries(insts.map((i) => [i.key, [{ employeeId: emp.id }]])))
  const own = new Set(insts.filter((i) => i.taskId === task.id).map((i) => i.key))
  const out = new Set()
  for (const i of evaluateEmployee(emp, st.instancesOf(emp.id), { ...ctx, absencesByEmployee: new Map() }))
    if (i.severity === 'error' && !['SKILL', 'NOT_TRAINED', 'MONTHLY_LIMIT'].includes(i.code) && i.keys.some((k) => own.has(k))) out.add(i.message.replace(/ \(.*$|:.*$/, ''))
  return [...out]
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const hrs = (min) => formatHours(Math.round(min))

/** Beginn und Ende einer Leistung in Minuten ab Mitternacht (Ende ggf. > 24 h). */
export function taskSpan(task) {
  const start = toMinutes(task.start)
  let end = toMinutes(task.end)
  if (end <= start) end += 1440
  return { start, end }
}

/** Dauer je Termin, netto nach Pause laut Regeln. */
export function taskNet(task, rules) {
  const { start, end } = taskSpan(task)
  const d = end - start
  return d - (d > rules.breakAfterH * 60 ? Math.max(task.breakMin || 0, rules.breakMin) : task.breakMin || 0)
}

/** Durchschnittliche Minuten pro Woche (Auslastung). Einmalige Leistungen zählen nicht. */
export function weeklyMinutes(task, rules) {
  const r = task.recurrence
  if (r.type === 'weekly') return (taskNet(task, rules) * r.weekdays.length) / (r.everyWeeks || 1)
  if (r.type === 'monthly') return (taskNet(task, rules) * 12) / (r.everyMonths || 1) / 52
  return 0
}

/** Wochentage, an denen die Leistung stattfinden kann (monatlich am festen Tag: unbestimmt). */
export function taskDays(task) {
  const r = task.recurrence
  if (r.type === 'weekly') return r.weekdays
  if (r.type === 'monthly') return r.mode === 'nth' ? [r.weekday] : []
  return r.date ? [isoWeekday(r.date)] : []
}

/** Können zwei Leistungen in derselben Woche am selben Tag stattfinden? */
function sameWeeks(a, b) {
  const ra = a.recurrence
  const rb = b.recurrence
  if (ra.type !== 'weekly' || rb.type !== 'weekly') return true
  const g = gcd(ra.everyWeeks || 1, rb.everyWeeks || 1)
  return g === 1 || weeksBetween(ra.anchor || '2026-01-05', rb.anchor || '2026-01-05') % g === 0
}

const when = (task) => `${taskDays(task).map((d) => WEEKDAY_SHORT[d - 1]).join(', ')} ${task.start}–${task.end}`

/** Überschneidungen (inkl. Fahrzeit) zwischen einer Leistung und anderen Leistungen derselben Person. */
export function conflictsWith(ctx, task, others) {
  const out = []
  const a = taskSpan(task)
  const days = taskDays(task)
  for (const other of others) {
    if (other.id === task.id || other.recurrence.type === 'once' || task.recurrence.type === 'once') continue
    const shared = taskDays(other).filter((d) => days.includes(d))
    if (!shared.length || !sameWeeks(task, other)) continue
    const b = taskSpan(other)
    const travel = other.objectId === task.objectId ? 0 : ctx.travel(task.objectId, other.objectId)
    const overlap = a.start < b.end && b.start < a.end
    const tight = !overlap && (b.start >= a.end ? b.start - a.end < travel : a.start - b.end < travel)
    if (overlap || tight) out.push({ task: other, days: shared, kind: overlap ? 'overlap' : 'travel', travel })
  }
  return out
}

/** Stammeinsätze je Person: Leistungen und Minuten pro Woche. */
export function regularLoad(ctx, tasks) {
  const load = new Map(ctx.employees.map((e) => [e.id, { minutes: 0, tasks: [] }]))
  for (const t of tasks) {
    for (const id of t.regulars || []) {
      const l = load.get(id)
      if (!l) continue
      l.tasks.push(t)
      l.minutes += weeklyMinutes(t, ctx.rules)
    }
  }
  return load
}

/**
 * Wie gut passt eine Person als Stammkraft für eine Leistung?
 * Liefert { emp, allowed, blockers[], factors[{ code, points, text, good }], cost, after }.
 */
export function evaluateRegular(ctx, task, emp, { tasks, load } = {}) {
  const r = ctx.rules
  const all = tasks || ctx.tasks
  const mine = (load || regularLoad(ctx, all)).get(emp.id) || { minutes: 0, tasks: [] }
  const blockers = []
  const factors = []
  const add = (code, points, text, good = points < 0) => factors.push({ code, points, text, good })
  const span = taskSpan(task)
  const days = taskDays(task)
  const obj = ctx.objectsById.get(task.objectId)

  const missing = (task.skills || []).filter((s) => !(emp.skills || []).includes(s))
  if (missing.length) blockers.push(`fehlt: ${missing.join(', ')}`)
  const unavailable = days.filter((d) => !fitsWindow(emp, d, span.start, span.end))
  if (unavailable.length) blockers.push(`nicht verfügbar ${unavailable.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')} ${task.start}–${task.end}`)
  if (emp.minor) {
    const ns = toMinutes(r.minor.nightStart)
    const ne = toMinutes(r.minor.nightEnd)
    if (span.end > ns || span.start < ne) blockers.push(`unter 18: Nachtruhe ${r.minor.nightStart}–${r.minor.nightEnd}`)
  }
  if (task.recurrence.type !== 'once') for (const m of probeErrors(ctx, task, emp, mine)) if (!blockers.includes(m)) blockers.push(m)
  for (const c of conflictsWith(ctx, task, mine.tasks)) {
    const o = ctx.objectsById.get(c.task.objectId)
    blockers.push(c.kind === 'overlap' ? `überschneidet sich mit ${o?.short || o?.name || ''} ${c.days.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')} ${c.task.start}–${c.task.end}` : `Fahrzeit ${c.travel} min zu ${o?.short || o?.name || ''} reicht nicht`)
  }

  // Auslastung: freie Vertragsstunden zuerst
  const minutes = weeklyMinutes(task, r)
  const contract = Math.max(1, (emp.weeklyHours || 0) * 60)
  const after = mine.minutes + minutes
  const free = contract - mine.minutes
  const freeText = free >= minutes ? `noch ${hrs(free)} h/Woche frei` : Math.round(free) > 0 ? `nur ${hrs(free)} h/Woche frei` : Math.round(free) === 0 ? 'Vertrag schon voll' : `schon ${hrs(-free)} h/Woche über Vertrag`
  add('load', (after / contract) * 40, freeText, free >= minutes)
  if (after > r.pay.fullTimeWeeklyH * 60) add('overtime', 40, `dann ${hrs(after)} h/Woche: Überstunden`)
  if (emp.maxMonthHours > 0 && (after * 52) / 12 > emp.maxMonthHours * 60) blockers.push(`über ${hrs(emp.maxMonthHours * 60)} h/Monat (geringfügig)`)

  if (obj?.region && emp.team && emp.team !== obj.region) add('region', 30, `anderes Revier (${emp.team})`)
  else if (obj?.region && emp.team === obj.region) add('region', -5, 'gleiches Revier')
  const trained = (emp.trained || []).includes(task.objectId)
  if (obj?.onlyTrained && !trained) add('trained', 25, 'nicht eingeschult')
  else if (trained) add('trained', -8, 'im Objekt eingeschult')
  if (mine.tasks.some((t) => t.objectId === task.objectId)) add('sameObject', -15, 'betreut das Objekt schon')
  // Anschluss: andere Stammeinsätze am selben Tag direkt davor oder danach (kurze Wege)
  const near = mine.tasks.find((t) => t.objectId !== task.objectId && taskDays(t).some((d) => days.includes(d)) && sameWeeks(task, t) && (() => {
    const b = taskSpan(t)
    const gap = b.start >= span.end ? b.start - span.end : span.start - b.end
    return gap >= 0 && gap <= 60 + ctx.travel(task.objectId, t.objectId)
  })())
  if (near) add('adjacent', -10, `Anschluss an ${ctx.objectsById.get(near.objectId)?.short || 'Einsatz'} ${near.start}–${near.end}`)

  return { emp, allowed: !blockers.length, blockers, factors, cost: factors.reduce((s, f) => s + f.points, 0), after, minutes }
}

/** Alle Personen für eine Leistung, passende zuerst (nach Kosten), dann die übrigen mit Grund. */
export function rankRegulars(ctx, task, { tasks, load } = {}) {
  const all = tasks || ctx.tasks
  const l = load || regularLoad(ctx, all)
  return ctx.employees
    .filter((e) => !(task.regulars || []).includes(e.id))
    .map((e) => evaluateRegular(ctx, task, e, { tasks: all, load: l }))
    .sort((a, b) => b.allowed - a.allowed || a.cost - b.cost || a.emp.name.localeCompare(b.emp.name))
}

/** Offene Plätze einer Leistung (Personen laut Plan minus Stammkräfte). */
export const openSlots = (task) => Math.max(0, (task.staff || 1) - (task.regulars || []).length)

/**
 * Vorschläge für alle offenen Plätze, ohne Doppelbelegung: schwierigste
 * Leistungen zuerst (wenigste passende Personen), jede Zuweisung zählt für
 * die nächsten mit. Liefert [{ task, emp, factors }].
 */
export function suggestRegulars(ctx, { taskIds = null } = {}) {
  const tasks = ctx.tasks.map((t) => ({ ...t, regulars: [...(t.regulars || [])] }))
  const todo = tasks.filter((t) => t.recurrence.type !== 'once' && openSlots(t) && (!taskIds || taskIds.includes(t.id)))
  const out = []
  let load = regularLoad(ctx, tasks)
  const allowedCount = (t) => rankRegulars(ctx, t, { tasks, load }).filter((x) => x.allowed).length
  const order = todo.map((t) => ({ t, n: allowedCount(t) })).sort((a, b) => a.n - b.n || weeklyMinutes(b.t, ctx.rules) - weeklyMinutes(a.t, ctx.rules))
  for (const { t } of order) {
    while (openSlots(t)) {
      const best = rankRegulars(ctx, t, { tasks, load }).find((x) => x.allowed)
      if (!best) break
      t.regulars.push(best.emp.id)
      out.push({ task: ctx.tasks.find((x) => x.id === t.id), emp: best.emp, factors: best.factors })
      load = regularLoad(ctx, tasks)
    }
  }
  return out
}

/** Kurztext „Mo, Mi, Fr 17:30–19:30“. */
export const whenText = when
