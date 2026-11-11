// "Zu erledigen": Was muss (neu) zugeteilt werden? Glocke in der Kopfzeile mit
// Zähler und Popup beim Start, sobald es etwas Neues gibt.
//  - Abwesenheiten mit offenen oder noch eingeteilten Einsätzen
//  - periodische Leistungen (14-tägig, monatlich, quartalsweise …) ohne
//    Besetzung, rechtzeitig vor dem Termin (Regel „dueLeadDays“)
//  - veröffentlichte Wochen, die danach geändert wurden (Korrektur buchen)
//  - Punkte weiterer Module (registerTodo, z. B. Fahrzeuge: Service, Pickerl, Reifen)
// Jede Person sieht nur, was sie erledigen kann: Punkte der Module, in denen
// ihre Rolle ändern darf (wer die Einsatzplanung nur liest, bekommt keine
// Zuteil-Aufgaben).

import { absenceImpact, periodicDue } from '../../core/attention.js'
import { addDays, formatDate, formatHours, isoWeek, mondayOf, todayISO } from '../../core/dates.js'
import { buildTimesheet, timesheetSignature } from '../../core/timesheet.js'
import { app, canEdit, computeRange, dataStamp, drawing, empName, ensureRange, openModal, plannedWeeks, registerActions, registerModal, render } from '../context.js'
import { ABSENCE_CLASS, esc, ICON, modalFrame } from '../shared.js'

const SEEN_KEY = 'einsatzplaner.todoSeen.v1'
const BACK_DAYS = 56 // Korrekturen bis 8 Wochen zurück
const AHEAD_DAYS = 35

export const todoWindow = (today = todayISO()) => ({ from: addDays(today, -BACK_DAYS), to: addDays(today, AHEAD_DAYS) })

export const SOURCES = []
/**
 * Weitere Quelle für „Zu erledigen“: { id, module, title, compute(today) → [{ id, … }], render(items, c) → HTML }
 * Die id jedes Punkts ändert sich, wenn er wieder neu gemeldet werden soll.
 */
export function registerTodo(source) {
  const idx = SOURCES.findIndex((s) => s.id === source.id)
  // ersetzt den Platzhalter eines später geladenen Moduls (views/lazy.js): nur die Punkte der Module neu, nicht die Planung
  if (idx >= 0 && SOURCES[idx].lazy) queueMicrotask(refreshSources)
  if (idx >= 0) SOURCES.splice(idx, 1, source)
  else SOURCES.push(source)
}

/** Punkte eines Moduls nur für Rollen, die dort ändern dürfen; ohne Modul (betrifft nur dieses Gerät, z. B. nicht hochgeladene Dateien) für alle. */
const mayDo = (module) => !module || canEdit(module)

/** Punkte der weiteren Module (registerTodo). */
function sourceItems(today) {
  const extra = SOURCES.filter((src) => mayDo(src.module))
    .map((source) => ({ source, items: source.compute(today) }))
    .filter((x) => x.items.length)
  return { extra, extraIds: extra.flatMap((x) => x.items.map((i) => `${x.source.id}:${i.id}`)) }
}

export function computeTodo(today = todayISO()) {
  return planItems(today, sourceItems(today))
}

