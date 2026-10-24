// Wochenzettel je Mitarbeiter:in, aufgebaut wie der bisherige Excel-Wochenplan:
// Zeit | Objekt | Std. | Arbeitszeit | Fahrzeit, mit Soll und Saldo.
//
// Anrechnung (Ausfallprinzip):
//  - entfällt ein Stammeinsatz wegen eines gesetzlichen Feiertags (oder wird er
//    verschoben), werden die Stunden am Feiertag gutgeschrieben
//  - bei Urlaub/Krankenstand werden die Stammeinsätze gutgeschrieben, die
//    Vertretung arbeitet sie zusätzlich
//  - Sonn- und Feiertagsarbeit wird mit Zuschlag angerechnet (z. B. 1,5 h → 3 h)

import { addDays, eachDay, formatDate } from './dates.js'
import { findAbsence, travelLegs } from './rules.js'

export function buildTimesheet(ctx, emp, monday, instances, state) {
  const r = ctx.rules
  const sunday = addDays(monday, 6)
  const nameOf = (id) => ctx.employeesById.get(id)?.name || 'unbekannt'
  const objName = (inst) => ctx.objectsById.get(inst.objectId)?.name || 'Objekt'
  const creditable = (inst) => inst.category !== 'sonder' || r.creditSpecialTasks

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
    const bonusPct = inst.holiday?.legal ? r.holidayBonusPct : inst.isSunday ? r.sundayBonusPct : 0
    const bonus = Math.round((inst.net * bonusPct) / 100)
    const notes = []
    if (replaced.length) notes.push(`Vertretung für ${replaced.map(nameOf).join(', ')}`)
    if (inst.status === 'moved') notes.push(`verschoben von ${formatDate(inst.origDate)}${inst.reason === 'holiday' ? ' (Feiertag)' : ''}`)
    if (inst.timeChanged) notes.push('Zeit diese Woche geändert')
    if (bonus) notes.push(`inkl. ${bonusPct} % ${inst.holiday?.legal ? 'Feiertags' : 'Sonntags'}zuschlag`)
    if (inst.breakMin) notes.push(`${inst.breakMin} min Pause abgezogen`)
    if (inst.note) notes.push(inst.note)
    dayMap.get(inst.date).lines.push({
      kind: 'work',
      inst,
      time: `${inst.startTime} - ${inst.endTime}`,
      text: `Objekt: ${objName(inst)}${inst.label ? ` – ${inst.label}` : ''}`,
      hours: inst.net,
      credited: inst.net + bonus,
      travel: 0,
      style: inst.category === 'sonder' ? 'special' : replaced.length || inst.status === 'moved' ? 'changed' : 'normal',
      notes,
    })
  }

  for (const day of days) {
    const work = day.lines.filter((l) => l.kind === 'work')
    for (const leg of travelLegs(work.map((l) => l.inst), r)) {
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
      text: `Objekt: ${objName(inst)}${inst.label ? ` – ${inst.label}` : ''}`,
      hours: inst.net,
      credited: 0,
      travel: 0,
      style: 'struck',
      notes: [],
    }
    if (inst.reason === 'holiday' && inst.status !== 'normal') {
      const legal = inst.origHoliday?.legal
      base.credited = legal && creditable(inst) ? inst.net : 0
      base.notes.push(inst.status === 'moved' ? `verschoben auf ${formatDate(inst.date)}` : `entfällt: ${inst.origHoliday.name}`)
      if (base.credited) base.notes.push('Feiertag angerechnet')
    } else if (inst.status === 'cancelled') {
      base.notes.push('entfällt diese Woche')
    } else if (!state.has(emp.id, inst.key)) {
      const absence = findAbsence(ctx, emp.id, inst.date)
      const others = state.assigned(inst.key).map((a) => nameOf(a.employeeId))
      if (absence) {
        base.credited = creditable(inst) ? inst.net : 0
        base.notes.push(`${absence.type}${base.credited ? ' angerechnet' : ''}`)
      }
      base.notes.push(others.length ? `Vertretung: ${others.join(', ')}` : 'nicht besetzt')
    } else {
      continue
    }
    dayMap.get(inst.origDate)?.lines.push(base)
  }

  let hours = 0
  let credited = 0
  let travel = 0
  for (const day of days) {
    day.lines.sort((a, b) => a.inst.start - b.inst.start)
    day.credited = day.lines.reduce((s, l) => s + l.credited, 0)
    day.travel = day.lines.reduce((s, l) => s + l.travel, 0)
    day.total = day.credited + day.travel
    hours += day.lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.hours, 0)
    credited += day.credited
    travel += day.travel
  }
  const soll = Math.round((emp.weeklyHours || 0) * 60)
  return {
    employee: emp,
    monday,
    sunday,
    days,
    totals: { soll, hours, credited, travel, ist: credited + travel, saldo: credited + travel - soll },
  }
}
