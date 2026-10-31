// Dialog zu einem Einsatz: Einteilung, "Wer kann einspringen?", Objektinfo
// und Änderungen nur für diese Woche.

import { addDays, eachDay, formatDate, formatHours, formatTime, mondayOf } from '../../core/dates.js'
import { DEFAULT_HOLIDAY_RULE, HOLIDAY_RULES } from '../../core/plan.js'
import { rankCandidates } from '../../core/scheduler.js'
import { dutyText } from '../../core/waste.js'
import { addLog, app, empName, mutateAssignments, objectHints, openModal, persist, recordUndo, mayEdit, registerActions, registerModal, renderNow, toast } from '../context.js'
import { esc, ICON, issueList, modalFrame, objectOf, reasonsHtml, val } from '../shared.js'
import { winterLogBlock } from '../winterlog.js'
import { tripContext } from './trip.js'

function objectFolder(obj) {
  const keys = obj.keys || []
  const waste = obj.waste?.streams?.length ? obj.waste.note || '' : ''
  if (!obj.instructions && !obj.contact && !keys.length && !waste) return ''
  return `<details class="folder"><summary>${ICON.key} Objektinfo</summary>
    ${obj.instructions ? `<p>${esc(obj.instructions)}</p>` : ''}
    ${obj.contact ? `<p class="note">Ansprechperson: ${esc(obj.contact)}</p>` : ''}
    ${waste ? `<p class="note">${ICON.trash} Müll: ${esc(waste)}</p>` : ''}
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
    task ? `<span class="tag">Feiertag: ${esc(HOLIDAY_RULES[task.holidayRule || DEFAULT_HOLIDAY_RULE])}</span>` : '',
    inst.category === 'sonder' ? '<span class="tag special">Sonderleistung</span>' : '',
    ...(inst.addOns || []).map((a) => `<span class="tag waste">${ICON.trash} ${esc(dutyText(a))} (+${a.minutes} min)</span>`),
    inst.category === 'muell' ? `<span class="tag waste">${ICON.trash} eigener Müll-Gang: kein passender Einsatz im Objekt</span>` : '',
    inst.category === 'winter' ? `<span class="tag winter">${ICON.snow} Winterdienst${inst.winterReason ? `: ${esc(inst.winterReason)}` : ''}</span>` : inst.outdoor ? '<span class="tag">Arbeit im Freien</span>' : '',
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
        <div class="acts edit-only"><button class="btn small" data-action="open-absence-new" data-emp="${esc(e.id)}" data-date="${esc(inst.date)}" title="Krank oder verhindert: Abwesenheit eintragen und alle betroffenen Einsätze neu planen">Abwesend</button><button class="btn small" data-action="toggle-lock" data-key="${esc(key)}" data-emp="${esc(e.id)}">${a.locked ? 'Lösen' : 'Fixieren'}</button><button class="btn small danger" data-action="unassign" data-key="${esc(key)}" data-emp="${esc(e.id)}">Entfernen</button></div></div>`
    })
    .join('')

  let candidates = ''
  if (inst.status !== 'cancelled' && mayEdit('planung')) {
    const region = obj.region
    const list = rankCandidates(c.ctx, c.state, inst)
    // Einsatz voll besetzt: Tauschen statt Ziehen (geht auch am Handy und Tablet)
    const swap = assigned.length >= inst.staff ? assigned.find((a) => !a.locked) || assigned[0] : null
    candidates = `<section><h3>Wer kann einspringen?</h3><p class="note">Sortiert nach Eignung: Regeln, Verfügbarkeit, freie Vertragsstunden, Zeitkonto, Revier, Einschulung, wer das Objekt kennt, Wege. Grün begründet den Vorschlag, Rot spricht dagegen.</p>
      <div class="candidates">${list
        .map((cand) => {
          const errors = cand.issues.filter((i) => i.severity === 'error')
          const warnings = cand.issues.filter((i) => i.severity === 'warning')
          const status = errors.length ? ['error', 'Nicht möglich'] : warnings.length ? ['warning', cand.allowed ? 'Passt, prüfen' : 'Mit Vorbehalt'] : ['ok', 'Passt']
          const shown = [...errors, ...warnings, ...cand.issues.filter((i) => i.severity === 'info')].slice(0, 4)
          const otherTeam = region && cand.emp.team && cand.emp.team !== region
          return `<div class="person"><div class="pname">${esc(cand.emp.name)}<small>${cand.regular ? 'Stammkraft · ' : ''}${esc(cand.emp.team || cand.emp.type)}${otherTeam ? ' (anderes Revier)' : ''} · ${formatHours(cand.emp.weeklyHours * 60)} h</small><span class="pill ${status[0]}">${status[1]}</span></div>
            <div>${errors.length ? '' : reasonsHtml(cand.factors)}${issueList(shown)}</div>
            <div class="acts">${swap ? `<button class="btn small ${errors.length ? '' : 'primary'}" data-action="assign" data-key="${esc(key)}" data-emp="${esc(cand.emp.id)}" data-replace="${esc(swap.employeeId)}" title="Einsatz von ${esc(empName(swap.employeeId))} übernehmen">${errors.length ? 'Trotzdem statt' : 'Statt'} ${esc(empName(swap.employeeId).split(' ')[0])}</button>` : ''}<button class="btn small ${errors.length || swap ? '' : 'primary'}" data-action="assign" data-key="${esc(key)}" data-emp="${esc(cand.emp.id)}">${errors.length ? 'Trotzdem einteilen' : swap ? 'Zusätzlich' : 'Einteilen'}</button></div></div>`
        })
        .join('')}</div></section>`
  }

  const ov = app.data.overrides[key] || {}
  const addOnMin = (inst.addOns || []).reduce((sum, a) => sum + a.minutes, 0)
  const weekDays = eachDay(mondayOf(inst.origDate), addDays(mondayOf(inst.origDate), 6))
  const edit = !mayEdit('planung')
    ? ''
    : `<details ${Object.keys(ov).length ? 'open' : ''}><summary>Nur diese Woche ändern</summary>
    <div class="form-grid">
      <label class="field"><span>Tag</span><select id="ov-date">${weekDays.map((d) => `<option value="${d}" ${d === inst.date ? 'selected' : ''}>${formatDate(d)}${c.holidays.get(d) ? ` (${esc(c.holidays.get(d).name)})` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Beginn</span><input type="time" id="ov-start" value="${esc(inst.startTime)}"></label>
      <label class="field"><span>Ende${addOnMin ? ` (ohne ${addOnMin} min Müll)` : ''}</span><input type="time" id="ov-end" value="${esc(formatTime(inst.end - addOnMin))}"></label>
      <label class="field wide"><span>Notiz auf dem Wochenzettel</span><input type="text" id="ov-note" value="${esc(ov.note || '')}" placeholder="z. B. Schlüssel beim Portier"></label>
    </div>
    <div class="actions" style="margin-top:10px">
      <button class="btn primary" data-action="ov-save" data-key="${esc(key)}">Übernehmen</button>
      ${inst.status === 'cancelled' && inst.reason === 'holiday' ? `<button class="btn" data-action="ov-work" data-key="${esc(key)}">Trotzdem stattfinden</button>` : `<button class="btn" data-action="ov-cancel" data-key="${esc(key)}">${ov.cancelled ? 'Wieder einplanen' : 'Entfällt diese Woche'}</button>`}
      ${Object.keys(ov).length ? `<button class="btn" data-action="ov-reset" data-key="${esc(key)}">Änderung zurücknehmen</button>` : ''}
    </div></details>`

  return modalFrame({
    title: `${obj.name}${inst.label ? ` – ${inst.label}` : ''}`,
    subtitle: esc([obj.address, obj.region && !(obj.address || '').includes(obj.region) ? obj.region : ''].filter(Boolean).join(' · ')),
    color: obj.color,
    body: `<div class="meta">${tags}</div>
      ${objectHints(obj.id).map((h) => `<div class="banner hint-banner"><p>${h}</p></div>`).join('')}
      ${inst.status === 'cancelled' && inst.reason === 'holiday' && mayEdit('planung') ? `<div class="banner"><p>${inst.origHoliday?.legal ? `Entfällt am Feiertag (${esc(inst.origHoliday.name)}), weil bei der Leistung „entfällt“ eingestellt ist.` : `Betrieb geschlossen: ${esc(inst.origHoliday?.name || 'betriebsfrei')}.`}</p><button class="btn primary" data-action="ov-work" data-key="${esc(key)}">Trotzdem stattfinden</button></div>` : ''}
      ${staffingIssues.length ? issueList(staffingIssues) : ''}
      ${objectFolder(obj)}
      <section><h3>Eingeteilt (${assigned.length}/${inst.staff})</h3>${regularsNote}${people || '<p class="note">Noch niemand eingeteilt.</p>'}</section>
      ${winterLogBlock(inst)}
      ${candidates}${edit}`,
  })
}

registerModal('shift', shiftModal, { module: 'planung' })

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
      const { key, emp, replace } = el.dataset
      mutateAssignments(
        (s) => {
          if (replace) s.unassign(replace, key)
          s.assign(emp, key, true)
        },
        { date: instOf(key).origDate, text: replace ? `${label(key)}: ${empName(replace)} → ${empName(emp)}` : `${empName(emp)} eingeteilt: ${label(key)}` },
      )
      toast(replace ? `${empName(emp)} übernimmt den Einsatz von ${empName(replace)}.` : `${empName(emp)} eingeteilt und fixiert.`)
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
      recordUndo('Einsatz geändert')
      const key = el.dataset.key
      const inst = instOf(key)
      const ov = { ...(app.data.overrides[key] || {}) }
      const date = val('ov-date')
      ov.date = date !== inst.origDate || inst.status === 'moved' ? date : undefined
      ov.start = val('ov-start') !== inst.baseStart ? val('ov-start') : undefined
      ov.end = val('ov-end') !== inst.baseEnd ? val('ov-end') : undefined
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
      recordUndo('Entfällt / wieder eingeplant')
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
    'ov-work': (el) => {
      recordUndo('Findet trotzdem statt')
      const key = el.dataset.key
      app.data.overrides[key] = { ...(app.data.overrides[key] || {}), work: true }
      addLog(mondayOf(instOf(key).origDate), `Findet trotzdem statt: ${label(key)}`)
      persist()
      renderNow()
      toast(`Der Einsatz findet statt${instOf(key)?.origHoliday?.legal ? ', mit Feiertagszuschlag' : ''}. Mit „Woche planen“ einteilen.`)
    },
    'ov-reset': (el) => {
      recordUndo('Änderung zurückgenommen')
      delete app.data.overrides[el.dataset.key]
      persist()
      renderNow()
    },
  },
  { edit: 'planung' },
)
