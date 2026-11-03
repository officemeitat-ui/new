// Seitenleiste (Bildschirme ab 701 px): Logo und App-Name, „Springen zu …“
// (Strg+K), angeheftete Bereiche, dann alle Bereiche der eigenen Rolle in
// einklappbaren Abschnitten mit Symbolen und Zählern, unten Speicherstand,
// Konto und Darstellung. Zwischen 701 und 1180 px nur Symbole. Am Handy gibt es
// stattdessen Kopfzeile und Leiste unten (mobile.js).

import { appName } from './config.js'
import { app, navSections, pinnedViews, registerActions, renderNow, sectionOf, VIEWS, visibleViews } from './context.js'
import { esc } from './shared.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

/** Symbole je Ansicht (24er-Raster, Strich). Eigene Ansichten geben `icon` (SVG-Inhalt) bei registerView mit. */
export const NAV_ICONS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/>',
  week: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  timeline: '<path d="M4 6h9M8 12h12M6 18h8"/>',
  sheet: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h7"/>',
  objects: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8.5 7h1M14.5 7h1M8.5 11h1M14.5 11h1"/>',
  coverage: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5c1.8.8 3 2.7 3 5.5"/>',
  due: '<path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5L3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>',
  waste: '<path d="M3.5 6.5h17M9 6.5V4h6v2.5M5.5 6.5l1 14h11l1-14M10 10.5v6M14 10.5v6"/>',
  report: '<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  zaehler: '<path d="M12 2.8C9.2 6.6 6.2 10 6.2 13.6a5.8 5.8 0 0 0 11.6 0C17.8 10 14.8 6.6 12 2.8z"/>',
  kontrolle: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h2M8.5 14l2.5 2.5 4.5-5"/>',
  objektmappe: '<path d="M3 4.5h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H3zM21 4.5h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H21z"/>',
  matten: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M7 9.5h10M7 12h10M7 14.5h10"/>',
  fahrzeuge: '<path d="M5 17H3.5v-4.5L5.5 7h13l2 5.5V17H19M5 12.5h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
  wetter: '<path d="M7 16.5h10.5a3.8 3.8 0 0 0 .4-7.6A6 6 0 0 0 6.3 10.1 3.2 3.2 0 0 0 7 16.5z"/><path d="M8.5 20v1.5M12 19.5v2M15.5 20v1.5"/>',
  controlling: '<path d="M3.5 3.5v17h17M8 16.5v-4M12.5 16.5v-9M17 16.5v-6"/>',
  payroll: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  overtime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  staff: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  sites: '<path d="M19.5 10c0 5.5-7.5 11.5-7.5 11.5S4.5 15.5 4.5 10a7.5 7.5 0 0 1 15 0z"/><circle cx="12" cy="10" r="2.6"/>',
  assign: '<circle cx="9" cy="8" r="3.8"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0M19 8v6M22 11h-6"/>',
  absences: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M10 13.5l4 4M14 13.5l-4 4"/>',
  rules: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  berechtigungen: '<rect x="4" y="10.5" width="16" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 15v2.5"/>',
  termine: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><circle cx="15.5" cy="15.5" r="3.2"/><path d="M15.5 14v1.6l1 .8"/>',
  zeiten: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4.2l2.8 1.8M9.5 2.5h5M12 2.5V5"/>',
  fakturierung: '<path d="M6 2.5h9l4 4V21l-2.2-1.4L14.6 21l-2.3-1.4L10 21l-2.2-1.4L5.6 21V3.5a1 1 0 0 1 .4-1z"/><path d="M9 8h4M9 11.5h6M9 15h6"/>',
  default: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12h7"/>',
}

export const navIcon = (view) => svg(view.icon || NAV_ICONS[view.id] || NAV_ICONS.default)

const PIN = svg('<path d="M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.5l-5.2 2.7 1-5.8L3.6 9.3l5.8-.8z"/>')
const CHEVRON = svg('<path d="M9 6l6 6-6 6"/>')

