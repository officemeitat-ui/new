// Start der App: Konfiguration laden, anmelden (SharePoint) oder Browser-
// Ablage wählen, Daten laden, Rahmen zeichnen, Ereignisse verteilen.

import './views/index.js'

import { MODULES, resolveAccess } from '../core/access.js'
import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../core/dates.js'
import { DEFAULT_RULES } from '../core/rules.js'
import { DEFAULT_SKILLS } from '../core/skills.js'
import { LocalDocStore } from '../storage/docstore-local.js'
import { SharePointDocStore } from '../storage/docstore-sharepoint.js'
import { DataService, dataRights, FOLDERS } from '../storage/data-service.js'
import { adoptLegacyCache, CachedDocStore, createOfflineCache } from '../storage/offline.js'
import { applyBrand, loadConfig } from './config.js'
import { ACTIONS, app, canEdit, clearUndo, closeModal, labelTables, moduleOf, navSections, preloadLazy, render, renderNow, saveStatusText, sectionLabel, sectionOf, setFrame, toast, undo, viewFromHash, visibleViews } from './context.js'
import { loadTopics } from '../help/lazy.js'
import { bellButton, refreshBell, showTodoIfNew } from './modals/todo.js'
import { flowBar } from './flow.js'
import { bottomNav, isMobile, mobileTopbar, roleSwitch, watchDevice } from './mobile.js'
import { navIcon, sidebar } from './sidebar.js'
import { closeMenus } from './menus.js'
import { planWeek, seedDemoHistory } from './planning.js'
import { syncTools, toolUrls, warmLastTool } from './views/tools.js'
import { searchButton } from './search.js'
import { quickButton } from './quick.js'
import { assistantButton } from './assistant.js'
import { renderHelp } from './help.js'
import { setupActions, setupHtml } from './setup.js'
import { applyTheme, themeButton } from './theme.js'
import { startWeather } from './weather.js'
import { agoText, startSync, syncState } from './sync.js'
import { download, esc, ICON, menu } from './shared.js'
import { canMailView } from './mailer.js'
import { bindDragEvents, bindFilterEvents } from './views/week.js'

const PREFS_KEY = 'einsatzplaner.prefs.v2'
const LEGACY_KEY = 'einsatzplaner.data.v1'

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    return {}
  }
}

function writePrefs() {
  const { view, monday, employeeId, team, region, previewRole, skin, mode, scale, look, lastTool, pinned, navOpen } = app.ui
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ view, monday, employeeId, team, region, previewRole, skin, mode, scale, look, lastTool, pinned, navOpen }))
  } catch {
    /* Browser erlaubt keine Speicherung */
  }
}

function emptyData() {
  return { version: 1, employees: [], objects: [], tasks: [], absences: [], assignments: {}, overrides: {}, skills: [...DEFAULT_SKILLS], extraFreeDays: [], travel: {}, rules: { ...DEFAULT_RULES, minor: { ...DEFAULT_RULES.minor } } }
}

function legacyData() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- Rahmen
// Ab 701 px: Seitenleiste mit allen Bereichen (sidebar.js) und schlanke
// Kopfleiste über dem Inhalt (Titel, Wochenwahl, wenige Knöpfe, „⋯“).
// Am Handy: Kopfzeile mit Logo und Woche, Leiste unten (mobile.js).

function brandBlock() {
  const b = app.config.brand
  const logo = b.logo ? `<img class="brand-logo" src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<span class="brand-word">${esc(b.name)}</span>`
  return `<div class="brand">${logo}<div class="brand-text"><strong>${esc(b.product)}</strong><small>${esc(b.tagline)}</small></div></div>`
}

