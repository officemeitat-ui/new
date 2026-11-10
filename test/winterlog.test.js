import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { viennaTime } from '../src/core/weather.js'
import { entriesFor, fromServer, logKey, logRows, missingLogs, newFromServer, photoPath, workText } from '../src/core/winterlog.js'
import { winterLogDocument, winterLogPdfName } from '../src/export/winter-pdf.js'

const sec = (iso) => Math.floor(Date.parse(iso) / 1000)
const server = (over = {}) => ({ id: 'ab12cd34ef56', datum: '2026-12-02', erledigt: sec('2026-12-02T04:40:00Z'), ort: 'Hallein', objektId: 'o5', objekt: 'Wohnanlage Rif', adresse: 'Rif 3', person: 'Elif', geraeumt: true, gestreut: true, kontrolle: false, mittel: 'Splitt', notiz: 'Eis', fotos: ['ab12cd34ef56-1.jpg', '../boese.php'], lage: 'Schneefall ab 23:00 Uhr', eingetragen: sec('2026-12-02T04:45:00Z'), alarm: 'al1', test: false, ...over })

test('Protokoll vom Handy: übernehmen, ohne Testalarme und ohne Doppelte, nur gültige Fotonamen', () => {
  const e = fromServer(server())
  assert.equal(e.id, 'hab12cd34ef56')
  assert.equal(e.date, '2026-12-02')
  assert.equal(e.at, '2026-12-02T04:40:00.000Z')
  assert.deepEqual(e.fotos, [{ datei: 'ab12cd34ef56-1.jpg' }], 'fremde Dateinamen fallen weg')
  assert.equal(e.quelle, 'Handy')
  assert.equal(logKey(e), '2026-12-02|o5|hab12cd34ef56')
  const log = { [logKey(e)]: e }
  assert.equal(newFromServer([server()], log).length, 0, 'schon übernommen')
  assert.equal(newFromServer([server({ id: '0123456789ab' })], log).length, 1)
  assert.equal(newFromServer([server({ id: '0123456789ab', test: true })], {}).length, 0, 'Testalarm')
  assert.equal(fromServer(server({ mittel: 'Gift' })).mittel, '', 'unbekanntes Streumittel')
})

test('Protokoll: Tätigkeit in Worten', () => {
  assert.equal(workText({ geraeumt: true, gestreut: true, mittel: 'Splitt' }), 'geräumt, gestreut (Splitt)')
  assert.equal(workText({ geraeumt: true }), 'geräumt')
  assert.equal(workText({ gestreut: true, mittel: '' }), 'gestreut')
  assert.equal(workText({ kontrolle: true }), 'kontrolliert, nichts nötig')
})

test('Fehlendes Protokoll: erst nach „fertig bis“ plus 2 Stunden, nicht abgesagt, nur mit Winterdienst', () => {
  const objects = [
    { id: 'o5', name: 'Wohnanlage Rif', winter: { active: true, until: '06:00' } },
    { id: 'o9', name: 'Bank', winter: { active: true } },
    { id: 'o1', name: 'Ohne', winter: { active: false } },
  ]
  const winter = { '2026-12-02|o5': { reason: 'Schnee' }, '2026-12-02|o9': { reason: 'Schnee' }, '2026-12-02|o1': {}, '2026-12-03|o5': { cancelled: true } }
  const at = (t) => viennaTime('2026-12-02', t)
  assert.deepEqual(missingLogs({ winter, objects, now: at('07:59') }), [], 'noch in der Frist')
  assert.deepEqual(missingLogs({ winter, objects, now: at('08:01') }).map((x) => x.object.id), ['o9', 'o5'], 'nach Tag, dann Name (Bank vor Wohnanlage)')
  const log = { '2026-12-02|o5|x': { date: '2026-12-02', objectId: 'o5', at: '2026-12-02T04:40:00Z' } }
  assert.deepEqual(missingLogs({ winter, objects, log, now: at('09:00') }).map((x) => x.object.id), ['o9'])
  assert.equal(missingLogs({ winter, objects, log, now: at('09:00') })[0].until, '06:00', 'Standard aus den Regeln')
  assert.deepEqual(entriesFor(log, '2026-12-02', 'o5').length, 1)
})

test('Protokoll: Zeilen sortiert, Uhrzeit in Wien, Fotos in SharePoint', () => {
  const log = {
    a: { date: '2026-12-02', objectId: 'o5', object: 'Alt', at: '2026-12-02T05:10:00Z', person: 'B' },
    b: { date: '2026-12-02', objectId: 'o9', object: 'Bank', at: '2026-12-02T04:40:00Z', person: 'A' },
    c: { date: '2026-11-30', objectId: 'o5', at: '2026-11-30T05:00:00Z' },
    d: { date: '2026-12-01', objectId: 'o5', at: '2026-12-01T23:30:00Z' },
  }
  const rows = logRows(log, { from: '2026-12-01', to: '2026-12-31', objectsById: new Map([['o5', { name: 'Wohnanlage Rif', address: 'Rif 3' }]]) })
  assert.deepEqual(rows.map((r) => `${r.date} ${r.objectName}`), ['2026-12-01 Wohnanlage Rif', '2026-12-02 Bank', '2026-12-02 Wohnanlage Rif'])
  assert.deepEqual(rows.slice(1).map((r) => r.time), ['05:40', '06:10'], 'Uhrzeit in Wien')
  assert.match(rows[0].time, /02\.12\..* 00:30$/, 'nach Mitternacht erledigt: mit Datum')
  assert.equal(rows[2].address, 'Rif 3')
  assert.equal(photoPath({ date: '2026-12-02' }, 'ab12cd34ef56-1.jpg', 'Wohnanlage Lehen / Süd'), 'exporte/Winterdienst/2026-12/2026-12-02_Wohnanlage-Lehen-Sud_ab12cd34ef56-1.jpg')
})

