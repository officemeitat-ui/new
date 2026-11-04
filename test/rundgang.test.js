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

test('Handy-Leiste ohne Dienstplan: eigene Bereiche vor Kennzahlen und Anleitung', async () => {
  const { ownNavViews } = await import('../src/ui/mobile.js')
  const v = (id, module, extra = {}) => ({ id, module, ...extra })
  const ids = (views) => ownNavViews(views).map((x) => x.id)
  // Reihenfolge wie in der Registrierung (nach order)
  const general = [v('home', '*', { mobile: { label: 'Start' } }), v('assistenz', '*'), v('kennzahlen', '*'), v('anleitung', '*')]
  assert.deepEqual(ids([...general, v('fakturierung', 'fakturierung')]), ['home', 'fakturierung', 'assistenz', 'kennzahlen'], 'Buchhaltung')
  assert.deepEqual(ids([...general, v('material', 'material')]), ['home', 'material', 'assistenz', 'kennzahlen'], 'Lager')
  assert.deepEqual(ids([...general, v('zaehler', 'zaehler'), v('reklamationen', 'reklamationen'), v('kontrolle', 'kontrolle'), v('schluessel', 'schluessel')]), ['home', 'zaehler', 'reklamationen', 'kontrolle'], 'Objektservice')
  assert.deepEqual(ids([...general, v('fahrzeuge', 'fahrzeuge', { mobile: { label: 'Reifen' } })]), ['home', 'fahrzeuge', 'assistenz', 'kennzahlen'], 'Fuhrpark')
})

test('PDFs nach Mitternacht: Datum in Wiener Zeit, nicht in UTC (Inventur, Bestellung, Angebot)', async () => {
  const tz = process.env.TZ
  process.env.TZ = 'Europe/Vienna'
  try {
    const { countDocument, orderDocument } = await import('../src/export/material-pdf.js')
    const { offerDocument } = await import('../src/export/calc-pdf.js')
    const { calculate } = await import('../src/core/calculation.js')
    const night = new Date('2026-11-04T23:30:00Z') // Do 05.11.2026, 00:30 in Wien
    const count = JSON.stringify(countDocument({ rows: [], location: { id: 'l1', name: 'Hauptlager' }, createdAt: night }).content)
    assert.match(count, /Hauptlager · Do 05\.11\.2026/)
    const order = JSON.stringify(orderDocument({ order: { no: '2026-001', lines: [] }, createdAt: night }).content)
    assert.match(order, /05\.11\.2026/)
    const calc = calculate({ areas: [{ name: 'Büro', type: 'buero', m2: 100, perWeek: 5 }], settings: {}, wage: 13.54 })
    const offer = JSON.stringify(offerDocument({ object: { name: 'Kanzlei' }, calc, createdAt: night, validDays: 30 }).content)
    assert.match(offer, /Gültig bis Sa 05\.12\.2026/)
  } finally {
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
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
