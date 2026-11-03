import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checksumOf,
  convertDraft,
  correctionDraft,
  epcPayload,
  exportCsv,
  exportRows,
  finalize,
  ibanValid,
  indexAdjustment,
  intact,
  invoiceMailText,
  lateInterest,
  latestIndex,
  linesFromProof,
  nextNumber,
  nextReminder,
  openAmount,
  openItems,
  periodLabel,
  periodOf,
  problems,
  reminderFor,
  resolveDuplicates,
  revenueByMonth,
  round2,
  runRecurring,
  stateOf,
  stornoDraft,
  totals,
} from '../src/core/invoicing.js'
import { invoiceDocument, reminderDocument } from '../src/export/invoice-pdf.js'

const IBAN = 'AT611904300234573201' // Beispiel-IBAN mit gültiger Prüfziffer
const settings = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: IBAN, bic: 'BKAUATWW', name: 'Bank Beispiel' }, paymentDays: 14, baseRate: 1.53 }
const recipient = { name: 'Hausverwaltung Muster', address: 'Platz 2\n5020 Salzburg', uid: 'ATU87654321' }
const draft = (extra = {}) => ({ id: 'd1', kind: 'rechnung', status: 'entwurf', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', recipient, lines: [{ id: 'l1', text: 'Unterhaltsreinigung Oktober', qty: 1, unit: 'Monat', price: 1234.56, vat: 20 }], ...extra })

test('Summen: Rundung je Steuersatz, Positions- und Belegrabatt, negative Beträge', () => {
  assert.equal(round2(1.005), 1.01)
  assert.equal(round2(-1.005), -1.01)
  assert.equal(round2(2.675), 2.68)
  const t = totals(draft({ discount: 5, lines: [{ text: 'A', qty: 3, price: 19.99, vat: 20, discount: 10 }, { text: 'B', qty: '1,5', price: '40,00', vat: 10 }, { text: '', price: 0 }] }))
  // A: 3 × 19,99 × 0,9 = 53,973 → 53,97; B: 60,00
  assert.deepEqual(t.lines.map((l) => l.net), [53.97, 60])
  assert.equal(t.subtotal, 113.97)
  // 5 % je Satz: 2,70 und 3,00
  assert.deepEqual(t.groups.map((g) => [g.rate, g.net, g.vat]), [[20, 51.27, 10.25], [10, 57, 5.7]])
  assert.equal(t.net, 108.27)
  assert.equal(t.vat, 15.95)
  assert.equal(t.gross, 124.22)
  const neg = totals(draft({ lines: [{ text: 'Storno', qty: -1, price: 1234.56, vat: 20 }] }))
  assert.equal(neg.gross, -1481.47)
})

test('Reverse Charge und Kleinunternehmer: keine Steuer, Hinweis und UIDs', () => {
  const rc = totals(draft({ reverseCharge: true }))
  assert.equal(rc.vat, 0)
  assert.equal(rc.gross, 1234.56)
  assert.deepEqual(rc.groups.map((g) => g.rate), [0])
  const ku = totals(draft(), { smallBusiness: true })
  assert.equal(ku.vat, 0)
  // RC ohne UID des Empfängers: Fehler
  const p = problems(draft({ reverseCharge: true, recipient: { ...recipient, uid: '' } }), settings)
  assert.ok(p.some((x) => x.level === 'error' && /UID-Nummer des Empfängers/.test(x.text)))
  const doc = invoiceDocument({ doc: finalize(draft({ reverseCharge: true }), [], settings, { now: '2026-11-03T10:00:00Z' }), settings, brand: {} })
  const text = JSON.stringify(doc.content)
  assert.match(text, /§ 19 Abs\. 1a UStG/)
  assert.match(text, /ATU87654321/)
  assert.match(text, /ATU12345678/)
})

test('Pflichtangaben: Leistungszeitraum, UID über 10.000 €, Kleinbetragsrechnung', () => {
  const missing = problems(draft({ serviceFrom: '' }), settings)
  assert.ok(missing.some((x) => x.level === 'error' && /Zeitraum der Leistung/.test(x.text)))
  const big = problems(draft({ recipient: { ...recipient, uid: '' }, lines: [{ text: 'Grundreinigung', qty: 1, price: 9000, vat: 20 }] }), settings)
  assert.ok(big.some((x) => x.level === 'error' && /10\.000/.test(x.text)), 'über 10.000 € brutto ohne UID')
  const consumer = problems(draft({ recipient: { ...recipient, uid: '', consumer: true }, lines: [{ text: 'Grundreinigung', qty: 1, price: 9000, vat: 20 }] }), settings)
  assert.ok(!consumer.some((x) => /10\.000/.test(x.text)), 'Verbraucher: keine UID nötig')
  const small = problems(draft({ recipient: {}, lines: [{ text: 'Fensterreinigung', qty: 1, price: 300, vat: 20 }] }), settings)
  assert.ok(!small.some((x) => x.level === 'error'), 'bis 400 € brutto: Empfänger nicht zwingend')
  assert.ok(small.some((x) => x.level === 'info' && /Kleinbetragsrechnung/.test(x.text)))
  const noUid = problems(draft(), { ...settings, sender: { ...settings.sender, uid: '' } })
  assert.ok(noUid.some((x) => x.level === 'error' && /UID-Nummer der eigenen Firma/.test(x.text)))
  assert.throws(() => finalize(draft({ lines: [] }), [], settings), /Keine Position/)
})

test('Nummern: fortlaufend je Belegart und Jahr, Startnummer, Festschreiben friert ein', () => {
  const docs = []
  const a = finalize(draft({ id: 'a' }), docs, settings, { now: '2026-11-03T10:00:00Z', by: 'Büro' })
  assert.equal(a.number, 'RE-2026-0001')
  assert.equal(a.total.gross, 1481.47)
  assert.ok(intact(a))
  const b = finalize(draft({ id: 'b' }), [a], settings)
  assert.equal(b.number, 'RE-2026-0002')
  // neues Jahr beginnt bei 1, Startnummer beim Umstieg mitten im Jahr
  assert.equal(nextNumber([a, b], 'rechnung', '2027', settings).number, 'RE-2027-0001')
  assert.equal(nextNumber([], 'rechnung', '2026', { ...settings, start: { 'rechnung|2026': 153 } }).number, 'RE-2026-0153')
  assert.equal(nextNumber([a], 'rechnung', '2026', { ...settings, start: { 'rechnung|2026': 153 } }).number, 'RE-2026-0153')
  assert.equal(nextNumber([a], 'angebot', '2026', settings).number, 'AN-2026-0001')
  assert.throws(() => finalize(a, [a], settings), /schon festgeschrieben/)
  // nachträgliche Änderung fällt auf
  const changed = { ...a, lines: [{ ...a.lines[0], price: 1 }] }
  assert.equal(intact(changed), false)
  // Zahlungen und Versand dürfen dazukommen
  assert.ok(intact({ ...a, payments: [{ id: 'p', date: '2026-11-10', amount: 100 }], sent: [{ at: 'x', to: 'y' }] }))
  assert.equal(checksumOf(a), a.checksum)
})

test('Doppelte Nummern nach gleichzeitigem Festschreiben: spätere neu nummeriert, versendete gemeldet', () => {
  const x = { ...finalize(draft({ id: 'x' }), [], settings, { now: '2026-11-03T10:00:00Z' }) }
  const y = { ...finalize(draft({ id: 'y' }), [], settings, { now: '2026-11-03T10:00:05Z' }) }
  assert.equal(x.number, y.number)
  const r = resolveDuplicates([x, y], settings)
  assert.deepEqual(r.renumbered, [{ id: 'y', from: 'RE-2026-0001', to: 'RE-2026-0002' }])
  assert.equal(r.docs.find((d) => d.id === 'y').number, 'RE-2026-0002')
  assert.ok(intact(r.docs.find((d) => d.id === 'y')))
  // beide schon versendet: nicht umnummerieren, sondern melden
  const sent = resolveDuplicates([{ ...x, sent: [{ at: '1' }] }, { ...y, sent: [{ at: '2' }] }], settings)
  assert.equal(sent.renumbered.length, 0)
  assert.equal(sent.conflicts.length, 1)
  // die versendete behält die Nummer, auch wenn sie später festgeschrieben wurde
  const keep = resolveDuplicates([x, { ...y, sent: [{ at: '2' }] }], settings)
  assert.equal(keep.docs.find((d) => d.id === 'y').number, 'RE-2026-0001')
  assert.equal(keep.docs.find((d) => d.id === 'x').number, 'RE-2026-0002')
})

test('Storno und Korrektur: eigener Beleg mit Bezug, offener Betrag', () => {
  const inv = finalize(draft({ id: 'r1' }), [], settings)
  const st = finalize(stornoDraft(inv, { id: 's1', date: '2026-11-05', reason: 'doppelt verrechnet' }), [inv], settings)
  assert.equal(st.number, 'ST-2026-0001')
  assert.equal(st.total.gross, -1481.47)
  assert.equal(st.refNumber, 'RE-2026-0001')
  const docs = [inv, st]
  assert.equal(openAmount(inv, docs, settings), 0)
  assert.equal(stateOf(inv, docs, '2026-12-01', settings), 'storniert')
  // Korrektur 100 € netto + 20 % = −120 €
  const inv2 = finalize(draft({ id: 'r2' }), docs, settings)
  const ko = finalize(correctionDraft(inv2, { id: 'k1', date: '2026-11-06', text: 'Preisminderung Reklamation', amount: 100 }), [...docs, inv2], settings)
  const all = [...docs, inv2, ko]
  assert.equal(ko.total.gross, -120)
  assert.equal(openAmount(inv2, all, settings), 1361.47)
  inv2.payments = [{ id: 'p1', date: '2026-11-20', amount: 1000 }]
  assert.equal(openAmount(inv2, all, settings), 361.47)
  assert.equal(stateOf(inv2, all, '2026-11-25', settings), 'ueberfaellig')
  inv2.payments.push({ id: 'p2', date: '2026-11-26', amount: 361.47 })
  assert.equal(stateOf(inv2, all, '2026-11-30', settings), 'bezahlt')
  assert.throws(() => stornoDraft(draft(), { id: 'z', date: '2026-11-05' }), /festgeschriebene/)
  // Angebot → Rechnung übernimmt Positionen und Bezug
  const offer = finalize({ ...draft({ id: 'an1', kind: 'angebot', serviceFrom: '' }) }, [], settings)
  const conv = convertDraft(offer, 'rechnung', { id: 'r9', date: '2026-11-10' })
  assert.equal(conv.refNumber, 'AN-2026-0001')
  assert.equal(conv.lines.length, 1)
  assert.equal(conv.number, undefined)
})

test('Mahnwesen: Stufen, Verzugszinsen § 456 UGB, Pauschale § 458 UGB einmal, Verbraucher 4 %', () => {
  const inv = finalize(draft({ id: 'm1', date: '2026-09-01', serviceFrom: '2026-08-01', serviceTo: '2026-08-31', dueDate: '2026-09-15' }), [], settings)
  const i = lateInterest({ amount: 1000, from: '2026-09-15', to: '2026-10-15', baseRate: 1.53 })
  assert.equal(i.rate, 10.73)
  assert.equal(i.days, 30)
  assert.equal(i.amount, 8.82) // 1000 × 10,73 % × 30/365
  assert.equal(lateInterest({ amount: 1000, from: '2026-09-15', to: '2026-10-15', consumer: true }).amount, 3.29)
  assert.equal(nextReminder(inv, '2026-09-20', settings), null, 'erst 7 Tage nach Fälligkeit')
  assert.equal(nextReminder(inv, '2026-09-22', settings).step.name, 'Zahlungserinnerung')
  const r0 = reminderFor(inv, [inv], { today: '2026-09-22', settings })
  assert.equal(r0.fee, 0)
  assert.equal(r0.interest.amount, 0)
  inv.reminders = [{ level: 0, date: '2026-09-22', deadline: r0.deadline, fee: 0, interest: 0 }]
  assert.equal(nextReminder(inv, '2026-10-05', settings), null)
  const r1 = reminderFor(inv, [inv], { today: '2026-10-15', settings })
  assert.equal(r1.name, '1. Mahnung')
  assert.equal(r1.fee, 40)
  assert.equal(r1.interest.days, 30)
  assert.equal(r1.total, round2(1481.47 + r1.interest.amount + 40))
  inv.reminders.push({ level: 1, date: '2026-10-15', deadline: r1.deadline, fee: 40, interest: r1.interest.amount })
  const r2 = reminderFor(inv, [inv], { today: '2026-11-10', settings })
  assert.equal(r2.fee, 0, 'Pauschale nur einmal je Forderung')
  const consumer = finalize(draft({ id: 'm2', recipient: { ...recipient, consumer: true }, date: '2026-09-01', dueDate: '2026-09-15' }), [inv], settings)
  assert.equal(reminderFor(consumer, [consumer], { today: '2026-10-15', settings, level: 1 }).fee, 0)
  const items = openItems([inv, consumer], '2026-11-10', settings)
  assert.equal(items.length, 2)
  assert.equal(items[0].overdueDays, 56)
  const pdf = reminderDocument({ doc: inv, reminder: r1, settings, brand: {} })
  assert.match(JSON.stringify(pdf.content), /§ 456 UGB/)
})

test('Wertsicherung: Schwelle, ganze Veränderung, nur Erhöhung', () => {
  assert.deepEqual(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 123, threshold: 3 }), { change: 2.5, applies: false, factor: 123 / 120, price: 1000 })
  const up = indexAdjustment({ price: 1000, baseValue: 120, currentValue: 124.2, threshold: 3 })
  assert.equal(up.applies, true)
  assert.equal(up.change, 3.5)
  assert.equal(up.price, 1035)
  assert.equal(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 115, threshold: 3, onlyUp: true }).applies, false)
  assert.equal(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 115, threshold: 3 }).price, 958.33)
  assert.deepEqual(latestIndex({ '2026-08': 124, '2026-09': 124.5, '2026-12': 126 }, '2026-10'), { ym: '2026-09', value: 124.5 })
})

