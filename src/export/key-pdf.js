// Schlüsselbuch als PDF: Quittung bei der Übergabe (mit Unterschrift vom Bildschirm oder Linie zum
// Unterschreiben), Schlüsselliste je Person (z. B. zum Austritt) und Verlustmeldung für den Kunden.

import { formatDate } from '../core/dates.js'
import { KEY_KINDS } from '../core/keys.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const day = (d) => (d ? formatDate(d, { year: true }) : '–')
const sigCell = (svg, label, colors) => ({
  stack: [svg ? { svg, width: 170 } : { text: ' ', margin: [0, 34, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 200, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: label, fontSize: 8, color: colors.grey, margin: [0, 2, 0, 0] }],
})

/** Quittung: wer welchen Schlüssel von wem bekommen hat; Unterschriften. */
export function receiptDocument({ keys, objectName = '', address = '', to = '', from = 'Büro', date, due = '', note = '', signature = '', brand = {}, logo = null, createdAt = new Date(), giveBack = false }) {
  const colors = inkColors(brand)
  const rows = keys.map((k) => [k.label, k.no || '', KEY_KINDS[k.kind] || '']).map((r) => r.map((text) => ({ text })))
  const content = [
    ...header({ title: giveBack ? 'Schlüssel-Rückgabe' : 'Schlüssel-Quittung', subtitle: `${objectName} · ${day(date)}`, brand, logo, colors }),
    { text: [{ text: 'Objekt: ', bold: true }, [objectName, address].filter(Boolean).join(', ')], margin: [0, 0, 0, 4] },
    { text: [{ text: giveBack ? 'Zurückgegeben von: ' : 'Übergeben an: ', bold: true }, giveBack ? from : to], margin: [0, 0, 0, 2] },
    { text: [{ text: giveBack ? 'Angenommen von: ' : 'Übergeben von: ', bold: true }, giveBack ? to : from], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Datum: ', bold: true }, day(date), due ? `   ·   Rückgabe bis ${day(due)}` : ''], margin: [0, 0, 0, 10] },
    { table: { headerRows: 1, widths: ['*', 110, 110], body: [['Bezeichnung', 'Nummer / Prägung', 'Art'].map((text) => ({ text, style: 'th' })), ...rows] }, layout: tableLayout(colors), fontSize: 10 },
    note ? { text: note, margin: [0, 8, 0, 0] } : '',
    giveBack
      ? { text: 'Die oben genannten Schlüssel wurden vollständig zurückgegeben.', margin: [0, 14, 0, 0] }
      : { ul: ['Die Schlüssel sind sorgfältig aufzubewahren und nicht an Dritte weiterzugeben.', 'Ein Verlust ist sofort dem Büro zu melden.', due ? `Rückgabe spätestens am ${day(due)}, sonst bei Ende der Tätigkeit im Objekt oder auf Anforderung.` : 'Rückgabe bei Ende der Tätigkeit im Objekt, beim Austritt oder auf Anforderung.'], margin: [0, 14, 0, 0], fontSize: 9.5 },
    { columns: [sigCell(giveBack ? '' : signature, giveBack ? `Zurückgegeben: ${from}` : `Erhalten: ${to}`, colors), sigCell(giveBack ? signature : '', giveBack ? `Angenommen: ${to}` : `Übergeben: ${from}`, colors)], columnGap: 40, margin: [0, 30, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Schlüssel-Quittung ${objectName}` })
}

export const receiptPdfName = (objectName, person, date, giveBack = false) => `${giveBack ? 'Schluessel-Rueckgabe' : 'Schluessel-Quittung'}_${fileSafe(objectName)}_${fileSafe(person)}_${date}.pdf`

/** Liste aller Schlüssel einer Person (z. B. zum Austritt abhaken). */
export function personListDocument({ person, rows, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const body = rows.map((r) => [r.objectName, r.key.label, r.key.no || '', day(r.key.since), r.key.due ? day(r.key.due) : '', '☐'])
  const content = [
    ...header({ title: 'Schlüssel je Person', subtitle: person, brand, logo, colors }),
    rows.length
      ? { table: { headerRows: 1, widths: ['*', 110, 70, 62, 62, 40], body: [['Objekt', 'Schlüssel', 'Nummer', 'seit', 'Rückgabe bis', 'zurück'].map((text) => ({ text, style: 'th' })), ...body] }, layout: tableLayout(colors), fontSize: 9.5 }
      : { text: 'Keine Schlüssel ausgegeben.', color: colors.grey },
    { columns: [sigCell('', `Unterschrift ${person}`, colors), sigCell('', 'Unterschrift Büro', colors)], columnGap: 40, margin: [0, 34, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Schlüssel ${person}` })
}

/** Verlustmeldung für den Kunden bzw. die Versicherung (ohne Namen der Mitarbeitenden). */
export function lossDocument({ key, objectName = '', address = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const row = (label, value) => [{ text: label, bold: true, color: colors.ink }, { text: value || '–' }]
  const content = [
    ...header({ title: 'Verlustmeldung Schlüssel', subtitle: objectName, brand, logo, colors }),
    {
      table: {
        widths: [130, '*'],
        body: [
          row('Objekt', [objectName, address].filter(Boolean).join(', ')),
          row('Schlüssel', [key.label, key.no ? `Nr. ${key.no}` : '', KEY_KINDS[key.kind] || ''].filter(Boolean).join(' · ')),
          row('Verlust bemerkt am', day(key.lost?.date)),
          row('Umstände', key.lost?.text),
          row('Maßnahme', key.lost?.measure),
        ],
      },
      layout: tableLayout(colors),
      fontSize: 10,
    },
    { text: 'Wir bitten um Rückmeldung, ob der Zylinder getauscht oder die Karte bzw. der Transponder gesperrt werden soll.', margin: [0, 12, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Verlustmeldung ${objectName}` })
}
