// Fakturierung im Kundenbereich (kunden.php): Rechnungen und offene Posten je Link, Angebot online annehmen.
//
// Rechnungen: Je Link lässt sich einschalten, dass er die Belege bestimmter Kunden der Fakturierung zeigt
// (festgeschriebene Rechnungen, Storno- und Korrekturbelege der letzten Monate und alle noch offenen). Der
// Webspace bekommt je Beleg nur Nummer, Datum, Fälligkeit, Beträge, Stand und dasselbe PDF wie beim Versand;
// offene Rechnungen dazu die Bankverbindung und den EPC-QR-Code als Bild (von der App erzeugt). Keine Zahlung
// über die Seite.
//
// Angebot online annehmen: Für ein festgeschriebenes Angebot legt die App einen eigenen Code an (wie ein Link
// des Kundenbereichs, am Webspace nur als SHA-256). Die Seite zeigt Nummer, Datum, Summe, „gültig bis“ und das
// PDF; der Kunde nimmt mit Name, Funktion und Häkchen an (Unterschrift freiwillig). Gespeichert wird Zeitpunkt,
// Name, Funktion, Nummer und der SHA-256 des veröffentlichten PDF, keine IP-Adresse. Die App übernimmt die
// Annahme in doc.acceptance: außerhalb der Prüfsumme, der festgeschriebene Beleg selbst bleibt unverändert.
//
// Verbraucher: Ein online angenommenes Angebot ist ein Fernabsatzvertrag (FAGG: Rücktrittsrecht,
// Informationspflichten). Darum nur für Unternehmer, außer die Einstellung bestätigt, dass Angebote an
// Verbraucher die Belehrung und die Pflichtinformationen enthalten.
//
// Rein rechnend, ohne Netz testbar. Oberfläche: ui/views/invoicing-online.js, ui/views/customer-portal.js.

import { viennaDate } from './dates.js'
import { deDate, docFileName, epcPayload, formatIban, grossOf, ibanValid, intact, isCancelled, isInvoice, kindLabel, openAmount, round2, settingsOf, stateOf } from './invoicing.js'

// ---------------------------------------------------------------- Rechnungen im Kundenbereich

export const INVOICE_MONTHS = 13
export const INVOICE_MONTH_CHOICES = [3, 6, 13, 24]
/** Einstellung je Link (Standard: aus). */
export const invoiceDefaults = () => ({ on: false, customerIds: [], months: INVOICE_MONTHS })
export const invoiceSettings = (link = {}) => ({ ...invoiceDefaults(), ...(link.invoices || {}) })

/** Stand eines Belegs auf der Kundenseite (gleiche Schlüssel in kunden.php). */
export const PORTAL_STATES = { offen: 'offen', ueberfaellig: 'überfällig', teilbezahlt: 'teilweise bezahlt', bezahlt: 'bezahlt', storniert: 'storniert', verrechnet: 'verrechnet' }

