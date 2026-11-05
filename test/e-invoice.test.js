// E-Rechnung: UN/CEFACT CII (ZUGFeRD/Factur-X, Profil EN 16931) und ebInterface 6.1.
// Geprüft werden die Pflichtangaben und die Rechenregeln von EN 16931 (BR-CO-10 bis BR-CO-17, BR-S-08,
// Reverse Charge BR-AE, Kleinunternehmer BR-E). Gegen die XML-Schemata (XSD) prüft der Test zusätzlich, wenn
// CII_XSD (CrossIndustryInvoice_100pD16B.xsd) bzw. EBI_XSD (ebInterface 6.1 Invoice.xsd) gesetzt sind und
// xmllint da ist (die Schemata liegen nicht im Repository).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { correctionDraft, finalize, stornoDraft } from '../src/core/invoicing.js'
import { ciiXml, ebInterfaceXml, eInvoiceFileName, eInvoiceModel, eInvoiceProblems, unitCode } from '../src/export/e-invoice.js'

const IBAN = 'AT611904300234573201'
const settings = { sender: { name: 'Glanzwerk Reinigung GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678', email: 'office@glanzwerk.example', phone: '+43 662 000000' }, bank: { iban: IBAN, bic: 'BKAUATWW', name: 'Bank Beispiel' }, paymentDays: 14 }
const recipient = { name: 'Hausverwaltung Muster GmbH', address: 'z. H. Frau Mag. Huber\nPlatz 2\n5020 Salzburg', uid: 'ATU87654321', email: 'rechnung@hv.example', customerNo: '10001' }
const base = {
  id: 'd1',
  kind: 'rechnung',
  date: '2026-11-03',
  serviceFrom: '2026-10-01',
  serviceTo: '2026-10-31',
  dueDate: '2026-11-17',
  recipient,
  title: 'Unterhaltsreinigung Oktober 2026',
  intro: 'Für unsere Leistungen erlauben wir uns zu verrechnen:',
  outro: 'Vielen Dank & bis bald <3',
  reference: '4500012345',
  contactName: 'Frau Mag. Huber',
  deliveryAddress: 'Wohnanlage Lehen\nStraße 7\n5020 Salzburg',
  skonto: { percent: 2, days: 7 },
  discount: 5,
  lines: [
    { text: 'Unterhaltsreinigung Stiegenhaus lt. Vertrag', longText: '2× wöchentlich', articleNo: 'UR-01', qty: 1, unit: 'Monat', price: 980, vat: 20 },
    { text: 'Sonderreinigung\nKellerabteil', qty: 3.5, unit: 'Std.', price: 34, vat: 20, discount: 10 },
    { text: 'Reinigungsmittel', qty: 2, unit: 'Stk', price: 12.49, vat: 10 },
    { text: 'Gutschrift Fehlstunde', qty: 1, unit: 'Std.', price: -34, vat: 20 },
  ],
}
const fin = (d, docs = [], s = settings) => finalize(d, docs, s, { now: `${d.date}T10:00:00Z`, by: 'Büro' })
const inv = fin(base)

// ---------------------------------------------------------------- kleine XML-Hilfen (ohne Parser)

const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])
const one = (xml, tag) => all(xml, tag)[0]
const num = (s) => Number(s)
const sum = (list) => Math.round(list.reduce((a, s) => a + Number(s), 0) * 100) / 100
const r2 = (n) => Math.round(n * 100) / 100
const between = (xml, open, close) => xml.slice(xml.indexOf(open), xml.indexOf(close, xml.indexOf(open)) + close.length)
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))].map((m) => m[0])

