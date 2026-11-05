// Einkauf (core/purchase.js): Pflichtangaben für den Vorsteuerabzug, Doppel-Erkennung, Zahlstatus mit Skonto,
// offene Verbindlichkeiten, Bank-Ausgänge, E-Rechnung, Verknüpfung mit Material & Lager, Export, Übernahme.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEInvoice } from '../src/core/fak-import.js'
import { ciiXml } from '../src/export/e-invoice.js'
import {
  applyDebit,
  bookTransferRun,
  draftFromEInvoice,
  duePayables,
  dueThisWeek,
  emptyPurchase,
  findDuplicates,
  invoiceProblems,
  invoiceTotals,
  markTransferRun,
  materialFields,
  materialLinks,
  mergePurchaseImport,
  nextInvoiceNo,
  normalizeNumber,
  openDebits,
  openOf,
  payables,
  payablesSummary,
  purchaseCsv,
  purchaseExportRows,
  purchasePaymentEntries,
  purchaseState,
  removePayment,
  spendingByMonth,
  suggestDebit,
  supplierFromMaterial,
  supplierProblems,
  transferPayments,
  undoDebit,
  vatDeductible,
} from '../src/core/purchase.js'

let n = 0
const newId = () => `x${++n}`
const SUP = { id: 's1', supplierNo: '70001', name: 'Hygiene-Großhandel Beispiel GmbH', street: 'Industriestraße 4', zip: '5020', city: 'Salzburg', uid: 'ATU12345675', iban: 'AT611904300234573201', bic: 'BKAUATWW', customerNo: 'K-1020', paymentDays: 30, skontoPercent: 2, skontoDays: 10 }
const SUP2 = { id: 's2', supplierNo: '70002', name: 'Papier & Co Beispiel', street: 'Gasse 1', zip: '5020', city: 'Salzburg', uid: 'ATU87654321', iban: 'AT483200000012345864' }
const inv = (extra = {}) => ({ id: `i${++n}`, no: 'ER-2026-0001', supplierId: 's1', supplier: { name: SUP.name, address: 'Industriestraße 4\n5020 Salzburg', uid: SUP.uid }, number: 'RE-2026/0815', date: '2026-10-20', serviceFrom: '2026-10-18', text: '20 Kanister Allzweckreiniger', groups: [{ rate: 20, net: 1000, vat: 200 }], dueDate: '2026-11-19', checks: { recipient: true }, ...extra })

test('Eingangsrechnung: Summen je Steuersatz, Reverse Charge ohne Umsatzsteuer', () => {
  assert.deepEqual(invoiceTotals(inv({ groups: [{ rate: 20, net: '100,00', vat: '20,00' }, { rate: 10, net: 50, vat: 5 }] })), { groups: [{ rate: 20, net: 100, vat: 20 }, { rate: 10, net: 50, vat: 5 }], net: 150, vat: 25, gross: 175, rcVat: 0 })
  const rc = invoiceTotals(inv({ reverseCharge: true, groups: [{ rate: 20, net: 800, vat: 0 }] }))
  assert.deepEqual([rc.gross, rc.vat, rc.rcVat], [800, 0, 160])
})

test('Pflichtangaben (§ 11 UStG): vollständige Rechnung ohne Bedenken, Lücken gefährden den Vorsteuerabzug', () => {
  const ok = invoiceProblems(inv(), { suppliers: [SUP] })
  assert.deepEqual(ok.filter((p) => p.level !== 'info'), [])
  assert.ok(vatDeductible(ok))
  const bad = invoiceProblems(inv({ number: '', text: '', serviceFrom: '', supplier: { name: SUP.name, address: SUP.street, uid: '' }, checks: {} }), { suppliers: [{ ...SUP, uid: '' }] })
  const codes = bad.map((p) => p.code)
  for (const c of ['vst-nummer', 'vst-uid', 'vst-leistung', 'vst-leistungsdatum', 'vst-empfaenger']) assert.ok(codes.includes(c), c)
  assert.ok(!vatDeductible(bad))
  // Steuerbetrag passt nicht zum Satz
  assert.ok(invoiceProblems(inv({ groups: [{ rate: 20, net: 1000, vat: 180 }] }), { suppliers: [SUP] }).some((p) => p.code === 'vst-betrag'))
  // Fehler verhindern das Speichern
  const errs = invoiceProblems({ groups: [] }, {}).filter((p) => p.level === 'error').map((p) => p.code)
  assert.deepEqual(errs, ['lieferant', 'datum', 'betrag'])
})

