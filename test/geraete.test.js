// Geräte & Maschinen (core/geraete.js): Fristen je Prüfart mit derselben Rechnung wie die Anlagen (frist aus
// core/anlagen.js), Zustand (gesperrt → außer Betrieb, Freigabe), Inventarnummer, Ausgabe-Verlauf, Reparaturen mit
// Kosten, Filter, Handlungsbedarf, Kennzahlen, Meldung vom Handy, Etikett.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, duesOf as anlagenDues, frist, leadDays } from '../src/core/anlagen.js'
import {
  addCheck,
  attention,
  checkProblem,
  counts,
  duesOf,
  emptyGeraete,
  filterRows,
  GERAETE_ARTEN,
  geraeteKpi,
  geraeteRows,
  isUrgent,
  issue,
  issueHistory,
  issueOverdue,
  issueProblem,
  itemFromKey,
  itemProblem,
  labelUrl,
  locationOf,
  locKey,
  matchDevice,
  nextAfter,
  nextNo,
  noProblem,
  normNo,
  plansFromType,
  PRUEFARTEN,
  repairCosts,
  repairFromPortal,
  repairMonths,
  repairProblem,
  rowOf,
  saveRepair,
  takeBack,
  timeline,
  typeOf,
  typesOf,
  withHome,
  withStatus,
} from '../src/core/geraete.js'
import { formatDate } from '../src/core/dates.js'
import { lastMonths } from '../src/core/kpi.js'
import { openRequests, requestText } from '../src/core/staffplan.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'
import { viewFromHash } from '../src/ui/context.js'

const TODAY = '2026-11-09'
let n = 0
const newId = () => `n${++n}`
const plan = (over = {}) => ({ id: 'p1', kind: 'elektro', label: '', months: 12, firstDue: '', active: true, ...over })
const item = (over = {}) => ({ id: 'g1', no: 'G-0001', name: 'Scheuersaugmaschine 1', typeId: 'scheuersaug', status: 'betrieb', home: { kind: 'lager', id: 'lager', label: 'Hauptlager' }, issued: null, plans: [plan(), plan({ id: 'p2', kind: 'wartung', months: 24 })], history: [], ...over })
const chk = (over = {}) => ({ id: `c${++n}`, itemId: 'g1', planId: 'p1', kind: 'elektro', date: '2025-12-01', result: 'ok', by: 'Elektro Beispiel', at: '2025-12-01T09:00:00Z', ...over })
const doc = (over = {}) => ({ ...emptyGeraete(), items: [item()], ...over })

test('Vorgaben: Prüfarten mit Grundlage, Arten mit Vorschlag, leere Datei wie in der Ablage', () => {
  assert.deepEqual(MODULE_DOCS.geraete.empty(), emptyGeraete())
  assert.equal(MODULE_DOCS.geraete.path, 'geraete/geraete.json')
  assert.match(PRUEFARTEN.elektro.basis, /E 8701/)
  assert.match(PRUEFARTEN.elektro.basis, /Evaluierung/)
  assert.match(PRUEFARTEN.leiter.basis, /EN 131/)
  const byId = Object.fromEntries(GERAETE_ARTEN.map((t) => [t.id, t]))
  for (const id of ['scheuersaug', 'sauger', 'hochdruck', 'einscheibe', 'leiter', 'akku', 'sonstige']) assert.ok(byId[id], id)
  assert.deepEqual(byId.leiter.plans.map((p) => p.kind), ['leiter'])
  assert.deepEqual(byId.scheuersaug.plans.map((p) => p.kind), ['elektro', 'wartung'])
  assert.deepEqual(byId.sonstige.plans, [])
  assert.equal(new Set(GERAETE_ARTEN.map((t) => t.id)).size, GERAETE_ARTEN.length)
  // eigene Arten ersetzen die Vorgaben, inaktive fallen aus der Auswahl
  const own = { types: [{ id: 'x', name: 'Eigene', plans: [] }, { id: 'y', name: 'Alt', plans: [], active: false }] }
  assert.deepEqual(typesOf(own).map((t) => t.id), ['x'])
  assert.equal(typeOf(own, 'y').name, 'Alt')
  // Prüfarten aus der Vorlage: neue Kennungen, Intervall übernommen, änderbar
  const plans = plansFromType(byId.hochdruck, newId)
  assert.equal(plans.length, 2)
  assert.ok(plans.every((p) => p.id && p.active && p.months === 12 && p.firstDue === ''))
})

