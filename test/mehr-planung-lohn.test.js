import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { addMonths, classifyWeek, closureRow, drBalances, hourlyWage, mehrLedger, payMonth, payrollFrom, payrollWeeks, premiumPct } from '../src/core/overtime.js'
import { euroText, monthName, payoutEntries, payoutListText, payoutPersonText, payoutSig } from '../src/core/payout.js'
import { exportFileName, exportLines, exportProblems, exportText, keyTotals } from '../src/core/payroll-export.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, mergeRules } from '../src/core/rules.js'
import { buildTimesheet, timesheetSignature } from '../src/core/timesheet.js'
import { addMonths as trainingsAddMonths } from '../src/core/trainings.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, weeklyHours, extra = {}) => ({ id, name: id, type: weeklyHours >= 40 ? 'Vollzeit' : 'Teilzeit', weeklyHours, skills: [], trained: ['o1'], availability: allDays, ...extra })
const task = (id, weekdays, start, end, regulars, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars, skills: [], holidayRule: 'findet_statt', ...extra })
const h = (n) => n * 60

/** Plan mit Stammkräften (außer abwesend) und Wochenzettel einer Person. */
function sheet(monday, employees, tasks, { absences = [], who = employees[0].id, rules = { breakAfterH: 24 }, assignments } = {}) {
  const data = { employees, objects: [{ id: 'o1', name: 'Büro Maxglan' }], tasks, absences, rules, travel: {}, trips: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-01', '2027-01-31')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-26', '2027-01-03', holidays, ctx.rules)
  const absent = (id, date) => absences.some((a) => a.employeeId === id && date >= a.from && date <= a.to)
  const asg = assignments || Object.fromEntries(instances.filter((i) => i.status !== 'cancelled').map((i) => [i.key, i.regulars.filter((id) => !absent(id, i.date)).map((employeeId) => ({ employeeId }))]))
  const state = new PlanState(instances, asg)
  const ts = buildTimesheet(ctx, ctx.employeesById.get(who), monday, instances, state)
  return { ctx, ts, state, instances, w: () => classifyWeek(ctx, ts) }
}
const byCls = (w) => w.parts.reduce((m, p) => ({ ...m, [p.cls]: (m[p.cls] || 0) + p.min }), {})

const ctx = { rules: mergeRules({}) }
const mk = (monday, sunday, parts = [], minus = 0, extra = {}) => ({ monday, sunday, parts, minus, contract: h(30), credited: 0, worked: 0, normal: 0, mehr: 0, ue: 0, ue11: 0, longest: 0, ...extra })

// ---------------------------------------------------------------- Überstunden und Zuschläge

test('Monate addieren (Frist für Mehrarbeit): Monatsende begrenzt, Schaltjahr, rückwärts; wie bei den Fristen', () => {
  const cases = [['2026-01-31', 1, '2026-02-28'], ['2028-01-31', 1, '2028-02-29'], ['2026-11-15', 3, '2027-02-15'], ['2026-08-31', 3, '2026-11-30'], ['2026-03-31', -1, '2026-02-28'], ['2026-01-15', -1, '2025-12-15'], ['2026-05-31', -4, '2026-01-31'], ['2026-12-31', 12, '2027-12-31']]
  for (const [date, n, out] of cases) {
    assert.equal(addMonths(date, n), out, `${date} + ${n}`)
    assert.equal(trainingsAddMonths(date, n), out, `Unterweisungen: ${date} + ${n}`)
  }
})

test('Stundenlohn: eigener Lohn vor KV-Lohngruppe (2026), sonst unbekannt', () => {
  const r = mergeRules({})
  assert.deepEqual([hourlyWage({ hourlyWage: 14.5, wageGroup: 6 }, r), hourlyWage({ wageGroup: 1 }, r), hourlyWage({ wageGroup: '3' }, r), hourlyWage({ hourlyWage: 0, wageGroup: 6 }, r), hourlyWage({}, r), hourlyWage({ wageGroup: 9 }, r)], [14.5, 15.12, 12.99, 12.37, 0, 0])
})

