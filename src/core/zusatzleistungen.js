// Zusatzleistungen anfragen (Self-Service im Kundenbereich): Der Kunde fordert über seinen Link (kunden.php?k=CODE) eine
// Zusatzleistung an – Grundreinigung, Fensterreinigung/Glas, Teppichreinigung, Sonderreinigung nach Umbau oder
// Veranstaltung, Winterdienst-Sondereinsatz oder „Sonstiges“ – mit Objekt (nur Objekte des Links), Wunschtermin bzw.
// Zeitraum, Beschreibung, Fläche (optional), bis zu 3 Fotos und Ansprechperson. Das Büro macht daraus mit einem Klick
// einen Angebotsentwurf der Fakturierung, einen Vertriebsfall, einen Termin bzw. Regiebericht, lehnt mit Begründung ab
// oder setzt „erledigt“. Den Stand sieht der Kunde in „Meine Anfragen“; ist das Angebot online veröffentlicht
// (Online-Annahme, kunden.php?a=CODE), steht dort der Link zum Angebot.
//
// Rein rechnend, ohne Netz testbar (test/zusatzleistungen.test.js). Ansicht: ui/views/customer-portal-zusatz.js, Seite
// am Webspace: kunden.php (Abschnitt „Zusatzleistung anfragen“, Texte in zusatz-texte.php).
//
// Datei zusatzleistungen/zusatzleistungen.json (eigener Ordner: die Buchhaltung liest sie für das Angebot, darf den
// Ordner kundenbereich/ mit den Codes der Links aber nicht sehen; darum hier nie ein Code):
//   { requests: [{ id ('zl' + Kennung am Webspace), no ('ZL-2026-001'), webId, linkId, linkTitle, objectId, objectName,
//                  kindId, kindName, from, to, area, text, contact { name, phone, email }, photos [{ datei } | { path, url }],
//                  received, customerId, offer (Momentaufnahme des Angebots, core/vertrieb.js offerSnapshot), case { id, no },
//                  ordered { via: 'termin' | 'regie' | 'hand', id, no, date, at, by }, declined { reason, at, by },
//                  done { at, by }, sent (was der Webspace zuletzt bekam), history [{ at, by, text }] }],
//     settings: { kinds: [{ id, name, articleId }], hint } }
// Am Webspace (privat/kundenbereich/anfragen.json): die Anfrage, wie der Kunde sie geschickt hat, Stand, Rückmeldung und –
// sobald das Angebot online ist – Kennung, Nummer und der Code des Angebots, verschlüsselt mit dem Code des Links
// (sealCode): Der Webspace allein kann ihn nicht lesen, nur die Seite des Links, die mit ihrem Code aufgerufen wird.

import { viennaDate } from './dates.js'
import { lineFromArticle, parseNumber, priceFor, round2, stateOf } from './invoicing.js'
import { nextCaseNo, offerSnapshot } from './vertrieb.js'

export const ZUSATZ_SOURCE = 'Kundenbereich'
export const REQUEST_ID_PATTERN = /^[a-f0-9]{12}$/
export const MAX_PHOTOS = 3
export const MAX_KINDS = 20

/** Arten zur Auswahl (Vorgabe; in den Einstellungen änderbar, je Art optional ein Artikel der Fakturierung). */
export const DEFAULT_KINDS = [
  { id: 'grundreinigung', name: 'Grundreinigung', articleId: '' },
  { id: 'glas', name: 'Fensterreinigung / Glasreinigung', articleId: '' },
  { id: 'teppich', name: 'Teppichreinigung', articleId: '' },
  { id: 'sonder', name: 'Sonderreinigung nach Umbau oder Veranstaltung', articleId: '' },
  { id: 'winter', name: 'Winterdienst-Sondereinsatz', articleId: '' },
  { id: 'sonstiges', name: 'Sonstiges', articleId: '' },
]
export const DEFAULT_HINT = 'Wir melden uns mit einem Angebot oder einem Terminvorschlag. Die Anfrage ist unverbindlich.'

/** Stand, wie ihn der Kunde sieht (gleiche Schlüssel in kunden.php und zusatz-texte.php). */
export const STATUS = { eingegangen: 'eingegangen', angebot: 'Angebot gesendet', beauftragt: 'beauftragt', erledigt: 'erledigt', abgelehnt: 'abgelehnt' }
export const OPEN_STATUS = ['eingegangen', 'angebot', 'beauftragt']

