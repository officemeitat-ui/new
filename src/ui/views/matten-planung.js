// Mattenwechsel-Modul, Tourenplanung im Büro (docs/MATTENWECHSEL-PLAN.md P9): Ansicht „Matten-Tourenplanung“
// (mw-planung, nur wer den Mattenwechsel bearbeitet; Fahrer sehen sie nicht). Je Tag: Fahrer des Tages wählen
// (Arbeitszeit, Fahrzeug aus dem Fuhrpark, Kapazität), „Vorschlag erzeugen“ (stopsFromJobs aus den Einsätzen des Tages
// und den überfälligen, proposeTours mit dem Betriebshof der Einstellungen), je Tour Fahrer, Fahrzeug, Stopps in
// Reihenfolge mit Ankunftszeit, Zeitfenster, Liegeplätze und Matten, Summe km/Minuten, Ladeliste, Warnungen und ein
// Google-Maps-Link; nicht eingeplante Stopps mit Grund. Bearbeiten: Reihenfolge (Pfeile, am PC auch ziehen), Stopp in
// eine andere Tour, entfernen, hinzufügen, Fahrer/Fahrzeug/Arbeitszeit; danach rechnet recalcTimes die Zeiten neu.
// „Freigeben“ schreibt die Tour (Status freigegeben) und setzt die Einsätze der Stopps auf „in Tour“; zurücknehmen bzw.
// einen Entwurf löschen gibt sie wieder frei. Dazu die Dialoge „Betriebshof und Arbeitszeit“ und „Fahrer“.
// Rechenkerne: core/matten-tour.js (P8), core/matten-touren.js (P9); Ablage: die gemeinsame Touren-Ablage mit der
// Fahreransicht (ui/matten-tourablage.js → storage/matten-touren.js, Zusammenführen mit mergeTour).
// Aktionen und Dialoge mit dem Kürzel „mw-tp-“.

import { addDays, formatDate, isoWeekday, todayISO, WEEKDAY_LONG } from '../../core/dates.js'
import { coordsText, hasCoords, parseCoords } from '../../core/geo.js'
import { mergeJobs, nextWorkday, yearsFor } from '../../core/matten-einsaetze.js'
import { activeAreas, emptyMatten, upgradeMatten } from '../../core/matten.js'
import { assignDriver, loadList, moveStop, proposeTours, recalcTimes, stopsFromJobs, TOUR_REASONS, TOUR_STATUS, tourMatrix, tourProblems } from '../../core/matten-tour.js'
import {
  addStop,
  assignJobs,
  dayDriversProblem,
  depotProblem,
  driverKey,
  driverOf,
  driversForDay,
  driversProblem,
  editableByOffice,
  freeJobs,
  keysInTours,
  loadLabel,
  lockedForOffice,
  mapsLinks,
  newTour,
  normalizeDrivers,
  releaseProblems,
  releaseTour,
  removeStop,
  setShift,
  setVehicle,
  sumLoadLists,
  TourLockedError,
  toursOn,
  tourSummary,
  tourYears,
  transferStop,
  vehicleLabel,
  withdrawTour,
} from '../../core/matten-touren.js'
import { routingFor } from '../../core/routing.js'
import { isNetworkError } from '../../storage/offline.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, registerView, render, renderModal, renderNow, toast } from '../context.js'
import { geocode } from '../geocode.js'
import { onToursChanged, tourStore } from '../matten-tourablage.js'
import { checked, esc, ICON, menu, modalFrame, options, rowMenu, uid, val } from '../shared.js'

const MODULE = 'matten'
const KEY = 'mattenJobs'
const svg = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const ICON_UP = svg('m3 10 5-5 5 5')
const ICON_DOWN = svg('m3 6 5 5 5-5')
const MOBILE_PLAN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3.6" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="8" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="4" cy="12.4" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.5 4.4 5 2.8M10.5 8.8l-5 2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
const ICON_PLAN = '<circle cx="6" cy="5.5" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18.5" r="2"/><path d="m8 6.6 8 4.3M16 13.1l-8 4.3"/>'

const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const settings = () => (doc().settings ||= {})
const jobsAll = () => (app.data[KEY] ||= [])
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const opts = () => ({ now: nowIso(), by: user() })
const sees = (m) => !app.access || app.access.sees(m)
const fakCustomers = () => (sees('fakturierung') ? app.data.fakturierung?.customers || null : null)
const drivers = () => normalizeDrivers(settings().drivers)
const vehicles = () => (app.data.fahrzeuge?.vehicles || []).filter((v) => !v.inactive).sort((a, b) => String(a.plate || a.label).localeCompare(String(b.plate || b.label), 'de'))
const vehicleOf = (id) => (app.data.fahrzeuge?.vehicles || []).find((v) => v.id === id) || null
const routing = () => settings().routing || {}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const km = (x) => String(Math.round((Number(x) || 0) * 10) / 10).replace('.', ',')
const dayTitle = (d) => `${WEEKDAY_LONG[isoWeekday(d) - 1]}, ${formatDate(d, { weekday: false, year: true })}`
const short = (d) => (d ? formatDate(d) : '–')
const STATUS_TEXT = { ...TOUR_STATUS, entwurf: 'Entwurf' }

const tpDate = () => app.ui.mwTpDate || nextWorkday(todayISO())

// ---------------------------------------------------------------- Ablage der Touren (eine Datei je Tour)

// Geändert (auch über die Fahreransicht oder beim Abgleich): Tourenplanung bzw. Kalender neu zeichnen
onToursChanged(() => {
  if (['mw-planung', 'mw-kalender'].includes(app.ui.view) && !app.ui.modal) renderNow()
})

const LOAD_AGE = 60_000
const attempts = new Map()
/**
 * Sind die Touren der Jahre gelesen? Fehlende bzw. ältere als eine Minute werden im Hintergrund gelesen (danach neu
 * zeichnen); nach einem Fehler frühestens nach 15 Sekunden wieder.
 */
export function toursReady(years) {
  const s = tourStore()
  if (!s) return true
  const now = Date.now()
  const todo = years.filter((y) => !s.yearLoaded(y, LOAD_AGE) && !s.yearLoading(y) && now - (attempts.get(y) || 0) > 15_000)
  if (todo.length) {
    todo.forEach((y) => attempts.set(y, now))
    s.load({ years: todo })
      .catch((err) => toast(`Touren konnten nicht gelesen werden: ${err.message}`))
      .finally(() => renderNow())
  }
  return years.every((y) => s.yearLoaded(y))
}

/** Tour zu einer ID (aus den gelesenen), z. B. für „in Tour (Fahrer)“ im Kalender; sonst null. */
export const tourOf = (id) => (id ? tourStore()?.byId(id) || null : null)
/** „in Tour (Anna)“ für einen Einsatz mit Status in-tour. */
export function inTourText(job) {
  const t = tourOf(job?.tourId)
  return t ? `in Tour (${t.driverName || 'ohne Fahrer'})` : 'in Tour'
}

// Einsätze: Jahr des Tages und das Vorjahr (überfällige, verschobene)
const triedJobs = new Set()
function jobsReady(date) {
  const s = app.service
  if (!s?.ensureYears) return true
  const miss = yearsFor(date, date).filter((y) => !s.yearLoaded(KEY, y))
  const todo = miss.filter((y) => !triedJobs.has(y))
  if (todo.length) {
    todo.forEach((y) => triedJobs.add(y))
    s.ensureYears(KEY, todo)
      .then(() => renderNow())
      .catch(() => {})
  }
  return !miss.length
}
const loadJobYears = (date) => app.service?.ensureYears?.(KEY, yearsFor(date, date)) ?? Promise.resolve(false)