test('Daueraufträge: Monatslauf erzeugt Entwürfe, nicht doppelt, Quartal, Wertsicherung', () => {
  let n = 0
  const newId = () => `n${++n}`
  const customer = { id: 'c1', name: 'Hausverwaltung Muster', address: 'Platz 2', uid: 'ATU87654321', paymentDays: 10 }
  const doc = {
    settings,
    customers: [customer],
    documents: [],
    recurring: [
      { id: 'rec1', customerId: 'c1', objectId: 'o5', title: 'Unterhaltsreinigung Wohnanlage', interval: 'monat', startMonth: '2026-01', lines: [{ text: 'Unterhaltsreinigung lt. Vertrag', qty: 1, unit: 'Monat', price: 1000, vat: 20 }], index: { active: true, baseValue: 120, baseMonth: '2025-12', threshold: 3 } },
      { id: 'rec2', customerId: 'c1', title: 'Glasreinigung', interval: 'quartal', startMonth: '2026-01', lines: [{ text: 'Glasreinigung', qty: 1, unit: 'Quartal', price: 600, vat: 20 }] },
      { id: 'rec3', customerId: 'c1', title: 'alt', interval: 'monat', startMonth: '2026-01', active: false, lines: [{ text: 'x', qty: 1, price: 1 }] },
    ],
    indexValues: { '2026-09': 124.2 },
  }
  assert.deepEqual(periodOf(doc.recurring[1], '2026-10'), { from: '2026-10-01', to: '2026-12-31', ym: '2026-10' })
  assert.equal(periodOf(doc.recurring[1], '2026-11'), null)
  assert.equal(periodLabel({ from: '2026-10-01', to: '2026-12-31' }), 'Oktober – Dezember 2026')
  const customersById = new Map([['c1', customer]])
  const r = runRecurring(doc, '2026-10', { today: '2026-10-01', newId, by: 'Büro', customersById })
  assert.equal(r.created.length, 2)
  const monthly = r.created.find((d) => d.source.recurringId === 'rec1')
  assert.equal(monthly.serviceFrom, '2026-10-01')
  assert.equal(monthly.serviceTo, '2026-10-31')
  assert.equal(monthly.dueDate, '2026-10-11')
  assert.equal(monthly.lines[0].price, 1035, 'Wertsicherung +3,5 % übernommen')
  assert.match(monthly.outro, /Wertsicherung VPI 2020: 120 → 124,2 \(\+3,5 %\)/)
  assert.deepEqual(r.adjusted.map((a) => a.id), ['rec1'])
  assert.equal(r.recurring[0].index.baseValue, 124.2)
  assert.equal(r.recurring[0].lines[0].price, 1035)
  // zweiter Lauf im selben Monat: nichts doppelt
  const again = runRecurring({ ...doc, documents: r.documents, recurring: r.recurring }, '2026-10', { today: '2026-10-02', newId, customersById })
  assert.equal(again.created.length, 0)
  // nächster Monat: neue Basis, keine weitere Anpassung
  const nov = runRecurring({ ...doc, documents: r.documents, recurring: r.recurring }, '2026-11', { today: '2026-11-01', newId, customersById })
  assert.equal(nov.created.length, 1)
  assert.equal(nov.created[0].lines[0].price, 1035)
  assert.equal(nov.adjusted.length, 0)
})

