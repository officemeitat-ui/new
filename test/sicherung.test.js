// Datensicherung (core/sicherung.js): Auswahl der Dateien, Manifest, Prüfsummen, ZIP hin und zurück, Vergleich mit dem
// aktuellen Stand, Rückweg-Pfad, Erinnerung. Ablauf im Browser mit SharePoint-Attrappe: .pruefung/datensicherung_app.mjs.
// Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import {
  SICH_EVERY,
  sichArt,
  sichAuswahl,
  sichEintrag,
  sichFaellig,
  sichGroesse,
  sichManifest,
  sichManifestLesen,
  sichPruefen,
  sichPruefsumme,
  sichRueckwegPfad,
  sichVergleich,
  sichZipBauen,
  sichZipLesen,
  sichZipName,
  sichZurueckspielbar,
} from '../src/core/sicherung.js'
import { MODULE_DOCS, yearPath } from '../src/storage/data-service.js'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const LISTE = [
  { path: 'daten/stammdaten.json', size: 1200, etag: '"a1"', modified: '2026-11-01T08:00:00Z' },
  { path: 'objekte/objekte.json', size: 300, etag: '"a2"', modified: '2026-11-02T08:00:00Z' },
  { path: 'plaene/2026/2026-11-09.json', size: 800, etag: '"a3"', modified: '2026-11-08T08:00:00Z' },
  { path: MODULE_DOCS.fakturierung.path, size: 5000, etag: '"a4"', modified: '2026-11-03T08:00:00Z' },
  { path: yearPath('mattenJobs', '2026'), size: 900, etag: '"a5"', modified: '2026-11-04T08:00:00Z' },
  { path: 'matten/touren/2026/mt000000000001.json', size: 400, etag: '"a6"', modified: '2026-11-05T08:00:00Z' },
  { path: 'matten/touren/2027/mt000000000002.json', size: 410, etag: '"a7"', modified: '2026-11-05T09:00:00Z' },
  { path: 'matten/fotos/2026/mw-p1/2026-11-05_mt000000000001_51.jpg', size: 250000, etag: '"f1"', modified: '2026-11-05T08:10:00Z' },
  { path: 'fakturierung/belege/2026/R-2026-0001.pdf', size: 60000, etag: '"f2"', modified: '2026-11-03T09:00:00Z' },
  { path: '_Sicherung/2026-11-01/daten/stammdaten.json', size: 1100, etag: '"r1"', modified: '2026-11-01T07:00:00Z' },
]

test('Sicherung: Art je Datei – JSON sind Daten, PDFs und Fotos Anhänge, Rückweg-Ordner und „..“ nie', () => {
  assert.equal(sichArt('daten/stammdaten.json'), 'daten')
  assert.equal(sichArt('matten/touren/2026/mt1.JSON'), 'daten')
  assert.equal(sichArt('matten/fotos/2026/x/a.jpg'), 'anhang')
  assert.equal(sichArt('exporte/Woche.xlsx'), 'anhang')
  assert.equal(sichArt('_Sicherung/2026-11-01/daten/stammdaten.json'), '')
  assert.equal(sichArt('../geheim.json'), '')
  assert.equal(sichArt('daten/../x.json'), '')
  assert.equal(sichArt(''), '')
  assert.equal(sichArt('/daten/stammdaten.json'), 'daten', 'führender Schrägstrich zählt nicht')
})

test('Sicherung: Auswahl – alle JSON samt Modul-, Jahres- und Tour-Dateien, Anhänge nur auf Wunsch, mit Größe', () => {
  const ohne = sichAuswahl({ files: LISTE })
  assert.deepEqual(
    ohne.dateien.map((f) => f.path),
    ['daten/stammdaten.json', 'fakturierung/fakturierung.json', 'matten/einsaetze-2026.json', 'matten/touren/2026/mt000000000001.json', 'matten/touren/2027/mt000000000002.json', 'objekte/objekte.json', 'plaene/2026/2026-11-09.json'],
  )
  assert.deepEqual(ohne.daten, { anzahl: 7, groesse: 1200 + 300 + 800 + 5000 + 900 + 400 + 410 })
  assert.deepEqual(ohne.anhaenge, { anzahl: 2, groesse: 310000 })
  assert.deepEqual(ohne.ausgelassen, { anzahl: 2, groesse: 310000 }, 'ohne Anhänge: Größe der ausgelassenen angezeigt')
  const mit = sichAuswahl({ files: LISTE, anhaenge: true })
  assert.equal(mit.dateien.length, 9)
  assert.deepEqual(mit.ausgelassen, { anzahl: 0, groesse: 0 })
  assert.ok(!mit.dateien.some((f) => f.path.startsWith('_Sicherung/')), 'Rückweg-Ordner wird nicht gesichert')
  assert.deepEqual(mit.dateien.find((f) => f.path.endsWith('.jpg')), { path: 'matten/fotos/2026/mw-p1/2026-11-05_mt000000000001_51.jpg', art: 'anhang', size: 250000, etag: '"f1"', modified: '2026-11-05T08:10:00Z' })
})

