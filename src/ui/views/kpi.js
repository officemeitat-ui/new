// Kennzahlen: Dashboard für die Geschäftsführung. Kacheln (große Zahl, Trend gegen die Vorwoche bzw.
// den Vormonat, kleiner Verlauf) und Diagramme je Bereich. Jede Kachel und jedes Diagramm erscheint
// nur, wenn die Rolle den Bereich sieht. Gerechnet wird in src/core/kpi.js, gezeichnet in kpi-charts.js;
// die Ergebnisse werden je Datenstand gemerkt (memo), Blättern und Hover kosten nichts.
// Mattenwechsel: gerechnet im Modul (kpiHooks.matten aus views/matten-uebersicht.js, core/matten-uebersicht.js), sobald
// es geladen ist; hier nur gezeichnet. Umsatz daraus nur mit Recht auf die Fakturierung. Wäscherei je Monat und
// Schwundquote aus dem Matten-Bestand (kpiHooks.mattenBestand, views/matten-bestand.js), wenn es Buchungen gibt.
// Kundenverträge (kpiHooks.vertraege, views/invoicing-vertraege.js, core/vertraege.js): Vertragsvolumen je Monat,
// Kündigungen und Vertragsenden je Monat, Verträge, die in den nächsten 90 Tagen enden – nur mit Fakturierung.
// Geräte & Maschinen: Zustand, überfällige Prüfungen, Reparaturkosten je Monat (core/geraete.js → geraeteKpi).
// Vertrieb (kpiHooks.vertrieb, views/vertrieb.js, core/vertrieb.js → salesKpi): Pipeline-Wert, Abschlussquote, Dauer
// von der Anfrage bis zum Auftrag, Pipeline je Stufe, Abschlüsse je Monat – wer den Vertrieb sieht.
//
// Zeitraum: 4/8/13 Wochen für die Wochen-Kennzahlen, 3/6/12 Monate für die Monats-Kennzahlen.
// Monats-Kacheln zeigen den letzten abgeschlossenen Monat (der laufende ist noch unvollständig).

import { CALC_DEFAULTS, calcWage } from '../../core/calculation.js'
import { geraeteKpi, STATUS as GERAET_STATUS } from '../../core/geraete.js'
import { employedOn, sollMinutes } from '../../core/contract.js'
import { addDays, formatDate, isoWeek, mondayOf, MONTH_LONG, todayISO } from '../../core/dates.js'
import { absenceRates, aging, cashBalance, complaintsByMonth, complaintsTopObjects, contribution, lastMonths, lastWeeks, materialByObject, materialMonths, payablesAging, PERIODS, plusHours, revenueByObject, revenueMonths, spendingMonths, topCustomers, trend, utilization, weekStats } from '../../core/kpi.js'
import { mergeRules } from '../../core/rules.js'
import { fmtAvg, fmtNps, fmtRate, history as kzHistory, periodShort, scopeObjectIds } from '../../core/zufriedenheit.js'
import { buildTimesheet, summarizeDays } from '../../core/timesheet.js'
import { app, computeRange, memo, registerActions, registerView, render, seesAbsenceReasons } from '../context.js'
import { barList, columnChart, legend, lineChart, sparkline, tableView } from '../kpi-charts.js'
import { esc } from '../shared.js'
import { kpiAvailable, kpiHooks } from './lazy.js'

const ICON = '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="6" width="3" height="12" rx="1"/><rect x="16" y="9" width="3" height="9" rx="1"/>'

// ---------------------------------------------------------------- Formate