test('Übernahme aus dem Leistungsnachweis: Stunden oder Monatspauschale, Sonderleistungen einzeln', () => {
  let n = 0
  const newId = () => `l${++n}`
  const proof = { rows: [{ date: '2026-10-05', status: 'erbracht', category: 'reinigung', planMinutes: 120, label: 'Unterhaltsreinigung' }, { date: '2026-10-12', status: 'bestaetigt', category: 'reinigung', planMinutes: 120 }, { date: '2026-10-19', status: 'entfallen', category: 'reinigung', planMinutes: 0 }, { date: '2026-10-20', status: 'erbracht', category: 'sonder', planMinutes: 90, label: 'Grundreinigung Keller' }] }
  const byHour = linesFromProof({ proof, objectName: 'Wohnanlage', month: '2026-10', rate: 32.5, newId })
  assert.equal(byHour.length, 2)
  assert.equal(byHour[0].qty, 4)
  assert.equal(byHour[0].unit, 'Std.')
  assert.match(byHour[0].text, /Oktober 2026 lt\. Leistungsnachweis \(2 Einsätze\)/)
  assert.equal(byHour[1].text, 'Grundreinigung Keller am 20.10.2026')
  assert.equal(byHour[1].qty, 1.5)
  const monthly = linesFromProof({ proof, objectName: 'Wohnanlage', month: '2026-10', monthly: 980, newId })
  assert.equal(monthly[0].unit, 'Monat')
  assert.equal(monthly[0].price, 980)
})

