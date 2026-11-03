import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, validatePlan } from '../src/core/rules.js'
import { addMonths, dueList, isRequired, matrix, sessionRecords, shiftProblems, statusOf, TRAINING_DEFAULTS, typesOf, untilOf } from '../src/core/trainings.js'
import { sessionDocument, sessionPdfName } from '../src/export/training-pdf.js'

const T = Object.fromEntries(TRAINING_DEFAULTS.map((t) => [t.id, t]))
const rec = (empId, typeId, date, extra = {}) => ({ id: `${empId}-${typeId}-${date}`, empId, typeId, date, until: '', ...extra })

test('Fristen: Monate addieren, gültig bis, Pflicht je Art', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-11-03', 12), '2027-11-03')
  assert.equal(addMonths('2026-11-03', 48), '2030-11-03')
  assert.equal(untilOf(rec('a', 'sicherheit', '2026-01-10'), T.sicherheit), '2027-01-10')
  assert.equal(untilOf(rec('a', 'sicherheit', '2026-01-10', { until: '2026-06-30' }), T.sicherheit), '2026-06-30', 'eingetragen geht vor')
  assert.equal(untilOf(rec('a', 'aufenthalt', '2026-01-10'), T.aufenthalt), '', 'ohne Monate kein Ablauf')
  assert.ok(isRequired(T.sicherheit, { skills: [] }))
  assert.ok(isRequired(T.fuehrerschein, { skills: ['Führerschein'] }) && !isRequired(T.fuehrerschein, { skills: [] }))
  assert.ok(!isRequired(T.ersthilfe, {}))
  assert.equal(typesOf({ types: [{ id: 'x', name: 'X', active: false }, { id: 'y', name: 'Y' }] }).map((t) => t.id).join(), 'y', 'eigene Arten, inaktive aus')
  assert.equal(typesOf({ types: [] }).length, TRAINING_DEFAULTS.length)
})

test('Fristen: Ampel, Matrix, Handlungsbedarf (sperrende Dokumente zuerst)', () => {
  const today = '2026-11-03'
  const employees = [{ id: 'a', name: 'Ana', skills: ['Führerschein'] }, { id: 'b', name: 'Bo', skills: [] }, { id: 'c', name: 'Cem', skills: [], exitDate: '2026-10-01' }]
  const records = [rec('a', 'sicherheit', '2025-11-20'), rec('a', 'sicherheit', '2025-10-01'), rec('b', 'sicherheit', '2025-10-30'), rec('a', 'aufenthalt', '2025-01-01', { until: '2026-11-20' }), rec('a', 'fuehrerschein', '2026-06-01')]
  const doc = { types: [], records }
  assert.equal(statusOf({ type: T.sicherheit, emp: employees[0], records, today }).state, 'bald', 'der neuere Eintrag zählt: bis 20.11.2026')
  assert.equal(statusOf({ type: T.sicherheit, emp: employees[1], records, today }).state, 'abgelaufen')
  assert.equal(statusOf({ type: T.chemie, emp: employees[1], records, today }).state, 'fehlt')
  assert.equal(statusOf({ type: T.ersthilfe, emp: employees[1], records, today }).state, 'na')
  assert.equal(statusOf({ type: T.fuehrerschein, emp: employees[0], records, today }).state, 'bald', '6 Monate: bis 01.12.2026, also in 28 Tagen')
  assert.equal(statusOf({ type: T.fuehrerschein, emp: employees[0], records, today, warnDays: 14 }).state, 'ok')
  const m = matrix({ doc, employees, today })
  assert.deepEqual(m.map((r) => r.emp.id), ['a', 'b'], 'ausgetretene nicht')
  assert.equal(m[1].worst, 'abgelaufen')
  const due = dueList({ doc, employees, today })
  assert.equal(due[0].type.id, 'aufenthalt', 'sperrendes Dokument zuerst')
  assert.ok(due.some((d) => d.emp.id === 'b' && d.type.id === 'chemie' && d.state === 'fehlt'))
})

