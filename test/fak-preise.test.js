// Fakturierung: Kundenpreise mit Gültigkeit (priceFor, Prüfung ohne Überschneidung, Dezimalkomma), Pauschale je Monat
// und Mattentypen als Artikel (core/invoicing.js; docs/MATTENWECHSEL-PLAN.md, P2 und P3).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  amountInput,
  checksumOf,
  customerPriceInputs,
  customerPriceOn,
  customerPriceProblems,
  deliveryNoteEmailOf,
  emptyInvoicing,
  isMatType,
  MAT_SIZES,
  matLabel,
  matName,
  matSize,
  matTypes,
  mattenOf,
  monthlyFlatFor,
  monthlyFlats,
  periodsOverlap,
  priceFor,
  priceValidOn,
} from '../src/core/invoicing.js'

const articles = [
  { id: 'm1', name: 'Schmutzfangmatte 85 × 150 cm grau', group: 'Matten', size: '85 × 150 cm', color: 'grau', matKind: 'Standard', unit: 'Stk', price: 4.9, vat: 20 },
  { id: 'm2', name: 'Schmutzfangmatte 150 × 250 cm grau', group: 'Matten', size: '150 × 250 cm', color: 'grau', unit: 'Stk', price: 9.8, vat: 20 },
  { id: 'm3', name: 'Logomatte 115 × 200 cm', group: 'Matten', size: '115 × 200 cm', color: 'blau', matKind: 'Logo', unit: 'Stk', price: 8.5, vat: 20, active: false },
  { id: 'a1', name: 'Reinigung nach Aufwand', group: 'Sonderreinigung', unit: 'Std.', price: 34, vat: 20 },
  { id: 'a2', name: 'Fachbuch', unit: 'Stk', price: 30, vat: 10 },
]
const customers = [
  { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', email: 'rechnung@hv.example', discount: 5 },
  { id: 'c2', name: 'Autohaus Beispiel KG', email: 'buchhaltung@ah.example', deliveryNoteEmail: 'empfang@ah.example' },
]
const customerPrices = [
  { id: 'cp1', customerId: 'c1', articleId: 'm1', price: 4.2, currency: 'EUR', vat: 20, validFrom: '2026-01-01', validTo: '2026-06-30' },
  { id: 'cp2', customerId: 'c1', articleId: 'm1', price: 4.4, currency: 'EUR', vat: 20, validFrom: '2026-07-01', validTo: '' },
  { id: 'cp3', customerId: 'c2', articleId: 'a2', price: 25, currency: 'EUR', validFrom: '', validTo: '2026-12-31' },
]
const data = { customers, articles, customerPrices, settings: { vat: 20 } }

// ---------------------------------------------------------------- priceFor

test('priceFor: Kundenpreis vor Standardpreis, mit Herkunft und Kennung', () => {
  assert.deepEqual(priceFor(data, 'c1', 'm1', '2026-03-15'), { price: 4.2, vat: 20, currency: 'EUR', source: 'kunde', priceId: 'cp1', discount: 0 })
  assert.deepEqual(priceFor(data, 'c1', 'm1', '2026-11-06'), { price: 4.4, vat: 20, currency: 'EUR', source: 'kunde', priceId: 'cp2', discount: 0 })
  // anderer Artikel bzw. anderer Kunde: Standardpreis des Artikels
  assert.deepEqual(priceFor(data, 'c1', 'm2', '2026-03-15'), { price: 9.8, vat: 20, currency: 'EUR', source: 'standard', priceId: null, discount: 5 })
  assert.equal(priceFor(data, 'c2', 'm1', '2026-03-15').source, 'standard')
})

test('priceFor: Gültigkeitsgrenzen einschließlich, offene Grenzen', () => {
  assert.equal(priceFor(data, 'c1', 'm1', '2026-01-01').priceId, 'cp1', 'erster Tag')
  assert.equal(priceFor(data, 'c1', 'm1', '2026-06-30').priceId, 'cp1', 'letzter Tag')
  assert.equal(priceFor(data, 'c1', 'm1', '2026-07-01').priceId, 'cp2', 'Folgepreis ab dem nächsten Tag')
  assert.equal(priceFor(data, 'c1', 'm1', '2025-12-31').source, 'standard', 'vor dem Beginn: Standard')
  assert.equal(priceFor(data, 'c1', 'm1', '2099-12-31').priceId, 'cp2', 'ohne Ende')
  assert.equal(priceFor(data, 'c2', 'a2', '2020-01-01').priceId, 'cp3', 'ohne Beginn')
  assert.equal(priceFor(data, 'c2', 'a2', '2027-01-01').source, 'standard', 'nach dem Ende')
  assert.ok(priceValidOn({ validFrom: '2026-01-01', validTo: '2026-01-01' }, '2026-01-01'))
  assert.ok(!priceValidOn(null, '2026-01-01'))
})

test('priceFor: ohne Kundenpreis Standard, ohne Artikel null, Kundenrabatt nur zum Standardpreis', () => {
  assert.deepEqual(priceFor(data, 'c2', 'a1', '2026-03-01'), { price: 34, vat: 20, currency: 'EUR', source: 'standard', priceId: null, discount: 0 })
  assert.equal(priceFor(data, 'c1', 'a1', '2026-03-01').discount, 5, 'Kundenrabatt zum Standardpreis')
  assert.equal(priceFor(data, 'c1', 'm1', '2026-03-01').discount, 0, 'kein Rabatt zusätzlich zum Kundenpreis')
  assert.equal(priceFor(data, 'c1', 'gibt-es-nicht', '2026-03-01'), null)
  assert.equal(priceFor(data, 'unbekannt', 'a1', '2026-03-01').discount, 0)
  assert.equal(priceFor({}, 'c1', 'a1', '2026-03-01'), null)
  // Kundenpreis auch dann, wenn der Artikel gelöscht ist
  assert.equal(priceFor({ ...data, articles: [] }, 'c1', 'm1', '2026-03-01').price, 4.2)
  // Preis als Text (alte Daten): gelesen und gerundet
  assert.equal(priceFor({ articles: [{ id: 'x', price: '4,905' }] }, 'c1', 'x', '2026-03-01').price, 4.91)
})

test('priceFor: Steuersatz aus Kundenpreis, sonst Artikel, sonst Einstellungen', () => {
  assert.equal(priceFor(data, 'c2', 'a2', '2026-03-01').vat, 10, 'Kundenpreis ohne USt: die des Artikels (10 %)')
  assert.equal(priceFor(data, 'c1', 'a2', '2026-03-01').vat, 10, 'Standard: die des Artikels')
  const own = [{ id: 'z', customerId: 'c1', articleId: 'a1', price: 30, vat: 13, validFrom: '2026-01-01' }]
  assert.equal(priceFor({ ...data, customerPrices: own }, 'c1', 'a1', '2026-03-01').vat, 13, 'eigener Steuersatz des Kundenpreises')
  assert.equal(priceFor({ articles: [{ id: 'x', price: 1 }], settings: { vat: 13 } }, 'c1', 'x', '2026-03-01').vat, 13, 'Artikel ohne USt: Einstellungen')
  assert.equal(priceFor({ articles: [{ id: 'x', price: 1 }] }, 'c1', 'x', '2026-03-01').vat, 20, 'Vorgabe 20 %')
})

test('Kundenpreis: bei Überschneidung nach dem Zusammenführen gilt der mit dem spätesten Beginn', () => {
  const merged = [...customerPrices, { id: 'cp9', customerId: 'c1', articleId: 'm1', price: 3.9, validFrom: '2026-03-01', validTo: '2026-03-31', updatedAt: '2026-02-20T10:00:00Z' }]
  assert.equal(customerPriceOn(merged, 'c1', 'm1', '2026-03-15').id, 'cp9')
  assert.equal(customerPriceOn(merged, 'c1', 'm1', '2026-04-01').id, 'cp1')
  assert.equal(customerPriceOn(undefined, 'c1', 'm1', '2026-04-01'), null)
})

// ---------------------------------------------------------------- Prüfung

test('Kundenpreise prüfen: keine Überschneidung je Kunde und Artikel, Preis ≥ 0, Datum', () => {
  assert.deepEqual(customerPriceProblems(customerPrices, { articles }), [])
  const overlap = [...customerPrices, { id: 'cp4', customerId: 'c1', articleId: 'm1', price: 4, validFrom: '2026-06-30', validTo: '2026-07-15' }]
  const p = customerPriceProblems(overlap, { articles })
  assert.equal(p.length, 1)
  assert.equal(p[0].id, 'cp4')
  assert.equal(p[0].field, 'validFrom')
  assert.match(p[0].text, /Schmutzfangmatte 85 × 150 cm grau: ab 30\.06\.2026 bis 15\.07\.2026 überschneidet sich mit dem Preis ab 01\.01\.2026 bis 30\.06\.2026/)
  // gleicher Zeitraum bei anderem Kunden bzw. Artikel ist erlaubt; anschließend (Tag danach) auch
  assert.deepEqual(customerPriceProblems([...customerPrices, { id: 'x', customerId: 'c2', articleId: 'm1', price: 4, validFrom: '2026-01-01' }, { id: 'y', customerId: 'c1', articleId: 'm2', price: 9, validFrom: '2026-01-01' }], { articles }), [])
  // offen nach beiden Seiten überschneidet sich mit allem
  assert.equal(customerPriceProblems([{ id: 'a', customerId: 'c1', articleId: 'm2', price: 1 }, { id: 'b', customerId: 'c1', articleId: 'm2', price: 2, validFrom: '2030-01-01', validTo: '2030-12-31' }]).length, 1)
  assert.ok(periodsOverlap({ validFrom: '2026-01-01', validTo: '2026-01-31' }, { validFrom: '2026-01-31' }))
  assert.ok(!periodsOverlap({ validFrom: '2026-01-01', validTo: '2026-01-30' }, { validFrom: '2026-01-31' }))
  const bad = customerPriceProblems(
    [
      { id: 'n', customerId: 'c1', articleId: 'm1', price: -1, validFrom: '2027-01-01' },
      { id: 'e', customerId: 'c1', articleId: '', price: '4,90' },
      { id: 'g', customerId: 'c1', articleId: 'weg', price: '' },
      { id: 'd', customerId: 'c1', articleId: 'm2', price: '5', validFrom: '2026-05-01', validTo: '2026-04-30', vat: 7 },
      { id: 't', customerId: 'c1', articleId: 'a1', price: 'vier', validFrom: '1.1.2026' },
    ],
    { articles },
  )
  assert.deepEqual(
    bad.map((x) => [x.id, x.field, x.text]),
    [
      ['n', 'price', 'Preis darf nicht negativ sein'],
      ['e', 'articleId', 'Artikel fehlt'],
      ['g', 'articleId', 'Artikel gibt es nicht mehr'],
      ['g', 'price', 'Preis fehlt'],
      ['d', 'vat', 'USt 7 % gibt es nicht'],
      ['d', 'validTo', '„bis“ liegt vor „ab“'],
      ['t', 'price', 'Preis ist keine Zahl (Beispiel: 4,90)'],
      ['t', 'validFrom', 'Datum ungültig'],
    ],
  )
})

test('Beträge mit Dezimalkomma: streng gelesen, 0 erlaubt, negativ und Text abgewiesen', () => {
  assert.deepEqual(amountInput('4,90'), { value: 4.9 })
  assert.deepEqual(amountInput('1.234,50'), { value: 1234.5 })
  assert.deepEqual(amountInput('€ 5'), { value: 5 })
  assert.deepEqual(amountInput('4.9'), { value: 4.9 })
  assert.deepEqual(amountInput('0'), { value: 0 })
  assert.deepEqual(amountInput(''), { value: '' })
  assert.deepEqual(amountInput(3.5), { value: 3.5 })
  assert.equal(amountInput('-2').error, 'darf nicht negativ sein')
  assert.equal(amountInput(-2).error, 'darf nicht negativ sein')
  assert.equal(amountInput('4,905').error, 'höchstens zwei Stellen nach dem Komma')
  assert.equal(amountInput('vier').error, 'ist keine Zahl (Beispiel: 4,90)')
  assert.equal(amountInput('4,9,0').error, 'ist keine Zahl (Beispiel: 4,90)')
})

test('Eingaben aus dem Kundenblatt: Dezimalkomma, USt vom Artikel, leere Zeilen fallen weg', () => {
  const rows = [
    { id: 'n1', articleId: 'm1', price: '4,35', vat: '', validFrom: '2026-01-01', validTo: '2026-12-31', note: ' Rahmenvertrag ' },
    { id: 'n2', articleId: '', price: '', vat: '', validFrom: '2026-11-06', validTo: '', note: '' },
    { id: 'n3', articleId: 'a2', price: '27', vat: '', validFrom: '', validTo: '', note: '' },
  ]
  const r = customerPriceInputs(rows, { customerId: 'c1', articles })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.prices.map((p) => [p.id, p.customerId, p.price, p.vat, p.currency, p.note]), [['n1', 'c1', 4.35, 20, 'EUR', 'Rahmenvertrag'], ['n3', 'c1', 27, 10, 'EUR', '']])
  const wrong = customerPriceInputs([{ id: 'w', articleId: 'm1', price: '4;90' }, { id: 'v', articleId: 'm1', price: '5', validFrom: '2026-01-01' }], { customerId: 'c1', articles })
  assert.deepEqual(wrong.errors.map((e) => [e.id, e.field]), [['w', 'price'], ['v', 'validFrom']])
  assert.equal(wrong.prices[0].price, '')
})

