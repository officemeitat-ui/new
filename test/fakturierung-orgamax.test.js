// Fakturierung wie in orgaMAX: Platzhalter, Textbausteine, Zahlungsbedingungen mit Skonto (offene Posten,
// Bankabgleich, Export), Kunden (Suche, Verlauf), Artikel (Nummer, Rohertrag), Anschrift zerlegen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyAllocation, suggest, undoAllocation } from '../src/core/bank.js'
import {
  articleMargin,
  blocksFor,
  cashPaidOf,
  checksumOf,
  correctionDraft,
  customerCity,
  customerHistory,
  customerMatches,
  defaultBlock,
  defaultTexts,
  exportRows,
  fillPlaceholders,
  finalize,
  findArticle,
  greetingOf,
  intact,
  invoiceMailText,
  lineFromArticle,
  openAmount,
  openItems,
  parseAddress,
  paymentEntries,
  placeholderContext,
  reminderMailText,
  resolveTexts,
  runRecurring,
  skontoAvailable,
  skontoOf,
  skontoSplit,
  skontoTaken,
  stateOf,
  termsLabel,
  termsSetup,
  termsTextOf,
  unknownPlaceholders,
} from '../src/core/invoicing.js'
import { invoiceDocument, reminderDocument } from '../src/export/invoice-pdf.js'

