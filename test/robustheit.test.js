// Robustheit aus der Prüfrunde vom 9.11.2026: Foto fehlt beim Abholen der Fahrerseite, Systemcheck der Dateien mit
// Schlüsseln in privat/, Feiertage beim nächsten Arbeitstag des Mattenwechsels, Fotos ohne Ortsdaten am Webspace (PHP),
// alte Touren mit doppelter Stopp-ID. Browser- und PHP-Abläufe: .pruefung/matten_foto_fehlt_php.mjs,
// .pruefung/fotos_metadaten_php.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

import { nextWorkday, untouredSoon } from '../src/core/matten-einsaetze.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { mergeTour } from '../src/core/matten-fahrt.js'
import { duplicateStopIds, stopsFromJobs, tourProblems } from '../src/core/matten-tour.js'
import { applyWebEvents, withWebspace } from '../src/core/matten-webspace.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// ---------------------------------------------------------------- 1. Fahrerseite: Foto fehlt am Webspace

const DAY = '2026-11-09'
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH' }
const mat = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm' }
const objects = [{ id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8, lon: 13.05 }]
const placements = [{ id: 'Haupteingang', name: 'Haupteingang', objectId: 'o1', customerId: 'c1', customer: hv, active: true, mats: [{ ...mat, qty: 1 }], intervalDays: 14, startDate: '2026-10-26', rule: 'rhythmus' }]
const webTour = () => {
  const stops = stopsFromJobs({ jobs: [{ key: `Haupteingang:${DAY}`, placementId: 'Haupteingang', due: DAY, status: 'geplant' }], placements, objects, date: DAY, customers: [hv] })
  return withWebspace({ schema: 1, id: 'mtfoto0000001', date: DAY, driverId: 'e7', driverName: 'Ivo Beispiel', status: 'freigegeben', order: ['st-o1'], stops, updatedAt: `${DAY}T05:00:00.000Z` }, { hash: 'a'.repeat(64), name: 'Ivo Beispiel', lang: 'de' })
}
const finish = {
  id: 'fotofehlt0001aa',
  art: 'abschluss',
  tour: 'mtfoto0000001',
  stopp: 'st-o1',
  zeit: Date.parse(`${DAY}T07:40:00Z`) / 1000,
  eingang: Date.parse(`${DAY}T07:41:00Z`) / 1000,
  fahrer: 'Ivo Beispiel',
  daten: { liegeplaetze: [{ id: 'Haupteingang', ergebnis: 'gewechselt', mengen: [{ i: 0, ist: 1 }], grund: '', bemerkung: '' }], ausnahme: '', notiz: '', unterschrift: null, ohne: { grund: 'niemand da' } },
  fotos: [{ datei: 'fotofehlt0001aa-1.jpg', liegeplatz: 'Haupteingang', groesse: 1000 }, { datei: 'fotofehlt0001aa-2.jpg', liegeplatz: 'Haupteingang', groesse: 1000 }],
}

test('Fahrerseite: fehlt ein Foto am Webspace (404), wird die Meldung trotzdem übernommen, „Foto fehlt“ am Stopp', () => {
  const r = applyWebEvents(webTour(), [finish], { now: `${DAY}T09:00:00.000Z`, missing: ['fotofehlt0001aa-1.jpg'] })
  const stop = r.tour.stops[0]
  assert.deepEqual(r.applied, ['fotofehlt0001aa'], 'übernommen')
  assert.deepEqual(r.done, ['fotofehlt0001aa'], 'am Webspace als übernommen melden')
  assert.ok(['abgeschlossen', 'teilweise'].includes(stop.status) || stop.finishedAt, 'Stopp abgeschlossen')
  assert.equal(stop.web.event, 'fotofehlt0001aa')
  assert.equal(stop.web.fotosFehlen, 1)
  const photos = stop.items.flatMap((it) => it.photos || [])
  assert.deepEqual(photos.map((p) => p.name), [`${DAY}_mtfoto0000001_52.jpg`], 'nur das vorhandene Foto, mit seinem festen Namen')
  assert.deepEqual(r.uploads.map((u) => u.datei), ['fotofehlt0001aa-2.jpg'], 'nur das vorhandene Foto nach SharePoint')
  assert.deepEqual(r.notes.map((n) => [n.stopId, n.missing, n.reason]), [['st-o1', 1, 'Foto fehlt (am Webspace nicht mehr vorhanden)']])
  // ohne fehlende Fotos: unverändert wie bisher (kein Merker, keine Notiz)
  const ok = applyWebEvents(webTour(), [finish], { now: `${DAY}T09:00:00.000Z` })
  assert.equal(ok.tour.stops[0].web.fotosFehlen, undefined)
  assert.equal(ok.uploads.length, 2)
  assert.deepEqual(ok.notes, [])
  // beide fehlen
  const none = applyWebEvents(webTour(), [finish], { now: `${DAY}T09:00:00.000Z`, missing: ['fotofehlt0001aa-1.jpg', 'fotofehlt0001aa-2.jpg'] })
  assert.equal(none.tour.stops[0].web.fotosFehlen, 2)
  assert.match(none.notes[0].reason, /^2 Fotos fehlen/)
})

