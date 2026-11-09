// Fuhrparkkosten je Fahrzeug: Werkstatt (erledigte Termine mit Kosten, core/vehicles.js), Eingangsrechnungen mit
// Fahrzeug (Treibstoff, Versicherung, Leasing, Reparatur – Feld vehicleId in Einkauf & Kasse) und gefahrene km aus
// dem Fahrtenbuch (core/fahrtenbuch.js; ohne Fahrtenbuch aus den km-Ständen des Fahrzeugs). Ergibt Kosten je km.
// Rein rechnend, ohne Netz testbar (test/fuhrparkkosten.test.js); Anzeige im Reiter „Kosten“ (ui/views/fuhrparkkosten.js).
// Beträge netto (Vorsteuer abziehbar je nach Fahrzeug – Fiskal-Lkw ja, Pkw nein: mit der Steuerberatung klären).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const net = (inv) => (inv.groups || []).reduce((s, g) => s + (Number(g.net) || 0), 0)
const gross = (inv) => (inv.groups || []).reduce((s, g) => s + (Number(g.net) || 0) + (Number(g.vat) || 0), 0)

/** km im Zeitraum aus den km-Ständen (kmLog [{ date, km }]): Differenz vom letzten Stand bis from zum letzten bis to. */
export function kmFromLog(v, from, to) {
  const log = (v?.kmLog || []).filter((x) => x?.date && Number.isFinite(Number(x.km))).sort((a, b) => a.date.localeCompare(b.date))
  const before = log.filter((x) => x.date < from).at(-1) || log.find((x) => x.date >= from && x.date <= to)
  const last = log.filter((x) => x.date <= to).at(-1)
  return before && last && Number(last.km) > Number(before.km) ? Number(last.km) - Number(before.km) : 0
}

/**
 * Kosten je Fahrzeug von from bis to: [{ vehicleId, plate, label, workshop, invoices, byCategory: [{ category, name,
 * net }], total, km, kmSource: 'fahrtenbuch'|'km-stand'|'', perKm, items: [{ date, kind, text, net }] }] und Summen.
 * invoices: Eingangsrechnungen (null, wenn die Rolle sie nicht sehen darf); categories: [{ id, name }].
 */
export function vehicleCosts({ vehicles = [], changes = [], invoices = null, trips = [], categories = [], from, to } = {}) {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const rows = []
  for (const v of vehicles) {
    if (!v) continue
    const items = []
    for (const c of changes || []) {
      if (c?.vehicleId !== v.id || c.status !== 'erledigt' || !(Number(c.cost) > 0)) continue
      const d = c.doneAt?.slice?.(0, 10) || c.date
      if (!d || d < from || d > to) continue
      items.push({ date: d, kind: 'werkstatt', text: c.kind === 'werkstatt' ? 'Werkstatt' : 'Reifenwechsel', net: r2(c.cost), ref: c.id })
    }
    for (const inv of invoices || []) {
      if (inv?.vehicleId !== v.id || inv.cancelled || !inv.date || inv.date < from || inv.date > to) continue
      items.push({ date: inv.date, kind: 'rechnung', category: inv.category || '', text: [inv.supplier?.name, inv.text].filter(Boolean).join(': ') || inv.no || 'Eingangsrechnung', net: r2(net(inv)), gross: r2(gross(inv)), ref: inv.id, no: inv.no || '' })
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    const live = (trips || []).filter((t) => t && !t.dismissed && !t.cancelled && t.vehicleId === v.id && t.date >= from && t.date <= to)
    const kmTrips = live.reduce((s, t) => s + (Number(t.km) || 0), 0)
    const kmLog = kmTrips ? 0 : kmFromLog(v, from, to)
    const km = Math.round(kmTrips || kmLog)
    const workshop = r2(items.filter((x) => x.kind === 'werkstatt').reduce((s, x) => s + x.net, 0))
    const inv = r2(items.filter((x) => x.kind === 'rechnung').reduce((s, x) => s + x.net, 0))
    const cats = new Map()
    for (const x of items.filter((i) => i.kind === 'rechnung')) cats.set(x.category, r2((cats.get(x.category) || 0) + x.net))
    const total = r2(workshop + inv)
    rows.push({
      vehicleId: v.id,
      plate: v.plate || '',
      label: v.label || '',
      inactive: !!v.inactive,
      workshop,
      invoices: inv,
      byCategory: [...cats].map(([category, n]) => ({ category, name: catName.get(category) || (category ? category : 'ohne Kategorie'), net: n })).sort((a, b) => b.net - a.net),
      total,
      km,
      kmSource: kmTrips ? 'fahrtenbuch' : kmLog ? 'km-stand' : '',
      perKm: km > 0 ? Math.round((total / km) * 1000) / 1000 : null,
      items,
    })
  }
  rows.sort((a, b) => b.total - a.total || a.plate.localeCompare(b.plate, 'de'))
  const sum = (f) => r2(rows.reduce((s, r) => s + r[f], 0))
  const km = rows.reduce((s, r) => s + r.km, 0)
  const total = sum('total')
  return { rows, totals: { workshop: sum('workshop'), invoices: sum('invoices'), total, km, perKm: km > 0 ? Math.round((total / km) * 1000) / 1000 : null }, withInvoices: invoices !== null }
}

/** Eingangsrechnungen der Kategorie „Fahrzeuge“ ohne Fahrzeug im Zeitraum (zum Zuordnen). */
export const unassignedVehicleInvoices = (invoices = [], { from, to, category = 'kfz' } = {}) =>
  (invoices || []).filter((x) => x && !x.cancelled && x.category === category && !x.vehicleId && x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date))

/** Kennzeichen im Text eines Belegs finden (z. B. Tankbeleg „Kennz.: S-284 KL“): Fahrzeug oder null. */
export function vehicleFromText(text, vehicles = []) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!t) return null
  const hits = vehicles.filter((v) => {
    const p = String(v?.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    return p.length >= 4 && t.includes(p)
  })
  return hits.length === 1 ? hits[0] : null
}

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s
}
const dec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','))

/** CSV je Fahrzeug (Semikolon, Dezimalkomma). */
export function vehicleCostsCsv(result) {
  const head = ['Kennzeichen', 'Fahrzeug', 'Werkstatt netto', 'Rechnungen netto', 'Summe netto', 'km', 'km laut', 'Kosten je km']
  const rows = result.rows.map((r) => [r.plate, r.label, dec(r.workshop), dec(r.invoices), dec(r.total), r.km || '', r.kmSource === 'fahrtenbuch' ? 'Fahrtenbuch' : r.kmSource === 'km-stand' ? 'km-Stand' : '', dec(r.perKm)])
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`
}
