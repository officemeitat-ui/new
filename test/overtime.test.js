import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { classifyWeek, mehrLedger, payMonth } from '../src/core/overtime.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { timeAccount } from '../src/core/reports.js'
import { createContext, mergeRules } from '../src/core/rules.js'
import { candidateFactors } from '../src/core/scheduler.js'
import { buildTimesheet } from '../src/core/timesheet.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, weeklyHours, extra = {}) => ({ id, name: id, type: weeklyHours >= 40 ? 'Vollzeit' : 'Teilzeit', weeklyHours, skills: [], trained: [], availability: allDays, ...extra })
const task = (id, weekdays, start, end, regulars, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars, skills: [], holidayRule: 'entfaellt', ...extra })

/** Woche einer Person einordnen; Stammkräfte sind eingeteilt, außer sie sind abwesend. */
function week(monday, employees, tasks, { absences = [], who = employees[0].id } = {}) {
  const data = { employees, objects: [{ id: 'o1', name: 'Büro' }], tasks, absences, rules: { breakAfterH: 24 }, travel: {}, trips: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-01', '2026-12-31')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-26', '2026-12-20', holidays, ctx.rules)
  const assignments = {}
  const absent = (id, date) => absences.some((a) => a.employeeId === id && date >= a.from && date <= a.to)
  for (const i of instances) if (i.status !== 'cancelled') assignments[i.key] = i.regulars.filter((id) => !absent(id, i.date)).map((employeeId) => ({ employeeId }))
  const state = new PlanState(instances, assignments)
  const ts = buildTimesheet(ctx, ctx.employeesById.get(who), monday, instances, state)
  return { ctx, ts, w: classifyWeek(ctx, ts), state, instances }
}
const h = (n) => n * 60

test('Überstunden: Teilzeit bis 40 h Mehrarbeit, darüber Überstunden', () => {
  // 5 × 7,6 h = 38 h bei 30 h Vertrag
  const { w } = week('2026-11-02', [emp('e1', 30)], [task('t', [1, 2, 3, 4, 5], '06:00', '13:36', ['e1'])])
  assert.deepEqual([w.normal, w.mehr, w.ue, w.minus], [h(30), h(8), 0, 0])
  // + Samstag 5 h = 43 h: 10 h Mehrarbeit, 3 h Überstunden
  const more = week('2026-11-02', [emp('e1', 30)], [task('t', [1, 2, 3, 4, 5], '06:00', '13:36', ['e1']), task('sa', [6], '07:00', '12:00', ['e1'])]).w
  assert.deepEqual([more.normal, more.mehr, more.ue], [h(30), h(10), h(3)])
})

test('Überstunden: über 9 h am Tag, ab der 11. Stunde eigener Satz', () => {
  const tasks = [task('mo', [1], '06:00', '17:00', ['e2']), task('di', [2, 3, 4], '06:00', '15:00', ['e2']), task('fr', [5], '06:00', '08:00', ['e2'])]
  const { w } = week('2026-11-02', [emp('e2', 40)], tasks)
  // Montag 11 h: 9 h normal, 10. Stunde Überstunde, 11. Stunde eigener Satz
  assert.deepEqual([w.ue, w.ue11, w.normal, w.minus, w.longest], [h(1), h(1), h(38), h(2), h(11)])
})

test('Überstunden: angerechneter Feiertag füllt die Woche, Rest über 40 h sind Überstunden', () => {
  // 8.12.2026 (Di) Mariä Empfängnis: 9 h angerechnet, an 4 Tagen 9 h gearbeitet
  const { w } = week('2026-12-07', [emp('e2', 40, {})], [task('t', [1, 2, 3, 4, 5], '06:00', '15:00', ['e2'])], {})
  assert.equal(w.credited, h(9))
  assert.equal(w.worked, h(36))
  assert.deepEqual([w.normal, w.ue], [h(31), h(5)])
})

