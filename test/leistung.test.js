// Leistung bei großen Datenmengen: die schnellen Wege müssen dasselbe liefern wie die bisherigen.
//  - core/invoicing.js withDocIndex: refsOf, isCancelled, billedBy, stateOf, openAmount, openItems über einen Index
//    (gleiche Belege in gleicher Reihenfolge wie die Suche durch alle Belege)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billedBy, isCancelled, openAmount, openItems, refsOf, stateOf, withDocIndex } from '../src/core/invoicing.js'

// erfundene Belege: Rechnungen mit Zahlungen, Stornos und Korrekturen (auch Entwürfe), Lieferscheine in Sammelrechnungen
// (auch stornierte und Entwürfe), Proforma mit Rechnung über refId, ein Beleg ohne id
function belege() {
  const docs = []
  let n = 0
  const inv = (extra) => docs.push({ id: `r${++n}`, kind: 'rechnung', number: `RE-2026-${String(n).padStart(4, '0')}`, date: '2026-03-02', dueDate: '2026-03-16', total: { net: 100, vat: 20, gross: 120 }, ...extra })
  for (let i = 0; i < 40; i++) inv(i % 5 === 0 ? { payments: [{ id: `p${i}`, date: '2026-03-10', amount: 120 }] } : i % 7 === 0 ? { payments: [{ id: `p${i}`, date: '2026-03-10', amount: 50 }] } : {})
  for (const [i, kind] of [[2, 'storno'], [3, 'korrektur'], [3, 'korrektur'], [8, 'storno']]) docs.push({ id: `k${++n}`, kind, number: `${kind === 'storno' ? 'ST' : 'KO'}-2026-${n}`, refId: `r${i}`, date: '2026-04-01', total: { net: -10, vat: -2, gross: -12 } })
  docs.push({ id: `k${++n}`, kind: 'storno', refId: 'r4', date: '2026-04-01' }) // Entwurf: zählt nicht
  const notes = []
  for (let i = 0; i < 30; i++) notes.push({ id: `ls${i}`, kind: 'lieferschein', number: `LS-2026-${String(i + 1).padStart(6, '0')}`, date: '2026-02-10' })
  docs.push(...notes)
  docs.push({ id: 'sr1', kind: 'rechnung', number: 'RE-2026-9001', date: '2026-03-03', total: { net: 50, vat: 10, gross: 60 }, deliveryNotes: notes.slice(0, 5).map((x) => ({ id: x.id, number: x.number })) })
  docs.push({ id: 'sr2', kind: 'rechnung', number: 'RE-2026-9002', date: '2026-03-03', total: { net: 50, vat: 10, gross: 60 }, deliveryNotes: notes.slice(5, 8).map((x) => ({ id: x.id })) })
  docs.push({ id: 'st-sr2', kind: 'storno', number: 'ST-2026-9', refId: 'sr2', date: '2026-03-05' }) // storniert: Lieferscheine wieder offen
  docs.push({ id: 'sr3', kind: 'rechnung', date: '2026-03-04', deliveryNotes: notes.slice(5, 7).map((x) => ({ id: x.id })) }) // Entwurf
  docs.push({ id: 'sr4', kind: 'rechnung', number: 'RE-2026-9004', date: '2026-03-04', refId: 'ls9', deliveryNotes: [{ id: 'ls9' }, { id: 'ls10' }] })
  docs.push({ id: 'pf1', kind: 'proforma', number: 'PF-2026-1', date: '2026-01-01' }, { id: 'rp1', kind: 'rechnung', number: 'RE-2026-9005', refId: 'pf1', date: '2026-01-05' })
  docs.push({ kind: 'rechnung', number: 'RE-2026-9006', date: '2026-01-05' }) // ohne id
  docs.push({ id: 'ls9', kind: 'lieferschein', number: 'LS-2026-DOPPELT', date: '2026-02-10' }) // gleiche id zweimal
  return docs
}

