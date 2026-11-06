// Anlagen & Prüffristen (core/anlagen.js): Fälligkeit mit Monatsenden, Zustand, überfällig, operative Inspektion,
// Mängel offen und behoben, Filter, Handlungsbedarf je Objekt, verrechenbare Prüfungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addCheck,
  addMonths,
  ANLAGEN_DEFAULTS,
  anlagenRows,
  attention,
  billableChecks,
  checkProblem,
  checksOf,
  counts,
  duesOf,
  emptyAnlagen,
  filterRows,
  intervalOf,
  isDefectOpen,
  isUrgent,
  itemProblem,
  leadDays,
  matchStatus,
  nextAfter,
  openDefects,
  operativeOf,
  resolveDefect,
  statusOf,
  typeOf,
  typesOf,
} from '../src/core/anlagen.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const TODAY = '2026-11-06'
const ext = typeOf(null, 'feuerloescher')
const item = (over = {}) => ({ id: 'a1', objectId: 'o1', typeId: 'feuerloescher', label: 'Stiege 2, EG', count: 2, by: 'fremd', company: 'Brandschutz GmbH', active: true, ...over })
const check = (over = {}) => ({ id: `c${Math.random()}`, itemId: 'a1', kind: 'haupt', date: '2025-01-10', result: 'ok', defects: '', by: 'Brandschutz GmbH', at: '2025-01-10T09:00:00Z', ...over })
let n = 0
const newId = () => `n${++n}`

test('Vorgaben: Arten mit Intervall und Grundlage, Fettabscheider ohne festes Intervall, leere Datei wie in der Ablage', () => {
  assert.ok(ANLAGEN_DEFAULTS.length >= 11)
  const byId = Object.fromEntries(ANLAGEN_DEFAULTS.map((t) => [t.id, t]))
  assert.equal(byId.feuerloescher.months, 24)
  assert.match(byId.feuerloescher.basis, /ÖNORM F 1053/)
  assert.equal(byId.rauchmelder.months, 12)
  assert.equal(byId.spielplatz.months, 12)
  assert.equal(byId.spielplatz.operativeMonths, 1)
  assert.equal(byId.lift.by, 'fremd')
  assert.equal(byId.blitzschutz.months, 36)
  assert.equal(byId.rueckstau.months, 6)
  assert.equal(byId.fettabscheider.months, 0)
  assert.ok(byId.sonstige)
  assert.equal(new Set(ANLAGEN_DEFAULTS.map((t) => t.id)).size, ANLAGEN_DEFAULTS.length)
  assert.deepEqual(MODULE_DOCS.anlagen.empty(), emptyAnlagen())
  assert.equal(MODULE_DOCS.anlagen.path, 'anlagen/anlagen.json')
  // eigene Arten ersetzen die Vorgaben, inaktive fallen aus der Auswahl
  const doc = { types: [{ id: 'x', name: 'Eigene', months: 6 }, { id: 'y', name: 'Alt', months: 12, active: false }] }
  assert.deepEqual(typesOf(doc).map((t) => t.id), ['x'])
  assert.equal(typeOf(doc, 'y').name, 'Alt')
  assert.equal(typeOf(doc, 'feuerloescher'), null)
})

test('Datum plus Monate: Monatsende und Schaltjahr', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28')
  assert.equal(addMonths('2026-03-31', 24), '2028-03-31')
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28')
  assert.equal(addMonths('2026-11-06', 36), '2029-11-06')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
})

