// Zeitlinie: ein Tag, je Person eine Zeile mit Einsätzen (Objektfarbe) und
// geplanten Fahrten (schraffiert). Lücken zeigen, wer noch Zeit hat; rote
// Fahrten passen nicht bis zum nächsten Einsatz.

import { dayIndex, formatDate, formatHours, formatTime, isoWeekday, todayISO, WEEKDAY_LONG, WEEKDAY_SHORT } from '../../core/dates.js'
import { absMinutes } from '../../core/timeclock.js'
import { dayTrips, firstAfterDay, maxSeverity } from '../../core/rules.js'
import { app, canEdit, openModal, registerActions, registerView, renderNow } from '../context.js'
import { appointmentColor, appointmentLocation, appointmentsOfDay } from './appointments.js'
import { byStart, esc, ICON, objectOf } from '../shared.js'
import { filterBar, filteredEmployees } from './week.js'

const pct = (min, axis) => ((min - axis.from) / (axis.to - axis.from)) * 100

/** Überlappende Balken auf Spuren verteilen, damit nichts verdeckt wird. */
function lanes(blocks) {
  const ends = []
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    let lane = ends.findIndex((e) => e <= b.start)
    if (lane < 0) lane = ends.length
    ends[lane] = b.end
    b.lane = lane
  }
  return Math.max(1, ends.length)
}

function currentDay(c) {
  if (!c.days.includes(app.ui.timelineDay)) app.ui.timelineDay = c.days.find((d) => isoWeekday(d) <= 5 && !c.holidays.get(d)?.legal) || c.monday
  return app.ui.timelineDay
}

function blockHtml(c, b, axis) {
  const style = `left:${pct(b.start, axis)}%;width:${Math.max(0.4, pct(b.end, axis) - pct(b.start, axis))}%;top:calc(${b.lane} * var(--lane))`
  if (b.kind === 'appt') {
    const a = b.appt
    const where = appointmentLocation(a)
    return `<button class="tl-appt" style="${style};--obj:var(--o${appointmentColor(a)})" data-action="appt-open" data-id="${esc(a.id)}" title="${esc(`Termin: ${a.title}\n${formatTime(b.start % 1440)}–${formatTime(b.end % 1440)}${where ? `\n${where}` : ''}`)}">${ICON.calendar}<span>${esc(a.title)}</span></button>`
  }
  if (b.kind === 'stamp') {
    const st = b.stamp
    const title = `Ist-Zeit: ${formatTime(b.start % 1440)}–${st.out ? formatTime(b.end % 1440) : 'noch da'}${st.objectName ? `\n${st.objectName}` : ''}`
    return `<span class="tl-stamp ${st.out ? '' : 'open'}" style="left:${pct(b.start, axis)}%;width:${Math.max(0.4, pct(b.end, axis) - pct(b.start, axis))}%" title="${esc(title)}"></span>`
  }
  if (b.kind === 'trip') {
    const to = b.trip.to ? objectOf(c, b.trip.to).short : 'Rückfahrt'
    const title = `Fahrt ${b.trip.minutes} min → ${to}${b.trip.note ? `\n${b.trip.note}` : ''}${b.conflict ? '\nPasst nicht bis zum nächsten Einsatz' : ''}`
    return `<button class="tl-trip ${b.conflict ? 'conflict' : ''}" style="${style}" data-action="open-trip" data-key="${esc(b.inst.key)}" data-emp="${esc(b.empId)}" title="${esc(title)}"><span>${ICON.car}${b.trip.minutes}${b.trip.note ? ' ·' : ''}</span></button>`
  }
  const obj = objectOf(c, b.inst)
  const sev = b.issues ? maxSeverity(b.issues.filter((i) => i.severity !== 'info')) : null
  const cls = ['tl-block', b.kind === 'struck' ? 'struck' : '', b.kind === 'open' ? 'open' : '', sev ? `sev-${sev}` : '', b.inst.category === 'sonder' ? 'special' : ''].join(' ')
  const title = `${obj.name}${b.inst.label ? ` – ${b.inst.label}` : ''}\n${b.inst.startTime}–${b.inst.endTime}${b.kind === 'struck' ? '\nentfällt' : ''}${b.issues?.length ? `\n${b.issues.map((i) => i.message).join('\n')}` : ''}`
  return `<button class="${cls}" style="${style};--obj:var(--o${obj.color})" data-action="open-shift" data-key="${esc(b.inst.key)}" title="${esc(title)}"><span class="tl-time">${b.inst.startTime}</span> <span class="tl-obj">${esc(obj.short || obj.name)}</span>${sev ? `<span class="flag ${sev}">!</span>` : ''}</button>`
}