test('Fristen: dieselbe Rechnung wie die Anlagen (frist), Monatsende, ohne Prüfung fällig oder „fällig am“', () => {
  // Kern der Anlagen verallgemeinert: frist liefert dasselbe wie duesOf der Anlagen
  const a = anlagenDues({ item: { id: 'a', months: 12 }, type: null, checks: [{ itemId: 'a', kind: 'haupt', date: '2025-11-20' }], today: TODAY })[0]
  const f = frist({ last: '2025-11-20', months: 12, today: TODAY })
  assert.deepEqual({ next: a.next, state: a.state }, { next: f.next, state: f.state })
  assert.equal(f.next, '2026-11-20')
  assert.equal(f.state, 'faellig') // 30 Tage vorher
  assert.deepEqual(frist({ last: '2026-01-31', months: 1, today: '2026-02-01' }).next, '2026-02-28')
  assert.equal(frist({ last: '', months: 12, firstDue: '', today: TODAY }).unknown, true)
  assert.equal(frist({ last: '2025-01-01', months: 0, today: TODAY }).noInterval, true)
  assert.equal(leadDays(1), 7)

  const checks = [chk({ date: '2025-10-01' }), chk({ date: '2025-06-01' }), chk({ planId: 'p2', kind: 'wartung', date: '2025-12-15' })]
  const dues = duesOf({ item: item(), checks, today: TODAY })
  assert.deepEqual(dues.map((d) => [d.plan.id, d.next, d.state]), [['p1', '2026-10-01', 'ueberfaellig'], ['p2', '2027-12-15', 'ok']])
  assert.equal(dues[0].last.date, '2025-10-01')
  // ohne Prüfung: „fällig am“ der Prüfart, sonst gleich fällig; inaktive Prüfart zählt nicht
  const fresh = item({ plans: [plan({ firstDue: '2027-03-01' }), plan({ id: 'p2', kind: 'wartung' }), plan({ id: 'p3', active: false })] })
  assert.deepEqual(duesOf({ item: fresh, checks: [], today: TODAY }).map((d) => [d.plan.id, d.next, d.state, !!d.unknown]), [['p1', '2027-03-01', 'ok', false], ['p2', '', 'faellig', true]])
  // nächste nach einer Prüfung
  assert.equal(nextAfter(plan({ months: 6 }), '2026-08-31'), '2027-02-28')
  assert.equal(nextAfter(plan({ months: 0 }), '2026-08-31'), '')
})

test('Zeile je Gerät: dringendste Frist, ohne Prüfart, ausgeschieden ohne Frist, Ort', () => {
  const d = doc({ checks: [chk({ date: '2025-10-01' })] })
  const r = rowOf({ item: d.items[0], doc: d, today: TODAY })
  assert.equal(r.state, 'ueberfaellig')
  assert.equal(r.next, '2026-10-01')
  assert.equal(r.type.name, 'Scheuersaugmaschine')
  assert.equal(r.location.label, 'Hauptlager')
  assert.equal(rowOf({ item: item({ plans: [] }), doc: d, today: TODAY }).state, 'ohne')
  const aus = rowOf({ item: item({ status: 'ausgeschieden' }), doc: d, today: TODAY })
  assert.deepEqual([aus.state, aus.dues.length, aus.next], ['aus', 0, ''])
  // unbekannter Zustand gilt als in Betrieb
  assert.equal(rowOf({ item: item({ status: 'xyz' }), doc: d, today: TODAY }).status, 'betrieb')
})

