import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRevierFolder, knownReviere, kontrolleRevierList, moveRows, moveTarget, objektIdOfFolder, revierFolder, revierName, revierOfFolder, reviereFor, revierSetup, splitObjectList, suggestRevier } from '../src/core/reviere.js'

const OBJ = [
  { id: 'o1', name: 'Wohnanlage Musterstraße 12', short: 'Muster 12', address: 'Musterstraße 12, 5020 Salzburg', region: 'Salzburg Stadt' },
  { id: 'o2', name: 'Bürohaus Hallein', address: 'Davisstraße 7, 5400 Hallein', region: 'Tennengau' },
  { id: 'o3', name: 'Ohne Revier', address: 'Irgendwo 1' },
]

test('Revier-Namen: wie saubererName der Werkzeuge, getrimmt, idempotent; Ordner mit Präfix', () => {
  assert.equal(revierName('Salzburg Stadt'), 'Salzburg-Stadt')
  assert.equal(revierName('  Flachgau / Nord '), 'Flachgau-Nord')
  assert.equal(revierName('Pongau: Süd?'), 'Pongau-Süd')
  assert.equal(revierName(revierName('Salzburg Stadt')), 'Salzburg-Stadt', 'zweimal gleich')
  assert.equal(revierFolder('Salzburg Stadt'), 'Revier Salzburg-Stadt')
  assert.equal(isRevierFolder('Revier Nord'), true)
  assert.equal(isRevierFolder('Reviere'), false)
  assert.equal(revierOfFolder('Revier Salzburg-Stadt'), 'Salzburg-Stadt')
  assert.equal(revierOfFolder('Musterstraße-12'), '')
  assert.equal(kontrolleRevierList('Salzburg Stadt'), 'Objektpruefprotokolle/Objekte/Revier Salzburg-Stadt/Stammdaten/Objekte.json')
})

test('Bekannte Reviere: aus config (mit Gruppen, klein) und Objekten, eindeutig nach Ordnername', () => {
  const list = knownReviere({ reviere: { 'Salzburg Stadt': ['AAA-1'], Pinzgau: 'bbb-2, ccc-3' }, objects: OBJ })
  assert.deepEqual(list.map((r) => [r.name, r.folder, r.groups]), [
    ['Pinzgau', 'Revier Pinzgau', ['bbb-2', 'ccc-3']],
    ['Salzburg Stadt', 'Revier Salzburg-Stadt', ['aaa-1']],
    ['Tennengau', 'Revier Tennengau', []],
  ])
  const all = { 'Salzburg Stadt': ['aaa-1'], Pinzgau: ['bbb'], Tennengau: ['ccc'] }
  assert.deepEqual(reviereFor({ all: true, reviere: all, objects: OBJ }), ['Pinzgau', 'Salzburg Stadt', 'Tennengau'])
  assert.deepEqual(reviereFor({ groups: ['AAA-1'], reviere: all, objects: OBJ }), ['Salzburg Stadt'])
  assert.deepEqual(reviereFor({ groups: ['zzz'], reviere: all, objects: OBJ }), [])
  // halb eingerichtet (Tennengau aus den Objekten ohne Gruppe): noch nicht aktiv, Werkzeuge bekommen keine Reviere
  assert.deepEqual(revierSetup({ reviere: { 'Salzburg Stadt': ['aaa-1'] }, objects: OBJ }).missing, ['Tennengau'])
  assert.equal(revierSetup({ reviere: { 'Salzburg Stadt': ['aaa-1'] }, objects: OBJ }).active, false)
  assert.deepEqual(reviereFor({ all: true, reviere: { 'Salzburg Stadt': ['aaa-1'] }, objects: OBJ }), [])
  assert.equal(revierSetup({}).active, false, 'ohne Reviere nichts')
})

test('Vorschlag für alte Ordner: Name, Kennung davor, Adresse; nichts Unsicheres', () => {
  assert.deepEqual(suggestRevier('Wohnanlage-Musterstraße-12', OBJ), { revier: 'Salzburg Stadt', object: 'Wohnanlage Musterstraße 12', score: 3 })
  assert.equal(suggestRevier('O-17_Bürohaus-Hallein', OBJ).revier, 'Tennengau', 'Kennung vor _ zählt nicht')
  assert.equal(suggestRevier('Davisstraße-7', OBJ).revier, 'Tennengau', 'über die Adresse')
  assert.equal(suggestRevier('Irgendwo-1', OBJ), null, 'Objekt ohne Revier')
  assert.equal(suggestRevier('Ganz-anderes-Haus', OBJ), null)
})

