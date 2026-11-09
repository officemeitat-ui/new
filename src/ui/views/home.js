// Übersicht (Startseite): alle Bereiche der eigenen Rolle auf einen Blick.
// Je Bereich eine Karte mit dem, was offen ist (Zähler der Ansichten), und
// einem Klick hinein; für die Einsatzplanung der Stand der Woche. Wer nur
// ein Werkzeug darf, sieht nur dessen Karte.

import { addDays, formatDate, isoWeek, todayISO } from '../../core/dates.js'
import { app, navSections, openModal, registerActions, registerModal, registerView, visibleViews } from '../context.js'
import { weekSteps } from '../flow.js'
import { todoOrLast } from '../modals/todo.js'
import { esc, ICON, modalFrame } from '../shared.js'
import { isMobile } from '../mobile.js'
import { navIcon } from '../sidebar.js'
import { cleo, moodFor } from '../mascot.js'
import { activeSeason, seasonDeco, seasonInfo } from '../season.js'
import { appointmentsOfDay } from './appointments.js'
import { proposalSummary } from './disponent.js'

/**
 * Karten anderer Module auf der Übersicht (z. B. Mattenwechsel für das Büro, „Meine Tour heute“ für Fahrer):
 * { id, available() → bool, render(c) → HTML }. Später geladene Module melden sie beim Laden an; nach dem Laden im
 * Hintergrund zeichnet die App neu (app.js). Die Rechnung bleibt im Modul, hier steht nur der Platz.
 */
const HOME_CARDS = []
export function registerHomeCard(card) {
  const i = HOME_CARDS.findIndex((x) => x.id === card.id)
  if (i >= 0) HOME_CARDS.splice(i, 1, card)
  else HOME_CARDS.push(card)
}
function moduleCards(c) {
  return HOME_CARDS.map((x) => {
    try {
      return x.available() ? x.render(c) : ''
    } catch (err) {
      console.warn('Übersicht:', err)
      return ''
    }
  }).join('')
}

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
  const season = seasonInfo(activeSeason())
  return `<section class="home-hero${season ? ' season-host' : ''}" aria-label="Begrüßung">${season ? seasonDeco(season.id, 'hero') : ''}
    <button class="home-hero-cleo" data-action="help-open" title="Cleo fragen: Hilfe zu jeder Funktion" aria-label="Cleo fragen">${cleo({ mood: moodFor({ open: todoCount, season: season?.mood }), outfit: season?.outfit, size: 124, label: season ? `Cleo, der Sauberheld – ${season.label}` : 'Cleo, der Sauberheld' })}</button>
    <div class="home-hero-text"><p class="home-hero-date">${esc(formatDate(today, { year: true }))} · KW ${week}${role}</p><h2>${greeting()}${name ? `, ${esc(name)}` : ''}</h2><p class="home-hero-sub">${todoCount ? `${todoCount} ${todoCount === 1 ? 'Punkt wartet' : 'Punkte warten'} in deinen Bereichen.` : 'Alles erledigt – schönen Tag!'} <button class="link-btn" data-action="help-open">Frag Cleo</button>, wenn du etwas suchst.</p></div>
    ${stats.length ? `<div class="home-hero-stats">${stats.join('')}</div>` : ''}
  </section>`
}

// ---------------------------------------------------------------- Handy: „Heute“ statt langer Karten

const sectionsOf = (views) => navSections(views).filter((s) => s.id !== 'start' && s.views.length)
const badgeOf = (c, v) => Number(v.badge?.(c)) || 0

/** Am Handy: kurze Begrüßung, drei Zahlen, „Als Nächstes“, Bereiche als Kacheln (Tippen öffnet die Liste des Bereichs). */
/**
 * Cleo spricht dich auf der Handy-Übersicht an: das Wichtigste jetzt, mit einem Knopf dazu
 * (offene Einsätze heute/morgen → Vertretung, Zu erledigen, nächster Termin, sonst Saison-Gruß).
 * Darunter das Fragefeld: Cleo kennt auch Plan, Abwesenheiten und Objekte („Wer arbeitet morgen?“).
 */
