// Prüfregeln nach österreichischem Arbeitsrecht (AZG, ARG, KJBG) und
// betrieblichen Vorgaben. Jede Regel liefert Markierungen ("Issues") mit
// Schweregrad error (Verstoß), warning (prüfen) oder info (Hinweis/Zuschlag).

import { dayIndex, formatDate, formatHours, formatTime, isoWeek, mondayOf, toMinutes, MONTH_LONG, WEEKDAY_SHORT } from './dates.js'

export const DEFAULT_RULES = {
  minDailyRestH: 11, // § 12 AZG
  dailyWarnH: 10, // über 10 h nur als Überstunden
  maxDailyH: 12, // § 9 AZG
  maxAvgWeeklyH: 48, // § 9 Abs 4 AZG, Durchschnitt über 17 Wochen
  maxWeeklyH: 60, // § 9 AZG
  minWeeklyRestH: 36, // §§ 3, 4 ARG
  breakAfterH: 6, // § 11 AZG
  breakMin: 30,
  nightStart: '22:00', // § 12a AZG
  nightEnd: '05:00',
  travelMin: 30, // Fahrzeit zwischen zwei Objekten am selben Tag
  sundayBonusPct: 100,
  holidayBonusPct: 100,
  creditSpecialTasks: false, // Sonderleistungen in Feiertags-/Urlaubsgutschrift einrechnen
  autoExtraHoursPerWeek: 6, // Automatik darf für Vertretungen so viele Stunden über Vertrag planen
  minor: { maxDailyH: 8, maxWeeklyH: 40, minDailyRestH: 12, nightStart: '20:00', nightEnd: '06:00' }, // KJBG
}

export const SEVERITY_RANK = { info: 1, warning: 2, error: 3 }
export const SEVERITY_LABEL = { error: 'Verstoß', warning: 'Prüfen', info: 'Hinweis' }

export function mergeRules(rules = {}) {
  return { ...DEFAULT_RULES, ...rules, minor: { ...DEFAULT_RULES.minor, ...(rules.minor || {}) } }
}

export function createContext({ employees, objects, absences = [], rules }, holidays) {
  const absencesByEmployee = new Map()
  for (const a of absences) {
    if (!absencesByEmployee.has(a.employeeId)) absencesByEmployee.set(a.employeeId, [])
    absencesByEmployee.get(a.employeeId).push(a)
  }
  return {
    rules: mergeRules(rules),
    employees,
    employeesById: new Map(employees.map((e) => [e.id, e])),
    objectsById: new Map(objects.map((o) => [o.id, o])),
    absencesByEmployee,
    holidays,
  }
}

export function findAbsence(ctx, employeeId, date) {
  return (ctx.absencesByEmployee.get(employeeId) || []).find((a) => date >= a.from && date <= a.to) || null
}

export function availabilityWindow(emp, weekday) {
  const w = emp.availability?.[weekday]
  if (!w) return null
  const from = toMinutes(w.from)
  let to = toMinutes(w.to)
  if (to <= from) to += 1440
  return { from, to }
}

export function fitsAvailability(emp, inst) {
  const w = availabilityWindow(emp, inst.weekday)
  if (!w) return false
  const dayStart = inst.start - (inst.start % 1440)
  return inst.start - dayStart >= w.from && inst.end - dayStart <= w.to
}

export function availabilityText(emp, weekday) {
  const w = emp.availability?.[weekday]
  return w ? `${WEEKDAY_SHORT[weekday - 1]} ${w.from}–${w.to}` : `${WEEKDAY_SHORT[weekday - 1]} nicht verfügbar`
}

/** Minuten innerhalb eines täglichen Zeitfensters (z. B. 22:00–05:00). */
export function windowMinutes(start, end, winStart, winEnd) {
  const ws = toMinutes(winStart)
  let we = toMinutes(winEnd)
  if (we <= ws) we += 1440
  let total = 0
  for (let day = Math.floor(start / 1440) - 1; day <= Math.floor(end / 1440); day++) {
    const a = Math.max(start, day * 1440 + ws)
    const b = Math.min(end, day * 1440 + we)
    if (b > a) total += b - a
  }
  return total
}