const text = (s, max = 2000) => String(s ?? '').trim().slice(0, max)
const ID_RE = /^[a-z0-9]{2,24}$/

/** Kennung einer neuen Art aus dem Namen („Reinigung Tiefgarage“ → „reinigungtiefga“), eindeutig in der Liste. */
export function kindIdOf(name, taken = []) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20) || 'art'
  let id = base.length < 2 ? `${base}x` : base
  for (let i = 2; taken.includes(id); i++) id = `${base.slice(0, 20)}${i}`
  return id
}

/** Arten aufräumen: Name Pflicht, Kennung gültig und eindeutig, höchstens 20; leer → Vorgabe. */
export function cleanKinds(list) {
  const out = []
  for (const k of Array.isArray(list) ? list : []) {
    const name = text(k?.name, 80)
    if (!name || out.length >= MAX_KINDS) continue
    const id = ID_RE.test(String(k?.id || '')) && !out.some((x) => x.id === k.id) ? k.id : kindIdOf(name, out.map((x) => x.id))
    out.push({ id, name, articleId: String(k?.articleId || '') })
  }
  return out.length ? out : DEFAULT_KINDS.map((k) => ({ ...k }))
}

/** Einstellungen mit Vorgaben: { kinds, hint }. */
export function zusatzSettings(doc = {}) {
  const s = doc?.settings || {}
  return { kinds: cleanKinds(s.kinds), hint: typeof s.hint === 'string' ? text(s.hint, 400) : DEFAULT_HINT }
}

/** Für privat/kundenbereich.json (aktion=einrichten): nur Kennung und Name je Art, der Hinweistext; keine Artikel, keine Preise. */
export const webSettings = (doc = {}) => {
  const s = zusatzSettings(doc)
  return { arten: s.kinds.map(({ id, name }) => ({ id, name })), hinweis: s.hint }
}

export const kindOf = (settings, id) => settings.kinds.find((k) => k.id === id) || null

// ---------------------------------------------------------------- Übernahme vom Webspace

/** Nächste Nummer „ZL-2026-001“ je Jahr. */
export function nextRequestNo(requests = [], year) {
  const re = new RegExp(`^ZL-${year}-(\\d+)$`)
  const max = Math.max(0, ...requests.map((r) => Number(re.exec(String(r?.no || ''))?.[1] || 0)))
  return `ZL-${year}-${String(max + 1).padStart(3, '0')}`
}

/** Neue Anfragen vom Webspace (gültige Kennung, noch nicht in der App, von niemandem übernommen). */
export function newWebRequests(list = [], requests = []) {
  const known = new Set(requests.map((r) => r.webId))
  return (list || []).filter((a) => a && REQUEST_ID_PATTERN.test(String(a.id)) && !known.has(String(a.id)) && !a.uebernommen)
}

const dateOk = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : '')
/** Tag des Eingangs in Wien (0:30 Uhr ist schon der neue Tag, Neujahr schon das neue Jahr), nicht der UTC-Tag. */
const receivedDay = (received) => viennaDate(received) || String(received || '').slice(0, 10)

/**
 * Anfrage vom Webspace → Eintrag der App. Die Kennung folgt aus der Kennung am Webspace (zwei Geräte, die gleichzeitig
 * übernehmen, legen dieselbe Anfrage an). Art: Name aus den Einstellungen, sonst wie geschickt.
 */
