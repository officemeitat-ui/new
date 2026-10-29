// Wochenübersicht: Mitarbeitende × Tage, offene Einsätze, Saldo, Zeitkonto.

import { employedInWeek } from '../../core/contract.js'
import { formatDate, formatHours, isoWeekday, todayISO, WEEKDAY_LONG, WEEKDAY_SHORT } from '../../core/dates.js'
import { timeAccount } from '../../core/reports.js'
import { maxSeverity, SEVERITY_LABEL } from '../../core/rules.js'
import { rankCandidates } from '../../core/scheduler.js'
import { dutyText } from '../../core/waste.js'
import { app, empName, mutateAssignments, registerView, renderNow, toast } from '../context.js'
import { isMobile } from '../mobile.js'
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
    inst.addOns?.length ? `<span class="flag waste" title="${esc(inst.addOns.map((a) => `${dutyText(a)} (+${a.minutes} min)`).join('\n'))}">${ICON.trash}</span>` : '',
    sev ? `<span class="flag ${sev}">${sev === 'info' ? 'i' : '!'}</span>` : '',
  ].join('')
  const title = [`${obj.name}${inst.label ? ` – ${inst.label}` : ''}`, `${inst.startTime}–${inst.endTime}`, ...line.notes, ...issues.map((i) => `${SEVERITY_LABEL[i.severity]}: ${i.message}`)].join('\n')
  return `<button class="chip ${sev && sev !== 'info' ? `sev-${sev}` : ''} ${inst.category === 'sonder' ? 'special' : ''}" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(inst.key)}" data-emp="${esc(emp.id)}" ${app.readOnly ? '' : 'draggable="true"'} title="${esc(title)}">
    <span class="chip-time">${inst.startTime}–${inst.endTime}</span><span class="chip-flags">${flags}</span><span class="chip-obj">${inst.category === 'muell' ? `${ICON.trash} ` : inst.category === 'winter' ? `${ICON.snow} ` : ''}${esc(obj.short || obj.name)}${inst.category === 'muell' ? ' · Müll' : inst.category === 'winter' ? ' · Winter' : ''}</span></button>`
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
  return `<button class="chip open" style="--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(inst.key)}" ${app.readOnly ? '' : 'draggable="true"'} title="${esc(`${obj.name} – ${inst.label}: ${missing} offen. Auf eine Person ziehen, um einzuteilen.`)}">
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
    // vor dem Eintritt bzw. nach dem Austritt nicht im Plan (außer es ist doch etwas eingeteilt)
    if (!employedInWeek(e, c.monday) && !c.validation.issues.some((i) => i.employeeId === e.id)) return false
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

// ---------------------------------------------------------------- Handy: Tagesliste

function mobileDay(c) {
  if (!c.days.includes(app.ui.mobileDay)) {
    const today = todayISO()
    app.ui.mobileDay = c.days.includes(today) ? today : c.days.find((d) => isoWeekday(d) <= 5 && !c.holidays.get(d)?.legal) || c.monday
  }
  return app.ui.mobileDay
}

/** Wochenübersicht fürs Handy: ein Tag, offene Einsätze oben, darunter je Person eine Karte. */
function mobileWeek(c) {
  const date = mobileDay(c)
  const team = app.ui.team
  const inTeam = (inst) => !team || c.ctx.objectsById.get(inst.objectId)?.region === team || inst.regulars.some((id) => c.ctx.employeesById.get(id)?.team === team)
  const openOf = (d) => c.week.filter((i) => i.date === d && i.status !== 'cancelled' && c.state.count(i.key) < i.staff && inTeam(i)).sort(byStart)
  const days = c.days
    .map((d) => {
      const n = openOf(d).length
      return `<button class="day-chip ${dayClass(c, d)}" data-action="m-day" data-date="${d}" aria-pressed="${d === date}"><span>${WEEKDAY_SHORT[isoWeekday(d) - 1]}</span><b>${d.slice(8)}</b>${n ? `<span class="flag error">${n}</span>` : ''}</button>`
    })
    .join('')
  const open = openOf(date)
  const holiday = c.holidays.get(date)
  const cards = []
  const free = []
  let lastTeam = null
  for (const emp of filteredEmployees(c)) {
    const ts = c.timesheet(emp)
    const day = ts.days.find((d) => d.date === date)
    if (!day.lines.length && !day.absence) {
      free.push(emp)
      continue
    }
    if (!team && emp.team && emp.team !== lastTeam) cards.push(`<h3 class="m-team">${esc(emp.team)}</h3>`)
    lastTeam = emp.team
    const t = ts.totals
    cards.push(`<article class="m-card ${day.absence ? 'absent' : ''} ${c.changedSincePublish(emp) ? 'row-changed' : ''}">
      <header><button class="emp-name" data-action="open-person" data-emp="${esc(emp.id)}">${esc(emp.name)}</button><span class="m-hours">${formatHours(t.ist)} / ${formatHours(t.soll)} h · <span class="saldo ${saldoClass(t.saldo)}">${signed(t.saldo)}</span></span></header>
      ${day.absence ? `<span class="abs-tag">${esc(day.absence.type)}</span>` : ''}
      <div class="m-chips">${day.lines.map((l) => (l.kind === 'work' ? workChip(c, emp, l) : struckChip(c, l))).join('')}</div>
    </article>`)
  }
  return `<div class="day-tabs" role="tablist" aria-label="Tag">${days}</div>
    <div class="m-swipe">
      <h2 class="m-date">${WEEKDAY_LONG[isoWeekday(date) - 1]}, ${formatDate(date, { weekday: false })}${holiday ? ` <span class="pill info">${esc(holiday.name)}</span>` : ''}</h2>
      ${filterBar(c, { problems: false })}
      ${open.length ? `<section class="m-open"><h3>Offen (${open.length})</h3><div class="m-chips">${open.map((inst) => openChip(c, inst)).join('')}</div><p class="note">Antippen: wer kann einspringen?</p></section>` : '<p><span class="pill ok">An diesem Tag alles besetzt</span></p>'}
      <section class="m-list">${cards.join('') || '<p class="empty">Niemand eingeteilt.</p>'}</section>
      ${free.length ? `<details class="m-free"><summary>Frei an diesem Tag (${free.length})</summary><p>${free.map((e) => `<button class="link-btn" data-action="open-person" data-emp="${esc(e.id)}">${esc(e.name)}</button>`).join(' · ')}</p></details>` : ''}
    </div>`
}

function weekView(c) {
  if (c.ctx.employees.length && isMobile()) return mobileWeek(c)
  if (!c.ctx.employees.length) return `<p class="empty">Noch keine Mitarbeitenden angelegt. <button class="btn small" data-action="view" data-view="staff">Mitarbeitende anlegen</button></p>`
  const team = app.ui.team
  const inTeam = (inst) => !team || c.ctx.objectsById.get(inst.objectId)?.region === team || inst.regulars.some((id) => c.ctx.employeesById.get(id)?.team === team)
  const openByDay = c.days.map((d) => c.week.filter((i) => i.date === d && i.status !== 'cancelled' && c.state.count(i.key) < i.staff && inTeam(i)).sort(byStart))
  const openTotal = openByDay.reduce((s, l) => s + l.reduce((t, i) => t + i.staff - c.state.count(i.key), 0), 0)
  const openRow = `<tr class="open-row"><th class="name-col">Offene Einsätze</th>${openByDay.map((list, i) => `<td class="${dayClass(c, c.days[i])}" data-drop="" data-date="${c.days[i]}"><div class="cell-stack">${list.map((inst) => openChip(c, inst)).join('')}</div></td>`).join('')}<td class="sum">${openTotal ? `<strong>${openTotal} offen</strong>` : 'alles besetzt'}</td></tr>`
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
          return `<td class="${dayClass(c, day.date)} ${day.absence ? 'absent' : ''}" data-drop="${esc(emp.id)}" data-date="${day.date}"><div class="cell-stack">${abs}${chips}</div></td>`
        })
        .join('')
      const t = ts.totals
      const account = timeAccount(emp, published, c.monday, app.data.payroll)
      const changed = c.changedSincePublish(emp)
      const groupRow = !team && emp.team && emp.team !== lastTeam ? `<tr class="group-row"><th class="name-col" colspan="1">${esc(emp.team)}</th><td colspan="8"></td></tr>` : ''
      lastTeam = emp.team
      return `${groupRow}<tr class="${changed ? 'row-changed' : ''}"><th class="name-col"><button class="emp-name" data-action="open-person" data-emp="${esc(emp.id)}" title="Dienstplan der Person: Woche, feste Objekte, Objekte zuweisen">${esc(emp.name)}</button><span class="emp-meta">${esc(emp.type)} · ${formatHours(emp.weeklyHours * 60)} h${emp.minor ? ' · unter 18' : ''}${emp.note ? ` · ${esc(emp.note)}` : ''}</span>${changed ? '<span class="pill warning changed-pill" title="Nach dem Veröffentlichen geändert: Person informieren">geändert</span>' : ''}</th>${cells}
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

