import { test } from 'node:test'
import assert from 'node:assert/strict'

import { approveAll, breakWarnings, correctStamp, manualStamp, monthSummary, netMinutes, viennaIso } from '../src/core/worktime.js'

test('Arbeitszeit: Ortszeit Wien in Winter und Sommer', () => {
  assert.equal(viennaIso('2026-11-04', '06:30'), '2026-11-04T05:30:00.000Z')
  assert.equal(viennaIso('2026-07-01', '06:30'), '2026-07-01T04:30:00.000Z')
  assert.equal(viennaIso('2026-11-04', '00:15'), '2026-11-03T23:15:00.000Z')
})

test('Arbeitszeit: nachtragen mit Grund, über Mitternacht, Pause', () => {
  assert.throws(() => manualStamp({ date: '2026-11-04', empId: 'e1', from: '06:00' }), /Grund/)
  const s = manualStamp({ date: '2026-11-04', empId: 'e1', objectId: 'o1', from: '22:00', to: '02:00', pause: 30, reason: 'vergessen', by: 'Büro', at: '2026-11-05T08:00:00Z' })
  assert.equal(s.source, 'manuell')
  assert.equal(s.out, '2026-11-05T01:00:00.000Z')
  assert.equal(netMinutes(s), 210)
  assert.match(s.id, /^m[0-9a-f]{11}$/)
})

test('Arbeitszeit: Korrektur behält den ersten Stand und den Verlauf, Freigabe fällt weg', () => {
  const s = { id: 'abc', date: '2026-11-04', empId: 'e1', in: '2026-11-04T05:05:00.000Z', out: '2026-11-04T07:55:00.000Z', approved: { by: 'x' } }
  const c1 = correctStamp(s, { from: '06:00', to: '09:00', reason: 'falsch', by: 'Büro', at: '2026-11-05T08:00:00Z' })
  const c2 = correctStamp(c1, { from: '06:00', to: '09:30', reason: 'laenger', by: 'Büro', at: '2026-11-05T09:00:00Z' })
  assert.deepEqual(c2.orig, { in: s.in, out: s.out })
  assert.equal(c2.changes.length, 2)
  assert.equal(c2.changes[1].before.out, '2026-11-04T08:00:00.000Z')
  assert.equal(c2.approved, undefined)
  assert.equal(netMinutes(c2), 210)
})

test('Arbeitszeit: Ruhepause nach § 11 AZG (mehr als 6 h)', () => {
  const st = (from, to, extra = {}) => ({ empId: 'e1', date: '2026-11-04', in: viennaIso('2026-11-04', from), out: viennaIso('2026-11-04', to), ...extra })
  assert.equal(breakWarnings([st('06:00', '13:00')]).length, 1, '7 h ohne Pause')
  assert.equal(breakWarnings([st('06:00', '13:00', { pause: 30 })]).length, 0, 'Pause eingetragen')
  assert.equal(breakWarnings([st('06:00', '10:00'), st('10:30', '13:30')]).length, 0, 'Lücke zwischen Einsätzen')
  assert.equal(breakWarnings([st('06:00', '10:00'), st('10:15', '13:30')]).length, 1, 'Lücke zu kurz')
  assert.equal(breakWarnings([st('06:00', '12:00')]).length, 0, 'genau 6 h')
})

test('Arbeitszeit: Monatsübersicht und Freigabe', () => {
  const a = { empId: 'e1', in: viennaIso('2026-11-04', '06:00'), out: viennaIso('2026-11-04', '08:10') }
  const b = { empId: 'e1', in: viennaIso('2026-11-05', '06:20'), out: viennaIso('2026-11-05', '08:00'), source: 'manuell' }
  const rows = [
    { date: '2026-11-04', empId: 'e1', inst: { net: 120 }, stamp: a, status: 'ok' },
    { date: '2026-11-05', empId: 'e1', inst: { net: 120 }, stamp: b, status: 'spaet' },
    { date: '2026-11-06', empId: 'e1', inst: { net: 120 }, stamp: null, status: 'fehlt' },
  ]
  const [p] = monthSummary(rows)
  assert.deepEqual({ soll: p.soll, ist: p.ist, diff: p.diff, spaet: p.spaet, fehlt: p.fehlt, manuell: p.manuell, offen: p.offen, tage: p.tage }, { soll: 360, ist: 230, diff: -130, spaet: 1, fehlt: 1, manuell: 1, offen: 2, tage: 2 })
  assert.equal(approveAll([a, b, { empId: 'e2', in: a.in, out: null }], { by: 'Büro' }), 2)
  assert.equal(monthSummary(rows)[0].offen, 0)
})
