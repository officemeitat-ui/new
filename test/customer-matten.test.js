// Mattenwechsel im Kundenbereich (core/customer-matten.js): welche Lieferscheine ein Link zeigt (nur festgeschrieben,
// nicht storniert, nur seine Kunden und Objekte, Zeitraum), was der Webspace je Lieferschein bekommt (keine Preise), der
// nächste Wechsel je Liegeplatz (nur Datum) und die Schalter in kunden.php. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { nextExchanges, NOTE_FILE_PATTERN, noteEntry, noteFile, notePlaces, noteSigner, noteSigText, portalNotes } from '../src/core/customer-matten.js'
import { deliveryNoteSettings, linkMail, linkPayload, NOTE_MONTH_CHOICES, SHOW, showDefaults, suggestNoteCustomers } from '../src/core/customer-portal.js'
import { finalize, stornoDraft } from '../src/core/invoicing.js'
import { confirmPlacement, finishStop, markNotPossible, setQuantity } from '../src/core/matten-fahrt.js'
import { createNote } from '../src/core/matten-lieferschein.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'

const PHP = readFileSync(new URL('../kunden.php', import.meta.url), 'utf8')
const DAY = '2026-11-09'
const T = (d, h, m = 0) => `${d}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z` // Wien = UTC+1
const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><path d="M10 10L50 50"/></svg>'
const by = 'Markus Huber'

const gross = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const klein = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg', lat: 47.79, lon: 13.005 },
]
const lp = (id, objectId, customer, mats, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats, intervalDays: 14, startDate: '2026-10-26', rule: 'rhythmus', ...extra })
const placements = [
  lp('Haupteingang', 'o1', hv, [{ ...gross, qty: 2 }], { floor: 'EG' }),
  lp('Stiege 2', 'o1', hv, [{ ...klein, qty: 1 }]),
  // zweiter Kunde am selben Objekt (eigener Stopp, eigener Lieferschein)
  lp('Geschäftslokal', 'o1', ah, [{ ...gross, qty: 1 }]),
  lp('Schauraum', 'o2', ah, [{ ...gross, qty: 3 }]),
]

