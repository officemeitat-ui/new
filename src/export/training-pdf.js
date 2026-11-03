// Unterweisungsnachweis als PDF: Art, Datum, Ort, Inhalt, wer unterwiesen hat, Teilnehmerliste mit
// Unterschrift (vom Bildschirm) oder leerem Feld zum Unterschreiben auf Papier.

import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')

export function sessionDocument({ session, type = {}, people = [], signatures = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const row = (label, value) => (value ? { text: [{ text: `${label}: `, bold: true }, value], margin: [0, 0, 0, 2] } : '')
  const body = people.map((p, i) => [String(i + 1), p.name, signatures[p.id] ? { svg: signatures[p.id], width: 150 } : { text: ' ', margin: [0, 14, 0, 0] }])
  const content = [
    ...header({ title: 'Unterweisung', subtitle: `${type.name || ''} · ${formatDate(session.date, { year: true })}`, brand, logo, colors }),
    row('Art', `${type.name || ''}${type.law ? ` (${type.law})` : ''}`),
    row('Datum', formatDate(session.date, { year: true })),
    row('Ort', session.place),
    row('Unterwiesen von', session.trainer),
    session.topic ? { text: [{ text: 'Inhalt: ', bold: true }, session.topic], margin: [0, 0, 0, 10] } : { text: '', margin: [0, 0, 0, 8] },
    { text: 'Mit der Unterschrift bestätigen die Teilnehmenden, dass sie die Unterweisung erhalten und verstanden haben.', fontSize: 9, margin: [0, 0, 0, 6] },
    { table: { headerRows: 1, widths: [22, '*', 180], body: [['Nr.', 'Name', 'Unterschrift'].map((text) => ({ text, style: 'th' })), ...body] }, layout: tableLayout(colors), fontSize: 10 },
    { stack: [{ text: ' ', margin: [0, 30, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 200, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: `Unterschrift ${session.trainer || 'Unterweisende:r'}`, fontSize: 8, color: colors.grey }] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Unterweisung ${type.name || ''} ${session.date}` })
}

export const sessionPdfName = (session, type = {}) => `Unterweisung_${session.date}_${fileSafe(type.name) || 'Nachweis'}.pdf`
