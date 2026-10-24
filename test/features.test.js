import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { importEmployees, importTasks, parseInterval, parseWeekdays } from '../src/core/importer.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { monthReport, objectControlling, timeAccount, toCSV, vacationSummary } from '../src/core/reports.js'
import { createContext, evaluateEmployee, registerRule, RULES } from '../src/core/rules.js'
import { autoPlan } from '../src/core/scheduler.js'
import { buildTimesheet, timesheetSignature } from '../src/core/timesheet.js'
import { createDemoData } from '../src/data/demo.js'

const MONDAY = '2026-10-26'
const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1', 'o2'], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })

function setup({ employees, objects = [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }], tasks, absences = [], assignments = {}, rules = {}, travel = {}, trips = {}, from = '2026-10-01', to = '2026-11-30' }) {
  const data = { employees, objects, tasks, absences, rules, travel, trips, overrides: {} }
  const holidays = holidayCalendar(from, to)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  return { ctx, instances, state: new PlanState(instances, assignments) }
}

test('Regelkatalog: Regeln lassen sich abschalten und ergänzen', () => {
  const tasks = [task('abend', 'o1', [2], '17:30', '21:30'), task('frueh', 'o2', [3], '05:00', '07:30')]
  const asg = { '2026-10-27|abend': [{ employeeId: 'e' }], '2026-10-28|frueh': [{ employeeId: 'e' }] }
  const on = setup({ employees: [emp('e')], tasks, assignments: asg })
  assert.ok(evaluateEmployee(on.ctx.employees[0], on.state.instancesOf('e'), on.ctx).some((i) => i.code === 'REST'))
  const off = setup({ employees: [emp('e')], tasks, assignments: asg, rules: { disabledRules: ['dailyRest'] } })
  assert.ok(!evaluateEmployee(off.ctx.employees[0], off.state.instancesOf('e'), off.ctx).some((i) => i.code === 'REST'))

  const before = RULES.length
  registerRule({ id: 'test-max-einsaetze', title: 'Test', law: '', description: '', check: ({ items, add }) => items.length > 1 && add('warning', 'TEST', 'week', 'zu viele', items) })
  assert.equal(RULES.length, before + 1)
  assert.ok(evaluateEmployee(on.ctx.employees[0], on.state.instancesOf('e'), on.ctx).some((i) => i.code === 'TEST'))
  RULES.splice(RULES.findIndex((r) => r.id === 'test-max-einsaetze'), 1)
})

test('Fahrzeit-Matrix ersetzt die Pauschale', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['p'] }), task('b', 'o2', [2], '10:15', '12:00', { regulars: ['p'] })]
  const flat = setup({ employees: [emp('p')], tasks })
  const flatRes = autoPlan(flat.ctx, flat.instances, {}, { from: MONDAY, to: '2026-11-01' })
  const flatIssues = evaluateEmployee(flat.ctx.employees[0], new PlanState(flat.instances, flatRes.assignments).instancesOf('p'), flat.ctx)
  assert.ok(flatIssues.some((i) => i.code === 'TRAVEL'), '15 min Lücke < 30 min Pauschale')
  const near = setup({ employees: [emp('p')], tasks, travel: { 'o1|o2': 10 } })
  const res = autoPlan(near.ctx, near.instances, {}, { from: MONDAY, to: '2026-11-01' })
  const state = new PlanState(near.instances, res.assignments)
  assert.ok(!evaluateEmployee(near.ctx.employees[0], state.instancesOf('p'), near.ctx).some((i) => i.code === 'TRAVEL'))
  assert.equal(buildTimesheet(near.ctx, near.ctx.employees[0], MONDAY, near.instances, state).totals.travel, 10)
})

test('Schlüssel: Vertretung ohne Schlüssel wird markiert', () => {
  const objects = [{ id: 'o1', name: 'Bank', keys: [{ id: 'k', label: 'Eingang', holderId: 'stamm' }] }]
  const tasks = [task('a', 'o1', [2], '18:00', '20:00', { regulars: ['stamm'] })]
  const { ctx, state } = setup({ employees: [emp('stamm'), emp('vertretung', { trained: ['o1'] })], objects, tasks, assignments: { '2026-10-27|a': [{ employeeId: 'vertretung' }] } })
  const issues = evaluateEmployee(ctx.employees[1], state.instancesOf('vertretung'), ctx)
  assert.ok(issues.some((i) => i.code === 'KEY_HANDOVER' && i.message.includes('stamm')))
})

