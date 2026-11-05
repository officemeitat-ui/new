// SEPA-Überweisungsdatei pain.001 (core/sepa-transfer.js): Summen, IBAN-Prüfung, Zeichensatz, beide Fassungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseXml, find, findAll, textAt } from '../src/core/xml-lite.js'
import { bicValid, sepaProblems, sepaText, sepaTransfer } from '../src/core/sepa-transfer.js'

const debtor = { name: 'Gebäudereinigung Beispiel GmbH', iban: 'AT61 1904 3002 3457 3201', bic: 'BKAUATWW' }
const payments = [
  { id: 'i1', name: 'Hygiene-Großhandel Beispiel', iban: 'AT483200000012345864', bic: '', amount: 1176, text: 'Rechnung RE-2026/0815 Kd-Nr. K-1020', ref: 'ER-2026-0001' },
  { id: 'i2', name: 'Papier & Co Beispiel', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amount: 0.1, text: 'Rechnung P-1', ref: 'ER-2026-0002' },
  { id: 'i3', name: 'Werkstatt Müller', iban: 'AT611904300234573201', amount: 0.2, text: 'Service Bus', ref: 'ER-2026-0003' },
]

test('pain.001.001.09: Anzahl und Kontrollsumme stimmen (ohne Gleitkomma-Fehler)', () => {
  const r = sepaTransfer({ debtor, payments, date: '2026-11-06', msgId: 'EK-20261105-1', createdAt: new Date('2026-11-05T09:30:00Z') })
  assert.deepEqual([r.count, r.sum], [3, 1176.3])
  const root = parseXml(r.xml)
  assert.equal(root.name, 'Document')
  assert.match(r.xml, /xmlns="urn:iso:std:iso:20022:tech:xsd:pain\.001\.001\.09"/)
  const hdr = find(root, 'CstmrCdtTrfInitn/GrpHdr')
  assert.deepEqual([textAt(hdr, 'MsgId'), textAt(hdr, 'NbOfTxs'), textAt(hdr, 'CtrlSum'), textAt(hdr, 'CreDtTm')], ['EK-20261105-1', '3', '1176.30', '2026-11-05T09:30:00'])
  const pmt = find(root, 'CstmrCdtTrfInitn/PmtInf')
  assert.deepEqual([textAt(pmt, 'PmtMtd'), textAt(pmt, 'NbOfTxs'), textAt(pmt, 'CtrlSum'), textAt(pmt, 'ReqdExctnDt/Dt'), textAt(pmt, 'DbtrAcct/Id/IBAN'), textAt(pmt, 'DbtrAgt/FinInstnId/BICFI'), textAt(pmt, 'ChrgBr')], ['TRF', '3', '1176.30', '2026-11-06', 'AT611904300234573201', 'BKAUATWW', 'SLEV'])
  const tx = findAll(pmt, 'CdtTrfTxInf')
  assert.equal(tx.length, 3)
  const sum = tx.reduce((s, t) => s + Math.round(Number(textAt(t, 'Amt/InstdAmt')) * 100), 0) / 100
  assert.equal(sum, 1176.3)
  assert.deepEqual([textAt(tx[0], 'Cdtr/Nm'), textAt(tx[0], 'PmtId/EndToEndId'), textAt(tx[0], 'RmtInf/Ustrd')], ['Hygiene-Grosshandel Beispiel', 'ER-2026-0001', 'Rechnung RE-2026/0815 Kd-Nr. K-1020'])
  assert.equal(textAt(tx[1], 'CdtrAgt/FinInstnId/BICFI'), 'COBADEFFXXX')
  assert.equal(find(tx[0], 'CdtrAgt'), null, 'ohne BIC kein Kreditinstitut des Empfängers')
  assert.equal(textAt(tx[1], 'Cdtr/Nm'), 'Papier + Co Beispiel')
  assert.equal(textAt(tx[2], 'Cdtr/Nm'), 'Werkstatt Mueller')
  assert.equal(find(tx[0], 'Amt/InstdAmt').attrs.Ccy, 'EUR')
})

test('pain.001.001.03: ältere Fassung mit BIC und Datum ohne Unterelement', () => {
  const r = sepaTransfer({ debtor, payments: payments.slice(0, 1), date: '2026-11-06', msgId: 'X1', version: '03' })
  assert.match(r.xml, /pain\.001\.001\.03/)
  const pmt = find(parseXml(r.xml), 'CstmrCdtTrfInitn/PmtInf')
  assert.equal(textAt(pmt, 'ReqdExctnDt'), '2026-11-06')
  assert.equal(textAt(pmt, 'DbtrAgt/FinInstnId/BIC'), 'BKAUATWW')
})

test('IBAN-Prüfung und weitere Fehler verhindern die Datei', () => {
  const bad = [{ ...payments[0], iban: 'AT48 3200 0000 1234 5865' }, { ...payments[1], amount: 0 }, { ...payments[2], name: '', bic: 'XX' }]
  const p = sepaProblems({ debtor: { name: '', iban: 'AT00' }, payments: bad, date: '' })
  assert.equal(p.length, 7, p.join('\n'))
  assert.throws(() => sepaTransfer({ debtor, payments: bad, date: '2026-11-06' }), /IBAN „AT48 3200 0000 1234 5865“ ist ungültig/)
  assert.throws(() => sepaTransfer({ debtor, payments: [], date: '2026-11-06' }), /Keine Zahlung/)
  assert.ok(bicValid('BKAUATWW') && bicValid('COBADEFFXXX') && !bicValid('BKAU'))
})

test('Zeichensatz: Umlaute umschrieben, Sonderzeichen entfernt, gekürzt, XML sicher', () => {
  assert.equal(sepaText('Größe & Maß <Test> "ok" €5', 140), 'Groesse + Mass Test ok 5')
  assert.equal(sepaText('x'.repeat(200)).length, 140)
  const r = sepaTransfer({ debtor, payments: [{ ...payments[0], text: "O'Brien <b>&</b>" }], date: '2026-11-06', msgId: 'X2' })
  assert.match(r.xml, /<Ustrd>O&apos;Brien b \+ \/b<\/Ustrd>/)
})