test('Umzug: Ordner ohne Revier je Werkzeug, EBG-Orte einzeln, Revier- und Stammdaten-Ordner bleiben', () => {
  const listing = {
    'Wasserzähler - Ablesung': [{ name: 'Revier Nord', folder: true }, { name: 'EBG', folder: true }, { name: 'Davisstraße-7', folder: true }, { name: 'liesmich.txt', folder: false }],
    'Wasserzähler - Ablesung/EBG': [{ name: 'Musterstraße-12', folder: true }],
    'Objektpruefprotokolle/Objekte': [{ name: 'O-1_Wohnanlage-Musterstraße-12', folder: true }, { name: 'Revier Tennengau', folder: true }],
    Objektdoku: [{ name: 'Stammdaten', folder: true }, { name: 'D1_Bürohaus-Hallein', folder: true }],
  }
  const rows = moveRows(listing, OBJ)
  assert.deepEqual(rows.map((r) => [r.path, r.suggestion?.revier || '']), [
    ['Wasserzähler - Ablesung/Davisstraße-7', 'Tennengau'],
    ['Wasserzähler - Ablesung/EBG/Musterstraße-12', 'Salzburg Stadt'],
    ['Objektpruefprotokolle/Objekte/O-1_Wohnanlage-Musterstraße-12', 'Salzburg Stadt'],
    ['Objektdoku/D1_Bürohaus-Hallein', 'Tennengau'],
  ])
  assert.equal(moveTarget(rows[0], 'Tennengau'), 'Wasserzähler - Ablesung/Revier Tennengau')
  assert.equal(moveTarget(rows[1], 'Salzburg Stadt'), 'Wasserzähler - Ablesung/Revier Salzburg-Stadt/EBG')
  assert.equal(moveTarget(rows[2], 'Salzburg Stadt'), 'Objektpruefprotokolle/Objekte/Revier Salzburg-Stadt')
  assert.equal(objektIdOfFolder('O-1_Wohnanlage-Musterstraße-12'), 'O-1')
  assert.equal(objektIdOfFolder('ohne'), '')
})

test('Objektliste der Objektkontrolle aufteilen: umgezogene Objekte in ihr Revier (Kennung oder Name), Rest bleibt', () => {
  const list = [{ objektId: 'O-1', objekt: 'Wohnanlage' }, { objektId: 'O-2', objekt: 'Büro' }, { objekt: 'Lager Süd' }, { objektId: '', objekt: 'Fremd' }]
  const { rest, byRevier } = splitObjectList(list, [{ folder: 'O-1_Wohnanlage', revier: 'Salzburg Stadt' }, { folder: 'Lager-Süd', revier: 'Salzburg Stadt' }])
  assert.deepEqual(rest.map((e) => e.objekt), ['Büro', 'Fremd'])
  assert.deepEqual(byRevier['Salzburg Stadt'].map((e) => [e.objekt, e.revier]), [['Wohnanlage', 'Salzburg-Stadt'], ['Lager Süd', 'Salzburg-Stadt']])
})

test('Rechte-Tabelle der Werkzeuge mit Revieren: Rollen auf den Grundordnern nur Lesen, Vollzugriff und Mattenwechsel wie bisher', async () => {
  const { toolFolderRights } = await import('../src/storage/data-service.js')
  const { resolveAccess } = await import('../src/core/access.js')
  const ol = resolveAccess({ preview: 'objektleitung' })
  const right = (rows, f) => rows.find((r) => r[0] === f)[2]
  const before = toolFolderRights(ol)
  const after = toolFolderRights(ol, { reviere: true })
  assert.equal(right(before, 'Objektpruefprotokolle'), 'Bearbeiten')
  assert.equal(right(after, 'Objektpruefprotokolle'), 'Lesen')
  assert.equal(right(after, 'Wasserzähler - Ablesung'), 'Lesen')
  const matten = resolveAccess({ preview: 'mattenwechsel' })
  assert.equal(right(toolFolderRights(matten, { reviere: true }), 'Mattenwechsel'), 'Bearbeiten', 'Mattenwechsel wird nicht geteilt')
  const voll = resolveAccess({ preview: 'disposition' })
  assert.ok(toolFolderRights(voll, { reviere: true }).every((r) => r[2] === 'Bearbeiten'))
})
