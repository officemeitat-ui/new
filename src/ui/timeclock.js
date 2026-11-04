// Zeiterfassung im Objekt (QR-Code) in der App: Stempelungen vom Webspace holen (alle 2 Minuten,
// solange jemand mit Einsatzplanung die App offen hat), Ansicht „Zeiterfassung“ (Plan gegen Ist, CSV),
// Block im Einsatz-Dialog, „Zu erledigen: nicht eingestempelt“ und die QR-Aushänge als PDF.

import { addDays, firstOfMonth, formatDate, formatHours, isoWeek, lastOfMonth, mondayOf, todayISO } from '../core/dates.js'
import { toCSV } from '../core/reports.js'
import { hashIndex } from '../core/staffplan.js'
import { absMinutes, mergeStamps, missingCheckins, STATUS_TEXT, stampKey, stampRows, stampUsers } from '../core/timeclock.js'
import { approveAll, breakWarnings, correctStamp, manualStamp, monthSummary, netMinutes, REASONS, reasonLabel } from '../core/worktime.js'
import { worktimeDocument } from '../export/worktime-pdf.js'
import { qrPosterDocument } from '../export/qr-pdf.js'
import { addLog, app, canEdit, closeModal, compute, computeRange, confirmStep, empName, ensureRange, mayEdit, openModal, persist, recordUndo, registerActions, registerModal, registerView, render, renderModal, renderNow, toast } from './context.js'
import { loadScript } from './load-script.js'
import { invalidateTodo, refreshBell, registerTodo } from './modals/todo.js'
import { loadLogo, pdfBlob } from './pdf.js'
import { download, esc, ICON, menu, modalFrame, options } from './shared.js'
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
const STATUS_CLASS = { ok: 'ok', spaet: 'warning', frueh: 'warning', laenger: 'warning', offen: 'info', fehlt: 'error', kommt: 'info', ohnePlan: 'info' }

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
  const ed = mayEdit('planung')
  return `<section><h3>Zeiterfassung</h3><ul class="tc-list">${rows.map((r) => `<li><strong>${esc(empName(r.empId))}</strong>: ${r.stamp ? `${esc(time(r.stamp.in))}${r.stamp.out ? `–${esc(time(r.stamp.out))} (${hm(r.minutes)} h)` : ' eingestempelt'}` : ''} <span class="pill ${STATUS_CLASS[r.status]}">${esc(statusText(r))}</span>${ed && adoptable(r, c) ? ` <button class="btn small" data-action="tc-adopt" data-key="${esc(r.inst.key)}" data-emp="${esc(r.empId)}">Ist übernehmen</button>` : ''}</li>`).join('')}</ul></section>`
}

// ---------------------------------------------------------------- Ist-Zeit übernehmen

/** Übernehmbar: gekommen und gegangen, Abweichung über der Toleranz, nur eine Person im Einsatz (die Zeit gilt für den ganzen Einsatz). */
const adoptable = (r, c) => !!(r.inst && r.stamp?.out && ['spaet', 'frueh', 'laenger'].includes(r.status) && c.state.count(r.inst.key) === 1)

/** Ist-Zeiten als Einzeländerung des Einsatzes übernehmen (Beginn und Ende für diesen Tag). */
function adopt(rows) {
  if (!rows.length) return toast('Nichts zu übernehmen.')
  recordUndo(rows.length === 1 ? 'Ist-Zeit übernommen' : `${rows.length} Ist-Zeiten übernommen`)
  const weeks = new Set()
  for (const r of rows) {
    const key = r.inst.key
    const ov = { ...(app.data.overrides[key] || {}), start: time(r.stamp.in), end: time(r.stamp.out) }
    if (!String(ov.note || '').includes('Ist-Zeit')) ov.note = [ov.note, 'Ist-Zeit laut Zeiterfassung'].filter(Boolean).join(' · ')
    app.data.overrides[key] = ov
    weeks.add(mondayOf(r.inst.origDate || r.date))
    addLog(mondayOf(r.inst.origDate || r.date), `Ist-Zeit übernommen: ${empName(r.empId)}, ${formatDate(r.date)} ${objName(r.inst.objectId)} ${r.inst.startTime}–${r.inst.endTime} → ${ov.start}–${ov.end}`)
  }
  persist()
  renderNow()
  const published = [...weeks].some((m) => app.data.published?.[m])
  toast(`${rows.length === 1 ? 'Ist-Zeit übernommen' : `${rows.length} Ist-Zeiten übernommen`}.${published ? ' Die Woche ist veröffentlicht: unter „Zu erledigen“ die Korrektur buchen (Zeitkonto, Plan am Handy).' : ''}`)
}

