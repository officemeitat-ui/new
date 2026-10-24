// Erzeugt aus den Leistungen (Stammplan) die konkreten Einsätze eines Zeitraums
// und wendet Feiertagsregeln sowie Einzeländerungen ("nur diese Woche") an.

import { addDays, dayIndex, eachDay, isoWeekday, toMinutes, weeksBetween } from './dates.js'

export const HOLIDAY_RULES = {
  entfaellt: 'entfällt',
  findet_statt: 'findet statt (mit Zuschlag)',
  verschieben: 'auf nächsten Werktag verschieben',
}

export function taskOccursOn(task, date) {
  const r = task.recurrence
  if (r.type === 'once') return r.date === date
  if (!r.weekdays.includes(isoWeekday(date))) return false
  if (r.from && date < r.from) return false
  if (r.until && date > r.until) return false
  const every = r.everyWeeks || 1
  if (every > 1) {
    const diff = weeksBetween(r.anchor || r.from || date, date)
    return ((diff % every) + every) % every === 0
  }
  return true
}

export function nextWorkday(date, holidays) {
  let d = addDays(date, 1)
  while (isoWeekday(d) > 5 || holidays.has(d)) d = addDays(d, 1)
  return d
}

/**
 * Ein Einsatz (Instanz) ist eine Leistung an einem konkreten Tag.
 * `key` = Ursprungsdatum|Leistung bleibt stabil, auch wenn der Einsatz verschoben wird.
 * status: 'normal' | 'moved' (verschoben) | 'cancelled' (entfällt)
 */
export function buildInstances({ objects, tasks, overrides = {} }, from, to, holidays, rules) {
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const out = []
  for (const date of eachDay(from, to)) {
    for (const task of tasks) {
      if (!taskOccursOn(task, date)) continue
      const obj = objectsById.get(task.objectId)
      if (!obj) continue
      const key = `${date}|${task.id}`
      const origHoliday = holidays.get(date) || null
      let actualDate = date
      let status = 'normal'
      let reason = null
      if (origHoliday && task.recurrence.type !== 'once') {
        const rule = task.holidayRule || 'entfaellt'
        if (rule === 'entfaellt') {
          status = 'cancelled'
          reason = 'holiday'
        } else if (rule === 'verschieben') {
          actualDate = nextWorkday(date, holidays)
          status = 'moved'
          reason = 'holiday'
        }
      }

      const ov = overrides[key]
      let startTime = task.start
      let endTime = task.end
      if (ov) {
        if (ov.date) {
          actualDate = ov.date
          status = ov.date === date ? 'normal' : 'moved'
          reason = ov.date === date ? null : 'manual'
        }
        if (ov.start) startTime = ov.start
        if (ov.end) endTime = ov.end
        if (ov.cancelled) {
          status = 'cancelled'
          reason = 'manual'
        }
      }

      const dayStart = dayIndex(actualDate) * 1440
      const s = toMinutes(startTime)
      let e = toMinutes(endTime)
      if (e <= s) e += 1440
      const duration = e - s
      const breakMin = duration > rules.breakAfterH * 60 ? Math.max(task.breakMin || 0, rules.breakMin) : task.breakMin || 0
      const weekday = isoWeekday(actualDate)

      out.push({
        key,
        taskId: task.id,
        objectId: obj.id,
        label: task.label,
        category: task.category || 'reinigung',
        origDate: date,
        date: actualDate,
        weekday,
        startTime,
        endTime,
        start: dayStart + s,
        end: dayStart + e,
        duration,
        breakMin,
        net: duration - breakMin,
        staff: task.staff || 1,
        skills: task.skills || [],
        regulars: task.regulars || [],
        travelAfterMin: Number.isFinite(task.travelAfterMin) ? task.travelAfterMin : null,
        travelNote: task.travelNote || '',
        status,
        reason,
        origHoliday,
        holiday: holidays.get(actualDate) || null,
        isSunday: weekday === 7,
        timeChanged: !!(ov && (ov.start || ov.end)),
        note: ov?.note || '',
      })
    }
  }
  return out
}

/** Veränderbarer Planungszustand: wer ist welchem Einsatz zugeteilt. */
export class PlanState {
  constructor(instances, assignments = {}) {
    this.instByKey = new Map(instances.map((i) => [i.key, i]))
    this.asg = new Map()
    this.byEmp = new Map()
    for (const [key, list] of Object.entries(assignments)) {
      this.asg.set(key, list.map((a) => ({ ...a })))
      if (this.isActive(key)) for (const a of list) this.#link(a.employeeId, key)
    }
  }

  isActive(key) {
    const inst = this.instByKey.get(key)
    return !!inst && inst.status !== 'cancelled'
  }

  #link(empId, key) {
    if (!this.byEmp.has(empId)) this.byEmp.set(empId, new Set())
    this.byEmp.get(empId).add(key)
  }

  assigned(key) {
    return this.asg.get(key) || []
  }

  count(key) {
    return this.assigned(key).length
  }

  has(empId, key) {
    return this.assigned(key).some((a) => a.employeeId === empId)
  }

  isLocked(empId, key) {
    return this.assigned(key).some((a) => a.employeeId === empId && a.locked)
  }

  instancesOf(empId) {
    return [...(this.byEmp.get(empId) || [])].map((k) => this.instByKey.get(k))
  }

  assign(empId, key, locked = false) {
    if (this.has(empId, key)) return
    if (!this.asg.has(key)) this.asg.set(key, [])
    this.asg.get(key).push({ employeeId: empId, locked })
    if (this.isActive(key)) this.#link(empId, key)
  }

  unassign(empId, key) {
    const list = this.assigned(key).filter((a) => a.employeeId !== empId)
    if (list.length) this.asg.set(key, list)
    else this.asg.delete(key)
    this.byEmp.get(empId)?.delete(key)
  }

  setLocked(empId, key, locked) {
    for (const a of this.assigned(key)) if (a.employeeId === empId) a.locked = locked
  }

  toObject() {
    const out = {}
    for (const [key, list] of this.asg) if (list.length) out[key] = list.map((a) => ({ ...a }))
    return out
  }
}
