// routing.php (Google-Routing des Mattenwechsels, Durchreicher am Webspace nach dem Muster von ki.php): im Paket, Schlüssel
// nur in privat/, knappe Feldmaske, nur geprüfte Felder, Limits; PHP-Syntax, wenn PHP da ist. Den Ablauf mit Anmeldung,
// Google-Attrappe und Limits prüft .pruefung/routing_php.mjs (PHP-Testserver).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const php = read('routing.php')
const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('routing.php: kommt ins Paket (wie ki.php), privat/ bleibt gesperrt, Systemcheck sieht nur ja/nein', () => {
  const build = read('scripts/build.js')
  assert.match(build, /appConfig\.googleRouting !== false \? \['routing\.php'\] : \[\]/)
  assert.match(read('scripts/htaccess.js'), /routing\.php/)
  const sys = read('system.php')
  assert.match(sys, /'routing' => \['eingerichtet' => /)
  assert.doesNotMatch(sys.match(/'routing' => \[[^\n]*\]/)[0], /schluessel'\]\s*[,\]]/, 'system.php gibt den Schlüssel nicht aus')
})

test('routing.php: Schlüssel nur am Webspace, Anmeldung wie ki.php, knappe Feldmaske, Limits und Grenzen', () => {
  assert.doesNotMatch(php, /AIza[0-9A-Za-z_-]{20,}/, 'kein Schlüssel im Code')
  assert.match(php, /ordner\(\) \. '\/routing\.json'/)
  assert.match(php, /ordner\(\) \. '\/routing-nutzung\.json'/)
  assert.match(php, /HTTP_X_MICROSOFT_TOKEN/)
  assert.match(php, /function ist_vollzugriff/)
  assert.match(php, /'X-Goog-Api-Key: ' \. \$schluessel/)
  assert.match(php, /'X-Goog-FieldMask: ' \. FELDMASKE/)
  assert.match(php, /const FELDMASKE = 'routes\.optimizedIntermediateWaypointIndex,routes\.legs\.duration,routes\.legs\.distanceMeters';/)
  assert.doesNotMatch(php, /polyline/i, 'keine Linie der Route')
  assert.match(php, /'optimizeWaypointOrder' => \$optimieren/)
  assert.match(php, /const MAX_STOPPS = 25;/)
  assert.match(php, /const LIMIT_MONAT = 1000;/)
  assert.match(php, /getenv\('ROUTING_GOOGLE_URL'\)/)
  // der Schlüssel steht in keiner Antwort: status gibt nur die letzten 4 Zeichen (Vollzugriff)
  assert.match(php, /'schluesselEnde' => \$voll && \$da \? substr\(\(string\) \$e\['schluessel'\], -4\) : null/)
  for (const m of php.matchAll(/antwort\(([\s\S]*?)\);\n/g)) assert.doesNotMatch(m[1], /\$schluessel\b|\$e\['schluessel'\]/, `Antwort mit Schlüssel: ${m[1].slice(0, 80)}`)
})

test('routing.php: PHP-Syntax', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  for (const f of ['routing.php', 'system.php']) assert.match(execFileSync('php', ['-l', new URL(`../${f}`, import.meta.url).pathname]).toString(), /No syntax errors/)
})
