// Kennzahlen: Dashboard für die Geschäftsführung. Kacheln (große Zahl, Trend gegen die Vorwoche bzw.
// den Vormonat, kleiner Verlauf) und Diagramme je Bereich. Jede Kachel und jedes Diagramm erscheint
// nur, wenn die Rolle den Bereich sieht. Gerechnet wird in src/core/kpi.js, gezeichnet in kpi-charts.js;
// die Ergebnisse werden je Datenstand gemerkt (memo), Blättern und Hover kosten nichts.
//
// Zeitraum: 4/8/13 Wochen für die Wochen-Kennzahlen, 3/6/12 Monate für die Monats-Kennzahlen.
// Monats-Kacheln zeigen den letzten abgeschlossenen Monat (der laufende ist noch unvollständig).

import { CALC_DEFAULTS, calcWage } from '../../core/calculation.js'
import { employedOn, sollMinutes } from '../../core/contract.js'
import { addDays, formatDate, isoWeek, mondayOf, MONTH_LONG, todayISO } from '../../core/dates.js'
import { absenceRates, aging, complaintsByMonth, complaintsTopObjects, contribution, lastMonths, lastWeeks, materialByObject, materialMonths, PERIODS, plusHours, revenueByObject, revenueMonths, topCustomers, trend, utilization, weekStats } from '../../core/kpi.js'
import { mergeRules } from '../../core/rules.js'
import { buildTimesheet, summarizeDays } from '../../core/timesheet.js'
import { app, computeRange, memo, registerActions, registerView, render } from '../context.js'
import { barList, columnChart, legend, lineChart, sparkline, tableView } from '../kpi-charts.js'
import { esc } from '../shared.js'

const ICON = '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="6" width="3" height="12" rx="1"/><rect x="16" y="9" width="3" height="9" rx="1"/>'

// ---------------------------------------------------------------- Formate

const nf = (d = 0) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: d, minimumFractionDigits: 0 })
const hours = (min) => `${nf(0).format(Math.round(min / 60))} h`
const hoursAxis = (min) => nf(0).format(Math.round(min / 60))
const euro = (v) => `${nf(0).format(Math.round(v))} €`
const euroAxis = (v) => (Math.abs(v) >= 10000 ? `${nf(0).format(Math.round(v / 1000))} Tsd.` : nf(0).format(Math.round(v)))
const pct = (v, d = 1) => (v === null || v === undefined ? '–' : `${nf(d).format(v * 100)} %`)
const count = (v) => nf(0).format(v)
const monthShort = (key) => MONTH_LONG[Number(key.slice(5, 7)) - 1].slice(0, 3)
const monthTitle = (key) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
const weekShort = (key) => `KW ${isoWeek(key).week}`
const weekTitle = (key) => `KW ${isoWeek(key).week} (${formatDate(key, { weekday: false })}–${formatDate(addDays(key, 6), { weekday: false })})`

const sees = (m) => !app.access || app.access.all || app.access.sees(m)
const period = () => (PERIODS[app.ui.kpiPeriod] ? app.ui.kpiPeriod : 'mittel')
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches

/** Zeitraum für das Nachladen der Wochen-Dateien. */
function spanOf(p = period(), today = todayISO()) {
  const P = PERIODS[p]
  const weeks = lastWeeks(P.weeks, today)
  const months = lastMonths(P.months, today)
  return { weeks, months, from: [weeks[0].from, months[0].from].sort()[0], to: [weeks.at(-1).to, months.at(-1).to].sort().at(-1) }
}

// ---------------------------------------------------------------- Berechnung (je Datenstand gemerkt)

