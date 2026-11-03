import { test } from 'node:test'
import assert from 'node:assert/strict'

import { absenceRates, aging, complaintsByMonth, complaintsTopObjects, contribution, lastMonths, lastWeeks, materialByObject, materialMonths, plusHours, previousMonths, rangeOf, revenueMonths, topCustomers, trend, utilization, weekStats } from '../src/core/kpi.js'
import { areaMinutes, calcWage, calculate, CALC_DEFAULTS, frequencyLabel, hourlyRate, WEEKS_PER_MONTH } from '../src/core/calculation.js'
import { mondaysBetween, objectControlling, payrollBookings, timeAccount, toCSV, vacationSummary } from '../src/core/reports.js'

// Plan-Zustand zum Testen: Anzahl und Personen je Einsatz
const planState = (assigned = {}) => ({ count: (k) => (assigned[k] || []).length, assigned: (k) => (assigned[k] || []).map((employeeId) => ({ employeeId })) })
const inst = (key, date, net, staff = 1, extra = {}) => ({ key, date, net, staff, status: 'planned', objectId: 'o1', ...extra })
const invoice = (id, number, date, net, extra = {}) => ({ id, kind: 'rechnung', number, date, dueDate: date, customerId: 'c1', objectId: 'o1', recipient: { name: 'Kunde Eins' }, total: { net, vat: net * 0.2, gross: net * 1.2, groups: [{ rate: 20, net, vat: net * 0.2 }] }, ...extra })

// ---------------------------------------------------------------- Zeiträume und Trend

test('Kennzahlen: Trend unter einem halben Prozent ist „gleich“, negative Vorperiode, Rückgang', () => {
  assert.equal(trend(100.4, 100).dir, 'flat')
  assert.equal(trend(100.6, 100).dir, 'up')
  assert.deepEqual(trend(-50, -100), { delta: 50, pct: 0.5, dir: 'up' })
  assert.deepEqual(trend(0, 5), { delta: -5, pct: -1, dir: 'down' })
  assert.equal(trend(-3, 0).dir, 'down', 'ohne Vergleichswert entscheidet das Vorzeichen')
})

test('Kennzahlen: Wochen ab Sonntag, zwölf Monate über den Jahreswechsel, Vorperiode, Gesamtzeitraum', () => {
  const weeks = lastWeeks(2, '2026-11-08')
  assert.deepEqual(weeks.map((w) => [w.from, w.to]), [['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']])
  const months = lastMonths(12, '2026-03-15')
  assert.deepEqual([months[0].key, months.at(-1).key, months.find((m) => m.key === '2026-02').to], ['2025-04', '2026-03', '2026-02-28'])
  assert.deepEqual([previousMonths(months)[0].key, previousMonths(months).at(-1).key], ['2024-04', '2025-03'])
  assert.deepEqual(rangeOf(weeks, lastMonths(2, '2026-11-08')), { from: '2026-10-01', to: '2026-11-30' })
  assert.deepEqual(rangeOf([], []), { from: undefined, to: undefined })
})

// ---------------------------------------------------------------- Einsatzplanung

test('Kennzahlen: Woche ohne Einsätze hat keine Besetzungsquote, Besetzung höchstens bis zur Sollzahl', () => {
  const weeks = lastWeeks(2, '2026-11-04')
  const insts = [inst('a', '2026-11-02', 120, 2), inst('x', '2026-11-03', 60, 1, { status: 'cancelled' })]
  const [empty, cur] = weekStats({ weeks, instances: insts, state: planState({ a: ['e1', 'e2', 'e3'], x: ['e1'] }) })
  assert.equal(empty.rate, null)
  assert.deepEqual([cur.plan, cur.staffed, cur.slots, cur.filled, cur.open, cur.travel], [240, 240, 2, 2, 0, 0])
})

test('Kennzahlen: Ist-Stunden je Woche aus der Zeiterfassung – mit Pause, ohne offene Stempelungen', () => {
  const weeks = lastWeeks(1, '2026-11-04')
  const stamps = {
    a: { date: '2026-11-02', in: '2026-11-02T05:00:00.000Z', out: '2026-11-02T09:30:00.000Z', pause: 30 },
    b: { date: '2026-11-03', in: '2026-11-03T05:00:00.000Z', out: null },
    c: { date: '2026-10-30', in: '2026-10-30T05:00:00.000Z', out: '2026-10-30T07:00:00.000Z' },
  }
  const [w] = weekStats({ weeks, instances: [], state: planState(), stamps })
  assert.equal(w.ist, 240)
})

