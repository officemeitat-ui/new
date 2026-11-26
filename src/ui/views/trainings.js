// Unterweisungen & Fristen (Stammdaten): je Person Sicherheitsunterweisung, Unterweisung Reinigungsmittel,
// Erste-Hilfe-Auffrischung, Führerscheinkontrolle, Aufenthaltstitel … mit Ampel; Unterweisung für viele auf
// einmal mit Teilnehmerliste, Unterschrift am Tablet und Nachweis als PDF; Arten einstellbar.
// Datei unterweisungen/unterweisungen.json (Rechenkern: core/trainings.js). Die Prüfregel „Fristen je Person“
// im Plan liest dieselbe Datei.

import { formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import { addImported, dueList, emptyTrainings, openRequest, requestText, isRequired, KINDS, matrix, parseRecordTable, sessionRecords, STATE_TEXT, statusOf, TRAINING_DEFAULTS, typesOf, untilOf, addMonths } from '../../core/trainings.js'
import { hashIndex, sha256Hex } from '../../core/staffplan.js'
import { langInfo, langOf, sourceKey } from '../../core/sprachen.js'
import { DECL_DEFAULT, LANG_IDS, languageStatus, onlineOf, onlineTypes, onlineVersion, parseContent, parseQuiz, passCount, resultRecords, snapshot, webAssignments, webDefinition } from '../../core/unterweisung-online.js'
import { onlineProofDocument, onlineProofName, sessionDocument, sessionPdfName } from '../../export/training-pdf.js'
import { FORMULAR_VORLAGEN } from '../../core/formular-vorlagen.js'
import { portalSettings } from '../staffplan.js'
import { app, canEdit, closeModal, confirmStep, empName, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { clearImportUndo, importUndoBanner, recordImportUndo, setImportUndoLabel } from '../import-undo.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'
import { openWhatsApp } from '../whatsapp.js'

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
// Zustände, bei denen eine Aufforderung („bitte nachholen“) Sinn hat
const ASK_STATES = ['abgelaufen', 'fehlt', 'bald']
const company = () => app.config.brand?.name || ''
const VIA = { whatsapp: 'per WhatsApp', vermerk: 'vermerkt' }
/** Vorgeschlagener Inhalt einer Unterweisung: der gemerkte Text der Art, sonst ihr Hinweis. */
const contentOf = (type) => type?.content || type?.note || ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const skillsAll = () => [...new Set([...(app.data.skills || []), ...app.data.employees.flatMap((e) => e.skills || [])])].sort((a, b) => a.localeCompare(b, 'de'))

/** Vor dem ersten Ändern der Arten die Vorgaben in die Datei übernehmen. */
function ownTypes() {
  if (!doc().types.length) doc().types = structuredClone(TRAINING_DEFAULTS)
  return doc().types
}

// ---------------------------------------------------------------- Ansicht

function trainingsView() {
  syncOnline()
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
        const asked = ASK_STATES.includes(c.state) ? openRequest(doc(), r.emp.id, x.id) : null
        return `<td><button class="tr-cell pill ${CLS[c.state]}" data-action="tr-record-open" data-emp="${esc(r.emp.id)}" data-type="${esc(x.id)}" title="${esc(STATE_TEXT[c.state] + (asked ? ` · aufgefordert am ${short(asked.date)}` : ''))}">${esc(label)}</button>${asked ? `<br><small class="muted tr-asked">aufgefordert ${short(asked.date)}</small>` : ''}</td>`
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
          ed && { label: 'Aufforderungen senden', icon: ICON.chat, action: 'tr-ask-open', hint: 'wer etwas nachholen muss, per WhatsApp' },
          ed && { label: 'Aus Excel einfügen', icon: ICON.upload, action: 'tr-import-open', hint: 'bisherige Liste: Name und Datum' },
          ed && { label: 'Arten verwalten', icon: ICON.gear, action: 'tr-types-open', hint: 'Unterweisungen, Kurse, Fristen' },
          ed && { label: 'Unterweisung am Handy', icon: ICON.chat, action: 'uo-open', hint: 'lesen, Fragen, Unterschrift; jährlich' },
          { heading: 'Export' },
          { label: 'Übersicht (CSV)', icon: ICON.download, action: 'tr-csv', mail: true },
        ],
      })}</div></div>
    ${onlineBanner()}${importUndoBanner('trainings')}<div class="impact-stats tc-stats">${tile('abgelaufen', n('abgelaufen'), n('abgelaufen') ? 'err' : '')}${tile('fehlt (Pflicht)', n('fehlt'), n('fehlt') ? 'err' : '')}${tile('läuft in 30 Tagen ab', n('bald'))}${tile('Personen', all.length)}</div>
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

