import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, dayIndex } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { availabilityText, availabilityWindow, createContext, DEFAULT_RULES, evaluateEmployee, findAbsence, fitsAvailability, fitsWindow, hasMinorWeeklyRest, hasWeeklyRest, holidayCredits, maxSeverity, mergeRules, registerRule, RULES, validatePlan, windowMinutes } from '../src/core/rules.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1', 'o2'], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })
const OBJECTS = [{ id: 'o1', name: 'Objekt A' }, { id: 'o2', name: 'Objekt B' }]

/** Woche(n) planen; ohne `assignments` sind alle Einsätze der ersten Person zugeteilt. */
function plan({ employees, tasks, objects = OBJECTS, absences = [], rules = {}, travel = {}, trips = {}, from = '2026-11-02', to = '2026-11-08', extraFreeDays = [], assignments, overrides = {} }) {
  const data = { employees, objects, tasks, absences, rules, travel, trips, overrides }
  const holidays = holidayCalendar(addDays(from, -7), addDays(to, 7), extraFreeDays)
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, from, to, holidays, ctx.rules)
  const who = employees[0]?.id
  const asg = assignments || Object.fromEntries(instances.filter((i) => i.status !== 'cancelled').map((i) => [i.key, [{ employeeId: who }]]))
  const state = new PlanState(instances, asg)
  const issues = (id = who) => evaluateEmployee(ctx.employeesById.get(id), state.instancesOf(id), ctx)
  return { ctx, instances, state, issues, codes: (id) => issues(id).map((i) => i.code), byKey: new Map(instances.map((i) => [i.key, i])) }
}
const span = (date, from, to) => ({ start: dayIndex(date) * 1440 + from * 60, end: dayIndex(date) * 1440 + to * 60 })

// ---------------------------------------------------------------- Regeln und Kontext

test('Grenzwerte laut AZG, ARG und KJBG als Vorgabe', () => {
  const r = mergeRules({})
  assert.deepEqual([r.minDailyRestH, r.maxDailyH, r.dailyWarnH, r.maxWeeklyH, r.maxAvgWeeklyH, r.avgWeeks, r.minWeeklyRestH, r.breakAfterH, r.breakMin], [11, 12, 10, 60, 48, 17, 36, 6, 30])
  assert.deepEqual(r.minor, { maxDailyH: 8, maxWeeklyH: 40, minDailyRestH: 12, nightStart: '20:00', nightEnd: '06:00' })
  assert.deepEqual([r.pay.nightFrom, r.pay.nightTo, r.pay.sundayFrom, r.pay.sundayTo], ['21:00', '06:00', '06:00', '21:00'])
})

test('Regeln zusammenführen: verschachtelte Werte einzeln überschreiben, Vorgaben bleiben unverändert', () => {
  const r = mergeRules({ pay: { ueTag: 60 }, minor: { maxDailyH: 7 }, wages: { 6: 13 }, minDailyRestH: 12 })
  assert.deepEqual([r.pay.ueTag, r.pay.ueNacht, r.pay.mehrPct], [60, 100, 25])
  assert.deepEqual([r.minor.maxDailyH, r.minor.minDailyRestH], [7, 12])
  assert.deepEqual([r.wages[6], r.wages[1]], [13, 15.12])
  assert.equal(r.minDailyRestH, 12)
  assert.deepEqual(r.disabledRules, [])
  assert.equal(DEFAULT_RULES.pay.ueTag, 50)
  assert.equal(DEFAULT_RULES.minor.maxDailyH, 8)
  assert.equal(DEFAULT_RULES.wages[6], 12.37)
})

