// Zuweisung: Reinigungsplan je Objekt (wann, wie oft, wie lange) und wer ihn
// dauerhaft übernimmt (Stammkraft). Vorschläge mit Begründung, Zuweisen per
// Klick, ganze Objekte oder alle Vorschläge auf einmal, Auslastung je Person.
// Danach teilt „Woche planen“ jede Woche die Stammkräfte ein.

import { evaluateRegular, openSlots, rankRegulars, regularLoad, suggestRegulars, weeklyMinutes, whenText } from '../../core/assign.js'
import { employedOn } from '../../core/contract.js'
import { formatHours, isoWeek, mondayOf, todayISO } from '../../core/dates.js'
import { explain } from '../../core/scheduler.js'
import { app, confirmStep, persist, plannedWeeks, recordUndo, registerActions, registerView, renderNow, toast } from '../context.js'
import { esc, ICON, rhythmText, saldoClass } from '../shared.js'
import { regionFilter } from './objects.js'

const ctxOf = (c) => ({ ...c.ctx, tasks: app.data.tasks })
const h = (min) => formatHours(Math.round(min))
const planned = (t) => t.recurrence.type !== 'once'

function regularChip(ctx, task, id, load) {
  const emp = ctx.employeesById.get(id)
  if (!emp) return ''
  // bestehende Zuweisung prüfen: verfügbar, keine Überschneidung
  const ev = evaluateRegular(ctx, task, emp, { tasks: ctx.tasks.map((t) => (t.id === task.id ? { ...t, regulars: t.regulars.filter((x) => x !== id) } : t)) })
  const warn = ev.blockers.join(' · ')
  return `<span class="pill ${warn ? 'warning' : 'ok'} name reg-chip" title="${esc(warn || `${h(load.get(id)?.minutes || 0)} von ${h((emp.weeklyHours || 0) * 60)} h/Woche im Stammplan`)}">${esc(emp.name)}${warn ? ' ⚠' : ''}<button class="chip-x edit-only" data-action="as-remove" data-task="${esc(task.id)}" data-emp="${esc(id)}" aria-label="${esc(emp.name)} entfernen">×</button></span>`
}

function taskRow(ctx, task, load) {
  const slots = openSlots(task)
  // Vorschläge nur für Leistungen mit offenem Platz (besetzte zeigen keine)
  const ranked = slots ? rankRegulars(ctx, task, { load }) : []
  const best = ranked.find((x) => x.allowed)
  const why = best ? explain(best.factors, { good: 3, bad: 2 }) : null
  const suggestion = !slots
    ? '<span class="muted">besetzt</span>'
    : best
      ? `<div class="as-best"><div class="as-who"><strong>${esc(best.emp.name)}</strong><button class="btn small primary edit-only" data-action="as-assign" data-task="${esc(task.id)}" data-emp="${esc(best.emp.id)}">Zuweisen</button></div>
          <div class="reasons">${why.pro.map((t) => `<span class="pro">✓ ${esc(t)}</span>`).join(' ')} ${why.contra.map((t) => `<span class="con">× ${esc(t)}</span>`).join(' ')}</div></div>`
      : `<span class="pill error">niemand frei</span><div class="muted small-text">${esc(ranked[0]?.blockers[0] || '')}${ranked.length ? ' … Zeiten anpassen oder neue Person einplanen' : ''}</div>`
  const picker = slots
    ? `<select class="edit-only as-pick" data-change="as-pick" data-task="${esc(task.id)}" aria-label="Person wählen"><option value="">andere Person …</option>${ranked
        .slice(0, 40)
        .map((x) => `<option value="${esc(x.emp.id)}" ${x.allowed ? '' : 'class="blocked"'}>${esc(x.emp.name)} – ${x.allowed ? `${h(Math.max(0, (x.emp.weeklyHours || 0) * 60 - (load.get(x.emp.id)?.minutes || 0)))} h frei` : esc(x.blockers[0])}</option>`)
        .join('')}</select>`
    : ''
  return `<tr class="${slots ? 'row-open' : ''}">
    <td><strong>${esc(task.label)}</strong>${task.category === 'sonder' ? ' <span class="tag special">Sonderleistung</span>' : ''}<br><span class="muted">${esc(rhythmText(task))} · ${esc(task.start)}–${esc(task.end)}${task.staff > 1 ? ` · ${task.staff} Personen` : ''}${task.skills?.length ? ` · ${esc(task.skills.join(', '))}` : ''}</span></td>
    <td class="num">${h(weeklyMinutes(task, ctx.rules))}</td>
    <td>${task.regulars.map((id) => regularChip(ctx, task, id, load)).join(' ') || '<span class="muted">–</span>'}${slots && task.regulars.length ? `<br><span class="muted">${slots} offen</span>` : ''}</td>
    <td>${suggestion}</td>
    <td>${picker}</td></tr>`
}

