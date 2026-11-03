// Kennzahlen für die Geschäftsführung: reine Funktionen (ohne Oberfläche), damit sie testbar sind.
// Eingaben sind die Daten der App (Einsätze, Einteilungen, Stempelungen, Abwesenheiten, Reklamationen,
// Belege, Material); die Ansicht (src/ui/views/kpi.js) wählt den Zeitraum und zeichnet.
//
// Minuten bleiben Minuten, Beträge sind Euro (auf Cent gerundet).

import { addDays, eachDay, isoWeekday, lastOfMonth, mondayOf } from './dates.js'
import { employedOn, weeklyHoursAt } from './contract.js'
import { isInvoice, openItems, settingsOf, totals } from './invoicing.js'
import { orderSum } from './material.js'
import { netMinutes } from './worktime.js'

const r2 = (n) => Math.round(n * 100) / 100

// ---------------------------------------------------------------- Zeitraum

/** Zeiträume: Wochen für die Wochen-Kennzahlen, Monate für die Monats-Kennzahlen. */
export const PERIODS = {
  kurz: { weeks: 4, months: 3, label: '4 Wochen · 3 Monate' },
  mittel: { weeks: 8, months: 6, label: '8 Wochen · 6 Monate' },
  lang: { weeks: 13, months: 12, label: '13 Wochen · 12 Monate' },
}

/** Letzte n Wochen bis einschließlich der Woche von today: [{ key: Montag, from, to }] (älteste zuerst). */
export function lastWeeks(n, today) {
  const current = mondayOf(today)
  return Array.from({ length: n }, (_, i) => {
    const from = addDays(current, -7 * (n - 1 - i))
    return { key: from, from, to: addDays(from, 6) }
  })
}

const monthShift = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Letzte n Monate bis einschließlich des Monats von today: [{ key: 'JJJJ-MM', from, to }]. */
export function lastMonths(n, today) {
  const current = today.slice(0, 7)
  return Array.from({ length: n }, (_, i) => {
    const key = monthShift(current, -(n - 1 - i))
    return { key, from: `${key}-01`, to: lastOfMonth(`${key}-01`) }
  })
}

/** Gleich lange Periode davor (für den Trend). */
export const previousWeeks = (weeks) => lastWeeks(weeks.length, addDays(weeks[0].from, -1))
export const previousMonths = (months) => lastMonths(months.length, addDays(months[0].from, -1))

/** Veränderung gegen die Vorperiode: { delta, pct (null ohne Vergleichswert), dir: 'up'|'down'|'flat' }. */
export function trend(current, previous) {
  const delta = current - previous
  const pct = previous ? delta / Math.abs(previous) : null
  const dir = Math.abs(delta) < 1e-9 || (pct !== null && Math.abs(pct) < 0.005) ? 'flat' : delta > 0 ? 'up' : 'down'
  return { delta, pct, dir }
}

const sum = (list, fn = (x) => x) => list.reduce((s, x) => s + (Number(fn(x)) || 0), 0)

// ---------------------------------------------------------------- Einsatzplanung

/**
 * Stunden und Besetzung je Woche.
 * instances: Einsätze (mit date, net, staff, status, key); state: PlanState (count(key));
 * stamps: Stempelungen ({ date, in, out, pause }); travelByWeek: Map Montag → Fahrminuten (optional);
 * scheduled(monday): ist die Woche schon eingeteilt? (nur dann zählen „offen“).
 * Liefert [{ key, plan, staffed, ist, travel, slots, filled, open, rate }] (Minuten; rate = filled/slots).
 */
export function weekStats({ weeks, instances, state, stamps = {}, travelByWeek = new Map(), scheduled = () => true }) {
  const stampList = Object.values(stamps || {})
  return weeks.map((w) => {
    let plan = 0
    let staffed = 0
    let slots = 0
    let filled = 0
    let open = 0
    for (const inst of instances) {
      if (inst.status === 'cancelled' || inst.date < w.from || inst.date > w.to) continue
      const staff = inst.staff || 1
      const n = Math.min(state.count(inst.key), staff)
      plan += inst.net * staff
      staffed += inst.net * n
      slots += staff
      filled += n
      if (n < staff && scheduled(w.key)) open++
    }
    const ist = sum(stampList.filter((s) => s.date >= w.from && s.date <= w.to), (s) => netMinutes(s) || 0)
    return { key: w.key, plan, staffed, ist, travel: travelByWeek.get(w.key) || 0, slots, filled, open, rate: slots ? filled / slots : null }
  })
}

/**
 * Auslastung je Person im Zeitraum: Vertrag (Wochenstunden × Wochen, nur beschäftigte Tage) gegen
 * eingeteilte Stunden. Liefert [{ emp, contract, planned, pct }] absteigend nach pct (ohne Vertrag: am Ende).
 */
