// Mattenwechsel: Fahrt am Handy und Abschluss je Stopp (core/matten-fahrt.js, P10/P11) und das Lesen/Schreiben der
// Tour-Dateien mit eTag, Gerätespeicher und Zusammenführen je Stopp (storage/matten-touren.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addPlacementPhoto,
  canMoveStop,
  changeQuantity,
  confirmPlacement,
  derivedStopStatus,
  doneFromTours,
  driverProblem,
  employeeIdsFor,
  finishProblem,
  finishStop,
  isMyTour,
  jobUpdatesFromTour,
  localDate,
  markNotPossible,
  markPhotosUploaded,
  mergeTour,
  nextOpenStop,
  nextPhotoNumber,
  orderedStops,
  photoPath,
  placementsOf,
  reopenProblem,
  reopenStop,
  resetPlacement,
  setPlacementNote,
  setQuantity,
  setStopStatus,
  shownQuantity,
  startTour,
  stopDeviations,
  suggestedOutcome,
  tourProgress,
  toursFor,
} from '../src/core/matten-fahrt.js'
import { assignDriver, loadList, stopsFromJobs } from '../src/core/matten-tour.js'
import { jobsFor, lastDone, markDone } from '../src/core/matten-plan.js'
import { navigationUrl } from '../src/core/routing.js'
import { createMattenTourDemo } from '../src/data/demo-matten.js'
import { isTourPath, TourStore, tourYears } from '../src/storage/matten-touren.js'
import { ConflictError } from '../src/storage/docstore-local.js'
import { memoryCache, OfflineError } from '../src/storage/offline.js'

const DAY = '2026-11-09'
const T = (h, m = 0) => `${DAY}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z` // Wien = UTC+1
const SIG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5"/></svg>'

const gross = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const klein = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg', lat: 47.79, lon: 13.005 },
  { id: 'o3', name: 'Büro Nord', address: 'Nordweg 4, 5020 Salzburg', lat: 47.823, lon: 13.03 },
]
const lp = (id, objectId, customer, mats, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats, intervalDays: 14, startDate: '2026-10-26', rule: 'rhythmus', ...extra })
const placements = [
  lp('Haupteingang', 'o1', hv, [{ ...gross, qty: 2 }], { floor: 'EG', access: 'Schlüssel beim Hausbesorger' }),
  lp('Stiege 2', 'o1', hv, [{ ...klein, qty: 1 }]),
  lp('Tiefgarage', 'o1', hv, [{ ...gross, qty: 1 }, { ...klein, qty: 2 }]),
  lp('Schauraum', 'o2', ah, [{ ...gross, qty: 3 }]),
  lp('Foyer', 'o3', hv, [{ ...klein, qty: 1 }]),
]
const job = (placementId, due, extra = {}) => ({ key: `${placementId}:${due}`, placementId, due, status: 'geplant', ...extra })
const jobs = [job('Haupteingang', DAY), job('Stiege 2', DAY), job('Tiefgarage', '2026-10-26', { status: 'nachzuholen', planned: '2026-11-02' }), job('Tiefgarage', DAY), job('Schauraum', DAY), job('Foyer', DAY)]

/** Freigegebene Tour mit drei Stopps (o1: 3 Liegeplätze, o2, o3) für Fahrer e2. */
function tour(extra = {}) {
  const stops = stopsFromJobs({ jobs, placements, objects, date: DAY })
  const order = ['st-o1', 'st-o2', 'st-o3']
  return { schema: 1, id: 'mtaaaaaaaaaaaa', date: DAY, driverId: 'e2', driverName: 'Markus Huber', driverEmail: 'markus.huber@beispiel.example', status: 'freigegeben', order, stops: order.map((id) => stops.find((s) => s.id === id)), createdAt: T(6), updatedAt: T(6), updatedBy: 'Büro', ...extra }
}
const by = 'Markus Huber'
const at = (h, m) => ({ now: T(h, m), by })

// ---------------------------------------------------------------- Wer fährt, welche Touren

test('Meine Touren: Zuordnung über die E-Mail an der Tour bzw. die Mitarbeitenden-ID aus den Stammdaten', () => {
  const t = tour()
  assert.ok(isMyTour(t, { email: 'Markus.Huber@Beispiel.example' }), 'E-Mail ohne Groß/Klein')
  assert.ok(!isMyTour(t, { email: 'dragan@beispiel.example' }))
  const employees = [{ id: 'e2', name: 'Markus Huber', email: 'mh@firma.example' }, { id: 'e4', email: 'dragan@beispiel.example' }]
  assert.deepEqual(employeeIdsFor(employees, 'MH@firma.example'), ['e2'])
  assert.ok(isMyTour({ ...t, driverEmail: '' }, { email: 'mh@firma.example', employeeIds: employeeIdsFor(employees, 'mh@firma.example') }))
  assert.ok(!isMyTour({ ...t, driverId: '', driverEmail: '' }, { email: '' }))
  assert.equal(driverProblem(t), '')
  assert.match(driverProblem({ ...t, driverEmail: '' }), /keine E-Mail/)
  assert.match(driverProblem({ ...t, driverId: '' }), /Kein Fahrer/)
  // Fahrer zuweisen kopiert die E-Mail an die Tour
  assert.equal(assignDriver(t, { id: 'e4', name: 'Dragan', email: ' Dragan@Beispiel.example ' }).driverEmail, 'dragan@beispiel.example')
  assert.equal(assignDriver(t, { id: 'e5', name: 'Ohne Mail' }).driverEmail, undefined)
})

