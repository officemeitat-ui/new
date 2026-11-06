// PDF-Wochenpläne im Browser erzeugen. pdfmake (mit Schrift Roboto, inkl.
// č, ć, ş, ğ …) und JSZip werden erst geladen, wenn sie gebraucht werden.

import { todayISO } from '../core/dates.js'
import { timeAccount } from '../core/reports.js'
import { timesheetSignature } from '../core/timesheet.js'
import { pdfFileName, timesheetDocument } from '../export/pdf.js'
import { weekFileBase } from '../export/excel.js'
import { app } from './context.js'
import { loadScript } from './load-script.js'

export { pdfFileName }

export async function loadPdfMake() {
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

/** Stand-Vermerk zum Übersetzen (export/pdf.js schreibt ihn in der Sprache der Person). */
function pdfStatusInfo(c) {
  const p = c.published
  if (!p) return { kind: 'entwurf' }
  return { kind: p.correctedAt ? 'korrigiert' : 'veroeffentlicht', date: todayISO(new Date(p.correctedAt || p.publishedAt)) }
}

/** Zeitkonto inkl. dieser Woche (veröffentlichte Vorwochen + aktueller Saldo). */
export function accountAfterWeek(c, emp) {
  // Vorwochen aus dem Zeitkonto, diese Woche mit ihrem aktuellen Saldo; Monatsabschlüsse bis Sonntag dieser Woche (wie in der Ansicht)
  const before = Object.fromEntries(Object.entries(app.data.published || {}).filter(([monday]) => monday < c.monday))
  return timeAccount(emp, before, c.monday, app.data.payroll) + c.timesheet(emp).totals.saldo
}

const cache = new Map()
let logoPromise = null

/** Logo für helle Hintergründe (config.json → brand.logoOnLight) für das PDF laden. */
export function loadLogo() {
  const url = app.config.brand.logoOnLight
  if (!url) return Promise.resolve(null)
  logoPromise =
    logoPromise ||
    fetch(url)
      .then(async (res) => {
        if (!res.ok) return null
        if (/svg/.test(res.headers.get('content-type') || '') || url.endsWith('.svg')) return { svg: await res.text() }
        const blob = await res.blob()
        return { image: await new Promise((resolve) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result) }).readAsDataURL(blob)) }
      })
      .catch(() => null)
  return logoPromise
}

/** PDF mit je einer Seite pro Person (Ergebnis wird bis zur nächsten Änderung zwischengespeichert). */
export async function weekPdfBlob(c, employees) {
  const key = `${c.monday}|${pdfStatus(c)}|${employees.map((e) => `${e.id}:${e.lang || ''}:${timesheetSignature(c.timesheet(e))}:${accountAfterWeek(c, e)}`).join(',')}`
  if (cache.has(key)) return cache.get(key)
  const [pdfMake, logo] = await Promise.all([loadPdfMake(), loadLogo()])
  const doc = timesheetDocument(
    employees.map((emp) => ({ ts: c.timesheet(emp), account: accountAfterWeek(c, emp) })),
    { objects: app.data.objects, employees: app.data.employees, brand: app.config.brand, status: pdfStatusInfo(c), contact: app.config.brand.contact || '', logo },
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

/** Beliebige pdfmake-Dokumentbeschreibung als Blob. */
export async function pdfBlob(doc) {
  const pdfMake = await loadPdfMake()
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob(resolve)
    } catch (err) {
      reject(err)
    }
  })
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
