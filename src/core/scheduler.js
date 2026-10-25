// Automatische Einteilung:
//   1. Stammkräfte bekommen ihre Einsätze, sofern keine Regel verletzt wird.
//   2. Offene Einsätze (Urlaub, Krankenstand, ohne Stammkraft) werden nach
//      Engpass sortiert vergeben: wer die wenigsten passenden Leute hat, zuerst.
//   3. Reparatur: bleibt ein Einsatz offen, wird versucht, eine Person von
//      einem anderen (nicht fixierten) Einsatz freizuspielen.

import { mondayOf } from './dates.js'
import { PlanState } from './plan.js'
import { evaluateEmployee, findAbsence, fitsAvailability } from './rules.js'

// Warnungen, die die Automatik wie Verstöße behandelt (manuell bleibt alles möglich).
const SOFT_BLOCKING = new Set(['AVAILABILITY', 'TRAVEL', 'DAILY_LONG', 'WEEKLY_48'])
// Gründe, die sich durch Umplanen anderer Einsätze nicht beheben lassen.
const PERSONAL_BLOCKERS = new Set(['ABSENT', 'SKILL', 'AVAILABILITY', 'NOT_TRAINED', 'MINOR_NIGHT', 'MINOR_SUNDAY', 'MINOR_HOLIDAY'])

function isSoftBlocking(issue, rules) {
  if (issue.severity !== 'warning') return false
  if (issue.code === 'CONTRACT') return issue.overMinutes > rules.autoExtraHoursPerWeek * 60
  return SOFT_BLOCKING.has(issue.code)
}

/** Was würde passieren, wenn `emp` den Einsatz `inst` zusätzlich übernimmt? */
export function evaluateCandidate(ctx, state, emp, inst, { asRegular = false } = {}) {
  const own = state.instancesOf(emp.id).filter((i) => i.key !== inst.key)
  const issues = evaluateEmployee(emp, [...own, inst], ctx).filter((i) => i.keys.includes(inst.key))
  const blocking = issues.filter((i) => i.severity === 'error' || (!asRegular && isSoftBlocking(i, ctx.rules)))
  return { emp, issues, blocking, allowed: blocking.length === 0 }
}

const hrs = (min) => (Math.round((min / 60) * 100) / 100).toLocaleString('de-AT')

/** Zeitkonto vor einer Woche: Startsaldo + veröffentlichte Wochen davor (zwischengespeichert). */
function balanceBefore(ctx, emp, monday) {
  ctx.balanceCache = ctx.balanceCache || new Map()
  const key = `${emp.id}|${monday}`
  if (!ctx.balanceCache.has(key)) {
    let total = Math.round((emp.startBalanceHours || 0) * 60)
    for (const [m, week] of Object.entries(ctx.published || {})) if (m < monday && week.status === 'veroeffentlicht') total += week.saldi?.[emp.id] || 0
    ctx.balanceCache.set(key, total)
  }
  return ctx.balanceCache.get(key)
}

/**
 * Warum passt (oder passt nicht) diese Person für den Einsatz? Liste von
 * Gründen mit Punkten: negativ spricht dafür, positiv dagegen. Die Summe ist
 * die Kosten für die Automatik, die Texte erklären den Vorschlag.
 */
