// PDFs des Arbeitsschutzes (pdfmake) mit Kopf und Logo wie Anlagenliste und Regiebericht (pdf-parts.js):
//   Arbeitsstoffverzeichnis (quer): Produkt, Hersteller, Verwendung, Piktogramme, Signalwort, H- und P-Sätze,
//     Sicherheitsdatenblatt (Fassung), Menge je Lager, Objekte
//   Betriebsanweisung zum Aushängen: Abschnitte mit Piktogrammen, Stand, Freigabe (ohne Freigabe als Entwurf markiert)
//   Sicherheits- und Gesundheitsschutzdokument: Evaluierung je Arbeitsbereich mit Gefahren, Bewertung, Maßnahmen,
//     Verantwortlichen, Fristen und Status, dazu Verweis auf Arbeitsstoffverzeichnis und Betriebsanweisungen
// Erzeugt nur die Dokumentbeschreibung (in Node testbar).

import { BA_KINDS, codesOf, GHS, LIKELIHOOD, MEASURE_STATES, measureState, REVIEW_STATES, riskClass, riskOf, SDB_STATES, SEVERITY, SIGNALS } from '../core/arbeitsschutz.js'
import { BA_SECTIONS } from '../core/arbeitsschutz-vorlagen.js'
import { formatDate } from '../core/dates.js'
import { ghsSvg } from './ghs.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const qty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000).replace('.', ',')
const RED = '#b3261e'
const AMBER = '#8a5300'
const th = (list) => list.map((text) => ({ text, style: 'th' }))
const pictos = (ids = [], width = 18) => {
  const list = ids.filter((id) => GHS.some((g) => g.id === id))
  if (!list.length) return { text: '–' }
  return { stack: [{ columns: list.map((id) => ({ svg: ghsSvg(id), width, height: width })), columnGap: 2 }, { text: list.join(' '), fontSize: 6, color: '#555555', margin: [0, 1, 0, 0] }] }
}
/** Kopf quer (A4 quer: 770 Punkte breit). */
const landscapeHeader = (opts) => {
  const h = header(opts)
  h[1] = { ...h[1], canvas: [{ ...h[1].canvas[0], x2: 770 }] }
  return h
}

/** Text zum Sicherheitsdatenblatt: „15.03.2024“, „15.03.2021 (veraltet)“, „fehlt“, „Fassung unbekannt“. */
export const sdbText = (sdb) => (sdb.state === 'fehlt' ? 'fehlt' : sdb.state === 'ohne-datum' ? 'Fassung unbekannt' : `${day(sdb.date)}${sdb.state === 'veraltet' ? ' (veraltet)' : ''}`)

/**
 * Arbeitsstoffverzeichnis. rows: aus stoffRows; objectName(id) → Name; settings: sdbYears für den Hinweis.
 */