/** Fakturierung (erfunden): zwei Kunden, zwei Mattentypen mit Preisen, ein Kundenpreis. */
const fak = () => ({
  settings: { sender: { name: 'Reinigung Beispiel GmbH', address: 'Beispielgasse 1\n5020 Salzburg', uid: 'ATU00000000' }, vat: 20 },
  customers: [
    { id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', street: 'Ringstraße 3', zip: '5020', city: 'Salzburg', objectIds: ['o1'] },
    { id: 'c2', customerNo: '10002', name: 'Autohaus Muster KG', street: 'Autoweg 7', zip: '5020', city: 'Salzburg', objectIds: ['o2'] },
  ],
  articles: [
    { id: 'a-m1', articleNo: 'MA-01', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', unit: 'Stk', price: 4.9, vat: 20 },
    { id: 'a-m2', articleNo: 'MA-02', group: 'Matten', name: 'Schmutzfangmatte 60 × 90 cm navy', size: '60 × 90 cm', color: 'navy', unit: 'Stk', price: 3.2, vat: 20 },
  ],
  customerPrices: [{ id: 'kp1', customerId: 'c1', articleId: 'a-m1', price: 4.37, vat: 20, validFrom: '2026-01-01', validTo: '' }],
  documents: [],
})

/** Tour eines Tages mit allen Liegeplätzen: je Objekt und Kunde ein Stopp. */
function tourOn(date, id) {
  const jobs = placements.map((p) => ({ id: `${p.id}:${date}`, key: `${p.id}:${date}`, placementId: p.id, due: date, status: 'geplant' }))
  const stops = stopsFromJobs({ jobs, placements, objects, date })
  // nach der Freigabe stehen die Einsätze „in Tour“
  return { tour: { schema: 1, id, date, driverId: 'e2', driverName: by, status: 'unterwegs', order: stops.map((s) => s.id), stops, createdAt: T(date, 6) }, jobs: jobs.map((j) => ({ ...j, status: 'in-tour', tourId: id })) }
}
const stopOf = (tour, customerId, objectId) => tour.stops.find((s) => s.customer?.id === customerId && s.objectId === objectId)

/**
 * Lieferscheine: HV an o1 heute (Haupteingang 1 statt 2, Stiege 2 nicht möglich, unterschrieben), HV an o1 vor 20 Tagen
 * (ohne Unterschrift), Autohaus am selben Objekt o1 und an o2, HV vor 15 Monaten (zu alt). Dazu ein Lieferschein von
 * Hand, ein Entwurf, ein nachträglich veränderter und ein stornierter.
 */
function setup() {
  const f = fak()
  const make = (date, tourId, fill) => {
    const { tour } = tourOn(date, tourId)
    const t = fill(tour)
    for (const s of t.stops.filter((x) => x.status !== 'geplant' && x.finishedAt)) f.documents.push(createNote({ tour: t, stop: s, data: f, id: `ls-${tourId}-${s.id}`, now: s.finishedAt, by: 'Büro' }).doc)
    return t
  }
  const sHv = (t) => stopOf(t, 'c1', 'o1').id
  const sAh1 = (t) => stopOf(t, 'c2', 'o1').id
  const sAh2 = (t) => stopOf(t, 'c2', 'o2').id
  make(DAY, 'mt-heute', (t) => {
    t = confirmPlacement(t, sHv(t), 'Haupteingang', { now: T(DAY, 9, 30), by })
    t = setQuantity(t, sHv(t), 0, 1, { now: T(DAY, 9, 31), by })
    t = markNotPossible(t, sHv(t), 'Stiege 2', 'kein Zugang', { now: T(DAY, 9, 33), by })
    t = finishStop(t, sHv(t), { signature: { name: 'Eva Beispiel', role: 'Hausbetreuung', svg: SIG }, now: T(DAY, 9, 41), by })
    t = confirmPlacement(t, sAh1(t), 'Geschäftslokal', { now: T(DAY, 9, 50), by })
    t = finishStop(t, sAh1(t), { signature: { name: 'Max Muster', role: 'Filialleitung', svg: SIG }, now: T(DAY, 9, 52), by })
    t = confirmPlacement(t, sAh2(t), 'Schauraum', { now: T(DAY, 10, 20), by })
    return finishStop(t, sAh2(t), { reason: 'niemand vor Ort', now: T(DAY, 10, 25), by })
  })
  make('2026-10-20', 'mt-oktober', (t) => {
    t = confirmPlacement(t, sHv(t), 'Haupteingang', { now: T('2026-10-20', 8), by })
    t = confirmPlacement(t, sHv(t), 'Stiege 2', { now: T('2026-10-20', 8, 2), by })
    return finishStop(t, sHv(t), { reason: 'niemand vor Ort', now: T('2026-10-20', 8, 5), by })
  })
  make('2025-08-04', 'mt-alt', (t) => {
    t = confirmPlacement(t, sHv(t), 'Haupteingang', { now: T('2025-08-04', 8), by })
    t = confirmPlacement(t, sHv(t), 'Stiege 2', { now: T('2025-08-04', 8, 1), by })
    return finishStop(t, sHv(t), { reason: 'niemand vor Ort', now: T('2025-08-04', 8, 5), by })
  })
  // Lieferschein von Hand (nicht aus dem Mattenwechsel), Entwurf, verändert und storniert
  f.documents.push(finalize({ id: 'ls-hand', kind: 'lieferschein', status: 'entwurf', date: '2026-11-02', customerId: 'c1', objectId: 'o1', recipient: { name: 'Hausverwaltung Beispiel GmbH', address: 'Ringstraße 3\n5020 Salzburg' }, lines: [{ id: 'h1', text: 'Reinigungsmittel', qty: 1, unit: 'Stk', price: 10, vat: 20 }] }, f.documents, f.settings, { now: T('2026-11-02', 9), by: 'Büro' }))
  const base = f.documents.find((d) => d.id.startsWith('ls-mt-oktober'))
  f.documents.push({ ...base, id: 'ls-entwurf', number: '', checksum: '', status: 'entwurf', source: { ...base.source, key: 'matten:mt-x:st-x' } })
  const tampered = { ...base, id: 'ls-veraendert', number: 'LS-2026-000090', source: { ...base.source, key: 'matten:mt-y:st-y' } }
  tampered.lines = tampered.lines.map((l) => (l.type === 'item' || !l.type ? { ...l, qty: 99 } : l))
  f.documents.push(tampered)
  f.documents.push({ ...base, id: 'ls-storniert', number: 'LS-2026-000091', status: 'storniert', cancelledAt: T('2026-10-21', 9), source: { ...base.source, key: 'matten:mt-z:st-z' } })
  return f
}

test('Kundenbereich: Schalter für Lieferscheine und nächsten Wechsel, Standard aus, gleiche Namen in kunden.php', () => {
  assert.equal(showDefaults().lieferscheine, false)
  assert.equal(showDefaults().mattenwechsel, false)
  assert.deepEqual(deliveryNoteSettings({}), { customerIds: [], months: 13 })
  assert.deepEqual(deliveryNoteSettings({ deliveryNotes: { customerIds: ['c1'], months: 6 } }), { customerIds: ['c1'], months: 6 })
  assert.deepEqual(NOTE_MONTH_CHOICES, [3, 6, 13, 24])
  for (const k of ['lieferscheine', 'mattenwechsel']) assert.ok(PHP.includes(`'${k}'`) && SHOW[k], k)
  assert.ok(PHP.includes(`const LS_MUSTER = '/${NOTE_FILE_PATTERN.source}/';`), 'gleiches Muster in kunden.php')
  assert.equal(noteFile({ number: 'LS-2026-000123' }), 'lieferschein-LS-2026-000123.pdf')
  assert.equal(noteFile({ number: 'LS/2026 7' }), 'lieferschein-LS-2026-7.pdf')
  assert.ok(NOTE_FILE_PATTERN.test('lieferschein-LS-2026-000123.pdf') && !NOTE_FILE_PATTERN.test('../lieferschein-LS-1.pdf') && !NOTE_FILE_PATTERN.test('lieferschein-LS-1.pdf.php') && !NOTE_FILE_PATTERN.test('rechnung-RE-1.pdf'))
})

test('Lieferscheine eines Links: nur festgeschrieben, aus dem Mattenwechsel, nicht storniert, seine Kunden und Objekte, Zeitraum', () => {
  const f = setup()
  const docs = f.documents
  const nr = (list) => list.map((d) => d.id)
  // HV an o1: heute und Oktober; nicht der zu alte, nicht von Hand, kein Entwurf, nicht verändert, nicht storniert
  const hvO1 = portalNotes(docs, { customerIds: ['c1'], objectIds: ['o1'], months: 13, today: DAY })
  assert.equal(hvO1.length, 2, nr(hvO1).join())
  assert.ok(hvO1[0].id.startsWith('ls-mt-heute') && hvO1[1].id.startsWith('ls-mt-oktober'), 'neueste zuerst')
  assert.ok(hvO1.every((d) => d.customerId === 'c1' && d.objectId === 'o1' && d.number && d.source.type === 'matten'))
  // fremder Kunde am selben Objekt nicht dabei; der eigene Kunde an einem fremden Objekt auch nicht
  assert.ok(!hvO1.some((d) => d.customerId === 'c2'))
  assert.deepEqual(portalNotes(docs, { customerIds: ['c1'], objectIds: ['o2'], months: 13, today: DAY }), [])
  // Autohaus an beiden Objekten
  assert.equal(portalNotes(docs, { customerIds: ['c2'], objectIds: ['o1', 'o2'], months: 13, today: DAY }).length, 2)
  // ohne Kunden oder Objekte: nichts
  assert.deepEqual(portalNotes(docs, { customerIds: [], objectIds: ['o1'], today: DAY }), [])
  assert.deepEqual(portalNotes(docs, { customerIds: ['c1'], objectIds: [], today: DAY }), [])
  // Zeitraum: 24 Monate nimmt den alten dazu, 3 Monate nur die jüngsten
  assert.equal(portalNotes(docs, { customerIds: ['c1'], objectIds: ['o1'], months: 24, today: DAY }).length, 3)
  // Storno: ein Lieferschein mit Status „storniert“ und einer mit Storno-Beleg fallen weg
  const storniert = docs.map((d) => (d.id === hvO1[0].id ? { ...d, status: 'storniert', cancelledAt: T(DAY, 12) } : d))
  assert.deepEqual(nr(portalNotes(storniert, { customerIds: ['c1'], objectIds: ['o1'], today: DAY })), [hvO1[1].id])
  const stornoBeleg = [...docs, { id: 'st1', kind: 'storno', number: 'ST-2026-0001', refId: hvO1[1].id }]
  assert.deepEqual(nr(portalNotes(stornoBeleg, { customerIds: ['c1'], objectIds: ['o1'], today: DAY })), [hvO1[0].id])
  // eine Storno-Rechnung zu einer Rechnung betrifft den Lieferschein nicht
  assert.throws(() => stornoDraft(hvO1[0], { id: 'x', date: DAY }), /Nur festgeschriebene Rechnungen/)
})

test('Was der Webspace je Lieferschein bekommt: Nummer, Datum, Objekt, Liegeplätze mit Mengen, Unterschrift – keine Preise', () => {
  const f = setup()
  const [heute, oktober] = portalNotes(f.documents, { customerIds: ['c1'], objectIds: ['o1'], today: DAY })
  const e = noteEntry(heute, { sig: 'a'.repeat(32) })
  assert.deepEqual(Object.keys(e), ['datei', 'nummer', 'datum', 'zeit', 'objekt', 'liegeplaetze', 'unterschrift', 'name', 'sig'])
  assert.equal(e.datei, `lieferschein-${heute.number}.pdf`)
  assert.match(e.nummer, /^LS-2026-\d{6}$/)
  assert.deepEqual([e.datum, e.zeit, e.objekt], [DAY, '09:41', 'Wohnanlage Beispielweg'])
  assert.deepEqual(e.liegeplaetze, [
    { name: 'Haupteingang (EG)', matten: [{ text: 'Schmutzfangmatte 85 × 150 cm grau', menge: 1 }], hinweise: [] },
    { name: 'Stiege 2', matten: [], hinweise: ['Nicht gewechselt: 1 × 60 × 90 cm, navy – kein Zugang'] },
  ])
  assert.deepEqual(e.unterschrift, { name: 'Eva Beispiel', funktion: 'Hausbetreuung' })
  assert.match(e.name, /^LS-2026-\d{6}_Hausverwaltung_Beispiel_GmbH_2026-11-09\.pdf$/)
  // keine Preise, Beträge, Artikelnummern, kein Fahrer, keine Unterschrift als Bild
  const json = JSON.stringify(e)
  for (const bad of ['price', 'preis', 'betrag', 'netto', 'brutto', '4.37', '4,37', 'MA-01', 'svg', 'Markus Huber', 'discount', 'vat']) assert.ok(!json.toLowerCase().includes(bad.toLowerCase()), bad)
  assert.ok(heute.lines.some((l) => l.price === 4.37), 'der Beleg selbst hat den Preis')
  // ohne Unterschrift: Grund
  const o = noteEntry(oktober, { sig: 'b'.repeat(32) })
  assert.deepEqual(o.unterschrift, { ohne: true, grund: 'niemand vor Ort' })
  assert.deepEqual(o.liegeplaetze.map((p) => [p.name, p.matten.map((m) => m.menge)]), [['Haupteingang (EG)', [2]], ['Stiege 2', [1]]])
  // Signatur ändert sich mit dem Beleg, nicht mit Versand oder Ablage
  assert.equal(noteSigText(heute), noteSigText({ ...heute, sent: [{ at: T(DAY, 12) }], archive: { itemId: 'x' } }))
  assert.notEqual(noteSigText(heute), noteSigText({ ...heute, checksum: 'anders' }))
  // Positionen ohne Titel und ohne Beleg
  assert.deepEqual(notePlaces({ lines: [{ text: 'Matte', qty: '2' }] }), [{ name: 'Liegeplatz', matten: [{ text: 'Matte', menge: 2 }], hinweise: [] }])
  assert.equal(noteSigner({}), null)
})

test('Übertragen: Lieferscheine und nächster Wechsel im Paket des Links, aus = am Webspace löschen, ohne Recht = letzter Stand', () => {
  const link = { id: 'kb0123456789', title: 'HV', objectIds: ['o1'], token: 'x', show: { ...showDefaults() }, deliveryNotes: { customerIds: ['c1'], months: 6 } }
  const ls = [{ datei: 'lieferschein-LS-2026-000001.pdf' }]
  const next = [{ datum: DAY, objekt: 'Wohnanlage', liegeplatz: 'Haupteingang' }]
  let p = linkPayload({ link, hash: 'h', lieferscheine: ls, mattenwechsel: next })
  assert.deepEqual([p.lieferscheine, p.mattenwechsel], [[], []], 'aus: am Webspace löschen')
  const on = { ...link, show: { ...link.show, lieferscheine: true, mattenwechsel: true } }
  p = linkPayload({ link: on, hash: 'h', lieferscheine: ls, mattenwechsel: next })
  assert.deepEqual([p.lieferscheine, p.lieferscheineMonate, p.mattenwechsel, p.zeige.lieferscheine, p.zeige.mattenwechsel], [ls, 6, next, true, true])
  p = linkPayload({ link: on, hash: 'h' })
  assert.deepEqual([p.lieferscheine, p.mattenwechsel], [null, null], 'ohne Recht: der Webspace behält den letzten Stand')
  assert.match(linkMail({ link: on, url: 'u' }).text, /den nächsten Mattenwechsel, die Lieferscheine zum Mattenwechsel als PDF/)
  assert.ok(!/Mattenwechsel/.test(linkMail({ link, url: 'u' }).text))
})

test('Nächster Mattenwechsel je Liegeplatz: nur Tag, nur Kunden und Objekte des Links, aktive, mit Einsätzen und Touren', () => {
  const doc = { schema: 1, settings: { closures: [] }, areas: [], placements: [...placements, lp('Keller', 'o1', hv, [{ ...gross, qty: 1 }], { active: false }), lp('Hof', 'o1', hv, [{ ...gross, qty: 1 }], { pauses: [{ from: '2026-11-01', to: '', reason: 'Umbau' }] })] }
  const objectsById = new Map(objects.map((o) => [o.id, o]))
  const base = { doc, customerIds: ['c1'], objectIds: ['o1'], today: DAY, objectsById }
  // ohne Einsätze: Rhythmus ab Starttermin (26.10. + 14 Tage = heute)
  let r = nextExchanges(base)
  assert.deepEqual(r, [
    { datum: DAY, objekt: 'Wohnanlage Beispielweg', liegeplatz: 'Haupteingang (EG)' },
    { datum: DAY, objekt: 'Wohnanlage Beispielweg', liegeplatz: 'Stiege 2' },
  ])
  assert.deepEqual(Object.keys(r[0]), ['datum', 'objekt', 'liegeplatz'], 'nur Tag, Objekt und Liegeplatz')
  // verschobener Einsatz: der neue Tag
  const jobs = [{ id: `Haupteingang:${DAY}`, key: `Haupteingang:${DAY}`, placementId: 'Haupteingang', due: DAY, planned: '2026-11-11', status: 'geplant' }]
  r = nextExchanges({ ...base, jobs })
  assert.equal(r.find((x) => x.liegeplatz === 'Haupteingang (EG)').datum, '2026-11-11')
  // Einsatz in einer Tour, die heute gewechselt hat: der nächste Wechsel in 14 Tagen (Stand der Touren wie in der Übersicht)
  const { tour, jobs: inTour } = tourOn(DAY, 'mt-heute')
  let t = confirmPlacement(tour, stopOf(tour, 'c1', 'o1').id, 'Haupteingang', { now: T(DAY, 9), by })
  t = confirmPlacement(t, stopOf(t, 'c1', 'o1').id, 'Stiege 2', { now: T(DAY, 9, 1), by })
  t = finishStop(t, stopOf(t, 'c1', 'o1').id, { reason: 'niemand vor Ort', now: T(DAY, 9, 5), by })
  r = nextExchanges({ ...base, jobs: inTour, tours: [t] })
  assert.deepEqual(r.map((x) => [x.liegeplatz, x.datum]), [['Haupteingang (EG)', '2026-11-23'], ['Stiege 2', '2026-11-23']])
  // fremder Kunde am selben Objekt nicht, ohne Kunden nichts
  assert.ok(!nextExchanges(base).some((x) => x.liegeplatz === 'Geschäftslokal'))
  assert.deepEqual(nextExchanges({ ...base, customerIds: ['c2'], objectIds: ['o1'] }).map((x) => x.liegeplatz), ['Geschäftslokal'])
  assert.deepEqual(nextExchanges({ ...base, customerIds: [] }), [])
})

test('Kunden für den Mattenwechsel vorschlagen: Objekte, Lieferscheine und Liegeplätze an den Objekten des Links', () => {
  const f = setup()
  assert.deepEqual(suggestNoteCustomers({ customers: f.customers, docs: f.documents, placements, objectIds: ['o1'] }), ['c1', 'c2'])
  assert.deepEqual(suggestNoteCustomers({ customers: f.customers, docs: [], placements: [], objectIds: ['o2'] }), ['c2'])
  assert.deepEqual(suggestNoteCustomers({ customers: f.customers.slice(0, 1), docs: f.documents, placements, objectIds: ['o2'] }), [], 'nur Kunden der Fakturierung')
})