test('Zuschläge laut KV Denkmal-, Fassaden- und Gebäudereinigung je Stundenart und Zeitklasse', () => {
  const r = mergeRules({})
  const table = {
    ue: { tag: 50, nacht: 100, sonntag: 150, sonntagnacht: 175, feiertag: 100 },
    ue11: { tag: 75, nacht: 125, sonntag: 175, sonntagnacht: 175, feiertag: 125 },
    normal: { tag: 0, nacht: 50, sonntag: 100, sonntagnacht: 150, feiertag: 100 },
    mehr: { tag: 0, nacht: 50, sonntag: 100, sonntagnacht: 150, feiertag: 100 },
  }
  for (const [type, row] of Object.entries(table)) for (const [cls, pct] of Object.entries(row)) assert.equal(premiumPct(r, type, cls), pct, `${type}/${cls}`)
  assert.equal(premiumPct(mergeRules({ pay: { ueNacht: 110 } }), 'ue', 'nacht'), 110, 'einstellbar')
})

test('Zeitklassen: Nacht Sa→So (21–6 Uhr, Sonntag Nacht), Sonntag 6–21 Uhr', () => {
  const { w } = sheet('2026-11-02', [emp('e1', 30)], [task('sa', [6], '22:00', '02:00', ['e1']), task('so', [7], '20:00', '23:00', ['e1'])])
  const week = w()
  assert.deepEqual(byCls(week), { nacht: 120, sonntagnacht: 240, sonntag: 60 })
  assert.ok(week.parts.filter((p) => p.date === '2026-11-07').every((p) => p.cls === 'nacht'))
  assert.deepEqual([week.normal, week.mehr, week.ue, week.minus], [420, 0, 0, h(30) - 420])
})

test('Zeitklassen: Feiertag geht dem Sonntag vor (Allerheiligen 2026), Nacht davor bleibt Nacht', () => {
  const { w } = sheet('2026-10-26', [emp('e1', 30)], [task('so', [7], '08:00', '10:00', ['e1']), task('sa', [6], '22:00', '01:00', ['e1'])])
  assert.deepEqual(byCls(w()), { nacht: 120, feiertag: 180 })
})

test('Teilzeit: in derselben Woche Mehrarbeit bis 40 h und Überstunde über 9 h am Tag', () => {
  const tasks = [task('mo', [1], '06:00', '16:00', ['t']), task('rest', [2, 3, 4], '06:00', '10:00', ['t'])]
  const w = sheet('2026-11-02', [emp('t', 20)], tasks).w()
  assert.deepEqual([w.normal, w.mehr, w.ue, w.ue11, w.minus, w.longest], [h(20), h(1), h(1), 0, 0, h(10)])
})

test('Abrechnung ohne Stundenlohn: nichts ausbezahlt und nichts aus dem Zeitkonto gebucht', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-04', type: 'ue', cls: 'tag', min: 120 }, { date: '2026-11-05', type: 'mehr', cls: 'tag', min: 60 }])]
  const res = payMonth(ctx, { id: 'e1' }, '2026-11', weeks, { modes: { mehr: 'auszahlen' } })
  assert.deepEqual([res.missingWage, res.uePaid, res.mehr.paid, res.mehr.paidEntries, res.accountDelta, res.amount], [true, 0, 0, [], 0, 0])
})

test('Nachtüberstunden: auszahlen (+100 %), 1:1 mit Zuschlag in Geld, Zeitausgleich; steuerfrei höchstens 50 %', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-04', type: 'ue', cls: 'nacht', min: 120 }])]
  const person = { id: 'e1', hourlyWage: 20 }
  const paid = payMonth(ctx, person, '2026-11', weeks)
  assert.deepEqual([paid.amount, paid.taxFree, paid.accountDelta, paid.uePaid], [80, 20, -120, 120])
  assert.equal(paid.lines[0].label, 'Überstunden Nacht (+100 %)')
  const mix = payMonth(ctx, person, '2026-11', weeks, { modes: { ue: 'mix' } })
  assert.deepEqual([mix.amount, mix.taxFree, mix.accountDelta, mix.lines[0].label], [40, 20, 0, 'Zuschlag Überstunden Nacht (+100 %)'])
  const za = payMonth(ctx, person, '2026-11', weeks, { modes: { ue: 'za' } })
  assert.deepEqual([za.amount, za.zaBonus, za.accountDelta, za.taxFree, za.lines], [0, 120, 120, 0, []])
  assert.equal(payMonth(ctx, { ...person, ueMode: 'za' }, '2026-11', weeks).zaBonus, 120, 'Einstellung der Person')
})