test('Export für die Steuerberatung: eine Zeile je Steuersatz, Storno als GU, CSV', () => {
  const a = finalize(draft({ id: 'a', lines: [{ text: 'A', qty: 1, price: 100, vat: 20 }, { text: 'B', qty: 1, price: 50, vat: 10 }] }), [], settings)
  const rc = finalize(draft({ id: 'b', reverseCharge: true, lines: [{ text: 'Reinigung Baustelle', qty: 1, price: 500, vat: 20 }] }), [a], settings)
  const st = finalize(stornoDraft(a, { id: 's', date: '2026-11-04' }), [a, rc], settings)
  const rows = exportRows([a, rc, st, draft({ id: 'entwurf' })], { from: '2026-11-01', to: '2026-11-30', settings })
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((r) => [r.number, r.rate, r.account, r.net]), [
    ['RE-2026-0001', 20, '4000', 100],
    ['RE-2026-0001', 10, '4010', 50],
    ['RE-2026-0002', 0, '4030', 500],
    ['ST-2026-0001', 20, '4000', -100],
    ['ST-2026-0001', 10, '4010', -50],
  ])
  assert.equal(rows[2].code, 'RC19-1a')
  assert.equal(rows[3].kindLabel, 'GU')
  const csv = exportCsv(rows)
  assert.match(csv.split('\r\n')[0], /^Belegnummer;Belegdatum;Belegart;/)
  assert.match(csv, /RE-2026-0001;03\.11\.2026;AR;;4000;Hausverwaltung Muster;ATU87654321;20,00;;100,00;20,00;120,00;01\.10\.2026–31\.10\.2026;/)
  assert.match(csv, /ST-2026-0001;04\.11\.2026;GU;.*-100,00;-20,00;-120,00/)
  const months = revenueByMonth([a, rc, st], 2026, settings)
  assert.equal(months[10].net, 500)
  assert.equal(months[10].count, 2)
})

