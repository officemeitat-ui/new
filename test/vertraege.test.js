// Kundenverträge mit Fristen (core/vertraege.js): Kündigungstermine, spätester Tag, Verlängerung, Stand, Erinnerungen,
// Kündigung, Daueraufträge beenden, Vertragsvolumen und Preisanpassung nach KV-Lohn mit dem Monatslauf (core/invoicing.js).
// Erfundene Beispieldaten.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { finalize, intact, runRecurring } from '../src/core/invoicing.js'
import {
  applyKvRun,
  contractKpi,
  contractProblems,
  contractReminders,
  contractStatus,
  contractVolume,
  earliestEnd,
  endAfter,
  endRecurring,
  fromMonthOf,
  kvChange,
  latestNotice,
  letterValues,
  modelOf,
  nextContractNo,
  nextTermination,
  noticeLabel,
  planKvRun,
  recLinesAt,
  shiftMonths,
  termLabel,
  terminOnOrAfter,
  undoKvRun,
} from '../src/core/vertraege.js'

const M3 = { n: 3, unit: 'monat' }

test('Datum: Monate verschieben mit Monatsletztem, Laufzeitende nach § 902 ABGB, Schaltjahr', () => {
  assert.equal(shiftMonths('2026-03-31', -1), '2026-02-28')
  assert.equal(shiftMonths('2027-02-28', 12), '2028-02-29', 'Monatsletzter bleibt Monatsletzter')
  assert.equal(shiftMonths('2026-01-30', 1), '2026-02-28')
  assert.equal(shiftMonths('2026-05-15', -3), '2026-02-15')
  assert.equal(endAfter('2026-01-01', 12), '2026-12-31')
  assert.equal(endAfter('2026-03-15', 12), '2027-03-14')
  assert.equal(endAfter('2023-03-01', 12), '2024-02-29', 'Laufzeit 1.3.2023–29.2.2024')
  assert.equal(endAfter('2024-02-29', 12), '2025-02-28')
  assert.equal(endAfter('2026-02-01', 1), '2026-02-28')
  assert.equal(endAfter('2026-05-01', 1), '2026-05-31')
})

test('Spätester Tag: Monats-, Quartals-, Jahresende, Vertragsjahr, Wochen und Tage', () => {
  assert.equal(latestNotice('2026-12-31', M3), '2026-09-30')
  assert.equal(latestNotice('2027-03-31', M3), '2026-12-31')
  assert.equal(latestNotice('2027-06-30', M3), '2027-03-31')
  assert.equal(latestNotice('2027-02-28', M3), '2026-11-30')
  assert.equal(latestNotice('2028-02-29', { n: 1, unit: 'monat' }), '2028-01-31', 'Schaltjahr')
  assert.equal(latestNotice('2027-03-14', M3), '2026-12-14', 'Vertragsjahr ohne Monatsletzten')
  assert.equal(latestNotice('2026-12-31', { n: 6, unit: 'woche' }), '2026-11-19')
  assert.equal(latestNotice('2026-12-31', { n: 14, unit: 'tag' }), '2026-12-17')
  assert.equal(latestNotice('2026-12-31', { n: 0, unit: 'monat' }), '2026-12-31')
  assert.equal(terminOnOrAfter('2026-11-09', 'monat'), '2026-11-30')
  assert.equal(terminOnOrAfter('2026-11-09', 'quartal'), '2026-12-31')
  assert.equal(terminOnOrAfter('2027-01-01', 'quartal'), '2027-03-31')
  assert.equal(terminOnOrAfter('2026-11-09', 'jahr'), '2026-12-31')
  assert.equal(terminOnOrAfter('2026-11-09', 'vertragsjahr', '2024-03-15'), '2027-03-14')
  assert.equal(terminOnOrAfter('2027-03-14', 'vertragsjahr', '2024-03-15'), '2027-03-14')
  assert.equal(terminOnOrAfter('2027-03-15', 'vertragsjahr', '2024-03-15'), '2028-03-14')
  assert.equal(terminOnOrAfter('2025-01-10', 'vertragsjahr', '2024-02-29'), '2025-02-28', 'Vertragsjahr ab 29.2.')
})

