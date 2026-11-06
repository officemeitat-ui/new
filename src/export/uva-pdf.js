// Umsatzsteuer-Übersicht (UVA) als PDF: Übersicht mit Kennzahlen, Zahllast bzw. Gutschrift, Annahmen und Hinweise,
// darunter die Belege des Zeitraums. Für die Ablage und die Steuerberatung (Rechenkern: core/vat-return.js).

import { formatDate } from '../core/dates.js'
import { VAT_BASIS, vatReturnAssumptions, vatReturnLines } from '../core/vat-return.js'
import { docShell, header, inkColors, tableLayout, TOTAL } from './pdf-parts.js'

const euro = (n) => (n === null || n === undefined ? '' : (Number(n) || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }))
const day = (iso) => (iso ? formatDate(iso, { weekday: false, year: true }) : '')
const AREA = { ust: 'Umsatzsteuer', vst: 'Vorsteuer', kasse: 'Kassenbuch' }

/** pdfmake-Beschreibung der Übersicht. r: vatReturn(), label: Zeitraum als Text. */
export function vatReturnDocument({ r, label, company = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const head = ['KZ', 'Bezeichnung', 'Bemessungsgrundlage', 'Steuer'].map((text) => ({ text, style: 'th' }))
  const body = [head]
  for (const l of vatReturnLines(r)) {
    if (l.level === 'head') {
      body.push([{ text: l.label, colSpan: 4, style: 'section', margin: [0, 2, 0, 0] }, '', '', ''])
      continue
    }
    const strong = l.level === 'sum' || l.level === 'result'
    const fill = l.level === 'result' ? { fillColor: TOTAL } : {}
    const sub = l.level === 'sub' ? { color: colors.grey } : {}
    body.push([
      { text: l.kz || '', ...fill },
      { text: l.label, bold: strong, margin: l.level === 'sub' ? [10, 0, 0, 0] : [0, 0, 0, 0], ...sub, ...fill },
      { text: euro(l.net), alignment: 'right', ...sub, ...fill },
      { text: euro(l.vat), alignment: 'right', bold: strong, ...sub, ...fill },
    ])
  }
  const rows = r.rows.map((x) => [day(x.date), AREA[x.area] || '', x.ref || '', x.partner || '', x.kind || '', x.rate || x.rate === 0 ? `${String(x.rate).replace('.', ',')} %` : '', { text: euro(x.net), alignment: 'right' }, { text: euro(x.vat), alignment: 'right' }, x.kz || ''])
  const content = [
    ...header({ title: `Umsatzsteuer ${label}`, subtitle: `${company ? `${company} · ` : ''}${VAT_BASIS[r.basis]} · ${day(r.from)} – ${day(r.to)}`, brand, logo, colors }),
    { table: { headerRows: 1, widths: [26, '*', 90, 80], body }, layout: tableLayout(colors) },
    { text: 'Annahmen', style: 'section' },
    { ul: vatReturnAssumptions(r.basis), fontSize: 8, color: colors.grey },
    r.notes.length ? { text: 'Hinweise zu diesem Zeitraum', style: 'section' } : '',
    r.notes.length ? { ul: r.notes, fontSize: 8 } : '',
    { text: `Belege im Zeitraum (${r.rows.length})`, style: 'section', pageBreak: r.rows.length > 12 ? 'before' : undefined },
    rows.length
      ? { table: { headerRows: 1, widths: [44, 52, 58, '*', 56, 30, 52, 46, 32], body: [['Datum', 'Bereich', 'Beleg', 'Partner', 'Art', 'Satz', 'Netto', 'Steuer', 'KZ'].map((text) => ({ text, style: 'th' })), ...rows] }, layout: tableLayout(colors), fontSize: 7.5 }
      : { text: 'Keine Belege im Zeitraum.', color: colors.grey },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Umsatzsteuer ${label}` })
}
