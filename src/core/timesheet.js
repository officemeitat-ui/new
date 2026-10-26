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

import { sollMinutes } from './contract.js'
import { addDays, eachDay, formatDate, fromDayIndex, isoWeekday } from './dates.js'
import { dayTrips, findAbsence, firstAfterDay, windowMinutes } from './rules.js'
import { dutyText } from './waste.js'

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
    // Sonn-/Feiertagszuschlag als Zeitgutschrift (wie im bisherigen Wochenzettel) oder in Geld (Überstunden & Auszahlung)
    const bonusAsMoney = r.pay?.bonusAs === 'geld'
    // Zuschlag als Zeit je Kalendertag (Schicht Sa 22–02 Uhr: Sonntagsanteil ab Mitternacht)
    const bonus = bonusAsMoney ? 0 : calendarBonus(ctx, inst)
    const notes = []
    if (replaced.length) notes.push(`Vertretung für ${replaced.map(nameOf).join(', ')}`)
    if (inst.status === 'moved') notes.push(`verschoben von ${formatDate(inst.origDate)}${inst.reason === 'holiday' ? ' (Feiertag)' : ''}`)
    if (inst.timeChanged) notes.push('Zeit diese Woche geändert')
    for (const a of inst.addOns || []) notes.push(`${dutyText(a)} (+${a.minutes} min)`)
    const wasteNote = (inst.waste || inst.addOns?.length) && ctx.objectsById.get(inst.objectId)?.waste?.note
    if (wasteNote) notes.push(wasteNote)
    if (bonus) notes.push(`inkl. ${bonusPct} % ${sundayHoliday === 'holiday' ? 'Feiertags' : 'Sonntags'}zuschlag`)
    else if (bonusAsMoney && bonusPct) notes.push(`${bonusPct} % ${sundayHoliday === 'holiday' ? 'Feiertags' : 'Sonntags'}zuschlag wird ausbezahlt`)
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

  // Fahrt nach jedem Einsatz (wie die Spalte „Fahrzeit“ im bisherigen Plan)
  const allWork = days.flatMap((d) => d.lines.filter((l) => l.kind === 'work').map((l) => l.inst))
  for (const day of days) {
    const work = day.lines.filter((l) => l.kind === 'work')
    for (const trip of dayTrips(work.map((l) => l.inst), ctx, emp.id, firstAfterDay(allWork, day.date))) {
      const line = work.find((l) => l.inst === trip.from)
      line.travel = trip.minutes
      line.trip = { minutes: trip.minutes, note: trip.note, source: trip.source, to: trip.to }
      if (trip.note) line.notes.push(`Fahrt: ${trip.note}`)
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
      if (absence && inst.holiday?.legal) {
        // Feiertag in Urlaub/Krankenstand/Zeitausgleich: Feiertagsentgelt, kein Urlaubs- oder ZA-Tag
        base.credited = creditable(inst) ? inst.net : 0
        base.creditReason = base.credited ? 'feiertag' : null
        base.notes.push(`Feiertag (${absence.type})${base.credited ? ' angerechnet' : ''}`)
      } else if (absence?.type === 'Zeitausgleich') {
        // Zeitausgleich wird nicht angerechnet: die Stunden kommen aus dem Zeitkonto
        base.notes.push('Zeitausgleich (aus dem Zeitkonto)')
      } else if (absence) {
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
  // Soll mit den damals gültigen Wochenstunden, anteilig bei Ein-/Austritt in dieser Woche
  totals.soll = sollMinutes(emp, monday, addDays(monday, 6))
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
    // Abwesenheitstage wie im Urlaubskonto: Montag bis Freitag ohne Feiertage
    if (day.absence && isoWeekday(day.date) <= 5 && !day.holiday?.legal) t.absenceDays[day.absence.type] = (t.absenceDays[day.absence.type] || 0) + 1
  }
  t.ist = t.credited + t.travel
  return t
}

/** Signatur der Zeilen einer Person, um Änderungen nach dem Veröffentlichen zu erkennen. */
export function timesheetSignature(ts) {
  const parts = []
  for (const day of ts.days) {
    if (day.absence) parts.push(`${day.date}|abwesend|${day.absence.type}`)
    for (const l of day.lines) parts.push(`${day.date}|${l.kind}|${l.time}|${l.text}|${l.credited}`)
  }
  let h = 2166136261
  for (const ch of parts.join('\n')) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(36)
}

/** Sonn-/Feiertagszuschlag als Zeit je Kalendertag (gleiche Teilung wie timeClasses in overtime.js). */
function calendarBonus(ctx, inst) {
  const r = ctx.rules
  let total = 0
  for (let s = inst.start, end = inst.start + inst.net; s < end; ) {
    const day = Math.floor(s / 1440)
    const e = Math.min(end, (day + 1) * 1440)
    const date = fromDayIndex(day)
    const pct = ctx.holidays.get(date)?.legal ? r.holidayBonusPct : isoWeekday(date) === 7 ? r.sundayBonusPct : 0
    total += ((e - s) * pct) / 100
    s = e
  }
  return Math.round(total)
}
