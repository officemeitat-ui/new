import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  archivePath,
  checksumOf,
  convertDraft,
  correctionDraft,
  customerForObject,
  docFileName,
  epcPayload,
  exportCsv,
  exportRows,
  finalize,
  fnv1a,
  formatIban,
  ibanValid,
  indexAdjustment,
  intact,
  invoiceMailText,
  lateInterest,
  latestIndex,
  lineNet,
  nextCustomerNo,
  nextNumber,
  nextReminder,
  openAmount,
  openItems,
  parseNumber,
  periodLabel,
  periodOf,
  problems,
  recipientOf,
  reminderFileName,
  reminderFor,
  reminderMailText,
  resolveDuplicates,
  revenueByCustomer,
  round2,
  runRecurring,
  settingsOf,
  SMALL_BUSINESS_TEXT,
  stateOf,
  stornoDraft,
  totals,
} from '../src/core/invoicing.js'
import { invoiceDocument, reminderDocument } from '../src/export/invoice-pdf.js'

// Erfundene Beispieldaten (keine echten Firmen)
const IBAN = 'AT611904300234573201' // Beispiel-IBAN mit gültiger Prüfziffer
const sender = { name: 'Glanzwerk Reinigung GmbH', address: 'Beispielgasse 7\n5020 Salzburg', uid: 'ATU11122233' }
const settings = { sender, bank: { iban: IBAN, bic: 'BKAUATWW', name: 'Beispielbank' }, paymentDays: 14, baseRate: 1.53 }
const noUid = { ...settings, sender: { ...sender, uid: '' } }
const recipient = { name: 'Wohnbau Muster eGen', address: 'Teststraße 3\n5020 Salzburg', uid: 'ATU44455566' }
const draft = (extra = {}) => ({ id: 'd1', kind: 'rechnung', status: 'entwurf', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', recipient, lines: [{ id: 'l1', text: 'Unterhaltsreinigung Oktober', qty: 1, unit: 'Monat', price: 250, vat: 20 }], ...extra })
const line = (price, extra = {}) => ({ text: 'Grundreinigung', qty: 1, unit: 'Pauschale', price, vat: 20, ...extra })
const fin = (extra = {}, docs = [], s = settings) => finalize(draft(extra), docs, s, { now: '2026-11-03T10:00:00Z', by: 'Büro' })
const texts = (list, level) => list.filter((p) => !level || p.level === level).map((p) => p.text).join(' | ')

// ---------------------------------------------------------------- Beträge

for (const [input, expected] of [
  [0.285, 0.29],
  [-0.285, -0.29],
  [1.004, 1],
  [1234.5649, 1234.56],
  [2.345, 2.35],
  ['12.5', 12.5],
  [null, 0],
  ['abc', 0],
]) {
  test(`Rundung auf Cent: ${JSON.stringify(input)} → ${expected}`, () => {
    assert.equal(round2(input), expected)
  })
}

test('Zahleneingabe: österreichische und technische Schreibweise, Unsinn wird 0', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56)
  assert.equal(parseNumber('1234.56'), 1234.56)
  assert.equal(parseNumber(' 2 500,5 '), 2500.5)
  assert.equal(parseNumber('-3,5'), -3.5)
  assert.equal(parseNumber(''), 0)
  assert.equal(parseNumber(undefined), 0)
  assert.equal(parseNumber('zwölf'), 0)
  assert.equal(parseNumber(Infinity), 0)
  assert.equal(parseNumber(12), 12)
})

test('Positionsnetto: Menge × Preis − Positionsrabatt, auch mit Komma-Eingaben und negativer Menge', () => {
  assert.equal(lineNet({ qty: '2,5', price: '18,40', discount: 10 }), 41.4)
  assert.equal(lineNet({ qty: -2, price: 19.99 }), -39.98)
  assert.equal(lineNet({ qty: 3, price: 10, discount: 100 }), 0)
})

test('Summen: ohne Steuersatz an der Position gilt der Satz aus den Einstellungen, Gruppen absteigend nach Satz', () => {
  const t = totals(draft({ lines: [{ text: 'Reinigung', qty: 1, price: 100 }, { text: 'Fahrt', qty: 1, price: 50, vat: 20 }, { text: 'Buch', qty: 1, price: 10, vat: 10 }] }), { vat: 13 })
  assert.deepEqual(t.groups.map((g) => [g.rate, g.net, g.vat]), [[20, 50, 10], [13, 100, 13], [10, 10, 1]])
  assert.equal(t.gross, 184)
  assert.equal(t.vatOn, true)
})

test('Summen: ganz leere Zeilen zählen nicht, eine Zeile mit Preis ohne Text schon (und wird bemängelt)', () => {
  const d = draft({ lines: [line(100), { text: '   ', price: '' }, { text: '', qty: 1, price: 20, vat: 20 }] })
  const t = totals(d)
  assert.equal(t.lines.length, 2)
  assert.equal(t.net, 120)
  assert.match(texts(problems(d, settings), 'error'), /Eine Position hat keine Bezeichnung/)
})

test('Reverse Charge: alle Positionen in einer Gruppe zu 0 %, keine Steuer trotz verschiedener Sätze', () => {
  const t = totals(draft({ reverseCharge: true, lines: [line(100, { vat: 20 }), line(50, { vat: 10 })] }))
  assert.deepEqual(t.groups.map((g) => [g.rate, g.net, g.vat]), [[0, 150, 0]])
  assert.equal(t.gross, 150)
  assert.equal(t.vatOn, false)
})

// ---------------------------------------------------------------- § 11 UStG: Pflichtangaben

