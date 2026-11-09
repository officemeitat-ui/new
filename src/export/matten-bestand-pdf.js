// Mattenwechsel: Wäscherei-Lieferschein als PDF (Paket P17, core/matten-bestand.js). Mengen je Mattentyp, ohne Preise,
// mit den Bausteinen der anderen PDFs (Kopf mit Logo, Tabelle, Fußzeile: export/pdf-parts.js).

import { formatDate } from '../core/dates.js'
import { slipTotal } from '../core/matten-bestand.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const lines = (list) => list.filter(Boolean).join('\n')

/**
 * Lieferschein für die Wäscherei zu einer Abholung (booking aus matten/bestand.json, kind 'abholung'): Nummer, Tag,
 * Wäscherei, je Mattentyp die Stückzahl, Summe, Bemerkung, Felder für die Übergabe. laundry: { name, email, contact };
 * brand: config.json → brand (Firmenname, Kontakt, Farben; Logo über logo wie bei den anderen PDFs).
 */
export function laundryDocument({ booking, laundry = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const title = `Lieferschein Wäscherei ${booking.no || ''}`.trim()
  const head = ['Pos.', 'Mattentyp', 'Stück'].map((text, i) => ({ text, style: 'th', alignment: i === 2 ? 'right' : 'left' }))
  const rows = (booking.lines || []).map((l, i) => [String(i + 1), l.name || 'Matte', { text: String(l.qty), alignment: 'right' }])
  rows.push([{ text: 'Summe', colSpan: 2, bold: true, alignment: 'right' }, '', { text: String(slipTotal(booking)), bold: true, alignment: 'right' }])
  const content = [
    ...header({ title, subtitle: formatDate(booking.date, { year: true }), brand, logo, colors }),
    {
      columns: [
        { stack: [{ text: 'An', bold: true, color: colors.ink }, { text: lines([laundry.name, laundry.contact, laundry.email]) || 'Wäscherei' }] },
        { stack: [{ text: 'Von', bold: true, color: colors.ink }, { text: lines([brand.name, brand.contact]) || '–' }, { text: `Abholung am ${formatDate(booking.date, { year: true })}`, margin: [0, 4, 0, 0] }] },
      ],
      columnGap: 24,
      margin: [0, 0, 0, 12],
      fontSize: 9.5,
    },
    { text: 'Schmutzfangmatten zur Wäsche', style: 'section' },
    { table: { headerRows: 1, widths: [30, '*', 60], body: [head, ...rows] }, layout: tableLayout(colors), fontSize: 10 },
    booking.note ? { text: booking.note, margin: [0, 10, 0, 0] } : '',
    { text: 'Bitte die Stückzahl bei der Übernahme prüfen und Abweichungen auf dem Lieferschein vermerken.', margin: [0, 14, 0, 0], color: colors.grey },
    {
      columns: [
        { stack: [{ text: '\n\n______________________________' }, { text: 'Übergeben (Datum, Unterschrift)', color: colors.grey }] },
        { stack: [{ text: '\n\n______________________________' }, { text: 'Übernommen von der Wäscherei', color: colors.grey }] },
      ],
      columnGap: 24,
      margin: [0, 18, 0, 0],
    },
  ]
  return docShell(content, { brand, colors, createdAt, title })
}

/** Dateiname: Lieferschein-Waescherei_WL-2026-001_2026-11-09.pdf */
export const laundryPdfName = (booking) => `Lieferschein-Waescherei_${fileSafe(booking?.no) || 'ohne-Nummer'}_${booking?.date || ''}.pdf`