test('Kleinbetragsrechnung bis 400 € brutto: ohne UID, Nummer und Empfänger', () => {
  const small = inv({ number: '', groups: [{ rate: 20, net: 300, vat: 60 }], supplier: { name: 'Baumarkt Beispiel', address: 'Weg 1\n5020 Salzburg', uid: '' }, checks: {} })
  const p = invoiceProblems(small, { suppliers: [{ ...SUP, uid: '' }] })
  assert.ok(vatDeductible(p), JSON.stringify(p))
  assert.ok(p.some((x) => x.code === 'klein'))
  // 400,01 € brutto: volle Angaben nötig
  const big = invoiceProblems({ ...small, groups: [{ rate: 20, net: 333.34, vat: 66.67 }] }, { suppliers: [{ ...SUP, uid: '' }] })
  assert.ok(!vatDeductible(big))
  // über 10.000 €: unsere UID; Reverse Charge: Hinweis und beide UIDs
  assert.ok(invoiceProblems(inv({ groups: [{ rate: 20, net: 9000, vat: 1800 }] }), { suppliers: [SUP] }).some((x) => x.code === 'vst-unsere-uid'))
  const rc = invoiceProblems(inv({ reverseCharge: true, groups: [{ rate: 20, net: 900, vat: 180 }] }), { suppliers: [SUP] }).map((x) => x.code)
  assert.ok(rc.includes('vst-rc-hinweis') && rc.includes('vst-unsere-uid') && rc.includes('vst-rc-ust'))
})

test('Doppel-Erkennung: gleicher Lieferant und gleiche Nummer (Schreibweise egal), stornierte zählen nicht', () => {
  assert.equal(normalizeNumber('RE-2026/0815'), normalizeNumber('re 2026 815'))
  const a = inv({ id: 'a' })
  const b = inv({ id: 'b', number: 're 2026-815' })
  const d = findDuplicates([a], b, [SUP])
  assert.deepEqual(d.same.map((x) => x.id), ['a'])
  assert.ok(invoiceProblems(b, { suppliers: [SUP], invoices: [a] }).some((p) => p.level === 'error' && p.code === 'doppelt'))
  // anderer Lieferant: kein Doppel
  assert.equal(findDuplicates([a], { ...b, supplierId: 's2' }, [SUP, SUP2]).same.length, 0)
  // stornierte Erfassung: darf neu erfasst werden
  assert.equal(findDuplicates([{ ...a, cancelled: { at: 'x' } }], b, [SUP]).same.length, 0)
  // ohne Nummer, aber gleiches Datum und gleicher Betrag: Warnung
  const c = findDuplicates([a], { ...b, id: 'c', number: '' }, [SUP])
  assert.deepEqual([c.same.length, c.similar.length], [0, 1])
})

test('Zahlstatus mit Skonto: Zahlung in der Frist deckt brutto minus Skonto → bezahlt', () => {
  const x = inv({ skonto: { percent: 2, days: 10 } })
  assert.equal(purchaseState(x, '2026-10-25'), 'offen')
  // in der Frist (bis 30.10.): 1.176 € statt 1.200 €
  const entries = purchasePaymentEntries(x, { date: '2026-10-28', amount: 1176, method: 'bank' }, { newId })
  assert.equal(entries.length, 2)
  assert.deepEqual([entries[1].kind, entries[1].amount, entries[1].ref, entries[1].method], ['skonto', 24, entries[0].id, 'bank'])
  x.payments = entries
  assert.deepEqual([openOf(x), purchaseState(x, '2026-12-01')], [0, 'bezahlt'])
  // nach der Frist: kein Skonto, Teilzahlung
  const y = inv({ skonto: { percent: 2, days: 10 } })
  const late = purchasePaymentEntries(y, { date: '2026-11-02', amount: 1176 }, { newId })
  assert.equal(late.length, 1)
  y.payments = late
  assert.deepEqual([openOf(y), purchaseState(y, '2026-11-05')], [24, 'teilbezahlt'])
  assert.equal(purchaseState(y, '2026-11-20'), 'ueberfaellig')
  // Zahlung mit Skonto entfernen: beides weg
  assert.ok(removePayment(x, (p) => p.id === entries[0].id, { by: 'T' }))
  assert.equal(openOf(x), 1200)
  assert.equal(purchaseState({ ...x, cancelled: { at: 'x' } }, '2026-10-25'), 'storniert')
})

