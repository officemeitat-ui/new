import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { effectiveKeys, giveBack, handOver, handoversNeeded, historyText, importFromObjects, keysOf, keyWarnings, markFound, markLost, objectKeys, returnToCustomer } from '../src/core/keys.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, validatePlan } from '../src/core/rules.js'

const at = '2026-11-03T08:00:00.000Z'
const k = (id, over = {}) => ({ id, objectId: 'o1', label: 'Haupteingang', no: id, kind: 'schluessel', holderId: '', since: '2026-10-01', due: '', status: 'aktiv', history: [], ...over })

test('Schlüssel: ausgeben, weitergeben, zurück, Verlust, wieder da, an Kunden', () => {
  let x = handOver(k('1'), { to: 'e1', date: '2026-11-03', due: '2026-11-30', by: 'Büro', signature: '<svg/>', at })
  assert.equal(x.holderId, 'e1')
  assert.equal(x.due, '2026-11-30')
  assert.deepEqual(x.history[0], { at, date: '2026-11-03', kind: 'ausgabe', to: 'e1', by: 'Büro', signature: '<svg/>' })
  x = handOver(x, { to: 'e2', date: '2026-11-04', by: 'Büro', at })
  assert.equal(x.history[1].from, 'e1', 'Weitergabe merkt, von wem')
  assert.equal(x.due, '', 'neue Ausgabe ohne Frist: alte Frist weg')
  x = giveBack(x, { date: '2026-11-05', by: 'Büro', at })
  assert.equal(x.holderId, '')
  assert.equal(historyText(x.history[2], (id) => id.toUpperCase()), 'zurückgegeben von E2 ins Büro')
  assert.equal(historyText(x.history[1], (id) => id.toUpperCase()), 'ausgegeben von E1 an E2')
  assert.throws(() => handOver(x, { date: '2026-11-05', at }))
  x = markLost(handOver(x, { to: 'e3', date: '2026-11-06', at }), { date: '2026-11-07', text: 'im Bus', at })
  assert.equal(x.status, 'verloren')
  assert.equal(x.lost.informed, false)
  assert.deepEqual(objectKeys([x], 'o1'), [], 'verlorene zählen nicht')
  x = markFound(x, { date: '2026-11-08', at })
  assert.equal(x.status, 'aktiv')
  assert.equal(x.holderId, '', 'gefunden: liegt im Büro')
  assert.equal(returnToCustomer(x, { date: '2026-11-09', at }).status, 'kunde')
})

test('Schlüssel: Hinweise (ausgetreten, Austritt bald, Rückgabe fällig, abwesend, verloren)', () => {
  const employees = [{ id: 'e1', name: 'Ana', exitDate: '2026-10-31' }, { id: 'e2', name: 'Bo', exitDate: '2026-11-10' }, { id: 'e3', name: 'Cem' }, { id: 'e4', name: 'Dina' }]
  const keys = [k('1', { holderId: 'e1' }), k('2', { holderId: 'e2' }), k('3', { holderId: 'e3', due: '2026-11-01' }), k('4', { holderId: 'e4' }), k('5', { status: 'verloren', lost: { informed: false } }), k('6', { status: 'verloren', lost: { informed: true } }), k('7', { status: 'kunde', holderId: 'e1' })]
  const absences = [{ employeeId: 'e4', from: '2026-11-01', to: '2026-11-20', type: 'Krankenstand' }]
  const w = keyWarnings({ keys, employees, absences, today: '2026-11-03' })
  assert.deepEqual(w.map((x) => `${x.code}:${x.key.id}`), ['AUSGETRETEN:1', 'VERLOREN:5', 'AUSTRITT:2', 'FAELLIG:3', 'ABWESEND:4'])
  assert.equal(w.find((x) => x.code === 'ABWESEND').severity, 'info')
  assert.deepEqual(keysOf(keys, 'e1').map((x) => x.id), ['1'], 'an den Kunden zurückgegebene zählen nicht')
})