export function requestFromWeb(a, { requests = [], settings = zusatzSettings(), now = new Date().toISOString(), link = null } = {}) {
  const received = Number(a.erstellt) ? new Date(Number(a.erstellt) * 1000).toISOString() : now
  const kind = kindOf(settings, a.art)
  const area = parseNumber(a.flaeche)
  const k = a.kontakt || {}
  return {
    id: `zl${String(a.id).replace(/[^a-f0-9]/g, '')}`,
    no: nextRequestNo(requests, receivedDay(received).slice(0, 4)),
    webId: String(a.id),
    linkId: String(a.link || ''),
    linkTitle: text(link?.title || a.titel, 120),
    objectId: text(a.objektId, 60),
    objectName: text(a.objekt, 120),
    kindId: kind?.id || text(a.art, 24) || 'sonstiges',
    kindName: kind?.name || text(a.artName, 80) || 'Sonstiges',
    from: dateOk(a.von),
    to: dateOk(a.bis),
    area: area > 0 ? round2(area) : null,
    text: text(a.text),
    contact: { name: text(k.name, 80), phone: text(k.telefon, 40), email: text(k.email, 120) },
    photos: (Array.isArray(a.fotos) ? a.fotos : []).filter((f) => /^[a-f0-9]{12}\.(jpg|png|webp)$/.test(String(f))).slice(0, MAX_PHOTOS).map((datei) => ({ datei })),
    received,
    customerId: '',
    offer: null,
    case: null,
    ordered: null,
    declined: null,
    done: null,
    sent: 'eingegangen||',
    history: [{ at: received, by: ZUSATZ_SOURCE, text: `angefragt über den Kundenbereich${link?.title ? ` (${link.title})` : ''}` }],
  }
}

/** Kontakt in einer Zeile: „Maria Huber, 0662 123456, maria@example.com“. */
export const contactLine = (c = {}) => [c.name, c.phone, c.email].map((x) => text(x, 120)).filter(Boolean).join(', ')

/** Wunschtermin als Text: „ab 12.12.2026“, „12.12.–19.12.2026“ bzw. „12.12.2026“. */
export function wishText(r, fmt = (d) => d.split('-').reverse().join('.')) {
  if (r.from && r.to && r.to !== r.from) return `${fmt(r.from)} bis ${fmt(r.to)}`
  if (r.from) return fmt(r.from)
  return 'ohne Wunschtermin'
}

// ---------------------------------------------------------------- Angebot, Auftrag, Stand

/** Kennung im Termin bzw. Regiebericht, der zur Anfrage gehört. */
export const requestRef = (r) => `zl:${r.id}`

/** Angebot der Anfrage in den Belegen: das jüngste mit source.requestId, das eingetragene oder das des Vertriebsfalls. */
export function offerOfRequest(r, docs = []) {
  const list = (docs || []).filter((d) => d?.kind === 'angebot' && ((d.source?.type === 'zusatzleistung' && d.source.requestId === r.id) || (r.offer?.id && d.id === r.offer.id) || (r.case?.id && d.source?.type === 'vertrieb' && d.source.caseId === r.case.id)))
  return list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null
}

const SNAP_KEYS = ['id', 'number', 'state', 'validUntil', 'sent', 'online', 'acceptedAt']
const sameSnap = (a, b) => !!a === !!b && (!a || SNAP_KEYS.every((k) => (a[k] ?? '') === (b[k] ?? '')))

/**
 * Stand des Angebots in die Anfrage übernehmen (wer die Fakturierung sieht; die Rollen des Kundenbereichs ohne
 * Fakturierung lesen die Momentaufnahme). Liefert { request, changed }.
 */
export function syncRequestOffer(r, doc, { documents = [], today, settings = {}, at = new Date().toISOString(), by = '' } = {}) {
  const snap = doc ? offerSnapshot(doc, { state: stateOf(doc, documents, today, settings), net: doc.total?.net ?? 0 }) : null
  if (sameSnap(r.offer || null, snap)) return { request: r, changed: false }
  const before = r.offer || {}
  const out = { ...r, offer: snap }
  let note = ''
  if (!snap) note = 'Angebot gelöscht'
  else if (snap.state !== before.state && ['angenommen', 'abgelehnt'].includes(snap.state)) note = `Angebot ${snap.number} ${snap.state}${snap.acceptedBy ? ` (online von ${snap.acceptedBy})` : ''}`
  else if (snap.number && snap.number !== before.number) note = `Angebot ${snap.number} festgeschrieben`
  else if (snap.id !== before.id) note = 'Angebot als Entwurf angelegt'
  if (note) out.history = [...(r.history || []), { at, by, text: note }]
  return { request: out, changed: true }
}

/**
 * Termine und Regieberichte mit der Kennung der Anfrage (ref „zl:<id>“) eintragen: dann gilt sie als beauftragt.
 * Liefert die geänderten Anfragen (neue Objekte).
 */
