// Regiebericht als PDF (pdfmake) mit Kopf und Logo wie Leistungsnachweis, Anlagenliste und Schlüssel-Quittung
// (pdf-parts.js): Objekt, Datum, Leistung und Auftrag, Arbeitszeit je Person mit Summe, Material, Fotos vorher und
// nachher, Bestätigung mit der Unterschrift vom Bildschirm (Name, Funktion, Zeitpunkt). Ohne Preise: der Kunde bestätigt
// Arbeiten, Zeiten und Material; verrechnet wird mit der Rechnung. Erzeugt nur die Dokumentbeschreibung (in Node
// testbar); Daten aus core/regie.js → freezeRegie (auch die eingefrorene Beilage zur Rechnung).

import { durationText, REGIE_KINDS } from '../core/regie.js'
import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const hoursNum = (min) => String(Math.round((min / 60) * 100) / 100).replace('.', ',')
const qtyText = (q) => String(q ?? '').replace('.', ',')

/** Zeitpunkt der Unterschrift in Wien: „05.11.2026, 14:32“. */
export function signedAtText(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * report: Bericht aus freezeRegie (Objekt, Personen mit gekürzten Namen, Material, Anzahl Fotos, Unterschrift);
 * photos: [{ image (data:-URL, JPEG oder PNG), phase, label }] – fehlen sie (Beilage zur Rechnung), steht nur die Anzahl
 * da; invoiceNumber: „Beilage zur Rechnung …“.
 */
export function regieDocument({ report: r, photos = [], invoiceNumber = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const th = (list) => list.map((text) => ({ text, style: 'th' }))
  const row = (label, value) => [{ text: label, bold: true, color: colors.ink }, { text: value || '–' }]
  const kind = REGIE_KINDS[r.kind] || 'Sonderleistung'
  const workers = (r.workers || []).filter((w) => w.minutes > 0)
  const total = workers.reduce((s, w) => s + w.minutes, 0)
  const withNames = workers.some((w) => w.name)
  const timed = (w) => !!(w.from && w.to)
  const info = [
    row('Objekt', [r.object?.name, r.object?.address].filter(Boolean).join(', ')),
    row('Datum', day(r.date)),
    row('Leistung', [kind, r.title && r.title !== kind ? r.title : ''].filter(Boolean).join(': ')),
    row('Beauftragt von', [r.orderedBy, r.orderedRole ? `(${r.orderedRole})` : ''].filter(Boolean).join(' ')),
    ...(r.orderRef ? [row('Auftrag / Bestellnummer', r.orderRef)] : []),
    ...(invoiceNumber ? [row('Beilage zur Rechnung', invoiceNumber)] : []),
  ]
  const workBody = workers.map((w, i) => [withNames ? w.name || `Person ${i + 1}` : `Person ${i + 1}`, timed(w) ? `${w.from}–${w.to}` : '–', w.pause ? `${w.pause} Min.` : '', { text: durationText(w.minutes), alignment: 'right' }])
  const photoCount = (r.photos?.vorher || 0) + (r.photos?.nachher || 0)
  const pics = photos.filter((p) => p.image)
  const photoRows = []
  for (let i = 0; i < pics.length; i += 2) {
    const cell = (p) => (p ? { stack: [{ image: p.image, fit: [250, 180] }, { text: p.label || p.phase || '', fontSize: 7.5, color: colors.grey, margin: [0, 2, 0, 0] }], margin: [0, 0, 0, 8] } : { text: '' })
    photoRows.push({ columns: [cell(pics[i]), cell(pics[i + 1])], columnGap: 16, unbreakable: true })
  }
  const sig = r.signature
  const sigBlock = sig
    ? {
        stack: [
          sig.svg ? { svg: sig.svg, width: 180 } : { text: ' ', margin: [0, 34, 0, 0] },
          { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 230, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] },
          { text: [sig.name, sig.role ? `, ${sig.role}` : ''].join(''), margin: [0, 3, 0, 0] },
          { text: `unterschrieben am Gerät am ${signedAtText(sig.at)}`, fontSize: 7.5, color: colors.grey },
        ],
        unbreakable: true,
      }
    : { text: [{ text: 'Ohne Unterschrift abgeschlossen', bold: true }, r.unsigned?.reason ? `: ${r.unsigned.reason}` : '', r.closedAt ? ` (${signedAtText(r.closedAt)})` : ''], margin: [0, 4, 0, 0] }
  const content = [
    ...header({ title: 'Regiebericht', subtitle: `${r.no || ''} · ${day(r.date)}`, brand, logo, colors }),
    { table: { widths: [120, '*'], body: info }, layout: tableLayout(colors), fontSize: 9.5 },
    { text: 'Ausgeführte Arbeiten', style: 'section', margin: [0, 12, 0, 4] },
    { text: r.description || r.title || kind, fontSize: 9.5 },
    { text: 'Arbeitszeit', style: 'section', margin: [0, 12, 0, 4] },
    workers.length
      ? { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 80, 56, 50], body: [th(['Person', 'von–bis', 'Pause', 'Dauer']), ...workBody, [{ text: 'Summe', bold: true }, '', '', { text: durationText(total), bold: true, alignment: 'right' }]] }, layout: tableLayout(colors), fontSize: 9 }
      : { text: 'Keine Arbeitszeit erfasst.', color: colors.grey },
    workers.length ? { text: `${workers.length} ${workers.length === 1 ? 'Person' : 'Personen'}, zusammen ${durationText(total)} Stunden (${hoursNum(total)} Std.)`, margin: [0, 4, 0, 0] } : '',
    { text: 'Material', style: 'section', margin: [0, 12, 0, 4] },
    (r.material || []).length
      ? { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 60, 60], body: [th(['Bezeichnung', 'Menge', 'Einheit']), ...r.material.map((m) => [m.text || '', { text: qtyText(m.qty), alignment: 'right' }, m.unit || ''])] }, layout: tableLayout(colors), fontSize: 9 }
      : { text: 'Kein Material.', color: colors.grey },
    ...(photoCount
      ? [
          { text: 'Fotos', style: 'section', margin: [0, 12, 0, 4] },
          ...photoRows,
          pics.length < photoCount ? { text: `${r.photos.vorher || 0} vorher, ${r.photos.nachher || 0} nachher${pics.length ? '' : ' (liegen beim Regiebericht in unserer Ablage; auf Wunsch senden wir sie gerne)'}`, color: colors.grey, fontSize: 8 } : '',
        ]
      : []),
    { text: 'Bestätigung', style: 'section', margin: [0, 14, 0, 4] },
    { text: 'Die oben angeführten Arbeiten, Arbeitszeiten und Materialien wurden wie beschrieben erbracht und werden bestätigt. Verrechnet wird nach Aufwand laut Vereinbarung bzw. Preisliste.', fontSize: 9, margin: [0, 0, 0, 10] },
    sigBlock,
  ]
  return docShell(content, { brand, colors, createdAt, title: `Regiebericht ${r.no || ''} ${r.object?.name || ''}`.trim() })
}

/** Dateiname: Regiebericht_RB-2026-0001_Wohnanlage-Lehen.pdf */
export const regiePdfName = (no, objectName) => `Regiebericht_${fileSafe(no) || 'Entwurf'}_${fileSafe(objectName) || 'Objekt'}.pdf`