export function cleoTip(c, views, { todoCount = 0, nextAppts = [], season = null, now = new Date() } = {}) {
  const has = (id) => views.some((v) => v.id === id)
  const today = todayISO()
  const tomorrow = addDays(today, 1)
  // offene Plätze an einem Tag – nur im berechneten (und geladenen) Zeitraum, sonst wüsste Cleo es nicht
  const openOn = (d) => (d >= c.from && d <= c.to ? c.instances.filter((i) => i.date === d && i.status !== 'cancelled').reduce((n, i) => n + Math.max(0, i.staff - Math.min(c.state.count(i.key), i.staff)), 0) : 0)
  if (has('coverage') && c?.state) {
    const t = openOn(today)
    if (t) return { mood: 'zeigt', text: `Heute ${t === 1 ? 'ist noch ein Einsatz' : `sind noch ${t} Einsätze`} offen. Soll ich dir zeigen, wer einspringen kann?`, label: 'Vertretung finden', action: 'view', data: 'data-view="coverage"' }
    const m = openOn(tomorrow)
    if (m) return { mood: 'liste', text: `Morgen ${m === 1 ? 'ist noch ein Einsatz' : `sind noch ${m} Einsätze`} offen. Jetzt ist noch Zeit zum Umplanen.`, label: 'Vertretung finden', action: 'view', data: 'data-view="coverage"' }
  }
  const next = nextAppts.find(({ d, a, allDay }) => d === today && (allDay || a.start.slice(11, 16) >= now.toTimeString().slice(0, 5)))
  if (todoCount) return { mood: 'liste', text: `${todoCount === 1 ? 'Ein Punkt wartet' : `${todoCount} Punkte warten`} auf dich.${next ? ` Und um ${next.allDay ? 'heute' : esc(next.a.start.slice(11, 16))} kommt „${esc(next.a.title)}“.` : ''}`, label: 'Zeig sie mir', action: 'open-todo', data: '' }
  if (next) return { mood: 'handy', text: `${next.allDay ? 'Heute' : `Um ${esc(next.a.start.slice(11, 16))}`} steht „${esc(next.a.title)}“ an.`, label: 'Termin öffnen', action: 'appt-open', data: `data-id="${esc(next.a.id)}" data-occ="${esc(next.a.occ || '')}"` }
  if (season?.hello) return { mood: season.mood || 'froh', text: esc(season.hello), label: '', action: '', data: '' }
  return { mood: 'daumen', text: 'Alles erledigt – sauber! Wenn du etwas suchst, frag mich einfach.', label: '', action: '', data: '' }
}

function cleoSays(c, views, opts) {
  const tip = cleoTip(c, views, opts)
  const asks = [views.some((v) => v.id === 'week') && 'Wer arbeitet morgen?', views.some((v) => v.id === 'week') && 'Wer ist diese Woche abwesend?', 'Wie trage ich Urlaub ein?'].filter(Boolean)
  return `<section class="m-cleo-card" aria-label="Cleo – Begrüßung und Tipp">
    <button class="m-cleo-avatar" data-action="help-open" aria-label="Cleo fragen">${cleo({ mood: tip.mood, outfit: opts.season?.outfit, size: 64, label: 'Cleo, der Sauberheld' })}</button>
    <div class="m-cleo-bubble"><p>${opts.hello ? `<b>${opts.hello}</b> ` : ''}${tip.text}</p>${tip.label ? `<button class="btn small primary" data-action="${tip.action}" ${tip.data}>${esc(tip.label)}</button>` : ''}</div>
    <button class="m-ask" data-action="help-open">${ICON.search}<span>Frag Cleo, z. B. „${esc(asks[0])}“</span></button>
  </section>`
}

