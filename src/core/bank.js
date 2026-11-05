// Bankabgleich: Kontoauszug einlesen (camt.053/052/054 als XML, CSV der österreichischen Banken
// oder beliebige CSV mit Spaltenzuordnung), Eingänge den offenen Rechnungen zuordnen
// (Rechnungsnummer, Betrag, Kunde über IBAN oder Name, Sammelzahlungen) und nach Bestätigung
// als Zahlung bei der Rechnung buchen. Abbuchungen werden nur angezeigt.
//
// Buchung im Gerät/SharePoint (fakturierung.json → bank):
//   tx:     [{ id, date, valueDate, amount (+ Eingang, − Abbuchung), currency, name, iban, text, reference,
//              reversal, status ('offen'|'zugeordnet'|'ignoriert'|'abbuchung'), allocations [{ docId, amount }], by, at }]
//   hashes: { hash: Buchungsdatum }  gegen doppeltes Einlesen
// Aufbewahrt werden 13 Monate (danach entfernt: die Zahlungen stehen bei den Rechnungen).

import { fnv1a, isCancelled, openAmount, paymentEntries, round2, skontoAvailable } from './invoicing.js'

export const KEEP_MONTHS = 13
export const LEVELS = { sicher: 'sicher', wahrscheinlich: 'wahrscheinlich', unsicher: 'unsicher' }
export const emptyBank = () => ({ tx: [], hashes: {} })

// ---------------------------------------------------------------- Zahlen, Daten, Texte

/** Betrag aus Text: „1.234,56“, „-12,30“, „+1 234,56“, „1234.56“, „1,234.56“, „12,30 S“/„H“. */
export function parseAmount(v) {
  if (typeof v === 'number') return round2(v)
  let s = String(v ?? '').trim().replace(/\s| |€|EUR/gi, '')
  if (!s) return NaN
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  if (/[-−]$/.test(s)) {
    sign = -1
    s = s.slice(0, -1)
  }
  if (/S$/i.test(s)) {
    sign = -1
    s = s.slice(0, -1)
  } else if (/H$/i.test(s)) s = s.slice(0, -1)
  if (/^[-−]/.test(s)) {
    sign *= -1
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  if (comma > dot) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (dot > comma && comma >= 0) s = s.replace(/,/g, '') // 1,234.56
  else if (comma < 0 && dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // 1.234 (Tausender)
  const n = Number(s)
  return Number.isFinite(n) ? round2(sign * n) : NaN
}

/** Datum aus Text: „30.10.2026“, „30.10.26“, „2026-10-30“, „30.10.2026 08:15“, „20261030“ → „2026-10-30“. */
export function parseDate(v) {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

const IBAN_RE = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/
export const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Namen vergleichbar machen: Kleinbuchstaben, ohne Rechtsform, Umlaute aufgelöst. */
export function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['gmbh', 'kg', 'og', 'ag', 'mbh', 'co', 'und', 'eu', 'e', 'u', 'gesmbh', 'gesellschaft', 'm', 'b', 'h', 'herr', 'frau', 'fa', 'firma', 'dr', 'mag', 'ing'].includes(t))
}

/** Ähnlichkeit zweier Namen (0–1): Anteil gemeinsamer Wörter am kürzeren Namen. */
export function nameScore(a, b) {
  const x = new Set(nameTokens(a))
  const y = new Set(nameTokens(b))
  if (!x.size || !y.size) return 0
  let common = 0
  for (const t of x) if (y.has(t)) common++
  return common / Math.min(x.size, y.size)
}

/**
 * Felder aus einem Buchungstext wie bei ELBA („Auftraggeber: … IBAN Auftraggeber: … Zahlungsreferenz: …
 * Verwendungszweck: …“): { name, iban, bic, reference, purpose }.
 */
export function fieldsFromText(text) {
  const s = squash(text)
  const keys = ['IBAN Auftraggeber', 'BIC Auftraggeber', 'IBAN Empfänger', 'BIC Empfänger', 'Auftraggeber', 'Empfänger', 'Zahlungsreferenz', 'Verwendungszweck', 'Auftraggeberreferenz', 'Mandat', 'Creditor-ID', 'Zahlungspflichtiger']
  const re = new RegExp(`(${keys.map((k) => k.replace(/[-]/g, '\\-')).join('|')}):\\s*`, 'g')
  const parts = {}
  let m
  const found = []
  while ((m = re.exec(s))) found.push({ key: m[1], start: m.index, end: re.lastIndex })
  found.forEach((f, i) => {
    parts[f.key] = s.slice(f.end, i + 1 < found.length ? found[i + 1].start : s.length).trim()
  })
  const iban = cleanIban(parts['IBAN Auftraggeber'] || parts['IBAN Empfänger'] || (s.match(IBAN_RE)?.[1] ?? ''))
  return {
    name: parts.Auftraggeber || parts.Zahlungspflichtiger || parts['Empfänger'] || '',
    iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : '',
    bic: parts['BIC Auftraggeber'] || parts['BIC Empfänger'] || '',
    reference: parts.Zahlungsreferenz || '',
    purpose: parts.Verwendungszweck || '',
  }
}

// ---------------------------------------------------------------- XML (camt)

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all))

