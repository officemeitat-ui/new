// Übernahme aus orgaMAX (und anderen Faktura-Programmen) in die Fakturierung: Kunden, Ansprechpartner, Artikel,
// Belege (Rechnungen, Angebote, Auftragsbestätigungen, Gutschriften, Stornos) mit Positionen, Zahlungen und
// Mahnstufen, Textbausteine, Zahlungsbedingungen, Abo-Rechnungen (Daueraufträge) und E-Rechnungen
// (ZUGFeRD/Factur-X/XRechnung als CII oder UBL, auch eingebettet im PDF).
//
// orgaMAX liefert Tabellen über „Listen & Statistiken → Tabellen-Auswertungen → Tabelle exportieren“ (Excel, Text,
// XML), über „Ansicht → Tabelle exportieren“ in jeder Übersicht oder per ODBC (Excel → Daten abrufen). Spalten heißen
// je nach Weg deutsch („Kundennummer“, „Rechnungsdatum“) oder wie in der Datenbank. Darum: Spalten werden über
// Suchwörter erkannt, die Art der Tabelle über die Spalten (und den Datei- bzw. Blattnamen); beides lässt sich in
// der Oberfläche ändern. Alles hier ist rein (keine Oberfläche, kein Netz) und getestet (test/fak-import.test.js).
//
// Übernommene Altbelege bleiben, wie sie sind: Nummer, Datum, Summen und Positionen aus orgaMAX, festgeschrieben
// (Prüfsumme), Kennzeichen imported. Nichts wird neu nummeriert; die eigenen Nummernkreise laufen danach weiter.

import { parseCsvRows } from './bank.js'
import { checksumOf, composeAddress, nextCustomerNo, numberPattern, parseNumber, round2, totals, VAT_RATES } from './invoicing.js'
import { descendants, find, findAll, parseXml, textAt } from './xml-lite.js'

export const SYSTEM = 'orgaMAX'

/** Vergleichsform: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern. */
export const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

const W = (s) => s.split(' ')

// ---------------------------------------------------------------- Ziele und Felder

const CUSTOMER_NO = W('kundennummer kundennr kdnr kdnummer kundenno kdno kundenid customerno customernumber customerid debitorennummer debitorennr debitor adressnummer adressnr')
const DOC_NO = W('belegnummer belegnr rechnungsnummer rechnungsnr renr rgnr rnr angebotsnummer angebotsnr vorgangsnummer vorgangsnr dokumentnummer invoiceno invoicenumber documentno documentnumber docno')
const STREET = W('strasse str strassehausnummer strassehausnr strasseundhausnummer anschrift adresse street address address1 adresszeile1')
const VAT_RATE = W('ust mwst mwstsatz ustsatz steuersatz steuer vat vatrate taxrate mwstprozent ustprozent steuerschluessel')

/** Ziele: Bezeichnung, Wörter im Datei-/Blattnamen, Felder { Feld: [Bezeichnung, ...Suchwörter] }. */
export const TARGETS = {
  customers: {
    label: 'Kunden',
    words: W('kunde kunden kundenstamm customer customers debitor debitoren adressen adresse'),
    fields: {
      customerNo: ['Kundennummer', ...CUSTOMER_NO, 'nummer', 'nr'],
      name: ['Firma / Name', ...W('firma firmenname firma1 name1 unternehmen company companyname kundenname kunde name organisation')],
      name2: ['Firma Zusatz', ...W('firma2 name2 firmenzusatz zusatz namenszusatz abteilung')],
      salutation: ['Anrede', ...W('anrede salutation')],
      title: ['Titel', ...W('titel title akademischertitel')],
      firstName: ['Vorname', ...W('vorname firstname givenname')],
      lastName: ['Nachname', ...W('nachname lastname surname familienname zuname')],
      street: ['Straße', ...STREET],
      houseNo: ['Hausnummer', ...W('hausnummer hausnr')],
      zip: ['PLZ', ...W('plz postleitzahl zip zipcode postalcode postcode')],
      city: ['Ort', ...W('ort stadt city wohnort town')],
      country: ['Land', ...W('land laenderkennzeichen lkz country countrycode staat')],
      phone: ['Telefon', ...W('telefon tel telefon1 telefonnummer phone phone1 festnetz telefongeschaeftlich')],
      mobile: ['Mobil', ...W('mobil handy mobiltelefon mobile mobilnummer telefon2')],
      fax: ['Fax', ...W('fax telefax faxnummer')],
      email: ['E-Mail', ...W('email mail emailadresse email1 emailrechnung rechnungsemail emailfuerrechnungen')],
      web: ['Internet', ...W('internet web homepage website www url')],
      uid: ['UID-Nummer', ...W('uid uidnummer uidnr ustid ustidnr ustidnummer umsatzsteuerid umsatzsteueridnr vatid vatno')],
      iban: ['IBAN', 'iban'],
      bic: ['BIC', ...W('bic swift swiftbic')],
      group: ['Kundengruppe', ...W('kundengruppe gruppe kategorie group branche')],
      discount: ['Rabatt %', ...W('rabatt kundenrabatt discount rabattprozent')],
      paymentDays: ['Zahlungsziel (Tage)', ...W('zahlungsziel zahlungszieltage zieltage nettotage tagenetto paymentdays')],
      terms: ['Zahlungsbedingung', ...W('zahlungsbedingung zahlungsbedingungen zahlungskondition konditionen paymentterms')],
      note: ['Notiz', ...W('bemerkung bemerkungen notiz notizen info anmerkung memo kommentar note')],
      contact: ['Ansprechpartner', ...W('ansprechpartner ansprechperson kontaktperson kontakt contact')],
      consumer: ['Privatkunde', ...W('privatkunde privat kundentyp kundenart')],
      account: ['Debitorenkonto', ...W('debitorenkonto fibukonto sachkonto personenkonto')],
      mandateRef: ['SEPA-Mandatsreferenz', ...W('mandatsreferenz mandatreferenz sepamandat mandat mandatereference mandateref mandateid sepamandateid')],
      mandateDate: ['Mandat unterschrieben am', ...W('mandatsdatum mandatdatum mandatunterschrieben unterschriftsdatum mandatedate mandatesigned mandatesigneddate')],
      mandateScheme: ['Lastschriftart (Basis/Firmen)', ...W('lastschriftart mandatsart mandatetype sepatype')],
      payMethod: ['Zahlungsart', ...W('zahlungsart zahlweise paymentmethod paymenttype')],
    },
  },
  contacts: {
    label: 'Ansprechpartner',
    words: W('ansprechpartner ansprechpersonen kontakte kontaktpersonen contacts'),
    fields: {
      customerNo: ['Kundennummer', ...CUSTOMER_NO],
      customerName: ['Firma', ...W('firma kunde kundenname company')],
      salutation: ['Anrede', 'anrede'],
      firstName: ['Vorname', ...W('vorname firstname')],
      lastName: ['Nachname', ...W('nachname lastname zuname')],
      name: ['Name', ...W('name ansprechpartner kontakt')],
      role: ['Funktion', ...W('funktion position abteilung rolle role')],
      email: ['E-Mail', ...W('email mail')],
      phone: ['Telefon', ...W('telefon tel durchwahl phone')],
      mobile: ['Mobil', ...W('mobil handy mobile')],
    },
  },
  articles: {
    label: 'Artikel und Leistungen',
    words: W('artikel artikelstamm leistungen leistung produkte produkt items articles warenstamm'),
    fields: {
      articleNo: ['Artikelnummer', ...W('artikelnummer artikelnr artnr artikelno itemno itemnumber articleno articlenumber sku produktnummer leistungsnummer nummer nr')],
      name: ['Bezeichnung', ...W('bezeichnung artikelbezeichnung kurztext artikelname kurzbezeichnung name produkt leistung titel')],
      longText: ['Beschreibung / Langtext', ...W('beschreibung langtext artikelbeschreibung artikeltext text details longtext description')],
      unit: ['Einheit', ...W('einheit me mengeneinheit unit vkeinheit')],
      price: ['Verkaufspreis netto', ...W('vknetto vk vkpreis vk1 verkaufspreis verkaufspreisnetto preis preisnetto nettopreis einzelpreis price netprice unitprice salesprice')],
      priceGross: ['Verkaufspreis brutto', ...W('vkbrutto bruttopreis verkaufspreisbrutto preisbrutto grossprice')],
      vat: ['USt-Satz', ...VAT_RATE],
      cost: ['Einkaufspreis netto', ...W('eknetto ek ekpreis einkaufspreis einkaufspreisnetto cost purchaseprice')],
      group: ['Artikelgruppe', ...W('warengruppe artikelgruppe gruppe kategorie group category')],
      active: ['aktiv', ...W('aktiv active')],
      blocked: ['gesperrt / inaktiv', ...W('gesperrt inaktiv inactive blocked')],
    },
  },
  documents: {
    label: 'Belege (Rechnungen, Angebote …)',
    words: W('rechnung rechnungen ausgangsrechnungen belege beleg vorgaenge vorgang angebote angebot auftraege gutschriften offeneposten op invoices'),
    fields: {
      number: ['Belegnummer', ...DOC_NO, 'nummer', 'nr', 'number'],
      kind: ['Belegart', ...W('belegart vorgangsart art typ dokumentart doctype documenttype type kind')],
      date: ['Datum', ...W('datum belegdatum rechnungsdatum vorgangsdatum angebotsdatum erstelltam date invoicedate docdate documentdate')],
      dueDate: ['Fällig am', ...W('faellig faelligam faelligkeit faelligkeitsdatum zahlbarbis duedate zahlungsziel')],
      customerNo: ['Kundennummer', ...CUSTOMER_NO],
      customerName: ['Kunde / Empfänger', ...W('kunde kundenname firma name name1 empfaenger rechnungsempfaenger customer customername')],
      street: ['Straße', ...STREET],
      zip: ['PLZ', ...W('plz postleitzahl zip')],
      city: ['Ort', ...W('ort stadt city')],
      country: ['Land', ...W('land country lkz')],
      uid: ['UID des Kunden', ...W('uid uidnummer ustid ustidnr vatid')],
      title: ['Betreff', ...W('betreff titel bezeichnung vorgangsbezeichnung projekt subject title')],
      net: ['Netto', ...W('netto nettobetrag nettosumme summenetto gesamtnetto betragnetto net netamount totalnet')],
      vatAmount: ['USt-Betrag', ...W('mwst ust mwstbetrag ustbetrag steuerbetrag umsatzsteuer steuer vat vatamount tax taxamount')],
      gross: ['Brutto', ...W('brutto bruttobetrag gesamtbrutto summebrutto gesamtbetrag endbetrag rechnungsbetrag betrag summe gross grossamount total totalgross')],
      paid: ['Bezahlt (Betrag)', ...W('bezahltbetrag bezahlterbetrag gezahlt zahlungseingang paidamount paid bezahlt')],
      open: ['Offen (Betrag)', ...W('offen offenerbetrag offenbetrag restbetrag rest saldo openamount outstanding open')],
      paidDate: ['Bezahlt am', ...W('bezahltam zahlungsdatum zahldatum eingangam ausgeglichenam paiddate paymentdate')],
      status: ['Status', ...W('status zahlungsstatus state')],
      serviceFrom: ['Leistung von / am', ...W('leistungsdatum leistungvon lieferdatum leistungsbeginn leistungszeitraumvon servicedate deliverydate')],
      serviceTo: ['Leistung bis', ...W('leistungbis leistungsende leistungszeitraumbis')],
      reference: ['Bestellnummer / Ihr Zeichen', ...W('bestellnummer bestellnr ihrezeichen ihrzeichen referenz ihrebestellung auftragsnummerkunde reference orderno buyerreference')],
      refNumber: ['Bezug auf Rechnung', ...W('bezugsrechnung ursprungsrechnung zurechnung originalrechnung referenzrechnung bezug invoicereference')],
      reminderLevel: ['Mahnstufe', ...W('mahnstufe mahnlevel dunninglevel')],
      lastReminder: ['Letzte Mahnung am', ...W('letztemahnung mahndatum gemahntam')],
      discount: ['Belegrabatt %', ...W('belegrabatt gesamtrabatt rabatt discount')],
      intro: ['Einleitungstext', ...W('einleitungstext einleitung kopftext vortext introtext')],
      outro: ['Schlusstext', ...W('schlusstext schluss fusstext nachtext abschlusstext')],
      objectName: ['Objekt / Projekt', ...W('objekt leistungsort baustelle projektname')],
    },
  },
  lines: {
    label: 'Belegpositionen',
    words: W('positionen position belegpositionen vorgangspositionen rechnungspositionen artikelumsatz lines items'),
    fields: {
      docNumber: ['Belegnummer', ...DOC_NO, 'beleg', 'vorgang', 'rechnung', 'nummer'],
      docKind: ['Belegart', ...W('belegart vorgangsart')],
      pos: ['Position', ...W('pos position posnr positionsnummer lfdnr zeile lineno line')],
      articleNo: ['Artikelnummer', ...W('artikelnummer artikelnr artnr itemno articleno sku leistungsnummer')],
      text: ['Bezeichnung', ...W('bezeichnung artikelbezeichnung kurztext positionstext text leistung description name artikel')],
      longText: ['Langtext', ...W('langtext beschreibung zusatztext details longtext')],
      qty: ['Menge', ...W('menge anzahl stueck stk qty quantity')],
      unit: ['Einheit', ...W('einheit me mengeneinheit unit')],
      price: ['Einzelpreis netto', ...W('einzelpreis ep epnetto einzelpreisnetto preis preisnetto vk vkpreis unitprice price netprice')],
      discount: ['Rabatt %', ...W('rabatt rabattprozent positionsrabatt discount')],
      lineType: ['Positionsart', ...W('positionsart postyp positionstyp zeilenart linetype postype positiontype')],
      altRef: ['Alternative zu Position', ...W('alternativzu alternativezu alternativepos altpos alternativeto')],
      vat: ['USt-Satz', ...VAT_RATE],
      net: ['Gesamt netto', ...W('gesamt gesamtpreis gesamtnetto positionsbetrag nettobetrag summe betrag netto linetotal total')],
    },
  },
  payments: {
    label: 'Zahlungen',
    words: W('zahlungen zahlung zahlungseingaenge zahlungseingang payments bank kassenbuch'),
    fields: {
      docNumber: ['Belegnummer', ...DOC_NO, 'rechnung', 'beleg', 'vorgang', 'nummer'],
      date: ['Datum', ...W('datum zahlungsdatum buchungsdatum eingangsdatum valuta date')],
      amount: ['Betrag', ...W('betrag zahlbetrag zahlung eingang amount summe')],
      skonto: ['Skonto', ...W('skonto skontobetrag')],
      note: ['Notiz', ...W('bemerkung verwendungszweck notiz zahlungsart text note')],
    },
  },
  textBlocks: {
    label: 'Textbausteine',
    words: W('textbausteine textbaustein texte vorlagen bausteine'),
    fields: {
      name: ['Bezeichnung', ...W('bezeichnung name titel kurzbezeichnung kuerzel title')],
      kind: ['Belegart', ...W('belegart vorgangsart art bereich verwendung kategorie')],
      place: ['Stelle im Beleg', ...W('textart platzierung stelle place position typ')],
      text: ['Text', ...W('text inhalt textbaustein baustein content langtext body')],
      isDefault: ['Standard', ...W('standard default vorbelegt standardtext')],
    },
  },
  paymentTerms: {
    label: 'Zahlungsbedingungen',
    words: W('zahlungsbedingungen zahlungsbedingung konditionen zahlungskonditionen paymentterms'),
    fields: {
      name: ['Bezeichnung', ...W('bezeichnung name zahlungsbedingung kurzbezeichnung kuerzel')],
      days: ['Tage netto', ...W('tagenetto nettotage zahlungsziel ziel tage days nettoziel')],
      skontoPercent: ['Skonto %', ...W('skonto skontoprozent skontosatz skonto1 skontoproz')],
      skontoDays: ['Skonto Tage', ...W('skontotage skontofrist skontotage1 skontoziel')],
      text: ['Text', ...W('text beschreibung drucktext zahlungstext')],
      isDefault: ['Standard', ...W('standard default')],
    },
  },
  recurring: {
    label: 'Abo-Rechnungen (Daueraufträge)',
    words: W('abo abos aborechnungen abo-rechnungen dauerauftraege dauerauftrag wiederkehrend serienrechnungen'),
    fields: {
      title: ['Bezeichnung', ...W('bezeichnung titel name abo aboname betreff')],
      customerNo: ['Kundennummer', ...CUSTOMER_NO],
      customerName: ['Kunde', ...W('kunde kundenname firma')],
      interval: ['Intervall', ...W('intervall rhythmus turnus periode interval abrechnungsintervall')],
      start: ['Start / nächste Rechnung', ...W('start beginn startdatum gueltigab naechsterechnung naechstefaelligkeit naechsteausfuehrung erstellungsdatum ab')],
      end: ['Ende', ...W('ende enddatum gueltigbis laufzeitende bis')],
      text: ['Positionstext', ...W('positionstext leistung artikelbezeichnung text beschreibung')],
      articleNo: ['Artikelnummer', ...W('artikelnummer artikelnr artnr')],
      qty: ['Menge', ...W('menge anzahl qty')],
      unit: ['Einheit', ...W('einheit unit')],
      price: ['Preis netto', ...W('preis einzelpreis preisnetto betrag netto price')],
      vat: ['USt-Satz', ...VAT_RATE],
      active: ['aktiv', ...W('aktiv active status')],
    },
  },
}

