// Bericht der Kundenzufriedenheit (pdfmake): Kennzahlen der letzten Runde (Zufriedenheit gesamt, NPS, Rücklauf,
// Antworten), Durchschnitt je Frage gegen die Vorrunde, Verlauf je Quartal, Rückmeldungen im Freitext (ohne Namen und
// Telefonnummern). Gleicher Kopf und Fuß wie Qualitätsmessung, Anlagenliste und Leistungsnachweis (pdf-parts.js).

import { formatDate } from '../core/dates.js'
import { fmtAvg, fmtNps, fmtRate, periodLabel } from '../core/zufriedenheit.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10), { weekday: false, year: true }) : '')
const RED = '#b3261e'

/**
 * scope: Text für den Bereich („alle Kunden“, „Kunde: …“, „Objekt: …“); rows: Verlauf je Runde (core history, ältere
 * zuerst); last/prev: Zusammenfassung (summarize) der letzten Runde mit Antworten und der davor; comments: Antworten
 * mit Freitext (neueste zuerst).
 */
export function zufriedenheitDocument({ scope = 'alle Kunden', rows = [], last = null, prev = null, lastRow = null, comments = [], brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const th = (list) => list.map((text) => ({ text, style: 'th' }))
  const cell = (label, value, sub = '', color) => ({ stack: [{ text: label, color: colors.grey, fontSize: 8 }, { text: value, bold: true, fontSize: 14, color }, { text: sub, color: colors.grey, fontSize: 8 }] })
  const content = [...header({ title: 'Kundenzufriedenheit', subtitle: `${scope}${lastRow ? ` · ${periodLabel(lastRow.period)}` : ''}`, brand, logo, colors })]
  if (!last || !lastRow) {
    content.push({ text: 'Noch keine Antworten in diesem Bereich.', margin: [0, 10, 0, 0] })
    return docShell(content, { brand, colors, createdAt, title: `Kundenzufriedenheit ${scope}` })
  }
  content.push(
    {
      table: {
        widths: ['*', '*', '*', '*'],
        body: [
          [
            cell('Zufriedenheit gesamt', `${fmtAvg(last.overall)} von 5`, prev?.overall !== null && prev?.overall !== undefined ? `Vorrunde ${fmtAvg(prev.overall)}` : '', last.overall !== null && last.overall <= 2.5 ? RED : undefined),
            cell('Weiterempfehlung (NPS)', fmtNps(last.nps?.score ?? null), last.nps ? `${last.nps.promoters} Promotoren, ${last.nps.detractors} Kritiker` : 'keine Angabe'),
            cell('Rücklauf', fmtRate(lastRow.rate), `${lastRow.answered} von ${lastRow.invited} Links`),
            cell('Antworten', String(last.count), last.callbacks ? `${last.callbacks} mit Rückruf` : ''),
          ],
        ],
      },
      layout: tableLayout(colors),
    },
    { text: 'Durchschnitt je Frage', style: 'section', margin: [0, 14, 0, 4] },
    {
      table: {
        headerRows: 1,
        widths: ['*', 70, 70, 50],
        body: [
          th(['Frage', periodLabel(lastRow.period), 'Vorrunde', 'Antworten']),
          ['Gesamtzufriedenheit', { text: fmtAvg(last.overall), alignment: 'right', bold: true }, { text: fmtAvg(prev?.overall ?? null), alignment: 'right' }, { text: String(last.count), alignment: 'right' }],
          ...last.items.map((x) => [x.text, { text: fmtAvg(x.avg), alignment: 'right' }, { text: fmtAvg(prev?.items.find((y) => y.id === x.id)?.avg ?? null), alignment: 'right' }, { text: String(x.n), alignment: 'right' }]),
        ],
      },
      layout: tableLayout(colors),
    },
  )
  if (rows.length > 1)
    content.push(
      { text: 'Verlauf je Quartal', style: 'section', margin: [0, 14, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 60, 60, 60, 50],
          body: [th(['Quartal', 'Antworten', 'Rücklauf', 'Gesamt', 'NPS']), ...rows.map((r) => [periodLabel(r.period), { text: String(r.count), alignment: 'right' }, { text: fmtRate(r.rate), alignment: 'right' }, { text: fmtAvg(r.overall), alignment: 'right' }, { text: fmtNps(r.nps), alignment: 'right' }])],
        },
        layout: tableLayout(colors),
      },
    )
  if (comments.length)
    content.push(
      { text: 'Rückmeldungen im Freitext', style: 'section', margin: [0, 14, 0, 4] },
      ...comments.slice(0, 40).map((a) => ({ stack: [{ text: `${day(a.at)} · ${a.linkTitle || 'Kunde'} · Gesamt ${a.overall} von 5`, color: colors.grey, fontSize: 7.5 }, { text: `„${a.comment}“` }], margin: [0, 0, 0, 6], unbreakable: true })),
    )
  content.push({
    text: 'Bewertung 1 = sehr unzufrieden bis 5 = sehr zufrieden. NPS (Weiterempfehlung): Anteil der Antworten 9–10 minus Anteil 0–6, von −100 bis +100. Rücklauf: Links, die in der Runde geantwortet haben. Freitexte ohne Namen und Telefonnummern.',
    fontSize: 7.5,
    color: colors.grey,
    margin: [0, 12, 0, 0],
  })
  return docShell(content, { brand, colors, createdAt, title: `Kundenzufriedenheit ${scope}` })
}

export const zufriedenheitPdfName = (scope, date) => `Kundenzufriedenheit_${fileSafe(scope) || 'alle'}_${date}.pdf`
