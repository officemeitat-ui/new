// Ansicht als PDF-Bericht („Ansicht per E-Mail senden“): Kopf mit Logo, Stand, Kennzahlen als
// Kacheln, Tabellen und Listen so, wie sie gerade auf dem Bildschirm stehen (Filter inklusive).

import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

/** Höchstens so viele Zeilen je Tabelle (sonst wird die Mail zu groß); der Rest steht als Hinweis da. */
export const MAX_ROWS = 400

const cellText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * report: { title, subtitle?, intro?, tiles: [{ label, value }], tables: [{ title?, head: [...], rows: [[...]] }],
 *           lists: [{ title?, items: ['…'] }] }
 */
export function reportDocument({ title, subtitle = '', intro = '', tiles = [], tables = [], lists = [], brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const wide = tables.some((t) => t.head.length > 7)
  const content = [...header({ title, subtitle, brand, logo, colors })]
  if (intro) content.push({ text: cellText(intro), color: colors.grey, margin: [0, 0, 0, 8] })
  if (tiles.length) {
    const cells = tiles.map((t) => ({ stack: [{ text: cellText(t.label), fontSize: 7.5, color: colors.grey }, { text: cellText(t.value) || '–', fontSize: 12, bold: true, color: colors.ink }], fillColor: colors.soft }))
    const perRow = wide ? 6 : 4
    const body = []
    for (let i = 0; i < cells.length; i += perRow) {
      const row = cells.slice(i, i + perRow)
      while (row.length < perRow) row.push({ text: '' })
      body.push(row)
    }
    content.push({ table: { widths: Array(perRow).fill('*'), body }, layout: { ...tableLayout(colors), paddingTop: () => 5, paddingBottom: () => 5 }, margin: [0, 0, 0, 6] })
  }
  for (const t of tables) {
    if (!t.head.length) continue
    if (t.title) content.push({ text: cellText(t.title), style: 'section' })
    const rows = t.rows.slice(0, MAX_ROWS).map((r) => t.head.map((_, i) => cellText(r[i])))
    content.push({
      table: { headerRows: 1, widths: t.head.map(() => '*'), body: [t.head.map((h) => ({ text: cellText(h), style: 'th' })), ...(rows.length ? rows : [t.head.map((_, i) => (i ? '' : 'keine Einträge'))])] },
      layout: tableLayout(colors),
      fontSize: t.head.length > 9 ? 7 : 8,
      margin: [0, 0, 0, 6],
    })
    if (t.rows.length > MAX_ROWS) content.push({ text: `… und ${t.rows.length - MAX_ROWS} weitere Zeilen (vollständig in der CSV-Datei).`, color: colors.grey, margin: [0, 0, 0, 6] })
  }
  for (const l of lists) {
    if (!l.items.length) continue
    if (l.title) content.push({ text: cellText(l.title), style: 'section' })
    content.push({ ul: l.items.map(cellText), margin: [0, 0, 0, 6] })
  }
  const doc = docShell(content, { brand, colors, createdAt, title })
  if (wide) doc.pageOrientation = 'landscape'
  return doc
}