/** Ein Eintrag der Seitenleiste; pin: Knopf zum Anheften (bei Mausbedienung sichtbar beim Darüberfahren). */
function navItem(c, v, { pinned = false } = {}) {
  const badge = v.badge?.(c)
  return `<div class="sb-row"><button class="tab sb-item" data-action="view" data-view="${v.id}" title="${esc(v.label)}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}>${navIcon(v)}<span class="sb-label">${esc(v.label)}</span>${badge ? `<span class="flag error">${badge}</span>` : ''}</button><button class="sb-pin" data-action="nav-pin" data-view="${v.id}" aria-pressed="${pinned}" title="${pinned ? 'Nicht mehr anheften' : 'Oben anheften'}" aria-label="${esc(v.label)} ${pinned ? 'nicht mehr anheften' : 'anheften'}">${PIN}</button></div>`
}

/** Ist ein Abschnitt aufgeklappt? Der Abschnitt der offenen Ansicht immer. */
export function sectionOpen(id) {
  const current = sectionOf(VIEWS.find((v) => v.id === app.ui.view))
  return id === 'start' || id === current || (app.ui.navOpen || []).includes(id)
}

/** foot: Inhalt unten (Speicherstand, Konto, Darstellung) aus app.js */
export function sidebar(c, { foot = '' } = {}) {
  const b = app.config.brand
  const views = visibleViews()
  const logo = b.logo ? `<img class="brand-logo" src="${esc(b.logo)}" alt="${esc(b.name)}">` : ''
  const pinned = pinnedViews(views)
  const pinnedIds = new Set(pinned.map((v) => v.id))
  const pinBlock = pinned.length ? `<div class="sb-group sb-pinned"><span class="sb-group-label">Angeheftet</span>${pinned.map((v) => navItem(c, v, { pinned: true })).join('')}</div>` : ''
  const sections = navSections(views)
  const start = sections.filter((s) => !s.label).map(({ views: items }) => `<div class="sb-group">${items.map((v) => navItem(c, v, { pinned: pinnedIds.has(v.id) })).join('')}</div>`).join('')
  const nav = sections
    .filter((s) => s.label)
    .map(({ id, label, views: items }) => {
      const open = sectionOpen(id)
      const open_ = items.reduce((n, v) => n + (Number(v.badge?.(c)) || 0), 0)
      return `<div class="sb-group ${open ? '' : 'closed'}"><button class="sb-group-head" data-action="nav-section" data-section="${id}" aria-expanded="${open}"><span class="sb-group-label">${esc(label)}</span>${!open && open_ ? `<span class="flag error">${open_}</span>` : ''}${CHEVRON}</button><div class="sb-group-items">${items.map((v) => navItem(c, v, { pinned: pinnedIds.has(v.id) })).join('')}</div></div>`
    })
    .join('')
  return `<aside class="sidebar" aria-label="Bereiche">
    <div class="sb-brand">${logo}<div class="sb-app"><strong>${esc(appName(b))}</strong>${b.tagline ? `<small>${esc(b.tagline)}</small>` : ''}</div></div>
    <button class="sb-jump" data-action="open-search" title="Bereich, Person oder Objekt suchen (Strg+K)">${svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>')}<span class="sb-label">Springen zu …</span><kbd>Strg K</kbd></button>
    <nav class="sb-nav" aria-label="Ansichten">${start}${pinBlock}${nav}</nav>
    <div class="sb-foot">${foot}</div>
  </aside>`
}

registerActions({
  'nav-section': (el) => {
    const id = el.dataset.section
    const list = new Set(app.ui.navOpen || [])
    if (sectionOpen(id) && !list.has(id)) return // Abschnitt der offenen Ansicht bleibt offen
    if (list.has(id)) list.delete(id)
    else list.add(id)
    app.ui.navOpen = [...list]
    app.savePrefs?.()
    renderNow()
  },
  'nav-pin': (el) => {
    const id = el.dataset.view
    const list = (app.ui.pinned || []).filter((x) => x !== id)
    if (list.length === (app.ui.pinned || []).length) list.push(id)
    app.ui.pinned = list.slice(-8)
    app.savePrefs?.()
    renderNow()
  },
})
