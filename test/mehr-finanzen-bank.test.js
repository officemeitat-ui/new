import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyAllocation, csvTransactions, dedupe, detectCsv, fieldsFromText, hashTx, mappingFromHeader, nameScore, nameTokens, numbersIn, parseAmount, parseCamt, parseCsvRows, parseDate, parseXml, prune, readStatement, rememberIban, staleCredits, suggest } from '../src/core/bank.js'
import { openAmount } from '../src/core/invoicing.js'

// Erfundene Belege und Kunden
const inv = (id, number, gross, customerId, name, extra = {}) => ({ id, kind: 'rechnung', number, date: '2026-10-01', dueDate: '2026-10-15', customerId, recipient: { name }, total: { net: gross / 1.2, vat: gross - gross / 1.2, gross }, payments: [], ...extra })
const tx = (amount, extra = {}) => ({ id: 't1', date: '2026-11-04', amount, name: '', iban: '', text: '', reference: '', ...extra })
const HV_IBAN = 'AT483200000012345864'
const customers = [
  { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', ibans: [HV_IBAN] },
  { id: 'c2', name: 'Autohaus Maxglan Beispiel KG' },
]

// ---------------------------------------------------------------- Zahlen, Daten, Namen

for (const [input, expected] of [
  ['(12,30)', -12.3],
  ['1.234', 1234],
  ['€ 1.234,56', 1234.56],
  ['EUR -5,00', -5],
  ['12,30 H', 12.3],
  ['−7,50', -7.5],
  ['1 234,56', 1234.56],
  [99.999, 100],
]) {
  test(`Bank: Betrag „${input}“ → ${expected}`, () => {
    assert.equal(parseAmount(input), expected)
  })
}

test('Bank: Betrag ohne Zahl ist NaN (nicht 0, damit leere Spalten erkannt werden)', () => {
  for (const v of ['', 'abc', null, undefined]) assert.ok(Number.isNaN(parseAmount(v)), String(v))
})

test('Bank: Datum in allen Schreibweisen, Unbekanntes wird leer', () => {
  assert.equal(parseDate('30/10/2026'), '2026-10-30')
  assert.equal(parseDate('20261030'), '2026-10-30')
  assert.equal(parseDate('1.2.2026'), '2026-02-01')
  assert.equal(parseDate('2026-10-30T08:00:00+01:00'), '2026-10-30')
  assert.equal(parseDate('gestern'), '')
  assert.equal(parseDate(null), '')
})

test('Bank: Namen ohne Rechtsform, Titel und Akzente; Ähnlichkeit unabhängig von der Reihenfolge', () => {
  assert.deepEqual(nameTokens('Dr. Mag. Anna Huber GmbH & Co KG'), ['anna', 'huber'])
  assert.deepEqual(nameTokens('Straßenreinigung Müller'), ['strassenreinigung', 'muller'])
  assert.equal(nameScore('Huber Anna', 'Mag. Anna Huber'), 1)
  assert.equal(nameScore('Hausverwaltung Nord', 'Hausverwaltung Süd GmbH'), 0.5)
  assert.equal(nameScore('GmbH', 'Huber GmbH'), 0, 'nur Rechtsform zählt nicht')
  assert.equal(nameScore('', 'Huber'), 0)
})

test('Bank: Felder aus dem Buchungstext bei Abbuchung (Empfänger, BIC, Zahlungsreferenz)', () => {
  const f = fieldsFromText('Empfänger: Reinigungsmittel Großhandel IBAN Empfänger: AT02 2050 3021 0102 3600 BIC Empfänger: GIBAATWWXXX Zahlungsreferenz: 4711 Verwendungszweck: Lieferung Oktober')
  assert.deepEqual(f, { name: 'Reinigungsmittel Großhandel', iban: 'AT022050302101023600', bic: 'GIBAATWWXXX', reference: '4711', purpose: 'Lieferung Oktober' })
})

test('Bank: IBAN auch ohne Feldname im Text, ungültige IBAN wird verworfen', () => {
  assert.equal(fieldsFromText('Gutschrift AT48 3200 0000 1234 5864 danke').iban, HV_IBAN)
  assert.equal(fieldsFromText('Auftraggeber: Max Muster IBAN Auftraggeber: 1234').iban, '')
  assert.deepEqual(fieldsFromText(''), { name: '', iban: '', bic: '', reference: '', purpose: '' })
})

// ---------------------------------------------------------------- XML (camt)

test('Bank: XML-Leser ohne Namensräume, mit Entitäten, CDATA, Kommentaren und leeren Elementen', () => {
  const root = parseXml(`<?xml version="1.0"?><!-- Kommentar --><ns:Root xmlns:ns="urn:x" ns:attr='a&amp;b'><ns:Kind>Ä&#228;&#xE4;&lt;</ns:Kind><Leer/><Text><![CDATA[<roh> & ]]></Text></ns:Root>`)
  const [r] = root.children
  assert.equal(r.name, 'Root')
  assert.equal(r.attrs.attr, 'a&b')
  assert.deepEqual(r.children.map((c) => c.name), ['Kind', 'Leer', 'Text'], 'leeres Element hat keine Kinder')
  assert.equal(r.children[0].text, 'Äää<')
  assert.equal(r.children[2].text, '<roh> & ')
})

test('Bank: keine camt-Datei wird mit klarer Meldung abgelehnt', () => {
  assert.throws(() => parseCamt('<Document><Foo/></Document>'), /Keine camt-Datei/)
})

const CAMT054 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02">
  <BkToCstmrDbtCdtNtfctn><Ntfctn>
    <Acct><Id><IBAN>AT61 1904 3002 3457 3201</IBAN></Id></Acct>
    <Ntry>
      <Amt Ccy="USD">12.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
      <ValDt><Dt>2026-11-02</Dt></ValDt>
      <AddtlNtryInf>Kontoführung   Oktober</AddtlNtryInf>
    </Ntry>
    <Ntry><Amt Ccy="EUR">99.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-11-03</Dt></BookgDt></Ntry>
    <Ntry>
      <Amt Ccy="EUR">480.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><DtTm>2026-11-03T09:15:00</DtTm></BookgDt><ValDt><Dt>2026-11-04</Dt></ValDt>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>E2E-77</EndToEndId><AcctSvcrRef>TX-77</AcctSvcrRef></Refs>
        <AmtDtls><TxAmt><Amt Ccy="EUR">480.00</Amt></TxAmt></AmtDtls>
        <RltdPties><Dbtr><Pty><Nm>Wohnbau  Muster eGen</Nm></Pty></Dbtr><DbtrAcct><Id><Othr><Id>12345678</Id></Othr></Id></DbtrAcct></RltdPties>
        <RmtInf><Ustrd>RE-2026-0011</Ustrd><Ustrd>Oktober</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>
  </Ntfctn></BkToCstmrDbtCdtNtfctn>
</Document>`

test('Bank: camt.054 – Abbuchung ohne Details, vorgemerkte ausgelassen, Betrag unter AmtDtls, Name unter Pty', () => {
  const c = parseCamt(CAMT054)
  assert.equal(c.format, 'camt.054')
  assert.equal(c.account, 'AT611904300234573201', 'IBAN ohne Leerzeichen')
  assert.deepEqual([c.from, c.to], ['', ''])
  assert.equal(c.transactions.length, 2)
  const [fee, pay] = c.transactions
  assert.deepEqual([fee.date, fee.valueDate, fee.amount, fee.currency, fee.text, fee.name], ['2026-11-02', '2026-11-02', -12.5, 'USD', 'Kontoführung Oktober', ''])
  assert.deepEqual([pay.date, pay.valueDate, pay.amount, pay.name, pay.iban], ['2026-11-03', '2026-11-04', 480, 'Wohnbau Muster eGen', '12345678'])
  assert.deepEqual([pay.text, pay.endToEnd, pay.bankRef, pay.batch], ['RE-2026-0011 Oktober', 'E2E-77', 'TX-77', null])
})

test('Bank: Auszug mit BOM und Leerzeilen vor dem XML wird als camt erkannt', () => {
  const r = readStatement(`﻿ \n${CAMT054}`)
  assert.equal(r.format, 'camt.054')
  assert.equal(r.ok, true)
})

// ---------------------------------------------------------------- CSV

test('Bank: CSV mit BOM, Trennzeichen und Anführungszeichen im Feld, Zeilenumbruch im Feld, Leerzeilen', () => {
  const { rows, sep } = parseCsvRows('﻿Datum;Text;Betrag\r\n"04.11.2026";"Miete; Büro ""Nord""\nZeile 2";"-1.200,00"\r\n\r\n05.11.2026; Zahlung ;240,00')
  assert.equal(sep, ';')
  assert.deepEqual(rows, [['Datum', 'Text', 'Betrag'], ['04.11.2026', 'Miete; Büro "Nord"\nZeile 2', '-1.200,00'], ['05.11.2026', 'Zahlung', '240,00']])
  assert.equal(parseCsvRows('a\tb\tc\n1\t2\t3').sep, '\t')
  assert.deepEqual(parseCsvRows('').rows, [])
})

test('Bank: Spaltenzuordnung mit Anfangsübereinstimmung und weiteren Textspalten', () => {
  const m = mappingFromHeader(['Buchungstag', 'Betrag (EUR) Haben', 'Valuta', 'Name', 'Verwendungszweck', 'Buchungstext', 'IBAN'])
  assert.deepEqual({ date: m.date, amount: m.amount, valueDate: m.valueDate, name: m.name, text: m.text, iban: m.iban }, { date: 0, amount: 1, valueDate: 2, name: 3, text: 4, iban: 6 })
  assert.deepEqual(m.extraText, [5])
})

test('Bank: Format erkennen – leer, Bank Austria, ohne Kopfzeile geraten (zum Prüfen)', () => {
  const empty = detectCsv('')
  assert.deepEqual([empty.format, empty.ok], ['leer', false])
  const ba = detectCsv('Buchungsdatum;Valutadatum;Empfänger/Auftraggeber;IBAN;Zahlungsreferenz;Betrag;Währung\n04.11.2026;04.11.2026;Muster;AT483200000012345864;RE-2026-1;240,00;EUR')
  assert.deepEqual([ba.format, ba.header, ba.ok, ba.mapping.reference], ['bankaustria', true, true, 4])
  const guess = detectCsv('04.11.2026;240,00;Zahlung von Kunde Beispiel')
  assert.deepEqual([guess.format, guess.header, guess.ok], ['csv', false, false])
  assert.deepEqual([guess.mapping.date, guess.mapping.amount, guess.mapping.text], [0, 1, 2])
})

test('Bank: CSV-Buchungen – ohne Datum, ohne Betrag oder mit 0 ausgelassen, IBAN aus dem Text als Ersatz', () => {
  const rows = [
    ['Datum', 'Betrag', 'IBAN', 'Text'],
    ['04.11.2026', '240,00', 'unbekannt', 'Auftraggeber: Hausverwaltung Beispiel IBAN Auftraggeber: AT48 3200 0000 1234 5864'],
    ['', '10,00', '', 'kein Datum'],
    ['05.11.2026', '0,00', '', 'Nullbuchung'],
    ['06.11.2026', 'x', '', 'kein Betrag'],
  ]
  const list = csvTransactions({ rows, header: true, mapping: { date: 0, amount: 1, iban: 2, text: 3, extraText: [] } })
  assert.equal(list.length, 1)
  assert.deepEqual([list[0].iban, list[0].name, list[0].currency, list[0].valueDate], [HV_IBAN, 'Hausverwaltung Beispiel', 'EUR', '2026-11-04'])
})

test('Bank: CSV-Auszug liefert Zeitraum vom ersten bis zum letzten Buchungstag', () => {
  const r = readStatement('Datum;Betrag;Text\n06.11.2026;10,00;b\n02.11.2026;20,00;a\n04.11.2026;-5,00;c\n')
  assert.deepEqual([r.from, r.to, r.transactions.length], ['2026-11-02', '2026-11-06', 3])
})

// ---------------------------------------------------------------- Doppelte, Aufbewahrung

test('Bank: Kennung unabhängig von Groß-/Kleinschreibung und Leerzeichen, verschieden bei Betrag und Zähler', () => {
  const a = { date: '2026-11-04', amount: 240, iban: 'AT48 3200 0000 1234 5864', text: 'Rechnung  RE-2026-1', reference: '' }
  const b = { ...a, iban: HV_IBAN, text: 'rechnung re-2026-1' }
  assert.equal(hashTx(a), hashTx(b))
  assert.notEqual(hashTx(a), hashTx({ ...a, amount: 240.01 }))
  assert.notEqual(hashTx(a), hashTx(a, 1))
  assert.match(hashTx(a), /^b[0-9a-f]{16}$/)
})

test('Bank: Eingang mit Storno-Kennzeichen wird Rückbuchung, nicht offener Eingang', () => {
  const { fresh } = dedupe([tx(50, { reversal: true }), tx(50), tx(-20)])
  assert.deepEqual(fresh.map((t) => t.status), ['rueckbuchung', 'offen', 'abbuchung'])
  assert.ok(fresh.every((t) => Array.isArray(t.allocations) && t.id))
})

test('Bank: Aufbewahrung mit eigener Monatszahl, Grenztag bleibt', () => {
  const bank = { tx: [{ id: 'a', date: '2026-10-03' }, { id: 'b', date: '2026-10-04' }], hashes: { x: '2026-10-03', y: '2026-10-04' } }
  prune(bank, '2026-11-04', 1)
  assert.deepEqual(bank.tx.map((t) => t.id), ['b'])
  assert.deepEqual(bank.hashes, { y: '2026-10-04' })
})

test('Bank: offene Eingänge zum Erledigen – nur nicht zugeordnete Gutschriften, Frist einstellbar', () => {
  const bank = { tx: [{ id: 'a', date: '2026-11-04', amount: 10, status: 'offen' }, { id: 'b', date: '2026-11-01', amount: 10, status: 'zugeordnet' }, { id: 'c', date: '2026-11-01', amount: -10, status: 'offen' }, { id: 'd', date: '2026-11-02', amount: 5, status: 'offen' }] }
  assert.deepEqual(staleCredits(bank, '2026-11-04', 0).map((t) => t.id), ['a', 'd'])
  assert.deepEqual(staleCredits(bank, '2026-11-04', 2).map((t) => t.id), ['d'])
  assert.deepEqual(staleCredits(null, '2026-11-04'), [])
})

// ---------------------------------------------------------------- Zuordnung

test('Bank: Rechnungsnummern – eigenes Kürzel, Doppelte einmal, falsches Jahrhundert und zu lange Nummer nicht', () => {
  assert.deepEqual(numbersIn('AR 2026/12 und RE-2026-0012', ['AR']), ['AR|2026|12'])
  assert.deepEqual(numbersIn('RE-2026-3 re 2026 0003 RE_2026_03'), ['RE|2026|3'])
  assert.deepEqual(numbersIn('RE-2126-1 RE-2026-1234567'), [])
  assert.deepEqual(numbersIn('RE-1999-5'), ['RE|1999|5'])
})

test('Bank: eigenes Rechnungskürzel aus den Einstellungen wird im Verwendungszweck gefunden', () => {
  const docs = [inv('a', 'AR-2026-0012', 360, 'c1', 'Hausverwaltung Beispiel GmbH')]
  const s = suggest(tx(360, { text: 'Zahlung AR 2026 12 danke' }), { docs, customers, settings: { series: { rechnung: 'AR' } } })
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'a', amount: 360 }])
  assert.match(s.reasons[0], /im Verwendungszweck/)
})

test('Bank: Nummer im Zahlungsreferenz-Feld wird so begründet', () => {
  const docs = [inv('a', 'RE-2026-0003', 120, 'c1', 'x')]
  assert.match(suggest(tx(120, { reference: 'RE-2026-0003' }), { docs, customers }).reasons[0], /im Zahlungsreferenz-Feld/)
})

test('Bank: stornierte Rechnung neben einer offenen bleibt außen vor, die offene wird sicher zugeordnet', () => {
  const docs = [inv('a', 'RE-2026-0003', 120, 'c1', 'x'), inv('b', 'RE-2026-0007', 99, 'c1', 'x'), { id: 's', kind: 'storno', number: 'ST-2026-0001', refId: 'b', date: '2026-10-05', total: { gross: -99 } }]
  const s = suggest(tx(120, { text: 'RE-2026-0003 und RE-2026-0007' }), { docs, customers })
  assert.equal(s.level, 'sicher')
  assert.deepEqual(s.allocations, [{ docId: 'a', amount: 120 }])
  assert.match(s.reasons.join(' '), /RE-2026-0007 ist storniert und bleibt außen vor/)
})

test('Bank: über die IBAN zwei Rechnungen mit gleichem Betrag – die älteste wird vorgeschlagen', () => {
  const docs = [inv('neu', 'RE-2026-0020', 240, 'c1', 'x', { dueDate: '2026-11-01' }), inv('alt', 'RE-2026-0010', 240, 'c1', 'x', { dueDate: '2026-10-01' })]
  const s = suggest(tx(240, { iban: HV_IBAN, text: 'Dauerauftrag' }), { docs, customers })
  assert.equal(s.level, 'wahrscheinlich')
  assert.deepEqual(s.allocations, [{ docId: 'alt', amount: 240 }])
  assert.match(s.reasons[1], /2 Rechnungen mit genau diesem Betrag: die älteste \(RE-2026-0010\)/)
})

test('Bank: Kunde bekannt, Betrag passt zu nichts – älteste Rechnung unsicher vorgeschlagen', () => {
  const docs = [inv('a', 'RE-2026-0010', 240, 'c1', 'x'), inv('b', 'RE-2026-0011', 500, 'c1', 'x', { dueDate: '2026-11-01' })]
  const s = suggest(tx(100, { iban: 'AT48 3200 0000 1234 5864' }), { docs, customers })
  assert.equal(s.level, 'unsicher')
  assert.deepEqual(s.allocations, [{ docId: 'a', amount: 100 }])
  assert.match(s.reasons.join(' '), /Betrag passt zu keiner offenen Rechnung/)
})

test('Bank: ohne Kundenstamm passt der Name zum Rechnungsempfänger', () => {
  const docs = [inv('a', 'RE-2026-0004', 600, 'c2', 'Autohaus Maxglan Beispiel KG')]
  const s = suggest(tx(600, { name: 'AUTOHAUS MAXGLAN' }), { docs, customers: [] })
  assert.equal(s.level, 'wahrscheinlich')
  assert.match(s.reasons[0], /Name passt zum Rechnungsempfänger Autohaus Maxglan Beispiel KG/)
})

test('Bank: Rückbuchung und mehrdeutiger Betrag ohne Namen bekommen keinen Vorschlag', () => {
  const docs = [inv('a', 'RE-2026-0001', 50, 'c1', 'Eins'), inv('b', 'RE-2026-0002', 50, 'c2', 'Zwei')]
  const rev = suggest(tx(50, { reversal: true, text: 'RE-2026-0001' }), { docs, customers })
  assert.deepEqual([rev.level, rev.reasons[0]], [null, 'Rückbuchung (Storno der Bank): bitte prüfen.'])
  const amb = suggest(tx(50, { name: 'Jemand Anderer' }), { docs, customers: [] })
  assert.equal(amb.level, null)
  assert.match(amb.reasons[0], /2 offene Rechnungen mit diesem Betrag/)
})

test('Bank: Zuordnung mit unbekannter Rechnung bucht gar nichts (keine halbe Buchung)', () => {
  // Regression: früher stand die Zahlung bei der ersten Rechnung schon drin, die Buchung blieb aber offen
  const docs = [inv('d1', 'RE-2026-0001', 100, 'c1', 'x')]
  const t = { id: 'b9', date: '2026-11-04', amount: 150, status: 'offen', allocations: [] }
  assert.throws(() => applyAllocation(t, [{ docId: 'd1', amount: 100 }, { docId: 'gibt-es-nicht', amount: 50 }], docs), /Rechnung nicht gefunden/)
  assert.deepEqual(docs[0].payments, [])
  assert.equal(docs[0].history, undefined)
  assert.equal(t.status, 'offen')
  assert.equal(openAmount(docs[0], docs, {}), 100)
})

test('Bank: Zuordnung vermerkt Bank, Name und Datum; ein Cent Abweichung wird hingenommen, zwei nicht', () => {
  const docs = [inv('d1', 'RE-2026-0001', 100, 'c1', 'x')]
  const t = { id: 'b1', date: '2026-11-04', amount: 100, name: 'Hausverwaltung', status: 'offen', allocations: [] }
  assert.throws(() => applyAllocation({ ...t }, [{ docId: 'd1', amount: 100.02 }], docs), /ergeben nicht/)
  assert.throws(() => applyAllocation({ ...t }, [], docs), /Keine Rechnung gewählt/)
  const touched = applyAllocation(t, [{ docId: 'd1', amount: 100.01 }], docs, { by: 'Büro', at: '2026-11-05T08:00:00Z', newId: () => 'p1' })
  assert.deepEqual(touched.map((d) => d.id), ['d1'])
  assert.deepEqual(docs[0].payments, [{ id: 'p1', date: '2026-11-04', amount: 100.01, note: 'Bank: Hausverwaltung', bank: 'b1', by: 'Büro', at: '2026-11-05T08:00:00Z' }])
  assert.equal(docs[0].history.at(-1).text, 'Zahlung 100,01 € vom 04.11.2026 (Bankabgleich)')
  assert.deepEqual([t.status, t.allocations, t.by], ['zugeordnet', [{ docId: 'd1', amount: 100.01 }], 'Büro'])
})

test('Bank: IBAN merken nur gültig, bei vorhandenem Kunden und ohne Doppelte (auch mit Leerzeichen gespeichert)', () => {
  assert.equal(rememberIban(null, HV_IBAN), false)
  const c = { id: 'c1', ibans: ['AT48 3200 0000 1234 5864'] }
  assert.equal(rememberIban(c, 'kaputt'), false)
  assert.equal(rememberIban(c, HV_IBAN), false)
  assert.equal(rememberIban(c, 'de89 3704 0044 0532 0130 00'), true)
  assert.deepEqual(c.ibans, [HV_IBAN, 'DE89370400440532013000'])
})

test('Kopfzeile: „Partner IBAN“ ohne Namensspalte wird IBAN, nicht Name', async () => {
  const { readStatement } = await import('../src/core/bank.js')
  const r = readStatement('Datum;Betrag;Partner IBAN;Verwendungszweck\n04.11.2026;240,00;AT48 3200 0000 1234 5864;Miete\n')
  const t = r.transactions?.[0] || r.rows?.[0] || r[0]
  assert.ok(t, JSON.stringify(r).slice(0, 200))
  assert.equal(t.name || '', '')
  assert.match(String(t.iban).replace(/\s/g, ''), /^AT483200000012345864$/)
})
