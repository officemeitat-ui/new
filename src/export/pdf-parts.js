// Bausteine für PDF-Berichte (pdfmake): Kopf mit Logo, Tabellenrahmen,
// Seitenrahmen mit Fußzeile. Genutzt von den Auszahlungen.

import { inkColors } from './pdf.js'

export { inkColors }
export const GREY = '#595959'
export const TOTAL = '#FFF2CC'

export function header({ title, subtitle, brand, logo, colors }) {
  return [
    {
      columns: [
        logo ? { stack: [logo.svg ? { svg: logo.svg, width: 120 } : { image: logo.image, fit: [130, 52] }, { text: brand.product || 'Dienstplan', color: GREY, margin: [0, 2, 0, 0] }] } : { stack: [{ text: brand.name || '', style: 'brand' }, { text: brand.product || 'Dienstplan', color: GREY }] },
        { stack: [{ text: title, style: 'title', alignment: 'right' }, { text: subtitle, alignment: 'right', color: GREY }] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 1.5, lineColor: colors.ink }], margin: [0, 0, 0, 8] },
  ]
}

export const tableLayout = (colors) => ({ hLineColor: () => colors.line, vLineColor: () => colors.line, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 })

/** labels: Fußzeile in anderer Sprache ({ created: 'created on', page: (p, n) => `Page ${p} of ${n}`, locale: 'en-GB' }). */
export function docShell(content, { brand, colors, createdAt, title, labels = {} }) {
  const created = createdAt.toLocaleDateString(labels.locale || 'de-AT')
  const pageText = labels.page || ((p, n) => `Seite ${p} von ${n}`)
  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 40],
    info: { title, author: brand.name, creator: brand.product || 'Dienstplan' },
    content,
    footer: (page, pages) => ({ columns: [{ text: `${brand.name || ''}${brand.name ? ' · ' : ''}${labels.created || 'erstellt am'} ${created}`, fontSize: 7.5, color: GREY }, { text: pageText(page, pages), alignment: 'right', fontSize: 7.5, color: GREY }], margin: [36, 14, 36, 0] }),
    defaultStyle: { fontSize: 8.5, lineHeight: 1.1 },
    styles: {
      brand: { fontSize: 14, bold: true, color: colors.ink },
      title: { fontSize: 14, bold: true, color: colors.ink },
      name: { fontSize: 13, bold: true },
      th: { bold: true, fontSize: 8, color: colors.ink, fillColor: colors.soft },
      section: { fontSize: 10, bold: true, margin: [0, 10, 0, 4], color: colors.ink },
    },
  }
}

// ---------------------------------------------------------------- Öffnungscode

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // ohne 0/O, 1/I/L

function randomCode(length) {
  const limit = 256 - (256 % CODE_ALPHABET.length) // ohne Häufung einzelner Zeichen
  let out = ''
  while (out.length < length) {
    for (const b of globalThis.crypto.getRandomValues(new Uint8Array(length * 2))) if (b < limit && out.length < length) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  }
  return out
}

/** Öffnungscode zum Vorlesen oder Abtippen, z. B. „K7QM-3XRP“ (rund 40 Bit). */
export const openCode = () => randomCode(8).replace(/^(.{4})/, '$1-')

/**
 * PDF mit Öffnungscode verschlüsseln (AES-256). Drucken bleibt erlaubt,
 * Ändern und Kopieren nicht. Der Code wird nirgends gespeichert.
 */
export function protectPdf(doc, code) {
  return { ...doc, version: '1.7ext3', userPassword: code, ownerPassword: randomCode(24), permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } }
}
