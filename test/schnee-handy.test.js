// Schnee-Alarm: Handys einrichten und prüfen (Seite „Handy einrichten“, Probe, „bereit“) und SMS über das eigene
// Android-Handy (App „SMS Gateway for Android“). Der ganze Ablauf läuft gegen echtes PHP in pruefung/schnee_alarm_php.mjs,
// in der App in pruefung/schnee_alarm_app.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { alarmInvite, alarmSetupLink, phoneState, SETUP_LANGS, SMS_PROVIDERS } from '../src/core/weather.js'
import { LANGUAGES } from '../src/core/sprachen.js'
import { alarmSetupDocument } from '../src/export/qr-pdf.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const hasPhp = spawnSync('php', ['-v']).status === 0

test('Link zur Seite „Handy einrichten“: Thema, Sprache der Person (Deutsch ohne), unbekannte Sprache ohne', () => {
  assert.equal(alarmSetupLink('https://app.example/app', 'wd-1a2b'), 'https://app.example/app/wetter-alarm.php?aktion=handy&t=wd-1a2b')
  assert.equal(alarmSetupLink('https://app.example/app/', 'wd-1a2b', 'tr'), 'https://app.example/app/wetter-alarm.php?aktion=handy&t=wd-1a2b&sprache=tr')
  assert.equal(alarmSetupLink('https://app.example/', 'wd-1a2b', 'de'), 'https://app.example/wetter-alarm.php?aktion=handy&t=wd-1a2b')
  assert.equal(alarmSetupLink('https://app.example/', 'wd-1a2b', 'xx'), 'https://app.example/wetter-alarm.php?aktion=handy&t=wd-1a2b')
})

test('Einladung in allen Sprachen: Vorname, Link, derselbe Knopf „Bin wach“ wie in Push und Seite, Blatt mit drei Zeilen', () => {
  assert.deepEqual([...SETUP_LANGS].sort(), LANGUAGES.map((l) => l.id).sort())
  const page = read('mein-plan-texte.php')
  const label = (lang) => {
    const start = page.indexOf(`    '${lang}' => [`)
    return page.slice(start, page.indexOf('\n    ],', start)).match(/'w_bin_wach' => '([^']*)'/)[1]
  }
  for (const lang of SETUP_LANGS) {
    const m = alarmInvite(lang, { name: 'Dragan Jović', link: 'https://x/wetter-alarm.php?aktion=handy&t=wd-1' })
    assert.ok(m.text.includes('Dragan') && !m.text.includes('Jović'), `${lang}: nur der Vorname`)
    assert.ok(m.text.includes('https://x/wetter-alarm.php?aktion=handy&t=wd-1'), lang)
    assert.ok(m.text.includes(label(lang)), `${lang}: „${label(lang)}“ wie am Handy`)
    assert.ok(!/\{/.test(m.subject + m.text) && m.subject.length > 5, lang)
    assert.ok(m.sheet.title && m.sheet.scan && m.sheet.secret, lang)
    assert.ok(m.text.length < 600, `${lang}: kurz genug für WhatsApp`)
  }
  assert.equal(alarmInvite('xx', { name: 'A', link: 'L' }).subject, alarmInvite('de', { name: 'A', link: 'L' }).subject)
  // derselbe Titel auf dem Blatt und auf der Seite
  for (const lang of SETUP_LANGS) {
    const start = page.indexOf(`    '${lang}' => [`)
    const titel = page.slice(start, page.indexOf('\n    ],', start)).match(/'h_titel' => '([^']*)'/)[1]
    assert.equal(alarmInvite(lang, { name: 'A', link: 'L' }).sheet.title, titel, lang)
  }
})

test('Stand eines Handys: bereit, Probe offen (nach der letzten Bestätigung), noch nie', () => {
  const h = { a: { bestaetigt: 100, probe: 50 }, b: { bestaetigt: 100, probe: 200 }, c: { bestaetigt: null, probe: 300 }, d: { bestaetigt: 400, probe: null } }
  assert.deepEqual(phoneState(h, 'a'), { state: 'ready', at: 100 })
  assert.deepEqual(phoneState(h, 'b'), { state: 'waiting', at: 200, confirmed: 100 })
  assert.deepEqual(phoneState(h, 'c'), { state: 'waiting', at: 300, confirmed: null })
  assert.deepEqual(phoneState(h, 'd'), { state: 'ready', at: 400 })
  assert.deepEqual(phoneState(h, 'x'), { state: 'never', at: null })
  assert.deepEqual(phoneState(undefined, 'x'), { state: 'never', at: null })
})

test('Blätter zum Einrichten: je Person eine Seite mit Name und QR-Code, Hinweis „nicht aufhängen“', () => {
  const people = ['de', 'tr'].map((lang, i) => {
    const link = `https://x/wetter-alarm.php?aktion=handy&t=wd-${i}`
    return { name: `Person ${i}`, link, sheet: alarmInvite(lang, { name: `Person ${i}`, link }).sheet }
  })
  const doc = alarmSetupDocument({ people, brand: { name: 'Cleanos' } })
  const json = JSON.stringify(doc)
  assert.ok(json.includes('"qr":"https://x/wetter-alarm.php?aktion=handy&t=wd-0"') && json.includes('"qr":"https://x/wetter-alarm.php?aktion=handy&t=wd-1"'))
  assert.ok(json.includes('Nicht aufhängen') && json.includes('Asma'), 'in der Sprache der Person')
  assert.equal(json.split('"pageBreak":"before"').length - 1, 1, 'zwei Seiten')
})

