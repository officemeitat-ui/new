import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { importTasks } from '../src/core/importer.js'
import { classifyWeek, payMonth } from '../src/core/overtime.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, validatePlan } from '../src/core/rules.js'
import { buildTimesheet } from '../src/core/timesheet.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const ana = { id: 'e1', name: 'Ana', type: 'Vollzeit', weeklyHours: 40, skills: [], trained: [], availability: allDays, hourlyWage: 12 }
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: ['e1'], skills: [], ...extra })

// 8.12.2026 (Di) Mariä Empfängnis, 24.12.2026 (Do) als betriebsfreier Tag eingetragen
function setup({ tasks, overrides = {}, rules = {} }) {
  const data = { employees: [ana], objects: [{ id: 'o1', name: 'Büro' }], tasks, absences: [], rules, travel: {}, trips: {}, overrides, extraFreeDays: [{ date: '2026-12-24', name: 'Betriebsausflug' }] }
  const holidays = holidayCalendar('2026-11-23', '2027-01-10', data.extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-30', '2027-01-03', holidays, ctx.rules)
  const assignments = {}
  for (const i of instances) if (i.status !== 'cancelled') assignments[i.key] = [{ employeeId: 'e1' }]
  const state = new PlanState(instances, assignments)
  return { ctx, instances, state, byKey: new Map(instances.map((i) => [i.key, i])) }
}

test('Feiertag: Dienst findet standardmäßig statt, mit 100 % Feiertagszuschlag', () => {
  const { ctx, instances, state, byKey } = setup({ tasks: [task('buero', [1, 2, 3, 4, 5], '08:00', '10:00')] })
  const inst = byKey.get('2026-12-08|buero')
  assert.equal(inst.status, 'normal')
  assert.equal(inst.holiday.name, 'Mariä Empfängnis')
  const ts = buildTimesheet(ctx, ana, '2026-12-07', instances, state)
  const line = ts.days[1].lines[0]
  assert.deepEqual([line.hours, line.bonus, line.credited], [120, 120, 240])
  assert.ok(line.notes.includes('inkl. 100 % Feiertagszuschlag'))
  const issues = validatePlan(ctx, state, instances, { from: '2026-12-07', to: '2026-12-13' }).issues
  assert.ok(issues.some((i) => i.code === 'HOLIDAY' && i.message.includes('Feiertagsentgelt + 100 % Zuschlag')))
})

test('Feiertag: „entfällt“ nur, wenn bei der Leistung so eingestellt (Feiertag wird angerechnet)', () => {
  const { ctx, instances, state, byKey } = setup({ tasks: [task('geschlossen', [2], '08:00', '10:00', { holidayRule: 'entfaellt' })] })
  assert.equal(byKey.get('2026-12-08|geschlossen').status, 'cancelled')
  const line = buildTimesheet(ctx, ana, '2026-12-07', instances, state).days[1].lines[0]
  assert.deepEqual([line.kind, line.credited, line.creditReason], ['missed', 120, 'feiertag'])
})

test('Feiertag: betriebsfreier Tag schließt den Betrieb, einzelne Einsätze können trotzdem stattfinden', () => {
  const tasks = [task('buero', [1, 2, 3, 4, 5], '08:00', '10:00')]
  const closed = setup({ tasks })
  assert.equal(closed.byKey.get('2026-12-24|buero').status, 'cancelled')
  const work = setup({ tasks, overrides: { '2026-12-24|buero': { work: true } } })
  const inst = work.byKey.get('2026-12-24|buero')
  assert.equal(inst.status, 'normal')
  const line = buildTimesheet(work.ctx, ana, '2026-12-21', work.instances, work.state).days[3].lines[0]
  assert.equal(line.bonus, 0, 'betriebsfrei ist kein gesetzlicher Feiertag: kein Zuschlag')
})

test('Feiertag: Zuschlag in Geld in der Monatsabrechnung, wenn so eingestellt', () => {
  const { ctx, instances, state } = setup({ tasks: [task('buero', [1, 2, 3, 4, 5], '08:00', '10:00')], rules: { pay: { bonusAs: 'geld' } } })
  const weeks = ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'].map((m) => classifyWeek(ctx, buildTimesheet(ctx, ana, m, instances, state)))
  const res = payMonth(ctx, ana, '2026-12', weeks)
  const line = res.lines.find((l) => l.key === 'zuschlag-feiertag')
  // 8.12. (2 h) und 25./26.12. fallen auf Fr/Sa: 25.12. Fr 2 h → 4 h Feiertagsarbeit
  assert.equal(line.min, 240)
  assert.equal(line.amount, 48)
  assert.match(line.label, /Feiertagsarbeitsentgelt 100 %/)
})

test('Feiertag: Import ohne Angabe „An Feiertagen“ heißt findet statt', () => {
  const text = 'Objekt\tLeistung\tTage\tVon\tBis\tAn Feiertagen\nBüro\tReinigung\tMo-Fr\t08:00\t10:00\t\nPraxis\tOrdination\tMo-Fr\t18:00\t20:00\tentfällt\nHeim\tWohnbereiche\tMo-So\t07:00\t09:00\tja'
  const { items } = importTasks(text, [], { anchor: '2026-11-02' })
  assert.deepEqual(items.map((x) => x.task.holidayRule), ['findet_statt', 'entfaellt', 'findet_statt'])
})
