// Modul Fahrzeuge & Reifen: Firmenfahrzeuge mit Fahrer/in, Reifensätzen und
// Einlagerung. Reiter „Reifenwechsel“: je Saison Termine vorschlagen (neben
// den Diensten der Fahrer/innen), Fahrer/innen per E-Mail informieren (mit
// Kalendertermin), Sammelliste an die Werkstatt, Erledigt mit Profiltiefe.
// Reiter „Service & Pickerl“: §57a-Begutachtung, Service nach Datum/km und
// weitere Fälligkeiten; Werkstatttermine erledigen sie, auch zusammen mit dem
// Reifenwechsel.

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, dayIndex, formatDate, todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { icsEvent } from '../../core/ics.js'
import { holidayCalendar } from '../../core/holidays.js'
import { addKm, addMonths, applyTasksDone, classOf, currentKm, DUE_CLASS, DUE_LABEL, fleetCsv, kmFits, monthText, openTasks, parseKm, PICKERL_RESULTS, pickerlStatus, serviceStatus, suggestPickerl, taskLabel, VEHICLE_CLASSES, vehicleDues } from '../../core/vehicle-dues.js'
import { activeVehicles, applyDone, campaignFor, campaignSummary, changeWhat, conflicts, DEFAULT_SETTINGS, driverMail, importVehicles, lowestTread, minTread, proposeSlots, SEASONS, STATUS_CLASS, STATUS_LABEL, tireCsv, tireIssues, VEHICLE_KINDS, vehicleStatus, WHEELS, workshopMail } from '../../core/vehicles.js'
import { app, canEdit, closeModal, computeRange, confirmStep, empName, ensureRange, openModal, persist, registerActions, registerModal, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { registerTodo } from '../modals/todo.js'
import { download, esc, ICON, menu, modalFrame, options, rowMenu, uid, val } from '../shared.js'

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

/** Darf die Rolle die Dienste sehen? Sonst kennt die App sie nicht (Pläne/Abwesenheiten werden gar nicht geladen). */
const shiftsVisible = () => !app.access || app.access.sees('planung')

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
const activeIds = () => new Set(activeVehicles(FZ()).map((v) => v.id))
/** Alle geplanten Termine (Reifen und Werkstatt) ab heute. */
const upcoming = (today = todayISO()) => FZ().changes.filter((c) => c.status === 'geplant' && c.date >= today && activeIds().has(c.vehicleId))
const isWerkstatt = (c) => c.kind === 'werkstatt'
const kmText = (n) => `${Math.round(n).toLocaleString('de-AT')} km`
/** Fahrzeuge mit offenen Fälligkeiten (Service, Pickerl, weitere), dringendste zuerst. */
function serviceRows(today = todayISO()) {
  const rank = { abgelaufen: 0, nachfrist: 1, faellig: 2, bald: 3, ok: 4, unbekannt: 5 }
  return activeVehicles(FZ())
    .map((v) => ({ v, dues: vehicleDues(FZ(), v, today), open: openTasks(FZ(), v, today), change: FZ().changes.filter((c) => c.vehicleId === v.id && c.status === 'geplant' && (c.tasks || []).length).sort((a, b) => a.date.localeCompare(b.date))[0] || null }))
    .sort((a, b) => (rank[a.dues[0]?.status] ?? 9) - (rank[b.dues[0]?.status] ?? 9) || a.v.plate.localeCompare(b.v.plate, 'de'))
}
const urgentDue = (d) => ['abgelaufen', 'nachfrist', 'faellig'].includes(d.status)

// ---------------------------------------------------------------- Übersicht

function treadCell(v, season) {
  const low = lowestTread(v.tires?.[season]?.tread)
  if (low === null) return '<span class="muted">nicht erfasst</span>'
  const { legal, advised } = minTread(v, season === 'ganzjahr' ? 'winter' : season)
  return `<span class="pill ${low < legal ? 'error' : low < advised ? 'warning' : 'ok'}">${mm(low)} mm</span><br><span class="muted">${SEASONS[season]}, mind. ${mm(legal)}</span>`
}

function sectionHead(total) {
  const today = todayISO()
  const tab = app.ui.vehTab || 'reifen'
  const tireOpen = rows(today).filter((r) => ['offen', 'ueberfaellig', 'vorbei'].includes(r.st.status)).length
  const serviceOpen = serviceRows(today).filter((r) => r.dues.some((d) => urgentDue(d) && !d.change)).length
  return `<div class="section-head"><div><h2>${ICON.car} Fahrzeuge &amp; Reifen</h2>
      <p>Firmenfahrzeuge mit Fahrer/in, Reifen, Service und Pickerl. Termine werden neben den Diensten vorgeschlagen, Fahrer/innen bekommen eine E-Mail mit Kalendertermin, die Werkstatt eine Sammelliste.</p></div>
      <div class="actions">${editable() ? `<button class="btn" data-action="veh-edit-open">${ICON.plus} Fahrzeug</button>` : ''}${menu({
        label: 'Verwalten',
        icon: ICON.gear,
        single: false,
        items: [
          editable() && { label: `Werkstätten (${FZ().workshops.length})`, action: 'veh-ws-open', hint: 'Adresse, E-Mail, Öffnungszeiten' },
          editable() && { label: 'Liste aus Excel einfügen', icon: ICON.upload, action: 'veh-import-open' },
          total && canDownload() && { heading: 'Export' },
          total && canDownload() && { label: 'Fahrzeugliste (CSV)', icon: ICON.download, action: 'veh-csv' },
        ],
      })}</div></div>
    ${total ? `<div class="seg veh-tabs" role="tablist">${[['reifen', 'Reifenwechsel', tireOpen], ['service', 'Service & Pickerl', serviceOpen]].map(([k, label, n]) => `<button class="btn ${tab === k ? 'primary' : ''}" data-action="veh-tab" data-v="${k}" role="tab" aria-selected="${tab === k}">${label}${n ? ` <span class="flag ${tab === k ? '' : 'warning'}">${n}</span>` : ''}</button>`).join('')}</div>` : ''}`
}

function vehiclesView() {
  const today = todayISO()
  const fz = FZ()
  if ((app.ui.vehTab || 'reifen') === 'service' && activeVehicles(fz).length) return `${sectionHead(activeVehicles(fz).length)}${serviceView()}`
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
        ? `${formatDate(c.date)} ${esc(c.time || '')}${c.status === 'erledigt' ? ' <span class="pill ok">erledigt</span>' : ''}<br><span class="muted">${esc(wsOf(c.workshopId)?.name || '')}${(c.tasks || []).length ? ` · dazu ${esc(c.tasks.map((t) => taskLabel(v, t).replace(/^§57a-Begutachtung \(Pickerl\)$/, 'Pickerl')).join(', '))}` : ''}</span>
          ${c.status === 'geplant' ? `<br>${informed(c) ? '<span class="pill ok">✓ informiert</span>' : '<span class="pill warning">noch nicht informiert</span>'}${informed(c, 'werkstatt') ? ' <span class="pill info">Werkstatt</span>' : ''}` : ''}
          ${clash.length ? `<br><span class="check warning">⚠ ${esc(clash.map((x) => x.text).join('; '))}</span>` : ''}${st.early ? '<br><span class="check warning">⚠ vor dem 16. April</span>' : ''}`
        : '<span class="muted">–</span>'
      const booked = st.status === 'geplant' || st.status === 'vorbei'
      const acts = editable()
        ? `${['offen', 'ueberfaellig'].includes(st.status) ? `<button class="btn small primary" data-action="veh-plan-open" data-id="${esc(v.id)}">${ICON.calendar} Termin</button>` : ''}${booked ? `<button class="btn small ${st.status === 'vorbei' ? 'primary' : ''}" data-action="veh-done-open" data-change="${esc(c.id)}">${ICON.check} Erledigt</button>` : ''} ${rowMenu(
            [
              booked && { label: 'Termin ändern', icon: ICON.calendar, action: 'veh-plan-open', data: { id: v.id, change: c.id } },
              st.status === 'geplant' && { label: 'Fahrer/in per E-Mail informieren', icon: ICON.send, action: 'veh-mail-open', data: { kind: 'fahrer', ids: c.id } },
              booked && '-',
              { label: 'Fahrzeug bearbeiten', icon: ICON.car, action: 'veh-edit-open', data: { id: v.id } },
            ],
            `Weitere Aktionen für ${v.plate}`,
          )}`
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
  return `${sectionHead(total)}
    ${
      total
        ? `<div class="summary">
      <div class="stat"><div class="label">Wechselrunde</div><div class="value">${esc(campaign.label)}</div><div class="muted">bis ${formatDate(campaign.by, { weekday: false, year: true })}</div></div>
      <div class="stat"><div class="label">Umgerüstet</div><div class="value">${counts.erledigt + counts.ganzjahr} / ${total}</div><div class="muted">${counts.ganzjahr ? `davon ${counts.ganzjahr} Ganzjahr` : 'Fahrzeuge'}</div></div>
      <div class="stat"><div class="label">Termin geplant</div><div class="value">${counts.geplant + counts.vorbei}</div><div class="muted">${uninformed ? `${uninformed} noch nicht informiert` : 'alle informiert'}</div></div>
      <div class="stat ${open ? 'warn' : ''}"><div class="label">Ohne Termin</div><div class="value">${open}</div><div class="muted">${counts.ueberfaellig ? `${counts.ueberfaellig} überfällig` : open ? 'bitte planen' : 'passt'}</div></div>
    </div>
    <p class="note">${esc(rule)}</p>
    ${editable() ? `<div class="actions veh-campaign">${open ? `<button class="btn primary" data-action="veh-propose-open">${ICON.bolt} Termine vorschlagen (${open})</button>` : ''}${uninformed ? `<button class="btn ${open ? '' : 'primary'}" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(planned(today).filter((r) => !informed(r.st.change)).map((r) => r.st.change.id).join(','))}">${ICON.send} Fahrer/innen informieren (${uninformed})</button>` : ''}${upcoming(today).length ? `<button class="btn" data-action="veh-mail-open" data-kind="werkstatt">${ICON.send} Liste an Werkstatt</button>` : ''}</div>` : ''}
    <div class="toolbar filters-bar"><div class="seg" role="group" aria-label="Filter">${[['alle', `Alle (${list.length})`], ['offen', `Zu tun (${open + counts.vorbei})`], ['geplant', `Geplant (${counts.geplant})`]].map(([k, label]) => `<button class="btn small ${filter === k ? 'primary' : ''}" data-action="veh-filter" data-v="${k}">${label}</button>`).join('')}</div></div>
    <div class="table-wrap"><table class="data veh-table"><thead><tr><th>Fahrzeug</th><th>Fahrer/in</th><th>Montiert</th><th>Termin</th><th>Profil</th><th>Stand</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="7" class="muted">Nichts in dieser Auswahl.</td></tr>'}</tbody></table></div>
    ${issues.length ? `<section><h3>Profil und Reifenalter</h3>${issues.map((i) => `<p class="check ${i.level}">${i.level === 'error' ? '⚠ ' : ''}<strong>${esc(i.v.plate)}</strong> ${esc(i.text)}</p>`).join('')}</section>` : ''}`
        : empty
    }`
}

// ---------------------------------------------------------------- Service & Pickerl

function pickerlCell(v, today) {
  const p = pickerlStatus(v, today)
  if (p.status === 'unbekannt') return '<span class="muted">nicht eingetragen</span>'
  const note = p.status === 'abgelaufen' ? `abgelaufen seit ${formatDate(p.to, { weekday: false })}` : p.status === 'nachfrist' ? `Nachfrist bis ${formatDate(p.to, { weekday: false, year: true })}` : p.status === 'faellig' ? `jetzt, bis ${formatDate(p.end, { weekday: false })}` : `ab ${formatDate(p.from, { weekday: false, year: true })}`
  return `<strong>${monthText(p.due)}</strong> <span class="pill ${DUE_CLASS[p.status]}">${esc(DUE_LABEL[p.status])}</span><br><span class="muted">${esc(classOf(v))} · ${esc(note)}${p.guessed ? ' · geschätzt, Plakette eintragen' : ''}</span>`
}

function serviceCell(v, today) {
  const s = serviceStatus(v, today)
  if (s.status === 'unbekannt') return '<span class="muted">nicht eingetragen</span>'
  const parts = [s.date ? formatDate(s.date, { weekday: false, year: true }) : '', s.km ? kmText(s.km) : ''].filter(Boolean).join(' oder ')
  const hint = [s.left !== null && s.left !== undefined ? (s.left > 0 ? `noch ${kmText(s.left)}` : `${kmText(-s.left)} drüber`) : '', s.kmDate && s.km ? `km erreicht ~${formatDate(s.kmDate, { weekday: false, year: s.kmDate.slice(0, 4) !== today.slice(0, 4) })}` : ''].filter(Boolean).join(' · ')
  return `${esc(parts)} <span class="pill ${DUE_CLASS[s.status]}">${esc(DUE_LABEL[s.status])}</span>${hint ? `<br><span class="muted">${esc(hint)}</span>` : ''}`
}

function serviceView() {
  const today = todayISO()
  const list = serviceRows(today)
  const all = list.flatMap((r) => r.dues.map((d) => ({ ...d, v: r.v })))
  const pick = all.filter((d) => d.task === 'pickerl')
  const svc = all.filter((d) => d.task === 'service')
  const other = all.filter((d) => d.task.startsWith('due:'))
  const werk = upcoming(today).filter((c) => (c.tasks || []).length)
  const uninformed = werk.filter((c) => !informed(c))
  const toPlan = list.filter((r) => r.open.length)
  const travel = settings().travelMinutes
  const dates = werk.map((c) => c.date).sort()
  const busy = dates.length ? busyLookup(dates[0], dates.at(-1)) : null
  const body = list
    .map(({ v, dues, open, change }) => {
      const km = currentKm(v)
      const s = serviceStatus(v, today)
      const clash = change && v.driverId && busy && change.date >= today ? conflicts(busy(v.driverId, change.date), change.time, change.minutes || 60, travel) : []
      const others = dues.filter((d) => d.task.startsWith('due:'))
      const term = change
        ? `${formatDate(change.date)} ${esc(change.time)}<br><span class="muted">${esc(wsOf(change.workshopId)?.name || '')} · ${esc(changeWhat(change, v))}</span><br>${informed(change) ? '<span class="pill ok">✓ informiert</span>' : '<span class="pill warning">noch nicht informiert</span>'}${clash.length ? `<br><span class="check warning">⚠ ${esc(clash.map((x) => x.text).join('; '))}</span>` : ''}${change.date < today ? '<br><span class="check warning">Termin vorbei, bitte bestätigen</span>' : ''}`
        : '<span class="muted">–</span>'
      const acts = editable()
        ? `${open.length && !change ? `<button class="btn small primary" data-action="veh-plan-open" data-id="${esc(v.id)}" data-kind="werkstatt">${ICON.calendar} Werkstatttermin</button>` : ''}${change ? `<button class="btn small ${change.date < today ? 'primary' : ''}" data-action="veh-done-open" data-change="${esc(change.id)}">${ICON.check} Erledigt</button>` : ''} <button class="btn small" data-action="veh-km-open" data-id="${esc(v.id)}">km</button> ${rowMenu(
            [
              change && { label: 'Termin ändern', icon: ICON.calendar, action: 'veh-plan-open', data: { id: v.id, change: change.id } },
              change && { label: 'Fahrer/in per E-Mail informieren', icon: ICON.send, action: 'veh-mail-open', data: { kind: 'fahrer', ids: change.id } },
              change && '-',
              { label: 'Fahrzeug bearbeiten', icon: ICON.car, action: 'veh-edit-open', data: { id: v.id } },
            ],
            `Weitere Aktionen für ${v.plate}`,
          )}`
        : ''
      return `<tr><td><strong>${esc(v.plate)}</strong><br><span class="muted">${esc([v.label, classOf(v)].filter(Boolean).join(' · '))}</span></td>
        <td>${esc(empOf(v.driverId)?.name || '–')}</td>
        <td class="num">${km ? `${kmText(km.km)}<br><span class="muted">am ${formatDate(km.date, { weekday: false })}${s.perMonth ? ` · ~${s.perMonth.toLocaleString('de-AT')}/Monat` : ''}</span>` : '<span class="muted">–</span>'}</td>
        <td>${pickerlCell(v, today)}</td>
        <td>${serviceCell(v, today)}</td>
        <td>${others.length ? others.map((d) => `${esc(d.label)} <span class="muted">${formatDate(d.date, { weekday: false, year: true })}</span>${d.status === 'ok' ? '' : ` <span class="pill ${DUE_CLASS[d.status]}">${esc(DUE_LABEL[d.status])}</span>`}`).join('<br>') : '<span class="muted">–</span>'}</td>
        <td>${term}</td>
        <td class="actions-cell">${acts}</td></tr>`
    })
    .join('')
  const count = (arr, ...st) => arr.filter((d) => st.includes(d.status)).length
  return `<div class="summary">
      <div class="stat ${count(pick, 'abgelaufen') ? 'warn' : ''}"><div class="label">Pickerl</div><div class="value">${count(pick, 'faellig', 'nachfrist', 'abgelaufen')}</div><div class="muted">${count(pick, 'abgelaufen') ? `${count(pick, 'abgelaufen')} abgelaufen` : 'jetzt fällig'}${count(pick, 'bald') ? `, ${count(pick, 'bald')} bald` : ''}</div></div>
      <div class="stat"><div class="label">Service</div><div class="value">${count(svc, 'faellig')}</div><div class="muted">fällig${count(svc, 'bald') ? `, ${count(svc, 'bald')} bald` : ''}</div></div>
      <div class="stat"><div class="label">Weitere Fälligkeiten</div><div class="value">${count(other, 'faellig', 'bald')}</div><div class="muted">in den nächsten 30 Tagen</div></div>
      <div class="stat"><div class="label">Werkstatttermine</div><div class="value">${werk.length}</div><div class="muted">${uninformed.length ? `${uninformed.length} noch nicht informiert` : 'alle informiert'}</div></div>
    </div>
    <p class="note">Pickerl (§57a): Pkw 3-2-1 Jahre ab Erstzulassung (ab 1 Monat vorher bis 4 Monate danach); ab 19. Mai 2027 4-2-2-2-1, dann ab 4 Monate vorher und ohne Nachfrist. Lkw und Kastenwagen (N1–N3): jährlich, ab 3 Monate vorher bis Monatsende. Maßgeblich ist der Monat auf der Plakette. Service: nach Datum oder km, was zuerst kommt.</p>
    ${editable() ? `<div class="actions veh-campaign">${toPlan.length ? `<button class="btn primary" data-action="veh-propose-open" data-kind="werkstatt">${ICON.bolt} Werkstatttermine vorschlagen (${toPlan.length})</button>` : ''}${uninformed.length ? `<button class="btn" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(uninformed.map((c) => c.id).join(','))}">${ICON.send} Fahrer/innen informieren (${uninformed.length})</button>` : ''}${upcoming(today).length ? `<button class="btn" data-action="veh-mail-open" data-kind="werkstatt">${ICON.send} Liste an Werkstatt</button>` : ''}</div>` : ''}
    <div class="table-wrap"><table class="data veh-table"><thead><tr><th>Fahrzeug</th><th>Fahrer/in</th><th>km-Stand</th><th>Pickerl</th><th>Service</th><th>Weitere</th><th>Termin</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
}

registerView({ id: 'fahrzeuge', order: 95, label: 'Fahrzeuge & Reifen', group: 'fuhrpark', module: MODULE, noWeek: true, mobile: { icon: ICON.car, label: 'Reifen' }, badge: () => rows().filter((r) => ['offen', 'ueberfaellig', 'vorbei'].includes(r.st.status)).length + serviceRows().filter((r) => r.dues.some((d) => urgentDue(d) && !d.change)).length, render: vehiclesView })

registerActions({
  'veh-filter': (el) => {
    app.ui.vehFilter = el.dataset.v
    renderNow()
  },
  'veh-tab': (el) => {
    app.ui.vehTab = el.dataset.v
    renderNow()
  },
  'veh-csv': () => {
    const today = todayISO()
    if (app.ui.vehTab === 'service') {
      const data = serviceRows(today).map(({ v, change }) => ({ vehicle: v, driver: empOf(v.driverId)?.name || '', today, change }))
      return download(`Fahrzeuge_Service_Pickerl_${today}.csv`, new Blob([fleetCsv(data)], { type: 'text/csv;charset=utf-8' }))
    }
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
// type 'km': Texteingabe, „59.000“ gilt als 59000 (Zahlenfelder lesen den Punkt als Komma)
const field = (path, label, value, { type = 'text', placeholder = '', cls = '' } = {}) =>
  `<label class="field ${cls}"><span>${esc(label)}</span><input type="${type === 'km' ? 'text' : type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" data-change="veh-set" data-path="${path}" ${type === 'number' ? 'inputmode="decimal" step="0.1"' : type === 'km' ? 'inputmode="numeric" data-km="1"' : ''}></label>`

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
    title: m.id ? `Fahrzeug ${d.plate || ''}` : 'Neues Fahrzeug',
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
      <p class="note">Mindestprofil: Sommerreifen 1,6 mm (empfohlen 3 mm), Winterreifen 4 mm, bei Lkw über 3,5 t 5 mm. Ab 6 Jahren (DOT) wird der Tausch empfohlen.</p>
      ${duesFieldset(d)}`,
    foot: `${m.id ? `<button class="btn ${app.ui.confirm === 'veh-del' ? 'danger confirm' : 'danger'}" data-action="veh-del" data-id="${esc(m.id)}">${app.ui.confirm === 'veh-del' ? 'Wirklich löschen?' : 'Löschen'}</button>` : '<button class="btn" data-action="close-modal">Abbrechen</button>'}
      <div class="actions"><button class="btn primary" data-action="veh-save">Speichern</button></div>`,
  })
}

