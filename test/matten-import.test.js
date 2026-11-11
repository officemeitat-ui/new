// Übernahme aus dem Werkzeug Mattenwechsel (core/matten-import.js) mit den Werkzeug-Beispieldaten
// (src/data/demo-matten.js): Kunden über Kundennummer bzw. Namen, Gruppierung nach Adresse zu Objekten (vorhandene
// wiederverwenden), Größe/Farbe → Mattentyp, Wochen → Tage, letzter Wechsel aus allen Touren, legacyId, „zu prüfen“;
// idempotent (zweiter Lauf ändert nichts), Werkzeug-Daten bleiben unverändert, späterer Lauf trägt nur nach.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyImport, backupFolder, colorKey, isTourFile, lastExchanges, matchArticle, nameKey, planImport, sizeKey, toolDataFromFiles } from '../src/core/matten-import.js'
import { doneFromPlacements, emptyMatten, nextOf, normalizePlacement, placementProblem } from '../src/core/matten.js'
import { MATTEN_ARTIKEL_BEISPIEL, werkzeugBeispiel, werkzeugTourPfad } from '../src/data/demo-matten.js'

const CUSTOMERS = [
  { id: 'c-demo1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', objectIds: ['o5'] },
  { id: 'c-demo2', customerNo: '10002', name: 'Autohaus Maxglan Beispiel KG', objectIds: ['o2'] },
]
const OBJECTS = [
  { id: 'o5', name: 'Wohnanlage Lehen', address: '5020 Salzburg-Lehen' },
  { id: 'o2', name: 'Autohaus Maxglan', address: '5020 Salzburg-Maxglan' },
  // Adresse wie im Werkzeug, andere Schreibweise („Straße“ statt „Str.“): wird wiederverwendet
  { id: 'o-ig', name: 'Wohnhaus Ignaz-Beispiel-Straße', address: 'Ignaz-Beispiel-Straße 12, 5020 Salzburg', lat: 47.8, lon: 13.04 },
  // ähnliche Hausnummer: darf nicht passen
  { id: 'o-ig120', name: 'Ignaz-Beispiel-Straße 120', address: 'Ignaz-Beispiel-Straße 120, 5020 Salzburg' },
]
const ARTICLES = [...MATTEN_ARTIKEL_BEISPIEL, { id: 'a-fdemo1', group: 'Unterhaltsreinigung', name: 'Unterhaltsreinigung lt. Vertrag' }]
let n = 0
const newId = (prefix) => `${prefix}-imp-${++n}`
const NOW = '2026-11-06T10:00:00.000Z'
const run = (state, choices, tool = werkzeugBeispiel()) => {
  const plan = planImport({ tool, customers: state.customers, objects: state.objects, articles: state.articles, doc: state.doc, choices })
  const res = applyImport(plan, { doc: state.doc, customers: state.customers, objects: state.objects, articles: state.articles, newId, now: NOW, user: 'Petra Leitner' })
  return { plan, res, state: { ...state, doc: res.doc, customers: res.customers, objects: res.objects } }
}
const start = () => ({ doc: emptyMatten(), customers: structuredClone(CUSTOMERS), objects: structuredClone(OBJECTS), articles: structuredClone(ARTICLES) })

