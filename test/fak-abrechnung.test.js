// Fakturierung: Winterdienst abrechnen (Protokoll → Positionen je Einsatz oder Pauschale, doppelte Abrechnung,
// Saisonpauschale) und Leistungsnachweis nach Ist-Zeiten (Rundung, fehlendes „Gehen“, Planzeit nur auf Wunsch),
// Einsatzliste als Beilage (core/fak-abrechnung.js, export/abrechnung-pdf.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeBilling,
  billedBySource,
  cleanWinterPrices,
  dayList,
  freezeIst,
  freezeWinter,
  frozenLog,
  istFor,
  istRowsFor,
  linesFromIst,
  priceInput,
  roundMinutes,
  roundStep,
  seasonBilled,
  seasonPeriodText,
  seasonSettings,
  seasonText,
  winterBill,
  winterEntries,
  winterKey,
  winterKind,
  winterObjectIds,
  winterPriceInputs,
  winterPrices,
  winterPricesEmpty,
  winterRecurring,
  winterSeason,
} from '../src/core/fak-abrechnung.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { checksumOf, finalize, linesFromProof, totals } from '../src/core/invoicing.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { proofFor } from '../src/core/proof.js'
import { createContext } from '../src/core/rules.js'
import { istListDocument, istListPdfName } from '../src/export/abrechnung-pdf.js'
import { winterLogDocument } from '../src/export/winter-pdf.js'

let n = 0
const newId = () => `l${++n}`
const entry = (id, date, time, over = {}) => ({ id, date, objectId: 'o5', object: 'Wohnanlage Lehen', person: 'Elif Kaya', at: new Date(`${date}T${time}:00+01:00`).toISOString(), geraeumt: true, gestreut: true, fotos: [], ...over })
const LOG = Object.fromEntries(
  [
    entry('a1', '2026-12-02', '05:40'),
    entry('a2', '2026-12-03', '05:30', { geraeumt: false }),
    entry('a3', '2026-12-03', '16:10', { geraeumt: false }),
    entry('a4', '2026-12-09', '05:20', { gestreut: false }),
    entry('a5', '2026-12-10', '05:50', { geraeumt: false, gestreut: false, kontrolle: true }),
    entry('a6', '2026-12-11', '05:45', { test: true }),
    entry('b1', '2026-12-02', '06:10', { objectId: 'o2', object: 'Autohaus' }),
    entry('c1', '2026-11-28', '06:00'),
  ].map((e) => [`${e.date}|${e.objectId}|${e.id}`, e]),
)
const objectsById = new Map([['o5', { id: 'o5', name: 'Wohnanlage Lehen', address: 'Lehen 1' }]])

test('Winterdienst: Art je Eintrag, Saison, Objekte und Einträge des Monats (ohne Testalarm)', () => {
  assert.equal(winterKind({ geraeumt: true, gestreut: true }), 'beides')
  assert.equal(winterKind({ geraeumt: true }), 'raeumen')
  assert.equal(winterKind({ gestreut: true }), 'streuen')
  assert.equal(winterKind({ kontrolle: true }), 'kontrolle')
  assert.deepEqual(winterSeason('2026-12'), { key: '2026/27', label: 'Winter 2026/27', from: '2026-07-01', to: '2027-06-30' })
  assert.deepEqual(winterSeason('2027-02'), { key: '2026/27', label: 'Winter 2026/27', from: '2026-07-01', to: '2027-06-30' })
  assert.equal(winterSeason('2027-07').key, '2027/28')
  assert.equal(winterKey('o5', '2026-12'), 'winterdienst:o5:2026-12')
  assert.deepEqual([...winterObjectIds(LOG, '2026-12')].sort(), ['o2', 'o5'])
  const list = winterEntries(LOG, { objectId: 'o5', month: '2026-12', objectsById })
  assert.deepEqual(list.map((e) => [e.id, e.kind]), [['a1', 'beides'], ['a2', 'streuen'], ['a3', 'streuen'], ['a4', 'raeumen'], ['a5', 'kontrolle']], 'nach Tag und Uhrzeit, Testalarm und November nicht')
  assert.equal(dayList(list.filter((e) => e.kind === 'streuen')), '03.12. (2×)')
})