export function linkOrders(requests = [], { reports = [], appointments = [], at = new Date().toISOString() } = {}) {
  const out = []
  for (const r of requests) {
    if (r.ordered || r.declined) continue
    const ref = requestRef(r)
    const rep = (reports || []).find((x) => x?.ref === ref)
    const appt = rep ? null : (appointments || []).find((x) => x?.ref === ref && !x.cancelled)
    if (!rep && !appt) continue
    const ordered = rep ? { via: 'regie', id: rep.id, no: rep.no || '', date: rep.date || '', at, by: rep.createdBy || '' } : { via: 'termin', id: appt.id, date: String(appt.start || '').slice(0, 10), at, by: appt.createdBy || '' }
    out.push({ ...r, ordered, history: [...(r.history || []), { at, by: ordered.by, text: rep ? `Regiebericht ${rep.no || ''} angelegt`.trim() : `Termin am ${ordered.date.split('-').reverse().join('.')} eingetragen` }] })
  }
  return out
}

/**
 * Stand für den Kunden. offer: Angebot der Online-Annahme aus kundenbereich.json (offers), falls vorhanden.
 * abgelehnt bzw. erledigt (von Hand) vor beauftragt (Termin, Regiebericht, Vertriebsfall angenommen, Angebot
 * angenommen) vor „Angebot gesendet“ (festgeschrieben und gesendet oder online) vor eingegangen.
 */
export function requestStatus(r, { offer = null } = {}) {
  if (r.declined) return 'abgelehnt'
  if (r.done) return 'erledigt'
  const snap = r.offer
  if (r.ordered || offer?.acceptedAt || snap?.state === 'angenommen' || snap?.acceptedAt) return 'beauftragt'
  if ((offer?.publishedAt && !offer.revokedAt) || (snap?.number && (snap.sent || snap.online) && ['offen', 'abgelaufen'].includes(snap.state))) return 'angebot'
  return 'eingegangen'
}
export const isOpenRequest = (r) => OPEN_STATUS.includes(requestStatus(r))

/** Rückmeldung an den Kunden: die Begründung beim Ablehnen, sonst nichts (Maßnahmen und Preise bleiben intern). */
export const replyOf = (r) => (r.declined ? text(r.declined.reason, 1000) : '')

/**
 * Was der Webspace je Anfrage bekommt (aktion=anfrage-status). angebot: { id, nummer, n, c } mit dem versiegelten Code
 * (sealCode) – nur solange das Angebot online ist und nicht zurückgezogen.
 */
export function webStatus(r, { offer = null, angebot = null } = {}) {
  const status = requestStatus(r, { offer })
  return { id: r.webId, status, antwort: replyOf(r), angebot: ['angebot', 'beauftragt'].includes(status) ? angebot : null }
}

/** Kurzform für „schon übertragen?“ (ohne Code: steht in zusatzleistungen.json, die die Buchhaltung liest). */
export const statusSig = (s, linkStamp = '') => `${s.status}|${s.antwort}|${s.angebot ? `${s.angebot.id}:${s.angebot.nummer}:${linkStamp}` : ''}`

/** Kurzer Stand in der App: { key, label, cls }. */
export function requestState(r, opts = {}) {
  const key = requestStatus(r, opts)
  const cls = { eingegangen: 'warning', angebot: 'info', beauftragt: 'ok', erledigt: '', abgelehnt: '' }[key]
  return { key, label: STATUS[key], cls }
}

// ---------------------------------------------------------------- Angebotsentwurf

/** Kunde der Fakturierung für die Anfrage: eingetragen, sonst dem das Objekt zugeordnet ist. */
export function customerForRequest(r, customers = []) {
  const active = (customers || []).filter((c) => c && c.active !== false)
  return (r.customerId && active.find((c) => c.id === r.customerId)) || active.find((c) => (c.objectIds || []).includes(r.objectId)) || null
}

const M2 = /^(m²|m2|qm)$/i

