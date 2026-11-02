import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calculate } from '../src/core/calculation.js'
import { compactMoves, consumption, emptyMaterial, inventoryMoves, issueMoves, matchArticle, materialBudget, nextOrderNo, onOrder, orderMailText, orderSuggestions, orderSum, parseArticles, receiveOrder, requestFromPortal, roundToPack, stockOf, stockRows, stockStatus, transferMoves } from '../src/core/material.js'

let n = 0
const newId = () => `id${++n}`
const at = '2026-11-02T08:00:00.000Z'
const art = (id, over = {}) => ({ id, name: id, category: 'Reinigungsmittel', unit: 'Fl.', packSize: 1, price: 2, min: 0, target: 0, ...over })
const mv = (articleId, qty, over = {}) => ({ id: newId(), at, date: '2026-11-02', kind: 'eingang', articleId, loc: 'lager', qty, ...over })

test('Bestand aus Buchungen je Lager, Zustand, Liste mit Wert und Filter', () => {
  const doc = { ...emptyMaterial(), locations: [{ id: 'lager', name: 'Hauptlager' }, { id: 'bus', name: 'Bus 1' }], articles: [art('a', { min: 5, price: 3 }), art('b', { category: 'Müllsäcke', name: 'Müllsäcke 120 l' }), art('c', { active: false })] }
  doc.moves = [mv('a', 10), mv('a', -7, { kind: 'ausgabe' }), mv('a', 2, { loc: 'bus' }), mv('b', 4)]
  assert.equal(stockOf(doc.moves, 'a'), 5)
  assert.equal(stockOf(doc.moves, 'a', 'bus'), 2)
  assert.equal(stockStatus(5, 5), 'niedrig')
  assert.equal(stockStatus(0, 5), 'leer')
  assert.equal(stockStatus(0, 0), 'ok', 'ohne Meldebestand kein Alarm')
  assert.equal(stockStatus(-1, 0), 'leer', 'negativer Bestand fällt auf')
  const rows = stockRows(doc)
  assert.deepEqual(rows.map((r) => r.article.id), ['b', 'a'], 'nach Kategorie, inaktive ausgeblendet')
  const a = rows.find((r) => r.article.id === 'a')
  assert.deepEqual(a.byLoc, { lager: 3, bus: 2 })
  assert.equal(a.value, 15)
  assert.equal(a.status, 'niedrig')
  assert.deepEqual(stockRows(doc, { only: 'niedrig' }).map((r) => r.article.id), ['a'])
  assert.deepEqual(stockRows(doc, { search: 'müll' }).map((r) => r.article.id), ['b'])
})

test('Bestellvorschlag: bis Sollbestand, auf Packungen gerundet, offene Bestellungen und Entwürfe zählen, je Lieferant', () => {
  assert.equal(roundToPack(7, 6), 12)
  assert.equal(roundToPack(2.2, 1), 3)
  const doc = { ...emptyMaterial(), articles: [art('a', { min: 4, target: 20, packSize: 6, supplierId: 's1', price: 1.5 }), art('b', { min: 2, supplierId: 's2' }), art('c', { min: 3, target: 10 }), art('d', { min: 3, target: 10, supplierId: 's1' })] }
  doc.moves = [mv('a', 4), mv('b', 1), mv('c', 10), mv('d', 1)]
  doc.orders = [{ id: 'o1', no: '2026-001', supplierId: 's1', status: 'bestellt', lines: [{ articleId: 'd', qty: 10, received: 4 }] }]
  assert.deepEqual(onOrder(doc.orders, 'd'), { open: 6, draft: 0 })
  const s = orderSuggestions(doc)
  assert.deepEqual(s.map((g) => g.supplierId), ['s1', 's2'], 'd ist schon bestellt (1 + 6 > 3), c reicht')
  assert.deepEqual(s[0].lines.map((l) => [l.articleId, l.qty]), [['a', 18]], '20 − 4 = 16 → 3 Packungen à 6')
  assert.equal(s[0].sum, 27)
  assert.deepEqual(s[1].lines.map((l) => [l.articleId, l.qty]), [['b', 3]], 'ohne Sollbestand bis zum doppelten Meldebestand')
  doc.orders.push({ id: 'o2', status: 'entwurf', supplierId: 's2', lines: [{ articleId: 'b', qty: 3 }] })
  assert.deepEqual(orderSuggestions(doc).map((g) => g.supplierId), ['s1'], 'im Entwurf: nicht noch einmal vorschlagen')
})

