// Überstunden & Auszahlung: Monatsabrechnung je Person nach AZG und KV
// (Mehrarbeit, Überstunden, Nacht-/Sonn-/Feiertagszuschläge), Behandlung
// (auszahlen oder Zeitausgleich), Monatsabschluss mit Buchung ins Zeitkonto,
// CSV für die Lohnverrechnung.

import { drPeriod } from '../../core/contract.js'
import { addDays, formatDate, formatHours, isoWeek, lastOfMonth, mondayOf, MONTH_LONG } from '../../core/dates.js'
import { classifyWeek, closureRow, HOUR_TYPES, MEHR_MODES, payMonth, payrollWeeks, TIME_CLASSES, UE_MODES } from '../../core/overtime.js'
import { mondaysBetween, toCSV } from '../../core/reports.js'
import { mergeRules } from '../../core/rules.js'
import { buildTimesheet } from '../../core/timesheet.js'
import { app, computeRange, confirmStep, currentMonth, dataStamp, openModal, persist, recordUndo, registerActions, registerModal, registerView, renderNow, toast } from '../context.js'
import { download, esc, euro, ICON, modalFrame, options, saldoClass, signed } from '../shared.js'
import { monthPicker } from './controlling.js'
import { copyText } from './sheet.js'
import { filterBar, filteredEmployees } from './week.js'

const h = (min) => (min ? formatHours(min) : '<span class="muted">–</span>')
const firstWeek = (month) => payrollWeeks(month, mergeRules(app.data.rules))[0]

// Wochen mit Daten: eingeteilt oder veröffentlicht. Andere zählen nicht (sonst wären sie lauter Minusstunden).
function knownWeeks() {
  const weeks = new Set(Object.keys(app.data.published || {}))
  for (const key of Object.keys(app.data.assignments || {})) weeks.add(mondayOf(key.slice(0, 10)))
  return weeks
}

const cache = new Map()
/** Abrechnung aller Personen für einen Monat (zwischengespeichert, bis sich Daten ändern). */
export function payroll(month) {
  const key = `${dataStamp()}|${month}`
  if (cache.has(key)) return cache.get(key)
  if (cache.size > 4) cache.delete(cache.keys().next().value)
  const weeks = payrollWeeks(month, mergeRules(app.data.rules))
  const from = `${month}-01`
  const to = lastOfMonth(from)
  // Durchrechnung: alle Wochen ab Beginn des Zeitraums, der in diesem Monat läuft oder endet
  const drStart = (emp) => [drPeriod(emp, from), drPeriod(emp, to)].filter(Boolean).map((x) => x.start).sort()[0]
  const first = [weeks[0], ...app.data.employees.map(drStart).filter(Boolean)].sort()[0]
  const range = computeRange(first, to)
  const known = knownWeeks()
  const used = weeks.filter((m) => known.has(m))
  const weeksOf = (emp) => {
    const start = drStart(emp)
    if (!start || start >= weeks[0]) return used
    const before = []
    for (let m = start; m < weeks[0]; m = addDays(m, 7)) if (known.has(m)) before.push(m)
    return [...before, ...used]
  }
  const closures = app.data.payroll || {}
  const modesOf = (id) => closures[month]?.modes?.[id] || {}
  const rows = range.ctx.employees.map((emp) => payMonth(range.ctx, emp, month, weeksOf(emp).map((m) => classifyWeek(range.ctx, buildTimesheet(range.ctx, emp, m, range.instances, range.state))), { closures, modes: modesOf(emp.id) }))
  const monthWeeks = mondaysBetween(`${month}-01`, lastOfMonth(`${month}-01`))
  const result = { rows, rules: range.ctx.rules, missing: monthWeeks.filter((m) => !known.has(m)), range }
  cache.set(key, result)
  return result
}

const relevant = (r) => r.total.mehr || r.total.ue || r.total.ue11 || r.mehr.dueMin || r.mehr.openMin || r.amount || r.zaBonus || r.durchrechnung?.balance

