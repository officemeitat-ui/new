// Prüfregeln nach österreichischem Arbeitsrecht (AZG, ARG, KJBG) und
// betrieblichen Vorgaben. Jede Regel ist ein Eintrag in RULES und liefert
// Markierungen ("Issues") mit Schweregrad error (Verstoß), warning (prüfen)
// oder info (Hinweis/Zuschlag). Eigene Regeln: registerRule({...}), siehe
// docs/ERWEITERN.md. Regeln lassen sich in den Einstellungen abschalten.

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
  travelMin: 30, // Fahrzeit zwischen zwei Objekten am selben Tag (wenn keine Matrix-Angabe)
  sundayBonusPct: 100,
  holidayBonusPct: 100,
  creditSpecialTasks: false, // Sonderleistungen in Feiertags-/Urlaubsgutschrift einrechnen
  autoExtraHoursPerWeek: 6, // Automatik darf für Vertretungen so viele Stunden über Vertrag planen
  dueLeadDays: 7, // periodische Leistungen spätestens so viele Tage vorher zuteilen
  disabledRules: [], // ids aus RULES, die nicht geprüft werden
  minor: { maxDailyH: 8, maxWeeklyH: 40, minDailyRestH: 12, nightStart: '20:00', nightEnd: '06:00' }, // KJBG
}

export const SEVERITY_RANK = { info: 1, warning: 2, error: 3 }
export const SEVERITY_LABEL = { error: 'Verstoß', warning: 'Prüfen', info: 'Hinweis' }

