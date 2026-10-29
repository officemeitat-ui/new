// Prüfregeln nach österreichischem Arbeitsrecht (AZG, ARG, KJBG) und
// betrieblichen Vorgaben. Jede Regel ist ein Eintrag in RULES und liefert
// Markierungen ("Issues") mit Schweregrad error (Verstoß), warning (prüfen)
// oder info (Hinweis/Zuschlag). Eigene Regeln: registerRule({...}), siehe
// docs/ERWEITERN.md. Regeln lassen sich in den Einstellungen abschalten.

import { DR_LIMITS, drMaxWeeks, drPeriod, employedOn, weeklyHoursAt } from './contract.js'
import { addDays, dayIndex, dstMinutes, formatDate, formatHours, formatTime, isoWeek, mondayOf, toMinutes, MONTH_LONG, WEEKDAY_SHORT } from './dates.js'

export const DEFAULT_RULES = {
  minDailyRestH: 11, // § 12 AZG
  dailyWarnH: 10, // über 10 h nur als Überstunden
  maxDailyH: 12, // § 9 AZG
  maxAvgWeeklyH: 48, // § 9 Abs 4 AZG, Durchschnitt über 17 Wochen
  avgWeeks: 17,
  maxWeeklyH: 60, // § 9 AZG
  minWeeklyRestH: 36, // §§ 3, 4 ARG
  marginalLimitEur: 551.1, // § 5 Abs 2 ASVG: Geringfügigkeitsgrenze 2026 (monatlich, laufendes Entgelt)
  breakAfterH: 6, // § 11 AZG
  breakMin: 30,
  nightStart: '22:00', // § 12a AZG (Nachtarbeitnehmer:in); Zuschlag nach KV: pay.nightFrom/nightTo
  nightEnd: '05:00',
  travelMin: 30, // Fahrzeit zwischen zwei Objekten am selben Tag (wenn keine Matrix-Angabe)
  sundayBonusPct: 100,
  holidayBonusPct: 100,
  creditSpecialTasks: false, // Sonderleistungen in Feiertags-/Urlaubsgutschrift einrechnen
  autoExtraHoursPerWeek: 6, // Automatik darf für Vertretungen so viele Stunden über Vertrag planen
  dueLeadDays: 7, // periodische Leistungen spätestens so viele Tage vorher zuteilen
  sundayBasis: '', // Grundlage der Sonntagsarbeit (ARG-Ausnahme, KV, Betriebsvereinbarung); je Objekt ergänzbar
  disabledRules: [], // ids aus RULES, die nicht geprüft werden
  // KJBG: §§ 11, 16, 17; Wochenfreizeit § 19: zwei zusammenhängende Kalendertage mit dem Sonntag
  minor: { maxDailyH: 8, maxWeeklyH: 40, minDailyRestH: 12, nightStart: '20:00', nightEnd: '06:00' },
  // Überstunden, Mehrarbeit, Zuschläge in % des Stundenlohns (AZG, KV Denkmal-,
  // Fassaden- und Gebäudereinigung, Arbeiter/innen, ab 1.1.2026). Berechnung in overtime.js.
  pay: {
    fullTimeWeeklyH: 40, // KV: wöchentliche Normalarbeitszeit
    dailyNormalH: 9, // §§ 3, 4 AZG: 8 h, bei anderer Verteilung 9 h; darüber Überstunden
    longDayH: 10, // KV: 11. und 12. Arbeitsstunde am Tag
    mehrPct: 25, // § 19d Abs 3a AZG, KV: Mehrarbeit (Teilzeit)
    mehrBalanceMonths: 3, // zuschlagsfrei, wenn binnen 3 Monaten 1:1 ausgeglichen
    nightFrom: '21:00', // KV: Nachtarbeit Mo–Sa 21–6 Uhr
    nightTo: '06:00',
    nightPct: 50, // Normal- und Mehrarbeitsstunden in der Nacht
    sundayFrom: '06:00', // KV § 10: Sonntagszuschlag 6–21 Uhr
    sundayTo: '21:00',
    sundayNightPct: 150, // KV: Sonntag Nacht (vor 6, ab 21 Uhr), Normal- und Mehrarbeitsstunden
    drBandMaxH: 45, // KV flexible Arbeitszeit: bis 45 h pro Woche Normalarbeitszeit bei Durchrechnung
    ueTag: 50, // § 10 AZG, KV
    ueNacht: 100,
    ueSonntag: 150,
    ueSonntagnacht: 175,
    ueFeiertag: 100, // zusätzlich zum Feiertagsentgelt
    ue11Tag: 75, // angeordnete 11./12. Stunde
    ue11Nacht: 125,
    ue11Sonntag: 175,
    ue11Sonntagnacht: 175,
    ue11Feiertag: 125,
    bonusAs: 'zeit', // Sonn-/Feiertagszuschlag auf Normalstunden: 'zeit' (Wochenzettel, Zeitkonto) oder 'geld'
    ueMode: 'auszahlen', // Überstunden: 'auszahlen' | 'za' (Zeitausgleich 1:1,5) | 'mix' (1:1, Zuschlag in Geld)
    mehrMode: 'zeitkonto', // Mehrarbeit: 'zeitkonto' (binnen 3 Monaten ausgleichen) | 'auszahlen'
    taxFreeHours: 15, // § 68 Abs 2 iVm § 124b Z 440 EStG: 2026 15 Überstunden, max. 170 € (sonst 10 h, 120 €)
    taxFreeMax: 170,
  },
  wages: { 1: 15.12, 2: 13.3, 3: 12.99, 4: 13.03, 5: 12.73, 6: 12.37 }, // KV-Stundenlöhne je Lohngruppe ab 1.1.2026
}

