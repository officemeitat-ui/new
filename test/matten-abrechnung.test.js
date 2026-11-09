// Mattenwechsel P14: Rechnungsentwürfe aus den Lieferscheinen (core/matten-abrechnung.js) – Einzel/Sammel, Monat/Quartal,
// Kundenpreise aus den Lieferscheinen (nicht neu gerechnet), Pauschale je Liegeplatz/Objekt/Kunde, teilweise Wechsel,
// doppelte Entwürfe verhindert, Storno gibt frei, „Preis fehlt“ blockiert, Mischfall Pauschale/Stück, Prüfen → Freigeben,
// Korrekturen im Verlauf. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess } from '../src/core/access.js'
import { checksumOf, collectDraft, finalize, intact, problems, stateOf, stornoDraft, totals } from '../src/core/invoicing.js'
import {
  billingIndex,
  billingText,
  createDrafts,
  draftChanges,
  flatBillState,
  flatKey,
  markChecked,
  markReleased,
  mattenConflicts,
  monthEnd,
  namesFromNotes,
  needsReview,
  noteBillState,
  periodFor,
  planRun,
  prevMonth,
  quarterMonths,
  reviewStep,
  runRights,
  runTask,
  trackChanges,
  undoReview,
} from '../src/core/matten-abrechnung.js'
import { finalizeBatch } from '../src/core/fak-laeufe.js'

const TODAY = '2026-11-09'
const NOW = '2026-11-09T08:00:00.000Z'
const SETTINGS = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Beispielgasse 1\n5020 Salzburg', uid: 'ATU00000000' }, vat: 20, numberDigits: { lieferschein: 6 } }

