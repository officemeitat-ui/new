// Unterweisungen & Fristen (Stammdaten): je Person Sicherheitsunterweisung, Unterweisung Reinigungsmittel,
// Erste-Hilfe-Auffrischung, Führerscheinkontrolle, Aufenthaltstitel … mit Ampel; Unterweisung für viele auf
// einmal mit Teilnehmerliste, Unterschrift am Tablet und Nachweis als PDF; Arten einstellbar.
// Datei unterweisungen/unterweisungen.json (Rechenkern: core/trainings.js). Die Prüfregel „Fristen je Person“
// im Plan liest dieselbe Datei.

import { formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import { dueList, emptyTrainings, isRequired, KINDS, matrix, sessionRecords, STATE_TEXT, statusOf, TRAINING_DEFAULTS, typesOf, untilOf, addMonths } from '../../core/trainings.js'
import { sessionDocument, sessionPdfName } from '../../export/training-pdf.js'
import { app, canEdit, closeModal, confirmStep, empName, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'

const MODULE = 'unterweisungen'
const ICON_TRAIN = '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M6 10.2V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.8M21.5 8v5.5"/>'
const doc = () => {
  const d = (app.data.unterweisungen ||= emptyTrainings())
  d.types ||= []
  d.records ||= []
  d.sessions ||= []
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const types = () => typesOf(doc())
const typeOf = (id) => (doc().types.length ? doc().types : TRAINING_DEFAULTS).find((t) => t.id === id)
const empOf = (id) => app.data.employees.find((e) => e.id === id)
const active = () => app.data.employees.filter((e) => !e.exitDate || e.exitDate >= todayISO())
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const short = (d) => formatDate(d, { weekday: false, year: true })
const CLS = { ok: 'ok', bald: 'warning', abgelaufen: 'error', fehlt: 'error', na: '' }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const skillsAll = () => [...new Set([...(app.data.skills || []), ...app.data.employees.flatMap((e) => e.skills || [])])].sort((a, b) => a.localeCompare(b, 'de'))

/** Vor dem ersten Ändern der Arten die Vorgaben in die Datei übernehmen. */
function ownTypes() {
  if (!doc().types.length) doc().types = structuredClone(TRAINING_DEFAULTS)
  return doc().types
}

// ---------------------------------------------------------------- Ansicht

function trainingsView() {
  const today = todayISO()
  const t = types()
  const all = matrix({ doc: doc(), employees: app.data.employees, today })
  const team = app.ui.trTeam || ''
  const q = String(app.ui.trSearch || '').trim().toLowerCase()
  const rows = all.filter((r) => (!team || r.emp.team === team) && (!q || r.emp.name.toLowerCase().includes(q)) && (!app.ui.trOnly || ['abgelaufen', 'fehlt', 'bald'].includes(r.worst)))
  const due = dueList({ doc: doc(), employees: app.data.employees, today })
  const n = (state) => due.filter((d) => d.state === state).length
  const ed = editable()
  const teams = [...new Set(active().map((e) => e.team).filter(Boolean))].sort()
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const head = t.map((x) => `<th class="tr-head" title="${esc([x.law, x.note].filter(Boolean).join(' · '))}">${esc(x.name)}${x.law ? `<br><span class="muted">${esc(x.law)}</span>` : ''}</th>`).join('')
  const body = rows
    .map((r) => `<tr><td><strong>${esc(r.emp.name)}</strong>${r.emp.team ? `<br><span class="muted">${esc(r.emp.team)}</span>` : ''}</td>${t
      .map((x) => {
        const c = r.cells[x.id]
        const label = c.state === 'na' ? '–' : c.state === 'fehlt' ? 'fehlt' : c.until ? `bis ${short(c.until)}` : `am ${short(c.record.date)}`
        return `<td><button class="tr-cell pill ${CLS[c.state]}" data-action="tr-record-open" data-emp="${esc(r.emp.id)}" data-type="${esc(x.id)}" title="${esc(STATE_TEXT[c.state])}">${esc(label)}</button></td>`
      })
      .join('')}</tr>`)
    .join('')
  const sessions = doc()
    .sessions.slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((s) => `<tr><td>${formatDate(s.date)}</td><td>${esc(typeOf(s.typeId)?.name || '')}</td><td class="num">${s.participants.length}</td><td>${esc(s.trainer || '')}</td><td>${esc(s.place || '')}</td><td><button class="btn small" data-action="tr-session-pdf" data-id="${esc(s.id)}">${ICON.download} Nachweis</button></td></tr>`)
    .join('')
  return `<div class="section-head"><div><h2>Unterweisungen &amp; Fristen</h2><p>Je Person: Unterweisungen, Kurse, Kontrollen und Dokumente mit Ablaufdatum. Unterweisung für viele auf einmal mit Unterschrift am Tablet und Nachweis als PDF. Der Plan warnt bei abgelaufener Arbeitserlaubnis oder Führerscheinkontrolle.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="tr-session-open">Unterweisung durchführen</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Einzeln eintragen', icon: ICON.plus, action: 'tr-record-open', hint: 'z. B. Kurs oder Nachweis von außen' },
          ed && { label: 'Arten verwalten', icon: ICON.gear, action: 'tr-types-open', hint: 'Unterweisungen, Kurse, Fristen' },
          { heading: 'Export' },
          { label: 'Übersicht (CSV)', icon: ICON.download, action: 'tr-csv', mail: true },
        ],
      })}</div></div>
    <div class="impact-stats tc-stats">${tile('abgelaufen', n('abgelaufen'), n('abgelaufen') ? 'err' : '')}${tile('fehlt (Pflicht)', n('fehlt'), n('fehlt') ? 'err' : '')}${tile('läuft in 30 Tagen ab', n('bald'))}${tile('Personen', all.length)}</div>
    <div class="filters">${teams.length > 1 ? `<label class="field inline"><span>Team</span><select id="tr-team" data-change="tr-team">${options(teams.map((x) => [x, x]), team, { empty: 'alle' })}</select></label>` : ''}
      <label class="field inline"><span>Suche</span><input type="search" id="tr-search" value="${esc(app.ui.trSearch || '')}" data-input="tr-search" placeholder="Name"></label>
      <label class="check"><input type="checkbox" id="tr-only" ${app.ui.trOnly ? 'checked' : ''} data-change="tr-only"><span>nur mit Handlungsbedarf</span></label></div>
    ${body ? `<div class="table-wrap"><table class="data tr-matrix"><thead><tr><th>Person</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Niemand in dieser Auswahl.</p>'}
    <p class="note">Grün = gültig, gelb = läuft in 30 Tagen ab, rot = abgelaufen oder fehlt (bei Pflicht). Feld anklicken zum Eintragen. Gültigkeit und Pflicht je Art unter „Arten“; das Intervall der Unterweisung legt die Evaluierung fest (§ 4, § 14 ASchG).</p>
    ${sessions ? `<h3>Letzte Unterweisungen</h3><div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Art</th><th class="num">Personen</th><th>Unterwiesen von</th><th>Ort</th><th></th></tr></thead><tbody>${sessions}</tbody></table></div>` : ''}`
}

registerView({
  id: 'unterweisungen',
  order: 205,
  label: 'Unterweisungen & Fristen',
  group: 'stamm',
  module: MODULE,
  icon: ICON_TRAIN,
  noWeek: true,
  text: 'Sicherheitsunterweisung, Führerschein, Arbeitserlaubnis',
  badge: () => dueList({ doc: doc(), employees: app.data.employees, today: todayISO() }).filter((d) => d.state !== 'bald').length,
  render: trainingsView,
})

// ---------------------------------------------------------------- Eintragen (eine Person, eine Art)

function recordModal(c, m) {
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const emp = empOf(m.empId)
  const type = typeOf(m.typeId) || types()[0]
  const history = emp && type ? doc().records.filter((r) => r.empId === emp.id && r.typeId === type.id).sort((a, b) => b.date.localeCompare(a.date)) : []
  const doc0 = type?.kind === 'dokument'
  const date = m.date || todayISO()
  const suggested = type && Number(type.months) > 0 ? addMonths(date, Number(type.months)) : ''
  const s = emp && type ? statusOf({ type, emp, records: doc().records, today: todayISO() }) : null
  return modalFrame({
    title: emp && type ? `${type.name}: ${emp.name}` : 'Eintragen',
    subtitle: s ? `${STATE_TEXT[s.state]}${s.until ? ` · bis ${short(s.until)}` : ''}${type && emp && isRequired(type, emp) ? ' · Pflicht' : ''}` : '',
    body: `<div class="form-grid">
        <label class="field"><span>Person</span><select id="tr-emp" data-change="tr-record-redraw" ${dis}>${options(active().map((e) => [e.id, e.name]), m.empId || '', { empty: '– Person –' })}</select></label>
        <label class="field"><span>Art</span><select id="tr-type" data-change="tr-record-redraw" ${dis}>${options(types().map((x) => [x.id, x.name]), type?.id || '')}</select></label>
        <label class="field"><span>${doc0 ? 'Geprüft am' : type?.kind === 'kontrolle' ? 'Kontrolliert am' : 'Durchgeführt am'}</span><input type="date" id="tr-date" value="${esc(date)}" data-change="tr-record-redraw" ${dis}></label>
        <label class="field"><span>Gültig bis${doc0 ? ' (Ablaufdatum)' : ''}</span><input type="date" id="tr-until" value="${esc(m.until || '')}" placeholder="${esc(suggested)}" ${dis}><small class="muted">${suggested ? `leer = ${short(suggested)} (${type.months} Monate)` : doc0 ? 'bitte das Ablaufdatum eintragen' : 'leer = ohne Ablauf'}</small></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="tr-note" value="${esc(m.note || '')}" placeholder="${doc0 ? 'z. B. Rot-Weiß-Rot – Karte (keine Kopie speichern)' : 'z. B. Inhalt, Kursanbieter'}" ${dis}></label>
      </div>
      ${type?.law || type?.note ? `<p class="note">${esc([type.law, type.note].filter(Boolean).join(' · '))}</p>` : ''}
      ${history.length ? `<section><h3>Bisher</h3><ul class="tc-list">${history.map((r) => `<li>${short(r.date)}${untilOf(r, type) ? ` · gültig bis ${short(untilOf(r, type))}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}${r.signature ? ' <span class="pill ok">unterschrieben</span>' : ''} <span class="muted">${esc(r.by || '')}</span>${ed ? ` <button class="btn small ghost" data-action="tr-record-delete" data-id="${esc(r.id)}">${app.ui.confirm === `tr-del:${r.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</li>`).join('')}</ul></section>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<div class="actions"><button class="btn primary" data-action="tr-record-save">Eintragen</button></div>' : ''}`,
  })
}
registerModal('tr-record', recordModal, { module: MODULE })

function readRecord() {
  const m = app.ui.modal
  if (!document.getElementById('tr-emp')) return m
  Object.assign(m, { empId: val('tr-emp'), typeId: val('tr-type'), date: val('tr-date'), until: val('tr-until'), note: val('tr-note') })
  return m
}

// ---------------------------------------------------------------- Unterweisung für viele

function sessionDraft() {
  const m = app.ui.modal
  if (!m.init) {
    m.init = true
    m.typeId ||= types()[0]?.id
    m.date ||= todayISO()
    m.trainer ??= app.user?.name || ''
    m.place ??= ''
    m.topic ??= typeOf(m.typeId)?.note || ''
    // Teilnehmende vorgegeben (z. B. aus dem Arbeitsschutz: noch nicht unterwiesen), sonst wer die Art braucht
    m.participants ??= due(m.typeId)
    m.sign = false
    m.pdf = true
  }
  return m
}

/** Wer diese Art braucht: abgelaufen, fehlt oder läuft in 30 Tagen ab. */
function due(typeId) {
  const type = typeOf(typeId)
  if (!type) return []
  return active()
    .filter((e) => ['abgelaufen', 'fehlt', 'bald'].includes(statusOf({ type, emp: e, records: doc().records, today: todayISO() }).state))
    .map((e) => e.id)
}

function readSession() {
  const m = sessionDraft()
  if (!document.getElementById('ts-type')) return m
  const typeId = val('ts-type')
  if (typeId !== m.typeId) {
    m.topic = typeOf(typeId)?.note || ''
    m.participants = due(typeId)
    m.typeId = typeId
  } else {
    m.topic = val('ts-topic')
    m.participants = checkedValues('ts-p')
  }
  Object.assign(m, { date: val('ts-date') || todayISO(), trainer: val('ts-trainer'), place: val('ts-place'), sign: checked('ts-sign'), pdf: checked('ts-pdf') })
  return m
}

function sessionModal() {
  const m = sessionDraft()
  const type = typeOf(m.typeId)
  const today = todayISO()
  const people = active()
    .map((e) => ({ e, s: type ? statusOf({ type, emp: e, records: doc().records, today }) : { state: 'na' } }))
    .sort((a, b) => Number(!m.participants.includes(a.e.id)) - Number(!m.participants.includes(b.e.id)) || a.e.name.localeCompare(b.e.name, 'de'))
  const list = people.map(({ e, s }) => `<label class="check"><input type="checkbox" name="ts-p" value="${esc(e.id)}" ${m.participants.includes(e.id) ? 'checked' : ''} data-change="ts-redraw"><span>${esc(e.name)} <span class="pill ${CLS[s.state]}">${s.state === 'na' ? '–' : esc(STATE_TEXT[s.state])}</span></span></label>`).join('')
  const chosen = active().filter((e) => m.participants.includes(e.id))
  return modalFrame({
    title: 'Unterweisung durchführen',
    subtitle: `${plural(chosen.length, 'Person', 'Personen')} ausgewählt`,
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Art</span><select id="ts-type" data-change="ts-redraw">${options(types().map((x) => [x.id, x.name]), m.typeId)}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="ts-date" value="${esc(m.date)}"></label>
        <label class="field"><span>Unterwiesen von</span><input type="text" id="ts-trainer" value="${esc(m.trainer)}"></label>
        <label class="field"><span>Ort</span><input type="text" id="ts-place" value="${esc(m.place)}" placeholder="z. B. Büro, Objekt Wohnanlage Lehen"></label>
        <label class="field wide"><span>Inhalt</span><textarea id="ts-topic" rows="3">${esc(m.topic)}</textarea></label>
      </div>
      <section><h3>Teilnehmende</h3><p><button class="btn small" data-action="ts-pick" data-v="due">mit Bedarf</button> <button class="btn small" data-action="ts-pick" data-v="all">alle</button> <button class="btn small" data-action="ts-pick" data-v="none">keine</button></p><div class="form-grid tr-people">${list}</div></section>
      <label class="check"><input type="checkbox" id="ts-sign" ${m.sign ? 'checked' : ''} data-change="ts-redraw"><span>Unterschriften hier am Tablet</span></label>
      ${m.sign ? `<div class="tr-signs">${chosen.map((e) => signatureField(`tr-sig-${e.id}`, e.name)).join('')}</div>` : '<p class="note">Ohne Unterschrift am Tablet: die Teilnehmerliste (PDF) ausdrucken und unterschreiben lassen.</p>'}
      <label class="check"><input type="checkbox" id="ts-pdf" ${m.pdf ? 'checked' : ''}><span>Nachweis als PDF (Teilnehmerliste)</span></label>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ts-save">Für ${plural(chosen.length, 'Person', 'Personen')} eintragen</button></div>`,
  })
}
registerModal('tr-session', sessionModal, { module: MODULE })

async function sessionPdf(session, signatures) {
  const people = session.participants.map((id) => ({ id, name: empName(id) }))
  return pdfBlob(sessionDocument({ session, type: typeOf(session.typeId) || {}, people, signatures, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

// ---------------------------------------------------------------- Arten

function typesModal() {
  const m = app.ui.modal
  m.rows ||= structuredClone(doc().types.length ? doc().types : TRAINING_DEFAULTS)
  const whoOptions = [['alle', 'Pflicht für alle'], ['optional', 'nur bei Bedarf'], ...skillsAll().map((s) => [`skill:${s}`, `Pflicht mit „${s}“`])]
  const rows = m.rows
    .map((t, i) => `<tr><td><input type="text" id="tt-name-${i}" value="${esc(t.name)}" aria-label="Name"></td><td><input type="number" id="tt-months-${i}" min="0" max="120" value="${esc(t.months ?? 0)}" aria-label="Monate" class="num-input"></td>
      <td><select id="tt-who-${i}" aria-label="Pflicht">${options(whoOptions, t.who || 'optional')}</select></td><td><select id="tt-kind-${i}" aria-label="Art">${options(Object.entries(KINDS), t.kind || 'unterweisung')}</select></td>
      <td><input type="text" id="tt-law-${i}" value="${esc(t.law || '')}" aria-label="Grundlage"></td><td><label class="check"><input type="checkbox" id="tt-block-${i}" ${t.blocking ? 'checked' : ''}><span>sperrt</span></label></td>
      <td><label class="check"><input type="checkbox" id="tt-active-${i}" ${t.active !== false ? 'checked' : ''}><span>aktiv</span></label></td></tr>`)
    .join('')
  return modalFrame({
    title: 'Arten von Unterweisungen und Fristen',
    wide: true,
    body: `<div class="table-wrap"><table class="data tr-types"><thead><tr><th>Name</th><th>gültig (Monate)</th><th>Pflicht</th><th>Art</th><th>Grundlage</th><th>Plan</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><button class="btn small" data-action="tt-add">${ICON.plus} Art</button></p>
      <p class="note">0 Monate = kein automatischer Ablauf (z. B. Aufenthaltstitel: Ablaufdatum beim Eintragen). „sperrt“: abgelaufen = Fehler im Plan (Person darf nicht eingeteilt werden). Pflicht mit Qualifikation: Warnung im Plan, wenn ein Einsatz diese Qualifikation verlangt und die Frist abgelaufen ist. Nicht mehr nötige Arten auf „aktiv“ aus, damit die Einträge erhalten bleiben.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="tt-save">Speichern</button></div>`,
  })
}
registerModal('tr-types', typesModal, { module: MODULE })

function readTypes() {
  const m = app.ui.modal
  m.rows = m.rows.map((t, i) => ({ ...t, name: val(`tt-name-${i}`).trim(), months: Math.max(0, Math.round(Number(val(`tt-months-${i}`)) || 0)), who: val(`tt-who-${i}`), kind: val(`tt-kind-${i}`), law: val(`tt-law-${i}`).trim(), blocking: checked(`tt-block-${i}`), active: checked(`tt-active-${i}`) }))
  return m.rows
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'tr-team': () => {
    app.ui.trTeam = val('tr-team')
    renderNow()
  },
  'tr-only': () => {
    app.ui.trOnly = checked('tr-only')
    renderNow()
  },
  'tr-search': () => {
    app.ui.trSearch = val('tr-search')
    renderNow()
    const el = document.getElementById('tr-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'tr-record-open': (el) => openModal({ type: 'tr-record', empId: el.dataset.emp || '', typeId: el.dataset.type || '' }),
  'tr-record-redraw': () => {
    readRecord()
    renderModal()
  },
  'tr-csv': () => {
    const t = types()
    const rows = matrix({ doc: doc(), employees: app.data.employees, today: todayISO() })
    const cols = [['Person', (r) => r.emp.name], ['Team', (r) => r.emp.team || ''], ...t.map((x) => [x.name, (r) => { const c = r.cells[x.id]; return c.state === 'na' ? '' : `${STATE_TEXT[c.state]}${c.until ? ` bis ${c.until}` : ''}` }])]
    download(`Unterweisungen_Fristen_${todayISO()}.csv`, new Blob([`﻿${toCSV(rows, cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'tr-session-pdf': async (el) => {
    const s = doc().sessions.find((x) => x.id === el.dataset.id)
    if (!s) return
    const signatures = Object.fromEntries(doc().records.filter((r) => r.sessionId === s.id && r.signature).map((r) => [r.empId, r.signature]))
    download(sessionPdfName(s, typeOf(s.typeId)), await sessionPdf(s, signatures))
  },
})

registerActions(
  {
    'tr-record-save': () => {
      const m = readRecord()
      const type = typeOf(m.typeId)
      if (!m.empId) return toast('Bitte die Person wählen.')
      if (!type) return toast('Bitte die Art wählen.')
      if (!m.date) return toast('Bitte das Datum eintragen.')
      if (type.kind === 'dokument' && !m.until) return toast('Bitte das Ablaufdatum eintragen.')
      if (m.until && m.until < m.date) return toast('„Gültig bis“ liegt vor dem Datum.')
      doc().records.push({ id: uid('u'), empId: m.empId, typeId: type.id, date: m.date, until: m.until || '', note: (m.note || '').trim(), by: by(), at: nowIso() })
      persist()
      closeModal()
      renderNow()
      const s = statusOf({ type, emp: empOf(m.empId), records: doc().records, today: todayISO() })
      toast(`${type.name} für ${empName(m.empId)} eingetragen${s.until ? `, gültig bis ${short(s.until)}` : ''}.`)
    },
    'tr-record-delete': (el) => {
      if (!confirmStep(`tr-del:${el.dataset.id}`, renderModal)) return
      doc().records = doc().records.filter((r) => r.id !== el.dataset.id)
      persist()
      renderModal()
      renderNow()
    },
    // data-topic und data-participants (Kennungen mit Komma): z. B. aus Betriebsanweisung oder Maßnahme im Arbeitsschutz
    'tr-session-open': (el) => {
      clearSignatures('tr-sig-')
      const known = new Set(active().map((e) => e.id))
      openModal({
        type: 'tr-session',
        typeId: el.dataset.type || '',
        ...(el.dataset.topic ? { topic: el.dataset.topic } : {}),
        ...(el.dataset.participants ? { participants: el.dataset.participants.split(',').filter((id) => known.has(id)) } : {}),
      })
    },
    'ts-redraw': () => {
      readSession()
      renderModal()
    },
    'ts-pick': (el) => {
      const m = readSession()
      m.participants = el.dataset.v === 'all' ? active().map((e) => e.id) : el.dataset.v === 'none' ? [] : due(m.typeId)
      renderModal()
    },
    'ts-save': async () => {
      const m = readSession()
      const type = typeOf(m.typeId)
      if (!type) return toast('Bitte die Art wählen.')
      if (!m.participants.length) return toast('Bitte mindestens eine Person ankreuzen.')
      if (!m.trainer.trim()) return toast('Bitte eintragen, wer unterwiesen hat.')
      const session = { id: uid('s'), typeId: type.id, date: m.date, topic: m.topic.trim(), trainer: m.trainer.trim(), place: m.place.trim(), participants: [...m.participants], by: by(), at: nowIso() }
      const signatures = m.sign ? Object.fromEntries(m.participants.map((id) => [id, signatureSvg(`tr-sig-${id}`)]).filter(([, svg]) => svg)) : {}
      doc().sessions.push(session)
      doc().records.push(...sessionRecords(session, type, { newId: () => uid('u'), at: nowIso(), by: by(), signatures }))
      persist()
      if (m.pdf) download(sessionPdfName(session, type), await sessionPdf(session, signatures))
      clearSignatures('tr-sig-')
      closeModal()
      renderNow()
      const missing = m.sign ? m.participants.length - Object.keys(signatures).length : 0
      toast(`${type.name} für ${plural(m.participants.length, 'Person', 'Personen')} eingetragen${m.sign ? (missing ? `; ${missing} ohne Unterschrift` : ', alle unterschrieben') : ''}.`)
    },
    'tr-types-open': () => openModal({ type: 'tr-types' }),
    'tt-add': () => {
      readTypes().push({ id: uid('t'), name: 'Neue Art', months: 12, who: 'optional', kind: 'unterweisung', law: '', active: true })
      renderModal()
    },
    'tt-save': () => {
      const rows = readTypes()
      if (rows.some((t) => !t.name)) return toast('Jede Art braucht einen Namen.')
      ownTypes()
      doc().types = rows
      persist()
      closeModal()
      renderNow()
      toast('Arten gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'unterweisungen',
  module: MODULE,
  title: 'Unterweisungen & Fristen',
  compute: (today) => {
    const due = dueList({ doc: doc(), employees: app.data.employees, today })
    const out = []
    // Dokumente, die den Einsatz sperren: je Person (auch bald ablaufend)
    for (const d of due.filter((x) => x.type.blocking)) out.push({ id: `p:${d.emp.id}:${d.type.id}:${d.until}:${d.state}`, kind: 'person', ...d })
    // sonst je Art gesammelt (nur abgelaufen oder fehlend)
    const byType = new Map()
    for (const d of due.filter((x) => !x.type.blocking && x.state !== 'bald')) byType.set(d.type.id, [...(byType.get(d.type.id) || []), d])
    for (const [typeId, list] of byType) out.push({ id: `t:${typeId}:${list.length}`, kind: 'type', type: list[0].type, list })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'person'
          ? `<div class="todo-item"><span class="flag ${x.state === 'bald' ? 'warning' : 'error'}">!</span><div class="todo-text"><strong>${esc(x.emp.name)}: ${esc(x.type.name)}</strong> ${x.state === 'bald' ? `läuft am ${short(x.until)} ab` : x.state === 'fehlt' ? 'fehlt' : `abgelaufen seit ${short(x.until)}`}<br><span class="muted">abgelaufen = im Plan nicht einteilbar</span></div><button class="btn small primary" data-action="tr-record-open" data-emp="${esc(x.emp.id)}" data-type="${esc(x.type.id)}">Eintragen</button></div>`
          : `<div class="todo-item"><span class="flag warning">${x.list.length}</span><div class="todo-text"><strong>${esc(x.type.name)}</strong>: ${esc(x.list.slice(0, 5).map((d) => d.emp.name).join(', '))}${x.list.length > 5 ? ' …' : ''}<br><span class="muted">abgelaufen oder fehlend</span></div><button class="btn small primary" data-action="tr-session-open" data-type="${esc(x.type.id)}">Unterweisung</button></div>`,
      )
      .join(''),
})