test('Intervall: an der Anlage vor der Art, operative Inspektion nur wenn eingeschaltet', () => {
  assert.equal(intervalOf(item(), ext), 24)
  assert.equal(intervalOf(item({ months: 12 }), ext), 12)
  assert.equal(intervalOf(item({ months: '' }), ext), 24)
  assert.equal(intervalOf(item({ typeId: 'fettabscheider' }), typeOf(null, 'fettabscheider')), 0)
  const sp = typeOf(null, 'spielplatz')
  assert.equal(operativeOf(item({ typeId: 'spielplatz' }), sp), 0)
  assert.equal(operativeOf(item({ typeId: 'spielplatz', operative: true }), sp), 1)
  assert.equal(operativeOf(item({ typeId: 'spielplatz', operative: true, operativeMonths: 3 }), sp), 3)
  assert.equal(operativeOf(item({ operative: true }), ext), 1, 'ohne Vorgabe der Art: monatlich')
  assert.equal(leadDays(12), 30)
  assert.equal(leadDays(1), 7)
  assert.equal(leadDays(3), 22)
  assert.equal(leadDays(12, 14), 14)
})

test('Fälligkeit: ab dem Datum der letzten Prüfung, nicht ab der alten Frist; Monatsende', () => {
  // Prüfung am 31.8.2024 alle 24 Monate → 31.8.2026: überfällig
  let s = statusOf({ item: item(), type: ext, checks: [check({ date: '2024-08-31' })], today: TODAY })
  assert.equal(s.next, '2026-08-31')
  assert.equal(s.state, 'ueberfaellig')
  // verspätet geprüft am 6.11.2026 → nächste am 6.11.2028
  s = statusOf({ item: item(), type: ext, checks: [check({ date: '2024-08-31' }), check({ date: '2026-11-06', at: '2026-11-06T10:00:00Z' })], today: TODAY })
  assert.equal(s.next, '2028-11-06')
  assert.equal(s.state, 'ok')
  assert.equal(s.last.date, '2026-11-06')
  // Monatsende: 31.12.2024 + 24 Monate = 31.12.2026 → in 55 Tagen: in Ordnung; 30.11.2024 → in 24 Tagen: fällig
  assert.equal(statusOf({ item: item(), type: ext, checks: [check({ date: '2024-12-31' })], today: TODAY }).state, 'ok')
  s = statusOf({ item: item(), type: ext, checks: [check({ date: '2024-11-30' })], today: TODAY })
  assert.deepEqual([s.next, s.state], ['2026-11-30', 'faellig'])
  // genau heute fällig: fällig, gestern: überfällig
  assert.equal(statusOf({ item: item(), type: ext, checks: [check({ date: '2024-11-06' })], today: TODAY }).state, 'faellig')
  assert.equal(statusOf({ item: item(), type: ext, checks: [check({ date: '2024-11-05' })], today: TODAY }).state, 'ueberfaellig')
  assert.equal(nextAfter(item(), ext, '2026-01-31'), '2028-01-31')
  assert.equal(nextAfter(item({ months: 1 }), ext, '2026-01-31'), '2026-02-28')
})

test('Ohne Prüfung: erste Fälligkeit von Hand, sonst gleich fällig; ohne Intervall unbekannt', () => {
  let s = statusOf({ item: item({ firstDue: '2027-03-31' }), type: ext, checks: [], today: TODAY })
  assert.deepEqual([s.state, s.next, s.unknown], ['ok', '2027-03-31', false])
  s = statusOf({ item: item({ firstDue: '2026-11-20' }), type: ext, checks: [], today: TODAY })
  assert.equal(s.state, 'faellig')
  s = statusOf({ item: item(), type: ext, checks: [], today: TODAY })
  assert.deepEqual([s.state, s.next, s.unknown], ['faellig', '', true])
  // erste Prüfung ersetzt die Fälligkeit von Hand
  s = statusOf({ item: item({ firstDue: '2026-01-01' }), type: ext, checks: [check({ date: '2026-10-01' })], today: TODAY })
  assert.deepEqual([s.state, s.next], ['ok', '2028-10-01'])
  // Fettabscheider ohne Intervall: nach einer Prüfung unbekannt (bitte Intervall eintragen)
  const fett = typeOf(null, 'fettabscheider')
  const d = duesOf({ item: item({ typeId: 'fettabscheider' }), type: fett, checks: [check({ date: '2026-10-01' })], today: TODAY })
  assert.equal(d[0].noInterval, true)
  assert.equal(d[0].state, 'faellig')
  // inaktiv: keine Frist
  assert.equal(statusOf({ item: item({ active: false }), type: ext, checks: [], today: TODAY }).state, 'inaktiv')
})