/** Fakturierung (erfunden): vier Kunden mit unterschiedlicher Abrechnung, zwei Mattentypen, ein Kundenpreis. */
function fak() {
  return {
    settings: structuredClone(SETTINGS),
    customers: [
      { id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', street: 'Ringstraße 3', zip: '5020', city: 'Salzburg', email: 'buchhaltung@hv.example', discount: 5, matten: { billing: 'sammel', billingInterval: 'monat', priceModel: 'wechsel' } },
      { id: 'c2', customerNo: '10002', name: 'Autohaus Muster KG', street: 'Autoweg 7', zip: '5020', city: 'Salzburg', email: 'rechnung@autohaus.example', matten: { billing: 'einzel', billingInterval: 'monat', priceModel: 'wechsel' } },
      { id: 'c3', customerNo: '10003', name: 'Bürohaus Nord Beispiel', street: 'Nordweg 4', zip: '5020', city: 'Salzburg', email: 'office@nord.example', matten: { priceModel: 'pauschale', monthlyFlat: [{ objectId: 'o3', placementId: 'p-foyer', amount: 39, vat: 20 }, { objectId: 'o4', amount: 25, vat: 20 }, { amount: 10, vat: 20 }] } },
      { id: 'c4', customerNo: '10004', name: 'Praxis Süd Beispiel', street: 'Südweg 9', zip: '5020', city: 'Salzburg', email: 'praxis@sued.example', matten: { billing: 'sammel', billingInterval: 'quartal', priceModel: 'wechsel' } },
      { id: 'c5', name: 'Café ohne Nummer', street: 'Platz 1', zip: '5020', city: 'Salzburg', matten: { priceModel: 'pauschale', billingInterval: 'quartal', monthlyFlat: [{ amount: 30, vat: 20 }] } },
    ],
    articles: [
      { id: 'a-m1', articleNo: 'MA-01', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', unit: 'Stk', price: 4.9, vat: 20 },
      { id: 'a-m2', articleNo: 'MA-02', group: 'Matten', name: 'Schmutzfangmatte 150 × 250 cm anthrazit', size: '150 × 250 cm', color: 'anthrazit', unit: 'Stk', price: 8.5, vat: 20 },
    ],
    customerPrices: [{ id: 'kp1', customerId: 'c1', articleId: 'a-m1', price: 4.4, vat: 20, validFrom: '2026-01-01', validTo: '' }],
    documents: [],
    paymentTerms: [],
    textBlocks: [],
  }
}

const OBJ = { o1: 'Wohnanlage Beispielweg', o2: 'Autohaus Schauraum', o3: 'Bürohaus Nord', o4: 'Bürohaus Nord Garage', o5: 'Praxis Süd', o6: 'Café am Platz' }
let seq = 0
/**
 * Lieferschein wie aus dem Mattenwechsel (core/matten-lieferschein.js): je Liegeplatz ein Titel, darunter je Mattentyp
 * eine Position mit Ist-Menge und eingefrorenem Preis; festgeschrieben im Nummernkreis LS. items: [{ place, name, article,
 * qty, planned?, price, src }].
 */
function addNote(d, { customerId, date, objectId, items }) {
  const c = d.customers.find((x) => x.id === customerId)
  const tour = `mt${String(++seq).padStart(12, '0')}`
  const stop = `st-${objectId}`
  const lines = []
  let n = 0
  for (const it of items) {
    lines.push({ id: `${stop}-${++n}`, type: 'title', text: `Liegeplatz ${it.name}` })
    lines.push({ id: `${stop}-${++n}`, type: 'item', text: d.articles.find((a) => a.id === it.article)?.name || 'Matte', articleId: it.article, qty: it.qty, unit: 'Stk', price: it.price, vat: 20, discount: it.discount || 0, source: { type: 'matten', key: `${tour}:${stop}:${it.place}:${it.article}`, placementId: it.place, articleId: it.article, tourId: tour, stopId: stop, price: it.src || 'kunde' } })
    if (it.planned > it.qty) lines.push({ id: `${stop}-${++n}`, type: 'text', text: `Nicht gewechselt: ${it.planned - it.qty} × Matte – kein Zugang` })
  }
  const draft = {
    id: `ls-${seq}`,
    kind: 'lieferschein',
    status: 'entwurf',
    date,
    serviceFrom: date,
    customerId,
    objectId,
    objectName: OBJ[objectId],
    recipient: c ? { name: c.name, address: `${c.street}\n${c.zip} ${c.city}`, customerNo: c.customerNo || '' } : { name: 'Unbekannt GmbH', address: 'Irgendwo 1\n5020 Salzburg' },
    deliveryAddress: `${OBJ[objectId]}, 5020 Salzburg`,
    hidePrices: true,
    title: `Mattenwechsel ${OBJ[objectId]}`,
    lines,
    source: { type: 'matten', key: `matten:${tour}:${stop}`, tourId: tour, stopId: stop },
  }
  const fixed = finalize(draft, d.documents, d.settings, { now: `${date}T10:00:00.000Z`, by: 'Büro' })
  d.documents.push(fixed)
  return fixed
}

let ids = 0
const newId = () => `re-${++ids}`
const run = (d, ym, extra = {}) => planRun(d, { ym, today: TODAY, now: NOW, by: 'Petra Leitner', ...extra })
const create = (d, ym, extra = {}) => {
  const r = createDrafts(d, { ym, today: TODAY, newId, now: NOW, by: 'Petra Leitner', ...extra })
  d.documents.push(...r.drafts)
  return r
}
const planOf = (r, cid) => r.plans.find((p) => p.customerId === cid)
const release = (doc) => markReleased(markChecked(doc, { at: NOW, by: 'Petra Leitner' }), { at: NOW, by: 'Petra Leitner' })
/** Entwurf freigeben und festschreiben (wie in der Fakturierung: vorher mattenConflicts). */
function issue(d, id) {
  const i = d.documents.findIndex((x) => x.id === id)
  const x = needsReview(d.documents[i]) ? release(d.documents[i]) : d.documents[i]
  assert.deepEqual(mattenConflicts(x, d.documents), [], 'keine Meldung vor dem Festschreiben')
  d.documents[i] = finalize(x, d.documents, d.settings, { now: NOW, by: 'Petra Leitner' })
  return d.documents[i]
}

// ---------------------------------------------------------------- Zeitraum

test('Zeitraum: Vormonat, Monatsende, Quartal je Kunde (abgerechnet mit dem letzten Quartalsmonat)', () => {
  assert.equal(prevMonth('2026-11-09'), '2026-10')
  assert.equal(prevMonth('2027-01-01'), '2026-12')
  assert.equal(monthEnd('2028-02'), '2028-02-29')
  assert.deepEqual(quarterMonths('2026-11'), ['2026-10', '2026-11', '2026-12'])
  const m = periodFor('monat', '2026-10')
  assert.deepEqual([m.from, m.to, m.label, m.complete], ['2026-10-01', '2026-10-31', 'Oktober 2026', true])
  const q = periodFor('quartal', '2026-11')
  assert.deepEqual([q.from, q.to, q.label, q.complete, q.billMonth], ['2026-10-01', '2026-12-31', '4. Quartal 2026', false, '2026-12'])
  assert.equal(periodFor('quartal', '2026-12').complete, true)
})

// ---------------------------------------------------------------- Je gewechselter Matte

test('Sammelrechnung monatlich: offene Lieferscheine des Kunden im Zeitraum, eingefrorene Preise, Leistungszeitraum, deliveryNotes', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 2, price: 4.4 }, { place: 'p-st2', name: 'Stiege 2', article: 'a-m2', qty: 1, price: 8.5, src: 'standard' }] })
  const b = addNote(d, { customerId: 'c1', date: '2026-10-19', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 2, price: 4.4 }] })
  const nov = addNote(d, { customerId: 'c1', date: '2026-11-02', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 2, price: 4.4 }] })
  // später geänderter Kundenpreis: die Rechnung nimmt den Preis aus dem Lieferschein, nicht neu gerechnet
  d.customerPrices[0].price = 9.99
  const r = run(d, '2026-10')
  const p = planOf(r, 'c1')
  assert.equal(p.model, 'wechsel')
  assert.equal(billingText(p), 'je gewechselter Matte · Sammelrechnung · monatlich')
  assert.deepEqual(p.notes.map((n) => n.id), [a.id, b.id], 'November-Lieferschein nicht dabei')
  assert.equal(p.drafts.length, 1)
  assert.equal(p.net, 2 * 4.4 + 8.5 + 2 * 4.4)
  const { drafts } = create(d, '2026-10')
  const x = drafts.find((y) => y.customerId === 'c1')
  assert.equal(x.kind, 'rechnung')
  assert.equal(x.status, 'entwurf')
  assert.equal(x.number, undefined, 'nie festgeschrieben')
  assert.deepEqual(x.deliveryNotes.map((n) => n.number), [a.number, b.number])
  assert.deepEqual([x.serviceFrom, x.serviceTo], ['2026-10-05', '2026-10-19'])
  assert.equal(x.title, 'Mattenwechsel Oktober 2026')
  assert.equal(x.discount, 0, 'kein Kundenrabatt auf alles (Kundenpreise)')
  assert.equal(x.recipient.name, 'Hausverwaltung Beispiel GmbH')
  assert.equal(x.source.type, 'matten-abrechnung')
  assert.deepEqual(x.source.notes, [a.id, b.id])
  assert.deepEqual(x.lines.filter((l) => l.type === 'item').map((l) => l.price), [4.4, 8.5, 4.4])
  assert.ok(x.lines.every((l) => l.type !== 'item' || l.source?.type === 'matten'), 'Positionen mit Bezug auf die Lieferscheinposition')
  assert.ok(x.lines.some((l) => l.type === 'title' && l.text.startsWith(`Lieferschein ${a.number}`)))
  assert.equal(totals(x, d.settings).net, 26.1)
  assert.deepEqual(problems(x, d.settings).filter((q) => q.level === 'error'), [])
  assert.equal(noteBillState(a, d.documents).state, 'entwurf')
  assert.equal(noteBillState(nov, d.documents).state, 'offen')
  assert.ok(needsReview(x) && reviewStep(x) === 'entwurf')
})

