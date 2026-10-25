// PDF-Wochenpläne für den Versand an die Mitarbeitenden, im Layout des
// bisherigen Excel-Plans: graublaue Tagesbänder, durchgestrichen = entfällt,
// rot = Vertretung/verschoben, grün = Sonderleistung, gelbe GESAMT-Zeile.
// Dazu Adressen und Hinweise der Objekte (wichtig für Vertretungen).
// Erzeugt nur die Dokumentbeschreibung für pdfmake (in Node testbar);
// gerendert wird im Browser (src/ui/pdf.js).

import { mix, parseColor, readableOn } from '../core/color.js'
import { formatDate, formatHours, isoWeek, isoWeekday, WEEKDAY_LONG } from '../core/dates.js'

const BAND = '#D9E1F2'
const TOTAL = '#FFF2CC'
const RED = '#C00000'
const GREEN = '#00A651'
const GREY = '#595959'
const LINE = '#8EA0BC'

const h = (min) => (min ? formatHours(min) : '')
const signedHours = (min) => `${min > 0 ? '+' : min < 0 ? '−' : '±'}${formatHours(Math.abs(min))}`

function dayNote(day) {
  const parts = []
  if (day.holiday) parts.push(day.holiday.legal ? `Feiertag: ${day.holiday.name}` : day.holiday.name)
  if (day.absence) parts.push(day.absence.type)
  return parts.join(' · ')
}

function lineRow(line, objectsById) {
  const obj = line.inst ? objectsById.get(line.inst.objectId) : null
  const color = line.style === 'changed' ? RED : line.style === 'special' ? GREEN : undefined
  const struck = line.style === 'struck'
  const deco = struck ? { decoration: 'lineThrough', color: GREY } : color ? { color } : {}
  const title = obj ? [{ text: obj.name, bold: true }, line.inst.label ? ` – ${line.inst.label}` : ''] : line.text
  const text = [{ text: title, ...deco }]
  if (obj?.address && !struck) text.push({ text: obj.address, fontSize: 7, color: GREY })
  return [
    { text: line.time.replace(' - ', '–'), bold: true, alignment: 'center', ...deco },
    { stack: text },
    { text: h(line.hours), alignment: 'center' },
    { text: h(line.credited), alignment: 'center' },
    { text: h(line.travel), alignment: 'center' },
    { text: [...line.notes, line.trip?.note && !line.notes.some((n) => n.includes(line.trip.note)) ? `Fahrt: ${line.trip.note}` : ''].filter(Boolean).join(' · '), fontSize: 7.5, color: GREY },
  ]
}

function objectNotes(ts, objectsById, employeesById) {
  const seen = new Map()
  for (const day of ts.days) for (const l of day.lines) if (l.kind === 'work' && l.inst && !seen.has(l.inst.objectId)) seen.set(l.inst.objectId, objectsById.get(l.inst.objectId))
  // Adressen stehen schon in der Tabelle: hier nur Objekte mit Anweisungen oder Schlüsseln
  const items = [...seen.values()]
    .filter((o) => o && (o.instructions || o.keys?.length))
    .map((o) => {
      const keys = (o.keys || []).map((k) => `${k.label}: ${k.holderId ? employeesById.get(k.holderId)?.name || 'Büro' : 'im Büro'}`)
      const detail = [o.instructions, keys.length ? `Schlüssel: ${keys.join(', ')}` : ''].filter(Boolean).join(' · ')
      return { text: [{ text: `${o.name}: `, bold: true }, { text: detail, color: GREY }], margin: [0, 0, 0, 2] }
    })
  return items.length ? [{ text: 'Hinweise zu den Objekten', style: 'section' }, ...items] : []
}

/** Seiten für einen Wochenzettel. */
/** Markenfarbe fürs PDF: Primärfarbe aus config.json (brand.colors), lesbar auf Weiß. */
function inkColors(brand) {
  const primary = parseColor(brand.colors?.primary || '') ? brand.colors.primary : '#1F3A5F'
  const ink = readableOn(primary, '#ffffff', 4.5)
  return { ink, soft: mix('#ffffff', primary, 0.1), line: parseColor(brand.colors?.primary || '') ? mix('#ffffff', primary, 0.45) : LINE }
}

