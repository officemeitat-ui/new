// Kosten weiterverrechnen (core/recharge.js): Quellen aus Einkauf und Kassenbuch, Zustände offen → im Entwurf →
// verrechnet, Storno und gelöschter Entwurf geben frei, „nicht verrechnen“, Positionen mit Aufschlag und Bezug,
// Prüfung vor dem Festschreiben, Stand für Rollen ohne Fakturierung (billed).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addEntry, cashChecksum, closeMonth, closingIntact, emptyCashbook, stornoEntry } from '../src/core/cashbook.js'
import { checksumOf, finalize, intact, stornoDraft, totals } from '../src/core/invoicing.js'
import {
  addRechargeLines,
  markupDefault,
  openRecharges,
  rechargeAmount,
  rechargeConflicts,
  rechargeLine,
  rechargeList,
  rechargeProblems,
  rechargeSources,
  rechargeState,
  removeRecharge,
  reopenRecharge,
  setRecharge,
  syncBilled,
  withoutSource,
} from '../src/core/recharge.js'

const SETTINGS = { sender: { name: 'Gebäudereinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' } }
const customer = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH' }
const rcCustomer = { id: 'c3', name: 'Reinigung Partner Beispiel GmbH' }

function purchase() {
  return {
    suppliers: [],
    invoices: [
      { id: 'er1', no: 'ER-2026-0001', supplier: { name: 'Hygiene-Großhandel Beispiel GmbH' }, number: 'RE-4410', date: '2026-10-05', text: '12 Kanister Allzweckreiniger', groups: [{ rate: 20, net: 412.5, vat: 82.5 }], objectId: 'o5' },
      { id: 'er2', no: 'ER-2026-0002', supplier: { name: 'Glasreinigung Partner Beispiel KG' }, number: 'GR-118', date: '2026-10-20', text: 'Glasreinigung Gewerbepark', groups: [{ rate: 20, net: 1280, vat: 0 }], reverseCharge: true },
      { id: 'er3', no: 'ER-2026-0003', supplier: { name: 'Papier & Co' }, number: '9', date: '2026-10-21', groups: [{ rate: 20, net: 50, vat: 10 }], cancelled: { at: '2026-10-22', by: 'x', reason: 'doppelt' } },
    ],
  }
}
const draftFor = (c, extra = {}) => ({ id: 'd1', kind: 'rechnung', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', customerId: c.id, recipient: { name: c.name, address: 'Ringstraße 3\n5020 Salzburg', uid: 'ATU87654321' }, lines: [{ id: 'l0', text: '', qty: 1, unit: 'Pauschale', price: '', vat: 20 }], ...extra })
let n = 0
const newId = () => `l${++n}`

test('Weiterverrechnung: Aufschlag aus den Einstellungen, sonst 10 %', () => {
  assert.equal(markupDefault({}), 10)
  assert.equal(markupDefault({ rechargeMarkup: 15 }), 15)
  assert.equal(markupDefault({ rechargeMarkup: '12,5' }), 12.5)
  assert.equal(markupDefault({ rechargeMarkup: 0 }), 0)
  assert.equal(markupDefault(null), 10)
})

test('Weiterverrechnung: Quellen aus Einkauf und Kassenbuch (ohne Storno, ohne Bezahlung einer Eingangsrechnung)', () => {
  const book = emptyCashbook()
  const o = (id, date) => ({ newId: () => id, now: `${date}T08:00:00Z`, today: date })
  addEntry(book, { date: '2026-10-01', kind: 'einnahme', amount: 300, text: 'Anfang', type: 'anfang' }, o('k0', '2026-10-01'))
  addEntry(book, { date: '2026-10-02', kind: 'ausgabe', amount: 23.9, rate: 20, text: 'Glasreiniger Baumarkt', receipt: 'Bon 1187' }, o('k1', '2026-10-02'))
  addEntry(book, { date: '2026-10-03', kind: 'ausgabe', amount: 58.4, text: 'Zahlung Tankstelle', ref: { type: 'eingang', id: 'er5', number: 'ER-5' } }, o('k2', '2026-10-03'))
  const wrong = addEntry(book, { date: '2026-10-04', kind: 'ausgabe', amount: 99, text: 'vertippt' }, o('k3', '2026-10-04'))
  stornoEntry(book, wrong.id, { reason: 'vertippt' }, o('k4', '2026-10-04'))
  const list = rechargeSources({ purchase: purchase(), cash: book })
  assert.deepEqual(list.map((s) => `${s.type}:${s.id}`), ['einkauf:er1', 'einkauf:er2', 'kasse:k1'])
  const k1 = list.find((s) => s.id === 'k1')
  assert.equal(k1.net, 19.92)
  assert.equal(k1.ref, 'Kassenbuch Nr. 2')
  assert.equal(list.find((s) => s.id === 'er1').net, 412.5)
  assert.deepEqual(rechargeSources({}), [])
})

test('Weiterverrechnung: setzen, prüfen, „nicht verrechnen“, wieder öffnen, entfernen', () => {
  const p = purchase()
  const inv = p.invoices[0]
  assert.deepEqual(rechargeProblems({ customerId: '', amount: 0 }), ['Bitte den Kunden wählen.', 'Bitte die Kosten (netto) über 0 eingeben.'])
  assert.match(rechargeProblems({ customerId: 'c1', amount: 500 }, 412.5)[0], /höher als der Beleg netto \(412,50 €\)/)
  assert.deepEqual(rechargeProblems({ status: 'nicht' }), ['Bitte den Grund angeben, warum nicht verrechnet wird.'])
  assert.throws(() => setRecharge(inv, { customerId: '', amount: 10 }), /Kunden wählen/)
  setRecharge(inv, { customerId: 'c1', amount: '412,50', markup: 10, text: 'Reinigungsmittel Wohnanlage', objectId: 'o5' }, { net: 412.5, customerName: customer.name, by: 'Petra', at: '2026-10-06T10:00:00Z' })
  assert.deepEqual(inv.recharge, { customerId: 'c1', customer: 'Hausverwaltung Beispiel GmbH', objectId: 'o5', amount: 412.5, markup: 10, text: 'Reinigungsmittel Wohnanlage', status: 'offen', by: 'Petra', at: '2026-10-06T10:00:00Z' })
  assert.deepEqual(rechargeAmount(inv.recharge), { cost: 412.5, markup: 10, net: 453.75 })
  const src = () => rechargeSources({ purchase: p }).find((s) => s.id === 'er1')
  assert.deepEqual(rechargeState(src(), []), { state: 'offen' })
  // nicht verrechnen (mit Grund), dann wieder offen: Kunde und Betrag bleiben
  assert.throws(() => setRecharge(inv, { status: 'nicht', reason: '' }), /Grund/)
  setRecharge(inv, { status: 'nicht', reason: 'im Pauschalpreis enthalten' }, { by: 'Petra' })
  assert.deepEqual(rechargeState(src(), []), { state: 'nicht' })
  assert.equal(inv.recharge.customerId, 'c1')
  assert.equal(openRecharges({ purchase: p, docs: [] }).length, 0)
  assert.ok(reopenRecharge(inv, { by: 'Petra' }))
  assert.equal(inv.recharge.status, 'offen')
  assert.equal(inv.recharge.reason, undefined)
  assert.ok(!reopenRecharge(inv))
  assert.equal(openRecharges({ purchase: p, docs: [] }).length, 1)
  // Teilbetrag
  setRecharge(inv, { customerId: 'c1', amount: 100, markup: 0 }, { net: 412.5 })
  assert.deepEqual(rechargeAmount(inv.recharge), { cost: 100, markup: 0, net: 100 })
  assert.ok(removeRecharge(inv))
  assert.equal(inv.recharge, undefined)
  assert.ok(!removeRecharge(inv))
  // „nicht verrechnen“ ohne Kunden, dann wieder offen: nichts mehr eingetragen (neu anlegen)
  setRecharge(inv, { status: 'nicht', reason: 'Kulanz' })
  assert.deepEqual(rechargeState(src(), []), { state: 'nicht' })
  assert.ok(reopenRecharge(inv))
  assert.equal(inv.recharge, undefined)
  assert.equal(rechargeState(src(), []), null)
})

test('Weiterverrechnung: offen → im Entwurf → verrechnet (Festschreiben), Position mit Aufschlag und Bezug', () => {
  const p = purchase()
  setRecharge(p.invoices[0], { customerId: 'c1', amount: 412.5, markup: 10 }, { customerName: customer.name })
  setRecharge(p.invoices[1], { customerId: 'c3', amount: 1280, markup: 10, text: 'Glasreinigung lt. Auftrag' }, { customerName: rcCustomer.name })
  const docs = []
  const open = openRecharges({ purchase: p, docs, customerId: 'c1' })
  assert.deepEqual(open.map((x) => x.id), ['er1'])
  const draft = draftFor(customer)
  assert.equal(addRechargeLines(draft, open, { newId, vat: 20 }), 1)
  // die leere Position wird ersetzt, nicht doppelt
  assert.equal(draft.lines.length, 1)
  assert.equal(addRechargeLines(draft, open, { newId }), 0)
  const line = draft.lines[0]
  assert.deepEqual(line.source, { type: 'einkauf', id: 'er1' })
  assert.equal(line.price, 453.75)
  assert.equal(line.text, '12 Kanister Allzweckreiniger')
  assert.equal(line.longText, 'Hygiene-Großhandel Beispiel GmbH, Rechnung RE-4410 vom 05.10.2026')
  docs.push(draft)
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], docs).state, 'entwurf')
  assert.equal(openRecharges({ purchase: p, docs, customerId: 'c1' }).length, 0)
  // im Entwurf: nicht mehr ändern
  assert.throws(() => setRecharge(p.invoices[0], { customerId: 'c1', amount: 1 }, { state: 'entwurf' }), /Rechnungsentwurf/)
  assert.throws(() => removeRecharge(p.invoices[0], { state: 'entwurf' }), /Rechnungsentwurf/)
  // Festschreiben: Umsatzsteuer nach der normalen Logik der Rechnung (20 %), Bezug in der Prüfsumme
  const fixed = finalize(draft, docs, SETTINGS, { now: '2026-11-03T09:00:00Z', by: 'Petra' })
  assert.equal(fixed.total.net, 453.75)
  assert.equal(fixed.total.vat, 90.75)
  assert.ok(intact(fixed))
  assert.notEqual(checksumOf({ ...fixed, lines: withoutSource(fixed.lines) }), fixed.checksum, 'source zählt zur Prüfsumme')
  docs[0] = fixed
  const st = rechargeState(rechargeSources({ purchase: p })[0], docs)
  assert.deepEqual(st, { state: 'verrechnet', docId: 'd1', number: 'RE-2026-0001', date: '2026-11-03' })
  assert.throws(() => setRecharge(p.invoices[0], { customerId: 'c1', amount: 1 }, { state: 'verrechnet' }), /Storno/)
  const all = rechargeList({ purchase: p, docs })
  assert.deepEqual(all.map((x) => [x.id, x.state, x.doc?.number || '']), [['er2', 'offen', ''], ['er1', 'verrechnet', 'RE-2026-0001']])
})

