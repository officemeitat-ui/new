// SEPA-Lastschrift (Österreich): Gläubiger-ID, Mandate je Kunde, Lastschrifteinzug als Datei pain.008,
// Vorabankündigung (Pre-Notification), Fälligkeit mit Vorlaufzeit (TARGET-Bankarbeitstage), Sequenz
// FRST → RCUR, „im Einzug“, Rücklastschrift und der sichere Treffer im Bankabgleich (camt).
// Rein rechnend, ohne Browser (Oberfläche: ui/views/invoicing-sepa.js, Mandat als PDF: export/sepa-pdf.js).
//
// Regeln (SEPA Core/B2B Rulebook des EPC, Stand 2025; Fundstellen in docs/RECHTSPRUEFUNG.md):
//  - Gläubiger-ID (Creditor Identifier, CI) vergibt in Österreich die OeNB über die Hausbank: 18 Stellen,
//    „AT“, zwei Prüfziffern, Geschäftsbereichskennung (Standard „ZZZ“, zählt nicht zur Prüfziffer) und
//    11 Stellen nationale Kennung. Prüfziffer wie bei der IBAN (ISO 7064 Mod 97-10), EPC262-08.
//  - Mandat: Mandatsreferenz (bis 35 Zeichen, je Gläubiger eindeutig) und Datum der Unterschrift gehören in
//    jede Lastschrift. Ein Mandat verfällt, wenn 36 Monate lang keine Lastschrift eingezogen wurde.
//  - CORE (Basis-Lastschrift): der Zahler kann 8 Wochen ohne Angabe von Gründen die Erstattung verlangen.
//    B2B (Firmen-Lastschrift): nur für Unternehmen, keine Erstattung, die Bank des Zahlers prüft das Mandat.
//  - Vorabankündigung: spätestens 14 Kalendertage vor der Fälligkeit (Betrag und Termin), kürzer, wenn mit
//    dem Zahler vereinbart (im Mandat). Die Rechnung selbst darf die Ankündigung sein.
//  - Vorlage bei der Bank: seit 2016 für CORE und B2B einheitlich spätestens einen TARGET-Geschäftstag vor
//    der Fälligkeit; die eigene Bank hat oft einen Annahmeschluss davor (Standard hier: 2 Bankarbeitstage).
//  - FRST (Erstlastschrift) ist seit dem Rulebook 2016 nicht mehr Pflicht, wird aber von allen Banken
//    angenommen; danach RCUR (Folgelastschrift).
//
// Dateiformat: Seit dem EPC-Implementierungsleitfaden 2023 (in Kraft seit 17. März 2024) beruht die
// Lastschrift auf ISO 20022 Version 2019, also pain.008.001.08; das müssen alle Banken im SEPA-Raum
// annehmen. pain.008.001.02 (Version 2009) nehmen viele Banken übergangsweise noch an, die Fristen dafür
// laufen aus (Deutschland: 2025/2026). Deshalb ist .08 der Standard, .02 bleibt für ältere Bank-Software
// wählbar (Einstellungen). Beide Varianten sind gegen die XSD von ISO 20022 geprüft (test/sepa.test.js).

import { viennaDate } from './dates.js'
import { deDate, formatIban, ibanValid, openAmount, parseNumber, round2, settingsOf, totals } from './invoicing.js'

export const SEPA_VERSIONS = {
  'pain.008.001.08': 'pain.008.001.08 (aktueller Standard, ISO 20022 Version 2019)',
  'pain.008.001.02': 'pain.008.001.02 (ältere Version, für Bank-Software, die .08 noch nicht kennt)',
}
export const DEFAULT_VERSION = 'pain.008.001.08'
export const SCHEMES = { CORE: 'Basis-Lastschrift (CORE)', B2B: 'Firmen-Lastschrift (B2B)' }
export const SEQUENCES = { FRST: 'erste Lastschrift (FRST)', RCUR: 'Folgelastschrift (RCUR)' }
export const PRE_NOTICE_DAYS = 14
export const LEAD_DAYS = 2
export const MANDATE_EXPIRY_MONTHS = 36
/** Häufige Rückgabegründe (ISO 20022 Reason Codes) für die Rücklastschrift. */
export const RETURN_REASONS = {
  AM04: 'Konto nicht gedeckt',
  AC04: 'Konto aufgelöst',
  AC06: 'Konto gesperrt',
  AC01: 'IBAN falsch',
  MD01: 'kein gültiges Mandat',
  MD06: 'Erstattung auf Wunsch des Zahlers',
  MS02: 'Widerspruch des Zahlers',
  SL01: 'Lastschriftsperre beim Zahler',
  MS03: 'sonstiger Grund (ohne Angabe)',
}
/** SEPA-Länder außerhalb des EWR: hier braucht die Lastschrift die Anschrift des Zahlers. */
const NON_EEA = ['CH', 'GB', 'MC', 'SM', 'VA', 'AD', 'GI', 'JE', 'GG', 'IM']

