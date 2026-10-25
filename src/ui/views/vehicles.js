// Modul Fahrzeuge & Reifen: Firmenfahrzeuge mit Fahrer/in, Reifensätzen und
// Einlagerung. Je Saison der Reifenwechsel: Termine vorschlagen (neben den
// Diensten der Fahrer/innen), Fahrer/innen per E-Mail informieren (mit
// Kalendertermin), Sammelliste an die Werkstatt, Erledigt mit Profiltiefe.

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, dayIndex, formatDate, todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { icsEvent } from '../../core/ics.js'
import { activeVehicles, applyDone, campaignFor, campaignSummary, conflicts, DEFAULT_SETTINGS, driverMail, importVehicles, lowestTread, minTread, proposeSlots, SEASONS, STATUS_CLASS, STATUS_LABEL, tireCsv, tireIssues, VEHICLE_KINDS, vehicleStatus, WHEELS, workshopMail } from '../../core/vehicles.js'
import { app, canEdit, closeModal, computeRange, confirmStep, empName, ensureRange, openModal, persist, registerActions, registerModal, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { registerTodo } from '../modals/todo.js'
import { download, esc, ICON, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'fahrzeuge'
const FZ = () => {
  const d = (app.data.fahrzeuge ||= { vehicles: [], workshops: [], changes: [], settings: {} })
  d.vehicles ||= []
  d.workshops ||= []
  d.changes ||= []
  d.settings ||= {}
  return d
}
const settings = () => ({ ...DEFAULT_SETTINGS, ...FZ().settings })
const vehOf = (id) => FZ().vehicles.find((v) => v.id === id)
const wsOf = (id) => FZ().workshops.find((w) => w.id === id)
const changeById = (id) => FZ().changes.find((c) => c.id === id)
const empOf = (id) => app.data.employees.find((e) => e.id === id)
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const editable = () => canEdit(MODULE)
const canDownload = () => app.config.features.download
const userName = () => app.user?.name || ''
const mm = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','))
const ORDER = { ueberfaellig: 0, vorbei: 1, offen: 2, geplant: 3, erledigt: 4, ganzjahr: 5 }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** Belegte Zeiten je Person und Tag aus dem Dienstplan (Einsätze, Abwesenheiten). */
function busyLookup(from, to) {
  const r = computeRange(from, to)
  return (empId, date) => {
    const base = dayIndex(date) * 1440
    const out = r.state
      .instancesOf(empId)
      .filter((i) => i && i.date === date && i.status !== 'cancelled')
      .map((i) => ({ start: i.start - base, end: i.end - base, label: objName(i.objectId) }))
      .sort((a, b) => a.start - b.start)
    const abs = (app.data.absences || []).find((a) => a.employeeId === empId && a.from <= date && a.to >= date)
    if (abs) out.unshift({ allDay: true, label: `${empName(empId)}: ${abs.type}` })
    return out
  }
}

function rows(today = todayISO()) {
  return activeVehicles(FZ())
    .map((v) => ({ v, st: vehicleStatus(FZ(), v, today) }))
    .sort((a, b) => ORDER[a.st.status] - ORDER[b.st.status] || (a.st.change?.date || '').localeCompare(b.st.change?.date || '') || a.v.plate.localeCompare(b.v.plate, 'de'))
}

const planned = (today) => rows(today).filter((r) => r.st.status === 'geplant')
const informed = (change, kind = 'fahrer') => (change?.mails || []).some((x) => x.kind === kind)

// ---------------------------------------------------------------- Übersicht

function treadCell(v, season) {
  const low = lowestTread(v.tires?.[season]?.tread)
  if (low === null) return '<span class="muted">nicht erfasst</span>'
  const { legal, advised } = minTread(v, season === 'ganzjahr' ? 'winter' : season)
  return `<span class="pill ${low < legal ? 'error' : low < advised ? 'warning' : 'ok'}">${mm(low)} mm</span><br><span class="muted">${SEASONS[season]}, mind. ${mm(legal)}</span>`
}