test('Offene Verbindlichkeiten nach Fälligkeit (Skontofrist zuerst), fällig diese Woche, Zu erledigen', () => {
  const a = inv({ id: 'a', number: 'A', dueDate: '2026-11-30' })
  const b = inv({ id: 'b', number: 'B', date: '2026-11-01', dueDate: '2026-12-01', skonto: { percent: 3, days: 8 } })
  const c = inv({ id: 'c', number: 'C', dueDate: '2026-11-02' })
  const d = inv({ id: 'd', number: 'D', dueDate: '2026-11-04', payments: [{ id: 'p', date: '2026-11-01', amount: 1200 }] })
  const list = payables([a, b, c, d], '2026-11-04')
  assert.deepEqual(list.map((x) => x.inv.id), ['c', 'b', 'a'])
  assert.deepEqual([list[0].overdueDays, list[1].deadline, list[1].skonto.payable], [2, '2026-11-09', 1164])
  // Mittwoch 04.11.: Woche bis Sonntag 08.11. – C (überfällig); B erst am 09.11.
  assert.deepEqual(dueThisWeek([a, b, c, d], '2026-11-04').map((x) => x.inv.id), ['c'])
  assert.deepEqual(duePayables([a, b, c, d], '2026-11-06', 3).map((x) => x.inv.id), ['c', 'b'])
  const sum = payablesSummary([a, b, c, d], '2026-11-04')
  assert.deepEqual([sum.openCount, sum.overdueCount, sum.open, sum.skontoChance], [3, 1, 3600, 36])
})

test('Bank: Abbuchungen den Eingangsrechnungen zuordnen (Nummer, IBAN, Skonto), lösen', () => {
  const a = inv({ id: 'a', number: '4711', skonto: { percent: 2, days: 10 } })
  const b = inv({ id: 'b', supplierId: 's2', supplier: { name: SUP2.name }, number: 'P-99', groups: [{ rate: 20, net: 50, vat: 10 }] })
  const tx = [
    { id: 't1', date: '2026-10-28', amount: -1176, name: 'Hygiene Grosshandel', text: 'Rechnung 4711 abzgl. Skonto', iban: '' },
    { id: 't2', date: '2026-10-29', amount: -60, name: 'Papier und Co', iban: 'AT48 3200 0000 1234 5864', text: 'Rg' },
    { id: 't3', date: '2026-10-29', amount: 500, name: 'Kunde', text: 'Eingang' },
    { id: 't4', date: '2026-10-30', amount: -3200, name: 'ÖGK', text: 'Beiträge' },
  ]
  const doc = { invoices: [a, b], suppliers: [SUP, SUP2], bankIgnored: { t4: { by: 'T' } } }
  assert.deepEqual(openDebits(tx, doc).map((t) => t.id), ['t2', 't1'], 'nur Ausgänge, ignorierte nicht')
  const s1 = suggestDebit(tx[0], doc)
  assert.equal(s1.level, 'sicher')
  assert.deepEqual(s1.allocations, [{ invoiceId: 'a', amount: 1176 }])
  const s2 = suggestDebit(tx[1], doc)
  assert.deepEqual([s2.level, s2.allocations[0].invoiceId], ['sicher', 'b'])
  applyDebit(tx[0], s1.allocations, doc.invoices, { by: 'T', newId })
  assert.deepEqual([openOf(a), a.payments.map((p) => p.kind || 'zahlung').join(), a.payments[0].bank], [0, 'zahlung,skonto', 't1'])
  assert.deepEqual(openDebits(tx, doc).map((t) => t.id), ['t2'])
  assert.throws(() => applyDebit(tx[1], [{ invoiceId: 'b', amount: 50 }], doc.invoices, {}), /ergeben nicht/)
  assert.equal(undoDebit('t1', doc.invoices, { by: 'T' }), 1)
  assert.equal(openOf(a), 1200)
})

