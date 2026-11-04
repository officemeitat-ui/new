// Winterdienst-Protokoll als PDF (pdfmake): Nachweis je Monat für Versicherung,
// Kunden oder Gericht. Je Eintrag Tag, Objekt mit Adresse, Uhrzeit, wer, was
// (geräumt, gestreut mit Streumittel, nur kontrolliert), Wetterlage und Notiz;
// Fotos im Anhang. Erzeugt nur die Dokumentbeschreibung (in Node testbar).

import { formatDate, MONTH_LONG } from '../core/dates.js'
import { logRows, workText } from '../core/winterlog.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

/**
 * month „JJJJ-MM“; log = data.winterlog; photos: Map Dateiname → data-URL (JPEG/PNG), fehlende
 * Fotos stehen als Dateiname im Anhang. objectId: nur ein Objekt (z. B. für den Kunden).
 * names: 'voll' (Standard), 'vorname' oder 'keine' (Kundenbereich: wie beim Leistungsnachweis eingestellt).
 */
export function winterLogDocument({ month, log = {}, objects = [], brand = {}, logo = null, photos = new Map(), objectId = '', names = 'voll', createdAt = new Date() }) {
  const colors = inkColors(brand)
  const who = (r) => (names === 'keine' ? '' : names === 'vorname' ? String(r.person || '').split(/\s+/)[0] : r.person || '')
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const rows = logRows(log, { from: `${month}-01`, to: `${month}-31`, objectsById }).filter((r) => !objectId || r.objectId === objectId)
  const [y, m] = month.split('-').map(Number)
  const title = 'Winterdienst-Protokoll'
  const only = objectId ? objectsById.get(objectId) : null
  const subtitle = `${MONTH_LONG[m - 1]} ${y}${only ? ` · ${only.name}` : ''}`
  const th = (text) => ({ text, style: 'th' })
  const withNames = names !== 'keine'
  const body = [[th('Tag'), th('Objekt'), th('Uhrzeit'), ...(withNames ? [th('Durchgeführt von')] : []), th('Tätigkeit'), th('Wetterlage'), th('Notiz'), th('Fotos')]]
  for (const r of rows) {
    body.push([
      { text: formatDate(r.date), noWrap: true },
      { stack: [{ text: r.objectName, bold: true }, r.address ? { text: r.address, fontSize: 7, color: colors.grey } : ''] },
      { text: r.time, alignment: 'center' },
      ...(withNames ? [who(r) || '–'] : []),
      workText(r) || '–',
      { text: r.lage && r.lage !== 'ruhig' ? r.lage : '', fontSize: 7, color: colors.grey },
      { text: r.notiz || '', fontSize: 7.5 },
      { text: r.fotos?.length ? String(r.fotos.length) : '', alignment: 'center' },
    ])
  }
  const content = [
    ...header({ title, subtitle, brand, logo, colors }),
    rows.length
      ? { table: { headerRows: 1, dontBreakRows: true, widths: withNames ? [44, '*', 34, 70, 70, 70, 70, 26] : [44, '*', 34, 80, 80, 90, 26], body }, layout: tableLayout(colors) }
      : { text: 'Keine Einträge in diesem Monat.', italics: true, color: colors.grey, margin: [0, 6, 0, 0] },
    { text: `Einträge: ${rows.length}${rows.length ? ` · Objekte: ${new Set(rows.map((r) => r.objectId)).size} · Tage: ${new Set(rows.map((r) => r.date)).size}` : ''}. Erfasst am Handy (Link aus dem Schnee-Alarm) oder in der App; Wetterlage laut GeoSphere Austria zum Zeitpunkt des Alarms.`, fontSize: 7, color: colors.grey, margin: [0, 5, 0, 0] },
  ]
  // Fotos im Anhang: je Eintrag mit Fotos eine Zeile, zwei Bilder nebeneinander
  const withPhotos = rows.filter((r) => r.fotos?.length)
  if (withPhotos.length) {
    content.push({ text: 'Fotos', style: 'section', pageBreak: 'before' })
    for (const r of withPhotos) {
      content.push({ text: [`${formatDate(r.date)} ${r.time}`, r.objectName, who(r), workText(r)].filter(Boolean).join(' · '), bold: true, margin: [0, 6, 0, 3] })
      const cells = r.fotos.map((f) => {
        const url = photos.get(f.datei)
        return url ? { image: url, fit: [250, 190], margin: [0, 0, 0, 4] } : { text: `Foto ${f.datei}${f.pfad ? ` (SharePoint: ${f.pfad})` : ''}`, fontSize: 7, color: colors.grey }
      })
      for (let i = 0; i < cells.length; i += 2) content.push({ columns: [cells[i], cells[i + 1] || { text: '' }], columnGap: 12, unbreakable: true })
    }
  }
  return docShell(content, { brand, colors, createdAt, title: `${title} ${subtitle}` })
}

export const winterLogPdfName = (month, objectName = '') => `Winterdienst-Protokoll_${month}${objectName ? `_${objectName.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '-')}` : ''}.pdf`