test('Fristen: Unterweisung für viele (mit Unterschrift), Prüfregel im Plan', () => {
  const session = { id: 's1', typeId: 'sicherheit', date: '2026-11-03', topic: 'Leitern, Chemie', participants: ['a', 'b'] }
  let n = 0
  const recs = sessionRecords(session, T.sicherheit, { newId: () => `r${++n}`, at: 'x', by: 'Büro', signatures: { a: '<svg/>' } })
  assert.deepEqual(recs.map((r) => [r.empId, r.date, r.signature, r.sessionId]), [['a', '2026-11-03', '<svg/>', 's1'], ['b', '2026-11-03', '', 's1']])
  assert.equal(recs[0].note, 'Inhalt: Leitern, Chemie')
  // Prüfregel
  const doc = { types: [], records: [rec('x', 'aufenthalt', '2025-01-01', { until: '2026-11-03' }), rec('y', 'fuehrerschein', '2026-01-02')] }
  assert.deepEqual(shiftProblems({ doc, emp: { id: 'x', skills: [] }, date: '2026-11-03' }), [], 'am letzten Tag noch gültig')
  assert.match(shiftProblems({ doc, emp: { id: 'x', skills: [] }, date: '2026-11-04' })[0].text, /Aufenthaltstitel \/ Arbeitserlaubnis abgelaufen \(03\.11\.2026\)/)
  assert.equal(shiftProblems({ doc, emp: { id: 'y', skills: ['Führerschein'] }, date: '2026-11-04', skills: [] }).length, 0, 'Einsatz ohne Führerschein: keine Warnung')
  assert.equal(shiftProblems({ doc, emp: { id: 'y', skills: ['Führerschein'] }, date: '2026-11-04', skills: ['Führerschein'] })[0].severity, 'warning')
  assert.equal(shiftProblems({ doc, emp: { id: 'z', skills: ['Führerschein'] }, date: '2026-11-04', skills: ['Führerschein'] }).length, 0, 'ohne Eintrag keine Warnung im Plan (steht unter „Zu erledigen“)')
  const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
  const emp = (id, skills = []) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills, trained: ['o1'], availability: allDays })
  const data = { employees: [emp('x'), emp('y', ['Führerschein'])], objects: [{ id: 'o1', name: 'A' }], tasks: [{ id: 't', objectId: 'o1', label: 'Tour', recurrence: { type: 'weekly', weekdays: [3] }, start: '06:00', end: '08:00', staff: 2, regulars: [], skills: ['Führerschein'], holidayRule: 'findet_statt' }], absences: [], rules: {}, overrides: {}, unterweisungen: doc }
  const holidays = holidayCalendar('2026-10-26', '2026-11-15')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-26', '2026-11-15', holidays, ctx.rules)
  const state = new PlanState(instances, { '2026-11-04|t': [{ employeeId: 'x' }, { employeeId: 'y' }] })
  const issues = validatePlan(ctx, state, instances, { from: '2026-11-02', to: '2026-11-08' }).issues.filter((i) => ['PERMIT_EXPIRED', 'CHECK_EXPIRED'].includes(i.code))
  assert.deepEqual(issues.map((i) => [i.code, i.severity, i.employeeId]).sort(), [['CHECK_EXPIRED', 'warning', 'y'], ['PERMIT_EXPIRED', 'error', 'x']])
})

test('Fristen: Nachweis als PDF mit Unterschrift', () => {
  const doc = sessionDocument({ session: { date: '2026-11-03', topic: 'Leitern', trainer: 'Büro', place: 'Lager' }, type: T.sicherheit, people: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bo' }], signatures: { a: '<svg xmlns="http://www.w3.org/2000/svg"/>' } })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Sicherheitsunterweisung \(§ 14 ASchG\)/)
  assert.match(json, /"svg":"<svg/)
  assert.match(json, /Unterschrift Büro/)
  assert.equal(sessionPdfName({ date: '2026-11-03' }, T.sicherheit), 'Unterweisung_2026-11-03_Sicherheitsunterweisung.pdf')
})
