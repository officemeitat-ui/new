import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { applyAllocation, dedupe, detectCsv, emptyBank, fieldsFromText, nameScore, numbersIn, parseAmount, parseCamt, parseDate, prune, readStatement, rememberIban, staleCredits, suggest, undoAllocation } from '../src/core/bank.js'
import { openAmount, stateOf } from '../src/core/invoicing.js'

const fixture = (name) => readFileSync(new URL(`./fixtures/bank/${name}`, import.meta.url), 'utf8')

// Beispiel-Belege: drei offene Rechnungen, eine stornierte, eine schon bezahlte
const inv = (id, number, gross, customerId, name, extra = {}) => ({ id, kind: 'rechnung', number, date: '2026-10-01', dueDate: '2026-10-15', customerId, recipient: { name }, total: { net: gross / 1.2, vat: gross - gross / 1.2, gross }, payments: [], ...extra })
const docs = () => [
  inv('d3', 'RE-2026-0003', 1234.56, 'c1', 'Hausverwaltung Beispiel GmbH'),
  inv('d4', 'RE-2026-0004', 600, 'c2', 'Autohaus Maxglan Beispiel KG'),
  inv('d5', 'RE-2026-0005', 240, 'c1', 'Hausverwaltung Beispiel GmbH', { dueDate: '2026-10-20' }),
  inv('d6', 'RE-2026-0006', 120.5, 'c1', 'Hausverwaltung Beispiel GmbH', { dueDate: '2026-10-25' }),
  inv('d7', 'RE-2026-0007', 99, 'c3', 'Partner Beispiel GmbH'),
  { id: 's7', kind: 'storno', number: 'ST-2026-0001', refId: 'd7', date: '2026-10-05', total: { gross: -99 } },
  inv('d8', 'RE-2026-0008', 80, 'c3', 'Partner Beispiel GmbH', { payments: [{ id: 'p1', date: '2026-10-10', amount: 80 }] }),
]
const customers = [
  { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', ibans: ['AT483200000012345864'] },
  { id: 'c2', name: 'Autohaus Maxglan Beispiel KG' },
  { id: 'c3', name: 'Partner Beispiel GmbH' },
]
const ctx = (d = docs()) => ({ docs: d, customers, settings: {} })

test('Bank: Beträge und Daten in den Schreibweisen der Banken', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('+1.234,56'), 1234.56)
  assert.equal(parseAmount('-75,40'), -75.4)
  assert.equal(parseAmount('1234.56'), 1234.56)
  assert.equal(parseAmount('1,234.56'), 1234.56)
  assert.equal(parseAmount('12,30 S'), -12.3)
  assert.equal(parseAmount('12,30-'), -12.3)
  assert.equal(parseAmount('0,1') + parseAmount('0,2'), 0.30000000000000004, 'Gleitkomma bleibt Gleitkomma …')
  assert.equal(Math.round((parseAmount('0,1') + parseAmount('0,2')) * 100), 30, '… gerechnet wird in Cent')
  assert.equal(parseDate('04.11.2026'), '2026-11-04')
  assert.equal(parseDate('4.1.26'), '2026-01-04')
  assert.equal(parseDate('2026-11-04T08:00:00'), '2026-11-04')
  assert.equal(parseDate('04.11.2026 08:15:22:123'), '2026-11-04')
})

test('Bank: camt.053 mit Sammelgutschrift, Abbuchung, Rückbuchung, ohne vorgemerkte', () => {
  const c = parseCamt(fixture('camt053.xml'))
  assert.equal(c.format, 'camt.053')
  assert.equal(c.account, 'AT611904300234573201')
  assert.equal(c.transactions.length, 5, 'PDNG ausgelassen, Sammelgutschrift in 2 Zahlungen aufgeteilt')
  const [hv, a, b, debit, rev] = c.transactions
  assert.deepEqual([hv.amount, hv.name, hv.iban, hv.text], [1234.56, 'Hausverwaltung Beispiel GmbH', 'AT483200000012345864', 'Rechnung RE-2026-0003'])
  assert.deepEqual([a.amount, a.reference, a.batch], [600, 'RE20260004', { of: 2, n: 1, total: 900 }])
  assert.equal(b.name, 'Unbekannt & Söhne')
  assert.equal(debit.amount, -75.4)
  assert.equal(debit.name, 'Reinigungsmittel Großhandel', 'bei Abbuchungen der Empfänger')
  assert.equal(rev.reversal, true)
})

