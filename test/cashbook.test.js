// Kassenbuch (core/cashbook.js): Kassenstand nie negativ, Storno statt Ändern/Löschen, Anfangsbestand,
// Kassensturz mit Differenz, Tages- und Monatssperre, Prüfsummen, Zusammenführen, Export, Übernahme.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addEntry,
  balanceAt,
  cashExportRows,
  cashIntact,
  cashProblems,
  cashSales,
  closeMonth,
  closingIntact,
  countCash,
  dueClosing,
  emptyCashbook,
  importCash,
  isCancelled,
  monthReport,
  openingAllowed,
  openingBalance,
  resolveCashDuplicates,
  stornoEntry,
  withRunning,
} from '../src/core/cashbook.js'
import { toCsv } from '../src/core/purchase.js'
import { CASH_EXPORT_COLUMNS, CASH_EXPORT_DEFAULT } from '../src/core/cashbook.js'

let n = 0
const opts = (today = '2026-11-05', extra = {}) => ({ newId: () => `k${++n}`, now: `${today}T10:00:00.000Z`, by: 'Test', today, ...extra })
const book = () => {
  const b = emptyCashbook()
  openingBalance(b, { date: '2026-10-01', amount: 200 }, opts('2026-10-01'))
  return b
}

test('Kassenbuch: Anfangsbestand nur als erster Eintrag, fortlaufende Nummern, laufender Stand', () => {
  const b = book()
  assert.equal(b.entries[0].type, 'anfang')
  assert.equal(b.entries[0].no, 1)
  assert.throws(() => openingBalance(b, { date: '2026-10-02', amount: 50 }, opts('2026-10-02')), /ersten Eintrag/)
  addEntry(b, { date: '2026-10-02', kind: 'ausgabe', amount: '45,90', text: 'Reinigungsmittel Baumarkt', rate: 20, account: '5300' }, opts('2026-10-02'))
  addEntry(b, { date: '2026-10-03', kind: 'einnahme', amount: 120, text: 'Barzahlung Kunde', account: '2000' }, opts('2026-10-03'))
  assert.deepEqual(b.entries.map((e) => e.no), [1, 2, 3])
  assert.equal(b.entries[1].vat, 7.65, 'Vorsteuer aus brutto 45,90 bei 20 %')
  assert.deepEqual(withRunning(b.entries).map((r) => r.balance), [200, 154.1, 274.1])
  assert.equal(balanceAt(b, '2026-10-02'), 154.1)
  assert.equal(balanceAt(b), 274.1)
})

test('Kassenbuch: Kassenstand nie negativ – Buchung wird mit Hinweis verweigert (auch rückdatiert)', () => {
  const b = book()
  assert.throws(() => addEntry(b, { date: '2026-10-05', kind: 'ausgabe', amount: 250, text: 'Staubsauger' }, opts('2026-10-05')), /Kassenstand fiele am 05\.10\.2026 auf -50,00 €.*unter null/)
  assert.equal(b.entries.length, 1, 'nichts gebucht')
  addEntry(b, { date: '2026-10-05', kind: 'einnahme', amount: 100, text: 'Abhebung Bank' }, opts('2026-10-05'))
  addEntry(b, { date: '2026-10-06', kind: 'ausgabe', amount: 250, text: 'Staubsauger' }, opts('2026-10-06'))
  assert.equal(balanceAt(b), 50)
  // rückdatiert vor die Einnahme: an diesem Tag wäre der Stand negativ
  assert.throws(() => addEntry(b, { date: '2026-10-04', kind: 'ausgabe', amount: 210, text: 'zu viel' }, opts('2026-10-06')), /04\.10\.2026/)
  assert.throws(() => addEntry(b, { date: '2026-10-07', kind: 'ausgabe', amount: 0, text: 'null' }, opts('2026-10-07')), /Betrag über 0/)
  assert.throws(() => addEntry(b, { date: '2026-11-07', kind: 'ausgabe', amount: 1, text: 'Zukunft' }, opts('2026-11-05')), /Zukunft/)
})

