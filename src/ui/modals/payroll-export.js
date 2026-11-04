// Export für das Lohnprogramm (BMD, RZL u. a.): Lohnart je Kennzahl zuordnen, Dateiformat wählen,
// Vorschau und Hinweise (fehlende Personalnummern, Werte ohne Lohnart), Datei herunterladen.
// Die Einstellungen liegen im Zeitkonto (lohn/zeitkonto.json), damit die Lohnverrechnung sie pflegt.

import { MONTH_LONG } from '../../core/dates.js'
import { COLUMNS, EXPORT_DEFAULTS, exportFileName, exportLines, exportProblems, exportText, keyTotals, WAGE_KEYS } from '../../core/payroll-export.js'
import { monthReport } from '../../core/reports.js'
import { app, canEdit, openModal, persist, registerActions, registerModal, renderModal, toast } from '../context.js'
import { checked, download, esc, ICON, modalFrame, options, val } from '../shared.js'
import { payroll } from '../views/overtime.js'

const settings = () => ({ ...EXPORT_DEFAULTS, ...(app.data.payrollExport || {}), wageTypes: { ...(app.data.payrollExport?.wageTypes || {}) } })

function data(month) {
  const p = payroll(month)
  const report = monthReport(p.range.ctx, month, p.range.instances, p.range.state)
  return { otRows: p.rows, report, missing: p.missing }
}

function readForm(m) {
  const s = m.draft || settings()
  if (!document.getElementById('pe-sep')) return s
  for (const [key] of WAGE_KEYS) s.wageTypes[key] = val(`pe-wt-${key.replace('.', '-')}`).trim()
  Object.assign(s, { sep: val('pe-sep'), decimal: val('pe-decimal'), dateFormat: val('pe-date'), header: checked('pe-header'), rateOn: checked('pe-rate') })
  const cols = val('pe-columns').split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter((c) => COLUMNS[c])
  if (cols.length) s.columns = cols
  m.draft = s
  return s
}

