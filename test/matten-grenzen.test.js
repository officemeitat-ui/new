// Mattenwechsel: Prüfrunde 9.11.2026 – Fehler an Grenzen der Rechenkerne (docs/MATTENWECHSEL-PLAN.md, Abschnitt 7,
// „Prüfrunde 9.11.2026“). Je Befund ein Test, der vor der Behebung fehlschlug. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { billedBy, stateOf } from '../src/core/invoicing.js'
import { confirmPlacement, doneFromTours, finishStop, jobUpdatesFromTour, reopenStop, setQuantity } from '../src/core/matten-fahrt.js'
import { noteDraft } from '../src/core/matten-lieferschein.js'
import { jobsFor, markDone, nextDue } from '../src/core/matten-plan.js'
import { recalcTimes, stopsFromJobs, tourProblems } from '../src/core/matten-tour.js'
import { addStop, assignJobs, keysInTours, releaseProblems } from '../src/core/matten-touren.js'
import { notDoneList, tourResults } from '../src/core/matten-uebersicht.js'

const grau = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Bürohaus Nord', address: 'Nordweg 4, 5020 Salzburg', lat: 47.823, lon: 13.03 },
]
const lp = (id, objectId, extra = {}) => ({ id, name: id, objectId, customerId: hv.id, customer: hv, active: true, mats: [{ ...grau, qty: 2, owner: 'wir' }], intervalDays: 14, startDate: '2026-11-02', rule: 'rhythmus', ...extra })
const placements = [lp('Haupteingang', 'o1'), lp('Foyer', 'o2')]
const job = (placementId, due, extra = {}) => ({ id: `${placementId}:${due}`, key: `${placementId}:${due}`, placementId, due, status: 'geplant', ...extra })
const SIG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5"/></svg>'
/** Zeitpunkt in Wien (Winterzeit, UTC+1) als ISO in UTC. */
const wien = (date, hm) => {
  const [h, m] = hm.split(':').map(Number)
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + ((h - 1) * 60 + m) * 60e3).toISOString()
}

/** Freigegebene Tour aus Einsätzen (Status der Einsätze für den Vorschlag: geplant). */
function tourOf(id, date, list, status = 'freigegeben') {
  const stops = stopsFromJobs({ jobs: list.map((j) => ({ ...j, status: 'geplant' })), placements, objects, date })
  return { schema: 1, id, date, driverId: 'e1', driverName: 'Anna Beispiel', status, order: stops.map((s) => s.id), stops, createdAt: wien(date, '06:00'), updatedAt: wien(date, '06:00') }
}

// ---------------------------------------------------------------- Fakturierung: Lieferschein in Entwurf und Rechnung

test('Lieferschein in einem Entwurf und in einer festgeschriebenen Rechnung: Stand „verrechnet“, billedBy nennt die Rechnung', () => {
  // „zwei Entwürfe mit demselben Lieferschein sind möglich, festschreiben lässt sich nur der erste“ (Annahmen P14):
  // der von Hand angelegte Entwurf steht in documents vor der festgeschriebenen Rechnung aus dem Lauf
  const note = { id: 'ls1', kind: 'lieferschein', number: 'LS-2026-000001', date: '2026-10-05', customerId: 'c1', lines: [] }
  const byHand = { id: 'r-hand', kind: 'rechnung', number: '', date: '2026-11-02', customerId: 'c1', refId: 'ls1', lines: [] }
  const fromRun = { id: 'r-lauf', kind: 'rechnung', number: 'RE-2026-0010', date: '2026-11-03', customerId: 'c1', deliveryNotes: [{ id: 'ls1', number: 'LS-2026-000001' }], lines: [] }
  const docs = [note, byHand, fromRun]
  assert.equal(billedBy(note, docs)?.id, 'r-lauf')
  assert.equal(stateOf(note, docs, '2026-11-09', {}), 'verrechnet')
  // nur der Entwurf: weiter offen (vergeben, aber nicht verrechnet), billedBy nennt ihn
  assert.equal(billedBy(note, [note, byHand])?.id, 'r-hand')
  assert.equal(stateOf(note, [note, byHand], '2026-11-09', {}), 'offen')
  // Storno der Rechnung gibt frei: es bleibt der Entwurf
  const storno = { id: 's1', kind: 'storno', number: 'ST-2026-0001', date: '2026-11-04', refId: 'r-lauf', lines: [] }
  assert.equal(billedBy(note, [...docs, storno])?.id, 'r-hand')
  assert.equal(stateOf(note, [...docs, storno], '2026-11-09', {}), 'offen')
})