function duesFieldset(d) {
  const today = todayISO()
  const p = pickerlStatus(d, today)
  const cur = currentKm(d)
  const s = d.service || {}
  return `<fieldset class="veh-set"><legend>Zulassung und Pickerl</legend><div class="form-grid">
      <label class="field"><span>Fahrzeugklasse (Zulassungsschein, Feld J)</span><select data-change="veh-set" data-path="cls" data-rerender="1">${options(Object.entries(VEHICLE_CLASSES), classOf(d))}</select></label>
      ${field('firstReg', 'Erstzulassung', d.firstReg, { type: 'month' })}
      ${field('pickerl.next', 'Nächstes Pickerl laut Plakette', d.pickerl?.next, { type: 'month' })}
      ${field('kmNow', 'km-Stand jetzt', d.kmNow ?? '', { type: 'km', placeholder: cur ? `zuletzt ${kmText(cur.km)}` : '' })}
    </div>${!d.pickerl?.next && p.due ? `<p class="note">Ohne Plakette geschätzt: ${monthText(p.due)} (Klasse ${esc(classOf(d))}, Erstzulassung ${monthText(d.firstReg)}). Den gestanzten Monat eintragen, dann stimmt es sicher.</p>` : ''}</fieldset>
    <fieldset class="veh-set"><legend>Service (was zuerst kommt)</legend><div class="form-grid">
      ${field('service.months', 'alle … Monate', s.months, { type: 'number', placeholder: '12' })}
      ${field('service.km', 'alle … km', s.km, { type: 'km', placeholder: '30.000' })}
      ${field('service.lastDate', 'Letztes Service am', s.lastDate, { type: 'date' })}
      ${field('service.lastKm', 'bei km', s.lastKm, { type: 'km' })}
      ${field('service.nextDate', 'Nächstes am (laut Anzeige/Pickerl im Auto)', s.nextDate, { type: 'date' })}
      ${field('service.nextKm', 'oder bei km', s.nextKm, { type: 'km' })}
    </div><p class="note">„Nächstes“ leer lassen, dann rechnet die App aus letztem Service und Intervall.</p></fieldset>
    <fieldset class="veh-set"><legend>Weitere Fälligkeiten</legend>
      ${(d.dues || []).map((x, i) => `<div class="mp-row"><input type="text" value="${esc(x.label || '')}" placeholder="z. B. Leasingende, Tachograph, Verbandskasten" aria-label="Bezeichnung" data-change="veh-set" data-path="dues.${i}.label"><input type="date" value="${esc(x.date || '')}" aria-label="fällig am" data-change="veh-set" data-path="dues.${i}.date"><input type="number" value="${esc(x.months ?? '')}" placeholder="wiederholen alle … Monate" aria-label="wiederholen alle Monate" data-change="veh-set" data-path="dues.${i}.months"><input type="text" value="${esc(x.note || '')}" placeholder="Hinweis" aria-label="Hinweis" data-change="veh-set" data-path="dues.${i}.note"><button type="button" class="btn small danger" data-action="veh-due-del" data-i="${i}" aria-label="Entfernen">×</button></div>`).join('')}
      <button type="button" class="btn small" data-action="veh-due-add">${ICON.plus} Fälligkeit</button></fieldset>`
}