test('Kleinbetragsrechnung: genau 400,00 € brutto braucht keine eigene UID, 400,01 € schon', () => {
  const at = problems(draft({ lines: [line(333.33)] }), noUid)
  assert.equal(totals(draft({ lines: [line(333.33)] })).gross, 400)
  assert.equal(texts(at, 'error'), '')
  assert.match(texts(at, 'info'), /Kleinbetragsrechnung/)
  const over = problems(draft({ lines: [line(333.34)] }), noUid)
  assert.equal(totals(draft({ lines: [line(333.34)] })).gross, 400.01)
  assert.match(texts(over, 'error'), /UID-Nummer der eigenen Firma fehlt/)
  assert.doesNotMatch(texts(over), /Kleinbetragsrechnung/)
})

test('Kleinbetragsrechnung ohne Empfänger: nur Warnungen, Festschreiben gelingt', () => {
  const d = draft({ recipient: {}, lines: [line(120)] })
  const p = problems(d, settings)
  assert.deepEqual(p.filter((x) => x.level === 'warn').map((x) => x.text), ['Name des Empfängers fehlt.', 'Anschrift des Empfängers fehlt.'])
  assert.equal(fin({ recipient: {}, lines: [line(120)] }).number, 'RE-2026-0001')
})

test('Angebot ohne Empfänger ist ein Fehler, auch bei kleinem Betrag (keine Kleinbetragsrechnung)', () => {
  const p = problems(draft({ kind: 'angebot', serviceFrom: '', recipient: {}, lines: [line(50)] }), settings)
  assert.match(texts(p, 'error'), /Name des Empfängers fehlt/)
  assert.doesNotMatch(texts(p), /Kleinbetragsrechnung|Zeitraum der Leistung/)
})

test('UID des Empfängers: genau 10.000,00 € brutto noch ohne, 10.000,01 € nur mit UID', () => {
  const r = { ...recipient, uid: '' }
  assert.equal(totals(draft({ lines: [line(8333.33)] })).gross, 10000)
  assert.doesNotMatch(texts(problems(draft({ recipient: r, lines: [line(8333.33)] }), settings)), /10\.000/)
  assert.equal(totals(draft({ lines: [line(8333.34)] })).gross, 10000.01)
  assert.match(texts(problems(draft({ recipient: r, lines: [line(8333.34)] }), settings), 'error'), /Über 10\.000 € brutto/)
})

test('Reverse Charge ohne UIDs: beide fehlen gemeldet, die 10.000-€-Regel wird nicht doppelt geprüft', () => {
  const p = problems(draft({ reverseCharge: true, recipient: { ...recipient, uid: '' }, lines: [line(20000)] }), noUid)
  const err = texts(p, 'error')
  assert.match(err, /Reverse Charge: UID-Nummer des Empfängers fehlt/)
  assert.match(err, /Reverse Charge: eigene UID-Nummer fehlt/)
  assert.doesNotMatch(err, /Über 10\.000/)
})

test('Kleinunternehmer: keine Steuer, keine UID nötig, Hinweis auf der Rechnung, Steuercode KU im Export', () => {
  const ku = { ...noUid, smallBusiness: true }
  assert.equal(texts(problems(draft({ lines: [line(900)] }), ku), 'error'), '')
  const inv = finalize(draft({ lines: [line(900)] }), [], ku, { now: '2026-11-03T10:00:00Z' })
  assert.equal(inv.smallBusiness, true)
  assert.deepEqual([inv.total.vat, inv.total.gross], [0, 900])
  assert.match(JSON.stringify(invoiceDocument({ doc: inv, settings: ku }).content), new RegExp(SMALL_BUSINESS_TEXT.slice(0, 30)))
  const [row] = exportRows([inv], { from: '2026-11-01', to: '2026-11-30', settings: ku })
  assert.deepEqual([row.code, row.account, row.rate], ['KU', '4020', 0])
})

test('Prüfung: Zeitraum verkehrt, Fälligkeit vor Datum, Vorausrechnung, negative Rechnung, Storno ohne Bezug', () => {
  assert.match(texts(problems(draft({ serviceFrom: '2026-10-31', serviceTo: '2026-10-01' }), settings), 'error'), /„bis“ liegt vor „von“/)
  assert.match(texts(problems(draft({ dueDate: '2026-11-01' }), settings), 'warn'), /Fällig vor dem Rechnungsdatum/)
  assert.match(texts(problems(draft({ serviceFrom: '2026-12-01', serviceTo: '2026-12-31' }), settings), 'warn'), /Vorausrechnung/)
  assert.match(texts(problems(draft({ lines: [line(-100)] }), settings), 'error'), /negativem Betrag/)
  for (const kind of ['storno', 'korrektur']) assert.match(texts(problems(draft({ kind, lines: [line(-100)] }), settings), 'error'), /Bezug auf die ursprüngliche Rechnung fehlt/)
})

test('Festschreiben mit mehreren Fehlern: alle in einer Meldung, keine Nummer vergeben', () => {
  const d = draft({ date: '', lines: [] })
  assert.throws(() => finalize(d, [], settings), (err) => /Datum fehlt/.test(err.message) && /Keine Position/.test(err.message))
  assert.equal(d.number, undefined)
})

// ---------------------------------------------------------------- Festschreiben, Nummern, Prüfsumme

test('Festschreiben: Absender aus den Einstellungen eingefroren, Status, Verlauf und Prüfsumme', () => {
  const inv = fin()
  assert.equal(inv.status, 'fest')
  assert.deepEqual(inv.sender, { ...settingsOf({ settings }).sender })
  assert.equal(inv.finalizedBy, 'Büro')
  assert.deepEqual(inv.history.at(-1), { at: '2026-11-03T10:00:00Z', by: 'Büro', text: 'festgeschrieben als RE-2026-0001' })
  assert.equal(inv.checksum, checksumOf(inv))
  assert.deepEqual(inv.total, { net: 250, vat: 50, gross: 300, groups: [{ rate: 20, net: 250, vat: 50 }] })
  // spätere Änderung der Firmendaten ändert die festgeschriebene Rechnung nicht
  const pdf = JSON.stringify(invoiceDocument({ doc: inv, settings: { ...settings, sender: { ...sender, name: 'Neuer Name GmbH' } } }).content)
  assert.match(pdf, /Glanzwerk Reinigung GmbH/)
  assert.equal(fin({ id: 'an', kind: 'angebot', serviceFrom: '' }).status, 'offen')
})