/** Punkte der Einsatzplanung (Abwesenheiten, periodische Leistungen, geänderte Wochen) dazu, Ergebnis wie computeTodo. */
function planItems(today, { extra, extraIds }) {
  if (!mayDo('planung')) return { today, lead: 0, absences: [], periodic: [], weeks: [], extra, count: extraIds.length, ids: extraIds }
  const { from, to } = todoWindow(today)
  const r = computeRange(from, to)
  const planned = plannedWeeks()
  const isPlanned = (m) => planned.has(m)
  const lead = r.ctx.rules.dueLeadDays ?? 7

  const absences = []
  const handled = new Set()
  for (const a of app.data.absences || []) {
    if (a.to < addDays(today, -28) || a.from > to) continue
    const rows = absenceImpact(r.ctx, r.instances, r.state, a).rows.filter((x) => !x.cancelled && (x.open > 0 || x.stillAssigned))
    rows.forEach((x) => handled.add(x.inst.key))
    if (!rows.length) continue
    absences.push({
      id: `abs:${a.id}:${rows.length}`,
      absence: a,
      count: rows.length,
      minutes: rows.reduce((s, x) => s + x.inst.net, 0),
      stillAssigned: rows.filter((x) => x.stillAssigned).length,
      retro: a.from < today,
      unplanned: rows.every((x) => !isPlanned(mondayOf(x.inst.origDate))),
    })
  }

  const periodic = periodicDue(r.ctx, r.instances, r.state, app.data.tasks, { from: today, to: addDays(today, lead + 7), isPlanned })
    .filter((d) => d.status === 'zuteilen' && !handled.has(d.inst.key))
    .map((d) => ({ ...d, id: `per:${d.inst.key}`, deadline: addDays(d.inst.date, -lead), overdue: addDays(d.inst.date, -lead) < today }))

  const weeks = []
  for (const [monday, p] of Object.entries(app.data.published || {})) {
    if (!p.snapshot || monday < mondayOf(from) || monday > to) continue
    const changed = r.ctx.employees.filter((emp) => p.snapshot[emp.id] !== undefined && p.snapshot[emp.id] !== timesheetSignature(buildTimesheet(r.ctx, emp, monday, r.instances, r.state)))
    if (changed.length) weeks.push({ id: `pub:${monday}:${changed.length}`, monday, changed, started: monday <= today })
  }
  weeks.sort((a, b) => a.monday.localeCompare(b.monday))

  const ids = [...[...absences, ...periodic, ...weeks].map((x) => x.id), ...extraIds]
  return { today, lead, absences, periodic, weeks, extra, count: ids.length, ids }
}

// Berechnung nur nach Änderungen
let cache = { key: null, todo: null, access: null }
// Der letzte Datenstand darf innerhalb derselben Rolle weiter sichtbar bleiben,
// aber beim Rollenwechsel nicht Aufgaben der vorherigen Rolle übernehmen.
const lastForAccess = () => (cache.access === app.access ? cache.todo : null)
const keyNow = () => `${dataStamp()}|${todayISO()}|${Object.keys(app.data.assignments).length}|${(app.data.absences || []).length}|${Object.keys(app.data.published || {}).length}|${app.access?.roles.join() || ''}`
/** Neu berechnen beim nächsten Mal (z. B. wenn eine Quelle Daten vom Webspace bekommen hat). */
export const invalidateTodo = () => (cache.key = null)
export function todo() {
  const key = keyNow()
  // wie beim Zeichnen: Bezüge der Belege über einen Index (context.js drawing), die Daten ändern sich dabei nicht
  if (cache.key !== key || cache.access !== app.access) {
    job = null
    cache = { key, todo: drawing(() => computeTodo()), access: app.access }
  }
  return cache.todo
}

// Im Hintergrund: Zähler (Glocke, digitaler Mitarbeiter im Menü, Startseite) warten nicht auf die Berechnung. Nach einer
// Änderung zeigen sie kurz den letzten Stand; „Zu erledigen“ rechnet danach Quelle für Quelle mit Pausen dazwischen (die
// Bedienung bleibt flüssig) und zeichnet neu, wenn etwas mit dem alten Stand gezeichnet wurde.
const EMPTY = { today: '', lead: 0, absences: [], periodic: [], weeks: [], extra: [], count: 0, ids: [] }
let job = null
let staleDrawn = false
/** Ergebnis zum aktuellen Datenstand oder null (rechnet nicht). */
export const todoReady = () => (app.data && cache.key === keyNow() ? lastForAccess() : null)
/** Ergebnis zum aktuellen Datenstand, sonst der letzte Stand (und im Hintergrund neu rechnen). Für Zähler und Übersichten. */
export function todoOrLast() {
  const ready = todoReady()
  if (ready) return ready
  staleDrawn = true
  todoSoon()
  return lastForAccess() || EMPTY
}
const idle = () => new Promise((resolve) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 300 }) : setTimeout(resolve, 0)))
/** „Zu erledigen“ im Hintergrund neu rechnen (Quelle für Quelle); fertig: Glocke anpassen, bei Bedarf neu zeichnen. */
export function todoSoon() {
  if (!app.data) return
  const key = keyNow()
  if ((cache.key === key && cache.access === app.access) || (job?.key === key && job.access === app.access)) return
  const my = (job = { key, access: app.access })
  const alive = () => job === my && keyNow() === key && app.access === my.access
  ;(async () => {
    const today = todayISO()
    const extra = []
    for (const source of SOURCES.filter((src) => mayDo(src.module))) {
      await idle()
      if (!alive()) return
      const items = drawing(() => source.compute(today))
      if (items.length) extra.push({ source, items })
    }
    await idle()
    if (!alive()) return
    const extraIds = extra.flatMap((x) => x.items.map((i) => `${x.source.id}:${i.id}`))
    const t = drawing(() => planItems(today, { extra, extraIds }))
    job = null
    if (cache.key === key && cache.access === app.access) return
    cache = { key, todo: t, access: app.access }
    setBell(t.count)
    // neu zeichnen, was mit dem alten Stand gezeichnet wurde – nicht bei offenem Dialog oder während einer Eingabe
    // (das nächste Zeichnen nimmt ohnehin den neuen Stand)
    if (staleDrawn && !app.ui.modal && !document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      staleDrawn = false
      render()
    }
  })().catch((err) => {
    if (job === my) job = null
    console.warn('Zu erledigen:', err)
  })
}

