// Termine: Kalender der Firma in der App (Woche mit Uhrzeiten, Liste der nächsten
// Tage) und Termin-Dialog. Gespeichert in termine/termine.json; mit Microsoft-Anmeldung
// zusätzlich als Outlook-Termin der Person, die einträgt, mit Einladung an alle
// Teilnehmenden: Exchange stellt die Einladung bei ihnen von selbst in den Kalender.
//
// Teilnehmende: Personen der Firma (Microsoft-Verzeichnis, Suche nach Name/E-Mail),
// Mitarbeitende aus dem Dienstplan (erscheinen auch in der Zeitlinie) und freie E-Mail-
// Adressen (z. B. Hausverwaltung). Vor dem Speichern: Frei/Belegt aus Outlook und
// Überschneidungen mit Einsätzen.

import { addDays, dayIndex, formatDate, isoWeekday, todayISO, WEEKDAY_SHORT } from '../../core/dates.js'
import { addMinutes, APPOINTMENT_KINDS, appointmentsBetween, conflicts, dateOf, dayPart, emptyAppointments, employeesOf, graphEvent, icsData, inviteList, inviteText, kindLabel, minutesFrom, outlookState, REMINDERS, timeOf, validateAppointment, whenText } from '../../core/appointments.js'
import { icsEvent } from '../../core/ics.js'
import { cancelGraphEvent, createGraphEvent, eventResponses, findPeople, freeBusy, listEvents, TIME_ZONE, updateGraphEvent } from '../../auth/graph-calendar.js'
import { appName } from '../config.js'
import { app, canEdit, closeModal, computeRange, confirmStep, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { download, esc, ICON, modalFrame, options, uid } from '../shared.js'

const MODULE = 'termine'
const data = () => (app.data.termine ||= emptyAppointments())
const items = () => data().items || (data().items = [])
const byId = (id) => items().find((a) => a.id === id)
const employeesById = () => new Map(app.data.employees.map((e) => [e.id, e]))
const objectName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const objectOf = (id) => app.data.objects.find((o) => o.id === id)
const outlookOn = () => !!app.auth?.tokenFor
const myMail = () => String(app.user?.email || '').toLowerCase()
const isOrganizer = (a) => !a.outlook?.organizer || a.outlook.organizer.toLowerCase() === myMail()
const KIND_COLOR = { kunde: 1, begehung: 3, kontrolle: 5, schulung: 7, werkstatt: 9, bewerbung: 11, intern: 2, sonstiges: 8 }

async function calendarToken() {
  try {
    return (await app.auth.tokenFor(['Calendars.ReadWrite'])).accessToken
  } catch {
    throw new Error('Das Recht „Calendars.ReadWrite“ fehlt: In Entra (App-Registrierung → API-Berechtigungen) „Calendars.ReadWrite“ (delegiert) hinzufügen, Administratorzustimmung erteilen, dann neu anmelden.')
  }
}
async function directoryToken() {
  try {
    return (await app.auth.tokenFor(['User.ReadBasic.All'])).accessToken
  } catch {
    throw new Error('Für die Personensuche fehlt „User.ReadBasic.All“ (delegiert). Bis dahin: Mitarbeitende aus dem Dienstplan wählen oder E-Mail-Adresse eintippen.')
  }
}

// ---------------------------------------------------------------- Ablage und Outlook

/** Ort für die Einladung: eingetragen, sonst Name und Adresse des Objekts. */
const locationText = (a) => a.location || [objectName(a.objectId), objectOf(a.objectId)?.address].filter(Boolean).join(', ')

/**
 * Termin speichern (neu oder geändert) und, wenn möglich, in Outlook eintragen bzw. aktualisieren.
 * Liefert den gespeicherten Termin. Auch für den KI-Assistenten und andere Module.
 */
export async function saveAppointment(draft, { sync = true, quiet = false } = {}) {
  const errors = validateAppointment(draft)
  if (errors.length) throw new Error(errors.join(' '))
  const now = new Date().toISOString()
  let item = draft.id ? byId(draft.id) : null
  if (item) {
    Object.assign(item, draft, { updatedAt: now, updatedBy: app.user?.name || '' })
    if (item.outlook) item.outlook = { ...item.outlook, dirty: true }
  } else {
    item = { ...draft, id: uid('ter'), createdAt: now, createdBy: app.user?.name || '', createdByMail: myMail() }
    items().push(item)
  }
  persist()
  renderNow()
  if (sync && outlookOn() && item.sync !== false) return (await syncAppointment(item.id, { quiet })) || byId(item.id)
  return item
}

/** In Outlook eintragen oder aktualisieren. Fehler werden am Termin vermerkt (und gemeldet). */
export async function syncAppointment(id, { quiet = false } = {}) {
  const a = byId(id)
  if (!a || a.cancelled || !outlookOn()) return a
  if (a.outlook?.id && !isOrganizer(a)) {
    a.outlook = { ...a.outlook, dirty: false, error: '' }
    persist()
    if (!quiet) toast(`In der App geändert. Den Outlook-Termin kann nur ${a.outlook.organizerName || 'die Person, die ihn angelegt hat'} ändern.`)
    return a
  }
  try {
    const token = await calendarToken()
    const people = employeesById()
    const payload = graphEvent(a, { employeesById: people, timeZone: TIME_ZONE, location: locationText(a), body: inviteText(a, { objectName: objectName(a.objectId), objectAddress: objectOf(a.objectId)?.address, appName: appName(app.config.brand), link: `${location.origin}${location.pathname}#termine` }) })
    const res = a.outlook?.id ? await updateGraphEvent(token, a.outlook.id, payload) : await createGraphEvent(token, payload, { transactionId: a.id })
    const live = byId(id) // inzwischen neu geladen? dann den aktuellen Eintrag nehmen
    if (!live) return null
    const invited = inviteList(live, people).map((x) => x.email)
    live.outlook = { id: res.id || live.outlook?.id, iCalUId: res.iCalUId || live.outlook?.iCalUId || '', webLink: res.webLink || live.outlook?.webLink || '', onlineMeetingUrl: res.onlineMeetingUrl || live.outlook?.onlineMeetingUrl || '', organizer: res.organizer || live.outlook?.organizer || myMail(), organizerName: live.outlook?.organizerName || app.user?.name || '', syncedAt: new Date().toISOString(), invited }
    persist()
    renderNow()
    if (!quiet) toast(invited.length ? `In Outlook eingetragen. Einladung an ${invited.length} ${invited.length === 1 ? 'Person' : 'Personen'} verschickt.` : 'In deinem Outlook-Kalender eingetragen.')
    return live
  } catch (err) {
    const live = byId(id)
    if (live) {
      live.outlook = { ...(live.outlook || {}), dirty: true, error: String(err.message || err).slice(0, 300) }
      persist()
      renderNow()
    }
    if (!quiet) toast(`Nicht in Outlook eingetragen: ${err.message}`)
    return live
  }
}

/** Absagen: in Outlook (mit Absage an die Eingeladenen), in der App als abgesagt vermerkt. */
async function cancelAppointment(id, comment = '') {
  const a = byId(id)
  if (!a) return
  let outlookDone = !a.outlook?.id
  if (a.outlook?.id && outlookOn() && isOrganizer(a)) {
    try {
      await cancelGraphEvent(await calendarToken(), a.outlook.id, comment)
      outlookDone = true
    } catch (err) {
      toast(`Absage in Outlook nicht möglich: ${err.message}`)
      return
    }
  }
  const live = byId(id)
  Object.assign(live, { cancelled: true, cancelledAt: new Date().toISOString(), cancelledBy: app.user?.name || '', ...(comment ? { cancelNote: comment } : {}) })
  persist()
  closeModal()
  renderNow()
  toast(outlookDone ? 'Termin abgesagt.' : `In der App abgesagt. Den Outlook-Termin muss ${a.outlook?.organizerName || 'die Person, die ihn angelegt hat'} absagen.`)
}

// ---------------------------------------------------------------- Outlook-Kalender einblenden

const outlookCache = new Map() // Woche → { events, error, loading }
function outlookWeek(monday) {
  if (!app.ui.termOutlook || !outlookOn()) return null
  const hit = outlookCache.get(monday)
  if (hit) return hit
  const entry = { events: [], loading: true }
  outlookCache.set(monday, entry)
  calendarToken()
    .then((t) => listEvents(t, { from: monday, to: addDays(monday, 6) }))
    .then((events) => Object.assign(entry, { events, loading: false }))
    .catch((err) => Object.assign(entry, { error: err.message, loading: false }))
    .finally(() => app.ui.view === 'termine' && renderNow())
  return entry
}

// ---------------------------------------------------------------- Ansicht

const HOUR_PX = 44

function lanes(blocks) {
  const ends = []
  for (const b of [...blocks].sort((x, y) => x.start - y.start || y.end - x.end)) {
    let lane = ends.findIndex((e) => e <= b.start)
    if (lane < 0) lane = ends.length
    ends[lane] = b.end
    b.lane = lane
  }
  const n = Math.max(1, ends.length)
  for (const b of blocks) b.lanes = n
}

const stateBadge = (a) => {
  const st = outlookState(a)
  if (!outlookOn()) return ''
  return st === 'ok' ? `<span class="ap-ol ok" title="In Outlook eingetragen">${ICON.check}</span>` : st === 'fehler' ? `<span class="ap-ol err" title="${esc(a.outlook?.error || '')}">!</span>` : st === 'offen' ? '<span class="ap-ol wait" title="Noch nicht in Outlook">…</span>' : ''
}

function weekGrid(c) {
  const list = appointmentsBetween(items(), c.monday, c.sunday)
  const ol = outlookWeek(c.monday)
  const mine = new Set(items().map((a) => a.outlook?.id).filter(Boolean))
  const foreign = (ol?.events || []).filter((e) => !mine.has(e.id))
  let from = 7 * 60
  let to = 19 * 60
  const perDay = c.days.map((date) => {
    const blocks = []
    const allDay = []
    for (const a of list) {
      const part = dayPart(a, date)
      if (a.allDay || (!part && dateOf(a.start) <= date && dateOf(a.end) >= date)) {
        if (dateOf(a.start) <= date) allDay.push({ a })
        continue
      }
      if (part) blocks.push({ a, ...part })
    }
    for (const e of foreign) {
      if (e.allDay) {
        if (e.start.slice(0, 10) <= date && e.end.slice(0, 10) > date) allDay.push({ e })
        continue
      }
      const s = Math.max(0, minutesFrom(date, e.start))
      const en = Math.min(1440, minutesFrom(date, e.end))
      if (en > s) blocks.push({ e, start: s, end: en })
    }
    for (const b of blocks) {
      from = Math.min(from, Math.floor(b.start / 60) * 60)
      to = Math.max(to, Math.ceil(b.end / 60) * 60)
    }
    lanes(blocks)
    return { date, blocks, allDay }
  })
  const hours = (to - from) / 60
  const today = todayISO()
  const nowMin = (() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })()
  const edit = canEdit(MODULE)
  const head = perDay.map(({ date }) => `<div class="ap-dayhead ${date === today ? 'today' : ''} ${c.holidays.get(date) ? 'holiday' : ''}" title="${esc(c.holidays.get(date)?.name || '')}"><b>${WEEKDAY_SHORT[isoWeekday(date) - 1]}</b> ${date.slice(8)}.${date.slice(5, 7)}.</div>`).join('')
  const allRow = perDay
    .map(({ date, allDay }) => `<div class="ap-allday" ${edit ? `data-action="appt-new" data-date="${date}" data-allday="1"` : ''}>${allDay.map(({ a, e }) => (a ? `<button class="ap-chip" style="--obj:var(--o${KIND_COLOR[a.kind] || 8})" data-action="appt-open" data-id="${esc(a.id)}">${esc(a.title)}</button>` : `<span class="ap-chip outlook" title="Aus deinem Outlook-Kalender">${esc(e.subject)}</span>`)).join('')}</div>`)
    .join('')
  const cols = perDay
    .map(({ date, blocks }) => {
      const ev = blocks
        .map((b) => {
          const style = `top:${((b.start - from) / 60) * HOUR_PX}px;height:${Math.max(18, ((b.end - b.start) / 60) * HOUR_PX - 2)}px;left:calc(${(b.lane / b.lanes) * 100}% + 2px);width:calc(${100 / b.lanes}% - 4px)`
          if (b.e) return `<div class="ap-ev outlook" style="${style}" title="${esc(`${b.e.subject}\n${b.e.start.slice(11)}–${b.e.end.slice(11)}${b.e.location ? `\n${b.e.location}` : ''}\naus deinem Outlook-Kalender`)}"><span class="ap-time">${b.e.start.slice(11)}</span> ${esc(b.e.subject)}</div>`
          const a = b.a
          const who = employeesOf(a, app.data.employees).map((id) => app.data.employees.find((x) => x.id === id)?.name.split(' ')[0]).filter(Boolean)
          return `<button class="ap-ev" style="${style};--obj:var(--o${KIND_COLOR[a.kind] || 8})" data-action="appt-open" data-id="${esc(a.id)}" title="${esc(`${a.title}\n${whenText(a, formatDate)}${locationText(a) ? `\n${locationText(a)}` : ''}${who.length ? `\nMit: ${who.join(', ')}` : ''}`)}"><span class="ap-time">${timeOf(a.start)}</span> <b>${esc(a.title)}</b>${stateBadge(a)}${who.length && b.end - b.start >= 45 ? `<small>${esc(who.join(', '))}</small>` : ''}</button>`
        })
        .join('')
      const now = date === today && nowMin >= from && nowMin <= to ? `<span class="ap-now" style="top:${((nowMin - from) / 60) * HOUR_PX}px"></span>` : ''
      return `<div class="ap-col ${date === today ? 'today' : ''}" style="height:${hours * HOUR_PX}px" ${edit ? `data-action="appt-new" data-date="${date}" data-from="${from}"` : ''}>${now}${ev}</div>`
    })
    .join('')
  const axis = Array.from({ length: hours }, (_, i) => `<span style="top:${i * HOUR_PX}px">${String(from / 60 + i).padStart(2, '0')}:00</span>`).join('')
  const olNote = ol?.loading ? '<p class="muted small">Outlook-Kalender wird geladen …</p>' : ol?.error ? `<p class="err-text small">${esc(ol.error)}</p>` : ''
  return `${olNote}<div class="ap-week" style="--hour:${HOUR_PX}px">
    <div class="ap-corner"></div>${head}
    <div class="ap-corner small">ganztägig</div>${allRow}
    <div class="ap-axis" style="height:${hours * HOUR_PX}px">${axis}</div>${cols}
  </div>`
}

