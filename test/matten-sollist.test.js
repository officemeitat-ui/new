// Mattenwechsel: Soll-Ist der Tour (core/matten-sollist.js). Alle Daten erfunden; Zeiten in Wien (Winterzeit: UTC+1).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { diffText, sollIstText, stopSollIst, tourSollIst } from '../src/core/matten-sollist.js'

const stop = (id, departure, finishedUtc, extra = {}) => ({ id, customer: { name: `Kunde ${id}` }, status: finishedUtc ? 'abgeschlossen' : 'geplant', times: departure ? { arrival: departure, departure } : undefined, ...(finishedUtc ? { finishedAt: `2026-11-24T${finishedUtc}:00.000Z` } : {}), items: [], ...extra })

test('Stopp: Abweichung zwischen geplanter Abfahrt und Abschluss (Zeit in Wien), pünktlich innerhalb von 15 Minuten', () => {
  assert.deepEqual(stopSollIst(stop('s1', '07:30', '06:42'), '2026-11-24'), { planned: '07:30', actual: '07:42', diff: 12, onTime: true })
  assert.deepEqual(stopSollIst(stop('s1', '07:30', '07:10'), '2026-11-24'), { planned: '07:30', actual: '08:10', diff: 40, onTime: false })
  assert.deepEqual(stopSollIst(stop('s1', '09:00', '07:20'), '2026-11-24'), { planned: '09:00', actual: '08:20', diff: -40, onTime: false })
  // Abfahrt vor Ankunft, wenn beides da ist
  assert.equal(stopSollIst({ ...stop('s1', '07:30', '06:42'), times: { arrival: '07:10', departure: '07:30' } }, '2026-11-24').planned, '07:30')
  assert.equal(stopSollIst({ ...stop('s1', '', '06:42'), times: { arrival: '07:10' } }, '2026-11-24').diff, 32)
  // nicht vergleichbar: offen, ohne geplante Zeit, an einem anderen Tag abgeschlossen (z. B. Korrektur im Büro)
  assert.equal(stopSollIst(stop('s1', '07:30', ''), '2026-11-24'), null)
  assert.equal(stopSollIst(stop('s1', '', '06:42'), '2026-11-24'), null)
  assert.equal(stopSollIst(stop('s1', '07:30', '06:42'), '2026-11-25'), null)
  assert.equal(stopSollIst(null), null)
  assert.equal(stopSollIst(stop('s1', '07:30', '06:42'), '2026-11-24', { tolerance: 5 }).onTime, false)
})

test('Text der Abweichung', () => {
  assert.equal(diffText(0), 'pünktlich')
  assert.equal(diffText(12), 'pünktlich (+12 Min.)')
  assert.equal(diffText(-5), 'pünktlich (−5 Min.)')
  assert.equal(diffText(40), '+40 Min.')
  assert.equal(diffText(-40), '−40 Min.')
  assert.equal(diffText(null), '')
})

test('Tour: pünktlich, später, früher, mittlere Abweichung, Ende geplant gegen tatsächlich', () => {
  const t = { id: 't1', date: '2026-11-24', status: 'abgeschlossen', finishedAt: '2026-11-24T11:40:00.000Z', order: ['s1', 's2', 's3', 's4'], route: { end: '12:10' }, stops: [stop('s1', '07:30', '06:42'), stop('s2', '08:30', '08:10'), stop('s3', '10:00', '08:20'), stop('s4', '11:00', '')] }
  const sum = tourSollIst(t)
  assert.deepEqual(sum.stops.map((s) => [s.stopId, s.diff]), [['s1', 12], ['s2', 40], ['s3', -40]])
  assert.deepEqual([sum.measured, sum.onTime, sum.late, sum.early, sum.avg], [3, 1, 1, 1, 4])
  assert.deepEqual([sum.plannedEnd, sum.actualEnd, sum.endDiff], ['12:10', '12:40', 30])
  assert.equal(sollIstText(sum), '1 von 3 Stopps pünktlich, 1 später, 1 früher · im Schnitt +4 Min. · Ende 12:40 statt 12:10 Uhr')
  // unterwegs: noch kein Ende; ohne vergleichbaren Stopp kein Ergebnis
  const running = tourSollIst({ ...t, status: 'unterwegs', finishedAt: undefined })
  assert.equal(running.plannedEnd, undefined)
  assert.equal(sollIstText(tourSollIst({ ...t, status: 'unterwegs', stops: [stop('s1', '07:30', '06:30')], order: ['s1'] })), '1 von 1 Stopp pünktlich · im Schnitt wie geplant')
  assert.equal(tourSollIst({ id: 't2', date: '2026-11-24', stops: [stop('s1', '07:30', '')], order: ['s1'] }), null)
  assert.equal(sollIstText(null), '')
})
