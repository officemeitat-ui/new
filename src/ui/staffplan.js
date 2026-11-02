// Plan am Handy („Mein Dienstplan“): persönliche Links für Mitarbeitende, Übertragen der
// veröffentlichten Wochen an den Webspace (mein-plan.php) und Anträge unter „Zu erledigen“
// (Urlaub, Zeitausgleich, Pflegefreistellung genehmigen oder ablehnen, Krankmeldung eintragen).
//
// Einstellungen bei den Regeln (rules.portal): Schlüssel für den Webspace, Codes je Person,
// ntfy-Themen für Push, Büro-Handy und E-Mail für neue Anträge. Der Webspace bekommt die
// Codes nur als Hashwert und je Person nur ihre eigenen Wochen.
//
// Einsatzbörse: beim Übertragen gehen dazu je Person die offenen Einsätze mit, die sie laut Regeln
// übernehmen darf. „Ich übernehme“ steht dann unter „Zu erledigen“; „Einteilen“ prüft noch einmal,
// teilt ein, sagt weiteren Meldungen ab und veröffentlicht die Woche neu.

import { employedOn } from '../core/contract.js'
import { addDays, dayIndex, formatDate, mondayOf, todayISO } from '../core/dates.js'
import { PlanState } from '../core/plan.js'
import { evaluateCandidate } from '../core/scheduler.js'
import { hashIndex, newCode, offeredBy, openRequests, personalLink, portalEmployees, portalFile, PORTAL_DEFAULTS, requestText, savePayload, sha256Hex, shiftOffers, staffWeek } from '../core/staffplan.js'
import { ALARM_DEFAULTS, viennaParts } from '../core/weather.js'
import { addLog, app, canEdit, closeModal, compute, empName, ensureRange, openModal, persist, recordUndo, registerActions, registerModal, renderModal, renderNow, toast } from './context.js'
import { addAbsence } from './modals/absence.js'
import { portalNote } from './modals/publish.js'
import { invalidateTodo, refreshBell, registerTodo } from './modals/todo.js'
import { accountAfterWeek } from './pdf.js'
import { publishWeek } from './planning.js'
import { downloadQrPosters } from './timeclock.js'
import { checked, download, esc, ICON, modalFrame, val } from './shared.js'

const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
const address = () => new URL('.', location.href).href
const ntfyServer = () => app.data?.rules?.weather?.alarm?.ntfy || ALARM_DEFAULTS.ntfy
const empById = (id) => app.data.employees.find((e) => e.id === id)
const firstName = (name) => String(name || '').split(' ')[0]
const product = () => app.config.brand?.app || app.config.brand?.name || 'Dienstplan'

export const portalSettings = () => ({ ...PORTAL_DEFAULTS, ...(app.data?.rules?.portal || {}) })

function saveSettings(portal) {
  app.data.rules = { ...(app.data.rules || {}), portal }
  persist()
}

/** Schlüssel und Codes ergänzen: jede Person, die heute oder später beschäftigt ist, bekommt einen Link. */
function complete(p) {
  const today = todayISO()
  const out = { ...p, codes: { ...(p.codes || {}) }, topics: { ...(p.topics || {}) }, oldHashes: { ...(p.oldHashes || {}) } }
  out.key ||= hex(32)
  for (const e of app.data.employees) if (!out.codes[e.id] && (employedOn(e, today) || (e.entryDate && e.entryDate > today))) out.codes[e.id] = newCode()
  if (out.timeclock) withTimeclock(out)
  return out
}

/** Zeiterfassung: Code je Objekt (für den QR-Aushang) und Prüfschlüssel für den Cronjob. */
function withTimeclock(d) {
  d.objectTokens = { ...(d.objectTokens || {}) }
  for (const o of app.data.objects) d.objectTokens[o.id] ||= newCode().toUpperCase().slice(0, 12)
  d.cronKey ||= hex(16)
  return d
}

export const cronUrl = (p) => `${address()}mein-plan.php?aktion=pruefen&schluessel=${p.cronKey || '(nach dem Speichern)'}`

// ---------------------------------------------------------------- Webspace

