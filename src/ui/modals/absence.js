// Abwesenheits-Assistent: Urlaub oder Krankenstand eintragen und sofort sehen,
// welche Einsätze und Stunden neu zu planen sind. Fixobjekte gesammelt an eine
// Person übergeben, automatisch verteilen oder einzeln besetzen. Betrifft die
// Abwesenheit schon veröffentlichte Wochen (rückwirkend), wird dort die
// Korrektur fürs Zeitkonto und die Lohnverrechnung gebucht.

import { absenceImpact, handOver, isPeriodic, rankHandover, rhythmCategory } from '../../core/attention.js'
import { addDays, eachDay, formatDate, formatHours, isoWeek, isoWeekday, mondayOf, todayISO } from '../../core/dates.js'
import { PlanState } from '../../core/plan.js'
import { autoPlan, rankCandidates } from '../../core/scheduler.js'
import { addLog, app, compute, computeRange, empName, ensureRange, openModal, persist, plannedWeeks, registerActions, registerModal, renderNow, toast } from '../context.js'
import { changedEmployees, publishWeek } from '../planning.js'
import { ABSENCE_TYPES, esc, ICON, modalFrame, options, uid, val } from '../shared.js'

const absenceOf = (id) => (app.data.absences || []).find((a) => a.id === id)
const workdays = (a) => eachDay(a.from, a.to).filter((d) => isoWeekday(d) <= 5).length

/**
 * Einsätze und Stunden einer Abwesenheit. `state` ist der Plan ohne die
 * abwesende Person (wird gespeichert), `preview` zusätzlich mit den Stammkräften
 * in Wochen, die noch nicht eingeteilt sind: Vorschläge berücksichtigen so die
 * eigenen Fixobjekte der Vertretung.
 */
function analyse(a) {
  const r = computeRange(a.from, a.to)
  const state = new PlanState(r.instances, app.data.assignments)
  const impact = absenceImpact(r.ctx, r.instances, state, a)
  for (const row of impact.stillAssigned) state.unassign(a.employeeId, row.inst.key)
  const pending = impact.rows.filter((x) => !x.cancelled && x.open > 0).map((x) => x.inst)
  const planned = plannedWeeks()
  const unplanned = [...new Set(impact.rows.map((x) => mondayOf(x.inst.origDate)))].filter((m) => !planned.has(m)).sort()
  let preview = state
  if (unplanned.length) {
    const sim = autoPlan(r.ctx, r.instances, state.toObject(), { from: unplanned[0], to: addDays(unplanned.at(-1), 6), regularsOnly: true })
    preview = new PlanState(r.instances, sim.assignments)
  }
  return { r, state, preview, impact, pending, unplanned }
}

/** Unterschiede zwischen zwei Planständen auf den gespeicherten Plan übertragen. */
function applyChanges(state, before, after, lock) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = new Set((before[key] || []).map((x) => x.employeeId))
    const now = after[key] || []
    for (const id of was) if (!now.some((x) => x.employeeId === id)) state.unassign(id, key)
    for (const x of now) if (!was.has(x.employeeId)) state.assign(x.employeeId, key, lock || x.locked)
  }
}

// Vorschläge sind aufwendig (jede Person wird durchgerechnet): nur nach Änderungen neu berechnen.
let memo = { key: null }
function suggestions(a, an) {
  const key = `${app.dataVersion || 0}|${a.id}|${a.employeeId}|${a.from}|${a.to}`
  if (memo.key === key) return memo
  const emp = an.r.ctx.employeesById.get(a.employeeId)
  const ranking = app.readOnly ? [] : rankHandover(an.r.ctx, an.preview, an.pending, { excludeId: a.employeeId, team: emp?.team })
  const best = new Map(app.readOnly ? [] : an.pending.map((inst) => [inst.key, rankCandidates(an.r.ctx, an.preview, inst).find((x) => x.allowed) || null]))
  const weeks = [...new Set(an.impact.rows.map((x) => mondayOf(x.inst.origDate)))].sort()
  const published = weeks.filter((m) => app.data.published?.[m]).map((monday) => ({ monday, changed: changedEmployees(compute(monday)) }))
  memo = { key, ranking, best, weeks, published }
  return memo
}

// ---------------------------------------------------------------- Schnellerfassung