test('Unbefristet: frühestens zum Ende der Mindestlaufzeit, danach jeder Termin', () => {
  const c = { start: '2026-01-01', minMonths: 12, notice: M3, term: 'quartal' }
  assert.equal(modelOf(c).kind, 'unbefristet')
  assert.deepEqual([nextTermination(c, '2026-03-01').termin, nextTermination(c, '2026-03-01').latest], ['2026-12-31', '2026-09-30'])
  assert.deepEqual([nextTermination(c, '2026-09-30').termin, nextTermination(c, '2026-10-01').termin], ['2026-12-31', '2027-03-31'])
  assert.equal(nextTermination(c, '2026-11-09').latest, '2026-12-31')
  const monat = { start: '2025-06-15', notice: { n: 1, unit: 'monat' }, term: 'monat' }
  assert.deepEqual([nextTermination(monat, '2026-11-09').termin, nextTermination(monat, '2026-11-09').latest], ['2026-12-31', '2026-11-30'])
  const jahr = { start: '2020-01-01', notice: M3, term: 'jahr' }
  assert.equal(nextTermination(jahr, '2026-11-09').termin, '2027-12-31', 'rückwirkend eingegeben, 30.9. vorbei')
  const vj = { start: '2024-03-15', minMonths: 24, notice: M3, term: 'vertragsjahr' }
  assert.deepEqual([nextTermination(vj, '2025-12-01').termin, nextTermination(vj, '2025-12-01').latest], ['2026-03-14', '2025-12-14'])
  assert.equal(nextTermination(vj, '2025-12-15').termin, '2027-03-14')
  assert.equal(noticeLabel(c), '3 Monate zum Quartalsende')
  assert.equal(termLabel(c), '1.1.2026 – unbefristet, mind. 12 Monate')
})

test('Verlängerung: Laufzeit und automatische Verlängerung, rückwirkend über Jahre', () => {
  const c = { start: '2025-01-01', end: '2025-12-31', renewMonths: 12, notice: M3 }
  assert.equal(modelOf(c).kind, 'verlaengerung')
  const a = nextTermination(c, '2025-09-30')
  assert.deepEqual([a.termin, a.latest, a.renewal], ['2025-12-31', '2025-09-30', '2026-01-01'])
  const b = nextTermination(c, '2026-11-09')
  assert.deepEqual([b.termin, b.latest, b.renewal], ['2027-12-31', '2027-09-30', '2028-01-01'])
  // ohne Ende: erste Laufzeit = Mindestlaufzeit
  const d = { start: '2016-04-01', minMonths: 24, renewMonths: 12, notice: { n: 2, unit: 'monat' } }
  assert.equal(modelOf(d).firstEnd, '2018-03-31')
  assert.deepEqual([nextTermination(d, '2026-11-09').termin, nextTermination(d, '2026-11-09').latest], ['2027-03-31', '2027-01-31'])
  assert.equal(nextTermination(d, '2027-02-01').termin, '2028-03-31')
  // Laufzeit über den 29. Februar
  const e = { start: '2023-03-01', minMonths: 12, renewMonths: 12, notice: { n: 1, unit: 'monat' } }
  assert.deepEqual([nextTermination(e, '2024-01-15').termin, nextTermination(e, '2024-01-15').latest], ['2024-02-29', '2024-01-31'])
  assert.equal(nextTermination(e, '2024-02-01').termin, '2025-02-28')
  assert.equal(noticeLabel(c), '3 Monate zum Ende der Laufzeit')
})

test('Stand: läuft, kündbar bis, gekündigt zum, beendet, befristet, beginnt', () => {
  const c = { start: '2026-01-01', minMonths: 12, notice: M3, term: 'quartal' }
  assert.equal(contractStatus(c, '2026-03-01').status, 'laeuft')
  const k = contractStatus(c, '2026-08-01')
  assert.deepEqual([k.status, k.label, k.termin], ['kuendbar', 'kündbar bis 30.9.2026', '2026-12-31'])
  const g = { ...c, cancel: { at: '2026-09-10', by: 'kunde', to: '2026-12-31' } }
  assert.deepEqual([contractStatus(g, '2026-11-09').status, contractStatus(g, '2026-11-09').label], ['gekuendigt', 'gekündigt zum 31.12.2026'])
  assert.deepEqual([contractStatus(g, '2027-01-01').status, contractStatus(g, '2027-01-01').label], ['beendet', 'beendet am 31.12.2026'])
  const f = { start: '2026-01-01', end: '2026-12-31' }
  assert.deepEqual([contractStatus(f, '2026-06-01').status, contractStatus(f, '2026-06-01').label], ['laeuft', 'befristet bis 31.12.2026'])
  assert.equal(contractStatus(f, '2027-01-01').status, 'beendet')
  assert.equal(contractStatus({ start: '2027-02-01', notice: M3, term: 'monat', minMonths: 12 }, '2026-11-09').label, 'beginnt am 1.2.2027')
})