test('Meine Touren: Fahrer sieht eigene freigegebene/unterwegs (heute bis 7 Tage), vergangene offene oben; Büro alle', () => {
  const mine = (id, date, status, extra = {}) => ({ ...tour({ id, date, status }), ...extra })
  const list = [
    mine('t-heute', DAY, 'freigegeben'),
    mine('t-morgen', '2026-11-10', 'unterwegs'),
    mine('t-alt-offen', '2026-11-05', 'unterwegs'),
    mine('t-alt-fertig', '2026-11-05', 'abgeschlossen'),
    mine('t-heute-fertig', DAY, 'abgeschlossen'),
    mine('t-entwurf', DAY, 'entwurf'),
    mine('t-weit', '2026-11-30', 'freigegeben'),
    mine('t-fremd', DAY, 'freigegeben', { driverId: 'e4', driverName: 'Dragan', driverEmail: 'dragan@beispiel.example' }),
  ]
  const me = { email: 'markus.huber@beispiel.example', today: DAY }
  const ids = (xs) => xs.map((x) => x.tour.id)
  const driver = toursFor(list, me)
  assert.deepEqual(ids(driver), ['t-alt-offen', 't-heute', 't-morgen', 't-heute-fertig'])
  assert.ok(driver[0].past && !driver[1].past && driver[3].finished)
  const office = toursFor(list, { office: true, today: DAY })
  assert.deepEqual(ids(office), ['t-alt-offen', 't-fremd', 't-heute', 't-morgen', 't-alt-fertig', 't-heute-fertig'], 'Büro: alle außer Entwurf und weit voraus (je Tag nach Fahrer)')
  assert.equal(toursFor(list, { all: true, today: DAY }).length, 5, 'Browser-Modus: ohne Fahrer-Filter')
  assert.deepEqual(toursFor(list, { today: 'gestern' }), [])
})

// ---------------------------------------------------------------- Tour starten, Navigation, Ladeliste

test('Tourenübersicht: Reihenfolge, Fortschritt, Ladeliste je Größe, Tour starten, Navigation zum nächsten offenen Stopp', () => {
  let t = tour()
  assert.deepEqual(orderedStops({ ...t, order: ['st-o3', 'st-o1'] }).map((s) => s.id), ['st-o3', 'st-o1', 'st-o2'], 'nicht in order: hinten')
  assert.deepEqual(tourProgress(t), { stops: 3, done: 0, open: 3, next: t.stops[0], planned: 10, actual: 0, finished: false })
  assert.deepEqual(loadList(t).map((r) => [r.size, r.qty]), [['60 × 90 cm', 4], ['85 × 150 cm', 6]])
  assert.throws(() => startTour({ ...t, status: 'entwurf' }), /noch nicht freigegeben/)
  t = startTour(t, at(7))
  assert.equal(t.status, 'unterwegs')
  assert.equal(t.startedAt, T(7))
  assert.equal(t.startedBy, by)
  assert.equal(startTour(t, at(8)), t, 'zweimal starten ändert nichts')
  const next = nextOpenStop(t)
  assert.equal(navigationUrl(next), 'https://www.google.com/maps/dir/?api=1&destination=47.8095,13.055')
  // Navigation gestartet: Stopp unterwegs
  t = setStopStatus(t, 'st-o1', 'unterwegs', at(7, 5))
  assert.equal(t.stops[0].status, 'unterwegs')
  assert.equal(t.stops[0].updatedAt, T(7, 5))
  assert.ok(canMoveStop('geplant', 'unterwegs') && !canMoveStop('abgeschlossen', 'unterwegs'))
  assert.throws(() => setStopStatus(t, 'st-o1', 'abgeschlossen', at(7)), /finishStop/)
})

// ---------------------------------------------------------------- Liegeplätze bestätigen

