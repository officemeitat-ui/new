import { test } from 'node:test'
import assert from 'node:assert/strict'

import { absenceImpact, correctionsInMonth, handOver, isPeriodic, periodicDue, rankHandover, rhythmCategory, saldoCorrections, staffingStatus } from '../src/core/attention.js'
import { addDays } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, evaluateEmployee } from '../src/core/rules.js'
import { autoPlan, candidateCost, candidateFactors, evaluateCandidate, explain, rankCandidates } from '../src/core/scheduler.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1', 'o2'], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })
const OBJECTS = [{ id: 'o1', name: 'Kanzlei Lehen' }, { id: 'o2', name: 'Halle Wals' }]

function setup({ employees, tasks, objects = OBJECTS, absences = [], rules = {}, assignments = {}, from = '2026-11-02', to = '2026-11-08', published = {}, payroll = {}, overrides = {} }) {
  const data = { employees, objects, tasks, absences, rules, overrides, published, payroll }
  const holidays = holidayCalendar(addDays(from, -7), addDays(to, 7))
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  return { ctx, instances, state: new PlanState(instances, assignments), byKey: new Map(instances.map((i) => [i.key, i])) }
}
const pts = (factors) => Object.fromEntries(factors.map((f) => [f.code, f.points]))
const WEEK = { from: '2026-11-02', to: '2026-11-08' }

// ---------------------------------------------------------------- Kandidaten

test('Automatik: Einsatz außerhalb der Verfügbarkeit nur für die Stammkraft zulässig', () => {
  const s = setup({ employees: [emp('x', { availability: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { from: '06:00', to: '12:00' }])) })], tasks: [task('t', 'o1', [2], '13:00', '15:00')] })
  const inst = s.byKey.get('2026-11-03|t')
  const ev = evaluateCandidate(s.ctx, s.state, s.ctx.employees[0], inst)
  assert.equal(ev.allowed, false)
  assert.deepEqual(ev.blocking.map((i) => i.code), ['AVAILABILITY'])
  const regular = evaluateCandidate(s.ctx, s.state, s.ctx.employees[0], inst, { asRegular: true })
  assert.equal(regular.allowed, true)
  assert.ok(regular.issues.some((i) => i.code === 'AVAILABILITY'), 'Warnung bleibt sichtbar')
})

test('Automatik: Mehrstunden für Vertretungen bis zur eingestellten Grenze (Standard 6 h pro Woche)', () => {
  const tasks = [task('w', 'o1', [1, 2, 3, 4, 5], '08:00', '12:00'), task('sa4', 'o1', [6], '08:00', '12:00'), task('sa7', 'o2', [6], '06:00', '13:30')]
  const assignments = Object.fromEntries(['02', '03', '04', '05', '06'].map((d) => [`2026-11-${d}|w`, [{ employeeId: 't' }]]))
  const run = (rules) => {
    const s = setup({ employees: [emp('t', { type: 'Teilzeit', weeklyHours: 20 })], tasks, assignments, rules })
    return (key) => evaluateCandidate(s.ctx, s.state, s.ctx.employees[0], s.byKey.get(key))
  }
  const std = run({})
  const vier = std('2026-11-07|sa4')
  assert.equal(vier.allowed, true)
  assert.equal(vier.issues.find((i) => i.code === 'CONTRACT').overMinutes, 240)
  const sieben = std('2026-11-07|sa7')
  assert.equal(sieben.allowed, false, '7 h über Vertrag')
  assert.deepEqual(sieben.blocking.map((i) => i.code), ['CONTRACT'])
  assert.equal(run({ autoExtraHoursPerWeek: 8 })('2026-11-07|sa7').allowed, true)
})

test('Automatik: bestehende Markierungen der Person zählen nicht gegen einen neuen Einsatz', () => {
  const tasks = [task('abend', 'o1', [1], '17:00', '21:30'), task('frueh', 'o2', [2], '05:00', '07:30'), task('do', 'o1', [4], '10:00', '12:00')]
  const s = setup({ employees: [emp('x')], tasks, assignments: { '2026-11-02|abend': [{ employeeId: 'x' }], '2026-11-03|frueh': [{ employeeId: 'x' }] } })
  const x = s.ctx.employees[0]
  assert.ok(evaluateEmployee(x, s.state.instancesOf('x'), s.ctx).some((i) => i.code === 'REST'), 'Ruhezeitverstoß besteht schon')
  const ev = evaluateCandidate(s.ctx, s.state, x, s.byKey.get('2026-11-05|do'))
  assert.ok(!ev.issues.some((i) => i.code === 'REST'))
  assert.equal(ev.allowed, true)
})

