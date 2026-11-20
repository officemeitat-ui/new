// Mattenwechsel: Liegeplätze aus einer Excel-Liste lesen (core/matten-liste.js) und durch die Übernahme schicken
// (core/matten-import.js). Alle Namen und Adressen sind erfunden.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyImport, planImport } from '../src/core/matten-import.js'
import { headKey, intervalWeeks, listDate, listSummary, parsePlacementTable, PLACEMENT_TEMPLATE, splitListAddress } from '../src/core/matten-liste.js'
import { emptyMatten } from '../src/core/matten.js'

const T = (rows) => rows.map((r) => r.join('\t')).join('\n')
const HEAD = ['Gebiet', 'Kunde', 'Straße', 'PLZ', 'Ort', 'Liegeplatz', 'Anzahl', 'Größe', 'Farbe', 'Intervall (Wochen)', 'Letzter Wechsel', 'Eigentum', 'Hinweis']

test('Liste: Hilfen für Überschrift, Intervall, Datum und Adresse', () => {
  assert.equal(headKey('Intervall (Wochen)'), 'intervall')
  assert.equal(headKey(' Größe '), 'groesse')
  assert.deepEqual(['4', '4 Wochen', '14-tägig', '28 Tage', 'wöchentlich', 'monatlich', 'alle 2 Wochen', '', 'nie', '0'].map(intervalWeeks), [4, 4, 2, 4, 1, 4, 2, 0, 0, 0])
  assert.deepEqual(['18.11.2026', '3.1.26', '2026-11-18', '31.02.2026', 'gestern', ''].map(listDate), ['2026-11-18', '2026-01-03', '2026-11-18', '', '', ''])
  assert.deepEqual(splitListAddress('Musterweg 1, 5020 Salzburg'), { strasse: 'Musterweg 1', plz: '5020', ort: 'Salzburg' })
  assert.deepEqual(splitListAddress('Musterweg 7a 5400 Hallein'), { strasse: 'Musterweg 7a', plz: '5400', ort: 'Hallein' })
  assert.deepEqual(splitListAddress('Musterweg 1'), { strasse: 'Musterweg 1', plz: '', ort: '' })
  assert.equal(PLACEMENT_TEMPLATE.join('|'), HEAD.join('|'))
})

