// Belege der Fakturierung als PDF (pdfmake): Angebot, Auftragsbestätigung, Rechnung, Stornorechnung,
// Rechnungskorrektur und Mahnung. Mit allen Rechnungsmerkmalen nach § 11 UStG, Hinweisen für
// Reverse Charge bzw. Kleinunternehmer und einem EPC-QR-Code zum Bezahlen mit der Banking-App.
// Entwürfe tragen das Wasserzeichen „ENTWURF“ und keinen QR-Code. Platzhalter wie {Anrede} sind bei
// festgeschriebenen Belegen schon aufgelöst, bei Entwürfen löst die Vorschau sie auf.

import { todayISO } from '../core/dates.js'
import { deDate, DEFAULT_GREETING, epcPayload, formatIban, KINDS, lateInterest, periodLabel, RC_TEXT, resolveTexts, round2, settingsOf, SMALL_AMOUNT, SMALL_BUSINESS_TEXT, totals } from '../core/invoicing.js'
import { inkColors, tableLayout } from './pdf-parts.js'

// Tausenderpunkt wie auf österreichischen Rechnungen üblich (de-AT setzt bei Zahlen ohne Währung ein Leerzeichen)
const eur = (n) => `${(Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const qty = (n) => (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 3 })
const pct = (n) => `${String(Number(n) || 0).replace('.', ',')} %`
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

function shell(content, { title, sender, bank, colors, draft }) {
  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 54],
    info: { title, author: sender.name, creator: 'Cleanos App' },
    ...(draft ? { watermark: { text: 'ENTWURF', color: '#999999', opacity: 0.12, bold: true } } : {}),
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
  const kind = KINDS[doc.kind] || 'Beleg'
  const isInv = ['rechnung', 'storno', 'korrektur'].includes(doc.kind)
  const service = doc.serviceFrom ? periodLabel({ from: doc.serviceFrom, to: doc.serviceTo || doc.serviceFrom }) : ''
  const facts = [
    [`${kind}-Nr.`, doc.number || 'Entwurf'],
    [doc.kind === 'rechnung' ? 'Rechnungsdatum' : 'Datum', deDate(doc.date)],
    [isInv ? 'Leistung' : doc.kind === 'auftrag' ? 'Ausführung' : 'Zeitraum', service],
    ['Kundennummer', doc.recipient?.customerNo || ''],
    ['Ihre Bestellung', doc.reference || ''],
    ['Ansprechpartner', doc.contactName || ''],
    ['Objekt', doc.objectName || ''],
    [doc.kind === 'rechnung' ? 'Fällig am' : '', doc.kind === 'rechnung' ? deDate(doc.dueDate) : ''],
    [doc.kind === 'angebot' ? 'Gültig bis' : '', doc.kind === 'angebot' ? deDate(doc.validUntil) : ''],
    [doc.refNumber ? 'Bezug' : '', doc.refNumber || ''],
  ]
  const showDiscount = t.lines.some((l) => Number(l.discount))
  const head = ['Pos.', 'Bezeichnung', 'Menge', 'Einheit', 'Einzelpreis', ...(showDiscount ? ['Rabatt'] : []), ...(t.vatOn ? ['USt'] : []), 'Gesamt netto'].map((text, i) => ({ text, style: 'th', alignment: i > 1 && text !== 'Einheit' ? 'right' : 'left' }))
  const body = t.lines.map((l, i) => [
    String(i + 1),
    l.longText || l.articleNo ? { stack: [{ text: l.text || '' }, l.longText ? { text: l.longText, style: 'small', margin: [0, 1, 0, 0] } : '', l.articleNo ? { text: `Art.-Nr. ${l.articleNo}`, style: 'small' } : ''].filter(Boolean) } : { text: l.text || '' },
    { text: qty(l.qty), alignment: 'right' },
    l.unit || '',
    { text: eur(l.price), alignment: 'right' },
    ...(showDiscount ? [{ text: Number(l.discount) ? pct(l.discount) : '', alignment: 'right' }] : []),
    ...(t.vatOn ? [{ text: pct(l.vat ?? s.vat), alignment: 'right' }] : []),
    { text: eur(l.net), alignment: 'right' },
  ])
  const widths = [22, '*', 40, 40, 58, ...(showDiscount ? [34] : []), ...(t.vatOn ? [30] : []), 64]
  const sumRows = [
    ...(t.discount ? [['Summe Positionen', eur(t.subtotal)], [`Rabatt ${pct(doc.discount)}`, `−${eur(t.discount)}`]] : []),
    ['Summe netto', eur(t.net)],
    ...(t.vatOn ? t.groups.map((g) => [`USt ${pct(g.rate)} von ${eur(g.net)}`, eur(g.vat)]) : []),
  ]
  const notes = []
  if (doc.reverseCharge) notes.push(RC_TEXT, `UID Leistungsempfänger: ${doc.recipient?.uid || '–'} · UID Leistender: ${sender.uid || '–'}`)
  if (doc.smallBusiness ?? s.smallBusiness) notes.push(SMALL_BUSINESS_TEXT)
  const payText = []
  let qr = null
  if (doc.kind === 'rechnung' && t.gross > 0) {
    // Zahlungsbedingung mit Skonto (Text beim Festschreiben eingefroren), sonst der übliche Satz
    if (doc.termsText) {
      payText.push(doc.termsText)
      if (s.bank.iban) payText.push(`Bankverbindung: ${s.bank.name ? `${s.bank.name}, ` : ''}IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number || 'Rechnungsnummer'}.`)
    } else if (s.bank.iban) payText.push(`Bitte überweisen Sie ${eur(t.gross)} bis ${deDate(doc.dueDate)} ohne Abzug auf ${s.bank.name ? `${s.bank.name}, ` : ''}IBAN ${formatIban(s.bank.iban)}${s.bank.bic ? `, BIC ${s.bank.bic}` : ''}. Verwendungszweck: ${doc.number || 'Rechnungsnummer'}.`)
    else payText.push(`Zahlbar bis ${deDate(doc.dueDate)} ohne Abzug.`)
    if (!draft) qr = epcPayload({ name: sender.name, iban: s.bank.iban, bic: s.bank.bic, amount: t.gross, text: `Rechnung ${doc.number}` })
  }
  if (['storno', 'korrektur'].includes(doc.kind) && t.gross < 0) payText.push(`Der Betrag von ${eur(-t.gross)} wird mit offenen Forderungen verrechnet bzw. auf Ihr Konto überwiesen.`)
  const title = `${kind} ${doc.number || '(Entwurf)'}`
  const content = [
    { columns: [logoBlock(logo, brand, sender, colors), senderBlock(sender, colors)] },
    addressAndFacts(doc, sender, facts, colors),
    String(doc.deliveryAddress || '').trim() ? { text: [{ text: doc.kind === 'rechnung' || doc.kind === 'auftrag' ? 'Leistungsort: ' : 'Lieferadresse: ', color: colors.grey }, lines(doc.deliveryAddress).join(', ')], fontSize: 8.5, margin: [0, 8, 0, 0] } : '',
    { text: title, style: 'title' },
    doc.title ? { text: doc.title, bold: true, margin: [0, 0, 0, 6] } : '',
    doc.intro ? { text: doc.intro, margin: [0, 0, 0, 8] } : '',
    { table: { headerRows: 1, widths, body: [head, ...body] }, layout: tableLayout(colors), fontSize: 8.5 },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 250,
          margin: [0, 8, 0, 0],
          table: { widths: ['*', 80], body: [...sumRows.map(([k, v]) => [{ text: k }, { text: v, alignment: 'right' }]), [{ text: doc.kind === 'angebot' ? 'Angebotssumme' : 'Gesamtbetrag', bold: true, fontSize: 10.5 }, { text: eur(t.gross), bold: true, fontSize: 10.5, alignment: 'right' }]] },
          layout: { hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 1 : 0), vLineWidth: () => 0, hLineColor: () => colors.ink, paddingTop: () => 2, paddingBottom: () => 2 },
        },
      ],
    },
    ...notes.map((text, i) => ({ text, bold: i === 0, margin: [0, i ? 2 : 12, 0, 0] })),
    isInv && Math.abs(t.gross) <= SMALL_AMOUNT && !doc.recipient?.name ? { text: 'Kleinbetragsrechnung gemäß § 11 Abs. 6 UStG.', style: 'small', margin: [0, 6, 0, 0] } : '',
    qr
      ? { columns: [{ width: '*', stack: payText.map((text) => ({ text })), margin: [0, 14, 10, 0] }, { width: 92, stack: [{ qr, fit: 88, eccLevel: 'M' }, { text: 'Mit der Banking-App scannen', style: 'small', alignment: 'center', margin: [0, 2, 0, 0] }], margin: [0, 10, 0, 0] }] }
      : payText.length
        ? { stack: payText.map((text) => ({ text })), margin: [0, 14, 0, 0] }
        : '',
    doc.outro ? { text: doc.outro, margin: [0, 12, 0, 0] } : '',
  ].filter(Boolean)
  return shell(content, { title, sender, bank: s.bank, colors, draft })
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
