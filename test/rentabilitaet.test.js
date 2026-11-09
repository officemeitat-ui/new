// Rentabilität je Objekt: Stunden (gestempelt, sonst Plan), Kosten, Ampel, nötiger Umsatz für das Ziel, Zeiträume
// (core/rentabilitaet.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distributeUnassigned, externalByObject, hoursByObject, rentability, rentSettings, rentSpan, revenueWithoutObject } from '../src/core/rentabilitaet.js'

const inst = (key, objectId, date, net, staff = 1, status = 'normal') => ({ key, objectId, date, net, staff, status })
const stateOf = (asg) => ({ assigned: (k) => (asg[k] || []).map((employeeId) => ({ employeeId })) })
const doc = (id, objectId, date, net, kind = 'rechnung') => ({ id, kind, number: `${kind === 'storno' ? 'ST' : 'RE'}-${id}`, objectId, date, total: { net, vat: 0, gross: net } })

test('Zeiträume und Einstellungen', () => {
  assert.deepEqual(rentSpan('6', '2026-11-09'), { kind: '6', label: 'letzte 6 Monate', from: '2026-05-01', to: '2026-10-31', prev: { from: '2025-11-01', to: '2026-04-30' } })
  assert.equal(rentSpan('3', '2026-01-15').from, '2025-10-01')
  assert.deepEqual(rentSpan('vorjahr', '2026-11-09').prev, { from: '2024-01-01', to: '2024-12-31' })
  assert.deepEqual(rentSettings({}), { target: 25, warn: 10 })
  assert.deepEqual(rentSettings({ target: 95, warn: 99 }), { target: 80, warn: 80 })
})

test('Stunden je Objekt: gestempelt, sonst Plan; Stempelung ohne Plan zählt dazu, offene (ohne Gehen) nicht', () => {
  const instances = [inst('2026-10-05|a', 'o1', '2026-10-05', 120, 2), inst('2026-10-06|a', 'o1', '2026-10-06', 120), inst('2026-10-07|b', 'o2', '2026-10-07', 60, 1, 'cancelled')]
  const state = stateOf({ '2026-10-05|a': ['e1', 'e2', 'e3'], '2026-10-06|a': ['e1'], '2026-10-07|b': ['e1'] })
  const stamps = {
    s1: { date: '2026-10-05', empId: 'e1', objectId: 'o1', instKey: '2026-10-05|a', in: '2026-10-05T06:00:00Z', out: '2026-10-05T08:30:00Z' },
    s2: { date: '2026-10-06', empId: 'e1', objectId: 'o1', instKey: '', in: '2026-10-06T06:00:00Z', out: null },
    s3: { date: '2026-10-08', empId: 'e9', objectId: 'o1', instKey: '', in: '2026-10-08T06:00:00Z', out: '2026-10-08T07:00:00Z' },
  }
  const h = hoursByObject({ instances, state, stamps, from: '2026-10-01', to: '2026-10-31' }).get('o1')
  // geplant: 2 × 120 (staff 2, drei eingeteilt) + 120; genutzt: e1 gestempelt 150, e2 Plan 120, 06.10. Plan 120 (offen), dazu 60 ohne Plan
  assert.deepEqual(h, { planned: 360, used: 450, stamped: 210, pairs: 3, stampedPairs: 1 })
  assert.equal(hoursByObject({ instances, state, stamps, from: '2026-10-01', to: '2026-10-31' }).has('o2'), false)
})