test('Inventarnummer: fortlaufend je Präfix, vierstellig, Vergleich ohne Striche und Nullen, doppelte gesperrt', () => {
  assert.equal(nextNo([], 'G-'), 'G-0001')
  const items = [{ id: 'a', no: 'G-0007', name: 'Sauger' }, { id: 'b', no: 'g-12', name: 'Leiter' }, { id: 'c', no: 'L-0099', name: 'Fremd' }, { id: 'd', no: 'ohne', name: 'X' }]
  assert.equal(nextNo(items, 'G-'), 'G-0013')
  assert.equal(nextNo(items, 'L-'), 'L-0100')
  assert.equal(nextNo(items, ''), '0001')
  assert.equal(normNo(' g 0007 '), 'G7')
  assert.equal(normNo('G-0007'), normNo('g7'))
  assert.equal(noProblem('', items), 'Bitte die Inventarnummer eintragen.')
  assert.match(noProblem('G 7', items), /G-0007 hat schon „Sauger“/)
  assert.equal(noProblem('G-0007', items, 'a'), '') // das Gerät selbst
  assert.equal(noProblem('G-0013', items), '')
  // Gerät prüfen
  assert.equal(itemProblem({ ...item(), id: 'neu', no: 'G-0012' }, items), 'Die Inventarnummer g-12 hat schon „Leiter“.')
  assert.equal(itemProblem({ ...item(), name: ' ' }, []), 'Bitte die Bezeichnung eintragen, z. B. Scheuersaugmaschine 1.')
  assert.equal(itemProblem({ ...item(), home: { kind: 'objekt', id: '' } }, []), 'Bitte das Objekt des Standorts wählen.')
  assert.equal(itemProblem({ ...item(), home: { kind: 'fahrzeug', id: '', label: '' } }, []), 'Bitte das Fahrzeug eintragen.')
  assert.equal(itemProblem({ ...item(), price: -5 }, []), 'Der Kaufpreis darf nicht negativ sein.')
  assert.match(itemProblem({ ...item(), plans: [plan({ months: '' })] }, []), /Intervall für „Prüfung elektrischer Betriebsmittel“/)
  assert.equal(itemProblem({ ...item(), plans: [plan({ months: '', active: false })] }, []), '')
  assert.equal(itemProblem(item(), []), '')
})

test('Prüfung: Ergebnis „gesperrt“ setzt außer Betrieb, „in Ordnung“ mit Freigabe nimmt es wieder in Betrieb', () => {
  const g = item()
  assert.equal(checkProblem({ itemId: 'g1', planId: 'p1', date: '2026-11-10', result: 'ok', by: 'x' }, TODAY), 'Das Datum liegt in der Zukunft.')
  assert.equal(checkProblem({ itemId: 'g1', planId: 'px', date: TODAY, result: 'ok', by: 'x' }, TODAY, g), 'Diese Prüfart gibt es am Gerät nicht.')
  assert.equal(checkProblem({ itemId: 'g1', planId: 'p1', date: TODAY, result: 'gesperrt', by: 'x' }, TODAY, g), 'Bitte kurz eintragen, warum das Gerät gesperrt ist.')
  assert.equal(checkProblem({ itemId: 'g1', planId: 'p1', date: TODAY, result: 'maengel', by: 'x' }, TODAY, g), 'Bitte die Mängel beschreiben.')
  assert.equal(checkProblem({ itemId: 'g1', planId: 'p1', date: TODAY, result: 'ok', by: ' ' }, TODAY, g), 'Bitte eintragen, wer geprüft hat.')
  assert.equal(checkProblem({ itemId: 'g1', planId: 'p1', date: TODAY, result: 'ok', by: 'Petra' }, TODAY, g), '')

  const issuedItem = { ...g, issued: { kind: 'objekt', id: 'o5', label: 'Wohnanlage Lehen', since: '2026-11-01' } }
  const res = addCheck({ checks: [], item: issuedItem, input: { planId: 'p1', date: TODAY, result: 'gesperrt', defects: 'Kabel beschädigt', values: 'Isolationswiderstand 0,2 MΩ', by: 'Elektro Beispiel' }, newId, at: 'T1', user: 'Petra' })
  assert.equal(res.change, 'gesperrt')
  assert.equal(res.item.status, 'gesperrt')
  assert.equal(res.item.statusSince, TODAY)
  assert.match(res.item.statusNote, /E-Prüfung am 09.11.2026: Kabel beschädigt/)
  assert.deepEqual(res.check.kind, 'elektro')
  assert.equal(res.check.values, 'Isolationswiderstand 0,2 MΩ')
  assert.equal(res.item.history.at(-1).kind, 'status')
  assert.deepEqual([res.item.history.at(-1).from, res.item.history.at(-1).to], ['betrieb', 'gesperrt'])
  // gesperrte Geräte werden nicht ausgegeben
  assert.match(issueProblem(res.item, { to: { kind: 'person', id: 'e1', label: 'Anna' }, date: TODAY }), /außer Betrieb/)
  assert.throws(() => issue(res.item, { to: { kind: 'person', id: 'e1', label: 'Anna' }, date: TODAY }), /außer Betrieb/)
  // Mängel: Zustand bleibt
  const m = addCheck({ checks: res.checks, item: g, input: { planId: 'p2', date: TODAY, result: 'maengel', defects: 'Bürsten abgenützt', by: 'x' }, newId })
  assert.deepEqual([m.item.status, m.change, m.check.defects], ['betrieb', '', 'Bürsten abgenützt'])
  // in Ordnung ohne Freigabe: bleibt gesperrt; mit Freigabe: wieder in Betrieb
  const keep = addCheck({ checks: res.checks, item: res.item, input: { planId: 'p1', date: TODAY, result: 'ok', by: 'x' }, newId })
  assert.equal(keep.item.status, 'gesperrt')
  const free = addCheck({ checks: res.checks, item: res.item, input: { planId: 'p1', date: TODAY, result: 'ok', defects: 'egal', by: 'x' }, newId, release: true, user: 'Petra' })
  assert.deepEqual([free.item.status, free.change, free.check.defects], ['betrieb', 'frei', ''])
  assert.equal(free.checks.length, 2)
  // ausgeschieden bleibt ausgeschieden
  assert.equal(addCheck({ checks: [], item: item({ status: 'ausgeschieden' }), input: { planId: 'p1', date: TODAY, result: 'gesperrt', defects: 'x', by: 'x' }, newId }).item.status, 'ausgeschieden')
})

