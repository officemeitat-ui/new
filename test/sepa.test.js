// SEPA-Lastschrift (core/sepa.js): Gläubiger-ID, Mandat, Bankarbeitstage, Vorabankündigung, pain.008 (Pflichtfelder,
// Summenkontrolle NbOfTxs/CtrlSum, IBAN), Einzug vermerken (FRST → RCUR), Rücklastschrift, Treffer im Bankabgleich.
// Mit SEPA_XSD_DIR (Ordner mit pain.008.001.02.xsd und pain.008.001.08.xsd von ISO 20022) und xmllint wird die
// Datei zusätzlich gegen das Schema geprüft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { suggest } from '../src/core/bank.js'
import { finalize, ibanValid, openAmount, stateOf } from '../src/core/invoicing.js'
import {
  addTargetDays,
  applyCollection,
  bicValid,
  buildCollection,
  collectionCandidates,
  collectionMatch,
  collectionSetupProblems,
  creditorIdFor,
  creditorIdValid,
  debitNoteFor,
  earliestCollection,
  mandateExpired,
  mandateOf,
  mandateProblems,
  mandateReferenceFor,
  messageId,
  noticeFits,
  noticeOf,
  pain008Problems,
  pain008Xml,
  returnDebit,
  sepaId,
  sepaText,
  targetDay,
  targetHoliday,
} from '../src/core/sepa.js'
import { mandateDocument, mandateWording } from '../src/export/sepa-pdf.js'
import { invoiceDocument } from '../src/export/invoice-pdf.js'