registerModal('veh-edit', editModal, { module: MODULE })

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
  const res = m.text ? importVehicles(m.text, { employees: app.data.employees, workshops: FZ().workshops, today: todayISO() }) : null
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
  if (!shiftsVisible()) return `<p class="note">Die Dienste von ${esc(empName(empId))} sind für deine Rolle nicht einsehbar. Termin bitte mit dem Büro abstimmen.</p>`
  if (!empId) return '<p class="note">Ohne feste/n Fahrer/in: jemand bringt das Fahrzeug hin.</p>'
  const list = busy(empId, date)
  return `<p class="note"><strong>${esc(empName(empId))} am ${formatDate(date)}:</strong> ${list.length ? list.map((b) => (b.allDay ? esc(b.label) : `${String(Math.floor(b.start / 60)).padStart(2, '0')}:${String(b.start % 60).padStart(2, '0')}–${String(Math.floor(b.end / 60) % 24).padStart(2, '0')}:${String(b.end % 60).padStart(2, '0')} ${esc(b.label)}`)).join(' · ') : 'kein Dienst'}</p>`
}

/** Aufgaben zum Ankreuzen: Reifenwechsel „gleich mit erledigen“ (nur Fälliges), Werkstatttermin (alles). */
function taskChoices(v, m) {
  const today = todayISO()
  const dues = vehicleDues(FZ(), v, today).filter((d) => !d.change || d.change.id === m.changeId)
  const list = m.kind === 'werkstatt' ? dues : dues.filter((d) => d.status !== 'ok' || m.tasks.includes(d.task))
  if (!list.length) return m.kind === 'werkstatt' ? '<p class="check warning">Für dieses Fahrzeug ist nichts eingetragen (Pickerl, Service, weitere Fälligkeiten unter „Bearbeiten“).</p>' : ''
  return `<fieldset class="veh-set"><legend>${m.kind === 'werkstatt' ? 'Was wird gemacht?' : 'Gleich mit erledigen'}</legend>${list
    .map((d) => `<label class="field inline"><input type="checkbox" name="vp-task" value="${esc(d.task)}" ${m.tasks.includes(d.task) ? 'checked' : ''} data-change="vp-update"><span>${esc(taskLabel(v, d.task))} <span class="pill ${DUE_CLASS[d.status]}">${esc(DUE_LABEL[d.status])}</span>${d.date ? ` <span class="muted">${formatDate(d.date, { weekday: false, year: true })}</span>` : ''}</span></label>`)
    .join('')}</fieldset>`
}