test('Kündigung: frühester Termin, Prüfung (fristgerecht, Datum), Vertragsnummer', () => {
  const c = { customerId: 'k1', start: '2026-01-01', minMonths: 12, notice: M3, term: 'quartal' }
  assert.equal(earliestEnd(c, '2026-09-30'), '2026-12-31')
  assert.equal(earliestEnd(c, '2026-10-02'), '2027-03-31')
  assert.deepEqual(contractProblems(c), [])
  const late = contractProblems({ ...c, cancel: { at: '2026-10-02', by: 'kunde', to: '2026-12-31' } })
  assert.equal(late.length, 1)
  assert.equal(late[0].level, 'warn')
  assert.match(late[0].text, /frühestens zum 31\.3\.2027/)
  assert.deepEqual(contractProblems({ ...c, cancel: { at: '2026-10-02', by: 'wir', to: '' } }).map((p) => p.field), ['cancel-to'])
  assert.deepEqual(contractProblems({ start: '2026-02-01', end: '2026-01-01', minMonths: 'x' }).map((p) => p.field).sort(), ['customer', 'end', 'min'])
  assert.equal(nextContractNo([{ no: 'V-2026-004' }, { no: 'V-2025-010' }], 2026), 'V-2026-005')
  // befristet ohne Verlängerung endet von selbst
  assert.equal(earliestEnd({ start: '2026-01-01', end: '2026-06-30' }, '2026-05-20'), '2026-06-30')
})

const rec = (extra = {}) => ({ id: 'r1', customerId: 'k1', contractId: 'v1', title: 'Unterhaltsreinigung Musterhaus', interval: 'monat', startMonth: '2026-01', endMonth: '', active: true, lines: [{ id: 'l1', text: 'Unterhaltsreinigung lt. Vertrag', qty: 1, unit: 'Monat', price: 1000, vat: 20 }], ...extra })