function exportModal(c, m) {
  const s = m.draft || settings()
  const month = m.month
  const { otRows, report, missing } = data(month)
  const lines = exportLines({ month, otRows, report, settings: s })
  const totals = keyTotals({ otRows, report })
  const problems = exportProblems({ lines, totals, settings: s })
  const ed = canEdit('auswertung') && !app.readOnly
  const closed = !!app.data.payroll?.[month]?.closedAt
  const [y, mo] = month.split('-')
  const rows = WAGE_KEYS.map(([key, label, unit]) => `<tr><td>${esc(label)}</td><td class="num">${totals[key] ? `${String(totals[key]).replace('.', ',')} ${unit}` : '<span class="muted">–</span>'}</td><td><input type="text" id="pe-wt-${key.replace('.', '-')}" value="${esc(s.wageTypes[key] || '')}" placeholder="Lohnart" style="width:7rem" ${ed ? '' : 'disabled'}></td></tr>`).join('')
  const preview = exportText(lines.slice(0, 12), s).replace(/^﻿/, '')
  return modalFrame({
    title: `Export Lohnprogramm ${MONTH_LONG[Number(mo) - 1]} ${y}`,
    subtitle: 'Bewegungsdaten je Person und Lohnart, z. B. für BMD oder RZL',
    wide: true,
    body: `${!closed ? '<div class="banner warn-banner"><p>Der Monat ist noch nicht abgeschlossen: Mehrarbeit und Überstunden können sich noch ändern. Am besten erst nach „Monat abschließen“ exportieren.</p></div>' : ''}
      ${missing.length ? `<div class="banner warn-banner"><p>${missing.length} ${missing.length === 1 ? 'Woche ist' : 'Wochen sind'} noch nicht geladen bzw. eingeteilt; deren Stunden fehlen.</p></div>` : ''}
      ${problems.length ? `<div class="banner warn-banner"><p>${problems.map(esc).join('<br>')}</p></div>` : ''}
      <h3>Lohnarten</h3>
      <p class="note">Je Kennzahl die Lohnart-Nummer aus eurem Lohnprogramm eintragen (fragt eure Lohnverrechnung). Leer = nicht exportieren. Überstunden kommen nur bei „auszahlen“ in die Datei; bei Zeitausgleich bleiben sie im Zeitkonto.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Kennzahl</th><th class="num">Summe im Monat</th><th>Lohnart</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3>Dateiformat</h3>
      <p class="note">Im Lohnprogramm einmal ein Importformat mit genau diesen Spalten anlegen (BMD: Bewegungsdaten-Import; RZL: Import der variablen Bezüge) oder die Spalten hier an eine vorhandene Vorlage anpassen.</p>
      <div class="form-grid">
        <label class="field wide"><span>Spalten in dieser Reihenfolge (${Object.keys(COLUMNS).join(', ')})</span><input type="text" id="pe-columns" value="${esc(s.columns.join(', '))}" ${ed ? '' : 'disabled'}></label>
        <label class="field"><span>Trennzeichen</span><select id="pe-sep" ${ed ? '' : 'disabled'}>${options([[';', 'Strichpunkt ;'], [',', 'Komma ,'], ['tab', 'Tabulator']], s.sep)}</select></label>
        <label class="field"><span>Dezimalzeichen</span><select id="pe-decimal" ${ed ? '' : 'disabled'}>${options([[',', 'Komma (1,50)'], ['.', 'Punkt (1.50)']], s.decimal)}</select></label>
        <label class="field"><span>Datum</span><select id="pe-date" ${ed ? '' : 'disabled'}>${options([['dd.mm.yyyy', 'TT.MM.JJJJ'], ['yyyy-mm-dd', 'JJJJ-MM-TT'], ['mm/yyyy', 'MM/JJJJ']], s.dateFormat)}</select></label>
        <label class="check"><input type="checkbox" id="pe-header" ${s.header ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>Kopfzeile mit Spaltennamen</span></label>
        <label class="check"><input type="checkbox" id="pe-rate" ${s.rateOn ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>Stundenlohn als Satz mitgeben</span></label>
      </div>
      <h3>Vorschau (${lines.length} ${lines.length === 1 ? 'Zeile' : 'Zeilen'})</h3>
      <pre class="pe-preview">${lines.length ? esc(preview) : '(keine Zeilen: Lohnarten eintragen)'}${lines.length > 12 ? '\n…' : ''}</pre>`,
    foot: `${ed ? '<button class="btn" data-action="pe-refresh">Vorschau aktualisieren</button>' : '<span></span>'}
      <div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? '<button class="btn" data-action="pe-save">Einstellungen speichern</button>' : ''}<button class="btn" data-action="mail-export" data-of="pe-download" title="Als Anhang per E-Mail senden">${ICON.send} Per E-Mail</button><button class="btn primary" data-action="pe-download">Datei herunterladen</button></div>`,
  })
}

registerModal('payroll-export', exportModal, { module: 'auswertung' })

function save(m) {
  const s = readForm(m)
  app.data.payrollExport = { wageTypes: Object.fromEntries(Object.entries(s.wageTypes).filter(([, v]) => v)), columns: s.columns, header: s.header, sep: s.sep, decimal: s.decimal, dateFormat: s.dateFormat, rateOn: s.rateOn }
  persist()
}

registerActions({
  'pe-open': (el) => openModal({ type: 'payroll-export', month: el.dataset.month }),
  'pe-refresh': () => {
    readForm(app.ui.modal)
    renderModal()
  },
  'pe-download': () => {
    const m = app.ui.modal
    const s = canEdit('auswertung') && !app.readOnly ? readForm(m) : m.draft || settings()
    if (canEdit('auswertung') && !app.readOnly) save(m)
    const { otRows, report } = data(m.month)
    const lines = exportLines({ month: m.month, otRows, report, settings: s })
    if (!lines.length) return toast('Keine Zeilen: zuerst die Lohnarten eintragen.')
    download(exportFileName(m.month), new Blob([exportText(lines, s)], { type: 'text/csv;charset=utf-8' }))
    toast(`${lines.length} Zeilen für ${new Set(lines.map((l) => l.empId)).size} Personen exportiert.`)
  },
})

registerActions(
  {
    'pe-save': () => {
      save(app.ui.modal)
      renderModal()
      toast('Lohnarten und Format gespeichert.')
    },
  },
  { edit: 'auswertung' },
)
