// Zentraler App-Zustand, Berechnung der aktuellen Woche und Registrierung von
// Ansichten, Dialogen und Aktionen. Erweiterungen melden sich hier an
// (siehe docs/ERWEITERN.md).

import { addDays, eachDay, firstOfMonth, lastOfMonth, mondayOf, todayISO } from '../core/dates.js'
import { holidayCalendar } from '../core/holidays.js'
import { buildInstances, PlanState } from '../core/plan.js'
import { mondaysBetween } from '../core/reports.js'
import { createContext, validatePlan } from '../core/rules.js'
import { buildTimesheet, timesheetSignature } from '../core/timesheet.js'
import { esc } from './shared.js'

export const app = {
  config: null,
  user: null,
  store: null,
  service: null,
  data: null,
  readOnly: false,
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
export const MODALS = {}
export const ACTIONS = {}

/** Ansicht registrieren: { id, label, group: 'plan'|'auswertung'|'stamm', order, render(c), summary?, badge?(c) } */
export function registerView(view) {
  const idx = VIEWS.findIndex((v) => v.id === view.id)
  if (idx >= 0) VIEWS.splice(idx, 1, view)
  else VIEWS.push(view)
  VIEWS.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function registerModal(type, render) {
  MODALS[type] = render
}

/** Aktionen registrieren. Mit { edit: true } sind sie im Lesemodus gesperrt. */
export function registerActions(handlers, { edit = false } = {}) {
  for (const [name, fn] of Object.entries(handlers)) {
    ACTIONS[name] = edit
      ? (...args) => {
          if (app.readOnly) return toast('Nur Leserechte: Änderungen sind für dein Konto nicht freigegeben.')
          return fn(...args)
        }
      : fn
  }
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

export function compute() {
  const { data, ui } = app
  const monday = ui.monday
  const sunday = addDays(monday, 6)
  const month = currentMonth()
  const { from, to } = windowFor(monday, month)
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
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
  const changedSincePublish = (emp) => !!published?.snapshot && published.snapshot[emp.id] !== undefined && published.snapshot[emp.id] !== timesheetSignature(timesheet(emp))
  return { monday, sunday, month, from, to, holidays, ctx, instances, state, validation, week, days: eachDay(monday, sunday), published, timesheet, changedSincePublish }
}

// ---------------------------------------------------------------- Darstellung

let renderHooks = { frame: () => '', afterRender: () => {} }
export function setFrame(hooks) {
  renderHooks = { ...renderHooks, ...hooks }
}

export async function render() {
  const { from, to } = windowFor(app.ui.monday, currentMonth())
  try {
    await app.service.ensureWeeks(mondaysBetween(from, to))
  } catch (err) {
    toast(`Wochen konnten nicht geladen werden: ${err.message}`)
  }
  renderNow()
}

export function renderNow() {
  const $app = document.getElementById('app')
  const scroller = document.querySelector('.grid-wrap, .sheet-wrap')
  const scrollLeft = scroller?.scrollLeft || 0
  app.cur = compute()
  $app.innerHTML = renderHooks.frame(app.cur)
  const next = document.querySelector('.grid-wrap, .sheet-wrap')
  if (next) next.scrollLeft = scrollLeft
  renderModal()
  renderHooks.afterRender(app.cur)
}

export function renderModal() {
  const $modal = document.getElementById('modal-root')
  const { ui } = app
  if (!ui.modal) {
    $modal.innerHTML = ''
    return
  }
  const scroll = $modal.querySelector('.modal-backdrop')?.scrollTop || 0
  const candScroll = $modal.querySelector('.candidates')?.scrollTop || 0
  const html = MODALS[ui.modal.type]?.(app.cur, ui.modal)
  if (!html) {
    ui.modal = null
    $modal.innerHTML = ''
    return
  }
  $modal.innerHTML = `<div class="modal-backdrop" data-action="backdrop">${html}</div>`
  $modal.querySelector('.modal-backdrop').scrollTop = scroll
  const cand = $modal.querySelector('.candidates')
  if (cand) cand.scrollTop = candScroll
  if (ui.modal.justOpened) {
    ui.modal.justOpened = false
    $modal.querySelector('.modal input, .modal select, .modal textarea, .modal button')?.focus({ preventScroll: true })
  }
}

export function openModal(modal) {
  app.ui.modal = { ...modal, justOpened: true }
  app.ui.confirm = null
  renderModal()
}

export function closeModal() {
  app.ui.modal = null
  app.ui.confirm = null
  renderModal()
}

let toastTimer = null
export function toast(message) {
  const $toast = document.getElementById('toast')
  $toast.textContent = message
  $toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($toast.hidden = true), 5000)
}

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

// ---------------------------------------------------------------- Speichern

export function addLog(monday, text) {
  const { data } = app
  data.logs = data.logs || {}
  const list = data.logs[monday] || []
  list.push({ at: new Date().toISOString(), by: app.user?.name || 'Browser', text })
  data.logs[monday] = list.slice(-300)
}

export function persist() {
  app.service.schedule()
}

/** Einteilungen ändern, protokollieren, speichern und neu zeichnen. */
export function mutateAssignments(fn, logText) {
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
    case 'pending':
    case 'saving':
      return 'Speichert …'
    case 'error':
      return `<span class="err-text">Nicht gespeichert: ${esc(detail)}</span>`
    default:
      return `Gespeichert${where ? ` · ${where}` : ''}`
  }
}
