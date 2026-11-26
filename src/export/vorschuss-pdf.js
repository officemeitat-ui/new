// Vorschussvereinbarung als PDF (core/vorschuss.js): wie die Vorlage des Büros – Firma und Person, Betrag und Tag der
// Auszahlung, Rückzahlung je Monat durch Abzug von der Lohnabrechnung, Abzug des Rests bei der Endabrechnung, Ort, Datum
// und zwei Unterschriften. Ohne Gewähr: arbeitsrechtlich prüfen lassen (docs/RECHTSPRUEFUNG.md, Punkt 61).

import { formatDate, MONTH_LONG } from '../core/dates.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileSafe = (s) => String(s || '').replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c]).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
const eur = (v) => (Number(v) || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
const monthText = (m) => `${MONTH_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/** company: { name, address (mehrzeilig) }, emp: { name, address? }, place: Ort der Unterschrift (z. B. Hallein). */
export function advanceDocument({ advance, emp = {}, company = {}, place = '', iban = '', signer = '', brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const lines = (t) => String(t || '').split(/\n|,\s*(?=\d{4}\s)/).map((x) => x.trim()).filter(Boolean)
  const sign = (label) => ({ stack: [{ text: ' ', margin: [0, 28, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 220, y2: 2, lineWidth: 0.7, lineColor: colors.grey }] }, { text: label, fontSize: 8, color: colors.grey }] })
  const content = [
    ...header({ title: 'Vorschussvereinbarung', subtitle: `${emp.name || ''} · ${formatDate(advance.date, { year: true })}`, brand, logo, colors }),
    { columns: [{ stack: [{ text: 'zwischen', fontSize: 8, color: colors.grey }, { text: company.name || brand.name || '', bold: true }, ...lines(company.address).map((t) => ({ text: t }))] }, { stack: [{ text: 'und', fontSize: 8, color: colors.grey }, { text: emp.name || '', bold: true }, ...lines(emp.address).map((t) => ({ text: t }))] }], columnGap: 30, margin: [0, 0, 0, 12] },
    { text: 'Vorschuss', style: 'section' },
    { text: `Wir gewähren ${emp.name || 'der Mitarbeiterin bzw. dem Mitarbeiter'} am ${formatDate(advance.date, { weekday: false, year: true })} einen Vorschuss in der Höhe von ${eur(advance.amount)}${iban ? ` auf das Bankkonto ${iban}` : ''}.`, margin: [0, 0, 0, 8] },
    { text: 'Rückzahlung', style: 'section' },
    { text: 'Die Rückzahlung erfolgt durch Abzug von der Lohnabrechnung wie folgt:', margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: ['*', 120], body: [['Monatsabrechnung', 'Betrag'].map((text) => ({ text, style: 'th' })), ...(advance.installments || []).map((x) => [monthText(x.month), { text: eur(x.amount), alignment: 'right' }])] }, layout: tableLayout(colors), margin: [0, 0, 0, 8] },
    { text: 'Bei Beendigung des Dienstverhältnisses wird der gesamte offene Betrag zum Stichtag bei der Endabrechnung in Abzug gebracht.', margin: [0, 0, 0, 8] },
    advance.note ? { text: [{ text: 'Anmerkung: ', bold: true }, advance.note], margin: [0, 0, 0, 8] } : '',
    { text: `Ort, Datum: ${place ? `${place}, ` : ''}${formatDate(advance.date, { weekday: false, year: true })}`, margin: [0, 12, 0, 0] },
    { columns: [sign(signer ? `${signer}, ${company.name || brand.name || 'Geschäftsführung'}` : `Geschäftsführung ${company.name || brand.name || ''}`), sign(emp.name || 'Mitarbeiter:in')], columnGap: 30 },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Vorschussvereinbarung ${emp.name || ''} ${advance.date}` })
}

export const advancePdfName = (advance, emp = {}) => `Vorschuss_${advance.date}_${fileSafe(emp.name) || 'Person'}.pdf`
