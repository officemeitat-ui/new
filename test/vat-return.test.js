// Umsatzsteuer-Übersicht für die UVA (core/vat-return.js): Zeitraum, Soll- und Istbesteuerung, Storno, Korrektur,
// Skonto (Kunden und Lieferanten), Reverse Charge in beide Richtungen, Kassenbuch mit Storno, Abschlag offen,
// Kennzahlen, fehlende Rechte (Einkauf bzw. Fakturierung nicht lesbar), CSV.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addEntry, emptyCashbook, stornoEntry } from '../src/core/cashbook.js'
import { correctionDraft, finalize, stornoDraft } from '../src/core/invoicing.js'
import { KZ, periodRange, vatBasisOf, vatReturn, vatReturnAssumptions, vatReturnCsv, vatReturnLines } from '../src/core/vat-return.js'

const S = { sender: { name: 'Gebäudereinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' } }
const rec = (name = 'Hausverwaltung Beispiel GmbH') => ({ name, address: 'Ringstraße 3\n5020 Salzburg', uid: 'ATU87654321' })
const L = (price, vat = 20, qty = 1) => ({ id: `l${price}${vat}`, text: `Leistung ${vat} %`, qty, unit: 'Pauschale', price, vat, discount: 0 })

function invoicing() {
  const docs = []
  const add = (d) => {
    const fixed = finalize({ kind: 'rechnung', serviceFrom: d.date, serviceTo: d.date, recipient: rec(), ...d }, docs, S, { now: `${d.date}T09:00:00Z` })
    docs.push(fixed)
    return fixed
  }
  const r1 = add({ id: 'r1', date: '2026-10-05', lines: [L(1000, 20), L(200, 10)] }) // 1.420 € brutto
  const r2 = add({ id: 'r2', date: '2026-10-10', reverseCharge: true, recipient: rec('Reinigung Partner Beispiel GmbH'), lines: [L(2000, 20)] })
  const r3 = add({ id: 'r3', date: '2026-09-28', skonto: { percent: 2, days: 10 }, lines: [L(500, 20)] }) // 600 € brutto, Skonto 12 €
  const r4 = add({ id: 'r4', date: '2026-10-12', lines: [L(300, 13)] })
  add({ id: 'a1', date: '2026-10-18', stage: 'abschlag', lines: [L(100, 20)] }) // Abschlag, unbezahlt
  docs.push(finalize(stornoDraft(r4, { id: 's4', date: '2026-10-15', reason: 'doppelt' }), docs, S, { now: '2026-10-15T09:00:00Z' }))
  docs.push(finalize(correctionDraft(r1, { id: 'k1', date: '2026-10-20', text: 'Preisminderung', amount: 100, vat: 20 }), docs, S, { now: '2026-10-20T09:00:00Z' }))
  docs.push({ id: 'd1', kind: 'rechnung', date: '2026-10-30', lines: [L(50)] }) // Entwurf: zählt nicht
  // Zahlungen: R3 in der Skontofrist (588 € + 12 € Skonto), R1 zur Hälfte, R2 ganz
  r3.payments = [{ id: 'p3', date: '2026-10-03', amount: 588 }, { id: 'p3s', date: '2026-10-03', amount: 12, kind: 'skonto', ref: 'p3' }]
  r1.payments = [{ id: 'p1', date: '2026-10-25', amount: 710 }]
  r2.payments = [{ id: 'p2', date: '2026-10-30', amount: 2000 }]
  return docs
}

