// Umsatzsteuer-Übersicht für die UVA (eigene Ansicht unter Finanzen): Monat oder Quartal, Soll- oder Istbesteuerung,
// Umsatzsteuer je Steuersatz aus der Fakturierung, Vorsteuer aus Einkauf & Kasse, Reverse Charge in beide Richtungen,
// Zahllast bzw. Gutschrift, Kennzahlen des U30 als Hinweis, PDF und CSV für die Steuerberatung. Rechenkern:
// core/vat-return.js, PDF: export/uva-pdf.js.
//
// Rechte: sichtbar für Rollen mit Fakturierung oder Einkauf & Kasse. Jede Rolle sieht nur, was sie lesen darf:
// ohne Einkauf & Kasse nur die Umsatzsteuer der Rechnungen (mit Hinweis), ohne Fakturierung nur Vorsteuer und Kasse.
// Die Ansicht ändert nichts; Soll oder Ist steht in den Einstellungen der Fakturierung und lässt sich hier umschalten.

import { addDays, firstOfMonth, formatDate, todayISO } from '../../core/dates.js'
import { round2 } from '../../core/invoicing.js'
import { periodRange, VAT_BASIS, vatBasisOf, vatReturn, vatReturnAssumptions, vatReturnCsv, vatReturnFileName, vatReturnLines } from '../../core/vat-return.js'
import { vatReturnDocument } from '../../export/uva-pdf.js'
import { app, registerActions, registerView, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { download, esc, euro, ICON, menu, options, val } from '../shared.js'
import { uvaAvailable } from './lazy.js'

const ICON_UVA = '<path d="M5 3.5h14v17H5z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h3"/><path d="m14 17.5 4-4"/><circle cx="14.3" cy="13.8" r=".6"/><circle cx="17.7" cy="17.2" r=".6"/>'
const sees = (m) => !app.access || app.access.sees(m)
const money = (n) => euro(round2(n))
const AREA = { ust: 'Umsatzsteuer', vst: 'Vorsteuer', kasse: 'Kassenbuch' }
const LEVEL_CLASS = { head: 'uva-head', sub: 'uva-sub', sum: 'uva-sum', result: 'uva-result' }

/** Vormonat (die UVA gilt meist für den abgelaufenen Monat bzw. das abgelaufene Quartal). */
const lastMonth = () => addDays(firstOfMonth(todayISO()), -1).slice(0, 7)
const quarterOf = (ym) => `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`

/** Zeitraum aus der Auswahl (Standard: Vormonat bzw. dessen Quartal). */
function period() {
  const mode = app.ui.uvaMode === 'quartal' ? 'quartal' : 'monat'
  const month = /^\d{4}-\d{2}$/.test(app.ui.uvaMonth || '') ? app.ui.uvaMonth : lastMonth()
  const quarter = /^\d{4}-Q[1-4]$/.test(app.ui.uvaQuarter || '') ? app.ui.uvaQuarter : quarterOf(lastMonth())
  return periodRange(mode, mode === 'quartal' ? quarter : month)
}

/** Daten, soweit die Rolle sie lesen darf (null: nicht lesbar). */
function sources() {
  const fak = sees('fakturierung') ? app.data.fakturierung || { documents: [], settings: {} } : null
  const ek = sees('einkauf')
  return {
    docs: fak ? fak.documents || [] : null,
    settings: fak?.settings || {},
    purchase: ek ? app.data.einkauf || { invoices: [], suppliers: [] } : null,
    cash: ek ? app.data.kasse || { entries: [], closings: [] } : null,
  }
}

const basis = (settings) => (app.ui.uvaBasis === 'soll' || app.ui.uvaBasis === 'ist' ? app.ui.uvaBasis : vatBasisOf(settings))

/** Ergebnis für die aktuelle Auswahl: { r, p, settings }. */
function current() {
  const src = sources()
  const p = period()
  const r = vatReturn({ ...src, from: p.from, to: p.to, basis: basis(src.settings) })
  return { r, p, settings: src.settings }
}

function quarterOptions() {
  const last = quarterOf(lastMonth())
  const list = []
  let [y, q] = [Number(last.slice(0, 4)), Number(last.slice(6))]
  // laufendes Quartal (vorläufig) und die acht davor
  if (quarterOf(todayISO().slice(0, 7)) !== last) list.push(quarterOf(todayISO().slice(0, 7)))
  for (let i = 0; i < 8; i++) {
    list.push(`${y}-Q${q}`)
    q -= 1
    if (!q) [y, q] = [y - 1, 4]
  }
  return list.map((v) => [v, periodRange('quartal', v).label])
}

function uvaView() {
  const { r, p, settings } = current()
  const lines = vatReturnLines(r)
  const mode = p.mode
  const t = r.totals
  const fmt = (n) => (n === null || n === undefined ? '' : money(n))
  const table = lines
    .map((l) =>
      l.level === 'head'
        ? `<tr class="${LEVEL_CLASS.head}"><th colspan="4" scope="colgroup">${esc(l.label)}</th></tr>`
        : `<tr class="${LEVEL_CLASS[l.level] || ''}" data-key="${esc(l.key)}"><td class="uva-kz">${l.kz ? `<span class="pill" title="Kennzahl im Formular U30">KZ ${esc(l.kz)}</span>` : ''}</td><td>${esc(l.label)}</td><td class="num">${fmt(l.net)}</td><td class="num">${l.level === 'sum' || l.level === 'result' ? `<strong>${fmt(l.vat)}</strong>` : fmt(l.vat)}</td></tr>`,
    )
    .join('')
  const tile = (label, value, cls = '', sub = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
  const rows = r.rows
    .map((x) => `<tr><td>${x.date ? formatDate(x.date, { year: true }) : ''}</td><td>${esc(AREA[x.area])}</td><td>${esc(x.ref || '')}</td><td>${esc(x.partner || '')}</td><td>${esc(x.kind || '')}</td><td class="num">${x.rate || x.rate === 0 ? `${String(x.rate).replace('.', ',')} %` : ''}</td><td class="num">${money(x.net)}</td><td class="num">${money(x.vat)}</td><td>${esc(x.kz || '')}</td></tr>`)
    .join('')
  const exportMenu = menu({
    label: 'Export',
    icon: ICON.download,
    single: false,
    items: [
      { label: 'PDF', action: 'uva-pdf', hint: 'Übersicht und Belege', mail: { subject: `Umsatzsteuer ${p.label}` } },
      { label: 'CSV', action: 'uva-csv', hint: 'Strichpunkt, Dezimalkomma', mail: { subject: `Umsatzsteuer ${p.label}` } },
    ],
  })
  return `<div class="section-head"><div><h2>Umsatzsteuer</h2>
      <p>Übersicht für die Umsatzsteuervoranmeldung (UVA): Umsatzsteuer je Steuersatz, Vorsteuer, Reverse Charge und Kassenbuch, Zahllast oder Gutschrift. Bitte mit der Steuerberatung abstimmen.</p></div>
      <div class="actions">${exportMenu}</div></div>
    <div class="filters uva-filters">
      <label class="field inline"><span>Zeitraum</span><select id="uva-mode" data-change="uva-mode">${options([['monat', 'Monat'], ['quartal', 'Quartal']], mode)}</select></label>
      ${mode === 'quartal' ? `<label class="field inline"><span>Quartal</span><select id="uva-quarter" data-change="uva-quarter">${options(quarterOptions(), p.value)}</select></label>` : `<label class="field inline"><span>Monat</span><input type="month" id="uva-month" value="${esc(p.value)}" max="${todayISO().slice(0, 7)}" data-change="uva-month"></label>`}
      <label class="field inline"><span>Versteuerung</span><select id="uva-basis" data-change="uva-basis">${options([['soll', 'Soll (nach Rechnungsdatum)'], ['ist', 'Ist (nach Zahlungseingang)']], r.basis)}</select></label>
    </div>
    <p class="muted">${esc(p.label)}: ${esc(formatDate(p.from, { year: true }))} – ${esc(formatDate(p.to, { year: true }))} · ${esc(VAT_BASIS[r.basis])}${r.basis !== vatBasisOf(settings) ? ' (abweichend von den Einstellungen der Fakturierung)' : ''}</p>
    ${r.notes.length ? `<div class="banner warn-banner uva-notes"><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <div class="impact-stats tc-stats">${tile('Umsatzsteuer', money(t.tax), '', r.has.sales ? '' : 'ohne Rechnungen')}${tile('Vorsteuer', money(t.inputTotal), '', r.has.purchase ? '' : 'nicht lesbar')}${tile(t.payable >= 0 ? 'Zahllast' : 'Gutschrift', money(Math.abs(t.payable)), t.complete ? '' : 'warn', t.complete ? (t.payable >= 0 ? 'an das Finanzamt' : 'vom Finanzamt') : 'unvollständig')}</div>
    <div class="table-wrap"><table class="data uva-table"><thead><tr><th>KZ</th><th>Bezeichnung</th><th class="num">Bemessungsgrundlage</th><th class="num">Steuer</th></tr></thead><tbody>${table}</tbody></table></div>
    <details class="uva-rows"><summary>Belege im Zeitraum (${r.rows.length})</summary>${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Bereich</th><th>Beleg</th><th>Partner</th><th>Art</th><th class="num">Satz</th><th class="num">Netto</th><th class="num">Steuer</th><th>KZ</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Belege im Zeitraum.</p>'}</details>
    <h3>Annahmen</h3><ul class="uva-assume">${vatReturnAssumptions(r.basis).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    <p class="note">Die Kennzahlen (KZ) entsprechen dem Formular U30, soweit sie sicher sind; Felder wie steuerfreie Umsätze, innergemeinschaftliche Erwerbe oder Berichtigungen ergänzt die Steuerberatung. Sollbesteuerung ist der Normalfall; Istbesteuerung nur, wenn das Finanzamt sie erlaubt bzw. die Umsatzgrenze passt. Einstellung: Fakturierung → Einstellungen → „Umsatzsteuer (für die UVA)“.</p>`
}

registerView({
  id: 'umsatzsteuer',
  order: 67,
  label: 'Umsatzsteuer',
  group: 'auswertung',
  section: 'finanzen',
  module: '*',
  available: uvaAvailable,
  icon: ICON_UVA,
  noWeek: true,
  text: 'Umsatzsteuer und Vorsteuer je Monat oder Quartal für die UVA',
  render: uvaView,
})

registerActions({
  'uva-mode': () => {
    const before = period()
    app.ui.uvaMode = val('uva-mode') === 'quartal' ? 'quartal' : 'monat'
    // Quartal des gewählten Monats bzw. erster Monat des Quartals
    if (app.ui.uvaMode === 'quartal') app.ui.uvaQuarter = quarterOf(before.from.slice(0, 7))
    else app.ui.uvaMonth = before.from.slice(0, 7)
    renderNow()
  },
  'uva-month': () => {
    const v = val('uva-month')
    if (/^\d{4}-\d{2}$/.test(v)) app.ui.uvaMonth = v
    renderNow()
  },
  'uva-quarter': () => {
    app.ui.uvaQuarter = val('uva-quarter')
    renderNow()
  },
  'uva-basis': () => {
    app.ui.uvaBasis = val('uva-basis') === 'ist' ? 'ist' : 'soll'
    renderNow()
  },
  'uva-pdf': async (el) => {
    const { r, p, settings } = current()
    if (el) el.disabled = true
    try {
      const doc = vatReturnDocument({ r, label: p.label, company: settings.sender?.name || '', brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
      download(vatReturnFileName(r, 'pdf'), await pdfBlob(doc))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    } finally {
      if (el) el.disabled = false
    }
  },
  'uva-csv': () => {
    const { r, p } = current()
    download(vatReturnFileName(r, 'csv'), new Blob([`﻿${vatReturnCsv(r, { label: p.label })}`], { type: 'text/csv;charset=utf-8' }))
    toast(`Umsatzsteuer ${p.label} als CSV heruntergeladen.`)
  },
})
