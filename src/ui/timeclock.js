// Zeiterfassung im Objekt (QR-Code) in der App: Stempelungen vom Webspace holen (alle 2 Minuten,
// solange jemand mit Einsatzplanung die App offen hat), Ansicht „Ist-Zeiten“ (Plan gegen Ist, CSV),
// Block im Einsatz-Dialog, „Zu erledigen: nicht eingestempelt“ und die QR-Aushänge als PDF.

import { formatDate, formatHours, isoWeek, mondayOf, todayISO } from '../core/dates.js'
import { toCSV } from '../core/reports.js'
import { hashIndex } from '../core/staffplan.js'
import { absMinutes, mergeStamps, missingCheckins, STATUS_TEXT, stampRows, stampUsers } from '../core/timeclock.js'
import { qrPosterDocument } from '../export/qr-pdf.js'
import { app, canEdit, compute, empName, ensureRange, persist, registerActions, registerView, renderModal, renderNow, toast } from './context.js'
import { invalidateTodo, refreshBell, registerTodo } from './modals/todo.js'
import { loadLogo, pdfBlob } from './pdf.js'
import { download, esc, ICON } from './shared.js'
import { call, portalSettings } from './staffplan.js'

const stampsOf = () => (app.data.stamps ||= {})
const on = () => {
  const p = portalSettings()
  return !!(p.enabled && p.timeclock)
}
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }) : '')
const nowMinutes = () => absMinutes(new Date().toISOString())
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const hm = (min) => (min === null || min === undefined ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`)
const STATUS_CLASS = { ok: 'ok', spaet: 'warning', frueh: 'warning', offen: 'info', fehlt: 'error', kommt: 'info', ohnePlan: 'info' }

// ---------------------------------------------------------------- Abruf vom Webspace

const sync = { at: 0, running: false, since: 0, error: '', timer: null }

/**
 * Neue und geänderte Stempelungen holen und je Woche speichern. Höchstens alle 2 Minuten; nach dem
 * ersten Abruf nur, was sich seither geändert hat. force („Jetzt abrufen“): sofort, die letzten 14 Tage.
 */
export async function syncStamps({ force = false } = {}) {
  const p = portalSettings()
  if (!on() || !p.key || !canEdit('planung') || app.readOnly || (!force && (sync.running || Date.now() - sync.at < 120e3))) return 0
  while (sync.running) await new Promise((r) => setTimeout(r, 100))
  sync.running = true
  sync.at = Date.now()
  let n = 0
  try {
    const since = !force && sync.since ? sync.since : Math.floor(Date.now() / 1000) - 14 * 86400
    const [json, index] = await Promise.all([call(`zeiten&seit=${since}`), hashIndex(p)])
    const dates = (json.zeiten || []).map((r) => r.datum).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort()
    if (dates.length) await ensureRange(dates[0], dates.at(-1))
    n = mergeStamps(stampsOf(), json.zeiten, index)
    sync.since = Math.max(since, Number(json.jetzt || 0) - 300)
    sync.error = ''
    if (n) {
      persist()
      invalidateTodo()
      refreshBell()
      if (app.ui.view === 'zeiten') renderNow()
      else if (app.ui.modal?.type === 'shift' || app.ui.modal?.type === 'todo') renderModal()
    }
  } catch (err) {
    sync.error = err.message || String(err)
  }
  sync.running = false
  return n
}

function startPolling() {
  if (sync.timer || typeof window === 'undefined') return
  sync.timer = setInterval(() => syncStamps(), 120e3)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncStamps())
}

// ---------------------------------------------------------------- Einsatz-Dialog

/** Ist-Zeiten im Einsatz-Dialog (nur mit Zeiterfassung). */
export function stampBlock(inst, c) {
  if (!on() || inst.status === 'cancelled') return ''
  const rows = stampRows({ instances: [inst], state: c.state, stamps: stampsOf(), from: inst.date, to: inst.date, users: new Set(c.state.assigned(inst.key).map((a) => a.employeeId)), now: nowMinutes() }).filter((r) => r.inst)
  if (!rows.length) return ''
  return `<section><h3>Zeiterfassung</h3><ul class="tc-list">${rows.map((r) => `<li><strong>${esc(empName(r.empId))}</strong>: ${r.stamp ? `${esc(time(r.stamp.in))}${r.stamp.out ? `–${esc(time(r.stamp.out))} (${hm(r.minutes)} h)` : ' eingestempelt'}` : ''} <span class="pill ${STATUS_CLASS[r.status]}">${esc(statusText(r))}</span></li>`).join('')}</ul></section>`
}

function statusText(r) {
  if (r.status === 'spaet') return `${r.late} min später${r.early > 10 ? `, ${r.early} min früher weg` : ''}`
  if (r.status === 'frueh') return `${r.early} min früher gegangen`
  return STATUS_TEXT[r.status]
}

// ---------------------------------------------------------------- Ansicht „Ist-Zeiten“

/** Zeilen der Woche; was noch nicht begonnen hat, nur für heute. */
function rowsOf(c) {
  const today = todayISO()
  return stampRows({ instances: c.instances, state: c.state, stamps: stampsOf(), from: c.monday, to: c.sunday, users: stampUsers(stampsOf()), now: nowMinutes() }).filter((r) => r.status !== 'kommt' || r.date === today)
}

function timesView(c) {
  syncStamps()
  const rows = rowsOf(c)
  const count = (s) => rows.filter((r) => r.status === s).length
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const body = rows
    .map((r) => {
      const name = r.empId ? empName(r.empId) : r.stamp?.name || '?'
      const plan = r.inst ? `${r.inst.startTime}–${r.inst.endTime}` : '–'
      const obj = r.inst ? objName(r.inst.objectId) : r.stamp.objectName
      const open = r.inst ? ` data-action="open-shift" data-key="${esc(r.inst.key)}"` : ''
      return `<tr${open ? ' class="clickable"' : ''}${open}><td>${esc(formatDate(r.date))}</td><td class="num">${esc(plan)}</td><td>${esc(obj)}</td><td>${esc(name)}</td><td class="num">${esc(time(r.stamp?.in))}</td><td class="num">${esc(time(r.stamp?.out))}</td><td class="num">${hm(r.minutes)}</td><td><span class="pill ${STATUS_CLASS[r.status]}">${esc(statusText(r))}</span></td></tr>`
    })
    .join('')
  const err = sync.error ? `<div class="banner warn-banner"><p>Zeiten konnten nicht geholt werden: ${esc(sync.error)}</p></div>` : ''
  const current = mondayOf(todayISO())
  const future = c.monday > current ? `<div class="banner"><p>Diese Woche liegt noch vor uns. <button class="btn small" data-action="nav-today">Zur aktuellen Woche</button></p></div>` : ''
  return `<div class="section-head"><div><h2>Ist-Zeiten KW ${isoWeek(c.monday).week}</h2><p>Kommen und Gehen laut QR-Code im Objekt neben dem Plan. Die Stunden im Wochenzettel bleiben die geplanten; Abweichungen hier prüfen und bei Bedarf den Einsatz ändern.</p></div>
      <div class="actions"><button class="btn" data-action="tc-sync">${ICON.refresh} Jetzt abrufen</button><button class="btn" data-action="tc-csv">${ICON.download} CSV</button></div></div>
    ${err}${future}
    <div class="impact-stats tc-stats">${tile('Passt', count('ok'))}${tile('Später / früher', count('spaet') + count('frueh'), count('spaet') + count('frueh') ? 'warn' : '')}${tile('Nicht eingestempelt', count('fehlt'), count('fehlt') ? 'err' : '')}${tile('Noch offen', count('offen'))}${tile('Ohne Plan', count('ohnePlan'))}</div>
    ${rows.length ? `<div class="table-wrap"><table class="data tc-table"><thead><tr><th>Tag</th><th class="num">Plan</th><th>Objekt</th><th>Person</th><th class="num">Kommen</th><th class="num">Gehen</th><th class="num">Ist (h)</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Noch keine Stempelungen in dieser Woche. QR-Aushänge unter <em>Mitarbeitende → Plan am Handy</em> erstellen und im Objekt aufhängen.</p>'}
    <p class="note">„Nicht eingestempelt“ gilt nur für Personen, die die Zeiterfassung schon benutzen. Toleranz 10 Minuten.</p>`
}

const CSV_COLUMNS = [
  ['Datum', (r) => r.date],
  ['Person', (r) => (r.empId ? empName(r.empId) : r.stamp?.name || '')],
  ['Objekt', (r) => (r.inst ? objName(r.inst.objectId) : r.stamp?.objectName || '')],
  ['Plan von', (r) => r.inst?.startTime || ''],
  ['Plan bis', (r) => r.inst?.endTime || ''],
  ['Kommen', (r) => time(r.stamp?.in)],
  ['Gehen', (r) => time(r.stamp?.out)],
  ['Ist (h)', (r) => (r.minutes === null ? '' : formatHours(r.minutes))],
  ['Später (min)', (r) => r.late || ''],
  ['Früher weg (min)', (r) => r.early || ''],
  ['Status', (r) => STATUS_TEXT[r.status]],
]

registerView({
  id: 'zeiten',
  order: 46,
  label: 'Ist-Zeiten',
  group: 'plan',
  module: 'planung',
  available: on,
  text: 'Zeiterfassung im Objekt',
  badge: () => (on() ? missing().length : 0),
  render: timesView,
})

// ---------------------------------------------------------------- Zu erledigen

function missing(today = todayISO()) {
  const c = compute(mondayOf(today))
  return missingCheckins({ instances: c.instances, state: c.state, stamps: stampsOf(), users: stampUsers(stampsOf()), now: nowMinutes(), grace: Number(portalSettings().alarmMin) || 20 })
}

registerTodo({
  id: 'zeiterfassung',
  module: 'planung',
  title: 'Nicht eingestempelt',
  compute: (today) => {
    if (!on()) return []
    startPolling()
    syncStamps()
    return missing(today).map((r) => ({ ...r, id: `${r.inst.key}:${r.empId}` }))
  },
  render: (items) =>
    items
      .map((r) => `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(empName(r.empId))}</strong>: nicht eingestempelt<br><span class="muted">${esc(formatDate(r.date))} ${esc(r.inst.startTime)}–${esc(r.inst.endTime)} ${esc(objName(r.inst.objectId))} · Beginn vor ${Math.max(0, nowMinutes() - r.inst.start)} min</span></div><button class="btn small primary" data-action="open-shift" data-key="${esc(r.inst.key)}">Einsatz öffnen</button></div>`)
      .join(''),
})

// ---------------------------------------------------------------- QR-Aushänge

export async function downloadQrPosters(p) {
  const objects = app.data.objects.filter((o) => p.objectTokens?.[o.id]).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const doc = qrPosterDocument({ objects, tokenOf: (id) => p.objectTokens[id], address: new URL('.', location.href).href, brand: app.config.brand, logo: await loadLogo().catch(() => null) })
  download('QR-Aushaenge_Zeiterfassung.pdf', await pdfBlob(doc))
}

registerActions({
  'tc-sync': async () => {
    const n = await syncStamps({ force: true })
    toast(sync.error ? `Nicht abgerufen: ${sync.error}` : n ? `${n} ${n === 1 ? 'Stempelung' : 'Stempelungen'} übernommen.` : 'Keine neuen Stempelungen.')
    renderNow()
  },
  'tc-csv': () => {
    const c = app.cur
    download(`Ist-Zeiten_${c.monday}.csv`, new Blob([`﻿${toCSV(rowsOf(c), CSV_COLUMNS)}`], { type: 'text/csv;charset=utf-8' }))
  },
})

