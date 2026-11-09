// Kassenbuch: Bareinnahmen und -ausgaben mit fortlaufender Nummer, laufendem Kassenstand (nie negativ),
// Storno statt Ändern oder Löschen, Anfangsbestand, Kassensturz mit Differenzbuchung (Tagesabschluss),
// Monatsabschluss (sperrt den Monat), Export für die Steuerberatung, Übernahme aus orgaMAX.
// Reine Funktionen (Oberfläche: ui/views/cashbook.js, PDF: export/cashbook-pdf.js, Tests: test/cashbook.test.js).
//
// Recht (Quellen in docs/RECHTSPRUEFUNG.md → Einkauf & Kasse):
//  - § 131 Abs 1 Z 2 BAO: Bareingänge und Barausgänge täglich einzeln festhalten; Eintragungen der Zeitfolge nach
//    geordnet, vollständig, richtig und zeitgerecht.
//  - § 131 Abs 1 Z 6 und Abs 3 BAO: Der ursprüngliche Inhalt einer Eintragung darf nicht unleserlich gemacht
//    werden; mit Datenträgern geführte Aufzeichnungen dürfen nicht so verändert werden können, dass der
//    ursprüngliche Inhalt nicht mehr ersichtlich ist. → Einträge werden nie geändert oder gelöscht, nur storniert
//    (Gegenbuchung mit eigener Nummer). Jeder Eintrag trägt eine Prüfsumme, jeder Monatsabschluss eine über alle
//    Einträge des Monats; eine nachträgliche Änderung der Datei fällt auf.
//  - Ein negativer Kassenstand ist unmöglich und gilt bei einer Prüfung als schwerer formeller Mangel: Buchungen,
//    die den Stand an irgendeinem Tag unter null drücken, werden verweigert.
//  - § 131b BAO, Registrierkassensicherheitsverordnung (RKSV): Ab 15.000 € Jahresumsatz je Betrieb, wenn davon
//    mehr als 7.500 € Barumsätze sind, müssen Barumsätze einzeln mit einer Registrierkasse (mit Signatur) erfasst
//    werden. Dieses Kassenbuch ersetzt keine Registrierkasse; es zählt die Barumsätze und warnt.
//
// Datenmodell einkauf/kassenbuch.json:
//  entries[]  { id, no (fortlaufend ab 1), date, at (Zeitpunkt der Erfassung), kind ('einnahme' | 'ausgabe'),
//               type ('buchung' | 'anfang' | 'differenz' | 'storno'), text, amount (brutto, immer positiv),
//               rate, vat (Steuer im Betrag), account (Gegenkonto), category, receipt (Belegnummer, frei),
//               beleg { path, name, type, size, at, by, local }, ref { type ('ausgang' | 'eingang'), id, number },
//               cancels (id des stornierten Eintrags), reason (Grund des Stornos), by, checksum,
//               imported { system, ref, no }, renumbered [{ from, at, by }], recharge (Weiterverrechnung einer Ausgabe an
//               einen Kunden, core/recharge.js; zählt wie beleg nicht zur Prüfsumme) }
//  counts[]   Kassensturz { id, date, at, by, counted, expected, diff, entryId, closesDay, note }
//  closings[] Monatsabschluss { id, month, at, by, opening, sumIn, sumOut, balance, entries, checksum }
//  settings   { name, account (Kassenkonto, Vorschlag 2700), diffAccount (Kassendifferenzen), categories }

import { fnv1a, parseNumber, round2 } from './invoicing.js'
import { viennaDate } from './dates.js'

export const RKSV = { turnover: 15000, cash: 7500 } // § 131b Abs 1 Z 2 und 3 BAO (Jahresumsatz netto je Betrieb, Barumsätze)
export const RKSV_HINT = 'Registrierkassenpflicht (§ 131b BAO, RKSV): Ab 15.000 € Jahresumsatz je Betrieb, wenn davon mehr als 7.500 € bar (auch Karte, Bankomat) bezahlt werden, müssen Barumsätze einzeln mit einer Registrierkasse mit Signatur erfasst werden, und jede Barzahlung braucht einen Beleg. Das Kassenbuch ersetzt keine Registrierkasse.'

