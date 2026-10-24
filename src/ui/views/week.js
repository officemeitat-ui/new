// Wochenübersicht: Mitarbeitende × Tage, offene Einsätze, Saldo, Zeitkonto.

import { formatHours } from '../../core/dates.js'
import { timeAccount } from '../../core/reports.js'
import { maxSeverity, SEVERITY_LABEL } from '../../core/rules.js'
import { app, registerView, renderNow } from '../context.js'
import { byStart, dayClass, dayHeads, esc, ICON, objectOf, options, saldoClass, signed } from '../shared.js'

const WEEK_FLAG = { CONTRACT: (i) => `+${formatHours(i.overMinutes)}`, WEEKLY_48: () => '>48', WEEKLY_MAX: () => '>60', WEEKLY_REST: () => '36h', MONTHLY_LIMIT: () => 'GFG' }

export function workChip(c, emp, line) {
  const inst = line.inst
  const obj = objectOf(c, inst)
  const issues = c.validation.cell.get(`${emp.id}|${inst.key}`) || []
  const sev = maxSeverity(issues)
  const flags = [
    line.substitute ? '<span class="flag sub" title="Vertretung">V</span>' : '',
    inst.status === 'moved' ? '<span class="flag sub" title="Verschoben">↷</span>' : '',
    c.state.isLocked(emp.id, inst.key) ? `<span class="flag lock" title="Fixiert">${ICON.lock}</span>` : '',
    sev ? `<span class="flag ${sev}">${sev === 'info' ? 'i' : '!'}</span>` : '',
  ].join('')
  const title = [`${obj.name}${inst.label ? ` – ${inst.label}` : ''}`, `${inst.startTime}–${inst.endTime}`, ...line.notes, ...issues.map((i) => `${SEVERITY_LABEL[i.severity]}: ${i.message}`)].join('\n')
  return `<button class="chip ${sev && sev !== 'info' ? `sev-${sev}` : ''} ${inst.category === 'sonder' ? 'special' : ''}" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(inst.key)}" title="${esc(title)}">
    <span class="chip-time">${inst.startTime}–${inst.endTime}</span><span class="chip-flags">${flags}</span><span class="chip-obj">${esc(obj.short || obj.name)}</span></button>`
}