/** Weniger gebrauchte Aktionen im Menü „⋯“, nach Zweck gegliedert. */
function moreMenu(plan) {
  const canSync = app.store?.kind === 'sharepoint' || app.config?.storage === 'local'
  return menu({
    icon: ICON.more,
    title: 'Weitere Aktionen',
    btn: 'icon ghost',
    caret: false,
    single: false,
    cls: 'more-menu',
    items: [
      plan && { heading: 'Diese Woche' },
      plan && { label: 'Veröffentlichen', icon: ICON.send, action: 'open-publish' },
      plan && { label: 'Neu planen', icon: ICON.bolt, action: 'replan', title: 'Nicht fixierte Einteilungen dieser Woche verwerfen und neu planen' },
      plan && { label: 'An Mitarbeitende versenden', icon: ICON.send, action: 'open-send' },
      { heading: 'E-Mail' },
      canMailView() && { label: 'Diese Ansicht per E-Mail', icon: ICON.send, action: 'mail-view', hint: 'als PDF-Bericht mit Tabellen' },
      { label: 'Aufgabe per E-Mail', icon: ICON.check, action: 'mail-task-new', hint: 'mit Kalender-Erinnerung' },
      { label: 'Neue E-Mail', icon: ICON.send, action: 'mail-compose-open' },
      (!app.access || app.access.all) && { label: 'Berichte automatisch', icon: ICON.calendar, action: 'mail-reports-open', hint: 'z. B. jeden Montag die Kennzahlen' },
      { heading: 'App' },
      canSync && { label: 'Jetzt abgleichen', icon: ICON.refresh, action: 'sync-now', hint: `zuletzt ${agoText(syncState.lastAt)}` },
      (!app.access || app.access.all) && { label: 'Daten & Sicherung', icon: ICON.folder, action: 'open-data' },
      { label: 'Darstellung', icon: ICON.palette, action: 'theme-open' },
      ACTIONS['quick-keys'] && { label: 'Tastenkürzel', icon: ICON.list, action: 'quick-keys', kbd: '?' },
      app.signOut && { heading: 'Konto' },
      app.signOut && { label: 'Abmelden', icon: ICON.user, action: 'sign-out', hint: app.user?.name ? esc(app.user.name) : '' },
    ],
  })
}

/** Bereich der Ansicht als Aufklappmenü: springt zu den anderen Ansichten desselben Bereichs. */
function sectionSwitch(c, view) {
  const id = sectionOf(view)
  const label = sectionLabel(id)
  if (!label) return ''
  const views = navSections().find((s) => s.id === id)?.views || []
  if (views.length < 2) return `<span class="crumb-label">${esc(label)}</span>`
  return menu({
    label: esc(label),
    btn: 'ghost small crumb-btn',
    cls: 'start crumb-menu',
    title: `Andere Ansichten unter „${label}“`,
    single: false,
    items: [
      { heading: esc(label) },
      ...views.map((v) => ({ label: esc(v.label), icon: navIcon(v), action: 'view', data: { view: v.id }, current: v.id === view.id, flag: v.badge?.(c) || 0 })),
    ],
  })
}

function topbar(c) {
  const { year, week } = isoWeek(c.monday)
  const published = c.published
  const changed = published?.snapshot ? c.ctx.employees.filter((e) => c.changedSincePublish(e)).length : 0
  // Ansichten ohne Wochenbezug (Zähler, Kontrollen): Titel statt Wochenwahl
  const view = visibleViews().find((v) => v.id === app.ui.view)
  const title = view?.noWeek ? { label: view.label, sub: formatDate(todayISO(), { year: true }) } : null
  if (isMobile()) {
    const short = published ? (changed ? `${changed} geändert` : 'veröffentlicht') : 'Entwurf'
    return mobileTopbar(c, { brand: brandBlock(), week, year, range: `${formatDate(c.monday, { weekday: false })}–${formatDate(c.sunday, { weekday: false })}`, status: short, title })
  }
  const status = published ? (changed ? `<span class="pill warning">veröffentlicht · ${changed} geändert</span>` : '<span class="pill ok">veröffentlicht</span>') : '<span class="pill info">Entwurf</span>'
  const crumb = view ? sectionSwitch(c, view) : ''
  const head = !view
    ? ''
    : title
      ? `<nav class="crumbs" aria-label="Pfad">${crumb ? `${crumb}<span class="sep" aria-hidden="true">/</span>` : ''}<b>${esc(view.label)}</b></nav>`
      : `<div class="crumbs page-crumbs">${crumb ? `${crumb}<span class="sep" aria-hidden="true">/</span>` : ''}<h1 class="page-title">${esc(view.label)}</h1></div><div class="weeknav">
      <button class="btn icon ghost" data-action="nav" data-delta="-7" aria-label="Vorige Woche">${ICON.left}</button>
      <div class="kw">KW ${week} / ${year}<small>${formatDate(c.monday, { weekday: false })} – ${formatDate(c.sunday, { weekday: false, year: true })}</small></div>
      <button class="btn icon ghost" data-action="nav" data-delta="7" aria-label="Nächste Woche">${ICON.right}</button>
      <button class="btn small" data-action="nav-today">Heute</button>
      ${status}
    </div>`
  // Planen nur in der Einsatzplanung; Veröffentlichen, Neu planen, Daten im Menü „⋯“
  const plan = canEdit('planung') && view?.group === 'plan'
  return `<header class="topbar"><div class="topbar-inner">
    <div class="page-head">${head}</div>
    <div class="actions">
      ${view?.actions ? view.actions(c) : ''}
      ${quickButton()}
      ${searchButton()}
      ${assistantButton()}
      ${bellButton()}
      ${plan ? `<button class="btn primary" data-action="plan" title="Freie Einsätze besetzen: zuerst Stammkräfte, dann Vertretungen. Bestehende Einteilungen bleiben.">${ICON.bolt} Woche planen</button>` : ''}
      ${moreMenu(plan)}
    </div>
  </div></header>`
}