test('Fahrzeit: gleiches Objekt, eingetragene Strecke (beide Richtungen), Schätzung aus Koordinaten, Pauschale', () => {
  const objects = [...OBJECTS, { id: 'o3', name: 'Hauptbahnhof', lat: 47.8131, lon: 13.0456 }, { id: 'o4', name: 'Hallein Zentrum', lat: 47.6833, lon: 13.097 }]
  const ctx = createContext({ employees: [], objects, travel: { 'o1|o2': 25 } }, new Map())
  assert.deepEqual(ctx.travelInfo('o1', 'o1'), { minutes: 0, source: 'gleich' })
  assert.deepEqual(ctx.travelInfo('o2', 'o1'), { minutes: 25, source: 'strecke' })
  const est = ctx.travelInfo('o3', 'o4')
  assert.equal(est.source, 'geschaetzt')
  assert.ok(est.km > 15 && est.km < 25, String(est.km))
  assert.equal(est.minutes % 5, 0, 'auf 5 Minuten aufgerundet')
  assert.ok(est.minutes > 30)
  assert.deepEqual(ctx.travelInfo('o1', 'o3'), { minutes: 30, source: 'pauschale' })
  const slow = createContext({ employees: [], objects, rules: { travelSpeedKmh: 20 } }, new Map())
  assert.ok(slow.travel('o3', 'o4') > est.minutes, 'langsamer = länger')
  const flat = createContext({ employees: [], objects, rules: { travelFromDistance: false, travelMin: 20 } }, new Map())
  assert.deepEqual(flat.travelInfo('o3', 'o4'), { minutes: 20, source: 'pauschale' })
})

test('Geplante Fahrt nach einem Einsatz: Eintrag der Woche > Leistung > automatisch bis zum nächsten Einsatz', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00'), task('b', 'o2', [2], '10:30', '12:00'), task('c', 'o1', [3], '08:00', '09:00', { travelAfterMin: 15, travelNote: 'Material holen' })]
  const base = plan({ employees: [emp('x'), emp('y')], tasks, travel: { 'o1|o2': 25 } })
  const [a, b, c] = ['2026-11-03|a', '2026-11-03|b', '2026-11-04|c'].map((k) => base.byKey.get(k))
  assert.deepEqual(base.ctx.tripAfter('x', a, b), { minutes: 25, note: '', source: 'automatisch' })
  assert.deepEqual(base.ctx.tripAfter('x', c, null), { minutes: 15, note: 'Material holen', source: 'leistung' })
  assert.deepEqual(base.ctx.tripAfter('x', b, null), { minutes: 0, note: '', source: 'keine' })
  assert.equal(base.ctx.tripAfter('x', a, c).source, 'keine', 'nächster Einsatz erst am Folgetag')
  const week = plan({ employees: [emp('x'), emp('y')], tasks, travel: { 'o1|o2': 25 }, trips: { '2026-11-03|a|x': { min: 10, note: 'mit Kollegin im Auto' } } })
  assert.deepEqual(week.ctx.tripAfter('x', a, b), { minutes: 10, note: 'mit Kollegin im Auto', source: 'woche' })
  assert.equal(week.ctx.tripAfter('y', a, b).minutes, 25, 'Eintrag gilt nur für die Person')
})

test('Abwesenheit: von/bis einschließlich, nur für die eigene Person', () => {
  const ctx = createContext({ employees: [emp('x'), emp('y')], objects: [], absences: [{ employeeId: 'x', type: 'Urlaub', from: '2026-11-03', to: '2026-11-05' }] }, new Map())
  assert.equal(findAbsence(ctx, 'x', '2026-11-02'), null)
  assert.equal(findAbsence(ctx, 'x', '2026-11-03').type, 'Urlaub')
  assert.equal(findAbsence(ctx, 'x', '2026-11-05').type, 'Urlaub')
  assert.equal(findAbsence(ctx, 'x', '2026-11-06'), null)
  assert.equal(findAbsence(ctx, 'y', '2026-11-04'), null)
})

