// Reiter „Kosten“ in Fahrzeuge & Reifen (views/vehicles.js): Fuhrparkkosten je Fahrzeug und Jahr aus erledigten
// Werkstattterminen und Eingangsrechnungen mit Fahrzeug (Einkauf & Kasse), km aus dem Fahrtenbuch bzw. den
// km-Ständen, Kosten je km; Rechnungen der Kategorie „Fahrzeuge“ ohne Fahrzeug zum Zuordnen; CSV.
// Rechenkern core/fuhrparkkosten.js.

import { formatDate, todayISO } from '../../core/dates.js'
import { unassignedVehicleInvoices, vehicleCosts, vehicleCostsCsv } from '../../core/fuhrparkkosten.js'
import { app, memo, registerActions, renderNow, toast } from '../context.js'
import { download, esc, ICON, menu } from '../shared.js'

const sees = (m) => !app.access || app.access.sees(m)
const eur = (n) => `€ ${(Number(n) || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const perKm = (n) => (n === null || n === undefined ? '–' : `€ ${n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`)
export const fpkYear = () => (/^\d{4}$/.test(String(app.ui.fpkYear || '')) ? String(app.ui.fpkYear) : todayISO().slice(0, 4))
const yearReady = (y) => !app.service?.yearLoaded || app.service.yearLoaded('fahrtenbuch', y)
let loading = null

function result(y) {
  const from = `${y}-01-01`
  const to = `${y}-12-31`
  const ek = sees('einkauf') ? app.data.einkauf || { invoices: [] } : null
  const key = `fpk:${y}:${(app.data.fahrtenbuch || []).length}`
  return memo(app.cur, key, () => ({
    ...vehicleCosts({ vehicles: app.data.fahrzeuge?.vehicles || [], changes: app.data.fahrzeuge?.changes || [], invoices: ek ? ek.invoices || [] : null, trips: app.data.fahrtenbuch || [], categories: ek?.settings?.categories || [], from, to }),
    unassigned: ek ? unassignedVehicleInvoices(ek.invoices || [], { from, to }) : [],
  }))
}

export function costsView() {
  const y = fpkYear()
  if (!yearReady(y) && app.service?.ensureYears && loading !== y) {
    loading = y
    app.service
      .ensureYears('fahrtenbuch', [y])
      .catch(() => {})
      .finally(() => {
        loading = null
        if (app.ui.view === 'fahrzeuge' && app.ui.vehTab === 'kosten' && !app.ui.modal) renderNow()
      })
  }
  const r = result(y)
  const open = app.ui.fpkOpen || ''
  const rows = r.rows
    .filter((x) => !x.inactive || x.total > 0)
    .map((x) => {
      const detail =
        open === x.vehicleId && x.items.length
          ? `<tr class="fpk-detail"><td colspan="6"><ul class="fpk-items">${x.items.map((i) => `<li><span class="tabular">${formatDate(i.date, { weekday: false })}</span> ${esc(i.kind === 'werkstatt' ? i.text : `${i.no ? `${i.no} · ` : ''}${i.text}`)} <strong class="tabular">${eur(i.net)}</strong></li>`).join('')}</ul></td></tr>`
          : ''
      return `<tr><td><strong>${esc(x.plate)}</strong><br><span class="muted">${esc(x.label)}</span></td>
        <td class="num">${eur(x.workshop)}</td>
        <td class="num">${r.withInvoices ? `${eur(x.invoices)}${x.byCategory.length ? `<br><span class="muted small">${esc(x.byCategory.slice(0, 2).map((c) => c.name.replace(/ \(.*\)$/, '')).join(', '))}</span>` : ''}` : '–'}</td>
        <td class="num"><strong>${eur(x.total)}</strong></td>
        <td class="num">${x.km ? `${x.km.toLocaleString('de-AT')} km<br><span class="muted small">${x.kmSource === 'fahrtenbuch' ? 'Fahrtenbuch' : 'km-Stand'}</span>` : '–'}</td>
        <td class="num">${perKm(x.perKm)}${x.items.length ? `<br><button class="btn small ghost" data-action="fpk-open" data-id="${esc(x.vehicleId)}" aria-expanded="${open === x.vehicleId}">${open === x.vehicleId ? 'Weniger' : `${x.items.length} Posten`}</button>` : ''}</td></tr>${detail}`
    })
    .join('')
  const years = [Number(todayISO().slice(0, 4)) - 2, Number(todayISO().slice(0, 4)) - 1, Number(todayISO().slice(0, 4))].map(String)
  return `<div class="toolbar filters-bar fpk-bar">
      <div class="seg" role="group" aria-label="Jahr">${years.map((yy) => `<button class="btn small ${yy === y ? 'primary' : ''}" data-action="fpk-year" data-v="${yy}" aria-pressed="${yy === y}">${yy}</button>`).join('')}</div>
      ${app.config.features.download ? `<div class="actions">${menu({ label: 'Export', icon: ICON.download, single: false, items: [{ label: `Fuhrparkkosten ${y} (CSV)`, icon: ICON.download, action: 'fpk-csv', mail: true }] })}</div>` : ''}
    </div>
    <div class="summary">
      <div class="stat"><div class="label">Kosten ${esc(y)}</div><div class="value">${eur(r.totals.total)}</div><div class="muted">netto</div></div>
      <div class="stat"><div class="label">Werkstatt</div><div class="value">${eur(r.totals.workshop)}</div><div class="muted">erledigte Termine</div></div>
      <div class="stat"><div class="label">Rechnungen</div><div class="value">${r.withInvoices ? eur(r.totals.invoices) : '–'}</div><div class="muted">${r.withInvoices ? 'mit Fahrzeug' : 'nur mit Einkauf & Kasse'}</div></div>
      <div class="stat"><div class="label">Je km</div><div class="value">${perKm(r.totals.perKm)}</div><div class="muted">${r.totals.km ? `${r.totals.km.toLocaleString('de-AT')} km` : 'ohne km'}</div></div>
    </div>
    ${r.unassigned.length ? `<p class="check warning">${r.unassigned.length} ${r.unassigned.length === 1 ? 'Eingangsrechnung' : 'Eingangsrechnungen'} der Kategorie „Fahrzeuge“ ohne Fahrzeug (${eur(r.unassigned.reduce((s, x) => s + (x.groups || []).reduce((t, g) => t + (Number(g.net) || 0), 0), 0))}). <button class="btn small" data-action="view" data-view="einkauf">In Einkauf & Kasse zuordnen</button></p>` : ''}
    <div class="table-wrap"><table class="data fpk-table"><thead><tr><th>Fahrzeug</th><th class="num">Werkstatt</th><th class="num">Rechnungen</th><th class="num">Summe</th><th class="num">Gefahren</th><th class="num">Je km</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Keine Fahrzeuge.</td></tr>'}</tbody></table></div>
    <p class="note">Beträge netto. Werkstatt: erledigte Termine mit Kosten (Reifenwechsel, Service, Pickerl). Rechnungen: Eingangsrechnungen mit Fahrzeug – das Fahrzeug wählt man bei der Rechnung (bei Tankbelegen mit Kennzeichen schlägt die App es vor). km aus dem Fahrtenbuch, sonst aus den km-Ständen. Ob die Vorsteuer abziehbar ist (Fiskal-Lkw ja, Pkw nein), klärt die Steuerberatung.</p>`
}

registerActions({
  'fpk-year': (el) => {
    app.ui.fpkYear = el.dataset.v
    app.ui.fpkOpen = ''
    renderNow()
  },
  'fpk-open': (el) => {
    app.ui.fpkOpen = app.ui.fpkOpen === el.dataset.id ? '' : el.dataset.id
    renderNow()
  },
  'fpk-csv': () => {
    const y = fpkYear()
    const r = result(y)
    if (!r.rows.length) return toast('Keine Fahrzeuge.')
    download(`Fuhrparkkosten_${y}.csv`, new Blob([vehicleCostsCsv(r)], { type: 'text/csv;charset=utf-8' }))
  },
})
