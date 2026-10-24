// Abwesenheiten: Monatskalender, Urlaubsanspruch, Erfassung.

import { eachDay, formatDate, isoWeekday, lastOfMonth, MONTH_LONG, WEEKDAY_SHORT } from '../../core/dates.js'
import { vacationSummary } from '../../core/reports.js'
import { app, confirmStep, empName, persist, registerActions, registerView, renderNow } from '../context.js'
import { addAbsence } from '../modals/absence.js'
import { ABSENCE_CLASS, ABSENCE_TYPES, esc, ICON, val } from '../shared.js'
import { monthPicker } from './controlling.js'
import { filterBar, filteredEmployees } from './week.js'

function calendar(c, employees) {
  const from = `${c.month}-01`
  const days = eachDay(from, lastOfMonth(from))
  const head = days.map((d) => `<th class="${isoWeekday(d) > 5 ? 'weekend' : ''} ${c.holidays.has(d) ? 'holiday' : ''}" title="${esc(c.holidays.get(d)?.name || '')}"><span class="dname">${WEEKDAY_SHORT[isoWeekday(d) - 1].slice(0, 2)}</span><span class="ddate">${d.slice(8)}</span></th>`).join('')
  const year = Number(c.month.slice(0, 4))
  const rows = employees
    .map((e) => {
      const list = (app.data.absences || []).filter((a) => a.employeeId === e.id)
      const cells = days
        .map((d) => {
          const a = list.find((x) => d >= x.from && d <= x.to)
          const cls = [isoWeekday(d) > 5 ? 'weekend' : '', c.holidays.has(d) ? 'holiday' : '', a ? ABSENCE_CLASS[a.type] || 'abs-sonst' : ''].join(' ')
          return `<td class="cal-cell ${cls}" title="${a ? esc(`${a.type} ${formatDate(a.from)}–${formatDate(a.to)}`) : ''}">${a ? esc(a.type[0]) : ''}</td>`
        })
        .join('')
      const v = vacationSummary(e, app.data.absences || [], year, app.data.extraFreeDays)
      return `<tr><th class="name-col">${esc(e.name)}</th>${cells}<td class="sum num ${v.rest < 0 ? 'err-text' : ''}" title="Anspruch ${v.entitlement}, verplant ${v.used}">${v.rest} / ${v.entitlement}</td></tr>`
    })
    .join('')
  return `<div class="grid-wrap"><table class="grid cal"><thead><tr><th class="name-col">Mitarbeiter:in</th>${head}<th class="sum-col">Resturlaub ${year}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend">${ABSENCE_TYPES.map((t) => `<span><span class="cal-key ${ABSENCE_CLASS[t]}">${t[0]}</span> ${t}</span>`).join('')}<span>Resturlaub = Anspruch − verplante Urlaubstage (Mo–Fr ohne Feiertage)</span></div>`
}

function absencesView(c) {
  const employees = filteredEmployees(c)
  const ids = new Set(employees.map((e) => e.id))
  const sorted = [...(app.data.absences || [])].filter((a) => ids.has(a.employeeId)).sort((a, b) => b.from.localeCompare(a.from))
  const affected = (a) =>
    Object.entries(app.data.assignments).filter(([key, list]) => {
      const inst = c.state.instByKey.get(key)
      return inst && inst.date >= a.from && inst.date <= a.to && list.some((x) => x.employeeId === a.employeeId)
    }).length
  const [y, m] = c.month.split('-').map(Number)
  const rows = sorted
    .slice(0, 80)
    .map((a) => {
      const n = affected(a)
      return `<tr><td><strong>${esc(empName(a.employeeId))}</strong></td><td><span class="cal-key ${ABSENCE_CLASS[a.type] || 'abs-sonst'}">${esc(a.type[0])}</span> ${esc(a.type)}</td><td class="num">${formatDate(a.from, { year: true })}</td><td class="num">${formatDate(a.to, { year: true })}</td>
      <td>${n ? `<span class="pill error">${n} Einsätze noch eingeteilt</span>` : ''} <button class="btn small" data-action="open-impact" data-id="${esc(a.id)}">Vertretung planen</button></td>
      <td class="edit-only"><button class="btn small ${app.ui.confirm === `abs-${a.id}` ? 'danger confirm' : 'danger'}" data-action="abs-delete" data-id="${esc(a.id)}">${app.ui.confirm === `abs-${a.id}` ? 'Wirklich?' : 'Löschen'}</button></td></tr>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Abwesenheiten</h2><p>Urlaub, Krankenstand, Zeitausgleich, auch rückwirkend. Nach dem Eintragen zeigt der Assistent, welche Einsätze und Stunden neu zu planen sind, und übergibt Fixobjekte an eine Vertretung. Stammeinsätze werden der abwesenden Person angerechnet (Ausfallprinzip).</p></div>${monthPicker(c)}</div>
    <div class="inline-form edit-only">
      <label class="field"><span>Mitarbeiter:in</span><select id="abs-emp">${c.ctx.employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Art</span><select id="abs-type">${ABSENCE_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Von</span><input type="date" id="abs-from" value="${c.monday}"></label>
      <label class="field"><span>Bis</span><input type="date" id="abs-to" value="${c.monday}"></label>
      <label class="field"><span>Notiz</span><input type="text" id="abs-note" placeholder="optional"></label>
      <button class="btn primary" data-action="abs-add">${ICON.plus} Eintragen und Vertretung planen</button>
    </div>
    ${filterBar(c, { problems: false })}
    <h3>${MONTH_LONG[m - 1]} ${y}</h3>
    ${calendar(c, employees)}
    <h3>Einträge</h3>
    ${sorted.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mitarbeiter:in</th><th>Art</th><th>Von</th><th>Bis</th><th>Status</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Abwesenheiten eingetragen.</p>'}`
}

registerView({ id: 'absences', order: 100, label: 'Abwesenheiten', group: 'stamm', render: absencesView })

registerActions(
  {
    'abs-add': () => {
      const from = val('abs-from')
      const entry = { employeeId: val('abs-emp'), type: val('abs-type'), from, to: val('abs-to') || from }
      if (val('abs-note').trim()) entry.note = val('abs-note').trim()
      return addAbsence(entry)
    },
    'abs-delete': (el) => {
      if (!confirmStep(`abs-${el.dataset.id}`)) return
      app.data.absences = app.data.absences.filter((a) => a.id !== el.dataset.id)
      persist()
      renderNow()
    },
  },
  { edit: true },
)
