// Regeln mit Jahresbezug: Lohngruppen anlegen und entfernen (auch eine der Vorgabe), lesbare Reihenfolge, und die
// Jahresprüfung, die ab 1. Dezember an KV-Löhne und steuerfreie Überstunden des kommenden Jahres erinnert.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanWageGroup, DEFAULT_RULES, mergeRules, resetRules, rulesTargetYear, rulesYearCheck, wageGroups } from '../src/core/rules.js'

test('Lohngruppen: eigene Gruppe kommt dazu, entfernte (null) bleibt weg, Reihenfolge 1, 2, 3, 3b, 4', () => {
  const merged = mergeRules({ wages: { '3b': 13.1, 6: null, 2: 14 } })
  assert.deepEqual(wageGroups(merged.wages), ['1', '2', '3', '3b', '4', '5'])
  assert.equal(merged.wages['3b'], 13.1)
  assert.equal(merged.wages[2], 14, 'eigener Wert vor der Vorgabe')
  assert.equal('6' in merged.wages, false, 'entfernte Gruppe der Vorgabe kommt beim Mischen nicht wieder')
  assert.deepEqual(wageGroups(mergeRules({}).wages), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(wageGroups(null), [])
})

test('Lohngruppen: Name kurz, nur Ziffern und Buchstaben', () => {
  assert.equal(cleanWageGroup(' 3b '), '3b')
  assert.equal(cleanWageGroup('Lohngruppe 3b'), '3b')
  assert.equal(cleanWageGroup('7'), '7')
  assert.equal(cleanWageGroup(''), '')
  assert.equal(cleanWageGroup('3 b'), '')
  assert.equal(cleanWageGroup('3.b'), '')
  assert.equal(cleanWageGroup('zulangername'), '')
  assert.equal(cleanWageGroup(null), '')
})

test('Jahresprüfung: Zieljahr ist ab 1. Dezember das kommende Jahr', () => {
  assert.equal(rulesTargetYear('2026-11-30'), 2026)
  assert.equal(rulesTargetYear('2026-12-01'), 2027)
  assert.equal(rulesTargetYear('2027-01-01'), 2027)
  assert.equal(rulesTargetYear('2027-06-15'), 2027)
})

test('Jahresprüfung: offen, bis das Zieljahr als geprüft vermerkt ist', () => {
  assert.equal(DEFAULT_RULES.yearChecked, 2026, 'Stand der mitgelieferten Werte')
  // im November 2026 mit den Vorgaben: nichts offen
  assert.equal(rulesYearCheck(mergeRules({}), '2026-11-22'), null)
  // ab 1. Dezember für 2027 offen, auch noch im Lauf von 2027
  assert.deepEqual(rulesYearCheck(mergeRules({}), '2026-12-01'), { year: 2027, checked: 2026 })
  assert.deepEqual(rulesYearCheck(mergeRules({}), '2027-03-10'), { year: 2027, checked: 2026 })
  // vermerkt: erledigt bis zum nächsten Dezember
  assert.equal(rulesYearCheck(mergeRules({ yearChecked: 2027 }), '2026-12-15'), null)
  assert.equal(rulesYearCheck(mergeRules({ yearChecked: 2027 }), '2027-11-30'), null)
  assert.deepEqual(rulesYearCheck(mergeRules({ yearChecked: 2027 }), '2027-12-01'), { year: 2028, checked: 2027 })
  // erst Jahre später eingerichtet: der Stand der Vorgaben zählt
  assert.deepEqual(rulesYearCheck({}, '2028-05-01'), { year: 2028, checked: 2026 })
  assert.deepEqual(rulesYearCheck(undefined, '2028-05-01'), { year: 2028, checked: 2026 })
  // „Standardwerte“ setzt auch den Vermerk zurück: die Vorgaben sind der Stand 2026
  assert.equal(resetRules({ yearChecked: 2030, wages: { 1: 99 } }).yearChecked, 2026)
})