/** Geänderte Einsätze speichern (eine Datei je Jahr über den DataService, zusammengeführt je Einsatz). */
function storeJobs(changed) {
  if (!changed.length) return
  app.data[KEY] = mergeJobs(jobsAll(), changed)
  persist()
}

// ---------------------------------------------------------------- Stopps, die noch in keiner Tour sind

/** Offene Stopps des Tages, die in keiner Tour stehen (fällig, verschoben, nachzuholen, überfällig). */
function openStops(date) {
  const exclude = keysInTours(tourStore().tours(), { today: todayISO() })
  return stopsFromJobs({ jobs: jobsAll(), placements: doc().placements, objects: app.data.objects || [], customers: fakCustomers(), date, exclude: [...exclude] })
}

function reasonOf(date, stop) {
  const r = app.ui.mwTpReasons?.[date]?.[stop.id]
  if (r) return r.text || TOUR_REASONS[r.reason] || r.reason
  if (!hasCoords(stop)) return TOUR_REASONS.koordinaten
  if (stop.windowConflict) return 'Zeitfenster der Liegeplätze überschneiden sich nicht'
  return 'noch in keiner Tour'
}

// ---------------------------------------------------------------- Ansicht

const dayChoice = (date) => ((app.ui.mwTpDay ||= {})[date] ||= {})

