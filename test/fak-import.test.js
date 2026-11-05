import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync, inflateSync } from 'node:zlib'

import {
  buildImport,
  detectNumberFormat,
  detectTable,
  eInvoiceFromPdf,
  kindOf,
  matchColumns,
  mergeImport,
  money,
  numberInName,
  numberingAfterImport,
  parseDateLoose,
  parseEInvoice,
  tableFromCsv,
  tablesFromXml,
} from '../src/core/fak-import.js'
import { checksumOf, emptyInvoicing, intact, nextNumber, openAmount, stateOf } from '../src/core/invoicing.js'

const csv = (name, lines) => tableFromCsv(lines.join('\n'), name)
let n = 0
const newId = (p) => `${p}${++n}`
const NOW = '2026-11-05T10:00:00.000Z'

// So ähnlich sehen Tabellen-Exporte aus orgaMAX aus (Spalten deutsch, Semikolon, Komma als Dezimalzeichen)
const KUNDEN = csv('Kunden', [
  'Kundennummer;Firma;Anrede;Vorname;Nachname;Straße;PLZ;Ort;Land;Telefon;E-Mail;USt-IdNr.;Zahlungsbedingung;Kundengruppe;Branche intern',
  '10001;Spar Österreich GmbH;Herr;Max;Maier;Europastraße 3;5020;Salzburg;Österreich;+43 662 1234;rechnung@spar.example;ATU12345678;14 Tage 2 % Skonto;Handel;Lebensmittel',
  '10002;;Frau;Anna;Huber;Gaisbergstraße 5;5020;Salzburg;AT;;anna@example.at;;;Privat;',
  '10003;Bäckerei Fuchs KG;;;;Hauptplatz 1;83395;Freilassing;Deutschland;;;DE123456789;;;',
])
const ARTIKEL = csv('Artikel', [
  'Artikelnummer;Bezeichnung;Beschreibung;Einheit;VK netto;MwSt-Satz;EK netto;Warengruppe;gesperrt',
  'UR-01;Unterhaltsreinigung;Unterhaltsreinigung lt. Leistungsverzeichnis;Monat;450,00;20 %;;Reinigung;nein',
  'GR-01;Glasreinigung;;m²;2,80;20;1,10;Glas;nein',
  'ALT-9;Alter Artikel;;Stk;10;20;;;ja',
])
const RECHNUNGEN = csv('Rechnungen', [
  'Belegart;Rechnungsnummer;Datum;Kundennummer;Kunde;Netto;MwSt;Brutto;Fällig am;Bezahlt am;Offen;Mahnstufe;Ihr Zeichen',
  'Rechnung;RE-2025-0151;15.10.2025;10001;Spar Österreich GmbH;450,00;90,00;540,00;29.10.2025;27.10.2025;0,00;0;B-778',
  'Rechnung;RE-2025-0152;31.10.2025;10002;Anna Huber;100,00;20,00;120,00;14.11.2025;;120,00;1;',
  'Gutschrift;GS-2025-0003;03.11.2025;10001;Spar Österreich GmbH;50,00;10,00;60,00;03.11.2025;;;;',
  'Angebot;AN-2025-0040;01.09.2025;10003;Bäckerei Fuchs KG;800,00;160,00;960,00;;;;;',
  'Lieferschein;LS-2025-0001;01.09.2025;10003;Bäckerei Fuchs KG;;;;;;;;',
])
const POSITIONEN = csv('Positionen', [
  'Belegnummer;Pos;Artikelnummer;Bezeichnung;Menge;Einheit;Einzelpreis;Rabatt;MwSt;Gesamt',
  'RE-2025-0151;1;UR-01;Unterhaltsreinigung Oktober 2025;1;Monat;450,00;0;20;450,00',
  'RE-2025-0152;1;;Fensterreinigung Wohnung;2;Std.;50,00;0;20;100,00',
  'GS-2025-0003;1;;Preisminderung Reklamation;1;Pauschale;50,00;0;20;50,00',
  'AN-2025-0040;1;GR-01;Glasreinigung Schaufenster;200;m²;2,80;0;20;560,00',
  'AN-2025-0040;2;;Anfahrt;1;Pauschale;240,00;0;20;240,00',
])
const TEXTE = csv('Textbausteine', [
  'Bezeichnung;Vorgangsart;Textart;Text',
  'Standard Rechnung;Rechnung;Einleitungstext;Sehr geehrte Damen und Herren, für unsere Leistungen erlauben wir uns zu verrechnen:',
  'Dank;Rechnung;Schlusstext;Vielen Dank für Ihren Auftrag. Wir freuen uns auf die weitere Zusammenarbeit.',
  'Angebot Einleitung;Angebot;Einleitungstext;Gerne bieten wir Ihnen folgende Leistungen an, wie besprochen:',
  'Mahnung 1;Mahnung;Text;Leider konnten wir bis heute keinen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag.',
])
const ZAHLUNGSBEDINGUNGEN = csv('Zahlungsbedingungen', ['Bezeichnung;Tage netto;Skonto %;Skonto Tage;Text', '14 Tage 2 % Skonto;14;2;7;Zahlbar binnen 14 Tagen netto, binnen 7 Tagen 2 % Skonto', 'Sofort;0;0;0;Zahlbar sofort ohne Abzug'])
const ANSPRECHPARTNER = csv('Ansprechpartner', ['Kundennummer;Vorname;Nachname;Funktion;Telefon;E-Mail', '10001;Eva;Berger;Filialleitung;+43 662 999;eva.berger@spar.example', '10003;Paul;Fuchs;Inhaber;;paul@fuchs.example'])
const ABOS = csv('Abo-Rechnungen', ['Bezeichnung;Kundennummer;Intervall;Nächste Rechnung;Positionstext;Menge;Einheit;Preis;MwSt;Status', 'Unterhalt Spar;10001;monatlich;01.12.2025;Unterhaltsreinigung lt. Vertrag;1;Monat;450,00;20;aktiv', 'Glas Fuchs;10003;vierteljährlich;01.01.2026;Glasreinigung;1;Pauschale;300;20;aktiv'])

