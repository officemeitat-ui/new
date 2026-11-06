// Fakturierung und Kundenbereich: „Online-Annahme“ für Angebote und Rechnungen je Link des Kundenbereichs.
//
// Online-Annahme: Für ein festgeschriebenes Angebot erstellt die App einen eigenen Code und überträgt Kopfdaten
// und PDF an den Webspace (kunden.php?a=CODE, gültig bis „gültig bis“ des Angebots). Der Link geht per E-Mail
// (Senden-Fenster) oder kopiert an den Kunden. Die Annahme holt customer-portal.js ab (wie die Reklamationen);
// sie steht in doc.acceptance, außerhalb der Prüfsumme. Verbraucher nur mit Einstellung (FAGG).
// Codes stehen wie die Links des Kundenbereichs in kundenbereich/kundenbereich.json (offers), nicht in der
// Fakturierung: Sie wirken wie Passwörter.
//
// Rechnungen im Kundenbereich: portalInvoices(link) liefert je Beleg, was der Webspace speichert, samt PDF (wie
// beim Versand) und QR-Code als PNG (derselbe Kodierer wie im PDF, pdfmake).
//
// Mit invoicing.js geladen (views/lazy.js). Rechenkern: core/customer-invoices.js.

import { todayISO } from '../../core/dates.js'
import { invoiceEntry, invoiceQrPayload, invoiceSettings, invoiceSigText, newOfferId, offerLink, offerMail, offerPayload, onlineActive, onlineCheck, portalDocuments, qrMatrixFromCanvas, withdrawNeeded } from '../../core/customer-invoices.js'
import { deDate, greetingOf, round2, settingsOf } from '../../core/invoicing.js'
import { newCode, sha256Hex } from '../../core/staffplan.js'
import { app, canEdit, confirmStep, ensureView, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { invalidateTodo, refreshBell } from '../modals/todo.js'
import { loadPdfMake } from '../pdf.js'
import { checked, esc, euro, ICON, modalFrame } from '../shared.js'
import { portalAddress, portalCall, portalOffers, portalReady, syncAcceptances } from './customer-portal.js'
import { laeufeHooks } from './invoicing-laeufe.js'

const MODULE = 'fakturierung'
const F = () => app.data.fakturierung
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const custOf = (id) => (F()?.customers || []).find((c) => c.id === id)
const docOf = (id) => (F()?.documents || []).find((d) => d.id === id)
const money = (n) => euro(round2(n))
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const record = (x, text) => (x.history = [...(x.history || []), { at: nowIso(), by: by(), text }])
const offerOf = (x) => (x?.online?.id ? portalOffers().find((o) => o.id === x.online.id) : null)
const urlOf = (o) => offerLink(portalAddress(), o.token)

// ---------------------------------------------------------------- QR-Code als Bild (für den Webspace)

const qrCache = new Map()

/**
 * EPC-QR-Code als PNG (Base64). Derselbe Kodierer wie im PDF: pdfmake misst den QR-Knoten und legt die Module
 * als Rechtecke in node._canvas; daraus wird ein Bild mit Ruhezone (4 Module, 6 px je Modul).
 */
export async function qrPng(payload) {
  if (!payload) return ''
  if (qrCache.has(payload)) return qrCache.get(payload)
  const pdfMake = await loadPdfMake()
  const node = { qr: payload, fit: 400, eccLevel: 'M' }
  await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf({ pageSize: { width: 460, height: 460 }, pageMargins: 0, content: [node] }).getBlob(resolve)
    } catch (err) {
      reject(err)
    }
  })
  const m = qrMatrixFromCanvas(node._canvas)
  if (!m) return ''
  const scale = 6
  const quiet = 4
  const size = (m.length + quiet * 2) * scale
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, size, size)
  g.fillStyle = '#000000'
  m.forEach((row, y) => row.forEach((on, x) => on && g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)))
  const b64 = c.toDataURL('image/png').split(',')[1] || ''
  if (qrCache.size > 200) qrCache.delete(qrCache.keys().next().value)
  qrCache.set(payload, b64)
  return b64
}