const nf = (d = 0) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: d, minimumFractionDigits: 0 })
const hours = (min) => `${nf(0).format(Math.round(min / 60))} h`
const hoursAxis = (min) => nf(0).format(Math.round(min / 60))
// wie überall in der App: „€ 2.849“ (Währungsformat Österreich, ohne Cent)
const euroFmt = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 })
const euro = (v) => euroFmt.format(Math.round(v))
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
    // Tage je Person einmal nach Woche und Monat ordnen (statt je Woche und Monat alle Tage zu filtern)
    const spanKey = (spans) => {
      const at = new Map()
      for (const x of spans) for (let d = x.from; d <= x.to; d = addDays(d, 1)) at.set(d, x.key)
      return (date) => at.get(date)
    }
    const weekKey = spanKey(weeks)
    const monthKey = spanKey(months)
    const bucket = (days, keyOf) => {
      const out = new Map()
      for (const d of days) {
        const k = keyOf(d.date)
        if (k === undefined) continue
        const list = out.get(k)
        if (list) list.push(d)
        else out.set(k, [d])
      }
      return out
    }
    const byWeek = [...daysOf.values()].map((days) => bucket(days, weekKey))
    const byMonth = new Map([...daysOf].map(([id, days]) => [id, bucket(days, monthKey)]))
    const travelByWeek = new Map(weeks.map((w) => [w.key, byWeek.reduce((s, m) => s + (m.has(w.key) ? summarizeDays(m.get(w.key)).travel : 0), 0)]))
    const scheduledWeeks = new Set(Object.keys(data.assignments || {}).map((k) => mondayOf(k.slice(0, 10))))
    out.week = weekStats({ weeks, instances: r.instances, state: r.state, stamps: data.stamps, travelByWeek, scheduled: (m) => scheduledWeeks.has(m) })
    out.hasStamps = out.week.some((w) => w.ist > 0)
    out.util = utilization({ employees, instances: r.instances, state: r.state, from: weeks[0].from, to: weeks.at(-1).to })
    const legal = new Set([...r.holidays.entries()].filter(([, h]) => h.legal !== false).map(([d]) => d))
    // Krankenstand und Urlaub nur, wer den Grund lesen darf (sonst stünde im Betrieb 0 %, in der Vorschau der echte Wert)
    if (seesAbsenceReasons()) out.absence = absenceRates({ months, employees, absences: data.absences || [], holidays: legal })
    out.plus = months.map((m) => {
      const rows = employees.map((emp) => {
        const days = byMonth.get(emp.id)?.get(m.key) || []
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
  // Geräte & Maschinen: Zustand, überfällige Prüfungen, Reparaturkosten je Monat (nur wenn Geräte da sind)
  if (sees('geraete') && data.geraete?.items?.length) out.geraete = geraeteKpi({ doc: data.geraete, months, today })
  // Kundenzufriedenheit: Runden mit Antworten (Objektleitung: nur ihre Objekte)
  if (sees('zufriedenheit') && data.zufriedenheit?.answers?.length) {
    const scope = scopeObjectIds({ all: !app.access || !!app.access.all, groups: app.user?.groups || [], reviere: app.config?.access?.reviere || {}, objects: data.objects || [] })
    out.kz = kzHistory(data.zufriedenheit, { today, scope }).filter((x) => x.count)
  }
  // Mattenwechsel (Büro): Wechsel Soll/Ist, Pünktlichkeit, nicht durchgeführt, Matten je Größe; Umsatz nur mit Fakturierung
  if (sees('matten') && kpiHooks.matten) {
    const m = kpiHooks.matten({ months, today })
    if (m && (m.months.some((x) => x.soll || x.ist || x.nicht) || m.sizes.length)) {
      out.matten = m
      if (m.invoices && sees('fakturierung')) out.mattenRevenue = revenueMonths({ ...(data.fakturierung || {}), documents: m.invoices }, months)
    }
  }
  // Mattenbestand: Wäschereimengen und Schwundquote je Monat (nur wenn gebucht wurde)
  if (sees('matten') && kpiHooks.mattenBestand) {
    const b = kpiHooks.mattenBestand({ months, today })
    if (b) out.mattenBestand = b
  }
  // Kundenverträge: Volumen, Kündigungen, auslaufende Verträge (gerechnet im Modul der Fakturierung)
  if (sees('fakturierung') && kpiHooks.vertraege) {
    const v = kpiHooks.vertraege({ months, today })
    if (v) out.vertraege = v
  }
  // Vertrieb: Pipeline, Abschlussquote, Dauer Anfrage → Auftrag (gerechnet im Modul, sobald es Fälle gibt)
  if (sees('vertrieb') && kpiHooks.vertrieb) {
    const v = kpiHooks.vertrieb({ months, today })
    if (v) out.vertrieb = v
  }
  // Einkauf & Kasse: Ausgaben (Eingangsrechnungen), offene Verbindlichkeiten, Kassenstand
  if (sees('einkauf')) {
    out.spending = spendingMonths(data.einkauf || {}, months)
    out.payables = payablesAging(data.einkauf || {}, today)
    if (data.kasse?.entries?.length) out.cash = cashBalance(data.kasse)
  }
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
  if (d.vertraege && lastI >= 0) {
    const vm = d.vertraege.months
    out.push(tile({ label: `Vertragsvolumen ${mLabel}`, value: euro(vm[lastI].volume), sub: `netto je Monat, ${count(vm[lastI].active)} Verträge`, cur: vm[lastI].volume, prev: vm[lastI - 1]?.volume ?? null, goodUp: true, deltaFmt: euro, spark: vm.map((x) => x.volume), view: 'fakturierung', vs: 'Vormonat' }))
    const end = d.vertraege.ending
    out.push(tile({ label: 'Auslaufende Verträge', value: count(end.length), sub: end.length ? `in 90 Tagen, ${euro(end.reduce((s, x) => s + x.volume, 0))} je Monat` : 'keiner in den nächsten 90 Tagen', cur: end.length, view: 'fakturierung' }))
  }
  if (d.vertrieb) {
    const v = d.vertrieb
    out.push(tile({ label: 'Pipeline-Wert', value: euro(v.pipeline.weighted), sub: `je Monat gewichtet, ${count(v.pipeline.count)} offene Fälle, ungewichtet ${euro(v.pipeline.value)}`, cur: v.pipeline.weighted, view: 'vertrieb' }))
    out.push(tile({ label: 'Abschlussquote Vertrieb', value: pct(v.rate, 0), sub: `${count(v.won)} gewonnen, ${count(v.lost)} verloren im Zeitraum`, cur: v.rate ?? 0, view: 'vertrieb' }))
    out.push(tile({ label: 'Anfrage bis Auftrag', value: v.days.avg === null ? '–' : `${nf(0).format(v.days.avg)} Tage`, sub: v.days.median === null ? 'noch kein Auftrag im Zeitraum' : `Durchschnitt; Median ${nf(0).format(v.days.median)} Tage`, cur: v.days.avg ?? 0, view: 'vertrieb' }))
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
  if (d.geraete) {
    const g = d.geraete
    out.push(tile({ label: 'Geräte: Prüfung überfällig', value: count(g.overdue), sub: `${count(g.byStatus.gesperrt)} außer Betrieb · ${count(g.byStatus.reparatur)} in Reparatur`, cur: g.overdue, view: 'geraete' }))
    if (lastI >= 0) out.push(tile({ label: `Reparaturkosten Geräte ${mLabel}`, value: euro(g.repairs[lastI].cost), sub: `${count(g.repairs[lastI].count)} Reparaturen, netto`, cur: g.repairs[lastI].cost, prev: g.repairs[lastI - 1]?.cost ?? null, goodUp: false, deltaFmt: euro, spark: g.repairs.map((x) => x.cost), view: 'geraete', vs: 'Vormonat' }))
  }
  if (d.spending && lastI >= 0) {
    const cur = d.spending[lastI]
    out.push(tile({ label: `Ausgaben ${mLabel}`, value: euro(cur.net), sub: `netto, ${count(cur.count)} Eingangsrechnungen`, cur: cur.net, prev: d.spending[lastI - 1]?.net ?? null, goodUp: false, deltaFmt: euro, spark: d.spending.map((x) => x.net), view: 'einkauf', vs: 'Vormonat' }))
    const open = d.payables.reduce((s, x) => s + x.amount, 0)
    const overdue = d.payables.filter((x) => x.id !== 'nicht').reduce((s, x) => s + x.amount, 0)
    out.push(tile({ label: 'Offene Verbindlichkeiten', value: euro(open), sub: overdue ? `davon ${euro(overdue)} überfällig` : 'nichts überfällig', cur: open, view: 'einkauf' }))
  }
  if (d.kz?.length) {
    const [prev, cur] = d.kz.length > 1 ? d.kz.slice(-2) : [null, d.kz[0]]
    out.push(tile({ label: 'Kundenzufriedenheit', value: `${fmtAvg(cur.overall)} von 5`, sub: `NPS ${fmtNps(cur.nps)} · Rücklauf ${fmtRate(cur.rate)} (${periodShort(cur.period)})`, cur: cur.overall, prev: prev?.overall ?? null, goodUp: true, deltaFmt: fmtAvg, spark: d.kz.map((x) => x.overall), view: 'zufriedenheit', vs: 'Vorrunde' }))
  }
  if (d.cash !== undefined) out.push(tile({ label: 'Kassenstand', value: euro(d.cash), sub: 'laut Kassenbuch', cur: d.cash, view: 'kassenbuch' }))
  if (d.matten && lastI >= 0) {
    const ms = d.matten.months
    const cur = ms[lastI]
    const prev = ms[lastI - 1] ?? null
    out.push(tile({ label: `Mattenwechsel ${mLabel}`, value: count(cur.ist), sub: `bestätigte Wechsel, geplant waren ${count(cur.soll)}`, cur: cur.ist, prev: prev?.ist ?? null, deltaFmt: count, spark: ms.map((x) => x.ist), view: 'mw-uebersicht', vs: 'Vormonat' }))
    out.push(tile({ label: `Pünktlichkeit Mattenwechsel ${mLabel}`, value: pct(cur.rate, 0), sub: cur.erledigt ? `${count(cur.puenktlich)} von ${count(cur.erledigt)} bis zum Solltermin${d.matten.tolerance ? ` + ${d.matten.tolerance} Tage` : ''}` : 'kein erledigter Wechsel im Monat', cur: cur.rate ?? 0, prev: cur.rate === null ? null : (prev?.rate ?? null), goodUp: true, deltaFmt: (v) => `${nf(0).format(v * 100)} Pp.`, spark: ms.map((x) => x.rate), view: 'mw-kalender', vs: 'Vormonat' }))
    out.push(tile({ label: `Nicht durchgeführt ${mLabel}`, value: count(cur.nicht), sub: 'Mattenwechsel mit Ausnahme in der Tour', cur: cur.nicht, prev: prev?.nicht ?? null, goodUp: false, deltaFmt: count, spark: ms.map((x) => x.nicht), view: 'mw-uebersicht', vs: 'Vormonat' }))
    if (d.mattenRevenue) {
      const r = d.mattenRevenue
      out.push(tile({ label: `Umsatz Mattenwechsel ${mLabel}`, value: euro(r[lastI].net), sub: 'netto, festgeschriebene Rechnungen', cur: r[lastI].net, prev: r[lastI - 1]?.net ?? null, goodUp: true, deltaFmt: euro, spark: r.map((x) => x.net), view: 'fakturierung', vs: 'Vormonat' }))
    }
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
  if (d.vertraege) {
    const vm = d.vertraege.months
    out.push(card({ id: 'vertragsvolumen', title: 'Vertragsvolumen je Monat', sub: 'netto, Daueraufträge der Verträge je Monat umgerechnet', view: 'fakturierung', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'vol', label: 'Vertragsvolumen', color: '--kpi-1', values: vm.map((x) => x.volume) }], fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Vertragsvolumen je Monat' }), table: tableView(['Monat', 'Volumen netto', 'Verträge'], vm.map((x, i) => [mt[i], euro(x.volume), count(x.active)])) }))
    const series = [
      { id: 'kuend', label: 'Kündigungen eingegangen', color: '--kpi-1', values: vm.map((x) => x.cancelled) },
      { id: 'ende', label: 'Verträge beendet', color: '--kpi-2', values: vm.map((x) => x.ended) },
    ]
    const end = d.vertraege.ending
    out.push(card({ id: 'kuendigungen', title: 'Kündigungen und Vertragsenden', sub: end.length ? `${count(end.length)} Verträge enden in den nächsten 90 Tagen` : 'keiner endet in den nächsten 90 Tagen', view: 'fakturierung', legendHtml: legend(series, 'rect'), body: columnChart({ labels: ml, titles: mt, series, fmt: count, integer: true, width: W, ariaLabel: 'Kündigungen und Vertragsenden je Monat' }), table: tableView(['Monat', 'Kündigungen', 'vom Kunden', 'von uns', 'beendet'], vm.map((x, i) => [mt[i], count(x.cancelled), count(x.byCustomer), count(x.byUs), count(x.ended)])) }))
  }
  if (d.vertrieb) {
    const v = d.vertrieb
    out.push(card({ id: 'vertrieb-pipeline', title: 'Pipeline je Stufe', sub: 'erwarteter Umsatz je Monat, gewichtet mit der Wahrscheinlichkeit', view: 'vertrieb', body: barList({ rows: v.byStage.map((x) => ({ label: x.label, value: x.weighted, display: euro(x.weighted), sub: `${count(x.count)} Fälle`, extra: [['ungewichtet', euro(x.value), '']] })) }), table: tableView(['Stufe', 'Fälle', 'Umsatz je Monat', 'gewichtet'], v.byStage.map((x) => [x.label, count(x.count), euro(x.value), euro(x.weighted)])) }))
    const series = [
      { id: 'won', label: 'gewonnen', color: '--kpi-1', values: v.months.map((x) => x.won) },
      { id: 'lost', label: 'verloren', color: '--kpi-2', values: v.months.map((x) => x.lost) },
    ]
    out.push(card({ id: 'vertrieb-abschluesse', title: 'Abschlüsse im Vertrieb je Monat', sub: v.rate === null ? 'noch keine Entscheidung im Zeitraum' : `Abschlussquote ${pct(v.rate, 0)}`, view: 'vertrieb', legendHtml: legend(series, 'rect'), body: columnChart({ labels: ml, titles: mt, series, fmt: count, integer: true, width: W, ariaLabel: 'Gewonnene und verlorene Fälle je Monat' }), table: tableView(['Monat', 'neue Anfragen', 'gewonnen', 'verloren', 'Umsatz je Monat gewonnen'], v.months.map((x, i) => [mt[i], count(x.created), count(x.won), count(x.lost), euro(x.wonValue)])) }))
  }
  if (d.spending) {
    out.push(card({ id: 'ausgaben', title: 'Ausgaben je Monat', sub: 'netto laut Eingangsrechnungen (Rechnungsdatum)', view: 'einkauf', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'net', label: 'Ausgaben netto', color: '--kpi-1', values: d.spending.map((x) => x.net) }], fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Ausgaben je Monat' }), table: tableView(['Monat', 'Ausgaben netto', 'Eingangsrechnungen'], d.spending.map((x, i) => [mt[i], euro(x.net), count(x.count)])) }))
    const STATUS = { nicht: ['--kpi-neutral', '○'], d30: ['--kpi-warning', '△'], d60: ['--kpi-serious', '▲'], d60plus: ['--kpi-critical', '■'] }
    out.push(card({ id: 'verbindlichkeiten', title: 'Offene Verbindlichkeiten nach Fälligkeit', sub: 'brutto, Eingangsrechnungen', view: 'einkauf', body: agingBars(d.payables, STATUS), table: tableView(['Fälligkeit', 'Betrag', 'Rechnungen'], d.payables.map((x) => [x.label, euro(x.amount), count(x.count)])) }))
  }
  if (d.material) {
    const series = [
      { id: 'used', label: 'Verbrauch', color: '--kpi-1', values: d.material.map((x) => x.used) },
      { id: 'ordered', label: 'Bestellwert', color: '--kpi-2', values: d.material.map((x) => x.ordered) },
    ]
    out.push(card({ id: 'material', title: 'Material je Monat', sub: 'Ausgaben an Objekte und Personen, bestellte Ware', view: 'material', legendHtml: legend(series), body: lineChart({ labels: ml, titles: mt, series, fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Material je Monat' }), table: tableView(['Monat', 'Verbrauch', 'Bestellwert'], d.material.map((x, i) => [mt[i], euro(x.used), euro(x.ordered)])) }))
  }
  if (d.matten) {
    const m = d.matten
    const series = [
      { id: 'soll', label: 'Soll (geplant)', color: '--kpi-1', values: m.months.map((x) => x.soll) },
      { id: 'ist', label: 'Ist (gewechselt)', color: '--kpi-2', values: m.months.map((x) => x.ist) },
    ]
    out.push(card({ id: 'matten-wechsel', title: 'Mattenwechsel je Monat', sub: m.loading ? 'Soll laut Einsätzen; Ist aus den Touren wird noch gelesen' : 'Soll: Einsätze mit Solltermin im Monat; Ist: bestätigte Wechsel', view: 'mw-uebersicht', legendHtml: legend(series), body: lineChart({ labels: ml, titles: mt, series, fmt: count, integer: true, width: W, ariaLabel: 'Mattenwechsel je Monat, Soll und Ist' }), table: tableView(['Monat', 'Soll', 'Ist', 'nicht durchgeführt'], m.months.map((x, i) => [mt[i], count(x.soll), count(x.ist), count(x.nicht)])) }))
    out.push(card({ id: 'matten-puenktlich', title: 'Pünktlichkeit der Mattenwechsel', sub: `erledigt bis zum Solltermin${m.tolerance ? ` plus ${m.tolerance} Tage` : ''}`, view: 'mw-kalender', body: lineChart({ labels: ml, titles: mt, series: [{ id: 'rate', label: 'pünktlich', color: '--kpi-1', values: m.months.map((x) => x.rate) }], fmt: (v) => pct(v, 0), axis: (v) => pct(v, 0), unit: 0.01, top: 1, width: W, ariaLabel: 'Pünktlichkeit der Mattenwechsel je Monat' }), table: tableView(['Monat', 'erledigt', 'pünktlich', 'Quote'], m.months.map((x, i) => [mt[i], count(x.erledigt), count(x.puenktlich), pct(x.rate, 0)])) }))
    out.push(card({ id: 'matten-nicht', title: 'Nicht durchgeführte Mattenwechsel', sub: 'Liegeplätze mit Ausnahme in der Tour (auch später nachgeholte)', view: 'mw-uebersicht', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'nicht', label: 'nicht durchgeführt', color: '--kpi-1', values: m.months.map((x) => x.nicht) }], fmt: count, integer: true, width: W, ariaLabel: 'Nicht durchgeführte Mattenwechsel je Monat' }), table: tableView(['Monat', 'nicht durchgeführt'], m.months.map((x, i) => [mt[i], count(x.nicht)])) }))
    const swapped = new Map(m.exchanged.map((x) => [x.size, x.qty]))
    out.push(card({ id: 'matten-groessen', title: 'Matten je Größe', sub: 'an den aktiven Liegeplätzen; dazu im Zeitraum gewechselt', view: 'mw-liegeplaetze', body: barList({ rows: m.sizes.map((x) => ({ label: x.size, value: x.qty, display: `${count(x.qty)} Stk`, sub: `${x.placements} Liegepl.`, extra: [['im Zeitraum gewechselt', `${count(swapped.get(x.size) || 0)} Stk`, '']] })) }), table: tableView(['Größe', 'Matten', 'Liegeplätze', 'gewechselt'], m.sizes.map((x) => [x.size, count(x.qty), count(x.placements), count(swapped.get(x.size) || 0)])) }))
    if (d.mattenRevenue) out.push(card({ id: 'matten-umsatz', title: 'Umsatz aus dem Mattenwechsel', sub: 'netto, festgeschriebene Rechnungen aus dem Mattenwechsel; Storno mindert', view: 'fakturierung', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'net', label: 'Umsatz netto', color: '--kpi-1', values: d.mattenRevenue.map((x) => x.net) }], fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Umsatz aus dem Mattenwechsel je Monat' }), table: tableView(['Monat', 'Umsatz netto', 'Rechnungen'], d.mattenRevenue.map((x, i) => [mt[i], euro(x.net), count(x.count)])) }))
  }
  if (d.geraete) {
    const g = d.geraete
    const order = ['betrieb', 'reparatur', 'gesperrt', 'ausgeschieden']
    out.push(card({ id: 'geraete-zustand', title: 'Geräte nach Zustand', sub: `${count(g.overdue)} mit überfälliger Prüfung, ${count(g.due)} bald fällig`, view: 'geraete', body: barList({ rows: order.map((s) => ({ label: GERAET_STATUS[s], value: g.byStatus[s], display: `${count(g.byStatus[s])} Geräte` })) }), table: tableView(['Zustand', 'Geräte'], order.map((s) => [GERAET_STATUS[s], count(g.byStatus[s])])) }))
    out.push(card({ id: 'geraete-kosten', title: 'Reparaturkosten der Geräte je Monat', sub: 'netto, Monat laut „erledigt am“; nur Auswertung, gebucht wird im Einkauf', view: 'geraete', body: columnChart({ labels: ml, titles: mt, series: [{ id: 'cost', label: 'Reparaturkosten', color: '--kpi-1', values: g.repairs.map((x) => x.cost) }], fmt: euro, axis: euroAxis, width: W, ariaLabel: 'Reparaturkosten der Geräte je Monat' }), table: tableView(['Monat', 'Kosten netto', 'Reparaturen'], g.repairs.map((x, i) => [mt[i], euro(x.cost), count(x.count)])) }))
  }
  if (d.mattenBestand) {
    const w = d.mattenBestand.months
    const ws = [
      { id: 'abgeholt', label: 'zur Wäscherei', color: '--kpi-1', values: w.map((x) => x.abgeholt) },
      { id: 'zurueck', label: 'sauber zurück', color: '--kpi-2', values: w.map((x) => x.zurueck) },
    ]
    out.push(card({ id: 'mwb-waesche', title: 'Wäscherei je Monat', sub: 'Matten zur Wäscherei und sauber zurück; Schwund und ausgeschieden in der Tabelle', view: 'mw-bestand', legendHtml: legend(ws), body: columnChart({ labels: ml, titles: mt, series: ws, fmt: count, integer: true, width: W, ariaLabel: 'Matten zur Wäscherei und zurück je Monat' }), table: tableView(['Monat', 'zur Wäscherei', 'zurück', 'Schwund', 'ausgeschieden', 'Schwundquote'], w.map((x, i) => [mt[i], count(x.abgeholt), count(x.zurueck), count(x.schwund), count(x.aus), pct(x.rate, 1)])) }))
    out.push(card({ id: 'mwb-schwund', title: 'Schwundquote der Matten', sub: 'Schwund ÷ (sauber zurück + Schwund + ausgeschieden) im Monat', view: 'mw-bestand', body: lineChart({ labels: ml, titles: mt, series: [{ id: 'rate', label: 'Schwundquote', color: '--kpi-1', values: w.map((x) => x.rate) }], fmt: (v) => pct(v, 1), axis: (v) => pct(v, 0), unit: 0.01, width: W, ariaLabel: 'Schwundquote der Matten je Monat' }), table: tableView(['Monat', 'Schwund', 'zurückgemeldet', 'Quote'], w.map((x, i) => [mt[i], count(x.schwund), count(x.zurueck + x.schwund + x.aus), pct(x.rate, 1)])) }))
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
  const d = memo(c, `kennzahlen:${p}:${todayISO()}:${narrow() ? 's' : 'l'}:${kpiHooks.version()}:${kpiHooks.matten ? 'm' : ''}${kpiHooks.mattenBestand ? 'b' : ''}${kpiHooks.vertraege ? 'v' : ''}${kpiHooks.vertrieb ? 't' : ''}`, () => build(p))
  const filters = Object.entries(PERIODS)
    .map(([id, x]) => `<button class="filter" data-action="kpi-period" data-period="${id}" aria-pressed="${id === p}">${esc(x.label)}</button>`)
    .join('')
  const t = tiles(d)
  const ch = charts(d)
  return `<div class="kpi-root">
    <div class="section-head"><div><h2>Kennzahlen</h2><p>Die wichtigsten Zahlen auf einen Blick: Stunden, Besetzung, Abwesenheit, Plus-Stunden, Reklamationen, Kundenzufriedenheit, Umsatz, Verträge, Vertrieb, Ausgaben, Kasse, Material, Geräte und Mattenwechsel. Monats-Kacheln zeigen den letzten abgeschlossenen Monat. Eine Kachel antippen öffnet den Bereich.</p></div></div>
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
  available: kpiAvailable,
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
