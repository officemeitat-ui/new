// Paket für die Steuerberatung: Zeiträume, Buchungszeilen, Fingerabdruck und Nachreichung, Prüfliste, Zahlungen,
// offene Posten, Inhalt, Erinnerung (core/steuerberatung.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stbChanges,
  stbChecks,
  stbChoices,
  stbCsv,
  stbInhalt,
  stbLastHandover,
  stbMergePrints,
  stbOpenItems,
  stbPayments,
  stbPeriod,
  stbPrints,
  stbRecord,
  stbReminder,
  stbRows,
  stbSums,
  PAYMENT_COLS,
} from '../src/core/steuerberatung.js'

const inv = (id, number, date, net, extra = {}) => ({ id, kind: 'rechnung', number, date, dueDate: extra.dueDate || date, recipient: { name: `Kunde ${id}` }, customerId: 'c1', lines: [{ qty: 1, price: net, vat: 20 }], payments: [], ...extra })
const fak = () => ({
  settings: {},
  customers: [{ id: 'c1', name: 'Kunde', account: '20001' }],
  documents: [
    inv('a', 'RE-2026-0001', '2026-10-03', 100),
    inv('b', 'RE-2026-0002', '2026-10-20', 200, { payments: [{ id: 'p1', date: '2026-10-25', amount: 120 }, { id: 'p2', date: '2026-11-02', amount: 120 }] }),
    inv('c', 'RE-2026-0003', '2026-11-04', 50),
    { id: 'd', kind: 'rechnung', date: '2026-10-28', recipient: { name: 'Entwurf GmbH' }, lines: [{ qty: 1, price: 10, vat: 20 }] },
  ],
})
const einkauf = () => ({
  suppliers: [{ id: 's1', name: 'Lieferant', uid: 'ATU12345678' }],
  invoices: [
    { id: 'e1', no: 'ER-2026-0001', number: 'L-77', date: '2026-10-05', dueDate: '2026-10-19', supplierId: 's1', supplier: { name: 'Lieferant', uid: 'ATU12345678', address: 'Weg 1, 5020 Salzburg' }, groups: [{ rate: 20, net: 100, vat: 20 }], beleg: { path: 'einkauf/belege/2026/ER-2026-0001.pdf' }, payments: [{ id: 'q', date: '2026-10-15', amount: 120 }] },
    { id: 'e2', no: 'ER-2026-0002', number: 'L-78', date: '2026-10-12', supplierId: 's1', supplier: { name: 'Lieferant' }, groups: [{ rate: 20, net: 50, vat: 10 }], payments: [] },
  ],
  settings: {},
})

test('Zeiträume: Monat, Quartal, Jahr und Auswahl ab dem laufenden Monat', () => {
  assert.deepEqual(stbPeriod('2026-10'), { id: '2026-10', kind: 'monat', from: '2026-10-01', to: '2026-10-31', label: 'Oktober 2026' })
  assert.deepEqual(stbPeriod('2026-Q1'), { id: '2026-Q1', kind: 'quartal', from: '2026-01-01', to: '2026-03-31', label: '1. Quartal 2026' })
  assert.equal(stbPeriod('2028-02').to, '2028-02-29')
  assert.equal(stbPeriod('2026').to, '2026-12-31')
  assert.equal(stbPeriod('2026-13'), null)
  const c = stbChoices('2026-01-09')
  assert.equal(c.months[0].id, '2026-01')
  assert.equal(c.standard, '2025-12')
  assert.deepEqual(c.quarters.slice(0, 3).map((q) => q.id), ['2026-Q1', '2025-Q4', '2025-Q3'])
  assert.deepEqual(c.years.map((y) => y.id), ['2026', '2025', '2024'])
})