function statusText(r) {
  if (r.status === 'spaet') return `${r.late} min später${r.early > 10 ? `, ${r.early} min früher weg` : ''}`
  if (r.status === 'frueh') return `${r.early} min früher gegangen`
  if (r.status === 'laenger') return `${r.over} min länger`
  return STATUS_TEXT[r.status]
}

// ---------------------------------------------------------------- Ansicht „Zeiterfassung“

/** Zeilen der Woche; was noch nicht begonnen hat, nur für heute. */
function rowsOf(c) {
  const today = todayISO()
  return stampRows({ instances: c.instances, state: c.state, stamps: stampsOf(), from: c.monday, to: c.sunday, users: stampUsers(stampsOf()), now: nowMinutes() }).filter((r) => r.status !== 'kommt' || r.date === today)
}

const TONE = { ok: 'ok', spaet: 'warning', frueh: 'warning', laenger: 'warning', offen: 'info', fehlt: 'error', kommt: 'info', ohnePlan: 'info' }

/** Hinweise je Zeile: nachgetragen, korrigiert, freigegeben, Pause. */
function marks(st) {
  if (!st) return ''
  const out = []
  if (st.source === 'manuell') out.push(`<span class="pill info" title="${esc(`${reasonLabel(st.reason)}${st.by ? ` · ${st.by}` : ''}`)}">nachgetragen</span>`)
  if (st.changes?.length) out.push(`<span class="pill warning" title="${esc(st.changes.map((x) => `${reasonLabel(x.reason)}: vorher ${time(x.before.in)}–${time(x.before.out) || '…'}${x.by ? ` (${x.by})` : ''}`).join('\n'))}">korrigiert</span>`)
  if (st.pause) out.push(`<span class="muted small">Pause ${st.pause} min</span>`)
  if (st.approved) out.push(`<span class="tc-ok" title="Freigegeben${st.approved.by ? ` von ${esc(st.approved.by)}` : ''}">${ICON.check}</span>`)
  return out.join(' ')
}

function rowActions(r, ed) {
  if (!ed) return ''
  const btn = []
  if (r.stamp) btn.push(`<button class="btn small" data-action="tc-edit-open" data-stamp="${esc(stampKey(r.stamp))}">Bearbeiten</button>`)
  if (!r.stamp && r.inst && r.status === 'fehlt') {
    btn.push(`<button class="btn small" data-action="tc-edit-open" data-key="${esc(r.inst.key)}" data-emp="${esc(r.empId)}">Nachtragen</button>`)
    btn.push(`<button class="btn small ghost" data-action="open-absence-new" data-emp="${esc(r.empId)}" data-date="${esc(r.date)}" title="Krankenstand oder Urlaub eintragen">Abwesend</button>`)
  }
  return btn.join(' ')
}