test('Zeitkonto summiert veröffentlichte Wochen', () => {
  const e = { id: 'e', startBalanceHours: 2 }
  const published = { '2026-10-12': { status: 'veroeffentlicht', saldi: { e: 60 } }, '2026-10-19': { status: 'veroeffentlicht', saldi: { e: -30 } }, '2026-10-26': { status: 'veroeffentlicht', saldi: { e: 90 } } }
  assert.equal(timeAccount(e, published, '2026-10-19'), 120 + 60 - 30)
  assert.equal(timeAccount(e, published, '2026-10-26'), 120 + 60 - 30 + 90)
})

test('Urlaubsanspruch zählt Werktage ohne Feiertage', () => {
  const absences = [{ employeeId: 'e', type: 'Urlaub', from: '2026-10-24', to: '2026-11-03' }] // Sa–Di, mit 26.10. und 1.11.
  const v = vacationSummary({ id: 'e', vacationDaysYear: 25 }, absences, 2026)
  assert.equal(v.used, 6) // 27., 28., 29., 30.10., 2., 3.11.
  assert.equal(v.rest, 19)
})

test('Monatsauswertung und CSV', () => {
  const data = createDemoData(MONDAY)
  const from = '2026-09-28'
  const to = '2026-11-08'
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const res = autoPlan(ctx, instances, data.assignments, { from: MONDAY, to: '2026-11-01' })
  const state = new PlanState(instances, res.assignments)
  const rows = monthReport(ctx, '2026-10', instances, state)
  assert.equal(rows.length, 35)
  const sandra = rows.find((r) => r.employee.name === 'Sandra Pichler')
  assert.equal(sandra.vacationDays, 5)
  assert.ok(sandra.vacationCredit > 0)
  assert.ok(rows.some((r) => r.holidayCredit > 0), 'Nationalfeiertag angerechnet')
  const csv = toCSV(rows)
  assert.match(csv.split('\r\n')[0], /^Personalnummer;Name;/)
  assert.equal(csv.split('\r\n').length, 36)

  const control = objectControlling(ctx, data.objects, '2026-10', instances, state, (m) => m === MONDAY)
  const praxis = control.find((r) => r.object.name === 'Arztpraxis Liefering')
  assert.ok(praxis.planned > praxis.staffed, 'nur eine Woche eingeteilt')
  assert.ok(praxis.budget > 0)
  assert.ok(praxis.open >= 0 && praxis.open < praxis.planned)
})

test('Signatur erkennt Änderungen nach dem Veröffentlichen', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['p'] })]
  const { ctx, instances } = setup({ employees: [emp('p'), emp('q')], tasks })
  const res = autoPlan(ctx, instances, {}, { from: MONDAY, to: '2026-11-01' })
  const s1 = timesheetSignature(buildTimesheet(ctx, ctx.employees[0], MONDAY, instances, new PlanState(instances, res.assignments)))
  const moved = { ...res.assignments, '2026-10-27|a': [{ employeeId: 'q', locked: true }] }
  const s2 = timesheetSignature(buildTimesheet(ctx, ctx.employees[0], MONDAY, instances, new PlanState(instances, moved)))
  assert.notEqual(s1, s2)
})

