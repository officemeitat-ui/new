// Handlungsbedarf: was muss (neu) zugeteilt werden?
//  - periodische Leistungen (14-tägig, monatlich, quartalsweise …) mit Status
//  - Auswirkungen einer Abwesenheit (Urlaub, Krankenstand) auf Einsätze und Stunden
//  - Übergabe aller betroffenen Einsätze an eine Person
//  - Saldo-Korrekturen bei nachträglichen Änderungen veröffentlichter Wochen

import { weeklyHoursAt } from './contract.js'
import { mondayOf } from './dates.js'
import { PlanState } from './plan.js'
import { findAbsence } from './rules.js'
import { evaluateCandidate } from './scheduler.js'

const byStart = (a, b) => a.start - b.start

const WEEK_RHYTHM = { 1: 'wöchentlich', 2: '14-tägig', 3: 'alle 3 Wochen', 4: 'alle 4 Wochen' }
const MONTH_RHYTHM = { 1: 'monatlich', 2: 'alle 2 Monate', 3: 'quartalsweise', 6: 'halbjährlich', 12: 'jährlich' }
export const RHYTHM_ORDER = ['wöchentlich', '14-tägig', 'alle 3 Wochen', 'alle 4 Wochen', 'monatlich', 'alle 2 Monate', 'quartalsweise', 'halbjährlich', 'jährlich', 'einmalig']

/** Kategorie des Rhythmus, z. B. "14-tägig" oder "quartalsweise". */
export function rhythmCategory(task) {
  const r = task.recurrence
  if (r.type === 'once') return 'einmalig'
  if (r.type === 'monthly') return MONTH_RHYTHM[r.everyMonths || 1] || `alle ${r.everyMonths} Monate`
  return WEEK_RHYTHM[r.everyWeeks || 1] || `alle ${r.everyWeeks} Wochen`
}

export const isPeriodic = (task) => !!task && rhythmCategory(task) !== 'wöchentlich'

/**
 * Zuteilungsstatus eines Einsatzes:
 *  'entfaellt'  – entfällt (Feiertag, diese Woche)
 *  'zugeteilt'  – genug anwesende Personen eingeteilt
 *  'stammkraft' – Woche noch nicht geplant, Stammkraft ist da und wird automatisch eingeteilt
 *  'zuteilen'   – Handlungsbedarf (keine Stammkraft, Stammkraft abwesend, eingeteilte Person abwesend)
 */
export function staffingStatus(ctx, state, inst, isPlanned = () => true) {
  if (inst.status === 'cancelled') return { status: 'entfaellt', reason: 'entfällt' }
  const assigned = state.assigned(inst.key).map((a) => a.employeeId).filter((id) => ctx.employeesById.has(id))
  const absentAssigned = assigned.filter((id) => findAbsence(ctx, id, inst.date))
  const working = assigned.filter((id) => !absentAssigned.includes(id))
  const missing = inst.staff - working.length
  if (missing <= 0) return { status: 'zugeteilt', working, missing: 0 }
  const regulars = inst.regulars.filter((id) => ctx.employeesById.has(id))
  const freeRegulars = regulars.filter((id) => !assigned.includes(id) && !findAbsence(ctx, id, inst.date))
  if (!isPlanned(mondayOf(inst.date)) && !absentAssigned.length && working.length + freeRegulars.length >= inst.staff) return { status: 'stammkraft', working, freeRegulars, missing }
  let reason = 'nicht besetzt'
  if (absentAssigned.length) reason = `eingeteilte Person abwesend (${findAbsence(ctx, absentAssigned[0], inst.date).type})`
  else if (!regulars.length) reason = 'keine Stammkraft hinterlegt'
  else if (regulars.some((id) => findAbsence(ctx, id, inst.date))) reason = `Stammkraft ${findAbsence(ctx, regulars.find((id) => findAbsence(ctx, id, inst.date)), inst.date).type}`
  else reason = 'Stammkraft nicht einteilbar'
  return { status: 'zuteilen', working, absentAssigned, missing, reason }
}

/** Periodische Leistungen im Zeitraum, mit Kategorie und Status. */
export function periodicDue(ctx, instances, state, tasks, { from, to, isPlanned }) {
  const tasksById = new Map(tasks.map((t) => [t.id, t]))
  return instances
    .filter((i) => i.date >= from && i.date <= to && isPeriodic(tasksById.get(i.taskId)))
    .sort(byStart)
    .map((inst) => ({ inst, task: tasksById.get(inst.taskId), rhythm: rhythmCategory(tasksById.get(inst.taskId)), ...staffingStatus(ctx, state, inst, isPlanned) }))
}

/**
 * Was eine Abwesenheit betrifft: alle Einsätze im Zeitraum, bei denen die Person
 * Stammkraft oder eingeteilt ist. Liefert Zeilen und Stundensummen.
 */
