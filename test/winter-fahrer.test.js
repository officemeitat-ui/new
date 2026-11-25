// Winterdienst: dauerhafte Protokoll-Links der Fahrer, freie Adresse, Fotos aus der App (core/weather.js, core/winterlog.js).
// Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { alarmDrivers, alarmFile, driverLink } from '../src/core/weather.js'
import { freeEntriesFor, freeName, fromServer, logRows, newFromServer, photoName, photoPath } from '../src/core/winterlog.js'
import { mayWhatsApp } from '../src/core/whatsapp.js'

const CODE = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const CODE2 = 'ffeeddccbbaa998877665544'
const loc = { name: 'Salzburg', lat: 47.8095, lon: 13.055 }
const locs = [loc, { name: 'Hallein', lat: 47.6833, lon: 13.097 }]
const objects = [
  { id: 'o5', name: 'Wohnanlage Lehen', address: 'Lehener Straße 1, 5020 Salzburg', lat: 47.81, lon: 13.03, winter: { active: true, team: ['e1'] } },
  { id: 'o9', name: 'Werkstatt Hallein', address: 'Salzachtalstraße 3, 5400 Hallein', lat: 47.683, lon: 13.097, region: 'Hallein', winter: { active: true, team: [] } },
  { id: 'o1', name: 'Büro ohne Winterdienst', address: 'Bürgerstraße 1, 5020 Salzburg', lat: 47.8, lon: 13.04 },
  { id: 'o7', name: 'Stillgelegt', address: '', winter: { active: true }, active: false },
]
const employees = [{ id: 'e1', name: 'Dragan Jović', lang: 'bks', phone: '0664 0000001' }, { id: 'e2', name: 'Ana Popescu', exitDate: '2026-10-31' }]

test('Fahrer mit Protokoll-Link: Name aus dem Stammblatt, freie Namen, ungültige und doppelte Codes fallen weg', () => {
  const alarm = { drivers: [{ id: 'd1', code: CODE, employeeId: 'e1', name: 'alter Name' }, { id: 'd2', code: CODE2, name: ' Aushilfe Winter ' }, { id: 'd3', code: 'kurz', name: 'x' }, { id: 'd4', code: CODE, name: 'doppelt' }, { id: 'd5', code: '0'.repeat(24), name: ' ' }, null] }
  const list = alarmDrivers(alarm, employees, '2026-11-25')
  assert.deepEqual(list, [
    { id: 'd1', code: CODE, name: 'Dragan Jović', employeeId: 'e1', lang: 'bks', phone: '0664 0000001', gone: false },
    { id: 'd2', code: CODE2, name: 'Aushilfe Winter', employeeId: '', lang: '', phone: '', gone: false },
  ])
  assert.deepEqual(alarmDrivers({}, employees), [])
  assert.equal(alarmDrivers({ drivers: [{ code: CODE, employeeId: 'e2' }] }, employees, '2026-11-25')[0].gone, true)
  assert.equal(driverLink('https://app.cleanos.at/', CODE), `https://app.cleanos.at/wetter-alarm.php?aktion=protokoll&f=${CODE}`)
  assert.equal(driverLink('https://app.cleanos.at', CODE), `https://app.cleanos.at/wetter-alarm.php?aktion=protokoll&f=${CODE}`)
  assert.equal(mayWhatsApp('winter-link'), true)
})

test('Alarm-Datei: Fahrer und alle Objekte mit Winterdienst nur, wenn es Fahrer gibt; Ausgeschiedene nicht', () => {
  const base = { topics: { e1: 'wd-1' }, key: 'k'.repeat(64), cronKey: 'c'.repeat(32) }
  const ohne = alarmFile({ alarm: base, locations: locs, objects, employees, address: 'https://app.cleanos.at/', today: '2026-11-25' })
  assert.equal('fahrer' in ohne, false)
  assert.equal('winterObjekte' in ohne, false)
  const mit = alarmFile({ alarm: { ...base, drivers: [{ id: 'd1', code: CODE, employeeId: 'e1' }, { id: 'd2', code: CODE2, employeeId: 'e2' }] }, locations: locs, objects, employees, address: 'https://app.cleanos.at/', today: '2026-11-25' })
  assert.deepEqual(mit.fahrer, [{ code: CODE, name: 'Dragan Jović', sprache: 'bks' }])
  assert.deepEqual(mit.winterObjekte, [
    { id: 'o9', name: 'Werkstatt Hallein', adresse: 'Salzachtalstraße 3, 5400 Hallein', ort: 'Hallein' },
    { id: 'o5', name: 'Wohnanlage Lehen', adresse: 'Lehener Straße 1, 5020 Salzburg', ort: 'Salzburg' },
  ])
  // der übrige Inhalt bleibt gleich (die Datei ändert sich für Betriebe ohne Fahrer-Links nicht)
  const { fahrer, winterObjekte, ...rest } = mit
  assert.deepEqual(rest, ohne)
})

