// Regieberichte (core/regie.js, export/regie-pdf.js): Nummern, Zeiten je Person (von–bis, Pause, über Mitternacht,
// Dauer), Prüfen und Abschließen, Verrechnung nur einmal (Entwurf, festgeschrieben, Storno, gelöschter Entwurf),
// Stundensatz und Materialpreis, Positionen, eingefrorene Beilage, PDF, Rechte (Ordner regie/).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAccess } from '../src/core/access.js'
import { checksumOf, finalize, stornoDraft, totals } from '../src/core/invoicing.js'
import {
  cleanReport,
  clockMinutes,
  closeProblem,
  closeReport,
  durationText,
  emptyRegie,
  freezeRegie,
  matchFilter,
  materialPrice,
  nextRegieNo,
  parseDuration,
  personName,
  regieBase,
  regieConflicts,
  regieKey,
  regieLines,
  regieRate,
  regieState,
  regieTotals,
  reportProblem,
  stockLines,
  syncRegieBilled,
  toBill,
  workerMinutes,
  workersText,
} from '../src/core/regie.js'
import { regieDocument, regiePdfName, signedAtText } from '../src/export/regie-pdf.js'
import { dataRights, DOC, folderRights, MODULE_DOCS } from '../src/storage/data-service.js'
import { createRegieDemo } from '../src/data/demo-regie.js'

const TODAY = '2026-11-06'
let n = 0
const newId = () => `x${++n}`
const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100"><path d="M10 50L80 20L150 70" fill="none" stroke="#13232f" stroke-width="2.2"/></svg>'
const report = (over = {}) => ({
  id: 'rb1',
  no: 'RB-2026-0004',
  objectId: 'o5',
  date: '2026-11-05',
  kind: 'wasserschaden',
  title: 'Keller nach Rohrbruch',
  description: 'Wasser abgesaugt, gereinigt',
  orderedBy: 'Paul Muster',
  orderedRole: 'Hausverwaltung',
  orderRef: 'HV-1',
  workers: [
    { id: 'w1', name: 'Dragan Jović', from: '07:30', to: '11:45', pause: 15, minutes: 0 },
    { id: 'w2', name: 'Gül Arslan', from: '', to: '', pause: 0, minutes: 150 },
  ],
  material: [
    { id: 'm1', articleId: 'a1', text: 'Allzweckreiniger 1 l', qty: 2, unit: 'Fl.' },
    { id: 'm2', articleId: '', text: 'Bautrocknerfolie', qty: 3, unit: 'm' },
  ],
  photos: [{ path: 'regie/nachweise/2026/a.jpg', phase: 'vorher' }, { path: 'regie/nachweise/2026/b.jpg', phase: 'nachher' }, { path: 'regie/nachweise/2026/c.jpg', phase: 'nachher' }],
  status: 'offen',
  signature: null,
  unsigned: null,
  ...over,
})
const closed = (over = {}) => closeReport(report(over), { signature: { name: 'Herbert Beispiel', role: 'Hausbetreuung', svg: SIG }, at: '2026-11-05T10:40:00.000Z', by: 'Hans Berger' })
const invoice = (over = {}) => ({ id: 'f1', kind: 'rechnung', date: '2026-11-06', serviceFrom: '2026-11-05', serviceTo: '2026-11-05', recipient: { name: 'HV', address: 'Ringstraße 3\n5020 Salzburg' }, lines: [{ id: 'l1', text: 'Regiestunden', qty: 6.5, unit: 'Std.', price: 38, vat: 20 }], source: { type: 'regie', key: regieKey('rb1'), reportId: 'rb1', no: 'RB-2026-0004' }, ...over })
const SETTINGS = { sender: { name: 'Gebäudereinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' } }