const IBAN = 'AT611904300234573201'
const settings = { sender: { name: 'Glanzwerk Reinigung GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: IBAN, bic: 'BKAUATWW', name: 'Bank Beispiel' }, paymentDays: 14 }
const recipient = { name: 'Hausverwaltung Muster GmbH', address: 'Platz 2\n5020 Salzburg', uid: 'ATU87654321', customerNo: '10001' }
const draft = (extra = {}) => ({ id: 'd1', kind: 'rechnung', status: 'entwurf', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', recipient, lines: [{ id: 'l1', text: 'Unterhaltsreinigung Oktober', qty: 1, unit: 'Monat', price: 1000, vat: 20 }], ...extra })
const fin = (extra = {}, docs = [], opts = {}) => finalize(draft(extra), docs, settings, { now: '2026-11-03T10:00:00Z', by: 'Büro', ...opts })
const pdfText = (dd) => JSON.stringify(dd.content)

// ---------------------------------------------------------------- Platzhalter

test('Platzhalter: ersetzt, Groß-/Kleinschreibung und ae/ä egal, unbekannte bleiben, bekannte ohne Wert werden leer', () => {
  const ctx = { Kunde: 'HV Muster', 'Fällig': '17.11.2026', Ansprechpartner: '' }
  assert.equal(fillPlaceholders('Liebe {kunde}, fällig {Fällig} bzw. {Faellig}.', ctx), 'Liebe HV Muster, fällig 17.11.2026 bzw. 17.11.2026.')
  assert.equal(fillPlaceholders('z. H. {Ansprechpartner}', ctx), 'z. H. ')
  assert.equal(fillPlaceholders('{Kundee} und {Kunde}', ctx), '{Kundee} und HV Muster')
  assert.equal(fillPlaceholders('ohne Klammern', ctx), 'ohne Klammern')
  assert.equal(fillPlaceholders(undefined, ctx), '')
  assert.deepEqual(unknownPlaceholders('{Anrede}, {Kundee} {Fällig} {faellig} {Betrag}'), ['{Kundee}'])
})

test('Anrede: Herr und Frau mit Titel, Familie, sonst „Sehr geehrte Damen und Herren“', () => {
  assert.equal(greetingOf({ salutation: 'Herr', lastName: 'Maier' }), 'Sehr geehrter Herr Maier')
  assert.equal(greetingOf({ salutation: 'Frau', title: 'Dr.', lastName: 'Huber' }), 'Sehr geehrte Frau Dr. Huber')
  assert.equal(greetingOf({ salutation: 'Hr.', lastName: 'Gruber' }), 'Sehr geehrter Herr Gruber')
  assert.equal(greetingOf({ salutation: 'Familie', firstName: 'Anna', lastName: 'Berger' }), 'Sehr geehrte Familie Berger')
  assert.equal(greetingOf({ salutation: 'Firma', lastName: 'Maier' }), 'Sehr geehrte Damen und Herren')
  assert.equal(greetingOf({ salutation: 'Herr' }), 'Sehr geehrte Damen und Herren')
  assert.equal(greetingOf(null), 'Sehr geehrte Damen und Herren')
})

test('Platzhalter im Beleg: Werte aus Beleg, Kunde und Einstellungen', () => {
  const doc = { ...draft({ number: 'RE-2026-0007', contactName: 'Frau Mag. Huber', reference: 'PO-4711', objectName: 'Wohnanlage Lehen', title: 'Oktober' }), total: { net: 1000, vat: 200, gross: 1200, groups: [] } }
  const ctx = placeholderContext({ doc, customer: { salutation: 'Frau', lastName: 'Huber' }, settings, user: 'Büro', open: 300, today: '2026-11-05' })
  assert.equal(ctx.Anrede, 'Sehr geehrte Frau Huber')
  assert.equal(ctx.Kunde, 'Hausverwaltung Muster GmbH')
  assert.equal(ctx.Ansprechpartner, 'Frau Mag. Huber')
  assert.equal(ctx.Belegnummer, 'RE-2026-0007')
  assert.equal(ctx.Belegart, 'Rechnung')
  assert.equal(ctx['Fällig'], '17.11.2026')
  assert.match(ctx.Betrag, /^€\s1\.200,00$/)
  assert.match(ctx.Offen, /^€\s300,00$/)
  assert.equal(ctx.Zeitraum, 'Oktober 2026')
  assert.equal(ctx.Referenz, 'PO-4711')
  assert.equal(ctx.Objekt, 'Wohnanlage Lehen')
  assert.equal(ctx.Firma, 'Glanzwerk Reinigung GmbH')
  assert.equal(ctx.IBAN, 'AT61 1904 3002 3457 3201')
  assert.equal(ctx.Heute, '05.11.2026')
  assert.equal(ctx.Skonto, '')
})

test('Festschreiben löst Platzhalter auf (Nummer, Betrag, Anrede) und schützt das Ergebnis mit der Prüfsumme', () => {
  const inv = fin({ title: 'Reinigung {Zeitraum}', intro: '{Anrede},\nfür {Zeitraum} verrechnen wir {Betrag}.', outro: 'Rechnung {Belegnummer}, zahlbar bis {Fällig}. {Unbekannt}' }, [], { customer: { salutation: 'Herr', lastName: 'Maier' } })
  assert.equal(inv.title, 'Reinigung Oktober 2026')
  assert.match(inv.intro, /^Sehr geehrter Herr Maier,\nfür Oktober 2026 verrechnen wir €\s1\.200,00\.$/)
  assert.equal(inv.outro, 'Rechnung RE-2026-0001, zahlbar bis 17.11.2026. {Unbekannt}')
  assert.ok(intact(inv))
  assert.ok(!intact({ ...inv, intro: 'geändert' }))
  // ohne Platzhalter: Felder wie bisher, keine neuen Felder
  const plain = fin({ intro: 'Danke.', outro: '' })
  assert.equal(plain.intro, 'Danke.')
  assert.equal('termsText' in plain, false)
  assert.equal('skonto' in plain, false)
})

test('Prüfsumme: alte Belege ohne neue Felder bleiben gültig, gesetzte neue Felder sind geschützt', () => {
  const inv = fin({ reference: 'PO-1', deliveryAddress: 'Straße 7\n5020 Salzburg', skonto: { percent: 2, days: 7 } })
  assert.ok(intact(inv))
  for (const k of ['reference', 'deliveryAddress', 'termsText']) assert.ok(!intact({ ...inv, [k]: 'anders' }), k)
  assert.ok(!intact({ ...inv, skonto: { percent: 3, days: 7 } }))
  // Prüfsumme eines Belegs ohne die neuen Felder: unverändert gegenüber vorher (leere Felder zählen nicht)
  const old = fin()
  assert.equal(checksumOf({ ...old, reference: '', deliveryAddress: null }), old.checksum)
})

// ---------------------------------------------------------------- Textbausteine

const blocks = [
  { id: 'b1', name: 'Rechnung Standard', kind: 'rechnung', place: 'intro', text: '{Anrede},\nwir verrechnen:', isDefault: true },
  { id: 'b2', name: 'Allgemein', kind: 'alle', place: 'intro', text: 'Allgemein', isDefault: true },
  { id: 'b3', name: 'Danke', kind: 'alle', place: 'outro', text: 'Danke für den Auftrag.' },
  { id: 'b4', name: 'Mahnung freundlich', kind: 'mahnung', place: 'reminder', text: 'Bitte zahlen Sie {Offen} bis {Frist}.', isDefault: true },
  { id: 'b5', name: 'E-Mail allgemein', kind: 'mail', place: 'mail', text: '{Anrede},\nanbei {Belegart} {Belegnummer}.' },
  { id: 'b6', name: 'Angebot Schluss', kind: 'angebot', place: 'outro', text: 'Wir freuen uns.', isDefault: true },
]

test('Textbausteine: eigene Belegart vor „alle“, Standard zuerst, Mahnung nur eigene, E-Mail auch allgemein', () => {
  assert.deepEqual(blocksFor(blocks, 'rechnung', 'intro').map((b) => b.id), ['b1', 'b2'])
  assert.deepEqual(blocksFor(blocks, 'angebot', 'intro').map((b) => b.id), ['b2'])
  assert.equal(defaultBlock(blocks, 'rechnung', 'intro').id, 'b1')
  assert.equal(defaultBlock(blocks, 'auftrag', 'intro').id, 'b2')
  assert.equal(defaultBlock(blocks, 'rechnung', 'outro'), null, 'b3 ist kein Standard')
  assert.deepEqual(blocksFor(blocks, 'mahnung', 'reminder').map((b) => b.id), ['b4'])
  assert.deepEqual(blocksFor(blocks, 'mahnung', 'intro'), [], '„alle“ gilt nicht für Mahnungen')
  assert.deepEqual(blocksFor(blocks, 'rechnung', 'mail').map((b) => b.id), ['b5'])
  assert.deepEqual(blocksFor([{ id: 'x', text: 'ohne Stelle', kind: 'rechnung' }], 'rechnung', 'intro').map((b) => b.id), ['x'], 'ohne Stelle: Einleitung')
})

test('Standardtexte: Textbaustein, sonst die Texte aus den Einstellungen (auch bei leerer Liste)', () => {
  assert.deepEqual(defaultTexts('rechnung', settings, blocks), { intro: '{Anrede},\nwir verrechnen:', outro: 'Vielen Dank für den Auftrag.' })
  assert.deepEqual(defaultTexts('angebot', settings, blocks), { intro: 'Allgemein', outro: 'Wir freuen uns.' })
  assert.deepEqual(defaultTexts('angebot', settings, []), { intro: 'Gerne bieten wir Ihnen an:', outro: 'Wir freuen uns auf Ihren Auftrag.' })
  assert.deepEqual(defaultTexts('rechnung', { intro: 'Eigene Einleitung' }), { intro: 'Eigene Einleitung', outro: 'Vielen Dank für den Auftrag.' })
})

test('E-Mail- und Mahntext: persönliche Anrede, sonst wie bisher', () => {
  const doc = { kind: 'rechnung', number: 'RE-2026-0001', total: { gross: 1200 }, dueDate: '2026-11-17' }
  assert.match(invoiceMailText({ doc, greeting: 'Sehr geehrter Herr Maier' }), /^Sehr geehrter Herr Maier,\n\nanbei/)
  assert.match(invoiceMailText({ doc }), /^Sehr geehrte Damen und Herren,/)
  const r = { level: 0, name: 'Zahlungserinnerung', open: 1200, interest: { amount: 0 }, fee: 0, total: 1200, deadline: '2026-12-01' }
  assert.match(reminderMailText({ doc: { ...doc, date: '2026-11-03' }, reminder: r, greeting: 'Sehr geehrte Frau Huber' }), /^Sehr geehrte Frau Huber,/)
  const pdf = pdfText(reminderDocument({ doc: { ...doc, date: '2026-11-03', recipient }, reminder: r, settings, today: '2026-11-24', text: 'Eigener Text mit 1.200 €.', greeting: 'Sehr geehrte Frau Huber' }))
  assert.match(pdf, /Sehr geehrte Frau Huber,/)
  assert.match(pdf, /Eigener Text mit 1\.200 €\./)
  assert.doesNotMatch(pdf, /Sicher ist sie Ihnen nur entgangen/)
})

// ---------------------------------------------------------------- Zahlungsbedingungen und Skonto

const terms = [
  { id: 't14', name: '14 Tage netto', days: 14, skontoPercent: 0, skontoDays: 0, text: '', isDefault: true },
  { id: 't30', name: '30 Tage, 7 Tage 2 %', days: 30, skontoPercent: 2, skontoDays: 7, text: '' },
  { id: 'tx', name: 'eigener Text', days: 21, skontoPercent: 3, skontoDays: 10, text: 'Zahlbar binnen 21 Tagen, mit Skonto binnen 10 Tagen.' },
  { id: 'tp', name: 'mit Platzhalter', days: 21, skontoPercent: 3, skontoDays: 10, text: 'Fällig {Fällig}; {Skonto}.' },
]

test('Zahlungsbedingung: Kunde, Zahlungsziel beim Kunden, Standard, Einstellungen', () => {
  assert.deepEqual(termsSetup({ termsId: 't30' }, terms, settings), { termsId: 't30', days: 30, skonto: { percent: 2, days: 7 } })
  assert.deepEqual(termsSetup({ paymentDays: 10 }, terms, settings), { termsId: 't14', days: 10, skonto: null })
  assert.deepEqual(termsSetup({ paymentDays: '' }, terms, settings), { termsId: 't14', days: 14, skonto: null })
  assert.deepEqual(termsSetup({ termsId: 'gelöscht' }, terms, settings).termsId, 't14')
  assert.deepEqual(termsSetup(null, [], { paymentDays: 21 }), { termsId: '', days: 21, skonto: null })
  assert.equal(termsLabel(terms[1]), '30 Tage netto, 7 Tage 2 % Skonto')
  assert.equal(termsLabel({ days: 0 }), 'sofort netto')
})

test('Skonto: Betrag und Frist vom Belegdatum, nur bei Rechnungen mit positivem Betrag', () => {
  const d = draft({ skonto: { percent: 2, days: 7 } })
  assert.deepEqual(skontoOf(d, settings), { percent: 2, days: 7, until: '2026-11-10', base: 1200, amount: 24, payable: 1176 })
  assert.equal(skontoOf({ ...d, kind: 'angebot' }, settings), null)
  assert.equal(skontoOf(draft({ skonto: { percent: 0, days: 7 } }), settings), null)
  assert.equal(skontoOf(draft(), settings), null)
})

test('Text der Zahlungsbedingung: mit Betrag und Datum; eigener Text mit Platzhaltern oder mit angehängtem Skonto', () => {
  const d = draft({ skonto: { percent: 2, days: 7 } })
  assert.match(termsTextOf(d, settings), /^Zahlbar binnen 14 Tagen netto \(bis 17\.11\.2026\), bei Zahlung binnen 7 Tagen \(bis 10\.11\.2026\) 2 % Skonto \(€\s24,00\), Zahlbetrag dann €\s1\.176,00\.$/)
  const d3 = draft({ skonto: { percent: 3, days: 10 } })
  assert.match(termsTextOf(d3, settings, terms[2]), /^Zahlbar binnen 21 Tagen, mit Skonto binnen 10 Tagen \(3 % Skonto €\s36,00 bei Zahlung bis 13\.11\.2026, Zahlbetrag dann €\s1\.164,00\)\.$/)
  assert.match(termsTextOf(d3, settings, terms[3]), /^Fällig 17\.11\.2026; 3 % Skonto \(€\s36,00\) bei Zahlung bis 13\.11\.2026\.$/)
  assert.equal(termsTextOf(draft(), settings), '', 'ohne Skonto und ohne eigenen Text: der übliche Satz bleibt')
  assert.equal(termsTextOf({ ...d, termsText: 'eingefroren' }, settings), 'eingefroren')
})

test('Festschreiben: Skonto und Zahlungstext eingefroren, 0 % fällt weg, Angebote ohne Skonto', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 }, termsId: 't30' })
  assert.deepEqual(inv.skonto, { percent: 2, days: 7 })
  assert.match(inv.termsText, /2 % Skonto \(€\s24,00\)/)
  assert.ok(intact(inv))
  assert.equal('skonto' in fin({ skonto: { percent: 0, days: 0 } }), false)
  const offer = finalize(draft({ kind: 'angebot', serviceFrom: '', skonto: { percent: 2, days: 7 } }), [], settings, { now: '2026-11-03T10:00:00Z' })
  assert.equal('skonto' in offer, false)
  assert.equal('termsText' in offer, false)
  // PDF: Skonto-Text statt „ohne Abzug“, Bankverbindung extra
  const pdf = pdfText(invoiceDocument({ doc: inv, settings }))
  assert.match(pdf, /Zahlbar binnen 14 Tagen netto/)
  assert.match(pdf, /Bankverbindung: Bank Beispiel, IBAN AT61 1904 3002 3457 3201/)
  assert.doesNotMatch(pdf, /ohne Abzug/)
})

