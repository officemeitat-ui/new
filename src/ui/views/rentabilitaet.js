// Rentabilität je Objekt (Finanzen, Kürzel rnt-): Umsatz gegen Personal (gestempelt, sonst Plan), Material und
// Fremdleistungen je Objekt, Deckungsbeitrag mit Ampel gegen das Ziel, Vergleich mit dem Zeitraum davor und der Umsatz,
// der für das Ziel nötig wäre (mit Weg zum Vertrag des Objekts). Nur, wer Fakturierung und Auswertung sieht (Lohnkosten).
// Rechenkern: core/rentabilitaet.js.

import { CALC_DEFAULTS, calcWage } from '../../core/calculation.js'
import { formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import { hoursByObject, RENT_LEVELS, rentability, ratesOf, rentSettings, rentSpan } from '../../core/rentabilitaet.js'
import { mergeRules } from '../../core/rules.js'
import { app, canEdit, computeRange, persist, registerActions, registerView, renderNow, stampMemo, toast } from '../context.js'
import { download, esc, euro, ICON, menu, val } from '../shared.js'
import { rentAvailable } from './lazy.js'

const VIEW = 'rentabilitaet'
const sees = (m) => !app.access || app.access.sees(m)
const SPANS = [['3', '3 Monate'], ['6', '6 Monate'], ['12', '12 Monate'], ['vorjahr', 'Vorjahr']]
const LEVEL_PILL = { gut: 'ok', knapp: 'warning', kritisch: 'error', ohne: 'error' }
const LEVEL_MARK = { gut: '●', knapp: '▲', kritisch: '■', ohne: '■' }
const pct = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toLocaleString('de-AT', { maximumFractionDigits: 0 })} %`)
const hours = (h) => `${h.toLocaleString('de-AT', { maximumFractionDigits: 1 })} h`

const span = () => rentSpan(app.ui.rntSpan || '6', todayISO())
const settings = () => rentSettings(app.data.fakturierung?.settings?.rent || {})

/** Lohnkosten je Stunde wie in den Kennzahlen (Kalkulation: KV-Lohn plus Lohnnebenkosten). */
function costPerHour() {
  const s = app.data.kalkulation?.settings || {}
  return calcWage(s, mergeRules(app.data.rules).wages) * (1 + (Number(s.lnkPct ?? CALC_DEFAULTS.lnkPct) || 0) / 100)
}

function result(c, sp) {
  const set = settings()
  const key = `rnt:${sp.from}:${sp.to}:${set.target}:${set.warn}`
  return stampMemo(key, () => {
    const r = computeRange(sp.prev.from, sp.to)
    const base = { objects: app.data.objects || [], fak: app.data.fakturierung || null, material: sees('material') ? app.data.material || null : null, einkauf: sees('einkauf') ? app.data.einkauf || null : null, costPerHour: costPerHour(), settings: set, contracts: app.data.fakturierung?.contracts || [] }
    const prev = rentability({ ...base, hours: hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from: sp.prev.from, to: sp.prev.to }), from: sp.prev.from, to: sp.prev.to })
    return { ...rentability({ ...base, hours: hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from: sp.from, to: sp.to }), from: sp.from, to: sp.to, prevRates: ratesOf(prev) }), costPerHour: base.costPerHour }
  })
}

function rentView(c) {
  if (!rentAvailable()) return '<p class="empty">Die Rentabilität sehen nur Personen mit Fakturierung und Auswertung.</p>'
  const sp = span()
  const res = result(c, sp)
  const set = res.settings
  const filter = app.ui.rntFilter || 'alle'
  const rows = res.rows.filter((r) => filter === 'alle' || r.level !== 'gut')
  const t = res.totals
  const tile = (label, value, cls = '', sub = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
  const trend = (r) => {
    if (r.rate === null || r.prevRate === null) return ''
    const d = Math.round((r.rate - r.prevRate) * 100)
    return d === 0 ? '<span class="muted">gleich</span>' : `<span class="${d > 0 ? 'ok-text' : 'warn-text'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} Pkt.</span>`
  }
  const body = rows
    .map(
      (r) => `<tr>
      <td><strong>${esc(r.name)}</strong>${r.customer ? `<br><span class="muted">${esc(r.customer)}</span>` : ''}</td>
      <td class="num">${euro(r.revenue)}${r.distributed ? `<br><span class="muted">davon verteilt ${euro(r.distributed)}</span>` : ''}</td>
      <td class="num">${hours(r.usedHours)}${r.stampedShare !== null ? `<br><span class="muted">${pct(r.stampedShare)} gestempelt</span>` : ''}</td>
      <td class="num">${euro(r.labor)}</td>
      <td class="num">${euro(r.material + r.external)}${r.external ? `<br><span class="muted">davon fremd ${euro(r.external)}</span>` : ''}</td>
      <td class="num"><strong>${euro(r.margin)}</strong></td>
      <td class="num">${pct(r.rate)}<br>${trend(r)}</td>
      <td><span class="pill ${LEVEL_PILL[r.level]}"><span aria-hidden="true">${LEVEL_MARK[r.level]}</span> ${esc(RENT_LEVELS[r.level])}</span></td>
      <td>${r.raise !== null ? `+${pct(r.raise)} Umsatz<br><span class="muted">${euro(r.needed)} statt ${euro(r.revenue)}</span>` : r.level === 'ohne' ? '<span class="muted">Umsatz fehlt oder ohne Objekt verrechnet</span>' : ''}${r.contractId ? `<br><button class="btn small" data-action="fvt-open" data-id="${esc(r.contractId)}">Vertrag</button>` : ''}</td>
    </tr>`,
    )
    .join('')
  const exportMenu = menu({ label: 'Export', icon: ICON.download, single: false, items: [{ label: 'CSV', action: 'rnt-csv', hint: 'alle Objekte, Strichpunkt', mail: { subject: `Rentabilität je Objekt ${sp.label}` } }] })
  const edit = canEdit('fakturierung') && !app.readOnly
  return `<div class="section-head"><div><h2>Rentabilität je Objekt</h2>
      <p>Umsatz gegen Personal, Material und Fremdleistungen je Objekt: Deckungsbeitrag mit Ampel gegen das Ziel von ${set.target} % (kritisch unter ${set.warn} %), Vergleich mit dem Zeitraum davor und der Umsatz, der für das Ziel nötig wäre.</p></div>
      <div class="actions">${exportMenu}</div></div>
    <div class="filters" role="group" aria-label="Zeitraum">${SPANS.map(([id, label]) => `<button class="filter" data-action="rnt-span" data-v="${id}" aria-pressed="${sp.kind === id}">${label}</button>`).join('')}
      <span class="sep"></span>${[['alle', 'Alle'], ['bedarf', 'Handlungsbedarf']].map(([id, label]) => `<button class="filter" data-action="rnt-filter" data-v="${id}" aria-pressed="${filter === id}">${label}</button>`).join('')}</div>
    <p class="muted">${esc(sp.label)}: ${esc(formatDate(sp.from, { year: true }))} – ${esc(formatDate(sp.to, { year: true }))} · Lohnkosten ${euro(res.costPerHour)} je Stunde laut Kalkulation</p>
    <div class="impact-stats tc-stats">${tile('Umsatz mit Objekt', euro(t.revenue))}${tile('Deckungsbeitrag', euro(t.margin), t.rate !== null && t.rate * 100 < set.warn ? 'err' : t.rate !== null && t.rate * 100 < set.target ? 'warn' : '', pct(t.rate))}${tile('Objekte mit Handlungsbedarf', String(t.below), t.below ? 'warn' : '')}${tile('Umsatz ohne Objekt', euro(res.unassigned), res.unassigned ? 'warn' : '', res.unassigned ? 'keinem Objekt zuordenbar' : t.distributed ? `${euro(t.distributed)} nach Stunden verteilt` : '')}</div>
    ${t.distributed > 0.004 ? `<p class="note">${euro(t.distributed)} aus Rechnungen ohne Objekt (z. B. eine Sammelrechnung je Kunde) sind auf die Objekte des Kunden verteilt, nach den Stunden im Zeitraum. Genauer wird es, wenn beim Verrechnen das Objekt angegeben ist.</p>` : ''}
    ${res.unassigned > 0.004 ? '<p class="note">Rechnungen ohne Objekt, deren Kunde kein Objekt hat (Kunde → Objekte), fehlen bei den Objekten.</p>' : ''}
    ${rows.length ? `<div class="table-wrap"><table class="data rnt-table"><thead><tr><th>Objekt</th><th class="num">Umsatz</th><th class="num">Stunden</th><th class="num">Personal</th><th class="num">Material, fremd</th><th class="num">Deckungsbeitrag</th><th class="num">in %</th><th>Ampel</th><th>Für das Ziel</th></tr></thead><tbody>${body}</tbody></table></div>` : `<p class="empty">${filter === 'alle' ? 'Keine Objekte mit Umsatz oder Kosten im Zeitraum.' : 'Kein Objekt mit Handlungsbedarf.'}</p>`}
    <details class="rnt-method"><summary>So wird gerechnet</summary><ul>
      <li>Umsatz: festgeschriebene Rechnungen, Storno und Korrekturen mit Objekt (netto, Rechnungsdatum im Zeitraum). Rechnungen ohne Objekt werden auf die Objekte des Kunden verteilt, nach den Stunden im Zeitraum (ohne Stunden zu gleichen Teilen).</li>
      <li>Personal: Stunden × Lohnkosten je Stunde (Kalkulation: KV-Lohn plus Lohnnebenkosten). Je eingeteilter Person und Einsatz zählt die gestempelte Zeit, sonst die geplante; Stempelungen im Objekt ohne Einsatz kommen dazu. Fahrzeiten zählen nicht.</li>
      <li>Material: Ausgaben aus dem Lager an das Objekt. Fremd: Eingangsrechnungen mit dem Objekt als Kostenstelle.</li>
      <li>Für das Ziel: Umsatz, bei dem die Kosten den Deckungsbeitrag des Ziels übrig lassen (Kosten ÷ (1 − Ziel)). Eine Preisanpassung läuft über den Vertrag des Objekts (Fakturierung → Verträge).</li>
    </ul>
    ${edit ? `<div class="form-grid rnt-settings"><label class="field"><span>Ziel-Deckungsbeitrag (%)</span><input type="number" id="rnt-target" min="0" max="80" value="${set.target}"></label><label class="field"><span>Kritisch unter (%)</span><input type="number" id="rnt-warn" min="0" max="80" value="${set.warn}"></label><div class="actions"><button class="btn small" data-action="rnt-settings">Speichern</button></div></div>` : ''}</details>`
}