test('11./12. Stunde (+75 %) und Feiertagsüberstunde (Zuschlag schon als Zeit gutgeschrieben)', () => {
  const weeks = [mk('2026-12-07', '2026-12-13', [{ date: '2026-12-08', type: 'ue', cls: 'feiertag', min: 60 }, { date: '2026-12-09', type: 'ue11', cls: 'tag', min: 60 }])]
  const res = payMonth(ctx, { id: 'e1', hourlyWage: 12 }, '2026-12', weeks)
  const by = Object.fromEntries(res.lines.map((l) => [l.key, l]))
  assert.deepEqual([by['ue11-tag'].label, by['ue11-tag'].amount], ['Überstunden 11./12. Stunde (+75 %)', 21])
  assert.deepEqual([by['ue-feiertag'].pct, by['ue-feiertag'].amount, by['ue-feiertag'].note], [0, 12, '100 % schon als Zeit gutgeschrieben'])
  assert.equal(res.taxFree, 6, 'nur der Zuschlag in Geld ist steuerfrei: 1 h × 12 € × 50 %')
  assert.equal(res.amount, 33)
})

test('Abrechnungszeitraum: ab Montag vier Monate vor dem Monat bis Monatsende', () => {
  const r = mergeRules({})
  assert.equal(payrollFrom('2026-11', r), '2026-06-29')
  const weeks = payrollWeeks('2026-11', r)
  assert.deepEqual([weeks[0], weeks.at(-1), weeks.length], ['2026-06-29', '2026-11-30', 23])
  assert.equal(payrollFrom('2026-11', mergeRules({ pay: { mehrBalanceMonths: 1 } })), '2026-08-31')
})

test('Monatsabschluss-Zeile: Beträge und Buchungen ohne Hinweistexte', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-04', type: 'ue', cls: 'tag', min: 120 }])]
  const res = payMonth(ctx, { id: 'e1', hourlyWage: 12 }, '2026-11', weeks)
  const row = closureRow(res)
  assert.deepEqual(Object.keys(row).sort(), ['accountDelta', 'amount', 'lines', 'mehrDue', 'mehrMode', 'mehrPaid', 'mehrPaidEntries', 'taxFree', 'ueMode', 'uePaid', 'wage', 'zaBonus'])
  assert.deepEqual(row.lines, [{ key: 'ue-tag', label: 'Überstunden (+50 %)', min: 120, pct: 50, base: true, amount: 36 }])
  assert.deepEqual([row.amount, row.accountDelta, row.uePaid, row.wage], [36, -120, 120, 12])
})

test('Durchrechnung: Plus und Minus je Zeitraum, sortiert nach Beginn', () => {
  const A = { start: '2026-11-02', end: '2026-11-29', weeks: 4 }
  const B = { start: '2026-11-30', end: '2026-12-27', weeks: 4 }
  const res = drBalances([mk('2026-11-30', '2026-12-06', [], 0, { drPeriod: B, dr: 60 }), mk('2026-11-02', '2026-11-08', [], 0, { drPeriod: A, dr: 300 }), mk('2026-11-09', '2026-11-15', [], 120, { drPeriod: A, dr: 0 }), mk('2026-11-16', '2026-11-22', [], 600)])
  assert.deepEqual(res.map((p) => [p.start, p.plus, p.minus, p.balance, p.weeksKnown]), [['2026-11-02', 300, 120, 180, 2], ['2026-11-30', 60, 0, 60, 1]])
})

