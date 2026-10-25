// Objektblatt / Leistungsverzeichnis / Objektakte als PDF. Inhalt nach
// Abschnitten wählbar; vertrauliche Abschnitte sind in der Fußzeile
// vermerkt und kommen in der Kundenfassung nie vor (core/objektmappe.js).

import { formatDate, formatHours, WEEKDAY_SHORT } from '../core/dates.js'
import { areaMinutes, LV_INTERVALS, SECTIONS, serviceMinutes } from '../core/objektmappe.js'
import { docShell, GREY, header, inkColors, tableLayout } from './pdf-parts.js'

const daysText = (r) => {
  if (r.type === 'once') return `einmalig ${formatDate(r.date, { weekday: false, year: true })}`
  if (r.type === 'monthly') return `${r.everyMonths > 1 ? `alle ${r.everyMonths} Monate` : 'monatlich'}`
  const days = (r.weekdays || []).map((d) => WEEKDAY_SHORT[d - 1]).join(', ')
  return `${days}${r.everyWeeks > 1 ? ` (alle ${r.everyWeeks} Wochen)` : ''}`
}

/**
 * data: { object, mappe, tasks: [{ label, recurrence, start, end, staff, regularNames }], waste, meters: [{ location, number, kind }],
 *         inspection: { date, overall, defects: [{ id, text, rating, note }] }, keys: [{ label, holder }], plannedMinutes }
 */