function vehiclesView() {
  const today = todayISO()
  const fz = FZ()
  const list = rows(today)
  const { campaign, counts, total } = campaignSummary(fz, today)
  const filter = app.ui.vehFilter || 'alle'
  const shown = list.filter(({ st }) => filter === 'alle' || (filter === 'offen' ? ['offen', 'ueberfaellig', 'vorbei'].includes(st.status) : st.status === 'geplant'))
  const open = counts.offen + counts.ueberfaellig
  const uninformed = planned(today).filter((r) => !informed(r.st.change)).length
  const plannedDates = list.filter((r) => r.st.change?.status === 'geplant').map((r) => r.st.change.date)
  const busy = plannedDates.length ? busyLookup(plannedDates.reduce((a, b) => (a < b ? a : b)), plannedDates.reduce((a, b) => (a > b ? a : b))) : null
  const travel = settings().travelMinutes

  const body = shown
    .map(({ v, st }) => {
      const c = st.change
      const driver = empOf(v.driverId)
      const clash = c?.status === 'geplant' && v.driverId && busy ? conflicts(busy(v.driverId, c.date), c.time, c.minutes || 30, travel) : []
      const term = c
        ? `${formatDate(c.date)} ${esc(c.time || '')}${c.status === 'erledigt' ? ' <span class="pill ok">erledigt</span>' : ''}<br><span class="muted">${esc(wsOf(c.workshopId)?.name || '')}</span>
          ${c.status === 'geplant' ? `<br>${informed(c) ? '<span class="pill ok">✓ informiert</span>' : '<span class="pill warning">noch nicht informiert</span>'}${informed(c, 'werkstatt') ? ' <span class="pill info">Werkstatt</span>' : ''}` : ''}
          ${clash.length ? `<br><span class="check warning">⚠ ${esc(clash.map((x) => x.text).join('; '))}</span>` : ''}${st.early ? '<br><span class="check warning">⚠ vor dem 16. April</span>' : ''}`
        : '<span class="muted">–</span>'
      const acts = editable()
        ? `${['offen', 'ueberfaellig'].includes(st.status) ? `<button class="btn small primary" data-action="veh-plan-open" data-id="${esc(v.id)}">${ICON.calendar} Termin</button>` : ''}
          ${st.status === 'geplant' || st.status === 'vorbei' ? `<button class="btn small ${st.status === 'vorbei' ? 'primary' : ''}" data-action="veh-done-open" data-change="${esc(c.id)}">${ICON.check} Erledigt</button> <button class="btn small" data-action="veh-plan-open" data-id="${esc(v.id)}" data-change="${esc(c.id)}">Ändern</button>` : ''}
          ${st.status === 'geplant' ? `<button class="btn small" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(c.id)}">${ICON.send} Mail</button>` : ''}
          <button class="btn small" data-action="veh-edit-open" data-id="${esc(v.id)}">Bearbeiten</button>`
        : ''
      return `<tr><td><strong>${esc(v.plate)}</strong><br><span class="muted">${esc([v.label, VEHICLE_KINDS[v.kind]?.label].filter(Boolean).join(' · '))}</span></td>
        <td>${driver ? esc(driver.name) : '<span class="muted">ohne feste/n Fahrer/in</span>'}${driver && !driver.email ? '<br><span class="muted">keine E-Mail</span>' : ''}</td>
        <td>${esc(SEASONS[v.mounted] || '')}</td>
        <td>${term}</td>
        <td>${treadCell(v, v.mounted === 'ganzjahr' ? 'ganzjahr' : campaign.season)}</td>
        <td><span class="pill ${STATUS_CLASS[st.status]}">${esc(STATUS_LABEL[st.status])}</span></td>
        <td class="actions-cell">${acts}</td></tr>`
    })
    .join('')

  const issues = list.flatMap(({ v }) => (v.mounted === 'ganzjahr' ? ['ganzjahr'] : ['sommer', 'winter']).flatMap((s) => tireIssues(v, s, today)).map((i) => ({ ...i, v })))
  const rule = campaign.season === 'winter' ? `Frist ${formatDate(campaign.by, { weekday: false, year: true })}: ab 1. November gilt bei winterlichen Verhältnissen die Winterreifenpflicht (bis 15. April). Lkw über 3,5 t: Winterreifen auf der Antriebsachse, mind. 5 mm, Schneeketten mitführen.` : `Sommerreifen erst ab 16. April montieren, Ziel bis ${formatDate(campaign.by, { weekday: false, year: true })}. Bis 15. April verlangt winterliche Fahrbahn noch Winterreifen.`
  const empty = !total
    ? `<div class="banner welcome"><p><strong>Noch keine Fahrzeuge.</strong> Fahrzeuge einzeln anlegen oder die Liste aus Excel einfügen (Kennzeichen, Fahrzeug, Fahrer/in, Reifengrößen, Lagerort).</p>${editable() ? `<div class="actions"><button class="btn primary" data-action="veh-edit-open">${ICON.plus} Fahrzeug</button><button class="btn" data-action="veh-import-open">${ICON.upload} Liste einfügen</button></div>` : ''}</div>`
    : ''
  return `<div class="section-head"><div><h2>${ICON.car} Fahrzeuge &amp; Reifen</h2>
      <p>Firmenfahrzeuge mit Fahrer/in, Reifensätzen und Einlagerung. Je Saison der Reifenwechsel: Termine neben den Diensten vorschlagen, Fahrer/innen per E-Mail informieren, Liste an die Werkstatt.</p></div>
      <div class="actions">${editable() ? `<button class="btn" data-action="veh-edit-open">${ICON.plus} Fahrzeug</button><button class="btn" data-action="veh-ws-open">Werkstätten (${fz.workshops.length})</button><button class="btn" data-action="veh-import-open">${ICON.upload} Liste einfügen</button>` : ''}${total && canDownload() ? `<button class="btn" data-action="veh-csv">${ICON.download} CSV</button>` : ''}</div></div>
    ${
      total
        ? `<div class="summary">
      <div class="stat"><div class="label">Wechselrunde</div><div class="value">${esc(campaign.label)}</div><div class="muted">bis ${formatDate(campaign.by, { weekday: false, year: true })}</div></div>
      <div class="stat"><div class="label">Umgerüstet</div><div class="value">${counts.erledigt + counts.ganzjahr} / ${total}</div><div class="muted">${counts.ganzjahr ? `davon ${counts.ganzjahr} Ganzjahr` : 'Fahrzeuge'}</div></div>
      <div class="stat"><div class="label">Termin geplant</div><div class="value">${counts.geplant + counts.vorbei}</div><div class="muted">${uninformed ? `${uninformed} noch nicht informiert` : 'alle informiert'}</div></div>
      <div class="stat ${open ? 'warn' : ''}"><div class="label">Ohne Termin</div><div class="value">${open}</div><div class="muted">${counts.ueberfaellig ? `${counts.ueberfaellig} überfällig` : open ? 'bitte planen' : 'passt'}</div></div>
    </div>
    <p class="note">${esc(rule)}</p>
    ${editable() ? `<div class="actions veh-campaign">${open ? `<button class="btn primary" data-action="veh-propose-open">${ICON.bolt} Termine vorschlagen (${open})</button>` : ''}${uninformed ? `<button class="btn ${open ? '' : 'primary'}" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(planned(today).filter((r) => !informed(r.st.change)).map((r) => r.st.change.id).join(','))}">${ICON.send} Fahrer/innen informieren (${uninformed})</button>` : ''}${counts.geplant ? `<button class="btn" data-action="veh-mail-open" data-kind="werkstatt">${ICON.send} Liste an Werkstatt</button>` : ''}</div>` : ''}
    <div class="toolbar filters-bar"><div class="seg" role="group" aria-label="Filter">${[['alle', `Alle (${list.length})`], ['offen', `Zu tun (${open + counts.vorbei})`], ['geplant', `Geplant (${counts.geplant})`]].map(([k, label]) => `<button class="btn small ${filter === k ? 'primary' : ''}" data-action="veh-filter" data-v="${k}">${label}</button>`).join('')}</div></div>
    <div class="table-wrap"><table class="data veh-table"><thead><tr><th>Fahrzeug</th><th>Fahrer/in</th><th>Montiert</th><th>Termin</th><th>Profil</th><th>Stand</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="7" class="muted">Nichts in dieser Auswahl.</td></tr>'}</tbody></table></div>
    ${issues.length ? `<section><h3>Profil und Reifenalter</h3>${issues.map((i) => `<p class="check ${i.level}">${i.level === 'error' ? '⚠ ' : ''}<strong>${esc(i.v.plate)}</strong> ${esc(i.text)}</p>`).join('')}</section>` : ''}`
        : empty
    }`
}

registerView({ id: 'fahrzeuge', order: 95, label: 'Fahrzeuge & Reifen', group: 'stamm', module: MODULE, noWeek: true, mobile: { icon: ICON.car, label: 'Reifen' }, badge: () => rows().filter((r) => ['offen', 'ueberfaellig', 'vorbei'].includes(r.st.status)).length, render: vehiclesView })

registerActions({
  'veh-filter': (el) => {
    app.ui.vehFilter = el.dataset.v
    renderNow()
  },
  'veh-csv': () => {
    const today = todayISO()
    const data = rows(today).map(({ v, st }) => ({ vehicle: v, change: st.change, driver: empOf(v.driverId)?.name || '', workshop: wsOf(st.change?.workshopId || v.workshopId)?.name || '', status: st.status }))
    download(`Reifenwechsel_${campaignFor(today).key}.csv`, new Blob([tireCsv(data)], { type: 'text/csv;charset=utf-8' }))
  },
})

// ---------------------------------------------------------------- Fahrzeug bearbeiten

const blankSet = () => ({ size: '', storage: '', dot: '', tread: {} })
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)
function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj)
  target[last] = value
}
const field = (path, label, value, { type = 'text', placeholder = '', cls = '' } = {}) =>
  `<label class="field ${cls}"><span>${esc(label)}</span><input type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" data-change="veh-set" data-path="${path}" ${type === 'number' ? 'inputmode="decimal" step="0.1"' : ''}></label>`

function tireFieldset(d, season) {
  const s = d.tires?.[season] || {}
  return `<fieldset class="veh-set"><legend>${esc(SEASONS[season])}</legend><div class="form-grid">
    ${field(`tires.${season}.size`, 'Größe', s.size, { placeholder: '205/55 R16' })}
    ${season === 'ganzjahr' ? '' : field(`tires.${season}.storage`, 'Eingelagert bei / wo', s.storage, { placeholder: 'Werkstatt, Regal 14' })}
    ${field(`tires.${season}.dot`, 'DOT (Woche/Jahr)', s.dot, { placeholder: '3822' })}
    </div><div class="veh-tread"><span class="muted">Profil in mm</span>${WHEELS.map(([k, label]) => `<label class="field inline"><span>${label}</span><input type="number" step="0.1" min="0" max="15" inputmode="decimal" value="${esc(s.tread?.[k] ?? '')}" data-change="veh-set" data-path="tires.${season}.tread.${k}" aria-label="Profil ${SEASONS[season]} ${label}"></label>`).join('')}</div></fieldset>`
}

function editModal(c, m) {
  const d = m.draft
  const employees = [...app.data.employees].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return modalFrame({
    title: m.id ? `Fahrzeug ${esc(d.plate || '')}` : 'Neues Fahrzeug',
    wide: true,
    body: `<div class="form-grid">
        ${field('plate', 'Kennzeichen', d.plate, { placeholder: 'S-123 AB' })}
        ${field('label', 'Fahrzeug', d.label, { placeholder: 'VW Caddy' })}
        <label class="field"><span>Art</span><select data-change="veh-set" data-path="kind">${options(Object.entries(VEHICLE_KINDS).map(([k, x]) => [k, x.label]), d.kind)}</select></label>
        <label class="field"><span>Fahrer/in</span><select data-change="veh-set" data-path="driverId">${options(employees.map((e) => [e.id, e.name]), d.driverId, { empty: 'ohne feste/n Fahrer/in' })}</select></label>
        <label class="field"><span>Werkstatt</span><select data-change="veh-set" data-path="workshopId">${options(FZ().workshops.map((w) => [w.id, w.name]), d.workshopId, { empty: '–' })}</select></label>
        <label class="field"><span>Montiert</span><select data-change="veh-set" data-path="mounted" data-rerender="1">${options(Object.entries(SEASONS), d.mounted)}</select></label>
        ${field('note', 'Hinweis (steht in der E-Mail an die Werkstatt nicht)', d.note, { cls: 'wide' })}
      </div>
      ${d.mounted === 'ganzjahr' ? tireFieldset(d, 'ganzjahr') : `${tireFieldset(d, 'sommer')}${tireFieldset(d, 'winter')}`}
      <p class="note">Mindestprofil: Sommerreifen 1,6 mm (empfohlen 3 mm), Winterreifen 4 mm, bei Lkw über 3,5 t 5 mm. Ab 6 Jahren (DOT) wird der Tausch empfohlen.</p>`,
    foot: `${m.id ? `<button class="btn ${app.ui.confirm === 'veh-del' ? 'danger confirm' : 'danger'}" data-action="veh-del" data-id="${esc(m.id)}">${app.ui.confirm === 'veh-del' ? 'Wirklich löschen?' : 'Löschen'}</button>` : '<button class="btn" data-action="close-modal">Abbrechen</button>'}
      <div class="actions"><button class="btn primary" data-action="veh-save">Speichern</button></div>`,
  })
}

registerModal('veh-edit', editModal)

// ---------------------------------------------------------------- Werkstätten

registerModal('veh-ws', (c, m) =>
  modalFrame({
    title: 'Werkstätten',
    subtitle: 'Reifendienst, Autohaus: an sie geht die Liste der Termine',
    wide: true,
    body: `${m.draft.map((w, i) => `<div class="mp-row">${['name', 'address', 'phone', 'email'].map((k) => `<input type="${k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}" value="${esc(w[k] || '')}" placeholder="${{ name: 'Name', address: 'Adresse', phone: 'Telefon', email: 'E-Mail für Termine' }[k]}" aria-label="${k}" data-change="veh-ws-set" data-i="${i}" data-k="${k}">`).join('')}<button type="button" class="btn small danger" data-action="veh-ws-del" data-i="${i}" aria-label="Entfernen">×</button></div>`).join('') || '<p class="note">Noch keine Werkstatt.</p>'}
      <button type="button" class="btn small" data-action="veh-ws-add">${ICON.plus} Werkstatt</button>`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="veh-ws-save">Speichern</button></div>',
  }),
)

// ---------------------------------------------------------------- Liste einfügen

registerModal('veh-import', (c, m) => {
  const res = m.text ? importVehicles(m.text, { employees: app.data.employees, workshops: FZ().workshops }) : null
  const known = new Set(FZ().vehicles.map((v) => v.plate))
  return modalFrame({
    title: 'Fahrzeugliste einfügen',
    wide: true,
    body: `<p class="note">Aus Excel kopieren und hier einfügen (erste Zeile Überschriften): Kennzeichen, Fahrzeug, Art, Fahrer/in, Sommerreifen, Winterreifen, Lagerort, Werkstatt, Montiert. Vorhandene Kennzeichen werden ergänzt, nicht doppelt angelegt.</p>
      <textarea id="veh-import-text" rows="6" placeholder="Kennzeichen&#9;Fahrzeug&#9;Art&#9;Fahrer/in&#9;Sommerreifen&#9;Winterreifen&#9;Lagerort&#9;Werkstatt&#9;Montiert" data-input="veh-import-text">${esc(m.text || '')}</textarea>
      ${res ? `<p><strong>${plural(res.vehicles.length, 'Fahrzeug', 'Fahrzeuge')} erkannt</strong>${res.vehicles.length ? `: ${res.vehicles.slice(0, 5).map((v) => `${esc(v.plate)}${known.has(v.plate) ? ' (vorhanden)' : ''}`).join(', ')}${res.vehicles.length > 5 ? ' …' : ''}` : ''}</p>${res.warnings.map((w) => `<p class="check warning">${esc(w)}</p>`).join('')}` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="veh-import-run" ${res?.vehicles.length ? '' : 'disabled'}>Übernehmen</button></div>`,
  })
})

// ---------------------------------------------------------------- Termin planen

function dayPlan(busy, empId, date) {
  if (!empId) return '<p class="note">Ohne feste/n Fahrer/in: jemand bringt das Fahrzeug hin.</p>'
  const list = busy(empId, date)
  return `<p class="note"><strong>${esc(empName(empId))} am ${formatDate(date)}:</strong> ${list.length ? list.map((b) => (b.allDay ? esc(b.label) : `${String(Math.floor(b.start / 60)).padStart(2, '0')}:${String(b.start % 60).padStart(2, '0')}–${String(Math.floor(b.end / 60) % 24).padStart(2, '0')}:${String(b.end % 60).padStart(2, '0')} ${esc(b.label)}`)).join(' · ') : 'kein Dienst'}</p>`
}

function planModal(c, m) {
  const v = vehOf(m.vehicleId)
  if (!v) return ''
  const campaign = campaignFor(todayISO())
  const date = m.date
  const busy = busyLookup(date, date)
  const clash = v.driverId ? conflicts(busy(v.driverId, date), m.time, Number(m.minutes) || 30, settings().travelMinutes) : []
  const ch = m.changeId ? changeById(m.changeId) : null
  return modalFrame({
    title: `Reifenwechsel ${esc(v.plate)}`,
    subtitle: `${esc(v.label || '')} · auf ${esc(SEASONS[campaign.season])} · Fahrer/in: ${esc(empOf(v.driverId)?.name || '–')}`,
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="vp-date" value="${esc(date)}" data-change="vp-update"></label>
        <label class="field"><span>Uhrzeit</span><input type="time" id="vp-time" value="${esc(m.time)}" step="300" data-change="vp-update"></label>
        <label class="field"><span>Dauer (Min.)</span><input type="number" id="vp-min" value="${esc(m.minutes)}" min="10" step="5" data-change="vp-update"></label>
        <label class="field"><span>Werkstatt</span><select id="vp-ws" data-change="vp-update">${options(FZ().workshops.map((w) => [w.id, w.name]), m.workshopId, { empty: '–' })}</select></label>
        <label class="field wide"><span>Hinweis für die Fahrerin / den Fahrer</span><input type="text" id="vp-note" value="${esc(m.note || '')}" placeholder="z. B. Laderaum vorher ausräumen" data-change="vp-update"></label>
      </div>
      ${dayPlan(busy, v.driverId, date)}
      ${clash.length ? clash.map((x) => `<p class="check warning">⚠ Überschneidung (mit ${settings().travelMinutes} Min. Fahrzeit): ${esc(x.text)}</p>`).join('') : v.driverId ? '<p class="check ok">Passt zu den Diensten.</p>' : ''}
      ${campaign.season === 'sommer' && date < campaign.earliest ? '<p class="check warning">⚠ Vor dem 16. April: bei winterlichen Verhältnissen gilt noch die Winterreifenpflicht.</p>' : ''}
      <p class="actions"><button type="button" class="btn small" data-action="vp-next">${ICON.bolt} Nächsten freien Termin suchen</button></p>`,
    foot: `${ch ? `<button class="btn ${app.ui.confirm === 'vp-cancel' ? 'danger confirm' : 'danger'}" data-action="vp-cancel">${app.ui.confirm === 'vp-cancel' ? 'Termin wirklich absagen?' : 'Termin absagen'}</button>` : '<button class="btn" data-action="close-modal">Abbrechen</button>'}
      <div class="actions"><button class="btn" data-action="vp-save" data-mail="0">Speichern</button><button class="btn primary" data-action="vp-save" data-mail="1">${ICON.send} Speichern &amp; informieren</button></div>`,
  })
}

registerModal('veh-plan', planModal)

// ---------------------------------------------------------------- Termine vorschlagen

function propose(m) {
  const today = todayISO()
  const open = rows(today).filter((r) => ['offen', 'ueberfaellig'].includes(r.st.status) && (!m.workshopId || m.all || r.v.workshopId === m.workshopId || !r.v.workshopId))
  const taken = FZ().changes.filter((x) => x.status === 'geplant' && x.workshopId === m.workshopId)
  const busy = busyLookup(m.from, m.to)
  return { open, ...proposeSlots(open.map((r) => r.v), { from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd, slotMinutes: Number(m.slot) || 30, travelMinutes: Number(m.travel) || 0, busyOf: busy, taken }) }
}

function proposeModal(c, m) {
  const res = m.result
  return modalFrame({
    title: 'Termine vorschlagen',
    subtitle: 'Je Fahrzeug der erste freie Platz, an dem die Fahrerin oder der Fahrer keinen Dienst hat',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Werkstatt</span><select id="vq-ws">${options(FZ().workshops.map((w) => [w.id, w.name]), m.workshopId, { empty: '–' })}</select></label>
        <label class="field"><span>von</span><input type="date" id="vq-from" value="${esc(m.from)}"></label>
        <label class="field"><span>bis</span><input type="date" id="vq-to" value="${esc(m.to)}"></label>
        <label class="field"><span>Werkstatt offen ab</span><input type="time" id="vq-start" value="${esc(m.dayStart)}"></label>
        <label class="field"><span>bis</span><input type="time" id="vq-end" value="${esc(m.dayEnd)}"></label>
        <label class="field"><span>Minuten je Fahrzeug</span><input type="number" id="vq-slot" value="${esc(m.slot)}" min="10" step="5"></label>
        <label class="field"><span>Fahrzeit (Min.)</span><input type="number" id="vq-travel" value="${esc(m.travel)}" min="0" step="5"></label>
        <label class="field inline"><input type="checkbox" id="vq-all" ${m.all ? 'checked' : ''}><span>auch Fahrzeuge anderer Werkstätten</span></label>
      </div>
      <p class="actions"><button class="btn" data-action="vq-run">${ICON.bolt} Vorschlagen</button></p>
      ${
        res
          ? `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Fahrzeug</th><th>Fahrer/in</th><th>Termin</th><th>Warum</th></tr></thead><tbody>${res.proposals
              .map((p, i) => {
                const v = vehOf(p.vehicleId)
                return `<tr><td><input type="checkbox" name="vq-pick" value="${i}" checked aria-label="übernehmen"></td><td><strong>${esc(v.plate)}</strong> <span class="muted">${esc(v.label || '')}</span></td><td>${esc(empOf(v.driverId)?.name || '–')}</td><td>${formatDate(p.date)} ${esc(p.time)}</td><td class="muted">${esc(p.after || (v.driverId ? 'Dienstfrei' : 'ohne Fahrer/in'))}</td></tr>`
              })
              .join('')}</tbody></table></div>
            ${res.unplaced.length ? `<p class="check warning">Kein freier Platz für ${esc(res.unplaced.map((id) => vehOf(id)?.plate).join(', '))}. Zeitraum verlängern oder einzeln planen.</p>` : ''}
            ${!res.open.length ? '<p class="note">Alle Fahrzeuge dieser Werkstatt haben schon einen Termin.</p>' : ''}`
          : ''
      }`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="vq-apply" ${res?.proposals.length ? '' : 'disabled'}>Termine übernehmen</button></div>`,
  })
}

registerModal('veh-propose', proposeModal)

// ---------------------------------------------------------------- Erledigt

function doneModal(c, m) {
  const ch = changeById(m.changeId)
  const v = ch && vehOf(ch.vehicleId)
  if (!v) return ''
  const other = ch.season === 'winter' ? 'sommer' : 'winter'
  const treadRow = (prefix, label) => `<div class="veh-tread"><span class="muted">${label}</span>${WHEELS.map(([k, l]) => `<label class="field inline"><span>${l}</span><input type="number" id="${prefix}-${k}" step="0.1" min="0" max="15" inputmode="decimal" aria-label="${label} ${l}"></label>`).join('')}</div>`
  return modalFrame({
    title: `Reifenwechsel erledigt: ${esc(v.plate)}`,
    subtitle: `jetzt ${esc(SEASONS[ch.season])} montiert`,
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="vd-date" value="${esc(ch.date || todayISO())}"></label>
        <label class="field"><span>km-Stand</span><input type="number" id="vd-km" inputmode="numeric" min="0"></label>
        <label class="field"><span>Kosten (€, optional)</span><input type="number" id="vd-cost" inputmode="decimal" min="0" step="0.01"></label>
        <label class="field wide"><span>${esc(SEASONS[other])} eingelagert bei / wo</span><input type="text" id="vd-storage" value="${esc(v.tires?.[other]?.storage || v.tires?.[ch.season]?.storage || (wsOf(ch.workshopId)?.name ?? ''))}"></label>
      </div>
      ${treadRow('vd-t', `Profil ${SEASONS[ch.season]} (montiert), mm`)}
      ${treadRow('vd-r', `Profil ${SEASONS[other]} (eingelagert), mm`)}
      <label class="field"><span>Bemerkung</span><input type="text" id="vd-note" placeholder="z. B. Ventil getauscht"></label>
      <p class="note">Das Profil steht auf der Rechnung oder dem Prüfblatt der Werkstatt. Liegt es unter dem Mindestprofil, kommt es in „Zu erledigen“.</p>`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="vd-save">Speichern</button></div>',
  })
}

registerModal('veh-done', doneModal)

// ---------------------------------------------------------------- E-Mails

function driverRows(ids) {
  return ids
    .map((id) => changeById(id))
    .filter(Boolean)
    .map((change) => {
      const vehicle = vehOf(change.vehicleId)
      const driver = empOf(vehicle?.driverId)
      return { change, vehicle, driver, workshop: wsOf(change.workshopId) }
    })
    .filter((r) => r.vehicle)
}

const mailFor = (r) => driverMail({ change: r.change, vehicle: r.vehicle, workshop: r.workshop, driverName: r.driver?.name || '', sender: userName(), brand: app.config.brand.name || '' })
const icsFor = (r) => icsEvent({ uid: `${r.change.id}@reifenwechsel`, date: r.change.date, time: r.change.time, minutes: r.change.minutes || 30, title: `Reifenwechsel ${r.vehicle.plate}`, location: [r.workshop?.name, r.workshop?.address].filter(Boolean).join(', '), description: mailFor(r).text, remindHours: 12 })
const mailtoHref = (to, subject, body) => `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@').replace(/%2C/g, ',')}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`

function mailModal(c, m) {
  if (m.kind === 'werkstatt') {
    const ws = wsOf(m.workshopId)
    const list = planned(todayISO()).filter((r) => r.st.change.workshopId === m.workshopId)
    const draft = workshopMail({ rows: list.map((r) => ({ change: r.st.change, vehicle: r.v })), workshop: ws, campaign: campaignFor(todayISO()), sender: userName(), brand: app.config.brand.name || '' })
    return modalFrame({
      title: 'Liste an die Werkstatt',
      wide: true,
      body: `<div class="form-grid"><label class="field"><span>Werkstatt</span><select id="vm-ws" data-change="vm-ws">${options(FZ().workshops.map((w) => [w.id, w.name]), m.workshopId)}</select></label>
          <label class="field"><span>An</span><input type="email" id="vm-to" value="${esc(m.to ?? ws?.email ?? '')}" placeholder="termine@werkstatt.at"></label></div>
        <label class="field"><span>Betreff</span><input type="text" id="vm-subject" value="${esc(draft.subject)}"></label>
        <label class="field"><span>Text</span><textarea id="vm-text" rows="12">${esc(draft.text)}</textarea></label>
        <p class="note">${list.length ? `${plural(list.length, 'Termin', 'Termine')} bei dieser Werkstatt.` : 'Bei dieser Werkstatt ist nichts geplant.'} ${canMail() ? 'Die Liste geht zusätzlich als CSV für Excel mit.' : 'Öffnet dein E-Mail-Programm mit Empfänger, Betreff und Text.'}</p>`,
      foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="vm-send-ws" ${list.length ? '' : 'disabled'}>${ICON.send} ${canMail() ? 'Senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
    })
  }
  const list = driverRows(m.ids)
  const first = list[0] ? mailFor(list[0]) : null
  return modalFrame({
    title: list.length === 1 ? `Fahrer/in informieren: ${esc(list[0].vehicle.plate)}` : 'Fahrer/innen informieren',
    subtitle: canMail() ? 'E-Mail mit Termin für den Kalender (.ics) aus deinem Microsoft-365-Postfach' : 'Öffnet je Person dein E-Mail-Programm',
    wide: true,
    body: `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Fahrzeug</th><th>Fahrer/in</th><th>E-Mail</th><th>Termin</th><th></th></tr></thead><tbody>${list
      .map((r, i) => {
        const sent = (r.change.mails || []).filter((x) => x.kind === 'fahrer').at(-1)
        return `<tr><td><input type="checkbox" name="vm-pick" value="${i}" ${sent ? '' : 'checked'} aria-label="senden"></td><td><strong>${esc(r.vehicle.plate)}</strong></td><td>${esc(r.driver?.name || '–')}</td>
          <td><input type="email" id="vm-to-${i}" value="${esc(r.driver?.email || '')}" placeholder="E-Mail eintragen" aria-label="E-Mail ${esc(r.driver?.name || '')}"></td>
          <td>${formatDate(r.change.date)} ${esc(r.change.time)}${sent ? `<br><span class="muted">informiert ${new Date(sent.at).toLocaleDateString('de-AT')}</span>` : ''}</td>
          <td class="actions-cell">${canMail() ? '' : `<button class="btn small" data-action="vm-mailto" data-i="${i}">${ICON.send} E-Mail-Programm</button>`}${canDownload() ? `<button class="btn small" data-action="vm-ics" data-i="${i}">${ICON.calendar} .ics</button>` : ''}</td></tr>`
      })
      .join('')}</tbody></table></div>
      ${first ? `<details ${list.length === 1 ? 'open' : ''}><summary>Vorschau: ${esc(first.subject)}</summary><pre class="mail-preview">${esc(first.text)}</pre></details>` : ''}
      <p class="note">Fehlt eine Adresse, hier eintragen; sie wird bei der Person gespeichert. ${canMail() ? '' : 'Den Termin für den Kalender gibt es als .ics-Datei zum Anhängen.'}</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${canMail() ? `<button class="btn primary" data-action="vm-send">${ICON.send} Senden</button>` : ''}</div>`,
  })
}

registerModal('veh-mail', mailModal)

function noteMail(change, to, kind, via) {
  change.mails = [...(change.mails || []), { at: new Date().toISOString(), to, kind, via }]
}

/** Fehlende Adresse bei der Person speichern (Stammdaten, nur mit Recht). */
function rememberEmail(driver, to) {
  if (driver && to && !driver.email && canEdit('stammdaten')) driver.email = to
}

// ---------------------------------------------------------------- Aktionen

registerActions(
  {
    'veh-edit-open': (el) => {
      const v = el.dataset.id ? vehOf(el.dataset.id) : null
      openModal({ type: 'veh-edit', id: v?.id || null, draft: v ? structuredClone(v) : { plate: '', label: '', kind: 'transporter', driverId: '', workshopId: FZ().workshops[0]?.id || '', mounted: campaignFor(todayISO()).season === 'winter' ? 'sommer' : 'winter', tires: { sommer: blankSet(), winter: blankSet() }, note: '' } })
    },
    'veh-set': (el) => {
      const d = app.ui.modal.draft
      const value = el.type === 'number' ? (el.value === '' ? '' : Number(String(el.value).replace(',', '.'))) : el.value.trim()
      setPath(d, el.dataset.path, el.dataset.path === 'plate' ? value.toUpperCase() : value)
      if (el.dataset.path === 'mounted') {
        if (value === 'ganzjahr') d.tires = { ganzjahr: d.tires?.ganzjahr || { ...(d.tires?.sommer || blankSet()) } }
        else if (!d.tires?.sommer) d.tires = { sommer: { ...(d.tires?.ganzjahr || blankSet()) }, winter: blankSet() }
        renderModal()
      }
    },
    'veh-save': () => {
      const m = app.ui.modal
      const d = m.draft
      if (!d.plate) return toast('Bitte das Kennzeichen eintragen.')
      if (FZ().vehicles.some((v) => v.plate === d.plate && v.id !== m.id)) return toast(`${d.plate} gibt es schon.`)
      if (m.id) Object.assign(vehOf(m.id), d)
      else FZ().vehicles.push({ ...d, id: uid('v') })
      persist()
      closeModal()
      renderNow()
      toast(`${d.plate} gespeichert.`)
    },
    'veh-del': (el) => {
      if (!confirmStep('veh-del', renderModal)) return
      const fz = FZ()
      fz.vehicles = fz.vehicles.filter((v) => v.id !== el.dataset.id)
      fz.changes = fz.changes.filter((x) => x.vehicleId !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Fahrzeug gelöscht.')
    },
    'veh-ws-open': () => openModal({ type: 'veh-ws', draft: structuredClone(FZ().workshops) }),
    'veh-ws-set': (el) => {
      app.ui.modal.draft[Number(el.dataset.i)][el.dataset.k] = el.value.trim()
    },
    'veh-ws-add': () => {
      app.ui.modal.draft.push({ id: uid('w'), name: '', address: '', phone: '', email: '' })
      renderModalKeepingInput()
    },
    'veh-ws-del': (el) => {
      app.ui.modal.draft.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'veh-ws-save': () => {
      FZ().workshops = app.ui.modal.draft.filter((w) => w.name)
      persist()
      closeModal()
      renderNow()
      toast('Werkstätten gespeichert.')
    },
    'veh-import-open': () => openModal({ type: 'veh-import', text: '' }),
    'veh-import-run': () => {
      const { vehicles } = importVehicles(app.ui.modal.text || '', { employees: app.data.employees, workshops: FZ().workshops })
      let added = 0
      for (const v of vehicles) {
        const known = FZ().vehicles.find((x) => x.plate === v.plate)
        if (known) {
          for (const [k, val2] of Object.entries(v)) if (k !== 'tires' && val2 && !known[k]) known[k] = val2
          for (const s of ['sommer', 'winter']) if (v.tires?.[s]) known.tires = { ...known.tires, [s]: { ...v.tires[s], ...Object.fromEntries(Object.entries(known.tires?.[s] || {}).filter(([, x]) => x && (typeof x !== 'object' || Object.keys(x).length))) } }
        } else {
          FZ().vehicles.push({ ...v, id: uid('v') })
          added++
        }
      }
      persist()
      closeModal()
      renderNow()
      toast(`${plural(added, 'Fahrzeug', 'Fahrzeuge')} angelegt${vehicles.length - added ? `, ${vehicles.length - added} ergänzt` : ''}.`)
    },
    'veh-plan-open': async (el) => {
      const v = vehOf(el.dataset.id)
      const ch = el.dataset.change ? changeById(el.dataset.change) : null
      const today = todayISO()
      const campaign = campaignFor(today)
      const date = ch?.date || [addDays(today, 1), campaign.earliest].sort()[1]
      await ensureRange(date, addDays(date, 14)).catch(() => {})
      openModal({ type: 'veh-plan', vehicleId: v.id, changeId: ch?.id || null, date, time: ch?.time || '07:30', minutes: ch?.minutes || settings().slotMinutes, workshopId: ch?.workshopId || v.workshopId || '', note: ch?.note || '' })
    },
    'vp-update': async () => {
      const m = app.ui.modal
      const dateChanged = val('vp-date') && val('vp-date') !== m.date
      Object.assign(m, { date: val('vp-date') || m.date, time: val('vp-time') || m.time, minutes: Number(val('vp-min')) || 30, workshopId: val('vp-ws'), note: val('vp-note').trim() })
      if (dateChanged) await ensureRange(m.date, m.date).catch(() => {})
      renderModalKeepingInput()
    },
    'vp-next': () => {
      const m = app.ui.modal
      const v = vehOf(m.vehicleId)
      const taken = FZ().changes.filter((x) => x.status === 'geplant' && x.workshopId === m.workshopId && x.id !== m.changeId)
      const { proposals } = proposeSlots([v], { from: m.date, to: addDays(m.date, 14), slotMinutes: Number(m.minutes) || 30, travelMinutes: settings().travelMinutes, busyOf: busyLookup(m.date, addDays(m.date, 14)), taken })
      if (!proposals.length) return toast('In den nächsten zwei Wochen kein freier Platz zwischen 7 und 17 Uhr.')
      Object.assign(m, { date: proposals[0].date, time: proposals[0].time })
      renderModal()
      toast(`Vorschlag: ${formatDate(m.date)} ${m.time}${proposals[0].after ? ` (${proposals[0].after})` : ''}.`)
    },
    'vp-save': (el) => {
      const m = app.ui.modal
      Object.assign(m, { date: val('vp-date') || m.date, time: val('vp-time') || m.time, minutes: Number(val('vp-min')) || 30, workshopId: val('vp-ws'), note: val('vp-note').trim() })
      const campaign = campaignFor(todayISO())
      let ch = m.changeId ? changeById(m.changeId) : null
      const moved = ch && (ch.date !== m.date || ch.time !== m.time)
      if (ch) Object.assign(ch, { date: m.date, time: m.time, minutes: m.minutes, workshopId: m.workshopId, note: m.note, ...(moved ? { mails: [] } : {}) })
      else {
        ch = { id: uid('c'), vehicleId: m.vehicleId, season: campaign.season, year: campaign.year, date: m.date, time: m.time, minutes: m.minutes, workshopId: m.workshopId, note: m.note, status: 'geplant', mails: [] }
        FZ().changes.push(ch)
      }
      persist()
      renderNow()
      if (el.dataset.mail === '1') return openModal({ type: 'veh-mail', kind: 'fahrer', ids: [ch.id] })
      closeModal()
      toast(`Termin ${formatDate(ch.date)} ${ch.time} gespeichert${moved ? '; bitte neu informieren' : ''}.`)
    },
    'vp-cancel': () => {
      if (!confirmStep('vp-cancel', renderModal)) return
      const ch = changeById(app.ui.modal.changeId)
      if (ch) ch.status = 'abgesagt'
      persist()
      closeModal()
      renderNow()
      toast('Termin abgesagt. Fahrer/in und Werkstatt bitte selbst verständigen.')
    },
    'veh-propose-open': async () => {
      const today = todayISO()
      const campaign = campaignFor(today)
      const from = [addDays(today, 1), campaign.earliest].sort()[1]
      const s = settings()
      const m = { type: 'veh-propose', workshopId: FZ().workshops[0]?.id || '', from, to: addDays(from, 11), dayStart: '07:00', dayEnd: '17:00', slot: s.slotMinutes, travel: s.travelMinutes, all: false, result: null }
      await ensureRange(m.from, m.to).catch(() => {})
      m.result = propose(m)
      openModal(m)
    },
    'vq-run': async () => {
      const m = app.ui.modal
      Object.assign(m, { workshopId: val('vq-ws'), from: val('vq-from'), to: val('vq-to'), dayStart: val('vq-start') || '07:00', dayEnd: val('vq-end') || '17:00', slot: Number(val('vq-slot')) || 30, travel: Number(val('vq-travel')) || 0, all: document.getElementById('vq-all')?.checked || false })
      if (!m.from || !m.to || m.to < m.from) return toast('Bitte einen gültigen Zeitraum wählen.')
      await ensureRange(m.from, m.to).catch(() => {})
      m.result = propose(m)
      renderModal()
    },
    'vq-apply': () => {
      const m = app.ui.modal
      const picked = new Set([...document.querySelectorAll('input[name="vq-pick"]:checked')].map((x) => Number(x.value)))
      const campaign = campaignFor(todayISO())
      const created = m.result.proposals.filter((_, i) => picked.has(i)).map((p) => ({ id: uid('c'), vehicleId: p.vehicleId, season: campaign.season, year: campaign.year, date: p.date, time: p.time, minutes: p.minutes, workshopId: m.workshopId, note: '', status: 'geplant', mails: [] }))
      FZ().changes.push(...created)
      FZ().settings = { ...FZ().settings, slotMinutes: Number(m.slot) || 30, travelMinutes: Number(m.travel) || 0 }
      persist()
      renderNow()
      if (!created.length) return closeModal()
      openModal({ type: 'veh-mail', kind: 'fahrer', ids: created.map((x) => x.id) })
      toast(`${plural(created.length, 'Termin', 'Termine')} eingetragen. Jetzt die Fahrer/innen informieren?`)
    },
    'veh-done-open': (el) => openModal({ type: 'veh-done', changeId: el.dataset.change }),
    'vd-save': () => {
      const m = app.ui.modal
      const ch = changeById(m.changeId)
      const v = vehOf(ch.vehicleId)
      const read = (prefix) => Object.fromEntries(WHEELS.map(([k]) => [k, val(`${prefix}-${k}`) === '' ? '' : Number(val(`${prefix}-${k}`).replace(',', '.'))]).filter(([, x]) => x !== ''))
      Object.assign(ch, { status: 'erledigt', date: val('vd-date') || ch.date, doneAt: val('vd-date') || todayISO(), km: val('vd-km') ? Number(val('vd-km')) : '', cost: val('vd-cost') ? Number(val('vd-cost').replace(',', '.')) : '', storage: val('vd-storage').trim(), tread: read('vd-t'), removedTread: read('vd-r'), note: [ch.note, val('vd-note').trim()].filter(Boolean).join(' · ') })
      Object.assign(v, applyDone(v, ch))
      persist()
      closeModal()
      renderNow()
      const issues = tireIssues(v, ch.season, todayISO()).filter((i) => i.level === 'error')
      toast(`${v.plate}: ${SEASONS[ch.season]} montiert.${issues.length ? ` ${issues[0].text}` : ''}`)
    },
    'veh-mail-open': (el) => {
      if (el.dataset.kind === 'werkstatt') {
        const ws = planned(todayISO()).map((r) => r.st.change.workshopId).find(Boolean) || FZ().workshops[0]?.id
        return openModal({ type: 'veh-mail', kind: 'werkstatt', workshopId: ws })
      }
      openModal({ type: 'veh-mail', kind: 'fahrer', ids: el.dataset.ids.split(',').filter(Boolean) })
    },
    'vm-ws': (el) => {
      app.ui.modal.workshopId = el.value
      app.ui.modal.to = undefined
      renderModal()
    },
    'vm-send': async (el) => {
      const list = driverRows(app.ui.modal.ids)
      const picked = [...document.querySelectorAll('input[name="vm-pick"]:checked')].map((x) => Number(x.value))
      if (!picked.length) return toast('Bitte mindestens eine Person auswählen.')
      const missing = picked.filter((i) => !val(`vm-to-${i}`).trim())
      if (missing.length) return toast(`Bitte die E-Mail-Adresse für ${list[missing[0]].driver?.name || list[missing[0]].vehicle.plate} eintragen.`)
      el.disabled = true
      let ok = 0
      const failed = []
      for (const i of picked) {
        const r = list[i]
        const to = val(`vm-to-${i}`).trim()
        const mail = mailFor(r)
        try {
          await sendMail(app.auth.getToken, { to, subject: mail.subject, text: mail.text, attachments: [{ name: fileSafe(`Reifenwechsel_${r.vehicle.plate}_${r.change.date}.ics`), blob: new Blob([icsFor(r)], { type: 'text/calendar' }), type: 'text/calendar' }] }, { from: app.config.mail?.from || '' })
          noteMail(r.change, to, 'fahrer', 'graph')
          rememberEmail(r.driver, to)
          ok++
        } catch (err) {
          failed.push(`${r.vehicle.plate}: ${err.message}`)
        }
      }
      persist()
      renderNow()
      if (failed.length) {
        el.disabled = false
        renderModal()
        return toast(`${ok} gesendet, ${failed.length} fehlgeschlagen: ${failed[0]}`)
      }
      closeModal()
      toast(`${plural(ok, 'E-Mail', 'E-Mails')} mit Kalendertermin gesendet.`)
    },
    'vm-mailto': (el) => {
      const r = driverRows(app.ui.modal.ids)[Number(el.dataset.i)]
      const to = val(`vm-to-${el.dataset.i}`).trim()
      const mail = mailFor(r)
      noteMail(r.change, to || r.driver?.name || '', 'fahrer', 'mailto')
      rememberEmail(r.driver, to)
      persist()
      location.href = mailtoHref(to, mail.subject, mail.text)
      renderModalKeepingInput()
    },
    'vm-ics': (el) => {
      const r = driverRows(app.ui.modal.ids)[Number(el.dataset.i)]
      download(fileSafe(`Reifenwechsel_${r.vehicle.plate}_${r.change.date}.ics`), new Blob([icsFor(r)], { type: 'text/calendar;charset=utf-8' }))
    },
    'vm-send-ws': async (el) => {
      const m = app.ui.modal
      const to = val('vm-to').trim()
      if (!to) return toast('Bitte die E-Mail-Adresse der Werkstatt eintragen.')
      const list = planned(todayISO()).filter((r) => r.st.change.workshopId === m.workshopId)
      const subject = val('vm-subject').trim()
      const text = val('vm-text')
      const ws = wsOf(m.workshopId)
      if (ws && !ws.email) ws.email = to
      if (!canMail()) {
        for (const r of list) noteMail(r.st.change, to, 'werkstatt', 'mailto')
        persist()
        location.href = mailtoHref(to, subject, text)
        closeModal()
        renderNow()
        return
      }
      el.disabled = true
      try {
        const csv = tireCsv(list.map((r) => ({ vehicle: r.v, change: r.st.change, driver: empOf(r.v.driverId)?.name || '', workshop: ws?.name || '', status: r.st.status })))
        await sendMail(app.auth.getToken, { to, subject, text, attachments: [{ name: fileSafe(`Reifenwechsel_${campaignFor(todayISO()).key}.csv`), blob: new Blob([csv], { type: 'text/csv' }), type: 'text/csv' }] }, { from: app.config.mail?.from || '' })
        for (const r of list) noteMail(r.st.change, to, 'werkstatt', 'graph')
        persist()
        closeModal()
        renderNow()
        toast(`Liste mit ${plural(list.length, 'Termin', 'Terminen')} an ${to} gesendet.`)
      } catch (err) {
        el.disabled = false
        toast(`Senden fehlgeschlagen: ${err.message}`)
      }
    },
  },
  { edit: MODULE },
)

registerActions({
  'veh-import-text': (el) => {
    app.ui.modal.text = el.value
    renderModal()
    const t = document.getElementById('veh-import-text')
    t?.focus()
    t?.setSelectionRange(t.value.length, t.value.length)
  },
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'reifen',
  module: MODULE,
  title: 'Reifenwechsel',
  compute: (today) => {
    const list = rows(today)
    if (!list.length) return []
    const campaign = campaignFor(today)
    const items = []
    const open = list.filter((r) => ['offen', 'ueberfaellig'].includes(r.st.status))
    // ab 3 Wochen vor der Frist erinnern
    if (open.length && today >= addDays(campaign.by, -21)) items.push({ id: `open:${campaign.key}:${open.length}`, kind: 'open', list: open, late: today > campaign.by })
    for (const r of list.filter((x) => x.st.status === 'vorbei')) items.push({ id: `past:${r.st.change.id}`, kind: 'past', r })
    const soon = list.filter((r) => r.st.status === 'geplant' && !informed(r.st.change) && r.st.change.date <= addDays(today, 3))
    if (soon.length) items.push({ id: `inform:${soon.map((r) => r.st.change.id).join(',')}`, kind: 'inform', list: soon })
    for (const r of list) for (const i of tireIssues(r.v, r.v.mounted === 'ganzjahr' ? 'ganzjahr' : campaign.season, today).filter((x) => x.level === 'error')) items.push({ id: `tread:${r.v.id}:${campaign.key}`, kind: 'tread', r, text: i.text })
    return items
  },
  render: (items) =>
    items
      .map((it) => {
        if (it.kind === 'open') return `<div class="todo-item"><span class="flag ${it.late ? 'error' : 'warning'}">${it.list.length}</span><div class="todo-text"><strong>Reifenwechsel ohne Termin</strong><br><span class="muted">${esc(it.list.map((r) => r.v.plate).join(', '))}${it.late ? ' · Frist vorbei' : ''}</span></div><button class="btn small primary" data-action="veh-propose-open">Vorschlagen</button></div>`
        if (it.kind === 'past') return `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(it.r.v.plate)}</strong>: Reifenwechsel am ${formatDate(it.r.st.change.date)} bestätigen<br><span class="muted">Profil und Einlagerung eintragen</span></div><button class="btn small primary" data-action="veh-done-open" data-change="${esc(it.r.st.change.id)}">Erledigt</button></div>`
        if (it.kind === 'inform') return `<div class="todo-item"><span class="flag warning">${it.list.length}</span><div class="todo-text"><strong>Fahrer/innen noch nicht informiert</strong><br><span class="muted">${esc(it.list.map((r) => `${r.v.plate} ${formatDate(r.st.change.date)}`).join(', '))}</span></div><button class="btn small primary" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(it.list.map((r) => r.st.change.id).join(','))}">Informieren</button></div>`
        return `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(it.r.v.plate)}</strong>: ${esc(it.text)}</div><button class="btn small" data-action="veh-edit-open" data-id="${esc(it.r.v.id)}">Fahrzeug</button></div>`
      })
      .join(''),
})