test('Verfügbarkeit: Fenster über Mitternacht und Anschluss an den Folgetag ab 00:00', () => {
  const p = emp('p', { availability: { 2: { from: '20:00', to: '02:00' }, 5: { from: '18:00', to: '24:00' }, 6: { from: '00:00', to: '03:00' }, 7: { from: '18:00', to: '24:00' } } })
  assert.deepEqual(availabilityWindow(p, 2), { from: 1200, to: 1560 })
  assert.equal(availabilityWindow(p, 1), null)
  assert.ok(fitsWindow(p, 2, 22 * 60, 25 * 60))
  assert.ok(!fitsWindow(p, 2, 19 * 60, 21 * 60), 'beginnt vor dem Fenster')
  assert.ok(fitsWindow(p, 5, 22 * 60, 26 * 60), 'Fr bis 24:00 und Sa ab 00:00')
  assert.ok(!fitsWindow(p, 5, 22 * 60, 28 * 60), 'Sa nur bis 03:00')
  assert.ok(!fitsWindow(p, 7, 22 * 60, 25 * 60), 'Montag nicht verfügbar')
  assert.ok(!fitsWindow({ ...p, availability: { ...p.availability, 6: { from: '01:00', to: '05:00' } } }, 5, 22 * 60, 26 * 60), 'Folgetag erst ab 01:00')
  assert.equal(availabilityText(p, 2), 'Di 20:00–02:00')
  assert.equal(availabilityText(p, 1), 'Mo nicht verfügbar')
  const night = { weekday: 2, start: dayIndex('2026-11-03') * 1440 + 22 * 60, end: dayIndex('2026-11-04') * 1440 + 60 }
  assert.ok(fitsAvailability(p, night))
})

test('Minuten in einem Zeitfenster: über zwei Nächte, Tagesfenster, ohne Überlappung', () => {
  assert.equal(windowMinutes(20 * 60, 1440 + 23 * 60, '21:00', '06:00'), 540 + 120)
  assert.equal(windowMinutes(0, 1440, '06:00', '21:00'), 900)
  assert.equal(windowMinutes(5 * 60, 6 * 60 + 40, '06:00', '21:00'), 40)
  assert.equal(windowMinutes(8 * 60, 16 * 60, '21:00', '06:00'), 0)
})

// ---------------------------------------------------------------- Ruhezeit, Höchstarbeitszeit, Pausen

test('Tägliche Ruhezeit (§ 12 AZG): genau 11 h in Ordnung, eine Minute weniger ist ein Verstoß', () => {
  const ok = plan({ employees: [emp('x')], tasks: [task('abend', 'o1', [2], '17:00', '20:00'), task('frueh', 'o1', [3], '07:00', '09:00')] })
  assert.ok(!ok.codes().includes('REST'))
  const knapp = plan({ employees: [emp('x')], tasks: [task('abend', 'o1', [2], '17:00', '20:00'), task('frueh', 'o1', [3], '06:59', '09:00')] })
  const rest = knapp.issues().find((i) => i.code === 'REST')
  assert.ok(rest)
  assert.match(rest.message, /Ruhezeit nur 10,98 h: Ende Di 03\.11\. 20:00, Beginn Mi 04\.11\. 06:59 \(mind\. 11 h\)/)
  assert.deepEqual(rest.keys, ['2026-11-03|abend', '2026-11-04|frueh'])
})

test('Tägliche Ruhezeit: geplante Fahrt nach dem letzten Einsatz zählt zur Arbeitszeit', () => {
  const tasks = [task('abend', 'o1', [2], '17:00', '20:00', { travelAfterMin: 30 }), task('frueh', 'o1', [3], '07:00', '09:00')]
  const rest = plan({ employees: [emp('x')], tasks }).issues().find((i) => i.code === 'REST')
  assert.match(rest.message, /Ruhezeit nur 10,5 h: Ende Di 03\.11\. 20:30/)
})

test('Jugendliche (§ 16 KJBG): 12 h Ruhezeit statt 11 h', () => {
  const tasks = [task('nachm', 'o1', [2], '14:00', '19:00'), task('frueh', 'o1', [3], '06:30', '08:00')]
  const minor = plan({ employees: [emp('l', { minor: true })], tasks })
  assert.match(minor.issues().find((i) => i.code === 'REST').message, /11,5 h.*\(mind\. 12 h\)/)
  assert.ok(!minor.codes().includes('MINOR_NIGHT'), '06:30 und 19:00 liegen außerhalb der Nachtruhe')
  assert.ok(!plan({ employees: [emp('a')], tasks }).codes().includes('REST'))
})

