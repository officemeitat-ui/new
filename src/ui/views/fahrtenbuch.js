// Reiter „Fahrtenbuch“ in Fahrzeuge & Reifen (views/vehicles.js): Vorschläge je Fahrzeug und Tag aus Touren im
// Mattenwechsel, Winterdienst-Protokoll und Dienstplan der festen Fahrer/innen bestätigen (km-Stand am Ende), Fahrten
// von Hand eintragen, ändern (mit Protokoll), stornieren (mit Grund), Lücken im km-Stand, Privat-km im Jahresschnitt,
// CSV. Rechenkern core/fahrtenbuch.js; Ablage fahrzeuge/fahrtenbuch/<Jahr>.json (YEAR_DOCS, erst hier geladen).

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { cancelTrip, changeText, dismissTrip, editTrip, FB_KINDS, FB_SOURCES, fahrtenbuchCsv, fmtKm, kmSums, LATE_DAYS, lastKm, makeTrip, PRIVATE_LIMIT, privateAverage, suggestTrips, tripChecks, tripsIn, visitsFromPlan, visitsFromTours, visitsFromWinter } from '../../core/fahrtenbuch.js'
import { addKm, currentKm, kmFits } from '../../core/vehicle-dues.js'
import { ACTIONS, app, canEdit, closeModal, computeRange, confirmStep, memo, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { onToursChanged, tourStore } from '../matten-tourablage.js'
import { invalidateTodo, registerTodo } from '../modals/todo.js'
import { download, esc, ICON, menu, modalFrame, options, rowMenu, uid, val } from '../shared.js'

const MODULE = 'fahrzeuge'
const KEY = 'fahrtenbuch'
const editable = () => canEdit(MODULE)
const userName = () => app.user?.name || ''
const vehicles = () => (app.data.fahrzeuge?.vehicles || []).filter((v) => !v.inactive)
const vehOf = (id) => (app.data.fahrzeuge?.vehicles || []).find((v) => v.id === id)
const trips = () => (app.data.fahrtenbuch ||= [])
const plate = (id) => vehOf(id)?.plate || '–'
const kmIn = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','))
const newId = () => uid('fb')