test('Mehrstunden-Konto: Mehrarbeit eines Tages zusammen, Minusstunden gleichen die älteste zuerst aus', () => {
  const weeks = [mk('2026-08-03', '2026-08-09', [{ date: '2026-08-04', type: 'mehr', cls: 'tag', min: 60 }, { date: '2026-08-04', type: 'mehr', cls: 'nacht', min: 30 }, { date: '2026-08-06', type: 'mehr', cls: 'tag', min: 120 }, { date: '2026-08-06', type: 'normal', cls: 'tag', min: 999 }]), mk('2026-08-10', '2026-08-16', [], 100)]
  const ledger = mehrLedger(weeks, { empId: 'e1', until: '2026-09-30' })
  assert.deepEqual(ledger.open, [{ date: '2026-08-06', min: 110, deadline: '2026-11-06' }])
  assert.equal(ledger.items.find((i) => i.kind === 'minus').used, 100)
  assert.deepEqual(mehrLedger(weeks, { empId: 'e1', until: '2026-08-10' }).open.map((e) => e.min), [90, 120], 'Stichtag vor den Minusstunden')
  const draft = { '2026-08': { rows: { e1: { mehrPaid: 110 } } } }
  assert.equal(mehrLedger(weeks, { empId: 'e1', until: '2026-09-30', closures: draft }).open.length, 1, 'nicht abgeschlossener Monat zählt nicht')
})

// ---------------------------------------------------------------- Wochenzettel

test('Wochenzettel: Krankenstand der Stammkraft angerechnet, Vertretung arbeitet zusätzlich', () => {
  const employees = [emp('x', 20, { name: 'Xaver Moser' }), emp('y', 20, { name: 'Yvonne Bauer' })]
  const tasks = [task('a', [2], '08:00', '10:00', ['x'])]
  const absences = [{ employeeId: 'x', type: 'Krankenstand', from: '2026-11-03', to: '2026-11-03' }]
  const assignments = { '2026-11-03|a': [{ employeeId: 'y' }] }
  const x = sheet('2026-11-02', employees, tasks, { absences, assignments }).ts
  const line = x.days[1].lines[0]
  assert.deepEqual([line.kind, line.credited, line.creditReason, line.style, line.notes], ['missed', 120, 'Krankenstand', 'struck', ['Krankenstand angerechnet', 'Vertretung: Yvonne Bauer']])
  assert.deepEqual([x.totals.credits, x.totals.absenceDays], [{ Krankenstand: 120 }, { Krankenstand: 1 }])
  const y = sheet('2026-11-02', employees, tasks, { absences, assignments, who: 'y' }).ts
  const work = y.days[1].lines[0]
  assert.deepEqual([work.kind, work.substitute, work.style, work.notes[0]], ['work', true, 'changed', 'Vertretung für Xaver Moser'])
  assert.equal(y.totals.substituteHours, 120)
})

test('Wochenzettel: Feiertag im Urlaub zählt als Feiertag, nicht als Urlaubstag', () => {
  const tasks = [task('a', [1, 2, 3, 4, 5], '08:00', '10:00', ['x'])]
  const absences = [{ employeeId: 'x', type: 'Urlaub', from: '2026-12-07', to: '2026-12-13' }]
  const { ts } = sheet('2026-12-07', [emp('x', 10)], tasks, { absences })
  assert.deepEqual(ts.days[1].lines[0].notes, ['Feiertag (Urlaub) angerechnet', 'nicht besetzt'])
  assert.deepEqual(ts.totals.credits, { feiertag: 120, Urlaub: 480 })
  assert.deepEqual(ts.totals.absenceDays, { Urlaub: 4 }, 'Mo–Fr ohne den 8.12.')
  assert.equal(ts.totals.saldo, 0)
})

test('Wochenzettel: entfallene Sonderleistung am Feiertag nur angerechnet, wenn eingestellt', () => {
  const tasks = [task('blumen', [2], '12:00', '12:30', ['x'], { category: 'sonder', holidayRule: 'entfaellt' })]
  const off = sheet('2026-12-07', [emp('x', 10)], tasks).ts.days[1].lines[0]
  assert.deepEqual([off.credited, off.creditReason, off.notes], [0, null, ['entfällt: Mariä Empfängnis']])
  const on = sheet('2026-12-07', [emp('x', 10)], tasks, { rules: { breakAfterH: 24, creditSpecialTasks: true } }).ts.days[1].lines[0]
  assert.deepEqual([on.credited, on.creditReason, on.notes], [30, 'feiertag', ['entfällt: Mariä Empfängnis', 'Feiertag angerechnet']])
})

