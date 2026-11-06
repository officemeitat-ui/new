// Mattenwechsel-Modul (core/matten.js): Datei, Konzept-Beispiel mit drei Liegeplätzen (14/28 Tage), Prüfen vor dem
// Speichern, vorläufige Anzeige „nächster Wechsel“, Kunden und Mattentypen aus der Fakturierung bzw. aus der Kopie
// am Liegeplatz, Filter, Gruppierung je Kunde → Objekt, Gebiete.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  areaByName,
  areaProblem,
  coordsFromObject,
  counts,
  createPlacement,
  customerCopy,
  emptyMatten,
  filterRows,
  groupRows,
  intervalText,
  knownCustomers,
  knownTypes,
  matFromType,
  matLabel,
  matTypes,
  nextChangeSimple,
  nextState,
  normalizePlacement,
  placementProblem,
  placementRows,
  refreshCustomerCopies,
  updatePlacement,
  upgradeMatten,
} from '../src/core/matten.js'
import { createMattenDemo, MATTEN_ARTIKEL_BEISPIEL } from '../src/data/demo-matten.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const TODAY = '2026-11-06'
const ARTICLES = [...MATTEN_ARTIKEL_BEISPIEL, { id: 'a-x', group: 'Unterhaltsreinigung', name: 'Unterhaltsreinigung', price: 0 }, { id: 'a-alt', group: 'Matten', name: 'Matte alt 60 × 90', active: false }]
const CUSTOMERS = [{ id: 'c1', name: 'Hausverwaltung Beispiel GmbH', customerNo: '10001', objectIds: ['o5'] }, { id: 'c2', name: '', firstName: 'Eva', lastName: 'Muster', customerNo: '10002', objectIds: [] }]
const OBJECTS = [{ id: 'o5', name: 'Wohnanlage Lehen', address: 'Ignaz-Beispiel-Straße 12, 5020 Salzburg', lat: 47.81, lon: 13.03 }, { id: 'o2', name: 'Autohaus Maxglan', address: '5020 Salzburg-Maxglan' }]
let n = 0
const newId = (prefix) => `${prefix}-test-${++n}`
const stamp = { now: '2026-11-06T09:00:00.000Z', user: 'Petra Leitner' }
const art = (id) => MATTEN_ARTIKEL_BEISPIEL.find((a) => a.id === id)

/** Konzept-Beispiel: Kunde → Objekt → drei Liegeplätze. */
function konzeptBeispiel() {
  const input = [
    { name: 'Haupteingang', floor: 'EG', mats: [matFromType(art('a-mdemo1'), { qty: 2 })], intervalDays: '14', startDate: '2026-11-10', rule: 'rhythmus', workMinutes: '10' },
    { name: 'Stiege 2', floor: '1. OG', mats: [matFromType(art('a-mdemo2'), { qty: 1 })], intervalDays: 28, startDate: '2026-11-10', rule: 'rhythmus', workMinutes: 5 },
    { name: 'Tiefgarage Lift', floor: 'UG', access: 'Schlüssel beim Hausbesorger', mats: [matFromType(art('a-mdemo3'), { qty: 1, owner: 'kunde' })], intervalDays: 28, startDate: '2026-11-17', rule: 'rhythmus', window: { from: '07:00', to: '10:00', note: '' } },
  ]
  return input.map((x) => {
    const fields = normalizePlacement({ objectId: 'o5', customerId: 'c1', active: true, pauses: [], ...x })
    assert.equal(placementProblem(fields), '', x.name)
    return createPlacement({ ...fields, customer: customerCopy(CUSTOMERS[0]) }, { newId, now: stamp.now, user: stamp.user })
  })
}

test('Datei: leerer Inhalt wie in data-service.js, Schema 1, Aufrüsten ergänzt nur fehlende Listen', () => {
  assert.deepEqual(emptyMatten(), MODULE_DOCS.matten.empty())
  assert.equal(MODULE_DOCS.matten.path, 'matten/matten.json')
  assert.deepEqual(emptyMatten(), { schema: 1, settings: {}, placements: [], areas: [] })
  const old = { placements: [{ id: 'p1' }] }
  assert.deepEqual(upgradeMatten(old), { schema: 1, settings: {}, placements: [{ id: 'p1' }], areas: [] })
  // Beispieldaten: gültig, Kopien der Kunden und Matten vorhanden
  const demo = createMattenDemo()
  for (const p of demo.placements) assert.equal(placementProblem(normalizePlacement(p)), '', p.name)
  assert.ok(demo.placements.every((p) => p.customer?.name && p.mats.every((m) => m.name)))
})