test('Winterdienst: Preise beim Kunden je Objekt, sonst aus den Artikeln „Winterdienst …“', () => {
  const articles = [
    { name: 'Winterdienst Pauschale', unit: 'Monat', price: 120 },
    { name: 'Winterdienst Räumen und Streuen', price: '65,50' },
    { name: 'Winterdienst Streuen', price: 30, active: false },
  ]
  const fromArticles = winterPrices(null, 'o5', articles)
  assert.deepEqual(fromArticles, { beides: 65.5, raeumen: '', streuen: '', kontrolle: '', pauschale: 120, mode: 'einsatz', own: false }, 'inaktive Artikel zählen nicht')
  const cu = { winterPrices: { o5: { mode: 'monat', pauschale: '150', beides: 70 } } }
  assert.deepEqual(winterPrices(cu, 'o5', articles), { beides: 70, raeumen: '', streuen: '', kontrolle: '', pauschale: 150, mode: 'monat', own: true })
  assert.equal(winterPrices(cu, 'o9', articles).own, false, 'anderes Objekt des Kunden')
  assert.deepEqual(cleanWinterPrices({ mode: 'x', beides: '45,5', edited: true }), { mode: 'einsatz', beides: 45.5, raeumen: '', streuen: '', kontrolle: '', pauschale: '' })
})

test('Winterdienst je Einsatz: eine Position je Art mit Menge, Tagen und Preis; Kontrollgänge ohne Preis als Text', () => {
  const entries = winterEntries(LOG, { objectId: 'o5', month: '2026-12', objectsById })
  const r = winterBill({ entries, prices: { mode: 'einsatz', beides: 65, raeumen: 40, streuen: 30 }, objectName: 'Wohnanlage Lehen', month: '2026-12', vat: 20, newId })
  const items = r.lines.filter((l) => !l.type)
  assert.deepEqual(items.map((l) => [l.text, l.qty, l.unit, l.price]), [
    ['Winterdienst Räumen und Streuen – Wohnanlage Lehen', 1, 'Einsatz', 65],
    ['Winterdienst Räumen – Wohnanlage Lehen', 1, 'Einsatz', 40],
    ['Winterdienst Streuen – Wohnanlage Lehen', 2, 'Einsatz', 30],
  ])
  assert.equal(items[2].longText, 'Dezember 2026 am 03.12. (2×)')
  assert.match(r.lines.find((l) => l.type === 'text').text, /^Kontrollgänge ohne Räumen und Streuen: 1 am 10\.12\. \(nicht verrechnet\)$/)
  assert.equal(r.net, 165)
  assert.deepEqual(r.missing, [])
  assert.equal(totals({ lines: r.lines }, {}).net, 165, 'Text zählt nicht zur Summe')
  // Kontrollgang mit Preis, Streuen ohne Preis
  const r2 = winterBill({ entries, prices: { mode: 'einsatz', beides: 65, raeumen: 40, kontrolle: 15 }, objectName: 'X', month: '2026-12', newId })
  assert.deepEqual(r2.missing, ['streuen'])
  assert.deepEqual(r2.lines.map((l) => [l.qty, l.price]), [[1, 65], [1, 40], [2, 0], [1, 15]])
})

test('Winterdienst als Pauschale: 1 × Monat bzw. Saison, die Einsätze als Text; Saisonpauschale nur einmal', () => {
  const entries = winterEntries(LOG, { objectId: 'o5', month: '2026-12', objectsById })
  const m = winterBill({ entries, prices: { mode: 'monat', pauschale: 120 }, objectName: 'Wohnanlage Lehen', month: '2026-12', newId })
  assert.deepEqual(m.lines.filter((l) => !l.type).map((l) => [l.text, l.qty, l.unit, l.price]), [['Winterdienst Pauschale Wohnanlage Lehen Dezember 2026', 1, 'Monat', 120]])
  assert.equal(m.lines[1].type, 'text')
  assert.equal(m.lines[1].text, 'Einsätze lt. Winterdienst-Protokoll Dezember 2026: 5 (1 × Räumen und Streuen, 1 × Räumen, 2 × Streuen, 1 × Kontrolle) am 02.12., 03.12. (2×), 09.12., 10.12.')
  assert.equal(m.net, 120)
  const s = winterBill({ entries, prices: { mode: 'saison', pauschale: 900 }, objectName: 'Wohnanlage Lehen', month: '2026-12', newId })
  assert.deepEqual(s.lines.filter((l) => !l.type).map((l) => [l.text, l.unit, l.price]), [['Winterdienst Saisonpauschale Wohnanlage Lehen Winter 2026/27', 'Saison', 900]])
  assert.equal(s.lines[0].longText, 'Leistungszeitraum 1.7.2026–30.6.2027', 'Vorgabe Juli bis Juni')
  assert.deepEqual(s.period, { from: '2026-07-01', to: '2027-06-30' })
  assert.equal(m.period, null, 'Pauschale je Monat: Leistungszeitraum ist der Monat')
  const later = winterBill({ entries, prices: { mode: 'saison', pauschale: 900 }, objectName: 'Wohnanlage Lehen', month: '2027-01', newId, seasonDoc: { id: 'x' } })
  assert.deepEqual(later.lines, [], 'schon verrechnet: nichts mehr')
  assert.deepEqual(winterBill({ entries, prices: { mode: 'monat' }, month: '2026-12', newId }).missing, ['pauschale'])
  assert.deepEqual(winterBill({ entries: [], prices: { mode: 'einsatz', beides: 1 }, month: '2026-12', newId }).lines, [])
})

