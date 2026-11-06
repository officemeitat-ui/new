// Die eigenen Werkzeuge in der App: Wasserzähler-Ablesung, Objektkontrolle,
// Objektdoku und Mattenwechsel – unverändert (werkzeuge/), im Rahmen der App.
//
// - Anmeldung: kommt von der App (window.werkzeugBruecke ↔ werkzeuge/bruecke.js),
//   eine Microsoft-Anmeldung für alles.
// - Daten: speichern die Werkzeuge wie bisher selbst in ihren Ordnern der
//   Bibliothek (Wasserzähler - Ablesung, Objektpruefprotokolle, Objektdoku,
//   Mattenwechsel); es gelten die SharePoint-Rechte der angemeldeten Person.
// - Sichtbarkeit: nach Rolle (Modul zaehler, kontrolle, objektmappe, matten).
// - Ein Werkzeug bleibt geladen, wenn man zwischendurch z. B. in den
//   Dienstplan wechselt: Sein Rahmen liegt außerhalb der Seite, die die App
//   bei jeder Änderung neu zeichnet, und wird nur über den Platzhalter gelegt.

import { app, registerActions, registerView, renderNow, toast, visibleViews } from '../context.js'
import { esc, ICON } from '../shared.js'
import { reviereFor } from '../../core/reviere.js'

export const TOOLS = [
  { id: 'zaehler', name: 'wasserzaehler', module: 'zaehler', label: 'Wasserzähler', title: 'Wasserzähler-Ablesung', order: 72, text: 'Zählerstände je Quartal mit Fotos, Bericht für die Hausverwaltung, Jahreswechsel' },
  { id: 'kontrolle', name: 'objektkontrolle', module: 'kontrolle', label: 'Objektkontrolle', title: 'Objektkontrolle (Prüfprotokoll)', order: 73, text: 'Prüfprotokoll mit Bewertung, Fotos, Unterschriften und PDF' },
  { id: 'objektmappe', name: 'objektdoku', module: 'objektmappe', label: 'Objektdoku', title: 'Objektdokumentation (Leistungsverzeichnis)', order: 74, text: 'Objektakte, Leistungsverzeichnis, Objektblatt als PDF mit Öffnungscode' },
  // bis zur Umstellung parallel zum Mattenwechsel-Modul (views/matten.js): darum „(Werkzeug)“ im Namen
  { id: 'matten', name: 'mattenwechsel', module: 'matten', label: 'Mattenwechsel (Werkzeug)', title: 'Mattenwechsel (Werkzeug)', order: 75, text: 'Touren, Lieferscheine und Nachweis des Mattenwechsels' },
]

const frames = new Map() // Werkzeug → <iframe>, bleibt bis zum Neuladen der App
let host = null
let problem = '' // Anmeldung für die Werkzeuge gerade nicht möglich
// Rechte, die ein Werkzeug wollte, aber (noch) nicht bekam: Bereich → { scopes, text }
// (z. B. Routen im Mattenwechsel über Azure Maps, Mail direkt senden, Kalender)
const missingRights = new Map()
const RIGHT_LABEL = [
  [/atlas\.microsoft\.com/i, 'maps', 'Routen und Karten (Azure Maps)'],
  [/Mail\.Send/i, 'mail', 'E-Mail direkt aus dem Werkzeug senden (Mail.Send)'],
  [/Calendars\./i, 'kalender', 'Termine im Kalender eintragen (Calendars.ReadWrite)'],
]
function noteMissing(scopes, err) {
  for (const [re, id, text] of RIGHT_LABEL) {
    const hit = scopes.filter((x) => re.test(x))
    if (!hit.length || missingRights.has(id)) continue
    missingRights.set(id, { scopes: hit, text, error: String(err?.message || err || '').split('\n')[0].slice(0, 160) })
    if (TOOLS.some((t) => t.id === app.ui.view)) renderNow()
  }
}
function noteGranted(scopes) {
  let changed = false
  for (const [re, id] of RIGHT_LABEL) if (scopes.some((x) => re.test(x)) && missingRights.delete(id)) changed = true
  if (changed && TOOLS.some((t) => t.id === app.ui.view)) renderNow()
}

const toolOf = (name) => TOOLS.find((t) => t.name === name)
const url = (tool) => `werkzeuge/${tool.name}/`

function hostEl() {
  if (!host) {
    host = document.createElement('div')
    host.id = 'tool-host'
    host.hidden = true
    document.body.append(host)
  }
  return host
}

