import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, isoWeek, isoWeekday, mondayOf } from '../src/core/dates.js'
import { austrianHolidays, easterSunday, holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, evaluateEmployee, hasWeeklyRest, validatePlan, windowMinutes } from '../src/core/rules.js'
import { autoPlan } from '../src/core/scheduler.js'
import { buildTimesheet } from '../src/core/timesheet.js'
import { createDemoData } from '../src/data/demo.js'

const MONDAY = '2026-10-26' // Nationalfeiertag, Sonntag 1.11. = Allerheiligen

const allDays = { 1: { from: '00:00', to: '24:00' }, 2: { from: '00:00', to: '24:00' }, 3: { from: '00:00', to: '24:00' }, 4: { from: '00:00', to: '24:00' }, 5: { from: '00:00', to: '24:00' }, 6: { from: '00:00', to: '24:00' }, 7: { from: '00:00', to: '24:00' } }

function setup({ employees, objects = [{ id: 'o1', name: 'Objekt A' }, { id: 'o2', name: 'Objekt B' }], tasks, absences = [], assignments = {}, rules = {}, from = '2026-10-19', to = '2026-11-08' }) {
  const data = { employees, objects, tasks, absences, rules, overrides: {} }
  const holidays = holidayCalendar(from, to)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  return { ctx, instances, state: new PlanState(instances, assignments), data }
}