test('Überstunden: Zeitklassen Nacht (21–6 Uhr), Sonntag, Feiertag', () => {
  const tasks = [task('sa', [6], '20:00', '23:00', ['e1']), task('so', [7], '08:00', '10:00', ['e1'])]
  const { w } = week('2026-11-02', [emp('e1', 30)], tasks)
  const by = (cls) => w.parts.filter((p) => p.cls === cls).reduce((s, p) => s + p.min, 0)
  assert.deepEqual([by('tag'), by('nacht'), by('sonntag')], [h(1), h(2), h(2)])
  const hol = week('2026-12-07', [emp('e1', 30)], [task('t', [2], '08:00', '10:00', ['e1'], { holidayRule: 'findet_statt' })]).w
  assert.equal(hol.parts.find((p) => p.date === '2026-12-08').cls, 'feiertag')
})

test('Überstunden: Zeitausgleich wird nicht angerechnet (kommt aus dem Zeitkonto)', () => {
  const absences = [{ id: 'a', employeeId: 'e1', type: 'Zeitausgleich', from: '2026-11-02', to: '2026-11-02' }]
  const { ts, w } = week('2026-11-02', [emp('e1', 30)], [task('t', [1, 2, 3, 4, 5], '08:00', '14:00', ['e1'])], { absences })
  const line = ts.days[0].lines[0]
  assert.equal(line.credited, 0)
  assert.ok(line.notes.includes('Zeitausgleich (aus dem Zeitkonto)'))
  assert.equal(ts.totals.saldo, h(-6))
  assert.equal(w.minus, h(6))
})

const ctx = { rules: mergeRules({}) }
const mk = (monday, sunday, parts = [], minus = 0) => ({ monday, sunday, parts, minus, contract: h(30), credited: 0, worked: 0, normal: 0, mehr: parts.filter((p) => p.type === 'mehr').reduce((s, p) => s + p.min, 0), ue: 0, ue11: 0, longest: 0 })

test('Mehrarbeit: binnen 3 Monaten 1:1 ausgeglichen = zuschlagsfrei, sonst fällig mit 25 %', () => {
  const weeks = [mk('2026-08-03', '2026-08-09', [{ date: '2026-08-05', type: 'mehr', cls: 'tag', min: 300 }]), mk('2026-08-17', '2026-08-23', [], 180), mk('2026-11-09', '2026-11-15', [], 600)]
  const person = { id: 'e1', wageGroup: 6 }
  const aug = payMonth(ctx, person, '2026-08', weeks)
  assert.deepEqual([aug.mehr.added, aug.mehr.balanced, aug.mehr.openMin, aug.mehr.paid, aug.amount], [300, 180, 120, 0, 0])
  assert.equal(aug.mehr.open[0].deadline, '2026-11-05')
  // November: Frist am 5.11. abgelaufen, die Minusstunden vom 15.11. kommen zu spät
  const nov = payMonth(ctx, person, '2026-11', weeks)
  assert.deepEqual([nov.mehr.dueMin, nov.mehr.paid, nov.mehr.balanced], [120, 120, 0])
  assert.equal(nov.amount, 30.93) // 2 h × 12,37 € × 125 %
  assert.equal(nov.accountDelta, -120)
  // nach dem Abschluss im November ist nichts mehr offen
  const closures = { '2026-11': { closedAt: '2026-12-01', rows: { e1: { mehrPaid: 120 } } } }
  assert.equal(mehrLedger(weeks, { closures, empId: 'e1', until: '2026-12-31' }).open.length, 0)
  // sofort auszahlen: Zuschlag auch ohne Fristablauf
  const now = payMonth(ctx, person, '2026-08', weeks.slice(0, 1), { modes: { mehr: 'auszahlen' } })
  assert.deepEqual([now.mehr.paid, now.amount], [300, 77.31])
  // Abschluss nimmt genau die ausbezahlten Tage heraus, ältere offene Mehrarbeit behält ihre Frist
  const two = [mk('2026-07-06', '2026-07-12', [{ date: '2026-07-08', type: 'mehr', cls: 'tag', min: 60 }]), mk('2026-08-03', '2026-08-09', [{ date: '2026-08-05', type: 'mehr', cls: 'tag', min: 300 }])]
  const augPaid = payMonth(ctx, person, '2026-08', two, { modes: { mehr: 'auszahlen' } })
  assert.deepEqual(augPaid.mehr.paidEntries, [{ date: '2026-08-05', min: 300 }])
  const closed = { '2026-08': { closedAt: '2026-09-01', rows: { e1: { mehrPaid: 300, mehrPaidEntries: augPaid.mehr.paidEntries } } } }
  assert.deepEqual(mehrLedger(two, { closures: closed, empId: 'e1', until: '2026-09-30' }).open, [{ date: '2026-07-08', min: 60, deadline: '2026-10-08' }])
})