test('Kassenbuch: Storno statt Löschen – Gegenbuchung mit eigener Nummer, Original unverändert', () => {
  const b = book()
  const e = addEntry(b, { date: '2026-10-02', kind: 'ausgabe', amount: 30, text: 'Tippfehler', rate: 20 }, opts('2026-10-02'))
  const before = JSON.stringify(e)
  assert.throws(() => stornoEntry(b, e.id, { reason: '' }, opts('2026-10-03')), /Grund/)
  const s = stornoEntry(b, e.id, { reason: 'falscher Betrag' }, opts('2026-10-03'))
  assert.deepEqual([s.no, s.type, s.kind, s.amount, s.cancels, s.date, s.vat], [3, 'storno', 'einnahme', 30, e.id, '2026-10-03', e.vat])
  assert.equal(JSON.stringify(e), before, 'Original bleibt, wie es war')
  assert.ok(isCancelled(b, e.id) && cashIntact(e) && cashIntact(s))
  assert.equal(balanceAt(b), 200)
  assert.throws(() => stornoEntry(b, e.id, { reason: 'nochmal' }, opts('2026-10-03')), /schon storniert/)
  assert.throws(() => stornoEntry(b, s.id, { reason: 'x' }, opts('2026-10-03')), /Storno kann nicht storniert/)
  // Storno einer Einnahme darf den Stand nicht unter null bringen
  const ein = addEntry(b, { date: '2026-10-04', kind: 'einnahme', amount: 500, text: 'Barzahlung' }, opts('2026-10-04'))
  addEntry(b, { date: '2026-10-05', kind: 'ausgabe', amount: 600, text: 'Gerät' }, opts('2026-10-05'))
  assert.throws(() => stornoEntry(b, ein.id, { reason: 'falsch' }, opts('2026-10-06')), /unter null/)
  // ein stornierter Anfangsbestand erlaubt einen neuen
  const c = emptyCashbook()
  const a = openingBalance(c, { date: '2026-10-01', amount: 80 }, opts('2026-10-01'))
  assert.ok(!openingAllowed(c))
  stornoEntry(c, a.id, { reason: 'falsch gezählt' }, opts('2026-10-01'))
  assert.ok(openingAllowed(c))
  openingBalance(c, { date: '2026-10-01', amount: 85 }, opts('2026-10-01'))
  assert.equal(balanceAt(c), 85)
})

test('Kassenbuch: Kassensturz bucht die Differenz und schließt den Tag', () => {
  const b = book()
  addEntry(b, { date: '2026-10-02', kind: 'ausgabe', amount: 20, text: 'Porto' }, opts('2026-10-02'))
  const { count, entry } = countCash(b, { date: '2026-10-02', counted: '178,50' }, opts('2026-10-02'))
  assert.deepEqual([count.expected, count.counted, count.diff], [180, 178.5, -1.5])
  assert.deepEqual([entry.type, entry.kind, entry.amount, entry.account], ['differenz', 'ausgabe', 1.5, '7890'])
  assert.equal(balanceAt(b), 178.5)
  assert.throws(() => addEntry(b, { date: '2026-10-02', kind: 'einnahme', amount: 5, text: 'zu spät' }, opts('2026-10-02')), /Kassensturz abgeschlossen/)
  addEntry(b, { date: '2026-10-03', kind: 'einnahme', amount: 5, text: 'am nächsten Tag' }, opts('2026-10-03'))
  // ohne Differenz: kein Eintrag; Kassensturz vor dem letzten Eintrag geht nicht
  assert.equal(countCash(b, { date: '2026-10-03', counted: 183.5, closesDay: false }, opts('2026-10-03')).entry, null)
  assert.throws(() => countCash(b, { date: '2026-10-02', counted: 1 }, opts('2026-10-03')), /abgeschlossen/)
  assert.throws(() => countCash(b, { date: '2026-10-03', counted: '' }, opts('2026-10-03')), /gezählten Betrag/)
})

