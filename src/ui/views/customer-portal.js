// Kundenbereich in der App: persönliche Links für Kunden bzw. Objekte anlegen, kopieren, per E-Mail
// senden, sperren und erneuern, festlegen, was jeder Link zeigt. Übertragen an den Webspace
// (kunden.php) wie „Plan am Handy“: je Link ein JSON (Objekte, Termine, Liste der Nachweise) und die
// PDFs, aber nur neue oder geänderte. Reklamationen aus dem Kundenbereich kommen zurück wie die
// Anträge der Mitarbeitenden (alle 3 Minuten, solange jemand mit Reklamationen die App offen hat),
// werden zu Reklamationen mit Eingang „Kundenbereich“ (Foto nach SharePoint), ihr Stand geht zurück.
//
// Rechnungen (je Link, Standard aus): Belege der gewählten Kunden der Fakturierung mit PDF und QR-Code
// (views/invoicing-online.js, erst bei Bedarf geladen). Angebot online annehmen: Codes der Angebote stehen
// hier unter offers, die Annahmen holt syncAcceptances ab wie die Reklamationen (doc.acceptance in der
// Fakturierung, außerhalb der Prüfsumme) und meldet sie unter „Zu erledigen“.
//
// Wer: Vollzugriff und Rollen, die Reklamationen oder die Einsatzplanung bearbeiten. Nachweise und
// Termine brauchen den Plan (lesen), Rechnungen die Fakturierung (lesen); ohne das bleibt am Webspace
// der letzte Stand. Annahmen übernimmt, wer die Fakturierung bearbeitet.
// Daten: kundenbereich/kundenbereich.json { settings, links: [{ id, title, objectIds, token, show, months,
// invoices: { customerIds, months }, email, createdAt, createdBy, revokedAt, removedAt, renewedAt,
// publishedAt, error, cache }], offers: [{ id, docId, number, token, createdAt, createdBy, publishedAt,
// validUntil, revokedAt, removedAt, acceptedAt, error }] }.
// Rechenkern: core/customer-portal.js, core/customer-invoices.js.