test('Nummern: eigene Kürzel und Stellen, keine Lückenfüllung, Entwürfe und andere Belegarten zählen nicht', () => {
  const s = { ...settings, series: { rechnung: 'AR' }, digits: 5 }
  assert.equal(nextNumber([], 'rechnung', '2026', s).number, 'AR-2026-00001')
  const docs = [
    { kind: 'rechnung', number: 'RE-2026-0001', date: '2026-01-10' },
    { kind: 'rechnung', number: 'RE-2026-0005', date: '2026-03-10' },
    { kind: 'rechnung', date: '2026-04-10' },
    { kind: 'storno', number: 'ST-2026-0009', date: '2026-04-11' },
    { kind: 'rechnung', number: 'RE-2025-0042', date: '2025-12-30' },
  ]
  assert.deepEqual(nextNumber(docs, 'rechnung', '2026', settings), { number: 'RE-2026-0006', seq: 6 })
  assert.equal(nextNumber(docs, 'storno', '2026', settings).number, 'ST-2026-0010')
  assert.equal(nextNumber(docs, 'korrektur', '2026', settings).number, 'KO-2026-0001')
  assert.equal(nextNumber(docs, 'auftrag', '2026', settings).number, 'AB-2026-0001')
})

test('Nummern: das Jahr kommt aus dem Belegdatum, nicht aus dem Tag des Festschreibens', () => {
  const dec = fin({ id: 'a', date: '2026-12-31' })
  const jan = finalize(draft({ id: 'b', date: '2027-01-02', serviceFrom: '2026-12-01', serviceTo: '2026-12-31' }), [dec], settings, { now: '2026-12-31T23:00:00Z' })
  assert.deepEqual([dec.number, jan.number], ['RE-2026-0001', 'RE-2027-0001'])
  assert.equal(archivePath(jan), 'fakturierung/belege/2027/Rechnung_RE-2027-0001_Wohnbau-Muster-eGen.pdf')
})

test('Prüfsumme FNV-1a: bekannte Prüfwerte', () => {
  assert.equal(fnv1a(''), '811c9dc5')
  assert.equal(fnv1a('a'), 'e40c292c')
  assert.equal(fnv1a('foobar'), 'bf9cf968')
})

test('Prüfsumme: Pflichtfelder geschützt, Zahlungen/Mahnungen/Status nicht, Reihenfolge der Schlüssel egal', () => {
  const inv = fin()
  for (const change of [{ number: 'RE-2026-0099' }, { recipient: { ...recipient, name: 'Andere' } }, { total: { ...inv.total, gross: 1 } }, { dueDate: '2026-12-31' }, { reverseCharge: true }]) assert.equal(intact({ ...inv, ...change }), false, JSON.stringify(change))
  assert.equal(intact({ ...inv, status: 'bezahlt', reminders: [{ level: 0 }], payments: [{ amount: 1 }], history: [] }), true)
  const reordered = { ...inv, recipient: Object.fromEntries(Object.entries(inv.recipient).reverse()) }
  assert.equal(checksumOf(reordered), inv.checksum)
  assert.equal(intact(draft()), true, 'Entwurf ohne Nummer')
})

test('Doppelte Nummern: drei gleichzeitige Belege werden 0001, 0002, 0003; andere Belegart bleibt unberührt', () => {
  const mk = (id, at) => finalize(draft({ id }), [], settings, { now: at })
  const docs = [mk('c', '2026-11-03T10:00:09Z'), mk('a', '2026-11-03T10:00:01Z'), mk('b', '2026-11-03T10:00:05Z'), { ...finalize(stornoDraft(mk('x', '2026-11-03T09:00:00Z'), { id: 's', date: '2026-11-03' }), [], settings), number: 'RE-2026-0001' }]
  const r = resolveDuplicates(docs, settings, { now: '2026-11-04T08:00:00Z', by: 'Zusammenführung' })
  const byId = Object.fromEntries(r.docs.map((d) => [d.id, d.number]))
  assert.deepEqual([byId.a, byId.b, byId.c], ['RE-2026-0001', 'RE-2026-0002', 'RE-2026-0003'])
  assert.equal(byId.s, 'RE-2026-0001', 'Storno mit gleicher Nummer ist eine andere Serie')
  assert.deepEqual(r.renumbered.map((x) => x.id), ['b', 'c'])
  assert.match(r.docs.find((d) => d.id === 'c').history.at(-1).text, /Nummer RE-2026-0001 war doppelt vergeben, neu: RE-2026-0003/)
  assert.ok(r.docs.filter((d) => d.kind === 'rechnung').every(intact), 'neue Prüfsumme nach dem Umnummerieren')
  const none = resolveDuplicates([docs[0]], settings)
  assert.deepEqual([none.renumbered, none.conflicts], [[], []])
})

// ---------------------------------------------------------------- Storno, Korrektur, Umwandeln