/** Dateiname am Webspace: Belegart und Nummer, z. B. „rechnung-RE-2026-0005.pdf“ (keine Namen in der Adresse). */
export function invoiceFile(d) {
  const nr = String(d?.number || '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${d.kind}-${nr || 'beleg'}.pdf`
}
export const INVOICE_FILE_PATTERN = /^(rechnung|storno|korrektur)-[A-Za-z0-9-]{1,40}\.pdf$/

/** Kunden der Fakturierung, die zu den Objekten eines Links passen: meiste gemeinsame Objekte zuerst. */
export function suggestCustomers(customers = [], objectIds = []) {
  const ids = new Set(objectIds)
  return customers
    .filter((c) => c.active !== false)
    .map((c) => ({ c, n: (c.objectIds || []).filter((id) => ids.has(id)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || String(a.c.name || '').localeCompare(String(b.c.name || ''), 'de'))
    .map((x) => x.c)
}

/** Tag, ab dem Belege gezeigt werden: heute vor months Monaten (am Monatsende auf den letzten Tag gekürzt). */
export function sinceDate(today, months = INVOICE_MONTHS) {
  const [y, m, d] = today.split('-').map(Number)
  const idx = y * 12 + (m - 1) - Math.max(0, Number(months) || 0)
  const yy = Math.floor(idx / 12)
  const mm = (idx % 12) + 1
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/**
 * Belege für einen Link: festgeschriebene Rechnungen, Storno- und Korrekturbelege der gewählten Kunden aus den
 * letzten months Monaten und alle noch offenen Rechnungen (auch ältere). Nachträglich veränderte Belege
 * (Prüfsumme passt nicht) nie. Neueste zuerst.
 */
export function portalDocuments(docs = [], { customerIds = [], months = INVOICE_MONTHS, today, settings } = {}) {
  const ids = new Set(customerIds)
  if (!ids.size) return []
  const from = sinceDate(today, months)
  const s = settingsOf({ settings })
  return docs
    .filter((d) => isInvoice(d) && d.number && ids.has(d.customerId) && intact(d))
    .filter((d) => String(d.date || '') >= from || (d.kind === 'rechnung' && !isCancelled(d, docs) && openAmount(d, docs, s) > 0.004))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)))
}

/** Stand auf der Kundenseite: Rechnung wie in der Fakturierung, Storno- und Korrekturbeleg „verrechnet“. */
export function portalState(d, docs, today, settings) {
  if (d.kind !== 'rechnung') return 'verrechnet'
  const st = stateOf(d, docs, today, settings)
  return PORTAL_STATES[st] ? st : 'offen'
}

/** Wird die Rechnung per SEPA-Lastschrift eingezogen? (dann keine Überweisung, kein QR-Code) */
export const collectedByDebit = (d) => !!d.debitText || (!!d.directDebit && d.directDebit.status !== 'zurueck')

/** Text für die Signatur eines Belegs am Webspace: ändert sich nur mit dem Beleg (Prüfsumme), nicht mit Zahlungen. */
export const invoiceSigText = (d) => JSON.stringify(['v1', d.id, d.kind, d.number, d.checksum || '', d.date || ''])

/**
 * Was der Webspace je Beleg speichert (ohne Positionen und ohne Anschrift: die stehen im PDF). zahlung: nur bei
 * offenen Rechnungen mit gültiger IBAN, die nicht per Lastschrift eingezogen werden; qr: PNG (Base64) dazu.
 */
export function invoiceEntry(d, docs, { today, settings, sig = '', qr = '' } = {}) {
  const s = settingsOf({ settings })
  const state = portalState(d, docs, today, s)
  const open = d.kind === 'rechnung' && state !== 'storniert' && state !== 'bezahlt' ? Math.max(0, openAmount(d, docs, s)) : 0
  const sender = { ...s.sender, ...(d.sender || {}) }
  const debit = open > 0 && collectedByDebit(d)
  const zahlung = open > 0.004 && !debit && ibanValid(s.bank.iban) && sender.name ? { empfaenger: String(sender.name).slice(0, 70), iban: formatIban(s.bank.iban), bic: String(s.bank.bic || '').replace(/\s+/g, '').toUpperCase(), betrag: round2(open), zweck: d.number } : null
  return {
    datei: invoiceFile(d),
    art: d.kind,
    titel: kindLabel(d),
    nummer: d.number,
    betreff: String(d.title || '').slice(0, 120),
    datum: d.date || '',
    faellig: d.kind === 'rechnung' ? d.dueDate || '' : '',
    brutto: round2(grossOf(d, s)),
    offen: round2(open),
    status: state,
    bezug: d.refNumber || '',
    name: docFileName(d),
    sig,
    zahlung,
    lastschrift: debit,
    qr: zahlung ? qr : '',
  }
}

/** Inhalt des EPC-QR-Codes zu einem Eintrag (wie auf dem PDF, aber mit dem offenen Betrag). */
export const invoiceQrPayload = (entry) => (entry?.zahlung ? epcPayload({ name: entry.zahlung.empfaenger, iban: entry.zahlung.iban, bic: entry.zahlung.bic, amount: entry.zahlung.betrag, text: `Rechnung ${entry.nummer}` }) : null)

/**
 * QR-Code aus pdfmake (node._canvas nach dem Messen: Hintergrund, dann ein Rechteck je dunklem Modul) als Matrix
 * [[true, false, …], …]. So erzeugt die App das Bild für den Webspace mit demselben Kodierer wie im PDF.
 */
export function qrMatrixFromCanvas(canvas = []) {
  const [bg, ...cells] = canvas
  if (!bg || !cells.length) return null
  const mod = cells[0].w
  const n = Math.round(bg.w / mod)
  if (!(mod > 0) || n < 21 || n > 177) return null
  const m = Array.from({ length: n }, () => Array(n).fill(false))
  for (const c of cells) {
    const x = Math.round(c.x / mod)
    const y = Math.round(c.y / mod)
    if (x >= 0 && y >= 0 && x < n && y < n) m[y][x] = true
  }
  return m
}

// ---------------------------------------------------------------- Angebot online annehmen

/** Kennung eines Angebots am Webspace, z. B. „an3f9a1c07d2“. */
export function newOfferId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `an${[...random(5)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
export const OFFER_ID_PATTERN = /^an[a-f0-9]{10}$/
/** Link zum Angebot: nur der Code, nichts über den Kunden. */
export const offerLink = (address, token) => `${String(address).replace(/\/?$/, '/')}kunden.php?a=${encodeURIComponent(token)}`

/** Verbraucher laut Kunde oder Empfänger des Belegs. */
export const isConsumer = (doc, customer) => !!(customer?.consumer || doc?.recipient?.consumer)

/** Online-Annahme ist aktiv (übertragen, nicht zurückgezogen). */
export const onlineActive = (doc) => !!doc?.online?.id && !doc.online.revokedAt

/**
 * Im Büro entschieden (angenommen, abgelehnt oder Folgebeleg wie Auftragsbestätigung bzw. Rechnung erstellt), aber
 * der Link zur Online-Annahme ist noch aktiv und niemand hat online angenommen: Link zurückziehen.
 */
export const withdrawNeeded = (doc) => doc?.kind === 'angebot' && ['angenommen', 'abgelehnt'].includes(doc.status) && onlineActive(doc) && !doc.acceptance

/**
 * Darf das Angebot online angenommen werden? { ok, consumer, reason }. Verbraucher nur mit Einstellung
 * „onlineConsumers“ (Widerrufsbelehrung und Informationen nach FAGG stehen im Angebot).
 */
export function onlineCheck(doc, { customer = null, today, settings = {} } = {}) {
  const consumer = isConsumer(doc, customer)
  const no = (reason) => ({ ok: false, consumer, reason })
  if (doc?.kind !== 'angebot' || !doc.number) return no('Nur ein festgeschriebenes Angebot lässt sich online annehmen.')
  if (doc.acceptance) return no(`Das Angebot ist schon angenommen (${deDate(viennaDate(doc.acceptance.at) || String(doc.acceptance.at || '').slice(0, 10))}).`)
  if (doc.status === 'angenommen') return no('Das Angebot ist schon angenommen.')
  if (doc.status === 'abgelehnt') return no('Das Angebot ist als abgelehnt vermerkt.')
  if (!doc.validUntil) return no('Das Angebot hat kein „gültig bis“. Ohne Frist geht keine Online-Annahme.')
  if (doc.validUntil < today) return no(`Das Angebot ist abgelaufen (gültig bis ${deDate(doc.validUntil)}).`)
  if (consumer && !settings.onlineConsumers) return no('Der Kunde ist als Verbraucher eingetragen. Ein online angenommenes Angebot ist ein Fernabsatzvertrag (FAGG): mit Rücktrittsrecht und Informationspflichten. Online-Annahme erst, wenn in den Einstellungen bestätigt ist, dass Angebote an Verbraucher die Widerrufsbelehrung und diese Informationen enthalten.')
  return { ok: true, consumer, reason: '' }
}

/** Was der Webspace zum Angebot speichert (aktion=angebot): Kopfdaten, keine Positionen (die stehen im PDF). */
export function offerPayload({ doc, id, hash, consumer = false, sig = '' }) {
  const t = doc.total || {}
  return {
    id,
    hash,
    nummer: doc.number,
    datum: doc.date,
    gueltigBis: doc.validUntil,
    titel: String(doc.title || '').slice(0, 160),
    empfaenger: String(doc.recipient?.name || '').slice(0, 120),
    netto: round2(t.net),
    ust: round2(t.vat),
    brutto: round2(t.gross),
    verbraucher: !!consumer,
    name: docFileName(doc),
    sig,
  }
}

/** Unterschrift vom Webspace: Pfad aus Strichen „M12 30L14 31…“ (nur Zahlen, Leerzeichen, M und L). */
export const SIGNATURE_PATTERN = /^M[0-9. ML]{2,16000}$/
export const signatureOk = (s) => typeof s === 'string' && SIGNATURE_PATTERN.test(s)

/** Annahmen vom Webspace, die die App noch nicht kennt: [{ doc, entry }]. */
export function newAcceptances(list = [], docs = []) {
  const byOnline = new Map(docs.filter((d) => d.kind === 'angebot' && d.online?.id).map((d) => [d.online.id, d]))
  return list
    .filter((x) => x && OFFER_ID_PATTERN.test(String(x.id)) && x.annahme && byOnline.has(x.id) && !byOnline.get(x.id).acceptance)
    .map((entry) => ({ doc: byOnline.get(entry.id), entry }))
}

/**
 * Annahme → doc.acceptance (Hilfsdaten außerhalb der Prüfsumme). pdfOk: Der SHA-256 des angenommenen PDF ist der,
 * den die App beim Übertragen gerechnet hat, und die Nummer stimmt.
 */
export function acceptanceOf(entry, doc, { now = new Date().toISOString() } = {}) {
  const a = entry.annahme || {}
  const at = Number(a.zeit) ? new Date(Number(a.zeit) * 1000).toISOString() : now
  const sha = /^[a-f0-9]{64}$/.test(String(a.pdfSha256 || '')) ? a.pdfSha256 : ''
  return {
    via: 'online',
    at,
    name: String(a.name || '').slice(0, 80),
    role: String(a.funktion || '').slice(0, 80),
    number: String(a.nummer || ''),
    pdfSha256: sha,
    pdfOk: !!sha && sha === doc.online?.pdfSha256 && String(a.nummer || '') === doc.number,
    signature: signatureOk(a.unterschrift) ? a.unterschrift : '',
    receivedAt: now,
  }
}

/** Online angenommen, aber noch ohne Folgebeleg (Auftragsbestätigung oder Rechnung) und nicht als erledigt vermerkt. */
export const acceptedOpen = (docs = []) => docs.filter((d) => d.kind === 'angebot' && d.acceptance?.via === 'online' && !d.acceptance.doneAt && !docs.some((x) => x.refId === d.id && ['auftrag', 'rechnung'].includes(x.kind)))

/** E-Mail an den Kunden mit dem Link zum Angebot (Sie-Form). */
export function offerMail({ doc, url, company = '', sender = '', greeting = 'Sehr geehrte Damen und Herren', amount = '' }) {
  return {
    subject: `Angebot ${doc.number}${doc.title ? `: ${doc.title}` : ''}`,
    text: [
      `${greeting},`,
      '',
      `unser Angebot ${doc.number}${doc.title ? ` (${doc.title})` : ''}${amount ? ` über ${amount}` : ''} finden Sie unter diesem Link zum Ansehen, als PDF und zum Annehmen:`,
      url,
      '',
      `Das Angebot gilt bis ${deDate(doc.validUntil)}. Wenn es für Sie passt, können Sie es dort direkt verbindlich annehmen; eine Anmeldung ist nicht nötig.`,
      '',
      'Bei Fragen melden Sie sich gerne.',
      '',
      'Mit freundlichen Grüßen',
      sender,
      company,
    ]
      .filter((x, i, all) => x !== '' || all[i - 1] !== '')
      .join('\n')
      .trim(),
  }
}