test('Rentabilität: Ampel, nötiger Umsatz, Umsatz ohne Objekt, Fremdleistungen, Vertrag, Reihenfolge', () => {
  const fak = { settings: {}, documents: [doc('1', 'o1', '2026-10-10', 1000), doc('2', 'o2', '2026-10-10', 1000), doc('3', 'o3', '2026-10-10', 1000), doc('4', null, '2026-10-10', 500), doc('5', 'o1', '2026-10-20', -200, 'storno'), doc('6', 'o1', '2026-11-02', 999)] }
  const einkauf = { invoices: [{ id: 'i1', objectId: 'o2', date: '2026-10-03', groups: [{ net: 300, vat: 60, rate: 20 }] }, { id: 'i2', objectId: 'o2', date: '2026-10-04', cancelled: true, groups: [{ net: 999 }] }] }
  const material = { moves: [{ kind: 'ausgabe', objectId: 'o3', date: '2026-10-11', qty: -10, price: 5 }] }
  const hours = new Map([
    ['o1', { planned: 1200, used: 1200, stamped: 0, pairs: 10, stampedPairs: 0 }], // 20 h × 30 € = 600
    ['o2', { planned: 600, used: 600, stamped: 600, pairs: 5, stampedPairs: 5 }], // 300 + 300 Fremd = 600
    ['o3', { planned: 600, used: 600, stamped: 0, pairs: 5, stampedPairs: 0 }], // 300 + 50 Material
    ['o4', { planned: 120, used: 120, stamped: 0, pairs: 1, stampedPairs: 0 }], // nur Kosten
  ])
  const objects = [{ id: 'o1', name: 'Büro A' }, { id: 'o2', name: 'Halle B' }, { id: 'o3', name: 'Praxis C' }, { id: 'o4', name: 'Neu D' }]
  const r = rentability({ objects, fak, einkauf, material, hours, from: '2026-10-01', to: '2026-10-31', costPerHour: 30, contracts: [{ id: 'v1', objectIds: ['o1'], status: 'laeuft' }], prevRates: new Map([['o3', 0.5]]) })
  const by = Object.fromEntries(r.rows.map((x) => [x.objectId, x]))
  // o1: Umsatz 1000 − 200 Storno = 800, Kosten 600 → 25 % = Ziel
  assert.equal(by.o1.revenue, 800)
  assert.equal(by.o1.level, 'gut')
  assert.equal(by.o1.contractId, 'v1')
  // o2: 1000 − 600 → 40 %
  assert.equal(by.o2.external, 300)
  assert.equal(by.o2.level, 'gut')
  // o3: 1000 − 350 → 65 %, Vorperiode 50 %
  assert.equal(by.o3.material, 50)
  assert.equal(by.o3.prevRate, 0.5)
  // o4: Kosten ohne Umsatz
  assert.equal(by.o4.level, 'ohne')
  assert.equal(by.o4.cost, 60)
  assert.equal(r.unassigned, 500)
  assert.equal(r.totals.revenue, 2800)
  // Ziel 50 %: o1 kritisch? 25 % ≥ warn 10 → knapp; nötiger Umsatz 600 / 0,5 = 1200 → +50 %
  const r2 = rentability({ objects, fak, einkauf, material, hours, from: '2026-10-01', to: '2026-10-31', costPerHour: 30, settings: { target: 50, warn: 30 } })
  const o1 = r2.rows.find((x) => x.objectId === 'o1')
  assert.equal(o1.level, 'kritisch')
  assert.equal(o1.needed, 1200)
  assert.ok(Math.abs(o1.raise - 0.5) < 1e-9)
  assert.deepEqual(r2.rows.map((x) => x.objectId), ['o1', 'o4', 'o2', 'o3'])
  assert.equal(r2.totals.below, 3)
})

test('Fremdleistungen und Umsatz ohne Objekt im Zeitraum', () => {
  assert.deepEqual([...externalByObject({ invoices: [{ objectId: 'o1', date: '2026-09-30', groups: [{ net: 10 }] }, { objectId: 'o1', date: '2026-10-01', groups: [{ net: 20 }, { net: 5 }] }] }, { from: '2026-10-01', to: '2026-10-31' })], [['o1', 25]])
  assert.equal(revenueWithoutObject({ documents: [doc('a', null, '2026-10-02', 100), doc('b', null, '2026-10-03', -40, 'storno'), { id: 'c', kind: 'rechnung', date: '2026-10-04', total: { net: 77 } }] }, { from: '2026-10-01', to: '2026-10-31' }), 60)
})

test('Rechnung ohne Objekt: auf die Objekte des Kunden nach Stunden verteilt, sonst zu gleichen Teilen; Rest ohne Kunde', () => {
  const fak = {
    customers: [{ id: 'k1', objectIds: ['o1', 'o2'] }, { id: 'k2', objectIds: ['o3', 'o4'] }, { id: 'k3', objectIds: [] }],
    documents: [{ ...doc('1', null, '2026-10-05', 900), customerId: 'k1' }, { ...doc('2', null, '2026-10-06', 100), customerId: 'k2' }, { ...doc('3', null, '2026-10-07', 70), customerId: 'k3' }, doc('4', null, '2026-10-08', 30)],
  }
  const hours = new Map([['o1', { used: 120 }], ['o2', { used: 60 }]])
  const d = distributeUnassigned(fak, { from: '2026-10-01', to: '2026-10-31' }, hours)
  assert.deepEqual([...d.byObject].sort(), [['o1', 600], ['o2', 300], ['o3', 50], ['o4', 50]])
  assert.equal(d.rest, 100)
  const r = rentability({ objects: [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }], fak, hours: new Map([['o1', { planned: 120, used: 120, stamped: 0, pairs: 1, stampedPairs: 0 }], ['o2', { planned: 60, used: 60, stamped: 0, pairs: 1, stampedPairs: 0 }]]), from: '2026-10-01', to: '2026-10-31', costPerHour: 60 })
  const a = r.rows.find((x) => x.objectId === 'o1')
  assert.equal(a.revenue, 600)
  assert.equal(a.distributed, 600)
  assert.equal(r.totals.distributed, 900)
  // Objekte, die es nicht mehr gibt (o3, o4), bekommen nichts: der Anteil von k2 bleibt als Rest
  assert.equal(r.unassigned, 200)
})
