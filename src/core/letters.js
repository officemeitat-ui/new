// Geschäftsbriefe und Serienbriefe der Fakturierung (wie „Briefe“ in orgaMAX): Brief an einen Kunden (wahlweise an
// einen Ansprechpartner) mit Betreff, Text, Textbausteinen und Platzhaltern; Serienbrief an viele Kunden nach Gruppe,
// Objekt oder an alle aktiven Kunden. Reine Funktionen (Oberfläche: ui/views/invoicing-briefe.js, PDF:
// export/letter-pdf.js auf dem Briefpapier aus export/letterhead.js).
//
// Datenmodell in fakturierung/fakturierung.json (ergänzt das Modell in core/invoicing.js, alle Felder optional):
//  letters[]  { id, customerId, contactId, contactName, objectId, objectName, date, subject, text, mailText,
//               recipient: { name, address, email, customerNo }, author (Bearbeiter), status ('entwurf' | 'versendet' |
//               'gedruckt'), sent: [{ at, to, via ('graph' | 'mailto'), by }], printedAt, pdfPath (SharePoint),
//               serialId (Teil eines Serienbriefs: Text steht dort), createdAt, createdBy }
//             Gesendete bzw. gedruckte Briefe haben Betreff und Text mit aufgelösten Platzhaltern (wie versendet).
//  serials[]  { id, date, subject, text, mailText, advertising (Werbung: Hinweis § 174 TKG 2021), filter: { scope,
//               group, objectId, type, role, search }, excluded: [Kunden-id], createdAt, createdBy,
//               results: [{ customerId, letterId, via ('graph' | 'mailto' | 'druck'), to, at, error }],
//               values { [Kunden-id]: { Platzhalter: Wert } } (Werte je Empfänger, z. B. Preise der Preisanpassung aus
//               core/vertraege.js), source { type, runId } (woher der Serienbrief kommt); filter.ids: nur diese Kunden }
//  customers[] dazu noAds (Werbung per E-Mail abgelehnt) und active (false: Kunde inaktiv)

import { fileSafe } from './filename.js'
import { composeAddress, customerMatches, customerName, DEFAULT_GREETING, fillPlaceholders, greetingOf, personLine, placeholderContext } from './invoicing.js'

export const LETTER_TEXT = '{Anrede},\n\n\n\nMit freundlichen Grüßen\n\n{Benutzer}\n{Firma}'
export const LETTER_MAIL_TEXT = '{Anrede},\n\nanbei erhalten Sie unser Schreiben „{Betreff}“ als PDF.\n\nMit freundlichen Grüßen\n{Benutzer}\n{Firma}'
export const LETTER_STATUS = { entwurf: 'Entwurf', versendet: 'per E-Mail', gedruckt: 'als PDF' }

/** Platzhalter, die in Briefen einen Wert haben (Auswahl aus PLACEHOLDERS in core/invoicing.js). */
export const LETTER_PLACEHOLDERS = ['Anrede', 'Kunde', 'Ansprechpartner', 'Kundennummer', 'Datum', 'Betreff', 'Objekt', 'Firma', 'Benutzer', 'IBAN', 'Heute']

const SALUTATIONS = { herr: 'Herr', herrn: 'Herr', hr: 'Herr', frau: 'Frau', fr: 'Frau', familie: 'Familie' }
// akademische Grade vor dem Namen (mit Punkt erkannt) und nach dem Namen (z. B. „Eva Huber, MBA“)
const PRE_TITLES = new Set(['di', 'dipl.-ing.', 'ing.', 'mag.', 'mag.a', 'mmag.', 'dr.', 'dr.in', 'ddr.', 'prof.', 'univ.-prof.', 'bakk.', 'kommr', 'kommr.', 'dkfm.', 'ök.-rat'])
const POST_TITLES = /,?\s+(MBA|MSc|BSc|BA|MA|PhD|LL\.?M\.?|MAS|BEd|MEd)\.?$/i

/** „Frau Mag. Eva Huber, MBA“ → { salutation: 'Frau', title: 'Mag.', firstName: 'Eva', lastName: 'Huber' } */
export function splitContactName(name = '') {
  let rest = String(name || '').trim()
  while (POST_TITLES.test(rest)) rest = rest.replace(POST_TITLES, '').trim()
  const words = rest.split(/\s+/).filter(Boolean)
  const out = { salutation: '', title: '', firstName: '', lastName: '' }
  if (words.length && SALUTATIONS[words[0].toLowerCase().replace(/\.$/, '')]) out.salutation = SALUTATIONS[words.shift().toLowerCase().replace(/\.$/, '')]
  const titles = []
  while (words.length > 1 && (PRE_TITLES.has(words[0].toLowerCase()) || /^[A-Za-zÄÖÜäöü.-]+\.$/.test(words[0]))) titles.push(words.shift())
  out.title = titles.join(' ')
  out.lastName = words.pop() || ''
  out.firstName = words.join(' ')
  return out
}