function planModal(c, m) {
  const v = vehOf(m.vehicleId)
  if (!v) return ''
  const campaign = campaignFor(todayISO())
  const date = m.date
  const busy = busyLookup(date, date)
  const clash = v.driverId ? conflicts(busy(v.driverId, date), m.time, Number(m.minutes) || 30, settings().travelMinutes) : []
  const ch = m.changeId ? changeById(m.changeId) : null
  const tire = m.kind !== 'werkstatt'
  return modalFrame({
    title: `${tire ? 'Reifenwechsel' : 'Werkstatttermin'} ${v.plate}`,
    subtitle: `${esc(v.label || '')}${tire ? ` · auf ${esc(SEASONS[campaign.season])}` : ''} · Fahrer/in: ${esc(empOf(v.driverId)?.name || '–')}`,
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="vp-date" value="${esc(date)}" data-change="vp-update"></label>
        <label class="field"><span>Uhrzeit</span><input type="time" id="vp-time" value="${esc(m.time)}" step="300" data-change="vp-update"></label>
        <label class="field"><span>Dauer (Min.)</span><input type="number" id="vp-min" value="${esc(m.minutes)}" min="10" step="5" data-change="vp-update"></label>
        <label class="field"><span>Werkstatt</span><select id="vp-ws" data-change="vp-update">${options(FZ().workshops.map((w) => [w.id, w.name]), m.workshopId, { empty: '–' })}</select></label>
        <label class="field wide"><span>Hinweis für die Fahrerin / den Fahrer</span><input type="text" id="vp-note" value="${esc(m.note || '')}" placeholder="z. B. Laderaum vorher ausräumen" data-change="vp-update"></label>
      </div>
      ${taskChoices(v, m)}
      ${dayPlan(busy, v.driverId, date)}
      ${clash.length ? clash.map((x) => `<p class="check warning">⚠ Überschneidung (mit ${settings().travelMinutes} Min. Fahrzeit): ${esc(x.text)}</p>`).join('') : v.driverId && shiftsVisible() ? '<p class="check ok">Passt zu den Diensten.</p>' : ''}
      ${tire && campaign.season === 'sommer' && date < campaign.earliest ? '<p class="check warning">⚠ Vor dem 16. April: bei winterlichen Verhältnissen gilt noch die Winterreifenpflicht.</p>' : ''}
      <p class="actions"><button type="button" class="btn small" data-action="vp-next">${ICON.bolt} Nächsten freien Termin suchen</button></p>`,
    foot: `${ch ? `<button class="btn ${app.ui.confirm === 'vp-cancel' ? 'danger confirm' : 'danger'}" data-action="vp-cancel">${app.ui.confirm === 'vp-cancel' ? 'Termin wirklich absagen?' : 'Termin absagen'}</button>` : '<button class="btn" data-action="close-modal">Abbrechen</button>'}
      <div class="actions"><button class="btn" data-action="vp-save" data-mail="0">Speichern</button><button class="btn primary" data-action="vp-save" data-mail="1">${ICON.send} Speichern &amp; informieren</button></div>`,
  })
}

registerModal('veh-plan', planModal, { module: MODULE })

// ---------------------------------------------------------------- Termine vorschlagen

function propose(m) {
  const today = todayISO()
  const candidates = m.kind === 'werkstatt' ? serviceRows(today).filter((r) => r.open.length && !r.change) : rows(today).filter((r) => ['offen', 'ueberfaellig'].includes(r.st.status))
  const open = candidates.filter((r) => !m.workshopId || m.all || r.v.workshopId === m.workshopId || !r.v.workshopId)
  const taken = FZ().changes.filter((x) => x.status === 'geplant' && x.workshopId === m.workshopId)
  const busy = busyLookup(m.from, m.to)
  const holidays = holidayCalendar(m.from, m.to, app.data.extraFreeDays)
  return { open, ...proposeSlots(open.map((r) => r.v), { from: m.from, to: m.to, dayStart: m.dayStart, dayEnd: m.dayEnd, slotMinutes: Number(m.slot) || 30, travelMinutes: Number(m.travel) || 0, busyOf: busy, taken, holidays }) }
}

function proposeModal(c, m) {
  const res = m.result
  return modalFrame({
    title: m.kind === 'werkstatt' ? 'Werkstatttermine vorschlagen' : 'Termine vorschlagen',
    subtitle: !shiftsVisible() ? 'Je Fahrzeug der erste freie Platz der Werkstatt. Die Dienste sind für deine Rolle nicht einsehbar: Termine bitte mit dem Büro abstimmen.' : m.kind === 'werkstatt' ? 'Für fälliges Service, Pickerl und weitere Fälligkeiten: je Fahrzeug der erste freie Platz ohne Dienst' : 'Je Fahrzeug der erste freie Platz, an dem die Fahrerin oder der Fahrer keinen Dienst hat',
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

registerModal('veh-propose', proposeModal, { module: MODULE })

// ---------------------------------------------------------------- Erledigt

/** Abschnitte je Aufgabe im Erledigt-Dialog: Service (nächstes), Pickerl (Ergebnis, Plakette), weitere. */
function taskDone(v, ch) {
  return (ch.tasks || [])
    .map((task) => {
      if (task === 'service') {
        const s = v.service || {}
        return `<fieldset class="veh-set"><legend>Service</legend><div class="form-grid">
          <label class="field"><span>Nächstes Service am</span><input type="date" id="vd-s-date" value="${esc(Number(s.months) ? addMonths(ch.date, Number(s.months)) : '')}"></label>
          <label class="field"><span>oder bei km</span><input type="text" id="vd-s-km" inputmode="numeric" placeholder="${Number(s.km) ? `km-Stand + ${Number(s.km).toLocaleString('de-AT')}` : 'laut Serviceheft'}"></label></div></fieldset>`
      }
      if (task === 'pickerl') {
        return `<fieldset class="veh-set"><legend>Pickerl (§57a)</legend><div class="form-grid">
          <label class="field"><span>Ergebnis</span><select id="vd-p-result">${options(Object.entries(PICKERL_RESULTS), 'ok')}</select></label>
          <label class="field"><span>Nächste Begutachtung laut neuer Plakette</span><input type="month" id="vd-p-next" value="${esc(suggestPickerl(v, ch.date) || '')}"></label></div>
          <p class="note">Vorschlag aus Klasse ${esc(classOf(v))} und Erstzulassung; bitte den gestanzten Monat der neuen Plakette übernehmen. Bei schweren Mängeln gibt es keine Plakette: reparieren und neu vorführen.</p></fieldset>`
      }
      const d = (v.dues || []).find((x) => `due:${x.id}` === task)
      return d ? `<label class="field inline"><input type="checkbox" id="vd-${esc(task.replace(':', '-'))}" checked><span>${esc(d.label)} erledigt${Number(d.months) ? ` (danach wieder in ${d.months} Monaten)` : ''}</span></label>` : ''
    })
    .join('')
}

function doneModal(c, m) {
  const ch = changeById(m.changeId)
  const v = ch && vehOf(ch.vehicleId)
  if (!v) return ''
  const tire = (ch.kind || 'reifen') === 'reifen'
  const other = ch.season === 'winter' ? 'sommer' : 'winter'
  const treadRow = (prefix, label) => `<div class="veh-tread"><span class="muted">${label}</span>${WHEELS.map(([k, l]) => `<label class="field inline"><span>${l}</span><input type="number" id="${prefix}-${k}" step="0.1" min="0" max="15" inputmode="decimal" aria-label="${label} ${l}"></label>`).join('')}</div>`
  return modalFrame({
    title: `${tire ? 'Reifenwechsel' : 'Werkstatttermin'} erledigt: ${v.plate}`,
    subtitle: tire ? `jetzt ${esc(SEASONS[ch.season])} montiert${(ch.tasks || []).length ? ` · dazu ${esc(ch.tasks.map((t) => taskLabel(v, t)).join(', '))}` : ''}` : esc(changeWhat(ch, v)),
    body: `<div class="form-grid">
        <label class="field"><span>Datum</span><input type="date" id="vd-date" value="${esc(ch.date || todayISO())}"></label>
        <label class="field"><span>km-Stand</span><input type="text" id="vd-km" inputmode="numeric" placeholder="${currentKm(v) ? `zuletzt ${kmText(currentKm(v).km)}` : ''}"></label>
        <label class="field"><span>Kosten (€, optional)</span><input type="number" id="vd-cost" inputmode="decimal" min="0" step="0.01"></label>
        ${tire ? `<label class="field wide"><span>${esc(SEASONS[other])} eingelagert bei / wo</span><input type="text" id="vd-storage" value="${esc(v.tires?.[other]?.storage || v.tires?.[ch.season]?.storage || (wsOf(ch.workshopId)?.name ?? ''))}"></label>` : ''}
      </div>
      ${tire ? `${treadRow('vd-t', `Profil ${SEASONS[ch.season]} (montiert), mm`)}${treadRow('vd-r', `Profil ${SEASONS[other]} (eingelagert), mm`)}` : ''}
      ${taskDone(v, ch)}
      <label class="field"><span>Bemerkung</span><input type="text" id="vd-note" placeholder="${tire ? 'z. B. Ventil getauscht' : 'z. B. Bremsbeläge vorne neu'}"></label>
      ${tire ? '<p class="note">Das Profil steht auf der Rechnung oder dem Prüfblatt der Werkstatt. Liegt es unter dem Mindestprofil, kommt es in „Zu erledigen“.</p>' : ''}`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="vd-save">Speichern</button></div>',
  })
}

registerModal('veh-done', doneModal, { module: MODULE })

registerModal('veh-km', (c, m) => {
  const v = vehOf(m.id)
  const cur = currentKm(v)
  return modalFrame({
    title: `km-Stand ${v.plate}`,
    subtitle: cur ? `zuletzt ${kmText(cur.km)} am ${formatDate(cur.date, { weekday: false, year: true })}` : 'noch kein km-Stand',
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="vk-date" value="${esc(todayISO())}"></label><label class="field"><span>km-Stand</span><input type="text" id="vk-km" inputmode="numeric" autofocus></label></div>
      <p class="note">Aus den km-Ständen rechnet die App hoch, wann das Service nach km fällig wird. Am einfachsten bei jedem Tanken oder Werkstattbesuch eintragen.</p>`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="vk-save">Speichern</button></div>',
  })
})

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
const icsFor = (r) => icsEvent({ uid: `${r.change.id}@reifenwechsel`, date: r.change.date, time: r.change.time, minutes: r.change.minutes || 30, title: `${(r.change.kind || 'reifen') === 'reifen' && !(r.change.tasks || []).length ? 'Reifenwechsel' : 'Werkstatttermin'} ${r.vehicle.plate}`, location: [r.workshop?.name, r.workshop?.address].filter(Boolean).join(', '), description: mailFor(r).text, remindHours: 12 })
const mailtoHref = (to, subject, body) => `mailto:${encodeURIComponent(to || '').replace(/%40/g, '@').replace(/%2C/g, ',')}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`

