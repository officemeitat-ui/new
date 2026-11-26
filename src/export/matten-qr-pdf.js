// QR-Aufkleber für die Liegeplätze der Schmutzfangmatten (core/matten-qr.js): je Liegeplatz ein Feld mit QR-Code,
// Name des Liegeplatzes, Stockwerk, Objekt und Kunde und dem Hinweis „Beim Wechsel scannen“. Zwei Spalten auf A4 zum
// Ausschneiden; am besten laminiert bzw. als wetterfester Aufkleber neben der Matte (Wand, Türrahmen, Säule).

import { docShell, inkColors } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
export const qrStickerName = (title, today) => `QR-Liegeplaetze_${fileSafe(title) || 'Auswahl'}_${today}.pdf`

/** items: [{ id, name, floor, objectName, customerName }]; link(id) → URL auf dem Aufkleber. */
export function qrStickerDocument({ items = [], link, title = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const cell = (p) => ({
    table: {
      widths: [100, '*'],
      body: [
        [
          { qr: link(p.id), fit: 96, eccLevel: 'M', margin: [2, 2, 0, 2] },
          {
            stack: [
              logo ? (logo.svg ? { svg: logo.svg, width: 64, margin: [0, 0, 0, 4] } : { image: logo.image, fit: [72, 22], margin: [0, 0, 0, 4] }) : { text: brand.name || '', bold: true, color: colors.ink, margin: [0, 0, 0, 4] },
              { text: 'Mattenwechsel', fontSize: 8, color: colors.grey },
              { text: String(p.name || 'Liegeplatz'), fontSize: 13, bold: true, color: colors.ink },
              p.floor ? { text: String(p.floor), fontSize: 9 } : { text: '' },
              { text: [p.objectName, p.customerName].filter(Boolean).join(' · '), fontSize: 7.5, color: colors.grey, margin: [0, 2, 0, 0] },
              { text: 'Fahrer: beim Wechsel mit der Handykamera scannen.', fontSize: 7, color: colors.grey, margin: [0, 4, 0, 0] },
            ],
            margin: [4, 2, 2, 2],
          },
        ],
      ],
    },
    layout: { hLineColor: () => colors.ink, vLineColor: () => colors.ink, hLineWidth: () => 0.8, vLineWidth: () => 0.8, paddingTop: () => 4, paddingBottom: () => 4 },
  })
  const rows = []
  for (let i = 0; i < items.length; i += 2) rows.push([cell(items[i]), items[i + 1] ? cell(items[i + 1]) : { text: '' }])
  const content = rows.length
    ? [{ table: { widths: ['*', '*'], dontBreakRows: true, body: rows }, layout: { defaultBorder: false, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 6, paddingBottom: () => 6 } }]
    : [{ text: 'Keine Liegeplätze gewählt.' }]
  return docShell(content, { brand, colors, createdAt, title: `QR-Aufkleber Liegeplätze${title ? ` – ${title}` : ''}` })
}