test('Weiterverrechnung: Reverse-Charge-Kunde – keine Umsatzsteuer, die Rechnung entscheidet (nicht der Einkauf)', () => {
  const p = purchase()
  setRecharge(p.invoices[1], { customerId: 'c3', amount: 1280, markup: 10 }, { customerName: rcCustomer.name })
  const draft = draftFor(rcCustomer, { reverseCharge: true })
  addRechargeLines(draft, openRecharges({ purchase: p, docs: [], customerId: 'c3' }), { newId, vat: 20 })
  const t = totals(draft, SETTINGS)
  assert.equal(t.net, 1408)
  assert.equal(t.vat, 0)
  assert.equal(t.gross, 1408)
})

test('Weiterverrechnung: Storno der Rechnung → wieder offen; gelöschter Entwurf gibt frei; Korrektur ändert nichts', () => {
  const p = purchase()
  setRecharge(p.invoices[0], { customerId: 'c1', amount: 412.5, markup: 10 })
  const docs = []
  const draft = draftFor(customer)
  addRechargeLines(draft, openRecharges({ purchase: p, docs, customerId: 'c1' }), { newId })
  // Entwurf gelöscht: wieder offen
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], [draft]).state, 'entwurf')
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], []).state, 'offen')
  const fixed = finalize(draft, docs, SETTINGS, { now: '2026-11-03T09:00:00Z' })
  docs.push(fixed)
  // Korrektur (Preisminderung) ändert nichts
  docs.push({ id: 'k1', kind: 'korrektur', number: 'KO-2026-0001', refId: 'd1', date: '2026-11-05', lines: [] })
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], docs).state, 'verrechnet')
  // Storno als Entwurf: noch verrechnet; festgeschrieben: wieder offen
  const sd = stornoDraft(fixed, { id: 's1', date: '2026-11-06', reason: 'falscher Empfänger' })
  assert.deepEqual(sd.lines[0].source, { type: 'einkauf', id: 'er1' }, 'Storno zeigt den Bezug')
  docs.push(sd)
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], docs).state, 'verrechnet')
  docs[docs.length - 1] = finalize(sd, docs, SETTINGS, { now: '2026-11-06T09:00:00Z' })
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], docs).state, 'offen')
  assert.equal(openRecharges({ purchase: p, docs, customerId: 'c1' }).length, 1)
  // neu verrechnen geht, das stornierte bleibt unverändert
  const again = draftFor(customer, { id: 'd2' })
  assert.equal(addRechargeLines(again, openRecharges({ purchase: p, docs, customerId: 'c1' }), { newId }), 1)
  assert.deepEqual(rechargeConflicts(again, docs, rechargeSources({ purchase: p })), [])
  docs.push(finalize(again, docs, SETTINGS, { now: '2026-11-07T09:00:00Z' }))
  assert.deepEqual(rechargeState(rechargeSources({ purchase: p })[0], docs), { state: 'verrechnet', docId: 'd2', number: 'RE-2026-0002', date: '2026-11-03' })
  assert.ok(intact(docs[0]), 'stornierte Rechnung unverändert')
})