function planungView() {
  const ed = editable()
  const today = todayISO()
  const date = tpDate()
  const s = tourStore()
  const ready = toursReady(tourYears(date))
  const jready = jobsReady(date)
  const dayTours = toursOn(s.tours(), date)
  const drafts = dayTours.filter(editableByOffice)
  const depot = settings().depot || null
  const list = drivers()
  const confirmReplace = app.ui.confirm === `mw-tp-replace:${date}`
  const head = `<div class="section-head"><div><h2>Touren planen</h2><p>Je Tag aus den fälligen Einsätzen Touren für die Fahrer vorschlagen, Reihenfolge, Fahrer und Fahrzeug anpassen, Ladeliste prüfen und freigeben. Erst eine freigegebene Tour sieht der Fahrer.</p></div>
    <div class="actions">${ed ? `<button class="btn primary ${confirmReplace ? 'confirm' : ''}" data-action="mw-tp-propose">${confirmReplace ? 'Entwürfe ersetzen?' : 'Vorschlag erzeugen'}</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        ed && { label: 'Neue leere Tour', icon: ICON.plus, action: 'mw-tp-new-open', hint: 'Stopps von Hand einplanen' },
        { label: 'Betriebshof und Arbeitszeit', icon: ICON.gear, action: 'mw-tp-depot-open', hint: depot?.name || depot?.address || 'noch nicht eingetragen' },
        { label: 'Fahrer (Mattenwechsel)', icon: ICON.users, action: 'mw-tp-drivers-open', hint: list.length ? plural(list.length, 'Fahrer', 'Fahrer') : 'noch keine' },
        { label: 'Neu laden', icon: ICON.refresh, action: 'mw-tp-reload', hint: 'Touren aus der Ablage' },
        { label: 'Matten-Kalender', icon: ICON.calendar, action: 'mw-cal-goto', data: { date }, hint: 'Einsätze dieses Tages' },
      ],
    })}</div></div>`
  const banners = [
    depotProblem(depot) ? `<div class="banner warn-banner"><p><strong>Betriebshof fehlt.</strong> ${esc(depotProblem(depot))} Er ist Start und Ziel jeder Tour.</p>${ed ? '<button class="btn" data-action="mw-tp-depot-open">Betriebshof eintragen</button>' : ''}</div>` : '',
    !list.length ? `<div class="banner welcome"><p><strong>Noch keine Fahrer für den Mattenwechsel.</strong> Unter „Fahrer“ festlegen, wer Matten fährt (aus den Mitarbeitenden oder mit Name und E-Mail), mit Arbeitszeit und Fahrzeug.</p>${ed ? '<button class="btn" data-action="mw-tp-drivers-open">Fahrer festlegen</button>' : ''}</div>` : '',
  ].join('')
  const status = !ready || !jready ? '<p class="note">Touren und Einsätze werden gelesen …</p>' : s.offline ? '<p class="note">Ohne Verbindung: angezeigt wird der zuletzt gelesene Stand. Planen und Freigeben gehen erst wieder mit Netz.</p>' : s.error ? `<p class="note">${esc(s.error)}</p>` : ''
  const open = ready ? openStops(date) : []
  const released = dayTours.filter((t) => t.status !== 'entwurf').length
  const bar = `<div class="mw-tp-bar">
      <div class="mw-cal-nav"><button class="btn icon" data-action="mw-tp-day" data-step="-1" aria-label="Voriger Tag" title="Voriger Tag">${ICON.left}</button>
        <label class="field inline"><span>Tag</span><input type="date" id="mw-tp-date" value="${esc(date)}" data-change="mw-tp-date"></label>
        <button class="btn icon" data-action="mw-tp-day" data-step="1" aria-label="Nächster Tag" title="Nächster Tag">${ICON.right}</button>
        <button class="btn small" data-action="mw-tp-day" data-step="0">Nächster Arbeitstag</button></div>
      <h3 class="mw-cal-title">${esc(dayTitle(date))}${date < today ? ' <span class="pill na">vorbei</span>' : ''}</h3>
      <p class="muted mw-tp-sum">${esc([plural(dayTours.length, 'Tour', 'Touren'), released ? `${released} freigegeben` : '', plural(open.length, 'Stopp', 'Stopps') + ' nicht eingeplant'].filter(Boolean).join(' · '))}</p>
    </div>`
  const tourBlocks = dayTours.map((t) => tourCard(t, { ed, today, others: drafts.filter((x) => x.id !== t.id) })).join('')
  const empty = !dayTours.length ? `<p class="empty">Noch keine Tour für diesen Tag.${ed && list.length ? ' „Vorschlag erzeugen“ verteilt die offenen Stopps auf die gewählten Fahrer.' : ''}</p>` : ''
  const dayLoad = sumLoadLists(dayTours.map(loadList))
  return `${head}${banners}${bar}${status}${driversBlock(date, list, ed)}${app.ui.mwTpNotice?.date === date ? `<p class="note">${esc(app.ui.mwTpNotice.text)}</p>` : ''}
    <div class="mw-tp-tours">${tourBlocks}${empty}</div>
    ${openBlock(date, open, drafts, ed)}
    ${dayLoad.length && dayTours.length > 1 ? `<aside class="mw-load mw-tp-dayload" aria-label="Ladeliste des Tages"><h4>Ladeliste des Tages (alle Touren)</h4><ul>${dayLoad.map((r) => `<li><b>${r.qty}</b> × ${esc(loadLabel(r))}</li>`).join('')}</ul></aside>` : ''}`
}

function driversBlock(date, list, ed) {
  if (!list.filter((d) => d.active).length) return ''
  const choice = dayChoice(date)
  const dis = ed ? '' : 'disabled'
  const vs = vehicles().map((v) => [v.id, vehicleLabel(v)])
  const rows = list
    .filter((d) => d.active)
    .map((d) => {
      const c = choice[d.id] || {}
      const on = c.on !== false
      const v = c.vehicleId !== undefined ? c.vehicleId : d.vehicleId
      const cap = c.capacity !== undefined ? c.capacity : d.capacity
      const f = (field) => `data-change="mw-tp-drv" data-id="${esc(d.id)}" data-f="${field}" ${dis}`
      return `<div class="mw-tp-drv ${on ? '' : 'off'}">
        <label class="check mw-tp-drv-name"><input type="checkbox" ${f('on')} ${on ? 'checked' : ''}><span>${esc(d.name)}</span></label>
        <label class="field"><span>von</span><input type="time" value="${esc(c.start || d.start || settings().workday?.from || '07:00')}" ${f('start')}></label>
        <label class="field"><span>bis</span><input type="time" value="${esc(c.end || d.end || settings().workday?.to || '15:30')}" ${f('end')}></label>
        <label class="field"><span>Fahrzeug</span><select ${f('vehicleId')}>${options(vs, v || '', { empty: vs.length ? 'ohne Fahrzeug' : 'Fuhrpark leer' })}</select></label>
        <label class="field"><span>Matten (Platz)</span><input type="number" min="0" step="1" inputmode="numeric" value="${esc(cap ?? '')}" placeholder="ohne Grenze" ${f('capacity')}></label>
      </div>`
    })
    .join('')
  return `<section class="mw-tp-drivers" aria-label="Fahrer an diesem Tag"><h3>Fahrer an diesem Tag</h3><div class="mw-tp-drv-list">${rows}</div>
    <p class="muted">Gilt für „Vorschlag erzeugen“. Vorgaben je Fahrer unter „Mehr“ → „Fahrer“.</p></section>`
}

const timeText = (s) => {
  const t = s.times || {}
  if (!t.arrival) return '<span class="muted">–</span>'
  const extra = [t.start && t.start !== t.arrival ? `Beginn ${t.start}` : '', t.departure ? `fertig ${t.departure}` : ''].filter(Boolean).join(', ')
  return `<strong>${esc(t.arrival)}</strong>${extra ? `<small>${esc(extra)}</small>` : ''}`
}

function stopRow(t, s, i, { ed, others }) {
  const canEdit = ed && editableByOffice(t)
  const items = (s.items || [])
    .map((it) => `<li>${esc(it.placementName)}${it.floor ? ` <span class="muted">(${esc(it.floor)})</span>` : ''}: ${it.mat ? `${it.planned} × ${esc(loadLabel(it.mat))}` : '<span class="muted">ohne Matte</span>'}${it.overdue ? ' <span class="mw-st st-ueberfaellig">überfällig</span>' : ''}</li>`)
    .join('')
  const win = s.window?.from || s.window?.to ? `Zeitfenster ${s.window.from || '…'}–${s.window.to || '…'}${s.windowNote ? `, ${s.windowNote}` : ''}` : s.windowNote || ''
  const n = (t.stops || []).length
  const ctl = canEdit
    ? `<div class="mw-tp-ctl"><button class="btn small icon" data-action="mw-tp-move" data-tour="${esc(t.id)}" data-stop="${esc(s.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Stopp ${i + 1} nach oben" title="Nach oben">${ICON_UP}</button><button class="btn small icon" data-action="mw-tp-move" data-tour="${esc(t.id)}" data-stop="${esc(s.id)}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Stopp ${i + 1} nach unten" title="Nach unten">${ICON_DOWN}</button>${rowMenu(
        [...others.map((o) => ({ label: `In die Tour von ${o.driverName || 'ohne Fahrer'}`, action: 'mw-tp-transfer', data: { tour: t.id, stop: s.id, to: o.id } })), { label: 'Aus der Tour nehmen', icon: ICON.trash, action: 'mw-tp-remove', data: { tour: t.id, stop: s.id } }],
        `Stopp ${i + 1}: weitere Aktionen`,
      )}</div>`
    : ''
  return `<li class="mw-tp-stop" data-stop="${esc(s.id)}" ${canEdit ? 'draggable="true"' : ''}>
    <span class="mw-tp-no" aria-label="Stopp ${i + 1}">${i + 1}</span>
    <div class="mw-tp-time">${timeText(s)}</div>
    <div class="mw-tp-where"><strong>${esc(s.customer?.name || 'Kunde')}</strong>${s.objectName ? ` · ${esc(s.objectName)}` : ''}${s.address ? `<br><span class="muted">${esc(s.address)}</span>` : ''}${win ? `<br><span class="mw-tp-win">${esc(win)}</span>` : ''}</div>
    <ul class="mw-tp-items">${items}</ul>
    ${ctl}
  </li>`
}

function tourCard(t, { ed, today, others }) {
  const r = t.route || {}
  const draft = editableByOffice(t)
  const locked = lockedForOffice(t)
  const probs = tourProblems(t)
  const rel = app.ui.mwTpRel?.[t.id] || []
  const links = mapsLinks(t)
  const facts = [t.vehicleLabel || (t.vehicleId ? vehicleLabel(vehicleOf(t.vehicleId)) || 'Fahrzeug' : 'ohne Fahrzeug'), r.start ? `ab ${r.start}` : '', r.end ? `zurück ${r.end}` : '', `${km(r.km)} km`, `${r.minutes || 0} Min. Fahrt`, `${r.work || 0} Min. Arbeit`, r.wait ? `${r.wait} Min. warten` : '', `${r.load || 0} Matten${r.capacity ? ` (Platz ${r.capacity})` : ''}`, r.shift ? `Arbeitszeit ${r.shift.from}–${r.shift.to}` : ''].filter(Boolean)
  const mapsHtml = links.length
    ? links.map((l) => `<a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener" data-maps="${esc(t.id)}">${links.length > 1 ? `Google Maps, Teil ${l.part} (Stopp ${l.from}–${l.to})` : 'Route in Google Maps ansehen'}</a>`).join('')
    : ''
  const confirmDel = app.ui.confirm === `mw-tp-del:${t.id}`
  const actions = ed
    ? draft
      ? `<button class="btn small" data-action="mw-tp-edit-open" data-tour="${esc(t.id)}">Fahrer und Fahrzeug</button><button class="btn small primary" data-action="mw-tp-release" data-tour="${esc(t.id)}" ${t.date < today ? 'disabled' : ''}>Tour freigeben</button><button class="btn small ${confirmDel ? 'danger confirm' : 'ghost'}" data-action="mw-tp-delete" data-tour="${esc(t.id)}">${confirmDel ? 'Wirklich löschen?' : 'Entwurf löschen'}</button>`
      : t.status === 'freigegeben'
        ? '<button class="btn small" data-action="mw-tp-withdraw" data-tour="' + esc(t.id) + '">Freigabe zurücknehmen</button>'
        : ''
    : ''
  // ohne E-Mail erkennt die Fahreransicht die Tour nicht als die des Fahrers
  if (t.driverId && !t.driverEmail) probs.push({ code: 'email', text: `${t.driverName || 'Der Fahrer'} hat keine E-Mail: am Handy sieht er die Tour nicht als seine („Mehr“ → „Fahrer“).` })
  const warn = probs.length ? `<ul class="mw-tp-warn" aria-label="Warnungen">${probs.map((p) => `<li>${esc(p.text)}</li>`).join('')}</ul>` : ''
  const relHtml = rel.length ? `<div class="mw-tp-rel" role="alert"><strong>Freigabe nicht möglich:</strong><ul>${rel.map((p) => `<li>${esc(p.text)}</li>`).join('')}</ul></div>` : ''
  const lockHtml = locked ? `<p class="note">Die Tour ist ${t.status === 'abgeschlossen' ? 'abgeschlossen' : 'unterwegs'}: die Tourenplanung ändert sie nicht mehr. Einzelne Stopps korrigiert das Büro in „Matten-Touren“.</p>` : t.status === 'freigegeben' ? '<p class="note">Freigegeben: der Fahrer sieht die Tour. Zum Ändern zuerst „Freigabe zurücknehmen“.</p>' : ''
  const stops = (t.stops || []).map((s, i) => stopRow(t, s, i, { ed, others })).join('')
  const load = loadList(t)
  return `<section class="mw-tp-tour st-${esc(t.status)}" data-tour="${esc(t.id)}" aria-label="Tour ${esc(t.driverName || 'ohne Fahrer')}">
    <header class="mw-tp-head"><div class="mw-tp-title"><h3>${esc(t.driverName || 'ohne Fahrer')} <span class="mw-st st-${esc(t.status)}">${esc(STATUS_TEXT[t.status] || t.status)}</span></h3>
      <p class="muted">${esc(facts.join(' · '))}</p>${t.notice ? `<p class="muted">${esc(t.notice)}</p>` : ''}</div>
      <div class="actions">${mapsHtml}${actions}</div></header>
    ${relHtml}${warn}${lockHtml}
    ${stops ? `<ol class="mw-tp-stops" data-tour="${esc(t.id)}" ${ed && draft ? 'data-drop="1"' : ''}>${stops}</ol>` : `<p class="muted mw-tp-nostop">Noch kein Stopp. Unten unter „Nicht eingeplant“ Stopps zu dieser Tour hinzufügen.</p>`}
    ${load.length ? `<aside class="mw-load" aria-label="Ladeliste ${esc(t.driverName || '')}"><h4>Ladeliste</h4><ul>${load.map((x) => `<li><b>${x.qty}</b> × ${esc(loadLabel(x))} <span class="muted">(${plural(x.stops, 'Stopp', 'Stopps')})</span></li>`).join('')}</ul><p class="muted">zusammen ${plural(load.reduce((a, x) => a + x.qty, 0), 'Matte', 'Matten')}</p></aside>` : ''}
  </section>`
}