/** Rechenregeln und Pflichtangaben nach EN 16931 (Auszug) für eine CII-Rechnung. */
function en16931(xml) {
  const head = between(xml, '<ram:ApplicableHeaderTradeSettlement>', '</ram:ApplicableHeaderTradeSettlement>')
  const sumBlock = between(head, '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>', '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
  const lines = blocks(xml, 'ram:IncludedSupplyChainTradeLineItem')
  const S = (tag) => num(one(sumBlock, tag) || 0)
  const errors = []
  const must = (ok, rule) => ok || errors.push(rule)
  must(one(xml, 'ram:ID') === 'urn:cen.eu:en16931:2017', 'BR-01')
  must(!!one(between(xml, '<rsm:ExchangedDocument>', '</rsm:ExchangedDocument>'), 'ram:ID'), 'BR-02')
  must(/<ram:IssueDateTime>\s*<udt:DateTimeString format="102">\d{8}</.test(xml), 'BR-03')
  must(['380', '381', '384'].includes(one(xml, 'ram:TypeCode')), 'BR-04')
  must(one(head, 'ram:InvoiceCurrencyCode') === 'EUR', 'BR-05')
  const seller = between(xml, '<ram:SellerTradeParty>', '</ram:SellerTradeParty>')
  const buyer = between(xml, '<ram:BuyerTradeParty>', '</ram:BuyerTradeParty>')
  must(!!one(seller, 'ram:Name'), 'BR-06')
  must(!!one(buyer, 'ram:Name'), 'BR-07')
  must(!!one(seller, 'ram:CountryID'), 'BR-09')
  must(!!one(buyer, 'ram:CountryID'), 'BR-11')
  must(lines.length > 0, 'BR-16')
  for (const l of lines) {
    must(!!one(l, 'ram:LineID') && !!one(l, 'ram:BilledQuantity') && /unitCode="[A-Z0-9]+"/.test(l) && !!one(l, 'ram:LineTotalAmount') && !!one(l, 'ram:Name'), 'BR-21..25')
    must(num(one(between(l, '<ram:NetPriceProductTradePrice>', '</ram:NetPriceProductTradePrice>'), 'ram:ChargeAmount')) >= 0, 'BR-27')
  }
  const lineTotals = lines.map((l) => one(between(l, '<ram:SpecifiedTradeSettlementLineMonetarySummation>', '</ram:SpecifiedTradeSettlementLineMonetarySummation>'), 'ram:LineTotalAmount'))
  must(S('ram:LineTotalAmount') === sum(lineTotals), 'BR-CO-10')
  const allowances = blocks(head, 'ram:SpecifiedTradeAllowanceCharge')
  must(S('ram:AllowanceTotalAmount') === sum(allowances.map((a) => one(a, 'ram:ActualAmount'))), 'BR-CO-11')
  must(S('ram:TaxBasisTotalAmount') === r2(S('ram:LineTotalAmount') - S('ram:AllowanceTotalAmount') + S('ram:ChargeTotalAmount')), 'BR-CO-13')
  const taxes = blocks(head, 'ram:ApplicableTradeTax')
  must(S('ram:TaxTotalAmount') === sum(taxes.map((t) => one(t, 'ram:CalculatedAmount'))), 'BR-CO-14')
  must(S('ram:GrandTotalAmount') === r2(S('ram:TaxBasisTotalAmount') + S('ram:TaxTotalAmount')), 'BR-CO-15')
  must(S('ram:DuePayableAmount') === r2(S('ram:GrandTotalAmount') - S('ram:TotalPrepaidAmount')), 'BR-CO-16')
  must(taxes.length > 0, 'BR-CO-18')
  for (const t of taxes) {
    const cat = one(t, 'ram:CategoryCode')
    const rate = num(one(t, 'ram:RateApplicablePercent'))
    const basis = num(one(t, 'ram:BasisAmount'))
    must(num(one(t, 'ram:CalculatedAmount')) === r2((basis * rate) / 100), `BR-CO-17 ${cat} ${rate}`)
    const lineSum = sum(lines.filter((l) => one(l, 'ram:CategoryCode') === cat && num(one(l, 'ram:RateApplicablePercent')) === rate).map((l) => one(between(l, '<ram:SpecifiedTradeSettlementLineMonetarySummation>', '</ram:SpecifiedTradeSettlementLineMonetarySummation>'), 'ram:LineTotalAmount')))
    const allowSum = sum(allowances.filter((a) => one(a, 'ram:CategoryCode') === cat && num(one(a, 'ram:RateApplicablePercent')) === rate).map((a) => one(a, 'ram:ActualAmount')))
    must(basis === r2(lineSum - allowSum), `BR-${cat}-08 ${rate}`)
    if (cat === 'AE') must(one(t, 'ram:ExemptionReasonCode') === 'VATEX-EU-AE' && num(one(t, 'ram:CalculatedAmount')) === 0 && /schemeID="VA"/.test(seller) && /schemeID="VA"/.test(buyer), 'BR-AE-02/09/10')
    if (cat === 'E') must(!!one(t, 'ram:ExemptionReason') && num(one(t, 'ram:CalculatedAmount')) === 0 && /schemeID="(VA|FC)"/.test(seller), 'BR-E-02/09/10')
    if (cat === 'S') must(rate > 0 && /schemeID="(VA|FC)"/.test(seller), 'BR-S-02/05')
  }
  if (S('ram:DuePayableAmount') > 0) must(!!one(head, 'ram:Description') || /<ram:DueDateDateTime>/.test(head), 'BR-CO-25')
  if (one(head, 'ram:TypeCode') === '58') must(!!one(head, 'ram:IBANID'), 'BR-61')
  return errors
}

// ---------------------------------------------------------------- CII

test('CII (ZUGFeRD/Factur-X EN 16931): Nummer, Datum, Leistungszeitraum, Verkäufer und Käufer mit UID, Fälligkeit, IBAN', () => {
  const xml = ciiXml(inv, settings)
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/)
  assert.equal(one(xml, 'ram:ID'), 'urn:cen.eu:en16931:2017')
  assert.match(xml, /<rsm:ExchangedDocument>\s*<ram:ID>RE-2026-0001<\/ram:ID>\s*<ram:TypeCode>380<\/ram:TypeCode>\s*<ram:IssueDateTime>\s*<udt:DateTimeString format="102">20261103</)
  assert.match(xml, /<ram:BillingSpecifiedPeriod>\s*<ram:StartDateTime>\s*<udt:DateTimeString format="102">20261001<\/udt:DateTimeString>\s*<\/ram:StartDateTime>\s*<ram:EndDateTime>\s*<udt:DateTimeString format="102">20261031</)
  const seller = between(xml, '<ram:SellerTradeParty>', '</ram:SellerTradeParty>')
  assert.equal(one(seller, 'ram:Name'), 'Glanzwerk Reinigung GmbH')
  assert.match(seller, /<ram:PostcodeCode>5020<\/ram:PostcodeCode>\s*<ram:LineOne>Musterstraße 1<\/ram:LineOne>\s*<ram:CityName>Salzburg<\/ram:CityName>\s*<ram:CountryID>AT</)
  assert.match(seller, /<ram:ID schemeID="VA">ATU12345678</)
  const buyer = between(xml, '<ram:BuyerTradeParty>', '</ram:BuyerTradeParty>')
  assert.match(buyer, /<ram:ID>10001<\/ram:ID>\s*<ram:Name>Hausverwaltung Muster GmbH</)
  assert.match(buyer, /<ram:PersonName>Frau Mag\. Huber</)
  assert.match(buyer, /<ram:LineOne>Platz 2</)
  assert.match(buyer, /<ram:ID schemeID="VA">ATU87654321</)
  assert.match(xml, /<ram:BuyerOrderReferencedDocument>\s*<ram:IssuerAssignedID>4500012345</)
  assert.match(xml, /<ram:ShipToTradeParty>\s*<ram:Name>Wohnanlage Lehen<\/ram:Name>/)
  assert.match(xml, /<ram:DueDateDateTime>\s*<udt:DateTimeString format="102">20261117</)
  assert.match(xml, /<ram:TypeCode>58<\/ram:TypeCode>[\s\S]*<ram:IBANID>AT611904300234573201<\/ram:IBANID>[\s\S]*<ram:BICID>BKAUATWW</)
  assert.equal(one(xml, 'ram:PaymentReference'), 'RE-2026-0001')
  assert.match(one(xml, 'ram:Description'), /2× wöchentlich/, 'Langtext als Beschreibung der Position')
  assert.match(xml, /2 % Skonto \(€\s24,53\), Zahlbetrag dann €\s1\.202,10/, 'Skonto im Text der Zahlungsbedingung')
  assert.doesNotMatch(xml, /<ram:LineTwo>Wohnanlage Lehen/, 'Name der Lieferadresse nicht doppelt')
  assert.match(xml, /Vielen Dank &amp; bis bald &lt;3/, 'Sonderzeichen maskiert')
  assert.deepEqual(en16931(xml), [])
})