export const SEVERITY_RANK = { info: 1, warning: 2, error: 3 }
export const SEVERITY_LABEL = { error: 'Verstoß', warning: 'Prüfen', info: 'Hinweis' }

export function mergeRules(rules = {}) {
  return {
    ...DEFAULT_RULES,
    ...rules,
    disabledRules: rules.disabledRules || [],
    minor: { ...DEFAULT_RULES.minor, ...(rules.minor || {}) },
    pay: { ...DEFAULT_RULES.pay, ...(rules.pay || {}) },
    wages: { ...DEFAULT_RULES.wages, ...(rules.wages || {}) },
  }
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function createContext({ employees, objects, absences = [], rules, travel = {}, trips = {}, published = {}, payroll = {} }, holidays) {
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
    /** Monatsabschlüsse (ausbezahlte Stunden, Zeitausgleich-Zuschläge). */
    payroll,
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
      // nächster Einsatz am selben Tag oder gleich nach Mitternacht (Nachtschicht mit Objektwechsel)
      if (!next || (next.date !== inst.date && next.start - inst.end >= 60)) return { minutes: 0, note, source: 'keine' }
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

/** Passt [start, end) (Minuten ab Mitternacht des Wochentags, end ggf. > 1440) in die Verfügbarkeit? */
export function fitsWindow(emp, weekday, start, end) {
  const w = availabilityWindow(emp, weekday)
  if (!w || start < w.from) return false
  if (end <= w.to) return true
  // über Mitternacht: verfügbar bis 24:00 und am Folgetag ab 00:00
  const next = availabilityWindow(emp, (weekday % 7) + 1)
  return w.to >= 1440 && !!next && next.from === 0 && end - 1440 <= next.to
}

export function fitsAvailability(emp, inst) {
  const dayStart = inst.start - (inst.start % 1440)
  return fitsWindow(emp, inst.weekday, inst.start - dayStart, inst.end - dayStart)
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
 * after: erster Einsatz der Person an einem späteren Tag (firstAfterDay); beginnt
 * er weniger als 60 min nach dem letzten Einsatz (über Mitternacht), zählt die
 * Fahrt dorthin noch zu diesem Tag.
 */
export function dayTrips(dayItems, ctx, empId = null, after = null) {
  const sorted = [...dayItems].sort((a, b) => a.start - b.start)
  const nextOf = (inst, i) => sorted[i + 1] || (after && after.start >= inst.end && after.start - inst.end < 60 ? after : null)
  return sorted.map((inst, i) => {
    const to = nextOf(inst, i)
    return { from: inst, to, ...ctx.tripAfter(empId, inst, to) }
  })
}

/** Erster Einsatz nach einem Tag aus einer Liste (für Fahrten über Mitternacht). */
export function firstAfterDay(items, date) {
  let best = null
  for (const i of items) if (i.date > date && (!best || i.start < best.start)) best = i
  return best
}

/** Nur Fahrten mit Dauer (für Arbeitszeitsummen). */
export function travelLegs(dayItems, ctx, empId = null, after = null) {
  return dayTrips(dayItems, ctx, empId, after).filter((t) => t.minutes > 0)
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
/**
 * Wochenfreizeit Jugendlicher (§ 19 KJBG): zwei zusammenhängende freie
 * Kalendertage, in die der Sonntag fällt (Samstag + Sonntag oder Sonntag +
 * Montag). Der Teil mit dem Sonntag (mind. 43 h) ist damit erfüllt.
 */
export function hasMinorWeeklyRest(items, monday) {
  const sunday = dayIndex(monday) + 6
  const free = (day) => !items.some((it) => it.start < (day + 1) * 1440 && it.end > day * 1440)
  return free(sunday) && (free(sunday - 1) || free(sunday + 1))
}

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
    id: 'employment',
    title: 'Beschäftigungszeitraum',
    law: 'Arbeitsvertrag',
    description: 'Einsatz vor dem Eintritt oder nach dem Austritt.',
    check({ emp, items, add }) {
      for (const it of items) if (!employedOn(emp, it.date)) add('error', 'EMPLOYMENT', 'shift', emp.exitDate && it.date > emp.exitDate ? `Nach dem Austritt (${formatDate(emp.exitDate)})` : `Vor dem Eintritt (${formatDate(emp.entryDate)})`, [it])
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
    law: 'KV, § 12a AZG, § 17 KJBG',
    description: 'Hinweis auf den Nachtzuschlag laut KV (21–6 Uhr); für Jugendliche zwischen 20 und 6 Uhr verboten.',
    check({ items, minor, limits, r, add }) {
      for (const it of items) {
        if (minor) {
          if (windowMinutes(it.start, it.end, limits.nightStart, limits.nightEnd) > 0) add('error', 'MINOR_NIGHT', 'shift', `Jugendliche dürfen zwischen ${limits.nightStart} und ${limits.nightEnd} Uhr nicht arbeiten (§ 17 KJBG)`, [it])
          continue
        }
        const night = windowMinutes(it.start, it.end, r.pay.nightFrom, r.pay.nightTo)
        if (night <= 0) continue
        // § 12a AZG: wer regelmäßig (48 Nächte im Jahr) mind. 3 h zwischen 22 und 5 Uhr arbeitet, ist Nachtarbeitnehmer:in (§ 12b: Untersuchung)
        const azg = windowMinutes(it.start, it.end, r.nightStart, r.nightEnd)
        add('info', 'NIGHT', 'shift', `Nachtarbeit ${formatHours(night)} h (${r.pay.nightFrom}–${r.pay.nightTo} Uhr), Nachtzuschlag laut KV${azg >= 180 ? `; mind. 3 h zwischen ${r.nightStart} und ${r.nightEnd} Uhr: regelmäßig (48 Nächte im Jahr) = Nachtarbeitnehmer:in (§ 12a AZG)` : ''}`, [it], { nightMinutes: night })
      }
    },
  },
  {
    id: 'sundayHoliday',
    title: 'Sonn- und Feiertagsarbeit',
    law: 'ARG, § 18 KJBG',
    description: 'Hinweis auf Zuschläge; Sonntagsarbeit braucht eine Ausnahme von der Wochenendruhe (beim Objekt oder unter Regeln hinterlegt); für Jugendliche verboten.',
    check({ items, ctx, minor, r, add }) {
      for (const it of items) {
        if (it.holiday?.legal) {
          if (minor) add('error', 'MINOR_HOLIDAY', 'shift', 'Feiertagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)', [it])
          else add('info', 'HOLIDAY', 'shift', `Feiertagsarbeit (${it.holiday.name}): Feiertagsentgelt + ${r.holidayBonusPct} % Zuschlag`, [it])
        } else if (it.isSunday) {
          if (minor) add('error', 'MINOR_SUNDAY', 'shift', 'Sonntagsarbeit für Jugendliche nicht erlaubt (§ 18 KJBG)', [it])
          else {
            // Wochenendruhe (§ 3 ARG): Sonntagsarbeit nur mit Ausnahme (§§ 10–18 ARG, ARG-VO, KV, Betriebsvereinbarung)
            const basis = ctx.objectsById.get(it.objectId)?.sundayBasis || r.sundayBasis
            if (basis) add('info', 'SUNDAY', 'shift', `Sonntagsarbeit (${basis}): ${r.sundayBonusPct} % Zuschlag 6–21 Uhr`, [it])
            else add('warning', 'SUNDAY_BASIS', 'shift', `Sonntagsarbeit ohne hinterlegte Ausnahme von der Wochenendruhe (§ 3 ARG): beim Objekt oder unter Regeln eintragen, worauf sie sich stützt (ARG-Verordnung, KV, Betriebsvereinbarung)`, [it])
          }
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
      for (const [date, ds] of byDay) {
        for (const trip of dayTrips(ds, ctx, emp.id, firstAfterDay(items, date))) {
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
    check({ emp, items, ctx, limits, add }) {
      // Arbeitstage nach Beginn-Datum; beginnt ein Einsatz < 60 min nach dem Ende des
      // Vortags (Nachtschicht mit Objektwechsel um Mitternacht), gehört er zum Vortag.
      // Ende eines Arbeitstags = Ende des letzten Einsatzes + geplante Fahrt danach.
      const groups = []
      for (const it of items) {
        const g = groups.at(-1)
        if (g && (g.date === it.date || it.start - g.end < 60)) {
          g.end = Math.max(g.end, it.end)
          if (it.end >= g.last.end) g.last = it
        } else groups.push({ date: it.date, first: it, last: it, end: it.end })
      }
      let prev = null
      for (const g of groups) {
        if (prev) {
          const end = prev.end + ctx.tripAfter(emp.id, prev.last, null).minutes
          const rest = g.first.start - end + dstMinutes(end, g.first.start)
          if (rest < limits.rest) {
            add('error', 'REST', 'day', `Ruhezeit nur ${formatHours(Math.max(rest, 0))} h: Ende ${formatDate(prev.last.date)} ${formatTime(end)}, Beginn ${formatDate(g.first.date)} ${formatTime(g.first.start)} (mind. ${limits.rest / 60} h)`, [prev.last, g.first])
          }
        }
        prev = g
      }
    },
  },
  {
    id: 'dailyBreak',
    title: 'Ruhepause',
    law: '§ 11 AZG, § 15 KJBG',
    description: 'Mehr als 6 h (Jugendliche 4,5 h) Arbeitszeit am Tag: mindestens 30 min Pause (im Einsatz oder als Lücke ohne Fahrt).',
    check({ emp, byDay, ctx, minor, r, add }) {
      const limit = minor ? 270 : r.breakAfterH * 60
      for (const [, ds] of byDay) {
        const net = ds.reduce((s, i) => s + i.net, 0)
        if (net <= limit) continue
        let best = Math.max(...ds.map((i) => i.breakMin))
        for (const t of dayTrips(ds, ctx, emp.id)) if (t.to) best = Math.max(best, t.to.start - t.from.end - t.minutes)
        if (best < r.breakMin) add('warning', 'BREAK', 'day', `${formatHours(net)} h am Tag ohne ${r.breakMin} min Ruhepause`, ds)
      }
    },
  },
  {
    id: 'weeklyHours',
    title: 'Wochenarbeitszeit',
    law: '§ 9 AZG, § 11 KJBG',
    description: 'Höchstgrenze pro Woche und 48 h im Schnitt über 17 Wochen (frühere Wochen aus den veröffentlichten Wochenplänen).',
    check({ emp, byWeek, minor, limits, r, ctx, workOfItems, add }) {
      const span = r.avgWeeks || 17
      for (const [monday, ws] of byWeek) {
        const work = workOfItems(ws)
        const kw = `KW ${isoWeek(monday).week}`
        if (work > limits.maxWeekly) add('error', 'WEEKLY_MAX', 'week', `${formatHours(work)} h in ${kw}, Höchstgrenze ${formatHours(limits.maxWeekly)} h`, ws)
        if (minor) continue
        // § 9 Abs 4 AZG: 17 Wochen bis einschließlich dieser; Wochen im Plan zählen wie geplant, ältere wie veröffentlicht.
        // Unbekannte Wochen zählen mit 0 – ein Verstoß ist damit sicher, nie geraten.
        let sum = 0
        let known = 0
        for (let i = 0; i < span; i++) {
          const m = addDays(monday, -7 * i)
          const planned = byWeek.get(m)
          const done = planned ? workOfItems(planned) : ctx.published?.[m]?.work?.[emp.id]
          if (done == null) continue
          sum += done
          known++
        }
        if (sum > r.maxAvgWeeklyH * 60 * span) add('error', 'WEEKLY_AVG', 'week', `Schnitt über ${span} Wochen bis ${kw}: ${formatHours(Math.round(sum / span))} h, mehr als ${r.maxAvgWeeklyH} h (§ 9 Abs 4 AZG)`, ws)
        else if (work > r.maxAvgWeeklyH * 60) add('warning', 'WEEKLY_48', 'week', `${formatHours(work)} h in ${kw}: über ${r.maxAvgWeeklyH} h; im Schnitt über ${span} Wochen höchstens ${r.maxAvgWeeklyH} h${known > 1 ? ` (bisher ${formatHours(Math.round(sum / span))} h aus ${known} bekannten Wochen)` : ''}`, ws)
      }
    },
  },
  {
    id: 'contract',
    title: 'Mehr- und Überstunden',
    law: '§ 19d AZG, Arbeitsvertrag, KV (Durchrechnung)',
    description: 'Geplante Stunden über den vertraglichen Wochenstunden; bei Durchrechnung (KV) die Bandbreite 35–45 h.',
    check({ emp, byWeek, workOfItems, ctx, r, add }) {
      const span = emp.durchrechnung?.weeks
      if (span > 0 && emp.type === 'Vollzeit' && span > drMaxWeeks(emp)) {
        const first = [...byWeek.values()][0] || []
        add('warning', 'DR_PERIOD', 'week', `Durchrechnung über ${span} Wochen: laut KV höchstens ${drMaxWeeks(emp)} Wochen${String(emp.wageGroup) === '2' ? '' : ` für Lohngruppe ${emp.wageGroup || '?'} (52 Wochen nur Lohngruppe 2)`}`, first.slice(0, 1))
      }
      for (const [monday, ws] of byWeek) {
        // Wochenstunden, die in dieser Woche galten
        const contract = weeklyHoursAt(emp, monday) * 60
        if (!contract) continue
        // angerechnete Feiertage der eigenen Stammeinsätze zählen wie im Wochenzettel mit
        // (z. B. Teilzeit: Einsatz vom Feiertag auf Mittwoch verschoben → Mehrstunden)
        const credit = ctx.holidayCredit?.get(`${emp.id}|${monday}`) || 0
        const work = workOfItems(ws) + credit
        // Durchrechnung (KV): 35–45 h sind Normalarbeitszeit, Überstunden erst darüber oder am Ende des Zeitraums
        const dr = contract >= (r.pay?.fullTimeWeeklyH || 40) * 60 ? drPeriod(emp, monday) : null
        if (dr) {
          const max = (r.pay?.drBandMaxH ?? DR_LIMITS.bandMaxH) * 60
          if (work > max) add('warning', 'CONTRACT', 'week', `${formatHours(work)} h geplant: über ${formatHours(max)} h (Bandbreite der Durchrechnung) +${formatHours(work - max)} h Überstunden`, ws, { overMinutes: work - max })
          else if (work < DR_LIMITS.bandMinH * 60) add('info', 'DR_BAND', 'week', `${formatHours(work)} h geplant: unter ${DR_LIMITS.bandMinH} h, der Bandbreite der Durchrechnung (KV: 35–45 h, Schnitt 40 h bis ${formatDate(dr.end)})`, ws)
          else if (work > contract) add('info', 'DR_PLUS', 'week', `${formatHours(work)} h geplant: +${formatHours(work - contract)} h ins Guthaben der Durchrechnung (bis ${formatDate(dr.end)}; Guthaben am Ende = Überstunden mit 50 %)`, ws)
          continue
        }
        if (work <= contract) continue
        const kind = emp.type === 'Vollzeit' || emp.type === 'Lehrling' ? 'Überstunden' : 'Mehrstunden (ggf. 25 % Zuschlag)'
        add('warning', 'CONTRACT', 'week', `${formatHours(work)} h geplant${credit ? ` (davon ${formatHours(credit)} h Feiertag angerechnet)` : ''} bei ${formatHours(contract)} h Vertrag: +${formatHours(work - contract)} h ${kind}`, ws, { overMinutes: work - contract })
      }
    },
  },
  {
    id: 'weeklyRest',
    title: 'Wochenruhe',
    law: '§§ 3, 4 ARG, § 19 KJBG',
    description: '36 Stunden ununterbrochene Ruhe, die einen ganzen Tag einschließen; Jugendliche: zwei zusammenhängende freie Kalendertage mit dem Sonntag.',
    check({ items, byWeek, minor, r, add }) {
      for (const [monday, ws] of byWeek) {
        if (minor) {
          if (!hasMinorWeeklyRest(items, monday)) add('error', 'MINOR_WEEKLY_REST', 'week', `Jugendliche: keine zwei zusammenhängenden freien Kalendertage mit dem Sonntag in KW ${isoWeek(monday).week} (Wochenfreizeit, § 19 KJBG)`, ws)
        } else if (!hasWeeklyRest(items, monday, r.minWeeklyRestH * 60)) add('error', 'WEEKLY_REST', 'week', `Keine ${r.minWeeklyRestH} h Wochenruhe mit einem ganzen freien Tag in KW ${isoWeek(monday).week} (§ 4 ARG)`, ws)
      }
    },
  },
  {
    id: 'monthlyLimit',
    title: 'Geringfügigkeitsgrenze',
    law: '§ 5 Abs 2 ASVG',
    description: 'Monatliches Stundenlimit der Person und Geringfügigkeitsgrenze in Euro (Stunden × Stundenlohn, ohne Sonderzahlungen).',
    check({ emp, byMonth, workOfItems, r, add }) {
      const wage = emp.hourlyWage > 0 ? emp.hourlyWage : Number(r.wages?.[emp.wageGroup]) || 0
      const euro = emp.type === 'Geringfügig' && wage > 0 && r.marginalLimitEur > 0
      if (!(emp.maxMonthHours > 0) && !euro) return
      for (const [month, ms] of byMonth) {
        const work = workOfItems(ms)
        const name = MONTH_LONG[Number(month.slice(5, 7)) - 1]
        if (emp.maxMonthHours > 0 && work > emp.maxMonthHours * 60) {
          add('error', 'MONTHLY_LIMIT', 'month', `Geringfügig: ${formatHours(work)} h im ${name}, Limit ${formatHours(emp.maxMonthHours * 60)} h (Geringfügigkeitsgrenze)`, ms)
        } else if (euro && (work / 60) * wage > r.marginalLimitEur) {
          const fmt = (x) => x.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          add('error', 'MONTHLY_EURO', 'month', `Geringfügig: ${formatHours(work)} h im ${name} × ${fmt(wage)} € = ${fmt((work / 60) * wage)} €, über der Geringfügigkeitsgrenze von ${fmt(r.marginalLimitEur)} € (dann vollversichert)`, ms)
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
  const travelByDay = new Map([...byDay].map(([d, ds]) => [d, travelLegs(ds, ctx, emp.id, firstAfterDay(items, d)).reduce((s, l) => s + l.minutes, 0)]))
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
 * Feiertagsstunden je Person und Woche („empId|Montag“ → Minuten): Stammeinsätze,
 * die wegen eines gesetzlichen Feiertags entfallen oder verschoben sind (wie im Wochenzettel).
 */
export function holidayCredits(instances, rules = {}) {
  const out = new Map()
  for (const inst of instances) {
    if (inst.reason !== 'holiday' || inst.status === 'normal' || !inst.origHoliday?.legal) continue
    if (inst.category === 'sonder' && !rules.creditSpecialTasks) continue
    const monday = mondayOf(inst.origDate)
    for (const id of inst.regulars) out.set(`${id}|${monday}`, (out.get(`${id}|${monday}`) || 0) + inst.net)
  }
  return out
}

/**
 * Prüft den ganzen Plan. Liefert Markierungen, die einen Einsatz im
 * Zeitraum [from, to] betreffen, plus Indizes für die Darstellung.
 */
export function validatePlan(ctx, state, instances, { from, to }) {
  const all = []
  const vctx = { ...ctx, holidayCredit: holidayCredits(instances, ctx.rules) }
  for (const emp of ctx.employees) {
    const list = state.instancesOf(emp.id)
    if (list.length) all.push(...evaluateEmployee(emp, list, vctx))
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
