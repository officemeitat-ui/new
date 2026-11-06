// PDF-Wochenpläne für den Versand an die Mitarbeitenden, im Layout des
// bisherigen Excel-Plans: graublaue Tagesbänder, durchgestrichen = entfällt,
// rot = Vertretung/verschoben, grün = Sonderleistung, gelbe Zeile „Gesamt“.
// Dazu Adressen und Hinweise der Objekte (wichtig für Vertretungen).
// Je Person in ihrer Sprache (employees[].lang, Deutsch Standard): Überschriften,
// Spalten, Wochentage, Summen, Legende und feste Hinweise aus export/wochenplan-texte.js;
// Objekt- und Leistungsnamen bleiben, wie sie sind.
// Erzeugt nur die Dokumentbeschreibung für pdfmake (in Node testbar);
// gerendert wird im Browser (src/ui/pdf.js).

import { mix, parseColor, readableOn } from '../core/color.js'
import { isoWeek, todayISO } from '../core/dates.js'
import { fileSafe } from '../core/filename.js'
import { langOf } from '../core/sprachen.js'
import { planTexts } from './wochenplan-texte.js'

const BAND = '#D9E1F2'
const TOTAL = '#FFF2CC'
const RED = '#C00000'
const GREEN = '#00A651'
const GREY = '#595959'
const LINE = '#8EA0BC'

const signedHours = (min, tx) => `${min > 0 ? '+' : min < 0 ? '−' : '±'}${tx.hours(Math.abs(min))}`

function dayNote(day, tx) {
  const parts = []
  if (day.holiday) parts.push(day.holiday.legal ? tx.t('feiertag_gesetzlich', { name: day.holiday.name }) : day.holiday.name)
  if (day.absence) parts.push(tx.absence(day.absence.type))
  return parts.join(' · ')
}

function lineRow(line, objectsById, colors, tx) {
  const h = (min) => (min ? tx.hours(min) : '')
  const obj = line.inst ? objectsById.get(line.inst.objectId) : null
  const color = line.style === 'changed' ? RED : line.style === 'special' ? colors.special : undefined
  const struck = line.style === 'struck'
  const deco = struck ? { decoration: 'lineThrough', color: colors.grey } : color ? { color } : {}
  const title = obj ? [{ text: obj.name, bold: true }, line.inst.label ? ` – ${line.inst.label}` : ''] : line.text
  const text = [{ text: title, ...deco }]
  if (obj?.address && !struck) text.push({ text: obj.address, fontSize: 7, color: colors.grey })
  return [
    { text: line.time.replace(' - ', '–'), bold: true, alignment: 'center', ...deco },
    { stack: text },
    { text: h(line.hours), alignment: 'center' },
    { text: h(line.credited), alignment: 'center' },
    { text: h(line.travel), alignment: 'center' },
    { text: [...line.notes.map(tx.note), line.trip?.note && !line.notes.some((n) => n.includes(line.trip.note)) ? tx.t('notiz_fahrt_text', { text: line.trip.note }) : ''].filter(Boolean).join(' · '), fontSize: 7.5, color: colors.grey },
  ]
}

function objectNotes(ts, objectsById, employeesById, colors, tx) {
  const seen = new Map()
  for (const day of ts.days) for (const l of day.lines) if (l.kind === 'work' && l.inst && !seen.has(l.inst.objectId)) seen.set(l.inst.objectId, objectsById.get(l.inst.objectId))
  // Adressen stehen schon in der Tabelle: hier nur Objekte mit Anweisungen oder Schlüsseln
  const items = [...seen.values()]
    .filter((o) => o && (o.instructions || o.keys?.length))
    .map((o) => {
      const keys = (o.keys || []).map((k) => `${k.label}: ${k.holderId ? employeesById.get(k.holderId)?.name || tx.t('buero') : tx.t('schluessel_buero')}`)
      const detail = [o.instructions ? tx.objectInfo(o) : '', keys.length ? tx.t('schluessel', { text: keys.join(', ') }) : ''].filter(Boolean).join(' · ')
      return { text: [{ text: `${o.name}: `, bold: true }, { text: detail, color: colors.grey }], margin: [0, 0, 0, 2] }
    })
  return items.length ? [{ text: tx.t('hinweise_objekte'), style: 'section' }, ...items] : []
}