test('Leere Datei wie in der Ablage, Nummer je Jahr fortlaufend, Pfad im Ordner regie/', () => {
  assert.deepEqual(MODULE_DOCS.regie.empty(), emptyRegie())
  assert.equal(MODULE_DOCS.regie.path, 'regie/regie.json')
  assert.equal(nextRegieNo([], 2026), 'RB-2026-0001')
  assert.equal(nextRegieNo([{ no: 'RB-2026-0007' }, { no: 'RB-2025-0042' }, { no: 'x' }], 2026), 'RB-2026-0008')
  assert.equal(nextRegieNo([{ no: 'RB-2025-0042' }], '2026'), 'RB-2026-0001')
  assert.equal(regieBase(report(), 'Wohnanlage Lehen'), 'regie/nachweise/2026/RB-2026-0004_Wohnanlage-Lehen_2026-11-05')
  assert.equal(regiePdfName('RB-2026-0004', 'Wohnanlage Lehen'), 'Regiebericht_RB-2026-0004_Wohnanlage-Lehen.pdf')
})

test('Zeiten: von–bis mit Pause, über Mitternacht, Dauer als 2,5 oder 2:30, Summe', () => {
  assert.equal(clockMinutes('08:30'), 510)
  assert.equal(clockMinutes('8:5'), null)
  assert.equal(clockMinutes('25:00'), null)
  assert.equal(workerMinutes({ from: '07:30', to: '11:45', pause: 15 }), 240)
  assert.equal(workerMinutes({ from: '22:00', to: '01:30' }), 210, 'über Mitternacht')
  assert.equal(workerMinutes({ from: '', to: '', minutes: 150 }), 150)
  assert.equal(workerMinutes({ from: '08:00', to: '', minutes: 90 }), 90, 'unvollständige Zeit: die Dauer zählt')
  assert.equal(parseDuration('2,5'), 150)
  assert.equal(parseDuration('2.25'), 135)
  assert.equal(parseDuration('2:30'), 150)
  assert.equal(parseDuration(''), 0)
  assert.equal(parseDuration('abc'), 0)
  assert.equal(durationText(390), '6:30')
  assert.deepEqual(regieTotals(report()), { minutes: 390, hours: 6.5, persons: 2, material: 2 })
  assert.equal(personName('Dragan Jović', 'vorname'), 'Dragan')
  assert.equal(personName('Dragan Jović', 'keine'), '')
  assert.equal(personName('Dragan Jović', 'voll'), 'Dragan Jović')
  assert.equal(workersText(report(), 'vorname'), 'Dragan 07:30–11:45 (4:00), Gül (2:30)')
  assert.equal(workersText(report(), 'keine'), 'Person 1 07:30–11:45 (4:00), Person 2 (2:30)')
})

test('Prüfen vor dem Speichern und Säubern: leere Zeilen weg, Dauer gerechnet, Material mit Artikelname', () => {
  assert.equal(reportProblem(report(), TODAY), '')
  assert.match(reportProblem(report({ objectId: '' }), TODAY), /Objekt/)
  assert.match(reportProblem(report({ date: '2026-11-07' }), TODAY), /Zukunft/)
  assert.match(reportProblem(report({ title: '', description: ' ' }), TODAY), /beschreiben/)
  assert.match(reportProblem(report({ workers: [{ id: 'w', name: '', from: '08:00', to: '09:00' }] }), TODAY), /Person eintragen/)
  assert.match(reportProblem(report({ workers: [{ id: 'w', name: 'Ana', from: '08:00', to: '9' }] }), TODAY), /Ana: Zeit von–bis prüfen/)
  assert.match(reportProblem(report({ workers: [{ id: 'w', name: 'Ana', from: '08:00', to: '08:00' }] }), TODAY), /„bis“ muss nach „von“/)
  assert.match(reportProblem(report({ workers: [{ id: 'w', name: 'Ana', from: '', to: '', minutes: 0 }] }), TODAY), /Ana: bitte von–bis oder die Dauer/)
  assert.match(reportProblem(report({ workers: [{ id: 'w', name: 'Ana', minutes: 17 * 60 }] }), TODAY), /mehr als 16 Stunden/)
  assert.match(reportProblem(report({ material: [{ id: 'm', articleId: '', text: '', qty: 2 }] }), TODAY), /Bezeichnung/)
  assert.match(reportProblem(report({ material: [{ id: 'm', articleId: '', text: 'Folie', qty: '' }] }), TODAY), /Folie: bitte die Menge/)
  // leere Zeilen stören nicht
  assert.equal(reportProblem(report({ workers: [...report().workers, { id: 'w3', name: '', from: '', to: '', minutes: 0 }], material: [{ id: 'm3', articleId: '', text: '', qty: '' }] }), TODAY), '')
  const c = cleanReport(report({ title: ' Keller ', workers: [...report().workers, { id: 'w3', name: '' }], material: [{ id: 'm1', articleId: 'a1', text: '', qty: '2,5', unit: '' }, { id: 'm3', text: '', qty: '' }] }), { stock: [{ id: 'a1', name: 'Allzweckreiniger 1 l', unit: 'Fl.' }] })
  assert.equal(c.title, 'Keller')
  assert.deepEqual(c.workers.map((w) => [w.name, w.minutes, w.from, w.pause]), [['Dragan Jović', 240, '07:30', 15], ['Gül Arslan', 150, '', 0]])
  assert.deepEqual(c.material, [{ id: 'm1', articleId: 'a1', text: 'Allzweckreiniger 1 l', qty: 2.5, unit: 'Fl.' }])
})

