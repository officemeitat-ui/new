// Mattenwechsel-Modul, Mattenbestand und Wäscherei (docs/MATTENWECHSEL-PLAN.md P17, Entscheidung E16): Ansicht
// „Matten-Bestand“ (mw-bestand, wer den Mattenwechsel sieht; Fahrer nicht). Je Mattentyp Lager sauber, beim Kunden, im
// Fahrzeug, Wäscherei, gesamt, Schwund, ausgeschieden und Mindestbestand mit Ampel; Inventur, Wäscherei abholen (mit
// Lieferschein als PDF und Versand an die Wäscherei, nur auf Klick), Wäscherei zurück (mit Schwund und ausgeschieden),
// Zukauf/Ausscheiden/Korrektur, Verlauf mit Storno; „reicht der saubere Bestand für die Touren der nächsten Tage?“.
// Die Wechsel der abgeschlossenen Touren bucht die App selbst (je Stopp eine Buchung, nie doppelt), sobald jemand mit
// Bearbeitungsrecht die Touren gelesen hat; bis dahin rechnet die Ansicht sie mit.
// Dazu: Zeile in der Matten-Übersicht (stockLine), Hinweis bei der Freigabe in der Tourenplanung (tourStockHint),
// „Zu erledigen“ und Zähler für den digitalen Mitarbeiter (app.mwBe), Kennzahlen der Wäscherei (kpiHooks.mattenBestand).
// Rechenkern: core/matten-bestand.js; PDF: export/matten-bestand-pdf.js. Aktionen, Dialoge und Klassen „mwb-“.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import {
  applySync,
  belowMin,
  bestandRights,
  bookingProblem,
  cancelBooking,
  cancelProblem,
  CORRECT_POOLS,
  COUNTED,
  coverage,
  daysOf,
  describe,
  emptyBestand,
  FROM_POOLS,
  historyOf,
  KINDS,
  laundryMail,
  laundryMonths,
  laundryOf,
  LEVELS,
  levelOf,
  MANUAL_KINDS,
  newBooking,
  nextSlipNo,
  NOTE_REQUIRED,
  parseCount,
  POOLS,
  pruneBookings,
  settingsProblem,
  stockRows,
  stockTotals,
  syncCount,
  tourShortage,
  tourSync,
  upgradeBestand,
} from '../../core/matten-bestand.js'
import { emptyMatten, upgradeMatten } from '../../core/matten.js'
import { tourYears } from '../../core/matten-touren.js'
import { laundryDocument, laundryPdfName } from '../../export/matten-bestand-pdf.js'
import { app, closeModal, memo, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { onToursChanged, tourStore } from '../matten-tourablage.js'
import { invalidateTodo, registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { kpiHooks } from './lazy.js'

const MODULE = 'matten'
const VIEW = 'mw-bestand'
const KEY = 'mattenBestand'
const ICON_BE = '<path d="M3.5 8.5 12 4l8.5 4.5v11h-17z"/><path d="M7.5 19.5v-6h9v6M7.5 16.5h9"/>'

const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const sees = (m) => !app.access || app.access.sees(m)
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const shortDay = (d) => (d ? formatDate(d) : '–')
/** Stückzahl: leer als „–“, negativ mit echtem Minus. */
const num = (n) => (n === null || n === undefined ? '–' : String(n).replace('-', '−'))
const atText = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Vienna' }) : '')

const doc = () => upgradeBestand((app.data[KEY] ||= emptyBestand()))
const mdoc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const placements = () => mdoc().placements || []
/** Mattentypen der Fakturierung, wenn lesbar (sonst Kopien an den Liegeplätzen). */
const articles = () => (sees('fakturierung') ? app.data.fakturierung?.articles || null : null)
const rights = () => bestandRights(app.access)
const editable = () => rights().edit && !app.readOnly

// ---------------------------------------------------------------- Touren lesen (gemeinsame Ablage mit Planung und Fahrern)

/** Jahre der Touren: Vorjahr (Wechsel seit der Inventur) bis zum Ende der Vorschau. */
export const bestandYears = (today = todayISO()) => tourYears(`${Number(today.slice(0, 4)) - 1}-01-01`, addDays(today, daysOf(app.data?.[KEY]) + 1))
const attempts = new Map()
/** Touren der Jahre gelesen? Fehlende bzw. ältere als maxAge im Hintergrund lesen (nach einem Fehler frühestens nach 15 s). */
function ensureTours(years = bestandYears(), maxAge = 5 * 60_000) {
  const s = tourStore()
  if (!s) return false
  const now = Date.now()
  const todo = years.filter((y) => !s.yearLoaded(y, maxAge) && !s.yearLoading(y) && now - (attempts.get(y) || 0) > 15_000)
  if (todo.length) {
    todo.forEach((y) => attempts.set(y, now))
    s.load({ years: todo }).catch((err) => app.ui.view === VIEW && toast(`Touren konnten nicht gelesen werden: ${err.message}`))
  }
  return years.every((y) => s.yearLoaded(y))
}
const loadedYears = (years) => {
  const s = tourStore()
  return !!s && years.every((y) => s.yearLoaded(y))
}

// Stand der Touren: zählt bei jeder Änderung der Ablage hoch (die Touren gehen nicht über den DataService)
let toursVersion = 0

/**
 * Stand des Bestands: { rows (je Mattentyp), totals, cov (reicht der saubere Bestand? null, solange die Touren nicht
 * gelesen sind), sync (Wechsel der Touren, die noch nicht gespeichert sind), loaded, days, below, noTypes }.
 */
export function bestandState(today = todayISO()) {
  const years = bestandYears(today)
  const loaded = loadedYears(years)
  return memo(app.cur, `mwb:${today}:${toursVersion}:${loaded}`, () => {
    const d = doc()
    const tours = loaded ? tourStore().tours() : null
    const ps = placements()
    // Abgleich mit den Touren einmal: der Bestand rechnet mit denselben Buchungen (wie stockRows mit tours)
    const sync = loaded ? tourSync({ bookings: d.bookings, tours, placements: ps }) : null
    const rows = stockRows({ doc: sync ? { ...d, bookings: applySync(d.bookings, sync) } : d, placements: ps, tours: null, articles: articles() })
    const days = daysOf(d)
    const cov = loaded ? coverage({ rows, tours, jobs: app.data.mattenJobs || [], placements: ps, today, days }) : null
    return { today, rows, totals: stockTotals(rows), cov, sync, loaded, days, below: belowMin(rows), base: rows.some((r) => r.base), noTypes: !rows.length }
  })
}

/** Wechsel der Touren speichern (nur mit Bearbeitungsrecht; je Stopp eine Buchung, nie doppelt). Liefert die Anzahl. */
let syncing = false
function syncTours(today = todayISO()) {
  if (!editable() || syncing || !app.data?.[KEY]) return 0
  const s = bestandState(today)
  if (!s.loaded || !syncCount(s.sync)) return 0
  syncing = true
  try {
    const d = doc()
    const n = syncCount(s.sync)
    d.bookings = pruneBookings(applySync(d.bookings, s.sync), today)
    persist()
    return n
  } finally {
    syncing = false
  }
}
const syncLater = () => queueMicrotask(() => {
  if (syncTours()) {
    invalidateTodo()
    if (app.ui.view === VIEW && !app.ui.modal) renderNow()
  }
})

/**
 * Zähler für den digitalen Mitarbeiter (views/disponent.js liest app.mwBe; erst wenn die Touren gelesen sind):
 * { today, sig, short (erster Tag mit zu wenig sauberen Matten), below (unter Mindestbestand), until, days }.
 */
export function publish(today = todayISO()) {
  if (!rights().view || !app.data) return null
  const s = bestandState(today)
  if (!s.loaded) return null
  const short = s.cov?.short || null
  const sig = [short ? `${short.date}:${short.items.map((x) => `${x.articleId}=${x.missing}`).join(',')}` : '', s.below.map((x) => `${x.articleId}=${x.sauber}`).join(',')].join('|')
  if (app.mwBe?.sig === sig && app.mwBe.today === today) return app.mwBe
  app.mwBe = { today, sig, short, below: s.below, until: s.cov?.until || '', days: s.days, at: Date.now() }
  return app.mwBe
}

onToursChanged(() => {
  toursVersion++
  invalidateTodo()
  publish()
  syncLater()
  if (app.ui.view === VIEW && !app.ui.modal) renderNow()
})

// ---------------------------------------------------------------- Texte für Übersicht und Tourenplanung

const itemsText = (items) => items.map((x) => `${x.name}: ${plural(x.missing, 'Matte fehlt', 'Matten fehlen')}`).join(', ')

/** Zeile in der Matten-Übersicht: „Saubere Matten reichen bis …“ bzw. Warnung (views/matten-uebersicht.js). */
export function stockLine(today = todayISO()) {
  if (!rights().view || !app.data) return ''
  ensureTours(bestandYears(today))
  const s = bestandState(today)
  const open = `<button class="btn small" data-action="mwb-goto">Matten-Bestand</button>`
  if (s.noTypes) return ''
  if (!s.base) return `<p class="mwb-line note"><span><strong>Saubere Matten:</strong> noch keine Inventur – die App kennt den Bestand erst nach der ersten Zählung.</span>${open}</p>`
  if (!s.cov) return `<p class="mwb-line note"><span><strong>Saubere Matten:</strong> Touren werden gelesen …</span>${open}</p>`
  const parts = []
  let tone = ''
  if (s.cov.short) {
    tone = 'warn'
    parts.push(`<strong>Zu wenig saubere Matten für die Touren am ${esc(shortDay(s.cov.short.date))}:</strong> ${esc(itemsText(s.cov.short.items))}.`)
  } else parts.push(`<strong>Saubere Matten reichen bis ${esc(shortDay(s.cov.until))}</strong> (geplante Touren und fällige Einsätze der nächsten ${s.days} Tage).`)
  if (s.below.length) {
    tone ||= 'note'
    parts.push(`Mindestbestand unterschritten: ${esc(s.below.map((x) => `${x.name} (${x.sauber} von ${x.min})`).join(', '))}.`)
  }
  return `<p class="mwb-line ${tone === 'warn' ? 'mwb-warn' : 'note'}" ${tone === 'warn' ? 'role="status"' : ''}><span>${parts.join(' ')}</span>${open}</p>`
}

/**
 * Hinweis bei der Freigabe (views/matten-planung.js): übersteigt die Ladeliste bis zum Tag der Tour den sauberen Bestand?
 * Liefert den Text oder '' (sperrt nichts).
 */
export function tourStockHint(tour, today = todayISO()) {
  if (!rights().view || !tour) return ''
  const s = bestandState(today)
  if (!s.base) return ''
  const tours = tourStore()?.tours() || []
  const hint = tourShortage({ tour, rows: s.rows, tours, jobs: app.data.mattenJobs || [], placements: placements(), today })
  if (!hint) return ''
  return `Die Ladeliste übersteigt den sauberen Bestand bis ${shortDay(hint.date)}: ${hint.items.map((x) => `${x.name}: ${x.need} gebraucht, ${x.stock} sauber im Lager`).join('; ')}. Wäscherei-Rücklieferung oder Zukauf einplanen.`
}

// ---------------------------------------------------------------- Ansicht

const LEVEL_CLS = { rot: 'error', gelb: 'warning', gruen: 'ok', grau: '' }
const levelPill = (lv) => `<span class="pill ${LEVEL_CLS[lv]}">${esc(LEVELS[lv])}</span>`

function stockTable(s) {
  const body = s.rows
    .map((r) => {
      const lv = levelOf(r, s.cov)
      const base = r.base ? `Inventur ${esc(day(r.base.date))}` : 'noch keine Inventur'
      return `<tr class="mwb-row lv-${lv}">
        <td data-label="Mattentyp"><span class="mwb-type"><strong>${esc(r.name)}</strong><small class="muted">${base}${r.eigentum ? ` · dazu ${r.eigentum} Kundeneigentum` : ''}</small></span></td>
        <td class="num" data-label="${POOLS.sauber}"><strong>${num(r.sauber)}</strong></td>
        <td class="num" data-label="${POOLS.kunde}">${num(r.kunde)}</td>
        <td class="num" data-label="${POOLS.fahrzeug}">${num(r.fahrzeug)}</td>
        <td class="num" data-label="${POOLS.waesche}">${num(r.waesche)}</td>
        <td class="num" data-label="gesamt"><strong>${num(r.gesamt)}</strong></td>
        <td class="num" data-label="${POOLS.schwund}">${num(r.schwund)}</td>
        <td class="num" data-label="${POOLS.aus}">${num(r.aus)}</td>
        <td data-label="Mindestbestand"><span class="mwb-min">${r.min ? `<span>${r.min}</span>` : '<span class="muted">keiner</span>'} ${levelPill(lv)}</span></td></tr>`
    })
    .join('')
  const t = s.totals
  const total = s.rows.length > 1 ? `<tr class="mwb-sum"><td data-label="">alle Mattentypen</td><td class="num" data-label="${POOLS.sauber}">${num(t.sauber)}</td><td class="num" data-label="${POOLS.kunde}">${num(t.kunde)}</td><td class="num" data-label="${POOLS.fahrzeug}">${num(t.fahrzeug)}</td><td class="num" data-label="${POOLS.waesche}">${num(t.waesche)}</td><td class="num" data-label="gesamt">${num(t.gesamt)}</td><td class="num" data-label="${POOLS.schwund}">${num(t.schwund)}</td><td class="num" data-label="${POOLS.aus}">${num(t.aus)}</td><td data-label=""></td></tr>` : ''
  return `<div class="table-wrap"><table class="data mwb-table"><thead><tr><th>Mattentyp</th><th class="num">Lager sauber</th><th class="num">beim Kunden</th><th class="num">im Fahrzeug</th><th class="num">Wäscherei</th><th class="num">gesamt</th><th class="num">Schwund</th><th class="num">ausgeschieden</th><th>Mindestbestand</th></tr></thead><tbody>${body}${total}</tbody></table></div>`
}

function coverBlock(s) {
  if (!s.base) return ''
  if (!s.cov) return '<p class="note">Touren werden gelesen … danach steht hier, ob die sauberen Matten für die geplanten Touren reichen.</p>'
  const c = s.cov
  const rows = c.types
    .map((t) => `<tr><td data-label="Mattentyp">${esc(t.name)}</td><td class="num" data-label="sauber im Lager">${num(t.stock)}</td><td class="num" data-label="gebraucht">${num(t.need)}</td><td class="num" data-label="danach übrig">${num(t.left)}</td><td data-label="reicht">${t.short ? `<span class="pill error">fehlt ab ${esc(shortDay(t.short.date))}</span>` : '<span class="pill ok">reicht</span>'}</td></tr>`)
    .join('')
  const unknown = c.unknown.length ? `<p class="note">Ohne Inventur, aber gebraucht: ${esc(c.unknown.map((x) => `${x.name} (${x.need})`).join(', '))}.</p>` : ''
  const head = c.short
    ? `<p class="mwb-warn" role="status"><strong>Zu wenig saubere Matten für die Touren am ${esc(shortDay(c.short.date))}:</strong> ${esc(itemsText(c.short.items))}. Wäscherei-Rücklieferung oder Zukauf einplanen.</p>`
    : `<p><strong>Saubere Matten reichen bis ${esc(shortDay(c.until))}</strong></p>`
  return `<section class="mwb-panel" aria-label="Vorschau"><h3>Reicht der saubere Bestand? Nächste ${c.days} Tage (bis ${esc(shortDay(c.to))})</h3>${head}
    ${rows ? `<div class="table-wrap"><table class="data mwb-cover"><thead><tr><th>Mattentyp</th><th class="num">sauber im Lager</th><th class="num">gebraucht</th><th class="num">danach übrig</th><th>reicht</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">In diesen Tagen ist kein Wechsel geplant.</p>'}
    ${unknown}<p class="note">Gebraucht: Ladelisten der Entwürfe und freigegebenen Touren (unterwegs nur die offenen Stopps) und fällige Einsätze ohne Tour, nur eigene Matten. Rücklieferungen der Wäscherei zählen erst, wenn sie gebucht sind.</p></section>`
}

function historyBlock() {
  const d = doc()
  const filter = app.ui.mwbHist || ''
  const all = historyOf(d.bookings, { articleId: filter, limit: 100000 })
  const shown = app.ui.mwbAll ? all : all.slice(0, 30)
  const types = new Map()
  for (const b of d.bookings) for (const l of b.lines || []) if (l.articleId && !types.has(l.articleId)) types.set(l.articleId, l.name || 'Matte')
  const rows = shown
    .map((b) => {
      const off = b.cancelled ? ' mwb-off' : ''
      return `<tr class="mwb-hist${off}"><td class="mwb-when" data-label="Tag"><span class="mwb-cell"><strong>${esc(day(b.date))}</strong><br><span class="muted">${esc(atText(b.at))}</span></span></td>
        <td data-label="Buchung"><span class="mwb-cell">${esc(describe(b))}${b.text ? `<br><span class="muted">${esc(b.text)}</span>` : ''}${b.cancelled ? `<br><span class="pill">storniert</span> <span class="muted">${esc(b.cancelled.reason || '')}</span>` : ''}${(b.sent || []).length ? ' <span class="pill ok">an Wäscherei gesendet</span>' : ''}</span></td>
        <td data-label="wer">${esc(b.by || '–')}</td>
        <td data-label="Grund">${esc(b.note || '')}</td>
        <td class="actions-cell" data-label=""><button class="btn small" data-action="mwb-booking-open" data-id="${esc(b.id)}">Ansehen</button></td></tr>`
    })
    .join('')
  return `<section class="mwb-panel mwb-history" aria-label="Verlauf der Buchungen"><header><h3>Verlauf der Buchungen</h3>
      ${types.size > 1 ? `<label class="field inline"><span>Mattentyp</span><select id="mwb-hist" data-change="mwb-hist">${options([...types.entries()], filter, { empty: 'alle' })}</select></label>` : ''}</header>
    ${rows ? `<div class="table-wrap"><table class="data mwb-hist-table"><thead><tr><th>Tag</th><th>Buchung</th><th>wer</th><th>Grund</th><th><span class="visually-hidden">Aktionen</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Buchung.</p>'}
    ${all.length > shown.length ? `<p><button class="btn small" data-action="mwb-all">Alle ${all.length} anzeigen</button></p>` : ''}</section>`
}

function bestandView() {
  const today = todayISO()
  ensureTours(bestandYears(today))
  const s = bestandState(today)
  publish(today)
  const ed = editable()
  if (ed && s.loaded && syncCount(s.sync)) syncLater()
  const laundry = laundryOf(doc())
  const head = `<div class="section-head"><div><h2>Matten-Bestand</h2><p>Wie viele eigene Matten je Mattentyp sauber im Lager, beim Kunden, im Fahrzeug und in der Wäscherei sind, und ob die sauberen für die geplanten Touren reichen. Die Wechsel der abgeschlossenen Touren bucht die App selbst; Wäscherei, Zukauf und Ausscheiden bucht das Büro.</p></div>
    <div class="actions">${ed ? `<button class="btn" data-action="mwb-inventory-open">${ICON.check} Inventur</button><button class="btn primary" data-action="mwb-book-open" data-mode="abholung">Wäscherei abholen</button><button class="btn" data-action="mwb-book-open" data-mode="rueckgabe">Wäscherei zurück</button><button class="btn" data-action="mwb-book-open" data-mode="manual">Zukauf/Ausscheiden</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        ed && { label: 'Einstellungen', icon: ICON.gear, action: 'mwb-settings-open', hint: laundry.name ? `Wäscherei: ${laundry.name}` : 'Mindestbestand, Wäscherei' },
        { label: 'Neu laden', icon: ICON.refresh, action: 'mwb-reload', hint: 'Touren aus der Ablage' },
        { label: 'Matten-Übersicht', icon: ICON.list, action: 'view', data: { view: 'mw-uebersicht' }, hint: 'der Mattenwechsel auf einen Blick' },
        ed && { label: 'Matten-Tourenplanung', icon: ICON.list, action: 'mw-tp-goto', data: { date: today }, hint: 'Ladelisten je Tour' },
      ],
    })}</div></div>`
  if (s.noTypes)
    return `${head}<div class="banner warn-banner"><p><strong>Noch keine Mattentypen.</strong> Der Bestand zählt je Mattentyp (Artikel der Fakturierung mit der Gruppe „Matten“). ${sees('fakturierung') ? 'In der Fakturierung unter „Stammdaten → Matten“ anlegen.' : 'Sie legt an, wer die Fakturierung bearbeitet; danach stehen sie an den Liegeplätzen.'}</p>${sees('fakturierung') ? '<button class="btn" data-action="mw-types-goto">Mattentypen in der Fakturierung</button>' : ''}</div>`
  const untyped = placements().filter((p) => p.active !== false).reduce((n, p) => n + (p.mats || []).filter((m) => !m.articleId && m.owner !== 'kunde').reduce((a, m) => a + (Number(m.qty) || 0), 0), 0)
  const banners = [
    !s.base ? `<div class="banner welcome"><p><strong>Noch keine Inventur.</strong> Einmal zählen, wie viele Matten je Typ sauber im Lager, im Fahrzeug und in der Wäscherei sind – ab dann rechnet die App mit den Touren und Buchungen weiter. Beim Kunden zählt sie selbst aus den Liegeplätzen.</p>${ed ? `<button class="btn" data-action="mwb-inventory-open">${ICON.check} Inventur</button>` : ''}</div>` : '',
    !ed ? '<p class="note">Nur lesen: buchen und zählen darf, wer den Mattenwechsel bearbeitet.</p>' : '',
    s.loaded && syncCount(s.sync) ? `<p class="note">${plural(syncCount(s.sync), 'Wechsel aus den Touren ist', 'Wechsel aus den Touren sind')} schon mitgerechnet${ed ? ' und wird gerade gespeichert' : '; gespeichert wird, sobald das Büro den Bestand öffnet'}.</p>` : '',
    untyped ? `<p class="note">${plural(untyped, 'eigene Matte', 'eigene Matten')} an Liegeplätzen ohne Mattentyp (aus dem Werkzeug) zählen nicht. In „Matten-Liegeplätze“ den Mattentyp wählen.</p>` : '',
  ].join('')
  return `${head}${banners}${stockTable(s)}
    <p class="note">Lager sauber: im Lager bereit; beim Kunden: eigene Matten an den aktiven Liegeplätzen (Kundeneigentum wird gewaschen, aber nicht gezählt); im Fahrzeug: schmutzig von den Touren zurück, wartet auf die Wäscherei; gesamt: alles im Umlauf. Schwund und ausgeschieden seit der Inventur.</p>
    <div class="mwb-grid">${coverBlock(s)}${historyBlock()}</div>`
}

registerView({
  id: 'mw-bestand',
  order: 75.67,
  label: 'Matten-Bestand',
  group: 'service',
  module: MODULE,
  icon: ICON_BE,
  noWeek: true,
  text: 'Mattenwechsel: Mattenbestand je Typ (Lager sauber, beim Kunden, Fahrzeug, Wäscherei), Inventur, Wäscherei',
  badge: () => {
    const b = app.mwBe
    return b && b.today === todayISO() ? (b.short ? 1 : 0) + b.below.length : 0
  },
  render: bestandView,
})

// ---------------------------------------------------------------- Dialog: Inventur

function inventoryModal() {
  const m = app.ui.modal
  const s = bestandState()
  m.date ||= todayISO()
  const v = (id, p) => m.values?.[`${id}|${p}`] ?? ''
  const body = s.rows
    .map((r) => {
      const app0 = r.base ? COUNTED.map((p) => `${POOLS[p]} ${num(r[p])}`).join(' · ') : 'noch nicht gezählt'
      const inputs = COUNTED.map((p) => `<td data-label="${POOLS[p]}"><input type="text" inputmode="numeric" class="mwb-qty" id="mwb-inv-${esc(r.articleId)}-${p}" value="${esc(v(r.articleId, p))}" aria-label="${esc(`${POOLS[p]} ${r.name}`)}"></td>`).join('')
      return `<tr><td data-label="Mattentyp"><span class="mwb-type"><strong>${esc(r.name)}</strong><small class="muted">laut App: ${esc(app0)}</small></span></td>${inputs}</tr>`
    })
    .join('')
  return modalFrame({
    title: 'Inventur',
    subtitle: 'gezählte Matten je Mattentyp',
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Stichtag</span><input type="date" id="mwb-inv-date" value="${esc(m.date)}" max="${todayISO()}"></label></div>
      <p class="note">Gezählt werden Lager sauber, im Fahrzeug (schmutzig, wartet auf die Wäscherei) und in der Wäscherei; beim Kunden rechnet die App aus den Liegeplätzen. Vorbelegt ist der Stand laut App – nur ändern, was anders ist. Ein Mattentyp ganz ohne Eingabe bleibt, wie er ist; leere Felder eines gezählten Typs gelten als 0. Die Inventur gilt für das Ende des Stichtags (heute: ab jetzt).</p>
      <div class="table-wrap"><table class="data mwb-inv"><thead><tr><th>Mattentyp</th><th>Lager sauber</th><th>im Fahrzeug</th><th>Wäscherei</th></tr></thead><tbody>${body}</tbody></table></div>
      <label class="field wide"><span>Bemerkung</span><input type="text" id="mwb-inv-note" value="${esc(m.note || '')}" placeholder="z. B. Jahresinventur"></label>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mwb-inventory-save">Inventur speichern</button></div>`,
  })
}
registerModal('mwb-inventory', inventoryModal, { module: MODULE })

