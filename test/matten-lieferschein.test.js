// Mattenwechsel P12/P13: Lieferschein je Stopp als Beleg der Fakturierung, PDF ohne Preise mit Unterschrift, Ablage in
// SharePoint (Pfad, kein Doppel, Warteschlange), Versand und Rechte (core/matten-lieferschein.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checksumOf, finalize, intact, nextNumber, totals } from '../src/core/invoicing.js'
import { resolveAccess } from '../src/core/access.js'
import { confirmPlacement, finishStop, markNotPossible, reopenProblem, reopenStop, setQuantity, setPlacementNote } from '../src/core/matten-fahrt.js'
import {
  archiveState,
  createNote,
  digitsMissing,
  findNote,
  lineKey,
  mailRecipients,
  mailState,
  markArchived,
  markArchiveFailed,
  markArchiveQueued,
  markMailFailed,
  markSent,
  noteFileName,
  noteKey,
  noteLines,
  noteMail,
  noteNeeded,
  notePath,
  noteRights,
  noteRows,
  noteStateOf,
  noteSummary,
  numberSettings,
  rowMatches,
  stopNeedsSync,
  stopNote,
} from '../src/core/matten-lieferschein.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'
import { invoiceDocument } from '../src/export/invoice-pdf.js'
import { SharePointDocStore } from '../src/storage/docstore-sharepoint.js'
import { CachedDocStore, memoryCache } from '../src/storage/offline.js'
import { dataRights, MODULE_DOCS, toolFolderRights } from '../src/storage/data-service.js'

const DAY = '2026-11-09'
const T = (h, m = 0) => `${DAY}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z` // Wien = UTC+1
const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200"><path d="M10 10L50 50" fill="none" stroke="#13232f"/></svg>'
const by = 'Markus Huber'
const at = (h, m) => ({ now: T(h, m), by })

const gross = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const klein = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg', lat: 47.79, lon: 13.005 },
  { id: 'o3', name: 'Büro Nord', address: 'Nordweg 4, 5020 Salzburg', lat: 47.823, lon: 13.03 },
]
const lp = (id, objectId, customer, mats, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats, intervalDays: 14, startDate: '2026-10-26', rule: 'rhythmus', ...extra })
const placements = [
  lp('Haupteingang', 'o1', hv, [{ ...gross, qty: 2 }], { floor: 'EG' }),
  lp('Stiege 2', 'o1', hv, [{ ...klein, qty: 1 }]),
  lp('Tiefgarage', 'o1', hv, [{ ...gross, qty: 1 }, { ...klein, qty: 2 }]),
  lp('Schauraum', 'o2', ah, [{ ...gross, qty: 3 }]),
  lp('Foyer', 'o3', hv, [{ ...klein, qty: 1 }]),
]
const job = (placementId, due) => ({ key: `${placementId}:${due}`, placementId, due, status: 'geplant' })
const jobs = ['Haupteingang', 'Stiege 2', 'Tiefgarage', 'Schauraum', 'Foyer'].map((p) => job(p, DAY))

function tour(extra = {}) {
  const stops = stopsFromJobs({ jobs, placements, objects, date: DAY })
  const order = ['st-o1', 'st-o2', 'st-o3']
  return { schema: 1, id: 'mtaaaaaaaaaaaa', date: DAY, driverId: 'e2', driverName: by, status: 'freigegeben', order, stops: order.map((id) => stops.find((s) => s.id === id)), createdAt: T(6), updatedAt: T(6), updatedBy: 'Büro', ...extra }
}

