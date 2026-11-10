import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compactMoves, consumption, emptyMaterial, euro, inventoryMoves, isOpenRequest, isOverdue, isPendingRequest, issueMoves, locationsOf, matchArticle, materialBudget, nextOrderNo, onOrder, openOrders, orderMailText, orderSuggestions, orderSum, parseArticles, receiveOrder, requestFromPortal, roundToPack, stockMap, stockOf, stockRows, stockStatus, stockValue, transferMoves } from '../src/core/material.js'

let n = 0
const newId = () => `m${++n}`
const at = '2026-11-02T08:00:00.000Z'
const art = (id, over = {}) => ({ id, name: id, category: 'Reinigungsmittel', unit: 'Fl.', packSize: 1, price: 2, min: 0, target: 0, ...over })
const mv = (articleId, qty, over = {}) => ({ id: newId(), at, date: '2026-11-02', kind: 'eingang', articleId, loc: 'lager', qty, ...over })

// ---------------------------------------------------------------- Bestand

test('Bestand: Kommazahlen sauber gerundet, ähnliche Kennungen vermischen sich nicht', () => {
  const moves = [mv('a', 0.1), mv('a', 0.2), mv('ab', 5), mv('a', 1, { loc: 'bus' })]
  assert.equal(stockMap(moves).get('a|lager'), 0.3)
  assert.equal(stockOf(moves, 'a'), 1.3, '„ab“ zählt nicht zu „a“')
  assert.equal(stockOf(moves, 'x'), 0)
  assert.equal(stockOf(moves, 'a', 'keller'), 0)
})

const statusCases = [
  [5.5, 5, 'ok'],
  [5, '5', 'niedrig'],
  [0, 3, 'leer'],
  [-2, 0, 'leer'],
  [0, '', 'ok'],
  [1, null, 'ok'],
]
for (const [total, min, status] of statusCases) test(`Lagerzustand: Bestand ${total}, Meldebestand ${JSON.stringify(min)} → ${status}`, () => assert.equal(stockStatus(total, min), status))

test('Offene Bestellungen: gelieferte und stornierte zählen nicht, Überlieferung nicht negativ', () => {
  const orders = [
    { status: 'bestellt', lines: [{ articleId: 'a', qty: 10, received: 0 }] },
    { status: 'teilweise', lines: [{ articleId: 'a', qty: 5, received: 7 }, { articleId: 'b', qty: 2 }] },
    { status: 'geliefert', lines: [{ articleId: 'a', qty: 50, received: 50 }] },
    { status: 'storniert', lines: [{ articleId: 'a', qty: 30 }] },
    { status: 'entwurf', lines: [{ articleId: 'a', qty: 4 }, { articleId: 'a', qty: '2' }] },
  ]
  assert.deepEqual(onOrder(orders, 'a'), { open: 10, draft: 6 })
  assert.deepEqual(onOrder(orders, 'b'), { open: 2, draft: 0 })
  assert.deepEqual(openOrders(orders).map((o) => o.status), ['bestellt', 'teilweise'])
})

test('Bestandsliste: Suche nach Lieferant und Artikelnummer, inaktive auf Wunsch, Wert ohne negativen Bestand', () => {
  const doc = { ...emptyMaterial(), suppliers: [{ id: 's1', name: 'Hygiene Beispiel GmbH' }], articles: [art('a', { name: 'Glasreiniger', supplierId: 's1', price: 3 }), art('b', { name: 'Handschuhe', articleNo: 'HS-200', category: 'Arbeitskleidung & Schutz' }), art('c', { name: 'Altes Mittel', active: false, price: 4 })] }
  doc.moves = [mv('a', 4), mv('b', -3, { kind: 'ausgabe' }), mv('c', 2)]
  assert.deepEqual(stockRows(doc, { search: 'beispiel' }).map((r) => r.article.id), ['a'])
  assert.deepEqual(stockRows(doc, { search: 'hs-2' }).map((r) => r.article.id), ['b'])
  assert.deepEqual(stockRows(doc, { includeInactive: true }).map((r) => r.article.id), ['b', 'c', 'a'], 'nach Kategorie, dann Name')
  assert.deepEqual(stockRows(doc, { category: 'Arbeitskleidung & Schutz' }).map((r) => [r.article.id, r.total, r.status, r.value]), [['b', -3, 'leer', 0]])
  assert.deepEqual(stockRows(doc, { only: 'leer' }).map((r) => r.article.id), ['b'])
  assert.equal(stockValue(stockRows(doc, { includeInactive: true })), 20)
  assert.deepEqual(locationsOf({ locations: [] }), [{ id: 'lager', name: 'Hauptlager' }])
})

// ---------------------------------------------------------------- Bestellvorschlag