function frameFor(tool) {
  let frame = frames.get(tool.name)
  if (!frame) {
    frame = document.createElement('iframe')
    frame.className = 'tool-frame'
    frame.title = tool.title
    frame.src = url(tool)
    // gleiche Adresse wie die App: Kamera, Standort usw. wie im eigenen Fenster erlauben
    frame.setAttribute('allow', 'camera; microphone; geolocation; clipboard-read; clipboard-write; fullscreen; web-share; screen-wake-lock')
    frame.setAttribute('allowfullscreen', '')
    hostEl().append(frame)
    frames.set(tool.name, frame)
  }
  return frame
}

/** Nach jedem Zeichnen (app.js): Rahmen des offenen Werkzeugs über den Platzhalter legen, andere verstecken. */
export function syncTools() {
  const slot = document.querySelector('.tool-slot')
  const active = slot ? toolOf(slot.dataset.tool) : null
  document.body.classList.toggle('tool-view', !!active)
  for (const [name, frame] of frames) frame.hidden = !active || name !== active.name
  if (!active) {
    if (host) host.hidden = true
    return
  }
  frameFor(active).hidden = false
  if (app.ui.lastTool !== active.name) {
    app.ui.lastTool = active.name
    app.savePrefs?.()
  }
  const el = hostEl()
  el.hidden = false
  // Platzhalter bis zum unteren Rand (am Handy über der Leiste unten)
  const top = slot.getBoundingClientRect().top
  const bottomBar = document.querySelector('.bottom-nav')?.getBoundingClientRect().height || 0
  slot.style.height = `${Math.max(360, window.innerHeight - top - bottomBar - 8)}px`
  const r = slot.getBoundingClientRect()
  Object.assign(el.style, { top: `${r.top + window.scrollY}px`, left: `${r.left + window.scrollX}px`, width: `${r.width}px`, height: `${r.height}px` })
}
window.addEventListener('resize', () => syncTools())

/**
 * Zuletzt benutztes Werkzeug im Hintergrund vorladen (unsichtbar), damit es beim Öffnen schon seine
 * Daten aus SharePoint hat. Nur am großen Bildschirm bzw. im WLAN-tauglichen Fall: nicht bei „Daten sparen“.
 */
export function warmLastTool() {
  const tool = toolOf(app.ui.lastTool)
  if (!tool || frames.has(tool.name) || navigator.connection?.saveData) return
  if (!visibleViews().some((v) => v.id === tool.id) || app.config?.tools === false) return
  const frame = frameFor(tool)
  frame.hidden = true
  hostEl()
}

/** Adressen der Werkzeuge, die die eigene Rolle sieht (samt Anmeldebrücke): zum Vorhalten für ohne Netz. */
export function toolUrls() {
  const visible = new Set(visibleViews().map((v) => v.id))
  const urls = TOOLS.filter((t) => visible.has(t.id)).map(url)
  return urls.length ? [...urls, 'werkzeuge/bruecke.js'] : []
}

// ---------------------------------------------------------------- Anmeldung für die Werkzeuge

const OIDC = new Set(['openid', 'profile', 'offline_access', 'email'])
// fehlt dafür die Zustimmung, geht es ohne weiter (wie in den Werkzeugen selbst)
const OPTIONAL = ['Mail.Send', 'Calendars.ReadWrite']

async function toolToken(scope) {
  const wanted = String(scope || '')
    .split(/\s+/)
    .filter((s) => s && !OIDC.has(s))
  if (!app.auth?.tokenFor) throw new Error('keine Microsoft-Anmeldung (Browser-Modus)')
  let res
  try {
    res = await app.auth.tokenFor(wanted)
    noteGranted(wanted)
  } catch (err) {
    const required = wanted.filter((s) => !OPTIONAL.includes(s))
    if (required.length === wanted.length) {
      if (wanted.some((s) => /Sites\.|User\.Read/.test(s))) reportProblem(err)
      else noteMissing(wanted, err) // z. B. Azure Maps: Werkzeug läuft ohne Routen weiter, die App zeigt warum
      throw err
    }
    noteMissing(wanted.filter((s) => OPTIONAL.includes(s)), err)
    try {
      res = await app.auth.tokenFor(required)
    } catch (err2) {
      reportProblem(err2)
      throw err2
    }
  }
  if (problem) {
    problem = ''
    renderNow()
  }
  const seconds = Math.max(60, Math.floor(((res.expiresOn ? new Date(res.expiresOn).getTime() : Date.now() + 3600e3) - Date.now()) / 1000))
  return { accessToken: res.accessToken, expiresIn: seconds, scope: (res.scopes || wanted).join(' ') }
}

