import { test } from 'node:test'
import assert from 'node:assert/strict'

import { availableTools, registerAgentTool, validateInput } from '../src/ai/registry.js'
import '../src/ai/tools.js' // meldet die Werkzeuge an (ohne Netz, nur Definitionen)
import { app } from '../src/ui/context.js'

/** App-Zustand für einen Test setzen und danach wiederherstellen. */
function withApp(patch, fn) {
  const before = { access: app.access, readOnly: app.readOnly, auth: app.auth }
  Object.assign(app, patch)
  try {
    return fn()
  } finally {
    Object.assign(app, before)
  }
}
const role = (seen, edited = []) => ({ all: false, sees: (m) => seen.includes(m) || edited.includes(m), canEdit: (m) => edited.includes(m) })
const names = () => availableTools().map((t) => t.name)
const all = () => withApp({ access: null, readOnly: false, auth: { tokenFor: async () => ({ accessToken: 'x' }) } }, availableTools)

const WRITE_TOOLS = ['abwesenheit_eintragen', 'einteilen', 'email_senden', 'material_anfordern', 'reklamation_erfassen', 'termin_erstellen', 'vertretungen_verteilen']

// ---------------------------------------------------------------- Definitionen

test('Assistent: Werkzeugnamen eindeutig und für die API gültig, Beschreibung vorhanden', () => {
  const tools = all()
  assert.deepEqual(tools.map((t) => t.name), ['abwesenheit_eintragen', 'abwesenheiten_abfragen', 'digitale_mitarbeiter', 'einteilen', 'email_senden', 'kalender_lesen', 'material_anfordern', 'material_bestand', 'objekte_suchen', 'personen_suchen', 'plan_abfragen', 'reklamation_erfassen', 'schluessel_abfragen', 'termin_erstellen', 'vertretung_vorschlagen', 'vertretungen_verteilen', 'zu_erledigen'])
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length)
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z_]{2,63}$/, t.name)
    assert.ok(String(t.description || '').length >= 40, `${t.name}: Beschreibung zu kurz`)
    assert.equal(typeof t.run, 'function', t.name)
  }
})

test('Assistent: Eingabeschema je Werkzeug ist ein Objekt, Pflichtfelder sind beschrieben, Aufzählungen nicht leer', () => {
  for (const t of all()) {
    const s = t.input_schema
    assert.equal(s.type, 'object', t.name)
    assert.equal(typeof s.properties, 'object', t.name)
    for (const key of s.required || []) assert.ok(s.properties[key], `${t.name}: Pflichtfeld ${key} ohne Beschreibung`)
    for (const [key, p] of Object.entries(s.properties)) {
      assert.ok(['string', 'integer', 'number', 'boolean', 'array'].includes(p.type), `${t.name}.${key}: Typ ${p.type}`)
      if (p.enum) assert.ok(p.enum.length > 0 && p.enum.every((v) => typeof v === p.type), `${t.name}.${key}: Aufzählung`)
      if (p.type === 'array') assert.ok(p.items?.type, `${t.name}.${key}: Typ der Einträge`)
      if (p.pattern) assert.doesNotThrow(() => new RegExp(p.pattern), `${t.name}.${key}: Muster`)
    }
  }
})

test('Assistent: genau die ändernden Werkzeuge brauchen eine Bestätigung und haben eine Zusammenfassung dafür', () => {
  const tools = all()
  assert.deepEqual(tools.filter((t) => t.write).map((t) => t.name), WRITE_TOOLS)
  for (const t of tools.filter((x) => x.write)) assert.equal(typeof t.summary, 'function', t.name)
  assert.ok(tools.filter((t) => !t.write).every((t) => !t.summary), 'Nachschlagen ohne Rückfrage')
})

// ---------------------------------------------------------------- Rechte

test('Assistent: Liste alphabetisch; ohne Microsoft-Anmeldung keine Kalender- und Mail-Werkzeuge', () => {
  withApp({ access: null, readOnly: false, auth: null }, () => {
    const list = names()
    assert.deepEqual(list, [...list].sort())
    for (const n of ['kalender_lesen', 'termin_erstellen', 'email_senden']) assert.ok(!list.includes(n), n)
  })
  withApp({ access: null, readOnly: false, auth: { tokenFor: async () => ({}) } }, () => {
    for (const n of ['kalender_lesen', 'termin_erstellen', 'email_senden']) assert.ok(names().includes(n), n)
  })
})

test('Assistent: im Nur-Lesen-Modus (gesperrt, ohne Netz) gibt es keine ändernden Werkzeuge', () => {
  withApp({ access: null, readOnly: true, auth: { tokenFor: async () => ({}) } }, () => {
    const list = names()
    assert.ok(WRITE_TOOLS.every((n) => !list.includes(n)))
    assert.ok(list.includes('plan_abfragen'))
  })
})

test('Assistent: Lager nur lesend – Bestand und Suche ja, Anfordern und Dienstplan nein', () => {
  withApp({ access: role(['material']), readOnly: false, auth: null }, () => {
    assert.deepEqual(names(), ['digitale_mitarbeiter', 'material_bestand', 'objekte_suchen', 'personen_suchen', 'zu_erledigen'])
  })
})