export const fbMonth = () => (/^\d{4}-\d{2}$/.test(app.ui.fbMonth || '') ? app.ui.fbMonth : todayISO().slice(0, 7))
function monthSpan(m = fbMonth()) {
  const from = `${m}-01`
  const next = Number(m.slice(5, 7)) === 12 ? `${Number(m.slice(0, 4)) + 1}-01-01` : `${m.slice(0, 4)}-${String(Number(m.slice(5, 7)) + 1).padStart(2, '0')}-01`
  return { from, to: addDays(next, -1) }
}
const shiftMonth = (m, d) => {
  const n = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + d
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/** Wochen des Monats für Dienstplan und Winterdienst (registerView range in vehicles.js). */
export const fbRange = () => monthSpan()

// ---------------------------------------------------------------- Laden (Fahrtenbuch je Jahr, Touren)

const yearOf = (m = fbMonth()) => m.slice(0, 4)
const yearReady = (y = yearOf()) => !app.service?.yearLoaded || app.service.yearLoaded(KEY, y)
let loading = null
function ensureYear(y = yearOf()) {
  if (yearReady(y) || loading === y || !app.service?.ensureYears) return
  loading = y
  app.service
    .ensureYears(KEY, [y])
    .catch((err) => toast(`Fahrtenbuch konnte nicht gelesen werden: ${err.message}`))
    .finally(() => {
      loading = null
      invalidateTodo()
      if (app.ui.view === 'fahrzeuge' && app.ui.vehTab === 'fahrtenbuch' && !app.ui.modal) renderNow()
    })
}

// Touren nur, wenn die Rolle sie lesen darf (Ordner matten/touren/)
const toursReadable = () => !app.service?.rights?.read || app.service.rights.read('matten/touren/2026/x.json')
const tourTried = new Map()
function toursOf(y) {
  const s = toursReadable() ? tourStore() : null
  if (!s) return []
  if (!s.yearLoaded(y) && !s.yearLoading(y) && Date.now() - (tourTried.get(y) || 0) > 60_000) {
    tourTried.set(y, Date.now())
    s.load({ years: [y] }).catch(() => {})
  }
  return s.tours().filter((t) => String(t?.date || '').startsWith(y))
}
let toursVersion = 0
onToursChanged(() => {
  toursVersion++
  if (app.ui.view === 'fahrzeuge' && app.ui.vehTab === 'fahrtenbuch' && !app.ui.modal) renderNow()
})

// ---------------------------------------------------------------- Vorschläge

function winterEntries(from, to) {
  return Object.entries(app.data.winterlog || {})
    .filter(([k]) => k.slice(0, 10) >= from && k.slice(0, 10) <= to)
    .map(([k, e]) => ({ ...e, id: e.id || k, date: e.date || k.slice(0, 10), objectId: e.objectId || k.split('|')[1] }))
}

/** Vorschläge des Monats (bis heute). */
export const fbSuggestions = (m = fbMonth()) => suggestionsFor(monthSpan(m))

/** Vorschläge von from bis to (höchstens bis heute); Touren des Jahres von from. */
function suggestionsFor({ from, to }) {
  const today = todayISO()
  if (from > today) return []
  const m = from.slice(0, 7)
  return memo(app.cur, `fb:sug:${from}:${to}:${today}:${toursVersion}:${trips().length}:${JSON.stringify(trips().map((t) => [t.suggestion, !!t.cancelled]).filter((x) => x[0]))}`, () => {
    const vs = vehicles()
    const drivers = new Set(vs.map((v) => v.driverId).filter(Boolean))
    const last = to < today ? to : today
    const r = drivers.size ? computeRange(from, last) : null
    const plan = r
      ? r.instances
          .filter((i) => i.status !== 'cancelled')
          .map((i) => ({ key: i.key, date: i.date, start: i.startTime, objectId: i.objectId, status: i.status, empIds: r.state.assigned(i.key).map((a) => a.employeeId) }))
          .filter((i) => i.empIds.some((e) => drivers.has(e)))
      : []
    const visits = [
      ...visitsFromTours(toursOf(yearOf(m)).filter((t) => t.date >= from && t.date <= last)),
      ...visitsFromWinter(winterEntries(from, last), { employees: app.data.employees, objects: app.data.objects }),
      ...visitsFromPlan(plan, { objects: app.data.objects, employees: app.data.employees, drivers }),
    ]
    return suggestTrips({ visits, vehicles: vs, trips: trips(), from, to: last, today })
  })
}

// ---------------------------------------------------------------- Ansicht

export function fahrtenbuchView() {
  const m = fbMonth()
  const { from, to } = monthSpan(m)
  ensureYear(yearOf(m))
  const ready = yearReady(yearOf(m))
  const vehId = vehicles().some((v) => v.id === app.ui.fbVehicle) ? app.ui.fbVehicle : ''
  const nav = `<div class="toolbar filters-bar fb-bar">
      <div class="seg" role="group" aria-label="Monat"><button class="btn small" data-action="fb-month" data-v="${esc(shiftMonth(m, -1))}" aria-label="Voriger Monat">‹</button><strong class="fb-month">${esc(monthLabel(m))}</strong><button class="btn small" data-action="fb-month" data-v="${esc(shiftMonth(m, 1))}" aria-label="Nächster Monat">›</button></div>
      <label class="field inline"><span>Fahrzeug</span><select data-change="fb-vehicle" aria-label="Fahrzeug">${options([['', 'Alle Fahrzeuge'], ...vehicles().map((v) => [v.id, [v.plate, v.label].filter(Boolean).join(' · ')])], vehId)}</select></label>
      <div class="actions">${editable() && ready ? `<button class="btn" data-action="fb-new-open">${ICON.plus} Fahrt eintragen</button>` : ''}${
        app.config.features.download
          ? menu({ label: 'Export', icon: ICON.download, single: false, items: [{ label: `Fahrtenbuch ${monthLabel(m)} (CSV)`, icon: ICON.download, action: 'fb-csv', data: { span: 'month' }, mail: true }, { label: `Ganzes Jahr ${yearOf(m)} (CSV)`, icon: ICON.download, action: 'fb-csv', data: { span: 'year' }, mail: true }] })
          : ''
      }</div></div>`
  if (!ready) return `${nav}<p class="muted">Fahrtenbuch ${esc(yearOf(m))} wird geladen …</p>`

  const sug = fbSuggestions(m).filter((s) => !vehId || s.vehicleId === vehId)
  const list = tripsIn(trips(), { from, to, vehicleId: vehId })
  const sums = kmSums(list)
  const vs = vehId ? [vehOf(vehId)] : [...new Set([...list.map((t) => t.vehicleId), ...sug.map((s) => s.vehicleId)])].map(vehOf).filter(Boolean)
  const checks = vs.flatMap((v) => tripChecks(trips(), v.id).filter((c) => c.date >= from && c.date <= to).map((c) => ({ ...c, v })))
  const priv = vs.map((v) => ({ v, ...privateAverage(trips(), v.id, m) })).filter((p) => p.privateKm > 0)

  const sugRows = sug
    .map(
      (s) => `<tr class="${s.late ? 'late' : ''}"><td>${formatDate(s.date)}${s.late ? `<br><span class="flag warning" title="älter als ${LATE_DAYS} Tage">nachtragen</span>` : ''}</td><td><strong>${esc(plate(s.vehicleId))}</strong><br><span class="muted">${esc(s.driver || '')}</span></td>
        <td>${esc(s.route)}<br><span class="muted">${esc(s.purpose)} · ${esc([...new Set(s.sources.map((x) => FB_SOURCES[x.kind]))].join(', '))}</span></td>
        <td class="num">${s.kmPlan ? `ca. ${esc(fmtKm(s.kmPlan))}` : '–'}${s.kmUnsure ? '<br><span class="muted small">ohne alle Adressen</span>' : ''}</td>
        <td class="actions-cell">${editable() ? `<button class="btn small primary" data-action="fb-confirm-open" data-key="${esc(s.key)}">${ICON.check} Bestätigen</button> <button class="btn small" data-action="fb-dismiss" data-key="${esc(s.key)}">${app.ui.confirm === `fb-dis:${s.key}` ? 'Wirklich nicht gefahren?' : 'Nicht gefahren'}</button>` : ''}</td></tr>`,
    )
    .join('')
  const tripRows = list
    .map((t) => {
      const marks = [t.cancelled ? `<span class="pill error">storniert: ${esc(t.cancelled.reason)}</span>` : '', t.history?.length ? `<span class="pill info">geändert (${t.history.length})</span>` : '', t.kmEstimated ? '<span class="pill warning">km geschätzt</span>' : ''].filter(Boolean).join(' ')
      return `<tr class="${t.cancelled ? 'cancelled' : ''}"><td>${formatDate(t.date)}</td><td><strong>${esc(plate(t.vehicleId))}</strong><br><span class="muted">${esc(t.driver || '')}</span></td>
        <td>${esc(t.route || '')}<br><span class="muted">${esc(FB_KINDS[t.kind] || '')}${t.purpose && t.purpose !== FB_KINDS[t.kind] ? ` · ${esc(t.purpose)}` : ''}</span>${marks ? `<br>${marks}` : ''}</td>
        <td class="num">${t.kmStart !== null && t.kmStart !== undefined ? `${esc(kmIn(t.kmStart))} → ${esc(kmIn(t.kmEnd))}` : '–'}</td><td class="num"><strong>${esc(kmIn(t.km))}</strong></td>
        <td class="actions-cell">${editable() && !t.cancelled ? rowMenu([{ label: 'Ändern', icon: ICON.gear, action: 'fb-edit-open', data: { id: t.id } }, { label: 'Stornieren', icon: ICON.close, action: 'fb-cancel-open', data: { id: t.id } }], `Fahrt ${formatDate(t.date)} ${plate(t.vehicleId)}`) : t.history?.length ? `<button class="btn small" data-action="fb-edit-open" data-id="${esc(t.id)}">Verlauf</button>` : ''}</td></tr>`
    })
    .join('')
  return `${nav}
    <div class="summary">
      <div class="stat ${sug.length ? 'warn' : ''}"><div class="label">Zum Bestätigen</div><div class="value">${sug.length}</div><div class="muted">${sug.filter((s) => s.late).length ? `${sug.filter((s) => s.late).length} älter als ${LATE_DAYS} Tage` : 'Vorschläge bis heute'}</div></div>
      <div class="stat"><div class="label">Fahrten</div><div class="value">${sums.count}</div><div class="muted">${esc(monthLabel(m))}</div></div>
      <div class="stat"><div class="label">Dienstlich</div><div class="value">${esc(fmtKm(sums.dienst))}</div><div class="muted">von ${esc(fmtKm(sums.total))}</div></div>
      <div class="stat"><div class="label">Privat</div><div class="value">${esc(fmtKm(sums.privat + sums.weg))}</div><div class="muted">${sums.weg ? `davon ${esc(fmtKm(sums.weg))} Wohnung–Arbeit` : 'inkl. Wohnung–Arbeit'}</div></div>
    </div>
    ${
      sug.length
        ? `<section><h3>Zum Bestätigen</h3><p class="muted small">Aus Mattenwechsel-Touren, Winterdienst-Protokoll und Dienstplan der festen Fahrer/innen, je Fahrzeug und Tag. Start und Ende: Betriebshof der Tour bzw. Abstellort des Fahrzeugs. Beim Bestätigen den km-Stand am Ende eintragen.</p>
      <div class="table-wrap"><table class="data fb-table"><thead><tr><th>Datum</th><th>Fahrzeug</th><th>Strecke und Zweck</th><th class="num">km laut Plan</th><th></th></tr></thead><tbody>${sugRows}</tbody></table></div></section>`
        : ''
    }
    <section><h3>Fahrten ${esc(monthLabel(m))}</h3>
      <div class="table-wrap"><table class="data fb-table"><thead><tr><th>Datum</th><th>Fahrzeug</th><th>Strecke, Art und Zweck</th><th class="num">km-Stand</th><th class="num">km</th><th></th></tr></thead><tbody>${tripRows || '<tr><td colspan="6" class="muted">Noch keine Fahrten in diesem Monat.</td></tr>'}</tbody></table></div></section>
    ${checks.length ? `<section><h3>Prüfung</h3>${checks.map((c) => `<p class="check ${c.level === 'info' ? '' : c.level}">${c.level === 'error' ? '⚠ ' : ''}<strong>${esc(c.v.plate)}</strong> ${formatDate(c.date)}: ${esc(c.text)}</p>`).join('')}</section>` : ''}
    ${priv.length ? `<section><h3>Privatfahrten im Jahresschnitt</h3>${priv.map((p) => `<p class="check ${p.over ? 'warning' : ''}"><strong>${esc(p.v.plate)}</strong>: ${esc(fmtKm(p.privateKm))} in ${p.months} ${p.months === 1 ? 'Monat' : 'Monaten'} = ${esc(fmtKm(p.perMonth))} je Monat ${p.over ? `– über ${PRIVATE_LIMIT} km (voller Sachbezug)` : `– bis ${PRIVATE_LIMIT} km (halber Sachbezug möglich)`}</p>`).join('')}</section>` : ''}
    <p class="note">Ein Fahrtenbuch zählt nur, wenn es laufend geführt wird: Datum, km-Stand, Strecke und Zweck je Fahrt. Bestätigte Fahrten werden nicht gelöscht; Änderungen und Stornos bleiben mit Zeit und Person sichtbar. Privatfahrten und Fahrten Wohnung–Arbeitsstätte zählen für den Sachbezug – bitte mit der Steuerberatung abstimmen.</p>`
}

/** Offene Vorschläge (für die Zahl am Reiter), ohne zu laden. */
export function fbOpenCount() {
  if (!yearReady()) return 0
  try {
    return fbSuggestions().length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------- Dialoge

function tripModal(c, m) {
  const t = m.id ? trips().find((x) => x.id === m.id) : null
  const s = m.key ? fbSuggestions().find((x) => x.key === m.key) : null
  const d = m.draft || {}
  const vehicleId = t?.vehicleId || s?.vehicleId || d.vehicleId || app.ui.fbVehicle || vehicles()[0]?.id || ''
  const date = d.date ?? t?.date ?? s?.date ?? todayISO()
  const prev = lastKm(trips().filter((x) => x.id !== t?.id), vehicleId, addDays(date, -1))
  const kmStart = d.kmStart ?? (t ? kmIn(t.kmStart) : prev !== null ? kmIn(prev) : '')
  const ro = !!t?.cancelled || !editable()
  const field = (id, label, value, attrs = '') => `<label class="field"><span>${label}</span><input id="${id}" value="${esc(value ?? '')}" ${attrs} ${ro ? 'disabled' : ''}></label>`
  const hist = (t?.history || []).map((h) => `<li>${esc(String(h.at).slice(0, 16).replace('T', ' '))} ${esc(h.by || '')}: ${esc(changeText(h.changes))}</li>`).join('')
  return modalFrame({
    title: t ? `Fahrt ${formatDate(t.date)} ${plate(t.vehicleId)}` : s ? 'Fahrt bestätigen' : 'Fahrt eintragen',
    subtitle: s ? `Vorschlag aus ${[...new Set(s.sources.map((x) => FB_SOURCES[x.kind]))].join(', ')}${s.kmPlan ? ` · laut Plan ca. ${fmtKm(s.kmPlan)}` : ''}` : t ? `bestätigt ${String(t.confirmedAt || '').slice(0, 10)} ${t.confirmedBy || ''}` : 'z. B. Privatfahrt oder Fahrt ohne Vorschlag',
    body: `<div class="form-grid">
        <label class="field"><span>Fahrzeug</span><select id="fb-veh" ${t || s || ro ? 'disabled' : ''}>${options(vehicles().map((v) => [v.id, [v.plate, v.label].filter(Boolean).join(' · ')]), vehicleId)}</select></label>
        ${field('fb-date', 'Datum', date, `type="date" ${s ? 'disabled' : ''}`)}
        <label class="field"><span>Art</span><select id="fb-kind" ${ro ? 'disabled' : ''}>${options(Object.entries(FB_KINDS), d.kind ?? t?.kind ?? 'dienst')}</select></label>
        ${field('fb-driver', 'Fahrer/in', d.driver ?? t?.driver ?? s?.driver ?? '')}
      </div>
      ${field('fb-route', 'Strecke (von – über – nach)', d.route ?? t?.route ?? s?.route ?? '', 'placeholder="Betriebshof – Objekt – Betriebshof"')}
      ${field('fb-purpose', 'Zweck', d.purpose ?? t?.purpose ?? s?.purpose ?? '', 'placeholder="z. B. Reinigung Objekt, Materialeinkauf"')}
      <div class="form-grid">
        ${field('fb-km-start', 'km-Stand Beginn', kmStart, 'inputmode="numeric"')}
        ${field('fb-km-end', 'km-Stand Ende', d.kmEnd ?? (t ? kmIn(t.kmEnd) : ''), 'inputmode="numeric" autofocus')}
        ${field('fb-km', 'oder gefahrene km', d.km ?? (t && (t.kmStart === null || t.kmStart === undefined) ? kmIn(t.km) : ''), 'inputmode="decimal"')}
      </div>
      <p class="note">${prev !== null && !t ? `Letzter km-Stand von ${esc(plate(vehicleId))}: ${esc(kmIn(prev))}. ` : ''}Mit km-Stand am Beginn und Ende rechnet die App die km selbst${s?.kmPlan ? `; ohne km-Stand gilt die Schätzung laut Plan (wird als „geschätzt“ markiert)` : ''}.${t ? ' Änderungen werden mit Zeit und Person festgehalten.' : ''}</p>
      ${hist ? `<h4>Änderungen</h4><ul class="fb-history">${hist}</ul>` : ''}
      ${t?.cancelled ? `<p class="check error">Storniert ${esc(String(t.cancelled.at).slice(0, 10))} von ${esc(t.cancelled.by || '')}: ${esc(t.cancelled.reason)}</p>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">${ro ? 'Schließen' : 'Abbrechen'}</button><div class="actions">${ro ? '' : `<button class="btn primary" data-action="fb-save">${t ? 'Änderung speichern' : s ? 'Bestätigen' : 'Speichern'}</button>`}</div>`,
  })
}
registerModal('fb-trip', tripModal, { module: MODULE })

registerModal(
  'fb-cancel',
  (c, m) => {
    const t = trips().find((x) => x.id === m.id)
    return modalFrame({
      title: 'Fahrt stornieren',
      subtitle: t ? `${formatDate(t.date)} ${plate(t.vehicleId)} · ${t.route || ''}` : '',
      body: `<label class="field"><span>Grund</span><input id="fb-reason" autofocus placeholder="z. B. doppelt erfasst, falsches Fahrzeug"></label><p class="note">Die Fahrt bleibt mit Grund im Fahrtenbuch sichtbar und zählt nicht mehr mit. Ein Vorschlag für diesen Tag kommt zurück.</p>`,
      foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn danger" data-action="fb-cancel-save">Stornieren</button></div>',
    })
  },
  { module: MODULE },
)

function readForm() {
  return { vehicleId: val('fb-veh'), date: val('fb-date'), kind: val('fb-kind'), driver: val('fb-driver'), route: val('fb-route'), purpose: val('fb-purpose'), kmStart: val('fb-km-start'), kmEnd: val('fb-km-end'), km: val('fb-km') }
}

/** Passt der km-Stand am Ende zu den km-Ständen des Fahrzeugs (Service, Werkstatt)? Sonst Text der Warnung. */
function kmWarning(trip) {
  const v = vehOf(trip.vehicleId)
  if (!v || trip.kmEnd === null || trip.kmEnd === undefined || kmFits(v, trip.date, trip.kmEnd)) return ''
  const cur = currentKm(v)
  return `km-Stand ${kmIn(trip.kmEnd)} passt nicht zu den km-Ständen von ${v.plate}${cur ? ` (zuletzt ${kmIn(cur.km)} am ${formatDate(cur.date, { weekday: false, year: true })})` : ''}.`
}

/** km-Stand am Ende auch beim Fahrzeug (für Service nach km). */
function noteKm(trip) {
  const v = vehOf(trip.vehicleId)
  if (!v || trip.kmEnd === null || trip.kmEnd === undefined) return
  const next = addKm(v, trip.date, trip.kmEnd)
  if (next !== v) Object.assign(v, next)
}

// ---------------------------------------------------------------- Zu erledigen: Fahrten nicht zeitnah bestätigt

// Fenster: 3 Wochen zurück bis 8 Tage vor heute (älter als LATE_DAYS). Das Fahrtenbuch des Jahres wird dafür im
// Hintergrund gelesen (eine kleine Datei), die Wochen des Dienstplans nicht: ungeladene Wochen bringen keine Vorschläge.
registerTodo({
  id: 'fahrtenbuch',
  module: MODULE,
  title: 'Fahrtenbuch',
  compute: (today) => {
    if (!vehicles().length) return []
    const from = addDays(today, -21)
    const to = addDays(today, -(LATE_DAYS + 1))
    const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])]
    if (!years.every((y) => yearReady(y))) {
      years.forEach((y) => ensureYear(y))
      return []
    }
    const late = suggestionsFor({ from, to }).filter((s) => s.late)
    return late.length ? [{ id: `late:${late.map((s) => s.key).join(',')}`, list: late }] : []
  },
  render: (items) =>
    items
      .map(
        (it) =>
          `<div class="todo-item"><span class="flag warning">${it.list.length}</span><div class="todo-text"><strong>Fahrtenbuch: ${it.list.length} ${it.list.length === 1 ? 'Fahrt' : 'Fahrten'} älter als ${LATE_DAYS} Tage nicht bestätigt</strong><br><span class="muted">${esc([...new Set(it.list.map((s) => plate(s.vehicleId)))].join(', '))} · ab ${formatDate(it.list[0].date)}</span></div><button class="btn small primary" data-action="fb-goto" data-month="${esc(it.list[0].date.slice(0, 7))}">Bestätigen</button></div>`,
      )
      .join(''),
})