function absenceNewModal(c, { employeeId, date, absenceType }) {
  const from = date || c.monday
  return modalFrame({
    title: 'Abwesenheit eintragen',
    subtitle: 'Danach siehst du sofort, welche Einsätze und Stunden neu zu planen sind.',
    body: `<div class="form-grid">
        <label class="field"><span>Mitarbeiter:in</span><select id="absn-emp">${options(c.ctx.employees.map((e) => [e.id, e.name]), employeeId)}</select></label>
        <label class="field"><span>Art</span><select id="absn-type">${options(ABSENCE_TYPES.map((t) => [t, t]), absenceType || 'Krankenstand')}</select></label>
        <label class="field"><span>Von</span><input type="date" id="absn-from" value="${esc(from)}"></label>
        <label class="field"><span>Bis</span><input type="date" id="absn-to" value="${esc(from)}"></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="absn-note" placeholder="optional, z. B. Krankmeldung liegt vor"></label>
      </div>
      <p class="note">Auch rückwirkend möglich (z. B. nachgereichte Krankmeldung). Bereits veröffentlichte Wochen werden danach korrigiert.</p>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="absence-save">Eintragen und Vertretung planen</button></div>`,
  })
}

/** Abwesenheit speichern und den Assistenten öffnen. */
export async function addAbsence(entry) {
  if (!entry.from || !entry.to || entry.to < entry.from) return toast('Bitte einen gültigen Zeitraum wählen.')
  const overlap = (app.data.absences || []).find((a) => a.employeeId === entry.employeeId && a.from <= entry.to && a.to >= entry.from)
  const saved = { id: uid('a'), ...entry }
  app.data.absences.push(saved)
  addLog(mondayOf(entry.from), `Abwesenheit: ${empName(entry.employeeId)} ${entry.type} ${formatDate(entry.from)}–${formatDate(entry.to)}`)
  persist()
  await openImpact(saved.id)
  if (overlap) toast(`Hinweis: ${empName(entry.employeeId)} ist in diesem Zeitraum schon als ${overlap.type} eingetragen.`)
}

export async function openImpact(id) {
  const a = absenceOf(id)
  if (!a) return
  try {
    await ensureRange(a.from, a.to)
  } catch (err) {
    toast(`Wochen konnten nicht geladen werden: ${err.message}`)
  }
  renderNow()
  openModal({ type: 'absence-impact', absenceId: id })
}

// ---------------------------------------------------------------- Assistent