export const sepaSettings = (s = {}) => ({
  creditorId: '',
  version: DEFAULT_VERSION,
  leadDays: LEAD_DAYS,
  preNoticeDays: PRE_NOTICE_DAYS,
  batchBooking: true,
  ...(s.sepa || {}),
})

// ---------------------------------------------------------------- Prüfziffern, Zeichensatz

const mod97 = (digits) => {
  let rest = 0
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97
  return rest
}
const lettersToDigits = (s) => s.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
const cleanId = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()

/** Gläubiger-ID prüfen (Aufbau und Prüfziffer nach EPC262-08; Österreich: genau 18 Stellen). */
export function creditorIdValid(ci) {
  const s = cleanId(ci)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(s) || s.length > 35) return false
  if (s.startsWith('AT') && !/^AT\d{2}[A-Z0-9]{3}\d{11}$/.test(s)) return false
  return mod97(lettersToDigits(`${s.slice(7)}${s.slice(0, 4)}`)) === 1
}

/** Gläubiger-ID aus der nationalen Kennung (z. B. für Beispiele und Tests). */
export function creditorIdFor(national, country = 'AT', business = 'ZZZ') {
  const nid = cleanId(national).replace(/[^A-Z0-9]/g, '')
  const check = 98 - mod97(lettersToDigits(`${nid}${country}00`))
  return `${country}${String(check).padStart(2, '0')}${business}${nid}`
}

/** BIC (8 oder 11 Stellen). */
export const bicValid = (bic) => /^[A-Z]{6}[A-Z2-9][A-NP-Z0-9]([A-Z0-9]{3})?$/.test(cleanId(bic))

const TRANSLIT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '&': '+', '–': '-', '—': '-', '„': "'", '“': "'", '”': "'", '‚': "'", '‘': "'", '’': "'", '/': '/', _: '-', '€': 'EUR', '@': '(at)' }

/**
 * Text in den SEPA-Zeichensatz (EPC: a–z A–Z 0–9 / - ? : ( ) . , ' + Leerzeichen): Umlaute ausgeschrieben,
 * Akzente weg, & als +, alles andere als Leerzeichen; auf max Zeichen gekürzt.
 */
