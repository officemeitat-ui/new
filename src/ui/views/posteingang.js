// Posteingang (Kürzel „pst-“, Modul „posteingang“, später geladen mit dem Paket des Büros): E-Mails und Belege
// ablegen bzw. aus dem Microsoft-365-Postfach lesen, erkennen, worum es geht, und je Art einen Entwurf im richtigen
// Bereich vorbereiten. Angelegt wird erst, wenn die Person dort prüft und speichert; danach steht die Nachricht als
// „erledigt“ mit Verweis auf den Eintrag.
//
//  - Quellen: Dateien ablegen oder wählen (.eml mit Anhängen, PDF, Bild), Text einfügen; mit config.json →
//    features.posteingang das Postfach über Graph (Mail.Read bzw. Mail.Read.Shared für posteingang.mailbox), nur
//    lesen: ein Ordner, die letzten N Tage, nur ungelesene oder alle. Im Browser-Modus ein Beispiel-Postfach.
//  - Erkennen: Regeln immer (core/posteingang.js → ruleGuess); „Mit KI erkennen“ bzw. „Alle neuen erkennen“ über
//    ki.php (src/ai/extract.js → classifyMail) nach dem Hinweis vor dem ersten Senden (ui/kix.js). Krankmeldungen und
//    Nachrichten aus dem Team gehen nie an die KI.
//  - Übergaben: Reklamation, Angebot, Regiebericht, Vertrieb, Termin, Kündigung im Vertrag, Eingangsrechnung (mit
//    Beleg, „Aus Beleg lesen“ im Einkauf), Bewerbung (mit Unterlagen), Abwesenheit. Nur mit Recht im Zielbereich.
//    Das Ziel speichert die Kennung des Eintrags mit (posteingang bzw. ref „pst:…“); daran erkennt der Posteingang,
//    dass angelegt wurde (findCreated).
//  - Ablage posteingang/posteingang.json: nur Kennung, Absender, Betreff, Datum, Art, Status, wer, wann, Verweis.
//    Mailtext und Anhänge bleiben im Arbeitsspeicher dieses Geräts.