export function utilization({ employees, instances, state, from, to }) {
  const planned = new Map()
  for (const inst of instances) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to) continue
    for (const a of state.assigned(inst.key)) planned.set(a.employeeId, (planned.get(a.employeeId) || 0) + inst.net)
  }
  return employees
    .map((emp) => {
      let contract = 0
      for (const d of eachDay(from, to)) if (isoWeekday(d) <= 5 && employedOn(emp, d)) contract += (weeklyHoursAt(emp, d) * 60) / 5
      contract = Math.round(contract)
      const p = planned.get(emp.id) || 0
      return { emp, contract, planned: p, pct: contract ? p / contract : null }
    })
    .filter((x) => x.contract || x.planned)
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
}

/**
 * Krankenstands- und Urlaubsquote je Monat: Abwesenheitstage an Soll-Tagen (Mo–Fr, beschäftigt, kein
 * gesetzlicher Feiertag) geteilt durch alle Soll-Tage. holidays: Set oder Map mit Feiertagsdaten.
 * Liefert [{ key, sollDays, sick, vacation, sickRate, vacationRate }].
 */
export function absenceRates({ months, employees, absences = [], holidays = new Set() }) {
  const isHoliday = (d) => (holidays.has ? holidays.has(d) : false)
  return months.map((m) => {
    let sollDays = 0
    let sick = 0
    let vacation = 0
    const byEmp = new Map()
    for (const a of absences) {
      if (a.to < m.from || a.from > m.to) continue
      if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, [])
      byEmp.get(a.employeeId).push(a)
    }
    for (const emp of employees) {
      const list = byEmp.get(emp.id) || []
      for (const d of eachDay(m.from, m.to)) {
        if (isoWeekday(d) > 5 || isHoliday(d) || !employedOn(emp, d)) continue
        sollDays++
        const a = list.find((x) => x.from <= d && x.to >= d)
        if (a?.type === 'Krankenstand') sick++
        else if (a?.type === 'Urlaub') vacation++
      }
    }
    return { key: m.key, sollDays, sick, vacation, sickRate: sollDays ? sick / sollDays : 0, vacationRate: sollDays ? vacation / sollDays : 0 }
  })
}

/**
 * Plus-Stunden eines Monats aus der Monatsauswertung (reports.js → monthReport): Stunden über dem Soll,
 * getrennt nach Vollzeit (Überstunden) und Teilzeit/geringfügig (Mehrarbeit). Minus-Stunden zählen nicht.
 */
export function plusHours(rows) {
  let overtime = 0
  let extra = 0
  for (const r of rows) {
    const plus = Math.max(0, r.saldo || 0)
    if (!plus) continue
    if (/vollzeit/i.test(r.employee?.type || '')) overtime += plus
    else extra += plus
  }
  return { overtime, extra, total: overtime + extra }
}

// ---------------------------------------------------------------- Reklamationen

const complaintDate = (c) => String(c.received || c.createdAt || c.date || '').slice(0, 10)

/** Reklamationen je Monat: [{ key, count, open }] (open: davon noch nicht erledigt). */
export function complaintsByMonth(items = [], months) {
  return months.map((m) => {
    const list = items.filter((c) => {
      const d = complaintDate(c)
      return d >= m.from && d <= m.to
    })
    return { key: m.key, count: list.length, open: list.filter((c) => c.status !== 'erledigt').length }
  })
}

/** Objekte mit den meisten Reklamationen im Zeitraum: [{ objectId, count, open }], höchstens n. */
export function complaintsTopObjects(items = [], { from, to, n = 5 }) {
  const map = new Map()
  for (const c of items) {
    const d = complaintDate(c)
    if (d < from || d > to || !c.objectId) continue
    const x = map.get(c.objectId) || { objectId: c.objectId, count: 0, open: 0 }
    x.count++
    if (c.status !== 'erledigt') x.open++
    map.set(c.objectId, x)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.open - a.open).slice(0, n)
}

// ---------------------------------------------------------------- Fakturierung

const docNet = (d, settings) => (d.total || totals(d, settings)).net

/** Umsatz netto je Monat (festgeschriebene Rechnungen, Storno und Korrekturen mindern): [{ key, net, count }]. */
export function revenueMonths(doc = {}, months) {
  const settings = settingsOf(doc)
  const docs = doc.documents || []
  return months.map((m) => {
    const list = docs.filter((d) => isInvoice(d) && d.number && d.date >= m.from && d.date <= m.to)
    return { key: m.key, net: r2(sum(list, (d) => docNet(d, settings))), count: list.filter((d) => d.kind === 'rechnung').length }
  })
}

export const AGING = [
  ['nicht', 'nicht fällig'],
  ['d30', '1–30 Tage'],
  ['d60', '31–60 Tage'],
  ['d60plus', 'über 60 Tage'],
]