test('withDocIndex: refsOf, isCancelled, billedBy, stateOf, openAmount, openItems wie ohne Index', () => {
  const docs = belege()
  const settings = {}
  const today = '2026-04-20'
  const plain = docs.map((d) => ({ refs: refsOf(d, docs), cancelled: isCancelled(d, docs), billed: billedBy(d, docs), state: stateOf(d, docs, today, settings), open: openAmount(d, docs, settings) }))
  const items = openItems(docs, today, settings)
  const fast = withDocIndex(docs, () => docs.map((d) => ({ refs: refsOf(d, docs), cancelled: isCancelled(d, docs), billed: billedBy(d, docs), state: stateOf(d, docs, today, settings), open: openAmount(d, docs, settings) })))
  const fastItems = withDocIndex(docs, () => openItems(docs, today, settings))
  assert.equal(fast.length, plain.length)
  for (let i = 0; i < docs.length; i++) {
    assert.deepEqual(fast[i].refs, plain[i].refs, `refsOf ${docs[i].id}`)
    assert.ok(fast[i].refs.every((x, j) => x === plain[i].refs[j]), `refsOf ${docs[i].id}: dieselben Belege`)
    assert.equal(fast[i].cancelled, plain[i].cancelled, `isCancelled ${docs[i].id}`)
    assert.equal(fast[i].billed, plain[i].billed, `billedBy ${docs[i].id}`)
    assert.equal(fast[i].state, plain[i].state, `stateOf ${docs[i].id}`)
    assert.equal(fast[i].open, plain[i].open, `openAmount ${docs[i].id}`)
  }
  assert.deepEqual(fastItems, items)
  // Stichproben: die Fälle kommen in den Belegen wirklich vor
  const by = (id) => plain[docs.findIndex((d) => d.id === id)]
  assert.equal(by('r2').state, 'storniert')
  assert.equal(by('r3').refs.length, 2)
  assert.equal(by('ls0').billed?.id, 'sr1')
  assert.equal(by('ls5').billed?.id, 'sr3', 'Sammelrechnung storniert, der Entwurf hat ihn')
  assert.equal(by('ls5').state, 'offen', 'im Entwurf: noch nicht verrechnet')
  assert.equal(by('ls7').billed, null, 'Sammelrechnung storniert')
  assert.equal(by('ls9').billed?.id, 'sr4')
  assert.equal(by('pf1').state, 'verrechnet')
  assert.equal(by('ls20').state, 'offen')
})

test('withDocIndex: nur für dieselbe Liste und nur während fn; geschachtelt und nach einem Fehler wieder wie vorher', () => {
  const docs = belege()
  const other = [...docs, { id: 'st-x', kind: 'storno', number: 'ST-2026-77', refId: 'r10' }]
  withDocIndex(docs, () => {
    // andere Liste: ohne Index, sieht den neuen Storno
    assert.equal(isCancelled({ id: 'r10' }, other), true)
    assert.equal(isCancelled({ id: 'r10' }, docs), false)
    // geschachtelt mit neuer Liste, danach gilt wieder der äußere Index
    withDocIndex(other, () => assert.equal(isCancelled({ id: 'r10' }, other), true))
    assert.equal(isCancelled({ id: 'r10' }, docs), false)
  })
  assert.throws(() => withDocIndex(docs, () => { throw new Error('x') }), /x/)
  // nach fn: keine Kopie mehr – eine Änderung an der Liste zählt sofort
  docs.push({ id: 'st-y', kind: 'storno', number: 'ST-2026-78', refId: 'r11' })
  assert.equal(isCancelled({ id: 'r11' }, docs), true)
  // ungewöhnliche Daten (deliveryNotes kein Array): wie ohne Index
  const odd = [{ id: 'a', kind: 'lieferschein', number: 'LS-1' }, { id: 'b', kind: 'rechnung', number: 'RE-1', refId: 'a', deliveryNotes: 5 }]
  assert.equal(withDocIndex(odd, () => billedBy(odd[0], odd))?.id, 'b')
})

