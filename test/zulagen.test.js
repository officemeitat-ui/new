// Zulagen je Tätigkeit (core/zulagen.js): Prüfung, wofür sie gilt (Leistung, Objekt, Stichwort, nur Sonderleistungen),
// Rechnung je Stunde bzw. je Einsatz aus dem Wochenzettel, Zeilen im Export fürs Lohnprogramm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowanceProblem, allowancesFromDays, allowancesTotal, matchesAllowance } from '../src/core/zulagen.js'
import { exportLines, exportProblems } from '../src/core/payroll-export.js'

const inst = (taskId, objectId, label, category = 'reinigung') => ({ taskId, objectId, label, category })
const line = (i, minutes, kind = 'work') => ({ kind, inst: i, hours: minutes })
const days = [
  { date: '2026-11-30', lines: [line(inst('t1', 'o1', 'Unterhaltsreinigung'), 120)] },
  { date: '2026-12-01', lines: [line(inst('t2', 'o1', 'Glasreinigung außen'), 150), line(inst('t3', 'o2', 'Grundreinigung Küche', 'sonder'), 240)] },
  { date: '2026-12-02', lines: [line(inst('t2', 'o1', 'Glasreinigung außen'), 90), line(inst('t9', 'o9', 'Urlaub'), 480, 'credit')] },
]
const glas = { id: 'z1', name: 'Erschwerniszulage Glas außen', wageType: '310', mode: 'stunde', rate: '1,20', keyword: 'glas', taskIds: [], objectIds: [], active: true }
const schmutz = { id: 'z2', name: 'Schmutzzulage Grundreinigung', wageType: '', mode: 'einsatz', rate: 5, onlySpecial: true, taskIds: [], objectIds: [], active: true }
const objekt = { id: 'z3', name: 'Objektzulage o1', wageType: '320', mode: 'einsatz', rate: 2, objectIds: ['o1'], taskIds: [], active: false }

test('Prüfung und wofür die Zulage gilt', () => {
  assert.equal(allowanceProblem(glas), '')
  assert.match(allowanceProblem({ ...glas, name: '' }), /Namen/)
  assert.match(allowanceProblem({ ...glas, rate: 0 }), /Betrag/)
  assert.match(allowanceProblem({ ...glas, keyword: '' }), /wofür/)
  assert.equal(matchesAllowance(glas, inst('t2', 'o1', 'Glasreinigung außen')), true)
  assert.equal(matchesAllowance(glas, inst('t1', 'o1', 'Unterhaltsreinigung')), false)
  assert.equal(matchesAllowance({ ...glas, keyword: '', taskIds: ['t1'] }, inst('t1', 'o1', 'x')), true)
  assert.equal(matchesAllowance(schmutz, inst('t3', 'o2', 'Grundreinigung', 'sonder')), true)
  assert.equal(matchesAllowance(schmutz, inst('t1', 'o1', 'Grundreinigung')), false)
  assert.equal(matchesAllowance({ ...schmutz, keyword: 'küche' }, inst('t3', 'o2', 'Grundreinigung Küche', 'sonder')), true)
  assert.equal(matchesAllowance(objekt, inst('t1', 'o1', 'x')), false, 'nicht aktiv')
})

test('Rechnung aus dem Wochenzettel: je Stunde, je Einsatz, nur gearbeitete Einsätze im Monat', () => {
  const list = allowancesFromDays(days, [glas, schmutz, objekt], { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual(list.map((z) => [z.id, z.minutes, z.count, z.menge, z.einheit, z.rate, z.amount]), [
    ['z1', 240, 2, 4, 'h', 1.2, 4.8],
    ['z2', 240, 1, 1, 'Stk', 5, 5],
  ])
  assert.equal(allowancesTotal(list), 9.8)
  assert.deepEqual(allowancesFromDays(days, [glas], { from: '2026-11-01', to: '2026-11-30' }), [])
})

test('Export fürs Lohnprogramm: je Zulage eine Zeile mit ihrer Lohnart und dem Satz; ohne Lohnart ein Hinweis', () => {
  const employee = { id: 'e1', name: 'Test Person', personnelNo: '17' }
  const allowances = allowancesFromDays(days, [glas, schmutz], { from: '2026-12-01', to: '2026-12-31' })
  const lines = exportLines({ month: '2026-12', otRows: [{ employee, wage: 14, total: {}, hours: {} }], report: [{ employee, allowances }], settings: {} })
  assert.deepEqual(lines.map((l) => [l.key, l.lohnart, l.menge, l.einheit, l.satz, l.text]), [['zulage:z1', '310', 4, 'h', 1.2, 'Erschwerniszulage Glas außen']])
  const p = exportProblems({ lines, totals: {}, settings: {}, allowances })
  assert.ok(p.some((x) => /Zulagen ohne Lohnart.*Schmutzzulage Grundreinigung/.test(x)), p.join(' | '))
})