/** Kleiner XML-Leser (ohne Abhängigkeiten, auch in Tests ohne Browser): { name, attrs, children, text }. Namensräume werden weggelassen. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2]) {
      if (stack.length > 1) stack.pop()
    } else if (m[3]) {
      const attrs = {}
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = decode(a[3] ?? a[4] ?? '')
      const node = { name: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.text += decode(m[6])
  }
  return root
}

const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : [])
/** Erstes Element unter einem Pfad „A/B/C“. */
const at = (n, path) => path.split('/').reduce((cur, p) => (cur ? kids(cur, p)[0] : null), n)
const all = (n, path) => {
  const parts = path.split('/')
  let cur = n ? [n] : []
  for (const p of parts) cur = cur.flatMap((c) => kids(c, p))
  return cur
}
const txt = (n, path) => squash(at(n, path)?.text || '')
/** Name einer Partei: Nm direkt oder (ab Version 08) unter Pty. */
const partyName = (n) => txt(n, 'Nm') || txt(n, 'Pty/Nm')
const accountIban = (n) => cleanIban(txt(n, 'Id/IBAN') || txt(n, 'Id/Othr/Id'))

/** camt.053 (Tagesauszug), camt.052 (Umsätze untertags) oder camt.054 (Sammelbuchung aufgelöst). */
export function parseCamt(xml) {
  const doc = parseXml(xml)
  const document = at(doc, 'Document') || doc
  const kinds = [
    ['BkToCstmrStmt', 'Stmt', 'camt.053'],
    ['BkToCstmrAcctRpt', 'Rpt', 'camt.052'],
    ['BkToCstmrDbtCdtNtfctn', 'Ntfctn', 'camt.054'],
  ]
  const kind = kinds.find(([wrap]) => at(document, wrap))
  if (!kind) throw new Error('Keine camt-Datei (camt.052, camt.053 oder camt.054) erkannt.')
  const [wrap, part, format] = kind
  const transactions = []
  let account = ''
  let from = ''
  let to = ''
  for (const st of all(document, `${wrap}/${part}`)) {
    account ||= accountIban(at(st, 'Acct'))
    const f = parseDate(txt(st, 'FrToDt/FrDtTm') || txt(st, 'FrToDt/FrDt'))
    const t = parseDate(txt(st, 'FrToDt/ToDtTm') || txt(st, 'FrToDt/ToDt'))
    if (f && (!from || f < from)) from = f
    if (t && (!to || t > to)) to = t
    for (const e of kids(st, 'Ntry')) {
      const status = txt(e, 'Sts/Cd') || txt(e, 'Sts')
      if (status && status !== 'BOOK') continue // nur gebuchte (keine vorgemerkten)
      const entryAmount = parseAmount(txt(e, 'Amt'))
      const credit = txt(e, 'CdtDbtInd') === 'CRDT'
      const reversal = txt(e, 'RvslInd') === 'true'
      const date = parseDate(txt(e, 'BookgDt/Dt') || txt(e, 'BookgDt/DtTm'))
      const valueDate = parseDate(txt(e, 'ValDt/Dt') || txt(e, 'ValDt/DtTm'))
      const currency = at(e, 'Amt')?.attrs.Ccy || 'EUR'
      const entryText = squash(txt(e, 'AddtlNtryInf'))
      const bankRef = txt(e, 'AcctSvcrRef')
      const details = all(e, 'NtryDtls/TxDtls')
      const list = details.length ? details : [null]
      const batch = details.length > 1
      list.forEach((d, i) => {
        const dCredit = d && txt(d, 'CdtDbtInd') ? txt(d, 'CdtDbtInd') === 'CRDT' : credit
        const amount = d && (txt(d, 'Amt') || txt(d, 'AmtDtls/TxAmt/Amt')) ? parseAmount(txt(d, 'Amt') || txt(d, 'AmtDtls/TxAmt/Amt')) : entryAmount
        // Gegenpartei: bei Eingängen der Zahler (Dbtr), bei Abbuchungen der Empfänger (Cdtr)
        const party = d ? at(d, dCredit ? 'RltdPties/Dbtr' : 'RltdPties/Cdtr') : null
        const partyAcct = d ? at(d, dCredit ? 'RltdPties/DbtrAcct' : 'RltdPties/CdtrAcct') : null
        const ustrd = d ? all(d, 'RmtInf/Ustrd').map((x) => squash(x.text)).join(' ') : ''
        const ref = d ? txt(d, 'RmtInf/Strd/CdtrRefInf/Ref') : ''
        const addtl = d ? squash(txt(d, 'AddtlTxInf')) : ''
        const text = squash([ustrd, addtl, !d || !batch ? entryText : ''].filter(Boolean).join(' '))
        transactions.push({
          date: date || valueDate,
          valueDate: valueDate || date,
          amount: round2((dCredit ? 1 : -1) * Math.abs(amount)),
          currency,
          name: party ? partyName(party) : '',
          iban: partyAcct ? accountIban(partyAcct) : '',
          text,
          reference: ref,
          endToEnd: d ? txt(d, 'Refs/EndToEndId').replace(/^NOTPROVIDED$/i, '') : '',
          bankRef: (d && txt(d, 'Refs/AcctSvcrRef')) || bankRef,
          reversal,
          batch: batch ? { of: list.length, n: i + 1, total: round2((credit ? 1 : -1) * Math.abs(entryAmount)) } : null,
        })
      })
    }
  }
  return { format, account, from, to, transactions }
}