export function mergeRules(rules = {}) {
  return { ...DEFAULT_RULES, ...rules, disabledRules: rules.disabledRules || [], minor: { ...DEFAULT_RULES.minor, ...(rules.minor || {}) } }
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function createContext({ employees, objects, absences = [], rules, travel = {}, trips = {}, published = {} }, holidays) {
  const absencesByEmployee = new Map()
  for (const a of absences) {
    if (!absencesByEmployee.has(a.employeeId)) absencesByEmployee.set(a.employeeId, [])
    absencesByEmployee.get(a.employeeId).push(a)
  }
  const merged = mergeRules(rules)
  const between = (a, b) => (a === b ? 0 : travel[pairKey(a, b)] ?? merged.travelMin)
  return {
    rules: merged,
    employees,
    employeesById: new Map(employees.map((e) => [e.id, e])),
    objectsById: new Map(objects.map((o) => [o.id, o])),
    absencesByEmployee,
    holidays,
    /** Veröffentlichte Wochen (Salden für das Zeitkonto). */
    published,
    /** Fahrzeit in Minuten zwischen zwei Objekten (Matrix, sonst Pauschale). */
    travel: between,
    trips,
    /**
     * Geplante Fahrt nach einem Einsatz. Vorrang: Eintrag dieser Woche für die
     * Person > Standard der Leistung > Matrix/Pauschale bis zum nächsten Einsatz
     * desselben Tages. Liefert { minutes, note, source }.
     */
    tripAfter(empId, inst, next) {
      const entry = empId ? trips[tripKey(inst, empId)] : null
      const note = entry?.note || inst.travelNote || ''
      if (Number.isFinite(entry?.min)) return { minutes: entry.min, note, source: 'woche' }
      if (Number.isFinite(inst.travelAfterMin)) return { minutes: inst.travelAfterMin, note, source: 'leistung' }
      if (!next || next.date !== inst.date) return { minutes: 0, note, source: 'keine' }
      return { minutes: between(inst.objectId, next.objectId), note, source: 'automatisch' }
    },
  }
}

export const travelKey = pairKey
/** Schlüssel einer geplanten Fahrt: Einsatz + Person. */
export const tripKey = (inst, empId) => `${inst.key}|${empId}`

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

/**
 * Fahrten eines Tages einer Person: nach jedem Einsatz eine Fahrt (ggf. 0 min),
 * sortiert nach Beginn. Jede Fahrt: { from, to, minutes, note, source }.
 */
export function dayTrips(dayItems, ctx, empId = null) {
  const sorted = [...dayItems].sort((a, b) => a.start - b.start)
  return sorted.map((inst, i) => ({ from: inst, to: sorted[i + 1] || null, ...ctx.tripAfter(empId, inst, sorted[i + 1]) }))
}

/** Nur Fahrten mit Dauer (für Arbeitszeitsummen). */
export function travelLegs(dayItems, ctx, empId = null) {
  return dayTrips(dayItems, ctx, empId).filter((t) => t.minutes > 0)
}

const sumNet = (items) => items.reduce((s, i) => s + i.net, 0)

export function groupBy(items, fn) {
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

// ---------------------------------------------------------------- Regelkatalog
//
// Jede Regel: { id, title, law, description, check(env) }. check ruft
// env.add(severity, code, scope, message, instanzen, extra) auf.
// env enthält: emp, items (sortiert), ctx, r (Regeln), minor, limits,
// byDay (Map Datum → Einsätze), byWeek, byMonth, workOfDay(date), objName(inst).

export const RULES = [
  {
    id: 'absence',
    title: 'Abwesenheit',
    law: 'Urlaub, Krankenstand, Zeitausgleich',
    description: 'Eingeteilt, obwohl eine Abwesenheit eingetragen ist.',
    check({ emp, items, ctx, add }) {
      for (const it of items) {
        const abs = findAbsence(ctx, emp.id, it.date)
        if (abs) add('error', 'ABSENT', 'shift', `${abs.type}: ${emp.name} ist an diesem Tag abwesend`, [it])
      }
    },
  },
  {
    id: 'skills',
    title: 'Qualifikation',
    law: 'betrieblich',
    description: 'Die Leistung verlangt eine Qualifikation, die die Person nicht hat.',
    check({ emp, items, add }) {
      for (const it of items) {
        const missing = it.skills.filter((s) => !(emp.skills || []).includes(s))
        if (missing.length) add('error', 'SKILL', 'shift', `Qualifikation fehlt: ${missing.join(', ')}`, [it])
      }
    },
  },
  {
    id: 'availability',
    title: 'Verfügbarkeit',
    law: 'Arbeitsvertrag / Vereinbarung',
    description: 'Einsatz liegt außerhalb der hinterlegten Verfügbarkeit.',
    check({ emp, items, add }) {
      for (const it of items) if (!fitsAvailability(emp, it)) add('warning', 'AVAILABILITY', 'shift', `Außerhalb der Verfügbarkeit (${availabilityText(emp, it.weekday)})`, [it])
    },
  },
  {
    id: 'training',
    title: 'Einschulung im Objekt',
    law: 'betrieblich',
    description: 'Person ist im Objekt nicht eingeschult (Schlüssel, Alarm, Abläufe). In Objekten mit „nur eingeschultes Personal“ ein Verstoß.',
    check({ emp, items, ctx, add, objName }) {
      for (const it of items) {
        if ((emp.trained || []).includes(it.objectId) || it.regulars.includes(emp.id)) continue
        const obj = ctx.objectsById.get(it.objectId)
        add(obj?.onlyTrained ? 'error' : 'warning', 'NOT_TRAINED', 'shift', `Nicht eingeschult: ${objName(it)}${obj?.onlyTrained ? ' (nur eingeschultes Personal, Schlüssel/Alarm)' : ''}`, [it])
      }
    },
  },
  {
    id: 'keys',
    title: 'Schlüssel',
    law: 'betrieblich',
    description: 'Für das Objekt sind Schlüssel hinterlegt, die eingeteilte Person hat keinen: Übergabe organisieren.',
    check({ emp, items, ctx, add, objName }) {
      for (const it of items) {
        const keys = ctx.objectsById.get(it.objectId)?.keys || []
        if (!keys.length || keys.some((k) => k.holderId === emp.id)) continue
        const holders = keys.map((k) => ctx.employeesById.get(k.holderId)?.name).filter(Boolean)
        add('warning', 'KEY_HANDOVER', 'shift', `Schlüsselübergabe nötig für ${objName(it)}${holders.length ? ` (Schlüssel bei ${holders.join(', ')})` : ''}`, [it])
      }
    },
  },
  {
    id: 'night',
    title: 'Nachtarbeit',
    law: '§ 12a AZG, § 17 KJBG',
    description: 'Hinweis auf Nachtzuschlag; für Jugendliche zwischen 20 und 6 Uhr verboten.',
    check({ items, minor, limits, add }) {
      for (const it of items) {
        const night = windowMinutes(it.start, it.end, limits.nightStart, limits.nightEnd)
        if (night <= 0) continue
        if (minor) add('error', 'MINOR_NIGHT', 'shift', `Jugendliche dürfen zwischen ${limits.nightStart} und ${limits.nightEnd} Uhr nicht arbeiten (§ 17 KJBG)`, [it])
        else add('info', 'NIGHT', 'shift', `Nachtarbeit ${formatHours(night)} h (${limits.nightStart}–${limits.nightEnd} Uhr), Nachtzuschlag laut KV`, [it], { nightMinutes: night })
      }
    },
  },
  {
    id: 'sundayHoliday',
    title: 'Sonn- und Feiertagsarbeit',
    law: 'ARG, § 18 KJBG',
    description: 'Hinweis auf Zuschläge; für Jugendliche verboten.',
    check({ items, minor, r, add }) {
      for (const it of items) {
        if (it.holiday?.legal) {
          if (minor) add('error', 'MINOR_HOLIDAY', 'shift', 'Feiertagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)', [it])
          else add('info', 'HOLIDAY', 'shift', `Feiertagsarbeit (${it.holiday.name}): Feiertagsentgelt + ${r.holidayBonusPct} % Zuschlag`, [it])
        } else if (it.isSunday) {
          if (minor) add('error', 'MINOR_SUNDAY', 'shift', 'Sonntagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)', [it])
          else add('info', 'SUNDAY', 'shift', `Sonntagsarbeit: ${r.sundayBonusPct} % Zuschlag, Ausnahme nach ARG prüfen`, [it])
        }
      }
    },
  },
  {
    id: 'overlap',
    title: 'Überschneidung und Fahrzeit',
    law: 'betrieblich',
    description: 'Zwei Einsätze überschneiden sich oder die geplante Fahrt passt nicht in die Zeit bis zum nächsten Einsatz.',
    check({ emp, items, byDay, ctx, add, objName }) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length && items[j].start < items[i].end; j++) {
          const a = items[i]
          const b = items[j]
          add('error', 'OVERLAP', 'shift', `Überschneidung: ${objName(a)} ${a.startTime}–${a.endTime} und ${objName(b)} ${b.startTime}–${b.endTime}`, [a, b])
        }
      }
      for (const [, ds] of byDay) {
        for (const trip of dayTrips(ds, ctx, emp.id)) {
          if (!trip.to || trip.minutes <= 0 || trip.to.start < trip.from.end) continue
          const gap = trip.to.start - trip.from.end
          if (gap < trip.minutes) add('warning', 'TRAVEL', 'shift', `Fahrt ${objName(trip.from)} → ${objName(trip.to)} dauert ${trip.minutes} min, Zeit dazwischen nur ${gap} min`, [trip.from, trip.to])
        }
      }
    },
  },
  {
    id: 'dailyHours',
    title: 'Tagesarbeitszeit',
    law: '§ 9 AZG, § 11 KJBG',
    description: 'Höchstgrenze pro Tag (inkl. Fahrzeit) und Warnung bei langen Tagen.',
    check({ byDay, minor, limits, r, workOfDay, add }) {
      for (const [date, ds] of byDay) {
        const work = workOfDay(date)
        if (work > limits.maxDaily) add('error', 'DAILY_MAX', 'day', `Tagesarbeitszeit ${formatHours(work)} h inkl. Fahrzeit, Höchstgrenze ${formatHours(limits.maxDaily)} h`, ds)
        else if (!minor && work > r.dailyWarnH * 60) add('warning', 'DAILY_LONG', 'day', `Tagesarbeitszeit ${formatHours(work)} h inkl. Fahrzeit, über ${r.dailyWarnH} h nur als Überstunden zulässig`, ds)
      }
    },
  },
  {
    id: 'dailyRest',
    title: 'Tägliche Ruhezeit',
    law: '§ 12 AZG, § 16 KJBG',
    description: 'Ununterbrochene Ruhe zwischen Dienstende und nächstem Dienstbeginn.',
    check({ byDay, limits, add }) {
      let prevLast = null
      for (const date of [...byDay.keys()].sort()) {
        const ds = byDay.get(date)
        const first = ds.reduce((m, i) => (i.start < m.start ? i : m))
        const last = ds.reduce((m, i) => (i.end > m.end ? i : m))
        if (prevLast) {
          const rest = first.start - prevLast.end
          if (rest < limits.rest) {
            add('error', 'REST', 'day', `Ruhezeit nur ${formatHours(Math.max(rest, 0))} h: Ende ${formatDate(prevLast.date)} ${formatTime(prevLast.end)}, Beginn ${formatDate(date)} ${formatTime(first.start)} (mind. ${limits.rest / 60} h)`, [prevLast, first])
          }
        }
        prevLast = last
      }
    },
  },
  {
    id: 'weeklyHours',
    title: 'Wochenarbeitszeit',
    law: '§ 9 AZG, § 11 KJBG',
    description: 'Höchstgrenze pro Woche und Warnung über dem 48-h-Durchschnitt.',
    check({ byWeek, minor, limits, r, workOfItems, add }) {
      for (const [monday, ws] of byWeek) {
        const work = workOfItems(ws)
        const kw = `KW ${isoWeek(monday).week}`
        if (work > limits.maxWeekly) add('error', 'WEEKLY_MAX', 'week', `${formatHours(work)} h in ${kw}, Höchstgrenze ${formatHours(limits.maxWeekly)} h`, ws)
        else if (!minor && work > r.maxAvgWeeklyH * 60) add('warning', 'WEEKLY_48', 'week', `${formatHours(work)} h in ${kw}: über ${r.maxAvgWeeklyH} h, Durchschnitt über 17 Wochen beachten`, ws)
      }
    },
  },
  {
    id: 'contract',
    title: 'Mehr- und Überstunden',
    law: '§ 19d AZG, Arbeitsvertrag',
    description: 'Geplante Stunden über den vertraglichen Wochenstunden.',
    check({ emp, byWeek, workOfItems, add }) {
      const contract = (emp.weeklyHours || 0) * 60
      if (!contract) return
      for (const [, ws] of byWeek) {
        const work = workOfItems(ws)
        if (work <= contract) continue
        const kind = emp.type === 'Vollzeit' || emp.type === 'Lehrling' ? 'Überstunden' : 'Mehrstunden (ggf. 25 % Zuschlag)'
        add('warning', 'CONTRACT', 'week', `${formatHours(work)} h geplant bei ${formatHours(contract)} h Vertrag: +${formatHours(work - contract)} h ${kind}`, ws, { overMinutes: work - contract })
      }
    },
  },
  {
    id: 'weeklyRest',
    title: 'Wochenruhe',
    law: '§§ 3, 4 ARG',
    description: '36 Stunden ununterbrochene Ruhe, die einen ganzen Tag einschließen.',
    check({ items, byWeek, r, add }) {
      for (const [monday, ws] of byWeek) {
        if (!hasWeeklyRest(items, monday, r.minWeeklyRestH * 60)) add('error', 'WEEKLY_REST', 'week', `Keine ${r.minWeeklyRestH} h Wochenruhe mit einem ganzen freien Tag in KW ${isoWeek(monday).week} (§ 4 ARG)`, ws)
      }
    },
  },
  {
    id: 'monthlyLimit',
    title: 'Geringfügigkeitsgrenze',
    law: '§ 5 Abs 2 ASVG',
    description: 'Monatliches Stundenlimit für geringfügig Beschäftigte.',
    check({ emp, byMonth, workOfItems, add }) {
      if (!(emp.maxMonthHours > 0)) return
      for (const [month, ms] of byMonth) {
        const work = workOfItems(ms)
        if (work > emp.maxMonthHours * 60) {
          add('error', 'MONTHLY_LIMIT', 'month', `Geringfügig: ${formatHours(work)} h im ${MONTH_LONG[Number(month.slice(5, 7)) - 1]}, Limit ${formatHours(emp.maxMonthHours * 60)} h (Geringfügigkeitsgrenze)`, ms)
        }
      }
    },
  },
]

