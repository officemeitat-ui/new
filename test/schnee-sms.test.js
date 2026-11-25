// Schnee-Alarm von selbst per SMS (SMS-Dienst seven.io): was in die Alarm-Datei geht, die Regeln des Servers am
// Quelltext und (mit PHP) die Bausteine in webspace-lib.php: SMS-taugliche Zeichen, Kürzen, Absender. Der ganze Ablauf
// läuft gegen echtes PHP in pruefung/schnee_alarm_php.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { ALARM_DEFAULTS, alarmFile, alarmProblems, SMS_PROVIDERS } from '../src/core/weather.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const hasPhp = spawnSync('php', ['-v']).status === 0
const loc = { name: 'Salzburg', lat: 47.8095, lon: 13.055 }
const employees = [
  { id: 'e1', name: 'Dragan Jović', phone: '0664 1111111' },
  { id: 'e2', name: 'Ana Popescu', phone: '+43 664 2222222' },
  { id: 'e3', name: 'Ohne Nummer' },
  { id: 'e4', name: 'Nur SMS', phone: '0650/333 33 33' },
]
const base = { key: 'k'.repeat(64), cronKey: 'c'.repeat(32), enabled: true, places: { Salzburg: { active: true, level1: ['e1', 'e2', 'e3', 'e4'], level2: [] } }, topics: { e1: 'wd-1', e2: 'wd-2', e3: 'wd-3' } }
const file = (alarm) => alarmFile({ alarm: { ...base, ...alarm }, locations: [loc], objects: [], employees, address: 'https://app.example/app/', today: '2026-11-25' })

test('Alarm-Datei: SMS-Nummer nur bei angehakten Personen mit brauchbarer Nummer; SMS und WhatsApp getrennt wählbar', () => {
  const f = file({ sms: { e1: true, e3: true, e4: true }, whatsapp: { e2: true } })
  const s1 = Object.fromEntries(f.orte[0].stufe1.map((p) => [p.name, p]))
  assert.deepEqual(s1['Dragan Jović'], { name: 'Dragan Jović', ntfy: 'wd-1', sms: '436641111111' })
  assert.deepEqual(s1['Ana Popescu'], { name: 'Ana Popescu', ntfy: 'wd-2', whatsapp: '436642222222' })
  assert.equal('sms' in s1['Ohne Nummer'], false)
  assert.deepEqual(s1['Nur SMS'], { name: 'Nur SMS', sms: '436503333333' }, 'wer nur SMS hat, wird trotzdem geweckt')
  assert.ok(!JSON.stringify(file({})).includes('"sms"'), 'ohne Häkchen keine Nummern am Webspace')
  assert.deepEqual([ALARM_DEFAULTS.sms, ALARM_DEFAULTS.officeSms], [{}, ''])
})

test('Büro (Stufe 2) per SMS; Hinweis „ohne Handy“ nur ohne Push, SMS und WhatsApp', () => {
  const f = file({ officeSms: '0664 8888888; kaputt, 0664 8888888', officeWhatsapp: '0664 9999999' })
  assert.deepEqual(f.orte[0].stufe2, [{ name: 'Büro', sms: '436648888888' }, { name: 'Büro', whatsapp: '436649999999' }])
  const only = (alarm) => alarmProblems(alarmFile({ alarm: { ...base, places: { Salzburg: { active: true, level1: ['e4'], level2: [] } }, emailLevel1: true, ...alarm }, locations: [loc], objects: [], employees: [{ ...employees[3], email: 'nur@cleanos.example' }], address: 'https://app.example/', today: '2026-11-25' }))
  assert.deepEqual(only({}), ['Salzburg: Stufe 1 ohne Handy (ntfy, SMS oder WhatsApp)'])
  assert.deepEqual(only({ sms: { e4: true } }), [])
})

test('Server: Schlüssel nur im Kopf der Anfrage an den Dienst, nie in einer Antwort; Grenzen; Reihenfolge der Wege', () => {
  const lib = read('webspace-lib.php')
  const alarm = read('wetter-alarm.php')
  assert.deepEqual(Object.keys(SMS_PROVIDERS), [...lib.match(/const SMS_ANBIETER = \[([^\]]+)\]/)[1].matchAll(/'(\w+)' =>/g)].map((m) => m[1]), 'App und Webspace kennen dieselben Dienste')
  assert.match(lib, /\['X-Api-Key: ' \. \$s\['schluessel'\], 'Content-Type: application\/x-www-form-urlencoded'\]/)
  assert.match(lib, /str_replace\(\(string\) \$s\['schluessel'\], '…', \$text\)/)
  const stand = alarm.slice(alarm.indexOf('$stand_sms = function'), alarm.indexOf("if ($aktion === 'sms-test')"))
  assert.ok(stand.includes("'schluesselEnde' => substr($s['schluessel'], -4)") && !/'schluessel' =>/.test(stand), 'der Stand nennt nur die letzten vier Zeichen')
  assert.ok(alarm.indexOf("ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch'])") < alarm.indexOf("if ($aktion === 'sms' || $aktion === 'sms-test')"), 'erst nach der Schlüssel-Prüfung erreichbar')
  assert.equal(Number(alarm.match(/const SMS_TAG = (\d+);/)[1]), 100)
  assert.match(alarm, /count\(\$stand\['smsProben'\]\) >= 10/)
  assert.equal(Number(lib.match(/const SMS_LAENGE = (\d+);/)[1]), 306, 'höchstens zwei verkettete SMS')
  // zuerst bekommen alle ihren Push (und die E-Mail), dann SMS, dann WhatsApp
  const senden = alarm.slice(alarm.indexOf('function alarm_senden('), alarm.indexOf('// ---------------------------------------------------------------- Prüfen (Cronjob)'))
  const pos = ['benachrichtigen($e, $p, $titel, $text, $token, false)', 'sms_person($e, $p, $titel, $text, $codes[$i])', 'whatsapp_person($p, $titel, $text, $codes[$i])'].map((x) => senden.indexOf(x))
  assert.ok(pos[0] > 0 && pos[0] < pos[1] && pos[1] < pos[2], pos.join(','))
  // kurzer Link nur ohne andere Aktion (ein fremder Parameter w ändert sonst nichts)
  assert.match(alarm, /if \(!\$cli && \$aktion === '' && is_string\(\$_GET\['w'\] \?\? null\)\)/)
  assert.ok(read('src/ui/views/system.js').includes("'privat/sms.json'"), 'Systemcheck prüft, dass die Datei von außen nicht abrufbar ist')
})

