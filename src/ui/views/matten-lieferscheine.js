// Mattenwechsel-Modul, Lieferscheine im Büro (docs/MATTENWECHSEL-PLAN.md P12/P13): Ansicht „Matten-Lieferscheine“
// (mw-lieferscheine, wer den Mattenwechsel sieht; Fahrer nicht). Je abgeschlossenem Stopp ein Lieferschein als Beleg der
// Fakturierung (Nummernkreis LS, festgeschrieben, eingefrorene Preise, im PDF ohne Preise), PDF in SharePoint unter
// Mattenwechsel/Kunden/<Kundennummer>/<Jahr>/<Monat>/Lieferscheine/ (ohne Doppel, Wiederholung über die Warteschlange der
// Ablage), Versand an Kunde, Büro oder beide über das Senden-Fenster der App (mailer.js), Sammelversand mit Pause wie in
// den Läufen der Fakturierung. Kunden mit „automatisch senden“ bekommen ihn gleich nach dem Erstellen – immer durch die
// angemeldete Büro-Person, nie im Hintergrund ohne Sitzung.
// Erstellen und Senden: wer den Mattenwechsel und die Fakturierung bearbeitet (wie der Rechnungsentwurf beim
// Regiebericht); „Mattenwechsel Büro“ allein sieht den Stand aus der Kopie am Stopp. Rechenkern: core/matten-lieferschein.js.
// Aktionen und Dialoge mit dem Kürzel „mw-ls-“, Klassen „mwl-“.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { deDate, settingsOf as fakSettings } from '../../core/invoicing.js'
import { MAIL_PAUSE_MS } from '../../core/fak-laeufe.js'
import { placementsOf, STOP_STATUS, updateStop } from '../../core/matten-fahrt.js'
import {
  ARCHIVE_STATES,
  archiveState,
  autoSendFor,
  createNote,
  digitsMissing,
  LS_DIGITS,
  mailRecipients,
  MAIL_MODES,
  mailState,
  markArchived,
  markArchiveFailed,
  markArchiveQueued,
  markMailFailed,
  markSent,
  NOTE_FILTERS,
  noteFileName,
  noteMail,
  notePath,
  noteRights,
  noteRows,
  noteSummary,
  officeEmailOf,
  rowMatches,
  stateText,
  stopNeedsSync,
  stopNote,
  totalsText,
} from '../../core/matten-lieferschein.js'
import { emptyMatten, upgradeMatten } from '../../core/matten.js'
import { tourYears } from '../../core/matten-touren.js'
import { ACTIONS, app, canEdit, closeModal, memo, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { deliver, openCompose } from '../mailer.js'
import { onToursChanged, tourStore } from '../matten-tourablage.js'
import { canMail } from '../modals/send.js'
import { invalidateTodo, registerTodo } from '../modals/todo.js'
import { checked, download, esc, ICON, menu, modalFrame, options, rowMenu, uid, val } from '../shared.js'
import { laeufeHooks } from './invoicing-laeufe.js'

const MODULE = 'matten'
const VIEW = 'mw-lieferscheine'
const ICON_LS = '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 15h6M9 18h3"/>'
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const sees = (m) => !app.access || app.access.sees(m)
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const mdoc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const msettings = () => (mdoc().settings ||= {})
/** Fakturierung, wenn lesbar (sonst null: Stand aus der Kopie am Stopp). */
const F = () => (sees('fakturierung') ? app.data.fakturierung || null : null)
const fakDocs = () => F()?.documents || null
const docOf = (id) => (F()?.documents || []).find((d) => d.id === id) || null
const custOf = (id) => (F()?.customers || []).find((c) => c.id === id) || null
const rights = () => noteRights(app.access)
/** Lieferscheine erstellen und senden: Mattenwechsel und Fakturierung bearbeiten, Fakturierung geladen. */
const mayAct = () => rights().create && !app.readOnly && !!F()
const editable = () => canEdit(MODULE) && !app.readOnly
const sharepoint = () => app.store?.kind === 'sharepoint' && typeof app.store.uploadRoot === 'function'

// ---------------------------------------------------------------- Touren lesen (gemeinsame Ablage mit Planung und Fahrern)

/** Jahre der Touren: Vorjahr und dieses (Lieferscheine entstehen nach dem Abschluss). */
const yearsShown = (today = todayISO()) => tourYears(`${Number(today.slice(0, 4)) - 1}-01-01`, today)
const attempts = new Map()
/** Touren der Jahre gelesen? Fehlende bzw. ältere als maxAge im Hintergrund lesen (nach einem Fehler frühestens nach 15 s). */
function ensureTours(years = yearsShown(), maxAge = 60_000) {
  const s = tourStore()
  if (!s) return true
  const now = Date.now()
  const todo = years.filter((y) => !s.yearLoaded(y, maxAge) && !s.yearLoading(y) && now - (attempts.get(y) || 0) > 15_000)
  if (todo.length) {
    todo.forEach((y) => attempts.set(y, now))
    s.load({ years: todo }).catch((err) => app.ui.view === VIEW && toast(`Touren konnten nicht gelesen werden: ${err.message}`))
  }
  return years.every((y) => s.yearLoaded(y))
}

// Stand der Touren: zählt bei jeder Änderung der Ablage hoch (die Touren gehen nicht über den DataService, app.cur kennt sie nicht)
let toursVersion = 0
/** Alle Zeilen (abgeschlossene Stopps der gelesenen Touren). */
const allRows = () => memo(app.cur, `mwls:rows:${toursVersion}`, () => noteRows({ tours: tourStore()?.tours() || [], docs: fakDocs() }))

/** Zähler für „Zu erledigen“, den digitalen Mitarbeiter (app.mwLs, views/disponent.js) und die Seitenleiste. */
function publish(rows = allRows()) {
  const sum = noteSummary(rows)
  const open = rows.filter((r) => r.state === 'offen')
  app.mwLs = { ...sum, oldest: open.at(-1)?.date || '', at: Date.now() }
  return app.mwLs
}

// Touren geändert (gelesen, vom Fahrer abgeschlossen): Zähler und Ansicht neu, auf Wunsch automatisch erstellen
onToursChanged(() => {
  toursVersion++
  invalidateTodo()
  publish(noteRows({ tours: tourStore()?.tours() || [], docs: fakDocs() }))
  if (app.ui.view === VIEW && !app.ui.modal) renderNow()
  autoLater()
})

// ---------------------------------------------------------------- PDF, Ablage, Stopp

/** PDF wie in der Fakturierung (Briefpapier, Logo; ohne Preise, mit Unterschrift). */
async function pdfOf(doc) {
  if (!laeufeHooks.docPdf) throw new Error('Die Fakturierung ist noch nicht geladen.')
  return laeufeHooks.docPdf(doc)
}

function saveDoc(next) {
  const d = F()
  const i = d.documents.findIndex((x) => x.id === next.id)
  if (i >= 0) d.documents[i] = next
  persist()
  return next
}

/**
 * PDF in SharePoint ablegen (Mattenwechsel/Kunden/…): vorher nachsehen, ob die Datei schon dort liegt (dann nur vermerken,
 * kein Doppel); ohne Netz in die Warteschlange der Ablage (offline.js, nachgeholt), echter Fehler → „Ablage
 * fehlgeschlagen“. Der Lieferschein bleibt in jedem Fall gültig. Liefert 'ok' | 'offen' | 'fehler' | ''.
 */
async function archiveNote(id) {
  let doc = docOf(id)
  if (!doc?.number || !sharepoint()) return ''
  const path = notePath(doc)
  try {
    const have = await app.store.rootFile(path)
    if (have) {
      saveDoc(markArchived(doc, { ...have, path, at: nowIso(), existed: true }))
      return 'ok'
    }
    const blob = await pdfOf(doc)
    const res = await app.store.uploadRoot(path, blob, 'application/pdf')
    doc = docOf(id)
    saveDoc(res.queued ? markArchiveQueued(doc, { path, at: nowIso() }) : markArchived(doc, { itemId: res.itemId, webUrl: res.webUrl || '', path, at: nowIso(), existed: res.existed }))
    return res.queued ? 'offen' : 'ok'
  } catch (err) {
    saveDoc(markArchiveFailed(docOf(id), { error: err, at: nowIso() }))
    return 'fehler'
  }
}

let reconciled = 0
/** Ohne Netz in die Warteschlange gestellte PDFs: liegen sie inzwischen in SharePoint, als abgelegt vermerken. */
async function reconcileQueued() {
  if (!sharepoint() || !mayAct() || Date.now() - reconciled < 60_000) return
  reconciled = Date.now()
  for (const d of (fakDocs() || []).filter((x) => x.source?.type === 'matten' && x.integration?.ablage?.status === 'offen')) {
    const path = d.integration.ablage.path || notePath(d)
    const have = await app.store.rootFile(path).catch(() => undefined)
    if (have) saveDoc(markArchived(docOf(d.id), { ...have, path, at: nowIso(), existed: true }))
  }
}

const synced = new Set()
/**
 * Kopie am Stopp nachführen, wo der Beleg mehr weiß (z. B. in der Fakturierung gesendet, Nummer nach einem Doppel neu
 * vergeben, Vermerk am Stopp ohne Netz verloren): einmal je Stopp und Stand in dieser Sitzung, im Hintergrund.
 */
function syncStops(rows) {
  if (!mayAct() || busy) return
  const todo = rows.filter((r) => r.doc?.number && stopNeedsSync(r.stop, r.doc) && !synced.has(`${r.key}|${r.doc.number}|${(r.doc.sent || []).length > 0}`))
  if (!todo.length) return
  todo.forEach((r) => synced.add(`${r.key}|${r.doc.number}|${(r.doc.sent || []).length > 0}`))
  setTimeout(() => todo.forEach((r) => markStop(r.tour.id, r.stop.id, stopNote(r.doc, { at: nowIso(), by: user() }))), 0)
}

/** Kopie am Stopp nachführen (deliveryNote; für Rollen ohne Fakturierung). Fehler halten nichts auf. */
async function markStop(tourId, stopId, note) {
  const s = tourStore()
  if (!s) return
  const opts = { now: nowIso(), by: user(), force: true, keepStatus: true }
  try {
    await s.update(tourId, (t) => {
      const stop = (t.stops || []).find((x) => x.id === stopId)
      if (!stop || same({ ...stop.deliveryNote, at: '', by: '' }, { ...note, at: '', by: '' })) return t
      return updateStop(t, stopId, (x) => ({ ...x, deliveryNote: note }), opts)
    })
  } catch (err) {
    console.warn('Lieferschein am Stopp vermerken:', err)
  }
}

// ---------------------------------------------------------------- Erstellen

let busy = false
const tried = new Set()

/**
 * Lieferscheine zu den Stopps (Schlüssel matten:<tourId>:<stopId>) erstellen: erst den Stand der anderen holen (Touren und
 * Belege – Nummern, schon erstellte Lieferscheine), dann je Stopp createNote (idempotent), speichern, Stopp vermerken,
 * Stopps ohne Lieferschein vermerken („kein Lieferschein: Kunde nicht angetroffen“), PDF ablegen und – bei Kunden mit
 * „automatisch senden“ – gleich senden.
 */
async function createNotes(keys = null, { auto = false } = {}) {
  if (busy) return toast('Lieferscheine werden gerade erstellt …')
  if (!mayAct()) return toast(rights().hint || 'Lieferscheine erstellt, wer den Mattenwechsel und die Fakturierung bearbeitet.')
  busy = true
  const at = nowIso()
  const by = user()
  try {
    const s = tourStore()
    if (!auto) toast('Lieferscheine werden erstellt …')
    await s?.load({ years: yearsShown() }).catch(() => {})
    await app.service?.flush?.().catch(() => {})
    await app.service?.refresh?.().catch(() => [])
    const d = F()
    const rows = noteRows({ tours: s?.tours() || [], docs: d.documents })
    const todo = rows.filter((r) => r.state === 'offen' && (!keys || keys.includes(r.key))).sort((a, b) => String(a.stop.finishedAt).localeCompare(String(b.stop.finishedAt)))
    if (todo.length && digitsMissing(d.settings || {})) d.settings = { ...(d.settings || {}), numberDigits: { ...(d.settings?.numberDigits || {}), lieferschein: LS_DIGITS } }
    const created = []
    const failed = []
    const warnings = []
    for (const r of todo) {
      tried.add(r.key)
      try {
        const res = createNote({ tour: r.tour, stop: r.stop, data: d, id: uid('ls'), now: at, by })
        if (res.created) {
          const i = d.documents.findIndex((x) => x.id === res.doc.id)
          if (i >= 0) d.documents[i] = res.doc
          else d.documents.push(res.doc)
          created.push({ row: r, doc: res.doc })
          warnings.push(...res.warnings.map((w) => `${res.doc.number}: ${w}`))
        }
      } catch (err) {
        failed.push(`${r.customerName || 'Kunde'} (${day(r.date)}): ${err.message}`)
      }
    }
    if (created.length) {
      persist()
      await app.service?.flush?.().catch(() => {})
      laeufeHooks.checkNumbers?.()
    }
    // Kopie am Stopp: erstellte, schon vorhandene (anderer Platz) und „kein Lieferschein“
    for (const r of rows) {
      if (keys && !keys.includes(r.key) && r.state !== 'keiner') continue
      const doc = created.find((x) => x.row.key === r.key)?.doc || (r.doc?.number ? r.doc : null)
      if (doc && stopNeedsSync(r.stop, doc)) await markStop(r.tour.id, r.stop.id, stopNote(doc, { at, by }))
      else if (r.state === 'keiner' && r.stop.deliveryNote?.state !== 'keiner') await markStop(r.tour.id, r.stop.id, stopNote(null, { state: 'keiner', reason: r.need.reason, at, by }))
    }
    renderNow()
    for (const x of created) await archiveNote(x.doc.id)
    const autoDocs = created.filter((x) => autoSendFor(custOf(x.doc.customerId))).map((x) => x.doc.id)
    let autoSent = 0
    if (autoDocs.length && canMail()) autoSent = (await sendMany(autoDocs, 'kunde', { auto: true })).sent
    const parts = [created.length ? `${plural(created.length, 'Lieferschein', 'Lieferscheine')} erstellt (${created[0].doc.number}${created.length > 1 ? ` bis ${created.at(-1).doc.number}` : ''})` : 'Kein neuer Lieferschein', autoSent ? `${autoSent} automatisch gesendet` : '', autoDocs.length && !canMail() ? 'automatischer Versand nur mit Microsoft 365 – bitte von Hand senden' : '', failed.length ? `${failed.length} nicht erstellt: ${failed[0]}` : ''].filter(Boolean)
    if (!auto || created.length || failed.length) toast(`${parts.join(' · ')}.`)
    if (warnings.length) console.info('Lieferscheine:', warnings.join(' | '))
    app.ui.mwLsLast = { at, created: created.map((x) => x.doc.number), failed, warnings }
    return { created: created.length, failed: failed.length }
  } finally {
    busy = false
    invalidateTodo()
    renderNow()
  }
}

let autoTimer = null
/** Einstellung „automatisch erstellen“: beim Öffnen durch das Büro (Touren gelesen), einmal je Stopp und Sitzung. */
function autoLater() {
  if (!msettings().autoDeliveryNotes || !mayAct() || busy) return
  clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    const keys = allRows().filter((r) => r.state === 'offen' && !tried.has(r.key)).map((r) => r.key)
    if (keys.length) createNotes(keys, { auto: true }).catch((err) => toast(`Lieferscheine: ${err.message}`))
  }, 1500)
}