// Spalten der orgaMAX-Datenbank (Komplettexport über ODBC, Tabellen BAS_* und MOV_*): Namen wie in der Datenbank,
// dazu interne IDs, über die die Tabellen verknüpft sind (MOV_INVOICES.CUSTID → BAS_CUSTOMERS.ID, Positionen über die
// ID des Belegs, Zahlungen über INVID). Was hier fehlt, lässt sich in der Zuordnung von Hand setzen.
const REF_LABELS = { srcId: 'Interne ID', customerRef: 'Kunde (interne ID)', docRef: 'Beleg (interne ID)', artRef: 'Artikel (interne ID)', contactType: 'Kontaktart (Kunde/Lieferant)', custKind: 'Firma oder privat', orderType: 'Belegtyp (Nummer)' }
const DB_ALIASES = {
  customers: {
    srcId: ['id'], customerNo: ['custno'], name: ['name1', 'company', 'firm'], name2: ['name2', 'name3'], street: ['street1'], zip: ['zipcode'], city: ['town'], country: ['countryid', 'countrycode', 'countryiso'],
    phone: ['phone1', 'tel1', 'telephone', 'phonebusiness'], mobile: ['mobilephone', 'cellphone', 'phonemobile'], fax: ['fax1'], email: ['email1', 'mail1'], web: ['internet', 'homepage'],
    uid: ['vatno', 'taxid', 'ustidno'], discount: ['rebate'], paymentDays: ['payterm', 'netdays', 'termofpayment'], note: ['remark', 'remarks', 'notes'], contactType: ['contacttype'], custKind: ['custkind'],
    firstName: ['prename'], salutation: ['salut'], group: ['custgroup', 'customergroup', 'groupname'],
  },
  contacts: { customerRef: ['custid', 'customerid'], firstName: ['firstname', 'prename'], lastName: ['lastname', 'surname'], role: ['function', 'department'], email: ['email1'], phone: ['phone1', 'tel1'] },
  articles: { srcId: ['id'], articleNo: ['artno', 'articleno', 'artnr'], name: ['artname', 'shorttext', 'caption'], longText: ['longtext', 'description2', 'memo'], unit: ['unitname'], price: ['salesprice', 'price1', 'vkprice', 'netprice'], priceGross: ['grossprice'], vat: ['vatrate', 'taxrate', 'vatpercent'], cost: ['purchprice', 'purchaseprice', 'ekprice'], group: ['artgroup', 'articlegroup', 'groupname'], blocked: ['inactive', 'locked', 'disabled'] },
  documents: {
    srcId: ['id'], customerRef: ['custid', 'customerid', 'addressid'], number: ['invno', 'orderno', 'docno', 'movno'], date: ['invdate', 'orderdate', 'docdate', 'movdate'], dueDate: ['duedate', 'paymentduedate'],
    net: ['totalnet', 'netamount', 'sumnet'], vatAmount: ['totalvat', 'totaltax', 'sumvat'], gross: ['totalgross', 'grossamount', 'sumgross'], paid: ['paidamount', 'totalpaid'], open: ['openamount', 'remainder'],
    paidDate: ['paiddate', 'paymentdate'], title: ['subject', 'caption', 'headline'], intro: ['introtext', 'headtext', 'pretext', 'textbefore'], outro: ['footertext', 'posttext', 'closingtext', 'textafter'],
    orderType: ['ordertype', 'invtype', 'movtype', 'doctype'], serviceFrom: ['servicedate', 'performancedate', 'deliverydate', 'servicefrom'], serviceTo: ['serviceto', 'serviceuntil'], reminderLevel: ['dunlevel', 'reminderlevel', 'dunninglevel'], lastReminder: ['dundate', 'lastdunning'],
    reference: ['custreference', 'yourreference', 'custorderno'], refNumber: ['refinvno', 'originalinvno'],
  },
  lines: { docRef: ['invid', 'orderid', 'seriesid', 'parentid', 'headid', 'docid', 'movid'], artRef: ['artid', 'articleid'], pos: ['posno', 'sortno', 'lineno', 'posnr'], text: ['artname', 'shorttext', 'caption'], longText: ['longtext', 'description2'], qty: ['quantity', 'amount'], unit: ['unitname'], price: ['unitprice', 'singleprice', 'netprice', 'pricenet'], discount: ['rebate'], vat: ['vatrate', 'taxrate', 'vatpercent'], net: ['totalnet', 'linenet', 'sumnet'] },
  payments: { docRef: ['invid', 'invoiceid'], date: ['paydate', 'paymentdate', 'bookdate', 'valuedate'], amount: ['payamount', 'value', 'paid'], skonto: ['cashdiscount', 'discountamount'], note: ['remark', 'paymenttext'] },
  textBlocks: { name: ['caption', 'shortname'], kind: ['doctype', 'movtype'], place: ['texttype'], text: ['blocktext', 'memo', 'textcontent'] },
  paymentTerms: { name: ['caption', 'shortname'], days: ['netdays', 'payterm', 'days1'], skontoPercent: ['discount1', 'skonto1', 'cashdiscount', 'discountpercent'], skontoDays: ['discountdays', 'discountdays1', 'skontodays1', 'cashdiscountdays'], text: ['printtext', 'description'] },
  recurring: { srcId: ['id'], customerRef: ['custid', 'customerid'], interval: ['period', 'cycle', 'frequency', 'intervalmonths'], start: ['nextdate', 'nextinvoice', 'nextinvoicedate', 'startdate', 'begindate'], end: ['enddate', 'validuntil'], title: ['caption', 'subject', 'name'], active: ['isactive', 'enabled'] },
}
for (const [kind, fields] of Object.entries(DB_ALIASES)) {
  for (const [field, list] of Object.entries(fields)) {
    const t = TARGETS[kind].fields
    t[field] ||= [REF_LABELS[field] || field]
    for (const a of list) if (!t[field].includes(a)) t[field].push(a)
  }
}