function saveInventory() {
  const s = bestandState()
  const date = val('mwb-inv-date') || todayISO()
  const lines = []
  for (const r of s.rows) {
    const raw = Object.fromEntries(COUNTED.map((p) => [p, val(`mwb-inv-${r.articleId}-${p}`)]))
    if (COUNTED.every((p) => !String(raw[p]).trim())) continue
    const line = { articleId: r.articleId, name: r.name, before: r.base ? Object.fromEntries(COUNTED.map((p) => [p, r[p]])) : null }
    for (const p of COUNTED) {
      const n = parseCount(raw[p])
      if (Number.isNaN(n)) return toast(`${r.name}, ${POOLS[p]}: bitte eine ganze Stückzahl eintragen.`)
      line[p] = n ?? 0
    }
    lines.push(line)
  }
  const b = newBooking('inventur', { date, note: val('mwb-inv-note'), lines }, { newId: () => uid('mwb'), now: nowIso(), by: user() })
  const problem = bookingProblem(b, { today: todayISO() })
  if (problem) return toast(problem)
  doc().bookings.push(b)
  persist()
  closeModal()
  invalidateTodo()
  renderNow()
  const diff = b.lines.filter((l) => l.before && COUNTED.some((p) => l[p] !== l.before[p]))
  toast(`Inventur gespeichert (${plural(b.lines.length, 'Mattentyp', 'Mattentypen')}).${diff.length ? ` Abweichung zum Stand laut App bei ${diff.map((l) => l.name).join(', ')}.` : ''}`)
}