export function candidateFactors(ctx, state, emp, inst, ev) {
  const factors = []
  const add = (code, points, text, good = points < 0) => factors.push({ code, points, text, good })
  const week = mondayOf(inst.date)
  const own = state.instancesOf(emp.id).filter((i) => i.key !== inst.key)
  const weekMin = own.filter((i) => mondayOf(i.date) === week).reduce((s, i) => s + i.net, 0)
  const contract = Math.max(emp.weeklyHours || 0, 1) * 60
  const free = contract - weekMin
  // Auslastung: wer noch Vertragsstunden frei hat, kommt zuerst
  add('load', ((weekMin + inst.net) / contract) * 100, free >= inst.net ? `noch ${hrs(free)} h frei laut Vertrag` : free > 0 ? `nur ${hrs(free)} h frei laut Vertrag` : `schon ${hrs(-free)} h über Vertrag`, free >= inst.net)
  if (inst.regulars.includes(emp.id)) add('regular', -50, 'Stammkraft')
  const region = ctx.objectsById.get(inst.objectId)?.region
  if (region && emp.team && emp.team !== region) add('region', 40, `anderes Revier (${emp.team})`)
  else if (region && emp.team === region) add('region', 0, 'gleiches Revier', true)
  if (ev?.issues.some((i) => i.code === 'NOT_TRAINED')) add('trained', 30, 'nicht eingeschult')
  else if ((emp.trained || []).includes(inst.objectId) && !inst.regulars.includes(emp.id)) add('trained', -5, 'im Objekt eingeschult')
  // Kontinuität: Kund:innen sehen lieber bekannte Gesichter
  const known = own.filter((i) => i.objectId === inst.objectId && i.date < week).length
  if (known && !inst.regulars.includes(emp.id)) add('known', -Math.min(15, known * 3), `kennt das Objekt (${known}× in den letzten Wochen)`)
  if (own.some((i) => i.objectId === inst.objectId && i.date === inst.date)) add('sameDay', -20, 'an dem Tag ohnehin im Objekt')
  else if (own.some((i) => i.objectId === inst.objectId && mondayOf(i.date) === week)) add('sameObject', -12, 'diese Woche schon im Objekt')
  const sameDay = own.filter((i) => i.date === inst.date)
  if (sameDay.some((i) => Math.abs(i.end - inst.start) <= 90 || Math.abs(inst.end - i.start) <= 90)) add('adjacent', -8, 'Einsatz direkt davor oder danach')
  // Zeitkonto ausgleichen: Minusstunden zuerst auffüllen, Plusstunden schonen
  const balance = balanceBefore(ctx, emp, week)
  if (Math.abs(balance) >= 120) add('balance', Math.max(-12, Math.min(12, balance / 60)) * 1.5, balance < 0 ? `Zeitkonto −${hrs(-balance)} h: gleicht Minusstunden aus` : `Zeitkonto +${hrs(balance)} h`)
  if (inst.isSunday || inst.holiday?.legal) add('sunday', 10, 'Sonn-/Feiertag')
  return factors
}

/** Niedriger ist besser. */
export function candidateCost(ctx, state, emp, inst, ev) {
  return candidateFactors(ctx, state, emp, inst, ev).reduce((s, f) => s + f.points, 0)
}