test('CII: Positionen mit Menge, Einheit, Einzelpreis, Rabatt; Steuer je Satz; Summen', () => {
  const xml = ciiXml(inv, settings)
  const lines = blocks(xml, 'ram:IncludedSupplyChainTradeLineItem')
  assert.equal(lines.length, 4)
  assert.match(lines[0], /<ram:SellerAssignedID>UR-01<\/ram:SellerAssignedID>/)
  assert.match(lines[0], /<ram:BilledQuantity unitCode="MON">1\.00</)
  assert.match(lines[1], /<ram:Name>Sonderreinigung<\/ram:Name>\s*<ram:Description>Kellerabteil</)
  assert.match(lines[1], /<ram:BilledQuantity unitCode="HUR">3\.50</)
  assert.match(lines[1], /<ram:CalculationPercent>10<\/ram:CalculationPercent>\s*<ram:BasisAmount>119\.00<\/ram:BasisAmount>\s*<ram:ActualAmount>11\.90</)
  assert.match(lines[1], /<ram:LineTotalAmount>107\.10</)
  assert.match(lines[2], /<ram:CategoryCode>S<\/ram:CategoryCode>\s*<ram:RateApplicablePercent>10</)
  // negativer Preis: Vorzeichen in der Menge (BR-27)
  assert.match(lines[3], /<ram:ChargeAmount>34\.00<\/ram:ChargeAmount>[\s\S]*<ram:BilledQuantity unitCode="HUR">-1\.00<[\s\S]*<ram:LineTotalAmount>-34\.00</)
  const t = inv.total
  assert.equal(num(one(xml, 'ram:GrandTotalAmount')), t.gross)
  assert.equal(num(one(xml, 'ram:TaxBasisTotalAmount')), t.net)
  assert.equal(num(all(xml, 'ram:TaxTotalAmount')[0]), t.vat)
  assert.deepEqual(blocks(between(xml, '<ram:ApplicableHeaderTradeSettlement>', '</ram:ApplicableHeaderTradeSettlement>'), 'ram:ApplicableTradeTax').map((x) => [one(x, 'ram:RateApplicablePercent'), num(one(x, 'ram:BasisAmount')), num(one(x, 'ram:CalculatedAmount'))]), t.groups.map((g) => [String(g.rate), g.net, g.vat]))
})

