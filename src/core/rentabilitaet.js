// Rentabilität je Objekt (Kürzel rnt-): Umsatz gegen Kosten im Zeitraum, mit Ampel gegen einen Ziel-Deckungsbeitrag
// und dem Umsatz, der für das Ziel nötig wäre (Vorschlag zur Preisanpassung, Vertrag des Objekts).
//
// Kosten je Objekt:
//  - Personal: Stunden × Lohnkosten je Stunde (Kalkulation: KV-Lohn plus Lohnnebenkosten). Stunden je eingeteilter
//    Person und Einsatz: gestempelt (Zeiterfassung im Objekt), sonst laut Plan; dazu Stempelungen im Objekt ohne Plan.
//  - Material: Ausgaben aus dem Lager an das Objekt.
//  - Fremdleistungen: Eingangsrechnungen mit dem Objekt als Kostenstelle (netto, ohne stornierte Erfassungen).
// Umsatz: festgeschriebene Rechnungen, Storno und Korrekturen mit Objekt (netto). Rechnungen ohne Objekt (z. B. eine
// Sammelrechnung je Kunde) werden auf die Objekte des Kunden verteilt (nach Stunden, sonst zu gleichen Teilen); nur was
// keinem Kunden mit Objekten gehört, steht als „Umsatz ohne Objekt“ daneben.
// Rein und getestet (test/rentabilitaet.test.js); Ansicht: ui/views/rentabilitaet.js.

import { addDays, dayIndex } from './dates.js'
import { isInvoice, settingsOf, totals } from './invoicing.js'
import { materialByObject, revenueByObject } from './kpi.js'

export const RENT_DEFAULTS = { target: 25, warn: 10 }
export const RENT_LEVELS = { gut: 'Ziel erreicht', knapp: 'unter Ziel', kritisch: 'kritisch', ohne: 'Kosten ohne Umsatz' }
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Ziel und Warnschwelle in Prozent (Ziel 0–80, Warnung 0 bis Ziel). */
export function rentSettings(s = {}) {
  const target = Math.min(80, Math.max(0, Number(s.target ?? RENT_DEFAULTS.target) || 0))
  const warn = Math.min(target, Math.max(0, Number(s.warn ?? RENT_DEFAULTS.warn) || 0))
  return { target, warn }
}

/** Zeitraum: die letzten n ganzen Monate vor dem laufenden (Standard 6) bzw. das Vorjahr; dazu der gleich lange davor. */
export function rentSpan(kind, today) {
  const ym = today.slice(0, 7)
  const first = `${ym}-01`
  const shift = (iso, months) => {
    const [y, m] = iso.slice(0, 7).split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + months, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  if (kind === 'vorjahr') {
    const y = Number(today.slice(0, 4)) - 1
    return { kind, label: `Jahr ${y}`, from: `${y}-01-01`, to: `${y}-12-31`, prev: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } }
  }
  const n = { '3': 3, '6': 6, '12': 12 }[String(kind)] || 6
  const from = shift(first, -n)
  const to = addDays(first, -1)
  return { kind: String(n), label: `letzte ${n} Monate`, from, to, prev: { from: shift(from, -n), to: addDays(from, -1) } }
}

/** Minuten einer Stempelung (nur mit Gehen). */
const stampMinutes = (s) => (s.in && s.out ? Math.max(0, Math.floor(Date.parse(s.out) / 6e4) - Math.floor(Date.parse(s.in) / 6e4)) : null)

/**
 * Stunden je Objekt im Zeitraum: { planned, used, stamped, pairs, stampedPairs } in Minuten. used = Grundlage der
 * Kosten (gestempelt, sonst Plan, dazu Stempelungen ohne Plan).
 */