/** Fahrzeiten eines Tages: zwischen zwei aufeinanderfolgenden Einsätzen in verschiedenen Objekten. */
export function travelLegs(dayItems, rules) {
  const sorted = [...dayItems].sort((a, b) => a.start - b.start)
  const legs = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (sorted[i].objectId !== sorted[i + 1].objectId) legs.push({ from: sorted[i], to: sorted[i + 1], minutes: rules.travelMin })
  }
  return legs
}

const sumNet = (items) => items.reduce((s, i) => s + i.net, 0)

function groupBy(items, fn) {
  const map = new Map()
  for (const it of items) {
    const k = fn(it)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(it)
  }
  return map
}

/**
 * Wochenruhe: 36 h ununterbrochen, die einen ganzen Kalendertag dieser Woche
 * einschließen (§ 4 ARG). Ränder außerhalb des geladenen Zeitraums gelten als frei.
 */
export function hasWeeklyRest(items, monday, minMinutes) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const firstDay = dayIndex(monday)
  const lastDay = firstDay + 6
  let gapStart = -Infinity
  const gaps = []
  for (const it of sorted) {
    if (it.start > gapStart) gaps.push([gapStart, it.start])
    gapStart = Math.max(gapStart, it.end)
  }
  gaps.push([gapStart, Infinity])
  return gaps.some(([a, b]) => {
    if (b - a < minMinutes) return false
    const lo = Math.max(Math.ceil(a / 1440), firstDay)
    const hi = Math.min(Math.floor(b / 1440) - 1, lastDay)
    return lo <= hi
  })
}