/**
 * Felder für den Angebotsentwurf (die Fakturierung ergänzt Kunde, Texte, Nummernkreis und Gültigkeit wie bei jedem
 * Angebot). Mit Artikel der Art: Position aus dem Artikel, Preis aus der einen Preislogik (priceFor: Kundenpreis vor
 * Standardpreis, Kundenrabatt nur zum Standardpreis als Positionsrabatt), Menge = Fläche bei Einheit m²; ohne Artikel
 * eine Textposition mit der Beschreibung (Preis trägt das Büro ein). Dazu eine Textzeile mit Wunschtermin, Fläche und
 * Anfrage.
 */
export function offerFields(r, { fak = {}, settings = zusatzSettings(), customerId = '', date, vat = 20, newId = (i) => `l${i}` } = {}) {
  const kind = kindOf(settings, r.kindId)
  const article = kind?.articleId ? (fak.articles || []).find((a) => a.id === kind.articleId && a.active !== false) : null
  const title = `${r.kindName}${r.objectName ? ` – ${r.objectName}` : ''}`
  const details = [r.from ? `Wunschtermin: ${wishText(r)}` : '', r.area ? `Fläche laut Anfrage: ${String(r.area).replace('.', ',')} m²` : '', `Ihre Anfrage ${r.no} vom ${receivedDay(r.received).split('-').reverse().join('.')}`].filter(Boolean).join(' · ')
  const lines = [{ id: newId(1), type: 'title', text: title }]
  let priced = false
  if (article) {
    const p = priceFor(fak, customerId, article.id, date) || {}
    const line = lineFromArticle(article, { id: newId(2), vat })
    lines.push({ ...line, qty: r.area && M2.test(line.unit) ? r.area : 1, price: p.price ?? line.price, vat: p.vat ?? line.vat, discount: p.discount || 0, ...(r.text ? { longText: [line.longText, r.text].filter(Boolean).join('\n') } : {}) })
    priced = true
  } else {
    lines.push({ id: newId(2), text: r.kindName, longText: r.text, qty: 1, unit: 'Pauschale', price: '', vat, discount: 0 })
  }
  lines.push({ id: newId(3), type: 'text', text: details })
  return {
    title,
    objectId: r.objectId,
    objectName: r.objectName,
    lines,
    priced,
    source: { type: 'zusatzleistung', requestId: r.id, no: r.no, linkId: r.linkId },
  }
}

// ---------------------------------------------------------------- Vertriebsfall, Termin, Regiebericht

/** Vertriebsfall aus der Anfrage (größere Sachen): Stufe Anfrage, Quelle Bestandskunde, Objekt und Kontakt. */
export function caseFromRequest(r, { id, cases = [], today, customer = null, object = null, owner = '', at = new Date().toISOString(), by = '' } = {}) {
  return {
    id,
    no: nextCaseNo(cases, today.slice(0, 4)),
    stage: 'anfrage',
    requestDate: receivedDay(r.received),
    source: 'bestandskunde',
    customerId: customer?.id || '',
    objectId: r.objectId,
    lead: { name: customer?.name || r.linkTitle || r.contact.name, contact: r.contact.name, phone: r.contact.phone, email: r.contact.email },
    site: { name: object?.name || r.objectName, address: object?.address || '' },
    title: `${r.kindName}${r.objectName ? ` ${r.objectName}` : ''}`,
    monthly: '',
    note: [`Anfrage ${r.no} aus dem Kundenbereich`, r.from ? `Wunschtermin: ${wishText(r)}` : '', r.area ? `Fläche: ${String(r.area).replace('.', ',')} m²` : '', r.text].filter(Boolean).join('\n'),
    next: { text: 'Besichtigung vereinbaren', date: today },
    owner,
    visit: { rooms: [], photos: [] },
    history: [{ at, by, text: `aus Anfrage ${r.no} im Kundenbereich (${r.kindName})` }],
  }
}

/** Entwurf für den Termin (Termine → Outlook; ref verbindet ihn mit der Anfrage). */
export function appointmentDraft(r, { today }) {
  const date = r.from && r.from >= today ? r.from : today
  return {
    title: `${r.kindName}${r.objectName ? ` ${r.objectName}` : ''}`,
    kind: 'kunde',
    start: `${date}T08:00`,
    end: `${date}T12:00`,
    allDay: false,
    objectId: r.objectId,
    location: '',
    note: [`Anfrage ${r.no} aus dem Kundenbereich`, r.to && r.to !== r.from ? `Zeitraum: ${wishText(r)}` : '', r.contact.name ? `Ansprechperson: ${contactLine(r.contact)}` : '', r.text].filter(Boolean).join('\n'),
    attendees: [],
    employeeIds: [],
    online: false,
    reminder: 60,
    responseRequested: true,
    ref: requestRef(r),
  }
}