test('Stopp: je Liegeplatz „Gewechselt“ (Soll vorbelegt), Plus/Minus mit Abweichung, „Nicht möglich“ mit Grund, Status abgeleitet', () => {
  let t = startTour(tour(), at(7))
  const s0 = () => t.stops[0]
  const pl = placementsOf(s0())
  assert.deepEqual(pl.map((p) => [p.placementName, p.planned, p.items.length, p.status]), [['Haupteingang', 2, 1, 'geplant'], ['Stiege 2', 1, 1, 'geplant'], ['Tiefgarage', 3, 2, 'geplant']])
  assert.equal(pl[0].floor, 'EG')
  assert.equal(pl[0].access, 'Schlüssel beim Hausbesorger')
  // Gewechselt: Soll übernommen, Status in Bearbeitung
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', at(7, 20))
  assert.equal(s0().status, 'in-bearbeitung')
  assert.deepEqual([s0().items[0].status, s0().items[0].actual, s0().items[0].time], ['gewechselt', 2, T(7, 20)])
  // Plus/Minus nach dem Bestätigen: Abweichung markiert
  t = changeQuantity(t, 'st-o1', 0, -1, at(7, 21))
  assert.equal(s0().items[0].actual, 1)
  assert.equal(placementsOf(s0())[0].deviation, -1)
  assert.equal(s0().items[0].time, T(7, 20), 'Zeit des Wechsels bleibt')
  t = changeQuantity(t, 'st-o1', 0, -5, at(7, 21))
  assert.equal(s0().items[0].actual, 0, 'nie unter 0')
  t = setQuantity(t, 'st-o1', 0, 3, at(7, 22))
  assert.equal(placementsOf(s0())[0].deviation, 1)
  // Plus/Minus vor dem Bestätigen: nur vorbelegt, gilt mit „Gewechselt“
  const ti = s0().items.findIndex((it) => it.placementId === 'Tiefgarage' && it.mat.articleId === 'a-m2')
  t = changeQuantity(t, 'st-o1', ti, +1, at(7, 23))
  assert.equal(s0().items[ti].status, 'geplant')
  assert.equal(shownQuantity(s0().items[ti]), 3)
  t = confirmPlacement(t, 'st-o1', 'Tiefgarage', at(7, 24))
  assert.deepEqual(placementsOf(s0())[2].items.map((it) => [it.status, it.actual]), [['gewechselt', 1], ['gewechselt', 3]])
  // Nicht möglich: Grund Pflicht, Ist 0
  assert.throws(() => markNotPossible(t, 'st-o1', 'Stiege 2', ' ', at(7, 25)), /Grund/)
  t = markNotPossible(t, 'st-o1', 'Stiege 2', 'kein Zugang', at(7, 25))
  assert.deepEqual(placementsOf(s0())[1], { ...placementsOf(s0())[1], status: 'nicht-moeglich', reason: 'kein Zugang', actual: 0, deviation: -1 })
  assert.equal(derivedStopStatus(s0()), 'teilweise')
  assert.equal(suggestedOutcome(s0()), 'teilweise')
  // zurücksetzen und wieder gewechselt
  t = resetPlacement(t, 'st-o1', 'Stiege 2', at(7, 26))
  assert.equal(placementsOf(s0())[1].status, 'geplant')
  assert.equal(derivedStopStatus(s0()), 'in-bearbeitung')
  t = markNotPossible(t, 'st-o1', 'Stiege 2', 'kein Zugang', at(7, 27))
  // Abweichungen je Matte
  assert.deepEqual(stopDeviations(s0()).map((d) => [d.placementName, d.planned, d.actual, d.diff, d.reason || '']), [['Haupteingang', 2, 3, 1, ''], ['Stiege 2', 1, 0, -1, 'kein Zugang'], ['Tiefgarage', 2, 3, 1, '']])
  // Bemerkung und Foto am Liegeplatz (erster Eintrag)
  t = setPlacementNote(t, 'st-o1', 'Tiefgarage', ' Matte stark verschmutzt ', at(7, 28))
  assert.equal(placementsOf(s0())[2].note, 'Matte stark verschmutzt')
  const path = photoPath({ tour: t, placementId: 'Tiefgarage', date: DAY, n: nextPhotoNumber(t, 'Tiefgarage') })
  assert.equal(path, `matten/fotos/2026/Tiefgarage/${DAY}_mtaaaaaaaaaaaa_01.jpg`)
  t = addPlacementPhoto(t, 'st-o1', 'Tiefgarage', { name: path.split('/').pop(), path, at: T(7, 29), by, queued: true }, at(7, 29))
  assert.equal(nextPhotoNumber(t, 'Tiefgarage'), 2)
  assert.equal(placementsOf(s0())[2].photos.length, 1)
  const up = markPhotosUploaded(t, [[path, 'https://sp.example/foto.jpg']])
  assert.deepEqual(placementsOf(up.stops[0])[2].photos[0], { name: `${DAY}_mtaaaaaaaaaaaa_01.jpg`, path, at: T(7, 29), by, url: 'https://sp.example/foto.jpg' })
  assert.equal(markPhotosUploaded(up, [[path, 'x']]), up, 'schon hochgeladen: unverändert')
})

// ---------------------------------------------------------------- Abschluss (P11)

