// Schnee-Alarm von selbst per WhatsApp (Schnittstelle von Meta): was in die Alarm-Datei geht, die Vorlage, die Regeln
// des Servers am Quelltext und (mit PHP) die Bausteine in webspace-lib.php. Der ganze Ablauf mit Push, E-Mail und
// WhatsApp läuft gegen echtes PHP in pruefung/schnee_alarm_php.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { ALARM_DEFAULTS, alarmFile, alarmProblems, WHATSAPP_TEMPLATE, whatsappButtonUrl, whatsappNumbers } from '../src/core/weather.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const hasPhp = spawnSync('php', ['-v']).status === 0
const loc = { name: 'Salzburg', lat: 47.8095, lon: 13.055 }
const employees = [
  { id: 'e1', name: 'Dragan Jović', phone: '0664 1111111', email: 'dragan@cleanos.example' },
  { id: 'e2', name: 'Ana Popescu', phone: '+43 664 2222222' },
  { id: 'e3', name: 'Ohne Nummer', phone: '' },
  { id: 'e4', name: 'Nur WhatsApp', phone: '0650/333 33 33' },
  { id: 'e5', name: 'Falsche Nummer', phone: 'siehe Zettel' },
]
const base = { key: 'k'.repeat(64), cronKey: 'c'.repeat(32), enabled: true, places: { Salzburg: { active: true, level1: ['e1', 'e2', 'e3', 'e4', 'e5'], level2: [] } }, topics: { e1: 'wd-1', e2: 'wd-2', e3: 'wd-3', e5: 'wd-5' } }
const file = (alarm) => alarmFile({ alarm: { ...base, ...alarm }, locations: [loc], objects: [], employees, address: 'https://app.example/app/', today: '2026-11-25' })

test('Alarm-Datei: WhatsApp-Nummer nur bei angehakten Personen mit brauchbarer Nummer, mit Ländervorwahl', () => {
  const f = file({ whatsapp: { e1: true, e3: true, e4: true, e5: true } })
  const s1 = Object.fromEntries(f.orte[0].stufe1.map((p) => [p.name, p]))
  assert.equal(s1['Dragan Jović'].whatsapp, '436641111111')
  assert.equal(s1['Dragan Jović'].ntfy, 'wd-1', 'Push bleibt daneben')
  assert.equal('whatsapp' in s1['Ana Popescu'], false, 'nicht angehakt')
  assert.equal('whatsapp' in s1['Ohne Nummer'], false)
  assert.equal('whatsapp' in s1['Falsche Nummer'], false)
  assert.deepEqual(s1['Nur WhatsApp'], { name: 'Nur WhatsApp', whatsapp: '436503333333' }, 'wer nur WhatsApp hat, wird trotzdem geweckt')
})

test('Alarm-Datei ohne WhatsApp: wie bisher, keine Nummern am Webspace', () => {
  const f = file({})
  assert.ok(!JSON.stringify(f).includes('whatsapp'))
  assert.deepEqual(f.orte[0].stufe1.map((p) => p.name), ['Dragan Jović', 'Ana Popescu', 'Ohne Nummer', 'Falsche Nummer'], 'ohne Thema, E-Mail und WhatsApp fällt die Person heraus')
  assert.deepEqual([ALARM_DEFAULTS.whatsapp, ALARM_DEFAULTS.officeWhatsapp], [{}, ''])
})

test('Büro (Stufe 2): Nummern aus dem Feld, jede einmal, unbrauchbare fallen weg', () => {
  assert.deepEqual(whatsappNumbers('0664 9999999, +43 662 123456; 0664/999 99 99\n kaputt, 12'), ['436649999999', '43662123456'])
  assert.deepEqual(whatsappNumbers(''), [])
  assert.deepEqual(whatsappNumbers(undefined), [])
  const f = file({ officeWhatsapp: '0664 9999999, kaputt', officeEmails: 'office@cleanos.example', topics: { ...base.topics, office: 'wd-buero' } })
  assert.deepEqual(f.orte[0].stufe2, [{ name: 'Büro', ntfy: 'wd-buero' }, { name: 'Büro', email: 'office@cleanos.example' }, { name: 'Büro', whatsapp: '436649999999' }])
})