test('Jugendliche (§ 11 KJBG): höchstens 8 h am Tag', () => {
  const acht = plan({ employees: [emp('l', { minor: true })], tasks: [task('t', 'o1', [2], '07:00', '15:30')] })
  assert.ok(!acht.codes().includes('DAILY_MAX'), '8,5 h minus 30 min Pause = 8 h')
  const mehr = plan({ employees: [emp('l', { minor: true })], tasks: [task('t', 'o1', [2], '07:00', '16:00')] })
  assert.match(mehr.issues().find((i) => i.code === 'DAILY_MAX').message, /8,5 h inkl\. Fahrzeit, Höchstgrenze 8 h/)
  assert.ok(!mehr.codes().includes('DAILY_LONG'), 'für Jugendliche keine zusätzliche 10-h-Warnung')
})

test('Tagesarbeitszeit (§ 9 AZG): über 10 h Warnung, über 12 h Verstoß', () => {
  const lang = plan({ employees: [emp('x')], tasks: [task('t', 'o1', [2], '06:00', '17:00')] }).codes()
  assert.ok(lang.includes('DAILY_LONG') && !lang.includes('DAILY_MAX'))
  const zuLang = plan({ employees: [emp('x')], tasks: [task('t', 'o1', [2], '05:00', '18:00')] }).codes()
  assert.ok(zuLang.includes('DAILY_MAX') && !zuLang.includes('DAILY_LONG'))
})

test('Tagesarbeitszeit: Fahrzeit zwischen den Objekten zählt mit', () => {
  const tasks = [task('a', 'o1', [2], '06:00', '12:00'), task('b', 'o2', [2], '12:40', '16:40')]
  const mitFahrt = plan({ employees: [emp('x')], tasks, travel: { 'o1|o2': 30 } })
  assert.match(mitFahrt.issues().find((i) => i.code === 'DAILY_LONG').message, /Tagesarbeitszeit 10,5 h inkl\. Fahrzeit/)
  assert.ok(!mitFahrt.codes().includes('TRAVEL'), '40 min Zeit für 30 min Fahrt')
  assert.ok(!plan({ employees: [emp('x')], tasks, travel: { 'o1|o2': 0 } }).codes().includes('DAILY_LONG'), 'genau 10 h ohne Fahrt')
})

test('Fahrzeit laut eingetragener Strecke passt nicht zwischen zwei Einsätze', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00'), task('b', 'o2', [2], '10:15', '12:00')]
  const eng = plan({ employees: [emp('x')], tasks, travel: { 'o1|o2': 20 } })
  assert.equal(eng.issues().find((i) => i.code === 'TRAVEL').message, 'Fahrt Objekt A → Objekt B dauert 20 min, Zeit dazwischen nur 15 min')
  assert.ok(!plan({ employees: [emp('x')], tasks, travel: { 'o1|o2': 15 } }).codes().includes('TRAVEL'))
})

test('Wochenarbeitszeit (§ 9 AZG): über 60 h Verstoß, über 48 h Hinweis auf den Durchschnitt', () => {
  const p = plan({ employees: [emp('x')], tasks: [task('t', 'o1', [1, 2, 3, 4, 5, 6], '06:00', '17:00')] })
  const issues = p.issues()
  assert.match(issues.find((i) => i.code === 'WEEKLY_MAX').message, /^63 h in KW 45, Höchstgrenze 60 h$/)
  assert.ok(issues.some((i) => i.code === 'WEEKLY_48'))
  assert.ok(!issues.some((i) => i.code === 'WEEKLY_REST'), 'Samstag 17 Uhr bis Montag frei')
})

test('Jugendliche: höchstens 40 h pro Woche', () => {
  const fuenf = plan({ employees: [emp('l', { minor: true })], tasks: [task('t', 'o1', [1, 2, 3, 4, 5], '07:00', '15:30')] })
  assert.ok(!fuenf.codes().includes('WEEKLY_MAX'))
  const sechs = plan({ employees: [emp('l', { minor: true })], tasks: [task('t', 'o1', [1, 2, 3, 4, 5], '07:00', '15:30'), task('sa', 'o1', [6], '07:00', '09:00')] })
  assert.match(sechs.issues().find((i) => i.code === 'WEEKLY_MAX').message, /42 h in KW 45, Höchstgrenze 40 h/)
})