const analyse = (tables) => tables.map((table) => ({ table, ...detectTable(table) }))

test('Spalten und Tabellen erkennen (deutsch wie in orgaMAX, auch Datenbank-Namen)', () => {
  const kinds = analyse([KUNDEN, ARTIKEL, RECHNUNGEN, POSITIONEN, TEXTE, ZAHLUNGSBEDINGUNGEN, ANSPRECHPARTNER, ABOS]).map((x) => x.kind)
  assert.deepEqual(kinds, ['customers', 'articles', 'documents', 'lines', 'textBlocks', 'paymentTerms', 'contacts', 'recurring'])
  const m = matchColumns('customers', KUNDEN.columns)
  assert.equal(KUNDEN.columns[m.customerNo], 'Kundennummer')
  assert.equal(KUNDEN.columns[m.uid], 'USt-IdNr.')
  assert.equal(KUNDEN.columns[m.zip], 'PLZ')
  // ohne aussagekräftigen Dateinamen, Spalten wie in der Datenbank
  const db = { name: 'export1', columns: ['CUSTOMERNO', 'NAME1', 'STREET', 'ZIP', 'CITY', 'PHONE'], rows: [['1', 'A', 'B', '5020', 'S', '']] }
  assert.equal(detectTable(db).kind, 'customers')
  const pos = { name: 'tabelle', columns: ['Rechnungsnr', 'Position', 'Text', 'Menge', 'Preis'], rows: [['R1', '1', 'x', '1', '2']] }
  assert.equal(detectTable(pos).kind, 'lines')
  const pay = { name: 'x', columns: ['Rechnungsnummer', 'Zahlungsdatum', 'Betrag'], rows: [['R1', '1.1.2026', '10']] }
  assert.equal(detectTable(pay).kind, 'payments')
})

test('Werte: Datum, Betrag, Belegart, Nummernformat, Nummer im Dateinamen', () => {
  assert.equal(parseDateLoose('15.10.2025'), '2025-10-15')
  assert.equal(parseDateLoose('1.2.25'), '2025-02-01')
  assert.equal(parseDateLoose('2025-10-15T00:00:00'), '2025-10-15')
  assert.equal(parseDateLoose('20251015'), '2025-10-15')
  assert.equal(parseDateLoose(45945), '2025-10-15', 'Excel-Datumszahl')
  assert.equal(parseDateLoose(new Date(2025, 9, 15)), '2025-10-15')
  assert.equal(money('€ 1.234,56'), 1234.56)
  assert.equal(money('-12,50 €'), -12.5)
  assert.equal(money('20 %'), 20)
  assert.equal(kindOf({ text: 'Rechnungskorrektur' }), 'korrektur')
  assert.equal(kindOf({ text: 'Gutschrift' }), 'korrektur')
  assert.equal(kindOf({ text: 'Stornorechnung' }), 'storno')
  assert.equal(kindOf({ text: 'Auftragsbestätigung' }), 'auftrag')
  assert.equal(kindOf({ text: 'Abschlagsrechnung' }), 'rechnung')
  assert.equal(kindOf({ text: 'Lieferschein' }), 'lieferschein')
  assert.equal(kindOf({ text: 'Proformarechnung' }), 'proforma')
  assert.equal(kindOf({ number: 'LS-2025-3' }), 'lieferschein')
  assert.equal(kindOf({ text: 'Mahnung' }), '')
  assert.deepEqual(['Abschlagsrechnung', 'Anzahlungsrechnung', '2. Teilrechnung', 'Schlussrechnung', 'Endrechnung', 'Rechnung'].map(stageOf), ['abschlag', 'abschlag', 'abschlag', 'schluss', 'schluss', ''])
  assert.deepEqual(['Text', 'Titel', 'Zwischensumme', 'Bedarfsposition', 'Alternativposition', 'Artikel', ''].map(lineTypeOf), ['text', 'title', 'subtotal', 'optional', 'alternative', '', ''])
  assert.equal(kindOf({ number: 'AN-2025-1' }), 'angebot')
  assert.equal(kindOf({ tableName: 'Angebote 2025' }), 'angebot')
  assert.deepEqual(detectNumberFormat(['RE-2025-0151', 'RE-2025-0152'], ['2025', '2025']), { template: 'RE-{JJJJ}-{NR}', yearly: true, digits: 4 })
  assert.deepEqual(detectNumberFormat(['10234', '10235'], ['2025', '2026']), { template: '{NR}', yearly: false, digits: 5 })
  assert.deepEqual(detectNumberFormat(['20250153'], ['2025']), { template: '{JJJJ}{NR}', yearly: true, digits: 4 })
  assert.deepEqual(detectNumberFormat(['R25-0012'], ['2025']), { template: 'R{JJ}-{NR}', yearly: true, digits: 4 })
  assert.equal(numberInName('Rechnung_RE-2025-0152_Huber.pdf', ['RE-2025-0151', 'RE-2025-0152']), 'RE-2025-0152')
  assert.equal(numberInName('Rechnung 1530.pdf', ['153', '1530']), '1530')
  assert.equal(numberInName('Rechnung 1530.pdf', ['153']), null, '153 ist nicht 1530')
})