test('Winterdienst: schon abgerechnet (Entwurf, Rechnung, storniert), Saisonpauschale, Dauerauftrag', () => {
  const key = winterKey('o5', '2026-12')
  const docs = [
    { id: 'd1', kind: 'rechnung', source: { type: 'winterdienst', key } },
    { id: 'd2', kind: 'rechnung', number: 'RE-2026-0010', source: { type: 'winterdienst', key } },
    { id: 'd3', kind: 'rechnung', number: 'RE-2026-0011', source: { type: 'winterdienst', key } },
    { id: 's3', kind: 'storno', number: 'ST-2026-0001', refId: 'd3' },
    { id: 'd4', kind: 'rechnung', number: 'RE-2026-0012', source: { type: 'winterdienst', key: winterKey('o5', '2026-11'), objectId: 'o5', mode: 'saison', season: '2026/27' } },
  ]
  const list = billedBySource(docs, key)
  assert.deepEqual(list.map((b) => [b.doc.id, b.state]), [['d1', 'entwurf'], ['d2', 'fest'], ['d3', 'storniert']])
  assert.deepEqual(activeBilling(list).map((b) => b.doc.id), ['d1', 'd2'])
  assert.equal(seasonBilled(docs, 'o5', '2027-02')?.id, 'd4')
  assert.equal(seasonBilled(docs, 'o5', '2027-08'), null, 'neue Saison')
  assert.equal(seasonBilled([...docs, { id: 's4', kind: 'storno', number: 'ST-2026-0002', refId: 'd4' }], 'o5', '2027-02'), null, 'storniert')
  assert.equal(winterRecurring([{ id: 'r1', objectId: 'o5', title: 'Unterhaltsreinigung', lines: [{ text: 'Winterdienst Pauschale' }] }], 'o5')?.id, 'r1')
  assert.equal(winterRecurring([{ id: 'r1', objectId: 'o5', title: 'Winterdienst', active: false }], 'o5'), null)
})

test('Quelle der Abrechnung zählt nicht zur Prüfsumme (Hilfsangabe wie beim Leistungsnachweis)', () => {
  const settings = { sender: { name: 'Firma', address: 'Weg 1', uid: 'ATU12345678' } }
  const draft = { id: 'f1', kind: 'rechnung', date: '2027-01-05', serviceFrom: '2026-12-01', serviceTo: '2026-12-31', recipient: { name: 'HV', address: 'Ring 3' }, lines: [{ id: 'l1', text: 'Winterdienst', qty: 2, unit: 'Einsatz', price: 65, vat: 20 }], source: { type: 'winterdienst', key: winterKey('o5', '2026-12'), objectId: 'o5', month: '2026-12', entries: ['a'] } }
  const fixed = finalize(draft, [], settings, { now: '2027-01-05T08:00:00.000Z' })
  assert.deepEqual(fixed.source, draft.source, 'bleibt am Beleg')
  assert.equal(checksumOf({ ...fixed, source: { type: 'anders' } }), fixed.checksum)
})

// ---------------------------------------------------------------- Ist-Zeiten

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, name) => ({ id, name, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id === 'g' ? 'Glasreinigung' : 'Unterhaltsreinigung', recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })

function setup() {
  // Dezember 2026: Unterhaltsreinigung Mo und Di 06:00–08:00, Glasreinigung (Sonderleistung) Di 09:00–10:00, entfällt am 8.12.
  const data = { employees: [emp('x', 'Ana Popescu'), emp('y', 'Bogdan Ionescu')], objects: [{ id: 'o1', name: 'Kanzlei' }], tasks: [task('u', [1, 2], '06:00', '08:00'), task('g', [2], '09:00', '10:00', { holidayRule: 'entfaellt', category: 'sonder' })], absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-11-23', '2026-12-31')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-23', '2026-12-31', holidays, ctx.rules)
  const u1 = instances.find((i) => i.key === '2026-12-01|u')
  // Winterdienst am 2.12. (geht über „Winterdienst abrechnen“)
  instances.push({ ...u1, key: '2026-12-02|winter-o1', taskId: 'winter-o1', date: '2026-12-02', origDate: '2026-12-02', start: u1.start + 1440 - 60, end: u1.start + 1440 - 30, label: 'Winterdienst: räumen und streuen', category: 'winter' })
  const asg = {}
  for (const i of instances) if (i.status !== 'cancelled' && i.date >= '2026-12-01' && i.date !== '2026-12-07') asg[i.key] = [{ employeeId: i.taskId === 'g' ? 'y' : 'x' }]
  const state = new PlanState(instances, asg)
  return { ctx, instances, state }
}
const stamp = (id, date, inUtc, outUtc, over = {}) => [`${date}|z${id}`, { id, date, empId: 'x', name: 'Ana Popescu', objectId: 'o1', instKey: '', in: `${date}T${inUtc}:00.000Z`, out: outUtc ? `${date}T${outUtc}:00.000Z` : null, ...over }]
const STAMPS = Object.fromEntries([
  stamp('a', '2026-12-01', '04:58', '07:03', { instKey: '2026-12-01|u' }), // 05:58–08:03 Wiener Zeit = 125 Minuten
  stamp('d', '2026-12-01', '08:00', '09:07', { empId: 'y', name: 'Bogdan Ionescu', instKey: '2026-12-01|g' }), // Sonderleistung, 67 Minuten
  stamp('w', '2026-12-02', '04:00', '04:40'), // Winterdienst
  stamp('c', '2026-12-07', '05:00', '07:08'), // ohne Kennung, niemand eingeteilt: 128 Minuten, nächster Einsatz
  stamp('b', '2026-12-14', '05:01', null), // ohne „Gehen“
  stamp('e', '2026-12-15', '07:00', '05:00'), // Gehen vor Kommen
  stamp('o', '2026-12-15', '05:00', '07:00', { objectId: 'o2' }), // anderes Objekt
])

test('Rundung je Stempelung: auf das nächste Vielfache, ab der Hälfte aufwärts', () => {
  assert.deepEqual([7, 8, 22, 23, 125, 128].map((m) => roundMinutes(m, 15)), [0, 15, 15, 30, 120, 135])
  assert.deepEqual([12, 13, 67].map((m) => roundMinutes(m, 5)), [10, 15, 65])
  assert.equal(roundMinutes(67, 0), 67)
  assert.equal(roundStep('5'), 5)
  assert.equal(roundStep('0'), 0)
  assert.equal(roundStep(undefined), 15, 'Standard 15 Minuten')
  assert.equal(roundStep(10), 15, 'nur 0, 5 oder 15')
})

test('Ist-Zeiten: gezählt, gerundet, ohne „Gehen“ als Problem, Winterdienst und andere Objekte nicht', () => {
  const { ctx, instances, state } = setup()
  const ist = istFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, round: 15, today: '2026-12-15' })
  assert.deepEqual(ist.rows.map((r) => [r.key, r.in, r.out, r.minutes, r.billed, r.label, r.basis]), [
    ['a', '05:58', '08:03', 125, 120, 'Unterhaltsreinigung', 'ist'],
    ['d', '09:00', '10:07', 67, 60, 'Glasreinigung', 'ist'],
    ['c', '06:00', '08:08', 128, 135, 'Unterhaltsreinigung', 'ist'],
  ])
  assert.deepEqual(ist.problems.map((p) => [p.key, p.text]), [['b', 'ohne „Gehen“: nicht gezählt'], ['e', '„Gehen“ nicht nach „Kommen“: nicht gezählt']])
  assert.deepEqual(ist.skipped.map((p) => p.key), ['w'])
  assert.deepEqual(ist.totals, { minutes: 320, billed: 315, ist: 3, plan: 0, problems: 2, skipped: 1 })
  assert.deepEqual(ist.rows.map((r) => r.person), ['', '', ''], 'Namen wie beim Leistungsnachweis: Standard keine')
  const five = istFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, round: 5, names: 'vorname' })
  assert.deepEqual(five.rows.map((r) => [r.billed, r.person]), [[125, 'Ana'], [65, 'Bogdan'], [130, 'Ana']])
  assert.equal(istFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, round: 0 }).totals.billed, 320)
})