test('Abschluss: Unterschrift oder ohne Unterschrift mit Grund, gespeicherte Felder, danach fest, nächster offener Stopp', () => {
  let t = startTour(tour(), at(7))
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', at(7, 20))
  // noch offen: Hinweis, keine Unterschrift: Grund
  assert.match(finishProblem(t.stops[0], { reason: 'niemand da' }), /Noch offen: Stiege 2, Tiefgarage/)
  t = confirmPlacement(t, 'st-o1', 'Stiege 2', at(7, 21))
  t = changeQuantity(confirmPlacement(t, 'st-o1', 'Tiefgarage', at(7, 22)), 'st-o1', 2, -1, at(7, 22))
  assert.match(finishProblem(t.stops[0], {}), /warum ohne Unterschrift/)
  assert.match(finishProblem(t.stops[0], { signature: { name: '', svg: SIG } }), /Namen/)
  assert.match(finishProblem(t.stops[0], { signature: { name: 'Eva Beispiel', svg: '' } }), /unterschreiben lassen/)
  t = finishStop(t, 'st-o1', { signature: { name: ' Eva Beispiel ', role: 'Hausbetreuung', svg: SIG }, note: 'Alles in Ordnung', now: T(7, 30), by, driverId: 'e2' })
  const s = t.stops[0]
  assert.equal(s.status, 'abgeschlossen')
  assert.equal(s.finishedAt, T(7, 30))
  assert.equal(s.finishedBy, by)
  assert.equal(s.driverId, 'e2')
  assert.deepEqual(s.signature, { name: 'Eva Beispiel', role: 'Hausbetreuung', svg: SIG, at: T(7, 30) })
  assert.equal(s.unsigned, null)
  assert.equal(s.confirmation, 'unterschrieben')
  assert.deepEqual(s.deliveryNote, { state: 'offen' })
  assert.deepEqual(s.totals, { planned: 6, actual: 5 })
  assert.deepEqual(s.deviations.map((d) => [d.placementName, d.mat.articleId, d.diff]), [['Tiefgarage', 'a-m1', -1]])
  assert.equal(s.note, 'Alles in Ordnung')
  assert.equal(s.updatedAt, T(7, 30))
  // fest für den Fahrer
  assert.throws(() => confirmPlacement(t, 'st-o1', 'Haupteingang', at(8)), /nur das Büro/)
  assert.throws(() => finishStop(t, 'st-o1', { reason: 'x', now: T(8) }), /schon abgeschlossen/)
  // nächster offener Stopp
  assert.equal(nextOpenStop(t, 'st-o1').id, 'st-o2')
  assert.equal(tourProgress(t).done, 1)
  // ohne Unterschrift mit Grund
  t = confirmPlacement(t, 'st-o2', 'Schauraum', at(8))
  t = finishStop(t, 'st-o2', { reason: 'niemand vor Ort', now: T(8, 5), by })
  assert.deepEqual([t.stops[1].confirmation, t.stops[1].unsigned, t.stops[1].signature], ['ohne-unterschrift', { reason: 'niemand vor Ort', at: T(8, 5) }, null])
  assert.equal(t.status, 'unterwegs')
  assert.equal(nextOpenStop(t, 'st-o2').id, 'st-o3')
  // Ausnahme „Kunde nicht angetroffen“: offene Liegeplätze nicht möglich, Grund ohne Unterschrift vorbelegt; Tour fertig
  assert.equal(finishProblem(t.stops[2], { outcome: 'nicht-angetroffen' }), '')
  t = finishStop(t, 'st-o3', { outcome: 'nicht-angetroffen', now: T(8, 30), by })
  assert.deepEqual([t.stops[2].status, t.stops[2].outcome, t.stops[2].unsigned.reason, t.stops[2].items[0].reason], ['nicht-angetroffen', 'nicht-angetroffen', 'Kunde nicht angetroffen', 'Kunde nicht angetroffen'])
  assert.equal(nextOpenStop(t, 'st-o3'), null)
  assert.equal(t.status, 'abgeschlossen')
  assert.equal(t.finishedAt, T(8, 30))
  assert.ok(tourProgress(t).finished)
})

test('Abschluss: Ausnahmen „Teilweise erledigt“ und „Nicht durchgeführt“, übersprungene Stopps kommen am Ende dran', () => {
  let t = tour()
  // erster Stopp übersprungen: nach dem zweiten ist er wieder dran
  t = confirmPlacement(t, 'st-o2', 'Schauraum', at(7))
  assert.equal(t.status, 'unterwegs', 'erste Eingabe startet die Tour')
  t = finishStop(t, 'st-o2', { reason: 'niemand vor Ort', now: T(7, 10), by })
  assert.equal(nextOpenStop(t, 'st-o2').id, 'st-o3')
  t = finishStop(t, 'st-o3', { outcome: 'nicht-durchgefuehrt', reason: 'Baustelle', now: T(7, 20), by })
  assert.deepEqual([t.stops[2].status, t.stops[2].unsigned.reason, t.stops[2].items[0].reason], ['nicht-durchgefuehrt', 'Baustelle', 'nicht durchgeführt'])
  assert.equal(nextOpenStop(t, 'st-o3').id, 'st-o1', 'übersprungener Stopp')
  assert.match(finishProblem(t.stops[0], { outcome: 'teilweise', reason: 'x' }), /mindestens einen Liegeplatz/)
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', at(7, 30))
  t = finishStop(t, 'st-o1', { outcome: 'teilweise', reason: 'keine Zeit beim Kunden', now: T(7, 40), by })
  assert.equal(t.stops[0].status, 'teilweise')
  assert.deepEqual(t.stops[0].items.map((it) => it.status), ['gewechselt', 'nicht-moeglich', 'nicht-moeglich', 'nicht-moeglich'])
  assert.equal(t.status, 'abgeschlossen')
  // Ausnahme bei schon vollständig erfasstem Stopp wird ignoriert
  let u = confirmPlacement(tour(), 'st-o2', 'Schauraum', at(7))
  u = finishStop(u, 'st-o2', { outcome: 'nicht-angetroffen', reason: 'x', now: T(7, 5), by })
  assert.deepEqual([u.stops[1].status, u.stops[1].outcome], ['abgeschlossen', undefined])
})