// ---------------------------------------------------------------- CSV

/** CSV-Zeilen lesen (Anführungszeichen, Zeilenumbrüche im Feld); Trennzeichen ; , oder Tab wird erkannt. */
export function parseCsvRows(text, sep = null) {
  const s = String(text || '').replace(/^﻿/, '')
  const sample = s.split(/\r?\n/).slice(0, 10).join('\n')
  const count = (ch) => (sample.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length
  const d = sep || [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === d) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()))
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()))
  return { rows, sep: d }
}

// Spaltennamen der Banken (Kleinbuchstaben, ohne Leerzeichen/Sonderzeichen verglichen)
const ALIASES = {
  date: ['buchungsdatum', 'buchungstag', 'datum', 'booking date', 'bookingdate', 'date', 'umsatzdatum', 'transaktionsdatum'],
  valueDate: ['valutadatum', 'valuta', 'wertstellung', 'valuedate', 'value date'],
  amount: ['betrag', 'betrag eur', 'betrag (eur)', 'umsatz', 'amount', 'betrag in eur', 'summe'],
  credit: ['gutschrift', 'haben', 'eingang', 'credit'],
  debit: ['lastschrift', 'soll', 'ausgang', 'debit', 'belastung'],
  name: ['partnername', 'partner name', 'auftraggeber/empfänger', 'empfänger/auftraggeber', 'auftraggeber / empfänger', 'name', 'gegenpartei', 'zahlungspflichtiger', 'auftraggeber', 'empfänger', 'beguenstigter/zahlungspflichtiger', 'begünstigter/zahlungspflichtiger', 'counterparty', 'partner'],
  iban: ['partner iban', 'partneriban', 'iban', 'iban/kontonummer', 'gegenkonto', 'gegenkonto iban', 'kontonummer/iban', 'iban auftraggeber', 'partner kontonummer', 'account'],
  text: ['buchungs-info', 'buchungsinfo', 'verwendungszweck', 'buchungstext', 'text', 'umsatztext', 'beschreibung', 'zweck', 'details', 'description', 'mitteilung', 'notiz'],
  reference: ['zahlungsreferenz', 'payment reference', 'referenz', 'kundenreferenz', 'end-to-end-referenz', 'endtoendid'],
  currency: ['währung', 'waehrung', 'currency'],
}
const norm = (h) => String(h || '').toLowerCase().replace(/^﻿/, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim()

/** Spaltenzuordnung aus der Kopfzeile: { date, valueDate, amount, credit, debit, name, iban, text, reference, currency } (Spaltennummern). */
export function mappingFromHeader(header) {
  const h = header.map(norm)
  const map = {}
  const taken = new Set()
  const take = (field, idx) => {
    if (idx < 0) return
    map[field] = idx
    taken.add(idx)
  }
  // erst genaue Namen für alle Felder, dann Anfänge: „Partner IBAN“ ist die IBAN, nicht der Name „Partner…“
  for (const [field, names] of Object.entries(ALIASES)) take(field, h.findIndex((x, i) => !taken.has(i) && names.includes(x)))
  for (const [field, names] of Object.entries(ALIASES)) if (!(field in map)) take(field, h.findIndex((x, i) => !taken.has(i) && names.some((n) => n.length > 4 && x.startsWith(n))))
  // „Buchungs-Info“ und „Verwendungszweck“: weitere Textspalten anhängen
  map.extraText = h.map((x, i) => i).filter((i) => i !== map.text && ALIASES.text.includes(h[i]))
  return map
}

const looksDate = (v) => !!parseDate(v)
const looksAmount = (v) => /^[-+−]?\s?[\d.\s]+,\d{2}$|^[-+−]?\d+\.\d{2}$/.test(String(v || '').trim())

/**
 * Format einer CSV erkennen. Kopfzeile mit bekannten Spalten (George, Bank Austria, allgemein) oder
 * ohne Kopfzeile: ELBA (Buchungsdatum;Buchungstext;Valutadatum;Betrag;Währung;Zeitstempel) bzw.
 * BAWAG (Konto;Buchungstext;Buchungsdatum;Valutadatum;Betrag;Währung).
 * Liefert { format, label, header (bool), mapping, rows, sep, ok }.
 */
export function detectCsv(text) {
  const { rows, sep } = parseCsvRows(text)
  if (!rows.length) return { format: 'leer', label: 'leere Datei', header: false, mapping: {}, rows, sep, ok: false }
  const first = rows[0]
  const headerLike = first.filter((c) => !looksDate(c) && !looksAmount(c)).length >= Math.max(2, first.length - 1)
  if (headerLike) {
    const mapping = mappingFromHeader(first)
    const h = first.map(norm).join('|')
    const format = /partnername|partner iban|buchungs-info/.test(h) ? 'george' : /empfänger\/auftraggeber|auftraggeber\/empfänger/.test(h) && /zahlungsreferenz/.test(h) ? 'bankaustria' : 'csv'
    const label = { george: 'George (Erste Bank, Sparkassen)', bankaustria: 'Bank Austria', csv: 'CSV mit Kopfzeile' }[format]
    return { format, label, header: true, mapping, rows, sep, ok: mapping.date !== undefined && (mapping.amount !== undefined || mapping.credit !== undefined) }
  }
  // ohne Kopfzeile
  if (looksDate(first[0]) && looksDate(first[2]) && looksAmount(first[3])) return { format: 'elba', label: 'ELBA (Raiffeisen, Volksbank, Hypo)', header: false, mapping: { date: 0, text: 1, valueDate: 2, amount: 3, currency: 4, extraText: [] }, rows, sep, ok: true }
  if (/^[A-Z]{2}\d{2}/.test(first[0].replace(/\s/g, '')) && looksDate(first[2]) && looksAmount(first[4])) return { format: 'bawag', label: 'BAWAG (eBanking)', header: false, mapping: { text: 1, date: 2, valueDate: 3, amount: 4, currency: 5, extraText: [] }, rows, sep, ok: true }
  // sonst: Spalten raten, Zuordnung von Hand prüfen
  const guess = { extraText: [] }
  first.forEach((c, i) => {
    if (guess.date === undefined && looksDate(c)) guess.date = i
    else if (guess.amount === undefined && looksAmount(c)) guess.amount = i
    else if (guess.text === undefined && c.length > 12) guess.text = i
  })
  return { format: 'csv', label: 'CSV ohne Kopfzeile', header: false, mapping: guess, rows, sep, ok: false }
}

/** Buchungen aus CSV-Zeilen mit Spaltenzuordnung. */
export function csvTransactions({ rows, header, mapping }) {
  const out = []
  const col = (r, k) => (mapping[k] === undefined || mapping[k] === null || mapping[k] === '' ? '' : r[Number(mapping[k])] ?? '')
  for (const r of header ? rows.slice(1) : rows) {
    const date = parseDate(col(r, 'date')) || parseDate(col(r, 'valueDate'))
    let amount = parseAmount(col(r, 'amount'))
    if (!Number.isFinite(amount)) {
      const c = parseAmount(col(r, 'credit'))
      const d = parseAmount(col(r, 'debit'))
      amount = Number.isFinite(c) && c ? Math.abs(c) : Number.isFinite(d) && d ? -Math.abs(d) : NaN
    }
    if (!date || !Number.isFinite(amount) || !amount) continue
    const rawText = squash([col(r, 'text'), ...(mapping.extraText || []).map((i) => r[i] || '')].filter(Boolean).join(' '))
    const f = fieldsFromText(rawText)
    const ibanCol = cleanIban(col(r, 'iban'))
    out.push({
      date,
      valueDate: parseDate(col(r, 'valueDate')) || date,
      amount: round2(amount),
      currency: col(r, 'currency') || 'EUR',
      name: squash(col(r, 'name')) || f.name,
      iban: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ibanCol) ? ibanCol : f.iban,
      text: rawText,
      reference: squash(col(r, 'reference')) || f.reference,
      endToEnd: '',
      bankRef: '',
      reversal: false,
      batch: null,
    })
  }
  return out
}

