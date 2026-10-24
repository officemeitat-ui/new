// Automatisch planen und Woche veröffentlichen.

import { addDays, formatDate, isoWeek, mondayOf } from '../core/dates.js'
import { saldoCorrections } from '../core/attention.js'
import { mondaysBetween } from '../core/reports.js'
import { autoPlan } from '../core/scheduler.js'
import { timesheetSignature } from '../core/timesheet.js'
import { weekFileBase } from '../export/excel.js'
import { addLog, app, compute, currentMonth, persist, recordUndo, renderNow, toast, touch, windowFor } from './context.js'
import { allPdfName, pdfFileName, weekPdfBlob } from './pdf.js'
import { download } from './shared.js'
import { weekWorkbookBlob } from './views/sheet.js'

export function planWeek(replan = false, { silent = false } = {}) {
  const c = app.cur
  if (!silent) recordUndo(replan ? 'Neu planen' : 'Woche planen')
  const res = autoPlan(c.ctx, c.instances, app.data.assignments, { from: c.monday, to: c.sunday, replan })
  app.data.assignments = res.assignments
  const parts = [`${res.stats.regular} Stammeinsätze`, `${res.stats.substitute} Vertretungen`]
  if (res.stats.other) parts.push(`${res.stats.other} weitere`)
  if (res.stats.released) parts.push(`${res.stats.released} wegen Abwesenheit neu vergeben`)
  addLog(c.monday, `${replan ? 'Neu geplant' : 'Automatisch geplant'}: ${parts.join(', ')}, ${res.open.length} offen`)
  persist()
  if (silent) return res
  renderNow()
  toast(`Eingeteilt: ${parts.join(', ')}. ${res.open.length === 1 ? '1 Einsatz bleibt offen.' : res.open.length ? `${res.open.length} Einsätze bleiben offen.` : 'Alles besetzt.'}`)
  return res
}

/** Änderungen je Person seit der letzten Veröffentlichung. */
export function changedEmployees(c) {
  return c.published?.snapshot ? c.ctx.employees.filter((e) => c.changedSincePublish(e)) : []
}

/** Text für Änderungsmitteilung (Teams, SMS, WhatsApp). */
export function changeMessage(c, emp) {
  const ts = c.timesheet(emp)
  const lines = [`Hallo ${emp.name.split(' ')[0]}, dein Wochenplan KW ${isoWeek(c.monday).week} wurde geändert:`]
  for (const day of ts.days) {
    const work = day.lines.filter((l) => l.kind === 'work')
    if (!work.length) continue
    lines.push(`${formatDate(day.date)}: ${work.map((l) => `${l.time} ${l.text.replace('Objekt: ', '')}`).join(', ')}`)
  }
  return lines.join('\n')
}

/** Aktuelle Salden aller Personen einer Woche. */
export function currentSaldi(c) {
  return Object.fromEntries(c.ctx.employees.map((emp) => [emp.id, c.timesheet(emp).totals.saldo]))
}

/**
 * Salden und Signaturen einer Woche festhalten (ohne Dateien). War die Woche
 * schon veröffentlicht, werden die Saldo-Unterschiede als Korrektur gebucht
 * (rückwirkende Änderungen, z. B. nachträgliche Krankmeldung).
 */
export function snapshotWeek(c, extra = {}) {
  const saldi = currentSaldi(c)
  const snapshot = Object.fromEntries(c.ctx.employees.map((emp) => [emp.id, timesheetSignature(c.timesheet(emp))]))
  app.data.published = app.data.published || {}
  touch()
  const previous = app.data.published[c.monday]
  const at = new Date().toISOString()
  const by = app.user?.name || 'Browser'
  const corrections = [...(previous?.corrections || [])]
  if (previous?.saldi) for (const corr of saldoCorrections(previous.saldi, saldi)) corrections.push({ ...corr, at, by })
  app.data.published[c.monday] = {
    status: 'veroeffentlicht',
    publishedAt: previous?.publishedAt || at,
    publishedBy: previous?.publishedBy || by,
    ...(previous ? { correctedAt: at, correctedBy: by } : {}),
    saldi,
    snapshot,
    ...(corrections.length ? { corrections } : {}),
    ...(previous?.sent ? { sent: previous.sent } : {}),
    ...(previous?.files ? { files: previous.files } : {}),
    ...extra,
  }
  return corrections.length - (previous?.corrections || []).length
}