test('Kassenbuch: Monatsabschluss sperrt den Monat, der Reihe nach, mit Prüfsumme', () => {
  const b = book()
  addEntry(b, { date: '2026-10-15', kind: 'ausgabe', amount: 40, text: 'Material', rate: 20 }, opts('2026-10-15'))
  addEntry(b, { date: '2026-11-02', kind: 'ausgabe', amount: 10, text: 'Parkschein' }, opts('2026-11-02'))
  assert.throws(() => closeMonth(b, '2026-11', opts('2026-11-05')), /nach dem Monatsende/)
  assert.equal(dueClosing(b, '2026-11-05'), '2026-10')
  const c = closeMonth(b, '2026-10', opts('2026-11-05'))
  assert.deepEqual([c.opening, c.sumIn, c.sumOut, c.balance, c.entries], [0, 200, 40, 160, 2])
  assert.ok(closingIntact(b, c))
  assert.throws(() => addEntry(b, { date: '2026-10-31', kind: 'einnahme', amount: 5, text: 'nachgetragen' }, opts('2026-11-05')), /Monat 10\/2026 ist abgeschlossen/)
  const e = b.entries.find((x) => x.date === '2026-10-15')
  assert.throws(() => stornoEntry(b, e.id, { reason: 'x', date: '2026-10-20' }, opts('2026-11-05')), /abgeschlossen/)
  // Storno im offenen Monat geht
  stornoEntry(b, e.id, { reason: 'Beleg doppelt' }, opts('2026-11-05'))
  assert.throws(() => closeMonth(b, '2026-10', opts('2026-11-05')), /schon abgeschlossen/)
  // Datei von Hand geändert: Abschluss und Eintrag melden es
  e.amount = 4
  assert.ok(!cashIntact(e) && !closingIntact(b, c))
  assert.equal(cashProblems(b).filter((p) => p.level === 'error').length, 2)
  const r = monthReport(b, '2026-11')
  assert.deepEqual([r.opening, r.rows.length], [196, 2])
})

test('Kassenbuch: der Reihe nach abschließen', () => {
  const b = book()
  addEntry(b, { date: '2026-11-02', kind: 'ausgabe', amount: 10, text: 'Parkschein' }, opts('2026-11-02'))
  assert.throws(() => closeMonth(b, '2026-11', opts('2026-12-02')), /zuerst 10\/2026/)
  closeMonth(b, '2026-10', opts('2026-12-02'))
  closeMonth(b, '2026-11', opts('2026-12-02'))
  assert.equal(b.closings.length, 2)
})

test('Kassenbuch: doppelte Nummer nach dem Zusammenführen – der spätere Eintrag rückt nach', () => {
  const b = book()
  const x = addEntry(b, { date: '2026-10-02', kind: 'einnahme', amount: 10, text: 'Gerät A' }, opts('2026-10-02'))
  // zweites Gerät hat gleichzeitig Nr. 2 vergeben
  const y = { ...x, id: 'fremd', at: '2026-10-02T11:00:00.000Z', text: 'Gerät B' }
  b.entries.push(y)
  const r = resolveCashDuplicates(b, { now: '2026-10-02T12:00:00.000Z', by: 'Test' })
  assert.deepEqual(r, [{ id: 'fremd', from: 2, to: 3 }])
  assert.deepEqual(b.entries.map((e) => e.no), [1, 2, 3])
  assert.equal(y.renumbered[0].from, 2)
})

test('Kassenbuch: Export für die Steuerberatung (Einnahme +, Ausgabe −, Storno mit Bezug)', () => {
  const b = book()
  const e = addEntry(b, { date: '2026-10-02', kind: 'ausgabe', amount: 12, text: 'Kaffee; Milch', rate: 20, account: '7360', receipt: 'B-17' }, opts('2026-10-02'))
  stornoEntry(b, e.id, { reason: 'privat' }, opts('2026-10-03'))
  const rows = cashExportRows(b, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(rows.map((r) => [r.number, r.gross, r.vat, r.code, r.cancelsNo]), [['1', 200, 0, '', ''], ['2', -12, -2, 'VST', ''], ['3', 12, 2, 'UST', '2']])
  const csv = toCsv(rows, CASH_EXPORT_COLUMNS, CASH_EXPORT_DEFAULT)
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'Kassenbuch-Nr.;Belegdatum;Belegart;Konto (Kassa);Gegenkonto;Text;Steuersatz;Steuercode;Netto;Steuer;Brutto;Beleg;Storno zu')
  assert.equal(lines[2], '2;02.10.2026;KA;2700;7360;"Kaffee; Milch";20,00;VST;-10,00;-2,00;-12,00;B-17;')
})