test('Spielplatz: Hauptinspektion jährlich, operative Inspektion monatlich ab der letzten Prüfung jeder Art', () => {
  const sp = typeOf(null, 'spielplatz')
  const it = item({ id: 'sp', typeId: 'spielplatz', operative: true })
  const checks = [check({ itemId: 'sp', date: '2026-03-15' }), check({ itemId: 'sp', kind: 'operativ', date: '2026-10-31', at: '2026-10-31T08:00:00Z' })]
  const s = statusOf({ item: it, type: sp, checks, today: TODAY })
  const [haupt, op] = s.dues
  assert.equal(haupt.kind, 'haupt')
  assert.equal(haupt.last.date, '2026-03-15', 'operative Inspektion zählt nicht für die Hauptinspektion')
  assert.equal(haupt.next, '2027-03-15')
  assert.equal(op.kind, 'operativ')
  assert.equal(op.next, '2026-11-30', '31.10. + 1 Monat = 30.11.')
  assert.equal(op.state, 'ok', 'monatlich: fällig erst 7 Tage vorher')
  assert.equal(s.state, 'ok')
  assert.equal(s.next, '2026-11-30')
  // eine Woche ohne Inspektion später: operativ fällig, dann überfällig
  assert.equal(statusOf({ item: it, type: sp, checks, today: '2026-11-25' }).state, 'faellig')
  assert.equal(statusOf({ item: it, type: sp, checks, today: '2026-12-01' }).state, 'ueberfaellig')
  // eine Hauptinspektion zählt auch als operative
  const after = [...checks, check({ itemId: 'sp', date: '2026-11-28', at: '2026-11-28T08:00:00Z' })]
  const s2 = statusOf({ item: it, type: sp, checks: after, today: '2026-12-01' })
  assert.deepEqual(s2.dues.map((d) => d.next), ['2027-11-28', '2026-12-28'])
  assert.equal(nextAfter(it, sp, '2026-01-31', 'operativ'), '2026-02-28')
})

test('Mängel: offen bis behoben, außer Betrieb zählt, „in Ordnung“ kann offene Mängel schließen', () => {
  const m = check({ id: 'm1', date: '2026-10-01', result: 'maengel', defects: 'Plombe fehlt' })
  const a = check({ id: 'm2', date: '2026-10-02', result: 'ausser', defects: 'Druck zu gering' })
  const ok = check({ id: 'k1', date: '2026-09-01' })
  assert.ok(isDefectOpen(m) && isDefectOpen(a) && !isDefectOpen(ok))
  assert.deepEqual(openDefects([a, ok, m]).map((c) => c.id), ['m1', 'm2'])
  const fixed = resolveDefect(m, { date: '2026-10-05', note: ' Plombe ersetzt ', by: 'Petra', at: 'x' })
  assert.ok(!isDefectOpen(fixed))
  assert.deepEqual(fixed.resolved, { date: '2026-10-05', note: 'Plombe ersetzt', by: 'Petra', at: 'x' })
  assert.equal(m.resolved, undefined, 'Original bleibt')
  // Status zeigt offene Mängel auch, wenn die Frist in Ordnung ist
  const s = statusOf({ item: item(), type: ext, checks: [m], today: TODAY })
  assert.equal(s.state, 'ok')
  assert.equal(s.defects.length, 1)
  // neue Prüfung „in Ordnung“ mit resolveOpen: schließt offene Mängel bis zu diesem Tag
  const r = addCheck([m, a], { itemId: 'a1', date: '2026-11-06', result: 'ok', by: 'Brandschutz GmbH', defects: 'wird ignoriert' }, { newId, at: 'T', user: 'Petra', resolveOpen: true })
  assert.equal(r.resolved, 2)
  assert.equal(r.check.defects, '')
  assert.deepEqual(openDefects(r.checks), [])
  assert.equal(r.checks.find((c) => c.id === 'm1').resolved.date, '2026-11-06')
  // ohne resolveOpen oder mit Mängeln bleibt alles offen; frühere Prüfung schließt spätere Mängel nicht
  assert.equal(addCheck([m], { itemId: 'a1', date: '2026-11-06', result: 'ok', by: 'x' }, { newId }).resolved, 0)
  assert.equal(addCheck([m], { itemId: 'a1', date: '2026-11-06', result: 'maengel', defects: 'neu', by: 'x' }, { newId, resolveOpen: true }).resolved, 0)
  assert.equal(addCheck([m], { itemId: 'a1', date: '2026-09-30', result: 'ok', by: 'x' }, { newId, resolveOpen: true }).resolved, 0)
  assert.equal(addCheck([m], { itemId: 'zz', date: '2026-11-06', result: 'ok', by: 'x' }, { newId, resolveOpen: true }).resolved, 0, 'andere Anlage')
})

