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
  assert.ok(teil.includes('$frisch') && teil.includes("empty($alarm['test'])") && teil.includes('!runde_bestaetigt($alarm)'), 'nur frische, echte, unbestätigte Alarme')
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

test('Schnee-Alarm aus: die Datei für den Server hat keine Orte (der Server weckt niemanden), Fahrer-Links bleiben', () => {
  const places = { Salzburg: { active: true, level1: ['e1'], level2: [] } }
  assert.equal(file({ places }).orte.length, 1)
  assert.deepEqual(file({ places, enabled: false }).orte, [])
  assert.equal(file({ places, enabled: false }).schluessel, 'k'.repeat(64), 'Schlüssel bleibt, damit die App den Webspace weiter erreicht')
})

test('Ort ohne angehakte Lage weckt nie: fällt aus der Datei (statt „alles“ am Server)', () => {
  const f = file({ places: { Salzburg: { active: true, level1: ['e1'], level2: [], types: { schnee: false, glaette: false, warnung: false } } } })
  assert.deepEqual(f.orte, [])
  assert.match(read('wetter-alarm.php'), /array_key_exists\('arten', \$ort\) \? array_values\(array_intersect\(ALARM_ARTEN, \(array\) \$ort\['arten'\]\)\) : ALARM_ARTEN/, 'auch der Server: leere Liste heißt keine Lage')
})

test('Wen der Server weckt (für Probe, Einladung, Blätter): eingeschaltete Orte mit Lage, ohne Ausgetretene', async () => {
  const { alarmPeople, leftCompany, noTypes } = await import('../src/core/weather.js')
  const locs = [loc, { name: 'Hallein', lat: 47.68, lon: 13.1 }]
  const emps = [...employees, { id: 'e4', name: 'Weg', exitDate: '2026-10-31' }]
  const alarm = { places: { Salzburg: { active: true, level1: ['e1', 'e4'], level2: ['e2'] }, Hallein: { active: false, level1: ['e3'], level2: [] } } }
  assert.deepEqual([...alarmPeople(alarm, locs, [], emps, '2026-11-25')].sort(), ['e1', 'e2'])
  assert.deepEqual([...alarmPeople({ ...alarm, enabled: false }, locs, [], emps, '2026-11-25')], [])
  assert.deepEqual([...alarmPeople({ places: { Salzburg: { ...alarm.places.Salzburg, types: { schnee: false, glaette: false, warnung: false } } } }, [loc], [], emps, '2026-11-25')], [])
  assert.equal(leftCompany({ exitDate: '2026-11-24' }, '2026-11-25'), true)
  assert.equal(leftCompany({ exitDate: '2026-11-25' }, '2026-11-25'), false, 'am letzten Tag noch dabei')
  assert.equal(noTypes({ types: { schnee: false, glaette: true, warnung: false } }), false)
})

test('Server: neue Lage im laufenden Alarm, Runden, Stufe 1 abwesend, alte Codes (Regeln am Quelltext)', () => {
  const php = read('wetter-alarm.php')
  assert.match(php, /function runde_bestaetigt\(array \$alarm\): bool/)
  assert.match(php, /array_diff\(\$lage\['arten'\], \(array\) \(\$alarm\['arten'\] \?\? \$lage\['arten'\]\)\)/, 'neue Lage gegen die Lage des Alarms')
  assert.match(php, /if \(!\$leute && !empty\(\$ort\['stufe1'\]\) && !empty\(\$ort\['stufe2'\]\)\)/, 'alle abwesend: gleich Stufe 2')
  assert.match(php, /jetzt\(\) - \(int\) \$s\['alarm'\]\['gesendet'\] <= 36 \* 3600/, 'Bestätigung nur 36 Stunden')
  assert.match(php, /'priority' => 2, 'tags' => \['white_check_mark'\]/, 'Nachricht ans Büro leise')
  assert.match(php, /probe_senden\(\$e, \$person, 3, false\)/, 'Probe von der Seite nur Push und E-Mail')
})