test('Ruhepause (§ 11 AZG): über 6 h braucht 30 min Lücke, kurze Lücke reicht nicht', () => {
  const kurz = plan({ employees: [emp('x')], tasks: [task('a', 'o1', [2], '08:00', '11:30'), task('b', 'o1', [2], '11:45', '15:00')] })
  assert.equal(kurz.issues().find((i) => i.code === 'BREAK').message, '6,75 h am Tag ohne 30 min Ruhepause')
  const gut = plan({ employees: [emp('x')], tasks: [task('a', 'o1', [2], '08:00', '11:30'), task('b', 'o1', [2], '12:00', '15:15')] })
  assert.ok(!gut.codes().includes('BREAK'))
})

test('Ruhepause für Jugendliche (§ 15 KJBG): schon über 4,5 h', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:30'), task('b', 'o1', [2], '10:40', '13:00')]
  assert.ok(plan({ employees: [emp('l', { minor: true })], tasks }).codes().includes('BREAK'))
  assert.ok(!plan({ employees: [emp('x')], tasks }).codes().includes('BREAK'))
})

test('Wochenruhe (§ 4 ARG): sieben Arbeitstage ohne 36 h mit ganzem freiem Tag', () => {
  const p = plan({ employees: [emp('x')], tasks: [task('t', 'o1', [1, 2, 3, 4, 5, 6, 7], '08:00', '12:00')], rules: { sundayBasis: 'KV' } })
  assert.match(p.issues().find((i) => i.code === 'WEEKLY_REST').message, /Keine 36 h Wochenruhe mit einem ganzen freien Tag in KW 45/)
  assert.equal(hasWeeklyRest([], '2026-11-02', 36 * 60), true, 'ohne Einsätze frei')
  // nur der Sonntag frei, aber Sa 12:00 bis Mo 06:00 = 42 h
  const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => span(d, 6, 14))
  assert.equal(hasWeeklyRest([...week, span('2026-11-07', 6, 12), span('2026-11-09', 6, 14)], '2026-11-02', 36 * 60), true)
  assert.equal(hasWeeklyRest([...week, span('2026-11-07', 6, 22), span('2026-11-08', 6, 9)], '2026-11-02', 36 * 60), false)
})

test('Wochenfreizeit Jugendlicher (§ 19 KJBG): Sonntag plus Samstag oder Montag', () => {
  const mo = '2026-11-02'
  const werktage = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => span(d, 8, 12))
  assert.equal(hasMinorWeeklyRest(werktage, mo), true, 'Sa und So frei')
  assert.equal(hasMinorWeeklyRest([...werktage.slice(1), span('2026-11-07', 8, 12)], mo), true, 'So und Mo frei')
  assert.equal(hasMinorWeeklyRest([...werktage, span('2026-11-07', 8, 12), span('2026-11-09', 8, 12)], mo), false, 'nur Sonntag frei')
  assert.equal(hasMinorWeeklyRest([span('2026-11-08', 8, 9)], mo), false, 'Sonntag gearbeitet')
  assert.equal(hasMinorWeeklyRest([{ start: dayIndex('2026-11-07') * 1440 + 22 * 60, end: dayIndex('2026-11-08') * 1440 + 60 }], mo), false, 'Nacht in den Sonntag')
})

// ---------------------------------------------------------------- Person, Objekt, Sonn- und Feiertag

test('Abwesenheit, Qualifikation und Beschäftigungszeitraum sind Verstöße mit Begründung', () => {
  const tasks = [task('di', 'o1', [2], '08:00', '10:00', { skills: ['Glasreinigung', 'Hygienebereich'] }), task('mi', 'o1', [3], '08:00', '10:00')]
  const absences = [{ employeeId: 'x', type: 'Krankenstand', from: '2026-11-03', to: '2026-11-03' }]
  const issues = plan({ employees: [emp('x', { name: 'Eva', skills: ['Glasreinigung'], exitDate: '2026-11-03' })], tasks, absences }).issues()
  const by = (code) => issues.filter((i) => i.code === code).map((i) => [i.severity, i.message])
  assert.deepEqual(by('ABSENT'), [['error', 'Krankenstand: Eva ist an diesem Tag abwesend']])
  assert.deepEqual(by('SKILL'), [['error', 'Qualifikation fehlt: Hygienebereich']])
  assert.deepEqual(by('EMPLOYMENT'), [['error', 'Nach dem Austritt (Di 03.11.)']])
  const neu = plan({ employees: [emp('x', { entryDate: '2026-11-04' })], tasks: [task('di', 'o1', [2], '08:00', '10:00')] }).issues()
  assert.equal(neu.find((i) => i.code === 'EMPLOYMENT').message, 'Vor dem Eintritt (Mi 04.11.)')
})