test('Hinweise: Stufe 1 ohne Handy nur, wenn weder Push noch WhatsApp da ist', () => {
  const only = (alarm) => alarmProblems(alarmFile({ alarm: { ...base, places: { Salzburg: { active: true, level1: ['e4'], level2: [] } }, emailLevel1: true, ...alarm }, locations: [loc], objects: [], employees: [...employees.slice(0, 3), { ...employees[3], email: 'nur@cleanos.example' }], address: 'https://app.example/', today: '2026-11-25' }))
  assert.deepEqual(only({}), ['Salzburg: Stufe 1 ohne Handy (ntfy oder WhatsApp)'], 'nur E-Mail weckt nachts nicht')
  assert.deepEqual(only({ whatsapp: { e4: true } }), [])
})

test('Vorlage für Meta: zwei Variablen nicht am Anfang oder Ende, kurzer Knopf, Adresse endet mit der Variable', () => {
  const t = WHATSAPP_TEMPLATE
  assert.match(t.name, /^[a-z0-9_]+$/)
  assert.ok(t.body.includes('{{1}}') && t.body.includes('{{2}}') && !t.body.includes('{{3}}'))
  assert.ok(!/^\{\{/.test(t.body) && !/\}\}[.!?]?$/.test(t.body), 'Meta lehnt Vorlagen ab, die mit einer Variable beginnen oder enden')
  assert.ok(t.body.replace(/\{\{\d\}\}/g, '').trim().split(/\s+/).length >= 4, 'genug fester Text neben den Variablen')
  assert.ok(t.button.length <= 20)
  assert.equal(t.samples.length, 3)
  assert.match(t.samples[2], /^[a-f0-9]{24}$/)
  assert.equal(whatsappButtonUrl('https://app.example/app'), 'https://app.example/app/wetter-alarm.php?aktion=wach&t={{1}}')
  assert.equal(whatsappButtonUrl('https://app.example/app/'), 'https://app.example/app/wetter-alarm.php?aktion=wach&t={{1}}')
  // dieselben Vorgaben am Server
  const lib = read('webspace-lib.php')
  assert.ok(lib.includes(`const WHATSAPP_VORLAGE = '${t.name}';`))
  assert.ok(lib.includes(`const WHATSAPP_VERSION = '${t.version}';`))
})