test('Bank: camt.052 (Umsätze untertags) wird wie camt.053 gelesen', () => {
  const xml = fixture('camt053.xml').replace(/BkToCstmrStmt/g, 'BkToCstmrAcctRpt').replace(/<Stmt>/g, '<Rpt>').replace(/<\/Stmt>/g, '</Rpt>').replace('camt.053.001.08', 'camt.052.001.08')
  const c = parseCamt(xml)
  assert.equal(c.format, 'camt.052')
  assert.equal(c.transactions.length, 5)
})

test('Bank: George-CSV mit Kopfzeile', () => {
  const r = readStatement(fixture('george.csv'))
  assert.equal(r.format, 'george')
  assert.equal(r.transactions.length, 3)
  assert.deepEqual(r.transactions.map((t) => t.amount), [1234.56, -75.4, 500])
  assert.equal(r.transactions[0].iban, 'AT483200000012345864', 'IBAN ohne Leerzeichen')
  assert.equal(r.transactions[2].reference, 'RE 2026 4')
})

test('Bank: ELBA-CSV ohne Kopfzeile, Felder aus dem Buchungstext', () => {
  const r = readStatement(fixture('elba.csv'))
  assert.equal(r.format, 'elba')
  const [g, l] = r.transactions
  assert.deepEqual([g.date, g.amount, g.name, g.iban], ['2026-11-04', 1234.56, 'Hausverwaltung Beispiel GmbH', 'AT483200000012345864'])
  assert.deepEqual([l.amount, l.reference], [-89.9, 'POL-123'])
  assert.deepEqual(fieldsFromText('Auftraggeber: Max Muster IBAN Auftraggeber: AT61 1904 3002 3457 3201 Verwendungszweck: RE-2026-1'), { name: 'Max Muster', iban: 'AT611904300234573201', bic: '', reference: '', purpose: 'RE-2026-1' })
})

test('Bank: BAWAG und allgemeine CSV mit eigener Spaltenzuordnung', () => {
  assert.equal(readStatement(fixture('bawag.csv')).transactions[0].amount, 600)
  const own = 'Datum,Text,Haben,Soll\n2026-11-04,Zahlung RE-2026-0005,240.00,\n2026-11-05,Miete,,1200.00\n'
  const det = detectCsv(own)
  assert.equal(det.sep, ',')
  const r = readStatement(own, { mapping: { date: 0, text: 1, credit: 2, debit: 3 } })
  assert.deepEqual(r.transactions.map((t) => t.amount), [240, -1200])
})

test('Bank: Doppelte beim zweiten Einlesen, gleiche Buchungen in einer Datei bleiben', () => {
  const bank = emptyBank()
  const txs = readStatement(fixture('george.csv')).transactions
  const twice = [...txs, { ...txs[2] }] // zwei gleiche Zahlungen am selben Tag
  const first = dedupe(twice, bank.hashes)
  assert.equal(first.fresh.length, 4)
  assert.equal(first.duplicates, 0)
  for (const t of first.fresh) bank.hashes[t.id] = t.date
  const again = dedupe(twice, bank.hashes)
  assert.equal(again.fresh.length, 0)
  assert.equal(again.duplicates, 4)
  assert.deepEqual(first.fresh.map((t) => t.status), ['offen', 'abbuchung', 'offen', 'offen'])
})

test('Bank: Rechnungsnummern in allen Schreibweisen', () => {
  assert.deepEqual(numbersIn('Rg RE-2026-3 und RE 2026 0004, re2026/0005'), ['RE|2026|3', 'RE|2026|4', 'RE|2026|5'])
  assert.deepEqual(numbersIn('FIRE-2026-1 ist keine'), [])
  assert.ok(nameScore('HAUSVERWALTUNG BEISPIEL', 'Hausverwaltung Beispiel GmbH') >= 0.99)
})

test('Bank: Zuordnung über Nummer (sicher), Teilzahlung, Überzahlung, Sammelzahlung', () => {
  const tx = (amount, text, extra = {}) => ({ id: 't', date: '2026-11-04', amount, name: '', iban: '', text, reference: '', ...extra })
  let s = suggest(tx(1234.56, 'Rechnung RE-2026-0003'), ctx())
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'd3', amount: 1234.56 }])
  s = suggest(tx(500, 'Anzahlung', { reference: 'RE 2026 4' }), ctx())
  assert.equal(s.level, 'sicher')
  assert.equal(s.note, 'teilzahlung')
  assert.match(s.reasons.join(' '), /Teilzahlung.*offen 100,00 €/)
  s = suggest(tx(650, 'RE-2026-0004'), ctx())
  assert.equal(s.level, 'wahrscheinlich')
  assert.deepEqual(s.allocations, [{ docId: 'd4', amount: 650 }], 'Überzahlung bleibt bei der Rechnung')
  s = suggest(tx(1474.56, 'RE-2026-0003 RE-2026-0005'), ctx())
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'd3', amount: 1234.56 }, { docId: 'd5', amount: 240 }])
})