test('E-Rechnung (ZUGFeRD/CII) eines Lieferanten: Felder vorbelegt, Lieferant erkannt', () => {
  const xml = ciiXml(
    { kind: 'rechnung', number: 'RE-2026-0042', date: '2026-10-15', dueDate: '2026-11-14', serviceFrom: '2026-10-01', serviceTo: '2026-10-14', recipient: { name: 'Gebäudereinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, lines: [{ id: 'l1', text: 'Allzweckreiniger 10 l', qty: 4, unit: 'Stk', price: 25, vat: 20 }, { id: 'l2', text: 'Fachbuch', qty: 1, unit: 'Stk', price: 30, vat: 10 }] },
    { sender: { name: SUP.name, address: 'Industriestraße 4\n5020 Salzburg', uid: SUP.uid }, bank: { iban: SUP.iban } },
  )
  const e = parseEInvoice(xml)
  const r = draftFromEInvoice(e, { suppliers: [SUP, SUP2] })
  assert.equal(r.supplier?.id, 's1')
  assert.deepEqual([r.draft.number, r.draft.date, r.draft.dueDate, r.draft.serviceFrom, r.draft.serviceTo], ['RE-2026-0042', '2026-10-15', '2026-11-14', '2026-10-01', '2026-10-14'])
  assert.deepEqual(invoiceTotals(r.draft).groups, [{ rate: 20, net: 100, vat: 20 }, { rate: 10, net: 30, vat: 3 }])
  assert.match(r.draft.text, /Allzweckreiniger/)
  assert.ok(r.draft.checks.recipient && r.draft.checks.ourUid)
  // unbekannter Lieferant: Vorschlag zum Anlegen
  const u = draftFromEInvoice(e, { suppliers: [SUP2] })
  assert.equal(u.supplier, null)
  assert.deepEqual([u.newSupplier.name, u.newSupplier.uid, u.newSupplier.city], [SUP.name, SUP.uid, 'Salzburg'])
})

test('Material & Lager: Lieferanten verknüpfen statt doppelt führen', () => {
  const material = [
    { id: 's-demo1', name: 'Hygiene-Großhandel Beispiel', email: 'bestellung@hygiene.example', phone: '0662 1', contact: 'Frau Huber', customerNo: 'K-1020' },
    { id: 's-demo2', name: 'Papier & Co Beispiel', email: '', customerNo: '' },
    { id: 's-demo3', name: 'Neu Beispiel', email: 'neu@x.example' },
  ]
  const links = materialLinks([{ ...SUP }, { ...SUP2, materialId: 's-demo2' }], material)
  assert.deepEqual(links.map((l) => [l.material.id, l.match?.id || null]), [['s-demo1', 's1'], ['s-demo3', null]])
  const neu = supplierFromMaterial(material[2], { id: 'n1', supplierNo: '70003', now: 'T' })
  assert.deepEqual([neu.materialId, neu.name, neu.email, neu.supplierNo], ['s-demo3', 'Neu Beispiel', 'neu@x.example', '70003'])
  assert.deepEqual(materialFields({ ...SUP, email: 'a@b.example', contacts: [{ name: 'Frau Huber' }] }), { name: SUP.name, email: 'a@b.example', phone: '', customerNo: 'K-1020', contact: 'Frau Huber' })
  assert.deepEqual(supplierProblems({ name: 'X', iban: 'AT00 1234' }).map((p) => p.level), ['error'])
})

test('Export für die Steuerberatung: ER je Steuersatz, SK mit Vorsteuerkorrektur, Reverse Charge', () => {
  const a = inv({ id: 'a', no: 'ER-2026-0001', category: 'material', groups: [{ rate: 20, net: 100, vat: 20 }, { rate: 10, net: 50, vat: 5 }], skonto: { percent: 2, days: 10 } })
  a.payments = purchasePaymentEntries(a, { date: '2026-10-25', amount: 171.5 }, { newId })
  const rc = inv({ id: 'b', no: 'ER-2026-0002', supplierId: 's2', number: 'SUB-1', reverseCharge: true, category: 'fremd', groups: [{ rate: 20, net: 1000, vat: 0 }] })
  const doc = { suppliers: [SUP, SUP2], invoices: [a, rc, inv({ id: 'c', cancelled: { at: 'x' } })], settings: {} }
  const rows = purchaseExportRows(doc, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(rows.map((r) => [r.kindLabel, r.rate, r.net, r.vat, r.gross, r.account, r.code]), [
    ['ER', 20, 100, 20, 120, '5300', ''],
    ['ER', 10, 50, 5, 55, '5300', ''],
    ['ER', 20, 1000, 200, 1000, '5700', 'RC19-1a'],
    ['SK', 20, -2, -0.4, -2.4, '5300', ''],
    ['SK', 10, -1, -0.1, -1.1, '5300', ''],
  ])
  const csv = purchaseCsv(rows).split('\r\n')
  assert.match(csv[0], /^Belegnummer;Belegdatum;Belegart;Konto \(Kreditor\);Gegenkonto \(Aufwand\);Lieferant;UID Lieferant;/)
  assert.match(csv[1], /^ER-2026-0001;20\.10\.2026;ER;70001;5300;Hygiene-Großhandel Beispiel GmbH;ATU12345675;RE-2026\/0815;20,00;;100,00;20,00;120,00;/)
  const sp = spendingByMonth(doc.invoices, 2026)
  assert.deepEqual([sp.months[9].net, sp.months[9].count, sp.categories[0].name], [1150, 2, 'Fremdleistungen (Subunternehmer)'])
})

test('Überweisungen: Betrag mit Skonto, gesperrt ohne Freigabe, Lauf als bezahlt buchen', () => {
  const a = inv({ id: 'a', number: '4711', skonto: { percent: 2, days: 10 } })
  const b = inv({ id: 'b', supplierId: 's2', number: 'P-1', groups: [{ rate: 20, net: 50, vat: 10 }] })
  const doc = { suppliers: [SUP, SUP2], invoices: [a, b], settings: { approval: true } }
  let r = transferPayments(['a', 'b'], doc, '2026-10-28')
  assert.equal(r.payments.length, 0)
  assert.equal(r.problems.length, 2)
  a.approval = { by: 'T', at: 'x' }
  b.approval = { by: 'T', at: 'x' }
  r = transferPayments(['a', 'b'], doc, '2026-10-28')
  assert.deepEqual(r.payments.map((p) => [p.amount, p.skonto, p.iban]), [[1176, 24, SUP.iban], [60, 0, SUP2.iban]])
  assert.match(r.payments[0].text, /Rechnung 4711 Kd-Nr\. K-1020 abzgl\. 2 % Skonto/)
  markTransferRun(doc, { id: 'run1', date: '2026-10-28', at: 'T', by: 'T' }, r.payments)
  assert.equal(a.sepa.amount, 1176)
  assert.equal(bookTransferRun(doc, 'run1', { by: 'T', newId }), 2)
  assert.deepEqual([openOf(a), openOf(b)], [0, 0])
  assert.equal(bookTransferRun(doc, 'run1', { by: 'T', newId }), 0, 'nicht doppelt')
})

test('Übernahme aus orgaMAX: Lieferanten, Rechnungen und Kasse idempotent, nichts doppelt', () => {
  const data = {}
  const src = {
    suppliers: [
      { supplierNo: '70010', name: 'Reinigungsbedarf Beispiel KG', street: 'Weg 2', zip: '5020', city: 'Salzburg', uid: 'ATU11112222', iban: 'AT61 1904 3002 3457 3201', source: { system: 'orgaMAX', id: '311' } },
      { supplierNo: '70011', name: 'Werkstatt Beispiel', source: { system: 'orgaMAX', id: '312' } },
    ],
    invoices: [
      { supplierNo: '70010', number: 'R-1001', date: '2026-09-10', net: 500, rate: 20, dueDate: '2026-10-10', payments: [{ date: '2026-10-01', amount: 600 }], source: { system: 'orgaMAX', id: 'ER-9' } },
      { supplierRef: '312', number: 'W-77', date: '2026-10-02', gross: 240, rate: 20, source: { system: 'orgaMAX', id: 'ER-10' } },
      { supplierName: 'Unbekannt Beispiel', number: 'U-1', date: '2026-10-03', gross: 12, rate: 20, source: { system: 'orgaMAX', id: 'ER-11' } },
    ],
    cash: [
      { no: 1, date: '2026-01-02', amount: 100, text: 'Anfangsbestand', type: 'anfang', source: { system: 'orgaMAX', id: 'K1' } },
      { no: 2, date: '2026-01-03', amount: -20, text: 'Porto', source: { system: 'orgaMAX', id: 'K2' } },
    ],
  }
  const r1 = mergePurchaseImport(data, src, { newId, now: '2026-11-05T10:00:00.000Z' })
  assert.deepEqual(r1.added, { suppliers: 3, invoices: 3, cash: 2 })
  const e = data.einkauf
  const r1001 = e.invoices.find((x) => x.number === 'R-1001')
  assert.deepEqual([r1001.no, openOf(r1001), purchaseState(r1001, '2026-11-05'), r1001.imported.ref], ['ER-2026-0001', 0, 'bezahlt', 'ER-9'])
  assert.deepEqual(invoiceTotals(e.invoices.find((x) => x.number === 'W-77')).groups, [{ rate: 20, net: 200, vat: 40 }])
  assert.equal(e.suppliers.find((s) => s.supplierNo === '70010').iban, 'AT611904300234573201')
  assert.equal(data.kasse.entries.length, 2)
  // zweite Übernahme: nichts doppelt, leere Felder ergänzt
  const again = structuredClone(src)
  again.suppliers[1].email = 'office@werkstatt.example'
  const r2 = mergePurchaseImport(data, again, { newId })
  assert.deepEqual(r2.added, { suppliers: 0, invoices: 0, cash: 0 })
  assert.equal(r2.updated.suppliers, 1)
  assert.equal(e.suppliers.find((s) => s.supplierNo === '70011').email, 'office@werkstatt.example')
  assert.equal(e.invoices.length, 3)
  // gleiche Nummer mit anderem Namen: gemeldet, nicht zusammengelegt, sondern mit neuer Nummer; zweites Mal wiedergefunden
  const r3 = mergePurchaseImport(data, { suppliers: [{ supplierNo: '70010', name: 'Ganz Anders AG' }], invoices: [{ supplierNo: '70010', number: 'GA-1', date: '2026-09-12', net: 80 }] }, { newId })
  assert.match(r3.warnings[0], /als eigener Lieferant Nr\. \d+ angelegt/)
  const ganz = e.suppliers.find((s) => s.name === 'Ganz Anders AG')
  assert.equal(e.invoices.find((i) => i.number === 'GA-1').supplierId, ganz.id, 'Rechnung beim neuen Lieferanten, nicht beim alten 70010')
  const r3b = mergePurchaseImport(data, { suppliers: [{ supplierNo: '70010', name: 'Ganz Anders AG' }] }, { newId })
  assert.equal(r3b.added.suppliers, 0, 'zweite Übernahme legt ihn nicht noch einmal an')
  // gleiche Rechnung ohne Quelle (z. B. von Hand erfasst): erkannt
  const r4 = mergePurchaseImport(data, { invoices: [{ supplierNo: '70010', number: 'r 1001', date: '2026-09-10', net: 500 }] }, { newId })
  assert.equal(r4.skipped[0].reason, 'gleicher Lieferant und Nummer schon erfasst')
  assert.equal(nextInvoiceNo(e.invoices, '2026'), 'ER-2026-0005', 'GA-1 hat die 0004')
  assert.deepEqual(emptyPurchase().invoices, [])
})

test('Übernahme: Rechnung mit interner Lieferanten-ID findet einen schon vorhandenen Lieferanten', () => {
  const data = { einkauf: emptyPurchase() }
  data.einkauf.suppliers.push({ id: 'm1', supplierNo: '70020', name: 'Papier Beispiel KG', country: 'AT', source: { system: 'orgaMAX' } }) // z. B. früher nur mit Namen übernommen
  let k = 0
  const r = mergePurchaseImport(data, {
    suppliers: [{ supplierNo: '70020', name: 'Papier Beispiel KG', iban: 'AT611904300234573201', source: { system: 'orgaMAX', id: '4711' } }],
    invoices: [{ supplierRef: '4711', number: 'PB-9', date: '2026-10-01', net: 50, rate: 20, source: { system: 'orgaMAX', id: 'E-1' } }],
  }, { newId: () => `n${++k}` })
  assert.equal(r.added.suppliers, 0, 'kein zweiter Lieferant')
  assert.equal(data.einkauf.suppliers.length, 1)
  assert.equal(data.einkauf.invoices[0].supplierId, 'm1')
  assert.equal(data.einkauf.suppliers[0].iban, 'AT611904300234573201', 'leere Felder ergänzt')
})