test('CII Reverse Charge: Kategorie AE, Steuer 0, Befreiungsgrund mit Code VATEX-EU-AE und Hinweistext, beide UIDs', () => {
  const rc = fin({ ...base, id: 'rc', reverseCharge: true, skonto: null })
  const xml = ciiXml(rc, settings)
  const tax = blocks(between(xml, '<ram:ApplicableHeaderTradeSettlement>', '</ram:ApplicableHeaderTradeSettlement>'), 'ram:ApplicableTradeTax')
  assert.equal(tax.length, 1)
  assert.equal(one(tax[0], 'ram:CategoryCode'), 'AE')
  assert.equal(one(tax[0], 'ram:ExemptionReasonCode'), 'VATEX-EU-AE')
  assert.match(one(tax[0], 'ram:ExemptionReason'), /Steuerschuld geht auf den Leistungsempfänger über/)
  assert.equal(one(tax[0], 'ram:CalculatedAmount'), '0.00')
  assert.ok(blocks(xml, 'ram:IncludedSupplyChainTradeLineItem').every((l) => /<ram:CategoryCode>AE<\/ram:CategoryCode>\s*<ram:RateApplicablePercent>0</.test(l)))
  assert.deepEqual(en16931(xml), [])
  assert.deepEqual(eInvoiceProblems({ ...rc, recipient: { ...recipient, uid: '' } }, settings).filter((p) => p.level === 'error').map((p) => p.text), ['Reverse Charge: UID-Nummer des Empfängers fehlt.'])
})