/** Unten in der Seitenleiste: Speicherstand, angemeldete Person (oder Rollen-Vorschau), Darstellung. */
function sidebarFoot() {
  const role = app.access && !app.access.all ? app.access.label : ''
  const who = app.user
    ? `<div class="sb-user"><span class="user">${ICON.user} <span>${esc(app.user.name)}</span></span>${role ? `<small>${esc(role)}</small>` : ''}</div>`
    : roleSwitch()
  const status = saveStatusText(app.service.status)
  const canSync = app.store?.kind === 'sharepoint' || app.config?.storage === 'local'
  return `<div class="sb-status"><span id="save-status" class="save-status" title="${esc(status.replace(/<[^>]+>/g, ''))}">${status}</span>${canSync ? `<button class="sb-sync" data-action="sync-now" title="${esc(syncTitle())}" aria-label="Jetzt abgleichen">${ICON.refresh}</button>` : ''}</div>
    <div class="sb-account">${who}</div>
    <div class="sb-tools">${themeButton()}${app.signOut ? `<button class="btn small" data-action="sign-out" title="Abmelden">Abmelden</button>` : ''}</div>`
}

function summary(c) {
  const active = c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday)
  const slots = active.reduce((s, i) => s + i.staff, 0)
  const filled = active.reduce((s, i) => s + Math.min(c.state.count(i.key), i.staff), 0)
  const errors = c.validation.issues.filter((i) => i.severity === 'error' && i.code !== 'OPEN').length
  const hol = c.days.filter((d) => c.holidays.has(d)).map((d) => `${esc(c.holidays.get(d).name)} (${formatDate(d)})`)
  const cancelled = c.week.filter((i) => i.status === 'cancelled' && i.reason === 'holiday').length
  const moved = c.week.filter((i) => i.status === 'moved' && i.reason === 'holiday').length
  const absent = (app.data.absences || []).filter((a) => a.from <= c.sunday && a.to >= c.monday).length
  const holText = hol.length ? `${hol.join(', ')}<br><span class="muted" style="font-weight:400">${cancelled} Einsätze entfallen, ${moved} verschoben</span>` : '<span class="muted" style="font-weight:400">keine in dieser Woche</span>'
  return `${flowBar(c)}<section class="summary" aria-label="Kennzahlen der Woche">
    <div class="stat"><div class="label">Besetzt</div><div class="value">${filled} / ${slots}</div></div>
    <button class="stat ${slots - filled ? 'err' : ''}" data-action="view" data-view="coverage"><div class="label">Offen</div><div class="value">${slots - filled}</div></button>
    <button class="stat ${errors ? 'err' : ''}" data-action="view" data-view="report"><div class="label">Verstöße</div><div class="value">${errors}</div></button>
    <button class="stat ${c.validation.counts.warning ? 'warn' : ''}" data-action="view" data-view="report"><div class="label">Zu prüfen</div><div class="value">${c.validation.counts.warning}</div></button>
    <button class="stat" data-action="view" data-view="absences"><div class="label">Abwesend</div><div class="value">${absent}</div></button>
    <div class="stat hol"><div class="label">Feiertage</div><div class="value">${holText}</div></div>
  </section>`
}

function welcome() {
  if (app.data.employees.length || app.readOnly || !canEdit('stammdaten')) return ''
  return `<div class="banner welcome"><div><h2>Willkommen</h2><p>Noch keine Daten in der Ablage. Am schnellsten geht es mit den bestehenden Excel-Listen: Mitarbeitende einfügen, dann Objekte und Leistungen mit Stammkraft.</p></div>
    <div class="actions"><button class="btn primary" data-action="import-open" data-kind="employees">${ICON.upload} Mitarbeitende einfügen</button><button class="btn" data-action="import-open" data-kind="tasks">${ICON.upload} Objekte & Leistungen einfügen</button><button class="btn" data-action="open-data">Beispieldaten laden</button></div></div>`
}