test('Korrektur nur im Büro: Stopp wieder öffnen mit Grund, bisheriger Abschluss nachvollziehbar; Lieferschein sperrt', () => {
  let t = confirmPlacement(tour(), 'st-o2', 'Schauraum', at(7))
  t = finishStop(t, 'st-o2', { signature: { name: 'Max Muster', role: 'Kunde', svg: SIG }, now: T(7, 10), by })
  assert.match(reopenProblem(t.stops[0]), /noch offen/)
  assert.throws(() => reopenStop(t, 'st-o2', { reason: '', now: T(9), by: 'Büro' }), /Grund/)
  t = reopenStop(t, 'st-o2', { reason: 'Menge laut Anruf 2 statt 3', now: T(9), by: 'Bernd Büro' })
  const s = t.stops[1]
  assert.equal(s.status, 'in-bearbeitung')
  assert.equal(s.signature, undefined)
  assert.deepEqual(s.corrections[0], { at: T(9), by: 'Bernd Büro', reason: 'Menge laut Anruf 2 statt 3', before: { status: 'abgeschlossen', finishedAt: T(7, 10), finishedBy: by, confirmation: 'unterschrieben', signature: { name: 'Max Muster', role: 'Kunde', svg: SIG, at: T(7, 10) }, unsigned: null } })
  t = setQuantity(t, 'st-o2', 0, 2, { now: T(9, 1), by: 'Bernd Büro' })
  t = finishStop(t, 'st-o2', { reason: 'Korrektur im Büro', now: T(9, 2), by: 'Bernd Büro' })
  assert.deepEqual(t.stops[1].totals, { planned: 3, actual: 2 })
  const ls = { ...t, stops: t.stops.map((x) => (x.id === 'st-o2' ? { ...x, deliveryNote: { state: 'erstellt', id: 'LS-2026-000001' } } : x)) }
  assert.match(reopenProblem(ls.stops[1]), /Lieferschein/)
})

// ---------------------------------------------------------------- Für das Büro: Einsätze, Fälligkeit

test('jobUpdatesFromTour: erledigt, teilweise, nachzuholen je Einsatz (auch alsoJobKeys), Datum des Abschlusses', () => {
  let t = startTour(tour(), at(7))
  assert.deepEqual(jobUpdatesFromTour(t), [], 'offene Stopps liefern nichts')
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', at(7, 10))
  t = markNotPossible(t, 'st-o1', 'Stiege 2', 'kein Zugang', at(7, 11))
  t = confirmPlacement(t, 'st-o1', 'Tiefgarage', at(7, 12))
  t = setQuantity(t, 'st-o1', 3, 1, at(7, 12)) // Tiefgarage 60 × 90: 1 statt 2
  t = finishStop(t, 'st-o1', { reason: 'niemand vor Ort', now: T(7, 15), by })
  // erst am nächsten Tag kurz nach Mitternacht (Wien) abgeschlossen: Tag des Abschlusses zählt
  t = confirmPlacement(t, 'st-o2', 'Schauraum', at(7, 20))
  t = finishStop(t, 'st-o2', { reason: 'x', now: '2026-11-09T23:30:00.000Z', by })
  const up = jobUpdatesFromTour(t)
  const by_ = Object.fromEntries(up.map((u) => [u.key, u]))
  assert.deepEqual(Object.keys(by_).sort(), [`Haupteingang:${DAY}`, `Schauraum:${DAY}`, `Stiege 2:${DAY}`, 'Tiefgarage:2026-10-26', `Tiefgarage:${DAY}`].sort())
  assert.deepEqual([by_[`Haupteingang:${DAY}`].status, by_[`Haupteingang:${DAY}`].actual, by_[`Haupteingang:${DAY}`].date], ['erledigt', 2, DAY])
  assert.deepEqual([by_[`Stiege 2:${DAY}`].status, by_[`Stiege 2:${DAY}`].reason, by_[`Stiege 2:${DAY}`].actual], ['nachzuholen', 'kein Zugang', 0])
  assert.deepEqual([by_[`Tiefgarage:${DAY}`].status, by_[`Tiefgarage:${DAY}`].actual, by_[`Tiefgarage:${DAY}`].planned], ['teilweise', 2, 3])
  assert.deepEqual(by_[`Tiefgarage:${DAY}`].mats, [{ articleId: 'a-m1', planned: 1, actual: 1 }, { articleId: 'a-m2', planned: 2, actual: 1 }])
  assert.deepEqual([by_['Tiefgarage:2026-10-26'].status, by_['Tiefgarage:2026-10-26'].also], ['teilweise', true], 'älterer offener Einsatz mit erledigt')
  assert.equal(by_[`Schauraum:${DAY}`].date, '2026-11-10')
  assert.equal(localDate('2026-11-09T23:30:00.000Z'), '2026-11-10')
  // Büro übernimmt in die Einsätze (matten-plan.js), Fälligkeit aus den bestätigten Wechseln
  const done = doneFromTours([t])
  assert.deepEqual(done, [{ placementId: 'Haupteingang', date: DAY }, { placementId: 'Tiefgarage', date: DAY }, { placementId: 'Schauraum', date: '2026-11-10' }])
  assert.equal(lastDone('Schauraum', { done }), '2026-11-10')
  const jobsAfter = jobs.map((j) => {
    const u = up.find((x) => x.key === j.key)
    return u && u.status !== 'nachzuholen' ? markDone(j, u.date, { partial: u.status === 'teilweise' }) : j
  })
  assert.equal(jobsAfter.find((j) => j.key === `Haupteingang:${DAY}`).status, 'erledigt')
  // ab dem letzten Wechsel: nächster Einsatz 14 Tage nach dem Abschluss
  const abIst = jobsFor({ placements: [{ ...placements[3], rule: 'ab-ist' }], done, von: '2026-11-10', bis: '2026-12-31' })
  assert.equal(abIst.added[0].due, '2026-11-24')
})