/** Durchrechnung (KV): Saldo des laufenden Zeitraums bzw. abgerechnetes Guthaben. */
function drText(r) {
  const d = r.durchrechnung
  if (!d) return ''
  const end = formatDate(d.end, { weekday: false })
  if (d.endsInMonth) {
    if (d.settled) return `Durchrechnung bis ${end}: ${formatHours(d.settled)} h Guthaben als Überstunden`
    return d.balance < 0 ? `Durchrechnung bis ${end}: endet mit −${formatHours(-d.balance)} h (bleibt im Zeitkonto)` : `Durchrechnung bis ${end}: ausgeglichen`
  }
  return `Durchrechnung bis ${end}: Saldo ${d.balance >= 0 ? '+' : '−'}${formatHours(Math.abs(d.balance))} h`
}

function modeSelects(r, month, locked) {
  const id = esc(r.employee.id)
  const dis = locked || app.readOnly ? 'disabled' : ''
  const ue = r.total.ue || r.total.ue11 ? `<label class="field"><span>Überstunden</span><select data-change="ot-mode" data-emp="${id}" data-kind="ue" data-month="${month}" ${dis}>${options(Object.entries(UE_MODES), r.ueMode)}</select></label>` : ''
  const mehr = r.total.mehr || r.mehr.openMin || r.mehr.dueMin ? `<label class="field"><span>Mehrarbeit</span><select data-change="ot-mode" data-emp="${id}" data-kind="mehr" data-month="${month}" ${dis}>${options(Object.entries(MEHR_MODES), r.mehrMode)}</select></label>` : ''
  return ue || mehr ? `<div class="ot-modes">${ue}${mehr}</div>` : '<span class="muted">–</span>'
}