test('Zahlung in der Skontofrist: brutto minus Skonto gilt als bezahlt, Skonto als eigener Eintrag', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  const docs = [inv]
  let n = 0
  const newId = () => `p${++n}`
  const entries = paymentEntries(inv, docs, settings, { date: '2026-11-09', amount: 1176, note: 'Bank' }, { newId })
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[1], { id: 'p2', date: '2026-11-09', amount: 24, kind: 'skonto', ref: 'p1', note: 'Skonto 2 % (Zahlung in der Skontofrist)' })
  inv.payments = entries
  assert.equal(openAmount(inv, docs, settings), 0)
  assert.equal(stateOf(inv, docs, '2026-11-20', settings), 'bezahlt')
  assert.equal(skontoTaken(inv), 24)
  assert.equal(cashPaidOf(inv), 1176)
  assert.equal(skontoAvailable(inv, docs, settings, '2026-11-09'), 0, 'nur einmal')
})

test('Skonto: nach der Frist, bei Teilzahlung oder storniert kein Abzug; 1 Cent Spielraum', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  const late = paymentEntries(inv, [inv], settings, { date: '2026-11-11', amount: 1176 })
  assert.equal(late.length, 1)
  assert.equal(openAmount({ ...inv, payments: late }, [inv], settings), 24)
  assert.equal(paymentEntries(inv, [inv], settings, { date: '2026-11-05', amount: 600 }).length, 1, 'Teilzahlung')
  assert.equal(paymentEntries(inv, [inv], settings, { date: '2026-11-10', amount: 1175.99 })[1].amount, 24.01, 'letzter Tag der Frist, 1 Cent weniger')
  assert.equal(paymentEntries(inv, [inv], settings, { date: '2026-11-10', amount: 1175.5 }).length, 1, 'zu wenig: kein Skonto')
  const st = { id: 's1', kind: 'storno', number: 'ST-2026-0001', refId: inv.id, total: { gross: -1200 } }
  assert.equal(skontoAvailable(inv, [inv, st], settings, '2026-11-05'), 0)
})