test('Abschließen: mit Unterschrift (Name, Funktion, Zeitpunkt) oder ohne mit Grund, danach fest', () => {
  const r = closed()
  assert.equal(r.status, 'abgeschlossen')
  assert.deepEqual(r.signature, { name: 'Herbert Beispiel', role: 'Hausbetreuung', svg: SIG, at: '2026-11-05T10:40:00.000Z', by: 'Hans Berger' })
  assert.equal(r.unsigned, null)
  assert.equal(r.closedAt, '2026-11-05T10:40:00.000Z')
  assert.throws(() => closeReport(r, { reason: 'x', at: 'y' }), /schon abgeschlossen/)
  assert.match(closeProblem(report(), { signature: { name: '', svg: SIG } }), /Namen/)
  assert.match(closeProblem(report(), { signature: { name: 'H', svg: '' } }), /unterschreiben/)
  assert.match(closeProblem(report(), { reason: ' ' }), /warum ohne Unterschrift/)
  assert.match(closeProblem(report({ workers: [], material: [] }), { reason: 'x' }), /Stunden oder Material/)
  const u = closeReport(report(), { reason: 'niemand vor Ort', at: 'T', by: 'B' })
  assert.deepEqual([u.signature, u.unsigned], [null, { reason: 'niemand vor Ort', at: 'T', by: 'B' }])
})

test('Verrechnung: offen → Entwurf → verrechnet; Storno und gelöschter Entwurf geben frei; nur einmal festschreiben', () => {
  const r = closed()
  assert.equal(regieState(report(), []), null, 'offene Berichte haben noch keinen Stand')
  assert.deepEqual(regieState(r, []), { state: 'offen' })
  const draft = invoice()
  assert.deepEqual(regieState(r, [draft]), { state: 'entwurf', docId: 'f1' })
  // festschreiben (Prüfsumme ohne source: die Herkunft ändert die Prüfsumme nicht)
  const fixed = finalize(draft, [draft], SETTINGS, { now: '2026-11-06T09:00:00.000Z', by: 'Büro' })
  assert.equal(fixed.checksum, checksumOf({ ...fixed, source: undefined }))
  let docs = [fixed]
  assert.deepEqual(regieState(r, docs), { state: 'verrechnet', docId: 'f1', number: fixed.number, date: '2026-11-06' })
  assert.deepEqual(toBill([r], docs), [])
  // zweiter Entwurf (z. B. gleichzeitig angelegt): Festschreiben gesperrt
  const second = invoice({ id: 'f2' })
  assert.match(regieConflicts(second, [...docs, second])[0], /RB-2026-0004 ist schon mit RE-2026-0001 verrechnet/)
  assert.deepEqual(regieConflicts(invoice({ id: 'f3', source: { type: 'nachweis', key: 'nachweis:o5:2026-10' } }), docs), [])
  // Stand für Rollen ohne Fakturierung mitschreiben
  const reports = [structuredClone(r)]
  assert.equal(syncRegieBilled(reports, docs), 1)
  assert.deepEqual(reports[0].billed, { docId: 'f1', number: fixed.number, date: '2026-11-06' })
  assert.equal(syncRegieBilled(reports, docs), 0)
  assert.deepEqual(regieState(reports[0], null), { state: 'verrechnet', docId: 'f1', number: fixed.number, date: '2026-11-06' })
  // Storno: wieder offen, billed fällt weg, neue Rechnung erlaubt
  const st = finalize(stornoDraft(fixed, { id: 's1', date: '2026-11-07' }), docs, SETTINGS, { now: '2026-11-07T09:00:00.000Z' })
  docs = [fixed, st]
  assert.deepEqual(regieState(r, docs), { state: 'offen' })
  assert.deepEqual(toBill([r], docs).map((x) => x.id), ['rb1'])
  assert.equal(syncRegieBilled(reports, docs), 1)
  assert.equal(reports[0].billed, undefined)
  assert.deepEqual(regieConflicts(second, [...docs, second]), [], 'nach dem Storno darf neu verrechnet werden')
  // gelöschter Entwurf: wieder offen
  assert.deepEqual(regieState(r, [draft].filter((x) => x.id !== 'f1')), { state: 'offen' })
  // „nicht verrechnen“; eine festgeschriebene Rechnung geht vor
  const skip = { ...r, billing: { status: 'nicht', reason: 'Kulanz' } }
  assert.deepEqual(regieState(skip, []), { state: 'nicht' })
  assert.deepEqual(regieState(skip, null), { state: 'nicht' })
  assert.equal(regieState(skip, [fixed]).state, 'verrechnet')
  // Filter der Übersicht
  assert.ok(matchFilter(report(), null, { status: 'offen' }) && !matchFilter(r, { state: 'offen' }, { status: 'offen' }))
  assert.ok(matchFilter(r, { state: 'offen' }, { status: 'zuverrechnen' }) && !matchFilter(r, { state: 'entwurf' }, { status: 'zuverrechnen' }))
  assert.ok(matchFilter(r, { state: 'entwurf' }, { status: 'entwurf', objectId: 'o5' }) && !matchFilter(r, null, { objectId: 'o2' }))
})