test('CII Kleinunternehmer: Kategorie E mit Befreiungsgrund, Steuernummer statt UID', () => {
  const ku = { ...settings, smallBusiness: true, sender: { ...settings.sender, uid: '', taxNo: '91 123/4567' } }
  const doc = fin({ ...base, id: 'ku', skonto: null }, [], ku)
  const xml = ciiXml(doc, ku)
  const tax = blocks(between(xml, '<ram:ApplicableHeaderTradeSettlement>', '</ram:ApplicableHeaderTradeSettlement>'), 'ram:ApplicableTradeTax')
  assert.deepEqual(tax.map((x) => [one(x, 'ram:CategoryCode'), one(x, 'ram:RateApplicablePercent'), one(x, 'ram:CalculatedAmount')]), [['E', '0', '0.00']])
  assert.match(one(tax[0], 'ram:ExemptionReason'), /Kleinunternehmer gemäß § 6 Abs\. 1 Z 27 UStG/)
  assert.match(xml, /<ram:ID schemeID="FC">91 123\/4567</)
  assert.doesNotMatch(between(xml, '<ram:SellerTradeParty>', '</ram:SellerTradeParty>'), /schemeID="VA"/)
  assert.deepEqual(en16931(xml), [])
})

test('CII Storno und Korrektur: Gutschrift 381 mit positiven Beträgen und Bezug auf die Rechnung', () => {
  const st = fin(stornoDraft(inv, { id: 's1', date: '2026-11-05', reason: 'falsches Objekt' }), [inv])
  const xml = ciiXml(st, settings, { ref: inv })
  assert.equal(one(xml, 'ram:TypeCode'), '381')
  assert.equal(num(one(xml, 'ram:DuePayableAmount')), -st.total.gross)
  assert.match(xml, /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-0001<\/ram:IssuerAssignedID>\s*<ram:FormattedIssueDateTime>\s*<qdt:DateTimeString format="102">20261103</)
  assert.doesNotMatch(xml, /<ram:PaymentReference>/)
  assert.deepEqual(en16931(xml), [])
  const ko = fin(correctionDraft(inv, { id: 'k1', date: '2026-11-06', amount: 50, vat: 20 }), [inv, st])
  const kx = ciiXml(ko, settings, { ref: inv })
  assert.equal(one(kx, 'ram:TypeCode'), '381')
  assert.equal(one(kx, 'ram:GrandTotalAmount'), '60.00')
  assert.deepEqual(en16931(kx), [])
  // Korrektur mit Plusbetrag (Nachverrechnung): korrigierte Rechnung 384
  const plus = fin({ ...correctionDraft(inv, { id: 'k2', date: '2026-11-06', amount: 50, vat: 20 }), lines: [{ text: 'Nachverrechnung', qty: 1, unit: 'Pauschale', price: 50, vat: 20 }] }, [inv, st, ko])
  assert.equal(one(ciiXml(plus, settings, { ref: inv }), 'ram:TypeCode'), '384')
})

// ---------------------------------------------------------------- ebInterface 6.1