test('Prüfung eintragen: Felder, Verlauf neueste zuerst, Preis nur wenn verrechenbar', () => {
  const r = addCheck([], { itemId: 'a1', kind: 'operativ', date: '2026-11-06', result: 'maengel', defects: ' Kette locker ', by: ' Hausbetreuung ', photos: [{ path: 'p.jpg' }], report: { path: 'r.pdf' }, billable: true, price: '35.5' }, { newId, at: 'T', user: 'Petra' })
  assert.equal(r.check.kind, 'operativ')
  assert.equal(r.check.defects, 'Kette locker')
  assert.equal(r.check.by, 'Hausbetreuung')
  assert.equal(r.check.external, false)
  assert.equal(addCheck([], { itemId: 'a1', date: '2026-11-06', result: 'ok', by: 'Lift AG', external: true }, { newId }).check.external, true)
  assert.equal(r.check.price, 35.5)
  assert.equal(r.check.report.path, 'r.pdf')
  assert.equal(r.check.resolved, null)
  assert.equal(addCheck([], { itemId: 'a1', date: '2026-11-06', result: 'ok', by: 'x', price: 20 }, { newId }).check.price, 0)
  const list = [check({ id: 'x1', date: '2026-01-01' }), check({ id: 'x2', date: '2026-05-01' }), check({ id: 'x3', date: '2026-05-01', at: '2026-05-01T12:00:00Z' }), check({ id: 'y', itemId: 'b' })]
  assert.deepEqual(checksOf(list, 'a1').map((c) => c.id), ['x3', 'x2', 'x1'])
})

test('Prüfen vor dem Speichern: Prüfung und Anlage', () => {
  const ok = { itemId: 'a1', date: TODAY, result: 'ok', by: 'Petra' }
  assert.equal(checkProblem(ok, TODAY), '')
  assert.match(checkProblem({ ...ok, itemId: '' }, TODAY), /Anlage/)
  assert.match(checkProblem({ ...ok, date: '' }, TODAY), /Datum/)
  assert.match(checkProblem({ ...ok, date: '2026-11-07' }, TODAY), /Zukunft/)
  assert.match(checkProblem({ ...ok, result: 'x' }, TODAY), /Ergebnis/)
  assert.match(checkProblem({ ...ok, result: 'maengel', defects: ' ' }, TODAY), /Mängel beschreiben/)
  assert.equal(checkProblem({ ...ok, result: 'ausser' }, TODAY), '', 'außer Betrieb ohne Text geht')
  assert.match(checkProblem({ ...ok, by: '' }, TODAY), /wer geprüft/)
  const f = { objectId: 'o1', label: 'Keller', count: 1, by: 'eigen' }
  assert.equal(itemProblem(f, ext), '')
  assert.match(itemProblem({ ...f, objectId: '' }, ext), /Objekt/)
  assert.match(itemProblem(f, null), /Art/)
  assert.match(itemProblem({ ...f, label: ' ' }, ext), /Bezeichnung/)
  assert.match(itemProblem({ ...f, count: 0 }, ext), /Anzahl/)
  assert.match(itemProblem(f, typeOf(null, 'fettabscheider')), /Intervall/)
  assert.equal(itemProblem({ ...f, months: 3 }, typeOf(null, 'fettabscheider')), '')
  assert.match(itemProblem({ ...f, by: 'fremd', company: '' }, ext), /Fremdfirma/)
  assert.match(itemProblem({ ...f, billable: true, price: '' }, ext), /Preis/)
})

