// Befunde aus dem Rundgang durch alle Ansichten (Büro am PC, Objektleitung am Handy).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/ui/context.js'
import { weekSteps } from '../src/ui/flow.js'

function week({ errors = 0, warnings = 0 } = {}) {
  app.data = { assignments: {}, published: {} }
  const issues = Array.from({ length: errors }, () => ({ severity: 'error', code: 'REST' }))
  return { week: [], monday: '2026-11-09', sunday: '2026-11-15', state: { count: () => 0 }, validation: { issues, counts: { error: errors, warning: warnings } }, published: null, ctx: { employees: [] } }
}

test('Wochen-Ablauf: „1 Verstoß“ und „1 Warnung“ in der Einzahl', () => {
  const info = (c) => weekSteps(c).find((s) => s.id === 'check').info
  assert.equal(info(week({ errors: 1 })), '1 Verstoß')
  assert.equal(info(week({ errors: 3 })), '3 Verstöße')
  assert.equal(info(week({ warnings: 1 })), '1 Warnung')
  assert.equal(info(week({ warnings: 113 })), '113 Warnungen')
})

test('Leistungsnachweis: „Nur lesen“ ändert die gemeinsamen Einstellungen nicht', async () => {
  const { ACTIONS } = await import('../src/ui/context.js')
  await import('../src/ui/views/proof.js')
  const fields = { 'proof-names': { value: 'voll' }, 'proof-times': { checked: false }, 'proof-sign': { checked: false } }
  const saved = globalThis.document
  globalThis.document = { getElementById: (id) => fields[id] || null }
  let scheduled = 0
  try {
    app.data = { objects: [], nachweise: { sent: {}, settings: { names: 'keine', times: true, signature: true } } }
    app.service = { schedule: () => scheduled++ }
    app.readOnly = true
    ACTIONS['proof-settings']()
    assert.deepEqual(app.data.nachweise.settings, { names: 'keine', times: true, signature: true })
    assert.equal(scheduled, 0, 'nichts gespeichert')
  } finally {
    globalThis.document = saved
    app.readOnly = false
  }
})