function openBlock(date, open, drafts, ed) {
  if (!open.length) return ''
  const rows = open
    .map((s) => {
      const add =
        ed && drafts.length
          ? menu({
              label: 'Zu Tour …',
              btn: 'small',
              single: false,
              items: drafts.map((t) => ({ label: `Zur Tour von ${t.driverName || 'ohne Fahrer'}`, action: 'mw-tp-add', data: { stop: s.id, tour: t.id } })),
            })
          : ''
      const places = new Set((s.items || []).map((it) => it.placementId)).size
      return `<li class="mw-tp-openrow"><div><strong>${esc(s.customer?.name || 'Kunde')}</strong>${s.objectName ? ` · ${esc(s.objectName)}` : ''}${s.address ? ` <span class="muted">${esc(s.address)}</span>` : ''}
        <br><span class="muted">${esc(plural(places, 'Liegeplatz', 'Liegeplätze'))}, ${esc(plural(s.demand || 0, 'Matte', 'Matten'))}${s.items?.some((it) => it.overdue) ? ', überfällig' : ''}</span> <span class="mw-st st-nachzuholen">${esc(reasonOf(date, s))}</span></div>${add}</li>`
    })
    .join('')
  return `<section class="mw-tp-open" aria-label="Nicht eingeplant"><h3>Nicht eingeplant (${open.length})</h3><ul>${rows}</ul>
    ${ed && !drafts.length ? '<p class="muted">Hinzufügen geht zu einem Entwurf dieses Tages („Vorschlag erzeugen“ oder „Mehr“ → „Neue leere Tour“).</p>' : ''}</section>`
}

registerView({
  id: 'mw-planung',
  order: 75.57,
  label: 'Matten-Tourenplanung',
  group: 'service',
  module: MODULE,
  icon: ICON_PLAN,
  noWeek: true,
  mobile: { icon: MOBILE_PLAN, label: 'Tourplanung' },
  text: 'Mattenwechsel: Touren je Tag vorschlagen, Reihenfolge, Fahrer und Fahrzeug, Ladeliste, freigeben',
  render: planungView,
})

// ---------------------------------------------------------------- Bearbeiten (der Reihe nach)

let chain = Promise.resolve()
/** Änderungen nacheinander ausführen (schnelles Klicken rechnet nie mit einem veralteten Stand). */
const run = (fn) => (chain = chain.catch(() => {}).then(fn))

function failed(err) {
  if (err instanceof TourLockedError || err?.name === 'TourLockedError') toast(err.message)
  else if (isNetworkError(err)) toast('Ohne Verbindung: Freigeben, Zurücknehmen und Löschen gehen nur mit Netz. Bitte später noch einmal.')
  else toast(`Tour nicht gespeichert: ${err?.message || err}`)
}

/** Zeiten nach einer Änderung neu (Fahrzeiten über den eingestellten Anbieter, sonst Luftlinie). */
async function retime(tour) {
  const cfg = routing()
  try {
    return recalcTimes(tour, await tourMatrix(tour, routingFor(cfg), cfg), cfg)
  } catch {
    return recalcTimes(tour, null, cfg)
  }
}

async function saveAll(list, okText = '') {
  try {
    for (const t of list) await tourStore().save(t)
    const waiting = list.some((t) => tourStore().isPending(t.id))
    if (okText || waiting) toast(`${okText}${waiting ? `${okText ? ' ' : ''}Ohne Verbindung: wird gespeichert, sobald wieder Netz da ist.` : ''}`)
    return true
  } catch (err) {
    failed(err)
    return false
  } finally {
    renderNow()
  }
}

const draftOf = (id) => {
  const t = tourStore().byId(id)
  if (!t) {
    toast('Diese Tour gibt es nicht mehr. Bitte neu laden.')
    return null
  }
  if (!editableByOffice(t)) {
    toast(lockedForOffice(t) ? new TourLockedError(t).message : 'Die Tour ist freigegeben: zum Ändern zuerst „Freigabe zurücknehmen“.')
    return null
  }
  return t
}

function moveBy(tourId, stopId, dir) {
  return run(async () => {
    const t = draftOf(tourId)
    if (!t) return
    const i = t.stops.findIndex((s) => s.id === stopId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= t.stops.length) return
    await saveAll([await retime(moveStop(t, i, j, opts()))])
  })
}

/** Ziehen am PC: Stopp vor den Stopp beforeId (leer = ans Ende), in derselben oder einer anderen Tour. */
function dropStop(fromId, stopId, toId, beforeId) {
  return run(async () => {
    const from = draftOf(fromId)
    const to = toId === fromId ? from : draftOf(toId)
    if (!from || !to) return
    if (fromId === toId) {
      const i = from.stops.findIndex((s) => s.id === stopId)
      if (i < 0 || beforeId === stopId) return
      const rest = from.stops.filter((s) => s.id !== stopId)
      const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : rest.length
      const j = at < 0 ? rest.length : at
      if (j === i) return
      return saveAll([await retime(moveStop(from, i, j, opts()))])
    }
    const stop = from.stops.find((s) => s.id === stopId)
    if (!stop) return
    const index = beforeId ? to.stops.findIndex((s) => s.id === beforeId) : to.stops.length
    const r = { from: removeStop(from, stopId, opts()), to: addStop(to, stop, { index: index < 0 ? to.stops.length : index, ...opts() }) }
    await saveAll([await retime(r.from), await retime(r.to)], `Stopp in die Tour von ${to.driverName || 'ohne Fahrer'} verschoben.`)
  })
}

