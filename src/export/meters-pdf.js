// Ablesebericht je Quartal für Hausverwaltung oder Auftraggeber: je Objekt
// die Zählstellen mit Datum, Stand und Verbrauch, danach die auffälligen
// Zähler (kritisch, hoch, niedrig, kein Verbrauch, Tausch unvollständig).

import { formatDate } from '../core/dates.js'
import { formatValue } from '../core/meters.js'
import { docShell, GREY, header, inkColors, tableLayout } from './pdf-parts.js'

const FLAG_TEXT = { kritisch: 'kritisch', hoch: 'hoch', niedrig: 'niedrig', leer: 'kein Verbrauch', tausch_unvollstaendig: 'Tausch unvollständig' }
const RED = '#C00000'

export function meterReportDocument(rows, { period, brand = { name: '', product: '' }, logo = null, createdAt = new Date(), note = '' } = {}) {
  const colors = inkColors(brand)
  const title = `Zählerstände ${period.label}`
  const content = [...header({ title: 'Zählerstände', subtitle: `${period.label} · Stichtag ${formatDate(period.to, { weekday: false, year: true })}`, brand, logo, colors })]
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.object)) groups.set(r.object, [])
    groups.get(r.object).push(r)
  }
  if (!groups.size) content.push({ text: 'Keine Ablesungen in diesem Zeitraum.', color: GREY })
  for (const [object, list] of groups) {
    const body = [
      ['Objekt Nr.', 'Anschrift / Lage', 'Zähler Nr.', 'Datum', 'Stand', 'Verbrauch', 'Hinweis'].map((t, i) => ({ text: t, style: 'th', alignment: i === 4 || i === 5 ? 'right' : 'left' })),
      ...list.map((r) => [
        r.objektNr,
        { text: r.location, bold: true },
        r.number,
        formatDate(r.date, { weekday: false, year: true }),
        { text: r.value === null ? '–' : `${formatValue(r.value)} ${r.unit}`, alignment: 'right' },
        { text: r.delta === null ? '–' : `${formatValue(r.delta)} ${r.unit}`, alignment: 'right', color: FLAG_TEXT[r.flag] ? RED : undefined, bold: !!FLAG_TEXT[r.flag] },
        { text: [FLAG_TEXT[r.flag] || '', r.note].filter(Boolean).join(' · '), fontSize: 7.5, color: GREY },
      ]),
    ]
    content.push({ text: [{ text: object, bold: true }, { text: `   ${list.length} Zählstellen`, color: GREY }], style: 'section' })
    content.push({ table: { headerRows: 1, dontBreakRows: true, widths: [46, '*', 60, 50, 56, 56, 100], body }, layout: tableLayout(colors) })
  }
  const flagged = rows.filter((r) => FLAG_TEXT[r.flag])
  if (flagged.length) {
    content.push({ text: 'Auffällige Zähler', style: 'section' })
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 70, 70, 80],
        body: [['Objekt / Anschrift', 'Zähler Nr.', 'Verbrauch', 'Einstufung'].map((t) => ({ text: t, style: 'th' })), ...flagged.map((r) => [`${r.object} · ${r.location}`, r.number, r.delta === null ? '–' : `${formatValue(r.delta)} ${r.unit}`, { text: FLAG_TEXT[r.flag], color: RED, bold: true }])],
      },
      layout: tableLayout(colors),
    })
    content.push({ text: 'Vergleich mit demselben Quartal im Vorjahr, sonst mit dem Durchschnitt: kritisch über 2,5-fach oder negativ, hoch über 1,4-fach, niedrig unter 25 %.', fontSize: 7.5, color: GREY, margin: [0, 4, 0, 0] })
  }
  if (note) content.push({ text: note, fontSize: 7.5, color: GREY, margin: [0, 8, 0, 0] })
  return docShell(content, { brand, colors, createdAt, title })
}