test('Einschulung und Schlüssel: Warnung, bei „nur eingeschultes Personal“ Verstoß, Stammkraft gilt als eingeschult', () => {
  const objects = [{ id: 'o1', name: 'Kanzlei' }, { id: 'o2', name: 'Labor', onlyTrained: true, keys: [{ id: 'k1', label: 'Haupteingang', holderId: 'y' }] }]
  const tasks = [task('a', 'o1', [2], '08:00', '09:00'), task('b', 'o2', [3], '08:00', '09:00'), task('c', 'o2', [4], '08:00', '09:00', { regulars: ['x'] })]
  const employees = [emp('x', { trained: [] }), emp('y', { name: 'Yasmin' })]
  const issues = plan({ employees, objects, tasks }).issues()
  const trained = issues.filter((i) => i.code === 'NOT_TRAINED').map((i) => [i.keys[0], i.severity])
  assert.deepEqual(trained, [['2026-11-03|a', 'warning'], ['2026-11-04|b', 'error']])
  const keys = issues.filter((i) => i.code === 'KEY_HANDOVER')
  assert.equal(keys.length, 2)
  assert.equal(keys[0].message, 'Schlüsselübergabe nötig für Labor (Schlüssel bei Yasmin)')
  const holder = plan({ employees, objects, tasks, assignments: { '2026-11-04|b': [{ employeeId: 'y' }] } })
  assert.ok(!holder.codes('y').includes('KEY_HANDOVER'), 'hat den Schlüssel selbst')
})

test('Feiertagsarbeit: Hinweis auf Zuschlag, für Jugendliche verboten; Feiertag am Sonntag ohne ARG-Warnung', () => {
  const tasks = [task('di', 'o1', [2], '08:00', '10:00')]
  const adult = plan({ employees: [emp('x')], tasks, from: '2026-12-07', to: '2026-12-13' }).issues()
  assert.equal(adult.find((i) => i.code === 'HOLIDAY').message, 'Feiertagsarbeit (Mariä Empfängnis): Feiertagsentgelt + 100 % Zuschlag')
  assert.ok(plan({ employees: [emp('l', { minor: true })], tasks, from: '2026-12-07', to: '2026-12-13' }).codes().includes('MINOR_HOLIDAY'))
  // Allerheiligen 2026 ist ein Sonntag: Feiertag geht vor, keine fehlende Grundlage der Sonntagsarbeit
  const allerheiligen = plan({ employees: [emp('x')], tasks: [task('so', 'o1', [7], '08:00', '10:00')], from: '2026-10-26', to: '2026-11-01' }).codes()
  assert.ok(allerheiligen.includes('HOLIDAY') && !allerheiligen.includes('SUNDAY_BASIS') && !allerheiligen.includes('SUNDAY'))
  const minorSunday = plan({ employees: [emp('l', { minor: true })], tasks: [task('so', 'o1', [7], '08:00', '10:00')] }).codes()
  assert.ok(minorSunday.includes('MINOR_SUNDAY'))
})

test('Betriebsfreier Tag mit „trotzdem stattfinden“: kein Feiertagshinweis (kein gesetzlicher Feiertag)', () => {
  const p = plan({ employees: [emp('x')], tasks: [task('do', 'o1', [4], '08:00', '10:00')], from: '2026-12-21', to: '2026-12-27', extraFreeDays: [{ date: '2026-12-24', name: 'Heiliger Abend' }], overrides: { '2026-12-24|do': { work: true } } })
  const codes = p.codes()
  assert.ok(p.state.has('x', '2026-12-24|do'))
  assert.ok(!codes.includes('HOLIDAY') && !codes.includes('MINOR_HOLIDAY'))
})