test('Server: Token nur im Kopf der Anfrage an Meta, nie in einer Antwort oder Fehlermeldung', () => {
  const lib = read('webspace-lib.php')
  const alarm = read('wetter-alarm.php')
  assert.match(lib, /\['Authorization: Bearer ' \. \$w\['token'\]\]/)
  assert.match(lib, /str_replace\(\(string\) \$w\['token'\], '…'/, 'Meta wiederholt ein abgelehntes Token im Fehlertext')
  const stand = alarm.slice(alarm.indexOf('$stand_wa = function'), alarm.indexOf("if ($aktion === 'whatsapp-test')"))
  assert.ok(stand.includes("'tokenEnde' => substr($w['token'], -4)") && !/'token' =>/.test(stand), 'der Stand nennt nur die letzten vier Zeichen')
  assert.match(alarm, /@chmod\(\$datei, 0600\)/)
  // erst nach der Schlüssel-Prüfung erreichbar
  assert.ok(alarm.indexOf("ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch'])") < alarm.indexOf("if ($aktion === 'whatsapp' || $aktion === 'whatsapp-test')"))
  // Kopfzeilen von außen nie mit Zeilenumbruch
  assert.match(read('wetter-lib.php'), /is_string\(\$zeile\) && !preg_match\('\/\[\\r\\n\]\/', \$zeile\)/)
  // Systemcheck prüft, dass die Datei von außen nicht abrufbar ist
  assert.ok(read('src/ui/views/system.js').includes("'privat/whatsapp.json'"))
})

test('Server: Grenze je Tag und Proben je Stunde, WhatsApp zusätzlich zu Push und E-Mail', () => {
  const alarm = read('wetter-alarm.php')
  assert.equal(Number(alarm.match(/const WHATSAPP_TAG = (\d+);/)[1]), 150)
  assert.match(alarm, /count\(\$stand\['waProben'\]\) >= 10/)
  const fn = alarm.slice(alarm.indexOf('function whatsapp_person('), alarm.indexOf('// ---------------------------------------------------------------- Prüfen (Cronjob)'))
  assert.ok(fn.includes('whatsapp_an(') && fn.includes("!empty($person['ntfy'])") && fn.includes("!empty($person['email'])"), 'drei Wege, jeder für sich')
  assert.ok(fn.includes("$token ?: 'info'"), 'ohne Bestätigungs-Code führt der Knopf zur App')
  // bei mehreren Personen bekommen zuerst alle ihren Push, dann erst WhatsApp (Meta darf den Push nicht aufhalten)
  const senden = alarm.slice(alarm.indexOf('function alarm_senden('), alarm.indexOf('// ---------------------------------------------------------------- Prüfen (Cronjob)'))
  assert.ok(senden.indexOf('benachrichtigen($e, $p, $titel, $text, $token, false)') > 0 && senden.indexOf('benachrichtigen($e, $p, $titel, $text, $token, false)') < senden.indexOf('whatsapp_person($p, $titel, $text, $codes[$i])'))
})

test('PHP: Text der Variablen einzeilig und gekürzt, unvollständige Einstellungen gelten als nicht eingerichtet', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  const code = `
    require 'wetter-lib.php'; require 'webspace-lib.php';
    $d = sys_get_temp_dir() . '/wa-test-' . bin2hex(random_bytes(4)); mkdir($d);
    $aus = ['text' => whatsapp_text("Schneefall ab 04:00 Uhr,\\n\\tca. 6 cm     in 12 h.  "), 'leer' => whatsapp_text("  \\n "), 'lang' => mb_strlen(whatsapp_text(str_repeat('ä', 900))), 'ohne' => whatsapp_einstellungen($d)];
    file_put_contents("$d/whatsapp.json", json_encode(['token' => str_repeat('a', 60), 'nummerId' => '0664 123']));
    $aus['idFalsch'] = whatsapp_einstellungen($d);
    file_put_contents("$d/whatsapp.json", json_encode(['token' => 'zu kurz', 'nummerId' => '123456789']));
    $aus['tokenFalsch'] = whatsapp_einstellungen($d);
    file_put_contents("$d/whatsapp.json", json_encode(['token' => str_repeat('a', 60), 'nummerId' => '123456789', 'vorlage' => 'Böse Vorlage', 'version' => 'neueste']));
    $aus['gut'] = whatsapp_einstellungen($d);
    $aus['nummer'] = [whatsapp_senden($aus['gut'], '0664123', ['a', 'b'], 'x'), whatsapp_senden($aus['gut'], '+436641234567', ['a', 'b'], 'x')];
    unlink("$d/whatsapp.json"); rmdir($d);
    echo json_encode($aus, JSON_UNESCAPED_UNICODE);`
  const r = spawnSync('php', ['-r', code], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const o = JSON.parse(r.stdout)
  assert.equal(o.text, 'Schneefall ab 04:00 Uhr, ca. 6 cm in 12 h.')
  assert.equal(o.leer, '–', 'WhatsApp nimmt keine leere Variable')
  assert.equal(o.lang, 700)
  assert.deepEqual([o.ohne, o.idFalsch, o.tokenFalsch], [null, null, null])
  assert.deepEqual([o.gut.vorlage, o.gut.sprache, o.gut.version], ['winterdienst_alarm', 'de', 'v25.0'], 'unbrauchbare Angaben fallen auf die Vorgaben zurück')
  assert.ok(o.nummer.every((f) => /^Nummer ungültig/.test(f)), 'ohne Ländervorwahl bzw. mit + geht nichts an Meta')
})