test('Einzelrechnung: ein Entwurf je Lieferschein (Bezug refId), Standardpreis mit Kundenrabatt aus dem Lieferschein', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c2', date: '2026-10-07', objectId: 'o2', items: [{ place: 'p-schau', name: 'Schauraum', article: 'a-m2', qty: 2, price: 8.5, discount: 3, src: 'standard' }] })
  const b = addNote(d, { customerId: 'c2', date: '2026-10-21', objectId: 'o2', items: [{ place: 'p-schau', name: 'Schauraum', article: 'a-m2', qty: 2, price: 8.5, discount: 3, src: 'standard' }] })
  const r = run(d, '2026-10')
  assert.equal(planOf(r, 'c2').drafts.length, 2)
  const { drafts } = create(d, '2026-10')
  assert.deepEqual(drafts.map((x) => x.refId), [a.id, b.id])
  assert.deepEqual(drafts.map((x) => x.deliveryNotes.length), [1, 1])
  assert.equal(drafts[0].title, 'Mattenwechsel Autohaus Schauraum am 07.10.2026')
  assert.equal(drafts[0].lines.find((l) => l.type === 'item').discount, 3, 'Rabatt der Lieferscheinposition bleibt')
  assert.equal(totals(drafts[0], d.settings).net, 16.49)
  assert.equal(drafts[0].deliveryAddress, 'Autohaus Schauraum, 5020 Salzburg')
})