test('Überstunden: auszahlen, Zeitausgleich 1:1,5 oder 1:1 mit Zuschlag in Geld', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-04', type: 'ue', cls: 'tag', min: 120 }])]
  const person = { id: 'e1', hourlyWage: 12 }
  const pay = payMonth(ctx, person, '2026-11', weeks)
  assert.deepEqual([pay.amount, pay.accountDelta, pay.zaBonus], [36, -120, 0])
  const za = payMonth(ctx, person, '2026-11', weeks, { modes: { ue: 'za' } })
  assert.deepEqual([za.amount, za.accountDelta, za.zaBonus], [0, 60, 60])
  const mix = payMonth(ctx, person, '2026-11', weeks, { modes: { ue: 'mix' } })
  assert.deepEqual([mix.amount, mix.accountDelta], [12, 0])
})

test('Überstunden: Sonntag 150 %, davon 100 % schon als Zeit gutgeschrieben', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-08', type: 'ue', cls: 'sonntag', min: 60 }, { date: '2026-11-03', type: 'normal', cls: 'nacht', min: 120 }])]
  const person = { id: 'e1', hourlyWage: 12 }
  const zeit = payMonth(ctx, person, '2026-11', weeks)
  const line = zeit.lines.find((l) => l.key === 'ue-sonntag')
  assert.deepEqual([line.pct, line.amount], [50, 18])
  assert.equal(zeit.lines.find((l) => l.key === 'zuschlag-nacht').amount, 12) // 2 h × 12 € × 50 %
  const geld = payMonth({ rules: mergeRules({ pay: { bonusAs: 'geld' } }) }, person, '2026-11', weeks)
  assert.equal(geld.lines.find((l) => l.key === 'ue-sonntag').amount, 30)
})

test('Überstunden: steuerfreie Zuschläge 2026 (15 Überstunden, höchstens 170 €)', () => {
  const weeks = [mk('2026-11-02', '2026-11-08', [{ date: '2026-11-04', type: 'ue', cls: 'tag', min: h(20) }])]
  assert.equal(payMonth(ctx, { id: 'a', hourlyWage: 12 }, '2026-11', weeks).taxFree, 90)
  assert.equal(payMonth(ctx, { id: 'b', hourlyWage: 30 }, '2026-11', weeks).taxFree, 170)
  assert.equal(payMonth(ctx, { id: 'c', hourlyWage: 30 }, '2026-11', weeks, { modes: { ue: 'za' } }).taxFree, 0)
})

test('Überstunden: Monatsabschluss bucht ins Zeitkonto ab Monatsende', () => {
  const person = { id: 'e1', startBalanceHours: 5 }
  const payroll = { '2026-10': { closedAt: '2026-11-02T08:00:00Z', rows: { e1: { accountDelta: -120 } } }, '2026-11': { modes: {} } }
  assert.equal(timeAccount(person, {}, '2026-10-19', payroll), 300)
  assert.equal(timeAccount(person, {}, '2026-10-26', payroll), 180)
})

test('Überstunden: Automatik meidet Einsätze, die Überstunden auslösen', () => {
  const tasks = [task('t', [1, 2, 3, 4], '06:00', '15:00', ['e2']), task('fr', [5], '06:00', '11:00', [])]
  const { ctx: c, state, instances } = week('2026-11-02', [emp('e2', 40)], tasks)
  const fri = instances.find((i) => i.key === '2026-11-06|fr')
  const factors = candidateFactors(c, state, c.employeesById.get('e2'), fri, null)
  assert.ok(factors.some((f) => f.code === 'overtime' && f.text.includes('40 h/Woche')))
})
