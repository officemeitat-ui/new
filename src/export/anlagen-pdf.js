// Anlagenliste / Prüfnachweis je Objekt als PDF für die Hausverwaltung: Anlagen mit Standort, Intervall, letzter
// Prüfung und nächster Fälligkeit, offene Mängel, Prüfungen der letzten 12 Monate. Ohne Namen der eigenen
// Mitarbeitenden (dort steht die Firma), Fremdfirmen mit Namen. Gleicher Kopf und Fuß wie Leistungsnachweis und
// Reklamation (pdf-parts.js).

import { addMonths, CHECK_KINDS, RESULTS, STATES } from '../core/anlagen.js'
import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const RED = '#b3261e'
const AMBER = '#8a5300'

/**
 * rows: Zeilen aus anlagenRows (nur dieses Objekt); checks: alle Prüfungen der Datei; today: Stand.
 * staff: wie die eigenen Leute im PDF heißen (Standard: Firmenname).
 */
export function anlagenDocument({ object = {}, rows = [], checks = [], today, brand = {}, logo = null, createdAt = new Date(), staff = '' }) {
  const colors = inkColors(brand)
  const own = staff || brand.name || 'eigenes Personal'
  const who = (c) => (c ? (c.external ? c.by || 'Fremdfirma' : own) : '')
  const active = rows.filter((r) => r.state !== 'inaktiv')
  const name = (r) => r.type?.name || 'Anlage'
  const th = (list) => list.map((text) => ({ text, style: 'th' }))
  const nextCell = (r) => {
    if (r.unknown && !r.next) return { text: 'noch keine Prüfung', color: AMBER }
    const text = `${day(r.next)}${r.state === 'ueberfaellig' ? '\nüberfällig' : r.state === 'faellig' ? '\nfällig' : ''}`
    return { text, color: r.state === 'ueberfaellig' ? RED : r.state === 'faellig' ? AMBER : undefined }
  }
  const body = active.map((r) => [
    { stack: [{ text: name(r), bold: true }, ...(r.item.maker || r.item.serial ? [{ text: [r.item.maker, r.item.serial ? `Nr. ${r.item.serial}` : ''].filter(Boolean).join(', '), color: colors.grey, fontSize: 7.5 }] : [])] },
    r.item.label || '',
    { text: String(r.item.count || 1), alignment: 'right' },
    r.dues.map((d) => `${d.months ? `${d.months} Mon.` : '–'}${d.kind === 'operativ' ? ' (operativ)' : ''}`).join('\n'),
    day(r.last?.date),
    r.last ? { text: `${RESULTS[r.last.result] || ''}${r.last.resolved ? ', behoben' : ''}`, color: r.last.result === 'ok' || r.last.resolved ? undefined : RED } : '–',
    nextCell(r),
    who(r.last),
  ])
  const defects = active.flatMap((r) => r.defects.map((c) => ({ r, c }))).sort((a, b) => a.c.date.localeCompare(b.c.date))
  const since = addMonths(today, -12)
  const itemOf = new Map(rows.map((r) => [r.item.id, r]))
  const history = checks
    .filter((c) => itemOf.has(c.itemId) && c.date >= since && c.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((c) => {
      const r = itemOf.get(c.itemId)
      return [day(c.date), `${name(r)}${r.item.label ? `, ${r.item.label}` : ''}`, CHECK_KINDS[c.kind] || CHECK_KINDS.haupt, { text: `${RESULTS[c.result] || ''}${c.defects ? `: ${c.defects}` : ''}${c.resolved ? ` (behoben ${day(c.resolved.date)})` : ''}`, color: c.result === 'ok' || c.resolved ? undefined : RED }, who(c), c.report ? 'Prüfbericht' : '']
    })
  const summary = [
    `${active.length} ${active.length === 1 ? 'Anlage' : 'Anlagen'}`,
    active.filter((r) => r.state === 'ueberfaellig').length ? `${active.filter((r) => r.state === 'ueberfaellig').length} überfällig` : '',
    active.filter((r) => r.state === 'faellig').length ? `${active.filter((r) => r.state === 'faellig').length} demnächst fällig` : '',
    defects.length ? `${defects.length} offene ${defects.length === 1 ? 'Mangel' : 'Mängel'}` : 'keine offenen Mängel',
  ].filter(Boolean)
  const content = [
    ...header({ title: 'Anlagen und Prüfungen', subtitle: `${object.name || ''} · Stand ${day(today)}`, brand, logo, colors }),
    { text: [{ text: 'Objekt: ', bold: true }, [object.name, object.address].filter(Boolean).join(', ')], margin: [0, 0, 0, 2] },
    { text: [{ text: 'Stand: ', bold: true }, day(today), '   ·   ', summary.join(' · ')], margin: [0, 0, 0, 10] },
    active.length
      ? { table: { headerRows: 1, widths: ['*', '*', 30, 52, 52, 48, 56, 66], body: [th(['Anlage', 'Standort', 'Anzahl', 'Intervall', 'zuletzt geprüft', 'Ergebnis', 'nächste Prüfung', 'geprüft von']), ...body] }, layout: tableLayout(colors), fontSize: 8 }
      : { text: 'Für dieses Objekt sind keine Anlagen eingetragen.', color: colors.grey },
    { text: 'Offene Mängel', style: 'section', margin: [0, 14, 0, 4] },
    defects.length
      ? { table: { headerRows: 1, widths: [56, '*', '*', 60], body: [th(['seit', 'Anlage', 'Mangel', 'Zustand']), ...defects.map(({ r, c }) => [day(c.date), `${name(r)}${r.item.label ? `, ${r.item.label}` : ''}`, c.defects || RESULTS[c.result], { text: RESULTS[c.result], color: RED }])] }, layout: tableLayout(colors), fontSize: 8 }
      : { text: 'Keine offenen Mängel.', color: colors.grey },
    { text: 'Prüfungen der letzten 12 Monate', style: 'section', margin: [0, 14, 0, 4] },
    history.length
      ? { table: { headerRows: 1, widths: [52, '*', 62, '*', 66, 46], body: [th(['Datum', 'Anlage', 'Art', 'Ergebnis', 'geprüft von', 'Nachweis']), ...history] }, layout: tableLayout(colors), fontSize: 8 }
      : { text: 'Keine Prüfung in diesem Zeitraum.', color: colors.grey },
    { text: 'Intervalle laut Vereinbarung, Herstellerangabe bzw. Vorgabe der Prüfstelle. Prüfberichte von Fremdfirmen liegen bei uns auf und werden auf Wunsch übermittelt.', fontSize: 7.5, color: colors.grey, margin: [0, 10, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Anlagen und Prüfungen ${object.name || ''}` })
}

export const anlagenPdfName = (objectName, date) => `Anlagen_${fileSafe(objectName) || 'Objekt'}_${date}.pdf`

/** Zustand als kurzer Text (für CSV und Hinweise). */
export const stateText = (r) => (r.state === 'faellig' && r.unknown && !r.next ? 'noch keine Prüfung' : STATES[r.state] || '')
