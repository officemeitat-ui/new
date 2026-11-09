// Mattenwechsel P17: Mattenbestand und Wäscherei (core/matten-bestand.js) – Startbestand (Inventur je Typ), Buchungen
// (Wäscherei abholen und zurück mit Schwund/ausgeschieden, Zukauf, Ausscheiden, Korrektur, Storno), Wechsel aus den
// Touren ohne Doppel, Erstausstattung, beim Kunden aus den Liegeplätzen (ohne Kundeneigentum), „reicht der saubere
// Bestand?“, Hinweis bei der Freigabe, Kennzahlen, Rechte. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess } from '../src/core/access.js'
import { confirmPlacement, finishStop, markNotPossible, reopenStop, setQuantity, startTour } from '../src/core/matten-fahrt.js'
import {
  applySync,
  atCustomers,
  basesOf,
  belowMin,
  bestandRights,
  bookingMoves,
  bookingProblem,
  cancelBooking,
  cancelProblem,
  coverage,
  demandByDay,
  describe,
  emptyBestand,
  historyOf,
  isAfter,
  laundryMail,
  laundryMonths,
  levelOf,
  newBooking,
  nextSlipNo,
  ownShare,
  parseCount,
  pruneBookings,
  settingsProblem,
  stockRows,
  stockTotals,
  syncCount,
  tourBookings,
  tourShortage,
  tourSync,
  upgradeBestand,
} from '../src/core/matten-bestand.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'
import { dataRights, MODULE_DOCS } from '../src/storage/data-service.js'

const TODAY = '2026-11-09' // Montag
const grau = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const navy = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const ARTICLES = [
  { id: 'a-m1', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', matKind: 'Standard' },
  { id: 'a-m2', group: 'Matten', name: 'Schmutzfangmatte 60 × 90 cm navy', size: '60 × 90 cm', color: 'navy', matKind: 'Standard' },
  { id: 'a-x', group: 'Reinigung', name: 'Glasreinigung' },
]
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const objects = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id, i) => ({ id, name: `Objekt ${i + 1}`, address: `Beispielweg ${i + 1}, 5020 Salzburg` }))
const lp = (id, objectId, mats, extra = {}) => ({ id, name: `Liegeplatz ${id}`, objectId, customerId: hv.id, customer: hv, active: true, mats, intervalDays: 14, startDate: '2026-10-01', rule: 'rhythmus', createdAt: '2026-10-01T08:00:00.000Z', ...extra })
const placements = [
  lp('p1', 'o1', [{ ...grau, qty: 2, owner: 'wir' }]),
  lp('p2', 'o1', [{ ...navy, qty: 1, owner: 'wir' }]),
  lp('p3', 'o2', [{ ...grau, qty: 2, owner: 'kunde' }]), // Kundeneigentum: gewaschen, nicht gezählt
  lp('p4', 'o3', [{ ...grau, qty: 1, owner: 'wir' }, { ...grau, qty: 1, owner: 'kunde' }]), // gemischt
  lp('p5', 'o3', [{ ...grau, qty: 3, owner: 'wir' }], { active: false }),
  lp('p6', 'o4', [{ ...grau, qty: 2, owner: 'wir' }], { createdAt: '2026-11-04T08:00:00.000Z' }), // nach der Inventur angelegt
  lp('p7', 'o5', [{ ...grau, qty: 3, owner: 'wir' }]),
]
const at = (date, hm = '09:00') => ({ now: `${date}T${hm}:00.000Z`, by: 'Markus Huber' })
const job = (placementId, due, extra = {}) => ({ id: `${placementId}:${due}`, key: `${placementId}:${due}`, placementId, due, status: 'geplant', ...extra })
const tourOf = (id, date, status, list) => {
  const stops = stopsFromJobs({ jobs: list.map((j) => ({ ...j, status: 'geplant' })), placements, objects, date })
  return { schema: 1, id, date, driverId: 'e2', driverName: 'Markus Huber', status, order: stops.map((s) => s.id), stops }
}
let n = 0
const opts = (date, hm = '10:00') => ({ newId: () => `b${++n}`, now: `${date}T${hm}:00.000Z`, by: 'Petra Leitner' })
const inv = (date, lines, hm = '16:00') => newBooking('inventur', { date, lines }, opts(date, hm))

/** Inventur am 2.11. (grau 20/4/10, navy 5/0/2), Tour am 5.11. (Objekt 1 gewechselt, Kundenmatte in Objekt 2 auch). */
function fixture() {
  const doc = upgradeBestand(emptyBestand())
  doc.bookings.push(
    inv('2026-11-02', [
      { ...grau, sauber: 20, fahrzeug: 4, waesche: 10 },
      { ...navy, sauber: 5, fahrzeug: 0, waesche: 2 },
    ]),
  )
  let t1 = tourOf('mt000000000001', '2026-11-05', 'freigegeben', [job('p1', '2026-11-05'), job('p2', '2026-11-05'), job('p3', '2026-11-05')])
  t1 = confirmPlacement(t1, 'st-o1', 'p1', at('2026-11-05', '08:00'))
  t1 = confirmPlacement(t1, 'st-o1', 'p2', at('2026-11-05', '08:01'))
  t1 = finishStop(t1, 'st-o1', { reason: 'niemand vor Ort', ...at('2026-11-05', '08:05') })
  t1 = confirmPlacement(t1, 'st-o2', 'p3', at('2026-11-05', '08:30'))
  t1 = finishStop(t1, 'st-o2', { reason: 'niemand vor Ort', ...at('2026-11-05', '08:35') })
  return { doc, t1 }
}
const row = (rows, id) => rows.find((r) => r.articleId === id)

