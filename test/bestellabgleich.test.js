// Eingangsrechnung gegen Bestellung (Material & Lager): Abgleich mit Wareneingang bzw. Bestellwert, Toleranz,
// mehrere Rechnungen, Vorschlag der passenden Bestellung (core/purchase.js orderMatch, suggestOrder).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderMatch, suggestOrder } from '../src/core/purchase.js'

const order = (id, status, lines, supplierId = 'm1') => ({ id, no: `B-${id}`, supplierId, status, lines })
const inv = (id, net, extra = {}) => ({ id, no: `ER-${id}`, supplierId: 's1', groups: [{ rate: 20, net, vat: net * 0.2 }], ...extra })
const orders = [
  order('o1', 'geliefert', [{ articleId: 'a', qty: 10, price: 12, received: 10 }, { articleId: 'b', qty: 5, price: 20, received: 5 }]), // 220
  order('o2', 'teilweise', [{ articleId: 'a', qty: 10, price: 12, received: 4 }]), // bestellt 120, geliefert 48
  order('o3', 'bestellt', [{ articleId: 'c', qty: 2, price: 100 }]), // 200, nichts geliefert
  order('o4', 'geliefert', [{ articleId: 'c', qty: 1, price: 205 }], 'm2'), // anderer Lieferant
]

test('Abgleich: passt, über dem Lieferwert, Teillieferung, nichts geliefert, mehrere Rechnungen, fehlende Bestellung', () => {
  assert.equal(orderMatch(inv('1', 100), { orders }), null)
  const ok = orderMatch(inv('1', 223, { orderId: 'o1' }), { orders })
  assert.equal(ok.level, 'ok') // 3 € ≤ 5 € Toleranz
  assert.equal(ok.basis, 220)
  const high = orderMatch(inv('1', 260, { orderId: 'o1' }), { orders })
  assert.equal(high.level, 'warn')
  assert.match(high.notes.at(-1).text, /Die Rechnung liegt 40,00 € über dem Wert der gelieferten Ware \(220,00 €\)/)
  const part = orderMatch(inv('2', 48, { orderId: 'o2' }), { orders })
  assert.equal(part.level, 'ok')
  assert.match(part.notes[0].text, /Erst teilweise geliefert: 48,00 € von 120,00 €/)
  const none = orderMatch(inv('3', 200, { orderId: 'o3' }), { orders })
  assert.equal(none.level, 'info')
  assert.match(none.notes[0].text, /Wareneingang noch nicht gebucht – verglichen mit dem Bestellwert 200,00 €/)
  // zweite Rechnung zur selben Bestellung: zusammen über dem Lieferwert
  const first = inv('1', 220, { orderId: 'o1' })
  const second = inv('9', 220, { orderId: 'o1' })
  const dup = orderMatch(second, { orders, invoices: [first, second] })
  assert.equal(dup.level, 'warn')
  assert.match(dup.notes.map((n) => n.text).join(' '), /gibt es schon die Rechnung ER-1 über 220,00 €.*Die Rechnungen liegen zusammen 220,00 € über/)
  // stornierte Erfassung zählt nicht
  assert.equal(orderMatch(second, { orders, invoices: [{ ...first, cancelled: { at: 'x' } }, second] }).level, 'ok')
  assert.equal(orderMatch(inv('1', 10, { orderId: 'weg' }), { orders }).level, 'warn')
})

test('Vorschlag: Bestellung beim verknüpften Lieferanten, noch ohne Rechnung, innerhalb der Toleranz', () => {
  const suppliers = [{ id: 's1', materialId: 'm1' }]
  assert.equal(suggestOrder(inv('1', 218), { orders, suppliers }).order.id, 'o1')
  assert.equal(suggestOrder(inv('1', 49), { orders, suppliers }).order.id, 'o2') // Lieferwert der Teillieferung
  assert.equal(suggestOrder(inv('1', 201), { orders, suppliers }).order.id, 'o3') // nichts geliefert: Bestellwert
  assert.equal(suggestOrder(inv('1', 150), { orders, suppliers }), null)
  assert.equal(suggestOrder(inv('1', 218), { orders, suppliers, invoices: [inv('x', 220, { orderId: 'o1' })] }), null) // schon verrechnet
  assert.equal(suggestOrder(inv('1', 218), { orders, suppliers: [{ id: 's1' }] }), null) // Lieferant nicht verknüpft
  assert.equal(suggestOrder(inv('1', 218, { orderId: 'o1' }), { orders, suppliers }), null) // schon verknüpft
})