test('Mehr- und Überstunden laut Vertrag: Teilzeit Mehrstunden, Vollzeit Überstunden', () => {
  const tasks = [task('t', 'o1', [1, 2, 3, 4], '08:00', '14:00'), task('fr', 'o1', [5], '08:00', '12:00')]
  const teil = plan({ employees: [emp('x', { type: 'Teilzeit', weeklyHours: 24 })], tasks }).issues().find((i) => i.code === 'CONTRACT')
  assert.equal(teil.message, '28 h geplant bei 24 h Vertrag: +4 h Mehrstunden (ggf. 25 % Zuschlag)')
  assert.equal(teil.overMinutes, 240)
  const voll = plan({ employees: [emp('x')], tasks: [task('t', 'o1', [1, 2, 3, 4, 5], '06:00', '15:18')] }).issues().find((i) => i.code === 'CONTRACT')
  assert.match(voll.message, /^44 h geplant bei 40 h Vertrag: \+4 h Überstunden$/)
  // Vertrag über 40 h gilt nur mit 40 h (gesetzliche Normalarbeitszeit)
  const capped = plan({ employees: [emp('x', { weeklyHours: 45 })], tasks: [task('t', 'o1', [1, 2, 3, 4, 5], '06:00', '15:18')] }).issues().find((i) => i.code === 'CONTRACT')
  assert.match(capped.message, /bei 40 h Vertrag/)
})

// ---------------------------------------------------------------- Regelkatalog und Gesamtprüfung

test('Eigene Regel: braucht id und check(), ersetzt gleiche id, lässt sich abschalten', () => {
  assert.throws(() => registerRule({ id: 'ohne-check' }), /Regel braucht id und check/)
  assert.throws(() => registerRule({ check() {} }), /Regel braucht id und check/)
  const before = RULES.length
  try {
    registerRule({ id: 'test-samstag', title: 'Samstag', check: ({ items, add }) => items.filter((i) => i.weekday === 6).forEach((i) => add('warning', 'SAMSTAG', 'shift', 'Samstag', [i])) })
    registerRule({ id: 'test-samstag', title: 'Samstag', check: ({ items, add }) => items.filter((i) => i.weekday === 6).forEach((i) => add('info', 'SAMSTAG2', 'shift', 'Samstag (neu)', [i])) })
    assert.equal(RULES.length, before + 1, 'gleiche id ersetzt')
    const tasks = [task('sa', 'o1', [6], '08:00', '10:00')]
    const found = plan({ employees: [emp('x')], tasks }).issues().filter((i) => i.code.startsWith('SAMSTAG'))
    assert.deepEqual(found.map((i) => [i.code, i.severity, i.keys]), [['SAMSTAG2', 'info', ['2026-11-07|sa']]])
    assert.ok(!plan({ employees: [emp('x')], tasks, rules: { disabledRules: ['test-samstag'] } }).codes().includes('SAMSTAG2'))
  } finally {
    const idx = RULES.findIndex((r) => r.id === 'test-samstag')
    if (idx >= 0) RULES.splice(idx, 1)
  }
  assert.equal(RULES.length, before)
})

test('Abgeschaltete Regel: Nachtarbeit ohne Hinweis; eingeschaltet mit Nachtminuten laut KV', () => {
  const tasks = [task('spaet', 'o1', [2], '20:00', '23:00')]
  const night = plan({ employees: [emp('x')], tasks }).issues().find((i) => i.code === 'NIGHT')
  assert.equal(night.nightMinutes, 120, '21–23 Uhr')
  assert.equal(night.severity, 'info')
  assert.ok(!plan({ employees: [emp('x')], tasks, rules: { disabledRules: ['night'] } }).codes().includes('NIGHT'))
})