test('Stundensatz: Kunde, Artikel „Regiestunde“, Einstellung, Stundensatz nach Aufwand', () => {
  const art = [{ id: 'a', name: 'Regiestunde Reinigung', price: 39.5, vat: 20, articleNo: 'RG-01' }, { id: 'b', name: 'Reinigung nach Aufwand', price: 34 }]
  assert.deepEqual(regieRate({ customer: { regieRate: 41 }, articles: art, settings: { regieRate: 38 } }), { rate: 41, source: 'kunde' })
  assert.deepEqual(regieRate({ customer: { hourRate: 34 }, articles: art, settings: { regieRate: 38 } }), { rate: 39.5, source: 'artikel', vat: 20, articleNo: 'RG-01' })
  assert.deepEqual(regieRate({ customer: { hourRate: 34 }, articles: [{ ...art[0], active: false }], settings: { regieRate: '38,50' } }), { rate: 38.5, source: 'einstellung' })
  assert.deepEqual(regieRate({ customer: { hourRate: 34 }, articles: [], settings: {} }), { rate: 34, source: 'aufwand' })
  assert.deepEqual(regieRate({}), { rate: 0, source: '' })
})

test('Materialpreis: Artikel der Fakturierung (Nummer oder Name), sonst Einkauf plus Aufschlag, sonst fehlt', () => {
  const stock = [{ id: 'a1', name: 'Allzweckreiniger 1 l', price: 3.2, articleNo: '' }, { id: 'a2', name: 'Glasreiniger', price: 2.8, articleNo: 'GR-7' }]
  const articles = [{ id: 'f1', name: 'Glasreiniger 1 Liter', articleNo: 'GR-7', price: 6.9, vat: 20 }, { id: 'f2', name: 'Bautrocknerfolie', price: 4.5, vat: 20 }]
  assert.deepEqual(materialPrice({ articleId: 'a2', text: 'Glasreiniger', qty: 1 }, { stock, articles }), { price: 6.9, vat: 20, articleNo: 'GR-7', source: 'artikel' })
  assert.deepEqual(materialPrice({ articleId: '', text: 'bautrocknerfolie', qty: 1 }, { stock, articles }), { price: 4.5, vat: 20, source: 'artikel' })
  assert.deepEqual(materialPrice({ articleId: 'a1', text: 'Allzweckreiniger 1 l', qty: 2 }, { stock, articles, markup: 10 }), { price: 3.52, source: 'einkauf' })
  assert.deepEqual(materialPrice({ articleId: '', text: 'Sonderschaum', qty: 1 }, { stock, articles }), { price: 0, source: '' })
})

