// Fuhrparkkosten je Fahrzeug (core/fuhrparkkosten.js): Werkstatt, Eingangsrechnungen mit Fahrzeug, km aus dem
// Fahrtenbuch oder den km-Ständen, Kosten je km, Kennzeichen im Belegtext.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kmFromLog, unassignedVehicleInvoices, vehicleCosts, vehicleCostsCsv, vehicleFromText } from '../src/core/fuhrparkkosten.js'

const vehicles = [
  { id: 'v1', plate: 'S-284 KL', label: 'VW Caddy', kmLog: [{ date: '2025-12-01', km: 30000 }, { date: '2026-06-30', km: 38000 }] },
  { id: 'v2', plate: 'S-511 TR', label: 'Renault Trafic', kmLog: [{ date: '2025-12-20', km: 10000 }, { date: '2026-03-01', km: 12500 }, { date: '2026-12-31', km: 20000 }] },
]
const changes = [
  { id: 'c1', vehicleId: 'v1', status: 'erledigt', date: '2026-04-20', doneAt: '2026-04-21T10:00:00Z', cost: 180, kind: 'reifen' },
  { id: 'c2', vehicleId: 'v1', status: 'geplant', date: '2026-10-20', cost: 500 },
  { id: 'c3', vehicleId: 'v2', status: 'erledigt', date: '2025-11-02', cost: 300, kind: 'werkstatt' },
]
const inv = (id, vehicleId, date, n, extra = {}) => ({ id, no: `ER-${id}`, vehicleId, date, category: 'kfz', supplier: { name: 'Tankstelle' }, groups: [{ rate: 20, net: n, vat: n * 0.2 }], ...extra })
const invoices = [inv('i1', 'v1', '2026-02-01', 100), inv('i2', 'v1', '2026-03-01', 50, { category: 'versicherung' }), inv('i3', 'v1', '2026-03-05', 999, { cancelled: { at: 'x' } }), inv('i4', '', '2026-03-06', 60), inv('i5', 'v2', '2027-01-02', 70)]
const trips = [
  { id: 't1', vehicleId: 'v1', date: '2026-02-02', km: 400 },
  { id: 't2', vehicleId: 'v1', date: '2026-02-03', km: 600 },
  { id: 't3', vehicleId: 'v1', date: '2026-02-04', km: 999, cancelled: { reason: 'x' } },
  { id: 't4', vehicleId: 'v1', date: '2026-02-05', suggestion: 'v1|2026-02-05', dismissed: { at: 'x' } },
]
const categories = [{ id: 'kfz', name: 'Fahrzeuge (Treibstoff, Service)' }, { id: 'versicherung', name: 'Versicherungen' }]

test('Fuhrparkkosten: Werkstatt, Rechnungen je Kategorie, km aus dem Fahrtenbuch, Kosten je km', () => {
  const r = vehicleCosts({ vehicles, changes, invoices, trips, categories, from: '2026-01-01', to: '2026-12-31' })
  const v1 = r.rows.find((x) => x.vehicleId === 'v1')
  assert.deepEqual([v1.workshop, v1.invoices, v1.total, v1.km, v1.kmSource, v1.perKm], [180, 150, 330, 1000, 'fahrtenbuch', 0.33])
  assert.deepEqual(v1.byCategory.map((c) => [c.name, c.net]), [['Fahrzeuge (Treibstoff, Service)', 100], ['Versicherungen', 50]])
  assert.deepEqual(v1.items.map((x) => x.date), ['2026-02-01', '2026-03-01', '2026-04-21'])
  // v2: ohne Fahrtenbuch → km aus den km-Ständen (letzter Stand vor dem Jahr bis zum letzten im Jahr)
  const v2 = r.rows.find((x) => x.vehicleId === 'v2')
  assert.deepEqual([v2.total, v2.km, v2.kmSource, v2.perKm], [0, 10000, 'km-stand', 0])
  assert.deepEqual([r.totals.total, r.totals.km], [330, 11000])
  assert.equal(r.rows[0].vehicleId, 'v1', 'teuerstes zuerst')
  // ohne Recht auf Einkauf: nur Werkstatt
  const ohne = vehicleCosts({ vehicles, changes, invoices: null, trips, from: '2026-01-01', to: '2026-12-31' })
  assert.equal(ohne.withInvoices, false)
  assert.equal(ohne.rows.find((x) => x.vehicleId === 'v1').total, 180)
})

test('Fuhrparkkosten: km aus den km-Ständen, Rechnungen ohne Fahrzeug, Kennzeichen im Text, CSV', () => {
  assert.equal(kmFromLog(vehicles[0], '2026-01-01', '2026-12-31'), 8000)
  assert.equal(kmFromLog(vehicles[1], '2026-01-01', '2026-06-30'), 2500)
  assert.equal(kmFromLog({ kmLog: [] }, '2026-01-01', '2026-12-31'), 0)
  assert.deepEqual(unassignedVehicleInvoices(invoices, { from: '2026-01-01', to: '2026-12-31' }).map((x) => x.id), ['i4'])
  assert.equal(vehicleFromText('Tankbeleg Kennz.: S 284KL Diesel 45,2 l', vehicles)?.id, 'v1')
  assert.equal(vehicleFromText('Diesel 45,2 l', vehicles), null)
  const csv = vehicleCostsCsv(vehicleCosts({ vehicles, changes, invoices, trips, categories, from: '2026-01-01', to: '2026-12-31' }))
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines[0], '﻿Kennzeichen;Fahrzeug;Werkstatt netto;Rechnungen netto;Summe netto;km;km laut;Kosten je km')
  assert.equal(lines[1], 'S-284 KL;VW Caddy;180;150;330;1000;Fahrtenbuch;0,33')
})
