// Mattenwechsel: Lieferschein je abgeschlossenem Stopp (P12) und sein Versand und seine Ablage (P13) – rein rechnend,
// ohne Oberfläche (Tests: test/matten-lieferschein.test.js). Plan: docs/MATTENWECHSEL-PLAN.md, Abschnitte 3.2, 4.1–4.3,
// 5.1 und 6; Entscheidungen E10 (Versand nach Prüfung im Büro, je Kunde „automatisch“) und E13 (Nummer LS-2026-000123,
// gemeinsamer Nummernkreis mit den Lieferscheinen der Fakturierung, 6 Stellen).
//
// Der Lieferschein ist ein ganz normaler Beleg der Fakturierung (fakturierung/fakturierung.json → documents[]):
//   { kind: 'lieferschein', number: 'LS-2026-000123' (Nummernkreis LS, finalize), date (Tag des Abschlusses in Wien),
//     serviceFrom, customerId, objectId, objectName, recipient (aus dem Kunden der Fakturierung), deliveryAddress
//     (Adresse des Objekts), hidePrices: true, title, intro (Datum, Uhrzeit, Fahrer), outro (Bemerkungen und
//     Abweichungen), lines (je Liegeplatz ein Titel, darunter je Mattentyp eine Position mit der tatsächlichen
//     Stückzahl und dem beim Erstellen gültigen Preis, nicht Gewechseltes als Text), receipt (Unterschrift bzw. ohne
//     Unterschrift mit Grund; zählt zur Prüfsumme, FIXED_OPTIONAL), checksum,
//     source { type: 'matten', key: 'matten:<tourId>:<stopId>', tourId, stopId, … } (Schlüssel gegen Doppel),
//     archive { itemId, webUrl, path, uploadedAt } (PDF in SharePoint), sent [{ at, to, via, by, mode }],
//     integration { ablage: { status: 'offen' | 'ok' | 'fehler', tries, lastError, at, queued? },
//                   mail: { status: 'ok' | 'fehler', to, at, by, tries, lastError } } }
//   Position: { id, type: 'item', text, longText, articleId, articleNo, qty (Ist), unit: 'Stk', price (eingefroren),
//     vat, discount, source { type: 'matten', key: '<tourId>:<stopId>:<placementId>:<Mattentyp>', jobKey,
//     alsoJobKeys?, placementId, articleId, tourId, stopId, price: 'kunde' | 'standard' | 'fehlt' } }
// Am Stopp (Tour-Datei, für Rollen ohne Fakturierung): deliveryNote { state: 'offen' | 'keiner' | 'erstellt' |
//   'versendet', docId?, number?, at?, by?, reason?, sentAt? }.
//
// Erstellen darf, wer den Mattenwechsel und die Fakturierung bearbeitet (Vollzugriff oder eine Rolle mit beiden): die
// Fahrer schließen nur ab, die Rolle „Mattenwechsel Büro“ allein sieht den Stand.

import { customerName, deDate, deliveryNoteEmailOf, finalize, mattenOf, parseNumber, priceFor, recipientOf, round2 } from './invoicing.js'
import { fileSafe } from './filename.js'
import { isFinal, localDate, localTime, OUTCOMES, placementsOf } from './matten-fahrt.js'

export const LS_DIGITS = 6
export const SOURCE_TYPE = 'matten'
export const ARCHIVE_ROOT = 'Mattenwechsel/Kunden'
/** Stand eines abgeschlossenen Stopps. */
export const NOTE_STATES = { offen: 'ohne Lieferschein', keiner: 'kein Lieferschein', erstellt: 'nicht versendet', versendet: 'versendet' }
/** Filter der Büro-Ansicht. */
export const NOTE_FILTERS = { offen: 'Ohne Lieferschein', erstellt: 'Erstellt, nicht versendet', versendet: 'Versendet', ablage: 'Ablage fehlgeschlagen', alle: 'Alle' }
export const MAIL_MODES = { kunde: 'An Kunden', buero: 'An Büro', beide: 'An beide' }
export const ARCHIVE_STATES = { offen: 'Ablage wartet', ok: 'abgelegt', fehler: 'Ablage fehlgeschlagen' }

