// Wochenzettel je Person im Layout des bisherigen Excel-Plans, mit Kopieren
// für Excel, Excel-Download und Druck/PDF.

import { formatDate, formatHours, isoWeekday, WEEKDAY_LONG } from '../../core/dates.js'
import { maxSeverity } from '../../core/rules.js'
import { buildTimesheetWorkbook, weekFileBase, workbookBlob } from '../../export/excel.js'
import { app, registerActions, registerView, renderNow, toast } from '../context.js'
import { loadScript } from '../load-script.js'
import { download, esc, hoursCell, ICON, saldoClass, signed } from '../shared.js'
import { reportRow } from './report.js'
import { filteredEmployees } from './week.js'

export function currentSheetEmployee(c) {
  const emp = c.ctx.employeesById.get(app.ui.employeeId) || filteredEmployees(c)[0] || c.ctx.employees[0]
  if (emp) app.ui.employeeId = emp.id
  return emp
}

export function dayNote(day) {
  const parts = []
  if (day.holiday) parts.push(day.holiday.legal ? `Feiertag: ${day.holiday.name}` : day.holiday.name)
  if (day.absence) parts.push(day.absence.type)
  return parts.join(' · ')
}

/** HTML-Tabelle eines Wochenzettels (auch für den Druck aller Zettel). */
export function sheetTable(c, emp, { interactive = true } = {}) {
  const ts = c.timesheet(emp)
  const rows = ts.days
    .map((day) => {
      const lines = day.lines.length
        ? day.lines
            .map((l) => {
              const issues = l.kind === 'work' ? c.validation.cell.get(`${emp.id}|${l.inst.key}`) || [] : []
              const sev = maxSeverity(issues.filter((i) => i.severity !== 'info'))
              const mark = sev && interactive ? `<span class="flag ${sev} issue-mark" title="${esc(issues.map((i) => i.message).join('\n'))}">!</span>` : ''
              const text = interactive ? `<button class="link-btn" data-action="open-shift" data-key="${esc(l.inst.key)}">${esc(l.text)}</button>` : esc(l.text)
              const travel = interactive && l.kind === 'work' ? `<button class="link-btn trip-cell ${l.trip?.source === 'woche' || l.trip?.source === 'leistung' ? 'planned' : ''}" data-action="open-trip" data-key="${esc(l.inst.key)}" data-emp="${esc(emp.id)}" title="Fahrt planen">${hoursCell(l.travel) || '+'}</button>` : hoursCell(l.travel)
              return `<tr class="line ${l.style}"><td class="time">${esc(l.time)}</td><td class="text">${text}${mark}</td><td class="num">${hoursCell(l.hours)}</td><td class="num">${hoursCell(l.credited)}</td><td class="num">${travel}</td><td class="notes">${esc(l.notes.join(' · '))}</td></tr>`
            })
            .join('')
        : `<tr class="line"><td></td><td class="muted">${day.absence ? esc(day.absence.type) : 'frei'}</td><td></td><td></td><td></td><td></td></tr>`
      return `<tr class="day-row"><th>${WEEKDAY_LONG[isoWeekday(day.date) - 1]}</th><td class="day-note">${esc(dayNote(day))}</td><td></td><td></td><td></td><td class="notes">${day.total ? `Tag gesamt inkl. Fahrzeit: ${formatHours(day.total)} h` : ''}</td></tr>${lines}`
    })
    .join('')
  const t = ts.totals
  const brand = app.config.brand
  return `<table class="sheet">
    <thead><tr><th colspan="2"><div class="sheet-title"><span>${esc(emp.name)}</span><span>Wochenplan von ${formatDate(ts.monday, { weekday: false, year: true })} – ${formatDate(ts.sunday, { weekday: false, year: true })}</span></div></th><th class="col">Std.</th><th class="col">Arbeitszeit</th><th class="col">Fahrzeit</th><th>Hinweis</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>GESAMT</th><td class="saldo-cell">Saldo <span class="saldo ${saldoClass(t.saldo)}">${signed(t.saldo)}</span></td><td class="num">${formatHours(t.soll)}</td><td class="num">${formatHours(t.credited)}</td><td class="num">${formatHours(t.travel)}</td><td class="notes">Soll ${formatHours(t.soll)} h · Ist ${formatHours(t.ist)} h</td></tr></tfoot>
  </table><p class="print-only print-foot">${esc(brand.name)} · ${esc(brand.product)} · erstellt ${new Date().toLocaleDateString('de-AT')}</p>`
}