test('Weiterverrechnung: Prüfung vor dem Festschreiben (doppelt, nicht verrechnen, anderer Kunde, entfernt)', () => {
  const p = purchase()
  setRecharge(p.invoices[0], { customerId: 'c1', amount: 412.5, markup: 10 }, { customerName: customer.name })
  const a = draftFor(customer, { id: 'a' })
  const b = draftFor(customer, { id: 'b' })
  const src = rechargeSources({ purchase: p })
  addRechargeLines(a, src.filter((s) => s.id === 'er1'), { newId })
  addRechargeLines(b, src.filter((s) => s.id === 'er1'), { newId })
  const docs = [finalize(a, [], SETTINGS, { now: '2026-11-03T09:00:00Z' }), b]
  assert.match(rechargeConflicts(b, docs, src)[0], /ER-2026-0001 ist schon mit RE-2026-0001 verrechnet/)
  assert.match(rechargeConflicts(b, docs, null)[0], /schon mit RE-2026-0001 verrechnet/, 'auch ohne Recht auf den Einkauf')
  const other = draftFor(rcCustomer, { id: 'c' })
  addRechargeLines(other, src.filter((s) => s.id === 'er1'), { newId })
  assert.match(rechargeConflicts(other, [other], src)[0], /anderen Kunden \(Hausverwaltung Beispiel GmbH\)/)
  setRecharge(p.invoices[0], { status: 'nicht', reason: 'Kulanz' })
  assert.match(rechargeConflicts(other, [other], rechargeSources({ purchase: p }))[0], /nicht verrechnen/)
  delete p.invoices[0].recharge
  assert.match(rechargeConflicts(other, [other], rechargeSources({ purchase: p }))[0], /gibt es im Einkauf nicht mehr/)
  assert.throws(() => addRechargeLines({ kind: 'angebot', lines: [] }, src, { newId }), /Rechnung/)
})