// ---------------------------------------------------------------- Rechnungen im Kundenbereich

/**
 * Belege eines Links für den Webspace: Einträge wie in core/customer-invoices.js (invoiceEntry) mit QR-Code und
 * make() für das PDF (dasselbe wie beim Versand). Nur, was der Link laut Einstellung zeigt.
 */
export async function portalInvoices(link, { today = todayISO() } = {}) {
  if (!laeufeHooks.docPdf) await ensureView('fakturierung')
  const d = F()
  if (!d) return []
  const s = S()
  const inv = invoiceSettings(link)
  const out = []
  for (const x of portalDocuments(d.documents || [], { customerIds: inv.customerIds, months: inv.months, today, settings: s })) {
    const sig = (await sha256Hex(invoiceSigText(x))).slice(0, 32)
    const entry = invoiceEntry(x, d.documents, { today, settings: s, sig })
    if (entry.zahlung) entry.qr = await qrPng(invoiceQrPayload(entry)).catch(() => '')
    out.push({ ...entry, make: () => laeufeHooks.docPdf(x) })
  }
  return out
}

// ---------------------------------------------------------------- Angebot online annehmen

async function sha256Blob(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Kopfdaten und PDF an den Webspace; legt beim ersten Mal Kennung und Code an. */
async function publishOffer(x, { consumer }) {
  let o = offerOf(x)
  if (!o || o.revokedAt) {
    o = { id: newOfferId(), docId: x.id, number: x.number, token: newCode(), createdAt: nowIso(), createdBy: by() }
    portalOffers().push(o)
  }
  const blob = await laeufeHooks.docPdf(x)
  const sha = await sha256Blob(blob)
  const res = await portalCall('angebot', { body: offerPayload({ doc: x, id: o.id, hash: await sha256Hex(o.token), consumer, sig: sha.slice(0, 32) }) })
  if (res.pdf) {
    const up = await portalCall('angebot-datei', { raw: blob, query: `&angebot=${encodeURIComponent(o.id)}` })
    if (up.sha256 !== sha) throw new Error('Das PDF kam am Webspace verändert an. Bitte noch einmal übertragen.')
  }
  const now = nowIso()
  Object.assign(o, { publishedAt: now, validUntil: x.validUntil, error: '' })
  x.online = { id: o.id, publishedAt: now, publishedBy: by(), validUntil: x.validUntil, pdfSha256: sha }
  record(x, `Online-Annahme: Link übertragen (gültig bis ${deDate(x.validUntil)})`)
  persist()
  return o
}

/** Link zurückziehen: am Webspace entfernen; eine dort noch nicht abgeholte Annahme bleibt und wird übernommen. */
export async function revokeOnline(x) {
  const o = offerOf(x)
  if (!o || o.revokedAt) return { revoked: false }
  const res = await portalCall('angebot-entfernen', { body: { ids: [o.id] } })
  if ((res.behalten || []).includes(o.id)) {
    await syncAcceptances({ force: true })
    return { revoked: false, accepted: true }
  }
  const now = nowIso()
  Object.assign(o, { revokedAt: now, removedAt: now })
  x.online = { ...x.online, revokedAt: now }
  record(x, 'Online-Annahme zurückgezogen')
  persist()
  return { revoked: true }
}

/**
 * Im Büro entschieden („Angenommen“, „Abgelehnt“ oder Folgebeleg aus dem Angebot erstellt): aktiven Link gleich
 * zurückziehen, sonst könnte der Kunde noch annehmen. Vorher abholen: Eine schon gegebene Annahme geht vor und
 * bleibt (dann wird nichts zurückgezogen); kommt sie erst gleichzeitig, behält sie der Webspace bis zur Übernahme.
 */
export async function offerStateChanged(x) {
  if (!withdrawNeeded(x)) return null
  if (!portalReady()) {
    toast(`Angebot ${x.number}: Der Link zur Online-Annahme ist noch aktiv. Zurückziehen geht nur mit Zugang zum Kundenbereich.`)
    return null
  }
  try {
    await syncAcceptances({ force: true }).catch(() => 0)
    if (x.acceptance) {
      toast(`Angebot ${x.number} wurde schon online angenommen (${x.acceptance.name}): die Annahme ist übernommen, der Link bleibt.`)
      return { revoked: false, accepted: true }
    }
    const r = await revokeOnline(x)
    toast(r.accepted ? `Angebot ${x.number} wurde inzwischen online angenommen: die Annahme ist übernommen.` : `Angebot ${x.number} ist ${x.status}: Link zur Online-Annahme zurückgezogen.`)
    if (['fak-doc', 'ang-share'].includes(app.ui.modal?.type)) renderModal()
    return r
  } catch (err) {
    toast(`Link zur Online-Annahme noch aktiv: ${err.message}`)
    return null
  }
}

function acceptanceHtml(x) {
  const a = x.acceptance
  const follow = (F().documents || []).find((y) => y.refId === x.id && ['auftrag', 'rechnung'].includes(y.kind))
  return `<div class="ang-box"><p><strong>Online angenommen</strong> am ${esc(when(a.at))} von ${esc(a.name)}${a.role ? ` (${esc(a.role)})` : ''}.</p>
    <p>${a.pdfOk ? 'Angenommen wurde genau das übertragene PDF (SHA-256 stimmt).' : '<span class="err-text">Achtung: Der SHA-256 des angenommenen PDF passt nicht zum übertragenen. Bitte prüfen.</span>'} <span class="ang-hash" title="${esc(a.pdfSha256)}">SHA-256 ${esc(String(a.pdfSha256 || '–').slice(0, 16))}…</span></p>
    ${a.signature ? `<svg class="ang-signature" viewBox="0 0 600 200" role="img" aria-label="Unterschrift von ${esc(a.name)}"><path d="${esc(a.signature)}"/></svg>` : '<p>Ohne Unterschrift.</p>'}
    ${follow ? `<p>${follow.kind === 'auftrag' ? 'Auftragsbestätigung' : 'Rechnung'}: <button class="link-btn" data-action="fak-open" data-id="${esc(follow.id)}">${esc(follow.number || 'Entwurf')}</button></p>` : editable() ? `<p><button class="btn primary" data-action="fak-convert" data-id="${esc(x.id)}" data-kind="auftrag">Auftragsbestätigung erstellen</button>${a.doneAt ? '' : ` <button class="btn" data-action="ang-done" data-id="${esc(x.id)}">Ohne Auftragsbestätigung erledigt</button>`}</p>` : ''}</div>`
}

/** Im festgeschriebenen Angebot: Annahme bzw. Stand des Links. */
export function onlineExtras(x) {
  if (x.kind !== 'angebot') return ''
  if (x.acceptance?.via === 'online') return acceptanceHtml(x)
  if (onlineActive(x)) return `<p class="fak-doc-head"><span class="pill info">online</span> Link zur Online-Annahme übertragen am ${esc(when(x.online.publishedAt))}, gilt bis ${esc(deDate(x.online.validUntil))}.</p>`
  return ''
}

/** Knopf „Online-Annahme“ im festgeschriebenen Angebot. */
export function onlineButtons(x, state) {
  if (!editable() || x.kind !== 'angebot' || x.acceptance) return ''
  if (state !== 'offen' && !onlineActive(x)) return ''
  return `<button class="btn" data-action="ang-open" data-id="${esc(x.id)}">${ICON.send} Online-Annahme</button>`
}

/** In der Liste: online angenommen bzw. Link aktiv. */
export function onlineBadge(x) {
  if (x.kind !== 'angebot') return ''
  if (x.acceptance?.via === 'online') return ` <span class="pill ok" title="${esc(`Online angenommen am ${when(x.acceptance.at)} von ${x.acceptance.name}`)}">online</span>`
  if (onlineActive(x)) return ` <span class="pill info" title="${esc(`Link zur Online-Annahme übertragen, gilt bis ${deDate(x.online.validUntil)}`)}">Link</span>`
  return ''
}

export function onlineSettingsHtml(s, dis) {
  return `<h3>Angebot online annehmen</h3><div class="form-grid"><label class="check wide"><input type="checkbox" id="fs-online-consumers" ${s.onlineConsumers ? 'checked' : ''} ${dis}><span>Auch an Verbraucher: Unsere Angebote an Verbraucher enthalten die Widerrufsbelehrung und die Informationen nach dem FAGG (Fern- und Auswärtsgeschäfte-Gesetz).</span></label>
    <p class="muted wide">Ohne dieses Häkchen geht die Online-Annahme nur bei Unternehmern. Die Belehrung muss im Angebot stehen (z. B. als Textbaustein im Schlusstext); die App prüft das nicht.</p></div>`
}
export const readOnlineSettings = () => (document.getElementById('fs-online-consumers') ? { onlineConsumers: checked('fs-online-consumers') } : {})

function shareModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const s = S()
  const today = todayISO()
  const check = onlineCheck(x, { customer: custOf(x.customerId), today, settings: s })
  const o = offerOf(x)
  const active = onlineActive(x) && o && !o.revokedAt
  const ready = portalReady()
  const t = x.total || {}
  const parts = []
  if (x.acceptance) parts.push(acceptanceHtml(x))
  else if (!check.ok && !active) parts.push(`<div class="banner warn-banner"><p>${check.consumer ? '<strong>Verbraucher.</strong> ' : ''}${esc(check.reason)}</p></div>`)
  if (!ready && !x.acceptance) parts.push('<div class="banner warn-banner"><p>Die Online-Annahme läuft über den Kundenbereich (kunden.php am Webspace). Er ist für dich noch nicht eingerichtet: unter „Objekte & Kunden → Kundenbereich → Einstellungen“ einschalten und übertragen (Vollzugriff oder eine Rolle mit Reklamationen).</p></div>')
  if (active && !x.acceptance) {
    parts.push(`<div class="form-grid"><label class="field wide"><span>Link für den Kunden</span><input type="text" id="ang-url" readonly value="${esc(urlOf(o))}"></label></div>
      <p>Übertragen am ${esc(when(o.publishedAt))}, gilt bis <strong>${esc(deDate(x.validUntil))}</strong>. Danach zeigt die Seite „abgelaufen“.</p>`)
    if (check.consumer) parts.push('<p class="note">Verbraucher: Die Seite weist auf das Rücktrittsrecht und die Belehrung im PDF hin.</p>')
  } else if (check.ok && ready) {
    parts.push(`<p>Der Kunde bekommt einen eigenen Link: Angebot ansehen, als PDF laden und verbindlich annehmen (Name, Funktion und Häkchen, Unterschrift freiwillig). Der Link gilt bis <strong>${esc(deDate(x.validUntil))}</strong>.</p>
      ${check.consumer ? '<p class="note">Verbraucher: laut Einstellung enthält das Angebot die Widerrufsbelehrung und die Informationen nach dem FAGG. Die Seite weist auf das Rücktrittsrecht hin.</p>' : ''}`)
  }
  parts.push('<p class="note">Die App holt die Annahme ab (alle 3 Minuten, solange jemand mit Fakturierung die App offen hat), vermerkt sie beim Angebot und meldet sie unter „Zu erledigen“; das Büro bekommt Push bzw. E-Mail wie bei Reklamationen. Gespeichert werden Zeitpunkt, Name, Funktion und der SHA-256 des PDF, keine IP-Adresse.</p>')
  const ed = editable()
  const foot = [
    '<button class="btn" data-action="close-modal">Schließen</button>',
    '<div class="actions">',
    ed && active && !x.acceptance ? `<button class="btn danger" data-action="ang-revoke" data-id="${esc(x.id)}">${app.ui.confirm === `ang-revoke-${x.id}` ? 'Wirklich zurückziehen?' : 'Zurückziehen'}</button><button class="btn" data-action="ang-page" data-id="${esc(x.id)}">Seite ansehen</button><button class="btn" data-action="ang-copy" data-id="${esc(x.id)}">${ICON.copy} Link kopieren</button><button class="btn primary" data-action="ang-mail" data-id="${esc(x.id)}">${ICON.send} Per E-Mail senden</button>` : '',
    ed && !active && check.ok && ready ? `<button class="btn primary" data-action="ang-publish" data-id="${esc(x.id)}">Link erstellen und übertragen</button>` : '',
    '</div>',
  ].join('')
  return modalFrame({ title: `Online-Annahme: Angebot ${x.number}`, subtitle: `${esc(x.recipient?.name || '')} · ${money(t.gross)}`, wide: true, body: parts.join(''), foot })
}
registerModal('ang-share', shareModal, { module: MODULE })

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Link kopiert.')
  } catch {
    toast(text)
  }
}