const packCases = [
  [12, 6, 12],
  [12.1, 6, 18],
  [3, 0, 3],
  [2.01, undefined, 3],
  [5, '4', 8],
]
for (const [qty, pack, out] of packCases) test(`Packungen: ${qty} bei Packung ${pack} → ${out}`, () => assert.equal(roundToPack(qty, pack), out))

test('Bestellvorschlag: genau am Meldebestand schon nachbestellen, einer darüber nicht', () => {
  const doc = { ...emptyMaterial(), articles: [art('genau', { min: 5, target: 10 }), art('drueber', { min: 5, target: 10 }), art('aus', { min: 5, active: false }), art('ohne', { min: 0 })] }
  doc.moves = [mv('genau', 5), mv('drueber', 6)]
  const s = orderSuggestions(doc)
  assert.deepEqual(s.flatMap((g) => g.lines.map((l) => [l.articleId, l.qty])), [['genau', 5]])
})

test('Bestellvorschlag: Sollbestand nicht über dem Meldebestand → doppelter Meldebestand, negativer Bestand wird aufgefüllt', () => {
  const doc = { ...emptyMaterial(), articles: [art('a', { min: 4, target: 3, supplierId: 's1', price: 1.25 }), art('b', { min: 2, packSize: 5, supplierId: 's1', price: 2 })] }
  doc.moves = [mv('a', 1), mv('b', -3, { kind: 'ausgabe' })]
  const [g] = orderSuggestions(doc)
  assert.deepEqual(g.lines.map((l) => [l.articleId, l.qty, l.target]), [['a', 7, 8], ['b', 10, 4]], 'b: 4 − (−3) = 7 → 2 Packungen à 5')
  assert.equal(g.sum, 28.75)
})

test('Bestellvorschlag: Artikel ohne Lieferant stehen in einer eigenen Gruppe am Ende', () => {
  const doc = { ...emptyMaterial(), articles: [art('x', { min: 1 }), art('y', { min: 1, supplierId: 's2' }), art('z', { min: 1, supplierId: 's1' })] }
  assert.deepEqual(orderSuggestions(doc).map((g) => g.supplierId), ['s2', 's1', ''])
})

// ---------------------------------------------------------------- Bestellungen und Wareneingang

test('Bestellnummer: nur das Jahr zählt, kaputte Nummern werden ignoriert', () => {
  assert.equal(nextOrderNo([{ no: '2026-009' }, { no: '2026-abc' }, { no: '' }, {}, { no: '2027-050' }], 2026), '2026-010')
  assert.equal(nextOrderNo([{ no: '2026-999' }], '2026'), '2026-1000')
  assert.equal(nextOrderNo(undefined, 2026), '2026-001')
})

test('Bestellung: Summe aus Texten, überfällig nur offene mit Liefertermin', () => {
  assert.equal(orderSum({ lines: [{ qty: '3', price: '1.5' }, { qty: 2, price: 0.333 }, { qty: 'x', price: 5 }] }), 5.17)
  // 0,5 × 2,01 € = 1,005 €: jede Position 1,01 € (wie im Bestellschein), die Summe ist die Summe der Positionen
  assert.equal(orderSum({ lines: [{ qty: 0.5, price: 2.01 }, { qty: 0.5, price: 2.01 }] }), 2.02)
  assert.equal(orderSum({ lines: [{ qty: 0.5, price: 2.01 }] }), 1.01)
  assert.equal(isOverdue({ status: 'bestellt', expected: '2026-11-01' }, '2026-11-02'), true)
  assert.equal(isOverdue({ status: 'teilweise', expected: '2026-11-02' }, '2026-11-02'), false, 'heute fällig: noch nicht überfällig')
  assert.equal(isOverdue({ status: 'geliefert', expected: '2026-10-01' }, '2026-11-02'), false)
  assert.equal(isOverdue({ status: 'bestellt' }, '2026-11-02'), false)
})

test('Wareneingang: Überlieferung schließt die Zeile, ungültige Mengen werden übergangen, eigenes Lager', () => {
  const order = { id: 'o1', no: '2026-003', status: 'bestellt', lines: [{ articleId: 'a', qty: 10, price: 2, received: 0 }, { articleId: 'b', qty: 5, price: 1, received: 0 }] }
  const r = receiveOrder(order, { 0: 12, 1: -3 }, { loc: 'bus', date: '2026-11-04', at, by: 'Lager', newId })
  assert.equal(r.order.status, 'teilweise')
  assert.equal(r.order.deliveredAt, null)
  assert.deepEqual(r.moves.map((m) => [m.articleId, m.qty, m.loc, m.note, m.orderId]), [['a', 12, 'bus', 'Bestellung 2026-003', 'o1']])
  const done = receiveOrder(r.order, { 1: '5' }, { date: '2026-11-06', at, newId })
  assert.deepEqual([done.order.status, done.order.deliveredAt, done.moves[0].loc], ['geliefert', '2026-11-06', 'lager'])
  const again = receiveOrder(r.order, { 0: 'x' }, { date: '2026-11-06', at, newId })
  assert.deepEqual([again.order.status, again.moves.length], ['teilweise', 0], 'nichts Neues: bleibt teilweise')
  assert.equal(order.lines[0].received, 0, 'Bestellung selbst unverändert')
})