export const CASH_KINDS = { einnahme: 'Einnahme', ausgabe: 'Ausgabe' }
export const CASH_TYPES = { buchung: '', anfang: 'Anfangsbestand', differenz: 'Kassendifferenz', storno: 'Storno' }

/** Kategorien mit Gegenkonto (Vorschlag; Ausgaben ergänzt die Oberfläche um die Kategorien des Einkaufs). sales: Barumsatz. */
export const CASH_CATEGORIES = {
  einnahme: [
    { id: 'rechnung', name: 'Zahlung einer Ausgangsrechnung', account: '2000', vat: 0, sales: true },
    { id: 'verkauf', name: 'Barverkauf / Leistung bar', account: '4000', vat: 20, sales: true },
    { id: 'bank-ab', name: 'Abhebung vom Bankkonto', account: '2890', vat: 0 },
    { id: 'einnahme-sonst', name: 'Sonstige Einnahme', account: '', vat: 0 },
  ],
  ausgabe: [
    { id: 'eingang', name: 'Zahlung einer Eingangsrechnung', account: '3300', vat: 0 },
    { id: 'bank-ein', name: 'Einzahlung auf das Bankkonto', account: '2890', vat: 0 },
    { id: 'ausgabe-sonst', name: 'Sonstige Ausgabe', account: '', vat: 20 },
  ],
}
export const CASH_SETTINGS = { name: 'Hauptkasse', account: '2700', diffAccount: '7890' }

export const emptyCashbook = () => ({ entries: [], counts: [], closings: [], settings: {} })
export const cashSettings = (book = {}) => ({ ...CASH_SETTINGS, ...(book.settings || {}) })

