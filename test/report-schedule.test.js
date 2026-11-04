// Berichte automatisch per E-Mail: Termine, Fälligkeit, Nachholen, Wiederholen nach Fehler.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDue, lastSlot, mayRetry, nextSlot, rhythmText, viennaNow } from '../src/core/report-schedule.js'

// 2026-11-02 ist ein Montag
const at = (day, hour) => ({ day, hour })

test('wöchentlich: Montag ab 7 Uhr', () => {
  const abo = { rhythm: 'woche', weekday: 1, hour: 7 }
  assert.equal(lastSlot(abo, at('2026-11-02', 6)), '2026-10-26', 'vor 7 Uhr gilt der Montag davor')
  assert.equal(lastSlot(abo, at('2026-11-02', 7)), '2026-11-02')
  assert.equal(lastSlot(abo, at('2026-11-05', 1)), '2026-11-02', 'Donnerstag → Montag')
  assert.equal(lastSlot(abo, at('2026-11-08', 23)), '2026-11-02', 'Sonntag → Montag')
  assert.equal(nextSlot(abo, at('2026-11-04', 10)), '2026-11-09')
})

test('wöchentlich: Freitag, Wochentag wird begrenzt', () => {
  assert.equal(lastSlot({ rhythm: 'woche', weekday: 5, hour: 14 }, at('2026-11-02', 9)), '2026-10-30')
  assert.equal(lastSlot({ rhythm: 'woche', weekday: 99, hour: 7 }, at('2026-11-08', 9)), '2026-11-08', 'über 7 → Sonntag')
  assert.equal(lastSlot({ rhythm: 'woche', hour: 7 }, at('2026-11-03', 9)), '2026-11-02', 'ohne Wochentag: Montag')
})

test('jeden Werktag: Wochenende springt auf Freitag', () => {
  const abo = { rhythm: 'werktag', hour: 6 }
  assert.equal(lastSlot(abo, at('2026-11-03', 6)), '2026-11-03')
  assert.equal(lastSlot(abo, at('2026-11-03', 5)), '2026-11-02')
  assert.equal(lastSlot(abo, at('2026-11-07', 12)), '2026-11-06', 'Samstag → Freitag')
  assert.equal(lastSlot(abo, at('2026-11-09', 5)), '2026-11-06', 'Montag früh → Freitag')
  assert.equal(nextSlot(abo, at('2026-11-06', 12)), '2026-11-09')
})

test('monatlich am 1.', () => {
  const abo = { rhythm: 'monat', hour: 8 }
  assert.equal(lastSlot(abo, at('2026-11-01', 9)), '2026-11-01')
  assert.equal(lastSlot(abo, at('2026-11-01', 7)), '2026-10-01')
  assert.equal(lastSlot(abo, at('2026-11-20', 0)), '2026-11-01')
  assert.equal(lastSlot(abo, at('2027-01-01', 1)), '2026-12-01', 'über den Jahreswechsel')
  assert.equal(nextSlot(abo, at('2026-11-20', 9)), '2026-12-01')
})

test('fällig: einmal je Termin, verpasste nur einmal nachholen, nicht vor dem Anlegen', () => {
  const abo = { rhythm: 'woche', weekday: 1, hour: 7, to: 'chef@firma.at', since: '2026-10-01' }
  assert.equal(isDue(abo, at('2026-11-02', 8)), true)
  assert.equal(isDue({ ...abo, lastSent: '2026-11-02' }, at('2026-11-04', 8)), false)
  assert.equal(isDue({ ...abo, lastSent: '2026-10-05' }, at('2026-11-04', 8)), true, 'Wochen verpasst: einmal nachholen')
  assert.equal(isDue({ ...abo, since: '2026-11-03' }, at('2026-11-04', 8)), false, 'am Dienstag angelegt: erst nächsten Montag')
  assert.equal(isDue({ ...abo, since: '2026-11-03' }, at('2026-11-09', 7)), true)
  assert.equal(isDue({ ...abo, active: false }, at('2026-11-02', 8)), false)
  assert.equal(isDue({ ...abo, to: '  ' }, at('2026-11-02', 8)), false, 'ohne Empfänger nie')
})

test('nach einem Fehler erst nach 6 Stunden wieder versuchen', () => {
  const now = new Date('2026-11-02T10:00:00Z')
  assert.equal(mayRetry({}, now), true)
  assert.equal(mayRetry({ lastError: 'x', lastTry: '2026-11-02T07:00:00Z' }, now), false)
  assert.equal(mayRetry({ lastError: 'x', lastTry: '2026-11-02T04:00:00Z' }, now), true)
})

test('Text für den Rhythmus', () => {
  assert.equal(rhythmText({ rhythm: 'woche', weekday: 1, hour: 7 }), 'jeden Montag ab 7 Uhr')
  assert.equal(rhythmText({ rhythm: 'werktag', hour: 6 }), 'jeden Werktag ab 6 Uhr')
  assert.equal(rhythmText({ rhythm: 'monat', hour: 8 }), 'am 1. jedes Monats ab 8 Uhr')
})

test('Wiener Zeit: Sommerzeit und Winterzeit', () => {
  assert.deepEqual(viennaNow(new Date('2026-11-02T06:30:00Z')), { day: '2026-11-02', hour: 7 })
  assert.deepEqual(viennaNow(new Date('2026-07-01T22:30:00Z')), { day: '2026-07-02', hour: 0 })
})