function agenda(from, days, { empty = 'Keine Termine.' } = {}) {
  const to = addDays(from, days - 1)
  const list = appointmentsBetween(items(), from, to)
  if (!list.length) return `<p class="muted">${empty}</p>`
  const today = todayISO()
  const label = (d) => (d === today ? 'Heute' : d === addDays(today, 1) ? 'Morgen' : formatDate(d))
  let last = ''
  return `<ul class="ap-agenda">${list
    .map((a) => {
      const d = dateOf(a.start) < from ? from : dateOf(a.start)
      const head = d !== last ? `<li class="ap-agenda-day">${esc(label((last = d)))}</li>` : ''
      const who = [...employeesOf(a, app.data.employees).map((id) => app.data.employees.find((e) => e.id === id)?.name), ...(a.attendees || []).filter((x) => !app.data.employees.some((e) => e.email && e.email.toLowerCase() === x.email)).map((x) => x.name || x.email)].filter(Boolean)
      return `${head}<li><button class="ap-row" data-action="appt-open" data-id="${esc(a.id)}" style="--obj:var(--o${KIND_COLOR[a.kind] || 8})"><span class="ap-row-time">${a.allDay ? 'ganztägig' : `${timeOf(a.start)}–${timeOf(a.end)}`}</span><span class="ap-row-main"><b>${esc(a.title)}</b> <span class="muted">${esc(kindLabel(a.kind))}${locationText(a) ? ` · ${esc(locationText(a))}` : ''}</span>${who.length ? `<br><small>${esc(who.join(', '))}</small>` : ''}</span>${stateBadge(a)}</button></li>`
    })
    .join('')}</ul>`
}

