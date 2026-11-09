// Mattenwechsel-Modul, Büro-Übersicht (docs/MATTENWECHSEL-PLAN.md P15, Konzept Abschnitt 10 „Büro-Dashboard“): Ansicht
// „Matten-Übersicht“ (mw-uebersicht, erster Reiter des Moduls; wer den Mattenwechsel sieht – Fahrer nicht). Neun Kacheln
// (heute fällig, geplante Touren, Touren in Durchführung, abgeschlossene Touren, überfällig, nicht durchgeführt, nicht
// versendete Lieferscheine, fehlerhafte SharePoint-Übertragungen, offene Rechnungsentwürfe), jede öffnet die passende
// Ansicht bzw. den passenden Filter; daneben „Heute“ (Touren des Tages mit Fahrer und Fortschritt, Ladeliste) und die
// Woche (fällig, geplant, erledigt je Tag). Zahlen der Fakturierung nur mit deren Leserecht.
// Dazu: der Stand für Kalender und „Zu erledigen“ (mattenState: Einsätze mit den Ergebnissen der Touren), die Karte auf
// der Startseite, die Kennzahlen (kpiHooks.matten) und die Zähler für den digitalen Mitarbeiter (app.mwUe). Unter den
// Kacheln (keine zehnte Kachel) die Zeile „Saubere Matten reichen bis …“ bzw. die Warnung aus dem Matten-Bestand (P17,
// views/matten-bestand.js).
// Rechenkern: core/matten-uebersicht.js (ruft nur die vorhandenen Rechenkerne auf). Aktionen und Klassen „mwu-“.

import { addDays, formatDate, isoWeekday, todayISO, WEEKDAY_LONG } from '../../core/dates.js'
import { mergeJobs } from '../../core/matten-einsaetze.js'
import { emptyMatten, upgradeMatten } from '../../core/matten.js'
import { loadLabel, tourYears } from '../../core/matten-touren.js'
import { mattenInvoices, mattenKpi, mattenStateOf, overviewOf, overviewRights, stopText, tourResults } from '../../core/matten-uebersicht.js'
import { ACTIONS, app, canEdit, closeModal, memo, openModal, persist, registerActions, registerModal, registerView, render, renderNow, toast } from '../context.js'
import { onToursChanged, tourStore } from '../matten-tourablage.js'
import { invalidateTodo } from '../modals/todo.js'
import { checked, esc, ICON, menu, modalFrame, val } from '../shared.js'
import { registerHomeCard } from './home.js'
import { kpiHooks } from './lazy.js'
import { stockLine } from './matten-bestand.js'

const MODULE = 'matten'
const VIEW = 'mw-uebersicht'
const KEY = 'mattenJobs'
const ICON_UE = '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M13.5 17h7M17 13.5v7"/>'
const MOBILE_UE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 11.5h5M11.5 9v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const jobsAll = () => (app.data[KEY] ||= [])
const rights = () => overviewRights(app.access)
const editable = () => canEdit(MODULE) && !app.readOnly
/** Belege der Fakturierung, wenn lesbar (sonst null: diese Zahlen fehlen). */
const fakDocs = () => (rights().fak && app.data.fakturierung ? app.data.fakturierung.documents || [] : null)
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const short = (d) => (d ? formatDate(d) : '–')
const dayTitle = (d) => `${WEEKDAY_LONG[isoWeekday(d) - 1]}, ${formatDate(d, { weekday: false, year: true })}`

// ---------------------------------------------------------------- Touren lesen (gemeinsame Ablage mit Planung und Fahrern)