test('PHP: SMS-Text, Kürzen, Absender, Einstellungen', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  const code = `
    require 'wetter-lib.php'; require 'webspace-lib.php';
    $d = sys_get_temp_dir() . '/sms-test-' . bin2hex(random_bytes(4)); mkdir($d);
    $link = 'Bin wach: https://app.cleanos.at/wetter-alarm.php?w=a1b2c3d4e5f6a1b2c3d4e5f6';
    $lang = sms_kuerzen('Winterdienst Salzburg – niemand bestätigt:', str_repeat('Schneefall ab 04:00 Uhr, ca. 4,8 cm in 12 h. Schneewarnung orange (GeoSphere) 10.12. 04:00–12:00 Uhr. ', 5), $link);
    $kurz = sms_kuerzen('Winterdienst Salzburg:', 'Schneefall ab 04:00 Uhr, ca. 4,8 cm in 12 h.', $link);
    $aus = [
      'text' => sms_text("„Bin wach“ – Jović, Yılmaz, Șerban, Győző …\\n\\t -1 °C  ✓ 5 € ²"),
      'lang' => $lang, 'kurz' => $kurz,
      'absender' => [sms_absender('Cleanos Gebäudereinigung'), sms_absender('+43 664 1234567'), sms_absender('  '), sms_absender('Büro & Co.'), sms_absender('0664/123 45 67'), sms_absender('0043 664 1234567'), sms_absender('12345')],
      'ohne' => sms_einstellungen($d),
    ];
    file_put_contents("$d/sms.json", json_encode(['anbieter' => 'fremd', 'schluessel' => str_repeat('a', 30)]));
    $aus['fremd'] = sms_einstellungen($d);
    file_put_contents("$d/sms.json", json_encode(['anbieter' => 'seven', 'schluessel' => 'zu kurz']));
    $aus['kurzerSchluessel'] = sms_einstellungen($d);
    file_put_contents("$d/sms.json", json_encode(['anbieter' => 'seven', 'schluessel' => str_repeat('a', 30), 'absender' => 'Cleanos Winterdienst!']));
    $aus['gut'] = sms_einstellungen($d);
    $aus['nummer'] = [sms_senden($aus['gut'], '0664123', 'x')[0], sms_senden($aus['gut'], '+436641234567', 'x')[0]];
    unlink("$d/sms.json"); rmdir($d);
    echo json_encode($aus, JSON_UNESCAPED_UNICODE);`
  const r = spawnSync('php', ['-r', code], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const o = JSON.parse(r.stdout)
  const gsm = /^[A-Za-z0-9 !"#%&'()*+,\-./:;<=>?@_äöüÄÖÜßéèàùìòÉñÑ]+$/
  assert.equal(o.text, '"Bin wach" - Jovic, Yilmaz, Serban, Gyözö ... -1 Grad ? 5 ? ?', 'eine Zeile, einfache Zeichen, Unbekanntes als Fragezeichen')
  assert.ok(gsm.test(o.text) && gsm.test(o.lang) && gsm.test(o.kurz))
  assert.equal(o.kurz, 'Winterdienst Salzburg: Schneefall ab 04:00 Uhr, ca. 4,8 cm in 12 h. Bin wach: https://app.cleanos.at/wetter-alarm.php?w=a1b2c3d4e5f6a1b2c3d4e5f6')
  assert.ok(o.kurz.length <= 160, `der übliche Alarm passt in eine SMS (${o.kurz.length} Zeichen)`)
  assert.ok(o.lang.length <= 306 && o.lang.length > 290, `${o.lang.length} Zeichen`)
  assert.ok(o.lang.startsWith('Winterdienst Salzburg - niemand bestätigt: Schneefall ab 04:00 Uhr'), 'der Anfang bleibt')
  assert.ok(o.lang.endsWith('... Bin wach: https://app.cleanos.at/wetter-alarm.php?w=a1b2c3d4e5f6a1b2c3d4e5f6'), 'der Link bleibt ganz, gekürzt wird der Text davor')
  assert.deepEqual(o.absender, ['CleanosGeba', '436641234567', '', 'BueroCo', '436641234567', '436641234567', ''], 'eine Nummer als Absender bleibt ganz (nie auf elf Zeichen gekürzt), eine unbrauchbare fällt weg')
  assert.deepEqual([o.ohne, o.fremd, o.kurzerSchluessel], [null, null, null])
  assert.equal(o.gut.absender, 'CleanosWint')
  assert.ok(o.nummer.every((f) => /^Nummer ungültig/.test(f)))
})