test('PDF-Nachweis: Kopf mit Monat, Tabelle, Fotos im Anhang, ein Objekt allein', () => {
  const log = {
    a: { date: '2026-12-02', objectId: 'o5', object: 'Wohnanlage Rif', at: '2026-12-02T04:40:00Z', person: 'Elif', geraeumt: true, gestreut: true, mittel: 'Splitt', notiz: 'Eis', lage: 'Schneefall ab 23:00 Uhr', fotos: [{ datei: 'f1.jpg' }, { datei: 'f2.jpg', pfad: 'exporte/Winterdienst/2026-12/x.jpg' }] },
    b: { date: '2026-12-03', objectId: 'o9', object: 'Bank', at: '2026-12-03T05:00:00Z', person: 'Dragan', kontrolle: true, fotos: [] },
    c: { date: '2026-11-28', objectId: 'o9', at: '2026-11-28T05:00:00Z', fotos: [] },
  }
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const doc = winterLogDocument({ month: '2026-12', log, objects: [{ id: 'o5', name: 'Wohnanlage Rif', address: 'Rif 3, 5400 Hallein' }], brand: { name: 'Firma', colors: { primary: '#0c6cb4', muted: '#4b5b67' } }, photos: new Map([['f1.jpg', png]]) })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Winterdienst-Protokoll/)
  assert.match(json, /Dezember 2026/)
  const table = doc.content.find((x) => x.table)
  assert.equal(table.table.body.length, 3, 'Kopf + 2 Einträge im Dezember')
  assert.match(JSON.stringify(table.table.body[1]), /Wohnanlage Rif.*Rif 3, 5400 Hallein.*05:40.*Elif.*geräumt, gestreut \(Splitt\).*Schneefall/)
  assert.match(JSON.stringify(table.table.body[2]), /kontrolliert, nichts nötig/)
  assert.ok(json.includes(png), 'Foto eingebettet')
  assert.match(json, /Foto f2\.jpg \(SharePoint: exporte\/Winterdienst\/2026-12\/x\.jpg\)/, 'fehlendes Foto als Verweis')
  assert.match(json, /"pageBreak":"before"/, 'Fotos auf eigener Seite')
  const one = winterLogDocument({ month: '2026-12', log, objects: [{ id: 'o5', name: 'Wohnanlage Rif' }], objectId: 'o5' })
  assert.equal(one.content.find((x) => x.table).table.body.length, 2, 'nur ein Objekt')
  const empty = winterLogDocument({ month: '2027-01', log })
  assert.match(JSON.stringify(empty.content), /Keine Einträge in diesem Monat/)
  assert.equal(winterLogPdfName('2026-12'), 'Winterdienst-Protokoll_2026-12.pdf')
  assert.equal(winterLogPdfName('2026-12', 'Wohnanlage Rif'), 'Winterdienst-Protokoll_2026-12_Wohnanlage-Rif.pdf')
})

test('wetter-alarm.php: Protokolle „voriger und dieser Monat“ in Wiener Zeit, auch am 1. nach Mitternacht', () => {
  const php = readFileSync(new URL('../wetter-alarm.php', import.meta.url), 'utf8')
  const block = php.slice(php.indexOf("if ($aktion === 'protokolle')"), php.indexOf("if ($aktion === 'foto')"))
  assert.doesNotMatch(block, /strtotime\(/, 'strtotime() rechnet in der Zeitzone des Servers')
  const fn = php.match(/function protokoll_monate\([^]*?\n}\n/)?.[0]
  assert.ok(fn && block.includes('protokoll_monate(jetzt())'))
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
  } catch {
    return // ohne PHP nur die Prüfung oben
  }
  const months = (iso, tz = 'UTC') => JSON.parse(execFileSync('php', ['-d', `date.timezone=${tz}`, '-r', `${fn} echo json_encode(protokoll_monate((int) $argv[1]));`, String(sec(iso))], { encoding: 'utf8' }))
  // Di 1.12.2026 0:30 Uhr in Wien = 30.11. 23:30 UTC: November muss dabei sein (vorher: Oktober und Dezember)
  assert.deepEqual(months('2026-11-30T23:30:00Z'), ['2026-11', '2026-12'])
  assert.deepEqual(months('2026-03-31T22:30:00Z'), ['2026-03', '2026-04'], 'Sommerzeit, 1.4. 0:30 Uhr')
  assert.deepEqual(months('2027-01-01T08:00:00Z', 'America/New_York'), ['2026-12', '2027-01'], 'Jahreswechsel')
})