import { acceptanceOf, acceptedOpen, INVOICE_FILE_PATTERN, INVOICE_MONTH_CHOICES, invoiceSettings, newAcceptances, suggestCustomers } from '../../core/customer-invoices.js'
import { customerAppointments, customerLink, complaintFromReport, fileName, isActive, linkMail, linkPayload, linkState, markSent, MONTH_CHOICES, newLinkId, newReports, releasedMonths, SETTINGS_DEFAULTS, SHOW, SHOW_OFF, showDefaults, stableJson, statusUpdates, upcomingDates, upcomingServices } from '../../core/customer-portal.js'
import { addDays, formatDate, lastOfMonth, todayISO } from '../../core/dates.js'
import { monthName } from '../../core/payout.js'
import { objectsWithWork, proofFor } from '../../core/proof.js'
import { newCode, sha256Hex } from '../../core/staffplan.js'
import { absMinutes } from '../../core/timeclock.js'
import { ALARM_DEFAULTS } from '../../core/weather.js'
import { logRows } from '../../core/winterlog.js'
import { proofDocument, proofPdfName } from '../../export/proof-pdf.js'
import { winterLogDocument, winterLogPdfName } from '../../export/winter-pdf.js'
import { app, canEdit, closeModal, computeRange, confirmStep, ensureRange, ensureView, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { invalidateTodo, refreshBell, registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, modalFrame, options, rowMenu, val } from '../shared.js'
import { portalSettings } from '../staffplan.js'
import { alarmSettings } from './weather-alarm.js'

const MODULES = ['reklamationen', 'planung']
const ICON_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/>'
const mayManage = () => !app.access || app.access.all || MODULES.some((m) => app.access.canEdit(m))
const editable = () => mayManage() && !app.readOnly
const seesPlan = () => !app.access || app.access.sees('planung')
const seesInvoices = () => (!app.access || app.access.sees('fakturierung')) && !!app.data.fakturierung
const editsInvoices = () => canEdit('fakturierung') && !app.readOnly && !!app.data.fakturierung
const doc = () => {
  const d = (app.data.kundenbereich ||= { links: [], settings: {} })
  d.links ||= []
  d.settings ||= {}
  return d
}
const offers = () => (doc().offers ||= [])
const settings = () => ({ ...SETTINGS_DEFAULTS, ...doc().settings })
const links = () => doc().links
const linkOf = (id) => links().find((l) => l.id === id)
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const complaints = () => ((app.data.reklamationen ||= { items: [] }).items ||= [])
const address = () => new URL('.', location.href).href
const urlOf = (link) => customerLink(address(), link.token)
const showOf = (link) => ({ ...showDefaults(), ...(link.show || {}) })
const fakCustomers = () => app.data.fakturierung?.customers || []
/** Rechnungen und Angebote: mit der Fakturierung geladen (views/lazy.js), hier erst bei Bedarf. */
const invoicingOnline = async () => {
  await ensureView('fakturierung')
  return import('./invoicing-online.js')
}
const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
const by = () => app.user?.name || 'Browser'
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const brand = () => app.config.brand || {}

// ---------------------------------------------------------------- Webspace

/** Aufruf von kunden.php mit dem Schlüssel; raw: Datei als Rumpf (PDF). */
async function call(aktion, { body, raw, type = 'application/pdf', query = '', freigabe = '' } = {}) {
  const post = body !== undefined || raw !== undefined
  const res = await fetch(`kunden.php?aktion=${aktion}${query}`, {
    method: post ? 'POST' : 'GET',
    headers: { 'X-Schluessel': settings().key, ...(freigabe ? { 'X-Freigabe': freigabe } : {}), ...(post ? { 'Content-Type': raw !== undefined ? type : 'application/json' } : {}) },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (aktion === 'foto' && res.ok) return res.blob()
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null
  if (!json) throw new Error('kunden.php fehlt am Webspace (oder PHP ist aus).')
  if (res.status === 503) throw Object.assign(new Error('Am Webspace noch nicht eingerichtet: unter „Einstellungen“ die Datei kundenbereich.json herunterladen und in den Ordner privat/ hochladen (einmalig).'), { status: 503 })
  if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: kundenbereich.json neu herunterladen und nach privat/ hochladen.')
  if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
  return json
}

/** Für die Online-Annahme der Angebote (views/invoicing-online.js): gleicher Webspace, gleicher Schlüssel. */
export const portalCall = call
export const portalReady = () => !!(settings().enabled && settings().key)
export const portalOffers = () => offers()
export const portalAddress = () => address()

const ntfyServer = () => app.data?.rules?.weather?.alarm?.ntfy || ALARM_DEFAULTS.ntfy

/** Einstellungen für privat/kundenbereich.json (nur, was der Webspace braucht; keine Links). */
export function settingsFile(s = settings()) {
  const buero = []
  if (s.officeTopic) buero.push({ name: 'Büro-Handy', ntfy: s.officeTopic })
  for (const email of String(s.officeEmails || '').split(/[,;\s]+/).filter(emailOk)) buero.push({ name: 'Büro', email })
  return { version: 1, schluessel: s.key, adresse: address(), ntfy: ntfyServer(), absender: s.sender || '', buero, firma: { name: brand().name || brand().app || '', telefon: s.phone || '', email: s.email || '', datenschutz: /^https:\/\//.test(s.privacyUrl || '') ? s.privacyUrl : '', freigabeTag: Math.max(1, Math.min(28, Number(s.releaseDay) || 5)) } }
}

/** Einstellungen an den Webspace; beim ersten Mal (noch keine Datei dort) mit dem Schlüssel von Plan am Handy oder Schnee-Alarm. */
async function setup() {
  const file = settingsFile()
  try {
    return await call('einrichten', { body: file })
  } catch (err) {
    if (err.status !== 503) throw err
    for (const freigabe of [portalSettings().key, alarmSettings().key].filter(Boolean)) {
      try {
        return await call('einrichten', { body: file, freigabe })
      } catch (e) {
        if (e.status !== 503) throw e
      }
    }
    throw err
  }
}

// ---------------------------------------------------------------- Veröffentlichen

const pub = { running: false, error: '', held: [], at: 0 }
const proofSettings = () => ({ names: 'keine', times: true, signature: true, ...(app.data.nachweise?.settings || {}) })

/** Monat rechnen (Wochen laden), je Lauf nur einmal. */
async function monthData(month, memo) {
  if (!memo.has(month)) {
    const from = `${month}-01`
    const to = lastOfMonth(from)
    await ensureRange(from, to)
    memo.set(month, { from, to, r: computeRange(from, to) })
  }
  return memo.get(month)
}

/**
 * Nachweise eines Links in einem Monat: [{ datei, art, objectId, objekt, name, titel, sig, make(logo) }] und
 * zurückgehaltene (Einsätze ohne Besetzung: erst im Leistungsnachweis klären).
 */
async function filesForMonth(link, month, memo) {
  const key = `${link.id}|${month}`
  if (memo.has(key)) return memo.get(key)
  const { from, to, r } = await monthData(month, memo)
  const s = proofSettings()
  const ids = objectsWithWork(r.instances, { from, to })
  const winter = logRows(app.data.winterlog || {}, { from, to, objectsById: r.ctx.objectsById })
  const files = []
  const held = []
  for (const [i, objectId] of (link.objectIds || []).entries()) {
    const object = r.ctx.objectsById.get(objectId) || objOf(objectId)
    if (!object) continue
    const nr = i + 1
    const rows = winter.filter((w) => w.objectId === objectId)
    const winterShown = rows.map((w) => ({ date: w.date, time: w.time, geraeumt: !!w.geraeumt, gestreut: !!w.gestreut, kontrolle: !!w.kontrolle, mittel: w.mittel || '', notiz: w.notiz || '', lage: w.lage || '', person: s.names === 'keine' ? '' : w.person || '' }))
    if (ids.has(objectId)) {
      const proof = proofFor({ objectId, from, to, instances: r.instances, state: r.state, stamps: app.data.stamps || {}, employeesById: r.ctx.employeesById, today: todayISO(), now: absMinutes(new Date().toISOString()), names: s.names })
      // nicht besetzte Einsätze: erst im Leistungsnachweis klären; ganz ohne Besetzung (App noch nicht genutzt): kein Nachweis
      if (proof.totals.open && proof.totals.done) held.push({ month, object: object.name, open: proof.totals.open })
      else if (!proof.totals.open && proof.rows.length) {
        const sig = (await sha256Hex(stableJson({ v: 1, art: 'leistung', object: [object.name, object.address || ''], proof, winter: winterShown, s, firma: brand().name || '' }))).slice(0, 32)
        files.push({ datei: fileName(month, 'leistung', nr), art: 'leistung', objectId, objekt: object.name, name: proofPdfName(object.name, month), titel: `Leistungsnachweis ${monthName(month)}`, sig, make: (logo) => pdfBlob(proofDocument({ object, monthLabel: monthName(month), from, to, proof, winter: rows, withTimes: s.times, withNames: s.names !== 'keine', withSignature: s.signature, brand: brand(), logo })) })
      }
    }
    if (rows.length) {
      // ohne Fotos (die bleiben im Büro) und ohne Namen, außer der Leistungsnachweis zeigt Namen
      const log = Object.fromEntries(rows.map((w) => [`${w.date}|${w.objectId}|${w.id}`, { ...w, fotos: [] }]))
      const sig = (await sha256Hex(stableJson({ v: 1, art: 'winter', object: [object.name, object.address || ''], winter: winterShown, names: s.names, firma: brand().name || '' }))).slice(0, 32)
      files.push({ datei: fileName(month, 'winter', nr), art: 'winter', objectId, objekt: object.name, name: winterLogPdfName(month, object.name), titel: `Winterdienst-Nachweis ${monthName(month)}`, sig, make: (logo) => pdfBlob(winterLogDocument({ month, log, objects: [object], objectId, names: s.names, brand: brand(), logo })) })
    }
  }
  const out = { files, held }
  memo.set(key, out)
  return out
}

/** Liste der Nachweise eines Links; ältere Monate aus dem letzten Lauf (außer force oder geänderte Objekte/Einstellungen). */
async function proofList(link, { force, memo, held }) {
  const s = settings()
  const months = releasedMonths({ today: todayISO(), count: Number(link.months) || 12, releaseDay: Number(s.releaseDay) || 5 })
  const cacheKey = stableJson({ objects: link.objectIds, s: proofSettings(), show: link.show || {} })
  const cache = link.cache?.key === cacheKey ? link.cache.months || {} : {}
  const list = []
  const fresh = {}
  for (const [i, month] of months.entries()) {
    if (i > 0 && cache[month] && !force) {
      list.push(...cache[month])
      fresh[month] = cache[month]
      continue
    }
    const r = await filesForMonth(link, month, memo)
    const entries = r.files.map(({ make, ...f }) => f)
    list.push(...entries)
    held.push(...r.held.map((h) => ({ ...h, link: link.title })))
    if (!r.held.length) fresh[month] = entries
  }
  return { list, cache: { key: cacheKey, months: fresh } }
}

/**
 * Links an den Webspace: je Link Objekte, Termine (13 Wochen) und Nachweise; danach nur die PDFs,
 * die dort fehlen oder sich geändert haben. Gesperrte Links werden entfernt. ids: nur diese Links.
 */
export async function publish({ ids = null, force = false } = {}) {
  const s = settings()
  if (!s.enabled || !s.key) return null
  if (pub.running) throw new Error('Übertragung läuft schon.')
  pub.running = true
  const result = { links: 0, pdfs: 0, removed: 0, held: [] }
  try {
    const remove = links().filter((l) => l.revokedAt && !l.removedAt).map((l) => l.id)
    const active = links().filter((l) => isActive(l) && (!ids || ids.includes(l.id)))
    const objectsById = new Map(app.data.objects.map((o) => [o.id, o]))
    const today = todayISO()
    const until = addDays(today, 91)
    const plan = seesPlan()
    const memo = new Map()
    let range = null
    if (plan && active.length) {
      await ensureRange(today, until)
      range = computeRange(today, until)
    }
    const payload = []
    const caches = new Map()
    const invoiceFiles = new Map()
    let online = null
    for (const link of active) {
      const termine = range ? upcomingDates({ services: upcomingServices({ instances: range.instances, tasks: app.data.tasks || [], objectIds: link.objectIds, from: today, to: until, objectsById }), appointments: customerAppointments(app.data.termine?.items || [], { objectIds: link.objectIds, from: today, to: until, objectsById }) }) : null
      let nachweise = null
      if (plan) {
        const p = await proofList(link, { force, memo, held: result.held })
        nachweise = p.list
        caches.set(link.id, p.cache)
      }
      // Rechnungen: nur mit Recht auf die Fakturierung (sonst bleibt am Webspace der letzte Stand)
      let rechnungen = null
      if (showOf(link).rechnungen && seesInvoices()) {
        online ||= await invoicingOnline()
        const list = await online.portalInvoices(link)
        invoiceFiles.set(link.id, list)
        rechnungen = list.map(({ make, ...entry }) => entry)
      }
      payload.push(linkPayload({ link, hash: await sha256Hex(link.token), objectsById, termine, nachweise, rechnungen }))
    }
    const res = await call('speichern', { body: { links: payload, entfernen: remove } })
    result.links = res.links
    result.removed = res.entfernt
    // fehlende oder geänderte PDFs nachschicken
    const logo = await loadLogo().catch(() => null)
    const failed = new Map()
    for (const [id, files] of Object.entries(res.fehlend || {})) {
      const link = linkOf(id)
      if (!link) continue
      for (const datei of files) {
        try {
          const file = INVOICE_FILE_PATTERN.test(datei) ? (invoiceFiles.get(id) || []).find((f) => f.datei === datei) : (await filesForMonth(link, datei.slice(0, 7), memo)).files.find((f) => f.datei === datei)
          if (!file) continue
          await call('datei', { raw: await file.make(logo), query: `&link=${encodeURIComponent(id)}&datei=${encodeURIComponent(datei)}` })
          result.pdfs++
        } catch (err) {
          failed.set(id, err.message)
        }
      }
    }
    const now = new Date().toISOString()
    for (const link of links()) {
      if (remove.includes(link.id)) link.removedAt = now
      if (!active.includes(link)) continue
      link.publishedAt = now
      link.error = failed.get(link.id) || ''
      if (caches.has(link.id) && !failed.has(link.id)) link.cache = caches.get(link.id)
    }
    if (!ids) doc().settings.publishedAt = now
    pub.error = failed.size ? [...failed.values()][0] : ''
    pub.held = result.held
    persist()
    return result
  } catch (err) {
    pub.error = err.message || String(err)
    for (const link of links()) if (isActive(link) && (!ids || ids.includes(link.id))) link.error = pub.error
    throw err
  } finally {
    pub.running = false
    pub.at = Date.now()
    if (app.ui.view === 'kundenbereich') renderNow()
  }
}

const publishNote = (r) => `${plural(r.links, 'Link', 'Links')} übertragen${r.pdfs ? `, ${plural(r.pdfs, 'PDF', 'PDFs')} neu` : ''}${r.removed ? `, ${plural(r.removed, 'gesperrter Link', 'gesperrte Links')} entfernt` : ''}${r.held.length ? `. Zurückgehalten: ${r.held.map((h) => `${h.object} ${monthName(h.month)}`).join(', ')} (Einsätze ohne Besetzung, im Leistungsnachweis klären)` : ''}.`

// ---------------------------------------------------------------- Reklamationen vom Webspace

const sync = { at: 0, running: false, error: '', timer: null }

/** Webspace-Foto in die Reklamation: mit SharePoint dorthin (dann am Webspace löschen), sonst bleibt es dort. */
async function storePhoto(c, datei) {
  if (app.store?.kind !== 'sharepoint') return false
  const blob = await call('foto', { query: `&datei=${encodeURIComponent(datei)}` })
  const path = `reklamationen/fotos/${c.received.slice(0, 7)}/${c.id}.${datei.split('.').pop()}`
  const up = await app.store.upload(path, blob, blob.type || 'image/jpeg')
  c.photos = [{ path, url: up?.webUrl || '' }]
  return true
}

/**
 * Neue Meldungen übernehmen (Reklamation, Foto), den Stand geänderter Reklamationen zurückmelden.
 * Höchstens alle 3 Minuten, force: sofort. Liefert die Zahl der übernommenen Meldungen.
 */
export async function syncReports({ force = false } = {}) {
  const s = settings()
  if (!s.enabled || !s.key || sync.running || !canEdit('reklamationen') || app.readOnly || (!force && Date.now() - sync.at < 180e3)) return 0
  sync.running = true
  sync.at = Date.now()
  let taken = []
  try {
    const { meldungen } = await call('meldungen')
    const fresh = newReports(meldungen, complaints())
    const photosDone = []
    for (const m of fresh) {
      const c = complaintFromReport(m, { link: linkOf(m.link) })
      if (m.foto) {
        c.photos = [{ datei: m.foto }]
        try {
          if (await storePhoto(c, m.foto)) photosDone.push(m.id)
        } catch {
          /* bleibt am Webspace, nächster Versuch beim nächsten Abruf */
        }
      }
      complaints().push(c)
      taken.push(c)
    }
    // Fotos, die beim Übernehmen nicht nach SharePoint kamen, nachholen
    for (const c of complaints()) {
      if (!c.portal?.id || photosDone.includes(c.portal.id) || taken.includes(c) || !c.photos?.[0]?.datei) continue
      try {
        if (await storePhoto(c, c.photos[0].datei)) photosDone.push(c.portal.id)
      } catch {
        /* nächster Versuch */
      }
    }
    if (taken.length || photosDone.length) {
      persist()
      // erst gespeichert, dann am Webspace als übernommen markieren (sonst ginge eine Meldung verloren)
      await app.service?.flush?.()
    }
    // was beim letzten Mal nicht ankam: übernommen, aber am Webspace noch nicht so markiert bzw. Foto noch dort
    const byId = new Map(complaints().filter((c) => c.portal?.id).map((c) => [c.portal.id, c]))
    const known = (meldungen || []).filter((m) => byId.has(String(m.id)))
    const uebernommen = [...new Set([...taken.map((c) => c.portal.id), ...known.filter((m) => !m.uebernommen).map((m) => String(m.id))])]
    for (const m of known) if (m.foto && byId.get(String(m.id)).photos?.[0]?.path && !photosDone.includes(String(m.id))) photosDone.push(String(m.id))
    const updates = statusUpdates(complaints())
    if (uebernommen.length || updates.length || photosDone.length) {
      await call('meldung-status', { body: { uebernommen, updates, fotosLoeschen: photosDone } })
      if (updates.length) {
        const sent = new Set(updates.map((u) => u.id))
        app.data.reklamationen.items = complaints().map((c) => (sent.has(c.portal?.id) ? markSent(c) : c))
        persist()
      }
    }
    sync.error = ''
    if (taken.length) {
      invalidateTodo()
      refreshBell()
      toast(taken.length === 1 ? `Neue Reklamation aus dem Kundenbereich: ${objOf(taken[0].objectId)?.name || 'Objekt'} (${taken[0].kind}).` : `${taken.length} neue Reklamationen aus dem Kundenbereich unter „Reklamationen“.`)
      if (['reklamationen', 'kundenbereich'].includes(app.ui.view)) renderNow()
      else if (app.ui.modal?.type === 'todo') renderModal()
    }
  } catch (err) {
    sync.error = err.message || String(err)
    taken = []
  }
  sync.running = false
  return taken.length
}

// ---------------------------------------------------------------- Angebote: Annahmen vom Webspace

const acc = { at: 0, running: false, error: '' }
const pendingOffers = () => offers().filter((o) => !o.acceptedAt && ((!o.revokedAt && String(o.validUntil || '') >= addDays(todayISO(), -1)) || (o.revokedAt && !o.removedAt)))

/**
 * Online angenommene Angebote übernehmen (doc.acceptance, Stand „angenommen“), am Webspace als übernommen
 * markieren, zurückgezogene Links dort nachträglich entfernen. Wie syncReports höchstens alle 3 Minuten und nur,
 * solange ein Link auf Antwort wartet; force: sofort. Liefert die Zahl der neuen Annahmen.
 */
export async function syncAcceptances({ force = false } = {}) {
  const s = settings()
  if (!s.enabled || !s.key || acc.running || !editsInvoices() || !pendingOffers().length || (!force && Date.now() - acc.at < 180e3)) return 0
  acc.running = true
  acc.at = Date.now()
  let taken = []
  try {
    const { annahmen = [] } = await call('annahmen')
    const docs = app.data.fakturierung.documents || []
    const now = new Date().toISOString()
    for (const { doc: x, entry } of newAcceptances(annahmen, docs)) {
      x.acceptance = acceptanceOf(entry, x, { now })
      if (x.status !== 'angenommen') x.status = 'angenommen'
      x.history = [...(x.history || []), { at: now, by: 'Kundenbereich', text: `online angenommen von ${x.acceptance.name}${x.acceptance.role ? ` (${x.acceptance.role})` : ''}` }]
      taken.push(x)
    }
    if (taken.length) {
      persist()
      // erst gespeichert, dann am Webspace als übernommen markieren (sonst ginge eine Annahme verloren)
      await app.service?.flush?.()
    }
    const byOnline = new Map(docs.filter((d) => d.online?.id).map((d) => [d.online.id, d]))
    const accepted = annahmen.filter((a) => byOnline.get(a.id)?.acceptance)
    const mark = accepted.filter((a) => !a.annahme?.uebernommen).map((a) => a.id)
    if (mark.length) await call('annahme-status', { body: { uebernommen: mark } })
    // erst danach gilt der Link als erledigt (sonst beim nächsten Abruf noch einmal markieren)
    const done = offers().filter((o) => !o.acceptedAt && accepted.some((a) => a.id === o.id))
    for (const o of done) o.acceptedAt = byOnline.get(o.id).acceptance.at
    if (done.length) persist()
    // zurückgezogen, aber am Webspace noch nicht entfernt (z. B. ohne Netz)
    const remove = offers().filter((o) => o.revokedAt && !o.removedAt).map((o) => o.id)
    if (remove.length) {
      const r = await call('angebot-entfernen', { body: { ids: remove } })
      for (const o of offers()) if (remove.includes(o.id) && !(r.behalten || []).includes(o.id)) o.removedAt = now
      persist()
    }
    acc.error = ''
    if (taken.length) {
      invalidateTodo()
      refreshBell()
      toast(taken.length === 1 ? `Angebot ${taken[0].number} wurde online angenommen (${taken[0].acceptance.name}). Unter „Zu erledigen“: Auftragsbestätigung erstellen.` : `${taken.length} Angebote wurden online angenommen. Unter „Zu erledigen“: Auftragsbestätigungen erstellen.`)
      if (app.ui.view === 'fakturierung') renderNow()
      else if (['todo', 'fak-doc', 'ang-share'].includes(app.ui.modal?.type)) renderModal()
    }
  } catch (err) {
    acc.error = err.message || String(err)
    taken = []
  }
  acc.running = false
  return taken.length
}

/** Einmal am Tag (geteilt über SharePoint) alle Links übertragen: neue Monate, Termine. */
async function dailyPublish() {
  const s = settings()
  if (!s.enabled || !s.key || !editable() || !seesPlan() || pub.running || !links().some(isActive)) return
  if (s.publishedAt && Date.now() - Date.parse(s.publishedAt) < 20 * 3600e3) return
  if (Date.now() - pub.at < 3600e3) return // nach einem Fehler nicht gleich wieder
  try {
    await publish()
  } catch {
    /* steht in der Ansicht */
  }
}

function startPolling() {
  if (sync.timer || typeof window === 'undefined') return
  sync.timer = setInterval(() => {
    syncReports()
    syncAcceptances()
    dailyPublish()
  }, 180e3)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    syncReports()
    syncAcceptances()
  })
  setTimeout(dailyPublish, 30e3) // nach dem Start, wenn die App geladen ist
}

registerTodo({
  id: 'kundenbereich',
  module: 'reklamationen',
  title: 'Neue Reklamationen aus dem Kundenbereich',
  compute: () => {
    if (settings().enabled) {
      startPolling()
      syncReports()
    }
    return complaints().filter((c) => c.portal && c.status === 'offen' && !c.measure)
  },
  render: (list) =>
    list
      .map((c) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(objOf(c.objectId)?.name || 'Objekt')}</strong>: ${esc(c.kind)}<br><span class="muted">${esc(c.text.slice(0, 120))}${c.contact ? ` · ${esc(c.contact)}` : ''}</span></div><button class="btn small primary" data-action="complaint-open" data-id="${esc(c.id)}">Öffnen</button></div>`)
      .join(''),
})

// Online angenommene Angebote: Auftragsbestätigung erstellen (für alle, die die Fakturierung bearbeiten)
registerTodo({
  id: 'kundenbereich-angebote',
  module: 'fakturierung',
  title: 'Angebote online angenommen',
  compute: () => {
    if (settings().enabled && offers().length) {
      startPolling()
      syncAcceptances()
    }
    return acceptedOpen(app.data.fakturierung?.documents || [])
  },
  render: (list) =>
    list
      .map((x) => `<div class="todo-item"><span class="flag">!</span><div class="todo-text"><strong>Angebot ${esc(x.number)} online angenommen</strong>: ${esc(x.recipient?.name || '')}<br><span class="muted">${esc(when(x.acceptance.at))}, ${esc(x.acceptance.name)}${x.acceptance.role ? ` (${esc(x.acceptance.role)})` : ''}</span></div><div class="todo-acts"><button class="btn small primary" data-action="fak-convert" data-id="${esc(x.id)}" data-kind="auftrag">Auftragsbestätigung erstellen</button> <button class="btn small ghost" data-action="fak-open" data-id="${esc(x.id)}">Ansehen</button></div></div>`)
      .join(''),
})

// ---------------------------------------------------------------- Ansicht

function showText(link) {
  const show = showOf(link)
  return [show.nachweise && 'Nachweise', show.winter && 'Winterdienst', show.leistungen && 'Leistungen', show.termine && 'Termine', show.rechnungen && 'Rechnungen', show.reklamation && 'Reklamation'].filter(Boolean).join(', ') || 'nichts'
}

function linkRow(link) {
  const st = linkState(link)
  const objects = (link.objectIds || []).map((id) => objOf(id)?.name || 'Objekt (gelöscht)')
  const cls = { aktiv: 'ok', neu: 'info', fehler: 'error', gesperrt: '' }[st.key]
  const open = complaints().filter((c) => c.portal?.link === link.id && c.status !== 'erledigt').length
  const items = link.revokedAt
    ? [{ label: 'Wieder freigeben (neuer Link)', icon: ICON.refresh, action: 'kb-renew', data: { id: link.id } }, { label: 'Löschen', icon: ICON.trash, action: 'kb-delete', data: { id: link.id } }]
    : [
        { label: 'Bearbeiten', icon: ICON.gear, action: 'kb-edit', data: { id: link.id } },
        { label: 'Kundenseite ansehen', icon: ICON.right, action: 'kb-open', data: { id: link.id } },
        '-',
        { label: 'Neuer Link (alter gilt nicht mehr)', icon: ICON.refresh, action: 'kb-renew', data: { id: link.id } },
        { label: 'Sperren', icon: ICON.lock, action: 'kb-revoke', data: { id: link.id } },
      ]
  return `<tr><td><strong>${esc(link.title || 'ohne Bezeichnung')}</strong><br><span class="muted">${esc(objects.join(', ') || 'keine Objekte')}</span></td>
    <td>${esc(showText(link))}${link.show?.reklamation !== false && open ? `<br><span class="pill warning">${plural(open, 'Reklamation', 'Reklamationen')} offen</span>` : ''}</td>
    <td><span class="pill ${cls}">${esc(st.label)}</span>${link.publishedAt && !link.revokedAt ? `<br><span class="muted">${esc(when(link.publishedAt))}</span>` : ''}${link.error && !link.revokedAt ? `<br><span class="err-text">${esc(link.error)}</span>` : ''}${link.revokedAt ? `<br><span class="muted">seit ${esc(formatDate(link.revokedAt.slice(0, 10)))}</span>` : ''}</td>
    <td class="actions-cell">${link.revokedAt ? '' : `<button class="btn small" data-action="kb-copy" data-id="${esc(link.id)}">${ICON.copy} Link</button> <button class="btn small" data-action="kb-mail" data-id="${esc(link.id)}">${ICON.send} E-Mail</button> `}${rowMenu(items, `Link ${link.title || ''}`)}</td></tr>`
}

function portalView() {
  const s = settings()
  const ed = editable()
  const active = links().filter((l) => !l.revokedAt)
  const revoked = links().filter((l) => l.revokedAt)
  const fromPortal = complaints().filter((c) => c.portal)
  const openCount = fromPortal.filter((c) => c.status !== 'erledigt').length
  const head = (rows) => `<div class="table-wrap"><table class="data kb-table"><thead><tr><th>Kunde / Objekt</th><th>Zeigt</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const banners = [
    !s.enabled ? `<div class="banner"><p><strong>Der Kundenbereich ist aus.</strong> In den Einstellungen einschalten und einmal mit dem Webspace verbinden; danach Links anlegen und den Kunden schicken.</p>${ed ? `<button class="btn primary" data-action="kb-settings">${ICON.gear} Einstellungen</button>` : ''}</div>` : '',
    pub.error ? `<div class="banner warn-banner"><p>Übertragen an den Webspace: ${esc(pub.error)}</p></div>` : '',
    sync.error && s.enabled ? `<div class="banner warn-banner"><p>Reklamationen aus dem Kundenbereich konnten nicht geholt werden: ${esc(sync.error)}</p></div>` : '',
    pub.held.length ? `<div class="banner warn-banner"><p><strong>Zurückgehalten:</strong> ${pub.held.map((h) => `${esc(h.object)} ${esc(monthName(h.month))} (${plural(h.open, 'Einsatz', 'Einsätze')} ohne Besetzung)`).join(', ')}. Erst im Leistungsnachweis klären (nachtragen oder absagen), dann erscheint der Nachweis beim Kunden.</p></div>` : '',
    !seesPlan() && s.enabled ? '<p class="note">Deine Rolle sieht den Plan nicht: Nachweise und Termine überträgt jemand mit Einsatzplanung (einmal am Tag automatisch).</p>' : '',
  ].join('')
  return `<div class="section-head"><div><h2>Kundenbereich</h2><p>Persönliche Links für Kunden, ohne Anmeldung: Leistungsnachweise und Winterdienst-Nachweis als PDF, die nächsten Termine im Objekt, Reklamation melden mit Stand, auf Wunsch Rechnungen und offene Posten. Du legst fest, was jeder Link zeigt.</p></div>
      <div class="actions">${ed && s.enabled ? `<button class="btn" data-action="kb-settings">${ICON.gear} Einstellungen</button>${s.enabled ? `<button class="btn" data-action="kb-publish" ${pub.running ? 'disabled' : ''}>${ICON.refresh} ${pub.running ? 'Überträgt …' : 'Jetzt übertragen'}</button><button class="btn primary" data-action="kb-new">${ICON.plus} Link anlegen</button>${rowMenu([{ label: 'Alle Nachweise neu erstellen', icon: ICON.refresh, action: 'kb-publish', data: { force: '1' } }, { label: 'Reklamationen jetzt abholen', icon: ICON.download, action: 'kb-sync' }], 'Weitere Aktionen')}` : ''}` : ''}</div></div>
    ${banners}
    <div class="impact-stats tc-stats">${tile('Links aktiv', active.length)}${tile('Reklamationen offen', openCount, openCount ? 'warn' : '')}${tile('Über den Kundenbereich', fromPortal.length)}${tile('Zuletzt übertragen', s.publishedAt ? esc(formatDate(s.publishedAt.slice(0, 10))) : '–')}</div>
    ${active.length ? head(active.map(linkRow).join('')) : `<p class="empty">Noch keine Links.${ed && s.enabled ? ' Mit „Link anlegen“ für einen Kunden oder ein Objekt beginnen.' : ''}</p>`}
    ${revoked.length ? `<h3>Gesperrte Links</h3>${head(revoked.map(linkRow).join(''))}` : ''}
    <p class="note">Der Link wirkt wie ein Passwort: Wer ihn hat, sieht die Seite. Im Link steht nur ein Code, nichts über den Kunden. Namen von Mitarbeitenden stehen in den Nachweisen nur, wenn das im Leistungsnachweis so eingestellt ist (jetzt: ${esc({ keine: 'keine Namen', vorname: 'Vornamen', voll: 'ganze Namen' }[proofSettings().names] || 'keine Namen')}). Reklamationen kommen unter „Reklamationen“ mit Eingang „Kundenbereich“ an; Status und Ergebnis sieht der Kunde.</p>`
}

registerView({
  id: 'kundenbereich',
  order: 74,
  label: 'Kundenbereich',
  group: 'service',
  section: 'objekte',
  module: 'reklamationen',
  icon: ICON_LINK,
  noWeek: true,
  available: mayManage,
  text: 'Links für Kunden: Nachweise, Termine, Reklamationen',
  badge: () => complaints().filter((c) => c.portal && c.status === 'offen' && !c.measure).length,
  render: portalView,
})

// ---------------------------------------------------------------- Link anlegen und bearbeiten

function linkDraft() {
  const m = app.ui.modal
  if (!m.draft) {
    const existing = m.id ? linkOf(m.id) : null
    m.draft = existing ? structuredClone({ ...existing, cache: undefined }) : { id: '', title: '', objectIds: [], show: showDefaults(), months: 12, email: '' }
    m.draft.invoices = invoiceSettings(m.draft)
  }
  return m.draft
}

function readLink() {
  const d = linkDraft()
  if (!document.getElementById('kb-title')) return d
  d.title = val('kb-title').trim()
  d.email = val('kb-email').trim()
  d.months = Number(val('kb-months')) || 12
  d.objectIds = [...document.querySelectorAll('input[name="kb-obj"]:checked')].map((x) => x.value)
  // nur, was im Dialog steht: Wer die Fakturierung nicht sieht, ändert die Rechnungen nicht
  d.show = { ...showDefaults(), ...(d.show || {}), ...Object.fromEntries(Object.keys(SHOW).filter((k) => document.getElementById(`kb-show-${k}`)).map((k) => [k, checked(`kb-show-${k}`)])) }
  if (document.getElementById('kbr-months')) d.invoices = { ...invoiceSettings(d), customerIds: checkedValues('kbr-cust'), months: Number(val('kbr-months')) || invoiceSettings(d).months }
  return d
}

/** Abschnitt „Rechnungen“ im Link-Dialog (nur, wer die Fakturierung sieht). */
function invoiceSection(d) {
  if (!seesInvoices()) return ''
  const inv = invoiceSettings(d)
  const on = d.show?.rechnungen === true
  const head = `<h3>Rechnungen</h3><label class="check"><input type="checkbox" id="kb-show-rechnungen" data-change="kbr-toggle" ${on ? 'checked' : ''}><span><strong>${esc(SHOW.rechnungen)}</strong>: festgeschriebene Rechnungen, Storno- und Korrekturbelege als PDF, offene mit Bankverbindung und QR-Code zum Bezahlen</span></label>`
  if (!on) return head
  const all = fakCustomers()
  const byId = new Map(all.map((c) => [c.id, c]))
  const suggested = suggestCustomers(all, d.objectIds)
  const list = [...new Set([...inv.customerIds, ...suggested.map((c) => c.id)])].map((id) => byId.get(id)).filter(Boolean)
  const others = all.filter((c) => !list.includes(c)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'))
  return `${head}
    <p class="muted">Belege dieser Kunden aus der Fakturierung${suggested.length ? ' (passend zu den Objekten vorgeschlagen)' : ''}:</p>
    ${list.length ? `<div class="check-grid kbr-customers">${list.map((c) => `<label class="check"><input type="checkbox" name="kbr-cust" value="${esc(c.id)}" ${inv.customerIds.includes(c.id) ? 'checked' : ''}><span>${esc(c.name)}${c.customerNo ? ` <span class="muted">${esc(c.customerNo)}</span>` : ''}${suggested.includes(c) ? ' <span class="pill info">passt zu den Objekten</span>' : ''}</span></label>`).join('')}</div>` : '<p class="empty">Kein Kunde der Fakturierung hat eines der gewählten Objekte. Bitte unten einen Kunden wählen.</p>'}
    <div class="form-grid">
      <label class="field"><span>Weiteren Kunden dazunehmen</span><select id="kbr-add" data-change="kbr-add">${options(others.map((c) => [c.id, c.name]), '', { empty: '– Kunde wählen –' })}</select></label>
      <label class="field"><span>Rechnungen der letzten</span><select id="kbr-months">${options(INVOICE_MONTH_CHOICES.map((n) => [String(n), `${n} Monate`]), String(inv.months))}</select></label>
    </div>
    <p class="note">Dazu immer alle noch offenen Rechnungen. Nur Belege der gewählten Kunden; Entwürfe, Angebote und Lieferscheine nie. Zahlungen sieht der Kunde nach dem nächsten Übertragen (einmal am Tag von selbst).</p>`
}

function linkModal() {
  const d = linkDraft()
  const customers = (app.data.fakturierung?.customers || []).filter((c) => c.objectIds?.length).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const objects = [...app.data.objects].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const winterObjects = d.objectIds.filter((id) => objOf(id)?.winter?.active).length
  return modalFrame({
    title: d.id ? `Link bearbeiten: ${d.title || 'ohne Bezeichnung'}` : 'Link für einen Kunden anlegen',
    wide: true,
    body: `<div class="form-grid">
        ${!d.id && customers.length ? `<label class="field wide"><span>Aus der Kundenliste übernehmen (optional)</span><select id="kb-customer" data-change="kb-customer">${options(customers.map((c) => [c.id, c.name]), '', { empty: '– Kunde wählen –' })}</select></label>` : ''}
        <label class="field wide"><span>Bezeichnung (sieht der Kunde als Überschrift)</span><input type="text" id="kb-title" maxlength="120" value="${esc(d.title)}" placeholder="z. B. Hausverwaltung Muster oder Wohnanlage Lehen"></label>
        <label class="field"><span>E-Mail des Kunden (für den Link)</span><input type="email" id="kb-email" value="${esc(d.email || '')}" placeholder="z. B. hausverwaltung@beispiel.at"></label>
        <label class="field"><span>Nachweise der letzten</span><select id="kb-months">${options(MONTH_CHOICES.map((n) => [String(n), `${n} Monate`]), String(d.months || 12))}</select></label>
      </div>
      <h3>Objekte <span class="muted" id="kb-count">${d.objectIds.length} gewählt</span></h3>
      <input type="search" id="kb-filter" data-input="kb-filter" placeholder="Objekt suchen" aria-label="Objekte filtern" class="kb-search">
      <div class="check-grid kb-objects">${objects.map((o) => `<label class="check kb-obj" data-name="${esc(`${o.name} ${o.address || ''}`.toLowerCase())}"><input type="checkbox" name="kb-obj" value="${esc(o.id)}" data-change="kb-count" ${d.objectIds.includes(o.id) ? 'checked' : ''}><span>${esc(o.name)}${o.address ? ` <span class="muted">${esc(o.address)}</span>` : ''}</span></label>`).join('')}</div>
      <h3>Was der Link zeigt</h3>
      ${Object.entries(SHOW)
        .filter(([k]) => !SHOW_OFF.includes(k))
        .map(([k, label]) => `<label class="check"><input type="checkbox" id="kb-show-${k}" ${d.show?.[k] !== false ? 'checked' : ''}><span>${esc(label)}${k === 'winter' && d.objectIds.length && !winterObjects ? ' <span class="muted">(keines der Objekte hat Winterdienst)</span>' : ''}</span></label>`)
        .join('')}
      ${invoiceSection(d)}
      <p class="note">Nur Daten der gewählten Objekte. Keine Namen von Mitarbeitenden, außer der Leistungsnachweis ist so eingestellt. Der Nachweis eines Monats erscheint ab dem ${esc(settings().releaseDay)}. des Folgemonats und nur, wenn alle Einsätze besetzt sind.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="kb-save">Speichern</button><button class="btn primary" data-action="kb-save" data-send="1">${ICON.send} Speichern und übertragen</button></div>`,
  })
}
registerModal('kb-link', linkModal, { module: MODULES })

// ---------------------------------------------------------------- Einstellungen

function settingsDraft() {
  const m = app.ui.modal
  if (!m.draft) {
    const s = settings()
    const sender = app.data.fakturierung?.settings?.sender || {}
    m.draft = { ...s, enabled: s.enabled || !s.key, key: s.key || hex(32), phone: s.phone || sender.phone || '', email: s.email || sender.email || '' }
  }
  return m.draft
}

function readSettings() {
  const d = settingsDraft()
  if (!document.getElementById('kb-enabled')) return d
  d.enabled = checked('kb-enabled')
  d.officeEmails = val('kb-emails').trim()
  d.sender = val('kb-sender').trim()
  d.phone = val('kb-phone').trim()
  d.email = val('kb-mail').trim()
  d.privacyUrl = val('kb-privacy').trim()
  d.releaseDay = Math.max(1, Math.min(28, Number(val('kb-release')) || 5))
  if (checked('kb-office')) d.officeTopic ||= portalSettings().officeTopic || app.data.rules?.weather?.alarm?.topics?.office || `kb-${hex(8)}`
  else d.officeTopic = ''
  return d
}

function settingsModal() {
  const d = settingsDraft()
  return modalFrame({
    title: 'Kundenbereich: Einstellungen',
    wide: true,
    body: `<label class="check"><input type="checkbox" id="kb-enabled" ${d.enabled ? 'checked' : ''}><span><strong>Kundenbereich ein</strong>: Kunden öffnen ihren persönlichen Link ohne Anmeldung (kunden.php am Webspace).</span></label>
      <h3>Neue Reklamationen ans Büro</h3>
      <label class="check"><input type="checkbox" id="kb-office" ${d.officeTopic ? 'checked' : ''}><span>Büro-Handy bekommt einen Push (nur Objekt und Art, ohne Text)${d.officeTopic ? `: Thema <code>${esc(d.officeTopic)}</code>` : ''}</span></label>
      <div class="form-grid">
        <label class="field wide"><span>Zusätzlich per E-Mail an (mit Text und Kontakt)</span><input type="text" id="kb-emails" value="${esc(d.officeEmails || '')}" placeholder="z. B. office@…, mehrere mit Komma"></label>
        <label class="field"><span>Absender der E-Mails</span><input type="email" id="kb-sender" value="${esc(d.sender || '')}" placeholder="z. B. kundenservice@…"></label>
      </div>
      <h3>Auf der Kundenseite</h3>
      <div class="form-grid">
        <label class="field"><span>Telefon für Fragen</span><input type="tel" id="kb-phone" value="${esc(d.phone || '')}"></label>
        <label class="field"><span>E-Mail für Fragen</span><input type="email" id="kb-mail" value="${esc(d.email || '')}"></label>
        <label class="field wide"><span>Datenschutzerklärung (Adresse, beginnt mit https://)</span><input type="url" id="kb-privacy" value="${esc(d.privacyUrl || '')}" placeholder="https://www.cleanos.at/datenschutz"></label>
        <label class="field"><span>Nachweis erscheint ab dem … des Folgemonats</span><input type="number" id="kb-release" min="1" max="28" value="${esc(d.releaseDay || 5)}"></label>
      </div>
      <h3>Webspace</h3>
      <p class="note">„Speichern und übertragen“ richtet den Webspace direkt ein, wenn dort schon „Plan am Handy“ oder der Schnee-Alarm läuft. Sonst <strong>einmalig</strong> „Einrichtungs-Datei herunterladen“ und <code>kundenbereich.json</code> per FTP in den Ordner <code>privat/</code> der App laden. Am Webspace liegen je Link nur Hashwert, Bezeichnung, Objekte, Termine und PDFs; die Links selbst nicht.</p>`,
    foot: `<button class="btn" data-action="kb-download">${ICON.download} Einrichtungs-Datei herunterladen</button>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn" data-action="kb-settings-save">Speichern</button><button class="btn primary" data-action="kb-settings-save" data-send="1">Speichern und übertragen</button></div>`,
  })
}
registerModal('kb-settings', settingsModal, { module: MODULES })

function saveSettings(d) {
  const { draft, ...rest } = d
  doc().settings = { ...doc().settings, ...rest }
  persist()
}

// ---------------------------------------------------------------- Aktionen

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Link kopiert.')
  } catch {
    toast(text)
  }
}

async function sendNow(ids, done) {
  try {
    const r = await publish({ ids })
    toast(`${done}${r ? ` ${publishNote(r)}` : ''}`)
  } catch (err) {
    toast(`${done} Noch nicht übertragen: ${err.message}`)
  }
}

registerActions(
  {
    'kb-settings': () => openModal({ type: 'kb-settings' }),
    'kb-download': () => {
      const d = readSettings()
      saveSettings(d)
      download('kundenbereich.json', new Blob([`${JSON.stringify(settingsFile(settings()), null, 2)}\n`], { type: 'application/json' }))
      toast('Gespeichert und heruntergeladen: kundenbereich.json per FTP in den Ordner privat/ der App laden.')
    },
    'kb-settings-save': async (el) => {
      const d = readSettings()
      if (d.privacyUrl && !/^https:\/\/\S+$/.test(d.privacyUrl)) return toast('Die Adresse der Datenschutzerklärung muss mit https:// beginnen.')
      saveSettings(d)
      closeModal()
      renderNow()
      if (!el.dataset.send) return toast('Gespeichert. Für den Webspace „Speichern und übertragen“ oder die Einrichtungs-Datei hochladen.')
      if (!d.enabled) return toast('Kundenbereich ausgeschaltet. Die Links zeigen weiter den letzten Stand, bis du sie sperrst.')
      try {
        await setup()
        const r = links().some(isActive) || links().some((l) => l.revokedAt && !l.removedAt) ? await publish() : null
        toast(`Webspace eingerichtet.${r ? ` ${publishNote(r)}` : ''}`)
        syncReports({ force: true })
      } catch (err) {
        toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
      }
    },
    'kb-new': () => openModal({ type: 'kb-link' }),
    'kb-edit': (el) => openModal({ type: 'kb-link', id: el.dataset.id }),
    'kb-customer': () => {
      const d = readLink()
      const c = (app.data.fakturierung?.customers || []).find((x) => x.id === val('kb-customer'))
      if (!c) return
      d.title = c.name
      d.objectIds = [...new Set([...(c.objectIds || []).filter((id) => objOf(id))])]
      d.email ||= c.email || ''
      d.invoices = { ...invoiceSettings(d), customerIds: [c.id] }
      renderModal()
    },
    'kbr-toggle': () => {
      const d = readLink()
      // beim Einschalten die Kunden vorschlagen, deren Objekte der Link zeigt
      if (d.show.rechnungen && !invoiceSettings(d).customerIds.length) d.invoices = { ...invoiceSettings(d), customerIds: suggestCustomers(fakCustomers(), d.objectIds).map((c) => c.id) }
      renderModal()
    },
    'kbr-add': () => {
      const d = readLink()
      const id = val('kbr-add')
      if (id) d.invoices = { ...invoiceSettings(d), customerIds: [...new Set([...invoiceSettings(d).customerIds, id])] }
      renderModal()
    },
    'kb-count': () => {
      const el = document.getElementById('kb-count')
      if (el) el.textContent = `${document.querySelectorAll('input[name="kb-obj"]:checked').length} gewählt`
    },
    'kb-sync': async () => {
      if (editsInvoices()) syncAcceptances({ force: true })
      const n = await syncReports({ force: true })
      toast(sync.error ? `Nicht abgeholt: ${sync.error}` : n ? `${plural(n, 'neue Reklamation', 'neue Reklamationen')} übernommen.` : 'Keine neuen Reklamationen aus dem Kundenbereich.')
      renderNow()
    },
    'kb-filter': () => {
      const q = val('kb-filter').trim().toLowerCase()
      for (const el of document.querySelectorAll('.kb-obj')) el.hidden = !!q && !el.dataset.name.includes(q)
    },
    'kb-save': async (el) => {
      const d = readLink()
      if (!d.title) return toast('Bitte eine Bezeichnung eingeben (z. B. Name des Kunden).')
      if (!d.objectIds.length) return toast('Bitte mindestens ein Objekt wählen.')
      if (d.email && !emailOk(d.email)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
      if (d.show.rechnungen && !invoiceSettings(d).customerIds.length) return toast('Bitte für die Rechnungen mindestens einen Kunden der Fakturierung wählen.')
      const invoices = invoiceSettings(d)
      let link = d.id ? linkOf(d.id) : null
      if (link) Object.assign(link, { title: d.title, objectIds: d.objectIds, show: d.show, months: d.months, invoices, email: d.email, changedAt: new Date().toISOString(), changedBy: by() })
      else {
        link = { id: newLinkId(), title: d.title, objectIds: d.objectIds, show: d.show, months: d.months, invoices, email: d.email, token: newCode(), createdAt: new Date().toISOString(), createdBy: by() }
        links().push(link)
      }
      persist()
      closeModal()
      renderNow()
      const what = d.id ? 'Gespeichert.' : 'Link angelegt.'
      if (!el.dataset.send) return toast(`${what} Mit „Jetzt übertragen“ geht er an den Webspace.`)
      if (!settings().enabled) return toast(`${what} Der Kundenbereich ist noch aus (Einstellungen).`)
      el.disabled = true
      toast('Überträgt …')
      await sendNow([link.id], what)
    },
    'kb-copy': (el) => {
      const link = linkOf(el.dataset.id)
      if (link && isActive(link)) copyText(urlOf(link))
    },
    'kb-open': (el) => {
      const link = linkOf(el.dataset.id)
      if (link && isActive(link)) window.open(urlOf(link), '_blank', 'noopener')
    },
    'kb-mail': (el) => {
      const link = linkOf(el.dataset.id)
      if (!link || !isActive(link)) return
      const s = settings()
      const mail = linkMail({ link, url: urlOf(link), company: brand().name || '', sender: app.user?.name || '', phone: s.phone })
      if (!link.publishedAt) toast('Hinweis: Der Link ist noch nicht übertragen. Vor dem Senden „Jetzt übertragen“.')
      openCompose({ to: link.email || objOf(link.objectIds?.[0])?.proofEmail || '', subject: mail.subject, text: mail.text, origin: `Kundenbereich: ${link.title}` })
    },
    'kb-renew': async (el) => {
      const link = linkOf(el.dataset.id)
      if (!link) return
      if (!confirmStep(`kb-renew-${link.id}`)) return toast(`Neuer Link für „${link.title}“: Der bisherige gilt danach nicht mehr. Zum Bestätigen noch einmal klicken.`)
      Object.assign(link, { token: newCode(), revokedAt: null, removedAt: null, renewedAt: new Date().toISOString(), renewedBy: by(), error: '' })
      persist()
      renderNow()
      await sendNow([link.id], 'Neuer Link erstellt: bitte dem Kunden schicken.')
    },
    'kb-revoke': async (el) => {
      const link = linkOf(el.dataset.id)
      if (!link) return
      if (!confirmStep(`kb-revoke-${link.id}`)) return toast(`„${link.title}“ sperren? Der Kunde kann die Seite dann nicht mehr öffnen. Zum Bestätigen noch einmal klicken.`)
      Object.assign(link, { revokedAt: new Date().toISOString(), revokedBy: by(), removedAt: null, error: '' })
      persist()
      renderNow()
      try {
        await call('speichern', { body: { links: [], entfernen: [link.id] } })
        link.removedAt = new Date().toISOString()
        persist()
        renderNow()
        toast(`Gesperrt: Der Link für „${link.title}“ gilt nicht mehr, die Daten am Webspace sind gelöscht.`)
      } catch (err) {
        toast(`Gesperrt, aber am Webspace noch nicht gelöscht (${err.message}). Wird beim nächsten Übertragen nachgeholt.`)
      }
    },
    'kb-delete': (el) => {
      const link = linkOf(el.dataset.id)
      if (!link?.revokedAt) return
      if (!confirmStep(`kb-delete-${link.id}`)) return toast('Gesperrten Link endgültig löschen? Zum Bestätigen noch einmal klicken.')
      doc().links = links().filter((l) => l.id !== link.id)
      persist()
      renderNow()
      toast('Gelöscht.')
    },
    'kb-publish': async (el) => {
      el.disabled = true
      try {
        const r = await publish({ force: !!el.dataset.force })
        toast(r ? publishNote(r) : 'Der Kundenbereich ist aus.')
      } catch (err) {
        toast(`Nicht übertragen: ${err.message}`)
      }
      syncReports({ force: true })
    },
    // Foto einer Reklamation, das noch am Webspace liegt (ohne SharePoint), im Dialog anzeigen
    'kb-photo': async (el) => {
      const box = el.closest('[data-kb-photo]')
      try {
        const blob = await call('foto', { query: `&datei=${encodeURIComponent(el.dataset.file)}` })
        if (box) box.innerHTML = `<img class="kb-photo" alt="Foto vom Kunden" src="${URL.createObjectURL(blob)}">`
      } catch (err) {
        toast(`Foto nicht geladen: ${err.message}`)
      }
    },
  },
  { edit: MODULES },
)