test('Skonto mit Rechnungskorrektur: Basis ist der korrigierte Betrag', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  const ko = finalize(correctionDraft(inv, { id: 'k1', date: '2026-11-04', amount: 100, vat: 20 }), [inv], settings, { now: '2026-11-04T10:00:00Z' })
  const docs = [inv, ko]
  assert.equal(openAmount(inv, docs, settings), 1080)
  assert.equal(skontoAvailable(inv, docs, settings, '2026-11-08'), 21.6)
  const e = paymentEntries(inv, docs, settings, { date: '2026-11-08', amount: 1058.4 })
  assert.equal(e[1].amount, 21.6)
})

test('Ohne Vermerk (z. B. übernommene Zahlung): Zahlung in der Frist deckt brutto minus Skonto → nichts offen', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  assert.equal(openAmount({ ...inv, payments: [{ id: 'a', date: '2026-11-08', amount: 1176 }] }, [inv], settings), 0)
  assert.equal(openAmount({ ...inv, payments: [{ id: 'a', date: '2026-11-12', amount: 1176 }] }, [inv], settings), 24, 'zu spät')
  assert.equal(openAmount({ ...inv, payments: [{ id: 'a', date: '2026-11-05', amount: 1000 }, { id: 'b', date: '2026-11-15', amount: 176 }] }, [inv], settings), 24, 'Rest erst nach der Frist')
  assert.equal(openAmount({ ...inv, payments: [{ id: 'a', date: '2026-11-08', amount: 1200 }] }, [inv], settings), 0, 'ganz bezahlt')
})