const IBAN = 'AT611904300234573201' // Beispiel-IBAN mit gültiger Prüfziffer
const CI = creditorIdFor('01234567890') // Beispiel-Gläubiger-ID
const settings = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: IBAN, bic: 'BKAUATWW' }, sepa: { creditorId: CI } }
const customer = (extra = {}) => ({ id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', iban: 'AT483200000012345864', bic: 'RLNWATWW', mandate: { reference: '10001-1', signedAt: '2026-01-15', scheme: 'CORE', sequence: 'FRST', active: true }, ...extra })
const invoice = (extra = {}) => ({ id: 'd1', kind: 'rechnung', number: 'RE-2026-0010', date: '2026-11-02', dueDate: '2026-11-20', customerId: 'c1', recipient: { name: 'Hausverwaltung Beispiel GmbH', address: 'Ringstraße 3\n5020 Salzburg' }, lines: [{ id: 'l1', text: 'Unterhaltsreinigung', qty: 1, unit: 'Monat', price: 1000, vat: 20 }], total: { net: 1000, vat: 200, gross: 1200, groups: [{ rate: 20, net: 1000, vat: 200 }] }, ...extra })

const count = (xml, tag) => (xml.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length
const values = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])

test('Gläubiger-ID: Prüfziffer nach EPC262-08, Österreich 18 Stellen', () => {
  assert.equal(CI, 'AT61ZZZ01234567890')
  assert.ok(creditorIdValid(CI))
  assert.ok(creditorIdValid('DE98ZZZ09999999999'), 'Test-ID der Deutschen Bundesbank')
  assert.ok(creditorIdValid('at61 zzz 0123 4567 890'), 'Leerzeichen und Kleinbuchstaben')
  assert.ok(creditorIdValid('AT61ABC01234567890'), 'Geschäftsbereichskennung zählt nicht zur Prüfziffer')
  assert.ok(!creditorIdValid('AT62ZZZ01234567890'), 'falsche Prüfziffer')
  assert.ok(!creditorIdValid('AT61ZZZ0123456789'), 'Österreich: 11 Stellen nationale Kennung')
  assert.ok(!creditorIdValid(''))
})

test('BIC und SEPA-Zeichensatz', () => {
  assert.ok(bicValid('BKAUATWW') && bicValid('RLNWATWWXXX') && !bicValid('BKAU') && !bicValid('BKAUAT1W'))
  assert.equal(sepaText('Müller & Söhne GmbH – Straße'), 'Mueller + Soehne GmbH - Strasse')
  assert.equal(sepaText('Café „Beispiel“ <Test>'), "Cafe 'Beispiel' Test")
  assert.equal(sepaText('x'.repeat(200), 70).length, 70)
  assert.equal(sepaId('/RE 2026//0001/'), 'RE-2026/0001')
})

test('Bankarbeitstage (TARGET): Wochenende, Karfreitag, Ostermontag, 1. Mai, Weihnachten', () => {
  assert.ok(targetHoliday('2026-04-03') && targetHoliday('2026-04-06'), 'Karfreitag und Ostermontag 2026')
  assert.ok(targetHoliday('2026-12-25') && targetHoliday('2026-12-26') && targetHoliday('2027-01-01') && targetHoliday('2026-05-01'))
  assert.ok(!targetHoliday('2026-12-08'), 'Mariä Empfängnis ist kein TARGET-Feiertag')
  assert.ok(!targetDay('2026-11-07') && targetDay('2026-11-06'))
  assert.equal(addTargetDays('2026-11-05', 2), '2026-11-09', 'Donnerstag + 2 Bankarbeitstage = Montag')
  assert.equal(addTargetDays('2026-12-23', 2), '2026-12-28')
  assert.equal(earliestCollection('2026-11-05', 2), '2026-11-09')
  assert.equal(earliestCollection('2026-11-05', 0), '2026-11-06', 'mindestens ein Bankarbeitstag')
})

test('Mandat: Pflichtangaben, Verfall nach 36 Monaten, B2B nur für Unternehmen', () => {
  const c = customer()
  assert.ok(mandateOf(c))
  assert.deepEqual(mandateProblems(c, '2026-11-05').filter((p) => p.level === 'error'), [])
  assert.equal(mandateOf(customer({ mandate: { ...c.mandate, active: false } })), null)
  assert.equal(mandateOf(customer({ mandate: { reference: '' } })), null)
  const errs = (x) => mandateProblems(x, '2026-11-05').filter((p) => p.level === 'error').map((p) => p.text).join(' ')
  assert.match(errs(customer({ iban: '' })), /IBAN des Kunden fehlt/)
  assert.match(errs(customer({ iban: 'AT611904300234573202' })), /ungültig/)
  assert.match(errs(customer({ mandate: { ...c.mandate, reference: 'Mandat 1 ä' } })), /Mandatsreferenz/)
  assert.match(errs(customer({ mandate: { ...c.mandate, signedAt: '' } })), /Unterschrift fehlt/)
  assert.match(errs(customer({ consumer: true, mandate: { ...c.mandate, scheme: 'B2B' } })), /nur für Unternehmen/)
  assert.ok(!mandateExpired({ signedAt: '2023-12-01' }, '2026-11-05'))
  assert.ok(mandateExpired({ signedAt: '2023-10-01' }, '2026-11-05'))
  assert.ok(!mandateExpired({ signedAt: '2020-01-01', lastCollection: '2026-01-05' }, '2026-11-05'), 'zählt ab der letzten Lastschrift')
  assert.match(errs(customer({ mandate: { ...c.mandate, signedAt: '2023-01-01' } })), /verfallen/)
  assert.equal(mandateReferenceFor({ customerNo: '10001' }, [c]), '10001-2')
})

test('Vorabankündigung: Hinweis auf der Rechnung, Frist 14 Tage oder laut Mandat', () => {
  const c = customer()
  const note = debitNoteFor(invoice({ total: undefined }), c, settings)
  assert.match(note, /€\s1\.200,00 wird am 20\.11\.2026 mit SEPA-Lastschrift von Ihrem Konto AT48 \*\*\*\* 5864 eingezogen \(Mandatsreferenz 10001-1, Gläubiger-ID AT61ZZZ01234567890\)/)
  assert.equal(debitNoteFor(invoice(), customer({ mandate: null }), settings), '')
  assert.equal(debitNoteFor(invoice(), c, { ...settings, sepa: {} }), '', 'ohne Gläubiger-ID kein Hinweis')
  assert.equal(debitNoteFor(invoice({ kind: 'storno' }), c, settings), '')
  assert.match(debitNoteFor(invoice({ dueDate: '2026-11-21' }), c, settings), /am 23\.11\.2026/, 'Samstag → nächster Bankarbeitstag')
  // Ankündigung: versendete Rechnung mit Hinweis, sonst E-Mail
  assert.equal(noticeOf(invoice()), null)
  const sent = invoice({ debitText: note, sent: [{ at: '2026-11-02T09:00:00Z', to: 'x@y.at' }] })
  assert.deepEqual(noticeOf(sent), { via: 'rechnung', date: '2026-11-02', dueDate: '2026-11-20' })
  assert.ok(noticeFits(noticeOf(sent), '2026-11-20', 14) && noticeFits(noticeOf(sent), '2026-11-23', 14))
  assert.ok(!noticeFits(noticeOf(sent), '2026-11-19', 14), 'nicht vor dem angekündigten Termin')
  assert.ok(!noticeFits(noticeOf(sent), '2026-11-20', 20), 'Frist zu kurz')
  const mailed = invoice({ debitNotice: [{ at: '2026-11-05T08:00:00Z', dueDate: '2026-11-19' }] })
  assert.deepEqual(noticeOf(mailed), { via: 'mail', date: '2026-11-05', dueDate: '2026-11-19' })
  assert.ok(noticeFits(noticeOf(mailed), '2026-11-19', 14) && !noticeFits(noticeOf(mailed), '2026-11-18', 5))
  // Festschreiben friert den Hinweis ein (Prüfsumme), das PDF zeigt ihn statt der Überweisung
  const draft = { ...invoice({ number: '', total: undefined, status: 'entwurf', serviceFrom: '2026-10-01', serviceTo: '2026-10-31' }), debitText: note }
  const fixed = finalize(draft, [], settings, { now: '2026-11-02T10:00:00Z' })
  assert.equal(fixed.debitText, note)
  const pdf = JSON.stringify(invoiceDocument({ doc: fixed, settings }).content)
  assert.ok(pdf.includes('mit SEPA-Lastschrift') && !pdf.includes('Bitte überweisen Sie') && !pdf.includes('"qr"'))
  const preview = JSON.stringify(invoiceDocument({ doc: draft, settings, customer: c }).content)
  assert.ok(preview.includes('mit SEPA-Lastschrift'))
})

test('Kandidaten für den Einzug: nur offene Rechnungen von Kunden mit Mandat, nicht im Einzug', () => {
  const docs = [invoice(), invoice({ id: 'd2', number: 'RE-2026-0011', customerId: 'c2' }), invoice({ id: 'd3', number: 'RE-2026-0012', payments: [{ id: 'p', date: '2026-11-03', amount: 1200 }] }), invoice({ id: 'd4', number: 'RE-2026-0013', directDebit: { status: 'eingereicht' } }), invoice({ id: 'd5', number: '' })]
  const list = collectionCandidates(docs, [customer(), customer({ id: 'c2', mandate: null })], '2026-11-05', settings)
  assert.deepEqual(list.map((x) => x.doc.id), ['d1'])
  assert.equal(list[0].open, 1200)
  assert.equal(list[0].preNotice, 14)
  assert.equal(collectionCandidates(docs, [customer({ mandate: { ...customer().mandate, preNoticeDays: 5 } })], '2026-11-05', settings)[0].preNotice, 5)
  assert.deepEqual(collectionSetupProblems(settings), [])
  assert.match(collectionSetupProblems({ ...settings, sepa: { creditorId: 'AT00ZZZ01234567890' } })[0].text, /ungültig/)
})

test('pain.008: Pflichtfelder, Summenkontrolle, FRST nur einmal je Mandat, beide Versionen', () => {
  const c1 = customer()
  const c2 = customer({ id: 'c2', name: 'Beispiel & Söhne KG', iban: 'AT483200000012345864', bic: '', mandate: { reference: 'B2B-7', signedAt: '2025-03-01', scheme: 'B2B', sequence: 'RCUR' } })
  const items = [
    { doc: invoice(), customer: c1, mandate: c1.mandate, open: 1200 },
    { doc: invoice({ id: 'd2', number: 'RE-2026-0011' }), customer: c1, mandate: c1.mandate, open: 300.1 },
    { doc: invoice({ id: 'd3', number: 'RE-2026-0012', customerId: 'c2' }), customer: c2, mandate: c2.mandate, open: 0.2 },
  ]
  const built = buildCollection(items, { dueDate: '2026-11-20' })
  assert.equal(built.count, 3)
  assert.equal(built.sum, 1500.3)
  assert.deepEqual(built.transactions.map((t) => `${t.scheme}/${t.seq}`), ['CORE/FRST', 'CORE/RCUR', 'B2B/RCUR'])
  assert.equal(built.payments.length, 3)
  const creditor = { name: settings.sender.name, iban: IBAN, bic: 'BKAUATWW', ci: CI }
  assert.deepEqual(pain008Problems({ creditor, payments: built.payments }), [])
  const msgId = messageId('2026-11-05T10:11:12', 'ab12')
  assert.equal(msgId, 'LS-20261105-101112-AB12')
  for (const version of ['pain.008.001.08', 'pain.008.001.02']) {
    const xml = pain008Xml({ version, msgId, createdAt: '2026-11-05T10:11:12.345Z', creditor, payments: built.payments })
    assert.ok(xml.includes(`xmlns="urn:iso:std:iso:20022:tech:xsd:${version}"`))
    assert.equal(count(xml, 'PmtInf'), 3)
    assert.equal(count(xml, 'DrctDbtTxInf'), 3)
    // NbOfTxs und CtrlSum: Kopf = alle, je Block = seine Transaktionen
    const nb = values(xml, 'NbOfTxs').map(Number)
    const ctrl = values(xml, 'CtrlSum').map(Number)
    assert.equal(nb[0], 3)
    assert.equal(ctrl[0], 1500.3)
    assert.equal(nb.slice(1).reduce((a, b) => a + b, 0), 3)
    assert.equal(Math.round(ctrl.slice(1).reduce((a, b) => a + b, 0) * 100), 150030)
    assert.deepEqual(values(xml, 'InstdAmt'), ['0.20', '1200.00', '300.10'])
    assert.equal(Math.round(values(xml, 'InstdAmt').reduce((a, b) => a + Number(b), 0) * 100), Math.round(ctrl[0] * 100))
    for (const iban of values(xml, 'IBAN')) assert.ok(ibanValid(iban), iban)
    assert.deepEqual(values(xml, 'EndToEndId'), ['RE-2026-0012', 'RE-2026-0010', 'RE-2026-0011'])
    assert.deepEqual(values(xml, 'MndtId'), ['B2B-7', '10001-1', '10001-1'])
    assert.deepEqual(values(xml, 'SeqTp'), ['RCUR', 'FRST', 'RCUR'])
    assert.deepEqual(values(xml, 'Cd').filter((v) => v !== 'SEPA'), ['B2B', 'CORE', 'CORE'])
    assert.deepEqual(values(xml, 'ReqdColltnDt'), ['2026-11-20', '2026-11-20', '2026-11-20'])
    assert.ok(xml.includes(`<CdtrSchmeId><Id><PrvtId><Othr><Id>${CI}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm>`))
    assert.ok(xml.includes('<CreDtTm>2026-11-05T10:11:12</CreDtTm>') && xml.includes('<ChrgBr>SLEV</ChrgBr>') && xml.includes('<PmtMtd>DD</PmtMtd>'))
    assert.ok(xml.includes('<Nm>Beispiel + Soehne KG</Nm>') && xml.includes('<Ustrd>Rechnung RE-2026-0010 vom 02.11.2026</Ustrd>'))
    // BIC: in .08 BICFI, in .02 BIC; ohne BIC „NOTPROVIDED“
    assert.ok(xml.includes(version.endsWith('08') ? '<BICFI>RLNWATWW</BICFI>' : '<BIC>RLNWATWW</BIC>'))
    assert.ok(!xml.includes(version.endsWith('08') ? '<BIC>' : '<BICFI>'))
    assert.ok(xml.includes('<Othr><Id>NOTPROVIDED</Id></Othr>'))
  }
  const bad = buildCollection([{ ...items[0], customer: { ...c1, iban: 'AT611904300234573202' } }, items[0]], { dueDate: '2026-11-21' }).payments
  const errs = pain008Problems({ creditor: { ...creditor, ci: 'AT00' }, payments: bad }).map((p) => p.text).join(' | ')
  assert.match(errs, /Gläubiger-ID/)
  assert.match(errs, /IBAN des Zahlers ungültig/)
  assert.match(errs, /kein Bankarbeitstag/)
  assert.match(errs, /Referenz doppelt/)
  assert.throws(() => pain008Xml({ version: 'pain.008.003.02', msgId: 'x', creditor, payments: [] }), /Version/)
})

test('pain.008: Anschrift des Zahlers nur außerhalb des EWR (z. B. Schweiz)', () => {
  const ch = customer({ id: 'c3', name: 'Zürcher Beispiel AG', iban: 'CH9300762011623852957', bic: '', country: 'CH', street: 'Bahnhofstrasse 1', zip: '8001', city: 'Zürich' })
  const built = buildCollection([{ doc: invoice(), customer: ch, mandate: ch.mandate, open: 10 }, { doc: invoice({ id: 'd2', number: 'RE-2026-0011' }), customer: customer(), mandate: customer({ mandate: { ...customer().mandate, reference: 'X-1' } }).mandate, open: 5 }], { dueDate: '2026-11-20' })
  const xml = pain008Xml({ msgId: 'M1', createdAt: '2026-11-05T10:00:00', creditor: { name: 'A', iban: IBAN, ci: CI }, payments: built.payments })
  assert.equal(count(xml, 'PstlAdr'), 1)
  assert.ok(xml.includes('<PstlAdr><StrtNm>Bahnhofstrasse 1</StrtNm><PstCd>8001</PstCd><TwnNm>Zuerich</TwnNm><Ctry>CH</Ctry></PstlAdr>'))
})

test('pain.008 gegen die XSD von ISO 20022 (mit SEPA_XSD_DIR und xmllint)', { skip: !process.env.SEPA_XSD_DIR && 'SEPA_XSD_DIR nicht gesetzt' }, () => {
  const c1 = customer()
  const ch = customer({ id: 'c3', name: 'Zürcher Beispiel AG', iban: 'CH9300762011623852957', bic: '', country: 'CH', city: 'Zürich', mandate: { reference: 'CH-1', signedAt: '2025-01-01', scheme: 'B2B', sequence: 'RCUR' } })
  const built = buildCollection([{ doc: invoice(), customer: c1, mandate: c1.mandate, open: 1200 }, { doc: invoice({ id: 'd3', number: 'RE-2026-0012' }), customer: ch, mandate: ch.mandate, open: 99.99 }], { dueDate: '2026-11-20' })
  const dir = mkdtempSync(join(tmpdir(), 'pain008-'))
  for (const version of ['pain.008.001.02', 'pain.008.001.08']) {
    const xsd = join(process.env.SEPA_XSD_DIR, `${version}.xsd`)
    assert.ok(existsSync(xsd), xsd)
    const file = join(dir, `${version}.xml`)
    writeFileSync(file, pain008Xml({ version, msgId: 'LS-20261105-1', createdAt: '2026-11-05T10:00:00', creditor: { name: 'Reinigung Beispiel GmbH', iban: IBAN, bic: 'BKAUATWW', ci: CI }, payments: built.payments }))
    execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'pipe' })
  }
})

