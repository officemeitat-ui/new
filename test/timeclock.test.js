import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dayIndex } from '../src/core/dates.js'
import { PlanState } from '../src/core/plan.js'
import { absMinutes, fromServer, mergeStamps, missingCheckins, stampKey, stampRows, stampUsers } from '../src/core/timeclock.js'
import { viennaTime } from '../src/core/weather.js'

const sec = (date, hm) => Math.floor(viennaTime(date, hm) / 1000)
const min = (date, hm) => dayIndex(date) * 1440 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))
const D = '2026-11-03'
const inst = (key, objectId, from, to, extra = {}) => ({ key: `${D}|${key}`, date: D, objectId, start: min(D, from), end: min(D, to), status: 'normal', staff: 1, ...extra })
const server = (over = {}) => ({ id: 'aaaaaaaaaaa1', hash: 'h-anna', name: 'Anna', objektId: 'o1', objekt: 'Rif', einsatz: `${D}|t1`, plan: '06:00–08:30', datum: D, kommen: sec(D, '05:55'), gehen: sec(D, '08:33'), geaendert: sec(D, '08:33'), ...over })

test('Zeiterfassung: vom Webspace übernehmen, Gehen nachgetragen, ungültige verworfen', () => {
  const index = new Map([['h-anna', 'e1']])
  const s = fromServer(server(), index)
  assert.equal(stampKey(s), `${D}|zaaaaaaaaaaa1`)
  assert.equal(s.empId, 'e1')
  assert.equal(s.in, new Date(sec(D, '05:55') * 1000).toISOString())
  assert.equal(absMinutes(s.in), min(D, '05:55'), 'Wiener Zeit')
  assert.equal(fromServer(server({ einsatz: '2026-11-04|t1' })).instKey, '', 'Einsatz muss zum Tag passen')
  assert.equal(fromServer(server({ id: '../x' })), null)
  const stamps = {}
  assert.equal(mergeStamps(stamps, [server({ gehen: null, geaendert: sec(D, '05:55') })], index), 1)
  assert.equal(Object.values(stamps)[0].out, null)
  assert.equal(mergeStamps(stamps, [server({ gehen: null, geaendert: sec(D, '05:55') })], index), 0, 'unverändert')
  assert.equal(mergeStamps(stamps, [server()], index), 1, 'Gehen nachgetragen')
  assert.ok(Object.values(stamps)[0].out)
  assert.deepEqual([...stampUsers(stamps)], ['e1'])
})

test('Plan gegen Ist: passt, später, früher gegangen, offen, fehlt, ohne Plan; nur wer stempelt', () => {
  const instances = [inst('t1', 'o1', '06:00', '08:30'), inst('t2', 'o2', '09:00', '11:00'), inst('t3', 'o1', '12:00', '13:00'), inst('t4', 'o2', '14:00', '15:00'), inst('t5', 'o1', '06:00', '07:00'), inst('t6', 'o1', '06:00', '07:00', { status: 'cancelled' })]
  const state = new PlanState(instances, { [`${D}|t1`]: [{ employeeId: 'e1' }], [`${D}|t2`]: [{ employeeId: 'e1' }], [`${D}|t3`]: [{ employeeId: 'e1' }], [`${D}|t4`]: [{ employeeId: 'e1' }], [`${D}|t5`]: [{ employeeId: 'e9' }], [`${D}|t6`]: [{ employeeId: 'e1' }] })
  const index = new Map([['h-anna', 'e1']])
  const stamps = {}
  mergeStamps(stamps, [
    server(), // t1: 05:55–08:33 passt
    server({ id: 'aaaaaaaaaaa2', objektId: 'o2', einsatz: `${D}|t2`, kommen: sec(D, '09:20'), gehen: sec(D, '10:40') }), // t2: 20 min später, 20 min früher
    server({ id: 'aaaaaaaaaaa3', einsatz: '', kommen: sec(D, '11:58'), gehen: null }), // t3 ohne Einsatz-Schlüssel, gleiches Objekt und Tag: zugeordnet, offen
    server({ id: 'aaaaaaaaaaa4', objektId: 'o7', einsatz: '', kommen: sec(D, '16:00'), gehen: sec(D, '17:00') }), // eingesprungen
  ], index)
  const now = min(D, '14:30')
  const rows = stampRows({ instances, state, stamps, from: D, to: D, users: stampUsers(stamps), now })
  const by = (k) => rows.find((r) => r.inst?.key === `${D}|${k}`)
  assert.equal(by('t1').status, 'ok')
  assert.equal(by('t1').minutes, 158)
  assert.equal(by('t2').status, 'spaet')
  assert.deepEqual([by('t2').late, by('t2').early], [20, 20])
  assert.equal(by('t3').status, 'offen')
  assert.equal(by('t4').status, 'fehlt', '14:00 begonnen, 14:30 noch nichts')
  assert.equal(by('t5'), undefined, 'e9 benutzt die Zeiterfassung nicht')
  assert.equal(by('t6'), undefined, 'abgesagt')
  assert.equal(rows.at(-1).status, 'ohnePlan')
  assert.equal(rows.at(-1).minutes, 60)
  assert.equal(stampRows({ instances, state, stamps, from: D, to: D, users: stampUsers(stamps), now: min(D, '14:05') }).find((r) => r.inst?.key === `${D}|t4`).status, 'kommt', 'innerhalb der Toleranz')
  const missing = missingCheckins({ instances, state, stamps, users: stampUsers(stamps), now, grace: 20 })
  assert.deepEqual(missing.map((r) => r.inst.key), [`${D}|t4`])
  assert.deepEqual(missingCheckins({ instances, state, stamps, users: stampUsers(stamps), now: min(D, '14:15'), grace: 20 }), [], 'noch in der Frist')
  assert.deepEqual(missingCheckins({ instances, state, stamps, users: stampUsers(stamps), now: min(D, '15:30'), grace: 20 }), [], 'Einsatz schon vorbei')
})

test('Plan gegen Ist: Dauer in der Nacht der Zeitumstellung echt gemessen (22:00–06:00 = 9 h)', () => {
  const N = '2026-10-24'
  const night = { key: `${N}|n1`, date: N, objectId: 'o1', start: min(N, '22:00'), end: min('2026-10-25', '06:00'), status: 'normal', staff: 1 }
  const state = new PlanState([night], { [`${N}|n1`]: [{ employeeId: 'e1' }] })
  const stamps = { a: { id: 'a', empId: 'e1', instKey: `${N}|n1`, date: N, objectId: 'o1', in: new Date(viennaTime(N, '22:00')).toISOString(), out: new Date(viennaTime('2026-10-25', '06:00')).toISOString() } }
  const [row] = stampRows({ instances: [night], state, stamps, from: N, to: N, users: new Set(['e1']), now: min('2026-10-26', '00:00'), tolerance: 10 })
  assert.equal(row.minutes, 540, 'Uhr wird um 3 Uhr auf 2 Uhr zurückgestellt: eine Stunde mehr')
  assert.equal(row.status, 'ok', 'Plan in Ortszeit: pünktlich')
})
