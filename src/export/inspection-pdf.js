// Kontrollprotokoll als PDF (Aufbau wie im Prüfprotokoll-Tool): Stammdaten,
// je Kapitel die Prüfpunkte, Feststellungen mit Priorität, Fotos mit Bezug
// auf den Prüfpunkt, Abschluss und zwei Unterschriften mit Zeitstempel.

import { formatDate } from '../core/dates.js'
import { checklistItems, findings, PRIOS, quarterOf, RATINGS, suggestOverall } from '../core/inspections.js'
import { docShell, GREY, header, inkColors, tableLayout } from './pdf-parts.js'

const COLOR = { G: '#C00000', M: '#C55A11', R: '#2F5597', OK: '#375623', NA: GREY }
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) : '')

/**
 * images: { items: { '1.6': [dataUrl, …] }, signatures: { inspector, customer } } (bereits geladen)
 * people: Map Mitarbeiter-ID → Name (für Zuständigkeit)
 */
export function inspectionDocument(insp, { checklist, object = {}, customer = '', address = '', images = { items: {}, signatures: {} }, people = new Map(), brand = { name: '', product: '' }, logo = null, createdAt = new Date() } = {}) {
  const colors = inkColors(brand)
  const items = insp.items || {}
  const f = findings(insp, checklist)
  const overall = insp.summary?.overall || suggestOverall(items)
  const kv = (k, v) => [{ text: k, color: GREY }, { text: v || '–', bold: k === 'Ergebnis' }]
  const content = [
    ...header({ title: 'Objektkontrolle', subtitle: `${insp.kind || 'Kontrolle'} · ${quarterOf(insp.date)}`, brand, logo, colors }),
    {
      table: {
        widths: [90, '*'],
        body: [
          kv('Objekt', object.name),
          kv('Adresse', address || object.address),
          kv('Auftraggeber', customer),
          kv('Kontrolle', `${formatDate(insp.date, { year: true })}${insp.time ? `, ${insp.time} Uhr` : ''} · ${quarterOf(insp.date)} · ${insp.kind || ''}`),
          kv('Prüfer/in', insp.inspector),
          kv('Ergebnis', `${overall} · ${f.length} ${f.length === 1 ? 'Feststellung' : 'Feststellungen'}${f.some((x) => x.rating === 'G') ? ' · Gefahr' : ''}`),
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 6],
    },
  ]
  const all = checklistItems(checklist)
  checklist.chapters.forEach((ch, i) => {
    const rows = all.filter((x) => x.chapter === i)
    content.push({ text: `${i + 1} ${ch.title}`, style: 'section' })
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [26, '*', 46, 150],
        body: [
          ['Nr.', 'Prüfpunkt', 'Bewertung', 'Bemerkung'].map((t) => ({ text: t, style: 'th' })),
          ...rows.map((x) => {
            const it = items[x.id] || {}
            return [x.id, x.text, { text: it.rating ? RATINGS[it.rating].short : '–', bold: true, color: COLOR[it.rating] || GREY, alignment: 'center' }, { text: [it.note || '', it.done ? `erledigt ${formatDate(it.done.at.slice(0, 10), { weekday: false })}` : ''].filter(Boolean).join(' · '), fontSize: 7.5 }]
          }),
        ],
      },
      layout: tableLayout(colors),
    })
  })
  content.push({ text: 'Feststellungen', style: 'section' })
  content.push(
    f.length
      ? {
          table: {
            headerRows: 1,
            dontBreakRows: true,
            widths: [26, '*', 30, 62, 120],
            body: [
              ['Nr.', 'Prüfpunkt / Bemerkung', 'Bew.', 'Priorität', 'Zuständig / Frist'].map((t) => ({ text: t, style: 'th' })),
              ...f.map((x) => [x.id, { text: [{ text: x.text }, x.note ? { text: `\n${x.note}`, color: GREY, fontSize: 7.5 } : ''] }, { text: RATINGS[x.rating].short, bold: true, color: COLOR[x.rating], alignment: 'center' }, `${x.prio} ${PRIOS[x.prio] || ''}`, [x.assignee ? people.get(x.assignee) || '' : '', x.due ? `bis ${formatDate(x.due, { weekday: false, year: true })}` : ''].filter(Boolean).join(' · ')]),
            ],
          },
          layout: tableLayout(colors),
        }
      : { text: 'Keine Feststellungen.', color: GREY },
  )
  const photos = Object.entries(images.items || {}).flatMap(([id, list]) => list.filter(Boolean).map((data) => ({ id, data })))
  if (photos.length) {
    content.push({ text: 'Fotos', style: 'section' })
    for (let i = 0; i < photos.length; i += 2) {
      content.push({
        columns: photos.slice(i, i + 2).map((p) => ({ stack: [{ image: p.data, fit: [250, 180] }, { text: `Punkt ${p.id}: ${all.find((x) => x.id === p.id)?.text || ''}`, fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] }] })),
        columnGap: 16,
        margin: [0, 0, 0, 10],
        unbreakable: true,
      })
    }
  }
  content.push({ text: 'Abschluss', style: 'section' })
  content.push({
    table: {
      widths: [90, '*'],
      body: [kv('Gesamtzustand', overall), kv('Zusammenfassung', insp.summary?.text), kv('Nachkontrolle', insp.summary?.followUp ? `Ja${insp.summary.followUpDate ? `, am ${formatDate(insp.summary.followUpDate, { year: true })}` : ''}` : 'Nein')],
    },
    layout: 'noBorders',
  })
  const sig = (key, label) => {
    const s = insp.signatures?.[key]
    const img = images.signatures?.[key]
    return { stack: [img ? { image: img, fit: [220, 70] } : { text: ' ', margin: [0, 40, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: GREY }] }, { text: `${label}${s?.name ? `: ${s.name}` : ''}`, fontSize: 8 }, s?.at ? { text: `digital signiert am ${stamp(s.at)}`, fontSize: 7, color: GREY } : ''] }
  }
  content.push({ columns: [sig('inspector', 'Prüfer/in'), sig('customer', 'Auftraggeber')], columnGap: 40, margin: [0, 16, 0, 0], unbreakable: true })
  return docShell(content, { brand, colors, createdAt, title: `Objektkontrolle ${object.name || ''} ${insp.date}` })
}

/** Dateiname: Objektkontrolle-<Objekt>-JJJJMMTT.pdf */
export const inspectionFileName = (insp, object = {}, safe = (s) => s) => `Objektkontrolle-${safe(object.name || object.address || insp.id)}-${insp.date.replace(/-/g, '')}.pdf`
