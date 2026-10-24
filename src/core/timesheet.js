// Wochenzettel je Mitarbeiter:in, aufgebaut wie der bisherige Excel-Wochenplan:
// Zeit | Objekt | Std. | Arbeitszeit | Fahrzeit, mit Soll und Saldo.
//
// Anrechnung (Ausfallprinzip):
//  - entfällt ein Stammeinsatz wegen eines gesetzlichen Feiertags (oder wird er
//    verschoben), werden die Stunden am Feiertag gutgeschrieben
//  - bei Urlaub/Krankenstand werden die Stammeinsätze gutgeschrieben, die
//    Vertretung arbeitet sie zusätzlich
//  - Sonn- und Feiertagsarbeit wird mit Zuschlag angerechnet (z. B. 1,5 h → 3 h)
//
// Jede Zeile trägt Kennzahlen für die Monatsauswertung (Lohnverrechnung):
// hours, bonus, travel, credited, creditReason, nightMinutes, sundayHoliday.

import { addDays, eachDay, formatDate } from './dates.js'
import { findAbsence, travelLegs, windowMinutes } from './rules.js'

export function buildTimesheet(ctx, emp, monday, instances, state) {
  const r = ctx.rules
  const sunday = addDays(monday, 6)
  const nameOf = (id) => ctx.employeesById.get(id)?.name || 'unbekannt'
  const objName = (inst) => ctx.objectsById.get(inst.objectId)?.name || 'Objekt'
  const creditable = (inst) => inst.category !== 'sonder' || r.creditSpecialTasks
  const text = (inst) => `Objekt: ${objName(inst)}${inst.label ? ` – ${inst.label}` : ''}`

  const days = eachDay(monday, sunday).map((date) => ({
    date,
    holiday: ctx.holidays.get(date) || null,
    absence: findAbsence(ctx, emp.id, date),
    lines: [],
  }))
  const dayMap = new Map(days.map((d) => [d.date, d]))

  const mine = state
    .instancesOf(emp.id)
    .filter((i) => i.date >= monday && i.date <= sunday)
    .sort((a, b) => a.start - b.start)
  for (const inst of mine) {
    const replaced = inst.regulars.includes(emp.id) ? [] : inst.regulars.filter((id) => !state.has(id, inst.key))
    const sundayHoliday = inst.holiday?.legal ? 'holiday' : inst.isSunday ? 'sunday' : null
    const bonusPct = sundayHoliday === 'holiday' ? r.holidayBonusPct : sundayHoliday === 'sunday' ? r.sundayBonusPct : 0
    const bonus = Math.round((inst.net * bonusPct) / 100)
    const notes = []
    if (replaced.length) notes.push(`Vertretung für ${replaced.map(nameOf).join(', ')}`)
    if (inst.status === 'moved') notes.push(`verschoben von ${formatDate(inst.origDate)}${inst.reason === 'holiday' ? ' (Feiertag)' : ''}`)
    if (inst.timeChanged) notes.push('Zeit diese Woche geändert')
    if (bonus) notes.push(`inkl. ${bonusPct} % ${sundayHoliday === 'holiday' ? 'Feiertags' : 'Sonntags'}zuschlag`)
    if (inst.breakMin) notes.push(`${inst.breakMin} min Pause abgezogen`)
    if (inst.note) notes.push(inst.note)
    dayMap.get(inst.date).lines.push({
      kind: 'work',
      inst,
      time: `${inst.startTime} - ${inst.endTime}`,
      text: text(inst),
      hours: inst.net,
      bonus,
      credited: inst.net + bonus,
      creditReason: null,
      travel: 0,
      nightMinutes: emp.minor ? 0 : windowMinutes(inst.start, inst.end, r.nightStart, r.nightEnd),
      sundayHoliday,
      substitute: replaced.length > 0,
      style: inst.category === 'sonder' ? 'special' : replaced.length || inst.status === 'moved' ? 'changed' : 'normal',
      notes,
    })
  }

  for (const day of days) {
    const work = day.lines.filter((l) => l.kind === 'work')
    for (const leg of travelLegs(work.map((l) => l.inst), ctx)) {
      work.find((l) => l.inst === leg.from).travel += leg.minutes
    }
  }

  // Stammeinsätze, die diese Person diese Woche nicht selbst arbeitet
  for (const inst of instances) {
    if (!inst.regulars.includes(emp.id) || inst.origDate < monday || inst.origDate > sunday) continue
    const base = {
      kind: 'missed',
      inst,
      time: `${inst.startTime} - ${inst.endTime}`,
      text: text(inst),
      hours: inst.net,
      bonus: 0,
      credited: 0,
      creditReason: null,
      travel: 0,
      nightMinutes: 0,
      sundayHoliday: null,
      substitute: false,
      style: 'struck',
      notes: [],
    }
    if (inst.reason === 'holiday' && inst.status !== 'normal') {
      const legal = inst.origHoliday?.legal
      base.credited = legal && creditable(inst) ? inst.net : 0
      base.creditReason = base.credited ? 'feiertag' : null
      base.notes.push(inst.status === 'moved' ? `verschoben auf ${formatDate(inst.date)}` : `entfällt: ${inst.origHoliday.name}`)
      if (base.credited) base.notes.push('Feiertag angerechnet')
    } else if (inst.status === 'cancelled') {
      base.notes.push('entfällt diese Woche')
    } else if (!state.has(emp.id, inst.key)) {
      const absence = findAbsence(ctx, emp.id, inst.date)
      const others = state.assigned(inst.key).map((a) => nameOf(a.employeeId))
      if (absence) {
        base.credited = creditable(inst) ? inst.net : 0
        base.creditReason = base.credited ? absence.type : null
        base.notes.push(`${absence.type}${base.credited ? ' angerechnet' : ''}`)
      }
      base.notes.push(others.length ? `Vertretung: ${others.join(', ')}` : 'nicht besetzt')
    } else {
      continue
    }
    dayMap.get(inst.origDate)?.lines.push(base)
  }

  for (const day of days) {
    day.lines.sort((a, b) => a.inst.start - b.inst.start)
    day.credited = day.lines.reduce((s, l) => s + l.credited, 0)
    day.travel = day.lines.reduce((s, l) => s + l.travel, 0)
    day.total = day.credited + day.travel
  }
  const totals = summarizeDays(days)
  totals.soll = Math.round((emp.weeklyHours || 0) * 60)
  totals.saldo = totals.ist - totals.soll
  return { employee: emp, monday, sunday, days, totals }
}