// ---------------------------------------------------------------- Datei

test('Datei matten/bestand.json: leerer Inhalt wie im DataService, upgrade ergänzt Listen', () => {
  assert.deepEqual(MODULE_DOCS.mattenBestand.empty(), emptyBestand())
  assert.equal(MODULE_DOCS.mattenBestand.path, 'matten/bestand.json')
  const d = upgradeBestand({ settings: { min: { 'a-m1': 5 } } })
  assert.deepEqual(d, { schema: 1, settings: { min: { 'a-m1': 5 } }, bookings: [] })
})

// ---------------------------------------------------------------- Liegeplätze

test('Beim Kunden: aktive Liegeplätze mit eigenen Matten, Kundeneigentum und inaktive zählen nicht', () => {
  const { byType, untyped } = atCustomers([...placements, lp('p9', 'o5', [{ qty: 2, owner: 'wir', legacy: { groesse: '60x90' } }])])
  assert.equal(byType.get('a-m1').wir, 2 + 1 + 2 + 3) // p1, p4 (eigene), p6, p7; p5 inaktiv
  assert.equal(byType.get('a-m1').kunde, 2 + 1)
  assert.equal(byType.get('a-m1').placements, 4)
  assert.equal(byType.get('a-m2').wir, 1)
  assert.equal(untyped, 2, 'Matten ohne Mattentyp getrennt')
  // eigener Anteil am Liegeplatz
  assert.equal(ownShare(placements[0], 'a-m1', 2), 2)
  assert.equal(ownShare(placements[2], 'a-m1', 2), 0, 'Kundeneigentum')
  assert.equal(ownShare(placements[3], 'a-m1', 2), 1, 'gemischt: höchstens die eigenen')
  assert.equal(ownShare(null, 'a-m1', 3), 3, 'unbekannter Liegeplatz: eigene')
})

// ---------------------------------------------------------------- Bestand aus Inventur und Buchungen

test('Bestand: Inventur, Tour, Wäscherei abholen und zurück mit Schwund und ausgeschieden', () => {
  const { doc, t1 } = fixture()
  doc.bookings.push(newBooking('abholung', { date: '2026-11-06', no: 'WL-2026-001', lines: [{ ...grau, qty: 6 }, { ...navy, qty: 1 }] }, opts('2026-11-06')))
  doc.bookings.push(newBooking('rueckgabe', { date: '2026-11-07', lines: [{ ...grau, qty: 8, lost: 1, retired: 1 }, { ...navy, qty: 2 }] }, opts('2026-11-07')))
  const rows = stockRows({ doc, placements, tours: [t1], articles: ARTICLES })
  assert.deepEqual(rows.map((r) => r.articleId), ['a-m2', 'a-m1'], 'Reihenfolge wie die Mattentypen der Fakturierung (nach Größe)')
  const g = row(rows, 'a-m1')
  assert.equal(g.name, '85 × 150 cm, grau')
  assert.deepEqual([g.sauber, g.kunde, g.fahrzeug, g.waesche, g.schwund, g.aus, g.gesamt], [26, 8, 0, 6, 1, 1, 40])
  assert.equal(g.eigentum, 3, 'Kundeneigentum nur zur Info')
  assert.equal(g.base.date, '2026-11-02')
  const v = row(rows, 'a-m2')
  assert.deepEqual([v.sauber, v.kunde, v.fahrzeug, v.waesche, v.schwund, v.aus, v.gesamt], [6, 1, 0, 1, 0, 0, 8])
  // Summe über die Typen
  const s = stockTotals(rows)
  assert.deepEqual([s.sauber, s.kunde, s.fahrzeug, s.waesche, s.gesamt], [32, 9, 0, 7, 48])
  // ohne gelesene Touren: nur die gespeicherten Buchungen (die Tour fehlt)
  const g0 = row(stockRows({ doc, placements, tours: null, articles: ARTICLES }), 'a-m1')
  assert.deepEqual([g0.sauber, g0.fahrzeug], [28, -2])
})

test('Bestand: ohne Fakturierung Typen aus der Kopie am Liegeplatz, ohne Inventur keine Zahlen außer beim Kunden', () => {
  const rows = stockRows({ doc: emptyBestand(), placements, articles: null })
  assert.deepEqual(rows.map((r) => [r.articleId, r.name]), [['a-m2', '60 × 90 cm, navy'], ['a-m1', '85 × 150 cm, grau']], 'nach Bezeichnung (Größe)')
  const g = row(rows, 'a-m1')
  assert.equal(g.base, null)
  assert.deepEqual([g.sauber, g.fahrzeug, g.waesche, g.gesamt, g.kunde], [null, null, null, null, 8])
  assert.equal(levelOf(g), 'grau')
  assert.deepEqual(stockTotals(rows).sauber, null)
})