export function struckChip(c, line) {
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

export function teams() {
  return [...new Set(app.data.employees.map((e) => e.team).filter(Boolean))].sort()
}

export function filteredEmployees(c) {
  const { team, search, onlyProblems } = app.ui
  const q = search.trim().toLowerCase()
  return c.ctx.employees.filter((e) => {
    if (team && e.team !== team) return false
    if (q && !e.name.toLowerCase().includes(q)) return false
    if (onlyProblems) {
      const hasIssue = c.validation.issues.some((i) => i.employeeId === e.id && i.severity !== 'info')
      if (!hasIssue && !c.changedSincePublish(e)) return false
    }
    return true
  })
}

export function filterBar(c, { problems = true } = {}) {
  const list = teams()
  return `<div class="toolbar filters-bar">
    ${list.length ? `<label class="field inline"><span>Revier</span><select id="f-team">${options(list.map((t) => [t, t]), app.ui.team, { empty: 'Alle Reviere' })}</select></label>` : ''}
    <label class="field inline"><span>Suche</span><input type="search" id="f-search" value="${esc(app.ui.search)}" placeholder="Name"></label>
    ${problems ? `<label class="check"><input type="checkbox" id="f-problems" ${app.ui.onlyProblems ? 'checked' : ''}><span>nur mit Markierungen oder Änderungen</span></label>` : ''}
  </div>`
}

function weekView(c) {
  if (!c.ctx.employees.length) return `<p class="empty">Noch keine Mitarbeitenden angelegt. <button class="btn small" data-action="view" data-view="staff">Mitarbeitende anlegen</button></p>`
  const team = app.ui.team
  const inTeam = (inst) => !team || c.ctx.objectsById.get(inst.objectId)?.region === team || inst.regulars.some((id) => c.ctx.employeesById.get(id)?.team === team)
  const openByDay = c.days.map((d) => c.week.filter((i) => i.date === d && i.status !== 'cancelled' && c.state.count(i.key) < i.staff && inTeam(i)).sort(byStart))
  const openTotal = openByDay.reduce((s, l) => s + l.reduce((t, i) => t + i.staff - c.state.count(i.key), 0), 0)
  const openRow = `<tr class="open-row"><th class="name-col">Offene Einsätze</th>${openByDay.map((list, i) => `<td class="${dayClass(c, c.days[i])}"><div class="cell-stack">${list.map((inst) => openChip(c, inst)).join('')}</div></td>`).join('')}<td class="sum">${openTotal ? `<strong>${openTotal} offen</strong>` : 'alles besetzt'}</td></tr>`
  const published = app.data.published || {}
  const employees = filteredEmployees(c)
  let lastTeam = null
  const rows = employees
    .map((emp) => {
      const ts = c.timesheet(emp)
      const cells = ts.days
        .map((day) => {
          const chips = day.lines.map((l) => (l.kind === 'work' ? workChip(c, emp, l) : struckChip(c, l))).join('')
          const abs = day.absence ? `<span class="abs-tag">${esc(day.absence.type)}</span>` : ''
          return `<td class="${dayClass(c, day.date)} ${day.absence ? 'absent' : ''}"><div class="cell-stack">${abs}${chips}</div></td>`
        })
        .join('')
      const t = ts.totals
      const account = timeAccount(emp, published, c.monday)
      const changed = c.changedSincePublish(emp)
      const groupRow = !team && emp.team && emp.team !== lastTeam ? `<tr class="group-row"><th class="name-col" colspan="1">${esc(emp.team)}</th><td colspan="8"></td></tr>` : ''
      lastTeam = emp.team
      return `${groupRow}<tr class="${changed ? 'row-changed' : ''}"><th class="name-col"><button class="emp-name" data-action="open-sheet" data-emp="${esc(emp.id)}" title="Wochenzettel öffnen">${esc(emp.name)}</button><span class="emp-meta">${esc(emp.type)} · ${formatHours(emp.weeklyHours * 60)} h${emp.minor ? ' · unter 18' : ''}${emp.note ? ` · ${esc(emp.note)}` : ''}</span>${changed ? '<span class="pill warning changed-pill" title="Nach dem Veröffentlichen geändert: Person informieren">geändert</span>' : ''}</th>${cells}
        <td class="sum"><div class="hours"><b>${formatHours(t.ist)}</b> / ${formatHours(t.soll)} h</div><div class="saldo ${saldoClass(t.saldo)}">Woche ${signed(t.saldo)}</div><div class="account" title="Zeitkonto: Startsaldo + veröffentlichte Wochen">Konto ${signed(account)}</div>${weekFlags(c, emp)}</td></tr>`
    })
    .join('')

  return `${filterBar(c)}
  <div class="grid-wrap"><table class="grid"><thead><tr><th class="name-col">Mitarbeiter:in <span class="muted">(${employees.length})</span></th>${dayHeads(c)}<th class="sum-col">Woche</th></tr></thead><tbody>${openRow}${rows || `<tr><td colspan="9" class="muted">Keine Treffer für den Filter.</td></tr>`}</tbody></table></div>
  <div class="legend">
    <span><span class="flag error">!</span> Verstoß</span><span><span class="flag warning">!</span> prüfen</span><span><span class="flag info">i</span> Hinweis (Zuschlag, Nachtarbeit)</span>
    <span><span class="flag sub">V</span> Vertretung</span><span><span class="flag sub">↷</span> verschoben</span><span><span class="flag lock">${ICON.lock}</span> fixiert</span>
    <span style="text-decoration:line-through">durchgestrichen</span><span>= entfällt (Stunden ggf. angerechnet)</span><span><span class="pill warning">geändert</span> nach Veröffentlichung geändert</span>
  </div>`
}

registerView({ id: 'week', order: 10, label: 'Wochenübersicht', group: 'plan', summary: true, render: weekView })

export function bindFilterEvents(target) {
  target.addEventListener('change', (e) => {
    if (e.target.id === 'f-team') {
      app.ui.team = e.target.value
      renderNow()
    } else if (e.target.id === 'f-problems') {
      app.ui.onlyProblems = e.target.checked
      renderNow()
    } else if (e.target.id === 'f-region') {
      app.ui.region = e.target.value
      renderNow()
    }
  })
  let t = null
  target.addEventListener('input', (e) => {
    if (e.target.id !== 'f-search') return
    clearTimeout(t)
    t = setTimeout(() => {
      app.ui.search = e.target.value
      renderNow()
      const el = document.getElementById('f-search')
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    }, 250)
  })
}
