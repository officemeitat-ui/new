// Mattenwechsel: Fotonachweis als PDF (pdfmake) mit Kopf und Logo wie Regiebericht und Leistungsnachweis
// (pdf-parts.js): Kunde, Objekt, Tag, Lieferschein, Fahrer, dann die Fotos des Fahrers je Liegeplatz – zwei
// nebeneinander, darunter Liegeplatz, Zeit, wer und bei „nicht möglich“ der Grund. Ohne Preise. Erzeugt nur die
// Dokumentbeschreibung (in Node testbar); Zeilen aus core/matten-fotos.js → proofRows, Bilder als data:-URL.

import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')

/**
 * rows: [{ title (Liegeplatz), sub (Zeit · wer · Grund), image (data:-URL, JPEG oder PNG) }] – Zeilen ohne Bild
 * (nicht ladbar) werden gezählt und als Hinweis genannt. info: { customerName, customerNo, objectName, address, date,
 * number (Lieferschein), driver }.
 */
export function photoProofDocument({ rows = [], info = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const line = (label, value) => [{ text: label, bold: true, color: colors.ink }, { text: value || '–' }]
  const head = [
    line('Kunde', [info.customerName, info.customerNo ? `(${info.customerNo})` : ''].filter(Boolean).join(' ')),
    line('Objekt', [info.objectName, info.address].filter(Boolean).join(', ')),
    line('Mattenwechsel am', day(info.date)),
    ...(info.number ? [line('Lieferschein', info.number)] : []),
    ...(info.driver ? [line('Fahrer', info.driver)] : []),
  ]
  const pics = rows.filter((r) => r.image)
  const missing = rows.length - pics.length
  const cell = (p) =>
    p
      ? { stack: [{ image: p.image, fit: [250, 190] }, { text: p.title || 'Liegeplatz', bold: true, fontSize: 8.5, margin: [0, 3, 0, 0] }, { text: p.sub || '', fontSize: 7.5, color: colors.grey }], margin: [0, 0, 0, 10] }
      : { text: '' }
  const photoRows = []
  for (let i = 0; i < pics.length; i += 2) photoRows.push({ columns: [cell(pics[i]), cell(pics[i + 1])], columnGap: 16, unbreakable: true })
  const content = [
    ...header({ title: 'Fotonachweis', subtitle: [info.number, day(info.date)].filter(Boolean).join(' · '), brand, logo, colors }),
    { table: { widths: [120, '*'], body: head }, layout: tableLayout(colors), fontSize: 9.5 },
    { text: pics.length === 1 ? '1 Foto' : `${pics.length} Fotos`, style: 'section', margin: [0, 12, 0, 6] },
    ...(pics.length ? photoRows : [{ text: 'Keine Fotos ladbar.', color: colors.grey }]),
    ...(missing ? [{ text: `${missing === 1 ? 'Ein weiteres Foto liegt' : `${missing} weitere Fotos liegen`} in unserer Ablage und ${missing === 1 ? 'konnte' : 'konnten'} hier nicht eingefügt werden; auf Wunsch senden wir ${missing === 1 ? 'es' : 'sie'} gern nach.`, fontSize: 8, color: colors.grey, margin: [0, 4, 0, 0] }] : []),
    { text: 'Die Fotos hat unser Fahrer beim Mattenwechsel am Liegeplatz aufgenommen. Sie dienen als Nachweis der Leistung.', fontSize: 8, color: colors.grey, margin: [0, 10, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Fotonachweis ${info.number || day(info.date)} ${info.customerName || ''}`.trim() })
}