/** Stand-Vermerk: Text (wie übergeben) oder { kind: 'entwurf' | 'veroeffentlicht' | 'korrigiert', date } in der Sprache. */
function statusText(status, tx) {
  if (!status || typeof status === 'string') return { text: status || '', draft: status === 'Entwurf' }
  if (status.kind === 'entwurf') return { text: tx.t('entwurf'), draft: true }
  return { text: tx.t(status.kind === 'korrigiert' ? 'korrigiert' : 'veroeffentlicht', { datum: tx.lang === 'de' ? germanDate(status.date) : tx.date(status.date, { year: true }) }), draft: false }
}
/** 6.11.2026 (wie toLocaleDateString('de-AT')) */
const germanDate = (iso) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : '')

/** Seiten für einen Wochenzettel. */
/**
 * Farben fürs PDF aus den Hausfarben (config.json, brand.colors): Schrift und Tagesbänder
 * in der Primärfarbe, Sonderleistungen in der Akzentfarbe (beide lesbar auf Weiß).
 * Ohne Hausfarben das Layout des früheren Excel-Plans. Rot (Vertretung) und die gelbe
 * Summenzeile bleiben immer gleich.
 */
const color = (c) => (parseColor(c || '') ? c : null)

export function inkColors(brand) {
  const own = parseColor(brand.colors?.primary || '')
  const primary = own ? brand.colors.primary : '#1F3A5F'
  const ink = readableOn(primary, '#ffffff', 4.5)
  const accent = parseColor(brand.colors?.accent || '') ? brand.colors.accent : null
  return {
    ink,
    soft: mix('#ffffff', primary, 0.1),
    line: own ? mix('#ffffff', primary, 0.45) : LINE,
    band: own ? mix('#ffffff', primary, 0.13) : BAND,
    // eigene Töne aus dem Corporate Design gehen vor (z. B. Cleanos: Grün dunkel, Text leise)
    special: color(brand.colors?.accentText) || (accent ? readableOn(accent, '#ffffff', 4.5) : GREEN),
    grey: color(brand.colors?.muted) || (own ? readableOn(mix('#5f6b75', primary, 0.12), '#ffffff', 4.5) : GREY),
  }
}

function timesheetPages(entry, { objectsById, employeesById, brand, status, contact, logo, colors, tx }) {
  const { ts, account } = entry
  const emp = ts.employee
  const { year, week } = isoWeek(ts.monday)
  const hours = (min) => tx.hours(min)
  const body = [
    [
      { text: tx.t('sp_zeit'), style: 'th', alignment: 'center' },
      { text: tx.t('sp_objekt'), style: 'th' },
      { text: tx.t('sp_std'), style: 'th', alignment: 'center' },
      { text: tx.t('sp_arbeitszeit'), style: 'th', alignment: 'center' },
      { text: tx.t('sp_fahrzeit'), style: 'th', alignment: 'center' },
      { text: tx.t('sp_hinweis'), style: 'th' },
    ],
  ]
  for (const day of ts.days) {
    const note = dayNote(day, tx)
    body.push([
      { text: tx.date(day.date, { weekday: true }), bold: true, fillColor: colors.band, noWrap: true },
      { text: note, bold: true, color: RED, fillColor: colors.band },
      { text: '', fillColor: colors.band },
      { text: '', fillColor: colors.band },
      { text: '', fillColor: colors.band },
      { text: day.total ? tx.t('tag_gesamt', { h: hours(day.total) }) : '', fillColor: colors.band, fontSize: 7.5, bold: true },
    ])
    if (!day.lines.length) body.push(['', { text: day.absence ? tx.absence(day.absence.type) : tx.t('frei'), color: colors.grey, italics: true }, '', '', '', ''])
    for (const l of day.lines) body.push(lineRow(l, objectsById, colors, tx))
  }
  const t = ts.totals
  body.push([
    { text: tx.t('gesamt'), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: tx.t('saldo', { h: signedHours(t.saldo, tx) }), bold: true, fillColor: TOTAL },
    { text: hours(t.soll), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: hours(t.credited), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: hours(t.travel), bold: true, fillColor: TOTAL, alignment: 'center' },
    { text: tx.t('soll_ist', { soll: hours(t.soll), ist: hours(t.ist) }), bold: true, fillColor: TOTAL, fontSize: 8 },
  ])

  const meta = [emp.personnelNo ? tx.t('personalnr', { nr: emp.personnelNo }) : '', tx.employment(emp.type), emp.weeklyHours ? tx.t('je_woche', { h: hours(emp.weeklyHours * 60) }) : '', emp.team].filter(Boolean).join(' · ')
  const st = statusText(status, tx)
  return [
    {
      columns: [
        logo ? { stack: [logo.svg ? { svg: logo.svg, width: logo.width || 120 } : { image: logo.image, fit: [130, 52] }, { text: brand.product || 'Dienstplan', color: colors.grey, margin: [0, 2, 0, 0] }] } : { stack: [{ text: brand.name, style: 'brand' }, { text: brand.product || 'Dienstplan', color: colors.grey }] },
        { stack: [{ text: `${tx.t('kw', { kw: week })} / ${year}`, style: 'kw', alignment: 'right' }, { text: `${tx.date(ts.monday)} – ${tx.date(ts.sunday, { year: true })}`, alignment: 'right', color: colors.grey }] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 1.5, lineColor: colors.ink }], margin: [0, 0, 0, 6] },
    { text: [{ text: emp.name, style: 'name' }, st.text ? { text: `   ${st.text}`, color: st.draft ? RED : colors.grey, fontSize: 9 } : ''] },
    { text: meta, color: colors.grey, margin: [0, 1, 0, 6] },
    {
      table: { headerRows: 1, dontBreakRows: true, widths: [66, '*', 26, 44, 36, 128], body },
      layout: { hLineColor: () => colors.line, vLineColor: () => colors.line, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 2, paddingBottom: () => 2 },
    },
    account !== undefined && account !== null ? { text: tx.t('konto_woche', { h: signedHours(account, tx) }), alignment: 'right', bold: true, margin: [0, 5, 0, 0] } : '',
    { text: [{ text: tx.t('durchgestrichen'), decoration: 'lineThrough' }, ` = ${tx.t('legende_entfaellt')} · `, { text: tx.t('rot'), color: RED }, ` = ${tx.t('legende_vertretung')} · `, { text: tx.t('gruen'), color: colors.special }, ` = ${tx.t('legende_sonder')}`], fontSize: 7, color: colors.grey, margin: [0, 4, 0, 0] },
    ...objectNotes(ts, objectsById, employeesById, colors, tx),
    contact ? { text: contact, fontSize: 8, color: colors.grey, margin: [0, 8, 0, 0] } : '',
  ]
}