/** Datei erkennen und einlesen: XML (camt) oder CSV. mapping: eigene Spaltenzuordnung für CSV. */
export function readStatement(text, { mapping = null } = {}) {
  const t = String(text || '').replace(/^﻿/, '').trimStart()
  if (t.startsWith('<')) return { ...parseCamt(t), ok: true }
  const det = detectCsv(t)
  const use = mapping ? { ...det, mapping: { extraText: [], ...mapping }, ok: true } : det
  const transactions = use.ok ? csvTransactions(use) : []
  const dates = transactions.map((x) => x.date).sort()
  return { format: det.format, label: det.label, header: det.header, mapping: use.mapping, rows: det.rows, ok: use.ok, account: '', from: dates[0] || '', to: dates.at(-1) || '', transactions }
}

// ---------------------------------------------------------------- Doppelte

/** Kennung einer Buchung: Datum, Betrag, IBAN, Text; gleiche Buchungen in einer Datei werden mitgezählt. */
export function hashTx(tx, n = 0) {
  const key = [tx.date, round2(tx.amount).toFixed(2), cleanIban(tx.iban), squash(`${tx.text} ${tx.reference}`).toLowerCase(), tx.bankRef || tx.endToEnd || '', n].join('|')
  return `b${fnv1a(key)}${fnv1a(key.split('').reverse().join(''))}`
}

