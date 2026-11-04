// Prüfbericht: alle Markierungen der Woche, filterbar.

import { formatDate, isoWeek } from '../../core/dates.js'
import { SEVERITY_LABEL } from '../../core/rules.js'
import { app, registerActions, registerView, renderNow } from '../context.js'
import { esc, objectOf } from '../shared.js'

export function reportRow(c, issue) {
  const emp = issue.employeeId ? c.ctx.employeesById.get(issue.employeeId) : null
  const inst = c.state.instByKey.get(issue.keys[0])
  const obj = inst ? objectOf(c, inst) : null
  const weekScope = issue.scope === 'week' || issue.scope === 'month'
  const action = weekScope ? `data-action="open-sheet" data-emp="${esc(emp?.id)}"` : `data-action="open-shift" data-key="${esc(issue.keys[0])}"`
  const where = weekScope ? 'ganze Woche' : `${obj ? `${obj.name}${inst.label ? ` – ${inst.label}` : ''}` : ''}${inst ? ` · ${inst.startTime}–${inst.endTime}` : ''}`
  // „Krankenstand: … abwesend“: Grund markiert, damit er per E-Mail (Bericht, Abo) nur als „abwesend“ hinausgeht
  const msg = issue.code === 'ABSENT' ? esc(issue.message).replace(/^([^:]+):/, '<span class="abs-why">$1</span>:') : esc(issue.message)
  return `<button class="report-row" ${action}><span><span class="pill ${issue.severity}">${SEVERITY_LABEL[issue.severity]}</span></span><span class="tabular">${weekScope ? `KW ${isoWeek(issue.date).week}` : formatDate(issue.date)}</span><span><strong>${esc(emp ? emp.name : 'Einsatz')}</strong>${emp?.team ? `<br><span class="muted">${esc(emp.team)}</span>` : ''}</span><span class="rr-msg">${msg}<br><span class="muted">${esc(where)}</span></span></button>`
}

function reportView(c) {
  const v = c.validation
  const f = app.ui.reportFilter
  const list = v.issues.filter((i) => f === 'all' || i.severity === f)
  const btn = (id, label, n) => `<button class="filter" data-action="report-filter" data-filter="${id}" aria-pressed="${f === id}">${label} (${n})</button>`
  return `<div class="section-head"><div><h2>Prüfbericht</h2><p>Alle Markierungen der Woche. Verstöße (rot) sollten vor dem Veröffentlichen behoben sein, Warnungen bewusst entschieden. Ein Klick öffnet den Einsatz.</p></div>
    <div class="filters">${btn('all', 'Alle', v.issues.length)}${btn('error', 'Verstöße', v.counts.error)}${btn('warning', 'Prüfen', v.counts.warning)}${btn('info', 'Hinweise', v.counts.info)}</div></div>
    ${list.length ? `<div class="report">${list.map((i) => reportRow(c, i)).join('')}</div>` : '<p class="empty">Keine Einträge.</p>'}`
}

registerView({ id: 'report', order: 50, label: 'Prüfbericht', group: 'plan', summary: true, render: reportView, badge: (c) => c.validation.counts.error })

registerActions({
  'report-filter': (el) => {
    app.ui.reportFilter = el.dataset.filter
    renderNow()
  },
})