test('Buchungen: Zukauf, Ausscheiden, Schwund, Korrektur und Storno', () => {
  const { doc } = fixture()
  const book = (kind, fields, date = '2026-11-03') => doc.bookings.push(newBooking(kind, { date, ...fields }, opts(date)))
  book('zukauf', { lines: [{ ...grau, qty: 10 }], note: 'Lieferant Muster' })
  book('ausscheiden', { from: 'sauber', note: 'Rand ausgefranst', lines: [{ ...grau, qty: 2 }] })
  book('schwund', { from: 'waesche', note: 'Wäscherei findet sie nicht', lines: [{ ...grau, qty: 1 }] })
  book('korrektur', { pool: 'fahrzeug', note: 'im Bus vergessen', lines: [{ ...grau, qty: -1 }] })
  let g = row(stockRows({ doc, placements, articles: ARTICLES }), 'a-m1')
  assert.deepEqual([g.sauber, g.fahrzeug, g.waesche, g.schwund, g.aus], [28, 3, 9, 1, 2])
  // Storno: zählt nicht mehr, bleibt im Verlauf
  const z = doc.bookings.find((b) => b.kind === 'zukauf')
  assert.equal(cancelProblem(z), '')
  doc.bookings[doc.bookings.indexOf(z)] = cancelBooking(z, { reason: 'doppelt erfasst', now: '2026-11-04T08:00:00.000Z', by: 'Petra Leitner' })
  g = row(stockRows({ doc, placements, articles: ARTICLES }), 'a-m1')
  assert.equal(g.sauber, 18)
  assert.equal(cancelProblem(doc.bookings.find((b) => b.id === z.id)), 'Schon storniert.')
  assert.equal(historyOf(doc.bookings).length, doc.bookings.length, 'stornierte bleiben im Verlauf')
  assert.match(cancelProblem({ kind: 'tour' }), /Tour/)
})

test('Inventur: zählt ab ihrem Zeitpunkt; derselbe Tag später erfasst zählt; eine neue Inventur setzt den Startbestand', () => {
  const doc = emptyBestand()
  doc.bookings.push(inv('2026-11-02', [{ ...grau, sauber: 20, fahrzeug: 0, waesche: 0 }], '10:00'))
  doc.bookings.push(newBooking('zukauf', { date: '2026-11-01', lines: [{ ...grau, qty: 5 }] }, opts('2026-11-09'))) // vor dem Stichtag: schon gezählt
  doc.bookings.push(newBooking('zukauf', { date: '2026-11-02', lines: [{ ...grau, qty: 3 }] }, opts('2026-11-02', '09:00'))) // vor der Inventur erfasst
  doc.bookings.push(newBooking('zukauf', { date: '2026-11-02', lines: [{ ...grau, qty: 4 }] }, opts('2026-11-02', '11:00'))) // danach
  assert.equal(row(stockRows({ doc, articles: ARTICLES }), 'a-m1').sauber, 24)
  // neue Inventur (nur grau) am 5.11.: ab dort zählt sie; navy behält seinen Startbestand
  doc.bookings.push(inv('2026-11-02', [{ ...navy, sauber: 3, fahrzeug: 0, waesche: 0 }], '12:00'))
  doc.bookings.push(inv('2026-11-05', [{ ...grau, sauber: 21, fahrzeug: 1, waesche: 0, before: { sauber: 24, fahrzeug: 0, waesche: 0 } }]))
  let rows = stockRows({ doc, articles: ARTICLES })
  assert.deepEqual([row(rows, 'a-m1').sauber, row(rows, 'a-m1').fahrzeug, row(rows, 'a-m1').base.date, row(rows, 'a-m2').sauber], [21, 1, '2026-11-05', 3])
  assert.deepEqual(basesOf(doc.bookings).get('a-m1').line.before, { sauber: 24, fahrzeug: 0, waesche: 0 }, 'Stand laut App beim Zählen bleibt sichtbar')
  // Inventur storniert: die vorige gilt wieder
  const last = doc.bookings.at(-1)
  doc.bookings[doc.bookings.length - 1] = cancelBooking(last, { reason: 'falsch gezählt' })
  rows = stockRows({ doc, articles: ARTICLES })
  assert.equal(row(rows, 'a-m1').sauber, 24)
  assert.ok(isAfter({ date: '2026-11-03', at: '' }, { date: '2026-11-02', at: '2026-11-02T23:00:00.000Z' }))
  assert.ok(!isAfter({ date: '2026-11-02', at: '2026-11-02T09:00:00.000Z' }, { date: '2026-11-02', at: '2026-11-02T10:00:00.000Z' }))
})