const text = (v) => String(v ?? '').trim()
const int = (v) => Math.max(0, Math.round(Number(v) || 0))
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const actualOf = (it) => (it.actual === null || it.actual === undefined || it.actual === '' ? int(it.planned) : int(it.actual))
const exchanged = (it) => (it?.status === 'gewechselt' ? actualOf(it) : 0)

// ---------------------------------------------------------------- Schlüssel

/** Schlüssel des Lieferscheins eines Stopps (source.key am Beleg): matten:<tourId>:<stopId>. */
export const noteKey = (tourId, stopId) => `${SOURCE_TYPE}:${tourId}:${stopId}`
/** Schlüssel einer Position: <tourId>:<stopId>:<placementId>:<Mattentyp> – eindeutig je Liegeplatz und Mattentyp. */
export const lineKey = (tourId, stopId, placementId, mat) => `${tourId}:${stopId}:${placementId || 'ohne'}:${mat || 'ohne'}`

/** Lieferschein des Stopps unter allen Belegen (über source.key und die Positionen; festgeschriebener zuerst); sonst null. */
export function findNote(docs = [], tourId, stopId) {
  const key = noteKey(tourId, stopId)
  const prefix = `${tourId}:${stopId}:`
  const hits = (docs || []).filter((d) => d?.kind === 'lieferschein' && ((d.source?.type === SOURCE_TYPE && d.source.key === key) || (d.lines || []).some((l) => l.source?.type === SOURCE_TYPE && String(l.source.key || '').startsWith(prefix))))
  return hits.sort((a, b) => (b.number ? 1 : 0) - (a.number ? 1 : 0) || String(a.number || '').localeCompare(String(b.number || '')))[0] || null
}

/**
 * Lieferscheine je Anfang eines Positionsschlüssels bis zu einem Doppelpunkt ('<tourId>:', '<tourId>:<stopId>:', …), in der
 * Reihenfolge der Belege: findNote über diese Liste ergibt dasselbe wie über alle Belege, sofern kein Beleg den Stopp über
 * source.key trifft (notesByKey). Ungewöhnliche Daten: null (dann über alle Belege).
 */
function notesByLinePrefix(docs = []) {
  try {
    const out = new Map()
    for (const d of docs || []) {
      if (d?.kind !== 'lieferschein') continue
      for (const l of d.lines || []) {
        if (l.source?.type !== SOURCE_TYPE) continue
        const k = String(l.source.key || '')
        for (let i = k.indexOf(':'); i >= 0; i = k.indexOf(':', i + 1)) {
          const list = out.get(k.slice(0, i + 1))
          if (!list) out.set(k.slice(0, i + 1), [d])
          else if (list.at(-1) !== d) list.push(d)
        }
      }
    }
    return out
  } catch {
    return null
  }
}

/** Alle Lieferscheine aus dem Mattenwechsel (Map Schlüssel → Beleg). */
export function notesByKey(docs = []) {
  const out = new Map()
  for (const d of docs || []) if (d?.kind === 'lieferschein' && d.source?.type === SOURCE_TYPE && d.source.key && (!out.has(d.source.key) || (d.number && !out.get(d.source.key).number))) out.set(d.source.key, d)
  return out
}

// ---------------------------------------------------------------- Braucht der Stopp einen Lieferschein?

/** Matten gewechselt (Ist) eines Stopps. */
export const exchangedOf = (stop) => (stop?.items || []).reduce((s, it) => s + exchanged(it), 0)

/**
 * Braucht der Stopp einen Lieferschein? { needed, reason }: nur abgeschlossene Stopps (auch „teilweise“) mit mindestens
 * einer gewechselten Matte. „Kunde nicht angetroffen“, „nicht durchgeführt“ oder nichts gewechselt: kein Lieferschein,
 * reason sagt warum (Vermerk am Stopp).
 */