registerView({
  id: 'rentabilitaet',
  order: 61,
  label: 'Rentabilität',
  group: 'auswertung',
  section: 'finanzen',
  module: '*',
  noWeek: true,
  available: rentAvailable,
  icon: '<path d="M4 19.5h16"/><path d="M6.5 16V11M11 16V7.5M15.5 16v-5.5M20 16V5"/>',
  text: 'Deckungsbeitrag je Objekt mit Ampel und Preis für das Ziel',
  range: () => {
    const sp = span()
    return { from: sp.prev.from, to: sp.to }
  },
  render: rentView,
})

registerActions({
  'rnt-span': (el) => {
    app.ui.rntSpan = el.dataset.v
    renderNow()
  },
  'rnt-filter': (el) => {
    app.ui.rntFilter = el.dataset.v
    renderNow()
  },
  'rnt-settings': () => {
    if (!canEdit('fakturierung') || app.readOnly) return toast('Ändern nur mit Recht auf die Fakturierung.')
    const s = rentSettings({ target: Number(val('rnt-target')), warn: Number(val('rnt-warn')) })
    const fak = app.data.fakturierung
    if (!fak) return
    fak.settings = { ...(fak.settings || {}), rent: s }
    persist()
    toast(`Gespeichert: Ziel ${s.target} %, kritisch unter ${s.warn} %.`)
    renderNow()
  },
  'rnt-csv': () => {
    const sp = span()
    const res = result(app.cur, sp)
    const num = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','))
    const cols = [
      ['Objekt', (r) => r.name],
      ['Kunde', (r) => r.customer],
      ['Umsatz netto', (r) => num(r.revenue)],
      ['davon verteilt', (r) => num(r.distributed)],
      ['Stunden geplant', (r) => num(r.plannedHours)],
      ['Stunden gerechnet', (r) => num(r.usedHours)],
      ['Anteil gestempelt (%)', (r) => (r.stampedShare === null ? '' : num(r.stampedShare * 100))],
      ['Personal', (r) => num(r.labor)],
      ['Material', (r) => num(r.material)],
      ['Fremdleistungen', (r) => num(r.external)],
      ['Deckungsbeitrag', (r) => num(r.margin)],
      ['Deckungsbeitrag (%)', (r) => (r.rate === null ? '' : num(r.rate * 100))],
      ['Vorperiode (%)', (r) => (r.prevRate === null ? '' : num(r.prevRate * 100))],
      ['Ampel', (r) => RENT_LEVELS[r.level]],
      ['Umsatz für das Ziel', (r) => num(r.needed)],
    ]
    download(`Rentabilitaet_${sp.from}_${sp.to}.csv`, new Blob([`﻿${toCSV(res.rows, cols)}\r\n`], { type: 'text/csv;charset=utf-8' }))
  },
})