test('Bewegungen je Buchung (wie Material & Lager: Bestand nur aus Buchungen gerechnet)', () => {
  const mv = (b) => bookingMoves(b).map((m) => `${m.loc}${m.qty > 0 ? '+' : ''}${m.qty}`).join(' ')
  assert.equal(mv({ kind: 'abholung', lines: [{ articleId: 'a', qty: 3 }] }), 'fahrzeug-3 waesche+3')
  assert.equal(mv({ kind: 'rueckgabe', lines: [{ articleId: 'a', qty: 5, lost: 1, retired: 2 }] }), 'waesche-8 sauber+5 schwund+1 aus+2')
  assert.equal(mv({ kind: 'zukauf', lines: [{ articleId: 'a', qty: 4 }] }), 'sauber+4')
  assert.equal(mv({ kind: 'ausscheiden', from: 'fahrzeug', lines: [{ articleId: 'a', qty: 1 }] }), 'fahrzeug-1 aus+1')
  assert.equal(mv({ kind: 'schwund', lines: [{ articleId: 'a', qty: 1 }] }), 'sauber-1 schwund+1')
  assert.equal(mv({ kind: 'korrektur', pool: 'waesche', lines: [{ articleId: 'a', qty: -2 }] }), 'waesche-2')
  assert.equal(mv({ kind: 'tour', lines: [{ articleId: 'a', qty: 2, back: 2 }] }), 'sauber-2 fahrzeug+2')
  assert.equal(mv({ kind: 'tour', lines: [{ articleId: 'a', qty: 2, back: 0 }] }), 'sauber-2')
  assert.equal(mv({ kind: 'inventur', lines: [{ articleId: 'a', sauber: 9 }] }), '')
})

// ---------------------------------------------------------------- Touren

test('Touren: je Stopp eine Buchung, Zeilen tourId:stopId:placementId:articleId, ohne Kundeneigentum und Entwürfe', () => {
  const { doc, t1 } = fixture()
  const draft = tourOf('mt000000000009', '2026-11-05', 'entwurf', [job('p7', '2026-11-05')])
  const list = tourBookings({ tours: [t1, draft], placements, bases: basesOf(doc.bookings) })
  assert.equal(list.length, 1, 'Stopp mit nur Kundeneigentum ergibt keine Buchung, Entwurf nichts')
  const b = list[0]
  assert.equal(b.id, 'tour:mt000000000001:st-o1')
  assert.deepEqual([b.kind, b.date, b.at, b.tourId, b.stopId, b.by], ['tour', '2026-11-05', '2026-11-05T08:05:00.000Z', 'mt000000000001', 'st-o1', 'Markus Huber'])
  assert.deepEqual(b.lines, [
    { id: 'mt000000000001:st-o1:p1:a-m1', articleId: 'a-m1', name: '85 × 150 cm, grau', qty: 2, back: 2 },
    { id: 'mt000000000001:st-o1:p2:a-m2', articleId: 'a-m2', name: '60 × 90 cm, navy', qty: 1, back: 1 },
  ])
  assert.match(describe(b), /^Tour: 2 × 85 × 150 cm, grau; 1 × 60 × 90 cm, navy$/)
})

test('Touren: Ist-Menge statt Soll, nicht möglich zählt nicht, gemischter Liegeplatz nur die eigenen, offene Stopps nicht', () => {
  let t = tourOf('mt000000000002', '2026-11-06', 'freigegeben', [job('p1', '2026-11-06'), job('p2', '2026-11-06'), job('p4', '2026-11-06'), job('p7', '2026-11-06')])
  t = startTour(t, at('2026-11-06', '06:30'))
  const i = t.stops.find((s) => s.id === 'st-o1').items.findIndex((it) => it.placementId === 'p1')
  t = setQuantity(t, 'st-o1', i, 1, at('2026-11-06', '07:00'))
  t = confirmPlacement(t, 'st-o1', 'p1', at('2026-11-06', '07:01'))
  t = markNotPossible(t, 'st-o1', 'p2', 'kein Zugang', at('2026-11-06', '07:02'))
  t = finishStop(t, 'st-o1', { reason: 'niemand vor Ort', ...at('2026-11-06', '07:05') })
  t = confirmPlacement(t, 'st-o3', 'p4', at('2026-11-06', '08:00'))
  t = finishStop(t, 'st-o3', { reason: 'niemand vor Ort', ...at('2026-11-06', '08:05') })
  // st-o5 (p7) noch offen
  const list = tourBookings({ tours: [t], placements, bases: new Map() })
  assert.deepEqual(list.map((b) => [b.stopId, b.lines.map((l) => [l.articleId, l.qty])]), [
    ['st-o1', [['a-m1', 1]]],
    ['st-o3', [['a-m1', 1]]],
  ])
})