test('ebInterface 6.1: Kopf, Lieferzeitraum, Rechnungssteller mit Lieferantennummer, Empfänger mit Auftragsreferenz', () => {
  const xml = ebInterfaceXml(inv, settings, { supplierNo: '123456' })
  assert.match(xml, /<Invoice xmlns="http:\/\/www\.ebinterface\.at\/schema\/6p1\/" GeneratingSystem="Cleanos App" DocumentType="Invoice" InvoiceCurrency="EUR" DocumentTitle="Rechnung RE-2026-0001" Language="de">/)
  assert.equal(one(xml, 'InvoiceNumber'), 'RE-2026-0001')
  assert.equal(one(xml, 'InvoiceDate'), '2026-11-03')
  assert.match(xml, /<Delivery>\s*<Period>\s*<FromDate>2026-10-01<\/FromDate>\s*<ToDate>2026-10-31<\/ToDate>/)
  const biller = between(xml, '<Biller>', '</Biller>')
  assert.equal(one(biller, 'VATIdentificationNumber'), 'ATU12345678')
  assert.match(biller, /<Name>Glanzwerk Reinigung GmbH<\/Name>\s*<Street>Musterstraße 1<\/Street>\s*<Town>Salzburg<\/Town>\s*<ZIP>5020<\/ZIP>\s*<Country CountryCode="AT">Österreich<\/Country>/)
  assert.equal(one(biller, 'InvoiceRecipientsBillerID'), '123456')
  const rec = between(xml, '<InvoiceRecipient>', '</InvoiceRecipient>')
  assert.equal(one(rec, 'VATIdentificationNumber'), 'ATU87654321')
  assert.match(rec, /<OrderReference>\s*<OrderID>4500012345<\/OrderID>/)
  assert.match(rec, /<Contact>\s*<Name>Frau Mag\. Huber</)
  assert.equal(one(rec, 'BillersInvoiceRecipientID'), '10001')
  // Auftragsreferenz aus dem Dialog geht vor
  assert.match(ebInterfaceXml(inv, settings, { orderRef: '4711' }), /<OrderID>4711</)
})

test('ebInterface: Positionen, Rabatte, Steuer je Satz (S, AA), Summen, Zahlung und Skonto', () => {
  const xml = ebInterfaceXml(inv, settings)
  const items = blocks(xml, 'ListLineItem')
  assert.equal(items.length, 4)
  assert.match(items[0], /<Quantity Unit="MON">1\.00<\/Quantity>\s*<UnitPrice>980\.00<\/UnitPrice>/)
  assert.match(items[0], /<ArticleNumber ArticleNumberType="BillersArticleNumber">UR-01</)
  assert.match(items[1], /<ReductionListLineItem>\s*<BaseAmount>119\.00<\/BaseAmount>\s*<Percentage>10<\/Percentage>\s*<Amount>11\.90</)
  assert.match(items[2], /<TaxPercent TaxCategoryCode="AA">10</)
  // LineItemAmount = Menge × Einzelpreis − Rabatt
  for (const it of items) {
    const q = num(one(it, 'Quantity'))
    const p = num(one(it, 'UnitPrice'))
    const red = num(one(it, 'Amount') || 0)
    assert.equal(num(one(it, 'LineItemAmount')), r2(q * p - red))
  }
  const reductions = blocks(between(xml, '<ReductionAndSurchargeDetails>', '</ReductionAndSurchargeDetails>'), 'Reduction')
  const tax = blocks(between(xml, '<Tax>', '</Tax>'), 'TaxItem')
  // Belegrabatt je Steuersatz: Positionen − Rabatte = Steuerbasis
  assert.equal(sum(reductions.map((x) => one(x, 'Amount'))), r2(sum(items.map((i) => one(i, 'LineItemAmount'))) - sum(tax.map((x) => one(x, 'TaxableAmount')))))
  assert.deepEqual(tax.map((x) => [x.match(/TaxCategoryCode="(\w+)"/)[1], num(one(x, 'TaxPercent')), num(one(x, 'TaxableAmount')), num(one(x, 'TaxAmount'))]), inv.total.groups.map((g) => [g.rate === 20 ? 'S' : 'AA', g.rate, g.net, g.vat]))
  // TotalGrossAmount = Positionen − Rabatte + Steuern
  assert.equal(num(one(xml, 'TotalGrossAmount')), r2(sum(items.map((i) => one(i, 'LineItemAmount'))) - sum(reductions.map((x) => one(x, 'Amount'))) + sum(tax.map((x) => one(x, 'TaxAmount')))))
  assert.equal(num(one(xml, 'TotalGrossAmount')), inv.total.gross)
  assert.equal(num(one(xml, 'PayableAmount')), inv.total.gross)
  assert.match(xml, /<UniversalBankTransaction>\s*<BeneficiaryAccount>\s*<BankName>Bank Beispiel<\/BankName>\s*<BIC>BKAUATWW<\/BIC>\s*<IBAN>AT611904300234573201<\/IBAN>\s*<BankAccountOwner>Glanzwerk Reinigung GmbH</)
  assert.match(xml, /<PaymentConditions>\s*<DueDate>2026-11-17<\/DueDate>\s*<Discount>\s*<PaymentDate>2026-11-10<\/PaymentDate>\s*<BaseAmount>[\d.]+<\/BaseAmount>\s*<Percentage>2<\/Percentage>\s*<Amount>[\d.]+</)
})

