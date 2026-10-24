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

/** Niedriger ist besser. */
export function candidateCost(ctx, state, emp, inst, ev) {
  const week = mondayOf(inst.date)
  const own = state.instancesOf(emp.id).filter((i) => i.key !== inst.key)
  const weekMin = own.filter((i) => mondayOf(i.date) === week).reduce((s, i) => s + i.net, 0) + inst.net
  let cost = (weekMin / (Math.max(emp.weeklyHours || 0, 1) * 60)) * 100
  if (inst.regulars.includes(emp.id)) cost -= 50
  if (ev.issues.some((i) => i.code === 'NOT_TRAINED')) cost += 30
  const region = ctx.objectsById.get(inst.objectId)?.region
  if (region && emp.team && emp.team !== region) cost += 40 // Vertretung bevorzugt aus dem eigenen Revier
  if (own.some((i) => i.objectId === inst.objectId && mondayOf(i.date) === week)) cost -= 12
  const sameDay = own.filter((i) => i.date === inst.date)
  if (sameDay.some((i) => Math.abs(i.end - inst.start) <= 90 || Math.abs(inst.end - i.start) <= 90)) cost -= 8
  if (inst.isSunday || inst.holiday?.legal) cost += 10
  return cost
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
 * Plant den Zeitraum [from, to]. Bestehende Zuteilungen bleiben erhalten;
 * mit `replan` werden nicht fixierte Zuteilungen vorher entfernt.
 */
export function autoPlan(ctx, instances, assignments, { from, to, replan = false }) {
  const state = new PlanState(instances, assignments)
  const inRange = instances.filter((i) => i.status !== 'cancelled' && i.date >= from && i.date <= to)
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
      return { ...ev, regular, cost: candidateCost(ctx, state, emp, inst, ev) }
    })
    .sort((a, b) => {
      if (a.allowed !== b.allowed) return a.allowed ? -1 : 1
      const errors = (c) => c.issues.filter((i) => i.severity === 'error').length
      return errors(a) - errors(b) || a.blocking.length - b.blocking.length || a.cost - b.cost || a.emp.name.localeCompare(b.emp.name)
    })
}