// ---------------------------------------------------------------- Senden

const missingText = (missing) => missing.map((k) => (k === 'kunde' ? 'Beim Kunden fehlt die E-Mail für Lieferscheine (Fakturierung → Kundenblatt → Mattenwechsel).' : 'Die Büro-Adresse fehlt („Mehr“ → „Einstellungen“).')).join(' ')

function mailFor(doc) {
  return noteMail({ doc, sender: user(), company: fakSettings(F() || {}).sender.name || app.config.brand?.name || '' })
}

/** Nach dem Senden: Beleg (sent, integration.mail) und Kopie am Stopp. */
function afterSent(id, { to, cc = [], via, mode, auto = false }) {
  const doc = docOf(id)
  if (!doc) return
  const next = saveDoc(markSent(doc, { to, cc, via, mode, by: user(), at: nowIso(), auto }))
  if (next.source?.tourId) markStop(next.source.tourId, next.source.stopId, stopNote(next, { at: nowIso(), by: user() }))
  invalidateTodo()
}

/** Senden-Fenster mit dem PDF (Vorschau, gesendet wird erst nach Klick). */
async function openSend(id, mode) {
  const doc = docOf(id)
  if (!doc?.number) return
  const r = mailRecipients({ doc, customer: custOf(doc.customerId), settings: msettings(), mode })
  if (r.missing.length) toast(missingText(r.missing))
  const m = mailFor(doc)
  let blob
  try {
    blob = await pdfOf(doc)
  } catch (err) {
    return toast(`PDF nicht erstellt: ${err.message}`)
  }
  openCompose({ to: r.to.join('; '), cc: r.cc.join('; '), subject: m.subject, text: m.text, files: [{ name: noteFileName(doc), blob, type: 'application/pdf' }], origin: `Lieferschein ${doc.number} (${MAIL_MODES[mode] || ''})`, onSent: ({ via, to, cc }) => afterSent(id, { to, cc, via, mode }) })
}

