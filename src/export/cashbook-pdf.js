// Kassenbuch eines Monats als PDF: Anfangsbestand, alle Einträge in Nummernfolge mit laufendem Stand (Storno
// markiert), Summen, Kassenstürze, Stand des Monatsabschlusses mit Prüfsumme. Für die Ablage (7 Jahre, § 132 BAO)
// und die Steuerberatung.

import { cashSettings, monthReport } from '../core/cashbook.js'
import { formatDate, MONTH_LONG, viennaDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout, TOTAL } from './pdf-parts.js'

const euro = (n) => (Number(n) || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
const day = (iso) => (iso ? formatDate(iso, { weekday: false, year: true }) : '')
export const monthName = (ym) => `${MONTH_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

/** pdfmake-Beschreibung des Kassenbuchs für einen Monat. */
export function cashbookDocument({ book, month, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const r = monthReport(book, month)
  const s = cashSettings(book)
  const head = ['Nr.', 'Datum', 'Text', 'Gegenkonto', 'USt', 'Einnahme', 'Ausgabe', 'Stand'].map((text) => ({ text, style: 'th' }))
  const rows = r.rows.map(({ entry: e, balance, cancelled }) => {
    // Storno: Text beginnt mit „Storno Nr. …“, dazu der Grund; stornierte Einträge durchgestrichen mit Verweis
    const mark = e.type === 'storno' ? (e.reason ? ` – Grund: ${e.reason}` : '') : cancelled ? ` (storniert mit Nr. ${(book.entries || []).find((x) => x.cancels === e.id)?.no || '?'})` : ''
    const strike = cancelled ? { decoration: 'lineThrough' } : {}
    return [
      String(e.no),
      day(e.date),
      { text: `${e.text}${mark}${e.receipt ? ` · Beleg ${e.receipt}` : ''}`, ...strike },
      e.account || '',
      e.rate ? `${e.rate} %` : '',
      { text: e.kind === 'einnahme' ? euro(e.amount) : '', alignment: 'right', ...strike },
      { text: e.kind === 'ausgabe' ? euro(e.amount) : '', alignment: 'right', ...strike },
      { text: euro(balance), alignment: 'right' },
    ]
  })
  const body = [
    head,
    [{ text: `Anfangsbestand ${day(`${month}-01`)}`, colSpan: 7, italics: true }, '', '', '', '', '', '', { text: euro(r.opening), alignment: 'right' }],
    ...rows,
    [{ text: 'Summe', colSpan: 5, bold: true, fillColor: TOTAL }, '', '', '', '', { text: euro(r.sumIn), alignment: 'right', bold: true, fillColor: TOTAL }, { text: euro(r.sumOut), alignment: 'right', bold: true, fillColor: TOTAL }, { text: euro(r.closing), alignment: 'right', bold: true, fillColor: TOTAL }],
  ]
  const counts = r.counts.map((c) => `${day(c.date)}: gezählt ${euro(c.counted)}, laut Kassenbuch ${euro(c.expected)}, Differenz ${euro(c.diff)}${c.by ? ` (${c.by})` : ''}`)
  const content = [
    ...header({ title: `Kassenbuch ${monthName(month)}`, subtitle: `${s.name} · Kassenkonto ${s.account}`, brand, logo, colors }),
    { table: { headerRows: 1, widths: [24, 52, '*', 46, 30, 58, 58, 62], body }, layout: tableLayout(colors), fontSize: 8.5 },
    { text: `Endbestand ${day(lastDay(month))}: ${euro(r.closing)}`, bold: true, margin: [0, 8, 0, 0] },
    counts.length ? { text: 'Kassenstürze', style: 'section' } : '',
    counts.length ? { ul: counts, fontSize: 8.5 } : '',
    r.closed
      ? { text: `Monat abgeschlossen am ${day(viennaDate(r.closed.at) || String(r.closed.at).slice(0, 10))} von ${r.closed.by || '–'} (${r.closed.entries} Einträge, Prüfsumme ${r.closed.checksum}).`, margin: [0, 10, 0, 0], color: colors.grey }
      : { text: 'Monat noch nicht abgeschlossen (vorläufig).', margin: [0, 10, 0, 0], color: colors.grey },
    { text: 'Einträge werden nicht geändert oder gelöscht; Korrekturen stehen als Storno mit eigener Nummer (§ 131 BAO). Das Kassenbuch ersetzt keine Registrierkasse (§ 131b BAO).', margin: [0, 6, 0, 0], color: colors.grey, fontSize: 7.5 },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Kassenbuch ${monthName(month)}` })
}

const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10)

export const cashbookPdfName = (month) => `Kassenbuch_${month}.pdf`
export const cashbookPdfPath = (month) => `einkauf/kassenbuch/${month.slice(0, 4)}/${cashbookPdfName(month)}`
