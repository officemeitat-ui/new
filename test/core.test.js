import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, dayIndex, dstMinutes, isoWeek, isoWeekday, mondayOf } from '../src/core/dates.js'
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

test('Zeitumstellung: Nachtdienst und Ruhezeit mit echter Dauer', () => {
  const at = (date, h) => dayIndex(date) * 1440 + h * 60
  assert.equal(dstMinutes(at('2026-10-24', 21), at('2026-10-25', 9)), 60, 'Oktober: Stunde doppelt')
  assert.equal(dstMinutes(at('2027-03-27', 21), at('2027-03-28', 8)), -60, 'März: Stunde fehlt')
  assert.equal(dstMinutes(at('2026-10-25', 4), at('2026-10-25', 9)), 0, 'nach der Umstellung')
  // Sa 21:00 – So 09:00 in der Oktobernacht: 13 h, also über 12 h am Tag
  const s = setup({ employees: [emp('a')], tasks: [task('n', 'o1', [6], '21:00', '09:00')], assignments: { '2026-10-24|n': [{ employeeId: 'a' }] } })
  const night = s.instances.find((i) => i.key === '2026-10-24|n')
  assert.equal(night.duration, 780)
  assert.ok(evaluateEmployee(s.ctx.employees[0], [night], s.ctx).some((x) => x.code === 'DAILY_MAX'))
  // März: Ende Sa 21:00, Beginn So 08:00 = nur 10 h Ruhe
  const m = setup({ employees: [emp('a')], tasks: [task('sa', 'o1', [6], '17:00', '21:00'), task('so', 'o1', [7], '08:00', '10:00')], assignments: { '2027-03-27|sa': [{ employeeId: 'a' }], '2027-03-28|so': [{ employeeId: 'a' }] }, from: '2027-03-22', to: '2027-03-28' })
  assert.ok(evaluateEmployee(m.ctx.employees[0], m.state.instancesOf('a'), m.ctx).some((x) => x.code === 'REST'))
})

test('Fahrzeit über Mitternacht: Objektwechsel in der Nachtschicht zählt', () => {
  const s = setup({ employees: [emp('x')], tasks: [task('a', 'o1', [2], '20:00', '23:50'), task('b', 'o2', [3], '00:00', '02:00')], assignments: { '2026-11-03|a': [{ employeeId: 'x' }], '2026-11-04|b': [{ employeeId: 'x' }] }, rules: { travelDefaultMin: 30 }, from: '2026-11-02', to: '2026-11-08' })
  const codes = evaluateEmployee(s.ctx.employees[0], s.state.instancesOf('x'), s.ctx).map((i) => i.code)
  const ts = buildTimesheet(s.ctx, s.ctx.employees[0], '2026-11-02', s.instances, s.state)
  assert.ok(codes.includes('TRAVEL'), codes.join(','))
  assert.equal(ts.totals.travel, s.ctx.tripAfter('x', s.instances.find((i) => i.key === '2026-11-03|a'), s.instances.find((i) => i.key === '2026-11-04|b')).minutes)
  assert.ok(ts.totals.travel > 0)
})