export function absenceImpact(ctx, instances, state, absence) {
  const empId = absence.employeeId
  const rows = instances
    .filter((i) => i.date >= absence.from && i.date <= absence.to && (i.regulars.includes(empId) || state.has(empId, i.key)))
    .sort(byStart)
    .map((inst) => {
      const assigned = state.assigned(inst.key)
      const stillAssigned = assigned.some((a) => a.employeeId === empId)
      const covering = assigned.map((a) => a.employeeId).filter((id) => id !== empId && ctx.employeesById.has(id) && !findAbsence(ctx, id, inst.date))
      const cancelled = inst.status === 'cancelled'
      const open = cancelled ? 0 : Math.max(0, inst.staff - covering.length)
      return { inst, regular: inst.regulars.includes(empId), stillAssigned, locked: assigned.some((a) => a.employeeId === empId && a.locked), covering, open, cancelled }
    })
  const active = rows.filter((r) => !r.cancelled)
  return {
    rows,
    minutes: active.reduce((s, r) => s + r.inst.net, 0),
    openMinutes: active.filter((r) => r.open > 0).reduce((s, r) => s + r.inst.net, 0),
    coveredMinutes: active.filter((r) => r.open === 0).reduce((s, r) => s + r.inst.net, 0),
    stillAssigned: rows.filter((r) => r.stillAssigned),
  }
}

// Warnungen, die eine Sammelübergabe trotzdem verhindern (Mehrstunden, Einschulung, Schlüssel sind erlaubt).
const HANDOVER_BLOCKING = new Set(['AVAILABILITY', 'TRAVEL', 'DAILY_LONG', 'WEEKLY_48'])

/**
 * Einsätze nacheinander an eine Person übergeben, soweit ohne Verstoß möglich.
 * Mehrstunden sind erlaubt, weil die Person bewusst gewählt wurde. Verändert `state`.
 */
export function handOver(ctx, state, insts, emp, { locked = false } = {}) {
  const done = []
  const skipped = []
  for (const inst of [...insts].sort(byStart)) {
    if (state.has(emp.id, inst.key)) {
      done.push(inst)
      continue
    }
    const ev = evaluateCandidate(ctx, state, emp, inst, { asRegular: true })
    const blocking = ev.issues.filter((i) => i.severity === 'error' || HANDOVER_BLOCKING.has(i.code))
    if (!blocking.length) {
      state.assign(emp.id, inst.key, locked)
      done.push(inst)
    } else {
      skipped.push({ inst, reasons: blocking.map((i) => i.message) })
    }
  }
  return { done, skipped }
}

/**
 * Wer könnte wie viele der Einsätze übernehmen? Simuliert die Übergabe je Person.
 * Reihenfolge: meiste Stunden, gleiches Revier, wenigste Mehrstunden über den
 * Vertrag (in den betroffenen Wochen), schon im Objekt eingeschult.
 */
export function rankHandover(ctx, state, insts, { excludeId = null, team = null } = {}) {
  const all = [...state.instByKey.values()]
  const weeks = new Set(insts.map((i) => mondayOf(i.date)))
  return ctx.employees
    .filter((e) => e.id !== excludeId)
    .map((emp) => {
      const sim = new PlanState(all, state.toObject())
      const { done, skipped } = handOver(ctx, sim, insts, emp)
      let overMinutes = 0
      for (const monday of weeks) {
        const planned = sim.instancesOf(emp.id).filter((i) => mondayOf(i.date) === monday).reduce((s, i) => s + i.net, 0)
        overMinutes += Math.max(0, planned - weeklyHoursAt(emp, monday) * 60)
      }
      const trained = done.filter((i) => (emp.trained || []).includes(i.objectId)).length
      return { emp, done: done.length, skipped: skipped.length, minutes: done.reduce((s, i) => s + i.net, 0), overMinutes, trained, sameTeam: !!team && emp.team === team }
    })
    .filter((r) => r.done > 0)
    .sort((a, b) => b.minutes - a.minutes || Number(b.sameTeam) - Number(a.sameTeam) || a.overMinutes - b.overMinutes || b.trained - a.trained || a.emp.name.localeCompare(b.emp.name))
}

/** Saldo-Unterschiede zwischen alter und neuer Veröffentlichung einer Woche. */
export function saldoCorrections(before = {}, after = {}) {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...ids]
    .map((empId) => ({ empId, before: before[empId] || 0, after: after[empId] || 0, delta: (after[empId] || 0) - (before[empId] || 0) }))
    .filter((c) => c.delta !== 0)
}

/** Alle gebuchten Korrekturen von Wochen, die den Monat berühren. */
export function correctionsInMonth(published = {}, month) {
  const out = []
  for (const [monday, week] of Object.entries(published)) {
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10)
    if (monday.slice(0, 7) !== month && sunday.slice(0, 7) !== month) continue
    for (const c of week.corrections || []) out.push({ monday, ...c })
  }
  return out.sort((a, b) => a.monday.localeCompare(b.monday) || (a.at || '').localeCompare(b.at || ''))
}