export function noteNeeded(stop) {
  if (!stop || !isFinal(stop)) return { needed: false, reason: 'Stopp noch nicht abgeschlossen' }
  if (exchangedOf(stop) > 0) return { needed: true, reason: '' }
  if (stop.status === 'nicht-angetroffen') return { needed: false, reason: OUTCOMES['nicht-angetroffen'] }
  if (stop.status === 'nicht-durchgefuehrt') return { needed: false, reason: OUTCOMES['nicht-durchgefuehrt'] }
  return { needed: false, reason: 'keine Matte gewechselt' }
}

/**
 * Stand des Lieferscheins eines abgeschlossenen Stopps: 'offen' (fehlt noch), 'keiner' (nicht nötig), 'erstellt'
 * (nicht versendet), 'versendet'. Mit docs (Belege der Fakturierung) zählt der Beleg, sonst die Kopie am Stopp.
 */
export function noteStateOf(tour, stop, docs = null) {
  const doc = docs ? findNote(docs, tour?.id, stop?.id) : null
  if (doc?.number) return (doc.sent || []).length ? 'versendet' : 'erstellt'
  const own = stop?.deliveryNote?.state
  if (!docs && (own === 'erstellt' || own === 'versendet')) return own
  return noteNeeded(stop).needed ? 'offen' : 'keiner'
}

// ---------------------------------------------------------------- Positionen und Bemerkungen

const matText = (mat, article) => text(article?.name) || text(mat?.name) || [text(mat?.size), text(mat?.color)].filter(Boolean).join(', ') || 'Matte'
const matShort = (mat) => [text(mat?.size), text(mat?.color)].filter(Boolean).join(', ') || text(mat?.name) || 'Matte'
const placeTitle = (p) => `Liegeplatz ${p.placementName || 'ohne Name'}${p.floor ? ` (${p.floor})` : ''}`

/**
 * Positionen des Lieferscheins aus dem Stopp: je Liegeplatz ein Titel, darunter je Mattentyp eine Position mit der
 * tatsächlich gewechselten Stückzahl und dem Preis, der am Tag des Abschlusses gilt (priceFor: Kundenpreis vor
 * Standardpreis, eingefroren); was nicht gewechselt wurde, steht als Text darunter (kein Betrag). data: Fakturierung
 * ({ customers, articles, customerPrices, settings }). Liefert { lines, warnings }.
 */
export function noteLines({ tour, stop, data = {}, customerId = '', date }) {
  const lines = []
  const warnings = []
  const articles = data.articles || []
  let n = 0
  const id = () => `${stop.id}-${++n}`
  for (const p of placementsOf(stop)) {
    const items = new Map()
    const missing = []
    p.items.forEach((it, i) => {
      const key = it.mat?.articleId || (it.mat ? `m${i + 1}` : '')
      const qty = exchanged(it)
      if (qty > 0) {
        const cur = items.get(key) || { it, qty: 0, planned: 0 }
        cur.qty += qty
        cur.planned += int(it.planned)
        items.set(key, cur)
      } else if (int(it.planned) > 0) missing.push({ it, planned: int(it.planned) })
    })
    if (!items.size && !missing.length) continue
    lines.push({ id: id(), type: 'title', text: placeTitle(p) })
    for (const [key, { it, qty, planned }] of items) {
      const article = it.mat?.articleId ? articles.find((a) => a.id === it.mat.articleId) || null : null
      const price = it.mat?.articleId ? priceFor(data, customerId, it.mat.articleId, date) : null
      if (!price) warnings.push(`${p.placementName || 'Liegeplatz'}: kein Preis für „${matShort(it.mat)}“ (Mattentyp fehlt in der Fakturierung), Preis 0.`)
      const longText = [qty !== planned ? `Soll ${planned}, gewechselt ${qty}` : ''].filter(Boolean).join(' · ')
      lines.push({
        id: id(),
        type: 'item',
        text: matText(it.mat, article),
        ...(longText ? { longText } : {}),
        ...(article?.articleNo ? { articleNo: article.articleNo } : {}),
        ...(it.mat?.articleId ? { articleId: it.mat.articleId } : {}),
        qty,
        unit: 'Stk',
        price: price ? price.price : 0,
        vat: price ? price.vat : Number(data.settings?.vat ?? 20),
        discount: price ? price.discount || 0 : 0,
        source: {
          type: SOURCE_TYPE,
          key: lineKey(tour.id, stop.id, p.placementId, key),
          ...(it.jobKey ? { jobKey: it.jobKey } : {}),
          ...(it.alsoJobKeys?.length ? { alsoJobKeys: [...it.alsoJobKeys] } : {}),
          placementId: p.placementId || '',
          articleId: it.mat?.articleId || '',
          tourId: tour.id,
          stopId: stop.id,
          price: price ? price.source : 'fehlt',
        },
      })
    }
    for (const { it, planned } of missing) {
      const why = it.reason || (it.status === 'gewechselt' ? 'Menge 0' : 'nicht gewechselt')
      lines.push({ id: id(), type: 'text', text: `Nicht gewechselt: ${planned} × ${matShort(it.mat)} – ${why}` })
    }
  }
  return { lines, warnings }
}