test('Touren: kein doppeltes Verbuchen – zweiter Abgleich ändert nichts, Korrektur im Büro ändert die Zeile', () => {
  const { doc, t1 } = fixture()
  const s1 = tourSync({ bookings: doc.bookings, tours: [t1], placements })
  assert.deepEqual([s1.add.length, s1.update.length, s1.remove.length], [1, 0, 0])
  doc.bookings = applySync(doc.bookings, s1)
  const s2 = tourSync({ bookings: doc.bookings, tours: [t1], placements })
  assert.equal(syncCount(s2), 0, 'zweites Lesen verbucht nichts doppelt')
  // gleiche Tour zweimal gelesen (zwei Geräte): eine Buchung
  assert.equal(syncCount(tourSync({ bookings: doc.bookings, tours: [t1, structuredClone(t1)], placements })), 0)
  assert.equal(row(stockRows({ doc, placements, tours: [t1, t1], articles: ARTICLES }), 'a-m1').sauber, 18)
  // Büro öffnet den Stopp wieder: solange offen, zählt der Wechsel nicht
  let t = reopenStop(t1, 'st-o1', { reason: 'Menge falsch', now: '2026-11-06T09:00:00.000Z', by: 'Petra Leitner' })
  const s3 = tourSync({ bookings: doc.bookings, tours: [t], placements })
  assert.deepEqual(s3.remove, ['tour:mt000000000001:st-o1'])
  assert.equal(row(stockRows({ doc, placements, tours: [t], articles: ARTICLES }), 'a-m1').sauber, 20)
  // … und mit 1 statt 2 neu abgeschlossen: dieselbe Buchung, neue Menge
  const i = t.stops.find((s) => s.id === 'st-o1').items.findIndex((it) => it.placementId === 'p1')
  t = setQuantity(t, 'st-o1', i, 1, at('2026-11-06', '09:05'))
  t = finishStop(t, 'st-o1', { reason: 'niemand vor Ort', ...at('2026-11-06', '09:10') })
  const s4 = tourSync({ bookings: doc.bookings, tours: [t], placements })
  assert.deepEqual([s4.add.length, s4.update.length, s4.remove.length], [0, 1, 0])
  assert.equal(s4.update[0].id, 'tour:mt000000000001:st-o1')
  assert.deepEqual(s4.update[0].lines.map((l) => [l.articleId, l.qty, l.back]), [['a-m1', 1, 1], ['a-m2', 1, 1]])
  doc.bookings = applySync(doc.bookings, s4)
  assert.equal(syncCount(tourSync({ bookings: doc.bookings, tours: [t], placements })), 0)
  // Tour nicht gelesen: gespeicherte Buchung bleibt
  assert.equal(syncCount(tourSync({ bookings: doc.bookings, tours: [], placements })), 0)
})

test('Touren: vor der Inventur zählt nicht, ohne Inventur des Typs wird nichts gespeichert', () => {
  const { doc } = fixture()
  let t0 = tourOf('mt000000000003', '2026-11-01', 'freigegeben', [job('p1', '2026-11-01')])
  t0 = confirmPlacement(t0, 'st-o1', 'p1', at('2026-11-01', '08:00'))
  t0 = finishStop(t0, 'st-o1', { reason: 'niemand vor Ort', ...at('2026-11-01', '08:05') })
  assert.equal(syncCount(tourSync({ bookings: doc.bookings, tours: [t0], placements })), 0)
  assert.equal(row(stockRows({ doc, placements, tours: [t0], articles: ARTICLES }), 'a-m1').sauber, 20)
  assert.equal(syncCount(tourSync({ bookings: [], tours: [t0], placements })), 0, 'ohne Inventur nichts')
})

test('Touren: Erstausstattung eines nach der Inventur angelegten Liegeplatzes bringt keine schmutzige zurück', () => {
  const { doc } = fixture()
  let a = tourOf('mt000000000004', '2026-11-06', 'freigegeben', [job('p6', '2026-11-06')])
  a = confirmPlacement(a, 'st-o4', 'p6', at('2026-11-06', '08:00'))
  a = finishStop(a, 'st-o4', { reason: 'niemand vor Ort', ...at('2026-11-06', '08:05') })
  let b = tourOf('mt000000000005', '2026-11-08', 'freigegeben', [job('p6', '2026-11-08')])
  b = confirmPlacement(b, 'st-o4', 'p6', at('2026-11-08', '08:00'))
  b = finishStop(b, 'st-o4', { reason: 'niemand vor Ort', ...at('2026-11-08', '08:05') })
  const list = tourBookings({ tours: [b, a], placements, bases: basesOf(doc.bookings) })
  assert.deepEqual(list.map((x) => [x.date, x.lines[0].qty, x.lines[0].back]), [['2026-11-06', 2, 0], ['2026-11-08', 2, 2]])
  const g = row(stockRows({ doc, placements, tours: [a, b], articles: ARTICLES }), 'a-m1')
  // Lager 20 − 2 − 2, Fahrzeug 4 + 2; beim Kunden mit p6 (angelegt nach der Inventur) – gesamt wieder wie gezählt
  assert.deepEqual([g.sauber, g.fahrzeug, g.gesamt], [16, 6, 16 + 8 + 6 + 10])
  // aus dem Werkzeug übernommen (letzter Wechsel bekannt): keine Erstausstattung
  const old = placements.map((p) => (p.id === 'p6' ? { ...p, lastExchange: { date: '2026-10-20' } } : p))
  assert.equal(tourBookings({ tours: [a], placements: old, bases: basesOf(doc.bookings) })[0].lines[0].back, 2)
})