// ---------------------------------------------------------------- Übersicht

const objects = [
  { id: 'o1', name: 'Wohnanlage Lehen', region: 'Salzburg Stadt' },
  { id: 'o2', name: 'Autohaus Maxglan', region: 'Salzburg Stadt' },
  { id: 'o3', name: 'Wohnanlage Obertrum', region: 'Flachgau' },
  { id: 'o4', name: 'Alte Halle', region: 'Flachgau', inactive: true },
]
const doc = {
  ...emptyAnlagen(),
  items: [
    item({ id: 'a1', objectId: 'o1' }), // überfällig
    item({ id: 'a2', objectId: 'o1', typeId: 'rauchmelder', label: 'Stiegenhaus', by: 'eigen', company: '' }), // in Ordnung, Mangel offen
    item({ id: 'a3', objectId: 'o2', typeId: 'notbeleuchtung', label: 'Schauraum' }), // fällig
    item({ id: 'a4', objectId: 'o3', typeId: 'spielplatz', label: 'Spielplatz Hof', operative: true }), // ohne Prüfung → fällig
    item({ id: 'a5', objectId: 'o3', typeId: 'lift', label: 'Lift Stiege 1', active: false }), // inaktiv
    item({ id: 'a6', objectId: 'o4', typeId: 'dach', label: 'Dach' }), // Objekt inaktiv, überfällig
  ],
  checks: [
    check({ itemId: 'a1', date: '2024-10-01' }),
    check({ itemId: 'a2', date: '2026-06-01', result: 'maengel', defects: 'Melder Top 4 fehlt' }),
    check({ itemId: 'a3', date: '2025-11-20', billable: true, price: 40 }),
    check({ itemId: 'a6', date: '2024-01-01' }),
    check({ itemId: 'a3', date: '2026-11-03', billable: true, price: 40, result: 'maengel', defects: 'Leuchte 3 defekt' }),
    check({ itemId: 'a1', date: '2026-11-04', billable: true, price: 25, kind: 'haupt', resolved: null, at: '2024-01-01T00:00:00Z' }),
  ],
}
// a1 hat am 4.11. eine Prüfung: für die Übersicht ohne sie rechnen
const docOverdue = { ...doc, checks: doc.checks.filter((c) => !(c.itemId === 'a1' && c.date === '2026-11-04')) }

test('Übersicht: Zustand je Anlage, sortiert nach Objekt, dringend zuerst; Kacheln', () => {
  const rows = anlagenRows({ doc: docOverdue, objects, today: TODAY })
  assert.deepEqual(rows.map((r) => r.item.id), ['a6', 'a3', 'a1', 'a2', 'a4', 'a5'])
  const st = Object.fromEntries(rows.map((r) => [r.item.id, r.state]))
  assert.deepEqual(st, { a1: 'ueberfaellig', a2: 'ok', a3: 'ok', a4: 'faellig', a5: 'inaktiv', a6: 'ueberfaellig' })
  assert.equal(rows.find((r) => r.item.id === 'a3').defects.length, 1)
  assert.deepEqual(counts(rows), { ueberfaellig: 2, faellig: 1, maengel: 2, aktiv: 5 })
})