/** Offene Posten nach Fälligkeit: [{ id, label, amount, count }] in der Reihenfolge von AGING. */
export function aging(doc = {}, today) {
  const settings = settingsOf(doc)
  const buckets = Object.fromEntries(AGING.map(([id, label]) => [id, { id, label, amount: 0, count: 0 }]))
  for (const x of openItems(doc.documents || [], today, settings)) {
    const due = x.doc.dueDate && x.doc.dueDate < today
    const id = !due ? 'nicht' : x.overdueDays <= 30 ? 'd30' : x.overdueDays <= 60 ? 'd60' : 'd60plus'
    buckets[id].amount = r2(buckets[id].amount + x.open)
    buckets[id].count++
  }
  return AGING.map(([id]) => buckets[id])
}

/** Kunden mit dem meisten Umsatz im Zeitraum: [{ key, name, net }], höchstens n. */
export function topCustomers(doc = {}, { from, to, n = 5 }) {
  const settings = settingsOf(doc)
  const map = new Map()
  for (const d of doc.documents || []) {
    if (!isInvoice(d) || !d.number || d.date < from || d.date > to) continue
    const key = d.customerId || d.recipient?.name || '–'
    const x = map.get(key) || { key, name: d.recipient?.name || '–', net: 0 }
    x.net = r2(x.net + docNet(d, settings))
    map.set(key, x)
  }
  return [...map.values()].filter((x) => Math.abs(x.net) > 0.004).sort((a, b) => b.net - a.net).slice(0, n)
}

/** Umsatz netto je Objekt im Zeitraum (Belege mit Objekt): Map objectId → Euro. */
export function revenueByObject(doc = {}, { from, to }) {
  const settings = settingsOf(doc)
  const map = new Map()
  for (const d of doc.documents || []) {
    if (!isInvoice(d) || !d.number || !d.objectId || d.date < from || d.date > to) continue
    map.set(d.objectId, r2((map.get(d.objectId) || 0) + docNet(d, settings)))
  }
  return map
}

// ---------------------------------------------------------------- Material

/** Materialverbrauch (Ausgaben × Preis) und Bestellwert (bestellte Bestellungen) je Monat: [{ key, used, ordered }]. */
export function materialMonths(doc = {}, months) {
  const moves = doc.moves || []
  const orders = (doc.orders || []).filter((o) => o.status && o.status !== 'entwurf')
  return months.map((m) => {
    const used = sum(moves.filter((x) => x.kind === 'ausgabe' && x.date >= m.from && x.date <= m.to), (x) => -Number(x.qty || 0) * Number(x.price || 0))
    const ordered = sum(
      orders.filter((o) => {
        const d = String(o.orderedAt || o.createdAt || '').slice(0, 10)
        return d >= m.from && d <= m.to
      }),
      orderSum,
    )
    return { key: m.key, used: r2(used), ordered: r2(ordered) }
  })
}

/** Materialverbrauch je Objekt im Zeitraum: Map objectId → Euro. */
export function materialByObject(doc = {}, { from, to }) {
  const map = new Map()
  for (const x of doc.moves || []) {
    if (x.kind !== 'ausgabe' || !x.objectId || x.date < from || x.date > to) continue
    map.set(x.objectId, r2((map.get(x.objectId) || 0) + -Number(x.qty || 0) * Number(x.price || 0)))
  }
  return map
}

/**
 * Deckungsbeitrag je Objekt: Umsatz netto − Personalkosten (eingeteilte Stunden × Lohnkosten je Stunde)
 * − Material. Nur Objekte mit Umsatz. Liefert [{ objectId, revenue, labor, material, margin, rate }] absteigend.
 */
export function contribution({ revenue = new Map(), material = new Map(), instances, state, from, to, costPerHour = 0 }) {
  const minutes = new Map()
  for (const inst of instances) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to || !revenue.has(inst.objectId)) continue
    minutes.set(inst.objectId, (minutes.get(inst.objectId) || 0) + inst.net * Math.min(state.count(inst.key), inst.staff || 1))
  }
  return [...revenue.entries()]
    .map(([objectId, rev]) => {
      const labor = r2(((minutes.get(objectId) || 0) / 60) * costPerHour)
      const mat = material.get(objectId) || 0
      const margin = r2(rev - labor - mat)
      return { objectId, revenue: rev, labor, material: mat, margin, rate: rev ? margin / rev : null }
    })
    .sort((a, b) => b.margin - a.margin)
}

// ---------------------------------------------------------------- Hilfen für die Ansicht

/** Wochen, die im Zeitraum liegen (für das Nachladen der Wochen-Dateien). */
export function rangeOf(weeks, months) {
  const from = [weeks[0]?.from, months[0]?.from].filter(Boolean).sort()[0]
  const to = [weeks.at(-1)?.to, months.at(-1)?.to].filter(Boolean).sort().at(-1)
  return { from, to }
}