test('Übernahme: Kunden mit Einzelfeldern, Ansprechpartnern und Zahlungsbedingung, Artikel, Textbausteine', () => {
  const r = buildImport(analyse([KUNDEN, ARTIKEL, TEXTE, ZAHLUNGSBEDINGUNGEN, ANSPRECHPARTNER]), [], { newId, now: NOW })
  const spar = r.customers.find((c) => c.customerNo === '10001')
  assert.equal(spar.name, 'Spar Österreich GmbH')
  assert.deepEqual([spar.street, spar.zip, spar.city, spar.country, spar.uid], ['Europastraße 3', '5020', 'Salzburg', 'AT', 'ATU12345678'])
  assert.equal(spar.termsId, r.paymentTerms.find((t) => t.name === '14 Tage 2 % Skonto').id)
  assert.equal(spar.paymentDays, 14)
  assert.deepEqual(spar.extra, { 'Branche intern': 'Lebensmittel' }, 'nicht zugeordnete Spalten bleiben erhalten')
  assert.deepEqual(spar.contacts.map((c) => [c.name, c.role]), [['Eva Berger', 'Filialleitung']])
  const huber = r.customers.find((c) => c.customerNo === '10002')
  assert.equal(huber.name, 'Anna Huber', 'Privatkunde: Name aus Vor- und Nachname')
  assert.equal(huber.consumer, true)
  assert.equal(r.customers.find((c) => c.customerNo === '10003').country, 'DE')
  assert.deepEqual(r.articles.map((a) => [a.articleNo, a.price, a.vat, a.unit, a.active]), [['UR-01', 450, 20, 'Monat', true], ['GR-01', 2.8, 20, 'm²', true], ['ALT-9', 10, 20, 'Stk', false]])
  assert.equal(r.articles[1].cost, 1.1)
  assert.deepEqual(r.textBlocks.map((t) => [t.kind, t.place]), [['rechnung', 'intro'], ['rechnung', 'outro'], ['angebot', 'intro'], ['mahnung', 'reminder']])
  assert.deepEqual(r.paymentTerms.map((t) => [t.name, t.days, t.skontoPercent, t.skontoDays]), [['14 Tage 2 % Skonto', 14, 2, 7], ['Sofort', 0, 0, 0]])
})

test('Übernahme: Belege mit Positionen, Zahlungen, Mahnstufe, Gutschrift negativ, Lieferschein, Prüfsumme', () => {
  const r = buildImport(analyse([KUNDEN, ARTIKEL, RECHNUNGEN, POSITIONEN]), [], { newId, now: NOW })
  assert.equal(r.skipped.lieferscheine, 0)
  assert.equal(r.documents.find((d) => d.number === 'LS-2025-0001')?.kind, 'lieferschein')
  const by = (no) => r.documents.find((d) => d.number === no)
  const re1 = by('RE-2025-0151')
  assert.deepEqual([re1.kind, re1.date, re1.dueDate, re1.total.gross, re1.recipient.name, re1.reference], ['rechnung', '2025-10-15', '2025-10-29', 540, 'Spar Österreich GmbH', 'B-778'])
  assert.equal(re1.lines[0].articleNo, 'UR-01')
  assert.deepEqual(re1.payments.map((p) => [p.date, p.amount]), [['2025-10-27', 540]])
  assert.equal(re1.imported.system, 'orgaMAX')
  assert.ok(intact(re1), 'Prüfsumme passt')
  assert.equal(re1.recipient.address, 'z. H. Herr Max Maier\nEuropastraße 3\n5020 Salzburg')
  const re2 = by('RE-2025-0152')
  assert.equal(re2.payments, undefined, 'noch offen')
  assert.equal(re2.reminders.length, 1, 'Mahnstufe 1 übernommen')
  const all = r.documents
  assert.equal(openAmount(re2, all, {}), 120)
  assert.equal(stateOf(re1, all, '2026-11-05', {}), 'bezahlt')
  assert.equal(stateOf(re2, all, '2026-11-05', {}), 'ueberfaellig')
  const gs = by('GS-2025-0003')
  assert.deepEqual([gs.kind, gs.total.gross, gs.lines[0].qty], ['korrektur', -60, -1])
  const an = by('AN-2025-0040')
  assert.deepEqual([an.kind, an.lines.length, an.total.net, an.status], ['angebot', 2, 800, 'offen'])
})