test('ebInterface: Reverse Charge AE mit Hinweis, Kleinunternehmer E ohne UID (ATU00000000), Storno als Gutschrift', () => {
  const rc = fin({ ...base, id: 'rc', reverseCharge: true, skonto: null })
  const rx = ebInterfaceXml(rc, settings)
  assert.match(between(rx, '<Tax>', '</Tax>'), /<TaxPercent TaxCategoryCode="AE">0<\/TaxPercent>\s*<TaxAmount>0\.00<\/TaxAmount>\s*<Comment>Die Steuerschuld geht auf den Leistungsempfänger über/)
  assert.match(rx, /<Comment>Die Steuerschuld geht auf den Leistungsempfänger über[^<]*<\/Comment>\s*<\/Invoice>/)
  const ku = { ...settings, smallBusiness: true, sender: { ...settings.sender, uid: '', taxNo: '91 123/4567' } }
  const kx = ebInterfaceXml(fin({ ...base, id: 'ku', skonto: null, recipient: { ...recipient, uid: '' } }, [], ku), ku)
  assert.match(kx, /<Biller>\s*<VATIdentificationNumber>ATU00000000<\/VATIdentificationNumber>\s*<FurtherIdentification IdentificationType="FASTNR">91 123\/4567</)
  assert.match(between(kx, '<InvoiceRecipient>', '</InvoiceRecipient>'), /<VATIdentificationNumber>ATU00000000</)
  assert.match(kx, /TaxCategoryCode="E">0</)
  const st = fin(stornoDraft(inv, { id: 's1', date: '2026-11-05', reason: 'falsches Objekt' }), [inv])
  const sx = ebInterfaceXml(st, settings, { ref: inv })
  assert.match(sx, /DocumentType="CreditMemo"/)
  assert.match(sx, /<CancelledOriginalDocument>\s*<InvoiceNumber>RE-2026-0001<\/InvoiceNumber>\s*<InvoiceDate>2026-11-03<\/InvoiceDate>\s*<DocumentType>Invoice<\/DocumentType>\s*<Comment>Grund: falsches Objekt</)
  assert.equal(num(one(sx, 'PayableAmount')), -st.total.gross)
  assert.match(sx, /<NoPayment\/>/)
  const ko = fin(correctionDraft(inv, { id: 'k1', date: '2026-11-06', amount: 50, vat: 20 }), [inv, st])
  assert.match(ebInterfaceXml(ko, settings, { ref: inv }), /<RelatedDocument>\s*<InvoiceNumber>RE-2026-0001</)
})

// ---------------------------------------------------------------- Prüfung, Einheiten, Dateinamen