/** Alle Markierungen für eine Person und ihre (aktiven) Einsätze. */
export function evaluateEmployee(emp, list, ctx) {
  const r = ctx.rules
  const minor = !!emp.minor
  const restMin = (minor ? r.minor.minDailyRestH : r.minDailyRestH) * 60
  const maxDaily = (minor ? r.minor.maxDailyH : r.maxDailyH) * 60
  const maxWeekly = (minor ? r.minor.maxWeeklyH : r.maxWeeklyH) * 60
  const [nightStart, nightEnd] = minor ? [r.minor.nightStart, r.minor.nightEnd] : [r.nightStart, r.nightEnd]
  const items = [...list].sort((a, b) => a.start - b.start || a.end - b.end)
  const objName = (i) => ctx.objectsById.get(i.objectId)?.name || 'Objekt'
  const issues = []
  const add = (severity, code, scope, message, insts, extra = {}) =>
    issues.push({ severity, code, scope, message, employeeId: emp.id, keys: insts.map((i) => i.key), date: insts[0]?.date, ...extra })

  for (const it of items) {
    const abs = findAbsence(ctx, emp.id, it.date)
    if (abs) add('error', 'ABSENT', 'shift', `${abs.type}: ${emp.name} ist an diesem Tag abwesend`, [it])
    const missing = it.skills.filter((s) => !(emp.skills || []).includes(s))
    if (missing.length) add('error', 'SKILL', 'shift', `Qualifikation fehlt: ${missing.join(', ')}`, [it])
    if (!fitsAvailability(emp, it)) add('warning', 'AVAILABILITY', 'shift', `Außerhalb der Verfügbarkeit (${availabilityText(emp, it.weekday)})`, [it])
    const obj = ctx.objectsById.get(it.objectId)
    if (!(emp.trained || []).includes(it.objectId) && !it.regulars.includes(emp.id)) {
      add(obj?.onlyTrained ? 'error' : 'warning', 'NOT_TRAINED', 'shift', `Nicht eingeschult: ${objName(it)}${obj?.onlyTrained ? ' (nur eingeschultes Personal, Schlüssel/Alarm)' : ''}`, [it])
    }
    const night = windowMinutes(it.start, it.end, nightStart, nightEnd)
    if (night > 0) {
      if (minor) add('error', 'MINOR_NIGHT', 'shift', `Jugendliche dürfen zwischen ${nightStart} und ${nightEnd} Uhr nicht arbeiten (§ 17 KJBG)`, [it])
      else add('info', 'NIGHT', 'shift', `Nachtarbeit ${formatHours(night)} h (${nightStart}–${nightEnd} Uhr), Nachtzuschlag laut KV`, [it])
    }
    if (it.holiday?.legal) {
      if (minor) add('error', 'MINOR_HOLIDAY', 'shift', `Feiertagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)`, [it])
      else add('info', 'HOLIDAY', 'shift', `Feiertagsarbeit (${it.holiday.name}): Feiertagsentgelt + ${r.holidayBonusPct} % Zuschlag`, [it])
    } else if (it.isSunday) {
      if (minor) add('error', 'MINOR_SUNDAY', 'shift', `Sonntagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)`, [it])
      else add('info', 'SUNDAY', 'shift', `Sonntagsarbeit: ${r.sundayBonusPct} % Zuschlag, Ausnahme nach ARG prüfen`, [it])
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length && items[j].start < items[i].end + r.travelMin; j++) {
      const a = items[i]
      const b = items[j]
      if (b.start < a.end) {
        add('error', 'OVERLAP', 'shift', `Überschneidung: ${objName(a)} ${a.startTime}–${a.endTime} und ${objName(b)} ${b.startTime}–${b.endTime}`, [a, b])
      } else if (a.objectId !== b.objectId) {
        add('warning', 'TRAVEL', 'shift', `Nur ${b.start - a.end} min von ${objName(a)} zu ${objName(b)} (Fahrzeit ${r.travelMin} min)`, [a, b])
      }
    }
  }

  const byDay = groupBy(items, (i) => i.date)
  const travelByDay = new Map()
  let prevLast = null
  for (const date of [...byDay.keys()].sort()) {
    const ds = byDay.get(date)
    const travel = travelLegs(ds, r).reduce((s, l) => s + l.minutes, 0)
    travelByDay.set(date, travel)
    const work = sumNet(ds) + travel
    if (work > maxDaily) {
      add('error', 'DAILY_MAX', 'day', `Tagesarbeitszeit ${formatHours(work)} h inkl. Fahrzeit, Höchstgrenze ${formatHours(maxDaily)} h`, ds)
    } else if (!minor && work > r.dailyWarnH * 60) {
      add('warning', 'DAILY_LONG', 'day', `Tagesarbeitszeit ${formatHours(work)} h inkl. Fahrzeit, über ${r.dailyWarnH} h nur als Überstunden zulässig`, ds)
    }
    const first = ds.reduce((m, i) => (i.start < m.start ? i : m))
    const last = ds.reduce((m, i) => (i.end > m.end ? i : m))
    if (prevLast) {
      const rest = first.start - prevLast.end
      if (rest < restMin) {
        add(
          'error',
          'REST',
          'day',
          `Ruhezeit nur ${formatHours(Math.max(rest, 0))} h: Ende ${formatDate(prevLast.date)} ${formatTime(prevLast.end)}, Beginn ${formatDate(date)} ${formatTime(first.start)} (mind. ${restMin / 60} h)`,
          [prevLast, first],
        )
      }
    }
    prevLast = last
  }

  const byWeek = groupBy(items, (i) => mondayOf(i.date))
  for (const [monday, ws] of byWeek) {
    const days = new Set(ws.map((i) => i.date))
    const work = sumNet(ws) + [...days].reduce((s, d) => s + (travelByDay.get(d) || 0), 0)
    const kw = `KW ${isoWeek(monday).week}`
    if (work > maxWeekly) add('error', 'WEEKLY_MAX', 'week', `${formatHours(work)} h in ${kw}, Höchstgrenze ${formatHours(maxWeekly)} h`, ws)
    else if (!minor && work > r.maxAvgWeeklyH * 60) add('warning', 'WEEKLY_48', 'week', `${formatHours(work)} h in ${kw}: über ${r.maxAvgWeeklyH} h, Durchschnitt über 17 Wochen beachten`, ws)
    const contract = (emp.weeklyHours || 0) * 60
    if (contract > 0 && work > contract) {
      const kind = emp.type === 'Vollzeit' || emp.type === 'Lehrling' ? 'Überstunden' : 'Mehrstunden (ggf. 25 % Zuschlag)'
      add('warning', 'CONTRACT', 'week', `${formatHours(work)} h geplant bei ${formatHours(contract)} h Vertrag: +${formatHours(work - contract)} h ${kind}`, ws, { overMinutes: work - contract })
    }
    if (!hasWeeklyRest(items, monday, r.minWeeklyRestH * 60)) {
      add('error', 'WEEKLY_REST', 'week', `Keine ${r.minWeeklyRestH} h Wochenruhe mit einem ganzen freien Tag in ${kw} (§ 4 ARG)`, ws)
    }
  }

  if (emp.maxMonthHours > 0) {
    for (const [month, ms] of groupBy(items, (i) => i.date.slice(0, 7))) {
      const days = new Set(ms.map((i) => i.date))
      const work = sumNet(ms) + [...days].reduce((s, d) => s + (travelByDay.get(d) || 0), 0)
      if (work > emp.maxMonthHours * 60) {
        const name = MONTH_LONG[Number(month.slice(5, 7)) - 1]
        add('error', 'MONTHLY_LIMIT', 'month', `Geringfügig: ${formatHours(work)} h im ${name}, Limit ${formatHours(emp.maxMonthHours * 60)} h (Geringfügigkeitsgrenze)`, ms)
      }
    }
  }

  return issues
}