//  - core/matten-lieferschein.js noteRows: Lieferschein eines Stopps ohne source.key über einen Index der
//    Positionsschlüssel statt durch alle Belege (findNote)
test('noteRows: Lieferschein über die Positionen wie findNote über alle Belege', async () => {
  const { findNote, noteRows } = await import('../src/core/matten-lieferschein.js')
  const stop = (id, extra = {}) => ({ id, status: 'abgeschlossen', finishedAt: '2026-11-09T08:00:00.000Z', customer: { id: 'c1', name: 'Kunde' }, items: [{ placementId: 'p1', status: 'gewechselt', planned: 2, actual: 2 }], ...extra })
  const tours = [
    { id: 'mt1', date: '2026-11-09', status: 'abgeschlossen', stops: [stop('st-a'), stop('st-b'), stop('st-c'), stop('st-d'), stop('st-e')] },
    { id: 'mt1:st', date: '2026-11-09', status: 'abgeschlossen', stops: [stop('a')] }, // Doppelpunkt in der ID
  ]
  const line = (key) => ({ text: 'Matte', qty: 1, price: 1, source: { type: 'matten', key } })
  const docs = [
    // nur über die Positionen (ohne source.key), zwei Belege für st-a: der festgeschriebene gewinnt
    { id: 'n1', kind: 'lieferschein', lines: [line('mt1:st-a:p1:x')] },
    { id: 'n2', kind: 'lieferschein', number: 'LS-2026-000002', lines: [line('mt1:st-a:p1:y'), line('mt1:st-a:p2:y')] },
    // über source.key (notesByKey) – die Positionen eines anderen Belegs zählen dann nicht
    { id: 'n3', kind: 'lieferschein', number: 'LS-2026-000003', source: { type: 'matten', key: 'matten:mt1:st-b' }, lines: [] },
    { id: 'n4', kind: 'lieferschein', number: 'LS-2026-000001', lines: [line('mt1:st-b:p1:x')] },
    // Anfang, der kein ganzer Stopp ist (st-c gegen st-cc), andere Quelle, Rechnung mit derselben Position
    { id: 'n5', kind: 'lieferschein', number: 'LS-2026-000005', lines: [line('mt1:st-cc:p1:x'), { text: 'x', source: { type: 'einkauf', key: 'mt1:st-c:p1' } }] },
    { id: 'r1', kind: 'rechnung', number: 'RE-2026-0001', lines: [line('mt1:st-d:p1:x')] },
    { id: 'n6', kind: 'lieferschein', number: 'LS-2026-000006', lines: [line('mt1:st:a:p1:x')] }, // Tour „mt1:st“, Stopp „a“
    { id: 'n7', kind: 'lieferschein', number: 'LS-2026-000007', lines: [line('mt1:st-e')] }, // ohne Doppelpunkt am Ende
  ]
  const rows = noteRows({ tours, docs })
  assert.equal(rows.length, 6)
  for (const r of rows) {
    const ref = docs.find((d) => d.source?.key === `matten:${r.tour.id}:${r.stop.id}`) || findNote(docs, r.tour.id, r.stop.id)
    assert.equal(r.doc, ref, `${r.tour.id}/${r.stop.id}`)
  }
  const of = (t, s) => rows.find((r) => r.tour.id === t && r.stop.id === s).doc?.id || null
  assert.deepEqual([of('mt1', 'st-a'), of('mt1', 'st-b'), of('mt1', 'st-c'), of('mt1', 'st-d'), of('mt1', 'st-e'), of('mt1:st', 'a')], ['n2', 'n3', null, null, null, 'n6'])
  // kaputte Daten (Position null): wie bisher über alle Belege, also derselbe Fehler wie findNote
  const odd = [{ id: 'n8', kind: 'lieferschein', number: 'LS-1', lines: [line('mt1:st-a:p1:x'), null] }]
  assert.throws(() => findNote(odd, 'mt1', 'st-b'), TypeError)
  assert.throws(() => noteRows({ tours: tours.slice(0, 1), docs: odd }), TypeError)
})