registerActions(
  {
    'ang-open': (el) => openModal({ type: 'ang-share', id: el.dataset.id }),
    'ang-publish': async (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      const check = onlineCheck(x, { customer: custOf(x.customerId), today: todayISO(), settings: S() })
      if (!check.ok) return toast(check.reason)
      if (!portalReady()) return toast('Zuerst den Kundenbereich einrichten: „Objekte & Kunden → Kundenbereich → Einstellungen“.')
      el.disabled = true
      toast('Überträgt …')
      try {
        await publishOffer(x, { consumer: check.consumer })
        renderModal()
        toast('Link erstellt: kopieren oder per E-Mail an den Kunden senden.')
      } catch (err) {
        el.disabled = false
        toast(`Nicht übertragen: ${err.message}`)
      }
    },
    'ang-copy': (el) => {
      const o = offerOf(docOf(el.dataset.id))
      if (o && !o.revokedAt) copyText(urlOf(o))
    },
    'ang-page': (el) => {
      const o = offerOf(docOf(el.dataset.id))
      if (o && !o.revokedAt) window.open(urlOf(o), '_blank', 'noopener')
    },
    'ang-mail': (el) => {
      const x = docOf(el.dataset.id)
      const o = offerOf(x)
      if (!x || !o || o.revokedAt) return
      const cust = custOf(x.customerId)
      const mail = offerMail({ doc: x, url: urlOf(o), company: S().sender.name || app.config.brand?.name || '', sender: app.user?.name || '', greeting: greetingOf(cust || {}), amount: money(x.total?.gross) })
      openCompose({ to: x.recipient?.email || cust?.email || '', subject: mail.subject, text: mail.text, origin: `Online-Annahme: Angebot ${x.number}` })
    },
    'ang-revoke': async (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      if (!confirmStep(`ang-revoke-${x.id}`, renderModal)) return toast('Der Kunde kann das Angebot dann nicht mehr online annehmen. Zum Bestätigen noch einmal klicken.')
      try {
        const r = await revokeOnline(x)
        renderModal()
        toast(r.accepted ? 'Der Kunde hat inzwischen angenommen: die Annahme ist übernommen.' : 'Zurückgezogen: Der Link gilt nicht mehr.')
      } catch (err) {
        toast(`Nicht zurückgezogen: ${err.message}`)
      }
    },
    'ang-done': (el) => {
      const x = docOf(el.dataset.id)
      if (!x?.acceptance) return
      x.acceptance = { ...x.acceptance, doneAt: nowIso(), doneBy: by() }
      record(x, 'Online-Annahme: ohne Auftragsbestätigung erledigt')
      persist()
      invalidateTodo()
      refreshBell()
      if (app.ui.modal?.type === 'todo' || app.ui.modal?.type === 'fak-doc' || app.ui.modal?.type === 'ang-share') renderModal()
      else renderNow()
      toast(`Angebot ${x.number}: erledigt.`)
    },
  },
  { edit: MODULE },
)