export async function call(aktion, body) {
  const res = await fetch(`mein-plan.php?aktion=${aktion}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Schluessel': portalSettings().key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  if (!json) throw new Error('mein-plan.php fehlt am Webspace (oder PHP ist aus).')
  if (res.status === 503) throw new Error('Am Webspace noch nicht eingerichtet: unter „Plan am Handy“ die Datei mitarbeiter.json herunterladen und in den Ordner privat/ hochladen (einmalig).')
  if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: mitarbeiter.json neu herunterladen und nach privat/ hochladen.')
  if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
  return json
}

/**
 * Einsatzbörse: offene Einsätze der veröffentlichten Wochen ab jetzt (frühestens in einer Stunde)
 * je Person, die sie laut Regeln übernehmen darf. Liefert { angebote: { hash: [...] }, byEmp }.
 */
async function offersByHash(p) {
  const today = todayISO()
  const now = viennaParts(Date.now())
  const notBefore = dayIndex(now.date) * 1440 + now.hour * 60 + now.minute + 60
  const mondays = Object.keys(app.data.published || {}).filter((m) => m >= mondayOf(today)).sort()
  const byEmp = new Map()
  if (mondays.length) await ensureRange(mondays[0], addDays(mondays.at(-1), 6))
  const objectsById = new Map(app.data.objects.map((o) => [o.id, o]))
  for (const monday of mondays) {
    const c = compute(monday)
    const offers = shiftOffers({ ctx: c.ctx, state: c.state, instances: c.instances, from: monday < today ? today : monday, to: addDays(monday, 6), notBefore, employees: portalEmployees(c.ctx.employees, p.codes, monday), objectsById })
    for (const [id, list] of offers) byEmp.set(id, [...(byEmp.get(id) || []), ...list])
  }
  const angebote = {}
  for (const [id, list] of byEmp) angebote[await sha256Hex(p.codes[id])] = list.slice(0, 20)
  return { angebote, byEmp }
}

/**
 * Veröffentlichte Wochen an den Webspace: je Person ihr Plan (Push bei neuen oder geänderten
 * Wochen macht der Webspace), dazu die Einsatzbörse. Ersetzte Links werden dabei entfernt.
 * null, wenn ausgeschaltet.
 */
export async function sendWeeks(mondays) {
  const p = portalSettings()
  if (!p.enabled || !p.key) return null
  const objectsById = new Map(app.data.objects.map((o) => [o.id, o]))
  const entries = []
  for (const monday of mondays) {
    if (!app.data.published?.[monday]) continue
    const c = compute(monday)
    for (const emp of portalEmployees(c.ctx.employees, p.codes, monday)) {
      entries.push({ hash: await sha256Hex(p.codes[emp.id]), name: emp.name, ntfy: p.topics[emp.id] || '', monday, week: staffWeek(c.timesheet(emp), { objectsById, account: accountAfterWeek(c, emp) }) })
    }
  }
  const offers = p.exchange === false ? { angebote: {}, byEmp: new Map() } : await offersByHash(p)
  const payload = savePayload(entries)
  // wer nur Angebote bekommt (diese Woche nicht dabei), braucht trotzdem Namen und Push-Thema
  const known = new Set(payload.personen.map((x) => x.hash))
  for (const id of offers.byEmp.keys()) {
    const hash = await sha256Hex(p.codes[id])
    if (!known.has(hash)) payload.personen.push({ hash, name: empById(id)?.name || '', ntfy: p.topics[id] || '' })
  }
  const remove = p.remove || []
  const res = await call('speichern', { ...payload, angebote: offers.angebote, entfernen: remove })
  res.angebote = new Set([...offers.byEmp.values()].flat().map((o) => o.id)).size
  res.angebotePersonen = [...offers.byEmp.values()].filter((l) => l.some((o) => o.tausch)).length
  if (remove.length) {
    const now = portalSettings()
    saveSettings({ ...now, remove: (now.remove || []).filter((h) => !remove.includes(h)) })
  }
  return res
}

/** Diese und alle kommenden veröffentlichten Wochen (dazu die Vorwoche). */
async function sendAll() {
  const from = addDays(mondayOf(todayISO()), -7)
  const mondays = Object.keys(app.data.published || {}).filter((m) => m >= from).sort()
  if (mondays.length) await ensureRange(mondays[0], addDays(mondays.at(-1), 6))
  return sendWeeks(mondays)
}

// ---------------------------------------------------------------- Anträge

const req = { at: 0, running: false, list: [], error: '', retry: [], timer: null, loaded: false }

/** Anträge vom Webspace holen (höchstens alle 3 Minuten, force: sofort). */
export async function loadRequests({ force = false } = {}) {
  const p = portalSettings()
  if (!p.enabled || !p.key || req.running || !canEdit('planung') || app.readOnly || (!force && Date.now() - req.at < 180e3)) return
  req.running = true
  req.at = Date.now()
  try {
    // Entscheidungen, die beim letzten Mal nicht ankamen, zuerst nachholen
    for (const d of [...req.retry]) {
      await call('antrag-status', d)
      req.retry = req.retry.filter((x) => x !== d)
    }
    const [json, index] = await Promise.all([call('antraege'), hashIndex(p)])
    const before = new Set(req.list.map((a) => a.id))
    req.list = openRequests(json.antraege, index)
    req.error = ''
    const fresh = req.list.filter((a) => !before.has(a.id))
    if (fresh.length || req.list.length !== before.size) changed()
    if (fresh.length && req.loaded) toast(fresh.length === 1 ? `Neu von ${fresh[0].employeeId ? empName(fresh[0].employeeId) : fresh[0].name}: ${requestText(fresh[0], formatDate)}. Unter „Zu erledigen“.` : `${fresh.length} neue Anträge von Mitarbeitenden unter „Zu erledigen“.`)
    req.loaded = true
  } catch (err) {
    req.error = err.message || String(err)
  }
  req.running = false
}

function changed() {
  invalidateTodo()
  refreshBell()
  if (app.ui.modal?.type === 'todo') renderModal()
}

function startPolling() {
  if (req.timer || typeof window === 'undefined') return
  req.timer = setInterval(() => loadRequests(), 180e3)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && loadRequests())
}

/** Antrag am Webspace entscheiden (Person bekommt Push, außer bei „erledigt“). */
async function decide(a, status, antwort = '') {
  req.list = req.list.filter((x) => x.id !== a.id)
  changed()
  const body = { id: a.id, status, antwort }
  try {
    await call('antrag-status', body)
    return true
  } catch (err) {
    req.retry.push(body)
    toast(`Antwort an ${a.name} noch nicht übertragen (${err.message}). Wird beim nächsten Abruf nachgeholt.`)
    return false
  }
}

/** Meldung aus der Einsatzbörse: noch einmal prüfen, einteilen, andere Meldungen absagen, Woche neu veröffentlichen. */
async function assignFromRequest(a) {
  const monday = mondayOf(a.von)
  await ensureRange(a.von, a.von)
  const c = compute(monday)
  const inst = c.instances.find((i) => i.key === a.einsatz)
  const emp = c.ctx.employeesById.get(a.employeeId)
  if (!emp) return toast('Person nicht gefunden.')
  if (!inst || inst.status === 'cancelled') {
    await decide(a, 'abgelehnt', 'Der Einsatz entfällt. Danke trotzdem!')
    return toast(`Der Einsatz entfällt inzwischen; ${emp.name} bekommt Bescheid.`)
  }
  const what = `${formatDate(inst.date)} ${inst.startTime}–${inst.endTime} ${c.ctx.objectsById.get(inst.objectId)?.name || ''}`.trim()
  if (c.state.has(emp.id, inst.key)) {
    await decide(a, 'genehmigt')
    return toast(`${emp.name} ist dort schon eingeteilt.`)
  }
  // voll besetzt: nur möglich, wenn jemand den Einsatz abgibt (Tausch)
  const giver = c.state.count(inst.key) >= (inst.staff || 1) ? offeredBy(c.state, inst.key) : null
  if (c.state.count(inst.key) >= (inst.staff || 1) && !giver) {
    await decide(a, 'abgelehnt', 'Schon vergeben. Danke für die Meldung!')
    return toast(`${what} ist schon besetzt; ${emp.name} bekommt Bescheid.`)
  }
  const ev = evaluateCandidate(c.ctx, c.state, emp, inst)
  if (!ev.allowed) return toast(`${emp.name} passt nicht mehr: ${ev.blocking.map((i) => i.message).join('; ')}. Bitte ablehnen oder von Hand einteilen.`)
  const giverName = giver ? empName(giver.employeeId) : ''
  recordUndo(giver ? `Tausch: ${emp.name} statt ${giverName}` : `Einsatzbörse: ${emp.name} eingeteilt`)
  const state = new PlanState(c.instances, app.data.assignments)
  if (giver) state.unassign(giver.employeeId, inst.key)
  state.assign(emp.id, inst.key, true)
  app.data.assignments = state.toObject()
  addLog(monday, giver ? `Tausch über die Einsatzbörse: ${emp.name} übernimmt ${what} von ${giverName}` : `Einsatzbörse: ${emp.name} übernimmt ${what}`)
  persist()
  await decide(a, 'genehmigt')
  // der abgebenden Person Bescheid geben (über ihre Anfrage, falls es eine gab)
  if (giver?.request) {
    const body = { id: giver.request, status: 'erledigt', antwort: `Übernimmt: ${emp.name}` }
    await call('antrag-status', body).catch(() => req.retry.push(body))
  }
  if (state.count(inst.key) >= (inst.staff || 1)) for (const other of req.list.filter((x) => x.art === 'Einsatz' && x.einsatz === inst.key)) await decide(other, 'abgelehnt', 'Schon vergeben. Danke für die Meldung!')
  // Woche neu veröffentlichen: Plan am Handy und Börse sind gleich aktuell
  let note = ''
  if (app.data.published?.[monday]) {
    try {
      note = portalNote(await publishWeek({ c: compute(monday), files: app.store?.kind === 'sharepoint' }))
    } catch (err) {
      note = ` Woche nicht neu veröffentlicht: ${err.message}`
    }
  }
  renderNow()
  toast(`${emp.name} ist eingeteilt: ${what}${giver ? ` (statt ${giverName})` : ''}.${note}`)
}

/** Einsatz in die Börse stellen (die Person bleibt eingeteilt, bis jemand übernimmt) oder wieder herausnehmen. */
export async function offerShift(key, empId, { on = true, request = '' } = {}) {
  const list = app.data.assignments[key] || []
  if (!list.some((x) => x.employeeId === empId)) return toast('Die Person ist dort nicht mehr eingeteilt.')
  recordUndo(on ? 'In die Einsatzbörse gestellt' : 'Aus der Einsatzbörse genommen')
  app.data.assignments[key] = list.map((x) => {
    if (x.employeeId !== empId) return x
    const { offered, request: r, ...rest } = x
    return on ? { ...rest, offered: true, ...(request ? { request } : {}) } : rest
  })
  addLog(mondayOf(key.slice(0, 10)), `${on ? 'In die Einsatzbörse gestellt' : 'Aus der Einsatzbörse genommen'}: ${empName(empId)}, ${formatDate(key.slice(0, 10))}`)
  persist()
  renderNow()
  try {
    const r = await sendWeeks([])
    return r
  } catch (err) {
    toast(`Gespeichert, aber die Börse am Handy ist noch nicht aktuell: ${err.message}`)
    return null
  }
}

/** Knopf im Einsatz-Dialog je eingeteilter Person. */
export function offerButton(inst, a) {
  const p = portalSettings()
  if (!p.enabled || p.exchange === false || !p.codes || inst.status === 'cancelled' || inst.date < todayISO()) return ''
  return a.offered
    ? `<span class="tag">in der Börse</span><button class="btn small" data-action="portal-offer" data-key="${esc(inst.key)}" data-emp="${esc(a.employeeId)}" data-off="1">Aus der Börse</button>`
    : `<button class="btn small" data-action="portal-offer" data-key="${esc(inst.key)}" data-emp="${esc(a.employeeId)}" title="Kolleg:innen am Handy anbieten; die Person bleibt eingeteilt, bis jemand übernimmt">In die Börse</button>`
}

const sentAt = (s) => new Date(s * 1000).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

registerTodo({
  id: 'antraege',
  module: 'planung',
  title: 'Anträge von Mitarbeitenden',
  compute: () => {
    startPolling()
    loadRequests()
    return req.list
  },
  render: (items) =>
    items
      .map((a) => {
        const krank = a.art === 'Krankenstand'
        const shift = a.art === 'Einsatz'
        const who = a.employeeId ? empName(a.employeeId) : a.name
        const btn = (what, label, cls = '') => `<button class="btn small ${cls}" data-action="portal-request" data-id="${esc(a.id)}" data-do="${what}">${label}</button>`
        const reject = `<button class="btn small" data-action="portal-reject" data-id="${esc(a.id)}">Ablehnen</button>`
        if (a.art === 'Abgabe') return `<div class="todo-item"><span class="flag warning">⇄</span><div class="todo-text"><strong>${esc(who)}</strong> ${esc(requestText(a, formatDate))}${a.notiz ? `<br>„${esc(a.notiz)}“` : ''}<br><span class="muted">über „Mein Dienstplan“, ${esc(sentAt(a.erstellt))}. „In die Börse“: Kolleg:innen sehen den Einsatz am Handy; bis jemand übernimmt, bleibt ${esc(who)} eingeteilt.</span></div><div class="todo-acts">${a.employeeId ? btn('boerse', 'In die Börse', 'primary') : ''}${reject}</div></div>`
        if (shift) return `<div class="todo-item"><span class="flag info">+</span><div class="todo-text"><strong>${esc(who)}</strong> ${esc(requestText(a, formatDate))}<br><span class="muted">Einsatzbörse am Handy, ${esc(sentAt(a.erstellt))}</span></div><div class="todo-acts">${a.employeeId ? btn('einteilen', 'Einteilen', 'primary') : ''}${reject}</div></div>`
        const acts = krank ? `${a.employeeId ? btn('eintragen', 'Eintragen', 'primary') : ''}${btn('erledigt', 'Schon erledigt')}` : `${a.employeeId ? btn('genehmigen', a.art === 'Pflegefreistellung' ? 'Eintragen' : 'Genehmigen', 'primary') : ''}<button class="btn small" data-action="portal-reject" data-id="${esc(a.id)}">Ablehnen</button>`
        return `<div class="todo-item"><span class="flag ${krank ? 'error' : 'warning'}">${krank ? '!' : '?'}</span><div class="todo-text"><strong>${esc(who)}</strong>: ${esc(requestText(a, formatDate))}${a.notiz ? `<br>„${esc(a.notiz)}“` : ''}<br><span class="muted">über „Mein Dienstplan“, ${esc(sentAt(a.erstellt))}${a.employeeId ? '' : ' · keiner Person zuordenbar (Link inzwischen ersetzt?)'}</span></div><div class="todo-acts">${acts}</div></div>`
      })
      .join(''),
})

// ---------------------------------------------------------------- Einstellungen (Dialog)

function draft() {
  const m = app.ui.modal
  if (!m.draft) {
    const p = portalSettings()
    m.draft = complete({ ...p, enabled: p.enabled || !p.key })
  }
  return m.draft
}

function readForm() {
  const d = draft()
  if (!document.getElementById('pt-enabled')) return d
  d.enabled = checked('pt-enabled')
  d.exchange = checked('pt-exchange')
  d.timeclock = checked('pt-timeclock')
  if (document.getElementById('pt-alarm')) d.alarmMin = Math.max(0, Math.round(Number(val('pt-alarm')) || 0))
  if (d.timeclock) withTimeclock(d)
  d.officeEmails = val('pt-emails').trim()
  d.sender = val('pt-sender').trim()
  if (checked('pt-office')) d.officeTopic ||= app.data.rules?.weather?.alarm?.topics?.office || `mp-${hex(8)}`
  else d.officeTopic = ''
  return d
}

function messageFor(emp, d) {
  const link = personalLink(address(), d.codes[emp.id])
  const topic = d.topics[emp.id]
  return `Hallo ${firstName(emp.name)},\n\nhier ist dein persönlicher Dienstplan (${product()}):\n${link}\n\nEinmal öffnen, dann im Browser-Menü „Zum Startbildschirm“ wählen. Dort siehst du deine Einsätze und kannst Urlaub beantragen oder dich krank melden.${topic ? `\n\nFür eine Nachricht bei jedem neuen Plan: App „ntfy“ installieren, auf + tippen und dieses Thema abonnieren: ${topic}` : ''}\n\nDer Link ist nur für dich, bitte nicht weitergeben.`
}

function portalModal() {
  const d = draft()
  const today = todayISO()
  const people = app.data.employees.filter((e) => d.codes[e.id] && (employedOn(e, today) || (e.entryDate && e.entryDate > today))).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const rows = people
    .map((e) => {
      const msg = messageFor(e, d)
      const topic = d.topics[e.id]
      const mail = e.email ? `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent('Dein Dienstplan am Handy')}&body=${encodeURIComponent(msg)}` : ''
      return `<tr><td>${esc(e.name)}</td>
        <td class="actions"><button class="btn small" data-action="portal-copy" data-text="${esc(personalLink(address(), d.codes[e.id]))}">${ICON.copy} Link</button><a class="btn small" href="https://wa.me/?text=${esc(encodeURIComponent(msg))}" target="_blank" rel="noopener">WhatsApp</a>${mail ? `<a class="btn small" href="${esc(mail)}">E-Mail</a>` : ''}</td>
        <td>${topic ? `<code>${esc(topic)}</code> <button class="btn small" data-action="portal-push" data-emp="${esc(e.id)}" title="Keine Push-Nachrichten mehr">aus</button>` : `<button class="btn small" data-action="portal-push" data-emp="${esc(e.id)}">Push einrichten</button>`}</td>
        <td><button class="btn small" data-action="portal-newlink" data-emp="${esc(e.id)}" title="Wenn der Link in falsche Hände geraten ist (z. B. Handy verloren): der alte gilt dann nicht mehr">Neuer Link</button></td></tr>`
    })
    .join('')
  const status = req.error ? `<div class="banner warn-banner"><p>Anträge konnten nicht geholt werden: ${esc(req.error)}</p></div>` : ''
  return modalFrame({
    title: 'Plan am Handy (Mein Dienstplan)',
    wide: true,
    body: `<label class="check"><input type="checkbox" id="pt-enabled" ${d.enabled ? 'checked' : ''}><span><strong>Plan am Handy ein</strong>: Mitarbeitende sehen über einen persönlichen Link (ohne Anmeldung) ihre veröffentlichten Wochen mit Zeiten, Objekten, Adressen, Hinweisen, Stunden und Zeitkonto. Sie können Urlaub, Zeitausgleich oder Pflegefreistellung beantragen und sich krank melden; das landet hier unter „Zu erledigen“.</span></label>
      <label class="check"><input type="checkbox" id="pt-exchange" ${d.exchange !== false ? 'checked' : ''}><span><strong>Einsatzbörse</strong>: offene Einsätze der veröffentlichten Wochen erscheinen am Handy bei allen, die sie laut Regeln übernehmen dürfen (eingeschult, verfügbar, Ruhezeit, Höchstarbeitszeit, nicht abwesend). „Ich übernehme“ landet unter „Zu erledigen“; eingeteilt wird erst mit „Einteilen“ im Büro.</span></label>
      ${status}
      <h3>Persönliche Links</h3>
      <p class="note">Link per WhatsApp oder E-Mail schicken. Beim ersten Öffnen merkt sich das Handy den Link (Tipp: „Zum Startbildschirm“). Beim Veröffentlichen einer Woche gehen die Pläne automatisch mit; wer Push eingerichtet hat, bekommt eine Nachricht bei neuen und geänderten Wochen (App „ntfy“, wie beim Schnee-Alarm). Der Link wirkt wie ein Passwort: bei Verlust „Neuer Link“.</p>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Link schicken</th><th>Push (ntfy)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Mitarbeitenden.</p>'}
      <h3>Zeiterfassung im Objekt (QR-Code)</h3>
      <label class="check"><input type="checkbox" id="pt-timeclock" data-change="portal-redraw" ${d.timeclock ? 'checked' : ''}><span><strong>Zeiterfassung ein</strong>: Je Objekt hängt ein QR-Code. Mit der Handy-Kamera scannen, „Kommen“ bzw. „Gehen“ tippen; die Uhrzeit nimmt der Server, nicht das Handy. Die App zeigt die Ist-Zeiten neben dem Plan (Ansicht „Ist-Zeiten“, im Einsatz-Dialog); die Stunden im Wochenzettel bleiben die geplanten.</span></label>
      ${d.timeclock ? `<div class="form-grid"><label class="field"><span>Alarm „nicht eingestempelt“ nach (Minuten, 0 = aus)</span><input type="number" id="pt-alarm" min="0" step="5" value="${esc(d.alarmMin ?? 20)}"></label></div>
      <p class="note">Der Alarm geht per Push ans Büro-Handy und an die Person, nur bei Personen, die schon einmal gestempelt haben, und höchstens einmal je Einsatz. Dafür am Webspace einen <strong>Cronjob alle 5 bis 10 Minuten</strong> (wie beim Schnee-Alarm): <code>php mein-plan.php pruefen</code> im Ordner der App oder diese Adresse aufrufen lassen:</p>
      <p><code class="wrap">${esc(cronUrl(d))}</code> ${d.cronKey ? `<button class="btn small" data-action="portal-copy" data-text="${esc(cronUrl(d))}">Adresse kopieren</button>` : ''}</p>
      <p><button class="btn" data-action="portal-qr">${ICON.print} QR-Aushänge (PDF)</button> <span class="muted">${Object.keys(d.objectTokens || {}).length} Objekte, je Objekt eine Seite</span></p>
      <p class="note">Vorher mit dem Betriebsrat bzw. schriftlich regeln (Zeiterfassung ist ein Kontrollsystem) und die Mitarbeitenden informieren; siehe Rechtsprüfung. Kein GPS: der Code am Objekt zeigt, dass das Handy dort war.</p>` : ''}
      <h3>Anträge ans Büro</h3>
      <label class="check"><input type="checkbox" id="pt-office" ${d.officeTopic ? 'checked' : ''}><span>Büro-Handy bekommt neue Anträge und Krankmeldungen per Push${d.officeTopic ? `: Thema <code>${esc(d.officeTopic)}</code> <button class="btn small" data-action="portal-copy" data-text="${esc(d.officeTopic)}">kopieren</button>` : ''}</span></label>
      <div class="form-grid">
        <label class="field wide"><span>Zusätzlich per E-Mail an</span><input type="text" id="pt-emails" value="${esc(d.officeEmails || '')}" placeholder="z. B. office@…, mehrere mit Komma"></label>
        <label class="field"><span>Absender der E-Mails</span><input type="email" id="pt-sender" value="${esc(d.sender || '')}" placeholder="z. B. dienstplan@…"></label>
      </div>
      <h3>Webspace</h3>
      <p class="note"><strong>Einmalig:</strong> „Einrichtungs-Datei herunterladen“ und die Datei <code>mitarbeiter.json</code> per FTP in den Ordner <code>privat/</code> der App laden (der Ordner ist gesperrt). Danach überträgt „Speichern und übertragen“ jede Änderung direkt, dazu die veröffentlichten Wochen ab der Vorwoche. Am Webspace liegen nur die Pläne und Hashwerte der Links, keine Lohn- oder Gesundheitsdaten.</p>`,
    foot: `<button class="btn" data-action="portal-download">${ICON.download} Einrichtungs-Datei herunterladen</button>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn" data-action="portal-save">Speichern</button><button class="btn primary" data-action="portal-save" data-send="1">Speichern und übertragen</button></div>`,
  })
}