export function sepaText(s, max = 70) {
  const t = String(s ?? '')
    .replace(/[äöüÄÖÜß&–—„“”‚‘’_€@]/g, (ch) => TRANSLIT[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.slice(0, max).trim()
}

/** Kennung (MsgId, PmtInfId, EndToEndId, Mandatsreferenz): SEPA-Zeichen ohne Leerzeichen, kein „/“ am Rand, kein „//“. */
export function sepaId(s, max = 35) {
  return sepaText(s, 200).replace(/\s+/g, '-').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').slice(0, max).replace(/\/+$/, '')
}

const MANDATE_RE = /^[A-Za-z0-9+?/\-:().,']{1,35}$/

// ---------------------------------------------------------------- Bankarbeitstage (TARGET)

const iso = (d) => d.toISOString().slice(0, 10)
const addDaysIso = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
function easter(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** TARGET-Feiertag: Neujahr, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember (sonst wie Werktage). */
export function targetHoliday(date) {
  const md = date.slice(5)
  if (['01-01', '05-01', '12-25', '12-26'].includes(md)) return true
  const e = easter(Number(date.slice(0, 4)))
  return date === addDaysIso(e, -2) || date === addDaysIso(e, 1)
}
export const targetDay = (date) => {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay()
  return wd !== 0 && wd !== 6 && !targetHoliday(date)
}
/** n Bankarbeitstage (TARGET) nach date. */
export function addTargetDays(date, n) {
  let d = date
  let left = n
  while (left > 0) {
    d = addDaysIso(d, 1)
    if (targetDay(d)) left--
  }
  return d
}
/** Frühester Einzugstag bei Einreichung heute: leadDays Bankarbeitstage später (mindestens 1). */
export const earliestCollection = (today, leadDays = LEAD_DAYS) => addTargetDays(today, Math.max(1, leadDays === '' || leadDays == null || !Number.isFinite(Number(leadDays)) ? LEAD_DAYS : Number(leadDays)))

/** Nächster Bankarbeitstag ab date (date selbst, wenn schon einer). */
export const nextTargetDay = (date) => (targetDay(date) ? date : addTargetDays(date, 1))

// ---------------------------------------------------------------- Mandat

/** Aktives Mandat des Kunden (mit Referenz, nicht widerrufen) oder null. */
export const mandateOf = (customer) => {
  const m = customer?.mandate
  return m && String(m.reference || '').trim() && m.active !== false && !m.revokedAt ? m : null
}
export const preNoticeDaysOf = (mandate, settings = {}) => {
  const own = mandate?.preNoticeDays
  return own !== '' && own != null && Number.isFinite(Number(own)) ? Math.max(0, Number(own)) : Number(sepaSettings(settings).preNoticeDays ?? PRE_NOTICE_DAYS)
}
const monthsAfter = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return iso(d)
}
/** Verfallen: 36 Monate ohne Lastschrift (seit der letzten bzw. seit der Unterschrift). */
export const mandateExpired = (mandate, today) => {
  const since = mandate?.lastCollection || mandate?.signedAt
  return !!since && monthsAfter(since, MANDATE_EXPIRY_MONTHS) < today
}

/** Was am Mandat fehlt: [{ level: 'error' | 'warn', text }]. */
export function mandateProblems(customer, today) {
  const m = customer?.mandate || {}
  const out = []
  const err = (text) => out.push({ level: 'error', text })
  const warn = (text) => out.push({ level: 'warn', text })
  if (!String(m.reference || '').trim()) err('Mandatsreferenz fehlt.')
  else if (!MANDATE_RE.test(String(m.reference).trim())) err('Mandatsreferenz: höchstens 35 Zeichen, nur Buchstaben ohne Umlaute, Ziffern und + ? / - : ( ) . , \' (keine Leerzeichen).')
  if (!m.signedAt) err('Datum der Unterschrift fehlt.')
  else if (today && m.signedAt > today) err('Das Datum der Unterschrift liegt in der Zukunft.')
  if (!customer?.iban) err('IBAN des Kunden fehlt (Stammdaten).')
  else if (!ibanValid(customer.iban)) err('IBAN des Kunden ist ungültig (Prüfziffer).')
  if (customer?.bic && !bicValid(customer.bic)) warn('BIC des Kunden sieht falsch aus (8 oder 11 Stellen); ohne BIC geht es auch.')
  if (m.scheme === 'B2B' && customer?.consumer) err('Firmen-Lastschrift (B2B) nur für Unternehmen, nicht für Verbraucher.')
  if (m.active === false || m.revokedAt) warn(`Mandat widerrufen${m.revokedAt ? ` am ${deDate(m.revokedAt)}` : ''}: keine Lastschrift mehr.`)
  if (today && mandateExpired(m, today)) err('Mandat verfallen: 36 Monate ohne Lastschrift. Neues Mandat unterschreiben lassen (neue Referenz, erste Lastschrift).')
  if (m.scheme === 'B2B') warn('Firmen-Lastschrift: der Kunde muss das Mandat seiner Bank bestätigen, sonst lehnt sie ab.')
  return out
}

/** Vorschlag für eine Mandatsreferenz: Kundennummer und laufende Nummer, z. B. „10001-1“. */
export function mandateReferenceFor(customer, customers = []) {
  const base = sepaId(customer?.customerNo || customer?.id || 'M', 30) || 'M'
  const used = new Set(customers.map((c) => String(c.mandate?.reference || '').toUpperCase()))
  for (let n = 1; n < 100; n++) if (!used.has(`${base}-${n}`.toUpperCase())) return `${base}-${n}`
  return `${base}-${Date.now().toString(36)}`
}

// ---------------------------------------------------------------- Vorabankündigung

const eurAt = (n) => Number(n || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
const maskIban = (iban) => {
  const s = formatIban(iban)
  return s.length > 9 ? `${s.slice(0, 4)} **** ${s.slice(-4)}` : s
}

/**
 * Hinweis auf der Rechnung, wenn der Kunde ein Mandat hat (zählt als Vorabankündigung): Betrag, Termin,
 * Mandatsreferenz, Gläubiger-ID, Konto. Leer ohne Mandat, ohne Gläubiger-ID oder bei Gutschriften.
 */
export function debitNoteFor(doc, customer, settings = {}) {
  const m = mandateOf(customer)
  const ss = sepaSettings(settings)
  if (!m || doc?.kind !== 'rechnung' || !creditorIdValid(ss.creditorId) || !ibanValid(customer?.iban)) return ''
  const gross = doc.total?.gross ?? totals(doc, settingsOf({ settings })).gross
  const amount = gross > 0 ? ` von ${eurAt(gross)}` : ''
  const when = doc.dueDate ? `am ${deDate(nextTargetDay(doc.dueDate))}` : 'zur Fälligkeit'
  return `Der Rechnungsbetrag${amount} wird ${when} mit SEPA-Lastschrift von Ihrem Konto ${maskIban(customer.iban)} eingezogen (Mandatsreferenz ${String(m.reference).trim()}, Gläubiger-ID ${cleanId(ss.creditorId)}). Bitte nicht überweisen.`
}

/**
 * Wann ist die Lastschrift angekündigt? { via: 'rechnung' | 'mail', date (angekündigt am), dueDate (angekündigter
 * Termin) } aus der zuletzt gesendeten Ankündigung bzw. der versendeten Rechnung mit Lastschrift-Hinweis; sonst null.
 * Nach einer Rücklastschrift zählt nur eine neue Ankündigung (danach gesendet).
 */
export function noticeOf(doc) {
  // Tag in Wien: eine Ankündigung um 0:30 Uhr ist schon am neuen Tag (der UTC-Tag wäre der Vortag, die Frist um einen Tag zu lang)
  const day = (at) => (at ? viennaDate(at) || String(at).slice(0, 10) : '')
  const returned = doc.directDebit?.status === 'zurueck' ? day(doc.directDebit.returnedAt || doc.directDebit.at || '') : ''
  const mails = (doc.debitNotice || []).filter((n) => n.dueDate && n.at && (!returned || day(n.at) > returned))
  if (mails.length) {
    const n = mails[mails.length - 1]
    return { via: 'mail', date: day(n.at), dueDate: n.dueDate }
  }
  if (doc.debitText && doc.dueDate && !returned) {
    // per Post: drei Tage Postlauf bis zum Zahler
    const sent = (doc.sent || []).map((x) => (x.at ? (x.via === 'post' ? addDaysIso(day(x.at), 3) : day(x.at)) : '')).filter(Boolean).sort()[0]
    if (sent) return { via: 'rechnung', date: sent, dueDate: nextTargetDay(doc.dueDate) }
  }
  return null
}

/** Darf am Tag date eingezogen werden? Ankündigung vorhanden, Termin nicht früher als angekündigt, Frist eingehalten. */
export function noticeFits(notice, date, days) {
  if (!notice || !date) return false
  return date >= notice.dueDate && daysBetween(notice.date, date) >= days
}

// ---------------------------------------------------------------- Lastschrifteinzug

export const inCollection = (doc) => doc?.directDebit?.status === 'eingereicht'

/**
 * Offene Rechnungen von Kunden mit Mandat, die eingezogen werden können:
 * [{ doc, customer, mandate, open, notice, preNotice, problems, ready(date) }], älteste Fälligkeit zuerst.
 * Schon eingereichte (im Einzug) und stornierte bleiben außen vor; Gutschriften (negativ) auch.
 */
export function collectionCandidates(docs, customers, today, settings = {}) {
  const byId = new Map((customers || []).map((c) => [c.id, c]))
  const ss = sepaSettings(settings)
  return docs
    .filter((d) => d.kind === 'rechnung' && d.number && !inCollection(d))
    .map((doc) => ({ doc, customer: byId.get(doc.customerId) }))
    .filter((x) => mandateOf(x.customer))
    .map(({ doc, customer }) => {
      const open = openAmount(doc, docs, settings)
      const mandate = mandateOf(customer)
      const problems = mandateProblems(customer, today).filter((p) => p.level === 'error')
      const notice = noticeOf(doc)
      const preNotice = preNoticeDaysOf(mandate, ss)
      return { doc, customer, mandate, open, notice, preNotice, problems, returned: doc.directDebit?.status === 'zurueck' }
    })
    .filter((x) => x.open > 0.004)
    .sort((a, b) => String(a.doc.dueDate).localeCompare(String(b.doc.dueDate)) || String(a.doc.number).localeCompare(String(b.doc.number)))
}

/** Was gegen den Einzug spricht (Einstellungen): [{ level, text }]. */
export function collectionSetupProblems(settings = {}) {
  const ss = sepaSettings(settings)
  const out = []
  if (!creditorIdValid(ss.creditorId)) out.push({ level: 'error', text: ss.creditorId ? 'Die Gläubiger-ID ist ungültig (Aufbau oder Prüfziffer).' : 'Gläubiger-ID fehlt (Einstellungen → SEPA-Lastschrift; vergibt die OeNB über die Hausbank).' })
  if (!ibanValid(settings.bank?.iban)) out.push({ level: 'error', text: 'Eigene IBAN fehlt oder ist ungültig (Einstellungen → Bankverbindung).' })
  if (!String(settings.sender?.name || '').trim()) out.push({ level: 'error', text: 'Firmenname fehlt (Einstellungen → Absender).' })
  if (settings.bank?.bic && !bicValid(settings.bank.bic)) out.push({ level: 'warn', text: 'Die eigene BIC sieht falsch aus.' })
  return out
}

/**
 * Einzug zusammenstellen: Transaktionen je Rechnung (EndToEnd-ID = Rechnungsnummer, Sequenz aus dem Mandat:
 * pro Mandat nur die erste FRST, weitere RCUR), gruppiert nach Art (CORE/B2B) und Sequenz.
 * items: Einträge aus collectionCandidates. Liefert { payments, transactions, sum, count }.
 */
export function buildCollection(items, { dueDate }) {
  const firstSeen = new Set()
  const transactions = items.map(({ doc, customer, mandate, open }) => {
    const ref = String(mandate.reference).trim()
    const seq = mandate.sequence === 'RCUR' || firstSeen.has(ref.toUpperCase()) ? 'RCUR' : 'FRST'
    firstSeen.add(ref.toUpperCase())
    return {
      docId: doc.id,
      customerId: customer.id,
      endToEndId: sepaId(doc.number),
      amount: round2(open),
      mandateId: ref,
      signedAt: mandate.signedAt,
      scheme: mandate.scheme === 'B2B' ? 'B2B' : 'CORE',
      seq,
      debtor: { name: customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || doc.recipient?.name || '', iban: cleanId(customer.iban), bic: cleanId(customer.bic), country: customer.country || 'AT', street: customer.street || '', zip: customer.zip || '', city: customer.city || '' },
      text: `Rechnung ${doc.number} vom ${deDate(doc.date)}`,
    }
  })
  const groups = new Map()
  for (const t of transactions) {
    const key = `${t.scheme}|${t.seq}`
    if (!groups.has(key)) groups.set(key, { scheme: t.scheme, seq: t.seq, dueDate, transactions: [] })
    groups.get(key).transactions.push(t)
  }
  const payments = [...groups.values()].sort((a, b) => a.scheme.localeCompare(b.scheme) || a.seq.localeCompare(b.seq))
  return { payments, transactions, count: transactions.length, sum: round2(transactions.reduce((s, t) => s + t.amount, 0)) }
}

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])
const amt = (n) => round2(n).toFixed(2)

/**
 * Lastschriftdatei pain.008 (ISO 20022) als Text. Reine Funktion.
 * { version: 'pain.008.001.08' | 'pain.008.001.02', msgId, createdAt (ISO-Zeit), creditor: { name, iban, bic, ci },
 *   payments: [{ scheme, seq, dueDate, transactions: [{ endToEndId, amount, mandateId, signedAt, debtor: { name, iban, bic,
 *   country, street, zip, city }, text }] }], batchBooking }
 * NbOfTxs und CtrlSum stehen im Kopf (alle) und je Zahlungsblock. Ohne BIC: „NOTPROVIDED“ (IBAN-only).
 */
export function pain008Xml({ version = DEFAULT_VERSION, msgId, createdAt, creditor, payments, batchBooking = true }) {
  if (!SEPA_VERSIONS[version]) throw new Error(`Unbekannte Version ${version}.`)
  const v08 = version === 'pain.008.001.08'
  const bicTag = v08 ? 'BICFI' : 'BIC'
  const all = payments.flatMap((p) => p.transactions)
  const sum = (list) => amt(list.reduce((s, t) => s + round2(t.amount), 0))
  const agent = (bic) => (bic ? `<FinInstnId><${bicTag}>${xmlEsc(cleanId(bic))}</${bicTag}></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>')
  const address = (d) => {
    const country = String(d.country || 'AT').toUpperCase()
    if (!NON_EEA.includes(country) && !NON_EEA.includes(String(d.iban || '').slice(0, 2))) return ''
    const parts = [d.street ? `<StrtNm>${xmlEsc(sepaText(d.street, 70))}</StrtNm>` : '', d.zip ? `<PstCd>${xmlEsc(sepaText(d.zip, 16))}</PstCd>` : '', d.city ? `<TwnNm>${xmlEsc(sepaText(d.city, 35))}</TwnNm>` : '']
    return `<PstlAdr>${parts.join('')}<Ctry>${xmlEsc(country)}</Ctry></PstlAdr>`
  }
  const created = String(createdAt || new Date().toISOString()).slice(0, 19)
  const name = xmlEsc(sepaText(creditor.name, 70))
  const blocks = payments.map((p, i) => {
    const tx = p.transactions
      .map(
        (t) =>
          `<DrctDbtTxInf><PmtId><EndToEndId>${xmlEsc(sepaId(t.endToEndId))}</EndToEndId></PmtId><InstdAmt Ccy="EUR">${amt(t.amount)}</InstdAmt>` +
          `<DrctDbtTx><MndtRltdInf><MndtId>${xmlEsc(String(t.mandateId).trim())}</MndtId><DtOfSgntr>${xmlEsc(t.signedAt)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>` +
          `<DbtrAgt>${agent(t.debtor.bic)}</DbtrAgt><Dbtr><Nm>${xmlEsc(sepaText(t.debtor.name, 70))}</Nm>${address(t.debtor)}</Dbtr><DbtrAcct><Id><IBAN>${xmlEsc(cleanId(t.debtor.iban))}</IBAN></Id></DbtrAcct>` +
          `${t.text ? `<RmtInf><Ustrd>${xmlEsc(sepaText(t.text, 140))}</Ustrd></RmtInf>` : ''}</DrctDbtTxInf>`,
      )
      .join('\n')
    return (
      `<PmtInf><PmtInfId>${xmlEsc(sepaId(`${msgId}-${i + 1}`))}</PmtInfId><PmtMtd>DD</PmtMtd><BtchBookg>${batchBooking ? 'true' : 'false'}</BtchBookg><NbOfTxs>${p.transactions.length}</NbOfTxs><CtrlSum>${sum(p.transactions)}</CtrlSum>` +
      `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>${p.scheme === 'B2B' ? 'B2B' : 'CORE'}</Cd></LclInstrm><SeqTp>${p.seq === 'RCUR' ? 'RCUR' : 'FRST'}</SeqTp></PmtTpInf>` +
      `<ReqdColltnDt>${xmlEsc(p.dueDate)}</ReqdColltnDt><Cdtr><Nm>${name}</Nm></Cdtr><CdtrAcct><Id><IBAN>${xmlEsc(cleanId(creditor.iban))}</IBAN></Id></CdtrAcct><CdtrAgt>${agent(creditor.bic)}</CdtrAgt><ChrgBr>SLEV</ChrgBr>` +
      `<CdtrSchmeId><Id><PrvtId><Othr><Id>${xmlEsc(cleanId(creditor.ci))}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>\n${tx}\n</PmtInf>`
    )
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<CstmrDrctDbtInitn>
<GrpHdr><MsgId>${xmlEsc(sepaId(msgId))}</MsgId><CreDtTm>${xmlEsc(created)}</CreDtTm><NbOfTxs>${all.length}</NbOfTxs><CtrlSum>${sum(all)}</CtrlSum><InitgPty><Nm>${name}</Nm></InitgPty></GrpHdr>
${blocks.join('\n')}
</CstmrDrctDbtInitn>
</Document>
`
}

/** Was in der Datei fehlen würde: [{ level, text }] (Fehler verhindern die Datei). */
export function pain008Problems({ creditor, payments }) {
  const out = []
  const err = (text) => out.push({ level: 'error', text })
  if (!creditorIdValid(creditor?.ci)) err('Gläubiger-ID fehlt oder ist ungültig.')
  if (!ibanValid(creditor?.iban)) err('Eigene IBAN fehlt oder ist ungültig.')
  if (!sepaText(creditor?.name)) err('Name des Gläubigers fehlt.')
  if (creditor?.bic && !bicValid(creditor.bic)) err('Eigene BIC ist ungültig.')
  const list = (payments || []).flatMap((p) => p.transactions.map((t) => ({ ...t, dueDate: p.dueDate })))
  if (!list.length) err('Keine Lastschrift ausgewählt.')
  const ids = new Set()
  for (const t of list) {
    const who = t.endToEndId || t.debtor?.name || '?'
    if (!(round2(t.amount) >= 0.01 && round2(t.amount) <= 999999999.99)) err(`${who}: Betrag ungültig.`)
    if (!ibanValid(t.debtor?.iban)) err(`${who}: IBAN des Zahlers ungültig.`)
    if (t.debtor?.bic && !bicValid(t.debtor.bic)) err(`${who}: BIC des Zahlers ungültig.`)
    if (!sepaText(t.debtor?.name)) err(`${who}: Name des Zahlers fehlt.`)
    if (!MANDATE_RE.test(String(t.mandateId || '').trim())) err(`${who}: Mandatsreferenz fehlt oder hat unzulässige Zeichen.`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.signedAt || '')) err(`${who}: Datum der Unterschrift fehlt.`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || '')) err(`${who}: Fälligkeit fehlt.`)
    else if (!targetDay(t.dueDate)) err(`${who}: Fälligkeit ${deDate(t.dueDate)} ist kein Bankarbeitstag.`)
    const id = sepaId(t.endToEndId).toUpperCase()
    if (!id) err(`${who}: Referenz fehlt.`)
    else if (ids.has(id)) err(`${who}: Referenz doppelt.`)
    ids.add(id)
  }
  return out
}

/** Nachrichten-Kennung: CLEANOS-JJJJMMTT-HHMMSS-xxxx (eindeutig je Datei, höchstens 35 Zeichen). */
export const messageId = (createdAt, rand = Math.random().toString(36).slice(2, 6)) => sepaId(`LS-${String(createdAt).slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}-${rand}`.toUpperCase())

/** Dateiname der Lastschriftdatei. */
export const collectionFileName = (msgId, dueDate) => `Lastschrift_${dueDate}_${sepaId(msgId)}.xml`

/**
 * Einzug vermerken: je Rechnung directDebit (eingereicht, Termin, Betrag, Referenzen), Verlauf; beim Kunden
 * die nächste Sequenz (RCUR) und den letzten Einzug. Liefert den Datensatz für fakturierung.sepa.batches.
 */
export function applyCollection(docs, customers, built, { msgId, dueDate, version, at, by = '', file = '' }) {
  const byDoc = new Map(docs.map((d) => [d.id, d]))
  const byCust = new Map(customers.map((c) => [c.id, c]))
  for (const t of built.transactions) {
    const d = byDoc.get(t.docId)
    if (!d) continue
    d.directDebit = { status: 'eingereicht', batchId: msgId, dueDate, amount: t.amount, mandateRef: t.mandateId, scheme: t.scheme, seq: t.seq, endToEndId: sepaId(t.endToEndId), at, by }
    d.history = [...(d.history || []), { at, by, text: `SEPA-Lastschrift eingereicht (${t.seq}, fällig ${deDate(dueDate)}, ${eurAt(t.amount)})` }]
    const c = byCust.get(t.customerId)
    if (c?.mandate) c.mandate = { ...c.mandate, sequence: 'RCUR', lastCollection: dueDate }
  }
  return { id: msgId, msgId, createdAt: at, by, dueDate, version, count: built.count, sum: built.sum, docIds: built.transactions.map((t) => t.docId), file }
}

/**
 * Rücklastschrift erfassen: die Lastschrift ist zurückgekommen (Konto nicht gedeckt, Widerspruch …).
 * Wurde der Eingang schon gebucht (Bankabgleich), mindert eine Gegenbuchung die Zahlung, die Rechnung ist
 * wieder offen. War es die erste Lastschrift des Mandats, ist die nächste wieder FRST.
 */
export function returnDebit(doc, customer, { date, reason = '', fee = 0, at, by = '', newId = () => Math.random().toString(36).slice(2, 10) }) {
  const dd = doc.directDebit
  if (!dd) throw new Error('Für diese Rechnung gibt es keine Lastschrift.')
  if (dd.status === 'zurueck') throw new Error('Die Rücklastschrift ist schon erfasst.')
  const paid = (doc.payments || []).filter((p) => p.directDebit === dd.batchId || (p.bank && p.date >= addDaysIso(dd.dueDate, -5)))
  const booked = round2(Math.min(dd.amount, paid.reduce((s, p) => s + parseNumber(p.amount), 0)))
  if (booked > 0.004) doc.payments = [...(doc.payments || []), { id: newId(), date, amount: -booked, kind: 'ruecklastschrift', note: `Rücklastschrift${reason ? ` (${reason} ${RETURN_REASONS[reason] || ''})`.replace(/\s+\)/, ')') : ''}`, by, at }]
  doc.directDebit = { ...dd, status: 'zurueck', returnedAt: date, reason, fee: round2(parseNumber(fee)) }
  doc.history = [...(doc.history || []), { at, by, text: `Rücklastschrift vom ${deDate(date)}${reason ? `: ${RETURN_REASONS[reason] || reason}` : ''}${parseNumber(fee) ? `, Bankspesen ${eurAt(fee)}` : ''}` }]
  if (customer?.mandate && dd.seq === 'FRST') customer.mandate = { ...customer.mandate, sequence: 'FRST' }
  return { booked }
}

// ---------------------------------------------------------------- Bankabgleich: Eingang einer Lastschrift

const cents = (n) => Math.round(round2(n) * 100)
const near = (date, due, before = 3, after = 12) => !!date && !!due && daysBetween(due, date) >= -before && daysBetween(due, date) <= after

/**
 * Eingang aus einem Lastschrifteinzug? Treffer über die EndToEnd-ID (= Rechnungsnummer), über die Summe eines
 * ganzen Einzugs (Sammelgutschrift) oder über Betrag und Termin einer einzelnen Lastschrift.
 * Liefert { level: 'sicher', allocations, reasons } oder null.
 */
export function collectionMatch(tx, docs, settings = {}) {
  if (!(tx?.amount > 0)) return null
  const pending = docs.filter((d) => inCollection(d) && openAmount(d, docs, settings) > 0.004)
  if (!pending.length) return null
  const reason = (d) => `im Einzug: SEPA-Lastschrift vom ${deDate(d.directDebit.dueDate)}`
  const e2e = String(tx.endToEnd || '').toUpperCase()
  const byE2e = e2e ? pending.find((d) => String(d.directDebit.endToEndId || '').toUpperCase() === e2e) : null
  if (byE2e) return { level: 'sicher', allocations: [{ docId: byE2e.id, amount: round2(tx.amount) }], reasons: [`Referenz ${byE2e.number} der Lastschrift (EndToEnd-ID)`, reason(byE2e), cents(tx.amount) === cents(byE2e.directDebit.amount) ? 'Betrag stimmt' : `Betrag weicht ab (eingezogen ${eurAt(byE2e.directDebit.amount)})`] }
  // Sammelgutschrift: ein Eingang je Zahlungsblock (Art und Sequenz, so bucht die Bank bei Sammelbuchung) oder für den ganzen Einzug
  const batches = new Map()
  const add = (key, d) => batches.set(key, [...(batches.get(key) || []), d])
  for (const d of pending) {
    add(`${d.directDebit.batchId}|${d.directDebit.scheme}|${d.directDebit.seq}`, d)
    add(d.directDebit.batchId, d)
  }
  for (const list of batches.values()) {
    if (list.length < 2 || !near(tx.date, list[0].directDebit.dueDate)) continue
    const total = list.reduce((s, d) => s + cents(d.directDebit.amount), 0)
    if (total === cents(tx.amount)) return { level: 'sicher', allocations: list.map((d) => ({ docId: d.id, amount: round2(d.directDebit.amount) })), reasons: [`Sammelgutschrift des Lastschrifteinzugs vom ${deDate(list[0].directDebit.dueDate)}`, `Betrag = Summe der ${list.length} eingezogenen Rechnungen`] }
  }
  // einzelne Lastschrift: Betrag und Termin, dazu Nummer im Text oder genau eine passende
  const text = `${tx.reference || ''} ${tx.text || ''}`.toUpperCase()
  const fit = pending.filter((d) => cents(d.directDebit.amount) === cents(tx.amount) && near(tx.date, d.directDebit.dueDate))
  const named = fit.filter((d) => d.number && text.includes(String(d.number).toUpperCase()))
  const one = named.length === 1 ? named[0] : fit.length === 1 ? fit[0] : null
  if (one) return { level: 'sicher', allocations: [{ docId: one.id, amount: round2(tx.amount) }], reasons: [reason(one), `Betrag stimmt mit ${one.number}`, named.length ? 'Rechnungsnummer im Verwendungszweck' : 'Termin passt'] }
  return null
}
