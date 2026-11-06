// Mattenwechsel: Fahreransicht „Matten-Touren“ (docs/MATTENWECHSEL-PLAN.md, P10 und P11), Handy zuerst.
// Fahrer sehen nur ihre freigegebenen Touren (Zuordnung Konto → Person über die E-Mail an der Tour bzw. in den
// Stammdaten), das Büro sieht alle zum Mitschauen und korrigiert abgeschlossene Stopps. Tourenübersicht mit Fortschritt,
// Mattenbedarf je Größe (Ladeliste), „Tour starten“, „Navigation starten“ (Google Maps); Stopp mit Liegeplätzen:
// „Gewechselt“, Menge mit Plus/Minus, „Nicht möglich“ mit Grund, Bemerkung, Fotos; Abschluss je Stopp mit Unterschrift
// am Gerät oder ohne Unterschrift mit Grund, danach automatisch der nächste offene Stopp. Ohne Netz bleibt alles im
// Gerät und wird nachgeholt (storage/matten-touren.js). Rechenkern: core/matten-fahrt.js (auch für die spätere
// Fahrerseite am Webspace, P10b). Touren unter matten/touren/<Jahr>/<TourId>.json, Fotos unter matten/fotos/.
// Kürzel der Aktionen und Dialoge: „mwf-“. Fahrer sehen keine Preise und keinen Kundenstamm (die Tour trägt Kopien).

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import {
  addPlacementPhoto,
  changeQuantity,
  confirmPlacement,
  driverProblem,
  employeeIdsFor,
  finishProblem,
  finishStop,
  isFinal,
  isMyTour,
  localTime,
  markNotPossible,
  markPhotosUploaded,
  nextOpenStop,
  nextPhotoNumber,
  NOT_POSSIBLE_REASONS,
  orderedStops,
  OUTCOMES,
  photoPath,
  placementsOf,
  removePlacementPhoto,
  reopenProblem,
  reopenStop,
  resetPlacement,
  setPlacementNote,
  setStopStatus,
  shownQuantity,
  SIGNER_ROLES,
  startTour,
  STOP_STATUS,
  tourProgress,
  toursFor,
  UNSIGNED_REASONS,
} from '../../core/matten-fahrt.js'
import { loadList } from '../../core/matten-tour.js'
import { navigationUrl } from '../../core/routing.js'
import { app, canEdit, closeModal, openModal, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { onToursChanged, tourStore as sharedTourStore } from '../matten-tourablage.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'
import { esc, ICON, modalFrame } from '../shared.js'

const MODULE = 'mattentour'
const VIEW = 'mw-touren'
const ICON_TOUR = '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18h6.3a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h5.3"/>'
const MOBILE_TOUR = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="12" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="4" r="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 12h4.2a2.3 2.3 0 0 0 0-4.6H6.2a2.3 2.3 0 0 1 0-4.6h4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
const NAV_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2 2 7.2l5 1.8 1.8 5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'

const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.all || app.access.sees(m)
/** Büro (Mitschauen, Korrektur): wer das Büro-Modul Mattenwechsel sieht. */
const isOffice = () => sees('matten')
const browserMode = () => app.store?.kind !== 'sharepoint'
const me = () => ({ email: app.user?.email || '', employeeIds: employeeIdsFor(app.data?.employees || [], app.user?.email) })
const visible = () => app.ui.view === VIEW
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------- Touren laden und speichern

const S = { store: null, off: null, timer: null, refreshedAt: 0, seeded: false }

/** Gemeinsame Touren-Ablage mit der Tourenplanung im Büro (ui/matten-tourablage.js, Gerätespeicher je Konto). */
function tourStore() {
  if (!app.store) return null
  const st = sharedTourStore()
  if (S.store !== st) {
    S.store = st
    S.off?.()
    S.off = onToursChanged(changed)
  }
  return S.store
}

function changed() {
  schedule()
  if (visible() && !app.ui.modal) renderNow()
}

/** Laden (erstes Öffnen, Abgleich höchstens alle 30 Sekunden); im Browser-Modus mit Beispiel-Tour. */
function ensureLoaded({ force = false } = {}) {
  const st = tourStore()
  if (!st || st.loading) return st?.loading || null
  if (!force && st.loaded && Date.now() - S.refreshedAt < 30e3) return null
  S.refreshedAt = Date.now()
  return (async () => {
    if (browserMode() && app.config?.demo && !S.seeded) await seedDemo()
    await st.load({ today: todayISO() })
    if (st.store.flushUploads && !st.offline) await st.flushPhotos(markPhotosUploaded).catch(() => 0)
  })().catch((err) => {
    st.error = String(err?.message || err)
    st.loaded = true
    changed()
  })
}

/**
 * Browser-Modus mit Beispieldaten: eine freigegebene Tour für heute, wenn die Beispiel-Tour noch nicht da ist (auch wenn
 * die Tourenplanung schon Entwürfe im Ordner angelegt hat).
 */
async function seedDemo() {
  S.seeded = true
  const today = todayISO()
  const { createMattenTourDemo } = await import('../../data/demo-matten.js')
  const tour = createMattenTourDemo(today)
  const path = `matten/touren/${today.slice(0, 4)}/${tour.id}.json`
  if (await app.store.read(path).catch(() => null)) return
  await app.store.write(path, tour, null).catch(() => {})
}

/** Ungespeichertes regelmäßig nachholen (ohne Netz alle 15 Sekunden versuchen). */
function schedule() {
  clearTimeout(S.timer)
  S.timer = null
  if (!S.store?.pending.size) return
  S.timer = setTimeout(() => sync().finally(schedule), 15e3)
}

async function sync() {
  const st = S.store
  if (!st) return
  await st.flushPhotos(markPhotosUploaded).catch(() => 0)
  await st.flush().catch(() => {})
  if (visible() && !app.ui.modal) renderNow()
}

if (typeof window !== 'undefined') {
  window.addEventListener?.('online', () => {
    if (S.store?.loaded) sync().then(() => ensureLoaded({ force: true }))
  })
  // Fahrer: im Hintergrund schon laden, dann geht die Tour auch im Keller, wenn die Ansicht noch nie offen war
  // (das Büro lädt beim Öffnen)
  setTimeout(() => {
    if (app.store?.kind === 'sharepoint' && app.access?.sees?.('mattentour') && !app.access.sees('matten')) ensureLoaded()
  }, 0)
}

const tourOf = (id) => S.store?.byId(id) || null
const stopOf = (tour, id) => (tour?.stops || []).find((s) => s.id === id) || null

/** Darf diese Person an der Tour arbeiten? Fahrer der Tour, Büro, Browser-Modus. */
function canWork(tour) {
  if (!editable() || !tour || tour.status === 'entwurf') return false
  return browserMode() || isOffice() || isMyTour(tour, me())
}

/** Tour ändern und speichern; Fehler (z. B. Stopp fest) als Meldung. */
async function change(tourId, fn) {
  const st = S.store
  if (!st) return null
  try {
    return await st.update(tourId, (t) => fn(t, { now: nowIso(), by: user() }))
  } catch (err) {
    toast(err.message || String(err))
    return null
  }
}

// ---------------------------------------------------------------- Texte

const STOP_CLS = { geplant: '', unterwegs: 'info', 'in-bearbeitung': 'warning', abgeschlossen: 'ok', teilweise: 'warning', 'nicht-angetroffen': 'error', 'nicht-durchgefuehrt': 'error' }
const TOUR_TEXT = { entwurf: 'Entwurf', freigegeben: 'freigegeben', unterwegs: 'unterwegs', abgeschlossen: 'abgeschlossen' }
const TOUR_CLS = { entwurf: '', freigegeben: 'info', unterwegs: 'warning', abgeschlossen: 'ok' }
const stopPill = (s) => `<span class="pill ${STOP_CLS[s.status || 'geplant'] || ''}">${esc(STOP_STATUS[s.status || 'geplant'] || s.status)}</span>`
const tourPill = (t) => `<span class="pill ${TOUR_CLS[t.status] || ''}">${esc(TOUR_TEXT[t.status] || t.status)}</span>`
function dayText(d) {
  const today = todayISO()
  if (d === today) return `Heute, ${formatDate(d)}`
  if (d === addDays(today, 1)) return `Morgen, ${formatDate(d)}`
  if (d === addDays(today, -1)) return `Gestern, ${formatDate(d)}`
  return formatDate(d)
}
const matText = (m, qty) => `${qty} × ${[m?.size, m?.color].filter(Boolean).join(', ') || m?.name || 'Matte'}`
const stopTitle = (s) => s.customer?.name || s.objectName || 'Stopp'
const windowText = (s) => (s.window?.from || s.window?.to ? `${s.window.from || '…'}–${s.window.to || '…'} Uhr` : '')
const diffText = (d) => (d > 0 ? `+${d}` : `−${Math.abs(d)}`)

function navLink(stop, { cls = 'btn primary', label = 'Navigation starten', tour = null } = {}) {
  if (!stop) return ''
  const url = navigationUrl(stop)
  return `<a class="${cls} mwf-nav" href="${esc(url)}" target="_blank" rel="noopener" data-action="mwf-nav" data-tour="${esc(tour?.id || '')}" data-stop="${esc(stop.id)}">${NAV_ICON} ${esc(label)}</a>`
}

/** Hinweis „wartet auf Netz“ bzw. Fehler beim Speichern. */
function syncBanner() {
  const st = S.store
  if (!st) return ''
  const n = st.pendingPaths().length
  const photos = st.tours().reduce((x, t) => x + t.stops.reduce((y, s) => y + (s.items || []).reduce((z, it) => z + (it.photos || []).filter((p) => p.queued).length, 0), 0), 0)
  if (!n && !photos && !st.error) return ''
  const what = [n ? plural(n, 'Tour mit Änderungen', 'Touren mit Änderungen') : '', photos ? plural(photos, 'Foto', 'Fotos') : ''].filter(Boolean).join(' und ')
  if (st.error && !st.offline) return `<div class="banner warn-banner mwf-sync" role="status"><p><strong>Nicht gespeichert:</strong> ${esc(st.error)} ${what ? `(${esc(what)} im Gerät)` : ''}</p><button class="btn mwf-tap" data-action="mwf-sync">Erneut senden</button></div>`
  if (!what) return ''
  return `<div class="banner warn-banner mwf-sync" role="status"><p><strong>${st.offline ? 'Wartet auf Netz' : 'Wird gesendet'}:</strong> ${esc(what)} ${n + photos === 1 ? 'liegt' : 'liegen'} im Gerät und ${n + photos === 1 ? 'wird' : 'werden'} automatisch nachgeholt, sobald wieder Netz da ist. Nichts geht verloren.</p><button class="btn mwf-tap" data-action="mwf-sync">Jetzt senden</button></div>`
}

// ---------------------------------------------------------------- Ansicht

function head(sub = '') {
  return `<div class="section-head"><div><h2>Matten-Touren</h2><p>${sub || (isOffice() ? 'Alle freigegebenen Touren zum Mitschauen: Fortschritt je Tour und Stopp, Unterschriften, Abweichungen. Abgeschlossene Stopps korrigiert hier nur das Büro.' : 'Deine Touren des Mattenwechsels: Stopps der Reihe nach, Matten je Liegeplatz, Navigation und Bestätigung – auch ohne Netz.')}</p></div>
    <div class="actions"><button class="btn mwf-tap" data-action="mwf-refresh">${ICON.refresh} Aktualisieren</button></div></div>`
}

function render() {
  const st = tourStore()
  if (!st) return `${head()}<div class="banner"><p>Touren gibt es nur mit einer Ablage (SharePoint).</p></div>`
  ensureLoaded()
  if (!st.loaded) return `${head()}<p class="empty">Touren werden geladen …</p>`
  const tour = app.ui.mwfTour ? tourOf(app.ui.mwfTour) : null
  if (tour && mayView(tour)) {
    const stop = app.ui.mwfStop ? stopOf(tour, app.ui.mwfStop) : null
    return stop ? stopView(tour, stop) : tourView(tour)
  }
  return listView()
}

/** Fahrer sehen nur eigene Touren (auch beim Öffnen über eine gemerkte ID). */
const mayView = (tour) => isOffice() || browserMode() || isMyTour(tour, me())

function listView() {
  const st = S.store
  const today = todayISO()
  const office = isOffice()
  const rows = toursFor(st.tours(), { ...me(), office, all: browserMode(), today })
  const note = browserMode() ? '<p class="note">Browser-Modus: ohne Anmeldung sind alle Touren „deine“. Im Betrieb sieht ein Fahrer nur die Touren, die ihm das Büro zugeteilt hat (über die E-Mail seines Kontos).</p>' : ''
  if (!rows.length) {
    const empty = office ? 'Keine freigegebene Tour in den letzten und nächsten 7 Tagen. Touren plant und gibt das Büro frei.' : 'Für dich ist gerade keine Tour freigegeben. Deine Touren kommen vom Büro und erscheinen hier, sobald sie freigegeben sind.'
    return `${head()}${syncBanner()}<div class="banner welcome"><p><strong>Noch keine Touren.</strong> ${empty}</p>${office && sees('matten') ? '<button class="btn" data-action="view" data-view="mw-liegeplaetze">Liegeplätze</button>' : ''}</div>${st.error ? `<p class="mwf-warn">${esc(st.error)}</p>` : ''}${note}
      <p class="note">Fahrer sehen hier weder Preise noch den Kundenstamm: Eine Tour trägt nur, was für den Wechsel nötig ist (Kunde, Adresse, Liegeplatz, Matten, Zugang).</p>`
  }
  const cards = rows.map(({ tour, past, finished }) => tourCard(tour, { past, finished, office })).join('')
  return `${head()}${syncBanner()}<div class="mwf-cards">${cards}</div>${note}`
}

function tourCard(tour, { past, finished, office }) {
  const p = tourProgress(tour)
  const pct = p.stops ? Math.round((p.done / p.stops) * 100) : 0
  const load = loadList(tour)
    .map((r) => matText(r, r.qty))
    .join(' · ')
  const pending = S.store.isPending(tour.id)
  const warn = office ? driverProblem(tour) : ''
  return `<article class="mwf-card${past ? ' past' : ''}${finished ? ' done' : ''}">
    <button class="mwf-card-main" data-action="mwf-open" data-tour="${esc(tour.id)}">
      <span class="mwf-card-top"><strong>${esc(dayText(tour.date))}</strong> ${tourPill(tour)}${pending ? ' <span class="pill warning">wartet auf Netz</span>' : ''}</span>
      ${office || browserMode() ? `<span class="mwf-card-line">${ICON.user} ${esc(tour.driverName || 'kein Fahrer')}</span>` : ''}
      <span class="mwf-card-line"><b>${plural(p.stops, 'Stopp', 'Stopps')}</b> · ${p.done} erledigt · ${p.open} offen</span>
      <span class="mwf-bar" role="img" aria-label="${p.done} von ${p.stops} Stopps erledigt"><span style="width:${pct}%"></span></span>
      ${load ? `<span class="mwf-card-line muted">Matten: ${esc(load)}</span>` : ''}
    </button>
    ${past ? `<p class="mwf-warn">Tour vom ${esc(formatDate(tour.date))} ist noch nicht abgeschlossen.</p>` : ''}
    ${warn ? `<p class="mwf-warn">${esc(warn)}</p>` : ''}
  </article>`
}

function tourView(tour) {
  const p = tourProgress(tour)
  const work = canWork(tour)
  const next = p.next
  const stops = orderedStops(tour)
  const past = tour.date < todayISO() && tour.status !== 'abgeschlossen'
  const load = loadList(tour)
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const go = [
    work && tour.status === 'freigegeben' ? `<button class="btn primary mwf-big" data-action="mwf-start" data-tour="${esc(tour.id)}">Tour starten</button>` : '',
    next ? navLink(next, { tour, cls: `btn ${tour.status === 'freigegeben' && work ? '' : 'primary'} mwf-big`, label: 'Navigation starten' }) : '',
    next ? `<button class="btn mwf-big" data-action="mwf-stop" data-tour="${esc(tour.id)}" data-stop="${esc(next.id)}">Nächster Stopp: ${esc(stopTitle(next))}</button>` : '',
  ].filter(Boolean)
  const list = stops
    .map((s, i) => {
      const pls = placementsOf(s)
      const mats = (s.items || []).filter((it) => it.mat).map((it) => matText(it.mat, it.planned)).join(' · ')
      const time = s.times?.arrival ? `ca. ${s.times.arrival}` : ''
      return `<li class="mwf-stop-item${isFinal(s) ? ' done' : ''}${next?.id === s.id ? ' next' : ''}"><button class="mwf-stop-btn" data-action="mwf-stop" data-tour="${esc(tour.id)}" data-stop="${esc(s.id)}">
        <span class="mwf-no" aria-hidden="true">${i + 1}</span>
        <span class="mwf-stop-text"><span class="mwf-card-top"><strong>${esc(stopTitle(s))}</strong> ${stopPill(s)}</span>
          <span>${esc(s.objectName || '')}${s.address ? ` · ${esc(s.address)}` : ''}</span>
          <span class="muted">${esc([plural(pls.length, 'Liegeplatz', 'Liegeplätze'), mats, time, windowText(s)].filter(Boolean).join(' · '))}</span></span></button></li>`
    })
    .join('')
  return `<div class="mwf-back"><button class="btn ghost" data-action="mwf-back">${ICON.left} Alle Touren</button></div>
    <div class="section-head"><div><h2>Tour ${esc(dayText(tour.date).replace(/^(Heute|Morgen|Gestern)/, (w) => w.toLowerCase()))}</h2><p>${tourPill(tour)} ${esc(tour.driverName || 'kein Fahrer')}${tour.vehicleId ? ` · Fahrzeug ${esc(tour.vehicleId)}` : ''}${tour.startedAt ? ` · gestartet ${esc(localTime(tour.startedAt))}` : ''}${tour.finishedAt ? ` · fertig ${esc(localTime(tour.finishedAt))}` : ''}</p></div></div>
    ${syncBanner()}
    ${past ? `<p class="mwf-warn">Diese Tour vom ${esc(formatDate(tour.date))} ist noch offen. Bitte fertig machen oder dem Büro Bescheid geben.</p>` : ''}
    <div class="impact-stats mwf-stats">${tile('Stopps gesamt', p.stops)}${tile('erledigt', p.done, p.done ? 'ok' : '')}${tile('offen', p.open)}</div>
    ${go.length ? `<div class="mwf-go">${go.join('')}</div>` : p.finished ? '<p class="mwf-ok">Alle Stopps sind erledigt.</p>' : ''}
    <section class="mwf-block"><h3>Mattenbedarf je Größe</h3>
      ${load.length ? `<div class="mwf-load-wrap"><table class="mwf-load"><thead><tr><th>Größe</th><th>Farbe</th><th class="num">Stück</th><th class="num">Stopps</th></tr></thead><tbody>${load.map((r) => `<tr><td>${esc(r.size || r.name || 'Matte')}</td><td>${esc(r.color || '')}</td><td class="num"><strong>${r.qty}</strong></td><td class="num">${r.stops}</td></tr>`).join('')}</tbody></table></div><p class="note">Ladeliste: so viele saubere Matten mitnehmen (Soll der ganzen Tour).</p>` : '<p class="muted">Keine Matten in dieser Tour.</p>'}
    </section>
    <section class="mwf-block"><h3>Stopps in geplanter Reihenfolge</h3><ol class="mwf-stops">${list}</ol></section>`
}

function stopView(tour, stop) {
  const stops = orderedStops(tour)
  const idx = stops.findIndex((s) => s.id === stop.id)
  const work = canWork(tour) && !isFinal(stop)
  const pls = placementsOf(stop)
  const info = [stop.objectName ? `<strong>${esc(stop.objectName)}</strong>` : '', stop.address ? esc(stop.address) : ''].filter(Boolean).join('<br>')
  const when = [stop.times?.arrival ? `geplant ca. ${esc(stop.times.arrival)} Uhr` : '', windowText(stop) ? `Zeitfenster ${esc(windowText(stop))}` : '', stop.windowNote ? esc(stop.windowNote) : ''].filter(Boolean).join(' · ')
  const arrive = work && ['geplant', 'unterwegs'].includes(stop.status || 'geplant') ? `<button class="btn mwf-big" data-action="mwf-arrive" data-tour="${esc(tour.id)}" data-stop="${esc(stop.id)}">Angekommen</button>` : ''
  const blocks = pls.map((p, i) => placementBlock(tour, stop, p, i, work)).join('')
  const foot = isFinal(stop) ? finishedBox(tour, stop) : work ? `<div class="mwf-foot"><button class="btn primary mwf-big mwf-finish" data-action="mwf-finish-open" data-tour="${esc(tour.id)}" data-stop="${esc(stop.id)}">${ICON.check} Stopp abschließen</button></div>` : '<p class="note">Nur ansehen: Diese Tour fährt jemand anders.</p>'
  return `<div class="mwf-back"><button class="btn ghost" data-action="mwf-back-tour">${ICON.left} Tourübersicht</button><span class="muted">Stopp ${idx + 1} von ${stops.length}</span></div>
    ${syncBanner()}
    <section class="mwf-stop-head">
      <div class="mwf-card-top"><h2>${esc(stopTitle(stop))}</h2>${stopPill(stop)}</div>
      ${stop.customer?.no ? `<p class="muted">Kundennummer ${esc(stop.customer.no)}</p>` : ''}
      ${info ? `<p>${info}</p>` : ''}
      ${when ? `<p class="muted">${when}</p>` : ''}
      <div class="mwf-go">${isFinal(stop) ? '' : navLink(stop, { tour, cls: 'btn primary mwf-big' })}${arrive}</div>
    </section>
    ${blocks}
    ${foot}`
}

function placementBlock(tour, stop, p, i, work) {
  const st = p.status
  const pill =
    st === 'gewechselt'
      ? `<span class="pill ok">gewechselt${p.time ? ` ${esc(localTime(p.time))}` : ''}</span>`
      : st === 'nicht-moeglich'
        ? `<span class="pill error">nicht möglich</span>`
        : st === 'teilweise'
          ? '<span class="pill warning">teilweise</span>'
          : '<span class="pill">offen</span>'
  const data = `data-tour="${esc(tour.id)}" data-stop="${esc(stop.id)}" data-pl="${esc(p.placementId)}"`
  const mats = p.items
    .map((it, k) => {
      const index = p.indexes[k]
      const shown = shownQuantity(it)
      const dev = it.status === 'gewechselt' ? shown - (Number(it.planned) || 0) : 0
      const label = it.mat ? [it.mat.size, it.mat.color].filter(Boolean).join(', ') || it.mat.name : 'Matte'
      const stepper = work && it.status !== 'nicht-moeglich'
        ? `<span class="mwf-qty"><button class="btn mwf-step" data-action="mwf-qty" ${data} data-i="${index}" data-d="-1" aria-label="${esc(label)}: eine weniger"${shown <= 0 ? ' disabled' : ''}>−</button><output class="mwf-num" aria-live="polite" aria-label="Menge ${esc(label)}">${shown}</output><button class="btn mwf-step" data-action="mwf-qty" ${data} data-i="${index}" data-d="1" aria-label="${esc(label)}: eine mehr">+</button></span>`
        : `<span class="mwf-num static">${it.status === 'nicht-moeglich' ? 0 : shown}</span>`
      return `<li class="mwf-mat"><span class="mwf-soll"><span class="muted">Soll</span> <strong>${esc(matText(it.mat, it.planned))}</strong></span>${stepper}${dev ? `<span class="pill warning mwf-dev">Abweichung ${diffText(dev)}</span>` : ''}</li>`
    })
    .join('')
  const meta = [p.floor ? `Stockwerk ${esc(p.floor)}` : '', p.access ? `Zugang: ${esc(p.access)}` : ''].filter(Boolean).join(' · ')
  const buttons = !work
    ? ''
    : st === 'geplant'
      ? `<div class="mwf-acts"><button class="btn primary mwf-big" data-action="mwf-done" ${data}>${ICON.check} Gewechselt</button><button class="btn mwf-big" data-action="mwf-not-open" ${data}>Nicht möglich</button></div>`
      : `<div class="mwf-acts"><button class="btn ghost" data-action="mwf-reset" ${data}>Zurücksetzen</button>${st !== 'gewechselt' ? `<button class="btn primary mwf-big" data-action="mwf-done" ${data}>${ICON.check} Doch gewechselt</button>` : ''}</div>`
  const photos = (p.photos || [])
    .map((ph, k) => `<span class="pill mwf-photo"><button type="button" class="mwf-photo-open" data-action="mwf-photo-open" data-path="${esc(ph.path)}" title="${esc(ph.name)}">${ICON.camera} Foto ${k + 1}${ph.queued ? ' · wartet auf Netz' : ''}</button>${work ? `<button type="button" class="btn small ghost" data-action="mwf-photo-del" ${data} data-path="${esc(ph.path)}" aria-label="Foto ${k + 1} entfernen">${ICON.close}</button>` : ''}</span>`)
    .join('')
  return `<section class="mwf-pl ${st}" data-pl="${esc(p.placementId)}">
    <div class="mwf-card-top"><h3>${esc(p.placementName || 'Liegeplatz')}</h3>${pill}</div>
    ${meta ? `<p class="mwf-meta">${meta}</p>` : ''}
    ${p.hint ? `<p class="mwf-hint">${esc(p.hint)}</p>` : ''}
    <ul class="mwf-mats">${mats}</ul>
    ${st === 'nicht-moeglich' || (st === 'teilweise' && p.reason) ? `<p class="mwf-reason">Nicht möglich: ${esc(p.reason)}</p>` : ''}
    ${buttons}
    ${work ? `<label class="field mwf-note"><span>Bemerkung</span><textarea id="mwf-note-${i}" rows="2" data-change="mwf-note" ${data} placeholder="z. B. Matte stark verschmutzt, Liegeplatz verlegt">${esc(p.note)}</textarea></label>` : p.note ? `<p class="mwf-meta">Bemerkung: ${esc(p.note)}</p>` : ''}
    <div class="mwf-photos">${photos}${work ? `<label class="btn mwf-camera">${ICON.camera} Foto<input type="file" accept="image/*" capture="environment" data-change="mwf-photo" ${data} hidden></label>` : ''}</div>
  </section>`
}

const sigImg = (svg) => `<img class="mwf-sig" alt="Unterschrift" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg || '')}">`

function finishedBox(tour, stop) {
  const dev = stop.deviations || []
  const conf = stop.signature
    ? `<div class="mwf-signed">${sigImg(stop.signature.svg)}<p><strong>${esc(stop.signature.name)}</strong>${stop.signature.role ? `, ${esc(stop.signature.role)}` : ''}<br><span class="muted">unterschrieben am Gerät um ${esc(localTime(stop.signature.at))}</span></p></div>`
    : `<p><strong>Ohne Unterschrift:</strong> ${esc(stop.unsigned?.reason || '')}</p>`
  const reopen = isOffice() && editable() ? `<button class="btn mwf-tap" data-action="mwf-reopen-open" data-tour="${esc(tour.id)}" data-stop="${esc(stop.id)}">Korrigieren (Büro)</button>` : ''
  const next = nextOpenStop(tour, stop.id)
  return `<section class="mwf-block mwf-finished">
    <h3>${stopPill(stop)} um ${esc(localTime(stop.finishedAt))}${stop.finishedBy ? ` von ${esc(stop.finishedBy)}` : ''}</h3>
    ${conf}
    ${stop.totals ? `<p>Matten: ${stop.totals.actual} von ${stop.totals.planned} gewechselt.</p>` : ''}
    ${dev.length ? `<ul class="mwf-devs">${dev.map((d) => `<li>${esc(d.placementName)}: ${esc(matText(d.mat, d.planned))} → ${d.actual}${d.reason ? ` (${esc(d.reason)})` : ''} <span class="pill warning">${diffText(d.diff)}</span></li>`).join('')}</ul>` : ''}
    ${stop.note ? `<p>Bemerkung: ${esc(stop.note)}</p>` : ''}
    <p class="note">Abgeschlossen: für den Fahrer fest. Korrigieren kann nur das Büro. Der Lieferschein entsteht im Büro.</p>
    <div class="mwf-go">${reopen}${next && canWork(tour) ? `<button class="btn primary mwf-big" data-action="mwf-stop" data-tour="${esc(tour.id)}" data-stop="${esc(next.id)}">Nächster Stopp: ${esc(stopTitle(next))}</button>` : ''}</div>
  </section>`
}

registerView({
  id: 'mw-touren',
  order: 75.6,
  label: 'Matten-Touren',
  group: 'service',
  module: MODULE,
  icon: ICON_TOUR,
  noWeek: true,
  mobile: { icon: MOBILE_TOUR, label: 'Touren' },
  text: 'Mattenwechsel: eigene Touren, Wechsel je Liegeplatz bestätigen',
  // offene Stopps der heutigen eigenen Touren
  badge: () => {
    if (!S.store?.loaded) return 0
    const today = todayISO()
    return toursFor(S.store.tours(), { ...me(), all: browserMode(), today, days: 0 })
      .filter((x) => x.tour.date === today && !x.finished)
      .reduce((n, x) => n + tourProgress(x.tour).open, 0)
  },
  render,
})

// ---------------------------------------------------------------- Fotos (verkleinert wie beim Regiebericht)

const LOCAL = new Map() // Browser-Modus: Fotos nur in diesem Fenster
const BLOBS = new Map() // in dieser Sitzung aufgenommen (auch ohne Netz sofort ansehen)

async function shrink(file, max = 2000, quality = 0.82, minSize = 600e3) {
  if (!/^image\//.test(file.type) || file.size < minSize || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob && blob.size < file.size ? new File([blob], `${String(file.name || 'foto').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

async function storePhoto(file, tour, placementId) {
  if (file.size > 15e6) {
    toast(`${file.name}: zu groß (höchstens 15 MB).`)
    return null
  }
  const f = await shrink(file)
  const ext = /png$/i.test(f.type) ? 'png' : 'jpg'
  const path = photoPath({ tour, placementId, date: todayISO(), n: nextPhotoNumber(tour, placementId), ext })
  const meta = { name: path.split('/').pop(), path, at: nowIso(), by: user(), size: f.size }
  BLOBS.set(path, f)
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, f)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, f, f.type || 'image/jpeg')
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`Foto nicht gespeichert: ${err.message}`)
    return null
  }
}