test('Storno einer Rechnung mit Belegrabatt und zwei Steuersätzen ergibt genau den negativen Betrag', () => {
  const inv = fin({ discount: 3, lines: [{ text: 'a', qty: 3, price: 19.99, vat: 20, discount: 7 }, { text: 'b', qty: 1.5, price: 33.33, vat: 10 }] })
  const st = finalize(stornoDraft(inv, { id: 's1', date: '2026-11-04', reason: 'falscher Empfänger' }), [inv], settings)
  assert.equal(st.total.gross, -inv.total.gross)
  assert.deepEqual(st.total.groups.map((g) => [g.rate, g.net, g.vat]), inv.total.groups.map((g) => [g.rate, -g.net, -g.vat]))
  assert.equal(st.title, 'Storno zu Rechnung RE-2026-0001 vom 03.11.2026')
  assert.equal(st.intro, 'Grund: falscher Empfänger')
  assert.deepEqual([st.dueDate, st.refId, st.discount], ['2026-11-04', inv.id, 3])
})

test('Storno und Korrektur nur zu festgeschriebenen Rechnungen (nicht zu Angebot, Storno oder Entwurf)', () => {
  const offer = fin({ id: 'an', kind: 'angebot', serviceFrom: '' })
  const inv = fin()
  const st = finalize(stornoDraft(inv, { id: 's', date: '2026-11-04' }), [inv], settings)
  for (const src of [offer, st, draft()]) {
    assert.throws(() => stornoDraft(src, { id: 'x', date: '2026-11-05' }), /storniert werden/)
    assert.throws(() => correctionDraft(src, { id: 'x', date: '2026-11-05', amount: 10 }), /korrigiert werden/)
  }
})

test('Korrektur: negativer Eingabebetrag wird zur Gutschrift, Reverse Charge ohne Steuer, Belegrabatt fällt weg', () => {
  const inv = fin({ discount: 10 })
  const ko = correctionDraft(inv, { id: 'k1', date: '2026-11-06', amount: -50 })
  assert.deepEqual(ko.lines, [{ id: 'k1-1', text: 'Preisminderung', qty: -1, unit: 'Pauschale', price: 50, vat: 20, discount: 0 }])
  assert.equal(ko.discount, 0)
  assert.equal(totals(ko, settings).gross, -60)
  const rc = fin({ id: 'rc', reverseCharge: true })
  assert.equal(totals(correctionDraft(rc, { id: 'k2', date: '2026-11-06', amount: 50 }), settings).gross, -50)
})

test('Angebot → Auftragsbestätigung → Rechnung: Bezug je Stufe, neue Positions-IDs, Original unverändert', () => {
  const offer = fin({ id: 'an1', kind: 'angebot', serviceFrom: '', title: 'Unterhaltsreinigung Stiegenhaus' })
  const order = finalize(convertDraft(offer, 'auftrag', { id: 'ab1', date: '2026-11-05' }), [offer], settings)
  const invDraft = convertDraft(order, 'rechnung', { id: 're1', date: '2026-11-30' })
  assert.deepEqual([order.number, order.refNumber, invDraft.refNumber, invDraft.refId], ['AB-2026-0001', 'AN-2026-0001', 'AB-2026-0001', 'ab1'])
  assert.deepEqual(invDraft.lines.map((l) => l.id), ['re1-1'])
  assert.equal(offer.lines[0].id, 'l1')
  assert.equal(invDraft.title, 'Unterhaltsreinigung Stiegenhaus')
  invDraft.recipient.name = 'geändert'
  assert.equal(offer.recipient.name, recipient.name, 'Empfänger ist eine Kopie')
})

// ---------------------------------------------------------------- Zahlungen und offene Posten

test('Offener Betrag: nur festgeschriebene Korrekturen mindern, Angebote und Entwürfe haben keinen', () => {
  const inv = fin({ id: 'r1', payments: [{ amount: '100,50' }] })
  const koDraft = correctionDraft(inv, { id: 'k1', date: '2026-11-06', amount: 50 })
  assert.equal(openAmount(inv, [inv, koDraft], settings), 199.5)
  const ko = finalize(koDraft, [inv], settings)
  assert.equal(openAmount(inv, [inv, ko], settings), 139.5)
  assert.equal(openAmount(fin({ id: 'an', kind: 'angebot', serviceFrom: '' }), [], settings), 0)
  assert.equal(openAmount(draft(), [], settings), 0)
})

test('Zustand: Angebot angenommen/abgelehnt/abgelaufen/offen, Auftrag erledigt, Rechnung offen/teilbezahlt/überfällig/bezahlt', () => {
  const offer = fin({ id: 'an', kind: 'angebot', serviceFrom: '', validUntil: '2026-12-03' })
  assert.equal(stateOf(offer, [], '2026-11-10', settings), 'offen')
  assert.equal(stateOf(offer, [], '2026-12-04', settings), 'abgelaufen')
  assert.equal(stateOf({ ...offer, status: 'angenommen' }, [], '2026-12-04', settings), 'angenommen')
  assert.equal(stateOf({ ...offer, status: 'abgelehnt' }, [], '2026-11-10', settings), 'abgelehnt')
  assert.equal(stateOf(fin({ id: 'ab', kind: 'auftrag' }), [], '2026-11-10', settings), 'erledigt')
  const inv = fin()
  assert.equal(stateOf(inv, [inv], '2026-11-10', settings), 'offen')
  inv.payments = [{ amount: 100 }]
  assert.equal(stateOf(inv, [inv], '2026-11-17', settings), 'teilbezahlt', 'am Fälligkeitstag noch nicht überfällig')
  assert.equal(stateOf(inv, [inv], '2026-11-18', settings), 'ueberfaellig')
  inv.payments.push({ amount: 250 })
  assert.equal(stateOf(inv, [inv], '2026-11-18', settings), 'bezahlt', 'Überzahlung gilt als bezahlt')
  assert.equal(stateOf(draft(), [], '2026-11-18', settings), 'entwurf')
})