/**
 * Dokumentbeschreibung (pdfmake) für einen oder mehrere Wochenzettel,
 * je Person eine neue Seite in ihrer Sprache. entries = [{ ts, account?, lang? }] (lang: sonst
 * employees[].lang der Person, leer = Deutsch). status: Text oder { kind, date } (in der Sprache).
 * logo (optional, Logo für helle Hintergründe): { svg } oder { image: dataUrl }
 */
export function timesheetDocument(entries, { objects = [], employees = [], brand = { name: '', product: '' }, status = '', contact = '', createdAt = new Date(), logo = null } = {}) {
  const colors = inkColors(brand)
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const employeesById = new Map(employees.map((e) => [e.id, e]))
  const langs = entries.map((entry) => entry.lang || langOf(entry.ts.employee))
  const content = []
  entries.forEach((entry, i) => {
    const pages = timesheetPages(entry, { objectsById, employeesById, brand, status, contact, logo, colors, tx: planTexts(langs[i]) })
    if (i > 0) pages[0] = { ...pages[0], pageBreak: 'before' }
    content.push(...pages)
  })
  // Fußzeile gilt für alle Seiten: in der Sprache, wenn alle Personen dieselbe haben, sonst Deutsch
  const tx = planTexts(langs.length && langs.every((l) => l === langs[0]) ? langs[0] : 'de')
  const created = tx.lang === 'de' ? createdAt.toLocaleDateString('de-AT') : tx.date(todayISO(createdAt), { year: true })
  const single = entries.length === 1 ? entries[0].ts : null
  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 40],
    info: { title: single ? `${tx.t('wochenplan')} ${tx.t('kw', { kw: isoWeek(single.monday).week })} – ${single.employee.name}` : 'Wochenpläne', author: brand.name, creator: brand.product || 'Dienstplan' },
    content,
    footer: (page, pages) => ({
      columns: [
        { text: `${brand.name}${brand.name ? ' · ' : ''}${tx.t('erstellt', { datum: created })}`, fontSize: 7.5, color: colors.grey },
        { text: tx.t('seite', { n: page, m: pages }), alignment: 'right', fontSize: 7.5, color: colors.grey },
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
  return `Wochenplan_KW${String(week).padStart(2, '0')}_${year}_${fileSafe(name)}.pdf`
}