/**
 * Mehrere direkt senden (Microsoft 365): je Beleg eine E-Mail mit dem PDF, Pause zwischen zwei E-Mails wie in den Läufen
 * der Fakturierung; ohne Adresse oder bei Fehler vermerkt (integration.mail) und weiter. run: Fortschritt (Dialog).
 */
async function sendMany(ids, mode, { auto = false, run = null } = {}) {
  const out = { sent: 0, failed: 0, errors: [] }
  for (let i = 0; i < ids.length; i++) {
    if (run?.stop) break
    const doc = docOf(ids[i])
    if (!doc?.number) continue
    const r = mailRecipients({ doc, customer: custOf(doc.customerId), settings: msettings(), mode })
    try {
      if (!r.to.length) throw new Error(missingText(r.missing) || 'keine E-Mail-Adresse')
      const m = mailFor(doc)
      const via = await deliver({ to: r.to, cc: r.cc, subject: m.subject, text: m.text, attachments: [{ name: noteFileName(doc), blob: await pdfOf(doc), type: 'application/pdf' }] })
      afterSent(doc.id, { to: r.to, cc: r.cc, via, mode, auto })
      out.sent++
    } catch (err) {
      saveDoc(markMailFailed(docOf(doc.id), { to: r.to, error: err, by: user(), at: nowIso() }))
      out.failed++
      out.errors.push(`${doc.number}: ${err.message}`)
    }
    if (run) {
      Object.assign(run, { done: i + 1, sent: out.sent, failed: out.failed, errors: [...out.errors] })
      if (app.ui.modal?.type === 'mw-ls-run') renderModal()
    }
    if (i < ids.length - 1 && !run?.stop) await sleep(MAIL_PAUSE_MS)
  }
  return out
}