test('Gesamtprüfung: unter-, über- und unbesetzte Einsätze, gelöschte Personen zählen nicht, nur der Zeitraum', () => {
  const tasks = [task('a', 'o1', [2], '08:00', '10:00', { staff: 2 }), task('b', 'o1', [3], '08:00', '10:00'), task('c', 'o1', [4], '08:00', '10:00'), task('d', 'o1', [5], '08:00', '10:00', { holidayRule: 'entfaellt' })]
  const employees = [emp('x'), emp('y', { type: 'Teilzeit', weeklyHours: 1 })]
  const assignments = { '2026-11-03|a': [{ employeeId: 'x' }], '2026-11-04|b': [{ employeeId: 'x' }, { employeeId: 'y' }], '2026-11-05|c': [{ employeeId: 'geloescht' }], '2026-11-06|d': [{ employeeId: 'x' }], '2026-11-10|a': [] }
  const p = plan({ employees, tasks, assignments, from: '2026-11-02', to: '2026-11-15', overrides: { '2026-11-13|d': { cancelled: true } } })
  const v = validatePlan(p.ctx, p.state, p.instances, { from: '2026-11-02', to: '2026-11-08' })
  const staffing = v.issues.filter((i) => i.scope === 'staffing').map((i) => [i.keys[0], i.code, i.message])
  assert.deepEqual(staffing, [
    ['2026-11-03|a', 'OPEN', 'Unterbesetzt: 1 von 2 Personen'],
    ['2026-11-05|c', 'OPEN', 'Einsatz ist nicht besetzt'],
    ['2026-11-04|b', 'OVERSTAFFED', 'Überbesetzt: 2 statt 1 Personen'],
  ])
  assert.ok(v.issues.every((i) => i.date <= '2026-11-08'), 'zweite Woche nicht im Ergebnis')
  // Reihenfolge: Verstöße vor Prüfen vor Hinweisen
  const ranks = v.issues.map((i) => ({ error: 3, warning: 2, info: 1 })[i.severity])
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a))
  assert.equal(v.counts.error + v.counts.warning + v.counts.info, v.issues.length)
  // Wochen-Markierung (Mehrstunden) gehört zur Person, nicht zum Einsatz
  assert.ok(v.byEmployee.get('y').some((i) => i.code === 'CONTRACT'))
  assert.ok(!(v.byShift.get('2026-11-04|b') || []).some((i) => i.code === 'CONTRACT'))
  assert.ok(v.byShift.get('2026-11-04|b').some((i) => i.code === 'OVERSTAFFED'))
  assert.ok(!v.issues.some((i) => i.keys.includes('2026-11-13|d')), 'abgesagter Einsatz ist nicht offen')
})

test('Feiertagsgutschrift je Person und Woche: nur gesetzliche Feiertage, Sonderleistungen nur wenn eingestellt', () => {
  const tasks = [
    task('zu', 'o1', [2], '08:00', '10:00', { holidayRule: 'entfaellt', regulars: ['x'] }),
    task('blumen', 'o1', [2], '10:00', '10:30', { holidayRule: 'entfaellt', regulars: ['x'], category: 'sonder' }),
    task('offen', 'o1', [2], '11:00', '12:00', { regulars: ['y'] }),
    task('heiligabend', 'o1', [4], '08:00', '10:00', { regulars: ['x'] }),
  ]
  const p = plan({ employees: [emp('x'), emp('y')], tasks, from: '2026-12-07', to: '2026-12-27', extraFreeDays: [{ date: '2026-12-24', name: 'Betriebsurlaub' }], assignments: {} })
  const credits = holidayCredits(p.instances, p.ctx.rules)
  assert.equal(credits.get('x|2026-12-07'), 120)
  assert.ok(!credits.has('y|2026-12-07'), 'findet statt: keine Gutschrift')
  assert.ok(!credits.has('x|2026-12-21'), 'betriebsfreier Tag ist kein gesetzlicher Feiertag')
  assert.equal(holidayCredits(p.instances, { creditSpecialTasks: true }).get('x|2026-12-07'), 150)
})

test('Höchster Schweregrad einer Liste', () => {
  assert.equal(maxSeverity([]), null)
  assert.equal(maxSeverity(), null)
  assert.equal(maxSeverity([{ severity: 'info' }, { severity: 'warning' }, { severity: 'info' }]), 'warning')
  assert.equal(maxSeverity([{ severity: 'warning' }, { severity: 'error' }, { severity: 'info' }]), 'error')
})
