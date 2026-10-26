import { test } from 'node:test'
import assert from 'node:assert/strict'

import { todayISO } from '../src/core/dates.js'
import { planLegacyImport } from '../src/core/legacy.js'
import { applySwap, checkReading, correctNumber, duePeriod, findObject, findWaterLists, importMeters, importWaterLists, meterStatus, numberAt, parseValue, periodByKey, periodFor, periodOf, readingRows, readingsCsv, readingsOf, segments, yearCsv, yearRows } from '../src/core/meters.js'

const meter = { id: 'S-test-01', objectId: 'o1', number: 'A100', kind: 'kaltwasser', location: 'Musterstraße 12', interval: 'quartal', history: [] }
const r = (period, date, value, extra = {}) => ({ id: `r-${period}`, meterId: meter.id, period, date, value, ...extra })

test('Zähler: Zeiträume, Schlüssel und Zuordnung zum fälligen Quartal', () => {
  assert.deepEqual(periodOf('2026-11-15'), { key: '2026-Q4', from: '2026-10-01', to: '2026-12-31', label: 'Q4 2026' })
  assert.equal(periodOf('2026-02-10', 'monat').key, '2026-02')
  assert.equal(periodOf('2026-08-01', 'halbjahr').label, '2. Halbjahr 2026')
  assert.equal(periodByKey('2026-Q3').to, '2026-09-30')
  assert.equal(periodByKey('2026-H1').to, '2026-06-30')
  // im Oktober gehört eine Ablesung zu Q3 (bis 60 Tage nach Quartalsende), ab Dezember zu Q4
  assert.equal(periodFor('2026-10-25').key, '2026-Q3')
  assert.equal(periodFor('2026-11-29').key, '2026-Q3')
  assert.equal(periodFor('2026-12-05').key, '2026-Q4')
  assert.equal(periodFor('2026-09-05').key, '2026-Q3')
})

test('Zähler: fällig 30 Tage vor bis 60 Tage nach Quartalsende, Grund ohne Stand zählt als erledigt', () => {
  const readings = [r('2026-Q2', '2026-06-29', 100)]
  const oct = meterStatus(meter, readings, '2026-10-25')
  assert.deepEqual([oct.status, oct.period.key, oct.until], ['faellig', '2026-Q3', '2026-11-29'])
  assert.equal(meterStatus(meter, readings, '2026-12-02').status, 'ueberfaellig')
  const done = [...readings, r('2026-Q3', '2026-10-02', 130)]
  const after = meterStatus(meter, done, '2026-10-25')
  assert.deepEqual([after.status, after.opensAt], ['ok', '2026-12-01'])
  assert.equal(meterStatus(meter, done, '2026-12-03').status, 'faellig')
  const noAccess = [...readings, r('2026-Q3', '2026-10-02', null, { reason: 'kein_zutritt' })]
  assert.equal(meterStatus(meter, noAccess, '2026-10-25').status, 'ok')
  assert.equal(meterStatus(meter, noAccess, '2026-10-25').last.value, 100, 'letzter gültiger Stand')
  assert.equal(meterStatus({ ...meter, state: 'abriss' }, readings, '2026-10-25').status, 'inaktiv')
  assert.equal(meterStatus({ ...meter, installedAt: '2026-10-10' }, [], '2026-10-25').status, 'ok')
  assert.equal(duePeriod(meter, readings, '2026-10-25').key, '2026-Q3')
})

