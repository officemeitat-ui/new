import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { convertTemplates } from '../src/core/legacy.js'
import { areaFromTemplate, areaSize, compareHours, completeness, diffMappe, fitInterval, importCustomers, lvMinutes, plannedMinutes, restoreVersion, saveVersion, serviceWeekdays, sheetSections, templateFromArea, versions } from '../src/core/objektmappe.js'
import { BUILTIN_TEMPLATES } from '../src/data/lv-vorlagen.js'
import { objektblattDocument } from '../src/export/objektblatt-pdf.js'
import { sheetText } from '../src/export/objektblatt-i18n.js'
import { openCode, protectPdf } from '../src/export/pdf-parts.js'

const require = createRequire(import.meta.url)

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
  assert.deepEqual(sheetSections('kunde'), ['objekt', 'zeiten', 'hinweise', 'leistungen', 'raeume', 'anhaenge', 'unterschrift'])
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

test('Objektmappe: Fassungen mit Verlauf, Unterschieden und Wiederherstellen', () => {
  const v1 = saveVersion({}, structuredClone(mappe), { by: 'Büro', reason: 'angelegt', at: '2026-10-01T08:00:00Z' })
  assert.equal(v1.version, 1)
  assert.deepEqual(v1.history, [], 'erste Fassung hat keinen Verlauf')

  const next = structuredClone(v1)
  next.customer = 'Hausverwaltung Neu GmbH'
  next.areas[0].services[0].interval = 't5'
  next.areas[0].rooms = [{ no: '0.1', name: 'Müllraum', size: 12 }]
  next.contacts = [{ name: 'Maria Huber' }]
  const v2 = saveVersion(v1, next, { by: 'M. E.', reason: 'Vertrag 2027', at: '2026-10-20T09:00:00Z' })
  assert.deepEqual([v2.version, v2.reason, v2.checkedBy], [2, 'Vertrag 2027', 'M. E.'])
  assert.deepEqual(v2.history[0].keys.sort(), ['areas', 'contacts', 'customer'], 'nur Geändertes im Verlauf')
  assert.equal(v2.history[0].reason, 'angelegt')

  const nothing = saveVersion(v2, structuredClone(v2), { at: '2026-10-21T09:00:00Z' })
  assert.equal(nothing.version, 2, 'ohne Änderung keine neue Fassung')
  assert.equal(nothing.history.length, 1)

  const all = versions(v2)
  assert.deepEqual(all.map((v) => v.version), [2, 1])
  assert.equal(all[1].data.customer, 'Hausverwaltung Muster GmbH')
  assert.equal(all[1].data.contacts, undefined)
  const diff = diffMappe(all[1].data, all[0].data)
  assert.ok(diff.some((x) => x.startsWith('Stunden/Woche: 1,78 → 3,78')), diff.join(' | '))
  assert.ok(diff.includes('Kunde: „Hausverwaltung Muster GmbH“ → „Hausverwaltung Neu GmbH“'))
  assert.ok(diff.includes('Ansprechpartner: neu Maria Huber'))
  assert.ok(diff.some((x) => /^Stiegenhaus: Böden wischen 2× Woche → täglich Mo–Fr; Raumbuch 0 → 1 Raum$/.test(x)), diff.join(' | '))

  // Fassung 1 zurückholen: Inhalt von damals, Verlauf bleibt, Speichern ergibt Fassung 3
  const draft = restoreVersion({ ...v2, photos: [{ id: 'F1' }] }, all[1].data)
  assert.equal(draft.customer, 'Hausverwaltung Muster GmbH')
  assert.deepEqual(draft.photos, [{ id: 'F1' }], 'Fotos bleiben')
  const v3 = saveVersion(v2, draft, { reason: 'Fassung 1 wiederhergestellt' })
  assert.deepEqual(versions(v3).map((v) => [v.version, v.data.customer]), [[3, 'Hausverwaltung Muster GmbH'], [2, 'Hausverwaltung Neu GmbH'], [1, 'Hausverwaltung Muster GmbH']])

  // höchstens 50 Fassungen
  let m = v3
  for (let i = 0; i < 60; i++) m = saveVersion(m, { ...m, notes: `Stand ${i}` })
  assert.equal(m.history.length, 50)
  assert.equal(versions(m)[50].data.notes, 'Stand 9')
})