function statTile(label, value, sub = '', cls = '') {
  return `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
}

function impactModal(c, { absenceId }) {
  const a = absenceOf(absenceId)
  if (!a) return null
  const an = analyse(a)
  const { r, impact, pending } = an
  const emp = r.ctx.employeesById.get(a.employeeId)
  const today = todayISO()
  const sug = suggestions(a, an)
  const tasksById = new Map(app.data.tasks.map((t) => [t.id, t]))
  const active = impact.rows.filter((x) => !x.cancelled)
  const cancelled = impact.rows.filter((x) => x.cancelled)
  const retro = a.from < today
  const unplanned = an.unplanned
  const kw = (m) => `KW ${isoWeek(m).week}`

  const row = (x) => {
    const inst = x.inst
    const obj = r.ctx.objectsById.get(inst.objectId) || { name: 'Objekt', color: 10 }
    const task = tasksById.get(inst.taskId)
    const rhythm = task && isPeriodic(task) ? ` <span class="tag rhythm">${esc(rhythmCategory(task))}</span>` : ''
    const ov = app.data.overrides[inst.key]
    let status
    let action = ''
    if (x.cancelled) {
      status = `<span class="pill info">entfällt${inst.reason === 'holiday' ? ` (${esc(inst.origHoliday?.name || 'Feiertag')})` : ''}</span>`
      if (ov?.cancelled) action = `<button class="btn small" data-action="impact-cancel" data-key="${esc(inst.key)}" data-id="${esc(a.id)}">Wieder einplanen</button>`
    } else if (x.open === 0) {
      status = `<span class="pill ok name" title="Vertretung">${esc(x.covering.map(empName).join(', '))}</span>`
    } else {
      status = `${x.stillAssigned ? `<span class="pill error">noch eingeteilt${x.locked ? ', fixiert' : ''}</span>` : '<span class="pill error">offen</span>'}${unplanned.includes(mondayOf(inst.origDate)) ? ' <span class="pill info">Woche nicht eingeteilt</span>' : ''}`
      const best = sug.best.get(inst.key)
      const warn = best?.issues.filter((i) => i.severity === 'warning').map((i) => i.message).join('; ')
      action = `${best ? `<button class="btn small primary" data-action="impact-assign" data-key="${esc(inst.key)}" data-emp="${esc(best.emp.id)}" data-id="${esc(a.id)}" title="${esc(warn || 'passt ohne Einwände')}">${esc(best.emp.name)}${warn ? ' <span class="flag warning">!</span>' : ''}</button>` : '<span class="muted">kein regelkonformer Vorschlag</span>'}
        <button class="btn small" data-action="goto-shift" data-key="${esc(inst.key)}" data-date="${esc(inst.origDate)}" title="Einsatz öffnen: alle Kandidat:innen">Andere …</button>
        <button class="btn small" data-action="impact-cancel" data-key="${esc(inst.key)}" data-id="${esc(a.id)}" title="Einsatz entfällt in dieser Woche (z. B. mit Kunden vereinbart)">Entfällt</button>`
    }
    return `<tr class="${x.open > 0 && !x.cancelled ? 'row-open' : ''}"><td class="num">${formatDate(inst.date)}</td><td class="num">${inst.startTime}–${inst.endTime}</td>
      <td><span class="swatch" style="--obj:var(--o${obj.color})"></span>${esc(obj.name)}${rhythm}<br><span class="muted">${esc(inst.label)}${x.regular ? '' : ' · eingeteilt, nicht Stammkraft'}</span></td>
      <td class="num">${formatHours(inst.net)}</td><td>${status}</td><td class="edit-only impact-acts">${action}</td></tr>`
  }

  const notes = []
  if (retro) notes.push(`<p class="banner warn-banner"><strong>Rückwirkend.</strong> Die Abwesenheit beginnt vor heute. Trage ein, wer die Einsätze tatsächlich übernommen hat. ${esc(emp?.name || '')} bekommt die geplanten Stunden als ${esc(a.type)} angerechnet (Ausfallprinzip).</p>`)
  if (unplanned.length) notes.push(`<p class="note">${unplanned.map(kw).join(', ')} ${unplanned.length === 1 ? 'ist' : 'sind'} noch nicht eingeteilt. „Woche planen“ vertritt dort automatisch. Fixobjekte lassen sich hier schon vorab gezielt an eine Person übergeben.</p>`)

  const handover =
    pending.length && !app.readOnly
      ? `<section class="handover"><h3>${pending.length} ${pending.length === 1 ? 'Einsatz' : 'Einsätze'} (${formatHours(impact.openMinutes)} h) neu vergeben</h3>
        ${sug.ranking.length ? `<div class="inline-form">
          <label class="field grow"><span>Fixobjekte übergeben an</span><select id="impact-to">${sug.ranking
            .slice(0, 15)
            .map((x) => `<option value="${esc(x.emp.id)}">${esc(x.emp.name)}: ${x.done === pending.length ? 'alle' : `${x.done} von ${pending.length}`} Einsätze, ${formatHours(x.minutes)} h${x.overMinutes ? `, +${formatHours(x.overMinutes)} h über Vertrag` : ''}${x.sameTeam ? ' · gleiches Revier' : x.emp.team ? ` · ${esc(x.emp.team)}` : ''}</option>`)
            .join('')}</select></label>
          <button class="btn primary" data-action="impact-handover" data-id="${esc(a.id)}">${ICON.user} Übergeben</button>
          <button class="btn" data-action="impact-auto" data-id="${esc(a.id)}">${ICON.bolt} Automatisch verteilen</button>
          ${impact.stillAssigned.length ? `<button class="btn" data-action="impact-release" data-id="${esc(a.id)}">Nur austragen</button>` : ''}
        </div>
        <p class="note">Sortiert danach, wer die meisten Stunden regelkonform übernehmen kann (Ruhezeiten, Verfügbarkeit, Wege, Höchstarbeitszeit). Mehrstunden über den Vertrag sind bei der Übergabe erlaubt und werden im Plan markiert. Übergebene Einsätze sind fixiert.</p>` : '<p class="note">Niemand kann diese Einsätze ohne Regelverstoß gesammelt übernehmen. Bitte einzeln besetzen.</p>'}
      </section>`
      : ''

  const published = sug.published.length
    ? `<section><h3>Veröffentlichte Wochen</h3><ul class="plain">${sug.published
        .map(({ monday, changed }) => `<li class="pub-line"><span><strong>${kw(monday)}</strong> ist veröffentlicht${monday < mondayOf(today) ? ' (Vergangenheit)' : ''}: ${changed.length ? `${changed.length} ${changed.length === 1 ? 'Person' : 'Personen'} geändert (${esc(changed.map((e) => e.name).join(', '))})` : 'noch unverändert'}</span>
          ${changed.length ? `<button class="btn small primary edit-only" data-action="impact-publish" data-monday="${monday}" data-id="${esc(a.id)}">${ICON.send} Korrektur buchen</button>` : ''}</li>`)
        .join('')}</ul><p class="note">Die Korrektur übernimmt die neuen Salden ins Zeitkonto und listet die Unterschiede in der Monatsauswertung für die Lohnverrechnung.</p></section>`
    : ''

  return modalFrame({
    title: `${emp?.name || '?'}: ${a.type}`,
    subtitle: `${formatDate(a.from, { year: true })}${a.to !== a.from ? ` – ${formatDate(a.to, { year: true })}` : ''} · ${workdays(a)} ${workdays(a) === 1 ? 'Werktag' : 'Werktage'}${a.note ? ` · ${esc(a.note)}` : ''}`,
    wide: true,
    body: `<div class="impact-stats">
        ${statTile('Betroffen', `${formatHours(impact.minutes)} h`, `${active.length} ${active.length === 1 ? 'Einsatz' : 'Einsätze'}`)}
        ${statTile('Neu zu planen', `${formatHours(impact.openMinutes)} h`, `${pending.length} offen`, impact.openMinutes ? 'err' : '')}
        ${statTile('Vertreten', `${formatHours(impact.coveredMinutes)} h`, `${active.length - pending.length} besetzt`)}
        ${cancelled.length ? statTile('Entfällt', String(cancelled.length), 'Feiertag oder vereinbart') : ''}
      </div>
      ${notes.join('')}
      ${handover}
      ${impact.rows.length ? `<div class="table-wrap"><table class="data impact"><thead><tr><th>Tag</th><th>Zeit</th><th>Objekt</th><th>h</th><th>Besetzung</th><th class="edit-only">Vertretung</th></tr></thead><tbody>${impact.rows.map(row).join('')}</tbody></table></div>` : `<p class="empty">${esc(emp?.name || 'Die Person')} hat in diesem Zeitraum keine Einsätze.</p>`}
      ${published}`,
    foot: `<span class="muted">Änderungen werden sofort gespeichert.</span><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}