// ---------------------------------------------------------------- Ansicht

const filterOf = () => (NOTE_FILTERS[app.ui.mwLsFilter] ? app.ui.mwLsFilter : 'offen')
const RANGES = { 30: 'letzte 30 Tage', 90: 'letzte 90 Tage', alle: 'alle gelesenen' }
const rangeOf = () => (RANGES[app.ui.mwLsRange] ? app.ui.mwLsRange : '30')
const selected = () => (app.ui.mwLsSel ||= [])

const ARCH_PILL = { ok: 'ok', offen: 'info', fehler: 'error' }
function statePills(r) {
  if (r.state === 'keiner') return `<span class="pill na">${esc(stateText(r))}</span>`
  if (r.state === 'offen') return '<span class="pill warning">ohne Lieferschein</span>'
  const out = [`<span class="pill ${r.state === 'versendet' ? 'ok' : 'info'}">${r.state === 'versendet' ? 'versendet' : 'nicht versendet'}</span>`]
  if (r.mail === 'fehler') out.push('<span class="pill error">Versand fehlgeschlagen</span>')
  if (r.archive) out.push(`<span class="pill ${ARCH_PILL[r.archive]}">${esc(ARCHIVE_STATES[r.archive])}</span>`)
  return out.join(' ')
}

function rowActions(r, act) {
  const d = r.doc
  if (r.state === 'offen') return act ? `<button class="btn small primary" data-action="mw-ls-create" data-key="${esc(r.key)}">Lieferschein erstellen</button>` : ''
  if (!d?.number || !act) return ''
  const main = r.archive === 'fehler' ? `<button class="btn small primary" data-action="mw-ls-archive" data-id="${esc(d.id)}">Ablage erneut versuchen</button>` : r.state === 'erstellt' ? `<button class="btn small primary" data-action="mw-ls-send" data-id="${esc(d.id)}" data-mode="kunde">An Kunden</button>` : ''
  return `${main} ${rowMenu(
    [
      { label: 'Ansehen', action: 'mw-ls-open', data: { tour: r.tour.id, stop: r.stop.id } },
      { label: 'PDF herunterladen', icon: ICON.download, action: 'mw-ls-pdf', data: { id: d.id } },
      { label: r.state === 'versendet' ? 'Erneut an Kunden senden' : 'An Kunden', icon: ICON.send, action: 'mw-ls-send', data: { id: d.id, mode: 'kunde' } },
      { label: 'An Büro', icon: ICON.send, action: 'mw-ls-send', data: { id: d.id, mode: 'buero' } },
      { label: 'An beide', icon: ICON.send, action: 'mw-ls-send', data: { id: d.id, mode: 'beide' } },
      r.archive !== 'ok' && sharepoint() && { label: 'In SharePoint ablegen', icon: ICON.upload, action: 'mw-ls-archive', data: { id: d.id } },
    ],
    `Lieferschein ${d.number}: weitere Aktionen`,
  )}`
}