test('Datei klein halten: alte Tour-Buchungen vor einer späteren Inventur fallen weg', () => {
  const doc = emptyBestand()
  doc.bookings.push(inv('2025-06-01', [{ ...grau, sauber: 10, fahrzeug: 0, waesche: 0 }]))
  const tb = (date) => ({ id: `tour:x:${date}`, kind: 'tour', date, at: `${date}T08:00:00.000Z`, lines: [{ id: `x:${date}:p1:a-m1`, articleId: 'a-m1', qty: 1, back: 1 }] })
  doc.bookings.push(tb('2025-07-01'), tb('2026-10-01'))
  assert.equal(pruneBookings(doc.bookings, TODAY).length, 3, 'ohne spätere Inventur bleibt alles')
  doc.bookings.push(inv('2026-01-10', [{ ...grau, sauber: 8, fahrzeug: 1, waesche: 0 }]))
  const kept = pruneBookings(doc.bookings, TODAY)
  assert.deepEqual(kept.filter((b) => b.kind === 'tour').map((b) => b.date), ['2026-10-01'])
  assert.equal(row(stockRows({ doc: { ...doc, bookings: kept }, articles: ARTICLES }), 'a-m1').sauber, row(stockRows({ doc, articles: ARTICLES }), 'a-m1').sauber)
})

// ---------------------------------------------------------------- Reicht der saubere Bestand?

/** Bestand grau 7, navy 1; Touren heute (unterwegs, ein Stopp offen), morgen (Entwurf), übermorgen (freigegeben). */
function coverFixture() {
  const rows = [
    { articleId: 'a-m2', name: '60 × 90 cm, navy', base: { date: '2026-11-02' }, sauber: 1, min: 0 },
    { articleId: 'a-m1', name: '85 × 150 cm, grau', base: { date: '2026-11-02' }, sauber: 7, min: 0 },
  ]
  let u = tourOf('mt000000000010', TODAY, 'freigegeben', [job('p1', TODAY), job('p2', TODAY), job('p4', TODAY)])
  u = startTour(u, at(TODAY, '06:00'))
  u = confirmPlacement(u, 'st-o1', 'p1', at(TODAY, '07:00'))
  u = confirmPlacement(u, 'st-o1', 'p2', at(TODAY, '07:01'))
  u = finishStop(u, 'st-o1', { reason: 'niemand vor Ort', ...at(TODAY, '07:05') })
  const d = tourOf('mt000000000011', '2026-11-10', 'entwurf', [job('p1', '2026-11-10'), job('p2', '2026-11-10')])
  const r = tourOf('mt000000000012', '2026-11-11', 'freigegeben', [job('p6', '2026-11-11')])
  const old = tourOf('mt000000000013', '2026-11-05', 'entwurf', [job('p3', '2026-11-05')]) // Entwurf von früher: zählt nicht
  const jobs = [
    job('p7', '2026-11-03'), // überfällig, ohne Tour → heute
    job('p6', '2026-11-11', { status: 'in-tour', tourId: r.id }),
    job('p2', '2026-11-12'), // ohne Tour
    job('p5', TODAY), // inaktiv
    job('p1', '2026-11-20'), // nach der Vorschau
  ]
  return { rows, tours: [u, d, r, old], jobs }
}

test('Bedarf je Tag: Ladelisten der Touren (unterwegs nur offene Stopps), fällige Einsätze ohne Tour, nur eigene Matten', () => {
  const { tours, jobs } = coverFixture()
  const need = demandByDay({ tours, jobs, placements, today: TODAY, days: 7 })
  const day = (d) => Object.fromEntries(need.get(d) || [])
  assert.deepEqual(day(TODAY), { 'a-m1': 1 + 3 }, 'offener Stopp (p4: eine eigene von zwei) und der überfällige Einsatz')
  assert.deepEqual(day('2026-11-10'), { 'a-m1': 2, 'a-m2': 1 })
  assert.deepEqual(day('2026-11-11'), { 'a-m1': 2 })
  assert.deepEqual(day('2026-11-12'), { 'a-m2': 1 })
  assert.equal(need.has('2026-11-20'), false)
})

