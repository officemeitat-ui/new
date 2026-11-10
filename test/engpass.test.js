// Engpass-Vorschau (core/engpass.js): Bedarf aus Einsätzen gegen verfügbare Stunden, Abwesenheit, Beschäftigung, Ampel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableMinutes, capacityForecast, shortWeeks } from '../src/core/engpass.js'

const mon = '2026-11-16'
const emp = (id, h, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: h, ...extra })
const inst = (key, date, net, staff = 1, status = 'planned') => ({ key, date, net, staff, status })

test('Engpass: verfügbare Minuten ohne Abwesenheit und außerhalb der Beschäftigung', () => {
  assert.deepEqual(availableMinutes(emp('a', 40), mon, []), { min: 2400, absentDays: 0 })
  assert.deepEqual(availableMinutes(emp('a', 40), mon, [{ employeeId: 'a', from: '2026-11-17', to: '2026-11-18', type: 'Urlaub' }]), { min: 1440, absentDays: 2 })
  assert.deepEqual(availableMinutes(emp('b', 20), mon, [{ employeeId: 'a', from: '2026-11-16', to: '2026-11-20' }]), { min: 1200, absentDays: 0 }, 'fremde Abwesenheit zählt nicht')
  assert.equal(availableMinutes(emp('c', 40, { entryDate: '2026-11-19' }), mon, []).min, 960, 'Eintritt am Donnerstag: Do und Fr')
  assert.equal(availableMinutes(emp('d', 40, { exitDate: '2026-11-16' }), mon, []).min, 480, 'Austritt am Montag')
})

test('Engpass: Bedarf je Einsatz mal Personen, entfallene nicht, eingeteilt/offen, Ampel', () => {
  const employees = [emp('a', 40), emp('b', 20), emp('x', 40, { inactive: true })]
  const instances = [inst('k1', '2026-11-16', 600, 2), inst('k2', '2026-11-17', 900), inst('k3', '2026-11-18', 300, 1, 'cancelled'), inst('k4', '2026-11-23', 999)]
  const state = { assigned: (key) => ({ k1: [{}], k2: [{}, {}] })[key] || [] }
  const [w] = capacityForecast({ weeks: [{ monday: mon, instances, state }], employees, absences: [] })
  assert.equal(w.demand, 600 * 2 + 900)
  assert.equal(w.available, 2400 + 1200, 'inaktive zählen nicht')
  assert.equal(w.assigned, 600 + 900, 'je Einsatz höchstens so viele wie gebraucht')
  assert.equal(w.open, 600)
  assert.equal(w.level, 'gruen')
  assert.equal(w.planned, true)
  // mit Urlaub wird es knapp bzw. rot
  const urlaub = [{ employeeId: 'a', from: '2026-11-16', to: '2026-11-19', type: 'Urlaub' }]
  const [r] = capacityForecast({ weeks: [{ monday: mon, instances }], employees, absences: urlaub })
  assert.equal(r.available, 480 + 1200)
  assert.equal(r.level, 'rot')
  assert.equal(r.reserve, 1680 - 2100)
  assert.equal(r.absent, 1)
  assert.equal(r.planned, false, 'ohne geladene Einteilung: noch nicht eingeteilt')
  const [g] = capacityForecast({ weeks: [{ monday: mon, instances: [inst('k', mon, 3400)] }], employees, absences: [] })
  assert.equal(g.level, 'gelb', '200 min Reserve bei 3400 min Bedarf (unter 10 %)')
  assert.deepEqual(shortWeeks([r, w], '2026-11-10').map((x) => x.level), ['rot'])
  assert.deepEqual(shortWeeks([r], '2026-11-23'), [], 'vergangene Wochen nicht')
})
