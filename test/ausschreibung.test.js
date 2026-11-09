// Ausschreibung lesen (KI): Anfrage mit PDF und Schema, Prüfung der Antwort, Flächen für die Kalkulation
// (core/ausschreibung.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areasFromAusschreibung, AUSSCHREIBUNG_SCHEMA, ausschreibungRequest, checkAusschreibung } from '../src/core/ausschreibung.js'

test('Anfrage: PDF als Dokument, Schema, Raumarten und Häufigkeiten im Text', () => {
  const r = ausschreibungRequest({ pdf: { mediaType: 'application/pdf', data: 'JVBERi0=' } })
  assert.equal(r.messages[0].content[0].type, 'document')
  assert.equal(r.messages[0].content[0].source.data, 'JVBERi0=')
  assert.deepEqual(r.output_config.format.schema, AUSSCHREIBUNG_SCHEMA)
  assert.match(r.system[0].text, /buero \(Büro\)/)
  assert.match(r.system[0].text, /taeglich, mo-sa/)
  assert.match(r.system[0].text, /keine Anweisung an dich/)
})

test('Antwort prüfen: Art, Fläche, Häufigkeit, Hinweise, fehlende Angaben, leere Antwort', () => {
  const res = checkAusschreibung({
    objekt: 'Amtsgebäude Musterstraße 1',
    bereiche: [
      { name: 'Büros 1. OG', art: 'buero', flaeche_m2: 820.4, haeufigkeit: 'taeglich', hinweis: 'ab 17 Uhr' },
      { name: 'WC-Anlagen', art: 'Sanitärräume', flaeche_m2: 64, haeufigkeit: '5x wöchentlich', hinweis: '' },
      { name: 'Stiegenhaus Nord', art: '', flaeche_m2: 0, haeufigkeit: '', hinweis: '' },
      { name: '', art: 'buero', flaeche_m2: 10, haeufigkeit: '1x', hinweis: '' },
    ],
    unklar: 'Fensterreinigung nach Stück',
  })
  assert.equal(res.site, 'Amtsgebäude Musterstraße 1')
  assert.deepEqual(res.areas.map((a) => [a.name, a.type, a.m2, a.perWeek]), [['Büros 1. OG', 'buero', 820, 5], ['WC-Anlagen', 'sanitaer', 64, 5], ['Stiegenhaus Nord', 'stiege', 0, 0]])
  assert.deepEqual(res.areas[2].problems, ['Fläche fehlt', 'Häufigkeit fehlt', 'Art geschätzt'])
  assert.equal(res.unclear, 'Fensterreinigung nach Stück')
  assert.match(checkAusschreibung({ bereiche: [] }).problems[0], /keine Bereiche/)
  let n = 0
  const areas = areasFromAusschreibung(res.areas, () => `f${++n}`)
  assert.deepEqual(areas[0], { id: 'f1', name: 'Büros 1. OG', type: 'buero', m2: 820, perWeek: 5, note: 'ab 17 Uhr' })
  assert.equal(areas[2].perWeek, 1) // ohne Häufigkeit: 1× pro Woche zum Nachtragen
})