test('Unterschiedliche Kundenpreise und teilweiser Wechsel: Preise und Mengen wie im Lieferschein, nicht Gewechseltes als Text', () => {
  const d = fak()
  addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 1, planned: 2, price: 4.4 }] })
  addNote(d, { customerId: 'c2', date: '2026-10-06', objectId: 'o2', items: [{ place: 'p-werk', name: 'Werkstatt', article: 'a-m1', qty: 3, price: 4.9, src: 'standard' }] })
  const { drafts } = create(d, '2026-10')
  const hv = drafts.find((x) => x.customerId === 'c1')
  const ah = drafts.find((x) => x.customerId === 'c2')
  assert.equal(hv.lines.find((l) => l.type === 'item').price, 4.4)
  assert.equal(hv.lines.find((l) => l.type === 'item').qty, 1)
  assert.ok(hv.lines.some((l) => l.type === 'text' && /Nicht gewechselt: 1 ×/.test(l.text)))
  assert.equal(totals(hv, d.settings).net, 4.4)
  assert.equal(ah.lines.find((l) => l.type === 'item').price, 4.9)
  assert.equal(totals(ah, d.settings).net, 14.7)
})

test('Quartal: im laufenden Quartal nichts (Hinweis), mit dem Lauf des letzten Monats eine Sammelrechnung über das Quartal', () => {
  const d = fak()
  addNote(d, { customerId: 'c4', date: '2026-10-12', objectId: 'o5', items: [{ place: 'p-praxis', name: 'Eingang', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  addNote(d, { customerId: 'c4', date: '2026-12-01', objectId: 'o5', items: [{ place: 'p-praxis', name: 'Eingang', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  const oct = planOf(run(d, '2026-10'), 'c4')
  assert.equal(oct.drafts.length, 0)
  assert.equal(oct.pending.length, 2, 'beide im 4. Quartal')
  // ein offener Lieferschein aus dem 3. Quartal: Hinweis auf den Lauf für September
  addNote(d, { customerId: 'c4', date: '2026-08-20', objectId: 'o5', items: [{ place: 'p-praxis', name: 'Eingang', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  assert.ok(planOf(run(d, '2026-11'), 'c4').hints.some((h) => h.level === 'warn' && /aus einem früheren Quartal: Lauf für September 2026 wählen/.test(h.text)))
  assert.equal(planOf(run(d, '2026-09'), 'c4').drafts[0].notes.length, 1, 'Lauf für September: 3. Quartal')
  d.documents = d.documents.filter((x) => x.date !== '2026-08-20')
  assert.ok(oct.hints.some((h) => /Quartalsweise: abgerechnet mit dem Lauf für Dezember 2026/.test(h.text)))
  assert.equal(create(d, '2026-10').drafts.filter((x) => x.customerId === 'c4').length, 0)
  const dec = planOf(run(d, '2026-12'), 'c4')
  assert.equal(dec.period.label, '4. Quartal 2026')
  assert.equal(dec.drafts.length, 1)
  assert.equal(dec.drafts[0].notes.length, 2)
  const x = create(d, '2026-12').drafts.find((y) => y.customerId === 'c4')
  assert.equal(x.title, 'Mattenwechsel 4. Quartal 2026')
  assert.deepEqual([x.serviceFrom, x.serviceTo], ['2026-10-12', '2026-12-01'])
})

test('Ältere offene Lieferscheine: Vorgabe mit dabei (Hinweis), sonst mit Warnung draußen', () => {
  const d = fak()
  addNote(d, { customerId: 'c1', date: '2026-09-29', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 2, price: 4.4 }] })
  addNote(d, { customerId: 'c1', date: '2026-10-13', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang (EG)', article: 'a-m1', qty: 2, price: 4.4 }] })
  const withOld = planOf(run(d, '2026-10'), 'c1')
  assert.equal(withOld.drafts[0].notes.length, 2)
  assert.ok(withOld.hints.some((h) => h.level === 'info' && /aus früheren Monaten \(September 2026\) mit dabei/.test(h.text)))
  const without = planOf(run(d, '2026-10', { includeOlder: false }), 'c1')
  assert.equal(without.drafts[0].notes.length, 1)
  assert.ok(without.hints.some((h) => h.level === 'warn' && /vor dem Zeitraum \(September 2026\) nicht dabei/.test(h.text)))
})

// ---------------------------------------------------------------- Pauschale

test('Pauschale je Liegeplatz, Objekt und Kunde: eine Position je Monat und Pauschale, Lieferscheine als Nachweis ohne Stückpreise', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer (EG)', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }, { place: 'p-lift', name: 'Lift', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  const b = addNote(d, { customerId: 'c3', date: '2026-10-22', objectId: 'o4', items: [{ place: 'p-garage', name: 'Garage', article: 'a-m2', qty: 1, price: 8.5, src: 'standard' }] })
  const p = planOf(run(d, '2026-10'), 'c3')
  assert.equal(p.model, 'pauschale')
  assert.deepEqual(p.months, ['2026-10'])
  assert.equal(p.net, 74)
  const x = create(d, '2026-10').drafts.find((y) => y.customerId === 'c3')
  const items = x.lines.filter((l) => l.type === 'item')
  assert.deepEqual(items.map((l) => [l.price, l.unit, l.source.key, l.source.scope]), [
    [39, 'Monat', 'matten-pauschale:c3:2026-10', 'liegeplatz'],
    [25, 'Monat', 'matten-pauschale:c3:2026-10', 'objekt'],
    [10, 'Monat', 'matten-pauschale:c3:2026-10', 'kunde'],
  ])
  assert.deepEqual(items.map((l) => l.text), ['Mattenwechsel Pauschale: Liegeplatz Foyer (EG), Bürohaus Nord', 'Mattenwechsel Pauschale: Bürohaus Nord Garage (alle Liegeplätze)', 'Mattenwechsel Pauschale: alle Liegeplätze'])
  assert.ok(!x.lines.some((l) => l.source?.type === 'matten'), 'keine Stückpreise')
  assert.deepEqual(x.deliveryNotes.map((n) => n.id), [a.id, b.id], 'Nachweis: Lieferscheine gelten als verrechnet')
  assert.ok(x.lines.some((l) => l.type === 'text' && l.text === `${a.number} vom 08.10.2026, Bürohaus Nord: 3 Matten gewechselt`))
  assert.deepEqual([x.serviceFrom, x.serviceTo, x.title], ['2026-10-01', '2026-10-31', 'Mattenwechsel Oktober 2026 (Pauschale)'])
  assert.equal(totals(x, d.settings).net, 74)
  assert.equal(flatBillState('c3', '2026-10', d.documents).state, 'entwurf')
  assert.equal(noteBillState(a, d.documents).state, 'entwurf')
})

test('Pauschale quartalsweise: drei Monatspositionen ab dem ersten Lieferschein, ein Monat je Kunde nur einmal', () => {
  const d = fak()
  addNote(d, { customerId: 'c5', date: '2026-11-04', objectId: 'o6', items: [{ place: 'p-cafe', name: 'Eingang', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  assert.equal(planOf(run(d, '2026-11'), 'c5').drafts.length, 0, 'Quartal läuft noch')
  const p = planOf(run(d, '2026-12'), 'c5')
  assert.deepEqual(p.months, ['2026-11', '2026-12'], 'Oktober vor dem ersten Wechsel nicht')
  assert.ok(p.hints.some((h) => h.level === 'warn' && h.text === 'Kunde ohne Kundennummer.'))
  const x = create(d, '2026-12').drafts.find((y) => y.customerId === 'c5')
  assert.deepEqual(x.lines.filter((l) => l.type === 'item').map((l) => [l.text, l.longText, l.price]), [
    ['Mattenwechsel Pauschale November 2026', 'alle Liegeplätze', 30],
    ['Mattenwechsel Pauschale Dezember 2026', 'alle Liegeplätze', 30],
  ])
  assert.equal(x.title, 'Mattenwechsel 4. Quartal 2026 (Pauschale)')
  // zweiter Lauf: nichts mehr, die Monate stehen schon im Entwurf
  assert.equal(create(d, '2026-12').drafts.length, 0)
  const again = run(d, '2026-12')
  assert.ok(again.done.some((q) => q.customerId === 'c5' && q.billed.some((b) => b.text === 'Pauschale November 2026')))
})

test('Pauschale ohne Betrag: blockiert mit Hinweis', () => {
  const d = fak()
  d.customers.find((c) => c.id === 'c3').matten.monthlyFlat = []
  addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  const p = planOf(run(d, '2026-10'), 'c3')
  assert.equal(p.ready, 0)
  assert.ok(p.hints.some((h) => h.level === 'error' && /keine Pauschale eingetragen/.test(h.text)))
  const r = create(d, '2026-10')
  assert.equal(r.drafts.length, 0)
  assert.match(r.skipped[0].reason, /keine Pauschale/)
})

// ---------------------------------------------------------------- Doppelabrechnung

test('Doppelte Entwürfe verhindert: zweiter Lauf erzeugt nichts, festgeschrieben bleibt verrechnet', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  const first = create(d, '2026-10')
  assert.equal(first.drafts.length, 2)
  const second = create(d, '2026-10')
  assert.deepEqual([second.drafts.length, run(d, '2026-10').todo.length], [0, 0])
  // festschreiben (geprüft und freigegeben), dann verrechnet
  const fixed = first.drafts.map((x) => issue(d, x.id))
  assert.ok(fixed.every((x) => /^RE-2026-/.test(x.number) && intact(x)))
  assert.equal(stateOf(a, d.documents, TODAY, d.settings), 'verrechnet')
  assert.equal(noteBillState(a, d.documents).state, 'verrechnet')
  assert.equal(create(d, '2026-10').drafts.length, 0)
  assert.equal(run(d, '2026-10').done.length, 2)
})

test('Storno gibt frei, Entwurf löschen gibt frei', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  const made = create(d, '2026-10').drafts
  const x1 = made.find((x) => x.customerId === 'c1')
  const x3 = made.find((x) => x.customerId === 'c3')
  // Entwurf löschen → wieder offen
  d.documents = d.documents.filter((x) => x.id !== x1.id)
  assert.equal(noteBillState(a, d.documents).state, 'offen')
  const again = create(d, '2026-10').drafts
  assert.equal(again.length, 1)
  // festschreiben und stornieren → Lieferschein und Pauschal-Monat wieder offen
  const inv1 = issue(d, again[0].id)
  const inv3 = issue(d, x3.id)
  for (const inv of [inv1, inv3]) {
    const st = finalize(stornoDraft(inv, { id: newId(), date: TODAY, reason: 'falscher Zeitraum' }), d.documents, d.settings, { now: NOW, by: 'Petra Leitner' })
    d.documents.push(st)
  }
  assert.equal(noteBillState(a, d.documents).state, 'offen')
  assert.equal(stateOf(a, d.documents, TODAY, d.settings), 'offen')
  assert.equal(flatBillState('c3', '2026-10', d.documents).state, 'offen')
  const third = create(d, '2026-10').drafts
  assert.deepEqual(third.map((x) => x.customerId).sort(), ['c1', 'c3'])
  assert.deepEqual(third.flatMap((x) => mattenConflicts(release(x), d.documents)), [], 'nach dem Storno frei')
})

test('„Preis fehlt“ blockiert mit Hinweis; von Hand verrechnet erst mit eingetragenem Preis', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m9', qty: 2, price: 0, src: 'fehlt' }] })
  addNote(d, { customerId: 'c2', date: '2026-10-06', objectId: 'o2', items: [{ place: 'p-schau', name: 'Schauraum', article: 'a-m2', qty: 1, price: 8.5, src: 'standard' }] })
  const p = planOf(run(d, '2026-10'), 'c1')
  assert.equal(p.ready, 0)
  assert.ok(p.hints.some((h) => h.level === 'error' && h.text.startsWith(`${a.number}: Preis fehlt`)))
  const r = create(d, '2026-10')
  assert.deepEqual(r.drafts.map((x) => x.customerId), ['c2'], 'andere Kunden laufen weiter')
  assert.equal(r.skipped[0].name, 'Hausverwaltung Beispiel GmbH')
  // von Hand („→ Rechnung“): Festschreiben gesperrt, bis der Preis im Entwurf steht
  const manual = collectDraft([a], { id: newId(), date: TODAY })
  assert.ok(mattenConflicts(manual, d.documents).some((t) => /^Preis fehlt/.test(t)))
  manual.lines.find((l) => l.type === 'item').price = 4.4
  assert.deepEqual(mattenConflicts(manual, d.documents), [])
})

test('Mischfall Pauschale/Stück und Einzel/Sammel: ein Lieferschein nur in einer Rechnung, Monat nicht doppelt', () => {
  const d = fak()
  const a = addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  const flat = create(d, '2026-10').drafts[0]
  // gleichzeitig von Hand je Stück („→ Rechnung“) aus demselben Lieferschein
  const manual = collectDraft([a], { id: newId(), date: TODAY })
  d.documents.push(manual)
  issue(d, flat.id)
  const msgs = mattenConflicts(manual, d.documents)
  assert.ok(msgs.some((t) => t.startsWith(`Lieferschein ${a.number} ist schon mit RE-2026-`)), msgs.join(' | '))
  assert.ok(msgs.some((t) => /Oktober 2026 ist für diesen Kunden schon pauschal verrechnet/.test(t)), 'Stückpreise im pauschal verrechneten Monat')
  // Kunde wechselt auf „je Matte“: ein später erstellter Oktober-Lieferschein wird nicht zusätzlich je Stück verrechnet
  d.customers.find((c) => c.id === 'c3').matten = { priceModel: 'wechsel', billing: 'sammel' }
  const late = addNote(d, { customerId: 'c3', date: '2026-10-30', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  const p = planOf(run(d, '2026-10'), 'c3')
  assert.equal(p.ready, 0)
  assert.ok(p.hints.some((h) => h.level === 'error' && h.text.startsWith(`${late.number}: Oktober 2026 ist schon pauschal verrechnet`)))
  // Pauschal-Monat ein zweites Mal (z. B. von Hand kopiert): gesperrt
  const copy = { ...structuredClone(d.documents.find((x) => x.id === flat.id)), id: newId(), number: undefined, checksum: undefined, deliveryNotes: [] }
  delete copy.number
  assert.ok(mattenConflicts(copy, d.documents).some((t) => /Pauschale Oktober 2026 ist für diesen Kunden schon mit RE-/.test(t)))
  // Einzel gegen Sammel: derselbe Lieferschein in zwei Entwürfen, der zweite lässt sich nicht festschreiben
  const e = fak()
  const n1 = addNote(e, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  const single = collectDraft([n1], { id: newId(), date: TODAY })
  e.documents.push(single)
  assert.equal(create(e, '2026-10').drafts.length, 0, 'schon im Entwurf: der Lauf nimmt ihn nicht noch einmal')
  e.documents = e.documents.filter((x) => x.id !== single.id)
  const sammel = create(e, '2026-10').drafts[0]
  e.documents.push(single)
  issue(e, single.id)
  assert.ok(mattenConflicts(release(sammel), e.documents).some((t) => t.startsWith(`Lieferschein ${n1.number} ist schon mit`)))
})

test('Kunde nicht in der Fakturierung: blockiert mit Hinweis', () => {
  const d = fak()
  const n = addNote(d, { customerId: 'c-weg', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 1, price: 4.9, src: 'standard' }] })
  const p = planOf(run(d, '2026-10'), 'c-weg')
  assert.equal(p.name, n.recipient.name)
  assert.equal(p.ready, 0)
  assert.ok(p.hints.some((h) => h.level === 'error' && /ist nicht in der Fakturierung/.test(h.text)))
})

// ---------------------------------------------------------------- Prüfen → Freigeben → Ausstellen

test('Prüfen → Freigeben → Ausstellen: Festschreiben erst nach der Freigabe, review außerhalb der Prüfsumme', () => {
  const d = fak()
  addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  const x = create(d, '2026-10').drafts[0]
  assert.match(mattenConflicts(x, d.documents)[0], /erst prüfen und freigeben \(noch nicht geprüft\)/)
  assert.throws(() => markReleased(x, { at: NOW, by: 'A' }), /Erst prüfen/)
  const checked = markChecked(x, { at: NOW, by: 'Anna Prüferin' })
  assert.equal(reviewStep(checked), 'geprueft')
  assert.match(mattenConflicts(checked, d.documents)[0], /geprüft, noch nicht freigegeben/)
  const released = markReleased(checked, { at: NOW, by: 'Petra Leitner' })
  assert.deepEqual([reviewStep(released), released.review.checkedBy, released.review.releasedBy], ['freigegeben', 'Anna Prüferin', 'Petra Leitner'])
  assert.deepEqual(mattenConflicts(released, d.documents), [])
  assert.deepEqual(released.history.map((h) => h.text).slice(-2), ['geprüft', 'freigegeben'])
  assert.equal(reviewStep(undoReview(released, { at: NOW, by: 'Petra Leitner' })), 'entwurf')
  // Ausgestellt = festgeschrieben; review und Verlauf zählen nicht zur Prüfsumme
  const fixed = finalize(released, d.documents, d.settings, { now: NOW, by: 'Petra Leitner' })
  assert.equal(reviewStep(fixed), 'ausgestellt')
  assert.equal(checksumOf({ ...fixed, review: undefined, history: [] }), fixed.checksum)
  assert.ok(intact(fixed))
  // Sammel-Festschreiben (Läufe): mit Prüfung je Entwurf, nicht freigegebene bleiben stehen
  const e = fak()
  addNote(e, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  addNote(e, { customerId: 'c2', date: '2026-10-06', objectId: 'o2', items: [{ place: 'p-schau', name: 'Schauraum', article: 'a-m2', qty: 1, price: 8.5, src: 'standard' }] })
  const [y1, y2] = create(e, '2026-10').drafts
  e.documents = e.documents.map((z) => (z.id === y2.id ? release(z) : z))
  const r = finalizeBatch([y1.id, y2.id], e.documents, e.settings, { now: NOW, by: 'Petra Leitner', check: (z, all) => mattenConflicts(z, all) })
  assert.deepEqual(r.done.map((z) => z.id), [y2.id])
  assert.match(r.failed[0].error, /erst prüfen und freigeben/)
})

test('Korrekturen am Entwurf: im Verlauf mit wer und wann, Prüfung danach zurückgesetzt; andere Entwürfe unverändert', () => {
  const d = fak()
  addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  const x = release(create(d, '2026-10').drafts[0])
  const edited = structuredClone(x)
  const item = edited.lines.find((l) => l.type === 'item')
  item.qty = 3
  item.price = 4.6
  edited.lines.push({ id: 'neu-1', text: 'Sonderreinigung Matte', qty: 1, unit: 'Pauschale', price: 12, vat: 20, discount: 0 })
  edited.discount = 2
  const changes = draftChanges(x, edited)
  assert.deepEqual(changes, ['Rabatt auf alles 0 % → 2 %', `Position „${item.text}“: Menge 2 → 3, Einzelpreis 4,40 € → 4,60 €`, 'Position neu: „Sonderreinigung Matte“ (1 × 12,00 €)'])
  const tracked = trackChanges(x, edited, { at: '2026-11-09T09:30:00.000Z', by: 'Anna Prüferin' })
  assert.equal(reviewStep(tracked), 'entwurf', 'Freigabe zurückgesetzt')
  const last = tracked.history.slice(-2)
  assert.deepEqual(last.map((h) => [h.at, h.by]), [['2026-11-09T09:30:00.000Z', 'Anna Prüferin'], ['2026-11-09T09:30:00.000Z', 'Anna Prüferin']])
  assert.match(last[0].text, /^Korrektur: Rabatt auf alles 0 % → 2 %; Position/)
  assert.equal(last[1].text, 'Freigabe zurückgesetzt (nach der Korrektur neu prüfen)')
  assert.equal(trackChanges(x, structuredClone(x), { at: NOW, by: 'A' }).history.length, x.history.length, 'ohne Änderung kein Eintrag')
  const removed = { ...structuredClone(x), lines: x.lines.filter((l) => l.type !== 'item') }
  assert.ok(draftChanges(x, removed).some((t) => t.startsWith('Position entfernt: „')))
  // Rechnung ohne Mattenwechsel: kein Protokoll (wie bisher)
  const other = { id: 'o', kind: 'rechnung', lines: [{ id: 'l1', text: 'Reinigung', qty: 1, price: 10 }] }
  assert.equal(trackChanges(other, { ...other, lines: [{ id: 'l1', text: 'Reinigung', qty: 2, price: 10 }] }, { at: NOW, by: 'A' }).history, undefined)
})

// ---------------------------------------------------------------- Vorschlag, Namen, Rechte

test('Vorschlag am Monatsersten: nur mit Einstellung, solange Kunden für den Vormonat offen sind', () => {
  const d = fak()
  addNote(d, { customerId: 'c1', date: '2026-10-05', objectId: 'o1', items: [{ place: 'p-haupt', name: 'Haupteingang', article: 'a-m1', qty: 2, price: 4.4 }] })
  addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer', article: 'a-m1', qty: 2, price: 4.9, src: 'standard' }] })
  assert.equal(runTask(d, { today: '2026-11-01' }), null, 'ausgeschaltet')
  d.settings.mattenRun = { suggest: true }
  const t = runTask(d, { today: '2026-11-01' })
  assert.deepEqual([t.ym, t.count, t.drafts, t.names], ['2026-10', 2, 2, ['Bürohaus Nord Beispiel', 'Hausverwaltung Beispiel GmbH']])
  create(d, '2026-10')
  assert.equal(runTask(d, { today: '2026-11-01' }), null, 'erledigt')
})

test('Namen aus den Lieferscheinen: Liegeplatz und Objekt ohne Recht auf den Mattenwechsel', () => {
  const d = fak()
  addNote(d, { customerId: 'c3', date: '2026-10-08', objectId: 'o3', items: [{ place: 'p-foyer', name: 'Foyer (EG)', article: 'a-m1', qty: 2, price: 4.9 }] })
  const names = namesFromNotes(d.documents)
  assert.equal(names.placements.get('p-foyer'), 'Foyer (EG)')
  assert.equal(names.objects.get('o3'), 'Bürohaus Nord')
  assert.ok(billingIndex(d.documents).notes instanceof Map)
  assert.equal(flatKey('c3', '2026-10'), 'matten-pauschale:c3:2026-10')
})

test('Rechte: abrechnen darf, wer die Fakturierung bearbeitet – auch ohne den Mattenwechsel zu sehen', () => {
  const access = { planners: ['office@cleanos.at'] }
  const role = (id) => resolveAccess({ roleClaims: [id], access, strict: true })
  const bh = role('buchhaltung')
  assert.ok(runRights(bh).run && !bh.sees('matten'))
  assert.deepEqual([runRights(role('mattenwechsel')).run, runRights(role('mattenfahrer')).run], [false, false])
  assert.match(runRights(role('mattenwechsel')).hint, /Kein Recht auf die Fakturierung/)
  assert.ok(runRights(resolveAccess({ email: 'office@cleanos.at', access, strict: true })).run)
  assert.ok(runRights(null).run, 'Browser-Modus')
})
