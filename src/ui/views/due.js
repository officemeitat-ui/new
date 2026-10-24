// Periodische Leistungen: alle Termine von 14-tägigen, monatlichen,
// quartalsweisen … Leistungen im gewählten Zeitraum, nach Kategorie, mit
// Status und Frist, bis wann sie zugeteilt sein müssen.

import { isPeriodic, periodicDue, rhythmCategory, RHYTHM_ORDER } from '../../core/attention.js'
import { addDays, formatDate, formatHours, todayISO } from '../../core/dates.js'
import { app, computeRange, empName, plannedWeeks, registerActions, registerView, render, renderNow } from '../context.js'
import { esc, objectOf, rhythmText } from '../shared.js'

const HORIZONS = [
  [4, '4 Wochen'],
  [8, '8 Wochen'],
  [13, '3 Monate'],
  [26, '6 Monate'],
  [52, '1 Jahr'],
]

const dueRange = () => {
  const today = todayISO()
  return { from: today, to: addDays(today, (app.ui.dueWeeks || 8) * 7) }
}

function statusCell(d, today) {
  const names = (ids) => esc(ids.map(empName).join(', '))
  switch (d.status) {
    case 'entfaellt':
      return `<span class="pill info">entfällt${d.inst.reason === 'holiday' ? ` (${esc(d.inst.origHoliday?.name || 'Feiertag')})` : ''}</span>`
    case 'zugeteilt':
      return `<span class="pill ok name">${names(d.working)}</span>`
    case 'stammkraft':
      return `<span class="pill info">Stammkraft ${names(d.freeRegulars)}</span><br><span class="muted">wird beim Planen der Woche eingeteilt</span>`
    default:
      return `<span class="pill ${d.deadline < today ? 'error' : 'warning'}">zuteilen</span> <span class="muted">${esc(d.reason)}</span>${d.working.length ? `<br><span class="muted">eingeteilt: ${names(d.working)}</span>` : ''}`
  }
}

