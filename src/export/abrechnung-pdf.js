// Einsatzliste als Beilage zur Rechnung nach Ist-Zeiten (pdfmake): je gezählter Stempelung Datum, von–bis, Dauer
// (gerundet wie verrechnet) und Leistung, Namen nur wie beim Leistungsnachweis eingestellt. Erzeugt nur die
// Dokumentbeschreibung (in Node testbar); Rechenkern: core/fak-abrechnung.js (istFor).

import { formatDate, formatHours } from '../core/dates.js'
import { durationText, ROUND_STEPS } from '../core/fak-abrechnung.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * object { name, address }; monthLabel „Oktober 2026“; rows: gezählte Zeilen aus istFor (schon nach Rechnung gefiltert);
 * round: Rundung je Stempelung in Minuten; names: 'keine' | 'vorname' | 'voll' (Personen stehen schon so in den Zeilen).
 */
export function istListDocument({ object = {}, monthLabel = '', rows = [], round = 15, names = 'keine', invoiceNumber = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const withNames = names !== 'keine' && rows.some((r) => r.person)
  const withPlan = rows.some((r) => r.basis === 'plan')
  const th = (text) => ({ text, style: 'th' })
  const head = [th('Datum'), th('von–bis'), th('Dauer'), th('Leistung'), ...(withNames ? [th('Personal')] : []), ...(withPlan ? [th('Grundlage')] : [])]
  const body = rows.map((r) => [
    { text: formatDate(r.date), noWrap: true },
    { text: `${r.in}–${r.out}`, noWrap: true },
    { text: durationText(r.billed), alignment: 'right' },
    `${r.label || ''}${r.category === 'sonder' ? ' (Sonderleistung)' : ''}`,
    ...(withNames ? [r.person || ''] : []),
    ...(withPlan ? [r.basis === 'plan' ? 'Plan' : 'erfasst'] : []),
  ])
  const total = rows.reduce((s, r) => s + r.billed, 0)
  const widths = [58, 58, 38, '*', ...(withNames ? [90] : []), ...(withPlan ? [48] : [])]
  const notes = [
    `Erfasst im Objekt: Kommen und Gehen per QR-Code vor Ort.${round ? ` Dauer je Stempelung ${ROUND_STEPS[round]} gerundet (ab der Hälfte aufwärts).` : ''}`,
    withPlan ? '„Plan“: Einsatz ohne vollständige Zeiterfassung, mit der geplanten Zeit verrechnet.' : '',
  ].filter(Boolean)
  const content = [
    ...header({ title: 'Einsatzliste', subtitle: `${object.name || ''} · ${monthLabel}`, brand, logo, colors }),
    { text: [{ text: 'Objekt: ', bold: true }, [object.name, object.address].filter(Boolean).join(', ')], margin: [0, 0, 0, 2] },
    invoiceNumber ? { text: [{ text: 'Beilage zur Rechnung: ', bold: true }, invoiceNumber], margin: [0, 0, 0, 2] } : '',
    { text: [{ text: 'Summe: ', bold: true }, `${formatHours(total)} Stunden · ${rows.length} ${rows.length === 1 ? 'Eintrag' : 'Einträge'}`], margin: [0, 0, 0, 10] },
    rows.length ? { table: { headerRows: 1, dontBreakRows: true, widths, body: [head, ...body] }, layout: tableLayout(colors), fontSize: 8.5 } : { text: 'Keine erfassten Zeiten in diesem Zeitraum.', color: colors.grey },
    { text: notes.join(' '), fontSize: 7.5, color: colors.grey, margin: [0, 6, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Einsatzliste ${object.name || ''} ${monthLabel}` })
}

export const istListPdfName = (objectName, month) => `Einsatzliste_${month}_${fileSafe(objectName) || 'Objekt'}.pdf`