import { dayOf } from '../../core/complaints.js'
import { formatDate, todayISO } from '../../core/dates.js'
import { customerName } from '../../core/invoicing.js'
import { KI_LIMITS } from '../../core/ki-vorschlag.js'
import {
  addressText,
  ART_LABEL,
  artLabel,
  attachmentsFromGraph,
  attachmentsUrl,
  attachmentUrl,
  base64Bytes,
  cleanupPosteingang,
  entryFor,
  FIELDS_BY_ART,
  filterEntries,
  findCreated,
  folderLookupUrls,
  handoversFor,
  HANDOVERS,
  hashOf,
  isOutlookMsg,
  kiBlocked,
  listUrl,
  mailScope,
  messageKey,
  messageUrl,
  MSG_HINT,
  msgFromGraph,
  newCount,
  parseAddressList,
  parseEml,
  PE_ARTEN,
  prefillFor,
  ruleContext,
  ruleGuess,
  setArt,
  setStatus,
  settingsOf,
  STATUS_LABEL,
  tidyText,
  upsertEntry,
  wellKnownFolder,
} from '../../core/posteingang.js'
import { contractStatus, earliestEnd } from '../../core/vertraege.js'
import { ACTIONS, app, canEdit, closeModal, dataStamp, ensureAction, ensureModal, onModalRender, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { kixBox, kixButton, kixCheck, kixConsent, kixFailed, kixSet } from '../kix.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { checked, download, esc, ICON, modalFrame, options, val } from '../shared.js'
import { onAppointmentSaved } from './appointments.js'

const MODULE = 'posteingang'
const D = () => {
  const d = (app.data.posteingang ||= { items: [], settings: {} })
  d.items ||= []
  d.settings ||= {}
  return d
}
const S = () => settingsOf(D())
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.sees(m)
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const entryOf = (id) => D().items.find((x) => x.id === id)
const putEntry = (next) => {
  const d = D()
  d.items = d.items.map((x) => (x.id === next.id ? next : x))
}
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || ''
const custName = (id) => customerName((app.data.fakturierung?.customers || []).find((c) => c.id === id) || {})
const when = (iso) => (iso ? `${formatDate(dayOf(iso))}${iso.length > 10 ? ` ${new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' })}` : ''}` : '')
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const ART_CLS = { reklamation: 'warning', kuendigung: 'error', zusatzauftrag: 'ok', anfrage_neukunde: 'ok', terminwunsch: 'info', eingangsrechnung: 'info', krankmeldung: 'info', bewerbung: '', sonstiges: '' }
const SOURCE_LABEL = { graph: 'Postfach', demo: 'Beispiel-Postfach', datei: 'Datei', text: 'eingefügter Text' }
const ICON_PE = '<path d="M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5"/><path d="M6 5h12l2.5 8.5v5h-17v-5z"/>'

// Nachrichten im Arbeitsspeicher (mit Text und Anhängen): Kennung → Nachricht. Gespeichert wird nur der Eintrag.
const MSGS = new Map()
// Übergaben, deren Ziel noch nicht gespeichert ist: Kennung → { kind, before?, employeeId? }
const PENDING = new Map()
const G = { loading: null, error: '', missing: null, at: 0, hint: '', demo: false, folder: null, started: false }

/** Postfach eingerichtet (config.json → features.posteingang)? */
export const mailboxOn = () => !!app.config?.features?.posteingang
const graphOn = () => mailboxOn() && !!app.auth?.tokenFor
const demoOn = () => !graphOn() && app.store?.kind !== 'sharepoint' && !!app.config?.demo
const mailbox = () => String(app.config?.posteingang?.mailbox || '').trim()

// ---------------------------------------------------------------- Erkennen (Regeln)

const CTX = { key: null, ctx: null }
function ctx() {
  const key = dataStamp()
  if (CTX.key !== key) {
    CTX.key = key
    CTX.ctx = ruleContext(
      {
        customers: sees('fakturierung') ? app.data.fakturierung?.customers || [] : [],
        suppliers: sees('einkauf') ? app.data.einkauf?.suppliers || [] : [],
        objects: app.data.objects || [],
        employees: app.data.employees || [],
      },
      { customerName },
    )
  }
  return CTX.ctx
}
function analysis(msg) {
  const c = ctx()
  const k = `${CTX.key}|${msg.loaded ? 1 : 0}|${(msg.text || '').length}|${(msg.attachments || []).length}`
  if (msg._a?.k !== k) msg._a = { k, a: ruleGuess(msg, c) }
  return msg._a.a
}

/**
 * Vorschlag: Art aus der Ablage (Person, KI oder Regel – für alle Rollen gleich, auch wenn eine Rolle weniger Daten
 * sieht), sonst aus den Regeln; Kunde und Objekt nach Wahl der Person, KI, Regel.
 */
function proposal(msg, entry) {
  const a = msg ? analysis(msg) : null
  const art = entry && !entry.transient ? entry.art : a?.art || entry?.art || 'sonstiges'
  const choice = msg?.choice || {}
  return { a, art, customerId: choice.customerId ?? (msg?.ki?.customerId || a?.customerId || ''), objectId: choice.objectId ?? (msg?.ki?.objectId || a?.objectId || '') }
}

/** Nachricht im Arbeitsspeicher aufnehmen bzw. ergänzen (Ergebnis der KI und Wahl der Person bleiben). */
function addMessage(msg) {
  const old = MSGS.get(msg.id)
  const next = old ? { ...old, ...Object.fromEntries(Object.entries(msg).filter(([, v]) => v !== undefined)), ki: old.ki, choice: old.choice, attachments: msg.attachments?.length ? msg.attachments : old.attachments || [] } : { attachments: [], ...msg }
  MSGS.set(msg.id, next)
  return next
}

/** Eintrag in der Ablage anlegen bzw. ergänzen (nur mit Recht zum Bearbeiten). true: geändert. */
function remember(msg) {
  if (!editable()) return false
  const a = analysis(msg)
  const res = upsertEntry(D().items, entryFor(msg, { art: a.art, artBy: 'regel', masked: a.health, at: nowIso(), by: by() }))
  if (res.changed) D().items = res.items
  return res.changed
}

/** Erledigte und ignorierte Einträge nach der eingestellten Frist entfernen. */
function cleanup() {
  if (!editable() || !app.data) return false
  const res = cleanupPosteingang(D().items, todayISO(), S().keepDays)
  if (res.removed) D().items = res.items
  return res.removed > 0
}

// ---------------------------------------------------------------- Postfach (Graph, nur lesen)

async function token() {
  const scope = mailScope(app.config)
  try {
    const t = (await app.auth.tokenFor([scope])).accessToken
    G.missing = null
    return t
  } catch (err) {
    G.missing = { scope, error: String(err?.message || err).split('\n')[0].slice(0, 160) }
    throw Object.assign(new Error(`Für das Postfach fehlt die Berechtigung „${scope}“.`), { code: 'right' })
  }
}

async function graphGet(url, headers = {}) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}`, ...headers } })
  if (res.status === 401 || res.status === 403) {
    G.missing = { scope: mailScope(app.config), error: `Microsoft meldet ${res.status} (kein Zugriff auf das Postfach)` }
    throw Object.assign(new Error(`Kein Zugriff auf das Postfach${mailbox() ? ` ${mailbox()}` : ''}.`), { code: 'right' })
  }
  if (res.status === 404) throw new Error('Postfach oder Ordner nicht gefunden: Adresse (config.json → posteingang.mailbox) und Ordner in den Einstellungen prüfen.')
  if (!res.ok) throw new Error(`Das Postfach ist gerade nicht lesbar (Fehler ${res.status}).`)
  return res.json()
}

async function folderId() {
  const s = S()
  const known = wellKnownFolder(s.folder)
  if (known) return known
  if (G.folder?.name === s.folder) return G.folder.id
  for (const url of folderLookupUrls(mailbox(), s.folder)) {
    const f = (await graphGet(url)).value?.[0]
    if (f) {
      G.folder = { name: s.folder, id: f.id }
      return f.id
    }
  }
  throw new Error(`Ordner „${s.folder}“ gibt es im Postfach nicht (oberste Ebene oder unter dem Posteingang).`)
}

function fromGraph(g) {
  const base = msgFromGraph(g)
  return addMessage({ ...base, id: messageKey({ messageId: base.messageId, hash: hashOf(`graph:${base.graphId}`) }), mailbox: mailbox() })
}

async function loadDemo() {
  if (G.demo) return
  const { demoMails } = await import('../../data/demo-posteingang.js')
  for (const raw of demoMails(todayISO())) {
    const p = parseEml(raw)
    addMessage({ ...p, id: messageKey(p), source: 'demo', loaded: true })
  }
  G.demo = true
}

/** Postfach neu lesen (Graph bzw. Beispiel-Postfach), neue Nachrichten als Eintrag „neu“ ablegen. */
function refresh() {
  if (G.loading) return G.loading
  G.loading = (async () => {
    if (graphOn()) {
      const s = S()
      let url = listUrl({ mailbox: mailbox(), folderId: await folderId(), days: s.days, unreadOnly: s.unreadOnly })
      for (let page = 0; url && page < 4; page++) {
        const j = await graphGet(url)
        for (const g of j.value || []) fromGraph(g)
        url = j['@odata.nextLink'] || ''
      }
    } else if (demoOn()) await loadDemo()
    G.error = ''
    G.at = Date.now()
  })()
    .catch((err) => {
      G.error = err.message
    })
    .finally(() => {
      G.loading = null
      let changed = cleanup()
      for (const m of MSGS.values()) changed = remember(m) || changed
      if (changed) persist()
      if (app.ui.view === 'posteingang') renderNow()
    })
  return G.loading
}

/** Text und Anhänge (Angaben) einer Nachricht aus dem Postfach nachladen. */
async function ensureBody(msg) {
  if (!msg || msg.loaded || msg.source !== 'graph') return msg
  msg.loading ||= (async () => {
    const [g, atts] = await Promise.all([graphGet(messageUrl(msg.mailbox, msg.graphId), { Prefer: 'outlook.body-content-type="text"' }), msg.hasAttachments ? graphGet(attachmentsUrl(msg.mailbox, msg.graphId)) : Promise.resolve({ value: [] })])
    const full = msgFromGraph(g)
    Object.assign(msg, { text: full.text || '', to: full.to, cc: full.cc, loaded: true, attachments: attachmentsFromGraph(atts.value || []), error: '' })
    msg._a = null
    if (remember(msg)) persist()
  })()
    .catch((err) => {
      msg.error = err.message
    })
    .finally(() => {
      msg.loading = null
    })
  await msg.loading
  return msg
}

/** Inhalt eines Anhangs (aus der Datei bzw. aus dem Postfach). */
async function attachmentBytes(msg, att) {
  if (att?.data) return att.data
  if (msg?.source === 'graph' && att?.graphId) {
    const j = await graphGet(attachmentUrl(msg.mailbox, msg.graphId, att.graphId))
    att.data = base64Bytes(j.contentBytes || '')
    return att.data
  }
  throw new Error('Der Anhang ist nicht mehr da (Datei erneut ablegen).')
}

/** Beleg für den Einkauf: PDF bzw. Bild, bevorzugt mit „Rechnung“ im Namen. */
const billAttachment = (msg) => {
  const list = (msg.attachments || []).filter((a) => !a.inline && (/pdf/i.test(a.type) || /^image\//.test(a.type)))
  return list.find((a) => /rechnung|invoice|faktura/i.test(a.name)) || list[0] || null
}

// ---------------------------------------------------------------- Dateien und Text

async function addFiles(files) {
  const added = []
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    if (isOutlookMsg(file.name, head)) {
      G.hint = MSG_HINT
      continue
    }
    if (file.size > 30 * 1048576) {
      toast(`${file.name}: zu groß (höchstens 30 MB).`)
      continue
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let msg = null
    if (/\.eml$/i.test(file.name) || file.type === 'message/rfc822') msg = { ...parseEml(bytes), hash: hashOf(bytes), source: 'datei', loaded: true }
    else if (file.type === 'application/pdf' || /^image\//.test(file.type) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(file.name)) {
      const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg')
      msg = { messageId: '', hash: hashOf(bytes), source: 'datei', direct: true, loaded: true, from: { name: '', email: '' }, to: [], subject: file.name, date: nowIso(), text: '', attachments: [{ name: file.name, type, size: bytes.length, data: bytes, inline: false }] }
    } else if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
      const t = tidyText(new TextDecoder().decode(bytes))
      msg = { messageId: '', hash: hashOf(t), source: 'text', loaded: true, from: { name: '', email: '' }, to: [], subject: file.name, date: nowIso(), text: t, attachments: [] }
    } else {
      toast(`${file.name}: Bitte eine E-Mail (.eml), ein PDF oder ein Bild ablegen.`)
      continue
    }
    msg.id = messageKey(msg)
    added.push(addMessage(msg))
  }
  let changed = false
  for (const m of added) changed = remember(m) || changed
  if (changed) persist()
  if (added.length) {
    app.ui.pstSel = added[0].id
    app.ui.pstFilter = 'neu'
    G.hint = G.hint && added.length === files.length ? '' : G.hint
  }
  renderNow()
  if (added.length) toast(added.length === 1 ? `Erkannt: ${artLabel(proposal(added[0], entryOf(added[0].id)).art)}. Bitte prüfen.` : `${added.length} Nachrichten aufgenommen.`)
}

// ---------------------------------------------------------------- Übergaben

const run = async (name, data = {}, el = null) => (await ensureAction(name))?.(el || { dataset: data, files: [] })
/** Entwurf im gerade geöffneten Dialog ändern und neu zeichnen. */
function patch(type, fn) {
  if (app.ui.modal?.type !== type) return false
  if (!app.ui.modal.draft) renderModal()
  const m = app.ui.modal
  if (!m?.draft) return false
  fn(m.draft, m)
  renderModal()
  return true
}

const GO = {
  reklamation: async (pre) => {
    await run('complaint-new', { obj: pre.objectId, date: pre.date })
    return patch('complaint', (d) => Object.assign(d, { source: pre.source, kind: pre.kind, due: pre.due, text: pre.text, contact: pre.contact, received: pre.received || d.received, posteingang: pre.posteingang }))
  },
  angebot: async (pre) => {
    await run('fak-new', { kind: 'angebot', ...(pre.customerId ? { customer: pre.customerId } : {}) })
    return patch('fak-edit', (d) => {
      Object.assign(d, { title: pre.title, reference: pre.reference, posteingang: pre.posteingang })
      if (pre.objectId) Object.assign(d, { objectId: pre.objectId, objectName: objName(pre.objectId) })
      if (d.lines?.[0] && !d.lines[0].text) d.lines[0].text = pre.line
    })
  },
  regie: async (pre) => {
    await run('reg-new', { obj: pre.objectId })
    return patch('reg-edit', (d) => Object.assign(d, { kind: pre.kind, title: pre.title, description: pre.description, orderedBy: pre.orderedBy, orderedRole: pre.orderedRole, orderRef: pre.orderRef, posteingang: pre.posteingang }))
  },
  vertrieb: async (pre) => {
    await run('vt-new')
    return patch('vt-case', (d) => {
      Object.assign(d, { source: pre.source, requestDate: pre.requestDate, title: pre.title, note: pre.note, posteingang: pre.posteingang, lead: { ...(d.lead || {}), ...pre.lead }, site: { ...(d.site || {}), ...pre.site } })
      if (pre.customerId) d.customerId = pre.customerId
    })
  },
  termin: async (pre) => {
    await ensureModal('appt')
    openModal({ type: 'appt', draft: pre })
    return app.ui.modal?.type === 'appt'
  },
  kuendigung: async (pre, msg, e, el) => {
    const id = el?.dataset?.contract || ''
    await run('fvt-open', id ? { id } : pre.customerId ? { customer: pre.customerId } : {})
    if (app.ui.modal?.type !== 'fvt-edit') return false
    await run('fvt-cancel-open')
    const ok = patch('fvt-edit', (d) => {
      const earliest = earliestEnd({ ...d, cancel: null }, pre.at)
      d.cancel = { ...(d.cancel || {}), by: 'kunde', at: pre.at, to: pre.to && (!earliest || pre.to >= earliest) ? pre.to : earliest || d.cancel?.to || '', reason: pre.reason || d.cancel?.reason || '', posteingang: pre.posteingang }
    })
    if (ok && !id) toast('Für diesen Kunden ist noch kein Vertrag erfasst: bitte Beginn und Fristen eintragen, die Kündigung ist vorgemerkt.')
    return ok
  },
  einkauf: async (pre, msg) => {
    const att = billAttachment(msg)
    await run('ek-inv-new')
    const ok = patch('ek-inv', (d) => {
      Object.assign(d, { receivedAt: pre.receivedAt, posteingang: pre.posteingang, note: d.note || pre.note })
      if (pre.supplierId) d.supplierId = pre.supplierId
    })
    if (!ok) return false
    if (pre.supplierId) await run('ek-inv-supplier')
    if (att) {
      const bytes = await attachmentBytes(msg, att)
      await run('ek-inv-file', {}, { files: [new File([bytes], att.name, { type: att.type })], dataset: {} })
    }
    const ki = await kixCheck().catch(() => false)
    toast(att ? (ki ? 'Beleg angehängt: „Aus Beleg lesen (KI)“ füllt die Felder, dann prüfen und speichern.' : 'Beleg angehängt: Felder ausfüllen, prüfen und speichern.') : 'Ohne Beleg: bitte den Beleg im Dialog anhängen.')
    return true
  },
  bewerbung: async (pre, msg) => {
    await run('bew-edit-open', {})
    const files = []
    for (const att of (msg.attachments || []).filter((a) => !a.inline && /pdf|image|word|officedocument|opendocument|rtf/i.test(a.type)).slice(0, 6)) files.push(new File([await attachmentBytes(msg, att)], att.name, { type: att.type }))
    return patch('bew-edit', (d, m) => {
      Object.assign(d, { name: pre.name, email: pre.email, phone: pre.phone, source: pre.source, sourceNote: pre.sourceNote, notes: pre.notes, posteingang: pre.posteingang })
      m.pending = [...(m.pending || []), ...files]
    })
  },
  abwesenheit: async (pre, msg, e) => {
    PENDING.set(e.id, { kind: 'abwesenheit', before: new Set((app.data.absences || []).map((a) => a.id)), employeeId: pre.employeeId })
    await run('open-absence-new', { emp: pre.employeeId, date: pre.date, type: pre.absenceType })
    return app.ui.modal?.type === 'absence-new'
  },
}
const moduleOfKind = (kind) => Object.values(HANDOVERS).flat().find(([id]) => id === kind)?.[2] || ''

/** Angelegt? Übergaben mit gespeichertem Ziel als „erledigt“ mit Verweis führen. true: geändert. */
function syncPending() {
  if (!PENDING.size || !editable() || !app.data) return false
  let changed = false
  for (const [id, p] of PENDING) {
    const e = entryOf(id)
    if (!e || e.status !== 'neu') {
      PENDING.delete(id)
      continue
    }
    let link = null
    if (p.kind === 'abwesenheit') {
      const x = (app.data.absences || []).find((a) => !p.before.has(a.id) && (!p.employeeId || a.employeeId === p.employeeId))
      if (x) link = { kind: 'abwesenheit', id: x.id, label: 'Abwesenheit eingetragen' }
    } else link = findCreated(id, p.kind, app.data)
    if (!link) continue
    putEntry(setStatus(e, 'erledigt', { by: by(), at: nowIso(), link }))
    PENDING.delete(id)
    changed = true
  }
  return changed
}
let syncQueued = false
function queueSync() {
  if (syncQueued || !PENDING.size) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    if (syncPending()) {
      persist()
      if (app.ui.view === 'posteingang') renderNow()
      toast('Angelegt: Die Nachricht steht im Posteingang als erledigt.')
    }
  })
}
onModalRender(queueSync)
// Termin mit ref „pst:<Eintrag>“ gespeichert: gleich als erledigt führen
onAppointmentSaved((t) => {
  const id = String(t.ref || '').startsWith('pst:') ? t.ref.slice(4) : ''
  const e = id && entryOf(id)
  if (!e || e.status !== 'neu' || !editable()) return
  putEntry(setStatus(e, 'erledigt', { by: by(), at: nowIso(), link: findCreated(id, 'termin', app.data) || { kind: 'termin', id: t.id, label: 'Termin' } }))
  PENDING.delete(id)
})

/** Aktion und Daten zum Öffnen des Verweises (nur, wenn die Rolle den Bereich sieht). */
function linkAction(link) {
  if (!link?.id) return null
  const map = {
    reklamation: ['reklamationen', 'complaint-open'],
    angebot: ['fakturierung', 'fak-open'],
    regie: ['regie', 'reg-open'],
    vertrieb: ['vertrieb', 'vt-goto'],
    termin: ['termine', 'appt-open'],
    kuendigung: ['fakturierung', 'fvt-goto'],
    einkauf: ['einkauf', 'ek-inv-open'],
    bewerbung: ['bewerber', 'bew-open'],
  }
  const [module, action] = map[link.kind] || []
  return action && sees(module) ? { action, id: link.id } : null
}

// ---------------------------------------------------------------- Ansicht

const fromText = (e, m) => (m ? m.from?.name || m.from?.email || (m.source === 'text' ? 'eingefügter Text' : m.direct ? 'Datei' : '') : e.masked ? 'Absender ausgeblendet' : String(e.from || '').replace(/\s*<[^>]*>\s*$/, '') || e.from || '') || '–'
const subjectText = (e, m) => (m?.subject || (e.masked ? (e.art === 'krankmeldung' ? 'Krankmeldung' : 'Betreff ausgeblendet') : e.subject) || '(ohne Betreff)')
const artPill = (art) => `<span class="pill ${ART_CLS[art] || ''}">${esc(artLabel(art))}</span>`

/** Einträge der Ablage und Nachrichten ohne Eintrag (Rolle ohne Bearbeiten, noch nicht gespeichert). */
function allRows() {
  const items = D().items
  const known = new Set(items.map((x) => x.id))
  const extra = [...MSGS.values()].filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, from: addressText(m.from), subject: m.subject, date: m.date, art: analysis(m).art, artBy: 'regel', status: 'neu', transient: true }))
  return [...items, ...extra]
}

function rowHtml(e, selected) {
  const m = MSGS.get(e.id)
  const p = proposal(m, e)
  const where = [p.customerId && custName(p.customerId), p.objectId && objName(p.objectId)].filter(Boolean).join(' · ')
  return `<button type="button" class="pst-row${selected ? ' sel' : ''}${e.status !== 'neu' ? ' done' : ''}" data-action="pst-open" data-id="${esc(e.id)}" aria-pressed="${selected ? 'true' : 'false'}">
    <span class="pst-row-top"><strong class="pst-from">${esc(fromText(e, m))}</strong><span class="pst-date muted">${esc(when(e.date))}</span></span>
    <span class="pst-subj">${esc(subjectText(e, m))}</span>
    <span class="pst-tags">${artPill(p.art)}${m?.ki ? '<span class="kix-tag">KI</span>' : ''}${e.status !== 'neu' ? `<span class="pill ok">${esc(STATUS_LABEL[e.status])}</span>` : ''}${(m?.ki?.urgency || p.a?.urgency) === 'hoch' && e.status === 'neu' ? '<span class="pill error">dringend</span>' : ''}${where ? `<span class="pst-where muted">${esc(where)}</span>` : ''}${!m && e.status === 'neu' ? '<span class="pst-where muted">Inhalt nicht geladen</span>' : ''}</span>
  </button>`
}

function kiHtml(m) {
  if (m.kiError) return `<p class="err-text">${esc(m.kiError)}</p>`
  const k = m.ki
  if (!k) return ''
  const fields = (FIELDS_BY_ART[k.art] || []).filter(([key]) => k.fields[key]).map(([key, label]) => `<dt>${esc(label)}</dt><dd>${esc(key === 'datum' ? formatDate(k.fields[key]) : k.fields[key])}</dd>`).join('')
  return `<div class="pst-ki"><p><span class="kix-tag">KI</span> <strong>${esc(artLabel(k.art))}</strong>${k.urgency !== 'normal' ? ` <span class="pill ${k.urgency === 'hoch' ? 'error' : ''}">Dringlichkeit ${esc(k.urgency)}</span>` : ''}</p>
    ${k.summary ? `<p>${esc(k.summary)}</p>` : ''}${fields ? `<dl class="pst-dl">${fields}</dl>` : ''}${k.reason ? `<p class="muted small">Begründung: ${esc(k.reason)}</p>` : ''}
    ${k.problems.filter((x) => x.level !== 'info').map((x) => `<p class="warn-text small">${esc(x.text)}</p>`).join('')}<p class="note">Vorschlag der KI – bitte prüfen. Angelegt wird erst im Zielbereich.</p></div>`
}

function handoverHtml(e, m, p) {
  if (!editable() || e.status !== 'neu' || !m) return ''
  const may = (module) => canEdit(module) && !app.readOnly
  const list = handoversFor(p.art, may)
  const btn = (h, extra = '', label = h.label) => `<button type="button" class="btn primary" data-action="pst-go" data-id="${esc(e.id)}" data-kind="${esc(h.id)}"${extra}>${esc(label)}</button>`
  const parts = []
  for (const h of list) {
    if (h.id !== 'kuendigung') {
      parts.push(btn(h))
      continue
    }
    const today = todayISO()
    const contracts = p.customerId ? (app.data.fakturierung?.contracts || []).filter((c) => c.customerId === p.customerId && contractStatus(c, today).status !== 'beendet') : []
    if (contracts.length > 1) for (const c of contracts) parts.push(btn(h, ` data-contract="${esc(c.id)}"`, `Kündigung vormerken: ${c.no || ''} ${c.title || ''}`.trim()))
    else parts.push(btn(h, contracts[0] ? ` data-contract="${esc(contracts[0].id)}"` : '', contracts[0] ? `Kündigung vormerken: ${contracts[0].no || 'Vertrag'}` : 'Kündigung vormerken (neuer Vertrag)'))
  }
  if (p.art === 'krankmeldung') parts.push(`<button type="button" class="btn" data-action="pst-hr" data-id="${esc(e.id)}">${ICON.send} Personalverwaltung informieren</button>`)
  const missing = (HANDOVERS[p.art] || []).filter(([, , module]) => !may(module))
  const blocked = kiBlocked(m, p.a)
  const kiBtn = !blocked ? kixButton(`<button type="button" class="btn kix-btn" data-action="pst-ki" data-id="${esc(e.id)}">${m.ki ? 'Noch einmal mit KI erkennen' : 'Mit KI erkennen'}</button>`) : ''
  return `<div class="actions pst-go">${parts.join('')}${kiBtn}<button type="button" class="btn" data-action="pst-done" data-id="${esc(e.id)}">Erledigt</button><button type="button" class="btn ghost" data-action="pst-ignore" data-id="${esc(e.id)}">Ignorieren</button></div>
    ${missing.length ? `<p class="muted small">Ohne Recht in ${esc(missing.map(([, label]) => label.replace(/ (anlegen|erfassen|vormerken|eintragen).*$/, '')).join(', '))}: bitte an die zuständige Person weitergeben.</p>` : ''}`
}

function detailHtml(e) {
  if (!e) return '<p class="muted pst-empty">Links eine Nachricht wählen.</p>'
  const m = MSGS.get(e.id)
  const p = proposal(m, e)
  if (m && m.source === 'graph' && !m.loaded && !m.loading && !m.error) ensureBody(m).then(() => app.ui.view === 'posteingang' && renderNow())
  const status =
    e.status !== 'neu'
      ? `<div class="pst-status"><p><span class="pill ok">${esc(STATUS_LABEL[e.status])}</span> ${e.at ? `am ${esc(when(e.at))}` : ''}${e.by ? ` von ${esc(e.by)}` : ''}${e.link ? ` · ${esc(e.link.label)}` : ''}</p><div class="actions">${linkAction(e.link) ? `<button type="button" class="btn small" data-action="pst-link" data-id="${esc(e.id)}">Öffnen</button>` : ''}${editable() ? `<button type="button" class="btn small ghost" data-action="pst-reopen" data-id="${esc(e.id)}">Wieder öffnen</button>` : ''}</div></div>`
      : ''
  const health = p.a?.health || p.art === 'krankmeldung'
  const banners = `${health ? '<div class="banner warn-banner"><p><strong>Gesundheitsdaten:</strong> Diese Nachricht geht nicht an die KI. Absender und Betreff werden im Posteingang nicht gespeichert. Krankmeldungen bearbeitet die Personalverwaltung.</p></div>' : ''}${!health && p.a?.personal ? '<p class="note">Nachricht aus dem Team (Personalsache): geht nicht an die KI.</p>' : ''}`
  if (!m)
    return `<h3 class="pst-subject">${esc(subjectText(e, m))}</h3><p class="muted">${esc(fromText(e, m))} · ${esc(when(e.date))} · ${artPill(e.art)}</p>${status}
      <p class="note">Mailtext und Anhänge speichert der Posteingang nicht. ${e.source === 'graph' ? 'Die Nachricht ist im eingestellten Ausschnitt des Postfachs nicht mehr dabei (gelesen oder älter): in Outlook öffnen.' : 'Zum Bearbeiten die Datei erneut ablegen bzw. den Text erneut einfügen.'}</p>
      ${editable() && e.status === 'neu' ? `<div class="actions"><button type="button" class="btn" data-action="pst-done" data-id="${esc(e.id)}">Erledigt</button><button type="button" class="btn ghost" data-action="pst-ignore" data-id="${esc(e.id)}">Ignorieren</button></div>` : ''}`
  const customers = sees('fakturierung') ? (app.data.fakturierung?.customers || []).slice().sort((x, y) => customerName(x).localeCompare(customerName(y), 'de')) : []
  const objects = (app.data.objects || []).filter((o) => o.active !== false)
  const dis = editable() && e.status === 'neu' ? '' : 'disabled'
  const atts = (m.attachments || [])
    .map((a, i) => `<button type="button" class="pill pst-att" data-action="pst-att" data-id="${esc(e.id)}" data-i="${i}" title="${esc(a.name)} öffnen">${ICON.download} ${esc(a.name)} <span class="muted">${esc(sizeText(a.size || 0))}${a.inline ? ', im Text' : ''}</span></button>`)
    .join('')
  const meta = [
    ['Von', addressText(m.from) || (m.source === 'text' ? 'eingefügter Text' : m.direct ? 'Datei direkt abgelegt' : '–')],
    m.to?.length ? ['An', m.to.map(addressText).join(', ')] : null,
    ['Datum', when(m.date)],
    ['Quelle', `${SOURCE_LABEL[m.source] || m.source}${m.source === 'graph' && m.mailbox ? ` ${m.mailbox}` : ''}`],
  ].filter(Boolean)
  return `<h3 class="pst-subject">${esc(subjectText(e, m))}</h3>
    <dl class="pst-dl pst-meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${status}${banners}
    <section class="pst-proposal" aria-label="Vorschlag">
      <p>${artPill(p.art)} <span class="muted small">${e.artBy === 'person' ? 'von dir gewählt' : e.artBy === 'ki' ? 'von der KI erkannt' : `nach Regeln: ${esc((p.a?.reasons || []).join(' · '))}`}</span></p>
      ${kiHtml(m)}
      <div class="form-grid pst-pick">
        <label class="field"><span>Art</span><select id="pst-art-${esc(e.id)}" data-change="pst-art" data-id="${esc(e.id)}" ${dis}>${options(PE_ARTEN.map((a) => [a, ART_LABEL[a]]), p.art)}</select></label>
        ${customers.length ? `<label class="field"><span>Kunde</span><select id="pst-cust-${esc(e.id)}" data-change="pst-pick" data-id="${esc(e.id)}" data-key="customerId" ${dis}>${options(customers.map((c) => [c.id, customerName(c)]), p.customerId, { empty: '– keiner –' })}</select></label>` : ''}
        <label class="field"><span>Objekt</span><select id="pst-obj-${esc(e.id)}" data-change="pst-pick" data-id="${esc(e.id)}" data-key="objectId" ${dis}>${options(objects.map((o) => [o.id, o.name]), p.objectId, { empty: '– keines –' })}</select></label>
      </div>
      ${handoverHtml(e, m, p)}
    </section>
    <h4>Text</h4>
    ${m.loading ? '<p class="muted">Wird aus dem Postfach geladen …</p>' : m.error ? `<p class="err-text">${esc(m.error)}</p>` : m.text ? `<div class="pst-text" tabindex="0">${esc(m.text)}</div>` : `<p class="muted">${m.direct ? 'Datei ohne Text (Beleg).' : m.preview ? esc(m.preview) : 'Kein Text.'}</p>`}
    ${atts ? `<h4>Anhänge</h4><div class="pst-atts">${atts}</div>` : m.hasAttachments && !m.loaded ? '<p class="muted small">Anhänge werden mit der Nachricht geladen.</p>' : ''}`
}

function view() {
  const filter = app.ui.pstFilter || 'neu'
  const ed = editable()
  if (!G.started) {
    G.started = true
    if (graphOn() || demoOn()) refresh()
    else if (cleanup()) queueMicrotask(persist)
  }
  queueSync()
  if (ed) kixCheck()
  const all = allRows()
  const list = filterEntries(all, filter)
  if (app.ui.pstSel && !all.some((x) => x.id === app.ui.pstSel)) app.ui.pstSel = ''
  const selId = app.ui.pstSel || ''
  const sel = all.find((x) => x.id === selId) || null
  const counts = { neu: all.filter((x) => x.status === 'neu').length, erledigt: all.filter((x) => x.status !== 'neu').length, alle: all.length }
  const tab = (v, label) => `<button class="btn small ${filter === v ? 'primary' : ''}" data-action="pst-filter" data-v="${v}" aria-pressed="${filter === v}">${label} <span class="muted">${counts[v]}</span></button>`
  const s = S()
  const newWithText = [...MSGS.values()].filter((m) => entryOf(m.id)?.status !== 'erledigt' && entryOf(m.id)?.status !== 'ignoriert' && !m.ki && (m.loaded ? !kiBlocked(m, analysis(m)) : m.source === 'graph' && !analysis(m).health && !analysis(m).personal))
  const source = graphOn()
    ? `Postfach ${esc(mailbox() || app.user?.email || '')}, Ordner ${esc(s.folder === 'inbox' ? 'Posteingang' : s.folder)}, letzte ${s.days} Tage${s.unreadOnly ? ', nur ungelesene' : ''}${G.at ? ` · gelesen ${esc(new Date(G.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }))}` : ''}`
    : demoOn()
      ? 'Beispiel-Postfach (Browser-Modus, erfundene Nachrichten)'
      : mailboxOn()
        ? 'Postfach nur mit Microsoft-Anmeldung'
        : 'Ohne Postfach: Dateien ablegen oder Text einfügen'
  const missing = G.missing
    ? `<div class="banner warn-banner pst-right"><p><strong>Für das Postfach fehlt die Berechtigung „${esc(G.missing.scope)}“.</strong> In Entra (App-Registrierung → API-Berechtigungen → Microsoft Graph → Delegiert) „${esc(G.missing.scope)}“ hinzufügen und die Administratorzustimmung erteilen${mailbox() ? `; für das Sammelpostfach ${esc(mailbox())} braucht die Person außerdem Leserechte darauf` : ''}. Bis dahin: Dateien ablegen oder Text einfügen.</p>${app.auth?.reauth ? '<button class="btn primary small" data-action="pst-consent">Zustimmen</button>' : ''}</div>`
    : ''
  return `<div class="section-head"><div><h2>Posteingang</h2><p>E-Mails und Belege: Die App erkennt, worum es geht, und bereitet einen Entwurf im richtigen Bereich vor. Angelegt wird erst, wenn du dort prüfst und speicherst.</p></div>
      <div class="actions">${graphOn() || demoOn() ? `<button class="btn" data-action="pst-refresh" ${G.loading ? 'disabled' : ''}>${ICON.refresh} ${G.loading ? 'Liest …' : 'Aktualisieren'}</button>` : ''}${ed && newWithText.length ? kixButton(`<button class="btn kix-btn" data-action="pst-ki-all">Alle neuen erkennen (${newWithText.length})</button>`) : ''}${ed ? `<button class="btn" data-action="pst-text-open">${ICON.plus} Text einfügen</button>` : ''}<button class="btn ghost" data-action="pst-settings-open">${ICON.gear} Einstellungen</button></div></div>
    ${missing}${G.error && !G.missing ? `<div class="banner warn-banner"><p>${esc(G.error)}</p></div>` : ''}${G.hint ? `<div class="banner warn-banner pst-hint" role="alert"><p>${esc(G.hint)}</p><button class="btn small" data-action="pst-hint-close">Verstanden</button></div>` : ''}
    <p class="muted small pst-source">${source}</p>
    ${ed ? `<label class="pst-drop" data-pst-drop><input type="file" id="pst-files" multiple accept=".eml,message/rfc822,.msg,application/pdf,image/*,.txt,text/plain" data-change="pst-file" hidden><span>${ICON.upload} <strong>Dateien hier ablegen</strong> oder <span class="link-like">auswählen</span></span><span class="muted small">E-Mail als .eml (mit Anhängen), PDF oder Foto eines Belegs. Outlook-.msg bitte als .eml speichern oder den Text einfügen.</span></label>` : ''}
    <div class="filters pst-filters">${tab('neu', 'Neu')}${tab('erledigt', 'Erledigt')}${tab('alle', 'Alle')}</div>
    <div class="pst-layout">
      <div class="pst-list" aria-label="Nachrichten">${list.length ? list.map((e) => rowHtml(e, e.id === selId)).join('') : `<p class="empty">${filter === 'neu' ? (G.loading ? 'Liest das Postfach …' : 'Keine neuen Nachrichten.') : 'Keine Nachrichten.'}</p>`}</div>
      <section class="pst-detail" aria-live="polite">${detailHtml(sel)}</section>
    </div>`
}

registerView({
  id: 'posteingang',
  order: 5,
  label: 'Posteingang',
  group: 'start',
  section: 'start',
  module: MODULE,
  noWeek: true,
  icon: ICON_PE,
  text: 'E-Mails und Belege erkennen, Entwurf im richtigen Bereich',
  badge: () => newCount(D().items),
  render: view,
})

// ---------------------------------------------------------------- Dialoge

function textModal(c, m) {
  return modalFrame({
    title: 'Text einfügen',
    subtitle: 'z. B. aus einer Outlook-Nachricht kopiert',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Absender (optional)</span><input type="text" id="pst-t-from" value="${esc(m.from || '')}" placeholder="Name <adresse@firma.at>" autocomplete="off"></label>
        <label class="field"><span>Betreff (optional)</span><input type="text" id="pst-t-subject" value="${esc(m.subject || '')}"></label>
        <label class="field wide"><span>Text</span><textarea id="pst-t-text" rows="10">${esc(m.text || '')}</textarea></label>
      </div><p class="note">Der Text bleibt nur auf diesem Gerät; gespeichert werden Absender, Betreff, Datum und die erkannte Art.</p>`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="pst-text-save">Erkennen</button>',
  })
}
registerModal('pst-text', textModal, { module: MODULE })