/**
 * Neue Buchungen eines Auszugs: Doppelte (schon eingelesen) weglassen. Liefert { fresh, duplicates }.
 * Jede neue Buchung bekommt id (Hash) und status ('offen' für Eingänge, 'abbuchung' für Abbuchungen).
 */
export function dedupe(transactions, hashes = {}) {
  const seen = new Map()
  const fresh = []
  let duplicates = 0
  for (const tx of transactions) {
    const base = hashTx(tx)
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    const id = n ? hashTx(tx, n) : base
    if (hashes[id]) {
      duplicates++
      continue
    }
    fresh.push({ ...tx, id, status: tx.amount > 0 && !tx.reversal ? 'offen' : tx.amount > 0 ? 'rueckbuchung' : 'abbuchung', allocations: [] })
  }
  return { fresh, duplicates }
}

/** Ältere Buchungen und Kennungen entfernen (Monate nach Buchungsdatum). */
export function prune(bank, today, months = KEEP_MONTHS) {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  const limit = d.toISOString().slice(0, 10)
  bank.tx = (bank.tx || []).filter((x) => x.date >= limit)
  bank.hashes = Object.fromEntries(Object.entries(bank.hashes || {}).filter(([, date]) => date >= limit))
  return bank
}

// ---------------------------------------------------------------- Zuordnung

/** Rechnungsnummern im Text („RE-2026-0007“, „RE 2026 7“, „RE2026/0007“) → Liste wie gespeichert vergleichbar. */
export function numbersIn(text, prefixes = ['RE']) {
  const out = new Set()
  const p = [...new Set(prefixes.filter(Boolean))].map((x) => x.replace(/[^A-Za-z0-9]/g, '')).join('|')
  const re = new RegExp(`(?:^|[^A-Za-z0-9])(${p})[\\s\\-_/.]*((?:19|20)\\d{2})[\\s\\-_/.]*0*(\\d{1,6})(?![0-9])`, 'gi')
  for (const m of String(text || '').matchAll(re)) out.add(`${m[1].toUpperCase()}|${m[2]}|${Number(m[3])}`)
  return [...out]
}
const numberKey = (number) => {
  const m = String(number || '').match(/^([A-Za-z0-9]+)-(\d{4})-0*(\d+)$/)
  return m ? `${m[1].toUpperCase()}|${m[2]}|${Number(m[3])}` : ''
}