test('EPC-QR-Code (Zahlungsanweisung) und IBAN-Prüfung', () => {
  assert.ok(ibanValid(IBAN))
  assert.ok(ibanValid('AT61 1904 3002 3457 3201'))
  assert.ok(!ibanValid('AT611904300234573202'))
  assert.ok(!ibanValid('AT6119043002345732'))
  assert.equal(epcPayload({ name: 'Reinigung Beispiel GmbH', iban: 'AT61 1904 3002 3457 3201', bic: 'BKAUATWW', amount: 1481.47, text: 'Rechnung RE-2026-0001' }), 'BCD\n002\n1\nSCT\nBKAUATWW\nReinigung Beispiel GmbH\nAT611904300234573201\nEUR1481.47\n\n\nRechnung RE-2026-0001')
  // ohne BIC und ohne Text: keine leeren Zeilen am Ende
  assert.equal(epcPayload({ name: 'X', iban: IBAN, amount: 10 }), 'BCD\n002\n1\nSCT\n\nX\nAT611904300234573201\nEUR10.00')
  assert.equal(epcPayload({ name: 'X', iban: 'AT00', amount: 10 }), null)
  const inv = finalize(draft(), [], settings)
  const pdf = invoiceDocument({ doc: inv, settings, brand: {} })
  const qr = JSON.stringify(pdf.content).match(/"qr":"([^"]+)"/)
  assert.ok(qr, 'QR-Code auf der Rechnung')
  assert.match(qr[1], /EUR1481\.47/)
  assert.match(invoiceMailText({ doc: inv, company: 'Reinigung Beispiel GmbH', sender: 'Büro', iban: IBAN }), /zahlbar bis 17\.11\.2026 auf AT61 1904 3002 3457 3201/)
  // Entwurf: Wasserzeichen, kein QR-Code
  const d = invoiceDocument({ doc: draft(), settings, brand: {} })
  assert.ok(d.watermark)
  assert.ok(!/"qr"/.test(JSON.stringify(d.content)))
})