export function verzeichnisDocument({ rows = [], objectName = () => '', today, brand = {}, logo = null, settings = {}, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const body = rows.map((r, i) => [
    { text: String(i + 1), alignment: 'right' },
    { stack: [{ text: r.product, bold: true }, r.maker ? { text: r.maker, color: colors.grey } : '', r.product !== r.article.name ? { text: `Artikel: ${r.article.name}`, color: colors.grey, fontSize: 6.5 } : ''] },
    r.haz.use || (r.details ? '' : { text: 'Angaben fehlen', color: AMBER }),
    pictos(r.haz.ghs),
    SIGNALS[r.haz.signal] && r.haz.signal ? { text: SIGNALS[r.haz.signal], bold: r.haz.signal === 'gefahr', color: r.haz.signal === 'gefahr' ? RED : undefined } : '–',
    codesOf(r.haz.h).join(', ') || '–',
    codesOf(r.haz.p).join(', ') || '–',
    { text: sdbText(r.sdb), color: r.sdb.state === 'ok' ? undefined : r.sdb.state === 'ohne-datum' ? AMBER : RED },
    r.stock.list.length ? r.stock.list.map((s) => `${s.name}: ${qty(s.qty)} ${r.article.unit || ''}`.trim()).join('\n') : '–',
    r.objectIds.map(objectName).filter(Boolean).join(', ') || '–',
  ])
  const missing = rows.filter((r) => r.sdb.state === 'fehlt' || r.sdb.state === 'veraltet').length
  const content = [
    ...landscapeHeader({ title: 'Arbeitsstoffverzeichnis', subtitle: `Stand ${day(today)}`, brand, logo, colors }),
    { text: [{ text: `${rows.length} ${rows.length === 1 ? 'Arbeitsstoff' : 'Arbeitsstoffe'}`, bold: true }, missing ? `   ·   Sicherheitsdatenblatt fehlt oder ist veraltet: ${missing}` : '   ·   Sicherheitsdatenblätter vorhanden'], margin: [0, 0, 0, 8] },
    rows.length
      ? { table: { headerRows: 1, widths: [14, '*', '*', 66, 40, 62, 74, 56, 70, '*'], body: [th(['Nr.', 'Produkt / Hersteller', 'Verwendung', 'Piktogramme', 'Signalwort', 'H-Sätze', 'P-Sätze', 'Sicherheits-\ndatenblatt', 'Menge / Lagerort', 'verwendet in']), ...body] }, layout: tableLayout(colors), fontSize: 7.5 }
      : { text: 'Keine Arbeitsstoffe eingetragen.', color: colors.grey },
    { text: `Menge laut Lagerbestand am Stand-Tag, Objekte laut Ausgaben der letzten 12 Monate und eigener Zuordnung. Sicherheitsdatenblatt „veraltet“: Fassung älter als ${settings.sdbYears || 3} Jahre (eigene Vorgabe), neue Fassung beim Lieferanten anfordern.`, fontSize: 7, color: colors.grey, margin: [0, 8, 0, 0] },
  ]
  return { ...docShell(content, { brand, colors, createdAt, title: 'Arbeitsstoffverzeichnis' }), pageOrientation: 'landscape' }
}
export const verzeichnisPdfName = (date) => `Arbeitsstoffverzeichnis_${date}.pdf`

/**
 * Betriebsanweisung zum Aushängen. ba: Eintrag aus arbeitsschutz.json; article: Artikel (bei Arbeitsstoffen) für
 * Piktogramme, Signalwort und Sicherheitsdatenblatt; sdb: Ergebnis von sdbState.
 */
export function instructionDocument({ ba, article = null, sdb = null, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const haz = article?.haz || {}
  const ghs = (haz.ghs || []).filter((id) => GHS.some((g) => g.id === id))
  const approved = !!(ba.approvedBy && ba.approvedAt)
  const sectionBlock = ([key, label]) => {
    const text = String(ba.sections?.[key] || '').trim()
    const head = { table: { widths: ['*'], body: [[{ text: label, bold: true, color: '#ffffff', fillColor: colors.ink, margin: [4, 2, 4, 2] }]] }, layout: 'noBorders', margin: [0, 8, 0, 3] }
    // bei Piktogrammen steht das Signalwort groß daneben, nicht noch einmal in der Liste
    const big = key === 'gefahren' && ghs.length && haz.signal
    const lines = text ? text.split('\n').map((l) => l.trim()).filter((l) => l && !(big && /^Signalwort:/.test(l))) : []
    const bodyText = lines.length > 1 ? { ul: lines, margin: [6, 0, 0, 0] } : { text: lines[0] || '–', margin: [6, 0, 0, 0], color: lines.length ? undefined : colors.grey }
    if (key !== 'gefahren' || !ghs.length) return [head, bodyText]
    return [head, { columns: [{ width: 'auto', stack: ghs.map((id) => ({ svg: ghsSvg(id), width: 46, height: 46, margin: [0, 0, 0, 4] })) }, { width: '*', stack: [haz.signal ? { text: SIGNALS[haz.signal], bold: true, fontSize: 13, color: haz.signal === 'gefahr' ? RED : colors.ink, margin: [0, 0, 0, 4] } : '', bodyText] }], columnGap: 12 }]
  }
  const info = [
    [{ text: ba.kind === 'stoff' ? 'Arbeitsstoff' : 'Tätigkeit / Maschine', bold: true }, ba.title || ''],
    ...(article && haz.maker ? [[{ text: 'Hersteller', bold: true }, haz.maker]] : []),
    ...(ba.area ? [[{ text: 'Arbeitsbereich', bold: true }, ba.area]] : []),
    ...(sdb ? [[{ text: 'Sicherheitsdatenblatt', bold: true }, sdb.state === 'fehlt' ? { text: 'fehlt', color: RED } : sdb.date ? `Fassung vom ${day(sdb.date)}` : 'Fassung unbekannt']] : []),
  ]
  const content = [
    ...header({ title: 'Betriebsanweisung', subtitle: `${BA_KINDS[ba.kind] || ''} · Stand ${day(ba.date)}`, brand, logo, colors }),
    approved ? '' : { text: 'Entwurf – vor dem Aushang prüfen und freigeben', bold: true, color: RED, margin: [0, 0, 0, 6] },
    { text: ba.title || '', fontSize: 16, bold: true, color: colors.ink, margin: [0, 0, 0, 4] },
    { table: { widths: [100, '*'], body: info }, layout: 'noBorders', margin: [0, 0, 0, 4] },
    ...BA_SECTIONS.flatMap(sectionBlock),
    {
      margin: [0, 18, 0, 0],
      columns: [
        { stack: [{ text: `Stand: ${day(ba.date)}` }, approved ? { text: `Freigegeben: ${ba.approvedBy}, ${day(ba.approvedAt)}` } : { text: 'Noch nicht freigegeben', color: RED }] },
        { stack: [{ canvas: [{ type: 'line', x1: 0, y1: 18, x2: 200, y2: 18, lineWidth: 0.6, lineColor: colors.grey }] }, { text: 'Unterschrift der verantwortlichen Person', fontSize: 7, color: colors.grey }] },
      ],
    },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Betriebsanweisung ${ba.title || ''}` })
}
export const instructionPdfName = (ba) => `Betriebsanweisung_${fileSafe(ba.title) || 'Entwurf'}_${ba.date || ''}.pdf`

/**
 * Sicherheits- und Gesundheitsschutzdokument: Evaluierungen (evalRows) mit Gefahren und Maßnahmen, dazu die Zahl der
 * Arbeitsstoffe und die Betriebsanweisungen. objectName(id) → Name.
 */
export function sgdDocument({ rows = [], stoffe = 0, instructions = [], objectName = () => '', today, brand = {}, logo = null, settings = {}, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const riskCell = (h) => {
    const r = riskOf(h)
    const cls = riskClass(r)
    return r ? { text: `${r} ${cls}`, color: cls === 'hoch' ? RED : cls === 'mittel' ? AMBER : undefined, bold: cls === 'hoch' } : { text: 'nicht bewertet', color: AMBER }
  }
  const measureCell = (h) => {
    const list = h.measures || []
    if (!list.length) return { text: 'keine Maßnahme eingetragen', color: AMBER }
    return {
      stack: list.map((m) => {
        const st = measureState(m, today)
        const status = st === 'ueberfaellig' ? `überfällig (Frist ${day(m.due)})` : st === 'ohne-frist' ? 'offen, ohne Frist' : st === 'offen' ? `offen bis ${day(m.due)}` : `${MEASURE_STATES[m.status]}${m.checkedAt ? ` (${day(m.checkedAt)})` : m.doneAt ? ` (${day(m.doneAt)})` : ''}`
        return { margin: [0, 0, 0, 3], text: [{ text: m.text }, { text: `\n${[m.who ? `verantwortlich: ${m.who}` : 'verantwortlich: –', status].join(' · ')}`, fontSize: 7, color: st === 'ueberfaellig' || st === 'unwirksam' ? RED : colors.grey }] }
      }),
    }
  }
  const blocks = rows.flatMap((r) => {
    const ev = r.ev
    const objects = (ev.objectIds || []).map(objectName).filter(Boolean)
    const head = [
      { text: ev.title, style: 'section', margin: [0, 14, 0, 2] },
      {
        text: [
          { text: 'Bereich: ', bold: true },
          objects.length ? objects.join(', ') : 'alle Objekte',
          '   ·   ',
          { text: 'evaluiert bzw. überprüft: ', bold: true },
          `${day(ev.reviewedAt)}${ev.reviewedBy ? ` (${ev.reviewedBy})` : ''}`,
          '   ·   ',
          { text: 'nächste Überprüfung: ', bold: true },
          { text: `${day(r.review.next)}${r.review.state !== 'ok' ? ` (${REVIEW_STATES[r.review.state]})` : ''}`, color: r.review.state === 'ok' ? undefined : RED },
        ],
        margin: [0, 0, 0, 2],
      },
      ev.participants ? { text: [{ text: 'Beteiligt: ', bold: true }, ev.participants], margin: [0, 0, 0, 2] } : '',
      r.review.trigger ? { text: [{ text: 'Anlass zur Überprüfung: ', bold: true }, `${day(r.review.trigger.date)} ${r.review.trigger.text || ''}`], color: RED, margin: [0, 0, 0, 2] } : '',
    ]
    const hazards = ev.hazards || []
    const table = hazards.length
      ? { table: { headerRows: 1, widths: ['*', 46, 40, 44, '*'], body: [th(['Gefahr', 'Wahrschein-\nlichkeit', 'Schwere', 'Risiko', 'Maßnahmen']), ...hazards.map((h) => [{ text: h.text }, LIKELIHOOD[h.likelihood] || '–', SEVERITY[h.severity] || '–', riskCell(h), measureCell(h)])] }, layout: tableLayout(colors), fontSize: 8, margin: [0, 4, 0, 0] }
      : { text: 'Keine Gefahren eingetragen.', color: colors.grey }
    return [...head, table, ev.note ? { text: ev.note, fontSize: 7.5, color: colors.grey, margin: [0, 3, 0, 0] } : '']
  })
  const content = [
    ...header({ title: 'Sicherheits- und Gesundheitsschutzdokument', subtitle: `Evaluierung · Stand ${day(today)}`, brand, logo, colors }),
    { text: [{ text: `${rows.length} ${rows.length === 1 ? 'Arbeitsbereich bzw. Tätigkeit' : 'Arbeitsbereiche bzw. Tätigkeiten'}`, bold: true }, `   ·   Überprüfung alle ${settings.reviewMonths || 12} Monate sowie nach Unfällen und Änderungen (eigene Vorgabe)`], margin: [0, 0, 0, 4] },
    { text: 'Bewertung: Wahrscheinlichkeit (selten, gelegentlich, häufig) mal Schwere (leicht, mittel, schwer), je 1 bis 3; Risiko 1–2 gering, 3–4 mittel, 6–9 hoch.', fontSize: 7.5, color: colors.grey },
    ...(blocks.length ? blocks : [{ text: 'Noch keine Evaluierung eingetragen.', color: colors.grey, margin: [0, 10, 0, 0] }]),
    { text: 'Arbeitsstoffe und Betriebsanweisungen', style: 'section', margin: [0, 16, 0, 2] },
    { text: `Arbeitsstoffverzeichnis: ${stoffe} ${stoffe === 1 ? 'Arbeitsstoff' : 'Arbeitsstoffe'} (eigenes Dokument).`, margin: [0, 0, 0, 2] },
    instructions.length ? { ul: instructions.map((b) => `${b.title} (${BA_KINDS[b.kind] || ''}, Stand ${day(b.date)}${b.approvedAt ? `, freigegeben ${day(b.approvedAt)}` : ', Entwurf'})`) } : { text: 'Keine Betriebsanweisungen eingetragen.', color: colors.grey },
    { text: 'Erstellt mit der App; Gefahren, Bewertung und Maßnahmen mit Sicherheitsfachkraft und Arbeitsmedizin abstimmen.', fontSize: 7, color: colors.grey, margin: [0, 12, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: 'Sicherheits- und Gesundheitsschutzdokument' })
}
export const sgdPdfName = (date) => `Evaluierung_SGD_${date}.pdf`

/** Text der Liste als Hinweis (Zu erledigen, CSV). */
export const sdbStateText = (sdb) => SDB_STATES[sdb.state] || ''