/** Bemerkungen für den Lieferschein: Bemerkung zum Stopp, je Liegeplatz, Abweichungen und Gründe, Ausnahme. Text, mehrzeilig. */
export function noteRemarks(stop) {
  const out = []
  if (stop?.outcome && OUTCOMES[stop.outcome]) out.push(`Abschluss: ${OUTCOMES[stop.outcome]}.`)
  if (text(stop?.note)) out.push(text(stop.note))
  for (const p of placementsOf(stop)) if (p.note) out.push(`${p.placementName || 'Liegeplatz'}: ${p.note}`)
  for (const d of stop?.deviations || []) {
    const what = matShort(d.mat)
    if (d.status === 'nicht-moeglich') out.push(`Abweichung ${d.placementName || 'Liegeplatz'}: ${d.planned} × ${what} nicht gewechselt${d.reason ? ` (${d.reason})` : ''}.`)
    else if (d.diff) out.push(`Abweichung ${d.placementName || 'Liegeplatz'}: ${d.actual} statt ${d.planned} × ${what} gewechselt.`)
  }
  return out.length ? `Bemerkungen:\n${out.join('\n')}` : ''
}

/** Bestätigung am Lieferschein: Unterschrift { name, role, at, svg } oder ohne Unterschrift { unsigned: true, reason, at }. */
export function receiptOf(stop) {
  if (stop?.signature?.svg) return { name: text(stop.signature.name), role: text(stop.signature.role), at: stop.signature.at || stop.finishedAt || '', svg: stop.signature.svg }
  return { unsigned: true, reason: text(stop?.unsigned?.reason) || 'ohne Angabe', at: stop?.unsigned?.at || stop?.finishedAt || '' }
}

// ---------------------------------------------------------------- Beleg

/** Einstellungen der Fakturierung für die Nummer: Stellen der Lieferscheine vorgegeben 6 (numberDigits), wenn nicht anders eingestellt. */
export function numberSettings(settings = {}) {
  const nd = settings.numberDigits || {}
  return nd.lieferschein ? settings : { ...settings, numberDigits: { ...nd, lieferschein: LS_DIGITS } }
}
/** Muss die Vorgabe (6 Stellen) in die Einstellungen der Fakturierung, damit Lieferscheine von Hand gleich aussehen? */
export const digitsMissing = (settings = {}) => !settings.numberDigits?.lieferschein

/** Kunde der Fakturierung zum Stopp (über die Kennung der Kopie), sonst null. */
export const customerOfStop = (data = {}, stop) => (data.customers || []).find((c) => c.id === stop?.customer?.id) || null

/**
 * Entwurf des Lieferscheins zu einem abgeschlossenen Stopp (noch ohne Nummer). data: Fakturierung. Liefert
 * { doc, warnings }. Empfänger aus dem Kunden der Fakturierung; fehlt er, die Kopie am Stopp mit der Objektadresse.
 */