test('Prüfung vor der E-Rechnung: nur festgeschriebene Rechnungen, lesbare Anschriften, UID, abweichende Altbelege', () => {
  assert.deepEqual(eInvoiceProblems(inv, settings), [])
  assert.match(eInvoiceProblems({ ...base }, settings)[0].text, /zuerst festschreiben/)
  assert.match(eInvoiceProblems({ ...inv, kind: 'angebot' }, settings)[0].text, /Rechnungen, Stornorechnungen und Rechnungskorrekturen/)
  const texts = (d, s = settings) => eInvoiceProblems(d, s).map((p) => p.text).join(' | ')
  assert.match(texts({ ...inv, recipient: { ...recipient, address: 'irgendwo' } }), /Anschrift des Empfängers: PLZ und Ort nicht erkannt/)
  assert.match(texts({ ...inv, sender: { ...inv.sender, address: 'Salzburg', uid: '' } }), /Anschrift der eigenen Firma.*UID-Nummer oder Steuernummer/)
  assert.match(texts({ ...inv, total: { ...inv.total, gross: 999 } }), /weicht vom festgeschriebenen Betrag ab/)
  assert.match(texts(inv, { ...settings, bank: {} }), /Keine IBAN/)
  assert.deepEqual(eInvoiceProblems(inv, settings, {}, 'ebinterface').map((p) => p.level), ['info'], 'Bund: Lieferantennummer fehlt')
  assert.deepEqual(eInvoiceProblems(inv, settings, { supplierNo: '1' }, 'ebinterface'), [])
})

test('Einheiten nach UN/ECE Rec. 20, Dateinamen, Inhalt für beide Formate', () => {
  assert.deepEqual(['Pauschale', 'Monat', 'Std.', 'm²', 'Stk', 'km', 'Quartal', 'h', 'qm', 'Tag', 'irgendwas'].map(unitCode), ['LS', 'MON', 'HUR', 'MTK', 'C62', 'KMT', 'QAN', 'HUR', 'MTK', 'DAY', 'C62'])
  assert.equal(eInvoiceFileName(inv, 'cii'), 'RE-2026-0001_factur-x.xml')
  assert.equal(eInvoiceFileName(inv, 'ebinterface'), 'RE-2026-0001_ebInterface.xml')
  const m = eInvoiceModel(inv, settings)
  assert.equal(m.grandTotal, inv.total.gross)
  assert.equal(m.buyer.contact, 'Frau Mag. Huber')
  assert.equal(m.delivery.name, 'Wohnanlage Lehen')
})

// ---------------------------------------------------------------- gegen die XML-Schemata (wenn vorhanden)

const xmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const CII_XSD = process.env.CII_XSD
const EBI_XSD = process.env.EBI_XSD

test('XSD: CII und ebInterface sind schemagültig', { skip: !xmllint || !CII_XSD || !EBI_XSD || !existsSync(CII_XSD) || !existsSync(EBI_XSD) ? 'CII_XSD/EBI_XSD nicht gesetzt oder xmllint fehlt' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'erechnung-'))
  const st = fin(stornoDraft(inv, { id: 's1', date: '2026-11-05', reason: 'x' }), [inv])
  const rc = fin({ ...base, id: 'rc', reverseCharge: true }, [inv, st])
  for (const [name, doc, opts] of [['re', inv, {}], ['st', st, { ref: inv }], ['rc', rc, {}]]) {
    writeFileSync(join(dir, `${name}-cii.xml`), ciiXml(doc, settings, opts))
    writeFileSync(join(dir, `${name}-ebi.xml`), ebInterfaceXml(doc, settings, { ...opts, supplierNo: '1' }))
    execFileSync('xmllint', ['--noout', '--schema', CII_XSD, join(dir, `${name}-cii.xml`)], { stdio: 'pipe' })
    execFileSync('xmllint', ['--noout', '--schema', EBI_XSD, join(dir, `${name}-ebi.xml`)], { stdio: 'pipe' })
  }
})
