// Start der App: Konfiguration laden, anmelden (SharePoint) oder Browser-
// Ablage wählen, Daten laden, Rahmen zeichnen, Ereignisse verteilen.

import './views/index.js'

import { MODULES, resolveAccess } from '../core/access.js'
import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../core/dates.js'
import { DEFAULT_RULES } from '../core/rules.js'
import { createDemoData, DEFAULT_SKILLS } from '../data/demo.js'
import { LocalDocStore } from '../storage/docstore-local.js'
import { SharePointDocStore } from '../storage/docstore-sharepoint.js'
import { DataService, dataRights } from '../storage/data-service.js'
import { CachedDocStore, createOfflineCache } from '../storage/offline.js'
import { applyBrand, loadConfig } from './config.js'
import { ACTIONS, app, canEdit, clearUndo, closeModal, labelTables, moduleOf, render, renderNow, saveStatusText, setFrame, toast, undo, VIEW_GROUPS, viewFromHash, visibleViews } from './context.js'
import { bellButton, refreshBell, showTodoIfNew } from './modals/todo.js'
import { flowBar } from './flow.js'
import { bottomNav, isMobile, mobileTopbar, roleSwitch, watchDevice } from './mobile.js'
import { sidebar } from './sidebar.js'
import { planWeek, seedDemoHistory } from './planning.js'
import { uploadQueued } from './photo.js'
import { searchButton } from './search.js'
import { applyTheme, themeButton } from './theme.js'
import { download, esc, ICON } from './shared.js'
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
  const { view, monday, employeeId, team, region, previewRole, skin, mode, scale } = app.ui
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ view, monday, employeeId, team, region, previewRole, skin, mode, scale }))
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

