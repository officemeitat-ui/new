// Leistungsverzeichnis aus der Besichtigung (Vertrieb) als PDF: Beilage zum Angebot der Fakturierung (aus den beim
// Erstellen eingefrorenen Angaben, source.beilage) und zum Herunterladen bzw. für die Übergabe im Fall. Räume mit Art,
// Fläche, Belag, Häufigkeit, Leistungen und Besonderheiten; keine Preise, keine Stunden.

import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const num = (n) => (Number(n) || 0).toLocaleString('de-AT', { maximumFractionDigits: 0 })

/** Dateiname: Leistungsverzeichnis_VT-2026-001_Objekt.pdf */
export const lvPdfName = (lv) => `Leistungsverzeichnis_${fileSafe(lv?.no || 'Vertrieb')}${lv?.site?.name ? `_${fileSafe(lv.site.name)}` : ''}.pdf`

/** lv: core/vertrieb.js → lvSnapshot (eingefroren). offerNumber: Nummer des Angebots, zu dem es gehört (optional). */
export function lvDocument({ lv = {}, offerNumber = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const th = (t, extra = {}) => ({ text: t, style: 'th', ...extra })
  const body = [[th('Bereich'), th('Fläche', { alignment: 'right' }), th('Belag'), th('Häufigkeit'), th('Leistungen')]]
  for (const r of lv.rooms || []) {
    body.push([
      { stack: [{ text: r.name || r.type || '', bold: true }, { text: r.type || '', fontSize: 8, color: colors.grey }] },
      { text: r.m2 ? `${num(r.m2)} m²` : '–', alignment: 'right' },
      r.floor || '–',
      r.freq || '–',
      { stack: [{ ul: (r.tasks || []).map((t) => ({ text: t, fontSize: 8.5 })) }, ...(r.notes ? [{ text: `Besonderheiten: ${r.notes}`, fontSize: 8, italics: true, margin: [0, 2, 0, 0] }] : [])] },
    ])
  }
  body.push([{ text: 'Summe', bold: true }, { text: `${num(lv.totalM2)} m²`, alignment: 'right', bold: true }, '', '', ''])
  const content = [
    ...header({ title: 'Leistungsverzeichnis', subtitle: [lv.site?.name, offerNumber ? `Anlage zum Angebot ${offerNumber}` : ''].filter(Boolean).join(' · '), brand, logo, colors }),
    { text: [lv.customer, [lv.site?.name, lv.site?.address].filter(Boolean).join(', ')].filter(Boolean).join(' – '), bold: true, margin: [0, 0, 0, 4] },
    { text: [lv.date ? `Besichtigung am ${formatDate(lv.date, { weekday: false, year: true })}` : '', lv.no ? `Vorgang ${lv.no}` : ''].filter(Boolean).join(' · '), fontSize: 9, color: colors.grey, margin: [0, 0, 0, 8] },
    (lv.rooms || []).length ? { table: { headerRows: 1, widths: [100, 50, 70, 70, '*'], dontBreakRows: true, body }, layout: tableLayout(colors) } : { text: 'Noch keine Bereiche erfasst.' },
    { text: 'Unterhaltsreinigung laut diesem Leistungsverzeichnis; Häufigkeiten je Bereich. Sonder- und Grundreinigungen nach gesonderter Vereinbarung.', margin: [0, 10, 0, 0], fontSize: 9 },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Leistungsverzeichnis ${lv.site?.name || ''}`.trim() })
}