test('Konzept-Beispiel: drei Liegeplätze eines Objekts mit 14 und 28 Tagen, Tabelle je Kunde → Objekt', () => {
  const placements = konzeptBeispiel()
  assert.equal(new Set(placements.map((p) => p.id)).size, 3, 'eigene IDs')
  assert.ok(placements.every((p) => p.createdAt === stamp.now && p.createdBy === stamp.user && p.updatedBy === stamp.user))
  const doc = { ...emptyMatten(), placements }
  const rows = placementRows({ doc, objects: OBJECTS, customers: CUSTOMERS, articles: ARTICLES, today: TODAY })
  const groups = groupRows(rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].customer.name, 'Hausverwaltung Beispiel GmbH')
  assert.equal(groups[0].objects.length, 1)
  assert.equal(groups[0].objects[0].object.name, 'Wohnanlage Lehen')
  // Liegeplatz | Matte | Stückzahl | Intervall | nächster Wechsel (nach Namen sortiert)
  const table = groups[0].objects[0].rows.map((r) => [r.placement.name, r.mats.map((m) => m.label).join(' + '), r.qty, intervalText(r.placement.intervalDays), r.next.date])
  assert.deepEqual(table, [
    ['Haupteingang', 'Schmutzfangmatte 85 × 150 cm grau', 2, 'alle 2 Wochen (14 Tage)', '2026-11-10'],
    ['Stiege 2', 'Schmutzfangmatte 85 × 120 cm navy', 1, 'alle 4 Wochen (28 Tage)', '2026-11-10'],
    ['Tiefgarage Lift', 'Schmutzfangmatte 115 × 200 cm grau', 1, 'alle 4 Wochen (28 Tage)', '2026-11-17'],
  ])
  assert.equal(rows.find((r) => r.placement.name === 'Tiefgarage Lift').mats[0].owner, 'kunde')
  assert.deepEqual(counts(rows), { aktiv: 3, matten: 4, kunden: 1, pruefen: 0, typ: 0 })
  // gespeicherte Felder (tatsächliches Datenmodell)
  const p = placements[0]
  assert.deepEqual(Object.keys(p).sort(), ['access', 'active', 'areaId', 'createdAt', 'createdBy', 'customer', 'customerId', 'floor', 'hint', 'id', 'intervalDays', 'mats', 'name', 'objectId', 'pauses', 'rule', 'startDate', 'updatedAt', 'updatedBy', 'workMinutes'].sort())
  assert.deepEqual(p.mats[0], { articleId: 'a-mdemo1', qty: 2, owner: 'wir', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 x 150 cm', color: 'Grau' })
  assert.deepEqual(placements[2].window, { from: '07:00', to: '10:00', note: '' })
  assert.deepEqual(p.customer, { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' })
})

test('Ohne Fakturierung: Kunde und Matte aus der Kopie am Liegeplatz', () => {
  const doc = { ...emptyMatten(), placements: konzeptBeispiel() }
  const rows = placementRows({ doc, objects: OBJECTS, customers: null, articles: null, today: TODAY })
  assert.equal(rows[0].customer.name, 'Hausverwaltung Beispiel GmbH')
  assert.equal(rows[0].customer.no, '10001')
  assert.equal(rows[0].mats[0].label, 'Schmutzfangmatte 85 × 150 cm grau')
  assert.deepEqual(knownCustomers({ customers: null, placements: doc.placements }), [{ id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }])
  assert.deepEqual(knownTypes({ articles: null, placements: doc.placements }).map((t) => t.id).sort(), ['a-mdemo1', 'a-mdemo2', 'a-mdemo3'])
  // mit Fakturierung: alle aktiven Mattentypen (nicht die anderen Artikel, nicht die inaktiven), Kunden mit Personennamen
  assert.deepEqual(knownTypes({ articles: ARTICLES }).map((t) => t.id), ['a-mdemo1', 'a-mdemo2', 'a-mdemo3', 'a-mdemo4'])
  assert.deepEqual(matTypes(ARTICLES).map((a) => a.id), ['a-mdemo1', 'a-mdemo2', 'a-mdemo3', 'a-mdemo4', 'a-alt'])
  assert.deepEqual(knownCustomers({ customers: CUSTOMERS }).map((c) => c.name), ['Eva Muster', 'Hausverwaltung Beispiel GmbH'])
  // Kopien auffrischen, wenn der Kunde umbenannt wurde
  const renamed = [{ ...CUSTOMERS[0], name: 'Hausverwaltung Neu GmbH' }]
  assert.equal(refreshCustomerCopies(doc.placements, renamed), 3)
  assert.equal(doc.placements[0].customer.name, 'Hausverwaltung Neu GmbH')
  assert.equal(refreshCustomerCopies(doc.placements, renamed), 0)
  // Mattentyp fehlt (nur Größe/Farbe aus dem Werkzeug); Typ gelöscht: Kopie bleibt lesbar
  assert.deepEqual(matLabel({ articleId: '', qty: 1, name: '60 x 90 cm Rot', legacy: { groesse: '60 x 90 cm', farbe: 'Rot' } }, ARTICLES), { label: '60 x 90 cm Rot', missing: true })
  assert.deepEqual(matLabel({ articleId: 'weg', qty: 1, name: 'Alte Matte' }, ARTICLES), { label: 'Alte Matte', missing: false })
})

test('Prüfen vor dem Speichern: Objekt, Kunde, Name, Matten, Intervall, Starttermin, Zeitfenster, Pausen', () => {
  const ok = { objectId: 'o5', customerId: 'c1', name: 'Eingang', mats: [{ articleId: 'a-mdemo1', qty: 1 }], intervalDays: 14, startDate: '2026-11-10', rule: 'rhythmus', pauses: [] }
  const problem = (over) => placementProblem(normalizePlacement({ ...ok, ...over }))
  assert.equal(problem({}), '')
  assert.match(problem({ objectId: '' }), /Objekt/)
  assert.match(problem({ customerId: '' }), /Kunden/)
  assert.match(problem({ name: '  ' }), /Liegeplatz benennen/)
  assert.match(problem({ mats: [] }), /mindestens eine Matte/)
  assert.match(problem({ mats: [{ articleId: '', qty: 1 }] }), /Mattentyp/)
  assert.match(problem({ mats: [{ articleId: 'a-mdemo1', qty: 0 }] }), /Stückzahl/)
  assert.match(problem({ mats: [{ articleId: 'a-mdemo1', qty: '2,5' }] }), /Stückzahl/)
  assert.match(problem({ intervalDays: '' }), /Intervall/)
  assert.match(problem({ intervalDays: 400 }), /Intervall/)
  assert.equal(problem({ intervalDays: 21 }), '', 'weitere Intervalle erlaubt')
  assert.match(problem({ startDate: '' }), /Starttermin/)
  assert.equal(problem({ startDate: '', rule: 'ab-ist' }), '', 'ab dem letzten Wechsel ohne Starttermin')
  assert.match(problem({ window: { from: '10:00', to: '07:00' } }), /endet vor/)
  assert.match(problem({ window: { from: '7 Uhr' } }), /Uhrzeit/)
  assert.match(problem({ pauses: [{ from: '', to: '2026-12-31', reason: 'x' }] }), /Pause/)
  assert.match(problem({ pauses: [{ from: '2026-12-31', to: '2026-12-01' }] }), /endet vor/)
  assert.match(problem({ workMinutes: 900 }), /Minuten/)
  assert.match(problem({ lat: 147, lon: 13 }), /Koordinaten/)
  // Matte aus dem Werkzeug ohne Typ (legacy) bleibt speicherbar
  assert.equal(problem({ mats: [{ articleId: '', qty: 1, name: '60 x 90 cm Rot', legacy: { groesse: '60 x 90 cm', farbe: 'Rot' } }] }), '')
  // leere Felder fallen weg, Texte getrimmt, Zahlen als Zahl
  const n1 = normalizePlacement({ ...ok, name: ' Eingang ', workMinutes: '', window: { from: '', to: '', note: '' }, lat: '', lon: '' })
  assert.equal(n1.name, 'Eingang')
  assert.ok(!('workMinutes' in n1) && !('window' in n1) && !('lat' in n1))
  assert.equal(normalizePlacement({ ...ok, intervalDays: '28' }).intervalDays, 28)
})

test('Ändern: Herkunft bleibt (legacyId, letzter Wechsel, zu prüfen), geleerte Felder verschwinden', () => {
  const existing = { id: 'mw1', legacyId: 'L-0007', lastExchange: { date: '2026-10-20', tourId: 'T-1', source: 'werkzeug' }, check: { reason: 'x' }, source: { system: 'mattenwechsel' }, objectId: 'o5', customerId: 'c1', name: 'Alt', workMinutes: 10, window: { from: '07:00', to: '09:00', note: '' }, lat: 47, lon: 13, geoQuality: 'werkzeug', createdAt: 'a', createdBy: 'b' }
  const fields = normalizePlacement({ objectId: 'o5', customerId: 'c1', name: 'Neu', mats: [{ articleId: 'a-mdemo1', qty: 1 }], intervalDays: 28, rule: 'ab-ist' })
  const out = updatePlacement(existing, fields, stamp)
  assert.equal(out.name, 'Neu')
  assert.equal(out.legacyId, 'L-0007')
  assert.deepEqual(out.lastExchange, existing.lastExchange)
  assert.ok(out.check && out.createdAt === 'a' && out.updatedAt === stamp.now)
  assert.ok(!('workMinutes' in out) && !('window' in out) && !('lat' in out) && !('geoQuality' in out))
})

test('Nächster Wechsel (vorläufig): Rhythmus ab Starttermin, ab letztem Wechsel, sofort, Pause, inaktiv', () => {
  const p = (over) => ({ intervalDays: 14, rule: 'rhythmus', startDate: '2026-11-10', pauses: [], active: true, ...over })
  assert.deepEqual(nextChangeSimple(p({}), TODAY), { date: '2026-11-10', basis: 'start', paused: false, inactive: false })
  // nach einem Wechsel: nächster Termin im Raster (Start + k × 14), auch wenn der Wechsel verspätet war
  assert.equal(nextChangeSimple(p({ lastExchange: { date: '2026-11-10' } }), TODAY).date, '2026-11-24')
  assert.equal(nextChangeSimple(p({ lastExchange: { date: '2026-11-12' } }), TODAY).date, '2026-11-24')
  assert.equal(nextChangeSimple(p({ lastExchange: { date: '2026-11-24' } }), TODAY).date, '2026-12-08')
  // Wechsel vor dem Starttermin zählt nicht
  assert.equal(nextChangeSimple(p({ lastExchange: { date: '2026-10-01' } }), TODAY).date, '2026-11-10')
  // ab dem letzten Wechsel (wie im Werkzeug): letzter + Intervall; ohne Wechsel und ohne Start sofort
  assert.equal(nextChangeSimple(p({ rule: 'ab-ist', intervalDays: 28, lastExchange: { date: '2026-10-20' } }), TODAY).date, '2026-11-17')
  assert.equal(nextChangeSimple(p({ rule: 'ab-ist', startDate: '' }), TODAY).date, '')
  assert.equal(nextState(nextChangeSimple(p({ rule: 'ab-ist', startDate: '' }), TODAY), TODAY), 'sofort')
  assert.equal(nextState(nextChangeSimple(p({ rule: 'ab-ist', intervalDays: 28, lastExchange: { date: '2026-09-01' } }), TODAY), TODAY), 'ueberfaellig')
  assert.equal(nextState(nextChangeSimple(p({}), TODAY), TODAY), 'faellig')
  assert.equal(nextState(nextChangeSimple(p({ startDate: '2026-12-01' }), TODAY), TODAY), 'geplant')
  assert.equal(nextState(nextChangeSimple(p({ pauses: [{ from: '2026-11-01', to: '2026-11-15' }] }), TODAY), TODAY), 'pausiert')
  assert.equal(nextState(nextChangeSimple(p({ active: false }), TODAY), TODAY), 'inaktiv')
  assert.equal(intervalText(14), 'alle 2 Wochen (14 Tage)')
  assert.equal(intervalText(10), 'alle 10 Tage')
})

test('Filter, Status und Kacheln: Kunde, Gebiet, Suche, zu prüfen, Mattentyp fehlt, inaktiv', () => {
  const placements = konzeptBeispiel()
  placements.push(createPlacement({ ...normalizePlacement({ objectId: 'o2', customerId: 'c2', name: 'Schauraum', mats: [{ articleId: '', qty: 3, name: '60 x 90 cm Rot', legacy: { groesse: '60 x 90 cm', farbe: 'Rot' } }], intervalDays: 28, rule: 'ab-ist', areaId: 'g1' }), check: { reason: 'Stückzahl unklar' } }, { newId, now: stamp.now, user: stamp.user }))
  placements.push(createPlacement({ ...normalizePlacement({ objectId: 'o2', customerId: 'c2', name: 'Lager', mats: [{ articleId: 'a-mdemo1', qty: 1 }], intervalDays: 28, rule: 'ab-ist', active: false }) }, { newId, now: stamp.now, user: stamp.user }))
  const doc = { ...emptyMatten(), placements, areas: [{ id: 'g1', name: 'Salzburg Nord', active: true }] }
  const rows = placementRows({ doc, objects: OBJECTS, customers: CUSTOMERS, articles: ARTICLES, today: TODAY })
  const names = (list) => list.map((r) => r.placement.name).sort()
  assert.deepEqual(names(filterRows(rows, {})), ['Haupteingang', 'Schauraum', 'Stiege 2', 'Tiefgarage Lift'], 'nur aktive')
  assert.deepEqual(names(filterRows(rows, { status: 'inaktiv' })), ['Lager'])
  assert.deepEqual(names(filterRows(rows, { status: 'pruefen' })), ['Schauraum'])
  assert.deepEqual(names(filterRows(rows, { status: 'typ' })), ['Schauraum'])
  assert.deepEqual(names(filterRows(rows, { customerId: 'c2' })), ['Schauraum'])
  assert.deepEqual(names(filterRows(rows, { areaId: 'g1' })), ['Schauraum'])
  assert.deepEqual(names(filterRows(rows, { q: 'tiefgarage' })), ['Tiefgarage Lift'])
  assert.deepEqual(names(filterRows(rows, { q: 'navy' })), ['Stiege 2'], 'Suche nach Matte')
  assert.deepEqual(names(filterRows(rows, { q: 'Wohnanlage' })), ['Haupteingang', 'Stiege 2', 'Tiefgarage Lift'], 'Suche nach Objekt')
  assert.deepEqual(names(filterRows(rows, { status: 'faellig' })).includes('Schauraum'), true, 'ohne Wechsel und Start: sofort fällig')
  assert.deepEqual(counts(rows), { aktiv: 4, matten: 7, kunden: 2, pruefen: 1, typ: 1 })
  assert.deepEqual(groupRows(filterRows(rows, {})).map((g) => g.customer.name), ['Eva Muster', 'Hausverwaltung Beispiel GmbH'])
})

test('Gebiete und Koordinaten: Namen eindeutig (Groß/klein egal), Koordinaten vom Objekt', () => {
  const doc = { ...emptyMatten(), areas: [{ id: 'g1', name: 'Salzburg Nord', active: true }, { id: 'g2', name: 'Süd', legacyName: 'Sued', active: true }] }
  assert.match(areaProblem(doc, { name: '' }), /Namen/)
  assert.match(areaProblem(doc, { name: 'salzburg  nord' }), /gibt es schon/)
  assert.equal(areaProblem(doc, { id: 'g1', name: 'Salzburg Nord' }), '', 'umbenennen auf sich selbst')
  assert.equal(areaByName(doc, 'sued')?.id, 'g2')
  assert.deepEqual(coordsFromObject(OBJECTS[0]), { lat: 47.81, lon: 13.03, geoQuality: 'objekt' })
  assert.equal(coordsFromObject(OBJECTS[1]), null)
})