test('Belegkopf ohne Positionen: Summen aus orgaMAX; Abweichung zwischen Positionen und Kopf wird gemeldet', () => {
  const heads = csv('Rechnungen', ['Rechnungsnummer;Datum;Kunde;Netto;MwSt;Brutto', 'R-1;01.03.2025;Fremdkunde GmbH;100,00;20,00;120,00', 'R-2;02.03.2025;Fremdkunde GmbH;100,00;20,00;120,00'])
  const lines = csv('Positionen', ['Belegnummer;Pos;Bezeichnung;Menge;Einzelpreis;MwSt', 'R-2;1;Reinigung;1;99,00;20'])
  const r = buildImport(analyse([heads, lines]), [], { newId, now: NOW })
  const r1 = r.documents.find((d) => d.number === 'R-1')
  assert.deepEqual([r1.lines.length, r1.total.gross, r1.linesMissing], [0, 120, true])
  assert.ok(intact(r1))
  const r2 = r.documents.find((d) => d.number === 'R-2')
  assert.equal(r2.total.gross, 120, 'Summe aus orgaMAX gilt')
  assert.ok(r.warnings.some((w) => /R-2: Summe aus den Positionen \(118\.80\) weicht/.test(w)))
  assert.ok(r.warnings.some((w) => /Kunde „Fremdkunde GmbH“ nicht in den Kunden/.test(w)))
})

test('Einspielen: neu, ergänzen, nichts doppelt; zweite Übernahme ändert nichts; gleiche Nummer mit anderem Namen wird gemeldet', () => {
  const r = buildImport(analyse([KUNDEN, ARTIKEL, RECHNUNGEN, POSITIONEN, TEXTE, ZAHLUNGSBEDINGUNGEN, ABOS]), [], { newId, now: NOW })
  const before = { ...emptyInvoicing(), customers: [{ id: 'c-alt', name: 'Spar Österreich', customerNo: '10001', address: 'Europastraße 3\n5020 Salzburg', objectIds: ['o1'] }, { id: 'c-x', name: 'Ganz anderer Kunde', customerNo: '10003' }] }
  const { data, report } = mergeImport(before, r)
  assert.deepEqual(report.customers, { added: 2, updated: 1, same: 0 })
  const spar = data.customers.find((c) => c.id === 'c-alt')
  assert.equal(spar.uid, 'ATU12345678', 'leere Felder ergänzt')
  assert.equal(spar.address, 'Europastraße 3\n5020 Salzburg', 'vorhandene Werte bleiben')
  assert.deepEqual(spar.objectIds, ['o1'])
  assert.ok(report.conflicts.some((c) => /Kundennummer 10003: „Ganz anderer Kunde“/.test(c)))
  const re = data.documents.find((d) => d.number === 'RE-2025-0151')
  assert.equal(re.customerId, 'c-alt', 'Beleg zeigt auf den vorhandenen Kunden')
  assert.ok(intact(re))
  assert.equal(report.documents.added, 5)
  assert.deepEqual(report.recurring, { added: 2, skipped: 0 })
  const rec = data.recurring.find((x) => x.title === 'Glas Fuchs')
  assert.deepEqual([rec.interval, rec.startMonth, rec.lines[0].price], ['quartal', '2026-01', 300])
  const again = mergeImport(data, buildImport(analyse([KUNDEN, RECHNUNGEN, POSITIONEN, ABOS]), [], { newId, now: NOW }))
  assert.equal(again.report.documents.added, 0)
  assert.equal(again.report.documents.skipped, 5)
  assert.equal(again.report.recurring.added, 0)
  assert.equal(again.data.customers.length, data.customers.length)
})

test('Nummernkreise nach der Übernahme: Format erkannt, eigenes Format zählt weiter', () => {
  const r = buildImport(analyse([KUNDEN, RECHNUNGEN, POSITIONEN]), [], { newId, now: NOW })
  const plan = numberingAfterImport(r.documents, '2025-11-20', { series: { rechnung: 'AR' } })
  assert.deepEqual(plan.rechnung, { template: 'RE-{JJJJ}-{NR}', yearly: true, digits: 4, next: 153, last: 'RE-2025-0152', same: false })
  assert.equal(numberingAfterImport(r.documents, '2025-11-20', { series: { rechnung: 'RE' } }).rechnung.same, true, 'gleiches Format wie die App')
  // eigene Belege im selben Format zählen beim Weiterzählen mit
  const mixed = [...r.documents, { kind: 'rechnung', number: 'RE-2025-0170', date: '2025-11-19' }]
  assert.equal(numberingAfterImport(mixed, '2025-11-20').rechnung.next, 171)
  // durchlaufende Nummern wie oft in orgaMAX
  const docs = [{ kind: 'rechnung', number: '10234', date: '2025-12-30' }, { kind: 'rechnung', number: '10235', date: '2026-01-02' }]
  const s = { numberFormats: { rechnung: '{NR}' }, numberDigits: { rechnung: 5 } }
  assert.equal(nextNumber(docs, 'rechnung', '2026', s).number, '10236')
  assert.equal(nextNumber([], 'rechnung', '2026', { ...s, start: { rechnung: 10500 } }).number, '10500')
  // jährlich mit Jahr in der Nummer
  const y = { numberFormats: { rechnung: 'R{JJ}-{NR}' } }
  assert.equal(nextNumber([{ kind: 'rechnung', number: 'R25-0012', date: '2025-12-01' }], 'rechnung', '2026', y).number, 'R26-0001')
  assert.equal(nextNumber([{ kind: 'rechnung', number: 'R26-0012', date: '2026-02-01' }], 'rechnung', '2026', y).number, 'R26-0013')
  // ohne Einstellung: wie bisher
  assert.equal(nextNumber([{ kind: 'rechnung', number: 'RE-2026-0007', date: '2026-01-01' }], 'rechnung', '2026', {}).number, 'RE-2026-0008')
  assert.equal(nextNumber([], 'rechnung', '2026', { numberFormats: { rechnung: '{P}{JJJJ}{MM}-{NR}' }, digits: 3 }, { month: '03' }).number, 'RE202603-001')
})