test('Einträge vom Fahrer-Link: mit Objekt, mit freier Adresse; Zeilen fürs Protokoll', () => {
  const p1 = { id: 'a483a473e4a2', datum: '2026-11-25', erledigt: 1795585500, ort: 'Salzburg', objektId: 'o5', objekt: 'Wohnanlage Lehen', adresse: 'Lehener Straße 1, 5020 Salzburg', person: 'Dragan Jović', geraeumt: true, gestreut: true, kontrolle: false, mittel: 'Splitt', notiz: 'Eisplatte', fotos: ['a483a473e4a2-1.jpg', '../boese.jpg'], eingetragen: 1795608660, alarm: '', test: false, quelle: 'fahrer' }
  const p2 = { id: 'b95e7e54bae7', datum: '2026-11-25', erledigt: 1795587000, ort: '', objektId: '', objekt: 'Musterstraße 5, 5020 Salzburg', adresse: 'Musterstraße 5, 5020 Salzburg', person: 'Dragan Jović', kontrolle: true, fotos: [], eingetragen: 1795608660, quelle: 'fahrer' }
  const e1 = fromServer(p1)
  assert.deepEqual([e1.id, e1.objectId, e1.quelle, e1.fotos], ['ha483a473e4a2', 'o5', 'Handy (Fahrer-Link)', [{ datei: 'a483a473e4a2-1.jpg' }]])
  assert.equal(fromServer({ ...p1, quelle: 'alarm' }).quelle, 'Handy')
  const e2 = fromServer(p2)
  assert.deepEqual([e2.objectId, e2.object, e2.address, e2.kontrolle], ['', 'Musterstraße 5, 5020 Salzburg', 'Musterstraße 5, 5020 Salzburg', true])
  assert.equal(freeName(e2), 'Musterstraße 5, 5020 Salzburg')
  assert.equal(freeName({ objectId: '' }), 'andere Adresse')
  const log = Object.fromEntries([e1, e2, { ...e2, id: 'x2', at: '2026-11-25T03:00:00.000Z' }].map((e) => [`${e.date}|${e.objectId}|${e.id}`, e]))
  assert.deepEqual(freeEntriesFor(log, '2026-11-25', 'Musterstraße 5, 5020 Salzburg').map((e) => e.id), ['x2', 'hb95e7e54bae7'])
  assert.deepEqual(freeEntriesFor(log, '2026-11-24', 'Musterstraße 5, 5020 Salzburg'), [])
  // schon übernommene kommen nicht noch einmal
  assert.deepEqual(newFromServer([p1, p2], log).map((e) => e.id), [])
  assert.deepEqual(newFromServer([p1, p2], {}).map((e) => e.id), ['ha483a473e4a2', 'hb95e7e54bae7'])
  const rows = logRows(log, { from: '2026-11-25', to: '2026-11-25', objectsById: new Map(objects.map((o) => [o.id, o])) })
  assert.deepEqual(rows.map((r) => r.objectName).sort(), ['Musterstraße 5, 5020 Salzburg', 'Musterstraße 5, 5020 Salzburg', 'Wohnanlage Lehen'])
  assert.deepEqual([...new Set(rows.map((r) => r.address))].sort(), ['Lehener Straße 1, 5020 Salzburg', 'Musterstraße 5, 5020 Salzburg'])
  assert.equal(rows.length, 3)
})

test('Foto aus der App: Dateiname wie vom Webspace, Pfad in SharePoint auch für freie Adressen', () => {
  assert.equal(photoName('A1B2C3D4E5F6', 2), 'a1b2c3d4e5f6-2.jpg')
  assert.match(photoName('a1b2c3d4e5f6', 1), /^[a-f0-9]{12}-[1-4]\.jpg$/)
  assert.equal(photoPath({ date: '2026-11-25', object: 'Wohnanlage Lehen' }, 'a1b2c3d4e5f6-1.jpg'), 'exporte/Winterdienst/2026-11/2026-11-25_Wohnanlage-Lehen_a1b2c3d4e5f6-1.jpg')
  assert.equal(photoPath({ date: '2026-11-25', object: 'Musterstraße 5, 5020 Salzburg' }, 'a1b2c3d4e5f6-1.jpg'), 'exporte/Winterdienst/2026-11/2026-11-25_Musterstrasse-5-5020-Salzburg_a1b2c3d4e5f6-1.jpg')
})