export function objektblattDocument(data, { sections, customer = false, brand = { name: '', product: '' }, logo = null, createdAt = new Date() } = {}) {
  const colors = inkColors(brand)
  const { object, mappe = {} } = data
  const has = (id) => sections.includes(id)
  const title = customer ? 'Leistungsverzeichnis' : sections.includes('stunden') ? 'Objektakte' : 'Objektblatt'
  const confidential = SECTIONS.filter((s) => s.confidential && has(s.id)).map((s) => s.label)
  const content = [...header({ title, subtitle: [object.name, mappe.objectNo ? `Objekt-Nr. ${mappe.objectNo}` : '', mappe.customerNo ? `Kunden-Nr. ${mappe.customerNo}` : ''].filter(Boolean).join(' · '), brand, logo, colors })]
  const section = (text) => content.push({ text, style: 'section' })
  const kv = (rows) => content.push({ table: { widths: [110, '*'], body: rows.filter(([, v]) => v).map(([k, v]) => [{ text: k, color: GREY }, v]) }, layout: 'noBorders' })
  const table = (head, rows, widths) => content.push({ table: { headerRows: 1, dontBreakRows: true, widths, body: [head.map((t) => ({ text: t, style: 'th' })), ...rows] }, layout: tableLayout(colors) })

  if (has('objekt')) {
    section('Objektdaten')
    kv([['Objekt', object.name], ['Adresse', [mappe.street, object.address].filter(Boolean).join(', ')], ['Auftraggeber', mappe.customer], ['Objektart', mappe.kind], ['Vertrag', [mappe.contract, mappe.validFrom ? `gültig ab ${formatDate(mappe.validFrom, { weekday: false, year: true })}` : ''].filter(Boolean).join(', ')], ['Revier', customer ? '' : object.region]])
  }
  if (has('kontakte') && mappe.contacts?.length) {
    section('Ansprechpartner')
    table(['Name', 'Rolle', 'Telefon', 'E-Mail', 'Hinweis'], mappe.contacts.map((c) => [{ text: c.name || '', bold: true }, c.role || '', c.phone || '', c.mail || '', { text: [c.note, c.internal ? 'intern' : ''].filter(Boolean).join(' · '), fontSize: 7.5, color: GREY }]), [90, 80, 80, '*', 90])
  }
  if (has('zeiten') && data.tasks?.length) {
    section('Reinigungszeiten')
    table(customer ? ['Leistung', 'Tage', 'Zeit', 'Personen'] : ['Leistung', 'Tage', 'Zeit', 'Personen', 'Stammkraft'], data.tasks.map((t) => [t.label, daysText(t.recurrence), `${t.start}–${t.end}`, { text: String(t.staff || 1), alignment: 'center' }, ...(customer ? [] : [t.regularNames || ''])]), customer ? ['*', 120, 70, 50] : ['*', 110, 62, 40, 100])
  }
  if (has('zugang') && (mappe.access?.length || data.keys?.length)) {
    section('Schlüssel und Zugang')
    table(['Bezeichnung', 'Nr.', 'Art', 'Anzahl', 'Wo / bei wem'], [...(mappe.access || []).map((a) => [{ text: a.label || '', bold: true }, a.number || '', a.type || '', { text: String(a.count || ''), alignment: 'center' }, [a.place, a.note].filter(Boolean).join(' · ')]), ...(data.keys || []).map((k) => [{ text: k.label, bold: true }, '', 'Schlüssel', '1', k.holder])], ['*', 50, 60, 40, 150])
    content.push({ text: 'Codes werden nicht schriftlich weitergegeben, bitte bei der Disposition erfragen.', fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] })
  }
  if (has('hinweise') && (mappe.notes || object.instructions || object.contact)) {
    section('Hinweise')
    for (const t of [object.instructions, mappe.notes, !customer && object.contact ? `Ansprechperson laut Dienstplan: ${object.contact}` : ''].filter(Boolean)) content.push({ text: t, margin: [0, 0, 0, 4] })
  }
  if (has('leistungen') && mappe.areas?.length) {
    section('Bereiche und Leistungen')
    const withTimes = has('stunden')
    for (const a of mappe.areas) {
      content.push({ text: [{ text: a.name || 'Bereich', bold: true }, { text: [a.location, a.size ? `${a.size} m²` : '', a.floor].filter(Boolean).map((x) => `   ${x}`).join(''), color: GREY }], margin: [0, 6, 0, 3] })
      if (!a.services?.length) continue
      table(withTimes ? ['Leistung', 'Häufigkeit', 'Methode', 'Min.', 'h/Woche'] : ['Leistung', 'Häufigkeit', 'Methode'], a.services.map((s) => [s.what || '', LV_INTERVALS[s.interval]?.label || '', s.method || '', ...(withTimes ? [{ text: String(s.minutes || ''), alignment: 'right' }, { text: formatHours(serviceMinutes(s)), alignment: 'right' }] : [])]), withTimes ? ['*', 110, 90, 36, 50] : ['*', 120, 120])
    }
  }
  if (has('stunden') && mappe.areas?.length) {
    section('Richtzeiten und Stunden')
    const total = mappe.areas.reduce((x, a) => x + areaMinutes(a), 0)
    table(['Bereich', 'h/Woche', 'h/Monat', 'h/Jahr'], [...mappe.areas.map((a) => [a.name || '', ...[1, 52 / 12, 52].map((f) => ({ text: formatHours(areaMinutes(a) * f), alignment: 'right' }))]), [{ text: 'Summe Leistungsverzeichnis', bold: true }, ...[1, 52 / 12, 52].map((f) => ({ text: formatHours(total * f), alignment: 'right', bold: true }))], ...(data.plannedMinutes ? [[{ text: 'Laut Dienstplan', color: GREY }, ...[1, 52 / 12, 52].map((f) => ({ text: formatHours(data.plannedMinutes * f), alignment: 'right', color: GREY }))]] : [])], ['*', 70, 70, 70])
  }
  if (has('geraete') && mappe.devices?.length) {
    section('Geräte')
    table(['Gerät', 'Standort', 'Inventar-Nr.', 'Eigentum', 'Zustand'], mappe.devices.map((d) => [d.label || '', d.place || '', d.inventoryNo || '', d.owner || '', d.condition || '']), ['*', 110, 70, 60, 70])
  }
  if (has('muell') && data.waste) {
    section('Müllplan')
    content.push({ text: data.waste })
  }
  if (has('zaehler') && data.meters?.length) {
    section('Zählerstellen')
    table(['Zählstelle', 'Zähler Nr.', 'Art'], data.meters.map((m) => [m.location || '', m.number || '', m.kind || '']), ['*', 100, 100])
  }
  if (has('kontrolle') && data.inspection) {
    section('Letzte Kontrolle und offene Mängel')
    kv([['Letzte Kontrolle', `${formatDate(data.inspection.date, { weekday: false, year: true })} · ${data.inspection.overall || ''}`]])
    if (data.inspection.defects?.length) table(['Punkt', 'Bew.', 'Mangel'], data.inspection.defects.map((d) => [d.id, d.rating, `${d.text}${d.note ? ` – ${d.note}` : ''}`]), [36, 30, '*'])
  }
  if (has('anhaenge') && mappe.attachments?.length) {
    section('Anhangsverzeichnis')
    table(['Dokument', 'Ablage'], mappe.attachments.map((a) => [a.name || '', { text: a.url || '', link: a.url || undefined, color: colors.ink, fontSize: 7.5 }]), [170, '*'])
  }
  if (has('unterschrift')) {
    content.push({ columns: [0, 1].map((i) => ({ stack: [{ text: ' ', margin: [0, 36, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: GREY }] }, { text: i ? 'Auftraggeber (Datum, Unterschrift)' : `${brand.name || 'Auftragnehmer'} (Datum, Unterschrift)`, fontSize: 8 }] })), columnGap: 40, margin: [0, 18, 0, 0], unbreakable: true })
  }
  const doc = docShell(content, { brand, colors, createdAt, title: `${title} ${object.name}` })
  if (confidential.length) {
    const base = doc.footer
    doc.footer = (page, pages) => ({ stack: [{ text: `Vertraulich: enthält ${confidential.join(', ')}. Nicht an Dritte weitergeben.`, fontSize: 7, color: '#C00000', margin: [36, 6, 36, 0] }, base(page, pages)] })
  }
  return doc
}