// ---------------------------------------------------------------- Pauschale je Monat

test('Pauschale je Monat: genauester Eintrag (Liegeplatz vor Objekt vor Kunde), nur beim Preismodell Pauschale', () => {
  const flat = [
    { id: 'c1', name: 'HV', matten: { priceModel: 'pauschale', monthlyFlat: [{ objectId: 'o1', amount: 39, vat: 20 }, { objectId: 'o1', placementId: 'L7', amount: '12,50', vat: 20 }, { amount: 20 }, { objectId: 'o9', amount: 0 }] } },
    { id: 'c2', name: 'AH', matten: { priceModel: 'wechsel', monthlyFlat: [{ amount: 50 }] } },
  ]
  const d = { customers: flat, settings: { vat: 20 } }
  assert.deepEqual(monthlyFlatFor(d, 'c1', { objectId: 'o1', placementId: 'L7' }), { amount: 12.5, vat: 20, currency: 'EUR', scope: 'liegeplatz' })
  assert.deepEqual(monthlyFlatFor(d, 'c1', { objectId: 'o1', placementId: 'L8' }), { amount: 39, vat: 20, currency: 'EUR', scope: 'objekt' })
  assert.deepEqual(monthlyFlatFor(d, 'c1', { objectId: 'o2' }), { amount: 20, vat: 20, currency: 'EUR', scope: 'kunde' })
  assert.deepEqual(monthlyFlatFor(d, 'c1'), { amount: 20, vat: 20, currency: 'EUR', scope: 'kunde' })
  assert.equal(monthlyFlatFor(d, 'c2', { objectId: 'o1' }), null, 'Preismodell je Wechsel')
  assert.equal(monthlyFlatFor(d, 'c9'), null)
  const all = monthlyFlats(d, 'c1')
  assert.equal(all.items.length, 3, 'Beträge 0 fallen weg')
  assert.equal(all.net, 71.5)
  assert.deepEqual(monthlyFlats(d, 'c2'), { items: [], net: 0 })
  assert.equal(monthlyFlats({ customers: [{ id: 'k', matten: { priceModel: 'pauschale', monthlyFlat: [{ amount: 10 }] } }], settings: { vat: 13 } }, 'k').items[0].vat, 13, 'ohne USt: Einstellungen')
})