function purchase() {
  const sup = { name: 'Hygiene-Großhandel Beispiel GmbH', address: 'Industriestraße 4\n5020 Salzburg', uid: 'ATU12345675' }
  const ok = { recipient: true, ourUid: true, rcNote: true }
  const base = (extra) => ({ supplier: sup, text: 'Material', serviceFrom: extra.date, checks: ok, payments: [], ...extra })
  return {
    suppliers: [],
    invoices: [
      base({ id: 'e1', no: 'ER-2026-0001', number: 'A-1', date: '2026-10-08', groups: [{ rate: 20, net: 412.5, vat: 82.5 }, { rate: 10, net: 50, vat: 5 }], payments: [{ id: 'q1', date: '2026-10-28', amount: 550 }] }),
      base({ id: 'e2', no: 'ER-2026-0002', number: 'GR-118', date: '2026-10-20', reverseCharge: true, groups: [{ rate: 20, net: 1280, vat: 0 }] }),
      base({ id: 'e3', no: 'ER-2026-0003', number: 'A-3', date: '2026-09-20', skonto: { percent: 2, days: 14 }, groups: [{ rate: 20, net: 268, vat: 53.6 }], payments: [{ id: 'q3', date: '2026-10-02', amount: 315.17 }, { id: 'q3s', date: '2026-10-02', amount: 6.43, kind: 'skonto', ref: 'q3' }] }),
      base({ id: 'e4', no: 'ER-2026-0004', number: 'X', date: '2026-10-09', groups: [{ rate: 20, net: 999, vat: 199.8 }], cancelled: { at: '2026-10-10', by: 'x', reason: 'doppelt' } }),
      base({ id: 'e5', no: 'ER-2026-0005', number: 'V-1', date: '2026-10-25', groups: [{ rate: 0, net: 100, vat: 0 }] }), // Versicherung: keine Vorsteuer
      { id: 'e6', no: 'ER-2026-0006', supplier: { name: 'Ohne UID' }, number: '', date: '2026-10-26', groups: [{ rate: 20, net: 500, vat: 100 }], payments: [] }, // Vorsteuer fraglich
    ],
  }
}

function cash() {
  const book = emptyCashbook()
  let i = 0
  const o = (date) => ({ newId: () => `k${++i}`, now: `${date}T08:00:00Z`, today: date })
  addEntry(book, { date: '2026-10-01', kind: 'einnahme', type: 'anfang', amount: 300, text: 'Anfangsbestand' }, o('2026-10-01'))
  addEntry(book, { date: '2026-10-05', kind: 'ausgabe', amount: 23.9, rate: 20, text: 'Glasreiniger', category: 'ek-material' }, o('2026-10-05'))
  const wrong = addEntry(book, { date: '2026-10-06', kind: 'ausgabe', amount: 99.9, rate: 20, text: 'vertippt' }, o('2026-10-06'))
  stornoEntry(book, wrong.id, { reason: 'Betrag vertippt' }, o('2026-10-06'))
  addEntry(book, { date: '2026-10-12', kind: 'einnahme', amount: 180, rate: 20, text: 'Barverkauf Sonderreinigung', category: 'verkauf' }, o('2026-10-12'))
  addEntry(book, { date: '2026-10-13', kind: 'einnahme', amount: 120, text: 'Barzahlung RE-2026-0001', category: 'rechnung', ref: { type: 'ausgang', id: 'r1', number: 'RE-2026-0001' } }, o('2026-10-13'))
  addEntry(book, { date: '2026-10-14', kind: 'ausgabe', amount: 12.5, rate: 0, text: 'Porto', category: 'ausgabe-sonst' }, o('2026-10-14'))
  addEntry(book, { date: '2026-11-02', kind: 'ausgabe', amount: 60, rate: 20, text: 'November', category: 'ek-material' }, o('2026-11-02'))
  return book
}

const OCT = { from: '2026-10-01', to: '2026-10-31' }
const byKey = (lines) => Object.fromEntries(lines.map((l) => [l.key, l]))

test('UVA: Zeitraum Monat und Quartal', () => {
  assert.deepEqual(periodRange('monat', '2026-10'), { mode: 'monat', value: '2026-10', from: '2026-10-01', to: '2026-10-31', label: 'Oktober 2026' })
  assert.equal(periodRange('monat', '2028-02').to, '2028-02-29')
  assert.deepEqual(periodRange('quartal', '2026-Q4'), { mode: 'quartal', value: '2026-Q4', from: '2026-10-01', to: '2026-12-31', label: '4. Quartal 2026' })
  assert.equal(periodRange('quartal', '2026-05').value, '2026-Q2', 'Monat → sein Quartal')
  assert.equal(periodRange('quartal', '2026-Q1').to, '2026-03-31')
  assert.throws(() => periodRange('monat', '2026-13'), /Monat/)
  assert.throws(() => periodRange('quartal', '2026-Q5'), /Quartal/)
  assert.equal(vatBasisOf({}), 'soll')
  assert.equal(vatBasisOf({ vatBasis: 'ist' }), 'ist')
})

