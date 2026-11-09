// Mattenwechsel P15: Büro-Übersicht (core/matten-uebersicht.js) – die neun Zahlen mit ihren Listen, Stand aus den Touren,
// nicht durchgeführte Wechsel, „Heute“, kleine Woche, Kennzahlen und Rechte. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess } from '../src/core/access.js'
import { confirmPlacement, finishStop, markNotPossible, startTour } from '../src/core/matten-fahrt.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'
import { CARDS, mattenDrafts, mattenInvoices, mattenKpi, mattenStateOf, notDoneList, overviewOf, overviewRights, staleTours, tourResults, weekOf } from '../src/core/matten-uebersicht.js'

const TODAY = '2026-11-09' // Montag
const at = (date, hm = '09:00') => ({ now: `${date}T${hm}:00.000Z`, by: 'Markus Huber' })
const grau = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const navy = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const objects = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'].map((id, i) => ({ id, name: `Objekt ${i + 1}`, address: `Beispielweg ${i + 1}, 5020 Salzburg` }))
const lp = (id, objectId, startDate, mats = [{ ...grau, qty: 2 }]) => ({ id, name: `Liegeplatz ${id}`, objectId, customerId: hv.id, customer: hv, active: true, mats, intervalDays: 14, startDate, rule: 'rhythmus' })
const placements = [
  lp('p1', 'o1', '2026-11-05'),
  lp('p2', 'o1', '2026-11-05', [{ ...navy, qty: 1 }]),
  lp('p3', 'o2', '2026-11-05'),
  lp('p4', 'o3', TODAY),
  lp('p5', 'o4', '2026-11-06'),
  lp('p6', 'o5', '2026-10-19'),
  lp('p7', 'o6', '2026-11-10'),
  lp('p8', 'o6', TODAY, [{ ...navy, qty: 3 }]),
]
const doc = { schema: 1, settings: {}, placements, areas: [] }
const job = (placementId, due, extra = {}) => ({ id: `${placementId}:${due}`, key: `${placementId}:${due}`, placementId, due, status: 'geplant', ...extra })
const tourOf = (id, date, status, list) => {
  const stops = stopsFromJobs({ jobs: list.map((j) => ({ ...j, status: 'geplant' })), placements, objects, date })
  return { schema: 1, id, date, driverId: 'e2', driverName: 'Markus Huber', status, order: stops.map((s) => s.id), stops }
}

/**
 * T1 (5.11., abgeschlossen): Objekt 1 mit p1 gewechselt und p2 „kein Zugang“, Objekt 2 „Kunde nicht angetroffen“.
 * T2 (heute, unterwegs), T3 (6.11., freigegeben, nie gestartet), T4 (morgen, freigegeben), T5 (11.11., Entwurf).
 */
function fixture() {
  const jobs = [
    job('p1', '2026-11-05', { status: 'in-tour', tourId: 'mt000000000001' }),
    job('p2', '2026-11-05', { status: 'in-tour', tourId: 'mt000000000001' }),
    job('p3', '2026-11-05', { status: 'in-tour', tourId: 'mt000000000001' }),
    job('p4', TODAY, { status: 'in-tour', tourId: 'mt000000000002' }),
    job('p5', '2026-11-06', { status: 'in-tour', tourId: 'mt000000000003' }),
    job('p6', '2026-11-02'),
    job('p7', '2026-11-10', { status: 'in-tour', tourId: 'mt000000000004' }),
  ]
  let t1 = tourOf('mt000000000001', '2026-11-05', 'freigegeben', jobs.slice(0, 3))
  t1 = confirmPlacement(t1, 'st-o1', 'p1', at('2026-11-05', '08:00'))
  t1 = markNotPossible(t1, 'st-o1', 'p2', 'kein Zugang', at('2026-11-05', '08:01'))
  t1 = finishStop(t1, 'st-o1', { reason: 'niemand vor Ort', ...at('2026-11-05', '08:05') })
  t1 = finishStop(t1, 'st-o2', { outcome: 'nicht-angetroffen', reason: 'niemand vor Ort', ...at('2026-11-05', '08:30') })
  // ein Foto, das seit zwei Tagen in der Warteschlange eines Geräts steht
  t1.stops[0].items[0].photos = [{ name: 'f.jpg', path: 'matten/fotos/2026/p1/2026-11-05_mt000000000001_01.jpg', at: '2026-11-07T08:00:00.000Z', queued: true }]
  const t2 = startTour(tourOf('mt000000000002', TODAY, 'freigegeben', [jobs[3]]), at(TODAY, '06:30'))
  const t3 = tourOf('mt000000000003', '2026-11-06', 'freigegeben', [jobs[4]])
  const t4 = tourOf('mt000000000004', '2026-11-10', 'freigegeben', [jobs[6]])
  const t5 = tourOf('mt000000000005', '2026-11-11', 'entwurf', [jobs[5]])
  return { jobs, tours: [t1, t2, t3, t4, t5] }
}