/** Weniger gebrauchte Aktionen im Menü „⋯“. */
function moreMenu(plan) {
  const items = [
    plan && `<button class="btn" data-action="open-publish">${ICON.send} Veröffentlichen</button>`,
    plan && `<button class="btn" data-action="replan" title="Nicht fixierte Einteilungen dieser Woche verwerfen und neu planen">${ICON.bolt} Neu planen</button>`,
    plan && `<button class="btn" data-action="open-send">${ICON.send} An Mitarbeitende versenden</button>`,
    (!app.access || app.access.all) && `<button class="btn" data-action="open-data">${ICON.folder} Daten & Sicherung</button>`,
    `<button class="btn" data-action="theme-open">${ICON.palette} Darstellung</button>`,
    app.signOut && `<button class="btn" data-action="sign-out">${ICON.user} Abmelden</button>`,
  ].filter(Boolean)
  return `<details class="menu-wrap"><summary class="btn icon ghost" aria-label="Weitere Aktionen" title="Weitere Aktionen">${ICON.more}</summary><div class="menu" role="menu">${items.join('')}</div></details>`
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
  const group = VIEW_GROUPS.find(([g]) => g === view?.group)?.[1] || ''
  const head = !view
    ? ''
    : title
      ? `<nav class="crumbs" aria-label="Pfad"><span>${esc(group)}</span><span class="sep" aria-hidden="true">/</span><b>${esc(view.label)}</b></nav>`
      : `<h1 class="page-title">${esc(view.label)}</h1><div class="weeknav">
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
      ${searchButton()}
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
  return `<div class="sb-status"><span id="save-status" class="save-status">${saveStatusText(app.service.status)}</span></div>
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
  return `<div class="banner welcome"><div><h2>Willkommen im Dienstplan</h2><p>Noch keine Daten in der Ablage. Am schnellsten geht es mit den bestehenden Excel-Listen: Mitarbeitende einfügen, dann Objekte und Leistungen mit Stammkraft.</p></div>
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
  app.readOnly = !canEdit(moduleOf(view))
  const readOnly = app.readOnly ? `<div class="banner"><p><strong>Nur lesen.</strong> ${app.access ? `Deine Rolle (${esc(app.access.label)}) darf im Bereich „${esc(MODULES[moduleOf(view)] || '')}“ nichts ändern.` : ''}</p></div>` : ''
  return shell(`${readOnly}${welcome()}${view.group === 'plan' ? correctionBanner(c) : ''}${view.summary ? summary(c) : ''}${view.render(c)}`)
}

setFrame({
  frame,
  afterRender: () => {
    document.body.classList.toggle('readonly', app.readOnly)
    document.body.classList.toggle('mobile', isMobile())
    labelTables()
    writePrefs()
    refreshBell()
  },
})

// ---------------------------------------------------------------- Aktionen

Object.assign(ACTIONS, {
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
    if (!canEdit('planung')) return toast('Nur Leserechte.')
    app.ui.modal = null
    planWeek(false)
  },
  replan: () => {
    if (!canEdit('planung')) return toast('Nur Leserechte.')
    app.ui.modal = null
    planWeek(true)
  },
  'preview-role': (el) => {
    app.ui.previewRole = el.value === 'disposition' ? null : el.value
    app.access = resolveAccess({ preview: app.ui.previewRole, access: app.config.access })
    app.ui.modal = null
    render()
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
    if (app.offline && !app.service.pendingCount()) await Promise.all(['docs', 'meta'].map((s) => app.offline.clear?.(s)))
    app.signOut?.()
  },
  'switch-account': () => app.switchAccount?.(),
})

function bindEvents() {
  document.addEventListener('click', (e) => {
    // Menü „⋯“: Klick daneben oder auf einen Eintrag schließt es
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
    if (e.key === 'Escape') for (const menu of document.querySelectorAll('details.menu-wrap[open]')) menu.open = false
    if (e.key === 'Escape' && app.ui.modal) closeModal()
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
    showMessage('<p>Anmeldung bei Microsoft 365 …</p>')
    const { scopesFor, signIn } = await import('../auth/msal.js')
    const auth = await signIn({ ...config.sharepoint, scopes: scopesFor(config) })
    app.auth = auth
    app.user = auth.user
    app.signOut = auth.signOut
    // Hülle für den Offline-Betrieb: letzter Stand und ungespeicherte Änderungen bleiben im Gerät
    local = createOfflineCache()
    store = new CachedDocStore(new SharePointDocStore({ getToken: auth.getToken, ...config.sharepoint }), local)
    showMessage('<p>Verbinde mit SharePoint …</p>')
    await store.init()
    // Rechte aus Microsoft-Gruppen und App-Rollen; ohne Zuordnung kein Zugriff
    app.access = resolveAccess({ roleClaims: app.user.roles, groupClaims: app.user.groups, email: app.user.email, access: config.access, strict: true })
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
    blank: emptyData,
    onStatus: (status, detail) => {
      const el = document.getElementById('save-status')
      if (el) el.innerHTML = saveStatusText(status, detail)
      if (status === 'error') toast(`Speichern fehlgeschlagen: ${detail}`)
    },
    onRemoteChange: (kind, changed) => {
      app.dataVersion = (app.dataVersion || 0) + 1
      clearUndo()
      renderNow()
      if (kind === 'merged') toast('Gleichzeitige Änderungen einer anderen Person wurden zusammengeführt.')
      else toast(`Aktualisiert: Änderungen von ${[...new Set(changed.map((x) => x.by).filter(Boolean))].join(', ') || 'anderer Sitzung'} geladen.`)
    },
  })

  const seed = () => {
    if (config.storage !== 'local') return emptyData()
    const legacy = config.migrateLegacy === false ? null : legacyData()
    if (legacy) return { ...emptyData(), ...legacy }
    return config.demo ? createDemoData(app.ui.monday) : emptyData()
  }
  app.data = await app.service.load(seed)
  await render()
  if (app.service.firstRun && config.storage === 'local' && config.demo && (config.migrateLegacy === false || !legacyData())) {
    await seedDemoHistory()
    renderNow()
  }
  await showTodoIfNew()
  // Zuletzt ohne Netz Erfasstes gleich nachholen
  if (app.service.restored) {
    toast(`${app.service.restored} ${app.service.restored === 1 ? 'Änderung' : 'Änderungen'} aus der Zeit ohne Netz übernommen, wird gespeichert.`)
    app.service.refresh().catch(() => {})
  }
  const sync = () => {
    app.service.refresh().catch(() => {})
    uploadQueued().catch(() => {})
  }
  const every = (config.storage === 'sharepoint' ? config.sharepoint.refreshSeconds || 60 : 30) * 1000
  setInterval(sync, every)
  // Zurück in der App (Handy entsperrt, Tab gewechselt) oder wieder Netz: sofort abgleichen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync()
  })
  window.addEventListener('online', sync)
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
  uploadQueued().catch(() => {})
  registerServiceWorker()
}

/** Installierbare App: nur im fertigen Build (dort gibt es das Manifest). */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !document.querySelector('link[rel="manifest"]')) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    const $toast = document.getElementById('toast')
    $toast.innerHTML = '<span>Neue Version des Dienstplans verfügbar.</span><button class="toast-btn" data-action="reload">Neu laden</button>'
    $toast.hidden = false
  })
  navigator.serviceWorker.register('sw.js').catch(() => {})
}

boot().catch((err) => {
  // falsches Konto (Gast, anderer Tenant): abmelden und mit dem Firmenkonto neu anmelden
  if (err.signOut) {
    app.switchAccount = err.signOut
    return showMessage(`<h2>Anmeldung nicht möglich</h2><p>${esc(err.message)}</p><p><button class="btn primary" data-action="switch-account">Mit anderem Konto anmelden</button></p>`)
  }
  console.error(err)
  if (err.offline) return showMessage(`<h2>Keine Verbindung</h2><p>${esc(err.message)}</p><p><button class="btn" data-action="reload">Erneut versuchen</button></p>`) || (ACTIONS.reload = () => location.reload())
  showMessage(`<h2>Der Dienstplan konnte nicht gestartet werden</h2><p>${esc(err.message)}</p><p class="note">Bei SharePoint-Fehlern: Einträge in config.json prüfen (tenantId, clientId, siteUrl, library) und ob dein Konto Zugriff auf die Website hat. Details in docs/EINRICHTUNG.md.</p><p><button class="btn" data-action="reload">Erneut versuchen</button></p>`)
  ACTIONS.reload = () => location.reload()
})
