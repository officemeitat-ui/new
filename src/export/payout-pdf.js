// PDFs zu den Auszahlungen eines Monats: Übersicht „wer bekommt wie viel“ mit
// Einzelaufstellung (für die Lohnverrechnung) und je Person die eigene
// Aufstellung. Nur die Dokumentbeschreibung für pdfmake (in Node testbar).

import { formatDate, formatHours } from '../core/dates.js'
import { UE_MODES } from '../core/overtime.js'
import { euroText, monthName } from '../core/payout.js'
import { inkColors } from './pdf.js'

const GREY = '#595959'
const TOTAL = '#FFF2CC'
const signedH = (min) => `${min > 0 ? '+' : min < 0 ? '−' : '±'}${formatHours(Math.abs(min))}`

function header({ title, subtitle, brand, logo, colors }) {
  return [
    {
      columns: [
        logo ? { stack: [logo.svg ? { svg: logo.svg, width: 120 } : { image: logo.image, fit: [130, 52] }, { text: brand.product || 'Dienstplan', color: GREY, margin: [0, 2, 0, 0] }] } : { stack: [{ text: brand.name || '', style: 'brand' }, { text: brand.product || 'Dienstplan', color: GREY }] },
        { stack: [{ text: title, style: 'title', alignment: 'right' }, { text: subtitle, alignment: 'right', color: GREY }] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 1.5, lineColor: colors.ink }], margin: [0, 0, 0, 8] },
  ]
}

const tableLayout = (colors) => ({ hLineColor: () => colors.line, vLineColor: () => colors.line, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 })

function linesTable(entry, colors) {
  const body = [[{ text: 'Lohnart', style: 'th' }, { text: 'Stunden', style: 'th', alignment: 'right' }, { text: 'Satz', style: 'th', alignment: 'right' }, { text: 'Betrag', style: 'th', alignment: 'right' }]]
  for (const l of entry.lines) body.push([l.label, { text: formatHours(l.min), alignment: 'right' }, { text: l.base ? `100 % + ${l.pct} %` : `${l.pct} %`, alignment: 'right' }, { text: euroText(l.amount), alignment: 'right' }])
  body.push([{ text: 'Summe brutto', bold: true, fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: euroText(entry.amount), bold: true, alignment: 'right', fillColor: TOTAL }])
  return { table: { headerRows: 1, widths: ['*', 50, 70, 70], body }, layout: tableLayout(colors) }
}

function docShell(content, { brand, colors, createdAt, title }) {
  const created = createdAt.toLocaleDateString('de-AT')
  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 40],
    info: { title, author: brand.name, creator: brand.product || 'Dienstplan' },
    content,
    footer: (page, pages) => ({ columns: [{ text: `${brand.name || ''}${brand.name ? ' · ' : ''}erstellt am ${created}`, fontSize: 7.5, color: GREY }, { text: `Seite ${page} von ${pages}`, alignment: 'right', fontSize: 7.5, color: GREY }], margin: [36, 14, 36, 0] }),
    defaultStyle: { fontSize: 8.5, lineHeight: 1.1 },
    styles: {
      brand: { fontSize: 14, bold: true, color: colors.ink },
      title: { fontSize: 14, bold: true, color: colors.ink },
      name: { fontSize: 13, bold: true },
      th: { bold: true, fontSize: 8, color: colors.ink, fillColor: colors.soft },
      section: { fontSize: 10, bold: true, margin: [0, 10, 0, 4], color: colors.ink },
    },
  }
}