function build(p) {
  const today = todayISO()
  const { weeks, months, from, to } = spanOf(p, today)
  const out = { weeks, months, today }
  const data = app.data
  const needPlan = sees('planung') || sees('auswertung')
  const r = needPlan || sees('fakturierung') ? computeRange(from, to) : null
  const employees = (r?.ctx.employees || data.employees || []).filter((e) => employedOn(e, to) || employedOn(e, from))

  if (needPlan && r) {
    // Wochenzettel je Person und Woche einmal: Fahrzeit je Woche, Ist/Soll je Monat (Plus-Stunden)
    const allWeeks = [...new Set([...weeks.map((w) => w.key), ...months.flatMap((m) => mondaysIn(m.from, m.to))])]
    const daysOf = new Map() // empId → Tage
    if (sees('auswertung') || sees('planung')) {
      for (const emp of employees) {
        const days = []
        for (const monday of allWeeks) days.push(...buildTimesheet(r.ctx, emp, monday, r.instances, r.state).days)
        daysOf.set(emp.id, days)
      }
    }
    const travelByWeek = new Map(weeks.map((w) => [w.key, [...daysOf.values()].reduce((s, days) => s + summarizeDays(days.filter((d) => d.date >= w.from && d.date <= w.to)).travel, 0)]))
    const scheduledWeeks = new Set(Object.keys(data.assignments || {}).map((k) => mondayOf(k.slice(0, 10))))
    out.week = weekStats({ weeks, instances: r.instances, state: r.state, stamps: data.stamps, travelByWeek, scheduled: (m) => scheduledWeeks.has(m) })
    out.hasStamps = out.week.some((w) => w.ist > 0)
    out.util = utilization({ employees, instances: r.instances, state: r.state, from: weeks[0].from, to: weeks.at(-1).to })
    const legal = new Set([...r.holidays.entries()].filter(([, h]) => h.legal !== false).map(([d]) => d))
    out.absence = absenceRates({ months, employees, absences: data.absences || [], holidays: legal })
    out.plus = months.map((m) => {
      const rows = employees.map((emp) => {
        const days = (daysOf.get(emp.id) || []).filter((d) => d.date >= m.from && d.date <= m.to)
        return { employee: emp, saldo: summarizeDays(days).ist - sollMinutes(emp, m.from, m.to) }
      })
      return { key: m.key, ...plusHours(rows) }
    })
  }
  if (sees('reklamationen')) {
    const items = data.reklamationen?.items || []
    out.complaints = complaintsByMonth(items, months)
    out.complaintsTop = complaintsTopObjects(items, { from: months[0].from, to: months.at(-1).to })
    out.complaintsOpen = items.filter((c) => c.status !== 'erledigt').length
  }
  if (sees('fakturierung')) {
    const doc = data.fakturierung || {}
    out.revenue = revenueMonths(doc, months)
    out.aging = aging(doc, today)
    out.customers = topCustomers(doc, { from: months[0].from, to: months.at(-1).to })
    if (sees('auswertung') && r) {
      const s = data.kalkulation?.settings || {}
      const wage = calcWage(s, mergeRules(data.rules).wages)
      const costPerHour = wage * (1 + (Number(s.lnkPct ?? CALC_DEFAULTS.lnkPct) || 0) / 100)
      const span = { from: months[0].from, to: months.at(-1).to }
      out.margin = contribution({ revenue: revenueByObject(doc, span), material: sees('material') ? materialByObject(data.material || {}, span) : new Map(), instances: r.instances, state: r.state, ...span, costPerHour })
      out.costPerHour = costPerHour
    }
  }
  if (sees('material')) out.material = materialMonths(data.material || {}, months)
  return out
}

function mondaysIn(from, to) {
  const out = []
  for (let m = mondayOf(from); m <= to; m = addDays(m, 7)) out.push(m)
  return out
}

// ---------------------------------------------------------------- Kacheln