const fmt = (n) => `${round2(n).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const de = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')
const monthText = (ym) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Fehler beim Buchen (Text für die Meldung). */
export class CashError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CashError'
  }
}

// ---------------------------------------------------------------- Stand

/** Betrag mit Vorzeichen: Einnahme +, Ausgabe −. */
export const signedAmount = (e) => (e.kind === 'ausgabe' ? -1 : 1) * round2(parseNumber(e.amount))

/** Einträge chronologisch: Datum, dann Nummer. */
export const orderedEntries = (entries = []) => [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Number(a.no) || 0) - (Number(b.no) || 0))

/** Kassenstand am Ende des Tages date (alle Einträge bis einschließlich date); ohne date: aktueller Stand. */
export function balanceAt(book, date = null) {
  return round2((book.entries || []).filter((e) => !date || e.date <= date).reduce((s, e) => s + signedAmount(e), 0))
}

/** Einträge mit laufendem Stand: [{ entry, balance }]. */
export function withRunning(entries = []) {
  let bal = 0
  return orderedEntries(entries).map((entry) => {
    bal = round2(bal + signedAmount(entry))
    return { entry, balance: bal }
  })
}

/** Erster Tag, an dem der Stand negativ wäre: { date, balance } oder null. */
export function firstNegative(entries) {
  const hit = withRunning(entries).find((r) => r.balance < -0.004)
  return hit ? { date: hit.entry.date, balance: hit.balance } : null
}

/** Storno zu einem Eintrag (oder undefined). */
export const stornoOf = (book, id) => (book.entries || []).find((e) => e.cancels === id)
export const isCancelled = (book, id) => !!stornoOf(book, id)

/** Letzter abgeschlossener Monat ('JJJJ-MM') oder ''. */
export const lockedUntil = (book) => (book.closings || []).map((c) => c.month).sort().at(-1) || ''
/** Letzter abgeschlossene Tag (Kassensturz mit Tagesabschluss) oder ''. */
export const closedDay = (book) => (book.counts || []).filter((c) => c.closesDay !== false).map((c) => c.date).sort().at(-1) || ''
/** Datum des letzten Eintrags oder ''. */
export const lastEntryDate = (book) => (book.entries || []).map((e) => e.date).sort().at(-1) || ''
export const nextNo = (book) => Math.max(0, ...(book.entries || []).map((e) => Number(e.no) || 0)) + 1

// ---------------------------------------------------------------- Prüfsumme

const FIXED = ['date', 'kind', 'type', 'text', 'amount', 'rate', 'vat', 'account', 'category', 'receipt', 'ref', 'cancels', 'reason', 'by', 'at']
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v)
/** Prüfsumme eines Eintrags (ohne Nummer: eine Neunummerierung nach dem Zusammenführen bleibt erkennbar, ändert aber nichts am Inhalt). */
export const cashChecksum = (e) => fnv1a(JSON.stringify(canonical(Object.fromEntries(FIXED.map((k) => [k, e[k] ?? null])))))
export const cashIntact = (e) => !e.checksum || e.checksum === cashChecksum(e)

// ---------------------------------------------------------------- Buchen

/** Darf an diesem Tag gebucht werden? Text des Hindernisses oder ''. */
export function dateProblem(book, date, today) {
  if (!isIso(date)) return 'Bitte ein gültiges Datum eingeben.'
  if (today && date > today) return 'Buchungen in der Zukunft sind nicht möglich.'
  const lock = lockedUntil(book)
  if (lock && date.slice(0, 7) <= lock) return `Der Monat ${monthText(date.slice(0, 7))} ist abgeschlossen. Bitte mit einem Datum im offenen Monat buchen.`
  const day = closedDay(book)
  if (day && date <= day) return `Der ${de(day)} ist mit dem Kassensturz abgeschlossen. Bitte mit einem späteren Datum buchen.`
  return ''
}

/**
 * Prüft eine neue Buchung und gibt sie zurück (wirft CashError mit Hinweis). draft: { date, kind, amount, text,
 * rate, vat, account, category, receipt, beleg, ref, type }. Die Buchung wird nur angehängt, nichts bestehendes geändert.
 */
export function addEntry(book, draft, { newId = () => Math.random().toString(36).slice(2, 10), now = new Date().toISOString(), by = '', today = viennaDate(now) || now.slice(0, 10) } = {}) {
  book.entries ||= []
  const amount = round2(parseNumber(draft.amount))
  if (!(amount > 0)) throw new CashError('Bitte einen Betrag über 0 eingeben.')
  if (!CASH_KINDS[draft.kind]) throw new CashError('Einnahme oder Ausgabe?')
  if (!String(draft.text || '').trim()) throw new CashError('Bitte einen Text eingeben (wofür).')
  const problem = dateProblem(book, draft.date, today)
  if (problem) throw new CashError(problem)
  const type = draft.type || 'buchung'
  if (type === 'anfang' && !openingAllowed(book)) throw new CashError('Den Anfangsbestand gibt es nur als ersten Eintrag des Kassenbuchs.')
  const rate = parseNumber(draft.rate)
  const vat = draft.vat != null && draft.vat !== '' ? round2(parseNumber(draft.vat)) : rate ? round2(amount - amount / (1 + rate / 100)) : 0
  if (Math.abs(vat) > amount) throw new CashError('Die Steuer ist höher als der Betrag.')
  const entry = {
    id: draft.id || newId(),
    no: nextNo(book),
    date: draft.date,
    at: now,
    kind: draft.kind,
    type,
    text: String(draft.text).trim(),
    amount,
    rate,
    vat,
    account: String(draft.account || '').trim(),
    category: draft.category || '',
    receipt: String(draft.receipt || '').trim(),
    ...(draft.ref ? { ref: draft.ref } : {}),
    ...(draft.cancels ? { cancels: draft.cancels, reason: draft.reason || '' } : {}),
    ...(draft.beleg ? { beleg: draft.beleg } : {}),
    by,
  }
  const neg = firstNegative([...book.entries, entry])
  if (neg) throw new CashError(`Nicht gebucht: Der Kassenstand fiele am ${de(neg.date)} auf ${fmt(neg.balance)}. Ein Kassenstand unter null ist nicht möglich – zuerst die Einnahme buchen (z. B. Abhebung vom Bankkonto), dann die Ausgabe.`)
  entry.checksum = cashChecksum(entry)
  book.entries.push(entry)
  return entry
}

/** Anfangsbestand erlaubt? Nur, solange es keinen gültigen Eintrag gibt (ein stornierter Anfangsbestand zählt nicht). */
export function openingAllowed(book) {
  const live = (book.entries || []).filter((e) => e.type !== 'storno' && !isCancelled(book, e.id))
  return !live.length
}

/** Anfangsbestand buchen (Übernahme des Kassenstands beim Start, z. B. aus orgaMAX oder dem gezählten Geld). */
export function openingBalance(book, { date, amount, note = '' }, opts = {}) {
  if (!(round2(parseNumber(amount)) > 0)) throw new CashError('Bitte den Anfangsbestand eingeben (über 0 €; bei leerer Kasse ist kein Eintrag nötig).')
  return addEntry(book, { date, kind: 'einnahme', type: 'anfang', amount, text: `Anfangsbestand${note ? ` (${note})` : ''}`, account: '', category: 'anfang' }, opts)
}

/**
 * Eintrag stornieren: Gegenbuchung mit eigener Nummer (Einnahme ↔ Ausgabe), Verweis cancels, Grund. Der
 * ursprüngliche Eintrag bleibt unverändert. Auch das Storno darf den Stand nicht unter null bringen.
 */
export function stornoEntry(book, id, { reason = '', date = null } = {}, opts = {}) {
  const e = (book.entries || []).find((x) => x.id === id)
  if (!e) throw new CashError('Eintrag nicht gefunden.')
  if (e.type === 'storno') throw new CashError('Ein Storno kann nicht storniert werden. Bitte den Betrag neu buchen.')
  if (isCancelled(book, id)) throw new CashError(`Nr. ${e.no} ist schon storniert.`)
  if (!String(reason).trim()) throw new CashError('Bitte den Grund des Stornos angeben.')
  const today = opts.today || viennaDate(opts.now || new Date().toISOString())
  const day = date || today
  if (day < e.date) throw new CashError('Das Storno kann nicht vor dem ursprünglichen Eintrag liegen.')
  return addEntry(
    book,
    { date: day, kind: e.kind === 'einnahme' ? 'ausgabe' : 'einnahme', type: 'storno', amount: e.amount, rate: e.rate, vat: e.vat, account: e.account, category: e.category, receipt: e.receipt, text: `Storno Nr. ${e.no}: ${e.text}`, cancels: e.id, reason: String(reason).trim(), ...(e.ref ? { ref: e.ref } : {}) },
    opts,
  )
}

/**
 * Kassensturz (Bargeld zählen): gezählt − laut Kassenbuch = Differenz; eine Differenz wird gebucht (Überschuss als
 * Einnahme, Fehlbetrag als Ausgabe). closesDay (Standard): Tagesabschluss – danach keine Buchung mehr an diesem Tag.
 * Liefert { count, entry } (entry null ohne Differenz).
 */
export function countCash(book, { date, counted, note = '', closesDay = true }, opts = {}) {
  book.counts ||= []
  const today = opts.today || viennaDate(opts.now || new Date().toISOString())
  const problem = dateProblem(book, date, today)
  if (problem) throw new CashError(problem)
  const c = round2(parseNumber(counted))
  if (!(c >= 0) || String(counted ?? '').trim() === '') throw new CashError('Bitte den gezählten Betrag eingeben (0 oder mehr).')
  const last = lastEntryDate(book)
  if (last && date < last) throw new CashError(`Es gibt schon Einträge nach dem ${de(date)} (bis ${de(last)}). Den Kassensturz bitte mit dem Datum des letzten Eintrags oder später machen.`)
  const expected = balanceAt(book, date)
  const diff = round2(c - expected)
  const s = cashSettings(book)
  let entry = null
  if (Math.abs(diff) >= 0.005)
    entry = addEntry(book, { date, kind: diff > 0 ? 'einnahme' : 'ausgabe', type: 'differenz', amount: Math.abs(diff), account: s.diffAccount, category: 'differenz', text: `Kassendifferenz (gezählt ${fmt(c)}, laut Kassenbuch ${fmt(expected)})${note ? `: ${note}` : ''}` }, opts)
  const count = { id: (opts.newId || (() => Math.random().toString(36).slice(2, 10)))(), date, at: opts.now || new Date().toISOString(), by: opts.by || '', counted: c, expected, diff, entryId: entry?.id || '', closesDay: closesDay !== false, note }
  book.counts.push(count)
  return { count, entry }
}

/** Bericht eines Monats: { month, opening, rows [{ entry, balance, cancelled }], sumIn, sumOut, closing, counts, closed }. */
export function monthReport(book, month) {
  const from = `${month}-01`
  const opening = round2((book.entries || []).filter((e) => e.date < from).reduce((s, e) => s + signedAmount(e), 0))
  let bal = opening
  const rows = orderedEntries((book.entries || []).filter((e) => String(e.date).startsWith(month))).map((entry) => {
    bal = round2(bal + signedAmount(entry))
    return { entry, balance: bal, cancelled: isCancelled(book, entry.id) }
  })
  const sumIn = round2(rows.filter((r) => r.entry.kind === 'einnahme').reduce((s, r) => s + r.entry.amount, 0))
  const sumOut = round2(rows.filter((r) => r.entry.kind === 'ausgabe').reduce((s, r) => s + r.entry.amount, 0))
  return { month, opening, rows, sumIn, sumOut, closing: round2(opening + sumIn - sumOut), counts: (book.counts || []).filter((c) => c.date.startsWith(month)), closed: (book.closings || []).find((c) => c.month === month) || null }
}

const closingSum = (book, month) => fnv1a(orderedEntries((book.entries || []).filter((e) => String(e.date).startsWith(month))).map((e) => `${e.no}:${cashChecksum(e)}`).join('|'))

/** Erster Monat mit Einträgen, der noch nicht abgeschlossen ist ('' wenn keiner). */
export function firstOpenMonth(book) {
  const closed = new Set((book.closings || []).map((c) => c.month))
  return [...new Set((book.entries || []).map((e) => String(e.date).slice(0, 7)))].sort().find((m) => !closed.has(m)) || ''
}

/**
 * Monatsabschluss: nur für vergangene Monate, der Reihe nach. Hält Anfangs- und Endstand, Summen und eine
 * Prüfsumme über alle Einträge fest; danach sind Buchungen mit Datum in diesem Monat (und davor) gesperrt.
 */
export function closeMonth(book, month, { now = new Date().toISOString(), by = '', today = viennaDate(now) || now.slice(0, 10), newId = () => Math.random().toString(36).slice(2, 10) } = {}) {
  book.closings ||= []
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new CashError('Bitte einen Monat wählen.')
  if (month >= today.slice(0, 7)) throw new CashError('Abschließen geht erst nach dem Monatsende.')
  if (book.closings.some((c) => c.month === month)) throw new CashError(`${monthText(month)} ist schon abgeschlossen.`)
  const first = firstOpenMonth(book)
  if (first && first < month) throw new CashError(`Bitte zuerst ${monthText(first)} abschließen (der Reihe nach).`)
  const lock = lockedUntil(book)
  if (lock && month < lock) throw new CashError(`Ein späterer Monat (${monthText(lock)}) ist schon abgeschlossen.`)
  const r = monthReport(book, month)
  const closing = { id: newId(), month, at: now, by, opening: r.opening, sumIn: r.sumIn, sumOut: r.sumOut, balance: r.closing, entries: r.rows.length, checksum: closingSum(book, month) }
  book.closings.push(closing)
  return closing
}

/** Stimmt der Monat noch mit dem Abschluss überein (keine Einträge geändert, dazugekommen oder entfernt)? */
export const closingIntact = (book, closing) => closing.checksum === closingSum(book, closing.month)

/** Probleme im Kassenbuch (z. B. nach Bearbeiten der Datei von Hand): [{ level, text }]. */
export function cashProblems(book) {
  const out = []
  const broken = (book.entries || []).filter((e) => !cashIntact(e))
  if (broken.length) out.push({ level: 'error', text: `Eintrag nachträglich verändert: Nr. ${broken.map((e) => e.no).join(', ')} (Prüfsumme passt nicht). Im Versionsverlauf von SharePoint nachsehen.` })
  for (const c of book.closings || []) if (!closingIntact(book, c)) out.push({ level: 'error', text: `Der abgeschlossene Monat ${monthText(c.month)} wurde nachträglich verändert (Prüfsumme des Abschlusses passt nicht).` })
  const neg = firstNegative(book.entries || [])
  if (neg) out.push({ level: 'error', text: `Kassenstand am ${de(neg.date)} negativ (${fmt(neg.balance)}).` })
  const nos = (book.entries || []).map((e) => Number(e.no)).sort((a, b) => a - b)
  const gaps = nos.filter((n, i) => i && n !== nos[i - 1] + 1 && n !== nos[i - 1])
  if (gaps.length) out.push({ level: 'warning', text: `Lücke in der Nummerierung vor Nr. ${gaps.join(', ')}.` })
  return out
}

/**
 * Doppelte Nummern (zwei Geräte haben gleichzeitig gebucht, Datei zusammengeführt): der spätere Eintrag bekommt die
 * nächste freie Nummer, vermerkt in renumbered. Liefert [{ id, from, to }].
 */
export function resolveCashDuplicates(book, { now = new Date().toISOString(), by = '' } = {}) {
  const groups = new Map()
  for (const e of book.entries || []) groups.set(e.no, [...(groups.get(e.no) || []), e])
  const out = []
  let next = nextNo(book)
  for (const [no, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (list.length < 2) continue
    const later = [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id))).slice(1)
    for (const e of later) {
      e.renumbered = [...(e.renumbered || []), { from: no, at: now, by }]
      e.no = next++
      out.push({ id: e.id, from: no, to: e.no })
    }
  }
  return out
}

// ---------------------------------------------------------------- Registrierkasse

/** Barumsätze im Jahr (Einnahmen der Kategorien mit sales, abzüglich Storno): { gross, net, over }. */
export function cashSales(book, year) {
  const sales = new Set(CASH_CATEGORIES.einnahme.filter((c) => c.sales).map((c) => c.id))
  let gross = 0
  let vat = 0
  for (const e of book.entries || []) {
    if (!String(e.date).startsWith(String(year)) || !sales.has(e.category)) continue
    const sign = e.type === 'storno' ? -1 : 1
    gross += sign * e.amount
    vat += sign * (e.vat || 0)
  }
  gross = round2(gross)
  return { gross, net: round2(gross - vat), over: gross - vat > RKSV.cash }
}

// ---------------------------------------------------------------- Export

export const CASH_EXPORT_COLUMNS = {
  belegnr: ['Kassenbuch-Nr.', (r) => r.number],
  belegdatum: ['Belegdatum', (r, f) => f.date(r.date)],
  belegart: ['Belegart', (r) => r.kindLabel],
  konto: ['Konto (Kassa)', (r) => r.cashAccount],
  gegenkonto: ['Gegenkonto', (r) => r.account],
  text: ['Text', (r) => r.text],
  steuersatz: ['Steuersatz', (r, f) => f.num(r.rate)],
  steuercode: ['Steuercode', (r) => r.code],
  netto: ['Netto', (r, f) => f.num(r.net)],
  steuer: ['Steuer', (r, f) => f.num(r.vat)],
  brutto: ['Brutto', (r, f) => f.num(r.gross)],
  beleg: ['Beleg', (r) => r.receipt],
  storno: ['Storno zu', (r) => r.cancelsNo],
}
export const CASH_EXPORT_DEFAULT = ['belegnr', 'belegdatum', 'belegart', 'konto', 'gegenkonto', 'text', 'steuersatz', 'steuercode', 'netto', 'steuer', 'brutto', 'beleg', 'storno']

/**
 * Buchungszeilen für die Steuerberatung (BMD/RZL wie der Export der Fakturierung): je Eintrag eine Zeile, Einnahme
 * positiv, Ausgabe negativ; Steuer bei Einnahmen Umsatzsteuer, bei Ausgaben Vorsteuer (Steuercode VST).
 */
export function cashExportRows(book, { from, to } = {}) {
  const s = cashSettings(book)
  const byId = new Map((book.entries || []).map((e) => [e.id, e]))
  return orderedEntries((book.entries || []).filter((e) => (!from || e.date >= from) && (!to || e.date <= to))).map((e) => {
    const sign = e.kind === 'ausgabe' ? -1 : 1
    const vat = round2(e.vat || 0)
    return {
      number: String(e.no),
      date: e.date,
      kindLabel: 'KA',
      cashAccount: s.account,
      account: e.account,
      text: e.text,
      rate: e.rate || 0,
      code: vat ? (e.kind === 'ausgabe' ? 'VST' : 'UST') : '',
      net: round2(sign * (e.amount - vat)),
      vat: round2(sign * vat),
      gross: round2(sign * e.amount),
      receipt: e.receipt || '',
      cancelsNo: e.cancels ? String(byId.get(e.cancels)?.no || '') : '',
    }
  })
}

// ---------------------------------------------------------------- Übernahme

/**
 * Einträge eines alten Kassenbuchs übernehmen (orgaMAX): idempotent über source.id bzw. die alte Nummer, der Reihe
 * nach nummeriert, nur im offenen Zeitraum und nicht vor dem letzten vorhandenen Eintrag (chronologisch).
 * list: [{ date, kind | amount mit Vorzeichen, amount, text, rate, vat, account, category, receipt, type, no, source: { system, id } }]
 * Liefert { added, skipped [{ ref, reason }], warnings [] }.
 */
export function importCash(book, list = [], { newId = () => Math.random().toString(36).slice(2, 10), now = new Date().toISOString(), by = 'Übernahme', system = 'orgaMAX' } = {}) {
  book.entries ||= []
  book.counts ||= []
  book.closings ||= []
  const out = { added: 0, skipped: [], warnings: [] }
  const refOf = (x) => String(x.source?.id ?? x.no ?? '')
  const known = new Set(book.entries.filter((e) => e.imported).map((e) => `${e.imported.system}|${e.imported.ref}`))
  const items = [...list].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Number(a.no) || 0) - (Number(b.no) || 0))
  for (const raw of items) {
    const sys = raw.source?.system || system
    const ref = refOf(raw)
    if (ref && known.has(`${sys}|${ref}`)) {
      out.skipped.push({ ref, reason: 'schon übernommen' })
      continue
    }
    const value = parseNumber(raw.amount)
    const kind = raw.kind || (value < 0 ? 'ausgabe' : 'einnahme')
    const last = lastEntryDate(book)
    if (last && raw.date < last) {
      out.skipped.push({ ref, reason: `vor dem letzten Eintrag im Kassenbuch (${de(last)})` })
      continue
    }
    const problem = dateProblem(book, raw.date, null)
    if (problem) {
      out.skipped.push({ ref, reason: problem })
      continue
    }
    if (!(Math.abs(value) > 0)) {
      out.skipped.push({ ref, reason: 'ohne Betrag' })
      continue
    }
    const amount = round2(Math.abs(value))
    const rate = parseNumber(raw.rate)
    const entry = {
      id: newId(),
      no: nextNo(book),
      date: raw.date,
      at: now,
      kind,
      type: raw.type === 'anfang' ? 'anfang' : 'buchung',
      text: String(raw.text || '').trim() || (kind === 'einnahme' ? 'Einnahme' : 'Ausgabe'),
      amount,
      rate,
      vat: raw.vat != null && raw.vat !== '' ? round2(Math.abs(parseNumber(raw.vat))) : rate ? round2(amount - amount / (1 + rate / 100)) : 0,
      account: String(raw.account || ''),
      category: raw.category || '',
      receipt: String(raw.receipt || ''),
      by,
      imported: { system: sys, ref, ...(raw.no != null ? { no: String(raw.no) } : {}) },
    }
    entry.checksum = cashChecksum(entry)
    book.entries.push(entry)
    if (ref) known.add(`${sys}|${ref}`)
    out.added++
  }
  const neg = firstNegative(book.entries)
  if (neg) out.warnings.push(`Kassenstand nach der Übernahme am ${de(neg.date)} negativ (${fmt(neg.balance)}): fehlt der Anfangsbestand oder eine Einnahme?`)
  return out
}

// ---------------------------------------------------------------- Hilfen für die Oberfläche

/** Fälliger Monatsabschluss: der erste offene Monat vor dem laufenden ('' wenn keiner). */
export function dueClosing(book, today) {
  const m = firstOpenMonth(book)
  return m && m < today.slice(0, 7) ? m : ''
}

/** Kassensturz überfällig? Tage seit dem letzten Kassensturz, wenn seither gebucht wurde (sonst 0). */
export function daysSinceCount(book, today) {
  const lastCount = (book.counts || []).map((c) => c.date).sort().at(-1) || ''
  const last = lastEntryDate(book)
  if (!last || (lastCount && lastCount >= last)) return 0
  const from = lastCount || (book.entries || []).map((e) => e.date).sort()[0]
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000)
}

export { prevMonth }
