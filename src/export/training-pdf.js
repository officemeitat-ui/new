// Unterweisungsnachweis als PDF: Art, Datum, Ort, Inhalt, wer unterwiesen hat, Teilnehmerliste mit
// Unterschrift (vom Bildschirm) oder leerem Feld zum Unterschreiben auf Papier.

import { formatDate } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')

export function sessionDocument({ session, type = {}, people = [], signatures = {}, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const row = (label, value) => (value ? { text: [{ text: `${label}: `, bold: true }, value], margin: [0, 0, 0, 2] } : '')
  const body = people.map((p, i) => [String(i + 1), p.name, signatures[p.id] ? { svg: signatures[p.id], width: 150 } : { text: ' ', margin: [0, 14, 0, 0] }])
  const content = [
    ...header({ title: 'Unterweisung', subtitle: `${type.name || ''} · ${formatDate(session.date, { year: true })}`, brand, logo, colors }),
    row('Art', `${type.name || ''}${type.law ? ` (${type.law})` : ''}`),
    row('Datum', formatDate(session.date, { year: true })),
    row('Ort', session.place),
    row('Unterwiesen von', session.trainer),
    session.topic ? { text: [{ text: 'Inhalt: ', bold: true }, session.topic], margin: [0, 0, 0, 10] } : { text: '', margin: [0, 0, 0, 8] },
    { text: 'Mit der Unterschrift bestätigen die Teilnehmenden, dass sie die Unterweisung erhalten und verstanden haben.', fontSize: 9, margin: [0, 0, 0, 6] },
    { table: { headerRows: 1, widths: [22, '*', 180], body: [['Nr.', 'Name', 'Unterschrift'].map((text) => ({ text, style: 'th' })), ...body] }, layout: tableLayout(colors), fontSize: 10 },
    { stack: [{ text: ' ', margin: [0, 30, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 200, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: `Unterschrift ${session.trainer || 'Unterweisende:r'}`, fontSize: 8, color: colors.grey }] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Unterweisung ${type.name || ''} ${session.date}` })
}

export const sessionPdfName = (session, type = {}) => `Unterweisung_${session.date}_${fileSafe(type.name) || 'Nachweis'}.pdf`

/**
 * Nachweis einer Unterweisung am Handy (Plan am Handy): Person, Art, Zeitpunkt vom Webspace, Dauer, Sprache, Fragen
 * richtig, Versuche, die unterschriebene Erklärung mit Unterschrift und der Inhalt der Fassung (deutsch) samt Fragen.
 * record: Eintrag mit online, version: Fassung aus doc.versions (oder null, dann nur die Angaben ohne Inhalt).
 */
export function onlineProofDocument({ record, type = {}, emp = {}, version = null, langLabel = (id) => id, parseContent, parseQuiz, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const o = record.online || {}
  const when = (iso) =>
    iso
      ? new Date(iso).toLocaleString('de-AT', {
          timeZone: 'Europe/Vienna',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : ''
  const minutes = o.opened && o.at ? Math.max(1, Math.round((Date.parse(o.at) - Date.parse(o.opened)) / 60000)) : 0
  const row = (label, value) =>
    value
      ? {
          text: [{ text: `${label}: `, bold: true }, value],
          margin: [0, 0, 0, 2],
        }
      : ''
  const de = version?.texts?.de || null
  const content = []
  if (de && parseContent) {
    content.push({
      text: `Inhalt der Unterweisung (Fassung ${o.version}, deutsch)`,
      style: 'section',
    })
    for (const s of parseContent(de.content).sections) {
      if (s.title) content.push({ text: s.title, bold: true, margin: [0, 6, 0, 2] })
      for (const b of s.blocks) content.push(b.list ? { ul: b.list, fontSize: 9, margin: [0, 0, 0, 2] } : { text: b.p, fontSize: 9, margin: [0, 0, 0, 3] })
    }
    const qs = parseQuiz ? parseQuiz(de.quiz).questions : []
    if (qs.length) {
      content.push({
        text: 'Verständnisfragen (richtige Antwort fett)',
        style: 'section',
      })
      qs.forEach((q, i) =>
        content.push({
          stack: [
            { text: `${i + 1}. ${q.q}`, fontSize: 9, margin: [0, 3, 0, 1] },
            {
              ul: q.options.map((a, j) => ({ text: a, bold: j === q.correct })),
              fontSize: 9,
            },
          ],
        }),
      )
    }
  }
  const body = [
    ...header({
      title: 'Unterweisungsnachweis',
      subtitle: `${type.name || ''} · ${formatDate(record.date, { year: true })}`,
      brand,
      logo,
      colors,
    }),
    row('Person', emp.name || ''),
    row('Art', `${type.name || ''}${type.law ? ` (${type.law})` : ''}`),
    row('Durchgeführt', `am Handy über „Plan am Handy“, unterschrieben am ${when(o.at)} (Zeit vom Server)`),
    minutes ? row('Bearbeitet', `seit dem ersten Öffnen am ${when(o.opened)} (${minutes} Minuten)`) : '',
    row('Sprache', langLabel(o.lang || 'de')),
    o.total ? row('Verständnisfragen', `${o.score} von ${o.total} richtig${version?.pass ? ` (Grenze ${version.pass} %)` : ''}${o.tries > 1 ? `, ${o.tries}. Versuch` : ''}`) : '',
    o.coveredBy ? row('Hinweis', 'Mit einer anderen Unterweisung am Handy erledigt (gleiche Unterschrift).') : '',
    { text: 'Erklärung der Person', style: 'section' },
    { text: o.decl || '', margin: [0, 0, 0, 4] },
    o.lang && o.lang !== 'de' && de?.decl
      ? {
          text: [{ text: 'Deutsch: ', bold: true }, de.decl],
          fontSize: 9,
          color: colors.grey,
          margin: [0, 0, 0, 4],
        }
      : '',
    record.signature ? { svg: record.signature, width: 200, margin: [0, 4, 0, 0] } : { text: '(ohne Unterschrift)', italics: true },
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 2,
          x2: 200,
          y2: 2,
          lineWidth: 0.7,
          lineColor: colors.grey,
        },
      ],
    },
    {
      text: `Unterschrift ${emp.name || ''}`,
      fontSize: 8,
      color: colors.grey,
      margin: [0, 2, 0, 0],
    },
    {
      text: 'Elektronische Unterweisung als schriftliche Form nach § 14 ASchG; sie ergänzt die persönliche Unterweisung am Arbeitsplatz (Einschulung im Objekt) und ersetzt sie nicht.',
      fontSize: 8,
      color: colors.grey,
      margin: [0, 10, 0, 0],
    },
    ...content,
  ]
  return docShell(body, {
    brand,
    colors,
    createdAt,
    title: `Unterweisungsnachweis ${type.name || ''} ${emp.name || ''}`,
  })
}

export const onlineProofName = (record, type = {}, emp = {}) => `Unterweisung_${record.date}_${fileSafe(type.name) || 'Nachweis'}_${fileSafe(emp.name)}.pdf`