test('Einzug vermerken: im Einzug, Sequenz FRST → RCUR, letzter Einzug; danach kein Kandidat mehr', () => {
  const c = customer()
  const docs = [invoice(), invoice({ id: 'd2', number: 'RE-2026-0011' })]
  const items = collectionCandidates(docs, [c], '2026-11-05', settings)
  const built = buildCollection(items, { dueDate: '2026-11-20' })
  const batch = applyCollection(docs, [c], built, { msgId: 'LS-1', dueDate: '2026-11-20', version: 'pain.008.001.08', at: '2026-11-05T10:00:00Z', by: 'Test' })
  assert.deepEqual(batch.docIds, ['d1', 'd2'])
  assert.equal(batch.sum, 2400)
  assert.equal(docs[0].directDebit.status, 'eingereicht')
  assert.equal(docs[0].directDebit.seq, 'FRST')
  assert.equal(docs[1].directDebit.seq, 'RCUR')
  assert.equal(c.mandate.sequence, 'RCUR')
  assert.equal(c.mandate.lastCollection, '2026-11-20')
  assert.match(docs[0].history.at(-1).text, /SEPA-Lastschrift eingereicht \(FRST/)
  assert.equal(collectionCandidates(docs, [c], '2026-11-05', settings).length, 0)
  assert.equal(stateOf(docs[0], docs, '2026-11-05', settings), 'offen', 'bis zum Eingang offen')
})

test('Bankabgleich: Eingang einer Lastschrift ist ein sicherer Treffer (EndToEnd-ID, Sammelgutschrift, Betrag und Termin)', () => {
  let c = customer()
  const make = () => {
    c = customer()
    const docs = [invoice(), invoice({ id: 'd2', number: 'RE-2026-0011', total: { net: 250, vat: 50, gross: 300, groups: [{ rate: 20, net: 250, vat: 50 }] } }), invoice({ id: 'd9', number: 'RE-2026-0019', customerId: 'cx', recipient: { name: 'Andere Beispiel KG' } })]
    applyCollection(docs, [c], buildCollection(collectionCandidates(docs, [c], '2026-11-05', settings), { dueDate: '2026-11-20' }), { msgId: 'LS-1', dueDate: '2026-11-20', at: '2026-11-05T10:00:00Z' })
    return docs
  }
  let docs = make()
  // EndToEnd-ID aus camt
  let s = suggest({ amount: 1200, date: '2026-11-20', name: 'Bank', endToEnd: 'RE-2026-0010' }, { docs, customers: [c], settings })
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'd1', amount: 1200 }])
  assert.match(s.reasons.join(' '), /EndToEnd-ID/)
  // Sammelgutschrift über den ganzen Einzug
  s = suggest({ amount: 1500, date: '2026-11-20', name: 'SEPA Lastschrift Sammler', text: 'Einzug' }, { docs, customers: [c], settings })
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'd1', amount: 1200 }, { docId: 'd2', amount: 300 }])
  assert.match(s.reasons[0], /Sammelgutschrift/)
  // einzelne Gutschrift mit Betrag und Termin
  s = suggest({ amount: 300, date: '2026-11-21', name: '', text: 'SEPA-Lastschrift' }, { docs, customers: [c], settings })
  assert.deepEqual(s.allocations, [{ docId: 'd2', amount: 300 }])
  assert.equal(s.level, 'sicher')
  // zu früh oder anderer Betrag: kein Lastschrift-Treffer
  assert.equal(collectionMatch({ amount: 300, date: '2026-11-02' }, docs, settings), null)
  assert.equal(collectionMatch({ amount: 999, date: '2026-11-20' }, docs, settings), null)
  // Rücklastschrift: Gegenbuchung, wieder offen, nächste wieder FRST
  docs = make()
  docs[0].payments = [{ id: 'p1', date: '2026-11-20', amount: 1200, bank: 'tx1' }]
  assert.equal(openAmount(docs[0], docs, settings), 0)
  const r = returnDebit(docs[0], c, { date: '2026-11-24', reason: 'AM04', fee: 7.5, at: '2026-11-24T08:00:00Z', by: 'Test', newId: () => 'r1' })
  assert.equal(r.booked, 1200)
  assert.equal(openAmount(docs[0], docs, settings), 1200)
  assert.equal(docs[0].directDebit.status, 'zurueck')
  assert.equal(docs[0].payments.at(-1).kind, 'ruecklastschrift')
  assert.match(docs[0].history.at(-1).text, /Rücklastschrift vom 24\.11\.2026: Konto nicht gedeckt, Bankspesen €\s7,50/)
  assert.equal(c.mandate.sequence, 'FRST')
  assert.throws(() => returnDebit(docs[0], c, { date: '2026-11-24', at: 'x' }), /schon erfasst/)
  const again = collectionCandidates(docs, [c], '2026-11-25', settings)
  assert.ok(again.some((x) => x.doc.id === 'd1' && x.returned), 'nach der Rücklastschrift wieder einziehbar')
})

test('Mandat als PDF: Wortlaut je Art, Gläubiger-ID, Referenz, Frist der Vorabankündigung', () => {
  assert.match(mandateWording('CORE', 'Reinigung Beispiel GmbH'), /acht Wochen/)
  assert.match(mandateWording('B2B', 'Reinigung Beispiel GmbH'), /nur dem Einzug von Lastschriften, die auf Konten von Unternehmen/)
  const c = customer({ street: 'Ringstraße 3', zip: '5020', city: 'Salzburg' })
  const doc = mandateDocument({ customer: c, mandate: { ...c.mandate, preNoticeDays: 5 }, settings })
  const text = JSON.stringify(doc.content)
  assert.ok(text.includes('SEPA-Lastschrift-Mandat') && text.includes(CI) && text.includes('10001-1') && text.includes('AT48 3200 0000 1234 5864'))
  assert.ok(text.includes('spätestens 5 Tage vor dem Einzug') && text.includes('kürzere Frist ist hiermit vereinbart'))
  assert.ok(JSON.stringify(mandateDocument({ customer: c, mandate: { scheme: 'B2B' }, settings }).content).includes('SEPA-Firmenlastschrift-Mandat'))
})