test('Offene Posten: ohne stornierte und bezahlte, nach Fälligkeit sortiert, mit Mahnstufe', () => {
  const a = fin({ id: 'a', dueDate: '2026-11-20' })
  const b = fin({ id: 'b', dueDate: '2026-10-15', date: '2026-10-01', serviceFrom: '2026-09-01', serviceTo: '2026-09-30', reminders: [{ level: 0, date: '2026-10-22', deadline: '2026-10-29' }] }, [a])
  const c = fin({ id: 'c', payments: [{ amount: 300 }] }, [a, b])
  const d = fin({ id: 'd' }, [a, b, c])
  const st = finalize(stornoDraft(d, { id: 's', date: '2026-11-04' }), [], settings)
  const items = openItems([a, b, c, d, st], '2026-11-12', settings)
  assert.deepEqual(items.map((x) => [x.doc.id, x.open, x.overdueDays, x.level]), [['b', 300, 28, 1], ['a', 300, 0, 0]])
  assert.equal(items[0].next.step.name, '1. Mahnung', '14 Tage nach der Frist der Zahlungserinnerung')
})

// ---------------------------------------------------------------- Mahnwesen

test('Mahnstufen: ohne Fälligkeit keine, nach der letzten Stufe keine weitere, eigene Stufen aus den Einstellungen', () => {
  const inv = fin({ dueDate: '' })
  assert.equal(nextReminder(inv, '2027-01-01', settings), null)
  const done = { ...fin(), reminders: [{ deadline: '2026-11-20' }, { deadline: '2026-12-01' }, { deadline: '2026-12-10' }] }
  assert.equal(nextReminder(done, '2027-06-01', settings), null)
  const own = { ...settings, reminders: [{ name: 'Letzte Mahnung', days: 30, interest: true, fee: true, deadline: 5 }] }
  assert.equal(nextReminder(fin(), '2026-12-16', own), null)
  assert.deepEqual(nextReminder(fin(), '2026-12-17', own), { level: 0, step: own.reminders[0], since: '2026-11-17' })
})

test('Verzugszinsen: Schaltjahr, eigener Basiszins, keine Zinsen rückwärts oder auf Guthaben', () => {
  assert.deepEqual(lateInterest({ amount: 1000, from: '2028-02-01', to: '2028-03-01', baseRate: 2 }), { days: 29, rate: 11.2, amount: 8.9 })
  assert.deepEqual(lateInterest({ amount: 1000, from: '2026-10-15', to: '2026-10-01' }), { days: 0, rate: 10.73, amount: 0 })
  assert.equal(lateInterest({ amount: -500, from: '2026-01-01', to: '2026-12-31' }).amount, 0)
  assert.equal(lateInterest({ amount: 1000, from: '', to: '2026-12-31' }).days, 0)
})

test('Mahnung: Zahlungserinnerung ohne Zinsen und Pauschale, Stufe über der letzten nimmt die letzte, Verbraucher 4 %', () => {
  const inv = fin({ id: 'm', date: '2026-09-01', serviceFrom: '2026-08-01', serviceTo: '2026-08-31', dueDate: '2026-09-15' })
  const r0 = reminderFor(inv, [inv], { today: '2026-09-22', settings, level: 0 })
  assert.deepEqual([r0.name, r0.interest.amount, r0.fee, r0.total, r0.deadline], ['Zahlungserinnerung', 0, 0, 300, '2026-09-29'])
  const r9 = reminderFor(inv, [inv], { today: '2026-11-14', settings, level: 9 })
  assert.equal(r9.name, '2. Mahnung')
  assert.equal(r9.interest.days, 60)
  const consumer = fin({ id: 'v', recipient: { ...recipient, consumer: true }, date: '2026-09-01', dueDate: '2026-09-15' })
  const rv = reminderFor(consumer, [consumer], { today: '2026-10-15', settings, level: 1 })
  assert.deepEqual([rv.interest.rate, rv.interest.amount, rv.fee], [4, 0.99, 0])
  assert.equal(rv.total, 300.99)
})

test('Mahnung als PDF und E-Mail: Verbraucher mit § 1000 ABGB, bereits bezahlter Teil ausgewiesen', () => {
  const inv = fin({ id: 'v', recipient: { ...recipient, consumer: true }, date: '2026-09-01', dueDate: '2026-09-15', payments: [{ amount: 100 }] })
  const r = reminderFor(inv, [inv], { today: '2026-10-15', settings, level: 1 })
  assert.equal(r.open, 200)
  const pdf = JSON.stringify(reminderDocument({ doc: inv, reminder: r, settings, today: '2026-10-15' }).content)
  assert.match(pdf, /bereits bezahlt bzw\. gutgeschrieben/)
  assert.match(pdf, /§ 1000 ABGB/)
  assert.doesNotMatch(pdf, /§ 458 UGB/)
  const mail = reminderMailText({ doc: inv, reminder: r, company: 'Glanzwerk Reinigung GmbH', sender: 'Büro' })
  assert.match(mail, /trotz unserer Erinnerung ist unsere Rechnung RE-2026-0001 vom 01\.09\.2026 noch offen/)
  assert.match(mail, /Verzugszinsen/)
  assert.doesNotMatch(mail, /Pauschale/)
  const first = reminderMailText({ doc: inv, reminder: { ...r, level: 0, interest: { amount: 0 }, fee: 0 } })
  assert.match(first, /Vielleicht ist sie Ihnen entgangen/)
})

// ---------------------------------------------------------------- Daueraufträge und Wertsicherung

