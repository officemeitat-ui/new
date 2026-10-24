// Monatsauswertung je Person als Grundlage für die Lohnverrechnung
// (CSV für BMD, RZL oder die Steuerberatung).

import { correctionsInMonth } from '../../core/attention.js'
import { formatDate, formatHours, isoWeek, MONTH_LONG } from '../../core/dates.js'
import { monthReport, PAYROLL_COLUMNS, timeAccount, toCSV } from '../../core/reports.js'
import { app, empName, registerActions, registerView } from '../context.js'
import { download, esc, ICON, saldoClass, signed } from '../shared.js'
import { copyText } from './sheet.js'
import { filterBar, filteredEmployees } from './week.js'
import { monthPicker } from './controlling.js'

function rows(c) {
  const ids = new Set(filteredEmployees(c).map((e) => e.id))
  return monthReport(c.ctx, c.month, c.instances, c.state).filter((r) => ids.has(r.employee.id))
}

function payrollView(c) {
  const list = rows(c)
  const h = (m) => (m ? formatHours(m) : '<span class="muted">–</span>')
  const body = list
    .map(
      (r) => `<tr>
      <td><strong>${esc(r.employee.name)}</strong><br><span class="muted">${esc(r.employee.personnelNo || '')} ${esc(r.employee.type)}</span></td>
      <td class="num">${h(r.soll)}</td><td class="num">${h(r.worked)}</td><td class="num">${h(r.travel)}</td>
      <td class="num">${h(r.sundayHoliday)}${r.bonus ? `<br><span class="muted">+${formatHours(r.bonus)} Zuschlag</span>` : ''}</td>
      <td class="num">${h(r.night)}</td><td class="num">${h(r.holidayCredit)}</td>
      <td class="num">${r.vacationDays ? `${r.vacationDays} T<br><span class="muted">${formatHours(r.vacationCredit)} h</span>` : h(0)}</td>
      <td class="num">${r.sickDays ? `${r.sickDays} T<br><span class="muted">${formatHours(r.sickCredit)} h</span>` : h(0)}</td>
      <td class="num"><strong>${formatHours(r.ist)}</strong></td>
      <td class="num saldo ${saldoClass(r.saldo)}">${signed(r.saldo)}${r.overLimit ? '<br><span class="pill error">über GFG-Grenze</span>' : ''}</td>
      <td class="num">${signed(timeAccount(r.employee, app.data.published, c.monday))}</td>
    </tr>`,
    )
    .join('')
  const [y, m] = c.month.split('-').map(Number)
  return `<div class="section-head"><div><h2>Monatsauswertung ${MONTH_LONG[m - 1]} ${y}</h2><p>Grundlage für die Lohnverrechnung: geleistete Stunden, Fahrzeit, Sonn- und Feiertagsstunden mit Zuschlag, Nachtarbeit, angerechnete Feiertage, Urlaub und Krankenstand. Die Zuordnung zu Lohnarten erfolgt beim Import in BMD/RZL.</p></div>${monthPicker(c)}</div>
    ${filterBar(c, { problems: false })}
    <div class="toolbar"><button class="btn" data-action="payroll-copy">${ICON.copy} Für Excel kopieren</button>${app.config.features.download ? `<button class="btn" data-action="payroll-csv">${ICON.sheet} CSV für Lohnverrechnung</button>` : ''}</div>
    <div class="table-wrap"><table class="data payroll"><thead><tr><th>Mitarbeiter:in</th><th>Soll</th><th>Gearbeitet</th><th>Fahrzeit</th><th>Sonn-/Feiertag</th><th>Nacht</th><th>Feiertag angerechnet</th><th>Urlaub</th><th>Krankenstand</th><th>Ist</th><th>Saldo</th><th>Zeitkonto</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="note">Soll = Wochenstunden / 5 je Werktag (Mo–Fr) im Monat. Wochen, die noch nicht eingeteilt sind, zählen nur mit Anrechnungen. Zeitkonto = Startsaldo + veröffentlichte Wochen (inkl. gebuchter Korrekturen).</p>
    ${correctionsSection(c)}`
}

/** Rückwirkende Änderungen veröffentlichter Wochen, die den Monat berühren. */
function correctionsSection(c) {
  const ids = new Set(filteredEmployees(c).map((e) => e.id))
  const list = correctionsInMonth(app.data.published, c.month).filter((x) => ids.has(x.empId))
  if (!list.length) return ''
  const rowsHtml = list
    .map((x) => `<tr><td class="num">KW ${isoWeek(x.monday).week}<br><span class="muted">${formatDate(x.monday, { weekday: false })}</span></td><td><strong>${esc(empName(x.empId))}</strong></td><td class="num">${signed(x.before)}</td><td class="num">${signed(x.after)}</td><td class="num saldo ${saldoClass(x.delta)}"><strong>${signed(x.delta)}</strong></td><td><span class="muted">${new Date(x.at).toLocaleString('de-AT')} · ${esc(x.by)}</span></td></tr>`)
    .join('')
  return `<h3>Nachträgliche Korrekturen</h3><p class="note">Rückwirkend geänderte Wochen (z. B. nachgereichte Krankmeldung, Vertretung nachgetragen). Die Differenz ist im Zeitkonto schon enthalten; für die Lohnverrechnung bitte gesondert berücksichtigen, wenn der Monat bereits abgerechnet ist.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Woche</th><th>Mitarbeiter:in</th><th>Saldo bisher</th><th>Saldo neu</th><th>Korrektur</th><th>Gebucht</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`
}

registerView({ id: 'payroll', order: 70, label: 'Monatsauswertung', group: 'auswertung', render: payrollView })

registerActions({
  'payroll-copy': () => copyText(toCSV(rows(app.cur)).replace(/;/g, '\t')),
  'payroll-csv': () => download(`Monatsauswertung_${app.cur.month}.csv`, new Blob([`\ufeff${toCSV(rows(app.cur), PAYROLL_COLUMNS)}`], { type: 'text/csv;charset=utf-8' })),
})
