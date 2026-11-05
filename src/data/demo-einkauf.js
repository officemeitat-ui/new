// Beispieldaten für Einkauf & Kasse (Vorschau im Browser-Modus). Alles erfunden („Beispiel“-Namen, Test-IBANs);
// Daten relativ zu heute, damit immer etwas fällig, überfällig und mit Skonto zu sehen ist. Die Lieferanten 1 und 2
// sind mit den Lieferanten in Material & Lager verknüpft (s-demo1, s-demo2).

import { addEntry, emptyCashbook, openingBalance, stornoEntry } from '../core/cashbook.js'
import { addDays, firstOfMonth, todayISO } from '../core/dates.js'

export function createPurchaseDemo() {
  const today = todayISO()
  const d = (n) => addDays(today, n)
  const prevFirst = firstOfMonth(addDays(firstOfMonth(today), -1))
  const pd = (n) => addDays(prevFirst, n - 1) // n-ter Tag des Vormonats
  const year = today.slice(0, 4)
  const suppliers = [
    { id: 'ls-demo1', supplierNo: '70001', name: 'Hygiene-Großhandel Beispiel GmbH', street: 'Industriestraße 4', zip: '5020', city: 'Salzburg', country: 'AT', phone: '0662 000 000', email: 'rechnung@hygiene-beispiel.example', uid: 'ATU12345675', iban: 'AT802040400000123456', bic: '', customerNo: 'K-1020', paymentDays: 30, skontoPercent: 2, skontoDays: 10, category: 'material', materialId: 's-demo1', contacts: [{ id: 'ls-demo1-k1', name: 'Frau Huber', role: 'Verkauf', email: 'bestellung@hygiene-beispiel.example', phone: '' }], active: true },
    { id: 'ls-demo2', supplierNo: '70002', name: 'Papier & Co Beispiel', street: 'Gewerbepark 2', zip: '5071', city: 'Wals', country: 'AT', email: 'buchhaltung@papier-beispiel.example', uid: 'ATU23456789', iban: 'AT253500000000654321', paymentDays: 14, category: 'material', materialId: 's-demo2', active: true },
    { id: 'ls-demo3', supplierNo: '70003', name: 'Glasreinigung Partner Beispiel KG', street: 'Am Bach 9', zip: '5400', city: 'Hallein', country: 'AT', uid: 'ATU34567891', iban: 'AT611200000000777888', paymentDays: 14, category: 'fremd', reverseCharge: true, note: 'Subunternehmer Glasreinigung (Bauleistung: Reverse Charge)', active: true },
    { id: 'ls-demo4', supplierNo: '70004', name: 'Tankstelle Beispiel', street: 'Bundesstraße 1', zip: '5020', city: 'Salzburg', country: 'AT', category: 'kfz', paymentDays: 0, active: true },
    { id: 'ls-demo5', supplierNo: '70005', name: 'Steuerberatung Beispiel', street: 'Kanzleigasse 3', zip: '5020', city: 'Salzburg', country: 'AT', iban: 'AT873400000000111222', paymentDays: 14, category: 'beratung', active: true },
  ]
  const snap = (s) => ({ name: s.name, address: `${s.street}\n${s.zip} ${s.city}`, uid: s.uid || '' })
  const inv = (no, s, extra) => ({ id: `er-demo${no}`, no: `ER-${year}-${String(no).padStart(4, '0')}`, supplierId: s.id, supplier: snap(s), checks: { recipient: true }, payments: [], createdAt: `${extra.date}T09:00:00.000Z`, createdBy: 'Beispieldaten', history: [{ at: `${extra.date}T09:00:00.000Z`, by: 'Beispieldaten', text: 'erfasst' }], ...extra })
  const [s1, s2, s3, s4, s5] = suppliers
  const invoices = [
    inv(1, s1, { number: 'RE-4410', date: d(-40), serviceFrom: d(-42), text: '12 Kanister Allzweckreiniger, 20 Rollen Müllsäcke', groups: [{ rate: 20, net: 412.5, vat: 82.5 }], category: 'material', account: '5300', dueDate: d(-10), approval: { by: 'Beispieldaten', at: `${d(-38)}T10:00:00.000Z` }, payments: [{ id: 'zp-demo1', date: d(-30), amount: 495, method: 'bank', note: 'Überweisung', by: 'Beispieldaten', at: `${d(-30)}T10:00:00.000Z` }] }),
    inv(2, s1, { number: 'RE-4498', date: d(-4), serviceFrom: d(-5), text: '6 Kartons Papierhandtücher, 4 Kanister Handseife', groups: [{ rate: 20, net: 268, vat: 53.6 }], category: 'material', account: '5300', dueDate: d(26), skonto: { percent: 2, days: 10 } }),
    inv(3, s2, { number: '2026/0815', date: d(-35), serviceFrom: d(-36), text: '30 Packungen Toilettenpapier', groups: [{ rate: 20, net: 186, vat: 37.2 }], category: 'material', account: '5300', dueDate: d(-21), approval: { by: 'Beispieldaten', at: `${d(-33)}T10:00:00.000Z` } }),
    inv(4, s3, { number: 'GR-118', date: d(-12), serviceFrom: firstOfMonth(d(-12)), serviceTo: d(-13), text: 'Glasreinigung Gewerbepark Bergheim, 640 m²', groups: [{ rate: 20, net: 1280, vat: 0 }], reverseCharge: true, checks: { recipient: true, ourUid: true, rcNote: true }, category: 'fremd', account: '5700', objectId: 'o8', dueDate: d(2) }),
    inv(5, s4, { number: '', date: pd(20), serviceFrom: pd(20), text: '35 l Diesel Firmenbus', groups: [{ rate: 20, net: 48.67, vat: 9.73 }], category: 'kfz', account: '7320', dueDate: pd(20), checks: {} }),
    inv(6, s5, { number: 'H-2026-31', date: d(-3), serviceFrom: firstOfMonth(d(-35)), serviceTo: addDays(firstOfMonth(today), -1), text: 'Buchhaltung und Lohnverrechnung Vormonat', groups: [{ rate: 20, net: 640, vat: 128 }], category: 'beratung', account: '7750', dueDate: d(11) }),
  ]
  // Kassenbuch: Anfangsbestand im Vormonat, Barkauf, Barzahlung eines Kunden, Tankstelle bar (mit Eingangsrechnung), ein Storno
  const kasse = emptyCashbook()
  let n = 0
  const at = (date) => ({ newId: () => `kb-demo${++n}`, now: `${date}T${String(8 + n).padStart(2, '0')}:00:00.000Z`, by: 'Beispieldaten', today: date })
  openingBalance(kasse, { date: pd(1), amount: 250, note: 'Endbestand altes Kassenbuch' }, at(pd(1)))
  addEntry(kasse, { date: pd(5), kind: 'ausgabe', amount: 23.9, text: 'Glasreiniger und Schwämme, Baumarkt Beispiel', rate: 20, category: 'ek-material', account: '5300', receipt: 'Bon 1187' }, at(pd(5)))
  const wrong = addEntry(kasse, { date: pd(6), kind: 'ausgabe', amount: 99.9, text: 'Parkgebühr (Betrag vertippt)', rate: 0, category: 'ausgabe-sonst', account: '7320' }, at(pd(6)))
  stornoEntry(kasse, wrong.id, { reason: 'Betrag vertippt (9,90 €)' }, at(pd(6)))
  addEntry(kasse, { date: pd(6), kind: 'ausgabe', amount: 9.9, text: 'Parkgebühr Altstadt', rate: 0, category: 'ausgabe-sonst', account: '7320' }, at(pd(6)))
  addEntry(kasse, { date: pd(12), kind: 'einnahme', amount: 180, text: 'Barzahlung Sonderreinigung Fam. Beispiel', rate: 20, category: 'verkauf', account: '4000', receipt: 'Quittung 12' }, at(pd(12)))
  const fuel = addEntry(kasse, { date: pd(20), kind: 'ausgabe', amount: 58.4, text: 'Zahlung Tankstelle Beispiel (Diesel)', rate: 0, category: 'eingang', account: '3300', ref: { type: 'eingang', id: 'er-demo5', number: invoices[4].no } }, at(pd(20)))
  invoices[4].payments = [{ id: 'zp-demo5', date: pd(20), amount: 58.4, method: 'bar', cash: fuel.id, note: `bar, Kassenbuch Nr. ${fuel.no}`, by: 'Beispieldaten', at: `${pd(20)}T10:00:00.000Z` }]
  const now = [addDays(firstOfMonth(today), 1), today].sort()[0]
  addEntry(kasse, { date: now, kind: 'ausgabe', amount: 12.5, text: 'Porto Einschreiben', rate: 0, category: 'ausgabe-sonst', account: '7600' }, at(now))
  return {
    einkauf: { suppliers, invoices, bankIgnored: {}, sepaRuns: [], settings: {} },
    kasse,
  }
}