/** Art des Regieberichts zur Art der Anfrage (core/regie.js REGIE_KINDS). */
export const REGIE_KIND = { grundreinigung: 'grundreinigung', sonder: 'sonder', glas: 'zusatz', teppich: 'zusatz', winter: 'zusatz' }

/** Entwurf für den Regiebericht (offen; Datum heute, Stunden und Unterschrift kommen vor Ort dazu). */
export function regieDraft(r, { today }) {
  return {
    id: '',
    no: '',
    objectId: r.objectId,
    date: today,
    kind: REGIE_KIND[r.kindId] || 'sonstige',
    title: r.kindName,
    description: [r.text, r.area ? `Fläche laut Anfrage: ${String(r.area).replace('.', ',')} m²` : ''].filter(Boolean).join('\n'),
    orderedBy: r.contact.name,
    orderedRole: 'Kunde',
    orderRef: `Anfrage ${r.no}`,
    workers: [],
    material: [],
    photos: [],
    status: 'offen',
    ref: requestRef(r),
  }
}

// ---------------------------------------------------------------- Rechte

/**
 * Was die Person mit Anfragen darf. Sehen: wer den Kundenbereich verwaltet (Reklamationen oder Einsatzplanung
 * bearbeiten) oder die Fakturierung sieht. Abholen und den Stand zurückmelden nur mit dem Schlüssel des Webspace (Rollen
 * des Kundenbereichs). Angebot: Fakturierung bearbeiten; Vertriebsfall: Vertrieb bearbeiten; Termin bzw. Regiebericht:
 * Termine bzw. Regieberichte bearbeiten. Ablehnen und erledigt: Kundenbereich oder Fakturierung bearbeiten.
 * Ohne access (Browser-Modus ohne Rollen): alles.
 */
export function requestRights(access) {
  if (!access || access.all) return { view: true, portal: true, offer: true, case: true, termin: true, regie: true, decide: true, settings: true }
  const edits = (m) => access.canEdit(m)
  const portal = edits('reklamationen') || edits('planung')
  return {
    view: portal || access.sees('fakturierung'),
    portal,
    offer: edits('fakturierung'),
    case: edits('vertrieb'),
    termin: edits('termine'),
    regie: edits('regie'),
    decide: portal || edits('fakturierung'),
    settings: portal,
  }
}

// ---------------------------------------------------------------- Code des Angebots für die Seite des Links

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => new Uint8Array((String(s).match(/../g) || []).map((h) => parseInt(h, 16)))

async function keystream(linkToken, nonce) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(linkToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`zl-angebot|${nonce}`)))
}

/**
 * Code des Angebots (höchstens 32 Zeichen) mit dem Code des Links verschlüsseln: HMAC-SHA-256(Code des Links,
 * „zl-angebot|nonce“) als Schlüsselstrom, XOR, hex. Der Webspace kennt vom Link nur den Hashwert und kann den Code des
 * Angebots darum nicht lesen; die Seite des Links (aufgerufen mit ihrem Code) schon. Gegenstück in kunden.php
 * (anfrage_angebot_code).
 */
export async function sealCode(code, linkToken, nonce) {
  const data = new TextEncoder().encode(String(code))
  if (data.length > 32) throw new Error('Code zu lang')
  const ks = await keystream(linkToken, nonce)
  return hex(data.map((b, i) => b ^ ks[i]))
}

/** Gegenstück zu sealCode (für Tests; am Webspace macht das kunden.php). */
export async function openCode(sealed, linkToken, nonce) {
  const ks = await keystream(linkToken, nonce)
  return new TextDecoder().decode(unhex(sealed).map((b, i) => b ^ ks[i]))
}

/** Zufälliger nonce (16 Hex-Zeichen) je Versiegeln. */
export const newNonce = (random = (n) => crypto.getRandomValues(new Uint8Array(n))) => hex(random(8))
