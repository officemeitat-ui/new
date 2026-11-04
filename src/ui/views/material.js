// Material & Lager: Bestand je Lager, Ausgabe an Objekte und Personen, Wareneingang, Umbuchung,
// Inventur, Bestellvorschlag je Lieferant, Bestellungen (PDF, E-Mail an den Lieferanten,
// Wareneingang auch in Teilen), Anforderungen aus den Objekten (in der App oder am Handy über
// „Mein Dienstplan“), Verbrauch je Objekt mit Vergleich zur Kalkulation, Buchungsjournal.
// Datei material/material.json (Rechenkern: core/material.js).

import { calcWage, calculate, CALC_DEFAULTS } from '../../core/calculation.js'
import { addDays, formatDate, lastOfMonth, todayISO } from '../../core/dates.js'
import {
  CATEGORIES,
  compactMoves,
  consumption,
  emptyMaterial,
  inventoryMoves,
  isOpenRequest,
  isOverdue,
  isPendingRequest,
  issueMoves,
  locationsOf,
  MAIN_LOCATION,
  matchArticle,
  materialBudget,
  MOVE_KINDS,
  nextOrderNo,
  openOrders,
  ORDER_STATUS,
  orderMailText,
  orderSuggestions,
  orderSum,
  parseArticles,
  receiveOrder,
  REQUEST_STATUS,
  requestFromPortal,
  STARTER_ARTICLES,
  STOCK_STATUS,
  stockMap,
  stockOf,
  stockRows,
  stockValue,
  transferMoves,
  UNITS,
} from '../../core/material.js'
import { toCSV } from '../../core/reports.js'
import { mergeRules } from '../../core/rules.js'
import { sendMail } from '../../auth/graph-mail.js'
import { countDocument, orderDocument, orderPdfName } from '../../export/material-pdf.js'
import { app, canEdit, closeModal, confirmStep, empName, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { call, onPortalRequests, portalSettings } from '../staffplan.js'
import { checked, download, esc, euro, ICON, menu, modalFrame, options, rowMenu, tabBar, uid, val } from '../shared.js'

const MODULE = 'material'
const ICON_BOX = '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6"/>'

const M = () => {
  const d = (app.data.material ||= emptyMaterial())
  for (const k of ['articles', 'suppliers', 'moves', 'orders', 'requests']) d[k] ||= []
  d.locations = locationsOf(d)
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const newId = () => uid('m')
const artOf = (id) => M().articles.find((a) => a.id === id)
const artName = (id) => artOf(id)?.name || 'Artikel'
const supOf = (id) => M().suppliers.find((s) => s.id === id)
const locName = (id) => M().locations.find((l) => l.id === id)?.name || id
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const qtyText = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ',')
const numIn = (id) => {
  const n = parseFloat(String(val(id)).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const activeArticles = () => M().articles.filter((a) => a.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'de'))
const articleOptions = (selected, { empty = '– Artikel –' } = {}) => options(activeArticles().map((a) => [a.id, `${a.name}${a.unit ? ` (${a.unit})` : ''}`]), selected, { empty })
const objectOptions = (selected, empty = '– Objekt –') => options(app.data.objects.map((o) => [o.id, o.name]), selected, { empty })
const employeeOptions = (selected) => options(app.data.employees.filter((e) => !e.exitDate || e.exitDate >= addDays(todayISO(), -90)).map((e) => [e.id, e.name]), selected, { empty: '– Person –' })
const locationOptions = (selected) => options(M().locations.map((l) => [l.id, l.name]), selected)
const STATUS_CLASS = { leer: 'error', niedrig: 'warning', ok: 'ok' }
const ORDER_CLASS = { entwurf: '', bestellt: 'info', teilweise: 'warning', geliefert: 'ok', storniert: '' }
const REQ_CLASS = { offen: 'warning', bestellt: 'info', ausgegeben: 'ok', abgelehnt: '' }

/** Buchungen älter als 24 Monate zusammenfassen (Datei bleibt klein, Bestand gleich). */
function maybeCompact() {
  const d = M()
  const cutoff = `${addDays(todayISO(), -730).slice(0, 7)}-01`
  if (d.moves.some((m) => m.date < addDays(cutoff, -31))) d.moves = compactMoves(d.moves, cutoff, { at: nowIso(), newId })
}

function commit(message) {
  maybeCompact()
  persist()
  renderNow()
  if (message) toast(message)
}

// ---------------------------------------------------------------- Ansicht

const TABS = [
  ['bestand', 'Bestand'],
  ['bestellen', 'Bestellen'],
  ['anforderungen', 'Anforderungen'],
  ['verbrauch', 'Verbrauch'],
  ['buchungen', 'Buchungen'],
  ['stamm', 'Lieferanten & Lager'],
]
// Auswertungen zusammen als Aufklappmenü
const TAB_GROUPS = ['bestand', 'bestellen', 'anforderungen', { label: 'Auswertung', items: ['verbrauch', 'buchungen'] }, 'stamm']
const tabOf = (k, flags) => ({ id: k, label: TABS.find(([id]) => id === k)[1], flag: flags[k] })

/** Kopf: Ausgabe sofort, alles andere gegliedert in „Buchen“, „Neu“ und „Export“. */
function headActions(ed) {
  const d = M()
  const has = d.articles.length > 0
  return `${ed && has ? `<button class="btn primary" data-action="mat-book-open" data-mode="ausgabe">${ICON.send} Ausgabe</button>` : ''}${menu({
    label: 'Buchen',
    items: [
      ed && has && { label: 'Wareneingang', icon: ICON.plus, action: 'mat-book-open', data: { mode: 'eingang' }, hint: 'Lieferung ohne Bestellung' },
      ed && has && d.locations.length > 1 && { label: 'Umbuchen', action: 'mat-book-open', data: { mode: 'umbuchung' }, hint: 'zwischen Lagern' },
      ed && has && { label: 'Inventur', icon: ICON.check, action: 'mat-inventory-open', hint: 'Zählliste und Korrektur' },
    ],
    single: false,
  })}${menu({
    label: 'Anlegen',
    icon: ICON.plus,
    items: [
      ed && { label: 'Anforderung erfassen', action: 'mat-request-new', hint: 'für ein Objekt oder eine Person' },
      ed && has && { label: 'Bestellung', action: 'mat-order-new' },
      ed && { heading: 'Stammdaten' },
      ed && { label: 'Artikel', action: 'mat-article-open' },
      ed && { label: 'Lieferant', action: 'mat-supplier-open' },
      ed && { label: 'Lager', action: 'mat-location-open' },
      ed && { label: 'Liste aus Excel einfügen', icon: ICON.upload, action: 'mat-import-open' },
    ],
    single: false,
  })}${menu({
    label: 'Export',
    icon: ICON.download,
    items: [
      has && { label: 'Lagerbestand (CSV)', action: 'mat-stock-csv', mail: true },
      has && { label: 'Verbrauch (CSV)', action: 'mat-usage-csv', hint: 'Zeitraum wie im Reiter Verbrauch', mail: true },
    ],
    single: false,
  })}`
}

function counts() {
  const d = M()
  const suggest = orderSuggestions(d).reduce((s, g) => s + g.lines.length, 0)
  const requests = d.requests.filter(isOpenRequest).length
  const overdue = d.orders.filter((o) => isOverdue(o, todayISO())).length
  return { suggest, requests, overdue, badge: suggest + requests + overdue }
}

function materialView() {
  const tab = TABS.some(([k]) => k === app.ui.matTab) ? app.ui.matTab : 'bestand'
  const n = counts()
  const flags = { bestellen: n.suggest + n.overdue, anforderungen: n.requests }
  const ed = editable()
  const body = { bestand: stockTab, bestellen: orderTab, anforderungen: requestTab, verbrauch: usageTab, buchungen: journalTab, stamm: masterTab }[tab]()
  return `<div class="section-head"><div><h2>Material &amp; Lager</h2>
      <p>Bestand je Lager, Ausgabe an Objekte und Personen, Bestellvorschlag und Bestellung beim Lieferanten, Anforderungen aus den Objekten (auch vom Handy), Verbrauch je Objekt.</p></div>
      <div class="actions">${headActions(ed)}</div></div>
    ${tabBar({ action: 'mat-tab', current: tab, cls: 'mat-tabs', tabs: TAB_GROUPS.map((g) => (g.items ? { label: g.label, items: g.items.map((k) => tabOf(k, flags)) } : tabOf(g, flags))) })}
    ${body}`
}

const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`

function welcome() {
  if (!editable()) return '<p class="empty">Noch keine Artikel angelegt.</p>'
  return `<div class="banner welcome"><p><strong>Noch keine Artikel.</strong> Mit dem Grundsortiment starten (${STARTER_ARTICLES.length} übliche Artikel wie Reiniger, Müllsäcke, Papier, mit Melde- und Sollbestand, ohne Preise), die Liste aus Excel einfügen oder Artikel einzeln anlegen.</p>
    <div class="actions"><button class="btn primary" data-action="mat-starter">Grundsortiment anlegen</button><button class="btn" data-action="mat-import-open">${ICON.upload} Liste einfügen</button><button class="btn" data-action="mat-article-open">${ICON.plus} Artikel</button></div></div>`
}

function stockTab() {
  const d = M()
  if (!d.articles.length) return welcome()
  const all = stockRows(d)
  const rows = stockRows(d, { category: app.ui.matCat || '', search: app.ui.matSearch || '', only: app.ui.matOnly ? 'niedrig' : '' })
  const low = all.filter((r) => r.status !== 'ok')
  const multi = d.locations.length > 1
  const ed = editable()
  const head = `<th>Artikel</th><th>Kategorie</th>${multi ? d.locations.map((l) => `<th class="num">${esc(l.name)}</th>`).join('') : ''}<th class="num">Bestand</th><th class="num">Melde- / Sollbestand</th><th class="num">bestellt</th><th>Zustand</th>`
  const body = rows
    .map((r) => {
      const a = r.article
      return `<tr class="clickable" data-action="mat-article-open" data-id="${esc(a.id)}"><td><strong>${esc(a.name)}</strong>${a.articleNo ? `<br><span class="muted">${esc(a.articleNo)}</span>` : ''}</td><td>${esc(a.category || '')}</td>
        ${multi ? d.locations.map((l) => `<td class="num">${qtyText(r.byLoc[l.id])}</td>`).join('') : ''}
        <td class="num"><strong>${qtyText(r.total)}</strong> ${esc(a.unit || '')}</td><td class="num">${a.min ? qtyText(a.min) : '–'} / ${a.target ? qtyText(a.target) : '–'}</td>
        <td class="num">${r.open ? qtyText(r.open) : ''}${r.draft ? `<br><span class="muted">${qtyText(r.draft)} im Entwurf</span>` : ''}</td>
        <td><span class="pill ${STATUS_CLASS[r.status]}">${STOCK_STATUS[r.status]}</span></td></tr>`
    })
    .join('')
  return `<div class="impact-stats tc-stats">${tile('Artikel', all.length)}${tile('Nachbestellen', low.length, low.length ? 'err' : '')}${tile('Lagerwert', euro(stockValue(all)))}${tile('Offene Bestellungen', openOrders(d.orders).length)}</div>
    <div class="filters">
      <label class="field inline"><span>Kategorie</span><select id="mat-cat" data-change="mat-cat">${options(CATEGORIES.map((c) => [c, c]), app.ui.matCat || '', { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Suche</span><input type="search" id="mat-search" value="${esc(app.ui.matSearch || '')}" placeholder="Artikel, Nummer, Lieferant" data-input="mat-search"></label>
      <label class="check"><input type="checkbox" id="mat-only" ${app.ui.matOnly ? 'checked' : ''} data-change="mat-only"><span>nur nachbestellen</span></label>
      <span class="spacer"></span>
      ${ed ? `<button class="btn small" data-action="mat-article-open">${ICON.plus} Artikel</button>` : ''}
      ${rowMenu([ed && multi && { label: 'Umbuchen', action: 'mat-book-open', data: { mode: 'umbuchung' } }, ed && { label: 'Inventur', icon: ICON.check, action: 'mat-inventory-open' }, ed && '-', { label: 'Bestand als CSV', icon: ICON.download, action: 'mat-stock-csv' }], 'Weitere Aktionen zum Bestand')}
    </div>
    ${body ? `<div class="table-wrap"><table class="data mat-stock"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Kein Artikel passt zu dieser Auswahl.</p>'}`
}

function orderTab() {
  const d = M()
  const ed = editable()
  const today = todayISO()
  const groups = orderSuggestions(d)
  const suggest = groups
    .map((g) => {
      const s = supOf(g.supplierId)
      const lines = g.lines.map((l) => `<tr><td>${esc(artName(l.articleId))}</td><td class="num">${qtyText(l.total)}</td><td class="num">${qtyText(l.min)} / ${qtyText(l.target)}</td><td class="num">${l.open ? qtyText(l.open) : ''}</td><td class="num"><strong>${qtyText(l.qty)}</strong> ${esc(artOf(l.articleId)?.unit || '')}</td></tr>`).join('')
      return `<section class="mat-group"><div class="section-head small"><h3>${s ? esc(s.name) : 'Ohne Lieferant'}</h3>${g.sum ? `<span class="muted">ca. ${euro(g.sum)} netto</span>` : ''}
          ${ed ? (s ? `<button class="btn small primary" data-action="mat-order-from" data-supplier="${esc(g.supplierId)}">Bestellung anlegen</button>` : '<span class="muted">Beim Artikel einen Lieferanten eintragen, dann kann bestellt werden.</span>') : ''}</div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Artikel</th><th class="num">Bestand</th><th class="num">Melde- / Sollbestand</th><th class="num">bestellt</th><th class="num">Vorschlag</th></tr></thead><tbody>${lines}</tbody></table></div></section>`
    })
    .join('')
  const filter = app.ui.matOrderFilter || 'offen'
  const orders = d.orders
    .filter((o) => (filter === 'offen' ? ['entwurf', 'bestellt', 'teilweise'].includes(o.status) : true))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const rows = orders
    .map(
      (o) => `<tr class="clickable" data-action="mat-order-open" data-id="${esc(o.id)}"><td>${esc(o.no || 'Entwurf')}</td><td>${esc(supOf(o.supplierId)?.name || '–')}</td><td>${o.orderedAt ? formatDate(o.orderedAt) : '–'}</td>
        <td>${o.expected ? formatDate(o.expected) : '–'}</td><td class="num">${(o.lines || []).filter((l) => l.articleId).length}</td><td class="num">${orderSum(o) ? euro(orderSum(o)) : ''}</td>
        <td>${isOverdue(o, today) ? `<span class="pill error">überfällig seit ${formatDate(o.expected)}</span>` : `<span class="pill ${ORDER_CLASS[o.status]}">${ORDER_STATUS[o.status]}</span>`}</td></tr>`,
    )
    .join('')
  const tab = (v, label) => `<button class="btn small ${filter === v ? 'primary' : ''}" data-action="mat-order-filter" data-v="${v}">${label}</button>`
  return `<h3>Bestellvorschlag</h3>
    ${suggest || `<p class="empty">${d.articles.some((a) => a.min > 0) ? 'Alles über dem Meldebestand (oder schon bestellt).' : 'Für einen Vorschlag beim Artikel einen Meldebestand eintragen.'}</p>`}
    <div class="section-head small"><h3>Bestellungen</h3><div class="actions">${tab('offen', 'Offen')}${tab('alle', 'Alle')}${ed ? `<button class="btn small" data-action="mat-order-new">${ICON.plus} Neue Bestellung</button>` : ''}</div></div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Nr.</th><th>Lieferant</th><th>Bestellt</th><th>Liefertermin</th><th class="num">Pos.</th><th class="num">Summe</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${filter === 'offen' ? 'Keine offenen Bestellungen.' : 'Noch keine Bestellungen.'}</p>`}`
}

const requestWhat = (r) =>
  (r.lines || [])
    .map((l) => (l.articleId ? `${l.qty ? `${qtyText(l.qty)} ` : ''}${artName(l.articleId)}` : l.text))
    .filter(Boolean)
    .join(', ')

function requestTab() {
  const d = M()
  const filter = app.ui.matReqFilter || 'offen'
  const list = d.requests.filter((r) => (filter === 'offen' ? isPendingRequest(r) : true)).sort((a, b) => (isOpenRequest(a) === isOpenRequest(b) ? (filter === 'offen' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)) : isOpenRequest(a) ? -1 : 1))
  const rows = list
    .map(
      (r) => `<tr class="clickable" data-action="mat-request-open" data-id="${esc(r.id)}"><td>${formatDate(r.at.slice(0, 10))}</td><td>${esc(objName(r.objectId) || r.objectName || '–')}</td><td>${esc(r.employeeId ? empName(r.employeeId) : r.name || r.by || '')}${r.source === 'handy' ? ' <span class="pill info">Handy</span>' : ''}</td>
      <td>${esc(requestWhat(r).slice(0, 120))}</td><td><span class="pill ${REQ_CLASS[r.status]}">${REQUEST_STATUS[r.status]}</span></td></tr>`,
    )
    .join('')
  const tab = (v, label) => `<button class="btn small ${filter === v ? 'primary' : ''}" data-action="mat-req-filter" data-v="${v}">${label}</button>`
  const portal = portalSettings()
  return `<p class="note">Objektleitung und Vorarbeiter:innen erfassen hier, was im Objekt fehlt. ${portal.enabled ? 'Mitarbeitende melden es am Handy unter „Mein Dienstplan“ → „Material fehlt?“; die Meldungen kommen automatisch hierher, sobald das Büro die App offen hat.' : 'Mit „Plan am Handy“ (Mitarbeitende) können es auch die Reinigungskräfte direkt am Handy melden.'}</p>
    <div class="filters">${tab('offen', 'Offen')}${tab('alle', 'Alle')}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Eingang</th><th>Objekt</th><th>Von</th><th>Was</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${filter === 'offen' ? 'Keine offenen Anforderungen.' : 'Noch keine Anforderungen.'}</p>`}`
}

/** Zeitraum für den Verbrauch: Monat, Quartal oder Jahr bis zum gewählten Monat. */
function usageRange() {
  const month = /^\d{4}-\d{2}$/.test(app.ui.matMonth || '') ? app.ui.matMonth : todayISO().slice(0, 7)
  const span = app.ui.matSpan || 'monat'
  const months = span === 'jahr' ? 12 : span === 'quartal' ? 3 : 1
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - months, 1)).toISOString().slice(0, 7)
  return { month, span, months, from: `${start}-01`, to: lastOfMonth(`${month}-01`) }
}

/** Materialbudget je Objekt im Monat aus der Kalkulation (nur wer die Kalkulation lesen darf). */
function budgets() {
  const k = app.data.kalkulation
  if (!k?.objects || (app.access && !app.access.sees('auswertung'))) return new Map()
  const s = { ...CALC_DEFAULTS, ...(k.settings || {}), performance: { ...CALC_DEFAULTS.performance, ...(k.settings?.performance || {}) } }
  const wage = calcWage(s, mergeRules(app.data.rules).wages)
  const out = new Map()
  for (const [id, o] of Object.entries(k.objects)) if (o?.areas?.length) out.set(id, materialBudget(calculate({ areas: o.areas, settings: s, wage })))
  return out
}

function usageTab() {
  const r = usageRange()
  const c = consumption(M(), r)
  const budget = budgets()
  const withBudget = budget.size > 0
  const top = (lines) => lines.slice(0, 3).map((l) => `${qtyText(l.qty)} ${esc(artName(l.articleId))}`).join(', ')
  const objRows = c.objects
    .map((o) => {
      const b = budget.has(o.id) ? budget.get(o.id) * r.months : null
      const diff = b !== null ? o.value - b : null
      return `<tr><td>${esc(o.id ? objName(o.id) || 'Objekt' : 'ohne Objekt')}</td><td class="num">${euro(o.value)}</td>${withBudget ? `<td class="num">${b !== null ? euro(b) : '–'}</td><td class="num">${diff !== null ? `<span class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${euro(Math.abs(diff))}</span>` : ''}</td>` : ''}<td>${top(o.lines)}</td></tr>`
    })
    .join('')
  const people = c.people.map((p) => `<tr><td>${esc(empName(p.id))}</td><td class="num">${euro(p.value)}</td><td>${top(p.lines)}</td></tr>`).join('')
  const spanBtn = (v, label) => `<button class="btn small ${r.span === v ? 'primary' : ''}" data-action="mat-span" data-v="${v}">${label}</button>`
  return `<div class="filters"><label class="field inline"><span>bis Monat</span><input type="month" id="mat-month" value="${r.month}" data-change="mat-month"></label>${spanBtn('monat', 'Monat')}${spanBtn('quartal', 'Quartal')}${spanBtn('jahr', '12 Monate')}<span class="spacer"></span><button class="btn small" data-action="mat-usage-csv">${ICON.download} CSV</button></div>
    <p class="muted">${formatDate(r.from, { year: true })} – ${formatDate(r.to, { year: true })} · Wert zum Preis bei der Ausgabe</p>
    <div class="impact-stats tc-stats">${tile('Verbrauch gesamt', euro(c.total))}${tile('Objekte', c.objects.filter((o) => o.id).length)}${tile('An Personen', euro(c.people.reduce((s, p) => s + p.value, 0)))}${c.categories[0] ? tile('Größte Kategorie', esc(c.categories[0].category)) : ''}</div>
    ${objRows ? `<h3>Je Objekt</h3><div class="table-wrap"><table class="data"><thead><tr><th>Objekt</th><th class="num">Verbrauch</th>${withBudget ? '<th class="num">Budget lt. Kalkulation</th><th class="num">Abweichung</th>' : ''}<th>Größte Posten</th></tr></thead><tbody>${objRows}</tbody></table></div>${withBudget ? '<p class="note">Budget = kalkulierte Stunden × Zuschlag „Material und Geräte“ je Stunde (Objektkalkulation), für den gewählten Zeitraum.</p>' : ''}` : '<p class="empty">In diesem Zeitraum wurde nichts ausgegeben.</p>'}
    ${people ? `<h3>An Personen (z. B. Arbeitskleidung)</h3><div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th class="num">Wert</th><th>Posten</th></tr></thead><tbody>${people}</tbody></table></div>` : ''}
    ${c.categories.length ? `<h3>Je Kategorie</h3><p>${c.categories.map((x) => `${esc(x.category)}: <strong>${euro(x.value)}</strong>`).join(' · ')}</p>` : ''}`
}

function journalTab() {
  const d = M()
  const kind = app.ui.matKind || ''
  const article = app.ui.matJournalArt || ''
  const list = d.moves
    .filter((m) => (!kind || m.kind === kind) && (!article || m.articleId === article))
    .slice()
    .sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.date.localeCompare(a.date))
    .slice(0, 300)
  const ed = editable()
  const target = (m) => [m.objectId ? objName(m.objectId) : '', m.employeeId ? empName(m.employeeId) : ''].filter(Boolean).join(', ')
  const rows = list
    .map((m) => {
      const canCancel = ed && !m.cancelledBy && !m.cancels && ['ausgabe', 'eingang', 'umbuchung', 'korrektur'].includes(m.kind) && !m.orderId && (m.kind !== 'umbuchung' || m.qty > 0)
      return `<tr class="${m.cancelledBy ? 'muted' : ''}"><td>${formatDate(m.date)}</td><td>${esc(MOVE_KINDS[m.kind] || m.kind)}${m.cancelledBy ? ' <span class="pill">storniert</span>' : ''}${m.cancels ? ' <span class="pill">Storno</span>' : ''}</td><td>${esc(artName(m.articleId))}</td>
        <td class="num ${m.qty < 0 ? 'neg' : 'pos'}">${m.qty > 0 ? '+' : ''}${qtyText(m.qty)}</td><td>${esc(locName(m.loc))}</td><td>${esc(target(m))}</td><td>${esc(m.by || '')}</td><td>${esc(m.note || '')}</td>
        <td>${canCancel ? `<button class="btn small" data-action="mat-cancel" data-id="${esc(m.id)}">${app.ui.confirm === `mat-cancel:${m.id}` ? 'Wirklich stornieren?' : 'Stornieren'}</button>` : ''}</td></tr>`
    })
    .join('')
  return `<div class="filters"><label class="field inline"><span>Art</span><select id="mat-kind" data-change="mat-kind">${options(Object.entries(MOVE_KINDS), kind, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Artikel</span><select id="mat-journal-art" data-change="mat-journal-art">${options(d.articles.map((a) => [a.id, a.name]), article, { empty: 'alle' })}</select></label></div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th>Art</th><th>Artikel</th><th class="num">Menge</th><th>Lager</th><th>Objekt / Person</th><th>Von</th><th>Notiz</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${list.length === 300 ? '<p class="note">Die neuesten 300 Buchungen. Mit Art oder Artikel eingrenzen.</p>' : ''}` : '<p class="empty">Noch keine Buchungen.</p>'}
    <p class="note">Gebucht wird nie überschrieben: Ein Storno bucht die Gegenrichtung. Buchungen älter als zwei Jahre fasst die App je Artikel und Lager zu einem Übertrag zusammen.</p>`
}

function masterTab() {
  const d = M()
  const ed = editable()
  const used = (sid) => d.articles.filter((a) => a.supplierId === sid).length
  const sup = d.suppliers
    .map((s) => `<tr class="clickable" data-action="mat-supplier-open" data-id="${esc(s.id)}"><td><strong>${esc(s.name)}</strong></td><td>${esc(s.email || '')}</td><td>${esc(s.phone || '')}</td><td>${esc(s.customerNo || '')}</td><td class="num">${used(s.id)}</td></tr>`)
    .join('')
  const map = stockMap(d.moves)
  const locRows = d.locations
    .map((l) => {
      const n = d.articles.filter((a) => (map.get(`${a.id}|${l.id}`) || 0) > 0).length
      return `<tr class="${ed ? 'clickable' : ''}" ${ed ? `data-action="mat-location-open" data-id="${esc(l.id)}"` : ''}><td><strong>${esc(l.name)}</strong>${l.id === MAIN_LOCATION.id ? ' <span class="muted">(Haupt)</span>' : ''}</td><td class="num">${n}</td></tr>`
    })
    .join('')
  const inactive = d.articles.filter((a) => a.active === false)
  const s = d.settings
  return `<div class="section-head small"><h3>Lieferanten</h3>${ed ? `<button class="btn small" data-action="mat-supplier-open">${ICON.plus} Lieferant</button>` : ''}</div>
    ${sup ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>E-Mail für Bestellungen</th><th>Telefon</th><th>Kundennummer</th><th class="num">Artikel</th></tr></thead><tbody>${sup}</tbody></table></div>` : '<p class="empty">Noch keine Lieferanten.</p>'}
    <div class="section-head small"><h3>Lager</h3>${ed ? `<button class="btn small" data-action="mat-location-open">${ICON.plus} Lager</button>` : ''}</div>
    <p class="note">Zum Beispiel Hauptlager, Außenlager oder je Fahrzeug. Material im Objekt (Putzraum) gilt mit der Ausgabe als verbraucht.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Lager</th><th class="num">Artikel mit Bestand</th></tr></thead><tbody>${locRows}</tbody></table></div>
    <div class="section-head small"><h3>Artikel</h3>${ed ? `<div class="actions"><button class="btn small" data-action="mat-import-open">${ICON.upload} Liste einfügen</button>${d.articles.length ? '' : '<button class="btn small" data-action="mat-starter">Grundsortiment anlegen</button>'}</div>` : ''}</div>
    <p class="muted">${plural(d.articles.length - inactive.length, 'Artikel', 'Artikel')} aktiv${inactive.length ? `, nicht mehr geführt: ${inactive.map((a) => `<button class="link-btn" data-action="mat-article-open" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join(', ')}` : ''}.</p>
    <div class="section-head small"><h3>Für Bestellungen</h3></div>
    <div class="form-grid">
      <label class="field wide"><span>Lieferadresse</span><input type="text" id="mat-set-address" value="${esc(s.deliveryAddress || '')}" placeholder="Firma, Straße, PLZ Ort" ${ed ? '' : 'disabled'}></label>
      <label class="field wide"><span>Rückfragen an (Name, Telefon)</span><input type="text" id="mat-set-contact" value="${esc(s.contact || '')}" ${ed ? '' : 'disabled'}></label>
    </div>${ed ? '<p><button class="btn small" data-action="mat-settings-save">Speichern</button></p>' : ''}`
}

registerView({
  id: 'material',
  order: 80,
  label: 'Material & Lager',
  group: 'lager',
  module: MODULE,
  icon: ICON_BOX,
  noWeek: true,
  text: 'Bestand, Bestellungen, Verbrauch',
  badge: () => counts().badge,
  render: materialView,
})

// ---------------------------------------------------------------- Artikel

function articleModal(c, m) {
  const d = M()
  const a = m.id ? artOf(m.id) : null
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const x = a || { name: '', category: CATEGORIES[0], unit: 'Stk', packSize: 1, active: true }
  const map = stockMap(d.moves)
  const recent = a ? d.moves.filter((mv) => mv.articleId === a.id).sort((p, q) => (q.at || '').localeCompare(p.at || '')).slice(0, 12) : []
  const usedInOrders = a && d.orders.some((o) => (o.lines || []).some((l) => l.articleId === a.id))
  const deletable = a && !recent.length && !usedInOrders
  return modalFrame({
    title: a ? a.name : 'Artikel anlegen',
    subtitle: a ? `${esc(a.category || '')}${a.articleNo ? ` · ${esc(a.articleNo)}` : ''}` : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field wide"><span>Bezeichnung</span><input type="text" id="ma-name" value="${esc(x.name)}" placeholder="z. B. Müllsäcke 120 l" ${dis}></label>
        <label class="field"><span>Kategorie</span><select id="ma-cat" ${dis}>${options(CATEGORIES.map((k) => [k, k]), x.category)}</select></label>
        <label class="field"><span>Einheit</span><input type="text" id="ma-unit" value="${esc(x.unit || '')}" list="ma-units" ${dis}><datalist id="ma-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></label>
        <label class="field"><span>Packung (bestellt wird in Vielfachen)</span><input type="number" id="ma-pack" min="1" step="1" value="${esc(x.packSize || 1)}" ${dis}></label>
        <label class="field"><span>Lieferant</span><select id="ma-sup" ${dis}>${options(d.suppliers.map((s) => [s.id, s.name]), x.supplierId || '', { empty: '– keiner –' })}</select></label>
        <label class="field"><span>Artikelnummer beim Lieferanten</span><input type="text" id="ma-no" value="${esc(x.articleNo || '')}" ${dis}></label>
        <label class="field"><span>Preis netto je Einheit (€)</span><input type="text" inputmode="decimal" id="ma-price" value="${x.price ? String(x.price).replace('.', ',') : ''}" ${dis}></label>
        <label class="field"><span>Meldebestand</span><input type="text" inputmode="decimal" id="ma-min" value="${x.min ? qtyText(x.min) : ''}" placeholder="ab hier nachbestellen" ${dis}></label>
        <label class="field"><span>Sollbestand</span><input type="text" inputmode="decimal" id="ma-target" value="${x.target ? qtyText(x.target) : ''}" placeholder="bis hier auffüllen" ${dis}></label>
        <label class="field wide"><span>Sicherheitsdatenblatt (Link)</span><input type="url" id="ma-sds" value="${esc(x.sds || '')}" placeholder="https://…" ${dis}></label>
        <label class="field wide"><span>Notiz (z. B. Dosierung, Alternative)</span><input type="text" id="ma-note" value="${esc(x.note || '')}" ${dis}></label>
        ${a ? `<label class="check"><input type="checkbox" id="ma-active" ${x.active !== false ? 'checked' : ''} ${dis}><span>wird geführt (sonst ausgeblendet, Buchungen bleiben)</span></label>` : `<label class="field"><span>Anfangsbestand im ${esc(d.locations[0].name)}</span><input type="text" inputmode="decimal" id="ma-start" placeholder="0" ${dis}></label>`}
      </div>
      ${/^https?:\/\//i.test(x.sds || '') ? `<p><a href="${esc(x.sds)}" target="_blank" rel="noopener">Sicherheitsdatenblatt öffnen</a></p>` : ''}
      ${a ? `<section><h3>Bestand</h3><p>${d.locations.map((l) => `${esc(l.name)}: <strong>${qtyText(map.get(`${a.id}|${l.id}`) || 0)}</strong>`).join(' · ')} · gesamt <strong>${qtyText(stockOf(d.moves, a.id, null, map))} ${esc(a.unit || '')}</strong></p></section>` : ''}
      ${recent.length ? `<section><h3>Letzte Buchungen</h3><ul class="tc-list">${recent.map((mv) => `<li>${formatDate(mv.date)} ${esc(MOVE_KINDS[mv.kind] || mv.kind)} ${mv.qty > 0 ? '+' : ''}${qtyText(mv.qty)} · ${esc(locName(mv.loc))}${mv.objectId ? ` → ${esc(objName(mv.objectId))}` : ''}${mv.employeeId ? ` → ${esc(empName(mv.employeeId))}` : ''}${mv.note ? ` <span class="muted">${esc(mv.note)}</span>` : ''}</li>`).join('')}</ul></section>` : ''}`,
    foot: `${ed && deletable ? `<button class="btn danger" data-action="mat-article-delete" data-id="${esc(a.id)}">${app.ui.confirm === `mat-art-del:${a.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : '<span></span>'}
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `<button class="btn primary" data-action="mat-article-save" data-id="${esc(a?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('mat-article', articleModal, { module: MODULE })

function saveArticle(id) {
  const name = val('ma-name').trim()
  if (!name) return toast('Bitte eine Bezeichnung eingeben.')
  const d = M()
  if (d.articles.some((a) => a.id !== id && a.name.trim().toLowerCase() === name.toLowerCase())) return toast(`„${name}“ gibt es schon.`)
  const fields = { name, category: val('ma-cat'), unit: val('ma-unit').trim() || 'Stk', packSize: Math.max(1, Math.round(numIn('ma-pack') || 1)), supplierId: val('ma-sup'), articleNo: val('ma-no').trim(), price: numIn('ma-price') || 0, min: numIn('ma-min') || 0, target: numIn('ma-target') || 0, sds: val('ma-sds').trim(), note: val('ma-note').trim() }
  if (fields.sds && !/^https?:\/\//i.test(fields.sds)) return toast('Der Link zum Sicherheitsdatenblatt muss mit https:// beginnen.')
  if (id) {
    d.articles = d.articles.map((a) => (a.id === id ? { ...a, ...fields, active: checked('ma-active') } : a))
  } else {
    const a = { id: newId(), ...fields, active: true }
    d.articles.push(a)
    const start = numIn('ma-start')
    if (start) d.moves.push({ id: newId(), at: nowIso(), date: todayISO(), kind: 'korrektur', articleId: a.id, loc: d.locations[0].id, qty: start, price: a.price, by: by(), note: 'Anfangsbestand' })
  }
  closeModal()
  commit(id ? 'Artikel gespeichert.' : `${name} angelegt.`)
}

// ---------------------------------------------------------------- Buchen: Ausgabe, Wareneingang, Umbuchung

const BOOK_TITLE = { ausgabe: 'Ausgabe an Objekt oder Person', eingang: 'Wareneingang ohne Bestellung', umbuchung: 'Umbuchen zwischen Lagern' }

function bookDraft() {
  const m = app.ui.modal
  m.lines ||= [{ articleId: '', qty: '' }]
  m.loc ||= M().locations[0].id
  m.to ||= M().locations.find((l) => l.id !== m.loc)?.id || m.loc
  m.date ||= todayISO()
  return m
}

/** Eingaben im Dialog übernehmen (vor dem Neuzeichnen). */
function readBook() {
  const m = bookDraft()
  if (!document.getElementById('mb-date')) return m
  m.lines = m.lines.map((l, i) => ({ articleId: val(`mb-art-${i}`), qty: val(`mb-qty-${i}`) }))
  Object.assign(m, { date: val('mb-date') || todayISO(), loc: val('mb-loc') || m.loc, to: val('mb-to') || m.to, objectId: val('mb-obj'), employeeId: val('mb-emp'), note: val('mb-note').trim() })
  return m
}

function bookModal() {
  const m = bookDraft()
  const d = M()
  const map = stockMap(d.moves)
  const lines = m.lines
    .map((l, i) => {
      const have = l.articleId ? map.get(`${l.articleId}|${m.loc}`) || 0 : null
      return `<div class="mat-line"><select id="mb-art-${i}" data-change="mat-book-redraw" aria-label="Artikel ${i + 1}">${articleOptions(l.articleId)}</select>
        <input type="text" inputmode="decimal" id="mb-qty-${i}" value="${esc(l.qty)}" placeholder="Menge" aria-label="Menge ${i + 1}">
        <span class="muted">${have !== null ? `${esc(artOf(l.articleId)?.unit || '')} · im Lager ${qtyText(have)}` : ''}</span>
        ${m.lines.length > 1 ? `<button class="btn small ghost" data-action="mat-book-line-del" data-i="${i}" aria-label="Position entfernen">${ICON.trash}</button>` : ''}</div>`
    })
    .join('')
  const multi = d.locations.length > 1
  return modalFrame({
    title: BOOK_TITLE[m.mode] || 'Buchen',
    subtitle: m.requestId ? 'zur Anforderung' : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="mb-date" value="${esc(m.date)}"></label>
        ${multi || m.mode === 'umbuchung' ? `<label class="field"><span>${m.mode === 'eingang' ? 'In Lager' : 'Aus Lager'}</span><select id="mb-loc" data-change="mat-book-redraw">${locationOptions(m.loc)}</select></label>` : ''}
        ${m.mode === 'umbuchung' ? `<label class="field"><span>In Lager</span><select id="mb-to">${locationOptions(m.to)}</select></label>` : ''}
        ${m.mode === 'ausgabe' ? `<label class="field"><span>An Objekt</span><select id="mb-obj">${objectOptions(m.objectId || '')}</select></label><label class="field"><span>oder an Person (z. B. Arbeitskleidung)</span><select id="mb-emp">${employeeOptions(m.employeeId || '')}</select></label>` : ''}
      </div>
      <section><h3>Positionen</h3><div class="mat-lines">${lines}</div><p><button class="btn small" data-action="mat-book-line-add">${ICON.plus} Position</button></p></section>
      <label class="field wide"><span>Notiz</span><input type="text" id="mb-note" value="${esc(m.note || '')}" placeholder="${m.mode === 'eingang' ? 'z. B. Lieferschein-Nr.' : ''}"></label>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mat-book-save">Buchen</button></div>`,
  })
}
registerModal('mat-book', bookModal, { module: MODULE })

async function saveBook() {
  const m = readBook()
  const d = M()
  const lines = m.lines.map((l) => ({ articleId: l.articleId, qty: parseFloat(String(l.qty).replace(',', '.')) })).filter((l) => l.articleId && l.qty > 0)
  if (!lines.length) return toast('Bitte mindestens einen Artikel mit Menge eintragen.')
  if (m.mode === 'umbuchung' && m.loc === m.to) return toast('Bitte zwei verschiedene Lager wählen.')
  if (m.mode === 'ausgabe' && m.objectId && m.employeeId) return toast('Bitte entweder ein Objekt oder eine Person wählen.')
  const base = { date: m.date, at: nowIso(), by: by(), note: m.note || '', newId }
  let moves
  if (m.mode === 'ausgabe') moves = issueMoves(lines, { ...base, articles: d.articles, loc: m.loc, objectId: m.objectId, employeeId: m.employeeId, requestId: m.requestId || '' })
  else if (m.mode === 'umbuchung') moves = transferMoves(lines, { ...base, from: m.loc, to: m.to })
  else moves = lines.map((l) => ({ id: newId(), at: base.at, date: base.date, kind: 'eingang', articleId: l.articleId, loc: m.loc, qty: l.qty, price: artOf(l.articleId)?.price || 0, by: base.by, note: base.note }))
  d.moves.push(...moves)
  // Bestand unter null? Hinweis (die Buchung zählt trotzdem: oft fehlt nur ein Wareneingang)
  const map = stockMap(d.moves)
  const negative = [...new Set(moves.filter((mv) => mv.qty < 0).map((mv) => mv.articleId))].filter((id) => (map.get(`${id}|${m.loc}`) || 0) < 0)
  let msg = m.mode === 'ausgabe' ? `Ausgabe gebucht${m.objectId ? ` an ${objName(m.objectId)}` : m.employeeId ? ` an ${empName(m.employeeId)}` : ''}.` : m.mode === 'umbuchung' ? `${plural(lines.length, 'Artikel', 'Artikel')} umgebucht.` : `Wareneingang gebucht (${plural(lines.length, 'Position', 'Positionen')}).`
  if (negative.length) msg += ` Achtung: ${negative.map(artName).join(', ')} jetzt unter null (Wareneingang fehlt? Inventur prüfen).`
  if (m.requestId) await finishRequest(m.requestId, 'ausgegeben', `Ausgegeben am ${formatDate(m.date)}`)
  closeModal()
  commit(msg)
}

// ---------------------------------------------------------------- Inventur

function inventoryModal() {
  const m = app.ui.modal
  const d = M()
  m.loc ||= d.locations[0].id
  const rows = stockRows(d)
  const body = rows.map((r) => `<tr><td>${esc(r.article.name)}<br><span class="muted">${esc(r.article.category || '')}</span></td><td class="num">${qtyText(r.byLoc[m.loc] || 0)} ${esc(r.article.unit || '')}</td><td><input type="text" inputmode="decimal" id="inv-${esc(r.article.id)}" class="inv-count" aria-label="gezählt ${esc(r.article.name)}"></td></tr>`).join('')
  return modalFrame({
    title: 'Inventur',
    subtitle: 'gezählte Mengen eintragen',
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Lager</span><select id="inv-loc" data-change="mat-inv-loc">${locationOptions(m.loc)}</select></label><label class="field"><span>Stichtag</span><input type="date" id="inv-date" value="${esc(m.date || todayISO())}"></label></div>
      <p class="note">Nur gezählte Artikel eintragen; leere Felder bleiben unverändert. Gebucht wird die Differenz zum Bestand laut App. Tipp: zuerst die Zählliste drucken.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Artikel</th><th class="num">laut App</th><th>gezählt</th></tr></thead><tbody>${body}</tbody></table></div>`,
    foot: `<button class="btn" data-action="mat-inv-pdf">${ICON.download} Zählliste (PDF)</button><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mat-inv-save">Inventur buchen</button></div>`,
  })
}
registerModal('mat-inventory', inventoryModal, { module: MODULE })

// ---------------------------------------------------------------- Bestellungen

function orderModal() {
  const m = app.ui.modal
  const d = M()
  const o = d.orders.find((x) => x.id === m.id)
  if (!o) return ''
  const ed = editable()
  const draft = o.status === 'entwurf' && ed
  const s = supOf(o.supplierId)
  const receiving = ['bestellt', 'teilweise'].includes(o.status) && ed
  const lines = (o.lines || [])
    .map((l, i) => {
      const a = artOf(l.articleId)
      if (draft)
        return `<tr><td><select id="mo-art-${i}" aria-label="Artikel ${i + 1}">${articleOptions(l.articleId)}</select></td><td><input type="text" inputmode="decimal" id="mo-qty-${i}" value="${qtyText(l.qty)}" aria-label="Menge ${i + 1}"></td><td>${esc(a?.unit || '')}</td><td><input type="text" inputmode="decimal" id="mo-price-${i}" value="${l.price ? String(l.price).replace('.', ',') : ''}" aria-label="Preis ${i + 1}"></td><td><button class="btn small ghost" data-action="mat-order-line-del" data-i="${i}" aria-label="Position entfernen">${ICON.trash}</button></td></tr>`
      const rest = Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0))
      return `<tr><td>${esc(a?.name || 'Artikel')}${a?.articleNo ? `<br><span class="muted">${esc(a.articleNo)}</span>` : ''}</td><td class="num">${qtyText(l.qty)} ${esc(a?.unit || '')}</td><td class="num">${l.price ? euro(l.price) : ''}</td><td class="num">${qtyText(l.received || 0)}</td>
        ${receiving ? `<td><input type="text" inputmode="decimal" id="mo-rec-${i}" value="${rest ? qtyText(rest) : ''}" aria-label="jetzt erhalten ${esc(a?.name || '')}"></td>` : ''}</tr>`
    })
    .join('')
  const head = draft ? '<th>Artikel</th><th>Menge</th><th>Einheit</th><th>Preis (€)</th><th></th>' : `<th>Artikel</th><th class="num">bestellt</th><th class="num">Preis</th><th class="num">erhalten</th>${receiving ? '<th>jetzt erhalten</th>' : ''}`
  const mail = s?.email
  const sent = o.sent ? `<p class="muted">${o.sent.via === 'graph' ? 'Per E-Mail gesendet' : o.sent.via === 'mailto' ? 'Im E-Mail-Programm geöffnet' : 'Als bestellt markiert'} am ${formatDate(o.sent.at.slice(0, 10))}${o.sent.to ? ` an ${esc(o.sent.to)}` : ''}${o.sent.by ? ` (${esc(o.sent.by)})` : ''}.</p>` : ''
  const confirmKey = (k) => app.ui.confirm === `${k}:${o.id}`
  return modalFrame({
    title: `Bestellung ${o.no || ''}`,
    subtitle: `${esc(s?.name || 'ohne Lieferant')} · ${ORDER_STATUS[o.status]}${o.orderedAt ? ` · bestellt ${formatDate(o.orderedAt)}` : ''}`,
    wide: true,
    body: `${draft ? `<div class="form-grid"><label class="field"><span>Lieferant</span><select id="mo-sup">${options(d.suppliers.map((x) => [x.id, x.name]), o.supplierId, { empty: '– wählen –' })}</select></label><label class="field"><span>Liefertermin (gewünscht)</span><input type="date" id="mo-expected" value="${esc(o.expected || '')}"></label><label class="field wide"><span>Hinweis an den Lieferanten</span><input type="text" id="mo-note" value="${esc(o.note || '')}"></label></div>` : `${o.expected ? `<p>Liefertermin: <strong>${formatDate(o.expected, { year: true })}</strong>${isOverdue(o, todayISO()) ? ' <span class="pill error">überfällig</span>' : ''}</p>` : ''}${o.note ? `<p>${esc(o.note)}</p>` : ''}`}
      ${sent}
      <div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${lines}</tbody></table></div>
      ${draft ? `<p><button class="btn small" data-action="mat-order-line-add">${ICON.plus} Position</button> <span class="muted">Summe netto ${euro(orderSum(o))}</span></p>` : `<p class="muted">Summe netto ${euro(orderSum(o))}</p>`}
      ${receiving ? `<section><h3>Wareneingang</h3><div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="mo-rec-date" value="${todayISO()}"></label>${d.locations.length > 1 ? `<label class="field"><span>In Lager</span><select id="mo-rec-loc">${locationOptions(d.locations[0].id)}</select></label>` : ''}</div><p class="note">Was jetzt geliefert wurde (vorgeschlagen: der Rest). Fehlt noch etwas, bleibt die Bestellung „teilweise geliefert“.</p><button class="btn primary" data-action="mat-order-receive">${ICON.check} Wareneingang buchen</button></section>` : ''}
      ${draft && !mail && s ? '<p class="note">Beim Lieferanten fehlt die E-Mail-Adresse: PDF herunterladen oder telefonisch bestellen und „Als bestellt markieren“.</p>' : ''}`,
    foot: `<div class="actions">${draft ? `<button class="btn danger" data-action="mat-order-delete">${confirmKey('mat-order-del') ? 'Wirklich löschen?' : 'Entwurf löschen'}</button>` : ''}${receiving ? `<button class="btn" data-action="mat-order-cancel">${confirmKey('mat-order-cancel') ? 'Wirklich stornieren?' : 'Stornieren'}</button>` : ''}<button class="btn" data-action="mat-order-pdf">${ICON.download} PDF</button></div>
      <div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${draft ? `<button class="btn" data-action="mat-order-save">Speichern</button><button class="btn" data-action="mat-order-mark">Als bestellt markieren</button>${mail ? `<button class="btn primary" data-action="mat-order-send">${ICON.send} ${canMail() ? 'Per E-Mail bestellen' : 'Im E-Mail-Programm öffnen'}</button>` : ''}` : ''}</div>`,
  })
}
registerModal('mat-order', orderModal, { module: MODULE })

const currentOrder = () => M().orders.find((o) => o.id === app.ui.modal?.id)

/** Eingaben im Entwurf übernehmen. */
function readOrder() {
  const o = currentOrder()
  if (!o || o.status !== 'entwurf' || !document.getElementById('mo-sup')) return o
  o.supplierId = val('mo-sup')
  o.expected = val('mo-expected')
  o.note = val('mo-note').trim()
  o.lines = o.lines.map((l, i) => {
    const articleId = val(`mo-art-${i}`)
    const changed = articleId !== l.articleId
    const price = parseFloat(String(val(`mo-price-${i}`)).replace(',', '.'))
    return { ...l, articleId, qty: parseFloat(String(val(`mo-qty-${i}`)).replace(',', '.')) || 0, price: changed ? artOf(articleId)?.price || 0 : Number.isFinite(price) ? price : 0 }
  })
  return o
}

function newOrder(supplierId, lines = []) {
  const d = M()
  const o = { id: newId(), no: nextOrderNo(d.orders, new Date().getFullYear()), supplierId: supplierId || '', status: 'entwurf', createdAt: nowIso(), orderedAt: null, expected: addDays(todayISO(), 7), lines: lines.map((l) => ({ articleId: l.articleId, qty: l.qty, price: l.price ?? artOf(l.articleId)?.price ?? 0, received: 0 })), note: '', by: by() }
  d.orders.push(o)
  persist()
  return o
}

function validOrder(o) {
  o.lines = o.lines.filter((l) => l.articleId && l.qty > 0)
  if (!o.supplierId) return toast('Bitte den Lieferanten wählen.') && false
  if (!o.lines.length) return toast('Bitte mindestens eine Position mit Menge eintragen.') && false
  return true
}

/** Bestellung abgeschickt: Status, Datum, wie und an wen. */
function markOrdered(o, via, to = '') {
  o.status = 'bestellt'
  o.orderedAt = todayISO()
  o.sent = { at: nowIso(), via, to, by: by() }
}

async function orderPdf(o) {
  return pdfBlob(orderDocument({ order: o, supplier: supOf(o.supplierId) || {}, articles: M().articles, settings: M().settings, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

const mailParts = (o) => {
  const s = supOf(o.supplierId) || {}
  const brand = app.config.brand || {}
  return {
    to: s.email,
    subject: `Bestellung ${o.no}${brand.name ? ` – ${brand.name}` : ''}`,
    text: orderMailText(o, { supplier: s, articles: M().articles, company: brand.name || '', sender: app.user?.name || '', deliveryAddress: M().settings.deliveryAddress || '', contact: M().settings.contact || '', formatDate: (x) => formatDate(x, { year: true }) }),
  }
}

// ---------------------------------------------------------------- Anforderungen

function requestModal() {
  const m = app.ui.modal
  const d = M()
  const r = m.id ? d.requests.find((x) => x.id === m.id) : null
  const ed = editable()
  if (!r) {
    m.lines ||= [{ articleId: '', qty: '', text: '' }]
    const lines = m.lines
      .map((l, i) => `<div class="mat-line"><select id="mr-art-${i}" aria-label="Artikel ${i + 1}">${articleOptions(l.articleId, { empty: '– Artikel oder Freitext –' })}</select><input type="text" inputmode="decimal" id="mr-qty-${i}" value="${esc(l.qty)}" placeholder="Menge" aria-label="Menge ${i + 1}"><input type="text" id="mr-text-${i}" value="${esc(l.text || '')}" placeholder="oder: was fehlt" aria-label="Freitext ${i + 1}"></div>`)
      .join('')
    return modalFrame({
      title: 'Anforderung erfassen',
      subtitle: 'Material, das im Objekt fehlt',
      wide: true,
      body: `<div class="form-grid"><label class="field"><span>Objekt</span><select id="mr-obj">${objectOptions(m.objectId || '')}</select></label><label class="field wide"><span>Notiz (z. B. bis wann, wo abstellen)</span><input type="text" id="mr-note" value="${esc(m.note || '')}"></label></div>
        <section><h3>Was wird gebraucht</h3><div class="mat-lines">${lines}</div><p><button class="btn small" data-action="mat-request-line-add">${ICON.plus} Position</button></p></section>`,
      foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mat-request-save">Anfordern</button></div>`,
    })
  }
  const open = isOpenRequest(r)
  const pending = isPendingRequest(r)
  const lines = (r.lines || [])
    .map((l) => {
      if (l.articleId) return `<li>${l.qty ? `${qtyText(l.qty)} ${esc(artOf(l.articleId)?.unit || '')} ` : ''}${esc(artName(l.articleId))}</li>`
      const match = matchArticle(l.text, d.articles)
      return `<li>„${esc(l.text)}“${match && open ? ` <span class="muted">→ passt zu ${esc(match.name)}</span>` : ''}</li>`
    })
    .join('')
  return modalFrame({
    title: `Anforderung ${objName(r.objectId) || r.objectName || ''}`,
    subtitle: `${formatDate(r.at.slice(0, 10))} · ${esc(r.employeeId ? empName(r.employeeId) : r.name || r.by || '')}${r.source === 'handy' ? ' · am Handy' : ''} · ${REQUEST_STATUS[r.status]}`,
    body: `<ul>${lines}</ul>${r.note ? `<p>${esc(r.note)}</p>` : ''}${r.answer ? `<p class="muted">${esc(r.answer)}</p>` : ''}
      ${r.orderId ? `<p>Bestellt mit <button class="link-btn" data-action="mat-order-open" data-id="${esc(r.orderId)}">Bestellung ${esc(d.orders.find((o) => o.id === r.orderId)?.no || '')}</button></p>` : ''}
      ${r.status === 'bestellt' ? '<p class="note">Wartet auf die Lieferung. Ist das Material da: „Ausgeben“ bucht es an das Objekt.</p>' : ''}
      ${open && ed ? `<label class="field wide"><span>Antwort (bei „Ablehnen“, geht ans Handy)</span><input type="text" id="mr-answer" placeholder="z. B. ist schon im Putzraum, Regal links"></label>` : ''}`,
    foot: pending && ed
      ? `<div class="actions">${open ? `<button class="btn" data-action="mat-request-reject" data-id="${esc(r.id)}">Ablehnen</button>` : ''}<button class="btn" data-action="mat-request-done" data-id="${esc(r.id)}">Erledigt ohne Buchung</button></div><div class="actions">${open ? `<button class="btn" data-action="mat-request-order" data-id="${esc(r.id)}">Bestellen</button>` : ''}<button class="btn primary" data-action="mat-request-issue" data-id="${esc(r.id)}">${ICON.send} Ausgeben</button></div>`
      : `<span></span><div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>`,
  })
}
registerModal('mat-request', requestModal, { module: MODULE })

/** Positionen einer Anforderung mit Artikel: Freitext, wenn möglich, einem Artikel zuordnen. */
function requestLines(r) {
  const d = M()
  return (r.lines || [])
    .map((l) => {
      const article = l.articleId ? artOf(l.articleId) : matchArticle(l.text, d.articles)
      return article ? { articleId: article.id, qty: Number(l.qty) > 0 ? Number(l.qty) : 1 } : null
    })
    .filter(Boolean)
}

/** Anforderung abschließen; kam sie vom Handy, bekommt die Person Bescheid (wenn Plan am Handy erreichbar). */
async function finishRequest(id, status, answer = '') {
  const r = M().requests.find((x) => x.id === id)
  if (!r) return
  r.status = status
  r.answer = answer
  r.doneAt = nowIso()
  r.doneBy = by()
  if (r.portalId && portalSettings().key) {
    const portalStatus = status === 'abgelehnt' ? 'abgelehnt' : status === 'bestellt' ? 'genehmigt' : 'erledigt'
    await call('antrag-status', { id: r.portalId, status: portalStatus, antwort: answer }).catch(() => {})
  }
}

// ---------------------------------------------------------------- Lieferanten, Lager, Import

function supplierModal(c, m) {
  const s = m.id ? supOf(m.id) : null
  const x = s || {}
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const used = s ? M().articles.filter((a) => a.supplierId === s.id).length + M().orders.filter((o) => o.supplierId === s.id).length : 0
  return modalFrame({
    title: s ? s.name : 'Lieferant anlegen',
    body: `<div class="form-grid">
      <label class="field wide"><span>Name</span><input type="text" id="ms-name" value="${esc(x.name || '')}" ${dis}></label>
      <label class="field"><span>E-Mail für Bestellungen</span><input type="email" id="ms-email" value="${esc(x.email || '')}" ${dis}></label>
      <label class="field"><span>Telefon</span><input type="tel" id="ms-phone" value="${esc(x.phone || '')}" ${dis}></label>
      <label class="field"><span>Ansprechperson</span><input type="text" id="ms-contact" value="${esc(x.contact || '')}" placeholder="z. B. Frau Huber" ${dis}></label>
      <label class="field"><span>Unsere Kundennummer</span><input type="text" id="ms-customer" value="${esc(x.customerNo || '')}" ${dis}></label>
      <label class="field wide"><span>Notiz (Mindestbestellwert, Lieferzeit …)</span><input type="text" id="ms-note" value="${esc(x.note || '')}" ${dis}></label></div>`,
    foot: `${ed && s && !used ? `<button class="btn danger" data-action="mat-supplier-delete" data-id="${esc(s.id)}">${app.ui.confirm === `mat-sup-del:${s.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : '<span></span>'}<div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `<button class="btn primary" data-action="mat-supplier-save" data-id="${esc(s?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('mat-supplier', supplierModal, { module: MODULE })

function locationModal(c, m) {
  const l = m.id ? M().locations.find((x) => x.id === m.id) : null
  const map = stockMap(M().moves)
  const empty = l && ![...map].some(([key, q]) => key.endsWith(`|${l.id}`) && q !== 0)
  return modalFrame({
    title: l ? l.name : 'Lager anlegen',
    body: `<label class="field wide"><span>Name</span><input type="text" id="ml-name" value="${esc(l?.name || '')}" placeholder="z. B. Bus S-284 KL, Außenlager"></label>`,
    foot: `${l && l.id !== MAIN_LOCATION.id && empty ? `<button class="btn danger" data-action="mat-location-delete" data-id="${esc(l.id)}">Löschen</button>` : '<span></span>'}<div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mat-location-save" data-id="${esc(l?.id || '')}">Speichern</button></div>`,
  })
}
registerModal('mat-location', locationModal, { module: MODULE })

function importModal(c, m) {
  const list = m.text ? parseArticles(m.text) : []
  const known = new Set(M().articles.map((a) => a.name.trim().toLowerCase()))
  const rows = list.slice(0, 50).map((a) => `<tr><td>${esc(a.name)}${known.has(a.name.trim().toLowerCase()) ? ' <span class="pill">aktualisieren</span>' : ''}</td><td>${esc(a.category)}</td><td>${esc(a.unit)}</td><td>${esc(a.supplier)}</td><td class="num">${a.price !== null ? euro(a.price) : ''}</td><td class="num">${a.min ?? ''} / ${a.target ?? ''}</td><td class="num">${a.stock ?? ''}</td></tr>`).join('')
  return modalFrame({
    title: 'Artikel aus Excel einfügen',
    wide: true,
    body: `<p>In Excel die Zeilen samt Überschrift markieren, kopieren und hier einfügen. Erkannte Spalten: <strong>Artikel</strong>, Einheit, Kategorie, Lieferant, Artikelnummer, Preis, Mindestbestand, Sollbestand, Packung, Bestand.</p>
      <textarea id="mat-import-text" rows="6" placeholder="Artikel&#9;Einheit&#9;Kategorie&#9;Lieferant&#9;Artikelnummer&#9;Preis&#9;Mindestbestand&#9;Sollbestand&#9;Bestand" data-input="mat-import-text">${esc(m.text || '')}</textarea>
      ${rows ? `<p>${plural(list.length, 'Artikel', 'Artikel')} erkannt${list.length > 50 ? ' (die ersten 50 angezeigt)' : ''}. Vorhandene Artikel (gleicher Name) werden aktualisiert, neue Lieferanten angelegt; „Bestand“ wird als Anfangsbestand im ${esc(M().locations[0].name)} gebucht (nur bei neuen Artikeln).</p><div class="table-wrap"><table class="data"><thead><tr><th>Artikel</th><th>Kategorie</th><th>Einheit</th><th>Lieferant</th><th class="num">Preis</th><th class="num">Melde / Soll</th><th class="num">Bestand</th></tr></thead><tbody>${rows}</tbody></table></div>` : m.text ? '<p class="err-text">Keine Artikel erkannt: Ist die Überschrift „Artikel“ (oder „Bezeichnung“) dabei?</p>' : ''}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mat-import-run" ${list.length ? '' : 'disabled'}>Übernehmen</button></div>`,
  })
}
registerModal('mat-import', importModal, { module: MODULE })

function runImport(text) {
  const d = M()
  const list = parseArticles(text)
  let created = 0
  let updated = 0
  const supplierId = (name) => {
    if (!name) return ''
    let s = d.suppliers.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!s) d.suppliers.push((s = { id: newId(), name: name.trim() }))
    return s.id
  }
  const at = nowIso()
  for (const x of list) {
    const fields = Object.fromEntries(Object.entries({ name: x.name, unit: x.unit, category: x.category, articleNo: x.articleNo, price: x.price, min: x.min, target: x.target, packSize: x.packSize }).filter(([, v]) => v !== null && v !== ''))
    if (x.supplier) fields.supplierId = supplierId(x.supplier)
    const old = d.articles.find((a) => a.name.trim().toLowerCase() === x.name.trim().toLowerCase())
    if (old) {
      Object.assign(old, fields, { active: true })
      updated++
      continue
    }
    const a = { id: newId(), packSize: 1, price: 0, min: 0, target: 0, active: true, ...fields }
    d.articles.push(a)
    created++
    if (x.stock) d.moves.push({ id: newId(), at, date: todayISO(), kind: 'korrektur', articleId: a.id, loc: d.locations[0].id, qty: x.stock, price: a.price || 0, by: by(), note: 'Anfangsbestand (Import)' })
  }
  closeModal()
  commit(`${plural(created, 'Artikel', 'Artikel')} angelegt${updated ? `, ${updated} aktualisiert` : ''}.`)
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'mat-tab': (el) => {
    app.ui.matTab = el.dataset.v
    app.ui.confirm = null
    renderNow()
  },
  'mat-cat': () => {
    app.ui.matCat = val('mat-cat')
    renderNow()
  },
  'mat-search': () => {
    app.ui.matSearch = val('mat-search')
    renderNow()
    const el = document.getElementById('mat-search')
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  },
  'mat-only': () => {
    app.ui.matOnly = checked('mat-only')
    renderNow()
  },
  'mat-order-filter': (el) => {
    app.ui.matOrderFilter = el.dataset.v
    renderNow()
  },
  'mat-req-filter': (el) => {
    app.ui.matReqFilter = el.dataset.v
    renderNow()
  },
  'mat-month': () => {
    app.ui.matMonth = val('mat-month')
    renderNow()
  },
  'mat-span': (el) => {
    app.ui.matSpan = el.dataset.v
    renderNow()
  },
  'mat-kind': () => {
    app.ui.matKind = val('mat-kind')
    renderNow()
  },
  'mat-journal-art': () => {
    app.ui.matJournalArt = val('mat-journal-art')
    renderNow()
  },
  'mat-article-open': (el) => openModal({ type: 'mat-article', id: el.dataset.id || '' }),
  'mat-order-open': (el) => openModal({ type: 'mat-order', id: el.dataset.id }),
  'mat-request-open': (el) => openModal({ type: 'mat-request', id: el.dataset.id }),
  'mat-supplier-open': (el) => openModal({ type: 'mat-supplier', id: el.dataset.id || '' }),
  'mat-import-text': () => {
    app.ui.modal.text = val('mat-import-text')
    renderModalKeepingInput()
  },
  'mat-stock-csv': () => {
    const d = M()
    const cols = [
      ['Artikel', (r) => r.article.name],
      ['Kategorie', (r) => r.article.category || ''],
      ['Einheit', (r) => r.article.unit || ''],
      ['Artikelnummer', (r) => r.article.articleNo || ''],
      ['Lieferant', (r) => supOf(r.article.supplierId)?.name || ''],
      ...d.locations.map((l) => [l.name, (r) => String(r.byLoc[l.id] || 0).replace('.', ',')]),
      ['Bestand gesamt', (r) => String(r.total).replace('.', ',')],
      ['Meldebestand', (r) => String(r.article.min || '').replace('.', ',')],
      ['Sollbestand', (r) => String(r.article.target || '').replace('.', ',')],
      ['Preis', (r) => String(r.article.price || '').replace('.', ',')],
      ['Wert', (r) => String(r.value).replace('.', ',')],
      ['Zustand', (r) => STOCK_STATUS[r.status]],
    ]
    download(`Lagerbestand_${todayISO()}.csv`, new Blob([`﻿${toCSV(stockRows(d), cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'mat-usage-csv': () => {
    const r = usageRange()
    const c = consumption(M(), r)
    const rows = [...c.objects.flatMap((o) => o.lines.map((l) => ({ to: o.id ? objName(o.id) : 'ohne Objekt', kind: 'Objekt', ...l }))), ...c.people.flatMap((p) => p.lines.map((l) => ({ to: empName(p.id), kind: 'Person', ...l })))]
    const cols = [
      ['An', (x) => x.to],
      ['Art', (x) => x.kind],
      ['Artikel', (x) => artName(x.articleId)],
      ['Menge', (x) => String(x.qty).replace('.', ',')],
      ['Einheit', (x) => artOf(x.articleId)?.unit || ''],
      ['Wert', (x) => String(x.value).replace('.', ',')],
    ]
    download(`Materialverbrauch_${r.from}_${r.to}.csv`, new Blob([`﻿${toCSV(rows, cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'mat-order-pdf': async () => {
    const o = readOrder() || currentOrder()
    if (o) download(orderPdfName(o, supOf(o.supplierId)), await orderPdf(o))
  },
  'mat-inv-loc': () => {
    app.ui.modal.loc = val('inv-loc')
    app.ui.modal.date = val('inv-date')
    renderModal()
  },
  'mat-inv-pdf': async () => {
    const d = M()
    const loc = d.locations.find((l) => l.id === (val('inv-loc') || app.ui.modal.loc)) || d.locations[0]
    download(`Inventur_${loc.name.replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-')}_${todayISO()}.pdf`, await pdfBlob(countDocument({ rows: stockRows(d), location: loc, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })))
  },
})

registerActions(
  {
    'mat-starter': () => {
      const d = M()
      if (d.articles.length) return toast('Es gibt schon Artikel.')
      d.articles.push(...STARTER_ARTICLES.map((a) => ({ id: newId(), ...a, price: 0, articleNo: '', supplierId: '', active: true })))
      commit(`${STARTER_ARTICLES.length} Artikel angelegt. Jetzt Lieferanten und Preise ergänzen und den Bestand per Inventur erfassen.`)
    },
    'mat-import-open': () => openModal({ type: 'mat-import', text: '' }),
    'mat-import-run': () => runImport(app.ui.modal.text || val('mat-import-text')),
    'mat-article-save': (el) => saveArticle(el.dataset.id || ''),
    'mat-article-delete': (el) => {
      if (!confirmStep(`mat-art-del:${el.dataset.id}`, renderModal)) return
      M().articles = M().articles.filter((a) => a.id !== el.dataset.id)
      closeModal()
      commit('Artikel gelöscht.')
    },
    'mat-book-open': (el) => {
      if (!M().articles.length) return toast('Zuerst Artikel anlegen.')
      openModal({ type: 'mat-book', mode: el.dataset.mode || 'ausgabe', objectId: el.dataset.obj || '' })
    },
    'mat-book-redraw': () => {
      readBook()
      renderModal()
    },
    'mat-book-line-add': () => {
      readBook().lines.push({ articleId: '', qty: '' })
      renderModal()
    },
    'mat-book-line-del': (el) => {
      const m = readBook()
      m.lines.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mat-book-save': () => saveBook(),
    'mat-inventory-open': () => openModal({ type: 'mat-inventory' }),
    'mat-inv-save': () => {
      const d = M()
      const loc = val('inv-loc') || app.ui.modal.loc
      const counts = Object.fromEntries(d.articles.map((a) => [a.id, String(val(`inv-${a.id}`)).trim().replace(',', '.')]).filter(([, v]) => v !== ''))
      if (!Object.keys(counts).length) return toast('Bitte mindestens eine gezählte Menge eintragen.')
      const moves = inventoryMoves(d.moves, counts, { loc, date: val('inv-date') || todayISO(), at: nowIso(), by: by(), articles: d.articles, newId })
      d.moves.push(...moves)
      closeModal()
      commit(moves.length ? `Inventur gebucht: ${plural(moves.length, 'Differenz', 'Differenzen')} bei ${plural(Object.keys(counts).length, 'gezähltem Artikel', 'gezählten Artikeln')}.` : `Inventur: alle ${Object.keys(counts).length} gezählten Artikel stimmen.`)
    },
    'mat-cancel': (el) => {
      const d = M()
      const mv = d.moves.find((x) => x.id === el.dataset.id)
      if (!mv || !confirmStep(`mat-cancel:${mv.id}`)) return
      const group = mv.pair ? d.moves.filter((x) => x.pair === mv.pair) : [mv]
      const at = nowIso()
      for (const x of group) {
        const back = { ...x, id: newId(), at, date: todayISO(), qty: -x.qty, by: by(), note: `Storno vom ${formatDate(x.date)}${x.note ? `: ${x.note}` : ''}`, cancels: x.id, pair: x.pair ? `${x.pair}-s` : undefined }
        if (!back.pair) delete back.pair
        d.moves.push(back)
        x.cancelledBy = back.id
      }
      commit('Buchung storniert (Gegenbuchung).')
    },
    'mat-order-new': () => {
      const o = newOrder(M().suppliers.length === 1 ? M().suppliers[0].id : '', [])
      o.lines.push({ articleId: '', qty: 0, price: 0, received: 0 })
      openModal({ type: 'mat-order', id: o.id })
    },
    'mat-order-from': (el) => {
      const g = orderSuggestions(M()).find((x) => x.supplierId === el.dataset.supplier)
      if (!g) return toast('Kein Vorschlag mehr für diesen Lieferanten.')
      const o = newOrder(g.supplierId, g.lines)
      renderNow()
      openModal({ type: 'mat-order', id: o.id })
    },
    'mat-order-line-add': () => {
      const o = readOrder()
      o.lines.push({ articleId: '', qty: 0, price: 0, received: 0 })
      renderModal()
    },
    'mat-order-line-del': (el) => {
      const o = readOrder()
      o.lines.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mat-order-save': () => {
      const o = readOrder()
      o.lines = o.lines.filter((l) => l.articleId && l.qty > 0)
      persist()
      renderNow()
      renderModal()
      toast('Entwurf gespeichert.')
    },
    'mat-order-delete': () => {
      const o = currentOrder()
      if (!o || !confirmStep(`mat-order-del:${o.id}`, renderModal)) return
      M().orders = M().orders.filter((x) => x.id !== o.id)
      closeModal()
      commit('Entwurf gelöscht.')
    },
    'mat-order-mark': () => {
      const o = readOrder()
      if (!validOrder(o)) return renderModal()
      markOrdered(o, 'markiert')
      renderModal()
      commit(`Bestellung ${o.no} als bestellt markiert.`)
    },
    'mat-order-send': async (el) => {
      const o = readOrder()
      if (!validOrder(o)) return renderModal()
      const mail = mailParts(o)
      if (!mail.to) return toast('Beim Lieferanten fehlt die E-Mail-Adresse.')
      el.disabled = true
      try {
        const pdf = await orderPdf(o)
        if (canMail()) {
          await sendMail(app.auth.getToken, { to: mail.to, subject: mail.subject, text: mail.text, attachments: [{ name: orderPdfName(o, supOf(o.supplierId)), blob: pdf, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
          markOrdered(o, 'graph', mail.to)
        } else {
          download(orderPdfName(o, supOf(o.supplierId)), pdf)
          location.href = `mailto:${encodeURIComponent(mail.to).replace(/%40/g, '@')}?${new URLSearchParams({ subject: mail.subject, body: `${mail.text}\n\n(PDF bitte anhängen: ${orderPdfName(o, supOf(o.supplierId))})` }).toString().replace(/\+/g, '%20')}`
          markOrdered(o, 'mailto', mail.to)
        }
        renderModal()
        commit(canMail() ? `Bestellung ${o.no} an ${mail.to} gesendet.` : `E-Mail an ${mail.to} vorbereitet; das PDF liegt im Download-Ordner zum Anhängen.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht gesendet: ${err.message}`)
      }
    },
    'mat-order-cancel': () => {
      const o = currentOrder()
      if (!o || !confirmStep(`mat-order-cancel:${o.id}`, renderModal)) return
      o.status = 'storniert'
      renderModal()
      commit(`Bestellung ${o.no} storniert.`)
    },
    'mat-order-receive': () => {
      const o = currentOrder()
      const received = Object.fromEntries(o.lines.map((l, i) => [i, parseFloat(String(val(`mo-rec-${i}`)).replace(',', '.')) || 0]))
      if (!Object.values(received).some((q) => q > 0)) return toast('Bitte die gelieferten Mengen eintragen.')
      const res = receiveOrder(o, received, { loc: val('mo-rec-loc') || M().locations[0].id, date: val('mo-rec-date') || todayISO(), at: nowIso(), by: by(), newId })
      Object.assign(o, res.order)
      M().moves.push(...res.moves)
      // Preise der Lieferung an den Artikeln übernehmen (letzter Einkaufspreis)
      for (const mv of res.moves) {
        const a = artOf(mv.articleId)
        if (a && mv.price > 0) a.price = mv.price
      }
      renderModal()
      commit(o.status === 'geliefert' ? `Bestellung ${o.no} vollständig geliefert, Bestand gebucht.` : `Teillieferung gebucht; der Rest bleibt offen.`)
    },
    'mat-request-new': (el) => openModal({ type: 'mat-request', objectId: el.dataset.obj || '' }),
    'mat-request-line-add': () => {
      const m = app.ui.modal
      m.lines = (m.lines || []).map((l, i) => ({ articleId: val(`mr-art-${i}`), qty: val(`mr-qty-${i}`), text: val(`mr-text-${i}`) }))
      m.objectId = val('mr-obj')
      m.note = val('mr-note')
      m.lines.push({ articleId: '', qty: '', text: '' })
      renderModal()
    },
    'mat-request-save': () => {
      const m = app.ui.modal
      const lines = (m.lines || []).map((l, i) => ({ articleId: val(`mr-art-${i}`), qty: parseFloat(String(val(`mr-qty-${i}`)).replace(',', '.')) || 0, text: val(`mr-text-${i}`).trim() })).filter((l) => l.articleId || l.text)
      if (!val('mr-obj')) return toast('Bitte das Objekt wählen.')
      if (!lines.length) return toast('Bitte eintragen, was gebraucht wird.')
      M().requests.push({ id: newId(), at: nowIso(), source: 'app', by: by(), employeeId: '', name: by(), objectId: val('mr-obj'), lines, note: val('mr-note').trim(), status: 'offen', answer: '' })
      closeModal()
      commit(`Anforderung für ${objName(val('mr-obj')) || 'das Objekt'} erfasst.`)
    },
    'mat-request-issue': (el) => {
      const r = M().requests.find((x) => x.id === el.dataset.id)
      const lines = requestLines(r)
      openModal({ type: 'mat-book', mode: 'ausgabe', objectId: r.objectId || '', employeeId: r.objectId ? '' : r.employeeId || '', lines: lines.length ? lines.map((l) => ({ articleId: l.articleId, qty: qtyText(l.qty) })) : [{ articleId: '', qty: '' }], requestId: r.id, note: `Anforderung vom ${formatDate(r.at.slice(0, 10))}` })
    },
    'mat-request-order': async (el) => {
      const d = M()
      const r = d.requests.find((x) => x.id === el.dataset.id)
      const lines = requestLines(r)
      if (!lines.length) return toast('Keine Position passt zu einem Artikel: bitte „Ausgeben“ wählen und die Artikel auswählen oder den Artikel anlegen.')
      const bySupplier = new Map()
      for (const l of lines) {
        const sid = artOf(l.articleId)?.supplierId || ''
        if (!bySupplier.has(sid)) bySupplier.set(sid, [])
        bySupplier.get(sid).push(l)
      }
      let order = null
      for (const [sid, ls] of bySupplier) {
        // in einen offenen Entwurf desselben Lieferanten, sonst neu
        order = d.orders.find((o) => o.status === 'entwurf' && o.supplierId === sid) || newOrder(sid, [])
        for (const l of ls) {
          const same = order.lines.find((x) => x.articleId === l.articleId)
          if (same) same.qty += l.qty
          else order.lines.push({ articleId: l.articleId, qty: l.qty, price: artOf(l.articleId)?.price || 0, received: 0 })
        }
      }
      r.orderId = order.id
      await finishRequest(r.id, 'bestellt', 'Wird bestellt.')
      commit(`Zur Bestellung ${order.no} hinzugefügt (Entwurf): dort prüfen und abschicken.`)
      openModal({ type: 'mat-order', id: order.id })
    },
    'mat-request-reject': async (el) => {
      const answer = val('mr-answer').trim()
      await finishRequest(el.dataset.id, 'abgelehnt', answer || 'Nicht nötig.')
      closeModal()
      commit('Anforderung abgelehnt.')
    },
    'mat-request-done': async (el) => {
      await finishRequest(el.dataset.id, 'ausgegeben', val('mr-answer').trim() || 'Erledigt.')
      closeModal()
      commit('Anforderung erledigt.')
    },
    'mat-supplier-save': (el) => {
      const name = val('ms-name').trim()
      if (!name) return toast('Bitte den Namen eingeben.')
      const email = val('ms-email').trim()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Die E-Mail-Adresse sieht nicht richtig aus.')
      const fields = { name, email, phone: val('ms-phone').trim(), contact: val('ms-contact').trim(), customerNo: val('ms-customer').trim(), note: val('ms-note').trim() }
      const d = M()
      if (el.dataset.id) d.suppliers = d.suppliers.map((s) => (s.id === el.dataset.id ? { ...s, ...fields } : s))
      else d.suppliers.push({ id: newId(), ...fields })
      closeModal()
      commit('Lieferant gespeichert.')
    },
    'mat-supplier-delete': (el) => {
      if (!confirmStep(`mat-sup-del:${el.dataset.id}`, renderModal)) return
      M().suppliers = M().suppliers.filter((s) => s.id !== el.dataset.id)
      closeModal()
      commit('Lieferant gelöscht.')
    },
    'mat-location-open': (el) => openModal({ type: 'mat-location', id: el.dataset.id || '' }),
    'mat-location-save': (el) => {
      const name = val('ml-name').trim()
      if (!name) return toast('Bitte einen Namen eingeben.')
      const d = M()
      if (el.dataset.id) d.locations = d.locations.map((l) => (l.id === el.dataset.id ? { ...l, name } : l))
      else d.locations.push({ id: newId(), name })
      closeModal()
      commit('Lager gespeichert.')
    },
    'mat-location-delete': (el) => {
      M().locations = M().locations.filter((l) => l.id !== el.dataset.id)
      closeModal()
      commit('Lager gelöscht.')
    },
    'mat-settings-save': () => {
      Object.assign(M().settings, { deliveryAddress: val('mat-set-address').trim(), contact: val('mat-set-contact').trim() })
      commit('Gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen, Objekt-Hinweis, Handy

registerTodo({
  id: 'material',
  module: MODULE,
  title: 'Material & Lager',
  compute: (today) => {
    const d = M()
    const out = []
    const lines = orderSuggestions(d).flatMap((g) => g.lines)
    if (lines.length) out.push({ id: `bestellen:${lines.map((l) => l.articleId).sort().join(',')}`, kind: 'bestellen', lines })
    for (const o of d.orders.filter((x) => isOverdue(x, today))) out.push({ id: `liefer:${o.id}:${o.expected}`, kind: 'liefer', order: o })
    for (const r of d.requests.filter(isOpenRequest)) out.push({ id: `anf:${r.id}`, kind: 'anf', request: r })
    return out
  },
  render: (list) =>
    list
      .map((x) => {
        if (x.kind === 'bestellen') return `<div class="todo-item"><span class="flag warning">${x.lines.length}</span><div class="todo-text"><strong>Nachbestellen:</strong> ${esc(x.lines.slice(0, 4).map((l) => artName(l.articleId)).join(', '))}${x.lines.length > 4 ? ' …' : ''}<br><span class="muted">am oder unter dem Meldebestand und nicht bestellt</span></div><button class="btn small primary" data-action="mat-goto" data-v="bestellen">Bestellvorschlag</button></div>`
        if (x.kind === 'liefer') return `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Lieferung überfällig:</strong> Bestellung ${esc(x.order.no)} bei ${esc(supOf(x.order.supplierId)?.name || '')}, erwartet ${formatDate(x.order.expected)}</div><button class="btn small primary" data-action="mat-order-open" data-id="${esc(x.order.id)}">Öffnen</button></div>`
        const r = x.request
        return `<div class="todo-item"><span class="flag info">+</span><div class="todo-text"><strong>Material für ${esc(objName(r.objectId) || r.objectName || 'ein Objekt')}</strong>: ${esc(requestWhat(r).slice(0, 100))}<br><span class="muted">${esc(r.employeeId ? empName(r.employeeId) : r.name || r.by || '')}${r.source === 'handy' ? ' am Handy' : ''}, ${formatDate(r.at.slice(0, 10))}</span></div><button class="btn small primary" data-action="mat-request-open" data-id="${esc(r.id)}">Öffnen</button></div>`
      })
      .join(''),
})

registerActions({
  'mat-goto': (el) => {
    app.ui.matTab = el.dataset.v
    app.ui.view = 'material'
    app.ui.modal = null
    renderNow()
  },
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const open = M().requests.filter((r) => r.objectId === objectId && isOpenRequest(r))
    return open.length ? `<strong>Material angefordert</strong>: ${esc(open.map(requestWhat).join('; ').slice(0, 140))} <button class="btn small" data-action="mat-request-open" data-id="${esc(open[0].id)}">Ansehen</button>` : ''
  },
})

/**
 * Meldungen „Material fehlt“ aus „Mein Dienstplan“: übernimmt sie als Anforderung (einmal je Meldung)
 * und gibt der Person am Handy Bescheid. Nur wer im Lager ändern darf und die Lager-Datei hat.
 */
onPortalRequests(async (list, { decide }) => {
  if (!canEdit(MODULE) || app.readOnly || !app.data) return []
  const d = M()
  const handled = []
  for (const a of list.filter((x) => x.art === 'Material')) {
    if (!d.requests.some((r) => r.portalId === a.id)) d.requests.push(requestFromPortal(a, { employeeId: a.employeeId, objects: app.data.objects, newId }))
    handled.push(a)
  }
  if (!handled.length) return []
  persist()
  for (const a of handled) await decide(a, 'genehmigt', 'Ist notiert. Das Lager kümmert sich darum.')
  toast(handled.length === 1 ? `Material-Meldung von ${handled[0].name} übernommen (Material & Lager → Anforderungen).` : `${handled.length} Material-Meldungen übernommen (Material & Lager → Anforderungen).`)
  return handled
})