/** Eigene Regel ergänzen (z. B. aus einem Erweiterungsmodul). */
export function registerRule(rule) {
  if (!rule?.id || typeof rule.check !== 'function') throw new Error('Regel braucht id und check()')
  const idx = RULES.findIndex((r) => r.id === rule.id)
  if (idx >= 0) RULES.splice(idx, 1, rule)
  else RULES.push(rule)
}

/** Alle Markierungen für eine Person und ihre (aktiven) Einsätze. */
export function evaluateEmployee(emp, list, ctx) {
  const r = ctx.rules
  const minor = !!emp.minor
  const limits = {
    rest: (minor ? r.minor.minDailyRestH : r.minDailyRestH) * 60,
    maxDaily: (minor ? r.minor.maxDailyH : r.maxDailyH) * 60,
    maxWeekly: (minor ? r.minor.maxWeeklyH : r.maxWeeklyH) * 60,
    nightStart: minor ? r.minor.nightStart : r.nightStart,
    nightEnd: minor ? r.minor.nightEnd : r.nightEnd,
  }
  const items = [...list].sort((a, b) => a.start - b.start || a.end - b.end)
  const byDay = groupBy(items, (i) => i.date)
  const travelByDay = new Map([...byDay].map(([d, ds]) => [d, travelLegs(ds, ctx, emp.id).reduce((s, l) => s + l.minutes, 0)]))
  const workOfItems = (list2) => sumNet(list2) + [...new Set(list2.map((i) => i.date))].reduce((s, d) => s + (travelByDay.get(d) || 0), 0)
  const issues = []
  const env = {
    emp,
    items,
    ctx,
    r,
    minor,
    limits,
    byDay,
    byWeek: groupBy(items, (i) => mondayOf(i.date)),
    byMonth: groupBy(items, (i) => i.date.slice(0, 7)),
    workOfDay: (date) => workOfItems(byDay.get(date) || []),
    workOfItems,
    objName: (i) => ctx.objectsById.get(i.objectId)?.name || 'Objekt',
    add: (severity, code, scope, message, insts, extra = {}) =>
      issues.push({ severity, code, scope, message, employeeId: emp.id, keys: insts.map((i) => i.key), date: insts[0]?.date, ...extra }),
  }
  const disabled = new Set(r.disabledRules || [])
  for (const rule of RULES) if (!disabled.has(rule.id)) rule.check(env)
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