function timesheetPages(entry, { objectsById, employeesById, brand, status, contact, logo, colors }) {
  const { ts, account } = entry
  const emp = ts.employee
  const { year, week } = isoWeek(ts.monday)
  const body = [
    [
      { text: 'Zeit', style: 'th', alignment: 'center' },
      { text: 'Objekt / Leistung', style: 'th' },
      { text: 'Std.', style: 'th', alignment: 'center' },
      { text: 'Arbeitszeit', style: 'th', alignment: 'center' },
      { text: 'Fahrzeit', style: 'th', alignment: 'center' },
      { text: 'Hinweis', style: 'th' },
    ],
  ]
  for (const day of ts.days) {
    const note = dayNote(day)
    body.push([
      { text: `${WEEKDAY_LONG[isoWeekday(day.date) - 1]} ${formatDate(day.date, { weekday: false })}`, bold: true, fillColor: BAND, noWrap: true },
      { text: note, bold: true, color: RED, fillColor: BAND },
      { text: '', fillColor: BAND },
      { text: '', fillColor: BAND },
      { text: '', fillColor: BAND },
      { text: day.total ? `Tag gesamt: ${formatHours(day.total)} h` : '', fillColor: BAND, fontSize: 7.5, bold: true },
    ])
    if (!day.lines.length) body.push(['', { text: day.absence ? day.absence.type : 'frei', color: GREY, italics: true }, '', '', '', ''])
    for (const l of day.lines) body.push(lineRow(l, objectsById))
  }
  const t = ts.totals
  body.push([
    { text: 'GESAMT', bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: `Saldo ${signedHours(t.saldo)} h`, bold: true, fillColor: TOTAL },
    { text: formatHours(t.soll), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: formatHours(t.credited), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: formatHours(t.travel), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: `Soll ${formatHours(t.soll)} h · Ist ${formatHours(t.ist)} h`, bold: true, fillColor: TOTAL, fontSize: 8 },
  ])

  const meta = [emp.personnelNo ? `Personalnr. ${emp.personnelNo}` : '', emp.type, emp.weeklyHours ? `${formatHours(emp.weeklyHours * 60)} h/Woche` : '', emp.team].filter(Boolean).join(' · ')
  return [
    {
      columns: [
        logo ? { stack: [logo.svg ? { svg: logo.svg, width: logo.width || 120 } : { image: logo.image, fit: [130, 52] }, { text: brand.product || 'Dienstplan', color: GREY, margin: [0, 2, 0, 0] }] } : { stack: [{ text: brand.name, style: 'brand' }, { text: brand.product || 'Dienstplan', color: GREY }] },
        { stack: [{ text: `KW ${week} / ${year}`, style: 'kw', alignment: 'right' }, { text: `${formatDate(ts.monday, { weekday: false })} – ${formatDate(ts.sunday, { weekday: false, year: true })}`, alignment: 'right', color: GREY }] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 1.5, lineColor: colors.ink }], margin: [0, 0, 0, 6] },
    { text: [{ text: emp.name, style: 'name' }, status ? { text: `   ${status}`, color: status === 'Entwurf' ? RED : GREY, fontSize: 9 } : ''] },
    { text: meta, color: GREY, margin: [0, 1, 0, 6] },
    {
      table: { headerRows: 1, dontBreakRows: true, widths: [66, '*', 26, 44, 36, 128], body },
      layout: { hLineColor: () => colors.line, vLineColor: () => colors.line, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 2, paddingBottom: () => 2 },
    },
    account !== undefined && account !== null ? { text: `Zeitkonto nach dieser Woche: ${signedHours(account)} h`, alignment: 'right', bold: true, margin: [0, 5, 0, 0] } : '',
    { text: [{ text: 'durchgestrichen', decoration: 'lineThrough' }, ' = entfällt (Feiertag, Urlaub: angerechnet) · ', { text: 'rot', color: RED }, ' = Vertretung oder verschoben · ', { text: 'grün', color: GREEN }, ' = Sonderleistung'], fontSize: 7, color: GREY, margin: [0, 4, 0, 0] },
    ...objectNotes(ts, objectsById, employeesById),
    contact ? { text: contact, fontSize: 8, color: GREY, margin: [0, 8, 0, 0] } : '',
  ]
}

/**
 * Dokumentbeschreibung (pdfmake) für einen oder mehrere Wochenzettel,
 * je Person eine neue Seite. entries = [{ ts, account? }]
 * logo (optional, Logo für helle Hintergründe): { svg } oder { image: dataUrl }
 */
export function timesheetDocument(entries, { objects = [], employees = [], brand = { name: '', product: '' }, status = '', contact = '', createdAt = new Date(), logo = null } = {}) {
  const colors = inkColors(brand)
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const employeesById = new Map(employees.map((e) => [e.id, e]))
  const content = []
  entries.forEach((entry, i) => {
    const pages = timesheetPages(entry, { objectsById, employeesById, brand, status, contact, logo, colors })
    if (i > 0) pages[0] = { ...pages[0], pageBreak: 'before' }
    content.push(...pages)
  })
  const created = createdAt.toLocaleDateString('de-AT')
  const single = entries.length === 1 ? entries[0].ts : null
  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 40],
    info: { title: single ? `Wochenplan KW ${isoWeek(single.monday).week} – ${single.employee.name}` : 'Wochenpläne', author: brand.name, creator: brand.product || 'Dienstplan' },
    content,
    footer: (page, pages) => ({
      columns: [
        { text: `${brand.name}${brand.name ? ' · ' : ''}erstellt am ${created}`, fontSize: 7.5, color: GREY },
        { text: `Seite ${page} von ${pages}`, alignment: 'right', fontSize: 7.5, color: GREY },
      ],
      margin: [36, 14, 36, 0],
    }),
    defaultStyle: { fontSize: 8.5, lineHeight: 1.05 },
    styles: {
      brand: { fontSize: 14, bold: true, color: colors.ink },
      kw: { fontSize: 16, bold: true, color: colors.ink },
      name: { fontSize: 15, bold: true },
      th: { bold: true, fontSize: 8, color: colors.ink, fillColor: colors.soft },
      section: { fontSize: 9, bold: true, margin: [0, 8, 0, 3], color: colors.ink },
    },
  }
}

/** Dateiname für den PDF-Wochenplan einer Person. */
export function pdfFileName(monday, name) {
  const { year, week } = isoWeek(monday)
  return `Wochenplan_KW${String(week).padStart(2, '0')}_${year}_${String(name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')}.pdf`
}
