// Zusatzleistungen anfragen (Self-Service im Kundenbereich): Abschnitt „Anfragen“ in der Ansicht Kundenbereich, Dialog
// je Anfrage, Einstellungen (Arten mit Artikel der Fakturierung, Hinweistext), Abholung vom Webspace mit den Meldungen,
// Stand zurück, Punkte in „Zu erledigen“ und Vorschläge der digitalen Mitarbeiter „Buchhaltung“ und „Disponent“.
//
// Aktionen je Anfrage: „Angebot erstellen“ (Entwurf der Fakturierung mit Kunde, Objekt, Text und Position aus dem Artikel
// der Art und der Preisliste, sonst eine Textposition; der Stand kommt zurück), „Als Vertriebsfall“ (größere Sachen,
// views/vertrieb.js), „Termin anlegen“ (Termine → Outlook, ref zl:<id>) bzw. „Regiebericht vorbereiten“ (offener Bericht,
// ref zl:<id>), „Ablehnen“ mit Begründung für den Kunden, „Erledigt“. Ist das Angebot online (views/invoicing-online.js),
// bekommt der Webspace den Code des Angebots, verschlüsselt mit dem Code des Links (core/zusatzleistungen.js sealCode).
//
// Später geladen mit dem Paket des Büros (views/lazy-buero.js); der Kundenbereich (immer geladen) zeigt den Abschnitt über
// portalHooks und ruft beim Abholen der Meldungen portalHooks.zusatzSync. Rechte: requestRights (core/zusatzleistungen.js).
// Daten: zusatzleistungen/zusatzleistungen.json { requests, settings }; Fotos in SharePoint unter
// zusatzleistungen/fotos/<Monat>/. Aktionen und Dialoge mit dem Kürzel „zl-“.