function termineView(c) {
  const edit = canEdit(MODULE)
  const failed = items().filter((a) => !a.cancelled && outlookOn() && outlookState(a) === 'fehler')
  const banner = !outlookOn()
    ? `<div class="banner"><p><strong>Ohne Microsoft-Anmeldung</strong> (Browser-Modus): Termine bleiben in der App. Für Outlook einen Termin öffnen und „.ics herunterladen“.</p></div>`
    : failed.length
      ? `<div class="banner warn-banner"><p><strong>${failed.length} ${failed.length === 1 ? 'Termin ist' : 'Termine sind'} nicht in Outlook.</strong> ${esc(failed[0].outlook?.error || '')}</p>${edit ? '<button class="btn primary" data-action="appt-sync-all">Erneut eintragen</button>' : ''}</div>`
      : ''
  return `<div class="section-head"><div><h2>Termine</h2>
      <p>Kundentermine, Begehungen, Kontrollen, Schulungen. ${outlookOn() ? 'Beim Speichern trägt die App den Termin in deinen Outlook-Kalender ein und lädt alle Teilnehmenden ein: Bei ihnen steht er dann ebenfalls im Kalender.' : ''} Ein Klick in den Kalender legt einen Termin zu dieser Zeit an.</p></div>
      <div class="ap-tools">${outlookOn() ? `<label class="check"><input type="checkbox" data-change="appt-outlook-toggle" ${app.ui.termOutlook ? 'checked' : ''}><span>Mein Outlook einblenden</span></label>` : ''}${edit ? `<button class="btn primary" data-action="appt-new">${ICON.plus} Neuer Termin</button>` : ''}</div></div>
    ${banner}
    <div class="ap-desktop">${weekGrid(c)}</div>
    <div class="ap-mobile">${agenda(c.monday, 7, { empty: 'Diese Woche keine Termine.' })}</div>
    <section class="table-wrap ap-next"><div class="table-head"><h3>Die nächsten 14 Tage</h3></div>${agenda(todayISO(), 14, { empty: 'In den nächsten 14 Tagen keine Termine.' })}</section>`
}

