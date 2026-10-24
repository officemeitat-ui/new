// PDF-Wochenpläne im Browser erzeugen. pdfmake (mit Schrift Roboto, inkl.
// č, ć, ş, ğ …) und JSZip werden erst geladen, wenn sie gebraucht werden.

import { addDays } from '../core/dates.js'
import { timeAccount } from '../core/reports.js'
import { timesheetSignature } from '../core/timesheet.js'
import { pdfFileName, timesheetDocument } from '../export/pdf.js'
import { weekFileBase } from '../export/excel.js'
import { app } from './context.js'
import { loadScript } from './load-script.js'

export { pdfFileName }

async function loadPdfMake() {
  await loadScript('vendor/pdfmake.min.js')
  await loadScript('vendor/vfs_fonts.js')
  return globalThis.pdfMake
}

/** Stand-Vermerk auf dem PDF: veröffentlicht/korrigiert am … oder Entwurf. */
export function pdfStatus(c) {
  const p = c.published
  if (!p) return 'Entwurf'
  const at = new Date(p.correctedAt || p.publishedAt).toLocaleDateString('de-AT')
  return `${p.correctedAt ? 'korrigiert' : 'veröffentlicht'} am ${at}`
}

/** Zeitkonto inkl. dieser Woche (veröffentlichte Vorwochen + aktueller Saldo). */
export function accountAfterWeek(c, emp) {
  return timeAccount(emp, app.data.published, addDays(c.monday, -1)) + c.timesheet(emp).totals.saldo
}

const cache = new Map()

/** PDF mit je einer Seite pro Person (Ergebnis wird bis zur nächsten Änderung zwischengespeichert). */
export async function weekPdfBlob(c, employees) {
  const key = `${c.monday}|${pdfStatus(c)}|${employees.map((e) => `${e.id}:${timesheetSignature(c.timesheet(e))}:${accountAfterWeek(c, e)}`).join(',')}`
  if (cache.has(key)) return cache.get(key)
  const pdfMake = await loadPdfMake()
  const doc = timesheetDocument(
    employees.map((emp) => ({ ts: c.timesheet(emp), account: accountAfterWeek(c, emp) })),
    { objects: app.data.objects, employees: app.data.employees, brand: app.config.brand, status: pdfStatus(c), contact: app.config.brand.contact || '' },
  )
  const blob = await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob(resolve)
    } catch (err) {
      reject(err)
    }
  })
  if (cache.size > 60) cache.delete(cache.keys().next().value)
  cache.set(key, blob)
  return blob
}

export const allPdfName = (c) => `Wochenplaene_${weekFileBase(c.monday)}_alle.pdf`

/** ZIP mit einem PDF je Person (zum Weiterleiten). */
export async function weekPdfZip(c, employees, onProgress = () => {}) {
  await loadScript('vendor/jszip.min.js')
  const zip = new globalThis.JSZip()
  for (const [i, emp] of employees.entries()) {
    onProgress(i + 1, employees.length)
    zip.file(pdfFileName(c.monday, emp.name), await weekPdfBlob(c, [emp]))
  }
  return zip.generateAsync({ type: 'blob' })
}