test('Erinnerungen: Verlängerung mit Vorlauf, Mindestlaufzeit, befristet, gekündigt mit Dauerauftrag', () => {
  const v = { id: 'v1', customerId: 'k1', title: 'Reinigung Musterhaus', start: '2025-01-01', end: '2025-12-31', renewMonths: 12, notice: M3 }
  const doc = { contracts: [v], recurring: [rec()] }
  assert.deepEqual(contractReminders(doc, '2026-08-30'), [], '31 Tage vorher: noch nicht')
  const r = contractReminders(doc, '2026-08-31')
  assert.equal(r.length, 1)
  assert.equal(r[0].text, 'Vertrag Reinigung Musterhaus verlängert sich am 1.1.2027, kündbar bis 30.9.2026')
  assert.equal(contractReminders(doc, '2026-09-30').length, 1)
  assert.deepEqual(contractReminders(doc, '2026-10-01'), [], 'nach dem letzten Tag: verlängert')
  assert.equal(contractReminders(doc, '2026-09-20', { remindDays: 5 }).length, 0, 'Vorlauf aus den Einstellungen')
  assert.equal(contractReminders({ ...doc, contracts: [{ ...v, remindDays: 60 }] }, '2026-08-01').length, 1, 'Vorlauf je Vertrag')
  // unbefristet: nur vor dem ersten Termin nach der Mindestlaufzeit
  const u = { id: 'v2', customerId: 'k1', title: 'Büro', start: '2026-01-01', minMonths: 12, notice: M3, term: 'quartal' }
  assert.match(contractReminders({ contracts: [u] }, '2026-09-15')[0].text, /Mindestlaufzeit endet am 31\.12\.2026, kündbar bis 30\.9\.2026/)
  assert.deepEqual(contractReminders({ contracts: [u] }, '2026-12-15'), [])
  // befristet ohne Verlängerung
  assert.match(contractReminders({ contracts: [{ id: 'v3', title: 'Baustelle', start: '2026-01-01', end: '2026-12-31' }] }, '2026-12-10')[0].text, /endet am 31\.12\.2026/)
  // gekündigt: sofort, solange der Dauerauftrag weiterläuft; sonst ab Vorlauf vor dem Ende, bis erledigt
  const g = { ...v, cancel: { at: '2026-09-01', by: 'kunde', to: '2026-12-31' } }
  const now = contractReminders({ contracts: [g], recurring: [rec()] }, '2026-09-02')
  assert.equal(now[0].text, 'Gekündigt zum 31.12.2026: Dauerauftrag endet, Objekt freigeben?')
  assert.match(now[0].detail, /läuft noch/)
  const ended = endRecurring([rec()], 'v1', '2026-12-31')
  assert.deepEqual([ended.changed, ended.recurring[0].endMonth, ended.partial], [['r1'], '2026-12', false])
  assert.deepEqual(contractReminders({ contracts: [g], recurring: ended.recurring }, '2026-09-02'), [])
  assert.match(contractReminders({ contracts: [g], recurring: ended.recurring }, '2026-12-05')[0].detail, /endet mit Dezember 2026/)
  assert.deepEqual(contractReminders({ contracts: [{ ...g, cancel: { ...g.cancel, doneAt: '2026-12-06' } }], recurring: ended.recurring }, '2026-12-07'), [])
  assert.equal(endRecurring([rec()], 'v1', '2027-05-14').partial, true)
})

test('Vertragsvolumen und Kennzahlen: Monatswert, Quartal ÷ 3, Kündigungen, auslaufend', () => {
  const v1 = { id: 'v1', customerId: 'k1', start: '2026-01-01', notice: M3, term: 'monat', cancel: { at: '2026-10-10', by: 'kunde', to: '2026-12-31' } }
  const v2 = { id: 'v2', customerId: 'k2', start: '2026-03-01', volume: '450' }
  const doc = { contracts: [v1, v2], recurring: [rec(), rec({ id: 'r2', interval: 'quartal', lines: [{ id: 'g', text: 'Glas', qty: 1, price: 300, vat: 20 }] })] }
  assert.equal(contractVolume(doc, v1, '2026-11'), 1100)
  assert.equal(contractVolume(doc, v1, '2027-01'), 0)
  assert.equal(contractVolume(doc, v2, '2026-02'), 0)
  assert.equal(contractVolume(doc, v2, '2026-03'), 450)
  const k = contractKpi(doc, [{ key: '2026-09' }, { key: '2026-10' }, { key: '2026-11' }], '2026-11-09')
  assert.deepEqual(k.months.map((m) => [m.volume, m.active, m.cancelled, m.byCustomer]), [[1550, 2, 0, 0], [1550, 2, 1, 1], [1550, 2, 0, 0]])
  assert.deepEqual(k.ending.map((x) => x.end), ['2026-12-31'])
  assert.equal(contractKpi({ contracts: [] }, [], '2026-11-09'), null)
})

// ---------------------------------------------------------------- Preisanpassung nach KV-Lohn

const settings = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: 'AT611904300234573201' } }
const customer = { id: 'k1', name: 'Hausverwaltung Muster', address: 'Platz 2\n5020 Salzburg', uid: 'ATU87654321' }
let n = 0
const newId = () => `x${++n}`

function billed(doc, ym, { draft = false } = {}) {
  const r = runRecurring(doc, ym, { today: `${ym}-02`, newId, by: 'Büro', customersById: new Map([['k1', customer]]) })
  const documents = draft ? r.documents : r.documents.map((d) => (r.created.some((x) => x.id === d.id) ? finalize(d, r.documents, settings, { now: `${ym}-02T09:00:00Z`, by: 'Büro' }) : d))
  return { ...doc, documents, recurring: r.recurring, last: r }
}