test('Schlüssel: aus den Objekten übernehmen (einmal), Schlüsselbuch gilt in der Planung', () => {
  const objects = [{ id: 'o1', name: 'A', keys: [{ id: 'a', label: 'Tür', holderId: 'e1' }, { id: 'b', label: ' ', holderId: '' }] }, { id: 'o2', name: 'B', keys: [{ id: 'c', label: 'Tor', holderId: '' }] }]
  let n = 0
  const list = importFromObjects(objects, [], { newId: () => `n${++n}`, at, date: '2026-11-03', by: 'Büro' })
  assert.deepEqual(list.map((x) => [x.objectId, x.label, x.holderId, x.legacyId]), [['o1', 'Tür', 'e1', 'o1:a'], ['o2', 'Tor', '', 'o2:c']])
  assert.equal(importFromObjects(objects, list, { newId: () => 'x', at, date: '2026-11-03' }).length, 0, 'nicht doppelt')
  assert.deepEqual(importFromObjects(objects, [k('9', { objectId: 'o1' })], { newId: () => 'x', at, date: '2026-11-03' }).map((x) => x.objectId), ['o2'], 'Objekt schon im Buch: nicht übernehmen')
  const eff = effectiveKeys(objects, [k('1', { objectId: 'o1', holderId: 'e9' })])
  assert.deepEqual(eff.get('o1').map((x) => x.holderId), ['e9'], 'Objekt im Buch: nur das Buch zählt')
  assert.deepEqual(eff.get('o2').map((x) => x.label), ['Tor'], 'sonst die Schlüssel am Objekt')
  assert.deepEqual(effectiveKeys(objects, [k('1', { status: 'verloren' })]).get('o1'), [], 'nur verlorene im Buch: keine aktiven Schlüssel')
})

test('Schlüssel: Prüfregel und Übergaben laut Plan nutzen das Schlüsselbuch', () => {
  const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
  const emp = (id) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
  const data = { employees: [emp('x'), emp('y')], objects: [{ id: 'o1', name: 'Kanzlei', keys: [{ id: 'alt', label: 'Alt', holderId: 'y' }] }], tasks: [{ id: 't', objectId: 'o1', label: 'Reinigung', recurrence: { type: 'weekly', weekdays: [2, 3] }, start: '06:00', end: '08:00', staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt' }], absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-26', '2026-11-15')
  const asg = { '2026-11-03|t': [{ employeeId: 'x' }], '2026-11-04|t': [{ employeeId: 'x' }] }
  const run = (d) => {
    const ctx = createContext(d, holidays)
    const instances = buildInstances(d, '2026-10-26', '2026-11-15', holidays, ctx.rules)
    const state = new PlanState(instances, asg)
    return { ctx, instances, state, issues: validatePlan(ctx, state, instances, { from: '2026-11-02', to: '2026-11-08' }).issues.filter((i) => i.code === 'KEY_HANDOVER') }
  }
  // ohne Schlüsselbuch: Schlüssel am Objekt (bei y) → Übergabe nötig
  assert.equal(run(data).issues.length, 2)
  assert.match(run(data).issues[0].message, /Schlüssel bei y/)
  // im Schlüsselbuch hat x einen → keine Übergabe
  const withBook = { ...data, schluessel: { keys: [k('1', { holderId: 'x' })] } }
  assert.equal(run(withBook).issues.length, 0)
  // Übergaben laut Plan: je Person und Objekt nur der erste Einsatz
  const r = run({ ...data, schluessel: { keys: [k('1', { holderId: 'y' }), k('2')] } })
  const ho = handoversNeeded({ instances: r.instances, state: r.state, keysByObject: r.ctx.keysByObject, from: '2026-11-03', to: '2026-11-10' })
  assert.deepEqual(ho.map((h) => [h.date, h.empId, h.holders, h.office]), [['2026-11-03', 'x', ['y'], true]])
})
