// Übersicht (Startseite): alle Bereiche der eigenen Rolle auf einen Blick.
// Je Bereich eine Karte mit dem, was offen ist (Zähler der Ansichten), und
// einem Klick hinein; für die Einsatzplanung der Stand der Woche. Wer nur
// ein Werkzeug darf, sieht nur dessen Karte.

import { addDays, formatDate, isoWeek, todayISO } from '../../core/dates.js'
import { app, navSections, registerView, visibleViews } from '../context.js'
import { weekSteps } from '../flow.js'
import { todo } from '../modals/todo.js'
import { esc, ICON } from '../shared.js'
import { navIcon } from '../sidebar.js'
import { cleo, moodFor } from '../mascot.js'
import { appointmentsOfDay } from './appointments.js'
import { proposalSummary } from './disponent.js'

const greeting = (hour = new Date().getHours()) => (hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend')
const firstName = (name = '') => name.split(/[\s,]+/).find(Boolean) || ''

function planCard(c) {
  const steps = weekSteps(c)
  const next = steps.find((s) => !s.done)
  const { week } = isoWeek(c.monday)
  return `<div class="home-week"><span class="muted">KW ${week}</span> ${next ? `<b>Nächster Schritt: ${esc(next.label)}</b> <span class="muted">${esc(next.info)}</span>` : '<span class="pill ok">Woche erledigt</span>'}</div>
    <ol class="home-steps">${steps.map((s) => `<li class="${s.done ? 'done' : s === next ? 'next' : ''}" title="${esc(s.info)}">${s.done ? '✓' : ''}<span>${esc(s.label)}</span></li>`).join('')}</ol>`
}

function card(c, { id: group, label, views: items }) {
  if (!items.length) return ''
  const open = items.map((v) => ({ v, n: Number(v.badge?.(c)) || 0 })).filter((x) => x.n > 0)
  const main = items[0]
  const total = open.reduce((n, x) => n + x.n, 0)
  return `<article class="home-card" data-section="${esc(group)}">
    <header><span class="home-icon">${navIcon(main)}</span><h3>${esc(label)}</h3>${open.length ? `<span class="home-count" title="offen">${total}</span>` : '<span class="pill ok">alles erledigt</span>'}</header>
    ${group === 'planung' && items.some((v) => v.id === 'week') ? planCard(c) : ''}
    ${open.length ? `<ul class="home-open">${open.map(({ v, n }) => `<li><button class="link-row" data-action="view" data-view="${v.id}"><span class="flag error">${n}</span><span>${esc(v.label)}</span>${ICON.right}</button></li>`).join('')}</ul>` : ''}
    <div class="home-links">${items.map((v) => `<button class="btn small" data-action="view" data-view="${v.id}">${esc(v.label)}</button>`).join('')}</div>
  </article>`
}

/** Offene Plätze der Woche (Einsätze ohne genug Personen). */
function openSlots(c) {
  return c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday).reduce((n, i) => n + Math.max(0, i.staff - Math.min(c.state.count(i.key), i.staff)), 0)
}