function settingsModal() {
  const s = S()
  const dis = editable() ? '' : 'disabled'
  return modalFrame({
    title: 'Posteingang: Einstellungen',
    body: `<div class="form-grid">
        <label class="field"><span>Ordner im Postfach</span><input type="text" id="pst-set-folder" value="${esc(s.folder === 'inbox' ? 'Posteingang' : s.folder)}" ${dis}></label>
        <label class="field"><span>Zeitraum: letzte Tage</span><input type="number" id="pst-set-days" min="1" max="90" value="${s.days}" ${dis}></label>
        <label class="check wide"><input type="checkbox" id="pst-set-unread" ${s.unreadOnly ? 'checked' : ''} ${dis}><span>Nur ungelesene Nachrichten</span></label>
        <label class="field"><span>Erledigte entfernen nach Tagen</span><input type="number" id="pst-set-keep" min="7" max="3650" value="${s.keepDays}" ${dis}></label>
      </div>
      <p class="note">Postfach: ${mailboxOn() ? esc(mailbox() || 'das eigene der angemeldeten Person') : 'nicht eingerichtet (config.json → features.posteingang)'}. Die App liest nur: nichts wird verschoben, gelöscht oder als gelesen markiert. Erledigte und ignorierte Einträge (nur Kennung, Absender, Betreff, Art) werden nach der Frist entfernt.</p>`,
    foot: `<button class="btn" data-action="close-modal">${editable() ? 'Abbrechen' : 'Schließen'}</button>${editable() ? '<button class="btn primary" data-action="pst-settings-save">Speichern</button>' : ''}`,
  })
}
registerModal('pst-settings', settingsModal, { module: MODULE })