registerModal('absence-new', absenceNewModal)
registerModal('absence-impact', impactModal)

// ---------------------------------------------------------------- Aktionen

/** Plan im Zeitraum der Abwesenheit ändern, protokollieren und speichern. */
function changePlan(a, fn) {
  const an = analyse(a)
  const result = fn(an)
  app.data.assignments = an.state.toObject()
  persist()
  renderNow()
  return result
}

registerActions({
  'open-impact': (el) => openImpact(el.dataset.id),
})

registerActions(
  {
    'open-absence-new': (el) => openModal({ type: 'absence-new', employeeId: el.dataset.emp || app.ui.employeeId || '', date: el.dataset.date || '', absenceType: el.dataset.type || '' }),
    'absence-save': () => {
      const from = val('absn-from')
      const entry = { employeeId: val('absn-emp'), type: val('absn-type'), from, to: val('absn-to') || from }
      if (val('absn-note').trim()) entry.note = val('absn-note').trim()
      return addAbsence(entry)
    },
    'impact-release': (el) => {
      const a = absenceOf(el.dataset.id)
      const n = changePlan(a, (an) => an.impact.stillAssigned.length)
      addLog(mondayOf(a.from), `${empName(a.employeeId)} aus ${n} Einsätzen ausgetragen (${a.type})`)
      toast(`${empName(a.employeeId)} aus ${n} Einsätzen ausgetragen. Sie sind jetzt offen.`)
    },
    'impact-handover': (el) => {
      const a = absenceOf(el.dataset.id)
      const target = app.data.employees.find((e) => e.id === val('impact-to'))
      if (!a || !target) return
      const { done, skipped } = changePlan(a, (an) => {
        const res = handOver(an.r.ctx, an.preview, an.pending, an.r.ctx.employeesById.get(target.id), { locked: true })
        for (const inst of res.done) an.state.assign(target.id, inst.key, true)
        return res
      })
      const hours = formatHours(done.reduce((s, i) => s + i.net, 0))
      addLog(mondayOf(a.from), `Übergabe ${empName(a.employeeId)} → ${target.name}: ${done.length} Einsätze, ${hours} h (${a.type})`)
      toast(`${target.name} übernimmt ${done.length} Einsätze (${hours} h).${skipped.length ? ` ${skipped.length} nicht möglich: ${skipped[0].reasons[0]}` : ''}`)
    },
    'impact-auto': (el) => {
      const a = absenceOf(el.dataset.id)
      const res = changePlan(a, (an) => {
        if (!an.pending.length) return { filled: 0, open: 0 }
        const dates = an.pending.map((i) => i.date).sort()
        const before = an.preview.toObject()
        const out = autoPlan(an.r.ctx, an.r.instances, before, { from: dates[0], to: dates.at(-1), only: new Set(an.pending.map((i) => i.key)) })
        // Gewählte Vertretungen fixieren: die Woche gilt damit nicht als eingeteilt
        applyChanges(an.state, before, out.assignments, true)
        return { filled: an.pending.length - out.open.length, open: out.open.length }
      })
      addLog(mondayOf(a.from), `Vertretung automatisch verteilt (${empName(a.employeeId)}, ${a.type}): ${res.filled} besetzt, ${res.open} offen`)
      toast(`${res.filled} Einsätze verteilt.${res.open ? ` ${res.open} bleiben offen: einzeln besetzen.` : ''}`)
    },
    'impact-assign': (el) => {
      const a = absenceOf(el.dataset.id)
      const { key, emp } = el.dataset
      const inst = changePlan(a, (an) => {
        an.state.assign(emp, key, true)
        return an.state.instByKey.get(key)
      })
      addLog(mondayOf(inst.origDate), `Vertretung ${empName(emp)} statt ${empName(a.employeeId)}: ${app.data.objects.find((o) => o.id === inst.objectId)?.short || ''} ${formatDate(inst.date)} ${inst.startTime}`)
      toast(`${empName(emp)} eingeteilt.`)
    },
    'impact-cancel': (el) => {
      const a = absenceOf(el.dataset.id)
      const key = el.dataset.key
      const ov = { ...(app.data.overrides[key] || {}) }
      if (ov.cancelled) delete ov.cancelled
      else ov.cancelled = true
      if (Object.keys(ov).length) app.data.overrides[key] = ov
      else delete app.data.overrides[key]
      const task = app.data.tasks.find((t) => t.id === key.split('|')[1])
      addLog(mondayOf(key.slice(0, 10)), `${ov.cancelled ? 'Entfällt' : 'Wieder eingeplant'} (Abwesenheit ${empName(a?.employeeId)}): ${task?.label || ''} ${formatDate(key.slice(0, 10))}`)
      persist()
      renderNow()
    },
    'impact-publish': async (el) => {
      el.disabled = true
      try {
        const res = await publishWeek({ c: compute(el.dataset.monday) })
        toast(`Korrektur KW ${isoWeek(el.dataset.monday).week} gebucht${res.corrections ? `: ${res.corrections} Saldo-Änderungen` : ''}.`)
      } catch (err) {
        el.disabled = false
        toast(`Korrektur fehlgeschlagen: ${err.message}`)
      }
    },
  },
  { edit: true },
)

/** Kleine Schaltfläche für Ansichten: Abwesenheit melden (z. B. im Einsatz-Dialog). */
export function reportAbsenceButton({ emp = '', date = '', label = 'Abwesend melden', cls = 'btn small' } = {}) {
  return `<button class="${cls} edit-only" data-action="open-absence-new" data-emp="${esc(emp)}" data-date="${esc(date)}">${label}</button>`
}