test('Offene Posten: Skonto solange die Frist läuft', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  assert.deepEqual(openItems([inv], '2026-11-06', settings)[0].skonto, { until: '2026-11-10', amount: 24, payable: 1176 })
  assert.equal(openItems([inv], '2026-11-11', settings)[0].skonto, null)
})

test('Skonto aufteilen: anteilig je Steuersatz, Summe genau, Reverse Charge ohne Steuer', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 }, lines: [{ text: 'A', qty: 1, price: 1000, vat: 20 }, { text: 'B', qty: 1, price: 100, vat: 10 }] })
  const parts = skontoSplit(inv, 26.2, settings)
  assert.deepEqual(parts.map((p) => p.rate), [20, 10])
  assert.equal(Math.round(parts.reduce((a, p) => a + p.gross, 0) * 100) / 100, 26.2)
  assert.deepEqual(parts[0], { rate: 20, gross: 24, net: 20, vat: 4 })
  assert.deepEqual(parts[1], { rate: 10, gross: 2.2, net: 2, vat: 0.2 })
  const rc = fin({ reverseCharge: true })
  assert.deepEqual(skontoSplit(rc, 20, settings), [{ rate: 0, gross: 20, net: 20, vat: 0 }])
})

test('Export: Skonto mit Zahlungsdatum als Erlösminderung (SK, negativ, je Steuersatz)', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  inv.payments = paymentEntries(inv, [inv], settings, { date: '2026-11-09', amount: 1176 })
  const rows = exportRows([inv], { from: '2026-11-01', to: '2026-11-30', settings: { ...settings, accounts: { skonto: '4400' } } })
  const sk = rows.find((r) => r.kindLabel === 'SK')
  assert.deepEqual([sk.number, sk.date, sk.account, sk.net, sk.vat, sk.gross], ['RE-2026-0001', '2026-11-09', '4400', -20, -4, -24])
  assert.match(sk.text, /^Skonto zu RE-2026-0001/)
  assert.equal(exportRows([inv], { from: '2026-12-01', to: '2026-12-31', settings }).length, 0, 'anderer Monat: weder Rechnung noch Skonto')
})