test('Hilfen: Namensschlüssel wie im Werkzeug, Größe und Farbe, Tour-Dateien, Sicherungsordner', () => {
  assert.equal(nameKey('Muster_GmbH'), nameKey('muster gmbh'))
  assert.equal(nameKey('Bäckerei Muster OG'), 'bäckerei muster')
  assert.equal(sizeKey('85 x 150 cm'), '85x150')
  assert.equal(sizeKey('150×85'), '85x150')
  assert.equal(sizeKey('ohne'), '')
  // Meter mit Komma und gemischte Schreibweisen aus den Listen des Büros
  assert.equal(sizeKey('0,85x 120 cm'), '85x120')
  assert.equal(sizeKey('0,85x 1,20 cm'), '85x120')
  assert.equal(sizeKey('0,85 x 1,50 cm'), '85x150')
  assert.equal(sizeKey('1,5 x 2,5 m'), '150x250')
  assert.equal(sizeKey('115x 250 cm'), '115x250')
  assert.equal(sizeKey('2x 85x120'), '85x120')
  assert.equal(sizeKey('Haus 1/2'), '')
  assert.equal(colorKey(' Grau / Schwarz '), 'grau/schwarz')
  assert.ok(isTourFile('2026-10-20_T-beispiel-b2.json') && !isTourFile('Tourbericht-Nord-20261020.pdf') && !isTourFile('Standorte.json'))
  assert.equal(backupFolder('2026-11-06'), 'Mattenwechsel/_Sicherung/2026-11-06')
  assert.equal(werkzeugTourPfad(werkzeugBeispiel().touren[0]), 'Mattenwechsel/Touren/2026/2026-10-06_Nord_T-beispiel-a1/2026-10-06_T-beispiel-a1.json')
  // Mattentyp: Größe und Farbe; ohne Felder aus dem Namen; nur Größe, wenn es in der Größe genau einen Typ ohne Farbe gibt
  assert.deepEqual(matchArticle(ARTICLES, { groesse: '85 x 150 cm', farbe: 'Grau' }), { id: 'a-mdemo1', how: 'Größe und Farbe' })
  assert.equal(matchArticle(ARTICLES, { groesse: '85 x 150 cm', farbe: 'Navy' }), null)
  const byName = [{ id: 'n1', group: 'Matten', name: 'Matte 85x150 Navy' }, { id: 'n2', group: 'Matten', name: 'Matte 60 × 90' }, { id: 'n0', group: 'Matten', name: 'Matte 85x150 Navy alt', active: false }]
  assert.deepEqual(matchArticle(byName, { groesse: '85 x 150 cm', farbe: 'Navy' }), { id: 'n1', how: 'Größe und Farbe' })
  assert.deepEqual(matchArticle(byName, { groesse: '60 x 90 cm', farbe: 'Rot' }), { id: 'n2', how: 'Größe' })
  assert.equal(matchArticle([{ id: 'x', group: 'Andere', name: 'Matte 60 x 90' }], { groesse: '60 x 90', farbe: '' }), null, 'nur Artikelgruppe Matten')
  // mehrere Arten in Größe und Farbe (P3: matKind): die Art „Standard“ zuerst
  const kinds = [{ id: 'k-logo', group: 'Matten', size: '85 × 150 cm', color: 'grau', matKind: 'Logo' }, { id: 'k-std', group: 'Matten', size: '85 × 150 cm', color: 'grau', matKind: 'Standard' }]
  assert.equal(matchArticle(kinds, { groesse: '85 x 150 cm', farbe: 'Grau' }).id, 'k-std')
})

test('Letzter Wechsel aus allen Touren: jüngster Halt „gewechselt“ je Liegeplatz', () => {
  const last = lastExchanges(werkzeugBeispiel().touren)
  assert.deepEqual(last['L-0001'], { date: '2026-10-20', tourId: 'T-beispiel-b2' })
  assert.deepEqual(last['L-0002'], { date: '2026-10-06', tourId: 'T-beispiel-a1' })
  assert.deepEqual(last['L-0006'], { date: '2026-10-20', tourId: 'T-beispiel-b2' }, '„nicht rein“ zählt nicht')
  assert.deepEqual(last['L-0003'], { date: '2026-09-15', tourId: 'T-beispiel-c3' })
  assert.equal(last['L-0005'], undefined, '„entfällt“ zählt nicht')
  assert.ok(last['L-0099'], 'unbekannter Liegeplatz steht in der Liste, wird aber nicht übernommen')
})

