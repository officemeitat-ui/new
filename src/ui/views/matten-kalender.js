// Mattenwechsel-Modul, Planung (docs/MATTENWECHSEL-PLAN.md P7): „Matten-Kalender“ für das Büro. Einsätze planen und
// speichern (je Jahr eine Datei matten/einsaetze-<Jahr>.json, YEAR_DOCS in storage/data-service.js), Woche und Monat,
// je Tag die Einsätze nach Gebiet → Objekt mit Status, Matten je Größe und Ladeliste; Verschieben, Aussetzen,
// Nachholen und Verwerfen je Einsatz und für mehrere markierte; Betriebsurlaub für alle Liegeplätze. Überfällige und
// nachzuholende stehen oben als Hinweisliste. Am Handy ist der Kalender eine Tagesliste. Je Tag „Touren planen“
// (views/matten-planung.js); Einsätze einer freigegebenen Tour stehen als „in Tour (Fahrer)“ da.
// Rechenkern: core/matten-einsaetze.js (mit dem Fälligkeitsrechner core/matten-plan.js). Fahrer sehen das nicht.
// Aktionen und Dialoge mit dem Kürzel „mw-“.

import { addDays, formatDate, isoWeek, MONTH_LONG, todayISO, WEEKDAY_SHORT } from '../../core/dates.js'
import {
  actionProblem,
  applyJobAction,
  applyPauses,
  attention,
  calendarView,
  canApply,
  closuresProblem,
  confirmedExchanges,
  DISPLAY,
  displayStatus,
  hintList,
  JOB_ACTIONS,
  mergeJobs,
  normalizeClosures,
  PLAN_WEEKS,
  planJobs,
  planRange,
  planSettings,
  rangeProblem,
  resolveReview,
  untouredSoon,
  yearsFor,
} from '../../core/matten-einsaetze.js'
import { jobDate, SKIP_MODES } from '../../core/matten-plan.js'
import { emptyMatten, intervalText, upgradeMatten } from '../../core/matten.js'
import { tourYears } from '../../core/matten-touren.js'
import { app, canEdit, closeModal, memo, openModal, persist, registerActions, registerModal, registerView, render, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { esc, ICON, menu, modalFrame, options, tabBar, val } from '../shared.js'
import { startWebPolling } from '../matten-webspace.js'
import { inTourText, toursReady } from './matten-planung.js'
import { ensureOverviewTours, mattenState, publish as publishOverview } from './matten-uebersicht.js'

const MODULE = 'matten'
const KEY = 'mattenJobs'
const ICON_CAL = '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/><rect x="7" y="13" width="10" height="4" rx="1"/>'
const MOBILE_CAL = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="4.5" y="9" width="7" height="2.6" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'

const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const jobsAll = () => (app.data[KEY] ||= [])
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const objects = () => app.data.objects || []
const placementOf = (id) => doc().placements.find((p) => p.id === id) || null
const objName = (id) => objects().find((o) => o.id === id)?.name || 'Objekt fehlt'
const short = (d) => (d ? formatDate(d) : '–')
const shortYear = (d) => (d ? formatDate(d, { year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
/** Bestätigte Wechsel: vorerst der letzte aus der Übernahme; die Touren des Moduls kommen mit der Phase Fahrer dazu. */
const done = () => confirmedExchanges({ placements: doc().placements, tours: [] })
/** Status als Farbe und Text; ein Einsatz einer freigegebenen Tour zeigt den Fahrer: „in Tour (Anna)“. */
const pill = (status, job = null) => `<span class="mw-st st-${esc(status)}">${esc(status === 'in-tour' && job ? inTourText(job) : DISPLAY[status] || status)}</span>`
/** Lässt sich der Einsatz im Kalender ändern (sonst kein Kästchen zum Markieren)? */
const changeable = (job, today = todayISO()) => Object.keys(JOB_ACTIONS).some((a) => canApply(a, job, today))
const placementLabel = (p) => (p ? `${p.name}${p.floor ? ` (${p.floor})` : ''}` : 'Liegeplatz gelöscht')

// ---------------------------------------------------------------- Jahre laden (eine Datei je Jahr)

const tried = new Set()
/** Sind die Dateien der Jahre für den Zeitraum geladen? Fehlende werden im Hintergrund geholt (danach neu zeichnen). */
function yearsReady(von, bis) {
  const s = app.service
  if (!s?.ensureYears) return true
  const miss = yearsFor(von, bis).filter((y) => !s.yearLoaded(KEY, y))
  const todo = miss.filter((y) => !tried.has(y))
  if (todo.length) {
    todo.forEach((y) => tried.add(y))
    s.ensureYears(KEY, todo)
      .then(() => renderNow())
      .catch(() => {})
  }
  return !miss.length
}
/** Vor dem Planen: alle nötigen Jahre laden (wartet). */
const loadYears = (von, bis) => app.service?.ensureYears?.(KEY, yearsFor(von, bis)) ?? Promise.resolve(false)

// ---------------------------------------------------------------- Rechnen (je Datenstand gemerkt)

const mode = () => (app.ui.mwCalMode === 'monat' ? 'monat' : 'woche')
const calDate = () => app.ui.mwCalDate || todayISO()
const areaFilter = () => app.ui.mwCalArea || ''
const selected = () => (app.ui.mwSel ||= [])

function jobsShown() {
  const area = areaFilter()
  if (!area) return jobsAll()
  const ids = new Set(doc().placements.filter((p) => (p.areaId || '') === area).map((p) => p.id))
  return jobsAll().filter((j) => ids.has(j.placementId))
}

const calAt = (m, d, area, today) => memo(app.cur, `mwcal:${m}:${d}:${area}:${today}`, () => calendarView({ jobs: jobsShown(), placements: doc().placements, objects: objects(), areas: doc().areas, today, mode: m, date: d }))
const hintsAt = (today) => memo(app.cur, `mwhints:${today}`, () => hintList(jobsAll(), { placements: doc().placements, today }))
/**
 * Zu erledigen und digitaler Mitarbeiter: überfällige Liegeplätze, nicht geplante Einsätze der nächsten 14 Tage. Sind die
 * Touren gelesen, mit deren Ergebnissen (views/matten-uebersicht.js, mattenState): Einsätze in einer offenen Tour und
 * nicht durchgeführte Wechsel zählen dann nicht als überfällig (die nicht durchgeführten stehen als eigener Punkt da).
 */
export const mattenAttention = (today = todayISO()) => {
  const s = mattenState(today)
  return s.toursLoaded ? { ...s.attention, overdue: s.overdue } : memo(app.cur, `mwatt:${today}`, () => attention({ doc: doc(), jobs: jobsAll(), done: done(), today }))
}

// ---------------------------------------------------------------- Ansicht

function kalenderView() {
  const ed = editable()
  const today = todayISO()
  const m = mode()
  const date = calDate()
  const settings = planSettings(doc())
  const head = `<div class="section-head"><div><h2>Matten-Kalender</h2><p>Die Einsätze des Mattenwechsels je Tag, nach Gebiet und Objekt: welche Liegeplätze, wie viele Matten, was aufgeladen wird. Verschieben, Aussetzen und Nachholen ändern nur den einzelnen Termin, der Rhythmus bleibt.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="mw-plan-open">${ICON.calendar} Einsätze planen</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        ed && { label: 'Betriebsurlaub und Schließtage', icon: ICON.gear, action: 'mw-closures-open', hint: settings.closures.length ? plural(settings.closures.length, 'Eintrag', 'Einträge') : 'für alle Liegeplätze' },
        { label: 'Liegeplätze', icon: ICON.list, action: 'view', data: { view: 'mw-liegeplaetze' }, hint: 'Intervall, Pausen, Starttermin' },
      ],
    })}</div></div>`
  if (!doc().placements.some((p) => p.active !== false))
    return `${head}<div class="banner welcome"><p><strong>Noch keine Liegeplätze.</strong> Der Kalender zeigt die Einsätze der Liegeplätze. Zuerst unter „Matten-Liegeplätze“ die Liegeplätze mit Intervall und Starttermin anlegen, dann hier „Einsätze planen“.</p><button class="btn" data-action="view" data-view="mw-liegeplaetze">Liegeplätze</button></div>`
  const cal = calAt(m, date, areaFilter(), today)
  const ready = yearsReady(cal.from, cal.to)
  // Einsätze in einer Tour: Fahrer aus den Touren (im Hintergrund gelesen)
  if (cal.days.some((d) => d.counts['in-tour'])) toursReady(tourYears(cal.from, cal.to))
  return `${head}${hintsBlock(today)}${planBanner(cal, settings, ed)}${toolbar(cal, m)}
    ${ready ? '' : '<p class="note">Einsätze eines weiteren Jahres werden geladen …</p>'}
    ${m === 'monat' ? monthBlock(cal, today) : weekBlock(cal, today, ed)}
    ${legend()}${selectionBar(ed)}`
}

function hintsBlock(today) {
  const h = hintsAt(today)
  if (!h.overdue.length && !h.catchUp.length) return ''
  const row = ({ job, placement }) => {
    const p = placement
    const late = jobDate(job) < today
    return `<li><button class="mw-hint-btn" data-action="mw-job-open" data-key="${esc(job.key)}">${pill(late ? 'ueberfaellig' : job.status === 'nicht-durchgefuehrt' ? 'nicht-durchgefuehrt' : 'nachzuholen')} <strong>${esc(placementLabel(p))}</strong> <span class="muted">${esc(p ? objName(p.objectId) : '')} · ${late ? `seit ${esc(short(jobDate(job)))}` : `am ${esc(short(jobDate(job)))}`}${job.reason ? ` · ${esc(job.reason)}` : ''}</span></button></li>`
  }
  const list = [...h.overdue, ...h.catchUp]
  return `<section class="mw-hints" aria-label="Überfällig und nachzuholen"><h3>${[h.overdue.length ? plural(h.overdue.length, 'Einsatz überfällig', 'Einsätze überfällig') : '', h.catchUp.length ? `${h.catchUp.length} nachzuholen` : ''].filter(Boolean).join(', ')}</h3>
    <ul>${list.slice(0, 12).map(row).join('')}</ul>${list.length > 12 ? `<p class="muted">… und ${list.length - 12} weitere</p>` : ''}</section>`
}

function planBanner(cal, settings, ed) {
  if (!jobsAll().length)
    return `<div class="banner welcome"><p><strong>Noch keine Einsätze gespeichert.</strong> „Einsätze planen“ legt die Wechsel der nächsten ${PLAN_WEEKS} Wochen aus Starttermin, Intervall und Regel der Liegeplätze an. Erneutes Planen ergänzt nur, was fehlt.</p>${ed ? `<button class="btn primary" data-action="mw-plan-open">${ICON.calendar} Einsätze planen</button>` : ''}</div>`
  // geplant bis: letzter Lauf von „Einsätze planen“, sonst der späteste gespeicherte Solltermin
  const until = settings.planning?.bis || jobsAll().reduce((m, j) => (j.due > m ? j.due : m), '')
  if (cal.to <= until) return ''
  return `<p class="note mw-plan-note">Geplant bis ${esc(shortYear(until))}${cal.from > until ? '; für diesen Zeitraum stehen noch keine Einsätze im Kalender' : '; danach fehlen die Einsätze noch'}.${ed ? ' <button class="btn small" data-action="mw-plan-open">Einsätze planen</button>' : ''}</p>`
}

function toolbar(cal, m) {
  const title = m === 'monat' ? `${MONTH_LONG[Number(cal.month.slice(5)) - 1]} ${cal.month.slice(0, 4)}` : `KW ${isoWeek(cal.monday).week} · ${formatDate(cal.from, { weekday: false })} bis ${formatDate(cal.to, { weekday: false, year: true })}`
  const areas = (doc().areas || []).filter((a) => a.active !== false).map((a) => [a.id, a.name])
  return `<div class="mw-cal-bar">
    ${tabBar({ action: 'mw-cal-mode', current: m, tabs: [{ id: 'woche', label: 'Woche' }, { id: 'monat', label: 'Monat' }] })}
    <div class="mw-cal-nav"><button class="btn icon" data-action="mw-cal-nav" data-step="-1" aria-label="${m === 'monat' ? 'Voriger Monat' : 'Vorige Woche'}" title="${m === 'monat' ? 'Voriger Monat' : 'Vorige Woche'}">${ICON.left}</button>
      <button class="btn small" data-action="mw-cal-nav" data-step="0">Heute</button>
      <button class="btn icon" data-action="mw-cal-nav" data-step="1" aria-label="${m === 'monat' ? 'Nächster Monat' : 'Nächste Woche'}" title="${m === 'monat' ? 'Nächster Monat' : 'Nächste Woche'}">${ICON.right}</button>
      <h3 class="mw-cal-title">${esc(title)}</h3></div>
    ${areas.length ? `<label class="field inline"><span>Gebiet</span><select id="mw-cal-area" data-change="mw-cal-area">${options(areas, areaFilter(), { empty: 'alle' })}</select></label>` : ''}
  </div>`
}

/** Betriebsurlaub an diesem Tag (Einstellungen des Moduls) als kleiner Vermerk, sonst ''. */
function closureTag(d) {
  const c = planSettings(doc()).closures.find((x) => x.from <= d && d <= (x.to || x.from))
  return c ? ` <span class="mw-st st-ausgesetzt">${esc(c.reason || 'Betriebsurlaub')}</span>` : ''
}

const dayTitle = (d) => `${WEEKDAY_SHORT[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} ${formatDate(d, { weekday: false })}`

function loadBox(day) {
  if (!day.load.length) return ''
  return `<aside class="mw-load" aria-label="Ladeliste ${esc(dayTitle(day.date))}"><h4>Ladeliste</h4><ul>${day.load.map((r) => `<li><b>${r.qty}</b> × ${esc(r.label)}${r.kunde ? ` <span class="muted">(davon ${r.kunde} Kundeneigentum)</span>` : ''}</li>`).join('')}</ul><p class="muted">zusammen ${plural(day.mats, 'Matte', 'Matten')}</p></aside>`
}

function jobItem(it, ed, date) {
  const { job, placement: p, status } = it
  const mats = (p?.mats || []).map((m) => `${m.qty} × ${m.size ? `${m.size}${m.color ? `, ${m.color}` : ''}` : m.name || 'Matte'}`).join(', ')
  const sel = selected().includes(job.key)
  const label = `${placementLabel(p)} am ${dayTitle(date)}`
  const extra = [job.planned && job.planned !== job.due ? `Solltermin ${short(job.due)}` : '', job.reason || ''].filter(Boolean).join(' · ')
  return `<li class="mw-job st-${esc(status)}">${ed && changeable(job) ? `<label class="mw-check"><input type="checkbox" data-change="mw-sel" data-key="${esc(job.key)}" ${sel ? 'checked' : ''} aria-label="${esc(label)} markieren"></label>` : ''}
    <button class="mw-job-btn" data-action="mw-job-open" data-key="${esc(job.key)}"><span class="mw-job-name">${esc(placementLabel(p))}</span> ${pill(status, job)}${mats ? `<small>${esc(mats)}</small>` : ''}${extra ? `<small class="muted">${esc(extra)}</small>` : ''}</button></li>`
}

function groupsHtml(day, ed) {
  return day.groups
    .map(
      (g) => `<div class="mw-area"><h4>${esc(g.name)}</h4><div class="mw-area-objs">${g.objects
        .map((o) => {
          const sum = o.load.map((r) => `${r.qty} × ${r.size || r.label}`).join(', ')
          return `<div class="mw-cal-obj"><div class="mw-cal-obj-head"><strong>${esc(o.name)}</strong> <span class="muted">${plural(o.placements, 'Liegeplatz', 'Liegeplätze')}${sum ? ` · ${esc(sum)}` : ''}</span></div>
            <ul class="mw-jobs">${o.items.map((it) => jobItem(it, ed, day.date)).join('')}</ul></div>`
        })
        .join('')}</div></div>`,
    )
    .join('')
}

function weekBlock(cal, today, ed) {
  const days = cal.days
    .map((day) => {
      const isToday = day.date === today
      const keys = day.groups.flatMap((g) => g.objects.flatMap((o) => o.items.filter((it) => changeable(it.job, today)).map((it) => it.job.key)))
      const all = keys.length && keys.every((k) => selected().includes(k))
      const info = day.jobs ? `${plural(day.jobs, 'Einsatz', 'Einsätze')} · ${plural(day.objects, 'Objekt', 'Objekte')}${day.mats ? ` · ${plural(day.mats, 'Matte', 'Matten')}` : ''}` : 'keine Einsätze'
      const moved = day.moved.length ? `<p class="mw-moved muted">Verschoben: ${day.moved.map(({ job, placement }) => `${esc(placementLabel(placement))} → ${esc(short(jobDate(job)))}`).join(', ')}</p>` : ''
      return `<section class="mw-day ${day.weekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${day.jobs ? '' : 'empty'}" data-date="${day.date}" aria-label="${esc(dayTitle(day.date))}">
        <header><h3>${esc(dayTitle(day.date))}${isToday ? ' <span class="pill info">heute</span>' : ''}${closureTag(day.date)}</h3><span class="muted">${info}</span>${ed && keys.length ? `<label class="mw-check-day"><input type="checkbox" data-change="mw-sel-day" data-date="${day.date}" ${all ? 'checked' : ''}><span>alle</span></label>` : ''}${ed && (day.open || day.counts['in-tour']) && day.date >= today ? `<button class="btn small mw-tp-link" data-action="mw-tp-goto" data-date="${day.date}" aria-label="Touren planen am ${esc(dayTitle(day.date))}">Touren planen</button>` : ''}</header>
        ${day.jobs || moved ? `<div class="mw-day-body">${groupsHtml(day, ed)}${moved}</div>` : ''}${loadBox(day)}</section>`
    })
    .join('')
  return `<div class="mw-week">${days}</div>`
}

function monthBlock(cal, today) {
  const heads = WEEKDAY_SHORT.map((d) => `<div class="mw-mhead" aria-hidden="true">${d}</div>`).join('')
  const order = ['ueberfaellig', 'nachzuholen', 'nicht-durchgefuehrt', 'verschoben', 'geplant', 'in-tour', 'ausgesetzt', 'erledigt', 'teilweise']
  const cells = cal.days
    .map((day) => {
      const chips = order.filter((s) => day.counts[s]).map((s) => `<span class="mw-st st-${s}">${day.counts[s]} ${esc(DISPLAY[s])}</span>`).join('')
      const cls = ['mw-mday', day.inMonth ? '' : 'out', day.jobs ? '' : 'empty', day.weekend ? 'weekend' : '', day.date === today ? 'today' : ''].filter(Boolean).join(' ')
      return `<button class="${cls}" data-action="mw-cal-day" data-date="${day.date}" aria-label="${esc(dayTitle(day.date))}: ${day.jobs ? esc(plural(day.jobs, 'Einsatz', 'Einsätze')) : 'keine Einsätze'}">
        <span class="mw-mdate">${esc(dayTitle(day.date))}${closureTag(day.date)}</span>${chips ? `<span class="mw-mchips">${chips}</span>` : ''}${day.jobs ? `<span class="mw-msum muted">${plural(day.objects, 'Objekt', 'Objekte')}${day.mats ? ` · ${plural(day.mats, 'Matte', 'Matten')}` : ''}</span>` : ''}</button>`
    })
    .join('')
  const any = cal.days.some((d) => d.inMonth && d.jobs)
  return `<div class="mw-month">${heads}${cells}</div>${any ? '' : '<p class="empty mw-month-empty">Keine Einsätze in diesem Monat.</p>'}<p class="note">Einen Tag antippen zeigt die Woche mit allen Einsätzen und der Ladeliste.</p>`
}

function legend() {
  return `<p class="mw-legend" aria-label="Farben">${['geplant', 'verschoben', 'in-tour', 'ueberfaellig', 'nachzuholen', 'ausgesetzt', 'erledigt'].map((x) => pill(x)).join(' ')}</p>`
}

function selectionBar(ed) {
  const keys = selected().filter((k) => jobsAll().some((j) => j.key === k))
  if (!ed || !keys.length) return ''
  return `<div class="mw-selbar" role="region" aria-label="Markierte Einsätze"><strong>${plural(keys.length, 'Einsatz', 'Einsätze')} markiert</strong>
    ${Object.entries(JOB_ACTIONS)
      .map(([id, a]) => `<button class="btn small" data-action="mw-job-open" data-act="${id}">${esc(a.label)} …</button>`)
      .join('')}<button class="btn small ghost" data-action="mw-sel-clear">Auswahl aufheben</button></div>`
}

registerView({
  id: 'mw-kalender',
  order: 75.55,
  label: 'Matten-Kalender',
  group: 'service',
  module: MODULE,
  icon: ICON_CAL,
  noWeek: true,
  mobile: { icon: MOBILE_CAL, label: 'Kalender' },
  text: 'Mattenwechsel: Einsätze planen, Woche und Monat, verschieben, aussetzen, nachholen',
  badge: () => mattenAttention().overdue.length,
  render: kalenderView,
})

// ---------------------------------------------------------------- Dialog Einsatz (einer oder mehrere)

function jobsOf(keys) {
  const want = new Set(keys)
  return jobsAll().filter((j) => want.has(j.key))
}

function jobModal(c, m) {
  const ed = editable()
  const today = todayISO()
  const list = jobsOf(m.keys || [])
  if (!list.length) return modalFrame({ title: 'Einsatz', body: '<p class="muted">Diesen Einsatz gibt es nicht mehr.</p>', foot: '<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>' })
  const fits = (act) => list.filter((j) => canApply(act, j, today)).length
  const acts = Object.keys(JOB_ACTIONS).filter((a) => fits(a))
  const act = acts.includes(m.act) ? m.act : acts[0] || ''
  const one = list.length === 1 ? list[0] : null
  const p = one ? placementOf(one.placementId) : null
  const details = one
    ? `<dl class="mw-dl">
        <dt>Status</dt><dd>${pill(displayStatus(one, today), one)}${one.reason ? ` <span class="muted">${esc(one.reason)}</span>` : ''}${one.status === 'in-tour' ? ` <button class="btn small" data-action="mw-tp-goto" data-date="${esc(jobDate(one))}">Tour ansehen</button>` : ''}</dd>
        <dt>Objekt</dt><dd>${esc(p ? objName(p.objectId) : '–')}${p?.customer?.name ? ` <span class="muted">(${esc(p.customer.name)})</span>` : ''}</dd>
        <dt>Matten</dt><dd>${esc((p?.mats || []).map((x) => `${x.qty} × ${x.name || 'Matte'}${x.owner === 'kunde' ? ' (Kunde)' : ''}`).join(', ') || '–')}</dd>
        <dt>Solltermin</dt><dd>${esc(shortYear(one.due))}${p ? ` <span class="muted">${esc(intervalText(p.intervalDays))}</span>` : ''}</dd>
        ${one.planned && one.planned !== one.due ? `<dt>verschoben auf</dt><dd>${esc(shortYear(one.planned))}</dd>` : ''}
        ${one.doneOn ? `<dt>gewechselt am</dt><dd>${esc(shortYear(one.doneOn))}</dd>` : ''}
        ${p?.access ? `<dt>Zugang</dt><dd>${esc(p.access)}</dd>` : ''}
        ${p?.window?.from || p?.window?.note ? `<dt>Zeitfenster</dt><dd>${esc([p.window.from && p.window.to ? `${p.window.from} bis ${p.window.to}` : '', p.window.note].filter(Boolean).join(', '))}</dd>` : ''}
        <dt>angelegt</dt><dd class="muted">${esc([one.createdBy, one.createdAt ? shortYear(one.createdAt.slice(0, 10)) : ''].filter(Boolean).join(', ') || '–')}${one.updatedBy ? ` · geändert ${esc(one.updatedBy)}, ${esc(shortYear(String(one.updatedAt || '').slice(0, 10)))}` : ''}</dd>
      </dl>`
    : `<ul class="mw-job-list">${list
        .slice(0, 30)
        .map((j) => {
          const pl = placementOf(j.placementId)
          return `<li>${pill(displayStatus(j, today), j)} ${esc(placementLabel(pl))} <span class="muted">${esc(pl ? objName(pl.objectId) : '')} · ${esc(short(jobDate(j)))}</span></li>`
        })
        .join('')}${list.length > 30 ? `<li class="muted">… und ${list.length - 30} weitere</li>` : ''}</ul>`
  if (!ed || !act)
    return modalFrame({
      title: one ? `Einsatz: ${placementLabel(p)}` : plural(list.length, 'Einsatz', 'Einsätze'),
      subtitle: one ? esc(`${short(jobDate(one))}${p ? ` · ${objName(p.objectId)}` : ''}`) : '',
      body: `${details}${ed ? '<p class="note">Erledigte Einsätze und Einsätze in einer Tour ändert der Kalender nicht. Einsätze in einer Tour ändert „Touren planen“ (dort zuerst die Freigabe zurücknehmen).</p>' : ''}`,
      foot: '<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>',
    })
  const a = JOB_ACTIONS[act]
  const n = fits(act)
  const first = list.find((j) => canApply(act, j, today))
  const dateDefault = m.date ?? (act === 'verschieben' ? (jobDate(first) >= today ? jobDate(first) : today) : today)
  const placeholder = act === 'aussetzen' ? 'z. B. Kunde geschlossen, Umbau' : act === 'verwerfen' ? 'z. B. Kunde hat gekündigt' : 'optional, z. B. Wunsch des Kunden'
  return modalFrame({
    title: one ? `Einsatz: ${placementLabel(p)}` : plural(list.length, 'Einsatz', 'Einsätze'),
    subtitle: one ? esc(`${short(jobDate(one))}${p ? ` · ${objName(p.objectId)}` : ''}`) : '',
    body: `${details}
      ${tabBar({ action: 'mw-job-act', current: act, tabs: acts.map((id) => ({ id, label: JOB_ACTIONS[id].label })), cls: 'mw-job-tabs' })}
      <p class="muted">${esc(a.hint)}</p>
      <div class="form-grid">
        ${a.needs === 'date' ? `<label class="field"><span>${act === 'nachholen' ? 'Nachholen am' : 'Neuer Tag'}</span><input type="date" id="mw-job-date" min="${today}" value="${esc(dateDefault)}"></label>` : ''}
        <label class="field wide"><span>Grund${a.needs === 'reason' ? '' : ' (optional)'}</span><input type="text" id="mw-job-reason" value="${esc(m.reason ?? '')}" placeholder="${esc(placeholder)}"></label>
      </div>
      ${n < list.length ? `<p class="note">${n} von ${list.length} markierten Einsätzen passen dazu; die übrigen bleiben unverändert.</p>` : ''}`,
    foot: `<div class="actions">${one && one.planned && one.planned !== one.due && canApply('verschieben', one, today) && one.due >= today ? `<button class="btn ghost" data-action="mw-job-reset">Zurück auf den Solltermin</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="mw-job-save">${esc(a.label)}${n > 1 ? ` (${n})` : ''}</button></div>`,
  })
}
registerModal('mw-job', jobModal, { module: MODULE })

function readJobModal() {
  const m = app.ui.modal
  if (document.getElementById('mw-job-reason')) m.reason = val('mw-job-reason')
  if (document.getElementById('mw-job-date')) m.date = val('mw-job-date')
  return m
}

/** Geänderte Einsätze speichern (eine Liste je Jahr, YEAR_DOCS). */
function storeJobs(changed) {
  if (!changed.length) return
  app.data[KEY] = mergeJobs(jobsAll(), changed)
  persist()
}

function saveJobAction() {
  const m = readJobModal()
  const today = todayISO()
  const list = jobsOf(m.keys || [])
  const act = Object.keys(JOB_ACTIONS).filter((a) => list.some((j) => canApply(a, j, today))).includes(m.act) ? m.act : Object.keys(JOB_ACTIONS).find((a) => list.some((j) => canApply(a, j, today)))
  const input = { date: m.date || '', reason: m.reason || '', today }
  const problem = actionProblem(act, input)
  if (problem) return toast(problem)
  const r = applyJobAction(jobsAll(), m.keys, act, { ...input, now: nowIso(), by: user() })
  if (!r.changed.length) return toast('Kein markierter Einsatz passt zu dieser Aktion.')
  storeJobs(r.changed)
  app.ui.mwSel = selected().filter((k) => !r.changed.some((j) => j.key === k))
  closeModal()
  renderNow()
  const a = JOB_ACTIONS[act]
  toast(`${plural(r.changed.length, 'Einsatz', 'Einsätze')} ${a.verb}${a.needs === 'date' ? ` (${short(input.date)})` : ''}${r.skipped.length ? `; ${r.skipped.length} unverändert` : ''}.`)
}

// ---------------------------------------------------------------- Dialog „Einsätze planen“

function planModal(c, m) {
  const ed = editable()
  const today = todayISO()
  m.von ??= planRange(today).von
  m.bis ??= planRange(today).bis
  const s = planSettings(doc())
  const active = doc().placements.filter((p) => p.active !== false).length
  const r = m.result
  const weeks = m.von === today ? [4, 8, 12, 26].find((w) => m.bis === planRange(today, w).bis) : undefined
  const reviewRows = r?.review?.length
    ? `<ul class="mw-review">${r.review
        .slice(0, 20)
        .map((x) => `<li>${esc(placementLabel(x.placement))} <span class="muted">${esc(x.placement ? objName(x.placement.objectId) : '')} · ${esc(short(jobDate(x.job || { due: x.key.split(':').pop() })))}</span>: ${esc(x.text)}</li>`)
        .join('')}${r.review.length > 20 ? `<li class="muted">… und ${r.review.length - 20} weitere</li>` : ''}</ul>`
    : ''
  const result = r
    ? `<section class="mw-plan-result" aria-live="polite"><h3>Ergebnis</h3><p><strong>${r.counts.neu} neu</strong>, ${r.counts.unveraendert} unverändert, ${r.counts.pruefen} zur Prüfung${r.resolved ? ` (${r.resolved} angepasst)` : ''}</p>
        ${r.added?.length ? `<p class="muted">Neu: ${[['geplant', 'geplant'], ['nachzuholen', 'nachzuholen (Pause)'], ['ausgesetzt', 'ausgesetzt (Pause oder Betriebsurlaub)']].map(([k, t]) => [r.added.filter((j) => j.status === k).length, t]).filter(([n]) => n).map(([n, t]) => `${n} ${t}`).join(', ')}.</p>` : ''}
        ${reviewRows ? `<p>Diese geplanten Einsätze passen nicht mehr (Liegeplatz inaktiv oder gelöscht, Pause oder Betriebsurlaub am Termin):</p>${reviewRows}${ed && !r.resolved ? '<button class="btn" data-action="mw-plan-review">Anpassen: aussetzen bzw. nachholen, inaktive verwerfen</button>' : ''}` : ''}</section>`
    : ''
  return modalFrame({
    title: 'Einsätze planen',
    body: `<p>Legt die Wechsel aller aktiven Liegeplätze (${active}) im Zeitraum als Einsätze an: aus Starttermin, Intervall und Regel, mit Pausen und Betriebsurlaub. Vorhandene Einsätze bleiben wie sie sind – erneutes Planen erzeugt keine Doppel.</p>
      <div class="form-grid">
        <label class="field"><span>von</span><input type="date" id="mw-plan-von" value="${esc(m.von)}" ${ed ? '' : 'disabled'}></label>
        <label class="field"><span>bis</span><input type="date" id="mw-plan-bis" value="${esc(m.bis)}" ${ed ? '' : 'disabled'}></label>
        <label class="field"><span>Dauer</span><select id="mw-plan-weeks" data-change="mw-plan-weeks" ${ed ? '' : 'disabled'}>${options(
          [4, 8, 12, 26].map((w) => [String(w), `${w} Wochen ab heute`]),
          weeks ? String(weeks) : '',
          { empty: 'eigener Zeitraum' },
        )}</select></label>
      </div>
      <p class="muted">Pause oder Betriebsurlaub am Termin: ${esc(SKIP_MODES[s.skip])}${s.closures.length ? ` · Betriebsurlaub: ${esc(s.closures.map((x) => `${short(x.from)}${x.to !== x.from ? `–${short(x.to)}` : ''}${x.reason ? ` ${x.reason}` : ''}`).join(', '))}` : ''}${ed ? ' · <button class="btn small ghost" data-action="mw-closures-open">ändern</button>' : ''}</p>
      ${s.planning?.bis ? `<p class="muted">Zuletzt geplant: ${esc(shortYear(s.planning.von))} bis ${esc(shortYear(s.planning.bis))}${s.planning.by ? `, ${esc(s.planning.by)}` : ''}.</p>` : ''}
      ${result}`,
    foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">${r ? 'Schließen' : 'Abbrechen'}</button>${ed ? `<button class="btn ${r ? '' : 'primary'}" data-action="mw-plan-run">${r ? 'Noch einmal planen' : 'Einsätze planen'}</button>` : ''}${r ? '<button class="btn primary" data-action="mw-plan-show">Im Kalender ansehen</button>' : ''}</div>`,
  })
}
registerModal('mw-plan', planModal, { module: MODULE })

function readPlan() {
  const m = app.ui.modal
  if (document.getElementById('mw-plan-von')) {
    m.von = val('mw-plan-von')
    m.bis = val('mw-plan-bis')
  }
  return m
}

async function runPlan(el) {
  const m = readPlan()
  const problem = rangeProblem(m.von, m.bis)
  if (problem) return toast(problem)
  if (el) el.disabled = true
  try {
    await loadYears(m.von, m.bis)
  } catch (err) {
    return toast(`Einsätze konnten nicht geladen werden: ${err.message}`)
  } finally {
    if (el) el.disabled = false
  }
  const now = nowIso()
  const r = planJobs({ doc: doc(), jobs: jobsAll(), done: done(), von: m.von, bis: m.bis, now, by: user() })
  if (r.added.length) app.data[KEY] = r.jobs
  const s = (doc().settings ||= {})
  const prev = s.planning
  // gemerkt wird der weiteste geplante Zeitraum (für den Hinweis „noch nicht geplant“ im Kalender)
  s.planning = { von: m.von, bis: prev?.bis && prev.bis > m.bis && prev.von <= m.von ? prev.bis : m.bis, at: now, by: user() }
  persist()
  m.result = { counts: r.counts, added: r.added, review: r.review }
  app.ui.mwCalDate = m.von
  renderNow()
  toast(`Einsätze geplant: ${r.counts.neu} neu, ${r.counts.unveraendert} unverändert, ${r.counts.pruefen} zur Prüfung.`)
}

// ---------------------------------------------------------------- Dialog Betriebsurlaub

function closuresDraft(m) {
  if (!m.rows) {
    const s = planSettings(doc())
    m.rows = structuredClone(s.closures).map((c) => ({ ...c, mode: c.mode || '' }))
    m.skip = s.skip
  }
  return m
}
function readClosures() {
  const m = closuresDraft(app.ui.modal)
  m.rows = m.rows.map((r, i) => (document.getElementById(`mw-cl-from-${i}`) ? { from: val(`mw-cl-from-${i}`), to: val(`mw-cl-to-${i}`), reason: val(`mw-cl-reason-${i}`), mode: val(`mw-cl-mode-${i}`) } : r))
  if (document.getElementById('mw-cl-skip')) m.skip = val('mw-cl-skip')
  return m
}

registerModal(
  'mw-closures',
  (c, m) => {
    const ed = editable()
    const dis = ed ? '' : 'disabled'
    const d = closuresDraft(m)
    const modes = [['', 'wie unten eingestellt'], ...Object.entries(SKIP_MODES)]
    const rows = d.rows
      .map(
        (r, i) => `<div class="mw-pause-row mw-cl-row">
        <label class="field"><span>von</span><input type="date" id="mw-cl-from-${i}" value="${esc(r.from)}" ${dis}></label>
        <label class="field"><span>bis</span><input type="date" id="mw-cl-to-${i}" value="${esc(r.to)}" ${dis}></label>
        <label class="field"><span>Grund</span><input type="text" id="mw-cl-reason-${i}" value="${esc(r.reason)}" placeholder="z. B. Betriebsurlaub Weihnachten" ${dis}></label>
        <label class="field"><span>Wechsel</span><select id="mw-cl-mode-${i}" ${dis}>${options(modes, r.mode || '')}</select></label>
        ${ed ? `<button class="btn small ghost" data-action="mw-closures-del" data-i="${i}" title="Eintrag entfernen" aria-label="Eintrag entfernen">${ICON.trash}</button>` : ''}
      </div>`,
      )
      .join('')
    return modalFrame({
      title: 'Betriebsurlaub und Schließtage',
      wide: true,
      body: `<p>Gilt für alle Liegeplätze. Eine Pause nur eines Liegeplatzes (z. B. Umbau beim Kunden) steht im Dialog des Liegeplatzes.</p>
        ${rows || '<p class="muted">Noch kein Betriebsurlaub eingetragen.</p>'}${ed ? `<button class="btn small" data-action="mw-closures-add">${ICON.plus} Betriebsurlaub</button>` : ''}
        <div class="form-grid mw-block"><label class="field wide"><span>Fällt ein Wechsel in eine Pause oder in den Betriebsurlaub</span><select id="mw-cl-skip" ${dis}>${options(Object.entries(SKIP_MODES), d.skip)}</select><small class="muted">„nachholen“: am ersten freien Tag danach, beim festen Rhythmus nur vor dem nächsten regulären Wechsel.</small></label></div>
        <p class="note">Beim Speichern passt die App schon geplante Einsätze ab heute an. Wird ein Betriebsurlaub wieder entfernt, bleiben ausgesetzte Einsätze ausgesetzt; im Kalender lassen sie sich nachholen.</p>`,
      foot: `<div class="actions"></div><div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="mw-closures-save">Speichern</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

function saveClosures() {
  const m = readClosures()
  const closures = normalizeClosures(m.rows)
  const problem = closuresProblem(closures)
  if (problem) return toast(problem)
  const s = (doc().settings ||= {})
  s.closures = closures
  s.skip = SKIP_MODES[m.skip] ? m.skip : 'entfaellt'
  const changed = applyPauses(jobsAll(), { doc: doc(), from: todayISO(), now: nowIso(), by: user() })
  storeJobs(changed)
  persist()
  closeModal()
  renderNow()
  const skipped = changed.filter((j) => j.status === 'ausgesetzt').length
  toast(`Betriebsurlaub gespeichert.${changed.length ? ` ${plural(changed.length, 'geplanter Einsatz', 'geplante Einsätze')} angepasst (${skipped} ausgesetzt, ${changed.length - skipped} nachzuholen).` : ''}`)
}

// ---------------------------------------------------------------- Aktionen

const go = async (patch) => {
  Object.assign(app.ui, patch)
  if (app.ui.view !== 'mw-kalender') {
    app.ui.view = 'mw-kalender'
    await render()
  } else renderNow()
}

registerActions({
  // aus „Zu erledigen“, dem digitalen Mitarbeiter und der Suche: Kalender öffnen (plan: gleich „Einsätze planen“)
  'mw-cal-goto': async (el) => {
    if (app.ui.modal) closeModal()
    await go({ mwCalDate: el.dataset.date || todayISO(), mwCalMode: el.dataset.mode || mode() })
    if (el.dataset.plan && editable()) openModal({ type: 'mw-plan' })
  },
  'mw-cal-mode': (el) => go({ mwCalMode: el.dataset.v === 'monat' ? 'monat' : 'woche' }),
  'mw-cal-nav': (el) => {
    const step = Number(el.dataset.step) || 0
    if (!step) return go({ mwCalDate: todayISO() })
    const d = calDate()
    if (mode() === 'monat') {
      const [y, mo] = d.slice(0, 7).split('-').map(Number)
      const t = new Date(Date.UTC(y, mo - 1 + step, 1))
      return go({ mwCalDate: t.toISOString().slice(0, 10) })
    }
    go({ mwCalDate: addDays(d, 7 * step) })
  },
  'mw-cal-area': () => go({ mwCalArea: val('mw-cal-area') }),
  'mw-cal-day': (el) => {
    go({ mwCalMode: 'woche', mwCalDate: el.dataset.date })
    globalThis.requestAnimationFrame?.(() => document.querySelector(`.mw-day[data-date="${el.dataset.date}"]`)?.scrollIntoView?.({ block: 'start' }))
  },
  'mw-sel': (el) => {
    const k = el.dataset.key
    const set = new Set(selected())
    if (el.checked) set.add(k)
    else set.delete(k)
    app.ui.mwSel = [...set]
    renderNow()
  },
  'mw-sel-day': (el) => {
    const cal = calAt(mode(), calDate(), areaFilter(), todayISO())
    const day = cal.days.find((d) => d.date === el.dataset.date)
    const keys = (day?.groups || []).flatMap((g) => g.objects.flatMap((o) => o.items.filter((it) => changeable(it.job)).map((it) => it.job.key)))
    const set = new Set(selected())
    for (const k of keys) el.checked ? set.add(k) : set.delete(k)
    app.ui.mwSel = [...set]
    renderNow()
  },
  'mw-sel-clear': () => {
    app.ui.mwSel = []
    renderNow()
  },
  'mw-job-open': (el) => openModal({ type: 'mw-job', keys: el.dataset.key ? [el.dataset.key] : [...selected()], act: el.dataset.act || '' }),
  'mw-job-act': (el) => {
    const m = readJobModal()
    if (m.act !== el.dataset.v) delete m.date
    m.act = el.dataset.v
    renderModal()
  },
  'mw-plan-open': () => openModal({ type: 'mw-plan' }),
  'mw-plan-weeks': () => {
    const m = readPlan()
    const w = Number(val('mw-plan-weeks'))
    if (w) Object.assign(m, planRange(todayISO(), w))
    renderModal()
  },
  'mw-plan-show': () => {
    const von = app.ui.modal?.von
    closeModal()
    go({ mwCalDate: von || todayISO(), mwCalMode: 'woche' })
  },
  'mw-closures-open': () => openModal({ type: 'mw-closures' }),
})

registerActions(
  {
    'mw-job-save': () => saveJobAction(),
    'mw-job-reset': () => {
      const m = app.ui.modal
      const j = jobsOf(m.keys || [])[0]
      if (!j) return
      const r = applyJobAction(jobsAll(), [j.key], 'verschieben', { date: j.due, today: todayISO(), now: nowIso(), by: user() })
      storeJobs(r.changed)
      closeModal()
      renderNow()
      toast(`Zurück auf den Solltermin ${short(j.due)}.`)
    },
    'mw-plan-run': (el) => runPlan(el),
    'mw-plan-review': () => {
      const m = app.ui.modal
      const review = m?.result?.review || []
      const changed = resolveReview(review, { doc: doc(), jobs: jobsAll(), now: nowIso(), by: user() })
      storeJobs(changed)
      m.result.resolved = changed.length
      renderNow()
      toast(`${plural(changed.length, 'Einsatz', 'Einsätze')} angepasst.`)
    },
    'mw-closures-add': () => {
      const m = readClosures()
      m.rows.push({ from: '', to: '', reason: '', mode: '' })
      renderModal()
    },
    'mw-closures-del': (el) => {
      const m = readClosures()
      m.rows.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-closures-save': () => saveClosures(),
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen (nur Büro: Recht, den Mattenwechsel zu bearbeiten)

registerTodo({
  id: 'matten',
  module: MODULE,
  title: 'Mattenwechsel',
  compute: (today) => {
    // Rückmeldungen der Fahrer ohne Konto (Fahrerseite am Webspace) im Hintergrund abholen, solange die App offen ist
    startWebPolling()
    // Touren im Hintergrund lesen: nicht durchgeführte Wechsel, liegen gebliebene Touren (views/matten-uebersicht.js)
    ensureOverviewTours()
    const a = mattenAttention(today)
    const st = mattenState(today)
    // Zähler für den digitalen Mitarbeiter auf demselben Stand (z. B. nach „Nachholen“ im Kalender)
    publishOverview(today)
    const out = []
    if (a.overdue.length) out.push({ id: `ueber:${a.overdue.map((x) => `${x.placement.id}@${x.next.date}`).join(',')}`, kind: 'ueber', list: a.overdue })
    // nicht durchgeführt (Ausnahme in der Tour), noch ohne Tag zum Nachholen; Touren vergangener Tage nicht abgeschlossen
    const notDone = st.notDone.filter((x) => !x.planned)
    if (notDone.length) out.push({ id: `nicht:${notDone.map((x) => x.key).join(',')}`, kind: 'nicht', list: notDone })
    if (st.stale.length) out.push({ id: `alt:${st.stale.map((t) => `${t.id}@${t.status}`).join(',')}`, kind: 'alt', list: st.stale })
    if (a.missing.length) out.push({ id: `plan:${a.until}:${a.missing.length}`, kind: 'plan', count: a.missing.length, until: a.until })
    // Tourenplanung: offene Einsätze bis zum nächsten Arbeitstag ohne freigegebene Tour
    const soon = untouredSoon(jobsAll(), today)
    if (soon.jobs.length) out.push({ id: `tour:${soon.date}:${soon.jobs.length}`, kind: 'tour', count: soon.jobs.length, date: soon.date, title: soon.title, days: soon.days })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'ueber'
          ? `<div class="todo-item"><span class="flag error">${x.list.length}</span><div class="todo-text"><strong>Mattenwechsel überfällig (${esc(plural(x.list.length, 'Liegeplatz', 'Liegeplätze'))})</strong><br><span class="muted">${esc(
              x.list
                .slice(0, 4)
                .map((y) => `${y.placement.name} (${objName(y.placement.objectId)}) seit ${short(y.next.date)}`)
                .join(' · '),
            )}${x.list.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="mw-cal-goto" data-date="${esc(x.list[0].next.date)}">Öffnen</button></div>`
          : x.kind === 'nicht'
            ? `<div class="todo-item"><span class="flag error">${x.list.length}</span><div class="todo-text"><strong>Nicht durchgeführte Wechsel nachholen (${x.list.length})</strong><br><span class="muted">${esc(
                x.list
                  .slice(0, 4)
                  .map((y) => `${y.placementName || 'Liegeplatz'} (${y.objectName || 'Objekt'}) am ${short(y.date)}: ${y.reason || 'nicht durchgeführt'}`)
                  .join(' · '),
              )}${x.list.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="mwu-goto" data-card="nicht">Öffnen</button></div>`
          : x.kind === 'alt'
            ? `<div class="todo-item"><span class="flag warning">${x.list.length}</span><div class="todo-text"><strong>Touren vergangener Tage nicht abgeschlossen (${x.list.length})</strong><br><span class="muted">${esc(
                x.list
                  .slice(0, 4)
                  .map((t) => `${t.driverName || 'ohne Fahrer'}, ${short(t.date)}: ${t.status === 'unterwegs' ? 'unterwegs' : 'nicht gestartet'}`)
                  .join(' · '),
              )}${x.list.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="mwu-tour" data-tour="${esc(x.list.length === 1 ? x.list[0].id : '')}">Öffnen</button></div>`
          : x.kind === 'tour'
            ? `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>${esc(x.title)}</strong><br><span class="muted">${esc(plural(x.count, 'Einsatz', 'Einsätze'))} am ${esc(x.days.map((d) => short(d)).join(', '))} in keiner freigegebenen Tour. In „Touren planen“ vorschlagen und freigeben.</span></div><button class="btn small primary" data-action="mw-tp-goto" data-date="${esc(x.date)}">Öffnen</button></div>`
            : `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Einsätze für die nächsten Wochen noch nicht geplant</strong><br><span class="muted">${esc(plural(x.count, 'Wechsel', 'Wechsel'))} bis ${esc(short(x.until))} fehlen im Kalender.</span></div><button class="btn small primary" data-action="mw-cal-goto" data-plan="1">Öffnen</button></div>`,
      )
      .join(''),
})