test('UVA Soll: je Steuersatz mit Storno, Korrektur, Skonto, Reverse Charge beide Richtungen, Kassenbuch', () => {
  const r = vatReturn({ docs: invoicing(), settings: S, purchase: purchase(), cash: cash(), ...OCT, basis: 'soll' })
  // 20 %: 1.000 + Abschlag 100 − Skonto 10 − Korrektur 100 + Kasse 150 = 1.140
  assert.deepEqual(r.sales.rates[20], { net: 1140, vat: 228 })
  assert.deepEqual(r.sales.rates[10], { net: 200, vat: 20 })
  assert.deepEqual(r.sales.rates[13], { net: 0, vat: 0 }, 'Rechnung und Storno im selben Monat heben sich auf')
  assert.deepEqual(r.sales.rc, { net: 2000, vat: 0 })
  assert.deepEqual(r.sales.skonto, { net: -10, vat: -2 })
  assert.deepEqual(r.sales.cash, { net: 150, vat: 30 })
  // Vorsteuer: 82,50 + 100 (fraglich, zählt mit Hinweis) + 5 − Skonto 1,07 + Kasse 3,98 (Storno hebt die vertippte
  // Buchung auf); Versicherung 0 % und stornierte Erfassung: nicht
  assert.deepEqual(r.input.rates[20], { net: 927.06, vat: 185.41 })
  assert.deepEqual(r.input.rates[10], { net: 50, vat: 5 })
  assert.equal(r.input.rates[0], undefined)
  assert.deepEqual(r.input.skonto, { net: -5.36, vat: -1.07 })
  assert.deepEqual(r.input.cash, { net: 19.92, vat: 3.98 })
  assert.deepEqual(r.input.rc, { net: 1280, vat: 256 })
  assert.deepEqual(r.totals, { base: 3340, salesVat: 248, rcTax: 256, tax: 504, input: 190.41, rcInput: 256, inputTotal: 446.41, complete: true, payable: 57.59 })
  // Hinweise: Entwurf, offener Abschlag, Vorsteuer fraglich, Kassenbuch nicht abgeschlossen
  assert.ok(r.notes.some((n) => /1 Rechnungsentwurf mit Datum im Zeitraum zählt nicht/.test(n)))
  assert.ok(r.notes.some((n) => /Abschlagsrechnung RE-2026-0005 ist im Zeitraum noch nicht \(ganz\) bezahlt/.test(n)), r.notes.join(' | '))
  assert.ok(r.notes.some((n) => /1 Eingangsrechnung im Zeitraum mit fehlenden Angaben/.test(n)))
  assert.ok(r.notes.some((n) => /Kassenbuch 10\/2026 noch nicht abgeschlossen/.test(n)))
  // Belege im Detail
  const kinds = r.rows.map((x) => `${x.area}:${x.ref}:${x.kind}`)
  for (const k of ['ust:RE-2026-0001:Rechnung', 'ust:ST-2026-0001:Stornorechnung', 'ust:KO-2026-0001:Rechnungskorrektur', 'ust:RE-2026-0003:Skonto', 'vst:ER-2026-0002:Reverse Charge', 'vst:ER-2026-0003:Skonto', 'kasse:Kassenbuch Nr. 3:Ausgabe', 'kasse:Kassenbuch Nr. 4:Storno Ausgabe', 'kasse:Kassenbuch Nr. 5:Einnahme']) assert.ok(kinds.includes(k), k)
  assert.ok(!kinds.some((k) => /ER-2026-0004|ER-2026-0005|Nr\. 6|Nr\. 7|Nr\. 8|d1/.test(k)), 'storniert, 0 %, Bezug, Porto ohne Steuer, November, Entwurf: nicht')
  assert.equal(r.rows.find((x) => x.ref === 'RE-2026-0002').kz, '021')
  assert.equal(r.rows.find((x) => x.ref === 'ER-2026-0002').kz, '048/082')
})