// ---------------------------------------------------------------- E-Rechnung

const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>RE-2025-0160</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20251130</udt:DateTimeString></ram:IssueDateTime><ram:IncludedNote><ram:Content>Danke &amp; bis bald</ram:Content></ram:IncludedNote></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:SellerAssignedID>UR-01</ram:SellerAssignedID><ram:Name>Unterhaltsreinigung November</ram:Name><ram:Description>lt. LV</ram:Description></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>450.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="MON">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>450.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>2</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Fensterreinigung</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>45.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="HUR">2</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>90.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>B-801</ram:BuyerReference>
      <ram:SellerTradeParty><ram:Name>Cleanos Gebäudereinigung</ram:Name><ram:PostalTradeAddress><ram:PostcodeCode>5020</ram:PostcodeCode><ram:LineOne>Musterweg 1</ram:LineOne><ram:CityName>Salzburg</ram:CityName><ram:CountryID>AT</ram:CountryID></ram:PostalTradeAddress><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">ATU99999999</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:ID>10009</ram:ID><ram:Name>Hotel Alpenblick GmbH</ram:Name><ram:DefinedTradeContact><ram:PersonName>Frau Gruber</ram:PersonName></ram:DefinedTradeContact><ram:PostalTradeAddress><ram:PostcodeCode>5700</ram:PostcodeCode><ram:LineOne>Seeweg 7</ram:LineOne><ram:CityName>Zell am See</ram:CityName><ram:CountryID>AT</ram:CountryID></ram:PostalTradeAddress><ram:URIUniversalCommunication><ram:URIID schemeID="EM">buchhaltung@alpenblick.example</ram:URIID></ram:URIUniversalCommunication><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">ATU55555555</ram:ID></ram:SpecifiedTaxRegistration></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax><ram:CalculatedAmount>108.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>540.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">20251101</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">20251130</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>
      <ram:SpecifiedTradePaymentTerms><ram:Description>Zahlbar binnen 14 Tagen</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">20251214</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>540.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>540.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">108.00</ram:TaxTotalAmount><ram:GrandTotalAmount>648.00</ram:GrandTotalAmount><ram:DuePayableAmount>648.00</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>GS-2025-0009</cbc:ID><cbc:IssueDate>2025-12-02</cbc:IssueDate><cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>RE-2025-0160</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Cleanos Gebäudereinigung</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>Hotel Alpenblick GmbH</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>Seeweg 7</cbc:StreetName><cbc:CityName>Zell am See</cbc:CityName><cbc:PostalZone>5700</cbc:PostalZone><cac:Country><cbc:IdentificationCode>AT</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>ATU55555555</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">9.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">45.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">9.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">45.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">45.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">54.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">54.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="HUR">1</cbc:CreditedQuantity><cbc:LineExtensionAmount currencyID="EUR">45.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Gutschrift Fensterreinigung</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">45.00</cbc:PriceAmount></cac:Price></cac:CreditNoteLine>
