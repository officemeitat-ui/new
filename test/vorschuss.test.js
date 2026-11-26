// Lohnvorschuss (core/vorschuss.js): Ratenplan wie in der Vorlage (1000 € im ersten Monat, dann 500 €), Prüfung, Abzug je
// Monat, Stand, offener Rest beim Austritt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceProblem, advanceState, deductionIn, deductionsIn, openAtExit, planInstallments } from '../src/core/vorschuss.js'

test('Ratenplan: erste Rate anders, dann gleich, der Rest zuletzt; über den Jahreswechsel', () => {
  assert.deepEqual(planInstallments(2500, { firstMonth: '2026-10', firstRate: 1000, rate: 500 }), [
    { month: '2026-10', amount: 1000 },
    { month: '2026-11', amount: 500 },
    { month: '2026-12', amount: 500 },
    { month: '2027-01', amount: 500 },
  ])
  assert.deepEqual(planInstallments('1000,50', { firstMonth: '2026-12', rate: 400 }), [
    { month: '2026-12', amount: 400 },
    { month: '2027-01', amount: 400 },
    { month: '2027-02', amount: 200.5 },
  ])
  assert.deepEqual(planInstallments(100, { firstMonth: '2026-13', rate: 50 }), [])
  assert.deepEqual(planInstallments(0, { firstMonth: '2026-10', rate: 50 }), [])
})

test('Prüfung: Summe der Raten, Monate, Raten nicht vor der Auszahlung', () => {
  const ok = { empId: 'e1', amount: 2500, date: '2026-10-07', installments: planInstallments(2500, { firstMonth: '2026-10', firstRate: 1000, rate: 500 }) }
  assert.equal(advanceProblem(ok), '')
  assert.match(advanceProblem({ ...ok, installments: ok.installments.slice(1) }), /ergeben 1500,00 €, der Vorschuss ist 2500,00 €/)
  assert.match(advanceProblem({ ...ok, date: '2026-11-02' }), /vor der Auszahlung/)
  assert.match(advanceProblem({ ...ok, empId: '' }), /Person/)
})

const A = { id: 'a1', empId: 'e1', amount: 2500, date: '2026-10-07', installments: planInstallments(2500, { firstMonth: '2026-10', firstRate: 1000, rate: 500 }), done: null }
const B = { id: 'a2', empId: 'e1', amount: 300, date: '2026-11-15', installments: [{ month: '2026-11', amount: 150 }, { month: '2026-12', amount: 150 }], done: null }
const C = { id: 'a3', empId: 'e2', amount: 200, date: '2026-11-02', installments: [{ month: '2026-11', amount: 200 }], done: null }

test('Abzug je Monat und Person (mehrere Vorschüsse zusammen); getilgte nach dem Abschluss nicht mehr', () => {
  assert.equal(deductionIn([A, B, C], 'e1', '2026-11'), 650)
  assert.equal(deductionIn([A, B, C], 'e1', '2027-01'), 500)
  assert.equal(deductionIn([A, B, C], 'e1', '2027-02'), 0)
  assert.deepEqual([...deductionsIn([A, B, C], '2026-11')], [['e1', 650], ['e2', 200]])
  const done = { ...A, done: { date: '2026-11-30', note: 'Endabrechnung' } }
  assert.equal(deductionIn([done], 'e1', '2026-12'), 0)
  assert.equal(deductionIn([done], 'e1', '2026-11'), 500, 'im Monat des Abschlusses noch')
})

test('Stand und Austritt: Rest nach dem Austrittsmonat für die Endabrechnung', () => {
  assert.deepEqual(advanceState(A, '2026-11'), { paid: 1500, open: 1000, next: { month: '2026-12', amount: 500 } })
  const exit = openAtExit([A, B, C], 'e1', '2026-11-20')
  assert.equal(exit.total, 1150)
  assert.deepEqual(exit.items.map((x) => [x.advance.id, x.open]), [['a1', 1000], ['a2', 150]])
  assert.equal(openAtExit([A], 'e1', '2027-03-01').total, 0)
})

test('Export Lohnprogramm: Rate als Kennzahl „vorschuss“ in Euro, ohne Stundensatz', async () => {
  const { exportLines, keyTotals } = await import('../src/core/payroll-export.js')
  const employee = { id: 'e1', name: 'Test Person', personnelNo: '17' }
  const otRows = [{ employee, wage: 14.5, total: { normal: 600 }, hours: {} }]
  const report = [{ employee, advance: deductionIn([A, B, C], 'e1', '2026-11') }]
  const lines = exportLines({ month: '2026-11', otRows, report, settings: { wageTypes: { vorschuss: '900', normal: '100' } } })
  const v = lines.find((l) => l.key === 'vorschuss')
  assert.deepEqual([v.lohnart, v.menge, v.einheit, v.satz], ['900', 650, '€', 0])
  assert.equal(lines.find((l) => l.key === 'normal').satz, 14.5)
  assert.equal(keyTotals({ otRows, report }).vorschuss, 650)
})