test('UVA Kennzahlen und Zeilen der Übersicht', () => {
  const r = vatReturn({ docs: invoicing(), settings: S, purchase: purchase(), cash: cash(), ...OCT })
  const l = byKey(vatReturnLines(r))
  assert.deepEqual([l.base.kz, l.base.net], ['000', 3340])
  assert.deepEqual([l['rc-out'].kz, l['rc-out'].net], ['021', 2000])
  assert.deepEqual([l.r20.kz, l.r20.net, l.r20.vat], ['022', 1140, 228])
  assert.deepEqual([l.r10.kz, l.r10.net, l.r10.vat], ['029', 200, 20])
  assert.deepEqual([l.r13.kz, l.r13.net, l.r13.vat], ['006', 0, 0])
  assert.deepEqual([l['rc-tax'].kz, l['rc-tax'].vat], ['048', 256])
  assert.deepEqual([l.input.kz, l.input.vat], ['060', 190.41])
  assert.deepEqual([l['rc-input'].kz, l['rc-input'].vat], ['082', 256])
  assert.deepEqual([l['skonto-out'].level, l['skonto-out'].vat], ['sub', -2])
  assert.deepEqual([l.tax.vat, l['input-sum'].vat], [504, 446.41])
  assert.deepEqual([l.result.label, l.result.vat], ['Zahllast', 57.59])
  assert.deepEqual(Object.values(KZ).sort(), ['000', '006', '021', '022', '029', '048', '060', '082'])
  assert.match(vatReturnAssumptions('soll').join(' '), /mit der Steuerberatung abstimmen/)
  assert.match(vatReturnAssumptions('ist').join(' '), /§ 12 Abs\. 1 Z 1 lit\. a UStG/)
})

test('UVA Ist: nach Zahlungseingang, anteilig je Steuersatz; Storno, Korrektur und Skonto wirken über das Geld', () => {
  const r = vatReturn({ docs: invoicing(), settings: S, purchase: purchase(), cash: cash(), ...OCT, basis: 'ist' })
  // R1: 710 € von 1.420 € → 500 + 100 (20 %), 100 + 10 (10 %); R3: 588 € → 490 + 98; Kasse 150 + 30
  assert.deepEqual(r.sales.rates[20], { net: 1140, vat: 228 })
  assert.deepEqual(r.sales.rates[10], { net: 100, vat: 10 })
  assert.equal(r.sales.rates[13], undefined, 'unbezahlt und storniert: nichts')
  assert.deepEqual(r.sales.rc, { net: 2000, vat: 0 })
  assert.deepEqual(r.sales.skonto, { net: 0, vat: 0 })
  // Vorsteuer mit der Zahlung: E1 ganz (87,50), E3 315,17 € (52,53); Reverse Charge nach Rechnungsdatum
  assert.deepEqual(r.input.rates[20], { net: 695.06, vat: 139.01 })
  assert.deepEqual(r.input.rates[10], { net: 50, vat: 5 })
  assert.deepEqual(r.input.rc, { net: 1280, vat: 256 })
  assert.deepEqual(r.totals, { base: 3240, salesVat: 238, rcTax: 256, tax: 494, input: 144.01, rcInput: 256, inputTotal: 400.01, complete: true, payable: 93.99 })
  assert.ok(!r.notes.some((n) => /Abschlagsrechnung/.test(n)), 'bei Istbesteuerung zählt der Abschlag mit der Zahlung')
  assert.ok(r.rows.some((x) => x.ref === 'RE-2026-0001' && x.kind === 'Zahlung' && x.date === '2026-10-25'))
})