test('Abrechnungszeitraum: halbjährlich, jährlich, Vertragsende kürzt, vor Beginn und nach Ende nichts', () => {
  const half = { interval: 'halbjahr', startMonth: '2026-01', endMonth: '2027-03' }
  assert.deepEqual(periodOf(half, '2026-07'), { from: '2026-07-01', to: '2026-12-31', ym: '2026-07' })
  assert.equal(periodOf(half, '2026-08'), null)
  assert.deepEqual(periodOf(half, '2027-01'), { from: '2027-01-01', to: '2027-03-31', ym: '2027-01' })
  assert.equal(periodOf(half, '2027-07'), null)
  assert.equal(periodOf(half, '2025-12'), null)
  assert.deepEqual(periodOf({ interval: 'jahr', startMonth: '2024-02' }, '2028-02'), { from: '2028-02-01', to: '2029-01-31', ym: '2028-02' })
  assert.deepEqual(periodOf({ interval: 'unbekannt', startMonth: '2026-01' }, '2026-02'), { from: '2026-02-01', to: '2026-02-28', ym: '2026-02' }, 'sonst monatlich')
  assert.equal(periodOf({ interval: 'monat' }, '2026-02'), null, 'ohne Beginn')
})

for (const [from, to, label] of [
  ['2026-11-01', '2027-01-31', 'November 2026 – Jänner 2027'],
  ['2026-02-01', '2026-02-28', 'Februar 2026'],
  ['2026-10-05', '2026-10-05', '05.10.2026'],
  ['2026-10-05', '2026-10-20', '05.10.2026 – 20.10.2026'],
  ['', '', ''],
]) {
  test(`Leistungszeitraum als Text: ${from || '(leer)'} bis ${to || '(leer)'} → „${label}“`, () => {
    assert.equal(periodLabel({ from, to }), label)
  })
}

test('Wertsicherung: ungültige Indexzahlen ändern nichts, Schwelle 0 passt jede Änderung an, nur Erhöhung', () => {
  assert.deepEqual(indexAdjustment({ price: 99.999, baseValue: 0, currentValue: 120 }), { change: 0, applies: false, price: 100, factor: 1 })
  assert.equal(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 120.1, threshold: 0 }).price, 1000.83)
  assert.equal(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 120, threshold: 0 }).applies, false, 'ohne Veränderung nichts')
  assert.equal(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 123.6, threshold: 3 }).applies, true, 'genau 3 % reicht')
  assert.deepEqual(indexAdjustment({ price: 1000, baseValue: 120, currentValue: 126, threshold: 3, onlyUp: true }).price, 1050)
  assert.deepEqual(latestIndex({ '2026-05': 0, '2026-06': 'x', '2026-07': 121 }, '2026-06'), null)
  assert.deepEqual(latestIndex({ '2026-05': 0, '2026-07': 121 }, '2026-12'), { ym: '2026-07', value: 121 })
})

test('Dauerauftrag: Reverse-Charge-Kunde, ohne Kunde Standardfrist, Index unter der Schwelle lässt die Basis stehen', () => {
  let n = 0
  const newId = () => `n${++n}`
  const rcCustomer = { id: 'c2', name: 'Bau Beispiel GmbH', address: 'Weg 1', uid: 'ATU99988877', reverseCharge: true }
  const doc = {
    settings,
    documents: [],
    recurring: [
      { id: 'r1', customerId: 'c2', interval: 'monat', startMonth: '2026-01', lines: [line(800, { text: 'Bauendreinigung laufend' })], index: { active: true, baseValue: 120, baseMonth: '2025-12', threshold: 5 } },
      { id: 'r2', customerId: 'fehlt', title: 'Fensterreinigung', interval: 'monat', startMonth: '2026-01', endMonth: '2026-09', lines: [line(100)] },
      { id: 'r3', interval: 'monat', startMonth: '2026-01', lines: [line(50)] },
    ],
    indexValues: { '2026-09': 124.2 },
  }
  const r = runRecurring(doc, '2026-10', { today: '2026-10-01', newId, customersById: new Map([['c2', rcCustomer]]) })
  assert.deepEqual(r.created.map((d) => d.source.recurringId), ['r1', 'r3'], 'r2 ist schon beendet')
  const rc = r.created[0]
  assert.equal(rc.reverseCharge, true)
  assert.equal(rc.recipient.uid, 'ATU99988877')
  assert.equal(rc.lines[0].price, 800, '+3,5 % liegt unter der Schwelle von 5 %')
  assert.equal(r.adjusted.length, 0)
  assert.equal(r.recurring[0].index.baseValue, 120)
  assert.equal(rc.title, 'Unterhaltsreinigung Oktober 2026')
  const plain = r.created[1]
  assert.deepEqual([plain.recipient, plain.dueDate, plain.reverseCharge], [{}, '2026-10-15', false])
  assert.equal(r.recurring[2].lastRun, '2026-10')
  assert.equal(r.recurring[1].lastRun, undefined)
})

test('Dauerauftrag: Wertsicherung „nur Erhöhung“ ignoriert gesunkenen Index, Verlauf bei Anpassung', () => {
  let n = 0
  const base = { id: 'r1', interval: 'monat', startMonth: '2026-01', lines: [line(1000)], index: { active: true, baseValue: 120, baseMonth: '2025-12', threshold: 3, onlyUp: true } }
  const down = runRecurring({ settings, documents: [], recurring: [base], indexValues: { '2026-09': 110 } }, '2026-10', { today: '2026-10-01', newId: () => `x${++n}` })
  assert.equal(down.created[0].lines[0].price, 1000)
  const up = runRecurring({ settings, documents: [], recurring: [base], indexValues: { '2026-09': 126 } }, '2026-10', { today: '2026-10-01', by: 'Büro', newId: () => `y${++n}` })
  assert.equal(up.created[0].lines[0].price, 1050)
  assert.match(up.recurring[0].history.at(-1).text, /Wertsicherung VPI 2020: 120 → 126 \(\+5 %\)/)
  assert.equal(up.recurring[0].index.baseMonth, '2026-09')
})

// ---------------------------------------------------------------- Auswertung und Export