// Mattenwechsel mit vielen Touren und Einsätzen (erfunden, gleichbleibender Zufall): die schnellen Wege gegen die
// bisherige Rechnung (jede Tour bzw. alle Einsätze je Liegeplatz) – tourResults, notDoneList, attention, placementRows,
// TourStore.pathOf
async function mattenDaten() {
  const { stopsFromJobs } = await import('../src/core/matten-tour.js')
  const { confirmPlacement, finishStop, markNotPossible, setQuantity, startTour } = await import('../src/core/matten-fahrt.js')
  const { planJobs } = await import('../src/core/matten-einsaetze.js')
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
  const today = '2026-11-09'
  const objects = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, name: `Objekt ${i}`, address: `Gasse ${i}`, lat: 47.8, lon: 13 + i / 100 }))
  const mat = { articleId: 'a1', name: 'Matte', size: '85 × 150 cm', color: 'grau' }
  const placements = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, objectId: `o${i % 12}`, customerId: `c${i % 5}`, customer: { id: `c${i % 5}`, name: `Kunde ${i % 5}` }, name: `Platz ${i}`, active: i !== 7, mats: [{ ...mat, qty: 1 + (i % 3), owner: 'wir' }], intervalDays: [7, 14, 28][i % 3], startDate: addDays('2026-08-03', i % 5), rule: i % 6 === 0 ? 'ab-ist' : 'rhythmus' }))
  const doc = { settings: {}, placements, areas: [] }
  let { jobs } = planJobs({ doc, von: '2026-08-03', bis: addDays(today, 20), now: 'x', by: 't' })
  const tours = []
  let n = 0
  for (let d = '2026-08-03'; d <= addDays(today, 5); d = addDays(d, 1)) {
    const day = jobs.filter((j) => j.due === d && j.status === 'geplant')
    if (!day.length) continue
    const stops = stopsFromJobs({ jobs: day, placements, objects, date: d, overdue: false })
    let tour = { id: `mt${String(++n).padStart(12, '0')}`, date: d, status: rnd() < 0.1 ? 'entwurf' : 'freigegeben', driverName: 'Fahrer', order: stops.map((s) => s.id).reverse(), stops }
    if (d <= today && tour.status !== 'entwurf') {
      tour = startTour(tour, { now: `${d}T06:00:00.000Z` })
      for (const s of stops) {
        const r = rnd()
        if (d === today && r < 0.5) continue // offen geblieben
        const opts = { now: `${d}T08:00:00.000Z`, by: 'Fahrer' }
        for (const p of [...new Set(s.items.map((it) => it.placementId))]) tour = r < 0.15 ? markNotPossible(tour, s.id, p, 'kein Zugang', opts) : confirmPlacement(tour, s.id, p, opts)
        if (r > 0.9) tour = setQuantity(tour, s.id, 0, 0, opts)
        if (rnd() < 0.9 || d === today) tour = finishStop(tour, s.id, { reason: 'niemand vor Ort', ...opts })
      }
      if (rnd() < 0.1) tour = { ...tour, status: 'abgeschlossen' } // abgeschlossen mit offenem Stopp
    }
    tours.push(tour)
    const inTour = new Set(stops.flatMap((s) => s.items.map((it) => it.jobKey)))
    if (tour.status !== 'entwurf') jobs = jobs.map((j) => (inTour.has(j.key) && rnd() < 0.8 ? { ...j, status: 'in-tour', tourId: rnd() < 0.9 ? tour.id : '' } : j))
  }
  return { today, doc, placements, objects, jobs, tours }
}

