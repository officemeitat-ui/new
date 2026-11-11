// Müllplan je Person als PDF – im Aufbau der bisherigen Word-Pläne: Überschrift mit den Orten, Datum der Woche und
// Name, darunter ein Raster Montag | Dienstag, Mittwoch | Donnerstag, Freitag | Samstag und Sonntag. Je Tag die Orte
// (nur bei mehreren) und die Gänge „Biomüll raus – Davisstraße 7, 9, 11“. Eine Seite je Person.

import { addDays, formatDate, isoWeek, WEEKDAY_LONG } from '../core/dates.js'
import { fileSafe } from '../core/filename.js'
import { ACTION_TEXT, hasDuties, wastePlanTitle } from '../core/muellplan.js'
import { docShell, header, inkColors } from './pdf-parts.js'

const day = (d) => formatDate(d, { weekday: false, year: true })


function dayBlock(plan, i, colors) {
  const d = plan.days[i]
  const several = plan.towns.length > 1
  const out = [{ text: `${WEEKDAY_LONG[i]}:`, bold: true, fontSize: 12.5, color: colors.ink, margin: [0, 0, 0, 4] }]
  for (const g of d.groups) {
    if (!g.lines.length) continue
    if (several && g.town) out.push({ text: `${g.town}:`, bold: true, fontSize: 11, margin: [0, 4, 0, 2] })
    for (const l of g.lines) out.push({ text: [`${l.label} `, { text: ACTION_TEXT[l.action] || l.action, bold: true }, l.text ? ` – ${l.text}` : ''], fontSize: 11, margin: [0, 0, 0, 3] })
  }
  if (out.length === 1) out.push({ text: '–', color: colors.grey, fontSize: 11 })
  return out
}

/** Ein PDF mit einer Seite je Person. sheets: [{ name, plan }] (plan aus core/muellplan.js personWastePlan). */
export function wastePlanDocument({ sheets = [], monday, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const range = `${day(monday)} bis ${day(addDays(monday, 6))}`
  const content = []
  sheets.forEach(({ name, plan }, n) => {
    const cell = (stack) => ({ stack, margin: [4, 4, 4, 4] })
    const body = [
      [cell(dayBlock(plan, 0, colors)), cell(dayBlock(plan, 1, colors))],
      [cell(dayBlock(plan, 2, colors)), cell(dayBlock(plan, 3, colors))],
      [cell(dayBlock(plan, 4, colors)), cell([...dayBlock(plan, 5, colors), { text: ' ', margin: [0, 6, 0, 0] }, ...dayBlock(plan, 6, colors)])],
    ]
    content.push(
      { stack: header({ title: wastePlanTitle(plan), subtitle: `KW ${isoWeek(monday).week}`, brand, logo, colors }), ...(n ? { pageBreak: 'before' } : {}) },
      { text: [{ text: 'Name: ', bold: true }, name], fontSize: 12, margin: [0, 0, 0, 2] },
      { text: [{ text: 'Datum: ', bold: true }, range], fontSize: 12, margin: [0, 0, 0, 10] },
      { table: { widths: ['*', '*'], heights: [200, 200, 200], dontBreakRows: true, body }, layout: { hLineColor: () => colors.ink, vLineColor: () => colors.ink, hLineWidth: () => 0.8, vLineWidth: () => 0.8 } },
      hasDuties(plan) ? '' : { text: 'In dieser Woche keine Müll-Gänge.', color: colors.grey, margin: [0, 8, 0, 0] },
    )
  })
  return docShell(content, { brand, colors, createdAt, title: `Müllpläne KW ${isoWeek(monday).week}` })
}

export const wastePlanPdfName = (monday, name = '') => `Muellplan_KW${isoWeek(monday).week}_${monday}${name ? `_${fileSafe(name)}` : ''}.pdf`