function assignView(c) {
  const ctx = ctxOf(c)
  const region = app.ui.region
  const load = regularLoad(ctx, ctx.tasks)
  const onlyOpen = !!app.ui.assignOpen
  const tasks = ctx.tasks.filter(planned)
  const open = tasks.filter((t) => openSlots(t))
  const totalMin = tasks.reduce((s, t) => s + weeklyMinutes(t, ctx.rules) * (t.staff || 1), 0)
  const assignedMin = tasks.reduce((s, t) => s + weeklyMinutes(t, ctx.rules) * Math.min(t.staff || 1, t.regulars.length), 0)
  const objects = app.data.objects.filter((o) => !region || o.region === region)
  const cards = objects
    .map((obj) => {
      const list = tasks.filter((t) => t.objectId === obj.id && (!onlyOpen || openSlots(t)))
      if (!list.length) return ''
      const objOpen = list.filter((t) => openSlots(t))
      const objMin = list.reduce((s, t) => s + weeklyMinutes(t, ctx.rules) * (t.staff || 1), 0)
      return `<article class="object-card" style="--obj:var(--o${obj.color})">
        <header><h3>${esc(obj.name)}</h3><span class="addr">${esc([obj.address, obj.region].filter(Boolean).join(' · '))} · ${h(objMin)} h/Woche${objOpen.length ? ` · <span class="err-text">${objOpen.length} ohne Stammkraft</span>` : ''}</span>
          <span class="edit-only">${objOpen.length > 1 ? `<button class="btn small" data-action="as-object" data-obj="${esc(obj.id)}">Vorschläge für das Objekt übernehmen</button>` : ''}<button class="btn small" data-action="task-edit" data-id="new" data-obj="${esc(obj.id)}">${ICON.plus} Leistung</button></span></header>
        <div class="table-wrap"><table class="data assign"><thead><tr><th>Leistung · wann</th><th>h/Woche</th><th>Stammkraft</th><th>Vorschlag</th><th></th></tr></thead><tbody>${list.map((t) => taskRow(ctx, t, load)).join('')}</tbody></table></div>
      </article>`
    })
    .join('')

  const people = ctx.employees
    .filter((e) => !region || !e.team || e.team === region)
    .map((e) => ({ e, min: load.get(e.id)?.minutes || 0, tasks: load.get(e.id)?.tasks || [] }))
    .sort((a, b) => a.min / Math.max(1, a.e.weeklyHours * 60) - b.min / Math.max(1, b.e.weeklyHours * 60))
  const peopleRows = people
    .map(({ e, min, tasks: list }) => {
      const contract = (e.weeklyHours || 0) * 60
      const pct = contract ? Math.min(140, Math.round((min / contract) * 100)) : 0
      const free = contract - min
      return `<tr><td><button class="link-btn" data-action="open-person" data-emp="${esc(e.id)}"><strong>${esc(e.name)}</strong></button><br><span class="muted">${esc(e.team || '')} · ${esc(e.type)}</span></td><td class="num">${h(contract)}</td><td class="num">${h(min)}</td>
        <td class="num saldo ${saldoClass(free)}">${free >= 0 ? h(free) : `−${h(-free)}`}</td>
        <td><div class="load-bar" title="${pct} %"><span style="width:${Math.min(100, pct)}%" class="${pct > 100 ? 'over' : ''}"></span></div></td>
        <td><span class="muted">${esc([...new Set(list.map((t) => app.data.objects.find((o) => o.id === t.objectId)?.short || ''))].filter(Boolean).join(', ') || '–')}</span></td></tr>`
    })
    .join('')

  const confirmAll = app.ui.confirm === 'as-all'
  return `<div class="section-head"><div><h2>Zuweisung: wer reinigt welches Objekt</h2><p>Der Reinigungsplan steht unter „Objekte & Leistungen“: welches Objekt wann, wie oft und wie lange gereinigt wird. Hier bekommt jede Leistung ihre feste Person (Stammkraft). Vorschläge prüfen Verfügbarkeit, Qualifikation, Überschneidungen und Fahrzeit und bevorzugen freie Vertragsstunden, das eigene Revier, eingeschulte Personen und kurze Wege. Danach teilt „Woche planen“ jede Woche automatisch ein.</p></div>
      <div class="actions edit-only"><button class="btn ${confirmAll ? 'primary confirm' : 'primary'}" data-action="as-all" ${open.length ? '' : 'disabled'}>${confirmAll ? 'Wirklich alle Vorschläge übernehmen?' : `Alle Vorschläge übernehmen (${open.length})`}</button><button class="btn" data-action="obj-edit" data-id="new">${ICON.plus} Objekt anlegen</button></div></div>
    <div class="summary">
      <div class="stat"><div class="label">Leistungen im Plan</div><div class="value">${tasks.length}</div></div>
      <div class="stat ${open.length ? 'err' : ''}"><div class="label">ohne Stammkraft</div><div class="value">${open.length}</div></div>
      <div class="stat"><div class="label">Stunden pro Woche</div><div class="value">${h(totalMin)} h</div></div>
      <div class="stat"><div class="label">davon zugewiesen</div><div class="value">${totalMin ? Math.round((assignedMin / totalMin) * 100) : 100} %</div></div>
    </div>
    ${regionFilter()}
    <div class="filters"><button class="filter" data-action="as-open" aria-pressed="${onlyOpen}">Nur Leistungen ohne Stammkraft</button></div>
    ${cards ? `<div class="objects">${cards}</div>` : `<p class="empty">${onlyOpen ? 'Alle Leistungen haben eine Stammkraft.' : 'Noch kein Reinigungsplan: unter „Objekte & Leistungen“ Objekte und Leistungen anlegen.'}</p>`}
    <h3>Auslastung im Stammplan</h3>
    <div class="table-wrap"><table class="data load"><thead><tr><th>Mitarbeiter:in</th><th>Vertrag h/Woche</th><th>Stammplan</th><th>frei</th><th>Auslastung</th><th>Objekte</th></tr></thead><tbody>${peopleRows}</tbody></table></div>
    <p class="note">Durchschnitt pro Woche: 14-tägige Leistungen zählen halb, monatliche mit rund einem Viertel. Einmalige Leistungen sind nicht dabei, sie werden in der jeweiligen Woche eingeteilt. ⚠ an einer Stammkraft: Zeiten passen nicht mehr (Verfügbarkeit, Überschneidung).</p>`
}