test('Liste: Zeilen lesen, Gebiet und Kunde gelten nach unten, weitere Matte und zweiter Liegeplatz derselben Adresse', () => {
  const r = parsePlacementTable(
    T([
      HEAD,
      ['Nord', 'Hausverwaltung Muster GmbH', 'Musterweg 1', '5020', 'Salzburg', 'Haupteingang', '2', '85 x 150 cm', 'grau', '4', '18.11.2026', '', 'Schlüssel beim Hausmeister'],
      ['', '', '', '', '', '', '1', '115x180', 'Navy', '', '', '', ''],
      ['', '', '', '', '', 'Stiege 2', '1', '85 x 150 cm', 'grau', '2 Wochen', '', 'Kunde', ''],
      ['', '', 'Beispielgasse 5, 5020 Salzburg', '', '', '', '3', '0,85x1,20', 'Navy', '', '', '', ''],
      ['Süd', 'Bäckerei Beispiel OG', 'Probeplatz 3', '5400', 'Hallein', 'Verkauf', '', '85x120', 'braun', '14-tägig', '', '', ''],
      [],
    ]),
  )
  assert.equal(r.problem, '')
  assert.deepEqual(r.errors, [])
  assert.equal(r.standorte.length, 4)
  const [a, b, c, d] = r.standorte
  assert.deepEqual([a.gebiet, a.kunde, a.strasse, a.plz, a.ort, a.position, a.intervallWochen, a.letzterWechsel, a.hinweis], ['Nord', 'Hausverwaltung Muster GmbH', 'Musterweg 1', '5020', 'Salzburg', 'Haupteingang', 4, '2026-11-18', 'Schlüssel beim Hausmeister'])
  assert.deepEqual(a.matten, [{ anzahl: 2, farbe: 'grau', groesse: '85 x 150 cm', eigentum: 'wir' }, { anzahl: 1, farbe: 'Navy', groesse: '115x180', eigentum: 'wir' }])
  // zweiter Liegeplatz derselben Adresse: Straße leer, Liegeplatz genannt
  assert.deepEqual([b.kunde, b.strasse, b.position, b.intervallWochen, b.matten[0].eigentum], ['Hausverwaltung Muster GmbH', 'Musterweg 1', 'Stiege 2', 2, 'kunde'])
  // Adresse in einer Zelle, Liegeplatz leer → „Eingang“, Intervall fehlt
  assert.deepEqual([c.gebiet, c.kunde, c.strasse, c.plz, c.ort, c.position, c.intervallWochen], ['Nord', 'Hausverwaltung Muster GmbH', 'Beispielgasse 5', '5020', 'Salzburg', 'Eingang', undefined])
  assert.deepEqual([d.gebiet, d.kunde, d.intervallWochen, d.matten[0].anzahl], ['Süd', 'Bäckerei Beispiel OG', 2, 1])
  assert.deepEqual(r.notes, { rows: 5, mats: 5, merged: 0, noInterval: 1, badDates: 0 })
  assert.ok(r.standorte.every((s) => /^L-x[0-9a-z]{7}$/.test(s.id) && s.aktiv === true && s.quelle === 'Excel-Liste'))
  assert.equal(new Set(r.standorte.map((s) => s.id)).size, 4)
  assert.equal(listSummary(r), '4 Liegeplätze mit 5 Matten-Zeilen aus 5 Zeilen · 2 Kunden, 2 Gebiete · 1 ohne Intervall (4 Wochen angenommen) · 1 mit letztem Wechsel')
})

test('Liste: andere Überschriften, Strichpunkt, Vorspann; dieselbe Zeile zweimal wird ein Liegeplatz', () => {
  const r = parsePlacementTable(['Mattenliste Stand November', '', 'Firma;Anschrift;Position;Stk;Format;Farbe;Turnus;Tour;Telefon', 'Autohaus Probe KG;Testallee 9, 5020 Salzburg;Schauraum;2;150x250;anthrazit;28 Tage;Stadt;0662 000', 'Autohaus Probe KG;Testallee 9, 5020 Salzburg;Schauraum;1;85x150;grau;;;', 'AUTOHAUS PROBE KG;Testallee 9 5020 Salzburg;Werkstatt;;;;;;'].join('\n'))
  assert.equal(r.problem, '')
  assert.deepEqual(r.columns, ['kunde', 'strasse', 'position', 'anzahl', 'groesse', 'farbe', 'intervall', 'gebiet'])
  assert.deepEqual(r.unknown, ['Telefon'])
  assert.equal(r.standorte.length, 2)
  assert.deepEqual(r.standorte[0].matten.map((m) => `${m.anzahl}×${m.groesse}`), ['2×150x250', '1×85x150'])
  assert.deepEqual([r.standorte[0].gebiet, r.standorte[0].intervallWochen, r.notes.merged], ['Stadt', 4, 1])
  // Liegeplatz ohne Matte bleibt erhalten (die Vorschau zeigt „Stückzahl fehlt“ bzw. ohne Matte)
  assert.deepEqual([r.standorte[1].position, r.standorte[1].matten.length], ['Werkstatt', 0])
  assert.match(listSummary(r), /1 ohne Matte$/)
  // gleiche Liste noch einmal: dieselben Kennungen
  const again = parsePlacementTable('Kunde\tStraße\tLiegeplatz\nAutohaus Probe KG\tTestallee 9, 5020 Salzburg\tSchauraum')
  assert.equal(again.standorte[0].id, r.standorte[0].id)
})