test('Abrechnung je Kunde: Vorgaben, ungültige Werte, Lieferschein-Mail', () => {
  assert.deepEqual(mattenOf({}), { billing: 'sammel', billingInterval: 'monat', priceModel: 'wechsel', monthlyFlat: [], autoSend: false })
  assert.deepEqual(mattenOf({ matten: { billing: 'einzel', billingInterval: 'quartal', priceModel: 'pauschale', autoSend: true } }), { billing: 'einzel', billingInterval: 'quartal', priceModel: 'pauschale', monthlyFlat: [], autoSend: true })
  assert.deepEqual(mattenOf({ matten: { billing: 'woche', priceModel: 'gratis', autoSend: 'ja' } }), { billing: 'sammel', billingInterval: 'monat', priceModel: 'wechsel', monthlyFlat: [], autoSend: false })
  assert.equal(deliveryNoteEmailOf(customers[1]), 'empfang@ah.example')
  assert.equal(deliveryNoteEmailOf(customers[0]), 'rechnung@hv.example', 'ohne eigene: E-Mail für Rechnungen')
  assert.equal(deliveryNoteEmailOf(null), '')
})

// ---------------------------------------------------------------- Mattentypen

test('Mattentypen: Gruppe „Matten“, nur aktive, nach Größe sortiert', () => {
  assert.deepEqual(matTypes(articles).map((a) => a.id), ['m1', 'm2'])
  assert.deepEqual(matTypes(articles, { all: true }).map((a) => a.id), ['m1', 'm3', 'm2'])
  assert.ok(isMatType({ group: ' matten ' }) && !isMatType({ group: 'Mattenreinigung' }) && !isMatType(null))
  assert.deepEqual(matTypes(undefined), [])
  // dieselbe Auswahl wie der Filter des Moduls
  assert.deepEqual(matTypes(articles, { all: true }).map((a) => a.id).sort(), articles.filter((a) => a.group === 'Matten').map((a) => a.id).sort())
})