test('Begründung: Stammkraft, Revier und Einschulung', () => {
  const objects = [{ id: 'o1', name: 'Kanzlei', region: 'Stadt' }, { id: 'o2', name: 'Halle', region: 'Land' }]
  const employees = [emp('anna', { team: 'Stadt', trained: ['o1'] }), emp('bert', { team: 'Land', trained: [] }), emp('cleo', { trained: ['o1'] })]
  const s = setup({ employees, objects, tasks: [task('t', 'o1', [2], '08:00', '10:00', { regulars: ['anna'] })] })
  const inst = s.byKey.get('2026-11-03|t')
  const of = (id) => {
    const e = s.ctx.employeesById.get(id)
    return candidateFactors(s.ctx, s.state, e, inst, evaluateCandidate(s.ctx, s.state, e, inst, { asRegular: id === 'anna' }))
  }
  assert.deepEqual(pts(of('anna')), { load: 5, regular: -50, region: 0 })
  assert.equal(of('anna').find((f) => f.code === 'region').text, 'gleiches Revier')
  assert.ok(of('anna').find((f) => f.code === 'region').good)
  assert.equal(of('anna').find((f) => f.code === 'load').text, 'noch 40 h frei laut Vertrag')
  assert.deepEqual(pts(of('bert')), { load: 5, region: 40, trained: 30 })
  assert.deepEqual(of('bert').filter((f) => !f.good).map((f) => f.text), ['anderes Revier (Land)', 'nicht eingeschult'])
  assert.deepEqual(pts(of('cleo')), { load: 5, trained: -5 })
  const anna = s.ctx.employeesById.get('anna')
  assert.equal(candidateCost(s.ctx, s.state, anna, inst, evaluateCandidate(s.ctx, s.state, anna, inst, { asRegular: true })), -45)
})

test('Begründung: kennt das Objekt, am selben Tag oder in der Woche dort, direkt davor, Sonntag', () => {
  const tasks = [task('frueh', 'o1', [2], '06:00', '07:30'), task('t', 'o1', [2], '08:00', '09:00'), task('do', 'o1', [4], '08:00', '09:00'), task('b', 'o2', [2], '08:00', '09:00'), task('so', 'o1', [7], '08:00', '09:00')]
  const assignments = Object.fromEntries(['2026-10-20', '2026-10-27', '2026-11-03'].map((d) => [`${d}|frueh`, [{ employeeId: 'x' }]]))
  const s = setup({ employees: [emp('x', { trained: [] })], tasks, assignments, from: '2026-10-19', to: '2026-11-08', rules: { sundayBasis: 'KV' } })
  const x = s.ctx.employees[0]
  const f = (key) => pts(candidateFactors(s.ctx, s.state, x, s.byKey.get(key), null))
  const sameDay = f('2026-11-03|t')
  assert.deepEqual([sameDay.known, sameDay.sameDay, sameDay.adjacent, sameDay.sameObject], [-6, -20, -8, undefined])
  const week = f('2026-11-05|do')
  assert.deepEqual([week.known, week.sameObject, week.sameDay, week.adjacent], [-6, -12, undefined, undefined])
  const other = f('2026-11-03|b')
  assert.deepEqual([other.adjacent, other.sameDay, other.known], [-8, undefined, undefined])
  assert.equal(f('2026-11-08|so').sunday, 10)
  assert.equal(candidateFactors(s.ctx, s.state, x, s.byKey.get('2026-11-05|do'), null).find((x) => x.code === 'known').text, 'kennt das Objekt (2× in den letzten Wochen)')
})

