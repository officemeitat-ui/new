// Vertrieb (eigenes Modul „vertrieb“, Kürzel vt-): der durchgehende Ablauf von der Anfrage bis zum Objekt und die
// Übersicht als Pipeline. Am PC Spalten mit Ziehen und Ablegen, am Handy eine Liste.
//  - Fall: Interessent (Kunde der Fakturierung mit Gruppe „Interessent“ oder Bestandskunde; ohne Recht auf die
//    Fakturierung nur die Angaben der Anfrage), Leistungsort, Quelle, erwarteter Umsatz, Wahrscheinlichkeit, nächster
//    Schritt mit Datum, verantwortliche Person, Verlauf.
//  - Besichtigung am Handy: Termin über die vorhandenen Termine (Outlook), Räume mit Art, Fläche, Belag, Häufigkeit und
//    Besonderheiten, Fotos (SharePoint vertrieb/fotos/, ohne Netz später hochgeladen) und Sprachnotiz (ui/speech.js).
//  - KI-Besichtigung (nur mit eingerichteter KI, wie „KI beim Erfassen“): Vorschlag für Räume und Leistungsverzeichnis
//    aus Sprachnotiz und Fotos als Freigabe-Karte; übernommen wird nur, was die Person anhakt.
//  - Kalkulation: ein Klick legt die Flächen in der vorhandenen Kalkulation an (kalkulation.json → cases[Fall]); Preis
//    und Stunden kommen zurück in den Fall. Angebot: Entwurf über die Fakturierung (abrechnungHooks, wie bei den
//    Anlagen), Leistungsverzeichnis als Beilage (source.beilage); der Stand des Angebots kommt zurück in den Fall.
//  - Assistent „Auftrag anlegen“: Kunde, Objekt, Dauerauftrag, Vertrag, Hinweis für die Disposition – jeder Schritt
//    einzeln, mit den Rechten der Person; fehlt ein Recht: Hinweis und Übergabe.
// Rechenkern: core/vertrieb.js; Leistungsverzeichnis als PDF: export/vertrieb-pdf.js. Geladen mit dem Paket des Büros.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { CALC_DEFAULTS, calcWage, FREQUENCIES } from '../../core/calculation.js'
import { followUpOf } from '../../core/fak-laeufe.js'
import { customerName, nextCustomerNo, parseNumber, round2, settingsOf, stateOf, totals } from '../../core/invoicing.js'
import { mergeRules } from '../../core/rules.js'
import { CLAUSES, contractProblems, contractStatus, NOTICE_UNITS, nextContractNo, TERMS } from '../../core/vertraege.js'
import {
  advanceTo,
  applyCalc,
  applyMove,
  BESICHTIGUNG_LIMITS,
  calcAreasFromRooms,
  calcFor,
  calcSummary,
  caseName,
  caseProblems,
  cleanRoom,
  contractFromCase,
  customerFromLead,
  dueCases,
  emptyVertrieb,
  expectedMonthly,
  firstMonth,
  FLOORS,
  floorLabel,
  isOpen,
  isProspect,
  LOST_REASONS,
  lvSnapshot,
  mergeRooms,
  moveCheck,
  nextCaseNo,
  objectFromCase,
  offerDraftFields,
  offerOfCase,
  offerSnapshot,
  OPEN_STAGES,
  planHint,
  probabilityOf,
  PROSPECT_GROUP,
  recurringFromOffer,
  RIGHT_TEXT,
  ROOM_TYPES,
  roomFreqLabel,
  roomTotals,
  roomTypeLabel,
  salesKpi,
  salesRights,
  siteAddress,
  SOIL,
  SOURCES,
  sourceLabel,
  STAGE_PROBABILITY,
  STAGES,
  stageLabel,
  stageOf,
  syncOffer,
  tasksOf,
  wizardSteps,
  workdayAfter,
} from '../../core/vertrieb.js'
import { lvDocument, lvPdfName } from '../../export/vertrieb-pdf.js'
import { ACTIONS, app, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { kixBox, kixButton, kixConsent, kixDictate, kixFailed, kixFile, kixListening, kixSet, kixSpeech } from '../kix.js'
import { openCompose } from '../mailer.js'
import { isMobile } from '../mobile.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, euro, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { onAppointmentSaved } from './appointments.js'
import { openFile, storeFile } from './anlagen.js'
import { abrechnungHooks } from './invoicing-abrechnung.js'
import { kpiHooks } from './lazy.js'

const MODULE = 'vertrieb'
const ICON_VT = '<path d="M3.5 4.5h17l-6.5 8v6l-4 1.5v-7.5z"/><path d="M8.5 8.5h7"/>'
const D = () => {
  const d = (app.data.vertrieb ||= emptyVertrieb())
  d.cases ||= []
  d.settings ||= {}
  return d
}
const R = () => salesRights(app.access)
const editable = () => R().edit && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const money = (n) => euro(round2(n))
const dec = (n, d = 1) => (Number(n) || 0).toLocaleString('de-AT', { maximumFractionDigits: d })
const numText = (v) => (v === '' || v === null || v === undefined ? '' : String(v).replace('.', ','))
/** Fakturierung, wenn die Rolle sie sehen darf (sonst null: dann zählen die Momentaufnahmen im Fall). */
const F = () => (R().fakView ? app.data.fakturierung || null : null)
const FS = () => settingsOf(F() || {})
const custOf = (id) => (id && F()?.customers?.find((c) => c.id === id)) || null
const caseOf = (id) => D().cases.find((c) => c.id === id)
const objOf = (id) => (app.data.objects || []).find((o) => o.id === id)
const nameOf = (c) => caseName(c, custOf(c.customerId))
const STAGE_CLS = { anfrage: '', besichtigung: 'info', besichtigt: 'info', kalkuliert: 'info', angebot: 'warning', angenommen: 'ok', abgelehnt: '' }
const OFFER_CLS = { entwurf: '', offen: 'info', angenommen: 'ok', abgelehnt: '', abgelaufen: 'warning' }
const OFFER_TEXT = { entwurf: 'Entwurf', offen: 'offen', angenommen: 'angenommen', abgelehnt: 'abgelehnt', abgelaufen: 'abgelaufen' }
const stagePill = (c) => `<span class="pill ${STAGE_CLS[stageOf(c)] || ''}">${esc(stageLabel(stageOf(c)))}</span>`

/** Fotos dieser Sitzung (für die KI und zum Öffnen ohne Netz): Pfad → Datei. */
const PHOTO_BLOBS = new Map()

/** Ein Fall ändert sich: in der Liste ersetzen, Bearbeiter und Zeit vermerken. */
function putCase(next) {
  const d = D()
  const i = d.cases.findIndex((c) => c.id === next.id)
  const out = { ...next, updatedAt: nowIso(), updatedBy: user() }
  if (i >= 0) d.cases[i] = out
  else d.cases.push(out)
  return out
}

// ---------------------------------------------------------------- Stand des Angebots (aus der Fakturierung)

/** Momentaufnahme des Angebots eines Falls (nur wer die Fakturierung sieht). */
function snapOf(c) {
  const f = F()
  if (!f) return c.offer || null
  const doc = offerOfCase(c, f.documents || [])
  if (!doc) return null
  const s = FS()
  return offerSnapshot(doc, { state: stateOf(doc, f.documents, todayISO(), s), net: (doc.total || totals(doc, s)).net, followUp: followUpOf(doc, s) })
}

/**
 * Stand der Angebote in die Fälle übernehmen (beim Zeichnen der Ansicht und vor dem Öffnen eines Falls): festgeschrieben
 * → „Angebot gesendet“, angenommen → „Angenommen“, abgelehnt → „Abgelehnt“. Nur mit Leserecht auf die Fakturierung und
 * Schreibrecht im Vertrieb; gespeichert wird nur, wenn sich etwas geändert hat.
 */
function syncOffers() {
  if (!F() || !editable()) return false
  let changed = false
  for (const c of D().cases) {
    const res = syncOffer(c, snapOf(c), { at: nowIso(), by: user() })
    if (!res.changed) continue
    putCase(res.case)
    changed = true
  }
  if (changed) persist()
  return changed
}

/**
 * Erinnert die Fakturierung schon an dieses Angebot („Angebote nachfassen“: offene Wiedervorlage bzw. Tage nach dem
 * Versand)? Dann nicht doppelt in „Zu erledigen“ – für alle, die die Fakturierung bearbeiten (sie sehen deren Erinnerung).
 */
const offerHandled = (c) => !!F() && !app.readOnly && (!app.access || app.access.canEdit('fakturierung')) && c.offer?.state === 'offen' && !!c.offer.followUp

// ---------------------------------------------------------------- Ansicht

const today = () => todayISO()
const dueOf = (c, t = today()) => !!c.next?.date && c.next.date <= t && isOpen(c) && !(stageOf(c) === 'angebot' && offerHandled(c))

function filtered() {
  const q = String(app.ui.vtSearch || '').trim().toLowerCase()
  const mine = app.ui.vtMine && app.user?.name
  const cutoff = addDays(today(), -60)
  return D()
    .cases.filter((c) => !q || [c.no, nameOf(c), c.title, siteAddress(c), c.site?.name, c.owner, sourceLabel(c.source)].join(' ').toLowerCase().includes(q))
    .filter((c) => !mine || String(c.owner || '').toLowerCase() === app.user.name.toLowerCase())
    .filter((c) => isOpen(c) || app.ui.vtOld || (c.wonAt || c.lostAt || '') >= cutoff)
}

function card(c, { drag = false } = {}) {
  const t = today()
  const due = dueOf(c, t)
  const value = expectedMonthly(c)
  const next = !isOpen(c) ? '' : stageOf(c) === 'angebot' && c.offer?.followUp && offerHandled(c) ? `Wiedervorlage ${short(c.offer.followUp)}` : c.next?.date || c.next?.text ? `${c.next.text || 'nächster Schritt'}${c.next.date ? `, ${short(c.next.date)}` : ''}` : ''
  const offer = c.offer?.id ? `<span class="pill ${OFFER_CLS[c.offer.state] || ''}">${esc(c.offer.number || 'Angebot')} ${esc(OFFER_TEXT[c.offer.state] || '')}</span>` : ''
  const moves = editable()
    ? menu({ icon: ICON.more, title: 'Stufe ändern', btn: 'small ghost icon', caret: false, cls: 'row-menu', items: [{ heading: 'Stufe ändern' }, ...STAGES.filter(([s]) => s !== stageOf(c)).map(([s, l]) => ({ label: esc(l), action: 'vt-move', data: { id: c.id, stage: s } }))] })
    : ''
  return `<li class="vt-card${due ? ' due' : ''}" data-case="${esc(c.id)}" ${drag && editable() ? 'draggable="true"' : ''}>
    <button class="vt-card-main" data-action="vt-open" data-id="${esc(c.id)}">
      <span class="vt-card-head"><small class="muted">${esc(c.no || '')}</small><strong>${esc(nameOf(c))}</strong></span>
      ${c.site?.name || siteAddress(c) ? `<span class="vt-card-line muted">${esc([c.site?.name, siteAddress(c)].filter(Boolean).join(', '))}</span>` : ''}
      <span class="vt-card-line">${value ? `${money(value)} je Monat · ` : ''}${probabilityOf(c)} %</span>
      ${next ? `<span class="vt-card-line ${due ? 'err-text' : 'muted'}">${due ? 'Fällig: ' : ''}${esc(next)}</span>` : ''}
      <span class="vt-card-tags">${c.owner ? `<span class="pill">${esc(c.owner)}</span>` : ''}${c.source ? `<span class="pill">${esc(sourceLabel(c.source))}</span>` : ''}${offer}${stageOf(c) === 'abgelehnt' && c.lostReason ? `<span class="pill">${esc(c.lostReason)}</span>` : ''}</span>
    </button>${moves}</li>`
}

function columnHtml(stage, list) {
  const sum = list.reduce((a, c) => a + expectedMonthly(c), 0)
  return `<section class="vt-col" data-stage="${esc(stage)}" aria-label="${esc(stageLabel(stage))}, ${plural(list.length, 'Fall', 'Fälle')}">
    <header class="vt-col-head"><h3>${esc(stageLabel(stage))}</h3><span class="muted">${list.length}${sum ? ` · ${money(sum)}` : ''}</span></header>
    <ul class="vt-cards" data-vt-drop="${esc(stage)}">${list.map((c) => card(c, { drag: true })).join('') || '<li class="vt-empty muted">–</li>'}</ul></section>`
}

const byNext = (a, b) => String(a.next?.date || '9999').localeCompare(String(b.next?.date || '9999')) || String(a.no).localeCompare(String(b.no))

function boardHtml(list) {
  const of = (s) => list.filter((c) => stageOf(c) === s).sort(byNext)
  const done = ['angenommen', 'abgelehnt']
  return `<div class="vt-board">${OPEN_STAGES.map((s) => columnHtml(s, of(s))).join('')}<div class="vt-col vt-col-done">${done
    .map((s) => {
      const l = of(s).sort((a, b) => String(b.wonAt || b.lostAt || '').localeCompare(String(a.wonAt || a.lostAt || '')))
      return `<section class="vt-done" data-stage="${s}" aria-label="${esc(stageLabel(s))}, ${plural(l.length, 'Fall', 'Fälle')}"><header class="vt-col-head"><h3>${esc(stageLabel(s))}</h3><span class="muted">${l.length}</span></header><ul class="vt-cards" data-vt-drop="${s}">${l.map((c) => card(c, { drag: true })).join('') || '<li class="vt-empty muted">–</li>'}</ul></section>`
    })
    .join('')}</div></div>`
}

function listHtml(list) {
  const pick = app.ui.vtStage || ''
  const groups = STAGES.filter(([s]) => !pick || s === pick)
    .map(([s, label]) => {
      const l = list.filter((c) => stageOf(c) === s).sort(byNext)
      return l.length ? `<section class="vt-group"><h3>${esc(label)} <span class="muted">${l.length}</span></h3><ul class="vt-cards">${l.map((c) => card(c)).join('')}</ul></section>` : ''
    })
    .join('')
  return `<div class="filters vt-mfilter"><label class="field"><span>Stufe</span><select id="vt-stage-filter" data-change="vt-stage-filter">${options(STAGES, pick, { empty: 'alle Stufen' })}</select></label></div>
    <div class="vt-list">${groups || '<p class="empty">Keine Fälle in dieser Auswahl.</p>'}</div>`
}

function vertriebView() {
  syncOffers()
  const t = today()
  const all = D().cases
  const list = filtered()
  const months = [-11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0].map((n) => {
    const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 + n, 1))
    const key = d.toISOString().slice(0, 7)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    return { key, from: `${key}-01`, to: last }
  })
  const k = memo(app.cur, `vt:kpi:${t}:${all.length}:${app.dataVersion || 0}`, () => salesKpi(all, months, t))
  const due = all.filter((c) => dueOf(c, t)).length
  const tile = (label, value, sub = '', cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
  const ed = editable()
  const head = `<div class="section-head"><div><h2>Vertrieb</h2><p>Von der Anfrage über die Besichtigung, Kalkulation und das Angebot bis zum Auftrag. Kunden, Angebote und Verträge bleiben in der Fakturierung, Flächen und Preise in der Kalkulation.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="vt-new">${ICON.plus} Anfrage</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [{ label: 'Liste (CSV)', icon: ICON.download, action: 'vt-csv', mail: true }, { label: app.ui.vtOld ? 'Nur letzte 60 Tage der Abschlüsse' : 'Alle Abschlüsse zeigen', action: 'vt-old' }],
    })}</div></div>`
  const stats = `<div class="impact-stats vt-stats">
    ${tile('Offene Fälle', String(k.pipeline.count), money(k.pipeline.value) + ' je Monat')}
    ${tile('Pipeline-Wert', money(k.pipeline.weighted), 'je Monat, gewichtet')}
    ${tile('Abschlussquote', k.rate === null ? '–' : `${dec(k.rate * 100, 0)} %`, `12 Monate: ${k.won} gewonnen, ${k.lost} verloren`)}
    ${tile('Anfrage bis Auftrag', k.days.avg === null ? '–' : `${dec(k.days.avg, 0)} Tage`, k.days.median === null ? 'noch kein Abschluss' : `Median ${dec(k.days.median, 0)} Tage`)}
    ${tile('Nächster Schritt fällig', String(due), due ? 'siehe „Zu erledigen“' : 'nichts fällig', due ? 'warning' : '')}</div>`
  const filters = `<div class="filters vt-filters"><label class="field"><span>Suche</span><input type="search" id="vt-search" value="${esc(app.ui.vtSearch || '')}" placeholder="Name, Nummer, Adresse, Person" data-input="vt-search"></label>
    ${app.user?.name ? `<label class="check"><input type="checkbox" id="vt-mine" data-change="vt-mine" ${app.ui.vtMine ? 'checked' : ''}><span>nur meine</span></label>` : ''}</div>`
  const body = !all.length ? `<p class="empty">Noch keine Anfragen. ${ed ? '„Anfrage“ legt den ersten Fall an.' : ''}</p>` : isMobile() ? listHtml(list) : boardHtml(list)
  return `<div class="vt-root">${head}${stats}${filters}${body}${!isMobile() && all.length && ed ? '<p class="note">Karten mit der Maus in eine andere Spalte ziehen; ohne Maus über „⋯“ an der Karte.</p>' : ''}</div>`
}

