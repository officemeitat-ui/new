// QR-Aushänge für die Zeiterfassung: je Objekt eine A4-Seite mit großem QR-Code
// (mein-plan.php?o=CODE) und einer kurzen Anleitung. Zum Ausdrucken und Aufhängen
// (z. B. im Putzraum oder beim Eingang, innen), laminiert oder in einer Hülle.

import { docShell, inkColors } from './pdf-parts.js'

export const qrUrl = (address, token) => `${String(address).replace(/\/?$/, '/')}mein-plan.php?o=${encodeURIComponent(token)}`

export function qrPosterDocument({ objects = [], tokenOf, address, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const content = objects.map((o, i) => ({
    stack: [
      logo ? (logo.svg ? { svg: logo.svg, width: 160 } : { image: logo.image, fit: [170, 70] }) : { text: brand.name || '', style: 'brand' },
      { text: 'Zeiterfassung', fontSize: 30, bold: true, color: colors.ink, margin: [0, 26, 0, 6] },
      { text: o.name, fontSize: 20, bold: true },
      o.address ? { text: o.address, fontSize: 12, color: colors.grey, margin: [0, 3, 0, 0] } : { text: '' },
      { qr: qrUrl(address, tokenOf(o.id)), fit: 290, alignment: 'center', margin: [0, 34, 0, 34] },
      {
        ol: [
          'Handy-Kamera auf den Code halten und den Link öffnen.',
          'Bei Arbeitsbeginn „Kommen erfassen“ tippen, nach der Arbeit wieder scannen und „Gehen erfassen“ tippen.',
          'Beim ersten Mal vorher den persönlichen Link aus der Nachricht vom Büro öffnen.',
        ],
        fontSize: 13,
        lineHeight: 1.35,
      },
      { text: 'Die Uhrzeit nimmt der Server, nicht das Handy. Nicht abfotografieren oder weitergeben.', fontSize: 10, color: colors.grey, margin: [0, 18, 0, 0] },
      { text: `Code ${tokenOf(o.id)}`, fontSize: 8, color: colors.grey, margin: [0, 6, 0, 0] },
    ],
    ...(i ? { pageBreak: 'before' } : {}),
  }))
  return docShell(content.length ? content : [{ text: 'Keine Objekte.' }], { brand, colors, createdAt, title: 'QR-Aushänge Zeiterfassung' })
}