registerView({ id: 'assign', order: 92, label: 'Zuweisung', group: 'stamm', render: assignView })

/** Schon eingeteilte Wochen ab heute, in denen die Leistung andere hat: dort bleibt es bis „Neu planen“ (wie beim Entfernen). */
function plannedNote(task, empId) {
  const today = todayISO()
  const planned = plannedWeeks()
  const emp = app.data.employees.find((e) => e.id === empId)
  const weeks = [...new Set(Object.entries(app.data.assignments || {}).filter(([k, list]) => k.endsWith(`|${task.id}`) && k.slice(0, 10) >= today && (!emp || employedOn(emp, k.slice(0, 10))) && planned.has(mondayOf(k.slice(0, 10))) && list.length && !list.some((a) => a.employeeId === empId)).map(([k]) => mondayOf(k.slice(0, 10))))].sort()
  return weeks.length ? ` In KW ${weeks.map((m) => isoWeek(m).week).join(', ')} ist schon eingeteilt: dort bleibt die Einteilung, „Neu planen“ übernimmt die neue Stammkraft.` : ''
}

/** Person dauerhaft als Stammkraft eintragen (und im Objekt als eingeschult vermerken). */
export function assignRegular(taskId, empId, { quiet = false } = {}) {
  const task = app.data.tasks.find((t) => t.id === taskId)
  const emp = app.data.employees.find((e) => e.id === empId)
  if (!task || !emp || task.regulars.includes(empId)) return null
  task.regulars = [...task.regulars, empId]
  if (!(emp.trained || []).includes(task.objectId)) emp.trained = [...(emp.trained || []), task.objectId]
  if (!quiet) {
    const obj = app.data.objects.find((o) => o.id === task.objectId)
    toast(`${emp.name} ist jetzt Stammkraft für ${obj?.short || obj?.name || ''} – ${task.label} (${whenText(task)}). „Woche planen“ teilt ab jetzt automatisch ein.${plannedNote(task, empId)}`)
  }
  return task
}