test('Kennzahlen: Auslastung – Austritt kürzt das Soll, höchstens 40 Wochenstunden, ohne Vertrag am Ende', () => {
  const insts = [inst('a', '2026-11-02', 600), inst('b', '2026-11-03', 120), inst('c', '2026-11-04', 300, 1, { status: 'cancelled' }), inst('d', '2026-11-10', 300)]
  const employees = [
    { id: 'e2', weeklyHours: 0 },
    { id: 'e1', weeklyHours: 20, exitDate: '2026-11-04' },
    { id: 'e4', weeklyHours: 50 },
    { id: 'e3', weeklyHours: 0 },
  ]
  const list = utilization({ employees, instances: insts, state: planState({ a: ['e1'], b: ['e2'], c: ['e1'], d: ['e1'] }), from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(list.map((x) => [x.emp.id, x.contract, x.planned, x.pct === null ? null : Math.round(x.pct * 1000) / 1000]), [['e1', 720, 600, 0.833], ['e4', 2400, 0, 0], ['e2', 0, 120, null]])
})

test('Kennzahlen: Abwesenheitsquote – Eintritt mitten im Monat, Feiertage als Map, Zeitausgleich zählt nicht', () => {
  const months = lastMonths(1, '2026-11-10')
  const employees = [{ id: 'e1', entryDate: '2026-11-16' }]
  const absences = [
    { employeeId: 'e1', type: 'Zeitausgleich', from: '2026-11-16', to: '2026-11-17' },
    { employeeId: 'e1', type: 'Urlaub', from: '2026-11-23', to: '2026-11-24' },
    { employeeId: 'e1', type: 'Krankenstand', from: '2026-11-27', to: '2026-11-30' },
    { employeeId: 'e9', type: 'Krankenstand', from: '2026-11-01', to: '2026-11-30' },
  ]
  const [r] = absenceRates({ months, employees, absences, holidays: new Map([['2026-11-30', { name: 'betriebsfrei' }]]) })
  // 16.–27.11. sind 10 Werktage (der 30. ist frei); krank am Freitag 27., das Wochenende zählt nicht
  assert.deepEqual([r.sollDays, r.sick, r.vacation, r.sickRate, r.vacationRate], [10, 1, 2, 0.1, 0.2])
  assert.deepEqual(absenceRates({ months, employees: [] })[0], { key: '2026-11', sollDays: 0, sick: 0, vacation: 0, sickRate: 0, vacationRate: 0 })
})

test('Kennzahlen: Plus-Stunden – „VOLLZEIT“ unabhängig von der Schreibweise, ohne Angabe als Mehrarbeit', () => {
  assert.deepEqual(plusHours([{ employee: { type: 'VOLLZEIT' }, saldo: 60 }, { employee: {}, saldo: 30 }, { saldo: 15 }, { employee: { type: 'Vollzeit' } }]), { overtime: 60, extra: 45, total: 105 })
})

// ---------------------------------------------------------------- Reklamationen

test('Kennzahlen: Reklamationen – Datum aus Eingang, Anlage oder Mangel, Rangliste mit Grenze und Gleichstand', () => {
  const items = [
    { createdAt: '2026-11-03T08:00:00Z', objectId: 'o1', status: 'erledigt' },
    { date: '2026-11-04', objectId: 'o2', status: 'offen' },
    { received: '2026-11-05', objectId: 'o1', status: 'erledigt' },
    { received: '2026-11-06', objectId: 'o2', status: 'erledigt' },
    { received: '2026-11-07', status: 'offen' },
    { received: '2026-12-01', objectId: 'o3', status: 'offen' },
  ]
  assert.deepEqual(complaintsByMonth(items, lastMonths(1, '2026-11-10')), [{ key: '2026-11', count: 5, open: 2 }])
  assert.deepEqual(complaintsTopObjects(items, { from: '2026-11-01', to: '2026-11-30', n: 1 }), [{ objectId: 'o2', count: 2, open: 1 }], 'gleich viele: mehr offene zuerst')
  assert.deepEqual(complaintsTopObjects(items, { from: '2026-11-01', to: '2026-11-30' }).map((x) => x.objectId), ['o2', 'o1'])
})

// ---------------------------------------------------------------- Fakturierung

test('Kennzahlen: offene Posten nach Alter – Grenzen bei 30 und 60 Tagen, am Fälligkeitstag nicht fällig', () => {
  const doc = { documents: [invoice('1', 'RE-1', '2026-11-20', 10), invoice('2', 'RE-2', '2026-10-21', 20), invoice('3', 'RE-3', '2026-10-20', 30), invoice('4', 'RE-4', '2026-09-21', 40), invoice('5', 'RE-5', '2026-09-20', 50)] }
  assert.deepEqual(aging(doc, '2026-11-20').map((b) => [b.id, b.amount, b.count]), [['nicht', 12, 1], ['d30', 24, 1], ['d60', 84, 2], ['d60plus', 60, 1]])
})

test('Kennzahlen: Umsatz je Monat – Korrektur mindert, gezählt werden nur Rechnungen', () => {
  const doc = { documents: [invoice('a', 'RE-1', '2026-11-03', 1000), { ...invoice('k', 'KO-1', '2026-11-10', -150), kind: 'korrektur', refId: 'a' }, invoice('e', null, '2026-11-11', 999)] }
  assert.deepEqual(revenueMonths(doc, lastMonths(1, '2026-11-30')), [{ key: '2026-11', net: 850, count: 1 }])
})

test('Kennzahlen: Top-Kunden ohne ganz stornierte, mit Grenze, Schlüssel ersatzweise der Empfängername', () => {
  const doc = {
    documents: [
      invoice('a', 'RE-1', '2026-11-03', 300, { customerId: 'c1' }),
      { ...invoice('s', 'ST-1', '2026-11-04', -300, { customerId: 'c1' }), kind: 'storno', refId: 'a' },
      invoice('b', 'RE-2', '2026-11-05', 200, { customerId: '', recipient: { name: 'Laufkundschaft Beispiel' } }),
      invoice('c', 'RE-3', '2026-11-06', 500, { customerId: 'c3', recipient: { name: 'Kunde Drei' } }),
      invoice('d', 'RE-4', '2026-11-07', 100, { customerId: 'c4', recipient: { name: 'Kunde Vier' } }),
    ],
  }
  assert.deepEqual(topCustomers(doc, { from: '2026-11-01', to: '2026-11-30', n: 2 }), [{ key: 'c3', name: 'Kunde Drei', net: 500 }, { key: 'Laufkundschaft Beispiel', name: 'Laufkundschaft Beispiel', net: 200 }])
})

// ---------------------------------------------------------------- Material und Deckungsbeitrag

test('Kennzahlen: Material – Bestelldatum vor Anlagedatum, Bestellungen ohne Status zählen nicht, nur Ausgaben je Objekt', () => {
  const mat = {
    moves: [
      { kind: 'ausgabe', date: '2026-11-03', qty: -4, price: 2.5, objectId: 'o1' },
      { kind: 'ausgabe', date: '2026-11-04', qty: -1, price: 10 },
      { kind: 'eingang', date: '2026-11-03', qty: 50, price: 2.5, objectId: 'o1' },
      { kind: 'ausgabe', date: '2026-12-01', qty: -1, price: 99, objectId: 'o1' },
    ],
    orders: [
      { status: 'geliefert', createdAt: '2026-10-28', orderedAt: '2026-11-02T08:00:00Z', lines: [{ qty: 2, price: 15 }] },
      { createdAt: '2026-11-02', lines: [{ qty: 100, price: 1 }] },
    ],
  }
  assert.deepEqual(materialMonths(mat, lastMonths(2, '2026-11-10')), [{ key: '2026-10', used: 0, ordered: 0 }, { key: '2026-11', used: 20, ordered: 30 }])
  assert.deepEqual([...materialByObject(mat, { from: '2026-11-01', to: '2026-11-30' })], [['o1', 10]])
})

test('Kennzahlen: Deckungsbeitrag – Objekt ohne Einsätze, Umsatz 0 ohne Quote, Besetzung höchstens Sollzahl, absteigend', () => {
  const insts = [inst('a', '2026-11-02', 120, 1, { objectId: 'o1' }), inst('b', '2026-11-03', 60, 2, { objectId: 'o2' }), inst('c', '2026-11-04', 600, 1, { objectId: 'o2', status: 'cancelled' })]
  const rows = contribution({ revenue: new Map([['o1', 100], ['o2', 0], ['o3', 400]]), material: new Map([['o3', 50]]), instances: insts, state: planState({ a: ['e1'], b: ['e1', 'e2', 'e3'], c: ['e1'] }), from: '2026-11-01', to: '2026-11-30', costPerHour: 30 })
  assert.deepEqual(rows.map((r) => [r.objectId, r.labor, r.material, r.margin, r.rate]), [['o3', 0, 50, 350, 0.875], ['o1', 60, 0, 40, 0.4], ['o2', 60, 0, -60, null]])
})

// ---------------------------------------------------------------- Objektkalkulation

test('Kalkulation: unbekannte Flächenart mit 150 m²/h, negative Fläche und fehlende Häufigkeit ergeben 0', () => {
  assert.deepEqual(areaMinutes({ type: 'xyz', m2: 150, perWeek: 1 }), { value: 150, minutes: 60 * WEEKS_PER_MONTH })
  assert.equal(areaMinutes({ type: 'buero', m2: -5, perWeek: 5 }).minutes, 0)
  assert.equal(areaMinutes({ type: 'buero', m2: 200 }).minutes, 0)
  assert.equal(areaMinutes({ type: 'sanitaer', m2: 60, perWeek: 1, value: '30' }).value, 30, 'eigener Wert als Text')
  assert.equal(areaMinutes({ type: 'lager', m2: 300, perWeek: 1 }, {}).value, CALC_DEFAULTS.performance.lager, 'leere Leistungswerte: Standard')
})

test('Kalkulation: ohne Zuschläge ist der Verrechnungssatz der Stundenlohn, Selbstkosten ohne Gewinn', () => {
  const r = hourlyRate(20, { lnkPct: 0, materialPct: 0, overheadPct: 0, profitPct: 0 })
  assert.deepEqual([r.rate, r.cost, r.steps.length], [20, 20, 5])
  const p = hourlyRate(20, { lnkPct: 0, materialPct: 0, overheadPct: 0, profitPct: 25 })
  assert.deepEqual([p.rate, p.cost], [25, 20])
})

test('Kalkulation: ohne Fläche kein Preis je m², ohne USt brutto = netto, eigener Leistungswert in den Einstellungen', () => {
  const none = calculate({ areas: [{ type: 'buero', m2: 0, perWeek: 5 }], settings: {}, wage: 14 })
  assert.deepEqual([none.net, none.perM2, none.margin], [0, null, 0])
  const settings = { lnkPct: 0, materialPct: 0, overheadPct: 0, profitPct: 0, setupPct: 0, vatPct: 0, performance: { buero: 100 } }
  const c = calculate({ areas: [{ type: 'buero', m2: 100, perWeek: 3 }], settings, wage: 12 })
  // 1 h je Reinigung × 3 × 52/12 = 13 h × 12 € = 156 €
  assert.deepEqual([c.cleaningMinutes, c.minutes, c.hours, c.net, c.vat, c.gross, c.perM2], [780, 780, 13, 156, 0, 156, 1.56])
})

test('Kalkulation: Häufigkeit als Text und Stundenlohn aus Lohngruppe oder eigenem Wert', () => {
  assert.equal(frequencyLabel(2.5), '2,5× pro Woche')
  assert.equal(frequencyLabel(5), 'täglich (Mo–Fr)')
  assert.equal(frequencyLabel(4 / 52), 'quartalsweise')
  assert.equal(frequencyLabel(1 / 3), '0,33× pro Woche')
  assert.equal(calcWage({ wage: 0, wageGroup: '3' }, { 3: 14.1 }), 14.1, 'Lohn 0 heißt: Lohngruppe')
  assert.equal(calcWage(null, { 2: 13 }), 13, 'ohne Einstellungen: Lohngruppe 2')
  assert.equal(calcWage({}, {}), 0)
})

// ---------------------------------------------------------------- Auswertungen und CSV

test('CSV für die Lohnverrechnung: Semikolon, Anführungszeichen verdoppelt, Windows-Zeilenenden', () => {
  const csv = toCSV([{ a: 'Huber; Anna', b: 'sagt "hallo"', c: 'Zeile\nzwei' }, { a: 'x', b: 'y', c: 'z' }], [['Name', (r) => r.a], ['Notiz', (r) => r.b], ['Text', (r) => r.c]])
  assert.equal(csv, 'Name;Notiz;Text\r\n"Huber; Anna";"sagt ""hallo""";"Zeile\nzwei"\r\nx;y;z')
})

test('Auswertung: Montage, die einen Monat berühren, auch der Montag vor dem Monatsersten', () => {
  assert.deepEqual(mondaysBetween('2026-11-01', '2026-11-30'), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  assert.deepEqual(mondaysBetween('2026-11-03', '2026-11-03'), ['2026-11-02'])
})

test('Urlaub über den Jahreswechsel: je Jahr nur dessen Werktage ohne gesetzliche Feiertage', () => {
  const absences = [{ employeeId: 'e1', type: 'Urlaub', from: '2026-12-21', to: '2027-01-08' }, { employeeId: 'e1', type: 'Krankenstand', from: '2026-03-02', to: '2026-03-06' }, { employeeId: 'e2', type: 'Urlaub', from: '2026-05-04', to: '2026-05-08' }]
  // 2026: 21.–24.12. und 28.–31.12. (Christtag 25.12. ist Feiertag, der 24.12. nicht) = 8
  assert.deepEqual(vacationSummary({ id: 'e1' }, absences, 2026), { entitlement: 25, used: 8, rest: 17 })
  // 2027: 4., 5., 7., 8.1. (Neujahr und Heilige Drei Könige sind Feiertage) = 4
  assert.deepEqual(vacationSummary({ id: 'e1', vacationDaysYear: 30 }, absences, 2027), { entitlement: 30, used: 4, rest: 26 })
})

test('Zeitkonto: Startsaldo, nur veröffentlichte Wochen bis zum Stichtag, Monatsabschlüsse bis Wochenende', () => {
  const emp = { id: 'e1', startBalanceHours: 1.5 }
  const weeks = { '2026-10-26': { status: 'veroeffentlicht', saldi: { e1: 30 } }, '2026-11-02': { status: 'entwurf', saldi: { e1: 999 } }, '2026-11-09': { status: 'veroeffentlicht', saldi: { e1: 60 } }, '2026-11-16': { status: 'veroeffentlicht', saldi: { e2: 45 } } }
  const payroll = { '2026-10': { closedAt: '2026-11-03', rows: { e1: { accountDelta: -120 } } }, '2026-11': { closedAt: '2026-12-02', rows: { e1: { accountDelta: 15 } } }, '2026-09': { rows: { e1: { accountDelta: -999 } } } }
  assert.equal(payrollBookings(emp, payroll, '2026-11-15'), -120)
  assert.equal(timeAccount(emp, weeks, '2026-11-09', payroll), 90 + 30 + 60 - 120)
  assert.equal(timeAccount(emp, weeks, '2026-11-30', payroll), 90 + 30 + 60 - 120 + 15, 'November endet in der Woche ab 30.11.')
})

test('Objekt-Controlling: Budget gegen Plan, abgesagte nach ursprünglichem Datum, offen nur in eingeteilten Wochen', () => {
  const objects = [{ id: 'o1', budgetHoursMonth: 10 }, { id: 'o2' }]
  const insts = [
    inst('a', '2026-11-03', 120, 2, { objectId: 'o1' }),
    inst('b', '2026-11-24', 60, 1, { objectId: 'o1' }),
    inst('c', '2026-12-01', 60, 1, { objectId: 'o1', status: 'cancelled', origDate: '2026-11-30' }),
    inst('d', '2026-11-05', 90, 1, { objectId: 'o2' }),
  ]
  const rows = objectControlling({}, objects, '2026-11', insts, planState({ a: ['e1'], d: ['e2'] }), (monday) => monday < '2026-11-23')
  assert.deepEqual(rows.map((r) => [r.object.id, r.budget, r.planned, r.staffed, r.open, r.cancelled, r.diff]), [['o1', 600, 300, 120, 120, 60, -300], ['o2', 0, 90, 90, 0, 0, null]])
})