test('Positionen: Textzeile mit Auftrag, Regiestunden als Summe mit Zeiten, Material mit Preis; fehlende Preise gemeldet', () => {
  const stock = [{ id: 'a1', name: 'Allzweckreiniger 1 l', price: 3.2 }]
  const res = regieLines({ report: closed(), objectName: 'Wohnanlage Lehen', rate: 38.5, vat: 20, newId, names: 'vorname', stock, articles: [], markup: 10 })
  const [head, hours, m1, m2] = res.lines
  assert.deepEqual([head.type, head.text], ['text', 'Regiebericht RB-2026-0004 vom 05.11.2026, Keller nach Rohrbruch, beauftragt von Paul Muster (Hausverwaltung), Auftrag HV-1'])
  assert.deepEqual([hours.text, hours.qty, hours.unit, hours.price, hours.vat, hours.longText], ['Regiestunden Wasserschaden – Wohnanlage Lehen', 6.5, 'Std.', 38.5, 20, 'Dragan 07:30–11:45 (4:00), Gül (2:30)'])
  assert.deepEqual([m1.text, m1.qty, m1.unit, m1.price], ['Material: Allzweckreiniger 1 l', 2, 'Fl.', 3.52])
  assert.deepEqual([m2.text, m2.qty, m2.unit, m2.price], ['Material: Bautrocknerfolie', 3, 'm', 0])
  assert.deepEqual(res.missing, ['Bautrocknerfolie'])
  assert.equal(res.rateMissing, false)
  // Netto: 6,5 × 38,50 + 2 × 3,52 = 257,29
  assert.equal(totals({ lines: res.lines }, {}).net, 257.29)
  assert.equal(regieLines({ report: closed(), rate: 0, newId }).rateMissing, true)
  // nur Material, ohne Stunden
  assert.equal(regieLines({ report: closed({ workers: [] }), rate: 0, newId }).lines.filter((l) => l.unit === 'Std.').length, 0)
  assert.deepEqual(stockLines(closed()), [{ articleId: 'a1', qty: 2 }])
})

test('Eingefroren für die Beilage: ohne Fotos (nur Anzahl), Namen gekürzt, Unterschrift; PDF mit Kopf, Zeiten, Material, Bestätigung', () => {
  const fz = freezeRegie(closed(), { object: { name: 'Wohnanlage Lehen', address: '5020 Salzburg-Lehen', id: 'o5' }, names: 'vorname' })
  assert.deepEqual(fz.object, { name: 'Wohnanlage Lehen', address: '5020 Salzburg-Lehen' })
  assert.deepEqual(fz.workers, [{ name: 'Dragan', from: '07:30', to: '11:45', pause: 15, minutes: 240 }, { name: 'Gül', from: '', to: '', pause: 0, minutes: 150 }])
  assert.deepEqual(fz.photos, { vorher: 1, nachher: 2 })
  assert.equal(fz.signature.name, 'Herbert Beispiel')
  assert.ok(!JSON.stringify(fz).includes('regie/nachweise'), 'keine Pfade zu Fotos')
  assert.ok(!JSON.stringify(freezeRegie(closed(), { names: 'keine' })).includes('Dragan'))
  const pdf = regieDocument({ report: fz, invoiceNumber: 'RE-2026-0009', brand: { name: 'Cleanos' }, createdAt: new Date('2026-11-06T10:00:00Z') })
  const text = JSON.stringify(pdf.content)
  for (const s of ['Regiebericht', 'RB-2026-0004', 'Wohnanlage Lehen, 5020 Salzburg-Lehen', 'Wasserschaden: Keller nach Rohrbruch', 'Paul Muster (Hausverwaltung)', 'HV-1', 'Beilage zur Rechnung', 'RE-2026-0009', '07:30–11:45', '15 Min.', '4:00', '6:30', '2 Personen, zusammen 6:30 Stunden (6,5 Std.)', 'Allzweckreiniger 1 l', 'Bautrocknerfolie', '1 vorher, 2 nachher', 'Herbert Beispiel, Hausbetreuung', 'unterschrieben am Gerät am 05.11.2026, 11:40']) assert.ok(text.includes(s), s)
  assert.ok(pdf.content.some((x) => x.stack?.some((y) => y.svg === SIG)), 'Unterschrift als SVG im PDF')
  assert.ok(!/€|EUR/.test(text), 'ohne Preise')
  assert.equal(signedAtText('2026-07-01T08:05:00Z'), '01.07.2026, 10:05')
  // Fotos eingebettet, ohne Unterschrift
  const u = freezeRegie(closeReport(report(), { reason: 'niemand vor Ort', at: '2026-11-05T17:00:00Z', by: 'B' }), { object: { name: 'X' } })
  const img = 'data:image/jpeg;base64,/9j/4AAQ'
  const pdf2 = regieDocument({ report: u, photos: [{ image: img, phase: 'vorher', label: 'vorher 1' }, { image: img, phase: 'nachher', label: 'nachher 1' }, { image: img, phase: 'nachher', label: 'nachher 2' }] })
  const t2 = JSON.stringify(pdf2.content)
  assert.ok(t2.includes('Ohne Unterschrift abgeschlossen') && t2.includes('niemand vor Ort') && t2.includes('nachher 2') && !t2.includes('1 vorher, 2 nachher'))
  assert.equal((t2.match(/data:image\/jpeg/g) || []).length, 3)
})