test('Wochenzettel: Sonntagszuschlag in Geld statt als Zeit; Soll anteilig bei Eintritt am Mittwoch', () => {
  const tasks = [task('so', [7], '08:00', '10:00', ['x'])]
  const { ts } = sheet('2026-11-02', [emp('x', 20, { entryDate: '2026-11-04' })], tasks, { rules: { breakAfterH: 24, pay: { bonusAs: 'geld' } } })
  const line = ts.days[6].lines[0]
  assert.deepEqual([line.bonus, line.credited, line.sundayHoliday], [0, 120, 'sunday'])
  assert.ok(line.notes.includes('100 % Sonntagszuschlag wird ausbezahlt'))
  assert.deepEqual([ts.totals.soll, ts.totals.saldo], [h(12), 120 - h(12)])
})

test('Wochenzettel-Signatur: gleich bei gleichem Inhalt, anders bei neuer Abwesenheit', () => {
  const tasks = [task('a', [2], '08:00', '10:00', ['x'])]
  const one = sheet('2026-11-02', [emp('x', 20)], tasks).ts
  const two = sheet('2026-11-02', [emp('x', 20)], tasks).ts
  assert.equal(timesheetSignature(one), timesheetSignature(two))
  assert.match(timesheetSignature(one), /^[0-9a-z]+$/)
  const sick = sheet('2026-11-02', [emp('x', 20)], tasks, { absences: [{ employeeId: 'x', type: 'Krankenstand', from: '2026-11-05', to: '2026-11-05' }] }).ts
  assert.notEqual(timesheetSignature(one), timesheetSignature(sick))
})

// Regression: eine Nachtschicht, die nach Mitternacht in einen Sonn- oder Feiertag reicht, bekommt
// den Zuschlag für den Teil ab Mitternacht als Zeit gutgeschrieben; der Hinweis nannte dabei
// „inkl. 0 % Sonntagszuschlag“, weil der Satz vom (normalen) Beginntag genommen wurde.
test('Wochenzettel: Nachtschicht in den Sonn-/Feiertag nennt Zuschlag und Satz des Folgetags', () => {
  const nacht = (weekday) => [task('n', [weekday], '22:00', '02:00', ['x'])]
  const xmas = sheet('2026-12-21', [emp('x', 20)], nacht(4)).ts.days[3].lines[0]
  assert.deepEqual([xmas.inst.date, xmas.bonus, xmas.credited], ['2026-12-24', 120, 360])
  assert.ok(xmas.notes.includes('inkl. 100 % Feiertagszuschlag'), xmas.notes.join(' | '))
  const sat = sheet('2026-11-02', [emp('x', 20)], nacht(6), { rules: { breakAfterH: 24, sundayBonusPct: 50 } }).ts.days[5].lines[0]
  assert.deepEqual([sat.bonus, sat.credited], [60, 300])
  assert.ok(sat.notes.includes('inkl. 50 % Sonntagszuschlag'), sat.notes.join(' | '))
  assert.ok(!sat.notes.some((n) => n.includes(' 0 %')))
})

// ---------------------------------------------------------------- Auszahlung

test('Beträge und Monatsnamen für die Auszahlung', () => {
  assert.deepEqual([euroText(7.5), euroText(undefined), euroText(-12.3), euroText(0.005)], ['7,50 €', '0,00 €', '-12,30 €', '0,01 €'])
  assert.deepEqual([monthName('2027-01'), monthName('2026-12')], ['Jänner 2027', 'Dezember 2026'])
})

const row = (id, name, { amount = 0, accountDelta = 0, zaBonus = 0, lines = [] } = {}) => ({ employee: { id, name }, wage: 12.37, amount, taxFree: 0, accountDelta, zaBonus, ueMode: 'auszahlen', lines, total: { normal: 0, mehr: 0, ue: 0, ue11: 0 }, mehr: { open: [], openMin: 0 } })