test('Zustand und Standort: Verlauf, ausgeschieden beendet die Ausgabe', () => {
  const g = item()
  assert.equal(withStatus(g, 'betrieb', { date: TODAY }), g) // unverändert
  assert.equal(withStatus(g, 'kaputt', { date: TODAY }), g) // unbekannt
  const out = withStatus({ ...g, issued: { kind: 'person', id: 'e2', label: 'Anna Berger', since: '2026-10-01' } }, 'ausgeschieden', { date: TODAY, by: 'Petra', note: 'verschrottet', at: 'T' })
  assert.equal(out.issued, null)
  assert.deepEqual(out.history.map((h) => h.kind), ['rueckgabe', 'status'])
  assert.equal(out.history[0].from, 'Anna Berger')
  assert.equal(out.statusNote, 'verschrottet')
  const moved = withHome(g, { kind: 'fahrzeug', id: 'v1', label: 'Bus S-284 KL' }, { date: TODAY, by: 'Petra' })
  assert.deepEqual([moved.history.at(-1).kind, moved.history.at(-1).from, moved.history.at(-1).to], ['standort', 'Hauptlager', 'Bus S-284 KL'])
  assert.equal(withHome(g, { ...g.home }, { date: TODAY }).history.length, 0)
})

test('Ausgabe und Rücknahme: an Objekt oder Person, Weitergabe, Verlauf neueste zuerst, Rückgabe überfällig', () => {
  const g = item()
  assert.equal(issueProblem(g, { to: { kind: 'objekt', id: '' }, date: TODAY }), 'Bitte das Objekt wählen.')
  assert.equal(issueProblem(g, { to: { kind: 'person', id: '' }, date: TODAY }), 'Bitte die Person wählen.')
  assert.equal(issueProblem(g, { to: { kind: 'objekt', id: 'o5' }, date: '' }), 'Bitte das Datum eintragen.')
  assert.equal(issueProblem(item({ status: 'reparatur' }), { to: { kind: 'objekt', id: 'o5' }, date: TODAY }), 'Das Gerät ist in Reparatur.')
  assert.equal(issueProblem(item({ status: 'ausgeschieden' }), { to: { kind: 'objekt', id: 'o5' }, date: TODAY }), 'Das Gerät ist ausgeschieden.')
  const a = issue(g, { to: { kind: 'objekt', id: 'o5', label: 'Wohnanlage Lehen' }, date: '2026-11-02', due: '2026-11-06', by: 'Petra', note: 'Grundreinigung', at: 'T1' })
  assert.deepEqual(a.issued, { kind: 'objekt', id: 'o5', label: 'Wohnanlage Lehen', since: '2026-11-02', due: '2026-11-06' })
  assert.deepEqual(locationOf(a), { ...a.issued, issued: true })
  assert.equal(locKey(locationOf(a)), 'objekt:o5')
  assert.ok(issueOverdue(a, TODAY))
  assert.equal(issueProblem(a, { to: { kind: 'objekt', id: 'o5' }, date: TODAY }), 'Das Gerät ist schon bei Wohnanlage Lehen.')
  // Weitergabe an eine Person: von Objekt an Person
  const b = issue(a, { to: { kind: 'person', id: 'e3', label: 'Anna Berger' }, date: '2026-11-05', by: 'Petra', at: 'T2' })
  assert.equal(b.history.at(-1).from, 'Wohnanlage Lehen')
  assert.equal(b.issued.due, undefined)
  const c = takeBack(b, { date: TODAY, by: 'Lena', note: 'sauber zurück', at: 'T3' })
  assert.equal(c.issued, null)
  assert.deepEqual(locationOf(c), { ...g.home, issued: false })
  assert.equal(takeBack(c, { date: TODAY }), c) // nichts ausgegeben
  const h = issueHistory(c)
  assert.deepEqual(h.map((x) => [x.kind, x.date, x.from, x.to]), [['rueckgabe', TODAY, 'Anna Berger', 'Hauptlager'], ['ausgabe', '2026-11-05', 'Wohnanlage Lehen', 'Anna Berger'], ['ausgabe', '2026-11-02', 'Hauptlager', 'Wohnanlage Lehen']])
  assert.equal(h[0].note, 'sauber zurück')
  // ohne Standort: Lager
  assert.deepEqual(locationOf({ id: 'x' }), { kind: 'lager', id: '', label: 'Lager', issued: false })
})