test('Beispieldaten: ein unterschriebener, einer ohne Unterschrift, einer offen; prüfbar', () => {
  const d = createRegieDemo(TODAY)
  assert.deepEqual(d.reports.map((r) => r.status), ['abgeschlossen', 'abgeschlossen', 'offen'])
  for (const r of d.reports) assert.equal(reportProblem(r, TODAY), '', r.no)
  assert.equal(regieTotals(d.reports[0]).minutes, 390)
  assert.deepEqual(toBill(d.reports, []).map((r) => r.id), ['rb-demo1', 'rb-demo2'])
})

test('Rechte: Objektleitung, Objektmanagement, Objektservice erfassen (Ordner regie/ mit Fotos); Buchhaltung, Lager, Vorarbeiter nicht', () => {
  const r = (role) => dataRights(resolveAccess({ roleClaims: [role], strict: true }))
  for (const role of ['objektleitung', 'objektmanagement', 'objektservice']) {
    const a = resolveAccess({ roleClaims: [role], strict: true })
    assert.ok(a.sees('regie') && a.canEdit('regie'), role)
    const x = r(role)
    assert.ok(x.read(MODULE_DOCS.regie.path) && x.write(MODULE_DOCS.regie.path) && x.write('regie/nachweise/2026/RB-2026-0001_Lehen_2026-11-05_vorher-1.jpg') && x.read(DOC.objects) && x.write(MODULE_DOCS.assistenz.path), role)
    assert.ok(!x.read(MODULE_DOCS.fakturierung.path), `${role}: keine Rechnungen`)
  }
  for (const role of ['buchhaltung', 'lager', 'vorarbeiter', 'lesen', 'lohnverrechnung', 'pruefer', 'mattenwechsel']) {
    assert.ok(!r(role).read(MODULE_DOCS.regie.path) && !r(role).write('regie/nachweise/2026/x.pdf'), role)
    assert.ok(!resolveAccess({ roleClaims: [role], strict: true }).sees('regie'), role)
  }
  // Buchhaltung: Rechnungen ja (Entwurf mit eingefrorener Beilage), Regieberichte nein
  const bh = resolveAccess({ roleClaims: ['buchhaltung'], strict: true })
  assert.ok(bh.canEdit('fakturierung') && !bh.sees('regie'))
  const rows = (acc) => Object.fromEntries(folderRights(acc).map(([f, , x]) => [f, x]))
  assert.equal(rows(resolveAccess({ roleClaims: ['objektservice'], strict: true })).regie, 'Bearbeiten')
  assert.equal(rows(bh).regie, '')
  assert.equal(rows(resolveAccess({ email: 'office@cleanos.at', access: { planners: ['office@cleanos.at'] }, strict: true })).regie, 'Bearbeiten')
})