test('Buchungszeilen, Summen und Fingerabdruck: Änderungen nach der Übergabe als Nachreichung', () => {
  const p = stbPeriod('2026-10')
  const F = fak()
  const E = einkauf()
  const rows = stbRows({ fak: F, einkauf: E }, p)
  assert.deepEqual(rows.ar.map((r) => r.number), ['RE-2026-0001', 'RE-2026-0002'])
  assert.equal(rows.er.length, 2)
  const sums = stbSums(rows)
  assert.deepEqual(sums.ar, { count: 2, net: 300, vat: 60, gross: 360 })
  const prints = stbPrints(rows)
  assert.deepEqual(Object.keys(prints).sort(), ['ar|RE-2026-0001', 'ar|RE-2026-0002', 'er|ER-2026-0001', 'er|ER-2026-0002'])
  const handover = { id: 'h1', from: p.from, to: p.to, parts: ['ar', 'er'], prints, at: '2026-11-10T08:00:00Z' }
  assert.equal(stbChanges(handover, prints).count, 0)
  // danach: eine Eingangsrechnung nachgetragen, eine Ausgangsrechnung … (festgeschriebene ändern sich nicht, aber ein Skonto im Zeitraum)
  E.invoices.push({ id: 'e3', no: 'ER-2026-0003', number: 'L-90', date: '2026-10-30', supplier: { name: 'Spät' }, groups: [{ rate: 20, net: 10, vat: 2 }], payments: [] })
  E.invoices[1].cancelled = true
  F.documents[0].payments.push({ id: 'sk', kind: 'skonto', date: '2026-10-10', amount: 2.4 })
  const now = stbPrints(stbRows({ fak: F, einkauf: E }, p))
  const ch = stbChanges(handover, now)
  assert.deepEqual(ch.added, ['er|ER-2026-0003'])
  assert.deepEqual(ch.changed, ['ar|RE-2026-0001'])
  assert.deepEqual(ch.removed, ['er|ER-2026-0002'])
  assert.deepEqual(ch.lines, ['Eingangsrechnung ER-2026-0003: neu', 'Ausgangsrechnung RE-2026-0001: geändert', 'Eingangsrechnung ER-2026-0002: entfallen'])
  // nur übergebene Teile zählen
  assert.equal(stbChanges({ ...handover, parts: ['ar'] }, now).count, 1)
  // nach der Nachreichung: kein Unterschied mehr
  const merged = stbMergePrints(handover.prints, now, ch)
  assert.equal(stbChanges({ ...handover, prints: merged }, now).count, 0)
})

test('Prüfliste: Entwürfe, fehlender Beleg, Vorsteuer, Kassenbuch nicht abgeschlossen, Bank offen', () => {
  const p = stbPeriod('2026-10')
  const kasse = { entries: [{ id: 'k1', no: 1, date: '2026-10-02', kind: 'einnahme', amount: 10, vat: 0 }], closings: [{ month: '2026-09' }], settings: {} }
  const checks = stbChecks({ fak: fak(), einkauf: einkauf(), kasse, bank: { tx: [{ date: '2026-10-07', amount: 99, status: 'offen', name: 'Unbekannt' }, { date: '2026-10-07', amount: 5, status: 'zugeordnet' }] } }, p)
  const ids = checks.map((c) => c.id)
  assert.ok(ids.includes('ar-entwurf'), ids.join())
  assert.ok(ids.includes('ar-pdf'))
  assert.ok(ids.includes('er-beleg'))
  assert.ok(ids.includes('ka-abschluss'))
  assert.ok(ids.includes('bank-offen'))
  assert.match(checks.find((c) => c.id === 'er-beleg').text, /^1 Eingangsrechnung ohne Beleg/)
  assert.match(checks.find((c) => c.id === 'ka-abschluss').text, /Oktober 2026/)
  assert.match(checks.find((c) => c.id === 'bank-offen').text, /^1 Bankumsatz/)
  // abgeschlossen: kein Hinweis
  assert.ok(!stbChecks({ kasse: { ...kasse, closings: [{ month: '2026-10' }] } }, p).some((c) => c.id === 'ka-abschluss'))
})