registerView({
  id: 'termine',
  order: 17,
  label: 'Termine',
  group: 'plan',
  module: MODULE,
  section: 'planung',
  text: 'Kalender mit Outlook-Einladungen',
  badge: () => (outlookOn() ? items().filter((a) => !a.cancelled && outlookState(a) === 'fehler').length : 0),
  render: termineView,
})

// ---------------------------------------------------------------- Dialog

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`

function draftFrom(m) {
  if (m.draft) return m.draft
  const a = m.id ? byId(m.id) : null
  if (a) return structuredClone({ ...a, attendees: a.attendees || [], employeeIds: a.employeeIds || [] })
  const date = m.date || todayISO()
  const start = m.time || '09:00'
  const startAt = `${date}T${start}`
  return { title: m.title || '', kind: m.kind || 'kunde', start: startAt, end: addMinutes(startAt, Number(m.minutes) || 60), allDay: !!m.allDay, objectId: m.objectId || '', location: '', note: '', attendees: [], employeeIds: m.employeeIds?.length ? [...m.employeeIds] : m.employeeId ? [m.employeeId] : [], online: false, reminder: 15, responseRequested: true }
}

/** Felder des Dialogs in den Entwurf übernehmen. */
function collect() {
  const m = app.ui.modal
  const d = m.draft || draftFrom(m)
  const v = (id) => document.getElementById(id)?.value ?? ''
  const on = (id) => !!document.getElementById(id)?.checked
  if (!document.getElementById('ap-title')) return d
  const date = v('ap-date')
  d.title = v('ap-title').trim()
  d.kind = v('ap-kind')
  d.allDay = on('ap-allday')
  if (d.allDay) {
    d.start = `${date}T00:00`
    const endDate = v('ap-enddate') || date
    d.end = `${endDate < date ? date : endDate}T00:00`
  } else {
    d.start = `${date}T${v('ap-from') || '09:00'}`
    const until = v('ap-to') || hhmm(minutesFrom(date, d.start) + 60)
    d.end = until <= v('ap-from') ? `${addDays(date, 1)}T${until}` : `${date}T${until}`
  }
  d.objectId = v('ap-object')
  d.location = v('ap-location').trim()
  d.note = v('ap-note').trim()
  d.online = on('ap-online')
  d.reminder = Number(v('ap-reminder'))
  d.responseRequested = on('ap-response')
  m.draft = d
  return d
}

function peopleChips(d) {
  const emps = employeesById()
  const busy = app.ui.modal?.busy
  const state = (email) => {
    if (!busy || !email) return ''
    const list = busy.get(email.toLowerCase())
    if (!list) return '<span class="ap-busy unknown" title="Kein Kalender in der Firma">?</span>'
    return list.length ? `<span class="ap-busy no" title="${esc(list.map((x) => `${x.start.slice(11)}–${x.end.slice(11)} ${x.subject || x.status}`).join('\n'))}">belegt</span>` : '<span class="ap-busy yes">frei</span>'
  }
  const resp = app.ui.modal?.responses
  const answer = (email) => {
    const r = resp?.find((x) => x.email === String(email || '').toLowerCase())?.response
    return r === 'accepted' ? '<span class="pill ok">zugesagt</span>' : r === 'declined' ? '<span class="pill error">abgesagt</span>' : r === 'tentativelyAccepted' ? '<span class="pill warning">vorläufig</span>' : ''
  }
  const chips = [
    ...(d.employeeIds || []).map((id) => {
      const e = emps.get(id)
      return `<span class="ap-person emp">${ICON.user}<b>${esc(e?.name || '?')}</b>${e?.email ? state(e.email) + answer(e.email) : '<small class="muted">ohne E-Mail: nur in der App</small>'}<button class="ap-x" data-action="appt-remove" data-emp="${esc(id)}" aria-label="Entfernen">×</button></span>`
    }),
    ...(d.attendees || []).map((x, i) => `<span class="ap-person"><b>${esc(x.name || x.email)}</b>${x.name && x.name !== x.email ? `<small class="muted">${esc(x.email)}</small>` : ''}${state(x.email)}${answer(x.email)}<button class="ap-x" data-action="appt-remove" data-i="${i}" aria-label="Entfernen">×</button></span>`),
  ]
  return chips.length ? chips.join('') : '<span class="muted small">Noch niemand eingeladen.</span>'
}

function hits(m) {
  const q = String(m.q || '').trim().toLowerCase()
  if (q.length < 2) return ''
  const d = m.draft
  const taken = new Set([...(d.attendees || []).map((x) => x.email), ...(d.employeeIds || []).map((id) => employeesById().get(id)?.email?.toLowerCase()).filter(Boolean)])
  const emps = app.data.employees.filter((e) => !(d.employeeIds || []).includes(e.id) && [e.name, e.email, e.team].some((t) => String(t || '').toLowerCase().includes(q))).slice(0, 6)
  const dir = (m.people || []).filter((p) => !taken.has(p.email)).slice(0, 8)
  const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) && !taken.has(q) ? `<li><button class="ap-hit" data-action="appt-add-mail" data-email="${esc(q)}">${ICON.plus} <b>${esc(q)}</b> <span class="muted">einladen</span></button></li>` : ''
  const list = [
    ...emps.map((e) => `<li><button class="ap-hit" data-action="appt-add-emp" data-emp="${esc(e.id)}">${ICON.user} <b>${esc(e.name)}</b> <span class="muted">Dienstplan${e.email ? ` · ${esc(e.email)}` : ' · ohne E-Mail'}</span></button></li>`),
    ...dir.map((p) => `<li><button class="ap-hit" data-action="appt-add-person" data-email="${esc(p.email)}" data-name="${esc(p.name)}"><b>${esc(p.name)}</b> <span class="muted">${esc(p.email)}${p.job ? ` · ${esc(p.job)}` : ''}</span></button></li>`),
  ].join('')
  const status = m.searching ? '<li class="muted small">Suche im Firmenverzeichnis …</li>' : m.searchError ? `<li class="muted small">${esc(m.searchError)}</li>` : ''
  return `<ul class="ap-hits">${list}${mail}${status}${!list && !mail && !status ? '<li class="muted small">Niemand gefunden. Für Externe die E-Mail-Adresse eintippen.</li>' : ''}</ul>`
}

function conflictText(d) {
  const ids = employeesOf(d, app.data.employees)
  if (!ids.length || !d.start) return ''
  const day = dateOf(d.start)
  let list = []
  try {
    const r = computeRange(day, day)
    list = d.allDay ? [] : conflicts(d, { employeeIds: ids, instancesOf: (id) => r.state.instancesOf(id).filter((i) => i.date === day), dayIndexOf: dayIndex })
  } catch {
    list = []
  }
  const absent = ids
    .map((id) => ({ id, abs: (app.data.absences || []).find((x) => x.employeeId === id && x.from <= day && x.to >= day) }))
    .filter((x) => x.abs)
  if (!list.length && !absent.length) return ''
  return `<div class="notice warn">${list.map(({ empId, inst }) => `<div>${esc(employeesById().get(empId)?.name || '?')} hat ${inst.startTime}–${inst.endTime} einen Einsatz in ${esc(objectName(inst.objectId))}.</div>`).join('')}${absent.map(({ id, abs }) => `<div>${esc(employeesById().get(id)?.name || '?')} ist an dem Tag abwesend (${esc(abs.type)}).</div>`).join('')}</div>`
}

function apptModal(c, m) {
  const d = draftFrom(m)
  m.draft = d
  const a = d.id ? byId(d.id) : null
  const edit = canEdit(MODULE)
  const date = dateOf(d.start)
  const cancelled = !!a?.cancelled
  const ol = a ? outlookState(a) : null
  const olInfo = !a || !outlookOn()
    ? ''
    : ol === 'ok'
      ? `<p class="note">${ICON.check} In Outlook eingetragen${a.outlook?.organizerName ? ` (von ${esc(a.outlook.organizerName)})` : ''}${a.outlook?.webLink ? ` · <a href="${esc(a.outlook.webLink)}" target="_blank" rel="noopener">in Outlook öffnen</a>` : ''}${a.outlook?.onlineMeetingUrl ? ` · <a href="${esc(a.outlook.onlineMeetingUrl)}" target="_blank" rel="noopener">Teams beitreten</a>` : ''}</p>`
      : ol === 'fehler'
        ? `<p class="notice warn">Nicht in Outlook: ${esc(a.outlook?.error || '')}</p>`
        : '<p class="note">Noch nicht in Outlook eingetragen.</p>'
  const objects = [['', '– kein Objekt –'], ...app.data.objects.filter((o) => !o.inactive).map((o) => [o.id, o.name])]
  const body = `${cancelled ? `<p class="notice warn">Abgesagt${a.cancelledBy ? ` von ${esc(a.cancelledBy)}` : ''}${a.cancelNote ? `: ${esc(a.cancelNote)}` : ''}.</p>` : ''}${olInfo}
    <div class="form-grid">
      <label class="field wide"><span>Titel</span><input id="ap-title" value="${esc(d.title)}" placeholder="z. B. Begehung mit Hausverwaltung" ${edit ? '' : 'disabled'}></label>
      <label class="field"><span>Art</span><select id="ap-kind">${options(APPOINTMENT_KINDS, d.kind)}</select></label>
      <label class="field"><span>Datum</span><input type="date" id="ap-date" value="${date}"></label>
      <label class="field ap-time-field" ${d.allDay ? 'hidden' : ''}><span>von</span><input type="time" id="ap-from" value="${d.allDay ? '09:00' : timeOf(d.start)}" step="300"></label>
      <label class="field ap-time-field" ${d.allDay ? 'hidden' : ''}><span>bis</span><input type="time" id="ap-to" value="${d.allDay ? '10:00' : timeOf(d.end)}" step="300"></label>
      <label class="field ap-day-field" ${d.allDay ? '' : 'hidden'}><span>bis (Datum)</span><input type="date" id="ap-enddate" value="${dateOf(d.end) || date}"></label>
      <label class="check field-check"><input type="checkbox" id="ap-allday" data-change="appt-allday" ${d.allDay ? 'checked' : ''}><span>ganztägig</span></label>
      <label class="field"><span>Objekt</span><select id="ap-object" data-change="appt-object">${options(objects, d.objectId || '')}</select></label>
      <label class="field wide"><span>Ort</span><input id="ap-location" value="${esc(d.location || '')}" placeholder="${esc(locationText({ ...d, location: '' }) || 'Adresse oder Raum')}"></label>
    </div>
    <div class="ap-people">
      <span class="field-label">Teilnehmende ${outlookOn() ? '<small class="muted">bekommen eine Einladung und haben den Termin im Outlook-Kalender</small>' : ''}</span>
      <div class="ap-chips">${peopleChips(d)}</div>
      ${edit && !cancelled ? `<label class="search-field">${ICON.search}<input id="ap-q" value="${esc(m.q || '')}" placeholder="Name aus Dienstplan oder Firma, oder E-Mail-Adresse …" autocomplete="off" data-input="appt-q"></label>${hits(m)}` : ''}
      ${outlookOn() && inviteList(d, employeesById()).length && !d.allDay ? `<button class="btn small" data-action="appt-freebusy">Frei/Belegt prüfen</button>` : ''}
      ${conflictText(d)}
    </div>
    <div class="form-grid">
      <label class="field wide"><span>Notiz (steht in der Einladung)</span><textarea id="ap-note" rows="3">${esc(d.note || '')}</textarea></label>
      <label class="field"><span>Erinnerung</span><select id="ap-reminder">${options(REMINDERS, Number(d.reminder ?? 15))}</select></label>
      ${outlookOn() ? `<label class="check field-check"><input type="checkbox" id="ap-online" ${d.online ? 'checked' : ''}><span>Teams-Besprechung</span></label><label class="check field-check"><input type="checkbox" id="ap-response" ${d.responseRequested !== false ? 'checked' : ''}><span>Antwort anfordern</span></label>` : ''}
    </div>
    <p class="field-error" id="ap-error" role="alert">${esc(m.error || '')}</p>`
  const foot = !edit
    ? `<button class="btn" data-action="close-modal">Schließen</button>`
    : `${a && !cancelled ? `<button class="btn danger ${app.ui.confirm === `ap-cancel:${a.id}` ? 'confirm' : ''}" data-action="appt-cancel" data-id="${esc(a.id)}">${app.ui.confirm === `ap-cancel:${a.id}` ? 'Wirklich absagen?' : a.outlook?.id ? 'Absagen' : 'Löschen'}</button>` : ''}
       ${a && cancelled ? `<button class="btn danger" data-action="appt-delete" data-id="${esc(a.id)}">Endgültig löschen</button>` : ''}
       <span class="spacer"></span>
       ${!outlookOn() ? `<button class="btn" data-action="appt-ics">${ICON.download} .ics herunterladen</button>` : ''}
       ${!cancelled ? `<button class="btn primary" data-action="appt-save">${outlookOn() ? `${ICON.send} ${a?.outlook?.id ? 'Speichern und Einladung aktualisieren' : 'Speichern und einladen'}` : 'Speichern'}</button>` : ''}`
  return modalFrame({ title: a ? (cancelled ? 'Termin (abgesagt)' : 'Termin') : 'Neuer Termin', subtitle: a ? esc(whenText(a, formatDate)) : '', body, foot, wide: true })
}

registerModal('appt', apptModal, { module: MODULE })

function refreshModal() {
  const focus = document.activeElement?.id
  const pos = document.activeElement?.selectionStart
  renderModal()
  const el = focus && document.getElementById(focus)
  if (el) {
    el.focus()
    if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos)
  }
}

let searchSeq = 0
async function searchDirectory(q) {
  const m = app.ui.modal
  if (!outlookOn() || q.trim().length < 2 || q.includes('@') && /\.[a-z]{2,}$/i.test(q)) return
  const seq = ++searchSeq
  m.searching = true
  try {
    const people = await findPeople(await directoryToken(), q)
    if (seq !== searchSeq || app.ui.modal !== m) return
    m.people = people
    m.searchError = ''
  } catch (err) {
    if (seq !== searchSeq || app.ui.modal !== m) return
    m.people = []
    m.searchError = err.message
  }
  m.searching = false
  refreshModal()
}

registerActions(
  {
    'appt-new': (el, e) => {
      let time = '09:00'
      if (el.dataset.from && e?.target === el) {
        // Klick in die Tagesspalte: Uhrzeit aus der Höhe, auf Viertelstunden
        const y = e.offsetY ?? 0
        const min = Number(el.dataset.from) + Math.floor(((y / HOUR_PX) * 60) / 15) * 15
        time = hhmm(Math.min(23 * 60, Math.max(0, min)))
      } else if (el.dataset.from) return // Klick auf einen Termin in der Spalte
      if (el.dataset.allday && e?.target !== el) return
      const today = todayISO()
      const shown = app.ui.view === 'termine' && (today < app.ui.monday || today > addDays(app.ui.monday, 6)) ? app.ui.monday : today
      openModal({ type: 'appt', date: el.dataset.date || shown, time: el.dataset.time || time, allDay: !!el.dataset.allday, employeeId: el.dataset.emp || '', objectId: el.dataset.object || '' })
      setTimeout(() => document.getElementById('ap-title')?.focus(), 30)
    },
    'appt-allday': (el) => {
      collect()
      app.ui.modal.draft.allDay = el.checked
      if (el.checked) app.ui.modal.draft.end = `${dateOf(app.ui.modal.draft.start)}T00:00`
      else {
        app.ui.modal.draft.start = `${dateOf(app.ui.modal.draft.start)}T09:00`
        app.ui.modal.draft.end = `${dateOf(app.ui.modal.draft.start)}T10:00`
      }
      refreshModal()
    },
    'appt-object': () => {
      collect()
      refreshModal()
    },
    'appt-q': (el) => {
      collect()
      app.ui.modal.q = el.value
      app.ui.modal.people = []
      app.ui.modal.searchError = ''
      refreshModal()
      searchDirectory(el.value)
    },
    'appt-add-emp': (el) => {
      const d = collect()
      d.employeeIds = [...new Set([...(d.employeeIds || []), el.dataset.emp])]
      Object.assign(app.ui.modal, { q: '', people: [], busy: null })
      refreshModal()
      document.getElementById('ap-q')?.focus()
    },
    'appt-add-person': (el) => {
      const d = collect()
      d.attendees = [...(d.attendees || []), { email: el.dataset.email.toLowerCase(), name: el.dataset.name || el.dataset.email }]
      Object.assign(app.ui.modal, { q: '', people: [], busy: null })
      refreshModal()
      document.getElementById('ap-q')?.focus()
    },
    'appt-add-mail': (el) => {
      const d = collect()
      d.attendees = [...(d.attendees || []), { email: el.dataset.email.toLowerCase(), name: el.dataset.email.toLowerCase() }]
      Object.assign(app.ui.modal, { q: '', people: [], busy: null })
      refreshModal()
    },
    'appt-remove': (el) => {
      const d = collect()
      if (el.dataset.emp) d.employeeIds = (d.employeeIds || []).filter((id) => id !== el.dataset.emp)
      else d.attendees = (d.attendees || []).filter((_, i) => i !== Number(el.dataset.i))
      refreshModal()
    },
    'appt-freebusy': async () => {
      const d = collect()
      const m = app.ui.modal
      try {
        const emails = inviteList(d, employeesById()).map((x) => x.email)
        m.busy = await freeBusy(await calendarToken(), emails, { from: d.start, to: d.end })
      } catch (err) {
        m.error = err.message
      }
      if (app.ui.modal === m) refreshModal()
    },
    'appt-save': async () => {
      const d = collect()
      const errors = validateAppointment(d)
      if (errors.length) {
        app.ui.modal.error = errors.join(' ')
        return refreshModal()
      }
      closeModal()
      try {
        await saveAppointment(d)
      } catch (err) {
        toast(err.message)
      }
    },
    'appt-cancel': (el) => {
      const a = byId(el.dataset.id)
      if (!a || !confirmStep(`ap-cancel:${a.id}`, refreshModal)) return
      if (!a.outlook?.id) {
        data().items = items().filter((x) => x.id !== a.id)
        persist()
        closeModal()
        renderNow()
        return toast('Termin gelöscht.')
      }
      cancelAppointment(a.id)
    },
    'appt-delete': (el) => {
      data().items = items().filter((x) => x.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
    },
    'appt-sync-all': async () => {
      const list = items().filter((a) => !a.cancelled && outlookState(a) !== 'ok' && a.sync !== false)
      let ok = 0
      for (const a of list) if (outlookState(await syncAppointment(a.id, { quiet: true })) === 'ok') ok++
      toast(`${ok} von ${list.length} in Outlook eingetragen.`)
    },
    'appt-sync': async (el) => {
      await syncAppointment(el.dataset.id)
    },
    'appt-ics': () => {
      const d = collect()
      const text = icsEvent(icsData({ ...d, id: d.id || uid('ter'), location: locationText(d) }))
      download(`Termin ${dateOf(d.start)} ${d.title || 'Termin'}.ics`.replace(/[\\/:*?"<>|]+/g, '-'), new Blob([text], { type: 'text/calendar;charset=utf-8' }))
    },
  },
  { edit: MODULE },
)

registerActions({
  'appt-open': async (el) => {
    openModal({ type: 'appt', id: el.dataset.id })
    // Antworten der Eingeladenen aus Outlook holen (nur wer den Termin angelegt hat, sieht sie)
    const a = byId(el.dataset.id)
    if (a?.outlook?.id && outlookOn() && isOrganizer(a)) {
      const m = app.ui.modal
      try {
        m.responses = await eventResponses(await calendarToken(), a.outlook.id)
        if (app.ui.modal === m) refreshModal()
      } catch {
        /* ohne Antworten weiter */
      }
    }
  },
  'appt-outlook-toggle': (el) => {
    app.ui.termOutlook = el.checked
    outlookCache.clear()
    renderNow()
  },
})

// ---------------------------------------------------------------- Für andere Ansichten

/** Termine eines Tages für die Zeitlinie: [{ a, start, end (Minuten ab Mitternacht) | allDay, employeeIds }] */
export function appointmentsOfDay(date) {
  if (app.access && !app.access.sees(MODULE) && !app.access.sees('planung')) return []
  return appointmentsBetween(items(), date, date).map((a) => ({ a, ...(dayPart(a, date) || { allDay: true }), employeeIds: employeesOf(a, app.data.employees) }))
}
export const appointmentColor = (a) => KIND_COLOR[a.kind] || 8
export { locationText as appointmentLocation }

registerTodo({
  id: 'termine',
  module: MODULE,
  title: 'Termine',
  compute: () => (outlookOn() ? items().filter((a) => !a.cancelled && dateOf(a.end || a.start) >= todayISO() && outlookState(a) === 'fehler').map((a) => ({ id: `${a.id}:${a.updatedAt || ''}`, a })) : []),
  render: (list) =>
    list
      .map(({ a }) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(a.title)}</strong> · ${esc(whenText(a, formatDate))}<br><span class="muted">Nicht in Outlook: ${esc(a.outlook?.error || '')}</span></div><button class="btn small primary" data-action="appt-sync" data-id="${esc(a.id)}">Erneut eintragen</button></div>`)
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const next = appointmentsBetween(items(), todayISO(), addDays(todayISO(), 60)).filter((a) => a.objectId === objectId)
    if (!next.length) return ''
    return `<p><strong>Termine:</strong> ${next
      .slice(0, 3)
      .map((a) => `<button class="link-btn" data-action="appt-open" data-id="${esc(a.id)}">${esc(whenText(a, formatDate))} ${esc(a.title)}</button>`)
      .join(', ')}</p>`
  },
})
