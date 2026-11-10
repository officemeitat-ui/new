// Material & Lager als PDF: Bestellschein für den Lieferanten und Zählliste für die Inventur.

import { formatDate, todayISO, viennaDate } from '../core/dates.js'
import { euro, orderLineSum, orderSum } from '../core/material.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const qty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ',')
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')

/** Bestellschein: Lieferant, Lieferadresse, Positionen mit Menge, Einheit, Art.-Nr., Preis. */
export function orderDocument({ order, supplier = {}, articles = [], settings = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const byId = new Map(articles.map((a) => [a.id, a]))
  const withPrices = (order.lines || []).some((l) => Number(l.price) > 0)
  const head = ['Pos.', 'Menge', 'Einheit', 'Artikel', 'Art.-Nr.', ...(withPrices ? ['Preis', 'Betrag'] : [])].map((text) => ({ text, style: 'th' }))
  const rows = (order.lines || []).map((l, i) => {
    const a = byId.get(l.articleId) || {}
    return [String(i + 1), { text: qty(l.qty), alignment: 'right' }, a.unit || 'Stk', a.name || '', a.articleNo || '', ...(withPrices ? [{ text: l.price ? euro(l.price) : '', alignment: 'right' }, { text: l.price ? euro(orderLineSum(l)) : '', alignment: 'right' }] : [])]
  })
  if (withPrices) rows.push([{ text: 'Summe netto', colSpan: 6, bold: true, alignment: 'right' }, '', '', '', '', '', { text: euro(orderSum(order)), bold: true, alignment: 'right' }])
  const address = (lines) => lines.filter(Boolean).join('\n')
  const content = [
    ...header({ title: `Bestellung ${order.no || ''}`, subtitle: formatDate(order.orderedAt || viennaDate(order.createdAt || '') || todayISO(createdAt), { year: true }), brand, logo, colors }),
    {
      columns: [
        { stack: [{ text: 'An', bold: true, color: colors.ink }, { text: address([supplier.name, supplier.contact, supplier.email, supplier.phone]) || '–' }, supplier.customerNo ? { text: `Unsere Kundennummer: ${supplier.customerNo}`, margin: [0, 4, 0, 0] } : ''] },
        { stack: [{ text: 'Lieferadresse', bold: true, color: colors.ink }, { text: settings.deliveryAddress || brand.name || '–' }, order.expected ? { text: `Liefertermin: bis ${formatDate(order.expected, { year: true })}`, margin: [0, 4, 0, 0] } : '', settings.contact ? { text: `Rückfragen: ${settings.contact}`, margin: [0, 4, 0, 0] } : ''] },
      ],
      columnGap: 24,
      margin: [0, 0, 0, 12],
      fontSize: 9.5,
    },
    {
      table: { headerRows: 1, widths: withPrices ? [24, 40, 44, '*', 70, 52, 58] : [24, 40, 50, '*', 90], body: [head, ...rows] },
      layout: tableLayout(colors),
      fontSize: 9.5,
    },
    order.note ? { text: order.note, margin: [0, 10, 0, 0] } : '',
    { text: 'Bitte bestätigen Sie die Bestellung kurz per E-Mail. Danke!', margin: [0, 14, 0, 0], color: colors.grey },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Bestellung ${order.no || ''}` })
}

export const orderPdfName = (order, supplier = {}) => `Bestellung_${order.no || 'Entwurf'}_${fileSafe(supplier.name) || 'Lieferant'}.pdf`

/** Zählliste für die Inventur eines Lagers: Artikel nach Kategorie, Bestand laut App, Feld für die gezählte Menge. */
export function countDocument({ rows, location, brand = {}, logo = null, createdAt = new Date(), withStock = true }) {
  const colors = inkColors(brand)
  const head = ['Kategorie', 'Artikel', 'Einheit', ...(withStock ? ['laut App'] : []), 'gezählt'].map((text) => ({ text, style: 'th' }))
  const body = rows.map((r) => [r.article.category || '', r.article.name, r.article.unit || '', ...(withStock ? [{ text: qty(r.byLoc?.[location.id] ?? 0), alignment: 'right' }] : []), ''])
  const content = [
    ...header({ title: 'Inventur', subtitle: `${location.name} · ${formatDate(todayISO(createdAt), { year: true })}`, brand, logo, colors }),
    { table: { headerRows: 1, widths: withStock ? [90, '*', 50, 50, 70] : [90, '*', 50, 90], heights: () => 18, body: [head, ...body] }, layout: tableLayout(colors), fontSize: 9.5 },
    { text: 'Gezählt von: ______________________     Datum: __________', margin: [0, 16, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Inventur ${location.name}` })
}