test('Fahrerseite: Abholen läuft je Tour für sich, 404 beim Foto hält nicht an (ui/matten-webspace.js)', () => {
  const src = readFileSync(join(ROOT, 'src/ui/matten-webspace.js'), 'utf8')
  const loop = src.slice(src.indexOf('for (const [id, evs] of eventsByTour(meldungen))'), src.indexOf('// nicht übertragene Touren'))
  assert.match(loop, /try \{[\s\S]*\} catch \(err\) \{\n\s+skipped\.push\(\{ tour: id, reason: String\(err\?\.message \|\| err\) \}\)/, 'Fehler einer Tour: vermerkt, weiter mit der nächsten')
  assert.match(loop, /if \(err\?\.status === 404\) return null/, '404 beim Foto: als fehlend vermerken')
  assert.match(loop, /applyWebEvents\(cur, evs, \{ now: nowIso\(\), missing \}\)/)
  assert.match(src, /Foto fehlt:<\/strong>/, 'Hinweis an der Tour im Büro')
})

// ---------------------------------------------------------------- 2. Systemcheck: Dateien mit Schlüsseln in privat/

test('Systemcheck: ki.json, routing.json und mattentour.json – Abruf von außen muss 403 oder 404 liefern', () => {
  const src = readFileSync(join(ROOT, 'src/ui/views/system.js'), 'utf8')
  for (const f of ['privat/ki.json', 'privat/routing.json', 'privat/mattentour.json']) assert.ok(src.includes(`'${f}'`), f)
  assert.match(src, /if \(st === 200\) open\.push\(f\)\n\s+else if \(st !== 403 && st !== 404\) unclear\.push/)
})

test('Systemcheck: system.php meldet nur, ob die Dateien mit Schlüsseln da sind (nie den Inhalt)', { skip: !hasPhp && 'ohne PHP' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'systemcheck-'))
  try {
    const env = { ...process.env, KI_ORDNER: dir, ROUTING_ORDNER: dir, MATTEN_ORDNER: dir, WETTER_ALARM_ORDNER: dir, MEIN_PLAN_ORDNER: dir, KUNDEN_ORDNER: dir }
    const run = () => JSON.parse(execFileSync('php', [join(ROOT, 'system.php')], { env }).toString())
    assert.deepEqual(run().schutz, { ki: false, routing: false, mattentour: false })
    writeFileSync(join(dir, 'ki.json'), JSON.stringify({ schluessel: 'sk-geheim-erfunden' }))
    writeFileSync(join(dir, 'mattentour.json'), JSON.stringify({ schluessel: 'm'.repeat(64) }))
    const j = run()
    assert.deepEqual(j.schutz, { ki: true, routing: false, mattentour: true })
    assert.ok(!JSON.stringify(j).includes('sk-geheim'), 'kein Inhalt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Systemcheck: system.php erkennt die Ablage (eigener Ordner, .htaccess der App, nichts im Ordner der Homepage)', { skip: !hasPhp && 'ohne PHP' }, async () => {
  const { MARKE, htaccessFor } = await import('../scripts/htaccess.js')
  const files = htaccessFor(JSON.parse(readFileSync(join(ROOT, 'staticwebapp.config.json'), 'utf8')))
  assert.ok(readFileSync(join(ROOT, 'system.php'), 'utf8').includes(`'${MARKE}'`), 'system.php sucht dasselbe Erkennungszeichen')
  const dir = mkdtempSync(join(tmpdir(), 'ablage-'))
  try {
    const home = join(dir, 'www')
    const appDir = join(home, 'app')
    mkdirSync(appDir, { recursive: true })
    const env = { ...process.env, APP_ORDNER: appDir, KI_ORDNER: dir, ROUTING_ORDNER: dir, MATTEN_ORDNER: dir, WETTER_ALARM_ORDNER: dir, MEIN_PLAN_ORDNER: dir, KUNDEN_ORDNER: dir }
    const run = () => JSON.parse(execFileSync('php', [join(ROOT, 'system.php')], { env }).toString()).ablage
    // richtig: WordPress im Hauptordner, die App in ihrem Ordner mit ihrer .htaccess
    writeFileSync(join(home, '.htaccess'), '# BEGIN WordPress\nRewriteEngine On\n# END WordPress\n')
    writeFileSync(join(home, 'wp-config.php'), '<?php')
    writeFileSync(join(appDir, '.htaccess'), files['.htaccess'])
    assert.deepEqual(run(), { htaccess: true, homepageHier: false, appImElternordner: false })
    // falsch hochgeladen: .htaccess der App im Hauptordner, die aus app/ im Ordner der App
    writeFileSync(join(home, '.htaccess'), files['.htaccess'])
    writeFileSync(join(appDir, '.htaccess'), files['app/.htaccess'])
    assert.deepEqual(run(), { htaccess: false, homepageHier: false, appImElternordner: true })
    // App und Homepage im selben Ordner; ohne .htaccess: null (den Fall meldet die Prüfung der Sicherheits-Header)
    rmSync(join(appDir, '.htaccess'))
    writeFileSync(join(appDir, 'wp-load.php'), '<?php')
    assert.deepEqual(run(), { htaccess: null, homepageHier: true, appImElternordner: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Systemcheck: Ablage am Webspace mit Hinweisen, auch wenn PHP-Seiten ein Jahr im Browser blieben', () => {
  const src = readFileSync(join(ROOT, 'src/ui/views/system.js'), 'utf8')
  assert.match(src, /sysCache = r\.headers\.get\('cache-control'\)/)
  assert.match(src, /const jahr = \/immutable\|max-age=31536000\/\.test\(sysCache\)/)
  for (const label of ['Eigener Ordner der App', '.htaccess im Ordner der App', 'Ordner darüber (Homepage)', 'Ablage am Webspace']) assert.ok(src.includes(`'${label}'`), label)
})

// ---------------------------------------------------------------- 3. Nächster Arbeitstag ohne Feiertage

test('Mattenwechsel: nächster Arbeitstag lässt österreichische Feiertage aus', () => {
  assert.equal(nextWorkday('2026-11-05'), '2026-11-06', 'Donnerstag → Freitag')
  assert.equal(nextWorkday('2026-11-06'), '2026-11-09', 'Freitag → Montag')
  assert.equal(nextWorkday('2026-12-07'), '2026-12-09', 'Mariä Empfängnis (Di 8.12.)')
  assert.equal(nextWorkday('2026-12-24'), '2026-12-28', 'Christtag Fr, Stefanitag Sa, Sonntag')
  assert.equal(nextWorkday('2026-10-23'), '2026-10-27', 'Nationalfeiertag (Mo 26.10.)')
  assert.equal(nextWorkday('2027-03-26'), '2027-03-30', 'Ostermontag 2027 (29.3.)')
  assert.equal(nextWorkday('2026-12-31'), '2027-01-04', 'Neujahr Fr, Wochenende')
  assert.equal(nextWorkday('2027-01-05'), '2027-01-07', 'Heilige Drei Könige (Mi 6.1.)')
  // eigene freie Tage (z. B. Betriebsurlaub) statt der Vorgabe
  assert.equal(nextWorkday('2026-12-24', holidayCalendar('2026-12-01', '2027-01-31', [{ date: '2026-12-28', name: 'Betriebsurlaub' }])), '2026-12-29')
  assert.equal(nextWorkday('2026-12-07', new Map()), '2026-12-08', 'ohne Feiertage nur Wochenende')
})

test('Mattenwechsel: „Morgen fällig“ reicht über den Feiertag bis zum nächsten Arbeitstag', () => {
  const job = (placementId, due) => ({ key: `${placementId}:${due}`, placementId, due, status: 'geplant' })
  const jobs = [job('Foyer', '2026-12-08'), job('Rampe', '2026-12-09'), job('Lager', '2026-12-10')]
  const r = untouredSoon(jobs, '2026-12-07')
  assert.equal(r.date, '2026-12-09')
  assert.deepEqual(r.days, ['2026-12-08', '2026-12-09'])
  assert.deepEqual(r.jobs.map((j) => j.placementId), ['Foyer', 'Rampe'])
  assert.equal(r.title, 'Bis Mittwoch fällige Einsätze ohne freigegebene Tour')
  assert.equal(untouredSoon(jobs, '2026-12-09').title, 'Morgen fällige Einsätze ohne freigegebene Tour')
})

// ---------------------------------------------------------------- 4. Fotos ohne Ortsdaten am Webspace (PHP)

/** Kleines EXIF mit GPS (Breite 47° 48′ N) als APP1-Segment, little endian. */
function exifApp1() {
  const t = Buffer.alloc(80)
  t.write('II', 0)
  t.writeUInt16LE(42, 2)
  t.writeUInt32LE(8, 4)
  t.writeUInt16LE(1, 8) // IFD0: ein Eintrag
  t.writeUInt16LE(0x8825, 10) // GPSInfo
  t.writeUInt16LE(4, 12)
  t.writeUInt32LE(1, 14)
  t.writeUInt32LE(26, 18)
  t.writeUInt32LE(0, 22)
  t.writeUInt16LE(2, 26) // GPS-IFD: zwei Einträge
  t.writeUInt16LE(1, 28) // GPSLatitudeRef
  t.writeUInt16LE(2, 30)
  t.writeUInt32LE(2, 32)
  t.write('N\0', 36)
  t.writeUInt16LE(2, 40) // GPSLatitude
  t.writeUInt16LE(5, 42)
  t.writeUInt32LE(3, 44)
  t.writeUInt32LE(56, 48)
  t.writeUInt32LE(0, 52)
  ;[47, 1, 48, 1, 0, 1].forEach((v, i) => t.writeUInt32LE(v, 56 + i * 4))
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), t])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const xmpApp1 = () => {
  const payload = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>47,48N</exif:GPSLatitude></x:xmpmeta>')
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
  return Buffer.concat([len, Buffer.from(type), data, crc])
}
const riff = (type, data) => {
  const head = Buffer.alloc(8)
  head.write(type, 0)
  head.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

/** PHP: bild_ohne_metadaten auf eine Datei, danach Maße, lesbar mit GD und GPS laut exif_read_data. */
function strip(file) {
  const code = `require '${join(ROOT, 'webspace-lib.php')}'; $f = $argv[1]; $ok = bild_ohne_metadaten($f); $m = @getimagesize($f); $t = $m ? $m['mime'] : ''; $gd = $t === 'image/jpeg' ? (bool) @imagecreatefromjpeg($f) : ($t === 'image/png' ? (bool) @imagecreatefrompng($f) : ($t === 'image/webp' ? (bool) @imagecreatefromwebp($f) : false)); $e = $t === 'image/jpeg' ? @exif_read_data($f) : null; echo json_encode(['ok' => $ok, 'mime' => $t, 'w' => $m ? $m[0] : 0, 'gd' => $gd, 'gps' => is_array($e) && isset($e['GPSLatitudeRef'])]);`
  return JSON.parse(execFileSync('php', ['-d', 'display_errors=0', '-r', code, file]).toString())
}
const gpsBefore = (file) => execFileSync('php', ['-r', `$e = @exif_read_data($argv[1]); echo is_array($e) && isset($e['GPSLatitudeRef']) ? 'ja' : 'nein';`, file]).toString()

test('Webspace: JPEG ohne APP1 (EXIF mit GPS, XMP), sonst Byte für Byte gleich, ohne Neukodieren', { skip: !hasPhp && 'ohne PHP' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'metadaten-'))
  try {
    const plain = join(dir, 'plain.jpg')
    execFileSync('php', ['-r', `$i = imagecreatetruecolor(40, 30); imagefill($i, 0, 0, imagecolorallocate($i, 30, 120, 200)); imagejpeg($i, $argv[1], 80);`, plain])
    const jpg = readFileSync(plain)
    const withMeta = Buffer.concat([jpg.subarray(0, 2), exifApp1(), xmpApp1(), jpg.subarray(2)])
    const f = join(dir, 'gps.jpg')
    writeFileSync(f, withMeta)
    assert.equal(gpsBefore(f), 'ja', 'Testbild hat GPS')
    const r = strip(f)
    assert.deepEqual(r, { ok: true, mime: 'image/jpeg', w: 40, gd: true, gps: false })
    const out = readFileSync(f)
    assert.ok(!out.includes(Buffer.from('Exif\0\0')) && !out.includes(Buffer.from('GPSLatitude')), 'EXIF und XMP weg')
    assert.deepEqual(out, jpg, 'genau das Bild ohne die beiden Segmente (nicht neu kodiert)')
    // nach dem Bildende (Zweitbild mit eigenem EXIF/GPS, Video eines Bewegtfotos): weg
    writeFileSync(f, Buffer.concat([withMeta, withMeta, Buffer.from('ftypmp42 Video')]))
    assert.equal(strip(f).ok, true)
    assert.deepEqual(readFileSync(f), jpg, 'nichts nach dem Bildende')
    // ohne Metadaten: unverändert (auch ein JPEG ohne Ende-Marke wie aus dem Formular am Handy)
    const short = Buffer.concat([jpg.subarray(0, jpg.length - 2)])
    writeFileSync(f, short)
    assert.equal(strip(f).ok, true)
    assert.deepEqual(readFileSync(f), short)
    // kaputt: abgelehnt
    writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]), Buffer.from('Exif')]))
    assert.equal(strip(f).ok, false)
    writeFileSync(f, Buffer.from('kein Bild, nur Text, lang genug'))
    assert.equal(strip(f).ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Webspace: PNG ohne eXIf- und Text-Blöcke, WebP ohne EXIF/XMP (Merker im Kopf gelöscht)', { skip: !hasPhp && 'ohne PHP' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'metadaten-'))
  try {
    const png = join(dir, 'a.png')
    execFileSync('php', ['-r', `$i = imagecreatetruecolor(20, 10); imagepng($i, $argv[1]);`, png])
    const raw = readFileSync(png)
    const iend = raw.length - 12
    const withMeta = Buffer.concat([raw.subarray(0, iend), pngChunk('tEXt', Buffer.from('Location\0Salzburg 47.80 13.04')), pngChunk('eXIf', exifApp1().subarray(10)), pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')), raw.subarray(iend)])
    writeFileSync(png, withMeta)
    assert.deepEqual(strip(png), { ok: true, mime: 'image/png', w: 20, gd: true, gps: false })
    const out = readFileSync(png)
    assert.deepEqual(out, raw, 'nur die Blöcke weg')

    const webp = join(dir, 'a.webp')
    execFileSync('php', ['-r', `$i = imagecreatetruecolor(16, 12); imagewebp($i, $argv[1], 80);`, webp])
    const simple = readFileSync(webp)
    const vp8 = simple.subarray(12) // „VP8 “-Block
    const vp8x = Buffer.alloc(10)
    vp8x[0] = 0x08 | 0x04 // EXIF und XMP vorhanden
    vp8x.writeUIntLE(15, 4, 3)
    vp8x.writeUIntLE(11, 7, 3)
    const body = Buffer.concat([riff('VP8X', vp8x), vp8, riff('EXIF', exifApp1().subarray(10)), riff('XMP ', Buffer.from('<x:xmpmeta>GPS</x:xmpmeta>'))])
    const head = Buffer.alloc(12)
    head.write('RIFF', 0)
    head.writeUInt32LE(4 + body.length, 4)
    head.write('WEBP', 8)
    writeFileSync(webp, Buffer.concat([head, body]))
    const r = strip(webp)
    assert.equal(r.ok, true)
    assert.equal(r.mime, 'image/webp')
    assert.equal(r.gd, true, 'mit GD lesbar')
    const o = readFileSync(webp)
    assert.ok(!o.includes(Buffer.from('EXIF')) && !o.includes(Buffer.from('XMP ')), 'Blöcke weg')
    assert.equal(o.readUInt32LE(4), o.length - 8, 'RIFF-Länge stimmt')
    assert.equal(o[20] & 0x0c, 0, 'Merker EXIF/XMP gelöscht')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Webspace: Fotos ohne Neuspeicherung gehen durch bild_ohne_metadaten (Winterdienst, Kundenbereich, Fahrerseite, Checkliste)', () => {
  const read = (f) => readFileSync(join(ROOT, f), 'utf8')
  assert.match(read('wetter-alarm.php'), /if \(move_uploaded_file\(\$f\['tmp'\], \$ziel\)\) \{\n\s+if \(bild_ohne_metadaten\(\$ziel\)\) \{/)
  assert.match(read('kunden.php'), /if \(!bild_ohne_metadaten\(\$datei\)\) \{\n\s+@unlink\(\$datei\);/)
  // Fahrerseite und Checkliste am Handy: gemeinsam über bild_speichern (webspace-lib.php)
  assert.match(read('webspace-lib.php'), /function bild_speichern[^]*if \(!bild_ohne_metadaten\(\$ziel\)\) \{\n\s+@unlink\(\$ziel\);/)
  assert.match(read('mattentour.php'), /bild_speichern\(\$tmp, \$groesse, \$fehler, \$ziel, FOTO_BYTES\)/)
  assert.match(read('mein-plan.php'), /bild_speichern\([^;]+CK_FOTO_BYTES\)/)
})

// ---------------------------------------------------------------- 5. Alte Touren mit doppelter Stopp-ID

const stop = (id, customer, placementId, extra = {}) => ({ id, objectId: 'o1', customer: { id: customer, name: customer }, status: 'geplant', items: [{ placementId, jobKey: `${placementId}:${DAY}`, planned: 1 }], updatedAt: `${DAY}T05:00:00.000Z`, ...extra })
const oldTour = () => ({ schema: 1, id: 'mtalt00000001', date: DAY, driverId: 'e7', driverName: 'Ivo Beispiel', status: 'freigegeben', order: ['st-o1', 'st-o1'], stops: [stop('st-o1', 'c1', 'Haupteingang'), stop('st-o1', 'c2', 'Praxis')], updatedAt: `${DAY}T05:00:00.000Z`, route: {} })

test('Alte Tour mit doppelter Stopp-ID: erkannt, Hinweis im Büro, nichts geändert', () => {
  const t = oldTour()
  const before = JSON.stringify(t)
  assert.deepEqual(duplicateStopIds(t), [{ id: 'st-o1', count: 2 }])
  const p = tourProblems(t).filter((x) => x.code === 'stopp-id')
  assert.equal(p.length, 1)
  assert.equal(p[0].stopId, 'st-o1')
  assert.match(p[0].text, /Stopp-ID st-o1 steht 2-mal in dieser Tour .* führt die Stopps nicht zusammen/)
  assert.equal(JSON.stringify(t), before, 'Tour unverändert')
  assert.deepEqual(duplicateStopIds({ stops: [stop('st-o1', 'c1', 'a'), stop('st-o1-c2', 'c2', 'b')] }), [], 'neue Touren: eindeutig')
  assert.deepEqual(duplicateStopIds(null), [])
})

test('Alte Tour mit doppelter Stopp-ID: Zusammenführen verliert keinen Stopp und legt nichts zusammen', () => {
  const base = oldTour()
  // Büro und Fahrer ändern gleichzeitig je einen der beiden Stopps
  const mine = { ...oldTour(), stops: [stop('st-o1', 'c1', 'Haupteingang', { status: 'unterwegs', updatedAt: `${DAY}T08:00:00.000Z` }), stop('st-o1', 'c2', 'Praxis')], updatedAt: `${DAY}T08:00:00.000Z` }
  const theirs = { ...oldTour(), stops: [stop('st-o1', 'c1', 'Haupteingang'), stop('st-o1', 'c2', 'Praxis', { note: 'Praxis geschlossen', updatedAt: `${DAY}T08:05:00.000Z` })], updatedAt: `${DAY}T08:05:00.000Z` }
  const m = mergeTour(base, mine, theirs)
  assert.equal(m.stops.length, 2, 'beide Stopps bleiben')
  assert.deepEqual(m.stops.map((s) => [s.id, s.customer.id, s.items[0].placementId]), [['st-o1', 'c1', 'Haupteingang'], ['st-o1', 'c2', 'Praxis']])
  assert.equal(m.stops[0].status, 'unterwegs', 'Änderung am ersten')
  assert.equal(m.stops[1].note, 'Praxis geschlossen', 'Änderung am zweiten')
  assert.deepEqual(m.order, ['st-o1', 'st-o1'])
  // ohne Basis (neues Gerät) und mit nur einer Seite geändert: ebenfalls beide
  assert.equal(mergeTour(null, mine, theirs).stops.length, 2)
  assert.equal(mergeTour(base, base, theirs).stops.length, 2)
})