test('Liste: Fehler mit Zeilennummer und verständliche Meldungen', () => {
  assert.match(parsePlacementTable('').problem, /Liste aus Excel einfügen/)
  assert.match(parsePlacementTable('irgendwas\tnoch was\n1\t2').problem, /Keine Überschrift erkannt/)
  assert.match(parsePlacementTable('Kunde\tGröße\nA\t85x150').problem, /Spalte „Straße“ fehlt/)
  assert.match(parsePlacementTable('Straße\tGröße\nWeg 1\t85x150').problem, /Spalte „Kunde“ fehlt/)
  assert.match(parsePlacementTable('Kunde\tStraße\n').problem, /keine Zeile/)
  const r = parsePlacementTable(T([['Kunde', 'Straße', 'Größe', 'Letzter Wechsel'], ['', 'Weg 1', '85x150', ''], ['Kunde A', '', '85x150', ''], ['Kunde A', 'Weg 2', '85x150', 'gestern']]))
  assert.deepEqual(r.errors.map((e) => [e.line, e.text.split(' (')[0]]), [[2, 'Kunde fehlt'], [3, 'Straße fehlt'], [4, 'Datum „gestern“ nicht lesbar']])
  assert.equal(r.standorte.length, 1)
  assert.equal(r.notes.badDates, 1)
  assert.ok(!('letzterWechsel' in r.standorte[0]))
})

test('Liste → Übernahme: Kunden neu, Objekte je Adresse, letzter Wechsel, zweiter Lauf legt nichts doppelt an', () => {
  const text = T([
    HEAD,
    ['Nord', 'Hausverwaltung Muster GmbH', 'Musterweg 1', '5020', 'Salzburg', 'Haupteingang', '2', '85 x 150 cm', 'grau', '4', '06.11.2026', '', ''],
    ['', '', '', '', '', 'Stiege 2', '1', '85 x 150 cm', 'grau', '4', '', '', ''],
    ['Süd', 'Bäckerei Beispiel OG', 'Probeplatz 3', '5400', 'Hallein', 'Verkauf', '1', '85 x 150 cm', 'grau', '2', '', '', ''],
  ])
  const list = parsePlacementTable(text)
  const articles = [{ id: 'a1', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', matKind: 'Standard', unit: 'Stk', price: 4.9, vat: 20 }]
  let n = 0
  const newId = (p) => `${p}-l${++n}`
  const state = { doc: emptyMatten(), customers: [], objects: [], articles }
  const tool = { standorte: list.standorte, kunden: [], touren: [] }
  const plan = planImport({ tool, ...state })
  const choices = { customers: Object.fromEntries(plan.customers.map((c) => [c.key, 'neu'])) }
  const plan2 = planImport({ tool, ...state, choices })
  assert.deepEqual([plan2.counts.neu, plan2.counts.ohneKunde], [3, 0])
  const res = applyImport(plan2, { ...state, newId, now: '2026-11-20T08:00:00.000Z', user: 'Büro', today: '2026-11-20' })
  assert.deepEqual([res.summary.placements, res.summary.customers, res.summary.objects, res.summary.areas], [3, 2, 2, 2])
  const pl = res.doc.placements
  assert.deepEqual(pl.map((p) => [p.name, p.intervalDays, p.mats[0].articleId, p.mats[0].qty]), [['Haupteingang', 28, 'a1', 2], ['Stiege 2', 28, 'a1', 1], ['Verkauf', 14, 'a1', 1]])
  assert.equal(pl[0].lastExchange?.date, '2026-11-06')
  assert.equal(pl[0].objectId, pl[1].objectId)
  assert.notEqual(pl[0].objectId, pl[2].objectId)
  // zweiter Lauf mit derselben Liste: alles „schon übernommen“
  const state2 = { doc: res.doc, customers: res.customers, objects: res.objects, articles }
  const again = planImport({ tool: { standorte: parsePlacementTable(text).standorte, kunden: [], touren: [] }, ...state2 })
  assert.deepEqual([again.counts.neu, again.counts.gleich], [0, 3])
})
