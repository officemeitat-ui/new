// Bericht einer Qualitätsmessung für den Kunden (pdfmake): Ergebnis „erfüllt / nicht erfüllt“, Qualitätskennzahl mit
// Zielwert, Los, Stichprobe und Qualitätsniveau, je Raum Ergebnis und Mängel (Prüfobjekt, Fehlerarten, Notiz), Verlauf
// der letzten Messungen, Fotos der Mängel, Unterschriften. Gleicher Kopf und Fuß wie Anlagenliste, Leistungsnachweis
// und Reklamation (pdf-parts.js).

import { formatDate } from '../core/dates.js'
import { resultOf, roomResult } from '../core/qualitaet.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const pct = (v) => (v === null || v === undefined ? '–' : `${String(v.toFixed ? v.toFixed(1) : v).replace('.', ',')} %`)
/** AQL wie in der Norm geschrieben: 0,65 · 1,0 · 4,0 · 10. */
export const aqlText = (v) => (Number(v) >= 10 ? String(Number(v)) : Number(v).toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 2 }))
const RED = '#b3261e'
const GREEN = '#1d6b3a'

const sigCell = (svg, label, colors) => ({
  stack: [svg ? { svg, width: 170 } : { text: ' ', margin: [0, 34, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 200, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: label, fontSize: 8, color: colors.grey, margin: [0, 2, 0, 0] }],
})

/** Text zum Qualitätsniveau: „AQL 4,0“ oder „vereinbart: höchstens 2 Räume“. */
export const levelText = (plan) => (!plan ? '' : plan.accept !== null && plan.accept !== undefined ? `vereinbart: höchstens ${plan.accept} ${plan.accept === 1 ? 'Raum' : 'Räume'} nicht in Ordnung` : `AQL ${aqlText(plan.aql)}`)

/**
 * m: abgeschlossene Messung; history: frühere Messungen des Objekts (älteste zuerst, ohne m);
 * defectNames: { id: Name } der Fehlerarten; photos: Map Pfad → data-URL (nur ladbare Bilder).
 */
export function qualitaetDocument({ m, object = {}, history = [], defectNames = {}, photos = new Map(), brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const r = resultOf(m)
  const plan = m.plan || {}
  const th = (list) => list.map((text) => ({ text, style: 'th' }))
  const verdict = r.ok === null ? 'ohne Bewertung (keine Annahmezahl)' : r.ok ? 'erfüllt' : 'nicht erfüllt'
  const rows = (m.rooms || []).map((room) => {
    const x = roomResult(room, m.roomLimit)
    const defects = room.items
      .filter((it) => it.state === 'mangel')
      .map((it) => `${it.name}: ${[...(it.defects || []).map((id) => defectNames[id] || id), it.note].filter(Boolean).join(', ') || 'Mangel'}`)
    return [
      { text: room.label, bold: true },
      room.group || '',
      { text: x.rated ? (x.ok ? 'in Ordnung' : 'nicht in Ordnung') : 'nicht bewertet', color: x.rated && !x.ok ? RED : undefined },
      { text: x.rated ? `${x.points} / ${x.max}` : '–', alignment: 'right' },
      defects.length ? defects.join('\n') : { text: '–', color: colors.grey },
    ]
  })
  const past = [...history, m].slice(-6)
  const trend = past.map((x) => {
    const xr = resultOf(x)
    return [day(x.date), { text: pct(xr.score), alignment: 'right' }, { text: xr.ok === null ? '–' : xr.ok ? 'erfüllt' : 'nicht erfüllt', color: xr.ok === false ? RED : undefined }, x.recheckOf ? 'Nachkontrolle' : '']
  })
  const content = [
    ...header({ title: 'Qualitätsmessung', subtitle: `${object.name || ''} · ${day(m.date)}`, brand, logo, colors }),
    { text: [{ text: 'Objekt: ', bold: true }, [object.name, object.address].filter(Boolean).join(', ')], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Datum: ', bold: true }, day(m.date), m.by ? `   ·   durchgeführt von ${m.by}${brand.name ? ` (${brand.name})` : ''}` : '', m.recheckOf ? '   ·   Nachkontrolle' : ''], margin: [0, 0, 0, 10] },
    {
      table: {
        widths: ['*', '*', '*'],
        body: [
          [
            { stack: [{ text: 'Ergebnis', color: colors.grey, fontSize: 8 }, { text: verdict, bold: true, fontSize: 14, color: r.ok === false ? RED : r.ok ? GREEN : undefined }] },
            { stack: [{ text: 'Qualitätskennzahl', color: colors.grey, fontSize: 8 }, { text: pct(r.score), bold: true, fontSize: 14 }, { text: `Zielwert ${pct(r.target)}`, color: colors.grey, fontSize: 8 }] },
            { stack: [{ text: 'Räume nicht in Ordnung', color: colors.grey, fontSize: 8 }, { text: `${r.bad} von ${r.rooms}`, bold: true, fontSize: 14 }, { text: r.ac === null ? '' : `zulässig: ${r.ac}`, color: colors.grey, fontSize: 8 }] },
          ],
        ],
      },
      layout: tableLayout(colors),
    },
    { text: `Los ${m.lot} Räume · Stichprobe ${m.rooms.length} Räume${plan.full ? ' (alle)' : ''} · ${levelText(plan)} · ${r.itemsOk} von ${r.items} Prüfobjekten ohne Mangel`, color: colors.grey, margin: [0, 4, 0, 0] },
    { text: 'Räume der Stichprobe', style: 'section', margin: [0, 14, 0, 4] },
    { table: { headerRows: 1, dontBreakRows: true, widths: [80, 64, 58, 38, '*'], body: [th(['Raum', 'Raumgruppe', 'Ergebnis', 'Punkte', 'Mängel']), ...rows] }, layout: tableLayout(colors), fontSize: 8 },
  ]
  if (m.note) content.push({ text: 'Bemerkung', style: 'section', margin: [0, 12, 0, 4] }, { text: m.note })
  // KI-Fotoprüfung: Vorschläge, die die Person übernommen hat (Transparenz)
  const byKi = m.rooms.reduce((n, room) => n + (room.items || []).filter((it) => it.ki).length, 0)
  if (byKi) content.push({ text: `${byKi} ${byKi === 1 ? 'Bewertung' : 'Bewertungen'} nach einem Vorschlag der KI-Fotoprüfung übernommen und von ${m.by || 'der prüfenden Person'} bestätigt.`, fontSize: 8, color: colors.grey, margin: [0, 6, 0, 0] })
  if (past.length > 1) content.push({ text: 'Verlauf der letzten Messungen', style: 'section', margin: [0, 14, 0, 4] }, { table: { headerRows: 1, widths: [60, 60, 70, '*'], body: [th(['Datum', 'Kennzahl', 'Ergebnis', '']), ...trend] }, layout: tableLayout(colors), fontSize: 8 })
  content.push({ columns: [sigCell('', `Für ${brand.name || 'den Auftragnehmer'}: ${m.by || ''}`, colors), sigCell(m.signature?.svg || '', `Kunde: ${m.signature?.name || m.customer || ''}`, colors)], columnGap: 40, margin: [0, 26, 0, 0], unbreakable: true })
  content.push({
    text: `Messverfahren in Anlehnung an EN 13549: zufällige Stichprobe von Räumen, Umfang und zulässige Zahl in Anlehnung an ISO 2859-1 wie vereinbart. Ein Raum ist nicht in Ordnung ab ${m.roomLimit ?? 1} ${Number(m.roomLimit ?? 1) === 1 ? 'Fehlerpunkt' : 'Fehlerpunkten'} (Summe der Gewichte der Prüfobjekte mit Mangel). Die Qualitätskennzahl ist der gewichtete Anteil der Prüfobjekte ohne Mangel.`,
    fontSize: 7.5,
    color: colors.grey,
    margin: [0, 12, 0, 0],
  })
  // Fotos der Mängel: zwei nebeneinander
  const pics = (m.rooms || []).flatMap((room) => room.items.filter((it) => it.state === 'mangel' && it.photo?.path && photos.get(it.photo.path)).map((it) => ({ room, it, url: photos.get(it.photo.path) })))
  if (pics.length) {
    content.push({ text: 'Fotos der Mängel', style: 'section', pageBreak: 'before' })
    const cells = pics.map(({ room, it, url }) => ({ stack: [{ image: url, fit: [250, 190] }, { text: `${room.label} · ${it.name}`, fontSize: 7.5, color: colors.grey, margin: [0, 2, 0, 6] }] }))
    for (let i = 0; i < cells.length; i += 2) content.push({ columns: [cells[i], cells[i + 1] || { text: '' }], columnGap: 12, unbreakable: true })
  }
  return docShell(content, { brand, colors, createdAt, title: `Qualitätsmessung ${object.name || ''} ${day(m.date)}` })
}

export const qualitaetPdfName = (objectName, date) => `Qualitaetsmessung_${fileSafe(objectName) || 'Objekt'}_${date}.pdf`