function weekTable(c, rows, ed) {
  const body = rows
    .map((r) => {
      const name = r.empId ? empName(r.empId) : r.stamp?.name || '?'
      const plan = r.inst ? `${r.inst.startTime}–${r.inst.endTime}` : '–'
      const obj = r.inst ? objName(r.inst.objectId) : r.stamp?.objectName || objName(r.stamp?.objectId)
      const net = netMinutes(r.stamp)
      return `<tr><td>${esc(formatDate(r.date))}</td><td class="num">${r.inst ? `<button class="link-btn" data-action="open-shift" data-key="${esc(r.inst.key)}">${esc(plan)}</button>` : esc(plan)}</td><td>${esc(obj)}</td><td>${esc(name)}</td><td class="num">${esc(time(r.stamp?.in))}</td><td class="num">${esc(time(r.stamp?.out))}</td><td class="num">${net === null ? '' : hm(net)}</td><td><span class="pill ${TONE[r.status]}">${esc(statusText(r))}</span> ${marks(r.stamp)}${ed && adoptable(r, c) ? ` <button class="btn small" data-action="tc-adopt" data-key="${esc(r.inst.key)}" data-emp="${esc(r.empId)}" title="Beginn und Ende des Einsatzes an diesem Tag auf die erfassten Zeiten setzen">Ist übernehmen</button>` : ''}</td><td class="tc-actions">${rowActions(r, ed)}</td></tr>`
    })
    .join('')
  return rows.length
    ? `<div class="table-wrap"><table class="data tc-table"><thead><tr><th>Tag</th><th class="num">Plan</th><th>Objekt</th><th>Person</th><th class="num">Kommen</th><th class="num">Gehen</th><th class="num">Ist (h)</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="empty">Noch keine Zeiten in dieser Woche.${on() ? ' QR-Aushänge unter <em>Mitarbeitende → Plan am Handy</em> erstellen und im Objekt aufhängen.' : ''}${ed ? ' Mit „Zeit nachtragen“ lassen sich Zeiten auch von Hand erfassen.' : ''}</p>`
}

/** Zeilen eines Monats (alle Wochen geladen über range()). */
function monthRows(month) {
  const from = `${month}-01`
  const to = lastOfMonth(from)
  const r = computeRange(from, to)
  return stampRows({ instances: r.instances, state: r.state, stamps: stampsOf(), from, to, users: stampUsers(stampsOf()), now: nowMinutes() }).filter((x) => x.status !== 'kommt')
}