/** Belege der Fakturierung (erfunden): Lieferscheine aus dem Mattenwechsel, Rechnungen und Entwürfe. */
function fakDocs() {
  const ls = (id, number, extra = {}) => ({ id, kind: 'lieferschein', number, date: '2026-11-05', source: { type: 'matten', key: `matten:mt000000000001:${id}` }, lines: [], ...extra })
  return [
    ls('ls1', 'LS-2026-000001'),
    ls('ls2', 'LS-2026-000002', { sent: [{ at: '2026-11-05T12:00:00.000Z', to: ['x@example.com'] }], integration: { ablage: { status: 'fehler', lastError: 'Keine Berechtigung' } } }),
    ls('ls3', ''), // Entwurf eines Lieferscheins: zählt nicht
    { id: 'ls-hand', kind: 'lieferschein', number: 'LS-2026-000003', date: '2026-11-05', lines: [] }, // von Hand, nicht aus dem Mattenwechsel
    { id: 'r1', kind: 'rechnung', number: '', date: '2026-11-08', title: 'Mattenwechsel Oktober 2026', source: { type: 'matten-abrechnung', key: 'x' }, review: { checkedAt: 'a', releasedAt: 'b' }, lines: [] },
    { id: 'r2', kind: 'rechnung', number: '', date: '2026-11-07', title: 'Mattenwechsel Objekt 1', refId: 'ls1', lines: [] },
    { id: 'r3', kind: 'rechnung', number: '', date: '2026-11-07', title: 'Unterhaltsreinigung', lines: [{ text: 'Reinigung', qty: 1, price: 100 }] },
    { id: 'r4', kind: 'rechnung', number: 'RE-2026-0001', date: '2026-10-31', title: 'Mattenwechsel September', source: { type: 'matten-abrechnung' }, lines: [{ text: 'Matte', qty: 10, price: 4.4, vat: 20 }] },
    { id: 's4', kind: 'storno', number: 'ST-2026-0001', date: '2026-11-02', refId: 'r4', lines: [{ text: 'Matte', qty: -10, price: 4.4, vat: 20 }] },
  ]
}

test('Stand aus den Touren: erledigt bzw. nachzuholen nur für Einsätze „in Tour“ dieser Tour', () => {
  const { jobs, tours } = fixture()
  const changed = tourResults(jobs, tours, { now: 'x', by: 'Büro' })
  assert.deepEqual(changed.map((j) => [j.key, j.status, j.doneOn || '', j.reason || '']).sort(), [
    ['p1:2026-11-05', 'erledigt', '2026-11-05', ''],
    ['p2:2026-11-05', 'nachzuholen', '', 'kein Zugang'],
    ['p3:2026-11-05', 'nachzuholen', '', 'Kunde nicht angetroffen'],
  ])
  assert.ok(changed.every((j) => j.id === j.key && j.tourId === 'mt000000000001' && j.updatedBy === 'Büro'))
  // schon übernommen bzw. vom Büro geändert (nicht mehr in Tour): nichts zu tun
  assert.deepEqual(tourResults(jobs.map((j) => (j.key === 'p1:2026-11-05' ? { ...j, status: 'erledigt' } : j)), tours).map((j) => j.key).sort(), ['p2:2026-11-05', 'p3:2026-11-05'])
  // anderer Tour zugeordnet (z. B. neu eingeplant): bleibt
  assert.equal(tourResults([{ ...jobs[1], tourId: 'mt0000000000ff' }], tours).length, 0)
  // Entwürfe und offene Stopps ändern nichts
  assert.deepEqual(tourResults(jobs, tours.slice(1)), [])
})