/**
 * Beispieldaten mit Vorgeschichte: die Wochen davor werden eingeteilt und
 * veröffentlicht (Zeitkonto, Monatsauswertung), die aktuelle Woche eingeteilt.
 */
export async function seedDemoHistory(weeksBefore = 4) {
  const start = app.ui.monday
  // Nachgereichte Krankmeldungen erst nach dem Veröffentlichen eintragen
  const late = app.data.absences.filter((a) => a.reportedAfterPublish)
  app.data.absences = app.data.absences.filter((a) => !a.reportedAfterPublish)
  for (let i = -weeksBefore; i <= 0; i++) {
    app.ui.monday = addDays(start, i * 7)
    const { from, to } = windowFor(app.ui.monday, currentMonth())
    await app.service.ensureWeeks(mondaysBetween(from, to))
    app.cur = compute()
    planWeek(false, { silent: true })
    if (i < 0) {
      app.cur = compute()
      snapshotWeek(app.cur, { publishedBy: 'Beispieldaten' })
    }
  }
  for (const a of late) {
    delete a.reportedAfterPublish
    app.data.absences.push(a)
    addLog(mondayOf(a.from), `${a.type} nachgetragen: ${app.data.employees.find((e) => e.id === a.employeeId)?.name} ${formatDate(a.from)}`)
  }
  app.ui.monday = start
  app.cur = compute()
  persist()
}

/** Excel- und PDF-Wochenpläne in die Ablage (SharePoint) bzw. als Download. */
async function exportFiles(c, result) {
  const { features } = app.config
  const employees = c.ctx.employees
  const base = weekFileBase(c.monday)
  const folder = `exporte/${c.monday.slice(0, 4)}/${base}`
  const clean = (name) => name.replace(/[\\/:*?"<>|]/g, '')
  if (app.store.kind === 'sharepoint') {
    const upload = async (path, blob) => {
      const up = await app.store.upload(`${folder}/${path}`, blob, blob.type)
      result.webUrl = result.webUrl || (app.store.webUrl ? `${app.store.webUrl}/${folder}` : up.webUrl)
      result.files++
    }
    if (features.excel) {
      await upload(`Wochenplan_${base}_alle.xlsx`, await weekWorkbookBlob(c, employees))
      for (const emp of employees) await upload(`Mitarbeitende/${clean(emp.name)}.xlsx`, await weekWorkbookBlob(c, [emp]))
    }
    if (features.pdf) {
      await upload(allPdfName(c), await weekPdfBlob(c, employees))
      for (const emp of employees) await upload(`PDF/${pdfFileName(c.monday, clean(emp.name))}`, await weekPdfBlob(c, [emp]))
    }
  } else if (features.excel && features.download) {
    download(`Wochenplan_${base}_alle.xlsx`, await weekWorkbookBlob(c, employees))
    result.files = 1
  }
}

/**
 * Woche veröffentlichen: Salden ins Zeitkonto, Signaturen für die
 * Änderungserkennung, Excel- und PDF-Wochenpläne in die Ablage (SharePoint)
 * bzw. als Download. War die Woche schon veröffentlicht, wird die Korrektur
 * gebucht. Scheitert der Dateiexport, bleibt die Veröffentlichung gültig.
 */
export async function publishWeek({ files = true, c = app.cur } = {}) {
  const result = { webUrl: null, files: 0, corrections: 0, fileError: null }
  const wasPublished = !!app.data.published?.[c.monday]
  result.corrections = snapshotWeek(c)
  if (files) {
    try {
      await exportFiles(compute(c.monday), result) // neu berechnet: mit Veröffentlichungsvermerk
    } catch (err) {
      result.fileError = err.message
    }
    if (result.webUrl) app.data.published[c.monday].files = result.webUrl
  }
  addLog(c.monday, `${wasPublished ? 'Korrektur gebucht' : 'Woche veröffentlicht'}${result.corrections ? ` (${result.corrections} Saldo-Korrekturen)` : ''}${result.files ? `, ${result.files} Dateien` : ''}${result.fileError ? `, Dateiexport fehlgeschlagen: ${result.fileError}` : ''}`)
  persist()
  await app.service.flush()
  renderNow()
  return result
}