export function noteDraft({ tour, stop, data = {}, id, now = new Date().toISOString(), by = '' }) {
  const customer = customerOfStop(data, stop)
  const date = localDate(stop.finishedAt) || tour.date
  const time = localTime(stop.finishedAt)
  const { lines, warnings } = noteLines({ tour, stop, data, customerId: customer?.id || stop.customer?.id || '', date })
  const recipient = customer ? recipientOf(customer) : { name: text(stop.customer?.name), address: text(stop.address), uid: '', email: text(stop.customer?.deliveryNoteEmail), customerNo: text(stop.customer?.no), consumer: false }
  if (!customer) warnings.push(`${recipient.name ? `Kunde „${recipient.name}“` : 'Der Kunde'} ist nicht in der Fakturierung: Empfänger aus der Tour.`)
  if (customer && !recipient.address) recipient.address = text(stop.address)
  const driver = text(tour.driverName) || text(stop.finishedBy)
  const doc = {
    id,
    kind: 'lieferschein',
    status: 'entwurf',
    date,
    serviceFrom: date,
    serviceTo: '',
    dueDate: '',
    customerId: customer?.id || stop.customer?.id || '',
    objectId: stop.objectId || '',
    objectName: text(stop.objectName),
    recipient,
    deliveryAddress: text(stop.address),
    reverseCharge: !!customer?.reverseCharge,
    discount: 0,
    hidePrices: true,
    title: `Mattenwechsel ${text(stop.objectName) || recipient.name}`.trim(),
    intro: `Mattenwechsel am ${deDate(date)}${time ? ` um ${time} Uhr` : ''}${driver ? `, Fahrer: ${driver}` : ''}.`,
    outro: noteRemarks(stop),
    lines,
    receipt: receiptOf(stop),
    source: {
      type: SOURCE_TYPE,
      key: noteKey(tour.id, stop.id),
      tourId: tour.id,
      stopId: stop.id,
      tourDate: tour.date || '',
      finishedAt: stop.finishedAt || '',
      time,
      driverId: stop.driverId || tour.driverId || '',
      driverName: driver,
      status: stop.status,
      ...(stop.outcome ? { outcome: stop.outcome } : {}),
      totals: { planned: (stop.items || []).reduce((s, it) => s + int(it.planned), 0), actual: exchangedOf(stop) },
    },
    createdAt: now,
    createdBy: by,
  }
  return { doc, warnings }
}

/**
 * Lieferschein zu einem Stopp erstellen und festschreiben (Nummer aus dem Nummernkreis LS, Prüfsumme). Idempotent: gibt es
 * zum Stopp schon einen Beleg (Schlüssel matten:<tourId>:<stopId>, über alle Belege geprüft), kommt dieser zurück und
 * nichts Neues entsteht. data: Fakturierung { documents, customers, articles, customerPrices, settings }.
 * Liefert { doc, created, warnings }. Wirft, wenn der Stopp keinen Lieferschein braucht oder Pflichtangaben fehlen.
 */
export function createNote({ tour, stop, data = {}, id, now = new Date().toISOString(), by = '' }) {
  const docs = data.documents || []
  const existing = findNote(docs, tour?.id, stop?.id)
  if (existing?.number) return { doc: existing, created: false, warnings: [] }
  const need = noteNeeded(stop)
  if (!need.needed) throw new Error(`Kein Lieferschein: ${need.reason}.`)
  const { doc, warnings } = noteDraft({ tour, stop, data, id: existing?.id || id, now, by })
  const customer = customerOfStop(data, stop)
  const fixed = finalize(doc, docs, numberSettings(data.settings || {}), { now, by, customer, user: by })
  return { doc: fixed, created: true, warnings }
}

// ---------------------------------------------------------------- Ablage in SharePoint

const pad2 = (n) => String(n).padStart(2, '0')
const segment = (s, fallback) => fileSafe(text(s)).replace(/^\.+/, '').slice(0, 60) || fallback

/** Dateiname: LS-2026-000123_<Kunde>_<Datum>.pdf (ohne Sonderzeichen). */
export function noteFileName(doc) {
  const name = segment(doc?.recipient?.name || customerName(doc?.recipient || {}), 'Kunde')
  return `${segment(doc?.number, 'Lieferschein')}_${name}_${isDate(doc?.date) ? doc.date : 'ohne-Datum'}.pdf`
}