test('Die neun Zahlen mit Fakturierung: Definitionen und Listen', () => {
  const { jobs, tours } = fixture()
  const tourErrors = [{ id: 'mt000000000009', path: 'matten/touren/2026/mt000000000009.json', error: 'Keine Schreibrechte auf die Touren (matten/touren/).' }]
  const o = overviewOf({ doc, jobs, tours, docs: fakDocs(), tourErrors, today: TODAY, now: `${TODAY}T10:00:00.000Z` })
  assert.deepEqual(Object.keys(o.cards).sort(), [...CARDS].sort())
  const n = Object.fromEntries(Object.entries(o.cards).map(([k, v]) => [k, v.n]))
  assert.deepEqual(n, { heute: 2, geplant: 3, unterwegs: 1, fertig: 1, ueberfaellig: 1, nicht: 2, unversendet: 1, fehler: 3, entwuerfe: 2 })
  // heute: p4 in der laufenden Tour, p8 laut Rhythmus heute dran, aber noch nicht im Kalender
  assert.deepEqual(o.cards.heute.list.map((x) => [x.placementId, x.inTour, x.unplanned]), [['p4', true, false], ['p8', false, true]])
  // geplant: freigegeben (auch der liegen gebliebene vom 6.11.) und der Entwurf ab heute; erster künftiger Tag
  assert.deepEqual(o.cards.geplant.list.map((x) => [x.tour.id, x.past]), [['mt000000000003', true], ['mt000000000004', false], ['mt000000000005', false]])
  assert.deepEqual([o.cards.geplant.drafts, o.cards.geplant.past, o.cards.geplant.next], [1, 1, '2026-11-10'])
  assert.equal(o.cards.unterwegs.list[0].tour.id, 'mt000000000002')
  assert.deepEqual(o.cards.fertig.list[0].progress.done, 2)
  // überfällig: nur p6 (p2/p3 nicht durchgeführt, p5 in einer freigegebenen Tour, p1 erledigt)
  assert.deepEqual(o.cards.ueberfaellig.list.map((x) => x.placement.id), ['p6'])
  assert.equal(o.cards.ueberfaellig.oldest, '2026-11-02')
  assert.deepEqual(o.cards.nicht.list.map((x) => [x.placementId, x.reason, x.stopStatus, x.planned]), [
    ['p2', 'kein Zugang', 'teilweise', ''],
    ['p3', 'Kunde nicht angetroffen', 'nicht-angetroffen', ''],
  ])
  assert.deepEqual(o.cards.unversendet.list.map((d) => d.id), ['ls1'])
  assert.deepEqual(o.cards.fehler.list.map((x) => x.kind), ['lieferschein', 'tour', 'foto'])
  assert.equal(o.cards.fehler.onlyNotes, false)
  assert.deepEqual(o.cards.entwuerfe.list.map((x) => [x.doc.id, x.step]), [['r1', 'freigegeben'], ['r2', 'entwurf']])
  assert.equal(o.cards.entwuerfe.released, 1)
  // Heute: Touren des Tages mit Fortschritt, Ladeliste der freigegebenen
  assert.deepEqual(o.todayTours.map((x) => [x.tour.id, x.progress.done, x.progress.stops]), [['mt000000000002', 0, 1]])
  assert.deepEqual(o.load.map((r) => [r.size, r.qty]), [['85 × 150 cm', 2]])
  // übernehmen würde drei Einsätze ändern
  assert.equal(o.applied.length, 3)
})

test('Ohne Recht auf die Fakturierung fehlen Lieferscheine und Entwürfe; Fehler nur Touren und Fotos', () => {
  const { jobs, tours } = fixture()
  const o = overviewOf({ doc, jobs, tours, docs: null, tourErrors: [], today: TODAY, now: `${TODAY}T10:00:00.000Z` })
  assert.ok(!('unversendet' in o.cards) && !('entwuerfe' in o.cards))
  assert.deepEqual([o.cards.fehler.n, o.cards.fehler.partial, o.cards.fehler.list[0].kind], [1, true, 'foto'])
  // ein frisches Foto in der Warteschlange ist noch kein Fehler
  const o2 = overviewOf({ doc, jobs, tours, docs: null, today: TODAY, now: '2026-11-07T20:00:00.000Z' })
  assert.equal(o2.cards.fehler.n, 0)
  // nur Lieferscheine: „Öffnen“ führt direkt zum Filter „Ablage fehlgeschlagen“
  const o3 = overviewOf({ doc, jobs, tours: tours.slice(1), docs: fakDocs(), today: TODAY })
  assert.deepEqual([o3.cards.fehler.n, o3.cards.fehler.onlyNotes], [1, true])
})

