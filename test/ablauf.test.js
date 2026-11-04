// Befunde aus den Ende-zu-Ende-Abläufen (.pruefung/ablauf_*.mjs), als kleine Prüfungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess } from '../src/core/access.js'
import { dayIndex } from '../src/core/dates.js'
import { PlanState } from '../src/core/plan.js'
import { pickTeam } from '../src/core/scheduler.js'
import { stampRows } from '../src/core/timeclock.js'
import { viennaTime } from '../src/core/weather.js'
import { createDemoData } from '../src/data/demo.js'
import { app, compute, computeRange, seesAccount, visibleAbsences } from '../src/ui/context.js'

const MON = '2026-11-02'

function withRole(role) {
  app.data = createDemoData(MON)
  app.data.absences.push({ id: 'k1', employeeId: 'e3', type: 'Krankenstand', from: MON, to: '2026-11-04', note: 'Anruf 07:15' })
  app.ui.monday = MON
  app.access = role ? resolveAccess({ preview: role }) : null
  app.dataVersion = (app.dataVersion || 0) + 1
}

test('Wochenplanung: Rolle ohne personal/ (Vorschau) rechnet mit „Abwesend“ wie im Betrieb', () => {
  withRole('objektleitung')
  const c = compute(MON)
  const elif = c.ctx.employeesById.get('e3')
  const day = c.timesheet(elif).days[0]
  assert.equal(day.absence.type, 'Abwesend')
  assert.equal(day.absence.note, undefined, 'keine Notiz')
  assert.ok(!JSON.stringify(c.timesheet(elif)).includes('Krankenstand'))
  assert.ok(visibleAbsences().every((a) => a.type === 'Abwesend' && !a.note))
  assert.ok(computeRange(MON, '2026-11-04').ctx.absencesByEmployee.get('e3').every((a) => a.type === 'Abwesend'))
  // die gespeicherten Daten bleiben vollständig (das Büro sieht sie nach der Vorschau wieder)
  assert.equal(app.data.absences.find((a) => a.id === 'k1').type, 'Krankenstand')
})

test('Wochenplanung: Büro sieht den Grund; Rollenwechsel rechnet neu (kein alter Stand aus dem Zwischenspeicher)', () => {
  withRole('objektleitung')
  assert.equal(compute(MON).timesheet(app.data.employees.find((e) => e.id === 'e3')).days[0].absence.type, 'Abwesend')
  app.access = resolveAccess({ preview: null })
  assert.equal(compute(MON).timesheet(app.data.employees.find((e) => e.id === 'e3')).days[0].absence.type, 'Krankenstand')
  assert.equal(visibleAbsences().find((a) => a.id === 'k1').type, 'Krankenstand')
})

test('Wochenplanung: Zeitkonto nur für Rollen, die lohn/zeitkonto.json lesen (sonst stünde ±0 da)', () => {
  withRole('objektleitung')
  assert.equal(seesAccount(), false)
  withRole('lesen')
  assert.equal(seesAccount(), false)
  withRole('lohnverrechnung')
  assert.equal(seesAccount(), true)
  withRole(null)
  assert.equal(seesAccount(), true)
})

test('Schneenacht: Winterdienst-Team – zuerst, wer ohne Verstoß kann (Ruhezeit nach dem Abenddienst)', () => {
  withRole(null)
  app.data.absences = app.data.absences.filter((a) => a.id !== 'k1')
  const WED = '2026-11-04'
  app.data.winter = { [`${WED}|o5`]: { reason: 'Neuschnee', by: 'Test', at: '2026-11-03T19:30:00Z' } }
  app.data.assignments['2026-11-03|t10'] = [{ employeeId: 'e3' }] // Ordination Di 19:30–21:30
  app.dataVersion++
  const r = computeRange(WED, WED)
  const inst = r.state.instByKey.get(`${WED}|winter-o5`)
  assert.equal(inst.startTime, '05:30')
  // Elif putzt Di bis 21:30 die Praxis: 05:30 wären nur 8 h Ruhezeit → Irina (2. im Team)
  assert.deepEqual(pickTeam(r.ctx, r.state, inst, ['e3', 'e7'], 1), ['e7'])
  // niemand ohne Verstoß: Reihenfolge bleibt, das Büro sieht es im Prüfbericht
  assert.deepEqual(pickTeam(r.ctx, r.state, inst, ['e3'], 1), ['e3'])
  assert.deepEqual(pickTeam(r.ctx, r.state, inst, ['e3', 'e7'], 2), ['e7', 'e3'])
})

test('Monatsende: Zeiterfassung erkennt „länger als geplant“ (sonst käme die Mehrstunde nie ins Zeitkonto)', () => {
  const D = '2026-11-24'
  const min = (hm) => dayIndex(D) * 1440 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))
  const iso = (hm) => new Date(viennaTime(D, hm)).toISOString()
  const inst = (k) => ({ key: `${D}|${k}`, date: D, objectId: 'o6', start: min('10:00'), end: min('16:30'), status: 'normal', staff: 1 })
  const instances = ['a', 'b', 'c'].map(inst)
  const state = new PlanState(instances, Object.fromEntries(instances.map((i) => [i.key, [{ employeeId: 'e2' }]])))
  const stamps = {
    s1: { id: 's1', empId: 'e2', instKey: `${D}|a`, date: D, objectId: 'o6', in: iso('10:00'), out: iso('17:30') },
    s2: { id: 's2', empId: 'e2', instKey: `${D}|b`, date: D, objectId: 'o6', in: iso('09:40'), out: iso('16:30') },
    s3: { id: 's3', empId: 'e2', instKey: `${D}|c`, date: D, objectId: 'o6', in: iso('09:55'), out: iso('16:35') },
  }
  const rows = stampRows({ instances, state, stamps, from: D, to: D, users: new Set(['e2']), now: min('23:00') })
  const by = (k) => rows.find((r) => r.inst.key === `${D}|${k}`)
  assert.deepEqual([by('a').status, by('a').over, by('a').minutes], ['laenger', 60, 450])
  assert.deepEqual([by('b').status, by('b').over], ['laenger', 20], 'früher gekommen')
  assert.deepEqual([by('c').status, by('c').over], ['ok', 10], 'innerhalb der Toleranz')
})
