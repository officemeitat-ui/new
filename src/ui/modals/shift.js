// Dialog zu einem Einsatz: Einteilung, "Wer kann einspringen?", Objektmappe
// und Änderungen nur für diese Woche.

import { addDays, eachDay, formatDate, formatHours, mondayOf } from '../../core/dates.js'
import { HOLIDAY_RULES } from '../../core/plan.js'
import { rankCandidates } from '../../core/scheduler.js'
import { addLog, app, empName, mutateAssignments, openModal, persist, registerActions, registerModal, renderNow, toast } from '../context.js'
import { esc, ICON, issueList, modalFrame, objectOf, val } from '../shared.js'
import { tripContext } from './trip.js'

function objectFolder(obj) {
  const keys = obj.keys || []
  if (!obj.instructions && !obj.contact && !keys.length) return ''
  return `<details class="folder"><summary>${ICON.key} Objektmappe</summary>
    ${obj.instructions ? `<p>${esc(obj.instructions)}</p>` : ''}
    ${obj.contact ? `<p class="note">Ansprechperson: ${esc(obj.contact)}</p>` : ''}
    ${keys.length ? `<p class="note">Schlüssel: ${keys.map((k) => `${esc(k.label)} – ${k.holderId ? esc(empName(k.holderId)) : 'im Büro'}`).join(' · ')}</p>` : ''}
  </details>`
}

