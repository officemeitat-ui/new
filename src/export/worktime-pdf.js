// Arbeitszeitaufzeichnung einer Person für einen Monat (§ 26 AZG): je Tag Objekt, Plan, Kommen,
// Gehen, Pause und Ist-Stunden aus der Zeiterfassung; Nachträge und Korrekturen mit Grund;
// Summen Soll/Ist und Unterschriftsfelder.

import { formatDate, formatHours } from '../core/dates.js'
import { STATUS_TEXT } from '../core/timeclock.js'
import { netMinutes, reasonLabel } from '../core/worktime.js'
import { docShell, header, inkColors, TOTAL, tableLayout } from './pdf-parts.js'

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }) : '')

/** rows: stampRows einer Person im Monat; objName(id) → Name. */
export function worktimeDocument({ employee, monthLabel, rows, summary, objName = () => '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const head = ['Datum', 'Objekt', 'Plan', 'Kommen', 'Gehen', 'Pause', 'Ist (h)', 'Bemerkung'].map((text) => ({ text, style: 'th' }))
  const body = rows.map((r) => {
    const s = r.stamp
    const net = netMinutes(s)
    const notes = [
      !s && r.inst ? STATUS_TEXT[r.status] : '',
      s?.source === 'manuell' ? `nachgetragen: ${reasonLabel(s.reason)}${s.by ? ` (${s.by})` : ''}` : '',
      ...(s?.changes || []).map((c) => `korrigiert: ${reasonLabel(c.reason)} (vorher ${time(c.before.in)}–${time(c.before.out) || '…'}${c.by ? `, ${c.by}` : ''})`),
      s?.note || '',
    ].filter(Boolean)
    return [
      formatDate(r.date),
      r.inst ? objName(r.inst.objectId) : s?.objectName || objName(s?.objectId) || '',
      r.inst ? `${r.inst.startTime}–${r.inst.endTime}` : '–',
      time(s?.in),
      time(s?.out) || (s ? '…' : ''),
      s?.pause ? `${s.pause} min` : '',
      net === null ? '' : formatHours(net),
      { text: notes.join('\n'), color: colors.grey, fontSize: 7.5 },
    ]
  })
  const total = [{ text: 'Summe', bold: true, colSpan: 6, fillColor: TOTAL }, {}, {}, {}, {}, {}, { text: formatHours(summary.ist), bold: true, fillColor: TOTAL }, { text: `Soll laut Plan ${formatHours(summary.soll)} h · Differenz ${summary.diff >= 0 ? '+' : '−'}${formatHours(Math.abs(summary.diff))} h`, fillColor: TOTAL, fontSize: 7.5 }]
  const content = [
    ...header({ title: 'Arbeitszeitaufzeichnung', subtitle: `${employee.name} · ${monthLabel}`, brand, logo, colors }),
    { text: [{ text: 'Mitarbeiter/in: ', bold: true }, employee.name, employee.personnelNo ? ` (Personalnr. ${employee.personnelNo})` : ''], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Grundlage: ', bold: true }, 'Zeiterfassung im Objekt (QR-Code) und Nachträge des Büros; Plan laut Dienstplan.'], margin: [0, 0, 0, 10] },
    rows.length ? { table: { headerRows: 1, widths: [52, '*', 54, 36, 36, 34, 34, 130], body: [head, ...body, total] }, layout: tableLayout(colors), fontSize: 8 } : { text: 'Keine Zeiten in diesem Monat.', color: colors.grey },
    { text: `Arbeitstage mit Zeiterfassung: ${summary.tage} · später gekommen: ${summary.spaet} · früher gegangen: ${summary.frueh} · nicht eingestempelt: ${summary.fehlt} · nachgetragen/korrigiert: ${summary.manuell}`, margin: [0, 8, 0, 0], color: colors.grey },
    {
      margin: [0, 40, 0, 0],
      columns: [
        { stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5 }] }, { text: 'Datum, Unterschrift Mitarbeiter/in', fontSize: 7.5, color: colors.grey, margin: [0, 3, 0, 0] }] },
        { stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5 }] }, { text: 'Datum, Unterschrift Arbeitgeber', fontSize: 7.5, color: colors.grey, margin: [0, 3, 0, 0] }] },
      ],
    },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Arbeitszeitaufzeichnung ${employee.name} ${monthLabel}` })
}