function lieferscheineView() {
  const today = todayISO()
  const ready = ensureTours(yearsShown(today))
  reconcileQueued().catch(() => {})
  syncStops(allRows())
  const s = tourStore()
  const rg = rights()
  const act = mayAct()
  const all = allRows()
  const sum = publish(all)
  const filter = filterOf()
  const range = rangeOf()
  const from = ['versendet', 'alle'].includes(filter) && range !== 'alle' ? addDays(today, -Number(range)) : ''
  const list = all.filter((r) => rowMatches(r, filter) && (!from || r.date >= from))
  const sel = selected().filter((k) => list.some((r) => r.key === k))
  const selOpen = list.filter((r) => sel.includes(r.key) && r.state === 'offen')
  const selDocs = list.filter((r) => sel.includes(r.key) && r.doc?.number)
  const createKeys = selOpen.length ? selOpen.map((r) => r.key) : all.filter((r) => r.state === 'offen').map((r) => r.key)
  const unsent = all.filter((r) => r.state === 'erstellt' && r.doc?.number)
  const failedArch = all.filter((r) => r.archive === 'fehler')
  const head = `<div class="section-head"><div><h2>Matten-Lieferscheine</h2><p>Je abgeschlossenem Stopp ein Lieferschein mit fortlaufender Nummer, den tatsächlich gewechselten Matten und der Unterschrift. Er ist ein Beleg der Fakturierung, das PDF liegt in SharePoint beim Kunden. Gesendet wird nach Prüfung im Büro, bei Kunden mit „automatisch senden“ gleich nach dem Erstellen.</p></div>
    <div class="actions">${act && createKeys.length ? `<button class="btn primary" data-action="mw-ls-create-all" ${busy ? 'disabled' : ''}>Lieferscheine erstellen (${createKeys.length})</button>` : ''}${act && (selDocs.length || unsent.length) ? `<button class="btn" data-action="mw-ls-run-open">${ICON.send} ${selDocs.length ? `Senden (${selDocs.length})` : `Alle nicht versendeten senden (${unsent.length})`}</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        editable() && { label: 'Einstellungen', icon: ICON.gear, action: 'mw-ls-settings-open', hint: officeEmailOf(msettings()) ? `Büro: ${officeEmailOf(msettings())}` : 'Büro-E-Mail, automatisch erstellen' },
        act && failedArch.length && { label: 'Ablage erneut versuchen', icon: ICON.upload, action: 'mw-ls-archive-all', hint: plural(failedArch.length, 'Lieferschein', 'Lieferscheine') },
        { label: 'Neu laden', icon: ICON.refresh, action: 'mw-ls-reload', hint: 'Touren aus der Ablage' },
        sees('fakturierung') && { label: 'Lieferscheine in der Fakturierung', icon: ICON.list, action: 'mw-ls-fak', hint: 'Belege → Lieferscheine & Proforma' },
        { label: 'Matten-Touren', icon: ICON.list, action: 'view', data: { view: 'mw-touren' }, hint: 'Stopps der Fahrer' },
      ],
    })}</div></div>`
  const banners = [
    !rg.create || !F() ? `<div class="banner"><p>${esc(rg.hint || 'Die Fakturierung ist für dein Konto nicht geladen: Lieferscheine erstellt und sendet, wer zusätzlich die Fakturierung bearbeitet.')}</p></div>` : '',
    act && !officeEmailOf(msettings()) ? `<div class="banner welcome"><p>Für „An Büro“ und „An beide“ fehlt noch die Büro-Adresse.</p>${editable() ? '<button class="btn" data-action="mw-ls-settings-open">Einstellungen</button>' : ''}</div>` : '',
    act && !sharepoint() ? '<p class="note">Browser-Modus: die PDFs werden nicht in SharePoint abgelegt (nur mit Microsoft 365).</p>' : '',
  ].join('')
  const status = !ready ? '<p class="note">Touren werden gelesen …</p>' : s?.offline ? '<p class="note">Ohne Verbindung: angezeigt wird der zuletzt gelesene Stand. Erstellen und Senden gehen erst wieder mit Netz.</p>' : s?.error ? `<p class="note">${esc(s.error)}</p>` : ''
  const tile = (key, label, value, cls = '') => `<button class="stat mwl-stat ${cls} ${filter === key ? 'on' : ''}" data-action="mw-ls-filter" data-v="${key}" aria-pressed="${filter === key}"><span class="label">${label}</span><span class="value">${value}</span></button>`
  const tiles = `<div class="impact-stats mwl-stats">${tile('offen', 'ohne Lieferschein', sum.offen, sum.offen ? 'warn' : '')}${tile('erstellt', 'nicht versendet', sum.erstellt)}${tile('versendet', 'versendet', sum.versendet)}${tile('ablage', 'Ablage fehlgeschlagen', sum.ablage, sum.ablage ? 'warn' : '')}</div>`
  const filters = `<div class="filters mwl-filters">
      <label class="field inline"><span>Anzeigen</span><select id="mw-ls-f" data-change="mw-ls-filter">${options(Object.entries(NOTE_FILTERS), filter)}</select></label>
      ${['versendet', 'alle'].includes(filter) ? `<label class="field inline"><span>Zeitraum</span><select id="mw-ls-r" data-change="mw-ls-range">${options(Object.entries(RANGES), range)}</select></label>` : ''}
      ${act && list.some((r) => r.state !== 'keiner') ? `<label class="check"><input type="checkbox" data-change="mw-ls-sel-all" ${sel.length && sel.length === list.filter((r) => r.state !== 'keiner').length ? 'checked' : ''}><span>alle markieren</span></label>` : ''}</div>`
  const shown = list.slice(0, 200)
  const rows = shown
    .map((r) => {
      const box = act && r.state !== 'keiner' ? `<input type="checkbox" data-change="mw-ls-sel" data-key="${esc(r.key)}" ${sel.includes(r.key) ? 'checked' : ''} aria-label="${esc(`${r.customerName} am ${day(r.date)} markieren`)}">` : ''
      return `<tr class="mwl-row st-${esc(r.state)}"><td class="mwl-box">${box}</td>
        <td class="clickable" data-action="mw-ls-open" data-tour="${esc(r.tour.id)}" data-stop="${esc(r.stop.id)}"><span class="mwl-cell"><strong>${esc(day(r.date))}</strong>${r.time ? `<br><span class="muted">${esc(r.time)} Uhr</span>` : ''}</span></td>
        <td><span class="mwl-cell"><strong>${esc(r.customerName || 'Kunde')}</strong>${r.customerNo ? ` <span class="muted">(${esc(r.customerNo)})</span>` : ''}${r.objectName ? `<br>${esc(r.objectName)}` : ''}</span></td>
        <td>${esc(r.driver || '–')}</td>
        <td><span class="mwl-cell">${esc(totalsText(r))}<br><span class="muted">${esc(STOP_STATUS[r.stop.status] || r.stop.status)}</span></span></td>
        <td><span class="mwl-cell">${r.number ? `<strong>${esc(r.number)}</strong><br>` : ''}${statePills(r)}</span></td>
        <td class="actions-cell">${rowActions(r, act)}</td></tr>`
    })
    .join('')
  const empty = !ready ? '' : `<p class="empty">${filter === 'offen' ? 'Alle abgeschlossenen Stopps haben einen Lieferschein (oder brauchen keinen).' : 'Kein Stopp in dieser Auswahl.'}</p>`
  return `${head}${banners}${status}${tiles}${filters}
    ${rows ? `<div class="table-wrap"><table class="data mwl-table"><thead><tr><th><span class="visually-hidden">Auswahl</span></th><th>Abschluss</th><th>Kunde und Objekt</th><th>Fahrer</th><th>Matten</th><th>Lieferschein</th><th><span class="visually-hidden">Aktionen</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty}
    ${list.length > shown.length ? `<p class="muted">Die neuesten 200 von ${list.length}.</p>` : ''}
    <p class="note">Ein Lieferschein je Stopp: ein zweites Erstellen erzeugt keinen zweiten. „Kunde nicht angetroffen“ und „nicht durchgeführt“ bekommen keinen Lieferschein, nur einen Vermerk am Stopp. Die Preise stehen eingefroren im Beleg (für die Rechnung), nicht im PDF.</p>`
}

registerView({
  id: 'mw-lieferscheine',
  order: 75.65,
  label: 'Matten-Lieferscheine',
  group: 'service',
  module: MODULE,
  icon: ICON_LS,
  noWeek: true,
  text: 'Mattenwechsel: Lieferscheine je Stopp erstellen, senden und in SharePoint ablegen',
  badge: () => app.mwLs?.offen || 0,
  render: lieferscheineView,
})

// ---------------------------------------------------------------- Dialog: Lieferschein eines Stopps

const money = (n) => `${(Number(n) || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const sigImg = (svg) => (svg ? `<img class="mwl-sig" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Unterschrift">` : '')
const atText = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Vienna' }) : '')

function rowOf(tourId, stopId) {
  return noteRows({ tours: (tourStore()?.tours() || []).filter((t) => t.id === tourId), docs: fakDocs() }).find((r) => r.stop.id === stopId) || null
}

