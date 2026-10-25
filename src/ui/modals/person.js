// Dienstplan einer Person: Klick auf den Namen öffnet ihre Woche, ihren
// Stammplan und eine Auswahl der Objekte. Leistungen eines Objekts lassen sich
// direkt zuweisen: dauerhaft (Stammkraft) oder nur für diese Woche, mit
// Prüfung, ob es zeitlich und vom Vertrag her passt.

import { evaluateRegular, openSlots, regularLoad, weeklyMinutes } from '../../core/assign.js'
import { formatDate, formatHours, isoWeek } from '../../core/dates.js'
import { timeAccount } from '../../core/reports.js'
import { evaluateCandidate, explain } from '../../core/scheduler.js'
import { app, mutateAssignments, openModal, persist, recordUndo, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { availabilitySummary, dayClass, esc, modalFrame, rhythmText, signed } from '../shared.js'
import { assignRegular } from '../views/assign.js'
import { struckChip, workChip } from '../views/week.js'

const h = (min) => formatHours(Math.round(min))
const first = (name) => name.split(' ')[0]
const ctxOf = (c) => ({ ...c.ctx, tasks: app.data.tasks })
const objName = (id) => app.data.objects.find((o) => o.id === id)
const empOf = (id) => app.data.employees.find((e) => e.id === id) || { name: '?' }

/** Einsätze dieser Woche einer Leistung (nicht abgesagt). */
const weekInstances = (c, taskId) => c.week.filter((i) => i.taskId === taskId && i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday)

function weekGrid(c, emp) {
  const ts = c.timesheet(emp)
  return `<div class="pp-week">${ts.days
    .map((day) => {
      const chips = day.lines.map((l) => (l.kind === 'work' ? workChip(c, emp, l) : struckChip(c, l))).join('')
      return `<div class="pp-day ${dayClass(c, day.date)} ${day.absence ? 'absent' : ''}"><div class="pp-day-head">${formatDate(day.date)}${day.total ? ` · ${formatHours(day.total)} h` : ''}</div>
        ${day.absence ? `<span class="abs-tag">${esc(day.absence.type)}</span>` : ''}${chips || (day.absence ? '' : '<span class="muted">frei</span>')}</div>`
    })
    .join('')}</div>`
}

function regularTable(ctx, emp, mine) {
  if (!mine.tasks.length) return '<p class="note">Noch keine festen Objekte. Unten ein Objekt wählen und Leistungen zuweisen.</p>'
  const rows = [...mine.tasks]
    .sort((a, b) => (objName(a.objectId)?.name || '').localeCompare(objName(b.objectId)?.name || '') || a.start.localeCompare(b.start))
    .map((t) => {
      const obj = objName(t.objectId)
      return `<tr><td><span class="swatch" style="--obj:var(--o${obj?.color || 10})"></span><strong>${esc(obj?.name || '')}</strong><br><span class="muted">${esc(t.label)}</span></td>
        <td>${esc(rhythmText(t))}<br><span class="muted">${esc(t.start)}–${esc(t.end)}</span></td><td class="num">${h(weeklyMinutes(t, ctx.rules))}</td>
        <td><button class="btn small edit-only" data-action="pp-remove" data-task="${esc(t.id)}" data-emp="${esc(emp.id)}">Entfernen</button></td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Objekt · Leistung</th><th>Rhythmus</th><th>h/Woche</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function objectPicker(ctx, emp, objectId) {
  const open = (o) => ctx.tasks.filter((t) => t.objectId === o.id && t.recurrence.type !== 'once' && openSlots(t)).length
  const count = (o) => ctx.tasks.filter((t) => t.objectId === o.id).length
  const regions = [...new Set(app.data.objects.map((o) => o.region || 'Ohne Revier'))].sort((a, b) => (b === emp.team) - (a === emp.team) || a.localeCompare(b))
  const groups = regions
    .map((r) => {
      const list = app.data.objects.filter((o) => (o.region || 'Ohne Revier') === r).sort((a, b) => (open(b) > 0) - (open(a) > 0) || a.name.localeCompare(b.name))
      return `<optgroup label="${esc(r)}">${list.map((o) => `<option value="${esc(o.id)}" ${o.id === objectId ? 'selected' : ''}>${esc(o.name)} – ${count(o)} ${count(o) === 1 ? 'Leistung' : 'Leistungen'}${open(o) ? `, ${open(o)} ohne Stammkraft` : ''}</option>`).join('')}</optgroup>`
    })
    .join('')
  return `<label class="field wide"><span>Objekt wählen</span><select id="pp-obj" data-change="pp-obj" data-emp="${esc(emp.id)}"><option value="">Objekt auswählen …</option>${groups}</select></label>`
}

function objectTasks(c, ctx, emp, objectId, load) {
  const obj = objName(objectId)
  if (!obj) return ''
  const tasks = ctx.tasks.filter((t) => t.objectId === objectId)
  if (!tasks.length) return `<p class="note">Für ${esc(obj.name)} ist noch kein Reinigungsplan angelegt (unter „Objekte & Leistungen“).</p>`
  const contract = (emp.weeklyHours || 0) * 60
  const rows = tasks
    .map((t) => {
      const mineAlready = t.regulars.includes(emp.id)
      const ev = mineAlready ? null : evaluateRegular(ctx, t, emp, { load })
      const why = ev ? explain(ev.factors, { good: 3, bad: 2 }) : null
      const inWeek = weekInstances(c, t.id)
      const weekMine = inWeek.filter((i) => c.state.has(emp.id, i.key)).length
      const periodic = t.recurrence.type !== 'once'
      const fit = mineAlready
        ? '<span class="pill ok">Stammkraft</span>'
        : ev.allowed
          ? `<span class="pro">✓ passt</span> ${why.pro.map((x) => `<span class="pro">· ${esc(x)}</span>`).join(' ')} ${why.contra.map((x) => `<span class="con">· ${esc(x)}</span>`).join(' ')}`
          : `<span class="con">✗ ${esc(ev.blockers.join(' · '))}</span>`
      const regs = t.regulars.filter((id) => id !== emp.id).map((id) => c.ctx.employeesById.get(id)).filter(Boolean)
      const buttons = []
      if (mineAlready) buttons.push(`<button class="btn small edit-only" data-action="pp-remove" data-task="${esc(t.id)}" data-emp="${esc(emp.id)}">Entfernen</button>`)
      else if (periodic && openSlots(t)) buttons.push(`<button class="btn small ${ev.allowed ? 'primary' : ''} edit-only" data-action="pp-assign" data-task="${esc(t.id)}" data-emp="${esc(emp.id)}" ${ev.allowed ? '' : `title="${esc(ev.blockers.join('; '))}"`}>Dauerhaft zuweisen</button>`)
      else if (periodic) for (const r of regs) buttons.push(`<button class="btn small edit-only" data-action="pp-replace" data-task="${esc(t.id)}" data-emp="${esc(emp.id)}" data-old="${esc(r.id)}">Statt ${esc(first(r.name))} (dauerhaft)</button>`)
      if (inWeek.length && weekMine < inWeek.length && !mineAlready) buttons.push(`<button class="btn small edit-only" data-action="pp-week" data-task="${esc(t.id)}" data-emp="${esc(emp.id)}">Nur KW ${isoWeek(c.monday).week} (${inWeek.length}×)</button>`)
      return `<tr class="${mineAlready ? 'row-mine' : ''}">
        <td><strong>${esc(t.label)}</strong><br><span class="muted">${esc(rhythmText(t))} · ${esc(t.start)}–${esc(t.end)}${t.staff > 1 ? ` · ${t.staff} Personen` : ''}</span></td>
        <td class="num">${periodic ? h(weeklyMinutes(t, ctx.rules)) : '<span class="muted">einmalig</span>'}${ev && periodic ? `<br><span class="muted">dann ${h(ev.after)} / ${h(contract)}</span>` : ''}</td>
        <td>${regs.length ? esc(regs.map((r) => r.name).join(', ')) : openSlots(t) && periodic ? '<span class="pill error">offen</span>' : '<span class="muted">–</span>'}${weekMine ? `<br><span class="muted">diese Woche ${weekMine}× eingeteilt</span>` : ''}</td>
        <td class="pp-fit">${fit}</td>
        <td class="send-acts">${buttons.join('')}</td></tr>`
    })
    .join('')
  const fitting = tasks.filter((t) => t.recurrence.type !== 'once' && openSlots(t) && !t.regulars.includes(emp.id) && evaluateRegular(ctx, t, emp, { load }).allowed)
  return `<div class="pp-object-head"><span class="swatch" style="--obj:var(--o${obj.color})"></span><strong>${esc(obj.name)}</strong> <span class="muted">${esc([obj.address, obj.region].filter(Boolean).join(' · '))}</span>
      ${fitting.length > 1 ? `<button class="btn small edit-only" data-action="pp-object-all" data-obj="${esc(obj.id)}" data-emp="${esc(emp.id)}">Alle passenden zuweisen (${fitting.length})</button>` : ''}</div>
    <div class="table-wrap"><table class="data pp-tasks"><thead><tr><th>Leistung · wann</th><th>h/Woche</th><th>Derzeit</th><th>Passt für ${esc(first(emp.name))}?</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function personModal(c, { empId, objectId }) {
  const emp = c.ctx.employeesById.get(empId)
  if (!emp) return null
  const ctx = ctxOf(c)
  const load = regularLoad(ctx, ctx.tasks)
  const mine = load.get(emp.id) || { minutes: 0, tasks: [] }
  const contract = (emp.weeklyHours || 0) * 60
  const free = contract - mine.minutes
  const ts = c.timesheet(emp)
  const account = timeAccount(emp, app.data.published, c.monday, app.data.payroll)
  return modalFrame({
    title: `Dienstplan: ${emp.name}`,
    subtitle: `${esc(emp.type)} · ${esc(emp.team || '')} · KW ${isoWeek(c.monday).week}`,
    wide: true,
    body: `<div class="tags"><span class="tag">Vertrag ${h(contract)} h/Woche</span><span class="tag ${free < 0 ? 'warn-tag' : ''}">Stammplan ${h(mine.minutes)} h/Woche · ${free >= 0 ? `${h(free)} h frei` : `${h(-free)} h über Vertrag`}</span><span class="tag">diese Woche ${formatHours(ts.totals.ist)} / ${formatHours(ts.totals.soll)} h</span><span class="tag">Zeitkonto ${signed(account)} h</span><span class="tag">${esc(availabilitySummary(emp))}</span></div>
      <section><h3>Woche ${formatDate(c.monday, { weekday: false })}–${formatDate(c.sunday, { weekday: false })}</h3>${weekGrid(c, emp)}</section>
      <section><h3>Feste Objekte (Stammplan, jede Woche)</h3>${regularTable(ctx, emp, mine)}</section>
      <section class="pp-assign"><h3>Objekt zuweisen</h3><div class="form-grid">${objectPicker(ctx, emp, objectId)}</div>
        ${objectId ? objectTasks(c, ctx, emp, objectId, load) : '<p class="note">Objekt wählen: Die Leistungen erscheinen mit Zeiten und ob sie zeitlich, vom Vertrag und von der Qualifikation her passen.</p>'}</section>`,
    foot: `<div class="actions"><button class="btn" data-action="open-sheet" data-emp="${esc(emp.id)}">Wochenzettel</button><button class="btn edit-only" data-action="emp-edit" data-id="${esc(emp.id)}">Stammdaten</button></div>
      <div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}

registerModal('person', personModal)

function afterChange(text) {
  persist()
  renderNow()
  if (text) toast(text)
}

registerActions({
  'open-person': (el) => openModal({ type: 'person', empId: el.dataset.emp, objectId: app.ui.modal?.type === 'person' ? app.ui.modal.objectId : undefined }),
  'pp-obj': (el) => {
    app.ui.modal.objectId = el.value || undefined
    renderModal()
  },
})

registerActions(
  {
    'pp-assign': (el) => {
      recordUndo('Stammkraft zuweisen')
      const ctx = ctxOf(app.cur)
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      const ev = evaluateRegular(ctx, task, ctx.employeesById.get(el.dataset.emp))
      assignRegular(task.id, el.dataset.emp, { quiet: true })
      afterChange(ev.allowed ? `${empOf(el.dataset.emp).name}: ${task.label} jetzt fest (${rhythmText(task)} ${task.start}–${task.end}). „Woche planen“ teilt ab jetzt ein.` : `Zugewiesen, bitte prüfen: ${ev.blockers.join('; ')}`)
    },
    'pp-replace': (el) => {
      recordUndo('Stammkraft ersetzen')
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      task.regulars = task.regulars.filter((id) => id !== el.dataset.old)
      assignRegular(task.id, el.dataset.emp, { quiet: true })
      afterChange(`${task.label}: ${empOf(el.dataset.emp).name} statt ${empOf(el.dataset.old).name}. Für schon eingeteilte Wochen „Neu planen“ oder „Nur diese Woche“.`)
    },
    'pp-remove': (el) => {
      recordUndo('Stammkraft entfernen')
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      task.regulars = task.regulars.filter((id) => id !== el.dataset.emp)
      afterChange(`${task.label}: ${empOf(el.dataset.emp).name} ist nicht mehr Stammkraft. Bereits eingeteilte Wochen bleiben.`)
    },
    'pp-week': (el) => {
      const c = app.cur
      const empId = el.dataset.emp
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      const list = weekInstances(c, task.id)
      // Prüfen wie beim Einteilen: Verstöße werden genannt, die Disposition entscheidet
      const emp = c.ctx.employeesById.get(empId)
      const problems = [...new Set(list.flatMap((inst) => evaluateCandidate(c.ctx, c.state, emp, inst).issues.filter((i) => i.severity !== 'info').map((i) => i.message)))]
      const n = mutateAssignments((state) => {
        let count = 0
        for (const inst of list) {
          if (state.has(empId, inst.key)) continue
          // voll besetzt: eine nicht fixierte Person ersetzen
          if (state.count(inst.key) >= inst.staff) {
            const free = state.assigned(inst.key).find((a) => !a.locked)
            if (!free) continue
            state.unassign(free.employeeId, inst.key)
          }
          state.assign(empId, inst.key, true)
          count++
        }
        return count
      }, `${task.label}: ${empOf(empId).name} diese Woche`)
      toast(n ? `${empOf(empId).name} übernimmt ${task.label} diese Woche (${n}×), fixiert.${problems.length ? ` Bitte prüfen: ${problems.slice(0, 2).join('; ')}${problems.length > 2 ? ' …' : ''}` : ''}` : 'Nichts geändert: alle Termine sind fixiert besetzt.')
    },
    'pp-object-all': (el) => {
      recordUndo('Objekt zuweisen')
      const empId = el.dataset.emp
      const done = []
      for (const t of app.data.tasks.filter((x) => x.objectId === el.dataset.obj && x.recurrence.type !== 'once' && openSlots(x) && !x.regulars.includes(empId))) {
        // nach jeder Zuweisung neu prüfen (zwei Leistungen zur selben Zeit gehen nicht)
        const ctx = ctxOf(app.cur)
        if (evaluateRegular(ctx, t, ctx.employeesById.get(empId)).allowed) {
          assignRegular(t.id, empId, { quiet: true })
          done.push(t.label)
        }
      }
      afterChange(done.length ? `${empOf(empId).name} übernimmt fest: ${done.join(', ')}.` : 'Keine passende Leistung frei.')
    },
  },
  { edit: true },
)

