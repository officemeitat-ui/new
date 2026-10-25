// Überstunden, Mehrarbeit und Zuschläge nach österreichischem Recht (AZG, ARG,
// KV Denkmal-, Fassaden- und Gebäudereinigung). Grundlage ist der Wochenzettel:
// gearbeitete Zeit inkl. Fahrzeit und angerechnete Stunden (Urlaub,
// Krankenstand, Feiertag). Alle Grenzen und Sätze stehen in rules.pay.
//
// Einordnung je Person und Woche:
//  1. Je Tag: was über die tägliche Normalarbeitszeit (9 h) hinausgeht, sind
//     Überstunden, ab der 11. Stunde mit eigenem Satz.
//  2. Je Woche, chronologisch, Anrechnungen zuerst: bis zum Vertrag
//     Normalstunden, bis 40 h Mehrarbeit (Teilzeit), darüber Überstunden.
//  3. Jede Minute bekommt eine Zeitklasse: Feiertag, Sonntag, Nacht oder Tag.
//
// Mehrarbeit ist zuschlagsfrei, wenn sie binnen 3 Monaten 1:1 durch
// Zeitausgleich ausgeglichen wird (§ 19d Abs 3b AZG, KV), sonst 25 %.
// Überstunden: 50 % (Nacht 100 %, Sonntag 150 %, …), ausbezahlt oder als
// Zeitausgleich 1:1,5 (§ 10 AZG).

import { addDays, formatHours, fromDayIndex, isoWeekday, lastOfMonth, mondayOf } from './dates.js'
import { windowMinutes } from './rules.js'

export const HOUR_TYPES = { normal: 'Normalstunden', mehr: 'Mehrarbeit', ue: 'Überstunden', ue11: 'Überstunden 11./12. Stunde' }
export const TIME_CLASSES = { tag: 'Tag', nacht: 'Nacht', sonntag: 'Sonntag', feiertag: 'Feiertag' }
export const UE_MODES = { auszahlen: 'Auszahlen', za: 'Zeitausgleich 1:1,5', mix: 'Zeitausgleich 1:1 + Zuschlag in Geld' }
export const MEHR_MODES = { zeitkonto: 'Zeitkonto (binnen 3 Monaten ausgleichen)', auszahlen: 'Auszahlen mit Zuschlag' }

const cap = (s) => s[0].toUpperCase() + s.slice(1)
const money = (min, wage, pct) => Math.round(((min / 60) * wage * pct) / 100 * 100) / 100