test('Zähler: Plausibilität gegen dasselbe Quartal im Vorjahr (kritisch, hoch, niedrig, leer)', () => {
  // 2025: Q3 hoher Verbrauch (Sommer, 90 m³), sonst 30 m³ je Quartal
  const readings = [r('2024-Q4', '2024-12-31', 1000), r('2025-Q1', '2025-03-31', 1030), r('2025-Q2', '2025-06-30', 1060), r('2025-Q3', '2025-09-30', 1150), r('2025-Q4', '2025-12-31', 1180), r('2026-Q1', '2026-03-31', 1210), r('2026-Q2', '2026-06-30', 1240)]
  const check = (value) => checkReading(meter, readings, { id: 'neu', date: '2026-09-30', value })
  assert.deepEqual(check(1330), [], '90 m³ wie im Vorjahres-Sommer: unauffällig')
  assert.equal(check(1240 + 240)[0].code, 'kritisch')
  assert.equal(check(1240 + 140)[0].code, 'hoch')
  assert.equal(check(1240 + 15)[0].code, 'niedrig')
  assert.equal(check(1240)[0].code, 'leer')
  const neg = check(1200)
  assert.deepEqual([neg[0].code, neg[0].level], ['kritisch', 'error'])
  assert.equal(checkReading(meter, readings, { id: 'n', date: '2026-09-30', value: null, reason: 'kein_zutritt' })[0].code, 'kein_stand')
  // fehlt ein Quartal, wird gegen das Vielfache geprüft
  assert.deepEqual(checkReading(meter, readings.slice(0, 6), { id: 'n', date: '2026-09-30', value: 1210 + 120 }), [])
})

test('Zähler: Tausch rechnet über beide Zähler, unvollständig ohne Endstand/Anfangsstand', () => {
  const readings = [r('2026-Q1', '2026-03-31', 500), r('2026-Q2', '2026-06-30', 530)]
  const swap = { id: 'sw', meterId: meter.id, period: '2026-Q3', date: '2026-09-30', value: 12, swap: { oldNumber: 'A100', newNumber: 'B200', oldEnd: 548, newStart: 2 } }
  assert.equal(segments([...readings, swap]).at(-1).delta, 28)
  assert.equal(checkReading(meter, readings, swap).find((i) => i.code === 'tausch').level, 'info')
  const half = { ...swap, swap: { ...swap.swap, newStart: null } }
  const issues = checkReading(meter, readings, half)
  assert.equal(issues[0].code, 'tausch_unvollstaendig')
  assert.equal(segments([...readings, half]).at(-1).delta, null, 'kein Leckalarm ohne vollständige Werte')
  const z = applySwap({ meters: [meter], readings }, meter.id, swap, { by: 'Ana', at: '2026-09-30T08:00:00Z' })
  const m = z.meters[0]
  assert.deepEqual([m.number, m.history[0].type, m.history[0].from, m.history[0].to], ['B200', 'tausch', 'A100', 'B200'])
  assert.equal(readingsOf(z, meter.id).length, 3)
  const fixed = correctNumber(m, 'B2000', { by: 'Büro', date: '2026-10-01' })
  assert.deepEqual([fixed.number, fixed.history.at(-1).type], ['B2000', 'korrektur'])
})

