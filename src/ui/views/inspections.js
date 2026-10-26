// Modul Objektkontrolle (nach dem Prüfprotokoll-Tool): Begehung am Handy mit
// OK/R/M/G/N-A je Prüfpunkt, Fotos, Vorbefunden, Gesamtzustand, zwei
// Unterschriften, Abschluss sperrt, PDF und Versand (nichts vorbelegt).
// Dazu: Rhythmus je Objekt, offene Mängel aller Objekte mit Zuständigkeit
// und Frist, Nacharbeit als Einsatz im Dienstplan, Checklisten als Daten.

import { addDays, formatDate, isoWeekday, todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { checklistItems, checklistToText, DEFAULT_PRIO, DEFECTS, findings, inspectionDue, itemText, openDefects, OVERALL, PRIO_DAYS, PRIOS, progress, quarterOf, RATING_KEYS, RATINGS, reworkTask, suggestOverall, summaryText, textToChapters } from '../../core/inspections.js'
import { saveEvent } from '../../auth/graph-calendar.js'
import { sendMail } from '../../auth/graph-mail.js'
import { icsEvent } from '../../core/ics.js'
import { INSPECTION_KINDS, OBJEKTKONTROLLE_CHECKLIST } from '../../data/checklist-objektkontrolle.js'
import { inspectionDocument, inspectionFileName } from '../../export/inspection-pdf.js'
import { app, canEdit, closeModal, confirmStep, dataStamp, empName, openModal, persist, recordUndo, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { photoDataUrl, photoLink, storeImageData, storePhoto } from '../photo.js'
import { download, esc, ICON, modalFrame, options, uid, val } from '../shared.js'
import { signaturePad } from '../signature.js'

const MODULE = 'kontrolle'
const K = () => {
  const k = (app.data.kontrolle ||= { checklists: [], plans: {}, inspections: [] })
  if (!k.checklists?.length) k.checklists = [OBJEKTKONTROLLE_CHECKLIST]
  k.plans ||= {}
  k.inspections ||= []
  return k
}
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const inspOf = (id) => K().inspections.find((x) => x.id === id)
const checklistOf = (id) => K().checklists.find((c) => c.id === id) || K().checklists[0]
const editable = () => canEdit(MODULE)
const canPdf = () => app.config.features.pdf && app.config.features.download
const canCalendar = () => !!(app.config.features.calendar && app.auth?.getToken)
const userName = () => app.user?.name || ''
const mappeOf = (objectId) => app.data.mappe?.objects?.[objectId] || {}
const RATING_CLASS = { OK: 'ok', R: 'info', M: 'warning', G: 'error', NA: 'na' }
const OVERALL_CLASS = { 'Sehr gut': 'ok', Gut: 'ok', Handlungsbedarf: 'warning', Kritisch: 'error' }
const ratingPill = (r) => (r ? `<span class="pill ${RATING_CLASS[r]} rating">${RATINGS[r].short}</span>` : '')
const overallPill = (o) => (o ? `<span class="pill ${OVERALL_CLASS[o] || 'info'} name">${esc(o)}</span>` : '')

/** Stammkräfte eines Objekts (für Zuständigkeit und Nacharbeit). */
const regularsAt = (objectId) => [...new Set(app.data.tasks.filter((t) => t.objectId === objectId).flatMap((t) => t.regulars || []))]

// offene Mängel und Fälligkeiten nur nach Änderungen neu berechnen
let memo = { key: null }
function state(today = todayISO()) {
  const k = K()
  const key = `${dataStamp()}|${today}|${k.inspections.length}`
  if (memo.key !== key) {
    const defects = openDefects(k.inspections)
    const objectIds = [...new Set([...Object.keys(k.plans), ...k.inspections.map((x) => x.objectId)])].filter(objOf)
    const due = objectIds.map((id) => ({ objectId: id, plan: k.plans[id] || null, ...inspectionDue(k.inspections, id, k.plans[id], today) }))
    memo = { key, defects, due }
  }
  return memo
}

// ---------------------------------------------------------------- Ansicht

function objectsTab(s, today) {
  const rows = [...s.due]
    .sort((a, b) => (a.plan ? 0 : 1) - (b.plan ? 0 : 1) || a.due.localeCompare(b.due))
    .map((d) => {
      const obj = objOf(d.objectId)
      const defects = s.defects.filter((x) => x.objectId === d.objectId)
      const counts = DEFECTS.map((r) => [r, defects.filter((x) => x.rating === r).length]).filter(([, n]) => n)
      const status = !d.plan ? '<span class="muted">ohne Rhythmus</span>' : d.status === 'ueberfaellig' ? `<span class="pill error">überfällig</span><br><span class="muted">${esc(d.reason)} seit ${formatDate(d.due, { weekday: false })}</span>` : d.status === 'faellig' ? `<span class="pill warning">fällig</span><br><span class="muted">${esc(d.reason)} bis ${formatDate(d.due, { weekday: false })}</span>` : `<span class="muted">${esc(d.reason)} am ${formatDate(d.due, { weekday: false, year: true })}</span>`
      return `<tr class="${d.plan && d.status === 'ueberfaellig' ? 'row-open' : ''}">
        <td><span class="swatch" style="--obj:var(--o${obj.color || 10})"></span><strong>${esc(obj.name)}</strong><br><span class="muted">${esc(obj.address || '')}</span></td>
        <td>${d.last ? `${formatDate(d.last.date, { weekday: false, year: true })} ${overallPill(d.last.summary?.overall)}` : '<span class="muted">noch keine</span>'}</td>
        <td>${status}</td>
        <td>${counts.length ? counts.map(([r, n]) => `${ratingPill(r)} ${n}`).join(' ') : '<span class="muted">keine</span>'}</td>
        <td>${editable() ? `<select class="small-select" data-change="ins-plan" data-obj="${esc(d.objectId)}" aria-label="Rhythmus">${options([['', 'kein Rhythmus'], ['1', 'monatlich'], ['3', 'quartalsweise'], ['6', 'halbjährlich'], ['12', 'jährlich']], d.plan ? String(d.plan.months) : '')}</select>` : d.plan ? `alle ${d.plan.months} Monate` : ''}</td>
        <td>${editable() ? (d.open ? `<button class="btn small primary" data-action="ins-open" data-id="${esc(d.open.id)}">Fortsetzen</button>` : `<button class="btn small ${d.plan && d.status !== 'ok' ? 'primary' : ''}" data-action="ins-new" data-obj="${esc(d.objectId)}" data-kind="${esc(d.reason)}">${ICON.check} Kontrolle</button>`) : ''}</td></tr>`
    })
    .join('')
  const others = app.data.objects.filter((o) => !s.due.some((d) => d.objectId === o.id))
  return `${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Objekt</th><th>Letzte Kontrolle</th><th>Nächste</th><th>Offene Mängel</th><th>Rhythmus</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch kein Objekt mit Kontrollen.</p>'}
    ${editable() && others.length ? `<div class="toolbar"><label class="field inline grow"><span>Weiteres Objekt</span><select id="ins-other">${options(others.map((o) => [o.id, o.name]), '', { empty: 'Objekt wählen' })}</select></label><button class="btn" data-action="ins-new-other">${ICON.check} Kontrolle starten</button></div>` : ''}`
}

function defectsTab(s, today) {
  if (!s.defects.length) return '<p class="empty">Keine offenen Mängel.</p>'
  const emps = app.data.employees.map((e) => [e.id, e.name])
  const rows = s.defects
    .map((d) => {
      const obj = objOf(d.objectId)
      const insp = inspOf(d.inspectionId)
      const text = itemText(checklistOf(insp?.checklistId), d.itemId)
      const late = d.due && d.due < today
      const task = d.taskId && app.data.tasks.find((t) => t.id === d.taskId)
      return `<tr class="${d.rating === 'G' || late ? 'row-open' : ''}">
        <td>${ratingPill(d.rating)}<br><span class="muted">${d.prio} ${esc(PRIOS[d.prio] || '')}</span></td>
        <td><strong>${esc(obj?.name || '')}</strong><br>${esc(d.itemId)} ${esc(text)}${d.note ? `<br><span class="muted">${esc(d.note)}</span>` : ''} ${d.photos?.length ? photoLink(d.photos[0]) : ''}</td>
        <td>${formatDate(d.since, { weekday: false, year: true })}</td>
        <td>${editable() ? `<select class="small-select" data-change="def-assign" data-insp="${esc(d.inspectionId)}" data-item="${esc(d.itemId)}" aria-label="Zuständig">${options(emps, d.assignee, { empty: 'Büro / Hausverwaltung' })}</select>` : esc(d.assignee ? empName(d.assignee) : 'Büro')}</td>
        <td>${editable() ? `<input type="date" class="small-input ${late ? 'late' : ''}" value="${esc(d.due)}" data-change="def-due" data-insp="${esc(d.inspectionId)}" data-item="${esc(d.itemId)}" aria-label="Frist">` : d.due ? formatDate(d.due, { weekday: false }) : ''}${late ? '<br><span class="pill error">Frist vorbei</span>' : ''}</td>
        <td class="def-acts">${editable() ? `<button class="btn small" data-action="def-done" data-insp="${esc(d.inspectionId)}" data-item="${esc(d.itemId)}">Erledigt</button>` : ''}
          ${task ? `<span class="pill info name">Nacharbeit ${formatDate(task.recurrence.date, { weekday: false })}</span>` : canEdit('planung') ? `<button class="btn small" data-action="def-rework" data-insp="${esc(d.inspectionId)}" data-item="${esc(d.itemId)}" title="Einsatz im Dienstplan anlegen">${ICON.calendar} Nacharbeit</button>` : ''}
          <button class="btn small" data-action="ins-open" data-id="${esc(d.inspectionId)}">Protokoll</button></td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Bew.</th><th>Mangel</th><th>seit</th><th>Zuständig</th><th>Frist</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Ein Mangel bleibt offen, bis derselbe Prüfpunkt bei einer späteren Kontrolle mit OK bewertet oder hier als erledigt markiert wird. „Nacharbeit“ legt einen Einsatz im Dienstplan an (Stammkraft vorgeschlagen).</p>`
}

function historyTab() {
  const list = [...K().inspections].sort((a, b) => b.date.localeCompare(a.date))
  if (!list.length) return '<p class="empty">Noch keine Kontrollen.</p>'
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Objekt</th><th>Art</th><th>Prüfer/in</th><th>Ergebnis</th><th>Status</th><th></th></tr></thead><tbody>${list
    .map((x) => {
      const f = findings(x, checklistOf(x.checklistId))
      return `<tr><td>${formatDate(x.date, { weekday: false, year: true })}<br><span class="muted">${quarterOf(x.date)}</span></td><td>${esc(objOf(x.objectId)?.name || '')}</td><td>${esc(x.kind || '')}</td><td>${esc(x.inspector || '')}</td>
        <td>${overallPill(x.summary?.overall || (x.status === 'abgeschlossen' ? suggestOverall(x.items) : ''))}${f.length ? `<br><span class="muted">${f.length} Feststellungen</span>` : ''}</td>
        <td>${x.status === 'abgeschlossen' ? `<span class="pill ok">abgeschlossen</span>${x.sent?.length ? '<br><span class="muted">versendet</span>' : ''}` : '<span class="pill warning">offen</span>'}</td>
        <td><button class="btn small" data-action="ins-open" data-id="${esc(x.id)}">Öffnen</button>${canPdf() && x.status === 'abgeschlossen' ? ` <button class="btn small" data-action="ins-pdf" data-id="${esc(x.id)}">${ICON.print} PDF</button>` : ''}</td></tr>`
    })
    .join('')}</tbody></table></div>`
}

function checklistsTab() {
  const k = K()
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Checkliste</th><th>Kapitel</th><th>Prüfpunkte</th><th>Verwendet</th><th></th></tr></thead><tbody>${k.checklists
    .map((c) => `<tr><td><strong>${esc(c.name)}</strong><br><span class="muted">Fassung ${c.version || 1}</span></td><td class="num">${c.chapters.length}</td><td class="num">${checklistItems(c).length}</td><td class="num">${k.inspections.filter((x) => x.checklistId === c.id).length}</td>
      <td>${editable() ? `<button class="btn small" data-action="cl-edit" data-id="${esc(c.id)}">Bearbeiten</button>` : ''}</td></tr>`)
    .join('')}</tbody></table></div>${editable() ? `<p><button class="btn" data-action="cl-edit" data-id="new">${ICON.plus} Neue Checkliste</button></p>` : ''}`
}

function inspectionsView() {
  const today = todayISO()
  const s = state(today)
  const tab = app.ui.insTab || 'objekte'
  const planned = s.due.filter((d) => d.plan)
  const dueNow = planned.filter((d) => d.status !== 'ok')
  const quarter = quarterOf(today)
  const done = K().inspections.filter((x) => x.status === 'abgeschlossen' && quarterOf(x.date) === quarter).length
  const danger = s.defects.filter((d) => d.rating === 'G').length
  const tabs = [['objekte', `Objekte (${dueNow.length} fällig)`], ['maengel', `Offene Mängel (${s.defects.length})`], ['kontrollen', 'Kontrollen'], ['checklisten', 'Checklisten']]
  const body = tab === 'maengel' ? defectsTab(s, today) : tab === 'kontrollen' ? historyTab() : tab === 'checklisten' ? checklistsTab() : objectsTab(s, today)
  return `<div class="section-head"><div><h2>${ICON.check} Objektkontrolle</h2>
      <p>Begehung am Handy: je Prüfpunkt OK, R (Reinigung), M (Mangel), G (Gefahr) oder N/A. Mängel bleiben offen, bis sie behoben sind, und erscheinen bei der nächsten Kontrolle direkt beim Prüfpunkt.</p></div>
      ${editable() ? `<div class="actions"><button class="btn" data-action="legacy-open">${ICON.upload} Aus dem Prüfprotokoll übernehmen</button></div>` : ''}</div>
    <div class="summary">
      <div class="stat ${dueNow.some((d) => d.status === 'ueberfaellig') ? 'err' : dueNow.length ? 'warn' : ''}"><div class="label">Kontrollen fällig</div><div class="value">${dueNow.length}</div></div>
      <div class="stat ${danger ? 'err' : ''}"><div class="label">Gefahr offen</div><div class="value">${danger}</div></div>
      <div class="stat ${s.defects.length ? 'warn' : ''}"><div class="label">Offene Mängel</div><div class="value">${s.defects.length}</div></div>
      <div class="stat"><div class="label">Kontrollen ${quarter}</div><div class="value">${done}</div></div>
    </div>
    <div class="toolbar"><div class="seg" role="tablist">${tabs.map(([v, label]) => `<button class="btn small ${tab === v ? 'primary' : ''}" data-action="ins-tab" data-v="${v}" role="tab" aria-selected="${tab === v}">${label}</button>`).join('')}</div></div>
    ${body}`
}

registerView({
  id: 'kontrolle',
  order: 72,
  label: 'Objektkontrolle',
  group: 'service',
  module: MODULE,
  noWeek: true,
  mobile: { icon: ICON.check, label: 'Kontrolle' },
  badge: () => state().due.filter((d) => d.plan && d.status !== 'ok').length + state().defects.filter((d) => d.rating === 'G').length,
  render: inspectionsView,
})

// ---------------------------------------------------------------- Erfassen

function itemBlock(insp, x, prev, locked) {
  const it = insp.items[x.id] || {}
  const defect = DEFECTS.includes(it.rating)
  const emps = app.data.employees.map((e) => [e.id, e.name])
  const id = x.id.replace('.', '-')
  return `<div class="insp-item rate-${RATING_CLASS[it.rating] || 'none'}" data-item="${x.id}" tabindex="-1">
    <div class="insp-text"><span class="insp-no">${x.id}</span> ${esc(x.text)}${prev ? `<div class="insp-prev">${ratingPill(prev.rating)} offen seit ${formatDate(prev.since, { weekday: false, year: true })}${prev.note ? `: ${esc(prev.note)}` : ''}</div>` : ''}</div>
    <div class="rate-row" role="group" aria-label="Bewertung ${x.id}">${RATING_KEYS.map((r, i) => `<button type="button" class="rate rate-${RATING_CLASS[r]} ${it.rating === r ? 'on' : ''}" data-action="ins-rate" data-item="${x.id}" data-r="${r}" title="${esc(RATINGS[r].text)} (Taste ${i + 1})" aria-pressed="${it.rating === r}" ${locked ? 'disabled' : ''}>${RATINGS[r].short}</button>`).join('')}</div>
    ${defect || it.note || it.photos?.length ? `<div class="insp-detail">
      <input type="text" id="note-${id}" value="${esc(it.note || '')}" placeholder="Bemerkung (was, wo genau)" data-change="ins-note" data-item="${x.id}" ${locked ? 'disabled' : ''}>
      ${defect ? `<select id="prio-${id}" data-change="ins-prio" data-item="${x.id}" aria-label="Priorität" ${locked ? 'disabled' : ''}>${options(Object.entries(PRIOS).map(([k, v]) => [k, `${k} ${v}`]), it.prio || DEFAULT_PRIO[it.rating])}</select>
      <select id="who-${id}" data-change="ins-who" data-item="${x.id}" aria-label="Zuständig" ${locked ? 'disabled' : ''}>${options(emps, it.assignee || '', { empty: 'Zuständig: Büro / HV' })}</select>
      <input type="date" id="due-${id}" value="${esc(it.due || '')}" data-change="ins-due" data-item="${x.id}" aria-label="Frist" title="Frist" ${locked ? 'disabled' : ''}>` : ''}
      <span class="photo-row">${(it.photos || []).map((p, i) => `<span class="photo-chip">${photoLink(p)}${locked ? '' : `<button type="button" class="link-btn" data-action="ins-photo-del" data-item="${x.id}" data-i="${i}" aria-label="Foto entfernen">×</button>`}</span>`).join('')}
        ${locked ? '' : `<label class="btn small file-btn">${ICON.camera}<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-change="ins-photo" data-item="${x.id}" aria-label="Foto aufnehmen"></label><label class="btn small file-btn">${ICON.upload}<input type="file" accept="image/*" class="visually-hidden" data-change="ins-photo" data-item="${x.id}" aria-label="Foto aus Galerie"></label>`}</span>
    </div>` : ''}
  </div>`
}

function inspectionModal(c, m) {
  const insp = inspOf(m.id)
  if (!insp) return ''
  const k = K()
  const cl = checklistOf(insp.checklistId)
  const obj = objOf(insp.objectId) || { name: '?' }
  const locked = insp.status === 'abgeschlossen' || !editable()
  const prog = progress(cl, insp.items)
  const prev = openDefects(k.inspections, { objectId: insp.objectId, exclude: insp.id }).filter((d) => d.since < insp.date || d.inspectionId !== insp.id)
  // beim Prüfpunkt nur Mängel derselben Checkliste zeigen (ältere ohne Checkliste wie bisher)
  const prevBy = new Map(prev.filter((d) => (d.checklistId || cl.id) === cl.id).map((d) => [d.itemId, d]))
  const prevText = (d) => itemText(d.checklistId ? checklistOf(d.checklistId) : cl, d.itemId)
  const items = checklistItems(cl)
  const suggestion = suggestOverall(insp.items)
  const overall = insp.summary?.overall || ''
  m.sig ||= { inspector: insp.signatures?.inspector?.image?.data || null, customer: insp.signatures?.customer?.image?.data || null }
  const chips = prog.chapters.map((ch, i) => `<button type="button" class="chip-ch ch-${RATING_CLASS[ch.worst] || 'none'}" data-action="ins-jump" data-ch="${i}">${i + 1} · ${ch.rated}/${ch.total}</button>`).join('')
  const chapters = cl.chapters
    .map((ch, i) => {
      const list = items.filter((x) => x.chapter === i)
      return `<section class="insp-chapter" id="ch-${i}"><div class="insp-chapter-head"><h3>${i + 1} ${esc(ch.title)}</h3>${locked ? '' : `<span class="actions"><button type="button" class="btn small" data-action="ins-rest" data-ch="${i}" data-r="OK">Rest OK</button><button type="button" class="btn small" data-action="ins-rest" data-ch="${i}" data-r="NA">Rest N/A</button></span>`}</div>
        ${list.map((x) => itemBlock(insp, x, prevBy.get(x.id), locked)).join('')}</section>`
    })
    .join('')
  const f = findings(insp, cl)
  return modalFrame({
    title: `Kontrolle ${esc(obj.name)}`,
    subtitle: `${formatDate(insp.date, { year: true })} · ${quarterOf(insp.date)} · ${esc(insp.kind || '')} · ${prog.rated}/${prog.total} bewertet${insp.status === 'abgeschlossen' ? ' · abgeschlossen' : ''}`,
    color: obj.color,
    wide: true,
    body: `${insp.status === 'abgeschlossen' ? `<div class="banner"><p>${ICON.lock} Abgeschlossen am ${new Date(insp.closedAt).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}${insp.sent?.length ? ` · versendet an ${esc(insp.sent.at(-1).to.join(', '))}` : ''}.</p></div>` : ''}
      <details class="insp-meta" ${prog.rated ? '' : 'open'}><summary>Stammdaten: ${esc(insp.inspector || '–')}, ${esc(insp.kind || '')}, Checkliste „${esc(cl.name)}“</summary><div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="ins-date" value="${esc(insp.date)}" data-change="ins-meta" ${locked ? 'disabled' : ''}></label>
        <label class="field"><span>Uhrzeit</span><input type="time" id="ins-time" value="${esc(insp.time || '')}" data-change="ins-meta" ${locked ? 'disabled' : ''}></label>
        <label class="field"><span>Prüfer/in</span><input type="text" id="ins-inspector" value="${esc(insp.inspector || '')}" data-change="ins-meta" ${locked ? 'disabled' : ''}></label>
        <label class="field"><span>Kontrollart</span><select id="ins-kind" data-change="ins-meta" ${locked ? 'disabled' : ''}>${options(INSPECTION_KINDS.map((x) => [x, x]), insp.kind)}</select></label>
        <label class="field"><span>Checkliste</span><select id="ins-cl" data-change="ins-meta" ${locked || prog.rated ? 'disabled' : ''}>${options(k.checklists.map((x) => [x.id, x.name]), cl.id)}</select></label>
      </div></details>
      ${prev.length ? `<div class="insp-prevbox"><h3>Offene Mängel aus früheren Kontrollen (${prev.length})</h3><ul class="plain">${prev.map((d) => `<li>${ratingPill(d.rating)} <strong>${d.itemId}</strong> ${esc(prevText(d))}${d.note ? ` – ${esc(d.note)}` : ''} <span class="muted">seit ${formatDate(d.since, { weekday: false, year: true })}</span>${locked ? '' : ` <button class="btn small" data-action="def-done" data-insp="${esc(d.inspectionId)}" data-item="${esc(d.itemId)}">Erledigt</button>`}</li>`).join('')}</ul></div>` : ''}
      <nav class="chapter-chips" aria-label="Kapitel">${chips}</nav>
      ${chapters}
      <section class="insp-chapter" id="ch-end"><h3>Abschluss</h3>
        <p>Vorschlag: ${overallPill(suggestion)} ${overall && overall !== suggestion ? `<span class="pill warning name">abweichend gewählt: ${esc(overall)}</span>` : ''} · ${f.length} Feststellungen</p>
        <div class="seg" role="radiogroup" aria-label="Gesamtzustand">${OVERALL.map((o) => `<button type="button" class="btn small ${(overall || '') === o ? 'primary' : ''}" data-action="ins-overall" data-v="${esc(o)}" ${locked ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
        <label class="field"><span>Zusammenfassung ${locked ? '' : '<button type="button" class="link-btn" data-action="ins-summary">Textvorschlag</button>'}</span><textarea id="ins-text" rows="3" data-change="ins-meta" ${locked ? 'disabled' : ''}>${esc(insp.summary?.text || '')}</textarea></label>
        <div class="form-grid"><label class="field inline"><input type="checkbox" id="ins-follow" data-change="ins-meta" ${insp.summary?.followUp ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Nachkontrolle nötig</span></label>
          <label class="field"><span>Termin Nachkontrolle</span><input type="date" id="ins-follow-date" value="${esc(insp.summary?.followUpDate || '')}" data-change="ins-meta" ${locked ? 'disabled' : ''}></label></div>
        ${followUpCalendar(insp)}
        <div class="sig-row">${[['inspector', 'Unterschrift Prüfer/in', insp.inspector], ['customer', 'Unterschrift Auftraggeber (optional)', '']]
          .map(([key, label, name]) => {
            const s = insp.signatures?.[key]
            return signaturePad(key, { label: s?.at ? `${label} · signiert ${new Date(s.at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}` : label, name: s?.name || name || '', disabled: locked, nameChange: 'ins-sig-name' })
          })
          .join('')}</div>
      </section>`,
    foot: locked
      ? `<div class="actions">${insp.status === 'abgeschlossen' && editable() ? `<button class="btn small ${app.ui.confirm === 'ins-reopen' ? 'danger confirm' : ''}" data-action="ins-reopen" data-id="${esc(insp.id)}">${app.ui.confirm === 'ins-reopen' ? 'Wirklich wieder öffnen?' : 'Wieder öffnen'}</button>` : ''}</div>
        <div class="actions">${canPdf() ? `<button class="btn" data-action="ins-pdf" data-id="${esc(insp.id)}">${ICON.print} PDF</button>` : ''}<button class="btn primary" data-action="ins-send-open" data-id="${esc(insp.id)}">${ICON.send} Senden</button></div>`
      : `<div class="actions"><button class="btn small ${app.ui.confirm === 'ins-del' ? 'danger confirm' : 'danger'}" data-action="ins-del" data-id="${esc(insp.id)}">${app.ui.confirm === 'ins-del' ? 'Kontrolle löschen?' : 'Löschen'}</button></div>
        <div class="actions"><span class="muted">wird laufend gespeichert</span><button class="btn primary ${app.ui.confirm === 'ins-close' ? 'confirm' : ''}" data-action="ins-close" data-id="${esc(insp.id)}">${app.ui.confirm === 'ins-close' ? `${prog.total - prog.rated} Punkte offen – trotzdem abschließen?` : `${ICON.lock} Abschließen`}</button></div>`,
  })
}

registerModal('inspection', inspectionModal)

/** Nachkontrolle in den Kalender: direkt in Outlook (features.calendar) oder als .ics-Datei. */
function followUpCalendar(insp) {
  const date = insp.summary?.followUp && insp.summary?.followUpDate
  if (!date || !editable()) return ''
  const cal = insp.calendar
  const done = cal?.date === date
  const outlook = canCalendar() ? `<button type="button" class="btn small" data-action="ins-calendar" data-id="${esc(insp.id)}">${cal?.id && !done ? 'Termin in Outlook verschieben' : 'In Outlook-Kalender eintragen'}</button>` : ''
  const ics = app.config.features.download ? `<button type="button" class="btn small" data-action="ins-ics" data-id="${esc(insp.id)}">Termin als Datei (.ics)</button>` : ''
  if (done && cal.webLink) return `<p class="note">${ICON.check} Nachkontrolle am ${formatDate(date, { year: true })} steht im Kalender · <a href="${esc(cal.webLink)}" target="_blank" rel="noopener">in Outlook öffnen</a></p>`
  return outlook || ics ? `<p class="actions">${outlook}${ics}</p>` : ''
}

function followUpEvent(insp) {
  const obj = objOf(insp.objectId) || {}
  const cl = checklistOf(insp.checklistId)
  const open = findings(insp, cl).filter((x) => !x.done)
  return {
    title: `Nachkontrolle ${obj.name || ''}`.trim(),
    date: insp.summary.followUpDate,
    location: obj.address || '',
    text: [`Nachkontrolle zur Objektkontrolle vom ${formatDate(insp.date, { year: true })}${insp.inspector ? ` (${insp.inspector})` : ''}.`, insp.summary?.overall ? `Gesamtzustand: ${insp.summary.overall}` : '', open.length ? `\nOffene Mängel:\n${open.map((x) => `• ${x.id} ${x.rating}/${x.prio}: ${x.text}${x.note ? ` – ${x.note}` : ''}`).join('\n')}` : ''].filter(Boolean).join('\n'),
  }
}

// Aktuelle Kontrolle im Dialog ändern, speichern, Dialog neu zeichnen
function change(fn, { rerender = true, skip } = {}) {
  const insp = inspOf(app.ui.modal?.id)
  if (!insp || insp.status === 'abgeschlossen') return
  fn(insp)
  insp.updatedAt = new Date().toISOString()
  persist()
  // skip: Felder, die aus dem neuen Stand kommen (nicht die alte Eingabe zurückschreiben)
  if (rerender) renderModalKeepingInput(skip)
}

function rate(insp, itemId, r) {
  const it = (insp.items[itemId] ||= {})
  it.rating = r
  if (DEFECTS.includes(r)) {
    it.prio ||= DEFAULT_PRIO[r]
    // Zuständig: Reinigung → Stammkraft des Objekts; Frist nach Priorität
    if (r === 'R' && !it.assignee) it.assignee = regularsAt(insp.objectId)[0] || ''
    if (!it.due) it.due = addDays(insp.date, PRIO_DAYS[it.prio] ?? 14)
  } else {
    for (const key of ['prio', 'assignee', 'due']) delete it[key]
  }
}

function startInspection(objectId, kind) {
  const k = K()
  const open = k.inspections.find((x) => x.objectId === objectId && x.status !== 'abgeschlossen')
  if (open) return openModal({ type: 'inspection', id: open.id })
  const now = new Date()
  const insp = {
    id: uid('k-'),
    objectId,
    checklistId: k.plans[objectId]?.checklistId || k.checklists[0].id,
    date: todayISO(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    inspector: userName(),
    kind: INSPECTION_KINDS.includes(kind) ? kind : 'Regelkontrolle',
    status: 'offen',
    items: {},
    summary: {},
    createdAt: now.toISOString(),
    ...(userName() ? { by: userName() } : {}),
  }
  k.inspections.push(insp)
  persist()
  app.ui.view = 'kontrolle'
  renderNow()
  openModal({ type: 'inspection', id: insp.id })
}

registerActions({
  'ins-tab': (el) => {
    app.ui.insTab = el.dataset.v
    renderNow()
  },
  'ins-open': (el) => {
    app.ui.view = 'kontrolle'
    renderNow()
    openModal({ type: 'inspection', id: el.dataset.id })
  },
  'ins-jump': (el) => document.getElementById(`ch-${el.dataset.ch}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  'goto-inspections': (el) => {
    app.ui.view = 'kontrolle'
    app.ui.insTab = el.dataset.tab || 'objekte'
    app.ui.modal = null
    renderNow()
  },
})

registerActions(
  {
    'ins-new': (el) => startInspection(el.dataset.obj, el.dataset.kind),
    'ins-new-other': () => {
      const id = val('ins-other')
      if (!id) return toast('Bitte ein Objekt wählen.')
      startInspection(id, 'Erstaufnahme')
    },
    'ins-plan': (el) => {
      const k = K()
      if (el.value) k.plans[el.dataset.obj] = { ...(k.plans[el.dataset.obj] || {}), months: Number(el.value) }
      else delete k.plans[el.dataset.obj]
      persist()
      renderNow()
    },
    'ins-rate': (el) =>
      change((insp) => {
        rate(insp, el.dataset.item, el.dataset.r)
        // weiter zum nächsten offenen Punkt
        setTimeout(() => {
          const next = document.querySelector(`.insp-item[data-item="${el.dataset.item}"]`)?.nextElementSibling
          if (next?.classList.contains('insp-item') && !DEFECTS.includes(el.dataset.r)) next.focus({ preventScroll: true })
        }, 0)
      }),
    'ins-rest': (el) =>
      change((insp) => {
        for (const x of checklistItems(checklistOf(insp.checklistId)).filter((y) => y.chapter === Number(el.dataset.ch))) if (!insp.items[x.id]?.rating) rate(insp, x.id, el.dataset.r)
      }),
    'ins-note': (el) => change((insp) => ((insp.items[el.dataset.item] ||= {}).note = el.value.trim()), { rerender: false }),
    'ins-prio': (el) =>
      change((insp) => {
        const it = insp.items[el.dataset.item]
        it.prio = el.value
        it.due = addDays(insp.date, PRIO_DAYS[it.prio] ?? 14)
      }, { skip: /^due-/ }),
    'ins-who': (el) => change((insp) => (insp.items[el.dataset.item].assignee = el.value), { rerender: false }),
    'ins-due': (el) => change((insp) => (insp.items[el.dataset.item].due = el.value), { rerender: false }),
    'ins-photo': async (el) => {
      const file = el.files?.[0]
      const insp = inspOf(app.ui.modal?.id)
      if (!file || !insp) return
      toast('Foto wird gespeichert …')
      try {
        const photo = await storePhoto(file, `kontrolle/fotos/${insp.date.slice(0, 4)}/${objOf(insp.objectId)?.short || insp.objectId}/${insp.date}_Punkt-${el.dataset.item.replace('.', '-')}_${Date.now().toString(36)}`)
        change((x) => {
          const it = (x.items[el.dataset.item] ||= {})
          it.photos = [...(it.photos || []), photo]
        })
        toast('Foto gespeichert.')
      } catch (err) {
        toast(`Foto konnte nicht gespeichert werden: ${err.message}`)
      }
    },
    'ins-photo-del': (el) => change((insp) => insp.items[el.dataset.item].photos.splice(Number(el.dataset.i), 1)),
    'ins-meta': () =>
      change(
        (insp) => {
          insp.date = val('ins-date') || insp.date
          insp.time = val('ins-time')
          insp.inspector = val('ins-inspector').trim()
          insp.kind = val('ins-kind')
          if (document.getElementById('ins-cl') && !document.getElementById('ins-cl').disabled) insp.checklistId = val('ins-cl')
          insp.summary = { ...insp.summary, text: val('ins-text').trim(), followUp: document.getElementById('ins-follow')?.checked || false, followUpDate: val('ins-follow-date') }
          if (insp.summary.followUp && !insp.summary.followUpDate) insp.summary.followUpDate = addDays(insp.date, 14)
        },
        { skip: /^ins-follow-date$/ },
      ),
    'ins-overall': (el) => change((insp) => (insp.summary = { ...insp.summary, overall: el.dataset.v })),
    'ins-summary': () => change((insp) => (insp.summary = { ...insp.summary, text: summaryText(insp, checklistOf(insp.checklistId)) }), { skip: /^ins-text$/ }),
    'ins-sig-name': (el) =>
      change((insp) => {
        insp.signatures ||= {}
        insp.signatures[el.dataset.sig] = { ...(insp.signatures[el.dataset.sig] || {}), name: el.value.trim() }
      }, { rerender: false }),
    'sig-changed': (el) =>
      change((insp) => {
        const key = el.dataset.sig
        const data = app.ui.modal.sig?.[key]
        insp.signatures ||= {}
        insp.signatures[key] = { ...(insp.signatures[key] || {}), name: val(`sig-name-${key}`).trim(), ...(data ? { image: { data }, at: new Date().toISOString() } : { image: null, at: null }) }
      }, { rerender: false }),
    'ins-close': async (el) => {
      const insp = inspOf(el.dataset.id)
      const prog = progress(checklistOf(insp.checklistId), insp.items)
      if (prog.rated < prog.total && !confirmStep('ins-close', renderModal)) return
      app.ui.confirm = null
      el.disabled = true
      // Unterschriften als Dateien ablegen (SharePoint), dann sperren
      for (const key of ['inspector', 'customer']) {
        const s = insp.signatures?.[key]
        if (s?.image?.data && app.store?.kind === 'sharepoint') {
          try {
            s.image = await storeImageData(s.image.data, `kontrolle/unterschriften/${insp.date.slice(0, 4)}/${insp.date}_${insp.id}_${key}`)
          } catch (err) {
            toast(`Unterschrift konnte nicht abgelegt werden: ${err.message}`)
          }
        }
      }
      insp.summary = { ...insp.summary, overall: insp.summary?.overall || suggestOverall(insp.items) }
      insp.status = 'abgeschlossen'
      insp.closedAt = new Date().toISOString()
      persist()
      renderNow()
      renderModal()
      const f = findings(insp, checklistOf(insp.checklistId))
      toast(`Kontrolle abgeschlossen: ${insp.summary.overall}, ${f.length} Feststellungen. Jetzt PDF oder Senden.`)
    },
    'ins-reopen': (el) => {
      if (!confirmStep('ins-reopen', renderModal)) return
      const insp = inspOf(el.dataset.id)
      insp.status = 'offen'
      delete insp.closedAt
      persist()
      renderNow()
      renderModal()
    },
    'ins-del': (el) => {
      if (!confirmStep('ins-del', renderModal)) return
      const k = K()
      k.inspections = k.inspections.filter((x) => x.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Kontrolle gelöscht.')
    },
    'def-done': (el) => {
      const insp = inspOf(el.dataset.insp)
      const it = insp?.items?.[el.dataset.item]
      if (!it) return
      it.done = { at: new Date().toISOString(), ...(userName() ? { by: userName() } : {}) }
      persist()
      renderNow()
      if (app.ui.modal) renderModalKeepingInput()
      toast('Mangel als erledigt markiert.')
    },
    'def-assign': (el) => {
      inspOf(el.dataset.insp).items[el.dataset.item].assignee = el.value
      persist()
      renderNow()
    },
    'def-due': (el) => {
      inspOf(el.dataset.insp).items[el.dataset.item].due = el.value
      persist()
      renderNow()
    },
  },
  { edit: MODULE },
)

// Tastatur am Notebook: Ziffern 1–5 bewerten den markierten Prüfpunkt, Pfeile wechseln
document.addEventListener('keydown', (e) => {
  if (app.ui.modal?.type !== 'inspection' || e.ctrlKey || e.metaKey || e.altKey) return
  const item = e.target.closest?.('.insp-item')
  if (!item || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
  const n = Number(e.key)
  if (n >= 1 && n <= 5) {
    e.preventDefault()
    item.querySelector(`[data-r="${RATING_KEYS[n - 1]}"]`)?.click()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const all = [...document.querySelectorAll('.insp-item')]
    all[all.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  } else if (e.key.toLowerCase() === 'b') {
    e.preventDefault()
    item.querySelector('input[type="text"]')?.focus()
  }
})
document.addEventListener('click', (e) => {
  const item = e.target.closest?.('.insp-item')
  if (item && !e.target.closest('button, input, select, label, a')) item.focus({ preventScroll: true })
})

// Nacharbeit als Einsatz im Dienstplan (Stammkraft vorgeschlagen)
registerActions(
  {
    'def-rework': (el) => {
      const insp = inspOf(el.dataset.insp)
      const it = insp.items[el.dataset.item]
      const assignee = it.assignee || regularsAt(insp.objectId)[0] || ''
      let date = it.due && it.due > todayISO() ? it.due : addDays(todayISO(), 1)
      while (isoWeekday(date) > 6) date = addDays(date, 1)
      const regular = app.data.tasks.find((t) => t.objectId === insp.objectId && (t.regulars || []).includes(assignee) && t.recurrence.type === 'weekly')
      const task = reworkTask({ inspectionId: insp.id, itemId: el.dataset.item, note: it.note }, { text: itemText(checklistOf(insp.checklistId), el.dataset.item), objectId: insp.objectId, assignee, date, id: uid('t'), start: regular?.end || '08:00', minutes: it.rating === 'R' ? 30 : 60 })
      recordUndo('Nacharbeit einplanen')
      app.data.tasks.push(task)
      it.taskId = task.id
      if (!it.assignee && assignee) it.assignee = assignee
      persist()
      renderNow()
      const away = assignee && (app.data.absences || []).find((a) => a.employeeId === assignee && a.from <= date && a.to >= date)
      toast(`Nacharbeit am ${formatDate(date)} ${task.start}–${task.end}${assignee ? ` für ${empName(assignee)}` : ''} eingeplant.${away ? ` Achtung: ${empName(assignee)} ist dann abwesend (${away.type}), bitte in der Woche umteilen.` : ''}`)
    },
  },
  { edit: 'planung' },
)

// ---------------------------------------------------------------- Checklisten

registerModal('checklist', (c, m) => {
  const isNew = m.id === 'new'
  const cl = isNew ? { id: 'new', name: '', chapters: [] } : checklistOf(m.id)
  const used = K().inspections.some((x) => x.checklistId === cl.id)
  return modalFrame({
    title: isNew ? 'Neue Checkliste' : `Checkliste ${esc(cl.name)}`,
    wide: true,
    body: `<label class="field"><span>Name</span><input id="cl-name" type="text" value="${esc(cl.name)}" placeholder="z. B. Bürogebäude, Arztpraxis"></label>
      <p class="note">Je Zeile ein Prüfpunkt, Kapitel mit „# “ beginnen. ${used ? '<strong>Diese Checkliste wurde schon verwendet: neue Punkte bitte am Ende eines Kapitels anfügen, damit die Nummern (z. B. 1.6) und damit die offenen Mängel gleich bleiben.</strong>' : ''}</p>
      <textarea id="cl-text" rows="18" class="mono">${esc(isNew ? checklistToText(OBJEKTKONTROLLE_CHECKLIST) : checklistToText(cl))}</textarea>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="cl-save" data-id="${esc(cl.id)}">Speichern</button></div>`,
  })
})

registerActions(
  {
    'cl-edit': (el) => openModal({ type: 'checklist', id: el.dataset.id }),
    'cl-save': (el) => {
      const name = val('cl-name').trim()
      const chapters = textToChapters(val('cl-text'))
      if (!name) return toast('Bitte einen Namen eingeben.')
      if (!chapters.length) return toast('Die Checkliste hat keine Prüfpunkte.')
      const k = K()
      if (el.dataset.id === 'new') k.checklists.push({ id: uid('cl-'), name, version: 1, chapters })
      else {
        const cl = checklistOf(el.dataset.id)
        Object.assign(cl, { name, chapters, version: (cl.version || 1) + 1 })
      }
      persist()
      closeModal()
      renderNow()
      toast('Checkliste gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- PDF und Versand

async function inspectionPdf(insp) {
  const cl = checklistOf(insp.checklistId)
  const obj = objOf(insp.objectId) || {}
  const mappe = mappeOf(insp.objectId)
  const items = {}
  for (const [id, it] of Object.entries(insp.items || {})) if (it.photos?.length) items[id] = await Promise.all(it.photos.map(photoDataUrl))
  const signatures = {}
  for (const key of ['inspector', 'customer']) signatures[key] = await photoDataUrl(insp.signatures?.[key]?.image)
  const logo = await loadLogo()
  const doc = inspectionDocument(insp, { checklist: cl, object: obj, customer: mappe.customer || '', address: mappe.address || obj.address, images: { items, signatures }, people: new Map(app.data.employees.map((e) => [e.id, e.name])), brand: app.config.brand, logo })
  return { blob: await pdfBlob(doc), name: inspectionFileName(insp, obj, fileSafe) }
}

/** Bekannte Adressen: Objektmappe (Kontakte, Hausverwaltung), zuletzt verwendet. */
function knownAddresses(insp) {
  const mappe = mappeOf(insp.objectId)
  const customer = mappe.customerNo ? (app.data.mappe?.customers || []).find((x) => x.nr === mappe.customerNo) : null
  const list = [...(mappe.contacts || []).filter((x) => x.mail).map((x) => [x.mail, `${x.name}${x.role ? ` (${x.role})` : ''}`]), ...(mappe.hvEmail ? [[mappe.hvEmail, 'Hausverwaltung']] : []), ...(customer?.email ? [[customer.email, `Kunde ${customer.name}`]] : []), ...(K().recent || []).map((a) => [a, 'zuletzt verwendet'])]
  const seen = new Set()
  return list.filter(([a]) => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
}

registerModal('ins-send', (c, m) => {
  const insp = inspOf(m.id)
  const obj = objOf(insp.objectId) || {}
  const known = knownAddresses(insp)
  return modalFrame({
    title: 'Protokoll senden',
    subtitle: `${esc(obj.name || '')} · ${formatDate(insp.date, { year: true })}`,
    body: `<p class="note">Nichts ist vorbelegt, damit kein Protokoll ungewollt beim Kunden landet. Bekannte Adressen mit An, CC oder BCC übernehmen.</p>
      ${known.length ? `<ul class="plain addr-list">${known.map(([a, label]) => `<li><span><strong>${esc(a)}</strong> <span class="muted">${esc(label)}</span></span><span class="actions">${['to', 'cc', 'bcc'].map((f) => `<button class="btn small" data-action="ins-addr" data-f="${f}" data-a="${esc(a)}">${f === 'to' ? 'An' : f.toUpperCase()}</button>`).join('')}</span></li>`).join('')}</ul>` : ''}
      <div class="form-grid">
        <label class="field wide"><span>An</span><input id="is-to" type="text" value="${esc(m.to || '')}"></label>
        <label class="field"><span>CC</span><input id="is-cc" type="text" value="${esc(m.cc || '')}"></label>
        <label class="field"><span>BCC</span><input id="is-bcc" type="text" value="${esc(m.bcc || '')}"></label>
      </div>
      ${insp.sent?.length ? `<p class="note">Bisher versendet: ${insp.sent.map((s) => `${new Date(s.at).toLocaleDateString('de-AT')} an ${esc(s.to.join(', '))}`).join('; ')}</p>` : ''}`,
    foot: `<button class="btn" data-action="ins-open" data-id="${esc(insp.id)}">Zurück</button><div class="actions">${canMail() ? `<button class="btn primary" data-action="ins-send" data-id="${esc(insp.id)}">${ICON.send} Mit PDF senden</button>` : `<button class="btn primary" data-action="ins-mailto" data-id="${esc(insp.id)}">${ICON.send} Im E-Mail-Programm öffnen</button>`}</div>`,
  })
})

const list = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean)
const mailText = (insp) => {
  const obj = objOf(insp.objectId) || {}
  const f = findings(insp, checklistOf(insp.checklistId))
  return `Guten Tag,\n\nanbei das Protokoll der Objektkontrolle ${obj.name || ''} vom ${formatDate(insp.date, { year: true })} (${insp.kind || 'Kontrolle'}).\nGesamtzustand: ${insp.summary?.overall || suggestOverall(insp.items)}, ${f.length} ${f.length === 1 ? 'Feststellung' : 'Feststellungen'}.${insp.summary?.text ? `\n\n${insp.summary.text}` : ''}\n\nFreundliche Grüße\n${userName() || insp.inspector || ''}\n${app.config.brand.name || ''}`
}

registerActions({
  'ins-send-open': (el) => openModal({ type: 'ins-send', id: el.dataset.id }),
  'ins-addr': (el) => {
    const m = app.ui.modal
    for (const f of ['to', 'cc', 'bcc']) m[f] = val(`is-${f}`)
    const cur = list(m[el.dataset.f])
    if (!cur.includes(el.dataset.a)) m[el.dataset.f] = [...cur, el.dataset.a].join(', ')
    renderModal()
  },
  'ins-calendar': async (el) => {
    const insp = inspOf(el.dataset.id)
    if (!insp?.summary?.followUpDate) return
    el.disabled = true
    try {
      const ev = followUpEvent(insp)
      const res = await saveEvent(app.auth.getToken, ev, { id: insp.calendar?.id || '' })
      insp.calendar = { id: res.id, webLink: res.webLink, date: ev.date, at: new Date().toISOString() }
      persist()
      renderModal()
      toast(`Nachkontrolle am ${formatDate(ev.date, { year: true })} steht in deinem Outlook-Kalender.`)
    } catch (err) {
      el.disabled = false
      toast(err.message)
    }
  },
  'ins-ics': (el) => {
    const insp = inspOf(el.dataset.id)
    if (!insp?.summary?.followUpDate) return
    const ev = followUpEvent(insp)
    const ics = icsEvent({ uid: `${insp.id}-nachkontrolle@dienstplan`, date: ev.date, title: ev.title, description: ev.text, location: ev.location })
    download(fileSafe(`Nachkontrolle_${objOf(insp.objectId)?.short || objOf(insp.objectId)?.name || ''}_${ev.date}.ics`), new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  },
  'ins-pdf': async (el) => {
    toast('PDF wird erstellt …')
    const { blob, name } = await inspectionPdf(inspOf(el.dataset.id))
    download(name, blob)
  },
  'ins-mailto': async (el) => {
    const insp = inspOf(el.dataset.id)
    const to = list(val('is-to'))
    if (!to.length) return toast('Bitte mindestens eine Adresse bei „An“ eintragen.')
    if (canPdf()) {
      const { blob, name } = await inspectionPdf(insp)
      download(name, blob)
    }
    const obj = objOf(insp.objectId) || {}
    location.href = `mailto:${to.join(',')}?${new URLSearchParams({ ...(val('is-cc') ? { cc: list(val('is-cc')).join(',') } : {}), ...(val('is-bcc') ? { bcc: list(val('is-bcc')).join(',') } : {}), subject: `Objektkontrolle ${obj.name || ''} ${formatDate(insp.date, { year: true })}`, body: `${mailText(insp)}\n\n(PDF bitte anhängen)` }).toString().replace(/\+/g, '%20')}`
  },
})

registerActions(
  {
    'ins-send': async (el) => {
      const insp = inspOf(el.dataset.id)
      const to = list(val('is-to'))
      const cc = list(val('is-cc'))
      const bcc = list(val('is-bcc'))
      if (!to.length) return toast('Bitte mindestens eine Adresse bei „An“ eintragen.')
      el.disabled = true
      try {
        const { blob, name } = await inspectionPdf(insp)
        const obj = objOf(insp.objectId) || {}
        await sendMail(app.auth.getToken, { to, cc, bcc, subject: `Objektkontrolle ${obj.name || ''} ${formatDate(insp.date, { year: true })}`, text: mailText(insp), attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
        insp.sent = [...(insp.sent || []), { to, cc, bcc, at: new Date().toISOString(), ...(userName() ? { by: userName() } : {}) }]
        const k = K()
        k.recent = [...new Set([...to, ...cc, ...bcc, ...(k.recent || [])])].slice(0, 12)
        persist()
        toast(`Protokoll gesendet an ${to.join(', ')}.`)
        openModal({ type: 'inspection', id: insp.id })
      } catch (err) {
        el.disabled = false
        toast(`Senden fehlgeschlagen: ${err.message}`)
      }
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Hinweis im Einsatz

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const list = state().defects.filter((d) => d.objectId === objectId)
    if (!list.length) return ''
    const insp = inspOf(list[0].inspectionId)
    const cl = checklistOf(insp?.checklistId)
    return `${ICON.check} <strong>Offene Mängel:</strong> ${list.slice(0, 3).map((d) => `${RATINGS[d.rating].short} ${esc(itemText(cl, d.itemId))}${d.note ? ` (${esc(d.note)})` : ''}`).join('; ')}${list.length > 3 ? ` und ${list.length - 3} weitere` : ''}. <button class="btn small" data-action="goto-inspections" data-tab="maengel">Mängel</button>`
  },
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'kontrolle',
  module: MODULE,
  title: 'Objektkontrolle',
  compute: (today) => {
    const s = state(today)
    const due = s.due.filter((d) => d.plan && d.status !== 'ok').map((d) => ({ id: `due:${d.objectId}:${d.due}`, kind: 'due', d }))
    const urgent = s.defects.filter((d) => d.rating === 'G' || (d.due && d.due < today)).map((d) => ({ id: `def:${d.inspectionId}:${d.itemId}:${d.due}`, kind: 'defect', d }))
    return [...due, ...urgent]
  },
  render: (items) =>
    items
      .map(({ kind, d }) => {
        const obj = objOf(d.objectId)
        if (kind === 'due') return `<div class="todo-item"><span class="flag ${d.status === 'ueberfaellig' ? 'error' : 'warning'}">${ICON.check}</span><div class="todo-text"><strong>${esc(obj?.name || '')}</strong> · ${esc(d.reason)}<br><span class="muted">${d.status === 'ueberfaellig' ? 'überfällig seit' : 'fällig bis'} ${formatDate(d.due, { weekday: false, year: true })}</span></div><button class="btn small primary" data-action="goto-inspections" data-tab="objekte">Kontrolle</button></div>`
        const insp = inspOf(d.inspectionId)
        return `<div class="todo-item"><span class="flag error">${RATINGS[d.rating].short}</span><div class="todo-text"><strong>${esc(obj?.name || '')}</strong> · ${esc(itemText(checklistOf(insp?.checklistId), d.itemId))}<br><span class="muted">${d.rating === 'G' ? 'Gefahr' : 'Frist vorbei'}${d.due ? ` · Frist ${formatDate(d.due, { weekday: false })}` : ''}${d.assignee ? ` · ${esc(empName(d.assignee))}` : ''}</span></div><button class="btn small primary" data-action="goto-inspections" data-tab="maengel">Mängel</button></div>`
      })
      .join(''),
})

