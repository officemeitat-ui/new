// Erzeugt aus den Leistungen (Stammplan) die konkreten Einsätze eines Zeitraums
// und wendet Feiertagsregeln sowie Einzeländerungen ("nur diese Woche") an.

import { dayIndex, dstMinutes, eachDay, isoWeekday, toMinutes } from './dates.js'
import { nextWorkday, taskOccursOn } from './recurrence.js'
import { applyWaste } from './waste.js'
import { applyWinter } from './weather.js'

// An Feiertagen wird gearbeitet (mit Feiertagszuschlag). „Entfällt“ nur, wenn
// es bei der Leistung ausdrücklich so eingestellt ist (z. B. Kunde geschlossen).
export const DEFAULT_HOLIDAY_RULE = 'findet_statt'
export const HOLIDAY_RULES = {
  findet_statt: 'findet statt (mit Feiertagszuschlag)',
  verschieben: 'auf nächsten Werktag verschieben',
  entfaellt: 'entfällt (Kunde geschlossen)',
}

export { NTH_LABEL, nextWorkday, taskOccursOn } from './recurrence.js'

/**
 * Ein Einsatz (Instanz) ist eine Leistung an einem konkreten Tag.
 * `key` = Ursprungsdatum|Leistung bleibt stabil, auch wenn der Einsatz verschoben wird.
 * status: 'normal' | 'moved' (verschoben) | 'cancelled' (entfällt)
 */
export function buildInstances({ objects, tasks, employees = [], overrides = {}, winter = {} }, from, to, holidays, rules) {
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const out = []
  for (const date of eachDay(from, to)) {
    for (const task of tasks) {
      if (!taskOccursOn(task, date)) continue
      const obj = objectsById.get(task.objectId)
      if (obj) out.push(instanceFor(task, obj, date, { overrides, holidays, rules }))
    }
  }
  // Müllplan: Gänge an Einsätze im Objekt anhängen oder eigene Einsätze erzeugen
  applyWaste(out, { objects, tasks, employees, from, to, holidays, rules, make: (task, date) => instanceFor(task, objectsById.get(task.objectId), date, { overrides, holidays, rules }) })
  // Winterdienst: angelegte Einsätze (Schnee, Glätte) für Objekte mit Winterdienst
  const calls = Object.fromEntries(Object.entries(winter).filter(([key]) => key.slice(0, 10) >= from && key.slice(0, 10) <= to))
  applyWinter(out, { objects, winter: calls, weatherRules: rules?.weather, make: (task, date) => instanceFor(task, objectsById.get(task.objectId), date, { overrides, holidays, rules }) })
  return out
}

/** Einsatz einer Leistung an einem Tag, mit Feiertagsregel und Einzeländerung. */
/** Uhrzeit „H:MM“/„HH:MM“ (bis 24:00) als „HH:MM“; anderes (z. B. manipulierte Daten) → fallback. */
export function clockTime(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59 || (Number(m[1]) === 24 && Number(m[2]) > 0)) return fallback
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

export function instanceFor(task, obj, date, { overrides = {}, holidays, rules }) {
  const key = `${date}|${task.id}`
  const origHoliday = holidays.get(date) || null
  const ov = overrides[key]
  let actualDate = date
  let status = 'normal'
  let reason = null
  // Gesetzlicher Feiertag: Regel der Leistung (Standard: findet statt).
  // Betriebsfreier Tag (selbst eingetragen): Betrieb geschlossen, Einsätze entfallen.
  // „Trotzdem stattfinden“ (Einzeländerung) geht beidem vor.
  if (origHoliday && task.recurrence.type !== 'once' && !ov?.work) {
    const rule = origHoliday.legal ? task.holidayRule || DEFAULT_HOLIDAY_RULE : 'entfaellt'
    if (rule === 'entfaellt') {
      status = 'cancelled'
      reason = 'holiday'
    } else if (rule === 'verschieben') {
      actualDate = nextWorkday(date, holidays)
      status = 'moved'
      reason = 'holiday'
    }
  }

  let startTime = clockTime(task.start, '00:00')
  let endTime = clockTime(task.end, startTime)
  if (ov) {
    // ov.date = schon durch den Feiertag verschobenes Datum: Status/Grund bleiben „Feiertag“
    if (ov.date && ov.date !== actualDate) {
      actualDate = ov.date
      status = ov.date === date ? 'normal' : 'moved'
      reason = ov.date === date ? null : 'manual'
    }
    if (ov.start) startTime = clockTime(ov.start, startTime)
    if (ov.end) endTime = clockTime(ov.end, endTime)
    if (ov.cancelled) {
      status = 'cancelled'
      reason = 'manual'
    }
  }

  const dayStart = dayIndex(actualDate) * 1440
  const s = toMinutes(startTime)
  let e = toMinutes(endTime)
  if (e <= s) e += 1440
  // echte Dauer (Nachtdienst in der Nacht der Zeitumstellung: 1 h mehr bzw. weniger)
  const duration = e - s + dstMinutes(dayStart + s, dayStart + e)
  const breakMin = duration > rules.breakAfterH * 60 ? Math.max(task.breakMin || 0, rules.breakMin) : task.breakMin || 0
  const weekday = isoWeekday(actualDate)

  return {
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
    baseStart: task.start,
    baseEnd: task.end,
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
    // Arbeit im Freien (Hitzeschutz, Sturm): Leistung so markiert oder Winterdienst
    outdoor: !!task.outdoor,
    status,
    reason,
    origHoliday,
    holiday: holidays.get(actualDate) || null,
    isSunday: weekday === 7,
    timeChanged: !!(ov && (ov.start || ov.end)),
    note: ov?.note || '',
  }
}

/** Veränderbarer Planungszustand: wer ist welchem Einsatz zugeteilt. */
export class PlanState {
  constructor(instances, assignments = {}) {
    // ohne Zwischenlisten (Object.entries, Paare): Einteilungen über ein Jahr sind zehntausende Schlüssel
    this.instByKey = new Map()
    for (const i of instances) this.instByKey.set(i.key, i)
    this.asg = new Map()
    this.byEmp = new Map()
    for (const key of Object.keys(assignments)) {
      const list = assignments[key]
      this.asg.set(key, list.map((a) => ({ ...a })))
      if (this.isActive(key)) for (const a of list) this.#link(a.employeeId, key)
    }
  }

  isActive(key) {
    const inst = this.instByKey.get(key)
    return !!inst && inst.status !== 'cancelled'
  }

  // Einsätze je Person, gemerkt bis zur nächsten Änderung ihrer Einteilungen (Wochenzettel fragen je Woche danach)
  #ofEmp = new Map()

  #link(empId, key) {
    let keys = this.byEmp.get(empId)
    if (!keys) this.byEmp.set(empId, (keys = new Set()))
    keys.add(key)
    this.#ofEmp.delete(empId)
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
    let list = this.#ofEmp.get(empId)
    if (!list) this.#ofEmp.set(empId, (list = [...(this.byEmp.get(empId) || [])].map((k) => this.instByKey.get(k))))
    return list.slice()
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
    this.#ofEmp.delete(empId)
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