test('Reparaturen: melden (auch gleich sperren), Werkstatt → in Reparatur, erledigt → in Betrieb, Protokoll', () => {
  assert.equal(repairProblem({ itemId: '', text: 'x', date: TODAY }, TODAY), 'Bitte das Gerät wählen.')
  assert.equal(repairProblem({ itemId: 'g1', text: '', date: TODAY }, TODAY), 'Bitte beschreiben, was kaputt ist.')
  assert.equal(repairProblem({ itemId: 'g1', text: 'x', date: TODAY, status: 'erledigt' }, TODAY), 'Bitte eintragen, wann die Reparatur erledigt war.')
  assert.equal(repairProblem({ itemId: 'g1', text: 'x', date: TODAY, status: 'erledigt', doneOn: '2026-11-01' }, TODAY), 'Erledigt liegt vor der Meldung.')
  assert.equal(repairProblem({ itemId: 'g1', text: 'x', date: TODAY, cost: -1 }, TODAY), 'Die Kosten dürfen nicht negativ sein.')
  const g = item()
  const r1 = saveRepair({ repairs: [], item: g, input: { date: '2026-11-03', text: 'Saugschlauch gerissen', objectId: 'o5' }, newId, at: 'T1', user: 'Anna', block: true })
  assert.equal(r1.repair.status, 'gemeldet')
  assert.equal(r1.repair.reportedBy, 'Anna')
  assert.equal(r1.item.status, 'gesperrt')
  assert.deepEqual(r1.repair.log.map((l) => l.status), ['gemeldet'])
  // ohne Sperren bleibt das Gerät in Betrieb; Werkstatt setzt „in Reparatur“
  const r2 = saveRepair({ repairs: [], item: g, input: { date: '2026-11-03', text: 'Bürste lose' }, newId, at: 'T1', user: 'Anna' })
  assert.equal(r2.item.status, 'betrieb')
  const r3 = saveRepair({ repairs: r2.repairs, item: r2.item, input: { ...r2.repair, status: 'werkstatt', workshop: 'Reinigungstechnik Beispiel' }, newId, at: 'T2', user: 'Lena' })
  assert.equal(r3.repairs.length, 1)
  assert.equal(r3.item.status, 'reparatur')
  assert.match(r3.item.statusNote, /Reinigungstechnik Beispiel/)
  assert.deepEqual(r3.repair.log.map((l) => l.status), ['gemeldet', 'werkstatt'])
  // gesperrtes Gerät bleibt bei Werkstatt gesperrt
  assert.equal(saveRepair({ repairs: r1.repairs, item: r1.item, input: { ...r1.repair, status: 'werkstatt' }, newId }).item.status, 'gesperrt')
  // zweite Reparatur in der Werkstatt hält „in Reparatur“
  const r4 = saveRepair({ repairs: r3.repairs, item: r3.item, input: { date: '2026-11-04', text: 'Rad', status: 'werkstatt' }, newId, at: 'T3' })
  const r5 = saveRepair({ repairs: r4.repairs, item: r4.item, input: { ...r3.repair, status: 'erledigt', doneOn: '2026-11-08', cost: '148,5'.replace(',', '.'), invoice: { id: 'er1', no: 'ER-2026-0009', net: 148.5 } }, newId, at: 'T4' })
  assert.equal(r5.item.status, 'reparatur')
  assert.equal(r5.repair.cost, 148.5)
  assert.equal(r5.repair.invoice.no, 'ER-2026-0009')
  const r6 = saveRepair({ repairs: r5.repairs, item: r5.item, input: { ...r4.repair, status: 'verworfen' }, newId, at: 'T5' })
  assert.equal(r6.item.status, 'betrieb')
  assert.equal(r6.item.history.at(-1).note, 'kein Schaden')
  // Stand ohne Änderung: kein neuer Eintrag im Protokoll; doneOn nur bei erledigt
  const same = saveRepair({ repairs: r6.repairs, item: r6.item, input: { ...r5.repair, note: 'Rechnung kommt' }, newId })
  assert.equal(same.repair.log.length, r5.repair.log.length)
  assert.equal(saveRepair({ repairs: [], item: g, input: { date: TODAY, text: 'x', doneOn: TODAY } , newId }).repair.doneOn, '')
})