export function hoursByObject({ instances = [], state, stamps = {}, from, to }) {
  const list = Object.values(stamps || {}).filter((s) => s.date >= from && s.date <= to)
  const byInst = new Map()
  const loose = new Map()
  for (const s of list) {
    if (s.instKey) byInst.set(`${s.instKey}|${s.empId}`, s)
    else loose.set(`${s.date}|${s.objectId}|${s.empId}`, s)
  }
  const used = new Set()
  const out = new Map()
  const at = (id) => {
    if (!out.has(id)) out.set(id, { planned: 0, used: 0, stamped: 0, pairs: 0, stampedPairs: 0 })
    return out.get(id)
  }
  const anyStamp = list.length > 0 // ohne Stempelungen im Zeitraum keine Schlüssel bauen
  for (const inst of instances) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to || !inst.objectId) continue
    const people = state.assigned(inst.key).slice(0, Math.max(1, inst.staff || 1))
    const x = at(inst.objectId)
    for (const { employeeId } of people) {
      x.planned += inst.net
      x.pairs++
      const s = anyStamp ? byInst.get(`${inst.key}|${employeeId}`) || loose.get(`${inst.date}|${inst.objectId}|${employeeId}`) : undefined
      const m = s && !used.has(s) ? stampMinutes(s) : null
      if (m !== null) {
        used.add(s)
        x.used += m
        x.stamped += m
        x.stampedPairs++
      } else x.used += inst.net
    }
  }
  // Stempelungen im Objekt ohne passenden Einsatz (z. B. zusätzlich gekommen)
  for (const s of list) {
    if (used.has(s) || !s.objectId) continue
    const m = stampMinutes(s)
    if (m === null) continue
    const x = at(s.objectId)
    x.used += m
    x.stamped += m
  }
  return out
}

/** Fremdleistungen je Objekt: Eingangsrechnungen mit Objekt (Rechnungsdatum im Zeitraum), netto. */
export function externalByObject(einkauf = {}, { from, to }) {
  const map = new Map()
  for (const inv of einkauf?.invoices || []) {
    if (inv.cancelled || !inv.objectId || !inv.date || inv.date < from || inv.date > to) continue
    const net = (inv.groups || []).reduce((s, g) => s + (Number(g.net) || 0), 0)
    map.set(inv.objectId, r2((map.get(inv.objectId) || 0) + net))
  }
  return map
}

/** Umsatz netto ohne Objekt (festgeschriebene Rechnungen, Storno, Korrekturen) im Zeitraum. */
export function revenueWithoutObject(fak = {}, { from, to }) {
  const s = settingsOf(fak)
  let sum = 0
  for (const d of fak?.documents || []) {
    if (!isInvoice(d) || !d.number || d.objectId || d.date < from || d.date > to) continue
    // wie die Kennzahlen (core/kpi.js): Storno und Korrekturen tragen ihr Vorzeichen selbst
    sum += (d.total || totals(d, s)).net
  }
  return r2(sum)
}

/**
 * Rechnungen ohne Objekt (z. B. eine Sammelrechnung je Kunde) auf die Objekte des Kunden verteilen: nach den
 * gerechneten Stunden im Zeitraum, ohne Stunden zu gleichen Teilen. { byObject: Map objectId → Euro, rest } – rest:
 * Rechnungen ohne Kunde bzw. Kunden ohne Objekte.
 */
export function distributeUnassigned(fak = {}, { from, to }, hours = new Map(), objectIds = null) {
  const s = settingsOf(fak)
  const byObject = new Map()
  let rest = 0
  const customers = new Map((fak?.customers || []).map((c) => [c.id, c]))
  for (const d of fak?.documents || []) {
    if (!isInvoice(d) || !d.number || d.objectId || d.date < from || d.date > to) continue
    const net = (d.total || totals(d, s)).net
    const objs = (customers.get(d.customerId)?.objectIds || []).filter((id) => !objectIds || objectIds.has(id))
    if (!objs.length) {
      rest += net
      continue
    }
    const w = objs.map((id) => hours.get(id)?.used || 0)
    const all = w.reduce((a, b) => a + b, 0)
    objs.forEach((id, i) => byObject.set(id, (byObject.get(id) || 0) + net * (all > 0 ? w[i] / all : 1 / objs.length)))
  }
  for (const [id, v] of byObject) byObject.set(id, r2(v))
  return { byObject, rest: r2(rest) }
}

