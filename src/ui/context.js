// Zentraler App-Zustand, Berechnung der aktuellen Woche und Registrierung von
// Ansichten, Dialogen und Aktionen. Erweiterungen melden sich hier an
// (siehe docs/ERWEITERN.md).

import { GROUP_MODULE, MODULES } from '../core/access.js'
import { addDays, eachDay, firstOfMonth, lastOfMonth, mondayOf, todayISO } from '../core/dates.js'
import { holidayCalendar } from '../core/holidays.js'
import { withDocIndex } from '../core/invoicing.js'
import { buildInstances, PlanState } from '../core/plan.js'
import { mondaysBetween } from '../core/reports.js'
import { createContext, validatePlan } from '../core/rules.js'
import { buildTimesheet, timesheetSignature } from '../core/timesheet.js'
import { ABSENT, absentList, dataRights, DOC } from '../storage/data-service.js'
import { patch } from './morph.js'
import { esc, modalFrame } from './shared.js'

export const app = {
  config: null,
  user: null,
  store: null,
  service: null,
  data: null,
  readOnly: false,
  locked: false, // aktuelle Woche ohne Netz nicht geladen: nichts ändern
  access: null,
  cur: null,
  ui: {
    view: 'week',
    monday: mondayOf(addDays(todayISO(), 7)),
    month: null,
    employeeId: null,
    reportFilter: 'all',
    team: '',
    region: '',
    search: '',
    onlyProblems: false,
    modal: null,
    confirm: null,
  },
}

// ---------------------------------------------------------------- Registry

export const VIEWS = []

/** Kurznamen für Adressen wie app.firma.at/#zaehler (auch die Namen der früheren Werkzeuge). */
export const VIEW_ALIASES = { start: 'home', uebersicht: 'home', hilfe: 'anleitung', handbuch: 'anleitung', cleo: 'anleitung', dienstplan: 'week', einsatzplanung: 'week', wasserzaehler: 'zaehler', zaehlerstaende: 'zaehler', pruefprotokoll: 'kontrolle', objektkontrolle: 'kontrolle', objektdoku: 'objektmappe', leistungsverzeichnis: 'objektmappe', mattenwechsel: 'matten', 'matten-alt': 'matten' }

/**
 * Umleitungen für Aufrufe über die Adresse (Lesezeichen, Link, Startbildschirm), z. B. #matten nach der Umstellung
 * auf das Mattenwechsel-Modul: fn(view, key) → andere Ansicht oder nichts. key ist der Teil hinter # (klein).
 * Geprüft beim Zeichnen, solange die Ansicht aus der Adresse kommt (app.ui.linked), also auch nach dem Laden der Daten.
 */
export const VIEW_REDIRECTS = []
/** Ansicht → Teil hinter # beim Wechseln (sonst die Kennung der Ansicht), z. B. das alte Werkzeug als #matten-alt. */
export const VIEW_HASH = {}
/** Teil hinter # für die Ansicht id. */
export const hashOfView = (id) => VIEW_HASH[id]?.() || id

/** Umleitung der Ansicht aus der Adresse anwenden (true: umgeleitet). */
export function applyRedirect() {
  const key = app.ui.linked
  if (!key) return false
  for (const fn of VIEW_REDIRECTS) {
    const to = fn(app.ui.view, key)
    if (to && to !== app.ui.view) {
      app.ui.view = to
      app.ui.linked = null
      try {
        history.replaceState(null, '', `#${hashOfView(to)}`)
      } catch {
        /* eingebettete Vorschau */
      }
      return true
    }
  }
  return false
}