test('Begründung: Zeitkonto aus Startsaldo, veröffentlichten Wochen und Monatsabschlüssen', () => {
  const tasks = [task('t', 'o1', [2], '08:00', '10:00')]
  const balance = (extra, data = {}) => {
    const s = setup({ employees: [emp('x', extra)], tasks, ...data })
    return candidateFactors(s.ctx, s.state, s.ctx.employees[0], s.byKey.get('2026-11-03|t'), null).find((f) => f.code === 'balance') || null
  }
  assert.deepEqual([balance({ startBalanceHours: -5 }).points, balance({ startBalanceHours: -5 }).text], [-7.5, 'Zeitkonto −5 h: gleicht Minusstunden aus'])
  assert.deepEqual([balance({ startBalanceHours: 20 }).points, balance({ startBalanceHours: 20 }).text], [18, 'Zeitkonto +20 h'], 'auf ±12 begrenzt')
  assert.equal(balance({ startBalanceHours: 1.5 }), null, 'unter 2 h kein Grund')
  const published = { '2026-10-26': { status: 'veroeffentlicht', saldi: { x: -180 } }, '2026-10-19': { status: 'entwurf', saldi: { x: -6000 } }, '2026-11-09': { status: 'veroeffentlicht', saldi: { x: -6000 } } }
  const payroll = { '2026-10': { closedAt: '2026-11-01', rows: { x: { accountDelta: -240 } } }, '2026-11': { rows: { x: { accountDelta: -9999 } } } }
  const b = balance({}, { published, payroll })
  assert.deepEqual([b.points, b.text], [-10.5, 'Zeitkonto −7 h: gleicht Minusstunden aus'])
})

test('Begründung: über 9 h am Tag wären Überstunden', () => {
  const tasks = [task('lang', 'o1', [2], '06:00', '14:00'), task('dazu', 'o2', [2], '14:30', '17:00')]
  const s = setup({ employees: [emp('x')], tasks, assignments: { '2026-11-03|lang': [{ employeeId: 'x' }] } })
  const f = candidateFactors(s.ctx, s.state, s.ctx.employees[0], s.byKey.get('2026-11-03|dazu'), null).find((x) => x.code === 'overtime')
  assert.deepEqual([f.points, f.text], [15, 'über 9 h am Tag: Überstunden (+50 %)'])
})

test('Kurzbegründung: wichtigste Gründe dafür und dagegen, Auslastung zuletzt', () => {
  const factors = [
    { code: 'load', points: 20, text: 'noch 10 h frei laut Vertrag', good: true },
    { code: 'regular', points: -50, text: 'Stammkraft', good: true },
    { code: 'region', points: 40, text: 'anderes Revier (Land)', good: false },
    { code: 'trained', points: -5, text: 'im Objekt eingeschult', good: true },
    { code: 'sameDay', points: -20, text: 'an dem Tag ohnehin im Objekt', good: true },
    { code: 'sunday', points: 10, text: 'Sonn-/Feiertag', good: false },
    { code: 'overtime', points: 15, text: 'über 9 h am Tag', good: false },
  ]
  assert.deepEqual(explain(factors), { pro: ['Stammkraft', 'noch 10 h frei laut Vertrag', 'an dem Tag ohnehin im Objekt'], contra: ['anderes Revier (Land)', 'über 9 h am Tag'] })
  assert.deepEqual(explain(factors, { good: 1, bad: 3 }), { pro: ['Stammkraft'], contra: ['anderes Revier (Land)', 'über 9 h am Tag', 'Sonn-/Feiertag'] })
  const over = [{ code: 'load', points: 120, text: 'schon 2 h über Vertrag', good: false }, { code: 'sunday', points: 10, text: 'Sonn-/Feiertag', good: false }, { code: 'region', points: 0, text: 'gleiches Revier', good: true }]
  assert.deepEqual(explain(over), { pro: ['gleiches Revier'], contra: ['Sonn-/Feiertag', 'schon 2 h über Vertrag'] })
})

test('„Wer kann einspringen?“: zulässige zuerst nach Kosten, dann nach Zahl der Verstöße', () => {
  const objects = [{ id: 'o1', name: 'Kanzlei', region: 'Stadt' }, { id: 'o2', name: 'Halle', region: 'Land' }]
  const employees = [emp('dora', { team: 'Stadt' }), emp('cleo', { team: 'Stadt', availability: {} }), emp('bert', { team: 'Land' }), emp('anna', { team: 'Stadt' })]
  const absences = [{ employeeId: 'dora', type: 'Urlaub', from: '2026-11-03', to: '2026-11-03' }]
  const s = setup({ employees, objects, absences, tasks: [task('t', 'o1', [2], '08:00', '10:00', { regulars: ['anna'] })] })
  const ranked = rankCandidates(s.ctx, s.state, s.byKey.get('2026-11-03|t'))
  assert.deepEqual(ranked.map((c) => [c.emp.id, c.allowed, c.regular]), [['anna', true, true], ['bert', true, false], ['cleo', false, false], ['dora', false, false]])
  assert.deepEqual(ranked[2].blocking.map((i) => i.code), ['AVAILABILITY'])
  assert.ok(ranked[3].issues.some((i) => i.code === 'ABSENT' && i.severity === 'error'))
  assert.ok(ranked[0].cost < ranked[1].cost)
  s.state.assign('anna', '2026-11-03|t')
  assert.ok(!rankCandidates(s.ctx, s.state, s.byKey.get('2026-11-03|t')).some((c) => c.emp.id === 'anna'), 'schon eingeteilt')
})

