// Schnee-Alarm: verschiedene Personen, Orte und Alarme (je Ort was weckt und eigene Regeln, je Person welche Alarme),
// Weckruf wiederholen, Übersicht „auf einen Blick“ und Bestätigung ans Büro. Der Ablauf am Server läuft in
// pruefung/schnee_alarm_php.mjs (Abschnitte 11 und 12). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ALARM_DEFAULTS, ALARM_FOR, ALARM_TYPES, alarmFile, alarmPlace, overviewLink, placeRules } from '../src/core/weather.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const loc = { name: 'Salzburg', lat: 47.8095, lon: 13.055 }
const employees = [{ id: 'e1', name: 'Dragan Jović' }, { id: 'e2', name: 'Mehmet Yılmaz' }, { id: 'e3', name: 'Ana Popescu' }]
const base = { key: 'k'.repeat(64), cronKey: 'c'.repeat(32), enabled: true, topics: { e1: 'wd-1', e2: 'wd-2', e3: 'wd-3' } }
const file = (alarm) => alarmFile({ alarm: { ...base, ...alarm }, locations: [loc], objects: [], employees, address: 'https://app.example/', today: '2026-11-25' })

test('Eigene Regeln eines Orts: nur gesetzte, gültige Werte, Grenzen eingehalten, Ruhezeit nur vollständig', () => {
  assert.deepEqual(placeRules({}), {})
  assert.deepEqual(placeRules(undefined), {})
  assert.deepEqual(placeRules({ snowCm: 1, leadHours: 5, escalateMin: 20, quietFrom: '22:00', quietTo: '04:00' }), { vorlaufStunden: 5, schneeCm: 1, eskalationMinuten: 20, ruheVon: '22:00', ruheBis: '04:00' })
  assert.deepEqual(placeRules({ snowCm: '', leadHours: 40, escalateMin: 1, quietFrom: '22:00' }), { vorlaufStunden: 12, eskalationMinuten: 5 }, 'leer weg, zu groß und zu klein begrenzt, halbe Ruhezeit weg')
  assert.deepEqual(placeRules({ snowCm: 'viel' }), {})
})

test('Ort ohne eigene Einstellungen: Datei wie bisher (keine arten, keine regeln, kein bei)', () => {
  const f = file({ places: { Salzburg: { active: true, level1: ['e1', 'e2'], level2: [] } } })
  assert.equal('arten' in f.orte[0], false)
  assert.equal('regeln' in f.orte[0], false)
  assert.ok(f.orte[0].stufe1.every((p) => !('bei' in p)))
  assert.deepEqual(alarmPlace({ places: { Salzburg: { active: true, level1: ['e1'], level2: [] } } }, loc, [], [loc]), { active: true, level1: ['e1'], level2: [], rotate: false })
})

test('Je Ort: was weckt und eigene Regeln; je Person: welche Alarme (bei wöchentlichem Wechsel nicht)', () => {
  const places = { Salzburg: { active: true, level1: ['e1', 'e2', 'e3'], level2: [], types: { schnee: true, glaette: false, warnung: true }, bei: { e1: 'schnee', e2: 'glaette', e3: 'unbekannt' }, rules: { snowCm: 1, leadHours: '' } } }
  const f = file({ places })
  assert.deepEqual(f.orte[0].arten, ['schnee', 'warnung'])
  assert.deepEqual(f.orte[0].regeln, { schneeCm: 1 })
  assert.deepEqual(f.orte[0].stufe1.map((p) => p.bei ?? ''), ['schnee', 'glaette', ''], 'unbekannte Angabe heißt: alle Alarme')
  const rot = file({ places: { Salzburg: { ...places.Salzburg, rotate: true } } })
  assert.equal(rot.orte[0].wechsel, 'woche')
  assert.ok(rot.orte[0].stufe1.every((p) => !('bei' in p)), 'die Person der Woche bekommt alles')
  assert.equal('arten' in file({ places: { Salzburg: { ...places.Salzburg, types: { schnee: true, glaette: true, warnung: true } } } }).orte[0], false, 'alle drei: kein Eintrag')
  assert.deepEqual(Object.keys(ALARM_TYPES), ['schnee', 'glaette', 'warnung'])
  assert.deepEqual(Object.keys(ALARM_FOR), ['', 'schnee', 'glaette'])
  // der Webspace kennt dieselben Arten
  assert.match(read('wetter-alarm.php'), /const ALARM_ARTEN = \['schnee', 'glaette', 'warnung'\];/)
})

test('Weckruf wiederholen: Vorgabe alle 3 Minuten, höchstens 5-mal; 0 schaltet aus', () => {
  assert.deepEqual([ALARM_DEFAULTS.repeatMin, ALARM_DEFAULTS.repeats], [3, 5])
  assert.deepEqual([file({}).regeln.wiederholenMinuten, file({}).regeln.wiederholungen], [3, 5])
  assert.deepEqual([file({ repeatMin: 0, repeats: 2 }).regeln.wiederholenMinuten, file({ repeatMin: 0, repeats: 2 }).regeln.wiederholungen], [0, 2])
  const php = read('wetter-alarm.php')
  assert.match(php, /'wiederholenMinuten' => 3, 'wiederholungen' => 5\]/)
  const teil = php.slice(php.indexOf('// niemand bestätigt: den Push wiederholen'), php.indexOf('// niemand bestätigt: Stufe 2'))
  assert.ok(teil.includes('$frisch') && teil.includes("empty($alarm['test'])") && teil.includes("!$alarm['wach']"), 'nur frische, echte, unbestätigte Alarme')
  assert.ok(teil.includes('(string) $tk, false)'), 'dieselben Codes, nur Push (ohne SMS, WhatsApp, E-Mail)')
})

test('Übersicht „auf einen Blick“ und Bestätigung ans Büro: Link mit Code, in der Datei nur, wenn gesetzt', () => {
  assert.equal(overviewLink('https://app.example/app', 'a1b2c3d4e5f6a1b2c3d4e5f6'), 'https://app.example/app/wetter-alarm.php?aktion=blick&k=a1b2c3d4e5f6a1b2c3d4e5f6')
  assert.equal(overviewLink('https://app.example/', ''), '')
  assert.equal(overviewLink('https://app.example/', 'kurz'), '')
  const f = file({ blick: 'a1b2c3d4e5f6a1b2c3d4e5f6' })
  assert.equal(f.blick, 'a1b2c3d4e5f6a1b2c3d4e5f6')
  assert.equal(f.bestaetigungAnBuero, true, 'Vorgabe: an')
  assert.equal('bestaetigungAnBuero' in file({ confirmToOffice: false }), false)
  assert.equal('blick' in file({ blick: 'falsch' }), false)
  const php = read('wetter-alarm.php')
  const seite = php.slice(php.indexOf("if ($aktion === 'blick') {"), php.indexOf('// „Handy einrichten“'))
  assert.ok(seite.includes("hash_equals((string) $e['blick'], $k)") && seite.includes("header('Refresh: 60')") && seite.includes("'X-Robots-Tag: noindex, nofollow'"))
  assert.ok(php.indexOf("if ($aktion === 'blick') {") < php.indexOf("ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch'])"), 'mit dem Code, ohne Schlüssel der App')
  assert.match(php, /\$wer\[2\] && !empty\(\$e\['bestaetigungAnBuero'\]\)/, 'nur beim ersten Tippen')
})
