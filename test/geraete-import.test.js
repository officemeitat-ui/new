// Geräte & Maschinen aus Excel einfügen (core/geraete-import.js): Spalten nach Überschrift, Art aus der Bezeichnung
// erraten, Datum und Preis lesen, nichts doppelt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guessType, parseDeviceTable } from '../src/core/geraete-import.js'
import { GERAETE_ARTEN } from '../src/core/geraete.js'

test('Art aus der Bezeichnung (typische Geräte einer Reinigungsfirma)', () => {
  assert.equal(guessType('Kärcher_HD_5_15'), 'hochdruck')
  assert.equal(guessType('Einscheibmaschine- Nanodisc 43 EVO'), 'einscheibe')
  assert.equal(guessType('Reinigungsmaschine Wetrok'), 'scheuersaug')
  assert.equal(guessType('Kärcher Nass u. Trockensauger'), 'sauger')
  assert.equal(guessType('Numatic Sprüh-Extraktionsgerät'), 'teppich')
  assert.equal(guessType('Streugerät Traktor'), 'winter')
  assert.equal(guessType('Schneeschild für Yanmar Traktor'), 'winter')
  assert.equal(guessType('WMF Kaffeemaschine'), 'sonstige')
})

test('Tabelle: Spalten in beliebiger Reihenfolge, Art als Name, Datum und Preis, ohne Bezeichnung übersprungen', () => {
  const text = 'Inventarnummer\tBezeichnung\tArt\tHersteller\tKaufdatum\tPreis\tStandort\nG-0001\tStaubsauger Büro\tStaub- und Nasssauger\tNumatic\t21.10.2026\t1.249,90 €\tLager\n\tKärcher HD 5/15\t\tKärcher\t03.07.2025\t890\t\n\t\t\t\t\t\t\n'
  const r = parseDeviceTable(text, { types: GERAETE_ARTEN })
  assert.deepEqual(r.errors, [])
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.items[0], { name: 'Staubsauger Büro', typeId: 'sauger', maker: 'Numatic', model: '', serial: '', no: 'G-0001', boughtOn: '2026-10-21', price: 1249.9, place: 'Lager', note: '' })
  assert.equal(r.items[1].typeId, 'hochdruck')
  assert.equal(r.items[1].price, 890)
})

test('Nichts doppelt: gleiche Inventarnummer oder gleiche Bezeichnung mit Seriennummer', () => {
  const existing = [{ no: 'G-0001', name: 'Alt', serial: '' }, { no: '', name: 'Kärcher HD 5/15', serial: 'X1' }]
  const r = parseDeviceTable('Bezeichnung;Inventarnummer;Seriennummer\nNeu;G-0001;\nKärcher HD 5/15;;X1\nKärcher HD 5/15;;X2\nKärcher HD 5/15;;X2', { types: GERAETE_ARTEN, existing })
  assert.deepEqual(r.items.map((x) => x.serial), ['X2'])
  assert.deepEqual(r.skipped, ['Neu', 'Kärcher HD 5/15', 'Kärcher HD 5/15'])
  assert.match(parseDeviceTable('Hersteller\nKärcher').errors.join(), /Bezeichnung/)
})