test('Reicht der saubere Bestand? Erster Tag mit Fehlbestand, „reicht bis“, Typen ohne Inventur', () => {
  const { rows, tours, jobs } = coverFixture()
  const cov = coverage({ rows, tours, jobs, placements: [...placements, lp('p8', 'o5', [{ articleId: 'a-m3', name: '115 × 200 cm, grau', qty: 1, owner: 'wir' }])], today: TODAY, days: 7 })
  assert.equal(cov.to, '2026-11-15')
  assert.deepEqual(cov.short, { date: '2026-11-11', items: [{ articleId: 'a-m1', name: '85 × 150 cm, grau', stock: 7, need: 8, missing: 1 }] })
  assert.equal(cov.until, '2026-11-10')
  assert.deepEqual(cov.types.map((t) => [t.articleId, t.need, t.left, t.short?.date || '']), [['a-m2', 2, -1, '2026-11-12'], ['a-m1', 8, -1, '2026-11-11']])
  assert.deepEqual(cov.unknown, [], 'p8 ist nicht fällig')
  const withJob = coverage({ rows, tours, jobs: [...jobs, job('p8', TODAY)], placements: [...placements, lp('p8', 'o5', [{ articleId: 'a-m3', name: '115 × 200 cm, grau', qty: 1, owner: 'wir' }])], today: TODAY, days: 7 })
  assert.deepEqual(withJob.unknown, [{ articleId: 'a-m3', name: '115 × 200 cm, grau', need: 1 }])
  // genug Bestand: reicht über den ganzen Zeitraum
  const big = coverage({ rows: rows.map((r) => ({ ...r, sauber: 50 })), tours, jobs, placements, today: TODAY, days: 7 })
  assert.equal(big.short, null)
  assert.equal(big.until, '2026-11-15')
  // schon heute zu wenig
  const none = coverage({ rows: rows.map((r) => ({ ...r, sauber: 0 })), tours, jobs, placements, today: TODAY, days: 7 })
  assert.equal(none.short.date, TODAY)
  assert.equal(none.until, '')
  // Ampel
  assert.equal(levelOf(rows[1], cov), 'rot')
  assert.equal(levelOf({ ...rows[1], sauber: 50, min: 60 }, big), 'gelb')
  assert.equal(levelOf({ ...rows[1], sauber: 50, min: 10 }, big), 'gruen')
  assert.deepEqual(belowMin([{ ...rows[1], sauber: 5, min: 6 }, { ...rows[0], min: 0 }]), [{ articleId: 'a-m1', name: '85 × 150 cm, grau', sauber: 5, min: 6 }])
})

test('Hinweis bei der Freigabe: Ladeliste bis zum Tag der Tour übersteigt den sauberen Bestand', () => {
  const { rows, tours, jobs } = coverFixture()
  const r = tours.find((t) => t.id === 'mt000000000012')
  const hint = tourShortage({ tour: r, rows, tours, jobs, placements, today: TODAY })
  assert.deepEqual(hint, { date: '2026-11-11', items: [{ articleId: 'a-m1', name: '85 × 150 cm, grau', stock: 7, need: 8, missing: 1, date: '2026-11-11' }] })
  const d = tours.find((t) => t.id === 'mt000000000011')
  assert.equal(tourShortage({ tour: d, rows, tours, jobs, placements, today: TODAY }), null, 'bis morgen reicht es')
  assert.equal(tourShortage({ tour: { ...d, date: '2026-11-01' }, rows, tours, jobs, placements, today: TODAY }), null, 'vergangene Tage nicht')
})

// ---------------------------------------------------------------- Anlegen und prüfen

test('Buchung anlegen und prüfen: ganze Stückzahlen, Grund bei Ausscheiden/Schwund/Korrektur, nicht in der Zukunft', () => {
  const o = opts(TODAY)
  assert.deepEqual([parseCount(''), parseCount(' 12 '), parseCount('-3', { signed: true }), parseCount('−3', { signed: true })], [null, 12, -3, -3])
  assert.ok(Number.isNaN(parseCount('1,5')) && Number.isNaN(parseCount('-3')) && Number.isNaN(parseCount('x')))
  const a = newBooking('abholung', { date: TODAY, no: 'WL-2026-004', note: '', lines: [{ ...grau, qty: 5 }, { ...navy, qty: 0 }] }, o)
  assert.deepEqual(a.lines, [{ articleId: 'a-m1', name: '85 × 150 cm, grau', qty: 5 }], 'Zeilen ohne Menge fallen weg')
  assert.deepEqual([a.kind, a.no, a.by, a.date], ['abholung', 'WL-2026-004', 'Petra Leitner', TODAY])
  assert.equal(bookingProblem(a, { today: TODAY }), '')
  assert.match(bookingProblem({ ...a, date: '2026-11-10' }, { today: TODAY }), /Zukunft/)
  assert.match(bookingProblem({ ...a, lines: [] }, { today: TODAY }), /Menge/)
  assert.match(bookingProblem(newBooking('ausscheiden', { date: TODAY, lines: [{ ...grau, qty: 1 }] }, o), { today: TODAY }), /Grund/)
  assert.match(bookingProblem(newBooking('korrektur', { date: TODAY, pool: 'waesche', lines: [{ ...grau, qty: -2 }] }, o), { today: TODAY }), /Grund der Korrektur/)
  const k = newBooking('korrektur', { date: TODAY, pool: 'waesche', note: 'falsch gezählt', lines: [{ ...grau, qty: -2 }] }, o)
  assert.deepEqual([bookingProblem(k, { today: TODAY }), k.pool, k.lines[0].qty], ['', 'waesche', -2])
  const r = newBooking('rueckgabe', { date: TODAY, lines: [{ ...grau, qty: 0, lost: 2, retired: 0 }] }, o)
  assert.deepEqual(r.lines[0], { articleId: 'a-m1', name: '85 × 150 cm, grau', qty: 0, lost: 2, retired: 0 })
  const i = newBooking('inventur', { date: TODAY, lines: [{ ...grau, sauber: 0, fahrzeug: 0, waesche: 0 }] }, o)
  assert.equal(bookingProblem(i, { today: TODAY }), '', 'gezählte Null ist eine Inventur')
  assert.match(bookingProblem(newBooking('inventur', { date: TODAY, lines: [] }, o), { today: TODAY }), /gezählten Mengen/)
  assert.match(bookingProblem({ kind: 'tour', date: TODAY, lines: [] }), /Unbekannt/)
  assert.equal(newBooking('schwund', { date: TODAY, from: 'irgendwo', note: 'x', lines: [{ ...grau, qty: 1 }] }, o).from, 'sauber')
  assert.equal(nextSlipNo([{ no: 'WL-2026-001' }, { no: 'WL-2026-007' }, { no: 'WL-2025-099' }], '2026'), 'WL-2026-008')
  assert.equal(nextSlipNo([], '2027'), 'WL-2027-001')
  assert.equal(settingsProblem({ laundry: { email: 'waesche@beispiel' } }), '„waesche@beispiel“ ist keine gültige E-Mail-Adresse.')
  assert.equal(settingsProblem({ laundry: { email: 'annahme@waescherei-beispiel.example' }, min: { 'a-m1': 10 }, days: 7 }), '')
  assert.match(settingsProblem({ min: { 'a-m1': -1 } }), /Mindestbestand/)
})

