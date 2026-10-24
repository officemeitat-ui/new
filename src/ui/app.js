import { addDays, eachDay, firstOfMonth, formatDate, formatHours, isoWeek, isoWeekday, lastOfMonth, mondayOf, todayISO, WEEKDAY_LONG, WEEKDAY_SHORT } from '../core/dates.js'
import { austrianHolidays, holidayCalendar } from '../core/holidays.js'
import { buildInstances, HOLIDAY_RULES, PlanState } from '../core/plan.js'
import { createContext, DEFAULT_RULES, maxSeverity, SEVERITY_LABEL, validatePlan } from '../core/rules.js'
import { autoPlan, rankCandidates } from '../core/scheduler.js'
import { buildTimesheet } from '../core/timesheet.js'
import { createDemoData } from '../data/demo.js'
import { loadData, loadPrefs, saveData, savePrefs } from './store.js'

const $app = document.getElementById('app')
const $modal = document.getElementById('modal-root')
const $toast = document.getElementById('toast')

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const nextMonday = () => mondayOf(addDays(todayISO(), 7))
const signed = (min) => (min > 0 ? '+' : min < 0 ? '−' : '±') + formatHours(Math.abs(min))
const saldoClass = (min) => (min > 0 ? 'pos' : min < 0 ? 'neg' : 'zero')
const byStart = (a, b) => a.start - b.start

const ICON = {
  left: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3 9h4.2L6.5 15 13 7H8.8z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 11V3a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
}

const EMPLOYMENT_TYPES = ['Vollzeit', 'Teilzeit', 'Geringfügig', 'Lehrling']
const ABSENCE_TYPES = ['Urlaub', 'Krankenstand', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges']
const CATEGORY_LABEL = { reinigung: 'Reinigung', sonder: 'Sonderleistung' }
const COLOR_NAMES = ['Blau', 'Himbeere', 'Grün', 'Orange', 'Violett', 'Petrol', 'Ocker', 'Moos', 'Magenta', 'Schiefer', 'Braun', 'Indigo']
const WEEK_FLAG = { CONTRACT: (i) => `+${formatHours(i.overMinutes)}`, WEEKLY_48: () => '>48', WEEKLY_MAX: () => '>60', WEEKLY_REST: () => '36h', MONTHLY_LIMIT: () => 'GFG' }

// ---------------------------------------------------------------- Zustand

const prefs = loadPrefs()
const ui = {
  view: prefs.view || 'week',
  monday: prefs.monday || nextMonday(),
  employeeId: prefs.employeeId || null,
  reportFilter: 'all',
  modal: null,
  confirm: null,
}
let data = loadData()
let cur = null
let toastTimer = null
let storageWarned = false

function compute() {
  const monday = ui.monday
  const sunday = addDays(monday, 6)
  const from = [firstOfMonth(monday), addDays(monday, -7)].sort()[0]
  const to = [lastOfMonth(sunday), addDays(sunday, 7)].sort()[1]
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const state = new PlanState(instances, data.assignments)
  const validation = validatePlan(ctx, state, instances, { from: monday, to: sunday })
  const week = instances.filter((i) => (i.date >= monday && i.date <= sunday) || (i.status === 'cancelled' && i.origDate >= monday && i.origDate <= sunday))
  return { monday, sunday, holidays, ctx, instances, state, validation, week, days: eachDay(monday, sunday) }
}

function persist() {
  if (saveData(data) || storageWarned) return
  storageWarned = true
  toast('Speichern im Browser nicht möglich. Änderungen gehen beim Schließen verloren.')
}

function planWeek(replan = false, silent = false) {
  const c = compute()
  const res = autoPlan(c.ctx, c.instances, data.assignments, { from: c.monday, to: c.sunday, replan })
  data.assignments = res.assignments
  persist()
  if (silent) return
  render()
  const parts = [`${res.stats.regular} Stammeinsätze`, `${res.stats.substitute} Vertretungen`]
  if (res.stats.other) parts.push(`${res.stats.other} weitere`)
  toast(`Eingeteilt: ${parts.join(', ')}. ${res.open.length ? `${res.open.length} Einsätze bleiben offen.` : 'Alles besetzt.'}`)
}

function mutateAssignments(fn) {
  const state = new PlanState(cur.instances, data.assignments)
  fn(state)
  data.assignments = state.toObject()
  persist()
  render()
}

if (!data || data.version !== 1) {
  data = createDemoData(ui.monday)
  planWeek(false, true)
}

// ---------------------------------------------------------------- Rahmen

function render() {
  const scroller = document.querySelector('.grid-wrap, .sheet-wrap')
  const scrollLeft = scroller?.scrollLeft || 0
  cur = compute()
  savePrefs({ view: ui.view, monday: ui.monday, employeeId: ui.employeeId })
  const planView = ['week', 'sheet', 'objects', 'report'].includes(ui.view)
  $app.innerHTML = `${topbar(cur)}${tabs(cur)}<main class="wrap">${planView ? summary(cur) : ''}${VIEWS[ui.view](cur)}</main>`
  const next = document.querySelector('.grid-wrap, .sheet-wrap')
  if (next) next.scrollLeft = scrollLeft
  renderModal()
}

function topbar(c) {
  const { year, week } = isoWeek(c.monday)
  return `<header class="topbar"><div class="topbar-inner wrap">
    <div class="brand"><h1>Einsatzplaner</h1><small>Gebäudereinigung · Prototyp</small></div>
    <div class="weeknav">
      <button class="btn icon" data-action="nav" data-delta="-7" aria-label="Vorige Woche">${ICON.left}</button>
      <div class="kw">KW ${week} / ${year}<small>${formatDate(c.monday, { weekday: false })} – ${formatDate(c.sunday, { weekday: false, year: true })}</small></div>
      <button class="btn icon" data-action="nav" data-delta="7" aria-label="Nächste Woche">${ICON.right}</button>
      <button class="btn small" data-action="nav-today">Aktuelle Woche</button>
    </div>
    <div class="actions">
      <button class="btn primary" data-action="plan" title="Freie Einsätze besetzen: zuerst Stammkräfte, dann Vertretungen. Bestehende Einteilungen bleiben.">${ICON.bolt} Woche automatisch planen</button>
      <button class="btn" data-action="replan" title="Nicht fixierte Einteilungen dieser Woche verwerfen und neu planen">Neu planen</button>
      <button class="btn" data-action="open-export">Export</button>
    </div>
  </div></header>`
}

function tabs(c) {
  const errors = c.validation.counts.error
  const tab = ([id, label]) =>
    `<button class="tab" data-action="view" data-view="${id}" ${ui.view === id ? 'aria-current="page"' : ''}>${label}${id === 'report' && errors ? ` <span class="flag error">${errors}</span>` : ''}</button>`
  return `<nav class="tabs wrap" aria-label="Ansichten">
    <div class="tabgroup"><span class="tabgroup-label">Planung</span>${[['week', 'Wochenübersicht'], ['sheet', 'Wochenzettel'], ['objects', 'Objektplan'], ['report', 'Prüfbericht']].map(tab).join('')}</div>
    <div class="tabgroup"><span class="tabgroup-label">Stammdaten</span>${[['staff', 'Mitarbeitende'], ['sites', 'Objekte & Leistungen'], ['absences', 'Abwesenheiten'], ['rules', 'Regeln & Feiertage']].map(tab).join('')}</div>
  </nav>`
}

function summary(c) {
  const active = c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday)
  const slots = active.reduce((s, i) => s + i.staff, 0)
  const filled = active.reduce((s, i) => s + Math.min(c.state.count(i.key), i.staff), 0)
  const errors = c.validation.issues.filter((i) => i.severity === 'error' && i.code !== 'OPEN').length
  const hol = c.days.filter((d) => c.holidays.has(d)).map((d) => `${esc(c.holidays.get(d).name)} (${formatDate(d)})`)
  const cancelled = c.week.filter((i) => i.status === 'cancelled' && i.reason === 'holiday').length
  const moved = c.week.filter((i) => i.status === 'moved' && i.reason === 'holiday').length
  const holText = hol.length ? `${hol.join(', ')}<br><span class="muted" style="font-weight:400">${cancelled} Einsätze entfallen, ${moved} verschoben</span>` : '<span class="muted" style="font-weight:400">keine in dieser Woche</span>'
  const banner =
    slots > 0 && filled === 0
      ? `<div class="banner"><p><strong>Diese Woche ist noch nicht eingeteilt.</strong> Die Automatik besetzt zuerst die Stammkräfte, dann Vertretungen für Urlaub, Krankenstand und offene Einsätze, und hält dabei alle Regeln ein.</p><button class="btn primary" data-action="plan">${ICON.bolt} Woche automatisch planen</button></div>`
      : ''
  return `${banner}<section class="summary" aria-label="Kennzahlen der Woche">
    <div class="stat"><div class="label">Besetzt</div><div class="value">${filled} / ${slots}</div></div>
    <div class="stat ${slots - filled ? 'err' : ''}"><div class="label">Offen</div><div class="value">${slots - filled}</div></div>
    <div class="stat ${errors ? 'err' : ''}"><div class="label">Verstöße</div><div class="value">${errors}</div></div>
    <div class="stat ${c.validation.counts.warning ? 'warn' : ''}"><div class="label">Zu prüfen</div><div class="value">${c.validation.counts.warning}</div></div>
    <div class="stat hol"><div class="label">Feiertage</div><div class="value">${holText}</div></div>
  </section>`
}