/** goodUp: true = mehr ist gut, false = mehr ist schlecht, null = neutral. */
function tile({ label, value, sub = '', cur, prev, goodUp = null, deltaFmt = (d) => String(d), spark = [], view, hero = false, vs = 'Vorwoche' }) {
  const t = prev === null || prev === undefined ? null : trend(cur, prev)
  const tone = !t || t.dir === 'flat' || goodUp === null ? 'neutral' : (t.dir === 'up') === goodUp ? 'good' : 'bad'
  const arrow = !t ? '' : t.dir === 'up' ? '▲' : t.dir === 'down' ? '▼' : '■'
  const delta = t ? `<span class="kpi-delta ${tone}"><span aria-hidden="true">${arrow}</span> ${esc(t.dir === 'flat' ? 'gleich' : `${t.delta > 0 ? '+' : '−'}${deltaFmt(Math.abs(t.delta))}`)} <span class="muted">gegen ${esc(vs)}</span></span>` : ''
  return `<button class="kpi-tile ${hero ? 'hero' : ''}" data-action="view" data-view="${esc(view)}" title="Öffnen: ${esc(label)}">
    <span class="kpi-tile-label">${esc(label)}</span>
    <span class="kpi-tile-main"><span class="kpi-tile-value">${esc(value)}</span>${sparkline(spark)}</span>
    ${sub ? `<span class="kpi-tile-sub muted">${esc(sub)}</span>` : ''}
    ${delta}
  </button>`
}

function tiles(d) {
  const out = []
  const lastI = d.months.length - 2 // letzter abgeschlossener Monat
  const mKey = d.months[lastI]?.key
  const mLabel = mKey ? MONTH_LONG[Number(mKey.slice(5, 7)) - 1] : ''
  if (d.revenue && lastI >= 0) {
    const cur = d.revenue[lastI].net
    out.push(tile({ label: `Umsatz ${mLabel}`, value: euro(cur), sub: 'netto, festgeschriebene Rechnungen', cur, prev: d.revenue[lastI - 1]?.net ?? null, goodUp: true, deltaFmt: euro, spark: d.revenue.map((x) => x.net), view: 'fakturierung', vs: 'Vormonat' }))
    const open = d.aging.reduce((s, x) => s + x.amount, 0)
    const overdue = d.aging.filter((x) => x.id !== 'nicht').reduce((s, x) => s + x.amount, 0)
    out.push(tile({ label: 'Offene Posten', value: euro(open), sub: overdue ? `davon ${euro(overdue)} überfällig` : 'nichts überfällig', cur: open, view: 'fakturierung' }))
  }
  if (d.week) {
    const [prev, cur] = d.week.slice(-2)
    out.push(tile({ label: 'Stunden eingeteilt (diese Woche)', value: hours(cur.staffed), sub: `von ${hours(cur.plan)} laut Plan`, cur: cur.staffed, prev: prev?.staffed ?? null, deltaFmt: hours, spark: d.week.map((w) => w.staffed), view: 'week' }))
    out.push(tile({ label: 'Besetzungsgrad (diese Woche)', value: pct(cur.rate, 1), sub: cur.open ? `${count(cur.open)} Einsätze offen` : 'alle Einsätze besetzt', cur: cur.rate ?? 0, prev: prev?.rate ?? null, goodUp: true, deltaFmt: (v) => `${nf(1).format(v * 100)} Pp.`, spark: d.week.map((w) => w.rate), view: 'coverage' }))
  }
  if (d.absence && lastI >= 0) {
    const cur = d.absence[lastI]
    out.push(tile({ label: `Krankenstandsquote ${mLabel}`, value: pct(cur.sickRate), sub: `${count(cur.sick)} von ${count(cur.sollDays)} Soll-Tagen`, cur: cur.sickRate, prev: d.absence[lastI - 1]?.sickRate ?? null, goodUp: false, deltaFmt: (v) => `${nf(1).format(v * 100)} Pp.`, spark: d.absence.map((x) => x.sickRate), view: 'absences', vs: 'Vormonat' }))
  }
  if (d.plus && sees('auswertung') && lastI >= 0) {
    const cur = d.plus[lastI]
    out.push(tile({ label: `Plus-Stunden ${mLabel}`, value: hours(cur.total), sub: `${hours(cur.overtime)} Vollzeit · ${hours(cur.extra)} Teilzeit`, cur: cur.total, prev: d.plus[lastI - 1]?.total ?? null, goodUp: false, deltaFmt: hours, spark: d.plus.map((x) => x.total), view: 'overtime', vs: 'Vormonat' }))
  }
  if (d.complaints && lastI >= 0) {
    const cur = d.complaints[lastI]
    out.push(tile({ label: `Reklamationen ${mLabel}`, value: count(cur.count), sub: `${count(d.complaintsOpen)} offen`, cur: cur.count, prev: d.complaints[lastI - 1]?.count ?? null, goodUp: false, deltaFmt: count, spark: d.complaints.map((x) => x.count), view: 'reklamationen', vs: 'Vormonat' }))
  }
  if (d.material && lastI >= 0) {
    const cur = d.material[lastI]
    out.push(tile({ label: `Materialverbrauch ${mLabel}`, value: euro(cur.used), sub: `bestellt ${euro(cur.ordered)}`, cur: cur.used, prev: d.material[lastI - 1]?.used ?? null, deltaFmt: euro, spark: d.material.map((x) => x.used), view: 'material', vs: 'Vormonat' }))
  }
  // genau eine große Zahl: die erste Kachel
  if (out.length) out[0] = out[0].replace('class="kpi-tile ', 'class="kpi-tile hero ')
  return out.join('')
}