/**
 * Prüft den ganzen Plan. Liefert Markierungen, die einen Einsatz im
 * Zeitraum [from, to] betreffen, plus Indizes für die Darstellung.
 */
export function validatePlan(ctx, state, instances, { from, to }) {
  const all = []
  for (const emp of ctx.employees) {
    const list = state.instancesOf(emp.id)
    if (list.length) all.push(...evaluateEmployee(emp, list, ctx))
  }
  for (const inst of instances) {
    if (inst.status === 'cancelled') continue
    const n = state.assigned(inst.key).filter((a) => ctx.employeesById.has(a.employeeId)).length
    if (n < inst.staff) {
      all.push({ severity: 'error', code: 'OPEN', scope: 'staffing', employeeId: null, keys: [inst.key], date: inst.date, message: n === 0 ? 'Einsatz ist nicht besetzt' : `Unterbesetzt: ${n} von ${inst.staff} Personen` })
    } else if (n > inst.staff) {
      all.push({ severity: 'warning', code: 'OVERSTAFFED', scope: 'staffing', employeeId: null, keys: [inst.key], date: inst.date, message: `Überbesetzt: ${n} statt ${inst.staff} Personen` })
    }
  }

  const inRange = (key) => {
    const inst = state.instByKey.get(key)
    return inst && inst.date >= from && inst.date <= to
  }
  const issues = all
    .filter((i) => i.keys.some(inRange))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.date || '').localeCompare(b.date || ''))

  const cell = new Map() // `${empId}|${key}` → issues (Einsatz- und Tagesebene)
  const byShift = new Map() // key → issues
  const byEmployee = new Map() // empId → issues (Wochen-/Monatsebene)
  const push = (map, k, v) => (map.has(k) ? map.get(k).push(v) : map.set(k, [v]))
  for (const issue of issues) {
    if (issue.scope === 'week' || issue.scope === 'month') {
      push(byEmployee, issue.employeeId, issue)
      continue
    }
    for (const key of issue.keys) {
      push(byShift, key, issue)
      if (issue.employeeId) push(cell, `${issue.employeeId}|${key}`, issue)
    }
  }
  const counts = { error: 0, warning: 0, info: 0 }
  for (const i of issues) counts[i.severity]++
  return { issues, cell, byShift, byEmployee, counts }
}

export function maxSeverity(issues = []) {
  let best = null
  for (const i of issues) if (!best || SEVERITY_RANK[i.severity] > SEVERITY_RANK[best]) best = i.severity
  return best
}
