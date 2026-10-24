// Automatisch planen und Woche veröffentlichen.

import { addDays, formatDate, isoWeek } from '../core/dates.js'
import { mondaysBetween } from '../core/reports.js'
import { autoPlan } from '../core/scheduler.js'
import { timesheetSignature } from '../core/timesheet.js'
import { weekFileBase } from '../export/excel.js'
import { addLog, app, compute, currentMonth, persist, renderNow, toast, windowFor } from './context.js'
import { download } from './shared.js'
import { weekWorkbookBlob } from './views/sheet.js'

export function planWeek(replan = false, { silent = false } = {}) {
  const c = app.cur
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

/** Salden und Signaturen einer Woche festhalten (ohne Dateien). */
export function snapshotWeek(c, extra = {}) {
  const saldi = {}
  const snapshot = {}
  for (const emp of c.ctx.employees) {
    const ts = c.timesheet(emp)
    saldi[emp.id] = ts.totals.saldo
    snapshot[emp.id] = timesheetSignature(ts)
  }
  app.data.published = app.data.published || {}
  app.data.published[c.monday] = { status: 'veroeffentlicht', publishedAt: new Date().toISOString(), publishedBy: app.user?.name || 'Browser', saldi, snapshot, ...extra }
}

/**
 * Beispieldaten mit Vorgeschichte: die Wochen davor werden eingeteilt und
 * veröffentlicht (Zeitkonto, Monatsauswertung), die aktuelle Woche eingeteilt.
 */
export async function seedDemoHistory(weeksBefore = 4) {
  const start = app.ui.monday
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
  app.ui.monday = start
  app.cur = compute()
}

/**
 * Woche veröffentlichen: Salden ins Zeitkonto, Signaturen für die
 * Änderungserkennung, Excel-Wochenpläne in die Ablage (SharePoint) bzw. als Download.
 */
export async function publishWeek({ files = true } = {}) {
  const c = app.cur
  const employees = c.ctx.employees
  const result = { webUrl: null, files: 0 }
  if (files && app.config.features.excel) {
    const base = weekFileBase(c.monday)
    const folder = `exporte/${c.monday.slice(0, 4)}/${base}`
    const all = await weekWorkbookBlob(c, employees)
    if (app.store.kind === 'sharepoint') {
      const up = await app.store.upload(`${folder}/Wochenplan_${base}_alle.xlsx`, all, all.type)
      result.webUrl = app.store.webUrl ? `${app.store.webUrl}/${folder}` : up.webUrl
      result.files = 1
      for (const emp of employees) {
        const blob = await weekWorkbookBlob(c, [emp])
        await app.store.upload(`${folder}/Mitarbeitende/${emp.name.replace(/[\\/:*?"<>|]/g, '')}.xlsx`, blob, blob.type)
        result.files++
      }
    } else if (app.config.features.download) {
      download(`Wochenplan_${base}_alle.xlsx`, all)
      result.files = 1
    }
  }
  snapshotWeek(c, { files: result.webUrl })
  addLog(c.monday, `Woche veröffentlicht${result.files ? ` (${result.files} Excel-Dateien)` : ''}`)
  persist()
  await app.service.flush()
  renderNow()
  return result
}