/** Jahre der Touren: Vorjahr (überfällig, nicht durchgeführt), dieses und – um den Jahreswechsel – das nächste. */
export const overviewYears = (today = todayISO()) => tourYears(`${Number(today.slice(0, 4)) - 1}-01-01`, addDays(today, 14))
const attempts = new Map()
/** Touren der Jahre gelesen? Fehlende bzw. ältere als maxAge im Hintergrund lesen (nach einem Fehler frühestens nach 15 s). */
export function ensureOverviewTours(years = overviewYears(), maxAge = 5 * 60_000) {
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

// Stand der Touren: zählt bei jeder Änderung der Ablage hoch (die Touren gehen nicht über den DataService, app.cur kennt sie nicht)
let toursVersion = 0
onToursChanged(() => {
  toursVersion++
  invalidateTodo()
  publish()
  if (['home', VIEW, 'kennzahlen'].includes(app.ui.view) && !app.ui.modal) renderNow()
})

/** Touren, die dieses Gerät nicht speichern konnte (Fehler ohne Netzbezug, z. B. fehlendes Recht). */
function tourErrors() {
  const s = tourStore()
  if (!s) return []
  return [...s.pending.entries()].filter(([, e]) => e?.error).map(([path, e]) => ({ id: e.doc?.id || '', path, error: e.error, tour: e.doc || null }))
}

/**
 * Stand für Übersicht, Kalender und „Zu erledigen“: Einsätze mit den Ergebnissen der Touren, überfällige ohne offene
 * Touren und ohne nicht durchgeführte, nicht durchgeführte, liegen gebliebene Touren (core/matten-uebersicht.js).
 * Solange die Touren nicht gelesen sind, wie bisher nur mit den gespeicherten Einsätzen.
 */
export function mattenState(today = todayISO()) {
  const years = overviewYears(today)
  const loaded = loadedYears(years)
  return memo(app.cur, `mwu:state:${today}:${toursVersion}:${loaded}`, () => mattenStateOf({ doc: doc(), jobs: jobsAll(), tours: loaded ? tourStore().tours() : [], today, toursLoaded: loaded }))
}

/** Die neun Zahlen mit Listen, „Heute“ und Woche. */
function overview(today = todayISO()) {
  const years = overviewYears(today)
  const loaded = loadedYears(years)
  const docs = fakDocs()
  const errs = tourErrors()
  return memo(app.cur, `mwu:ov:${today}:${toursVersion}:${loaded}:${docs ? docs.length : '-'}:${errs.length}`, () =>
    overviewOf({ doc: doc(), jobs: jobsAll(), tours: loaded ? tourStore().tours() : [], toursLoaded: loaded, docs, tourErrors: errs, today, now: nowIso() }),
  )
}

/**
 * Zähler für den digitalen Mitarbeiter (views/disponent.js liest app.mwUe; erst wenn die Touren gelesen sind). Neu nach
 * jeder Änderung der Touren und mit „Zu erledigen“ (rechnet nach jeder Datenänderung, views/matten-kalender.js).
 */
export function publish(today = todayISO()) {
  if (!rights().view || !app.data) return null
  const s = mattenState(today)
  if (!s.toursLoaded) return null
  const notDone = s.notDone.filter((x) => !x.planned)
  const sig = [s.overdue.map((x) => x.placement.id).join(','), notDone.map((x) => x.key).join(','), s.stale.map((t) => t.id).join(','), s.applied.length].join('|')
  if (app.mwUe?.sig === sig && app.mwUe.today === today) return app.mwUe
  autoApply(s.applied.length, sig)
  app.mwUe = { today, sig, overdue: s.overdue, notDone, stale: s.stale.map((t) => ({ id: t.id, date: t.date, driverName: t.driverName || '', status: t.status, stops: (t.stops || []).length })), applied: s.applied.length, at: Date.now() }
  return app.mwUe
}

// ---------------------------------------------------------------- Kacheln

/** Kachel: Zahl, Bezeichnung, kurze Erklärung; Klick öffnet Ansicht bzw. Filter (mwu-goto). */
function tile(id, { label, value, sub, tone = '' }) {
  return `<button class="stat mwu-tile ${tone}" data-action="mwu-goto" data-card="${id}" title="Öffnen: ${esc(label)}"><span class="label">${esc(label)}</span><span class="value">${value}</span><small class="muted">${esc(sub)}</small></button>`
}

function tiles(o) {
  const c = o.cards
  const wait = !o.toursLoaded
  const n = (x, tours = false) => (tours && wait ? '…' : String(x.n))
  const out = [
    tile('heute', { label: 'Heute fällig', value: n(c.heute), sub: c.heute.n ? [c.heute.inTour && `${c.heute.inTour} in Tour`, c.heute.unplanned && `${c.heute.unplanned} noch nicht geplant`].filter(Boolean).join(', ') || 'Einsätze mit Termin heute' : 'kein Wechsel mit Termin heute' }),
    tile('geplant', { label: 'Geplante Touren', value: n(c.geplant, true), sub: [c.geplant.drafts ? plural(c.geplant.drafts, 'Entwurf', 'Entwürfe') : '', c.geplant.past ? `${c.geplant.past} von früher, nicht gestartet` : ''].filter(Boolean).join(', ') || 'freigegeben, noch nicht gestartet', tone: c.geplant.past ? 'warn' : '' }),
    tile('unterwegs', { label: 'Touren in Durchführung', value: n(c.unterwegs, true), sub: c.unterwegs.past ? `${c.unterwegs.past} seit gestern oder länger` : 'Fahrer unterwegs', tone: c.unterwegs.past ? 'warn' : '' }),
    tile('fertig', { label: 'Abgeschlossene Touren', value: n(c.fertig, true), sub: `letzte 7 Tage${c.fertig.today ? `, ${c.fertig.today} heute` : ''}` }),
    tile('ueberfaellig', { label: 'Überfällige Mattenwechsel', value: n(c.ueberfaellig, true), sub: c.ueberfaellig.n ? `Liegeplätze, ältester seit ${short(c.ueberfaellig.oldest)}` : 'kein Liegeplatz überfällig', tone: c.ueberfaellig.n ? 'err' : '' }),
    tile('nicht', { label: 'Nicht durchgeführte Wechsel', value: n(c.nicht, true), sub: c.nicht.n ? `noch nicht nachgeholt${c.nicht.n - c.nicht.open ? `, ${c.nicht.n - c.nicht.open} eingeplant` : ''}` : 'keine Ausnahme offen', tone: c.nicht.open ? 'warn' : '' }),
    c.unversendet && tile('unversendet', { label: 'Lieferscheine nicht versendet', value: n(c.unversendet), sub: c.unversendet.n ? `erstellt, ältester vom ${short(c.unversendet.oldest)}` : 'alle versendet', tone: c.unversendet.n ? 'warn' : '' }),
    tile('fehler', { label: 'Fehlerhafte SharePoint-Übertragungen', value: n(c.fehler), sub: c.fehler.partial ? 'Touren und Fotos (Lieferscheine nur mit Fakturierung)' : 'Lieferschein-Ablage, Touren, Fotos', tone: c.fehler.n ? 'err' : '' }),
    c.entwuerfe && tile('entwuerfe', { label: 'Offene Rechnungsentwürfe', value: n(c.entwuerfe), sub: c.entwuerfe.n ? `noch nicht ausgestellt${c.entwuerfe.released ? `, ${c.entwuerfe.released} freigegeben` : ''}` : 'kein Entwurf offen' }),
  ].filter(Boolean)
  return `<section class="mwu-cards" aria-label="Zahlen des Mattenwechsels">${out.join('')}</section>`
}

// ---------------------------------------------------------------- Heute und Woche

const TOUR_TEXT = { entwurf: 'Entwurf', freigegeben: 'freigegeben', unterwegs: 'unterwegs', abgeschlossen: 'abgeschlossen' }
const TOUR_CLS = { entwurf: '', freigegeben: 'info', unterwegs: 'warning', abgeschlossen: 'ok' }
const tourPill = (t) => `<span class="pill ${TOUR_CLS[t.status] || ''}">${esc(TOUR_TEXT[t.status] || t.status)}</span>`

function todayBlock(o) {
  const rows = o.todayTours
    .map(({ tour, progress: p }) => {
      const pct = p.stops ? Math.round((p.done / p.stops) * 100) : 0
      const act = tour.status === 'entwurf' ? `data-action="mw-tp-goto" data-date="${esc(tour.date)}"` : `data-action="mwu-tour" data-tour="${esc(tour.id)}"`
      return `<li><button class="mwu-tour" ${act}><span class="mwu-tour-top"><strong>${esc(tour.driverName || 'ohne Fahrer')}</strong> ${tourPill(tour)}</span>
        <span class="muted">${p.done} von ${plural(p.stops, 'Stopp', 'Stopps')} erledigt${tour.vehicleLabel ? ` · ${esc(tour.vehicleLabel)}` : ''}</span>
        <span class="mwf-bar" role="img" aria-label="${p.done} von ${p.stops} Stopps erledigt"><span style="width:${pct}%"></span></span></button></li>`
    })
    .join('')
  const load = o.load.length
    ? `<table class="mwf-load mwu-load"><thead><tr><th>Matte</th><th class="num">Stück</th></tr></thead><tbody>${o.load.map((r) => `<tr><td>${esc(loadLabel(r))}</td><td class="num"><strong>${r.qty}</strong></td></tr>`).join('')}</tbody><tfoot><tr><td>gesamt</td><td class="num"><strong>${o.load.reduce((s, r) => s + r.qty, 0)}</strong></td></tr></tfoot></table>`
    : '<p class="muted">Keine freigegebene Tour heute: nichts aufzuladen.</p>'
  return `<section class="mwu-panel" aria-label="Heute"><h3>Heute, ${esc(dayTitle(o.today))}</h3>
    ${!o.toursLoaded ? '<p class="muted">Touren werden gelesen …</p>' : rows ? `<ul class="mwu-tours">${rows}</ul>` : `<p class="muted">Heute ist keine Tour geplant.</p>${editable() ? `<button class="btn small" data-action="mw-tp-goto" data-date="${esc(o.today)}">Touren planen</button>` : ''}`}
    <h4>Ladeliste gesamt</h4>${o.toursLoaded ? load : ''}</section>`
}

function weekBlock(o) {
  const rows = o.week.days
    .map((d) => `<tr class="${d.today ? 'mwu-now' : ''}"><th scope="row"><button class="mwu-day" data-action="mw-cal-goto" data-date="${esc(d.date)}" data-mode="woche">${esc(formatDate(d.date))}${d.today ? ' <span class="muted">heute</span>' : ''}</button></th><td class="num">${d.faellig}</td><td class="num">${d.geplant}</td><td class="num">${d.erledigt}</td></tr>`)
    .join('')
  return `<section class="mwu-panel" aria-label="Diese Woche"><h3>Diese Woche</h3>
    <table class="mwf-load mwu-week"><thead><tr><th>Tag</th><th class="num">fällig</th><th class="num">geplant</th><th class="num">erledigt</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">fällig: Einsätze mit Termin an dem Tag; geplant: davon in einer freigegebenen Tour; erledigt: davon gewechselt. Ein Tag öffnet den Kalender.</p></section>`
}

// ---------------------------------------------------------------- Listen (nicht durchgeführt, Übertragungsfehler)

function notDoneRows(list) {
  const ed = editable()
  return list
    .map((x) => {
      const where = [x.objectName, x.customerName].filter(Boolean).join(' · ')
      return `<li class="mwu-row"><div class="mwu-row-text"><strong>${esc(x.placementName || 'Liegeplatz')}${x.floor ? ` (${esc(x.floor)})` : ''}</strong>${where ? ` <span class="muted">${esc(where)}</span>` : ''}<br>
        <span class="muted">${esc(short(x.date))} · ${esc(x.reason || stopText(x.stopStatus))}${x.driverName ? ` · ${esc(x.driverName)}` : ''}</span>${x.planned ? ` <span class="pill info">Nachholen am ${esc(short(x.planned))}</span>` : ''}</div>
        <div class="actions">${ed && !x.planned && x.job ? `<button class="btn small primary" data-action="mwu-catchup" data-key="${esc(x.key)}">Nachholen …</button>` : ''}<button class="btn small" data-action="mwu-tour" data-tour="${esc(x.tourId)}">Tour ansehen</button></div></li>`
    })
    .join('')
}

function errorRows(list) {
  return list
    .map((x) => {
      if (x.kind === 'lieferschein')
        return `<li class="mwu-row"><div class="mwu-row-text"><strong>Lieferschein ${esc(x.doc.number)}</strong> <span class="muted">${esc(x.doc.recipient?.name || x.doc.objectName || '')}</span><br><span class="muted">Ablage in SharePoint fehlgeschlagen${x.text ? `: ${esc(x.text)}` : ''}</span></div><div class="actions"><button class="btn small primary" data-action="mw-ls-goto" data-filter="ablage">Ablage erneut versuchen</button></div></li>`
      if (x.kind === 'tour')
        return `<li class="mwu-row"><div class="mwu-row-text"><strong>Tour ${esc(x.tour?.date ? short(x.tour.date) : '')} ${esc(x.tour?.driverName || '')}</strong><br><span class="muted">auf diesem Gerät nicht gespeichert: ${esc(x.text)}</span></div><div class="actions"><button class="btn small" data-action="mwu-tour" data-tour="${esc(x.id)}">Tour ansehen</button></div></li>`
      return `<li class="mwu-row"><div class="mwu-row-text"><strong>Foto ${esc(x.placementName || '')}</strong> <span class="muted">${esc(x.stop?.objectName || '')}</span><br><span class="muted">Tour vom ${esc(short(x.tour.date))} (${esc(x.tour.driverName || 'ohne Fahrer')}): ${esc(x.text)}. Auf dem Gerät, das es aufgenommen hat, die App mit Netz öffnen.</span></div><div class="actions"><button class="btn small" data-action="mwu-tour" data-tour="${esc(x.tour.id)}">Tour ansehen</button></div></li>`
    })
    .join('')
}

const LISTS = {
  nicht: { title: 'Nicht durchgeführte Wechsel', empty: 'Kein nicht durchgeführter Wechsel offen.', note: 'In einer Tour mit Ausnahme abgeschlossen (z. B. kein Zugang, Kunde nicht angetroffen) und noch nicht nachgeholt. „Nachholen …“ übernimmt das Ergebnis der Tour in den Kalender und wählt den Tag.', rows: notDoneRows },
  fehler: { title: 'Fehlerhafte SharePoint-Übertragungen', empty: 'Keine fehlgeschlagene Übertragung.', note: 'Lieferscheine bleiben gültig, auch wenn das PDF noch nicht in SharePoint liegt. Touren und Fotos ohne Netz warten im Gerät und kommen von selbst nach; hier steht nur, was dabei hängen geblieben ist.', rows: errorRows },
}

function listBlock(o) {
  const id = app.ui.mwuList
  const L = LISTS[id]
  const card = o.cards[id]
  if (!L || !card) return ''
  return `<section class="mwu-panel mwu-list" id="mwu-list" aria-label="${esc(L.title)}"><header><h3>${esc(L.title)} (${card.n})</h3><button class="btn small ghost" data-action="mwu-list" data-v="">${ICON.close} Schließen</button></header>
    ${card.n ? `<ul class="mwu-rows">${L.rows(card.list)}</ul>` : `<p class="muted">${esc(L.empty)}</p>`}<p class="note">${esc(L.note)}</p></section>`
}

// ---------------------------------------------------------------- Ansicht

function uebersichtView() {
  const today = todayISO()
  ensureOverviewTours(overviewYears(today))
  const o = overview(today)
  publish(today)
  const ed = editable()
  const s = tourStore()
  const head = `<div class="section-head"><div><h2>Matten-Übersicht</h2><p>Der Mattenwechsel auf einen Blick: was heute fällig ist, welche Touren geplant, unterwegs und fertig sind, was überfällig oder nicht durchgeführt wurde und was im Büro noch zu tun ist. Eine Kachel öffnet die passende Ansicht.</p></div>
    <div class="actions"><button class="btn" data-action="mwu-reload">${ICON.refresh} Aktualisieren</button>${menu({
      label: 'Mehr',
      single: false,
      items: [
        { label: 'Matten-Kalender', icon: ICON.calendar, action: 'mw-cal-goto', data: { date: today }, hint: 'Einsätze je Tag' },
        ed && { label: 'Matten-Tourenplanung', icon: ICON.list, action: 'mw-tp-goto', data: { date: today }, hint: 'Touren je Tag' },
        { label: 'Matten-Touren', icon: ICON.list, action: 'view', data: { view: 'mw-touren' }, hint: 'Fortschritt der Fahrer' },
        { label: 'Matten-Lieferscheine', icon: ICON.list, action: 'view', data: { view: 'mw-lieferscheine' }, hint: 'erstellen, senden, ablegen' },
        { label: 'Matten-Bestand', icon: ICON.list, action: 'view', data: { view: 'mw-bestand' }, hint: 'Lager, Wäscherei, Inventur' },
        { label: 'Matten-Liegeplätze', icon: ICON.list, action: 'view', data: { view: 'mw-liegeplaetze' }, hint: 'Kunde, Objekt, Intervall' },
        ed && o.applied.length && { label: 'Tour-Ergebnisse übernehmen', icon: ICON.check, action: 'mwu-apply', hint: plural(o.applied.length, 'Einsatz', 'Einsätze') },
        ed && { label: 'Einstellungen', icon: ICON.gear, action: 'mwu-settings-open', hint: 'Übernehmen, Pünktlichkeit' },
        (!app.access || app.access.all) && { label: 'Umstellung auf das Modul', icon: ICON.gear, action: 'mwc-open', hint: app.data?.matten?.settings?.cutover?.at ? 'umgestellt – zurücknehmen' : 'Werkzeug nur noch lesend' },
      ],
    })}</div></div>`
  const banners = [
    !o.toursLoaded ? `<p class="note">${s?.offline ? 'Ohne Verbindung: die Touren werden gelesen, sobald wieder Netz da ist.' : 'Touren werden gelesen …'}</p>` : s?.offline ? '<p class="note">Ohne Verbindung: angezeigt wird der zuletzt gelesene Stand der Touren.</p>' : '',
    ed && o.applied.length
      ? `<div class="banner mwu-apply"><p><strong>${plural(o.applied.length, 'Einsatz steht', 'Einsätze stehen')} im Kalender noch „in Tour“,</strong> obwohl der Stopp abgeschlossen ist (erledigt oder nicht durchgeführt). Die Übersicht rechnet schon damit; übernommen sind sie im Kalender zu sehen, und nicht durchgeführte lassen sich dort nachholen.</p><button class="btn" data-action="mwu-apply">In die Einsätze übernehmen</button></div>`
      : '',
    !rights().fak ? '<p class="note">Lieferscheine und Rechnungsentwürfe stehen hier nur mit Recht auf die Fakturierung.</p>' : '',
  ].join('')
  if (!doc().placements.some((p) => p.active !== false))
    return `${head}<div class="banner welcome"><p><strong>Noch keine Liegeplätze.</strong> Die Übersicht zählt Einsätze, Touren und Lieferscheine des Mattenwechsels. Zuerst unter „Matten-Liegeplätze“ die Liegeplätze anlegen, dann im Kalender planen.</p><button class="btn" data-action="view" data-view="mw-liegeplaetze">Liegeplätze</button></div>`
  return `${head}${banners}
    <div class="mwu-grid"><div class="mwu-main">${tiles(o)}${stockLine(today)}</div><div class="mwu-side">${todayBlock(o)}${weekBlock(o)}</div></div>
    ${listBlock(o)}`
}

registerView({
  id: 'mw-uebersicht',
  order: 75.45,
  label: 'Matten-Übersicht',
  group: 'service',
  module: MODULE,
  icon: ICON_UE,
  noWeek: true,
  mobile: { icon: MOBILE_UE, label: 'Überblick' },
  text: 'Mattenwechsel: heute fällig, Touren, überfällig, nicht durchgeführt, Lieferscheine, Rechnungsentwürfe',
  badge: () => {
    const s = app.mwUe
    return s && s.today === todayISO() ? s.notDone.length + s.stale.length : 0
  },
  render: uebersichtView,
})

// ---------------------------------------------------------------- Startseite: Karte für das Büro

registerHomeCard({
  id: 'matten',
  // Mattenwechsel Büro und eigene Rollen mit dem Modul; der Vollzugriff hat die Übersicht im Menü
  available: () => rights().view && !!app.access && !app.access.all,
  render: () => {
    const today = todayISO()
    ensureOverviewTours(overviewYears(today))
    const o = overview(today)
    const c = o.cards
    const stat = (id, n, label, hot = false) => `<button class="m-stat ${hot && n ? 'hot' : ''}" data-action="mwu-goto" data-card="${id}"><b>${n}</b><span>${label}</span></button>`
    const wait = !o.toursLoaded
    return `<section class="home-mod" aria-label="Mattenwechsel"><header><h3>Mattenwechsel</h3><button class="btn small primary" data-action="view" data-view="${VIEW}">Öffnen</button></header>
      <div class="m-stats">${stat('heute', c.heute.n, 'heute fällig')}${stat('ueberfaellig', wait ? '…' : c.ueberfaellig.n, 'überfällig', true)}${stat('nicht', wait ? '…' : c.nicht.n, 'nicht durch&shy;geführt', true)}${stat('unterwegs', wait ? '…' : c.unterwegs.n, 'Touren unterwegs')}</div></section>`
  },
})

// ---------------------------------------------------------------- Kennzahlen (views/kpi.js zeichnet, hier wird gerechnet)

kpiHooks.matten = ({ months, today }) => {
  if (!rights().view || !months?.length) return null
  const years = tourYears(months[0].from, today)
  const loaded = ensureOverviewTours(years)
  const tours = loaded ? tourStore().tours() : []
  const state = mattenStateOf({ doc: doc(), jobs: jobsAll(), tours, today, toursLoaded: loaded })
  const k = mattenKpi({ doc: doc(), state, tours, months, tolerance: doc().settings?.toleranceDays })
  const docs = fakDocs()
  return { ...k, loading: !loaded, invoices: docs ? mattenInvoices(docs) : null }
}
kpiHooks.version = () => toursVersion

// ---------------------------------------------------------------- Aktionen

const go = async (patch) => {
  if (app.ui.modal) closeModal()
  Object.assign(app.ui, patch)
  await render()
}
const call = (name, data = {}) => ACTIONS[name]?.({ dataset: data })

/**
 * Einstellung „Tour-Ergebnisse automatisch übernehmen“ (settings.autoApplyResults): wer den Mattenwechsel bearbeitet und
 * die App offen hat, schreibt die Ergebnisse fertiger Stopps gleich in die Einsätze – einmal je Stand (sig) und Sitzung,
 * außerhalb des Zeichnens. Ohne Einstellung nur auf Klick („In die Einsätze übernehmen“).
 */
let autoSig = ''
function autoApply(count, sig) {
  if (!count || autoSig === sig || !doc().settings?.autoApplyResults || !rights().edit) return
  autoSig = sig
  setTimeout(async () => {
    const n = await applyResults().catch(() => 0)
    if (!n) return
    toast(`${plural(n, 'Einsatz', 'Einsätze')} automatisch aus den Touren übernommen.`)
    invalidateTodo()
    renderNow()
  }, 0)
}

/** Ergebnisse der Touren in die gespeicherten Einsätze schreiben (frisch gelesen); keys: nur diese. Liefert die Anzahl. */
async function applyResults(keys = null) {
  const s = tourStore()
  if (!s) return 0
  await s.load({ years: overviewYears() }).catch(() => {})
  const list = keys ? jobsAll().filter((j) => keys.includes(j.key)) : jobsAll()
  const changed = tourResults(list, s.tours(), { now: nowIso(), by: user() })
  if (!changed.length) return 0
  app.data[KEY] = mergeJobs(jobsAll(), changed)
  persist()
  return changed.length
}

registerActions({
  // Kachel: passende Ansicht bzw. passender Filter (auch von der Startseite und dem digitalen Mitarbeiter)
  'mwu-goto': async (el) => {
    const card = el.dataset.card
    const today = todayISO()
    const o = overview(today)
    const c = o.cards[card]
    if (card === 'heute') return call('mw-cal-goto', { date: today, mode: 'woche' })
    if (card === 'ueberfaellig') return call('mw-cal-goto', { date: c?.oldest || today, mode: 'woche' })
    if (card === 'geplant') return call('mw-tp-goto', { date: c?.next || today })
    if (card === 'unterwegs' && c?.n === 1) return call('mwu-tour', { tour: c.list[0].tour.id })
    if (card === 'unterwegs' || card === 'fertig') return go({ view: 'mw-touren', mwfTour: '', mwfStop: '' })
    if (card === 'unversendet') return call('mw-ls-goto', { filter: 'erstellt' })
    if (card === 'fehler' && c?.onlyNotes) return call('mw-ls-goto', { filter: 'ablage' })
    if (card === 'entwuerfe') return go({ view: 'fakturierung', fakTab: 'rechnungen', fakState: 'entwurf', fakSearch: 'Mattenwechsel' })
    // nicht durchgeführt und Übertragungsfehler: die Liste in der Übersicht
    await go({ view: VIEW, mwuList: card })
    document.getElementById('mwu-list')?.scrollIntoView?.({ block: 'start' })
  },
  'mwu-list': (el) => {
    app.ui.mwuList = el.dataset.v || ''
    renderNow()
  },
  // eine Tour in „Matten-Touren“ öffnen (Fortschritt je Stopp, Korrektur)
  'mwu-tour': (el) => go({ view: 'mw-touren', mwfTour: el.dataset.tour || '', mwfStop: '' }),
  'mwu-reload': async () => {
    const s = tourStore()
    if (!s) return
    await s.load({ years: overviewYears() }).catch((err) => toast(`Touren konnten nicht gelesen werden: ${err.message}`))
    renderNow()
  },
})

// ---------------------------------------------------------------- Dialog: Einstellungen der Übersicht

function settingsModal() {
  const st = doc().settings || {}
  return modalFrame({
    title: 'Matten-Übersicht: Einstellungen',
    body: `<div class="form-grid">
        <label class="check wide"><input type="checkbox" id="mwu-auto" ${st.autoApplyResults ? 'checked' : ''}><span>Ergebnisse fertiger Stopps automatisch in die Einsätze übernehmen (erledigt bzw. nachzuholen), sobald jemand aus dem Büro die App öffnet</span></label>
        <label class="field"><span>Pünktlich bis (Tage nach dem Solltermin)</span><input type="number" id="mwu-tol" min="0" max="14" step="1" inputmode="numeric" value="${esc(String(Number(st.toleranceDays) || 0))}"></label>
      </div>
      <p class="note">Ohne „automatisch“ bleiben die Ergebnisse sichtbar, bis jemand „In die Einsätze übernehmen“ klickt. Die Pünktlichkeit zählt in den Kennzahlen: gewechselt bis zum Solltermin plus diese Tage.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mwu-settings-save">Speichern</button></div>`,
  })
}
registerModal('mwu-settings', settingsModal, { module: MODULE })

registerActions(
  {
    'mwu-settings-open': () => openModal({ type: 'mwu-settings' }),
    'mwu-settings-save': () => {
      const tol = Number(val('mwu-tol'))
      if (!Number.isInteger(tol) || tol < 0 || tol > 14) return toast('Pünktlich bis: bitte 0 bis 14 Tage.')
      const st = (doc().settings ||= {})
      if (checked('mwu-auto')) st.autoApplyResults = true
      else delete st.autoApplyResults
      if (tol) st.toleranceDays = tol
      else delete st.toleranceDays
      autoSig = ''
      persist()
      closeModal()
      toast('Einstellungen gespeichert.')
      app.mwUe = null
      publish()
      renderNow()
    },
    // Ergebnisse fertiger Stopps in die Einsätze (Kalender): erledigt bzw. nachzuholen – nach Klick oder automatisch
    'mwu-apply': async () => {
      const n = await applyResults()
      renderNow()
      toast(n ? `${plural(n, 'Einsatz', 'Einsätze')} aus den Touren übernommen.` : 'Nichts zu übernehmen: die Einsätze sind auf dem Stand der Touren.')
    },
    // nicht durchgeführter Wechsel: Ergebnis übernehmen, dann im Kalender den Tag zum Nachholen wählen
    'mwu-catchup': async (el) => {
      const key = el.dataset.key
      await applyResults([key])
      if (!jobsAll().some((j) => j.key === key)) return toast('Den Einsatz gibt es im Kalender nicht (mehr).')
      renderNow()
      openModal({ type: 'mw-job', keys: [key], act: 'nachholen' })
    },
  },
  { edit: MODULE },
)