/** Kopf der Übersicht: Begrüßung, Datum, die wichtigsten Zahlen als Knöpfe. */
function hero(c, views, { name, todoCount, staffTotal }) {
  const has = (id) => views.some((v) => v.id === id)
  const today = todayISO()
  const { week } = isoWeek(today)
  const stat = (n, label, action, data = '', tone = '') => `<button class="home-hero-stat ${tone}" data-action="${action}" ${data}><b>${n}</b><span>${label}</span></button>`
  const stats = [
    stat(todoCount, todoCount === 1 ? 'Punkt zu erledigen' : 'zu erledigen', 'open-todo', '', todoCount ? 'hot' : ''),
    has('week') && c?.week ? (() => { const n = openSlots(c); return stat(n, n === 1 ? 'offener Einsatz' : 'offene Einsätze', 'view', 'data-view="week"', n ? 'hot' : '') })() : '',
    has('termine') ? (() => { const n = appointmentsOfDay(today).length; return stat(n, n === 1 ? 'Termin heute' : 'Termine heute', 'view', 'data-view="termine"') })() : '',
    has('assistenz') ? stat(staffTotal, staffTotal === 1 ? 'Vorschlag' : 'Vorschläge', 'view', 'data-view="assistenz"') : '',
  ].filter(Boolean)
  const role = app.access && !app.access.all ? ` · ${esc(app.access.label)}` : ''
  return `<section class="home-hero" aria-label="Begrüßung">
    <button class="home-hero-cleo" data-action="help-open" title="Cleo fragen: Hilfe zu jeder Funktion" aria-label="Cleo fragen">${cleo({ mood: moodFor({ open: todoCount }), size: 84 })}</button>
    <div class="home-hero-text"><p class="home-hero-date">${esc(formatDate(today, { year: true }))} · KW ${week}${role}</p><h2>${greeting()}${name ? `, ${esc(name)}` : ''}</h2><p class="home-hero-sub">${todoCount ? `${todoCount} ${todoCount === 1 ? 'Punkt wartet' : 'Punkte warten'} in deinen Bereichen.` : 'Alles erledigt – schönen Tag!'} <button class="link-btn" data-action="help-open">Frag Cleo</button>, wenn du etwas suchst.</p></div>
    ${stats.length ? `<div class="home-hero-stats">${stats.join('')}</div>` : ''}
  </section>`
}

function homeView(c) {
  const views = visibleViews().filter((v) => v.id !== 'home')
  const t = todo()
  const name = firstName(app.user?.name)
  const cards = navSections(views).filter((s) => s.id !== 'start').map((s) => card(c, s)).join('')
  // Termine heute und morgen (wer Termine sieht)
  const nextAppts = views.some((v) => v.id === 'termine') ? [todayISO(), addDays(todayISO(), 1)].flatMap((d) => appointmentsOfDay(d).map((x) => ({ ...x, d }))).filter((x, i, all) => all.findIndex((y) => y.a.id === x.a.id) === i).slice(0, 6) : []
  const apptCard = nextAppts.length
    ? `<section class="home-appts"><h3>${ICON.calendar} Termine heute und morgen</h3><ul>${nextAppts.map(({ a, d, allDay }) => `<li><button class="link-row" data-action="appt-open" data-id="${esc(a.id)}" data-occ="${esc(a.occ || '')}"><span class="muted">${d === todayISO() ? 'heute' : 'morgen'} ${allDay ? 'ganztägig' : esc(a.start.slice(11, 16))}</span> <b>${esc(a.title)}</b>${ICON.right}</button></li>`).join('')}</ul></section>`
    : ''
  // Digitale Mitarbeiter: was sie vorbereitet haben
  const staff = views.some((v) => v.id === 'assistenz') ? proposalSummary() : []
  const staffTotal = staff.reduce((n, a) => n + a.count, 0)
  const staffCard = staffTotal
    ? `<section class="home-staff"><h3>Deine digitalen Mitarbeiter haben ${staffTotal === 1 ? 'einen Vorschlag' : `${staffTotal} Vorschläge`} vorbereitet</h3><div class="home-staff-list">${staff
        .filter((a) => a.count)
        .map((a) => `<button class="btn small ${a.urgent ? 'primary' : ''}" data-action="view" data-view="assistenz">${esc(a.name)} <span class="flag ${a.urgent ? 'error' : 'info'}">${a.count}</span></button>`)
        .join('')}</div></section>`
    : ''
  return `${hero(c, views, { name, todoCount: t.count, staffTotal })}
  ${staffCard}${apptCard}
  <section class="home-grid" aria-label="Bereiche">${cards}</section>`
}

registerView({ id: 'home', order: 0, label: 'Übersicht', group: 'start', module: '*', noWeek: true, mobile: { icon: ICON.home, label: 'Start' }, render: homeView })