/** Pfad ab der Bibliothek: Mattenwechsel/Kunden/<Kundennummer>/<Jahr>/<Monat>/Lieferscheine/<Datei>. */
export function notePath(doc) {
  const no = segment(doc?.recipient?.customerNo, 'ohne-Kundennummer')
  const date = isDate(doc?.date) ? doc.date : ''
  const year = date ? date.slice(0, 4) : 'ohne-Jahr'
  const month = date ? pad2(date.slice(5, 7)) : 'ohne-Monat'
  return `${ARCHIVE_ROOT}/${no}/${year}/${month}/Lieferscheine/${noteFileName(doc)}`
}

/** Stand der Ablage: 'ok' | 'offen' | 'fehler' | '' (noch nicht versucht). */
export const archiveState = (doc) => (doc?.archive?.itemId || doc?.integration?.ablage?.status === 'ok' ? 'ok' : doc?.integration?.ablage?.status || '')

const step = (doc, key, change) => {
  const prev = doc?.integration?.[key] || {}
  return { ...(doc.integration || {}), [key]: { ...change, tries: (Number(prev.tries) || 0) + 1 } }
}

/** Abgelegt (auch: lag schon dort): archive { itemId, webUrl, path, uploadedAt } und integration.ablage ok. */
export function markArchived(doc, { itemId = '', webUrl = '', path = notePath(doc), at = new Date().toISOString(), existed = false } = {}) {
  return { ...doc, archive: { itemId, webUrl, path, uploadedAt: at, ...(existed ? { existed: true } : {}) }, integration: step(doc, 'ablage', { status: 'ok', at, lastError: '' }) }
}
/** Ohne Netz in der Warteschlange: integration.ablage offen (wird nachgeholt). */
export function markArchiveQueued(doc, { path = notePath(doc), at = new Date().toISOString() } = {}) {
  return { ...doc, integration: step(doc, 'ablage', { status: 'offen', queued: true, path, at, lastError: '' }) }
}
/** Ablage fehlgeschlagen: integration.ablage fehler mit Text; der Lieferschein bleibt gültig. */
export function markArchiveFailed(doc, { error = '', at = new Date().toISOString() } = {}) {
  return { ...doc, integration: step(doc, 'ablage', { status: 'fehler', at, lastError: String(error?.message || error || 'unbekannter Fehler') }) }
}

// ---------------------------------------------------------------- Versand

/** Büro-Adresse für Lieferscheine (matten/matten.json → settings.officeEmail). */
export const officeEmailOf = (settings = {}) => text(settings?.officeEmail)

/**
 * Empfänger je Weg: kunde → Lieferschein-E-Mail des Kunden (sonst seine E-Mail, sonst die am Beleg), buero → Büro-Adresse
 * der Einstellungen, beide → An Kunde, Kopie Büro. Liefert { to, cc, missing: ['kunde' | 'buero'] }.
 */
export function mailRecipients({ doc, customer = null, settings = {}, mode = 'kunde' }) {
  const kunde = deliveryNoteEmailOf(customer) || text(doc?.recipient?.email)
  const buero = officeEmailOf(settings)
  const missing = []
  const want = (k, v) => {
    if (!emailOk(v)) missing.push(k)
    return emailOk(v) ? [v] : []
  }
  if (mode === 'buero') return { to: want('buero', buero), cc: [], missing }
  if (mode === 'beide') {
    const to = want('kunde', kunde)
    const cc = want('buero', buero)
    return to.length ? { to, cc: cc.filter((a) => a.toLowerCase() !== to[0].toLowerCase()), missing } : { to: cc, cc: [], missing }
  }
  return { to: want('kunde', kunde), cc: [], missing }
}

