// Auswertungen: Monatsauswertung für die Lohnverrechnung, Objekt-Controlling
// (Budget gegen Plan), Zeitkonto und Urlaubsanspruch.

import { addDays, eachDay, firstOfMonth, formatHours, isoWeekday, lastOfMonth, mondayOf } from './dates.js'
import { holidayCalendar } from './holidays.js'
import { buildTimesheet, summarizeDays } from './timesheet.js'

/** Wochen (Montage), die einen Zeitraum berühren. */
export function mondaysBetween(from, to) {
  const out = []
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) out.push(m)
  return out
}

/** Soll eines Zeitraums: Wochenstunden / 5 je Werktag Mo–Fr (Feiertage zählen, sie werden angerechnet). */
export function sollMinutes(emp, from, to) {
  const days = eachDay(from, to).filter((d) => isoWeekday(d) <= 5).length
  return Math.round(((emp.weeklyHours || 0) * 60 * days) / 5)
}

/**
 * Monatsauswertung je Person. `month` = 'YYYY-MM'.
 * Grundlage für den Export an die Lohnverrechnung (BMD, RZL, …).
 */
export function monthReport(ctx, month, instances, state) {
  const from = `${month}-01`
  const to = lastOfMonth(from)
  const weeks = mondaysBetween(from, to)
  return ctx.employees.map((emp) => {
    const days = weeks.flatMap((m) => buildTimesheet(ctx, emp, m, instances, state).days).filter((d) => d.date >= from && d.date <= to)
    const t = summarizeDays(days)
    const soll = sollMinutes(emp, from, to)
    return {
      employee: emp,
      soll,
      worked: t.hours,
      travel: t.travel,
      bonus: t.bonus,
      night: t.night,
      sundayHoliday: t.sundayHolidayHours,
      substitute: t.substituteHours,
      holidayCredit: t.credits.feiertag || 0,
      vacationCredit: t.credits.Urlaub || 0,
      sickCredit: t.credits.Krankenstand || 0,
      otherCredit: Object.entries(t.credits).filter(([k]) => !['feiertag', 'Urlaub', 'Krankenstand'].includes(k)).reduce((s, [, v]) => s + v, 0),
      vacationDays: t.absenceDays.Urlaub || 0,
      sickDays: t.absenceDays.Krankenstand || 0,
      ist: t.ist,
      saldo: t.ist - soll,
      overLimit: emp.maxMonthHours > 0 && t.hours + t.travel > emp.maxMonthHours * 60,
    }
  })
}

export const PAYROLL_COLUMNS = [
  ['Personalnummer', (r) => r.employee.personnelNo || ''],
  ['Name', (r) => r.employee.name],
  ['Beschäftigung', (r) => r.employee.type],
  ['Soll (h)', (r) => formatHours(r.soll)],
  ['Gearbeitet (h)', (r) => formatHours(r.worked)],
  ['Fahrzeit (h)', (r) => formatHours(r.travel)],
  ['Sonn-/Feiertag gearbeitet (h)', (r) => formatHours(r.sundayHoliday)],
  ['Zuschlag Sonn-/Feiertag (h)', (r) => formatHours(r.bonus)],
  ['Nachtarbeit (h)', (r) => formatHours(r.night)],
  ['Feiertag angerechnet (h)', (r) => formatHours(r.holidayCredit)],
  ['Urlaub (Tage)', (r) => String(r.vacationDays)],
  ['Urlaub angerechnet (h)', (r) => formatHours(r.vacationCredit)],
  ['Krankenstand (Tage)', (r) => String(r.sickDays)],
  ['Krankenstand angerechnet (h)', (r) => formatHours(r.sickCredit)],
  ['Sonstige Abwesenheit (h)', (r) => formatHours(r.otherCredit)],
  ['Ist gesamt (h)', (r) => formatHours(r.ist)],
  ['Saldo (h)', (r) => formatHours(r.saldo)],
]

/** CSV mit Semikolon und Komma-Dezimalen (österreichisches Excel, BMD/RZL-Import). */
export function toCSV(rows, columns = PAYROLL_COLUMNS) {
  const cell = (v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return [columns.map(([h]) => cell(h)).join(';'), ...rows.map((r) => columns.map(([, fn]) => cell(fn(r))).join(';'))].join('\r\n')
}

/**
 * Objekt-Controlling für einen Monat: Budget laut Kalkulation gegen geplante
 * und besetzte Stunden. Offen zählt nur in Wochen, die schon eingeteilt sind
 * (`isScheduled(montag)`), damit künftige Wochen nicht als Lücke erscheinen.
 */
export function objectControlling(ctx, objects, month, instances, state, isScheduled = () => true) {
  const from = `${month}-01`
  const to = lastOfMonth(from)
  return objects.map((obj) => {
    let planned = 0
    let staffed = 0
    let scheduled = 0
    let cancelled = 0
    for (const inst of instances) {
      if (inst.objectId !== obj.id) continue
      if (inst.status === 'cancelled') {
        if (inst.origDate >= from && inst.origDate <= to) cancelled += inst.net * inst.staff
        continue
      }
      if (inst.date < from || inst.date > to) continue
      planned += inst.net * inst.staff
      if (!isScheduled(mondayOf(inst.date))) continue
      scheduled += inst.net * inst.staff
      staffed += inst.net * Math.min(state.count(inst.key), inst.staff)
    }
    const budget = Math.round((obj.budgetHoursMonth || 0) * 60)
    return { object: obj, budget, planned, staffed, open: scheduled - staffed, cancelled, diff: budget ? planned - budget : null }
  })
}

/** Laufendes Zeitkonto: Startsaldo + Salden aller veröffentlichten Wochen bis einschließlich `uptoMonday`. */
export function timeAccount(emp, publishedWeeks = {}, uptoMonday) {
  let total = Math.round((emp.startBalanceHours || 0) * 60)
  for (const [monday, week] of Object.entries(publishedWeeks)) {
    if (monday > uptoMonday || week.status !== 'veroeffentlicht') continue
    total += week.saldi?.[emp.id] || 0
  }
  return total
}

/** Urlaubsanspruch und verplante Urlaubstage (Werktage Mo–Fr ohne Feiertage) in einem Jahr. */
export function vacationSummary(emp, absences, year, extraFreeDays = []) {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const cal = holidayCalendar(from, to, extraFreeDays)
  let used = 0
  for (const a of absences) {
    if (a.employeeId !== emp.id || a.type !== 'Urlaub') continue
    const s = a.from > from ? a.from : from
    const e = a.to < to ? a.to : to
    if (s > e) continue
    used += eachDay(s, e).filter((d) => isoWeekday(d) <= 5 && !cal.get(d)?.legal).length
  }
  const entitlement = emp.vacationDaysYear ?? 25
  return { entitlement, used, rest: entitlement - used }
}

export const monthOf = (date) => date.slice(0, 7)
export const monthRange = (month) => ({ from: firstOfMonth(`${month}-01`), to: lastOfMonth(`${month}-01`) })
