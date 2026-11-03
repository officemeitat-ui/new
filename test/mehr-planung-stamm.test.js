import { test } from 'node:test'
import assert from 'node:assert/strict'

import { conflictsWith, evaluateRegular, openSlots, rankRegulars, regularLoad, suggestRegulars, taskDays, taskNet, taskSpan, weeklyMinutes, whenText } from '../src/core/assign.js'
import { changeWeeklyHours, drMaxWeeks, drPeriod, employedInWeek, employedOn, sollMinutes, weeklyHoursAt } from '../src/core/contract.js'
import { eachDay, formatDate } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, mergeRules } from '../src/core/rules.js'
import { newCode, openRequests, openShifts, personalLink, portalFile, requestText, staffWeek } from '../src/core/staffplan.js'

const avail = (days, from = '06:00', to = '20:00') => Object.fromEntries(days.map((d) => [d, { from, to }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Teilzeit', weeklyHours: 20, team: 'Stadt', skills: [], trained: [], availability: avail([1, 2, 3, 4, 5]), ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays, everyWeeks: 1, anchor: '2026-11-02' }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })
const objects = [{ id: 'o1', name: 'Kanzlei Schallmoos', short: 'Kanzlei', region: 'Stadt' }, { id: 'o2', name: 'Büro Gnigl', short: 'Gnigl', region: 'Stadt' }, { id: 'o3', name: 'Labor Wals', short: 'Labor', region: 'Land', onlyTrained: true }]
const rules = mergeRules({})

function ctxFor(employees, tasks, extra = {}) {
  const data = { employees, objects, tasks, absences: [], rules: {}, travel: { 'o1|o2': 15 }, trips: {}, ...extra }
  return { ...createContext(data, holidayCalendar('2026-11-01', '2026-12-31')), tasks }
}

// ---------------------------------------------------------------- Stammplan

test('Stammplan: Zeitspanne, Nettodauer nach Pause und mögliche Wochentage einer Leistung', () => {
  assert.deepEqual(taskSpan({ start: '22:00', end: '02:00' }), { start: 1320, end: 1560 })
  assert.deepEqual(taskSpan({ start: '08:00', end: '08:00' }), { start: 480, end: 1920 }, 'gleiche Zeit = 24 h')
  assert.equal(taskNet({ start: '08:00', end: '15:00' }, rules), 390)
  assert.equal(taskNet({ start: '08:00', end: '15:00', breakMin: 45 }, rules), 375)
  assert.equal(taskNet({ start: '08:00', end: '12:00', breakMin: 15 }, rules), 225)
  assert.deepEqual(taskDays(task('w', 'o1', [1, 3], '08:00', '09:00')), [1, 3])
  assert.deepEqual(taskDays({ recurrence: { type: 'monthly', mode: 'nth', nth: 1, weekday: 6 } }), [6])
  assert.deepEqual(taskDays({ recurrence: { type: 'monthly', mode: 'day', day: 15 } }), [], 'fester Monatstag: Wochentag unbestimmt')
  assert.deepEqual(taskDays({ recurrence: { type: 'once', date: '2026-11-05' } }), [4])
  assert.deepEqual(taskDays({ recurrence: { type: 'once' } }), [])
})

test('Stammplan: Wochenstunden bei „alle 3 Wochen“ und quartalsweise', () => {
  assert.equal(weeklyMinutes(task('a', 'o1', [2, 4], '08:00', '10:00', { recurrence: { type: 'weekly', weekdays: [2, 4], everyWeeks: 3 } }), rules), 80)
  const q = weeklyMinutes({ start: '17:00', end: '20:00', recurrence: { type: 'monthly', mode: 'nth', nth: 2, weekday: 5, everyMonths: 3 } }, rules)
  assert.equal(Math.round(q * 1000) / 1000, 13.846, '3 h × 4 im Jahr ÷ 52 Wochen')
})

test('Stammplan-Konflikte: gleiches Objekt ohne Fahrzeit, anderes Objekt zu knapp, Einmaliges zählt nicht', () => {
  const ctx = ctxFor([], [])
  const mo = task('mo', 'o1', [1], '08:00', '10:00')
  assert.deepEqual(conflictsWith(ctx, mo, [task('gleich', 'o1', [1], '10:00', '11:00')]), [], 'direkt danach im selben Objekt')
  const knapp = conflictsWith(ctx, mo, [task('gnigl', 'o2', [1, 3], '10:10', '11:00')])
  assert.deepEqual(knapp.map((c) => [c.task.id, c.kind, c.travel, c.days]), [['gnigl', 'travel', 15, [1]]])
  assert.equal(conflictsWith(ctx, mo, [task('davor', 'o2', [1], '07:00', '07:50')])[0].kind, 'travel', 'auch davor zu knapp')
  assert.deepEqual(conflictsWith(ctx, mo, [task('di', 'o1', [2], '08:00', '10:00')]), [], 'anderer Tag')
  assert.deepEqual(conflictsWith(ctx, mo, [{ ...task('einmal', 'o1', [], '08:00', '10:00'), recurrence: { type: 'once', date: '2026-11-02' } }]), [])
  const samstag = task('sa', 'o1', [6], '08:00', '12:00')
  const monatlich = { ...task('gr', 'o1', [], '09:00', '13:00'), recurrence: { type: 'monthly', mode: 'nth', nth: 1, weekday: 6 } }
  assert.equal(conflictsWith(ctx, samstag, [monatlich])[0].kind, 'overlap', 'monatlich am 1. Samstag trifft die wöchentliche Samstagsleistung')
})

test('Stammplan: Auslastung je Person aus allen Stammeinsätzen', () => {
  const tasks = [task('t1', 'o1', [1, 2, 3, 4, 5], '08:00', '10:00', { regulars: ['ana'] }), task('t2', 'o2', [4], '13:00', '15:00', { regulars: ['ana', 'geloescht'], recurrence: { type: 'weekly', weekdays: [4], everyWeeks: 2 } }), { ...task('t3', 'o1', [], '08:00', '12:00', { regulars: ['ben'] }), recurrence: { type: 'once', date: '2026-11-05' } }]
  const load = regularLoad(ctxFor([emp('ana'), emp('ben')], tasks), tasks)
  assert.deepEqual([load.get('ana').minutes, load.get('ana').tasks.map((t) => t.id)], [660, ['t1', 't2']])
  assert.deepEqual([load.get('ben').minutes, load.get('ben').tasks.map((t) => t.id)], [0, ['t3']])
  assert.ok(!load.has('geloescht'))
})

test('Stammplan: offene Plätze und Kurztext der Zeiten', () => {
  assert.equal(openSlots({ staff: 2, regulars: ['a'] }), 1)
  assert.equal(openSlots({ staff: 1, regulars: ['a', 'b'] }), 0)
  assert.equal(openSlots({}), 1)
  assert.equal(whenText(task('t', 'o1', [1, 3, 5], '17:30', '19:30')), 'Mo, Mi, Fr 17:30–19:30')
})

test('Stammkraft-Vorschlag: knapper Vertrag und Überstunden über 40 h sprechen dagegen', () => {
  const vz = emp('vz', { type: 'Vollzeit', weeklyHours: 40, availability: avail([1, 2, 3, 4, 5, 6], '06:00', '22:00') })
  const tasks = [task('frueh', 'o1', [1, 2, 3, 4, 5], '06:00', '12:00', { regulars: ['vz'] }), task('mittag', 'o1', [1, 2, 3, 4, 5], '12:30', '14:18', { regulars: ['vz'] })]
  const ctx = ctxFor([vz], tasks)
  const ev = evaluateRegular(ctx, task('sa', 'o2', [6], '08:00', '11:00'), vz)
  assert.equal(ev.allowed, true, ev.blockers.join(' | '))
  assert.deepEqual([ev.after, ev.minutes], [2520, 180])
  const f = Object.fromEntries(ev.factors.map((x) => [x.code, x]))
  assert.deepEqual([f.load.text, f.load.good], ['nur 1 h/Woche frei', false])
  assert.deepEqual([f.overtime.points, f.overtime.text], [40, 'dann 42 h/Woche: Überstunden'])
  assert.deepEqual([f.region.points, f.region.text], [-5, 'gleiches Revier'])
})

test('Stammkraft-Vorschlag für Jugendliche: bis 20:00 möglich, danach und vor 06:00 gesperrt', () => {
  const lehr = emp('lehr', { minor: true, availability: avail([1, 2, 3, 4, 5], '05:00', '22:00') })
  const ctx = ctxFor([lehr], [])
  assert.equal(evaluateRegular(ctx, task('a', 'o1', [2], '18:00', '20:00'), lehr).allowed, true)
  assert.equal(evaluateRegular(ctx, task('b', 'o1', [2], '06:00', '08:00'), lehr).allowed, true)
  for (const [start, end] of [['18:00', '20:15'], ['05:45', '08:00']]) {
    const ev = evaluateRegular(ctx, task('x', 'o1', [2], start, end), lehr)
    assert.ok(ev.blockers.includes('unter 18: Nachtruhe 20:00–06:00'), `${start}–${end}`)
  }
})

test('Stammkraft-Vorschlag: fehlende Einschulung ist nur ein Faktor, kein Ausschluss', () => {
  const ctx = ctxFor([emp('neu'), emp('alt', { trained: ['o3'] })], [])
  const labor = task('l', 'o3', [3], '08:00', '10:00')
  const neu = evaluateRegular(ctx, labor, ctx.employeesById.get('neu'))
  assert.equal(neu.allowed, true, neu.blockers.join(' | '))
  assert.deepEqual(neu.factors.filter((f) => f.code !== 'load').map((f) => [f.code, f.points, f.text]), [['region', 30, 'anderes Revier (Stadt)'], ['trained', 25, 'nicht eingeschult']])
  const alt = evaluateRegular(ctx, labor, ctx.employeesById.get('alt'))
  assert.deepEqual(alt.factors.find((f) => f.code === 'trained'), { code: 'trained', points: -8, text: 'im Objekt eingeschult', good: true })
  assert.ok(alt.cost < neu.cost)
})

test('Stammkraft-Rangliste: ohne vorhandene Stammkräfte, gesperrte zuletzt; Vorschläge nur für offene Plätze', () => {
  const tasks = [task('zwei', 'o1', [2], '08:00', '10:00', { staff: 2, regulars: ['ana'] })]
  const ctx = ctxFor([emp('ana'), emp('ben'), emp('cem', { availability: {} })], tasks)
  const ranked = rankRegulars(ctx, tasks[0])
  assert.deepEqual(ranked.map((r) => [r.emp.id, r.allowed]), [['ben', true], ['cem', false]])
  const more = [...tasks, task('voll', 'o2', [4], '08:00', '10:00', { regulars: ['ana'] }), { ...task('einmal', 'o2', [], '08:00', '10:00'), recurrence: { type: 'once', date: '2026-11-05' } }]
  const out = suggestRegulars(ctxFor([emp('ana'), emp('ben')], more))
  assert.deepEqual(out.map((s) => [s.task.id, s.emp.id]), [['zwei', 'ben']])
})

// ---------------------------------------------------------------- Mein Dienstplan

test('Woche fürs Handy: Termine ganztags über mehrere Tage, mit Uhrzeit nur am Beginntag', () => {
  const monday = '2026-11-02'
  const ts = { monday, days: eachDay(monday, '2026-11-08').map((date) => ({ date, lines: [], holiday: null, absence: null })), totals: { ist: 0, soll: 1200 } }
  const appointments = [
    { id: 't1', title: 'Schulung Reinigungsmittel', start: '2026-11-04T09:00', end: '2026-11-04T11:30', where: 'Büro Gnigl' },
    { id: 't2', title: 'Betriebsausflug', allDay: true, start: '2026-11-05', end: '2026-11-06' },
    { id: 't3', title: 'Nachtbegehung', start: '2026-11-07T23:00', end: '2026-11-08T01:00' },
    { id: 't4', title: 'andere Woche', start: '2026-11-12T08:00', end: '2026-11-12T09:00' },
  ]
  const w = staffWeek(ts, { appointments })
  const t = Object.fromEntries(w.tage.map((d) => [d.datum, d.termine]))
  assert.deepEqual(t['2026-11-04'], [{ id: 't1', titel: 'Schulung Reinigungsmittel', beginn: '09:00', zeit: '09:00–11:30', ort: 'Büro Gnigl' }])
  assert.deepEqual(t['2026-11-05'], [{ id: 't2', titel: 'Betriebsausflug', ganztags: true }])
  assert.deepEqual(t['2026-11-06'], t['2026-11-05'])
  assert.deepEqual(t['2026-11-07'], [{ id: 't3', titel: 'Nachtbegehung', beginn: '23:00', zeit: '23:00–01:00' }])
  assert.equal(t['2026-11-08'], undefined)
  assert.equal(t['2026-11-02'], undefined)
  assert.deepEqual([w.kw, w.von, w.bis, w.konto, w.summe], [45, '2026-11-02', '2026-11-08', null, { ist: 0, soll: 1200 }])
})

test('Woche fürs Handy: Einträge mit Objekt, Fahrt zum unbekannten Folgeobjekt, entfallener Einsatz ohne Objekt', () => {
  const monday = '2026-11-02'
  const days = eachDay(monday, '2026-11-08').map((date) => ({ date, lines: [], holiday: null, absence: null }))
  days[1].lines.push(
    { kind: 'work', inst: { key: '2026-11-03|a', objectId: 'o1', startTime: '08:00', label: 'Stiege' }, time: '08:00 - 10:00', text: 'Objekt: Wohnanlage Taxham – Stiege', travel: 20, trip: { to: { objectId: 'weg' } }, notes: ['Vertretung für Anna'] },
    { kind: 'missed', inst: { key: '2026-11-03|b', objectId: 'zz', startTime: '12:00', label: '' }, time: '12:00 - 13:00', text: 'Objekt: Altbau Itzling – Fenster', travel: 0, notes: [] },
  )
  const w = staffWeek({ monday, days, totals: { ist: 120, soll: 0 } }, { objectsById: new Map([['o1', { id: 'o1', name: 'Wohnanlage Taxham', address: 'Musterweg 4, 5020 Salzburg' }]]), account: 30 })
  assert.deepEqual(w.tage[1].eintraege, [
    { id: '2026-11-03|a', objektId: 'o1', beginn: '08:00', zeit: '08:00–10:00', objekt: 'Wohnanlage Taxham', leistung: 'Stiege', adresse: 'Musterweg 4, 5020 Salzburg', notizen: ['Vertretung für Anna', 'danach 20 min Fahrt zu nächstem Einsatz'] },
    { id: '2026-11-03|b', objektId: 'zz', beginn: '12:00', zeit: '12:00–13:00', objekt: 'Altbau Itzling', leistung: '', adresse: '', notizen: [], entfaellt: true },
  ])
  assert.equal(w.konto, 30)
})

test('Persönlicher Link: Code wird für die Adresse kodiert', () => {
  assert.equal(personalLink('https://cleanos.example/app', 'a b+c/ä'), 'https://cleanos.example/app/mein-plan.php?p=a%20b%2Bc%2F%C3%A4')
})

test('Persönlicher Code: Zeichen aus dem lesbaren Alphabet, Bytes ab 228 verworfen', () => {
  assert.equal(newCode((n) => Uint8Array.from({ length: n }, (_, i) => i + 20)), 'WXYZabcdefghijkmnopq')
  assert.equal(newCode((n) => Uint8Array.from({ length: n }, (_, i) => (i % 2 ? 227 : 228))), '9'.repeat(20))
})

test('Webspace-Einstellungen mit Zeiterfassung: Codes nur für bekannte Objekte, Alarmminuten gerundet', () => {
  const objs = [{ id: 'o1', name: 'Wohnanlage Taxham' }]
  const file = portalFile({ portal: { key: 'k', timeclock: true, alarmMin: '12.6', cronKey: 'ck', objectTokens: { o1: 'tok1', weg: 'tok2' }, officeEmails: 'kein-mail' }, address: 'https://cleanos.example/', ntfy: 'https://ntfy.example', objects: objs })
  assert.deepEqual(file.zeiterfassung, { alarmMinuten: 13, pruefschluessel: 'ck', objekte: { tok1: { id: 'o1', name: 'Wohnanlage Taxham' } } })
  assert.deepEqual([file.buero, file.absender], [[], ''])
  assert.equal(portalFile({ portal: { timeclock: true, alarmMin: -5 }, objects: [] }).zeiterfassung.alarmMinuten, 0)
  assert.equal(portalFile({ portal: { timeclock: true, alarmMin: 'abc' }, objects: [] }).zeiterfassung.alarmMinuten, 0)
  assert.ok(!('zeiterfassung' in portalFile({ portal: { timeclock: false }, objects: objs })))
})

test('Anträge und Meldungen: Material, Pflegefreistellung, ungültige Daten werden verworfen', () => {
  assert.equal(requestText({ art: 'Material', text: 'Mikrofasertücher', notiz: 'Lager leer' }, formatDate), 'meldet fehlendes Material (Mikrofasertücher): Lager leer')
  assert.equal(requestText({ art: 'Material' }, formatDate), 'meldet fehlendes Material')
  assert.equal(requestText({ art: 'Pflegefreistellung', von: '2026-11-04', bis: '2026-11-04' }, formatDate), 'Pflegefreistellung Mi 04.11.')
  assert.equal(requestText({ art: 'Einsatz', von: '2026-11-03' }, formatDate), 'übernimmt Einsatz Di 03.11.')
  const index = new Map([['h1', 'e1']])
  const list = openRequests([
    { id: '1', hash: 'h1', art: 'Urlaub', von: '4.11.2026', bis: '2026-11-05', status: 'offen', erstellt: 1 },
    { id: '2', hash: 'h9', art: 'Material', von: '2026-11-04', bis: '2026-11-04', status: 'offen', erstellt: 3 },
    { id: '3', hash: 'h1', art: 'Abgabe', von: '2026-11-04', bis: '2026-11-04', einsatz: '2026-11-05|x', status: 'offen', erstellt: 2 },
    { id: '4', hash: 'h1', art: 'Pflegefreistellung', von: '2026-11-04', bis: '2026-11-04', status: 'offen', erstellt: 2 },
  ], index)
  assert.deepEqual(list.map((a) => [a.id, a.employeeId]), [['4', 'e1'], ['2', null]])
  assert.deepEqual(openRequests(null, index), [])
})

test('Einsatzbörse: abgesagte nicht, unterbesetzte und angebotene schon, nach Beginn sortiert', () => {
  const tasks = [task('spaet', 'o1', [2], '17:00', '19:00'), task('frueh', 'o1', [2], '06:00', '08:00', { staff: 2 }), task('ab', 'o1', [3], '08:00', '10:00'), task('weg', 'o1', [4], '08:00', '10:00'), task('nw', 'o1', [2], '08:00', '10:00')]
  const data = { objects, tasks, overrides: { '2026-11-05|weg': { cancelled: true } } }
  const holidays = holidayCalendar('2026-11-01', '2026-11-30')
  const instances = buildInstances(data, '2026-11-02', '2026-11-15', holidays, rules)
  const state = new PlanState(instances, { '2026-11-03|frueh': [{ employeeId: 'a' }], '2026-11-04|ab': [{ employeeId: 'b', offered: true }], '2026-11-03|nw': [{ employeeId: 'c' }] })
  assert.deepEqual(openShifts(instances, state, { from: '2026-11-02', to: '2026-11-08' }).map((i) => i.key), ['2026-11-03|frueh', '2026-11-03|spaet', '2026-11-04|ab'])
})

// ---------------------------------------------------------------- Vertrag

test('Vertrag: Wochenstunden mit unsortiertem Verlauf, höchstens 40 h (§ 3 AZG)', () => {
  const e = { weeklyHours: 45, hoursHistory: [{ from: '2026-09-01', weeklyHours: 30 }, { from: '2026-03-01', weeklyHours: 20 }] }
  assert.deepEqual(['2026-01-15', '2026-03-01', '2026-08-31', '2026-09-01', '2026-12-01'].map((d) => weeklyHoursAt(e, d)), [40, 20, 20, 30, 30])
  assert.equal(weeklyHoursAt({}, '2026-11-02'), 0)
  assert.equal(weeklyHoursAt({ weeklyHours: '25' }, '2026-11-02'), 25)
})

test('Durchrechnung (KV): lückenlose Zeiträume ab dem Montag des Beginns, nur Vollzeit', () => {
  const vz = { type: 'Vollzeit', durchrechnung: { start: '2026-11-04', weeks: 4 } }
  assert.equal(drPeriod(vz, '2026-11-01'), null, 'vor dem Beginn')
  assert.deepEqual(drPeriod(vz, '2026-11-02'), { start: '2026-11-02', end: '2026-11-29', weeks: 4 })
  assert.deepEqual(drPeriod(vz, '2026-11-30'), { start: '2026-11-30', end: '2026-12-27', weeks: 4 })
  assert.deepEqual(drPeriod(vz, '2027-01-24'), { start: '2026-12-28', end: '2027-01-24', weeks: 4 })
  assert.equal(drPeriod({ ...vz, durchrechnung: { start: '2026-11-02', weeks: 4.4 } }, '2026-11-30').weeks, 4)
  assert.equal(drPeriod({ ...vz, type: 'Teilzeit' }, '2026-11-10'), null)
  assert.equal(drPeriod({ ...vz, durchrechnung: { start: '2026-11-02', weeks: 0 } }, '2026-11-10'), null)
  assert.equal(drPeriod(null, '2026-11-10'), null)
  assert.deepEqual([drMaxWeeks({ wageGroup: 2 }), drMaxWeeks({ wageGroup: '2' }), drMaxWeeks({ wageGroup: 4 }), drMaxWeeks({}), drMaxWeeks(null)], [52, 52, 26, 26, 26])
})

test('Soll: Austritt in der Woche, Stundenänderung mitten in der Woche, Feiertage zählen mit', () => {
  assert.equal(sollMinutes({ weeklyHours: 25, exitDate: '2026-11-04' }, '2026-11-02', '2026-11-08'), 900)
  const changed = { weeklyHours: 30, hoursHistory: [{ from: '0000-01-01', weeklyHours: 20 }, { from: '2026-11-04', weeklyHours: 30 }] }
  assert.equal(sollMinutes(changed, '2026-11-02', '2026-11-08'), 2 * 240 + 3 * 360)
  assert.equal(sollMinutes({ weeklyHours: 40 }, '2026-11-07', '2026-11-08'), 0, 'Wochenende')
  assert.equal(sollMinutes({ weeklyHours: 40 }, '2026-12-01', '2026-12-31'), 23 * 480, 'Dezember 2026: 23 Werktage inkl. 8.12. und 25.12.')
})

test('Vertrag ändern: ohne Verlauf bleibt der alte Stand, spätere Einträge werden ersetzt', () => {
  const alt = { id: 'e1', weeklyHours: 20 }
  const neu = changeWeeklyHours(alt, 30, '2026-11-02')
  assert.deepEqual(neu.hoursHistory, [{ from: '0000-01-01', weeklyHours: 20 }, { from: '2026-11-02', weeklyHours: 30 }])
  assert.deepEqual([neu.weeklyHours, alt.weeklyHours, alt.hoursHistory], [30, 20, undefined])
  const mit = { weeklyHours: 35, hoursHistory: [{ from: '0000-01-01', weeklyHours: 20 }, { from: '2026-06-01', weeklyHours: 25 }, { from: '2026-12-01', weeklyHours: 35 }] }
  assert.deepEqual(changeWeeklyHours(mit, 30, '2026-09-01').hoursHistory.map((h) => [h.from, h.weeklyHours]), [['0000-01-01', 20], ['2026-06-01', 25], ['2026-09-01', 30]])
})

test('Beschäftigt: Eintritt und letzter Arbeitstag einschließlich, Woche mit einem Tag zählt', () => {
  const e = { entryDate: '2026-11-08', exitDate: '2026-12-01' }
  assert.deepEqual(['2026-11-07', '2026-11-08', '2026-12-01', '2026-12-02'].map((d) => employedOn(e, d)), [false, true, true, false])
  assert.deepEqual(['2026-10-26', '2026-11-02', '2026-11-30', '2026-12-07'].map((m) => employedInWeek(e, m)), [false, true, true, false])
  assert.ok(employedOn({}, '1999-01-01'))
})