test('Mattentypen: Größe einheitlich, Bezeichnung und Kurzbezeichnung mit Menge', () => {
  assert.equal(matSize('85x150'), '85 × 150 cm')
  assert.equal(matSize(' 115 X 200 cm '), '115 × 200 cm')
  assert.equal(matSize('60*90'), '60 × 90 cm')
  assert.equal(matSize('Sondergröße'), 'Sondergröße')
  assert.equal(matName({ size: '85x150', color: 'grau' }), 'Schmutzfangmatte 85 × 150 cm grau')
  assert.equal(matName({ size: '115 × 200 cm', color: 'blau', matKind: 'Logo' }), 'Schmutzfangmatte 115 × 200 cm blau (Logo)')
  assert.equal(matLabel(articles[0]), '85 × 150 cm, grau')
  assert.equal(matLabel(articles[0], 2), '2 × 85 × 150 cm, grau')
  assert.equal(matLabel(articles[2], 1), '1 × 115 × 200 cm, blau, Logo')
  assert.equal(matLabel({ name: 'Läufer Sondermaß' }, 3), '3 × Läufer Sondermaß')
  assert.equal(matLabel(null), '')
  assert.deepEqual(MAT_SIZES, ['85 × 150 cm', '115 × 200 cm', '150 × 250 cm', '85 × 120 cm'])
})

// ---------------------------------------------------------------- Datei bleibt gültig

test('Neue Felder sind optional: alte Dateien ohne Kundenpreise gültig, Prüfsumme der Belege unverändert', () => {
  const old = emptyInvoicing()
  assert.ok(!('customerPrices' in old), 'leere Datei wie bisher')
  assert.deepEqual(priceFor(old, 'c1', 'x', '2026-11-06'), null)
  assert.equal(priceFor({ ...old, articles }, 'c1', 'm1', '2026-11-06').source, 'standard')
  assert.deepEqual(mattenOf(old.customers[0]), mattenOf({}))
  const doc = { kind: 'rechnung', number: 'RE-2026-0001', date: '2026-11-06', lines: [{ id: 'l1', text: 'Mattenwechsel', qty: 2, unit: 'Stk', price: 4.2, vat: 20 }], total: { net: 8.4, vat: 1.68, gross: 10.08 } }
  // Kundenfelder für den Mattenwechsel stehen nicht im Beleg: die Prüfsumme bleibt dieselbe
  assert.equal(checksumOf({ ...doc, customerId: 'c1' }), checksumOf(doc))
})