/** Anrede für einen Ansprechpartner („Sehr geehrte Frau Mag. Huber“); ohne Herr/Frau im Namen die des Kunden. */
export function contactGreeting(contact, customer = {}) {
  const p = splitContactName(contact?.name)
  if (contact?.name && p.salutation && p.lastName) return greetingOf(p)
  return greetingOf(customer || {})
}

const contactOf = (customer, id) => (id ? (customer?.contacts || []).find((p) => p.id === id) || null : null)

/**
 * Empfänger des Briefs: Name, Anschrift (mit „z. H. Ansprechpartner“), E-Mail (des Ansprechpartners, sonst des
 * Kunden), Kundennummer.
 */
export function letterRecipient(customer = {}, contact = null) {
  const name = customerName(customer)
  let address = composeAddress(customer)
  if (contact?.name && customer?.name) {
    const rest = address.split('\n').filter((l) => !/^z\.\s*h\.?/i.test(l.trim()))
    address = [`z. H. ${contact.name}`, ...rest].filter(Boolean).join('\n')
  }
  const email = [contact?.email, customer?.email].find((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim())) || ''
  return { name: name || personLine(customer), address, email: String(email).trim(), customerNo: customer?.customerNo || '' }
}

/**
 * Werte der Platzhalter für einen Brief: wie bei Belegen ({Kunde}, {Firma}, {Benutzer} …), dazu {Betreff} und
 * {Datum} des Briefs und {Anrede} für den gewählten Ansprechpartner.
 */
export function letterContext({ letter = {}, customer = null, settings = {}, user = '', today = '', extra = null } = {}) {
  const contact = contactOf(customer, letter.contactId) || (letter.contactName ? { name: letter.contactName } : null)
  const rec = letter.recipient?.name ? letter.recipient : letterRecipient(customer || {}, contact)
  const ctx = placeholderContext({ doc: { recipient: rec, contactName: contact?.name || '', date: letter.date || today, title: '', objectName: letter.objectName || '' }, customer, settings, user, today })
  return { ...ctx, Belegart: 'Brief', Betreff: letter.subject || '', Anrede: contact ? contactGreeting(contact, customer) : greetingOf(customer || {}) || DEFAULT_GREETING, ...(extra || {}) }
}

/**
 * Brief mit aufgelösten Platzhaltern (Betreff zuerst, damit {Betreff} im Text den fertigen Betreff zeigt):
 * { subject, text, mailText, recipient }. extra: weitere Werte je Empfänger (Serienbrief, values).
 */
export function resolveLetter(letter = {}, { customer = null, settings = {}, user = '', today = '', extra = null } = {}) {
  const ctx0 = letterContext({ letter, customer, settings, user, today, extra })
  const subject = fillPlaceholders(letter.subject, ctx0).trim()
  const ctx = { ...ctx0, Betreff: subject }
  const contact = contactOf(customer, letter.contactId) || (letter.contactName ? { name: letter.contactName } : null)
  return { subject, text: fillPlaceholders(letter.text, ctx), mailText: fillPlaceholders(letter.mailText ?? LETTER_MAIL_TEXT, ctx), recipient: letter.recipient?.name ? letter.recipient : letterRecipient(customer || {}, contact) }
}

/** Dateiname: Brief_2026-11-05_Hausverwaltung-Muster_Preisanpassung_ab12.pdf */
export function letterFileName(letter = {}) {
  const part = (s, n) => fileSafe(String(s || '').replace(/[^\p{L}\p{N}]+/gu, '-')).replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '')
  return ['Brief', letter.date || '', part(letter.recipient?.name, 40), part(letter.subject, 40), String(letter.id || '').slice(-4)].filter(Boolean).join('_') + '.pdf'
}
/** Ablage in SharePoint (App-Ordner): fakturierung/briefe/2026/Brief_….pdf */
export const letterArchivePath = (letter = {}, name = letterFileName(letter)) => `fakturierung/briefe/${String(letter.date || '').slice(0, 4) || 'ohne-Jahr'}/${name}`
/** Sammel-PDF zum Drucken: Serienbrief_2026-11-05_Preisanpassung.pdf */
export const serialFileName = (serial = {}) => `Serienbrief_${serial.date || ''}_${fileSafe(String(serial.subject || 'Brief').replace(/[^\p{L}\p{N}]+/gu, '-')).slice(0, 40).replace(/^-+|-+$/g, '')}.pdf`