test('Weiterverrechnung: Barausgabe aus dem Kassenbuch – Prüfsumme der Buchung bleibt', () => {
  const book = emptyCashbook()
  const o = (id, date) => ({ newId: () => id, now: `${date}T08:00:00Z`, today: date, by: 'Petra' })
  addEntry(book, { date: '2026-10-01', kind: 'einnahme', amount: 100, text: 'Anfang', type: 'anfang' }, o('k0', '2026-10-01'))
  const e = addEntry(book, { date: '2026-10-02', kind: 'ausgabe', amount: 36, rate: 20, text: 'Ersatzteil Staubsauger', receipt: 'Bon 7' }, o('k1', '2026-10-02'))
  const sum = e.checksum
  const closing = closeMonth(book, '2026-10', { now: '2026-11-02T08:00:00Z', today: '2026-11-02', newId: () => 'm1' })
  setRecharge(e, { customerId: 'c1', amount: 30, markup: 10 }, { net: 30, customerName: customer.name })
  assert.equal(cashChecksum(e), sum)
  assert.ok(closingIntact(book, closing), 'Monatsabschluss bleibt gültig')
  const [src] = openRecharges({ cash: book, docs: [] })
  assert.equal(src.type, 'kasse')
  const line = rechargeLine(src, { id: 'x', vat: 20 })
  assert.deepEqual(line, { id: 'x', text: 'Ersatzteil Staubsauger', longText: 'Beleg Bon 7, Kassenbuch Nr. 2 vom 02.10.2026', qty: 1, unit: 'Pauschale', price: 33, vat: 20, discount: 0, source: { type: 'kasse', id: 'k1' } })
})