// ---------------------------------------------------------------- Dialog: Wäscherei abholen, Wäscherei zurück, Zukauf/Ausscheiden

const BOOK_TITLE = { abholung: 'Wäscherei abholen', rueckgabe: 'Wäscherei zurück', manual: 'Zukauf, Ausscheiden, Korrektur' }
const FIELDS = { abholung: [['qty', 'Stück']], rueckgabe: [['qty', 'zurück sauber'], ['lost', 'Schwund'], ['retired', 'ausgeschieden']] }

function bookModal() {
  const m = app.ui.modal
  const s = bestandState()
  const kind = m.mode === 'manual' ? (MANUAL_KINDS.includes(m.kind) ? m.kind : 'zukauf') : m.mode
  m.date ||= todayISO()
  const fields = FIELDS[kind] || [['qty', kind === 'korrektur' ? '± Stück' : 'Stück']]
  const v = (id, f) => m.values?.[`${id}|${f}`] ?? ''
  const hint = (r) => (!r.base ? 'noch keine Inventur' : kind === 'abholung' ? `im Fahrzeug: ${num(r.fahrzeug)}` : kind === 'rueckgabe' ? `in der Wäscherei: ${num(r.waesche)}` : kind === 'korrektur' ? `${POOLS[m.pool || 'sauber']}: ${num(r[m.pool || 'sauber'])}` : kind === 'zukauf' ? `Lager sauber: ${num(r.sauber)}` : `${POOLS[m.from || 'sauber']}: ${num(r[m.from || 'sauber'])}`)
  const body = s.rows
    .map((r) => `<tr><td data-label="Mattentyp"><span class="mwb-type"><strong>${esc(r.name)}</strong><small class="muted">${esc(hint(r))}</small></span></td>${fields.map(([f, label]) => `<td data-label="${esc(label)}"><input type="text" inputmode="${kind === 'korrektur' ? 'text' : 'numeric'}" class="mwb-qty" id="mwb-b-${esc(r.articleId)}-${f}" data-id="${esc(r.articleId)}" data-f="${f}" value="${esc(v(r.articleId, f))}" aria-label="${esc(`${label} ${r.name}`)}"></td>`).join('')}</tr>`)
    .join('')
  const laundry = laundryOf(doc())
  const extra =
    m.mode === 'manual'
      ? `<label class="field"><span>Art</span><select id="mwb-b-kind" data-change="mwb-book-kind">${options(MANUAL_KINDS.map((k) => [k, KINDS[k] === 'Ausgeschieden' ? 'Ausscheiden (kaputt, abgenutzt)' : KINDS[k] === 'Schwund' ? 'Schwund (verloren)' : KINDS[k]]), kind)}</select></label>
        ${kind === 'ausscheiden' || kind === 'schwund' ? `<label class="field"><span>aus</span><select id="mwb-b-from" data-change="mwb-book-kind">${options(FROM_POOLS.map((p) => [p, POOLS[p]]), m.from || 'sauber')}</select></label>` : ''}
        ${kind === 'korrektur' ? `<label class="field"><span>Ort</span><select id="mwb-b-pool" data-change="mwb-book-kind">${options(CORRECT_POOLS.map((p) => [p, POOLS[p]]), m.pool || 'sauber')}</select></label>` : ''}`
      : kind === 'abholung'
        ? `<label class="field"><span>Lieferschein-Nr.</span><input type="text" id="mwb-b-no" value="${esc(m.no || nextSlipNo(doc().bookings, (m.date || todayISO()).slice(0, 4)))}"></label>`
        : ''
  const notes = {
    abholung: `Die Wäscherei holt schmutzige Matten ab (aus „im Fahrzeug“). Vorbelegt ist, was im Fahrzeug wartet. Danach gibt es den Lieferschein für die Wäscherei als PDF${laundry.email ? ` und „An die Wäscherei senden“ (${esc(laundry.email)})` : ''}.`,
    rueckgabe: 'Saubere Matten kommen ins Lager. Was die Wäscherei nicht zurückbringt, als Schwund (verloren) oder ausgeschieden (kaputt) eintragen – beides zählt nicht mehr zum Bestand.',
    zukauf: 'Neue Matten kommen sauber ins Lager.',
    ausscheiden: 'Kaputte oder abgenutzte Matten scheiden aus dem Bestand aus. Grund bitte angeben.',
    schwund: 'Verlorene Matten (z. B. beim Kunden verschwunden) zählen als Schwund. Grund bitte angeben.',
    korrektur: 'Korrektur eines Orts um ± Stück (z. B. „−2“), etwa nach einem Zählfehler. Grund bitte angeben. Für einen ganz neuen Stand besser die Inventur.',
  }
  return modalFrame({
    title: BOOK_TITLE[m.mode] || 'Buchen',
    subtitle: m.mode === 'manual' ? esc(KINDS[kind]) : '',
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="mwb-b-date" value="${esc(m.date)}" max="${todayISO()}"></label>${extra}</div>
      <p class="note">${notes[kind]}</p>
      <div class="table-wrap"><table class="data mwb-book"><thead><tr><th>Mattentyp</th>${fields.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
      <label class="field wide"><span>${NOTE_REQUIRED.includes(kind) ? 'Grund (Pflicht)' : 'Bemerkung'}</span><input type="text" id="mwb-b-note" value="${esc(m.note || '')}" placeholder="${kind === 'zukauf' ? 'z. B. Lieferant, Rechnung' : kind === 'rueckgabe' ? 'z. B. Lieferschein der Wäscherei' : ''}"></label>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mwb-book-save">${kind === 'abholung' ? 'Abholung buchen' : kind === 'rueckgabe' ? 'Rücklieferung buchen' : 'Buchen'}</button></div>`,
  })
}
registerModal('mwb-book', bookModal, { module: MODULE })

/** Eingaben im Dialog in den Zustand übernehmen (vor dem Neuzeichnen und beim Speichern). */
function readBook() {
  const m = app.ui.modal
  if (!m || !document.getElementById('mwb-b-date')) return m
  m.date = val('mwb-b-date') || todayISO()
  m.note = val('mwb-b-note').trim()
  if (document.getElementById('mwb-b-kind')) m.kind = val('mwb-b-kind')
  if (document.getElementById('mwb-b-from')) m.from = val('mwb-b-from')
  if (document.getElementById('mwb-b-pool')) m.pool = val('mwb-b-pool')
  if (document.getElementById('mwb-b-no')) m.no = val('mwb-b-no').trim()
  m.values = {}
  for (const el of document.querySelectorAll('#modal-root input.mwb-qty[data-f]')) m.values[`${el.dataset.id}|${el.dataset.f}`] = el.value
  return m
}

function saveBook() {
  const m = readBook()
  const s = bestandState()
  const kind = m.mode === 'manual' ? (MANUAL_KINDS.includes(m.kind) ? m.kind : 'zukauf') : m.mode
  const fields = (FIELDS[kind] || [['qty']]).map(([f]) => f)
  const lines = []
  for (const r of s.rows) {
    const line = { articleId: r.articleId, name: r.name }
    for (const f of fields) {
      const n = parseCount(m.values?.[`${r.articleId}|${f}`], { signed: kind === 'korrektur' })
      if (Number.isNaN(n)) return toast(`${r.name}: bitte ganze Stückzahlen eintragen${kind === 'korrektur' ? ' (mit Minus für weniger)' : ''}.`)
      line[f] = n ?? 0
    }
    lines.push(line)
  }
  const b = newBooking(kind, { date: m.date, note: m.note, lines, from: m.from, pool: m.pool, no: kind === 'abholung' ? m.no || nextSlipNo(doc().bookings, m.date.slice(0, 4)) : '' }, { newId: () => uid('mwb'), now: nowIso(), by: user() })
  const problem = bookingProblem(b, { today: todayISO() })
  if (problem) return toast(problem)
  doc().bookings.push(b)
  persist()
  invalidateTodo()
  // unter null? Hinweis (gebucht wird trotzdem: oft fehlt nur eine Buchung davor)
  const after = bestandState().rows
  const neg = after.filter((r) => r.base && b.lines.some((l) => l.articleId === r.articleId) && COUNTED.some((p) => r[p] < 0))
  const msg = `${KINDS[b.kind]} gebucht${b.no ? ` (${b.no})` : ''}.${neg.length ? ` Achtung: ${neg.map((r) => r.name).join(', ')} jetzt unter null – Inventur prüfen.` : ''}`
  if (b.kind === 'abholung') {
    // gleich mit Lieferschein (PDF) und „An die Wäscherei senden“ – gesendet wird erst nach Klick
    openModal({ type: 'mwb-booking', id: b.id })
    renderNow()
    return toast(msg)
  }
  closeModal()
  renderNow()
  toast(msg)
}

// ---------------------------------------------------------------- Dialog: eine Buchung (Lieferschein, Versand, Storno)

function bookingModal() {
  const m = app.ui.modal
  const b = doc().bookings.find((x) => x.id === m.id)
  if (!b) return modalFrame({ title: 'Buchung', body: '<p>Diese Buchung gibt es nicht mehr.</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const ed = editable()
  const laundry = laundryOf(doc())
  const lines = (b.lines || [])
    .map((l) => {
      const q = b.kind === 'inventur' ? COUNTED.map((p) => `${POOLS[p]} ${num(l[p])}${l.before && l.before[p] !== l[p] ? ` (laut App ${num(l.before[p])})` : ''}`).join(', ') : b.kind === 'rueckgabe' ? [`${l.qty} zurück sauber`, l.lost ? `${l.lost} Schwund` : '', l.retired ? `${l.retired} ausgeschieden` : ''].filter(Boolean).join(', ') : b.kind === 'tour' ? `${l.qty} sauber zum Kunden, ${l.back} schmutzig zurück${l.back ? '' : ' (Erstausstattung)'}` : num(l.qty)
      return `<tr><td data-label="Mattentyp">${esc(l.name)}</td><td data-label="Menge">${esc(q)}</td></tr>`
    })
    .join('')
  const sent = (b.sent || []).map((x) => `<li>${esc(atText(x.at))}: ${x.via === 'mailto' ? 'E-Mail-Programm, ' : ''}an ${esc(x.to || '–')}${x.by ? `, ${esc(x.by)}` : ''}</li>`).join('')
  const cancel = m.cancel
    ? `<label class="field wide"><span>Grund für das Stornieren (Pflicht)</span><input type="text" id="mwb-cancel-reason" value=""></label>`
    : ''
  const where = b.kind === 'ausscheiden' || b.kind === 'schwund' ? `aus ${POOLS[b.from] || POOLS.sauber}` : b.kind === 'korrektur' ? `Ort: ${POOLS[b.pool] || POOLS.sauber}` : ''
  const body = `<p><strong>${esc(KINDS[b.kind] || b.kind)}${b.no ? ` ${esc(b.no)}` : ''}</strong> am ${esc(day(b.date))}${where ? ` · ${esc(where)}` : ''}<br><span class="muted">erfasst ${esc(atText(b.at))}${b.by ? ` von ${esc(b.by)}` : ''}</span></p>
    ${b.text ? `<p>${esc(b.text)}</p>` : ''}
    ${b.note ? `<p><strong>${NOTE_REQUIRED.includes(b.kind) ? 'Grund' : 'Bemerkung'}:</strong> ${esc(b.note)}</p>` : ''}
    <div class="table-wrap"><table class="data mwb-lines"><thead><tr><th>Mattentyp</th><th>Menge</th></tr></thead><tbody>${lines}</tbody></table></div>
    ${b.cancelled ? `<p class="mwb-warn"><strong>Storniert</strong> am ${esc(atText(b.cancelled.at))}${b.cancelled.by ? ` von ${esc(b.cancelled.by)}` : ''}: ${esc(b.cancelled.reason || '')}. Die Buchung zählt nicht mehr.</p>` : ''}
    ${b.kind === 'tour' ? '<p class="note">Aus der Tour gebucht: ändert sich mit dem Stopp (Korrektur im Büro in „Matten-Touren“).</p>' : ''}
    ${b.kind === 'abholung' && !laundry.email ? `<p class="note">Für „An die Wäscherei senden“ fehlt noch ihre E-Mail-Adresse${ed ? ' („Mehr“ → „Einstellungen“)' : ''}.</p>` : ''}
    ${sent ? `<h3>An die Wäscherei gesendet</h3><ul>${sent}</ul>` : ''}${cancel}`
  const buttons = [
    b.kind === 'abholung' && `<button class="btn" data-action="mwb-pdf" data-id="${esc(b.id)}">${ICON.download} Lieferschein (PDF)</button>`,
    b.kind === 'abholung' && ed && !b.cancelled && `<button class="btn primary" data-action="mwb-send" data-id="${esc(b.id)}">${ICON.send} ${(b.sent || []).length ? 'Erneut an die Wäscherei senden' : 'An die Wäscherei senden'}</button>`,
    ed && !cancelProblem(b) && (m.cancel ? `<button class="btn danger" data-action="mwb-cancel" data-id="${esc(b.id)}">Wirklich stornieren</button>` : `<button class="btn ghost" data-action="mwb-cancel-ask" data-id="${esc(b.id)}">Stornieren</button>`),
  ].filter(Boolean)
  return modalFrame({ title: `${KINDS[b.kind] || 'Buchung'}${b.no ? ` ${b.no}` : ''}`, subtitle: esc(day(b.date)), wide: true, body, foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${buttons.join('')}</div>` })
}
registerModal('mwb-booking', bookingModal, { module: MODULE })

/** Lieferschein der Wäscherei als PDF (ohne Preise). */
async function slipPdf(b) {
  return pdfBlob(laundryDocument({ booking: b, laundry: laundryOf(doc()), brand: app.config?.brand || {}, logo: await loadLogo().catch(() => null) }))
}

async function sendSlip(id) {
  const b = doc().bookings.find((x) => x.id === id)
  if (!b || b.kind !== 'abholung') return
  const laundry = laundryOf(doc())
  let blob
  try {
    blob = await slipPdf(b)
  } catch (err) {
    return toast(`PDF nicht erstellt: ${err.message}`)
  }
  const m = laundryMail({ booking: b, laundry, sender: user(), company: app.config?.brand?.name || '', formatDate: (d) => day(d) })
  openCompose({
    to: laundry.email,
    subject: m.subject,
    text: m.text,
    files: [{ name: laundryPdfName(b), blob, type: 'application/pdf' }],
    origin: `Wäscherei-Lieferschein ${b.no || ''}`,
    onSent: ({ via, to }) => {
      const x = doc().bookings.find((y) => y.id === id)
      if (!x) return
      x.sent = [...(x.sent || []), { at: nowIso(), to: [].concat(to || []).join('; '), via, by: user() }]
      persist()
      renderNow()
    },
  })
}

// ---------------------------------------------------------------- Dialog: Einstellungen

function settingsModal() {
  const d = doc()
  const s = bestandState()
  const l = laundryOf(d)
  const mins = s.rows.map((r) => `<tr><td data-label="Mattentyp">${esc(r.name)}</td><td data-label="Mindestbestand"><input type="text" inputmode="numeric" class="mwb-qty" id="mwb-min-${esc(r.articleId)}" value="${r.min || ''}" aria-label="${esc(`Mindestbestand ${r.name}`)}"></td><td class="num" data-label="Lager sauber">${num(r.sauber)}</td></tr>`).join('')
  return modalFrame({
    title: 'Matten-Bestand: Einstellungen',
    wide: true,
    body: `<h3>Wäscherei</h3><div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="mwb-l-name" value="${esc(l.name)}" placeholder="z. B. Wäscherei Muster"></label>
        <label class="field"><span>E-Mail (Lieferschein)</span><input type="email" id="mwb-l-email" value="${esc(l.email)}" placeholder="annahme@waescherei.at" autocomplete="email" inputmode="email"></label>
        <label class="field"><span>Ansprechperson</span><input type="text" id="mwb-l-contact" value="${esc(l.contact)}"></label>
        <label class="field"><span>Vorschau „reicht der Bestand?“ (Tage)</span><input type="text" inputmode="numeric" id="mwb-days" value="${daysOf(d)}"></label></div>
      <h3>Mindestbestand Lager sauber</h3>
      <p class="note">Fällt der saubere Bestand eines Mattentyps darunter, meldet die App „Mindestbestand unterschritten“ (Zu erledigen, digitaler Mitarbeiter). Leer = kein Mindestbestand.</p>
      ${mins ? `<div class="table-wrap"><table class="data mwb-mins"><thead><tr><th>Mattentyp</th><th>Mindestbestand</th><th class="num">jetzt sauber</th></tr></thead><tbody>${mins}</tbody></table></div>` : '<p class="muted">Noch keine Mattentypen.</p>'}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mwb-settings-save">Speichern</button></div>`,
  })
}
registerModal('mwb-settings', settingsModal, { module: MODULE })

function saveSettings() {
  const d = doc()
  const s = bestandState()
  const laundry = { name: val('mwb-l-name').trim(), email: val('mwb-l-email').trim(), contact: val('mwb-l-contact').trim() }
  const min = {}
  for (const r of s.rows) {
    const n = parseCount(val(`mwb-min-${r.articleId}`))
    if (Number.isNaN(n)) return toast(`${r.name}: Mindestbestand als ganze Zahl eintragen.`)
    if (n) min[r.articleId] = n
  }
  const days = parseCount(val('mwb-days'))
  const problem = settingsProblem({ laundry, min, days: days ?? undefined })
  if (problem || Number.isNaN(days)) return toast(problem || 'Vorschau: 1 bis 31 Tage.')
  d.settings = { ...d.settings, laundry, min, days: days || 7 }
  persist()
  closeModal()
  invalidateTodo()
  renderNow()
  toast('Einstellungen gespeichert.')
}

// ---------------------------------------------------------------- „Zu erledigen“ (nur wer den Mattenwechsel bearbeitet, nur „Öffnen“)

registerTodo({
  id: 'matten-bestand',
  module: MODULE,
  title: 'Matten-Bestand',
  compute: (today) => {
    if (!rights().edit || !app.data?.[KEY]) return []
    ensureTours(bestandYears(today))
    const b = publish(today)
    if (!b) return []
    const out = []
    if (b.short) out.push({ id: `knapp:${b.short.date}:${b.short.items.map((x) => `${x.articleId}=${x.missing}`).join(',')}`, kind: 'knapp', short: b.short })
    if (b.below.length) out.push({ id: `min:${b.below.map((x) => `${x.articleId}=${x.sauber}`).join(',')}`, kind: 'min', below: b.below })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'knapp'
          ? `<div class="todo-item"><span class="flag error">${x.short.items.reduce((n, i) => n + i.missing, 0)}</span><div class="todo-text"><strong>Zu wenig saubere Matten für die Touren am ${esc(shortDay(x.short.date))}</strong><br><span class="muted">${esc(itemsText(x.short.items))}. Wäscherei-Rücklieferung oder Zukauf einplanen.</span></div><button class="btn small primary" data-action="mwb-goto">Öffnen</button></div>`
          : `<div class="todo-item"><span class="flag warning">${x.below.length}</span><div class="todo-text"><strong>Mindestbestand unterschritten</strong><br><span class="muted">${esc(x.below.map((i) => `${i.name}: ${i.sauber} sauber, Mindestbestand ${i.min}`).join('; '))}</span></div><button class="btn small primary" data-action="mwb-goto">Öffnen</button></div>`,
      )
      .join(''),
})

// ---------------------------------------------------------------- Kennzahlen (views/kpi.js zeichnet, hier wird gerechnet)

kpiHooks.mattenBestand = ({ months }) => {
  if (!rights().view || !months?.length || !app.data?.[KEY]) return null
  const rows = laundryMonths(doc().bookings, months)
  return rows.some((x) => x.abgeholt || x.zurueck || x.schwund || x.aus) ? { months: rows } : null
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  // aus der Übersicht, „Zu erledigen“ und dem digitalen Mitarbeiter
  'mwb-goto': () => {
    if (app.ui.modal) closeModal()
    app.ui.view = VIEW
    renderNow()
  },
  'mwb-reload': async () => {
    const s = tourStore()
    if (!s) return
    attempts.clear()
    await s.load({ years: bestandYears() }).catch((err) => toast(`Touren konnten nicht gelesen werden: ${err.message}`))
    renderNow()
  },
  'mwb-hist': (el) => {
    app.ui.mwbHist = el.value || ''
    app.ui.mwbAll = false
    renderNow()
  },
  'mwb-all': () => {
    app.ui.mwbAll = true
    renderNow()
  },
  'mwb-booking-open': (el) => openModal({ type: 'mwb-booking', id: el.dataset.id }),
  'mwb-pdf': async (el) => {
    const b = doc().bookings.find((x) => x.id === el.dataset.id)
    if (!b) return
    try {
      download(laundryPdfName(b), await slipPdf(b))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    }
  },
})

registerActions(
  {
    'mwb-inventory-open': () => {
      // vorbelegt mit dem Stand laut App (Typen mit Inventur); ohne Inventur leer
      const s = bestandState()
      const values = {}
      for (const r of s.rows) if (r.base) for (const p of COUNTED) values[`${r.articleId}|${p}`] = String(Math.max(0, r[p]))
      openModal({ type: 'mwb-inventory', date: todayISO(), values })
    },
    'mwb-inventory-save': () => saveInventory(),
    'mwb-book-open': (el) => {
      const mode = ['abholung', 'rueckgabe', 'manual'].includes(el.dataset.mode) ? el.dataset.mode : 'manual'
      const values = {}
      // Abholung: vorbelegt mit dem, was im Fahrzeug wartet
      if (mode === 'abholung') for (const r of bestandState().rows) if (r.base && r.fahrzeug > 0) values[`${r.articleId}|qty`] = String(r.fahrzeug)
      openModal({ type: 'mwb-book', mode, kind: el.dataset.kind || 'zukauf', date: todayISO(), values })
    },
    'mwb-book-kind': () => {
      readBook()
      renderModal()
    },
    'mwb-book-save': () => saveBook(),
    'mwb-send': (el) => sendSlip(el.dataset.id),
    'mwb-cancel-ask': () => {
      app.ui.modal.cancel = true
      renderModal()
      document.getElementById('mwb-cancel-reason')?.focus()
    },
    'mwb-cancel': (el) => {
      const d = doc()
      const i = d.bookings.findIndex((x) => x.id === el.dataset.id)
      const problem = cancelProblem(d.bookings[i])
      if (problem) return toast(problem)
      const reason = val('mwb-cancel-reason').trim()
      if (!reason) return toast('Bitte den Grund für das Stornieren angeben.')
      d.bookings[i] = cancelBooking(d.bookings[i], { reason, now: nowIso(), by: user() })
      persist()
      app.ui.modal.cancel = false
      invalidateTodo()
      renderModal()
      renderNow()
      toast('Buchung storniert: sie zählt nicht mehr, bleibt aber im Verlauf.')
    },
    'mwb-settings-open': () => openModal({ type: 'mwb-settings' }),
    'mwb-settings-save': () => saveSettings(),
  },
  { edit: MODULE },
)