test('Zahlungen im Zeitraum und offene Posten zum Stichtag (Zahlungen danach zählen nicht)', () => {
  const p = stbPeriod('2026-10')
  const pay = stbPayments({ fak: fak(), einkauf: einkauf() }, p)
  assert.deepEqual(pay.map((x) => [x.date, x.dir, x.number, x.amount]), [['2026-10-15', 'Ausgang', 'ER-2026-0001', 120], ['2026-10-25', 'Eingang', 'RE-2026-0002', 120]])
  const csv = stbCsv(pay, PAYMENT_COLS)
  assert.match(csv, /^Datum;Richtung;Art;Belegnummer;Kunde bzw\. Lieferant;Betrag;Notiz\r\n15\.10\.2026;Ausgang;Zahlung;ER-2026-0001;Lieferant;120,00;\r\n/)
  const open = stbOpenItems({ fak: fak(), einkauf: einkauf() }, p)
  const byNo = Object.fromEntries(open.map((x) => [x.number, x.open]))
  assert.equal(byNo['RE-2026-0001'], 120)
  assert.equal(byNo['RE-2026-0002'], 120) // 240 brutto, 120 bis 31.10. bezahlt
  assert.equal(byNo['RE-2026-0003'], undefined) // erst im November
  assert.equal(byNo['ER-2026-0002'], 60)
  assert.equal(byNo['ER-2026-0001'], undefined)
})

test('Inhalt, Übergabe vermerken, Erinnerung ab dem 10. des Folgemonats', () => {
  const p = stbPeriod('2026-10')
  const text = stbInhalt({ period: p, company: 'Cleanos', by: 'Petra', at: '2026-11-10T08:00:00Z', sums: { ar: { count: 2, net: 300, vat: 60, gross: 360 }, er: { count: 0 }, ka: { count: 0 } }, checks: [{ text: '1 Eingangsrechnung ohne Beleg' }], files: [{ path: 'Ausgangsrechnungen.csv', sha: 'abc' }] })
  assert.match(text, /Zeitraum: Oktober 2026 \(01\.10\.2026–31\.10\.2026\)/)
  assert.match(text, /Ausgangsrechnungen: 300,00 € \/ 60,00 € \/ 360,00 €, 2 Zeilen/)
  assert.doesNotMatch(text, /Eingangsrechnungen:/)
  assert.match(stbInhalt({ period: p, sums: { ar: { count: 1, net: 12849.5, vat: -2569.9, gross: 15419.4 } }, files: [] }), /12\.849,50 € \/ -2\.569,90 € \/ 15\.419,40 €/)
  assert.match(text, /- 1 Eingangsrechnung ohne Beleg/)
  assert.match(text, /abc {2}Ausgangsrechnungen\.csv/)
  const settings = {}
  // nie übergeben: keine Erinnerung
  assert.equal(stbReminder(settings, '2026-11-12'), null)
  stbRecord(settings, { id: 'h1', from: '2026-09-01', to: '2026-09-30', at: '2026-10-08T08:00:00Z' })
  assert.equal(stbReminder(settings, '2026-11-09'), null) // vor dem 10.
  assert.equal(stbReminder(settings, '2026-11-10').id, '2026-10')
  stbRecord(settings, { id: 'h2', from: '2026-10-01', to: '2026-10-31', at: '2026-11-10T08:00:00Z' })
  assert.equal(stbReminder(settings, '2026-11-12'), null)
  assert.equal(stbLastHandover(settings, p).id, 'h2')
  // abgeschaltet
  assert.equal(stbReminder({ stb: { ...settings.stb, remindDay: 0 } }, '2026-12-15'), null)
  // Quartal: erst nach dem Quartal
  const q = { stb: { handovers: [{ id: '2026-Q2', from: '2026-04-01', to: '2026-06-30' }] } }
  assert.equal(stbReminder(q, '2026-08-20'), null)
  assert.equal(stbReminder(q, '2026-10-12').id, '2026-Q3')
})