// ---------------------------------------------------------------- Automatische Einteilung

test('Automatik: neue Abwesenheit gibt Einteilung frei, gelöschte Person ebenso, fixierte bleibt', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['x'] }), task('b', 'o1', [3], '08:00', '10:00'), task('c', 'o1', [4], '08:00', '10:00')]
  const absences = [{ employeeId: 'x', type: 'Urlaub', from: '2026-11-03', to: '2026-11-03' }, { employeeId: 'x', type: 'Krankenstand', from: '2026-11-05', to: '2026-11-05' }]
  const assignments = { '2026-11-03|a': [{ employeeId: 'x' }], '2026-11-04|b': [{ employeeId: 'geloescht' }], '2026-11-05|c': [{ employeeId: 'x', locked: true }] }
  const s = setup({ employees: [emp('x'), emp('y')], tasks, absences })
  const res = autoPlan(s.ctx, s.instances, assignments, WEEK)
  assert.deepEqual(res.assignments['2026-11-03|a'], [{ employeeId: 'y', locked: false }])
  assert.deepEqual(res.assignments['2026-11-04|b'], [{ employeeId: 'x', locked: false }])
  assert.deepEqual(res.assignments['2026-11-05|c'], [{ employeeId: 'x', locked: true }], 'fixiert bleibt, auch bei Krankenstand')
  assert.deepEqual(res.stats, { regular: 0, substitute: 1, other: 1, released: 1 })
  assert.deepEqual(res.open, [])
})

test('Automatik: nur Stammkräfte (Vorschau) und nur ausgewählte Einsätze', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['x'] }), task('b', 'o1', [3], '08:00', '10:00')]
  const s = setup({ employees: [emp('x'), emp('y')], tasks })
  const preview = autoPlan(s.ctx, s.instances, {}, { ...WEEK, regularsOnly: true })
  assert.deepEqual(preview.assignments, { '2026-11-03|a': [{ employeeId: 'x', locked: false }] })
  assert.deepEqual(preview.open, ['2026-11-04|b'])
  assert.equal(preview.stats.regular, 1)
  const only = autoPlan(s.ctx, s.instances, {}, { ...WEEK, only: new Set(['2026-11-04|b']) })
  assert.equal(only.assignments['2026-11-03|a'], undefined, 'nicht ausgewählt')
  assert.equal(only.assignments['2026-11-04|b'].length, 1)
})

test('Automatik: neu planen verwirft nicht fixierte Einteilungen zugunsten der Stammkraft', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['x'] })]
  const s = setup({ employees: [emp('x'), emp('y')], tasks })
  const keep = autoPlan(s.ctx, s.instances, { '2026-11-03|a': [{ employeeId: 'y' }] }, WEEK)
  assert.deepEqual(keep.assignments['2026-11-03|a'], [{ employeeId: 'y' }], 'ohne „neu planen“ bleibt die Einteilung')
  const replan = autoPlan(s.ctx, s.instances, { '2026-11-03|a': [{ employeeId: 'y' }] }, { ...WEEK, replan: true })
  assert.deepEqual(replan.assignments['2026-11-03|a'], [{ employeeId: 'x', locked: false }])
  assert.deepEqual([replan.stats.regular, replan.stats.released], [1, 0])
})