/** Bekannte Tabellen der orgaMAX-Datenbank → Ziel; null = unbekannt (dann über die Spalten erkennen). */
export function dbTableKind(name) {
  const n = String(name || '').toUpperCase()
  if (/^BAS_CUSTOMERS$/.test(n)) return 'customers'
  if (/CONTACTPERS|CONTACT_PERS|ANSPRECH/.test(n)) return 'contacts'
  if (/^BAS_ARTICLES$/.test(n)) return 'articles'
  if (/^MOV_(INVOICES|ORDERS)$/.test(n)) return 'documents'
  if (/^MOV_INVOICES_SERIES$/.test(n)) return 'recurring'
  if (/^MOV_(INVOICES|ORDERS|INVOICES_SERIES)_?POS(ITIONS)?$/.test(n)) return 'lines'
  if (/^MOV_PAYMENTS$/.test(n)) return 'payments'
  if (/TEXTBLOCK|TEXTBAUSTEIN|TEXTMODUL|STANDARDTEXT|^BAS_TEXTS?$/.test(n)) return 'textBlocks'
  if (/PAYMENTCOND|PAYMENTTERM|PAYCOND|ZAHLUNGSBED|TERMSOFPAYMENT/.test(n)) return 'paymentTerms'
  return null
}

/** RTF (Texte aus Windows-Programmen) → einfacher Text mit Zeilenumbrüchen. */
export function rtfToText(rtf) {
  const s = String(rtf || '')
  if (!/^\s*\{\\rtf/.test(s)) return s
  let out = ''
  let depth = 0
  const skip = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') {
      depth++
      // Gruppen ohne sichtbaren Text: Schriften, Farben, Stile, \* …
      const head = s.slice(i + 1, i + 14)
      if (/^\\(\*|fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|generator|themedata|latentstyles|rsidtbl|xmlnstbl|mmathPr)/.test(head)) skip.push(depth)
      continue
    }
    if (ch === '}') {
      if (skip.at(-1) === depth) skip.pop()
      depth--
      continue
    }
    if (skip.length) {
      if (ch === '\\') i++
      continue
    }
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([\\{}~_-])/.exec(s.slice(i, i + 40))
      if (!m) continue
      i += m[0].length - 1
      if (m[3]) out += new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(m[3], 16)]))
      else if (m[4]) out += m[4] === '~' ? ' ' : m[4] === '_' || m[4] === '-' ? '-' : m[4]
      else if (m[1] === 'par' || m[1] === 'line') out += '\n'
      else if (m[1] === 'tab') out += '\t'
      else if (m[1] === 'u' && m[2]) {
        out += String.fromCharCode(Number(m[2]) < 0 ? Number(m[2]) + 65536 : Number(m[2]))
        if (s[i + 1] === '?') i++
      }
      continue
    }
    if (ch === '\r' || ch === '\n') continue
    out += ch
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Tabelle aus dem Komplettexport (CSV mit Semikolon, Zahlen mit Punkt, Datum ISO) mit Spaltentypen aus _orgamax.json
 * → { name, columns, rows, db: true } mit echten Zahlen und Texten ohne RTF.
 */