test('Bestellung: Nummer je Jahr, Summe, Wareneingang mit Teillieferung', () => {
  assert.equal(nextOrderNo([{ no: '2026-007' }, { no: '2025-020' }], 2026), '2026-008')
  assert.equal(nextOrderNo([], 2027), '2027-001')
  const order = { id: 'o1', no: '2026-001', status: 'bestellt', lines: [{ articleId: 'a', qty: 10, price: 2, received: 0 }, { articleId: 'b', qty: 5, price: 1, received: 0 }] }
  assert.equal(orderSum(order), 25)
  const first = receiveOrder(order, { 0: 10, 1: 2 }, { loc: 'lager', date: '2026-11-03', at, by: 'Büro', newId })
  assert.equal(first.order.status, 'teilweise')
  assert.deepEqual(first.moves.map((m) => [m.articleId, m.qty, m.price, m.kind]), [['a', 10, 2, 'eingang'], ['b', 2, 1, 'eingang']])
  const second = receiveOrder(first.order, { 1: 3 }, { loc: 'lager', date: '2026-11-05', at, newId })
  assert.equal(second.order.status, 'geliefert')
  assert.equal(second.order.deliveredAt, '2026-11-05')
  assert.equal(second.order.lines[1].received, 5)
  assert.equal(receiveOrder(order, {}, { date: '2026-11-03', at, newId }).order.status, 'bestellt', 'nichts erhalten: Status bleibt')
})

test('Ausgabe an Objekt und Person, Umbuchung, Inventur, Verbrauch je Objekt', () => {
  const articles = [art('a', { price: 2 }), art('b', { price: 10, category: 'Arbeitskleidung & Schutz' })]
  let moves = [mv('a', 20), mv('b', 5)]
  moves.push(...issueMoves([{ articleId: 'a', qty: 3 }, { articleId: 'b', qty: 0 }], { articles, objectId: 'o1', date: '2026-11-03', at, newId }))
  moves.push(...issueMoves([{ articleId: 'b', qty: 1 }], { articles, employeeId: 'e1', date: '2026-11-04', at, newId }))
  moves.push(...transferMoves([{ articleId: 'a', qty: 4 }], { from: 'lager', to: 'bus', date: '2026-11-04', at, newId }))
  assert.equal(stockOf(moves, 'a', 'lager'), 13)
  assert.equal(stockOf(moves, 'a', 'bus'), 4)
  assert.equal(stockOf(moves, 'a'), 17)
  const inv = inventoryMoves(moves, { a: 12, b: '' }, { loc: 'lager', date: '2026-11-30', at, articles, newId })
  assert.deepEqual(inv.map((m) => [m.articleId, m.qty, m.kind]), [['a', -1, 'inventur']], 'nur Differenzen, leere Felder unverändert')
  moves.push(...inv)
  const c = consumption({ articles, moves }, { from: '2026-11-01', to: '2026-11-30' })
  assert.equal(c.total, 16)
  assert.deepEqual(c.objects.map((o) => [o.id, o.value]), [['o1', 6]])
  assert.deepEqual(c.people.map((p) => [p.id, p.value]), [['e1', 10]])
  assert.deepEqual(c.categories, [{ category: 'Arbeitskleidung & Schutz', value: 10 }, { category: 'Reinigungsmittel', value: 6 }])
  assert.equal(consumption({ articles, moves }, { from: '2026-12-01', to: '2026-12-31' }).total, 0)
})

test('Alte Buchungen zusammenfassen: Bestand bleibt gleich', () => {
  const moves = [mv('a', 10, { date: '2024-01-05' }), mv('a', -4, { date: '2024-03-01', kind: 'ausgabe' }), mv('a', 2, { date: '2026-11-01' }), mv('b', 3, { date: '2024-02-01', loc: 'bus' })]
  const out = compactMoves(moves, '2025-01-01', { at, newId })
  assert.equal(out.length, 3)
  assert.equal(stockOf(out, 'a'), stockOf(moves, 'a'))
  assert.equal(stockOf(out, 'b', 'bus'), 3)
  assert.ok(out.filter((m) => m.kind === 'saldo').every((m) => m.date === '2025-01-01'))
  assert.equal(compactMoves(out, '2025-01-01', { at, newId }), out, 'nichts Altes: unverändert')
})

test('Materialbudget aus der Kalkulation, Anforderung vom Handy, Freitext zuordnen', () => {
  const calc = calculate({ areas: [{ type: 'buero', m2: 400, perWeek: 5 }], settings: { setupPct: 0 }, wage: 12 })
  // 400 m² / 200 m²/h × 5 × 52/12 = 43,33 h; Material 8 % auf (12 + 90 %) = 1,82 €/h
  assert.equal(materialBudget(calc), Math.round(calc.hours * 1.82 * 100) / 100)
  assert.equal(materialBudget(null), 0)
  const objects = [{ id: 'o1', name: 'Bürohaus Nord' }]
  const r = requestFromPortal({ id: 'p1', name: 'Ana', art: 'Material', objekt: 'o1', text: 'Bürohaus Nord', notiz: 'Müllsäcke 120 und Handseife', erstellt: 1793000000 }, { employeeId: 'e1', objects, newId })
  assert.equal(r.objectId, 'o1')
  assert.equal(r.source, 'handy')
  assert.equal(r.portalId, 'p1')
  assert.equal(r.lines[0].text, 'Müllsäcke 120 und Handseife')
  assert.equal(requestFromPortal({ id: 'p2', text: 'Unbekannt', notiz: 'x' }, { objects, newId }).objectName, 'Unbekannt')
  const articles = [art('m60', { name: 'Müllsäcke 60 l' }), art('m120', { name: 'Müllsäcke 120 l' }), art('seife', { name: 'Handseife 5 l' })]
  assert.equal(matchArticle('müllsäcke 120', articles)?.id, 'm120')
  assert.equal(matchArticle('Handseife', articles)?.id, 'seife')
  assert.equal(matchArticle('Leiter', articles), null)
})