function phoneHome(c, views, { name, todoCount, staffTotal, nextAppts }) {
  const has = (id) => views.some((v) => v.id === id)
  const today = todayISO()
  const season = seasonInfo(activeSeason())
  const stat = (n, label, action, data = '', hot = false) => `<button class="m-stat ${hot && n ? 'hot' : ''}" data-action="${action}" ${data}><b>${n}</b><span>${label}</span></button>`
  const stats = [
    stat(todoCount, 'zu erledigen', 'open-todo', '', true),
    has('week') && c?.week ? (() => { const n = openSlots(c); return stat(n, n === 1 ? 'offener Einsatz' : 'offene Einsätze', 'view', 'data-view="week"', true) })() : '',
    has('termine') ? (() => { const n = appointmentsOfDay(today).length; return stat(n, n === 1 ? 'Termin heute' : 'Termine heute', 'view', 'data-view="termine"') })() : '',
  ].filter(Boolean)
  const sections = sectionsOf(views)
  // die Ansichten mit den meisten offenen Punkten zuerst
  const open = sections.flatMap((s) => s.views.map((v) => ({ v, n: badgeOf(c, v), s }))).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  const row = (icon, label, flag, attrs, sec = '') => `<button class="m-row" ${attrs} ${sec ? `data-section="${esc(sec)}"` : ''}><span class="m-row-icon">${icon}</span><span class="m-row-label">${label}</span>${flag ? `<span class="flag error">${flag}</span>` : ''}${ICON.right}</button>`
  const rows = [
    ...open.slice(0, 5).map(({ v, n, s }) => row(navIcon(v), esc(v.label), n, `data-action="view" data-view="${esc(v.id)}"`, s.id)),
    staffTotal && !open.some((x) => x.v.id === 'assistenz') ? row(ICON.bolt, `${staffTotal === 1 ? '1 Vorschlag' : `${staffTotal} Vorschläge`} der digitalen Mitarbeiter`, 0, 'data-action="view" data-view="assistenz"') : '',
    ...nextAppts.slice(0, 3).map(({ a, d, allDay }) => row(ICON.calendar, `<b>${esc(a.title)}</b> <small class="muted">${d === today ? 'heute' : 'morgen'} ${allDay ? 'ganztägig' : esc(a.start.slice(11, 16))}</small>`, 0, `data-action="appt-open" data-id="${esc(a.id)}" data-occ="${esc(a.occ || '')}"`)),
  ].filter(Boolean)
  const tiles = sections
    .map((s) => {
      const n = s.views.reduce((sum, v) => sum + badgeOf(c, v), 0)
      return `<button class="m-tile" data-section="${esc(s.id)}" data-action="home-section" data-sec="${esc(s.id)}"><span class="m-tile-icon">${navIcon(s.views[0])}</span><span>${esc(s.label)}</span>${n ? `<span class="flag error">${n}</span>` : ''}</button>`
    })
    .join('')
  return `<div class="m-home">
    ${cleoSays(c, views, { todoCount, nextAppts, season, hello: `${greeting()}${name ? `, ${esc(name)}` : ''}!` })}
    ${stats.length ? `<div class="m-stats">${stats.join('')}</div>` : ''}
    ${moduleCards(c)}
    ${rows.length ? `<section class="m-sec"><h3>Als Nächstes</h3><div class="m-list">${rows.join('')}</div></section>` : '<p class="m-done"><span class="pill ok">Alles erledigt</span> Schönen Tag!</p>'}
    <section class="m-sec"><h3>Bereiche</h3><div class="m-tiles">${tiles}</div></section>
  </div>`
}

/** Liste eines Bereichs (von den Kacheln der Handy-Übersicht und von einem Bereich in der Leiste unten). */
registerModal('home-section', (c, m) => {
  const s = sectionsOf(visibleViews().filter((v) => v.id !== 'home')).find((x) => x.id === m.sec)
  if (!s) return ''
  return modalFrame({
    title: s.label,
    body: `<div class="m-list" data-section="${esc(s.id)}">${s.views.map((v) => { const n = badgeOf(c, v); return `<button class="m-row" data-action="view" data-view="${esc(v.id)}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}><span class="m-row-icon">${navIcon(v)}</span><span class="m-row-label">${esc(v.label)}${v.text ? `<small class="muted">${esc(v.text)}</small>` : ''}</span>${n ? `<span class="flag error">${n}</span>` : ''}${ICON.right}</button>` }).join('')}</div>`,
  })
})

registerActions({ 'home-section': (el) => openModal({ type: 'home-section', sec: el.dataset.sec }) })

function homeView(c) {
  const views = visibleViews().filter((v) => v.id !== 'home')
  const t = todoOrLast()
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
  if (isMobile()) return phoneHome(c, views, { name, todoCount: t.count, staffTotal, nextAppts })
  return `${hero(c, views, { name, todoCount: t.count, staffTotal })}
  ${staffCard}${apptCard}${moduleCards(c)}
  <section class="home-grid" aria-label="Bereiche">${cards}</section>`
}

registerView({ id: 'home', order: 0, label: 'Übersicht', group: 'start', module: '*', noWeek: true, mobile: { icon: ICON.home, label: 'Start' }, render: homeView })