test('Ist-Zeiten: Planzeit nur auf Wunsch, für vorbei und besetzte Einsätze ohne vollständige Stempelung', () => {
  const { ctx, instances, state } = setup()
  const base = { objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, round: 15, today: '2026-12-15', names: 'voll' }
  assert.equal(istFor(base).totals.plan, 0, 'nie still mit dem Plan gemischt')
  const ist = istFor({ ...base, planFallback: true })
  const plan = ist.rows.filter((r) => r.basis === 'plan')
  // 8.12. (Feiertag, findet statt), 14.12. (nur Kommen gestempelt), 15.12. Unterhalt und Glas; nicht 7.12. (gestempelt), nicht der Winterdienst, nicht ab 21.12.
  assert.deepEqual(plan.map((r) => [r.date, r.label, r.billed, r.person]), [
    ['2026-12-08', 'Unterhaltsreinigung', 120, 'Ana Popescu'],
    ['2026-12-14', 'Unterhaltsreinigung', 120, 'Ana Popescu'],
    ['2026-12-15', 'Unterhaltsreinigung', 120, 'Ana Popescu'],
    ['2026-12-15', 'Glasreinigung', 60, 'Bogdan Ionescu'],
  ])
  assert.equal(ist.problems.length, 2, 'Probleme bleiben gelistet')
  assert.deepEqual(ist.rows.map((r) => r.date), [...ist.rows.map((r) => r.date)].sort(), 'nach Tag')

  const lines = linesFromIst({ ist, objectName: 'Kanzlei', month: '2026-12', rate: 32.5, vat: 20, newId })
  assert.deepEqual(lines.map((l) => [l.text, l.qty, l.unit, l.price]), [
    ['Unterhaltsreinigung Kanzlei Dezember 2026 lt. Zeiterfassung (5 Einsätze, davon 3 laut Plan)', 10.25, 'Std.', 32.5],
    ['Glasreinigung am 01.12.2026', 1, 'Std.', 32.5],
    ['Glasreinigung am 15.12.2026', 1, 'Std.', 32.5],
    ['Winterdienst (1 Einsatz) wird gesondert verrechnet.', undefined, undefined, undefined],
  ])
  assert.equal(lines.at(-1).type, 'text', 'Hinweis auf den Winterdienst als Textzeile')
  const special = linesFromIst({ ist, objectName: 'Kanzlei', month: '2026-12', rate: 30, newId, special: true })
  assert.deepEqual(special.map((l) => l.text), ['Glasreinigung am 01.12.2026', 'Glasreinigung am 15.12.2026'], 'Dauerauftrag: nur Sonderleistungen')
  assert.equal(istRowsFor(ist, { special: true }).length, 2)
  const only = linesFromIst({ ist: istFor(base), objectName: 'Kanzlei', month: '2026-12', rate: 30, newId })
  assert.equal(only[0].qty, 4.25, '120 + 135 Minuten gerundet')
  assert.equal(only[0].text, 'Unterhaltsreinigung Kanzlei Dezember 2026 lt. Zeiterfassung (2 Einsätze)')
})

test('Einsatzliste als Beilage: Datum, von–bis, Dauer, Leistung; Namen nur wenn eingestellt', () => {
  const { ctx, instances, state } = setup()
  const base = { objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, today: '2026-12-15' }
  const without = istListDocument({ object: { name: 'Kanzlei', address: 'Wien' }, monthLabel: 'Dezember 2026', rows: istFor(base).rows, round: 15, names: 'keine', invoiceNumber: 'RE-2026-0042', brand: { name: 'Cleanos' } })
  const table = without.content.find((x) => x.table).table
  assert.deepEqual(table.body[0].map((c) => c.text), ['Datum', 'von–bis', 'Dauer', 'Leistung'])
  assert.equal(table.body.length, 4)
  assert.deepEqual(table.body[1].map((c) => c.text ?? c), ['Di 01.12.', '05:58–08:03', '2:00', 'Unterhaltsreinigung'])
  assert.deepEqual(table.body[2].map((c) => c.text ?? c), ['Di 01.12.', '09:00–10:07', '1:00', 'Glasreinigung (Sonderleistung)'])
  const json = JSON.stringify(without.content)
  assert.match(json, /Einsatzliste/)
  assert.match(json, /Beilage zur Rechnung: .*RE-2026-0042/)
  assert.match(json, /5,25 Stunden · 3 Einträge/)
  assert.match(json, /auf 15 Minuten gerundet/)
  assert.ok(!/Ana|Popescu/.test(json), 'keine Namen')
  const named = istListDocument({ object: { name: 'Kanzlei' }, monthLabel: 'Dezember 2026', rows: istFor({ ...base, names: 'vorname', planFallback: true }).rows, round: 15, names: 'vorname' })
  const t2 = named.content.find((x) => x.table).table
  assert.deepEqual(t2.body[0].map((c) => c.text), ['Datum', 'von–bis', 'Dauer', 'Leistung', 'Personal', 'Grundlage'])
  assert.ok(t2.body.some((r) => r[4] === 'Ana' && r[5] === 'Plan'))
  assert.match(JSON.stringify(named.content), /mit der geplanten Zeit verrechnet/)
  assert.equal(istListPdfName('Kanzlei Wien', '2026-12'), 'Einsatzliste_2026-12_Kanzlei-Wien.pdf')
})