const cents = (n) => Math.round(round2(n) * 100)
const same = (a, b) => Math.abs(cents(a) - cents(b)) <= 1

/** Teilmenge offener Posten, deren Summe dem Betrag entspricht (höchstens 4 Rechnungen, älteste zuerst). */
function subsetFor(items, amount) {
  const list = items.slice(0, 12)
  const target = cents(amount)
  let best = null
  const walk = (i, chosen, sum) => {
    if (best) return
    if (Math.abs(sum - target) <= 1 && chosen.length > 1) {
      best = [...chosen]
      return
    }
    if (chosen.length >= 4 || i >= list.length || sum > target + 1) return
    walk(i + 1, [...chosen, list[i]], sum + cents(list[i].open))
    walk(i + 1, chosen, sum)
  }
  walk(0, [], 0)
  return best
}

/** Betrag auf Rechnungen verteilen (älteste zuerst); was übrig bleibt, geht als Überzahlung auf die letzte. */
function allocate(items, amount) {
  let rest = cents(amount)
  const out = []
  items.forEach((x, i) => {
    if (rest <= 0) return
    const take = i === items.length - 1 ? rest : Math.min(rest, cents(x.open))
    out.push({ docId: x.doc.id, amount: take / 100 })
    rest -= take
  })
  return out
}

/** Je Rechnung genau der Betrag abzüglich Skonto. */
const allocateDue = (items) => items.map((x) => ({ docId: x.doc.id, amount: round2(x.due) }))

