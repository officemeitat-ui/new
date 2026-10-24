// Excel-Export der Wochenzettel im Layout des bisherigen Wochenplans:
// graublaue Tagesbänder, "Objekt:"-Zeilen, durchgestrichen = entfällt,
// rot = Vertretung/verschoben, grün = Sonderleistung, gelbe GESAMT-Zeile.
// ExcelJS wird übergeben (Browser: vendor/exceljs.min.js, Node: Paket).

import { formatDate, isoWeek, isoWeekday, WEEKDAY_LONG } from '../core/dates.js'

const BAND = 'FFD9E1F2'
const TOTAL = 'FFFFF2CC'
const RED = 'FFC00000'
const GREEN = 'FF00A651'
const hours = (min) => (min ? Math.round((min / 60) * 100) / 100 : null)
const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }

function sheetName(name, used) {
  let base = name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28)
  let candidate = base
  for (let i = 2; used.has(candidate); i++) candidate = `${base.slice(0, 26)} ${i}`
  used.add(candidate)
  return candidate
}

function addTimesheet(wb, ts, used, { brand } = {}) {
  const ws = wb.addWorksheet(sheetName(ts.employee.name, used), {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: brand ? { oddFooter: `&L${brand}&RSeite &P von &N` } : undefined,
  })
  ws.columns = [
    { key: 'time', width: 15 },
    { key: 'text', width: 58 },
    { key: 'hours', width: 9 },
    { key: 'credited', width: 12 },
    { key: 'travel', width: 9 },
    { key: 'notes', width: 42 },
  ]
  const head = ws.addRow([ts.employee.name, `Wochenplan von ${formatDate(ts.monday, { weekday: false, year: true })} - ${formatDate(ts.sunday, { weekday: false, year: true })}`, 'Std.', 'Arbeitszeit', 'Fahrzeit', 'Hinweis'])
  head.font = { bold: true, size: 11 }
  head.eachCell((c) => (c.border = { ...border, top: { style: 'medium' } }))

  for (const day of ts.days) {
    const note = [day.holiday ? (day.holiday.legal ? 'Feiertag' : day.holiday.name) : '', day.absence?.type || ''].filter(Boolean).join(' · ')
    const row = ws.addRow([WEEKDAY_LONG[isoWeekday(day.date) - 1], note, null, null, null, day.total ? `Tag gesamt: ${hours(day.total)} h` : null])
    row.font = { bold: true }
    row.getCell(1).alignment = { horizontal: 'center' }
    row.getCell(2).font = { bold: true, color: { argb: RED } }
    row.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
      c.border = border
    })
    const lines = day.lines.length ? day.lines : [{ time: '', text: day.absence ? day.absence.type : 'frei', hours: 0, credited: 0, travel: 0, notes: [], style: 'empty' }]
    for (const l of lines) {
      const r = ws.addRow([l.time, l.text, hours(l.hours), hours(l.credited), hours(l.travel), l.notes.join(' · ') || null])
      r.getCell(1).alignment = { horizontal: 'center' }
      for (const i of [3, 4, 5]) r.getCell(i).alignment = { horizontal: 'center' }
      r.getCell(6).font = { size: 9, color: { argb: 'FF595959' } }
      const color = l.style === 'changed' ? RED : l.style === 'special' ? GREEN : undefined
      for (const i of [1, 2]) r.getCell(i).font = { bold: i === 1, strike: l.style === 'struck', color: color ? { argb: color } : undefined }
      r.eachCell({ includeEmpty: true }, (c) => (c.border = border))
    }
  }
  const t = ts.totals
  const total = ws.addRow(['GESAMT', `Saldo ${t.saldo > 0 ? '+' : ''}${hours(t.saldo) ?? 0}`, hours(t.soll), hours(t.credited) ?? 0, hours(t.travel) ?? 0, `Soll ${hours(t.soll) ?? 0} h · Ist ${hours(t.ist) ?? 0} h`])
  total.font = { bold: true }
  total.getCell(2).alignment = { horizontal: 'center' }
  total.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL } }
    c.border = { ...border, bottom: { style: 'medium' } }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return ws
}

/** Arbeitsmappe mit je einem Blatt pro Wochenzettel. */
export function buildTimesheetWorkbook(ExcelJS, timesheets, { brand = '', creator = '' } = {}) {
  const wb = new ExcelJS.Workbook()
  wb.creator = creator || brand
  wb.created = new Date()
  const used = new Set()
  for (const ts of timesheets) addTimesheet(wb, ts, used, { brand })
  return wb
}

export function weekFileBase(monday) {
  const { year, week } = isoWeek(monday)
  return `KW${String(week).padStart(2, '0')}_${year}`
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function workbookBlob(wb) {
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: XLSX_TYPE })
}