// ---------------------------------------------------------------- Zusammenführen je Stopp

test('mergeTour: je Stopp gewinnt, wer ihn zuletzt geändert hat; Büro ändert Reihenfolge, Fahrer Stopps', () => {
  const base = startTour(tour(), at(7))
  // Fahrer (offline): Stopp 1 und 2 bearbeitet
  let mine = confirmPlacement(base, 'st-o1', 'Haupteingang', at(7, 10))
  mine = finishStop(confirmPlacement(mine, 'st-o2', 'Schauraum', at(7, 20)), 'st-o2', { reason: 'niemand vor Ort', now: T(7, 25), by })
  // Büro (später): Reihenfolge geändert, Hinweis am Stopp 3, Stopp 2 auch geändert (früher als der Fahrer)
  let theirs = { ...base, order: ['st-o1', 'st-o3', 'st-o2'], updatedAt: T(8), updatedBy: 'Büro' }
  theirs = { ...theirs, stops: theirs.stops.map((s) => (s.id === 'st-o3' ? { ...s, hint: 'Lift defekt', updatedAt: T(8) } : s.id === 'st-o2' ? { ...s, hint: 'alt', updatedAt: T(7, 15) } : s)) }
  const m = mergeTour(base, mine, theirs)
  assert.deepEqual(m.order, ['st-o1', 'st-o3', 'st-o2'], 'Reihenfolge vom Büro')
  assert.equal(m.stops.find((s) => s.id === 'st-o1').status, 'in-bearbeitung', 'nur Fahrer geändert')
  assert.equal(m.stops.find((s) => s.id === 'st-o3').hint, 'Lift defekt', 'nur Büro geändert')
  assert.equal(m.stops.find((s) => s.id === 'st-o2').status, 'abgeschlossen', 'beide geändert: der Fahrer zuletzt')
  assert.equal(m.stops.find((s) => s.id === 'st-o2').hint, undefined)
  // umgekehrt: Büro zuletzt
  const later = { ...theirs, stops: theirs.stops.map((s) => (s.id === 'st-o2' ? { ...s, hint: 'neu', updatedAt: T(9) } : s)) }
  assert.equal(mergeTour(base, mine, later).stops.find((s) => s.id === 'st-o2').hint, 'neu')
  // gleicher Stand: unverändert; ohne Gegenseite: meins
  assert.deepEqual(mergeTour(base, mine, base), mine)
  assert.deepEqual(mergeTour(base, mine, null), mine)
  // neuer Stopp im Büro, im Büro entfernter (vom Fahrer unberührter) Stopp
  const added = { ...base, stops: [...base.stops.filter((s) => s.id !== 'st-o3'), { id: 'st-neu', status: 'geplant', items: [] }], order: ['st-o1', 'st-o2', 'st-neu'], updatedAt: T(8) }
  const m2 = mergeTour(base, mine, added)
  assert.deepEqual(m2.stops.map((s) => s.id).sort(), ['st-neu', 'st-o1', 'st-o2'])
  assert.deepEqual(m2.order, ['st-o1', 'st-o2', 'st-neu'])
  // im Büro entfernt, vom Fahrer aber bearbeitet: bleibt (nichts geht verloren)
  const dropped = { ...base, stops: base.stops.filter((s) => s.id !== 'st-o2'), order: ['st-o1', 'st-o3'], updatedAt: T(8) }
  assert.ok(mergeTour(base, mine, dropped).stops.some((s) => s.id === 'st-o2'))
  // alle Stopps fertig nach dem Zusammenführen: Tour abgeschlossen
  let a = finishStop(confirmPlacement(base, 'st-o1', 'Haupteingang', at(7)), 'st-o1', { outcome: 'teilweise', reason: 'x', now: T(7, 1), by })
  let b = finishStop(confirmPlacement(base, 'st-o2', 'Schauraum', at(7)), 'st-o2', { reason: 'x', now: T(7, 2), by })
  b = finishStop(b, 'st-o3', { outcome: 'nicht-angetroffen', now: T(7, 3), by })
  assert.equal(mergeTour(base, a, b).status, 'abgeschlossen')
})