import { addDays, formatDate, todayISO, viennaDate } from '../../core/dates.js'
import { settingsOf as fakSettings } from '../../core/invoicing.js'
import { isActive } from '../../core/customer-portal.js'
import {
  appointmentDraft,
  caseFromRequest,
  cleanKinds,
  contactLine,
  customerForRequest,
  linkOrders,
  newNonce,
  newWebRequests,
  offerFields,
  offerOfRequest,
  regieDraft,
  requestFromWeb,
  requestRights,
  requestState,
  requestStatus,
  sealCode,
  statusSig,
  syncRequestOffer,
  webSettings,
  webStatus,
  wishText,
  zusatzSettings,
} from '../../core/zusatzleistungen.js'
import { ACTIONS, app, closeModal, ensureView, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { invalidateTodo, refreshBell, registerTodo } from '../modals/todo.js'
import { esc, ICON, modalFrame, options, uid, val } from '../shared.js'
import { onAppointmentSaved } from './appointments.js'
import { portalCall, portalHooks, portalLinks, portalManage, portalOffers, portalReady, portalSetup, portalStartPolling } from './customer-portal.js'
import { buchhaltungHooks, disponentHooks } from './disponent.js'
import { abrechnungHooks } from './invoicing-abrechnung.js'

const MODULES = ['reklamationen', 'planung', 'fakturierung']
const D = () => {
  const d = (app.data.zusatz ||= { requests: [], settings: {} })
  d.requests ||= []
  d.settings ||= {}
  return d
}
const requests = () => D().requests
const reqOf = (id) => requests().find((r) => r.id === id)
const S = () => zusatzSettings(D())
const R = () => requestRights(app.access)
const F = () => app.data.fakturierung
const writable = () => R().decide && !app.readOnly
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const linkOf = (id) => portalLinks().find((l) => l.id === id)
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
// Tag in Wien (eine Anfrage um 0:30 Uhr ist schon am neuen Tag eingegangen, nicht am UTC-Vortag)
const day = (iso) => (iso ? formatDate(viennaDate(iso) || String(iso).slice(0, 10)) : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const wish = (r) => wishText(r, (d) => formatDate(d))
const custOf = (id) => (F()?.customers || []).find((c) => c.id === id)
const custName = (c) => c?.name || [c?.firstName, c?.lastName].filter(Boolean).join(' ') || ''

/** Anfrage ersetzen (neues Objekt, damit das Zusammenführen je Eintrag greift) und einen Vermerk anhängen. */
function putRequest(next, note = '') {
  const list = requests()
  const out = note ? { ...next, history: [...(next.history || []), { at: nowIso(), by: by(), text: note }] } : next
  const i = list.findIndex((r) => r.id === out.id)
  if (i >= 0) list[i] = out
  else list.push(out)
  return out
}

/** Angebot der Online-Annahme (kundenbereich.json → offers) zum Angebot der Anfrage: das jüngste, auch zurückgezogen. */
function portalOfferOf(r) {
  if (!r.offer?.id || !portalManage()) return null
  return portalOffers().filter((o) => o.docId === r.offer.id).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null
}
const stateOf = (r) => requestState(r, { offer: portalOfferOf(r) })

/** Stand der Angebote aus der Fakturierung in die Anfragen (wer sie sieht und schreiben darf). */
function syncOffers() {
  const f = F()
  if (!f || !writable() || !app.data.zusatz) return false
  const today = todayISO()
  const settings = fakSettings(f)
  let changed = false
  for (const r of [...requests()]) {
    const res = syncRequestOffer(r, offerOfRequest(r, f.documents || []), { documents: f.documents || [], today, settings, at: nowIso(), by: by() })
    if (!res.changed) continue
    putRequest(res.request)
    changed = true
  }
  return changed
}

/** Termine und Regieberichte mit ref zl:<id>: die Anfrage gilt als beauftragt. */
function syncOrders() {
  if (!writable() || !app.data.zusatz) return false
  const list = linkOrders(requests(), { reports: app.data.regie?.reports || [], appointments: app.data.termine?.items || [], at: nowIso() })
  for (const r of list) putRequest(r)
  return list.length > 0
}

function refresh() {
  const a = syncOffers()
  const b = syncOrders()
  if (a || b) persist()
}

// ---------------------------------------------------------------- Webspace: abholen und Stand zurück

const sync = { at: 0, running: false, error: '' }

/** Fotos einer Anfrage nach SharePoint (dann am Webspace löschen); ohne SharePoint bleiben sie dort (höchstens 60 Tage). */
async function storePhotos(r) {
  if (app.store?.kind !== 'sharepoint' || !r.photos?.some((p) => p.datei)) return false
  const out = []
  for (const [i, p] of r.photos.entries()) {
    if (!p.datei) {
      out.push(p)
      continue
    }
    const blob = await portalCall('foto', { query: `&datei=${encodeURIComponent(p.datei)}` })
    const path = `zusatzleistungen/fotos/${(viennaDate(r.received) || r.received).slice(0, 7)}/${r.id}-${i + 1}.${p.datei.split('.').pop()}`
    const up = await app.store.upload(path, blob, blob.type || 'image/jpeg')
    out.push({ path, url: up?.webUrl || '' })
  }
  r.photos = out
  return true
}

/**
 * Neue Anfragen vom Webspace übernehmen (mit den Meldungen, alle 3 Minuten; force: sofort), Fotos nach SharePoint, Stand
 * geänderter Anfragen zurück (mit dem versiegelten Code des Angebots). Nur wer den Kundenbereich verwaltet (Schlüssel).
 * Liefert die Zahl der neuen Anfragen.
 */
export async function syncRequests({ force = false } = {}) {
  if (!portalReady() || !R().portal || app.readOnly || !app.data.zusatz || sync.running || (!force && Date.now() - sync.at < 180e3)) return 0
  sync.running = true
  sync.at = Date.now()
  let taken = []
  try {
    const { anfragen = [] } = await portalCall('anfragen')
    const settings = S()
    const photosDone = []
    for (const a of newWebRequests(anfragen, requests())) {
      const r = requestFromWeb(a, { requests: requests(), settings, link: linkOf(a.link) })
      r.customerId = customerForRequest(r, F()?.customers || [])?.id || ''
      try {
        if (await storePhotos(r)) photosDone.push(r.webId)
      } catch {
        r.photos = (a.fotos || []).map((datei) => ({ datei })) // nächster Versuch beim nächsten Abruf
      }
      requests().push(r)
      taken.push(r)
    }
    // Fotos, die beim Übernehmen nicht nach SharePoint kamen, nachholen
    for (const r of requests()) {
      if (taken.includes(r) || !r.photos?.some((p) => p.datei)) continue
      try {
        if (await storePhotos(r)) photosDone.push(r.webId)
      } catch {
        /* nächster Versuch */
      }
    }
    refresh()
    if (taken.length || photosDone.length) {
      persist()
      // erst gespeichert, dann am Webspace als übernommen markieren (sonst ginge eine Anfrage verloren)
      await app.service?.flush?.()
    }
    const byWeb = new Map(requests().filter((r) => r.webId).map((r) => [r.webId, r]))
    const known = anfragen.filter((a) => byWeb.has(String(a.id)))
    const uebernommen = [...new Set([...taken.map((r) => r.webId), ...known.filter((a) => !a.uebernommen).map((a) => String(a.id))])]
    for (const a of known) if (a.fotos?.length && !byWeb.get(String(a.id)).photos?.some((p) => p.datei) && !photosDone.includes(String(a.id))) photosDone.push(String(a.id))
    // Stand je Anfrage; der Code des Angebots nur versiegelt mit dem Code des Links (der Link muss noch gelten)
    const updates = []
    const sigs = new Map()
    for (const r of requests()) {
      if (!r.webId || !byWeb.has(r.webId)) continue
      const offer = portalOfferOf(r)
      const link = linkOf(r.linkId)
      const online = offer?.publishedAt && !offer.revokedAt && offer.token && isActive(link)
      const nonce = newNonce()
      const angebot = online ? { id: offer.id, nummer: offer.number || r.offer?.number || '', n: nonce, c: await sealCode(offer.token, link.token, nonce) } : null
      const s = webStatus(r, { offer, angebot })
      const sig = statusSig(s, link?.renewedAt || link?.createdAt || '')
      if (sig === r.sent) continue
      updates.push(s)
      sigs.set(r.id, sig)
    }
    if (uebernommen.length || updates.length || photosDone.length) {
      await portalCall('anfrage-status', { body: { uebernommen, updates, fotosLoeschen: photosDone } })
      for (const [id, sig] of sigs) putRequest({ ...reqOf(id), sent: sig })
      if (sigs.size) persist()
    }
    sync.error = ''
    if (taken.length) {
      invalidateTodo()
      refreshBell()
      toast(taken.length === 1 ? `Neue Anfrage aus dem Kundenbereich: ${taken[0].kindName}, ${taken[0].objectName || 'Objekt'}.` : `${taken.length} neue Anfragen aus dem Kundenbereich (Kundenbereich → Anfragen).`)
      if (app.ui.view === 'kundenbereich') renderNow()
      else if (app.ui.modal?.type === 'todo') renderModal()
    }
  } catch (err) {
    sync.error = err.message || String(err)
    taken = []
  } finally {
    sync.running = false
  }
  return taken.length
}

/** Nach einer Entscheidung im Büro: den Stand gleich an den Webspace (wer den Schlüssel hat). */
function pushSoon() {
  if (portalReady() && R().portal) syncRequests({ force: true }).then(() => app.ui.view === 'kundenbereich' && renderNow())
}

// ---------------------------------------------------------------- Abschnitt im Kundenbereich

function requestRow(r) {
  const st = stateOf(r)
  const offer = r.offer?.number ? `<br><span class="muted">Angebot ${esc(r.offer.number)}</span>` : r.offer?.id ? '<br><span class="muted">Angebot als Entwurf</span>' : ''
  return `<tr><td class="clickable" data-action="zl-open" data-id="${esc(r.id)}"><strong>${esc(r.no)}</strong><br><span class="muted">${esc(day(r.received))}</span></td>
    <td><strong>${esc(r.kindName)}</strong><br><span class="muted">${esc(r.objectName || objOf(r.objectId)?.name || '')}${r.from ? ` · ${esc(wish(r))}` : ''}</span></td>
    <td>${esc(r.contact?.name || '')}<br><span class="muted">${esc(r.contact?.phone || r.contact?.email || '')}</span></td>
    <td><span class="pill ${st.cls}">${esc(st.label)}</span>${offer}</td>
    <td class="actions-cell"><button class="btn small" data-action="zl-open" data-id="${esc(r.id)}">Öffnen</button></td></tr>`
}

/** Abschnitt „Anfragen (Zusatzleistungen)“ in der Ansicht Kundenbereich (über portalHooks.zusatzSection). */
function zusatzSection() {
  refresh()
  const all = [...requests()].sort((a, b) => String(b.received).localeCompare(String(a.received)))
  const open = all.filter((r) => ['eingegangen', 'angebot', 'beauftragt'].includes(stateOf(r).key))
  const closed = all.filter((r) => !open.includes(r))
  const head = (rows) => `<div class="table-wrap"><table class="data zl-table"><thead><tr><th>Anfrage</th><th>Was / Objekt</th><th>Ansprechperson</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  const shown = portalLinks().filter((l) => isActive(l) && l.show?.zusatz === true).length
  return `<section class="kb-zusatz" id="kb-zusatz"><div class="section-head"><div><h3>Anfragen (Zusatzleistungen)</h3>
      <p>Kunden fragen über ihren Link Zusatzleistungen an (z. B. Grundreinigung, Glasreinigung, Sonderreinigung). Daraus mit einem Klick ein Angebot, ein Vertriebsfall, ein Termin oder ein Regiebericht; den Stand und, sobald es online ist, den Link zum Angebot sieht der Kunde unter „Meine Anfragen“.</p></div>
      <div class="actions">${R().settings && !app.readOnly ? `<button class="btn" data-action="zl-settings">${ICON.gear} Arten und Hinweis</button>` : ''}</div></div>
    ${sync.error ? `<div class="banner warn-banner"><p>Anfragen konnten nicht geholt werden: ${esc(sync.error)}</p></div>` : ''}
    ${open.length ? head(open.map(requestRow).join('')) : `<p class="empty">Keine offenen Anfragen.${shown ? '' : ' Beim Link unter „Was der Link zeigt“ „Zusatzleistung anfragen“ einschalten.'}</p>`}
    ${closed.length ? `<details class="zl-closed"><summary>Erledigt und abgelehnt (${closed.length})</summary>${head(closed.slice(0, 50).map(requestRow).join(''))}</details>` : ''}
    <p class="note">${shown ? `${plural(shown, 'Link zeigt', 'Links zeigen')} „Zusatzleistung anfragen“. ` : ''}Neue Anfragen holt die App mit den Reklamationen ab (alle 3 Minuten, sofort über „⋯ → Reklamationen jetzt abholen“); das Büro bekommt Push bzw. E-Mail wie bei Reklamationen.</p></section>`
}
portalHooks.zusatzSection = zusatzSection
portalHooks.zusatzSync = (opts) => syncRequests(opts)
portalHooks.zusatzSettings = () => webSettings(D())

// ---------------------------------------------------------------- Dialog je Anfrage

function photoHtml(r) {
  if (!r.photos?.length) return ''
  const items = r.photos.map((p, i) =>
    p.path
      ? p.url
        ? `<a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">${ICON.camera} Foto ${i + 1}</a>`
        : `<span class="pill">${ICON.camera} Foto ${i + 1} in SharePoint</span>`
      : R().portal
        ? `<span data-zl-photo><button class="btn small" data-action="zl-photo" data-file="${esc(p.datei)}">${ICON.camera} Foto ${i + 1} laden</button></span>`
        : `<span class="pill">${ICON.camera} Foto ${i + 1} am Webspace</span>`,
  )
  return `<p class="zl-photos">${items.join(' ')}</p>`
}

function actionsHtml(r, m) {
  const rt = R()
  const ed = writable()
  const st = stateOf(r).key
  const doc = F() ? offerOfRequest(r, F().documents || []) : null
  const out = []
  if (doc) {
    out.push(`<button class="btn" data-action="fak-open" data-id="${esc(doc.id)}">Angebot ${esc(doc.number || '(Entwurf)')} öffnen</button>`)
    if (rt.offer && doc.number && r.offer?.state === 'offen' && !doc.acceptance) out.push(`<button class="btn" data-action="ang-open" data-id="${esc(doc.id)}">${ICON.send} Online-Annahme</button>`)
  } else if (rt.offer && ed && !['erledigt', 'abgelehnt'].includes(st)) out.push(`<button class="btn primary" data-action="zl-offer" data-id="${esc(r.id)}">Angebot erstellen</button>`)
  if (r.case?.id) out.push(`<button class="btn" data-action="vt-goto" data-id="${esc(r.case.id)}">Vertriebsfall ${esc(r.case.no || '')} öffnen</button>`)
  else if (rt.case && ed && app.data.vertrieb && !doc && st === 'eingegangen') out.push(`<button class="btn" data-action="zl-case" data-id="${esc(r.id)}">Als Vertriebsfall</button>`)
  if (!r.ordered && ed && !['erledigt', 'abgelehnt'].includes(st)) {
    if (rt.termin) out.push(`<button class="btn" data-action="zl-termin" data-id="${esc(r.id)}">${ICON.calendar} Termin anlegen</button>`)
    if (rt.regie) out.push(`<button class="btn" data-action="zl-regie" data-id="${esc(r.id)}">Regiebericht vorbereiten</button>`)
  }
  if (ed && ['erledigt', 'abgelehnt'].includes(st)) out.push(`<button class="btn" data-action="zl-reopen" data-id="${esc(r.id)}">Wieder öffnen</button>`)
  else if (ed && !m.declining) out.push(`<button class="btn" data-action="zl-decline" data-id="${esc(r.id)}">Ablehnen</button><button class="btn" data-action="zl-done" data-id="${esc(r.id)}">${ICON.check} Erledigt</button>`)
  return out.join('')
}

function requestModal(c, m) {
  const r = reqOf(m.id)
  if (!r) return modalFrame({ title: 'Anfrage', body: '<p class="empty">Diese Anfrage gibt es nicht mehr.</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const st = stateOf(r)
  const obj = objOf(r.objectId)
  const f = F()
  const rt = R()
  const customers = f ? (f.customers || []).filter((x) => x.active !== false).sort((a, b) => custName(a).localeCompare(custName(b), 'de')) : []
  const cust = f ? customerForRequest(r, f.customers || []) : null
  const doc = f ? offerOfRequest(r, f.documents || []) : null
  const ordered = r.ordered ? `${r.ordered.via === 'regie' ? `Regiebericht ${r.ordered.no || ''}` : r.ordered.via === 'termin' ? 'Termin' : 'beauftragt'}${r.ordered.date ? ` am ${formatDate(r.ordered.date)}` : ''}` : ''
  const facts = [
    ['Objekt', `${obj?.name || r.objectName || 'Objekt'}${obj?.address ? `, ${obj.address}` : ''}`],
    ['Link', r.linkTitle || ''],
    ['Wunschtermin', wish(r)],
    ['Fläche', r.area ? `${String(r.area).replace('.', ',')} m²` : ''],
    ['Ansprechperson', contactLine(r.contact)],
    ['Angebot', r.offer?.id ? `${r.offer.number || 'Entwurf'}${r.offer.state && r.offer.number ? ` (${r.offer.state})` : ''}` : ''],
    ['Vertriebsfall', r.case?.no || ''],
    ['Beauftragt', ordered],
    ['Abgelehnt', r.declined ? `${day(r.declined.at)}: ${r.declined.reason}` : ''],
  ].filter(([, v]) => v)
  const decline = m.declining
    ? `<div class="zl-decline"><label class="field wide"><span>Begründung für den Kunden (steht in „Meine Anfragen“)</span><textarea id="zl-reason" rows="3" maxlength="1000" placeholder="z. B. Im Dezember haben wir leider keine Kapazität frei. Gerne ab Jänner.">${esc(m.reason || '')}</textarea></label>
      <div class="actions"><button class="btn" data-action="zl-decline-cancel">Abbrechen</button><button class="btn danger" data-action="zl-decline-save" data-id="${esc(r.id)}">Ablehnen und Begründung senden</button></div></div>`
    : ''
  const custField = f && rt.offer && !doc && writable() && !['erledigt', 'abgelehnt'].includes(st.key)
    ? `<label class="field wide"><span>Kunde der Fakturierung (für das Angebot)</span><select id="zl-customer" data-change="zl-customer" data-id="${esc(r.id)}">${options(customers.map((x) => [x.id, `${custName(x)}${x.customerNo ? ` (${x.customerNo})` : ''}`]), cust?.id || '', { empty: '– Kunde wählen –' })}</select></label>`
    : ''
  return modalFrame({
    title: `Anfrage ${r.no}: ${r.kindName}`,
    subtitle: `${esc(day(r.received))} · <span class="pill ${st.cls}">${esc(st.label)}</span>`,
    wide: true,
    body: `<dl class="zl-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <h3>Beschreibung</h3><p class="zl-text">${esc(r.text)}</p>
      ${photoHtml(r)}
      ${custField ? `<div class="form-grid">${custField}</div>` : ''}
      ${decline}
      <div class="actions zl-actions">${actionsHtml(r, m)}</div>
      <details class="zl-history"><summary>Verlauf (${(r.history || []).length})</summary><ul>${(r.history || []).map((h) => `<li>${esc(day(h.at))}${h.by ? ` · ${esc(h.by)}` : ''}: ${esc(h.text)}</li>`).join('')}</ul></details>
      <p class="note">Der Kunde sieht den Stand (eingegangen, Angebot gesendet, beauftragt, erledigt, abgelehnt), beim Ablehnen die Begründung und, sobald das Angebot online ist, den Link zur Online-Annahme. Preise, Notizen und der Verlauf bleiben intern.</p>`,
    foot: '<button class="btn" data-action="close-modal">Schließen</button>',
  })
}
registerModal('zl-request', requestModal, { module: MODULES })

// ---------------------------------------------------------------- Einstellungen: Arten und Hinweis

function settingsDraft(m) {
  if (!m.draft) {
    const s = S()
    m.draft = { kinds: s.kinds.map((k) => ({ ...k })), hint: s.hint }
  }
  return m.draft
}

function readSettings(m) {
  const d = settingsDraft(m)
  if (!document.getElementById('zl-hint')) return d
  d.hint = val('zl-hint').trim()
  d.kinds = d.kinds.map((k, i) => ({ ...k, name: val(`zl-k-name-${i}`).trim(), articleId: document.getElementById(`zl-k-art-${i}`) ? val(`zl-k-art-${i}`) : k.articleId }))
  return d
}

function settingsModal(c, m) {
  const d = settingsDraft(m)
  const f = F()
  const articles = f ? (f.articles || []).filter((a) => a.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de')) : null
  const rows = d.kinds
    .map(
      (k, i) => `<tr><td><input type="text" id="zl-k-name-${i}" maxlength="80" value="${esc(k.name)}" aria-label="Name der Art ${i + 1}"></td>
      <td>${articles ? `<select id="zl-k-art-${i}" aria-label="Artikel zu ${esc(k.name)}">${options(articles.map((a) => [a.id, `${a.articleNo ? `${a.articleNo} – ` : ''}${a.name}${a.unit ? ` (${a.unit})` : ''}`]), k.articleId || '', { empty: '– ohne Artikel (Textposition) –' })}</select>` : `<span class="muted">${k.articleId ? 'Artikel eingetragen' : 'ohne Artikel'}</span>`}</td>
      <td class="actions-cell"><button class="btn small ghost" data-action="zl-kind-del" data-i="${i}" aria-label="Art ${esc(k.name)} entfernen">${ICON.trash}</button></td></tr>`,
    )
    .join('')
  return modalFrame({
    title: 'Zusatzleistungen: Arten und Hinweis',
    wide: true,
    body: `<p class="muted">Diese Arten wählt der Kunde im Kundenbereich unter „Zusatzleistung anfragen“. Mit Artikel der Fakturierung kommt beim „Angebot erstellen“ eine Position mit Preis (Kundenpreis vor Standardpreis, Menge = Fläche bei Einheit m²), ohne Artikel eine Textposition.</p>
      <div class="table-wrap"><table class="data zl-kinds"><thead><tr><th>Art (sieht der Kunde)</th><th>Artikel der Fakturierung</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="actions"><button class="btn" data-action="zl-kind-add">${ICON.plus} Art dazunehmen</button></div>
      <label class="field wide"><span>Hinweis unter dem Formular</span><textarea id="zl-hint" rows="2" maxlength="400">${esc(d.hint)}</textarea></label>
      ${articles ? '' : '<p class="note">Artikel wählt, wer die Fakturierung sieht.</p>'}
      <p class="note">„Speichern“ überträgt Arten und Hinweis an den Webspace (nur die Namen, keine Artikel oder Preise).</p>`,
    foot: '<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="zl-settings-save">Speichern</button></div>',
  })
}
registerModal('zl-settings', settingsModal, { module: ['reklamationen', 'planung'] })

// ---------------------------------------------------------------- Zu erledigen und digitale Mitarbeiter

const isNew = (r) => requestStatus(r, { offer: portalOfferOf(r) }) === 'eingegangen' && !r.offer?.id && !r.case?.id

registerTodo({
  id: 'zusatzleistungen',
  module: 'reklamationen',
  title: 'Neue Anfragen aus dem Kundenbereich (Zusatzleistungen)',
  compute: () => {
    if (!app.data?.zusatz) return []
    if (portalReady() && R().portal) {
      portalStartPolling()
      syncRequests()
    }
    return requests().filter(isNew)
  },
  render: (list) =>
    list
      .map((r) => `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(r.kindName)}</strong>: ${esc(r.objectName || objOf(r.objectId)?.name || '')} <span class="muted">(${esc(r.no)})</span><br><span class="muted">${esc(r.text.slice(0, 120))}${r.contact?.name ? ` · ${esc(contactLine(r.contact))}` : ''}</span></div><button class="btn small primary" data-action="zl-open" data-id="${esc(r.id)}">Öffnen</button></div>`)
      .join(''),
})

// Buchhaltung: aus neuen Anfragen ein Angebot (Entwurf; Festschreiben und Senden bleibt bei der Person)
buchhaltungHooks.push(() => {
  if (!app.data?.zusatz || !R().offer || app.readOnly || !F()) return []
  // Stand der Angebote in die Anfragen (für die Rollen des Kundenbereichs ohne Fakturierung, die ihn zurückmelden)
  if (syncOffers()) persist()
  return requests()
    .filter(isNew)
    .map((r) => ({
      id: `zl:${r.id}`,
      agent: 'buchhaltung',
      prio: r.from && r.from <= addDays(todayISO(), 14) ? 1 : 2,
      title: `Angebot für ${r.kindName} (${r.objectName || 'Objekt'})`,
      text: `Anfrage ${r.no} aus dem Kundenbereich${r.from ? `, Wunschtermin ${wish(r)}` : ''}. Ich lege das Angebot als Entwurf an (Kunde, Objekt, Beschreibung${zusatzSettings(D()).kinds.find((k) => k.id === r.kindId)?.articleId ? ', Position mit Preis aus der Preisliste' : ', Position ohne Preis'}). Prüfen, festschreiben und online stellen bleibt bei dir.`,
      run: { label: 'Angebot erstellen', action: 'zl-offer', data: { id: r.id } },
      open: { label: 'Anfrage', action: 'zl-open', data: { id: r.id } },
    }))
})

// Disponent: beauftragt (Angebot angenommen), aber noch kein Termin und kein Regiebericht
disponentHooks.push((today) => {
  if (!app.data?.zusatz) return []
  return requests()
    .filter((r) => !r.ordered && !r.done && !r.declined && requestStatus(r, { offer: portalOfferOf(r) }) === 'beauftragt' && (!r.from || r.from <= addDays(today, 21)))
    .map((r) => ({
      id: `zl-termin:${r.id}`,
      agent: 'disponent',
      prio: r.from && r.from <= addDays(today, 7) ? 1 : 2,
      title: `${r.kindName} ${r.objectName || ''} einplanen`.replace(/\s+/g, ' ').trim(),
      text: `Die Anfrage ${r.no} ist beauftragt (Angebot ${r.offer?.number || ''} angenommen)${r.from ? `, Wunschtermin ${wish(r)}` : ''}. Ich bereite den Termin im Objekt vor; danach im Plan einteilen.`,
      run: R().termin && !app.readOnly ? { label: 'Termin anlegen', action: 'zl-termin', data: { id: r.id } } : null,
      open: { label: 'Anfrage', action: 'zl-open', data: { id: r.id } },
    }))
})

// Termin mit ref zl:<id> gespeichert: die Anfrage gilt als beauftragt (auch wenn der Termin aus einem anderen Dialog kam)
onAppointmentSaved((t) => {
  if (!String(t.ref || '').startsWith('zl:') || !writable() || !app.data?.zusatz) return
  if (syncOrders()) {
    persist()
    pushSoon()
  }
})

// ---------------------------------------------------------------- Aktionen

const decide = (r, patch, note) => {
  const out = putRequest({ ...r, ...patch }, note)
  persist()
  invalidateTodo()
  refreshBell()
  pushSoon()
  return out
}

async function createOffer(id) {
  const r = reqOf(id)
  if (!r) return
  if (!R().offer || app.readOnly) return toast('Ein Angebot erstellt, wer die Fakturierung bearbeiten darf.')
  await ensureView('fakturierung')
  const f = F()
  if (!f || !abrechnungHooks.newDraft) return toast('Die Fakturierung ist nicht geladen.')
  const existing = offerOfRequest(r, f.documents || [])
  if (existing) return ACTIONS['fak-open']?.({ dataset: { id: existing.id } })
  const cust = customerForRequest(r, f.customers || [])
  if (!cust) {
    openModal({ type: 'zl-request', id: r.id })
    return toast('Bitte zuerst den Kunden der Fakturierung wählen (dem Objekt ist keiner zugeordnet).')
  }
  const fields = offerFields(r, { fak: f, settings: S(), customerId: cust.id, date: todayISO(), vat: fakSettings(f).vat, newId: () => uid('l') })
  const d = abrechnungHooks.newDraft('angebot', { title: fields.title })
  abrechnungHooks.applyCustomer(d, cust.id)
  // Preise und Rabatt je Position aus der Preisliste (priceFor): kein Rabatt auf alles dazu
  Object.assign(d, { title: fields.title, lines: fields.lines, source: fields.source, objectId: fields.objectId, objectName: fields.objectName, discount: 0, contactName: d.contactName || r.contact?.name || '' })
  f.documents.push(d)
  const res = syncRequestOffer({ ...r, customerId: cust.id }, d, { documents: f.documents, today: todayISO(), settings: fakSettings(f), at: nowIso(), by: by() })
  putRequest(res.request)
  persist()
  invalidateTodo()
  refreshBell()
  if (app.ui.modal) closeModal()
  renderNow()
  ACTIONS['fak-open']?.({ dataset: { id: d.id } })
  toast(fields.priced ? 'Angebot als Entwurf (Preis aus der Preisliste): prüfen, festschreiben und online stellen.' : 'Angebot als Entwurf: Preis eintragen, festschreiben und online stellen.')
}

registerActions(
  {
    'zl-open': (el) => {
      refresh()
      if (reqOf(el.dataset.id)) openModal({ type: 'zl-request', id: el.dataset.id })
    },
    'zl-settings': () => openModal({ type: 'zl-settings' }),
    'zl-photo': async (el) => {
      const box = el.closest('[data-zl-photo]')
      try {
        const blob = await portalCall('foto', { query: `&datei=${encodeURIComponent(el.dataset.file)}` })
        if (box) box.innerHTML = `<img class="kb-photo" alt="Foto vom Kunden" src="${URL.createObjectURL(blob)}">`
      } catch (err) {
        toast(`Foto nicht geladen: ${err.message}`)
      }
    },
  },
  { edit: false },
)

registerActions(
  {
    'zl-customer': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r) return
      putRequest({ ...r, customerId: val('zl-customer') })
      persist()
      renderModal()
    },
    'zl-offer': (el) => createOffer(el.dataset.id),
    'zl-case': async (el) => {
      const r = reqOf(el.dataset.id)
      if (!r || !R().case) return toast('Einen Vertriebsfall legt an, wer den Vertrieb bearbeiten darf.')
      await ensureView('vertrieb')
      const v = app.data.vertrieb
      if (!v) return toast('Der Vertrieb ist nicht geladen.')
      v.cases ||= []
      const c = caseFromRequest(r, { id: uid('vf'), cases: v.cases, today: todayISO(), customer: F() ? customerForRequest(r, F().customers || []) : null, object: objOf(r.objectId), owner: by(), at: nowIso(), by: by() })
      v.cases.push({ ...c, updatedAt: nowIso(), updatedBy: by() })
      decide(r, { case: { id: c.id, no: c.no } }, `als Vertriebsfall ${c.no} angelegt`)
      if (app.ui.modal) closeModal()
      ACTIONS['vt-goto']?.({ dataset: { id: c.id } })
      toast(`Vertriebsfall ${c.no} angelegt: Besichtigung, Kalkulation und Angebot laufen dort.`)
    },
    'zl-termin': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r || !R().termin) return toast('Einen Termin legt an, wer Termine bearbeiten darf.')
      const existing = (app.data.termine?.items || []).find((a) => a.ref === `zl:${r.id}` && !a.cancelled)
      openModal(existing ? { type: 'appt', id: existing.id } : { type: 'appt', draft: appointmentDraft(r, { today: todayISO() }) })
    },
    'zl-regie': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r || !R().regie) return toast('Einen Regiebericht legt an, wer Regieberichte bearbeiten darf.')
      const existing = (app.data.regie?.reports || []).find((x) => x.ref === `zl:${r.id}`)
      if (existing) return ACTIONS['reg-open']?.({ dataset: { id: existing.id } })
      openModal({ type: 'reg-edit', id: '', draft: regieDraft(r, { today: todayISO() }) })
      toast('Regiebericht vorbereitet: speichern; Stunden, Material und Unterschrift kommen vor Ort dazu.')
    },
    'zl-decline': () => {
      const m = app.ui.modal
      if (m?.type !== 'zl-request') return
      m.declining = true
      renderModal()
      document.getElementById('zl-reason')?.focus()
    },
    'zl-decline-cancel': () => {
      const m = app.ui.modal
      if (m) m.declining = false
      renderModal()
    },
    'zl-decline-save': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r) return
      const reason = val('zl-reason').trim()
      if (reason.length < 5) return toast('Bitte kurz begründen: Der Kunde sieht den Text in „Meine Anfragen“.')
      decide(r, { declined: { reason: reason.slice(0, 1000), at: nowIso(), by: by() }, done: null }, `abgelehnt: ${reason.slice(0, 200)}`)
      app.ui.modal.declining = false
      renderModal()
      renderNow()
      toast(`Anfrage ${r.no} abgelehnt. Der Kunde sieht die Begründung.`)
    },
    'zl-done': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r) return
      decide(r, { done: { at: nowIso(), by: by() } }, 'als erledigt vermerkt')
      renderModal()
      renderNow()
      toast(`Anfrage ${r.no} erledigt.`)
    },
    'zl-reopen': (el) => {
      const r = reqOf(el.dataset.id)
      if (!r) return
      decide(r, { done: null, declined: null }, 'wieder geöffnet')
      renderModal()
      renderNow()
    },
    'zl-kind-add': () => {
      const m = app.ui.modal
      const d = readSettings(m)
      d.kinds.push({ id: '', name: '', articleId: '' })
      renderModal()
      document.getElementById(`zl-k-name-${d.kinds.length - 1}`)?.focus()
    },
    'zl-kind-del': (el) => {
      const m = app.ui.modal
      const d = readSettings(m)
      d.kinds = d.kinds.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'zl-settings-save': async () => {
      const m = app.ui.modal
      const d = readSettings(m)
      const named = d.kinds.filter((k) => k.name)
      if (!named.length) return toast('Bitte mindestens eine Art eintragen.')
      // neue Arten bekommen ihre Kennung aus dem Namen (cleanKinds), bestehende behalten sie
      const kinds = cleanKinds(named)
      D().settings = { ...D().settings, kinds, hint: d.hint }
      persist()
      closeModal()
      renderNow()
      if (!portalReady()) return toast('Gespeichert. Der Kundenbereich ist aus; der Webspace bekommt die Arten beim Einrichten.')
      try {
        await portalSetup()
        toast(`Gespeichert und übertragen: ${plural(kinds.length, 'Art', 'Arten')}.`)
      } catch (err) {
        toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
      }
    },
  },
  { edit: MODULES },
)