test('Bankabgleich: Eingang in der Skontofrist mit Abzug wird sicher erkannt und als bezahlt gebucht', () => {
  const inv = fin({ skonto: { percent: 2, days: 7 } })
  const docs = [inv]
  const tx = { id: 'tx1', date: '2026-11-09', amount: 1176, name: 'HV Muster', iban: '', text: 'RE-2026-0001', reference: '' }
  const s = suggest(tx, { docs, customers: [], settings })
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: inv.id, amount: 1176 }])
  assert.match(s.reasons.join(' '), /abzüglich Skonto/)
  // nach der Frist: Teilzahlung
  assert.match(suggest({ ...tx, date: '2026-11-12' }, { docs, customers: [], settings }).reasons.join(' '), /Teilzahlung/)
  applyAllocation(tx, s.allocations, docs, { by: 'Büro', settings })
  assert.equal(inv.payments.length, 2)
  assert.equal(inv.payments[1].kind, 'skonto')
  assert.equal(inv.payments[1].bank, 'tx1')
  assert.equal(openAmount(inv, docs, settings), 0)
  undoAllocation(tx, docs, { by: 'Büro' })
  assert.equal(inv.payments.length, 0, 'Lösen nimmt Zahlung und Skonto heraus')
  // ohne Nummer: Kunde über die IBAN, Betrag abzüglich Skonto
  const cust = [{ id: 'c1', name: 'Hausverwaltung Muster GmbH', ibans: ['AT483200000012345864'] }]
  const s2 = suggest({ ...tx, text: 'Danke', iban: 'AT48 3200 0000 1234 5864' }, { docs: [{ ...inv, customerId: 'c1', payments: [] }], customers: cust, settings })
  assert.equal(s2.level, 'sicher')
  assert.match(s2.reasons.join(' '), /abzüglich Skonto/)
})

