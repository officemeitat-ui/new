// Belege der Fakturierung als PDF (pdfmake): Angebot, Auftragsbestätigung, Rechnung, Stornorechnung,
// Rechnungskorrektur und Mahnung. Mit allen Rechnungsmerkmalen nach § 11 UStG, Hinweisen für
// Reverse Charge bzw. Kleinunternehmer und einem EPC-QR-Code zum Bezahlen mit der Banking-App.
// Entwürfe tragen das Wasserzeichen „ENTWURF“ und keinen QR-Code. Platzhalter wie {Anrede} sind bei
// festgeschriebenen Belegen schon aufgelöst, bei Entwürfen löst die Vorschau sie auf.

import { todayISO } from '../core/dates.js'
import { deDate, DEFAULT_GREETING, epcPayload, formatIban, isAdvance, KINDS, kindLabel, lateInterest, periodLabel, PROFORMA_TEXT, RC_TEXT, resolveTexts, round2, settingsOf, SMALL_AMOUNT, SMALL_BUSINESS_TEXT, totals } from '../core/invoicing.js'
import { debitNoteFor } from '../core/sepa.js'
import { inkColors, tableLayout } from './pdf-parts.js'

// Tausenderpunkt wie auf österreichischen Rechnungen üblich (de-AT setzt bei Zahlen ohne Währung ein Leerzeichen)
const eur = (n) => `${(Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const qty = (n) => (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 3 })
const pct = (n) => `${String(Number(n) || 0).replace('.', ',')} %`
/** Abzug: positiver Betrag mit Minus, ein negativer (Storno einer Schlussrechnung) ohne. */
const minus = (n) => (Number(n) < 0 ? eur(-n) : `−${eur(n)}`)
const lines = (s) => String(s || '').split(/\r?\n/).filter(Boolean)

function logoBlock(logo, brand, sender, colors) {
  if (logo) return logo.svg ? { svg: logo.svg, width: 130 } : { image: logo.image, fit: [140, 56] }
  return { text: sender.name || brand.name || '', style: 'brand', color: colors.ink }
}

function senderBlock(sender, colors) {
  return {
    stack: [
      { text: sender.name, bold: true },
      ...lines(sender.address).map((text) => ({ text })),
      sender.phone ? { text: `Tel. ${sender.phone}` } : '',
      sender.email ? { text: sender.email } : '',
      sender.web ? { text: sender.web } : '',
      sender.uid ? { text: `UID ${sender.uid}` } : '',
    ].filter(Boolean),
    alignment: 'right',
    fontSize: 8,
    color: colors.grey,
  }
}

function footer(sender, bank, colors) {
  const parts = [sender.name, lines(sender.address).join(', '), sender.uid ? `UID ${sender.uid}` : '', sender.register].filter(Boolean).join(' · ')
  const pay = bank.iban ? [bank.name, `IBAN ${formatIban(bank.iban)}`, bank.bic ? `BIC ${bank.bic}` : ''].filter(Boolean).join(' · ') : ''
  return (page, pages) => ({
    margin: [40, 10, 40, 0],
    columns: [{ stack: [{ text: parts }, pay ? { text: pay } : ''], fontSize: 7, color: colors.grey }, { text: `Seite ${page} von ${pages}`, alignment: 'right', fontSize: 7, color: colors.grey, width: 70 }],
  })
}

function shell(content, { title, sender, bank, colors, draft, mark = '' }) {
  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 54],
    info: { title, author: sender.name, creator: 'Cleanos App' },
    ...(draft || mark ? { watermark: { text: draft ? 'ENTWURF' : mark, color: '#999999', opacity: 0.12, bold: true } } : {}),
    content,
    footer: footer(sender, bank, colors),
    defaultStyle: { fontSize: 9, lineHeight: 1.15 },
    styles: {
      brand: { fontSize: 15, bold: true },
      title: { fontSize: 15, bold: true, color: colors.ink, margin: [0, 18, 0, 6] },
      th: { bold: true, fontSize: 8, color: colors.ink, fillColor: colors.soft },
      small: { fontSize: 7.5, color: colors.grey },
    },
  }
}

/** Anschriftfeld mit Absenderzeile (Fensterkuvert) und Angaben rechts. */
function addressAndFacts(doc, sender, facts, colors) {
  const rec = doc.recipient || {}
  return {
    columns: [
      {
        width: 260,
        stack: [
          { text: [sender.name, lines(sender.address).join(', ')].filter(Boolean).join(' · '), fontSize: 6.5, color: colors.grey, margin: [0, 26, 0, 4] },
          { text: rec.name || '', bold: true },
          ...lines(rec.address).map((text) => ({ text })),
          rec.uid ? { text: `UID ${rec.uid}`, margin: [0, 2, 0, 0] } : '',
        ].filter(Boolean),
      },
      { width: '*', text: '' },
      {
        width: 200,
        margin: [0, 26, 0, 0],
        table: { widths: [86, '*'], body: facts.filter(([, v]) => v).map(([k, v]) => [{ text: k, color: colors.grey }, { text: v, alignment: 'right' }]) },
        layout: 'noBorders',
        fontSize: 8.5,
      },
    ],
  }
}

/**
 * Beleg als pdfmake-Dokument. settings: Einstellungen der Fakturierung, doc: Beleg. Bei Entwürfen: customer
 * (für {Anrede}), terms (Zahlungsbedingung) und user (für {Benutzer}) zum Auflösen der Platzhalter.
 */
export function invoiceDocument({ doc: input, settings = {}, brand = {}, logo = null, customer = null, terms = null, user = '', today = todayISO() }) {
  const s = settingsOf({ settings })
  const colors = inkColors(brand)
  const draft = !input.number
  const doc = draft ? { ...input, ...resolveTexts(input, { settings: s, customer, terms, user, today }) } : input
  const sender = draft ? s.sender : { ...s.sender, ...(doc.sender || {}) }
  const t = totals(doc, s)
  // Schlussrechnung: oben die ganze Leistung, darunter der Abzug der Abschläge und der Restbetrag (t)
  const whole = t.full || t
  const kind = kindLabel(doc)
  const isInv = ['rechnung', 'storno', 'korrektur'].includes(doc.kind)
  const delivery = doc.kind === 'lieferschein'
  const prices = !(delivery && doc.hidePrices)
  // Proforma: keine Steuer gesondert ausweisen (sonst Steuerschuld kraft Rechnungslegung möglich, § 11 Abs. 14 UStG)
  const proforma = doc.kind === 'proforma'
  const vatCol = t.vatOn && !proforma
  const service = doc.serviceFrom ? periodLabel({ from: doc.serviceFrom, to: doc.serviceTo || doc.serviceFrom }) : ''
  const facts = [
    [`${KINDS[doc.kind] || kind}-Nr.`, doc.number || 'Entwurf'],
    [doc.kind === 'rechnung' ? 'Rechnungsdatum' : 'Datum', deDate(doc.date)],
    [isAdvance(doc) ? 'Leistung geplant' : isInv ? 'Leistung' : doc.kind === 'auftrag' ? 'Ausführung' : delivery ? 'Geliefert/erbracht' : 'Zeitraum', service],
    ['Kundennummer', doc.recipient?.customerNo || ''],
    ['Ihre Bestellung', doc.reference || ''],
    ['Ansprechpartner', doc.contactName || ''],
    ['Objekt', doc.objectName || ''],
    [doc.kind === 'rechnung' ? 'Fällig am' : '', doc.kind === 'rechnung' ? deDate(doc.dueDate) : ''],
    [doc.kind === 'angebot' ? 'Gültig bis' : '', doc.kind === 'angebot' ? deDate(doc.validUntil) : ''],
    [doc.refNumber ? 'Bezug' : '', doc.refNumber || ''],
    [doc.deliveryNotes?.length ? (doc.deliveryNotes.length > 1 ? 'Lieferscheine' : 'Lieferschein') : '', (doc.deliveryNotes || []).map((n) => n.number).join(', ')],
  ]
  const showDiscount = prices && t.rows.some((l) => l.pos && Number(l.discount))
  const cols = prices ? ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', ...(showDiscount ? ['Rabatt'] : []), ...(vatCol ? ['USt'] : []), 'Gesamt netto'] : ['Pos.', 'Bezeichnung', 'Menge', 'Einheit']
  const head = cols.map((text, i) => ({ text, style: 'th', alignment: i > 1 && text !== 'Einheit' ? 'right' : 'left' }))
  const span = (cell, n) => [{ ...cell, colSpan: n }, ...Array(n - 1).fill('')]
  const choice = { optional: 'Option', alternative: 'Alternative' }
  // Zeilen nach Art: Position mit Beträgen, Option und Alternative gekennzeichnet (nicht in der Summe), Text ohne Beträge,
  // Titel fett, Zwischen- und Gruppensumme rechts
  const body = t.rows.map((l) => {
    if (l.type === 'text') return ['', ...span({ text: l.text || '' }, cols.length - 1)]
    if (l.type === 'title') return ['', ...span({ text: l.text || '', bold: true, margin: [0, 3, 0, 0] }, cols.length - 1)]
    if (l.type === 'subtotal' || l.type === 'groupsum') {
      const label = l.type === 'subtotal' ? String(l.text || '').trim() || 'Zwischensumme' : l.text
      return prices ? ['', ...span({ text: `${label} (netto)`, bold: true, alignment: 'right' }, cols.length - 2), { text: eur(l.net), bold: true, alignment: 'right' }] : ['', ...span({ text: label, bold: true }, cols.length - 1)]
    }
    const tag = choice[l.type]
    const note = tag ? `${l.type === 'alternative' ? (l.altPos ? `statt Pos. ${l.altPos}` : 'auf Wunsch statt einer anderen Position') : 'nur auf Wunsch'} – nicht in der Summe enthalten` : ''
    const text = tag ? { text: [{ text: `${tag}: `, bold: true }, l.text || ''] } : { text: l.text || '' }
    const desc = l.longText || l.articleNo || note ? { stack: [text, l.longText ? { text: l.longText, style: 'small', margin: [0, 1, 0, 0] } : '', l.articleNo ? { text: `Art.-Nr. ${l.articleNo}`, style: 'small' } : '', note ? { text: note, style: 'small', italics: true } : ''].filter(Boolean) } : text
    return [
      String(l.pos),
      desc,
      { text: qty(l.qty), alignment: 'right' },
      l.unit || '',
      ...(prices
        ? [
            { text: eur(l.price), alignment: 'right' },
            ...(showDiscount ? [{ text: Number(l.discount) ? pct(l.discount) : '', alignment: 'right' }] : []),
            ...(vatCol ? [{ text: pct(l.vat ?? s.vat), alignment: 'right' }] : []),
            { text: tag ? `(${eur(l.net)})` : eur(l.net), alignment: 'right', italics: !!tag },
          ]
        : []),
    ]
  })
  const widths = prices ? [22, '*', 40, 40, 58, ...(showDiscount ? [34] : []), ...(vatCol ? [30] : []), 64] : [22, '*', 50, 60]
  const sumRows = [
    ...(whole.discount ? [['Summe Positionen', eur(whole.subtotal)], [`Rabatt ${pct(doc.discount)}`, `−${eur(whole.discount)}`]] : []),
    ['Summe netto', eur(whole.net)],
    ...(t.vatOn && !delivery && !proforma ? whole.groups.map((g) => [`USt ${pct(g.rate)} von ${eur(g.net)}`, eur(g.vat)]) : []),
  ]
  // Schlussrechnung: jede Abschlagsrechnung mit Entgelt und Steuer je Steuersatz absetzen (§ 11 Abs. 1 Z 4 UStG)
  const advanceRows = t.full
    ? [
        [{ text: 'Gesamtbetrag der Leistung', bold: true }, { text: eur(whole.gross), bold: true }],
        ...(doc.advances || []).flatMap((a) => [
          [{ text: `abzüglich Abschlagsrechnung ${a.number} vom ${deDate(a.date)}`, margin: [0, 4, 0, 0], colSpan: 2 }, { text: '' }],
          ...(a.groups || []).flatMap((g) => [[{ text: `Entgelt${t.vatOn ? ` ${pct(g.rate)}` : ''}`, margin: [8, 0, 0, 0] }, { text: minus(g.net) }], ...(t.vatOn ? [[{ text: `USt ${pct(g.rate)}`, margin: [8, 0, 0, 0] }, { text: minus(g.vat) }]] : [])]),
        ]),
      ]
    : []
  const notes = []
  if (doc.kind === 'proforma') notes.push(PROFORMA_TEXT)
  if (isAdvance(doc)) notes.push(`Abschlagsrechnung (Anzahlung)${doc.refNumber ? ` zu ${doc.refNumber}` : ''}: Der Betrag wird in der Schlussrechnung samt Umsatzsteuer abgezogen.`)
  if (doc.reverseCharge) notes.push(RC_TEXT, `UID Leistungsempfänger: ${doc.recipient?.uid || '–'} · UID Leistender: ${sender.uid || '–'}`)
  if (doc.smallBusiness ?? s.smallBusiness) notes.push(SMALL_BUSINESS_TEXT)
  if (t.full && t.vatOn) notes.push(`Restbetrag je Steuersatz: ${t.groups.map((g) => `${pct(g.rate)}: Entgelt ${eur(g.net)}, USt ${eur(g.vat)}`).join(' · ')}.`)
  const payText = []
  let qr = null
  if (doc.kind === 'proforma' && s.bank.iban) payText.push(`Bankverbindung für eine Vorauszahlung: ${s.bank.name ? `${s.bank.name}, ` : ''}IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number || 'Proformanummer'}.`)
  // SEPA-Lastschrift: Hinweis mit Termin und Mandat statt Überweisung (Vorabankündigung, beim Festschreiben eingefroren)
  const debitText = doc.kind === 'rechnung' ? doc.debitText || (draft ? debitNoteFor(doc, customer, s) : '') : ''
  if (doc.kind === 'rechnung' && t.gross > 0 && debitText) payText.push(debitText)
  else if (doc.kind === 'rechnung' && t.gross > 0) {
    // Zahlungsbedingung mit Skonto (Text beim Festschreiben eingefroren), sonst der übliche Satz
    if (doc.termsText) {
      payText.push(doc.termsText)
      if (s.bank.iban) payText.push(`Bankverbindung: ${s.bank.name ? `${s.bank.name}, ` : ''}IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number || 'Rechnungsnummer'}.`)
    } else if (s.bank.iban) payText.push(`Bitte überweisen Sie ${eur(t.gross)} bis ${deDate(doc.dueDate)} ohne Abzug auf ${s.bank.name ? `${s.bank.name}, ` : ''}IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number || 'Rechnungsnummer'}.`)
    else payText.push(`Zahlbar bis ${deDate(doc.dueDate)} ohne Abzug.`)
    if (!draft) qr = epcPayload({ name: sender.name, iban: s.bank.iban, bic: s.bank.bic, amount: t.gross, text: `Rechnung ${doc.number}` })
  }
  if (['storno', 'korrektur'].includes(doc.kind) && t.gross < 0) payText.push(`Der Betrag von ${eur(-t.gross)} wird mit offenen Forderungen verrechnet bzw. auf Ihr Konto überwiesen.`)
  if (t.full && t.gross < 0) payText.push(`Die Abschläge übersteigen die Leistung: ${eur(-t.gross)} werden gutgeschrieben bzw. auf Ihr Konto überwiesen.`)
  const title = `${kind} ${doc.number || '(Entwurf)'}`
  const lastLabel = doc.kind === 'angebot' ? 'Angebotssumme' : t.full ? 'Restbetrag' : proforma && t.vatOn ? 'Gesamtbetrag inkl. USt' : 'Gesamtbetrag'
  const sumTable = {
    columns: [
      { width: '*', text: '' },
      {
        width: t.full ? 300 : 250,
        margin: [0, 8, 0, 0],
        table: {
          widths: ['*', 80],
          body: [
            ...sumRows.map(([k, v]) => [{ text: k }, { text: v, alignment: 'right' }]),
            ...advanceRows.map(([k, v]) => [k, { ...v, alignment: 'right' }]),
            ...(delivery ? [] : [[{ text: lastLabel, bold: true, fontSize: 10.5 }, { text: eur(t.gross), bold: true, fontSize: 10.5, alignment: 'right' }]]),
          ],
        },
        layout: { hLineWidth: (i, node) => (!delivery && i === node.table.body.length - 1 ? 1 : 0), vLineWidth: () => 0, hLineColor: () => colors.ink, paddingTop: () => 2, paddingBottom: () => 2 },
      },
    ],
  }
  // Lieferschein: Unterschrift des Kunden (Leistung bzw. Ware erhalten)
  const signature = delivery
    ? {
        margin: [0, 28, 0, 0],
        unbreakable: true,
        stack: [
          { text: 'Leistung bzw. Ware vollständig und in Ordnung erhalten:', margin: [0, 0, 0, 26] },
          { columns: [{ width: 150, stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 140, y2: 0, lineWidth: 0.6, lineColor: colors.ink }] }, { text: 'Datum', style: 'small', margin: [0, 2, 0, 0] }] }, { width: '*', stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 300, y2: 0, lineWidth: 0.6, lineColor: colors.ink }] }, { text: 'Unterschrift und Name in Blockschrift', style: 'small', margin: [0, 2, 0, 0] }] }] },
        ],
      }
    : ''
  const content = [
    { columns: [logoBlock(logo, brand, sender, colors), senderBlock(sender, colors)] },
    addressAndFacts(doc, sender, facts, colors),
    String(doc.deliveryAddress || '').trim() ? { text: [{ text: doc.kind === 'rechnung' || doc.kind === 'auftrag' ? 'Leistungsort: ' : 'Lieferadresse: ', color: colors.grey }, lines(doc.deliveryAddress).join(', ')], fontSize: 8.5, margin: [0, 8, 0, 0] } : '',
    { text: title, style: 'title' },
    doc.kind === 'proforma' ? { text: 'Proforma – keine Rechnung im Sinne des UStG', bold: true, fontSize: 11, margin: [0, 0, 0, 6] } : '',
    doc.title ? { text: doc.title, bold: true, margin: [0, 0, 0, 6] } : '',
    doc.intro ? { text: doc.intro, margin: [0, 0, 0, 8] } : '',
    { table: { headerRows: 1, widths, body: [head, ...body] }, layout: tableLayout(colors), fontSize: 8.5 },
    prices ? sumTable : '',
    ...notes.map((text, i) => ({ text, bold: i === 0, margin: [0, i ? 2 : 12, 0, 0] })),
    isInv && Math.abs(whole.gross) <= SMALL_AMOUNT && !doc.recipient?.name ? { text: 'Kleinbetragsrechnung gemäß § 11 Abs. 6 UStG.', style: 'small', margin: [0, 6, 0, 0] } : '',
    qr
      ? { columns: [{ width: '*', stack: payText.map((text) => ({ text })), margin: [0, 14, 10, 0] }, { width: 92, stack: [{ qr, fit: 88, eccLevel: 'M' }, { text: 'Mit der Banking-App scannen', style: 'small', alignment: 'center', margin: [0, 2, 0, 0] }], margin: [0, 10, 0, 0] }] }
      : payText.length
        ? { stack: payText.map((text) => ({ text })), margin: [0, 14, 0, 0] }
        : '',
    doc.outro ? { text: doc.outro, margin: [0, 12, 0, 0] } : '',
    signature,
  ].filter(Boolean)
  return shell(content, { title, sender, bank: s.bank, colors, draft, mark: doc.kind === 'proforma' ? 'Proforma' : '' })
}

/**
 * Mahnung bzw. Zahlungserinnerung zu einer Rechnung. reminder: core/invoicing.js → reminderFor().
 * text: eigener Text des Schreibens (Platzhalter schon aufgelöst), greeting: Anrede ohne Beistrich.
 */
export function reminderDocument({ doc, reminder, settings = {}, brand = {}, logo = null, today = todayISO(), text: ownText = '', greeting = DEFAULT_GREETING }) {
  const s = settingsOf({ settings })
  const colors = inkColors(brand)
  const sender = { ...s.sender, ...(doc.sender || {}) }
  const facts = [
    ['Datum', deDate(today)],
    ['Rechnung', doc.number],
    ['vom', deDate(doc.date)],
    ['fällig seit', deDate(doc.dueDate)],
    ['Kundennummer', doc.recipient?.customerNo || ''],
  ]
  const rows = [
    ['Rechnungsbetrag', eur(doc.total?.gross)],
    ...(round2((doc.total?.gross || 0) - reminder.open) ? [['bereits bezahlt bzw. gutgeschrieben', `−${eur(round2((doc.total?.gross || 0) - reminder.open))}`]] : []),
    ['offen', eur(reminder.open)],
    ...(reminder.interest.amount ? [[`Verzugszinsen ${pct(reminder.interest.rate)} p. a. für ${reminder.interest.days} Tage`, eur(reminder.interest.amount)]] : []),
    ...(reminder.fee ? [['Pauschale für Betreibungskosten (§ 458 UGB)', eur(reminder.fee)]] : []),
  ]
  const legal = reminder.interest.amount ? (doc.recipient?.consumer ? 'Verzugszinsen 4 % p. a. (§ 1000 ABGB).' : `Verzugszinsen ${pct(reminder.interest.rate)} p. a.: Basiszinssatz ${pct(s.baseRate)} zuzüglich 9,2 Prozentpunkte (§ 456 UGB).`) : ''
  const qr = epcPayload({ name: sender.name, iban: s.bank.iban, bic: s.bank.bic, amount: reminder.total, text: `${reminder.name} ${doc.number}` })
  const text = String(ownText || '').trim()
    ? String(ownText).trim()
    : reminder.level === 0
      ? `zu unserer Rechnung ${doc.number} vom ${deDate(doc.date)} konnten wir bis heute keinen Zahlungseingang feststellen. Sicher ist sie Ihnen nur entgangen. Wir bitten Sie, den offenen Betrag bis ${deDate(reminder.deadline)} zu überweisen.`
      : `trotz unserer Erinnerung ist unsere Rechnung ${doc.number} vom ${deDate(doc.date)} noch offen. Wir ersuchen Sie, den Gesamtbetrag von ${eur(reminder.total)} bis ${deDate(reminder.deadline)} zu überweisen.`
  const content = [
    { columns: [logoBlock(logo, brand, sender, colors), senderBlock(sender, colors)] },
    addressAndFacts(doc, sender, facts, colors),
    { text: reminder.name, style: 'title' },
    { text: `${greeting || DEFAULT_GREETING},`, margin: [0, 0, 0, 6] },
    { text, margin: [0, 0, 0, 10] },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 300,
          table: { widths: ['*', 80], body: [...rows.map(([k, v]) => [k, { text: v, alignment: 'right' }]), [{ text: 'zu bezahlen', bold: true, fontSize: 10.5 }, { text: eur(reminder.total), bold: true, fontSize: 10.5, alignment: 'right' }]] },
          layout: { hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 1 : 0), vLineWidth: () => 0, hLineColor: () => colors.ink, paddingTop: () => 2, paddingBottom: () => 2 },
        },
      ],
    },
    legal ? { text: legal, style: 'small', margin: [0, 6, 0, 0] } : '',
    qr
      ? { columns: [{ width: '*', text: `IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number}.`, margin: [0, 14, 10, 0] }, { width: 92, stack: [{ qr, fit: 88, eccLevel: 'M' }, { text: 'Mit der Banking-App scannen', style: 'small', alignment: 'center' }], margin: [0, 10, 0, 0] }] }
      : '',
    { text: 'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.', margin: [0, 14, 0, 0] },
    { text: 'Mit freundlichen Grüßen', margin: [0, 10, 0, 0] },
    { text: sender.name },
  ].filter(Boolean)
  return shell(content, { title: `${reminder.name} ${doc.number}`, sender, bank: s.bank, colors, draft: false })
}

export { lateInterest }