test('Server: Einrichtungsseite und Probe (Regeln am Quelltext)', () => {
  const alarm = read('wetter-alarm.php')
  const seite = alarm.slice(alarm.indexOf("if ($aktion === 'handy') {"), alarm.indexOf('// Winterdienst-Protokoll am Handy:'))
  assert.ok(seite.includes('fremde_herkunft()') && seite.includes('probe_senden($e, $person, 3)'), 'Probe nur vom eigenen Formular, höchstens 3 je Stunde')
  assert.ok(seite.includes("'X-Robots-Tag: noindex, nofollow'") && seite.includes("'Referrer-Policy: no-referrer'"))
  assert.match(seite, /'ntfy:\/\/' \. \$wo \. '\/' \. rawurlencode\(\$thema\)/)
  assert.ok(alarm.indexOf("if ($aktion === 'handy') {") < alarm.indexOf("ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch'])"), 'ohne Schlüssel erreichbar (Link für die Person)')
  assert.ok(alarm.indexOf("if ($aktion === 'probe' && $methode === 'POST')") > alarm.indexOf("ausgabe(403, ['fehler' => 'Schlüssel fehlt oder falsch'])"), 'Probe aus der App nur mit Schlüssel')
  // Probe: alle Wege, ohne Protokoll-Knopf; „Bin wach“ zur Probe und zu einem Alarm markiert das Handy als bereit
  assert.match(alarm, /benachrichtigen\(\$e, \$person, 'Probe Winterdienst', [^;]+, \$token, true, false\)/)
  assert.ok((alarm.match(/\$stand\['bereit'\]\[/g) || []).length >= 2)
  assert.match(alarm, /function fremde_herkunft\(\): bool/)
})

test('SMS über das eigene Handy: Weg „handy“ als Vorgabe, Basic, Nummer mit +, Passwort nie in Antwort oder Fehler', () => {
  assert.deepEqual(Object.keys(SMS_PROVIDERS), ['handy', 'seven'])
  const lib = read('webspace-lib.php')
  const fn = lib.slice(lib.indexOf('function sms_senden_handy('), lib.indexOf('function adresse_fuer_grenzen('))
  assert.ok(fn.includes("'Authorization: Basic ' . base64_encode($s['benutzer'] . ':' . $s['passwort'])"))
  assert.ok(fn.includes("'phoneNumbers' => ['+' . $an]") && fn.includes("'textMessage' => ['text' => $text]"))
  assert.ok(fn.includes("str_replace([(string) $s['passwort'], base64_encode("), 'Passwort und Basic-Wert aus Fehlertexten entfernt')
  assert.match(lib, /const SMS_GATE_STANDARD = 'https:\/\/api\.sms-gate\.app\/3rdparty\/v1';/)
  const alarm = read('wetter-alarm.php')
  const stand = alarm.slice(alarm.indexOf('$stand_sms = function'), alarm.indexOf("if ($aktion === 'sms-test')"))
  assert.ok(stand.includes("['benutzer' => $s['benutzer'], 'server' => $s['server']]") && !/'passwort' =>/.test(stand))
})

test('PHP: Zugangsdaten für das Handy prüfen, unvollständige gelten als nicht eingerichtet', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  const code = `
    require 'wetter-lib.php'; require 'webspace-lib.php';
    $d = sys_get_temp_dir() . '/handy-test-' . bin2hex(random_bytes(4)); mkdir($d);
    $f = fn ($k, $v) => sms_feld_gueltig($k, $v);
    $aus = ['felder' => [$f('benutzer', 'H7XQ2B'), $f('benutzer', 'mit leer'), $f('benutzer', 'a:b'), $f('passwort', 'pw-3x9_kLq2'), $f('passwort', 'kurz mit leer'), $f('passwort', "zeile\\nneu"), $f('server', ''), $f('server', 'https://sms.example/3rdparty/v1'), $f('server', 'http://sms.example'), $f('server', 'https://x.example/?a=b'), $f('benutzer', 5)]];
    file_put_contents("$d/sms.json", json_encode(['anbieter' => 'handy', 'benutzer' => 'H7XQ2B']));
    $aus['ohnePasswort'] = sms_einstellungen($d);
    file_put_contents("$d/sms.json", json_encode(['anbieter' => 'handy', 'benutzer' => 'H7XQ2B', 'passwort' => 'pw-3x9_kLq2', 'server' => 'http://unsicher']));
    $aus['gut'] = sms_einstellungen($d);
    unlink("$d/sms.json"); rmdir($d);
    echo json_encode($aus);`
  const r = spawnSync('php', ['-r', code], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const o = JSON.parse(r.stdout)
  assert.deepEqual(o.felder, [true, false, false, true, false, false, true, true, false, false, false])
  assert.equal(o.ohnePasswort, null)
  assert.equal(o.gut.server, '', 'ein Server ohne https wird nicht benutzt (öffentlicher Server der App)')
  assert.equal(o.gut.absender, '')
})
