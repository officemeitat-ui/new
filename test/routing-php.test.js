// routing.php (Routing des Mattenwechsels mit Google und OpenRouteService, Durchreicher am Webspace nach dem Muster von ki.php): im Paket, Schlüssel
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

test('routing.php: OpenRouteService – eigener Schlüssel und Limits, Schlüssel im Kopf Authorization, Test-URL, keine Linie', () => {
  // Anbieter als Parameter (ohne Angabe Google, wie bisher); Schlüssel je Anbieter getrennt (Google oben, ORS unter „ors“)
  assert.match(php, /const ANBIETER = \['google' => 'Google', 'ors' => 'OpenRouteService'\];/)
  assert.match(php, /\$anbieter = \$_GET\['anbieter'\] \?\? 'google';\nif \(!is_string\(\$anbieter\) \|\| !isset\(ANBIETER\[\$anbieter\]\)\)/)
  assert.match(php, /function speichern\(string \$a, array \$neu\): bool/)
  assert.match(php, /const LIMIT_MONAT_ORS = 3000;/)
  assert.match(php, /const LIMIT_TAG_ORS = 200;/)
  assert.match(php, /const MAX_STOPPS_ORS = 50;/)
  assert.match(php, /const ORS_WEGPUNKTE = 50;/)
  assert.match(php, /const ORS_SCHLUESSEL_MUSTER = /)
  // Endpunkte unter api.openrouteservice.org, für Tests über ROUTING_ORS_URL ersetzbar; Schlüssel nur im Kopf
  assert.match(php, /getenv\('ROUTING_ORS_URL'\) \?: 'https:\/\/api\.openrouteservice\.org'/)
  assert.match(php, /'Authorization: ' \. \$schluessel/)
  assert.doesNotMatch(php, /api_key/, 'Schlüssel nie als Parameter der Adresse')
  assert.match(php, /ors\('\/optimization', \['jobs' => \$jobs, 'vehicles' => \[\$fahrzeug\]\]/)
  assert.match(php, /'profile' => 'driving-car', 'start' => \[\$dLon, \$dLat\], 'end' => \[\$dLon, \$dLat\]/)
  assert.match(php, /\$fahrzeug\['time_window'\] = /)
  assert.match(php, /\['id' => \$i \+ 1, 'location' => \[\$lon, \$lat\], 'service' => \$arbeit\]/)
  assert.match(php, /\$job\['time_windows'\] = /)
  assert.match(php, /ors\('\/v2\/directions\/driving-car', \['coordinates' => \$teil, 'instructions' => true, 'geometry' => false/)
  assert.match(php, /ors\('\/geocode\/search', null, \$schluessel, \['text' => \$adresse, 'size' => 1\] \+ \$grenze\)/)
  assert.match(php, /\[\['boundary\.country' => 'AT'\], \[\]\]/)
  // zurück dasselbe Format wie bei Google: Reihenfolge, Dauer und Strecke je Abschnitt
  const ors = php.slice(php.indexOf('function ors_optimize'), php.indexOf('function ors_genauigkeit'))
  assert.match(ors, /'order' => array_map\(fn \(\$k\) => \$ids\[\$k\], \$folge\),\n\s+'legs' => \$legs,\n\s+'seconds' => [^\n]+\n\s+'meters' => [^\n]+\n\s+'optimized' => \$optimiert,\n\s+'nutzung' => nutzung_stand\(\$e, null, 'ors'\),/)
  // Fehler auf Deutsch, Zähler und Limits je Anbieter
  assert.match(php, /Tageskontingent von OpenRouteService erschöpft/)
  assert.match(php, /vormerken\(\$e, 'routen', 'ors'\)/)
  assert.match(php, /vormerken\(\$e, 'geocode', 'ors'\)/)
  assert.match(php, /limit_fehler\(\$grund, \$e, 'ors'\)/)
  // Systemcheck: je Anbieter nur ja/nein
  const sys = read('system.php')
  assert.match(sys, /\$routingOrs = isset\(\$routing\['ors'\]\['schluessel'\]\)/)
  assert.match(sys, /'routing' => \['eingerichtet' => \$routingGoogle \|\| \$routingOrs, 'google' => \$routingGoogle, 'ors' => \$routingOrs,/)
})

test('routing.php: PHP-Syntax', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  for (const f of ['routing.php', 'system.php']) assert.match(execFileSync('php', ['-l', new URL(`../${f}`, import.meta.url).pathname]).toString(), /No syntax errors/)
})