/** Briefe eines Kunden, neueste zuerst. */
export const customerLetters = (letters = [], customerId) => (letters || []).filter((l) => customerId && l.customerId === customerId).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

/** Wie verschickt: „per E-Mail an …“, „als PDF“ oder „Entwurf“. */
export function letterState(l = {}) {
  const last = (l.sent || []).at(-1)
  if (last) return { key: 'versendet', text: `per E-Mail an ${last.to}${last.via === 'mailto' ? ' (E-Mail-Programm)' : ''}`, at: last.at }
  if (l.printedAt || l.status === 'gedruckt') return { key: 'gedruckt', text: 'als PDF erstellt', at: l.printedAt || '' }
  return { key: 'entwurf', text: 'Entwurf', at: '' }
}

// ---------------------------------------------------------------- Serienbrief: Empfänger

export const SERIAL_SCOPES = { aktiv: 'alle aktiven Kunden', gruppe: 'Kundengruppe', objekt: 'Kunden eines Objekts', alle: 'alle Kunden' }
export const SERIAL_TYPES = { '': 'Firmen und Privat', firma: 'nur Firmen', privat: 'nur Privat (Verbraucher)' }
export const ACTIVE_MONTHS = 24

const monthsBefore = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Aktiver Kunde: nicht als inaktiv markiert und in den letzten 24 Monaten ein Beleg (festgeschrieben), ein laufender
 * Dauerauftrag oder ein aktives Objekt.
 */
export function customerActive(c, { documents = [], recurring = [], objects = [], today = '', months = ACTIVE_MONTHS } = {}) {
  if (!c || c.active === false) return false
  const from = today ? monthsBefore(today, months) : ''
  if ((recurring || []).some((r) => r.customerId === c.id && r.active !== false)) return true
  if ((documents || []).some((d) => d.customerId === c.id && d.number && String(d.date || '') >= from)) return true
  const objs = new Set(c.objectIds || [])
  return (objects || []).some((o) => objs.has(o.id) && o.active !== false)
}

const validMail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim())

/**
 * Empfänger eines Serienbriefs. filter: { scope, group, objectId, type, role, search, ids (nur diese Kunden) }; advertising: Werbung
 * (Kunden mit noAds bekommen keine E-Mail, sondern stehen im Sammel-PDF); excluded: abgewählte Kunden-ids.
 * Liefert [{ id, customer, contact, name, recipient, email, viaMail, selected, note }] nach Name sortiert.
 */
export function serialRecipients(customers = [], { scope = 'aktiv', group = '', objectId = '', type = '', role = '', search = '', advertising = false, excluded = [], documents = [], recurring = [], objects = [], today = '', ids = null } = {}) {
  const off = new Set(excluded || [])
  const only = Array.isArray(ids) ? new Set(ids) : null
  const r = String(role || '').trim().toLowerCase()
  return (customers || [])
    .filter((c) => {
      if (only && !only.has(c.id)) return false
      if (scope === 'aktiv' && !customerActive(c, { documents, recurring, objects, today })) return false
      if (scope === 'gruppe' && (!group || String(c.group || '') !== String(group))) return false
      if (scope === 'objekt' && !(c.objectIds || []).includes(objectId)) return false
      if (type === 'privat' && !c.consumer) return false
      if (type === 'firma' && c.consumer) return false
      return customerMatches(c, search)
    })
    .map((c) => {
      const contact = r ? (c.contacts || []).find((p) => `${p.role || ''} ${p.name || ''}`.toLowerCase().includes(r)) || null : null
      const recipient = letterRecipient(c, contact)
      const blocked = advertising && c.noAds
      const viaMail = validMail(recipient.email) && !blocked
      const note = blocked ? 'Werbung per E-Mail abgelehnt' : !validMail(recipient.email) ? 'ohne E-Mail-Adresse' : r && !contact ? `kein Ansprechpartner „${role}“: an die Firma` : ''
      return { id: c.id, customer: c, contact, name: recipient.name || '–', recipient, email: viaMail ? recipient.email : '', viaMail, selected: !off.has(c.id), note }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Zählung für den Serienbrief: ausgewählt, per E-Mail, im Sammel-PDF. */
export function serialCounts(list = []) {
  const sel = list.filter((x) => x.selected)
  return { all: list.length, selected: sel.length, mail: sel.filter((x) => x.viaMail).length, print: sel.filter((x) => !x.viaMail).length }
}

/** Seiten-Anfänge im Sammel-PDF aus den Seitenzahlen der einzelnen Briefe: [2, 1, 3] → [1, 3, 4]. */
export function pageStarts(counts = []) {
  const out = []
  let p = 1
  for (const n of counts) {
    out.push(p)
    p += Math.max(1, Number(n) || 1)
  }
  return out
}