test('Teilzeit: verschobener Feiertagseinsatz ergibt Mehrstunden-Warnung wie im Wochenzettel', () => {
  const tasks = [task('di', 'o1', [2], '08:00', '12:00', { regulars: ['t'], holidayRule: 'verschieben' }), task('rest', 'o2', [1, 4, 5], '08:00', '13:20', { regulars: ['t'] })]
  const base = setup({ employees: [emp('t', { type: 'Teilzeit', weeklyHours: 20 })], tasks, from: '2026-11-30', to: '2026-12-20' })
  const asg = Object.fromEntries(base.instances.filter((i) => i.status !== 'cancelled').map((i) => [i.key, [{ employeeId: 't' }]]))
  const s = setup({ employees: [emp('t', { type: 'Teilzeit', weeklyHours: 20 })], tasks, assignments: asg, from: '2026-11-30', to: '2026-12-20' })
  const ts = buildTimesheet(s.ctx, s.ctx.employees[0], '2026-12-07', s.instances, s.state)
  assert.equal(ts.totals.saldo, 240)
  const { issues } = validatePlan(s.ctx, s.state, s.instances, { from: '2026-12-07', to: '2026-12-13' })
  const warn = issues.find((i) => i.code === 'CONTRACT')
  assert.ok(warn, 'Mehrstunden-Warnung')
  assert.match(warn.message, /Feiertag angerechnet.*\+4 h/)
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

test('Excel-Export: ein Blatt je Person im Wochenplan-Layout', async () => {
  const { default: ExcelJS } = await import('exceljs')
  const { buildTimesheetWorkbook } = await import('../src/export/excel.js')
  const data = createDemoData(MONDAY)
  const from = '2026-10-01'
  const to = '2026-11-30'
  const holidays = holidayCalendar(from, to, data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const res = autoPlan(ctx, instances, data.assignments, { from: MONDAY, to: '2026-11-01' })
  const state = new PlanState(instances, res.assignments)
  const sheets = data.employees.slice(0, 3).map((e) => buildTimesheet(ctx, e, MONDAY, instances, state))
  const wb = buildTimesheetWorkbook(ExcelJS, sheets, { brand: 'Test' })
  const buffer = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buffer)
  assert.equal(back.worksheets.length, 3)
  const ws = back.worksheets[0]
  assert.equal(ws.getCell('A1').value, data.employees[0].name)
  assert.equal(ws.getCell('A2').value, 'Montag')
  const struck = []
  ws.eachRow((row) => {
    if (row.getCell(1).font?.strike) struck.push(row.getCell(2).value)
  })
  assert.ok(struck.length > 0, 'Feiertagseinsätze sind durchgestrichen')
  let last = null
  ws.eachRow((row) => (last = row))
  assert.equal(last.getCell(1).value, 'GESAMT')
})

test('Jugendliche: Wochenfreizeit zwei zusammenhängende Tage mit dem Sonntag (§ 19 KJBG)', () => {
  // Montag bis Samstag: nur der Sonntag frei → Verstoß; Montag bis Freitag → in Ordnung
  const sechs = [task('w', 'o1', [1, 2, 3, 4, 5, 6], '08:00', '12:00', { holidayRule: 'findet_statt' })]
  const fuenf = [task('w', 'o1', [1, 2, 3, 4, 5], '08:00', '12:00', { holidayRule: 'findet_statt' })]
  const woche = (tasks) => {
    const asg = {}
    // zwei Wochen: ob der Montag nach dem Sonntag frei ist, steht erst in der Folgewoche
    for (const i of setup({ employees: [], tasks, from: '2026-11-02', to: '2026-11-15' }).instances) asg[i.key] = [{ employeeId: 'l' }]
    const { ctx, state } = setup({ employees: [emp('l', { minor: true })], tasks, assignments: asg, from: '2026-11-02', to: '2026-11-15' })
    return evaluateEmployee(ctx.employees[0], state.instancesOf('l'), ctx).map((i) => i.code)
  }
  assert.ok(woche(sechs).includes('MINOR_WEEKLY_REST'))
  assert.ok(!woche(fuenf).includes('MINOR_WEEKLY_REST'))
  assert.ok(!woche(sechs).includes('WEEKLY_REST'), 'für Jugendliche gilt die strengere Regel statt der 36 h')
})

test('Nachtarbeit: Hinweis mit der Nachtzeit laut KV (21–6 Uhr), Nachtarbeitnehmer nach § 12a AZG', () => {
  const tasks = [task('spaet', 'o1', [2], '19:00', '22:00'), task('nacht', 'o1', [3], '22:00', '02:00')]
  const asg = { '2026-11-03|spaet': [{ employeeId: 'n' }], '2026-11-04|nacht': [{ employeeId: 'n' }] }
  const { ctx, state } = setup({ employees: [emp('n')], tasks, assignments: asg })
  const night = evaluateEmployee(ctx.employees[0], state.instancesOf('n'), ctx).filter((i) => i.code === 'NIGHT')
  assert.equal(night.length, 2)
  assert.match(night[0].message, /Nachtarbeit 1(,0)? h \(21:00–06:00 Uhr\)/)
  assert.ok(!/Nachtarbeitnehmer/.test(night[0].message))
  assert.match(night[1].message, /Nachtarbeitnehmer:in \(§ 12a AZG\)/)
})

test('Geringfügig: Grenze in Euro (2026: 551,10 €) aus Stunden × Stundenlohn', () => {
  // Lohngruppe 6: 12,37 €/h; Mo–Fr 06:00–08:15 im Oktober 2026 (22 Werktage, 26.10. Feiertag entfällt) = 21 × 2,25 h = 47,25 h → 584,48 €
  const tasks = [task('a', 'o1', [1, 2, 3, 4, 5], '06:00', '08:15')]
  const range = { from: '2026-10-01', to: '2026-10-31' }
  const asg = {}
  for (const i of setup({ employees: [], tasks, ...range }).instances) if (i.status !== 'cancelled') asg[i.key] = [{ employeeId: 'g' }]
  const run = (extra) => {
    const { ctx, state } = setup({ employees: [emp('g', { type: 'Geringfügig', weeklyHours: 11, wageGroup: 6, ...extra })], tasks, assignments: asg, ...range })
    return evaluateEmployee(ctx.employees[0], state.instancesOf('g'), ctx)
  }
  const euro = run({}).find((i) => i.code === 'MONTHLY_EURO')
  assert.ok(euro, 'über 551,10 €')
  assert.match(euro.message, /12,37 € = 584,48 €, über der Geringfügigkeitsgrenze von 551,10 €/)
  assert.ok(!run({ hourlyWage: 11 }).some((i) => i.code === 'MONTHLY_EURO'), '47,25 h × 11 € = 519,75 €')
  assert.ok(!run({ type: 'Teilzeit' }).some((i) => i.code === 'MONTHLY_EURO'), 'nur für geringfügig Beschäftigte')
})

test('Wochenarbeitszeit: Schnitt über 17 Wochen (§ 9 Abs 4 AZG) mit den veröffentlichten Wochen', () => {
  // diese Woche 5 × (11 h − 30 min Pause) = 52,5 h; davor 16 veröffentlichte Wochen mit je 49 h → Schnitt 49,2 h = Verstoß
  const tasks = [task('lang', 'o1', [1, 2, 3, 4, 5], '06:00', '17:00')]
  const asg = {}
  for (const i of setup({ employees: [], tasks, from: '2026-11-02', to: '2026-11-08' }).instances) asg[i.key] = [{ employeeId: 'v' }]
  const run = (published) => {
    const s = setup({ employees: [emp('v', { maxDailyH: 12 })], tasks, assignments: asg, from: '2026-11-02', to: '2026-11-08' })
    s.ctx.published = published
    return evaluateEmployee(s.ctx.employees[0], s.state.instancesOf('v'), s.ctx)
  }
  const history = (h) => Object.fromEntries(Array.from({ length: 16 }, (_, i) => [addDays('2026-11-02', -7 * (i + 1)), { work: { v: h * 60 } }]))
  const over = run(history(49))
  assert.ok(over.some((i) => i.code === 'WEEKLY_AVG'))
  assert.match(over.find((i) => i.code === 'WEEKLY_AVG').message, /Schnitt über 17 Wochen bis KW 45: 49,2 h, mehr als 48 h/)
  // Vorgeschichte 40 h: nur der Hinweis für diese Woche, kein Verstoß
  const ok = run(history(40))
  assert.ok(!ok.some((i) => i.code === 'WEEKLY_AVG'))
  assert.ok(ok.some((i) => i.code === 'WEEKLY_48'))
  // ohne Vorgeschichte (unbekannt): nie ein Verstoß geraten
  assert.ok(!run({}).some((i) => i.code === 'WEEKLY_AVG'))
})

test('Durchrechnung (KV): 35–45 h ohne Überstunden-Warnung, Hinweis aufs Guthaben, Zeitraum laut KV', () => {
  const codes = (end, extra) => {
    const tasks = [task('t', 'o1', [1, 2, 3, 4, 5], '06:00', end)]
    const asg = {}
    for (const i of setup({ employees: [], tasks, from: '2026-11-02', to: '2026-11-08' }).instances) asg[i.key] = [{ employeeId: 'v' }]
    const { ctx, state } = setup({ employees: [emp('v', extra)], tasks, assignments: asg, from: '2026-11-02', to: '2026-11-08' })
    return evaluateEmployee(ctx.employees[0], state.instancesOf('v'), ctx).map((i) => i.code)
  }
  const dr = { durchrechnung: { start: '2026-11-02', weeks: 26 }, wageGroup: 4 }
  assert.ok(codes('15:00', {}).includes('CONTRACT'), 'ohne Durchrechnung: 45 h = Überstunden')
  const mit = codes('15:00', dr)
  assert.ok(!mit.includes('CONTRACT') && mit.includes('DR_PLUS'))
  assert.ok(codes('12:30', dr).includes('DR_BAND'), '32,5 h liegt unter der Bandbreite')
  assert.ok(codes('15:00', { ...dr, durchrechnung: { start: '2026-11-02', weeks: 52 } }).includes('DR_PERIOD'), '52 Wochen nur für Lohngruppe 2')
  assert.ok(!codes('15:00', { ...dr, wageGroup: 2, durchrechnung: { start: '2026-11-02', weeks: 52 } }).includes('DR_PERIOD'))
})

test('Sonntagsarbeit: Warnung ohne hinterlegte Ausnahme (§ 3 ARG), mit Grundlage nur Hinweis', () => {
  const tasks = [task('so', 'o1', [7], '08:00', '10:00', { holidayRule: 'findet_statt' })]
  const asg = { '2026-11-08|so': [{ employeeId: 's' }] }
  const run = (rules = {}, objects) => {
    const { ctx, state } = setup({ employees: [emp('s')], tasks, assignments: asg, rules, ...(objects ? { objects } : {}) })
    return evaluateEmployee(ctx.employees[0], state.instancesOf('s'), ctx)
  }
  assert.ok(run().some((i) => i.code === 'SUNDAY_BASIS'))
  const global = run({ sundayBasis: 'KV § 4' })
  assert.ok(!global.some((i) => i.code === 'SUNDAY_BASIS'))
  assert.match(global.find((i) => i.code === 'SUNDAY').message, /Sonntagsarbeit \(KV § 4\)/)
  const objekt = run({}, [{ id: 'o1', name: 'Spital', sundayBasis: 'ARG-VO, Krankenanstalt' }])
  assert.match(objekt.find((i) => i.code === 'SUNDAY').message, /Krankenanstalt/)
})

test('Wochenzettel: Stammeinsätze über das Verzeichnis je Person und Tag (doppelte Stammkraft, nachträglich angehängter Einsatz)', () => {
  const tasks = [task('a', 'o1', [2, 4], '08:00', '10:00', { regulars: ['p', 'p'] }), task('b', 'o2', [3], '12:00', '13:00', { regulars: ['q'] })]
  const s = setup({ employees: [emp('p'), emp('q')], tasks, from: '2026-11-02', to: '2026-11-15' })
  const missed = (ts) => ts.days.flatMap((d) => d.lines.filter((l) => l.kind === 'missed').map((l) => `${d.date}|${l.inst.key}`))
  const p = s.ctx.employees[0]
  // je Woche nur die eigenen Stammeinsätze, jeder einmal (auch wenn die Person doppelt eingetragen ist)
  assert.deepEqual(missed(buildTimesheet(s.ctx, p, '2026-11-02', s.instances, s.state)), ['2026-11-03|2026-11-03|a', '2026-11-05|2026-11-05|a'])
  assert.deepEqual(missed(buildTimesheet(s.ctx, p, '2026-11-09', s.instances, s.state)), ['2026-11-10|2026-11-10|a', '2026-11-12|2026-11-12|a'])
  // Liste wächst nach dem ersten Wochenzettel (wie Müll oder Winterdienst): der neue Einsatz zählt mit
  const extra = { ...s.instances.find((i) => i.key === '2026-11-04|b'), key: '2026-11-06|x', date: '2026-11-06', origDate: '2026-11-06', regulars: ['p'] }
  s.instances.push(extra)
  assert.deepEqual(missed(buildTimesheet(s.ctx, p, '2026-11-02', s.instances, new PlanState(s.instances, {}))), ['2026-11-03|2026-11-03|a', '2026-11-05|2026-11-05|a', '2026-11-06|2026-11-06|x'])
})

test('viennaDate: Kalendertag in Wien statt UTC (Winter- und Sommerzeit)', async () => {
  const { viennaDate } = await import('../src/core/dates.js')
  assert.equal(viennaDate('2026-11-09T23:30:00.000Z'), '2026-11-10') // 0:30 Uhr in Wien (MEZ)
  assert.equal(viennaDate('2026-11-09T22:59:00.000Z'), '2026-11-09')
  assert.equal(viennaDate('2026-07-01T22:30:00.000Z'), '2026-07-02') // 0:30 Uhr in Wien (MESZ)
  assert.equal(viennaDate('kein Datum'), '')
})

test('Kassenbuch: Vorgabe „heute“ ist der Wiener Kalendertag (Buchung um 0:30 Uhr für den neuen Tag)', async () => {
  const { addEntry } = await import('../src/core/cashbook.js')
  const book = { entries: [], counts: [], closings: [], settings: {} }
  addEntry(book, { date: '2026-11-10', kind: 'einnahme', type: 'anfang', amount: 100, text: 'Anfangsbestand', category: 'anfang' }, { now: '2026-11-09T23:30:00.000Z' })
  assert.equal(book.entries.length, 1)
})

test('Regeln „Standardwerte“: Regelwerte zurück, Plan am Handy, Schnee-Alarm, Orte und Urlaub bleiben', async () => {
  const { DEFAULT_RULES, resetRules } = await import('../src/core/rules.js')
  const rules = {
    ...structuredClone(DEFAULT_RULES),
    maxDailyH: 9,
    disabledRules: ['x'],
    wages: { ...DEFAULT_RULES.wages, 1: 99 },
    weather: { ...DEFAULT_RULES.weather, snowCm: 9, alarm: { enabled: true, topics: { e1: 't1' } }, locations: [{ name: 'Hallein', lat: 47.68, lon: 13.1 }] },
    portal: { enabled: true, key: 'k'.repeat(64), codes: { e1: 'abc' } },
    vacation: { maxParallel: 2, blackouts: [{ id: 'b1', from: '2026-07-01', to: '2026-07-31', label: 'Schulen' }] },
  }
  const r = resetRules(rules)
  assert.equal(r.maxDailyH, DEFAULT_RULES.maxDailyH)
  assert.deepEqual(r.disabledRules, DEFAULT_RULES.disabledRules)
  assert.deepEqual(r.wages, DEFAULT_RULES.wages)
  assert.equal(r.weather.snowCm, DEFAULT_RULES.weather.snowCm)
  assert.deepEqual(r.weather.alarm, rules.weather.alarm)
  assert.deepEqual(r.weather.locations, rules.weather.locations)
  assert.deepEqual(r.portal, rules.portal, 'Schlüssel und persönliche Links bleiben')
  assert.deepEqual(r.vacation, rules.vacation)
  assert.notEqual(r.weather.alarm, rules.weather.alarm, 'Kopie, nicht dieselbe Referenz')
  assert.deepEqual(resetRules(undefined), structuredClone(DEFAULT_RULES))
})
