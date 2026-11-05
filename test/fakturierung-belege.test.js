// Fakturierung wie orgaMAX, Teil 2: Positionsarten (Text, Titel, Zwischensumme, Option, Alternative), Abschlags- und
// Schlussrechnung (Abzug je Steuersatz samt Steuer), Lieferschein (Sammelrechnung) und Proformarechnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  acceptedLines,
  advanceConflicts,
  advanceDraft,
  advancesFor,
  billedBy,
  checksumOf,
  collectDraft,
  convertDraft,
  exportRows,
  finalDraft,
  finalize,
  intact,
  isInvoice,
  kindLabel,
  lineRows,
  nextNumber,
  openAmount,
  openItems,
  problems,
  revenueByCustomer,
  revenueByMonth,
  skontoOf,
  stateOf,
  stornoDraft,
  totals,
} from '../src/core/invoicing.js'
import { aging, revenueMonths, topCustomers } from '../src/core/kpi.js'
import { ciiXml, ebInterfaceXml, eInvoiceProblems } from '../src/export/e-invoice.js'
import { invoiceDocument } from '../src/export/invoice-pdf.js'

const settings = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: 'AT611904300234573201', bic: 'BKAUATWW', name: 'Bank Beispiel' }, paymentDays: 14 }
const recipient = { name: 'Hausverwaltung Muster', address: 'Platz 2\n5020 Salzburg', uid: 'ATU87654321' }
const fin = (d, docs = []) => finalize(d, docs, settings, { now: `${d.date}T10:00:00.000Z`, by: 'Büro' })
const item = (id, text, qty, price, vat = 20, extra = {}) => ({ id, text, qty, unit: 'Std.', price, vat, ...extra })

test('Alte Belege: Prüfsumme bleibt gültig, Summen wie festgeschrieben, Zeilen ohne Art sind Positionen', () => {
  const old = JSON.parse(readFileSync(new URL('./fixtures/fakturierung-alte-belege.json', import.meta.url), 'utf8'))
  assert.equal(old.length, 3)
  for (const d of old) {
    assert.ok(intact(d), `${d.number}: Prüfsumme`)
    assert.equal(checksumOf(d), d.checksum)
    assert.ok(d.lines.every((l) => !('type' in l)), 'kein type nachträglich')
    const t = totals(d, settings)
    assert.equal(t.gross, d.total.gross, `${d.number}: brutto`)
    assert.deepEqual(t.groups.map(({ rate, net, vat }) => ({ rate, net, vat })), d.total.groups)
    assert.equal(t.full, undefined)
  }
  // Storno eines alten Belegs: alle Zeilen mit umgekehrtem Vorzeichen wie bisher (auch die leere)
  const st = stornoDraft(old[0], { id: 's9', date: '2026-03-09', reason: 'x' })
  assert.deepEqual(st.lines.map((l) => l.qty), [-1, -3.5, -2, -1])
  assert.ok(st.lines.every((l) => !('type' in l)))
  assert.equal(st.title, 'Storno zu Rechnung RE-2026-0001 vom 03.03.2026')
  assert.equal(st.advances, undefined)
  // nachträglich ein type in eine alte Zeile geschrieben: Prüfsumme schlägt an
  const touched = structuredClone(old[0])
  touched.lines[0].type = 'item'
  assert.equal(intact(touched), false)
})