test('Vorschau: Kunden (Nummer, Name, ohne Vorschlag), Objekte je Kunde und Adresse, Mattentypen, fehlende genannt', () => {
  const s = start()
  const plan = planImport({ tool: werkzeugBeispiel(), ...s, doc: s.doc })
  // Kunden: nur die mit Liegeplätzen; L-0002 ohne kundeId landet über den Namen beim selben Kunden
  assert.deepEqual(plan.customers.map((r) => [r.name, r.count, r.suggestion?.id || '', r.suggestion?.how || '', r.choice]), [
    ['Autohaus Maxglan Beispiel KG', 1, 'c-demo2', 'Name', 'c-demo2'],
    ['Bäckerei Muster OG', 2, '', '', ''],
    ['Hausverwaltung Beispiel GmbH', 3, 'c-demo1', 'Kundennummer', 'c-demo1'],
  ])
  // Objekte: „Ignaz-Beispiel-Straße 12“ und „Ignaz-Beispiel-Str. 12“ sind eine Adresse, vorhandenes Objekt (nicht die 120)
  assert.deepEqual(plan.objects.map((r) => [r.address, r.count, r.suggestion?.id || '', r.choice]), [
    ['Autoweg 7, 5020 Salzburg', 1, '', 'neu'],
    ['Beispielgasse 7, 5400 Hallein', 2, '', 'neu'],
    ['Ignaz-Beispiel-Straße 12, 5020 Salzburg', 2, 'o-ig', 'o-ig'],
    ['Muster-Allee 5, 5020 Salzburg', 1, '', 'neu'],
  ])
  // Matten: Größe/Farbe → Typ; fehlende in der Vorschau
  assert.deepEqual(plan.mats.map((r) => [r.groesse, r.farbe, r.qty, r.choice]), [
    ['60 x 90 cm', 'Rot', 1, ''],
    ['85 x 120 cm', 'Navy', 1, 'a-mdemo2'],
    ['85 x 150 cm', 'Grau', 4, 'a-mdemo1'],
    ['85 x 150 cm', 'Navy', 1, ''],
    ['115 x 200 cm', 'Grau', 2, 'a-mdemo3'],
    ['115 x 200 cm', 'Grau/Schwarz', 1, ''],
  ])
  assert.deepEqual(plan.missingTypes.map((r) => `${r.groesse} ${r.farbe}`), ['60 x 90 cm Rot', '85 x 150 cm Navy', '115 x 200 cm Grau/Schwarz'])
  // ohne Wahl für die Bäckerei: deren zwei Liegeplätze bleiben draußen (fehlende Kunden nur auf Klick)
  assert.deepEqual([plan.counts.neu, plan.counts.ohneKunde, plan.counts.neueKunden, plan.counts.touren, plan.counts.wechsel], [4, 2, 0, 3, 6])
  assert.deepEqual(plan.areas, [{ name: 'Nord', existing: null }])
})

