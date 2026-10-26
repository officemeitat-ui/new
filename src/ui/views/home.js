// Übersicht (Startseite): alle Bereiche der eigenen Rolle auf einen Blick.
// Je Bereich eine Karte mit dem, was offen ist (Zähler der Ansichten), und
// einem Klick hinein; für die Einsatzplanung der Stand der Woche. Wer nur
// Zählerstände darf, sieht nur diese Karte.

import { formatDate, isoWeek, todayISO } from '../../core/dates.js'
import { app, registerView, VIEW_GROUPS, visibleViews } from '../context.js'
import { weekSteps } from '../flow.js'
import { todo } from '../modals/todo.js'
import { esc, ICON } from '../shared.js'
import { navIcon } from '../sidebar.js'

const greeting = (hour = new Date().getHours()) => (hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend')
const firstName = (name = '') => name.split(/[\s,]+/).find(Boolean) || ''

function planCard(c) {
  const steps = weekSteps(c)
  const next = steps.find((s) => !s.done)
  const { week } = isoWeek(c.monday)
  return `<div class="home-week"><span class="muted">KW ${week}</span> ${next ? `<b>Nächster Schritt: ${esc(next.label)}</b> <span class="muted">${esc(next.info)}</span>` : '<span class="pill ok">Woche erledigt</span>'}</div>
    <ol class="home-steps">${steps.map((s) => `<li class="${s.done ? 'done' : s === next ? 'next' : ''}" title="${esc(s.info)}">${s.done ? '✓' : ''}<span>${esc(s.label)}</span></li>`).join('')}</ol>`
}

function card(c, [group, label], views) {
  const items = views.filter((v) => v.group === group)
  if (!items.length) return ''
  const open = items.map((v) => ({ v, n: Number(v.badge?.(c)) || 0 })).filter((x) => x.n > 0)
  const main = items[0]
  return `<article class="home-card">
    <header>${navIcon(main)}<h3>${esc(label)}</h3>${open.length ? '' : '<span class="pill ok">alles erledigt</span>'}</header>
    ${group === 'plan' ? planCard(c) : ''}
    ${open.length ? `<ul class="home-open">${open.map(({ v, n }) => `<li><button class="link-row" data-action="view" data-view="${v.id}"><span class="flag error">${n}</span><span>${esc(v.label)}</span>${ICON.right}</button></li>`).join('')}</ul>` : ''}
    <div class="home-links">${items.map((v) => `<button class="btn small" data-action="view" data-view="${v.id}">${esc(v.label)}</button>`).join('')}</div>
  </article>`
}

function homeView(c) {
  const views = visibleViews().filter((v) => v.id !== 'home')
  const t = todo()
  const name = firstName(app.user?.name)
  const cards = VIEW_GROUPS.filter(([g]) => g !== 'start').map((g) => card(c, g, views)).join('')
  return `<div class="home-head"><h2>${greeting()}${name ? `, ${esc(name)}` : ''}</h2><p class="muted">${formatDate(todayISO(), { year: true })}${app.access && !app.access.all ? ` · ${esc(app.access.label)}` : ''}</p></div>
  ${t.count ? `<div class="banner"><p><strong>${t.count} ${t.count === 1 ? 'Punkt' : 'Punkte'} zu erledigen</strong> in deinen Bereichen.</p><button class="btn primary" data-action="open-todo">${ICON.bell} Ansehen</button></div>` : ''}
  <section class="home-grid" aria-label="Bereiche">${cards}</section>`
}

registerView({ id: 'home', order: 0, label: 'Übersicht', group: 'start', module: '*', noWeek: true, mobile: { icon: ICON.home, label: 'Start' }, render: homeView })