test('Positionsarten: nur Positionen zählen; Text, Titel mit Gruppensumme, Zwischensumme, Option, Alternative', () => {
  const lines = [
    { id: 't1', type: 'title', text: 'Unterhaltsreinigung', showSum: true },
    item('a', 'Büros', 10, 30),
    item('b', 'Stiegenhaus', 4, 30),
    { id: 'x', type: 'text', text: 'Reinigung jeweils montags und donnerstags.' },
    { id: 'z1', type: 'subtotal', text: '' },
    { id: 't2', type: 'title', text: 'Glasreinigung' },
    item('c', 'Fenster innen und außen', 100, 2.5, 20, { unit: 'm²' }),
    item('o', 'Rahmen mitreinigen', 100, 0.8, 20, { type: 'optional', unit: 'm²' }),
    item('alt', 'Fenster nur außen', 100, 1.5, 20, { type: 'alternative', altTo: 'c', unit: 'm²' }),
    { id: 'z2', type: 'subtotal', text: 'Zwischensumme Glas' },
    { id: 'leer', text: '', qty: 1, price: '' },
  ]
  const d = { kind: 'angebot', date: '2026-11-03', recipient, lines, discount: 10 }
  const t = totals(d, settings)
  // Positionen: 300 + 120 + 250 = 670; 10 % Rabatt → 603; Option 80 und Alternative 150 zählen nicht
  assert.deepEqual(t.lines.map((l) => l.id), ['a', 'b', 'c'])
  assert.equal(t.subtotal, 670)
  assert.equal(t.net, 603)
  assert.equal(t.gross, 723.6)
  const rows = t.rows
  assert.deepEqual(rows.map((r) => r.type), ['title', 'item', 'item', 'text', 'subtotal', 'groupsum', 'title', 'item', 'optional', 'alternative', 'subtotal'])
  assert.deepEqual(rows.filter((r) => r.pos).map((r) => [r.id, r.pos]), [['a', 1], ['b', 2], ['c', 3], ['o', 4], ['alt', 5]])
  // Zwischensumme: seit der letzten Zwischensumme (Optionen und Alternativen nicht)
  assert.deepEqual(rows.filter((r) => r.type === 'subtotal').map((r) => r.net), [420, 250])
  // Gruppensumme nur beim Titel mit showSum, am Ende der Gruppe
  assert.deepEqual(rows.filter((r) => r.type === 'groupsum').map((r) => [r.text, r.net]), [['Summe Unterhaltsreinigung', 420]])
  assert.equal(rows.find((r) => r.id === 'o').net, 80)
  assert.equal(rows.find((r) => r.id === 'alt').altPos, 3)
  // im Angebot erlaubt, in Rechnung und Lieferschein nicht
  assert.ok(!problems({ ...d, validUntil: '2026-12-01' }, settings).some((p) => p.level === 'error'), JSON.stringify(problems(d, settings)))
  assert.ok(problems({ ...d, kind: 'rechnung', serviceFrom: '2026-10-01' }, settings).some((p) => p.level === 'error' && /Optionen und Alternativen/.test(p.text)))
  // nur Text: keine Position
  assert.ok(problems({ kind: 'angebot', date: '2026-11-03', recipient, lines: [{ type: 'text', text: 'Nur ein Text' }] }, settings).some((p) => p.text === 'Keine Position.'))
  // Anzeige ohne Summenzeile, wenn kein Titel mit Summe
  assert.equal(lineRows([{ type: 'title', text: 'A' }, item('a', 'x', 1, 1)]).some((r) => r.type === 'groupsum'), false)
})

test('Umwandeln: Optionen und Alternativen nur, wenn angenommen; Alternative ersetzt ihre Position', () => {
  const offer = fin({ id: 'an1', kind: 'angebot', date: '2026-11-03', recipient, validUntil: '2026-12-03', title: 'Glas', lines: [{ type: 'title', text: 'Glas' }, item('c', 'Fenster innen und außen', 100, 2.5), item('o', 'Rahmen', 100, 0.8, 20, { type: 'optional' }), item('alt', 'Fenster nur außen', 100, 1.5, 20, { type: 'alternative', altTo: 'c' })] })
  assert.equal(offer.total.net, 250)
  const none = convertDraft(offer, 'rechnung', { id: 'r1', date: '2026-11-10' })
  assert.deepEqual(none.lines.map((l) => [l.type || 'item', l.text]), [['title', 'Glas'], ['item', 'Fenster innen und außen']])
  const both = convertDraft(offer, 'auftrag', { id: 'r2', date: '2026-11-10', accept: [offer.lines[2].id, offer.lines[3].id] })
  assert.deepEqual(both.lines.map((l) => l.text), ['Glas', 'Rahmen', 'Fenster nur außen'])
  assert.ok(both.lines.slice(1).every((l) => !('type' in l) && !('altTo' in l)), 'angenommene sind normale Positionen')
  assert.equal(totals(both, settings).net, 230)
  assert.deepEqual(both.lines.map((l) => l.id), ['r2-1', 'r2-2', 'r2-3'])
  // ohne Bezug (altTo) ersetzt die Alternative nichts
  assert.deepEqual(acceptedLines([item('a', 'A', 1, 1), item('b', 'B', 1, 2, 20, { type: 'alternative' })], { accept: ['b'] }).map((l) => l.text), ['A', 'B'])
})

