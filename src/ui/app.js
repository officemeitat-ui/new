// Start der App: Konfiguration laden, anmelden (SharePoint) oder Browser-
// Ablage wählen, Daten laden, Rahmen zeichnen, Ereignisse verteilen.

import './views/index.js'

import { MODULES, resolveAccess } from '../core/access.js'
import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../core/dates.js'
import { DEFAULT_RULES } from '../core/rules.js'
import { createDemoData, DEFAULT_SKILLS } from '../data/demo.js'
import { LocalDocStore } from '../storage/docstore-local.js'
import { SharePointDocStore } from '../storage/docstore-sharepoint.js'
import { DataService } from '../storage/data-service.js'
import { applyBrand, loadConfig } from './config.js'
import { ACTIONS, app, canEdit, clearUndo, closeModal, labelTables, moduleOf, render, renderNow, saveStatusText, setFrame, toast, undo, VIEW_GROUPS, visibleViews } from './context.js'
import { bellButton, refreshBell, showTodoIfNew } from './modals/todo.js'
import { flowBar } from './flow.js'
import { bottomNav, isMobile, mobileTopbar, roleSwitch, watchDevice } from './mobile.js'
import { planWeek, seedDemoHistory } from './planning.js'
import { searchButton } from './search.js'
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
  const { view, monday, employeeId, team, region, previewRole } = app.ui
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ view, monday, employeeId, team, region, previewRole }))
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

const GROUPS = VIEW_GROUPS

function brandBlock() {
  const b = app.config.brand
  const logo = b.logo ? `<img class="brand-logo" src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<span class="brand-word">${esc(b.name)}</span>`
  return `<div class="brand">${logo}<div class="brand-text"><strong>${esc(b.product)}</strong><small>${esc(b.tagline)}</small></div></div>`
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
  const role = app.access && !app.access.all ? ` · ${esc(app.access.label)}` : ''
  const user = app.user ? `<span class="user">${ICON.user} ${esc(app.user.name)}${role}</span>${app.signOut ? '<button class="btn small" data-action="sign-out">Abmelden</button>' : ''}` : roleSwitch()
  return `<header class="topbar"><div class="topbar-inner wrap">
    ${brandBlock()}
    ${title ? `<div class="weeknav"><div class="kw">${esc(title.label)}<small>${title.sub}</small></div></div>` : `<div class="weeknav">
      <button class="btn icon" data-action="nav" data-delta="-7" aria-label="Vorige Woche">${ICON.left}</button>
      <div class="kw">KW ${week} / ${year}<small>${formatDate(c.monday, { weekday: false })} – ${formatDate(c.sunday, { weekday: false, year: true })}</small></div>
      <button class="btn icon" data-action="nav" data-delta="7" aria-label="Nächste Woche">${ICON.right}</button>
      <button class="btn small" data-action="nav-today">Heute</button>
      ${status}
    </div>`}
    <div class="actions">
      ${searchButton()}
      ${bellButton()}
      ${canEdit('planung') ? `<button class="btn primary" data-action="plan" title="Freie Einsätze besetzen: zuerst Stammkräfte, dann Vertretungen. Bestehende Einteilungen bleiben.">${ICON.bolt} Woche planen</button>
      <button class="btn" data-action="replan" title="Nicht fixierte Einteilungen dieser Woche verwerfen und neu planen">Neu planen</button>` : ''}
      ${app.access?.sees('planung') !== false ? `<button class="btn" data-action="open-publish">${ICON.send} Veröffentlichen</button>` : ''}
      ${!app.access || app.access.all ? '<button class="btn" data-action="open-data">Daten</button>' : ''}
    </div>
    <div class="userbox"><span id="save-status" class="save-status">${saveStatusText(app.service.status)}</span>${user}</div>
  </div></header>`
}

function tabs(c) {
  const views = visibleViews()
  return `<nav class="tabs wrap" aria-label="Ansichten">${GROUPS.map(([group, label]) => {
    const items = views.filter((v) => v.group === group)
    if (!items.length) return ''
    return `<div class="tabgroup"><span class="tabgroup-label">${label}</span>${items
      .map((v) => {
        const badge = v.badge?.(c)
        return `<button class="tab" data-action="view" data-view="${v.id}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}>${esc(v.label)}${badge ? ` <span class="flag error">${badge}</span>` : ''}</button>`
      })
      .join('')}</div>`
  }).join('')}</nav>`
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
  if (app.data.employees.length || app.readOnly) return ''
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
  if (!views.length) return `${topbar(c)}<main class="wrap"><div class="banner"><p><strong>Kein Bereich freigegeben.</strong> Deinem Konto ist keine Rolle mit Modulen zugewiesen. Bitte bei der Disposition melden.</p></div></main>`
  const view = views.find((v) => v.id === app.ui.view) || views[0]
  app.ui.view = view.id
  // Leserechte je Modul der aktuellen Ansicht
  app.readOnly = !canEdit(moduleOf(view))
  const readOnly = app.readOnly ? `<div class="banner"><p><strong>Nur lesen.</strong> ${app.access ? `Deine Rolle (${esc(app.access.label)}) darf im Bereich „${esc(MODULES[moduleOf(view)] || '')}“ nichts ändern.` : ''}</p></div>` : ''
  const mobile = isMobile()
  return `${topbar(c)}${mobile ? '' : tabs(c)}<main class="wrap">${readOnly}${welcome()}${view.group === 'plan' ? correctionBanner(c) : ''}${view.summary ? summary(c) : ''}${view.render(c)}</main>${mobile ? bottomNav(c) : ''}`
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
    app.signOut?.()
  },
})

function bindEvents() {
  document.addEventListener('click', (e) => {
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
  config.features = { excel: true, pdf: true, download: true, print: true, mail: false, ...(config.features || {}) }
  app.config = config
  applyBrand(config.brand)
  bindEvents()

  let store
  if (config.storage === 'sharepoint') {
    showMessage('<p>Anmeldung bei Microsoft 365 …</p>')
    const { scopesFor, signIn } = await import('../auth/msal.js')
    const auth = await signIn({ ...config.sharepoint, scopes: scopesFor(config) })
    app.auth = auth
    app.user = auth.user
    app.signOut = auth.signOut
    store = new SharePointDocStore({ getToken: auth.getToken, ...config.sharepoint })
    showMessage('<p>Verbinde mit SharePoint …</p>')
    await store.init()
    app.access = resolveAccess({ roleClaims: app.user.roles, email: app.user.email, access: config.access })
  } else {
    store = new LocalDocStore({ download })
  }
  app.store = store

  Object.assign(app.ui, readPrefs())
  if (config.storage !== 'sharepoint') app.access = resolveAccess({ preview: app.ui.previewRole, access: config.access })
  app.service = new DataService(store, {
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
  const every = (config.storage === 'sharepoint' ? config.sharepoint.refreshSeconds || 60 : 30) * 1000
  setInterval(() => app.service.refresh().catch(() => {}), every)
  // Zurück in der App (Handy entsperrt, Tab gewechselt): sofort abgleichen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') app.service.refresh().catch(() => {})
  })
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
  console.error(err)
  showMessage(`<h2>Der Dienstplan konnte nicht gestartet werden</h2><p>${esc(err.message)}</p><p class="note">Bei SharePoint-Fehlern: Einträge in config.json prüfen (tenantId, clientId, siteUrl, library) und ob dein Konto Zugriff auf die Website hat. Details in docs/EINRICHTUNG.md.</p><p><button class="btn" data-action="reload">Erneut versuchen</button></p>`)
  ACTIONS.reload = () => location.reload()
})