test('Mattenwechsel: tourResults, notDoneList, attention, placementRows wie über alle Touren bzw. Einsätze', async () => {
  const { today, doc, placements, objects, jobs, tours } = await mattenDaten()
  const { jobUpdatesFromTour, doneFromTours } = await import('../src/core/matten-fahrt.js')
  const { markDone, markNotDone, nextDue } = await import('../src/core/matten-plan.js')
  const { attention, withId, mergeJobs } = await import('../src/core/matten-einsaetze.js')
  const { notDoneList, tourResults, doneOf } = await import('../src/core/matten-uebersicht.js')
  const { placementRows, nextOf } = await import('../src/core/matten.js')
  assert.ok(tours.length > 40 && jobs.some((j) => j.status === 'in-tour'))
  // tourResults: bisherige Schleife über jede Tour
  const byKey = new Map(jobs.map((j) => [j?.key, j]))
  const ref = new Map()
  for (const tour of tours) {
    if (!tour?.id || tour.status === 'entwurf') continue
    for (const u of jobUpdatesFromTour(tour)) {
      const job = byKey.get(u.key)
      if (!job || job.status !== 'in-tour' || ref.has(u.key)) continue
      if (job.tourId && job.tourId !== u.tourId) continue
      const next = u.status === 'nachzuholen' ? markNotDone(job, { reason: u.reason || '', now: 'n', by: 'b' }) : markDone(job, u.date, { partial: u.status === 'teilweise', now: 'n', by: 'b' })
      ref.set(u.key, withId({ ...next, tourId: job.tourId || u.tourId }))
    }
  }
  const got = tourResults(jobs, tours, { now: 'n', by: 'b' })
  assert.ok(ref.size > 5)
  assert.deepEqual(got, [...ref.values()])
  // notDoneList: nur Fälle aus jobUpdatesFromTour bzw. offene Stopps abgeschlossener Touren, alle davon
  const eff = mergeJobs(jobs, got)
  const done = doneOf(placements, tours)
  const list = notDoneList({ tours, jobs: eff, done, today })
  const failed = new Set()
  for (const tour of tours) if (tour.status !== 'entwurf') for (const u of jobUpdatesFromTour(tour)) if (u.status === 'nachzuholen' && !u.also) failed.add(u.key)
  assert.ok(list.length > 0 && list.every((x) => failed.has(x.key) || x.reason === 'nicht bestätigt'))
  const lastDone = new Map()
  for (const d of done) if (String(d.date) > (lastDone.get(d.placementId) || '')) lastDone.set(d.placementId, d.date)
  const ended = ['erledigt', 'teilweise', 'ausgesetzt', 'verworfen']
  const effByKey = new Map(eff.map((j) => [j.key, j]))
  for (const tour of tours) {
    if (tour.status === 'entwurf') continue
    for (const u of jobUpdatesFromTour(tour)) {
      if (u.status !== 'nachzuholen' || u.also || ended.includes(effByKey.get(u.key)?.status) || (lastDone.get(u.placementId) || '') >= u.date) continue
      assert.ok(list.some((x) => x.key === u.key), `fehlt: ${u.key}`)
    }
  }
  // attention: überfällige wie mit nextDue über alle Einsätze
  const att = attention({ doc, jobs: eff, done, today })
  const refOver = placements.map((p) => ({ p, next: p.active === false ? null : nextDue(p, { done, jobs: eff, closures: [], today }) })).filter((x) => x.next?.overdue)
  assert.ok(refOver.length > 0)
  assert.deepEqual(att.overdue.map((x) => [x.placement.id, x.next]).sort(), refOver.map((x) => [x.p.id, x.next]).sort())
  // placementRows: nächster Wechsel wie nextOf mit allen Einsätzen
  const rows = placementRows({ doc, objects, today, done: doneFromTours(tours), jobs: eff })
  for (const r of rows) assert.deepEqual(r.next, nextOf(r.placement, { today, done: doneFromTours(tours), jobs: eff }).next, r.placement.id)
})

test('TourStore.pathOf: erster Pfad je Tour, auch nach Änderungen der Listen', async () => {
  const { TourStore } = await import('../src/storage/matten-touren.js')
  const s = new TourStore({ store: { read: async () => null } })
  const t = (id) => ({ data: { id }, etag: 'e' })
  s.docs.set('matten/touren/2026/a.json', t('a'))
  s.docs.set('matten/touren/2026/b.json', t('b'))
  assert.equal(s.pathOf('a'), 'matten/touren/2026/a.json')
  assert.equal(s.pathOf('x'), '')
  // gleiche ID unter zwei Pfaden: der erste (Stand der Ablage vor nur Ungespeichertem) gewinnt, wie bisher
  s.pending.set('matten/touren/2027/a.json', { doc: { id: 'a' } })
  assert.equal(s.pathOf('a'), 'matten/touren/2026/a.json')
  s.docs.delete('matten/touren/2026/a.json')
  assert.equal(s.pathOf('a'), 'matten/touren/2027/a.json')
  s.pending.set('matten/touren/2026/c.json', { doc: { id: 'c' } })
  assert.equal(s.byId('c')?.id, 'c')
  assert.equal(s.isPending('c'), true)
  s.pending.clear()
  assert.equal(s.pathOf('c'), '')
  assert.equal(s.isPending('a'), false)
})