test('Bank: storniert oder schon bezahlt: kein Buchungsvorschlag, Hinweis', () => {
  const tx = (text) => ({ id: 't', date: '2026-11-04', amount: 99, name: '', iban: '', text, reference: '' })
  let s = suggest(tx('RE-2026-0007'), ctx())
  assert.equal(s.level, 'unsicher')
  assert.equal(s.allocations.length, 0)
  assert.match(s.reasons.join(' '), /storniert/)
  s = suggest({ ...tx('RE-2026-0008'), amount: 80 }, ctx())
  assert.match(s.reasons.join(' '), /schon bezahlt/)
})

test('Bank: ohne Nummer über IBAN oder Namen und Betrag, Summe mehrerer Rechnungen', () => {
  // IBAN bekannt, Betrag stimmt genau
  let s = suggest({ id: 't', date: '2026-11-04', amount: 240, name: '', iban: 'AT48 3200 0000 1234 5864', text: 'Dauerauftrag', reference: '' }, ctx())
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'd5', amount: 240 }])
  // nur der Name, Betrag = zwei Rechnungen
  s = suggest({ id: 't', date: '2026-11-04', amount: 360.5, name: 'HAUSVERWALTUNG BEISPIEL', iban: '', text: 'Zahlung', reference: '' }, ctx())
  assert.equal(s.level, 'wahrscheinlich')
  assert.deepEqual(s.allocations.map((a) => a.docId).sort(), ['d5', 'd6'])
  // nur der Betrag passt
  s = suggest({ id: 't', date: '2026-11-04', amount: 600, name: 'Jemand', iban: '', text: 'x', reference: '' }, ctx())
  assert.equal(s.level, 'unsicher')
  // gar nichts
  s = suggest({ id: 't', date: '2026-11-04', amount: 300, name: 'Unbekannt & Söhne', iban: '', text: 'Danke', reference: '' }, ctx())
  assert.equal(s.level, null)
  // Abbuchung
  assert.equal(suggest({ id: 't', amount: -75.4, text: 'RE-2026-0003' }, ctx()).level, null)
})

test('Bank: Zuordnung buchen und lösen, offene Posten stimmen, Rundung auf Cent', () => {
  const d = docs()
  const tx = { id: 'b1', date: '2026-11-04', amount: 1474.56, name: 'Hausverwaltung', status: 'offen', allocations: [] }
  assert.throws(() => applyAllocation(tx, [{ docId: 'd3', amount: 1234.56 }], d), /ergeben nicht/)
  applyAllocation(tx, [{ docId: 'd3', amount: 1234.556 }, { docId: 'd5', amount: 240.004 }], d, { by: 'Büro' })
  assert.equal(tx.status, 'zugeordnet')
  assert.equal(openAmount(d[0], d, {}), 0)
  assert.equal(stateOf(d[2], d, '2026-11-04', {}), 'bezahlt')
  assert.equal(d[0].payments[0].bank, 'b1')
  undoAllocation(tx, d, { by: 'Büro' })
  assert.equal(tx.status, 'offen')
  assert.equal(openAmount(d[0], d, {}), 1234.56)
})

test('Bank: IBAN merken, alte Buchungen entfernen, Zu erledigen nach 7 Tagen', () => {
  const c = { id: 'c2', name: 'Autohaus' }
  assert.equal(rememberIban(c, 'AT02 2050 3021 0102 3600'), true)
  assert.equal(rememberIban(c, 'AT022050302101023600'), false)
  const bank = { tx: [{ id: 'a', date: '2025-09-01', amount: 10, status: 'offen' }, { id: 'b', date: '2026-10-20', amount: 10, status: 'offen' }, { id: 'c', date: '2026-11-02', amount: 10, status: 'offen' }, { id: 'd', date: '2026-10-01', amount: -5, status: 'abbuchung' }], hashes: { a: '2025-09-01', b: '2026-10-20' } }
  prune(bank, '2026-11-04')
  assert.deepEqual(bank.tx.map((x) => x.id), ['b', 'c', 'd'])
  assert.deepEqual(Object.keys(bank.hashes), ['b'])
  assert.deepEqual(staleCredits(bank, '2026-11-04').map((x) => x.id), ['b'])
})