/** Veröffentlichte Woche, die schon begonnen hat und danach geändert wurde: Korrektur buchen. */
function correctionBanner(c) {
  if (!c.published?.snapshot || app.readOnly || c.monday > todayISO()) return ''
  const changed = c.ctx.employees.filter((e) => c.changedSincePublish(e))
  if (!changed.length) return ''
  const names = changed.slice(0, 4).map((e) => esc(e.name)).join(', ') + (changed.length > 4 ? ' …' : '')
  return `<div class="banner warn-banner"><p><strong>Rückwirkend geändert.</strong> KW ${isoWeek(c.monday).week} ist veröffentlicht und wurde danach geändert (${names}). Damit Zeitkonto und Lohnverrechnung stimmen, die Korrektur buchen.</p><button class="btn primary" data-action="open-publish">${ICON.send} Korrektur buchen</button></div>`
}

function frame(c) {
  const views = visibleViews()
  const mobile = isMobile()
  const shell = (content) => (mobile ? `${topbar(c)}<main class="wrap">${content}</main>${views.length ? bottomNav(c) : ''}` : `<div class="layout">${sidebar(c, { foot: sidebarFoot() })}<div class="layout-main">${views.length ? topbar(c) : ''}<main class="wrap">${content}</main></div></div>`)
  if (!views.length) return shell('<div class="banner"><p><strong>Kein Bereich freigegeben.</strong> Dein Konto ist keiner Gruppe dieser App zugeordnet. Bitte im Büro oder bei der IT melden.</p></div>')
  const view = views.find((v) => v.id === app.ui.view) || views[0]
  app.ui.view = view.id
  // Leserechte je Modul der aktuellen Ansicht
  app.readOnly = view.module === '*' ? false : !canEdit(moduleOf(view))
  // Woche ohne Netz und ohne Kopie im Gerät: leer anzeigen, aber nichts ändern lassen (sonst würde ein leerer Plan gespeichert)
  const missingWeek = view.group === 'plan' && !view.noWeek && app.service?.weekUnavailable?.(c.monday)
  const readOnly = missingWeek
    ? `<div class="banner warn-banner"><p><strong>KW ${isoWeek(c.monday).week} ist ohne Verbindung nicht verfügbar.</strong> Sie wurde auf diesem Gerät noch nie geöffnet. Sobald wieder Netz da ist, wird sie geladen.</p></div>`
    : app.readOnly
      ? `<div class="banner"><p><strong>Nur lesen.</strong> ${app.access ? `Deine Rolle (${esc(app.access.label)}) darf im Bereich „${esc(MODULES[moduleOf(view)] || '')}“ nichts ändern.` : ''}</p></div>`
      : ''
  app.locked = !!missingWeek
  if (missingWeek) app.readOnly = true
  // Willkommen (leere Ablage) nur in Einsatzplanung und Stammdaten, nicht über den Werkzeugen
  return shell(`${readOnly}${['plan', 'stamm', 'start'].includes(view.group) ? welcome() : ''}${view.group === 'plan' ? correctionBanner(c) : ''}${view.summary ? summary(c) : ''}${view.render(c)}`)
}

setFrame({
  frame,
  afterRender: () => {
    document.body.classList.toggle('readonly', app.readOnly)
    document.body.classList.toggle('mobile', isMobile())
    labelTables()
    writePrefs()
    refreshBell()
    syncTools()
    renderHelp()
  },
})

// ---------------------------------------------------------------- Abgleich

const syncTitle = () => `Jetzt mit ${app.store?.kind === 'sharepoint' ? 'SharePoint' : 'der Ablage'} abgleichen · zuletzt ${agoText(syncState.lastAt)}${syncState.error ? ` · Fehler: ${syncState.error}` : ''}`
function updateSyncTitle() {
  const btn = document.querySelector('.sb-sync')
  if (btn) {
    btn.title = syncTitle()
    btn.classList.toggle('spinning', syncState.running)
  }
}
setInterval(updateSyncTitle, 15e3)

// ---------------------------------------------------------------- Aktionen