test('Auszahlungsliste: ohne Betrag und Buchung nicht dabei, höchster Betrag zuerst, bei Gleichstand nach Name', () => {
  const rows = [row('a', 'Ana', {}), row('c', 'Cem', { amount: 20 }), row('b', 'Ben', { amount: 20 }), row('d', 'Dora', { amount: 50 }), row('e', 'Emil', { accountDelta: 30 })]
  assert.deepEqual(payoutEntries(rows).map((e) => e.employee.name), ['Dora', 'Ben', 'Cem', 'Emil'])
  const closed = { closedAt: '2026-12-01', rows: { d: { wage: 12.37, amount: 55, taxFree: 0, accountDelta: -60, zaBonus: 0, ueMode: 'auszahlen', lines: [] } } }
  assert.deepEqual(payoutEntries(rows, closed).map((e) => [e.employee.name, e.amount, e.fixed]), [['Dora', 55, true]])
  assert.equal(payoutEntries(rows, { rows: closed.rows }).length, 4, 'ohne Abschluss gelten die laufenden Werte')
})

test('Sammel-E-Mail: ohne Auszahlungen, Mehrzahl, keine doppelten Leerzeilen', () => {
  const empty = payoutListText([], { month: '2026-11', sender: 'Büro' })
  assert.match(empty, /im November 2026\. Alle Beträge brutto\./)
  assert.match(empty, /Diesen Monat gibt es keine Auszahlungen\./)
  assert.match(empty, /Summe: 0,00 € brutto für 0 Personen\./)
  assert.ok(!empty.includes('\n\n\n'))
  const two = payoutListText(payoutEntries([row('a', 'Ana', { amount: 10.5, lines: [{ min: 60, label: 'Mehrarbeit', amount: 10.5 }] }), row('b', 'Ben', { amount: 5 })]), { month: '2026-11' })
  assert.match(two, /Summe: 15,50 € brutto für 2 Personen\./)
  assert.match(two, /^Ana: 10,50 € {2}\(1 h Mehrarbeit\)$/m)
})

test('E-Mail an die Person: nur offene Mehrarbeit mit Frist, Zeitkonto plus ohne Auszahlung', () => {
  const open = payoutPersonText({ employee: { name: 'Cem Yilmaz' }, amount: 0, zaBonus: 0, accountDelta: 0, lines: [], mehrOpenMin: 120, mehrOpen: [{ date: '2026-10-14', min: 120, deadline: '2027-01-14' }] }, { month: '2026-11' })
  assert.match(open, /^Hallo Cem,/)
  assert.match(open, /Noch offen im Zeitkonto: 2 h Mehrarbeit, Ausgleich bis 14\.01\.2027\./)
  assert.ok(!open.includes('ausbezahlt'))
  const plus = payoutPersonText({ employee: { name: 'Ana' }, amount: 0, zaBonus: 90, ueMode: 'za', accountDelta: 90, lines: [] }, { month: '2026-11' })
  assert.match(plus, /Dein Zeitkonto ändert sich dadurch um \+1,5 h\.$/m)
})

test('Kennung der Auszahlung ändert sich auch bei anderer Zeitkonto-Buchung', () => {
  const a = payoutEntries([row('a', 'Ana', { amount: 10, accountDelta: -60, lines: [{ min: 60, label: 'x', amount: 10 }] })])
  const b = payoutEntries([row('a', 'Ana', { amount: 10, accountDelta: -90, lines: [{ min: 60, label: 'x', amount: 10 }] })])
  assert.equal(payoutSig(a), 'a:10.00:-60:10.00')
  assert.notEqual(payoutSig(a), payoutSig(b))
  assert.equal(payoutSig(a[0]), payoutSig(a), 'einzelner Eintrag wie Liste')
})

// ---------------------------------------------------------------- Lohn-Export

const ot = (over = {}) => ({ employee: { id: 'e1', personnelNo: '1001', name: 'Anna Berger' }, wage: 13.54, ueMode: 'auszahlen', total: { normal: 0 }, mehr: { paid: 0 }, hours: { ue: {}, ue11: {}, normal: {}, mehr: {} }, ...over })