function docModal(c, m) {
  const r = rowOf(m.tour, m.stop)
  if (!r) return modalFrame({ title: 'Lieferschein', body: '<p>Stopp nicht gefunden (Touren noch nicht gelesen?).</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const act = mayAct()
  const d = r.doc
  const stop = r.stop
  const prices = !!d && sees('fakturierung')
  const linesHtml = d
    ? (d.lines || [])
        .map((l) =>
          (l.type || 'item') === 'title'
            ? `<tr class="mwl-title"><td colspan="${prices ? 4 : 2}"><strong>${esc(l.text)}</strong></td></tr>`
            : l.type === 'text'
              ? `<tr><td colspan="${prices ? 4 : 2}" class="muted">${esc(l.text)}</td></tr>`
              : `<tr><td>${esc(l.text)}${l.longText ? `<br><span class="muted">${esc(l.longText)}</span>` : ''}</td><td class="num">${esc(String(l.qty))} ${esc(l.unit || '')}</td>${prices ? `<td class="num">${money(l.price)}${l.source?.price === 'kunde' ? '<br><span class="muted">Kundenpreis</span>' : l.source?.price === 'fehlt' ? '<br><span class="pill warning">ohne Preis</span>' : ''}</td><td class="num">${money((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>` : ''}</tr>`,
        )
        .join('')
    : placementsOf(stop)
        .map((p) => `<tr><td>${esc(p.placementName || 'Liegeplatz')}</td><td class="num">${p.actual} von ${p.planned}</td></tr>`)
        .join('')
  const receipt = stop.signature ? `<div class="mwl-receipt">${sigImg(stop.signature.svg)}<p><strong>${esc(stop.signature.name)}</strong>${stop.signature.role ? `, ${esc(stop.signature.role)}` : ''}<br><span class="muted">unterschrieben am ${esc(atText(stop.signature.at))}</span></p></div>` : `<p><strong>Ohne Unterschrift:</strong> ${esc(stop.unsigned?.reason || '')}</p>`
  const archive = d?.number
    ? d.archive?.webUrl
      ? `<p>Abgelegt in SharePoint: <a href="${esc(d.archive.webUrl)}" target="_blank" rel="noopener">${esc(d.archive.path.split('/').pop())}</a> <span class="muted">(${esc(atText(d.archive.uploadedAt))})</span></p>`
      : archiveState(d) === 'fehler'
        ? `<p class="mwl-err" role="alert"><strong>Ablage fehlgeschlagen</strong> (${d.integration.ablage.tries} ${d.integration.ablage.tries === 1 ? 'Versuch' : 'Versuche'}): ${esc(d.integration.ablage.lastError || '')}. Der Lieferschein gilt trotzdem.</p>`
        : archiveState(d) === 'offen'
          ? '<p class="note">Ablage wartet auf Netz: das PDF wird nachgeholt.</p>'
          : sharepoint()
            ? '<p class="note">Noch nicht in SharePoint abgelegt.</p>'
            : ''
    : ''
  const sent = (d?.sent || []).map((v) => `<li>${esc(atText(v.at))}: ${v.via === 'mailto' ? 'E-Mail-Programm, ' : ''}an ${esc(v.to || '–')}${v.mode ? ` (${esc(MAIL_MODES[v.mode] || v.mode)})` : ''}${v.auto ? ' – automatisch' : ''}${v.by ? `, ${esc(v.by)}` : ''}</li>`).join('')
  const mailErr = d && mailState(d) === 'fehler' ? `<p class="mwl-err" role="alert"><strong>Versand fehlgeschlagen:</strong> ${esc(d.integration.mail.lastError || '')}</p>` : ''
  const head = `<p><strong>${esc(r.customerName || 'Kunde')}</strong>${r.customerNo ? ` (${esc(r.customerNo)})` : ''} · ${esc(r.objectName || '')}<br><span class="muted">${esc(stop.address || '')}</span></p>
    <p>Abgeschlossen am ${esc(day(r.date))}${r.time ? ` um ${esc(r.time)} Uhr` : ''}${r.driver ? `, Fahrer: ${esc(r.driver)}` : ''} · ${esc(STOP_STATUS[stop.status] || stop.status)} · ${esc(totalsText(r))}</p>`
  const state = d?.number ? `<p><strong>${esc(d.number)}</strong> vom ${esc(deDate(d.date))} ${statePills(r)}</p>` : `<p>${statePills(r)}</p>`
  const remarks = d?.outro || stop.note ? `<p class="mwl-remarks">${esc(d?.outro || `Bemerkung: ${stop.note}`).replace(/\n/g, '<br>')}</p>` : ''
  const body = `${head}${state}
    <div class="table-wrap"><table class="data mwl-lines"><thead><tr><th>${d ? 'Position' : 'Liegeplatz'}</th><th class="num">Menge</th>${prices ? '<th class="num">Preis (eingefroren)</th><th class="num">netto</th>' : ''}</tr></thead><tbody>${linesHtml}</tbody></table></div>
    ${remarks}${receipt}${archive}${mailErr}${sent ? `<h3>Versendet</h3><ul>${sent}</ul>` : ''}
    ${r.state === 'offen' && !act ? `<p class="note">${esc(rights().hint || 'Lieferscheine erstellt, wer den Mattenwechsel und die Fakturierung bearbeitet.')}</p>` : ''}
    ${r.state === 'keiner' ? `<p class="note">Kein Lieferschein: ${esc(r.need.reason)}.</p>` : ''}`
  const buttons = d?.number && act
    ? `<button class="btn" data-action="mw-ls-pdf" data-id="${esc(d.id)}">${ICON.download} PDF</button>${archiveState(d) !== 'ok' && sharepoint() ? `<button class="btn" data-action="mw-ls-archive" data-id="${esc(d.id)}">${ICON.upload} ${archiveState(d) === 'fehler' ? 'Ablage erneut versuchen' : 'Ablegen'}</button>` : ''}${sees('fakturierung') ? `<button class="btn" data-action="mw-ls-fak" data-id="${esc(d.id)}">In der Fakturierung</button>` : ''}${menu({
        label: `${ICON.send} ${(d.sent || []).length ? 'Erneut senden' : 'Senden'}`,
        btn: 'primary',
        single: false,
        items: Object.entries(MAIL_MODES).map(([k, label]) => ({ label, action: 'mw-ls-send', data: { id: d.id, mode: k }, hint: k === 'buero' ? officeEmailOf(msettings()) || 'Adresse fehlt' : k === 'kunde' ? mailRecipients({ doc: d, customer: custOf(d.customerId), mode: 'kunde' }).to[0] || 'Adresse fehlt' : '' })),
      })}`
    : r.state === 'offen' && act
      ? `<button class="btn primary" data-action="mw-ls-create" data-key="${esc(r.key)}">Lieferschein erstellen</button>`
      : ''
  return modalFrame({ title: d?.number ? `Lieferschein ${d.number}` : 'Lieferschein', subtitle: `${esc(r.customerName || '')} · ${esc(day(r.date))}`, wide: true, body, foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${buttons}</div>` })
}
registerModal('mw-ls-doc', docModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Sammelversand

function runModal(c, m) {
  const run = m.run
  const mode = MAIL_MODES[m.mode] ? m.mode : 'kunde'
  const docs = m.ids.map(docOf).filter((d) => d?.number)
  const rows = docs
    .map((d) => {
      const r = mailRecipients({ doc: d, customer: custOf(d.customerId), settings: msettings(), mode })
      return `<tr><td><strong>${esc(d.number)}</strong><br><span class="muted">${esc(deDate(d.date))}</span></td><td>${esc(d.recipient?.name || '')}${d.objectName ? `<br><span class="muted">${esc(d.objectName)}</span>` : ''}</td><td>${r.to.length ? esc([...r.to, ...r.cc].join('; ')) : `<span class="pill error">${esc(missingText(r.missing))}</span>`}</td><td>${(d.sent || []).length ? '<span class="pill ok">schon gesendet</span>' : mailState(d) === 'fehler' ? '<span class="pill error">Fehler</span>' : ''}</td></tr>`
    })
    .join('')
  const progress = run ? `<div class="mwl-progress" role="status" aria-live="polite"><progress max="${run.total}" value="${run.done}"></progress><p><strong>${run.done} von ${run.total}</strong> ${run.running ? (run.stop ? 'erledigt – hält nach dieser E-Mail an …' : 'erledigt …') : 'erledigt.'} ${run.sent} gesendet${run.failed ? `, ${run.failed} mit Fehler` : ''}.</p>${run.errors?.length ? `<ul class="mwl-errs">${run.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>` : ''
  return modalFrame({
    title: `Lieferscheine senden (${docs.length})`,
    subtitle: 'je Lieferschein eine E-Mail mit dem PDF',
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>An</span><select id="mw-ls-run-mode" data-change="mw-ls-run-mode" ${run?.running ? 'disabled' : ''}>${options(Object.entries(MAIL_MODES), mode)}</select></label></div>
      ${canMail() ? '' : '<p class="banner warn-banner">Sammelversand geht nur aus Microsoft 365 (Senden direkt aus der App). Einzeln öffnet „Senden“ das E-Mail-Programm.</p>'}
      ${progress}
      <div class="table-wrap"><table class="data mwl-run"><thead><tr><th>Lieferschein</th><th>Kunde</th><th>Empfänger</th><th>Stand</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Zwischen zwei E-Mails wartet die App ${String(MAIL_PAUSE_MS / 1000).replace('.', ',')} Sekunden (Microsoft 365 nimmt höchstens 30 E-Mails je Minute an). Ohne Adresse oder bei einem Fehler bleibt der Lieferschein offen und steht hier.</p>`,
    foot: `<button class="btn" data-action="close-modal" ${run?.running ? 'disabled' : ''}>Schließen</button><div class="actions">${run?.running ? '<button class="btn" data-action="mw-ls-run-stop">Anhalten</button>' : `<button class="btn primary" data-action="mw-ls-run" ${canMail() && docs.length ? '' : 'disabled'}>${ICON.send} Senden (${docs.length})</button>`}</div>`,
  })
}
registerModal('mw-ls-run', runModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Einstellungen

function settingsModal() {
  const s = msettings()
  return modalFrame({
    title: 'Lieferscheine: Einstellungen',
    body: `<div class="form-grid">
        <label class="field wide"><span>E-Mail des Büros (für „An Büro“ und „An beide“)</span><input type="email" id="mw-ls-office" value="${esc(officeEmailOf(s))}" placeholder="buero@firma.at" autocomplete="email" inputmode="email"></label>
        <label class="check wide"><input type="checkbox" id="mw-ls-auto" ${s.autoDeliveryNotes ? 'checked' : ''}><span>Lieferscheine automatisch erstellen, sobald das Büro die App öffnet (alle abgeschlossenen Stopps)</span></label>
      </div>
      <p class="note">Ob ein Lieferschein ohne Prüfung gleich an den Kunden geht, steht je Kunde in der Fakturierung (Kundenblatt → Mattenwechsel → „Lieferschein automatisch senden“). Gesendet wird immer aus dem Postfach der angemeldeten Person, nie ohne geöffnete App.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="mw-ls-settings-save">Speichern</button></div>`,
  })
}
registerModal('mw-ls-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

registerActions({
  // aus „Zu erledigen“, dem digitalen Mitarbeiter und der Fahreransicht: Ansicht mit Filter öffnen
  'mw-ls-goto': (el) => {
    if (NOTE_FILTERS[el?.dataset?.filter]) app.ui.mwLsFilter = el.dataset.filter
    app.ui.view = VIEW
    closeModal()
    renderNow()
  },
  'mw-ls-filter': (el) => {
    app.ui.mwLsFilter = el.dataset.v || el.value || 'offen'
    app.ui.mwLsSel = []
    renderNow()
  },
  'mw-ls-range': (el) => {
    app.ui.mwLsRange = el.value
    renderNow()
  },
  'mw-ls-sel': (el) => {
    const set = new Set(selected())
    if (el.checked) set.add(el.dataset.key)
    else set.delete(el.dataset.key)
    app.ui.mwLsSel = [...set]
    renderNow()
  },
  'mw-ls-sel-all': (el) => {
    app.ui.mwLsSel = el.checked ? allRows().filter((r) => rowMatches(r, filterOf()) && r.state !== 'keiner').map((r) => r.key) : []
    renderNow()
  },
  'mw-ls-open': (el) => {
    ensureTours()
    openModal({ type: 'mw-ls-doc', tour: el.dataset.tour, stop: el.dataset.stop })
  },
  'mw-ls-reload': async () => {
    const s = tourStore()
    if (!s) return
    attempts.clear()
    await s.load({ years: yearsShown() }).catch((err) => toast(`Touren konnten nicht gelesen werden: ${err.message}`))
    renderNow()
  },
  // in der Fakturierung: der Beleg (dort ganz normal, ohne zweite Logik) bzw. der Reiter „Lieferscheine & Proforma“
  'mw-ls-fak': async (el) => {
    closeModal()
    Object.assign(app.ui, { view: 'fakturierung', fakTab: 'weitere' })
    renderNow()
    if (el.dataset.id) await ACTIONS['fak-open']?.(el)
  },
})

registerActions(
  {
    'mw-ls-create': async (el) => {
      await createNotes([el.dataset.key])
      if (app.ui.modal?.type === 'mw-ls-doc') renderModal()
    },
    'mw-ls-create-all': async () => {
      const sel = selected()
      const open = allRows().filter((r) => r.state === 'offen')
      const keys = open.some((r) => sel.includes(r.key)) ? open.filter((r) => sel.includes(r.key)).map((r) => r.key) : open.map((r) => r.key)
      app.ui.mwLsSel = []
      await createNotes(keys)
    },
    'mw-ls-pdf': async (el) => {
      const doc = docOf(el.dataset.id)
      if (!doc) return
      try {
        download(noteFileName(doc), await pdfOf(doc))
      } catch (err) {
        toast(`PDF nicht erstellt: ${err.message}`)
      }
    },
    'mw-ls-send': async (el) => {
      if (!mayAct()) return toast(rights().hint)
      await openSend(el.dataset.id, el.dataset.mode || 'kunde')
    },
    'mw-ls-archive': async (el) => {
      if (!mayAct()) return toast(rights().hint)
      const st = await archiveNote(el.dataset.id)
      toast(st === 'ok' ? 'PDF in SharePoint abgelegt.' : st === 'offen' ? 'Ohne Verbindung: die Ablage wird nachgeholt.' : st === 'fehler' ? `Ablage fehlgeschlagen: ${docOf(el.dataset.id)?.integration?.ablage?.lastError || ''}` : 'Ablage nur mit SharePoint.')
      invalidateTodo()
      renderNow()
      if (app.ui.modal?.type === 'mw-ls-doc') renderModal()
    },
    'mw-ls-archive-all': async () => {
      if (!mayAct()) return toast(rights().hint)
      const ids = allRows().filter((r) => r.archive === 'fehler' && r.doc).map((r) => r.doc.id)
      let ok = 0
      for (const id of ids) if ((await archiveNote(id)) === 'ok') ok++
      toast(`${ok} von ${ids.length} abgelegt.`)
      invalidateTodo()
      renderNow()
    },
    'mw-ls-run-open': () => {
      if (!mayAct()) return toast(rights().hint)
      const sel = selected()
      const rows = allRows()
      const chosen = rows.filter((r) => sel.includes(r.key) && r.doc?.number)
      const ids = (chosen.length ? chosen : rows.filter((r) => r.state === 'erstellt' && r.doc?.number)).map((r) => r.doc.id)
      openModal({ type: 'mw-ls-run', ids, mode: 'kunde', run: null })
    },
    'mw-ls-run-mode': (el) => {
      const m = app.ui.modal
      if (m?.type !== 'mw-ls-run' || m.run?.running) return
      m.mode = el.value
      renderModal()
    },
    'mw-ls-run': async () => {
      const m = app.ui.modal
      if (m?.type !== 'mw-ls-run' || m.run?.running) return
      if (!canMail()) return toast('Sammelversand geht nur aus Microsoft 365.')
      m.run = { total: m.ids.length, done: 0, sent: 0, failed: 0, errors: [], running: true, stop: false }
      renderModal()
      const res = await sendMany(m.ids, m.mode || 'kunde', { run: m.run })
      Object.assign(m.run, res, { running: false })
      app.ui.mwLsSel = []
      if (app.ui.modal === m) renderModal()
      renderNow()
      toast(`${plural(res.sent, 'Lieferschein', 'Lieferscheine')} gesendet${res.failed ? `, ${res.failed} mit Fehler` : ''}.`)
    },
    'mw-ls-run-stop': () => {
      const m = app.ui.modal
      if (m?.run?.running) {
        m.run.stop = true
        renderModal()
      }
    },
    'mw-ls-settings-open': () => openModal({ type: 'mw-ls-settings' }),
    'mw-ls-settings-save': () => {
      const office = val('mw-ls-office').trim()
      if (office && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(office)) return toast('Bitte eine gültige E-Mail-Adresse für das Büro eintragen.')
      const s = msettings()
      if (office) s.officeEmail = office
      else delete s.officeEmail
      if (checked('mw-ls-auto')) s.autoDeliveryNotes = true
      else delete s.autoDeliveryNotes
      persist()
      closeModal()
      toast('Einstellungen gespeichert.')
      renderNow()
      autoLater()
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen (wer Lieferscheine erstellen darf)

registerTodo({
  id: 'matten-ls',
  module: MODULE,
  title: 'Matten-Lieferscheine',
  compute: () => {
    if (!rights().create || !F()) return []
    ensureTours(yearsShown(), 5 * 60_000)
    const sum = publish()
    const out = []
    if (sum.offen) out.push({ id: `offen:${sum.offen}:${sum.oldest}`, kind: 'offen', count: sum.offen, oldest: sum.oldest })
    if (sum.ablage) out.push({ id: `ablage:${sum.ablage}`, kind: 'ablage', count: sum.ablage })
    if (sum.erstellt) out.push({ id: `send:${sum.erstellt}`, kind: 'erstellt', count: sum.erstellt })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'offen'
          ? `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Abgeschlossene Stopps ohne Lieferschein (${x.count})</strong><br><span class="muted">${x.oldest ? `ältester vom ${esc(day(x.oldest))}. ` : ''}In „Matten-Lieferscheine“ erstellen.</span></div><button class="btn small primary" data-action="mw-ls-goto" data-filter="offen">Öffnen</button></div>`
          : x.kind === 'ablage'
            ? `<div class="todo-item"><span class="flag error">${x.count}</span><div class="todo-text"><strong>Ablage fehlgeschlagen – erneut versuchen (${x.count})</strong><br><span class="muted">Die Lieferscheine gelten, das PDF liegt noch nicht in SharePoint.</span></div><button class="btn small primary" data-action="mw-ls-goto" data-filter="ablage">Öffnen</button></div>`
            : `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Lieferscheine noch nicht versendet (${x.count})</strong><br><span class="muted">Prüfen und an Kunde, Büro oder beide senden.</span></div><button class="btn small primary" data-action="mw-ls-goto" data-filter="erstellt">Öffnen</button></div>`,
      )
      .join(''),
})

export { archiveNote, createNotes }