// ---------------------------------------------------------------- Nicht durchgeführt: in einer neuen Tour nachholen

/** Tour vom 5.11.: Haupteingang „Kunde nicht angetroffen“, Foyer gewechselt; danach die Ergebnisse übernommen. */
function notDoneFixture() {
  const jobs = [job('Haupteingang', '2026-11-05', { status: 'in-tour', tourId: 'mt000000000001' }), job('Foyer', '2026-11-05', { status: 'in-tour', tourId: 'mt000000000001' })]
  let t1 = tourOf('mt000000000001', '2026-11-05', jobs)
  t1 = finishStop(t1, 'st-o1', { outcome: 'nicht-angetroffen', now: wien('2026-11-05', '08:00'), by: 'Anna Beispiel' })
  t1 = confirmPlacement(t1, 'st-o2', 'Foyer', { now: wien('2026-11-05', '08:30'), by: 'Anna Beispiel' })
  t1 = finishStop(t1, 'st-o2', { signature: { name: 'Eva Beispiel', svg: SIG }, now: wien('2026-11-05', '08:35'), by: 'Anna Beispiel' })
  assert.equal(t1.status, 'abgeschlossen')
  const applied = tourResults(jobs, [t1], { now: wien('2026-11-06', '09:00'), by: 'Büro' })
  const after = jobs.map((j) => applied.find((x) => x.key === j.key) || j)
  assert.equal(after[0].status, 'nachzuholen')
  return { t1, jobs: after }
}

test('Nicht durchgeführter Wechsel einer abgeschlossenen Tour: kommt in den nächsten Vorschlag und lässt sich freigeben', () => {
  const { t1, jobs } = notDoneFixture()
  const today = '2026-11-09'
  // fertige Stopps halten ihre Einsätze nicht mehr fest
  assert.deepEqual([...keysInTours([t1], { today })], [])
  const stops = stopsFromJobs({ jobs, placements, objects, date: '2026-11-10', exclude: [...keysInTours([t1], { today })] })
  assert.deepEqual(stops.map((s) => s.id), ['st-o1'], 'der nicht durchgeführte Wechsel wird wieder vorgeschlagen')
  const t2 = { ...tourOf('mt000000000002', '2026-11-10', [jobs[0]], 'entwurf'), stops }
  assert.deepEqual(releaseProblems({ tour: t2, tours: [t1, t2], jobs, today }), [])
  const changed = assignJobs(jobs, t2, { now: wien(today, '10:00'), by: 'Büro' })
  assert.deepEqual(changed.map((j) => [j.key, j.status, j.tourId, j.beforeTour]), [['Haupteingang:2026-11-05', 'in-tour', 'mt000000000002', 'nachzuholen']])
  // in einer laufenden Tour hält ein offener Stopp seinen Einsatz weiter fest, ein fertiger nicht
  const running = { ...t2, status: 'unterwegs' }
  assert.deepEqual([...keysInTours([running], { today })], ['Haupteingang:2026-11-05'])
  assert.equal(releaseProblems({ tour: { ...t2, id: 'mt000000000003' }, tours: [running], jobs, today }).filter((p) => p.code === 'doppelt').length, 1)
})

test('Nicht durchgeführt und neu in einer Tour eingeplant: „Nachholen am“ = Tag der neuen Tour', () => {
  const { t1, jobs } = notDoneFixture()
  const today = '2026-11-09'
  const t2 = { ...tourOf('mt000000000002', '2026-11-11', [jobs[0]]), status: 'freigegeben' }
  const inTour = jobs.map((j) => assignJobs(jobs, t2).find((x) => x.key === j.key) || j)
  const list = notDoneList({ tours: [t1, t2], jobs: inTour, done: doneFromTours([t1, t2]), today })
  assert.deepEqual(list.map((x) => [x.key, x.date, x.planned]), [['Haupteingang:2026-11-05', '2026-11-05', '2026-11-11']])
})