test('Nicht durchgeführt: nachgeholt, eingeplant, ausgesetzt; offene Stopps einer abgeschlossenen Tour', () => {
  const { jobs, tours } = fixture()
  const st = (j, t = tours) => mattenStateOf({ doc, jobs: j, tours: t, today: TODAY })
  // Nachholen im Kalender eingeplant (übernommen, dann neuer Tag): bleibt in der Liste, aber „eingeplant“
  const applied = tourResults(jobs, tours)
  const merged = jobs.map((j) => applied.find((a) => a.key === j.key) || j)
  const planned = merged.map((j) => (j.key === 'p2:2026-11-05' ? { ...j, planned: '2026-11-12' } : j))
  assert.deepEqual(st(planned).notDone.map((x) => [x.placementId, x.planned]), [['p2', '2026-11-12'], ['p3', '']])
  // ausgesetzt bzw. verworfen: nicht mehr nachzuholen
  assert.deepEqual(st(merged.map((j) => (j.key === 'p3:2026-11-05' ? { ...j, status: 'verworfen' } : j))).notDone.map((x) => x.placementId), ['p2'])
  // später gewechselt (andere Tour): nachgeholt
  let t6 = tourOf('mt000000000006', '2026-11-07', 'freigegeben', [job('p3', '2026-11-05')])
  t6 = confirmPlacement(t6, 'st-o2', 'p3', at('2026-11-07', '08:00'))
  t6 = finishStop(t6, 'st-o2', { reason: 'niemand vor Ort', ...at('2026-11-07', '08:02') })
  const s = st(jobs, [...tours, t6])
  assert.deepEqual(s.notDone.map((x) => x.placementId), ['p2'])
  // abgeschlossene Tour mit offenem Stopp (nie bestätigt)
  const t7 = { ...tourOf('mt000000000007', '2026-11-04', 'abgeschlossen', [job('p6', '2026-11-02')]) }
  const list = notDoneList({ tours: [t7], jobs, done: [], today: TODAY })
  assert.deepEqual(list.map((x) => [x.key, x.reason, x.date]), [['p6:2026-11-02', 'nicht bestätigt', '2026-11-04']])
  // ohne gelesene Touren: wie bisher (Einsätze in Tour zählen als überfällig, nichts „nicht durchgeführt“)
  const raw = mattenStateOf({ doc, jobs, tours, today: TODAY, toursLoaded: false })
  assert.deepEqual([raw.notDone.length, raw.overdue.map((x) => x.placement.id).sort()], [0, ['p1', 'p2', 'p3', 'p5', 'p6']])
  // liegen gebliebene Touren vergangener Tage (freigegeben oder unterwegs)
  assert.deepEqual(staleTours(tours, TODAY).map((t) => t.id), ['mt000000000003'])
  assert.deepEqual(staleTours(tours, '2026-11-12').map((t) => t.id), ['mt000000000003', 'mt000000000002', 'mt000000000004'])
})

