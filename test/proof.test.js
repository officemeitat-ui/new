import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { objectsWithWork, proofFor, proofMailText } from '../src/core/proof.js'
import { createContext } from '../src/core/rules.js'
import { proofDocument, proofPdfName } from '../src/export/proof-pdf.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, name) => ({ id, name, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id === 'g' ? 'Glasreinigung' : 'Unterhaltsreinigung', recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })

function setup() {
  // Dezember 2026: Di 8.12. Feiertag (Mariä Empfängnis), Glasreinigung entfällt an Feiertagen
  const data = { employees: [emp('x', 'Ana Popescu'), emp('y', 'Bogdan Ionescu')], objects: [{ id: 'o1', name: 'Kanzlei' }, { id: 'o2', name: 'Andere' }], tasks: [task('u', [1, 2], '06:00', '08:00'), task('g', [2], '09:00', '10:00', { holidayRule: 'entfaellt', category: 'sonder' })], absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-11-23', '2026-12-31')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-23', '2026-12-31', holidays, ctx.rules)
  const asg = {}
  for (const i of instances) if (i.status !== 'cancelled' && i.date >= '2026-12-01' && i.date !== '2026-12-07') asg[i.key] = [{ employeeId: i.taskId === 'g' ? 'y' : 'x' }]
  const state = new PlanState(instances, asg)
  return { ctx, instances, state }
}

test('Leistungsnachweis: erbracht, mit Zeiterfassung, entfallen (Feiertag), nicht besetzt, geplant', () => {
  const { ctx, instances, state } = setup()
  const stamps = {
    '2026-12-01|za': { id: 'a', date: '2026-12-01', empId: 'x', objectId: 'o1', instKey: '2026-12-01|u', in: '2026-12-01T04:58:00.000Z', out: '2026-12-01T07:03:00.000Z' },
    '2026-12-14|zb': { id: 'b', date: '2026-12-14', empId: 'x', objectId: 'o1', instKey: '', in: '2026-12-14T05:01:00.000Z', out: null },
    '2026-12-14|zc': { id: 'c', date: '2026-12-14', empId: 'x', objectId: 'o2', instKey: '', in: '2026-12-14T05:01:00.000Z', out: null },
  }
  const p = proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances, state, stamps, employeesById: ctx.employeesById, today: '2026-12-15', names: 'vorname' })
  const byDate = (d, label = 'Unterhaltsreinigung') => p.rows.find((r) => r.date === d && r.label === label)
  assert.equal(byDate('2026-12-01').status, 'bestaetigt')
  assert.deepEqual(byDate('2026-12-01').ist, [{ in: '05:58', out: '08:03', minutes: 125 }], 'Wiener Zeit')
  assert.deepEqual(byDate('2026-12-01').persons, ['Ana'], 'nur Vornamen')
  assert.equal(byDate('2026-12-07').status, 'offen', 'niemand eingeteilt')
  assert.equal(byDate('2026-12-08').status, 'erbracht', 'Unterhaltsreinigung findet am Feiertag statt')
  assert.equal(byDate('2026-12-08', 'Glasreinigung').status, 'entfallen')
  assert.match(byDate('2026-12-08', 'Glasreinigung').reason, /^Feiertag \(Mariä Empfängnis\)$/)
  assert.equal(byDate('2026-12-14').status, 'bestaetigt', 'Stempelung ohne Einsatz-Kennung über Tag und Person')
  assert.deepEqual(byDate('2026-12-14').ist, [{ in: '06:01', out: null, minutes: null }])
  assert.equal(byDate('2026-12-21').status, 'geplant')
  // heute (15.12., Di keine Unterhaltsreinigung → 14.12. Mo) um 07:00 Wiener Zeit: der Einsatz 06:00–08:00 läuft noch
  const now = proofFor({ objectId: 'o1', from: '2026-12-14', to: '2026-12-14', instances, state, stamps: {}, employeesById: ctx.employeesById, today: '2026-12-14', now: instances.find((i) => i.date === '2026-12-14').start + 60 })
  assert.equal(now.rows[0].status, 'geplant', 'läuft noch: nicht als erbracht')
  const t = p.totals
  assert.equal(t.cancelled, 1)
  assert.equal(t.open, 1)
  assert.equal(t.confirmed, 2)
  assert.ok(t.planned > 0 && t.done > 0 && t.count === t.done + t.open + t.planned)
  assert.equal(t.planMinutes, t.done === 0 ? 0 : p.rows.filter((r) => ['erbracht', 'bestaetigt'].includes(r.status)).reduce((s, r) => s + r.planMinutes, 0))
  assert.equal(t.special, p.rows.filter((r) => r.category === 'sonder' && r.status !== 'entfallen').length)
  assert.deepEqual(proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances, state, stamps, employeesById: ctx.employeesById, today: '2026-12-15' }).rows[0].persons, [], 'ohne Namen')
  assert.deepEqual([...objectsWithWork(instances, { from: '2026-12-01', to: '2026-12-31' })], ['o1'])
})

test('Leistungsnachweis: E-Mail-Text und PDF', () => {
  const { ctx, instances, state } = setup()
  const p = proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances, state, employeesById: ctx.employeesById, today: '2027-01-05', names: 'voll' })
  const text = proofMailText({ objectName: 'Kanzlei', monthLabel: 'Dezember 2026', totals: p.totals, company: 'Cleanos', sender: 'Büro' })
  assert.match(text, /^Sehr geehrte Damen und Herren,\n\nanbei der Leistungsnachweis für Kanzlei, Dezember 2026: \d+ Einsätze erbracht, 1 entfallen\./)
  assert.ok(!/\n\n\n/.test(text))
  const doc = proofDocument({ object: { name: 'Kanzlei', address: 'Wien' }, monthLabel: 'Dezember 2026', from: '2026-12-01', to: '2026-12-31', proof: p, winter: [{ date: '2026-12-02', time: '05:30', geraeumt: true, gestreut: true, mittel: 'Splitt' }], withNames: true, brand: { name: 'Cleanos' } })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Leistungsnachweis/)
  assert.match(json, /Kanzlei · Dezember 2026/)
  assert.match(json, /Feiertag \(Mariä Empfängnis\)/)
  assert.match(json, /Ana Popescu/)
  assert.match(json, /geräumt, gestreut \(Splitt\)/)
  assert.match(json, /Unterschrift Auftraggeber/)
  assert.ok(!/erfasst im Objekt/.test(json), 'ohne Stempelungen keine Spalte')
  assert.equal(proofPdfName('Kanzlei Süd', '2026-12'), 'Leistungsnachweis_2026-12_Kanzlei-Süd.pdf')
})