test('Reparaturkosten: je Gerät und je Monat, „kein Schaden“ zählt nicht, Monat laut erledigt', () => {
  const repairs = [
    { id: 'r1', itemId: 'g1', date: '2026-08-20', doneOn: '2026-09-02', status: 'erledigt', cost: 120 },
    { id: 'r2', itemId: 'g1', date: '2026-10-05', status: 'werkstatt', cost: 80.25 },
    { id: 'r3', itemId: 'g2', date: '2026-10-07', doneOn: '2026-10-09', status: 'erledigt', cost: 45 },
    { id: 'r4', itemId: 'g2', date: '2026-10-08', status: 'verworfen', cost: 99 },
    { id: 'r5', itemId: '', date: '2026-10-08', status: 'gemeldet', cost: '' },
  ]
  const all = repairCosts(repairs)
  assert.deepEqual(all.get('g1'), { cost: 200.25, count: 2 })
  assert.deepEqual(all.get('g2'), { cost: 45, count: 1 })
  assert.equal(all.size, 2)
  assert.deepEqual(repairCosts(repairs, { from: '2026-10-01', to: '2026-10-31' }).get('g1'), { cost: 80.25, count: 1 })
  const months = lastMonths(3, TODAY)
  assert.deepEqual(repairMonths(repairs, months), [{ key: '2026-09', cost: 120, count: 1 }, { key: '2026-10', cost: 125.25, count: 2 }, { key: '2026-11', cost: 0, count: 0 }])
})

