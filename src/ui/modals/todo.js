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
import { app, canEdit, computeRange, dataStamp, empName, ensureRange, openModal, plannedWeeks, registerActions, registerModal, render } from '../context.js'
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

const mayDo = (module) => canEdit(module)

/** Punkte der weiteren Module (registerTodo). */
function sourceItems(today) {
  const extra = SOURCES.filter((src) => mayDo(src.module))
    .map((source) => ({ source, items: source.compute(today) }))
    .filter((x) => x.items.length)
  return { extra, extraIds: extra.flatMap((x) => x.items.map((i) => `${x.source.id}:${i.id}`)) }
}

export function computeTodo(today = todayISO()) {
  const { extra, extraIds } = sourceItems(today)
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
let cache = { key: null, todo: null }
/** Neu berechnen beim nächsten Mal (z. B. wenn eine Quelle Daten vom Webspace bekommen hat). */
export const invalidateTodo = () => (cache.key = null)
export function todo() {
  const key = `${dataStamp()}|${todayISO()}|${Object.keys(app.data.assignments).length}|${(app.data.absences || []).length}|${Object.keys(app.data.published || {}).length}|${app.access?.roles.join() || ''}`
  if (cache.key !== key) cache = { key, todo: computeTodo() }
  return cache.todo
}

/** Modul nachgeladen: im gemerkten Ergebnis die Punkte der Module neu, die (teure) Planung bleibt. */
function refreshSources() {
  const t = cache.todo
  if (!t) return
  const planIds = t.ids.slice(0, t.ids.length - t.extra.reduce((n, x) => n + x.items.length, 0))
  const { extra, extraIds } = sourceItems(t.today)
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
  const count = cache.todo?.count || 0
  return `<button class="btn bell" data-action="open-todo" title="Zu erledigen: offene Punkte deiner Bereiche">${ICON.bell}<span class="bell-label">Zu erledigen</span><span id="todo-count" class="flag error" ${count ? '' : 'hidden'}>${count || ''}</span></button>`
}

let timer = null
/** Zähler nach dem Zeichnen im Hintergrund aktualisieren (die Ansicht bleibt schnell). */
export function refreshBell() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const el = document.getElementById('todo-count')
    if (!el || !app.data) return
    const { count } = todo()
    el.textContent = count || ''
    el.hidden = !count
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