test('Automatik: Engpass zuerst – die einzige Person mit Qualifikation bekommt den Glas-Einsatz', () => {
  const tasks = [task('boden', 'o2', [2], '08:00', '10:00'), task('glas', 'o1', [2], '08:00', '10:00', { skills: ['Glasreinigung'] })]
  const s = setup({ employees: [emp('anna', { skills: ['Glasreinigung'] }), emp('bert')], tasks })
  const res = autoPlan(s.ctx, s.instances, {}, WEEK)
  assert.deepEqual(res.assignments['2026-11-03|glas'], [{ employeeId: 'anna', locked: false }])
  assert.deepEqual(res.assignments['2026-11-03|boden'], [{ employeeId: 'bert', locked: false }])
  assert.deepEqual(res.open, [])
})

test('Automatik: Reparatur spielt eine Person frei und besetzt ihren alten Einsatz neu', () => {
  const tasks = [task('boden', 'o2', [2], '08:00', '10:00'), task('glas', 'o1', [2], '08:00', '10:00', { skills: ['Glasreinigung'] })]
  const s = setup({ employees: [emp('anna', { skills: ['Glasreinigung'] }), emp('bert')], tasks })
  const res = autoPlan(s.ctx, s.instances, { '2026-11-03|boden': [{ employeeId: 'anna' }] }, WEEK)
  assert.deepEqual(res.assignments['2026-11-03|glas'], [{ employeeId: 'anna', locked: false }])
  assert.deepEqual(res.assignments['2026-11-03|boden'], [{ employeeId: 'bert', locked: false }])
  assert.deepEqual(res.open, [])
  // fixiert: wird nicht freigespielt, Glas bleibt offen
  const locked = autoPlan(s.ctx, s.instances, { '2026-11-03|boden': [{ employeeId: 'anna', locked: true }] }, WEEK)
  assert.deepEqual(locked.open, ['2026-11-03|glas'])
})

// ---------------------------------------------------------------- Handlungsbedarf

test('Rhythmus-Kategorien für periodische Leistungen', () => {
  const w = (everyWeeks) => ({ recurrence: { type: 'weekly', weekdays: [1], everyWeeks } })
  const m = (everyMonths) => ({ recurrence: { type: 'monthly', mode: 'day', day: 1, everyMonths } })
  assert.deepEqual([w(undefined), w(1), w(2), w(3), w(4), w(6)].map(rhythmCategory), ['wöchentlich', 'wöchentlich', '14-tägig', 'alle 3 Wochen', 'alle 4 Wochen', 'alle 6 Wochen'])
  assert.deepEqual([m(undefined), m(2), m(3), m(4), m(6), m(12)].map(rhythmCategory), ['monatlich', 'alle 2 Monate', 'quartalsweise', 'alle 4 Monate', 'halbjährlich', 'jährlich'])
  assert.equal(rhythmCategory({ recurrence: { type: 'once', date: '2026-11-05' } }), 'einmalig')
  assert.deepEqual([isPeriodic(w(1)), isPeriodic(w(2)), isPeriodic(m(1)), isPeriodic(undefined)], [false, true, true, false])
})

test('Zuteilungsstatus: entfällt, zugeteilt, Stammkraft kommt automatisch', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['x'] }), task('d', 'o1', [5], '08:00', '10:00')]
  const s = setup({ employees: [emp('x')], tasks, overrides: { '2026-11-06|d': { cancelled: true } }, assignments: { '2026-11-03|a': [{ employeeId: 'x' }] } })
  assert.deepEqual(staffingStatus(s.ctx, s.state, s.byKey.get('2026-11-06|d')), { status: 'entfaellt', reason: 'entfällt' })
  assert.deepEqual(staffingStatus(s.ctx, s.state, s.byKey.get('2026-11-03|a')), { status: 'zugeteilt', working: ['x'], missing: 0 })
  const empty = new PlanState(s.instances, {})
  const notPlanned = staffingStatus(s.ctx, empty, s.byKey.get('2026-11-03|a'), () => false)
  assert.deepEqual([notPlanned.status, notPlanned.freeRegulars, notPlanned.missing], ['stammkraft', ['x'], 1])
  assert.equal(staffingStatus(s.ctx, empty, s.byKey.get('2026-11-03|a')).reason, 'Stammkraft nicht einteilbar', 'Woche geplant, trotzdem offen')
})