/** Summen über Tage (für Woche oder Monatsausschnitt). */
export function summarizeDays(days) {
  const t = { hours: 0, bonus: 0, credited: 0, travel: 0, night: 0, sundayHolidayHours: 0, substituteHours: 0, credits: {}, absenceDays: {} }
  for (const day of days) {
    for (const l of day.lines) {
      t.credited += l.credited
      t.travel += l.travel
      if (l.kind === 'work') {
        t.hours += l.hours
        t.bonus += l.bonus
        t.night += l.nightMinutes
        if (l.sundayHoliday) t.sundayHolidayHours += l.hours
        if (l.substitute) t.substituteHours += l.hours
      } else if (l.creditReason) {
        t.credits[l.creditReason] = (t.credits[l.creditReason] || 0) + l.credited
      }
    }
    if (day.absence) t.absenceDays[day.absence.type] = (t.absenceDays[day.absence.type] || 0) + 1
  }
  t.ist = t.credited + t.travel
  return t
}

/** Signatur der Zeilen einer Person, um Änderungen nach dem Veröffentlichen zu erkennen. */
export function timesheetSignature(ts) {
  const parts = []
  for (const day of ts.days) for (const l of day.lines) parts.push(`${day.date}|${l.kind}|${l.time}|${l.text}|${l.credited}`)
  let h = 2166136261
  for (const ch of parts.join('\n')) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(36)
}
