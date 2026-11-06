// Mattenwechsel-Modul (Phase Stammdaten, docs/MATTENWECHSEL-PLAN.md P1/P4): „Matten-Liegeplätze“ für das Büro
// (je Kunde → Objekt → Liegeplatz als Tabelle wie im Konzept: Liegeplatz | Matte | Stückzahl | Intervall | nächster
// Wechsel), Dialog je Liegeplatz (Name, Stockwerk, Zugang, Hinweis, Matten, Intervall, Starttermin, Regel, Arbeitszeit,
// Zeitfenster, Pausen, Gebiet, aktiv, Koordinaten), Gebiete, „Übernahme aus dem Werkzeug“ (nur Vollzugriff,
// views/matten-uebernahme.js) und „Matten-Touren“ für die Fahrer (noch leer, Touren kommen in der Phase Fahrer).
// Datei matten/matten.json (Rechenkern: core/matten.js). Das Werkzeug unter #matten bleibt unverändert daneben.
// Kunden und Mattentypen kommen aus der Fakturierung (nur lesend); wer sie nicht sieht, sieht die Kopie am Liegeplatz.
// Aktionen und Dialoge mit dem Kürzel „mw-“.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { coordsText, parseCoords } from '../../core/geo.js'
import { matTypes } from '../../core/invoicing.js'
import {
  activeAreas,
  areaOf,
  areaProblem,
  coordsFromObject,
  counts,
  createPlacement,
  customerCopy,
  customerOfObject,
  emptyMatten,
  filterRows,
  GEO,
  groupRows,
  intervalText,
  knownCustomers,
  knownTypes,
  normalizePlacement,
  OWNERS,
  placementProblem,
  placementRows,
  refreshCustomerCopies,
  RULES,
  STATUS_FILTERS,
  updatePlacement,
  upgradeMatten,
} from '../../core/matten.js'
import { app, canEdit, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { geocode } from '../geocode.js'
import { checked, esc, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { importTab, mayImport } from './matten-uebernahme.js'

const MODULE = 'matten'
const ICON_MW = '<path d="M12 2.8a3.4 3.4 0 0 0-3.4 3.4c0 2.5 3.4 5.3 3.4 5.3s3.4-2.8 3.4-5.3A3.4 3.4 0 0 0 12 2.8z"/><rect x="3.5" y="13.5" width="17" height="7.5" rx="2"/><path d="M7 17.2h10"/>'
const ICON_TOUR = '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18h6.3a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h5.3"/>'
const MOBILE_MW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6a2.3 2.3 0 0 0-2.3 2.3C5.7 5.6 8 7.5 8 7.5s2.3-1.9 2.3-3.6A2.3 2.3 0 0 0 8 1.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="2.2" y="9.2" width="11.6" height="5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
const MOBILE_TOUR = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="12" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="4" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 12h4.2a2.3 2.3 0 0 0 0-4.6H6.2a2.3 2.3 0 0 1 0-4.6h4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const sees = (m) => !app.access || app.access.sees(m)
/** Fakturierung, wenn lesbar (Kunden, Mattentypen); sonst null → Kopien am Liegeplatz. */
const fak = () => (sees('fakturierung') ? app.data.fakturierung || null : null)
const fakCustomers = () => fak()?.customers || null
const fakArticles = () => fak()?.articles || null
const objOf = (id) => (app.data.objects || []).find((o) => o.id === id) || null
const placementOf = (id) => doc().placements.find((p) => p.id === id) || null
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const STATE_TEXT = { ueberfaellig: 'überfällig', faellig: 'bald', geplant: 'geplant', pausiert: 'pausiert', inaktiv: 'inaktiv', ohne: 'kein Termin' }
const STATE_CLS = { ueberfaellig: 'error', faellig: 'warning', geplant: 'ok', pausiert: 'na', inaktiv: 'na', ohne: 'warning' }

/**
 * Alle Zeilen (je Berechnung gemerkt). Nächster Wechsel über den Fälligkeitsrechner (core/matten-plan.js, nextDue);
 * bestätigte Wechsel vorerst nur der letzte aus der Übernahme, Einsätze und Betriebsurlaub kommen mit Kalender und Touren.
 */
const rowsAt = (today = todayISO()) => memo(app.cur, `matten:${today}`, () => placementRows({ doc: doc(), objects: app.data.objects || [], customers: fakCustomers(), articles: fakArticles(), today }))

/** Mattentypen zur Auswahl (Fakturierung bzw. Kopien) und ob es überhaupt welche gibt. */
const typeChoices = () => knownTypes({ articles: fakArticles(), placements: doc().placements })
const noTypes = () => (fak() ? !matTypes(fakArticles()).length : !typeChoices().length)

function typesBanner() {
  if (!noTypes()) return ''
  const link = sees('fakturierung') ? ` <button class="btn small" data-action="mw-types-goto">${ICON.gear} Mattentypen in der Fakturierung</button>` : ''
  return `<div class="banner warn-banner"><p><strong>Noch keine Mattentypen.</strong> Mattentypen sind Artikel der Fakturierung mit der Artikelgruppe „Matten“ (Größe, Farbe, Preis je Wechsel). ${sees('fakturierung') ? 'In der Fakturierung unter „Stammdaten → Matten“ anlegen, dann stehen sie hier zur Auswahl.' : 'Sie legt an, wer die Fakturierung bearbeitet.'}</p>${link}</div>`
}

const nextCell = (r) => {
  const pill = `<span class="pill ${STATE_CLS[r.state]}">${esc(STATE_TEXT[r.state])}</span>`
  if (r.state === 'inaktiv') return pill
  if (!r.next) return `${pill}<br><span class="muted">${r.paused ? 'Pause ohne Ende' : 'Starttermin fehlt'}</span>`
  return `${esc(short(r.next.date))} ${pill}${r.next.overdue ? '<br><span class="muted">seit dem Termin offen</span>' : ''}`
}
const lines = (list) => list.join('<br>')

// ---------------------------------------------------------------- Ansicht Liegeplätze

function mattenView() {
  const ed = editable()
  const all = rowsAt()
  const tab = app.ui.mwTab === 'uebernahme' && mayImport() ? 'uebernahme' : 'liste'
  const head = `<div class="section-head"><div><h2>Matten-Liegeplätze</h2><p>Je Kunde und Objekt die Liegeplätze der Schmutzfangmatten: welche Matte, wie viele, wie oft gewechselt wird, Zugang und Zeitfenster. Das bisherige Werkzeug läuft unter „Mattenwechsel (Werkzeug)“ unverändert weiter.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="mw-edit-open">${ICON.plus} Liegeplatz</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        ed && { label: 'Gebiete (Tourrunden)', icon: ICON.gear, action: 'mw-areas-open', hint: 'anlegen, umbenennen' },
        sees('fakturierung') && { label: 'Mattentypen und Preise', icon: ICON.gear, action: 'mw-types-goto', hint: 'in der Fakturierung' },
        mayImport() && { label: 'Übernahme aus dem Werkzeug', icon: ICON.download, action: 'mw-tab', data: { v: 'uebernahme' }, hint: 'einmalig, mit Sicherung' },
        sees('matten') && app.config?.tools !== false && { label: 'Werkzeug öffnen', action: 'view', data: { view: 'matten' }, hint: 'Mattenwechsel (Werkzeug)' },
      ],
    })}</div></div>`
  const tabs = mayImport()
    ? tabBar({
        action: 'mw-tab',
        current: tab,
        tabs: [
          { id: 'liste', label: 'Liegeplätze' },
          { id: 'uebernahme', label: 'Übernahme aus dem Werkzeug' },
        ],
      })
    : ''
  if (tab === 'uebernahme') return `${head}${tabs}${importTab()}`
  if (!all.length)
    return `${head}${tabs}${typesBanner()}<div class="banner welcome"><p><strong>Noch keine Liegeplätze.</strong> Ein Liegeplatz ist die Stelle beim Kunden, an der eine oder mehrere Matten liegen, z. B. „Haupteingang“ oder „Stiege 2“. Je Liegeplatz: Matten, Stückzahl, Intervall (14 oder 28 Tage) und Starttermin.</p>${ed ? `<button class="btn primary" data-action="mw-edit-open">${ICON.plus} Liegeplatz anlegen</button>` : ''}${mayImport() ? ` <button class="btn" data-action="mw-tab" data-v="uebernahme">Aus dem Werkzeug übernehmen</button>` : ''}</div>`
  const n = counts(all)
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  return `${head}${tabs}${typesBanner()}
    <div class="impact-stats tc-stats">${tile('Liegeplätze', n.aktiv)}${tile('Matten', n.matten)}${tile('Kunden', n.kunden)}${tile('zu prüfen', n.pruefen + n.typ, n.pruefen + n.typ ? 'err' : '')}</div>
    ${listTab(all)}`
}

function listTab(all) {
  const ed = editable()
  const f = { customerId: app.ui.mwCust || '', areaId: app.ui.mwArea || '', status: app.ui.mwStatus || '', q: app.ui.mwQ || '' }
  const rows = filterRows(all, f)
  const custs = [...new Map(all.map((r) => [r.customer.id, r.customer])).values()].filter((c) => c.id).map((c) => [c.id, c.name]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const areas = activeAreas(doc()).map((a) => [a.id, a.name])
  const filtered = f.customerId || f.areaId || f.status || f.q
  const filters = `<div class="filters mw-filters">
      <label class="field inline"><span>Kunde</span><select id="mw-f-cust" data-change="mw-filter">${options(custs, f.customerId, { empty: 'alle' })}</select></label>
      ${areas.length ? `<label class="field inline"><span>Gebiet</span><select id="mw-f-area" data-change="mw-filter">${options(areas, f.areaId, { empty: 'alle' })}</select></label>` : ''}
      <label class="field inline"><span>Status</span><select id="mw-f-status" data-change="mw-filter">${options(Object.entries(STATUS_FILTERS), f.status)}</select></label>
      <label class="field inline"><span>Suche</span><input type="search" id="mw-f-q" value="${esc(f.q)}" placeholder="Liegeplatz, Objekt, Matte" data-change="mw-filter"></label>
      ${filtered ? '<button class="btn small ghost" data-action="mw-reset">Filter zurücksetzen</button>' : ''}</div>`
  const blocks = groupRows(rows)
    .map((g) => {
      const objs = g.objects
        .map((o) => {
          const body = o.rows
            .map((r) => {
              const p = r.placement
              const tags = [p.floor ? `<span class="muted">${esc(p.floor)}</span>` : '', p.active === false ? '<span class="pill na">inaktiv</span>' : '', p.check ? `<span class="pill warning" title="${esc(p.check.reason || '')}">zu prüfen</span>` : '', r.area ? `<span class="pill">${esc(r.area.name)}</span>` : ''].filter(Boolean).join(' ')
              const mats = lines(r.mats.map((m) => `${esc(m.label)}${m.owner === 'kunde' ? ' <span class="muted">(Kunde)</span>' : ''}${m.missing ? ' <span class="pill warning">Mattentyp fehlt</span>' : ''}`)) || '<span class="muted">keine</span>'
              const qty = lines(r.mats.map((m) => `${m.qty}`)) || '–'
              return `<tr><td class="clickable" data-action="mw-edit-open" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong>${tags ? `<br>${tags}` : ''}</td>
                <td>${mats}</td><td class="num">${qty}</td><td>${esc(intervalText(p.intervalDays))}<br><span class="muted">${esc(p.rule === 'ab-ist' ? 'ab letztem Wechsel' : 'fester Rhythmus')}</span></td>
                <td>${nextCell(r)}</td><td class="actions-cell"><button class="btn small ghost" data-action="mw-edit-open" data-id="${esc(p.id)}">${ed ? 'Bearbeiten' : 'Ansehen'}</button></td></tr>`
            })
            .join('')
          const addr = o.object?.address || ''
          return `<div class="mw-obj"><div class="section-head small"><h4>${esc(o.object?.name || 'Objekt fehlt')} <span class="muted mw-addr">${esc(addr)}</span></h4>${ed ? `<div class="actions"><button class="btn small" data-action="mw-edit-open" data-cust="${esc(g.customer.id)}" data-obj="${esc(o.objectId)}">${ICON.plus} Liegeplatz</button></div>` : ''}</div>
            <div class="table-wrap"><table class="data mw-table"><thead><tr><th>Liegeplatz</th><th>Matte</th><th class="num">Stückzahl</th><th>Intervall</th><th>nächster Wechsel</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`
        })
        .join('')
      return `<section class="mw-cust"><div class="section-head small"><h3>${esc(g.customer.name)}${g.customer.no ? ` <span class="muted mw-addr">Kundennummer ${esc(g.customer.no)}</span>` : ''}</h3></div>${objs}</section>`
    })
    .join('')
  return `${filters}${blocks || `<p class="empty">Kein Liegeplatz in dieser Auswahl.${filtered ? ' Filter zurücksetzen zeigt alle.' : ''}</p>`}
    <p class="note">„Nächster Wechsel“ rechnet die App aus Starttermin, Regel, Intervall, letztem Wechsel und Pausen. Kalender mit Verschieben, Aussetzen und Nachholen folgt mit der Planung.</p>`
}

registerView({
  id: 'mw-liegeplaetze',
  order: 75.5,
  label: 'Matten-Liegeplätze',
  group: 'service',
  module: MODULE,
  icon: ICON_MW,
  noWeek: true,
  mobile: { icon: MOBILE_MW, label: 'Liegeplätze' },
  text: 'Mattenwechsel: Liegeplätze je Kunde und Objekt, Intervall, Übernahme',
  badge: () => {
    const n = counts(rowsAt())
    return n.pruefen + n.typ
  },
  render: mattenView,
})

// ---------------------------------------------------------------- Ansicht der Fahrer (Touren folgen in der Phase Fahrer)

function tourenView() {
  const office = sees('matten')
  return `<div class="section-head"><div><h2>Matten-Touren</h2><p>Hier stehen deine freigegebenen Touren des Mattenwechsels: Stopps der Reihe nach, Matten je Liegeplatz, Navigation und die Bestätigung je Liegeplatz – auch ohne Netz.</p></div></div>
    <div class="banner welcome"><p><strong>Noch keine Touren.</strong> Touren plant und gibt das Büro frei; die Ansicht für unterwegs kommt mit dem nächsten Ausbau. ${office ? 'Bis dahin läuft der Mattenwechsel im Werkzeug.' : 'Bis dahin bekommst du deine Tour wie bisher vom Büro.'}</p>${office ? `<button class="btn" data-action="view" data-view="mw-liegeplaetze">Liegeplätze</button>${app.config?.tools !== false ? ' <button class="btn" data-action="view" data-view="matten">Werkzeug öffnen</button>' : ''}` : ''}</div>
    <p class="note">Fahrer sehen hier weder Preise noch den Kundenstamm: Eine Tour trägt nur, was für den Wechsel nötig ist (Kunde, Adresse, Liegeplatz, Matten, Zugang).</p>`
}

registerView({
  id: 'mw-touren',
  order: 75.6,
  label: 'Matten-Touren',
  group: 'service',
  module: 'mattentour',
  icon: ICON_TOUR,
  noWeek: true,
  mobile: { icon: MOBILE_TOUR, label: 'Touren' },
  text: 'Mattenwechsel: eigene Touren, Wechsel je Liegeplatz bestätigen',
  render: tourenView,
})

// ---------------------------------------------------------------- Dialog Liegeplatz

const INTERVAL_CHOICES = [
  ['14', 'alle 14 Tage'],
  ['28', 'alle 28 Tage (4 Wochen)'],
  ['7', 'alle 7 Tage'],
  ['21', 'alle 21 Tage'],
  ['42', 'alle 42 Tage (6 Wochen)'],
  ['56', 'alle 56 Tage (8 Wochen)'],
  ['x', 'anderes Intervall …'],
]

function draftOf(m) {
  if (!m.draft) {
    const p = m.id ? placementOf(m.id) : null
    if (p) {
      m.draft = { ...structuredClone(p), coords: coordsText(p), geoFilled: coordsText(p) }
    } else {
      const objectId = m.objectId || ''
      const owner = objectId && fakCustomers() ? customerOfObject(fakCustomers(), objectId) : null
      m.draft = { id: '', customerId: m.customerId || owner?.id || app.ui.mwCust || '', objectId, name: '', floor: '', access: '', hint: '', active: true, mats: [{ articleId: '', qty: 1, owner: 'wir' }], intervalDays: 28, startDate: addDays(todayISO(), 1), rule: 'rhythmus', workMinutes: 5, window: { from: '', to: '', note: '' }, pauses: [], areaId: app.ui.mwArea || '', coords: '', geoFilled: '' }
    }
    m.draft.window ||= { from: '', to: '', note: '' }
    m.draft.pauses ||= []
    m.draft.intervalOther = !INTERVAL_CHOICES.some(([v]) => v === String(m.draft.intervalDays))
  }
  return m.draft
}

/** Eingaben aus dem Dialog in den Entwurf (vor jedem Neuzeichnen und vor dem Speichern). */
function readDraft() {
  const d = draftOf(app.ui.modal)
  if (!document.getElementById('mw-name')) return d
  const iv = val('mw-interval')
  Object.assign(d, {
    customerId: val('mw-cust'),
    objectId: val('mw-obj'),
    name: val('mw-name'),
    floor: val('mw-floor'),
    access: val('mw-access'),
    hint: val('mw-hint'),
    active: checked('mw-active'),
    intervalOther: iv === 'x',
    intervalDays: iv === 'x' ? (document.getElementById('mw-interval-x') ? val('mw-interval-x') : '') : iv,
    rule: val('mw-rule'),
    startDate: val('mw-start'),
    workMinutes: val('mw-work'),
    window: { from: val('mw-win-from'), to: val('mw-win-to'), note: val('mw-win-note') },
    areaId: val('mw-area'),
    areaNew: document.getElementById('mw-area-new') ? val('mw-area-new') : d.areaNew || '',
    coords: val('mw-coords'),
    checkDone: document.getElementById('mw-check-done') ? checked('mw-check-done') : false,
  })
  d.mats = d.mats.map((m, i) => {
    const articleId = val(`mw-mat-type-${i}`)
    return { ...m, articleId, qty: val(`mw-mat-qty-${i}`), owner: val(`mw-mat-owner-${i}`) || 'wir', ...(articleId ? { legacy: undefined } : {}) }
  })
  d.pauses = d.pauses.map((x, i) => ({ from: val(`mw-pause-from-${i}`), to: val(`mw-pause-to-${i}`), reason: val(`mw-pause-reason-${i}`) }))
  return d
}

function editModal(c, m) {
  const d = draftOf(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const existing = d.id ? placementOf(d.id) : null
  const custList = knownCustomers({ customers: fakCustomers(), placements: doc().placements })
  if (d.customerId && !custList.some((x) => x.id === d.customerId)) custList.push({ id: d.customerId, name: existing?.customer?.name || 'Kunde', no: existing?.customer?.no || '' })
  // Objekte: die des Kunden (laut Fakturierung) zuerst, dann alle übrigen aktiven
  const objs = (app.data.objects || []).filter((o) => !o.inactive || o.id === d.objectId)
  const own = fakCustomers()?.find((x) => x.id === d.customerId)?.objectIds || []
  const objOptions = own.length
    ? `<optgroup label="Objekte des Kunden">${options(objs.filter((o) => own.includes(o.id)).map((o) => [o.id, o.name]), d.objectId)}</optgroup><optgroup label="weitere Objekte">${options(objs.filter((o) => !own.includes(o.id)).map((o) => [o.id, o.name]), d.objectId)}</optgroup>`
    : options(objs.map((o) => [o.id, o.name]), d.objectId)
  const obj = objOf(d.objectId)
  const owner = obj && fakCustomers() ? customerOfObject(fakCustomers(), obj.id) : null
  const ownerHint = owner && d.customerId && owner.id !== d.customerId ? `<small class="muted">Das Objekt gehört in der Fakturierung zu ${esc(owner.name)}.</small>` : !owner && obj && fakCustomers() && canEdit('fakturierung') ? '<small class="muted">Das Objekt wird beim Speichern diesem Kunden zugeordnet.</small>' : ''
  const types = typeChoices()
  const matRows = d.mats
    .map((mat, i) => {
      const list = [...types.map((t) => [t.id, t.name])]
      if (mat.articleId && !types.some((t) => t.id === mat.articleId)) list.push([mat.articleId, `${mat.name || 'Matte'} (nicht mehr in der Liste)`])
      const legacy = !mat.articleId && mat.legacy ? `<small class="muted">aus dem Werkzeug: ${esc([mat.legacy.groesse, mat.legacy.farbe].filter(Boolean).join(' '))}</small>` : ''
      return `<div class="mw-mat-row">
        <label class="field"><span>Mattentyp</span><select id="mw-mat-type-${i}" ${dis}>${options(list, mat.articleId, { empty: '– Mattentyp wählen –' })}</select>${legacy}</label>
        <label class="field"><span>Stückzahl</span><input type="number" id="mw-mat-qty-${i}" min="1" max="999" inputmode="numeric" value="${esc(mat.qty ?? '')}" ${dis}></label>
        <label class="field"><span>Eigentum</span><select id="mw-mat-owner-${i}" ${dis}>${options(Object.entries(OWNERS), mat.owner || 'wir')}</select></label>
        ${ed && d.mats.length > 1 ? `<button class="btn small ghost" data-action="mw-mat-del" data-i="${i}" title="Matte entfernen" aria-label="Matte entfernen">${ICON.trash}</button>` : ''}
      </div>`
    })
    .join('')
  const pauseRows = d.pauses
    .map(
      (x, i) => `<div class="mw-pause-row">
        <label class="field"><span>von</span><input type="date" id="mw-pause-from-${i}" value="${esc(x.from)}" ${dis}></label>
        <label class="field"><span>bis</span><input type="date" id="mw-pause-to-${i}" value="${esc(x.to)}" ${dis}></label>
        <label class="field"><span>Grund</span><input type="text" id="mw-pause-reason-${i}" value="${esc(x.reason)}" placeholder="z. B. Betriebsurlaub" ${dis}></label>
        ${ed ? `<button class="btn small ghost" data-action="mw-pause-del" data-i="${i}" title="Pause entfernen" aria-label="Pause entfernen">${ICON.trash}</button>` : ''}
      </div>`,
    )
    .join('')
  const areas = activeAreas(doc())
  const area = areaOf(doc(), d.areaId)
  if (area && !areas.includes(area)) areas.push(area)
  const ivValue = d.intervalOther ? 'x' : String(d.intervalDays)
  const lastEx = existing?.lastExchange
  const geo = existing?.geoQuality && d.coords === d.geoFilled ? GEO[existing.geoQuality] || '' : ''
  return modalFrame({
    title: existing ? `Liegeplatz: ${existing.name}` : 'Liegeplatz anlegen',
    subtitle: existing ? `${esc(existing.customer?.name || '')}${obj ? ` · ${esc(obj.name)}` : ''}${existing.legacyId ? ` · aus dem Werkzeug (${esc(existing.legacyId)})` : ''}` : '',
    wide: true,
    body: `${existing?.check ? `<div class="banner warn-banner"><p><strong>Zu prüfen:</strong> ${esc(existing.check.reason || '')}</p>${ed ? '<label class="check"><input type="checkbox" id="mw-check-done"><span>geprüft, Hinweis entfernen</span></label>' : ''}</div>` : ''}
      <div class="form-grid">
        <label class="field"><span>Kunde</span><select id="mw-cust" data-change="mw-redraw" ${dis}>${options(custList.map((x) => [x.id, x.no ? `${x.name} (${x.no})` : x.name]), d.customerId, { empty: '– wählen –' })}</select>${!custList.length ? '<small class="muted">Kunden legt an, wer die Fakturierung bearbeitet.</small>' : ''}</label>
        <label class="field"><span>Objekt</span><select id="mw-obj" data-change="mw-redraw" ${dis}><option value="">– wählen –</option>${objOptions}</select>${ownerHint}</label>
        <label class="field"><span>Liegeplatz</span><input type="text" id="mw-name" value="${esc(d.name)}" placeholder="z. B. Haupteingang, Stiege 2" ${dis}></label>
        <label class="field"><span>Stockwerk</span><input type="text" id="mw-floor" value="${esc(d.floor || '')}" placeholder="z. B. EG, 1. OG, Tiefgarage" ${dis}></label>
        <label class="field"><span>Zugang / Schlüssel</span><input type="text" id="mw-access" value="${esc(d.access || '')}" placeholder="z. B. Schlüssel beim Hausbesorger" ${dis}></label>
        <label class="field"><span>Hinweis für den Fahrer</span><input type="text" id="mw-hint" value="${esc(d.hint || '')}" placeholder="z. B. alte Matten nicht im Müllraum lassen" ${dis}></label>
      </div>
      <section class="mw-block"><h3>Matten</h3>${noTypes() ? typesBanner() : ''}${matRows}${ed ? `<button class="btn small" data-action="mw-mat-add">${ICON.plus} Matte</button>` : ''}</section>
      <section class="mw-block"><h3>Wechsel</h3><div class="form-grid">
        <label class="field"><span>Intervall</span><select id="mw-interval" data-change="mw-redraw" ${dis}>${options(INTERVAL_CHOICES, ivValue)}</select></label>
        ${d.intervalOther ? `<label class="field"><span>Intervall in Tagen</span><input type="number" id="mw-interval-x" min="1" max="365" inputmode="numeric" value="${esc(d.intervalDays ?? '')}" ${dis}></label>` : ''}
        <label class="field"><span>Regel</span><select id="mw-rule" ${dis}>${options(Object.entries(RULES), d.rule || 'rhythmus')}</select><small class="muted">fest: Starttermin + Intervall, auch nach einem verschobenen Wechsel</small></label>
        <label class="field"><span>Starttermin (erster Wechsel)</span><input type="date" id="mw-start" value="${esc(d.startDate || '')}" ${dis}><small class="muted">bei „ab letztem Wechsel“: frühestens ab diesem Tag</small></label>
        <label class="field"><span>Arbeitszeit vor Ort (Minuten)</span><input type="number" id="mw-work" min="0" max="600" inputmode="numeric" value="${esc(d.workMinutes ?? '')}" ${dis}></label>
        <label class="field"><span>Zeitfenster von</span><input type="time" id="mw-win-from" value="${esc(d.window?.from || '')}" ${dis}></label>
        <label class="field"><span>Zeitfenster bis</span><input type="time" id="mw-win-to" value="${esc(d.window?.to || '')}" ${dis}></label>
        <label class="field wide"><span>Öffnungszeiten / Hinweis zur Zeit</span><input type="text" id="mw-win-note" value="${esc(d.window?.note || '')}" placeholder="z. B. Mo–Fr 7–18 Uhr, nicht in der Mittagspause" ${dis}></label>
      </div>
      ${lastEx ? `<p class="muted">Letzter Wechsel: ${esc(short(lastEx.date))}${lastEx.source === 'werkzeug' ? ' (aus den Touren des Werkzeugs)' : ''}</p>` : ''}
      <h4>Pausen (z. B. Betriebsurlaub)</h4>${pauseRows || '<p class="muted">Keine Pause eingetragen.</p>'}${ed ? `<button class="btn small" data-action="mw-pause-add">${ICON.plus} Pause</button>` : ''}</section>
      <section class="mw-block"><h3>Gebiet und Lage</h3><div class="form-grid">
        <label class="field"><span>Gebiet (Tourrunde)</span><select id="mw-area" data-change="mw-redraw" ${dis}>${options(areas.map((a) => [a.id, a.name]), d.areaId, { empty: '– kein Gebiet –' })}${ed ? `<option value="+" ${d.areaId === '+' ? 'selected' : ''}>+ neues Gebiet …</option>` : ''}</select></label>
        ${d.areaId === '+' ? `<label class="field"><span>Name des neuen Gebiets</span><input type="text" id="mw-area-new" value="${esc(d.areaNew || '')}" placeholder="z. B. Salzburg Nord" ${dis}></label>` : ''}
        <label class="field wide"><span>Koordinaten (Breite, Länge)</span><span class="input-btn"><input type="text" id="mw-coords" value="${esc(d.coords || '')}" placeholder="leer = vom Objekt" ${dis}>${ed ? `<button class="btn small" data-action="mw-coords-object" title="Koordinaten des Objekts übernehmen">vom Objekt</button><button class="btn small" data-action="mw-geocode" title="Über OpenStreetMap aus der Adresse des Objekts suchen">Suchen</button>` : ''}</span>${geo ? `<small class="muted">${esc(geo)}</small>` : '<small class="muted">für die Reihenfolge der Tour; leer = Koordinaten des Objekts</small>'}</label>
        <label class="check wide"><input type="checkbox" id="mw-active" ${d.active !== false ? 'checked' : ''} ${dis}><span>aktiv (inaktive werden nicht gewechselt, der Verlauf bleibt)</span></label>
      </div></section>`,
    foot: `<div class="actions">${ed && existing ? `<button class="btn danger" data-action="mw-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `mw-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="mw-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('mw-edit', editModal, { module: MODULE })

/** Matte am Liegeplatz mit Kopie von Name, Größe, Farbe (aus der Fakturierung bzw. einer vorhandenen Kopie). */
function withCopy(mat) {
  if (!mat.articleId) return mat
  const t = typeChoices().find((x) => x.id === mat.articleId)
  const old = doc().placements.flatMap((p) => p.mats || []).find((x) => x.articleId === mat.articleId)
  const name = t?.name || old?.name || mat.name || 'Matte'
  const size = t?.size || old?.size || ''
  const color = t?.color || old?.color || ''
  return { articleId: mat.articleId, qty: mat.qty, owner: mat.owner, name, ...(size ? { size } : {}), ...(color ? { color } : {}) }
}

function savePlacement() {
  const d = readDraft()
  const existing = d.id ? placementOf(d.id) : null
  const coordsInput = String(d.coords || '').trim()
  const coords = coordsInput ? parseCoords(coordsInput) : null
  if (coordsInput && !coords) return toast('Koordinaten bitte als „Breite, Länge“ eintragen, z. B. 47.80950, 13.05500.')
  let areaId = d.areaId
  let newArea = null
  if (areaId === '+') {
    const problem = areaProblem(doc(), { name: d.areaNew })
    if (problem) return toast(problem)
    newArea = { id: uid('mg'), name: String(d.areaNew).trim(), active: true, createdAt: nowIso(), createdBy: user(), updatedAt: nowIso(), updatedBy: user() }
    areaId = newArea.id
  }
  const geoQuality = coords ? (coordsInput === d.geoFilled && d.geoQuality ? d.geoQuality : coordsInput === coordsText(existing || {}) && existing?.geoQuality ? existing.geoQuality : 'hand') : ''
  const fields = normalizePlacement({ ...d, mats: d.mats.map(withCopy), areaId, lat: coords?.lat, lon: coords?.lon, geoQuality })
  const problem = placementProblem(fields)
  if (problem) return toast(problem)
  const obj = objOf(fields.objectId)
  if (fields.lat === undefined) Object.assign(fields, coordsFromObject(obj) || {})
  const cust = fakCustomers()?.find((c) => c.id === fields.customerId)
  fields.customer = cust ? customerCopy(cust) : existing?.customerId === fields.customerId ? existing.customer : knownCustomers({ placements: doc().placements }).find((c) => c.id === fields.customerId) || null
  if (newArea) doc().areas.push(newArea)
  const stamp = { now: nowIso(), user: user() }
  let saved
  if (existing) {
    saved = updatePlacement(existing, fields, stamp)
    if (d.checkDone) delete saved.check
    doc().placements = doc().placements.map((p) => (p.id === existing.id ? saved : p))
  } else {
    saved = createPlacement(fields, { ...stamp, newId: uid })
    doc().placements.push(saved)
  }
  // Objekt dem Kunden zuordnen, wenn es noch keinem gehört (ein Objekt gehört in der Fakturierung genau einem Kunden)
  if (cust && canEdit('fakturierung') && obj && !customerOfObject(fakCustomers(), obj.id)) cust.objectIds = [...(cust.objectIds || []), obj.id]
  if (fakCustomers()) refreshCustomerCopies(doc().placements, fakCustomers())
  persist()
  closeModal()
  renderNow()
  const r = rowsAt().find((x) => x.placement.id === saved.id)
  toast(`${existing ? 'Gespeichert' : `Liegeplatz „${saved.name}“ angelegt`}${r?.next?.date ? `: nächster Wechsel ${short(r.next.date)}` : ''}.`)
}

// ---------------------------------------------------------------- Gebiete

function areasDraft(m) {
  m.rows ||= structuredClone(doc().areas)
  return m.rows
}
function readAreas() {
  const rows = areasDraft(app.ui.modal)
  rows.forEach((a, i) => {
    if (document.getElementById(`mwa-name-${i}`)) {
      a.name = val(`mwa-name-${i}`).trim()
      a.active = checked(`mwa-active-${i}`)
    }
  })
  return rows
}

registerModal(
  'mw-areas',
  (c, m) => {
    const rows = areasDraft(m)
    const used = new Set(doc().placements.map((p) => p.areaId))
    const body = rows.length
      ? `<div class="table-wrap"><table class="data mw-areas"><thead><tr><th>Gebiet</th><th>aktiv</th><th>Liegeplätze</th><th></th></tr></thead><tbody>${rows
          .map(
            (a, i) => `<tr><td><input type="text" id="mwa-name-${i}" value="${esc(a.name)}" aria-label="Name des Gebiets"></td><td><input type="checkbox" id="mwa-active-${i}" ${a.active !== false ? 'checked' : ''} aria-label="aktiv"></td>
              <td>${doc().placements.filter((p) => p.areaId === a.id).length}</td><td>${used.has(a.id) ? '' : `<button class="btn small ghost" data-action="mw-area-del" data-i="${i}">Entfernen</button>`}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted">Noch keine Gebiete. Ein Gebiet ist eine Tourrunde, kein Ort: zwei Gebiete können im selben Ort liegen.</p>'
    return modalFrame({
      title: 'Gebiete (Tourrunden)',
      body: `${body}<button class="btn small" data-action="mw-area-add">${ICON.plus} Gebiet</button>`,
      foot: '<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mw-areas-save">Speichern</button></div>',
    })
  },
  { module: MODULE },
)

// ---------------------------------------------------------------- Aktionen

registerActions({
  'mw-tab': (el) => {
    app.ui.mwTab = el.dataset.v
    if (app.ui.view !== 'mw-liegeplaetze') app.ui.view = 'mw-liegeplaetze'
    renderNow()
  },
  'mw-filter': () => {
    app.ui.mwCust = val('mw-f-cust')
    app.ui.mwArea = document.getElementById('mw-f-area') ? val('mw-f-area') : ''
    app.ui.mwStatus = val('mw-f-status')
    app.ui.mwQ = val('mw-f-q').trim()
    renderNow()
  },
  'mw-reset': () => {
    Object.assign(app.ui, { mwCust: '', mwArea: '', mwStatus: '', mwQ: '' })
    renderNow()
  },
  'mw-edit-open': (el) => openModal({ type: 'mw-edit', id: el.dataset.id || '', objectId: el.dataset.obj || '', customerId: el.dataset.cust || '' }),
  'mw-redraw': () => {
    readDraft()
    renderModal()
  },
  // Mattentypen pflegt die Fakturierung (Reiter „Stammdaten → Matten“, invoicing-matten.js); hier keine zweite Pflege
  'mw-types-goto': () => {
    Object.assign(app.ui, { view: 'fakturierung', fakTab: 'matten' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
})

registerActions(
  {
    'mw-mat-add': () => {
      const d = readDraft()
      d.mats.push({ articleId: '', qty: 1, owner: 'wir' })
      renderModal()
    },
    'mw-mat-del': (el) => {
      const d = readDraft()
      d.mats.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-pause-add': () => {
      const d = readDraft()
      d.pauses.push({ from: '', to: '', reason: '' })
      renderModal()
    },
    'mw-pause-del': (el) => {
      const d = readDraft()
      d.pauses.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-coords-object': () => {
      const d = readDraft()
      const c = coordsFromObject(objOf(d.objectId))
      if (!c) return toast(d.objectId ? 'Das Objekt hat noch keine Koordinaten. „Suchen“ fragt OpenStreetMap nach der Adresse.' : 'Bitte zuerst das Objekt wählen.')
      d.coords = coordsText(c)
      d.geoFilled = d.coords
      d.geoQuality = 'objekt'
      renderModal()
    },
    'mw-geocode': async (el) => {
      const d = readDraft()
      const obj = objOf(d.objectId)
      if (!obj?.address) return toast('Bitte zuerst ein Objekt mit Adresse wählen.')
      el.disabled = true
      try {
        const hit = await geocode(obj.address)
        if (!hit) return toast('Adresse bei OpenStreetMap nicht gefunden. Koordinaten von Hand eintragen (z. B. aus Google Maps: Rechtsklick auf den Ort).')
        d.coords = `${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`
        d.geoFilled = d.coords
        d.geoQuality = 'adresse'
        renderModal()
        toast(`Gefunden: ${hit.label}`)
      } catch (err) {
        toast(`Suche nicht möglich: ${err.message}`)
      } finally {
        el.disabled = false
      }
    },
    'mw-save': () => savePlacement(),
    'mw-delete': (el) => {
      const p = placementOf(el.dataset.id)
      if (!p) return
      if (p.legacyId) return toast('Aus dem Werkzeug übernommen: bitte statt Löschen auf inaktiv setzen, sonst holt ihn eine spätere Übernahme wieder.')
      if (!confirmStep(`mw-del:${p.id}`, renderModal)) return
      doc().placements = doc().placements.filter((x) => x.id !== p.id)
      persist()
      closeModal()
      renderNow()
      toast(`Liegeplatz „${p.name}“ gelöscht.`)
    },
    'mw-areas-open': () => openModal({ type: 'mw-areas' }),
    'mw-area-add': () => {
      readAreas().push({ id: uid('mg'), name: '', active: true, createdAt: nowIso(), createdBy: user() })
      renderModal()
    },
    'mw-area-del': (el) => {
      readAreas().splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-areas-save': () => {
      const rows = readAreas()
      const seen = new Set()
      for (const a of rows) {
        if (!a.name) return toast('Jedes Gebiet braucht einen Namen.')
        const k = a.name.toLowerCase()
        if (seen.has(k)) return toast(`Das Gebiet „${a.name}“ steht doppelt.`)
        seen.add(k)
      }
      const before = new Map(doc().areas.map((a) => [a.id, a]))
      doc().areas = rows.map((a) => {
        const old = before.get(a.id)
        return old && old.name === a.name && (old.active !== false) === (a.active !== false) ? old : { ...a, updatedAt: nowIso(), updatedBy: user() }
      })
      persist()
      closeModal()
      renderNow()
      toast('Gebiete gespeichert.')
    },
  },
  { edit: MODULE },
)

export { rowsAt as mattenRows, plural, short }