test('Zuteilungsstatus „zuteilen“: Grund je nach Lage', () => {
  const tasks = [task('b', 'o1', [3], '08:00', '10:00'), task('c', 'o1', [4], '08:00', '10:00', { regulars: ['x'] }), task('e', 'o1', [1], '08:00', '10:00'), task('g', 'o1', [6], '08:00', '10:00')]
  const absences = [{ employeeId: 'x', type: 'Krankenstand', from: '2026-11-05', to: '2026-11-05' }, { employeeId: 'y', type: 'Pflegefreistellung', from: '2026-11-02', to: '2026-11-02' }]
  const s = setup({ employees: [emp('x'), emp('y')], tasks, absences, assignments: { '2026-11-02|e': [{ employeeId: 'y' }], '2026-11-07|g': [{ employeeId: 'geloescht' }] } })
  const st = (key, planned = () => true) => staffingStatus(s.ctx, s.state, s.byKey.get(key), planned)
  assert.equal(st('2026-11-04|b').reason, 'keine Stammkraft hinterlegt')
  assert.equal(st('2026-11-05|c').reason, 'Stammkraft Krankenstand')
  assert.equal(st('2026-11-05|c', () => false).status, 'zuteilen', 'auch in ungeplanter Woche, wenn die Stammkraft fehlt')
  const e = st('2026-11-02|e', () => false)
  assert.deepEqual([e.status, e.reason, e.absentAssigned], ['zuteilen', 'eingeteilte Person abwesend (Pflegefreistellung)', ['y']])
  assert.deepEqual([st('2026-11-07|g').missing, st('2026-11-07|g').working], [1, []], 'gelöschte Person zählt nicht')
})

test('Periodische Leistungen im Zeitraum: ohne wöchentliche, mit Rhythmus, nach Beginn sortiert', () => {
  const tasks = [
    task('w', 'o1', [2], '08:00', '10:00'),
    task('z', 'o1', [4], '13:00', '15:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2, anchor: '2026-11-05' } }),
    task('m', 'o2', [], '08:00', '13:00', { recurrence: { type: 'monthly', mode: 'nth', nth: 1, weekday: 6, everyMonths: 1, anchor: '2026-11-01' } }),
    task('o', 'o1', [], '09:00', '12:00', { recurrence: { type: 'once', date: '2026-11-04' } }),
    task('q', 'o2', [], '10:00', '11:00', { recurrence: { type: 'monthly', mode: 'day', day: 15, everyMonths: 3, anchor: '2026-11-01' } }),
  ]
  const s = setup({ employees: [emp('x')], tasks, from: '2026-11-02', to: '2026-11-22', assignments: { '2026-11-07|m': [{ employeeId: 'x' }] } })
  const due = periodicDue(s.ctx, s.instances, s.state, tasks, { from: '2026-11-02', to: '2026-11-15', isPlanned: () => true })
  assert.deepEqual(due.map((d) => [d.inst.key, d.rhythm, d.status]), [
    ['2026-11-04|o', 'einmalig', 'zuteilen'],
    ['2026-11-05|z', '14-tägig', 'zuteilen'],
    ['2026-11-07|m', 'monatlich', 'zugeteilt'],
    ['2026-11-15|q', 'quartalsweise', 'zuteilen'],
  ])
  assert.equal(due[0].task.id, 'o')
})

test('Auswirkung einer Abwesenheit: betroffene Einsätze, offene und gedeckte Stunden', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { regulars: ['x'] }), task('b', 'o1', [3], '08:00', '11:00'), task('c', 'o1', [4], '08:00', '12:00', { regulars: ['x'] }), task('fremd', 'o1', [3], '12:00', '13:00', { regulars: ['y'] })]
  const s = setup({ employees: [emp('x'), emp('y')], tasks, overrides: { '2026-11-05|c': { cancelled: true } }, assignments: { '2026-11-03|a': [{ employeeId: 'y' }], '2026-11-04|b': [{ employeeId: 'x', locked: true }] } })
  const absence = { employeeId: 'x', type: 'Urlaub', from: '2026-11-03', to: '2026-11-05' }
  const imp = absenceImpact(s.ctx, s.instances, s.state, absence)
  assert.deepEqual(imp.rows.map((r) => [r.inst.key, r.regular, r.stillAssigned, r.locked, r.covering, r.open, r.cancelled]), [
    ['2026-11-03|a', true, false, false, ['y'], 0, false],
    ['2026-11-04|b', false, true, true, [], 1, false],
    ['2026-11-05|c', true, false, false, [], 0, true],
  ])
  assert.deepEqual([imp.minutes, imp.openMinutes, imp.coveredMinutes], [300, 180, 120])
  assert.deepEqual(imp.stillAssigned.map((r) => r.inst.key), ['2026-11-04|b'])
})