</CreditNote>`

test('E-Rechnung lesen: ZUGFeRD/XRechnung (CII) und UBL-Gutschrift', () => {
  const a = parseEInvoice(CII)
  assert.deepEqual([a.format, a.kind, a.number, a.date, a.dueDate, a.serviceFrom, a.serviceTo, a.reference], ['CII', 'rechnung', 'RE-2025-0160', '2025-11-30', '2025-12-14', '2025-11-01', '2025-11-30', 'B-801'])
  assert.deepEqual(a.total, { net: 540, vat: 108, gross: 648, groups: [{ rate: 20, net: 540, vat: 108 }] })
  assert.deepEqual(a.lines.map((l) => [l.text, l.qty, l.unit, l.price, l.vat, l.articleNo]), [['Unterhaltsreinigung November', 1, 'Monat', 450, 20, 'UR-01'], ['Fensterreinigung', 2, 'Std.', 45, 20, '']])
  assert.deepEqual([a.buyer.name, a.buyer.uid, a.buyer.zip, a.buyer.city, a.buyer.email, a.buyer.contact, a.seller.uid], ['Hotel Alpenblick GmbH', 'ATU55555555', '5700', 'Zell am See', 'buchhaltung@alpenblick.example', 'Frau Gruber', 'ATU99999999'])
  assert.equal(a.note, 'Danke & bis bald')
  const b = parseEInvoice(UBL)
  assert.deepEqual([b.format, b.kind, b.number, b.refNumber, b.total.gross, b.lines[0].text], ['UBL', 'korrektur', 'GS-2025-0009', 'RE-2025-0160', 54, 'Gutschrift Fensterreinigung'])
  assert.throws(() => parseEInvoice('<foo/>'), /Keine E-Rechnung/)
})

test('E-Rechnungen übernehmen: Kunde neu angelegt, Positionen, Gutschrift mit Bezug und negativ', () => {
  const r = buildImport([], [{ invoice: parseEInvoice(CII), fileName: 'RE-2025-0160.xml' }, { invoice: parseEInvoice(UBL), fileName: 'GS.xml' }], { newId, now: NOW })
  assert.equal(r.customers.length, 1, 'derselbe Kunde nur einmal')
  const c = r.customers[0]
  assert.deepEqual([c.name, c.customerNo, c.street, c.zip, c.city, c.uid, c.contacts[0].name], ['Hotel Alpenblick GmbH', '10009', 'Seeweg 7', '5700', 'Zell am See', 'ATU55555555', 'Frau Gruber'])
  const re = r.documents.find((d) => d.number === 'RE-2025-0160')
  assert.deepEqual([re.total.gross, re.lines.length, re.customerId, re.imported.system, re.serviceFrom], [648, 2, c.id, 'E-Rechnung', '2025-11-01'])
  assert.ok(intact(re))
  const gs = r.documents.find((d) => d.number === 'GS-2025-0009')
  assert.deepEqual([gs.kind, gs.total.gross, gs.refId], ['korrektur', -54, re.id])
  assert.equal(openAmount(re, r.documents, {}), 594, 'Gutschrift mindert den offenen Betrag')
})

test('ZUGFeRD-PDF: eingebettete XML wird gefunden (FlateDecode)', async () => {
  const xml = Buffer.from(CII, 'utf8')
  const z = deflateSync(xml)
  const head = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, 'latin1')
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  const pdf = new Uint8Array(Buffer.concat([head, z, tail]))
  const found = await eInvoiceFromPdf(pdf, async (b) => new Uint8Array(inflateSync(Buffer.from(b))))
  assert.match(found, /RE-2025-0160/)
  assert.equal(await eInvoiceFromPdf(new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF')), async (b) => b), null)
})

test('XML-Tabellenexport: Zeilen und Spalten erkannt', () => {
  const xml = '<Export><Kunden><Kunde><Kundennummer>1</Kundennummer><Firma>A GmbH</Firma><PLZ>5020</PLZ><Ort>Salzburg</Ort></Kunde><Kunde><Kundennummer>2</Kundennummer><Firma>B KG</Firma><PLZ>5400</PLZ><Ort>Hallein</Ort></Kunde></Kunden></Export>'
  const [t] = tablesFromXml(xml, 'kunden.xml')
  assert.deepEqual(t.columns, ['Kundennummer', 'Firma', 'PLZ', 'Ort'])
  assert.deepEqual(t.rows[1], ['2', 'B KG', '5400', 'Hallein'])
  assert.equal(detectTable(t).kind, 'customers')
  assert.deepEqual(tablesFromXml(CII), [], 'E-Rechnung ist keine Tabelle')
})

test('Prüfsumme alter Belege bleibt gültig (neue Felder zählen nur, wenn gesetzt)', () => {
  const old = { kind: 'rechnung', number: 'RE-2026-0001', date: '2026-01-02', lines: [{ text: 'x', qty: 1, price: 10 }], total: { net: 10, vat: 2, gross: 12 } }
  const sum = checksumOf(old)
  assert.equal(checksumOf({ ...old, reference: '' }), sum)
  assert.notEqual(checksumOf({ ...old, reference: 'B-1' }), sum)
})

// ---------------------------------------------------------------- Komplettexport aus der orgaMAX-Datenbank (ODBC)

import { dbTableKind, dumpTable, lineTypeOf, rtfToText, stageOf } from '../src/core/fak-import.js'

const T = (name, cols, rows, types = {}) => {
  const csvText = [cols, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
  return dumpTable(csvText, name, cols.map((c) => ({ name: c, type: types[c] || (/^(ID|.*ID|TOTAL.*|PRICE|QUANTITY|AMOUNT|VATRATE|CONTACTTYPE|CUSTKIND|ORDERTYPE|INTERVAL|POSNO)$/.test(c) ? 'Decimal' : 'String') })))
}
const DUMP = [
  T('BAS_CUSTOMERS', ['ID', 'CUSTNO', 'CONTACTTYPE', 'CUSTKIND', 'NAME1', 'FIRSTNAME', 'LASTNAME', 'STREET', 'ZIPCODE', 'CITY', 'COUNTRY', 'PHONE1', 'EMAIL1', 'USTID', 'REMARK'], [
    [11, '10001', 0, 0, 'Hausverwaltung Mozart GmbH', '', '', 'Getreidegasse 9', '5020', 'Salzburg', 'AT', '0662 1', 'buero@mozart.example', 'ATU33333333', String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Schl\'fcssel beim Hausmeister\par Tor 2}`],
    [12, '70001', 3, 0, 'Reinigungsmittel Großhandel', '', '', 'Industriestr. 1', '4020', 'Linz', 'AT', '', '', '', ''],
    [13, '10002', 5, 1, '', 'Lisa', 'Brandl', 'Moosstraße 3', '5020', 'Salzburg', 'AT', '', 'lisa@example.at', '', ''],
  ]),
  T('BAS_ARTICLES', ['ID', 'ARTNO', 'ARTNAME', 'UNIT', 'SALESPRICE', 'VATRATE'], [[501, 'UR-01', 'Unterhaltsreinigung', 'Monat', 520, 20], [502, 'FR-01', 'Fensterreinigung', 'Std.', 42, 20]]),
  T('MOV_INVOICES', ['ID', 'INVNO', 'INVDATE', 'CUSTID', 'TOTALNET', 'TOTALVAT', 'TOTALGROSS', 'DUEDATE', 'INTROTEXT'], [
    [901, '2025-0101', '2025-10-31', 11, 604, 120.8, 724.8, '2025-11-14', String.raw`{\rtf1\ansi Sehr geehrte Damen und Herren,\par f\u252?r unsere Leistungen:}`],
    [902, '2025-0102', '2025-11-30', 11, 520, 104, 624, '2025-12-14', ''],
    [903, '2025-0103', '2025-12-01', 11, -42, -8.4, -50.4, '2025-12-01', ''],
  ], { INVNO: 'String' }),
  T('MOV_INVOICES_POSITIONS', ['ID', 'INVID', 'POSNO', 'ARTID', 'ARTNAME', 'QUANTITY', 'UNIT', 'PRICE', 'VATRATE', 'TOTALNET'], [
    [1, 901, 1, 501, '', 1, 'Monat', 520, 20, 520],
    [2, 901, 2, 502, 'Fensterreinigung Stiegenhaus', 2, 'Std.', 42, 20, 84],
    [3, 902, 1, 501, 'Unterhaltsreinigung November', 1, 'Monat', 520, 20, 520],
    [4, 903, 1, 502, 'Gutschrift Fensterreinigung', 1, 'Std.', 42, 20, 42],
  ]),
  T('MOV_ORDERS', ['ID', 'ORDERNO', 'ORDERDATE', 'ORDERTYPE', 'CUSTID', 'TOTALNET', 'TOTALGROSS'], [[901, 'AN-77', '2025-09-01', 1, 13, 300, 360], [902, 'AB-12', '2025-09-10', 2, 11, 520, 624]]),
  T('MOV_ORDERS_POSITIONS', ['ID', 'ORDERID', 'POSNO', 'ARTNAME', 'QUANTITY', 'PRICE', 'VATRATE'], [[1, 901, 1, 'Grundreinigung Wohnung', 1, 300, 20], [2, 902, 1, 'Unterhaltsreinigung lt. Vertrag', 1, 520, 20]]),
  T('MOV_PAYMENTS', ['ID', 'INVID', 'PAYDATE', 'AMOUNT', 'CASHDISCOUNT'], [[1, 901, '2025-11-10', 700, 0], [2, 901, '2025-11-20', 10.3, 14.5]], { CASHDISCOUNT: 'Decimal' }),
  T('MOV_INVOICES_SERIES', ['ID', 'CUSTID', 'CAPTION', 'INTERVAL', 'NEXTDATE'], [[61, 11, 'Unterhalt Mozart', 3, '2026-01-01']]),
  T('MOV_INVOICES_SERIES_POSITIONS', ['ID', 'SERIESID', 'ARTNAME', 'QUANTITY', 'PRICE', 'VATRATE'], [[1, 61, 'Unterhaltsreinigung (Quartal)', 1, 1500, 20]]),
  T('SYS_SETTINGS', ['ID', 'KEYNAME', 'KEYVALUE'], [[1, 'x', 'y']]),
]