// Ziehen und Ablegen (am PC; am Handy und mit der Tastatur die Pfeile)
let dragging = null
function bindDrag() {
  if (bindDrag.done || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  bindDrag.done = true
  const clear = () => document.querySelectorAll?.('.mw-tp-stop.drop-before, .mw-tp-stops.drop-end, .mw-tp-stop.dragging').forEach((el) => el.classList.remove('drop-before', 'drop-end', 'dragging'))
  document.addEventListener('dragstart', (e) => {
    const li = e.target?.closest?.('.mw-tp-stop[draggable="true"]')
    if (!li) return
    dragging = { tour: li.closest('.mw-tp-stops')?.dataset.tour || '', stop: li.dataset.stop }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', dragging.stop)
    li.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    if (!dragging) return
    const list = e.target?.closest?.('.mw-tp-stops[data-drop="1"]')
    if (!list) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const li = e.target.closest('.mw-tp-stop')
    document.querySelectorAll('.mw-tp-stop.drop-before, .mw-tp-stops.drop-end').forEach((el) => el !== li && el.classList.remove('drop-before', 'drop-end'))
    if (li) li.classList.add('drop-before')
    else list.classList.add('drop-end')
  })
  document.addEventListener('drop', (e) => {
    if (!dragging) return
    const list = e.target?.closest?.('.mw-tp-stops[data-drop="1"]')
    if (!list) return
    e.preventDefault()
    const li = e.target.closest('.mw-tp-stop')
    const d = dragging
    dragging = null
    clear()
    dropStop(d.tour, d.stop, list.dataset.tour, li?.dataset.stop || '')
  })
  document.addEventListener('dragend', () => {
    dragging = null
    clear()
  })
}
bindDrag()

// ---------------------------------------------------------------- Vorschlag

async function propose(el) {
  const date = tpDate()
  const today = todayISO()
  if (date < today) return toast('Für vergangene Tage gibt es keinen Vorschlag mehr.')
  const depot = settings().depot || null
  const dp = depotProblem(depot)
  if (dp) return toast(dp)
  const dayDrivers = driversForDay(drivers(), dayChoice(date), settings())
  const problem = dayDriversProblem(dayDrivers)
  if (problem) return toast(problem)
  const s = tourStore()
  if (el) el.disabled = true
  try {
    await Promise.all([s.load({ years: tourYears(addDays(date, -366), date) }), loadJobYears(date)])
  } catch (err) {
    if (el) el.disabled = false
    return failed(err)
  }
  if (el) el.disabled = false
  if (s.offline) return toast('Ohne Verbindung: Vorschläge gehen erst wieder mit Netz.')
  const all = s.tours()
  const drafts = toursOn(all, date).filter(editableByOffice)
  if (drafts.length && !confirmStep(`mw-tp-replace:${date}`)) return toast(`Für diesen Tag gibt es schon ${plural(drafts.length, 'Entwurf', 'Entwürfe')}. Noch einmal klicken ersetzt ${drafts.length === 1 ? 'ihn' : 'sie'}; freigegebene Touren bleiben.`)
  const exclude = keysInTours(all, { except: drafts.map((t) => t.id), today })
  const stops = stopsFromJobs({ jobs: jobsAll(), placements: doc().placements, objects: app.data.objects || [], customers: fakCustomers(), date, exclude: [...exclude] })
  if (!stops.length) return toast('Keine offenen Einsätze an diesem Tag (auch keine überfälligen ohne Tour).')
  const { now, by } = opts()
  const res = await proposeTours({ stops, drivers: dayDrivers, depot, settings: settings(), date, now, by })
  const tours = res.tours.map((t) => {
    const d = dayDrivers.find((x) => x.id === t.driverId)
    const v = vehicleOf(t.vehicleId)
    // driverEmail setzt proposeTours aus der E-Mail des Fahrers (Einstellungen): daran erkennt die Fahreransicht die Tour
    const out = v ? setVehicle(t, v, { now, by }) : t
    return d?.email && !out.driverEmail ? { ...out, driverEmail: d.email } : out
  })
  try {
    for (const old of drafts) await s.remove(old, { check: (f) => (f.status === 'entwurf' ? '' : 'Ein Entwurf dieses Tages wurde inzwischen freigegeben – bitte neu laden.') })
    for (const t of tours) await s.save(t)
  } catch (err) {
    failed(err)
    return renderNow()
  }
  ;(app.ui.mwTpReasons ||= {})[date] = Object.fromEntries(res.unassigned.map((u) => [u.stopId, { reason: u.reason, text: u.text }]))
  app.ui.mwTpNotice = res.notice ? { date, text: res.notice } : null
  if (app.ui.mwTpRel) for (const t of drafts) delete app.ui.mwTpRel[t.id]
  renderNow()
  const planned = tours.reduce((n, t) => n + t.stops.length, 0)
  toast(`Vorschlag: ${plural(tours.length, 'Tour', 'Touren')} mit ${plural(planned, 'Stopp', 'Stopps')}${res.unassigned.length ? `, ${res.unassigned.length} nicht eingeplant` : ''}. Noch Entwurf – prüfen und freigeben.`)
}

// ---------------------------------------------------------------- Freigabe

async function release(id) {
  const s = tourStore()
  const t0 = s.byId(id)
  if (!t0) return toast('Diese Tour gibt es nicht mehr. Bitte neu laden.')
  const today = todayISO()
  try {
    // frischer Stand: andere Büro-Plätze und Fahrer, Einsätze
    await Promise.all([s.load({ years: tourYears(addDays(t0.date, -366), t0.date) }), loadJobYears(t0.date)])
  } catch (err) {
    return failed(err)
  }
  if (s.offline) return toast('Ohne Verbindung: Freigeben geht erst wieder mit Netz.')
  const tour = s.byId(id)
  const problems = releaseProblems({ tour, tours: s.tours(), jobs: jobsAll(), today })
  app.ui.mwTpRel ||= {}
  if (problems.length) {
    app.ui.mwTpRel[id] = problems
    renderNow()
    return toast(problems[0].text)
  }
  delete app.ui.mwTpRel[id]
  const { now, by } = opts()
  let saved
  try {
    saved = await s.save(releaseTour(tour, { now, by, driver: driverOf(drivers(), tour.driverId) }), { online: true })
  } catch (err) {
    failed(err)
    return renderNow()
  }
  const changed = assignJobs(jobsAll(), saved, { now, by })
  storeJobs(changed)
  renderNow()
  toast(`Tour freigegeben: ${tourSummary(saved)}. ${plural(changed.length, 'Einsatz ist', 'Einsätze sind')} jetzt „in Tour“.`)
}

async function withdraw(id) {
  const s = tourStore()
  let fresh
  try {
    fresh = await s.refresh(id)
  } catch (err) {
    return failed(err)
  }
  if (!fresh) {
    renderNow()
    return toast('Diese Tour gibt es nicht mehr.')
  }
  if (fresh.status !== 'freigegeben') {
    renderNow()
    return toast(lockedForOffice(fresh) ? new TourLockedError(fresh).message : 'Die Tour ist schon wieder ein Entwurf.')
  }
  const { now, by } = opts()
  let saved
  try {
    saved = await s.save(withdrawTour(fresh, { now, by }), { online: true })
  } catch (err) {
    failed(err)
    return renderNow()
  }
  await loadJobYears(saved.date).catch(() => {})
  const freed = freeJobs(jobsAll(), saved, { now, by })
  storeJobs(freed)
  renderNow()
  toast(`Freigabe zurückgenommen: die Tour ist wieder ein Entwurf${freed.length ? `, ${plural(freed.length, 'Einsatz ist', 'Einsätze sind')} wieder frei` : ''}.`)
}

async function deleteDraft(id) {
  const s = tourStore()
  const t = s.byId(id)
  if (!t) return renderNow()
  if (!confirmStep(`mw-tp-del:${id}`)) return
  try {
    await s.remove(t, { check: (f) => (f.status === 'entwurf' ? '' : f.status === 'freigegeben' ? 'Die Tour ist inzwischen freigegeben – zuerst die Freigabe zurücknehmen.' : new TourLockedError(f).message) })
  } catch (err) {
    failed(err)
    return renderNow()
  }
  const freed = freeJobs(jobsAll(), t, opts())
  storeJobs(freed)
  if (app.ui.mwTpRel) delete app.ui.mwTpRel[id]
  renderNow()
  toast(`Entwurf gelöscht (${tourSummary(t)}); seine Einsätze sind wieder frei.`)
}

// ---------------------------------------------------------------- Dialog Tour: Fahrer, Fahrzeug, Arbeitszeit

function tourModal(c, m) {
  const t = tourStore().byId(m.tour)
  if (!t) return modalFrame({ title: 'Tour', body: '<p class="muted">Diese Tour gibt es nicht mehr.</p>', foot: '<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>' })
  const list = drivers().filter((d) => d.active || driverKey(d) === t.driverId)
  const vs = vehicles().map((v) => [v.id, vehicleLabel(v)])
  const r = t.route || {}
  return modalFrame({
    title: `Tour ${t.driverName || 'ohne Fahrer'}`,
    subtitle: esc(dayTitle(t.date)),
    body: `<div class="form-grid">
        <label class="field"><span>Fahrer</span><select id="mw-tp-e-driver">${options(list.map((d) => [driverKey(d), d.name]), m.driverId ?? t.driverId, { empty: 'ohne Fahrer' })}</select></label>
        <label class="field"><span>Fahrzeug</span><select id="mw-tp-e-vehicle">${options(vs, m.vehicleId ?? t.vehicleId ?? '', { empty: vs.length ? 'ohne Fahrzeug' : 'Fuhrpark leer' })}</select></label>
        <label class="field"><span>Arbeitszeit von</span><input type="time" id="mw-tp-e-from" value="${esc(m.from ?? r.shift?.from ?? '')}"></label>
        <label class="field"><span>bis</span><input type="time" id="mw-tp-e-to" value="${esc(m.to ?? r.shift?.to ?? '')}"></label>
        <label class="field"><span>Matten (Platz im Fahrzeug)</span><input type="number" min="0" step="1" inputmode="numeric" id="mw-tp-e-cap" value="${esc(m.capacity ?? r.capacity ?? '')}" placeholder="ohne Grenze"></label>
      </div>
      <p class="muted">Nach dem Speichern rechnet die App die Ankunftszeiten neu. Arbeitszeit leer = die des Fahrers.</p>`,
    foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mw-tp-edit-save">Speichern</button></div>`,
  })
}
registerModal('mw-tp-edit', tourModal, { module: MODULE })

function newModal(c, m) {
  const list = drivers().filter((d) => d.active)
  const vs = vehicles().map((v) => [v.id, vehicleLabel(v)])
  return modalFrame({
    title: 'Neue leere Tour',
    subtitle: esc(dayTitle(tpDate())),
    body: `<p>Eine Tour ohne Stopps, z. B. für einen weiteren Fahrer. Stopps kommen danach aus „Nicht eingeplant“ dazu.</p><div class="form-grid">
        <label class="field"><span>Fahrer</span><select id="mw-tp-n-driver">${options(list.map((d) => [driverKey(d), d.name]), m.driverId || driverKey(list[0]), { empty: 'ohne Fahrer' })}</select></label>
        <label class="field"><span>Fahrzeug</span><select id="mw-tp-n-vehicle">${options(vs, m.vehicleId || '', { empty: vs.length ? 'wie beim Fahrer' : 'Fuhrpark leer' })}</select></label>
      </div>`,
    foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mw-tp-new-save">Tour anlegen</button></div>`,
  })
}
registerModal('mw-tp-new', newModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog Betriebshof und Arbeitszeit

function depotDraft(m) {
  if (!m.draft) {
    const d = settings().depot || {}
    m.draft = { name: d.name || '', address: d.address || '', coords: coordsText(d), from: settings().workday?.from || '', to: settings().workday?.to || '', split: !!settings().splitByArea }
  }
  return m.draft
}
function readDepot() {
  const d = depotDraft(app.ui.modal)
  if (document.getElementById('mw-tp-d-name')) Object.assign(d, { name: val('mw-tp-d-name'), address: val('mw-tp-d-address'), coords: val('mw-tp-d-coords'), from: val('mw-tp-d-from'), to: val('mw-tp-d-to'), split: checked('mw-tp-d-split') })
  return d
}

registerModal(
  'mw-tp-depot',
  (c, m) => {
    const ed = editable()
    const dis = ed ? '' : 'disabled'
    const d = depotDraft(m)
    return modalFrame({
      title: 'Betriebshof und Arbeitszeit',
      body: `<p>Der Betriebshof ist Start und Ziel jeder Tour. Die Arbeitszeit gilt für Fahrer ohne eigene Angabe.</p>
        <div class="form-grid">
          <label class="field"><span>Name</span><input type="text" id="mw-tp-d-name" value="${esc(d.name)}" placeholder="z. B. Betriebshof" ${dis}></label>
          <label class="field wide"><span>Adresse</span><input type="text" id="mw-tp-d-address" value="${esc(d.address)}" placeholder="Straße Nummer, PLZ Ort" ${dis}></label>
          <label class="field wide"><span>Koordinaten (Breite, Länge)</span><span class="input-btn"><input type="text" id="mw-tp-d-coords" value="${esc(d.coords)}" placeholder="z. B. 47.80950, 13.05500" ${dis}>${ed ? '<button class="btn small" data-action="mw-tp-depot-geo" title="Über OpenStreetMap aus der Adresse suchen">Suchen</button>' : ''}</span><small class="muted">für die Reihenfolge und die Fahrzeiten; „Suchen“ fragt OpenStreetMap nach der Adresse</small></label>
          <label class="field"><span>Arbeitszeit von</span><input type="time" id="mw-tp-d-from" value="${esc(d.from)}" placeholder="07:00" ${dis}></label>
          <label class="field"><span>bis</span><input type="time" id="mw-tp-d-to" value="${esc(d.to)}" placeholder="15:30" ${dis}></label>
          <label class="check wide"><input type="checkbox" id="mw-tp-d-split" ${d.split ? 'checked' : ''} ${dis}><span>Touren nach Gebiet trennen (ein Fahrer fährt ein Gebiet; Fahrer mit Stammgebiet fahren ihres)</span></label>
        </div>
        <p class="muted">Fahrzeiten rechnet der eingebaute Anbieter aus der Luftlinie (Umweg und Zuschlag eingerechnet); Google lässt sich später zuschalten.</p>`,
      foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="mw-tp-depot-save">Speichern</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

function saveDepot() {
  const d = readDepot()
  const coords = d.coords.trim() ? parseCoords(d.coords) : null
  if (d.coords.trim() && !coords) return toast('Koordinaten als „Breite, Länge“ eintragen, z. B. 47.80950, 13.05500.')
  if (!d.address.trim() && !coords) return toast('Bitte die Adresse oder die Koordinaten des Betriebshofs eintragen.')
  if ((d.from && !d.to) || (!d.from && d.to) || (d.from && d.to && d.to <= d.from)) return toast('Arbeitszeit: von und bis eintragen, bis nach von.')
  const s = settings()
  s.depot = { name: d.name.trim(), address: d.address.trim(), ...(coords ? { lat: coords.lat, lon: coords.lon } : {}) }
  if (d.from && d.to) s.workday = { from: d.from, to: d.to }
  else delete s.workday
  if (d.split) s.splitByArea = true
  else delete s.splitByArea
  persist()
  closeModal()
  renderNow()
  toast(coords ? 'Betriebshof gespeichert.' : 'Betriebshof gespeichert – ohne Koordinaten gibt es noch keinen Vorschlag („Suchen“).')
}

// ---------------------------------------------------------------- Dialog Fahrer (Markierung „Mattenfahrer“)

/** Mitarbeitende zur Auswahl (nur wer die Stammdaten liest): Rolle „Fahrer Mattenwechsel“ bzw. Qualifikation zuerst. */
function employeeChoices(rows) {
  const taken = new Set(rows.map((r) => r.employeeId).filter(Boolean))
  const roleMails = new Set((app.config?.access?.members?.mattenfahrer || []).map((x) => String(x).toLowerCase()))
  const today = todayISO()
  return (app.data.employees || [])
    .filter((e) => !taken.has(e.id) && !(e.exitDate && e.exitDate < today))
    .map((e) => {
      const marked = roleMails.has(String(e.email || '').toLowerCase()) || (e.skills || []).some((x) => /matten/i.test(x))
      return { e, marked }
    })
    .sort((a, b) => Number(b.marked) - Number(a.marked) || a.e.name.localeCompare(b.e.name, 'de'))
}

function driversDraft(m) {
  if (!m.rows) m.rows = drivers().map((d) => ({ ...d, capacity: d.capacity ?? '' }))
  return m
}
function readDrivers() {
  const m = driversDraft(app.ui.modal)
  m.rows = m.rows.map((r, i) =>
    document.getElementById(`mw-dr-name-${i}`)
      ? { ...r, name: val(`mw-dr-name-${i}`), email: val(`mw-dr-mail-${i}`).trim().toLowerCase(), start: val(`mw-dr-from-${i}`), end: val(`mw-dr-to-${i}`), vehicleId: val(`mw-dr-veh-${i}`), capacity: val(`mw-dr-cap-${i}`), areaId: val(`mw-dr-area-${i}`), active: checked(`mw-dr-on-${i}`) }
      : r,
  )
  return m
}

registerModal(
  'mw-tp-drivers',
  (c, m) => {
    const ed = editable()
    const dis = ed ? '' : 'disabled'
    const d = driversDraft(m)
    const vs = vehicles().map((v) => [v.id, vehicleLabel(v)])
    const areas = activeAreas(doc()).map((a) => [a.id, a.name])
    const emps = employeeChoices(d.rows)
    const rows = d.rows
      .map(
        (r, i) => `<div class="mw-dr-row">
          <label class="field"><span>Name</span><input type="text" id="mw-dr-name-${i}" value="${esc(r.name)}" ${dis}></label>
          <label class="field"><span>E-Mail (Microsoft 365)</span><input type="email" id="mw-dr-mail-${i}" value="${esc(r.email)}" placeholder="für „meine Touren“ am Handy" ${dis}></label>
          <label class="field"><span>von</span><input type="time" id="mw-dr-from-${i}" value="${esc(r.start)}" ${dis}></label>
          <label class="field"><span>bis</span><input type="time" id="mw-dr-to-${i}" value="${esc(r.end)}" ${dis}></label>
          <label class="field"><span>Fahrzeug</span><select id="mw-dr-veh-${i}" ${dis}>${options(vs, r.vehicleId || '', { empty: 'ohne' })}</select></label>
          <label class="field"><span>Matten (Platz)</span><input type="number" min="0" step="1" id="mw-dr-cap-${i}" value="${esc(r.capacity ?? '')}" placeholder="ohne Grenze" ${dis}></label>
          ${areas.length ? `<label class="field"><span>Stammgebiet</span><select id="mw-dr-area-${i}" ${dis}>${options(areas, r.areaId || '', { empty: 'keines' })}</select></label>` : ''}
          <label class="check"><input type="checkbox" id="mw-dr-on-${i}" ${r.active !== false ? 'checked' : ''} ${dis}><span>fährt Matten</span></label>
          ${ed ? `<button class="btn small ghost" data-action="mw-tp-drv-del" data-i="${i}" title="Aus der Liste nehmen" aria-label="${esc(r.name || 'Fahrer')} aus der Liste nehmen">${ICON.trash}</button>` : ''}
        </div>`,
      )
      .join('')
    const pick = emps.length
      ? `<label class="field inline"><span>Aus den Mitarbeitenden</span><select id="mw-dr-emp">${options(
          emps.map(({ e, marked }) => [e.id, `${e.name}${marked ? ' (Fahrer Mattenwechsel)' : ''}`]),
          '',
          { empty: 'Person wählen …' },
        )}</select></label><button class="btn small" data-action="mw-tp-drv-add" data-from="emp">${ICON.plus} hinzufügen</button>`
      : ''
    return modalFrame({
      title: 'Fahrer (Mattenwechsel)',
      wide: true,
      body: `<p>Wer Matten fährt, mit Arbeitszeit, Fahrzeug aus dem Fuhrpark und Platz für Matten (optional). Die Liste ist eine Kopie aus den Mitarbeitenden: das Büro des Mattenwechsels liest die Stammdaten nicht. Die E-Mail verbindet die Tour mit dem Konto des Fahrers.</p>
        ${rows || '<p class="muted">Noch niemand eingetragen.</p>'}
        ${ed ? `<div class="mw-dr-add">${pick}<button class="btn small" data-action="mw-tp-drv-add" data-from="hand">${ICON.plus} Fahrer von Hand</button></div>` : ''}
        ${!vs.length ? '<p class="note">Fahrzeuge kommen aus dem Fuhrpark (Fahrzeuge & Reifen). Ist er leer oder nicht lesbar, plant die App ohne Fahrzeug.</p>' : ''}`,
      foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="mw-tp-drivers-save">Speichern</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

function saveDrivers() {
  const m = readDrivers()
  const rows = m.rows.map((r) => ({ ...r, name: String(r.name || '').trim() }))
  if (rows.some((r) => !r.name)) return toast('Bitte bei jedem Fahrer den Namen eintragen.')
  const list = normalizeDrivers(rows)
  const problem = driversProblem(list)
  if (problem) return toast(problem)
  settings().drivers = list.map((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== null && v !== undefined)))
  persist()
  closeModal()
  renderNow()
  toast(`Fahrer gespeichert: ${plural(list.filter((d) => d.active).length, 'Fahrer', 'Fahrer')} für den Mattenwechsel.`)
}

// ---------------------------------------------------------------- Aktionen

const goto = async (date) => {
  if (app.ui.modal) closeModal()
  app.ui.mwTpDate = date || nextWorkday(todayISO())
  if (app.ui.view !== 'mw-planung') {
    app.ui.view = 'mw-planung'
    await render()
  } else renderNow()
}

registerActions({
  // aus dem Kalender, „Zu erledigen“ und dem digitalen Mitarbeiter: Tag in der Tourenplanung öffnen
  'mw-tp-goto': (el) => goto(el.dataset.date),
  'mw-tp-day': (el) => {
    const step = Number(el.dataset.step) || 0
    app.ui.confirm = null
    app.ui.mwTpDate = step ? addDays(tpDate(), step) : nextWorkday(todayISO())
    renderNow()
  },
  'mw-tp-date': (el) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return
    app.ui.confirm = null
    app.ui.mwTpDate = el.value
    renderNow()
  },
  'mw-tp-reload': async () => {
    try {
      await tourStore().load({ years: tourYears(tpDate()) })
      toast(tourStore().offline ? 'Ohne Verbindung: der zuletzt gelesene Stand bleibt.' : 'Touren neu gelesen.')
    } catch (err) {
      toast(`Touren konnten nicht gelesen werden: ${err.message}`)
    }
    renderNow()
  },
  'mw-tp-depot-open': () => openModal({ type: 'mw-tp-depot' }),
  'mw-tp-drivers-open': () => openModal({ type: 'mw-tp-drivers' }),
})

registerActions(
  {
    'mw-tp-drv': (el) => {
      const c = (dayChoice(tpDate())[el.dataset.id] ||= {})
      const f = el.dataset.f
      if (f === 'on') c.on = el.checked
      else if (f === 'capacity') c.capacity = el.value === '' ? null : Math.max(0, Math.round(Number(el.value) || 0))
      else c[f] = el.value
      app.ui.confirm = null
      renderNow()
    },
    'mw-tp-propose': (el) => run(() => propose(el)),
    'mw-tp-move': (el) => moveBy(el.dataset.tour, el.dataset.stop, Number(el.dataset.dir) || 0),
    'mw-tp-transfer': (el) =>
      run(async () => {
        const from = draftOf(el.dataset.tour)
        const to = from && draftOf(el.dataset.to)
        if (!from || !to) return
        const r = transferStop(from, to, el.dataset.stop, opts())
        await saveAll([await retime(r.from), await retime(r.to)], `Stopp in die Tour von ${to.driverName || 'ohne Fahrer'} verschoben.`)
      }),
    'mw-tp-remove': (el) =>
      run(async () => {
        const t = draftOf(el.dataset.tour)
        if (!t) return
        await saveAll([await retime(removeStop(t, el.dataset.stop, opts()))], 'Stopp aus der Tour genommen; er steht jetzt unter „Nicht eingeplant“.')
      }),
    'mw-tp-add': (el) =>
      run(async () => {
        const t = draftOf(el.dataset.tour)
        if (!t) return
        const stop = openStops(t.date).find((s) => s.id === el.dataset.stop)
        if (!stop) return toast('Dieser Stopp ist inzwischen in einer Tour.')
        if (app.ui.mwTpReasons?.[t.date]) delete app.ui.mwTpReasons[t.date][stop.id]
        await saveAll([await retime(addStop(t, stop, opts()))], `Stopp zur Tour von ${t.driverName || 'ohne Fahrer'} hinzugefügt.`)
      }),
    'mw-tp-release': (el) => run(() => release(el.dataset.tour)),
    'mw-tp-withdraw': (el) => run(() => withdraw(el.dataset.tour)),
    'mw-tp-delete': (el) => run(() => deleteDraft(el.dataset.tour)),
    'mw-tp-edit-open': (el) => {
      if (draftOf(el.dataset.tour)) openModal({ type: 'mw-tp-edit', tour: el.dataset.tour })
    },
    'mw-tp-edit-save': () =>
      run(async () => {
        const m = app.ui.modal
        const t = draftOf(m?.tour)
        if (!t) return
        const from = val('mw-tp-e-from')
        const to = val('mw-tp-e-to')
        if ((from || to) && (!from || !to || to <= from)) return toast('Arbeitszeit: von und bis eintragen, bis nach von.')
        const d = driverOf(drivers(), val('mw-tp-e-driver'))
        const v = vehicleOf(val('mw-tp-e-vehicle'))
        // assignDriver setzt auch driverEmail (Kopie der E-Mail für „meine Touren“ am Handy)
        let next = assignDriver(t, d ? { ...d, id: driverKey(d), vehicleId: '' } : null, opts())
        next = setVehicle(next, v, opts())
        next = setShift(next, { from: from || d?.start || '', to: to || d?.end || '', capacity: val('mw-tp-e-cap') }, opts())
        closeModal()
        await saveAll([await retime(next)], 'Tour geändert, Zeiten neu gerechnet.')
      }),
    'mw-tp-new-open': () => openModal({ type: 'mw-tp-new' }),
    'mw-tp-new-save': () =>
      run(async () => {
        const date = tpDate()
        if (date < todayISO()) return toast('Für vergangene Tage keine neuen Touren.')
        const d = driverOf(drivers(), val('mw-tp-n-driver'))
        const v = vehicleOf(val('mw-tp-n-vehicle')) || vehicleOf(d?.vehicleId)
        const t = newTour({ date, driver: d, vehicle: v, depot: settings().depot || null, settings: settings(), ...opts() })
        closeModal()
        await saveAll([t], `Leere Tour für ${d?.name || 'ohne Fahrer'} angelegt.`)
      }),
    'mw-tp-depot-geo': async (el) => {
      const d = readDepot()
      if (!d.address.trim()) return toast('Bitte zuerst die Adresse eintragen.')
      el.disabled = true
      try {
        const hit = await geocode(d.address)
        if (!hit) return toast('Adresse bei OpenStreetMap nicht gefunden. Koordinaten von Hand eintragen (z. B. aus Google Maps: Rechtsklick auf den Ort).')
        d.coords = `${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`
        renderModal()
        toast(`Gefunden: ${hit.label}`)
      } catch (err) {
        toast(`Suche nicht möglich: ${err.message}`)
      } finally {
        el.disabled = false
      }
    },
    'mw-tp-depot-save': () => saveDepot(),
    'mw-tp-drv-add': (el) => {
      const m = readDrivers()
      if (el.dataset.from === 'emp') {
        const e = (app.data.employees || []).find((x) => x.id === val('mw-dr-emp'))
        if (!e) return toast('Bitte zuerst eine Person wählen.')
        m.rows.push({ id: uid('fd'), employeeId: e.id, name: e.name, email: String(e.email || '').toLowerCase(), start: '', end: '', vehicleId: (app.data.fahrzeuge?.vehicles || []).find((v) => v.driverId === e.id && !v.inactive)?.id || '', capacity: '', areaId: '', active: true })
      } else m.rows.push({ id: uid('fd'), name: '', email: '', start: '', end: '', vehicleId: '', capacity: '', areaId: '', active: true })
      renderModal()
    },
    'mw-tp-drv-del': (el) => {
      const m = readDrivers()
      m.rows.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-tp-drivers-save': () => saveDrivers(),
  },
  { edit: MODULE },
)