test('Objektmappe: übernommener Verlauf aus der Objektdoku (vollständige Fassungen)', () => {
  const m = { customer: 'C', version: 3, history: [{ version: 2, at: '2026-09-01', by: 'Büro', reason: 'Blatt erzeugt', data: { customer: 'B' } }, { version: 1, data: { customer: 'A', notes: 'alt' } }] }
  assert.deepEqual(versions(m).map((v) => [v.version, v.data.customer, v.data.notes]), [[3, 'C', undefined], [2, 'B', undefined], [1, 'A', 'alt']])
  const next = saveVersion(m, { ...m, customer: 'D' })
  assert.deepEqual(versions(next).map((v) => v.data.customer), ['D', 'C', 'B', 'A'])
})

test('Objektmappe: Bereich aus Vorlage, Häufigkeit passt sich den Einsatztagen an', () => {
  assert.equal(fitInterval('t5', 3), 'w3')
  assert.equal(fitInterval('t7', 5), 't5')
  assert.equal(fitInterval('w2', 3), 'w2')
  assert.equal(fitInterval('m1', 1), 'm1')
  assert.equal(fitInterval('t5', 0), 't5', 'ohne bekannte Einsatztage unverändert')
  const tasks = [{ objectId: 'o5', recurrence: { type: 'weekly', weekdays: [1, 3] } }, { objectId: 'o5', recurrence: { type: 'weekly', weekdays: [5], everyWeeks: 2 } }, { objectId: 'o5', category: 'sonder', recurrence: { type: 'weekly', weekdays: [2] } }]
  assert.deepEqual(serviceWeekdays({}, tasks, 'o5'), [1, 3], 'aus dem Stammplan, nur jede Woche')
  assert.deepEqual(serviceWeekdays({ serviceDays: ['Mo', 'Mi', 'Fr'] }, tasks, 'o5'), [1, 3, 5], 'Vertrag geht vor')
  const templates = convertTemplates(BUILTIN_TEMPLATES)
  assert.equal(templates.length, 13)
  const foyer = templates.find((x) => x.name === 'Eingangsbereich / Foyer')
  const { area, fitted } = areaFromTemplate(foyer, 2)
  assert.equal(fitted, 3, 'drei Leistungen „täglich Mo–Fr“ werden 2× Woche')
  assert.ok(area.services.every((s) => s.interval !== 't5'))
  assert.deepEqual(area.rooms, [])
  assert.deepEqual(templateFromArea({ ...area, location: 'EG', rooms: [{ name: 'x' }] }, 'V-1').services.length, foyer.services.length)
  assert.equal(areaSize({ size: '', rooms: [{ size: 12 }, { size: 8.5 }, { size: 3.5 }] }), 24)
  assert.equal(areaSize({ size: 30, rooms: [{ size: 12 }] }), 30, 'Bereichsfläche geht vor')
})