test('Dauerauftrag: Standard-Textbaustein und Zahlungsbedingung des Kunden', () => {
  const doc = { settings, customers: [], documents: [], recurring: [{ id: 'r1', customerId: 'c1', title: 'Reinigung', interval: 'monat', startMonth: '2026-11', lines: [{ text: 'Pauschale', qty: 1, unit: 'Monat', price: 500, vat: 20 }] }], textBlocks: blocks, paymentTerms: terms, indexValues: {} }
  const customer = { id: 'c1', name: 'HV', address: 'Platz 2\n5020 Salzburg', termsId: 't30', deliveryAddress: 'Objekt 1\n5020 Salzburg' }
  const r = runRecurring(doc, '2026-11', { today: '2026-11-02', newId: () => 'n1', customersById: new Map([['c1', customer]]) })
  const x = r.created[0]
  assert.equal(x.intro, '{Anrede},\nwir verrechnen:')
  assert.equal(x.termsId, 't30')
  assert.deepEqual(x.skonto, { percent: 2, days: 7 })
  assert.equal(x.dueDate, '2026-12-02')
  assert.equal(x.deliveryAddress, 'Objekt 1\n5020 Salzburg')
})

test('Vorschau (Entwurf): Platzhalter aufgelöst, Langtext, Artikelnummer, Bestellnummer, Ansprechpartner, Leistungsort', () => {
  const d = draft({ intro: '{Anrede}, für {Zeitraum}:', reference: 'PO-4711', contactName: 'Frau Huber', deliveryAddress: 'Wohnanlage\nStraße 7\n5020 Salzburg', lines: [{ text: 'Reinigung', longText: 'Stiegenhaus und Keller', articleNo: 'UR-01', qty: 1, unit: 'Monat', price: 100, vat: 20 }] })
  const pdf = pdfText(invoiceDocument({ doc: d, settings, customer: { salutation: 'Frau', lastName: 'Huber' } }))
  assert.match(pdf, /Sehr geehrte Frau Huber, für Oktober 2026:/)
  assert.match(pdf, /Stiegenhaus und Keller/)
  assert.match(pdf, /Art\.-Nr\. UR-01/)
  assert.match(pdf, /"Ihre Bestellung"[^\]]*"PO-4711"/)
  assert.match(pdf, /"Ansprechpartner"[^\]]*"Frau Huber"/)
  assert.match(pdf, /Leistungsort: .*Wohnanlage, Straße 7, 5020 Salzburg/)
  assert.deepEqual(resolveTexts({ kind: 'angebot', intro: 'x' }, { settings }), { intro: 'x' })
})

// ---------------------------------------------------------------- Kunden und Artikel