function reportProblem(err) {
  const text = String(err?.message || err || 'unbekannter Fehler').split('\n')[0].slice(0, 200)
  if (text === problem) return
  problem = text
  if (TOOLS.some((t) => t.id === app.ui.view)) renderNow()
}

// Schnittstelle für werkzeuge/bruecke.js (gleiche Adresse, daher direkt erreichbar)
window.werkzeugBruecke = {
  bruecke: 1,
  get angemeldet() {
    return !!app.auth?.tokenFor
  },
  /** Reviere zur Auswahl bei neuen Einträgen (core/reviere.js): Vollzugriff alle, sonst die eigener Revier-Gruppen. */
  get reviere() {
    return reviereFor({ all: !!app.access?.all, groups: app.user?.groups || [], reviere: app.config?.access?.reviere || {}, objects: app.data?.objects || [] })
  },
  token: toolToken,
  anmelden() {
    if (app.auth?.reauth) app.auth.reauth()
    else {
      problem = 'Im Browser-Modus gibt es keine Microsoft-Anmeldung. Die Werkzeuge arbeiten dann nur auf diesem Gerät.'
      renderNow()
    }
  },
}

// ---------------------------------------------------------------- Ansichten

function toolView(tool) {
  return () => {
    const banner = problem
      ? `<div class="banner warn-banner"><p><strong>Keine Verbindung zu SharePoint für die Werkzeuge.</strong> ${esc(problem)} Das Werkzeug arbeitet auf diesem Gerät weiter und gleicht ab, sobald die Anmeldung wieder geht.</p>${app.auth?.reauth ? '<button class="btn primary" data-action="tool-reauth">Neu anmelden</button>' : ''}</div>`
      : ''
    const rights = [...missingRights.entries()]
    const rightsBanner = rights.length
      ? `<div class="banner warn-banner tool-rights"><p><strong>Damit alles geht wie im eigenen Fenster, fehlt noch die Zustimmung:</strong> ${rights.map(([, r]) => esc(r.text)).join(' · ')}. Bis dahin läuft das Werkzeug ohne diese Funktion. Zeigt Microsoft „Genehmigung durch Administrator erforderlich“: in Entra die Berechtigung hinzufügen und die Administratorzustimmung erteilen (Einrichtung, Schritt 2).</p>${app.auth?.reauth ? rights.map(([id, r]) => `<button class="btn primary small" data-action="tool-consent" data-right="${id}">Zustimmen: ${esc(r.text.split(' (')[0])}</button>`).join(' ') : ''}</div>`
      : ''
    return `${banner}${rightsBanner}<div class="tool-slot" data-tool="${tool.name}" aria-hidden="true"></div>`
  }
}

for (const tool of TOOLS)
  registerView({
    id: tool.id,
    label: tool.label,
    title: tool.title,
    text: tool.text,
    group: 'service',
    module: tool.module,
    order: tool.order,
    noWeek: true,
    // ohne Werkzeuge (z. B. neutrale Vorschau): config.json → "tools": false
    available: () => app.config?.tools !== false,
    actions: () =>
      `<button class="btn small ghost" data-action="tool-reload" data-tool="${tool.name}" title="${esc(tool.title)} neu laden">${ICON.refresh} Neu laden</button><button class="btn small ghost" data-action="tool-fullscreen" title="Werkzeug im Vollbild (Esc beendet)">Vollbild</button><a class="btn small ghost" href="${url(tool)}" target="_blank" rel="noopener" title="Im eigenen Fenster öffnen (eigene Anmeldung des Werkzeugs, braucht die Umleitungsadresse in Entra)">Eigenes Fenster</a>`,
    render: toolView(tool),
  })

registerActions({
  'tool-reload': (el) => {
    const frame = frames.get(el.dataset.tool)
    if (frame) frame.src = url(toolOf(el.dataset.tool))
  },
  'tool-reauth': () => app.auth?.reauth?.(),
  // Zustimmung für ein fehlendes Recht (Weiterleitung zu Microsoft, danach zurück ins Werkzeug)
  'tool-consent': (el) => {
    const r = missingRights.get(el.dataset.right)
    if (r && app.auth?.reauth) app.auth.reauth(r.scopes)
  },
  'tool-fullscreen': () => {
    const el = hostEl()
    if (document.fullscreenElement) return document.exitFullscreen?.()
    ;(el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => toast('Vollbild ist in diesem Browser nicht möglich.'))
  },
})
// Vollbild beendet: Rahmen wieder über den Platzhalter legen
document.addEventListener('fullscreenchange', () => syncTools())