test('Lohn-Export: „1:1 + Zuschlag in Geld“ meldet nur die Zuschlagsstunden, keine bezahlten Überstunden', () => {
  const settings = { wageTypes: { ueZuschlag: '350', 'ue.tag': '300', ue11: '311' } }
  const lines = exportLines({ month: '2026-11', otRows: [ot({ ueMode: 'mix', hours: { ue: { tag: 120, nacht: 60 }, ue11: { tag: 30 }, normal: {}, mehr: {} } })], settings })
  assert.deepEqual(lines.map((l) => [l.key, l.lohnart, l.menge]), [['ueZuschlag', '350', 3.5]])
})

test('Lohn-Export: Sonntag inkl. Sonntag Nacht, Feiertagsarbeit und 11./12. Stunde über alle Zeitklassen', () => {
  const r = ot({ hours: { ue: {}, ue11: { tag: 30, nacht: 30, feiertag: 60 }, normal: { sonntag: 120, sonntagnacht: 60, feiertag: 90 }, mehr: { sonntag: 30, feiertag: 30 } } })
  const totals = keyTotals({ otRows: [r, r] })
  assert.deepEqual([totals.sonntag, totals.feiertagsarbeit, totals.ue11, totals.nacht, totals.ueZuschlag], [7, 4, 4, 0, 0])
})

test('Lohn-Export: Datumsformat Monat/Jahr, Anführungszeichen im Text, ohne Satz', () => {
  const lines = [{ pnr: '1001', lohnart: '410', menge: 2, einheit: 'h', satz: 0, von: '2026-11-01', bis: '2026-11-30', text: 'Zuschlag "Nacht"; KV' }]
  const text = exportText(lines, { columns: ['pnr', 'menge', 'satz', 'betrag', 'von', 'text'], dateFormat: 'mm/yyyy' })
  assert.deepEqual(text.replace(/^﻿/, '').trim().split('\r\n'), ['Personalnummer;Menge;Satz;Betrag;Von;Text', '1001;2;;;11/2026;"Zuschlag ""Nacht""; KV"'])
  const noRate = exportLines({ month: '2026-11', otRows: [ot({ total: { normal: 600 } })], settings: { wageTypes: { normal: '100' }, rateOn: false } })
  assert.equal(noRate[0].satz, 0)
})

test('Lohn-Export: Betrag kaufmännisch auf Cent gerundet, ohne Gleitkomma-Fehler bei halben Cent', () => {
  // 0,06 h × 16,75 € = 1,005 € → 1,01 € (Gleitkomma: 1,00499… → 1,00); 2,5 h × 14,47 € = 36,175 € → 36,18 €
  const lines = [
    { pnr: '1001', lohnart: '100', menge: 0.06, einheit: 'h', satz: 16.75, von: '2026-11-01', bis: '2026-11-30', text: '' },
    { pnr: '1001', lohnart: '100', menge: 2.5, einheit: 'h', satz: 14.47, von: '2026-11-01', bis: '2026-11-30', text: '' },
    { pnr: '1001', lohnart: '100', menge: 0.01, einheit: 'h', satz: 14.5, von: '2026-11-01', bis: '2026-11-30', text: '' },
  ]
  const text = exportText(lines, { columns: ['menge', 'satz', 'betrag'], header: false })
  assert.deepEqual(text.replace(/^﻿/, '').trim().split('\r\n'), ['0,06;16,75;1,01', '2,50;14,47;36,18', '0,01;14,50;0,15'])
})

test('Lohn-Export: keine Hinweise, wenn alles zugeordnet ist; Dateiname je Monat', () => {
  const settings = { wageTypes: { normal: '100' } }
  const otRows = [ot({ total: { normal: 600 } })]
  const lines = exportLines({ month: '2026-11', otRows, settings })
  assert.deepEqual(exportProblems({ lines, totals: keyTotals({ otRows }), settings }), [])
  assert.equal(exportFileName('2026-11'), 'Lohn-Bewegungsdaten_2026-11.csv')
})