test('UVA Ist: Rücklastschrift zählt negativ', () => {
  const docs = invoicing()
  docs.find((d) => d.id === 'r1').payments.push({ id: 'rl', date: '2026-10-28', amount: -710, kind: 'ruecklastschrift' })
  const r = vatReturn({ docs, settings: S, ...OCT, basis: 'ist' })
  assert.deepEqual(r.sales.rates[10], { net: 0, vat: 0 })
  assert.deepEqual(r.sales.rates[20], { net: 490, vat: 98 })
  assert.ok(r.rows.some((x) => x.kind === 'Rücklastschrift' && x.net === -500))
})

test('UVA ohne Recht auf Einkauf & Kasse: nur Umsatzsteuer, mit Hinweis; ohne Fakturierung: Vorsteuer und Kasse', () => {
  const r = vatReturn({ docs: invoicing(), settings: S, purchase: null, cash: null, ...OCT })
  assert.deepEqual(r.has, { sales: true, purchase: false, cash: false })
  assert.equal(r.totals.complete, false)
  assert.equal(r.totals.tax, 218, '20 % (990 → 198) und 10 % (20), ohne Kasse und ohne Reverse Charge als Empfänger')
  assert.equal(r.totals.inputTotal, 0)
  assert.match(r.notes[0], /Einkauf & Kasse ist für deine Rolle nicht lesbar: nur Umsatzsteuer/)
  const keys = vatReturnLines(r).map((l) => l.key)
  assert.ok(keys.includes('r20') && !keys.includes('input') && !keys.includes('rc-tax') && !keys.includes('vst'))
  assert.equal(byKey(vatReturnLines(r)).result.label, 'Zahllast – unvollständig')

  const e = vatReturn({ docs: null, purchase: purchase(), cash: cash(), ...OCT })
  assert.match(e.notes[0], /Fakturierung ist für deine Rolle nicht lesbar/)
  assert.deepEqual(e.sales.rates[20], { net: 150, vat: 30 }, 'nur Barverkauf')
  assert.equal(e.totals.tax, 286)
  assert.ok(vatReturnLines(e).some((l) => l.key === 'input'))
})

test('UVA: Gutschrift, Quartal, CSV', () => {
  const p = purchase()
  p.invoices.push({ id: 'big', no: 'ER-2026-0009', supplier: { name: 'Maschinen Beispiel' }, number: 'M-1', date: '2026-11-03', groups: [{ rate: 20, net: 5000, vat: 1000 }] })
  const q = periodRange('quartal', '2026-Q4')
  const r = vatReturn({ docs: invoicing(), settings: S, purchase: p, cash: cash(), from: q.from, to: q.to })
  assert.ok(r.totals.payable < 0)
  assert.equal(byKey(vatReturnLines(r)).result.label, 'Gutschrift (Überschuss)')
  assert.equal(byKey(vatReturnLines(r)).result.vat, Math.abs(r.totals.payable))
  const csv = vatReturnCsv(vatReturn({ docs: invoicing(), settings: S, purchase: purchase(), cash: cash(), ...OCT }), { label: 'Oktober 2026' })
  const lines = csv.split('\r\n')
  assert.equal(lines[0], 'Umsatzsteuer-Übersicht;Oktober 2026;Sollbesteuerung (nach Rechnungsdatum)')
  assert.ok(lines.includes('000;Gesamtbetrag der Bemessungsgrundlagen (Lieferungen und Leistungen, netto);3340,00;'))
  assert.ok(lines.includes('022;20 % Normalsteuersatz;1140,00;228,00'))
  assert.ok(lines.includes('082;Vorsteuer aus Reverse Charge Bauleistungen (§ 19 Abs. 1a UStG);1280,00;256,00'))
  assert.ok(lines.includes(';Zahllast;;57,59'))
  assert.ok(lines.includes('Bereich;Datum;Beleg;Partner;Art;Steuersatz;Netto;Steuer;Kennzahl'))
  assert.ok(lines.some((x) => x.startsWith('Umsatzsteuer;15.10.2026;ST-2026-0001;Hausverwaltung Beispiel GmbH;Stornorechnung;13,00;-300,00;-39,00;006')), lines.filter((x) => x.includes('ST-')).join('\n'))
  assert.ok(lines.some((x) => x.startsWith('Hinweis;')))
  assert.ok(csv.endsWith('\r\n'))
})
