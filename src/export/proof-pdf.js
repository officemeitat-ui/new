// Leistungsnachweis als PDF für den Kunden: Einsätze des Monats mit Status, auf Wunsch die
// gestempelten Zeiten und Namen, auf Wunsch die Checkliste vom Handy (erledigt x von y, „nicht möglich“
// mit Grund), Winterdienst laut Protokoll, Feld für die Bestätigung des Kunden.

import { formatDate, formatHours } from '../core/dates.js'
import { summaryText } from '../core/checkliste.js'
import { PROOF_STATUS } from '../core/proof.js'
import { workText } from '../core/winterlog.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')

/** Zelle „Checkliste“: „5 von 6 erledigt“, je Punkt „nicht möglich“ mit Grund, offene Punkte. */
export function checkCellText(c) {
  if (!c) return '–'
  return [summaryText(c), ...c.notPossible.map((x) => `nicht möglich: ${x.text} (${x.reason})`), c.open ? `${c.open} offen` : ''].filter(Boolean).join('\n')
}

export function proofDocument({ object = {}, monthLabel, from, to, proof, winter = [], withTimes = true, withNames = false, withChecks = false, withSignature = true, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const { rows, totals } = proof
  const showTimes = withTimes && rows.some((r) => r.ist.length)
  const showNames = withNames && rows.some((r) => r.persons.length)
  const showChecks = withChecks && rows.some((r) => r.check)
  const head = ['Datum', 'Zeit laut Plan', 'Leistung', 'Status', ...(showTimes ? ['erfasst im Objekt'] : []), ...(showChecks ? ['Checkliste'] : []), ...(showNames ? ['Personal'] : [])].map((text) => ({ text, style: 'th' }))
  const statusCell = (r) => ({ text: `${PROOF_STATUS[r.status]}${r.reason ? `\n${r.reason}` : ''}`, color: r.status === 'entfallen' ? colors.grey : r.status === 'offen' ? '#b3261e' : undefined })
  const body = rows.map((r) => [
    formatDate(r.date),
    r.time,
    `${r.label}${r.category === 'sonder' ? ' (Sonderleistung)' : ''}`,
    statusCell(r),
    ...(showTimes ? [r.ist.map((x) => `${x.in}–${x.out || '…'}`).join('\n')] : []),
    ...(showChecks ? [r.status === 'entfallen' ? '' : { text: checkCellText(r.check), color: r.check?.notPossible.length ? '#8a5300' : r.check ? undefined : colors.grey }] : []),
    ...(showNames ? [r.persons.join(', ')] : []),
  ])
  const widths = [62, 62, '*', 70, ...(showTimes ? [70] : []), ...(showChecks ? [120] : []), ...(showNames ? [90] : [])]
  const summary = [
    `${totals.done} ${totals.done === 1 ? 'Einsatz' : 'Einsätze'} erbracht`,
    totals.confirmed ? `davon ${totals.confirmed} mit Zeiterfassung im Objekt` : '',
    totals.cancelled ? `${totals.cancelled} entfallen` : '',
    totals.planned ? `${totals.planned} noch geplant` : '',
    `${formatHours(totals.planMinutes)} Stunden laut Plan`,
    showChecks && totals.checks?.items ? `Checkliste: ${totals.checks.done} von ${totals.checks.items} Punkten erledigt${totals.checks.notPossible ? `, ${totals.checks.notPossible} nicht möglich` : ''}` : '',
  ].filter(Boolean)
  const content = [
    ...header({ title: 'Leistungsnachweis', subtitle: `${object.name || ''} · ${monthLabel}`, brand, logo, colors }),
    { text: [{ text: 'Objekt: ', bold: true }, [object.name, object.address].filter(Boolean).join(', ')], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Zeitraum: ', bold: true }, `${formatDate(from, { year: true })} – ${formatDate(to, { year: true })}`], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Zusammenfassung: ', bold: true }, summary.join(' · ')], margin: [0, 0, 0, 10] },
    rows.length ? { table: { headerRows: 1, widths, body: [head, ...body] }, layout: tableLayout(colors), fontSize: 8.5 } : { text: 'Keine Einsätze in diesem Zeitraum.', color: colors.grey },
    ...(winter.length
      ? [
          { text: 'Winterdienst laut Protokoll', style: 'section', margin: [0, 14, 0, 4] },
          { table: { headerRows: 1, widths: [62, 50, '*'], body: [['Datum', 'Uhrzeit', 'Tätigkeit'].map((text) => ({ text, style: 'th' })), ...winter.map((w) => [formatDate(w.date), w.time, workText(w) || '–'])] }, layout: tableLayout(colors), fontSize: 8.5 },
        ]
      : []),
    showTimes ? { text: 'Erfasst im Objekt: Kommen und Gehen per QR-Code vor Ort, Uhrzeit des Servers.', fontSize: 7.5, color: colors.grey, margin: [0, 6, 0, 0] } : '',
    showChecks ? { text: 'Checkliste: von der Reinigungskraft je Einsatz am Handy abgehakt; „nicht möglich“ mit dem angegebenen Grund. „–“: keine Checkliste ausgefüllt.', fontSize: 7.5, color: colors.grey, margin: [0, showTimes ? 2 : 6, 0, 0] } : '',
    withSignature
      ? { columns: [{ stack: [{ text: ' ', margin: [0, 26, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 200, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: 'Datum, Unterschrift Auftraggeber', fontSize: 8, color: colors.grey }] }, { text: '' }], margin: [0, 24, 0, 0] }
      : '',
  ]
  return docShell(content, { brand, colors, createdAt, title: `Leistungsnachweis ${object.name || ''} ${monthLabel}` })
}

export const proofPdfName = (objectName, month) => `Leistungsnachweis_${month}_${fileSafe(objectName) || 'Objekt'}.pdf`