// ---------------------------------------------------------------- Ziehen und Ablegen

/**
 * Einsatz von einer Person auf eine andere ziehen (gleicher Tag). Beim
 * Ziehen zeigt jede Zelle, ob die Person passt: grün, gelb (prüfen) oder rot
 * (Regelverstoß). Auf „Offene Einsätze“ ziehen trägt die Person aus.
 */
export function bindDragEvents(target) {
  let drag = null
  const clear = () => {
    for (const td of document.querySelectorAll('td.drop-ok, td.drop-warn, td.drop-err, td.drop-hover')) {
      td.classList.remove('drop-ok', 'drop-warn', 'drop-err', 'drop-hover')
      td.removeAttribute('data-why')
    }
    document.body.classList.remove('dragging')
  }
  target.addEventListener('dragstart', (e) => {
    const chip = e.target.closest?.('.chip[draggable="true"]')
    const c = app.cur
    const inst = chip && c?.state.instByKey.get(chip.dataset.key)
    if (!inst || app.readOnly) return
    drag = { key: inst.key, from: chip.dataset.emp || '', inst }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', inst.key)
    const verdict = new Map(rankCandidates(c.ctx, c.state, inst).map((x) => [x.emp.id, x]))
    for (const td of document.querySelectorAll(`td[data-drop][data-date="${inst.date}"]`)) {
      const id = td.dataset.drop
      if (!id) {
        if (drag.from) td.classList.add('drop-ok')
        continue
      }
      const v = verdict.get(id)
      if (!v || id === drag.from) continue
      const errors = v.issues.filter((i) => i.severity === 'error')
      const warnings = v.issues.filter((i) => i.severity === 'warning')
      td.classList.add(errors.length ? 'drop-err' : v.allowed && !warnings.length ? 'drop-ok' : 'drop-warn')
      td.dataset.why = (errors[0] || warnings[0])?.message || ''
    }
    document.body.classList.add('dragging')
  })
  target.addEventListener('dragover', (e) => {
    const td = e.target.closest?.('td.drop-ok, td.drop-warn, td.drop-err')
    if (!drag || !td) return
    e.preventDefault()
    e.dataTransfer.dropEffect = td.classList.contains('drop-err') ? 'none' : 'move'
    for (const other of document.querySelectorAll('td.drop-hover')) if (other !== td) other.classList.remove('drop-hover')
    td.classList.add('drop-hover')
  })
  target.addEventListener('drop', (e) => {
    const td = e.target.closest?.('td[data-drop]')
    if (!drag || !td) return
    e.preventDefault()
    const { key, from, inst } = drag
    const to = td.dataset.drop
    const label = `${app.cur.ctx.objectsById.get(inst.objectId)?.short || 'Einsatz'} ${inst.startTime}`
    const err = td.classList.contains('drop-err')
    const ok = td.classList.contains('drop-ok') || td.classList.contains('drop-warn')
    const why = td.dataset.why
    clear()
    drag = null
    if (err) return toast(`${empName(to)}: ${why}. Wenn es trotzdem sein muss: Einsatz öffnen, „Trotzdem einteilen“.`)
    if (!ok) return
    if (!to) {
      mutateAssignments((s) => s.unassign(from, key), { date: inst.origDate, text: `${empName(from)} ausgetragen: ${label}` })
      return toast(`${empName(from)} ausgetragen: ${label} ist jetzt offen.`)
    }
    mutateAssignments(
      (s) => {
        if (from) s.unassign(from, key)
        s.assign(to, key, true)
      },
      { date: inst.origDate, text: from ? `${label}: ${empName(from)} → ${empName(to)}` : `${empName(to)} eingeteilt: ${label}` },
    )
    toast(from ? `${label} an ${empName(to)} übergeben.${why ? ` Prüfen: ${why}` : ''}` : `${empName(to)} eingeteilt: ${label}.${why ? ` Prüfen: ${why}` : ''}`)
  })
  target.addEventListener('dragend', () => {
    clear()
    drag = null
  })
}