Object.assign(ACTIONS, {
  'sync-now': async () => {
    document.querySelector('.sb-sync')?.classList.add('spinning')
    await app.service.flushNow?.()
    await app.sync?.sync()
    updateSyncTitle()
    toast(syncState.error ? `Abgleich nicht möglich: ${syncState.error}` : `Abgeglichen ${new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`)
  },
  nav: (el) => {
    app.ui.monday = addDays(app.ui.monday, Number(el.dataset.delta))
    app.ui.month = null
    render()
  },
  'nav-today': () => {
    app.ui.monday = mondayOf(todayISO())
    app.ui.month = null
    render()
  },
  view: (el) => {
    app.ui.view = el.dataset.view
    app.ui.confirm = null
    app.ui.modal = null
    // Adresse zum Speichern als Lesezeichen, z. B. app.firma.at/#zaehler
    try {
      history.replaceState(null, '', `#${app.ui.view}`)
    } catch {
      /* eingebettete Vorschau */
    }
    render()
    window.scrollTo({ top: 0 })
  },
  plan: () => {
    if (!canEdit('planung') || app.locked) return toast(app.locked ? 'Diese Woche ist ohne Verbindung nicht geladen.' : 'Nur Leserechte.')
    app.ui.modal = null
    planWeek(false)
  },
  replan: () => {
    if (!canEdit('planung') || app.locked) return toast(app.locked ? 'Diese Woche ist ohne Verbindung nicht geladen.' : 'Nur Leserechte.')
    app.ui.modal = null
    planWeek(true)
  },
  'preview-role': (el) => {
    app.ui.previewRole = el.value === 'disposition' ? null : el.value
    app.access = resolveAccess({ preview: app.ui.previewRole, access: app.config.access })
    app.ui.modal = null
    render().then(loadInBackground)
    toast(app.ui.previewRole ? `Vorschau: so sieht es die Rolle „${el.options[el.selectedIndex].text}“.` : 'Vorschau beendet: alle Bereiche.')
  },
  'close-modal': closeModal,
  reload: () => location.reload(),
  undo: () => (app.readOnly ? toast('Nur Leserechte.') : undo()),
  backdrop: (el, e) => {
    if (e.target === el) closeModal()
  },
  'sign-out': async () => {
    await app.service.flush().catch(() => {})
    // Kopie der Daten im Gerät löschen (geteilte Geräte); Ungespeichertes und wartende Fotos bleiben
    // im Speicher dieses Kontos und werden bei der nächsten Anmeldung gespeichert
    if (app.offline) await Promise.all(['docs', 'meta'].map((s) => app.offline.clear?.(s)))
    app.signOut?.()
  },
  'switch-account': () => app.switchAccount?.(),
})

/** Tab bleibt im offenen Dialog (aria-modal): vom letzten Feld weiter zum ersten und umgekehrt. */
function keepFocusInModal(e) {
  const modal = document.querySelector('#modal-root .modal')
  if (!modal) return
  const list = [...modal.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length)
  if (!list.length) return
  const inside = modal.contains(document.activeElement)
  const edge = e.shiftKey ? list[0] : list.at(-1)
  if (!inside || document.activeElement === edge) {
    e.preventDefault()
    ;(e.shiftKey ? list.at(-1) : list[0]).focus()
  }
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    // Aufklappmenüs: Klick daneben oder auf einen Eintrag schließt sie (menus.js)
    for (const menu of document.querySelectorAll('details.menu-wrap[open]')) if (!menu.contains(e.target) || e.target.closest('.menu [data-action]')) menu.open = false
    const el = e.target.closest('[data-action]')
    if (!el || el.disabled) return
    const handler = ACTIONS[el.dataset.action]
    if (handler) handler(el, e)
  })
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ts-employee') {
      app.ui.employeeId = e.target.value
      renderNow()
    }
    // Formularteile ein-/ausblenden: <select data-toggle="x"> steuert [data-x="wert"]
    const toggle = e.target.dataset.toggle
    if (toggle) for (const el of document.querySelectorAll(`[data-${toggle}]`)) el.hidden = el.dataset[toggle] !== e.target.value
    // <input data-change="aktion">: Aktion bei Änderung (z. B. Datei gewählt)
    const handler = ACTIONS[e.target.dataset.change]
    if (handler) handler(e.target, e)
  })
  // <input data-input="aktion">: Aktion beim Tippen (kurz verzögert)
  let inputTimer = null
  document.addEventListener('input', (e) => {
    const handler = ACTIONS[e.target.dataset.input]
    if (!handler) return
    clearTimeout(inputTimer)
    inputTimer = setTimeout(() => handler(e.target, e), 200)
  })
  bindFilterEvents(document)
  bindDragEvents(document)
  watchDevice()
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeMenus()) return // erst das Menü, beim nächsten Esc der Dialog
    if (e.key === 'Escape' && app.ui.modal) closeModal()
    if (e.key === 'Tab' && app.ui.modal) keepFocusInModal(e)
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && !app.readOnly) {
      e.preventDefault()
      undo()
    }
  })
  window.addEventListener('beforeunload', (e) => {
    if (app.service?.hasPendingChanges()) {
      app.service.flush()
      e.preventDefault()
    }
  })
}