test('Zähler: Liste und Jahresliste für die Hausverwaltung', () => {
  const z = { meters: [{ ...meter, objektNr: '520001', note: 'Schlüssel im Büro' }], readings: [r('2025-Q4', '2025-12-31', 281), r('2026-Q1', '2026-03-30', 300.5, { by: 'Ana' }), r('2026-Q2', '2026-07-02', null, { reason: 'kein_zutritt' }), r('2026-Q3', '2026-09-29', 340)] }
  const objects = [{ id: 'o1', name: 'EBG Musterort', address: 'Musterort' }]
  const rows = readingRows(z, objects, { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(rows.length, 3)
  assert.deepEqual([rows[0].delta, rows[1].value, rows[1].note, rows[2].delta, rows[2].since], [19.5, null, 'Kein Zutritt', 39.5, '2026-03-30'])
  assert.match(readingsCsv(rows), /EBG Musterort;Musterort;520001;A100;Kaltwasser;Musterstraße 12;Q1 2026;30\.03\.2026;300,5;m³;19,5;31\.12\.2025;;;Ana;/)
  const year = yearRows(z, objects, { year: 2026 })
  assert.deepEqual([year[0].start, year[0].end, year[0].total], [281, 340, 59])
  assert.equal(year[0].quarters[1].note, 'Kein Zutritt')
  const csv = yearCsv(year)
  assert.match(csv, /^﻿Objekt;Objekt Nr\.;Objekt Anschrift;Zähler Nr\.;Ansprechperson \(Hinweis\);Q1 Datum/)
  assert.match(csv, /520001;Musterstraße 12;A100;Schlüssel im Büro;30\.03\.2026;300,5;19,5;;;02\.07\.2026;;;Kein Zutritt;;29\.09\.2026;340;39,5;;;;;;;;281;340;59;/)
})

test('Zähler: Übernahme der Jahreslisten aus dem Wasserzähler-Tool', () => {
  const list = (jahr, extra) => ({
    id: `L-start-musterort-${jahr}`, art: 'wasserablesung', schema: 1, ort: 'Musterort', jahr: String(jahr), auftragsnummer: '12345/67/1', bereich: 'EBG',
    stellen: [
      { id: 'S-musterort-07', objektNr: '520001', anschrift: 'Musterstraße 12', zaehlerNr: jahr === 2026 ? 'A1234567' : '4617', hinweis: 'Schlüssel im Büro', startstand: jahr === 2026 ? '281' : '200', startQuelle: `Q4 ${jahr - 1}`, zustand: 'aktiv',
        verlauf: jahr === 2026 ? [{ zeit: '2026-03-28T09:00:00Z', feld: 'zaehlerNr', von: '4617', nach: 'A1234567', quartal: 'Q1', jahr: '2026', ableser: 'M. E.', art: 'tausch' }] : [] },
      { id: 'S-musterort-08', objektNr: '520001', anschrift: 'Musterstraße 14', zaehlerNr: 'C55', startstand: '10', zustand: jahr === 2026 ? 'abriss' : 'aktiv', verlauf: [] },
    ],
    runden: extra,
  })
  const lists2025 = list(2025, { Q4: { datum: '2025-12-30', ableser: 'M. E.', status: 'abgeschlossen', abgeschlossen: '2026-01-05T10:00:00Z', werte: { 'S-musterort-07': { stand: '281', grund: '', tausch: null, zeit: '2025-12-30T08:00:00Z', fotos: [{ id: 'F-1', name: 'Musterstraße 12_4617.jpg', hoch: true, url: 'https://example.sharepoint.com/f1.jpg' }] } } } })
  const lists2026 = list(2026, {
    Q1: { datum: '2026-03-28', ableser: 'M. E.', status: 'abgeschlossen', werte: { 'S-musterort-07': { stand: '3', grund: '', tausch: { standAlt: '290', startNeu: '0', zaehlerNeu: 'A1234567' }, zeit: '2026-03-28T09:00:00Z', fotos: [] }, 'S-musterort-08': { stand: '', grund: 'kein_zutritt', bem: 'Mieter nicht da' } } },
    Q2: { datum: '2026-06-29', ableser: 'M. E.', status: 'offen', werte: { 'S-musterort-07': { stand: '1.234,5', grund: '' }, 'S-musterort-08': { stand: '', grund: '' } } },
  })
  const backup = { listen: [lists2026, { nested: [lists2025] }] }
  const lists = findWaterLists(backup)
  assert.equal(lists.length, 2)
  const res = importWaterLists(lists, { objects: [], zaehler: { meters: [], readings: [] } })
  assert.deepEqual(res.stats, { lists: 2, objects: 1, meters: 2, readings: 7, photos: 1 }, '4 Ablesungen + 3 Anfangsstände')
  assert.deepEqual([res.objects[0].name, res.objects[0].customer, res.objects[0].orderNo], ['EBG Musterort', 'EBG', '12345/67/1'])
  const m7 = res.meters.find((m) => m.id === 'S-musterort-07')
  assert.deepEqual([m7.number, m7.objektNr, m7.location, m7.note, m7.interval, m7.history.length], ['A1234567', '520001', 'Musterstraße 12', 'Schlüssel im Büro', 'quartal', 1])
  assert.equal(res.meters.find((m) => m.id === 'S-musterort-08').state, 'abriss')
  const byId = new Map(res.readings.map((x) => [x.id, x]))
  assert.deepEqual(byId.get('S-musterort-07-2026-Q1').swap, { oldNumber: '4617', newNumber: 'A1234567', oldEnd: 290, newStart: 0 })
  assert.equal(byId.get('S-musterort-07-2026-Q2').value, 1234.5)
  assert.equal(byId.get('S-musterort-08-2026-Q1').reason, 'kein_zutritt')
  assert.ok(!byId.has('S-musterort-08-2026-Q2'), 'leere Werte werden übersprungen')
  assert.equal(byId.get('S-musterort-07-2025-Q4').photo.url, 'https://example.sharepoint.com/f1.jpg')
  assert.ok(!byId.has('S-musterort-07-2025-Q4-start'), 'Anfangsstand nicht doppelt, wenn Q4 vorhanden')
  assert.equal(byId.get('S-musterort-08-2025-Q4-start').value, 10)
  assert.equal(byId.get('S-musterort-07-2024-Q4-start').value, 200)
  assert.ok(res.closures['o-wz-ebgmusterort|2026-Q1'])
  // Verbrauch über den Tausch: (290 − 281) + (3 − 0) = 12
  assert.equal(segments(readingsOf({ readings: res.readings }, 'S-musterort-07')).find((s) => s.reading.period === '2026-Q1').delta, 12)
  // zweiter Import: nichts doppelt
  const again = importWaterLists(lists, { objects: res.objects, zaehler: { meters: res.meters, readings: res.readings } })
  assert.deepEqual([again.stats.objects, again.stats.meters, again.stats.readings, again.readings.length], [0, 0, 0, res.readings.length])
})

test('Zähler: Import aus Excel und Eingabe mit Komma', () => {
  const objects = [{ id: 'o5', name: 'Wohnanlage Lehen', short: 'Stiegenhaus' }]
  const text = 'Objekt\tZählernummer\tArt\tOrt\tRhythmus\tStand\tDatum\nWohnanlage Lehen\tWZ-1\tWarmwasser\tTop 3\tjährlich\t1.234,5\t31.12.2025\nStiegenhaus\tWZ-2\tKaltwasser\tKeller\t\t\t\nUnbekannt\tX\t\t\t\t\t'
  const { items, errors } = importMeters(text, objects, { today: '2026-10-25' })
  assert.equal(items.length, 2)
  assert.deepEqual(items[0].meter, { objectId: 'o5', number: 'WZ-1', kind: 'warmwasser', location: 'Top 3', unit: 'm³', interval: 'jahr' })
  assert.deepEqual(items[0].reading, { date: '2025-12-31', value: 1234.5 })
  assert.deepEqual([items[1].meter.kind, items[1].meter.interval, items[1].reading], ['kaltwasser', 'quartal', null])
  assert.match(errors[0], /Unbekannt/)
  assert.deepEqual(['1.234,5', '1234.5', ' 12,3 ', '', 'abc', '0', 7].map(parseValue), [1234.5, 1234.5, 12.3, null, null, 0, 7])
})

test('Zähler: neue Ablesung überschreibt keine erledigte Vorrunde', () => {
  const readings = [r('2026-Q2', '2026-06-29', 100)]
  // 25.8. liegt noch im Fenster von Q2 (bis 29.8.), Q2 ist aber erfasst: zählt zu Q3
  assert.equal(duePeriod(meter, readings, '2026-08-25').key, '2026-Q3')
  assert.equal(duePeriod(meter, [], '2026-08-25').key, '2026-Q2')
})

test('Zähler: Ablesung vor dem Fenster erledigt den Zeitraum nicht, Stand nach „kein Zutritt“ gehört zur Vorrunde', () => {
  // Q3: am 2.10. kein Zutritt, am 20.10. Stand nachgetragen → Q3 (nicht Q4); Q4 bleibt zum Jahresende fällig
  const readings = [r('2026-Q2', '2026-06-29', 100), r('2026-Q3', '2026-10-02', null, { reason: 'kein_zutritt' })]
  assert.equal(duePeriod(meter, readings, '2026-10-20').key, '2026-Q3')
  const early = [...readings, { ...r('2026-Q4', '2026-10-20', 130), id: 'x' }]
  assert.equal(meterStatus(meter, early, '2026-12-15').status, 'faellig', 'Oktober-Ablesung erledigt Q4 nicht')
  // Tausch mitten im Quartal: die Ablesung zum Stichtag bleibt fällig
  const base = [r('2026-Q2', '2026-06-29', 500)]
  const p = duePeriod(meter, base, '2026-08-10')
  const swap = { id: 'sw', meterId: meter.id, period: p.key, date: '2026-08-10', value: 3, swap: { oldNumber: 'A100', newNumber: 'B200', oldEnd: 520, newStart: 0 } }
  assert.deepEqual([p.key, meterStatus(meter, [...base, swap], '2026-09-15').status], ['2026-Q3', 'faellig'])
  // reguläre Ablesung im selben Quartal: Verbrauch über Tausch und Ablesung, auch in der Jahresliste
  const all = [...base, swap, { ...r('2026-Q3', '2026-09-30', 25), id: 'q3' }]
  assert.equal(segments(all).filter((s) => s.reading.period === '2026-Q3').reduce((x, s) => x + s.delta, 0), 45)
  assert.deepEqual([yearRows({ meters: [meter], readings: all }, [], { year: 2026 })[0].quarters[2].delta, meterStatus(meter, all, '2026-10-05').status], [45, 'ok'])
})

test('Zähler: Tausch ohne Stand gilt beim nächsten Stand, Liste nennt die Nummer zum Ablesedatum', () => {
  const list = { art: 'wasserablesung', ort: 'Haus', jahr: '2026', stellen: [{ id: 'S9', zaehlerNr: 'B200' }], runden: {
    Q1: { datum: '2026-03-30', werte: { S9: { stand: '500' } } },
    Q2: { datum: '2026-06-29', werte: { S9: { stand: '', tausch: { standAlt: '520', startNeu: '0', zaehlerNeu: 'B200' } } } },
    Q3: { datum: '2026-09-29', werte: { S9: { stand: '30' } } },
  } }
  const res = importWaterLists([list], { objects: [{ id: 'o1', name: 'Haus' }], zaehler: { meters: [], readings: [] } })
  const all = readingsOf({ readings: res.readings }, 'S9')
  assert.equal(segments(all).find((s) => s.reading.period === '2026-Q3').delta, 50, '(520 − 500) + (30 − 0), nicht −470')
  assert.ok(!checkReading(res.meters[0], all, all.at(-1)).some((i) => i.code === 'kritisch'), 'kein negativer Verbrauch')
  // Nummer zum Ablesedatum: vor dem Tausch die alte; Berichtigung gilt auch rückwirkend
  let z = { meters: [{ ...meter }], readings: [r('2026-Q1', '2026-03-31', 500)] }
  z = applySwap(z, meter.id, { id: 'sw', meterId: meter.id, period: '2026-Q2', date: '2026-06-30', value: 12, swap: { oldNumber: 'A100', newNumber: 'B200', oldEnd: 540, newStart: 2 } }, { at: '2026-06-30T08:00:00Z' })
  const rows = readingRows(z, [], { from: '2026-01-01', to: '2026-12-31' })
  assert.deepEqual(rows.map((x) => [x.date, x.number]), [['2026-03-31', 'A100'], ['2026-06-30', 'B200']])
  assert.equal(numberAt(correctNumber(z.meters[0], 'B2000', { date: '2026-07-01' }), '2026-07-15'), 'B2000')
  // spätere Ablesung am neuen Zähler ist kein Fehler „größer als später“ für die alte
  const later = [...readingsOf(z, meter.id), r('2026-Q3', '2026-09-30', 40)]
  assert.deepEqual(checkReading(meter, later, later[0]).filter((i) => i.code === 'spaeter'), [])
  assert.equal(checkReading(meter, later, { ...later[0], value: 600 })[0].code, 'spaeter', 'über dem Endstand alt (540)')
})

test('Zähler: Import erkennt Wärme und Quartal, ordnet Objekte nur genau zu, meldet unlesbares Datum', () => {
  const objects = [{ id: 'o10', name: 'Musterstraße 10' }, { id: 'oX', name: 'Wohnanlage Lehen' }]
  const imp = (obj, art, rh, extra = '') => importMeters(`Objekt\tZählernummer\tArt\tRhythmus\tStand\tDatum\n${obj}\tZ-1\t${art}\t${rh}\t${extra}`, objects, { today: '2026-10-26' })
  assert.deepEqual(['Wärme', 'Wärmezähler', 'Fernwärme', 'Warmwasser', 'Warmes Wasser'].map((a) => imp('Wohnanlage Lehen', a, '').items[0].meter.kind), ['waerme', 'waerme', 'waerme', 'warmwasser', 'warmwasser'])
  assert.equal(imp('Wohnanlage Lehen', 'Wärme', '').items[0].meter.unit, 'kWh')
  assert.deepEqual(['vierteljährlich', 'alle 3 Monate', 'halbjährlich', 'alle 6 Monate', 'jährlich', 'monatlich', 'alle 12 Monate'].map((x) => imp('Wohnanlage Lehen', 'Kaltwasser', x).items[0].meter.interval), ['quartal', 'quartal', 'halbjahr', 'halbjahr', 'jahr', 'monat', 'jahr'])
  const unknown = imp('Musterstraße 1', 'Kaltwasser', '')
  assert.deepEqual([unknown.items.length, unknown.errors], [0, ['Zeile 2: Objekt „Musterstraße 1“ nicht gefunden']], 'nicht bei „Musterstraße 10“')
  assert.equal(findObject([{ id: 'x', name: 'Bürohaus Salzburg' }], 'A'), null)
  assert.equal(findObject(objects, 'musterstrasse 10').id, 'o10', 'ß = ss')
  assert.deepEqual(imp('Wohnanlage Lehen', 'Kaltwasser', '', '12\t31.11.2026').errors, ['Zeile 2: Datum „31.11.2026“ nicht lesbar (TT.MM.JJJJ)'])
  assert.deepEqual(imp('Wohnanlage Lehen', 'Kaltwasser', '', '12\t31.12.25').items[0].reading, { date: '2025-12-31', value: 12 })
  assert.deepEqual(imp('Wohnanlage Lehen', 'Kaltwasser', '', '12\t').items[0].reading, { date: '2026-10-26', value: 12 }, 'ohne Datum: heute')
  // Übernahme: unbekannter Standort wird eigenes Objekt
  const res = importWaterLists([{ art: 'wasserablesung', ort: 'Musterstraße 1', jahr: '2026', stellen: [{ id: 'S-1', zaehlerNr: 'A1' }], runden: {} }], { objects, zaehler: { meters: [], readings: [] } })
  assert.deepEqual([res.objects.length, res.meters[0].objectId], [1, 'o-wz-musterstrasse1'])
})

test('Zähler: Übernahme ohne doppelten Anfangsstand, mit eindeutigen IDs, ohne den Bestand zu ändern', () => {
  const list = (jahr, start, runden) => ({ art: 'wasserablesung', ort: 'Musterort', jahr: String(jahr), stellen: [{ id: 'S-1', zaehlerNr: 'A1', startstand: String(start) }], runden })
  const l2026 = list(2026, 281, { Q1: { datum: '2026-03-30', werte: { 'S-1': { stand: '300' } } } })
  const l2025 = list(2025, 200, { Q4: { datum: '2025-12-20', werte: { 'S-1': { stand: '281' } } } })
  const first = importWaterLists([l2026], { objects: [], zaehler: { meters: [], readings: [] } })
  assert.ok(first.readings.some((x) => x.id === 'S-1-2025-Q4-start'))
  const second = importWaterLists([l2025], { objects: first.objects, zaehler: { meters: first.meters, readings: first.readings } })
  assert.deepEqual(second.readings.filter((x) => x.period === '2025-Q4').map((x) => x.id), ['S-1-2025-Q4'], 'echte Q4-Ablesung ersetzt den Anfangsstand')
  // lange, ähnliche Standorte: verschiedene Objekt-IDs
  const long = (nr) => ({ art: 'wasserablesung', ort: `Wohnanlage Salzburg Lehen Ignaz-Harrer-Straße ${nr}`, jahr: '2026', stellen: [{ id: `S-${nr}`, zaehlerNr: `Z${nr}` }], runden: {} })
  const two = importWaterLists([long(12), long(14)])
  assert.equal(new Set(two.objects.map((o) => o.id)).size, 2)
  assert.notEqual(two.meters[0].objectId, two.meters[1].objectId)
  // Vorschau ändert keine vorhandene Ablesung
  const reading = { id: 'r-app', meterId: 'S-1', period: '2026-Q2', date: '2026-06-30', value: 5, swap: { oldNumber: '', newNumber: 'B2', oldEnd: 310, newStart: 0 } }
  const current = { objects: first.objects, mappe: { objects: {} }, kontrolle: { inspections: [] }, zaehler: { meters: [{ ...first.meters[0], history: [{ type: 'tausch', from: 'A1', to: 'B2', date: '2026-06-30' }] }], readings: [reading] } }
  const plan = planLegacyImport({ water: [l2026], customers: [], objects: [], inspections: [], akten: [], templates: [] }, current)
  assert.equal(reading.swap.oldNumber, '', 'Bestand unverändert')
  assert.equal(plan.zaehler.readings.find((x) => x.id === 'r-app').swap.oldNumber, 'A1', 'im Ergebnis ergänzt')
})

test('Zähler: Zählernummer als Zahl, Berichtigung mit Ortsdatum', () => {
  const list = { art: 'wasserablesung', ort: 'Haus', jahr: '2026', stellen: [{ id: 'S-1', zaehlerNr: 4617 }, { id: 'S-2', zaehlerNr: 4618 }], runden: { Q1: { datum: '2026-03-30', werte: { 'S-1': { stand: '1' }, 'S-2': { stand: '2' } } } } }
  const res = importWaterLists([list])
  assert.deepEqual(readingRows({ meters: res.meters, readings: res.readings }, res.objects, { from: '2026-01-01', to: '2026-12-31' }).map((x) => x.number), ['4617', '4618'])
  assert.deepEqual(yearRows({ meters: res.meters, readings: res.readings }, res.objects, { year: 2026 }).map((x) => x.number), ['4617', '4618'])
  // 1.1.2027 00:30 in Wien (= 31.12.2026 23:30 UTC): Berichtigung am 1.1.2027
  const tz = process.env.TZ
  const RealDate = globalThis.Date
  process.env.TZ = 'Europe/Vienna'
  try {
    const fixed = new RealDate(2027, 0, 1, 0, 30).getTime()
    globalThis.Date = class extends RealDate {
      constructor(...a) {
        super(...(a.length ? a : [fixed]))
      }
      static now() {
        return fixed
      }
    }
    assert.equal(correctNumber(meter, 'A1000', { by: 'Büro' }).history[0].date, todayISO())
    assert.equal(todayISO(), '2027-01-01')
  } finally {
    globalThis.Date = RealDate
    if (tz === undefined) delete process.env.TZ
    else process.env.TZ = tz
  }
})
