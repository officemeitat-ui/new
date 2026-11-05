// E-Rechnung zu festgeschriebenen Rechnungen, Stornorechnungen und Rechnungskorrekturen, als eigene XML-Datei:
//
//  - ciiXml: UN/CEFACT Cross Industry Invoice (CII D16B) im Profil EN 16931. Das ist die XML von ZUGFeRD 2.x
//    „EN 16931“ bzw. Factur-X „EN 16931“ (Kennung urn:cen.eu:en16931:2017, Dateiname factur-x.xml).
//    pdfmake erzeugt kein PDF/A-3, deshalb steckt die XML nicht im PDF, sondern geht als eigene Datei mit
//    (Buchhaltungsprogramme lesen sie so ein; das PDF bleibt die lesbare Rechnung).
//  - ebInterfaceXml: ebInterface 6.1 (österreichischer Standard, Namensraum http://www.ebinterface.at/schema/6p1/),
//    z. B. für die E-Rechnung an den Bund über das Unternehmensserviceportal (USP, e-rechnung.gv.at). Die
//    Auftragsreferenz der bestellenden Stelle steht in InvoiceRecipient/OrderReference/OrderID, die
//    Lieferantennummer in Biller/InvoiceRecipientsBillerID.
//
// Beträge kommen aus demselben Rechenkern wie das PDF (core/invoicing.js → totals): Steuer je Steuersatz,
// Belegrabatt je Steuersatz als Abschlag, Positionsrabatt als Abschlag der Position. Steuerkategorien:
// 20 % S; 10 und 13 % S (CII) bzw. AA (ebInterface: reduzierter Satz); 0 % Z; Reverse Charge AE mit
// Befreiungsgrund (Code VATEX-EU-AE und Hinweistext); Kleinunternehmer E mit Hinweistext.
// Stornorechnungen und Korrekturen mit Minusbetrag gehen als Gutschrift mit positiven Beträgen (CII 381,
// ebInterface CreditMemo) und Bezug auf die ursprüngliche Rechnung; eine Korrektur mit Plusbetrag als
// korrigierte Rechnung (CII 384).
// Rein (ohne Browser), getestet in test/e-invoice.test.js.

import { deDate, isInvoice, KINDS, parseAddress, parseNumber, RC_TEXT, round2, settingsOf, skontoOf, SMALL_BUSINESS_TEXT, termsTextOf, totals, COUNTRY_NAMES } from '../core/invoicing.js'

export const CII_PROFILE = 'urn:cen.eu:en16931:2017'
export const EBI_NAMESPACE = 'http://www.ebinterface.at/schema/6p1/'
export const GENERATOR = 'Cleanos App'
export const NO_UID = 'ATU00000000' // ebInterface: ohne UID-Nummer acht Nullen

// Einheiten nach UN/ECE Empfehlung 20 (von EN 16931 und ebInterface empfohlen)
export const UNIT_CODES = { Pauschale: 'LS', Monat: 'MON', 'Std.': 'HUR', 'm²': 'MTK', Stk: 'C62', Einsatz: 'C62', km: 'KMT', Quartal: 'QAN' }
const UNIT_WORDS = [
  [/^(std|stunden?|h)$/, 'HUR'],
  [/^(m2|qm|m²)$/, 'MTK'],
  [/^(monate?|mon|mo)$/, 'MON'],
  [/^(pausch|pauschal|pauschale|psch|pauschalbetrag)$/, 'LS'],
  [/^km$/, 'KMT'],
  [/^(tage?)$/, 'DAY'],
  [/^(wochen?)$/, 'WEE'],
  [/^(jahre?)$/, 'ANN'],
  [/^quartal$/, 'QAN'],
  [/^(m|lfm|meter)$/, 'MTR'],
  [/^kg$/, 'KGM'],
  [/^(l|liter)$/, 'LTR'],
]
export function unitCode(unit) {
  const u = String(unit || '').trim()
  if (UNIT_CODES[u]) return UNIT_CODES[u]
  const k = u.toLowerCase().replace(/\.$/, '')
  return UNIT_WORDS.find(([re]) => re.test(k))?.[1] || 'C62'
}