// ---------------------------------------------------------------- Start

/** Ablage nur im Arbeitsspeicher (Rollen ohne eigene Daten in der App). */
function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size } }
}

function showMessage(html) {
  document.getElementById('app').innerHTML = `<div class="wrap boot">${html}</div>`
}

async function boot() {
  const config = await loadConfig()
  config.features = { excel: true, pdf: true, download: true, print: true, mail: false, calendar: false, ...(config.features || {}) }
  app.config = config
  app.savePrefs = writePrefs
  applyBrand(config.brand)
  // Darstellung sofort, damit nichts in den falschen Farben aufblitzt
  applyTheme(readPrefs(), config.brand)
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(app.ui, config.brand))
  bindEvents()

  let store
  let local = null
  if (config.storage === 'sharepoint') {
    // Microsoft-Anmeldung geht nur über HTTPS (z. B. Webspace ohne Weiterleitung, mit http:// aufgerufen)
    if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`)
      return
    }
    showMessage('<p>Anmeldung bei Microsoft 365 …</p>')
    const { memberGroups, scopesFor, signIn } = await import('../auth/msal.js')
    const auth = await signIn({ ...config.sharepoint, scopes: scopesFor(config) })
    app.auth = auth
    app.user = auth.user
    // Gruppen fehlen im Token (Token-Konfiguration ohne „groups“ oder zu viele): bei Microsoft Graph nachfragen
    if (Object.keys(config.access?.groups || {}).length && (!app.user.groups.length || app.user.groupsOverage)) {
      const more = await memberGroups(auth.getToken, { userId: app.user.id || app.user.email })
      if (more) Object.assign(app.user, { groups: [...new Set([...app.user.groups, ...more.groups])], groupsFrom: more.from })
    }
    app.signOut = auth.signOut
    // Hülle für den Offline-Betrieb: letzter Stand und ungespeicherte Änderungen bleiben im Gerät,
    // je Konto ein eigener Speicher (geteilte Tablets: niemand liest ohne Netz die Kopie eines anderen)
    local = createOfflineCache(`dienstplan-offline:${auth.user.id || auth.user.email}`)
    await adoptLegacyCache(local).catch(() => 0)
    // Rechte aus Microsoft-Gruppen und App-Rollen; ohne Zuordnung kein Zugriff
    app.access = resolveAccess({ roleClaims: app.user.roles, groupClaims: app.user.groups, email: app.user.email, access: config.access, strict: true })
    const rights = dataRights(app.access)
    if (FOLDERS.some(([, , path]) => rights.read(path))) {
      store = new CachedDocStore(new SharePointDocStore({ getToken: auth.getToken, ...config.sharepoint }), local)
      showMessage('<p>Verbinde mit SharePoint …</p>')
      // war das Gerät schon verbunden: gleich mit dem gemerkten Laufwerk starten, im Hintergrund prüfen
      await store.init({ quick: true })
    } else {
      // Rolle nur mit Werkzeugen (z. B. Vorarbeiter: Wasserzähler): kein Ordner der App nötig,
      // die Werkzeuge speichern selbst in SharePoint
      store = Object.assign(new LocalDocStore({ storage: memoryStorage() }), { label: 'Werkzeuge speichern selbst in SharePoint' })
    }
    app.offline = local
  } else {
    store = new LocalDocStore({ download })
  }
  app.store = store

  Object.assign(app.ui, readPrefs())
  const linked = viewFromHash(location.hash)
  if (linked) app.ui.view = linked
  if (config.storage !== 'sharepoint') app.access = resolveAccess({ preview: app.ui.previewRole, access: config.access })
  app.service = new DataService(store, {
    local,
    // nur die Ordner der eigenen Rolle lesen und schreiben (im Browser-Modus alles)
    rights: config.storage === 'sharepoint' ? dataRights(app.access) : null,
    // SharePoint: mit dem letzten Stand im Gerät starten, Neueres im Hintergrund nachladen
    quickStart: config.storage === 'sharepoint' && config.sharepoint?.quickStart !== false,
    blank: emptyData,
    onStatus: (status, detail) => {
      const el = document.getElementById('save-status')
      if (el) {
        el.innerHTML = saveStatusText(status, detail)
        el.title = el.textContent // Tablet: nur Punkt, Text als Tooltip
      }
      if (status === 'error') toast(`Speichern fehlgeschlagen: ${detail}`)
    },
    onSaved: (paths) => app.sync?.saved(paths),
    onRemoteChange: (kind, changed) => {
      app.dataVersion = (app.dataVersion || 0) + 1
      clearUndo()
      renderNow()
      if (kind === 'loaded') return // Woche nach Verbindungsausfall nachgeladen
      if (kind === 'merged') toast('Gleichzeitige Änderungen einer anderen Person wurden zusammengeführt.')
      else toast(`Aktualisiert: Änderungen von ${[...new Set(changed.map((x) => x.by).filter(Boolean))].join(', ') || 'anderer Sitzung'} geladen.`)
    },
  })

  // Beispieldaten nur im Browser-Modus mit Demo: eigenes Bündel, im Betrieb nicht geladen
  const seed = async () => {
    if (config.storage !== 'local') return emptyData()
    const legacy = config.migrateLegacy === false ? null : legacyData()
    if (legacy) return { ...emptyData(), ...legacy }
    return config.demo ? (await import('../data/demo.js')).createDemoData(app.ui.monday) : emptyData()
  }
  app.data = await app.service.load(seed)
  await render()
  if (app.service.missing?.size) toast(`Nicht gefunden: ${[...app.service.missing].join(', ')}. Entweder noch nicht angelegt (das Büro öffnet die App zuerst) oder es fehlt das Leserecht auf den Ordner in SharePoint.`)
  // frühere Ablage daten/plaene/ im Hintergrund umziehen (nur mit Schreibrecht auf die Pläne)
  if (config.storage === 'sharepoint') app.service.migrateOldWeeks().catch(() => 0)
  if (app.service.broken?.size) toast(`Beschädigte Datei in SharePoint (kein gültiges JSON): ${[...app.service.broken].join(', ')}. Der Bereich bleibt leer; bitte im Versionsverlauf eine frühere Fassung wiederherstellen.`)
  if (app.service.firstRun && config.storage === 'local' && config.demo && (config.migrateLegacy === false || !legacyData())) {
    await seedDemoHistory()
    renderNow()
  }
  // „Zu erledigen“ lädt Wochen und rechnet: nicht den Start aufhalten. Davor die später geladenen
  // Module der eigenen Bereiche (ihre Punkte gehören dazu) und Cleos Hilfe-Themen im Hintergrund holen.
  setTimeout(() => loadInBackground().catch(() => {}).then(() => showTodoIfNew()).catch(() => {}), 60)
  // Wetter (Winterdienst, Hitze, Sturm) im Hintergrund laden
  startWeather()
  // zuletzt benutztes Werkzeug (z. B. Wasserzähler) schon vorladen, damit es beim Öffnen bereit ist
  if (config.storage === 'sharepoint') setTimeout(warmLastTool, 2500)
  // Zuletzt ohne Netz Erfasstes gleich nachholen
  if (app.service.restored) {
    toast(`${app.service.restored} ${app.service.restored === 1 ? 'Änderung' : 'Änderungen'} aus der Zeit ohne Netz übernommen, wird gespeichert.`)
    app.service.refresh().catch(() => {})
  }
  // Abgleich: schnell, solange jemand arbeitet; sofort beim Zurückkommen und zwischen Fenstern (sync.js)
  const sp = config.storage === 'sharepoint' ? config.sharepoint || {} : {}
  app.sync = startSync({ service: app.service, fastSeconds: sp.fastSeconds || (config.storage === 'sharepoint' ? 20 : 15), idleSeconds: sp.refreshSeconds || (config.storage === 'sharepoint' ? 60 : 30), onChange: () => updateSyncTitle() })
  // Lesezeichen/Link mit #ansicht im laufenden Fenster
  window.addEventListener('hashchange', () => {
    const view = viewFromHash(location.hash)
    if (view && view !== app.ui.view) {
      app.ui.view = view
      app.ui.modal = null
      render()
    }
  })
  if (app.user?.groupsOverage) toast('Hinweis: Zu viele Gruppen im Microsoft-Konto, die Gruppen-Rechte fehlen. Bitte die IT bitten, in Entra ID nur „Sicherheitsgruppen“ bzw. „der App zugewiesene Gruppen“ ins Token zu geben.')
  window.addEventListener('offline', () => {
    const el = document.getElementById('save-status')
    if (el && app.store?.kind === 'sharepoint') el.innerHTML = saveStatusText('offline', String(app.service.pendingCount()))
  })
  registerServiceWorker()
}

/**
 * Nach dem ersten Zeichnen: Module, die erst bei Bedarf kommen (views/lazy.js), für die Bereiche der
 * eigenen Rolle nachladen und Cleos Hilfe-Themen holen. Danach stimmen Zähler und Hinweise, und die
 * App geht ganz ohne Netz.
 */
async function loadInBackground() {
  loadTopics().then(renderHelp, () => {})
  if ((await preloadLazy()) && !app.ui.modal) renderNow()
}

/** Installierbare App: nur im fertigen Build (dort gibt es das Manifest). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !document.querySelector('link[rel="manifest"]')) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    const $toast = document.getElementById('toast')
    $toast.innerHTML = '<span>Neue Version der App verfügbar.</span><button class="toast-btn" data-action="reload">Neu laden</button>'
    $toast.hidden = false
  })
  navigator.serviceWorker
    .register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    // Werkzeuge der eigenen Rolle für ohne Netz vorhalten (Keller), nicht erst beim ersten Öffnen
    .then((reg) => {
      const urls = toolUrls()
      if (urls.length) reg.active?.postMessage({ type: 'werkzeuge-vorhalten', urls })
    })
    .catch(() => {})
}

// Unsichtbares Fenster der Microsoft-Anmeldung (Token still erneuern): Die Anmeldung liest nur die
// Adresse aus, die App muss darin nicht starten (sonst dauert es und läuft in eine Zeitüberschreitung)
const inAuthFrame = window.self !== window.top && /(^|[#&?])(code|error|state)=/.test(`${location.hash}&${location.search}`)
if (!inAuthFrame) boot().catch((err) => {
  // falsches Konto (Gast, anderer Tenant): abmelden und mit dem Firmenkonto neu anmelden
  if (err.signOut) {
    app.switchAccount = err.signOut
    return showMessage(`<h2>Anmeldung nicht möglich</h2><p>${esc(err.message)}</p><p><button class="btn primary" data-action="switch-account">Mit anderem Konto anmelden</button></p>`)
  }
  // hochgeladen, aber noch ohne Anwendungs-ID: Einrichtungsschritte statt Fehlermeldung
  if (err.unregistered) {
    Object.assign(ACTIONS, setupActions(download), { reload: () => location.reload() })
    return showMessage(setupHtml(app.config || {}, err.redirectUri))
  }
  console.error(err)
  // SharePoint verweigert (oft nach „Vererbung beenden“ ohne eigenes Konto/Gruppe): klar sagen, was zu tun ist
  if (err.status === 403 || /access ?denied|accessdenied/i.test(err.message || '')) {
    const sp = app.config?.sharepoint || {}
    ACTIONS.reload = () => location.reload()
    return showMessage(`<h2>Kein Zugriff auf die Daten in SharePoint</h2>
      <p>SharePoint lässt dein Konto${app.user?.email ? ` (<b>${esc(app.user.email)}</b>)` : ''} nicht in den Ordner <b>${esc(sp.folder || 'Plattform')}</b> der Bibliothek <b>${esc(sp.library || 'Cleanos_Daten')}</b>. Die App kann deshalb nichts lesen oder speichern.</p>
      <ol><li>In SharePoint die Bibliothek öffnen → Ordner <b>${esc(sp.folder || 'Plattform')}</b> → ⋯ → <b>Zugriff verwalten</b> → „Berechtigungen prüfen“ mit deinem Namen.</li>
      <li>Steht dort nicht „Bearbeiten“: dein Konto oder die Büro-Gruppe mit <b>Bearbeiten</b> hinzufügen. Nach „Vererbung beenden“ fehlt das oft.</li>
      <li>Danach hier „Erneut versuchen“.</li></ol>
      <p class="note">Technisch: ${esc(err.message)}</p><p><button class="btn primary" data-action="reload">Erneut versuchen</button></p>`)
  }
  if (err.offline) return showMessage(`<h2>Keine Verbindung</h2><p>${esc(err.message)}</p><p><button class="btn" data-action="reload">Erneut versuchen</button></p>`) || (ACTIONS.reload = () => location.reload())
  showMessage(`<h2>Die App konnte nicht gestartet werden</h2><p>${esc(err.message)}</p><p class="note">Bei SharePoint-Fehlern: Einträge in config.json prüfen (tenantId, clientId, siteUrl, library) und ob dein Konto Zugriff auf die Website hat. Details in docs/EINRICHTUNG.md.</p><p><button class="btn" data-action="reload">Erneut versuchen</button></p>`)
  ACTIONS.reload = () => location.reload()
})