function applySuggestions(taskIds) {
  const ctx = ctxOf(app.cur)
  const list = suggestRegulars(ctx, { taskIds })
  for (const s of list) assignRegular(s.task.id, s.emp.id, { quiet: true })
  return list
}

// Filter „nur ohne Stammkraft“: reine Anzeige, auch für Lesende
registerActions({
  'as-open': () => {
    app.ui.assignOpen = !app.ui.assignOpen
    renderNow()
  },
})

registerActions(
  {
    'as-assign': (el) => {
      recordUndo('Stammkraft zuweisen')
      if (assignRegular(el.dataset.task, el.dataset.emp)) persist()
      renderNow()
    },
    'as-pick': (el) => {
      if (!el.value) return
      const ctx = ctxOf(app.cur)
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      const emp = ctx.employeesById.get(el.value)
      const ev = evaluateRegular(ctx, task, emp)
      recordUndo('Stammkraft zuweisen')
      assignRegular(task.id, emp.id, { quiet: true })
      persist()
      renderNow()
      toast(`${ev.allowed ? `${emp.name} übernimmt ${task.label}.` : `${emp.name} zugewiesen, bitte prüfen: ${ev.blockers.join('; ')}`}${plannedNote(task, emp.id)}`)
    },
    'as-remove': (el) => {
      const task = app.data.tasks.find((t) => t.id === el.dataset.task)
      if (!task) return
      recordUndo('Stammkraft entfernen')
      task.regulars = task.regulars.filter((id) => id !== el.dataset.emp)
      persist()
      renderNow()
      toast('Stammkraft entfernt. Bereits eingeteilte Wochen bleiben; „Neu planen“ übernimmt die Änderung.')
    },
    'as-object': (el) => {
      recordUndo('Vorschläge für ein Objekt')
      const ids = app.data.tasks.filter((t) => t.objectId === el.dataset.obj && planned(t) && openSlots(t)).map((t) => t.id)
      const list = applySuggestions(ids)
      persist()
      renderNow()
      toast(list.length ? `${list.length} Zuweisungen: ${list.map((s) => `${s.emp.name.split(' ')[0]} → ${s.task.label}`).join(', ')}` : 'Für dieses Objekt ist gerade niemand frei.')
    },
    'as-all': () => {
      if (!confirmStep('as-all')) return
      recordUndo('Alle Vorschläge übernehmen')
      const list = applySuggestions(null)
      const left = app.data.tasks.filter((t) => planned(t) && openSlots(t)).length
      persist()
      renderNow()
      toast(`${list.length} Stammkräfte zugewiesen.${left ? ` ${left} Leistungen bleiben offen: dafür ist niemand frei.` : ''}`)
    },
  },
  { edit: 'stammdaten' },
)