function kiModal(c, m) {
  const list = m.ids.map((id) => MSGS.get(id)).filter(Boolean)
  const rows = list
    .map((msg) => {
      const r = m.results?.[msg.id]
      const st = r?.ok ? `<span class="pill ok">${esc(r.ok)}</span>` : r?.error ? `<span class="err-text">${esc(r.error)}</span>` : r?.skip ? `<span class="muted">${esc(r.skip)}</span>` : m.running ? '<span class="muted">wartet …</span>' : ''
      return `<li><span class="pst-ki-subj">${esc(subjectText(entryOf(msg.id) || {}, msg))}</span> ${st}</li>`
    })
    .join('')
  return modalFrame({
    title: list.length === 1 ? 'Mit KI erkennen' : `${list.length} Nachrichten mit KI erkennen`,
    wide: true,
    body: `<p class="note">Gesendet wird je Nachricht nur: Betreff und Text (ohne zitierte frühere Nachrichten, höchstens ${KI_LIMITS.mailChars} Zeichen; E-Mail-Adressen, Telefonnummern und IBAN ausgeblendet), Anzahl und Art der Anhänge sowie als Auswahl Kennung und Name passender Kunden und Objekte. Nicht gesendet werden Absender, Anhänge und Beträge. Krankmeldungen und Nachrichten aus dem Team gehen nie an die KI.</p>
      <ul class="pst-ki-list">${rows}</ul>${kixBox('pst')}`,
    foot: `<button class="btn" data-action="close-modal">${m.done ? 'Schließen' : 'Abbrechen'}</button>${m.done ? '' : `<button class="btn primary" data-action="pst-ki-run" ${m.running ? 'disabled' : ''}>Jetzt erkennen</button>`}`,
  })
}
registerModal('pst-ki', kiModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

function bindDrop() {
  if (bindDrop.done || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  bindDrop.done = true
  const zone = (e) => e.target?.closest?.('[data-pst-drop]')
  const files = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
  document.addEventListener('dragover', (e) => {
    const z = zone(e)
    if (!z || !files(e)) return
    e.preventDefault()
    z.classList.add('drop-on')
  })
  document.addEventListener('dragleave', (e) => zone(e)?.classList.remove('drop-on'))
  document.addEventListener('drop', (e) => {
    const z = zone(e)
    if (!z) return
    e.preventDefault()
    z.classList.remove('drop-on')
    const list = [...(e.dataTransfer?.files || [])]
    if (list.length) ACTIONS['pst-file']?.({ files: list, dataset: {} })
  })
}
bindDrop()

registerActions({
  'pst-filter': (el) => {
    app.ui.pstFilter = el.dataset.v
    renderNow()
  },
  'pst-open': (el) => {
    app.ui.pstSel = el.dataset.id
    renderNow()
    // am Handy: zu den Details unter der Liste
    if (typeof document !== 'undefined' && document.body.classList.contains('mobile')) document.querySelector('.pst-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  },
  'pst-goto': () => {
    closeModal()
    app.ui.view = 'posteingang'
    app.ui.pstFilter = 'neu'
    renderNow()
  },
  'pst-refresh': () => {
    if (!graphOn() && !demoOn()) return
    refresh()
    renderNow()
  },
  'pst-hint-close': () => {
    G.hint = ''
    renderNow()
  },
  'pst-consent': () => app.auth?.reauth?.([mailScope(app.config)]),
  'pst-settings-open': () => openModal({ type: 'pst-settings' }),
  'pst-att': async (el) => {
    const m = MSGS.get(el.dataset.id)
    const att = m?.attachments?.[Number(el.dataset.i)]
    if (!att) return
    try {
      const blob = new Blob([await attachmentBytes(m, att)], { type: att.type })
      if (/pdf|^image\//.test(att.type)) window.open(URL.createObjectURL(blob), '_blank', 'noopener')
      else download(att.name, blob)
    } catch (err) {
      toast(err.message)
    }
  },
  'pst-link': async (el) => {
    const a = linkAction(entryOf(el.dataset.id)?.link)
    if (a) (await ensureAction(a.action))?.({ dataset: { id: a.id } })
  },
})

registerActions(
  {
    'pst-file': async (el) => {
      const list = [...(el.files || [])]
      if (!list.length) return
      await addFiles(list)
      if (el.value !== undefined) el.value = ''
    },
    'pst-text-open': () => openModal({ type: 'pst-text' }),
    'pst-text-save': () => {
      const t = tidyText(val('pst-t-text'))
      if (!t) return toast('Bitte den Text einfügen.')
      const fromRaw = val('pst-t-from').trim()
      const from = parseAddressList(fromRaw)[0] || { name: fromRaw, email: '' }
      const msg = { messageId: '', hash: hashOf(`${fromRaw}\n${val('pst-t-subject')}\n${t}`), source: 'text', loaded: true, from, to: [], subject: tidyText(val('pst-t-subject')), date: nowIso(), text: t, attachments: [] }
      msg.id = messageKey(msg)
      addMessage(msg)
      if (remember(MSGS.get(msg.id))) persist()
      app.ui.pstSel = msg.id
      app.ui.pstFilter = 'neu'
      closeModal()
      renderNow()
      toast(`Erkannt: ${artLabel(proposal(MSGS.get(msg.id), entryOf(msg.id)).art)}. Bitte prüfen.`)
    },
    'pst-settings-save': () => {
      const folderRaw = val('pst-set-folder').trim()
      D().settings = {
        ...D().settings,
        folder: !folderRaw || /^posteingang$|^inbox$/i.test(folderRaw) ? 'inbox' : folderRaw,
        days: Number(val('pst-set-days')) || 14,
        unreadOnly: checked('pst-set-unread'),
        keepDays: Number(val('pst-set-keep')) || 180,
      }
      G.folder = null
      if (cleanup()) toast('Alte erledigte Einträge entfernt.')
      persist()
      closeModal()
      if (graphOn()) refresh()
      renderNow()
    },
    'pst-art': (el) => {
      const e = entryOf(el.dataset.id)
      if (!e) return
      putEntry(setArt(e, el.value, 'person'))
      persist()
      renderNow()
    },
    'pst-pick': (el) => {
      const m = MSGS.get(el.dataset.id)
      if (!m) return
      m.choice = { ...proposalChoice(m), [el.dataset.key]: el.value }
      renderNow()
    },
    'pst-done': (el) => {
      const e = entryOf(el.dataset.id)
      if (!e) return
      putEntry(setStatus(e, 'erledigt', { by: by(), at: nowIso() }))
      PENDING.delete(e.id)
      persist()
      renderNow()
      toast('Als erledigt markiert.')
    },
    'pst-ignore': (el) => {
      const e = entryOf(el.dataset.id)
      if (!e) return
      putEntry(setStatus(e, 'ignoriert', { by: by(), at: nowIso() }))
      PENDING.delete(e.id)
      persist()
      renderNow()
    },
    'pst-reopen': (el) => {
      const e = entryOf(el.dataset.id)
      if (!e) return
      putEntry(setStatus(e, 'neu'))
      persist()
      renderNow()
    },
    'pst-go': async (el) => {
      const e = entryOf(el.dataset.id)
      const m = MSGS.get(el.dataset.id)
      const kind = el.dataset.kind
      if (!e || !m || !GO[kind]) return toast('Die Nachricht ist nicht geladen.')
      const module = moduleOfKind(kind)
      if (module && !canEdit(module)) return toast('Dafür fehlt dir das Recht im Zielbereich.')
      await ensureBody(m)
      const p = proposal(m, e)
      const pre = prefillFor(kind, m, { a: p.a, ki: m.ki, choice: { customerId: p.customerId, objectId: p.objectId }, today: todayISO(), entryId: e.id })
      if (kind !== 'abwesenheit') PENDING.set(e.id, { kind })
      try {
        const ok = await GO[kind](pre, m, e, el)
        if (!ok) PENDING.delete(e.id)
      } catch (err) {
        PENDING.delete(e.id)
        toast(err.message || String(err))
      }
    },
    'pst-hr': (el) => {
      const e = entryOf(el.dataset.id)
      const m = MSGS.get(el.dataset.id)
      if (!e) return
      const emp = (app.data.employees || []).find((x) => x.id === (m ? analysis(m).employeeId : ''))
      const name = emp?.name || m?.from?.name || 'einer Person aus dem Team'
      openCompose({
        to: String(app.config?.posteingang?.personal || ''),
        subject: 'Krankmeldung eingegangen',
        text: `Hallo,\n\nim Posteingang ist am ${formatDate(dayOf(e.date || nowIso()))} eine Krankmeldung von ${name} eingegangen. Bitte die Abwesenheit eintragen und die Bestätigung ablegen.\n\nDer Inhalt der Nachricht steht im Postfach, nicht in dieser E-Mail.\n\n${by()}`,
        origin: 'Posteingang',
      })
    },
    'pst-ki': async (el) => {
      const m = MSGS.get(el.dataset.id)
      if (!m) return
      openModal({ type: 'pst-ki', ids: [m.id], results: {} })
      return ACTIONS['pst-ki-run']?.({ dataset: {} })
    },
    'pst-ki-all': async () => {
      const ids = [...MSGS.values()].filter((m) => entryOf(m.id)?.status !== 'erledigt' && entryOf(m.id)?.status !== 'ignoriert' && !m.ki && !(m.loaded && kiBlocked(m, analysis(m))) && !analysis(m).health && !analysis(m).personal).map((m) => m.id).slice(0, 20)
      if (!ids.length) return toast('Keine neuen Nachrichten für die KI.')
      openModal({ type: 'pst-ki', ids, results: {} })
      return ACTIONS['pst-ki-run']?.({ dataset: {} })
    },
    'pst-ki-run': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'pst-ki' || m.running || m.done) return
      if (!el?.dataset?.consent && !kixConsent('pst', 'Betreff und Text der Nachricht (gekürzt, ohne Absender, E-Mail-Adressen und Telefonnummern) mit Kennung und Namen passender Kunden und Objekte', { action: 'pst-ki-run' })) return
      m.running = true
      m.results ||= {}
      kixSet('pst', { busy: 'Die KI ordnet die Nachrichten ein …' })
      renderModal()
      let stop = false
      try {
        const { classifyMail } = await import('../../ai/extract.js')
        for (const id of m.ids) {
          if (app.ui.modal !== m || stop) break
          const msg = MSGS.get(id)
          if (!msg) continue
          try {
            await ensureBody(msg)
            const a = analysis(msg)
            const blocked = kiBlocked(msg, a)
            if (blocked) {
              m.results[id] = { skip: blocked }
              continue
            }
            const res = await classifyMail(msg, { ctx: ctx(), rule: a, today: todayISO() })
            msg.ki = res
            msg.kiError = ''
            const e = entryOf(id)
            if (e && editable() && e.status === 'neu') putEntry(setArt(e, res.art, 'ki'))
            m.results[id] = { ok: artLabel(res.art) }
          } catch (err) {
            m.results[id] = { error: kixFailed(err) }
            if (['limit', 'setup', 'auth', 'net'].includes(err?.code)) stop = true
          }
          if (app.ui.modal === m) renderModal()
        }
      } finally {
        m.running = false
        m.done = true
        persist()
        if (app.ui.modal === m) {
          kixSet('pst', {})
          renderModal()
        }
        renderNow()
      }
    },
  },
  { edit: MODULE },
)

/** Kunde und Objekt, wie gerade vorgeschlagen (für die Wahl der Person). */
function proposalChoice(m) {
  const p = proposal(m, entryOf(m.id))
  return { customerId: p.customerId, objectId: p.objectId }
}

// ---------------------------------------------------------------- Zu erledigen, Hintergrund

registerTodo({
  id: 'posteingang',
  module: MODULE,
  title: 'Posteingang',
  // nur mit eingerichtetem Postfach; die Kennung ändert sich mit der neuesten Nachricht (dann wieder gemeldet)
  compute: () => {
    if (!mailboxOn() || !app.data) return []
    const open = D().items.filter((x) => x.status === 'neu')
    if (!open.length) return []
    const newest = open.reduce((a, b) => (String(b.date) > String(a.date) ? b : a))
    return [{ id: `neu:${newest.id}`, n: open.length }]
  },
  render: (list) =>
    list
      .map((x) => `<div class="todo-item"><span class="flag info">${x.n}</span><div class="todo-text"><strong>${x.n === 1 ? '1 neue Nachricht' : `${x.n} neue Nachrichten`} im Posteingang</strong><br><span class="muted">Erkennen und als Entwurf im richtigen Bereich anlegen.</span></div><button class="btn small primary" data-action="pst-goto">Öffnen</button></div>`)
      .join(''),
})

// Postfach im Hintergrund lesen (nach dem Laden des Moduls, dann alle 10 Minuten, nur sichtbares Fenster): „Zu
// erledigen“ und der Zähler im Menü stimmen dann, ohne dass jemand die Ansicht öffnet
if (typeof setTimeout === 'function')
  setTimeout(() => {
    if (graphOn() && sees(MODULE)) {
      G.started = true
      refresh()
    }
  }, 2000)
if (typeof setInterval === 'function')
  setInterval(() => {
    if (graphOn() && sees(MODULE) && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) refresh()
  }, 600e3)