test('KV-Lohn: Vorschau, Preise ab „gültig ab“, festgeschriebene Rechnungen unverändert, Doppelanpassung gesperrt', () => {
  assert.equal(kvChange(4.5, 80), 3.6)
  assert.equal(kvChange('4,2', 75), 3.15)
  assert.equal(fromMonthOf('2027-01-01'), '2027-01')
  assert.equal(fromMonthOf('2027-01-15'), '2027-02')
  const v = { id: 'v1', customerId: 'k1', title: 'Reinigung Musterhaus', no: 'V-2026-001', start: '2026-01-01', notice: M3, term: 'quartal', clause: 'kv', kvShare: 80 }
  const vpiOnly = { id: 'v2', customerId: 'k2', title: 'Büro', start: '2026-01-01', clause: 'vpi' }
  let doc = { settings, contracts: [v, vpiOnly], recurring: [rec()], documents: [], indexValues: {} }
  doc = billed(doc, '2026-12')
  doc = billed(doc, '2027-01') // Jänner schon vorab festgeschrieben
  const before = doc.documents.map((d) => JSON.stringify(d))
  const plan = planKvRun(doc, { percent: '4,5', from: '2027-01-01', today: '2026-12-20', settings })
  assert.equal(plan.rows.length, 1)
  assert.deepEqual(plan.skipped.map((s) => s.contract.id), ['v2'])
  const x = plan.rows[0].recs[0]
  assert.deepEqual([x.oldNet, x.newNet, x.effective, x.blocked], [1000, 1036, '2027-02', ''])
  assert.match(x.hints[0], /schon festgeschrieben: Jänner 2027/)
  const r = applyKvRun(doc, plan, ['v1'], { runId: 'run1', at: '2026-12-20T10:00:00Z', by: 'Büro', newId })
  assert.equal(r.count, 1)
  assert.equal(r.recurring[0].steps[0].fromMonth, '2027-01')
  assert.equal(r.recurring[0].lines[0].price, 1000, 'Dauerauftrag erst mit dem Monatslauf')
  assert.match(r.contracts[0].history[0].text, /\+3,6 % ab Jänner 2027/)
  doc = { ...doc, recurring: r.recurring, contracts: r.contracts, priceRuns: [r.run] }
  assert.equal(recLinesAt(doc.recurring[0], '2027-03')[0].price, 1036)
  assert.equal(contractVolume(doc, v, '2027-03'), 1036)
  doc = billed(doc, '2027-02')
  const feb = doc.last.created[0]
  assert.equal(feb.lines[0].price, 1036)
  assert.match(feb.outro, /Lohnkostenklausel: KV-Erhöhung 4,5 % × Lohnanteil 80 % = \+3,6 % ab Jänner 2027/)
  assert.equal(doc.recurring[0].steps[0].applied, '2027-02')
  assert.deepEqual(doc.recurring[0].history.map((h) => h.kind), ['kv'])
  // alte Rechnungen: unverändert und intakt
  assert.deepEqual(doc.documents.slice(0, 2).map((d) => JSON.stringify(d)), before)
  assert.ok(doc.documents.every((d) => intact(d)))
  // zweiter Lauf im selben Zeitraum: gesperrt
  const again = planKvRun(doc, { percent: 2, from: '2027-07-01', today: '2027-06-01', settings })
  assert.match(again.rows[0].recs[0].blocked, /schon nach KV angepasst ab Februar 2027/)
  assert.equal(planKvRun(doc, { percent: 2, from: '2028-02-01', today: '2028-01-10', settings }).rows[0].recs[0].blocked, '')
  // Musterschreiben: Werte je Kunde
  const vals = letterValues(r.run, doc.contracts)
  assert.deepEqual(Object.keys(vals), ['k1'])
  assert.equal(vals.k1['Gültig ab'], '1.1.2027')
  assert.equal(vals.k1['Erhöhung'], '+3,6 %')
  assert.match(vals.k1.Preise, /Unterhaltsreinigung Musterhaus: bisher €\s1\.000,00, neu €\s1\.036,00 je Monat/)
})