export function dumpTable(csvText, name, meta = []) {
  const { rows } = parseCsvRows(csvText, ';')
  const [head = [], ...body] = rows
  const types = head.map((h) => meta.find((c) => c.name === h)?.type || 'String')
  const conv = (v, type) => {
    if (v === '' || v == null) return ''
    if (/Int|Decimal|Double|Single|Byte/.test(type)) {
      const n = Number(v)
      return Number.isFinite(n) ? n : v
    }
    if (type === 'Boolean') return v === '1' || /^true$/i.test(v)
    if (/^\s*\{\\rtf/.test(v)) return rtfToText(v)
    return v
  }
  return { name, columns: head, rows: body.map((r) => head.map((_, i) => conv(r[i], types[i]))), db: true }
}

/** Pflichtfelder je Ziel (mindestens eine Spalte je Gruppe), sonst passt die Tabelle nicht. */
const REQUIRED = {
  customers: [['name', 'lastName'], ['customerNo', 'street', 'zip', 'city', 'email', 'phone']],
  contacts: [['customerNo', 'customerName', 'customerRef'], ['lastName', 'name'], ['role', 'email', 'phone', 'mobile']],
  articles: [['name', 'articleNo'], ['price', 'priceGross']],
  documents: [['number'], ['date'], ['gross', 'net', 'open']],
  lines: [['docNumber', 'docRef'], ['text', 'articleNo', 'artRef'], ['qty', 'price', 'net']],
  payments: [['docNumber', 'docRef'], ['amount'], ['date']],
  textBlocks: [['text'], ['name', 'kind', 'place']],
  paymentTerms: [['name'], ['days', 'skontoPercent']],
  recurring: [['interval'], ['customerNo', 'customerName', 'customerRef'], ['price', 'text', 'title']],
}
/** Diese Spalten sprechen gegen das Ziel (z. B. Positionen haben Menge, Zahlungen nicht). */
const AGAINST = {
  customers: ['date', 'qty', 'gross', 'price'],
  contacts: ['zip', 'city', 'date', 'gross'],
  articles: ['date', 'customerNo', 'docNumber', 'qty'],
  documents: ['qty', 'pos'],
  payments: ['qty', 'gross', 'net', 'text'],
  paymentTerms: ['customerNo', 'date', 'price'],
  textBlocks: ['price', 'date', 'customerNo'],
  recurring: [],
  lines: [],
}

/** Wie gut passt eine Spaltenüberschrift zu einem Feld? 3 genau, 2 Anfang, 1 enthalten. */
function aliasScore(header, aliases) {
  const h = norm(header)
  if (!h) return 0
  let best = 0
  for (const a of aliases) {
    if (h === a) return 3
    if (a.length >= 4 && (h.startsWith(a) || h.endsWith(a))) best = Math.max(best, 2)
    else if (a.length >= 5 && h.includes(a)) best = Math.max(best, 1)
  }
  return best
}

/** Spalten eines Ziels zuordnen: { Feld: Spaltenindex } (jede Spalte höchstens einmal, bester Treffer zuerst). */
export function matchColumns(kind, header) {
  const fields = TARGETS[kind]?.fields || {}
  const pairs = []
  header.forEach((h, i) => {
    for (const [field, [label, ...aliases]] of Object.entries(fields)) {
      const s = Math.max(aliasScore(h, aliases), norm(h) === norm(label) ? 3 : 0)
      if (s) pairs.push({ field, i, s })
    }
  })
  pairs.sort((a, b) => b.s - a.s || a.i - b.i)
  const map = {}
  const used = new Set()
  for (const p of pairs) {
    if (p.field in map || used.has(p.i)) continue
    map[p.field] = p.i
    used.add(p.i)
  }
  return map
}

/** Wie gut passt eine Tabelle zu einem Ziel? 0 = gar nicht. */
export function scoreTable(kind, table) {
  const map = matchColumns(kind, table.columns)
  if (!REQUIRED[kind].every((group) => group.some((f) => f in map))) return 0
  let s = Object.keys(map).length
  const used = new Set(Object.values(map))
  s -= (AGAINST[kind] || []).filter((f) => {
    // Gegen-Felder in den übrigen Spalten suchen (z. B. „Menge“ in einer Kundenliste)
    return table.columns.some((h, i) => !used.has(i) && Object.values(TARGETS).some((t) => t.fields[f] && aliasScore(h, t.fields[f].slice(1)) === 3))
  }).length * 2
  const name = norm(`${table.name || ''}`)
  if (name && TARGETS[kind].words.some((w) => name.includes(norm(w)))) s += 6
  if (kind === 'textBlocks') {
    const i = map.text
    const avg = table.rows.slice(0, 30).reduce((n, r) => n + String(r[i] ?? '').length, 0) / Math.max(1, Math.min(30, table.rows.length))
    if (avg < 20) s -= 4
  }
  return Math.max(0, s)
}

/** Art einer Tabelle erkennen: { kind, map, score, scores } (kind '' = nicht erkannt). */
export function detectTable(table) {
  const scores = Object.fromEntries(Object.keys(TARGETS).map((k) => [k, scoreTable(k, table)]))
  const [kind, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return score > 0 ? { kind, map: matchColumns(kind, table.columns), score, scores } : { kind: '', map: {}, score: 0, scores }
}

// ---------------------------------------------------------------- Tabellen lesen

/** CSV/Text (Semikolon, Tabulator oder Komma) → { name, columns, rows }. */
export function tableFromCsv(text, name = '') {
  return toTable(parseCsvRows(text).rows, name)
}

/** Zeilen (erste mit Überschriften) → Tabelle; Überschrift = erste Zeile mit mindestens zwei Texten. */
export function toTable(rows, name = '') {
  const start = rows.findIndex((r) => r.filter((c) => String(c ?? '').trim() && !/^[\d.,\s-]+$/.test(String(c))).length >= 2)
  if (start < 0) return { name, columns: [], rows: [] }
  const columns = rows[start].map((c, i) => String(c ?? '').trim() || `Spalte ${i + 1}`)
  const body = rows.slice(start + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  return { name, columns, rows: body.map((r) => columns.map((_, i) => (r[i] == null ? '' : r[i]))) }
}

/**
 * XML-Tabellenexport (z. B. orgaMAX „Tabelle exportieren → XML“): Das Element, das am häufigsten mit gleichen
 * Kindern vorkommt, ist die Zeile; seine Kinder (oder Attribute) sind die Spalten.
 */
export function tablesFromXml(text, name = '') {
  const root = parseXml(text)
  if (['CrossIndustryInvoice', 'Invoice', 'CreditNote'].includes(root.name)) return []
  const groups = new Map()
  const walk = (n) => {
    const kids = n.children.filter((c) => c.name)
    if (kids.length >= 1) {
      const byName = new Map()
      for (const k of kids) byName.set(k.name, [...(byName.get(k.name) || []), k])
      for (const [childName, list] of byName) {
        const leafy = list.filter((x) => x.children.length ? x.children.every((c) => !c.children.length) : Object.keys(x.attrs).length > 1)
        if (leafy.length >= 1) groups.set(`${n.name}/${childName}`, [...(groups.get(`${n.name}/${childName}`) || []), ...leafy])
      }
    }
    for (const k of kids) walk(k)
  }
  walk(root)
  const out = []
  for (const [key, list] of groups) {
    if (list.length < 1) continue
    const cols = []
    for (const r of list) for (const k of [...Object.keys(r.attrs), ...r.children.map((c) => c.name)]) if (!cols.includes(k)) cols.push(k)
    if (cols.length < 2) continue
    const rows = list.map((r) => cols.map((c) => r.attrs[c] ?? (r.children.find((x) => x.name === c)?.text || '').trim()))
    out.push({ name: `${name}${name ? ' · ' : ''}${key.split('/').pop()}`, columns: cols, rows })
  }
  return out.sort((a, b) => b.rows.length - a.rows.length).slice(0, 12)
}

// ---------------------------------------------------------------- Werte

/** Datum aus Excel-Zahl, Date, „31.12.2025“, „31.12.25“, „2025-12-31“, „20251231“ → „2025-12-31“ oder ''. */
export function parseDateLoose(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
      return d.toISOString().slice(0, 10)
    }
    return ''
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/.exec(s)
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return ''
}

/** Betrag aus „€ 1.234,56“, „1.234,56 €“, „-12,50“, „20 %“, Zahl. */
export function money(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[€%\s]|EUR|eur/g, '').replace(/^\((.*)\)$/, '-$1')
  return parseNumber(s)
}
const has = (v) => v != null && String(v).trim() !== ''
const str = (v) => (v instanceof Date ? parseDateLoose(v) : String(v ?? '').trim())
export const yes = (v) => /^(1|ja|j|yes|y|true|wahr|x|aktiv|active)$/i.test(String(v ?? '').trim())

const COUNTRY = { oesterreich: 'AT', austria: 'AT', at: 'AT', a: 'AT', deutschland: 'DE', germany: 'DE', de: 'DE', d: 'DE', schweiz: 'CH', switzerland: 'CH', ch: 'CH', italien: 'IT', italy: 'IT', it: 'IT', slowenien: 'SI', si: 'SI', ungarn: 'HU', hu: 'HU', tschechien: 'CZ', cz: 'CZ', slowakei: 'SK', sk: 'SK', liechtenstein: 'LI', li: 'LI', niederlande: 'NL', nl: 'NL', frankreich: 'FR', fr: 'FR' }
export const countryCode = (v) => (has(v) ? COUNTRY[norm(v)] || String(v).trim().toUpperCase().slice(0, 2) : '')

const UNIT_CODES = { C62: 'Stk', H87: 'Stk', EA: 'Stk', XPP: 'Stk', HUR: 'Std.', MON: 'Monat', MTK: 'm²', LS: 'Pauschale', KMT: 'km', DAY: 'Tag', QAN: 'Quartal', ANN: 'Jahr', WEE: 'Woche', MTR: 'm', KGM: 'kg', LTR: 'l' }
const UNITS_TEXT = { stueck: 'Stk', stk: 'Stk', st: 'Stk', stunde: 'Std.', stunden: 'Std.', std: 'Std.', h: 'Std.', monat: 'Monat', monate: 'Monat', mtl: 'Monat', pauschal: 'Pauschale', pauschale: 'Pauschale', psch: 'Pauschale', pschl: 'Pauschale', m2: 'm²', qm: 'm²', km: 'km', einsatz: 'Einsatz', quartal: 'Quartal' }
export const unitOf = (v) => {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return UNIT_CODES[s.toUpperCase()] || UNITS_TEXT[norm(s)] || s
}

/** USt-Satz: „20“, „20 %“, „0,2“, Steuerschlüssel wie „20%“; sonst Standard. */
export function vatOf(v, fallback = 20) {
  if (!has(v)) return fallback
  let n = money(v)
  if (n > 0 && n < 1) n = round2(n * 100)
  return n >= 0 && n <= 30 ? n : fallback
}

// ---------------------------------------------------------------- Belegart und Nummern

/** Belegart aus Text, Nummer oder Tabellenname: rechnung | angebot | auftrag | storno | korrektur | '' (überspringen). */
export function kindOf({ text = '', number = '', tableName = '' } = {}) {
  const t = norm(text)
  const tests = [
    [/storno/, 'storno'],
    [/gutschrift|rechnungskorrektur|korrektur|creditnote|credit/, 'korrektur'],
    [/auftragsbestaetigung|auftrag|orderconfirmation|^ab$/, 'auftrag'],
    [/angebot|kostenvoranschlag|kva|offer|quote|^an$|^ag$/, 'angebot'],
    [/lieferschein|^ls$|deliverynote/, 'lieferschein'],
    [/proforma|^pf$/, 'proforma'],
    [/mahnung|bestellung/, ''],
    [/rechnung|abschlag|anzahlung|teilrechnung|schlussrechnung|endrechnung|invoice|^re$|^ar$|^rg$/, 'rechnung'],
  ]
  if (t) for (const [re, k] of tests) if (re.test(t)) return k
  const prefix = norm(String(number).match(/^[A-Za-z]+/)?.[0] || '')
  const byPrefix = { re: 'rechnung', rg: 'rechnung', ar: 'rechnung', r: 'rechnung', an: 'angebot', ag: 'angebot', ang: 'angebot', ab: 'auftrag', gs: 'korrektur', gu: 'korrektur', st: 'storno', sto: 'storno', ls: 'lieferschein', pf: 'proforma' }
  if (prefix in byPrefix) return byPrefix[prefix]
  const name = norm(tableName)
  if (name) for (const [re, k] of tests) if (re.test(name)) return k
  return 'rechnung'
}

/** Teil einer Abrechnung in Teilen: 'abschlag' (Anzahlung, Teilrechnung) oder 'schluss' (Schluss-/Endrechnung) oder ''. */
export function stageOf(text = '') {
  const t = norm(text)
  if (/schlussrechnung|endrechnung|schlussabrechnung|finalinvoice/.test(t)) return 'schluss'
  if (/abschlag|anzahlung|teilrechnung|vorauszahlung|prepayment|advance/.test(t)) return 'abschlag'
  return ''
}

/** Positionsart aus orgaMAX → lines[].type ('' = normale Position). */
export function lineTypeOf(v) {
  const t = norm(v)
  if (!t) return ''
  if (/zwischensumme|subtotal/.test(t)) return 'subtotal'
  if (/titel|ueberschrift|gruppe|title|header|heading/.test(t)) return 'title'
  if (/alternativ/.test(t)) return 'alternative'
  if (/bedarf|optional|option|eventual/.test(t)) return 'optional'
  if (/^text|textzeile|freitext|kommentar|bemerkung|comment/.test(t)) return 'text'
  return ''
}

/**
 * Nummernformat aus übernommenen Nummern erkennen: { template, yearly, digits, prefix } – z. B. „RE-2025-0153“ →
 * „RE-{JJJJ}-{NR}“, „10234“ → „{NR}“, „R25-0012“ → „R{JJ}-{NR}“. Vorlage wie in settings.numberFormats.
 */
export function detectNumberFormat(numbers = [], years = []) {
  const counts = new Map()
  numbers.forEach((num, idx) => {
    const n = String(num || '').trim()
    const m = /^(.*?)(\d+)$/.exec(n)
    if (!m) return
    let head = m[1]
    const year = String(years[idx] || '')
    let yearly = false
    if (year && head.includes(year)) {
      head = head.replace(year, '{JJJJ}')
      yearly = true
    } else if (year && head.includes(year.slice(2))) {
      head = head.replace(new RegExp(`${year.slice(2)}(?=\\D*$)`), '{JJ}')
      yearly = head.includes('{JJ}')
    } else if (year && !head && m[2].startsWith(year) && m[2].length >= 7) {
      // „20250153“: Jahr und Nummer ohne Trenner
      head = '{JJJJ}'
      yearly = true
      m[2] = m[2].slice(4)
    }
    const key = `${head}{NR}|${yearly}|${m[2].length}`
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) return null
  const [template, yearly, digits] = best[0].split('|')
  return { template, yearly: yearly === 'true', digits: Number(digits) }
}

// ---------------------------------------------------------------- Umwandeln

const rowValue = (row, map, field) => (field in map ? row[map[field]] : undefined)
function extraOf(table, row, map) {
  const used = new Set(Object.values(map))
  const extra = {}
  table.columns.forEach((c, i) => {
    if (!used.has(i) && has(row[i])) extra[c] = str(row[i])
  })
  return extra
}

function customerFrom(table, row, map, newId) {
  const v = (f) => rowValue(row, map, f)
  const street = [str(v('street')), str(v('houseNo'))].filter(Boolean).join(' ')
  const company = [str(v('name')), str(v('name2'))].filter(Boolean)
  const person = [str(v('firstName')), str(v('lastName'))].filter(Boolean).join(' ')
  const name = company[0] || person
  if (!name) return null
  const extra = extraOf(table, row, map)
  if (company[1]) extra['Firma Zusatz'] = company[1]
  const c = {
    id: newId('c'),
    name,
    customerNo: str(v('customerNo')),
    salutation: str(v('salutation')),
    title: str(v('title')),
    firstName: str(v('firstName')),
    lastName: str(v('lastName')),
    street,
    zip: str(v('zip')),
    city: str(v('city')),
    country: countryCode(v('country')) || 'AT',
    phone: str(v('phone')),
    mobile: str(v('mobile')),
    fax: str(v('fax')),
    email: str(v('email')).split(/[;,\s]+/)[0] || '',
    web: str(v('web')),
    uid: str(v('uid')).replace(/\s+/g, '').toUpperCase(),
    iban: str(v('iban')).replace(/\s+/g, '').toUpperCase(),
    bic: str(v('bic')).replace(/\s+/g, '').toUpperCase(),
    group: str(v('group')),
    discount: has(v('discount')) ? money(v('discount')) : '',
    paymentDays: has(v('paymentDays')) && /\d/.test(String(v('paymentDays'))) ? Math.round(money(v('paymentDays'))) : '',
    note: str(v('note')),
    account: str(v('account')),
    consumer: has(v('consumer')) ? /privat|ja|true|1|verbraucher/i.test(String(v('consumer'))) : !company[0] && !!person,
    reverseCharge: false,
    objectIds: [],
    contacts: has(v('contact')) ? [{ id: newId('cp'), name: str(v('contact')), role: '', email: '', phone: '' }] : [],
    extra,
    termsName: str(v('terms')),
    source: { system: SYSTEM, id: str(v('customerNo')), ...(has(v('srcId')) ? { dbId: str(v('srcId')) } : {}) },
  }
  if (has(v('custKind'))) c.consumer = String(v('custKind')).trim() === '1'
  // SEPA-Mandat (Lastschrift): in der App wie unter „Lastschrift & Mahnung“; nächste Lastschrift als Folge-Lastschrift
  if (has(v('mandateRef'))) {
    const scheme = /b2b|firmen/i.test(str(v('mandateScheme'))) ? 'B2B' : 'CORE'
    c.mandate = { reference: str(v('mandateRef')).slice(0, 35), signedAt: parseDateLoose(v('mandateDate')), scheme, sequence: 'RCUR', active: !has(v('payMethod')) || /lastschrift|einzug|sepa|debit/i.test(str(v('payMethod'))), note: `aus ${SYSTEM} übernommen` }
  }
  // nicht gesetzte Felder weglassen (Datei bleibt klein)
  for (const k of Object.keys(c)) if (c[k] === '' && !['name', 'customerNo'].includes(k)) delete c[k]
  if (c.name !== name) c.name = name
  return c
}

function articleFrom(table, row, map, newId) {
  const v = (f) => rowValue(row, map, f)
  const name = str(v('name')) || str(v('longText')).split('\n')[0]
  if (!name && !has(v('articleNo'))) return null
  const vat = vatOf(v('vat'))
  const price = has(v('price')) ? money(v('price')) : has(v('priceGross')) ? round2(money(v('priceGross')) / (1 + vat / 100)) : 0
  const a = {
    id: newId('a'),
    articleNo: str(v('articleNo')),
    name: name || str(v('articleNo')),
    longText: str(v('longText')) !== name ? str(v('longText')) : '',
    unit: unitOf(v('unit')) || 'Stk',
    price,
    vat: VAT_RATES.includes(vat) ? vat : 20,
    cost: has(v('cost')) ? money(v('cost')) : '',
    group: str(v('group')),
    active: has(v('blocked')) ? !yes(v('blocked')) : has(v('active')) ? yes(v('active')) : true,
    extra: extraOf(table, row, map),
    source: { system: SYSTEM, id: str(v('articleNo')), ...(has(v('srcId')) ? { dbId: str(v('srcId')) } : {}) },
  }
  for (const k of ['longText', 'cost', 'group', 'articleNo']) if (a[k] === '') delete a[k]
  return a
}

/** Textbaustein: Belegart und Stelle aus Text wie „Rechnung – Einleitung“. */
function textBlockFrom(row, map, newId) {
  const v = (f) => rowValue(row, map, f)
  const text = str(v('text'))
  if (!text) return null
  const hint = norm(`${str(v('kind'))} ${str(v('place'))} ${str(v('name'))}`)
  const kind = /mahnung|zahlungserinnerung/.test(hint) ? 'mahnung' : /email|mail/.test(hint) ? 'mail' : /storno/.test(hint) ? 'storno' : /gutschrift|korrektur/.test(hint) ? 'korrektur' : /auftrag/.test(hint) ? 'auftrag' : /angebot/.test(hint) ? 'angebot' : /rechnung/.test(hint) ? 'rechnung' : 'alle'
  const place = kind === 'mail' ? 'mail' : kind === 'mahnung' ? 'reminder' : /schluss|fuss|nachtext|ende|abschluss|outro/.test(hint) ? 'outro' : /position|artikel/.test(hint) ? 'position' : 'intro'
  return { id: newId('tb'), name: str(v('name')) || text.split('\n')[0].slice(0, 40), kind, place, text, isDefault: has(v('isDefault')) ? yes(v('isDefault')) : false, source: { system: SYSTEM } }
}

function termFrom(row, map, newId) {
  const v = (f) => rowValue(row, map, f)
  const name = str(v('name'))
  if (!name) return null
  return { id: newId('zb'), name, days: Math.round(money(v('days'))) || 0, skontoPercent: has(v('skontoPercent')) ? money(v('skontoPercent')) : 0, skontoDays: has(v('skontoDays')) ? Math.round(money(v('skontoDays'))) : 0, text: str(v('text')), isDefault: has(v('isDefault')) ? yes(v('isDefault')) : false, source: { system: SYSTEM } }
}

const INTERVAL_TEXT = [
  [/quartal|vierteljaehr|3monat|dreimonat/, 'quartal'],
  [/halbjaehr|halbjahr|6monat|sechsmonat/, 'halbjahr'],
  [/jaehrlich|jahr|12monat|annual|year/, 'jahr'],
  [/monat|monthly|month/, 'monat'],
]
export const intervalOf = (v) => {
  if (typeof v === 'number' || /^\d+$/.test(String(v ?? '').trim())) return { 3: 'quartal', 6: 'halbjahr', 12: 'jahr' }[Number(v)] || 'monat'
  return INTERVAL_TEXT.find(([re]) => re.test(norm(v)))?.[1] || 'monat'
}

// ---------------------------------------------------------------- E-Rechnung (CII / UBL)

const ciiDate = (node) => {
  const s = textAt(node, 'DateTimeString') || node?.text?.trim() || ''
  return parseDateLoose(s)
}
const amountAt = (node, path) => {
  const t = textAt(node, path)
  return t ? Number(t) || 0 : null
}

/** Anschrift aus CII-PostalTradeAddress bzw. UBL-PostalAddress. */
function partyAddress(addr, ubl) {
  if (!addr) return {}
  if (ubl) {
    const street = [textAt(addr, 'StreetName'), textAt(addr, 'BuildingNumber')].filter(Boolean).join(' ')
    return { street, zip: textAt(addr, 'PostalZone'), city: textAt(addr, 'CityName'), country: textAt(addr, 'Country/IdentificationCode'), extraLine: textAt(addr, 'AdditionalStreetName') }
  }
  return { street: textAt(addr, 'LineOne'), extraLine: textAt(addr, 'LineTwo'), zip: textAt(addr, 'PostcodeCode'), city: textAt(addr, 'CityName'), country: textAt(addr, 'CountryID') }
}

/**
 * E-Rechnung (XML) lesen: ZUGFeRD 2.x/Factur-X/XRechnung (CII) oder XRechnung/PEPPOL (UBL Invoice/CreditNote).
 * → { kind, number, date, dueDate, serviceFrom, serviceTo, reference, refNumber, currency, buyer, seller, lines,
 *     total: { net, vat, gross, groups }, paid, reverseCharge, note, format } oder wirft.
 */
export function parseEInvoice(xml) {
  const root = parseXml(xml)
  if (root.name === 'CrossIndustryInvoice') {
    const doc = find(root, 'ExchangedDocument')
    const tx = find(root, 'SupplyChainTradeTransaction')
    const agr = find(tx, 'ApplicableHeaderTradeAgreement')
    const set = find(tx, 'ApplicableHeaderTradeSettlement')
    const typeCode = textAt(doc, 'TypeCode')
    const party = (p) => {
      if (!p) return null
      const tax = findAll(p, 'SpecifiedTaxRegistration').map((r) => find(r, 'ID')).find((id) => id && /VA/i.test(id.attrs.schemeID || 'VA'))
      return {
        name: textAt(p, 'Name'),
        id: textAt(p, 'ID'),
        contact: textAt(p, 'DefinedTradeContact/PersonName'),
        email: textAt(p, 'URIUniversalCommunication/URIID') || textAt(p, 'DefinedTradeContact/EmailURIUniversalCommunication/URIID'),
        phone: textAt(p, 'DefinedTradeContact/TelephoneUniversalCommunication/CompleteNumber'),
        uid: (tax?.text || '').trim(),
        ...partyAddress(find(p, 'PostalTradeAddress'), false),
      }
    }
    const lines = findAll(tx, 'IncludedSupplyChainTradeLineItem').map((it, i) => {
      const qtyNode = find(it, 'SpecifiedLineTradeDelivery/BilledQuantity')
      const priceNode = find(it, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice')
      const basis = Number(textAt(priceNode, 'BasisQuantity')) || 1
      const desc = textAt(it, 'SpecifiedTradeProduct/Description')
      return {
        pos: textAt(it, 'AssociatedDocumentLineDocument/LineID') || String(i + 1),
        articleNo: textAt(it, 'SpecifiedTradeProduct/SellerAssignedID'),
        text: textAt(it, 'SpecifiedTradeProduct/Name') || desc,
        longText: textAt(it, 'SpecifiedTradeProduct/Name') ? desc : '',
        qty: Number(qtyNode?.text) || 0,
        unit: unitOf(qtyNode?.attrs.unitCode),
        price: round2((Number(textAt(priceNode, 'ChargeAmount')) || 0) / basis),
        vat: Number(textAt(it, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent')) || 0,
        category: textAt(it, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/CategoryCode'),
        net: amountAt(it, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'),
      }
    })
    const sum = find(set, 'SpecifiedTradeSettlementHeaderMonetarySummation')
    const groups = findAll(set, 'ApplicableTradeTax').map((t) => ({ rate: Number(textAt(t, 'RateApplicablePercent')) || 0, net: Number(textAt(t, 'BasisAmount')) || 0, vat: Number(textAt(t, 'CalculatedAmount')) || 0, category: textAt(t, 'CategoryCode') }))
    const period = find(set, 'BillingSpecifiedPeriod')
    const delivery = find(tx, 'ApplicableHeaderTradeDelivery/ActualDeliverySupplyChainEvent/OccurrenceDateTime')
    const gross = amountAt(sum, 'GrandTotalAmount')
    return {
      format: 'CII',
      kind: typeCode === '381' ? 'korrektur' : 'rechnung',
      typeCode,
      number: textAt(doc, 'ID'),
      date: ciiDate(find(doc, 'IssueDateTime')),
      dueDate: ciiDate(find(set, 'SpecifiedTradePaymentTerms/DueDateDateTime')),
      termsText: textAt(set, 'SpecifiedTradePaymentTerms/Description'),
      serviceFrom: ciiDate(find(period, 'StartDateTime')) || ciiDate(delivery),
      serviceTo: ciiDate(find(period, 'EndDateTime')) || ciiDate(delivery),
      reference: textAt(agr, 'BuyerOrderReferencedDocument/IssuerAssignedID') || textAt(agr, 'BuyerReference'),
      refNumber: textAt(set, 'InvoiceReferencedDocument/IssuerAssignedID'),
      currency: textAt(set, 'InvoiceCurrencyCode') || 'EUR',
      seller: party(find(agr, 'SellerTradeParty')),
      buyer: party(find(agr, 'BuyerTradeParty')),
      note: findAll(doc, 'IncludedNote').map((n) => textAt(n, 'Content')).filter(Boolean).join('\n'),
      lines,
      reverseCharge: groups.some((g) => g.category === 'AE') || lines.some((l) => l.category === 'AE'),
      total: { net: amountAt(sum, 'TaxBasisTotalAmount') ?? amountAt(sum, 'LineTotalAmount') ?? 0, vat: amountAt(sum, 'TaxTotalAmount') ?? 0, gross: gross ?? 0, groups: groups.map(({ rate, net, vat }) => ({ rate, net, vat })) },
      paid: amountAt(sum, 'TotalPrepaidAmount') || 0,
      due: amountAt(sum, 'DuePayableAmount'),
    }
  }
  if (root.name === 'Invoice' || root.name === 'CreditNote') {
    const credit = root.name === 'CreditNote'
    const party = (p) => {
      if (!p) return null
      return {
        name: textAt(p, 'PartyName/Name') || textAt(p, 'PartyLegalEntity/RegistrationName'),
        id: textAt(p, 'PartyIdentification/ID'),
        contact: textAt(p, 'Contact/Name'),
        email: textAt(p, 'Contact/ElectronicMail') || textAt(p, 'EndpointID'),
        phone: textAt(p, 'Contact/Telephone'),
        uid: findAll(p, 'PartyTaxScheme').map((t) => textAt(t, 'CompanyID')).find(Boolean) || '',
        ...partyAddress(find(p, 'PostalAddress'), true),
      }
    }
    const lineName = credit ? 'CreditNoteLine' : 'InvoiceLine'
    const lines = findAll(root, lineName).map((it, i) => {
      const qtyNode = find(it, credit ? 'CreditedQuantity' : 'InvoicedQuantity')
      const basis = Number(textAt(it, 'Price/BaseQuantity')) || 1
      const desc = textAt(it, 'Item/Description')
      const cat = find(it, 'Item/ClassifiedTaxCategory')
      return {
        pos: textAt(it, 'ID') || String(i + 1),
        articleNo: textAt(it, 'Item/SellersItemIdentification/ID'),
        text: textAt(it, 'Item/Name') || desc,
        longText: textAt(it, 'Item/Name') ? desc : '',
        qty: Number(qtyNode?.text) || 0,
        unit: unitOf(qtyNode?.attrs.unitCode),
        price: round2((Number(textAt(it, 'Price/PriceAmount')) || 0) / basis),
        vat: Number(textAt(cat, 'Percent')) || 0,
        category: textAt(cat, 'ID'),
        net: amountAt(it, 'LineExtensionAmount'),
      }
    })
    const tot = find(root, 'LegalMonetaryTotal')
    const groups = descendants(find(root, 'TaxTotal'), 'TaxSubtotal').map((t) => ({ rate: Number(textAt(t, 'TaxCategory/Percent')) || 0, net: Number(textAt(t, 'TaxableAmount')) || 0, vat: Number(textAt(t, 'TaxAmount')) || 0, category: textAt(t, 'TaxCategory/ID') }))
    return {
      format: 'UBL',
      kind: credit || textAt(root, 'InvoiceTypeCode') === '381' ? 'korrektur' : 'rechnung',
      typeCode: textAt(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
      number: textAt(root, 'ID'),
      date: parseDateLoose(textAt(root, 'IssueDate')),
      dueDate: parseDateLoose(textAt(root, 'DueDate') || textAt(root, 'PaymentMeans/PaymentDueDate')),
      termsText: textAt(root, 'PaymentTerms/Note'),
      serviceFrom: parseDateLoose(textAt(root, 'InvoicePeriod/StartDate') || textAt(root, 'Delivery/ActualDeliveryDate')),
      serviceTo: parseDateLoose(textAt(root, 'InvoicePeriod/EndDate') || textAt(root, 'Delivery/ActualDeliveryDate')),
      reference: textAt(root, 'OrderReference/ID') || textAt(root, 'BuyerReference'),
      refNumber: textAt(root, 'BillingReference/InvoiceDocumentReference/ID'),
      currency: textAt(root, 'DocumentCurrencyCode') || 'EUR',
      seller: party(find(root, 'AccountingSupplierParty/Party')),
      buyer: party(find(root, 'AccountingCustomerParty/Party')),
      note: findAll(root, 'Note').map((n) => n.text.trim()).filter(Boolean).join('\n'),
      lines,
      reverseCharge: groups.some((g) => g.category === 'AE') || lines.some((l) => l.category === 'AE'),
      total: { net: amountAt(tot, 'TaxExclusiveAmount') ?? 0, vat: round2((amountAt(tot, 'TaxInclusiveAmount') ?? 0) - (amountAt(tot, 'TaxExclusiveAmount') ?? 0)), gross: amountAt(tot, 'TaxInclusiveAmount') ?? 0, groups: groups.map(({ rate, net, vat }) => ({ rate, net, vat })) },
      paid: amountAt(tot, 'PrepaidAmount') || 0,
      due: amountAt(tot, 'PayableAmount'),
    }
  }
  throw new Error(`Keine E-Rechnung (Wurzel „${root.name}“).`)
}

// ---------------------------------------------------------------- PDF: eingebettete Dateien (ZUGFeRD)

const latin1 = (bytes, from = 0, to = bytes.length) => {
  let s = ''
  for (let i = from; i < to; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 8192)))
  return s
}

/**
 * In ein PDF eingebettete Dateien (ZUGFeRD/Factur-X: factur-x.xml, zugferd-invoice.xml, xrechnung.xml):
 * → [{ bytes }] (entpackt). inflate(bytes) → Promise<Uint8Array> für FlateDecode (Browser: DecompressionStream,
 * Node: zlib). Liest nur Dateiströme mit /Type /EmbeddedFile.
 */
export async function pdfEmbeddedFiles(bytes, inflate) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const text = latin1(data)
  const out = []
  const re = /\/Type\s*\/EmbeddedFile\b/g
  let m
  while ((m = re.exec(text))) {
    const objStart = text.lastIndexOf(' obj', m.index)
    const streamAt = text.indexOf('stream', m.index)
    if (objStart < 0 || streamAt < 0) continue
    const dict = text.slice(objStart, streamAt)
    let start = streamAt + 6
    if (text[start] === '\r') start++
    if (text[start] === '\n') start++
    const lenMatch = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict)
    let end = lenMatch ? start + Number(lenMatch[1]) : text.indexOf('endstream', start)
    if (end < start || end > data.length) end = text.indexOf('endstream', start)
    let raw = data.subarray(start, end)
    if (/\/FlateDecode/.test(dict)) {
      try {
        raw = await inflate(raw)
      } catch {
        continue
      }
    }
    out.push({ bytes: raw })
    re.lastIndex = end
  }
  return out
}

/** E-Rechnungs-XML aus PDF-Bytes oder null. */
export async function eInvoiceFromPdf(bytes, inflate) {
  for (const f of await pdfEmbeddedFiles(bytes, inflate)) {
    const xml = new TextDecoder('utf-8').decode(f.bytes)
    if (/CrossIndustryInvoice|<(\w+:)?Invoice[\s>]|<(\w+:)?CreditNote[\s>]/.test(xml)) return xml
  }
  return null
}

/** Belegnummer im Dateinamen finden (längste passende zuerst): „Rechnung_RE-2025-0153_Spar.pdf“ → „RE-2025-0153“. */
export function numberInName(name, numbers) {
  const n = norm(name)
  return [...numbers].filter(Boolean).sort((a, b) => String(b).length - String(a).length).find((x) => {
    const k = norm(x)
    if (k.length < 3) return false
    const at = n.indexOf(k)
    // nicht Teil einer längeren Zahl („153“ nicht in „1530“)
    return at >= 0 && !(/\d$/.test(k) && /\d/.test(n[at + k.length] || ''))
  }) || null
}

// ---------------------------------------------------------------- Alles zusammen

let counter = 0
const defaultId = (p) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Aus erkannten Tabellen und E-Rechnungen die Daten bauen.
 * sources: [{ table, kind, map }] und eInvoices: [{ invoice (aus parseEInvoice), fileName, original }]
 * opts: { existing (fakturierung.json), objects, now, newId, sender }
 * → { customers, articles, documents, textBlocks, paymentTerms, recurring, warnings, skipped }
 */
export function buildImport(sources = [], eInvoices = [], opts = {}) {
  const newId = opts.newId || defaultId
  const now = opts.now || new Date().toISOString()
  const existing = opts.existing || {}
  const warnings = []
  const skipped = { lieferscheine: 0, ohneNummer: 0, leer: 0, lieferanten: 0 }
  const out = { customers: [], articles: [], documents: [], textBlocks: [], paymentTerms: [], recurring: [], warnings, skipped }
  const of = (kind) => sources.filter((s) => s.kind === kind)

  // Kunden und Ansprechpartner
  for (const s of of('customers')) for (const row of s.table.rows) {
    // orgaMAX: Kunden, Lieferanten und Interessenten in einer Tabelle (CONTACTTYPE 0 / 3 / 5)
    const type = String(rowValue(row, s.map, 'contactType') ?? '').trim()
    if (type === '3') {
      skipped.lieferanten++
      continue
    }
    const c = customerFrom(s.table, row, s.map, newId)
    if (!c) {
      skipped.leer++
      continue
    }
    if (type === '5' && !c.group) c.group = 'Interessent'
    out.customers.push(c)
  }
  const allCustomers = () => [...out.customers, ...(existing.customers || [])]
  const findCustomer = ({ no, name, ref }) => {
    const list = allCustomers()
    if (has(ref)) {
      const hit = list.find((c) => c.source?.dbId != null && c.source.dbId === String(ref).trim())
      if (hit) return hit
    }
    if (has(no)) {
      const hit = list.find((c) => String(c.customerNo) === String(no).trim())
      if (hit) return hit
    }
    if (has(name)) return list.find((c) => norm(c.name) === norm(name)) || null
    return null
  }
  for (const s of of('contacts')) for (const row of s.table.rows) {
    const v = (f) => rowValue(row, s.map, f)
    const cust = findCustomer({ no: v('customerNo'), name: v('customerName'), ref: v('customerRef') })
    const name = [str(v('salutation')), str(v('firstName')), str(v('lastName'))].filter(Boolean).join(' ') || str(v('name'))
    if (!cust || !name) {
      skipped.leer++
      continue
    }
    // vorhandene Kunden nie direkt ändern: Kopie, die beim Einspielen ergänzt wird
    let target = out.customers.includes(cust) ? cust : null
    if (!target) {
      target = { ...cust, contacts: [...(cust.contacts || [])] }
      out.customers.unshift(target)
    }
    target.contacts = [...(target.contacts || []).filter((x) => norm(x.name) !== norm(name)), { id: newId('cp'), name, role: str(v('role')), email: str(v('email')), phone: str(v('phone')) || str(v('mobile')) }]
  }

  // Artikel, Textbausteine, Zahlungsbedingungen
  for (const s of of('articles')) for (const row of s.table.rows) {
    const a = articleFrom(s.table, row, s.map, newId)
    if (a) out.articles.push(a)
  }
  for (const s of of('textBlocks')) for (const row of s.table.rows) {
    const t = textBlockFrom(row, s.map, newId)
    if (t) out.textBlocks.push(t)
  }
  for (const s of of('paymentTerms')) for (const row of s.table.rows) {
    const t = termFrom(row, s.map, newId)
    if (t) out.paymentTerms.push(t)
  }
  const terms = [...out.paymentTerms, ...(existing.paymentTerms || [])]
  for (const c of out.customers) {
    if (c.termsName) {
      const t = terms.find((x) => norm(x.name) === norm(c.termsName))
      if (t) {
        c.termsId = t.id
        if (c.paymentDays === undefined && t.days) c.paymentDays = t.days
      } else (c.extra ||= {}).Zahlungsbedingung = c.termsName
    }
    delete c.termsName
  }

  // Positionen: mit Belegnummer oder (Datenbank) mit der internen ID des Belegs; zugeordnet nach den Köpfen
  const linesByDoc = new Map()
  const rawLines = []
  const articlesByDbId = new Map([...(existing.articles || []), ...out.articles].filter((a) => a.source?.dbId != null).map((a) => [a.source.dbId, a]))
  for (const s of of('lines')) for (const row of s.table.rows) {
    const v = (f) => rowValue(row, s.map, f)
    const no = str(v('docNumber'))
    const ref = str(v('docRef'))
    if (!no && !ref) continue
    const qty = has(v('qty')) ? money(v('qty')) : 1
    const net = has(v('net')) ? money(v('net')) : null
    const discount = has(v('discount')) ? money(v('discount')) : 0
    const price = has(v('price')) ? money(v('price')) : net != null && qty ? round2(net / qty / (1 - discount / 100 || 1)) : 0
    const line = { pos: Number(money(v('pos'))) || 0, articleNo: str(v('articleNo')), text: str(v('text')), longText: str(v('longText')), qty, unit: unitOf(v('unit')), price, discount, vat: has(v('vat')) ? vatOf(v('vat')) : null, net, kind: str(v('docKind')), type: lineTypeOf(v('lineType')), altRef: str(v('altRef')) }
    const art = has(v('artRef')) ? articlesByDbId.get(str(v('artRef'))) : null
    if (art && !line.articleNo && art.articleNo) line.articleNo = art.articleNo
    if (!line.text && art) line.text = art.name
    if (!line.text && line.articleNo) line.text = [...out.articles, ...(existing.articles || [])].find((a) => a.articleNo === line.articleNo)?.name || line.articleNo
    if (!line.text && !line.price && !net && !line.type) continue
    rawLines.push({ line, no, ref, table: s.table.name || '' })
  }
  /** Kopf-Tabelle zu einer Positionstabelle: die längste, mit deren Namen sie beginnt (MOV_INVOICES_POSITIONS → MOV_INVOICES). */
  const headTables = [...of('documents'), ...of('recurring')].map((x) => x.table.name || '')
  const headFor = (table) => headTables.filter((h) => h && table.toUpperCase().startsWith(h.toUpperCase())).sort((a, b) => b.length - a.length)[0] || ''

  // Belegköpfe
  const objects = opts.objects || []
  const docs = []
  for (const s of of('documents')) for (const row of s.table.rows) {
    const v = (f) => rowValue(row, s.map, f)
    const number = str(v('number'))
    if (!number) {
      skipped.ohneNummer++
      continue
    }
    // orgaMAX MOV_ORDERS: ORDERTYPE 1 = Angebot, 2 = Auftrag
    const orderType = has(v('orderType')) && /ORDER/i.test(s.table.name || '') ? String(v('orderType')).trim() : ''
    let kind = orderType ? { 1: 'angebot', 2: 'auftrag' }[orderType] || '' : kindOf({ text: str(v('kind')), number, tableName: s.table.name })
    if (kind === 'rechnung' && has(v('gross')) && money(v('gross')) < 0) kind = 'korrektur'
    const stage = kind === 'rechnung' ? stageOf(`${str(v('kind'))} ${str(v('title'))}`) : ''
    if (!kind) {
      skipped.lieferscheine++
      continue
    }
    const date = parseDateLoose(v('date'))
    const cust = findCustomer({ no: v('customerNo'), name: v('customerName'), ref: v('customerRef') })
    const recipientAddress = composeAddress({ street: str(v('street')), zip: str(v('zip')), city: str(v('city')), country: countryCode(v('country')) || 'AT' })
    const recipient = cust
      ? { name: cust.name, address: composeAddress(cust), uid: cust.uid || '', email: cust.email || '', customerNo: cust.customerNo || '', consumer: !!cust.consumer }
      : { name: str(v('customerName')), address: recipientAddress, uid: str(v('uid')), email: '', customerNo: str(v('customerNo')), consumer: false }
    if (!cust && (has(v('customerNo')) || has(v('customerName')))) warnings.push(`${number}: Kunde „${str(v('customerName')) || str(v('customerNo'))}“ nicht in den Kunden – Empfänger aus dem Beleg übernommen.`)
    const dueRaw = v('dueDate')
    const dueDate = parseDateLoose(dueRaw) || (has(dueRaw) && /^\d+$/.test(String(dueRaw).trim()) && date ? addDays(date, Number(dueRaw)) : '')
    const obj = has(v('objectName')) ? objects.find((o) => norm(o.name) === norm(v('objectName'))) : null
    docs.push({
      kind,
      number,
      date,
      dueDate,
      customer: cust,
      recipient,
      title: str(v('title')),
      intro: str(v('intro')),
      outro: str(v('outro')),
      serviceFrom: parseDateLoose(v('serviceFrom')) || '',
      serviceTo: parseDateLoose(v('serviceTo')) || parseDateLoose(v('serviceFrom')) || '',
      reference: str(v('reference')),
      refNumber: str(v('refNumber')),
      discount: has(v('discount')) ? money(v('discount')) : 0,
      net: has(v('net')) ? money(v('net')) : null,
      vatAmount: has(v('vatAmount')) ? money(v('vatAmount')) : null,
      gross: has(v('gross')) ? money(v('gross')) : null,
      paid: has(v('paid')) && !/^(ja|nein|x)$/i.test(String(v('paid')).trim()) ? money(v('paid')) : null,
      paidFlag: has(v('paid')) && /^(ja|x|bezahlt)$/i.test(String(v('paid')).trim()),
      open: has(v('open')) ? money(v('open')) : null,
      paidDate: parseDateLoose(v('paidDate')),
      status: norm(v('status')),
      reminderLevel: has(v('reminderLevel')) ? Math.round(money(v('reminderLevel'))) : 0,
      lastReminder: parseDateLoose(v('lastReminder')),
      objectId: obj?.id || '',
      extra: extraOf(s.table, row, s.map),
      srcId: str(v('srcId')),
      srcTable: s.table.name || '',
      stage,
    })
  }
  // Positionen den Belegen zuordnen
  const byDbId = new Map(docs.filter((d) => d.srcId).map((d) => [`${d.srcTable}|${d.srcId}`, d]))
  for (const r of rawLines) {
    let no = r.no
    if (!no && r.ref) {
      const head = headFor(r.table)
      const d = head ? byDbId.get(`${head}|${r.ref}`) : docs.find((x) => x.srcId === r.ref)
      no = d?.number || ''
      if (!no) {
        if (!head || !of('recurring').some((x) => x.table.name === head)) warnings.push(`Position ohne Beleg (interne ID ${r.ref} in ${r.table || 'Positionen'}) – nicht übernommen.`)
        continue
      }
    }
    const key = norm(no)
    r.line.docNumber = no
    linesByDoc.set(key, [...(linesByDoc.get(key) || []), r.line])
  }
  // Zahlungen (orgaMAX MOV_PAYMENTS): je Beleg; gehen vor „bezahlt“ aus der Belegliste
  const paymentsByDoc = new Map()
  for (const s of of('payments')) for (const row of s.table.rows) {
    const v = (f) => rowValue(row, s.map, f)
    let no = str(v('docNumber'))
    if (!no && has(v('docRef'))) {
      const head = headFor(s.table.name || '') || docs.find((d) => /INVOICE/i.test(d.srcTable))?.srcTable || ''
      no = (byDbId.get(`${head}|${str(v('docRef'))}`) || docs.find((d) => d.srcId === str(v('docRef')) && d.kind === 'rechnung'))?.number || ''
    }
    const amount = money(v('amount'))
    if (!no || !amount) continue
    const skonto = has(v('skonto')) ? money(v('skonto')) : 0
    const key = norm(no)
    paymentsByDoc.set(key, [...(paymentsByDoc.get(key) || []), { date: parseDateLoose(v('date')), amount, skonto, note: str(v('note')) }])
  }
  // Positionen ohne Kopf: Belege nur aus Positionen bilden (Datum unbekannt → Warnung)
  const headKeys = new Set(docs.map((d) => norm(d.number)))
  for (const [key, lines] of linesByDoc) {
    if (headKeys.has(key) || !eInvoices.every((e) => norm(e.invoice.number) !== key)) continue
    warnings.push(`Positionen zu Beleg ${lines[0].docNumber} ohne Belegkopf (Datum, Kunde) – nicht übernommen. Bitte auch die Belegliste exportieren.`)
  }

  // E-Rechnungen: vollständige Belege (gehen vor Tabellenköpfen ohne Positionen)
  const eDocs = []
  for (const e of eInvoices) {
    const inv = e.invoice
    if (!inv.number) continue
    const b = inv.buyer || {}
    let cust = findCustomer({ no: b.id, name: b.name })
    if (!cust && b.name) {
      cust = {
        id: newId('c'),
        name: b.name,
        customerNo: b.id || '',
        street: [b.street, b.extraLine].filter(Boolean).join(', '),
        zip: b.zip || '',
        city: b.city || '',
        country: countryCode(b.country) || 'AT',
        uid: b.uid || '',
        email: b.email || '',
        phone: b.phone || '',
        contacts: b.contact ? [{ id: newId('cp'), name: b.contact, role: '', email: '', phone: '' }] : [],
        objectIds: [],
        source: { system: 'E-Rechnung', id: b.id || '' },
      }
      for (const k of Object.keys(cust)) if (cust[k] === '' && !['name', 'customerNo'].includes(k)) delete cust[k]
      out.customers.push(cust)
    }
    eDocs.push({ e, inv, cust })
  }

  const docNumbers = new Set()
  const sign = (kind, n) => (['storno', 'korrektur'].includes(kind) && n > 0 ? -n : n)
  const make = (h, lines, source) => {
    const id = newId('d')
    const sorted = lines.slice().sort((a, b) => (a.pos || 0) - (b.pos || 0))
    const normLines = sorted
      .map((l, i) => {
        // Storno und Gutschrift: immer negative Menge, positiver Preis (wie stornoDraft); Rechnung: wie im Altsystem
        const credit = ['storno', 'korrektur'].includes(h.kind)
        const qty = credit ? -Math.abs(l.qty || 1) : l.qty
        const price = credit ? Math.abs(l.price) : l.price
        // Positionsart: Text/Titel/Zwischensumme ohne Menge und Preis; Option/Alternative nur in Angebot und Auftrag
        const type = ['optional', 'alternative'].includes(l.type) && !['angebot', 'auftrag'].includes(h.kind) ? '' : l.type
        if (['text', 'title', 'subtotal'].includes(type)) return { id: `${id}-${i + 1}`, type, text: l.text || '', ...(l.longText && l.longText !== l.text ? { longText: l.longText } : {}) }
        return { id: `${id}-${i + 1}`, ...(type ? { type } : {}), ...(type === 'alternative' && l.altRef ? { altPos: l.altRef } : {}), text: l.text, ...(l.longText && l.longText !== l.text ? { longText: l.longText } : {}), ...(l.articleNo ? { articleNo: l.articleNo } : {}), qty, unit: l.unit || 'Stk', price, vat: l.vat ?? h.vatGuess ?? 20, discount: l.discount || 0 }
      })
    // Alternative → Position, die sie ersetzen würde (über die Positionsnummer aus orgaMAX)
    for (const l of normLines) {
      if (!l.altPos) continue
      const target = normLines[sorted.findIndex((x) => String(x.pos) === String(l.altPos))]
      if (target) l.altTo = target.id
      delete l.altPos
    }
    const doc = {
      id,
      kind: h.kind,
      status: h.kind === 'angebot' ? 'offen' : 'fest',
      number: h.number,
      date: h.date,
      dueDate: h.dueDate || '',
      serviceFrom: h.serviceFrom || h.date,
      serviceTo: h.serviceTo || h.serviceFrom || h.date,
      customerId: h.customer?.id || '',
      objectId: h.objectId || '',
      recipient: h.recipient,
      sender: h.sender || opts.sender || {},
      title: h.title || '',
      intro: h.intro || '',
      outro: h.outro || '',
      lines: normLines,
      discount: h.discount || 0,
      reverseCharge: !!h.reverseCharge,
      smallBusiness: false,
      ...(h.stage ? { stage: h.stage } : {}),
      ...(h.reference ? { reference: h.reference } : {}),
      ...(h.refNumber ? { refNumber: h.refNumber } : {}),
      imported: { system: source, at: now, ref: h.number },
      ...(h.extra && Object.keys(h.extra).length ? { extra: h.extra } : {}),
      ...(h.original ? { original: h.original } : {}),
      finalizedAt: now,
      finalizedBy: `Übernahme ${source}`,
      history: [{ at: now, by: `Übernahme ${source}`, text: `aus ${source} übernommen (Nummer ${h.number})` }],
    }
    // Summen: aus den Positionen gerechnet; weicht das Altsystem ab, gelten dessen Summen (Rundung, Sonderfälle)
    const t = normLines.length ? totals(doc, { vat: 20 }) : null
    const srcGross = h.gross != null ? sign(h.kind, h.gross) : h.net != null && h.vatAmount != null ? sign(h.kind, round2(h.net + h.vatAmount)) : null
    const srcNet = h.net != null ? sign(h.kind, h.net) : null
    if (t && (srcGross == null || Math.abs(t.gross - srcGross) <= 0.02)) doc.total = { net: t.net, vat: t.vat, gross: t.gross, groups: t.groups.map(({ rate, net, vat }) => ({ rate, net, vat })) }
    else {
      const gross = srcGross ?? t?.gross ?? 0
      const net = srcNet ?? (h.vatAmount != null ? round2(gross - sign(h.kind, h.vatAmount)) : round2(gross / 1.2))
      const groups = h.groups?.length ? h.groups.map((g) => ({ rate: g.rate, net: sign(h.kind, g.net), vat: sign(h.kind, g.vat) })) : [{ rate: net ? Math.round(((gross - net) / net) * 100) : 0, net, vat: round2(gross - net) }]
      doc.total = { net, vat: round2(gross - net), gross, groups }
      if (t) warnings.push(`${h.number}: Summe aus den Positionen (${t.gross.toFixed(2)}) weicht von ${source} ab (${gross.toFixed(2)}) – Summe aus ${source} übernommen.`)
      if (!normLines.length) doc.linesMissing = true
    }
    // Zahlungen: aus der Zahlungstabelle; sonst bezahlt am / bezahlter Betrag / offener Rest / Status
    const gross = doc.total.gross
    const listed = paymentsByDoc.get(norm(h.number))
    if (h.kind === 'rechnung' && listed?.length) {
      // Skonto als eigener Eintrag (kind 'skonto', Verweis auf die Zahlung) wie bei Zahlungen in der App
      doc.payments = listed.flatMap((p) => {
        const id = newId('p')
        const pay = { id, date: p.date || h.date, amount: round2(p.amount), note: [p.note, `aus ${source} übernommen`].filter(Boolean).join(' · '), by: `Übernahme ${source}`, at: now }
        return p.skonto ? [pay, { id: newId('p'), kind: 'skonto', ref: id, date: pay.date, amount: round2(p.skonto), note: `Skonto (aus ${source} übernommen)`, by: pay.by, at: now }] : [pay]
      })
    }
    let paid = 0
    if (h.paid != null) paid = Math.abs(h.paid)
    else if (h.open != null) paid = round2(Math.abs(gross) - Math.abs(h.open))
    else if (h.paidFlag || /^(bezahlt|erledigt|ausgeglichen|paid|beglichen)/.test(h.status || '') || h.paidDate) paid = Math.abs(gross)
    if (h.kind === 'rechnung' && paid > 0.004 && !doc.payments) doc.payments = [{ id: newId('p'), date: h.paidDate || h.dueDate || h.date, amount: round2(Math.min(paid, Math.abs(gross))), note: `aus ${source} übernommen`, by: `Übernahme ${source}`, at: now }]
    if (h.kind === 'rechnung' && h.reminderLevel > 0) doc.reminders = Array.from({ length: h.reminderLevel }, (_, i) => ({ level: i, name: `${i + 1}. Mahnstufe (${source})`, date: i === h.reminderLevel - 1 ? h.lastReminder || h.date : h.lastReminder || h.date, imported: true }))
    if (h.kind === 'angebot' && /angenommen|beauftragt|auftrag|erledigt/.test(h.status || '')) doc.status = 'angenommen'
    if (h.kind === 'angebot' && /abgelehnt|verloren/.test(h.status || '')) doc.status = 'abgelehnt'
    doc.checksum = checksumOf(doc)
    return doc
  }

  for (const { e, inv, cust } of eDocs) {
    const key = norm(inv.number)
    if (docNumbers.has(`${inv.kind}|${key}`)) continue
    docNumbers.add(`${inv.kind}|${key}`)
    const head = docs.find((d) => norm(d.number) === key)
    const recipient = cust ? { name: cust.name, address: composeAddress(cust), uid: cust.uid || inv.buyer?.uid || '', email: cust.email || inv.buyer?.email || '', customerNo: cust.customerNo || '', consumer: !!cust.consumer } : { name: inv.buyer?.name || '', address: '', uid: '', email: '', customerNo: '' }
    const s = inv.seller || {}
    out.documents.push(
      make(
        {
          ...(head || {}),
          kind: inv.kind,
          number: inv.number,
          date: inv.date || head?.date,
          dueDate: inv.dueDate || head?.dueDate,
          serviceFrom: inv.serviceFrom,
          serviceTo: inv.serviceTo,
          customer: cust,
          recipient,
          sender: { name: s.name || '', address: composeAddress(s), uid: s.uid || '' },
          reference: inv.reference,
          refNumber: inv.refNumber,
          intro: head?.intro || inv.note || '',
          reverseCharge: inv.reverseCharge,
          net: inv.total.net,
          vatAmount: inv.total.vat,
          gross: inv.total.gross,
          groups: inv.total.groups,
          paid: head?.paid ?? (inv.paid || null),
          original: e.original,
          vatGuess: inv.total.groups[0]?.rate,
        },
        inv.lines,
        head ? SYSTEM : 'E-Rechnung',
      ),
    )
  }
  for (const h of docs) {
    const key = norm(h.number)
    if (docNumbers.has(`${h.kind}|${key}`)) continue
    docNumbers.add(`${h.kind}|${key}`)
    const lines = (linesByDoc.get(key) || []).filter((l) => !l.kind || kindOf({ text: l.kind, number: h.number }) === h.kind)
    const vatGuess = h.net && h.vatAmount != null ? Math.round((h.vatAmount / h.net) * 100) : undefined
    out.documents.push(make({ ...h, vatGuess }, lines, SYSTEM))
  }
  // Schlussrechnungen: Betrag wie in orgaMAX; ob die Abschläge darin schon abgezogen sind, zeigt nur der Beleg selbst
  for (const d of out.documents) if (d.stage === 'schluss') warnings.push(`${d.number}: Schlussrechnung mit dem Betrag aus orgaMAX übernommen – bitte prüfen, ob die Abschläge darin abgezogen sind (offener Betrag).`)
  // Storno/Gutschrift mit Bezug auf die Rechnung verbinden (Bezugsnummer)
  const allDocs = [...out.documents, ...(existing.documents || [])]
  for (const d of out.documents) {
    if (!['storno', 'korrektur'].includes(d.kind) || !d.refNumber) continue
    const ref = allDocs.find((x) => x.kind === 'rechnung' && norm(x.number) === norm(d.refNumber))
    if (ref) {
      d.refId = ref.id
      d.checksum = checksumOf(d)
    }
  }

  // Abo-Rechnungen
  for (const s of of('recurring')) {
    const groups = new Map()
    for (const row of s.table.rows) {
      const v = (f) => rowValue(row, s.map, f)
      const key = has(v('srcId')) ? `id:${str(v('srcId'))}` : `${str(v('customerNo')) || str(v('customerName'))}|${str(v('title'))}|${intervalOf(v('interval'))}`
      groups.set(key, [...(groups.get(key) || []), v])
    }
    for (const rows of groups.values()) {
      const v = rows[0]
      const cust = findCustomer({ no: v('customerNo'), name: v('customerName'), ref: v('customerRef') })
      if (!cust) {
        warnings.push(`Abo „${str(v('title')) || str(v('text'))}“: Kunde „${str(v('customerName')) || str(v('customerNo')) || str(v('customerRef'))}“ nicht gefunden – nicht übernommen.`)
        continue
      }
      const start = parseDateLoose(v('start'))
      const end = parseDateLoose(v('end'))
      const id = newId('rec')
      out.recurring.push({
        id,
        title: str(v('title')) || str(v('text')) || 'Abo-Rechnung',
        interval: intervalOf(v('interval')),
        startMonth: (start || (opts.now || now).slice(0, 10)).slice(0, 7),
        endMonth: end ? end.slice(0, 7) : '',
        customerId: cust.id,
        objectId: (cust.objectIds || [])[0] || '',
        active: rows.every((r) => !has(r('active')) || !/inaktiv|beendet|gekuendigt|nein|false|0/i.test(String(r('active')))),
        lines: (() => {
          // eigene Positionstabelle (z. B. MOV_INVOICES_SERIES_POSITIONS) über die interne ID
          const own = has(v('srcId')) ? rawLines.filter((x) => x.ref === str(v('srcId')) && headFor(x.table) === s.table.name) : []
          if (own.length) return own.sort((a, b) => (a.line.pos || 0) - (b.line.pos || 0)).map((x, i) => ({ id: `${id}-${i + 1}`, text: x.line.text, qty: x.line.qty, unit: x.line.unit || 'Monat', price: x.line.price, vat: x.line.vat ?? 20 }))
          return rows.map((r, i) => ({ id: `${id}-${i + 1}`, text: str(r('text')) || str(r('title')), qty: has(r('qty')) ? money(r('qty')) : 1, unit: unitOf(r('unit')) || 'Monat', price: money(r('price')), vat: vatOf(r('vat')) }))
        })(),
        index: { active: false, baseValue: '', baseMonth: '', threshold: 3, onlyUp: false },
        source: { system: SYSTEM },
      })
    }
  }
  return out
}

/**
 * Übernahme in die bestehende Fakturierung einspielen. Gleiche Kundennummer/Artikelnummer → ergänzt (vorhandene
 * Werte bleiben, leere werden gefüllt); gleiche Belegnummer und Belegart → übersprungen (Altbelege werden nie
 * überschrieben); Original-PDF wird an einen vorhandenen Beleg nur angehängt.
 * → { data, report: { customers: { added, updated }, …, documents: { added, skipped, attached } } }
 */
export function mergeImport(data, result) {
  const d = { ...data, customers: [...(data.customers || [])], articles: [...(data.articles || [])], documents: [...(data.documents || [])], textBlocks: [...(data.textBlocks || [])], paymentTerms: [...(data.paymentTerms || [])], recurring: [...(data.recurring || [])] }
  const report = {}
  const fill = (target, src) => {
    let changed = false
    for (const [k, v] of Object.entries(src)) {
      if (k === 'id' || v === '' || v == null) continue
      if (k === 'extra' || k === 'contacts') {
        const cur = target[k]
        if (k === 'extra') {
          const next = { ...v, ...(cur || {}) }
          if (JSON.stringify(next) !== JSON.stringify(cur || {})) {
            target[k] = next
            changed = true
          }
        } else {
          const names = new Set((cur || []).map((x) => norm(x.name)))
          const add = v.filter((x) => !names.has(norm(x.name)))
          if (add.length) {
            target[k] = [...(cur || []), ...add]
            changed = true
          }
        }
        continue
      }
      if (target[k] === undefined || target[k] === '' || (Array.isArray(target[k]) && !target[k].length && Array.isArray(v) && v.length)) {
        target[k] = v
        changed = true
      }
    }
    return changed
  }
  const conflicts = []
  const similar = (a, b) => {
    const x = norm(a)
    const y = norm(b)
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || x.slice(0, 6) === y.slice(0, 6))
  }
  const upsert = (list, items, keyOf, name, same = () => true) => {
    const r = { added: 0, updated: 0, same: 0 }
    const idMap = new Map()
    for (const item of items) {
      const key = keyOf(item)
      const candidates = key ? list.filter((x) => keyOf(x) === key) : []
      const hit = candidates.find((x) => same(x, item)) || null
      // gleiche Nummer, aber ganz anderer Name: nicht zusammenlegen, sondern melden
      if (!hit && candidates.length) conflicts.push(`${name === 'customers' ? 'Kundennummer' : 'Nummer'} ${key.replace(/^nr:/, '')}: „${candidates[0].name}“ (schon da) und „${item.name}“ (Übernahme) – beide behalten, bitte prüfen.`)
      if (hit) {
        const copy = { ...hit }
        if (fill(copy, item)) {
          list[list.indexOf(hit)] = copy
          r.updated++
        } else r.same++
        idMap.set(item.id, hit.id)
      } else {
        list.push(item)
        r.added++
      }
    }
    report[name] = r
    return idMap
  }
  const custIds = upsert(d.customers, result.customers, (c) => (c.customerNo ? `nr:${c.customerNo}` : `name:${norm(c.name)}|${norm(c.zip)}`), 'customers', (a, b) => similar(a.name, b.name))
  upsert(d.articles, result.articles, (a) => (a.articleNo ? `nr:${a.articleNo}` : `name:${norm(a.name)}`), 'articles', (a, b) => !a.articleNo || similar(a.name, b.name))
  const termIds = upsert(d.paymentTerms, result.paymentTerms, (t) => norm(t.name), 'paymentTerms')
  upsert(d.textBlocks, result.textBlocks, (t) => `${t.kind}|${t.place}|${norm(t.name)}|${norm(t.text).slice(0, 60)}`, 'textBlocks')
  // Verweise auf zusammengeführte Kunden/Zahlungsbedingungen umbiegen
  for (const c of d.customers) if (c.termsId && termIds.has(c.termsId)) c.termsId = termIds.get(c.termsId)
  const docReport = { added: 0, skipped: 0, attached: 0 }
  for (const doc of result.documents) {
    const key = `${doc.kind}|${norm(doc.number)}`
    const hit = d.documents.find((x) => x.number && `${x.kind}|${norm(x.number)}` === key)
    if (hit) {
      if (doc.original && !hit.original) {
        d.documents[d.documents.indexOf(hit)] = { ...hit, original: doc.original }
        docReport.attached++
      } else docReport.skipped++
      continue
    }
    const copy = { ...doc, customerId: custIds.get(doc.customerId) || doc.customerId }
    if (copy.customerId !== doc.customerId) copy.checksum = checksumOf(copy)
    d.documents.push(copy)
    docReport.added++
  }
  report.documents = docReport
  const recReport = { added: 0, skipped: 0 }
  for (const rec of result.recurring) {
    const customerId = custIds.get(rec.customerId) || rec.customerId
    if (d.recurring.some((x) => x.customerId === customerId && norm(x.title) === norm(rec.title))) {
      recReport.skipped++
      continue
    }
    d.recurring.push({ ...rec, customerId })
    recReport.added++
  }
  report.recurring = recReport
  report.conflicts = conflicts
  return { data: d, report }
}

/**
 * Nummernkreise nach der Übernahme: je Belegart das erkannte Format und die nächste Nummer (für settings).
 * → { [kind]: { template, yearly, digits, next, last } }
 */
export function numberingAfterImport(documents, today, { series = {} } = {}) {
  const year = today.slice(0, 4)
  const out = {}
  for (const kind of ['rechnung', 'angebot', 'auftrag', 'storno', 'korrektur', 'lieferschein', 'proforma']) {
    // Format aus den übernommenen Belegen; weiterzählen über alle Belege dieses Formats (auch eigene)
    const imported = documents.filter((d) => d.kind === kind && d.number && d.imported).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)))
    if (!imported.length) continue
    const recent = imported.slice(-50)
    const f = detectNumberFormat(recent.map((d) => d.number), recent.map((d) => String(d.date).slice(0, 4)))
    if (!f) continue
    // schon das Format der App (z. B. „RE-{JJJJ}-{NR}“ bei Kürzel RE)? Dann ist nichts umzustellen
    const own = `${series[kind] || ''}-{JJJJ}-{NR}`
    const re = numberPattern(f.template, { year: f.yearly ? year : null })
    const pool = documents.filter((d) => d.kind === kind && d.number && (!f.yearly || String(d.date).startsWith(year)))
    const seqs = pool.map((d) => Number(re.exec(String(d.number))?.[1] || 0)).filter((n) => n > 0)
    out[kind] = { ...f, next: (seqs.length ? Math.max(...seqs) : 0) + 1, last: imported.at(-1).number, same: f.template === own }
  }
  return out
}

/** Nächste freie Kundennummer nach der Übernahme (für neue Kunden in der App). */
export const nextCustomerNoAfter = (customers) => nextCustomerNo(customers)

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