test('Objektblatt: Sprachen, Raumbuch und Öffnungscode', async () => {
  const t = sheetText('ro')
  assert.equal(t('sec.raeume'), 'Lista încăperilor')
  assert.equal(t.interval('w1'), 'săptămânal')
  assert.equal(t('page', { p: 1, n: 3 }), 'Pagina 1 din 3')
  assert.equal(sheetText('xx')('sec.raeume'), 'Raumbuch', 'unbekannte Sprache: Deutsch')
  const data = { object: { name: 'Wohnanlage Lehen', address: 'Lehen 1' }, mappe: { ...mappe, serviceDays: ['Mo', 'Do'], timeWindows: [{ days: 'Mo–Fr', from: '06:00', to: '08:00' }], areas: [{ ...mappe.areas[0], rooms: [{ no: '0.1', name: 'Müllraum', size: 12 }] }] }, tasks: [], keys: [{ label: 'Haupteingang', holder: null }] }
  const doc = objektblattDocument(data, { sections: ['objekt', 'zeiten', 'zugang', 'leistungen', 'raeume'], lang: 'en' })
  const text = JSON.stringify(doc.content)
  for (const s of ['Site sheet', 'Room schedule', 'Mon, Thu', 'daily Mon–Fri'.replace('daily Mon–Fri', '2× a week'), 'at the office', 'Free-text notes']) assert.ok(text.includes(s), s)
  assert.ok(text.includes('Böden wischen'), 'Freitext bleibt deutsch')
  assert.equal(doc.footer(1, 2).stack[1].columns[1].text, 'Page 1 of 2', 'vertraulich: Zugang')

  const code = openCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  assert.notEqual(openCode(), code)
  const locked = protectPdf(doc, code)
  assert.deepEqual([locked.userPassword, locked.version, locked.permissions.printing, locked.permissions.copying], [code, '1.7ext3', 'highResolution', false])
  assert.notEqual(locked.ownerPassword, code)
  const pdfMake = require('pdfmake/build/pdfmake.js')
  pdfMake.addVirtualFileSystem(require('pdfmake/build/vfs_fonts.js'))
  const buffer = Buffer.from(await new Promise((resolve) => pdfMake.createPdf(locked).getBuffer(resolve)))
  assert.equal(buffer.subarray(0, 8).toString(), '%PDF-1.7')
  assert.ok(buffer.includes('/Encrypt'), 'verschlüsselt')
  assert.ok(!buffer.includes('Wohnanlage Lehen'), 'Inhalt nicht lesbar ohne Code')
})

test('Objektmappe: Stundenvergleich nur mit gültigen Leistungen, Beginn = Ende zählt nicht', () => {
  const lv = { areas: [{ name: 'Stiegenhaus', services: [{ what: 'Böden', interval: 't5', minutes: 60 }] }] }
  const tasks = [
    { id: 'alt', objectId: 'o1', category: 'reinigung', start: '06:00', end: '08:00', staff: 1, recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, until: '2026-10-31' } },
    { id: 'neu', objectId: 'o1', category: 'reinigung', start: '06:00', end: '07:00', staff: 1, recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, from: '2026-11-01' } },
    { id: 'sa', objectId: 'o1', category: 'reinigung', start: '08:00', end: '09:00', staff: 1, recurrence: { type: 'weekly', weekdays: [6], until: '2025-12-31' } },
  ]
  const nov = compareHours(lv, tasks, 'o1', '2026-11-02')
  assert.deepEqual([nov.lv, nov.plan, nov.warn], [300, 300, false], 'beendete Leistung zählt nicht')
  assert.equal(plannedMinutes(tasks, 'o1', '2026-10-26'), 600, 'vor dem Wechsel gilt die alte')
  assert.deepEqual(serviceWeekdays({}, tasks, 'o1', '2026-11-02'), [1, 2, 3, 4, 5], 'Samstag ist beendet')
  assert.equal(plannedMinutes([{ objectId: 'o2', start: '08:00', end: '08:00', recurrence: { type: 'weekly', weekdays: [1] } }], 'o2'), 0)
})

test('Objektmappe: Kundenstamm mit Spalte „Straße“', () => {
  const csv = 'Nr;Name;Straße;PLZ Ort;E-Mail\n10001;Muster GmbH;Hauptstraße 1;5020 Salzburg;office@muster.at'
  assert.deepEqual(importCustomers(csv)[0], { nr: '10001', name: 'Muster GmbH', street: 'Hauptstraße 1', city: '5020 Salzburg', email: 'office@muster.at' })
})

test('Objektmappe: leere Zwischenfassung bricht den Verlauf nicht', () => {
  let m = {}
  const states = [{ notes: 'x' }, {}, { contacts: [{ name: 'P' }] }]
  for (const [i, s] of states.entries()) m = saveVersion(m, { ...s, history: m.history }, { at: `2026-01-0${i + 1}T00:00:00Z` })
  assert.deepEqual(versions(m).map((v) => [v.version, v.data]), [[3, { contacts: [{ name: 'P' }] }], [2, {}], [1, { notes: 'x' }]])
})