test('Sammelübergabe: was ohne Verstoß geht, wird übergeben (Mehrstunden erlaubt), der Rest mit Grund', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00'), task('b', 'o2', [2], '09:00', '11:00'), task('c', 'o1', [3], '08:00', '12:00'), task('d', 'o1', [4], '08:00', '09:00')]
  const s = setup({ employees: [emp('z', { type: 'Teilzeit', weeklyHours: 4 })], tasks, assignments: { '2026-11-05|d': [{ employeeId: 'z' }] } })
  const z = s.ctx.employees[0]
  const insts = ['2026-11-05|d', '2026-11-04|c', '2026-11-03|b', '2026-11-03|a'].map((k) => s.byKey.get(k))
  const { done, skipped } = handOver(s.ctx, s.state, insts, z, { locked: true })
  assert.deepEqual(done.map((i) => i.key), ['2026-11-03|a', '2026-11-04|c', '2026-11-05|d'])
  assert.deepEqual(skipped.map((x) => x.inst.key), ['2026-11-03|b'])
  assert.deepEqual(skipped[0].reasons, ['Überschneidung: Kanzlei Lehen 08:00–10:00 und Halle Wals 09:00–11:00'])
  assert.ok(s.state.isLocked('z', '2026-11-03|a') && s.state.isLocked('z', '2026-11-04|c'))
  assert.ok(!s.state.isLocked('z', '2026-11-05|d'), 'war schon eingeteilt, bleibt wie es war')
})

test('Übergabe-Vorschlag: meiste Stunden, dann gleiches Revier; ohne die abwesende Person', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00'), task('c', 'o1', [3], '08:00', '12:00')]
  const employees = [emp('x'), emp('p', { type: 'Teilzeit', weeklyHours: 20, team: 'Land' }), emp('q', { availability: { 3: { from: '06:00', to: '20:00' } }, team: 'Stadt' }), emp('r', { team: 'Stadt' }), emp('s', { availability: {} })]
  const s = setup({ employees, tasks })
  const insts = [s.byKey.get('2026-11-03|a'), s.byKey.get('2026-11-04|c')]
  const ranked = rankHandover(s.ctx, s.state, insts, { excludeId: 'x', team: 'Stadt' })
  assert.deepEqual(ranked.map((r) => [r.emp.id, r.done, r.skipped, r.minutes, r.sameTeam]), [['r', 2, 0, 360, true], ['p', 2, 0, 360, false], ['q', 1, 1, 240, true]])
  assert.equal(s.state.count('2026-11-03|a'), 0, 'nur simuliert')
})

test('Saldo-Korrekturen nach neuer Veröffentlichung einer Woche', () => {
  assert.deepEqual(saldoCorrections({ a: 60, b: -30, c: 15 }, { a: 90, b: -30, d: 45 }), [
    { empId: 'a', before: 60, after: 90, delta: 30 },
    { empId: 'c', before: 15, after: 0, delta: -15 },
    { empId: 'd', before: 0, after: 45, delta: 45 },
  ])
  assert.deepEqual(saldoCorrections(), [])
})

test('Korrekturen im Monat: Wochen über den Monatswechsel zählen in beiden Monaten', () => {
  const published = {
    '2026-10-26': { corrections: [{ empId: 'a', delta: 30, at: '2026-11-05T10:00' }, { empId: 'b', delta: -15, at: '2026-11-03T09:00' }] },
    '2026-11-09': { corrections: [{ empId: 'a', delta: 60, at: '2026-11-20T08:00' }] },
    '2026-11-30': { corrections: [{ empId: 'c', delta: 45, at: '2026-12-02T08:00' }] },
    '2026-10-05': { corrections: [{ empId: 'z', delta: 5 }] },
  }
  assert.deepEqual(correctionsInMonth(published, '2026-11').map((c) => [c.monday, c.empId]), [['2026-10-26', 'b'], ['2026-10-26', 'a'], ['2026-11-09', 'a'], ['2026-11-30', 'c']])
  assert.deepEqual(correctionsInMonth(published, '2026-10').map((c) => c.empId), ['z', 'b', 'a'])
  assert.deepEqual(correctionsInMonth(published, '2026-12').map((c) => c.empId), ['c'])
})