/** Fakturierung (erfunden): Absender, zwei Kunden, zwei Mattentypen, ein Kundenpreis bis gestern und einer ab heute. */
function fak(extra = {}) {
  return {
    settings: { sender: { name: 'Reinigung Beispiel GmbH', address: 'Beispielgasse 1\n5020 Salzburg', uid: 'ATU00000000' }, vat: 20 },
    customers: [
      { id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', street: 'Ringstraße 3', zip: '5020', city: 'Salzburg', email: 'buchhaltung@hv.example', deliveryNoteEmail: 'objekte@hv.example', discount: 5 },
      { id: 'c2', customerNo: '10002', name: 'Autohaus Muster KG', street: 'Autoweg 7', zip: '5020', city: 'Salzburg', email: 'rechnung@autohaus.example', matten: { autoSend: true } },
    ],
    articles: [
      { id: 'a-m1', articleNo: 'MA-01', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', unit: 'Stk', price: 4.9, vat: 20 },
      { id: 'a-m2', articleNo: 'MA-02', group: 'Matten', name: 'Schmutzfangmatte 60 × 90 cm navy', size: '60 × 90 cm', color: 'navy', unit: 'Stk', price: 3.2, vat: 20 },
    ],
    customerPrices: [
      { id: 'kp-alt', customerId: 'c1', articleId: 'a-m1', price: 4.1, vat: 20, validFrom: '2026-01-01', validTo: '2026-11-08' },
      { id: 'kp-neu', customerId: 'c1', articleId: 'a-m1', price: 4.4, vat: 20, validFrom: DAY, validTo: '' },
    ],
    documents: [],
    ...extra,
  }
}

/** Stopp o1 teilweise: Haupteingang 1 statt 2, Stiege 2 nicht möglich, Tiefgarage voll; unterschrieben um 10:42. */
function partly() {
  let t = tour()
  t = confirmPlacement(t, 'st-o1', 'Haupteingang', at(10, 30))
  t = setQuantity(t, 'st-o1', 0, 1, at(10, 31))
  t = setPlacementNote(t, 'st-o1', 'Haupteingang', 'Matte eingerissen', at(10, 31))
  t = markNotPossible(t, 'st-o1', 'Stiege 2', 'kein Zugang', at(10, 33))
  t = confirmPlacement(t, 'st-o1', 'Tiefgarage', at(10, 35))
  t = finishStop(t, 'st-o1', { signature: { name: 'Eva Beispiel', role: 'Hausbetreuung', svg: SIG }, note: 'Hausbesorger informiert', ...at(10, 42) })
  return t
}

test('Lieferschein nur für abgeschlossene Stopps mit gewechselten Matten; „nicht angetroffen“ ohne, aber mit Grund', () => {
  let t = partly()
  assert.deepEqual(noteNeeded(t.stops[0]), { needed: true, reason: '' })
  assert.equal(noteNeeded(t.stops[1]).needed, false, 'offen')
  t = finishStop(t, 'st-o2', { outcome: 'nicht-angetroffen', ...at(11) })
  assert.equal(t.stops[1].status, 'nicht-angetroffen')
  assert.deepEqual(noteNeeded(t.stops[1]), { needed: false, reason: 'Kunde nicht angetroffen' })
  assert.equal(noteStateOf(t, t.stops[1], []), 'keiner')
  assert.throws(() => createNote({ tour: t, stop: t.stops[1], data: fak(), id: 'x' }), /Kein Lieferschein: Kunde nicht angetroffen/)
  t = finishStop(t, 'st-o3', { outcome: 'nicht-durchgefuehrt', reason: 'niemand vor Ort', ...at(11, 30) })
  assert.deepEqual(noteNeeded(t.stops[2]), { needed: false, reason: 'Nicht durchgeführt' })
  // Vermerk am Stopp
  assert.deepEqual(stopNote(null, { state: 'keiner', reason: 'Kunde nicht angetroffen', at: T(12), by: 'Büro' }), { state: 'keiner', reason: 'Kunde nicht angetroffen', at: T(12), by: 'Büro' })
  // „kein Lieferschein“ sperrt die Korrektur im Büro nicht (z. B. doch noch gewechselt), ein erstellter Lieferschein schon
  const keiner = { ...t, stops: t.stops.map((s) => (s.id === 'st-o2' ? { ...s, deliveryNote: { state: 'keiner', reason: 'Kunde nicht angetroffen' } } : s)) }
  assert.equal(reopenProblem(keiner.stops[1]), '')
  const back = finishStop(confirmPlacement(reopenStop(keiner, 'st-o2', { reason: 'doch gewechselt', ...at(14) }), 'st-o2', 'Schauraum', at(14, 5)), 'st-o2', { reason: 'niemand vor Ort', ...at(14, 6) })
  assert.deepEqual(back.stops[1].deliveryNote, { state: 'offen' })
  assert.ok(noteNeeded(back.stops[1]).needed)
  assert.match(reopenProblem({ ...t.stops[0], deliveryNote: { state: 'erstellt', number: 'LS-2026-000001' } }), /schon einen Lieferschein/)
})

test('Positionen je Liegeplatz und Mattentyp mit Ist-Menge, Preis eingefroren (Kundenpreis vor Standard, am Tag des Abschlusses)', () => {
  const t = partly()
  const stop = t.stops[0]
  const { lines, warnings } = noteLines({ tour: t, stop, data: fak(), customerId: 'c1', date: DAY })
  assert.deepEqual(warnings, [])
  assert.deepEqual(
    lines.map((l) => [l.type, l.text, l.qty ?? '', l.price ?? '', l.source?.price || '']),
    [
      ['title', 'Liegeplatz Haupteingang (EG)', '', '', ''],
      ['item', 'Schmutzfangmatte 85 × 150 cm grau', 1, 4.4, 'kunde'],
      ['title', 'Liegeplatz Stiege 2', '', '', ''],
      ['text', 'Nicht gewechselt: 1 × 60 × 90 cm, navy – kein Zugang', '', '', ''],
      ['title', 'Liegeplatz Tiefgarage', '', '', ''],
      ['item', 'Schmutzfangmatte 85 × 150 cm grau', 1, 4.4, 'kunde'],
      ['item', 'Schmutzfangmatte 60 × 90 cm navy', 2, 3.2, 'standard'],
    ],
  )
  // teilweise: nur die gewechselte Menge, Soll im Langtext
  assert.equal(lines[1].longText, 'Soll 2, gewechselt 1')
  // Kundenrabatt nur zum Standardpreis (priceFor), nicht zum Kundenpreis
  assert.deepEqual([lines[1].discount, lines[6].discount], [0, 5])
  // eindeutige Schlüssel je Liegeplatz und Mattentyp, mit Einsatz-Schlüssel
  const keys = lines.filter((l) => l.source).map((l) => l.source.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(lines[1].source.key, lineKey(t.id, 'st-o1', 'Haupteingang', 'a-m1'))
  assert.equal(lines[1].source.key, 'mtaaaaaaaaaaaa:st-o1:Haupteingang:a-m1')
  assert.equal(lines[1].source.jobKey, `Haupteingang:${DAY}`)
  // Gültigkeit: am Tag davor galt der alte Kundenpreis
  const before = noteLines({ tour: t, stop, data: fak(), customerId: 'c1', date: '2026-11-08' }).lines
  assert.equal(before[1].price, 4.1)
  // ohne Mattentyp in der Fakturierung: Preis 0 mit Hinweis
  const noArt = noteLines({ tour: t, stop, data: fak({ articles: [] , customerPrices: [] }), customerId: 'c1', date: DAY })
  assert.equal(noArt.lines[1].price, 0)
  assert.equal(noArt.lines[1].source.price, 'fehlt')
  assert.match(noArt.warnings[0], /kein Preis/)
})

test('Erstellen: Nummer LS-<Jahr>-000001 fortlaufend (6 Stellen, gemeinsamer Kreis), Prüfsumme, idempotent je Stopp', () => {
  let t = partly()
  t = confirmPlacement(t, 'st-o2', 'Schauraum', at(11))
  t = finishStop(t, 'st-o2', { reason: 'niemand vor Ort', ...at(11, 5) })
  const data = fak()
  const a = createNote({ tour: t, stop: t.stops[0], data, id: 'ls1', now: T(12), by: 'Petra Leitner' })
  assert.ok(a.created)
  assert.equal(a.doc.number, 'LS-2026-000001')
  data.documents.push(a.doc)
  // zweites Erstellen desselben Stopps: kein zweiter Lieferschein
  const again = createNote({ tour: t, stop: t.stops[0], data, id: 'ls-x', now: T(12, 5), by: 'Petra Leitner' })
  assert.equal(again.created, false)
  assert.equal(again.doc.id, 'ls1')
  assert.equal(findNote(data.documents, t.id, 'st-o1').id, 'ls1')
  const b = createNote({ tour: t, stop: t.stops[1], data, id: 'ls2', now: T(12, 6), by: 'Petra Leitner' })
  assert.equal(b.doc.number, 'LS-2026-000002')
  data.documents.push(b.doc)
  // Inhalt des Belegs
  const d = a.doc
  assert.equal(d.kind, 'lieferschein')
  assert.equal(d.hidePrices, true)
  assert.equal(d.date, DAY)
  assert.equal(d.serviceFrom, DAY)
  assert.equal(d.customerId, 'c1')
  assert.equal(d.recipient.customerNo, '10001')
  assert.equal(d.recipient.name, 'Hausverwaltung Beispiel GmbH')
  assert.equal(d.deliveryAddress, 'Beispielweg 12, 5020 Salzburg')
  assert.equal(d.objectName, 'Wohnanlage Beispielweg')
  assert.equal(d.intro, 'Mattenwechsel am 09.11.2026 um 10:42 Uhr, Fahrer: Markus Huber.')
  assert.equal(d.source.key, noteKey(t.id, 'st-o1'))
  assert.equal(d.source.key, 'matten:mtaaaaaaaaaaaa:st-o1')
  assert.deepEqual(d.source.totals, { planned: 6, actual: 4 })
  assert.deepEqual(d.receipt, { name: 'Eva Beispiel', role: 'Hausbetreuung', at: T(10, 42), svg: SIG })
  assert.match(d.outro, /Hausbesorger informiert/)
  assert.match(d.outro, /Haupteingang: Matte eingerissen/)
  assert.match(d.outro, /Abweichung Haupteingang: 1 statt 2 × 85 × 150 cm, grau gewechselt/)
  assert.match(d.outro, /Abweichung Stiege 2: 1 × 60 × 90 cm, navy nicht gewechselt \(kein Zugang\)/)
  // festgeschrieben: Prüfsumme, Unterschrift gehört dazu
  assert.ok(d.checksum && intact(d))
  assert.equal(intact({ ...d, receipt: { ...d.receipt, name: 'Jemand anders' } }), false)
  assert.equal(intact({ ...d, lines: d.lines.map((l, i) => (i === 1 ? { ...l, price: 1 } : l)) }), false, 'eingefrorener Preis')
  // Versand und Ablage ändern die Prüfsumme nicht
  const sent = markArchived(markSent(d, { to: ['objekte@hv.example'], at: T(13) }), { itemId: 'I1', webUrl: 'https://x', at: T(13) })
  assert.ok(intact(sent))
  assert.equal(checksumOf(sent), d.checksum)
  // Summe für die spätere Rechnung (Preis im Beleg, im PDF ausgeblendet)
  assert.equal(totals(d, data.settings).net, 4.4 + 4.4 + 6.4 * 0.95)
  // ohne Unterschrift: Grund im Beleg
  assert.deepEqual({ ...b.doc.receipt, at: '' }, { unsigned: true, reason: 'niemand vor Ort', at: '' })
  // Kunde mit eigenem Format bzw. Stellen: die Einstellung gilt
  assert.equal(createNote({ tour: t, stop: t.stops[1], data: fak({ settings: { ...fak().settings, numberDigits: { lieferschein: 4 } } }), id: 'z' }).doc.number, 'LS-2026-0001')
})

test('Gemeinsamer Nummernkreis mit den Lieferscheinen der Fakturierung; Vorgabe 6 Stellen nur, wenn nichts eingestellt ist', () => {
  const settings = fak().settings
  const manual = finalize({ id: 'm1', kind: 'lieferschein', date: '2026-10-01', serviceFrom: '2026-10-01', recipient: { name: 'Kunde', address: 'Weg 1\n5020 Salzburg' }, lines: [{ id: 'l', text: 'Grundreinigung', qty: 1, price: 10 }] }, [], settings)
  assert.equal(manual.number, 'LS-2026-0001', 'von Hand ohne Einstellung wie bisher')
  const t = partly()
  const res = createNote({ tour: t, stop: t.stops[0], data: fak({ documents: [manual] }), id: 'ls' })
  assert.equal(res.doc.number, 'LS-2026-000002')
  assert.equal(nextNumber([manual, res.doc], 'lieferschein', '2026', numberSettings(settings)).number, 'LS-2026-000003')
  assert.ok(digitsMissing(settings))
  assert.ok(!digitsMissing({ numberDigits: { lieferschein: 5 } }))
  assert.equal(numberSettings({ numberDigits: { lieferschein: 5 } }).numberDigits.lieferschein, 5)
  // nächstes Jahr beginnt neu
  assert.equal(nextNumber([res.doc], 'lieferschein', '2027', numberSettings(settings)).number, 'LS-2027-000001')
})

test('Ablage: Pfad Mattenwechsel/Kunden/<Kundennummer>/<Jahr>/<Monat>/Lieferscheine/, Dateiname bereinigt, Zustände', () => {
  const doc = { number: 'LS-2026-000123', date: '2026-03-05', recipient: { name: 'Bäckerei Groß & Söhne / Filiale', customerNo: '10 004' } }
  assert.equal(noteFileName(doc), 'LS-2026-000123_Baeckerei_Gross_Soehne_Filiale_2026-03-05.pdf')
  assert.equal(notePath(doc), 'Mattenwechsel/Kunden/10_004/2026/03/Lieferscheine/LS-2026-000123_Baeckerei_Gross_Soehne_Filiale_2026-03-05.pdf')
  assert.equal(notePath({ ...doc, recipient: { name: 'X' } }).split('/')[2], 'ohne-Kundennummer')
  assert.equal(archiveState(doc), '')
  const q = markArchiveQueued(doc, { at: T(9) })
  assert.deepEqual([archiveState(q), q.integration.ablage.tries, q.integration.ablage.queued], ['offen', 1, true])
  const f = markArchiveFailed(q, { error: new Error('Zugriff verweigert'), at: T(10) })
  assert.deepEqual([archiveState(f), f.integration.ablage.tries, f.integration.ablage.lastError], ['fehler', 2, 'Zugriff verweigert'])
  const ok = markArchived(f, { itemId: 'I9', webUrl: 'https://sp/x.pdf', path: notePath(doc), at: T(11) })
  assert.deepEqual(ok.archive, { itemId: 'I9', webUrl: 'https://sp/x.pdf', path: notePath(doc), uploadedAt: T(11) })
  assert.deepEqual([archiveState(ok), ok.integration.ablage.status, ok.integration.ablage.tries], ['ok', 'ok', 3])
})

test('Versand: an Kunde (Lieferschein-Mail), Büro, beide; Protokoll und Fehler', () => {
  const doc = { id: 'ls1', number: 'LS-2026-000001', date: DAY, objectName: 'Wohnanlage Beispielweg', recipient: { name: 'HV', email: 'buchhaltung@hv.example' } }
  const customer = fak().customers[0]
  const settings = { officeEmail: 'buero@reinigung.example' }
  assert.deepEqual(mailRecipients({ doc, customer, settings, mode: 'kunde' }), { to: ['objekte@hv.example'], cc: [], missing: [] })
  assert.deepEqual(mailRecipients({ doc, customer: { ...customer, deliveryNoteEmail: '' }, settings, mode: 'kunde' }).to, ['buchhaltung@hv.example'], 'sonst die E-Mail des Kunden')
  assert.deepEqual(mailRecipients({ doc, customer, settings, mode: 'buero' }), { to: ['buero@reinigung.example'], cc: [], missing: [] })
  assert.deepEqual(mailRecipients({ doc, customer, settings, mode: 'beide' }), { to: ['objekte@hv.example'], cc: ['buero@reinigung.example'], missing: [] })
  assert.deepEqual(mailRecipients({ doc, customer, settings: {}, mode: 'buero' }).missing, ['buero'])
  assert.deepEqual(mailRecipients({ doc: { ...doc, recipient: {} }, customer: null, settings, mode: 'beide' }), { to: ['buero@reinigung.example'], cc: [], missing: ['kunde'] })
  const m = noteMail({ doc, sender: 'Petra Leitner', company: 'Reinigung Beispiel GmbH' })
  assert.equal(m.subject, 'Lieferschein LS-2026-000001 – Mattenwechsel Wohnanlage Beispielweg am 09.11.2026')
  assert.match(m.text, /im Anhang erhalten Sie den Lieferschein LS-2026-000001/)
  assert.equal(mailState(doc), 'offen')
  const failed = markMailFailed(doc, { to: ['objekte@hv.example'], error: 'Postfach voll', at: T(12) })
  assert.deepEqual([mailState(failed), failed.integration.mail.tries, failed.integration.mail.lastError], ['fehler', 1, 'Postfach voll'])
  const sent = markSent(failed, { to: ['objekte@hv.example'], cc: ['buero@reinigung.example'], via: 'graph', by: 'Petra', at: T(13), mode: 'beide' })
  assert.equal(mailState(sent), 'ok')
  assert.deepEqual(sent.sent, [{ at: T(13), to: 'objekte@hv.example; buero@reinigung.example', via: 'graph', by: 'Petra', mode: 'beide' }])
  assert.deepEqual({ ...sent.integration.mail, at: '' }, { status: 'ok', to: ['objekte@hv.example', 'buero@reinigung.example'], at: '', by: 'Petra', lastError: '', tries: 2 })
  const again = markSent(sent, { to: ['objekte@hv.example'], at: T(14), auto: true })
  assert.equal(again.sent.length, 2)
  assert.equal(again.sent[1].auto, true)
})

test('Liste im Büro: Stand je Stopp aus den Belegen (oder der Kopie am Stopp), Filter und Zähler', () => {
  let t = partly()
  t = finishStop(t, 'st-o2', { outcome: 'nicht-angetroffen', ...at(11) })
  t = confirmPlacement(t, 'st-o3', 'Foyer', at(11, 30))
  t = finishStop(t, 'st-o3', { reason: 'niemand vor Ort', ...at(11, 35) })
  const data = fak()
  let rows = noteRows({ tours: [t, { ...tour({ id: 'mtentwurf000001', status: 'entwurf' }) }], docs: data.documents })
  assert.deepEqual(rows.map((r) => [r.stop.id, r.state]), [['st-o3', 'offen'], ['st-o2', 'keiner'], ['st-o1', 'offen']])
  assert.deepEqual(noteSummary(rows), { offen: 2, keiner: 1, erstellt: 0, versendet: 0, ablage: 0, mailFehler: 0, ablageOffen: 0 })
  const a = createNote({ tour: t, stop: t.stops[0], data, id: 'ls1' }).doc
  data.documents.push(markArchiveFailed(a, { error: 'x' }))
  rows = noteRows({ tours: [t], docs: data.documents })
  const r1 = rows.find((r) => r.stop.id === 'st-o1')
  assert.deepEqual([r1.state, r1.number, r1.archive, r1.mail], ['erstellt', 'LS-2026-000001', 'fehler', 'offen'])
  assert.ok(rowMatches(r1, 'erstellt') && rowMatches(r1, 'ablage') && !rowMatches(r1, 'offen') && rowMatches(r1, 'alle'))
  data.documents[0] = markSent(data.documents[0], { to: ['a@b.example'] })
  rows = noteRows({ tours: [t], docs: data.documents })
  assert.equal(rows.find((r) => r.stop.id === 'st-o1').state, 'versendet')
  // Zeitraum
  assert.equal(noteRows({ tours: [t], docs: [], from: '2026-11-10' }).length, 0)
  // ohne Recht auf die Fakturierung: Kopie am Stopp
  const copy = { ...t, stops: t.stops.map((s) => (s.id === 'st-o1' ? { ...s, deliveryNote: stopNote(data.documents[0], { at: T(14) }) } : s)) }
  assert.deepEqual(copy.stops[0].deliveryNote.state, 'versendet')
  assert.equal(noteRows({ tours: [copy], docs: null }).find((r) => r.stop.id === 'st-o1').state, 'versendet')
  assert.equal(stopNeedsSync(t.stops[0], data.documents[0]), true)
  assert.equal(stopNeedsSync(copy.stops[0], data.documents[0]), false)
})

test('PDF: Lieferschein ohne Preise, Liegeplätze als Zeilen, Unterschrift als Bild bzw. ohne Unterschrift mit Grund', () => {
  const t = partly()
  const data = fak()
  const doc = createNote({ tour: t, stop: t.stops[0], data, id: 'ls1' }).doc
  const def = invoiceDocument({ doc, settings: data.settings })
  const json = JSON.stringify(def.content)
  assert.ok(json.includes('Liegeplatz Haupteingang (EG)') && json.includes('Liegeplatz Tiefgarage'))
  assert.ok(!/4,40 €|Einzelpreis|Gesamt netto|Summe netto/.test(json), 'keine Preise')
  const svgNodes = []
  const walk = (x) => (Array.isArray(x) ? x.forEach(walk) : x && typeof x === 'object' ? (x.svg && svgNodes.push(x.svg), Object.values(x).forEach(walk)) : null)
  walk(def.content)
  assert.deepEqual(svgNodes, [SIG])
  assert.ok(json.includes('Eva Beispiel, Hausbetreuung') && json.includes('unterschrieben am Gerät am 09.11.2026, 10:42 Uhr'))
  assert.ok(json.includes('Bemerkungen:'))
  const unsigned = invoiceDocument({ doc: { ...doc, receipt: { unsigned: true, reason: 'niemand vor Ort', at: T(10) } }, settings: data.settings })
  assert.ok(JSON.stringify(unsigned.content).includes('Ohne Unterschrift abgeschlossen') && JSON.stringify(unsigned.content).includes('niemand vor Ort'))
  // Lieferschein von Hand (ohne receipt) wie bisher mit Unterschriftszeile
  assert.ok(JSON.stringify(invoiceDocument({ doc: { ...doc, receipt: undefined }, settings: data.settings }).content).includes('Unterschrift und Name in Blockschrift'))
})

test('Rechte: Erstellen nur mit Mattenwechsel und Fakturierung; Fahrer ohne Belege; Ablage-Ordner', () => {
  const role = (...ids) => resolveAccess({ roleClaims: ids, strict: true })
  const voll = noteRights(role('disposition'))
  assert.deepEqual([voll.view, voll.create, voll.send], [true, true, true])
  const buero = noteRights(role('mattenwechsel'))
  assert.deepEqual([buero.view, buero.create, buero.send], [true, false, false])
  assert.match(buero.hint, /zusätzlich die Fakturierung/)
  const fahrer = role('mattenfahrer')
  assert.deepEqual([noteRights(fahrer).view, noteRights(fahrer).create], [false, false])
  assert.ok(!dataRights(fahrer).read(MODULE_DOCS.fakturierung.path), 'Fahrer liest keine Belege und Preise')
  assert.equal(toolFolderRights(fahrer).find(([f]) => f === 'Mattenwechsel')[2], '', 'Fahrer: kein Recht auf die Ablage')
  // Buchhaltung: sieht die Lieferscheine in der Fakturierung, erstellt sie nicht aus den Touren
  const bh = role('buchhaltung')
  assert.ok(dataRights(bh).read(MODULE_DOCS.fakturierung.path) && !noteRights(bh).view && !noteRights(bh).create)
  // eigene Rolle mit beiden Bereichen
  const both = resolveAccess({ roleClaims: ['mwfak'], strict: true, access: { roles: { mwfak: { label: 'Büro mit Faktura', modules: ['matten', 'mattentour', 'fakturierung'], edit: ['matten', 'mattentour', 'fakturierung'] } } } })
  assert.ok(noteRights(both).create)
  assert.ok(dataRights(both).write('matten/touren/2026/mt0123456789ab.json') && dataRights(both).write(MODULE_DOCS.fakturierung.path))
  assert.equal(toolFolderRights(both).find(([f]) => f === 'Mattenwechsel')[2], 'Bearbeiten', 'Ablage Mattenwechsel/Kunden/…')
  assert.equal(toolFolderRights(role('disposition')).find(([f]) => f === 'Mattenwechsel')[2], 'Bearbeiten')
  // Browser-Modus (ohne Anmeldung): alles
  assert.ok(noteRights(null).create)
})

test('SharePoint: Ablage ohne Doppel (vorhandene Datei bleibt) und Warteschlange ohne Netz', async () => {
  // Graph-Attrappe: PUT mit conflictBehavior=fail → 409, wenn es die Datei gibt; GET liefert ihre Kennung
  const files = new Map([['Mattenwechsel/Kunden/10001/2026/11/Lieferscheine/da.pdf', { id: 'I-alt', webUrl: 'https://sp/da.pdf' }]])
  const calls = []
  const res = (status, body) => ({ status, ok: status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) })
  const fetchImpl = async (url, opts) => {
    const u = decodeURIComponent(String(url))
    calls.push(`${opts.method} ${u.replace(/^.*root:\//, '').replace(/\?.*$/, '')}`)
    const path = (u.match(/root:\/(.+?)(?::\/content|\?|$)/) || [])[1]
    if (opts.method === 'GET' && /root:\//.test(u)) return files.has(path) ? res(200, { id: files.get(path).id, webUrl: files.get(path).webUrl, size: 10 }) : path && path.split('/').length < 7 ? res(200, { id: 'F', folder: {} }) : res(404, { error: { message: 'nf' } })
    if (opts.method === 'PUT') {
      if (files.has(path)) return res(409, { error: { message: 'da' } })
      files.set(path, { id: `I${files.size + 1}`, webUrl: `https://sp/${path}` })
      return res(201, { id: files.get(path).id, webUrl: files.get(path).webUrl })
    }
    return res(201, {})
  }
  const sp = new SharePointDocStore({ getToken: async () => 'T', siteUrl: 'https://x.sharepoint.com', fetchImpl })
  sp.driveId = 'D'
  const had = await sp.uploadRoot('Mattenwechsel/Kunden/10001/2026/11/Lieferscheine/da.pdf', new Blob(['%PDF']), 'application/pdf')
  assert.deepEqual(had, { itemId: 'I-alt', webUrl: 'https://sp/da.pdf', existed: true })
  const neu = await sp.uploadRoot('Mattenwechsel/Kunden/10001/2026/11/Lieferscheine/neu.pdf', new Blob(['%PDF']), 'application/pdf')
  assert.equal(neu.existed, false)
  assert.ok(neu.itemId)
  assert.deepEqual(await sp.rootFile('Mattenwechsel/Kunden/10001/2026/11/Lieferscheine/neu.pdf'), { itemId: neu.itemId, webUrl: neu.webUrl, size: 10 })
  assert.equal(await sp.rootFile('Mattenwechsel/Kunden/10001/2026/11/Lieferscheine/fehlt.pdf'), null)

  // ohne Netz: in die Warteschlange (wie Fotos), später mit uploadRoot nachgeholt
  let online = false
  const uploaded = []
  const remote = {
    kind: 'sharepoint',
    upload: async () => ({ webUrl: 'app' }),
    uploadRoot: async (path) => {
      if (!online) throw new TypeError('Failed to fetch')
      uploaded.push(path)
      return { itemId: 'I7', webUrl: `https://sp/${path}`, existed: false }
    },
    rootFile: async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return null
    },
  }
  const store = new CachedDocStore(remote, memoryCache())
  assert.equal(await store.rootFile('Mattenwechsel/x.pdf'), undefined, 'ohne Netz: unbekannt')
  assert.deepEqual(await store.uploadRoot('Mattenwechsel/x.pdf', new Blob(['%PDF']), 'application/pdf'), { itemId: '', webUrl: null, queued: true })
  assert.equal(await store.queuedUploads(), 1)
  online = true
  const done = []
  assert.equal(await store.flushUploads((p, url, info) => done.push([p, url, info])), 0)
  assert.deepEqual(uploaded, ['Mattenwechsel/x.pdf'])
  assert.deepEqual(done, [['Mattenwechsel/x.pdf', 'https://sp/Mattenwechsel/x.pdf', { root: true, itemId: 'I7' }]])
})