function overtimeView(c) {
  const month = c.month
  const data = payroll(month)
  const ids = new Set(filteredEmployees(c).map((e) => e.id))
  const all = data.rows.filter((r) => ids.has(r.employee.id))
  const list = app.ui.otAll ? all : all.filter(relevant)
  const closure = app.data.payroll?.[month]
  const closed = !!closure?.closedAt
  const p = data.rules.pay
  const t = all.reduce(
    (s, r) => ({ ue: s.ue + r.total.ue + r.total.ue11, mehr: s.mehr + r.total.mehr, due: s.due + r.mehr.dueMin, amount: s.amount + r.amount, za: s.za + r.zaBonus, taxFree: s.taxFree + r.taxFree, noWage: s.noWage + (relevant(r) && !r.wage ? 1 : 0) }),
    { ue: 0, mehr: 0, due: 0, amount: 0, za: 0, taxFree: 0, noWage: 0 },
  )
  const body = list
    .map((r) => {
      const e = r.employee
      const stored = closure?.rows?.[e.id]
      const changed = closed && stored && Math.abs(stored.amount - r.amount) > 0.005
      const normalOf = (cls) => (r.hours.normal[cls] || 0) + (r.hours.dr[cls] || 0) + (r.hours.mehr[cls] || 0)
      const night = normalOf('nacht')
      const sunHol = normalOf('sonntag') + normalOf('sonntagnacht') + normalOf('feiertag')
      const ueSpecial = ['nacht', 'sonntag', 'sonntagnacht', 'feiertag'].map((cls) => [cls, (r.hours.ue[cls] || 0) + (r.hours.ue11[cls] || 0)]).filter(([, m]) => m)
      const dr = drText(r)
      return `<tr>
        <td><button class="link-btn" data-action="ot-detail" data-emp="${esc(e.id)}"><strong>${esc(e.name)}</strong></button><br><span class="muted">${esc(e.type)} · ${formatHours((e.weeklyHours || 0) * 60)} h · ${r.wage ? `${euro(r.wage)}/h${e.wageGroup && !(e.hourlyWage > 0) ? ` (LG ${e.wageGroup})` : ''}` : '<span class="err-text">Stundenlohn fehlt</span>'}</span></td>
        <td class="num">${h(r.total.mehr)}${r.mehr.balanced ? `<br><span class="muted">ausgeglichen ${formatHours(r.mehr.balanced)}</span>` : ''}${r.mehr.dueMin ? `<br><span class="pill warning">fällig ${formatHours(r.mehr.dueMin)} h</span>` : ''}${r.mehr.openMin ? `<br><span class="muted">offen ${formatHours(r.mehr.openMin)} bis ${formatDate(r.mehr.open[0].deadline, { weekday: false })}</span>` : ''}</td>
        <td class="num">${h(r.total.ue + r.total.ue11)}${r.total.ue11 ? `<br><span class="muted">11./12. Std. ${formatHours(r.total.ue11)}</span>` : ''}${ueSpecial.map(([cls, m]) => `<br><span class="muted">${TIME_CLASSES[cls]} ${formatHours(m)}</span>`).join('')}${dr ? `<br><span class="muted">${esc(dr)}</span>` : ''}</td>
        <td class="num">${night ? `Nacht ${formatHours(night)}` : ''}${night && sunHol ? '<br>' : ''}${sunHol ? `Sonn-/Feiertag ${formatHours(sunHol)}` : ''}${!night && !sunHol ? '<span class="muted">–</span>' : ''}</td>
        <td>${modeSelects(r, month, closed)}</td>
        <td class="num"><strong>${r.amount ? euro(r.amount) : '<span class="muted">–</span>'}</strong>${r.taxFree ? `<br><span class="muted">stfr. ${euro(r.taxFree)}</span>` : ''}${changed ? `<br><span class="pill warning" title="Abgeschlossen mit ${euro(stored.amount)}">seit Abschluss geändert</span>` : ''}</td>
        <td class="num saldo ${saldoClass(r.accountDelta)}">${r.accountDelta ? signed(r.accountDelta) : '<span class="muted">±0</span>'}${r.zaBonus ? `<br><span class="muted">ZA-Zuschlag +${formatHours(r.zaBonus)}</span>` : ''}</td>
      </tr>`
    })
    .join('')
  const [y, m] = month.split('-').map(Number)
  const monthName = `${MONTH_LONG[m - 1]} ${y}`
  const confirmClose = app.ui.confirm === 'ot-close'
  return `<div class="section-head"><div><h2>Überstunden & Auszahlung ${monthName}</h2><p>Aus dem Dienstplan berechnet: Mehrarbeit (Teilzeit bis ${p.fullTimeWeeklyH} h), Überstunden (über ${formatHours(p.dailyNormalH * 60)} h am Tag oder ${p.fullTimeWeeklyH} h in der Woche), Nacht-, Sonn- und Feiertagszuschläge laut Kollektivvertrag. Je Person wählen: auszahlen oder Zeitausgleich. Mit „Monat abschließen“ werden ausbezahlte Stunden aus dem Zeitkonto gebucht.</p></div>${monthPicker(c)}</div>
    ${filterBar(c, { problems: false })}
    <div class="summary">
      <div class="stat"><div class="label">Überstunden</div><div class="value">${formatHours(t.ue)} h</div></div>
      <div class="stat"><div class="label">Mehrarbeit</div><div class="value">${formatHours(t.mehr)} h</div></div>
      <div class="stat ${t.due ? 'warn' : ''}"><div class="label">Mehrarbeit fällig (+${p.mehrPct} %)</div><div class="value">${formatHours(t.due)} h</div></div>
      <div class="stat"><div class="label">Auszahlung brutto</div><div class="value">${euro(t.amount)}</div></div>
      <div class="stat"><div class="label">Zeitausgleich-Zuschläge</div><div class="value">${formatHours(t.za)} h</div></div>
    </div>
    ${closed ? `<div class="banner"><span class="pill ok">abgeschlossen</span> <span>${esc(monthName)} am ${new Date(closure.closedAt).toLocaleString('de-AT')} von ${esc(closure.by || '')}: ${euro(Object.values(closure.rows || {}).reduce((s, x) => s + x.amount, 0))} brutto, Buchungen im Zeitkonto ab ${formatDate(lastOfMonth(`${month}-01`), { weekday: false })}.</span></div>` : ''}
    ${data.missing.length ? `<p class="note">Noch nicht eingeteilt: ${data.missing.map((w) => `KW ${isoWeek(w).week}`).join(', ')}. Diese Wochen zählen erst, wenn sie geplant sind.</p>` : ''}
    ${t.noWage ? `<p class="note err-text">${t.noWage} ${t.noWage === 1 ? 'Person hat' : 'Personen haben'} keinen Stundenlohn: unter „Mitarbeitende“ Lohngruppe oder Stundenlohn eintragen.</p>` : ''}
    <div class="toolbar">
      <button class="filter" data-action="ot-all" aria-pressed="${!!app.ui.otAll}">Alle Mitarbeitenden</button>
      <button class="btn" data-action="ot-copy">${ICON.copy} Für Excel kopieren</button>
      ${app.config.features.download ? `<button class="btn" data-action="ot-csv">${ICON.sheet} CSV für Lohnverrechnung</button><button class="btn" data-action="pe-open" data-month="${esc(c.month)}" title="Bewegungsdaten je Person und Lohnart für den Import in BMD, RZL u. a.">${ICON.download} Export Lohnprogramm</button>` : ''}
      <button class="btn ${closed ? 'primary' : ''}" data-action="ot-send" data-month="${month}">${ICON.send} Auszahlungen versenden</button>
      <span class="spacer"></span>
      ${closed ? `<button class="btn edit-only ${app.ui.confirm === 'ot-reopen' ? 'danger confirm' : ''}" data-action="ot-reopen" data-month="${month}">${app.ui.confirm === 'ot-reopen' ? 'Abschluss wirklich aufheben?' : 'Abschluss aufheben'}</button>` : `<button class="btn primary edit-only ${confirmClose ? 'confirm' : ''}" data-action="ot-close" data-month="${month}">${confirmClose ? `${monthName} jetzt abschließen?` : 'Monat abschließen'}</button>`}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="data overtime"><thead><tr><th>Mitarbeiter:in</th><th>Mehrarbeit</th><th>Überstunden</th><th>Zuschläge (Normalstunden)</th><th>Behandlung</th><th>Auszahlung</th><th>Zeitkonto</th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Keine Mehr- oder Überstunden in diesem Monat.</p>'}
    <p class="note">Grundlage: §§ 3, 4, 10, 19d AZG, ARG und KV Denkmal-, Fassaden- und Gebäudereinigung (Arbeiter/innen, ab 1.1.2026). Mehrarbeit bleibt zuschlagsfrei, wenn sie binnen ${p.mehrBalanceMonths} Monaten 1:1 ausgeglichen wird, sonst +${p.mehrPct} %. Überstunden +${p.ueTag} %, Nacht +${p.ueNacht} %, Sonntag +${p.ueSonntag} %, Feiertag +${p.ueFeiertag} %, 11./12. Stunde +${p.ue11Tag} %; als Zeitausgleich 1:1,5. „stfr.“ = Überstundenzuschläge, die nach § 68 Abs. 2 EStG steuerfrei sein können (2026: ${p.taxFreeHours} Überstunden, max. ${euro(p.taxFreeMax)}); Mehrarbeitszuschläge sind steuerpflichtig. Sätze und Grenzen unter „Regeln“. Die Lohnverrechnung prüft und rechnet ab.</p>`
}