// ---------------------------------------------------------------- Wochenübersicht

function objectOf(c, inst) {
  return c.ctx.objectsById.get(inst.objectId) || { name: 'Objekt', short: 'Objekt', color: 10 }
}

function dayClass(c, date) {
  return [isoWeekday(date) > 5 ? 'weekend' : '', c.holidays.has(date) ? 'holiday' : ''].join(' ')
}

function dayHeads(c) {
  return c.days
    .map((d) => {
      const h = c.holidays.get(d)
      return `<th class="day-head ${dayClass(c, d)}"><span class="dname">${WEEKDAY_SHORT[isoWeekday(d) - 1]}</span><span class="ddate">${formatDate(d, { weekday: false })}</span>${h ? `<span class="hol-tag">${esc(h.name)}</span>` : ''}</th>`
    })
    .join('')
}

function workChip(c, emp, line) {
  const inst = line.inst
  const obj = objectOf(c, inst)
  const issues = c.validation.cell.get(`${emp.id}|${inst.key}`) || []
  const sev = maxSeverity(issues)
  const isSub = line.notes.some((n) => n.startsWith('Vertretung'))
  const flags = [
    isSub ? '<span class="flag sub" title="Vertretung">V</span>' : '',
    inst.status === 'moved' ? '<span class="flag sub" title="Verschoben">↷</span>' : '',
    c.state.isLocked(emp.id, inst.key) ? `<span class="flag lock" title="Fixiert">${ICON.lock}</span>` : '',
    sev ? `<span class="flag ${sev}">${sev === 'info' ? 'i' : '!'}</span>` : '',
  ].join('')
  const title = [`${obj.name}${inst.label ? ` – ${inst.label}` : ''}`, `${inst.startTime}–${inst.endTime}`, ...line.notes, ...issues.map((i) => `${SEVERITY_LABEL[i.severity]}: ${i.message}`)].join('\n')
  return `<button class="chip ${sev && sev !== 'info' ? `sev-${sev}` : ''} ${inst.category === 'sonder' ? 'special' : ''}" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(inst.key)}" title="${esc(title)}">
    <span class="chip-time">${inst.startTime}–${inst.endTime}</span><span class="chip-flags">${flags}</span><span class="chip-obj">${esc(obj.short || obj.name)}</span></button>`
}

function struckChip(c, line) {
  const obj = objectOf(c, line.inst)
  const title = [`${obj.name} – ${line.inst.label}`, ...line.notes].join('\n')
  return `<button class="chip struck" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(line.inst.key)}" title="${esc(title)}">
    <span class="chip-time">${line.inst.startTime}–${line.inst.endTime}</span><span class="chip-flags">${line.credited ? `<span class="flag info" title="angerechnet">${formatHours(line.credited)}</span>` : ''}</span><span class="chip-obj">${esc(obj.short || obj.name)}</span></button>`
}

function openChip(c, inst) {
  const obj = objectOf(c, inst)
  const missing = inst.staff - c.state.count(inst.key)
  return `<button class="chip open" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(inst.key)}" title="${esc(`${obj.name} – ${inst.label}: ${missing} offen`)}">
    <span class="chip-time">${inst.startTime}–${inst.endTime}</span><span class="chip-flags"><span class="flag error">${missing}</span></span><span class="chip-obj">${esc(obj.short || obj.name)}</span></button>`
}

function weekFlags(c, emp) {
  const issues = c.validation.byEmployee.get(emp.id) || []
  if (!issues.length) return ''
  return `<div class="week-flags">${issues.map((i) => `<span class="flag ${i.severity}" title="${esc(i.message)}">${esc((WEEK_FLAG[i.code] || (() => '!'))(i))}</span>`).join('')}</div>`
}

function weekView(c) {
  if (!c.ctx.employees.length) return `<p class="empty">Noch keine Mitarbeitenden angelegt. <button class="btn small" data-action="view" data-view="staff">Mitarbeitende anlegen</button></p>`
  const openByDay = c.days.map((d) => c.week.filter((i) => i.date === d && i.status !== 'cancelled' && c.state.count(i.key) < i.staff).sort(byStart))
  const openTotal = openByDay.reduce((s, l) => s + l.reduce((t, i) => t + i.staff - c.state.count(i.key), 0), 0)
  const openRow = `<tr class="open-row"><th class="name-col">Offene Einsätze</th>${openByDay.map((list) => `<td><div class="cell-stack">${list.map((i) => openChip(c, i)).join('')}</div></td>`).join('')}<td class="sum">${openTotal ? `<strong>${openTotal} offen</strong>` : 'alles besetzt'}</td></tr>`

  const rows = c.ctx.employees
    .map((emp) => {
      const ts = buildTimesheet(c.ctx, emp, c.monday, c.instances, c.state)
      const cells = ts.days
        .map((day) => {
          const chips = day.lines.map((l) => (l.kind === 'work' ? workChip(c, emp, l) : struckChip(c, l))).join('')
          const abs = day.absence ? `<span class="abs-tag">${esc(day.absence.type)}</span>` : ''
          return `<td class="${dayClass(c, day.date)} ${day.absence ? 'absent' : ''}"><div class="cell-stack">${abs}${chips}</div></td>`
        })
        .join('')
      const t = ts.totals
      return `<tr><th class="name-col"><button class="emp-name" data-action="open-sheet" data-emp="${esc(emp.id)}" title="Wochenzettel öffnen">${esc(emp.name)}</button><span class="emp-meta">${esc(emp.type)} · ${formatHours(emp.weeklyHours * 60)} h${emp.minor ? ' · unter 18' : ''}${emp.note ? ` · ${esc(emp.note)}` : ''}</span></th>${cells}
        <td class="sum"><div class="hours"><b>${formatHours(t.ist)}</b> / ${formatHours(t.soll)} h</div><div class="saldo ${saldoClass(t.saldo)}">Saldo ${signed(t.saldo)}</div>${weekFlags(c, emp)}</td></tr>`
    })
    .join('')

  return `<div class="grid-wrap"><table class="grid"><thead><tr><th class="name-col">Mitarbeiter:in</th>${dayHeads(c)}<th class="sum-col">Woche</th></tr></thead><tbody>${openRow}${rows}</tbody></table></div>
  <div class="legend">
    <span><span class="flag error">!</span> Verstoß</span><span><span class="flag warning">!</span> prüfen</span><span><span class="flag info">i</span> Hinweis (Zuschlag, Nachtarbeit)</span>
    <span><span class="flag sub">V</span> Vertretung</span><span><span class="flag sub">↷</span> verschoben</span><span><span class="flag lock">${ICON.lock}</span> fixiert</span>
    <span style="text-decoration:line-through">durchgestrichen</span><span>= entfällt (Stunden ggf. angerechnet)</span>
  </div>`
}

// ---------------------------------------------------------------- Wochenzettel

function currentSheetEmployee(c) {
  const emp = c.ctx.employeesById.get(ui.employeeId) || c.ctx.employees[0]
  if (emp) ui.employeeId = emp.id
  return emp
}

function dayNote(day) {
  const parts = []
  if (day.holiday) parts.push(day.holiday.legal ? `Feiertag: ${day.holiday.name}` : day.holiday.name)
  if (day.absence) parts.push(day.absence.type)
  return parts.join(' · ')
}