test('Weiterverrechnung: Stand für Rollen ohne Fakturierung (billed) und Vorlage ohne Bezug', () => {
  const p = purchase()
  setRecharge(p.invoices[0], { customerId: 'c1', amount: 412.5, markup: 10 })
  const draft = draftFor(customer)
  addRechargeLines(draft, openRecharges({ purchase: p, docs: [] }), { newId })
  const docs = [finalize(draft, [], SETTINGS, { now: '2026-11-03T09:00:00Z' })]
  assert.equal(syncBilled({ purchase: p, docs }), 1)
  assert.deepEqual(p.invoices[0].recharge.billed, { docId: 'd1', number: 'RE-2026-0001', date: '2026-11-03' })
  assert.equal(syncBilled({ purchase: p, docs }), 0, 'nichts doppelt')
  // ohne Fakturierung (docs null): Stand aus billed
  assert.deepEqual(rechargeState(rechargeSources({ purchase: p })[0], null), { state: 'verrechnet', docId: 'd1', number: 'RE-2026-0001', date: '2026-11-03' })
  // Storno: billed wird wieder entfernt
  docs.push(finalize(stornoDraft(docs[0], { id: 's1', date: '2026-11-04' }), docs, SETTINGS, { now: '2026-11-04T09:00:00Z' }))
  assert.equal(syncBilled({ purchase: p, docs }), 1)
  assert.equal(p.invoices[0].recharge.billed, undefined)
  assert.equal(rechargeState(rechargeSources({ purchase: p })[0], null).state, 'offen')
  // Vorlage kopieren: Bezug weg, damit nichts doppelt verrechnet wird
  const copy = withoutSource(docs[0].lines)
  assert.equal(copy[0].source, undefined)
  assert.equal(copy[0].price, 453.75)
  assert.deepEqual(docs[0].lines[0].source, { type: 'einkauf', id: 'er1' }, 'Original unverändert')
})