/** Datum + n Monate (gleicher Tag, am Monatsende begrenzt): Frist für den Ausgleich von Mehrarbeit. */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  const first = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
  const last = Number(lastOfMonth(first).slice(8))
  return `${first.slice(0, 8)}${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Stundenlohn: eigener Lohn der Person, sonst KV-Lohn ihrer Lohngruppe (0 = unbekannt). */
export function hourlyWage(emp, rules) {
  return emp.hourlyWage > 0 ? emp.hourlyWage : Number(rules.wages?.[emp.wageGroup]) || 0
}

/** Zeitklassen eines Zeitraums (Minuten seit 1970): Feiertag, Sonntag, Nacht, Tag. */
function timeClasses(start, end, holidays, p) {
  const out = []
  for (let s = start; s < end; ) {
    const day = Math.floor(s / 1440)
    const e = Math.min(end, (day + 1) * 1440)
    const date = fromDayIndex(day)
    if (holidays.get(date)?.legal) out.push({ date, cls: 'feiertag', min: e - s })
    else if (isoWeekday(date) === 7) out.push({ date, cls: 'sonntag', min: e - s })
    else {
      const night = windowMinutes(s, e, p.nightFrom, p.nightTo)
      if (night) out.push({ date, cls: 'nacht', min: night })
      if (e - s > night) out.push({ date, cls: 'tag', min: e - s - night })
    }
    s = e
  }
  return out
}

/** Abschnitte [start, end) an Grenzen eines laufenden Zählers aufteilen: `kind(stand)` → [art, platz bis zur nächsten Grenze]. */
function splitBy(pieces, counter, kind) {
  const out = []
  for (const piece of pieces) {
    for (let s = piece.start; s < piece.end; ) {
      const [type, room] = kind(counter.get(piece))
      const len = Math.min(piece.end - s, room)
      out.push({ ...piece, start: s, end: s + len, type })
      counter.add(piece, len)
      s += len
    }
  }
  return out
}

/**
 * Eine Woche einer Person einordnen. `ts` = buildTimesheet(...).
 * Liefert Summen (Minuten) und `parts` [{ date, type, cls, min }] für die Abrechnung je Monat.
 */
export function classifyWeek(ctx, ts) {
  const p = ctx.rules.pay
  const dailyNormal = p.dailyNormalH * 60
  const longDay = Math.max(dailyNormal, p.longDayH * 60)
  const fullTime = p.fullTimeWeeklyH * 60
  const contract = Math.min(ts.totals.soll, fullTime)
  const segments = []
  let credited = 0
  for (const day of ts.days) {
    for (const l of day.lines) {
      if (l.kind === 'work') {
        segments.push({ date: day.date, start: l.inst.start, end: l.inst.start + l.hours })
        if (l.travel) segments.push({ date: day.date, start: l.inst.end, end: l.inst.end + l.travel })
      } else if (l.creditReason) credited += l.credited
    }
  }
  segments.sort((a, b) => a.start - b.start)

  // 1. Tagesgrenze (Fahrzeit zählt mit)
  const perDay = new Map()
  const byDay = { get: (x) => perDay.get(x.date) || 0, add: (x, n) => perDay.set(x.date, (perDay.get(x.date) || 0) + n) }
  const daily = splitBy(segments, byDay, (used) => (used < dailyNormal ? ['base', dailyNormal - used] : used < longDay ? ['ue', longDay - used] : ['ue11', Infinity]))

  // 2. Wochengrenze: Anrechnungen füllen zuerst den Vertrag
  let week = credited
  const byWeek = { get: () => week, add: (_, n) => (week += n) }
  const weekly = splitBy(daily.filter((x) => x.type === 'base'), byWeek, (used) => (used < contract ? ['normal', contract - used] : used < fullTime ? ['mehr', fullTime - used] : ['ue', Infinity]))

  // 3. Zeitklassen
  const sum = { normal: 0, mehr: 0, ue: 0, ue11: 0 }
  const parts = []
  for (const t of [...weekly, ...daily.filter((x) => x.type !== 'base')]) {
    for (const c of timeClasses(t.start, t.end, ctx.holidays, p)) {
      parts.push({ date: c.date, type: t.type, cls: c.cls, min: c.min })
      sum[t.type] += c.min
    }
  }
  const longest = Math.max(0, ...perDay.values())
  return {
    monday: ts.monday,
    sunday: ts.sunday,
    contract,
    credited,
    worked: segments.reduce((s, x) => s + x.end - x.start, 0),
    ...sum,
    minus: Math.max(0, contract - credited - sum.normal),
    longest,
    parts,
  }
}

/**
 * Mehrstunden-Konto bis zum Stichtag `until`: Mehrarbeit je Tag, ausgeglichen
 * durch Minusstunden (1:1, älteste zuerst, nur innerhalb der Frist).
 * Abgeschlossene Monate (`closures`) nehmen ausbezahlte und fällige Stunden heraus.
 */
export function mehrLedger(weeks, { months = 3, closures = {}, empId, until, skipMonth }) {
  const items = []
  for (const w of weeks) {
    for (const part of w.parts) if (part.type === 'mehr') items.push({ date: part.date, kind: 'plus', min: part.min })
    if (w.minus) items.push({ date: w.sunday, kind: 'minus', min: w.minus })
  }
  for (const [month, closure] of Object.entries(closures)) {
    const row = closure?.closedAt && month !== skipMonth ? closure.rows?.[empId] : null
    if (row) items.push({ date: lastOfMonth(`${month}-01`), kind: 'closure', min: row.mehrPaid || 0, entries: row.mehrPaidEntries })
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'closure') - (b.kind === 'closure'))
  const open = []
  const take = (min, usable = () => true) => {
    let rest = min
    for (const e of open) {
      if (!rest) break
      if (!usable(e)) continue
      const n = Math.min(e.min, rest)
      e.min -= n
      rest -= n
    }
    return min - rest
  }
  for (const it of items) {
    if (it.date > until) break
    if (it.kind === 'plus') {
      const last = open.at(-1)
      if (last?.date === it.date) last.min += it.min
      else open.push({ date: it.date, min: it.min, deadline: addMonths(it.date, months) })
    } else if (it.kind === 'minus') {
      it.used = take(it.min, (e) => e.deadline >= it.date)
    } else {
      // Abschluss: genau die ausbezahlten Tage herausnehmen (ältere Abschlüsse: älteste zuerst), Fälliges ist erledigt
      if (it.entries) for (const paid of it.entries) take(paid.min, (e) => e.date === paid.date)
      else take(it.min)
      for (const e of open) if (e.deadline <= it.date) e.min = 0
    }
    for (let i = open.length - 1; i >= 0; i--) if (!open[i].min) open.splice(i, 1)
  }
  return { open, items: items.filter((it) => it.date <= until) }
}

/** Zuschlag in % für eine Stundenart und Zeitklasse. */
export function premiumPct(rules, type, cls) {
  const p = rules.pay
  if (type === 'ue' || type === 'ue11') return Number(p[`${type}${cap(cls)}`]) || 0
  if (cls === 'nacht') return p.nightPct
  if (cls === 'sonntag') return rules.sundayBonusPct
  if (cls === 'feiertag') return rules.holidayBonusPct
  return 0
}

/** Teil des Zuschlags, der schon als Zeit im Wochenzettel gutgeschrieben ist (Sonn-/Feiertag). */
function timeCreditedPct(rules, cls) {
  if (rules.pay.bonusAs === 'geld') return 0
  return cls === 'sonntag' ? rules.sundayBonusPct : cls === 'feiertag' ? rules.holidayBonusPct : 0
}

/**
 * Abrechnung eines Monats für eine Person.
 *  weeks: classifyWeek(...) aller Wochen vom Ausgleichszeitraum vor dem Monat bis Monatsende
 *  modes: { ue, mehr } für diesen Monat (sonst Person, sonst Regeln)
 * Liefert Stunden, Mehrstunden-Konto, Lohnzeilen, Betrag, Buchung ins Zeitkonto.
 */
export function payMonth(ctx, emp, month, weeks, { closures = {}, modes = {} } = {}) {
  const r = ctx.rules
  const p = r.pay
  const from = `${month}-01`
  const to = lastOfMonth(from)
  const wage = hourlyWage(emp, r)
  const ueMode = modes.ue || emp.ueMode || p.ueMode
  const mehrMode = modes.mehr || emp.mehrMode || p.mehrMode
  const inMonth = (d) => d >= from && d <= to

  // Stunden des Monats nach Art und Zeitklasse
  const hours = { normal: {}, mehr: {}, ue: {}, ue11: {} }
  const total = { normal: 0, mehr: 0, ue: 0, ue11: 0 }
  const ueParts = []
  for (const w of weeks) {
    for (const part of w.parts) {
      if (!inMonth(part.date)) continue
      hours[part.type][part.cls] = (hours[part.type][part.cls] || 0) + part.min
      total[part.type] += part.min
      if (part.type === 'ue' || part.type === 'ue11') ueParts.push(part)
    }
  }

  // Mehrstunden-Konto: Ausgleich, fällig (Frist abgelaufen), offen
  const ledger = mehrLedger(weeks, { months: p.mehrBalanceMonths, closures, empId: emp.id, until: to, skipMonth: month })
  const balancedInMonth = ledger.items.filter((it) => it.kind === 'minus' && inMonth(it.date)).reduce((s, it) => s + (it.used || 0), 0)
  const due = ledger.open.filter((e) => e.deadline <= to)
  const dueMin = due.reduce((s, e) => s + e.min, 0)
  const fresh = ledger.open.filter((e) => e.deadline > to && inMonth(e.date))
  const paidEntries = [...due, ...(mehrMode === 'auszahlen' ? fresh : [])].map(({ date, min }) => ({ date, min }))
  const mehrPaid = paidEntries.reduce((s, e) => s + e.min, 0)
  const stillOpen = ledger.open.filter((e) => e.deadline > to && !(mehrMode === 'auszahlen' && inMonth(e.date)))

  // Lohnzeilen
  const lines = []
  const line = (key, label, min, pct, base, note = '') => {
    if (!min) return
    const amount = money(min, wage, (base ? 100 : 0) + pct)
    lines.push({ key, label, min, pct, base, amount, note })
  }
  const lateNote = `nicht binnen ${p.mehrBalanceMonths} Monaten ausgeglichen`
  line('mehr', `Mehrarbeit ausbezahlt (+${p.mehrPct} %)`, mehrPaid, p.mehrPct, true, !dueMin ? 'sofort ausbezahlt' : dueMin === mehrPaid ? lateNote : `davon ${formatHours(dueMin)} h ${lateNote}`)
  for (const cls of ['nacht', 'sonntag', 'feiertag']) {
    const min = (hours.normal[cls] || 0) + (hours.mehr[cls] || 0)
    const pct = premiumPct(r, 'normal', cls) - timeCreditedPct(r, cls)
    if (pct > 0) line(`zuschlag-${cls}`, `${cls === 'nacht' ? 'Nachtzuschlag' : cls === 'sonntag' ? 'Sonntagszuschlag' : 'Feiertagsarbeitsentgelt'} ${pct} %`, min, pct, false, 'Normal- und Mehrarbeitsstunden')
  }
  let zaBonus = 0
  for (const type of ['ue', 'ue11']) {
    for (const cls of Object.keys(TIME_CLASSES)) {
      const min = hours[type][cls] || 0
      if (!min) continue
      const pct = premiumPct(r, type, cls)
      const moneyPct = Math.max(0, pct - timeCreditedPct(r, cls))
      const label = `${HOUR_TYPES[type]}${cls === 'tag' ? '' : ` ${TIME_CLASSES[cls]}`} (+${pct} %)`
      if (ueMode === 'auszahlen') line(`${type}-${cls}`, label, min, moneyPct, true, moneyPct < pct ? `${pct - moneyPct} % schon als Zeit gutgeschrieben` : '')
      else if (ueMode === 'mix') line(`${type}-${cls}`, `Zuschlag ${label}`, min, moneyPct, false, 'Stunden als Zeitausgleich 1:1')
      else zaBonus += Math.round((min * moneyPct) / 100)
    }
  }
  const amount = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const uePaid = ueMode === 'auszahlen' ? total.ue + total.ue11 : 0

  // Steuerfreie Überstundenzuschläge (§ 68 Abs 2 EStG): erste n Überstunden, Zuschlag bis 50 %, Höchstbetrag
  let taxFree = 0
  if (ueMode !== 'za') {
    let left = p.taxFreeHours * 60
    for (const part of [...ueParts].sort((a, b) => a.date.localeCompare(b.date))) {
      const n = Math.min(left, part.min)
      left -= n
      taxFree += ((n / 60) * wage * Math.min(50, Math.max(0, premiumPct(r, part.type, part.cls) - timeCreditedPct(r, part.cls)))) / 100
      if (!left) break
    }
    taxFree = Math.min(p.taxFreeMax, Math.round(taxFree * 100) / 100)
  }

  return {
    employee: emp,
    month,
    wage,
    ueMode,
    mehrMode,
    hours,
    total,
    mehr: { added: total.mehr, balanced: balancedInMonth, due, dueMin, paid: mehrPaid, paidEntries, open: stillOpen, openMin: stillOpen.reduce((s, e) => s + e.min, 0) },
    lines,
    amount,
    zaBonus,
    uePaid,
    taxFree,
    // Zeitkonto: ausbezahlte Stunden gehen hinaus, Zeitausgleich-Zuschläge kommen dazu
    accountDelta: -(mehrPaid + uePaid) + zaBonus,
    weeks: weeks.filter((w) => w.sunday >= from && w.monday <= to),
  }
}

/** Erste Woche, die für den Monat gebraucht wird (Ausgleichszeitraum der Mehrarbeit + Puffer). */
export function payrollFrom(month, rules) {
  return mondayOf(addMonths(`${month}-01`, -((rules.pay?.mehrBalanceMonths ?? 3) + 1)))
}

/** Montage von `from` bis Monatsende. */
export function payrollWeeks(month, rules) {
  const out = []
  for (let m = payrollFrom(month, rules); m <= lastOfMonth(`${month}-01`); m = addDays(m, 7)) out.push(m)
  return out
}

/** Zeile für den Monatsabschluss (gespeichert in data.payroll[monat].rows[person]). */
export function closureRow(res) {
  return {
    wage: res.wage,
    ueMode: res.ueMode,
    mehrMode: res.mehrMode,
    mehrPaid: res.mehr.paid,
    mehrPaidEntries: res.mehr.paidEntries,
    mehrDue: res.mehr.dueMin,
    uePaid: res.uePaid,
    zaBonus: res.zaBonus,
    amount: res.amount,
    taxFree: res.taxFree,
    accountDelta: res.accountDelta,
    lines: res.lines.map(({ key, label, min, pct, base, amount }) => ({ key, label, min, pct, base, amount })),
  }
}