// ---------------------------------------------------------------- Ausgabe, Umbuchung, Inventur, Übertrag

test('Ausgabe: Zeilen ohne Artikel oder Menge fallen weg, Preis vom Artikel, unbekannt 0 €', () => {
  const moves = issueMoves([{ articleId: 'a', qty: 1.23456 }, { articleId: '', qty: 3 }, { articleId: 'b', qty: -2 }, { articleId: 'zz', qty: 1 }], { articles: [art('a', { price: 4.5 })], objectId: 'o7', date: '2026-11-03', at, by: 'Büro', note: 'Grundreinigung', newId })
  assert.deepEqual(moves.map((m) => [m.articleId, m.qty, m.price, m.objectId, m.employeeId, m.kind, m.note]), [['a', -1.235, 4.5, 'o7', '', 'ausgabe', 'Grundreinigung'], ['zz', -1, 0, 'o7', '', 'ausgabe', 'Grundreinigung']])
})

test('Umbuchung: zwei Buchungen mit gemeinsamer Kennung, Gesamtbestand bleibt', () => {
  const before = [mv('a', 10)]
  const t = transferMoves([{ articleId: 'a', qty: 3 }, { articleId: 'a', qty: 0 }], { from: 'lager', to: 'bus', date: '2026-11-03', at, newId })
  assert.equal(t.length, 2)
  assert.equal(t[0].pair, t[1].pair)
  assert.deepEqual(t.map((m) => [m.loc, m.qty]), [['lager', -3], ['bus', 3]])
  assert.equal(stockOf([...before, ...t], 'a'), 10)
})

test('Inventur: gezählt wie im Bestand → keine Buchung, 0 gezählt → alles aus, leere Felder bleiben', () => {
  const moves = [mv('a', 8), mv('b', 4), mv('c', 2)]
  const inv = inventoryMoves(moves, { a: 8, b: 0, c: null, d: '3' }, { loc: 'lager', date: '2026-11-30', at, articles: [art('b', { price: 1.5 })], newId })
  assert.deepEqual(inv.map((m) => [m.articleId, m.qty, m.price, m.note]), [['b', -4, 1.5, 'gezählt 0'], ['d', 3, 0, 'gezählt 3']])
  assert.equal(stockOf([...moves, ...inv], 'b'), 0)
})

test('Übertrag alter Buchungen: Ausgleich auf 0 entfällt, je Lager eine Buchung, Neues bleibt', () => {
  const moves = [mv('a', 5, { date: '2025-03-01' }), mv('a', -5, { date: '2025-04-01', kind: 'ausgabe' }), mv('b', 2, { date: '2025-05-01', loc: 'bus' }), mv('b', 1, { date: '2025-06-01' }), mv('b', 7, { date: '2026-01-01' })]
  const out = compactMoves(moves, '2026-01-01', { at, newId })
  assert.deepEqual(out.filter((m) => m.kind === 'saldo').map((m) => [m.articleId, m.loc, m.qty, m.note]), [['b', 'bus', 2, 'Übertrag aller Buchungen vor 2026-01-01'], ['b', 'lager', 1, 'Übertrag aller Buchungen vor 2026-01-01']])
  assert.equal(out.length, 3)
  assert.equal(stockOf(out, 'b'), stockOf(moves, 'b'))
})

// ---------------------------------------------------------------- Verbrauch

test('Verbrauch: Ausgabe an Person im Objekt zählt bei beiden, ohne Ziel unter „ohne Objekt“, Grenztage zählen', () => {
  const articles = [art('a', { category: 'Müllsäcke' }), art('b', { category: 'Papier & Hygiene' })]
  const moves = [
    mv('a', -10, { kind: 'ausgabe', price: 0.5, objectId: 'o1', employeeId: 'e1', date: '2026-11-01' }),
    mv('b', -2, { kind: 'ausgabe', price: 6, objectId: 'o1', date: '2026-11-30' }),
    mv('b', -1, { kind: 'ausgabe', price: 6, date: '2026-11-15' }),
    mv('a', -1, { kind: 'umbuchung', price: 99, objectId: 'o1' }),
    mv('x', -1, { kind: 'ausgabe', price: 3, objectId: 'o2', date: '2026-12-01' }),
  ]
  const c = consumption({ articles, moves }, { from: '2026-11-01', to: '2026-11-30' })
  assert.equal(c.total, 23)
  assert.deepEqual(c.objects.map((o) => [o.id, o.value]), [['o1', 17], ['', 6]])
  assert.deepEqual(c.objects[0].lines.map((l) => [l.articleId, l.qty, l.value]), [['b', 2, 12], ['a', 10, 5]], 'teuerste Position zuerst')
  assert.deepEqual(c.people, [{ id: 'e1', value: 5, lines: [{ articleId: 'a', qty: 10, value: 5 }] }])
  assert.deepEqual(c.categories, [{ category: 'Papier & Hygiene', value: 18 }, { category: 'Müllsäcke', value: 5 }])
})

