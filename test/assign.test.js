import { test } from 'node:test'
import assert from 'node:assert/strict'

import { conflictsWith, evaluateRegular, rankRegulars, suggestRegulars, weeklyMinutes } from '../src/core/assign.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { createContext } from '../src/core/rules.js'

const avail = (days, from = '06:00', to = '20:00') => Object.fromEntries(days.map((d) => [d, { from, to }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Teilzeit', weeklyHours: 20, team: 'Stadt', skills: [], trained: [], availability: avail([1, 2, 3, 4, 5]), ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays, everyWeeks: 1, anchor: '2026-11-02' }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })
const objects = [{ id: 'o1', name: 'Kanzlei', short: 'Kanzlei', region: 'Stadt' }, { id: 'o2', name: 'Büro', short: 'Büro', region: 'Stadt' }, { id: 'o3', name: 'Halle', short: 'Halle', region: 'Land', onlyTrained: true }]

function ctxFor(employees, tasks, extra = {}) {
  const data = { employees, objects, tasks, absences: [], rules: {}, travel: { 'o1|o2': 15 }, trips: {}, ...extra }
  return { ...createContext(data, holidayCalendar('2026-11-01', '2026-12-31')), tasks }
}

test('Zuweisung: Stunden pro Woche im Stammplan (14-tägig halb, monatlich anteilig)', () => {
  const rules = createContext({ employees: [], objects: [] }, new Map()).rules
  assert.equal(weeklyMinutes(task('a', 'o1', [1, 3, 5], '17:30', '19:30'), rules), 360)
  assert.equal(weeklyMinutes(task('b', 'o1', [4], '13:00', '15:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2 } }), rules), 60)
  assert.equal(Math.round(weeklyMinutes({ start: '08:00', end: '13:00', recurrence: { type: 'monthly', mode: 'nth', nth: 1, weekday: 6, everyMonths: 1 } }, rules)), 69)
  assert.equal(weeklyMinutes({ start: '08:00', end: '12:00', recurrence: { type: 'once', date: '2026-11-05' } }, rules), 0)
})

test('Zuweisung: Verfügbarkeit, Qualifikation, Überschneidung und Fahrzeit schließen aus', () => {
  const busy = task('busy', 'o2', [1, 3], '16:00', '17:20', { regulars: ['ana'] })
  const ana = emp('ana')
  const ctx = ctxFor([ana, emp('ben', { availability: avail([1, 2, 3, 4, 5], '06:00', '12:00') }), emp('cem', { minor: true })], [busy])
  const evening = task('t', 'o1', [1, 3, 5], '17:30', '19:30', { skills: ['Glasreinigung'] })
  const a = evaluateRegular(ctx, evening, ana)
  assert.equal(a.allowed, false)
  assert.ok(a.blockers.some((b) => b.startsWith('fehlt: Glasreinigung')))
  assert.ok(a.blockers.some((b) => b === 'Fahrzeit 15 min zu Büro reicht nicht'), a.blockers.join(' | '))
  const b = evaluateRegular(ctx, { ...evening, skills: [] }, ctx.employeesById.get('ben'))
  assert.ok(b.blockers[0].startsWith('nicht verfügbar Mo, Mi, Fr 17:30–19:30'))
  const early = evaluateRegular(ctx, task('f', 'o1', [2], '05:30', '07:00'), ctx.employeesById.get('cem'))
  assert.ok(early.blockers.some((x) => x.startsWith('unter 18: Nachtruhe')))
  const overlap = conflictsWith(ctx, task('x', 'o2', [1], '17:00', '18:00'), [busy])
  assert.equal(overlap[0].kind, 'overlap')
})

test('Zuweisung: 14-tägig in verschiedenen Wochen überschneidet sich nicht', () => {
  const ctx = ctxFor([emp('ana')], [])
  const a = task('a', 'o1', [4], '13:00', '15:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2, anchor: '2026-11-02' } })
  const b = task('b', 'o1', [4], '13:00', '15:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2, anchor: '2026-11-09' } })
  const c = task('c', 'o1', [4], '14:00', '16:00', { recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2, anchor: '2026-11-16' } })
  assert.equal(conflictsWith(ctx, a, [b]).length, 0)
  assert.equal(conflictsWith(ctx, a, [c]).length, 1)
})

test('Zuweisung: Vorschlag bevorzugt freie Stunden, Objekt-Kenntnis und Anschluss', () => {
  const tasks = [task('morning', 'o1', [1, 2, 3, 4, 5], '08:00', '10:00', { regulars: ['ana'] }), task('full', 'o2', [1, 2, 3, 4, 5], '06:00', '10:00', { regulars: ['ben'] })]
  const ctx = ctxFor([emp('ana'), emp('ben'), emp('cem', { team: 'Land' })], tasks)
  const next = task('next', 'o1', [1, 2, 3, 4, 5], '10:30', '11:30')
  const ranked = rankRegulars(ctx, next)
  assert.equal(ranked[0].emp.id, 'ana')
  const texts = ranked[0].factors.filter((f) => f.good).map((f) => f.text)
  assert.ok(texts.includes('betreut das Objekt schon'))
  assert.ok(texts.includes('noch 10 h/Woche frei'))
  assert.ok(ranked.find((x) => x.emp.id === 'cem').factors.some((f) => f.text === 'anderes Revier (Land)'))
  assert.ok(ranked.find((x) => x.emp.id === 'ben').factors.some((f) => f.text === 'Vertrag schon voll'))
})

test('Zuweisung: alle Vorschläge ohne Doppelbelegung, Rest bleibt offen', () => {
  const tasks = [task('a', 'o1', [1, 2, 3, 4, 5], '17:00', '19:00'), task('b', 'o2', [1, 2, 3, 4, 5], '17:00', '19:00'), task('c', 'o1', [1, 2, 3, 4, 5], '17:30', '18:30')]
  const ctx = ctxFor([emp('ana'), emp('ben')], tasks)
  const out = suggestRegulars(ctx)
  assert.equal(out.length, 2)
  assert.equal(new Set(out.map((s) => s.emp.id)).size, 2, 'jede Person nur einmal zur selben Zeit')
  // nur für bestimmte Leistungen
  assert.deepEqual(suggestRegulars(ctx, { taskIds: ['b'] }).map((s) => s.task.id), ['b'])
})

test('Zuweisung: geringfügig über der Monatsgrenze ist ausgeschlossen', () => {
  const ctx = ctxFor([emp('gfb', { type: 'Geringfügig', weeklyHours: 9, maxMonthHours: 40 })], [])
  const ev = evaluateRegular(ctx, task('big', 'o1', [1, 2, 3, 4, 5], '08:00', '10:00'), ctx.employeesById.get('gfb'))
  assert.ok(ev.blockers.some((b) => b.includes('h/Monat (geringfügig)')))
})