/** Betreff und Text der E-Mail zum Lieferschein. */
export function noteMail({ doc, sender = '', company = '' }) {
  const where = text(doc.objectName) || text(doc.recipient?.name)
  const subject = `Lieferschein ${doc.number} – Mattenwechsel${where ? ` ${where}` : ''} am ${deDate(doc.date)}`
  const textOut = [
    'Sehr geehrte Damen und Herren,',
    '',
    `im Anhang erhalten Sie den Lieferschein ${doc.number} zum Mattenwechsel am ${deDate(doc.date)}${doc.objectName ? ` (${doc.objectName})` : ''}.`,
    '',
    'Mit freundlichen Grüßen',
    ...[sender, company].filter(Boolean),
  ].join('\n')
  return { subject, text: textOut }
}

/** Stand des Versands: 'ok' (mindestens einmal gesendet), 'fehler' (letzter Versuch fehlgeschlagen) oder 'offen'. */
export function mailState(doc) {
  const m = doc?.integration?.mail
  if (m?.status === 'fehler') return 'fehler'
  if ((doc?.sent || []).length || m?.status === 'ok') return 'ok'
  return 'offen'
}

/** Versand vermerken: sent[] und integration.mail. via 'graph' | 'mailto'. */
export function markSent(doc, { to = [], cc = [], via = 'graph', by = '', at = new Date().toISOString(), mode = 'kunde', auto = false } = {}) {
  const all = [...to, ...cc]
  return {
    ...doc,
    sent: [...(doc.sent || []), { at, to: all.join('; '), via, by, mode, ...(auto ? { auto: true } : {}) }],
    integration: step(doc, 'mail', { status: 'ok', to: all, at, by, lastError: '' }),
  }
}
/** Versand fehlgeschlagen: integration.mail fehler (der Lieferschein bleibt, „Erneut senden“). */
export function markMailFailed(doc, { to = [], error = '', by = '', at = new Date().toISOString() } = {}) {
  return { ...doc, integration: step(doc, 'mail', { status: 'fehler', to, at, by, lastError: String(error?.message || error || 'unbekannter Fehler') }) }
}

/** Kunde mit „Lieferschein ohne Prüfung senden“ (customers[].matten.autoSend)? */
export const autoSendFor = (customer) => mattenOf(customer).autoSend

// ---------------------------------------------------------------- Stopp (Kopie für Rollen ohne Fakturierung)

/** deliveryNote am Stopp nach dem Erstellen bzw. Senden; reason bei „kein Lieferschein“. */
export function stopNote(doc, { state = 'erstellt', at = new Date().toISOString(), by = '', reason = '' } = {}) {
  if (state === 'keiner') return { state, reason, at, by }
  return { state: (doc?.sent || []).length ? 'versendet' : state, docId: doc.id, number: doc.number, at, by, ...((doc?.sent || []).length ? { sentAt: doc.sent.at(-1).at } : {}) }
}

/** Muss die Kopie am Stopp nachgeführt werden (Beleg erstellt/versendet, aber der Stopp weiß es nicht)? */
export function stopNeedsSync(stop, doc) {
  const own = stop?.deliveryNote || {}
  if (!doc?.number) return false
  const want = (doc.sent || []).length ? 'versendet' : 'erstellt'
  return own.state !== want || own.number !== doc.number
}

// ---------------------------------------------------------------- Liste im Büro

/**
 * Zeilen der Büro-Ansicht: je abgeschlossenem Stopp der geladenen Touren { tour, stop, date, time, state, doc, need,
 * archive, mail, customerName, objectName, driver, actual, planned }. from/to: Tag des Abschlusses (leer = alle).
 * docs: Belege der Fakturierung (null = ohne Recht: Stand aus der Kopie am Stopp).
 */