test('Winterdienst-Nachweis als Beilage: nur das Objekt, Namen wie beim Leistungsnachweis', () => {
  // Testalarme kommen gar nicht ins Protokoll der App (newFromServer)
  const log = Object.fromEntries(Object.entries(LOG).filter(([, e]) => !e.test))
  const doc = winterLogDocument({ month: '2026-12', log, objects: [...objectsById.values()], objectId: 'o5', names: 'keine' })
  const body = doc.content.find((x) => x.table).table.body
  assert.equal(body.length, 6, 'Kopf + 5 Einträge des Objekts, wie auf der Rechnung')
  assert.ok(!JSON.stringify(body).includes('Elif'))
})

test('Grundlage Plan: Winterdienst-Einsätze nicht als Stunden, dafür ein Hinweis im Entwurf', () => {
  const { ctx, instances, state } = setup()
  const proof = proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances, state, stamps: {}, employeesById: ctx.employeesById, today: '2026-12-15' })
  assert.equal(proof.rows.filter((r) => r.category === 'winter' && r.status === 'erbracht').length, 1, 'der Winterdienst am 2.12. steht im Nachweis')
  const lines = linesFromProof({ proof, objectName: 'Kanzlei', month: '2026-12', rate: 30, newId })
  // Unterhalt 1., 8., 14., 15.12. (7.12. nicht besetzt) je 2 Stunden; Glas 1. und 15.12.; Winterdienst (30 Minuten) nicht
  assert.deepEqual(lines.map((l) => [l.type || 'item', l.text, l.qty]), [
    ['item', 'Unterhaltsreinigung Kanzlei Dezember 2026 lt. Leistungsnachweis (4 Einsätze)', 8],
    ['item', 'Glasreinigung am 01.12.2026', 1],
    ['item', 'Glasreinigung am 15.12.2026', 1],
    ['text', 'Winterdienst (1 Einsatz) wird gesondert verrechnet.', undefined],
  ])
  const onlyWinter = { rows: proof.rows.filter((r) => r.category === 'winter') }
  assert.deepEqual(linesFromProof({ proof: onlyWinter, objectName: 'Kanzlei', month: '2026-12', rate: 30, newId }), [], 'nur Winterdienst: kein Entwurf')
  const noWinter = { rows: proof.rows.filter((r) => r.category !== 'winter') }
  assert.ok(!linesFromProof({ proof: noWinter, objectName: 'Kanzlei', month: '2026-12', rate: 30, newId }).some((l) => l.type === 'text'), 'ohne Winterdienst kein Hinweis')
})