test('Entwurf eines vergangenen Tages hält nichts fest – auch nicht bei der Freigabe', () => {
  const jobs = [job('Haupteingang', '2026-11-02', { status: 'nachzuholen', planned: '2026-11-04' })]
  const old = tourOf('mt000000000001', '2026-11-04', jobs, 'entwurf')
  const today = '2026-11-09'
  assert.equal(keysInTours([old], { today }).size, 0)
  const fresh = tourOf('mt000000000002', '2026-11-10', jobs, 'entwurf')
  assert.deepEqual(releaseProblems({ tour: fresh, tours: [old, fresh], jobs, today }), [])
  // ein Entwurf ab heute hält weiter fest
  const current = { ...old, date: '2026-11-09' }
  assert.deepEqual(releaseProblems({ tour: fresh, tours: [current, fresh], jobs, today }).map((p) => p.code), ['doppelt'])
})

// ---------------------------------------------------------------- Zwei Kunden an einem Objekt

test('Stopp eines zweiten Kunden am selben Objekt nachträglich in die Tour: eigener Stopp mit eigener ID, nichts vermischt', () => {
  const praxis = { id: 'c2', name: 'Arztpraxis Beispiel', no: '10002' }
  const all = [...placements, lp('Praxis', 'o1', { customerId: praxis.id, customer: praxis, mats: [{ ...grau, qty: 1, owner: 'wir' }] })]
  // Vorschlag am Morgen: nur der Einsatz der Hausverwaltung am Objekt o1 → Stopp st-o1
  const jobs = [job('Haupteingang', '2026-11-10'), job('Praxis', '2026-11-10')]
  const first = stopsFromJobs({ jobs: [jobs[0]], placements: all, objects, date: '2026-11-10' })
  const tour = { schema: 1, id: 'mt000000000001', date: '2026-11-10', driverId: 'e1', status: 'entwurf', order: first.map((s) => s.id), stops: first }
  // später „Nicht eingeplant“ → „Zur Tour …“: der Stopp der Praxis heißt für sich allein ebenfalls st-o1
  const [open] = stopsFromJobs({ jobs, placements: all, objects, date: '2026-11-10', exclude: [...keysInTours([tour])] })
  assert.equal(open.id, 'st-o1')
  const next = addStop(tour, open)
  assert.deepEqual(next.stops.map((s) => [s.id, s.customer.id, s.items.map((it) => it.placementId)]), [['st-o1', 'c1', ['Haupteingang']], ['st-o1-c2', 'c2', ['Praxis']]])
  assert.deepEqual(next.order, ['st-o1', 'st-o1-c2'])
  // derselbe Kunde am selben Objekt kommt weiter in denselben Stopp
  const same = addStop(tour, stopsFromJobs({ jobs: [job('Haupteingang', '2026-11-03', { status: 'nachzuholen' })], placements: all, objects, date: '2026-11-10' })[0])
  assert.deepEqual(same.stops.map((s) => [s.id, s.items.map((it) => it.jobKey)]), [['st-o1', ['Haupteingang:2026-11-10', 'Haupteingang:2026-11-03']]])
})

// ---------------------------------------------------------------- Tour über Mitternacht

test('Tour über Mitternacht: Zeitfenster und Arbeitszeit werden gemeldet', () => {
  const depot = { name: 'Betriebshof (Beispiel)', lat: 47.7745, lon: 13.07 }
  const stops = [
    { id: 'st-a', lat: 47.8095, lon: 13.055, workMinutes: 240, demand: 2, window: null, items: [] },
    { id: 'st-b', lat: 47.823, lon: 13.03, workMinutes: 240, demand: 2, window: { from: '', to: '23:00' }, items: [] },
  ]
  const t = recalcTimes({ id: 'mt000000000009', date: '2026-11-10', driverId: 'e1', status: 'entwurf', route: { depot, shift: { from: '16:00', to: '23:30' } }, stops })
  assert.ok(t.route.end < t.route.start, `Rückkehr nach Mitternacht (${t.route.end})`)
  const codes = tourProblems(t).map((p) => [p.code, p.stopId || ''])
  assert.deepEqual(codes, [['zeitfenster', 'st-b'], ['arbeitszeit', '']])
  // am selben Tag bleibt alles wie bisher
  const day = recalcTimes({ ...t, route: { depot, shift: { from: '07:00', to: '17:00' } } })
  assert.deepEqual(tourProblems(day), [])
  assert.deepEqual(tourProblems(recalcTimes({ ...t, route: { depot, shift: { from: '07:00', to: '15:30' } } })).map((p) => p.code), ['arbeitszeit'])
})