test('Filter: Objekt, Revier, Art, Status', () => {
  const rows = anlagenRows({ doc: docOverdue, objects, today: TODAY })
  const ids = (f) => filterRows(rows, f).map((r) => r.item.id).sort()
  assert.deepEqual(ids({}), ['a1', 'a2', 'a3', 'a4', 'a6'], 'Standard: alle aktiven')
  assert.deepEqual(ids({ objectId: 'o1' }), ['a1', 'a2'])
  assert.deepEqual(ids({ region: 'Flachgau' }), ['a4', 'a6'])
  assert.deepEqual(ids({ region: 'Flachgau', status: 'inaktiv' }), ['a5'])
  assert.deepEqual(ids({ typeId: 'rauchmelder' }), ['a2'])
  assert.deepEqual(ids({ status: 'ueberfaellig' }), ['a1', 'a6'])
  assert.deepEqual(ids({ status: 'faellig' }), ['a4'])
  assert.deepEqual(ids({ status: 'maengel' }), ['a2', 'a3'])
  assert.deepEqual(ids({ status: 'bedarf' }), ['a1', 'a2', 'a3', 'a4', 'a6'])
  assert.deepEqual(ids({ status: 'ok' }), ['a2', 'a3'])
  assert.deepEqual(ids({ objectId: 'o1', status: 'maengel' }), ['a2'])
  assert.ok(matchStatus({ state: 'inaktiv', defects: [{}] }, 'maengel'), 'Mangel bleibt sichtbar, auch wenn die Anlage inaktiv ist')
})

test('Handlungsbedarf je Objekt: fällig, überfällig, Mängel; inaktive Objekte nicht; dringend zuerst', () => {
  const groups = attention(anlagenRows({ doc: docOverdue, objects, today: TODAY }))
  assert.deepEqual(groups.map((g) => g.objectId), ['o1', 'o2', 'o3'])
  const o1 = groups[0]
  assert.deepEqual([o1.due.map((r) => r.item.id), o1.defects.map((r) => r.item.id)], [['a1'], ['a2']])
  assert.ok(isUrgent(o1))
  assert.ok(!isUrgent(groups[1]), 'nur Mangel, nicht außer Betrieb')
  assert.deepEqual(groups[2].due.map((r) => r.item.id), ['a4'])
  // außer Betrieb ist dringend
  const d2 = { ...docOverdue, checks: [...docOverdue.checks, check({ itemId: 'a3', date: '2026-11-05', result: 'ausser', defects: 'Akku leer' })] }
  assert.ok(isUrgent(attention(anlagenRows({ doc: d2, objects, today: TODAY })).find((g) => g.objectId === 'o2')))
  // nach der Prüfung (4.11.) ist a1 erledigt
  assert.deepEqual(attention(anlagenRows({ doc, objects, today: TODAY })).find((g) => g.objectId === 'o1').due, [])
})

test('Verrechenbare Prüfungen im Monat je Objekt mit Summe', () => {
  const nov = billableChecks({ doc, objects, month: '2026-11' })
  assert.deepEqual(nov.map((g) => [g.object.name, g.rows.length, g.sum]), [['Autohaus Maxglan', 1, 40], ['Wohnanlage Lehen', 1, 25]])
  assert.equal(nov[0].rows[0].type.id, 'notbeleuchtung')
  assert.deepEqual(billableChecks({ doc, objects, month: '2025-11' }).map((g) => g.sum), [40])
  assert.deepEqual(billableChecks({ doc, objects, month: '2026-10' }), [])
  // Preis wie beim Erfassen, auch wenn die Anlage später anders ist
  const d = { ...doc, items: doc.items.map((i) => (i.id === 'a3' ? { ...i, price: 99 } : i)) }
  assert.equal(billableChecks({ doc: d, objects, month: '2026-11' })[0].sum, 40)
})
