// KI-Fotoprüfung bei der Qualitätsmessung: Anfrage (nur Foto, Raumgruppe, Prüfobjekte, Fehlerarten), Prüfung der
// Antwort, Übernahme je Prüfobjekt (core/qualitaet-ki.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySuggestion, checkFotoPruefung, FOTO_SCHEMA, fotoPruefungRequest } from '../src/core/qualitaet-ki.js'

const items = [{ name: 'Boden' }, { name: 'Tische, Ablagen' }, { name: 'Papierkorb' }]
const defects = [{ id: 'staub', name: 'Staub' }, { id: 'flecken', name: 'Flecken, Streifen' }, { id: 'abfall', name: 'Abfall nicht entsorgt' }]

test('Anfrage: Foto, Raumgruppe, Prüfobjekte, Fehlerarten, Schema', () => {
  const r = fotoPruefungRequest({ photo: { mediaType: 'image/jpeg', data: 'QUJD' }, group: 'Büro', items, defects })
  assert.equal(r.messages[0].content[0].type, 'image')
  assert.equal(r.messages[0].content[0].source.data, 'QUJD')
  assert.match(r.messages[0].content[1].text, /Raumgruppe: Büro\nPrüfobjekte:\n- Boden\n- Tische, Ablagen\n- Papierkorb\nFehlerarten:\n- Staub/)
  assert.deepEqual(r.output_config.format.schema, FOTO_SCHEMA)
  assert.match(r.system[0].text, /im Zweifel immer "unklar"/)
})

test('Antwort prüfen: bekannte Prüfobjekte und Fehlerarten, unklar, Doppel, Unbekanntes', () => {
  const res = checkFotoPruefung(
    {
      punkte: [
        { punkt: 'papierkorb', zustand: 'mangel', fehler: ['Abfall nicht entsorgt', 'Geruch'], hinweis: 'Papierkorb voll' },
        { punkt: 'Boden', zustand: 'ok', fehler: ['Staub'], hinweis: '' },
        { punkt: 'Boden', zustand: 'mangel', fehler: ['Staub'], hinweis: 'doppelt' },
        { punkt: 'Fenster', zustand: 'mangel', fehler: [], hinweis: '' },
        { punkt: 'Tische, Ablagen', zustand: 'vielleicht', fehler: [], hinweis: 'x'.repeat(300) },
      ],
      allgemein: 'Licht schwach',
    },
    { items, defects },
  )
  assert.deepEqual(res.suggestions.map((s) => [s.k, s.state, s.defects]), [[0, 'ok', []], [1, 'unklar', []], [2, 'mangel', ['abfall']]])
  assert.equal(res.suggestions[1].hint.length, 160)
  assert.equal(res.general, 'Licht schwach')
  assert.match(res.problems.join(), /Unbekanntes Prüfobjekt „Fenster“/)
  assert.match(checkFotoPruefung({ punkte: [] }, { items, defects }).problems.join(), /Kein Prüfobjekt/)
})

test('Übernehmen: Zustand, Fehlerarten, Notiz aus dem Hinweis, Kennzeichen KI; unklar ändert nichts', () => {
  const it = { name: 'Papierkorb', state: null, defects: [], note: '' }
  assert.equal(applySuggestion(it, { state: 'mangel', defects: ['abfall'], hint: 'Papierkorb voll' }, '2026-11-09T10:00:00Z'), true)
  assert.deepEqual(it, { name: 'Papierkorb', state: 'mangel', defects: ['abfall'], note: 'Papierkorb voll', ki: { at: '2026-11-09T10:00:00Z', state: 'mangel' } })
  const b = { name: 'Boden', state: 'mangel', defects: ['staub'], note: 'eigene Notiz' }
  assert.equal(applySuggestion(b, { state: 'unklar', defects: [], hint: '' }), false)
  assert.equal(b.state, 'mangel')
  applySuggestion(b, { state: 'ok', defects: [], hint: 'sauber' })
  assert.deepEqual([b.state, b.defects, b.note], ['ok', [], 'eigene Notiz'])
})