// ---------------------------------------------------------------- Korrektur im Büro nach dem Abschluss

test('Korrektur im Büro: der Wechsel bleibt am Tag des ersten Abschlusses (Lieferschein, Preis, Fälligkeit)', () => {
  const jobs = [job('Haupteingang', '2026-10-30', { status: 'in-tour', tourId: 'mt000000000001' })]
  let t = tourOf('mt000000000001', '2026-10-30', jobs)
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', { now: wien('2026-10-30', '09:00'), by: 'Anna Beispiel' })
  t = finishStop(t, 'st-o1', { signature: { name: 'Eva Beispiel', svg: SIG }, now: wien('2026-10-30', '09:05'), by: 'Anna Beispiel' })
  const first = t.stops[0].finishedAt
  // vier Tage später: Kunde ruft an, es war nur 1 Matte
  t = reopenStop(t, 'st-o1', { reason: 'Menge laut Anruf 1 statt 2', now: wien('2026-11-03', '10:00'), by: 'Büro' })
  t = setQuantity(t, 'st-o1', 0, 1, { now: wien('2026-11-03', '10:01'), by: 'Büro' })
  t = finishStop(t, 'st-o1', { reason: 'Korrektur nach Anruf', now: wien('2026-11-03', '10:02'), by: 'Büro' })
  const stop = t.stops[0]
  assert.equal(stop.finishedAt, first, 'Abschluss bleibt der des Fahrers')
  assert.equal(stop.corrections.length, 1)
  assert.equal(stop.unsigned.at, wien('2026-11-03', '10:02'), 'Zeitpunkt der Korrektur bleibt nachvollziehbar')
  assert.deepEqual(doneFromTours([t]), [{ placementId: 'Haupteingang', date: '2026-10-30' }])
  assert.deepEqual(jobUpdatesFromTour(t).map((u) => [u.key, u.status, u.date, u.actual]), [['Haupteingang:2026-10-30', 'teilweise', '2026-10-30', 1]])
  // Lieferschein: Datum und Kundenpreis des Wechseltags (der Kundenpreis galt bis 31.10.)
  const data = {
    settings: { vat: 20 },
    customers: [{ id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', street: 'Ringstraße 3', zip: '5020', city: 'Salzburg' }],
    articles: [{ id: 'a-m1', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', price: 4.9, vat: 20 }],
    customerPrices: [{ id: 'kp1', customerId: 'c1', articleId: 'a-m1', price: 4.1, vat: 20, validFrom: '2026-01-01', validTo: '2026-10-31' }],
    documents: [],
  }
  const { doc } = noteDraft({ tour: t, stop, data, id: 'ls-x', now: wien('2026-11-03', '10:05'), by: 'Büro' })
  assert.equal(doc.date, '2026-10-30')
  assert.deepEqual(doc.lines.filter((l) => l.type === 'item').map((l) => [l.qty, l.price, l.source.price]), [[1, 4.1, 'kunde']])
})

// ---------------------------------------------------------------- „ab dem letzten Wechsel“ nach einem frühen Wechsel

test('„ab dem letzten Wechsel“: zwei Wochen früher erledigt – Planen legt den nächsten Einsatz an wie nextDue', () => {
  const p = { id: 'L1', active: true, intervalDays: 14, startDate: '2026-10-01', rule: 'ab-ist', pauses: [] }
  const prev = { key: 'L1:2026-10-05', placementId: 'L1', due: '2026-10-05', status: 'erledigt', doneOn: '2026-10-05' }
  // Einsatz zum 2.11. vom Büro auf den 19.10. vorgezogen und an dem Tag erledigt
  const early = markDone({ key: 'L1:2026-11-02', placementId: 'L1', due: '2026-11-02', planned: '2026-10-19', status: 'geplant' }, '2026-10-19')
  const jobs = [prev, early]
  assert.equal(nextDue(p, { jobs, today: '2026-10-20' }).due, '2026-11-16')
  const r = jobsFor({ placements: [p], jobs, von: '2026-10-20', bis: '2026-12-31', now: 'x' })
  assert.deepEqual(r.added.map((j) => [j.key, j.status]), [['L1:2026-11-16', 'geplant']])
  // erneutes Planen ohne Doppel
  assert.deepEqual(jobsFor({ placements: [p], jobs: r.jobs, von: '2026-10-20', bis: '2026-12-31', now: 'x' }).added, [])
})