const fmt = (n) => `${round2(n).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/**
 * Vorschlag für einen Eingang. docs: alle Belege, customers: Kunden ({ id, name, ibans? }).
 * Liefert { level, allocations: [{ docId, amount }], reasons: [], note } oder { level: null, reasons } ohne Vorschlag.
 */
export function suggest(tx, { docs, customers = [], settings = {} }) {
  if (!(tx.amount > 0)) return { level: null, allocations: [], reasons: ['Abbuchung: wird nur angezeigt.'] }
  if (tx.reversal) return { level: null, allocations: [], reasons: ['Rückbuchung (Storno der Bank): bitte prüfen.'] }
  // due: offen abzüglich Skonto, wenn der Eingang in der Skontofrist liegt
  const item = (d) => {
    const o = openAmount(d, docs, settings)
    return { doc: d, open: o, due: round2(o - skontoAvailable(d, docs, settings, tx.date)) }
  }
  const open = docs
    .filter((d) => d.kind === 'rechnung' && d.number && !isCancelled(d, docs))
    .map(item)
    .filter((x) => x.open > 0.004)
    .sort((a, b) => String(a.doc.dueDate || a.doc.date).localeCompare(String(b.doc.dueDate || b.doc.date)))
  const all = `${tx.reference} ${tx.text}`
  const prefixes = [settings.series?.rechnung || 'RE', 'RE', settings.series?.korrektur || 'KO']
  const keys = numbersIn(all, prefixes)
  const byKey = new Map(docs.filter((d) => d.number).map((d) => [numberKey(d.number), d]))
  const named = keys.map((k) => byKey.get(k)).filter(Boolean)
  const reasons = []

  // 1. Rechnungsnummer im Verwendungszweck oder in der Zahlungsreferenz
  if (named.length) {
    const cancelled = named.filter((d) => isCancelled(d, docs) || d.kind !== 'rechnung')
    const items = named.filter((d) => !cancelled.includes(d)).map(item)
    const openItems = items.filter((x) => x.open > 0.004)
    if (!openItems.length) {
      const paid = items.filter((x) => x.open <= 0.004)
      return {
        level: LEVELS.unsicher,
        allocations: [],
        reasons: [
          `Rechnungsnummer ${named.map((d) => d.number).join(', ')} gefunden`,
          cancelled.length ? `${cancelled.map((d) => d.number).join(', ')} ist storniert: Zahlung zurücküberweisen oder mit einer anderen Rechnung verrechnen` : '',
          paid.length ? `${paid.map((x) => x.doc.number).join(', ')} ist schon bezahlt: Doppelzahlung?` : '',
        ].filter(Boolean),
      }
    }
    const sum = round2(openItems.reduce((s, x) => s + x.open, 0))
    const allocations = allocate(openItems, tx.amount)
    reasons.push(`Rechnungsnummer${openItems.length > 1 ? 'n' : ''} ${openItems.map((x) => x.doc.number).join(', ')} im ${tx.reference && numbersIn(tx.reference, prefixes).length ? 'Zahlungsreferenz-Feld' : 'Verwendungszweck'}`)
    if (cancelled.length) reasons.push(`${cancelled.map((d) => d.number).join(', ')} ist storniert und bleibt außen vor`)
    if (same(tx.amount, sum)) {
      reasons.push(openItems.length > 1 ? `Betrag = Summe der ${openItems.length} offenen Beträge` : 'Betrag stimmt mit dem offenen Betrag')
      return { level: LEVELS.sicher, allocations, reasons }
    }
    const sumDue = round2(openItems.reduce((s, x) => s + x.due, 0))
    if (sumDue < sum - 0.004 && same(tx.amount, sumDue)) {
      reasons.push(`Betrag = offener Betrag abzüglich Skonto (${fmt(sum - sumDue)}), gezahlt in der Skontofrist`)
      return { level: LEVELS.sicher, allocations: allocateDue(openItems), reasons, note: 'skonto' }
    }
    if (tx.amount < sum) {
      reasons.push(`Teilzahlung: ${fmt(tx.amount)} von ${fmt(sum)}, danach offen ${fmt(sum - tx.amount)}`)
      return { level: LEVELS.sicher, allocations, reasons, note: 'teilzahlung' }
    }
    reasons.push(`Überzahlung um ${fmt(tx.amount - sum)}: Gutschrift oder Rückzahlung klären`)
    return { level: LEVELS.wahrscheinlich, allocations, reasons, note: 'ueberzahlung' }
  }

  // 2. Kunde über IBAN oder Namen
  const iban = cleanIban(tx.iban)
  const byIban = iban ? customers.filter((c) => (c.ibans || []).map(cleanIban).includes(iban) || cleanIban(c.iban) === iban) : []
  const scored = customers.map((c) => ({ c, s: nameScore(tx.name || tx.text, c.name) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)
  const customer = byIban[0] || scored[0]?.c || null
  const how = byIban[0] ? 'IBAN des Kunden bekannt' : customer ? `Name passt zu ${customer.name}` : ''
  const ofCustomer = customer ? open.filter((x) => x.doc.customerId === customer.id || nameScore(x.doc.recipient?.name, customer.name) >= 0.8) : []
  const recipientMatch = !customer && tx.name ? open.filter((x) => nameScore(tx.name, x.doc.recipient?.name) >= 0.6) : []
  const pool = ofCustomer.length ? ofCustomer : recipientMatch
  const poolHow = ofCustomer.length ? how : recipientMatch.length ? `Name passt zum Rechnungsempfänger ${recipientMatch[0].doc.recipient?.name}` : ''
  if (pool.length) {
    const exact = pool.filter((x) => same(x.open, tx.amount))
    if (exact.length === 1) return { level: byIban[0] ? LEVELS.sicher : LEVELS.wahrscheinlich, allocations: allocate(exact, tx.amount), reasons: [poolHow, `Betrag stimmt mit ${exact[0].doc.number}`] }
    if (exact.length > 1) return { level: LEVELS.wahrscheinlich, allocations: allocate([exact[0]], tx.amount), reasons: [poolHow, `${exact.length} Rechnungen mit genau diesem Betrag: die älteste (${exact[0].doc.number}) vorgeschlagen`] }
    const withSkonto = pool.filter((x) => x.due < x.open - 0.004 && same(x.due, tx.amount))
    if (withSkonto.length === 1) return { level: byIban[0] ? LEVELS.sicher : LEVELS.wahrscheinlich, allocations: allocateDue(withSkonto), reasons: [poolHow, `Betrag stimmt mit ${withSkonto[0].doc.number} abzüglich Skonto (gezahlt in der Skontofrist)`], note: 'skonto' }
    const subset = subsetFor(pool, tx.amount)
    if (subset) return { level: LEVELS.wahrscheinlich, allocations: allocate(subset, tx.amount), reasons: [poolHow, `Betrag = Summe von ${subset.map((x) => x.doc.number).join(' + ')}`] }
    return { level: LEVELS.unsicher, allocations: allocate([pool[0]], tx.amount), reasons: [poolHow, `Betrag passt zu keiner offenen Rechnung: älteste (${pool[0].doc.number}, offen ${fmt(pool[0].open)}) vorgeschlagen`] }
  }

  // 3. nur der Betrag
  const exact = open.filter((x) => same(x.open, tx.amount))
  if (exact.length === 1) return { level: LEVELS.unsicher, allocations: allocate(exact, tx.amount), reasons: [`Nur der Betrag passt zu ${exact[0].doc.number} (${exact[0].doc.recipient?.name || ''}); Name und Verwendungszweck prüfen`] }
  const withSkonto = exact.length ? [] : open.filter((x) => x.due < x.open - 0.004 && same(x.due, tx.amount))
  if (withSkonto.length === 1) return { level: LEVELS.unsicher, allocations: allocateDue(withSkonto), reasons: [`Nur der Betrag passt zu ${withSkonto[0].doc.number} (${withSkonto[0].doc.recipient?.name || ''}) abzüglich Skonto; Name und Verwendungszweck prüfen`], note: 'skonto' }
  return { level: null, allocations: [], reasons: [exact.length > 1 ? `${exact.length} offene Rechnungen mit diesem Betrag: bitte von Hand zuordnen` : 'Keine passende offene Rechnung gefunden'] }
}

/**
 * Zuordnung buchen: je Rechnung eine Zahlung (Datum der Bank, Vermerk, Verweis auf die Buchung) und die
 * Buchung als zugeordnet markieren. Gibt die betroffenen Belege zurück.
 */
export function applyAllocation(tx, allocations, docs, { by = '', at = new Date().toISOString(), newId = () => Math.random().toString(36).slice(2, 10), settings = {} } = {}) {
  const sum = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0))
  if (!allocations.length) throw new Error('Keine Rechnung gewählt.')
  if (Math.abs(cents(sum) - cents(tx.amount)) > 1) throw new Error(`Die Beträge (${fmt(sum)}) ergeben nicht den Eingang (${fmt(tx.amount)}).`)
  // erst alle Rechnungen suchen, dann buchen: sonst stünde bei einem Fehler schon eine Zahlung ohne zugeordnete Buchung
  const targets = allocations.map((a) => docs.find((x) => x.id === a.docId))
  if (targets.some((d) => !d)) throw new Error('Rechnung nicht gefunden.')
  const touched = []
  for (const [i, a] of allocations.entries()) {
    const d = targets[i]
    // in der Skontofrist mit Abzug gezahlt: Skonto als eigener Eintrag (Rechnung danach bezahlt)
    const entries = paymentEntries(d, docs, settings, { id: newId(), date: tx.date, amount: round2(a.amount), note: `Bank${tx.name ? `: ${tx.name}` : ''}`, bank: tx.id, by, at }, { newId })
    d.payments = [...(d.payments || []), ...entries]
    d.history = [...(d.history || []), { at, by, text: `Zahlung ${fmt(a.amount)} vom ${tx.date.split('-').reverse().join('.')} (Bankabgleich)${entries[1] ? `, Skonto ${fmt(entries[1].amount)}` : ''}` }]
    touched.push(d)
  }
  tx.status = 'zugeordnet'
  tx.allocations = allocations.map((a) => ({ docId: a.docId, amount: round2(a.amount) }))
  tx.by = by
  tx.at = at
  return touched
}

/** Zuordnung lösen: die Zahlungen dieser Buchung bei den Rechnungen entfernen, Buchung wieder offen. */
export function undoAllocation(tx, docs, { by = '', at = new Date().toISOString() } = {}) {
  for (const d of docs) {
    if (!(d.payments || []).some((p) => p.bank === tx.id)) continue
    d.payments = d.payments.filter((p) => p.bank !== tx.id)
    d.history = [...(d.history || []), { at, by, text: 'Zahlung aus dem Bankabgleich wieder entfernt' }]
  }
  tx.status = 'offen'
  tx.allocations = []
  tx.by = by
  tx.at = at
}

/** IBAN beim Kunden merken (für die nächste Zuordnung). */
export function rememberIban(customer, iban) {
  const ib = cleanIban(iban)
  if (!customer || !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ib)) return false
  const list = (customer.ibans || []).map(cleanIban)
  if (list.includes(ib)) return false
  customer.ibans = [...list, ib]
  return true
}

/** Nicht zugeordnete Eingänge, die älter als days Tage sind (für „Zu erledigen“). */
export function staleCredits(bank, today, days = 7) {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  const limit = d.toISOString().slice(0, 10)
  return (bank?.tx || []).filter((x) => x.status === 'offen' && x.amount > 0 && x.date <= limit)
}