/**
 * Rentabilität je Objekt: { rows, totals, unassigned }. rows absteigend nach Handlungsbedarf (kritisch, ohne Umsatz,
 * unter Ziel, Ziel erreicht; je Stufe nach Deckungsbeitrag). prevRates: Map objectId → Deckungsbeitrag in % der
 * Vorperiode (optional).
 */
export function rentability({ objects = [], fak = null, material = null, einkauf = null, hours = new Map(), from, to, costPerHour = 0, settings = {}, contracts = [], prevRates = new Map() }) {
  const s = rentSettings(settings)
  const direct = fak ? revenueByObject(fak, { from, to }) : new Map()
  const spread = fak ? distributeUnassigned(fak, { from, to }, hours, new Set(objects.map((o) => o.id))) : { byObject: new Map(), rest: 0 }
  const revenue = new Map(direct)
  for (const [id, v] of spread.byObject) revenue.set(id, (revenue.get(id) || 0) + v)
  const mat = material ? materialByObject(material, { from, to }) : new Map()
  const ext = einkauf ? externalByObject(einkauf, { from, to }) : new Map()
  const ids = new Set([...revenue.keys(), ...mat.keys(), ...ext.keys(), ...[...hours.entries()].filter(([, h]) => h.used > 0).map(([id]) => id)])
  const byId = new Map(objects.map((o) => [o.id, o]))
  const rows = []
  for (const id of ids) {
    const o = byId.get(id)
    const h = hours.get(id) || { planned: 0, used: 0, stamped: 0, pairs: 0, stampedPairs: 0 }
    const rev = r2(revenue.get(id) || 0)
    const labor = r2((h.used / 60) * costPerHour)
    const m = r2(mat.get(id) || 0)
    const e = r2(ext.get(id) || 0)
    const cost = r2(labor + m + e)
    const margin = r2(rev - cost)
    const rate = rev > 0.004 ? margin / rev : null
    const level = rev <= 0.004 ? (cost > 0.004 ? 'ohne' : 'gut') : rate * 100 >= s.target ? 'gut' : rate * 100 >= s.warn ? 'knapp' : 'kritisch'
    const needed = s.target < 100 ? r2(cost / (1 - s.target / 100)) : null
    const raise = rev > 0.004 && level !== 'gut' && needed !== null ? needed / rev - 1 : null
    const contract = contracts.find((c) => (c.objectIds || []).includes(id) && c.status !== 'beendet') || null
    rows.push({ objectId: id, name: o?.name || 'Objekt (gelöscht)', customer: o?.customer || '', region: o?.region || '', revenue: rev, distributed: r2(spread.byObject.get(id) || 0), plannedHours: r2(h.planned / 60), usedHours: r2(h.used / 60), stampedShare: h.pairs ? h.stampedPairs / h.pairs : null, labor, material: m, external: e, cost, margin, rate, level, needed, raise, prevRate: prevRates.has(id) ? prevRates.get(id) : null, contractId: contract?.id || '' })
  }
  const ORDER = { kritisch: 0, ohne: 1, knapp: 2, gut: 3 }
  rows.sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.margin - b.margin || a.name.localeCompare(b.name, 'de'))
  const sum = (f) => r2(rows.reduce((t, r) => t + r[f], 0))
  const tot = { revenue: sum('revenue'), labor: sum('labor'), material: sum('material'), external: sum('external'), cost: sum('cost'), margin: sum('margin') }
  tot.rate = tot.revenue > 0.004 ? tot.margin / tot.revenue : null
  tot.below = rows.filter((r) => r.level === 'kritisch' || r.level === 'knapp' || r.level === 'ohne').length
  tot.distributed = sum('distributed')
  return { rows, totals: tot, unassigned: spread.rest, settings: s }
}

/** Deckungsbeitrag in % je Objekt (für den Vergleich mit der Vorperiode). */
export const ratesOf = (result) => new Map(result.rows.filter((r) => r.rate !== null).map((r) => [r.objectId, r.rate]))

/** Tage des Zeitraums (für die Anzeige). */
export const spanDays = (from, to) => dayIndex(to) - dayIndex(from) + 1