test('Materialbudget: ohne Stunden oder ohne Materialzuschlag 0', () => {
  assert.equal(materialBudget({ hours: 0, steps: [{ label: 'Material und Geräte', amount: 2 }] }), 0)
  assert.equal(materialBudget({ hours: 10, steps: [{ label: 'Lohnnebenkosten', amount: 9 }] }), 0)
  assert.equal(materialBudget({ hours: 12.5, steps: [{ label: 'MATERIAL', amount: 1.333 }] }), 16.66)
})

// ---------------------------------------------------------------- Anforderungen

test('Anforderung vom Handy: Objekt über den Namen, Zeit aus Sekunden, Stand offen', () => {
  const r = requestFromPortal({ id: 'p7', name: 'Eva Fink', text: 'Praxis Kaltenbach', notiz: '  2 Rollen Müllsäcke  ', erstellt: 1796000000 }, { objects: [{ id: 'o2', name: 'Praxis Kaltenbach' }], newId })
  assert.deepEqual([r.objectId, r.objectName, r.at, r.lines[0].text, r.status, r.employeeId], ['o2', '', new Date(1796000000 * 1000).toISOString(), '2 Rollen Müllsäcke', 'offen', ''])
  assert.ok(isOpenRequest(r) && isPendingRequest(r))
  assert.ok(isPendingRequest({ status: 'bestellt' }) && !isOpenRequest({ status: 'bestellt' }))
  assert.ok(!isPendingRequest({ status: 'ausgegeben' }) && !isPendingRequest({ status: 'abgelehnt' }))
})

const matches = [
  ['Toilettenpapier', 'tp', 'Hälfte der Wörter reicht (3-lagig)'],
  ['bitte 60er Müllsäcke', 'm60', 'grob: „60“ steckt in „60er“'],
  ['Müllsäcke 60 l', 'm60', 'genau'],
  ['Desinfektion für Hände', null, 'Wortteil reicht nicht'],
  ['', null, 'leer'],
]
for (const [text, id, why] of matches)
  test(`Freitext zuordnen: „${text}“ → ${id ?? 'nichts'} (${why})`, () => {
    const articles = [art('tp', { name: 'Toilettenpapier 3-lagig' }), art('m60', { name: 'Müllsäcke 60 l' }), art('hd', { name: 'Händedesinfektion' }), art('alt', { name: 'Müllsäcke 60 l blau', active: false })]
    assert.equal(matchArticle(text, articles)?.id ?? null, id)
  })

// ---------------------------------------------------------------- Bestell-E-Mail und Excel

test('Bestell-E-Mail: Anmerkung, Rückfragen, unbekannter Artikel mit Kennung und „Stk“', () => {
  const text = orderMailText({ no: '2026-011', note: 'Bitte an den Hintereingang.', lines: [{ articleId: 'zz-9', qty: 3 }] }, { supplier: { contact: 'Herr Lechner' }, contact: 'Büro, 0662 000000', formatDate: (d) => d })
  assert.equal(text, 'Guten Tag Herr Lechner,\n\nwir bestellen:\n\n- 3 Stk zz-9\n\nRückfragen: Büro, 0662 000000\n\nBitte an den Hintereingang.\n\nBitte bestätigen Sie die Bestellung 2026-011 kurz per E-Mail. Die Bestellung liegt auch als PDF bei.\n\nMit freundlichen Grüßen')
  assert.match(euro(1234.5), /^€\s1\.234,50$/)
})

test('Artikel aus CSV: Semikolon, Anführungszeichen, andere Spaltennamen, Kategorie nach Anfang', () => {
  const list = parseArticles('Bezeichnung;Hersteller;Warengruppe;Preis netto;Meldebestand;VE\n"Flächendesinfektion 1 l";Hygiene Beispiel GmbH;Desinfektionsmittel;12,90;3;6\nSchwamm;;Werkzeug;0,85;;\n;;;;;')
  assert.deepEqual(list.map((a) => [a.name, a.category, a.supplier, a.price, a.min, a.packSize]), [['Flächendesinfektion 1 l', 'Desinfektion', 'Hygiene Beispiel GmbH', 12.9, 3, 6], ['Schwamm', 'Sonstiges', '', 0.85, null, null]])
})
