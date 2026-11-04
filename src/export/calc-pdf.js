// Objektkalkulation als PDF: Angebot für den Kunden (Leistungsverzeichnis mit Flächen und Häufigkeit,
// Monatspreis; ohne Stunden und Zuschläge) und Kalkulationsblatt für intern (Leistungswerte, Stunden,
// Zuschlagskalkulation, Ergebnis).

import { formatDate, todayISO } from '../core/dates.js'
import { AREA_TYPES, frequencyLabel } from '../core/calculation.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const eur = (n) => `${n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const num = (n, d = 0) => n.toLocaleString('de-AT', { minimumFractionDigits: d, maximumFractionDigits: d })
const typeLabel = (t) => AREA_TYPES[t]?.[0] || 'Sonstiges'

export function offerDocument({ object = {}, calc, brand = {}, logo = null, createdAt = new Date(), validDays = 30, note = '' }) {
  const colors = inkColors(brand)
  const th = (t, extra = {}) => ({ text: t, style: 'th', ...extra })
  const body = [[th('Bereich'), th('Art'), th('Fläche', { alignment: 'right' }), th('Häufigkeit')]]
  for (const r of calc.rows) body.push([r.area.name || typeLabel(r.area.type), typeLabel(r.area.type), { text: `${num(Number(r.area.m2) || 0)} m²`, alignment: 'right' }, frequencyLabel(r.area.perWeek)])
  body.push([{ text: 'Summe', bold: true }, '', { text: `${num(calc.totalM2)} m²`, alignment: 'right', bold: true }, ''])
  const valid = todayISO(new Date(createdAt.getTime() + validDays * 86400e3))
  const content = [
    ...header({ title: 'Angebot Unterhaltsreinigung', subtitle: `${object.name || ''}`, brand, logo, colors }),
    { text: [object.name, object.address].filter(Boolean).join(', '), bold: true, margin: [0, 0, 0, 8] },
    { text: 'Leistungsverzeichnis', style: 'section', margin: [0, 4, 0, 4] },
    { table: { headerRows: 1, widths: ['*', 120, 70, 100], body }, layout: tableLayout(colors) },
    {
      table: {
        widths: ['*', 110],
        body: [
          ['Preis je Monat, netto', { text: eur(calc.net), alignment: 'right', bold: true }],
          [`zuzüglich ${num(calc.vat / (calc.net || 1) * 100)} % USt.`, { text: eur(calc.vat), alignment: 'right' }],
          [{ text: 'Preis je Monat, brutto', bold: true }, { text: eur(calc.gross), alignment: 'right', bold: true }],
        ],
      },
      layout: tableLayout(colors),
      margin: [0, 12, 0, 0],
    },
    { text: `Unterhaltsreinigung laut Leistungsverzeichnis; Reinigungsmittel und Geräte sind enthalten. Gültig bis ${formatDate(valid, { year: true })}.${note ? ` ${note}` : ''}`, margin: [0, 10, 0, 0], fontSize: 9 },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Angebot ${object.name || ''}` })
}

export function calcDocument({ object = {}, calc, settings, wage, plannedMonth = null, budgetMonth = null, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const th = (t, extra = {}) => ({ text: t, style: 'th', ...extra })
  const areas = [[th('Bereich'), th('Fläche', { alignment: 'right' }), th('Häufigkeit'), th('m²/h', { alignment: 'right' }), th('h/Monat', { alignment: 'right' })]]
  for (const r of calc.rows) areas.push([`${r.area.name || typeLabel(r.area.type)} (${typeLabel(r.area.type)})`, { text: `${num(Number(r.area.m2) || 0)} m²`, alignment: 'right' }, frequencyLabel(r.area.perWeek), { text: num(r.value), alignment: 'right' }, { text: num(r.minutes / 60, 2), alignment: 'right' }])
  areas.push([{ text: `Rüst- und Nebenzeiten +${num(Number(settings.setupPct) || 0)} %`, colSpan: 4 }, '', '', '', { text: num((calc.minutes - calc.cleaningMinutes) / 60, 2), alignment: 'right' }])
  areas.push([{ text: 'Stunden je Monat', bold: true, colSpan: 4 }, '', '', '', { text: num(calc.hours, 2), alignment: 'right', bold: true }])
  const steps = [[th('Zuschlagskalkulation'), th('%', { alignment: 'right' }), th('€ je Stunde', { alignment: 'right' })]]
  for (const s of calc.steps) steps.push([s.label, { text: s.pct === null ? '' : num(s.pct, 1), alignment: 'right' }, { text: eur(s.amount), alignment: 'right' }])
  steps.push([{ text: 'Verrechnungssatz netto', bold: true }, '', { text: eur(calc.rate), alignment: 'right', bold: true }])
  const result = [
    ['Preis je Monat netto', eur(calc.net)],
    ['Kosten je Monat (ohne Gewinn)', eur(calc.costMonth)],
    ['Deckungsbeitrag (Gewinn und Wagnis)', eur(calc.margin)],
    ['Preis je m² und Monat', calc.perM2 === null ? '–' : eur(calc.perM2)],
    ['Stundenlohn der Kalkulation', eur(wage)],
    ...(budgetMonth !== null ? [['Budget im Objekt (h/Monat)', num(budgetMonth, 1)]] : []),
    ...(plannedMonth !== null ? [['Laut Reinigungsplan (h/Monat)', num(plannedMonth, 1)]] : []),
  ].map(([a, b]) => [a, { text: b, alignment: 'right' }])
  const content = [
    ...header({ title: 'Kalkulation', subtitle: `${object.name || ''} · intern`, brand, logo, colors }),
    { table: { headerRows: 1, widths: ['*', 60, 90, 45, 55], body: areas }, layout: tableLayout(colors) },
    { columns: [{ table: { headerRows: 1, widths: ['*', 40, 70], body: steps }, layout: tableLayout(colors) }, { table: { widths: ['*', 80], body: result }, layout: tableLayout(colors) }], columnGap: 14, margin: [0, 12, 0, 0] },
    { text: 'Leistungswerte und Zuschläge sind Vorgaben des Betriebs (Richtwerte, mit der eigenen Erfahrung abgleichen). Interne Unterlage, nicht an Kunden weitergeben.', fontSize: 7.5, color: colors.grey, margin: [0, 10, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Kalkulation ${object.name || ''}` })
}

export const calcPdfName = (kind, objectName) => `${kind}_${String(objectName || '').replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '-')}.pdf`
