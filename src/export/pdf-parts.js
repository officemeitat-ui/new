// Bausteine für PDF-Berichte (pdfmake): Kopf mit Logo, Tabellenrahmen,
// Seitenrahmen mit Fußzeile. Genutzt von Auszahlungen, Zählerständen,
// Kontrollberichten und dem Objektblatt.

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

export function docShell(content, { brand, colors, createdAt, title }) {
  const created = createdAt.toLocaleDateString('de-AT')
  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 40],
    info: { title, author: brand.name, creator: brand.product || 'Dienstplan' },
    content,
    footer: (page, pages) => ({ columns: [{ text: `${brand.name || ''}${brand.name ? ' · ' : ''}erstellt am ${created}`, fontSize: 7.5, color: GREY }, { text: `Seite ${page} von ${pages}`, alignment: 'right', fontSize: 7.5, color: GREY }], margin: [36, 14, 36, 0] }),
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