const customers = [
  { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', customerNo: '10001', city: 'Salzburg', phone: '+43 662 123', contacts: [{ id: 'p1', name: 'Mag. Eva Huber', role: 'Buchhaltung', email: 'eva@hv.example' }], extra: { Branche: 'Immobilien' } },
  { id: 'c2', salutation: 'Herr', firstName: 'Karl', lastName: 'Maier', address: 'Gasse 1\n5071 Wals' },
]

test('Kundensuche über alle Felder: Ansprechpartner, übernommene Felder, Person, mehrere Wörter', () => {
  const find = (q) => customers.filter((c) => customerMatches(c, q)).map((c) => c.id)
  assert.deepEqual(find('huber'), ['c1'])
  assert.deepEqual(find('immobilien'), ['c1'])
  assert.deepEqual(find('karl maier'), ['c2'])
  assert.deepEqual(find('5071'), ['c2'])
  assert.deepEqual(find('662 123'), ['c1'])
  assert.deepEqual(find(''), ['c1', 'c2'])
  assert.equal(customerCity(customers[0]), 'Salzburg')
  assert.equal(customerCity(customers[1]), 'Wals')
})

test('Kundenverlauf: alle Belege mit Zustand, Umsatz je Jahr, offen', () => {
  const a = { ...fin({ id: 'a', customerId: 'c1', date: '2025-12-01', serviceFrom: '2025-11-01', serviceTo: '2025-11-30', dueDate: '2025-12-15' }), payments: [{ id: 'p', date: '2025-12-10', amount: 1200 }] }
  const b = { ...fin({ id: 'b', customerId: 'c1' }, [a]) }
  const draftDoc = { ...draft({ id: 'c', customerId: 'c1', date: '2026-11-04' }) }
  const other = fin({ id: 'o', customerId: 'c9' }, [a, b])
  const h = customerHistory([a, b, draftDoc, other], 'c1', { today: '2026-11-20', settings })
  assert.deepEqual(h.rows.map((r) => [r.doc.id, r.state]), [['c', 'entwurf'], ['b', 'ueberfaellig'], ['a', 'bezahlt']])
  assert.deepEqual(h.years, [{ year: '2026', net: 1000, count: 1 }, { year: '2025', net: 1000, count: 1 }])
  assert.equal(h.open, 1200)
  assert.deepEqual(customerHistory([a], '', { today: '2026-11-20', settings }).rows, [])
})

const articles = [
  { id: 'a1', articleNo: 'UR-01', name: 'Unterhaltsreinigung', unit: 'Monat', price: 980, cost: 700, vat: 20, longText: 'lt. Leistungsverzeichnis', group: 'Reinigung' },
  { id: 'a2', articleNo: 'GR-01', name: 'Grundreinigung', unit: 'm²', price: 2.9, vat: 20, group: 'Reinigung' },
  { id: 'a3', articleNo: 'ALT-9', name: 'Grundreinigung alt', unit: 'm²', price: 2.5, active: false },
]

test('Artikel: per Nummer, „Nr. – Name“, Name oder eindeutigem Teil; inaktive nicht; Rohertrag', () => {
  assert.equal(findArticle(articles, 'ur-01').id, 'a1')
  assert.equal(findArticle(articles, 'GR-01 – Grundreinigung').id, 'a2')
  assert.equal(findArticle(articles, 'grundreinigung').id, 'a2')
  assert.equal(findArticle(articles, 'unterhalt').id, 'a1')
  assert.equal(findArticle(articles, 'ALT-9'), null, 'inaktiv')
  assert.equal(findArticle(articles, 'reinigung'), null, 'nicht eindeutig')
  assert.deepEqual(articleMargin(articles[0]), { amount: 280, percent: 28.57 })
  assert.equal(articleMargin(articles[1]), null, 'ohne Einkaufspreis')
  assert.deepEqual(lineFromArticle(articles[0], { id: 'l1' }), { id: 'l1', text: 'Unterhaltsreinigung', longText: 'lt. Leistungsverzeichnis', articleNo: 'UR-01', qty: 1, unit: 'Monat', price: 980, vat: 20, discount: 0 })
})

test('Anschrift zerlegen: z. H., Länderpräfix, Land in der letzten Zeile, einzeilig mit Beistrich', () => {
  assert.deepEqual(parseAddress('z. H. Herr Mag. Maier\nRingstraße 3\n5020 Salzburg'), { street: 'Ringstraße 3', zip: '5020', city: 'Salzburg', country: 'AT', attention: 'Herr Mag. Maier', extra: [] })
  assert.deepEqual(parseAddress('Hauptstr. 1, D-80331 München'), { street: 'Hauptstr. 1', zip: '80331', city: 'München', country: 'DE', attention: '', extra: [] })
  assert.deepEqual(parseAddress('Bau GmbH\nWeg 2\n9490 Vaduz\nLiechtenstein'), { street: 'Weg 2', zip: '9490', city: 'Vaduz', country: 'LI', attention: '', extra: ['Bau GmbH'] })
  assert.equal(parseAddress('').city, '')
  assert.equal(parseAddress('nur Text ohne PLZ').street, 'nur Text ohne PLZ')
})
