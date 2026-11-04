// Befunde aus den Ende-zu-Ende-Abläufen (.pruefung/ablauf_*.mjs), als kleine Prüfungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess } from '../src/core/access.js'
import { pickTeam } from '../src/core/scheduler.js'
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