test('Kassenbuch: Barumsätze für die Registrierkassenpflicht', () => {
  const b = book()
  addEntry(b, { date: '2026-10-02', kind: 'einnahme', amount: 6000, text: 'Rechnung bar', category: 'rechnung' }, opts('2026-10-02'))
  const v = addEntry(b, { date: '2026-10-03', kind: 'einnahme', amount: 2400, text: 'Sonderreinigung bar', category: 'verkauf', rate: 20 }, opts('2026-10-03'))
  assert.deepEqual(cashSales(b, 2026), { gross: 8400, net: 8000, over: true })
  stornoEntry(b, v.id, { reason: 'Karte' }, opts('2026-10-04'))
  assert.equal(cashSales(b, 2026).over, false)
})

test('Kassenbuch: Übernahme aus orgaMAX idempotent und chronologisch', () => {
  const b = emptyCashbook()
  const old = [
    { no: 1, date: '2026-01-02', amount: 150, text: 'Anfangsbestand', type: 'anfang' },
    { no: 2, date: '2026-01-05', amount: -30.5, text: 'Briefmarken', rate: 0 },
    { no: 3, date: '2026-01-07', amount: 60, kind: 'einnahme', text: 'Barzahlung RE 4711', category: 'rechnung' },
  ]
  const r1 = importCash(b, old, { newId: () => `i${++n}`, now: '2026-11-05T10:00:00.000Z' })
  assert.equal(r1.added, 3)
  assert.deepEqual(b.entries.map((e) => [e.no, e.kind, e.amount, e.imported.ref]), [[1, 'einnahme', 150, '1'], [2, 'ausgabe', 30.5, '2'], [3, 'einnahme', 60, '3']])
  const r2 = importCash(b, old, { newId: () => `i${++n}` })
  assert.equal(r2.added, 0)
  assert.equal(r2.skipped.length, 3)
  // ein Eintrag vor dem letzten vorhandenen wird nicht dazwischen geschoben
  const r3 = importCash(b, [{ no: 9, date: '2026-01-06', amount: 5, text: 'zu früh' }])
  assert.match(r3.skipped[0].reason, /vor dem letzten Eintrag/)
  // Stand negativ: Warnung
  const c = emptyCashbook()
  assert.match(importCash(c, [{ no: 1, date: '2026-01-02', amount: -10, text: 'ohne Anfangsbestand' }]).warnings[0], /negativ/)
})

test('Kassenbuch-PDF: Anfangsbestand, Einträge mit Stand, Storno-Verweis, Summen, Abschluss', async () => {
  const { cashbookDocument, cashbookPdfPath } = await import('../src/export/cashbook-pdf.js')
  const b = book()
  const e = addEntry(b, { date: '2026-10-02', kind: 'ausgabe', amount: 30, text: 'Tippfehler' }, opts('2026-10-02'))
  stornoEntry(b, e.id, { reason: 'falscher Betrag' }, opts('2026-10-03'))
  closeMonth(b, '2026-10', opts('2026-11-05'))
  const doc = cashbookDocument({ book: b, month: '2026-10', createdAt: new Date('2026-11-05T10:00:00Z') })
  const table = doc.content.find((x) => x.table).table.body
  const flat = JSON.stringify(doc.content)
  assert.equal(table.length, 1 + 1 + 3 + 1, 'Kopf, Anfangsbestand, 3 Einträge, Summe')
  assert.match(flat, /Tippfehler \(storniert mit Nr\. 3\)/)
  assert.match(flat, /Storno Nr\. 2: Tippfehler – Grund: falscher Betrag/)
  assert.match(flat, /Monat abgeschlossen am/)
  assert.equal(cashbookPdfPath('2026-10'), 'einkauf/kassenbuch/2026/Kassenbuch_2026-10.pdf')
})

test('Kassenbuch-PDF: Abschluss am 1. um 0:30 Uhr steht mit dem Tag in Wien da, nicht mit dem letzten Tag des Monats', async () => {
  const { cashbookDocument } = await import('../src/export/cashbook-pdf.js')
  const b = book()
  // So 1.11.2026 0:30 Uhr in Wien = 31.10. 23:30 UTC
  closeMonth(b, '2026-10', { ...opts('2026-11-01'), now: '2026-10-31T23:30:00.000Z' })
  const flat = JSON.stringify(cashbookDocument({ book: b, month: '2026-10', createdAt: new Date('2026-11-05T10:00:00Z') }).content)
  assert.match(flat, /Monat abgeschlossen am 01\.11\.2026/)
})
