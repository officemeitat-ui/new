// Objektblatt / Leistungsverzeichnis / Objektakte als PDF. Inhalt nach
// Abschnitten wählbar; vertrauliche Abschnitte sind in der Fußzeile
// vermerkt und kommen in der Kundenfassung nie vor (core/objektmappe.js).
// Feste Texte auf Deutsch, Englisch oder Rumänisch (objektblatt-i18n.js).

import { formatHours } from '../core/dates.js'
import { areaMinutes, areaSize, LV_INTERVALS, roomsSize, SECTIONS, serviceMinutes } from '../core/objektmappe.js'
import { sheetText } from './objektblatt-i18n.js'
import { docShell, GREY, header, inkColors, tableLayout } from './pdf-parts.js'

/**
 * data: { object, mappe, tasks: [{ label, recurrence, start, end, staff, regularNames }], waste, meters: [{ location, number, kind }],
 *         inspection: { date, overall, defects: [{ id, text, rating, note }] }, keys: [{ label, holder }], plannedMinutes,
 *         images: { fotoId: dataUrl } }   Fotos der Mappe, bereits geladen
 */
export function objektblattDocument(data, { sections, customer = false, lang = 'de', brand = { name: '', product: '' }, logo = null, createdAt = new Date() } = {}) {
  const t = sheetText(lang)
  const colors = inkColors(brand)
  const { object, mappe = {} } = data
  const has = (id) => sections.includes(id)
  const date = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString(t.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
  const interval = (code) => t.interval(code, LV_INTERVALS[code]?.label || '')
  const daysText = (r) => {
    if (r.type === 'once') return `${t('once')} ${date(r.date)}`
    if (r.type === 'monthly') return r.everyMonths > 1 ? t('everyMonths', { n: r.everyMonths }) : t('monthly')
    const days = (r.weekdays || []).map(t.weekday).join(', ')
    return `${days}${r.everyWeeks > 1 ? ` (${t('everyWeeks', { n: r.everyWeeks })})` : ''}`
  }
  const title = customer ? t('title.lv') : has('stunden') ? t('title.file') : t('title.sheet')
  const confidential = SECTIONS.filter((s) => s.confidential && has(s.id)).map((s) => t(`sec.${s.id}`))
  const content = [...header({ title, subtitle: [object.name, mappe.objectNo ? `${t('objectNo')} ${mappe.objectNo}` : '', mappe.customerNo ? `${t('customerNo')} ${mappe.customerNo}` : ''].filter(Boolean).join(' · '), brand, logo, colors })]
  if (t('freeText')) content.push({ text: t('freeText'), fontSize: 7.5, italics: true, color: GREY, margin: [0, 0, 0, 2] })
  const section = (id) => content.push({ text: t(`sec.${id}`), style: 'section' })
  const kv = (rows) => content.push({ table: { widths: [110, '*'], body: rows.filter(([, v]) => v).map(([k, v]) => [{ text: k, color: GREY }, v]) }, layout: 'noBorders' })
  const table = (head, rows, widths) => content.push({ table: { headerRows: 1, dontBreakRows: true, widths, body: [head.map((x) => ({ text: x, style: 'th' })), ...rows] }, layout: tableLayout(colors) })
  const photoGrid = (list) => {
    const shown = list.filter((p) => data.images?.[p.id])
    for (let i = 0; i < shown.length; i += 2) {
      content.push({
        columns: shown.slice(i, i + 2).map((p) => ({ width: 250, stack: [{ image: data.images[p.id], fit: [250, 180] }, { text: [p.title, p.area, p.text].filter(Boolean).join(' · '), fontSize: 7.5, color: GREY, margin: [0, 2, 0, 0] }] })),
        columnGap: 18,
        margin: [0, 6, 0, 0],
        unbreakable: true,
      })
    }
  }
  const photos = (kind) => (mappe.photos || []).filter((p) => (p.kind || 'ablauf') === kind)

  if (has('objekt')) {
    section('objekt')
    kv([
      [t('object'), object.name],
      [t('address'), [mappe.street, object.address].filter(Boolean).join(', ')],
      [t('client'), mappe.customer],
      [t('kind'), mappe.kind],
      [t('contract'), [mappe.contract, mappe.validFrom ? `${t('validFrom')} ${date(mappe.validFrom)}` : ''].filter(Boolean).join(', ')],
      [t('manager'), [mappe.manager, mappe.deputy ? `${t('deputy')}: ${mappe.deputy}` : ''].filter(Boolean).join(' · ')],
      [t('region'), customer ? '' : object.region],
    ])
  }
  if (has('kontakte') && mappe.contacts?.length) {
    section('kontakte')
    table([t('name'), t('role'), t('phone'), t('mail'), t('note')], mappe.contacts.map((c) => [{ text: c.name || '', bold: true }, c.role || '', c.phone || '', c.mail || '', { text: [c.note, c.internal ? t('internal') : ''].filter(Boolean).join(' · '), fontSize: 7.5, color: GREY }]), [90, 80, 80, '*', 90])
  }
  const windows = mappe.timeWindows || []
  if (has('zeiten') && (data.tasks?.length || windows.length || mappe.serviceDays?.length || mappe.timeNote)) {
    section('zeiten')
    if (mappe.serviceDays?.length) kv([[t('serviceDays'), mappe.serviceDays.map(t.dayName).join(', ')]])
    if (windows.length) table([t('window'), t('from'), t('to'), t('note')], windows.map((w) => [w.days || '', w.from || '', w.to || '', w.note || '']), [120, 50, 50, '*'])
    if (mappe.timeNote) content.push({ text: mappe.timeNote, margin: [0, 3, 0, 3] })
    if (data.tasks?.length) table(customer ? [t('task'), t('days'), t('time'), t('staff')] : [t('task'), t('days'), t('time'), t('staff'), t('regular')], data.tasks.map((x) => [x.label, daysText(x.recurrence), `${x.start}–${x.end}`, { text: String(x.staff || 1), alignment: 'center' }, ...(customer ? [] : [x.regularNames || ''])]), customer ? ['*', 120, 70, 50] : ['*', 110, 62, 40, 100])
  }
  if (has('zugang') && (mappe.access?.length || data.keys?.length || photos('zugang').length)) {
    section('zugang')
    if (mappe.access?.length || data.keys?.length) table([t('label'), t('number'), t('type'), t('count'), t('where')], [...(mappe.access || []).map((a) => [{ text: a.label || '', bold: true }, a.number || '', a.type || '', { text: String(a.count || ''), alignment: 'center' }, [a.place, a.note].filter(Boolean).join(' · ')]), ...(data.keys || []).map((k) => [{ text: k.label, bold: true }, '', t('key'), '1', k.holder || t('office')])], ['*', 50, 60, 40, 150])
    content.push({ text: t('noCodes'), fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] })
    photoGrid(photos('zugang'))
  }
  if (has('hinweise') && (mappe.notes || object.instructions || object.contact)) {
    section('hinweise')
    for (const x of [object.instructions, mappe.notes, !customer && object.contact ? `${t('contactPlan')}: ${object.contact}` : ''].filter(Boolean)) content.push({ text: x, margin: [0, 0, 0, 4] })
  }
  if (has('leistungen') && mappe.areas?.length) {
    section('leistungen')
    const withTimes = has('stunden')
    for (const a of mappe.areas) {
      const size = areaSize(a)
      content.push({ text: [{ text: a.name || t('area'), bold: true }, { text: [a.location, size ? `${size.toLocaleString(t.locale)} m²` : '', a.floor].filter(Boolean).map((x) => `   ${x}`).join(''), color: GREY }], margin: [0, 6, 0, 3] })
      if (!a.services?.length) continue
      table(withTimes ? [t('task'), t('interval'), t('method'), t('min'), t('hWeek')] : [t('task'), t('interval'), t('method')], a.services.map((s) => [s.what || '', interval(s.interval), s.method || '', ...(withTimes ? [{ text: String(s.minutes || ''), alignment: 'right' }, { text: formatHours(serviceMinutes(s)), alignment: 'right' }] : [])]), withTimes ? ['*', 110, 90, 36, 50] : ['*', 120, 120])
    }
  }
  const withRooms = (mappe.areas || []).filter((a) => a.rooms?.length)
  if (has('raeume') && withRooms.length) {
    section('raeume')
    for (const a of withRooms) {
      content.push({ text: a.name || t('area'), bold: true, margin: [0, 6, 0, 3] })
      table([t('number'), t('room'), t('size'), t('floor'), t('note')], [...a.rooms.map((r) => [r.no || '', r.name || '', { text: r.size ? Number(r.size).toLocaleString(t.locale) : '', alignment: 'right' }, r.floor || '', r.note || '']), [{ text: t('roomsTotal'), bold: true, colSpan: 2 }, '', { text: roomsSize(a).toLocaleString(t.locale), alignment: 'right', bold: true }, '', '']], [40, '*', 45, 80, 130])
    }
  }
  if (has('fotos') && photos('ablauf').some((p) => data.images?.[p.id])) {
    section('fotos')
    photoGrid(photos('ablauf'))
  }
  if (has('stunden') && mappe.areas?.length) {
    section('stunden')
    const total = mappe.areas.reduce((x, a) => x + areaMinutes(a), 0)
    const cells = (min, extra = {}) => [1, 52 / 12, 52].map((f) => ({ text: formatHours(min * f), alignment: 'right', ...extra }))
    table([t('area'), t('hWeek'), t('hMonth'), t('hYear')], [...mappe.areas.map((a) => [a.name || '', ...cells(areaMinutes(a))]), [{ text: t('totalLv'), bold: true }, ...cells(total, { bold: true })], ...(data.plannedMinutes ? [[{ text: t('perPlan'), color: GREY }, ...cells(data.plannedMinutes, { color: GREY })]] : [])], ['*', 70, 70, 70])
  }
  if (has('geraete') && mappe.devices?.length) {
    section('geraete')
    table([t('device'), t('place'), t('inventory'), t('owner'), t('condition')], mappe.devices.map((d) => [d.label || '', d.place || '', d.inventoryNo || '', d.owner === 'Kunde' || d.owner === 'gemietet' ? t(`owner.${d.owner}`) : brand.name || t('owner.eigen'), d.condition || '']), ['*', 110, 70, 60, 70])
  }
  if (has('muell') && data.waste) {
    section('muell')
    content.push({ text: data.waste })
  }
  if (has('zaehler') && data.meters?.length) {
    section('zaehler')
    table([t('meter'), t('meterNo'), t('type')], data.meters.map((m) => [m.location || '', m.number || '', m.kind || '']), ['*', 100, 100])
  }
  if (has('kontrolle') && data.inspection) {
    section('kontrolle')
    kv([[t('lastCheck'), `${date(data.inspection.date)} · ${data.inspection.overall || ''}`]])
    if (data.inspection.defects?.length) table([t('point'), t('rating'), t('defect')], data.inspection.defects.map((d) => [d.id, d.rating, `${d.text}${d.note ? ` – ${d.note}` : ''}`]), [36, 30, '*'])
  }
  if (has('anhaenge') && mappe.attachments?.length) {
    section('anhaenge')
    table([t('document'), t('storage')], mappe.attachments.map((a) => [a.name || '', { text: a.url || a.note || '', link: a.url || undefined, color: colors.ink, fontSize: 7.5 }]), [170, '*'])
  }
  if (has('unterschrift')) {
    content.push({ columns: [0, 1].map((i) => ({ stack: [{ text: ' ', margin: [0, 36, 0, 0] }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5, lineColor: GREY }] }, { text: i ? t('signClient') : `${brand.name || t('signContractor')} ${t('signDate')}`, fontSize: 8 }] })), columnGap: 40, margin: [0, 18, 0, 0], unbreakable: true })
  }
  const doc = docShell(content, { brand, colors, createdAt, title: `${title} ${object.name}`, labels: { created: t('created'), page: (p, n) => t('page', { p, n }), locale: t.locale } })
  if (confidential.length) {
    const base = doc.footer
    doc.footer = (page, pages) => ({ stack: [{ text: t('confidential', { list: confidential.join(', ') }), fontSize: 7, color: '#C00000', margin: [36, 6, 36, 0] }, base(page, pages)] })
  }
  return doc
}