const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })
const emp = (id, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1', 'o2'], availability: allDays, ...extra })

test('Ostersonntag', () => {
  assert.equal(easterSunday(2024), '2024-03-31')
  assert.equal(easterSunday(2025), '2025-04-20')
  assert.equal(easterSunday(2026), '2026-04-05')
  assert.equal(easterSunday(2027), '2027-03-28')
})

test('österreichische Feiertage 2026', () => {
  const h = Object.fromEntries(austrianHolidays(2026).map((x) => [x.name, x.date]))
  assert.equal(austrianHolidays(2026).length, 13)
  assert.equal(h.Ostermontag, '2026-04-06')
  assert.equal(h['Christi Himmelfahrt'], '2026-05-14')
  assert.equal(h.Pfingstmontag, '2026-05-25')
  assert.equal(h.Fronleichnam, '2026-06-04')
  assert.equal(h.Nationalfeiertag, '2026-10-26')
  assert.ok(!('Karfreitag' in h))
})

test('betriebsfreie Tage ergänzen den Kalender ohne Feiertagsstatus', () => {
  const cal = holidayCalendar('2026-12-20', '2026-12-31', [{ date: '2026-12-24', name: 'Heiliger Abend' }])
  assert.equal(cal.get('2026-12-24').legal, false)
  assert.equal(cal.get('2026-12-25').legal, true)
})

test('Datumshilfen', () => {
  assert.equal(isoWeekday('2026-11-01'), 7)
  assert.equal(mondayOf('2026-11-01'), MONDAY)
  assert.deepEqual(isoWeek(MONDAY), { year: 2026, week: 44 })
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('Feiertagsregel: entfällt, findet statt, verschieben', () => {
  const { instances } = setup({
    employees: [],
    tasks: [task('a', 'o1', [1], '08:00', '10:00'), task('b', 'o1', [1], '18:00', '19:30', { holidayRule: 'findet_statt' }), task('c', 'o1', [1], '17:30', '19:30', { holidayRule: 'verschieben' })],
  })
  const on = (id) => instances.find((i) => i.key === `${MONDAY}|${id}`)
  assert.equal(on('a').status, 'cancelled')
  assert.equal(on('b').status, 'normal')
  assert.equal(on('b').holiday.name, 'Nationalfeiertag')
  assert.equal(on('c').status, 'moved')
  assert.equal(on('c').date, '2026-10-27')
})

test('14-tägige Leistungen', () => {
  const { instances } = setup({ employees: [], tasks: [task('a', 'o1', [4], '13:00', '14:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2, anchor: '2026-11-02' } })] })
  assert.deepEqual(instances.map((i) => i.date), ['2026-10-22', '2026-11-05'])
})

test('Pause wird ab 6 h abgezogen', () => {
  const { instances } = setup({ employees: [], tasks: [task('a', 'o1', [2], '10:00', '16:00'), task('b', 'o1', [3], '10:00', '16:30')] })
  assert.equal(instances.find((i) => i.taskId === 'a').net, 360)
  assert.equal(instances.find((i) => i.taskId === 'b').net, 360)
})

test('Ruhezeit unter 11 h wird markiert', () => {
  const tasks = [task('abend', 'o1', [2], '17:30', '21:30'), task('frueh', 'o2', [3], '05:00', '07:30')]
  const { ctx, state } = setup({ employees: [emp('e1')], tasks, assignments: { '2026-10-27|abend': [{ employeeId: 'e1' }], '2026-10-28|frueh': [{ employeeId: 'e1' }] } })
  const issues = evaluateEmployee(ctx.employees[0], state.instancesOf('e1'), ctx)
  const rest = issues.find((i) => i.code === 'REST')
  assert.ok(rest)
  assert.match(rest.message, /7,5 h/)
})

test('geteilter Dienst am selben Tag ist keine Ruhezeitverletzung', () => {
  const tasks = [task('frueh', 'o1', [2], '05:00', '07:30'), task('abend', 'o2', [2], '17:30', '20:00')]
  const { ctx, state } = setup({ employees: [emp('e1')], tasks, assignments: { '2026-10-27|frueh': [{ employeeId: 'e1' }], '2026-10-27|abend': [{ employeeId: 'e1' }] } })
  const codes = evaluateEmployee(ctx.employees[0], state.instancesOf('e1'), ctx).map((i) => i.code)
  assert.ok(!codes.includes('REST'))
})

test('Überschneidung, Fahrzeit und Tageshöchstgrenze', () => {
  const tasks = [task('a', 'o1', [3], '06:00', '12:00'), task('b', 'o2', [3], '11:30', '15:00'), task('c', 'o1', [3], '15:10', '20:00')]
  const asg = Object.fromEntries(['a', 'b', 'c'].map((t) => [`2026-10-28|${t}`, [{ employeeId: 'e1' }]]))
  const { ctx, state } = setup({ employees: [emp('e1')], tasks, assignments: asg })
  const codes = evaluateEmployee(ctx.employees[0], state.instancesOf('e1'), ctx).map((i) => i.code)
  assert.ok(codes.includes('OVERLAP'))
  assert.ok(codes.includes('TRAVEL'))
  assert.ok(codes.includes('DAILY_MAX'))
})

test('Wochenruhe: 36 h inkl. ganzem Kalendertag, darf in den Montag reichen', () => {
  const day = (d, s, e) => ({ start: (Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)) * 1440 + s * 60, end: (Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)) * 1440 + e * 60 })
  const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((d) => day(d, 6, 14))
  const ok = [...week, day('2026-10-31', 6, 13), day('2026-11-02', 6, 14)]
  assert.equal(hasWeeklyRest(ok, MONDAY, 36 * 60), true)
  const allWeek = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d) => day(d, 6, 14))
  assert.equal(hasWeeklyRest([...allWeek, day('2026-11-02', 6, 14)], MONDAY, 36 * 60), false)
})

test('Nachtarbeit über Mitternacht', () => {
  assert.equal(windowMinutes(22 * 60, 25 * 60, '22:00', '05:00'), 180)
  assert.equal(windowMinutes(4 * 60, 8 * 60, '22:00', '05:00'), 60)
})

test('Jugendliche: keine Abend-/Sonntagsarbeit', () => {
  const tasks = [task('abend', 'o1', [2], '18:00', '20:30'), task('sonntag', 'o1', [7], '09:00', '11:00', { holidayRule: 'findet_statt' })]
  const asg = { '2026-10-27|abend': [{ employeeId: 'l' }], '2026-11-01|sonntag': [{ employeeId: 'l' }] }
  const { ctx, state } = setup({ employees: [emp('l', { minor: true })], tasks, assignments: asg })
  const codes = evaluateEmployee(ctx.employees[0], state.instancesOf('l'), ctx).map((i) => i.code)
  assert.ok(codes.includes('MINOR_NIGHT'))
  assert.ok(codes.includes('MINOR_HOLIDAY'))
})

test('Geringfügig: Monatslimit', () => {
  const tasks = [task('a', 'o1', [1, 2, 3, 4, 5], '06:00', '09:00')]
  const asg = {}
  const range = { from: '2026-10-01', to: '2026-10-31' }
  for (const i of setup({ employees: [], tasks, ...range }).instances) if (i.status !== 'cancelled') asg[i.key] = [{ employeeId: 'g' }]
  const { ctx, state } = setup({ employees: [emp('g', { type: 'Geringfügig', weeklyHours: 9, maxMonthHours: 40 })], tasks, assignments: asg, ...range })
  const codes = evaluateEmployee(ctx.employees[0], state.instancesOf('g'), ctx).map((i) => i.code)
  assert.ok(codes.includes('MONTHLY_LIMIT'))
})

test('Automatik: Stammkraft zuerst, Vertretung bei Urlaub, keine Verstöße', () => {
  const tasks = [task('a', 'o1', [2, 3], '08:00', '12:00', { regulars: ['stamm'] })]
  const { ctx, instances, data } = setup({
    employees: [emp('stamm'), emp('springer', { weeklyHours: 20 })],
    tasks,
    absences: [{ employeeId: 'stamm', type: 'Urlaub', from: '2026-10-28', to: '2026-10-28' }],
  })
  const res = autoPlan(ctx, instances, data.assignments || {}, { from: MONDAY, to: '2026-11-01' })
  assert.deepEqual(res.assignments['2026-10-27|a'], [{ employeeId: 'stamm', locked: false }])
  assert.deepEqual(res.assignments['2026-10-28|a'], [{ employeeId: 'springer', locked: false }])
  assert.deepEqual(res.open, [])
})

test('Automatik: Ruhezeit wird eingehalten, fixierte Zuteilungen bleiben', () => {
  const tasks = [task('abend', 'o1', [2], '17:30', '21:30'), task('frueh', 'o2', [3], '05:00', '07:30')]
  const { ctx, instances } = setup({ employees: [emp('a'), emp('b')], tasks })
  const res = autoPlan(ctx, instances, { '2026-10-27|abend': [{ employeeId: 'a', locked: true }] }, { from: MONDAY, to: '2026-11-01', replan: true })
  assert.deepEqual(res.assignments['2026-10-27|abend'], [{ employeeId: 'a', locked: true }])
  assert.deepEqual(res.assignments['2026-10-28|frueh'], [{ employeeId: 'b', locked: false }])
})

test('Automatik: Einsatz bleibt offen, wenn niemand passt', () => {
  const tasks = [task('glas', 'o1', [4], '09:00', '12:00', { skills: ['Glasreinigung'] })]
  const { ctx, instances } = setup({ employees: [emp('a')], tasks })
  const res = autoPlan(ctx, instances, {}, { from: MONDAY, to: '2026-11-01' })
  assert.deepEqual(res.open, ['2026-10-29|glas'])
})

test('Wochenzettel: Feiertag angerechnet, Zuschlag, Fahrzeit, Saldo', () => {
  const tasks = [
    task('mo', 'o1', [1], '08:30', '12:30', { regulars: ['p'] }),
    task('di1', 'o1', [2], '14:00', '16:30', { regulars: ['p'] }),
    task('di2', 'o2', [2], '17:00', '21:00', { regulars: ['p'] }),
    task('so', 'o2', [7], '18:00', '19:30', { regulars: ['p'], holidayRule: 'findet_statt' }),
  ]
  const { ctx, instances, data } = setup({ employees: [emp('p', { weeklyHours: 20 })], tasks })
  const res = autoPlan(ctx, instances, {}, { from: MONDAY, to: '2026-11-01' })
  const ts = buildTimesheet(ctx, data.employees[0], MONDAY, instances, new PlanState(instances, res.assignments))
  const t = ts.totals
  assert.equal(ts.days[0].lines[0].style, 'struck')
  assert.equal(ts.days[0].credited, 240) // 4 h Feiertag angerechnet
  assert.equal(ts.days[6].credited, 180) // 1,5 h Allerheiligen + 100 %
  assert.equal(t.travel, 30)
  assert.equal(t.credited, 240 + 150 + 240 + 180)
  assert.equal(t.saldo, t.credited + t.travel - 20 * 60)
})

test('Beispieldaten: Automatik erzeugt keine neuen Verstöße', () => {
  const data = createDemoData(MONDAY)
  const from = '2026-10-01'
  const to = '2026-11-30'
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const res = autoPlan(ctx, instances, data.assignments, { from: MONDAY, to: '2026-11-01' })
  const v = validatePlan(ctx, new PlanState(instances, res.assignments), instances, { from: MONDAY, to: '2026-11-01' })
  const errors = v.issues.filter((i) => i.severity === 'error' && i.code !== 'OPEN')
  // einzig der absichtlich händisch fixierte Ruhezeitverstoß
  assert.deepEqual(errors.map((e) => e.code), ['REST'])
})