function sheetView(c) {
  const emp = currentSheetEmployee(c)
  if (!emp) return `<p class="empty">Noch keine Mitarbeitenden angelegt.</p>`
  const ts = buildTimesheet(c.ctx, emp, c.monday, c.instances, c.state)
  const n = (m) => (m ? formatHours(m) : '')
  const rows = ts.days
    .map((day) => {
      const lines = day.lines.length
        ? day.lines
            .map((l) => {
              const issues = l.kind === 'work' ? c.validation.cell.get(`${emp.id}|${l.inst.key}`) || [] : []
              const sev = maxSeverity(issues.filter((i) => i.severity !== 'info'))
              const mark = sev ? `<span class="flag ${sev} issue-mark" title="${esc(issues.map((i) => i.message).join('\n'))}">!</span>` : ''
              return `<tr class="line ${l.style}"><td class="time">${esc(l.time)}</td><td class="text"><button class="link-btn" data-action="open-shift" data-key="${esc(l.inst.key)}">${esc(l.text)}</button>${mark}</td><td class="num">${n(l.hours)}</td><td class="num">${n(l.credited)}</td><td class="num">${n(l.travel)}</td><td class="notes">${esc(l.notes.join(' · '))}</td></tr>`
            })
            .join('')
        : `<tr class="line"><td></td><td class="muted">${day.absence ? esc(day.absence.type) : 'frei'}</td><td></td><td></td><td></td><td></td></tr>`
      return `<tr class="day-row"><th>${WEEKDAY_LONG[isoWeekday(day.date) - 1]}</th><td class="day-note">${esc(dayNote(day))}</td><td></td><td></td><td></td><td class="notes">${day.total ? `Tag gesamt inkl. Fahrzeit: ${formatHours(day.total)} h` : ''}</td></tr>${lines}`
    })
    .join('')
  const t = ts.totals
  const issues = c.validation.issues.filter((i) => i.employeeId === emp.id && i.severity !== 'info')
  const idx = c.ctx.employees.indexOf(emp)
  return `<div class="toolbar">
      <button class="btn icon" data-action="sheet-step" data-delta="-1" aria-label="Vorherige Person" ${idx <= 0 ? 'disabled' : ''}>${ICON.left}</button>
      <select id="ts-employee" aria-label="Mitarbeiter:in">${c.ctx.employees.map((e) => `<option value="${esc(e.id)}" ${e.id === emp.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <button class="btn icon" data-action="sheet-step" data-delta="1" aria-label="Nächste Person" ${idx >= c.ctx.employees.length - 1 ? 'disabled' : ''}>${ICON.right}</button>
      <button class="btn" data-action="copy-sheet">${ICON.copy} Für Excel kopieren</button>
    </div>
    <div class="sheet-wrap"><table class="sheet">
      <thead><tr><th colspan="2"><div class="sheet-title"><span>${esc(emp.name)}</span><span>Wochenplan von ${formatDate(ts.monday, { weekday: false, year: true })} – ${formatDate(ts.sunday, { weekday: false, year: true })}</span></div></th><th class="col">Std.</th><th class="col">Arbeitszeit</th><th class="col">Fahrzeit</th><th>Hinweis</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>GESAMT</th><td class="saldo-cell">Saldo <span class="saldo ${saldoClass(t.saldo)}">${signed(t.saldo)}</span></td><td class="num">${formatHours(t.soll)}</td><td class="num">${formatHours(t.credited)}</td><td class="num">${formatHours(t.travel)}</td><td class="notes">Soll ${formatHours(t.soll)} h · Ist ${formatHours(t.ist)} h (Arbeitszeit inkl. Anrechnung + Fahrzeit)</td></tr></tfoot>
    </table></div>
    <div class="legend"><span style="text-decoration:line-through">durchgestrichen</span><span>= entfällt / verschoben (Feiertag, Urlaub: angerechnet)</span><span style="color:var(--changed)">rot = Vertretung oder verschoben</span><span style="color:var(--special);font-weight:600">grün = Sonderleistung</span></div>
    ${issues.length ? `<section><h3 style="margin-bottom:8px">Prüfung für ${esc(emp.name)}</h3><div class="report">${issues.map((i) => reportRow(c, i)).join('')}</div></section>` : `<p class="note">Keine Verstöße oder Warnungen für ${esc(emp.name)} in dieser Woche.</p>`}`
}

function timesheetTSV(c, emp) {
  const ts = buildTimesheet(c.ctx, emp, c.monday, c.instances, c.state)
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

// ---------------------------------------------------------------- Objektplan

function rhythmText(task) {
  const r = task.recurrence
  if (r.type === 'once') return `einmalig ${formatDate(r.date)}`
  const days = r.weekdays.length === 7 ? 'täglich' : r.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')
  return `${days}${r.everyWeeks > 1 ? `, alle ${r.everyWeeks} Wochen` : ''}`
}

function slot(c, inst) {
  const names = c.state.assigned(inst.key).map((a) => c.ctx.employeesById.get(a.employeeId)?.name.split(' ')[0] || '?')
  if (inst.status === 'cancelled') {
    const why = inst.reason === 'holiday' ? inst.origHoliday?.name || 'Feiertag' : 'diese Woche'
    return `<button class="slot cancelled" data-action="open-shift" data-key="${esc(inst.key)}"><span class="who">${inst.startTime}–${inst.endTime}</span><span>entfällt: ${esc(why)}</span></button>`
  }
  const sev = maxSeverity((c.validation.byShift.get(inst.key) || []).filter((i) => i.severity !== 'info'))
  const missing = inst.staff - names.length
  return `<button class="slot ${sev ? `sev-${sev}` : ''}" data-action="open-shift" data-key="${esc(inst.key)}">
    <span class="who">${names.length ? esc(names.join(', ')) : 'offen'}</span>
    <span class="muted">${inst.startTime}–${inst.endTime}${missing > 0 && names.length ? ` · ${missing} offen` : ''}${inst.status === 'moved' ? ` · von ${formatDate(inst.origDate)}` : ''}</span></button>`
}

function objectsView(c) {
  const blocks = data.objects
    .map((obj) => {
      const tasks = data.tasks.filter((t) => t.objectId === obj.id && c.week.some((i) => i.taskId === t.id))
      if (!tasks.length) return ''
      const rows = tasks
        .map((task) => {
          const cells = c.days
            .map((d) => {
              const list = c.week.filter((i) => i.taskId === task.id && (i.status === 'cancelled' ? i.origDate === d : i.date === d))
              return `<td class="${dayClass(c, d)}"><div class="cell-stack">${list.map((i) => slot(c, i)).join('')}</div></td>`
            })
            .join('')
          const regs = task.regulars.map((id) => c.ctx.employeesById.get(id)?.name).filter(Boolean)
          return `<tr><th class="name-col"><span class="${task.category === 'sonder' ? 'tag special' : ''}">${esc(task.label)}</span><span class="emp-meta">${esc(rhythmText(task))} · ${task.staff} P.</span></th>${cells}<td class="sum">${regs.length ? esc(regs.join(', ')) : '<span class="muted">keine Stammkraft</span>'}</td></tr>`
        })
        .join('')
      return `<tr class="obj-row"><th class="name-col"><span class="swatch" style="--obj:var(--o${obj.color})"></span>${esc(obj.name)}</th><td colspan="8" class="muted">${esc(obj.address || '')}${obj.onlyTrained ? ' · nur eingeschultes Personal' : ''}</td></tr>${rows}`
    })
    .join('')
  return `<div class="grid-wrap"><table class="grid"><thead><tr><th class="name-col">Objekt / Leistung</th>${dayHeads(c)}<th class="sum-col">Stammkraft</th></tr></thead><tbody>${blocks}</tbody></table></div>`
}

// ---------------------------------------------------------------- Prüfbericht

function reportRow(c, issue) {
  const emp = issue.employeeId ? c.ctx.employeesById.get(issue.employeeId) : null
  const inst = c.state.instByKey.get(issue.keys[0])
  const obj = inst ? objectOf(c, inst) : null
  const weekScope = issue.scope === 'week' || issue.scope === 'month'
  const action = weekScope ? `data-action="open-sheet" data-emp="${esc(emp?.id)}"` : `data-action="open-shift" data-key="${esc(issue.keys[0])}"`
  const where = weekScope ? 'ganze Woche' : `${obj ? `${obj.name}${inst.label ? ` – ${inst.label}` : ''}` : ''}${inst ? ` · ${inst.startTime}–${inst.endTime}` : ''}`
  return `<button class="report-row" ${action}><span><span class="pill ${issue.severity}">${SEVERITY_LABEL[issue.severity]}</span></span><span class="tabular">${weekScope ? `KW ${isoWeek(issue.date).week}` : formatDate(issue.date)}</span><span><strong>${esc(emp ? emp.name : 'Einsatz')}</strong></span><span class="rr-msg">${esc(issue.message)}<br><span class="muted">${esc(where)}</span></span></button>`
}

function reportView(c) {
  const v = c.validation
  const list = v.issues.filter((i) => ui.reportFilter === 'all' || i.severity === ui.reportFilter)
  const f = (id, label, n) => `<button class="filter" data-action="report-filter" data-filter="${id}" aria-pressed="${ui.reportFilter === id}">${label} (${n})</button>`
  return `<div class="section-head"><div><h2>Prüfbericht</h2><p>Alle Markierungen der Woche. Verstöße (rot) sollten vor dem Aushang behoben sein, Warnungen bewusst entschieden. Ein Klick öffnet den Einsatz.</p></div>
    <div class="filters">${f('all', 'Alle', v.issues.length)}${f('error', 'Verstöße', v.counts.error)}${f('warning', 'Prüfen', v.counts.warning)}${f('info', 'Hinweise', v.counts.info)}</div></div>
    ${list.length ? `<div class="report">${list.map((i) => reportRow(c, i)).join('')}</div>` : `<p class="empty">Keine Einträge.</p>`}`
}

// ---------------------------------------------------------------- Stammdaten

function availabilitySummary(emp) {
  const groups = []
  for (let d = 1; d <= 7; d++) {
    const w = emp.availability?.[d]
    const text = w ? `${w.from}–${w.to}` : null
    const last = groups.at(-1)
    if (last && last.text === text && last.to === d - 1) last.to = d
    else groups.push({ from: d, to: d, text })
  }
  return groups
    .filter((g) => g.text)
    .map((g) => `${WEEKDAY_SHORT[g.from - 1]}${g.to > g.from ? `–${WEEKDAY_SHORT[g.to - 1]}` : ''} ${g.text}`)
    .join(', ')
}

function staffView() {
  const objName = (id) => data.objects.find((o) => o.id === id)?.short || '?'
  const rows = data.employees
    .map(
      (e) => `<tr>
      <td><strong>${esc(e.name)}</strong>${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}</td>
      <td>${esc(e.type)}${e.minor ? '<br><span class="tag">unter 18 (KJBG)</span>' : ''}</td>
      <td class="num">${formatHours(e.weeklyHours * 60)} h${e.maxMonthHours ? `<br><span class="muted">max. ${formatHours(e.maxMonthHours * 60)} h/Monat</span>` : ''}</td>
      <td><div class="tags">${(e.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="muted">–</span>'}</div></td>
      <td><div class="tags">${(e.trained || []).map((id) => `<span class="tag">${esc(objName(id))}</span>`).join('') || '<span class="muted">–</span>'}</div></td>
      <td>${esc(availabilitySummary(e)) || '<span class="muted">keine</span>'}</td>
      <td><button class="btn small" data-action="emp-edit" data-id="${esc(e.id)}">Bearbeiten</button></td></tr>`,
    )
    .join('')
  return `<div class="section-head"><div><h2>Mitarbeitende</h2><p>Wochenstunden laut Vertrag (Soll), Qualifikationen, in welchen Objekten jemand eingeschult ist (Schlüssel, Alarm, Abläufe) und wann jemand verfügbar ist.</p></div>
    <button class="btn primary" data-action="emp-edit" data-id="new">${ICON.plus} Mitarbeiter:in anlegen</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Beschäftigung</th><th>Soll</th><th>Qualifikationen</th><th>Eingeschult</th><th>Verfügbar</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function sitesView() {
  const empName = (id) => data.employees.find((e) => e.id === id)?.name || '?'
  const cards = data.objects
    .map((obj) => {
      const tasks = data.tasks.filter((t) => t.objectId === obj.id)
      const rows = tasks
        .map(
          (t) => `<tr>
          <td><strong>${esc(t.label)}</strong>${t.category === 'sonder' ? ' <span class="tag special">Sonderleistung</span>' : ''}</td>
          <td>${esc(rhythmText(t))}</td><td class="num">${esc(t.start)}–${esc(t.end)}</td><td class="num">${t.staff}</td>
          <td>${t.regulars.map(empName).map(esc).join(', ') || '<span class="muted">–</span>'}</td>
          <td>${esc(HOLIDAY_RULES[t.holidayRule || 'entfaellt'])}</td>
          <td>${(t.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
          <td><button class="btn small" data-action="task-edit" data-id="${esc(t.id)}">Bearbeiten</button></td></tr>`,
        )
        .join('')
      return `<article class="object-card" style="--obj:var(--o${obj.color})">
        <header><h3>${esc(obj.name)}</h3><span class="addr">${esc(obj.address || '')}${obj.onlyTrained ? ' · nur eingeschultes Personal' : ''}</span>
          <button class="btn small" data-action="task-edit" data-id="new" data-obj="${esc(obj.id)}">${ICON.plus} Leistung</button>
          <button class="btn small" data-action="obj-edit" data-id="${esc(obj.id)}">Objekt bearbeiten</button></header>
        ${tasks.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Leistung</th><th>Rhythmus</th><th>Zeit</th><th>Pers.</th><th>Stammkraft</th><th>An Feiertagen</th><th>Qualifikation</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note" style="padding:10px 14px;margin:0">Noch keine Leistungen.</p>'}
      </article>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Objekte & Leistungen</h2><p>Der Stammplan: welche Leistung in welchem Rhythmus, zu welcher Zeit, mit wem als Stammkraft, und was an Feiertagen passiert. Daraus entsteht jede Woche automatisch der Plan.</p></div>
    <button class="btn primary" data-action="obj-edit" data-id="new">${ICON.plus} Objekt anlegen</button></div>
    <div class="objects">${cards}</div>`
}

function absencesView(c) {
  const empName = (id) => data.employees.find((e) => e.id === id)?.name || '?'
  const sorted = [...(data.absences || [])].sort((a, b) => a.from.localeCompare(b.from))
  const affected = (a) => {
    const keys = Object.entries(data.assignments).filter(([key, list]) => {
      const inst = c.state.instByKey.get(key)
      return inst && inst.date >= a.from && inst.date <= a.to && list.some((x) => x.employeeId === a.employeeId)
    })
    return keys.length
  }
  const rows = sorted
    .map((a) => {
      const n = affected(a)
      return `<tr><td><strong>${esc(empName(a.employeeId))}</strong></td><td>${esc(a.type)}</td><td class="num">${formatDate(a.from, { year: true })}</td><td class="num">${formatDate(a.to, { year: true })}</td>
      <td>${n ? `<span class="pill error">${n} Einsätze noch eingeteilt</span>` : '<span class="pill ok">keine Konflikte</span>'}</td>
      <td><button class="btn small danger" data-action="abs-delete" data-id="${esc(a.id)}">Löschen</button></td></tr>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Abwesenheiten</h2><p>Urlaub, Krankenstand, Zeitausgleich. Eingeteilte Einsätze in diesem Zeitraum werden rot markiert; mit „Neu planen“ sucht die Automatik Vertretungen. Stammeinsätze werden der abwesenden Person angerechnet (Ausfallprinzip).</p></div></div>
    <div class="inline-form">
      <label class="field"><span>Mitarbeiter:in</span><select id="abs-emp">${data.employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Art</span><select id="abs-type">${ABSENCE_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Von</span><input type="date" id="abs-from" value="${c.monday}"></label>
      <label class="field"><span>Bis</span><input type="date" id="abs-to" value="${c.monday}"></label>
      <button class="btn primary" data-action="abs-add">${ICON.plus} Eintragen</button>
    </div>
    ${sorted.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mitarbeiter:in</th><th>Art</th><th>Von</th><th>Bis</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Abwesenheiten eingetragen.</p>'}`
}

const RULE_FIELDS = [
  ['Arbeitszeit (AZG)', [
    ['dailyWarnH', 'Warnung ab Stunden pro Tag', 'Über 10 h nur als Überstunden zulässig. Fahrzeit zählt mit.'],
    ['maxDailyH', 'Höchstarbeitszeit pro Tag (h)', '§ 9 AZG: 12 h'],
    ['maxAvgWeeklyH', 'Warnung ab Stunden pro Woche', '§ 9 Abs 4 AZG: im Schnitt 48 h über 17 Wochen'],
    ['maxWeeklyH', 'Höchstarbeitszeit pro Woche (h)', '§ 9 AZG: 60 h'],
    ['breakAfterH', 'Pause ab Einsatzdauer (h)', '§ 11 AZG: bei mehr als 6 h'],
    ['breakMin', 'Pausendauer (min)', 'wird automatisch abgezogen'],
  ]],
  ['Ruhezeiten (AZG, ARG)', [
    ['minDailyRestH', 'Tägliche Ruhezeit (h)', '§ 12 AZG: mind. 11 h zwischen Dienstende und Dienstbeginn'],
    ['minWeeklyRestH', 'Wochenruhe (h)', '§§ 3, 4 ARG: 36 h, inkl. eines ganzen freien Tages'],
    ['nightStart', 'Nachtarbeit ab', '§ 12a AZG: 22:00', 'time'],
    ['nightEnd', 'Nachtarbeit bis', '05:00', 'time'],
  ]],
  ['Zuschläge, Fahrzeit & Anrechnung', [
    ['holidayBonusPct', 'Feiertagszuschlag (%)', 'Arbeit am Feiertag, z. B. 1,5 h → 3 h'],
    ['sundayBonusPct', 'Sonntagszuschlag (%)', 'laut Kollektivvertrag prüfen'],
    ['travelMin', 'Fahrzeit zwischen Objekten (min)', 'wird als Arbeitszeit gezählt'],
    ['creditSpecialTasks', 'Sonderleistungen bei Feiertag/Urlaub anrechnen', 'z. B. „Blumen gießen“', 'checkbox'],
  ]],
  ['Automatik', [
    ['autoExtraHoursPerWeek', 'Max. Mehrstunden für Vertretungen (h/Woche)', 'Darüber plant die Automatik niemanden ein; manuell bleibt es möglich.'],
  ]],
  ['Jugendliche (KJBG)', [
    ['minor.maxDailyH', 'Höchstarbeitszeit pro Tag (h)', '§ 11 KJBG: 8 h'],
    ['minor.maxWeeklyH', 'Höchstarbeitszeit pro Woche (h)', '§ 11 KJBG: 40 h'],
    ['minor.minDailyRestH', 'Tägliche Ruhezeit (h)', '§ 16 KJBG: 12 h'],
    ['minor.nightStart', 'Nachtruhe ab', '§ 17 KJBG: 20:00', 'time'],
    ['minor.nightEnd', 'Nachtruhe bis', '06:00', 'time'],
  ]],
]

function ruleValue(path) {
  const [a, b] = path.split('.')
  return b ? data.rules[a]?.[b] : data.rules[a]
}

function rulesView(c) {
  const year = Number(c.monday.slice(0, 4))
  const fieldsets = RULE_FIELDS.map(
    ([title, fields]) =>
      `<fieldset><legend>${title}</legend>${fields
        .map(([key, label, hint, type = 'number']) => {
          const id = `rule-${key.replace('.', '-')}`
          if (type === 'checkbox') return `<label class="check"><input type="checkbox" id="${id}" ${ruleValue(key) ? 'checked' : ''}><span>${label}<br><small class="muted">${hint}</small></span></label>`
          return `<div class="rule"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${type === 'number' ? 'step="0.5" min="0"' : ''} value="${esc(ruleValue(key))}"><small>${hint}</small></div>`
        })
        .join('')}</fieldset>`,
  ).join('')
  const holidays = [...austrianHolidays(year), ...austrianHolidays(year + 1)]
  const free = [...(data.extraFreeDays || [])].sort((a, b) => a.date.localeCompare(b.date))
  return `<div class="section-head"><div><h2>Regeln & Feiertage</h2><p>Grundlage sind AZG, ARG und KJBG. Werte aus eurem Kollektivvertrag oder Betriebsvereinbarungen hier anpassen. Alle Markierungen und die Automatik richten sich danach.</p></div>
      <div class="actions"><button class="btn ${ui.confirm === 'rules-reset' ? 'danger confirm' : ''}" data-action="rules-reset">${ui.confirm === 'rules-reset' ? 'Wirklich zurücksetzen?' : 'Standardwerte'}</button><button class="btn primary" data-action="rules-save">Regeln speichern</button></div></div>
    <div class="rules">${fieldsets}</div>
    <div class="rules">
      <fieldset><legend>Gesetzliche Feiertage ${year}/${year + 1}</legend><div class="hol-list">${holidays.map((h) => `<span class="tabular">${formatDate(h.date, { year: true })}</span><span>${esc(h.name)}</span><span></span>`).join('')}</div>
        <p class="note">Österreich, § 7 ARG. Werden automatisch berechnet (Ostern, Pfingsten, Fronleichnam). Karfreitag ist seit 2019 kein Feiertag mehr.</p></fieldset>
      <fieldset><legend>Betriebsfreie Tage</legend>
        <p class="note">Zum Beispiel 24.12., 31.12. oder ein Landespatron wie der Hl. Rupert (24.9., Salzburg). Einsätze entfallen wie an Feiertagen, aber ohne Feiertagszuschlag.</p>
        <div class="hol-list">${free.map((d) => `<span class="tabular">${formatDate(d.date, { year: true })}</span><span>${esc(d.name)}</span><button class="btn small danger" data-action="freeday-delete" data-date="${esc(d.date)}">Entfernen</button>`).join('') || '<span class="muted">keine</span>'}</div>
        <div class="inline-form" style="border:0;padding:0"><label class="field"><span>Datum</span><input type="date" id="free-date"></label><label class="field"><span>Bezeichnung</span><input type="text" id="free-name" placeholder="z. B. Betriebsausflug"></label><button class="btn" data-action="freeday-add">${ICON.plus} Hinzufügen</button></div>
      </fieldset>
      <fieldset><legend>Qualifikationen</legend>
        <p class="note">Werden bei Leistungen als Voraussetzung und bei Mitarbeitenden als Fähigkeit hinterlegt. Mit Komma trennen.</p>
        <input type="text" id="skills-list" value="${esc((data.skills || []).join(', '))}">
        <div><button class="btn" data-action="skills-save">Qualifikationen speichern</button></div>
      </fieldset>
    </div>`
}

const VIEWS = { week: weekView, sheet: sheetView, objects: objectsView, report: reportView, staff: staffView, sites: sitesView, absences: absencesView, rules: rulesView }

// ---------------------------------------------------------------- Dialoge

function renderModal() {
  if (!ui.modal) {
    $modal.innerHTML = ''
    return
  }
  const scroll = $modal.querySelector('.modal-backdrop')?.scrollTop || 0
  const candScroll = $modal.querySelector('.candidates')?.scrollTop || 0
  const html = MODALS[ui.modal.type](cur, ui.modal)
  if (!html) {
    ui.modal = null
    $modal.innerHTML = ''
    return
  }
  $modal.innerHTML = `<div class="modal-backdrop" data-action="backdrop">${html}</div>`
  const backdrop = $modal.querySelector('.modal-backdrop')
  backdrop.scrollTop = scroll
  const cand = $modal.querySelector('.candidates')
  if (cand) cand.scrollTop = candScroll
  if (ui.modal.justOpened) {
    ui.modal.justOpened = false
    $modal.querySelector('.modal input, .modal select, .modal button')?.focus({ preventScroll: true })
  }
}

function modalFrame({ title, subtitle = '', color = null, body, foot = '' }) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${color ? `style="--obj:var(--o${color})"` : ''}>
    <header><h2>${esc(title)}${subtitle ? `<small>${subtitle}</small>` : ''}</h2><button class="btn icon" data-action="close-modal" aria-label="Schließen">${ICON.close}</button></header>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`
}

function issueList(issues) {
  if (!issues.length) return '<ul class="issue-list"><li class="ok">Keine Einwände</li></ul>'
  return `<ul class="issue-list">${issues.map((i) => `<li class="${i.severity}">${esc(i.message)}</li>`).join('')}</ul>`
}

function shiftModal(c, { key }) {
  const inst = c.state.instByKey.get(key)
  if (!inst) return null
  const obj = objectOf(c, inst)
  const assigned = c.state.assigned(key)
  const staffingIssues = (c.validation.byShift.get(key) || []).filter((i) => i.scope === 'staffing')
  const tags = [
    `<span class="tag">${formatDate(inst.date, { year: true })}</span>`,
    `<span class="tag">${inst.startTime}–${inst.endTime}</span>`,
    `<span class="tag">${formatHours(inst.net)} h netto${inst.breakMin ? ` (−${inst.breakMin} min Pause)` : ''}</span>`,
    `<span class="tag">${inst.staff} ${inst.staff === 1 ? 'Person' : 'Personen'}</span>`,
    ...inst.skills.map((s) => `<span class="tag">benötigt: ${esc(s)}</span>`),
    inst.category === 'sonder' ? '<span class="tag special">Sonderleistung</span>' : '',
    inst.holiday ? `<span class="pill info">${esc(inst.holiday.name)}</span>` : inst.isSunday ? '<span class="pill info">Sonntag</span>' : '',
    inst.status === 'moved' ? `<span class="pill warning">verschoben von ${formatDate(inst.origDate)}${inst.reason === 'holiday' ? ' (Feiertag)' : ''}</span>` : '',
    inst.status === 'cancelled' ? `<span class="pill info">entfällt${inst.reason === 'holiday' ? `: ${esc(inst.origHoliday?.name)}` : ' diese Woche'}</span>` : '',
  ].join('')

  const regularsMissing = inst.regulars.filter((id) => !assigned.some((a) => a.employeeId === id))
  const regularsNote = inst.regulars.length
    ? `<p class="note">Stammkraft: ${inst.regulars
        .map((id) => {
          const e = c.ctx.employeesById.get(id)
          if (!e) return ''
          const abs = c.ctx.absencesByEmployee.get(id)?.find((a) => inst.date >= a.from && inst.date <= a.to)
          return `${esc(e.name)}${regularsMissing.includes(id) ? (abs ? ` (${esc(abs.type)})` : ' (nicht eingeteilt)') : ''}`
        })
        .join(', ')}</p>`
    : '<p class="note">Keine Stammkraft hinterlegt.</p>'

  const people = assigned
    .map((a) => {
      const e = c.ctx.employeesById.get(a.employeeId)
      if (!e) return ''
      const role = inst.regulars.includes(e.id) ? 'Stammkraft' : inst.regulars.length ? 'Vertretung' : 'eingeteilt'
      const issues = c.validation.cell.get(`${e.id}|${key}`) || []
      return `<div class="person"><div class="pname">${esc(e.name)}<small>${role}${a.locked ? ' · fixiert' : ''}</small></div>${issueList(issues)}
        <div class="acts"><button class="btn small" data-action="toggle-lock" data-key="${esc(key)}" data-emp="${esc(e.id)}">${a.locked ? 'Lösen' : 'Fixieren'}</button><button class="btn small danger" data-action="unassign" data-key="${esc(key)}" data-emp="${esc(e.id)}">Entfernen</button></div></div>`
    })
    .join('')

  let candidates = ''
  if (inst.status !== 'cancelled') {
    const list = rankCandidates(c.ctx, c.state, inst)
    candidates = `<section><h3>Wer kann einspringen?</h3><p class="note">Sortiert nach Eignung: Regeln, Verfügbarkeit, Wochenstunden, Einschulung, Wege. Rot heißt, die Einteilung würde gegen eine Regel verstoßen.</p>
      <div class="candidates">${list
        .map((cand) => {
          const errors = cand.issues.filter((i) => i.severity === 'error')
          const warnings = cand.issues.filter((i) => i.severity === 'warning')
          const status = errors.length ? ['error', 'Nicht möglich'] : warnings.length ? ['warning', cand.allowed ? 'Passt, prüfen' : 'Mit Vorbehalt'] : ['ok', 'Passt']
          const shown = [...errors, ...warnings, ...cand.issues.filter((i) => i.severity === 'info')].slice(0, 4)
          return `<div class="person"><div class="pname">${esc(cand.emp.name)}<small>${cand.regular ? 'Stammkraft · ' : ''}${esc(cand.emp.type)} · ${formatHours(cand.emp.weeklyHours * 60)} h</small><span class="pill ${status[0]}">${status[1]}</span></div>
            ${issueList(shown)}
            <div class="acts"><button class="btn small ${errors.length ? '' : 'primary'}" data-action="assign" data-key="${esc(key)}" data-emp="${esc(cand.emp.id)}">${errors.length ? 'Trotzdem einteilen' : 'Einteilen'}</button></div></div>`
        })
        .join('')}</div></section>`
  }

  const ov = data.overrides[key] || {}
  const weekDays = eachDay(mondayOf(inst.origDate), addDays(mondayOf(inst.origDate), 6))
  const edit = `<details ${Object.keys(ov).length ? 'open' : ''}><summary>Nur diese Woche ändern</summary>
    <div class="form-grid">
      <label class="field"><span>Tag</span><select id="ov-date">${weekDays.map((d) => `<option value="${d}" ${d === inst.date ? 'selected' : ''}>${formatDate(d)}${c.holidays.get(d) ? ` (${esc(c.holidays.get(d).name)})` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Beginn</span><input type="time" id="ov-start" value="${esc(inst.startTime)}"></label>
      <label class="field"><span>Ende</span><input type="time" id="ov-end" value="${esc(inst.endTime)}"></label>
      <label class="field wide"><span>Notiz auf dem Wochenzettel</span><input type="text" id="ov-note" value="${esc(ov.note || '')}" placeholder="z. B. Schlüssel beim Portier"></label>
    </div>
    <div class="actions" style="margin-top:10px">
      <button class="btn primary" data-action="ov-save" data-key="${esc(key)}">Übernehmen</button>
      <button class="btn" data-action="ov-cancel" data-key="${esc(key)}">${ov.cancelled ? 'Wieder einplanen' : 'Entfällt diese Woche'}</button>
      ${Object.keys(ov).length ? `<button class="btn" data-action="ov-reset" data-key="${esc(key)}">Änderung zurücknehmen</button>` : ''}
    </div></details>`

  return modalFrame({
    title: `${obj.name}${inst.label ? ` – ${inst.label}` : ''}`,
    subtitle: esc(obj.address || ''),
    color: obj.color,
    body: `<div class="meta">${tags}</div>
      ${staffingIssues.length ? issueList(staffingIssues) : ''}
      <section><h3>Eingeteilt (${assigned.length}/${inst.staff})</h3>${regularsNote}${people || '<p class="note">Noch niemand eingeteilt.</p>'}</section>
      ${candidates}${edit}`,
  })
}

function exportModal(c) {
  const sheets = c.ctx.employees.map((e) => timesheetTSV(c, e)).join('\n\n')
  const json = JSON.stringify(data, null, 2)
  return modalFrame({
    title: 'Export & Datensicherung',
    body: `<section><h3>Wochenzettel KW ${isoWeek(c.monday).week} für Excel</h3><p class="note">Alle Wochenzettel als Tabelle. Kopieren und in Excel einfügen, Spalten werden übernommen.</p>
        <textarea id="export-tsv" rows="8" readonly>${esc(sheets)}</textarea><div><button class="btn" data-action="copy-text" data-target="export-tsv">${ICON.copy} Kopieren</button></div></section>
      <section><h3>Datensicherung</h3><p class="note">Alle Stammdaten und Einteilungen als JSON. Die Daten liegen in diesem Prototyp nur in diesem Browser.</p>
        <textarea id="export-json" rows="5" readonly>${esc(json)}</textarea><div><button class="btn" data-action="copy-text" data-target="export-json">${ICON.copy} Kopieren</button></div></section>
      <section><h3>Daten einspielen</h3><p class="note">Eine Datensicherung hier einfügen oder als Datei wählen. Ersetzt alle aktuellen Daten.</p>
        <input type="file" id="import-file" accept=".json,application/json">
        <textarea id="import-json" rows="4" placeholder="JSON hier einfügen"></textarea>
        <div class="actions"><button class="btn" data-action="import-json">Daten übernehmen</button>
        <button class="btn ${ui.confirm === 'reset' ? 'danger confirm' : 'danger'}" data-action="reset-demo">${ui.confirm === 'reset' ? 'Wirklich alles ersetzen?' : 'Beispieldaten wiederherstellen'}</button></div></section>`,
  })
}

function checkboxes(name, options, selected) {
  return options.map(([value, label]) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')
}

function employeeModal(c, { id }) {
  const e = id === 'new' ? { id: 'new', name: '', type: 'Teilzeit', weeklyHours: 20, skills: [], trained: [], availability: {} } : data.employees.find((x) => x.id === id)
  if (!e) return null
  const avail = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => {
      const w = e.availability?.[d]
      return `<label class="check"><input type="checkbox" id="emp-av-on-${d}" ${w ? 'checked' : ''}><span>${WEEKDAY_LONG[d - 1]}</span></label>
        <input type="time" id="emp-av-from-${d}" value="${esc(w?.from || '06:00')}" aria-label="${WEEKDAY_LONG[d - 1]} von"><input type="time" id="emp-av-to-${d}" value="${esc(w?.to || '20:00')}" aria-label="${WEEKDAY_LONG[d - 1]} bis">`
    })
    .join('')
  return modalFrame({
    title: id === 'new' ? 'Mitarbeiter:in anlegen' : e.name,
    body: `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="emp-name" value="${esc(e.name)}" required></label>
        <label class="field"><span>Beschäftigung</span><select id="emp-type">${EMPLOYMENT_TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Wochenstunden (Soll)</span><input type="number" id="emp-hours" step="0.5" min="0" value="${e.weeklyHours ?? ''}"></label>
        <label class="field"><span>Max. Stunden pro Monat (geringfügig)</span><input type="number" id="emp-maxmonth" step="0.5" min="0" value="${e.maxMonthHours ?? ''}" placeholder="leer = kein Limit"></label>
        <label class="field"><span>Notiz</span><input type="text" id="emp-note" value="${esc(e.note || '')}" placeholder="z. B. Springer:in, Führerschein B"></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="emp-minor" ${e.minor ? 'checked' : ''}><span>unter 18 Jahre (Jugendschutz KJBG)</span></label>
      </div>
      <section><h3>Qualifikationen</h3><div class="form-grid">${checkboxes('emp-skill', (data.skills || []).map((s) => [s, s]), e.skills || [])}</div></section>
      <section><h3>Eingeschult in Objekten</h3><div class="form-grid">${checkboxes('emp-trained', data.objects.map((o) => [o.id, o.name]), e.trained || [])}</div></section>
      <section><h3>Verfügbarkeit</h3><div class="avail-grid">${avail}</div><p class="note">Ende vor Beginn bedeutet „bis in den nächsten Tag“.</p></section>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${ui.confirm === 'emp-delete' ? 'danger confirm' : 'danger'}" data-action="emp-delete" data-id="${esc(e.id)}">${ui.confirm === 'emp-delete' ? 'Wirklich löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="emp-save" data-id="${esc(e.id)}">Speichern</button></div>`,
  })
}

function objectModal(c, { id }) {
  const o = id === 'new' ? { id: 'new', name: '', short: '', address: '', color: (data.objects.length % 12) + 1, onlyTrained: false } : data.objects.find((x) => x.id === id)
  if (!o) return null
  return modalFrame({
    title: id === 'new' ? 'Objekt anlegen' : o.name,
    color: o.color,
    body: `<div class="form-grid">
        <label class="field wide"><span>Name</span><input type="text" id="obj-name" value="${esc(o.name)}" required></label>
        <label class="field"><span>Kurzname (für den Plan)</span><input type="text" id="obj-short" value="${esc(o.short)}"></label>
        <label class="field"><span>Adresse</span><input type="text" id="obj-address" value="${esc(o.address)}"></label>
        <label class="field"><span>Farbe</span><select id="obj-color">${COLOR_NAMES.map((n, i) => `<option value="${i + 1}" ${o.color === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="obj-trained" ${o.onlyTrained ? 'checked' : ''}><span>Nur eingeschultes Personal (Schlüssel, Alarm, Hygiene)</span></label>
      </div>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${ui.confirm === 'obj-delete' ? 'danger confirm' : 'danger'}" data-action="obj-delete" data-id="${esc(o.id)}">${ui.confirm === 'obj-delete' ? 'Objekt samt Leistungen löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="obj-save" data-id="${esc(o.id)}">Speichern</button></div>`,
  })
}

function taskModal(c, { id, objectId }) {
  const t =
    id === 'new'
      ? { id: 'new', objectId: objectId || data.objects[0]?.id, label: '', category: 'reinigung', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, anchor: c.monday }, start: '18:00', end: '20:00', staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', breakMin: 0 }
      : data.tasks.find((x) => x.id === id)
  if (!t) return null
  const r = t.recurrence
  const once = r.type === 'once'
  const obj = data.objects.find((o) => o.id === t.objectId)
  return modalFrame({
    title: id === 'new' ? 'Leistung anlegen' : t.label,
    subtitle: esc(obj?.name || ''),
    color: obj?.color,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="task-object">${data.objects.map((o) => `<option value="${esc(o.id)}" ${o.id === t.objectId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Bezeichnung</span><input type="text" id="task-label" value="${esc(t.label)}" placeholder="z. B. Büroreinigung"></label>
        <label class="field"><span>Art</span><select id="task-category">${Object.entries(CATEGORY_LABEL).map(([k, v]) => `<option value="${k}" ${k === t.category ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Rhythmus</span><select id="task-type" data-toggle="rhythm"><option value="weekly" ${once ? '' : 'selected'}>regelmäßig</option><option value="once" ${once ? 'selected' : ''}>einmalig</option></select></label>
      </div>
      <div class="form-grid" data-rhythm="weekly" ${once ? 'hidden' : ''}>
        <div class="field wide"><span>Wochentage</span><div class="weekday-picker">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" name="task-wd" value="${d}" ${!once && r.weekdays.includes(d) ? 'checked' : ''}>${WEEKDAY_SHORT[d - 1]}</label>`).join('')}</div></div>
        <label class="field"><span>Intervall</span><select id="task-every">${[[1, 'jede Woche'], [2, 'alle 2 Wochen (14-tägig)'], [3, 'alle 3 Wochen'], [4, 'alle 4 Wochen']].map(([v, l]) => `<option value="${v}" ${(r.everyWeeks || 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Erstmals in der Woche vom</span><input type="date" id="task-anchor" value="${esc(r.anchor || c.monday)}"></label>
      </div>
      <div class="form-grid" data-rhythm="once" ${once ? '' : 'hidden'}>
        <label class="field"><span>Datum</span><input type="date" id="task-date" value="${esc(once ? r.date : c.monday)}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>Beginn</span><input type="time" id="task-start" value="${esc(t.start)}"></label>
        <label class="field"><span>Ende</span><input type="time" id="task-end" value="${esc(t.end)}"></label>
        <label class="field"><span>Personen</span><input type="number" id="task-staff" min="1" step="1" value="${t.staff}"></label>
        <label class="field"><span>An Feiertagen</span><select id="task-holiday">${Object.entries(HOLIDAY_RULES).map(([k, v]) => `<option value="${k}" ${k === (t.holidayRule || 'entfaellt') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <section><h3>Stammkraft</h3><div class="form-grid">${checkboxes('task-reg', data.employees.map((e) => [e.id, e.name]), t.regulars || [])}</div></section>
      <section><h3>Benötigte Qualifikation</h3><div class="form-grid">${checkboxes('task-skill', (data.skills || []).map((s) => [s, s]), t.skills || [])}</div></section>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${ui.confirm === 'task-delete' ? 'danger confirm' : 'danger'}" data-action="task-delete" data-id="${esc(t.id)}">${ui.confirm === 'task-delete' ? 'Wirklich löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="task-save" data-id="${esc(t.id)}">Speichern</button></div>`,
  })
}

const MODALS = { shift: shiftModal, export: exportModal, employee: employeeModal, object: objectModal, task: taskModal }

function openModal(modal) {
  ui.modal = { ...modal, justOpened: true }
  ui.confirm = null
  renderModal()
}

function closeModal() {
  ui.modal = null
  ui.confirm = null
  renderModal()
}

// ---------------------------------------------------------------- Formulare lesen

const val = (id) => document.getElementById(id)?.value ?? ''
const num = (id) => {
  const n = parseFloat(String(val(id)).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const checked = (id) => !!document.getElementById(id)?.checked
const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value)

function confirmStep(key) {
  if (ui.confirm === key) return true
  ui.confirm = key
  render()
  return false
}

// ---------------------------------------------------------------- Aktionen

function toast(message) {
  $toast.textContent = message
  $toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($toast.hidden = true), 4500)
}

function copyText(text, textarea) {
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

function removeEmployeeEverywhere(id) {
  data.employees = data.employees.filter((e) => e.id !== id)
  data.absences = data.absences.filter((a) => a.employeeId !== id)
  for (const t of data.tasks) t.regulars = t.regulars.filter((r) => r !== id)
  for (const [key, list] of Object.entries(data.assignments)) {
    const rest = list.filter((a) => a.employeeId !== id)
    if (rest.length) data.assignments[key] = rest
    else delete data.assignments[key]
  }
}

function removeTaskEverywhere(id) {
  data.tasks = data.tasks.filter((t) => t.id !== id)
  for (const key of Object.keys(data.assignments)) if (key.endsWith(`|${id}`)) delete data.assignments[key]
  for (const key of Object.keys(data.overrides)) if (key.endsWith(`|${id}`)) delete data.overrides[key]
}

function readEmployeeForm(existing) {
  const availability = {}
  for (let d = 1; d <= 7; d++) if (checked(`emp-av-on-${d}`)) availability[d] = { from: val(`emp-av-from-${d}`) || '00:00', to: val(`emp-av-to-${d}`) || '24:00' }
  return {
    ...existing,
    name: val('emp-name').trim(),
    type: val('emp-type'),
    weeklyHours: num('emp-hours') ?? 0,
    maxMonthHours: num('emp-maxmonth') || undefined,
    note: val('emp-note').trim() || undefined,
    minor: checked('emp-minor') || undefined,
    skills: checkedValues('emp-skill'),
    trained: checkedValues('emp-trained'),
    availability,
  }
}

function readTaskForm(existing) {
  const type = val('task-type')
  const recurrence =
    type === 'once'
      ? { type: 'once', date: val('task-date') }
      : { type: 'weekly', weekdays: checkedValues('task-wd').map(Number), everyWeeks: Number(val('task-every')) || 1, anchor: mondayOf(val('task-anchor') || cur.monday) }
  return {
    ...existing,
    objectId: val('task-object'),
    label: val('task-label').trim(),
    category: val('task-category'),
    recurrence,
    start: val('task-start'),
    end: val('task-end'),
    staff: Math.max(1, Math.round(num('task-staff') || 1)),
    holidayRule: val('task-holiday'),
    regulars: checkedValues('task-reg'),
    skills: checkedValues('task-skill'),
  }
}

const ACTIONS = {
  nav: (el) => {
    ui.monday = addDays(ui.monday, Number(el.dataset.delta))
    render()
  },
  'nav-today': () => {
    ui.monday = mondayOf(todayISO())
    render()
  },
  view: (el) => {
    ui.view = el.dataset.view
    ui.confirm = null
    render()
    window.scrollTo({ top: 0 })
  },
  plan: () => planWeek(false),
  replan: () => planWeek(true),
  'open-shift': (el) => openModal({ type: 'shift', key: el.dataset.key }),
  'open-export': () => openModal({ type: 'export' }),
  'close-modal': closeModal,
  backdrop: (el, e) => {
    if (e.target === el) closeModal()
  },
  'open-sheet': (el) => {
    ui.employeeId = el.dataset.emp
    ui.view = 'sheet'
    ui.modal = null
    render()
    window.scrollTo({ top: 0 })
  },
  'sheet-step': (el) => {
    const list = cur.ctx.employees
    const idx = list.findIndex((e) => e.id === ui.employeeId) + Number(el.dataset.delta)
    if (list[idx]) ui.employeeId = list[idx].id
    render()
  },
  'copy-sheet': () => {
    const emp = currentSheetEmployee(cur)
    if (emp) copyText(timesheetTSV(cur, emp))
  },
  'copy-text': (el) => {
    const ta = document.getElementById(el.dataset.target)
    if (ta) copyText(ta.value, ta)
  },
  assign: (el) => {
    const emp = cur.ctx.employeesById.get(el.dataset.emp)
    mutateAssignments((s) => s.assign(el.dataset.emp, el.dataset.key, true))
    toast(`${emp?.name} eingeteilt und fixiert.`)
  },
  unassign: (el) => mutateAssignments((s) => s.unassign(el.dataset.emp, el.dataset.key)),
  'toggle-lock': (el) => mutateAssignments((s) => s.setLocked(el.dataset.emp, el.dataset.key, !s.isLocked(el.dataset.emp, el.dataset.key))),
  'ov-save': (el) => {
    const key = el.dataset.key
    const inst = cur.state.instByKey.get(key)
    const task = data.tasks.find((t) => t.id === inst.taskId)
    const ov = { ...(data.overrides[key] || {}) }
    const date = val('ov-date')
    ov.date = date !== inst.origDate || inst.status === 'moved' ? date : undefined
    ov.start = val('ov-start') !== task.start ? val('ov-start') : undefined
    ov.end = val('ov-end') !== task.end ? val('ov-end') : undefined
    ov.note = val('ov-note').trim() || undefined
    const clean = Object.fromEntries(Object.entries(ov).filter(([, v]) => v !== undefined && v !== false))
    if (Object.keys(clean).length) data.overrides[key] = clean
    else delete data.overrides[key]
    persist()
    render()
    toast('Änderung für diese Woche gespeichert.')
  },
  'ov-cancel': (el) => {
    const key = el.dataset.key
    const ov = { ...(data.overrides[key] || {}) }
    if (ov.cancelled) delete ov.cancelled
    else ov.cancelled = true
    if (Object.keys(ov).length) data.overrides[key] = ov
    else delete data.overrides[key]
    persist()
    render()
  },
  'ov-reset': (el) => {
    delete data.overrides[el.dataset.key]
    persist()
    render()
  },
  'report-filter': (el) => {
    ui.reportFilter = el.dataset.filter
    render()
  },
  'import-json': async () => {
    let text = val('import-json').trim()
    const file = document.getElementById('import-file')?.files?.[0]
    if (!text && file) text = await file.text()
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.objects) || !Array.isArray(parsed.tasks)) throw new Error('format')
      data = { version: 1, assignments: {}, overrides: {}, absences: [], extraFreeDays: [], skills: [], ...parsed, rules: { ...DEFAULT_RULES, ...(parsed.rules || {}) } }
      persist()
      closeModal()
      render()
      toast('Daten übernommen.')
    } catch {
      toast('Das ist keine gültige Datensicherung. Bitte den kompletten JSON-Text einfügen.')
    }
  },
  'reset-demo': () => {
    if (ui.confirm !== 'reset') {
      ui.confirm = 'reset'
      renderModal()
      return
    }
    data = createDemoData(ui.monday)
    planWeek(false, true)
    closeModal()
    render()
    toast('Beispieldaten wiederhergestellt.')
  },
  'emp-edit': (el) => openModal({ type: 'employee', id: el.dataset.id }),
  'emp-save': (el) => {
    const id = el.dataset.id
    const existing = id === 'new' ? { id: uid('e') } : data.employees.find((e) => e.id === id)
    const emp = readEmployeeForm(existing)
    if (!emp.name) return toast('Bitte einen Namen eingeben.')
    if (id === 'new') data.employees.push(emp)
    else data.employees = data.employees.map((e) => (e.id === id ? emp : e))
    persist()
    closeModal()
    render()
    toast(`${emp.name} gespeichert.`)
  },
  'emp-delete': (el) => {
    if (ui.confirm !== 'emp-delete') {
      ui.confirm = 'emp-delete'
      renderModal()
      return
    }
    removeEmployeeEverywhere(el.dataset.id)
    persist()
    closeModal()
    render()
  },
  'obj-edit': (el) => openModal({ type: 'object', id: el.dataset.id }),
  'obj-save': (el) => {
    const id = el.dataset.id
    const existing = id === 'new' ? { id: uid('o') } : data.objects.find((o) => o.id === id)
    const obj = { ...existing, name: val('obj-name').trim(), short: val('obj-short').trim(), address: val('obj-address').trim(), color: Number(val('obj-color')) || 1, onlyTrained: checked('obj-trained') }
    if (!obj.name) return toast('Bitte einen Namen eingeben.')
    if (!obj.short) obj.short = obj.name.split(' ')[0]
    if (id === 'new') data.objects.push(obj)
    else data.objects = data.objects.map((o) => (o.id === id ? obj : o))
    persist()
    closeModal()
    render()
  },
  'obj-delete': (el) => {
    if (ui.confirm !== 'obj-delete') {
      ui.confirm = 'obj-delete'
      renderModal()
      return
    }
    const id = el.dataset.id
    for (const t of data.tasks.filter((x) => x.objectId === id)) removeTaskEverywhere(t.id)
    data.objects = data.objects.filter((o) => o.id !== id)
    for (const e of data.employees) e.trained = (e.trained || []).filter((x) => x !== id)
    persist()
    closeModal()
    render()
  },
  'task-edit': (el) => {
    if (!data.objects.length) return toast('Bitte zuerst ein Objekt anlegen.')
    openModal({ type: 'task', id: el.dataset.id, objectId: el.dataset.obj })
  },
  'task-save': (el) => {
    const id = el.dataset.id
    const existing = id === 'new' ? { id: uid('t') } : data.tasks.find((t) => t.id === id)
    const task = readTaskForm(existing)
    if (!task.label) return toast('Bitte eine Bezeichnung eingeben.')
    if (task.recurrence.type === 'weekly' && !task.recurrence.weekdays.length) return toast('Bitte mindestens einen Wochentag wählen.')
    if (!task.start || !task.end) return toast('Bitte Beginn und Ende angeben.')
    if (id === 'new') data.tasks.push(task)
    else data.tasks = data.tasks.map((t) => (t.id === id ? task : t))
    persist()
    closeModal()
    render()
    toast(`Leistung „${task.label}“ gespeichert. Mit „Woche automatisch planen“ einteilen.`)
  },
  'task-delete': (el) => {
    if (ui.confirm !== 'task-delete') {
      ui.confirm = 'task-delete'
      renderModal()
      return
    }
    removeTaskEverywhere(el.dataset.id)
    persist()
    closeModal()
    render()
  },
  'abs-add': () => {
    const from = val('abs-from')
    const to = val('abs-to') || from
    if (!from || to < from) return toast('Bitte einen gültigen Zeitraum wählen.')
    data.absences.push({ id: uid('a'), employeeId: val('abs-emp'), type: val('abs-type'), from, to })
    persist()
    render()
    toast('Abwesenheit eingetragen. Betroffene Einsätze sind jetzt rot markiert.')
  },
  'abs-delete': (el) => {
    data.absences = data.absences.filter((a) => a.id !== el.dataset.id)
    persist()
    render()
  },
  'rules-save': () => {
    const rules = { ...data.rules, minor: { ...data.rules.minor } }
    for (const [, fields] of RULE_FIELDS) {
      for (const [key, , , type = 'number'] of fields) {
        const id = `rule-${key.replace('.', '-')}`
        const value = type === 'checkbox' ? checked(id) : type === 'time' ? val(id) : num(id)
        if (value === null || value === '') continue
        const [a, b] = key.split('.')
        if (b) rules[a][b] = value
        else rules[a] = value
      }
    }
    data.rules = rules
    ui.confirm = null
    persist()
    render()
    toast('Regeln gespeichert. Alle Markierungen wurden neu berechnet.')
  },
  'rules-reset': () => {
    if (!confirmStep('rules-reset')) return
    data.rules = { ...DEFAULT_RULES, minor: { ...DEFAULT_RULES.minor } }
    ui.confirm = null
    persist()
    render()
  },
  'freeday-add': () => {
    const date = val('free-date')
    if (!date) return toast('Bitte ein Datum wählen.')
    data.extraFreeDays = [...(data.extraFreeDays || []).filter((d) => d.date !== date), { date, name: val('free-name').trim() || 'betriebsfrei' }]
    persist()
    render()
  },
  'freeday-delete': (el) => {
    data.extraFreeDays = data.extraFreeDays.filter((d) => d.date !== el.dataset.date)
    persist()
    render()
  },
  'skills-save': () => {
    data.skills = val('skills-list').split(',').map((s) => s.trim()).filter(Boolean)
    persist()
    render()
    toast('Qualifikationen gespeichert.')
  },
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (!el || el.disabled) return
  const handler = ACTIONS[el.dataset.action]
  if (handler) handler(el, e)
})

document.addEventListener('change', (e) => {
  if (e.target.id === 'ts-employee') {
    ui.employeeId = e.target.value
    render()
  }
  if (e.target.dataset.toggle === 'rhythm') {
    for (const el of document.querySelectorAll('[data-rhythm]')) el.hidden = el.dataset.rhythm !== e.target.value
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.modal) closeModal()
})

render()
