// Seitenleiste (Bildschirme ab 701 px): Logo und App-Name, alle Bereiche der
// eigenen Rolle mit Symbolen und Zählern, unten Speicherstand, Konto und
// Darstellung. Zwischen 701 und 1180 px nur Symbole. Am Handy gibt es
// stattdessen Kopfzeile und Leiste unten (mobile.js).

import { appName } from './config.js'
import { app, VIEW_GROUPS, visibleViews } from './context.js'
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
  controlling: '<path d="M3.5 3.5v17h17M8 16.5v-4M12.5 16.5v-9M17 16.5v-6"/>',
  payroll: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  overtime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  staff: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  sites: '<path d="M19.5 10c0 5.5-7.5 11.5-7.5 11.5S4.5 15.5 4.5 10a7.5 7.5 0 0 1 15 0z"/><circle cx="12" cy="10" r="2.6"/>',
  assign: '<circle cx="9" cy="8" r="3.8"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0M19 8v6M22 11h-6"/>',
  absences: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M10 13.5l4 4M14 13.5l-4 4"/>',
  rules: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
  berechtigungen: '<rect x="4" y="10.5" width="16" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 15v2.5"/>',
  default: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12h7"/>',
}

export const navIcon = (view) => svg(view.icon || NAV_ICONS[view.id] || NAV_ICONS.default)

/** foot: Inhalt unten (Speicherstand, Konto, Darstellung) aus app.js */
export function sidebar(c, { foot = '' } = {}) {
  const b = app.config.brand
  const views = visibleViews()
  const logo = b.logo ? `<img class="brand-logo" src="${esc(b.logo)}" alt="${esc(b.name)}">` : ''
  const nav = VIEW_GROUPS.map(([group, label]) => {
    const items = views.filter((v) => v.group === group)
    if (!items.length) return ''
    return `<div class="sb-group">${label ? `<span class="sb-group-label">${esc(label)}</span>` : ''}${items
      .map((v) => {
        const badge = v.badge?.(c)
        return `<button class="tab sb-item" data-action="view" data-view="${v.id}" title="${esc(v.label)}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}>${navIcon(v)}<span class="sb-label">${esc(v.label)}</span>${badge ? `<span class="flag error">${badge}</span>` : ''}</button>`
      })
      .join('')}</div>`
  }).join('')
  return `<aside class="sidebar" aria-label="Bereiche">
    <div class="sb-brand">${logo}<div class="sb-app"><strong>${esc(appName(b))}</strong>${b.tagline ? `<small>${esc(b.tagline)}</small>` : ''}</div></div>
    <nav class="sb-nav" aria-label="Ansichten">${nav}</nav>
    <div class="sb-foot">${foot}</div>
  </aside>`
}