registerView({
  id: 'vertrieb',
  order: 71,
  label: 'Vertrieb',
  group: 'service',
  module: MODULE,
  icon: ICON_VT,
  noWeek: true,
  text: 'Anfragen, Besichtigung, Angebot bis zum Auftrag',
  badge: () => D().cases.filter((c) => dueOf(c)).length,
  render: vertriebView,
})

// ---------------------------------------------------------------- Ziehen und Ablegen (am PC)

let dragging = null
function bindDrag() {
  if (bindDrag.done || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  bindDrag.done = true
  const clear = () => document.querySelectorAll?.('.vt-cards.drop-on, .vt-card.dragging').forEach((el) => el.classList.remove('drop-on', 'dragging'))
  document.addEventListener('dragstart', (e) => {
    const li = e.target?.closest?.('.vt-card[draggable="true"]')
    if (!li) return
    dragging = li.dataset.case
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', dragging)
    li.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    if (!dragging) return
    const list = e.target?.closest?.('[data-vt-drop]')
    if (!list) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    document.querySelectorAll('.vt-cards.drop-on').forEach((el) => el !== list && el.classList.remove('drop-on'))
    list.classList.add('drop-on')
  })
  document.addEventListener('drop', (e) => {
    if (!dragging) return
    const list = e.target?.closest?.('[data-vt-drop]')
    if (!list) return
    e.preventDefault()
    const id = dragging
    dragging = null
    clear()
    moveCase(id, list.dataset.vtDrop)
  })
  document.addEventListener('dragend', () => {
    dragging = null
    clear()
  })
}
bindDrag()

/** Stufe wechseln (Ziehen, „⋯“): prüfen, bei „abgelehnt“ erst den Grund fragen. */
function moveCase(id, stage, { reason = '' } = {}) {
  const c = caseOf(id)
  if (!c || stageOf(c) === stage) return
  if (!editable()) return toast('Nur Leserechte: Änderungen sind für dein Konto nicht freigegeben.')
  if (stage === 'abgelehnt' && !reason) return openModal({ type: 'vt-lost', id })
  const chk = moveCheck(c, stage, { reason })
  if (!chk.ok) return toast(chk.errors[0])
  putCase(applyMove(c, stage, { at: nowIso(), by: user(), reason }))
  persist()
  renderNow()
  toast(`${c.no}: ${stageLabel(stage)}.${chk.warnings.length ? ` Hinweis: ${chk.warnings.join(' ')}` : ''}${stage === 'angenommen' ? ' Weiter mit „Auftrag anlegen“ im Fall.' : ''}`)
}

// ---------------------------------------------------------------- Dialog: Fall

const TABS = [
  ['fall', 'Fall'],
  ['besichtigung', 'Besichtigung'],
  ['angebot', 'Kalkulation & Angebot'],
  ['verlauf', 'Verlauf'],
]

function newCase() {
  const t = today()
  return { id: uid('vf'), no: nextCaseNo(D().cases, t.slice(0, 4)), stage: 'anfrage', requestDate: t, source: 'telefon', customerId: '', lead: {}, site: {}, title: '', monthly: '', next: { text: 'Besichtigung vereinbaren', date: workdayAfter(t, 1) }, owner: app.user?.name || '', visit: { rooms: [], photos: [] }, history: [] }
}

const ownerList = () => [...new Set([app.user?.name, ...D().cases.map((c) => c.owner)].filter(Boolean))]
const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`
const problemList = (list) => (list.length ? `<ul class="fak-problems" role="alert">${list.map((p) => `<li class="${p.level === 'error' ? 'err-text' : p.level === 'warn' || p.level === 'warning' ? 'warn-text' : 'muted'}">${esc(p.text)}</li>`).join('')}</ul>` : '')

function fallTab(v, dis) {
  const f = F()
  const r = R()
  const cust = custOf(v.customerId)
  const lead = v.lead || {}
  const custs = (f?.customers || []).slice().sort((a, b) => Number(isProspect(b)) - Number(isProspect(a)) || customerName(a).localeCompare(customerName(b), 'de'))
  const leadFields = `<div class="form-grid vt-lead">
      <label class="field"><span>Firma bzw. Name</span><input type="text" id="vtc-name" value="${esc(lead.name || '')}" autocomplete="organization" ${dis}></label>
      <label class="field"><span>Ansprechperson</span><input type="text" id="vtc-contact" value="${esc(lead.contact || '')}" ${dis}></label>
      <label class="field"><span>Telefon</span><input type="tel" id="vtc-phone" value="${esc(lead.phone || '')}" ${dis}></label>
      <label class="field"><span>E-Mail</span><input type="email" id="vtc-email" value="${esc(lead.email || '')}" ${dis}></label>
      <label class="field"><span>Straße</span><input type="text" id="vtc-street" value="${esc(lead.street || '')}" ${dis}></label>
      <label class="field"><span>PLZ</span><input type="text" id="vtc-zip" value="${esc(lead.zip || '')}" inputmode="numeric" ${dis}></label>
      <label class="field"><span>Ort</span><input type="text" id="vtc-city" value="${esc(lead.city || '')}" ${dis}></label>
      <label class="check"><input type="checkbox" id="vtc-consumer" ${lead.consumer ? 'checked' : ''} ${dis}><span>Verbraucher (privat)</span></label>
    </div>`
  const custBlock = f
    ? `<div class="form-grid"><label class="field wide"><span>Kunde der Fakturierung</span><select id="vtc-customer" data-change="vt-redraw" ${dis}>${options(
        custs.map((c) => [c.id, `${customerName(c)}${c.customerNo ? ` (${c.customerNo})` : ''}${isProspect(c) ? ' · Interessent' : ''}`]),
        v.customerId,
        { empty: '– neuer Interessent –' },
      )}</select></label></div>
      ${cust ? `<p class="note">${esc([cust.street, [cust.zip, cust.city].filter(Boolean).join(' '), cust.phone, cust.email].filter(Boolean).join(' · ') || 'Ohne Anschrift')}${isProspect(cust) ? ` · Gruppe „${PROSPECT_GROUP}“` : ''}</p>` : `${leadFields}${r.customer ? `<label class="check"><input type="checkbox" id="vtc-create" ${(v.createProspect ?? !caseOf(v.id)) ? 'checked' : ''} ${dis}><span>Beim Speichern als Kunde mit Gruppe „${PROSPECT_GROUP}“ in der Fakturierung anlegen</span></label>` : ''}`}`
    : `${leadFields}<p class="note">${v.customerId ? 'Der Interessent ist in der Fakturierung angelegt. ' : ''}Kunden und Interessenten der Fakturierung sieht, wer die Fakturierung hat.</p>`
  const objOpts = (app.data.objects || []).map((o) => [o.id, o.name])
  const nextNote = stageOf(v) !== 'angebot' || v.offer?.state !== 'offen' || !r.offer ? '' : v.offer.followUp ? `<p class="note">Solange das Angebot offen ist, erinnert „Angebote nachfassen“ der Fakturierung (Wiedervorlage am ${short(v.offer.followUp)}); hier kommt keine zweite Erinnerung.</p>` : '<p class="note">Das Angebot hat noch keine Wiedervorlage (nicht gesendet): Bis dahin erinnert der nächste Schritt hier; mit „Wiedervorlage“ im Reiter „Kalkulation &amp; Angebot“ übernimmt „Angebote nachfassen“ der Fakturierung.</p>'
  const stage = stageOf(v)
  return `<h3>Interessent</h3>${custBlock}
    <h3>Leistungsort</h3>
    <div class="form-grid">
      <label class="field"><span>Bezeichnung (Objekt)</span><input type="text" id="vtc-site" value="${esc(v.site?.name || '')}" placeholder="z. B. Büro Musterstraße" ${dis}></label>
      <label class="field"><span>Adresse</span><input type="text" id="vtc-address" value="${esc(v.site?.address || '')}" placeholder="${esc(siteAddress({ lead }) || 'Straße, PLZ Ort')}" ${dis}></label>
      ${objOpts.length ? `<label class="field"><span>Vorhandenes Objekt (Bestandskunde)</span><select id="vtc-object" ${dis}>${options(objOpts, v.objectId || '', { empty: '– noch keines –' })}</select></label>` : ''}
      <label class="field"><span>Betreff</span><input type="text" id="vtc-title" value="${esc(v.title || '')}" placeholder="z. B. Unterhaltsreinigung Büro" ${dis}></label>
    </div>
    <h3>Anfrage</h3>
    <div class="form-grid">
      <label class="field"><span>Stufe</span><select id="vtc-stage" data-toggle="vtstage" ${dis}>${options(STAGES, stage)}</select></label>
      <div class="field" data-vtstage="abgelehnt" ${stage === 'abgelehnt' ? '' : 'hidden'}><label class="field"><span>Grund</span><input type="text" id="vtc-lost" list="vtc-lost-list" value="${esc(v.lostReason || '')}" ${dis}></label>${datalist('vtc-lost-list', LOST_REASONS)}</div>
      <label class="field"><span>Quelle</span><select id="vtc-source" ${dis}>${options(SOURCES, v.source || '', { empty: '– offen –' })}</select></label>
      <label class="field"><span>Anfrage am</span><input type="date" id="vtc-date" value="${esc(v.requestDate || '')}" ${dis}></label>
      <label class="field"><span>Erwarteter Umsatz je Monat (netto, €)</span><input type="text" inputmode="decimal" id="vtc-monthly" value="${esc(numText(v.monthly))}" placeholder="${esc(v.calc?.net ? numText(v.calc.net) : 'z. B. 1200')}" ${dis}></label>
      <label class="field"><span>Wahrscheinlichkeit (%)</span><input type="number" id="vtc-prob" min="0" max="100" step="5" value="${esc(v.probability ?? '')}" placeholder="${esc(STAGE_PROBABILITY[stage])} (Vorgabe der Stufe)" ${dis}></label>
      <label class="field"><span>Verantwortlich</span><input type="text" id="vtc-owner" list="vtc-owner-list" value="${esc(v.owner || '')}" ${dis}></label>${datalist('vtc-owner-list', ownerList())}
    </div>
    <h3>Nächster Schritt</h3>
    <div class="form-grid">
      <label class="field wide"><span>Was</span><input type="text" id="vtc-next" value="${esc(v.next?.text || '')}" placeholder="z. B. Besichtigung vereinbaren, Angebot nachfassen" ${dis}></label>
      <label class="field"><span>Bis</span><input type="date" id="vtc-next-date" value="${esc(v.next?.date || '')}" ${dis}></label>
    </div>${nextNote}
    <label class="field wide"><span>Notiz</span><textarea id="vtc-note" rows="2" ${dis}>${esc(v.note || '')}</textarea></label>
    ${problemList(caseProblems(v).filter((p) => p.level !== 'error'))}`
}

function roomCard(r, i, dis) {
  const freqOpts = FREQUENCIES.map(([f, l]) => [String(f), l])
  return `<li class="vt-room${r.ki ? ' ki' : ''}">
    <div class="vt-room-head"><strong>${esc(r.name || `Bereich ${i + 1}`)}</strong>${r.ki ? '<span class="pill info">KI-Vorschlag, bitte prüfen</span>' : ''}${dis ? '' : `<button type="button" class="btn small ghost icon" data-action="vt-room-del" data-i="${i}" aria-label="Bereich ${esc(r.name || i + 1)} entfernen" title="Bereich entfernen">${ICON.trash}</button>`}</div>
    <div class="form-grid vt-room-grid">
      <label class="field"><span>Name</span><input type="text" id="vtr-name-${i}" value="${esc(r.name || '')}" placeholder="z. B. Büros 1. OG" ${dis}></label>
      <label class="field"><span>Art</span><select id="vtr-type-${i}" ${dis}>${options(Object.entries(ROOM_TYPES), r.type || 'buero')}</select></label>
      <label class="field"><span>Fläche m²</span><input type="text" inputmode="decimal" id="vtr-m2-${i}" value="${esc(numText(r.m2 || ''))}" ${dis}></label>
      <label class="field"><span>Bodenbelag</span><select id="vtr-floor-${i}" ${dis}>${options(Object.entries(FLOORS), r.floor || '', { empty: '– offen –' })}</select></label>
      <label class="field"><span>Häufigkeit</span><select id="vtr-freq-${i}" ${dis}>${options(freqOpts, r.perWeek ? String(FREQUENCIES.find(([f]) => Math.abs(f - r.perWeek) < 1e-6)?.[0] ?? '') : '', { empty: '– offen –' })}</select></label>
      <label class="field wide"><span>Besonderheiten</span><input type="text" id="vtr-notes-${i}" value="${esc(r.notes || '')}" placeholder="z. B. Glastüren, Zugang erst ab 17 Uhr" ${dis}></label>
      <label class="field wide"><span>Leistungen (mit Strichpunkt getrennt)</span><input type="text" id="vtr-tasks-${i}" value="${esc((r.tasks || []).join('; '))}" placeholder="${esc(tasksOf({ type: r.type }).join('; '))}" ${dis}></label>
    </div>${r.soil ? `<p class="muted small">Verschmutzung laut Foto (Schätzung): ${esc(SOIL[r.soil])}</p>` : ''}</li>`
}

function photoChips(v, dis) {
  const rooms = v.visit?.rooms || []
  return (v.visit?.photos || [])
    .map((p, i) => `<li class="vt-photo"><button type="button" class="pill anl-file" data-action="vt-photo-open" data-i="${i}" title="${esc(p.name || '')}">${ICON.camera} Foto ${i + 1}${p.queued ? ' (wartet)' : ''}</button>
      <select id="vtp-room-${i}" aria-label="Raum zu Foto ${i + 1}" ${dis}>${options(rooms.map((r) => [r.id, r.name || roomTypeLabel(r.type)]), p.roomId || '', { empty: '– ohne Raum –' })}</select>
      ${dis ? '' : `<button type="button" class="btn small ghost icon" data-action="vt-photo-del" data-i="${i}" aria-label="Foto ${i + 1} entfernen" title="Foto entfernen">${ICON.close}</button>`}</li>`)
    .join('')
}

/** Freigabe-Karte mit dem Vorschlag der KI: nichts ist übernommen, bis „Übernehmen“. */
function kiCard(m) {
  const res = m.kiResult
  if (!res) return ''
  const rows = res.rooms
    .map((r, i) => `<tr><td><label class="check"><input type="checkbox" name="vtk-room" value="${i}" checked><span class="visually-hidden">übernehmen</span></label></td><td><strong>${esc(r.name)}</strong><br><small class="muted">${esc(roomTypeLabel(r.type))}</small></td><td class="num">${r.m2 ? `${dec(r.m2, 0)} m²` : '–'}</td><td>${esc(r.perWeek ? roomFreqLabel(r.perWeek) : '–')}</td><td>${esc(floorLabel(r.floor) || '–')}</td><td>${esc(r.notes || '')}${r.tasks?.length ? `<br><small class="muted">${esc(r.tasks.join('; '))}</small>` : ''}${r.flags.length ? `<br><small class="warn-text">${esc(r.flags.join(' · '))}</small>` : ''}</td></tr>`)
    .join('')
  const photos = res.photos
    .map((p, i) => `<li><label class="check"><input type="checkbox" name="vtk-photo" value="${i}" checked><span>Foto ${p.index}${p.room ? ` (${esc(p.room)})` : ''}: ${esc([p.floor ? `Belag ${floorLabel(p.floor)}` : '', p.soil ? `Verschmutzung ${SOIL[p.soil]}` : '', p.note].filter(Boolean).join(', ') || 'kein Hinweis')} <span class="pill warning">Schätzung</span></span></label></li>`)
    .join('')
  return `<div class="vt-ki-card" role="region" aria-label="Vorschlag der KI">
    <p><span class="pill info">KI</span> <strong>Vorschlag der KI – bitte prüfen.</strong> Übernommen wird nur, was angehakt ist; gespeichert erst mit „Speichern“.</p>
    ${problemList(res.problems.map((p) => ({ ...p, level: p.level === 'warning' ? 'warn' : p.level })))}
    ${rows ? `<div class="table-wrap"><table class="data vt-ki-table"><thead><tr><th><span class="visually-hidden">übernehmen</span></th><th>Raum</th><th class="num">Fläche</th><th>Häufigkeit</th><th>Belag</th><th>Besonderheiten, Leistungen</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${photos ? `<h4>Hinweise aus den Fotos</h4><ul class="vt-ki-photos">${photos}</ul>` : ''}
    <div class="actions"><button type="button" class="btn" data-action="vt-ki-drop">Verwerfen</button><button type="button" class="btn primary" data-action="vt-ki-take">Ausgewählte übernehmen</button></div></div>`
}

function visitTab(v, dis, m) {
  const r = R()
  const visit = v.visit || {}
  const rooms = visit.rooms || []
  const t = roomTotals(rooms)
  const listening = kixListening()
  const ed = !dis
  return `<h3>Termin</h3>
    <div class="form-grid">
      <label class="field"><span>Besichtigung am</span><input type="date" id="vtv-date" value="${esc(visit.date || '')}" ${dis}></label>
      <label class="field"><span>Uhrzeit</span><input type="time" id="vtv-time" value="${esc(visit.time || '')}" ${dis}></label>
      ${ed && r.termin ? `<div class="field"><span>&nbsp;</span><button type="button" class="btn" data-action="vt-appt">${ICON.calendar} ${visit.appointmentId ? 'Termin ändern' : 'Termin in Outlook'}</button></div>` : ''}
    </div>${visit.appointmentId ? `<p class="note">Termin in „Termine“${visit.date ? ` am ${short(visit.date)}${visit.time ? ` um ${esc(visit.time)}` : ''}` : ''}.</p>` : ''}
    <h3>Räume und Bereiche <span class="muted">${t.count ? `${t.count} · ${dec(t.m2, 0)} m²` : ''}</span></h3>
    ${rooms.length ? `<ul class="vt-rooms">${rooms.map((x, i) => roomCard(x, i, dis)).join('')}</ul>` : '<p class="muted">Noch keine Räume. Je Raum oder Bereich: Name, Art, Fläche, Belag, wie oft, Besonderheiten.</p>'}
    ${ed ? `<div class="actions vt-room-add"><button type="button" class="btn" data-action="vt-room-add">${ICON.plus} Raum hinzufügen</button></div>` : ''}
    ${t.missingM2 || t.missingFreq ? `<p class="warn-text small">${[t.missingM2 && `${plural(t.missingM2, 'Raum', 'Räume')} ohne Fläche`, t.missingFreq && `${plural(t.missingFreq, 'Raum', 'Räume')} ohne Häufigkeit`].filter(Boolean).join(', ')}: für die Kalkulation nötig.</p>` : ''}
    <h3>Fotos</h3>
    ${(visit.photos || []).length ? `<ul class="vt-photos">${photoChips(v, dis)}</ul>` : ''}
    ${ed ? `<div class="actions"><label class="btn">${ICON.camera} Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-change="vt-photo" hidden multiple></label><span class="muted small">Fotos kommen nach SharePoint (ohne Netz später).</span></div>` : ''}
    <h3>Sprachnotiz</h3>
    <label class="field wide"><span>Gesprochen oder getippt</span><textarea id="vtv-voice" rows="4" placeholder="z. B. Büros im ersten Stock, etwa 320 Quadratmeter Teppich, täglich; zwei WC-Anlagen mit 25 Quadratmetern, täglich; Stiegenhaus zweimal pro Woche" ${dis}>${esc(visit.voice || '')}</textarea></label>
    ${ed ? `<div class="actions">${kixSpeech() ? `<button type="button" class="btn${listening ? ' on' : ''}" id="vt-voice-mic" data-action="vt-voice-mic" aria-pressed="${listening}">${listening ? 'Aufhören' : 'Sprechen'}</button>` : ''}${kixButton(`<button type="button" class="btn kix-btn" data-action="vt-ki">Vorschlag mit KI</button>`)}</div>
      ${kixButton('<p class="note">KI: Sprachnotiz und bis zu 4 Fotos gehen als eine Anfrage an den KI-Dienst (zählt zum Tageslimit; mit Fotos etwas teurer). Der Vorschlag wird geprüft, übernommen wird nur, was du anhakst.</p>')}${kixBox('vt')}${kiCard(m)}` : ''}
    <div class="actions vt-visit-actions"><button type="button" class="btn" data-action="vt-lv-pdf">${ICON.download} Leistungsverzeichnis (PDF)</button>${ed && ['anfrage', 'besichtigung'].includes(stageOf(v)) ? '<button type="button" class="btn primary" data-action="vt-visit-done">Besichtigung abgeschlossen</button>' : ''}</div>`
}

function handoverButton(step) {
  return editable() ? `<button type="button" class="btn small" data-action="vt-handover" data-step="${esc(step)}">Übergeben</button>` : ''
}

function offerTab(v, dis) {
  const r = R()
  const ed = !dis
  const saved = caseOf(v.id)
  const calc = v.calc
  const { skipped } = calcAreasFromRooms(v.visit?.rooms || [])
  const hasCalc = !!(r.calc && app.data.kalkulation?.cases?.[v.id]?.areas?.length)
  const calcHtml = `<h3>Kalkulation</h3>
    ${calc?.net ? `<div class="impact-stats vt-calc"><div class="stat"><div class="label">Preis je Monat netto</div><div class="value">${money(calc.net)}</div><small class="muted">brutto ${money(calc.gross)}</small></div><div class="stat"><div class="label">Stunden je Monat</div><div class="value">${dec(calc.hours)}</div><small class="muted">${calc.totalM2 ? `${dec(calc.totalM2, 0)} m²` : ''}</small></div></div><p class="muted small">Kalkuliert am ${short(String(calc.at || '').slice(0, 10))}${calc.by ? ` von ${esc(calc.by)}` : ''}.</p>` : '<p class="muted">Noch keine Kalkulation.</p>'}
    ${skipped.length ? `<p class="warn-text small">Nicht in der Kalkulation: ${esc(skipped.map((s) => `${s.name} (${s.missing.join(' und ')} fehlt)`).join(', '))}.</p>` : ''}
    ${r.calc ? (ed ? `<div class="actions"><button type="button" class="btn ${calc?.net ? '' : 'primary'}" data-action="vt-calc" ${saved && (v.visit?.rooms || []).length ? '' : 'disabled'}>${hasCalc ? 'Neu aus der Besichtigung' : 'Kalkulation anlegen'}</button>${hasCalc ? '<button type="button" class="btn" data-action="vt-calc-open">In der Kalkulation öffnen</button>' : ''}</div>${saved ? '' : '<p class="muted small">Erst den Fall speichern.</p>'}` : '') : `<p class="note">${esc(RIGHT_TEXT.calc)} ${handoverButton('calc')}</p>`}`
  const o = v.offer
  const cust = custOf(v.customerId)
  let offerHtml = '<h3>Angebot</h3>'
  if (o?.id)
    offerHtml += `<p><span class="pill ${OFFER_CLS[o.state] || ''}">${esc(o.number || 'Entwurf')} · ${esc(OFFER_TEXT[o.state] || o.state)}</span> ${money(o.net)} netto${o.validUntil ? ` · gültig bis ${short(o.validUntil)}` : ''}${o.sent ? ' · gesendet' : o.number ? ' · noch nicht gesendet' : ''}${o.online ? ' · online zur Annahme' : ''}${o.acceptedAt ? ` · angenommen am ${short(o.acceptedAt)}${o.acceptedBy ? ` von ${esc(o.acceptedBy)}` : ''}` : ''}</p>
      ${r.fakView ? `<div class="actions"><button type="button" class="btn" data-action="fak-open" data-id="${esc(o.id)}">Angebot öffnen</button>${r.offer && o.number && o.state === 'offen' ? `<button type="button" class="btn" data-action="ang-open" data-id="${esc(o.id)}">Online-Annahme</button><button type="button" class="btn" data-action="fak-followup-open" data-id="${esc(o.id)}">Wiedervorlage</button>` : ''}</div>` : '<p class="muted small">Stand aus der Fakturierung (wird beim Öffnen des Vertriebs durch jemanden mit Recht auf die Fakturierung aktualisiert).</p>'}`
  else if (!r.offer) offerHtml += `<p class="note">${esc(RIGHT_TEXT.offer)} ${handoverButton('offer')}</p>`
  else if (!v.customerId) offerHtml += `<p class="note">Für das Angebot braucht es einen Kunden in der Fakturierung.</p>${ed && r.customer && v.lead?.name ? '<div class="actions"><button type="button" class="btn" data-action="vt-prospect">Als Interessent anlegen</button></div>' : ''}`
  else if (!calc?.net) offerHtml += '<p class="muted">Erst die Kalkulation anlegen: Sie liefert den Monatspreis für das Angebot.</p>'
  else offerHtml += `<p class="muted">Positionen aus der Kalkulation, das Leistungsverzeichnis der Besichtigung als Beilage. Senden und online annehmen lassen wie jedes Angebot.</p>${ed ? `<div class="actions"><button type="button" class="btn primary" data-action="vt-offer" ${saved ? '' : 'disabled'}>Angebot erstellen</button></div>` : ''}`
  if (cust && isProspect(cust) && stageOf(v) !== 'angenommen') offerHtml += `<p class="muted small">${esc(customerName(cust))} steht in der Fakturierung als „${PROSPECT_GROUP}“.</p>`
  const won = stageOf(v) === 'angenommen'
  const order = won ? `<h3>Auftrag</h3><p>Angenommen${v.wonAt ? ` am ${short(v.wonAt)}` : ''}. Der Assistent legt Kunde, Objekt, Dauerauftrag und Vertrag Schritt für Schritt an.</p><div class="actions"><button type="button" class="btn primary" data-action="vt-wizard-open" data-id="${esc(v.id)}">Auftrag anlegen</button></div>` : ''
  return `${calcHtml}${offerHtml}${order}`
}

function historyTab(v) {
  const list = [...(v.history || [])].reverse()
  return list.length ? `<ul class="vt-history">${list.map((h) => `<li><span class="muted">${esc(short(String(h.at || '').slice(0, 10)))}${h.by ? ` · ${esc(h.by)}` : ''}</span> ${esc(h.text || '')}</li>`).join('')}</ul>` : '<p class="muted">Noch kein Eintrag.</p>'
}

function caseModal(c, m) {
  const saved = m.id ? caseOf(m.id) : null
  m.draft ||= structuredClone(saved || newCase())
  const v = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const tab = TABS.some(([id]) => id === m.tab) ? m.tab : 'fall'
  const body = tab === 'besichtigung' ? visitTab(v, dis, m) : tab === 'angebot' ? offerTab(v, dis) : tab === 'verlauf' ? historyTab(v) : fallTab(v, dis)
  const confirm = app.ui.confirm === `vt-del:${v.id}`
  return modalFrame({
    title: saved ? `${v.no} ${nameOf(v)}` : 'Neue Anfrage',
    subtitle: `${stagePill(v)}${v.owner ? ` · ${esc(v.owner)}` : ''}`,
    wide: true,
    body: `${tabBar({ action: 'vt-tab', current: tab, tabs: TABS.map(([id, label]) => ({ id, label })) })}<div class="vt-tab">${body}</div>`,
    foot: `<div class="actions">${ed && saved ? `<button class="btn danger ${confirm ? 'confirm' : ''}" data-action="vt-delete" data-id="${esc(v.id)}">${confirm ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed && saved && stageOf(v) === 'angenommen' ? `<button class="btn" data-action="vt-wizard-open" data-id="${esc(v.id)}">Auftrag anlegen</button>` : ''}${ed ? '<button class="btn primary" data-action="vt-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('vt-case', caseModal, { module: MODULE })

/** Eingaben des Dialogs in den Entwurf (nur Felder des offenen Reiters). */
function readCase(m = app.ui.modal) {
  const v = m?.draft
  if (!v || typeof document === 'undefined') return v
  const has = (id) => !!document.getElementById(id)
  if (has('vtc-stage')) {
    if (has('vtc-customer')) v.customerId = val('vtc-customer')
    if (has('vtc-name')) v.lead = { ...(v.lead || {}), name: val('vtc-name').trim(), contact: val('vtc-contact').trim(), phone: val('vtc-phone').trim(), email: val('vtc-email').trim(), street: val('vtc-street').trim(), zip: val('vtc-zip').trim(), city: val('vtc-city').trim(), consumer: checked('vtc-consumer') }
    if (has('vtc-create')) v.createProspect = checked('vtc-create')
    v.site = { ...(v.site || {}), name: val('vtc-site').trim(), address: val('vtc-address').trim() }
    if (has('vtc-object')) v.objectId = val('vtc-object')
    v.title = val('vtc-title').trim()
    v.newStage = val('vtc-stage')
    v.lostReason = has('vtc-lost') ? val('vtc-lost').trim() : v.lostReason
    v.source = val('vtc-source')
    v.requestDate = val('vtc-date')
    const monthly = val('vtc-monthly').trim()
    v.monthly = monthly === '' ? '' : parseNumber(monthly)
    const p = val('vtc-prob').trim()
    if (p === '') delete v.probability
    else v.probability = Number(p)
    v.owner = val('vtc-owner').trim()
    v.next = { text: val('vtc-next').trim(), date: val('vtc-next-date') }
    v.note = val('vtc-note').trim()
  }
  if (has('vtv-date')) {
    const visit = (v.visit ||= { rooms: [], photos: [] })
    visit.date = val('vtv-date')
    visit.time = val('vtv-time')
    visit.voice = val('vtv-voice')
    visit.rooms = (visit.rooms || []).map((r, i) => {
      if (!has(`vtr-name-${i}`)) return r
      const freq = val(`vtr-freq-${i}`)
      const tasks = val(`vtr-tasks-${i}`).split(';').map((s) => s.trim()).filter(Boolean)
      return { ...r, name: val(`vtr-name-${i}`).trim(), type: val(`vtr-type-${i}`), m2: Math.max(0, parseNumber(val(`vtr-m2-${i}`))) || 0, floor: val(`vtr-floor-${i}`), perWeek: freq ? Number(freq) : 0, notes: val(`vtr-notes-${i}`).trim(), ...(tasks.length ? { tasks } : { tasks: [] }) }
    })
    visit.photos = (visit.photos || []).map((p, i) => (has(`vtp-room-${i}`) ? { ...p, roomId: val(`vtp-room-${i}`) } : p))
  }
  return v
}

/**
 * Entwurf speichern: prüfen, Stufe wechseln (mit Verlauf), neuen Interessenten in der Fakturierung anlegen (nur mit Recht),
 * Räume aufräumen. Liefert den gespeicherten Fall oder null (Fehler als Meldung).
 */
function saveCase(m) {
  const v = readCase(m)
  const errors = caseProblems(v).filter((p) => p.level === 'error')
  if (errors.length) {
    toast(errors[0].text)
    return null
  }
  const old = caseOf(v.id)
  const at = nowIso()
  const target = v.newStage && v.newStage !== stageOf(old || v) ? v.newStage : null
  if (target) {
    const chk = moveCheck(old || v, target, { reason: v.lostReason })
    if (!chk.ok) {
      toast(chk.errors[0])
      return null
    }
  }
  const { newStage, createProspect, ...rest } = v
  let next = { ...rest, visit: { ...(rest.visit || {}), rooms: (rest.visit?.rooms || []).map((r) => ({ ...cleanRoom(r), id: r.id || uid('r') })), photos: rest.visit?.photos || [] } }
  if (!old) next = { ...next, stage: 'anfrage', createdAt: at, createdBy: user(), history: [{ at, by: user(), stage: 'anfrage', text: `Anfrage angelegt${v.source ? ` (${sourceLabel(v.source)})` : ''}` }] }
  // neuer Interessent: Kunde mit Gruppe „Interessent“ in der Fakturierung (nur wer sie bearbeiten darf)
  let created = null
  if (!next.customerId && createProspect === true && R().customer && F() && next.lead?.name) {
    created = customerFromLead(next, { id: uid('c'), customerNo: nextCustomerNo(F().customers), at })
    F().customers.push(created)
    next.customerId = created.id
    next.history = [...(next.history || []), { at, by: user(), text: `Interessent in der Fakturierung angelegt (Nr. ${created.customerNo})` }]
  }
  // Name für Rollen ohne Fakturierung: aus dem Kunden
  const cust = custOf(next.customerId)
  if (cust) next.lead = { ...(next.lead || {}), name: customerName(cust) || next.lead?.name || '' }
  if (target) next = applyMove(next, target, { at, by: user(), reason: v.lostReason })
  const saved = putCase(next)
  persist()
  m.draft = structuredClone(saved)
  m.id = saved.id
  return { saved, created, target }
}

function openCase(id, extra = {}) {
  syncOffers()
  app.ui.confirm = null
  openModal({ type: 'vt-case', id: id || '', ...extra })
}

// ---------------------------------------------------------------- Dialog: Grund für „abgelehnt“

function lostModal(c, m) {
  const x = caseOf(m.id)
  if (!x) return ''
  return modalFrame({
    title: `${x.no}: nicht zustande gekommen`,
    body: `<label class="field wide"><span>Grund</span><input type="text" id="vtl-reason" list="vtl-list" value="${esc(x.lostReason || '')}" placeholder="z. B. Preis zu hoch"></label>${datalist('vtl-list', LOST_REASONS)}<p class="note">Der Grund hilft bei der Auswertung (Abschlussquote). Der Fall bleibt mit Verlauf erhalten.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="vt-lost-save" data-id="${esc(x.id)}">Als abgelehnt ablegen</button>`,
  })
}
registerModal('vt-lost', lostModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Übergabe

const HANDOVER_TEXT = { calc: 'Kalkulation anlegen', offer: 'Angebot erstellen und senden', customer: 'Interessent als Kunden anlegen', kunde: 'Interessent als Kunden anlegen', objekt: 'Objekt anlegen', dauerauftrag: 'Dauerauftrag aus dem Angebot anlegen', vertrag: 'Vertrag mit Fristen anlegen', termin: 'Termin für die Besichtigung eintragen' }

function handoverModal(c, m) {
  const x = caseOf(m.id)
  if (!x) return ''
  return modalFrame({
    title: `Übergabe ${x.no}`,
    subtitle: esc(nameOf(x)),
    body: `<p class="note">Für diesen Schritt fehlt dir das Recht. Die Übergabe setzt die verantwortliche Person und den nächsten Schritt; mit E-Mail-Adresse öffnet sich danach eine E-Mail an sie.</p>
      <div class="form-grid">
        <label class="field"><span>An (Name)</span><input type="text" id="vth-owner" list="vth-owner-list" value="${esc(m.owner || '')}"></label>${datalist('vth-owner-list', ownerList())}
        <label class="field"><span>E-Mail (optional)</span><input type="email" id="vth-email" value="${esc(m.email || '')}" placeholder="name@firma.at"></label>
        <label class="field wide"><span>Was</span><input type="text" id="vth-text" value="${esc(m.text || HANDOVER_TEXT[m.step] || 'Bitte übernehmen')}"></label>
        <label class="field"><span>Bis</span><input type="date" id="vth-date" value="${esc(m.date || workdayAfter(today(), 1))}"></label>
      </div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="vt-handover-save" data-id="${esc(x.id)}">Übergeben</button>`,
  })
}
registerModal('vt-handover', handoverModal, { module: MODULE })

// ---------------------------------------------------------------- Assistent „Auftrag anlegen“

function wizardCtx(x) {
  const f = F()
  const recurring = (f?.recurring || []).filter((r) => (x.recurringIds || []).includes(r.id))
  const contract = f?.contracts?.find((c) => c.id === x.contractId) || (x.contractId ? { id: x.contractId, no: x.contractNo || '' } : null)
  return { customer: custOf(x.customerId), rights: R(), recurring: recurring.length ? recurring : (x.recurringIds || []).map((id) => ({ id })), contract, object: objOf(x.objectId) }
}

const STEP_ICON = { done: '✓', open: '', blocked: '!', wait: '…' }

function stepForm(x, s, m) {
  const t = today()
  if (s.state === 'blocked') return `<p class="note">${esc(s.text)} ${s.right ? handoverButton(s.id) : ''}</p>`
  if (s.state === 'wait') return `<p class="muted">${esc(s.text)}</p>`
  if (s.state === 'done') {
    const link = {
      kunde: R().fakView && x.customerId ? `<button type="button" class="btn small" data-action="fak-cust-open" data-id="${esc(x.customerId)}">Kunde öffnen</button>` : '',
      objekt: x.objectId && R().object ? `<button type="button" class="btn small" data-action="obj-edit" data-id="${esc(x.objectId)}">Objekt öffnen</button>` : '',
      dauerauftrag: R().fakView ? (x.recurringIds || []).map((id) => `<button type="button" class="btn small" data-action="fak-rec-open" data-id="${esc(id)}">Dauerauftrag öffnen</button>`).join('') : '',
      vertrag: R().fakView && x.contractId ? `<button type="button" class="btn small" data-action="fvt-open" data-id="${esc(x.contractId)}">Vertrag öffnen</button>` : '',
    }[s.id]
    return `<p class="muted">${esc(s.text)} ${link || ''}</p>`
  }
  if (s.id === 'kunde') {
    const groups = [...new Set((F()?.customers || []).map((c) => String(c.group || '').trim()).filter((g) => g && g.toLowerCase() !== PROSPECT_GROUP.toLowerCase()))]
    return `<p>${esc(s.text)}</p><div class="form-grid"><label class="field"><span>Kundengruppe (optional)</span><input type="text" id="vtw-group" list="vtw-group-list" value="${esc(m.group || '')}" placeholder="z. B. Gewerbe"></label>${datalist('vtw-group-list', groups)}</div>
      <div class="actions"><button type="button" class="btn primary" data-action="vt-w-kunde" data-id="${esc(x.id)}">${x.customerId ? 'Zum Kunden machen' : 'Kunde anlegen'}</button></div>`
  }
  if (s.id === 'objekt') {
    const lv = lvSnapshot(x)
    const objOpts = (app.data.objects || []).map((o) => [o.id, o.name])
    const mode = m.objMode || ''
    return `<p>${esc(s.text)}</p><div class="form-grid">
        <label class="field wide"><span>Objekt</span><select id="vtw-obj" data-change="vt-w-redraw">${options(objOpts, mode, { empty: '– neu anlegen –' })}</select></label>
        ${mode ? '' : `<label class="field"><span>Name</span><input type="text" id="vtw-obj-name" value="${esc(m.objName ?? (x.site?.name || x.title || nameOf(x)))}"></label><label class="field"><span>Adresse</span><input type="text" id="vtw-obj-address" value="${esc(m.objAddress ?? siteAddress(x))}"></label>
        <label class="check wide"><input type="checkbox" id="vtw-obj-lv" ${m.objLv === false ? '' : 'checked'}><span>Leistungsverzeichnis (${plural(lv.rooms.length, 'Bereich', 'Bereiche')}) als Anweisung für die Mitarbeitenden</span></label>`}
      </div>${x.calc?.hours ? `<p class="muted small">Budget laut Kalkulation: ${dec(x.calc.hours)} Std. je Monat${R().calc ? '; die Flächen kommen in die Kalkulation des Objekts' : ''}.</p>` : ''}
      <div class="actions"><button type="button" class="btn primary" data-action="vt-w-objekt" data-id="${esc(x.id)}">${mode ? 'Objekt verknüpfen' : 'Objekt anlegen'}</button></div>`
  }
  if (s.id === 'dauerauftrag') {
    const offer = (F()?.documents || []).find((d) => d.id === x.offer?.id)
    const { rec, skipped } = recurringFromOffer(offer, { id: 'preview', customerId: x.customerId, startMonth: m.start || firstMonth(t) })
    return `<p>${esc(s.text)}</p>
      ${rec.lines.length ? `<ul class="vt-lines">${rec.lines.map((l) => `<li>${esc(l.text)} · ${numText(l.qty)} ${esc(l.unit)} × ${money(parseNumber(l.price))}</li>`).join('')}</ul>` : '<p class="warn-text">Das Angebot hat keine Position mit der Einheit „Monat“. Den Dauerauftrag bitte in der Fakturierung von Hand anlegen.</p>'}
      ${skipped.length ? `<p class="muted small">Nicht übernommen (einmalig): ${esc(skipped.join(', '))}.</p>` : ''}
      <div class="form-grid"><label class="field"><span>Erster Abrechnungsmonat</span><input type="month" id="vtw-start" value="${esc(m.start || firstMonth(t))}"></label></div>
      <div class="actions"><button type="button" class="btn primary" data-action="vt-w-rec" data-id="${esc(x.id)}" ${rec.lines.length ? '' : 'disabled'}>Dauerauftrag anlegen</button></div>`
  }
  if (s.id === 'vertrag') {
    const v = contractDraft(x, m)
    const st = contractStatus(v, t)
    return `<p>${esc(s.text)}</p><div class="form-grid">
        <label class="field"><span>Beginn</span><input type="date" id="vtw-c-start" value="${esc(v.start)}" data-change="vt-w-redraw"></label>
        <label class="field"><span>Mindestlaufzeit (Monate)</span><input type="number" id="vtw-c-min" min="0" step="1" value="${esc(v.minMonths)}" data-change="vt-w-redraw"></label>
        <label class="field"><span>Kündigungsfrist</span><span class="vt-inline"><input type="number" id="vtw-c-n" min="0" step="1" value="${esc(v.notice.n)}" data-change="vt-w-redraw" aria-label="Kündigungsfrist"><select id="vtw-c-unit" data-change="vt-w-redraw" aria-label="Einheit">${options(Object.entries(NOTICE_UNITS).map(([k, [, pl]]) => [k, pl]), v.notice.unit)}</select></span></label>
        <label class="field"><span>Zum</span><select id="vtw-c-term" data-change="vt-w-redraw">${options(Object.entries(TERMS), v.term)}</select></label>
        <label class="field"><span>Preisanpassung</span><select id="vtw-c-clause" data-change="vt-w-redraw">${options(Object.entries(CLAUSES), v.clause)}</select></label>
      </div><p class="note">${esc(st.label)}${st.termin ? ` · nächster Kündigungstermin ${short(st.termin)}, spätestens ${short(st.latest)}` : ''}${(x.recurringIds || []).length ? ` · ${plural(x.recurringIds.length, 'Dauerauftrag hängt', 'Daueraufträge hängen')} am Vertrag` : ''}</p>
      ${problemList(contractProblems(v))}
      <div class="actions"><button type="button" class="btn primary" data-action="vt-w-contract" data-id="${esc(x.id)}">Vertrag anlegen</button></div>`
  }
  if (s.id === 'dispo') {
    const k = app.data.kalkulation?.settings || {}
    const h = planHint(x.visit?.rooms || [], { performance: { ...CALC_DEFAULTS.performance, ...(k.performance || {}) }, setupPct: k.setupPct ?? CALC_DEFAULTS.setupPct })
    return `<p>${esc(s.text)}</p><p><strong>Vorschlag:</strong> ${esc(h.text)}</p><p class="muted small">Nur ein Hinweis: Die Disposition legt die Leistungen im Objekt an und teilt ein; hier wird nichts eingeteilt.</p>
      <div class="actions"><button type="button" class="btn" data-action="vt-w-dispo" data-id="${esc(x.id)}" ${h.weekMinutes || h.biweekly || h.rare ? '' : 'disabled'}>Als Hinweis vermerken</button></div>`
  }
  return ''
}

/** Vertrag zum Stand des Assistenten (Eingaben gemerkt im Dialog). */
function contractDraft(x, m) {
  const t = today()
  const startMonth = m.start || firstMonth(t)
  const c = m.contract || {}
  return contractFromCase(x, {
    id: 'preview',
    no: nextContractNo(F()?.contracts || [], t.slice(0, 4)),
    customerId: x.customerId,
    start: c.start || `${startMonth}-01`,
    minMonths: c.minMonths ?? 12,
    notice: { n: c.n ?? 3, unit: c.unit || 'monat' },
    term: c.term || 'quartal',
    clause: c.clause || 'keine',
    objectIds: x.objectId ? [x.objectId] : [],
    contact: (() => {
      const cu = custOf(x.customerId)
      const p = cu?.contacts?.[0]
      return p ? { id: p.id, name: p.name, email: p.email || '', phone: p.phone || '' } : x.lead?.contact ? { name: x.lead.contact, email: x.lead.email || '', phone: x.lead.phone || '' } : null
    })(),
    at: nowIso(),
    by: user(),
  })
}

function readWizard(m) {
  if (typeof document === 'undefined') return
  const has = (id) => !!document.getElementById(id)
  if (has('vtw-group')) m.group = val('vtw-group').trim()
  if (has('vtw-obj')) m.objMode = val('vtw-obj')
  if (has('vtw-obj-name')) {
    m.objName = val('vtw-obj-name').trim()
    m.objAddress = val('vtw-obj-address').trim()
    m.objLv = checked('vtw-obj-lv')
  }
  if (has('vtw-start')) m.start = val('vtw-start')
  if (has('vtw-c-start')) m.contract = { start: val('vtw-c-start'), minMonths: Number(val('vtw-c-min')) || 0, n: Number(val('vtw-c-n')) || 0, unit: val('vtw-c-unit'), term: val('vtw-c-term'), clause: val('vtw-c-clause') }
}

function wizardModal(c, m) {
  const x = caseOf(m.id)
  if (!x) return ''
  const steps = wizardSteps(x, wizardCtx(x))
  const done = steps.filter((s) => s.state === 'done' && !s.optional).length
  const total = steps.filter((s) => !s.optional).length
  return modalFrame({
    title: `Auftrag anlegen: ${nameOf(x)}`,
    subtitle: `${esc(x.no)} · ${done} von ${total} Schritten erledigt`,
    wide: true,
    body: `<p class="note">Jeder Schritt wird einzeln ausgeführt und nur, wenn du ihn bestätigst. Nichts läuft im Hintergrund; was angelegt ist, lässt sich in seinem Bereich wie gewohnt bearbeiten.</p>
      <ol class="vt-steps">${steps.map((s, i) => `<li class="vt-step ${s.state}"><h3><span class="vt-step-no" aria-hidden="true">${STEP_ICON[s.state] || i + 1}</span> ${i + 1}. ${esc(s.label)}${s.optional ? ' <small class="muted">(optional)</small>' : ''} <span class="pill ${s.state === 'done' ? 'ok' : s.state === 'blocked' ? 'warning' : ''}">${s.state === 'done' ? 'erledigt' : s.state === 'blocked' ? 'Recht fehlt' : s.state === 'wait' ? 'wartet' : 'offen'}</span></h3>${stepForm(x, s, m)}</li>`).join('')}</ol>`,
    foot: `<button class="btn" data-action="vt-open" data-id="${esc(x.id)}">Zum Fall</button><button class="btn primary" data-action="close-modal">Fertig</button>`,
  })
}
registerModal('vt-wizard', wizardModal, { module: MODULE })

function noteCase(id, text, patch = {}) {
  const x = caseOf(id)
  if (!x) return null
  return putCase({ ...x, ...patch, history: [...(x.history || []), { at: nowIso(), by: user(), text }] })
}

// ---------------------------------------------------------------- Kalkulation und Angebot

/** Flächen aus der Besichtigung in die Kalkulation (kalkulation.json → cases[Fall]), Ergebnis zurück in den Fall. */
function createCalc(x) {
  const { areas, skipped } = calcAreasFromRooms(x.visit?.rooms || [])
  if (!areas.length) return toast('Keine Räume mit Fläche und Häufigkeit: bitte in der Besichtigung ergänzen.')
  const k = (app.data.kalkulation ||= { settings: {}, objects: {} })
  k.cases ||= {}
  k.cases[x.id] = { ...(k.cases[x.id] || {}), name: x.site?.name || x.title || nameOf(x), no: x.no, address: siteAddress(x), areas, updatedAt: nowIso() }
  const settings = k.settings || {}
  const calc = calcFor(areas, settings, calcWage(settings, mergeRules(app.data.rules).wages))
  const saved = putCase(applyCalc(x, calcSummary(calc, { at: nowIso(), by: user() })))
  persist()
  return { saved, skipped, calc }
}

function createOffer(x) {
  const f = F()
  if (!f || !abrechnungHooks.newDraft) return toast('Die Fakturierung ist nicht geladen.')
  const cust = custOf(x.customerId)
  if (!cust) return toast('Bitte zuerst den Kunden bzw. Interessenten anlegen.')
  const fields = offerDraftFields(x, { vat: settingsOf(f).vat, newId: () => uid('l'), customerName: customerName(cust) })
  const d = abrechnungHooks.newDraft('angebot', { title: fields.title })
  abrechnungHooks.applyCustomer(d, x.customerId)
  Object.assign(d, { lines: fields.lines, source: fields.source, ...(x.objectId ? { objectId: x.objectId, objectName: objOf(x.objectId)?.name || '' } : {}) })
  if (!d.deliveryAddress && siteAddress(x)) d.deliveryAddress = [x.site?.name, siteAddress(x)].filter(Boolean).join(', ')
  f.documents.push(d)
  const res = syncOffer(x, snapOf(x), { at: nowIso(), by: user() })
  putCase(res.case)
  persist()
  closeModal()
  renderNow()
  ACTIONS['fak-open']?.({ dataset: { id: d.id } })
  toast('Angebot als Entwurf: prüfen, festschreiben und senden (oder online annehmen lassen). Das Leistungsverzeichnis hängt als Beilage an.')
}

async function lvBlob(x) {
  const lv = lvSnapshot(x, { customerName: nameOf(x) })
  return { name: lvPdfName(lv), blob: await pdfBlob(lvDocument({ lv, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })) }
}

// ---------------------------------------------------------------- KI-Besichtigung

async function photoForKi(p) {
  const blob = PHOTO_BLOBS.get(p.path) || (app.store?.kind === 'sharepoint' ? await app.store.readBlob?.(p.path).catch(() => null) : null)
  if (!blob) return null
  const file = blob instanceof File ? blob : new File([blob], p.name || 'foto.jpg', { type: blob.type || p.type || 'image/jpeg' })
  return kixFile(file)
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'vt-search': () => {
    app.ui.vtSearch = val('vt-search')
    renderNow()
    const el = document.getElementById('vt-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'vt-mine': () => {
    app.ui.vtMine = checked('vt-mine')
    renderNow()
  },
  'vt-old': () => {
    app.ui.vtOld = !app.ui.vtOld
    renderNow()
  },
  'vt-stage-filter': () => {
    app.ui.vtStage = val('vt-stage-filter')
    renderNow()
  },
  'vt-open': (el) => openCase(el?.dataset?.id || '', el?.dataset?.tab ? { tab: el.dataset.tab } : {}),
  'vt-goto': (el) => {
    app.ui.view = 'vertrieb'
    if (app.ui.modal) closeModal()
    renderNow()
    if (el?.dataset?.id) openCase(el.dataset.id)
  },
  'vt-tab': (el) => {
    const m = app.ui.modal
    if (m?.type !== 'vt-case') return
    if (editable()) readCase(m)
    m.tab = el.dataset.v
    renderModal()
  },
  'vt-redraw': () => {
    const m = app.ui.modal
    if (m?.type !== 'vt-case') return
    readCase(m)
    renderModal()
  },
  'vt-photo-open': (el) => {
    const m = app.ui.modal
    const p = m?.draft?.visit?.photos?.[Number(el.dataset.i)]
    if (!p) return
    const local = PHOTO_BLOBS.get(p.path)
    if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
    openFile(p)
  },
  'vt-lv-pdf': async () => {
    const m = app.ui.modal
    const x = m?.type === 'vt-case' ? (editable() ? readCase(m) : m.draft) : null
    if (!x) return
    const f = await lvBlob(x)
    download(f.name, f.blob)
  },
  'vt-csv': () => {
    const head = ['Nummer', 'Stufe', 'Interessent', 'Leistungsort', 'Quelle', 'Anfrage am', 'Umsatz je Monat', 'Wahrscheinlichkeit', 'Nächster Schritt', 'bis', 'Verantwortlich', 'Angebot', 'Abschluss']
    const rows = D().cases.map((c) => [c.no, stageLabel(stageOf(c)), nameOf(c), [c.site?.name, siteAddress(c)].filter(Boolean).join(', '), sourceLabel(c.source), c.requestDate || '', String(expectedMonthly(c)).replace('.', ','), `${probabilityOf(c)} %`, c.next?.text || '', c.next?.date || '', c.owner || '', c.offer?.number || '', c.wonAt || c.lostAt || ''])
    const cell = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = `﻿${[head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`
    download(`Vertrieb_${today()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  },
})

registerActions(
  {
    'vt-new': () => openCase('', { tab: 'fall' }),
    'vt-move': (el) => moveCase(el.dataset.id, el.dataset.stage),
    'vt-lost-save': (el) => {
      const reason = val('vtl-reason').trim()
      if (!reason) return toast('Bitte einen Grund angeben.')
      closeModal()
      moveCase(el.dataset.id, 'abgelehnt', { reason })
    },
    'vt-save': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      const res = saveCase(m)
      if (!res) return renderModal()
      renderNow()
      toast(`${res.saved.no} gespeichert.${res.created ? ` Interessent ${customerName(res.created)} in der Fakturierung angelegt (Nr. ${res.created.customerNo}).` : ''}${res.target ? ` Stufe: ${stageLabel(res.target)}.` : ''}`)
    },
    'vt-delete': (el) => {
      if (!confirmStep(`vt-del:${el.dataset.id}`, renderModal)) return
      const x = caseOf(el.dataset.id)
      D().cases = D().cases.filter((c) => c.id !== el.dataset.id)
      if (app.data.kalkulation?.cases?.[el.dataset.id]) delete app.data.kalkulation.cases[el.dataset.id]
      persist()
      closeModal()
      renderNow()
      toast(`${x?.no || 'Fall'} gelöscht. Kunden, Angebote und Fotos in SharePoint bleiben.`)
    },
    'vt-room-add': () => {
      const m = app.ui.modal
      const v = readCase(m)
      v.visit ||= { rooms: [], photos: [] }
      v.visit.rooms = [...(v.visit.rooms || []), { id: uid('r'), name: '', type: 'buero', m2: 0, floor: '', perWeek: 0, notes: '' }]
      renderModal()
      document.getElementById(`vtr-name-${v.visit.rooms.length - 1}`)?.focus()
    },
    'vt-room-del': (el) => {
      const m = app.ui.modal
      const v = readCase(m)
      const gone = v.visit.rooms[Number(el.dataset.i)]
      v.visit.rooms = v.visit.rooms.filter((_, i) => i !== Number(el.dataset.i))
      v.visit.photos = (v.visit.photos || []).map((p) => (p.roomId === gone?.id ? { ...p, roomId: '' } : p))
      renderModal()
    },
    'vt-photo': async (el) => {
      const m = app.ui.modal
      const files = [...(el.files || [])]
      if (m?.type !== 'vt-case' || !files.length) return
      const v = readCase(m)
      const year = (v.visit?.date || today()).slice(0, 4)
      for (const file of files.slice(0, 8)) {
        const base = `vertrieb/fotos/${year}/${(v.no || 'VT').replace(/[^A-Za-z0-9-]/g, '')}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        const meta = await storeFile(file, base)
        if (!meta) continue
        PHOTO_BLOBS.set(meta.path, file)
        v.visit.photos = [...(v.visit.photos || []), meta]
      }
      if (app.ui.modal === m) renderModal()
      toast(app.store?.kind === 'sharepoint' ? 'Foto gespeichert (ohne Netz: wartet im Gerät). Mit „Speichern“ kommt es in den Fall.' : 'Foto angehängt (Browser-Modus: nur in dieser Sitzung). Mit „Speichern“ kommt es in den Fall.')
    },
    'vt-photo-del': (el) => {
      const m = app.ui.modal
      const v = readCase(m)
      v.visit.photos = v.visit.photos.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'vt-voice-mic': () =>
      kixDictate('vtv-voice', (on) => {
        const btn = document.getElementById('vt-voice-mic')
        if (!btn) return
        btn.classList.toggle('on', on)
        btn.setAttribute('aria-pressed', String(on))
        btn.textContent = on ? 'Aufhören' : 'Sprechen'
      }),
    'vt-ki': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case' || m.kix?.vt?.busy) return
      const v = readCase(m)
      const text = String(v.visit?.voice || '').trim()
      const photos = (v.visit?.photos || []).slice(0, BESICHTIGUNG_LIMITS.photos)
      if (!text && !photos.length) return toast('Bitte zuerst die Sprachnotiz aufnehmen bzw. tippen oder Fotos aufnehmen.')
      if (kixListening()) kixDictate('vtv-voice')
      if (!el?.dataset?.consent && !kixConsent('vt', photos.length ? 'Die Sprachnotiz mit den Fotos' : 'Die Sprachnotiz', { action: 'vt-ki' })) return
      kixSet('vt', { busy: 'Die KI liest die Besichtigung …' })
      try {
        const files = []
        const labels = []
        for (const p of photos) {
          const f = await photoForKi(p).catch(() => null)
          if (!f || f.kind !== 'image') continue
          const room = (v.visit.rooms || []).find((r) => r.id === p.roomId)
          files.push({ ...f, label: room ? room.name || roomTypeLabel(room.type) : '' })
          labels.push(p.roomId || '')
        }
        const { readBesichtigung } = await import('../../ai/extract.js')
        const res = await readBesichtigung({ text, photos: files, site: v.site?.name || '' })
        if (app.ui.modal !== m) return
        m.kiResult = res
        m.kiPhotoRooms = Object.fromEntries(labels.map((id, i) => [i + 1, id]))
        kixSet('vt', {})
        renderModal()
      } catch (err) {
        if (app.ui.modal === m) kixSet('vt', { error: kixFailed(err) })
      }
    },
    'vt-ki-take': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case' || !m.kiResult) return
      const v = readCase(m)
      const pick = new Set(checkedValues('vtk-room').map(Number))
      const pickPhotos = new Set(checkedValues('vtk-photo').map(Number))
      const rooms = m.kiResult.rooms.filter((_, i) => pick.has(i)).map((r) => ({ ...r, id: uid('r') }))
      const photos = m.kiResult.photos.filter((_, i) => pickPhotos.has(i))
      const res = mergeRooms(v.visit?.rooms || [], rooms, { photos, photoRoom: m.kiPhotoRooms || {} })
      v.visit = { ...(v.visit || {}), rooms: res.rooms, ki: { at: nowIso(), by: user(), added: res.added, filled: res.filled } }
      m.kiResult = null
      renderModal()
      toast(`Übernommen: ${plural(res.added, 'neuer Raum', 'neue Räume')}${res.filled ? `, ${plural(res.filled, 'Raum ergänzt', 'Räume ergänzt')}` : ''}. Bitte prüfen und „Speichern“.`)
    },
    'vt-ki-drop': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      readCase(m)
      m.kiResult = null
      renderModal()
    },
    'vt-visit-done': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      const v = readCase(m)
      if (!(v.visit?.rooms || []).length) return toast('Bitte zuerst die Räume erfassen.')
      v.newStage = 'besichtigt'
      if (!v.visit.date) v.visit.date = today()
      if (!v.next?.date || v.next.date <= today()) v.next = { text: R().calc ? 'Kalkulation anlegen' : 'Kalkulation an das Büro übergeben', date: workdayAfter(today(), 1) }
      const res = saveCase(m)
      if (!res) return renderModal()
      const had = (v.visit.rooms || []).some((r) => r.ki)
      if (had) noteCase(res.saved.id, `Räume aus dem KI-Vorschlag übernommen und geprüft (${(v.visit.rooms || []).filter((r) => r.ki).length})`)
      m.draft = structuredClone(caseOf(res.saved.id))
      for (const r of m.draft.visit.rooms || []) delete r.ki
      putCase(m.draft)
      persist()
      m.tab = 'angebot'
      renderModal()
      renderNow()
      toast(`${res.saved.no}: Besichtigung abgeschlossen (${plural(roomTotals(m.draft.visit.rooms).count, 'Bereich', 'Bereiche')}, ${dec(roomTotals(m.draft.visit.rooms).m2, 0)} m²).`)
    },
    'vt-appt': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      const res = saveCase(m)
      if (!res) return renderModal()
      const x = res.saved
      const date = x.visit?.date || workdayAfter(today(), 2)
      const time = x.visit?.time || '10:00'
      const start = `${date}T${time}`
      const endMin = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + 60
      const end = `${date}T${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
      const existing = x.visit?.appointmentId ? (app.data.termine?.items || []).find((a) => a.id === x.visit.appointmentId) : null
      if (existing) return openModal({ type: 'appt', id: existing.id })
      openModal({
        type: 'appt',
        draft: { title: `Besichtigung ${nameOf(x)}`, kind: 'begehung', start, end, allDay: false, objectId: x.objectId || '', location: [x.site?.name, siteAddress(x)].filter(Boolean).join(', '), note: [`Vertrieb ${x.no}`, x.lead?.contact ? `Ansprechperson: ${x.lead.contact}${x.lead.phone ? `, ${x.lead.phone}` : ''}` : '', x.title].filter(Boolean).join('\n'), attendees: x.lead?.email ? [{ email: x.lead.email, name: x.lead.contact || x.lead.name || '' }] : [], employeeIds: [], online: false, reminder: 60, responseRequested: true, ref: `vt:${x.id}` },
      })
    },
    'vt-handover': (el) => {
      const m = app.ui.modal
      const id = m?.type === 'vt-case' ? m.draft?.id : m?.id
      if (m?.type === 'vt-case') {
        const res = saveCase(m)
        if (!res) return renderModal()
      }
      if (!caseOf(id)) return toast('Bitte zuerst den Fall speichern.')
      openModal({ type: 'vt-handover', id, step: el.dataset.step || '' })
    },
    'vt-handover-save': (el) => {
      const x = caseOf(el.dataset.id)
      if (!x) return
      const owner = val('vth-owner').trim()
      const email = val('vth-email').trim()
      const text = val('vth-text').trim() || 'Bitte übernehmen'
      const date = val('vth-date')
      if (!owner) return toast('Bitte angeben, an wen übergeben wird.')
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Die E-Mail-Adresse sieht nicht richtig aus.')
      const saved = putCase({ ...x, owner, next: { text, date }, history: [...(x.history || []), { at: nowIso(), by: user(), text: `Übergabe an ${owner}: ${text}${date ? ` bis ${short(date)}` : ''}` }] })
      persist()
      closeModal()
      renderNow()
      if (email) {
        const link = `${location.origin}${location.pathname}#vertrieb`
        openCompose({ to: email, subject: `Vertrieb ${saved.no}: ${text}`, text: `Hallo ${owner.split(' ')[0]},\n\nbitte übernimm im Vertrieb den Fall ${saved.no} (${nameOf(saved)}${saved.site?.name ? `, ${saved.site.name}` : ''}): ${text}${date ? ` bis ${short(date)}` : ''}.\n\n${link}\n\nDanke\n${user()}`, origin: `Übergabe ${saved.no}` })
      } else toast(`${saved.no} an ${owner} übergeben: ${text}.`)
    },
    'vt-calc': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      if (!R().calc) return toast(RIGHT_TEXT.calc)
      const res = saveCase(m)
      if (!res) return renderModal()
      const had = !!app.data.kalkulation?.cases?.[res.saved.id]?.areas?.length
      if (had && !confirmStep(`vt-calc:${res.saved.id}`, renderModal)) return toast('Die Flächen in der Kalkulation werden durch die Räume der Besichtigung ersetzt. Zum Bestätigen noch einmal klicken.')
      const out = createCalc(res.saved)
      if (!out?.saved) return
      m.draft = structuredClone(out.saved)
      renderModal()
      renderNow()
      toast(`Kalkulation angelegt: ${money(out.saved.calc.net)} je Monat netto, ${dec(out.saved.calc.hours)} Std.${out.skipped.length ? ` Ohne Fläche oder Häufigkeit nicht dabei: ${out.skipped.map((s) => s.name).join(', ')}.` : ''}`)
    },
    'vt-calc-open': () => {
      const m = app.ui.modal
      const id = m?.draft?.id
      if (!id) return
      app.ui.calcObject = `vt:${id}`
      app.ui.calcDraft = null
      app.ui.view = 'kalkulation'
      closeModal()
      renderNow()
    },
    'vt-prospect': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      const v = readCase(m)
      v.createProspect = true
      const res = saveCase(m)
      if (!res) return renderModal()
      renderModal()
      renderNow()
      toast(res.created ? `Interessent ${customerName(res.created)} angelegt (Nr. ${res.created.customerNo}).` : 'Gespeichert.')
    },
    'vt-offer': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-case') return
      if (!R().offer) return toast(RIGHT_TEXT.offer)
      const res = saveCase(m)
      if (!res) return renderModal()
      if (offerOfCase(res.saved, F()?.documents || [])) return toast('Zu diesem Fall gibt es schon ein Angebot.')
      createOffer(res.saved)
    },
    'vt-wizard-open': (el) => {
      const m = app.ui.modal
      const id = el.dataset.id || m?.draft?.id
      if (m?.type === 'vt-case') {
        const res = saveCase(m)
        if (!res) return renderModal()
      }
      syncOffers()
      const x = caseOf(id)
      if (!x) return
      if (stageOf(x) !== 'angenommen') return toast('Der Assistent ist für angenommene Aufträge.')
      openModal({ type: 'vt-wizard', id })
    },
    'vt-w-redraw': () => {
      const m = app.ui.modal
      if (m?.type !== 'vt-wizard') return
      readWizard(m)
      renderModal()
    },
    'vt-w-kunde': (el) => {
      const m = app.ui.modal
      readWizard(m)
      const x = caseOf(el.dataset.id)
      const f = F()
      if (!x || !f) return
      if (!R().customer) return toast(RIGHT_TEXT.customer)
      const group = m.group || ''
      let cust = custOf(x.customerId)
      const at = nowIso()
      if (!cust) {
        if (!x.lead?.name) return toast('Im Fall fehlt der Name des Interessenten.')
        cust = customerFromLead(x, { id: uid('c'), customerNo: nextCustomerNo(f.customers), group, at })
        f.customers.push(cust)
      } else cust.group = group
      noteCase(x.id, `Interessent wird Kunde: ${customerName(cust)} (Nr. ${cust.customerNo || '–'})${group ? `, Gruppe „${group}“` : ''}`, { customerId: cust.id })
      persist()
      renderModal()
      renderNow()
      toast(`${customerName(cust)} ist jetzt Kunde${group ? ` (Gruppe „${group}“)` : ''}.`)
    },
    'vt-w-objekt': (el) => {
      const m = app.ui.modal
      readWizard(m)
      const x = caseOf(el.dataset.id)
      if (!x) return
      if (!R().object) return toast(RIGHT_TEXT.object)
      let obj = m.objMode ? objOf(m.objMode) : null
      if (!obj) {
        if (!m.objName) return toast('Bitte einen Namen für das Objekt eintragen.')
        obj = { ...objectFromCase({ ...x, site: { name: m.objName, address: m.objAddress } }, { id: uid('o'), withInstructions: m.objLv !== false }) }
        app.data.objects.push(obj)
      }
      // Kunde der Fakturierung: Objekt dazu (ein Objekt gehört zu genau einem Kunden)
      const f = F()
      const cust = custOf(x.customerId)
      if (cust && R().customer && f) {
        for (const c of f.customers) if (c.id !== cust.id) c.objectIds = (c.objectIds || []).filter((o) => o !== obj.id)
        cust.objectIds = [...new Set([...(cust.objectIds || []), obj.id])]
      }
      // Kalkulation des Objekts aus dem Fall (wer die Kalkulation sieht)
      const k = app.data.kalkulation
      if (R().calc && k?.cases?.[x.id]?.areas?.length && !k.objects?.[obj.id]?.areas?.length) {
        k.objects = { ...(k.objects || {}), [obj.id]: { areas: structuredClone(k.cases[x.id].areas), updatedAt: nowIso(), fromCase: x.id } }
        k.cases[x.id].objectId = obj.id
      }
      noteCase(x.id, `${m.objMode ? 'Objekt verknüpft' : 'Objekt angelegt'}: ${obj.name}${!m.objMode && m.objLv !== false ? ' (mit Leistungsverzeichnis als Anweisung)' : ''}`, { objectId: obj.id })
      // offene Angebots-Entwürfe des Falls bekommen das Objekt (festgeschriebene bleiben unverändert)
      for (const d of f?.documents || []) if (d.source?.caseId === x.id && !d.number && !d.objectId) Object.assign(d, { objectId: obj.id, objectName: obj.name })
      persist()
      renderModal()
      renderNow()
      toast(`Objekt ${obj.name} ${m.objMode ? 'verknüpft' : 'angelegt'}.`)
    },
    'vt-w-rec': (el) => {
      const m = app.ui.modal
      readWizard(m)
      const x = caseOf(el.dataset.id)
      const f = F()
      if (!x || !f) return
      if (!R().recurring) return toast(RIGHT_TEXT.recurring)
      const offer = f.documents.find((d) => d.id === x.offer?.id)
      if (!offer) return toast('Das Angebot des Falls ist nicht zu finden.')
      if (!/^\d{4}-\d{2}$/.test(m.start || firstMonth(today()))) return toast('Bitte den ersten Abrechnungsmonat wählen.')
      const id = uid('rec')
      const { rec } = recurringFromOffer(offer, { id, customerId: x.customerId, objectId: x.objectId || '', startMonth: m.start || firstMonth(today()), title: x.title || offer.title, newId: () => uid('l'), contractId: x.contractId || '' })
      if (!rec.lines.length) return toast('Das Angebot hat keine Position mit der Einheit „Monat“.')
      f.recurring.push({ ...rec, createdAt: nowIso(), createdBy: user(), history: [{ at: nowIso(), by: user(), text: `aus Angebot ${offer.number || ''} (Vertrieb ${x.no})` }] })
      noteCase(x.id, `Dauerauftrag angelegt: monatlich ab ${rec.startMonth}, ${money(rec.lines.reduce((s, l) => s + parseNumber(l.qty) * parseNumber(l.price), 0))} netto`, { recurringIds: [...(x.recurringIds || []), id] })
      persist()
      renderModal()
      renderNow()
      toast('Dauerauftrag angelegt. Der Monatslauf erstellt ab dem ersten Monat die Rechnungsentwürfe.')
    },
    'vt-w-contract': (el) => {
      const m = app.ui.modal
      readWizard(m)
      const x = caseOf(el.dataset.id)
      const f = F()
      if (!x || !f) return
      if (!R().contract) return toast(RIGHT_TEXT.contract)
      f.contracts ||= []
      const draft = { ...contractDraft(x, m), id: uid('vt'), no: nextContractNo(f.contracts, today().slice(0, 4)) }
      const err = contractProblems(draft).find((p) => p.level === 'error')
      if (err) return toast(err.text)
      f.contracts.push({ ...draft, updatedAt: nowIso(), updatedBy: user() })
      // Daueraufträge des Falls hängen am Vertrag (ein Dauerauftrag gehört zu höchstens einem Vertrag)
      f.recurring = (f.recurring || []).map((r) => ((x.recurringIds || []).includes(r.id) && !r.contractId ? { ...r, contractId: draft.id } : r))
      noteCase(x.id, `Vertrag ${draft.no} angelegt (Beginn ${short(draft.start)}, Mindestlaufzeit ${draft.minMonths} Monate)`, { contractId: draft.id, contractNo: draft.no })
      persist()
      renderModal()
      renderNow()
      toast(`Vertrag ${draft.no} angelegt. Fristen und Erinnerungen laufen über die Verträge der Fakturierung.`)
    },
    'vt-w-dispo': (el) => {
      const x = caseOf(el.dataset.id)
      if (!x) return
      const k = app.data.kalkulation?.settings || {}
      const h = planHint(x.visit?.rooms || [], { performance: { ...CALC_DEFAULTS.performance, ...(k.performance || {}) }, setupPct: k.setupPct ?? CALC_DEFAULTS.setupPct })
      noteCase(x.id, `Hinweis für die Disposition: ${h.text}`, { dispo: { at: nowIso(), by: user(), text: h.text, days: h.days, monthHours: h.monthHours } })
      persist()
      renderModal()
      renderNow()
      toast('Vorschlag vermerkt. Er steht als Hinweis im Objekt (Einsatz-Dialog); eingeteilt wird nichts.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Termin der Besichtigung (Termine → Outlook)

onAppointmentSaved((t) => {
  const [kind, id] = String(t.ref || '').split(':')
  const x = kind === 'vt' ? caseOf(id) : null
  if (!x || !editable()) return
  const date = String(t.start || '').slice(0, 10)
  const time = t.allDay ? '' : String(t.start || '').slice(11, 16)
  let next = { ...x, visit: { ...(x.visit || { rooms: [], photos: [] }), date, time, appointmentId: t.id }, history: [...(x.history || []), { at: nowIso(), by: user(), text: `Besichtigung am ${short(date)}${time ? ` um ${time}` : ''} (Termin)` }] }
  if (!x.next?.date || x.next.date < date) next.next = { text: 'Besichtigung durchführen', date }
  next = advanceTo(next, 'besichtigung', { at: nowIso(), by: user() })
  putCase(next)
})

// ---------------------------------------------------------------- Zu erledigen, Hinweis im Objekt, Kennzahlen

registerTodo({
  id: 'vertrieb',
  module: MODULE,
  title: 'Vertrieb',
  compute: (t) => (app.data?.vertrieb ? dueCases(D().cases, t, { offerHandled }).map((d) => ({ ...d, id: `${d.case.id}:${d.kind}:${d.date}` })) : []),
  render: (list) =>
    list
      .map((d) => `<div class="todo-item"><span class="flag ${d.overdue > 0 ? 'error' : 'warning'}">${d.overdue > 0 ? d.overdue : '!'}</span><div class="todo-text"><strong>${esc(d.case.no)} ${esc(nameOf(d.case))}</strong><br><span class="muted">${esc(d.text)} · ${d.overdue > 0 ? `fällig seit ${short(d.date)}` : 'heute'}${d.case.owner ? ` · ${esc(d.case.owner)}` : ''}</span></div><button class="btn small primary" data-action="vt-goto" data-id="${esc(d.case.id)}">Öffnen</button></div>`)
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const x = D().cases.find((c) => c.objectId === objectId && stageOf(c) === 'angenommen')
    if (!x) return ''
    const t = roomTotals(x.visit?.rooms || [])
    return `<strong>Aus dem Vertrieb ${esc(x.no)}</strong>: Leistungsverzeichnis mit ${plural(t.count, 'Bereich', 'Bereichen')}${t.m2 ? `, ${dec(t.m2, 0)} m²` : ''}${x.dispo?.text ? `; Vorschlag Reinigungsplan: ${esc(x.dispo.text)}` : ''} <button class="btn small" data-action="vt-goto" data-id="${esc(x.id)}">Fall öffnen</button>`
  },
})

kpiHooks.vertrieb = ({ months, today: t }) => (app.data?.vertrieb?.cases?.length ? salesKpi(D().cases, months, t) : null)