test('Liste: Filter Art, Standort, Zustand, Prüfung, Suche; Kacheln; Handlungsbedarf', () => {
  const d = {
    ...emptyGeraete(),
    items: [
      item(),
      item({ id: 'g2', no: 'G-0002', name: 'Leiter 3 Stufen', typeId: 'leiter', plans: [plan({ id: 'q1', kind: 'leiter', firstDue: '2027-05-01' })], issued: { kind: 'objekt', id: 'o5', label: 'Wohnanlage Lehen', since: '2026-10-01' } }),
      item({ id: 'g3', no: 'G-0003', name: 'Sauger Bus', typeId: 'sauger', status: 'gesperrt', home: { kind: 'fahrzeug', id: 'v1', label: 'Bus S-284 KL' }, plans: [plan({ id: 'q2', firstDue: '2026-11-20' })], maker: 'Saugwerk' }),
      item({ id: 'g4', no: 'G-0010', name: 'Alter Sauger', typeId: 'sauger', status: 'ausgeschieden', plans: [] }),
      item({ id: 'g5', no: 'G-0004', name: 'Hochdruckreiniger', typeId: 'hochdruck', plans: [] }),
    ],
    checks: [chk({ date: '2025-10-01' }), chk({ planId: 'p2', kind: 'wartung', date: '2026-01-10' })],
    repairs: [{ id: 'r1', itemId: 'g5', date: '2026-11-08', text: 'Düse verstopft', status: 'gemeldet' }, { id: 'r2', itemId: '', date: '2026-11-08', text: 'Gerät: Staubsauger rot', status: 'gemeldet', source: 'handy' }],
  }
  const rows = geraeteRows({ doc: d, today: TODAY })
  assert.deepEqual(rows.map((r) => r.item.no), ['G-0001', 'G-0002', 'G-0003', 'G-0004', 'G-0010'])
  const ids = (f) => filterRows(rows, f).map((r) => r.item.id)
  assert.deepEqual(ids({}), ['g1', 'g2', 'g3', 'g5']) // ohne ausgeschiedene
  assert.deepEqual(ids({ status: 'ausgeschieden' }), ['g4'])
  assert.deepEqual(ids({ status: 'gesperrt' }), ['g3'])
  assert.deepEqual(ids({ typeId: 'sauger' }), ['g3'])
  assert.deepEqual(ids({ location: 'fahrzeug' }), ['g3'])
  assert.deepEqual(ids({ location: 'objekt:o5' }), ['g2'])
  assert.deepEqual(ids({ location: 'ausgegeben' }), ['g2'])
  assert.deepEqual(ids({ location: 'lager:lager' }), ['g1', 'g5'])
  assert.deepEqual(ids({ due: 'ueberfaellig' }), ['g1'])
  assert.deepEqual(ids({ due: 'bedarf' }), ['g1', 'g3'])
  assert.deepEqual(ids({ due: 'ok' }), ['g2'])
  assert.deepEqual(ids({ q: 'saugwerk bus' }), ['g3'])
  assert.deepEqual(ids({ q: 'g-0002' }), ['g2'])
  assert.deepEqual(counts(rows), { ueberfaellig: 1, faellig: 1, gesperrt: 1, reparatur: 0, bestand: 4 })
  const att = attention(rows, d.repairs)
  assert.deepEqual(att.map((g) => [g.id, g.due.length, g.blocked, g.reports.length, isUrgent(g)]), [['g1', 1, false, 0, true], ['g3', 1, true, 0, true], ['g5', 0, false, 1, false], ['', 0, false, 1, false]])
})

test('Kennzahlen: Geräte nach Zustand, überfällige Prüfungen, Reparaturkosten je Monat', () => {
  assert.equal(geraeteKpi({ doc: emptyGeraete(), months: lastMonths(3, TODAY), today: TODAY }), null)
  const d = doc({
    items: [item(), item({ id: 'g2', no: 'G-0002', status: 'reparatur' }), item({ id: 'g3', no: 'G-0003', status: 'ausgeschieden' })],
    checks: [chk({ date: '2025-10-01' }), chk({ itemId: 'g2', date: '2025-10-01' })],
    repairs: [{ id: 'r1', itemId: 'g2', date: '2026-10-02', status: 'werkstatt', cost: 210 }],
  })
  const k = geraeteKpi({ doc: d, months: lastMonths(2, TODAY), today: TODAY })
  assert.deepEqual(k.byStatus, { betrieb: 1, reparatur: 1, gesperrt: 0, ausgeschieden: 1 })
  assert.equal(k.overdue, 2)
  assert.equal(k.overduePlans, 2) // je Gerät die E-Prüfung; die Wartung ohne Prüfung ist fällig, nicht überfällig
  assert.equal(k.due, 0)
  assert.deepEqual(k.repairs, [{ key: '2026-10', cost: 210, count: 1 }, { key: '2026-11', cost: 0, count: 0 }])
})