function sheetView(c) {
  const emp = currentSheetEmployee(c)
  if (!emp) return `<p class="empty">Noch keine Mitarbeitenden angelegt.</p>`
  const list = filteredEmployees(c)
  const idx = list.indexOf(emp)
  const issues = c.validation.issues.filter((i) => i.employeeId === emp.id && i.severity !== 'info')
  const f = app.config.features
  const changed = c.changedSincePublish(emp)
  return `<div class="toolbar">
      <button class="btn icon" data-action="sheet-step" data-delta="-1" aria-label="Vorherige Person" ${idx <= 0 ? 'disabled' : ''}>${ICON.left}</button>
      <select id="ts-employee" aria-label="Mitarbeiter:in">${list.map((e) => `<option value="${esc(e.id)}" ${e.id === emp.id ? 'selected' : ''}>${esc(e.name)}${e.team ? ` (${esc(e.team)})` : ''}</option>`).join('')}</select>
      <button class="btn icon" data-action="sheet-step" data-delta="1" aria-label="Nächste Person" ${idx >= list.length - 1 ? 'disabled' : ''}>${ICON.right}</button>
      <button class="btn" data-action="copy-sheet">${ICON.copy} Für Excel kopieren</button>
      ${f.download ? `<button class="btn" data-action="excel-sheet">${ICON.sheet} Excel</button>` : ''}
      ${f.print ? `<button class="btn" data-action="print-sheet">${ICON.print} Drucken / PDF</button><button class="btn" data-action="print-all">${ICON.print} Alle ${list.length} drucken</button>` : ''}
      ${changed ? '<span class="pill warning">nach Veröffentlichung geändert</span>' : ''}
    </div>
    <div class="sheet-wrap" id="sheet-print">${sheetTable(c, emp)}</div>
    <div class="legend"><span style="text-decoration:line-through">durchgestrichen</span><span>= entfällt / verschoben (Feiertag, Urlaub: angerechnet)</span><span style="color:var(--changed)">rot = Vertretung oder verschoben</span><span style="color:var(--special);font-weight:600">grün = Sonderleistung</span></div>
    ${issues.length ? `<section><h3 style="margin-bottom:8px">Prüfung für ${esc(emp.name)}</h3><div class="report">${issues.map((i) => reportRow(c, i)).join('')}</div></section>` : `<p class="note">Keine Verstöße oder Warnungen für ${esc(emp.name)} in dieser Woche.</p>`}`
}

export function timesheetTSV(c, emp) {
  const ts = c.timesheet(emp)
  const n = (m) => (m ? formatHours(m) : '')
  const clean = (v) => String(v).replace(/[\t\n]/g, ' ')
  const rows = [[emp.name, `Wochenplan von ${formatDate(ts.monday, { weekday: false, year: true })} - ${formatDate(ts.sunday, { weekday: false, year: true })}`, 'Std.', 'Arbeitszeit', 'Fahrzeit', 'Hinweis']]
  for (const day of ts.days) {
    rows.push([WEEKDAY_LONG[isoWeekday(day.date) - 1], dayNote(day), '', '', '', day.total ? `Tag gesamt: ${formatHours(day.total)} h` : ''])
    if (!day.lines.length) rows.push(['', day.absence ? day.absence.type : 'frei', '', '', '', ''])
    for (const l of day.lines) rows.push([l.time, `${l.style === 'struck' ? '[entfällt] ' : ''}${l.text}`, n(l.hours), n(l.credited), n(l.travel), l.notes.join('; ')])
  }
  const t = ts.totals
  rows.push(['GESAMT', `Saldo ${signed(t.saldo)}`, formatHours(t.soll), formatHours(t.credited), formatHours(t.travel), ''])
  return rows.map((r) => r.map(clean).join('\t')).join('\n')
}

export function copyText(text, textarea) {
  const fallback = () => {
    if (textarea) {
      textarea.focus()
      textarea.select()
    }
    toast('Kopieren nicht erlaubt. Der Text ist markiert: mit Strg+C kopieren.')
  }
  try {
    navigator.clipboard.writeText(text).then(() => toast('In die Zwischenablage kopiert. In Excel einfügen mit Strg+V.'), fallback)
  } catch {
    fallback()
  }
}

export async function weekWorkbookBlob(c, employees) {
  await loadScript('vendor/exceljs.min.js')
  const wb = buildTimesheetWorkbook(globalThis.ExcelJS, employees.map((e) => c.timesheet(e)), { brand: `${app.config.brand.name} · ${app.config.brand.product}`, creator: app.user?.name })
  return workbookBlob(wb)
}

function printAll(c, employees) {
  const root = document.getElementById('print-root')
  root.innerHTML = employees.map((e) => `<section class="print-page">${sheetTable(c, e, { interactive: false })}</section>`).join('')
  document.body.classList.add('printing-all')
  const done = () => {
    document.body.classList.remove('printing-all')
    root.innerHTML = ''
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

registerView({ id: 'sheet', order: 20, label: 'Wochenzettel', group: 'plan', summary: true, render: sheetView })

registerActions({
  'open-sheet': (el) => {
    app.ui.employeeId = el.dataset.emp
    app.ui.view = 'sheet'
    app.ui.modal = null
    renderNow()
    window.scrollTo({ top: 0 })
  },
  'sheet-step': (el) => {
    const list = filteredEmployees(app.cur)
    const idx = list.findIndex((e) => e.id === app.ui.employeeId) + Number(el.dataset.delta)
    if (list[idx]) app.ui.employeeId = list[idx].id
    renderNow()
  },
  'copy-sheet': () => {
    const emp = currentSheetEmployee(app.cur)
    if (emp) copyText(timesheetTSV(app.cur, emp))
  },
  'excel-sheet': async () => {
    const emp = currentSheetEmployee(app.cur)
    try {
      download(`Wochenplan_${weekFileBase(app.cur.monday)}_${emp.name.replace(/\s+/g, '_')}.xlsx`, await weekWorkbookBlob(app.cur, [emp]))
    } catch (err) {
      toast(`Excel-Export fehlgeschlagen: ${err.message}`)
    }
  },
  'print-sheet': () => window.print(),
  'print-all': () => printAll(app.cur, filteredEmployees(app.cur)),
})
