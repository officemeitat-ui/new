// Reklamation als PDF: Nachweis für den Kunden bzw. die Akte (Eingang, Mangel, Maßnahme, Ergebnis).
// Ohne Namen der Mitarbeitenden (die stehen nur in der App), damit das PDF an den Kunden gehen kann.

import { formatDate } from '../core/dates.js'
import { dayOf, STATUS } from '../core/complaints.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const dateTime = (iso) => (iso ? `${formatDate(iso.slice(0, 10), { year: true })}${iso.length > 10 ? `, ${new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' })} Uhr` : ''}` : '–')

export function complaintDocument({ complaint: c, object = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const row = (label, value) => [{ text: label, bold: true, color: colors.ink }, { text: value || '–' }]
  const content = [
    ...header({ title: 'Reklamation', subtitle: `${object.name || ''} · ${STATUS[c.status] || c.status}`, brand, logo, colors }),
    {
      table: {
        widths: [120, '*'],
        body: [
          row('Objekt', [object.name, object.address].filter(Boolean).join(', ')),
          row('Eingang', `${dateTime(c.received)} · ${c.source || ''}`),
          row('Betrifft den', c.date ? formatDate(c.date, { year: true }) : ''),
          row('Art', c.kind),
          row('Beschreibung', c.text),
          row('Ansprechperson', c.contact),
          row('Maßnahme', c.measure),
          row('Frist', c.due ? formatDate(c.due, { year: true }) : ''),
          row('Erledigt', c.doneAt ? dateTime(c.doneAt) : 'noch offen'),
          row('Ergebnis', c.result),
          row('Kunde informiert', c.informed ? 'ja' : 'nein'),
        ],
      },
      layout: tableLayout(colors),
      fontSize: 9.5,
    },
    { text: 'Verlauf', style: 'section', margin: [0, 12, 0, 4] },
    (c.history || []).length ? { ul: c.history.map((h) => `${dateTime(h.at)}: ${h.text}`), fontSize: 8.5 } : { text: '–', color: colors.grey },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Reklamation ${object.name || ''}` })
}

export const complaintPdfName = (c, objectName = '') => `Reklamation_${dayOf(c.received)}_${objectName.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '-')}.pdf`