test('Sicherung: Auswahl – geladene Dateien kommen mit, auch wenn die Liste sie nicht hat; nur was die Rolle lesen darf', () => {
  const known = ['lohn/zeitkonto.json', 'daten/stammdaten.json', 'personal/abwesenheiten.json']
  const r = sichAuswahl({ files: LISTE, known })
  assert.ok(r.dateien.some((f) => f.path === 'lohn/zeitkonto.json' && f.etag === null), 'geladen, aber nicht in der Liste')
  assert.equal(r.dateien.filter((f) => f.path === 'daten/stammdaten.json').length, 1, 'kein Doppel')
  assert.equal(r.dateien.find((f) => f.path === 'daten/stammdaten.json').etag, '"a1"', 'Angaben aus der Liste gelten')
  // eingeschränkte Leserechte (z. B. später eine eigene Rolle): nur deren Dateien
  const nurMatten = sichAuswahl({ files: LISTE, known, read: (p) => p.startsWith('matten/'), anhaenge: true })
  assert.deepEqual(nurMatten.dateien.map((f) => f.path), ['matten/einsaetze-2026.json', 'matten/fotos/2026/mw-p1/2026-11-05_mt000000000001_51.jpg', 'matten/touren/2026/mt000000000001.json', 'matten/touren/2027/mt000000000002.json'])
})

