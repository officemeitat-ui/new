import { test } from 'node:test'
import assert from 'node:assert/strict'

import { absenceRates, aging, complaintsByMonth, complaintsTopObjects, contribution, lastMonths, lastWeeks, materialMonths, plusHours, previousMonths, previousWeeks, revenueByObject, revenueMonths, topCustomers, trend, utilization, weekStats } from '../src/core/kpi.js'
import { PlanState } from '../src/core/plan.js'

const inst = (key, date, net, staff = 1, extra = {}) => ({ key, date, net, staff, status: 'planned', objectId: 'o1', ...extra })

test('Kennzahlen: Zeiträume und Trend', () => {
  const w = lastWeeks(4, '2026-11-04')
  assert.deepEqual(w.map((x) => x.key), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
  assert.deepEqual(previousWeeks(w).map((x) => x.key), ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'])
  const m = lastMonths(3, '2026-01-15')
  assert.deepEqual(m.map((x) => x.key), ['2025-11', '2025-12', '2026-01'])
  assert.equal(m[1].to, '2025-12-31')
  assert.deepEqual(previousMonths(m).map((x) => x.key), ['2025-08', '2025-09', '2025-10'])
  assert.deepEqual(trend(110, 100), { delta: 10, pct: 0.1, dir: 'up' })
  assert.equal(trend(0, 0).dir, 'flat')
  assert.equal(trend(5, 0).pct, null)
})

test('Kennzahlen: Stunden und Besetzung je Woche', () => {
  const weeks = lastWeeks(2, '2026-11-04')
  const insts = [inst('a', '2026-11-02', 120, 2), inst('b', '2026-11-03', 60), inst('c', '2026-10-27', 90), inst('d', '2026-11-04', 30, 1, { status: 'cancelled' })]
  const state = new PlanState(insts, { a: [{ employeeId: 'e1' }], c: [{ employeeId: 'e2' }] })
  const stamps = { x: { date: '2026-11-02', in: '2026-11-02T05:00:00.000Z', out: '2026-11-02T07:10:00.000Z', pause: 10 } }
  const [prev, cur] = weekStats({ weeks, instances: insts, state, stamps, travelByWeek: new Map([['2026-11-02', 45]]) })
  assert.deepEqual({ plan: cur.plan, staffed: cur.staffed, slots: cur.slots, filled: cur.filled, open: cur.open, ist: cur.ist, travel: cur.travel }, { plan: 300, staffed: 120, slots: 3, filled: 1, open: 2, ist: 120, travel: 45 })
  assert.equal(cur.rate, 1 / 3)
  assert.equal(prev.rate, 1)
  // nicht eingeteilte Woche: keine offenen Einsätze
  assert.equal(weekStats({ weeks, instances: insts, state, scheduled: () => false })[1].open, 0)
})

test('Kennzahlen: Auslastung je Person', () => {
  const insts = [inst('a', '2026-11-02', 600), inst('b', '2026-11-03', 600)]
  const state = new PlanState(insts, { a: [{ employeeId: 'e1' }], b: [{ employeeId: 'e1' }] })
  const list = utilization({ employees: [{ id: 'e1', weeklyHours: 20 }, { id: 'e2', weeklyHours: 10 }, { id: 'e3', weeklyHours: 0 }], instances: insts, state, from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(list.map((x) => [x.emp.id, x.contract, x.planned]), [['e1', 1200, 1200], ['e2', 600, 0]])
  assert.equal(list[0].pct, 1)
})

test('Kennzahlen: Krankenstands- und Urlaubsquote', () => {
  const months = lastMonths(1, '2026-11-10')
  const employees = [{ id: 'e1' }, { id: 'e2', exitDate: '2026-11-15' }]
  const absences = [{ employeeId: 'e1', type: 'Krankenstand', from: '2026-11-02', to: '2026-11-08' }, { employeeId: 'e2', type: 'Urlaub', from: '2026-11-09', to: '2026-11-09' }]
  const [r] = absenceRates({ months, employees, absences, holidays: new Set(['2026-11-02']) })
  // e1: 20 Werktage im November ohne den „Feiertag“ am 2.; e2 bis 15.11.: 9 Werktage
  assert.equal(r.sollDays, 20 + 9)
  assert.equal(r.sick, 4) // 3.–6.11., der 2. ist Feiertag
  assert.equal(r.vacation, 1)
  assert.equal(Math.round(r.sickRate * 1000), Math.round((4 / 29) * 1000))
})

test('Kennzahlen: Plus-Stunden nach Vollzeit und Teilzeit', () => {
  const rows = [{ employee: { type: 'Vollzeit' }, saldo: 120 }, { employee: { type: 'Teilzeit' }, saldo: 90 }, { employee: { type: 'Teilzeit' }, saldo: -60 }, { employee: { type: 'Geringfügig' }, saldo: 30 }]
  assert.deepEqual(plusHours(rows), { overtime: 120, extra: 120, total: 240 })
})

test('Kennzahlen: Reklamationen je Monat und Objekt', () => {
  const items = [
    { received: '2026-10-03', objectId: 'o1', status: 'erledigt' },
    { received: '2026-11-03', objectId: 'o1', status: 'offen' },
    { received: '2026-11-05', objectId: 'o2', status: 'arbeit' },
    { received: '2026-11-06', objectId: 'o1', status: 'erledigt' },
  ]
  const months = lastMonths(2, '2026-11-10')
  assert.deepEqual(complaintsByMonth(items, months).map((x) => [x.key, x.count, x.open]), [['2026-10', 1, 0], ['2026-11', 3, 2]])
  assert.deepEqual(complaintsTopObjects(items, { from: '2026-11-01', to: '2026-11-30' }), [{ objectId: 'o1', count: 2, open: 1 }, { objectId: 'o2', count: 1, open: 1 }])
})

const invoice = (id, number, date, net, extra = {}) => ({ id, kind: 'rechnung', number, date, dueDate: extra.dueDate || date, customerId: extra.customerId || 'c1', objectId: extra.objectId || 'o1', recipient: { name: extra.name || 'Kunde Eins' }, lines: [{ text: 'Reinigung', qty: 1, unit: 'Monat', price: net, vat: 20 }], ...extra })

test('Kennzahlen: Umsatz, offene Posten nach Fälligkeit, Top-Kunden', () => {
  const doc = {
    settings: {},
    documents: [
      invoice('i1', 'RE-1', '2026-09-30', 1000, { dueDate: '2026-10-14' }),
      invoice('i2', 'RE-2', '2026-10-31', 500, { dueDate: '2026-11-14', customerId: 'c2', name: 'Kunde Zwei', objectId: 'o2' }),
      invoice('i3', 'RE-3', '2026-11-02', 200, { dueDate: '2026-11-16' }),
      invoice('i4', null, '2026-11-03', 999), // Entwurf zählt nicht
      { id: 's1', kind: 'storno', number: 'ST-1', refId: 'i3', date: '2026-11-05', lines: [{ text: 'Storno', qty: 1, price: -200, vat: 20 }], customerId: 'c1', recipient: { name: 'Kunde Eins' }, objectId: 'o1' },
    ],
  }
  const months = lastMonths(3, '2026-11-20')
  assert.deepEqual(revenueMonths(doc, months).map((x) => [x.key, x.net]), [['2026-09', 1000], ['2026-10', 500], ['2026-11', 0]])
  const ag = aging(doc, '2026-11-20')
  // i1: 37 Tage überfällig (1.200 brutto), i2: 6 Tage (600), i3 storniert
  assert.deepEqual(ag.map((x) => [x.id, x.amount, x.count]), [['nicht', 0, 0], ['d30', 600, 1], ['d60', 1200, 1], ['d60plus', 0, 0]])
  assert.deepEqual(topCustomers(doc, { from: '2026-09-01', to: '2026-11-30' }).map((x) => [x.name, x.net]), [['Kunde Eins', 1000], ['Kunde Zwei', 500]])
  assert.deepEqual([...revenueByObject(doc, { from: '2026-10-01', to: '2026-11-30' })], [['o2', 500], ['o1', 0]])
})

test('Kennzahlen: Material und Deckungsbeitrag', () => {
  const mat = {
    moves: [
      { kind: 'ausgabe', date: '2026-11-03', qty: -2, price: 10, objectId: 'o1' },
      { kind: 'eingang', date: '2026-11-03', qty: 20, price: 10 },
      { kind: 'ausgabe', date: '2026-10-03', qty: -1, price: 5, objectId: 'o2' },
    ],
    orders: [{ status: 'bestellt', orderedAt: '2026-11-02T08:00:00Z', lines: [{ qty: 10, price: 3 }] }, { status: 'entwurf', createdAt: '2026-11-02', lines: [{ qty: 100, price: 1 }] }],
  }
  assert.deepEqual(materialMonths(mat, lastMonths(2, '2026-11-10')).map((x) => [x.key, x.used, x.ordered]), [['2026-10', 5, 0], ['2026-11', 20, 30]])
  const insts = [inst('a', '2026-11-02', 600, 1, { objectId: 'o1' }), inst('b', '2026-11-03', 120, 1, { objectId: 'o3' })]
  const state = new PlanState(insts, { a: [{ employeeId: 'e1' }], b: [{ employeeId: 'e1' }] })
  const rows = contribution({ revenue: new Map([['o1', 500]]), material: new Map([['o1', 20]]), instances: insts, state, from: '2026-11-01', to: '2026-11-30', costPerHour: 30 })
  assert.deepEqual(rows, [{ objectId: 'o1', revenue: 500, labor: 300, material: 20, margin: 180, rate: 0.36 }])
})