function shiftModal(c, { key }) {
  const inst = c.state.instByKey.get(key)
  if (!inst) return null
  const obj = objectOf(c, inst)
  const task = app.data.tasks.find((t) => t.id === inst.taskId)
  const assigned = c.state.assigned(key)
  const staffingIssues = (c.validation.byShift.get(key) || []).filter((i) => i.scope === 'staffing')
  const tags = [
    `<span class="tag">${formatDate(inst.date, { year: true })}</span>`,
    `<span class="tag">${inst.startTime}–${inst.endTime}</span>`,
    `<span class="tag">${formatHours(inst.net)} h netto${inst.breakMin ? ` (−${inst.breakMin} min Pause)` : ''}</span>`,
    `<span class="tag">${inst.staff} ${inst.staff === 1 ? 'Person' : 'Personen'}</span>`,
    ...inst.skills.map((s) => `<span class="tag">benötigt: ${esc(s)}</span>`),
    task ? `<span class="tag">Feiertag: ${esc(HOLIDAY_RULES[task.holidayRule || 'entfaellt'])}</span>` : '',
    inst.category === 'sonder' ? '<span class="tag special">Sonderleistung</span>' : '',
    inst.holiday ? `<span class="pill info">${esc(inst.holiday.name)}</span>` : inst.isSunday ? '<span class="pill info">Sonntag</span>' : '',
    inst.status === 'moved' ? `<span class="pill warning">verschoben von ${formatDate(inst.origDate)}${inst.reason === 'holiday' ? ' (Feiertag)' : ''}</span>` : '',
    inst.status === 'cancelled' ? `<span class="pill info">entfällt${inst.reason === 'holiday' ? `: ${esc(inst.origHoliday?.name)}` : ' diese Woche'}</span>` : '',
  ].join('')

  const regularsNote = inst.regulars.length
    ? `<p class="note">Stammkraft: ${inst.regulars
        .map((id) => {
          const e = c.ctx.employeesById.get(id)
          if (!e) return ''
          const abs = c.ctx.absencesByEmployee.get(id)?.find((a) => inst.date >= a.from && inst.date <= a.to)
          const missing = !assigned.some((a) => a.employeeId === id)
          return `${esc(e.name)}${missing ? (abs ? ` (${esc(abs.type)})` : ' (nicht eingeteilt)') : ''}`
        })
        .join(', ')}</p>`
    : '<p class="note">Keine Stammkraft hinterlegt.</p>'

  const people = assigned
    .map((a) => {
      const e = c.ctx.employeesById.get(a.employeeId)
      if (!e) return ''
      const role = inst.regulars.includes(e.id) ? 'Stammkraft' : inst.regulars.length ? 'Vertretung' : 'eingeteilt'
      const issues = c.validation.cell.get(`${e.id}|${key}`) || []
      const t = tripContext(c, key, e.id)
      const trip = t?.trip
      const tripLine = trip ? `<button class="link-btn trip-line" data-action="open-trip" data-key="${esc(key)}" data-emp="${esc(e.id)}">${ICON.car} Fahrt danach: ${trip.minutes ? `${trip.minutes} min${t.next ? ` → ${esc(objectOf(c, t.next).short || '')}` : ''}` : 'keine'}${trip.note ? ` · ${esc(trip.note)}` : ''} <span class="muted">(planen)</span></button>` : ''
      return `<div class="person"><div class="pname">${esc(e.name)}<small>${role}${a.locked ? ' · fixiert' : ''}</small></div><div>${issueList(issues)}${tripLine}</div>
        <div class="acts edit-only"><button class="btn small" data-action="toggle-lock" data-key="${esc(key)}" data-emp="${esc(e.id)}">${a.locked ? 'Lösen' : 'Fixieren'}</button><button class="btn small danger" data-action="unassign" data-key="${esc(key)}" data-emp="${esc(e.id)}">Entfernen</button></div></div>`
    })
    .join('')

  let candidates = ''
  if (inst.status !== 'cancelled' && !app.readOnly) {
    const region = obj.region
    const list = rankCandidates(c.ctx, c.state, inst)
    candidates = `<section><h3>Wer kann einspringen?</h3><p class="note">Sortiert nach Eignung: Regeln, Verfügbarkeit, Wochenstunden, Einschulung, Revier, Wege. Rot heißt, die Einteilung würde gegen eine Regel verstoßen.</p>
      <div class="candidates">${list
        .map((cand) => {
          const errors = cand.issues.filter((i) => i.severity === 'error')
          const warnings = cand.issues.filter((i) => i.severity === 'warning')
          const status = errors.length ? ['error', 'Nicht möglich'] : warnings.length ? ['warning', cand.allowed ? 'Passt, prüfen' : 'Mit Vorbehalt'] : ['ok', 'Passt']
          const shown = [...errors, ...warnings, ...cand.issues.filter((i) => i.severity === 'info')].slice(0, 4)
          const otherTeam = region && cand.emp.team && cand.emp.team !== region
          return `<div class="person"><div class="pname">${esc(cand.emp.name)}<small>${cand.regular ? 'Stammkraft · ' : ''}${esc(cand.emp.team || cand.emp.type)}${otherTeam ? ' (anderes Revier)' : ''} · ${formatHours(cand.emp.weeklyHours * 60)} h</small><span class="pill ${status[0]}">${status[1]}</span></div>
            ${issueList(shown)}
            <div class="acts"><button class="btn small ${errors.length ? '' : 'primary'}" data-action="assign" data-key="${esc(key)}" data-emp="${esc(cand.emp.id)}">${errors.length ? 'Trotzdem einteilen' : 'Einteilen'}</button></div></div>`
        })
        .join('')}</div></section>`
  }

  const ov = app.data.overrides[key] || {}
  const weekDays = eachDay(mondayOf(inst.origDate), addDays(mondayOf(inst.origDate), 6))
  const edit = app.readOnly
    ? ''
    : `<details ${Object.keys(ov).length ? 'open' : ''}><summary>Nur diese Woche ändern</summary>
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
    subtitle: esc([obj.address, obj.region && !(obj.address || '').includes(obj.region) ? obj.region : ''].filter(Boolean).join(' · ')),
    color: obj.color,
    body: `<div class="meta">${tags}</div>
      ${staffingIssues.length ? issueList(staffingIssues) : ''}
      ${objectFolder(obj)}
      <section><h3>Eingeteilt (${assigned.length}/${inst.staff})</h3>${regularsNote}${people || '<p class="note">Noch niemand eingeteilt.</p>'}</section>
      ${candidates}${edit}`,
  })
}

registerModal('shift', shiftModal)

const instOf = (key) => app.cur.state.instByKey.get(key)
const label = (key) => {
  const inst = instOf(key)
  const obj = app.cur.ctx.objectsById.get(inst?.objectId)
  return `${obj?.short || obj?.name || 'Einsatz'} ${inst ? `${formatDate(inst.date)} ${inst.startTime}` : ''}`
}

registerActions({
  'open-shift': (el) => openModal({ type: 'shift', key: el.dataset.key }),
})

registerActions(
  {
    assign: (el) => {
      const { key, emp } = el.dataset
      mutateAssignments((s) => s.assign(emp, key, true), { date: instOf(key).origDate, text: `${empName(emp)} eingeteilt: ${label(key)}` })
      toast(`${empName(emp)} eingeteilt und fixiert.`)
    },
    unassign: (el) => {
      const { key, emp } = el.dataset
      mutateAssignments((s) => s.unassign(emp, key), { date: instOf(key).origDate, text: `${empName(emp)} entfernt: ${label(key)}` })
    },
    'toggle-lock': (el) => {
      const { key, emp } = el.dataset
      mutateAssignments((s) => s.setLocked(emp, key, !s.isLocked(emp, key)))
    },
    'ov-save': (el) => {
      const key = el.dataset.key
      const inst = instOf(key)
      const task = app.data.tasks.find((t) => t.id === inst.taskId)
      const ov = { ...(app.data.overrides[key] || {}) }
      const date = val('ov-date')
      ov.date = date !== inst.origDate || inst.status === 'moved' ? date : undefined
      ov.start = val('ov-start') !== task.start ? val('ov-start') : undefined
      ov.end = val('ov-end') !== task.end ? val('ov-end') : undefined
      ov.note = val('ov-note').trim() || undefined
      const clean = Object.fromEntries(Object.entries(ov).filter(([, v]) => v !== undefined && v !== false))
      if (Object.keys(clean).length) app.data.overrides[key] = clean
      else delete app.data.overrides[key]
      addLog(mondayOf(inst.origDate), `Einsatz geändert: ${label(key)} → ${formatDate(date)} ${val('ov-start')}–${val('ov-end')}`)
      persist()
      renderNow()
      toast('Änderung für diese Woche gespeichert.')
    },
    'ov-cancel': (el) => {
      const key = el.dataset.key
      const ov = { ...(app.data.overrides[key] || {}) }
      if (ov.cancelled) delete ov.cancelled
      else ov.cancelled = true
      if (Object.keys(ov).length) app.data.overrides[key] = ov
      else delete app.data.overrides[key]
      addLog(mondayOf(instOf(key).origDate), `${ov.cancelled ? 'Entfällt' : 'Wieder eingeplant'}: ${label(key)}`)
      persist()
      renderNow()
    },
    'ov-reset': (el) => {
      delete app.data.overrides[el.dataset.key]
      persist()
      renderNow()
    },
  },
  { edit: true },
)