/** Kurze Begründung für einen Vorschlag: die wichtigsten Gründe dafür und dagegen. */
export function explain(factors, { good = 3, bad = 2 } = {}) {
  const byWeight = [...factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
  return { pro: byWeight.filter((f) => f.good).slice(0, good).map((f) => f.text), contra: byWeight.filter((f) => !f.good && f.points > 0 && f.code !== 'load').concat(byWeight.filter((f) => f.code === 'load' && !f.good)).slice(0, bad).map((f) => f.text) }
}

function bestCandidate(ctx, state, inst, exclude = new Set()) {
  let best = null
  for (const emp of ctx.employees) {
    if (exclude.has(emp.id) || state.has(emp.id, inst.key)) continue
    const ev = evaluateCandidate(ctx, state, emp, inst)
    if (!ev.allowed) continue
    const cost = candidateCost(ctx, state, emp, inst, ev)
    if (!best || cost < best.cost || (cost === best.cost && emp.name.localeCompare(best.emp.name) < 0)) best = { emp, cost }
  }
  return best
}

function countFill(stats, inst, empId) {
  if (inst.regulars.length && !inst.regulars.includes(empId)) stats.substitute++
  else stats.other++
}

function fillSlot(ctx, state, inst, stats) {
  while (state.count(inst.key) < inst.staff) {
    const best = bestCandidate(ctx, state, inst)
    if (!best) return
    state.assign(best.emp.id, inst.key)
    countFill(stats, inst, best.emp.id)
  }
}

function repairSlot(ctx, state, inst, { from, to }, stats) {
  for (const emp of ctx.employees) {
    if (state.count(inst.key) >= inst.staff) return
    if (state.has(emp.id, inst.key)) continue
    const ev = evaluateCandidate(ctx, state, emp, inst)
    if (ev.allowed) {
      state.assign(emp.id, inst.key)
      countFill(stats, inst, emp.id)
      continue
    }
    if (ev.blocking.some((i) => PERSONAL_BLOCKERS.has(i.code))) continue
    const conflictKeys = new Set(ev.blocking.flatMap((i) => i.keys).filter((k) => k !== inst.key))
    for (const key of conflictKeys) {
      const other = state.instByKey.get(key)
      if (!other || other.date < from || other.date > to) continue
      if (!state.has(emp.id, key) || state.isLocked(emp.id, key) || other.regulars.includes(emp.id)) continue
      state.unassign(emp.id, key)
      let swapped = false
      if (evaluateCandidate(ctx, state, emp, inst).allowed) {
        state.assign(emp.id, inst.key)
        const replacement = bestCandidate(ctx, state, other, new Set([emp.id]))
        if (replacement) {
          state.assign(replacement.emp.id, key)
          countFill(stats, inst, emp.id)
          swapped = true
        } else {
          state.unassign(emp.id, inst.key)
        }
      }
      if (swapped) break
      state.assign(emp.id, key)
    }
  }
}

/**
 * Plant den Zeitraum [from, to]. Optionen: `replan` verwirft vorher nicht
 * fixierte Einteilungen, `only` beschränkt auf bestimmte Einsätze (Schlüssel),
 * `regularsOnly` teilt nur die Stammkräfte ein (z. B. als Vorschau einer Woche).
 */
export function autoPlan(ctx, instances, assignments, { from, to, replan = false, only = null, regularsOnly = false }) {
  const state = new PlanState(instances, assignments)
  const inRange = instances.filter((i) => i.status !== 'cancelled' && i.date >= from && i.date <= to && (!only || only.has(i.key)))
  const stats = { regular: 0, substitute: 0, other: 0, released: 0 }
  for (const inst of inRange) {
    for (const a of [...state.assigned(inst.key)]) {
      if (a.locked) continue
      // Neu eingetragene Abwesenheit: nicht fixierte Einteilung freigeben
      if (replan || findAbsence(ctx, a.employeeId, inst.date)) {
        state.unassign(a.employeeId, inst.key)
        if (!replan) stats.released++
      }
    }
  }

  for (const inst of [...inRange].sort((a, b) => a.start - b.start)) {
    for (const id of inst.regulars) {
      if (state.count(inst.key) >= inst.staff) break
      const emp = ctx.employeesById.get(id)
      if (!emp || state.has(id, inst.key)) continue
      if (evaluateCandidate(ctx, state, emp, inst, { asRegular: true }).allowed) {
        state.assign(id, inst.key)
        stats.regular++
      }
    }
  }

  const open = () => inRange.filter((i) => state.count(i.key) < i.staff)
  if (regularsOnly) return { assignments: state.toObject(), stats, open: open().map((i) => i.key) }
  const staticOk = (emp, inst) => !findAbsence(ctx, emp.id, inst.date) && inst.skills.every((s) => (emp.skills || []).includes(s)) && fitsAvailability(emp, inst)
  const order = open()
    .map((inst) => ({ inst, pressure: ctx.employees.filter((e) => staticOk(e, inst)).length / (inst.staff - state.count(inst.key)) }))
    .sort((a, b) => a.pressure - b.pressure || a.inst.start - b.inst.start)
  for (const { inst } of order) fillSlot(ctx, state, inst, stats)

  for (const inst of open()) repairSlot(ctx, state, inst, { from, to }, stats)

  return { assignments: state.toObject(), stats, open: open().map((i) => i.key) }
}

/** Kandidatenliste für "Wer kann einspringen?". */
export function rankCandidates(ctx, state, inst) {
  return ctx.employees
    .filter((e) => !state.has(e.id, inst.key))
    .map((emp) => {
      const regular = inst.regulars.includes(emp.id)
      const ev = evaluateCandidate(ctx, state, emp, inst, { asRegular: regular })
      const factors = candidateFactors(ctx, state, emp, inst, ev)
      return { ...ev, regular, factors, cost: factors.reduce((s, f) => s + f.points, 0) }
    })
    .sort((a, b) => {
      if (a.allowed !== b.allowed) return a.allowed ? -1 : 1
      const errors = (c) => c.issues.filter((i) => i.severity === 'error').length
      return errors(a) - errors(b) || a.blocking.length - b.blocking.length || a.cost - b.cost || a.emp.name.localeCompare(b.emp.name)
    })
}