/** Übersicht für die Lohnverrechnung: wer bekommt wie viel, danach je Person die Lohnzeilen. */
export function payoutListDocument(entries, { month, status = '', brand = { name: '', product: '' }, logo = null, createdAt = new Date(), note = '' } = {}) {
  const colors = inkColors(brand)
  const total = entries.reduce((s, e) => s + e.amount, 0)
  const taxFree = entries.reduce((s, e) => s + (e.taxFree || 0), 0)
  const body = [
    ['Pers.-Nr.', 'Name', 'Stundenlohn', 'Überstunden', 'Mehrarbeit', 'Zeitkonto', 'Brutto'].map((t, i) => ({ text: t, style: 'th', alignment: i >= 2 ? 'right' : 'left' })),
    ...entries.map((e) => [
      e.employee.personnelNo || '',
      { text: e.employee.name, bold: true },
      { text: e.wage ? euroText(e.wage) : '–', alignment: 'right' },
      { text: e.ueHours ? `${formatHours(e.ueHours)} h` : '–', alignment: 'right' },
      { text: e.mehrHours ? `${formatHours(e.mehrHours)} h` : '–', alignment: 'right' },
      { text: e.accountDelta ? `${signedH(e.accountDelta)} h` : '–', alignment: 'right' },
      { text: e.amount ? euroText(e.amount) : 'Zeitausgleich', alignment: 'right', bold: !!e.amount },
    ]),
    [{ text: 'Summe', bold: true, fillColor: TOTAL }, { text: `${entries.filter((e) => e.amount).length} Personen`, fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: '', fillColor: TOTAL }, { text: euroText(total), bold: true, alignment: 'right', fillColor: TOTAL }],
  ]
  const content = [
    ...header({ title: `Auszahlungen ${monthName(month)}`, subtitle: `Überstunden, Mehrarbeit, Zuschläge${status ? ` · ${status}` : ''}`, brand, logo, colors }),
    { table: { headerRows: 1, widths: [44, '*', 56, 58, 56, 52, 66], body }, layout: tableLayout(colors) },
    { text: `Alle Beträge brutto. Überstundenzuschläge, die nach § 68 Abs. 2 EStG steuerfrei sein können: ${euroText(taxFree)} (Hinweis, die Lohnverrechnung prüft). Mehrarbeitszuschläge sind steuerpflichtig.${note ? ` ${note}` : ''}`, fontSize: 7.5, color: GREY, margin: [0, 6, 0, 0] },
    { text: 'Einzelaufstellung', style: 'section' },
  ]
  for (const e of entries) {
    content.push({
      stack: [
        { text: [{ text: e.employee.name, bold: true }, { text: `   ${[e.employee.personnelNo ? `Pers.-Nr. ${e.employee.personnelNo}` : '', e.wage ? `${euroText(e.wage)}/h` : '', `Überstunden: ${UE_MODES[e.ueMode] || ''}`].filter(Boolean).join(' · ')}`, color: GREY }], margin: [0, 4, 0, 3] },
        e.lines.length ? linesTable(e, colors) : { text: 'Keine Auszahlung, nur Zeitausgleich.', color: GREY },
        { text: [e.zaBonus ? `Zeitausgleich-Zuschlag +${formatHours(e.zaBonus)} h · ` : '', `Zeitkonto ${signedH(e.accountDelta)} h`].join(''), fontSize: 7.5, color: GREY, margin: [0, 2, 0, 4] },
      ],
      unbreakable: true,
    })
  }
  return docShell(content, { brand, colors, createdAt, title: `Auszahlungen ${monthName(month)}` })
}

/** Aufstellung für eine Person (je Person eine Seite). */
export function payoutStatementDocument(entries, { month, status = '', brand = { name: '', product: '' }, logo = null, createdAt = new Date(), contact = '' } = {}) {
  const colors = inkColors(brand)
  const content = []
  entries.forEach((e, i) => {
    const page = [
      ...header({ title: `Auszahlung ${monthName(month)}`, subtitle: `Überstunden und Mehrarbeit${status ? ` · ${status}` : ''}`, brand, logo, colors }),
      { text: e.employee.name, style: 'name' },
      { text: [e.employee.personnelNo ? `Personalnr. ${e.employee.personnelNo}` : '', e.employee.type, e.employee.weeklyHours ? `${formatHours(e.employee.weeklyHours * 60)} h/Woche` : '', e.wage ? `Stundenlohn ${euroText(e.wage)}` : ''].filter(Boolean).join(' · '), color: GREY, margin: [0, 1, 0, 8] },
      e.lines.length ? linesTable(e, colors) : { text: 'Diesen Monat wird nichts ausbezahlt.', margin: [0, 0, 0, 4] },
      e.zaBonus ? { text: `Zeitausgleich (${UE_MODES[e.ueMode]}): +${formatHours(e.zaBonus)} h Zuschlag ins Zeitkonto.`, margin: [0, 6, 0, 0] } : '',
      e.accountDelta ? { text: `Zeitkonto: ${signedH(e.accountDelta)} h${e.amount && e.accountDelta < 0 ? ' (ausbezahlte Stunden)' : ''}`, bold: true, margin: [0, 6, 0, 0] } : '',
      e.mehrOpenMin ? { text: `Noch offen: ${formatHours(e.mehrOpenMin)} h Mehrarbeit im Zeitkonto, Ausgleich bis ${formatDate(e.mehrOpen[0].deadline, { weekday: false, year: true })}. Danach wird sie mit Zuschlag ausbezahlt.`, margin: [0, 6, 0, 0] } : '',
      { text: 'Bruttobeträge; die Auszahlung erfolgt mit der Lohnabrechnung. Überstunden: Zuschlag laut Kollektivvertrag (50 %, Nacht 100 %, Sonntag 150 %). Mehrarbeit ist zuschlagsfrei, wenn sie binnen 3 Monaten 1:1 ausgeglichen wird, sonst 25 %.', fontSize: 7.5, color: GREY, margin: [0, 10, 0, 0] },
      contact ? { text: contact, fontSize: 8, color: GREY, margin: [0, 8, 0, 0] } : '',
    ]
    if (i > 0) page[0] = { ...page[0], pageBreak: 'before' }
    content.push(...page)
  })
  return docShell(content, { brand, colors, createdAt, title: entries.length === 1 ? `Auszahlung ${monthName(month)} – ${entries[0].employee.name}` : `Auszahlungen ${monthName(month)}` })
}