/** Geplante Termine bei einer Werkstatt (Reifen und Werkstatt) ab heute. */
const workshopRows = (workshopId) => upcoming().filter((c) => c.workshopId === workshopId).map((change) => ({ change, vehicle: vehOf(change.vehicleId) }))

function mailModal(c, m) {
  if (m.kind === 'werkstatt') {
    const ws = wsOf(m.workshopId)
    const list = workshopRows(m.workshopId)
    const draft = workshopMail({ rows: list, workshop: ws, campaign: campaignFor(todayISO()), sender: userName(), brand: app.config.brand.name || '' })
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
    title: list.length === 1 ? `Fahrer/in informieren: ${list[0].vehicle.plate}` : 'Fahrer/innen informieren',
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

registerModal('veh-mail', mailModal, { module: MODULE })

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
      const value = el.dataset.km ? (el.value.trim() === '' ? '' : parseKm(el.value) ?? '') : el.type === 'number' ? (el.value === '' ? '' : Number(String(el.value).replace(',', '.'))) : el.value.trim()
      setPath(d, el.dataset.path, el.dataset.path === 'plate' ? value.toUpperCase() : value)
      if (el.dataset.rerender && el.dataset.path !== 'mounted') return renderModal()
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
      if (d.kmNow && !kmFits(d, todayISO(), d.kmNow)) return toast(`${kmText(d.kmNow)} passt nicht zu den bisherigen km-Ständen (zuletzt ${kmText(currentKm(d)?.km || 0)}). Bitte prüfen.`)
      let next = d.kmNow ? addKm(d, todayISO(), d.kmNow) : d
      next = { ...next, dues: (next.dues || []).filter((x) => x.label) }
      delete next.kmNow
      if (m.id) Object.assign(vehOf(m.id), next)
      else FZ().vehicles.push({ ...next, id: uid('v') })
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
    'veh-due-add': () => {
      const d = app.ui.modal.draft
      d.dues = [...(d.dues || []), { id: uid('d'), label: '', date: '', months: '', note: '' }]
      renderModal()
    },
    'veh-due-del': (el) => {
      app.ui.modal.draft.dues.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'veh-km-open': (el) => openModal({ type: 'veh-km', id: el.dataset.id }),
    'vk-save': () => {
      const v = vehOf(app.ui.modal.id)
      const km = parseKm(val('vk-km'))
      const date = val('vk-date') || todayISO()
      if (!km) return toast('Bitte den km-Stand eintragen.')
      if (!kmFits(v, date, km)) return toast(`${kmText(km)} passt nicht zu den bisherigen km-Ständen (zuletzt ${kmText(currentKm(v).km)} am ${formatDate(currentKm(v).date, { weekday: false, year: true })}). Bitte prüfen.`)
      Object.assign(v, addKm(v, date, km))
      persist()
      closeModal()
      renderNow()
      const s = serviceStatus(v, todayISO())
      toast(`${v.plate}: ${kmText(km)} eingetragen.${s.status === 'faellig' ? ' Service ist fällig.' : s.status === 'bald' && s.left !== null ? ` Service in ${kmText(Math.max(0, s.left))}.` : ''}`)
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
      const { vehicles } = importVehicles(app.ui.modal.text || '', { employees: app.data.employees, workshops: FZ().workshops, today: todayISO() })
      let added = 0
      for (const v of vehicles) {
        const known = FZ().vehicles.find((x) => x.plate === v.plate)
        if (known) {
          // km-Stand aus der Liste auch bei vorhandenen km-Ständen nachtragen (wenn er passt)
          if (v.kmLog?.length) Object.assign(known, addKm(known, v.kmLog[0].date, v.kmLog[0].km))
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
      const kind = ch ? ch.kind || 'reifen' : el.dataset.kind || 'reifen'
      const campaign = campaignFor(today)
      const date = ch?.date || (kind === 'werkstatt' ? addDays(today, 1) : [addDays(today, 1), campaign.earliest].sort()[1])
      const tasks = ch ? [...(ch.tasks || [])] : openTasks(FZ(), v, today).map((d) => d.task)
      await ensureRange(date, addDays(date, 14)).catch(() => {})
      openModal({ type: 'veh-plan', kind, tasks, vehicleId: v.id, changeId: ch?.id || null, date, time: ch?.time || '07:30', minutes: ch?.minutes || (kind === 'werkstatt' || tasks.length ? 60 : settings().slotMinutes), workshopId: ch?.workshopId || v.workshopId || '', note: ch?.note || '' })
    },
    'vp-update': async () => {
      const m = app.ui.modal
      const dateChanged = val('vp-date') && val('vp-date') !== m.date
      Object.assign(m, { date: val('vp-date') || m.date, time: val('vp-time') || m.time, minutes: Number(val('vp-min')) || 30, workshopId: val('vp-ws'), note: val('vp-note').trim(), tasks: [...document.querySelectorAll('input[name="vp-task"]:checked')].map((x) => x.value) })
      if (dateChanged) await ensureRange(m.date, m.date).catch(() => {})
      renderModalKeepingInput()
    },
    'vp-next': () => {
      const m = app.ui.modal
      const v = vehOf(m.vehicleId)
      const taken = FZ().changes.filter((x) => x.status === 'geplant' && x.workshopId === m.workshopId && x.id !== m.changeId)
      const holidays = holidayCalendar(m.date, addDays(m.date, 14), app.data.extraFreeDays)
      const { proposals } = proposeSlots([v], { from: m.date, to: addDays(m.date, 14), slotMinutes: Number(m.minutes) || 30, travelMinutes: settings().travelMinutes, busyOf: busyLookup(m.date, addDays(m.date, 14)), taken, holidays })
      if (!proposals.length) return toast('In den nächsten zwei Wochen kein freier Platz zwischen 7 und 17 Uhr.')
      Object.assign(m, { date: proposals[0].date, time: proposals[0].time })
      renderModal()
      toast(`Vorschlag: ${formatDate(m.date)} ${m.time}${proposals[0].after ? ` (${proposals[0].after})` : ''}.`)
    },
    'vp-save': (el) => {
      const m = app.ui.modal
      Object.assign(m, { date: val('vp-date') || m.date, time: val('vp-time') || m.time, minutes: Number(val('vp-min')) || 30, workshopId: val('vp-ws'), note: val('vp-note').trim(), tasks: [...document.querySelectorAll('input[name="vp-task"]:checked')].map((x) => x.value) })
      if (m.kind === 'werkstatt' && !m.tasks.length) return toast('Bitte ankreuzen, was gemacht wird.')
      const campaign = campaignFor(todayISO())
      let ch = m.changeId ? changeById(m.changeId) : null
      const moved = ch && (ch.date !== m.date || ch.time !== m.time)
      if (ch) Object.assign(ch, { date: m.date, time: m.time, minutes: m.minutes, workshopId: m.workshopId, note: m.note, tasks: m.tasks, ...(moved ? { mails: [] } : {}) })
      else {
        ch = { id: uid('c'), vehicleId: m.vehicleId, kind: m.kind, ...(m.kind === 'werkstatt' ? {} : { season: campaign.season, year: campaign.year }), tasks: m.tasks, date: m.date, time: m.time, minutes: m.minutes, workshopId: m.workshopId, note: m.note, status: 'geplant', mails: [] }
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
    'veh-propose-open': async (el) => {
      const today = todayISO()
      const kind = el?.dataset?.kind || 'reifen'
      const campaign = campaignFor(today)
      const from = kind === 'werkstatt' ? addDays(today, 1) : [addDays(today, 1), campaign.earliest].sort()[1]
      const s = settings()
      const m = { type: 'veh-propose', kind, workshopId: FZ().workshops[0]?.id || '', from, to: addDays(from, 11), dayStart: '07:00', dayEnd: '17:00', slot: kind === 'werkstatt' ? 60 : s.slotMinutes, travel: s.travelMinutes, all: kind === 'werkstatt', result: null }
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
      const today = todayISO()
      const created = m.result.proposals
        .filter((_, i) => picked.has(i))
        .map((p) => ({ id: uid('c'), vehicleId: p.vehicleId, ...(m.kind === 'werkstatt' ? { kind: 'werkstatt', tasks: openTasks(FZ(), vehOf(p.vehicleId), today).map((d) => d.task) } : { kind: 'reifen', season: campaign.season, year: campaign.year, tasks: [] }), date: p.date, time: p.time, minutes: p.minutes, workshopId: m.workshopId, note: '', status: 'geplant', mails: [] }))
      FZ().changes.push(...created)
      if (m.kind !== 'werkstatt') FZ().settings = { ...FZ().settings, slotMinutes: Number(m.slot) || 30, travelMinutes: Number(m.travel) || 0 }
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
      const tire = (ch.kind || 'reifen') === 'reifen'
      const km = val('vd-km') ? parseKm(val('vd-km')) : ''
      const doneAt = val('vd-date') || todayISO()
      if (km === null) return toast('Den km-Stand bitte als Zahl eintragen, z. B. 59.000.')
      if (km && !kmFits(v, doneAt, km)) return toast(`${kmText(km)} passt nicht zu den bisherigen km-Ständen (zuletzt ${kmText(currentKm(v).km)}). Bitte prüfen.`)
      Object.assign(ch, { status: 'erledigt', date: val('vd-date') || ch.date, doneAt: val('vd-date') || todayISO(), km, cost: val('vd-cost') ? Number(val('vd-cost').replace(',', '.')) : '', note: [ch.note, val('vd-note').trim()].filter(Boolean).join(' · '), ...(tire ? { storage: val('vd-storage').trim(), tread: read('vd-t'), removedTread: read('vd-r') } : {}) })
      let next = tire ? applyDone(v, ch) : v
      const tasks = ch.tasks || []
      const interval = Number(v.service?.km)
      const results = {
        service: tasks.includes('service') ? { nextDate: val('vd-s-date'), nextKm: val('vd-s-km') ? parseKm(val('vd-s-km')) || '' : km && interval ? km + interval : '' } : null,
        pickerl: tasks.includes('pickerl') ? { result: val('vd-p-result') || 'ok', next: val('vd-p-next') } : null,
        done: tasks.filter((t) => t.startsWith('due:') && document.getElementById(`vd-${t.replace(':', '-')}`)?.checked),
      }
      ch.results = { ...(results.pickerl ? { pickerl: results.pickerl.result } : {}) }
      next = applyTasksDone(next, ch, results)
      Object.assign(v, next)
      persist()
      closeModal()
      renderNow()
      const issues = tire ? tireIssues(v, ch.season, todayISO()).filter((i) => i.level === 'error') : []
      const pk = results.pickerl ? (results.pickerl.result === 'schwer' ? ' Pickerl: schwere Mängel, bitte reparieren und neu vorführen.' : ` Nächstes Pickerl ${monthText(v.pickerl?.next)}.`) : ''
      toast(`${v.plate}: ${tire ? `${SEASONS[ch.season]} montiert` : 'Werkstatttermin erledigt'}.${pk}${issues.length ? ` ${issues[0].text}` : ''}`)
    },
    'veh-mail-open': (el) => {
      if (el.dataset.kind === 'werkstatt') {
        const ws = upcoming().map((c) => c.workshopId).find(Boolean) || FZ().workshops[0]?.id
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
      const list = workshopRows(m.workshopId)
      const subject = val('vm-subject').trim()
      const text = val('vm-text')
      const ws = wsOf(m.workshopId)
      if (ws && !ws.email) ws.email = to
      if (!canMail()) {
        for (const r of list) noteMail(r.change, to, 'werkstatt', 'mailto')
        persist()
        location.href = mailtoHref(to, subject, text)
        closeModal()
        renderNow()
        return
      }
      el.disabled = true
      try {
        const csv = tireCsv(list.map((r) => ({ vehicle: r.vehicle, change: r.change, driver: empOf(r.vehicle.driverId)?.name || '', workshop: ws?.name || '', status: 'geplant' })))
        await sendMail(app.auth.getToken, { to, subject, text, attachments: [{ name: fileSafe(`Termine_${ws?.name || 'Werkstatt'}_${todayISO()}.csv`), blob: new Blob([csv], { type: 'text/csv' }), type: 'text/csv' }] }, { from: app.config.mail?.from || '' })
        for (const r of list) noteMail(r.change, to, 'werkstatt', 'graph')
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
    // vorbeigegangene Termine (Reifen und Werkstatt) bestätigen
    const ids = activeIds()
    for (const c of FZ().changes.filter((x) => x.status === 'geplant' && x.date < today && ids.has(x.vehicleId))) items.push({ id: `past:${c.id}`, kind: 'past', v: vehOf(c.vehicleId), change: c })
    const soon = upcoming(today).filter((c) => !informed(c) && c.date <= addDays(today, 3))
    if (soon.length) items.push({ id: `inform:${soon.map((c) => c.id).join(',')}`, kind: 'inform', list: soon })
    for (const r of list) for (const i of tireIssues(r.v, r.v.mounted === 'ganzjahr' ? 'ganzjahr' : campaign.season, today).filter((x) => x.level === 'error')) items.push({ id: `tread:${r.v.id}:${campaign.key}`, kind: 'tread', r, text: i.text })
    // Pickerl, Service, weitere Fälligkeiten ohne Termin
    for (const r of serviceRows(today).filter((x) => x.open.length)) items.push({ id: `dues:${r.v.id}:${r.open.map((d) => `${d.task}=${d.status}`).join(',')}`, kind: 'dues', r })
    return items
  },
  render: (items) =>
    items
      .map((it) => {
        if (it.kind === 'open') return `<div class="todo-item"><span class="flag ${it.late ? 'error' : 'warning'}">${it.list.length}</span><div class="todo-text"><strong>Reifenwechsel ohne Termin</strong><br><span class="muted">${esc(it.list.map((r) => r.v.plate).join(', '))}${it.late ? ' · Frist vorbei' : ''}</span></div><button class="btn small primary" data-action="veh-propose-open">Vorschlagen</button></div>`
        if (it.kind === 'past') return `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(it.v.plate)}</strong>: ${esc(changeWhat(it.change, it.v))} am ${formatDate(it.change.date)} bestätigen<br><span class="muted">${(it.change.kind || 'reifen') === 'reifen' ? 'Profil und Einlagerung eintragen' : 'km-Stand, nächstes Service, neue Plakette eintragen'}</span></div><button class="btn small primary" data-action="veh-done-open" data-change="${esc(it.change.id)}">Erledigt</button></div>`
        if (it.kind === 'inform') return `<div class="todo-item"><span class="flag warning">${it.list.length}</span><div class="todo-text"><strong>Fahrer/innen noch nicht informiert</strong><br><span class="muted">${esc(it.list.map((c) => `${vehOf(c.vehicleId)?.plate} ${formatDate(c.date)}`).join(', '))}</span></div><button class="btn small primary" data-action="veh-mail-open" data-kind="fahrer" data-ids="${esc(it.list.map((c) => c.id).join(','))}">Informieren</button></div>`
        if (it.kind === 'dues') {
          const worst = it.r.open[0].status
          return `<div class="todo-item"><span class="flag ${worst === 'abgelaufen' ? 'error' : 'warning'}">${it.r.open.length}</span><div class="todo-text"><strong>${esc(it.r.v.plate)}</strong>: ${esc(it.r.open.map((d) => `${d.label} ${DUE_LABEL[d.status]}`).join(', '))}<br><span class="muted">${esc(empOf(it.r.v.driverId)?.name || 'ohne feste/n Fahrer/in')}</span></div><button class="btn small primary" data-action="veh-plan-open" data-id="${esc(it.r.v.id)}" data-kind="werkstatt">Werkstatttermin</button></div>`
        }
        return `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(it.r.v.plate)}</strong>: ${esc(it.text)}</div><button class="btn small" data-action="veh-edit-open" data-id="${esc(it.r.v.id)}">Fahrzeug</button></div>`
      })
      .join(''),
})