test('Beilage eingefroren: Winterdienst-Nachweis und Einsatzliste ohne Planung, Namen wie beim Abrechnen', () => {
  const object = { id: 'o5', name: 'Wohnanlage Lehen', address: 'Lehen 1', winter: { team: ['x'] } }
  const entries = winterEntries(LOG, { objectId: 'o5', month: '2026-12', objectsById }).map((e) => ({ ...e, fotos: e.id === 'a1' ? [{ datei: 'ab-1.jpg', pfad: 'exporte/x.jpg', url: 'https://sp/x', webspaceGeloescht: true }] : [] }))
  const none = freezeWinter({ object, entries, names: 'keine' })
  assert.deepEqual(none.object, { name: 'Wohnanlage Lehen', address: 'Lehen 1' }, 'nur Name und Adresse des Objekts')
  assert.equal(none.entries.length, 5)
  assert.ok(!JSON.stringify(none).includes('Elif'), 'bei „keine Namen“ gar nicht gespeichert')
  assert.deepEqual(none.entries[0].fotos, [{ datei: 'ab-1.jpg', pfad: 'exporte/x.jpg' }])
  assert.equal(freezeWinter({ object, entries, names: 'vorname' }).entries[0].person, 'Elif')
  // gleiches PDF wie aus dem Protokoll (ohne Fotos), nur aus den eingefrorenen Angaben
  const body = (doc) => doc.content.find((x) => x.table).table.body
  const live = winterLogDocument({ month: '2026-12', log: Object.fromEntries(entries.map((e) => [`${e.date}|${e.objectId}|${e.id}`, e])), objects: [object], objectId: 'o5', names: 'keine' })
  const fromFrozen = winterLogDocument({ month: '2026-12', log: frozenLog(none), objects: [{ id: 'o5', ...none.object }], objectId: 'o5', names: none.names })
  assert.deepEqual(body(fromFrozen), body(live))
  assert.match(JSON.stringify(fromFrozen.content), /Wohnanlage Lehen.*Lehen 1/)

  const { ctx, instances, state } = setup()
  const ist = istFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', stamps: STAMPS, instances, state, employeesById: ctx.employeesById, today: '2026-12-15', names: 'voll' })
  const fz = freezeIst({ object: { name: 'Kanzlei', address: 'Wien', tasks: [] }, rows: ist.rows, names: 'vorname', round: 15 })
  assert.deepEqual(fz.rows[0], { date: '2026-12-01', in: '05:58', out: '08:03', billed: 120, label: 'Unterhaltsreinigung', category: 'reinigung', basis: 'ist', person: 'Ana' })
  assert.equal(fz.round, 15)
  const t = istListDocument({ object: fz.object, monthLabel: 'Dezember 2026', rows: fz.rows, round: fz.round, names: fz.names }).content.find((x) => x.table).table
  assert.deepEqual(t.body[1].map((c) => c.text ?? c), ['Di 01.12.', '05:58–08:03', '2:00', 'Unterhaltsreinigung', 'Ana'])
  assert.ok(!JSON.stringify(freezeIst({ object: {}, rows: ist.rows, names: 'keine' })).includes('Ana'))
})

// ---------------------------------------------------------------- Saison einstellbar, Leistungszeitraum, Preise im Kundenblatt

test('Wintersaison: Vorgabe Juli bis Juni, einstellbar (z. B. November bis März), Monate dazwischen zur näheren Saison', () => {
  assert.deepEqual(seasonSettings({}), { start: 7, end: 6 })
  assert.deepEqual(seasonSettings({ winterSeason: { start: '11', end: 3 } }), { start: 11, end: 3 })
  assert.deepEqual(seasonSettings({ winterSeason: { start: 13, end: '' } }), { start: 7, end: 6 }, 'ungültig: Vorgabe')
  assert.equal(seasonText(), 'Juli bis Juni')
  const nm = { start: 11, end: 3 }
  assert.equal(seasonText(nm), 'November bis März')
  assert.deepEqual(winterSeason('2026-11', nm), { key: '2026/27', label: 'Winter 2026/27', from: '2026-11-01', to: '2027-03-31' })
  assert.equal(winterSeason('2027-03', nm).key, '2026/27')
  assert.equal(winterSeason('2027-04', nm).key, '2026/27', 'April: näher am Ende der vergangenen Saison')
  assert.equal(winterSeason('2027-07', nm).key, '2027/28', 'Juli: gleich weit, zur kommenden')
  assert.equal(winterSeason('2027-10', nm).key, '2027/28')
  // gleiche Kennungen wie mit der Vorgabe (frühere Saisonpauschalen bleiben erkannt)
  for (const ym of ['2026-11', '2027-01', '2027-03', '2027-05', '2027-08', '2027-10']) assert.equal(winterSeason(ym, nm).key, winterSeason(ym).key, ym)
  assert.deepEqual(winterSeason('2026-05', { start: 1, end: 12 }), { key: '2026', label: 'Winter 2026', from: '2026-01-01', to: '2026-12-31' })
  assert.equal(seasonPeriodText(winterSeason('2026-12', nm)), 'Leistungszeitraum 1.11.2026–31.3.2027')
  assert.equal(seasonPeriodText(winterSeason('2028-01', { start: 11, end: 2 })), 'Leistungszeitraum 1.11.2027–29.2.2028', 'Schaltjahr')
})

