// Sicherheitsprüfung der Webspace-Seiten (9.11.2026): die Behebungen bleiben im Code. Den Ablauf mit Angriffsweg prüft
// .pruefung/sicherheit_php.mjs (PHP-Testserver mit Attrappen für Graph, GeoSphere und ntfy).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const SEITEN = ['ki.php', 'routing.php', 'kunden.php', 'mattentour.php', 'mein-plan.php', 'wetter.php', 'wetter-alarm.php', 'system.php']

test('ki.php und routing.php: Gastkonten (B2B) laut Graph abgewiesen, außer allowGuests (wie die App)', () => {
  for (const f of ['ki.php', 'routing.php']) {
    const php = read(f)
    assert.match(php, /me\?\$select=userPrincipalName,mail,displayName,userType'/, `${f}: Graph liefert userType`)
    assert.match(php, /empty\(\$cfg\['sharepoint'\]\['allowGuests'\]\) && \(\(\$me\['userType'\] \?\? ''\) === 'Guest' \|\| str_contains\(\$person\['upn'\], '#ext#'\)\)/, `${f}: Gast-Prüfung`)
    // erst nach der Prüfung zwischengespeichert: ein Gast kommt auch nicht über den Zwischenspeicher durch
    assert.ok(php.indexOf("'Gastkonten sind gesperrt") < php.indexOf('json_schreiben($cache, $person)'), `${f}: Prüfung vor dem Zwischenspeicher`)
  }
})

test('Webspace-Seiten: keine PHP-Fehler in der Antwort (Serverpfade), der Cronjob (CLI) zeigt sie', () => {
  for (const f of SEITEN) assert.match(read(f), /if \(PHP_SAPI !== 'cli'\) \{\n\s+ini_set\('display_errors', '0'\);\n\}/, f)
})

test('mattentour.php: Fotos erst vorläufig, an den festen Namen nur mit einer neuen Meldung (unter der Sperre der Tour)', () => {
  const php = read('mattentour.php')
  assert.match(php, /function meldung_anhaengen\(string \$tourId, array \$m, \?callable \$vorher = null\): string/)
  assert.match(php, /if \(\$vorher && !\$vorher\(\)\) \{\n\s+return 'fehler';\n\s+\}\n\s+\$d\['meldungen'\]\[\] = \$m;/)
  assert.match(php, /\$vorlaeufig\[\$datei\] = \$mid \. '-' \. \(\$k \+ 1\) \. '\.' \. bin2hex\(random_bytes\(6\)\) \. '\.jpg';/)
  assert.match(php, /foto_speichern\(\$tmp, \$groesse, \$fehlerCode, foto_pfad\(\$vorlaeufig\[\$datei\]\)\)/)
  assert.match(php, /meldung_anhaengen\(\$tid, \$m, \$vorlaeufig \? fn \(\) => fotos_uebernehmen\(\$vorlaeufig\) : null\)/)
  // doppelt bzw. schon abgeschlossen: nur die vorläufigen Dateien dieses Versuchs weg, nie die festen Namen
  assert.doesNotMatch(php, /fotos_loeschen\(\['fotos' => \$fotos\]\)/)
  // vorläufige Namen passen nicht zu FOTO_MUSTER (nicht abrufbar), verwaiste räumt aufraeumen() nach 2 Tagen weg
  const muster = new RegExp(php.match(/const FOTO_MUSTER = '\/(.+)\/';/)[1])
  assert.ok(muster.test('a1b2c3d4e5f6-1.jpg') && !muster.test('a1b2c3d4e5f6-1.0a1b2c3d4e5f.jpg'))
  assert.match(php, /glob\(speicher\('fotos'\) \. '\/\*\.jpg'\)/)
})

test('kunden.php: Grenzen für Reklamationen in einem Schritt geprüft und gezählt (keine Rennbedingung)', () => {
  const php = read('kunden.php')
  const teil = php.slice(php.indexOf("if ($aktion === 'melden'"), php.indexOf("// Kundenzufriedenheit: Umfrage der offenen Runde"))
  assert.match(teil, /grenze\('meldung-link', \$id, GRENZE_MELDUNG_LINK, true\) \|\| grenze\('meldung-adresse', \$wer, GRENZE_MELDUNG_ADRESSE, true\)/)
  // gezählt wird vor dem Speichern, nicht erst danach
  assert.ok(teil.indexOf('GRENZE_MELDUNG_LINK, true') < teil.indexOf('$ok = meldungen('))
  assert.equal(teil.match(/GRENZE_MELDUNG_LINK, true/g).length, 1)
})

test('wetter.php: neue Abrufe bei GeoSphere begrenzt (je Aufrufer und gesamt), Zwischenspeicher zählt nicht', () => {
  const php = read('wetter.php')
  assert.match(php, /const UMWEG_JE_AUFRUFER = \[60, 600\];/)
  assert.match(php, /const UMWEG_GESAMT = \[150, 3600\];/)
  assert.match(php, /wetter_abruf\(\$url, \$art === 'raster' \? 30 : 12, 'umweg_frei'\)/)
  assert.match(php, /flock\(\$h, LOCK_EX\)/)
  const lib = read('wetter-lib.php')
  assert.match(lib, /function wetter_abruf\(string \$url, int \$zeit = 12, \?callable \$darf = null\): array/)
  // erst der frische Zwischenspeicher, dann die Grenze, dann der Abruf
  const f = lib.slice(lib.indexOf('function wetter_abruf'))
  assert.ok(f.indexOf("'Zwischenspeicher'") < f.indexOf('$darf()') && f.indexOf('$darf()') < f.indexOf('holen($url'))
  // der Schnee-Alarm fragt ohne Grenze
  assert.doesNotMatch(read('wetter-alarm.php'), /umweg_frei/)
})

test('Webspace-Seiten: PHP-Syntax', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  for (const f of [...SEITEN, 'wetter-lib.php']) assert.match(execFileSync('php', ['-l', new URL(`../${f}`, import.meta.url).pathname]).toString(), /No syntax errors/)
})
