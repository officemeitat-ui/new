import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compareHours, completeness, importCustomers, lvMinutes, plannedMinutes, sheetSections } from '../src/core/objektmappe.js'

const mappe = {
  customer: 'Hausverwaltung Muster GmbH',
  areas: [
    { name: 'Stiegenhaus', services: [{ what: 'Böden wischen', interval: 'w2', minutes: 40 }, { what: 'Glas', interval: 'w1', minutes: 15 }, { what: 'Grundreinigung', interval: 'bedarf', minutes: 300 }] },
    { name: 'Keller', services: [{ what: 'Kehren', interval: 'm1', minutes: 52 }] },
  ],
}

test('Objektmappe: Stunden aus Richtzeit × Häufigkeit, Vergleich mit dem Dienstplan', () => {
  assert.equal(lvMinutes(mappe), 40 * 2 + 15 + 12)
  const tasks = [
    { objectId: 'o5', category: 'reinigung', start: '07:00', end: '07:45', staff: 1, recurrence: { type: 'weekly', weekdays: [2, 4] } },
    { objectId: 'o5', category: 'reinigung', start: '22:00', end: '00:30', staff: 2, recurrence: { type: 'weekly', weekdays: [6], everyWeeks: 2 } },
    { objectId: 'o5', category: 'sonder', start: '08:00', end: '09:00', staff: 1, recurrence: { type: 'once', date: '2026-10-27' } },
    { objectId: 'o1', category: 'reinigung', start: '07:00', end: '08:00', staff: 1, recurrence: { type: 'weekly', weekdays: [1] } },
  ]
  assert.equal(plannedMinutes(tasks, 'o5'), 90 + 150)
  const c = compareHours(mappe, tasks, 'o5')
  assert.deepEqual([c.lv, c.plan, c.diff, c.warn], [107, 240, 133, true])
  assert.equal(compareHours(mappe, tasks.slice(0, 1), 'o5').warn, false, 'kleine Abweichung')
})

test('Objektmappe: Pflegestand nennt, was fehlt', () => {
  const c = completeness(mappe, { keys: [{ label: 'Haupteingang' }] })
  assert.deepEqual([c.pct, c.missing], [60, ['Ansprechpartner', 'Hinweise']])
})

test('Objektmappe: Kundenfassung lässt Vertrauliches immer weg', () => {
  assert.deepEqual(sheetSections('kunde'), ['objekt', 'zeiten', 'hinweise', 'leistungen', 'anhaenge', 'unterschrift'])
  assert.deepEqual(sheetSections('kunde', ['objekt', 'kontakte', 'zugang', 'stunden']), ['objekt'])
  assert.ok(sheetSections('akte').includes('stunden'))
  assert.ok(!sheetSections('mitarbeiter').includes('stunden'))
})

test('Objektmappe: Kundenstamm aus Kunden.json oder Excel', () => {
  const json = JSON.stringify([{ nr: '10000', name: 'Musterverwaltung GmbH', strasse: 'Musterstraße 1', ort: '5400 Hallein', email: 'office@example.at' }, { nr: '1', name: '' }])
  assert.deepEqual(importCustomers(json), [{ nr: '10000', name: 'Musterverwaltung GmbH', street: 'Musterstraße 1', city: '5400 Hallein', email: 'office@example.at' }])
  const csv = 'Kundennummer;Firma;Adresse;PLZ Ort;E-Mail\n20000;Beispiel KG;Weg 2;5020 Salzburg;kg@example.at'
  assert.deepEqual(importCustomers(csv)[0], { nr: '20000', name: 'Beispiel KG', street: 'Weg 2', city: '5020 Salzburg', email: 'kg@example.at' })
})