test('orgaMAX-Datenbank: Tabellen nach Namen, RTF zu Text, Zahlen als Zahl', () => {
  assert.deepEqual(DUMP.map((t) => dbTableKind(t.name)), ['customers', 'articles', 'documents', 'lines', 'documents', 'lines', 'payments', 'recurring', 'lines', null])
  assert.equal(rtfToText(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Schl\'fcssel beim Hausmeister\par Tor 2}`), 'Schlüssel beim Hausmeister\nTor 2')
  assert.equal(rtfToText('nur Text'), 'nur Text')
  assert.equal(DUMP[0].rows[0][0], 11, 'Zahl bleibt Zahl')
  assert.equal(DUMP[0].rows[0][14], 'Schlüssel beim Hausmeister\nTor 2')
  assert.equal(DUMP[2].rows[0][1], '2025-0101', 'Belegnummer als Text')
})

test('orgaMAX-Datenbank: Verknüpfungen über interne IDs, Lieferanten weg, Interessent, Zahlungen, Angebot/Auftrag, Abo mit Positionen', () => {
  const sources = DUMP.filter((t) => dbTableKind(t.name)).map((table) => ({ table, kind: dbTableKind(table.name), map: matchColumns(dbTableKind(table.name), table.columns) }))
  const r = buildImport(sources, [], { newId, now: NOW })
  assert.equal(r.skipped.lieferanten, 1)
  assert.deepEqual(r.customers.map((c) => c.name), ['Hausverwaltung Mozart GmbH', 'Lisa Brandl'])
  const mozart = r.customers[0]
  assert.equal(mozart.note, 'Schlüssel beim Hausmeister\nTor 2')
  const lisa = r.customers[1]
  assert.deepEqual([lisa.group, lisa.consumer], ['Interessent', true])
  const by = (no) => r.documents.find((d) => d.number === no)
  const re = by('2025-0101')
  assert.deepEqual([re.kind, re.customerId, re.total.gross, re.lines.length, re.lines[0].text, re.lines[0].articleNo], ['rechnung', mozart.id, 724.8, 2, 'Unterhaltsreinigung', 'UR-01'])
  assert.equal(re.intro, 'Sehr geehrte Damen und Herren,\nfür unsere Leistungen:')
  assert.deepEqual(re.payments.map((p) => [p.kind || 'zahlung', p.date, p.amount]), [['zahlung', '2025-11-10', 700], ['zahlung', '2025-11-20', 10.3], ['skonto', '2025-11-20', 14.5]])
  assert.equal(stateOf(re, r.documents, '2026-01-10', {}), 'bezahlt', 'mit Skonto bezahlt')
  assert.equal(by('2025-0102').payments, undefined, 'ohne Zahlung offen')
  const gs = by('2025-0103')
  assert.deepEqual([gs.kind, gs.total.gross, gs.lines[0].qty], ['korrektur', -50.4, -1])
  // gleiche interne ID (901) in MOV_INVOICES und MOV_ORDERS: Positionen gehören zur richtigen Tabelle
  const an = by('AN-77')
  assert.deepEqual([an.kind, an.customerId, an.lines.map((l) => l.text)], ['angebot', lisa.id, ['Grundreinigung Wohnung']])
  assert.deepEqual([by('AB-12').kind, by('AB-12').lines[0].text], ['auftrag', 'Unterhaltsreinigung lt. Vertrag'])
  const rec = r.recurring[0]
  assert.deepEqual([rec.title, rec.interval, rec.startMonth, rec.customerId, rec.lines.map((l) => [l.text, l.price])], ['Unterhalt Mozart', 'quartal', '2026-01', mozart.id, [['Unterhaltsreinigung (Quartal)', 1500]]])
  assert.ok(r.documents.every(intact))
  // zweite Übernahme in vorhandene Daten: Kunde über die interne ID wiedergefunden, nichts doppelt
  const { data } = mergeImport(emptyInvoicing(), r)
  const again = mergeImport(data, buildImport(sources, [], { newId, now: NOW, existing: data }))
  assert.deepEqual([again.report.customers.added, again.report.documents.added, again.report.recurring.added], [0, 0, 0])
})

test('Abschlag/Schluss, Positionsarten, Proforma und SEPA-Mandat aus orgaMAX', () => {
  const kunden = csv('Kunden', ['Kundennummer;Firma;Straße;PLZ;Ort;IBAN;Mandatsreferenz;Mandatsdatum;Zahlungsart', '40001;Wohnbau Beispiel GmbH;Weg 1;5020;Salzburg;AT611904300234573201;MAND-40001;12.03.2024;SEPA-Lastschrift'])
  const belege = csv('Vorgänge', ['Belegart;Belegnummer;Datum;Kundennummer;Netto;MwSt;Brutto', 'Abschlagsrechnung;RE-2025-0201;01.06.2025;40001;1000;200;1200', 'Schlussrechnung;RE-2025-0230;30.06.2025;40001;3000;600;3600', 'Angebot;AN-2025-0090;01.05.2025;40001;3000;600;3600', 'Proformarechnung;PF-2025-0003;20.05.2025;40001;500;100;600'])
  const pos = csv('Positionen', ['Belegnummer;Pos;Positionsart;Bezeichnung;Menge;Einzelpreis;MwSt;Alternative zu', 'AN-2025-0090;1;Titel;Bauendreinigung Haus A;;;;', 'AN-2025-0090;2;;Grundreinigung;1;3000;20;', 'AN-2025-0090;3;Bedarfsposition;Fenster außen;1;400;20;', 'AN-2025-0090;4;Alternativposition;Grundreinigung mit Dampf;1;3300;20;2', 'AN-2025-0090;5;Text;Ausführung nach Absprache.;;;;'])
  const r = buildImport(analyse([kunden, belege, pos]), [], { newId, now: NOW })
  const by = (no) => r.documents.find((d) => d.number === no)
  assert.equal(by('RE-2025-0201').stage, 'abschlag')
  assert.equal(by('RE-2025-0230').stage, 'schluss')
  assert.equal(by('PF-2025-0003').kind, 'proforma')
  const an = by('AN-2025-0090')
  assert.deepEqual(an.lines.map((l) => l.type || 'item'), ['title', 'item', 'optional', 'alternative', 'text'])
  assert.equal(an.lines[3].altTo, an.lines[1].id, 'Alternative zeigt auf Position 2')
  assert.equal(an.total.net, 3000, 'Option und Alternative zählen nicht')
  assert.ok(r.documents.every(intact))
  const c = r.customers[0]
  assert.deepEqual([c.mandate.reference, c.mandate.signedAt, c.mandate.scheme, c.mandate.sequence, c.mandate.active, c.iban], ['MAND-40001', '2024-03-12', 'CORE', 'RCUR', true, 'AT611904300234573201'])
})