function detailModal(c, { empId }) {
  const month = c.month
  const r = payroll(month).rows.find((x) => x.employee.id === empId)
  if (!r) return null
  const p = payroll(month).rules.pay
  const e = r.employee
  const lines = r.lines.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th>Lohnart</th><th>Stunden</th><th>Satz</th><th>Betrag</th><th>Hinweis</th></tr></thead><tbody>${r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${formatHours(l.min)}</td><td class="num">${l.base ? `100 % + ${l.pct} %` : `${l.pct} %`}</td><td class="num">${euro(l.amount)}</td><td><span class="muted">${esc(l.note)}</span></td></tr>`).join('')}
        <tr><th>Summe brutto</th><td></td><td></td><td class="num"><strong>${euro(r.amount)}</strong></td><td>${r.taxFree ? `<span class="muted">davon Zuschläge ${euro(r.taxFree)} ggf. steuerfrei (§ 68 Abs. 2 EStG)</span>` : ''}</td></tr></tbody></table></div>`
    : '<p class="note">Diesen Monat wird nichts ausbezahlt.</p>'
  const weeks = r.weeks
    .map((w) => `<tr><td class="num">KW ${isoWeek(w.monday).week}<br><span class="muted">${formatDate(w.monday, { weekday: false })}–${formatDate(w.sunday, { weekday: false })}</span></td><td class="num">${formatHours(w.contract)}</td><td class="num">${formatHours(w.worked)}${w.longest > p.dailyNormalH * 60 ? `<br><span class="muted">längster Tag ${formatHours(w.longest)}</span>` : ''}</td><td class="num">${h(w.credited)}</td><td class="num">${h(w.normal)}${w.dr ? `<br><span class="muted">+${formatHours(w.dr)} Durchrechnung</span>` : ''}</td><td class="num">${h(w.mehr)}</td><td class="num">${h(w.ue + w.ue11)}${w.ue11 ? `<br><span class="muted">11./12. ${formatHours(w.ue11)}</span>` : ''}</td><td class="num">${w.minus ? `−${formatHours(w.minus)}` : h(0)}</td></tr>`)
    .join('')
  const ledger = [...r.mehr.due.map((x) => ({ ...x, due: true })), ...r.mehr.open]
    .map((x) => `<tr><td>${formatDate(x.date, { year: true })}</td><td class="num">${formatHours(x.min)}</td><td>${formatDate(x.deadline, { year: true })}</td><td>${x.due ? `<span class="pill warning">fällig: +${p.mehrPct} %</span>` : r.mehrMode === 'auszahlen' ? '<span class="muted">wird ausbezahlt</span>' : '<span class="muted">mit Minusstunden ausgleichen</span>'}</td></tr>`)
    .join('')
  const byType = Object.entries(HOUR_TYPES)
    .filter(([type]) => r.total[type])
    .map(([type, label]) => `<tr><td>${label}</td>${Object.keys(TIME_CLASSES).map((cls) => `<td class="num">${h(r.hours[type][cls])}</td>`).join('')}<td class="num"><strong>${formatHours(r.total[type])}</strong></td></tr>`)
    .join('')
  return modalFrame({
    title: e.name,
    subtitle: `Überstunden & Auszahlung · ${MONTH_LONG[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`,
    wide: true,
    body: `<div class="tags"><span class="tag">${esc(e.type)}</span><span class="tag">Vertrag ${formatHours((e.weeklyHours || 0) * 60)} h/Woche</span><span class="tag">${r.wage ? `${euro(r.wage)}/h` : 'kein Stundenlohn'}</span><span class="tag">Überstunden: ${esc(UE_MODES[r.ueMode])}</span><span class="tag">Mehrarbeit: ${esc(MEHR_MODES[r.mehrMode])}</span></div>
      ${drText(r) ? `<p class="note"><strong>${esc(drText(r))}.</strong> Durchrechnung laut KV: 35–45 h je Woche sind Normalarbeitszeit, im Schnitt des Zeitraums höchstens 40 h; ein Guthaben am Ende wird als Überstunden mit 50 % abgerechnet.</p>` : ''}
      <section><h3>Abrechnung</h3>${lines}</section>
      <section><h3>Stunden im Monat</h3><div class="table-wrap"><table class="data"><thead><tr><th>Art</th>${Object.values(TIME_CLASSES).map((x) => `<th>${x}</th>`).join('')}<th>Summe</th></tr></thead><tbody>${byType || `<tr><td colspan="${Object.keys(TIME_CLASSES).length + 2}" class="muted">keine</td></tr>`}</tbody></table></div></section>
      <section><h3>Wochen</h3><div class="table-wrap"><table class="data"><thead><tr><th>Woche</th><th>Vertrag</th><th>Gearbeitet</th><th>Angerechnet</th><th>Normal</th><th>Mehrarbeit</th><th>Überstunden</th><th>Minus</th></tr></thead><tbody>${weeks || '<tr><td colspan="8" class="muted">keine eingeteilten Wochen</td></tr>'}</tbody></table></div>
        <p class="note">Gearbeitet = Einsätze und Fahrzeit. Angerechnet = Urlaub, Krankenstand, Feiertag; zählt wie Arbeitszeit für den Vertrag. Über ${formatHours(p.dailyNormalH * 60)} h am Tag oder ${p.fullTimeWeeklyH} h in der Woche: Überstunden. Zwischen Vertrag und ${p.fullTimeWeeklyH} h: Mehrarbeit. Minusstunden gleichen Mehrarbeit 1:1 aus (älteste zuerst).</p></section>
      ${ledger ? `<section><h3>Mehrstunden-Konto</h3><div class="table-wrap"><table class="data"><thead><tr><th>Geleistet am</th><th>Offen (h)</th><th>Ausgleichen bis</th><th>Status</th></tr></thead><tbody>${ledger}</tbody></table></div><p class="note">Werden Mehrarbeitsstunden binnen ${p.mehrBalanceMonths} Monaten durch Zeitausgleich 1:1 ausgeglichen, gibt es keinen Zuschlag (§ 19d Abs. 3b AZG, KV). Sonst sind sie mit ${p.mehrPct} % Zuschlag auszuzahlen.</p></section>` : ''}`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>`,
  })
}

/** Spalten der CSV für die Lohnverrechnung (Lohnarten). */
export const OVERTIME_COLUMNS = [
  ['Personalnummer', (r) => r.employee.personnelNo || ''],
  ['Name', (r) => r.employee.name],
  ['Lohngruppe', (r) => (r.employee.hourlyWage > 0 ? 'Ist-Lohn' : r.employee.wageGroup || '')],
  ['Stundenlohn (€)', (r) => r.wage.toFixed(2).replace('.', ',')],
  ['Normalstunden (h)', (r) => formatHours(r.total.normal)],
  ['Mehrarbeit geleistet (h)', (r) => formatHours(r.total.mehr)],
  ['Mehrarbeit ausgeglichen 1:1 (h)', (r) => formatHours(r.mehr.balanced)],
  ['Mehrarbeit ausbezahlt +25 % (h)', (r) => formatHours(r.mehr.paid)],
  ['Mehrarbeit offen im Zeitkonto (h)', (r) => formatHours(r.mehr.openMin)],
  ...['ue', 'ue11'].flatMap((type) => Object.entries(TIME_CLASSES).map(([cls, label]) => [`${HOUR_TYPES[type]} ${label} (h)`, (r) => formatHours(r.hours[type][cls] || 0)])),
  ['Nachtstunden mit KV-Nachtzuschlag, normal/Mehrarbeit (h)', (r) => formatHours((r.hours.normal.nacht || 0) + (r.hours.mehr.nacht || 0))],
  ['Sonntagsstunden normal/Mehrarbeit (h)', (r) => formatHours((r.hours.normal.sonntag || 0) + (r.hours.mehr.sonntag || 0))],
  ['Feiertagsstunden normal/Mehrarbeit (h)', (r) => formatHours((r.hours.normal.feiertag || 0) + (r.hours.mehr.feiertag || 0))],
  ['Behandlung Überstunden', (r) => UE_MODES[r.ueMode]],
  ['Zeitausgleich-Zuschlag (h)', (r) => formatHours(r.zaBonus)],
  ['Auszahlung brutto (€)', (r) => r.amount.toFixed(2).replace('.', ',')],
  ['davon Überstundenzuschläge ggf. steuerfrei § 68/2 (€)', (r) => r.taxFree.toFixed(2).replace('.', ',')],
  ['Buchung Zeitkonto (h)', (r) => formatHours(r.accountDelta)],
]

function exportRows(c) {
  const ids = new Set(filteredEmployees(c).map((e) => e.id))
  return payroll(c.month).rows.filter((r) => ids.has(r.employee.id) && (app.ui.otAll || relevant(r)))
}

registerView({ id: 'overtime', order: 72, label: 'Überstunden & Auszahlung', group: 'auswertung', render: overtimeView, range: () => ({ from: firstWeek(currentMonth()), to: lastOfMonth(`${currentMonth()}-01`) }) })
registerModal('overtime-detail', detailModal, { module: 'auswertung' })

registerActions({
  'ot-detail': (el) => openModal({ type: 'overtime-detail', empId: el.dataset.emp }),
  'ot-send': (el) => openModal({ type: 'payout-send', month: el.dataset.month }),
  'ot-all': () => {
    app.ui.otAll = !app.ui.otAll
    renderNow()
  },
  'ot-copy': () => copyText(toCSV(exportRows(app.cur), OVERTIME_COLUMNS).replace(/;/g, '\t')),
  'ot-csv': () => download(`Ueberstunden_${app.cur.month}.csv`, new Blob([`﻿${toCSV(exportRows(app.cur), OVERTIME_COLUMNS)}`], { type: 'text/csv;charset=utf-8' })),
})

registerActions(
  {
    'ot-mode': (el) => {
      const { month, emp, kind } = el.dataset
      if (app.data.payroll?.[month]?.closedAt) return toast('Der Monat ist abgeschlossen.')
      app.data.payroll = app.data.payroll || {}
      const entry = (app.data.payroll[month] = app.data.payroll[month] || {})
      entry.modes = entry.modes || {}
      entry.modes[emp] = { ...(entry.modes[emp] || {}), [kind]: el.value }
      persist()
      renderNow()
    },
    'ot-close': (el) => {
      const month = el.dataset.month
      const all = payroll(month).rows
      const noWage = all.filter((r) => r.missingWage)
      if (noWage.length) return toast(`Abschluss nicht möglich: kein Stundenlohn bei ${noWage.map((r) => r.employee.name).join(', ')}. Unter „Mitarbeitende“ Lohngruppe oder Stundenlohn eintragen.`)
      if (!confirmStep('ot-close')) return
      recordUndo('Monat abschließen')
      const rows = {}
      for (const r of all) if (relevant(r) || r.accountDelta) rows[r.employee.id] = closureRow(r)
      app.data.payroll = app.data.payroll || {}
      app.data.payroll[month] = { ...(app.data.payroll[month] || {}), closedAt: new Date().toISOString(), by: app.user?.name || 'Browser', rows }
      persist()
      renderNow()
      const total = Object.values(rows).reduce((s, x) => s + x.amount, 0)
      const out = Object.values(rows).reduce((s, x) => s + x.accountDelta, 0)
      // gleich weiter zum Versand: Lohnverrechnung und Mitarbeitende
      openModal({ type: 'payout-send', month })
      toast(`Abgeschlossen: ${euro(total)} brutto für ${Object.keys(rows).length} Personen, Zeitkonto ${signed(out)} h.`)
    },
    'ot-reopen': (el) => {
      const month = el.dataset.month
      if (!confirmStep('ot-reopen')) return
      recordUndo('Abschluss aufheben')
      const { modes, sent } = app.data.payroll[month]
      app.data.payroll[month] = { ...(modes ? { modes } : {}), ...(sent ? { sent } : {}) }
      persist()
      renderNow()
      toast('Abschluss aufgehoben. Die Buchungen im Zeitkonto sind zurückgenommen.')
    },
  },
  { edit: 'auswertung' },
)