test('Saisonpauschale: Leistungszeitraum laut Einstellung auf der Position und im Beleg, Prüfsumme wie bisher aufgebaut', () => {
  const entries = winterEntries(LOG, { objectId: 'o5', month: '2026-12', objectsById })
  const season = { start: 11, end: 3 }
  const s = winterBill({ entries, prices: { mode: 'saison', pauschale: 900 }, objectName: 'Wohnanlage Lehen', month: '2026-12', newId, season })
  assert.equal(s.lines[0].longText, 'Leistungszeitraum 1.11.2026–31.3.2027')
  assert.deepEqual(s.period, { from: '2026-11-01', to: '2027-03-31' })
  // schon verrechnet: Saison laut Einstellung
  const docs = [{ id: 'd4', kind: 'rechnung', number: 'RE-2026-0012', source: { type: 'winterdienst', objectId: 'o5', mode: 'saison', season: '2026/27' } }]
  assert.equal(seasonBilled(docs, 'o5', '2027-02', season)?.id, 'd4')
  assert.equal(seasonBilled(docs, 'o5', '2027-11', season), null)
  // Beleg mit Leistungszeitraum der Saison: festschreiben, Prüfsumme stimmt, Zeitraum gehört dazu
  const settings = { sender: { name: 'Firma', address: 'Weg 1', uid: 'ATU12345678' } }
  const draft = { id: 'f2', kind: 'rechnung', date: '2026-12-05', serviceFrom: s.period.from, serviceTo: s.period.to, recipient: { name: 'HV', address: 'Ring 3' }, lines: s.lines, source: { type: 'winterdienst', key: winterKey('o5', '2026-12'), objectId: 'o5', month: '2026-12', mode: 'saison', season: '2026/27' } }
  const fixed = finalize(draft, [], settings, { now: '2026-12-05T08:00:00.000Z' })
  assert.equal(checksumOf(fixed), fixed.checksum)
  assert.notEqual(checksumOf({ ...fixed, serviceTo: '2027-06-30' }), fixed.checksum, 'Leistungszeitraum ist Teil der Rechnung')
  assert.notEqual(checksumOf({ ...fixed, lines: fixed.lines.map((l, i) => (i ? l : { ...l, longText: 'anders' })) }), fixed.checksum)
})

test('Preise im Kundenblatt: Dezimalkomma, nicht negativ, keine Zahl, höchstens zwei Nachkommastellen, leer = Artikel', () => {
  assert.deepEqual(priceInput('65,50'), { value: 65.5 })
  assert.deepEqual(priceInput('1.234,50'), { value: 1234.5 })
  assert.deepEqual(priceInput('65.5'), { value: 65.5 })
  assert.deepEqual(priceInput(' € 40 '), { value: 40 })
  assert.deepEqual(priceInput(''), { value: '' })
  assert.deepEqual(priceInput('0'), { value: '' }, '0 = kein Preis (Kontrolle nicht verrechnen)')
  assert.match(priceInput('-5').error, /nicht negativ/)
  assert.match(priceInput('−5,00').error, /nicht negativ/)
  assert.match(priceInput('zehn').error, /keine Zahl/)
  assert.match(priceInput('12,345').error, /zwei Stellen/)
  const r = winterPriceInputs({ mode: 'einsatz', beides: '65,50', raeumen: '-1', streuen: 'abc', kontrolle: '', pauschale: '' })
  assert.deepEqual(r.prices, { mode: 'einsatz', beides: 65.5, raeumen: '', streuen: '', kontrolle: '', pauschale: '' })
  assert.deepEqual(r.errors.map((e) => [e.field, e.text]), [['raeumen', 'Räumen: darf nicht negativ sein'], ['streuen', 'Streuen: ist keine Zahl (Beispiel: 65,50)']])
  assert.deepEqual(winterPriceInputs({ mode: 'saison', pauschale: '900' }).prices.pauschale, 900)
  assert.ok(winterPricesEmpty({ mode: 'einsatz', beides: '' }))
  assert.ok(!winterPricesEmpty({ mode: 'saison' }), 'Abrechnungsart Pauschale ist eine eigene Angabe')
  // gespeichert beim Kunden: gilt in „Winterdienst abrechnen“ vor den Artikeln
  const cu = { winterPrices: { o5: r.prices } }
  assert.equal(winterPrices(cu, 'o5', [{ name: 'Winterdienst Räumen und Streuen', price: 99 }]).beides, 65.5)
})