test('Kleine Woche: fällig, geplant, erledigt je Tag', () => {
  const { jobs, tours } = fixture()
  const w = weekOf(mattenStateOf({ doc, jobs, tours, today: TODAY }), tours, TODAY)
  assert.equal(w.monday, TODAY)
  assert.deepEqual(w.days.map((d) => [d.date.slice(8), d.faellig, d.geplant, d.erledigt]), [
    ['09', 2, 1, 0],
    ['10', 1, 1, 0],
    ['11', 0, 0, 0],
    ['12', 0, 0, 0],
    ['13', 0, 0, 0],
    ['14', 0, 0, 0],
    ['15', 0, 0, 0],
  ])
  // Mittwoch der Vorwoche als Stichtag: p1–p3 fällig am 5.11., einer erledigt
  const w2 = weekOf(mattenStateOf({ doc, jobs, tours, today: '2026-11-04' }), tours, '2026-11-04')
  const thu = w2.days.find((d) => d.date === '2026-11-05')
  assert.deepEqual([thu.faellig, thu.geplant, thu.erledigt], [3, 3, 1])
  // nachzuholen am Donnerstag: fällig, aber noch in keiner Tour dieses Tages (die alte Tour zählt nicht)
  const merged = jobs.map((j) => tourResults(jobs, tours).find((a) => a.key === j.key) || j).map((j) => (j.key === 'p2:2026-11-05' ? { ...j, planned: '2026-11-12' } : j))
  const w3 = weekOf(mattenStateOf({ doc, jobs: merged, tours, today: TODAY }), tours, TODAY)
  const d12 = w3.days.find((d) => d.date === '2026-11-12')
  assert.deepEqual([d12.faellig, d12.geplant, d12.erledigt], [1, 0, 0])
})

test('Kennzahlen: Soll/Ist, Pünktlichkeit mit Toleranz, nicht durchgeführt, Matten je Größe', () => {
  const { jobs, tours } = fixture()
  const state = mattenStateOf({ doc, jobs, tours, today: TODAY })
  const months = [
    { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
    { key: '2026-11', from: '2026-11-01', to: '2026-11-30' },
  ]
  const k = mattenKpi({ doc, state, tours, months })
  assert.deepEqual(k.months.map((m) => [m.key, m.soll, m.ist, m.erledigt, m.puenktlich, m.rate, m.nicht]), [
    ['2026-10', 0, 0, 0, 0, null, 0],
    ['2026-11', 7, 1, 1, 1, 1, 2],
  ])
  // zu spät gewechselt: pünktlich erst mit Toleranz
  const late = { ...state, jobs: state.jobs.map((j) => (j.key === 'p1:2026-11-05' ? { ...j, doneOn: '2026-11-07' } : j)) }
  assert.equal(mattenKpi({ doc, state: late, tours: [], months }).months[1].rate, 0)
  assert.equal(mattenKpi({ doc, state: late, tours: [], months, tolerance: 2 }).months[1].rate, 1)
  // Bestand je Größe an den aktiven Liegeplätzen, gewechselt im Zeitraum
  assert.deepEqual(k.sizes.map((s) => [s.size, s.qty, s.placements]), [['85 × 150 cm', 12, 6], ['60 × 90 cm', 4, 2]])
  assert.deepEqual(k.exchanged, [{ size: '85 × 150 cm', qty: 2 }])
})

test('Rechnungen aus dem Mattenwechsel: Entwürfe und festgeschriebene mit Storno', () => {
  const docs = fakDocs()
  assert.deepEqual(mattenDrafts(docs).map((x) => x.doc.id), ['r1', 'r2'])
  assert.deepEqual(mattenInvoices(docs).map((d) => d.id), ['r4', 's4'])
})

test('Rechte: Büro sieht die Übersicht ohne Zahlen der Fakturierung, Fahrer gar nicht', () => {
  const access = { planners: ['chef@example.com'] }
  const role = (id) => resolveAccess({ roleClaims: [id], access, strict: true })
  assert.deepEqual(overviewRights(role('mattenwechsel')), { view: true, fak: false, edit: true })
  assert.deepEqual(overviewRights(role('mattenfahrer')), { view: false, fak: false, edit: false })
  assert.deepEqual(overviewRights(role('buchhaltung')), { view: false, fak: false, edit: false })
  assert.deepEqual(overviewRights(resolveAccess({ email: 'chef@example.com', access, strict: true })), { view: true, fak: true, edit: true })
  assert.deepEqual(overviewRights(null), { view: true, fak: true, edit: true })
  const both = resolveAccess({ roleClaims: ['mwfak'], strict: true, access: { ...access, roles: { mwfak: { label: 'Büro mit Faktura', modules: ['matten', 'mattentour', 'fakturierung'], edit: ['matten', 'mattentour'] } } } })
  assert.deepEqual(overviewRights(both), { view: true, fak: true, edit: true })
})