// ---------------------------------------------------------------- Beispieldaten

test('Beispiel-Tour für den Browser-Modus: freigegeben, zwei Stopps, ohne Preise, Navigation mit Koordinaten', () => {
  const d = createMattenTourDemo('2026-11-06')
  assert.equal(d.status, 'freigegeben')
  assert.deepEqual(d.order, ['st-o2', 'st-o11'])
  assert.equal(placementsOf(d.stops[0]).length, 2)
  assert.ok(!/price|preis|€/i.test(JSON.stringify(d)), 'keine Preise')
  assert.match(navigationUrl(d.stops[0]), /destination=47\.7951,13\.0186$/)
  assert.ok(isTourPath(`matten/touren/2026/${d.id}.json`) && !isTourPath('matten/touren/2026/x/y.json') && !isTourPath('matten/matten.json'))
  assert.deepEqual(tourYears('2026-11-06'), [2025, 2026, 2027])
})

// ---------------------------------------------------------------- Tour-Dateien: eTag, Gerät, Zusammenführen

/** SharePoint-Attrappe für Tour-Dateien: eTags, Konflikte, Netz an/aus, Hochladen mit Warteschlange. */
function fakeStore() {
  const files = new Map()
  let n = 0
  const net = { offline: false }
  const queue = new Map()
  const offline = () => {
    if (net.offline) throw new OfflineError()
  }
  const store = {
    kind: 'sharepoint',
    files,
    net,
    writes: 0,
    put(path, data) {
      files.set(path, { data: JSON.parse(JSON.stringify(data)), etag: `"e${++n}"` })
    },
    async listDocs(prefix) {
      offline()
      return [...files.keys()].filter((p) => p.startsWith(`${prefix}/`))
    },
    async read(path) {
      offline()
      const f = files.get(path)
      return f ? { data: JSON.parse(JSON.stringify(f.data)), etag: f.etag } : null
    },
    async etagsOf(paths) {
      offline()
      return new Map(paths.map((p) => [p, files.get(p)?.etag ?? null]))
    },
    async write(path, data, etag) {
      offline()
      const f = files.get(path)
      if ((f && f.etag !== etag) || (!f && etag)) throw new ConflictError(path)
      store.writes++
      store.put(path, data)
      return files.get(path).etag
    },
    async upload(path, blob) {
      if (net.offline) {
        queue.set(path, blob)
        return { webUrl: null, queued: true }
      }
      files.set(path, { blob })
      return { webUrl: `https://sp.example/${path}` }
    },
    async flushUploads(onDone) {
      if (net.offline) return queue.size
      for (const [path, blob] of queue) {
        files.set(path, { blob })
        queue.delete(path)
        onDone(path, `https://sp.example/${path}`)
      }
      return 0
    },
  }
  return store
}

const PATH = `matten/touren/2026/mtaaaaaaaaaaaa.json`

test('Tour-Dateien: laden, ändern, mit eTag speichern; ohne Netz im Gerät, nach Neuladen nachgeholt (kein Verlust)', async () => {
  const sp = fakeStore()
  sp.put(PATH, tour())
  sp.put('matten/touren/2026/mtbbbbbbbbbbbb.json', tour({ id: 'mtbbbbbbbbbbbb', driverId: 'e4' }))
  sp.put('matten/matten.json', { schema: 1 }) // keine Tour
  const cache = memoryCache()
  let changes = 0
  const s = new TourStore({ store: sp, cache, onChange: () => changes++ })
  const list = await s.load({ today: DAY })
  assert.equal(list.length, 2)
  assert.ok(changes >= 1)
  await s.update('mtaaaaaaaaaaaa', (t) => startTour(t, at(7)))
  await s.flush()
  assert.equal(sp.files.get(PATH).data.status, 'unterwegs')
  assert.equal(s.pendingPaths().length, 0)
  // Funkloch: Abschluss bleibt im Gerät
  sp.net.offline = true
  await s.update('mtaaaaaaaaaaaa', (t) => confirmPlacement(t, 'st-o2', 'Schauraum', at(7, 30)))
  await s.update('mtaaaaaaaaaaaa', (t) => finishStop(t, 'st-o2', { reason: 'niemand vor Ort', now: T(7, 31), by }))
  await s.flush()
  assert.ok(s.offline)
  assert.deepEqual(s.pendingPaths(), [PATH])
  assert.equal(sp.files.get(PATH).data.stops[1].status, 'geplant', 'noch nicht in SharePoint')
  assert.equal(s.byId('mtaaaaaaaaaaaa').stops[1].status, 'abgeschlossen', 'im Gerät')
  // Neuladen ohne Netz: neue Instanz mit demselben Gerätespeicher
  const s2 = new TourStore({ store: sp, cache })
  const offlineList = await s2.load({ today: DAY })
  assert.equal(offlineList.length, 2, 'ohne Netz: Liste und Touren aus dem Gerät')
  assert.equal(s2.byId('mtaaaaaaaaaaaa').stops[1].status, 'abgeschlossen')
  assert.ok(s2.isPending('mtaaaaaaaaaaaa'))
  // Netz wieder da: nachgeholt
  sp.net.offline = false
  await s2.load({ today: DAY })
  await s2.flush()
  assert.equal(sp.files.get(PATH).data.stops[1].status, 'abgeschlossen')
  assert.deepEqual(s2.pendingPaths(), [])
  assert.deepEqual(await cache.all('pending'), [])
})