// ---------------------------------------------------------------- Aktionen

registerActions({
  'fb-goto': (el) => {
    app.ui.vehTab = 'fahrtenbuch'
    app.ui.fbMonth = el.dataset.month || ''
    // wie ein Klick im Menü (schließt „Zu erledigen“, Adresse, Wochen laden)
    ACTIONS.view({ dataset: { view: 'fahrzeuge' } })
  },
  'fb-month': (el) => {
    app.ui.fbMonth = el.dataset.v
    app.ui.confirm = null
    renderNow()
  },
  'fb-vehicle': (el) => {
    app.ui.fbVehicle = el.value
    renderNow()
  },
  'fb-new-open': () => openModal({ type: 'fb-trip' }),
  'fb-confirm-open': (el) => openModal({ type: 'fb-trip', key: el.dataset.key }),
  'fb-edit-open': (el) => openModal({ type: 'fb-trip', id: el.dataset.id }),
  'fb-cancel-open': (el) => openModal({ type: 'fb-cancel', id: el.dataset.id }),
  'fb-dismiss': (el) => {
    if (!editable()) return
    const s = fbSuggestions().find((x) => x.key === el.dataset.key)
    if (!s || !confirmStep(`fb-dis:${s.key}`)) return
    trips().push(dismissTrip(s, { by: userName(), newId }))
    persist()
    toast(`${plate(s.vehicleId)} am ${formatDate(s.date)}: als „nicht gefahren“ vermerkt.`)
    renderNow()
  },
  'fb-save': () => {
    const m = app.ui.modal
    if (m?.type !== 'fb-trip' || !editable()) return
    const input = readForm()
    m.draft = input
    if (!yearReady(String(input.date || '').slice(0, 4))) {
      ensureYear(String(input.date || '').slice(0, 4))
      return toast('Das Fahrtenbuch dieses Jahres wird noch geladen – bitte gleich nochmals speichern.')
    }
    if (m.id) {
      const i = trips().findIndex((x) => x.id === m.id)
      const res = editTrip(trips()[i], input, { by: userName() })
      if (res.error) return toast(res.error)
      if (res.trip === trips()[i]) {
        closeModal()
        return toast('Nichts geändert.')
      }
      const warnEdit = kmWarning(res.trip)
      if (warnEdit && !confirmStep(`fb-km:${res.trip.id}:${res.trip.kmEnd}`, renderModal)) return toast(`${warnEdit} Nochmals speichern, um ihn trotzdem zu übernehmen.`)
      trips()[i] = res.trip
      noteKm(res.trip)
      persist()
      closeModal()
      toast(`Fahrt geändert: ${changeText(res.changes)}.`)
      return renderNow()
    }
    const s = m.key ? fbSuggestions().find((x) => x.key === m.key) : null
    if (m.key && !s) {
      closeModal()
      return toast('Dieser Vorschlag ist schon erledigt.')
    }
    const res = makeTrip(s ? { ...input, vehicleId: s.vehicleId, date: s.date } : input, { suggestion: s, by: userName(), newId })
    if (res.error) return toast(res.error)
    const warn = kmWarning(res.trip)
    if (warn && !confirmStep(`fb-km:${res.trip.vehicleId}:${res.trip.date}:${res.trip.kmEnd}`, renderModal)) return toast(`${warn} Nochmals speichern, um ihn trotzdem zu übernehmen.`)
    trips().push(res.trip)
    noteKm(res.trip)
    persist()
    closeModal()
    toast(`${plate(res.trip.vehicleId)} ${formatDate(res.trip.date)}: ${fmtKm(res.trip.km)} ${res.trip.kmEstimated ? '(geschätzt) ' : ''}eingetragen.`)
    renderNow()
  },
  'fb-cancel-save': () => {
    const m = app.ui.modal
    if (m?.type !== 'fb-cancel' || !editable()) return
    const i = trips().findIndex((x) => x.id === m.id)
    if (i < 0) return closeModal()
    const res = cancelTrip(trips()[i], val('fb-reason'), { by: userName() })
    if (res.error) return toast(res.error)
    trips()[i] = res.trip
    persist()
    closeModal()
    toast('Fahrt storniert – sie bleibt mit Grund sichtbar.')
    renderNow()
  },
  'fb-csv': (el) => {
    const m = fbMonth()
    const span = el.dataset.span === 'year' ? { from: `${yearOf(m)}-01-01`, to: `${yearOf(m)}-12-31` } : monthSpan(m)
    const vehId = app.ui.fbVehicle || ''
    const list = tripsIn(trips(), { ...span, vehicleId: vehId })
    if (!list.length) return toast('Keine Fahrten im Zeitraum.')
    const name = `Fahrtenbuch_${vehId ? plate(vehId).replace(/[^\w-]+/g, '') + '_' : ''}${el.dataset.span === 'year' ? yearOf(m) : m}.csv`
    download(name, new Blob([fahrtenbuchCsv(list, app.data.fahrzeuge?.vehicles || [])], { type: 'text/csv;charset=utf-8' }))
  },
})