test('Abschlagsrechnung: Prozent oder Betrag, je Steuersatz anteilig, eigene Rechnungsnummer der Rechnungsfolge', () => {
  const order = fin({ id: 'ab1', kind: 'auftrag', date: '2026-09-01', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', recipient, title: 'Grundreinigung Neubau', lines: [item('a', 'Grundreinigung', 100, 60, 20), item('b', 'Pflanzenpflege', 10, 40, 10)] })
  // netto 6.000 (20 %) und 400 (10 %)
  const p = advanceDraft(order, { id: 'x1', date: '2026-09-05', percent: 30, settings })
  assert.equal(p.stage, 'abschlag')
  assert.equal(p.kind, 'rechnung')
  assert.deepEqual(p.lines.map((l) => [l.price, l.vat]), [[1800, 20], [120, 10]])
  assert.match(p.lines[0].text, /^1\. Abschlag 30 % laut Auftragsbestätigung AB-2026-0001 \(Leistungen mit 20 % USt\)$/)
  assert.equal(p.title, '1. Abschlagsrechnung zu Auftragsbestätigung AB-2026-0001 – Grundreinigung Neubau')
  assert.equal(kindLabel(p), 'Abschlagsrechnung')
  const a = advanceDraft(order, { id: 'x2', date: '2026-09-05', amount: 3200, no: 2, settings })
  assert.deepEqual(a.lines.map((l) => [l.price, l.vat]), [[3000, 20], [200, 10]])
  assert.throws(() => advanceDraft(order, { id: 'x3', date: '2026-09-05', amount: 7000, settings }), /höher als der Auftrag/)
  assert.throws(() => advanceDraft({ ...order, number: '' }, { id: 'x3', date: '2026-09-05', percent: 10, settings }), /festgeschriebenen/)
  // Festschreiben: Nummer aus der Rechnungsfolge, stage in der Prüfsumme, keine Warnung „Leistung nach Rechnungsdatum“
  const f = fin(p, [order])
  assert.equal(f.number, 'RE-2026-0001')
  assert.ok(intact(f))
  assert.equal(intact({ ...f, stage: undefined }), false)
  assert.ok(!problems(p, settings).some((x) => /Vorausrechnung/.test(x.text)))
  assert.ok(problems(p, settings).some((x) => /§ 19 Abs\. 2 Z 1 lit\. a/.test(x.text)))
})

/** Auftrag mit 20 % und 10 %, zwei Abschläge, Schlussrechnung. */
function project() {
  const order = fin({ id: 'ab1', kind: 'auftrag', date: '2026-09-01', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', recipient, title: 'Grundreinigung Neubau', lines: [item('a', 'Grundreinigung', 100, 60, 20), item('b', 'Pflanzenpflege', 10, 40, 10)] })
  let docs = [order]
  const a1 = fin({ ...advanceDraft(order, { id: 'a1', date: '2026-09-05', percent: 30, settings }), dueDate: '2026-09-19' }, docs)
  docs = [...docs, { ...a1, payments: [{ id: 'p1', date: '2026-09-10', amount: a1.total.gross }] }]
  const a2 = fin({ ...advanceDraft(order, { id: 'a2', date: '2026-10-05', amount: 1000, no: 2, settings }), dueDate: '2026-10-19' }, docs)
  docs = [...docs, a2]
  return { order, a1: docs[1], a2, docs }
}

test('Schlussrechnung: zwei Steuersätze, zwei Abschläge je Steuersatz samt USt abgezogen, offen nur der Rest', () => {
  const { order, a1, a2, docs } = project()
  // Abschlag 1: 1.800 (20 %) + 120 (10 %) → 2.160 + 132 = 2.292; Abschlag 2: 1.000 netto anteilig 937,50 + 62,50
  assert.equal(a1.total.gross, 2292)
  assert.deepEqual(a2.total.groups, [{ rate: 20, net: 937.5, vat: 187.5 }, { rate: 10, net: 62.5, vat: 6.25 }])
  assert.deepEqual(advancesFor(order, docs).map((x) => x.number), ['RE-2026-0001', 'RE-2026-0002'])
  const draft = { ...finalDraft(order, { id: 'sr', date: '2026-11-03', advances: advancesFor(order, docs), settings }), dueDate: '2026-11-17' }
  assert.equal(draft.stage, 'schluss')
  assert.match(draft.title, /^Schlussrechnung zu Auftragsbestätigung AB-2026-0001/)
  const t = totals(draft, settings)
  // ganze Leistung: 6.000 + 1.200 USt, 400 + 40 USt = 7.640
  assert.deepEqual(t.full.groups.map(({ rate, net, vat }) => [rate, net, vat]), [[20, 6000, 1200], [10, 400, 40]])
  assert.equal(t.full.gross, 7640)
  // Abzug je Steuersatz: 20 %: 1.800 + 937,50 = 2.737,50 netto, 547,50 USt; 10 %: 120 + 62,50 = 182,50 netto, 18,25 USt
  assert.deepEqual(t.advance.groups.map(({ rate, net, vat }) => [rate, net, vat]), [[20, 2737.5, 547.5], [10, 182.5, 18.25]])
  assert.equal(t.advance.gross, 3485.75)
  assert.deepEqual(t.groups.map(({ rate, net, vat }) => [rate, net, vat]), [[20, 3262.5, 652.5], [10, 217.5, 21.75]])
  assert.equal(t.gross, 4154.25)
  assert.equal(round(t.full.gross - t.advance.gross), t.gross)
  // festschreiben: total = Rest, full und advance dazu; Prüfsumme mit advances
  const sr = fin(draft, docs)
  assert.equal(sr.number, 'RE-2026-0003')
  assert.equal(sr.total.gross, 4154.25)
  assert.equal(sr.total.full.gross, 7640)
  assert.equal(sr.total.advance.gross, 3485.75)
  assert.ok(intact(sr))
  assert.equal(intact({ ...sr, advances: sr.advances.slice(1) }), false)
  const all = [...docs, sr]
  // offene Posten: Schlussrechnung nur mit dem Rest; Abschlag 2 (unbezahlt) bleibt eigener offener Posten
  assert.equal(openAmount(sr, all, settings), 4154.25)
  assert.deepEqual(openItems(all, '2026-11-04', settings).map((x) => [x.doc.number, x.open]), [['RE-2026-0002', 1193.75], ['RE-2026-0003', 4154.25]])
  // Umsatz: nicht doppelt (Abschläge in ihrem Monat, Schlussrechnung mit dem Rest) – Summe = ganze Leistung netto
  const months = revenueByMonth(all, '2026', settings)
  assert.equal(round(months.reduce((s, m) => s + m.net, 0)), 6400)
  assert.equal(months[10].net, 3480)
  assert.equal(revenueByCustomer(all, '2026', settings)[0].net, 6400)
  // Kennzahlen (core/kpi.js) ebenso
  const fak = { documents: all, settings }
  assert.equal(round(revenueMonths(fak, [{ key: 'j', from: '2026-01-01', to: '2026-12-31' }])[0].net), 6400)
  assert.equal(topCustomers(fak, { from: '2026-01-01', to: '2026-12-31' })[0].net, 6400)
  assert.equal(round(aging(fak, '2026-11-04').reduce((s, b) => s + b.amount, 0)), 5348)
  // Export: Rest je Steuersatz, Text nennt die Abschläge
  const rows = exportRows(all, { from: '2026-11-01', to: '2026-11-30', settings })
  assert.deepEqual(rows.map((r) => [r.number, r.rate, r.net, r.vat]), [['RE-2026-0003', 20, 3262.5, 652.5], ['RE-2026-0003', 10, 217.5, 21.75]])
  assert.match(rows[0].text, /^Schlussrechnung zu AB-2026-0001 Hausverwaltung Muster \(abzgl\. RE-2026-0001, RE-2026-0002\)$/)
  // Skonto auf den Rest
  assert.equal(skontoOf({ ...sr, skonto: { percent: 2, days: 7 } }, settings).amount, 83.09)
  // schon abgezogen: kein zweites Mal; Storno der Schlussrechnung gibt die Abschläge wieder frei
  assert.deepEqual(advancesFor(order, all), [])
  assert.deepEqual(advancesFor(order, all, { exceptId: 'sr' }).length, 2)
  const st = fin(stornoDraft(sr, { id: 'st', date: '2026-11-05', reason: 'falsch' }), all)
  assert.equal(st.total.gross, -4154.25)
  assert.equal(st.total.full.gross, -7640)
  const after = [...all, st]
  assert.equal(openAmount(sr, after, settings), 0)
  assert.equal(advancesFor(order, after).length, 2)
  assert.equal(round(revenueByMonth(after, '2026', settings).reduce((s, m) => s + m.net, 0)), 2920)
  // Entwurf einer Schlussrechnung sperrt nichts; doppelt abziehen verhindert advanceConflicts beim Festschreiben
  const twice = { ...finalDraft(order, { id: 'sr2', date: '2026-11-04', advances: [a1, a2], settings }), dueDate: '2026-11-18' }
  assert.deepEqual(advanceConflicts(draft, docs), [])
  assert.deepEqual(advanceConflicts(twice, all), [`Abschlagsrechnung ${a1.number} ist schon in der Schlussrechnung RE-2026-0003 abgezogen.`, `Abschlagsrechnung ${a2.number} ist schon in der Schlussrechnung RE-2026-0003 abgezogen.`])
  assert.deepEqual(advancesFor(order, [...docs, draft]).length, 2, 'ein Entwurf sperrt die Abschläge nicht')
  const a2st = fin(stornoDraft(a2, { id: 'a2st', date: '2026-10-20', reason: 'x' }), docs)
  assert.match(advanceConflicts(draft, [...docs, a2st])[0], /RE-2026-0002 ist storniert/)
  // ohne Abschläge: gewöhnliche Rechnung
  const plain = finalDraft(order, { id: 'pl', date: '2026-11-03', settings })
  assert.equal(plain.stage, undefined)
  assert.equal(plain.advances, undefined)
})

test('Schlussrechnung: Abschläge zum Angebot zählen auch beim Auftrag daraus; Grenzen mit der ganzen Leistung', () => {
  const offer = fin({ id: 'an', kind: 'angebot', date: '2026-08-01', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', recipient, validUntil: '2026-09-01', lines: [item('a', 'Grundreinigung', 200, 60)] })
  const adv = fin(advanceDraft(offer, { id: 'ad', date: '2026-08-05', percent: 50, settings }), [offer])
  const order = fin({ ...convertDraft(offer, 'auftrag', { id: 'au', date: '2026-08-10' }) }, [offer, adv])
  const docs = [offer, adv, order]
  assert.deepEqual(advancesFor(order, docs).map((x) => x.id), ['ad'])
  const draft = { ...finalDraft(order, { id: 'sr', date: '2026-11-03', advances: advancesFor(order, docs), settings }), serviceFrom: '2026-10-01', dueDate: '2026-11-17' }
  // ganze Leistung 14.400 brutto (> 10.000): UID des Empfängers nötig, obwohl der Rest nur 7.200 ist
  assert.ok(problems({ ...draft, recipient: { ...recipient, uid: '' } }, settings).some((p) => /10\.000/.test(p.text)))
  // Abschläge höher als die Schlussrechnung: Warnung statt Fehler
  const over = { ...draft, advances: [...draft.advances, { ...draft.advances[0], id: 'zz' }, { ...draft.advances[0], id: 'zy' }] }
  const list = problems(over, settings)
  assert.ok(!list.some((p) => p.level === 'error'), JSON.stringify(list))
  assert.ok(list.some((p) => /gutgeschrieben/.test(p.text)))
})

test('Lieferschein: Nummer LS, aus dem Auftrag, Sammelrechnung, verrechnet; kein Umsatz und kein offener Posten', () => {
  assert.equal(nextNumber([], 'lieferschein', '2026', settings).number, 'LS-2026-0001')
  const order = fin({ id: 'ab', kind: 'auftrag', date: '2026-10-01', recipient, customerId: 'c1', lines: [item('a', 'Grundreinigung', 10, 30)] })
  const ls1 = fin({ ...convertDraft(order, 'lieferschein', { id: 'ls1', date: '2026-10-10' }), serviceFrom: '2026-10-10', hidePrices: true }, [order])
  assert.equal(ls1.number, 'LS-2026-0001')
  assert.equal(ls1.hidePrices, true)
  assert.ok(intact(ls1))
  assert.equal(intact({ ...ls1, hidePrices: undefined }), false)
  const ls2 = fin({ id: 'ls2', kind: 'lieferschein', date: '2026-10-20', serviceFrom: '2026-10-20', recipient, customerId: 'c1', lines: [{ type: 'text', text: 'Zusätzlich auf Zuruf:' }, item('b', 'Fensterreinigung', 2, 30)] }, [order, ls1])
  assert.equal(ls2.number, 'LS-2026-0002')
  assert.equal(ls2.hidePrices, undefined, 'false wird nicht gespeichert')
  let docs = [order, ls1, ls2]
  assert.ok(!isInvoice(ls1))
  assert.deepEqual(openItems(docs, '2026-11-01', settings), [])
  assert.equal(revenueByMonth(docs, '2026', settings).reduce((s, m) => s + m.net, 0), 0)
  assert.deepEqual(exportRows(docs, { from: '2026-01-01', to: '2026-12-31', settings }), [])
  assert.equal(stateOf(ls1, docs, '2026-11-01', settings), 'offen')
  const inv = collectDraft([ls2, ls1], { id: 'sam', date: '2026-11-02' })
  assert.deepEqual(inv.deliveryNotes.map((n) => n.number), ['LS-2026-0001', 'LS-2026-0002'])
  assert.equal(inv.serviceFrom, '2026-10-10')
  assert.equal(inv.serviceTo, '2026-10-20')
  assert.equal(inv.refId, undefined)
  assert.equal(inv.title, 'Sammelrechnung zu 2 Lieferscheinen')
  assert.deepEqual(inv.lines.map((l) => [l.type || 'item', l.text]), [['title', 'Lieferschein LS-2026-0001 vom 10.10.2026'], ['item', 'Grundreinigung'], ['title', 'Lieferschein LS-2026-0002 vom 20.10.2026'], ['text', 'Zusätzlich auf Zuruf:'], ['item', 'Fensterreinigung']])
  assert.equal(totals(inv, settings).net, 360)
  // als Entwurf: noch offen; festgeschrieben: verrechnet
  docs = [...docs, inv]
  assert.equal(billedBy(ls1, docs).id, 'sam')
  assert.equal(stateOf(ls1, docs, '2026-11-02', settings), 'offen')
  const fixed = fin({ ...inv, dueDate: '2026-11-16' }, docs)
  assert.ok(intact(fixed))
  assert.equal(intact({ ...fixed, deliveryNotes: [] }), false)
  docs = docs.map((x) => (x.id === 'sam' ? fixed : x))
  assert.equal(stateOf(ls1, docs, '2026-11-02', settings), 'verrechnet')
  assert.equal(stateOf(ls2, docs, '2026-11-02', settings), 'verrechnet')
  // ein Lieferschein: Bezug direkt
  assert.equal(collectDraft([ls1], { id: 'e', date: '2026-11-02' }).refId, 'ls1')
  assert.throws(() => collectDraft([ls1, { ...ls2, customerId: 'c2' }], { id: 'e', date: '2026-11-02' }), /einen Kunden/)
  assert.throws(() => collectDraft([{ ...ls1, number: '' }], { id: 'e', date: '2026-11-02' }), /festgeschriebene/)
})

test('Proformarechnung: Nummer PF, keine Rechnung (kein Umsatz, kein OP, kein Export), in Rechnung umwandelbar', () => {
  const pf = fin({ id: 'pf', kind: 'proforma', date: '2026-11-02', recipient, lines: [item('a', 'Grundreinigung', 10, 30)] })
  assert.equal(pf.number, 'PF-2026-0001')
  assert.equal(kindLabel(pf), 'Proformarechnung')
  assert.ok(!isInvoice(pf))
  let docs = [pf]
  assert.equal(openAmount(pf, docs, settings), 0)
  assert.deepEqual(openItems(docs, '2026-12-31', settings), [])
  assert.equal(revenueByMonth(docs, '2026', settings)[10].net, 0)
  assert.deepEqual(exportRows(docs, { from: '2026-01-01', to: '2026-12-31', settings }), [])
  assert.equal(stateOf(pf, docs, '2026-11-02', settings), 'offen')
  const inv = fin({ ...convertDraft(pf, 'rechnung', { id: 're', date: '2026-11-10' }), serviceFrom: '2026-11-05', dueDate: '2026-11-24' }, docs)
  assert.equal(inv.number, 'RE-2026-0001')
  assert.equal(inv.refNumber, 'PF-2026-0001')
  docs = [...docs, inv]
  assert.equal(stateOf(pf, docs, '2026-11-10', settings), 'verrechnet')
  assert.equal(revenueByMonth(docs, '2026', settings)[10].net, 300)
})

test('E-Rechnung: Abschlag 386, Schlussrechnung mit vorausbezahltem Betrag, Texte als Bemerkung, Bezüge', () => {
  const { order, a1, a2, docs } = project()
  const sr = fin({ ...finalDraft(order, { id: 'sr', date: '2026-11-03', advances: [a1, a2], settings }), dueDate: '2026-11-17' }, docs)
  const adv = ciiXml(a1, settings, { ref: order })
  assert.match(adv, /<ram:TypeCode>386<\/ram:TypeCode>/)
  assert.match(adv, /<ram:SellerOrderReferencedDocument>\s*<ram:IssuerAssignedID>AB-2026-0001</)
  assert.doesNotMatch(adv, /InvoiceReferencedDocument/, 'ein Auftrag ist keine Vorgängerrechnung')
  assert.match(adv, /Abschlagsrechnung \(Anzahlung\) zu AB-2026-0001/)
  assert.match(ebInterfaceXml(a1, settings, { ref: order }), /DocumentType="InvoiceForAdvancePayment"/)
  // Schlussrechnung: ganze Leistung, Steuer voll, Abschläge brutto als TotalPrepaidAmount, fällig der Rest
  const x = ciiXml(sr, settings, { ref: order })
  assert.match(x, /<ram:TypeCode>380<\/ram:TypeCode>/)
  assert.match(x, /<ram:TaxBasisTotalAmount>6400\.00<\/ram:TaxBasisTotalAmount>/)
  assert.match(x, /<ram:GrandTotalAmount>7640\.00<\/ram:GrandTotalAmount>/)
  assert.match(x, /<ram:TotalPrepaidAmount>3485\.75<\/ram:TotalPrepaidAmount>/)
  assert.match(x, /<ram:DuePayableAmount>4154\.25<\/ram:DuePayableAmount>/)
  assert.match(x, /abgezogen Abschlagsrechnung RE-2026-0001 vom 05\.09\.2026: Entgelt 20 % 1800\.00, USt 360\.00; Entgelt 10 % 120\.00, USt 12\.00, brutto 2292\.00/)
  assert.doesNotMatch(x, /InvoiceReferencedDocument/, 'zwei Abschläge: CII kennt nur eine Vorgängerrechnung')
  assert.ok(eInvoiceProblems(sr, settings, { ref: order }).some((p) => /nur eine Vorgängerrechnung/.test(p.text)))
  assert.ok(!eInvoiceProblems(sr, settings, { ref: order }).some((p) => p.level === 'error'))
  const one = fin({ ...finalDraft(order, { id: 'sr1', date: '2026-11-03', advances: [a1], settings }), dueDate: '2026-11-17' }, docs)
  assert.match(ciiXml(one, settings, { ref: order }), /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-0001<\/ram:IssuerAssignedID>/)
  // Storno der Schlussrechnung: Bezug ist die Schlussrechnung, nicht der Abschlag
  const st = fin(stornoDraft(one, { id: 'st1', date: '2026-11-05', reason: 'x' }), [...docs, one])
  const stx = ciiXml(st, settings, { ref: one })
  assert.match(stx, /<ram:TypeCode>381</)
  assert.match(stx, new RegExp(`<ram:InvoiceReferencedDocument>\\s*<ram:IssuerAssignedID>${one.number}<`))
  assert.match(ebInterfaceXml(st, settings, { ref: one }), new RegExp(`<CancelledOriginalDocument>\\s*<InvoiceNumber>${one.number}<`))
  assert.doesNotMatch(ebInterfaceXml(st, settings, { ref: one }), /<RelatedDocument>/)
  const e = ebInterfaceXml(sr, settings, { ref: order })
  assert.match(e, /DocumentType="FinalSettlement"/)
  assert.match(e, /<TotalGrossAmount>7640\.00<\/TotalGrossAmount>\s*<PrepaidAmount>3485\.75<\/PrepaidAmount>\s*<PayableAmount>4154\.25<\/PayableAmount>/)
  assert.equal((e.match(/<RelatedDocument>/g) || []).length, 2)
  assert.match(e, /<DocumentType>InvoiceForAdvancePayment<\/DocumentType>/)
  // Text- und Titelzeilen: keine Positionen mit 0 €, sondern Bemerkungen bzw. Überschriften der Positionslisten
  const inv = fin({ id: 'tx', kind: 'rechnung', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', recipient, lines: [{ type: 'title', text: 'Stiegenhaus' }, item('a', 'Reinigung', 10, 30), { type: 'text', text: 'Jeden Montag.' }, item('b', 'Fenster', 2, 30), { type: 'subtotal' }] })
  const c = ciiXml(inv, settings)
  assert.equal((c.match(/<ram:IncludedSupplyChainTradeLineItem>/g) || []).length, 2)
  assert.match(c, /<ram:Content>Stiegenhaus<\/ram:Content>/)
  assert.match(c, /<ram:Content>Jeden Montag\.<\/ram:Content>/)
  const eb = ebInterfaceXml(inv, settings)
  assert.equal((eb.match(/<ItemList>/g) || []).length, 2)
  assert.match(eb, /<ItemList>\s*<HeaderDescription>Stiegenhaus<\/HeaderDescription>/)
  assert.match(eb, /<ItemList>\s*<HeaderDescription>Jeden Montag\.<\/HeaderDescription>/)
  // Rechnung aus einem Angebot: das Angebot ist keine Vorgängerrechnung
  const offer = fin({ id: 'an', kind: 'angebot', date: '2026-10-01', recipient, validUntil: '2026-11-01', lines: [item('a', 'Reinigung', 1, 100)] })
  const fromOffer = fin({ ...convertDraft(offer, 'rechnung', { id: 'r', date: '2026-11-03' }), serviceFrom: '2026-10-15', dueDate: '2026-11-17' }, [offer])
  assert.doesNotMatch(ciiXml(fromOffer, settings, { ref: offer }), /InvoiceReferencedDocument|SellerOrderReferencedDocument/)
  assert.doesNotMatch(ebInterfaceXml(fromOffer, settings, { ref: offer }), /RelatedDocument/)
  // Lieferschein (BT-16) und Proforma: Proforma und Lieferschein selbst sind keine E-Rechnung
  const ls = fin({ id: 'ls', kind: 'lieferschein', date: '2026-10-10', serviceFrom: '2026-10-10', recipient, lines: [item('a', 'Reinigung', 1, 100)] })
  assert.match(ciiXml(fin({ ...collectDraft([ls], { id: 'rl', date: '2026-11-03' }), dueDate: '2026-11-17' }, [ls]), settings), /<ram:DespatchAdviceReferencedDocument>\s*<ram:IssuerAssignedID>LS-2026-0001</)
  assert.ok(eInvoiceProblems(ls, settings).some((p) => p.level === 'error'))
})

test('PDF: Positionsarten, Proforma-Hinweis, Lieferschein ohne Preise mit Unterschrift, Abzug in der Schlussrechnung', () => {
  const text = (dd) => JSON.stringify(dd.content)
  const offer = fin({ id: 'an', kind: 'angebot', date: '2026-11-03', recipient, validUntil: '2026-12-03', lines: [{ type: 'title', text: 'Glas', showSum: true }, item('c', 'Fenster', 100, 2.5), { type: 'text', text: 'Nur Erdgeschoß.' }, item('o', 'Rahmen', 100, 0.8, 20, { type: 'optional' }), item('alt', 'Nur außen', 100, 1.5, 20, { type: 'alternative', altTo: 'c' }), { type: 'subtotal' }] })
  const a = text(invoiceDocument({ doc: offer, settings }))
  assert.match(a, /"text":"Option: ","bold":true\},"Rahmen"/)
  assert.match(a, /nur auf Wunsch – nicht in der Summe enthalten/)
  assert.match(a, /statt Pos\. 1 – nicht in der Summe enthalten/)
  assert.match(a, /\(80,00 €\)/)
  assert.match(a, /Zwischensumme \(netto\)/)
  assert.match(a, /Summe Glas \(netto\)/)
  assert.match(a, /"text":"Glas","bold":true/)
  assert.match(a, /"text":"Angebotssumme".*"text":"300,00 €"/)
  const pf = invoiceDocument({ doc: fin({ id: 'pf', kind: 'proforma', date: '2026-11-03', recipient, lines: [item('a', 'Reinigung', 1, 100)] }), settings })
  assert.match(text(pf), /Proforma – keine Rechnung im Sinne des UStG/)
  assert.equal(pf.watermark.text, 'Proforma')
  // keine Steuer gesondert ausgewiesen (§ 11 Abs. 14 UStG), nur der Gesamtbetrag inkl. USt
  assert.doesNotMatch(text(pf), /USt 20 % von|"text":"USt"/)
  assert.match(text(pf), /Gesamtbetrag inkl\. USt.*120,00 €/)
  const ls = fin({ id: 'ls', kind: 'lieferschein', date: '2026-10-10', serviceFrom: '2026-10-10', hidePrices: true, recipient, lines: [item('a', 'Reinigung', 3, 100)] })
  const l = text(invoiceDocument({ doc: ls, settings }))
  assert.doesNotMatch(l, /100,00 €|Einzelpreis|Gesamtbetrag/)
  assert.match(l, /Unterschrift und Name in Blockschrift/)
  assert.match(text(invoiceDocument({ doc: { ...ls, hidePrices: false }, settings })), /Einzelpreis/)
  const { order, a1, a2, docs } = project()
  const sr = fin({ ...finalDraft(order, { id: 'sr', date: '2026-11-03', advances: [a1, a2], settings }), dueDate: '2026-11-17' }, docs)
  const s = text(invoiceDocument({ doc: sr, settings }))
  assert.match(s, /Gesamtbetrag der Leistung.*7\.640,00 €/)
  assert.match(s, /abzüglich Abschlagsrechnung RE-2026-0001 vom 05\.09\.2026/)
  assert.match(s, /"text":"USt 20 %".*"text":"−360,00 €"/)
  assert.match(s, /"text":"Restbetrag".*"text":"4\.154,25 €"/)
  assert.match(s, /Bitte überweisen Sie 4\.154,25 €/)
})

const round = (n) => Math.round(n * 100) / 100
