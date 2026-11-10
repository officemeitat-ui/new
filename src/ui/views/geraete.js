// Geräte & Maschinen: die eigenen Reinigungsgeräte der Firma (Scheuersaugmaschinen, Staubsauger, Hochdruckreiniger,
// Einscheibenmaschinen, Leitern, Akkus …). Liste mit Filtern (Art, Standort, Zustand, Prüfung), Gerätekarte mit
// Verlauf, Gerät anlegen mit Prüfarten aus der Vorlage der Art (Vorschlag ohne Gewähr), Prüfung erfassen mit
// Protokoll (Ergebnis „gesperrt“ → außer Betrieb), Schaden melden auch am Handy (Foto, Text, Objekt) und aus
// „Mein Dienstplan“, Reparaturen mit Werkstatt und Kosten (Eingangsrechnung aus Einkauf & Kasse nur verknüpft),
// Ausgabe an ein Objekt oder eine Person mit Verlauf, Auswertung der Kosten je Gerät, QR-Etikett als PDF
// (#geraete/<Inventarnummer> öffnet die Gerätekarte), „Zu erledigen“, digitaler Mitarbeiter „Fristen“ (nur „Öffnen“),
// Kennzahlen (core/geraete.js → geraeteKpi in views/kpi.js). Datei geraete/geraete.json, Dateien unter
// geraete/dateien/<Jahr>/ (storeFile aus views/anlagen.js). Aktionen und Dialoge mit dem Kürzel „gr-“.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import {
  addCheck,
  allTypes,
  attention,
  checkProblem,
  counts,
  DOC_KINDS,
  DUE_FILTERS,
  emptyGeraete,
  filterRows,
  geraeteRows,
  HISTORY_TEXT,
  HOME_KINDS,
  isOpenRepair,
  issue,
  issueOverdue,
  issueProblem,
  isUrgent,
  itemFromKey,
  itemProblem,
  nextAfter,
  nextNo,
  planName,
  planShort,
  plansFromType,
  prefixOf,
  PRUEFARTEN,
  repairCost,
  repairCosts,
  repairFromPortal,
  repairProblem,
  REPAIR_STATUS,
  RESULTS,
  rowOf,
  saveRepair,
  STATUS,
  STATUS_FILTERS,
  takeBack,
  timeline,
  typeOf,
  typesOf,
  withHome,
  withStatus,
} from '../../core/geraete.js'
import { toCSV } from '../../core/reports.js'
import { labelDocument, labelPdfName } from '../../export/geraete-pdf.js'
import { app, canEdit, closeModal, confirmStep, hashKey, memo, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, dayAt, download, esc, euro, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { onPortalRequests } from '../staffplan.js'
import { openFile, storeFile } from './anlagen.js'
import { FRISTEN_HOOKS } from './disponent.js'

const MODULE = 'geraete'
const ICON_GR = '<path d="M4 15.5h10.5l2-6H7.5z"/><path d="M14.5 15.5V19M7 15.5V19M5 19h11"/><path d="M16.5 9.5 19.5 4"/><circle cx="19.5" cy="4" r="1"/>'
const doc = () => {
  const d = (app.data.geraete ||= emptyGeraete())
  for (const k of ['types', 'items', 'checks', 'repairs']) d[k] ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.sees(m)
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const itemOf = (id) => doc().items.find((i) => i.id === id)
const repairOf = (id) => doc().repairs.find((r) => r.id === id)
const checkOf = (id) => doc().checks.find((c) => c.id === id)
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const empName = (id) => app.data.employees?.find((e) => e.id === id)?.name || ''
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const parseNum = (v) => Math.round((Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0) * 100) / 100
const numText = (v) => (v === '' || v === undefined || v === null ? '' : String(v).replace('.', ','))
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const STATUS_CLS = { betrieb: 'ok', reparatur: 'warning', gesperrt: 'error', ausgeschieden: 'na' }
const STATE_CLS = { ueberfaellig: 'error', faellig: 'warning', ok: 'ok', ohne: 'na', aus: 'na' }
const RESULT_CLS = { ok: 'ok', maengel: 'warning', gesperrt: 'error' }
const REPAIR_CLS = { gemeldet: 'warning', werkstatt: 'info', erledigt: 'ok', verworfen: 'na' }
const devName = (item) => (item ? `${item.no} ${item.name}` : 'Gerät zuordnen')
const activeEmployees = () => (app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= todayISO()).sort((a, b) => a.name.localeCompare(b.name, 'de'))
const objectOptions = (current = '') => app.data.objects.filter((o) => !o.inactive || o.id === current).map((o) => [o.id, o.name]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
/** Lieferanten zur Auswahl: aus Einkauf & Kasse (wer es sieht), dazu die Lieferanten im Lager. */
const supplierNames = () => [...new Set([...(sees('einkauf') ? (app.data.einkauf?.suppliers || []).filter((s) => s.active !== false).map((s) => s.name) : []), ...(app.data.material?.suppliers || []).map((s) => s.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
const einkaufSupplier = (name) => (sees('einkauf') ? (app.data.einkauf?.suppliers || []).find((s) => s.name && s.name.trim().toLowerCase() === String(name || '').trim().toLowerCase()) : null)
const datalist = (id, list) => `<datalist id="${id}">${list.map((x) => `<option value="${esc(x)}"></option>`).join('')}</datalist>`

/** Alle Geräte mit Zustand (je Berechnung gemerkt). */
const rowsAt = (today = todayISO()) => memo(app.cur, `geraete:${today}`, () => geraeteRows({ doc: doc(), today }))
const rowById = (id) => rowsAt().find((r) => r.item.id === id)

/** Text zur Prüfung: „überfällig seit 01.10.2026“, „fällig am …“, „nächste am …“, „keine Prüfart“. */
function dueText(r) {
  if (r.state === 'aus') return 'ausgeschieden'
  if (r.state === 'ohne') return 'keine Prüfart'
  if (!r.next) return 'noch keine Prüfung'
  if (r.state === 'ueberfaellig') return `überfällig seit ${short(r.next)}`
  if (r.state === 'faellig') return `fällig am ${short(r.next)}`
  return `nächste am ${short(r.next)}`
}
const dueOfPlan = (d) => (!d.next ? (d.noInterval ? 'Intervall fehlt' : 'noch keine Prüfung') : d.state === 'ueberfaellig' ? `überfällig seit ${short(d.next)}` : d.state === 'faellig' ? `fällig am ${short(d.next)}` : `nächste am ${short(d.next)}`)
const statusPill = (status) => `<span class="pill ${STATUS_CLS[status] || 'na'}">${esc(STATUS[status] || status)}</span>`
const statePill = (r) => (r.state === 'ueberfaellig' || r.state === 'faellig' ? `<span class="pill ${STATE_CLS[r.state]}">${r.state === 'ueberfaellig' ? 'Prüfung überfällig' : 'Prüfung fällig'}</span>` : '')
const locText = (loc) => (loc.issued ? `${loc.kind === 'person' ? 'bei' : 'im Objekt'} ${loc.label}` : loc.label || HOME_KINDS[loc.kind] || 'Lager')
const fileChip = (f, i, data) => `<button type="button" class="pill anl-file" data-action="gr-file" ${data} data-i="${i}" title="${esc(f.name)}">${f.kind ? ICON.download : ICON.camera} ${esc(f.kind ? DOC_KINDS[f.kind] || 'Dokument' : `Foto ${i + 1}`)}</button>`

// ---------------------------------------------------------------- Ansicht

function geraeteView() {
  const today = todayISO()
  const all = rowsAt(today)
  const ed = editable()
  openLinked(all)
  const tab = ['reparaturen', 'ausgabe', 'kosten'].includes(app.ui.grTab) ? app.ui.grTab : 'liste'
  const n = counts(all)
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const live = all.some((r) => r.status !== 'ausgeschieden')
  const head = `<div class="section-head"><div><h2>Geräte &amp; Maschinen</h2><p>Die eigenen Reinigungsgeräte: Inventar, Standort, Prüfungen und Wartung, Reparaturen und Ausgabe an Objekte oder Personen. Die nächste Prüfung rechnet die App ab dem Prüfdatum; „gesperrt“ nimmt ein Gerät außer Betrieb.</p></div>
      <div class="actions">${ed && live ? `<button class="btn primary" data-action="gr-repair-open">${ICON.bolt} Schaden melden</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Gerät anlegen', icon: ICON.plus, action: 'gr-edit-open', hint: 'Inventarnummer, Art, Standort' },
          ed && live && { label: 'Prüfung erfassen', icon: ICON.check, action: 'gr-check-open' },
          ed && live && { label: 'Ausgeben oder zurücknehmen', icon: ICON.send, action: 'gr-issue-open' },
          ed && { label: 'Arten und Prüfintervalle', icon: ICON.gear, action: 'gr-types-open', hint: 'Vorschläge anpassen' },
          { heading: 'Export' },
          live && { label: 'Etiketten der Auswahl (PDF)', icon: ICON.print, action: 'gr-labels', hint: 'QR-Code mit Inventarnummer' },
          all.length && { label: 'Liste (CSV)', icon: ICON.download, action: 'gr-csv', mail: true },
        ],
      })}</div></div>`
  if (!all.length)
    return `${head}<div class="banner welcome"><p><strong>Noch keine Geräte.</strong> Je Gerät Inventarnummer, Art und Standort anlegen; die Prüfarten (Prüfung elektrischer Betriebsmittel, Wartung, Sichtprüfung Leiter) kommen als Vorschlag aus der Art und lassen sich ändern.</p>${ed ? `<button class="btn primary" data-action="gr-edit-open">${ICON.plus} Gerät anlegen</button>` : ''}</div>${basisNote()}`
  const openRep = doc().repairs.filter(isOpenRepair).length
  const issuedN = all.filter((r) => r.item.issued && r.status !== 'ausgeschieden').length
  const tabs = tabBar({
    action: 'gr-tab',
    current: tab,
    tabs: [
      { id: 'liste', label: 'Geräte' },
      { id: 'reparaturen', label: 'Reparaturen', flag: openRep },
      { id: 'ausgabe', label: 'Ausgabe', flag: issuedN },
      { id: 'kosten', label: 'Kosten' },
    ],
  })
  const body = tab === 'reparaturen' ? repairsTab() : tab === 'ausgabe' ? issueTab(all) : tab === 'kosten' ? costTab(all) : listTab(all)
  return `${head}
    <div class="impact-stats tc-stats gr-stats">${tile('Prüfung überfällig', n.ueberfaellig, n.ueberfaellig ? 'err' : '')}${tile('bald fällig', n.faellig)}${tile('außer Betrieb', n.gesperrt, n.gesperrt ? 'err' : '')}${tile('in Reparatur', n.reparatur)}${tile('Geräte', n.bestand)}</div>
    ${tabs}${body}`
}

const basisNote = () => '<p class="note">Prüfarten und Intervalle sind Vorschläge ohne Gewähr, keine Rechtsauskunft. Das Intervall der Prüfung elektrischer Betriebsmittel legt der Betrieb nach der Evaluierung fest; bitte mit der Sicherheitsfachkraft bestätigen und unter „Mehr“ → „Arten und Prüfintervalle“ oder je Gerät anpassen.</p>'

/** #geraete/G-0001 vom QR-Etikett: Gerätekarte einmal öffnen (die Adresse gilt danach als erledigt). */
function openLinked(all) {
  const key = app.ui.linked
  if (!key || !key.startsWith('geraete/')) return
  app.ui.linked = null
  app.ui.grLinked = key
  const item = itemFromKey(key, all.map((r) => r.item))
  if (item) app.ui.modal = { type: 'gr-card', id: item.id, justOpened: true }
  else toast(`Gerät ${key.slice(8).toUpperCase()} nicht gefunden.`)
}

/** Orte für den Filter „Standort“: Art des Orts und je Ort (Lager, Objekte, Fahrzeuge, Personen). */
function locationOptions(all) {
  const seen = new Map()
  for (const r of all) if (r.status !== 'ausgeschieden') seen.set(`${r.location.kind}:${r.location.id || r.location.label}`, r.location)
  const list = [...seen].sort((a, b) => (a[1].kind + a[1].label).localeCompare(b[1].kind + b[1].label, 'de'))
  return [
    ['lager', 'alle Lager'],
    ['objekt', 'alle Objekte'],
    ['fahrzeug', 'alle Fahrzeuge'],
    ['ausgegeben', 'ausgegeben'],
    ...list.map(([k, loc]) => [k, `${loc.kind === 'person' ? 'bei ' : ''}${loc.label || HOME_KINDS[loc.kind]}`]),
  ]
}

function listTab(all) {
  const ed = editable()
  const f = { typeId: app.ui.grType || '', location: app.ui.grLoc || '', status: app.ui.grStatus || '', due: app.ui.grDue || '', q: app.ui.grQ || '' }
  const rows = filterRows(all, f)
  const usedTypes = [...new Set(all.map((r) => r.item.typeId))].map((id) => [id, typeOf(doc(), id)?.name || id]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const filtered = f.typeId || f.location || f.status || f.due || f.q
  const filters = `<div class="filters gr-filters">
      <label class="field inline"><span>Suche</span><input type="search" id="gr-f-q" value="${esc(f.q)}" placeholder="Nummer, Name, Hersteller" data-change="gr-filter"></label>
      <label class="field inline"><span>Art</span><select id="gr-f-type" data-change="gr-filter">${options(usedTypes, f.typeId, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Standort</span><select id="gr-f-loc" data-change="gr-filter">${options(locationOptions(all), f.location, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Zustand</span><select id="gr-f-status" data-change="gr-filter">${options(Object.entries(STATUS_FILTERS), f.status)}</select></label>
      <label class="field inline"><span>Prüfung</span><select id="gr-f-due" data-change="gr-filter">${options(Object.entries(DUE_FILTERS), f.due)}</select></label>
      ${filtered ? '<button class="btn small ghost" data-action="gr-reset">Filter zurücksetzen</button>' : ''}</div>`
  const lines = rows
    .map((r) => {
      const i = r.item
      const live = r.status !== 'ausgeschieden'
      const acts = `${ed && live && i.plans?.some((p) => p.active !== false) ? `<button class="btn small primary" data-action="gr-check-open" data-id="${esc(i.id)}">Prüfung</button> ` : ''}${menu({
        icon: ICON.more,
        title: 'Weitere Aktionen',
        btn: 'small ghost icon',
        caret: false,
        cls: 'row-menu',
        single: false,
        items: [
          { label: 'Gerätekarte und Verlauf', action: 'gr-card-open', data: { id: i.id } },
          ed && { label: 'Bearbeiten', action: 'gr-edit-open', data: { id: i.id } },
          ed && live && (i.issued ? { label: 'Zurücknehmen', action: 'gr-issue-open', data: { id: i.id } } : r.status === 'betrieb' && { label: 'Ausgeben', action: 'gr-issue-open', data: { id: i.id } }),
          ed && live && { label: 'Schaden melden', action: 'gr-repair-open', data: { item: i.id } },
          { label: 'Etikett (PDF)', icon: ICON.print, action: 'gr-label', data: { id: i.id } },
        ],
      })}`
      return `<tr><td class="clickable" data-action="gr-card-open" data-id="${esc(i.id)}"><strong>${esc(i.no)}</strong> ${esc(i.name)}<br><span class="muted">${esc([r.type?.name, [i.maker, i.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</span></td>
        <td>${esc(locText(r.location))}${r.location.issued ? `<br><span class="muted">seit ${short(i.issued.since)}${i.issued.due ? `, zurück bis ${short(i.issued.due)}` : ''}</span>${issueOverdue(i, todayISO()) ? ' <span class="pill warning">Rückgabe überfällig</span>' : ''}` : ''}</td>
        <td>${statusPill(r.status)}${r.openRepairs.length ? ` <span class="pill info">${plural(r.openRepairs.length, 'Reparatur', 'Reparaturen')}</span>` : ''}</td>
        <td>${esc(dueText(r))} ${statePill(r)}</td><td class="actions-cell">${acts}</td></tr>`
    })
    .join('')
  return `${filters}${lines ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>Gerät</th><th>Standort</th><th>Zustand</th><th>Prüfung</th><th></th></tr></thead><tbody>${lines}</tbody></table></div>` : `<p class="empty">Kein Gerät in dieser Auswahl.${filtered ? ' Filter zurücksetzen zeigt alle.' : ''}</p>`}${basisNote()}`
}

function repairsTab() {
  const ed = editable()
  const all = !!app.ui.grRepAll
  const today = todayISO()
  const list = doc()
    .repairs.filter((r) => isOpenRepair(r) || (all && (r.doneOn || r.date) >= addDays(today, -365)))
    .sort((a, b) => Number(isOpenRepair(b)) - Number(isOpenRepair(a)) || (b.date || '').localeCompare(a.date || ''))
  const rows = list
    .map((r) => {
      const item = itemOf(r.itemId)
      return `<tr><td>${short(r.date)}</td><td class="${item ? 'clickable' : ''}"${item ? ` data-action="gr-card-open" data-id="${esc(item.id)}"` : ''}><strong>${esc(item ? item.no : 'Gerät zuordnen')}</strong> ${esc(item?.name || '')}</td>
        <td>${esc(r.text)}${r.objectId ? `<br><span class="muted">${esc(objName(r.objectId))}</span>` : ''}${r.source === 'handy' ? ' <span class="pill info">vom Handy</span>' : ''}${(r.photos || []).length ? `<br>${r.photos.map((p, i) => fileChip(p, i, `data-repair="${esc(r.id)}"`)).join(' ')}` : ''}</td>
        <td><span class="pill ${REPAIR_CLS[r.status]}">${esc(REPAIR_STATUS[r.status])}</span>${r.doneOn ? `<br><span class="muted">${short(r.doneOn)}</span>` : ''}</td>
        <td>${esc(r.workshop || '')}</td><td class="num">${r.cost !== '' && r.cost !== undefined ? euro(repairCost(r)) : ''}${r.invoice ? `<br><span class="muted">${esc(r.invoice.no || '')}</span>` : ''}</td>
        <td class="actions-cell">${ed ? `<button class="btn small ${r.status === 'gemeldet' ? 'primary' : ''}" data-action="gr-repair-open" data-id="${esc(r.id)}">${item ? 'Bearbeiten' : 'Zuordnen'}</button>` : ''}</td></tr>`
    })
    .join('')
  return `<div class="filters"><label class="check"><input type="checkbox" id="gr-rep-all" ${all ? 'checked' : ''} data-change="gr-rep-all"><span>auch erledigte (letzte 12 Monate)</span></label></div>
    ${rows ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>gemeldet</th><th>Gerät</th><th>Schaden</th><th>Stand</th><th>Werkstatt</th><th class="num">Kosten</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offene Reparatur.</p>'}
    <p class="note">„In Reparatur“ setzt das Gerät auf „in Reparatur“, „erledigt“ nimmt es wieder in Betrieb (ein gesperrtes Gerät gibt erst eine Prüfung „in Ordnung“ frei). Die Kosten zählen nur für die Auswertung je Gerät, nicht für die Buchhaltung; eine Eingangsrechnung aus Einkauf &amp; Kasse lässt sich verknüpfen.</p>`
}

function issueTab(all) {
  const ed = editable()
  const today = todayISO()
  const out = all.filter((r) => r.item.issued && r.status !== 'ausgeschieden')
  const rows = out
    .map((r) => {
      const i = r.item
      return `<tr><td class="clickable" data-action="gr-card-open" data-id="${esc(i.id)}"><strong>${esc(i.no)}</strong> ${esc(i.name)}</td><td>${esc(i.issued.kind === 'person' ? `Person: ${i.issued.label}` : `Objekt: ${i.issued.label}`)}</td><td>${short(i.issued.since)}</td>
        <td>${i.issued.due ? `${short(i.issued.due)}${issueOverdue(i, today) ? ' <span class="pill warning">überfällig</span>' : ''}` : '–'}</td><td>${esc(i.home?.label || '')}</td>
        <td class="actions-cell">${ed ? `<button class="btn small" data-action="gr-issue-open" data-id="${esc(i.id)}">Zurücknehmen</button>` : ''}</td></tr>`
    })
    .join('')
  const hist = doc()
    .items.flatMap((i) => (i.history || []).filter((h) => h.kind === 'ausgabe' || h.kind === 'rueckgabe').map((h) => ({ i, h })))
    .sort((a, b) => (b.h.date || '').localeCompare(a.h.date || '') || (b.h.at || '').localeCompare(a.h.at || ''))
    .slice(0, 40)
  const histRows = hist.map(({ i, h }) => `<tr><td>${short(h.date)}</td><td class="clickable" data-action="gr-card-open" data-id="${esc(i.id)}">${esc(i.no)} ${esc(i.name)}</td><td>${esc(HISTORY_TEXT[h.kind])}</td><td>${esc([h.from, h.to].filter(Boolean).join(' → '))}</td><td>${esc(h.by || '')}${h.note ? `<br><span class="muted">${esc(h.note)}</span>` : ''}</td></tr>`).join('')
  return `${ed ? `<p><button class="btn primary" data-action="gr-issue-open">${ICON.send} Ausgeben</button></p>` : ''}
    <h3>Gerade ausgegeben</h3>${rows ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>Gerät</th><th>an</th><th>seit</th><th>zurück bis</th><th>Standort</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Kein Gerät ausgegeben.</p>'}
    <h3>Verlauf</h3>${histRows ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>Datum</th><th>Gerät</th><th>Was</th><th>von → an</th><th>wer</th></tr></thead><tbody>${histRows}</tbody></table></div>` : '<p class="empty">Noch keine Ausgabe.</p>'}`
}

const COST_SPANS = { 12: 'letzte 12 Monate', jahr: 'dieses Jahr', alle: 'seit Beginn' }
function costSpan() {
  const today = todayISO()
  const span = COST_SPANS[app.ui.grCost] ? app.ui.grCost : '12'
  return { span, from: span === 'jahr' ? `${today.slice(0, 4)}-01-01` : span === 'alle' ? '' : addDays(today, -365), to: today }
}
function costRows(all) {
  const { from, to } = costSpan()
  const costs = repairCosts(doc().repairs, { from, to })
  return all
    .filter((r) => costs.has(r.item.id))
    .map((r) => ({ r, ...costs.get(r.item.id), price: Number(r.item.price) || 0 }))
    .sort((a, b) => b.cost - a.cost)
}
function costTab(all) {
  const { span } = costSpan()
  const rows = costRows(all)
  const total = rows.reduce((s, x) => s + x.cost, 0)
  const body = rows
    .map((x) => `<tr><td class="clickable" data-action="gr-card-open" data-id="${esc(x.r.item.id)}"><strong>${esc(x.r.item.no)}</strong> ${esc(x.r.item.name)}</td><td>${esc(x.r.type?.name || '')}</td><td class="num">${x.count}</td><td class="num">${euro(x.cost)}</td><td class="num">${x.price ? euro(x.price) : '–'}</td><td class="num">${x.price ? `${Math.round((x.cost / x.price) * 100)} %` : '–'}</td></tr>`)
    .join('')
  return `<div class="filters"><label class="field inline"><span>Zeitraum</span><select id="gr-cost-span" data-change="gr-cost-span">${options(Object.entries(COST_SPANS), span)}</select></label>${rows.length ? `<button class="btn small" data-action="gr-cost-csv">${ICON.download} CSV</button>` : ''}</div>
    ${body ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>Gerät</th><th>Art</th><th class="num">Reparaturen</th><th class="num">Kosten netto</th><th class="num">Kaufpreis</th><th class="num">Anteil</th></tr></thead><tbody>${body}<tr class="anl-sum"><td colspan="3"><strong>Summe</strong></td><td class="num"><strong>${euro(total)}</strong></td><td colspan="2"></td></tr></tbody></table></div>` : '<p class="empty">Keine Reparaturkosten in diesem Zeitraum.</p>'}
    <p class="note">Kosten der Reparaturen je Gerät (Monat laut „erledigt am“, sonst gemeldet am), ohne „kein Schaden“. Nur zur Auswertung: gebucht wird in Einkauf &amp; Kasse, verknüpfte Eingangsrechnungen stehen bei der Reparatur. Ein hoher Anteil am Kaufpreis spricht für einen Tausch.</p>`
}

// zweites Etikett gescannt, während die Ansicht schon offen ist (app.js wechselt nur die Ansicht)
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', () => {
    const key = hashKey(location.hash)
    if (app.ui.view === 'geraete' && key.startsWith('geraete/')) {
      app.ui.linked = key
      renderNow()
    }
  })

registerView({
  id: 'geraete',
  order: 85,
  label: 'Geräte & Maschinen',
  group: 'lager',
  module: MODULE,
  icon: ICON_GR,
  noWeek: true,
  text: 'Reinigungsgeräte: Inventar, Prüfungen, Reparaturen, Ausgabe',
  badge: () => {
    const n = counts(rowsAt())
    return n.ueberfaellig + n.gesperrt
  },
  render: geraeteView,
})

// ---------------------------------------------------------------- Gerätekarte

const historyLine = (x) => {
  const e = x.entry
  if (x.kind === 'pruefung') return `<strong>${esc(planShort(itemOf(e.itemId)?.plans?.find((p) => p.id === e.planId) || { kind: e.kind }))}</strong> <span class="pill ${RESULT_CLS[e.result]}">${esc(RESULTS[e.result])}</span>${e.defects ? ` ${esc(e.defects)}` : ''} <span class="muted">· ${esc(e.by || '')}${e.values ? ` · Messwerte: ${esc(e.values)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</span>${e.report ? ` <button type="button" class="pill anl-file" data-action="gr-file" data-check="${esc(e.id)}" data-i="report">${ICON.download} Protokoll</button>` : ''}`
  if (x.kind === 'reparatur') return `<strong>Schaden</strong> <span class="pill ${REPAIR_CLS[e.status]}">${esc(REPAIR_STATUS[e.status])}</span> ${esc(e.text)} <span class="muted">· ${esc(e.reportedBy || '')}${e.workshop ? ` · ${esc(e.workshop)}` : ''}${repairCost(e) ? ` · ${euro(repairCost(e))}` : ''}</span>`
  if (x.kind === 'status') return `<strong>${esc(HISTORY_TEXT.status)}</strong>: ${esc(STATUS[e.from] || e.from || '')} → ${esc(STATUS[e.to] || e.to || '')}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ''}${e.by ? ` <span class="muted">· ${esc(e.by)}</span>` : ''}`
  return `<strong>${esc(HISTORY_TEXT[x.kind] || x.kind)}</strong> ${esc([e.from, e.to].filter(Boolean).join(' → '))}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ''}${e.by ? ` <span class="muted">· ${esc(e.by)}</span>` : ''}`
}

function cardModal(c, m) {
  const item = itemOf(m.id)
  if (!item) return ''
  const r = rowOf({ item, doc: doc(), today: todayISO() })
  const ed = editable()
  const live = r.status !== 'ausgeschieden'
  const fact = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '')
  const plans = r.dues.length
    ? `<div class="table-wrap"><table class="data gr-table"><thead><tr><th>Prüfart</th><th>Intervall</th><th>zuletzt</th><th>Frist</th></tr></thead><tbody>${r.dues.map((d) => `<tr><td>${esc(planName(d.plan))}</td><td>${d.months ? `${d.months} Monate` : '–'}</td><td>${d.last ? `${short(d.last.date)} <span class="pill ${RESULT_CLS[d.last.result]}">${esc(RESULTS[d.last.result])}</span>` : '<span class="muted">noch keine</span>'}</td><td>${esc(dueOfPlan(d))}${d.state === 'ueberfaellig' || d.state === 'faellig' ? ` <span class="pill ${STATE_CLS[d.state]}">${d.state === 'ueberfaellig' ? 'überfällig' : 'fällig'}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${live ? 'Keine Prüfart eingetragen.' : 'Ausgeschieden: keine Fristen mehr.'}</p>`
  const files = [...(item.photos || []).map((f, i) => fileChip(f, i, `data-item="${esc(item.id)}" data-kind="photo"`)), ...(item.docs || []).map((f, i) => fileChip(f, i, `data-item="${esc(item.id)}" data-kind="doc"`))].join(' ')
  const tl = timeline(doc(), item.id)
  const hist = tl.length
    ? `<ul class="tc-list anl-history">${tl.map((x) => `<li><strong>${short(x.date)}</strong> ${historyLine(x)}${ed && x.kind === 'pruefung' ? ` <button class="btn small ghost" data-action="gr-check-delete" data-id="${esc(x.entry.id)}">${app.ui.confirm === `gr-cdel:${x.entry.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${ed && x.kind === 'reparatur' ? ` <button class="btn small ghost" data-action="gr-repair-open" data-id="${esc(x.entry.id)}">Öffnen</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Noch nichts im Verlauf.</p>'
  return modalFrame({
    title: `${item.no} · ${item.name}`,
    subtitle: `${esc(r.type?.name || 'Gerät')} · ${esc(STATUS[r.status])}${r.state === 'ueberfaellig' || r.state === 'faellig' ? ` · ${esc(dueText(r))}` : ''}`,
    wide: true,
    body: `<div class="gr-card-head">${statusPill(r.status)} ${statePill(r)}${r.openRepairs.length ? ` <span class="pill info">${plural(r.openRepairs.length, 'Reparatur offen', 'Reparaturen offen')}</span>` : ''}${item.statusNote && r.status !== 'betrieb' ? ` <span class="muted">${esc(item.statusNote)}${item.statusSince ? ` (seit ${short(item.statusSince)})` : ''}</span>` : ''}</div>
      <dl class="gr-facts">
        ${fact('Art', esc(r.type?.name || ''))}${fact('Hersteller und Typ', esc([item.maker, item.model].filter(Boolean).join(' ')))}${fact('Seriennummer', esc(item.serial || ''))}
        ${fact('Gekauft', esc([item.boughtOn ? short(item.boughtOn) : '', item.price !== '' && item.price !== undefined && item.price !== null ? euro(Number(item.price)) : ''].filter(Boolean).join(' · ')))}${fact('Lieferant', esc(item.supplierName || ''))}
        ${fact('Standort', esc(item.home?.label || HOME_KINDS[item.home?.kind] || ''))}${fact('Ausgegeben an', item.issued ? `${esc(item.issued.label)} <span class="muted">seit ${short(item.issued.since)}${item.issued.due ? `, zurück bis ${short(item.issued.due)}` : ''}</span>` : '')}
        ${fact('Verantwortlich', esc(item.responsibleName || empName(item.responsibleId)))}${fact('Notiz', esc(item.note || ''))}
      </dl>
      ${files ? `<p class="gr-files">${files}</p>` : ''}
      <section><h3>Prüfungen und Wartung</h3>${plans}</section>
      <section><h3>Verlauf</h3>${hist}</section>`,
    foot: `<div class="actions"><button class="btn" data-action="gr-label" data-id="${esc(item.id)}">${ICON.print} Etikett</button>${ed ? `<button class="btn" data-action="gr-edit-open" data-id="${esc(item.id)}">Bearbeiten</button>` : ''}</div>
      <div class="actions">${ed && live ? `<button class="btn" data-action="gr-repair-open" data-item="${esc(item.id)}">Schaden melden</button>${item.issued || r.status === 'betrieb' ? `<button class="btn" data-action="gr-issue-open" data-id="${esc(item.id)}">${item.issued ? 'Zurücknehmen' : 'Ausgeben'}</button>` : ''}${r.dues.length ? `<button class="btn primary" data-action="gr-check-open" data-id="${esc(item.id)}">Prüfung erfassen</button>` : ''}` : `<button class="btn" data-action="close-modal">Schließen</button>`}</div>`,
  })
}
registerModal('gr-card', cardModal, { module: MODULE })

// ---------------------------------------------------------------- Gerät anlegen und bearbeiten

function itemDraft(m) {
  if (!m.draft) {
    const existing = m.id ? itemOf(m.id) : null
    const type = typesOf(doc()).find((t) => t.id === (m.typeId || 'scheuersaug')) || typesOf(doc())[0]
    m.draft = existing
      ? structuredClone(existing)
      : { id: '', no: nextNo(doc().items, prefixOf(doc())), name: '', typeId: type?.id || '', maker: '', model: '', serial: '', boughtOn: '', price: '', supplierId: '', supplierName: '', home: { kind: 'lager', id: '', label: (app.data.material?.locations || [])[0]?.name || 'Hauptlager' }, responsibleId: '', responsibleName: '', status: 'betrieb', statusNote: '', issued: null, plans: plansFromType(type, () => uid('gp')), photos: [], docs: [], history: [], note: '' }
    m.newFiles = []
    m.oldStatus = m.draft.status
  }
  return m.draft
}

function readHome(d) {
  const kind = val('gr-home-kind') || d.home?.kind || 'lager'
  if (kind !== d.home?.kind) return { kind, id: '', label: kind === 'lager' ? (app.data.material?.locations || [])[0]?.name || 'Hauptlager' : '' }
  if (kind === 'objekt') {
    const id = val('gr-home-obj')
    return { kind, id, label: objName(id) }
  }
  if (kind === 'fahrzeug' && document.getElementById('gr-home-veh')) {
    const id = val('gr-home-veh')
    const v = (app.data.fahrzeuge?.vehicles || []).find((x) => x.id === id)
    return { kind, id, label: v ? [v.plate, v.label].filter(Boolean).join(' ') : '' }
  }
  const label = val('gr-home-label').trim()
  const loc = kind === 'lager' ? (app.data.material?.locations || []).find((l) => l.name === label) : null
  return { kind, id: loc?.id || '', label }
}

function readItem() {
  const m = app.ui.modal
  const d = itemDraft(m)
  if (!document.getElementById('gr-name')) return d
  const typeId = val('gr-type')
  if (!d.id && typeId !== d.typeId && !m.plansTouched) d.plans = plansFromType(typeOf(doc(), typeId), () => uid('gp'))
  else
    d.plans = d.plans.map((p, i) => ({
      ...p,
      kind: val(`gr-pl-kind-${i}`) || p.kind,
      label: document.getElementById(`gr-pl-label-${i}`) ? val(`gr-pl-label-${i}`).trim() : p.label,
      months: val(`gr-pl-months-${i}`) ? Math.max(0, Math.round(Number(val(`gr-pl-months-${i}`)) || 0)) || '' : '',
      firstDue: val(`gr-pl-first-${i}`),
      active: checked(`gr-pl-active-${i}`),
    }))
  const respId = val('gr-resp')
  Object.assign(d, {
    no: val('gr-no').trim(),
    name: val('gr-name').trim(),
    typeId,
    maker: val('gr-maker').trim(),
    model: val('gr-model').trim(),
    serial: val('gr-serial').trim(),
    boughtOn: val('gr-bought'),
    price: val('gr-price').trim() === '' ? '' : parseNum(val('gr-price')),
    supplierName: val('gr-supplier').trim(),
    home: readHome(d),
    responsibleId: respId,
    responsibleName: empName(respId),
    status: val('gr-status') || d.status,
    statusNote: document.getElementById('gr-status-note') ? val('gr-status-note').trim() : d.statusNote,
    note: val('gr-note').trim(),
  })
  d.supplierId = einkaufSupplier(d.supplierName)?.id || ''
  return d
}

function editModal(c, m) {
  const d = itemDraft(m)
  const existing = d.id ? itemOf(d.id) : null
  const type = typeOf(doc(), d.typeId)
  const typeList = typesOf(doc())
  if (type && !typeList.includes(type)) typeList.push(type)
  const homeKind = d.home?.kind || 'lager'
  const vehicles = sees('fahrzeuge') ? app.data.fahrzeuge?.vehicles || [] : []
  const homeField =
    homeKind === 'objekt'
      ? `<label class="field"><span>Objekt</span><select id="gr-home-obj">${options(objectOptions(d.home?.id), d.home?.id || '', { empty: '– Objekt –' })}</select></label>`
      : homeKind === 'fahrzeug' && vehicles.length
        ? `<label class="field"><span>Fahrzeug</span><select id="gr-home-veh">${options(vehicles.map((v) => [v.id, [v.plate, v.label].filter(Boolean).join(' ')]), d.home?.id || '', { empty: '– Fahrzeug –' })}</select></label>`
        : `<label class="field"><span>${homeKind === 'fahrzeug' ? 'Fahrzeug (Kennzeichen)' : 'Lager'}</span><input type="text" id="gr-home-label" value="${esc(d.home?.label || '')}" list="gr-home-list" placeholder="${homeKind === 'fahrzeug' ? 'z. B. Bus S-284 KL' : 'z. B. Hauptlager'}">${datalist('gr-home-list', homeKind === 'lager' ? (app.data.material?.locations || []).map((l) => l.name) : [])}</label>`
  const plans = d.plans
    .map(
      (p, i) => `<tr><td><select id="gr-pl-kind-${i}" data-change="gr-redraw" aria-label="Prüfart">${options(Object.entries(PRUEFARTEN).map(([k, x]) => [k, x.name]), p.kind)}</select>${p.kind === 'sonstige' ? `<input type="text" id="gr-pl-label-${i}" value="${esc(p.label || '')}" placeholder="Name, z. B. Akkutest" aria-label="Name der Prüfung">` : ''}</td>
        <td><input type="number" id="gr-pl-months-${i}" min="1" max="120" value="${esc(p.months || '')}" class="num-input" aria-label="Intervall in Monaten"></td>
        <td><input type="date" id="gr-pl-first-${i}" value="${esc(p.firstDue || '')}" aria-label="fällig am (ohne Prüfung)"></td>
        <td><label class="check"><input type="checkbox" id="gr-pl-active-${i}" ${p.active !== false ? 'checked' : ''}><span>aktiv</span></label></td>
        <td>${!doc().checks.some((x) => x.planId === p.id) ? `<button class="btn small ghost" data-action="gr-plan-del" data-i="${i}" aria-label="Prüfart entfernen">${ICON.close}</button>` : ''}</td></tr>`,
    )
    .join('')
  const pending = (m.newFiles || []).map((f, i) => `<span class="pill anl-file">${f.kind === 'photo' ? ICON.camera : ICON.download} ${esc(f.kind === 'photo' ? f.file.name : `${DOC_KINDS[f.kind]}: ${f.file.name}`)} <button type="button" class="btn small ghost" data-action="gr-file-del" data-new="${i}" aria-label="Datei entfernen">${ICON.close}</button></span>`)
  const kept = [...(d.photos || []).map((f, i) => `<span class="pill anl-file">${ICON.camera} Foto ${i + 1} <button type="button" class="btn small ghost" data-action="gr-file-del" data-kind="photo" data-i="${i}" aria-label="Foto entfernen">${ICON.close}</button></span>`), ...(d.docs || []).map((f, i) => `<span class="pill anl-file">${ICON.download} ${esc(DOC_KINDS[f.kind] || 'Dokument')} <button type="button" class="btn small ghost" data-action="gr-file-del" data-kind="doc" data-i="${i}" aria-label="Dokument entfernen">${ICON.close}</button></span>`)]
  const statusOpts = Object.entries(STATUS)
  return modalFrame({
    title: existing ? `${existing.no} bearbeiten` : 'Gerät anlegen',
    subtitle: existing ? esc(existing.name) : 'Inventarnummer kommt fortlaufend, lässt sich ändern',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Inventarnummer</span><input type="text" id="gr-no" value="${esc(d.no)}" maxlength="20"></label>
        <label class="field"><span>Bezeichnung</span><input type="text" id="gr-name" value="${esc(d.name)}" placeholder="z. B. Scheuersaugmaschine 1"></label>
        <label class="field"><span>Art</span><select id="gr-type" data-change="gr-redraw">${options(typeList.map((t) => [t.id, t.name]), d.typeId)}</select></label>
        <label class="field"><span>Hersteller</span><input type="text" id="gr-maker" value="${esc(d.maker || '')}"></label>
        <label class="field"><span>Typ / Modell</span><input type="text" id="gr-model" value="${esc(d.model || '')}"></label>
        <label class="field"><span>Seriennummer</span><input type="text" id="gr-serial" value="${esc(d.serial || '')}"></label>
        <label class="field"><span>Kaufdatum</span><input type="date" id="gr-bought" value="${esc(d.boughtOn || '')}" max="${todayISO()}"></label>
        <label class="field"><span>Kaufpreis (netto, €)</span><input type="text" inputmode="decimal" id="gr-price" value="${esc(numText(d.price))}" placeholder="z. B. 3.490,00"></label>
        <label class="field"><span>Lieferant</span><input type="text" id="gr-supplier" value="${esc(d.supplierName || '')}" list="gr-sup-list" placeholder="${sees('einkauf') ? 'aus Einkauf & Kasse oder frei' : 'Name'}">${datalist('gr-sup-list', supplierNames())}</label>
        <label class="field"><span>Standort</span><select id="gr-home-kind" data-change="gr-redraw">${options(Object.entries(HOME_KINDS), homeKind)}</select></label>
        ${homeField}
        <label class="field"><span>Verantwortlich</span><select id="gr-resp">${options(activeEmployees().map((e) => [e.id, e.name]), d.responsibleId || '', { empty: '– niemand –' })}</select></label>
        <label class="field"><span>Zustand</span><select id="gr-status" data-change="gr-redraw">${options(statusOpts, d.status || 'betrieb')}</select></label>
        ${d.status !== (m.oldStatus || 'betrieb') ? `<label class="field wide"><span>${d.status === 'ausgeschieden' ? 'Warum ausgeschieden (z. B. verschrottet, verkauft)' : 'Grund (für den Verlauf)'}</span><input type="text" id="gr-status-note" value="${esc(d.statusNote || '')}"></label>` : ''}
        <label class="field wide"><span>Notiz</span><input type="text" id="gr-note" value="${esc(d.note || '')}" placeholder="z. B. Ladegerät im Bus, Ersatzbürsten im Regal 3"></label>
      </div>
      <section><h3>Prüfarten mit Intervall</h3>
        ${plans ? `<div class="table-wrap"><table class="data gr-plans"><thead><tr><th>Prüfart</th><th>Monate</th><th>fällig am (ohne Prüfung)</th><th></th><th></th></tr></thead><tbody>${plans}</tbody></table></div>` : '<p class="muted">Keine Prüfart. Für Geräte ohne Prüfpflicht in Ordnung.</p>'}
        <p><button class="btn small" data-action="gr-plan-add">${ICON.plus} Prüfart</button></p>
        <p class="note"><strong>Vorschlag ohne Gewähr</strong> für ${esc(type?.name || 'diese Art')}: ${(type?.plans || []).length ? type.plans.map((p) => `${esc(PRUEFARTEN[p.kind]?.name || p.kind)} alle ${p.months} Monate`).join(', ') : 'keine Prüfart'}. ${[...new Set(d.plans.map((p) => PRUEFARTEN[p.kind]?.basis).filter(Boolean))].map(esc).join('; ')}. Keine Rechtsauskunft: Intervalle mit der Sicherheitsfachkraft bestätigen.</p>
      </section>
      <section><h3>Fotos und Dokumente</h3>
        <div class="ek-beleg-bar anl-files"><label class="btn">${ICON.camera} Foto<input type="file" accept="image/*" capture="environment" data-change="gr-photo" hidden></label><label class="btn">${ICON.upload} Bedienungsanleitung<input type="file" accept="application/pdf,image/*" data-change="gr-doc" data-kind="anleitung" hidden></label><label class="btn">${ICON.upload} Rechnung<input type="file" accept="application/pdf,image/*" data-change="gr-doc" data-kind="rechnung" hidden></label></div>
        ${kept.length || pending.length ? `<p class="anl-pending">${[...kept, ...pending].join(' ')}</p>` : '<p class="muted small">Fotos und Dokumente kommen beim Speichern nach SharePoint.</p>'}
      </section>`,
    foot: `<div class="actions">${existing && !doc().checks.some((x) => x.itemId === existing.id) && !doc().repairs.some((x) => x.itemId === existing.id) ? `<button class="btn danger" data-action="gr-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `gr-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="gr-save">Speichern</button></div>`,
  })
}
registerModal('gr-edit', editModal, { module: MODULE })

/** Neue Dateien eines Dialogs ablegen: { photos, docs, failed }. */
async function storeNew(list, base) {
  const out = { photos: [], docs: [], failed: 0 }
  for (const [i, f] of list.entries()) {
    const meta = await storeFile(f.file, `${base}_${f.kind === 'photo' ? 'foto' : f.kind}-${i + 1}`)
    if (!meta) out.failed++
    else if (f.kind === 'photo') out.photos.push(meta)
    else out.docs.push({ ...meta, kind: f.kind })
  }
  return out
}
const filesBase = (item, what, date = todayISO()) => `geraete/dateien/${date.slice(0, 4)}/${fileSafe(item.no)}_${what}_${date}_${uid('f')}`

async function saveItem() {
  const m = app.ui.modal
  const d = readItem()
  const problem = itemProblem(d, doc().items)
  if (problem) return toast(problem)
  const meta = { date: todayISO(), by: user(), at: nowIso() }
  const old = d.id ? itemOf(d.id) : null
  let item = { ...d, plans: d.plans.map((p) => ({ ...p, months: Number(p.months) || '' })) }
  if (!old) {
    item.status = 'betrieb'
    item.id = uid('gr')
    item.createdAt = meta.at
    item.createdBy = meta.by
    item.history = [{ at: meta.at, date: meta.date, kind: 'angelegt', by: meta.by }]
  } else {
    // Zustand und Standort mit Eintrag im Verlauf
    item = { ...item, status: old.status, statusSince: old.statusSince, statusNote: old.statusNote, home: old.home, history: old.history || [] }
    item = withHome(item, d.home, meta)
  }
  if (d.status !== (old?.status || 'betrieb')) item = withStatus(item, d.status, { ...meta, note: d.statusNote })
  const files = m.newFiles || []
  if (files.length) {
    toast('Wird gespeichert …')
    const res = await storeNew(files, filesBase(item, 'geraet'))
    item.photos = [...(item.photos || []), ...res.photos]
    item.docs = [...(item.docs || []), ...res.docs]
    if (res.failed) toast(`${plural(res.failed, 'Datei', 'Dateien')} nicht gespeichert.`)
  }
  item.changedAt = meta.at
  item.changedBy = meta.by
  doc().items = old ? doc().items.map((i) => (i.id === old.id ? item : i)) : [...doc().items, item]
  persist()
  closeModal()
  renderNow()
  const r = rowById(item.id)
  toast(`${old ? 'Gespeichert' : `${item.no} angelegt`}${r && r.dues.length ? `: ${dueText(r)}` : ''}.`)
}

// ---------------------------------------------------------------- Prüfung erfassen

function checkDraft(m) {
  if (!m.draft) {
    const item = m.id ? itemOf(m.id) : null
    const r = item ? rowOf({ item, doc: doc(), today: todayISO() }) : null
    const urgent = r?.dues.slice().sort((a, b) => (a.next || '0').localeCompare(b.next || '0'))[0]
    // gesperrt nach einer Prüfung: dieselbe Prüfart wieder (z. B. E-Prüfung nach der Reparatur)
    const blocker = item?.status === 'gesperrt' ? doc().checks.filter((c) => c.itemId === item.id && c.result === 'gesperrt' && r?.dues.some((d) => d.plan.id === c.planId)).sort((a, b) => b.date.localeCompare(a.date))[0] : null
    m.draft = { itemId: item?.id || '', planId: m.plan || blocker?.planId || urgent?.plan.id || '', date: todayISO(), result: 'ok', defects: '', values: '', by: user(), note: '', release: true, repair: true, report: null }
  }
  return m.draft
}

function readCheck() {
  const d = checkDraft(app.ui.modal)
  if (!document.getElementById('grc-date')) return d
  const itemId = val('grc-item')
  if (itemId !== d.itemId) {
    const item = itemOf(itemId)
    const r = item ? rowOf({ item, doc: doc(), today: todayISO() }) : null
    d.planId = r?.dues.slice().sort((a, b) => (a.next || '0').localeCompare(b.next || '0'))[0]?.plan.id || ''
  } else d.planId = val('grc-plan')
  Object.assign(d, {
    itemId,
    date: val('grc-date'),
    result: document.querySelector('input[name="grc-result"]:checked')?.value || d.result,
    defects: document.getElementById('grc-defects') ? val('grc-defects') : d.defects,
    values: val('grc-values'),
    by: val('grc-by'),
    note: val('grc-note'),
    release: document.getElementById('grc-release') ? checked('grc-release') : d.release,
    repair: document.getElementById('grc-repair') ? checked('grc-repair') : d.repair,
  })
  return d
}

function checkModal(c, m) {
  const d = checkDraft(m)
  const today = todayISO()
  const rows = rowsAt(today).filter((r) => r.status !== 'ausgeschieden' && r.dues.length)
  const item = itemOf(d.itemId)
  const r = item ? rowOf({ item, doc: doc(), today }) : null
  const plan = item?.plans?.find((p) => p.id === d.planId)
  const next = plan && d.date ? nextAfter(plan, d.date) : ''
  const radio = (v) => `<label class="check anl-result"><input type="radio" name="grc-result" value="${v}" ${d.result === v ? 'checked' : ''} data-change="gr-check-redraw"><span><span class="pill ${RESULT_CLS[v]}">${esc(RESULTS[v])}</span></span></label>`
  const people = [...new Set([...activeEmployees().map((e) => e.name), ...supplierNames()])]
  return modalFrame({
    title: 'Prüfung erfassen',
    subtitle: item ? `${esc(item.no)} · ${esc(item.name)}${r ? ` · ${esc(STATUS[r.status])}` : ''}` : 'Gerät wählen',
    body: `<div class="form-grid">
        <label class="field"><span>Gerät</span><select id="grc-item" data-change="gr-check-redraw">${options(rows.map((x) => [x.item.id, `${x.item.no} ${x.item.name}${x.state === 'ueberfaellig' ? ' (überfällig)' : x.state === 'faellig' ? ' (fällig)' : ''}`]), d.itemId, { empty: '– Gerät –' })}</select></label>
        <label class="field"><span>Prüfart</span><select id="grc-plan" data-change="gr-check-redraw">${options((r?.dues || []).map((x) => [x.plan.id, `${planName(x.plan)} (${dueOfPlan(x)})`]), d.planId, { empty: item ? '– Prüfart –' : '– zuerst das Gerät –' })}</select></label>
        <label class="field"><span>Geprüft am</span><input type="date" id="grc-date" value="${esc(d.date)}" max="${today}" data-change="gr-check-redraw"></label>
        <label class="field"><span>Geprüft von</span><input type="text" id="grc-by" list="grc-people" value="${esc(d.by)}" placeholder="Name oder Firma">${datalist('grc-people', people)}</label>
      </div>
      <fieldset class="anl-results"><legend>Ergebnis</legend>${radio('ok')}${radio('maengel')}${radio('gesperrt')}</fieldset>
      <div class="form-grid">
        ${d.result !== 'ok' ? `<label class="field wide"><span>${d.result === 'gesperrt' ? 'Warum gesperrt' : 'Mängel'}</span><textarea id="grc-defects" rows="2" placeholder="z. B. Isolation am Kabel beschädigt, Stecker locker">${esc(d.defects)}</textarea></label>` : ''}
        <label class="field wide"><span>Messwerte (frei)</span><textarea id="grc-values" rows="2" placeholder="z. B. Schutzleiter 0,12 Ω, Isolation > 2 MΩ, Ableitstrom 0,3 mA">${esc(d.values)}</textarea></label>
        <label class="field wide"><span>Notiz (optional)</span><input type="text" id="grc-note" value="${esc(d.note)}" placeholder="z. B. Prüfplakette angebracht"></label>
      </div>
      ${d.result === 'gesperrt' ? '<p class="banner warn-banner">Das Gerät wird außer Betrieb gesetzt und nicht mehr ausgegeben, bis eine Prüfung „in Ordnung“ es freigibt.</p>' : ''}
      ${d.result !== 'ok' ? `<label class="check"><input type="checkbox" id="grc-repair" ${d.repair ? 'checked' : ''}><span>als Schaden für die Reparatur vormerken</span></label>` : ''}
      ${d.result === 'ok' && r?.status === 'gesperrt' ? `<label class="check"><input type="checkbox" id="grc-release" ${d.release ? 'checked' : ''}><span>Gerät wieder in Betrieb nehmen (ist außer Betrieb${item.statusNote ? `: ${esc(item.statusNote)}` : ''})</span></label>` : ''}
      <div class="ek-beleg-bar anl-files"><label class="btn">${ICON.upload} Protokoll (PDF)<input type="file" accept="application/pdf,image/*" data-change="gr-report" hidden></label>${d.report ? `<span class="pill anl-file">${ICON.download} ${esc(d.report.name)} <button type="button" class="btn small ghost" data-action="gr-report-del" aria-label="Protokoll entfernen">${ICON.close}</button></span>` : '<span class="muted small">Das Protokoll kommt nach SharePoint.</span>'}</div>
      ${next ? `<p class="note">Nächste ${esc(planShort(plan))} danach: <strong>${short(next)}</strong> (ab dem Prüfdatum, alle ${plan.months} Monate; Vorschlag ohne Gewähr, Intervall am Gerät änderbar).</p>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="gr-check-save">Prüfung eintragen</button></div>`,
  })
}
registerModal('gr-check', checkModal, { module: MODULE })

async function saveCheck() {
  const d = readCheck()
  const item = itemOf(d.itemId)
  const problem = checkProblem(d, todayISO(), item)
  if (problem) return toast(problem)
  let report = null
  if (d.report) {
    toast('Protokoll wird gespeichert …')
    report = await storeFile(d.report, `${filesBase(item, 'protokoll', d.date)}`)
    if (!report) return
  }
  const at = nowIso()
  const res = addCheck({ checks: doc().checks, item, input: { ...d, report }, newId: () => uid('gc'), at, user: user(), release: d.release })
  doc().checks = res.checks
  let next = res.item
  let repairNote = ''
  if (d.result !== 'ok' && d.repair) {
    const rep = saveRepair({ repairs: doc().repairs, item: next, input: { date: d.date, text: `${RESULTS[d.result]} bei der ${planShort(item.plans.find((p) => p.id === d.planId))}: ${d.defects.trim()}`, reportedBy: d.by }, newId: () => uid('gs'), at, user: user() })
    doc().repairs = rep.repairs
    next = rep.item
    repairNote = '; Schaden unter „Reparaturen“ vorgemerkt'
  }
  doc().items = doc().items.map((i) => (i.id === item.id ? next : i))
  persist()
  closeModal()
  renderNow()
  const r = rowById(item.id)
  toast(`Prüfung eingetragen${res.change === 'gesperrt' ? `: ${item.no} ist außer Betrieb` : res.change === 'frei' ? `: ${item.no} wieder in Betrieb` : ''}${r?.next ? `, nächste Prüfung am ${short(r.next)}` : ''}${repairNote}.`)
}

// ---------------------------------------------------------------- Schaden und Reparatur

function repairDraft(m) {
  if (!m.draft) {
    const old = m.id ? repairOf(m.id) : null
    m.draft = old ? { ...structuredClone(old), cost: numText(old.cost) } : { id: '', itemId: m.item || '', date: todayISO(), objectId: itemOf(m.item)?.issued?.kind === 'objekt' ? itemOf(m.item).issued.id : '', text: '', status: 'gemeldet', workshop: '', cost: '', doneOn: '', invoice: null, note: '', photos: [], reportedBy: user() }
    m.block = false
    m.newPhotos = []
  }
  return m.draft
}

function readRepair() {
  const m = app.ui.modal
  const d = repairDraft(m)
  if (!document.getElementById('grr-text')) return d
  const invId = document.getElementById('grr-invoice') ? val('grr-invoice') : null
  Object.assign(d, {
    itemId: val('grr-item'),
    date: val('grr-date'),
    objectId: val('grr-obj'),
    text: val('grr-text'),
    status: document.getElementById('grr-status') ? val('grr-status') : d.status,
    workshop: document.getElementById('grr-workshop') ? val('grr-workshop').trim() : d.workshop,
    cost: document.getElementById('grr-cost') ? val('grr-cost').trim() : d.cost,
    doneOn: document.getElementById('grr-done') ? val('grr-done') : d.doneOn,
    note: document.getElementById('grr-note') ? val('grr-note').trim() : d.note,
  })
  if (invId !== null) d.invoice = invId ? invoiceRef(invId) : null
  if (document.getElementById('grr-block')) m.block = checked('grr-block')
  if (d.status === 'erledigt' && !d.doneOn) d.doneOn = todayISO()
  return d
}

const invoiceNet = (x) => Math.round((x.groups || []).reduce((s, g) => s + (Number(g.net) || 0), 0) * 100) / 100
function invoiceRef(id) {
  const x = (app.data.einkauf?.invoices || []).find((i) => i.id === id)
  return x ? { id: x.id, no: x.no, number: x.number || '', supplier: x.supplier?.name || '', net: invoiceNet(x) } : null
}
/** Eingangsrechnungen zur Auswahl (wer Einkauf & Kasse sieht): passende Werkstatt zuerst, sonst die neuesten. */
function invoiceOptions(d) {
  const w = String(d.workshop || '').trim().toLowerCase()
  const list = (app.data.einkauf?.invoices || []).filter((x) => !x.cancelled && x.date >= addDays(todayISO(), -400))
  const score = (x) => (w && String(x.supplier?.name || '').toLowerCase() === w ? 0 : 1)
  return list.sort((a, b) => score(a) - score(b) || (b.date || '').localeCompare(a.date || '')).slice(0, 60).map((x) => [x.id, `${x.no}${x.number ? ` (${x.number})` : ''} · ${x.supplier?.name || ''} · ${short(x.date)} · ${euro(invoiceNet(x))}`])
}

function repairModal(c, m) {
  const d = repairDraft(m)
  const old = d.id ? repairOf(d.id) : null
  const item = itemOf(d.itemId)
  const live = rowsAt().filter((r) => r.status !== 'ausgeschieden' || r.item.id === d.itemId)
  const done = d.status === 'erledigt'
  const invoiceField = sees('einkauf')
    ? `<label class="field wide"><span>Eingangsrechnung (Einkauf &amp; Kasse, nur verknüpfen)</span><select id="grr-invoice" data-change="gr-repair-redraw">${options(invoiceOptions(d), d.invoice?.id || '', { empty: '– keine –' })}</select></label>${d.invoice && Number(d.invoice.net) > 0 && parseNum(d.cost) !== Number(d.invoice.net) ? `<p><button class="btn small" data-action="gr-repair-cost">Kosten aus der Rechnung übernehmen (${euro(d.invoice.net)})</button></p>` : ''}`
    : d.invoice ? `<p class="muted wide">Verknüpft mit der Eingangsrechnung ${esc(d.invoice.no)}${d.invoice.number ? ` (${esc(d.invoice.number)})` : ''}.</p>` : ''
  const pending = [...(d.photos || []).map((f, i) => fileChip(f, i, `data-repair="${esc(d.id)}"`)), ...(m.newPhotos || []).map((f, i) => `<span class="pill anl-file">${ICON.camera} ${esc(f.name)} <button type="button" class="btn small ghost" data-action="gr-repair-photo-del" data-i="${i}" aria-label="Foto entfernen">${ICON.close}</button></span>`)].join(' ')
  const log = old?.log?.length ? `<p class="muted small">${old.log.map((l) => `${esc(REPAIR_STATUS[l.status] || l.status)} ${l.at ? short(dayAt(l.at)) : ''}${l.by ? ` (${esc(l.by)})` : ''}`).join(' · ')}</p>` : ''
  return modalFrame({
    title: old ? (item ? `Reparatur ${item.no}` : 'Schaden vom Handy zuordnen') : 'Schaden melden',
    subtitle: item ? esc(item.name) : old?.source === 'handy' ? `gemeldet von ${esc(old.reportedBy || '')} über „Mein Dienstplan“` : 'Gerät, Objekt und was kaputt ist',
    body: `<div class="form-grid">
        <label class="field"><span>Gerät</span><select id="grr-item" data-change="gr-repair-redraw">${options(live.map((r) => [r.item.id, `${r.item.no} ${r.item.name}`]), d.itemId, { empty: '– Gerät –' })}</select></label>
        <label class="field"><span>Gemeldet am</span><input type="date" id="grr-date" value="${esc(d.date)}" max="${todayISO()}"></label>
        <label class="field"><span>Objekt (wo es passiert ist)</span><select id="grr-obj">${options(objectOptions(d.objectId), d.objectId || '', { empty: '– keines –' })}</select></label>
        <label class="field wide"><span>Was ist kaputt?</span><textarea id="grr-text" rows="3" placeholder="z. B. Saugschlauch gerissen, Kabel angeschmort">${esc(d.text)}</textarea></label>
      </div>
      <div class="ek-beleg-bar anl-files"><label class="btn">${ICON.camera} Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-change="gr-repair-photo" hidden></label>${pending ? `<span class="anl-pending">${pending}</span>` : '<span class="muted small">Fotos kommen nach SharePoint.</span>'}</div>
      ${!old && item && item.status !== 'gesperrt' ? `<label class="check"><input type="checkbox" id="grr-block" ${m.block ? 'checked' : ''}><span>Gerät nicht mehr verwenden (außer Betrieb setzen)</span></label>` : ''}
      <section><h3>Reparatur</h3><div class="form-grid">
        <label class="field"><span>Stand</span><select id="grr-status" data-change="gr-repair-redraw">${options(Object.entries(REPAIR_STATUS), d.status)}</select></label>
        <label class="field"><span>Werkstatt</span><input type="text" id="grr-workshop" value="${esc(d.workshop || '')}" list="grr-ws" placeholder="z. B. Händler oder eigene Leute">${datalist('grr-ws', supplierNames())}</label>
        <label class="field"><span>Kosten (netto, €)</span><input type="text" inputmode="decimal" id="grr-cost" value="${esc(d.cost ?? '')}" placeholder="z. B. 148,50"></label>
        ${done ? `<label class="field"><span>Erledigt am</span><input type="date" id="grr-done" value="${esc(d.doneOn || '')}" max="${todayISO()}"></label>` : ''}
        ${invoiceField}
        <label class="field wide"><span>Notiz</span><input type="text" id="grr-note" value="${esc(d.note || '')}" placeholder="z. B. Kostenvoranschlag abwarten"></label>
      </div>${log}</section>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="gr-repair-save">${old ? 'Speichern' : 'Schaden melden'}</button></div>`,
  })
}
registerModal('gr-repair', repairModal, { module: MODULE })

async function saveRepairAction() {
  const m = app.ui.modal
  const d = readRepair()
  const problem = repairProblem({ ...d, cost: d.cost === '' ? '' : parseNum(d.cost) }, todayISO())
  if (problem) return toast(problem)
  const item = itemOf(d.itemId)
  let photos = d.photos || []
  if (m.newPhotos?.length) {
    toast('Fotos werden gespeichert …')
    const res = await storeNew(m.newPhotos.map((file) => ({ kind: 'photo', file })), filesBase(item, 'schaden', d.date))
    photos = [...photos, ...res.photos]
    if (res.failed) toast(`${plural(res.failed, 'Foto', 'Fotos')} nicht gespeichert.`)
  }
  const res = saveRepair({ repairs: doc().repairs, item, input: { ...d, photos, cost: d.cost === '' ? '' : parseNum(d.cost) }, newId: () => uid('gs'), at: nowIso(), user: user(), block: m.block })
  doc().repairs = res.repairs
  doc().items = doc().items.map((i) => (i.id === item.id ? res.item : i))
  persist()
  closeModal()
  renderNow()
  toast(`${d.id ? 'Reparatur gespeichert' : 'Schaden gemeldet'}${res.item.status !== item.status ? `: ${item.no} ist jetzt ${STATUS[res.item.status]}` : ''}.`)
}

// ---------------------------------------------------------------- Ausgabe und Rücknahme

function issueDraft(m) {
  if (!m.draft) {
    const item = m.id ? itemOf(m.id) : null
    m.draft = { itemId: item?.id || '', kind: 'objekt', toId: '', date: todayISO(), due: '', note: '' }
  }
  return m.draft
}
function readIssue() {
  const d = issueDraft(app.ui.modal)
  if (!document.getElementById('gri-date')) return d
  const kind = document.querySelector('input[name="gri-kind"]:checked')?.value || d.kind
  Object.assign(d, { itemId: val('gri-item'), toId: kind === d.kind && document.getElementById('gri-to') ? val('gri-to') : '', kind, date: val('gri-date'), due: document.getElementById('gri-due') ? val('gri-due') : '', note: val('gri-note') })
  return d
}

function issueModal(c, m) {
  const d = issueDraft(m)
  const item = itemOf(d.itemId)
  const back = !!item?.issued
  const choices = rowsAt().filter((r) => r.status !== 'ausgeschieden' && (r.status === 'betrieb' || r.item.issued))
  const radio = (v, label) => `<label class="check"><input type="radio" name="gri-kind" value="${v}" ${d.kind === v ? 'checked' : ''} data-change="gr-issue-redraw"><span>${label}</span></label>`
  const to = d.kind === 'person' ? activeEmployees().map((e) => [e.id, e.name]) : objectOptions()
  const problem = item && !back && item.status !== 'betrieb' ? issueProblem(item, { to: { kind: 'objekt', id: 'x' }, date: d.date }) : ''
  return modalFrame({
    title: back ? 'Gerät zurücknehmen' : 'Gerät ausgeben',
    subtitle: item ? `${esc(item.no)} · ${esc(item.name)}${back ? ` · bei ${esc(item.issued.label)} seit ${short(item.issued.since)}` : ''}` : 'an ein Objekt oder eine Person',
    body: `<div class="form-grid">
        <label class="field"><span>Gerät</span><select id="gri-item" data-change="gr-issue-redraw">${options(choices.map((r) => [r.item.id, `${r.item.no} ${r.item.name}${r.item.issued ? ` (bei ${r.item.issued.label})` : ''}`]), d.itemId, { empty: '– Gerät –' })}</select></label>
        <label class="field"><span>${back ? 'Zurück am' : 'Ausgegeben am'}</span><input type="date" id="gri-date" value="${esc(d.date)}"></label>
      </div>
      ${problem ? `<p class="banner warn-banner">${esc(problem)}</p>` : ''}
      ${back ? `<p>Das Gerät kommt zurück an den Standort <strong>${esc(item.home?.label || HOME_KINDS[item.home?.kind] || 'Lager')}</strong>.</p>` : `<fieldset class="anl-results"><legend>Ausgeben an</legend>${radio('objekt', 'Objekt')}${radio('person', 'Person')}</fieldset>
      <div class="form-grid"><label class="field"><span>${d.kind === 'person' ? 'Person' : 'Objekt'}</span><select id="gri-to">${options(to, d.toId, { empty: d.kind === 'person' ? '– Person –' : '– Objekt –' })}</select></label>
        <label class="field"><span>Zurück bis (optional)</span><input type="date" id="gri-due" value="${esc(d.due)}"></label></div>`}
      <div class="form-grid"><label class="field wide"><span>Notiz (optional)</span><input type="text" id="gri-note" value="${esc(d.note)}" placeholder="${back ? 'z. B. sauber, Bürsten abgenützt' : 'z. B. für die Grundreinigung'}"></label></div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="${back ? 'gr-return-save' : 'gr-issue-save'}">${back ? 'Zurücknehmen' : 'Ausgeben'}</button></div>`,
  })
}
registerModal('gr-issue', issueModal, { module: MODULE })

// ---------------------------------------------------------------- Arten und Prüfintervalle

const TYPE_KINDS = ['elektro', 'wartung', 'leiter']
function typesModal() {
  const m = app.ui.modal
  m.rows ||= structuredClone(allTypes(doc()))
  const monthsOf = (t, kind) => t.plans?.find((p) => p.kind === kind)?.months || ''
  const rows = m.rows
    .map((t, i) => `<tr><td><input type="text" id="grt-name-${i}" value="${esc(t.name)}" aria-label="Name"></td>${TYPE_KINDS.map((k) => `<td><input type="number" id="grt-${k}-${i}" min="0" max="120" value="${esc(monthsOf(t, k))}" class="num-input" aria-label="${esc(PRUEFARTEN[k].short)} in Monaten"></td>`).join('')}<td><label class="check"><input type="checkbox" id="grt-active-${i}" ${t.active !== false ? 'checked' : ''}><span>aktiv</span></label></td></tr>`)
    .join('')
  return modalFrame({
    title: 'Arten und Prüfintervalle',
    subtitle: 'Vorschläge für neue Geräte (Monate, leer = keine Prüfung)',
    wide: true,
    body: `<div class="table-wrap"><table class="data gr-types"><thead><tr><th>Art</th>${TYPE_KINDS.map((k) => `<th>${esc(PRUEFARTEN[k].short)}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><button class="btn small" data-action="gr-type-add">${ICON.plus} Art</button></p>
      <p class="note"><strong>Vorschlag ohne Gewähr, keine Rechtsauskunft.</strong> ${TYPE_KINDS.map((k) => `${esc(PRUEFARTEN[k].name)}: ${esc(PRUEFARTEN[k].basis)}`).join('. ')}. Die Intervalle legt der Betrieb nach der Evaluierung fest (mit der Sicherheitsfachkraft bestätigen). Vorhandene Geräte behalten ihre Prüfarten; geändert wird je Gerät unter „Bearbeiten“.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="gr-types-save">Speichern</button></div>`,
  })
}
registerModal('gr-types', typesModal, { module: MODULE })

function readTypes() {
  const m = app.ui.modal
  m.rows = m.rows.map((t, i) => {
    const keep = (t.plans || []).filter((p) => !TYPE_KINDS.includes(p.kind))
    const plans = TYPE_KINDS.map((k) => ({ kind: k, months: Math.max(0, Math.round(Number(val(`grt-${k}-${i}`)) || 0)) })).filter((p) => p.months > 0)
    return { ...t, name: val(`grt-name-${i}`).trim(), plans: [...plans, ...keep], active: checked(`grt-active-${i}`) }
  })
  return m.rows
}

// ---------------------------------------------------------------- Etikett, Export

async function labels(items) {
  if (!items.length) return toast('Keine Geräte in der Auswahl.')
  const base = `${location.origin}${location.pathname}`
  const types = new Map(allTypes(doc()).map((t) => [t.id, t.name]))
  const pdf = labelDocument({ items, base, types, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  download(labelPdfName(items, todayISO()), await pdfBlob(pdf))
}

const csvColumns = [
  ['Inventarnummer', (r) => r.item.no],
  ['Bezeichnung', (r) => r.item.name],
  ['Art', (r) => r.type?.name || ''],
  ['Hersteller', (r) => r.item.maker || ''],
  ['Typ', (r) => r.item.model || ''],
  ['Seriennummer', (r) => r.item.serial || ''],
  ['Kaufdatum', (r) => r.item.boughtOn || ''],
  ['Kaufpreis netto', (r) => numText(r.item.price)],
  ['Lieferant', (r) => r.item.supplierName || ''],
  ['Standort', (r) => r.item.home?.label || ''],
  ['ausgegeben an', (r) => r.item.issued?.label || ''],
  ['verantwortlich', (r) => r.item.responsibleName || ''],
  ['Zustand', (r) => STATUS[r.status]],
  ['nächste Prüfung', (r) => r.next || ''],
  ['Prüfung', (r) => dueText(r)],
]
const currentFilter = () => ({ typeId: app.ui.grType || '', location: app.ui.grLoc || '', status: app.ui.grStatus || '', due: app.ui.grDue || '', q: app.ui.grQ || '' })

// ---------------------------------------------------------------- Aktionen

registerActions({
  'gr-tab': (el) => {
    app.ui.grTab = el.dataset.v
    renderNow()
  },
  'gr-filter': () => {
    Object.assign(app.ui, { grQ: val('gr-f-q'), grType: val('gr-f-type'), grLoc: val('gr-f-loc'), grStatus: val('gr-f-status'), grDue: val('gr-f-due') })
    renderNow()
  },
  'gr-reset': () => {
    Object.assign(app.ui, { grQ: '', grType: '', grLoc: '', grStatus: '', grDue: '' })
    renderNow()
  },
  // aus „Zu erledigen“, dem digitalen Mitarbeiter und dem Einsatz-Dialog: Gerätekarte bzw. Reiter
  'gr-goto': (el) => {
    Object.assign(app.ui, { view: 'geraete', grTab: el.dataset.tab || 'liste' })
    if (el.dataset.loc !== undefined || el.dataset.status !== undefined) Object.assign(app.ui, { grQ: '', grType: '', grLoc: el.dataset.loc || '', grStatus: '', grDue: el.dataset.status || '' })
    if (app.ui.modal) closeModal()
    renderNow()
    if (el.dataset.id && itemOf(el.dataset.id)) openModal({ type: 'gr-card', id: el.dataset.id })
  },
  'gr-card-open': (el) => openModal({ type: 'gr-card', id: el.dataset.id }),
  'gr-rep-all': () => {
    app.ui.grRepAll = checked('gr-rep-all')
    renderNow()
  },
  'gr-cost-span': () => {
    app.ui.grCost = val('gr-cost-span')
    renderNow()
  },
  'gr-file': (el) => {
    const d = el.dataset
    if (d.check) return openFile(checkOf(d.check)?.report)
    if (d.repair) return openFile(repairOf(d.repair)?.photos?.[Number(d.i)])
    const item = itemOf(d.item)
    openFile(d.kind === 'doc' ? item?.docs?.[Number(d.i)] : item?.photos?.[Number(d.i)])
  },
  'gr-label': (el) => {
    const item = itemOf(el.dataset.id)
    if (item) labels([item])
  },
  'gr-labels': () => labels(filterRows(rowsAt(), currentFilter()).map((r) => r.item)),
  'gr-csv': () => download(`Geraete_${todayISO()}.csv`, new Blob([`﻿${toCSV(filterRows(rowsAt(), currentFilter()), csvColumns)}`], { type: 'text/csv;charset=utf-8' })),
  'gr-cost-csv': () => {
    const cols = [
      ['Inventarnummer', (x) => x.r.item.no],
      ['Bezeichnung', (x) => x.r.item.name],
      ['Art', (x) => x.r.type?.name || ''],
      ['Reparaturen', (x) => x.count],
      ['Kosten netto', (x) => numText(x.cost)],
      ['Kaufpreis netto', (x) => numText(x.price || '')],
    ]
    download(`Geraete_Reparaturkosten_${todayISO()}.csv`, new Blob([`﻿${toCSV(costRows(rowsAt()), cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
})

registerActions(
  {
    'gr-edit-open': (el) => openModal({ type: 'gr-edit', id: el.dataset.id || '' }),
    'gr-redraw': () => {
      readItem()
      renderModal()
    },
    'gr-plan-add': () => {
      const d = readItem()
      app.ui.modal.plansTouched = true
      d.plans.push({ id: uid('gp'), kind: 'sonstige', label: '', months: 12, firstDue: '', active: true })
      renderModal()
    },
    'gr-plan-del': (el) => {
      const d = readItem()
      app.ui.modal.plansTouched = true
      d.plans = d.plans.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'gr-photo': (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      readItem()
      app.ui.modal.newFiles = [...(app.ui.modal.newFiles || []), ...files.map((file) => ({ kind: 'photo', file }))].slice(0, 8)
      renderModal()
    },
    'gr-doc': (el) => {
      const file = el.files?.[0]
      if (!file) return
      readItem()
      app.ui.modal.newFiles = [...(app.ui.modal.newFiles || []), { kind: el.dataset.kind || 'sonstiges', file }]
      renderModal()
    },
    'gr-file-del': (el) => {
      const d = readItem()
      const m = app.ui.modal
      if (el.dataset.new !== undefined) m.newFiles = m.newFiles.filter((_, i) => i !== Number(el.dataset.new))
      else if (el.dataset.kind === 'doc') d.docs = d.docs.filter((_, i) => i !== Number(el.dataset.i))
      else d.photos = d.photos.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'gr-save': () => saveItem(),
    'gr-delete': (el) => {
      if (!confirmStep(`gr-del:${el.dataset.id}`, renderModal)) return
      doc().items = doc().items.filter((i) => i.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Gerät gelöscht. Fotos und Dokumente bleiben in SharePoint.')
    },
    'gr-check-open': (el) => openModal({ type: 'gr-check', id: el.dataset.id || '', plan: el.dataset.plan || '' }),
    'gr-check-redraw': () => {
      readCheck()
      renderModal()
    },
    'gr-report': (el) => {
      const file = el.files?.[0]
      if (!file) return
      readCheck().report = file
      renderModal()
    },
    'gr-report-del': () => {
      readCheck().report = null
      renderModal()
    },
    'gr-check-save': () => saveCheck(),
    'gr-check-delete': (el) => {
      if (!confirmStep(`gr-cdel:${el.dataset.id}`, renderModal)) return
      doc().checks = doc().checks.filter((c) => c.id !== el.dataset.id)
      persist()
      renderModal()
      renderNow()
      toast('Prüfung gelöscht. Der Zustand des Geräts bleibt; das Protokoll bleibt in SharePoint.')
    },
    'gr-repair-open': (el) => openModal({ type: 'gr-repair', id: el.dataset.id || '', item: el.dataset.item || '' }),
    'gr-repair-redraw': () => {
      readRepair()
      renderModal()
    },
    'gr-repair-photo': (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      readRepair()
      app.ui.modal.newPhotos = [...(app.ui.modal.newPhotos || []), ...files].slice(0, 6)
      renderModal()
    },
    'gr-repair-photo-del': (el) => {
      readRepair()
      app.ui.modal.newPhotos = app.ui.modal.newPhotos.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'gr-repair-cost': () => {
      const d = readRepair()
      if (d.invoice) d.cost = numText(d.invoice.net)
      renderModal()
    },
    'gr-repair-save': () => saveRepairAction(),
    'gr-issue-open': (el) => openModal({ type: 'gr-issue', id: el.dataset.id || '' }),
    'gr-issue-redraw': () => {
      readIssue()
      renderModal()
    },
    'gr-issue-save': () => {
      const d = readIssue()
      const item = itemOf(d.itemId)
      if (!item) return toast('Bitte das Gerät wählen.')
      const to = { kind: d.kind, id: d.toId, label: d.kind === 'person' ? empName(d.toId) : objName(d.toId) }
      const problem = issueProblem(item, { to, date: d.date })
      if (problem) return toast(problem)
      doc().items = doc().items.map((i) => (i.id === item.id ? issue(i, { to, date: d.date, due: d.due, by: user(), note: d.note, at: nowIso() }) : i))
      persist()
      closeModal()
      renderNow()
      toast(`${item.no} ausgegeben an ${to.label}.`)
    },
    'gr-return-save': () => {
      const d = readIssue()
      const item = itemOf(d.itemId)
      if (!item?.issued) return toast('Das Gerät ist nicht ausgegeben.')
      if (!d.date) return toast('Bitte das Datum eintragen.')
      doc().items = doc().items.map((i) => (i.id === item.id ? takeBack(i, { date: d.date, by: user(), note: d.note, at: nowIso() }) : i))
      persist()
      closeModal()
      renderNow()
      toast(`${item.no} zurück${item.home?.label ? ` (${item.home.label})` : ''}.`)
    },
    'gr-types-open': () => openModal({ type: 'gr-types' }),
    'gr-type-add': () => {
      readTypes().push({ id: uid('gt'), name: 'Neue Art', plans: [], active: true })
      renderModal()
    },
    'gr-types-save': () => {
      const rows = readTypes()
      if (rows.some((t) => !t.name)) return toast('Jede Art braucht einen Namen.')
      doc().types = rows
      persist()
      closeModal()
      renderNow()
      toast('Arten gespeichert. Vorhandene Geräte behalten ihre Prüfarten.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen, digitaler Mitarbeiter, Objekt

const attentionAt = (today) => memo(app.cur, `geraete-att:${today}`, () => attention(rowsAt(today), doc().repairs))
const lines = (g) => [
  ...(g.blocked ? [`außer Betrieb${g.row.item.statusNote ? `: ${g.row.item.statusNote}` : ''}`] : []),
  ...g.due.map((d) => `${planShort(d.plan)}: ${dueOfPlan(d)}`),
  ...g.reports.map((r) => `Schaden gemeldet${r.reportedBy ? ` von ${r.reportedBy}` : ''}: ${r.text}`),
]

registerTodo({
  id: 'geraete',
  module: MODULE,
  title: 'Geräte & Maschinen',
  compute: (today) => attentionAt(today).map((g) => ({ ...g, id: `${g.id || 'meldung'}:${g.due.map((d) => `${d.plan.id}-${d.state}-${d.next}`).join(',')}:${g.blocked ? 'x' : ''}:${g.reports.map((r) => r.id).join(',')}` })),
  render: (list) =>
    list
      .map((g) => {
        const l = lines(g)
        return `<div class="todo-item"><span class="flag ${isUrgent(g) ? 'error' : 'warning'}">${l.length}</span><div class="todo-text"><strong>${esc(g.row ? devName(g.row.item) : 'Schaden vom Handy: Gerät zuordnen')}</strong><br><span class="muted">${esc(l.slice(0, 4).join(' · '))}${l.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="gr-goto" ${g.row ? `data-id="${esc(g.row.item.id)}"` : 'data-tab="reparaturen"'}>Öffnen</button></div>`
      })
      .join(''),
})

// digitaler Mitarbeiter „Fristen“: je Gerät ein Vorschlag, nur „Öffnen“ (nichts automatisch)
FRISTEN_HOOKS.push((today) => {
  if (!editable() || !app.data.geraete) return []
  return attentionAt(today).map((g) => ({
    id: `gr:${g.id}:${g.due.map((d) => `${d.plan.id}${d.state}${d.next}`).join(',')}:${g.blocked ? 'x' : ''}:${g.reports.map((r) => r.id).join(',')}`,
    agent: 'fristen',
    prio: isUrgent(g) ? 1 : 2,
    title: `${g.row ? devName(g.row.item) : 'Schaden vom Handy'}: ${[g.blocked ? 'außer Betrieb' : '', g.due.length ? `${g.due.length === 1 ? 'Prüfung' : `${g.due.length} Prüfungen`} ${g.due.some((d) => d.state === 'ueberfaellig') ? 'überfällig' : 'fällig'}` : '', g.reports.length ? (g.row ? 'Schaden gemeldet' : 'Gerät zuordnen') : ''].filter(Boolean).join(', ')}`,
    text: g.blocked ? 'Das Gerät ist gesperrt: reparieren lassen oder ausscheiden, danach prüfen. Ich ändere dabei nichts selbst.' : 'Prüfung einplanen oder den gemeldeten Schaden ansehen. Ich ändere dabei nichts selbst.',
    lines: lines(g).slice(0, 6),
    open: { label: 'Öffnen', action: 'gr-goto', data: g.row ? { id: g.row.item.id } : { tab: 'reparaturen' } },
  }))
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const here = rowsAt().filter((r) => r.status !== 'ausgeschieden' && r.location.kind === 'objekt' && r.location.id === objectId)
    if (!here.length) return ''
    const bad = here.filter((r) => r.status === 'gesperrt' || r.state === 'ueberfaellig')
    return `<strong>Geräte im Objekt</strong>: ${here.map((r) => esc(`${r.item.no} ${r.item.name}`)).join(', ')}${bad.length ? ` <span class="pill error">${bad.length} gesperrt oder Prüfung überfällig</span>` : ''} <button class="btn small" data-action="gr-goto" data-loc="objekt:${esc(objectId)}" data-status="">Ansehen</button>`
  },
})

// ---------------------------------------------------------------- Meldungen vom Handy („Mein Dienstplan“)

/**
 * „Gerät kaputt?“ aus „Mein Dienstplan“: übernimmt die Meldung als Schaden (einmal je Meldung; Gerät über die
 * Inventarnummer im Text, sonst „Gerät zuordnen“) und gibt der Person Bescheid. Nur wer die Geräte bearbeiten darf.
 */
export async function takePortalRequests(list, { decide }) {
  if (!canEdit(MODULE) || app.readOnly || !app.data) return []
  const handled = []
  for (const a of list.filter((x) => x.art === 'Geraet')) {
    if (!doc().repairs.some((r) => r.portalId === a.id)) doc().repairs.push(repairFromPortal(a, { items: doc().items, newId: () => uid('gs'), at: nowIso() }))
    handled.push(a)
  }
  if (!handled.length) return []
  persist()
  for (const a of handled) await decide(a, 'genehmigt', 'Ist notiert. Wir kümmern uns um das Gerät.')
  toast(handled.length === 1 ? `Schaden von ${handled[0].name} übernommen (Geräte & Maschinen → Reparaturen).` : `${handled.length} Schäden vom Handy übernommen (Geräte & Maschinen → Reparaturen).`)
  return handled
}
onPortalRequests(takePortalRequests)