test('Sicherung: Prüfsumme SHA-256 wie Node (Text und Bytes)', async () => {
  assert.equal(await sichPruefsumme('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const bytes = new Uint8Array([0, 1, 2, 250, 255])
  assert.equal(await sichPruefsumme(bytes), sha(Buffer.from(bytes)))
})

test('Sicherung: Manifest mit Datum, App-Version, je Datei Pfad, Größe, SHA-256, eTag, zuletzt geändert; Fehler je Datei', () => {
  const m = sichManifest({
    erstellt: '2026-11-09T10:00:00.000Z',
    app: { name: 'Cleanos App', version: '6BIGL3MP' },
    quelle: { ablage: 'SharePoint', ordner: 'Plattform/', ort: 'SharePoint · Cleanos · Cleanos_Daten/Plattform' },
    von: 'Petra Leitner',
    dateien: [
      { pfad: 'objekte/objekte.json', groesse: 3, sha256: 'b', etag: '"a2"', geaendert: '2026-11-02T08:00:00Z', bytes: new Uint8Array(3) },
      { pfad: 'daten/stammdaten.json', groesse: 5, sha256: 'a', etag: '"a1"', geaendert: '2026-11-01T08:00:00Z' },
    ],
    fehler: [{ pfad: 'lohn/zeitkonto.json', fehler: 'nicht gefunden' }],
    ausgelassen: { anzahl: 2, groesse: 310000 },
  })
  assert.equal(m.format, 'cleanos-sicherung')
  assert.equal(m.version, 1)
  assert.deepEqual(m.app, { name: 'Cleanos App', version: '6BIGL3MP' })
  assert.equal(m.quelle.ordner, 'Plattform')
  assert.equal(m.anzahl, 2)
  assert.equal(m.groesse, 8)
  assert.deepEqual(m.dateien[0], { pfad: 'daten/stammdaten.json', groesse: 5, sha256: 'a', etag: '"a1"', geaendert: '2026-11-01T08:00:00Z' }, 'sortiert, ohne Inhalt')
  assert.deepEqual(m.fehler, [{ pfad: 'lohn/zeitkonto.json', fehler: 'nicht gefunden' }])
  assert.deepEqual(m.ausgelassen, { anzahl: 2, groesse: 310000 })
  assert.equal(sichEintrag(m, 'daten/stammdaten.json'), 'Plattform/daten/stammdaten.json')
  // lesen: nur Sicherungen der App
  assert.deepEqual(sichManifestLesen(JSON.stringify(m)), m)
  assert.throws(() => sichManifestLesen('{"dateien":[]}'), /Keine Sicherung der App/)
  assert.throws(() => sichManifestLesen('kein json'), /Keine Sicherung der App/)
  assert.throws(() => sichManifestLesen(JSON.stringify({ ...m, version: 9 })), /neueren Fassung/)
})

test('Sicherung: ZIP bauen und lesen, Prüfsummen stimmen; veränderte und fehlende Datei werden erkannt', async () => {
  const inhalt = {
    'daten/stammdaten.json': Buffer.from(JSON.stringify({ employees: [{ id: 'e1', name: 'Anna Beispiel' }] }, null, 1)),
    'matten/touren/2026/mt000000000001.json': Buffer.from('{"id":"mt000000000001","stops":[]}'),
    'matten/fotos/2026/mw-p1/a.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]),
  }
  const files = Object.entries(inhalt).map(([pfad, bytes]) => ({ pfad, bytes, groesse: bytes.length, sha256: sha(bytes), etag: '"x"', geaendert: '2026-11-05T08:00:00Z' }))
  const m = sichManifest({ erstellt: '2026-11-09T10:00:00Z', quelle: { ordner: 'Plattform' }, anhaenge: true, dateien: files })
  const zipBytes = await sichZipBauen(JSZip, m, files, { type: 'uint8array' })
  const z = await sichZipLesen(JSZip, zipBytes)
  assert.deepEqual(z.manifest, m)
  assert.deepEqual(z.namen.sort(), Object.keys(inhalt).map((p) => `Plattform/${p}`).sort())
  assert.deepEqual(Buffer.from(await z.lesen('matten/fotos/2026/mw-p1/a.jpg')), inhalt['matten/fotos/2026/mw-p1/a.jpg'])
  const steps = []
  const ok = await sichPruefen(z.manifest, z.lesen, { namen: z.namen, onStep: (i, n) => steps.push(`${i}/${n}`) })
  assert.deepEqual([ok.ok, ok.falsch, ok.fehlt, ok.fremd], [3, 0, 0, []])
  assert.deepEqual(steps, ['0/3', '1/3', '2/3'])
  // eine Datei verändert, eine entfernt, eine fremde dazu
  const raw = await JSZip.loadAsync(zipBytes)
  raw.file('Plattform/daten/stammdaten.json', '{"employees":[]}')
  raw.remove('Plattform/matten/touren/2026/mt000000000001.json')
  raw.file('Plattform/fremd.json', '{}')
  const z2 = await sichZipLesen(JSZip, await raw.generateAsync({ type: 'uint8array' }))
  const bad = await sichPruefen(z2.manifest, z2.lesen, { namen: z2.namen })
  assert.deepEqual([bad.ok, bad.falsch, bad.fehlt, bad.fremd], [1, 1, 1, ['Plattform/fremd.json']])
  assert.match(bad.dateien.find((d) => d.pfad === 'daten/stammdaten.json').grund, /Prüfsumme/)
  assert.equal(bad.dateien.find((d) => d.pfad.startsWith('matten/touren')).status, 'fehlt')
  // keine ZIP-Datei, ZIP ohne Manifest
  await assert.rejects(sichZipLesen(JSZip, new Uint8Array([1, 2, 3])), /keine ZIP-Datei/)
  const leer = new JSZip()
  leer.file('a.txt', 'x')
  await assert.rejects(sichZipLesen(JSZip, await leer.generateAsync({ type: 'uint8array' })), /manifest\.json fehlt/)
})

test('Sicherung: Vergleich mit dem aktuellen Stand – gleich, neuer, älter, geändert, fehlt, neu', () => {
  const m = sichManifest({
    erstellt: '2026-11-09T10:00:00Z',
    dateien: [
      { pfad: 'a/gleich.json', groesse: 1, sha256: 'x', etag: '"1"', geaendert: '2026-11-01T08:00:00Z' },
      { pfad: 'a/neuer.json', groesse: 1, sha256: 'x', etag: '"2"', geaendert: '2026-11-01T08:00:00Z' },
      { pfad: 'a/aelter.json', groesse: 1, sha256: 'x', etag: '"3"', geaendert: '2026-11-05T08:00:00Z' },
      { pfad: 'a/anders.json', groesse: 1, sha256: 'x', etag: '"4"', geaendert: null },
      { pfad: 'a/weg.json', groesse: 1, sha256: 'x', etag: '"5"', geaendert: '2026-11-01T08:00:00Z' },
    ],
  })
  const jetzt = [
    { path: 'a/gleich.json', etag: '"1"', modified: '2026-11-01T08:00:00Z' },
    { path: 'a/neuer.json', etag: '"2b"', modified: '2026-11-08T08:00:00Z' },
    { path: 'a/aelter.json', etag: '"3b"', modified: '2026-11-02T08:00:00Z' },
    { path: 'a/anders.json', etag: '"4b"', modified: '2026-11-02T08:00:00Z' },
    { path: 'a/dazu.json', etag: '"6"', modified: '2026-11-09T11:00:00Z' },
    { path: 'a/foto.jpg', etag: '"7"', modified: '2026-11-09T11:00:00Z' },
    { path: '_Sicherung/2026-11-09/a/neuer.json', etag: '"8"', modified: '2026-11-09T11:00:00Z' },
  ]
  const v = sichVergleich(m, jetzt)
  assert.deepEqual(Object.fromEntries(v.dateien.map((d) => [d.pfad, d.status])), { 'a/aelter.json': 'aelter', 'a/anders.json': 'anders', 'a/dazu.json': 'neu', 'a/gleich.json': 'gleich', 'a/neuer.json': 'neuer', 'a/weg.json': 'fehlt' })
  assert.deepEqual(v.zaehler, { gleich: 1, neuer: 1, aelter: 1, anders: 1, fehlt: 1, neu: 1 })
  // Sicherung mit Anhängen: ein neues Foto zählt als neu
  assert.equal(sichVergleich({ ...m, anhaenge: true }, jetzt).zaehler.neu, 2)
  // zurückspielen nur mit stimmender Prüfsumme, nur was anders ist oder fehlt
  const by = Object.fromEntries(v.dateien.map((d) => [d.pfad, d]))
  assert.ok(sichZurueckspielbar(by['a/weg.json'], { status: 'ok' }))
  assert.ok(sichZurueckspielbar(by['a/neuer.json'], { status: 'ok' }))
  assert.ok(!sichZurueckspielbar(by['a/neuer.json'], { status: 'falsch' }))
  assert.ok(!sichZurueckspielbar(by['a/gleich.json'], { status: 'ok' }))
  assert.ok(!sichZurueckspielbar(by['a/dazu.json'], { status: 'ok' }), 'nicht in der Sicherung')
})

test('Sicherung: Rückweg nach _Sicherung/<Datum>/, beim zweiten Mal am selben Tag mit Nummer', () => {
  assert.equal(sichRueckwegPfad('2026-11-09', 'daten/stammdaten.json'), '_Sicherung/2026-11-09/daten/stammdaten.json')
  assert.equal(sichRueckwegPfad('2026-11-09', 'daten/stammdaten.json', 2), '_Sicherung/2026-11-09/daten/stammdaten (2).json')
  assert.equal(sichRueckwegPfad('2026-11-09', 'matten/fotos/2026/a.b/foto.jpg', 3), '_Sicherung/2026-11-09/matten/fotos/2026/a.b/foto (3).jpg')
  assert.equal(sichRueckwegPfad('2026-11-09', 'exporte/liste', 2), '_Sicherung/2026-11-09/exporte/liste (2)')
})

test('Sicherung: Erinnerung – noch nie, nach 30 Tagen fällig, einstellbar', () => {
  assert.deepEqual(sichFaellig({}, '2026-11-09'), { datum: '', tage: null, every: SICH_EVERY, faellig: true })
  assert.deepEqual(sichFaellig({ datum: '2026-10-20' }, '2026-11-09'), { datum: '2026-10-20', tage: 20, every: 30, faellig: false })
  assert.equal(sichFaellig({ datum: '2026-10-10' }, '2026-11-09').faellig, true, 'genau 30 Tage')
  assert.equal(sichFaellig({ datum: '2026-10-20', every: 14 }, '2026-11-09').faellig, true)
  assert.equal(sichFaellig({ datum: '2026-10-20', every: 'x' }, '2026-11-09').every, 30)
  assert.equal(sichFaellig({ datum: 'gestern' }, '2026-11-09').tage, null, 'ungültiges Datum wie noch nie')
})

test('Sicherung: Dateiname und Größe lesbar', () => {
  assert.equal(sichZipName('2026-11-09', 'Cleanos'), 'Cleanos-Sicherung-2026-11-09.zip')
  assert.equal(sichZipName('2026-11-09', 'Reinigung & Co'), 'Reinigung-Co-Sicherung-2026-11-09.zip')
  assert.deepEqual([980, 12 * 1024, 3.4 * 1024 ** 2, 1.2 * 1024 ** 3].map(sichGroesse), ['980 B', '12 KB', '3,4 MB', '1,2 GB'])
})