test('Bestell-E-Mail und Artikel aus Excel', () => {
  const text = orderMailText(
    { no: '2026-004', expected: '2026-11-10', lines: [{ articleId: 'a', qty: 12 }, { articleId: 'b', qty: 2.5 }] },
    { supplier: { name: 'Hygiene GmbH', customerNo: 'K-77' }, articles: [{ id: 'a', name: 'Müllsäcke 120 l', unit: 'Rolle', articleNo: 'MS120' }, { id: 'b', name: 'Bodenreiniger', unit: 'l' }], company: 'Cleanos', sender: 'Büro', deliveryAddress: 'Lagerweg 1, 5020 Salzburg', formatDate: (d) => d },
  )
  assert.match(text, /^Sehr geehrte Damen und Herren,/)
  assert.match(text, /Kundennummer K-77/)
  assert.match(text, /- 12 Rolle Müllsäcke 120 l \(Art\.-Nr\. MS120\)/)
  assert.match(text, /- 2,5 l Bodenreiniger/)
  assert.match(text, /Lieferung bis 2026-11-10/)
  assert.match(text, /Lieferadresse: Lagerweg 1/)
  assert.match(text, /Bestellung 2026-004/)
  assert.ok(!/\n\n\n/.test(text), 'keine doppelten Leerzeilen')
  assert.match(orderMailText({ no: '1', lines: [] }, { supplier: { contact: 'Frau Huber' } }), /^Guten Tag Frau Huber,/)
  const list = parseArticles('Artikel\tEinheit\tKategorie\tLieferant\tArt.-Nr.\tPreis\tMindestbestand\tSollbestand\tBestand\nMüllsäcke 120 l\tRolle\tMüllsäcke\tHygiene GmbH\tMS120\t3,90 €\t10\t30\t12\nGlasreiniger\t\tReinigung\t\t\t1.234,50\t\t\t\n\t\t\t\t\t\t\t\t')
  assert.equal(list.length, 2)
  assert.deepEqual(list[0], { name: 'Müllsäcke 120 l', unit: 'Rolle', category: 'Müllsäcke', supplier: 'Hygiene GmbH', articleNo: 'MS120', price: 3.9, min: 10, target: 30, packSize: null, stock: 12 })
  assert.equal(list[1].category, 'Reinigungsmittel', 'Kategorie nach Anfang erkannt')
  assert.equal(list[1].unit, 'Stk')
  assert.equal(list[1].price, 1234.5)
})

test('PDF: Bestellschein mit Positionen und Summe, Zählliste je Lager', async () => {
  const { orderDocument, orderPdfName, countDocument } = await import('../src/export/material-pdf.js')
  const articles = [art('a', { name: 'Müllsäcke 120 l', unit: 'Rolle', articleNo: 'MS120' }), art('b', { name: 'Handseife 5 l', unit: 'Kanister' })]
  const order = { no: '2026-004', createdAt: at, expected: '2026-11-10', lines: [{ articleId: 'a', qty: 12, price: 3.4 }, { articleId: 'b', qty: 2, price: 14.5 }], note: 'Bitte vormittags liefern' }
  const doc = orderDocument({ order, supplier: { name: 'Papier & Co', customerNo: 'K-1' }, articles, settings: { deliveryAddress: 'Lagerweg 1' }, brand: { name: 'Cleanos' } })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Bestellung 2026-004/)
  assert.match(json, /Müllsäcke 120 l/)
  assert.match(json, /MS120/)
  assert.match(json, /Summe netto/)
  assert.match(json, /69,80/)
  assert.match(json, /Lagerweg 1/)
  assert.match(json, /Kundennummer: K-1/)
  assert.equal(orderPdfName(order, { name: 'Papier & Co' }), 'Bestellung_2026-004_Papier-Co.pdf')
  const noPrice = JSON.stringify(orderDocument({ order: { ...order, lines: [{ articleId: 'a', qty: 1, price: 0 }] }, articles }).content)
  assert.ok(!/Summe netto/.test(noPrice), 'ohne Preise keine Summenzeile')
  const count = countDocument({ rows: stockRows({ ...emptyMaterial(), articles, moves: [mv('a', 7)] }), location: { id: 'lager', name: 'Hauptlager' } })
  assert.match(JSON.stringify(count.content), /Inventur.*Hauptlager.*laut App.*gezählt/s)
})