test('Wäscherei-Lieferschein: E-Mail mit Mengen je Typ, ohne Preise', () => {
  const b = newBooking('abholung', { date: TODAY, no: 'WL-2026-002', lines: [{ ...grau, qty: 12 }, { ...navy, qty: 3 }] }, opts(TODAY))
  const m = laundryMail({ booking: b, laundry: { name: 'Wäscherei Beispiel', contact: 'Frau Muster' }, sender: 'Petra Leitner', company: 'Cleanos', formatDate: (d) => d.split('-').reverse().join('.') })
  assert.equal(m.subject, 'Lieferschein WL-2026-002 – 15 Matten zur Wäsche')
  assert.match(m.text, /^Guten Tag Frau Muster,/)
  assert.match(m.text, /- 12 × 85 × 150 cm, grau\n- 3 × 60 × 90 cm, navy/)
  assert.match(m.text, /09\.11\.2026/)
  assert.ok(!/€|Preis/.test(m.text))
})

// ---------------------------------------------------------------- Kennzahlen und Rechte

test('Kennzahlen: Wäschereimengen und Schwundquote je Monat (stornierte zählen nicht)', () => {
  const months = [{ key: '2026-10', from: '2026-10-01', to: '2026-10-31' }, { key: '2026-11', from: '2026-11-01', to: '2026-11-30' }]
  const o = opts(TODAY)
  const list = [
    newBooking('abholung', { date: '2026-10-20', lines: [{ ...grau, qty: 20 }] }, o),
    newBooking('rueckgabe', { date: '2026-11-03', lines: [{ ...grau, qty: 16, lost: 2, retired: 2 }] }, o),
    newBooking('schwund', { date: '2026-11-04', note: 'beim Kunden weg', lines: [{ ...navy, qty: 1 }] }, o),
    cancelBooking(newBooking('abholung', { date: '2026-11-05', lines: [{ ...grau, qty: 9 }] }, o), { reason: 'doppelt' }),
  ]
  const [okt, nov] = laundryMonths(list, months)
  assert.deepEqual(okt, { key: '2026-10', abgeholt: 20, zurueck: 0, schwund: 0, aus: 0, rate: null })
  assert.deepEqual({ ...nov, rate: Math.round(nov.rate * 1000) / 1000 }, { key: '2026-11', abgeholt: 0, zurueck: 16, schwund: 3, aus: 2, rate: Math.round((3 / 21) * 1000) / 1000 })
})

test('Rechte: Büro bearbeitet den Bestand, Fahrer, Lager und Buchhaltung sehen ihn nicht', () => {
  const role = (id) => resolveAccess({ roleClaims: [id], strict: true, access: {} })
  const FILE = MODULE_DOCS.mattenBestand.path
  const buero = role('mattenwechsel')
  assert.deepEqual(bestandRights(buero), { view: true, edit: true })
  assert.ok(dataRights(buero).read(FILE) && dataRights(buero).write(FILE))
  for (const id of ['mattenfahrer', 'lager', 'buchhaltung', 'objektleitung']) {
    assert.deepEqual(bestandRights(role(id)), { view: false, edit: false }, id)
    assert.ok(!dataRights(role(id)).read(FILE) && !dataRights(role(id)).write(FILE), id)
  }
  assert.deepEqual(bestandRights(null), { view: true, edit: true }, 'Browser-Modus')
  const lesen = resolveAccess({ roleClaims: ['mwlesen'], strict: true, access: { roles: { mwlesen: { label: 'Matten lesen', modules: ['matten'], edit: [] } } } })
  assert.deepEqual(bestandRights(lesen), { view: true, edit: false })
  assert.ok(dataRights(lesen).read(FILE) && !dataRights(lesen).write(FILE))
})