test('Übernahme der Werkzeug-Beispieldaten: vollständig, Felder wie geplant, Werkzeug-Daten unverändert', () => {
  const tool = werkzeugBeispiel()
  const before = JSON.stringify(tool)
  const { plan, res } = run(start(), { customers: { 'id:K-0002': 'neu' } }, tool)
  assert.equal(JSON.stringify(tool), before, 'Werkzeug-Daten werden nicht verändert')
  assert.equal(plan.counts.neu, 6)
  assert.deepEqual(res.summary, { placements: 6, updated: 0, customers: 1, objects: 3, areas: 2, links: 4 })
  const P = (lid) => res.doc.placements.find((p) => p.legacyId === lid)
  assert.equal(res.doc.placements.length, 6)
  assert.equal(new Set(res.doc.placements.map((p) => p.id)).size, 6)
  // Kunden
  const baeckerei = res.customers.find((c) => c.name === 'Bäckerei Muster OG')
  assert.equal(baeckerei.customerNo, '10003', 'nächste freie Kundennummer')
  assert.deepEqual([baeckerei.street, baeckerei.zip, baeckerei.city, baeckerei.deliveryNoteEmail, baeckerei.note, baeckerei.source], ['Beispielgasse 7', '5400', 'Hallein', 'backstube@muster-beispiel.example', 'Lieferschein an die Backstube', { system: 'mattenwechsel', id: 'K-0002' }])
  assert.equal(baeckerei.contacts[0].name, 'Frau Muster')
  assert.equal(res.customers.length, 3)
  // Objekte: vorhandenes wiederverwendet, drei neu, je dem Kunden zugeordnet (ein Objekt gehört genau einem Kunden)
  assert.equal(P('L-0001').objectId, 'o-ig')
  assert.equal(P('L-0002').objectId, 'o-ig', 'gleiche Adresse, andere Schreibweise')
  const muster = res.objects.find((o) => o.id === P('L-0003').objectId)
  assert.deepEqual([muster.name, muster.address, muster.source.system], ['Muster-Allee 5, Salzburg', 'Muster-Allee 5, 5020 Salzburg', 'mattenwechsel'])
  assert.equal(P('L-0004').objectId, P('L-0005').objectId)
  const hallein = res.objects.find((o) => o.id === P('L-0004').objectId)
  assert.deepEqual([hallein.lat, hallein.lon], [47.6831, 13.0962], 'Koordinaten aus dem Werkzeug')
  assert.deepEqual(res.customers.find((c) => c.id === 'c-demo1').objectIds, ['o5', 'o-ig', muster.id])
  assert.deepEqual(baeckerei.objectIds, [hallein.id])
  assert.deepEqual(res.customers.find((c) => c.id === 'c-demo2').objectIds, ['o2', P('L-0006').objectId])
  // Liegeplatz: Name aus der Lage, Wochen → Tage, Regel wie im Werkzeug, letzter Wechsel, Gebiet, Kopie des Kunden
  const p1 = P('L-0001')
  assert.deepEqual([p1.name, p1.intervalDays, p1.rule, p1.startDate, p1.hint, p1.active, p1.customerId, p1.customer], ['Haupteingang', 14, 'ab-ist', '2026-10-20', 'Schlüssel beim Hausbesorger', true, 'c-demo1', { id: 'c-demo1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }])
  assert.deepEqual(p1.lastExchange, { date: '2026-10-20', tourId: 'T-beispiel-b2', source: 'werkzeug' })
  assert.deepEqual(p1.mats, [{ articleId: 'a-mdemo1', qty: 2, owner: 'wir', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau', matKind: 'Standard' }])
  assert.deepEqual(p1.source, { system: 'mattenwechsel', quelle: 'Tourenliste Nord, Zeile 1' })
  assert.deepEqual([p1.createdAt, p1.createdBy, p1.updatedAt, p1.updatedBy], [NOW, 'Petra Leitner', NOW, 'Petra Leitner'])
  assert.deepEqual(res.doc.areas.map((a) => a.name).sort(), ['Nord', 'Süd'])
  assert.equal(res.doc.areas.find((a) => a.id === p1.areaId).name, 'Nord')
  assert.deepEqual([p1.lat, p1.lon, p1.geoQuality], [47.8, 13.04, 'objekt'], 'Koordinaten des Objekts')
  assert.equal(P('L-0002').intervalDays, 28)
  // zu prüfen, Kundeneigentum, fehlender Mattentyp mit Größe/Farbe, inaktiv, Koordinaten aus dem Werkzeug
  const p3 = P('L-0003')
  assert.deepEqual(p3.check, { reason: 'Stückzahl laut Liste unklar' })
  assert.deepEqual(p3.mats, [{ articleId: '', qty: 1, owner: 'kunde', name: '115 x 200 cm Grau/Schwarz', legacy: { groesse: '115 x 200 cm', farbe: 'Grau/Schwarz' } }])
  assert.equal(P('L-0005').active, false)
  assert.equal(P('L-0005').lastExchange, undefined)
  assert.equal(P('L-0005').startDate, '2026-11-06', 'ohne Wechsel: Starttermin = Tag der Übernahme (sofort fällig wie im Werkzeug)')
  // Fälligkeit über den Fälligkeitsrechner: letzter Wechsel + Intervall (überfällig wie im Werkzeug)
  const done = doneFromPlacements(res.doc.placements)
  const next = (lid) => nextOf(P(lid), { today: '2026-11-06', done }).next
  assert.deepEqual([next('L-0001').date, next('L-0001').overdue], ['2026-11-03', true])
  assert.deepEqual([next('L-0006').date, next('L-0006').overdue], ['2026-11-17', false])
  assert.equal(next('L-0005'), null, 'inaktiv')
  assert.deepEqual([P('L-0004').lat, P('L-0004').geoQuality], [47.6831, 'werkzeug'])
  assert.deepEqual(P('L-0006').mats.map((m) => m.articleId), ['a-mdemo3', ''])
  // jeder übernommene Liegeplatz ist gültig (lässt sich so im Dialog speichern)
  for (const p of res.doc.placements) assert.equal(placementProblem(normalizePlacement(p)), '', p.legacyId)
})

test('Idempotent: zweiter Lauf mit denselben Daten ändert nichts (auch ohne die Wahl von vorher)', () => {
  const first = run(start(), { customers: { 'id:K-0002': 'neu' } })
  const snapshot = JSON.stringify(first.state)
  const second = run(first.state, {})
  assert.equal(second.plan.changes, 0)
  assert.deepEqual([second.plan.counts.neu, second.plan.counts.gleich, second.plan.counts.ohneKunde], [0, 6, 0])
  assert.ok(second.plan.customers.every((r) => r.suggestion?.how === 'schon übernommen'))
  assert.ok(second.plan.objects.every((r) => r.suggestion?.how === 'schon übernommen'))
  assert.deepEqual(second.res.summary, { placements: 0, updated: 0, customers: 0, objects: 0, areas: 0, links: 0 })
  assert.equal(JSON.stringify(second.state), snapshot)
  // ein dritter Lauf, diesmal mit „neu“ für die Bäckerei: legt nicht noch einmal an
  const third = run(first.state, { customers: { 'id:K-0002': 'neu' } })
  assert.equal(third.plan.changes, 0)
  assert.equal(JSON.stringify(third.state), snapshot)
})

test('Späterer Lauf trägt nur nach: jüngerer Wechsel, inzwischen angelegter Mattentyp, neuer Liegeplatz', () => {
  const first = run(start(), { customers: { 'id:K-0002': 'neu' } })
  const tool = werkzeugBeispiel()
  // neue Tour im Werkzeug (Parallelbetrieb), neuer Mattentyp in der Fakturierung, neuer Liegeplatz im Werkzeug
  tool.touren.push({ id: 'T-neu', datum: '2026-11-03', gebiet: 'Nord', halte: [{ lid: 'L-0002', status: 'gewechselt' }] })
  tool.standorte.push({ id: 'L-0007', gebiet: 'Nord', kunde: 'Hausverwaltung Beispiel GmbH', kundeId: 'K-0001', strasse: 'Muster-Allee 5', plz: '5020', ort: 'Salzburg', position: 'Hintereingang', matten: [{ anzahl: 1, farbe: 'Grau', groesse: '85 x 150 cm', eigentum: 'wir' }], intervallWochen: 4, aktiv: true })
  const state = { ...first.state, articles: [...first.state.articles, { id: 'a-navy150', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm navy', size: '85 x 150', color: 'Navy' }] }
  const before = first.state.doc.placements.find((p) => p.legacyId === 'L-0001')
  const later = run(state, {}, tool)
  assert.deepEqual([later.plan.counts.neu, later.plan.counts.aktualisieren], [1, 2])
  const P = (lid) => later.res.doc.placements.find((p) => p.legacyId === lid)
  assert.deepEqual(P('L-0002').lastExchange, { date: '2026-11-03', tourId: 'T-neu', source: 'werkzeug' })
  assert.deepEqual(P('L-0006').mats.map((m) => m.articleId), ['a-mdemo3', 'a-navy150'])
  assert.equal(P('L-0006').mats[1].qty, 1)
  assert.deepEqual(P('L-0001'), before, 'unverändert, was nichts Neues hat')
  assert.equal(P('L-0007').objectId, P('L-0003').objectId, 'dasselbe Objekt wie der andere Liegeplatz an der Adresse')
  assert.equal(later.res.summary.objects, 0)
  assert.equal(run(later.state, {}, tool).plan.changes, 0, 'danach wieder nichts zu tun')
})

test('Zuordnung von Hand: anderer Kunde, „nicht übernehmen“, anderes Objekt, Mattentyp; zwei Kunden an einer Adresse', () => {
  const s = start()
  const { res, plan } = run(s, { customers: { 'id:K-0003': '', 'id:K-0001': 'c-demo2' }, objects: { 'id:K-0001#muster allee 5|5020|salzburg': 'o5' }, mats: { '115x200|grau/schwarz': 'a-mdemo3' } })
  assert.equal(plan.counts.ohneKunde, 3, 'Autohaus nicht übernommen, Bäckerei ohne Wahl')
  const p3 = res.doc.placements.find((p) => p.legacyId === 'L-0003')
  assert.deepEqual([p3.customerId, p3.objectId, p3.mats[0].articleId, p3.mats[0].owner], ['c-demo2', 'o5', 'a-mdemo3', 'kunde'])
  // o5 gehört schon c-demo1: Zuordnung in der Fakturierung bleibt, Hinweis in der Vorschau
  assert.equal(plan.objects.find((r) => r.choice === 'o5').conflict, 'Hausverwaltung Beispiel GmbH')
  assert.deepEqual(res.customers.find((c) => c.id === 'c-demo1').objectIds, ['o5'])
  // zwei Kunden an derselben Adresse: zwei Objekte, Name mit Kunde
  const tool = werkzeugBeispiel()
  tool.standorte.push({ id: 'L-0008', gebiet: 'Süd', kunde: 'Café Probe', strasse: 'Beispielgasse 7', plz: '5400', ort: 'Hallein', position: 'Gastgarten', matten: [{ anzahl: 1, farbe: 'Grau', groesse: '85 x 150 cm' }], intervallWochen: 4 })
  const p2 = planImport({ tool, ...start(), doc: emptyMatten(), choices: { customers: { 'id:K-0002': 'neu', 'name:café probe': 'neu' } } })
  const hall = p2.objects.filter((r) => r.address === 'Beispielgasse 7, 5400 Hallein')
  assert.deepEqual(hall.map((r) => r.newName).sort(), ['Beispielgasse 7, Hallein – Bäckerei Muster OG', 'Beispielgasse 7, Hallein – Café Probe'])
})

test('Dateien aus dem Browser-Modus: Sicherung „Alles sichern“, Einzeldateien, Touren ohne Doppel', () => {
  const t = werkzeugBeispiel()
  const backup = { werkzeug: 'Mattenwechsel 2.4', erstellt: NOW, db: { touren: t.touren, standorte: t.standorte, kunden: t.kunden, gebiete: [] } }
  const a = toolDataFromFiles([{ name: 'Mattenwechsel_Backup_2026-11-06.json', json: backup }])
  assert.deepEqual([a.standorte.length, a.kunden.length, a.touren.length], [6, 4, 3])
  const newer = { ...t.touren[0], geaendert: '2026-12-01T00:00:00.000Z', bemerkung: 'neuer' }
  const b = toolDataFromFiles([
    { name: 'Standorte.json', json: t.standorte },
    { name: 'Kunden.json', json: { kunden: t.kunden } },
    { name: '2026-10-06_T-beispiel-a1.json', json: t.touren[0] },
    { name: 'kopie.json', json: newer },
    { name: '2026-10-20_T-beispiel-b2.json', json: t.touren[1] },
    { name: 'kaputt.json', json: null },
  ])
  assert.deepEqual([b.standorte.length, b.kunden.length, b.touren.length], [6, 4, 2])
  assert.equal(b.touren.find((x) => x.id === 'T-beispiel-a1').bemerkung, 'neuer', 'jüngere Fassung derselben Tour')
})