test('Umsatz je Kunde: Storno mindert, offene Beträge summiert, absteigend nach Umsatz', () => {
  const a = fin({ id: 'a', customerId: 'c1' })
  const b = fin({ id: 'b', customerId: 'c1', lines: [line(1000)] }, [a])
  const st = finalize(stornoDraft(a, { id: 's', date: '2026-11-04' }), [a, b], settings)
  const other = fin({ id: 'o', customerId: 'c2', recipient: { ...recipient, name: 'Andere Hausverwaltung' }, lines: [line(400)] }, [a, b])
  const list = revenueByCustomer([a, b, st, other, draft({ id: 'e', customerId: 'c3' })], 2026, settings)
  assert.deepEqual(list.map((x) => [x.customerId, x.net, x.open, x.count]), [['c1', 1000, 1200, 2], ['c2', 400, 480, 1]])
})

test('Export: Zeitraum inklusive, Debitor aus Kunde oder Einstellungen, Buchungstext mit Bezug', () => {
  const a = fin({ id: 'a', date: '2026-11-01', customerId: 'c1' })
  const b = fin({ id: 'b', date: '2026-11-30', customerId: 'c2' }, [a])
  const late = fin({ id: 'c', date: '2026-12-01' }, [a, b])
  const st = finalize(stornoDraft(a, { id: 's', date: '2026-11-15' }), [a], settings)
  const walkIn = fin({ id: 'w', date: '2026-11-20' }, [a, b, late])
  const customersById = new Map([['c1', { account: '200100', customerNo: '10001' }], ['c2', { customerNo: '10002' }]])
  const rows = exportRows([late, b, st, a, walkIn], { from: '2026-11-01', to: '2026-11-30', settings: { ...settings, accounts: { debitor: '2000' } }, customersById })
  // Storno übernimmt den Kunden der Rechnung; ohne Kunde gilt das Sammelkonto aus den Einstellungen
  assert.deepEqual(rows.map((r) => [r.number, r.debitor]), [['RE-2026-0001', '200100'], ['ST-2026-0001', '200100'], ['RE-2026-0004', '2000'], ['RE-2026-0002', '10002']])
  assert.equal(rows[1].text, 'Stornorechnung zu RE-2026-0001 Wohnbau Muster eGen')
  assert.equal(rows[0].account, '4000', 'Erlöskonten bleiben trotz eigener Debitor-Einstellung')
})

test('CSV für die Steuerberatung: Felder mit Trennzeichen und Anführungszeichen, eigene Spalten, ohne Kopf', () => {
  const rows = [{ number: 'RE-2026-0007', date: '2026-11-03', customer: 'Huber; Partner "Glanz" OG', net: 1234.5, serviceFrom: '2026-10-01', serviceTo: '2026-10-01', text: 'Zeile 1\nZeile 2' }]
  const csv = exportCsv(rows, { columns: ['belegnr', 'kunde', 'netto', 'leistung', 'text', 'gibtsnicht'] })
  const [head, body, rest] = csv.split('\r\n')
  assert.equal(head, 'Belegnummer;Kunde;Netto;Leistungszeitraum;Text')
  assert.equal(body, 'RE-2026-0007;"Huber; Partner ""Glanz"" OG";1234,50;01.10.2026;"Zeile 1\nZeile 2"', 'Zeilenumbruch bleibt im Feld')
  assert.equal(rest, '')
  const plain = exportCsv(rows, { columns: ['belegnr', 'netto', 'belegdatum'], sep: ',', decimal: '.', header: false })
  assert.equal(plain, 'RE-2026-0007,1234.50,03.11.2026\r\n')
})

// ---------------------------------------------------------------- Zahlschein, Texte, Dateinamen, Kunden

test('IBAN: deutsche Beispiel-IBAN gültig, Kleinschreibung mit Leerzeichen gültig, falsche Länge oder Zeichen nicht', () => {
  assert.equal(ibanValid('DE89370400440532013000'), true)
  assert.equal(ibanValid('at61 1904 3002 3457 3201'), true)
  assert.equal(ibanValid('AT61190430023457320'), false, 'AT braucht 20 Stellen')
  assert.equal(ibanValid('AT61-1904-3002-3457-3201'), false)
  assert.equal(ibanValid(''), false)
  assert.equal(formatIban('at611904300234573201'), 'AT61 1904 3002 3457 3201')
})

test('EPC-QR-Code: Name und Text gekürzt, Betrag 0 oder zu groß bleibt leer, ohne Name kein Code', () => {
  const long = epcPayload({ name: 'N'.repeat(80), iban: IBAN, amount: 5, text: 'T'.repeat(200) }).split('\n')
  assert.equal(long[5].length, 70)
  assert.equal(long[10].length, 140)
  assert.equal(epcPayload({ name: 'X', iban: IBAN, amount: 0, text: 'abc' }).split('\n')[7], '')
  assert.equal(epcPayload({ name: 'X', iban: IBAN, amount: 1e9 }).split('\n').length, 7, 'leerer Betrag am Ende entfällt')
  assert.equal(epcPayload({ name: '', iban: IBAN, amount: 5 }), null)
})

test('E-Mail-Text: Angebot mit Gültigkeit, Storno ohne Zahlungsaufforderung', () => {
  const offer = { kind: 'angebot', number: 'AN-2026-0003', title: 'Grundreinigung', validUntil: '2026-12-03' }
  const mail = invoiceMailText({ doc: offer, company: 'Glanzwerk Reinigung GmbH', sender: 'Büro' })
  assert.match(mail, /anbei erhalten Sie unser Angebot AN-2026-0003 \(Grundreinigung\) als PDF\./)
  assert.match(mail, /Das Angebot gilt bis 03\.12\.2026\./)
  const st = invoiceMailText({ doc: { kind: 'storno', number: 'ST-2026-0001', total: { gross: -300 } }, iban: IBAN })
  assert.match(st, /unsere Stornorechnung ST-2026-0001/)
  assert.doesNotMatch(st, /Betrag:|zahlbar/)
  assert.doesNotMatch(mail, /\n\n\n/, 'keine doppelten Leerzeilen')
})