async function openPhoto(path) {
  const mem = BLOBS.get(path) || LOCAL.get(path)
  if (mem) return void window.open(URL.createObjectURL(mem), '_blank', 'noopener')
  const queued = await app.offline?.get?.('blobs', path)
  if (queued?.blob) return void window.open(URL.createObjectURL(queued.blob), '_blank', 'noopener')
  const photo = S.store?.tours().flatMap((t) => t.stops.flatMap((s) => (s.items || []).flatMap((it) => it.photos || []))).find((p) => p.path === path)
  if (photo?.local) return toast('Im Browser-Modus werden Fotos nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (photo?.url) return void window.open(photo.url, '_blank', 'noopener')
  const blob = await app.store?.readBlob?.(path).catch(() => null)
  if (!blob) return toast(photo?.queued ? 'Das Foto wartet noch im Gerät aufs Hochladen.' : 'Foto nicht gefunden.')
  window.open(URL.createObjectURL(blob), '_blank', 'noopener')
}

// ---------------------------------------------------------------- Dialog „Nicht möglich“

function notModal(c, m) {
  const tour = tourOf(m.tour)
  const p = placementsOf(stopOf(tour, m.stop)).find((x) => x.placementId === m.pl)
  if (!p) return ''
  const choices = NOT_POSSIBLE_REASONS.map((r, i) => `<label class="check mwf-choice"><input type="radio" name="mwf-not-reason" value="${esc(r)}" id="mwf-not-${i}"${m.reason === r ? ' checked' : ''}><span>${esc(r)}</span></label>`).join('')
  const other = m.reason && !NOT_POSSIBLE_REASONS.includes(m.reason) ? m.reason : ''
  return modalFrame({
    title: `Nicht möglich: ${p.placementName || 'Liegeplatz'}`,
    subtitle: esc(stopTitle(stopOf(tour, m.stop))),
    body: `<div class="mwf-modal"></div><fieldset class="mwf-choices"><legend>Warum?</legend>${choices}</fieldset>
      <label class="field"><span>Anderer Grund</span><input type="text" id="mwf-not-other" value="${esc(other)}" placeholder="z. B. Tor versperrt, kein Schlüssel" autocomplete="off"></label>
      <p class="note">Der Liegeplatz wird mit 0 Matten vermerkt; das Büro plant ihn neu ein.</p>`,
    foot: `<div class="actions"><button class="btn mwf-tap" data-action="close-modal">Abbrechen</button><button class="btn primary mwf-tap" data-action="mwf-not">Übernehmen</button></div>`,
  })
}
registerModal('mwf-not', notModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog „Stopp abschließen“ (P11)

function readFinish() {
  const m = app.ui.modal
  if (!m || m.type !== 'mwf-finish' || !document.getElementById('mwf-f-note')) return m
  m.note = document.getElementById('mwf-f-note').value
  const oc = document.querySelector('input[name="mwf-outcome"]:checked')
  if (oc) m.outcome = oc.value
  if (document.getElementById('mwf-f-name')) m.signer = document.getElementById('mwf-f-name').value
  if (document.getElementById('mwf-f-role')) m.role = document.getElementById('mwf-f-role').value
  if (document.getElementById('mwf-f-reason')) m.reason = document.getElementById('mwf-f-reason').value
  return m
}

function finishModal(c, m) {
  const tour = tourOf(m.tour)
  const stop = stopOf(tour, m.stop)
  if (!stop || isFinal(stop)) return ''
  const pls = placementsOf(stop)
  const open = pls.filter((p) => p.items.some((it) => (it.status || 'geplant') === 'geplant'))
  const rows = pls
    .map((p) => {
      const what = p.status === 'geplant' ? '<span class="pill">offen</span>' : p.status === 'nicht-moeglich' ? `<span class="pill error">nicht möglich</span> ${esc(p.reason)}` : `<span class="pill ok">gewechselt</span> ${p.actual} von ${p.planned}${p.deviation ? ` <span class="pill warning">Abweichung ${diffText(p.deviation)}</span>` : ''}`
      return `<li><strong>${esc(p.placementName || 'Liegeplatz')}</strong> ${what}</li>`
    })
    .join('')
  const outcomes = open.length
    ? `<fieldset class="mwf-choices"><legend>Noch offen: ${esc(open.map((p) => p.placementName).join(', '))}. Ausnahme wählen:</legend>${Object.entries(OUTCOMES)
        .map(([k, label]) => `<label class="check mwf-choice"><input type="radio" name="mwf-outcome" value="${k}" data-change="mwf-outcome"${m.outcome === k ? ' checked' : ''}><span>${esc(label)}</span></label>`)
        .join('')}<p class="note">Offene Liegeplätze werden als „nicht möglich“ vermerkt; das Büro plant sie neu ein.</p></fieldset>`
    : ''
  const reasons = `<datalist id="mwf-unsigned">${UNSIGNED_REASONS.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>`
  const sign = m.noSig
    ? `<label class="field"><span>Warum ohne Unterschrift?</span><input type="text" id="mwf-f-reason" list="mwf-unsigned" value="${esc(m.reason || '')}" placeholder="z. B. niemand vor Ort" autocomplete="off"></label>${reasons}`
    : `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="mwf-f-name" value="${esc(m.signer || '')}" placeholder="Vor- und Nachname" autocomplete="off"></label>
        <label class="field"><span>Funktion</span><input type="text" id="mwf-f-role" list="mwf-roles" value="${esc(m.role || '')}" placeholder="z. B. Hausbetreuung, Portier"></label>
      </div>
      <datalist id="mwf-roles">${SIGNER_ROLES.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>
      <p class="mwf-confirm">Mit der Unterschrift bestätigen Sie den Wechsel der oben angeführten Matten.</p>
      ${signatureField('mwf-sig', 'Unterschrift (mit dem Finger)')}`
  return modalFrame({
    title: 'Stopp abschließen',
    subtitle: `${esc(stopTitle(stop))}${stop.objectName ? ` · ${esc(stop.objectName)}` : ''}`,
    body: `<div class="mwf-modal"></div><ul class="mwf-sum">${rows}</ul>
      ${outcomes}
      <label class="field"><span>Bemerkung zum Stopp (optional)</span><textarea id="mwf-f-note" rows="2" placeholder="z. B. Hausbetreuung informiert">${esc(m.note ?? stop.note ?? '')}</textarea></label>
      <section class="mwf-signbox"><h3>${m.noSig ? 'Ohne Unterschrift abschließen' : 'Bestätigung durch Kunde oder Hausbetreuung (optional)'}</h3>${sign}</section>
      <p class="note">Nach dem Abschließen ist der Stopp fest; danach kommt der nächste offene Stopp. Ohne Netz bleibt alles im Gerät und wird nachgeholt.</p>`,
    foot: `<button class="btn ghost mwf-tap" data-action="mwf-nosig">${m.noSig ? 'Doch unterschreiben' : 'Ohne Unterschrift'}</button><div class="actions"><button class="btn mwf-tap" data-action="close-modal">Abbrechen</button><button class="btn primary mwf-tap" data-action="mwf-finish">${m.noSig ? 'Abschließen' : 'Unterschreiben und abschließen'}</button></div>`,
  })
}
registerModal('mwf-finish', finishModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog „Korrigieren“ (Büro)

function reopenModal(c, m) {
  const tour = tourOf(m.tour)
  const stop = stopOf(tour, m.stop)
  if (!stop) return ''
  const problem = reopenProblem(stop)
  return modalFrame({
    title: 'Stopp korrigieren (Büro)',
    subtitle: esc(stopTitle(stop)),
    body: problem
      ? `<div class="mwf-modal"></div><p>${esc(problem)}</p>`
      : `<div class="mwf-modal"></div><p>Der Stopp wird wieder geöffnet; Mengen und Liegeplätze lassen sich ändern, danach neu abschließen. Der bisherige Abschluss (Status, Unterschrift bzw. Grund, Zeitpunkt) bleibt in der Tour nachvollziehbar.</p>
      <label class="field"><span>Grund der Korrektur</span><input type="text" id="mwf-r-reason" value="${esc(m.reason || '')}" placeholder="z. B. Menge laut Anruf des Kunden" autocomplete="off"></label>`,
    foot: `<div class="actions"><button class="btn mwf-tap" data-action="close-modal">Abbrechen</button>${problem ? '' : '<button class="btn primary mwf-tap" data-action="mwf-reopen">Wieder öffnen</button>'}</div>`,
  })
}
registerModal('mwf-reopen', reopenModal, { module: 'matten' })

// ---------------------------------------------------------------- Aktionen

const ids = (el) => ({ tour: el.dataset.tour || app.ui.mwfTour || '', stop: el.dataset.stop || app.ui.mwfStop || '', pl: el.dataset.pl || '' })
const top = () => globalThis.scrollTo?.({ top: 0 })

registerActions({
  'mwf-open': (el) => {
    Object.assign(app.ui, { mwfTour: el.dataset.tour, mwfStop: '' })
    renderNow()
    top()
  },
  'mwf-back': () => {
    Object.assign(app.ui, { mwfTour: '', mwfStop: '' })
    renderNow()
    top()
  },
  'mwf-stop': (el) => {
    Object.assign(app.ui, { mwfTour: el.dataset.tour, mwfStop: el.dataset.stop })
    renderNow()
    top()
  },
  'mwf-back-tour': () => {
    app.ui.mwfStop = ''
    renderNow()
    top()
  },
  'mwf-refresh': async (el) => {
    el.disabled = true
    await sync()
    await ensureLoaded({ force: true })
    el.disabled = false
    renderNow()
    const st = S.store
    toast(st?.offline ? 'Kein Netz: Touren aus dem Gerät.' : 'Touren aktualisiert.')
  },
  'mwf-sync': async () => {
    await sync()
    const st = S.store
    toast(st?.pendingPaths().length ? (st.offline ? 'Noch kein Netz: bleibt im Gerät und wird später gesendet.' : st.error || 'Noch nicht gesendet.') : 'Alles gesendet.')
  },
  // Link zu Google Maps öffnet sich selbst; hier nur vermerken, dass der Fahrer zum Stopp unterwegs ist
  'mwf-nav': (el) => {
    const tour = tourOf(el.dataset.tour)
    const stop = stopOf(tour, el.dataset.stop)
    if (!stop || !canWork(tour) || isFinal(stop) || (stop.status && stop.status !== 'geplant')) return
    change(tour.id, (t, o) => setStopStatus(t, stop.id, 'unterwegs', o))
  },
  'mwf-photo-open': (el) => openPhoto(el.dataset.path),
})

registerActions(
  {
    'mwf-start': async (el) => {
      const t = await change(el.dataset.tour, (x, o) => startTour(x, o))
      if (t) toast(`Tour gestartet${S.store.offline ? ' (wartet auf Netz)' : ''}. Gute Fahrt!`)
    },
    'mwf-arrive': (el) => {
      const { tour, stop } = ids(el)
      change(tour, (t, o) => setStopStatus(t, stop, 'in-bearbeitung', o))
    },
    'mwf-done': (el) => {
      const { tour, stop, pl } = ids(el)
      change(tour, (t, o) => confirmPlacement(t, stop, pl, o))
    },
    'mwf-qty': (el) => {
      const { tour, stop } = ids(el)
      change(tour, (t, o) => changeQuantity(t, stop, Number(el.dataset.i), Number(el.dataset.d), o))
    },
    'mwf-reset': (el) => {
      const { tour, stop, pl } = ids(el)
      change(tour, (t, o) => resetPlacement(t, stop, pl, o))
    },
    'mwf-not-open': (el) => openModal({ type: 'mwf-not', ...ids(el), reason: '' }),
    'mwf-not': () => {
      const m = app.ui.modal
      const other = document.getElementById('mwf-not-other')?.value.trim() || ''
      const picked = document.querySelector('input[name="mwf-not-reason"]:checked')?.value || ''
      const reason = other || picked
      if (!reason) return toast('Bitte einen Grund wählen oder eintragen.')
      closeModal()
      change(m.tour, (t, o) => markNotPossible(t, m.stop, m.pl, reason, o))
    },
    'mwf-note': (el) => {
      const { tour, stop, pl } = ids(el)
      change(tour, (t, o) => setPlacementNote(t, stop, pl, el.value, o))
    },
    'mwf-photo': async (el) => {
      const files = [...(el.files || [])]
      el.value = ''
      if (!files.length) return
      const { tour: id, stop, pl } = ids(el)
      for (const file of files) {
        const tour = tourOf(id)
        if (!tour) return
        const photo = await storePhoto(file, tour, pl)
        if (!photo) continue
        await change(id, (t, o) => addPlacementPhoto(t, stop, pl, photo, o))
        toast(photo.queued ? 'Foto im Gerät: wird hochgeladen, sobald wieder Netz da ist.' : 'Foto gespeichert.')
      }
    },
    'mwf-photo-del': (el) => {
      const { tour, stop, pl } = ids(el)
      change(tour, (t, o) => removePlacementPhoto(t, stop, pl, el.dataset.path, o))
    },
    'mwf-finish-open': (el) => {
      const { tour, stop } = ids(el)
      const s = stopOf(tourOf(tour), stop)
      // auf dem Handy getippte, noch nicht übernommene Bemerkungen zuerst speichern
      for (const ta of document.querySelectorAll('textarea[data-change="mwf-note"]')) if (ta === document.activeElement) ta.blur()
      clearSignatures('mwf-')
      openModal({ type: 'mwf-finish', tour, stop, noSig: false, outcome: '', signer: '', role: '', reason: '', note: s?.note || '' })
    },
    'mwf-outcome': () => {
      const m = readFinish()
      if (m.outcome === 'nicht-angetroffen' && !m.noSig) Object.assign(m, { noSig: true, reason: m.reason || OUTCOMES['nicht-angetroffen'] })
      renderModal()
    },
    'mwf-nosig': () => {
      const m = readFinish()
      m.noSig = !m.noSig
      renderModal()
    },
    'mwf-finish': async (el) => {
      const m = readFinish()
      const tour = tourOf(m.tour)
      const stop = stopOf(tour, m.stop)
      if (!stop) return closeModal()
      const signature = m.noSig ? null : { name: m.signer || '', role: m.role || '', svg: signatureSvg('mwf-sig') }
      const problem = finishProblem(stop, { signature, reason: m.reason, outcome: m.outcome || '' })
      if (problem) return toast(problem)
      el.disabled = true
      const next = await change(tour.id, (t, o) => finishStop(t, stop.id, { signature, reason: m.reason, outcome: m.outcome || '', note: m.note, now: o.now, by: o.by, driverId: t.driverId }))
      el.disabled = false
      if (!next) return
      clearSignatures('mwf-')
      closeModal()
      const after = nextOpenStop(next, stop.id)
      app.ui.mwfStop = after?.id || ''
      renderNow()
      top()
      const wait = S.store?.offline ? ' Wartet auf Netz, wird nachgeholt.' : ''
      toast(after ? `Stopp abgeschlossen. Weiter: ${stopTitle(after)}.${wait}` : `Stopp abgeschlossen – alle Stopps der Tour sind erledigt.${wait}`)
    },
  },
  { edit: MODULE },
)

registerActions(
  {
    'mwf-reopen-open': (el) => openModal({ type: 'mwf-reopen', ...ids(el), reason: '' }),
    'mwf-reopen': async () => {
      const m = app.ui.modal
      const reason = document.getElementById('mwf-r-reason')?.value.trim() || ''
      if (!reason) return toast('Bitte den Grund der Korrektur angeben.')
      const t = await change(m.tour, (x, o) => reopenStop(x, m.stop, { reason, ...o }))
      if (!t) return
      closeModal()
      renderNow()
      toast('Stopp wieder geöffnet. Nach der Korrektur neu abschließen.')
    },
  },
  { edit: 'matten' },
)
