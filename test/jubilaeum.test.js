import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anniversary, daysText, jubilees, JUBILEE_YEARS, serviceYears } from '../src/core/jubilaeum.js'

const emp = (id, entryDate, more = {}) => ({ id, name: `Person ${id}`, entryDate, ...more })

test('Jahrestag: gleicher Tag im Jahr, 29.2. in Jahren ohne Schalttag am 28.2.', () => {
  assert.equal(anniversary('2016-12-05', 2026), '2026-12-05')
  assert.equal(anniversary('2016-02-29', 2026), '2026-02-28')
  assert.equal(anniversary('2016-02-29', 2028), '2028-02-29')
  assert.equal(anniversary('2000-02-29', 2100), '2100-02-28', '2100 ist kein Schaltjahr')
})

test('Dienstjahre: volle Jahre am Stichtag', () => {
  assert.equal(serviceYears('2016-12-05', '2026-12-04'), 9)
  assert.equal(serviceYears('2016-12-05', '2026-12-05'), 10)
  assert.equal(serviceYears('2026-11-02', '2026-11-21'), 0)
  assert.equal(serviceYears('2026-11-02', '2026-11-01'), null, 'vor dem Eintritt')
  assert.equal(serviceYears('', '2026-11-21'), null)
  assert.equal(serviceYears('2016-02-29', '2026-02-28'), 10)
})

test('Jubiläen: nur runde Jahre im Fenster, sortiert nach Datum', () => {
  const today = '2026-11-21'
  const list = jubilees(
    [
      emp('a', '2016-12-05'), // 10 Jahre in 14 Tagen
      emp('b', '2021-11-21'), // 5 Jahre heute
      emp('c', '2025-11-19'), // 1 Jahr vor 2 Tagen
      emp('d', '2025-11-18'), // 1 Jahr vor 3 Tagen: außerhalb
      emp('e', '2016-12-06'), // 10 Jahre in 15 Tagen: außerhalb
      emp('f', '2019-11-25'), // 7 Jahre: nicht rund
      emp('g', ''), // ohne Eintritt
      emp('h', '2026-11-25'), // heuer eingetreten: 0 Jahre
    ],
    today,
  )
  assert.deepEqual(list.map((x) => [x.emp.id, x.years, x.date, x.days]), [['c', 1, '2026-11-19', -2], ['b', 5, '2026-11-21', 0], ['a', 10, '2026-12-05', 14]])
  assert.ok(list.every((x) => !x.sixthWeek))
})

test('Jubiläen: über den Jahreswechsel, 29.2., ausgetreten, sechste Urlaubswoche ab 25 Jahren', () => {
  // Fenster reicht ins neue Jahr
  assert.deepEqual(jubilees([emp('a', '2022-01-03')], '2026-12-28').map((x) => [x.years, x.date, x.days]), [[5, '2027-01-03', 6]])
  // Fenster beginnt im alten Jahr
  assert.deepEqual(jubilees([emp('a', '2021-12-31')], '2027-01-01').map((x) => [x.years, x.date, x.days]), [[5, '2026-12-31', -1]])
  // 29.2.
  assert.deepEqual(jubilees([emp('a', '2016-02-29')], '2026-02-20').map((x) => [x.years, x.date]), [[10, '2026-02-28']])
  // am Jahrestag schon ausgetreten: kein Hinweis; Austritt am Jahrestag oder später: Hinweis
  assert.equal(jubilees([emp('a', '2016-12-05', { exitDate: '2026-11-30' })], '2026-11-21').length, 0)
  assert.equal(jubilees([emp('a', '2016-12-05', { exitDate: '2026-12-05' })], '2026-11-21').length, 1)
  // 25 und 30 Jahre: Hinweis auf die sechste Urlaubswoche
  const old = jubilees([emp('a', '2001-11-25'), emp('b', '1996-11-26'), emp('c', '2006-11-27')], '2026-11-21')
  assert.deepEqual(old.map((x) => [x.emp.id, x.years, x.sixthWeek]), [['a', 25, true], ['b', 30, true], ['c', 20, false]])
  // eigene Auswahl an Jahren, eigenes Fenster
  assert.deepEqual(jubilees([emp('a', '2023-11-25')], '2026-11-21', { years: [3] }).map((x) => x.years), [3])
  assert.equal(jubilees([emp('a', '2016-12-05')], '2026-11-21', { lead: 7 }).length, 0)
  assert.deepEqual(jubilees([emp('a', '2016-12-05')], 'kein Datum'), [])
  assert.ok(JUBILEE_YEARS.includes(25) && JUBILEE_YEARS[0] === 1)
})

test('Text für den Abstand', () => {
  assert.deepEqual([0, 1, -1, 5, -2].map(daysText), ['heute', 'morgen', 'gestern', 'in 5 Tagen', 'vor 2 Tagen'])
})