export function noteRows({ tours = [], docs = null, from = '', to = '' } = {}) {
  const byKey = docs ? notesByKey(docs) : null
  // ohne Beleg mit source.key bleibt die Suche über die Positionen: nur in den Lieferscheinen mit diesem Anfang (Index)
  let byLine
  const fromLines = (tourId, stopId) => {
    if (byLine === undefined) byLine = notesByLinePrefix(docs)
    return findNote(byLine ? byLine.get(`${tourId}:${stopId}:`) || [] : docs, tourId, stopId)
  }
  const out = []
  for (const tour of tours || []) {
    if (!tour || tour.status === 'entwurf') continue
    for (const stop of tour.stops || []) {
      if (!isFinal(stop)) continue
      const date = localDate(stop.finishedAt) || tour.date
      if ((from && date < from) || (to && date > to)) continue
      const doc = byKey ? byKey.get(noteKey(tour.id, stop.id)) || fromLines(tour.id, stop.id) : null
      const need = noteNeeded(stop)
      const state = noteStateOf(tour, stop, docs ? (doc ? [doc] : []) : null)
      out.push({
        tour,
        stop,
        key: noteKey(tour.id, stop.id),
        date,
        time: localTime(stop.finishedAt),
        state,
        doc,
        need,
        number: doc?.number || stop.deliveryNote?.number || '',
        archive: doc ? archiveState(doc) : '',
        mail: doc ? mailState(doc) : stop.deliveryNote?.state === 'versendet' ? 'ok' : 'offen',
        customerName: stop.customer?.name || '',
        customerNo: stop.customer?.no || '',
        objectName: stop.objectName || '',
        driver: tour.driverName || stop.finishedBy || '',
        actual: exchangedOf(stop),
        planned: (stop.items || []).reduce((s, it) => s + int(it.planned), 0),
      })
    }
  }
  return out.sort((a, b) => String(b.stop.finishedAt || b.date).localeCompare(String(a.stop.finishedAt || a.date)) || a.customerName.localeCompare(b.customerName, 'de'))
}

/** Passt eine Zeile zum Filter (NOTE_FILTERS)? */
export function rowMatches(row, filter = 'offen') {
  if (filter === 'alle') return true
  if (filter === 'ablage') return row.archive === 'fehler'
  if (filter === 'erstellt') return row.state === 'erstellt'
  if (filter === 'versendet') return row.state === 'versendet'
  return row.state === 'offen'
}

/** Zähler für Kacheln, „Zu erledigen“ und den digitalen Mitarbeiter. */
export function noteSummary(rows = []) {
  const out = { offen: 0, keiner: 0, erstellt: 0, versendet: 0, ablage: 0, mailFehler: 0, ablageOffen: 0 }
  for (const r of rows) {
    out[r.state] = (out[r.state] || 0) + 1
    if (r.archive === 'fehler') out.ablage++
    if (r.archive === 'offen') out.ablageOffen++
    if (r.mail === 'fehler') out.mailFehler++
  }
  return out
}

// ---------------------------------------------------------------- Rechte

/**
 * Was die Person mit Lieferscheinen darf: view (Mattenwechsel sehen), create und send (Mattenwechsel und Fakturierung
 * bearbeiten), hint (warum nicht). access: aus resolveAccess; ohne (Browser-Modus) alles.
 */
export function noteRights(access) {
  if (!access) return { view: true, create: true, send: true, hint: '' }
  const view = access.sees('matten')
  const both = access.canEdit('matten') && access.canEdit('fakturierung')
  const hint = both ? '' : !view ? 'Kein Recht auf den Mattenwechsel.' : !access.canEdit('fakturierung') ? 'Lieferscheine erstellt und sendet, wer zusätzlich die Fakturierung bearbeitet (Vollzugriff oder eine Rolle mit beiden Bereichen). Du siehst hier den Stand.' : 'Lieferscheine erstellt, wer den Mattenwechsel bearbeitet.'
  return { view, create: both, send: both, hint }
}

// ---------------------------------------------------------------- Kurztexte

export const stateText = (row) => (row.state === 'keiner' ? `${NOTE_STATES.keiner}: ${row.need?.reason || ''}`.replace(/: $/, '') : NOTE_STATES[row.state] || row.state)
export const totalsText = (row) => `${plural(row.actual, 'Matte', 'Matten')} von ${row.planned}`
export const priceSum = (doc) => round2((doc?.lines || []).filter((l) => (l.type || 'item') === 'item').reduce((s, l) => s + parseNumber(l.qty) * parseNumber(l.price), 0))
export { clone as cloneNote }