/** Teil hinter # in Kleinbuchstaben (kaputter Link: ''). */
export function hashKey(hash) {
  try {
    return decodeURIComponent(String(hash || '').replace(/^#\/?/, '')).trim().toLowerCase()
  } catch {
    return ''
  }
}

/** Ansicht aus dem Teil hinter # (z. B. „#zaehler“); unbekannt oder Anmelde-Antwort: null. */
export function viewFromHash(hash, ids = VIEWS.map((v) => v.id)) {
  let key = String(hash || '').replace(/^#\/?/, '')
  try {
    key = decodeURIComponent(key)
  } catch {
    return null // kaputter Link (z. B. einzelnes %)
  }
  key = key.trim().toLowerCase()
  const id = Object.hasOwn(VIEW_ALIASES, key) ? VIEW_ALIASES[key] : key
  if (ids.includes(id)) return id
  // Ansicht mit Eintrag, z. B. #geraete/G-0001 vom QR-Etikett (die Ansicht liest den Rest aus app.ui.linked)
  const base = key.includes('/') ? key.slice(0, key.indexOf('/')) : ''
  return base && ids.includes(base) ? base : null
}

export const VIEW_GROUPS = [
  ['start', ''],
  ['plan', 'Einsatzplanung'],
  ['service', 'Objektservice'],
  ['lager', 'Material'],
  ['fuhrpark', 'Fuhrpark'],
  ['auswertung', 'Auswertung'],
  ['stamm', 'Stammdaten'],
]
/**
 * Menü-Abschnitte (Seitenleiste, Handy-Menü, Übersicht). Unabhängig von `group`, das die Rechte
 * bestimmt: eine Ansicht kann z. B. zur Einsatzplanung gehören (Rechte), im Menü aber unter
 * „Objekte & Kunden“ stehen. Eigene Ansichten geben `section` bei registerView mit.
 */
export const NAV_SECTIONS = [
  ['start', ''],
  ['planung', 'Planung'],
  ['einsatz', 'Einsätze & Zeiten'],
  ['objekte', 'Objekte & Kunden'],
  ['betrieb', 'Material & Fuhrpark'],
  ['finanzen', 'Finanzen'],
  ['verwaltung', 'Verwaltung'],
]
const SECTION_OF_GROUP = { start: 'start', plan: 'planung', service: 'objekte', lager: 'betrieb', fuhrpark: 'betrieb', auswertung: 'finanzen', stamm: 'verwaltung' }
// Reihenfolge im Menü (was man täglich braucht, zuerst); nicht genannte Ansichten kommen ans Ende ihres Abschnitts
const NAV_ORDER = {
  planung: ['week', 'timeline', 'termine', 'coverage', 'absences', 'objects', 'report'],
  einsatz: ['zeiten', 'sheet', 'due', 'waste', 'wetter'],
  objekte: ['reklamationen', 'vertrieb', 'nachweis', 'kundenbereich', 'zufriedenheit', 'schluessel', 'anlagen', 'regie', 'zaehler', 'kontrolle', 'qualitaet', 'objektmappe', 'matten', 'mw-uebersicht', 'mw-liegeplaetze', 'mw-kalender', 'mw-planung', 'mw-touren', 'mw-lieferscheine'],
  betrieb: ['material', 'geraete', 'fahrzeuge'],
  finanzen: ['fakturierung', 'kalkulation', 'controlling', 'payroll', 'overtime'],
  verwaltung: ['staff', 'bewerber', 'eintritt', 'sites', 'assign', 'unterweisungen', 'mitteilungen', 'arbeitsschutz', 'rules', 'berechtigungen', 'system', 'sicherung'],
}
const SECTION_OF_VIEW = Object.fromEntries(Object.entries(NAV_ORDER).flatMap(([s, ids]) => ids.map((id) => [id, s])))
/** Menü-Abschnitt einer Ansicht. */
export const sectionOf = (view) => view?.section || SECTION_OF_VIEW[view?.id] || SECTION_OF_GROUP[view?.group] || 'verwaltung'
export const sectionLabel = (id) => NAV_SECTIONS.find(([s]) => s === id)?.[1] || ''
/** Sichtbare Ansichten nach Menü-Abschnitten: [{ id, label, views }], leere Abschnitte fehlen. */
export function navSections(views = visibleViews()) {
  const rank = (v) => {
    const i = (NAV_ORDER[sectionOf(v)] || []).indexOf(v.id)
    return i < 0 ? 1000 + (v.order ?? 100) : i
  }
  return NAV_SECTIONS.map(([id, label]) => ({ id, label, views: views.filter((v) => sectionOf(v) === id).sort((a, b) => rank(a) - rank(b)) })).filter((s) => s.views.length)
}
/** Angeheftete Ansichten (Reihenfolge wie angeheftet), nur sichtbare. */
export function pinnedViews(views = visibleViews()) {
  return (app.ui.pinned || []).map((id) => views.find((v) => v.id === id)).filter(Boolean)
}

export const MODALS = {}
export const ACTIONS = {}
/** Hinweise anderer Module zu einem Objekt (z. B. Fahrzeug am Objekt): [{ module, html(objectId) }] */
export const OBJECT_HINTS = []
export const registerObjectHint = (hint) => {
  // nachgeladenes Modul (registerLazy): an die Stelle seines Platzhalters, die Reihenfolge bleibt
  const idx = OBJECT_HINTS.findIndex((h) => h.lazy && h.module === hint.module)
  if (idx >= 0) OBJECT_HINTS.splice(idx, 1, hint)
  else OBJECT_HINTS.push(hint)
}
/** Hinweise zu einem Objekt, die die Rolle sehen darf. */
export const objectHints = (objectId) => OBJECT_HINTS.filter((h) => !app.access || app.access.sees(h.module)).map((h) => h.html(objectId)).filter(Boolean)

/** Modul einer Ansicht (für Rollen): angegeben oder nach Gruppe. */
export const moduleOf = (view) => view.module || GROUP_MODULE[view.group] || 'planung'
/** Ansichten, die die angemeldete Person sehen darf. module '*' (Übersicht): wer überhaupt einen Bereich sieht. */
export const visibleViews = () => {
  const any = !app.access || Object.keys(MODULES).some((m) => app.access.sees(m))
  return VIEWS.filter((v) => v.available?.() !== false).filter((v) => (v.module === '*' ? any : !app.access || app.access.sees(moduleOf(v))))
}
/** Darf in einem Modul ändern (ohne Rollen-Setup: ja). */
export const canEdit = (module) => !app.access || app.access.canEdit(module)
/**
 * Darf eine Aktion ausführen: modules = Modul, Liste von Modulen (eines genügt)
 * oder '*' (nur Vollzugriff). Planungs-Aktionen sind gesperrt, solange die
 * angezeigte Woche ohne Netz nicht geladen ist.
 */
export function mayEdit(modules) {
  if (modules === '*') return !app.access || !!app.access.all
  const list = [].concat(modules)
  if (app.locked && list.includes('planung')) return false
  return list.some((m) => canEdit(m))
}

// Ergebnisse während eines Zeichnens (renderNow): dieselbe Frage gibt dieselbe Antwort, die Daten ändern sich dabei nicht
let pass = null
/** Wert je Zeichnen merken, z. B. ein Verzeichnis für viele Zeilen (außerhalb eines Zeichnens jedes Mal neu). */
export const perDraw = (key, fn) => (pass ? (pass.has(key) ? pass.get(key) : pass.set(key, fn()).get(key)) : fn())
/** fn je Zeichnen höchstens einmal (außerhalb von renderNow jedes Mal); als Text wie fn (test/lazy.test.js vergleicht). */
function oncePerPass(key, fn) {
  const wrapped = (...args) => perDraw(key, () => fn(...args))
  return Object.assign(wrapped, { raw: fn, toString: () => String(fn) })
}

/**
 * Ansicht registrieren: { id, label, group: 'plan'|'service'|'lager'|'fuhrpark'|'auswertung'|'stamm', module?, icon?, order, render(c),
 * summary?, badge?(c), range?() → { from, to } für zusätzlich zu ladende Wochen, available?() → false blendet aus }
 * module: Rollen-Modul (core/access.js), sonst nach Gruppe.
 */
export function registerView(view) {
  // Zähler (badge) fragen Seitenleiste, Bereichsmenü und Handy-Leiste je Zeichnen mehrfach ab: je Zeichnen einmal rechnen
  if (view.badge && !view.badge.raw) view.badge = oncePerPass(`badge:${view.id}`, view.badge)
  const idx = VIEWS.findIndex((v) => v.id === view.id)
  if (idx >= 0) VIEWS.splice(idx, 1, view)
  else VIEWS.push(view)
  VIEWS.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * Namen von Aktionen und Dialogen gelten app-weit. Registriert ein zweites Modul denselben Namen, gewinnt
 * stillschweigend das zuletzt geladene (z. B. „Einstellungen“ im Kundenbereich öffnete die des Kassenbuchs).
 * Darum hier gemerkt und gewarnt; test/lazy.test.js lädt alle Module und verlangt eine leere Liste.
 * Platzhalter aus views/lazy.js (fn.lazy) und dieselbe Funktion noch einmal sind kein Doppel.
 */
export const NAME_CLASHES = []
function clash(kind, name, before, now) {
  if (!before || before === now || before.raw === now) return
  if (before.lazy && (!now.lazy || now.lazy === before.lazy)) return // Modul ersetzt seinen Platzhalter
  NAME_CLASHES.push(`${kind} ${name}`)
  console.warn(`${kind} „${name}“ ist schon vergeben und wird überschrieben – Namen eindeutig wählen (Kürzel je Modul).`)
}

const MODAL_MODULES = {}
/** Dialog registrieren; module: Bereich, dessen Schreibrecht die Eingaben im Dialog freigibt (sonst die aktuelle Ansicht). */
export function registerModal(type, render, { module = null } = {}) {
  clash('Dialog', type, MODALS[type], render)
  MODALS[type] = render
  if (module) MODAL_MODULES[type] = module
}

/**
 * Aktionen registrieren. { edit: 'zaehler' } (oder ['planung', 'stammdaten'],
 * '*' = nur Vollzugriff) sperrt sie ohne Schreibrecht im Bereich – egal aus
 * welcher Ansicht (Suche, Übersicht) der Dialog geöffnet wurde.
 * { edit: true } richtet sich nach der aktuellen Ansicht (nur für Aktionen, die
 * es ausschließlich in einer Ansicht gibt).
 */
export function registerActions(handlers, { edit = false } = {}) {
  for (const [name, fn] of Object.entries(handlers)) {
    clash('Aktion', name, ACTIONS[name], fn)
    ACTIONS[name] = edit
      ? Object.assign((...args) => {
          if (edit === true ? app.readOnly : !mayEdit(edit)) {
            const locked = app.locked && (edit === true || [].concat(edit).includes('planung'))
            return toast(locked ? 'Diese Woche ist ohne Verbindung nicht geladen. Bitte warten, bis wieder Netz da ist.' : 'Nur Leserechte: Änderungen sind für dein Konto nicht freigegeben.')
          }
          return fn(...args)
        }, { raw: fn })
      : fn
  }
}

// ---------------------------------------------------------------- Später laden
// Große, selten gebrauchte Module (Fakturierung, Material, Anleitung …) sind im Build eigene
// Dateien und kommen erst, wenn ihre Ansicht, ein Dialog oder eine Aktion zum ersten Mal gebraucht
// wird, spätestens kurz nach dem Start im Hintergrund (preloadLazy). Bis dahin stehen Platzhalter
// in VIEWS, MODALS, ACTIONS und OBJECT_HINTS: Seitenleiste, Suche, Cleo, Rollen und ACTIONS[name]
// sehen alles schon vorher. Beim Laden registriert sich das Modul wie gewohnt selbst und ersetzt
// die Platzhalter. Angaben je Modul: views/lazy.js, Anleitung: docs/ERWEITERN.md.

/** Später geladene Module: [{ views, module, loaded, load(), visible() }] */
export const LAZY = []
const LOADING = '<p class="muted">Wird geladen …</p>'

function lazyFailed(err) {
  console.error(err)
  toast('Dieser Teil der App konnte nicht geladen werden (ohne Netz oder neue Version). Bitte die App neu laden.')
}

/**
 * Modul erst bei Bedarf laden. load: () => import('./modul.js');
 * views: Kopfdaten wie bei registerView, ohne render (badge, range, actions dürfen fehlen);
 * modals, actions: alle Namen, die das Modul registriert (Liste oder Text mit Leerzeichen);
 * hints: true, wenn es registerObjectHint aufruft. test/lazy.test.js prüft die Angaben gegen das Modul.
 */
export function registerLazy(load, { views = [], modals = [], actions = [], hints = false, module = null } = {}) {
  const names = (x) => (Array.isArray(x) ? x : String(x).split(/\s+/)).filter(Boolean)
  let pending = null
  const entry = {
    views: views.map((v) => v.id),
    module: module || views[0]?.module || null,
    loaded: false,
    load: () =>
      (pending ||= load().then(
        () => void (entry.loaded = true),
        (err) => {
          pending = null
          throw err
        },
      )),
    // sieht die Rolle eine der Ansichten (ohne Ansicht: das Modul)?
    visible: () => (entry.views.length ? visibleViews().some((v) => entry.views.includes(v.id)) : !app.access || app.access.sees(entry.module)),
  }
  LAZY.push(entry)
  for (const view of views) {
    const stub = { ...view, lazy: entry }
    stub.render = () => {
      entry.waiting ||= entry
        .load()
        .then(() => render(), lazyFailed)
        .finally(() => (entry.waiting = null))
      return LOADING
    }
    registerView(stub)
  }
  for (const type of names(modals)) {
    const stub = (c, modal) => {
      entry.load().then(() => app.ui.modal === modal && renderModal(), lazyFailed)
      return modalFrame({ title: 'Wird geladen …', body: LOADING })
    }
    stub.lazy = entry
    clash('Dialog', type, MODALS[type], stub)
    MODALS[type] = stub
  }
  for (const name of names(actions)) {
    const stub = (...args) => entry.load().then(() => (ACTIONS[name] === stub ? undefined : ACTIONS[name]?.(...args)), lazyFailed)
    stub.lazy = entry
    clash('Aktion', name, ACTIONS[name], stub)
    ACTIONS[name] = stub
  }
  if (hints) OBJECT_HINTS.push({ module: entry.module, lazy: entry, html: () => '' })
  return entry
}

// Für Code, der eine Ansicht, einen Dialog oder eine Aktion direkt aufruft, ohne dass die Person
// sie geöffnet hat (z. B. Berichte im Hintergrund): erst laden, dann das echte Objekt nehmen.
// Werfen, wenn das Modul nicht geladen werden kann. Platzhalter-Aktionen selbst warten ebenfalls
// und geben das Ergebnis (Promise) der echten Aktion zurück.
/** Ansicht bereit: `(await ensureView('material')).render(c)`. */
export async function ensureView(id) {
  await VIEWS.find((v) => v.id === id)?.lazy?.load()
  return VIEWS.find((v) => v.id === id)
}
/** Dialog bereit: `(await ensureModal('todo'))(c, {})`. */
export async function ensureModal(type) {
  await MODALS[type]?.lazy?.load()
  return MODALS[type]
}
/** Aktion bereit: `(await ensureAction('mat-stock-csv'))(el)`. */
export async function ensureAction(name) {
  await ACTIONS[name]?.lazy?.load()
  return ACTIONS[name]
}

/**
 * Nach dem Start im Hintergrund: noch nicht geladene Module der eigenen Bereiche laden. Danach
 * stimmen Zähler, „Zu erledigen“ und Hinweise, und alles geht auch ohne Netz (Keller), selbst wenn
 * der Service Worker die neue Version noch nicht ganz vorhält. true, wenn etwas neu geladen wurde.
 */
export async function preloadLazy() {
  const list = LAZY.filter((l) => !l.loaded && l.visible())
  await Promise.all(list.map((l) => l.load().catch(() => {})))
  return list.some((l) => l.loaded)
}

// ---------------------------------------------------------------- Berechnung

export const currentMonth = () => app.ui.month || addDays(app.ui.monday, 3).slice(0, 7)

export function windowFor(monday, month) {
  const sunday = addDays(monday, 6)
  const mFrom = `${month}-01`
  const mTo = lastOfMonth(mFrom)
  return {
    from: [firstOfMonth(monday), addDays(monday, -7), mFrom].sort()[0],
    to: [lastOfMonth(sunday), addDays(sunday, 7), mTo].sort()[2],
  }
}

/**
 * Daten für Plan und Ansichten. Ohne Leserecht auf personal/ kennt die App im Betrieb nur „abwesend
 * von–bis“ (daten/abwesend.json); die Rollen-Vorschau im Browser zeigt es genauso, damit der Grund
 * (Krankenstand ist ein Gesundheitsdatum) weder im Plan noch in Tooltips, PDF oder E-Mail erscheint.
 */
/** Grund der Abwesenheit (personal/abwesenheiten.json) lesbar? Ohne Recht nur „abwesend von–bis“. */
export const seesAbsenceReasons = () => !app.access || dataRights(app.access).read(DOC.absences)

function planData() {
  const { data } = app
  if (seesAbsenceReasons()) return data
  return { ...data, absences: absentList(data).map((a) => ({ ...a, type: ABSENT, limited: true })) }
}

/** Zeitkonto (lohn/zeitkonto.json) lesbar? Ohne Recht stünde dort im Betrieb ±0, nicht der echte Stand. */
export const seesAccount = () => !app.access || dataRights(app.access).read(DOC.account)

/** Abwesenheiten, wie die Rolle sie sehen darf (ohne Recht auf personal/: nur „Abwesend“). */
export const visibleAbsences = () => planData().absences || []

// Ergebnisse von compute() bleiben gültig, bis sich Daten ändern (persist,
// geladene oder zusammengeführte Dokumente). Ansichtswechsel, Filter und
// Suche rechnen dadurch nicht neu.
const computed = new Map()
export const dataStamp = () => `${app.dataVersion || 0}|${app.service?.version || 0}`

/** Berechnete Woche (Standard: angezeigte Woche). */
export function compute(monday = app.ui.monday, month = monday === app.ui.monday ? currentMonth() : addDays(monday, 3).slice(0, 7)) {
  // Rolle gehört dazu: die Vorschau einer Rolle ohne personal/ rechnet mit „abwesend“ (planData)
  const key = `${dataStamp()}|${app.access?.roles?.join() || ''}|${monday}|${month}`
  if (!computed.has(key)) {
    if (computed.size > 8) computed.delete(computed.keys().next().value)
    computed.set(key, computeFresh(monday, month))
  }
  return computed.get(key)
}

function computeFresh(monday, month) {
  const data = planData()
  const sunday = addDays(monday, 6)
  const { from, to } = windowFor(monday, month)
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  ctx.weather = app.weatherLookup // Wetter (Hitze, Sturm) für die Prüfregel, falls geladen
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const state = new PlanState(instances, data.assignments)
  const validation = validatePlan(ctx, state, instances, { from: monday, to: sunday })
  const week = instances.filter((i) => (i.date >= monday && i.date <= sunday) || (i.status === 'cancelled' && i.origDate >= monday && i.origDate <= sunday))
  const published = data.published?.[monday] || null
  const sheets = new Map()
  const timesheet = (emp) => {
    if (!sheets.has(emp.id)) sheets.set(emp.id, buildTimesheet(ctx, emp, monday, instances, state))
    return sheets.get(emp.id)
  }
  // neu dazu (nicht im Stand der Veröffentlichung) und jetzt mit Einsätzen: ebenfalls geändert
  const hasWork = (emp) => timesheet(emp).days.some((d) => d.lines.some((l) => l.kind === 'work'))
  const changedSincePublish = (emp) => !!published?.snapshot && (published.snapshot[emp.id] === undefined ? hasWork(emp) : published.snapshot[emp.id] !== timesheetSignature(timesheet(emp)))
  return { monday, sunday, month, from, to, holidays, ctx, instances, state, validation, week, days: eachDay(monday, sunday), published, timesheet, changedSincePublish }
}

/** Berechnung für einen beliebigen Zeitraum (z. B. Abwesenheit über mehrere Wochen). */
export function computeRange(from, to) {
  const data = planData()
  const wFrom = [firstOfMonth(from), addDays(mondayOf(from), -7)].sort()[0]
  const wTo = [lastOfMonth(to), addDays(mondayOf(to), 13)].sort()[1]
  const holidays = holidayCalendar(wFrom, wTo, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, wFrom, wTo, holidays, ctx.rules)
  const state = new PlanState(instances, data.assignments)
  return { from, to, holidays, ctx, instances, state }
}

/** Wochen-Dateien eines Zeitraums laden (SharePoint). */
export async function ensureRange(from, to) {
  const wFrom = [firstOfMonth(from), addDays(mondayOf(from), -7)].sort()[0]
  const wTo = [lastOfMonth(to), addDays(mondayOf(to), 13)].sort()[1]
  await app.service.ensureWeeks(mondaysBetween(wFrom, wTo))
}

/**
 * Wochen, die schon eingeteilt sind: dort hat die Automatik geplant (nicht
 * fixierte Einteilungen). Händische Einteilungen und Übergaben sind fixiert
 * und zählen nicht, damit die Woche später trotzdem automatisch geplant wird.
 */
export function plannedWeeks() {
  const weeks = new Set()
  const mondays = new Map() // Tag → Montag (viele Einteilungen je Tag; mondayOf rechnet mit Datumsobjekten)
  for (const [key, list] of Object.entries(app.data.assignments)) {
    if (!list.some((a) => !a.locked)) continue
    const day = key.slice(0, 10)
    if (!mondays.has(day)) mondays.set(day, mondayOf(day))
    weeks.add(mondays.get(day))
  }
  return weeks
}

// ---------------------------------------------------------------- Darstellung

let renderHooks = { frame: () => '', afterRender: () => {} }
export function setFrame(hooks) {
  renderHooks = { ...renderHooks, ...hooks }
}

export async function render() {
  applyRedirect()
  const { from, to } = windowFor(app.ui.monday, currentMonth())
  // Ansicht noch nicht geladen (registerLazy): gleichzeitig mit den Wochen holen
  const lazy = visibleViews().find((v) => v.id === app.ui.view)?.lazy?.load().catch(lazyFailed)
  try {
    await app.service.ensureWeeks(mondaysBetween(from, to))
    await lazy
    const extra = VIEWS.find((v) => v.id === app.ui.view)?.range?.()
    if (extra) await ensureRange(extra.from, extra.to)
  } catch (err) {
    toast(`Wochen konnten nicht geladen werden: ${err.message}`)
  }
  renderNow()
  prefetchNeighbours()
}

/** Vorige und nächste Woche im Hintergrund laden, damit Blättern sofort geht. */
let prefetchTimer = null
function prefetchNeighbours() {
  if (!app.service?.prefetchWeeks || app.store?.kind !== 'sharepoint') return
  clearTimeout(prefetchTimer)
  prefetchTimer = setTimeout(() => {
    const mondays = []
    for (const step of [7, -7]) {
      const m = addDays(app.ui.monday, step)
      const w = windowFor(m, addDays(m, 3).slice(0, 7))
      mondays.push(...mondaysBetween(w.from, w.to))
    }
    app.service.prefetchWeeks(mondays)
  }, 400)
}

// Ergebnisse, die nur von den Daten abhängen (z. B. Vorschläge je Einsatz), je Berechnung merken:
// compute() liefert dasselbe Objekt, bis sich Daten ändern; danach wird neu gerechnet.
const memos = new WeakMap()
export function memo(c, key, fn) {
  if (!c || typeof c !== 'object') return fn()
  let m = memos.get(c)
  if (!m) memos.set(c, (m = new Map()))
  if (!m.has(key)) m.set(key, fn())
  return m.get(key)
}

/**
 * fn als ein Zeichnen: Zähler der Ansichten je einmal (oncePerPass), Bezüge der Belege (Storno, verrechnete Lieferscheine)
 * über einen Index statt je Beleg durch alle Belege (core/invoicing.js, withDocIndex). Beim Zeichnen ändern sich die Daten nicht.
 */
export function drawing(fn) {
  const outer = pass
  pass = new Map()
  try {
    return withDocIndex(app.data?.fakturierung?.documents, fn)
  } finally {
    pass = outer
  }
}

let lastView = null
export function renderNow() {
  // Umleitung aus der Adresse (z. B. erst nach dem Laden der Daten bekannt): mit Laden der Ansicht zeichnen
  if (applyRedirect()) return void render()
  const $app = document.getElementById('app')
  const scroller = document.querySelector('.grid-wrap, .sheet-wrap')
  const scrollLeft = scroller?.scrollLeft || 0
  app.cur = compute()
  // gleiche Ansicht: nur Geändertes anpassen (schneller, Scrollen und Eingaben bleiben); andere Ansicht: ersetzen
  const view = `${app.ui.view}|${isMobileLayout()}`
  drawing(() => patch($app, renderHooks.frame(app.cur), { replace: view !== lastView }))
  lastView = view
  const next = document.querySelector('.grid-wrap, .sheet-wrap')
  if (next && next.scrollLeft !== scrollLeft) next.scrollLeft = scrollLeft
  renderModal()
  renderHooks.afterRender(app.cur)
}
const isMobileLayout = () => (typeof document !== 'undefined' && document.body.classList.contains('mobile') ? 1 : 0)

const MODAL_HOOKS = []
/** Nach jedem Zeichnen eines Dialogs (z. B. Unterschriftsfelder füllen). */
export const onModalRender = (fn) => MODAL_HOOKS.push(fn)

export function renderModal() {
  const $modal = document.getElementById('modal-root')
  const { ui } = app
  if (!ui.modal) {
    $modal.innerHTML = ''
    return
  }
  const scroll = $modal.querySelector('.modal-backdrop')?.scrollTop || 0
  const bodyScroll = $modal.querySelector('.modal-body')?.scrollTop || 0
  const candScroll = $modal.querySelector('.candidates')?.scrollTop || 0
  const html = drawing(() => MODALS[ui.modal.type]?.(app.cur, ui.modal))
  if (!html) {
    ui.modal = null
    $modal.innerHTML = ''
    return
  }
  // „opening“ nur beim Öffnen: Einblenden einmal, nicht bei jedem Neuzeichnen
  $modal.innerHTML = `<div class="modal-backdrop${ui.modal.justOpened ? ' opening' : ''}" data-action="backdrop">${html}</div>`
  // Eingaben im Dialog nach dem Recht seines Bereichs (nicht der Ansicht, aus der er geöffnet wurde)
  const module = MODAL_MODULES[ui.modal.type]
  $modal.classList.toggle('readonly', module ? !mayEdit(module) : app.readOnly)
  $modal.querySelector('.modal-backdrop').scrollTop = scroll
  const cand = $modal.querySelector('.candidates')
  if (cand) cand.scrollTop = candScroll
  const body = $modal.querySelector('.modal-body')
  if (body) body.scrollTop = bodyScroll
  labelTables($modal)
  for (const fn of MODAL_HOOKS) fn($modal)
  if (ui.modal.justOpened) {
    ui.modal.justOpened = false
    $modal.querySelector('.modal input, .modal select, .modal textarea, .modal button')?.focus({ preventScroll: true })
  }
}

/** Dialog neu zeichnen, ohne bereits getippte Eingaben zu verlieren (`skip`: Felder, die aus dem Zustand neu entstehen). */
export function renderModalKeepingInput(skip = /^$/) {
  const fields = [...document.querySelectorAll('#modal-root input[id], #modal-root select[id], #modal-root textarea[id]')]
  const saved = fields.filter((el) => el.type !== 'file' && !skip.test(el.id)).map((el) => [el.id, el.type === 'checkbox' ? el.checked : el.value])
  renderModal()
  for (const [id, value] of saved) {
    const el = document.getElementById(id)
    if (!el) continue
    if (el.type === 'checkbox') el.checked = value
    else el.value = value
  }
}

// Knopf, der den Dialog geöffnet hat: nach dem Schließen bekommt er den Fokus zurück (Tastatur)
let returnFocus = null

export function openModal(modal) {
  if (!app.ui.modal && typeof document !== 'undefined') returnFocus = document.activeElement?.closest?.('button, summary, a[href]') || null
  app.ui.modal = { ...modal, justOpened: true }
  app.ui.confirm = null
  renderModal()
}

export function closeModal() {
  app.ui.modal = null
  app.ui.confirm = null
  renderModal()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}

let toastTimer = null
let lastToastAt = 0
/** Kurze Meldung unten. Direkt nach einer Planänderung mit „Rückgängig“. */
export function toast(message) {
  const $toast = document.getElementById('toast')
  const last = undoStack.at(-1)
  const offerUndo = last && Date.now() - last.at < 1500 && !app.readOnly
  $toast.innerHTML = `<span>${esc(message)}</span>${offerUndo ? '<button class="toast-btn" data-action="undo">Rückgängig</button>' : ''}`
  $toast.hidden = false
  lastToastAt = Date.now()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($toast.hidden = true), offerUndo ? 8000 : 5000)
}

// ---------------------------------------------------------------- Rückgängig

const undoStack = []
const UNDO_FIELDS = ['assignments', 'overrides', 'trips', 'winter', 'winterlog', 'stamps', 'payroll', 'tasks']
const weekOfKey = (key) => mondayOf(key.slice(0, 10))

/** Stand vor einer Planänderung merken (Einteilungen, Einzeländerungen, Fahrten). */
export function recordUndo(label) {
  const at = Date.now()
  undoStack.push({ label, at, weeks: new Set(app.service?.weeks || []), data: Object.fromEntries(UNDO_FIELDS.map((f) => [f, structuredClone(app.data[f] || {})])) })
  if (undoStack.length > 30) undoStack.shift()
  // Zeigt die Aktion selbst keine Meldung, kommt eine mit „Rückgängig“
  setTimeout(() => {
    if (lastToastAt < at && undoStack.at(-1)?.at === at) toast(label)
  }, 0)
}

/** Letzte Planänderung zurücknehmen. Wochen, die erst danach geladen wurden, bleiben unberührt. */
export function undo() {
  const last = undoStack.pop()
  if (!last) return toast('Nichts zum Rückgängigmachen.')
  for (const field of UNDO_FIELDS) {
    // Monatsabschlüsse und Stammplan gehören zu keiner Woche: ganz zurücksetzen
    if (field === 'payroll' || field === 'tasks') {
      app.data[field] = last.data[field]
      continue
    }
    const kept = Object.entries(app.data[field] || {}).filter(([key]) => !last.weeks.has(weekOfKey(key)))
    app.data[field] = { ...Object.fromEntries(kept), ...last.data[field] }
  }
  addLog(app.ui.monday, `Rückgängig: ${last.label}`)
  persist()
  renderNow()
  lastToastAt = Date.now()
  const $toast = document.getElementById('toast')
  $toast.textContent = `Rückgängig gemacht: ${last.label}`
  $toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($toast.hidden = true), 4000)
}

/** Nach Änderungen anderer Personen: alte Stände nicht mehr zurückspielen. */
export const clearUndo = () => (undoStack.length = 0)

/** Zweistufige Bestätigung ohne Browser-Dialog. Liefert true beim zweiten Klick. */
export function confirmStep(key, rerender = renderNow) {
  if (app.ui.confirm === key) {
    app.ui.confirm = null
    return true
  }
  app.ui.confirm = key
  rerender()
  return false
}

/**
 * Tabellen fürs Handy: jede Zelle bekommt die Spaltenüberschrift als
 * data-label, damit sie auf schmalen Bildschirmen als Karte lesbar ist.
 */
export function labelTables(root = document) {
  for (const table of root.querySelectorAll('table.data:not([data-labelled])')) {
    // Zeilenumbrüche (<br>) in der Überschrift als Leerzeichen, sonst „Unterweisung§ 14 ASchG“
    const heads = [...table.querySelectorAll('thead th')].map((th) => [...th.childNodes].map((n) => (n.nodeName === 'BR' ? ' ' : n.textContent)).join('').replace(/\s+/g, ' ').trim())
    for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((cell, i) => cell.setAttribute('data-label', heads[i] || ''))
    table.setAttribute('data-labelled', '')
  }
}

// ---------------------------------------------------------------- Speichern

export function addLog(monday, text) {
  const { data } = app
  data.logs = data.logs || {}
  const list = data.logs[monday] || []
  list.push({ at: new Date().toISOString(), by: app.user?.name || 'Browser', text })
  data.logs[monday] = list.slice(-300)
}

/** Daten geändert: Rechen-Caches verwerfen (ohne Speichern). */
export function touch() {
  app.dataVersion = (app.dataVersion || 0) + 1
}

export function persist() {
  touch()
  app.service.schedule()
}

/** Einteilungen ändern, protokollieren, speichern und neu zeichnen. */
export function mutateAssignments(fn, logText) {
  recordUndo(typeof logText === 'object' ? logText.text : logText || 'Einteilung geändert')
  const state = new PlanState(app.cur.instances, app.data.assignments)
  const result = fn(state)
  app.data.assignments = state.toObject()
  if (logText) addLog(mondayOf(typeof logText === 'object' ? logText.date : app.ui.monday), typeof logText === 'object' ? logText.text : logText)
  persist()
  renderNow()
  return result
}

export const empName = (id) => app.data.employees.find((e) => e.id === id)?.name || '?'

export function saveStatusText(status, detail) {
  const where = esc(app.store?.label || '')
  switch (status) {
    case 'loading':
      return 'Lädt …'
    case 'syncing':
      return `<span class="sync-text">Gleicht mit SharePoint ab …</span>`
    case 'pending':
    case 'saving':
      return 'Speichert …'
    case 'error':
      return `<span class="err-text">Nicht gespeichert: ${esc(detail)}</span>`
    case 'offline':
      return `<span class="offline-text">Offline${Number(detail) ? ` · ${Number(detail)} ${Number(detail) === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : ''} · wird gespeichert, sobald Netz da ist</span>`
    default:
      return `Gespeichert${where ? ` · ${where}` : ''}`
  }
}