function setBell(count) {
  const el = typeof document !== 'undefined' && document.getElementById('todo-count')
  if (!el) return
  el.textContent = count || ''
  el.hidden = !count
}

/** Modul nachgeladen: im gemerkten Ergebnis die Punkte der Module neu, die (teure) Planung bleibt. */
function refreshSources() {
  const t = lastForAccess()
  if (!t) return
  const planIds = t.ids.slice(0, t.ids.length - t.extra.reduce((n, x) => n + x.items.length, 0))
  const { extra, extraIds } = drawing(() => sourceItems(t.today))
  const ids = [...planIds, ...extraIds]
  cache.todo = { ...t, extra, count: ids.length, ids }
}

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY)) || []
  } catch {
    return []
  }
}

function markSeen(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids))
  } catch {
    /* Browser erlaubt keine Speicherung */
  }
}

// ---------------------------------------------------------------- Glocke

export function bellButton() {
  const count = lastForAccess()?.count || 0
  return `<button class="btn bell" data-action="open-todo" title="Zu erledigen: offene Punkte deiner Bereiche">${ICON.bell}<span class="bell-label">Zu erledigen</span><span id="todo-count" class="flag error" ${count ? '' : 'hidden'}>${count || ''}</span></button>`
}

let timer = null
/** Zähler nach dem Zeichnen im Hintergrund aktualisieren (die Ansicht bleibt schnell). */
export function refreshBell() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!document.getElementById('todo-count') || !app.data) return
    const ready = todoReady()
    if (ready) setBell(ready.count)
    else todoSoon()
  }, 40)
}

/** Beim Start: neue Punkte? Dann aufpoppen. */
export async function showTodoIfNew() {
  // Nur wer in einem der Bereiche etwas tun darf, bekommt das Popup
  if (app.ui.modal || !(canEdit('planung') || SOURCES.some((s) => canEdit(s.module)))) return
  try {
    const { from, to } = todoWindow()
    if (mayDo('planung')) await ensureRange(from, to)
  } catch {
    return
  }
  const t = todo()
  const seen = new Set(readSeen())
  if (!t.ids.some((id) => !seen.has(id))) return
  markSeen(t.ids)
  openModal({ type: 'todo', auto: true })
}

// ---------------------------------------------------------------- Dialog