const monthOf = (c) => app.ui.tcMonth || addDays(c.monday, 3).slice(0, 7)
const monthLabel = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('de-AT', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function monthTable(c) {
  const month = monthOf(c)
  const rows = monthRows(month)
  const list = monthSummary(rows).sort((a, b) => empName(a.empId).localeCompare(empName(b.empId), 'de'))
  const sign = (m) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${hm(Math.abs(m))}`
  const prev = addDays(`${month}-01`, -1).slice(0, 7)
  const next = addDays(lastOfMonth(`${month}-01`), 1).slice(0, 7)
  const body = list
    .map((p) => `<tr><td><button class="link-btn" data-action="open-person" data-emp="${esc(p.empId)}">${esc(empName(p.empId))}</button></td><td class="num">${hm(p.soll)}</td><td class="num">${hm(p.ist)}</td><td class="num ${p.diff < -15 ? 'err-text' : ''}">${sign(p.diff)}</td><td class="num">${p.tage}</td><td class="num">${p.spaet + p.frueh || ''}</td><td class="num ${p.fehlt ? 'err-text' : ''}">${p.fehlt || ''}</td><td class="num">${p.manuell || ''}</td><td class="num">${p.offen ? `<span class="pill warning">${p.offen}</span>` : `<span class="tc-ok">${ICON.check}</span>`}</td><td><button class="btn small" data-action="tc-pdf" data-emp="${esc(p.empId)}" data-month="${month}">${ICON.download} PDF</button></td></tr>`)
    .join('')
  const sum = (k) => list.reduce((n, p) => n + p[k], 0)
  return `<div class="tc-monthnav"><button class="btn icon ghost" data-action="tc-month" data-month="${prev}" aria-label="Voriger Monat">${ICON.left}</button><strong>${esc(monthLabel(month))}</strong><button class="btn icon ghost" data-action="tc-month" data-month="${next}" aria-label="Nächster Monat">${ICON.right}</button>
      <span class="spacer"></span>${list.length ? `<button class="btn" data-action="tc-pdf-all" data-month="${month}">${ICON.download} Alle als PDF (ZIP)</button><button class="btn" data-action="tc-month-csv" data-month="${month}">${ICON.download} CSV</button><button class="btn" data-action="mail-export" data-of="tc-pdf-all" data-month="${month}" title="Als Anhang per E-Mail senden">${ICON.send} PDFs per E-Mail</button>` : ''}</div>
    ${list.length ? `<div class="table-wrap"><table class="data tc-month"><thead><tr><th>Person</th><th class="num">Soll (Plan)</th><th class="num">Ist</th><th class="num">Differenz</th><th class="num">Tage</th><th class="num">Abweichung</th><th class="num">fehlt</th><th class="num">nachgetragen</th><th class="num">offen</th><th></th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Summe</th><th class="num">${hm(sum('soll'))}</th><th class="num">${hm(sum('ist'))}</th><th class="num">${sign(sum('ist') - sum('soll'))}</th><th colspan="6"></th></tr></tfoot></table></div>` : '<p class="empty">Keine Zeiten in diesem Monat.</p>'}
    <p class="note">Soll zählt die Einsätze laut Plan von allen, die die Zeiterfassung benutzen; Ist die erfassten Zeiten ohne Pausen. „offen“: noch nicht freigegeben. Das PDF ist die Arbeitszeitaufzeichnung der Person für den Monat (§ 26 AZG), mit Nachträgen und Korrekturen samt Grund.</p>`
}

function timesView(c) {
  if (on()) syncStamps()
  const tab = app.ui.tcTab === 'monat' ? 'monat' : 'woche'
  const ed = mayEdit('planung')
  const rows = rowsOf(c)
  const count = (st) => rows.filter((r) => r.status === st).length
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const toAdopt = rows.filter((r) => adoptable(r, c))
  const toApprove = rows.filter((r) => r.stamp?.out && !r.stamp.approved)
  const breaks = breakWarnings(Object.values(stampsOf()).filter((s) => s.date >= c.monday && s.date <= c.sunday))
  const err = sync.error ? `<div class="banner warn-banner"><p>Zeiten konnten nicht geholt werden: ${esc(sync.error)}</p></div>` : ''
  const off = !on() ? `<div class="banner"><p><strong>Zeiterfassung per QR-Code ist aus.</strong> Einschalten unter <em>Mitarbeitende → Plan am Handy</em> (Zeiterfassung im Objekt), dann QR-Aushänge drucken. Zeiten nachtragen und auswerten geht auch so.</p></div>` : ''
  const current = mondayOf(todayISO())
  const future = c.monday > current ? `<div class="banner"><p>Diese Woche liegt noch vor uns. <button class="btn small" data-action="nav-today">Zur aktuellen Woche</button></p></div>` : ''
  const pause = breaks.length ? `<div class="banner warn-banner"><p><strong>Ruhepause fehlt (§ 11 AZG: mehr als 6 Stunden, mindestens 30 Minuten):</strong> ${breaks.map((b) => `${esc(empName(b.empId))} ${esc(formatDate(b.date))} (${hm(b.minutes)} h)`).join(', ')}. Pause beim Eintrag ergänzen oder Einteilung prüfen.</p></div>` : ''
  const tabs = `<div class="filters tc-tabs"><button class="filter" data-action="tc-tab" data-tab="woche" aria-pressed="${tab === 'woche'}">Woche</button><button class="filter" data-action="tc-tab" data-tab="monat" aria-pressed="${tab === 'monat'}">Monat je Person</button></div>`
  const actions = `${ed ? `<button class="btn primary" data-action="tc-edit-open">${ICON.plus} Zeit nachtragen</button>` : ''}${ed && tab === 'woche' && toApprove.length ? `<button class="btn" data-action="tc-approve" title="Alle vollständigen Zeiten der Woche als geprüft markieren">${ICON.check} Woche freigeben (${toApprove.length})</button>` : ''}${menu({
    label: 'Mehr',
    single: false,
    items: [
      ed && tab === 'woche' && toAdopt.length > 1 && { label: `Alle ${toAdopt.length} Abweichungen übernehmen`, action: 'tc-adopt-all', hint: 'Ist-Zeiten über der Toleranz in den Plan' },
      on() && { label: 'Jetzt abrufen', icon: ICON.refresh, action: 'tc-sync', hint: 'neue Stempelungen vom Webspace' },
      tab === 'woche' && { heading: 'Export' },
      tab === 'woche' && { label: 'Woche als CSV', icon: ICON.download, action: 'tc-csv', mail: true },
    ],
  })}`
  const week = `<div class="impact-stats tc-stats">${tile('Passt', count('ok'))}${tile('Später / früher / länger', count('spaet') + count('frueh') + count('laenger'), count('spaet') + count('frueh') + count('laenger') ? 'warn' : '')}${tile('Nicht eingestempelt', count('fehlt'), count('fehlt') ? 'err' : '')}${tile('Noch offen', count('offen'))}${tile('Zur Freigabe', toApprove.length, toApprove.length ? 'warn' : '')}</div>${weekTable(c, rows, ed)}
    <p class="note">„Nicht eingestempelt“ gilt nur für Personen, die die Zeiterfassung schon benutzen. Toleranz 10 Minuten. Nachträge und Korrekturen brauchen einen Grund und bleiben mit dem früheren Stand nachvollziehbar. „Ist übernehmen“ setzt Beginn und Ende des Einsatzes an diesem Tag auf die erfassten Zeiten (nur bei einer Person im Einsatz); in veröffentlichten Wochen danach die Korrektur buchen.</p>`
  return `<div class="section-head"><div><h2>Zeiterfassung ${tab === 'woche' ? `KW ${isoWeek(c.monday).week}` : ''}</h2><p>Kommen und Gehen laut QR-Code im Objekt neben dem Plan, Nachträge des Büros, Freigabe und Monatsliste je Person.</p></div>
      <div class="actions">${actions}</div></div>
    ${err}${off}${tab === 'woche' ? future + pause : ''}${tabs}
    ${tab === 'woche' ? week : monthTable(c)}`
}

const CSV_COLUMNS = [
  ['Datum', (r) => r.date],
  ['Person', (r) => (r.empId ? empName(r.empId) : r.stamp?.name || '')],
  ['Objekt', (r) => (r.inst ? objName(r.inst.objectId) : r.stamp?.objectName || '')],
  ['Plan von', (r) => r.inst?.startTime || ''],
  ['Plan bis', (r) => r.inst?.endTime || ''],
  ['Kommen', (r) => time(r.stamp?.in)],
  ['Gehen', (r) => time(r.stamp?.out)],
  ['Pause (min)', (r) => r.stamp?.pause || ''],
  ['Ist (h)', (r) => (netMinutes(r.stamp) === null ? '' : formatHours(netMinutes(r.stamp)))],
  ['Später (min)', (r) => r.late || ''],
  ['Früher weg (min)', (r) => r.early || ''],
  ['Status', (r) => STATUS_TEXT[r.status]],
  ['Nachtrag/Korrektur', (r) => [r.stamp?.source === 'manuell' ? `nachgetragen: ${reasonLabel(r.stamp.reason)}` : '', ...(r.stamp?.changes || []).map((x) => `korrigiert: ${reasonLabel(x.reason)}`)].filter(Boolean).join('; ')],
  ['Freigegeben', (r) => (r.stamp?.approved ? r.stamp.approved.by || 'ja' : '')],
]

registerView({
  id: 'zeiten',
  order: 46,
  label: 'Zeiterfassung',
  group: 'plan',
  module: 'planung',
  section: 'einsatz',
  text: 'Ist-Zeiten, Nachträge, Freigabe, Monatsliste',
  badge: () => (on() ? missing().length : 0),
  // Monat je Person: alle Wochen des Monats laden
  range: () => (app.ui.tcTab === 'monat' ? { from: firstOfMonth(`${app.ui.tcMonth || addDays(app.ui.monday, 3).slice(0, 7)}-01`), to: lastOfMonth(`${app.ui.tcMonth || addDays(app.ui.monday, 3).slice(0, 7)}-01`) } : null),
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

registerActions(
  {
    'tc-adopt': (el) => {
      const c = compute(mondayOf(el.dataset.key.slice(0, 10)))
      const row = stampRows({ instances: c.instances.filter((i) => i.key === el.dataset.key), state: c.state, stamps: stampsOf(), from: '0000-01-01', to: '9999-12-31', users: new Set([el.dataset.emp]), now: nowMinutes() }).find((r) => r.inst && r.empId === el.dataset.emp)
      if (!row || !adoptable(row, c)) return toast('Nicht übernehmbar (keine vollständige Stempelung oder mehrere Personen im Einsatz).')
      adopt([row])
    },
    'tc-adopt-all': () => adopt(rowsOf(app.cur).filter((r) => adoptable(r, app.cur))),
  },
  { edit: 'planung' },
)

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


// ---------------------------------------------------------------- Zeit nachtragen und korrigieren

/** Einsätze einer Person an einem Tag (für die Auswahl im Dialog). */
function dayInstances(empId, date) {
  if (!empId || !date) return []
  const c = compute(mondayOf(date))
  return c.state.instancesOf(empId).filter((i) => i.date === date && i.status !== 'cancelled')
}

function editModal(c, m) {
  const st = m.stampKey ? stampsOf()[m.stampKey] : null
  const d = m.draft || (m.draft = st ? { empId: st.empId, date: st.date, instKey: st.instKey || '', objectId: st.objectId || '', from: time(st.in), to: time(st.out), pause: st.pause || 0, reason: '', note: '' } : { empId: m.empId || '', date: m.date || todayISO(), instKey: m.instKey || '', objectId: '', from: m.from || '', to: m.to || '', pause: 0, reason: 'vergessen', note: '' })
  const insts = dayInstances(d.empId, d.date)
  const emps = [...app.data.employees].filter((e) => !e.inactive).sort((a, b) => a.name.localeCompare(b.name, 'de')).map((e) => [e.id, e.name])
  const instOpts = [['', '– ohne Einsatz laut Plan –'], ...insts.map((i) => [i.key, `${i.startTime}–${i.endTime} ${objName(i.objectId)}${i.label ? ` · ${i.label}` : ''}`])]
  const history = st ? [st.source === 'manuell' ? `Nachgetragen ${st.at ? new Date(st.at).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' }) : ''}${st.by ? ` von ${st.by}` : ''}: ${reasonLabel(st.reason)}` : 'Gestempelt per QR-Code', ...(st.changes || []).map((x) => `Korrigiert ${new Date(x.at).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })}${x.by ? ` von ${x.by}` : ''}: ${reasonLabel(x.reason)} (vorher ${time(x.before.in)}–${time(x.before.out) || '…'})`)] : []
  const body = `<div class="form-grid">
      <label class="field"><span>Person</span><select id="tc-emp" data-change="tc-field" ${st ? 'disabled' : ''}>${options(emps, d.empId, { empty: '– wählen –' })}</select></label>
      <label class="field"><span>Datum</span><input type="date" id="tc-date" value="${esc(d.date)}" data-change="tc-field" ${st ? 'disabled' : ''}></label>
      <label class="field wide"><span>Einsatz</span><select id="tc-inst" data-change="tc-field">${options(instOpts, d.instKey)}</select></label>
      ${!d.instKey ? `<label class="field wide"><span>Objekt</span><select id="tc-obj">${options([['', '– Objekt –'], ...app.data.objects.filter((o) => !o.inactive).map((o) => [o.id, o.name])], d.objectId)}</select></label>` : ''}
      <label class="field"><span>Kommen</span><input type="time" id="tc-from" value="${esc(d.from)}" step="60"></label>
      <label class="field"><span>Gehen</span><input type="time" id="tc-to" value="${esc(d.to)}" step="60"></label>
      <label class="field"><span>Pause (Minuten)</span><input type="number" id="tc-pause" min="0" max="240" step="5" value="${esc(d.pause)}"></label>
      <label class="field"><span>Grund ${st ? 'der Korrektur' : ''}</span><select id="tc-reason">${options(REASONS, d.reason, { empty: '– Grund wählen –' })}</select></label>
      <label class="field wide"><span>Notiz</span><input id="tc-note" value="${esc(d.note || '')}" placeholder="optional"></label>
    </div>
    ${history.length ? `<p class="note">${history.map(esc).join('<br>')}</p>` : ''}
    <p class="field-error" role="alert">${esc(m.error || '')}</p>`
  const foot = `${st?.source === 'manuell' ? `<button class="btn danger ${app.ui.confirm === `tc-del:${m.stampKey}` ? 'confirm' : ''}" data-action="tc-delete">${app.ui.confirm === `tc-del:${m.stampKey}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}<span class="spacer"></span><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="tc-save">Speichern</button>`
  return modalFrame({ title: st ? 'Zeit korrigieren' : 'Zeit nachtragen', subtitle: st ? `${esc(empName(st.empId))} · ${esc(formatDate(st.date))}` : '', body, foot })
}

registerModal('tc-edit', editModal, { module: 'planung' })

function readEdit() {
  const m = app.ui.modal
  const v = (id) => document.getElementById(id)?.value ?? ''
  Object.assign(m.draft, { empId: m.stampKey ? m.draft.empId : v('tc-emp'), date: m.stampKey ? m.draft.date : v('tc-date'), instKey: v('tc-inst'), objectId: v('tc-obj') || m.draft.objectId, from: v('tc-from'), to: v('tc-to'), pause: Number(v('tc-pause')) || 0, reason: v('tc-reason'), note: v('tc-note').trim() })
  return m.draft
}

registerActions(
  {
    'tc-edit-open': (el) => {
      if (el.dataset.stamp) return openModal({ type: 'tc-edit', stampKey: el.dataset.stamp })
      const inst = el.dataset.key ? compute(mondayOf(el.dataset.key.slice(0, 10))).instances.find((i) => i.key === el.dataset.key) : null
      openModal({ type: 'tc-edit', empId: el.dataset.emp || '', date: inst?.date || app.ui.timelineDay || todayISO(), instKey: inst?.key || '', from: inst?.startTime || '', to: inst?.endTime || '' })
    },
    'tc-field': () => {
      const d = readEdit()
      const inst = dayInstances(d.empId, d.date).find((i) => i.key === d.instKey)
      if (!inst) d.instKey = ''
      else if (!d.from && !d.to) Object.assign(d, { from: inst.startTime, to: inst.endTime })
      renderModal()
    },
    'tc-save': () => {
      const m = app.ui.modal
      const d = readEdit()
      const inst = dayInstances(d.empId, d.date).find((i) => i.key === d.instKey)
      const by = app.user?.name || 'Büro'
      try {
        if (m.stampKey) {
          const before = stampsOf()[m.stampKey]
          const next = correctStamp(before, { from: d.from, to: d.to, pause: d.pause, reason: d.reason, note: d.note, by })
          stampsOf()[m.stampKey] = { ...next, instKey: d.instKey, objectId: inst?.objectId || d.objectId || before.objectId, objectName: objName(inst?.objectId || d.objectId || before.objectId) }
          addLog(mondayOf(before.date), `Zeit korrigiert: ${empName(before.empId)}, ${formatDate(before.date)} ${time(before.in)}–${time(before.out) || '…'} → ${d.from}–${d.to || '…'} (${reasonLabel(d.reason)})`)
        } else {
          if (!d.empId) throw new Error('Bitte eine Person wählen.')
          const s = manualStamp({ date: d.date, empId: d.empId, name: empName(d.empId), objectId: inst?.objectId || d.objectId, objectName: objName(inst?.objectId || d.objectId), instKey: inst?.key || '', from: d.from, to: d.to, pause: d.pause, reason: d.reason, note: d.note, by })
          stampsOf()[stampKey(s)] = s
          addLog(mondayOf(d.date), `Zeit nachgetragen: ${empName(d.empId)}, ${formatDate(d.date)} ${d.from}–${d.to || '…'} (${reasonLabel(d.reason)})`)
        }
      } catch (err) {
        m.error = err.message
        return renderModal()
      }
      persist()
      invalidateTodo()
      closeModal()
      renderNow()
      toast(m.stampKey ? 'Zeit korrigiert.' : 'Zeit nachgetragen.')
    },
    'tc-delete': () => {
      const m = app.ui.modal
      if (!confirmStep(`tc-del:${m.stampKey}`, renderModal)) return
      const st = stampsOf()[m.stampKey]
      delete stampsOf()[m.stampKey]
      if (st) addLog(mondayOf(st.date), `Nachgetragene Zeit gelöscht: ${empName(st.empId)}, ${formatDate(st.date)} ${time(st.in)}–${time(st.out) || '…'}`)
      persist()
      closeModal()
      renderNow()
    },
    'tc-approve': () => {
      const c = app.cur
      const list = rowsOf(c).map((r) => r.stamp).filter((st) => st?.out && !st.approved)
      const n = approveAll(list, { by: app.user?.name || 'Büro' })
      if (n) addLog(c.monday, `Zeiterfassung KW ${isoWeek(c.monday).week} freigegeben (${n} Zeiten)`)
      persist()
      renderNow()
      toast(`${n} ${n === 1 ? 'Zeit' : 'Zeiten'} freigegeben.`)
    },
  },
  { edit: 'planung' },
)

// ---------------------------------------------------------------- Monat: Tabs, PDF, CSV

async function personPdf(empId, month) {
  const rows = monthRows(month).filter((r) => r.empId === empId)
  const [summary] = monthSummary(rows)
  const employee = app.data.employees.find((e) => e.id === empId) || { name: empName(empId) }
  const doc = worktimeDocument({ employee, monthLabel: monthLabel(month), rows, summary: summary || { soll: 0, ist: 0, diff: 0, tage: 0, spaet: 0, frueh: 0, fehlt: 0, manuell: 0 }, objName, brand: app.config.brand, logo: await loadLogo().catch(() => null) })
  return { blob: await pdfBlob(doc), name: `Arbeitszeit_${month}_${employee.name.replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-')}.pdf` }
}

registerActions({
  'tc-tab': (el) => {
    app.ui.tcTab = el.dataset.tab
    render()
  },
  'tc-month': (el) => {
    app.ui.tcMonth = el.dataset.month
    render()
  },
  'tc-pdf': async (el) => {
    const { blob, name } = await personPdf(el.dataset.emp, el.dataset.month)
    download(name, blob)
  },
  'tc-pdf-all': async (el) => {
    const month = el.dataset.month
    const people = monthSummary(monthRows(month)).map((p) => p.empId)
    await loadScript('vendor/jszip.min.js')
    const zip = new globalThis.JSZip()
    for (const id of people) {
      const { blob, name } = await personPdf(id, month)
      zip.file(name, blob)
    }
    download(`Arbeitszeit_${month}.zip`, await zip.generateAsync({ type: 'blob' }))
  },
  'tc-month-csv': (el) => {
    const month = el.dataset.month
    const cols = [
      ['Person', (p) => empName(p.empId)],
      ['Soll (h)', (p) => formatHours(p.soll)],
      ['Ist (h)', (p) => formatHours(p.ist)],
      ['Differenz (h)', (p) => `${p.diff < 0 ? '-' : ''}${formatHours(Math.abs(p.diff))}`],
      ['Tage', (p) => p.tage],
      ['später', (p) => p.spaet],
      ['früher', (p) => p.frueh],
      ['nicht eingestempelt', (p) => p.fehlt],
      ['nachgetragen/korrigiert', (p) => p.manuell],
      ['nicht freigegeben', (p) => p.offen],
    ]
    download(`Arbeitszeit_${month}.csv`, new Blob([`﻿${toCSV(monthSummary(monthRows(month)), cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
})