test('Tour-Dateien: gleichzeitige Änderung im Büro → Konflikt (eTag), je Stopp zusammengeführt, nichts geht verloren', async () => {
  const sp = fakeStore()
  sp.put(PATH, startTour(tour(), at(7)))
  const s = new TourStore({ store: sp, cache: memoryCache() })
  await s.load({ today: DAY })
  // Büro ändert inzwischen die Reihenfolge und Stopp 3
  const office = (await sp.read(PATH)).data
  sp.put(PATH, { ...office, order: ['st-o1', 'st-o3', 'st-o2'], stops: office.stops.map((x) => (x.id === 'st-o3' ? { ...x, hint: 'Lift defekt', updatedAt: T(7, 40) } : x)), updatedAt: T(7, 40) })
  await s.update('mtaaaaaaaaaaaa', (t) => confirmPlacement(t, 'st-o1', 'Haupteingang', at(7, 45)))
  await s.flush()
  const saved = sp.files.get(PATH).data
  assert.deepEqual(saved.order, ['st-o1', 'st-o3', 'st-o2'])
  assert.equal(saved.stops.find((x) => x.id === 'st-o3').hint, 'Lift defekt')
  assert.equal(saved.stops.find((x) => x.id === 'st-o1').items[0].status, 'gewechselt')
  assert.deepEqual(s.pendingPaths(), [])
  // anderes Gerät desselben Fahrers hat denselben Stopp später geändert: der spätere gewinnt
  const other = (await sp.read(PATH)).data
  sp.put(PATH, confirmPlacement(other, 'st-o2', 'Schauraum', at(9)))
  await s.update('mtaaaaaaaaaaaa', (t) => markNotPossible(t, 'st-o2', 'Schauraum', 'kein Zugang', at(8)))
  await s.flush()
  assert.equal(sp.files.get(PATH).data.stops.find((x) => x.id === 'st-o2').items[0].status, 'gewechselt')
  // Fehler ohne Netzbezug (z. B. kein Schreibrecht): bleibt im Gerät mit Fehlertext
  const denied = { ...sp, write: async () => { throw Object.assign(new Error('Zugriff verweigert'), { status: 403 }) } }
  const s3 = new TourStore({ store: denied, cache: memoryCache() })
  await s3.load({ today: DAY })
  await s3.update('mtaaaaaaaaaaaa', (t) => confirmPlacement(t, 'st-o3', 'Foyer', at(10)))
  await s3.flush()
  assert.deepEqual(s3.pendingPaths(), [PATH])
  assert.match(s3.error, /Zugriff verweigert/)
})

test('Tour-Dateien: Fotos ohne Netz in der Warteschlange, danach hochgeladen und in der Tour vermerkt', async () => {
  const sp = fakeStore()
  sp.put(PATH, tour())
  const s = new TourStore({ store: sp, cache: memoryCache() })
  await s.load({ today: DAY })
  sp.net.offline = true
  const t0 = s.byId('mtaaaaaaaaaaaa')
  const path = photoPath({ tour: t0, placementId: 'Schauraum', date: DAY, n: 1 })
  const up = await sp.upload(path, 'JPEG')
  assert.ok(up.queued)
  await s.update('mtaaaaaaaaaaaa', (t) => addPlacementPhoto(t, 'st-o2', 'Schauraum', { name: path.split('/').pop(), path, at: T(7), by, queued: true }, at(7)))
  assert.equal(await s.flushPhotos(markPhotosUploaded), 1)
  sp.net.offline = false
  assert.equal(await s.flushPhotos(markPhotosUploaded), 0)
  await s.flush()
  const photo = sp.files.get(PATH).data.stops[1].items[0].photos[0]
  assert.equal(photo.queued, undefined)
  assert.equal(photo.url, `https://sp.example/${path}`)
  assert.ok(sp.files.has(path))
})