const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const xmlEsc = (v) => String(v ?? '').replace(BAD_CHARS, '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const amt = (n) => round2(n).toFixed(2)
/** Menge und Einzelpreis: bis 4 Nachkommastellen, mindestens 2. */
const dec = (n) => (Math.round((Number(n) || 0) * 10000) / 10000).toFixed(4).replace(/(\.\d\d\d?)0+$/, '$1').replace(/(\.\d\d)0$/, '$1')
const rateText = (n) => String(round2(n))

// ---------------------------------------------------------------- Inhalt

/**
 * Gemeinsamer Inhalt beider Formate (Vorzeichen bei Gutschriften schon umgedreht).
 * opts: ref (ursprüngliche Rechnung bei Storno/Korrektur), orderRef (Auftragsreferenz; Vorgabe: reference des
 * Belegs), supplierNo (Lieferantennummer beim Empfänger), terms (Zahlungsbedingung für den Text bei Entwürfen).
 */
export function eInvoiceModel(doc, settings = {}, { ref = null, orderRef, supplierNo = '', terms = null } = {}) {
  const s = settingsOf({ settings })
  const t = totals(doc, s)
  const credit = doc.kind === 'storno' || (doc.kind === 'korrektur' && t.gross < 0)
  const sign = credit ? -1 : 1
  const rc = !!doc.reverseCharge
  const small = !rc && !!(doc.smallBusiness ?? s.smallBusiness)
  const cat = (rate) => (rc ? 'AE' : small ? 'E' : rate > 0 ? 'S' : 'Z')
  const reason = rc ? RC_TEXT : small ? SMALL_BUSINESS_TEXT : ''
  const sender = { ...s.sender, ...(doc.sender || {}) }
  const sa = parseAddress(sender.address)
  const ra = parseAddress(doc.recipient?.address)
  const lines = t.lines.map((l, i) => {
    let qty = parseNumber(l.qty) * sign
    let price = parseNumber(l.price)
    // Einzelpreis nie negativ (EN 16931 BR-27): Vorzeichen in die Menge
    if (price < 0) {
      price = -price
      qty = -qty
    }
    const net = round2(l.net * sign)
    const base = round2(qty * price)
    const discount = parseNumber(l.discount)
    const rate = t.vatOn ? parseNumber(l.vat ?? s.vat ?? 20) : 0
    const [name = '', ...more] = String(l.text || '').split(/\r?\n/)
    return {
      no: i + 1,
      name: name.trim() || `Position ${i + 1}`,
      description: [...more, l.longText || ''].map((x) => String(x).trim()).filter(Boolean).join('\n'),
      articleNo: l.articleNo || '',
      qty,
      unit: unitCode(l.unit),
      price,
      base,
      discount,
      allowance: discount ? round2(base - net) : 0,
      net,
      rate,
      cat: cat(rate),
      vat: t.vatOn ? round2((net * rate) / 100) : 0,
    }
  })
  const groups = t.groups.map((g) => ({ rate: g.rate, cat: cat(g.rate), subtotal: round2(g.subtotal * sign), discount: round2(g.discount * sign), net: round2(g.net * sign), vat: round2(g.vat * sign), reason }))
  const lineTotal = round2(lines.reduce((a, l) => a + l.net, 0))
  const allowanceTotal = round2(groups.reduce((a, g) => a + g.discount, 0))
  const taxBasis = round2(groups.reduce((a, g) => a + g.net, 0))
  const taxTotal = round2(groups.reduce((a, g) => a + g.vat, 0))
  const sk = credit ? null : skontoOf(doc, s)
  const termsText = doc.termsText || termsTextOf(doc, s, terms) || ''
  const refNumber = ref?.number || doc.refNumber || ''
  const delivery = String(doc.deliveryAddress || '').trim() ? parseAddress(doc.deliveryAddress) : null
  return {
    number: doc.number || '',
    date: doc.date,
    kind: doc.kind,
    title: doc.title || '',
    credit,
    typeCode: credit ? '381' : doc.kind === 'korrektur' ? '384' : '380',
    currency: 'EUR',
    rc,
    small,
    seller: { name: sender.name || '', ...sa, uid: String(sender.uid || '').replace(/\s+/g, '').toUpperCase(), taxNo: String(sender.taxNo || s.sender.taxNo || '').trim(), email: sender.email || '', phone: sender.phone || '', register: sender.register || '' },
    buyer: { name: doc.recipient?.name || '', ...ra, uid: String(doc.recipient?.uid || '').replace(/\s+/g, '').toUpperCase(), email: doc.recipient?.email || '', customerNo: doc.recipient?.customerNo || '', contact: doc.contactName || ra.attention || '' },
    // erste Zeile ohne Hausnummer und PLZ: Name des Leistungsorts (z. B. „Wohnanlage Lehen“)
    delivery: delivery ? { ...delivery, name: delivery.extra[0] || doc.recipient?.name || '', extra: delivery.extra.slice(1) } : null,
    period: doc.serviceFrom ? { from: doc.serviceFrom, to: doc.serviceTo || doc.serviceFrom } : null,
    orderRef: String(orderRef ?? doc.reference ?? '').trim(),
    supplierNo: String(supplierNo || '').trim(),
    ref: refNumber ? { number: refNumber, date: ref?.date || '' } : null,
    lines,
    groups,
    discountPercent: parseNumber(doc.discount),
    lineTotal,
    allowanceTotal,
    taxBasis,
    taxTotal,
    grandTotal: round2(taxBasis + taxTotal),
    dueDate: doc.dueDate || '',
    termsText: credit ? 'Der Betrag wird mit offenen Forderungen verrechnet bzw. auf Ihr Konto überwiesen.' : termsText || (doc.dueDate ? `Zahlbar bis ${deDate(doc.dueDate)} ohne Abzug.` : ''),
    skonto: sk,
    bank: { iban: String(s.bank.iban || '').replace(/\s+/g, '').toUpperCase(), bic: String(s.bank.bic || '').replace(/\s+/g, '').toUpperCase(), name: s.bank.name || '' },
    intro: String(doc.intro || '').trim(),
    outro: String(doc.outro || '').trim(),
    reason,
    expected: doc.total ? round2(doc.total.gross * sign) : null,
  }
}

/**
 * Was der E-Rechnung fehlt: [{ level: 'error' | 'warn' | 'info', text }]. Fehler: keine XML erzeugen.
 * format: 'cii' oder 'ebinterface' (für den Hinweis zur E-Rechnung an den Bund).
 */
export function eInvoiceProblems(doc, settings = {}, opts = {}, format = 'cii') {
  const out = []
  const err = (text) => out.push({ level: 'error', text })
  const warn = (text) => out.push({ level: 'warn', text })
  if (!isInvoice(doc)) err('E-Rechnungen gibt es für Rechnungen, Stornorechnungen und Rechnungskorrekturen.')
  if (!doc.number) err('Bitte zuerst festschreiben: die E-Rechnung braucht die Rechnungsnummer.')
  if (out.length) return out
  const m = eInvoiceModel(doc, settings, opts)
  if (!m.seller.name) err('Name der eigenen Firma fehlt (Einstellungen → Absender).')
  if (!m.seller.zip || !m.seller.city) err('Anschrift der eigenen Firma: PLZ und Ort nicht erkannt (Einstellungen → Anschrift, z. B. „Musterstraße 1“ und darunter „5020 Salzburg“).')
  if (!m.seller.uid && !m.seller.taxNo) err('UID-Nummer oder Steuernummer der eigenen Firma fehlt (Einstellungen → Absender).')
  if (!m.buyer.name) err('Name des Empfängers fehlt.')
  if (!m.buyer.zip || !m.buyer.city) err('Anschrift des Empfängers: PLZ und Ort nicht erkannt (Zeile „PLZ Ort“, z. B. „5020 Salzburg“).')
  if (m.rc && !m.buyer.uid) err('Reverse Charge: UID-Nummer des Empfängers fehlt.')
  if (!m.lines.length) err('Keine Position.')
  if (m.expected !== null && Math.abs(m.expected - m.grandTotal) > 0.01) err(`Die Summe weicht vom festgeschriebenen Betrag ab (${amt(m.expected)} statt ${amt(m.grandTotal)}): übernommener Altbeleg? Die E-Rechnung bitte im früheren Programm erstellen.`)
  if (!m.period) warn('Leistungszeitraum fehlt.')
  if (!m.credit && m.grandTotal > 0 && !m.bank.iban) warn('Keine IBAN in den Einstellungen: die E-Rechnung enthält keine Bankverbindung.')
  if (format === 'ebinterface' && (!m.orderRef || !m.supplierNo)) out.push({ level: 'info', text: 'E-Rechnung an den Bund: die Auftragsreferenz (Bestellnummer der bestellenden Stelle) und die Lieferantennummer angeben – beides teilt die bestellende Stelle mit.' })
  return out
}

// ---------------------------------------------------------------- XML schreiben

/** Knoten: N(tag, Text | [Kinder], { Attribute }); leere Knoten entfallen, außer keep. */
const N = (t, c, a = {}, keep = false) => ({ t, c, a, keep })
function serialize(n, ind = '') {
  if (!n) return ''
  const attrs = Object.entries(n.a || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${xmlEsc(v)}"`)
    .join('')
  if (Array.isArray(n.c)) {
    const kids = n.c.filter(Boolean).map((k) => serialize(k, `${ind}  `)).filter(Boolean)
    if (!kids.length) return n.keep ? `${ind}<${n.t}${attrs}/>\n` : ''
    return `${ind}<${n.t}${attrs}>\n${kids.join('')}${ind}</${n.t}>\n`
  }
  if (n.c === undefined || n.c === null || n.c === '') return n.keep ? `${ind}<${n.t}${attrs}/>\n` : ''
  return `${ind}<${n.t}${attrs}>${xmlEsc(n.c)}</${n.t}>\n`
}
const xmlDoc = (root) => `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root)}`

// ---------------------------------------------------------------- UN/CEFACT CII (ZUGFeRD / Factur-X, EN 16931)

/** E-Rechnung als UN/CEFACT CII im Profil EN 16931 (ZUGFeRD 2.x / Factur-X „EN 16931“, Datei factur-x.xml). */
export function ciiXml(doc, settings = {}, opts = {}) {
  const m = eInvoiceModel(doc, settings, opts)
  const D = (iso) => N('udt:DateTimeString', String(iso).replace(/-/g, ''), { format: '102' })
  const vatOf = (cat, rate, more = []) => [N('ram:TypeCode', 'VAT'), ...more, N('ram:CategoryCode', cat), N('ram:RateApplicablePercent', rateText(rate))]
  const address = (p) => N('ram:PostalTradeAddress', [N('ram:PostcodeCode', p.zip), N('ram:LineOne', p.street), N('ram:LineTwo', p.extra?.[0]), N('ram:CityName', p.city), N('ram:CountryID', p.country || 'AT')], {}, true)
  const taxIds = (p) => [p.uid && N('ram:SpecifiedTaxRegistration', [N('ram:ID', p.uid, { schemeID: 'VA' })]), p.taxNo && N('ram:SpecifiedTaxRegistration', [N('ram:ID', p.taxNo, { schemeID: 'FC' })])]
  const exemption = (cat) => (cat === 'AE' ? [N('ram:ExemptionReason', m.reason)] : cat === 'E' ? [N('ram:ExemptionReason', m.reason)] : [])
  const exemptionCode = (cat) => (cat === 'AE' ? N('ram:ExemptionReasonCode', 'VATEX-EU-AE') : null)

  const lineItem = (l) =>
    N('ram:IncludedSupplyChainTradeLineItem', [
      N('ram:AssociatedDocumentLineDocument', [N('ram:LineID', String(l.no))]),
      N('ram:SpecifiedTradeProduct', [N('ram:SellerAssignedID', l.articleNo), N('ram:Name', l.name), N('ram:Description', l.description)]),
      N('ram:SpecifiedLineTradeAgreement', [N('ram:NetPriceProductTradePrice', [N('ram:ChargeAmount', dec(l.price))])]),
      N('ram:SpecifiedLineTradeDelivery', [N('ram:BilledQuantity', dec(l.qty), { unitCode: l.unit })]),
      N('ram:SpecifiedLineTradeSettlement', [
        N('ram:ApplicableTradeTax', vatOf(l.cat, l.rate)),
        l.allowance
          ? N('ram:SpecifiedTradeAllowanceCharge', [N('ram:ChargeIndicator', [N('udt:Indicator', 'false')]), N('ram:CalculationPercent', rateText(l.discount)), N('ram:BasisAmount', amt(l.base)), N('ram:ActualAmount', amt(l.allowance)), N('ram:Reason', 'Rabatt')])
          : null,
        N('ram:SpecifiedTradeSettlementLineMonetarySummation', [N('ram:LineTotalAmount', amt(l.net))]),
      ]),
    ])

  const seller = N('ram:SellerTradeParty', [
    N('ram:Name', m.seller.name),
    N('ram:Description', m.seller.register),
    m.seller.phone || m.seller.email ? N('ram:DefinedTradeContact', [N('ram:TelephoneUniversalCommunication', [N('ram:CompleteNumber', m.seller.phone)]), N('ram:EmailURIUniversalCommunication', [N('ram:URIID', m.seller.email)])]) : null,
    address(m.seller),
    N('ram:URIUniversalCommunication', [N('ram:URIID', m.seller.email, { schemeID: 'EM' })]),
    ...taxIds(m.seller),
  ])
  const buyer = N('ram:BuyerTradeParty', [
    N('ram:ID', m.buyer.customerNo),
    N('ram:Name', m.buyer.name),
    m.buyer.contact ? N('ram:DefinedTradeContact', [N('ram:PersonName', m.buyer.contact)]) : null,
    address(m.buyer),
    N('ram:URIUniversalCommunication', [N('ram:URIID', m.buyer.email, { schemeID: 'EM' })]),
    ...taxIds({ uid: m.buyer.uid }),
  ])
  const allowances = m.groups
    .filter((g) => g.discount)
    .map((g) =>
      N('ram:SpecifiedTradeAllowanceCharge', [
        N('ram:ChargeIndicator', [N('udt:Indicator', 'false')]),
        N('ram:CalculationPercent', rateText(m.discountPercent)),
        N('ram:BasisAmount', amt(g.subtotal)),
        N('ram:ActualAmount', amt(g.discount)),
        N('ram:Reason', 'Rabatt'),
        N('ram:CategoryTradeTax', vatOf(g.cat, g.rate)),
      ]),
    )
  const root = N(
    'rsm:CrossIndustryInvoice',
    [
      N('rsm:ExchangedDocumentContext', [N('ram:GuidelineSpecifiedDocumentContextParameter', [N('ram:ID', CII_PROFILE)])]),
      N('rsm:ExchangedDocument', [
        N('ram:ID', m.number),
        N('ram:TypeCode', m.typeCode),
        N('ram:IssueDateTime', [D(m.date)]),
        ...[m.title, m.intro, m.outro, m.reason].filter(Boolean).map((text) => N('ram:IncludedNote', [N('ram:Content', text)])),
      ]),
      N('rsm:SupplyChainTradeTransaction', [
        ...m.lines.map(lineItem),
        N('ram:ApplicableHeaderTradeAgreement', [seller, buyer, m.orderRef ? N('ram:BuyerOrderReferencedDocument', [N('ram:IssuerAssignedID', m.orderRef)]) : null]),
        N(
          'ram:ApplicableHeaderTradeDelivery',
          [m.delivery ? N('ram:ShipToTradeParty', [N('ram:Name', m.delivery.name), address(m.delivery)]) : null],
          {},
          true,
        ),
        N('ram:ApplicableHeaderTradeSettlement', [
          m.credit ? null : N('ram:PaymentReference', m.number),
          N('ram:InvoiceCurrencyCode', m.currency),
          !m.credit && m.bank.iban
            ? N('ram:SpecifiedTradeSettlementPaymentMeans', [
                N('ram:TypeCode', '58'),
                N('ram:Information', 'SEPA-Überweisung'),
                N('ram:PayeePartyCreditorFinancialAccount', [N('ram:IBANID', m.bank.iban), N('ram:AccountName', m.seller.name)]),
                m.bank.bic ? N('ram:PayeeSpecifiedCreditorFinancialInstitution', [N('ram:BICID', m.bank.bic)]) : null,
              ])
            : null,
          ...m.groups.map((g) => N('ram:ApplicableTradeTax', [N('ram:CalculatedAmount', amt(g.vat)), N('ram:TypeCode', 'VAT'), ...exemption(g.cat), N('ram:BasisAmount', amt(g.net)), N('ram:CategoryCode', g.cat), exemptionCode(g.cat), N('ram:RateApplicablePercent', rateText(g.rate))])),
          m.period ? N('ram:BillingSpecifiedPeriod', [N('ram:StartDateTime', [D(m.period.from)]), N('ram:EndDateTime', [D(m.period.to)])]) : null,
          ...allowances,
          N('ram:SpecifiedTradePaymentTerms', [N('ram:Description', m.termsText), m.dueDate ? N('ram:DueDateDateTime', [D(m.dueDate)]) : null]),
          N('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
            N('ram:LineTotalAmount', amt(m.lineTotal)),
            N('ram:ChargeTotalAmount', amt(0)),
            N('ram:AllowanceTotalAmount', amt(m.allowanceTotal)),
            N('ram:TaxBasisTotalAmount', amt(m.taxBasis)),
            N('ram:TaxTotalAmount', amt(m.taxTotal), { currencyID: m.currency }),
            N('ram:GrandTotalAmount', amt(m.grandTotal)),
            N('ram:TotalPrepaidAmount', amt(0)),
            N('ram:DuePayableAmount', amt(m.grandTotal)),
          ]),
          m.ref ? N('ram:InvoiceReferencedDocument', [N('ram:IssuerAssignedID', m.ref.number), m.ref.date ? N('ram:FormattedIssueDateTime', [N('qdt:DateTimeString', m.ref.date.replace(/-/g, ''), { format: '102' })]) : null]) : null,
        ]),
      ]),
    ],
    {
      'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
      'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
      'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
    },
  )
  return xmlDoc(root)
}

// ---------------------------------------------------------------- ebInterface 6.1 (Österreich, E-Rechnung an den Bund)

/** E-Rechnung als ebInterface 6.1 (z. B. Upload im USP für Rechnungen an den Bund). */
export function ebInterfaceXml(doc, settings = {}, opts = {}) {
  const m = eInvoiceModel(doc, settings, opts)
  // ebInterface: 20 % S, andere Sätze über 0 AA (reduzierter Satz), sonst wie CII (Z, AE, E)
  const ebCat = (g) => (g.cat === 'S' && g.rate !== 20 ? 'AA' : g.cat)
  const taxPercent = (g) => N('TaxPercent', rateText(g.rate), { TaxCategoryCode: ebCat(g) })
  const country = (code) => N('Country', COUNTRY_NAMES[code] || code, { CountryCode: code })
  const address = (p, extra = []) => N('Address', [N('Name', p.name), N('Street', p.street), N('Town', p.city), N('ZIP', p.zip), country(p.country || 'AT'), ...extra])
  const lineItem = (l) =>
    N('ListLineItem', [
      N('PositionNumber', String(l.no)),
      N('Description', l.name),
      l.description ? N('Description', l.description) : null,
      l.articleNo ? N('ArticleNumber', l.articleNo, { ArticleNumberType: 'BillersArticleNumber' }) : null,
      N('Quantity', dec(l.qty), { Unit: l.unit }),
      N('UnitPrice', dec(l.price)),
      l.allowance ? N('ReductionAndSurchargeListLineItemDetails', [N('ReductionListLineItem', [N('BaseAmount', amt(l.base)), N('Percentage', rateText(l.discount)), N('Amount', amt(l.allowance)), N('Comment', 'Rabatt')])]) : null,
      N('TaxItem', [N('TaxableAmount', amt(l.net)), taxPercent(l), N('TaxAmount', amt(l.vat))]),
      N('LineItemAmount', amt(l.net)),
    ])
  const cancelled = m.kind === 'storno' && m.ref?.date
  const root = N(
    'Invoice',
    [
      N('InvoiceNumber', m.number),
      N('InvoiceDate', m.date),
      cancelled ? N('CancelledOriginalDocument', [N('InvoiceNumber', m.ref.number), N('InvoiceDate', m.ref.date), N('DocumentType', 'Invoice'), N('Comment', m.intro || 'Stornorechnung')]) : null,
      m.ref && !cancelled ? N('RelatedDocument', [N('InvoiceNumber', m.ref.number), m.ref.date ? N('InvoiceDate', m.ref.date) : null, N('DocumentType', 'Invoice'), N('Comment', `${KINDS[m.kind]} zu Rechnung ${m.ref.number}`)]) : null,
      m.period ? N('Delivery', [m.period.from === m.period.to ? N('Date', m.period.from) : N('Period', [N('FromDate', m.period.from), N('ToDate', m.period.to)]), m.delivery ? address(m.delivery) : null]) : null,
      N('Biller', [
        N('VATIdentificationNumber', m.seller.uid || NO_UID),
        m.seller.taxNo ? N('FurtherIdentification', m.seller.taxNo, { IdentificationType: 'FASTNR' }) : null,
        address(m.seller, [N('Phone', m.seller.phone), N('Email', m.seller.email)]),
        N('InvoiceRecipientsBillerID', m.supplierNo),
      ]),
      N('InvoiceRecipient', [
        N('VATIdentificationNumber', m.buyer.uid || NO_UID),
        m.orderRef ? N('OrderReference', [N('OrderID', m.orderRef)]) : null,
        address(m.buyer, [N('Email', m.buyer.email)]),
        m.buyer.contact ? N('Contact', [N('Name', m.buyer.contact)]) : null,
        N('BillersInvoiceRecipientID', m.buyer.customerNo),
      ]),
      N('Details', [N('HeaderDescription', [m.title, m.intro].filter(Boolean).join('\n')), N('ItemList', m.lines.map(lineItem)), N('FooterDescription', m.outro)]),
      m.groups.some((g) => g.discount)
        ? N(
            'ReductionAndSurchargeDetails',
            m.groups.filter((g) => g.discount).map((g) => N('Reduction', [N('BaseAmount', amt(g.subtotal)), N('Percentage', rateText(m.discountPercent)), N('Amount', amt(g.discount)), N('Comment', 'Rabatt'), N('TaxItem', [N('TaxableAmount', amt(g.discount)), taxPercent(g)])])),
          )
        : null,
      N('Tax', m.groups.map((g) => N('TaxItem', [N('TaxableAmount', amt(g.net)), taxPercent(g), N('TaxAmount', amt(g.vat)), N('Comment', g.reason)])), {}, true),
      N('TotalGrossAmount', amt(m.grandTotal)),
      N('PayableAmount', amt(m.grandTotal)),
      m.credit
        ? N('PaymentMethod', [N('Comment', m.termsText), N('NoPayment', '', {}, true)])
        : m.bank.iban
          ? N('PaymentMethod', [N('UniversalBankTransaction', [N('BeneficiaryAccount', [N('BankName', m.bank.name), N('BIC', /^[0-9A-Za-z]{8}([0-9A-Za-z]{3})?$/.test(m.bank.bic) ? m.bank.bic : ''), N('IBAN', m.bank.iban), N('BankAccountOwner', m.seller.name.slice(0, 70))]), N('PaymentReference', m.number.slice(0, 35))])])
          : null,
      m.credit
        ? null
        : N('PaymentConditions', [
            N('DueDate', m.dueDate),
            m.skonto ? N('Discount', [N('PaymentDate', m.skonto.until), N('BaseAmount', amt(m.skonto.base)), N('Percentage', rateText(m.skonto.percent)), N('Amount', amt(m.skonto.amount))]) : null,
            N('Comment', m.termsText),
          ]),
      N('Comment', m.reason),
    ],
    { xmlns: EBI_NAMESPACE, GeneratingSystem: GENERATOR, DocumentType: m.credit ? 'CreditMemo' : 'Invoice', InvoiceCurrency: m.currency, DocumentTitle: `${KINDS[m.kind]} ${m.number}`, Language: 'de' },
  )
  return xmlDoc(root)
}

/** Dateinamen: RE-2026-0001_factur-x.xml bzw. RE-2026-0001_ebInterface.xml (im E-Mail-Anhang factur-x.xml). */
export const eInvoiceFileName = (doc, format) => `${String(doc.number || 'Entwurf').replace(/[^A-Za-z0-9-]+/g, '-')}_${format === 'ebinterface' ? 'ebInterface' : 'factur-x'}.xml`