test('Dateinamen: Kurzform je Belegart, Sonderzeichen entfernt, Entwurf mit ID, Mahnung mit Stufe', () => {
  assert.equal(docFileName({ kind: 'korrektur', number: 'KO-2026-0001', recipient: { name: 'Müller & Söhne GmbH' } }), 'Korrektur_KO-2026-0001_Müller-Söhne-GmbH.pdf')
  assert.equal(docFileName({ kind: 'storno', number: 'ST-2026-0002' }), 'Storno_ST-2026-0002.pdf')
  assert.equal(docFileName({ kind: 'auftrag', id: 'a b/c', recipient: {} }), 'Auftrag_Entwurf-a-b-c.pdf')
  assert.equal(reminderFileName({ number: 'RE-2026-0004', recipient: { name: 'Hausverwaltung Ost' } }, 1), 'Mahnung2_RE-2026-0004_Hausverwaltung-Ost.pdf')
  assert.equal(archivePath({ kind: 'rechnung', id: 'x' }), 'fakturierung/belege/ohne-Jahr/Rechnung_Entwurf-x.pdf')
})

test('Kunden: nächste Kundennummer, Kunde zum Objekt, Empfänger als Momentaufnahme', () => {
  assert.equal(nextCustomerNo(), '10001')
  assert.equal(nextCustomerNo([{ customerNo: '10005' }, { customerNo: 'alt-7' }, {}]), '10006')
  const doc = { customers: [{ id: 'c1', objectIds: ['o1', 'o2'] }, { id: 'c2', objectIds: ['o3'] }] }
  assert.equal(customerForObject(doc, 'o3').id, 'c2')
  assert.equal(customerForObject(doc, 'o9'), null)
  assert.deepEqual(recipientOf({ name: 'Privat', consumer: 1, iban: 'x' }), { name: 'Privat', address: '', uid: '', email: '', customerNo: '', consumer: true })
})

test('Einstellungen: verschachtelte Vorgaben bleiben erhalten, leere Mahnstufen fallen auf die Standardstufen zurück', () => {
  const s = settingsOf({ settings: { bank: { iban: IBAN }, accounts: { erloese: { 20: '4001' } }, reminders: [], series: { storno: 'GS' } } })
  assert.deepEqual(s.bank, { iban: IBAN, bic: '', name: '' })
  assert.deepEqual(s.accounts.erloese, { 20: '4001', 13: '4013', 10: '4010', 0: '4020' })
  assert.equal(s.accounts.rc, '4030')
  assert.equal(s.reminders.length, 3)
  assert.deepEqual([s.series.storno, s.series.rechnung], ['GS', 'RE'])
  assert.equal(s.paymentDays, 14)
})

// ---------------------------------------------------------------- Beleg als PDF

test('Rechnung als PDF: Reverse Charge ohne USt-Spalte, Rabattspalte nur mit Positionsrabatt', () => {
  const rc = fin({ reverseCharge: true, lines: [line(500, { discount: 10 })] })
  const content = invoiceDocument({ doc: rc, settings }).content
  const table = content.find((c) => c.table?.headerRows === 1)
  assert.deepEqual(table.table.body[0].map((h) => h.text), ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'Rabatt', 'Gesamt netto'])
  assert.match(JSON.stringify(content), /UID Leistungsempfänger: ATU44455566 · UID Leistender: ATU11122233/)
  const plain = invoiceDocument({ doc: fin({ id: 'p' }), settings }).content.find((c) => c.table?.headerRows === 1)
  assert.deepEqual(plain.table.body[0].map((h) => h.text), ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', 'USt', 'Gesamt netto'])
})

test('Beleg als PDF: Kleinbetrag ohne Empfänger mit Hinweis, Storno verrechnet, Angebot mit Angebotssumme', () => {
  const small = JSON.stringify(invoiceDocument({ doc: fin({ recipient: {}, lines: [line(100)] }), settings }).content)
  assert.match(small, /Kleinbetragsrechnung gemäß § 11 Abs\. 6 UStG/)
  const inv = fin()
  const st = finalize(stornoDraft(inv, { id: 's', date: '2026-11-04' }), [inv], settings)
  const stPdf = JSON.stringify(invoiceDocument({ doc: st, settings }).content)
  assert.match(stPdf, /Der Betrag von 300,00 € wird mit offenen Forderungen verrechnet/)
  assert.doesNotMatch(stPdf, /"qr"/, 'kein Zahlschein bei Gutschrift')
  const offer = invoiceDocument({ doc: fin({ id: 'an', kind: 'angebot', serviceFrom: '', validUntil: '2026-12-03' }), settings })
  const offerText = JSON.stringify(offer.content)
  assert.match(offerText, /Angebotssumme/)
  assert.match(offerText, /Gültig bis.*03\.12\.2026/)
  assert.equal(offer.watermark, undefined)
})

test('parseNumber: Punkt als Tausendertrennzeichen (1.500 = 1500), Dezimalpunkt bleibt', async () => {
  const { parseNumber } = await import('../src/core/invoicing.js')
  assert.equal(parseNumber('1.500'), 1500)
  assert.equal(parseNumber('12.345.678'), 12345678)
  assert.equal(parseNumber('1.500,50'), 1500.5)
  assert.equal(parseNumber('1.5'), 1.5)
  assert.equal(parseNumber('1234.56'), 1234.56)
  assert.equal(parseNumber('-2.000'), -2000)
})