function dueView(c) {
  const today = todayISO()
  const { from, to } = dueRange()
  const r = computeRange(from, to)
  const planned = plannedWeeks()
  const lead = r.ctx.rules.dueLeadDays ?? 7
  const all = periodicDue(r.ctx, r.instances, r.state, app.data.tasks, { from, to, isPlanned: (m) => planned.has(m) }).map((d) => ({ ...d, deadline: addDays(d.inst.date, -lead) }))
  const categories = RHYTHM_ORDER.filter((cat) => all.some((d) => d.rhythm === cat))
  const category = categories.includes(app.ui.dueCategory) ? app.ui.dueCategory : ''
  const list = all.filter((d) => (!category || d.rhythm === category) && (!app.ui.dueOnlyOpen || d.status === 'zuteilen'))
  const open = all.filter((d) => d.status === 'zuteilen')

  const chip = (value, label, count, openCount) =>
    `<button class="filter" data-action="due-cat" data-cat="${esc(value)}" aria-pressed="${category === value}">${esc(label)} <span class="muted">${count}</span>${openCount ? ` <span class="flag error">${openCount}</span>` : ''}</button>`
  const chips = [chip('', 'Alle', all.length, open.length), ...categories.map((cat) => chip(cat, cat, all.filter((d) => d.rhythm === cat).length, open.filter((d) => d.rhythm === cat).length))].join('')
  const horizon = HORIZONS.map(([w, label]) => `<button class="filter" data-action="due-weeks" data-weeks="${w}" aria-pressed="${(app.ui.dueWeeks || 8) === w}">${label}</button>`).join('')

  const rows = list
    .map((d) => {
      const obj = objectOf(c, d.inst)
      const late = d.status === 'zuteilen' && d.deadline < today
      return `<tr class="${d.status === 'zuteilen' ? 'row-open' : ''}">
        <td class="num">${formatDate(d.inst.date, { year: true })}<br><span class="muted">${d.inst.startTime}–${d.inst.endTime} · ${formatHours(d.inst.net * d.inst.staff)} h</span></td>
        <td><span class="swatch" style="--obj:var(--o${obj.color})"></span><button class="link-btn" data-action="goto-shift" data-key="${esc(d.inst.key)}" data-date="${esc(d.inst.origDate)}">${esc(obj.name)}</button><br><span class="muted">${esc(d.inst.label)}${d.inst.staff > 1 ? ` · ${d.inst.staff} Personen` : ''}</span></td>
        <td><span class="tag rhythm">${esc(d.rhythm)}</span><br><span class="muted">${esc(rhythmText(d.task))}</span></td>
        <td>${statusCell(d, today)}</td>
        <td class="num ${late ? 'err-text' : ''}">${d.status === 'zuteilen' ? `${formatDate(d.deadline)}${late ? '<br>überfällig' : ''}` : '<span class="muted">–</span>'}</td>
        <td>${d.status === 'zuteilen' ? `<button class="btn small primary edit-only" data-action="goto-shift" data-key="${esc(d.inst.key)}" data-date="${esc(d.inst.origDate)}">Einteilen</button>` : ''}</td></tr>`
    })
    .join('')

  // Katalog: jede periodische Leistung mit Kategorie und nächstem Termin
  const next = new Map()
  for (const d of all) if (d.status !== 'entfaellt' && !next.has(d.task.id)) next.set(d.task.id, d.inst.date)
  const catalog = app.data.tasks
    .filter((t) => isPeriodic(t) && (t.recurrence.type !== 'once' || t.recurrence.date >= today))
    .map((t) => ({ t, cat: rhythmCategory(t) }))
    .filter(({ cat }) => !category || cat === category)
    .sort((a, b) => RHYTHM_ORDER.indexOf(a.cat) - RHYTHM_ORDER.indexOf(b.cat) || (next.get(a.t.id) || '9').localeCompare(next.get(b.t.id) || '9'))
    .map(({ t, cat }) => {
      const obj = app.data.objects.find((o) => o.id === t.objectId) || { name: 'Objekt', color: 10 }
      return `<tr><td><span class="tag rhythm">${esc(cat)}</span></td><td><span class="swatch" style="--obj:var(--o${obj.color})"></span>${esc(obj.name)}<br><span class="muted">${esc(t.label)}</span></td><td>${esc(rhythmText(t))}<br><span class="muted">${esc(t.start)}–${esc(t.end)}</span></td>
        <td>${t.regulars.map((id) => esc(empName(id))).join(', ') || '<span class="err-text">keine Stammkraft</span>'}</td><td class="num">${next.has(t.id) ? formatDate(next.get(t.id), { year: true }) : '<span class="muted">nach dem Zeitraum</span>'}</td></tr>`
    })
    .join('')

  return `<div class="section-head"><div><h2>Periodische Leistungen</h2><p>Was nicht jede Woche stattfindet: 14-tägig, monatlich, quartalsweise, halbjährlich, einmalig. Ohne Stammkraft oder wenn die Stammkraft fehlt, muss der Termin bis spätestens ${lead} Tage vorher zugeteilt sein (einstellbar unter „Regeln“). Offene Termine erscheinen unter „Zu erledigen“.</p></div></div>
    <div class="filters">${chips}</div>
    <div class="filters"><span class="filter-label">Zeitraum</span>${horizon}<button class="filter" data-action="due-open" aria-pressed="${!!app.ui.dueOnlyOpen}">Nur zuzuteilen</button></div>
    ${list.length ? `<div class="table-wrap"><table class="data due"><thead><tr><th>Termin</th><th>Objekt</th><th>Rhythmus</th><th>Besetzung</th><th>Zuteilen bis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Keine Termine ${app.ui.dueOnlyOpen ? 'zuzuteilen ' : ''}bis ${formatDate(to, { year: true })}.</p>`}
    <h3>Katalog nach Kategorie</h3>
    ${catalog ? `<div class="table-wrap"><table class="data"><thead><tr><th>Kategorie</th><th>Objekt</th><th>Rhythmus</th><th>Stammkraft</th><th>Nächster Termin</th></tr></thead><tbody>${catalog}</tbody></table></div>` : '<p class="empty">Keine periodischen Leistungen angelegt.</p>'}`
}

registerView({ id: 'due', order: 45, label: 'Periodische Leistungen', group: 'plan', render: dueView, range: dueRange })

registerActions({
  'due-cat': (el) => {
    app.ui.dueCategory = el.dataset.cat
    renderNow()
  },
  'due-weeks': (el) => {
    app.ui.dueWeeks = Number(el.dataset.weeks)
    render()
  },
  'due-open': () => {
    app.ui.dueOnlyOpen = !app.ui.dueOnlyOpen
    renderNow()
  },
})