function todoModal(c, { auto }) {
  const t = todo()
  const sections = []
  if (t.absences.length) {
    sections.push(`<section><h3>Abwesenheiten: Stunden neu planen</h3>${t.absences
      .map(({ absence: a, count, minutes, stillAssigned, retro, unplanned }) => `<div class="todo-item">
        <span class="cal-key ${ABSENCE_CLASS[a.type] || 'abs-sonst'}">${esc(a.type[0])}</span>
        <div class="todo-text"><strong>${esc(empName(a.employeeId))}</strong> · <span class="abs-why">${esc(a.type)}</span> ${formatDate(a.from)}${a.to !== a.from ? `–${formatDate(a.to)}` : ''}
          <br><span class="muted">${count} ${count === 1 ? 'Einsatz' : 'Einsätze'}, ${formatHours(minutes)} h neu zu planen${stillAssigned ? `, davon ${stillAssigned} noch eingeteilt` : ''}</span>
          ${retro ? '<span class="pill warning">rückwirkend</span>' : ''}${unplanned ? ' <span class="pill info">Woche noch nicht eingeteilt</span>' : ''}</div>
        <button class="btn small primary" data-action="open-impact" data-id="${esc(a.id)}">Vertretung planen</button></div>`)
      .join('')}</section>`)
  }
  if (t.periodic.length) {
    const rows = t.periodic
      .map((d) => {
        const obj = c.ctx.objectsById.get(d.inst.objectId) || { name: 'Objekt', color: 10 }
        return `<tr><td class="num">${formatDate(d.inst.date)}<br><span class="muted">${d.inst.startTime}–${d.inst.endTime}</span></td>
          <td><span class="swatch" style="--obj:var(--o${obj.color})"></span>${esc(obj.name)}<br><span class="muted">${esc(d.inst.label)}</span></td>
          <td><span class="tag rhythm">${esc(d.rhythm)}</span></td>
          <td class="num">${d.overdue ? `<span class="pill error">überfällig</span><br><span class="muted">${formatDate(d.deadline)}</span>` : formatDate(d.deadline)}</td>
          <td>${esc(d.reason)}${d.missing > 1 ? ` (${d.missing} Personen)` : ''}</td>
          <td><button class="btn small primary" data-action="goto-shift" data-key="${esc(d.inst.key)}" data-date="${esc(d.inst.origDate)}">Einteilen</button></td></tr>`
      })
      .join('')
    sections.push(`<section><h3>Periodische Leistungen zuteilen</h3><p class="note">14-tägige, monatliche und quartalsweise Leistungen ohne Besetzung, spätestens ${t.lead} Tage vor dem Termin.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Termin</th><th>Objekt</th><th>Rhythmus</th><th>Zuteilen bis</th><th>Grund</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`)
  }
  if (t.weeks.length) {
    sections.push(`<section><h3>Veröffentlichte Wochen geändert</h3>${t.weeks
      .map((w) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>KW ${isoWeek(w.monday).week}</strong>${w.started ? ' (rückwirkend)' : ''}: ${w.changed.length} ${w.changed.length === 1 ? 'Person' : 'Personen'} geändert<br><span class="muted">${esc(w.changed.map((e) => e.name).join(', '))}</span></div>
        <button class="btn small primary" data-action="goto-publish" data-monday="${w.monday}">${w.started ? 'Korrektur buchen' : 'Ansehen'}</button></div>`)
      .join('')}</section>`)
  }
  for (const { source, items } of t.extra) sections.push(`<section><h3>${esc(source.title)}</h3>${source.render(items, c)}</section>`)
  // je Abschnitt „Per E-Mail weitergeben“ (mailer.js)
  const mailBtn = (i) => ` <button class="btn small ghost todo-mail" data-action="mail-todo" data-sec="${i}" title="Diesen Abschnitt per E-Mail weitergeben">${ICON.send}<span>E-Mail</span></button>`
  const body = sections.map((s, i) => s.replace('</h3>', `${mailBtn(i)}</h3>`))
  return modalFrame({
    title: 'Zu erledigen',
    subtitle: `${auto ? 'Neu oder geändert seit deinem letzten Besuch · ' : ''}Stand ${formatDate(t.today, { year: true })}`,
    wide: true,
    body: body.join('') || '<p class="empty">Alles erledigt: keine offenen Zuteilungen, keine Korrekturen.</p>',
    foot: `${mayDo('planung') ? '<button class="btn" data-action="view" data-view="due">Alle periodischen Leistungen</button>' : '<span></span>'}<div class="actions">${sections.length ? `<button class="btn" data-action="mail-todo">${ICON.send} Per E-Mail weitergeben</button>` : ''}<button class="btn primary" data-action="close-modal">Schließen</button></div>`,
  })
}

registerModal('todo', todoModal)

registerActions({
  'open-todo': async () => {
    const { from, to } = todoWindow()
    if (mayDo('planung')) await ensureRange(from, to).catch(() => {})
    markSeen(todo().ids)
    openModal({ type: 'todo' })
  },
  'goto-shift': async (el) => {
    app.ui.monday = mondayOf(el.dataset.date)
    app.ui.month = null
    app.ui.modal = null
    await render()
    openModal({ type: 'shift', key: el.dataset.key })
  },
  'goto-publish': async (el) => {
    app.ui.monday = el.dataset.monday
    app.ui.month = null
    app.ui.modal = null
    await render()
    openModal({ type: 'publish' })
  },
})