test('Assistent: Lager mit Schreibrecht darf Material anfordern, aber nicht einteilen', () => {
  withApp({ access: role([], ['material']), readOnly: false, auth: null }, () => {
    const list = names()
    assert.ok(list.includes('material_anfordern'))
    assert.ok(!list.includes('einteilen') && !list.includes('abwesenheit_eintragen'))
  })
})

test('Assistent: Abwesenheiten (Gesundheitsdaten) nur mit Planungs-Schreibrecht oder Einsicht in die Stammdaten', () => {
  withApp({ access: role(['planung']), readOnly: false, auth: null }, () => {
    assert.ok(names().includes('plan_abfragen'))
    assert.ok(!names().includes('abwesenheiten_abfragen'), 'Plan sehen reicht nicht')
  })
  withApp({ access: role(['planung', 'stammdaten']), readOnly: false, auth: null }, () => assert.ok(names().includes('abwesenheiten_abfragen')))
  withApp({ access: role([], ['planung']), readOnly: false, auth: null }, () => assert.ok(names().includes('abwesenheiten_abfragen')))
})

// ---------------------------------------------------------------- Eingaben prüfen

const SCHEMA = {
  type: 'object',
  properties: {
    datum: { type: 'string', format: 'date' },
    beginn: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
    dauer: { type: 'integer' },
    betrag: { type: 'number' },
    art: { type: 'string', enum: ['Urlaub', 'Krankenstand'] },
    teams: { type: 'boolean' },
    teilnehmer: { type: 'array', items: { type: 'string' } },
  },
  required: ['datum'],
}

for (const [label, input, expected] of [
  ['gültig', { datum: '2026-11-04', beginn: '07:30', dauer: 60, betrag: 12.5, art: 'Urlaub', teams: false, teilnehmer: ['Ana'] }, ''],
  ['leere optionale Werte erlaubt', { datum: '2026-11-04', beginn: null, art: undefined }, ''],
  ['keine Eingabe', null, 'Eingabe fehlt.'],
  ['Liste statt Objekt', [], 'Eingabe fehlt.'],
  ['Pflichtfeld leer', { datum: '' }, 'Angabe „datum“ fehlt.'],
  ['unbekanntes Feld', { datum: '2026-11-04', lohn: 15 }, 'Unbekannte Angabe „lohn“.'],
  ['Kommazahl statt Ganzzahl', { datum: '2026-11-04', dauer: 1.5 }, '„dauer“ hat den falschen Typ (integer erwartet).'],
  ['Text statt Zahl', { datum: '2026-11-04', betrag: '12,50' }, '„betrag“ hat den falschen Typ (number erwartet).'],
  ['Text statt Wahrheitswert', { datum: '2026-11-04', teams: 'ja' }, '„teams“ hat den falschen Typ (boolean erwartet).'],
  ['Wert außerhalb der Aufzählung', { datum: '2026-11-04', art: 'Kur' }, '„art“ muss eines von Urlaub, Krankenstand sein.'],
  ['Datum österreichisch', { datum: '04.11.2026' }, '„datum“ bitte als JJJJ-MM-TT.'],
  ['Uhrzeit ohne führende Null', { datum: '2026-11-04', beginn: '7:30' }, '„beginn“ hat das falsche Format.'],
  ['Liste mit falschen Einträgen', { datum: '2026-11-04', teilnehmer: ['Ana', 3] }, '„teilnehmer“: Einträge müssen string sein.'],
]) {
  test(`Assistent: Eingabe prüfen – ${label}`, () => {
    assert.equal(validateInput(SCHEMA, input), expected)
  })
}

test('Assistent: Eingaben der echten Werkzeuge – Abwesenheit ohne Art und mit falscher Art abgelehnt', () => {
  const tool = all().find((t) => t.name === 'abwesenheit_eintragen')
  assert.equal(validateInput(tool.input_schema, { person: 'Ana', von: '2026-11-04', bis: '2026-11-06' }), 'Angabe „art“ fehlt.')
  assert.match(validateInput(tool.input_schema, { person: 'Ana', art: 'Kur', von: '2026-11-04', bis: '2026-11-06' }), /muss eines von Urlaub, Krankenstand/)
  assert.equal(validateInput(tool.input_schema, { person: 'Ana', art: 'Pflegefreistellung', von: '2026-11-04', bis: '2026-11-06' }), '')
  const termin = all().find((t) => t.name === 'termin_erstellen')
  assert.equal(validateInput(termin.input_schema, { titel: 'Begehung', beginn: '2026-11-04 10:00' }), '„beginn“ hat das falsche Format.')
})

test('Assistent: gleichnamiges Werkzeug ersetzt das alte statt doppelt aufzutauchen', () => {
  const before = all().length
  registerAgentTool({ name: 'zu_erledigen', modules: '*', description: 'Ersatz für den Test: was ansteht, kurz zusammengefasst und ohne Module.', input_schema: { type: 'object', properties: {} }, run: () => ({}) })
  const tools = all()
  assert.equal(tools.length, before)
  assert.match(tools.find((t) => t.name === 'zu_erledigen').description, /^Ersatz für den Test/)
  registerAgentTool({ name: 'nur_wenn', modules: '*', when: () => false, description: 'Werkzeug, das gerade nicht verfügbar ist (Bedingung nicht erfüllt).', input_schema: { type: 'object', properties: {} }, run: () => ({}) })
  assert.ok(!all().some((t) => t.name === 'nur_wenn'))
})
