// Aushang (QR) im Objekt: je Objekt eine A4-Seite mit großem QR-Code (kunden.php?q=CODE), Überschrift
// „Problem gesehen? Hier melden“ auf Deutsch und Englisch, Bezeichnung des Aushangs und Firmenlogo. Zum Ausdrucken
// und Aufhängen im Stiegenhaus oder im Büro des Kunden (in einer Hülle oder laminiert). Rein rechnend (pdfmake-Aufbau).

import { posterLink } from '../core/aushang.js'
import { docShell, inkColors } from './pdf-parts.js'

/** Texte am Aushang: Deutsch und Englisch. */
export const POSTER_TEXT = {
  de: {
    head: 'Problem gesehen? Hier melden',
    lines: ['Handy-Kamera auf den Code halten und den Link öffnen.', 'Kurz beschreiben, was nicht passt. Foto und Kontakt sind freiwillig.', 'Nach dem Senden sehen Sie über Ihren persönlichen Link den Stand.'],
    foot: 'Ohne Anmeldung, ohne App. Nicht für Notfälle: bei Gefahr bitte den Notruf wählen.',
  },
  en: {
    head: 'Seen a problem? Report it here',
    lines: ['Point your phone camera at the code and open the link.', 'Briefly describe what is wrong. Photo and contact details are optional.', 'After sending, your personal link shows the status.'],
    foot: 'No login, no app. Not for emergencies: in case of danger, please call the emergency number.',
  },
}

// Dateiname nur mit ASCII (manche Browser verwerfen Umlaute im Namen eines Downloads)
const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileSafe = (s) => String(s || '').replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c]).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
export const posterPdfName = (posters = []) => (posters.length === 1 ? `Aushang_QR_${fileSafe(posters[0].title) || 'Objekt'}.pdf` : 'Aushaenge_QR.pdf')

/**
 * posters: [{ title, token }] (nur eingeschaltete mit Code); address: Adresse der App bzw. des Webspace; phone: Telefon für
 * dringende Fälle (Einstellungen des Kundenbereichs), optional.
 */
export function posterDocument({ posters = [], address, brand = {}, logo = null, phone = '', createdAt = new Date() }) {
  const colors = inkColors(brand)
  const { de, en } = POSTER_TEXT
  const content = posters.map((p, i) => {
    const url = posterLink(address, p.token)
    return {
      stack: [
        logo ? (logo.svg ? { svg: logo.svg, width: 170 } : { image: logo.image, fit: [190, 76] }) : { text: brand.name || '', style: 'brand', fontSize: 20 },
        { text: de.head, fontSize: 32, bold: true, color: colors.ink, margin: [0, 26, 0, 2] },
        { text: en.head, fontSize: 19, color: colors.grey, margin: [0, 0, 0, 14] },
        { text: String(p.title || ''), fontSize: 20, bold: true },
        { qr: url, fit: 300, eccLevel: 'M', alignment: 'center', margin: [0, 26, 0, 26] },
        {
          columns: [
            { stack: [{ ol: de.lines, fontSize: 11.5, lineHeight: 1.3 }], width: '*' },
            { stack: [{ ol: en.lines, fontSize: 10.5, lineHeight: 1.3, color: colors.grey }], width: '*' },
          ],
          columnGap: 18,
        },
        phone ? { text: `Dringend? Bitte rufen Sie an: ${phone} · Urgent? Please call: ${phone}`, fontSize: 11, bold: true, margin: [0, 16, 0, 0] } : { text: '' },
        { text: de.foot, fontSize: 9, color: colors.grey, margin: [0, phone ? 6 : 16, 0, 0] },
        { text: en.foot, fontSize: 9, color: colors.grey },
        { text: url, fontSize: 7, color: colors.grey, margin: [0, 8, 0, 0] },
      ],
      ...(i ? { pageBreak: 'before' } : {}),
    }
  })
  return docShell(content.length ? content : [{ text: 'Kein Aushang eingeschaltet.' }], { brand, colors, createdAt, title: posters.length === 1 ? `Aushang ${posters[0].title || ''}`.trim() : 'Aushänge (QR)' })
}
