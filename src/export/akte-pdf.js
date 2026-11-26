// Mitarbeiterakte als PDF (core/mitarbeiterakte.js): Vermerk mit Fotos (z. B. aus der Objektkontrolle) und Protokoll des
// Mitarbeitergesprächs mit den besprochenen Vermerken, Ergebnis, Vereinbarung und Feldern für beide Unterschriften.

import { formatDate } from '../core/dates.js'
import { AKTE_KINDS } from '../core/mitarbeiterakte.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileSafe = (s) => String(s || '').replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c]).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
const day = (d) => (d ? formatDate(d, { year: true }) : '')

/** Vermerk: Person, Datum, Art, Objekt, Text, Fotos (photos: Map Pfad → Bild als data:-URL). */
export function entryDocument({ entry, emp = {}, objectName = '', photos = new Map(), brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const row = (label, value) => (value ? { text: [{ text: `${label}: `, bold: true }, value], margin: [0, 0, 0, 2] } : '')
  const images = (entry.photos || []).map((p) => photos.get(p.path)).filter(Boolean)
  const content = [
    ...header({ title: 'Vermerk', subtitle: `${emp.name || ''} · ${day(entry.date)}`, brand, logo, colors }),
    row('Person', emp.name || ''),
    row('Datum', day(entry.date)),
    row('Art', AKTE_KINDS[entry.kind]?.label || entry.kind),
    row('Objekt', objectName),
    row('Eingetragen von', entry.by || ''),
    { text: entry.title || '', style: 'section' },
    ...String(entry.text || '')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => ({ text: l, margin: [0, 0, 0, 3] })),
    entry.report ? { text: `Bericht der Messung: ${entry.report.name || entry.report.path}`, fontSize: 8, color: colors.grey, margin: [0, 6, 0, 0] } : '',
    images.length ? { text: 'Fotos', style: 'section' } : '',
    ...images.map((src) => ({ image: src, fit: [260, 200], margin: [0, 0, 0, 8] })),
    { text: 'Für das Mitarbeitergespräch. Die Person kann die Akte jederzeit einsehen (Art. 15 DSGVO).', fontSize: 8, color: colors.grey, margin: [0, 12, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Vermerk ${emp.name || ''} ${entry.date}` })
}

export const entryPdfName = (entry, emp = {}) => `Vermerk_${entry.date}_${fileSafe(emp.name) || 'Person'}.pdf`

/** Protokoll des Gesprächs: besprochene Vermerke, Ergebnis, Vereinbarung, nächster Termin, zwei Unterschriftsfelder. */
export function talkDocument({ talk, emp = {}, entries = [], objectName = () => '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const body = entries.map((e) => [day(e.date), AKTE_KINDS[e.kind]?.label || e.kind, objectName(e.objectId), { text: [{ text: `${e.title || ''}\n`, bold: true }, e.text || ''] }])
  const line = (label) => ({ stack: [{ text: ' ', margin: [0, 26, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 220, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: label, fontSize: 8, color: colors.grey }] })
  const content = [
    ...header({ title: 'Mitarbeitergespräch', subtitle: `${emp.name || ''} · ${day(talk.date)}`, brand, logo, colors }),
    { text: [{ text: 'Person: ', bold: true }, emp.name || ''], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Datum: ', bold: true }, day(talk.date)], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Geführt von: ', bold: true }, talk.by || ''], margin: [0, 0, 0, 8] },
    body.length ? { text: 'Besprochene Vermerke', style: 'section' } : '',
    body.length ? { table: { headerRows: 1, widths: [58, 80, 90, '*'], body: [['Datum', 'Art', 'Objekt', 'Vermerk'].map((text) => ({ text, style: 'th' })), ...body] }, layout: tableLayout(colors), fontSize: 8.5 } : '',
    { text: 'Ergebnis des Gesprächs', style: 'section' },
    { text: talk.note || '–' },
    { text: 'Vereinbarung', style: 'section' },
    { text: talk.agreed || '–' },
    talk.followUp ? { text: [{ text: 'Nächstes Gespräch: ', bold: true }, day(talk.followUp)], margin: [0, 8, 0, 0] } : '',
    { columns: [line(`Unterschrift ${emp.name || 'Mitarbeiter:in'}`), line(`Unterschrift ${talk.by || 'Vorgesetzte:r'}`)], columnGap: 30, margin: [0, 12, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Mitarbeitergespräch ${emp.name || ''} ${talk.date}` })
}

export const talkPdfName = (talk, emp = {}) => `Mitarbeitergespraech_${talk.date}_${fileSafe(emp.name) || 'Person'}.pdf`
