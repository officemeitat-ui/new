// Vertretungs-Cockpit: Abwesenheiten der Woche mit den betroffenen
// Einsätzen, Vorschlag je Einsatz und Übernahme mit einem Klick.

import { formatDate } from '../../core/dates.js'
import { rankCandidates } from '../../core/scheduler.js'
import { app, empName, memo, mutateAssignments, registerActions, registerView, toast } from '../context.js'
import { planWeek } from '../planning.js'
import { byStart, esc, ICON, objectOf, reasonsHtml } from '../shared.js'

function suggestion(c, inst) {
  // je Berechnung einmal: weitere Zeichnungen ohne Datenänderung kosten nichts
  return memo(c, `cover:${inst.key}`, () => rankCandidates(c.ctx, c.state, inst).find((x) => x.allowed) || null)
}

function row(c, inst, reason, absentId = null) {
  const obj = objectOf(c, inst)
  const ids = c.state.assigned(inst.key).map((a) => a.employeeId)
  const blocked = absentId && ids.includes(absentId) ? absentId : null
  const working = ids.filter((id) => id !== blocked)
  const open = inst.staff - working.length
  const best = open > 0 && !app.readOnly ? suggestion(c, inst) : null
  const status = blocked
    ? `<span class="pill error">${esc(empName(blocked))} abwesend, aber eingeteilt</span>`
    : open > 0
      ? `<span class="pill error">${open} offen</span>`
      : `<span class="pill ok name">${esc(working.map(empName).join(', '))}</span>`
  const label = best ? (blocked ? `${best.emp.name} statt ${empName(blocked).split(' ')[0]}` : `${best.emp.name} einteilen`) : ''
  return `<tr>
    <td class="num">${formatDate(inst.date)}</td><td class="num">${inst.startTime}–${inst.endTime}</td>
    <td><span class="swatch" style="--obj:var(--o${obj.color})"></span><button class="link-btn" data-action="open-shift" data-key="${esc(inst.key)}">${esc(obj.name)}</button><br><span class="muted">${esc(inst.label)}</span></td>
    <td>${esc(reason)}</td>
    <td>${status}</td>
    <td>${best ? `<button class="btn small primary edit-only" data-action="cover-take" data-key="${esc(inst.key)}" data-emp="${esc(best.emp.id)}" data-replace="${esc(blocked || '')}">${esc(label)}</button><br>${reasonsHtml(best.factors, { good: 2, bad: 1 })}${best.issues.some((i) => i.severity === 'warning') ? `<br><span class="muted">${esc(best.issues.filter((i) => i.severity === 'warning').map((i) => i.message).join('; '))}</span>` : ''}` : open > 0 ? '<span class="muted">kein regelkonformer Vorschlag, Einsatz öffnen</span>' : ''}</td>
  </tr>`
}

function coverageView(c) {
  const absent = (app.data.absences || []).filter((a) => a.from <= c.sunday && a.to >= c.monday).sort((a, b) => a.from.localeCompare(b.from))
  const handled = new Set()
  const blocks = absent
    .map((a) => {
      const insts = c.week.filter((i) => i.status !== 'cancelled' && (i.regulars.includes(a.employeeId) || c.state.has(a.employeeId, i.key)) && i.date >= a.from && i.date <= a.to).sort(byStart)
      insts.forEach((i) => handled.add(i.key))
      const emp = c.ctx.employeesById.get(a.employeeId)
      return `<section class="cover-block"><h3>${esc(emp?.name || '?')} · ${esc(a.type)} <span class="muted">${formatDate(a.from)} – ${formatDate(a.to)}</span> <button class="btn small edit-only" data-action="open-impact" data-id="${esc(a.id)}">${ICON.user} Gesamten Zeitraum planen / übergeben</button></h3>
        ${insts.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Tag</th><th>Zeit</th><th>Objekt</th><th>Grund</th><th>Besetzung</th><th>Vorschlag</th></tr></thead><tbody>${insts.map((i) => row(c, i, `Stammkraft ${a.type}`, a.employeeId)).join('')}</tbody></table></div>` : '<p class="note">Keine Stammeinsätze in dieser Woche betroffen.</p>'}</section>`
    })
    .join('')
  const otherOpen = c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday && c.state.count(i.key) < i.staff && !handled.has(i.key)).sort(byStart)
  const absentAssigned = c.validation.issues.filter((i) => i.code === 'ABSENT').length
  const openCount = c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && c.state.count(i.key) < i.staff).length + absentAssigned
  return `<div class="section-head"><div><h2>Vertretungen</h2><p>Wer fehlt diese Woche, welche Einsätze sind betroffen und wer kann regelkonform einspringen. Vorschläge berücksichtigen Revier, Einschulung, Wochenstunden, Ruhezeiten und Wege.</p></div>
    <div class="actions"><button class="btn edit-only" data-action="open-absence-new">${ICON.plus} Abwesenheit eintragen</button>${openCount ? `<button class="btn primary edit-only" data-action="cover-all">Alle ${openCount} offenen Einsätze automatisch besetzen</button>` : ''}</div></div>
    ${blocks || '<p class="empty">Keine Abwesenheiten in dieser Woche.</p>'}
    ${otherOpen.length ? `<section class="cover-block"><h3>Weitere offene Einsätze</h3><div class="table-wrap"><table class="data"><thead><tr><th>Tag</th><th>Zeit</th><th>Objekt</th><th>Grund</th><th>Besetzung</th><th>Vorschlag</th></tr></thead><tbody>${otherOpen.map((i) => row(c, i, i.regulars.length ? 'Stammkraft verhindert' : 'ohne Stammkraft')).join('')}</tbody></table></div></section>` : ''}`
}

registerView({ id: 'coverage', order: 40, label: 'Vertretungen', group: 'plan', summary: true, render: coverageView, badge: (c) => c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday && c.state.count(i.key) < i.staff).length })

registerActions(
  {
    'cover-take': (el) => {
      const { key, emp, replace } = el.dataset
      const inst = app.cur.state.instByKey.get(key)
      mutateAssignments(
        (s) => {
          if (replace) s.unassign(replace, key)
          s.assign(emp, key, false)
        },
        { date: inst.origDate, text: `Vertretung ${empName(emp)}${replace ? ` statt ${empName(replace)}` : ''}: ${objectOf(app.cur, inst).name} ${formatDate(inst.date)} ${inst.startTime}` },
      )
      toast(`${empName(emp)} als Vertretung eingeteilt.`)
    },
    'cover-all': () => planWeek(false),
  },
  { edit: 'planung' },
)