test('Import: Wochentage, Mitarbeitende und Leistungen aus Excel', () => {
  assert.deepEqual(parseWeekdays('Mo-Fr'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseWeekdays('Mo, Mi, Fr'), [1, 3, 5])
  assert.deepEqual(parseWeekdays('Sa+So'), [6, 7])
  assert.deepEqual(parseWeekdays('täglich'), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(['1', 'wöchentlich', '14-tägig', 'alle 2 Wochen', 'monatlich', '3'].map(parseInterval), [1, 1, 2, 2, 4, 3])

  const empText = 'Name\tPersonalnummer\tBeschäftigung\tWochenstunden\tTeam\tQualifikationen\tTage\tVon\tBis\nPetra Muster\t1001\tTeilzeit\t34\tFlachgau\tGlasreinigung, Hygienebereich\tMo-Fr\t8:00\t17:30\nOhne Name\t\t\t\t\t\t\t\t'
  const emps = importEmployees(empText)
  assert.equal(emps.items.length, 2)
  const petra = emps.items[0]
  assert.equal(petra.weeklyHours, 34)
  assert.deepEqual(petra.skills, ['Glasreinigung', 'Hygienebereich'])
  assert.deepEqual(petra.availability[1], { from: '08:00', to: '17:30' })
  assert.equal(petra.availability[6], undefined)

  const employees = [{ id: 'e1', name: 'Petra Muster' }]
  const taskText = 'Objekt;Adresse;Leistung;Tage;Von;Bis;Stammkraft;Intervall;An Feiertagen\nKanzlei Muster;5020 Salzburg;Büroreinigung;Mo, Mi, Fr;17:30;19:30;Petra Muster;1;verschieben\nKanzlei Muster;;Fenster;Do;9:00;12:00;Unbekannt;14-tägig;entfällt'
  const tasks = importTasks(taskText, employees)
  assert.equal(tasks.items.length, 2)
  assert.deepEqual(tasks.items[0].task.regulars, ['e1'])
  assert.equal(tasks.items[0].task.holidayRule, 'verschieben')
  assert.equal(tasks.items[0].task.recurrence.everyWeeks, 1)
  assert.equal(tasks.items[1].task.recurrence.everyWeeks, 2)
  assert.ok(tasks.errors.some((e) => e.includes('Unbekannt')))
})

test('Automatik gibt Einsätze neu abwesender Personen frei, fixierte bleiben', () => {
  const tasks = [task('a', 'o1', [3, 4], '08:00', '12:00', { regulars: ['stamm'] })]
  const base = setup({ employees: [emp('stamm'), emp('springer')], tasks })
  const first = autoPlan(base.ctx, base.instances, {}, { from: MONDAY, to: '2026-11-01' })
  assert.deepEqual(first.assignments['2026-10-29|a'], [{ employeeId: 'stamm', locked: false }])
  const locked = { ...first.assignments, '2026-10-28|a': [{ employeeId: 'stamm', locked: true }] }
  const sick = setup({ employees: [emp('stamm'), emp('springer')], tasks, absences: [{ employeeId: 'stamm', type: 'Krankenstand', from: '2026-10-28', to: '2026-10-29' }] })
  const res = autoPlan(sick.ctx, sick.instances, locked, { from: MONDAY, to: '2026-11-01' })
  assert.deepEqual(res.assignments['2026-10-29|a'], [{ employeeId: 'springer', locked: false }])
  assert.deepEqual(res.assignments['2026-10-28|a'], [{ employeeId: 'stamm', locked: true }])
  assert.equal(res.stats.released, 1)
})

test('Fahrten: Woche > Leistung > automatisch, mit Notiz', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['p'] }), task('b', 'o2', [2], '11:00', '12:00', { regulars: ['p'] }), task('c', 'o2', [2], '13:00', '14:00', { regulars: ['p'], travelAfterMin: 20, travelNote: 'zurück ins Lager' })]
  const auto = setup({ employees: [emp('p')], tasks })
  const res = autoPlan(auto.ctx, auto.instances, {}, { from: MONDAY, to: '2026-11-01' })
  const state = new PlanState(auto.instances, res.assignments)
  const ts = buildTimesheet(auto.ctx, auto.ctx.employees[0], MONDAY, auto.instances, state)
  const tue = ts.days[1].lines
  assert.deepEqual(tue.map((l) => [l.trip.minutes, l.trip.source]), [[30, 'automatisch'], [0, 'automatisch'], [20, 'leistung']])
  assert.ok(tue[2].notes.includes('Fahrt: zurück ins Lager'))
  assert.equal(ts.totals.travel, 50)

  const trips = { '2026-10-27|a|p': { min: 45, note: 'Firmenauto' } }
  const planned = setup({ employees: [emp('p')], tasks, trips })
  const ts2 = buildTimesheet(planned.ctx, planned.ctx.employees[0], MONDAY, planned.instances, new PlanState(planned.instances, res.assignments))
  assert.equal(ts2.days[1].lines[0].trip.source, 'woche')
  assert.equal(ts2.totals.travel, 65)
  assert.ok(ts2.days[1].lines[0].notes.includes('Fahrt: Firmenauto'))
  // 45 min Fahrt, aber nur 60 min Zeit → passt; 75 min → Warnung
  const tight = setup({ employees: [emp('p')], tasks, trips: { '2026-10-27|a|p': { min: 75 } } })
  const issues = evaluateEmployee(tight.ctx.employees[0], new PlanState(tight.instances, res.assignments).instancesOf('p'), tight.ctx)
  assert.ok(issues.some((i) => i.code === 'TRAVEL' && i.message.includes('75 min')))
})

test('Fahrten werden in der Wochendatei gespeichert', async () => {
  const { splitData, weekPath } = await import('../src/storage/data-service.js')
  const docs = splitData({ employees: [], assignments: {}, overrides: {}, trips: { '2026-10-27|t1|e1': { min: 20, note: 'Bus' } } }, new Set(['2026-10-26', '2026-11-02']))
  assert.deepEqual(docs[weekPath('2026-10-26')].trips, { '2026-10-27|t1|e1': { min: 20, note: 'Bus' } })
  assert.equal(docs[weekPath('2026-11-02')].trips, undefined)
})

test('Import: Fahrzeit in Stunden oder Minuten', async () => {
  const { travelMinutes } = await import('../src/core/importer.js')
  assert.deepEqual(['0,5', '30', '30 min', '1,5 h', '', 'x'].map(travelMinutes), [30, 30, 30, 90, null, null])
})