test('Meldung vom Handy: Gerät über die Inventarnummer, sonst offen zum Zuordnen', () => {
  const items = [item(), item({ id: 'g2', no: 'G-0012', name: 'Sauger' }), item({ id: 'g3', no: 'G-0013', status: 'ausgeschieden' })]
  assert.equal(matchDevice('G-0012 Schlauch kaputt', items)?.id, 'g2')
  assert.equal(matchDevice('Sauger g12 saugt nicht', items)?.id, 'g2')
  assert.equal(matchDevice('G 0001 und G-0012', items), null) // nicht eindeutig
  assert.equal(matchDevice('G-0013', items), null) // ausgeschieden
  assert.equal(matchDevice('der rote Sauger', items), null)
  const a = { id: 'w1', name: 'Anna Berger', art: 'Geraet', objekt: 'o5', von: TODAY, geraet: 'G-0012', notiz: 'Kabel angeschmort, riecht verbrannt' }
  const r = repairFromPortal(a, { items, newId, at: `${TODAY}T07:10:00Z` })
  assert.deepEqual([r.itemId, r.objectId, r.source, r.portalId, r.status, r.reportedBy, r.date], ['g2', 'o5', 'handy', 'w1', 'gemeldet', 'Anna Berger', TODAY])
  assert.equal(r.text, 'Kabel angeschmort, riecht verbrannt')
  const loose = repairFromPortal({ ...a, geraet: 'roter Staubsauger' }, { items, newId, at: `${TODAY}T07:10:00Z` })
  assert.equal(loose.itemId, '')
  assert.equal(loose.text, 'Gerät: roter Staubsauger. Kabel angeschmort, riecht verbrannt')
})

test('Verlauf und Etikett: Prüfungen, Reparaturen, Ausgaben in einer Liste; Adresse und Rückweg vom QR-Code', () => {
  let g = issue(item(), { to: { kind: 'objekt', id: 'o5', label: 'Wohnanlage Lehen' }, date: '2026-10-01', at: '2026-10-01T08:00:00Z' })
  g = takeBack(g, { date: '2026-10-20', at: '2026-10-20T08:00:00Z' })
  const d = doc({ items: [g], checks: [chk({ date: '2026-10-10' })], repairs: [{ id: 'r1', itemId: 'g1', date: '2026-10-15', status: 'erledigt', at: '2026-10-15T10:00:00Z' }] })
  assert.deepEqual(timeline(d, 'g1').map((x) => [x.kind, x.date]), [['rueckgabe', '2026-10-20'], ['reparatur', '2026-10-15'], ['pruefung', '2026-10-10'], ['ausgabe', '2026-10-01']])
  assert.deepEqual(timeline(d, 'nix'), [])
  const url = labelUrl('https://app.cleanos.at/#geraete', 'G-0001')
  assert.equal(url, 'https://app.cleanos.at/#geraete/G-0001')
  assert.equal(itemFromKey('geraete/g-0001', d.items)?.id, 'g1')
  assert.equal(itemFromKey('geraete/g-1', d.items)?.id, 'g1')
  assert.equal(itemFromKey('geraete', d.items), null)
  assert.equal(itemFromKey('geraete/g-0099', d.items), null)
  // die Adresse vom Etikett öffnet die Ansicht (Rest der Adresse liest die Ansicht selbst)
  assert.equal(viewFromHash('#geraete/G-0001', ['geraete', 'week']), 'geraete')
  assert.equal(viewFromHash('#geraete', ['geraete']), 'geraete')
  assert.equal(viewFromHash('#unbekannt/G-0001', ['geraete']), null)
})

test('Mein Dienstplan: Meldung „Gerät kaputt?“ ist ein gültiger Antrag mit lesbarem Text', () => {
  const list = openRequests([{ id: 'w1', hash: 'h1', art: 'Geraet', objekt: 'o5', text: 'Wohnanlage Lehen', geraet: 'G-0012', notiz: 'Kabel angeschmort', von: TODAY, bis: TODAY, status: 'offen', erstellt: 1 }, { id: 'w2', hash: 'h1', art: 'Unbekannt', von: TODAY, bis: TODAY, status: 'offen', erstellt: 2 }], new Map([['h1', 'e3']]))
  assert.deepEqual(list.map((a) => [a.id, a.employeeId]), [['w1', 'e3']])
  assert.equal(requestText(list[0], formatDate), 'meldet ein kaputtes Gerät (Wohnanlage Lehen): G-0012 – Kabel angeschmort')
})
