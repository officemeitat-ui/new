// Etiketten für Geräte & Maschinen: je Gerät ein Feld mit QR-Code (öffnet die Gerätekarte in der App,
// #geraete/<Inventarnummer>), großer Inventarnummer, Bezeichnung und Firma. Zwei Spalten auf A4 zum Ausschneiden
// und Aufkleben (z. B. in einer Klarsichthülle oder laminiert); ein Gerät allein ergibt ein Etikett oben links.

import { labelUrl } from '../core/geraete.js'
import { docShell, inkColors } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
export const labelPdfName = (items, today) => (items.length === 1 ? `Etikett_${fileSafe(items[0].no)}.pdf` : `Etiketten_Geraete_${today}.pdf`)

/** items: Geräte; base: Adresse der App (ohne #); types: Map typeId → Name. */
export function labelDocument({ items = [], base = '', types = new Map(), brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const cell = (item) => ({
    table: {
      widths: [96, '*'],
      body: [
        [
          { qr: labelUrl(base, item.no), fit: 92, eccLevel: 'M', margin: [2, 2, 0, 2] },
          {
            stack: [
              logo ? (logo.svg ? { svg: logo.svg, width: 70, margin: [0, 0, 0, 4] } : { image: logo.image, fit: [80, 24], margin: [0, 0, 0, 4] }) : { text: brand.name || '', bold: true, color: colors.ink, margin: [0, 0, 0, 4] },
              { text: String(item.no || ''), fontSize: 20, bold: true, color: colors.ink },
              { text: String(item.name || ''), fontSize: 10, bold: true, margin: [0, 2, 0, 0] },
              { text: [types.get(item.typeId), item.serial ? `Nr. ${item.serial}` : ''].filter(Boolean).join(' · '), fontSize: 7.5, color: colors.grey },
              { text: `Eigentum ${brand.name || 'der Firma'}. Schaden? Code scannen oder im Büro melden.`, fontSize: 7, color: colors.grey, margin: [0, 4, 0, 0] },
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
    : [{ text: 'Keine Geräte gewählt.' }]
  return docShell(content, { brand, colors, createdAt, title: items.length === 1 ? `Etikett ${items[0].no}` : 'Etiketten Geräte & Maschinen' })
}