registerModal('portal', portalModal, { module: 'planung' })

function rejectModal(c, { id }) {
  const a = req.list.find((x) => x.id === id)
  if (!a) return null
  return modalFrame({
    title: a.art === 'Einsatz' ? 'Meldung ablehnen' : 'Antrag ablehnen',
    subtitle: `${a.employeeId ? empName(a.employeeId) : a.name}: ${requestText(a, formatDate)}`,
    body: `<label class="field"><span>Begründung (bekommt die Person aufs Handy)</span><textarea id="pt-reason" rows="3" maxlength="300" placeholder="z. B. In dieser Woche sind schon zwei Personen im Urlaub. Bitte melde dich im Büro.">${a.art === 'Einsatz' ? 'Schon vergeben. Danke für die Meldung!' : ''}</textarea></label>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn danger" data-action="portal-reject-send" data-id="${esc(a.id)}">Ablehnen</button></div>`,
  })
}

registerModal('portal-reject', rejectModal, { module: 'planung' })

const settingsFile = (p) => portalFile({ portal: p, address: address(), ntfy: ntfyServer(), employees: app.data.employees, objects: app.data.objects })

registerActions(
  {
    'portal-open': () => openModal({ type: 'portal' }),
    'portal-copy': async (el) => {
      try {
        await navigator.clipboard.writeText(el.dataset.text)
        toast('Kopiert.')
      } catch {
        toast(el.dataset.text)
      }
    },
    'portal-redraw': () => {
      readForm()
      renderModal()
    },
    'portal-qr': async () => {
      const d = readForm()
      saveSettings({ ...d })
      // der Webspace muss die Codes kennen
      let note = ''
      try {
        if (d.enabled) await call('einrichten', settingsFile(d))
      } catch (err) {
        note = ` Achtung, noch nicht übertragen: ${err.message}`
      }
      await downloadQrPosters(d)
      toast(`QR-Aushänge erstellt: ausdrucken und je Objekt aufhängen.${note}`)
    },
    'portal-push': (el) => {
      const d = readForm()
      const id = el.dataset.emp
      if (d.topics[id]) delete d.topics[id]
      else d.topics[id] = app.data.rules?.weather?.alarm?.topics?.[id] || `mp-${hex(8)}`
      renderModal()
    },
    'portal-newlink': async (el) => {
      const d = readForm()
      const id = el.dataset.emp
      const old = await sha256Hex(d.codes[id])
      // offene Anträge vom alten Link bleiben zuordenbar; höchstens 200 alte Links merken
      d.oldHashes = Object.fromEntries([...Object.entries(d.oldHashes || {}), [old, id]].slice(-200))
      d.remove = [...new Set([...(d.remove || []), old])]
      d.codes[id] = newCode()
      renderModal()
      toast(`Neuer Link für ${empById(id)?.name}: nach dem Speichern und Übertragen gilt der alte nicht mehr. Neuen Link schicken.`)
    },
    'portal-download': () => {
      const d = readForm()
      download('mitarbeiter.json', new Blob([`${JSON.stringify(settingsFile(d), null, 2)}\n`], { type: 'application/json' }))
      saveSettings({ ...d })
      toast('Gespeichert und heruntergeladen: mitarbeiter.json per FTP in den Ordner privat/ der App laden.')
    },
    'portal-save': async (el) => {
      const d = { ...readForm() }
      saveSettings(d)
      closeModal()
      renderNow()
      if (!el.dataset.send) return toast('Plan am Handy gespeichert. Für den Webspace „Speichern und übertragen“ oder die Einrichtungs-Datei hochladen.')
      if (!d.enabled) return toast('Plan am Handy ausgeschaltet.')
      try {
        await call('einrichten', settingsFile(d))
        const r = await sendAll()
        toast(`Übertragen: Pläne für ${r.personen} ${r.personen === 1 ? 'Person' : 'Personen'}${r.angebote ? `, ${r.angebote === 1 ? '1 offener Einsatz' : `${r.angebote} offene Einsätze`} in der Börse` : ''}${r.benachrichtigt ? `, ${r.benachrichtigt} Push-Nachrichten` : ''}.`)
        loadRequests({ force: true })
      } catch (err) {
        toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
      }
    },
    'portal-request': async (el) => {
      const a = req.list.find((x) => x.id === el.dataset.id)
      if (!a) return
      const what = el.dataset.do
      if (what === 'einteilen') return assignFromRequest(a)
      if (what === 'boerse') {
        await ensureRange(a.von, a.von)
        if (!(app.data.assignments[a.einsatz] || []).some((x) => x.employeeId === a.employeeId)) {
          await decide(a, 'abgelehnt', 'Du bist dort nicht mehr eingeteilt.')
          return toast(`${a.name} ist dort nicht mehr eingeteilt; Anfrage geschlossen.`)
        }
        const r = await offerShift(a.einsatz, a.employeeId, { request: a.id })
        await decide(a, 'genehmigt', 'Dein Einsatz steht in der Einsatzbörse. Bis ihn jemand übernimmt, bleibst du eingeteilt.')
        return toast(`In der Einsatzbörse: passt für ${r?.angebotePersonen ?? 0} Kolleg:innen. ${a.name} bekommt Bescheid.`)
      }
      if (what === 'erledigt') {
        if (await decide(a, 'erledigt')) toast(`Krankmeldung von ${a.name} als erledigt markiert.`)
        return
      }
      const krank = a.art === 'Krankenstand'
      closeModal()
      await addAbsence({ employeeId: a.employeeId, type: a.art, from: a.von, to: a.bis, note: `${krank ? 'Krankmeldung' : 'Antrag'} über „Mein Dienstplan“${a.notiz ? `: ${a.notiz}` : ''}` })
      await decide(a, krank ? 'erledigt' : 'genehmigt')
    },
    'portal-reject': (el) => openModal({ type: 'portal-reject', id: el.dataset.id }),
    'portal-offer': async (el) => {
      const off = !!el.dataset.off
      const r = await offerShift(el.dataset.key, el.dataset.emp, { on: !off })
      if (r) toast(off ? 'Aus der Einsatzbörse genommen.' : `In der Einsatzbörse: passt für ${r.angebotePersonen ?? 0} Kolleg:innen.`)
    },
    'portal-reject-send': async (el) => {
      const a = req.list.find((x) => x.id === el.dataset.id)
      if (!a) return closeModal()
      const reason = val('pt-reason').trim()
      if (!reason) return toast('Bitte kurz begründen: die Person sieht die Begründung am Handy.')
      closeModal()
      if (await decide(a, 'abgelehnt', reason)) toast(`Abgelehnt: ${a.name} bekommt die Begründung aufs Handy.`)
      openModal({ type: 'todo' })
    },
  },
  { edit: 'planung' },
)
