// SEPA-Lastschrift-Mandat als PDF zum Unterschreiben (pdfmake): Gläubiger mit Gläubiger-ID, Mandatsreferenz,
// Ermächtigung im Wortlaut des SEPA-Rulebooks (Basis- bzw. Firmen-Lastschrift), Zahler mit Konto, Ort, Datum,
// Unterschrift. Dazu die vereinbarte Frist der Vorabankündigung. Daten: core/sepa.js.

import { deDate, formatIban, settingsOf } from '../core/invoicing.js'
import { PRE_NOTICE_DAYS, sepaSettings } from '../core/sepa.js'
import { inkColors } from './pdf-parts.js'

const lines = (s) => String(s || '').split(/\r?\n/).filter(Boolean)

/** Text der Ermächtigung (Rulebook-Wortlaut, „ich/wir“). */
export function mandateWording(scheme, creditor) {
  const base = `Ich/Wir ermächtige(n) ${creditor}, Zahlungen von meinem/unserem Konto mittels SEPA-Lastschrift einzuziehen. Zugleich weise(n) ich/wir mein/unser Kreditinstitut an, die von ${creditor} auf mein/unser Konto gezogenen SEPA-Lastschriften einzulösen.`
  return scheme === 'B2B'
    ? `${base}\n\nHinweis: Dieses Lastschriftmandat dient nur dem Einzug von Lastschriften, die auf Konten von Unternehmen gezogen sind. Ich bin/Wir sind nicht berechtigt, nach der erfolgten Einlösung eine Erstattung des belasteten Betrages zu verlangen. Ich bin/Wir sind berechtigt, mein/unser Kreditinstitut bis zum Fälligkeitstag anzuweisen, Lastschriften nicht einzulösen.`
    : `${base}\n\nHinweis: Ich kann/Wir können innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem/unserem Kreditinstitut vereinbarten Bedingungen.`
}

/**
 * Mandat als pdfmake-Dokument. customer: Kunde (Name, Anschrift, IBAN, BIC), mandate: { reference, scheme,
 * preNoticeDays }, settings: Einstellungen der Fakturierung (Absender, Gläubiger-ID).
 */
export function mandateDocument({ customer = {}, mandate = {}, settings = {}, brand = {}, logo = null }) {
  const s = settingsOf({ settings })
  const ss = sepaSettings(s)
  const colors = inkColors(brand)
  const b2b = mandate.scheme === 'B2B'
  const title = b2b ? 'SEPA-Firmenlastschrift-Mandat' : 'SEPA-Lastschrift-Mandat'
  const creditor = s.sender.name || 'der Zahlungsempfänger'
  const days = mandate.preNoticeDays !== '' && mandate.preNoticeDays != null ? Number(mandate.preNoticeDays) : Number(ss.preNoticeDays ?? PRE_NOTICE_DAYS)
  const name = customer.name || [customer.title, customer.firstName, customer.lastName].filter(Boolean).join(' ')
  const address = customer.address || [customer.street, [customer.zip, customer.city].filter(Boolean).join(' ')].filter(Boolean).join('\n')
  const field = (label, value, height = 18) => [{ text: label, color: colors.grey, fontSize: 8 }, { text: value || ' ', margin: [0, 2, 0, 0], minHeight: height }]
  const box = (rows) => ({ table: { widths: [150, '*'], body: rows }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => colors.line || '#bbbbbb', paddingTop: () => 5, paddingBottom: () => 5 } })
  const content = [
    {
      columns: [
        logo ? (logo.svg ? { svg: logo.svg, width: 120 } : { image: logo.image, fit: [130, 52] }) : { text: creditor, bold: true, fontSize: 13, color: colors.ink },
        { stack: [{ text: creditor, bold: true }, ...lines(s.sender.address).map((text) => ({ text }))], alignment: 'right', fontSize: 8, color: colors.grey },
      ],
    },
    { text: title, fontSize: 15, bold: true, color: colors.ink, margin: [0, 22, 0, 2] },
    { text: 'für wiederkehrende Zahlungen', color: colors.grey, margin: [0, 0, 0, 12] },
    box([
      field('Zahlungsempfänger', [creditor, ...lines(s.sender.address)].join('\n')),
      field('Gläubiger-ID', String(ss.creditorId || '').toUpperCase()),
      field('Mandatsreferenz', mandate.reference || '(wird vom Zahlungsempfänger eingetragen)'),
    ]),
    { text: mandateWording(mandate.scheme, creditor), margin: [0, 14, 0, 0], lineHeight: 1.25 },
    {
      text: `Vorabankündigung: Der Zahlungsempfänger teilt Betrag und Fälligkeit jeder Lastschrift spätestens ${days} ${days === 1 ? 'Tag' : 'Tage'} vor dem Einzug mit (auf der Rechnung oder per E-Mail).${days < PRE_NOTICE_DAYS ? ' Die kürzere Frist ist hiermit vereinbart.' : ''}`,
      margin: [0, 10, 0, 14],
    },
    box([
      field('Zahlungspflichtiger (Kontoinhaber)', name, 22),
      field('Anschrift', address, 30),
      field('IBAN', customer.iban ? formatIban(customer.iban) : '', 22),
      field('BIC', customer.bic || '', 18),
      field('Ort, Datum', mandate.signedAt ? `, ${deDate(mandate.signedAt)}` : '', 28),
      field('Unterschrift(en)', '', 46),
    ]),
    { text: 'Bitte unterschrieben zurückschicken (Post, Scan oder Foto). Das Mandat gilt bis auf Widerruf; es verfällt, wenn 36 Monate lang keine Lastschrift eingezogen wird.', fontSize: 8, color: colors.grey, margin: [0, 12, 0, 0] },
  ]
  return {
    pageSize: 'A4',
    pageMargins: [48, 40, 48, 48],
    info: { title: `${title} ${name}`.trim(), author: creditor, creator: 'Cleanos App' },
    content,
    defaultStyle: { fontSize: 9.5, lineHeight: 1.15 },
  }
}

export const mandateFileName = (customer = {}, mandate = {}) => `SEPA-Mandat_${String(mandate.reference || customer.customerNo || 'neu').replace(/[^A-Za-z0-9-]+/g, '-')}_${String(customer.name || customer.lastName || 'Kunde').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')}.pdf`
