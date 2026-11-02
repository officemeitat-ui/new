import { test } from 'node:test'
import assert from 'node:assert/strict'

import { complaintList, complaintStats, daysToDone, defaultDue, hotspots, isOverdue, whoWorked } from '../src/core/complaints.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'
import { complaintDocument, complaintPdfName } from '../src/export/complaint-pdf.js'

const c = (id, over = {}) => ({ id, objectId: 'o1', date: '2026-11-03', received: '2026-11-03T08:00:00.000Z', source: 'Kunde (Telefon)', kind: 'Reinigung mangelhaft', text: 'Boden', employees: [], measure: '', due: '2026-11-04', status: 'offen', result: '', informed: false, history: [], ...over })

test('Reklamation: Frist je Art, überfällig, Liste (überfällige zuerst), Häufung, Kennzahlen', () => {
  assert.equal(defaultDue('Reinigung mangelhaft', '2026-11-03'), '2026-11-04')
  assert.equal(defaultDue('Schaden', '2026-11-03'), '2026-11-06')
  assert.equal(defaultDue('Sonstiges', '2026-11-03'), '2026-11-10')
  const items = [
    c('a', { due: '2026-11-10' }),
    c('b', { due: '2026-11-04' }),
    c('d', { status: 'erledigt', doneAt: '2026-11-05T10:00:00.000Z', objectId: 'o2' }),
    c('e', { status: 'erledigt', doneAt: '2026-11-04T10:00:00.000Z' }),
  ]
  const today = '2026-11-05'
  assert.ok(isOverdue(items[1], today) && !isOverdue(items[0], today) && !isOverdue(items[2], today))
  assert.deepEqual(complaintList(items, { status: 'offen', today }).map((x) => x.id), ['b', 'a'])
  assert.deepEqual(complaintList(items, { status: 'erledigt', today }).map((x) => x.id), ['d', 'e'], 'neueste zuerst')
  assert.deepEqual(complaintList(items, { status: 'alle', objectId: 'o2', today }).map((x) => x.id), ['d'])
  assert.deepEqual(hotspots(items, { today }), [{ objectId: 'o1', n: 3 }])
  assert.equal(daysToDone(items[2]), 2)
  assert.deepEqual(complaintStats(items, { from: '2026-11-01', to: '2026-11-30' }), { total: 4, open: 2, done: 2, byKind: { 'Reinigung mangelhaft': 4 }, avgDays: 1.5 })
})

test('Reklamation: wer laut Plan am Tag und am Vortag im Objekt war', () => {
  const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
  const emp = (id) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: [], availability: allDays })
  const task = (id, objectId, weekdays, start, end) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt' })
  const data = { employees: [emp('x'), emp('y')], objects: [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }], tasks: [task('abend', 'o1', [1], '18:00', '20:00'), task('frueh', 'o1', [2], '06:00', '08:00'), task('anders', 'o2', [2], '06:00', '08:00')], absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-26', '2026-11-15')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-26', '2026-11-15', holidays, ctx.rules)
  const state = new PlanState(instances, { '2026-11-02|abend': [{ employeeId: 'x' }], '2026-11-03|frueh': [{ employeeId: 'y' }], '2026-11-03|anders': [{ employeeId: 'x' }] })
  assert.deepEqual(whoWorked({ instances, state, objectId: 'o1', date: '2026-11-03' }).map((w) => [w.empId, w.date, w.time]), [['x', '2026-11-02', '18:00–20:00'], ['y', '2026-11-03', '06:00–08:00']])
})

test('Reklamation als PDF: ohne Namen der Mitarbeitenden, mit Maßnahme und Ergebnis', () => {
  const doc = complaintDocument({ complaint: c('a', { employees: ['e1'], measure: 'Nachreinigung', result: 'Erledigt, Kunde informiert', informed: true, status: 'erledigt', doneAt: '2026-11-03T15:00:00.000Z', history: [{ at: '2026-11-03T08:00:00.000Z', text: 'erfasst' }] }), object: { name: 'Wohnanlage Rif', address: 'Rif 3' }, brand: { name: 'Firma' } })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Reklamation/)
  assert.match(json, /Wohnanlage Rif, Rif 3/)
  assert.match(json, /Nachreinigung/)
  assert.match(json, /Kunde informiert.*ja/)
  assert.ok(!json.includes('e1'), 'keine Mitarbeitenden im PDF')
  assert.equal(complaintPdfName(c('a'), 'Wohnanlage Rif'), 'Reklamation_2026-11-03_Wohnanlage-Rif.pdf')
})