// ---------------------------------------------------------------- Diagramm-Karten

const card = ({ id, title, sub = '', view = '', body, legendHtml = '', table = '', wide = false }) =>
  `<section class="kpi-card ${wide ? 'wide' : ''}" data-chart="${id}"><header><div><h3>${esc(title)}</h3>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}</div>${view ? `<button class="btn small ghost" data-action="view" data-view="${esc(view)}">Öffnen</button>` : ''}</header>${legendHtml}<div class="kpi-plot">${body}</div>${table}</section>`

function charts(d) {
  const W = narrow() ? 340 : 560
  const out = []
  const wl = d.weeks.map((w) => weekShort(w.key))
  const wt = d.weeks.map((w) => weekTitle(w.key))
  const ml = d.months.map((m) => monthShort(m.key))
  const mt = d.months.map((m) => monthTitle(m.key))
  if (d.week) {
    const series = [
      { id: 'plan', label: 'laut Plan', color: '--kpi-1', values: d.week.map((w) => w.plan) },
      { id: 'staffed', label: 'eingeteilt', color: '--kpi-2', values: d.week.map((w) => w.staffed) },
      ...(d.hasStamps ? [{ id: 'ist', label: 'Ist (Zeiterfassung)', color: '--kpi-3', values: d.week.map((w) => w.ist) }] : []),
    ]
    out.push(card({ id: 'stunden', title: 'Stunden je Woche', sub: d.hasStamps ? 'Plan, eingeteilt und Ist laut Zeiterfassung' : 'Plan und eingeteilt (noch keine Zeiterfassung im Zeitraum)', view: 'week', legendHtml: legend(series), body: lineChart({ labels: wl, titles: wt, series, fmt: hours, axis: hoursAxis, unit: 60, width: W, ariaLabel: 'Stunden je Woche' }), table: tableView(['Woche', 'Plan', 'eingeteilt', 'Ist', 'Fahrzeit'], d.week.map((w, i) => [wt[i], hours(w.plan), hours(w.staffed), d.hasStamps ? hours(w.ist) : '–', hours(w.travel)])) }))
    out.push(card({ id: 'besetzung', title: 'Offene Einsätze je Woche', sub: `Besetzungsgrad zuletzt ${pct(d.week.at(-1).rate)}; nur Wochen, die schon eingeteilt sind`, view: 'coverage', body: columnChart({ labels: wl, titles: wt, series: [{ id: 'open', label: 'offene Einsätze', color: '--kpi-1', values: d.week.map((w) => w.open) }], fmt: count, integer: true, width: W, ariaLabel: 'Offene Einsätze je Woche' }), table: tableView(['Woche', 'Plätze', 'besetzt', 'offen', 'Besetzungsgrad'], d.week.map((w, i) => [wt[i], count(w.slots), count(w.filled), count(w.open), pct(w.rate)])) }))
    out.push(card({ id: 'fahrzeit', title: 'Fahrzeit je Woche', sub: 'geplante Fahrten zwischen den Einsätzen', view: 'timeline', body: columnChart({ labels: wl, titles: wt, series: [{ id: 'travel', label: 'Fahrzeit', color: '--kpi-1', values: d.week.map((w) => w.travel) }], fmt: hours, axis: hoursAxis, unit: 60, width: W, ariaLabel: 'Fahrzeit je Woche' }), table: tableView(['Woche', 'Fahrzeit'], d.week.map((w, i) => [wt[i], hours(w.travel)])) }))
    const ranked = d.util.filter((x) => x.pct !== null)
    const pick = ranked.length > 10 ? [...ranked.slice(0, 5), ...ranked.slice(-5)] : ranked
    out.push(card({ id: 'auslastung', title: 'Auslastung je Person', sub: ranked.length > 10 ? `die 5 am meisten und die 5 am wenigsten ausgelasteten von ${ranked.length}; Strich = 100 % Vertrag` : 'eingeteilt gegen Vertrag im Zeitraum; Strich = 100 %', view: 'staff', body: barList({ rows: pick.map((x) => ({ label: x.emp.name, value: x.pct, display: pct(x.pct, 0), extra: [['eingeteilt', hours(x.planned), ''], ['Vertrag', hours(x.contract), '']] })), ref: 1, refLabel: '100 % Vertrag', max: Math.max(1.2, ...pick.map((x) => x.pct)) }), table: tableView(['Person', 'Vertrag', 'eingeteilt', 'Auslastung'], d.util.map((x) => [x.emp.name, hours(x.contract), hours(x.planned), pct(x.pct, 0)])) }))
  }
  if (d.absence) {
    const series = [
      { id: 'sick', label: 'Krankenstand', color: '--kpi-1', values: d.absence.map((x) => x.sickRate) },
      { id: 'vac', label: 'Urlaub', color: '--kpi-2', values: d.absence.map((x) => x.vacationRate) },
    ]
    out.push(card({ id: 'abwesenheit', title: 'Krankenstand und Urlaub je Monat', sub: 'Anteil an den Soll-Tagen (Mo–Fr ohne Feiertage)', view: 'absences', legendHtml: legend(series), body: lineChart({ labels: ml, titles: mt, series, fmt: (v) => pct(v), axis: (v) => pct(v, Math.round(v * 1000) % 10 ? 1 : 0), unit: 0.01, width: W, ariaLabel: 'Krankenstand und Urlaub je Monat' }), table: tableView(['Monat', 'Soll-Tage', 'Krankenstand', 'Urlaub'], d.absence.map((x, i) => [mt[i], count(x.sollDays), `${count(x.sick)} (${pct(x.sickRate)})`, `${count(x.vacation)} (${pct(x.vacationRate)})`])) }))
  }
  if (d.plus && sees('auswertung')) {
    const series = [
      { id: 'ot', label: 'Überstunden (Vollzeit)', color: '--kpi-1', values: d.plus.map((x) => x.overtime) },
      { id: 'mehr', label: 'Mehrarbeit (Teilzeit)', color: '--kpi-2', values: d.plus.map((x) => x.extra) },
    ]
    out.push(card({ id: 'plusstunden', title: 'Plus-Stunden je Monat', sub: 'Ist über Soll laut Plan, je Person summiert (Minus zählt nicht)', view: 'overtime', legendHtml: legend(series, 'rect'), body: columnChart({ labels: ml, titles: mt, series, fmt: hours, axis: hoursAxis, unit: 60, width: W, ariaLabel: 'Plus-Stunden je Monat' }), table: tableView(['Monat', 'Vollzeit', 'Teilzeit', 'Summe'], d.plus.map((x, i) => [mt[i], hours(x.overtime), hours(x.extra), hours(x.total)])) }))
  }
  if (d.complaints) {
    out.push(card({ id: 'reklamationen', title: 'Reklamationen je Monat', sub: `${count(d.complaintsOpen)} derzeit offen`, view: 'reklamationen', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'c', label: 'Reklamationen', color: '--kpi-1', values: d.complaints.map((x) => x.count) }], fmt: count, integer: true, width: W, ariaLabel: 'Reklamationen je Monat' }), table: tableView(['Monat', 'Reklamationen', 'davon offen'], d.complaints.map((x, i) => [mt[i], count(x.count), count(x.open)])) }))
    const name = (id) => app.data.objects.find((o) => o.id === id)?.name || 'Objekt'
    out.push(card({ id: 'reklamationen-objekte', title: 'Objekte mit den meisten Reklamationen', sub: 'im gewählten Zeitraum', view: 'reklamationen', body: barList({ rows: d.complaintsTop.map((x) => ({ label: name(x.objectId), value: x.count, display: count(x.count), sub: x.open ? `${x.open} offen` : '' })) }), table: tableView(['Objekt', 'Reklamationen', 'offen'], d.complaintsTop.map((x) => [name(x.objectId), count(x.count), count(x.open)])) }))
  }
  if (d.revenue) {
    out.push(card({ id: 'umsatz', title: 'Umsatz je Monat', sub: 'netto; Storno und Korrekturen mindern', view: 'fakturierung', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'net', label: 'Umsatz netto', color: '--kpi-1', values: d.revenue.map((x) => x.net) }], fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Umsatz je Monat' }), table: tableView(['Monat', 'Umsatz netto', 'Rechnungen'], d.revenue.map((x, i) => [mt[i], euro(x.net), count(x.count)])) }))
    const STATUS = { nicht: ['--kpi-neutral', '○'], d30: ['--kpi-warning', '△'], d60: ['--kpi-serious', '▲'], d60plus: ['--kpi-critical', '■'] }
    out.push(card({ id: 'offene-posten', title: 'Offene Posten nach Fälligkeit', sub: 'brutto, ohne Storno', view: 'fakturierung', body: agingBars(d.aging, STATUS), table: tableView(['Fälligkeit', 'Betrag', 'Rechnungen'], d.aging.map((x) => [x.label, euro(x.amount), count(x.count)])) }))
    out.push(card({ id: 'kunden', title: 'Kunden mit dem meisten Umsatz', sub: 'netto im gewählten Zeitraum', view: 'fakturierung', body: barList({ rows: d.customers.map((x) => ({ label: x.name, value: x.net, display: euro(x.net) })) }), table: tableView(['Kunde', 'Umsatz netto'], d.customers.map((x) => [x.name, euro(x.net)])) }))
  }
  if (d.material) {
    const series = [
      { id: 'used', label: 'Verbrauch', color: '--kpi-1', values: d.material.map((x) => x.used) },
      { id: 'ordered', label: 'Bestellwert', color: '--kpi-2', values: d.material.map((x) => x.ordered) },
    ]
    out.push(card({ id: 'material', title: 'Material je Monat', sub: 'Ausgaben an Objekte und Personen, bestellte Ware', view: 'material', legendHtml: legend(series), body: lineChart({ labels: ml, titles: mt, series, fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Material je Monat' }), table: tableView(['Monat', 'Verbrauch', 'Bestellwert'], d.material.map((x, i) => [mt[i], euro(x.used), euro(x.ordered)])) }))
  }
  if (d.margin?.length) {
    const name = (id) => app.data.objects.find((o) => o.id === id)?.name || 'Objekt'
    const rows = d.margin.slice(0, 10)
    out.push(card({ id: 'deckungsbeitrag', title: 'Deckungsbeitrag je Objekt', sub: `Umsatz − Personal (eingeteilte Stunden × ${euro(d.costPerHour)}/h laut Kalkulation) − Material`, view: 'controlling', wide: true, body: barList({ diverging: true, rows: rows.map((x) => ({ label: name(x.objectId), value: x.margin, display: `${euro(x.margin)} (${pct(x.rate, 0)})`, extra: [['Umsatz', euro(x.revenue), ''], ['Personal', euro(x.labor), ''], ['Material', euro(x.material), '']] })) }), table: tableView(['Objekt', 'Umsatz', 'Personal', 'Material', 'Deckungsbeitrag'], d.margin.map((x) => [name(x.objectId), euro(x.revenue), euro(x.labor), euro(x.material), euro(x.margin)])) }))
  }
  return out.join('')
}

/** Offene Posten: Zustandsfarben mit Zeichen und Text (Farbe nie allein). */
function agingBars(list, status) {
  const max = Math.max(1, ...list.map((x) => x.amount))
  return `<ul class="kpi-bars">${list
    .map((x) => {
      const [color, mark] = status[x.id]
      return `<li class="kpi-hit-row kpi-hit" tabindex="0" data-tip="${esc(JSON.stringify({ t: x.label, r: [['', euro(x.amount), color], [`${x.count} ${x.count === 1 ? 'Rechnung' : 'Rechnungen'}`, '', '']] }))}"><span class="kpi-bar-label"><span class="kpi-mark" aria-hidden="true">${mark}</span> ${esc(x.label)}</span><span class="kpi-track">${x.amount > 0.004 ? `<span class="kpi-bar" style="width:${(x.amount / max) * 100}%;background:var(${color})"></span>` : ''}</span><span class="kpi-bar-value">${esc(euro(x.amount))}</span></li>`
    })
    .join('')}</ul>`
}

// ---------------------------------------------------------------- Ansicht

function kpiView(c) {
  const p = period()
  const d = memo(c, `kennzahlen:${p}:${todayISO()}:${narrow() ? 's' : 'l'}`, () => build(p))
  const filters = Object.entries(PERIODS)
    .map(([id, x]) => `<button class="filter" data-action="kpi-period" data-period="${id}" aria-pressed="${id === p}">${esc(x.label)}</button>`)
    .join('')
  const t = tiles(d)
  const ch = charts(d)
  return `<div class="kpi-root">
    <div class="section-head"><div><h2>Kennzahlen</h2><p>Die wichtigsten Zahlen auf einen Blick: Stunden, Besetzung, Abwesenheit, Plus-Stunden, Reklamationen, Umsatz und Material. Monats-Kacheln zeigen den letzten abgeschlossenen Monat. Eine Kachel antippen öffnet den Bereich.</p></div></div>
    <div class="filters kpi-filters" role="group" aria-label="Zeitraum">${filters}</div>
    ${t ? `<div class="kpi-tiles">${t}</div>` : ''}
    ${ch ? `<div class="kpi-grid">${ch}</div>` : '<p class="empty">Für deine Rolle gibt es hier noch keine Kennzahlen.</p>'}
  </div>`
}

registerView({
  id: 'kennzahlen',
  order: 2,
  label: 'Kennzahlen',
  group: 'auswertung',
  module: '*',
  section: 'start',
  noWeek: true,
  icon: ICON,
  text: 'Dashboard: Stunden, Besetzung, Krankenstand, Umsatz, offene Posten',
  range: () => {
    const { from, to } = spanOf()
    return { from, to }
  },
  render: kpiView,
})

registerActions({
  'kpi-period': (el) => {
    app.ui.kpiPeriod = el.dataset.period
    render()
  },
})