function row({ name, meta, blocks, axis, c, cls = '', note = '', empId = '', date = '' }) {
  const bars = blocks.filter((b) => b.kind !== 'stamp')
  const stamps = blocks.filter((b) => b.kind === 'stamp')
  const n = lanes(bars)
  // freie Fläche anklicken: Termin zu dieser Zeit (für diese Person) anlegen
  const add = canEdit('termine') && date ? `data-action="tl-add" data-date="${date}" data-emp="${esc(empId)}" data-from="${axis.from}" data-to="${axis.to}" title="Klicken: Termin zu dieser Zeit anlegen"` : ''
  return `<div class="tl-row ${cls}" style="--lanes:${n}"><div class="tl-name">${name}${meta ? `<small>${meta}</small>` : ''}</div><div class="tl-track" ${add}>${note ? `<span class="tl-note">${esc(note)}</span>` : ''}${bars.map((b) => blockHtml(c, b, axis)).join('')}${stamps.map((b) => blockHtml(c, b, axis)).join('')}</div></div>`
}

function timelineView(c) {
  const date = currentDay(c)
  const base = dayIndex(date) * 1440
  const employees = filteredEmployees(c)
  const rows = []
  let min = base + 6 * 60
  let max = base + 20 * 60
  const span = (s, e) => {
    min = Math.min(min, s)
    max = Math.max(max, e)
  }

  // Offene Einsätze des Tages
  const team = app.ui.team
  const open = c.week
    .filter((i) => i.date === date && i.status !== 'cancelled' && c.state.count(i.key) < i.staff)
    .filter((i) => !team || c.ctx.objectsById.get(i.objectId)?.region === team || i.regulars.some((id) => c.ctx.employeesById.get(id)?.team === team))
    .map((inst) => ({ kind: 'open', inst, start: inst.start, end: inst.end }))
  open.forEach((b) => span(b.start, b.end))

  // Termine des Tages: bei den Personen, sonst in der Zeile „Termine“
  const appts = appointmentsOfDay(date)
  const apptBlock = (x) => ({ kind: 'appt', appt: x.a, start: base + x.start, end: base + x.end })
  const timed = appts.filter((x) => !x.allDay)
  timed.forEach((x) => span(base + x.start, base + x.end))
  const allDayText = appts.filter((x) => x.allDay).map((x) => x.a.title)
  // Ist-Zeiten (Zeiterfassung im Objekt) als feine Linie unter den Einsätzen
  const stampsOf = new Map()
  for (const st of Object.values(app.data.stamps || {})) {
    if (st.date !== date || !st.empId || !st.in) continue
    const start = absMinutes(st.in)
    const end = st.out ? absMinutes(st.out) : Math.max(start + 5, date === todayISO() ? absMinutes(new Date().toISOString()) : start + 5)
    if (!stampsOf.has(st.empId)) stampsOf.set(st.empId, [])
    stampsOf.get(st.empId).push({ kind: 'stamp', stamp: st, start, end })
  }

  for (const emp of employees) {
    const ts = c.timesheet(emp)
    const day = ts.days.find((d) => d.date === date)
    const work = c.state.instancesOf(emp.id).filter((i) => i.date === date).sort(byStart)
    const blocks = []
    for (const inst of work) blocks.push({ kind: 'work', inst, start: inst.start, end: inst.end, issues: c.validation.cell.get(`${emp.id}|${inst.key}`) || [] })
    for (const trip of dayTrips(work, c.ctx, emp.id, firstAfterDay(c.state.instancesOf(emp.id), date))) {
      if (trip.minutes <= 0) continue
      const start = trip.from.end
      const end = start + trip.minutes
      blocks.push({ kind: 'trip', inst: trip.from, empId: emp.id, trip, start, end, conflict: !!trip.to && trip.to.start < end })
    }
    for (const l of day?.lines || []) if (l.kind === 'missed') blocks.push({ kind: 'struck', inst: l.inst, start: l.inst.start, end: l.inst.end })
    for (const x of timed) if (x.employeeIds.includes(emp.id)) blocks.push(apptBlock(x))
    blocks.push(...(stampsOf.get(emp.id) || []))
    blocks.forEach((b) => span(b.start, b.end))
    const workMin = work.reduce((s, i) => s + i.net, 0)
    const travelMin = blocks.filter((b) => b.kind === 'trip').reduce((s, b) => s + b.trip.minutes, 0)
    const meta = workMin ? `${formatHours(workMin)} h${travelMin ? ` + ${formatHours(travelMin)} h Fahrt` : ''}` : day?.absence ? esc(day.absence.type) : 'frei'
    const personAllDay = appts.filter((x) => x.allDay && x.employeeIds.includes(emp.id)).map((x) => x.a.title)
    rows.push({ empId: emp.id, name: `<button class="emp-name" data-action="open-person" data-emp="${esc(emp.id)}">${esc(emp.name)}</button>`, meta, blocks, cls: `${day?.absence ? 'absent' : ''} ${workMin || blocks.some((b) => b.kind === 'appt') ? '' : 'idle'}`, note: day?.absence ? day.absence.type : personAllDay.join(' · ') })
  }
  const shown = new Set(employees.map((e) => e.id))
  const companyAppts = timed.filter((x) => !x.employeeIds.some((id) => shown.has(id))).map(apptBlock)

  const axis = { from: Math.floor(min / 60) * 60, to: Math.ceil(max / 60) * 60 }
  const hours = (axis.to - axis.from) / 60
  const ticks = Array.from({ length: hours + 1 }, (_, i) => axis.from + i * 60)
    .map((m, i) => `<span class="tl-tick" style="left:${(i / hours) * 100}%">${formatTime(m).slice(0, 2)}</span>`)
    .join('')
  const night = [
    [axis.from, Math.min(axis.to, base + 5 * 60)],
    [Math.max(axis.from, base + 22 * 60), axis.to],
  ]
    .filter(([a, b]) => b > a)
    .map(([a, b]) => `<span class="tl-night" style="left:${pct(a, axis)}%;width:${pct(b, axis) - pct(a, axis)}%"></span>`)
    .join('')

  const holiday = c.holidays.get(date)
  const dayTabs = c.days
    .map((d) => `<button class="filter ${c.holidays.get(d) ? 'has-holiday' : ''}" data-action="timeline-day" data-date="${d}" aria-pressed="${d === date}" title="${esc(c.holidays.get(d)?.name || '')}">${WEEKDAY_SHORT[isoWeekday(d) - 1]} ${d.slice(8)}.</button>`)
    .join('')
  const openRow = open.length ? row({ name: '<strong class="err-text">Offen</strong>', meta: `${open.length} Einsatz${open.length === 1 ? '' : 'e'}`, blocks: open, axis, c, cls: 'open-line' }) : ''
  const apptRow = companyAppts.length || allDayText.length || canEdit('termine') ? row({ name: `<button class="emp-name" data-action="view" data-view="termine">Termine</button>`, meta: allDayText.length ? esc(allDayText.join(' · ')) : companyAppts.length ? `${companyAppts.length} ohne Person` : '', blocks: companyAppts, axis, c, cls: 'appt-line', date }) : ''
  const nowMin = date === todayISO() ? absMinutes(new Date().toISOString()) : null
  const nowLine = nowMin !== null && nowMin > axis.from && nowMin < axis.to ? `<span class="tl-now" style="left:${pct(nowMin, axis)}%"></span>` : ''

  return `<div class="section-head"><div><h2>Zeitlinie ${WEEKDAY_LONG[isoWeekday(date) - 1]}, ${formatDate(date, { weekday: false, year: true })}${holiday ? ` <span class="pill info">${esc(holiday.name)}</span>` : ''}</h2>
      <p>Einsätze, Termine, Fahrten und Ist-Zeiten jeder Person über den Tag. Eine Fahrt anklicken, um Dauer und Notiz zu planen; rote Fahrten passen nicht bis zum nächsten Einsatz. Leere Zeilen zeigen, wer für Vertretungen Zeit hat.${canEdit('termine') ? ' In eine freie Stelle klicken legt einen Termin für diese Person zu dieser Zeit an.' : ''}</p></div></div>
    <div class="filters">${dayTabs}</div>
    ${filterBar(c)}
    <div class="tl-wrap"><div class="tl" style="--hours:${hours}">
      <div class="tl-row tl-head"><div class="tl-name"></div><div class="tl-track tl-axis">${ticks}</div></div>
      <div class="tl-body"><div class="tl-overlay">${night}${nowLine}</div>${openRow}${apptRow}${rows.map((r) => row({ ...r, axis, c, date })).join('')}</div>
    </div></div>
    <div class="legend"><span><span class="tl-key work"></span> Einsatz (Objektfarbe)</span><span><span class="tl-key trip"></span> Fahrt</span><span><span class="tl-key trip conflict"></span> Fahrt passt nicht</span><span><span class="tl-key struck"></span> entfällt</span><span><span class="tl-key appt"></span> Termin</span><span><span class="tl-key stamp"></span> Ist-Zeit (Zeiterfassung)</span><span><span class="tl-key night"></span> Nachtzeit 22–5 Uhr</span></div>`
}

registerView({ id: 'timeline', order: 15, label: 'Zeitlinie', group: 'plan', render: timelineView })

registerActions({
  'tl-add': (el, e) => {
    if (e?.target !== el || !canEdit('termine')) return // Klick auf einen Balken
    const r = el.getBoundingClientRect()
    const from = Number(el.dataset.from)
    const to = Number(el.dataset.to)
    const at = from + Math.floor((((e.clientX - r.left) / r.width) * (to - from)) / 15) * 15
    const m = ((at % 1440) + 1440) % 1440
    openModal({ type: 'appt', date: el.dataset.date, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, employeeId: el.dataset.emp || '' })
    setTimeout(() => document.getElementById('ap-title')?.focus(), 30)
  },
  'timeline-day': (el) => {
    app.ui.timelineDay = el.dataset.date
    renderNow()
  },
})