// Geöffnet aus einem anderen Dialog (z. B. der Checkliste „Eintritt & Austritt“: data-back-type="bew-list",
// data-back-id): nach dem Speichern geht es dorthin zurück statt zur Ansicht.
const backOf = (el) => (el?.dataset?.backType ? { back: { type: el.dataset.backType, id: el.dataset.backId || '' } } : {})
const backOrClose = (back) => (back?.type ? openModal({ type: back.type, id: back.id }) : closeModal())

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
      ${ed && emp && type && s && ASK_STATES.includes(s.state) ? `<section><h3>Aufforderung</h3>${askLine(emp, type)}<div class="actions">${askButtons(emp, type)}</div></section>` : ''}
      ${history.length ? `<section><h3>Bisher</h3><ul class="tc-list">${history.map((r) => `<li>${r.online ? `<button class="btn small" data-action="uo-pdf" data-id="${esc(r.id)}">Nachweis</button> ` : ''}${short(r.date)}${untilOf(r, type) ? ` · gültig bis ${short(untilOf(r, type))}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}${r.signature ? ' <span class="pill ok">unterschrieben</span>' : ''} <span class="muted">${esc(r.by || '')}</span>${ed ? ` <button class="btn small ghost" data-action="tr-record-delete" data-id="${esc(r.id)}">${app.ui.confirm === `tr-del:${r.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</li>`).join('')}</ul></section>` : ''}`,
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
    m.topic ??= contentOf(typeOf(m.typeId))
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
    m.topic = contentOf(typeOf(typeId))
    m.participants = due(typeId)
    m.typeId = typeId
  } else {
    m.topic = val('ts-topic')
    m.participants = checkedValues('ts-p')
  }
  Object.assign(m, { date: val('ts-date') || todayISO(), trainer: val('ts-trainer'), place: val('ts-place'), sign: checked('ts-sign'), pdf: checked('ts-pdf'), keep: checked('ts-keep') })
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
        <label class="field wide"><span>Inhalt</span><textarea id="ts-topic" rows="3" placeholder="Was unterwiesen wurde oder der Text, den die Teilnehmenden bestätigen (z. B. euer Sicherheitsblatt)">${esc(m.topic)}</textarea></label>
        <label class="check wide"><input type="checkbox" id="ts-keep" ${m.keep ? 'checked' : ''}><span>Inhalt als Standard für diese Art merken</span></label>
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
      <td><input type="text" id="tt-law-${i}" value="${esc(t.law || '')}" aria-label="Grundlage"></td><td><input type="url" id="tt-link-${i}" value="${esc(t.link || '')}" placeholder="https://…" aria-label="Link zu Video oder Unterlagen"></td><td><label class="check"><input type="checkbox" id="tt-block-${i}" ${t.blocking ? 'checked' : ''}><span>sperrt</span></label></td>
      <td><label class="check"><input type="checkbox" id="tt-active-${i}" ${t.active !== false ? 'checked' : ''}><span>aktiv</span></label></td></tr>`)
    .join('')
  return modalFrame({
    title: 'Arten von Unterweisungen und Fristen',
    wide: true,
    body: `<div class="table-wrap"><table class="data tr-types"><thead><tr><th>Name</th><th>gültig (Monate)</th><th>Pflicht</th><th>Art</th><th>Grundlage</th><th>Link (Video, Unterlagen)</th><th>Plan</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><button class="btn small" data-action="tt-add">${ICON.plus} Art</button></p>
      <p class="note">0 Monate = kein automatischer Ablauf (z. B. Aufenthaltstitel: Ablaufdatum beim Eintragen). „sperrt“: abgelaufen = Fehler im Plan (Person darf nicht eingeteilt werden). Pflicht mit Qualifikation: Warnung im Plan, wenn ein Einsatz diese Qualifikation verlangt und die Frist abgelaufen ist. Nicht mehr nötige Arten auf „aktiv“ aus, damit die Einträge erhalten bleiben. Der Link (z. B. zum Sicherheitsvideo) steht in der Aufforderung per WhatsApp.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="tt-save">Speichern</button></div>`,
  })
}
registerModal('tr-types', typesModal, { module: MODULE })

function readTypes() {
  const m = app.ui.modal
  m.rows = m.rows.map((t, i) => ({ ...t, name: val(`tt-name-${i}`).trim(), months: Math.max(0, Math.round(Number(val(`tt-months-${i}`)) || 0)), who: val(`tt-who-${i}`), kind: val(`tt-kind-${i}`), law: val(`tt-law-${i}`).trim(), link: val(`tt-link-${i}`).trim(), blocking: checked(`tt-block-${i}`), active: checked(`tt-active-${i}`) }))
  return m.rows
}

// ---------------------------------------------------------------- Aufforderung („bitte nachholen“)

function askLine(emp, type) {
  const q = openRequest(doc(), emp.id, type.id)
  return q ? `<p>Aufgefordert am ${short(q.date)} (${esc(VIA[q.via] || q.via || '')}${q.by ? `, ${esc(q.by)}` : ''}).</p>` : '<p class="muted">Noch nicht aufgefordert.</p>'
}
const askButtons = (emp, type) =>
  `<button class="btn small" data-action="tr-ask-wa" data-emp="${esc(emp.id)}" data-type="${esc(type.id)}" title="${esc(emp.phone ? `Per WhatsApp an ${emp.phone}` : 'Per WhatsApp – den Kontakt in WhatsApp wählen')}">${ICON.chat} Per WhatsApp auffordern</button><button class="btn small" data-action="tr-ask-note" data-emp="${esc(emp.id)}" data-type="${esc(type.id)}" title="Wenn du die Person schon anders erinnert hast (Anruf, persönlich)">Nur vermerken</button>`

function addRequest(emp, type, via) {
  const d = doc()
  d.requests = [...(d.requests || []), { id: uid('q'), empId: emp.id, typeId: type.id, date: todayISO(), via, by: by(), at: nowIso() }]
  persist()
}

function askModal() {
  const m = app.ui.modal
  const today = todayISO()
  const list = dueList({ doc: doc(), employees: app.data.employees, today })
  const count = (id) => list.filter((d) => d.type.id === id).length
  const withNeed = types().filter((t) => count(t.id))
  m.typeId ||= (withNeed.find((t) => t.id === 'sicherheit') || withNeed[0] || types()[0])?.id || ''
  const type = typeOf(m.typeId)
  const rows = list
    .filter((d) => d.type.id === m.typeId)
    .sort((a, b) => a.emp.name.localeCompare(b.emp.name, 'de'))
    .map((d) => {
      const q = openRequest(doc(), d.emp.id, d.type.id)
      const stand = d.state === 'fehlt' ? 'fehlt' : d.state === 'bald' ? `läuft am ${short(d.until)} ab` : `abgelaufen seit ${short(d.until)}`
      return `<tr><td><strong>${esc(d.emp.name)}</strong>${d.emp.phone ? '' : '<br><small class="muted">keine Handynummer</small>'}</td><td><span class="pill ${CLS[d.state]}">${esc(stand)}</span></td><td>${q ? `${short(q.date)}<br><small class="muted">${esc(VIA[q.via] || '')}</small>` : '<span class="muted">–</span>'}</td><td class="send-acts">${askButtons(d.emp, d.type)}</td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Aufforderungen senden',
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Art</span><select id="ta-type" data-change="tr-ask-type">${options(types().map((t) => [t.id, `${t.name} (${count(t.id)})`]), m.typeId)}</select></label></div>
      ${type && !type.link && (type.kind || 'unterweisung') !== 'dokument' && type.kind !== 'kontrolle' ? '<p class="note">Tipp: unter „Arten verwalten“ den Link zum Video oder zu den Unterlagen eintragen, dann steht er in der Nachricht.</p>' : ''}
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Stand</th><th>aufgefordert</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Bei dieser Art hat niemand Bedarf.</p>'}
      <p class="note">„Per WhatsApp auffordern“ öffnet WhatsApp mit dem fertigen Text (mit Handynummer im Stammblatt gleich beim Kontakt) und merkt das Datum. Senden tippst du selbst. Sobald die Unterweisung eingetragen ist, gilt die Aufforderung als erledigt.</p>`,
    foot: '<button class="btn" data-action="close-modal">Schließen</button>',
  })
}
registerModal('tr-ask', askModal, { module: MODULE })

// ---------------------------------------------------------------- Aus Excel einfügen (bisherige Liste)

function importModal() {
  const m = app.ui.modal
  m.typeId ||= (types().find((t) => t.id === 'sicherheit') || types()[0])?.id || ''
  const r = m.result
  const list = (names) => esc(names.slice(0, 12).join(', ')) + (names.length > 12 ? ' …' : '')
  const preview = r
    ? `<section><h3>Vorschau</h3>${r.errors.length ? `<p class="err-text">${esc(r.errors.join(' '))}</p>` : ''}
      ${r.items.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Datum</th><th>gültig bis</th><th>Notiz</th></tr></thead><tbody>${r.items.map((x) => `<tr><td>${esc(x.name)}${x.written ? ` <span class="pill warning" title="In der Liste anders geschrieben">in der Liste: ${esc(x.written)}</span>` : ''}</td><td>${short(x.date)}</td><td>${x.until ? short(x.until) : '<span class="muted">nach Art</span>'}</td><td>${esc([x.by ? `durchgeführt von ${x.by}` : '', x.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${r.unknown.length ? `<p class="note"><strong>Nicht gefunden (${r.unknown.length}):</strong> ${list(r.unknown)} – Name wie unter „Mitarbeitende“ schreiben oder die Person zuerst anlegen.</p>` : ''}
      ${r.noDate.length ? `<p class="note"><strong>Ohne Datum (${r.noDate.length}):</strong> ${list(r.noDate)} – bleiben bei „fehlt“; am besten gleich „Unterweisung durchführen“.</p>` : ''}</section>`
    : ''
  return modalFrame({
    title: 'Unterweisungen aus Excel einfügen',
    wide: true,
    body: `<p class="note">In Excel die Zeilen samt Überschrift markieren, kopieren und hier einfügen. Gebraucht werden die Spalten „Name“ und „Datum“ (auch „Zertifikat …“); „Gültig bis“, „Durchgeführt von“ und „Notiz“ werden mitgenommen. Ohne „Gültig bis“ gilt die Gültigkeit der Art. Leicht anders geschriebene Namen ordnet die App zu und zeigt es gelb – bitte kurz prüfen.</p>
      <div class="form-grid"><label class="field"><span>Art</span><select id="ti-type">${options(types().map((t) => [t.id, t.name]), m.typeId)}</select></label></div>
      <label class="field"><span>Tabelle</span><textarea id="ti-text" rows="8" placeholder="Name&#9;Datum&#9;Durchgeführt von">${esc(m.text || '')}</textarea></label>
      ${preview}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="ti-check">Prüfen</button>${r?.items.length ? `<button class="btn primary" data-action="ti-save">Übernehmen (${r.items.length})</button>` : ''}</div>`,
  })
}
registerModal('tr-import', importModal, { module: MODULE })

function readImport() {
  const m = app.ui.modal
  m.typeId = val('ti-type') || m.typeId
  const text = val('ti-text')
  if (text !== m.text) m.result = null
  m.text = text
  return m
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
  'tr-record-open': (el) => openModal({ type: 'tr-record', empId: el.dataset.emp || '', typeId: el.dataset.type || '', ...backOf(el) }),
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
      backOrClose(m.back)
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
        ...backOf(el),
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
      // Standard-Inhalt der Art (z. B. der Text des bisherigen Sicherheitsblatts): steht beim nächsten Mal schon da
      if (m.keep && session.topic) {
        const own = ownTypes().find((t) => t.id === type.id)
        if (own) own.content = session.topic
      }
      doc().sessions.push(session)
      doc().records.push(...sessionRecords(session, type, { newId: () => uid('u'), at: nowIso(), by: by(), signatures }))
      persist()
      // erst schließen, dann das PDF: scheitert es (ohne Netz), bliebe der Dialog offen und ein zweiter Klick trüge doppelt ein
      clearSignatures('tr-sig-')
      backOrClose(m.back)
      renderNow()
      const missing = m.sign ? m.participants.length - Object.keys(signatures).length : 0
      const done = `${type.name} für ${plural(m.participants.length, 'Person', 'Personen')} eingetragen${m.sign ? (missing ? `; ${missing} ohne Unterschrift` : ', alle unterschrieben') : ''}.`
      try {
        if (m.pdf) download(sessionPdfName(session, type), await sessionPdf(session, signatures))
        toast(done)
      } catch (err) {
        toast(`${done} Das PDF ging nicht (${err.message}): später unter „Letzte Unterweisungen“ → „Nachweis“.`)
      }
    },
    'tr-ask-open': () => openModal({ type: 'tr-ask' }),
    'tr-ask-type': () => {
      app.ui.modal.typeId = val('ta-type')
      renderModal()
    },
    'tr-ask-wa': (el) => {
      const emp = empOf(el.dataset.emp)
      const type = typeOf(el.dataset.type)
      if (!emp || !type) return
      if (app.ui.modal?.type === 'tr-record') readRecord()
      const status = statusOf({ type, emp, records: doc().records, today: todayISO() })
      if (!openWhatsApp({ kind: 'unterweisung', phone: emp.phone || '', text: requestText({ type, emp, status, company: company() }) })) return
      addRequest(emp, type, 'whatsapp')
      renderModal()
      renderNow()
      toast(`Aufforderung für ${emp.name} vermerkt – in WhatsApp noch senden.`)
    },
    'tr-ask-note': (el) => {
      const emp = empOf(el.dataset.emp)
      const type = typeOf(el.dataset.type)
      if (!emp || !type) return
      if (app.ui.modal?.type === 'tr-record') readRecord()
      addRequest(emp, type, 'vermerk')
      renderModal()
      renderNow()
      toast(`${emp.name}: als aufgefordert vermerkt.`)
    },
    'tr-import-open': () => openModal({ type: 'tr-import' }),
    'ti-check': () => {
      const m = readImport()
      m.result = parseRecordTable(m.text, { employees: active() })
      if (!m.result.items.length && !m.result.errors.length && !m.result.unknown.length && !m.result.noDate.length) m.result.errors.push('Keine Zeilen gefunden.')
      renderModal()
    },
    'ti-save': () => {
      const m = readImport()
      const type = typeOf(m.typeId)
      if (!type) return toast('Bitte die Art wählen.')
      const r = (m.result ||= parseRecordTable(m.text, { employees: active() }))
      if (!r.items.length) return toast('Nichts zu übernehmen – bitte zuerst „Prüfen“.')
      const d = doc()
      recordImportUndo('trainings', ['unterweisungen'])
      const res = addImported(d.records, r.items, type.id, { newId: () => uid('u'), at: nowIso(), by: by() })
      d.records = res.records
      if (res.added) setImportUndoLabel(`${type.name}: ${plural(res.added, 'Eintrag', 'Einträge')}`)
      else clearImportUndo()
      persist()
      closeModal()
      renderNow()
      toast(`${type.name}: ${plural(res.added, 'Eintrag', 'Einträge')} übernommen${res.skipped ? `, ${res.skipped} ${res.skipped === 1 ? 'war' : 'waren'} schon da` : ''}.`)
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

// ---------------------------------------------------------------- Unterweisung am Handy (unterweisung.php)
// Je Art: Texte je Sprache (Vorlage Gebäudereinigung Österreich), Verständnisfragen, Erklärung, Video. Die App überträgt
// Arten und Zuordnung (wer fällig ist) an den Webspace, holt die Ergebnisse ab und trägt sie als Nachweis ein.
// Rechenkern: core/unterweisung-online.js, Seite: unterweisung.php.

const OS = { at: 0, running: false, error: '', last: null, missing: [] }
const portalOn = () => {
  const p = portalSettings()
  return !!(p.enabled && p.key)
}
const CHUNK = 4 * 1024 * 1024

/** Aufruf von unterweisung.php mit dem Schlüssel von „Plan am Handy“; raw: Rohdaten (Video). */
async function uwCall(aktion, body, { raw = null, type = '', extra = '' } = {}) {
  const post = body !== undefined || raw
  const res = await fetch(`unterweisung.php?aktion=${aktion}${extra}`, {
    method: post ? 'POST' : 'GET',
    headers: {
      'X-Schluessel': portalSettings().key,
      ...(raw ? { 'Content-Type': type } : post ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw || (body === undefined ? undefined : JSON.stringify(body)),
    cache: 'no-store',
  })
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  if (!json) throw new Error('unterweisung.php fehlt am Webspace (Paket neu hochladen).')
  if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: unter „Plan am Handy“ mitarbeiter.json neu hochladen.')
  if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
  return json
}

/** Fassungen, die weder ein Eintrag braucht noch gerade gilt, nach 3 Tagen weg (sie sind groß). */
function pruneVersions(d) {
  const keep = new Set([...d.records.map((r) => r.online?.version).filter(Boolean), ...onlineTypes(d).map(onlineVersion)])
  const limit = new Date(Date.now() - 3 * 86400e3).toISOString()
  for (const [v, x] of Object.entries(d.versions || {})) if (!keep.has(v) && (x.at || '') < limit) delete d.versions[v]
}

/**
 * Ergebnisse vom Webspace eintragen, dann Arten, Zuordnung und Namen übertragen (übernommene Ergebnisse löscht der Webspace).
 * Höchstens alle 3 Minuten, force: sofort. Liefert { eingetragen, arten, personen, push, videosFehlen } oder null.
 */
export async function syncOnline({ force = false } = {}) {
  const d = doc()
  if (!editable() || OS.running || !portalOn() || (!force && Date.now() - OS.at < 170e3)) return null
  const types = onlineTypes(d)
  if (!types.length && !d.onlineSent && !force) return null
  OS.running = true
  OS.at = Date.now()
  let added = 0
  try {
    const p = portalSettings()
    const [st, index] = await Promise.all([uwCall('status'), hashIndex(p)])
    const r = resultRecords(d, st.ergebnisse || [], {
      empOf: (h) => empOf(index.get(h)),
      newId: () => uid('u'),
      types: typesOf(d),
    })
    d.versions ||= {}
    for (const t of types) d.versions[onlineVersion(t)] ||= snapshot(t, { at: nowIso() })
    if (r.records.length) d.records.push(...r.records)
    added = r.records.filter((x) => !x.online?.coveredBy).length
    pruneVersions(d)
    const hashes = new Map()
    for (const e of active()) if (p.codes?.[e.id]) hashes.set(e.id, await sha256Hex(p.codes[e.id]))
    const personen = webAssignments({
      doc: d,
      employees: app.data.employees,
      hashOf: (id) => hashes.get(id) || null,
      today: todayISO(),
    })
    const namen = [...hashes]
      .filter(([, h]) => personen[h])
      .map(([id, h]) => ({
        hash: h,
        name: empOf(id)?.name || '',
        ntfy: p.topics?.[id] || '',
        sprache: langOf(empOf(id)),
      }))
    const res = await uwCall('uebertragen', {
      arten: types.map((t) => webDefinition(t, { types: typesOf(d) })),
      personen,
      namen,
      uebernommen: r.taken,
    })
    d.onlineSent = types.length > 0
    persist()
    OS.last = {
      eingetragen: added,
      arten: res.arten,
      personen: res.personen,
      push: res.push || 0,
      at: Date.now(),
    }
    OS.missing = res.videosFehlen || []
    OS.error = ''
  } catch (err) {
    OS.error = err.message || String(err)
  } finally {
    OS.running = false
  }
  if (added && app.ui.view === 'unterweisungen' && !app.ui.modal) renderNow()
  return OS.last
}

function onlineBanner() {
  if (!onlineTypes(doc()).length) return ''
  if (!portalOn()) return '<div class="banner warn-banner"><p><strong>Unterweisung am Handy:</strong> „Plan am Handy“ ist aus. Ohne persönlichen Link sehen Mitarbeitende die Unterweisung nicht.</p></div>'
  if (OS.error) return `<div class="banner warn-banner"><p><strong>Unterweisung am Handy:</strong> ${esc(OS.error)}</p></div>`
  if (OS.missing.length) return '<div class="banner warn-banner"><p><strong>Unterweisung am Handy:</strong> Ein Video fehlt am Webspace. Bitte unter „Unterweisung am Handy“ das Video neu wählen und speichern.</p></div>'
  return ''
}

// Editor: m = { typeId, draft, lang, video (gewählte Datei), progress }
function draftOf(m) {
  if (!m.draft) {
    const type = typeOf(m.typeId)
    m.draft = structuredClone(onlineOf(type))
    m.lang = 'de'
  }
  return m.draft
}

function readOnline() {
  const m = app.ui.modal
  const d = draftOf(m)
  if (!document.getElementById('uo-content')) return m
  d.on = checked('uo-on')
  d.pass = Math.min(100, Math.max(0, Math.round(Number(val('uo-pass')) || 0)))
  d.videoLink = val('uo-link').trim()
  d.covers = checkedValues('uo-cover')
  d.texts[m.lang] = {
    title: val('uo-title').trim(),
    content: val('uo-content'),
    quiz: val('uo-quiz'),
    decl: val('uo-decl').trim(),
  }
  if (!d.texts[m.lang].content.trim() && !d.texts[m.lang].quiz.trim() && m.lang !== 'de') delete d.texts[m.lang]
  const f = document.getElementById('uo-video')?.files?.[0]
  if (f) m.video = f
  return m
}

function onlineListModal() {
  const list = types().filter((t) => (t.kind || 'unterweisung') !== 'dokument')
  const rows = list
    .map((t) => {
      const o = onlineOf(t)
      const st = languageStatus(o)
      const q = parseQuiz(o.texts.de?.quiz).questions.length
      const langs = st.filter((x) => x.ok).map((x) => langInfo(x.id).label)
      return `<tr><td><strong>${esc(t.name)}</strong>${t.law ? `<br><span class="muted">${esc(t.law)}</span>` : ''}</td>
        <td>${o.on && st[0].ok ? '<span class="pill ok">am Handy</span>' : '<span class="pill">aus</span>'}</td>
        <td>${st[0].ok ? `${esc(langs.join(', '))}<br><span class="muted">${plural(q, 'Frage', 'Fragen')}${o.video?.name ? ' · Video' : o.videoLink ? ' · Video-Link' : ''}</span>` : '<span class="muted">noch kein Inhalt</span>'}</td>
        <td class="actions-cell"><button class="btn small" data-action="uo-edit" data-type="${esc(t.id)}">Bearbeiten</button></td></tr>`
    })
    .join('')
  const last = OS.last
    ? `Zuletzt abgeglichen um ${new Date(OS.last.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}: ${plural(OS.last.personen || 0, 'Person', 'Personen')} mit Unterweisung am Handy${OS.last.eingetragen ? `, ${OS.last.eingetragen} neu eingetragen` : ''}${OS.last.push ? `, ${plural(OS.last.push, 'Erinnerung', 'Erinnerungen')} per Push` : ''}.`
    : ''
  return modalFrame({
    title: 'Unterweisung am Handy',
    wide: true,
    body: `<p class="note">Mitarbeitende öffnen die Unterweisung über ihren persönlichen Link („Plan am Handy“), lesen sie in ihrer Sprache, sehen optional ein Video, beantworten Verständnisfragen und unterschreiben mit dem Finger. Fällig ist sie wie hier eingestellt: beim Eintritt (fehlt) und nach Ablauf, z. B. jährlich. Die Ergebnisse kommen von selbst als Nachweis in die Liste (mit Unterschrift und PDF).</p>
      ${!portalOn() ? '<div class="banner warn-banner"><p>„Plan am Handy“ ist aus bzw. nicht eingerichtet (Mitarbeitende → Plan am Handy). Ohne persönlichen Link sehen Mitarbeitende nichts.</p></div>' : ''}
      ${OS.error ? `<div class="banner warn-banner"><p>${esc(OS.error)}</p></div>` : ''}
      <div class="table-wrap"><table class="data"><thead><tr><th>Art</th><th>Stand</th><th>Inhalt</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${last ? `<p class="muted">${esc(last)}</p>` : ''}
      <p class="note">Rechtlich (§ 14 ASchG): Die Unterweisung muss verständlich sein (bei Bedarf in der Muttersprache), in der Arbeitszeit stattfinden und nachweislich erfolgen. Am Handy ist sie eine schriftliche Unterweisung; laut Arbeitsinspektion ergänzt sie die persönliche Unterweisung am Arbeitsplatz (Einschulung im Objekt), ersetzt sie aber nicht. Den Inhalt mit eurer Evaluierung und der Sicherheitsfachkraft abstimmen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${editable() ? FORMULAR_VORLAGEN.filter((f) => !types().some((t) => t.id === f.id)).map((f) => `<button class="btn" data-action="uo-form-add" data-tpl="${esc(f.id)}">${ICON.plus} ${esc(f.name)}</button>`).join('') : ''}${portalOn() ? '<button class="btn" data-action="uo-sync">Jetzt abgleichen</button>' : ''}</div>`,
  })
}
registerModal('tr-online', onlineListModal, { module: MODULE })

function onlineEditModal() {
  const m = app.ui.modal
  const type = typeOf(m.typeId)
  if (!type)
    return modalFrame({
      title: 'Unterweisung am Handy',
      body: '<p>Diese Art gibt es nicht mehr.</p>',
      foot: '<button class="btn" data-action="close-modal">Schließen</button>',
    })
  const d = draftOf(m)
  const st = languageStatus(d)
  const cur = st.find((x) => x.id === m.lang)
  const t = d.texts[m.lang] || {}
  const q = parseQuiz(d.texts.de?.quiz).questions.length
  const others = types().filter((x) => x.id !== type.id && (x.kind || 'unterweisung') !== 'dokument')
  const tabs = LANG_IDS.map((id) => {
    const x = st.find((s) => s.id === id)
    const mark = id === 'de' ? (x.ok ? '✓' : '!') : x.ok ? '✓' : d.texts[id] ? '!' : '–'
    return `<button type="button" class="btn small ${id === m.lang ? 'primary' : ''}" data-action="uo-lang" data-lang="${id}" aria-pressed="${id === m.lang}">${esc(langInfo(id).label)} ${mark}</button>`
  }).join(' ')
  return modalFrame({
    title: `Unterweisung am Handy: ${type.name}`,
    subtitle: `${plural(q, 'Frage', 'Fragen')} · gültig ${Number(type.months) > 0 ? `${type.months} Monate` : 'ohne Ablauf'}`,
    wide: true,
    body: `<label class="check"><input type="checkbox" id="uo-on" ${d.on ? 'checked' : ''}><span>Am Handy durchführen (über „Plan am Handy“)</span></label>
      <p><label class="field inline"><span>Vorlage</span><select id="uo-tpl">${options([['sicherheit', 'Sicherheitsunterweisung Gebäudereinigung & Facility (6 Sprachen, 15 Fragen)'], ...FORMULAR_VORLAGEN.map((f) => [f.id, `Formular: ${f.name}`])], m.tpl || (type.kind === 'formular' ? FORMULAR_VORLAGEN[0].id : 'sicherheit'))}</select></label> <button class="btn small" data-action="uo-template">${app.ui.confirm === 'uo-template' ? 'Eigene Texte ersetzen? Zum Bestätigen nochmals klicken' : 'Vorlage einsetzen'}</button> <span class="muted">danach an euren Betrieb anpassen</span></p>
      <div class="uo-tabs" role="group" aria-label="Sprache">${tabs}</div>
      ${m.lang !== 'de' ? `<p class="note">${esc(langInfo(m.lang).label)}: gleiche Fragen in derselben Reihenfolge wie auf Deutsch, die richtige Antwort an derselben Stelle. Leer lassen = die Person sieht Deutsch mit dem Hinweis, im Büro nachzufragen.</p>` : ''}
      <div class="form-grid">
        <label class="field wide"><span>Titel</span><input type="text" id="uo-title" value="${esc(t.title || '')}" placeholder="${esc(m.lang === 'de' ? type.name : d.texts.de?.title || type.name)}"></label>
        <label class="field wide"><span>Inhalt</span><textarea id="uo-content" rows="14" placeholder="Einleitung …&#10;&#10;## Überschrift eines Abschnitts&#10;- Punkt&#10;- Punkt">${esc(t.content || '')}</textarea><small class="muted">„## “ beginnt einen Abschnitt, „- “ ist ein Punkt einer Liste, Leerzeile = neuer Absatz.</small></label>
        <label class="field wide"><span>Verständnisfragen</span><textarea id="uo-quiz" rows="10" placeholder="? Frage&#10;+ richtige Antwort&#10;- falsche Antwort&#10;- falsche Antwort">${esc(m.lang === 'de' ? d.texts.de?.quiz || '' : t.quiz || '')}</textarea><small class="muted">„? “ Frage, „+ “ richtig (genau eine), „- “ falsch. Am Handy steht die Reihenfolge gemischt, die Lösung bleibt am Webspace.</small></label>
        <label class="field wide"><span>Erklärung zum Unterschreiben</span><textarea id="uo-decl" rows="3" placeholder="${esc(m.lang === 'de' ? DECL_DEFAULT : d.texts.de?.decl || DECL_DEFAULT)}">${esc(t.decl || '')}</textarea></label>
      </div>
      ${cur?.errors.length ? `<p class="err-text">${esc(cur.errors.slice(0, 6).join(' '))}</p>` : cur?.ok ? `<p class="muted">${esc(langInfo(m.lang).label)}: ${plural(cur.sections, 'Abschnitt', 'Abschnitte')}, ${plural(cur.questions, 'Frage', 'Fragen')}.</p>` : ''}
      <div class="form-grid">
        <label class="field"><span>Bestanden ab (% richtig)</span><input type="number" id="uo-pass" min="0" max="100" step="5" value="${esc(d.pass)}"><small class="muted">${q ? `${passCount(q, d.pass)} von ${q} Fragen` : 'ohne Fragen: gleich zur Unterschrift'}</small></label>
        <label class="field"><span>Video-Datei (MP4, optional)</span><input type="file" id="uo-video" accept="video/mp4,video/webm"><small class="muted">${d.video?.name ? `jetzt: ${esc(d.video.name)} (${Math.round((d.video.size || 0) / 1048576)} MB)` : 'wird am Webspace abgelegt, höchstens 400 MB'}${m.video ? ` · neu: ${esc(m.video.name)}` : ''}</small>${d.video?.name ? '<button type="button" class="btn small ghost" data-action="uo-video-del">Video entfernen</button>' : ''}</label>
        <label class="field"><span>oder Video-Link (https, optional)</span><input type="url" id="uo-link" value="${esc(d.videoLink || '')}" placeholder="https://…"><small class="muted">z. B. euer Video auf der Webseite; öffnet sich in einer neuen Seite</small></label>
      </div>
      ${others.length ? `<section><h3>Erledigt damit auch</h3><p class="muted">Wer diese Unterweisung am Handy macht, bekommt auch diese Einträge (gleiche Unterschrift):</p>${others.map((x) => `<label class="check"><input type="checkbox" name="uo-cover" value="${esc(x.id)}" ${(d.covers || []).includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</section>` : ''}
      ${m.progress ? `<p class="note" role="status">${esc(m.progress)}</p>` : ''}`,
    foot: `<button class="btn" data-action="uo-open">Zurück</button><div class="actions"><button class="btn primary" data-action="uo-save" ${m.progress ? 'disabled' : ''}>Speichern${portalOn() ? ' und übertragen' : ''}</button></div>`,
  })
}
registerModal('tr-online-edit', onlineEditModal, { module: MODULE })

/** Video in Teilen zu 4 MB an den Webspace; liefert die Angaben fürs Speichern. */
async function uploadVideo(typeId, file, onStep) {
  const type = file.type === 'video/webm' ? 'video/webm' : 'video/mp4'
  if (file.size > 400 * 1024 * 1024) throw new Error('Das Video ist größer als 400 MB.')
  const version = sourceKey(`${file.name}|${file.size}|${file.lastModified}|${Date.now()}`)
  const parts = Math.max(1, Math.ceil(file.size / CHUNK))
  for (let i = 0; i < parts; i++) {
    onStep(i, parts)
    await uwCall('video', undefined, {
      raw: file.slice(i * CHUNK, (i + 1) * CHUNK),
      type,
      extra: `&art=${encodeURIComponent(typeId)}&version=${version}&teil=${i}&teile=${parts}`,
    })
  }
  return { name: file.name, size: file.size, type, version }
}

registerActions(
  {
    'uo-edit': (el) => openModal({ type: 'tr-online-edit', typeId: el.dataset.type }),
    'uo-lang': (el) => {
      const m = readOnline()
      m.lang = el.dataset.lang
      renderModal()
    },
    'uo-template': async () => {
      const m = readOnline()
      const d = draftOf(m)
      if (Object.values(d.texts).some((t) => String(t?.content || '').trim()) && !confirmStep('uo-template', renderModal)) return
      m.tpl = val('uo-tpl') || 'sicherheit'
      const form = FORMULAR_VORLAGEN.find((f) => f.id === m.tpl)
      if (form) {
        d.texts = structuredClone(form.texts)
        d.on = true
        m.lang = 'de'
        renderModal()
        return toast(`Vorlage „${form.name}“ eingesetzt (ohne Fragen: lesen und unterschreiben). Bitte prüfen und speichern.`)
      }
      const { VORLAGE } = await import('../../core/unterweisung-vorlage.js')
      d.texts = structuredClone(VORLAGE)
      d.on = true
      if (!d.covers?.length)
        d.covers = types()
          .filter((t) => t.id === 'chemie' && t.id !== m.typeId)
          .map((t) => t.id)
      renderModal()
      toast('Vorlage eingesetzt (6 Sprachen). Bitte durchlesen, an euren Betrieb anpassen und speichern.')
    },
    // Formular aus der Vorlage als eigene Art: Diensthandy nur für Personen mit der Qualifikation „Diensthandy“
    'uo-form-add': (el) => {
      const f = FORMULAR_VORLAGEN.find((x) => x.id === el.dataset.tpl)
      if (!f || types().some((t) => t.id === f.id)) return
      ownTypes().push({ id: f.id, name: f.name, months: f.months, who: f.id === 'diensthandy' ? 'skill:Diensthandy' : 'alle', kind: 'formular', law: '', note: f.id === 'diensthandy' ? 'für alle mit der Qualifikation „Diensthandy“ (im Stammblatt)' : 'einmal unterschreiben', active: true, online: { on: true, texts: structuredClone(f.texts), pass: 0, videoLink: '', video: null, covers: [] } })
      persist()
      openModal({ type: 'tr-online-edit', typeId: f.id })
      toast(`„${f.name}“ angelegt: prüfen und „Speichern und übertragen“.`)
    },
    'uo-video-del': () => {
      const m = readOnline()
      draftOf(m).video = null
      m.video = null
      renderModal()
    },
    'uo-save': async () => {
      const m = readOnline()
      const d = draftOf(m)
      const st = languageStatus(d)
      if (d.on && !st[0].ok) return toast(`Deutsch: ${st[0].errors.join(' ') || 'Inhalt fehlt.'}`)
      const bad = st.filter((x) => x.id !== 'de' && d.texts[x.id] && !x.ok)
      if (d.videoLink && !/^https:\/\/\S+$/i.test(d.videoLink)) return toast('Der Video-Link muss mit https:// beginnen.')
      try {
        if (m.video) {
          if (!portalOn()) return toast('Für ein Video muss „Plan am Handy“ eingerichtet sein (Webspace).')
          d.video = await uploadVideo(m.typeId, m.video, (i, n) => {
            m.progress = `Video wird hochgeladen: Teil ${i + 1} von ${n} …`
            renderModal()
          })
          m.video = null
        }
      } catch (err) {
        m.progress = ''
        renderModal()
        return toast(`Video nicht hochgeladen: ${err.message}`)
      }
      m.progress = ''
      const own = ownTypes().find((t) => t.id === m.typeId)
      if (!own) return
      own.online = { ...d, changedAt: nowIso(), changedBy: by() }
      persist()
      openModal({ type: 'tr-online' })
      const r = portalOn() ? await syncOnline({ force: true }) : null
      renderModal()
      toast(
        `Gespeichert${r ? ` und übertragen (${plural(r.personen || 0, 'Person', 'Personen')})` : OS.error ? `, aber nicht übertragen: ${OS.error}` : ''}.${bad.length ? ` Nicht übernommen (Fragen passen nicht): ${bad.map((x) => langInfo(x.id).label).join(', ')}.` : ''}`,
      )
    },
    'uo-sync': async () => {
      const r = await syncOnline({ force: true })
      renderModal()
      renderNow()
      toast(r ? `Abgeglichen: ${plural(r.eingetragen || 0, 'Nachweis', 'Nachweise')} neu eingetragen.` : OS.error ? `Nicht abgeglichen: ${OS.error}` : 'Nichts abzugleichen.')
    },
  },
  { edit: MODULE },
)

registerActions({
  'uo-open': () => openModal({ type: 'tr-online' }),
  'uo-pdf': async (el) => {
    const r = doc().records.find((x) => x.id === el.dataset.id)
    if (!r?.online) return
    const type = typeOf(r.typeId) || {}
    const emp = empOf(r.empId) || {}
    const version = doc().versions?.[r.online.version] || null
    download(
      onlineProofName(r, type, emp),
      await pdfBlob(
        onlineProofDocument({
          record: r,
          type,
          emp,
          version,
          langLabel: (id) => langInfo(id).label,
          parseContent,
          parseQuiz,
          brand: app.config.brand || {},
          logo: await loadLogo().catch(() => null),
        }),
      ),
    )
  },
})