test('KV-Lohn und VPI: keine Doppelanpassung, neue Basis, Entwurf mit altem Preis, Rücknahme', () => {
  const v = { id: 'v1', customerId: 'k1', title: 'Reinigung', start: '2026-01-01', clause: 'beides', kvShare: 100 }
  const withIndex = rec({ index: { active: true, baseValue: 100, baseMonth: '2026-01', threshold: 3 } })
  let doc = { settings, contracts: [v], recurring: [withIndex], documents: [], indexValues: { '2026-01': 100, '2026-05': 104 } }
  doc = billed(doc, '2026-06')
  assert.equal(doc.last.created[0].lines[0].price, 1040, 'VPI +4 % im Juni')
  assert.deepEqual(doc.recurring[0].history.map((h) => [h.kind, h.ym]), [['vpi', '2026-06']])
  const blocked = planKvRun(doc, { percent: 3, from: '2027-01-01', today: '2026-12-01', settings })
  assert.match(blocked.rows[0].recs[0].blocked, /Wertsicherung nach VPI im Juni 2026/)
  // ein Jahr später: erlaubt; Hinweis zur VPI und neue Basis beim Übernehmen
  doc = { ...doc, indexValues: { ...doc.indexValues, '2027-05': 108 } }
  const plan = planKvRun(doc, { percent: 3, from: '2027-07-01', today: '2027-06-10', settings })
  const x = plan.rows[0].recs[0]
  assert.equal(x.blocked, '')
  assert.ok(x.hints.some((h) => /VPI-Anpassung entfällt bis Juni 2028; neue Basis 108/.test(h)), x.hints.join(' | '))
  const r = applyKvRun(doc, plan, ['v1'], { runId: 'run2', at: '2027-06-10T08:00:00Z', by: 'Büro', newId })
  doc = { ...doc, recurring: r.recurring }
  doc = billed(doc, '2027-07')
  assert.equal(doc.last.created[0].lines[0].price, 1071.2, '1040 × 1,03, keine VPI dazu')
  assert.equal(doc.recurring[0].index.baseValue, 108)
  doc = { ...doc, indexValues: { ...doc.indexValues, '2027-11': 115 } }
  doc = billed(doc, '2027-12')
  assert.equal(doc.last.created[0].lines[0].price, 1071.2, 'VPI gesperrt bis 12 Monate nach der Anpassung')
  doc = billed(doc, '2028-07')
  assert.equal(doc.last.created[0].lines[0].price, 1140.63, 'danach VPI gegen die neue Basis 108 (+6,48 %)')
  // Entwurf mit altem Preis und Rücknahme eines Laufs
  let d2 = { settings, contracts: [{ ...v, clause: 'kv' }], recurring: [rec()], documents: [], indexValues: {} }
  d2 = billed(d2, '2027-01', { draft: true })
  const p2 = planKvRun(d2, { percent: 2, from: '2027-01-01', today: '2026-12-28', settings })
  assert.equal(p2.rows[0].recs[0].effective, '2027-02')
  assert.match(p2.rows[0].recs[0].hints.join(' '), /Entwurf mit altem Preis: Jänner 2027/)
  const a2 = applyKvRun(d2, p2, ['v1'], { runId: 'run3', at: '2026-12-28T08:00:00Z', newId })
  const u = undoKvRun({ recurring: a2.recurring }, 'run3')
  assert.deepEqual([u.removed, u.kept, u.recurring[0].steps.length], [1, 0, 0])
})

test('KV-Lohn: nicht betroffen – gekündigt vorher, ohne Dauerauftrag, ohne Klausel', () => {
  const doc = {
    contracts: [
      { id: 'a', customerId: 'k1', start: '2026-01-01', clause: 'kv', cancel: { at: '2026-09-01', to: '2026-12-31' } },
      { id: 'b', customerId: 'k2', start: '2026-01-01', clause: 'kv' },
      { id: 'c', customerId: 'k3', start: '2026-01-01', clause: 'keine' },
    ],
    recurring: [rec({ contractId: 'a' })],
  }
  const p = planKvRun(doc, { percent: 4, from: '2027-01-01', today: '2026-12-01' })
  assert.deepEqual(p.rows, [])
  assert.deepEqual(p.skipped.map((s) => [s.contract.id, s.reason]), [['a', 'endet am 31.12.2026, vor der Anpassung'], ['b', 'ohne Dauerauftrag: Preis von Hand anpassen']])
  assert.deepEqual(planKvRun(doc, { percent: 0, from: '2027-01-01' }).rows, [])
})
