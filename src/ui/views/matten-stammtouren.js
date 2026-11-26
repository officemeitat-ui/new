// Mattenwechsel → Tourenplanung → „Stammtouren“: feste Touren (Name, Wochentag, Rhythmus, nächster Tag, Fahrer, Fahrzeug,
// Liegeplätze in fester Reihenfolge). „Liegeplätze anpassen“ setzt Intervall, Regel und Starttermin, damit die Wechsel auf
// die Tage der Tour fallen. Der Tourvorschlag (views/matten-planung.js) nimmt die Stammtouren des Tages zuerst.
// Rechenkern: core/matten-stammtouren.js. Datei matten/matten.json (routes). Kürzel mw-st-.

import { formatDate, todayISO } from '../../core/dates.js'
import { emptyMatten } from '../../core/matten.js'
import { alignPlacements, newRoute, nextRunOn, ROUTE_RHYTHMS, routeHints, routeProblem, WEEKDAYS } from '../../core/matten-stammtouren.js'
import { driverKey, normalizeDrivers } from '../../core/matten-touren.js'
import { app, canEdit, confirmStep, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { checked, esc, ICON, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'matten'
const doc = () => {
  const d = (app.data.matten ||= emptyMatten())
  d.routes ||= []
  d.placements ||= []
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const short = (d) => (d ? formatDate(d, { year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const drivers = () => normalizeDrivers(doc().settings?.drivers).filter((d) => d.active !== false)
const vehicles = () => (app.data.fahrzeuge?.vehicles || []).filter((v) => !v.inactive)
const areaName = (id) => (doc().areas || []).find((a) => a.id === id)?.name || ''
const placementOf = (id) => doc().placements.find((p) => p.id === id)
const placementLabel = (p) => [p.customer?.name, p.name, areaName(p.areaId)].filter(Boolean).join(' · ')

// ---------------------------------------------------------------- Liste

function listModal() {
  const ed = editable()
  const routes = doc().routes
  const rows = routes
    .map((r) => {
      const hints = routeHints(r, { placements: doc().placements, routes })
      const drv = drivers().find((d) => driverKey(d) === r.driverId)
      return `<tr><td><strong>${esc(r.name)}</strong>${r.active === false ? ' <span class="pill">aus</span>' : ''}${hints.length ? `<br><span class="err-text">${esc(hints.map((h) => h.text).join(' '))}</span>` : ''}</td>
        <td>${esc(WEEKDAYS[r.weekday] || '')}, ${esc(ROUTE_RHYTHMS[r.everyWeeks] || `alle ${r.everyWeeks} Wochen`)}<br><span class="muted">nächste: ${esc(short(nextRunOn(r, todayISO())))}</span></td>
        <td>${esc(drv?.name || '–')}</td><td class="num">${(r.placementIds || []).length}</td>
        <td class="actions-cell">${ed ? `<button class="btn small" data-action="mw-st-edit" data-id="${esc(r.id)}">Bearbeiten</button>${hints.some((h) => h.kind === 'intervall') ? ` <button class="btn small primary" data-action="mw-st-align" data-id="${esc(r.id)}">Liegeplätze anpassen</button>` : ''}` : ''}</td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Stammtouren',
    wide: true,
    body: `<p class="note">Feste Touren wie „Tour 1 Luftseite, alle 2 Wochen am Dienstag“: Liegeplätze in fester Reihenfolge, mit Fahrer und Fahrzeug. An ihren Tagen kommen sie im Tourvorschlag zuerst, in dieser Reihenfolge (auch innerhalb eines Objekts, z. B. am Flughafen). „Liegeplätze anpassen“ setzt Intervall und Starttermin der Liegeplätze passend zur Tour.</p>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Stammtour</th><th>Wann</th><th>Fahrer</th><th class="num">Liegeplätze</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Stammtour.</p>'}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${ed ? `<button class="btn primary" data-action="mw-st-edit">${ICON.plus} Stammtour</button>` : ''}</div>`,
  })
}
registerModal('mw-st-list', listModal, { module: MODULE })

// ---------------------------------------------------------------- Bearbeiten

function draftOf(m) {
  if (!m.draft) {
    const old = doc().routes.find((r) => r.id === m.id)
    m.draft = old ? structuredClone(old) : newRoute({ id: '', name: '', weekday: 2, everyWeeks: 2, from: todayISO(), driverId: driverKey(drivers()[0]) || '' })
  }
  return m.draft
}

function readForm(m) {
  const d = draftOf(m)
  if (!document.getElementById('mw-st-name')) return d
  Object.assign(d, { name: val('mw-st-name').trim(), weekday: Number(val('mw-st-weekday')) || 1, everyWeeks: Number(val('mw-st-weeks')) || 2, anchor: val('mw-st-anchor'), driverId: val('mw-st-driver'), vehicleId: val('mw-st-vehicle'), active: checked('mw-st-active'), note: val('mw-st-note').trim() })
  m.filter = { area: val('mw-st-f-area'), q: val('mw-st-f-q') }
  return d
}

function editModal(c, m) {
  const d = draftOf(m)
  const f = m.filter || { area: '', q: '' }
  const inTour = new Set(d.placementIds)
  const q = String(f.q || '').trim().toLowerCase()
  const free = doc()
    .placements.filter((p) => p.active !== false && !inTour.has(p.id) && (!f.area || p.areaId === f.area) && (!q || placementLabel(p).toLowerCase().includes(q)))
    .sort((a, b) => placementLabel(a).localeCompare(placementLabel(b), 'de', { numeric: true }))
  const list = d.placementIds
    .map((id, i) => {
      const p = placementOf(id)
      return `<li class="mw-st-item"><span class="mw-st-no">${i + 1}</span><span class="mw-st-name">${esc(p ? placementLabel(p) : '(gelöscht)')}</span>
        <span class="mw-st-btns"><button type="button" class="btn small ghost" data-action="mw-st-move" data-i="${i}" data-d="-1" aria-label="nach oben" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn small ghost" data-action="mw-st-move" data-i="${i}" data-d="1" aria-label="nach unten" ${i < d.placementIds.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn small ghost" data-action="mw-st-del" data-i="${i}" aria-label="aus der Tour nehmen">✕</button></span></li>`
    })
    .join('')
  const areas = (doc().areas || []).filter((a) => a.active !== false)
  return modalFrame({
    title: d.id ? `Stammtour: ${d.name}` : 'Neue Stammtour',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="mw-st-name" value="${esc(d.name)}" placeholder="z. B. Tour 1 Luftseite"></label>
        <label class="field"><span>Wochentag</span><select id="mw-st-weekday">${options(Object.entries(WEEKDAYS), String(d.weekday))}</select></label>
        <label class="field"><span>Rhythmus</span><select id="mw-st-weeks">${options(Object.entries(ROUTE_RHYTHMS), String(d.everyWeeks))}</select></label>
        <label class="field"><span>Nächster Tag der Tour</span><input type="date" id="mw-st-anchor" value="${esc(d.anchor)}"></label>
        <label class="field"><span>Fahrer</span><select id="mw-st-driver">${options(drivers().map((x) => [driverKey(x), x.name]), d.driverId, { empty: '– Fahrer –' })}</select></label>
        <label class="field"><span>Fahrzeug (optional)</span><select id="mw-st-vehicle">${options(vehicles().map((v) => [v.id, [v.plate, v.label].filter(Boolean).join(' · ')]), d.vehicleId, { empty: '– wie beim Fahrer –' })}</select></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="mw-st-note" value="${esc(d.note || '')}" placeholder="z. B. Zutritt Luftseite mit Ausweis, Beginn 6 Uhr"></label>
        <label class="check"><input type="checkbox" id="mw-st-active" ${d.active !== false ? 'checked' : ''}><span>aktiv</span></label>
      </div>
      <div class="mw-st-cols">
        <section><h3>In der Tour (${d.placementIds.length})</h3>${list ? `<ol class="mw-st-list">${list}</ol>` : '<p class="muted">Noch keine Liegeplätze: rechts hinzufügen.</p>'}</section>
        <section><h3>Liegeplätze hinzufügen</h3>
          <div class="form-grid"><label class="field"><span>Gebiet</span><select id="mw-st-f-area" data-change="mw-st-filter">${options(areas.map((a) => [a.id, a.name]), f.area, { empty: 'alle' })}</select></label>
          <label class="field"><span>Suche</span><input type="search" id="mw-st-f-q" value="${esc(f.q || '')}" data-input="mw-st-search" placeholder="Kunde, Liegeplatz"></label></div>
          ${free.length ? `<p><button type="button" class="btn small" data-action="mw-st-add-all">${ICON.plus} alle ${free.length} hinzufügen</button></p><ul class="mw-st-free">${free.slice(0, 80).map((p) => `<li><button type="button" class="btn small ghost" data-action="mw-st-add" data-id="${esc(p.id)}">${ICON.plus}</button> ${esc(placementLabel(p))}</li>`).join('')}</ul>${free.length > 80 ? `<p class="muted">… und ${free.length - 80} weitere: Gebiet oder Suche eingrenzen.</p>` : ''}` : '<p class="muted">Keine weiteren Liegeplätze in dieser Auswahl.</p>'}
        </section>
      </div>`,
    foot: `${d.id ? `<button class="btn danger ghost" data-action="mw-st-remove">${app.ui.confirm === `mw-st-remove:${d.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}<button class="btn" data-action="mw-st-open">Zurück</button><div class="actions"><button class="btn primary" data-action="mw-st-save">Speichern</button></div>`,
  })
}
registerModal('mw-st-edit', editModal, { module: MODULE })

/** Liegeplätze der Tour an Rhythmus und Tag anpassen. */
function align(route) {
  const res = alignPlacements(doc().placements, route, { from: todayISO(), now: nowIso(), by: by() })
  if (!res.changed.length) return 0
  doc().placements = res.placements
  persist()
  return res.changed.length
}

registerActions({ 'mw-st-open': () => openModal({ type: 'mw-st-list' }) })

registerActions(
  {
    'mw-st-edit': (el) => openModal({ type: 'mw-st-edit', id: el?.dataset?.id || '' }),
    'mw-st-filter': () => {
      readForm(app.ui.modal)
      renderModal()
    },
    // Suche beim Tippen: neu zeichnen und im Feld weiterschreiben
    'mw-st-search': () => {
      readForm(app.ui.modal)
      renderModal()
      const el = document.getElementById('mw-st-f-q')
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    },
    'mw-st-add': (el) => {
      const d = readForm(app.ui.modal)
      if (!d.placementIds.includes(el.dataset.id)) d.placementIds.push(el.dataset.id)
      renderModal()
    },
    'mw-st-add-all': () => {
      const m = app.ui.modal
      const d = readForm(m)
      const f = m.filter || {}
      const q = String(f.q || '').trim().toLowerCase()
      for (const p of doc().placements.filter((p) => p.active !== false && (!f.area || p.areaId === f.area) && (!q || placementLabel(p).toLowerCase().includes(q))).sort((a, b) => placementLabel(a).localeCompare(placementLabel(b), 'de', { numeric: true }))) if (!d.placementIds.includes(p.id)) d.placementIds.push(p.id)
      renderModal()
    },
    'mw-st-move': (el) => {
      const d = readForm(app.ui.modal)
      const i = Number(el.dataset.i)
      const j = i + Number(el.dataset.d)
      if (j < 0 || j >= d.placementIds.length) return
      ;[d.placementIds[i], d.placementIds[j]] = [d.placementIds[j], d.placementIds[i]]
      renderModal()
    },
    'mw-st-del': (el) => {
      const d = readForm(app.ui.modal)
      d.placementIds.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'mw-st-save': () => {
      const m = app.ui.modal
      const d = readForm(m)
      const problem = routeProblem(d)
      if (problem) return toast(problem)
      const route = { ...d, id: d.id || uid('rt'), updatedAt: nowIso(), updatedBy: by(), ...(d.id ? {} : { createdAt: nowIso(), createdBy: by() }) }
      doc().routes = d.id ? doc().routes.map((r) => (r.id === d.id ? route : r)) : [...doc().routes, route]
      persist()
      const off = routeHints(route, { placements: doc().placements, routes: doc().routes }).find((h) => h.kind === 'intervall')
      openModal({ type: 'mw-st-list' })
      toast(`Stammtour „${route.name}“ gespeichert.${off ? ` ${off.text}` : ''}`)
    },
    'mw-st-remove': () => {
      const d = draftOf(app.ui.modal)
      if (!d.id || !confirmStep(`mw-st-remove:${d.id}`, renderModal)) return
      doc().routes = doc().routes.filter((r) => r.id !== d.id)
      persist()
      openModal({ type: 'mw-st-list' })
      toast('Stammtour gelöscht. Die Liegeplätze bleiben, wie sie sind.')
    },
    'mw-st-align': (el) => {
      const r = doc().routes.find((x) => x.id === el.dataset.id)
      if (!r) return
      const n = align(r)
      renderModal()
      renderNow()
      toast(n ? `${plural(n, 'Liegeplatz', 'Liegeplätze')} angepasst: ${ROUTE_RHYTHMS[r.everyWeeks] || ''}, erster Wechsel am ${short(nextRunOn(r, todayISO()))}. Bitte „Einsätze planen“ im Matten-Kalender.` : 'Alles passt schon.')
    },
  },
  { edit: MODULE },
)
