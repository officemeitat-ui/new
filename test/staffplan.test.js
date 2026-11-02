import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatDate } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'
import { dayIndex } from '../src/core/dates.js'
import { hashIndex, newCode, offerOf, openRequests, openShifts, personalLink, portalEmployees, portalFile, requestText, savePayload, sha256Hex, shiftOffers, staffWeek } from '../src/core/staffplan.js'
import { buildTimesheet } from '../src/core/timesheet.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1', 'o2'], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })

test('Persönlicher Code: 20 Zeichen, gut lesbar (ohne 0, O, 1, l, I), zufällig', () => {
  const codes = new Set(Array.from({ length: 300 }, () => newCode()))
  assert.equal(codes.size, 300)
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Za-km-z2-9]{20}$/)
  // Zufallsbytes ab 228 werden verworfen (gleich verteilt), dann wird nachgezogen
  let n = 0
  const code = newCode((len) => Uint8Array.from({ length: len }, () => (n++ < 30 ? 255 : 0)))
  assert.equal(code, 'AAAAAAAAAAAAAAAAAAAA')
})

test('Link und Hashwert wie am Webspace (SHA-256 des Codes)', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(personalLink('https://app.cleanos.at', 'Ab3'), 'https://app.cleanos.at/mein-plan.php?p=Ab3')
  assert.equal(personalLink('https://app.cleanos.at/', 'Ab3'), 'https://app.cleanos.at/mein-plan.php?p=Ab3')
})

test('Wer einen Plan bekommt: mit Code und in dieser Woche beschäftigt', () => {
  const employees = [emp('a'), emp('b'), emp('c', { exitDate: '2026-11-01' }), emp('d', { entryDate: '2026-11-08' })]
  const codes = { a: 'x', c: 'y', d: 'z' }
  assert.deepEqual(portalEmployees(employees, codes, '2026-11-02').map((e) => e.id), ['a', 'd'], 'Austritt vor der Woche, Eintritt am Sonntag zählt')
})

test('Woche fürs Handy: Feiertag, entfallener Stammeinsatz, Einsätze mit Adresse und Fahrt, Urlaub, Stunden', () => {
  const objects = [{ id: 'o1', name: 'Wohnanlage Lehen', address: 'Ignaz-Harrer-Straße 10, 5020 Salzburg' }, { id: 'o2', name: 'Bank Hallein', address: 'Bayrhamerplatz 1, 5400 Hallein' }]
  const tasks = [task('Stiege', 'o1', [1, 2], '08:00', '10:00', { regulars: ['x'] }), task('Büro', 'o2', [2], '10:30', '12:00')]
  const data = { employees: [emp('x', { name: 'Anna Berger' })], objects, tasks, absences: [{ id: 'a1', employeeId: 'x', type: 'Urlaub', from: '2026-10-29', to: '2026-10-29' }], rules: { travelDefaultMin: 20 }, overrides: {} }
  const holidays = holidayCalendar('2026-10-19', '2026-11-08')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-19', '2026-11-08', holidays, ctx.rules)
  const state = new PlanState(instances, { '2026-10-27|Stiege': [{ employeeId: 'x' }], '2026-10-27|Büro': [{ employeeId: 'x' }] })
  const ts = buildTimesheet(ctx, ctx.employees[0], '2026-10-26', instances, state)
  const w = staffWeek(ts, { objectsById: new Map(objects.map((o) => [o.id, o])), account: -95 })
  assert.equal(w.kw, 44)
  assert.equal(w.von, '2026-10-26')
  assert.equal(w.bis, '2026-11-01')
  assert.equal(w.tage.length, 7)
  const [mo, di, , dn, , , so] = w.tage
  assert.equal(mo.feiertag, 'Nationalfeiertag')
  assert.equal(mo.eintraege.length, 1)
  assert.equal(mo.eintraege[0].entfaellt, true)
  assert.equal(mo.eintraege[0].objekt, 'Wohnanlage Lehen')
  assert.ok(mo.eintraege[0].notizen.some((n) => /entfällt: Nationalfeiertag/.test(n)), mo.eintraege[0].notizen.join())
  assert.deepEqual(di.eintraege.map((e) => [e.zeit, e.objekt, e.leistung, e.adresse]), [
    ['08:00–10:00', 'Wohnanlage Lehen', 'Stiege', 'Ignaz-Harrer-Straße 10, 5020 Salzburg'],
    ['10:30–12:00', 'Bank Hallein', 'Büro', 'Bayrhamerplatz 1, 5400 Hallein'],
  ])
  const fahrt = ts.days[1].lines[0].travel
  assert.ok(fahrt > 0)
  assert.ok(di.eintraege[0].notizen.includes(`danach ${fahrt} min Fahrt zu Bank Hallein`), di.eintraege[0].notizen.join())
  assert.equal(di.eintraege[1].entfaellt, undefined)
  assert.equal(dn.abwesend, 'Urlaub')
  assert.equal(so.feiertag, 'Allerheiligen')
  assert.deepEqual(w.summe, { ist: ts.totals.ist, soll: ts.totals.soll })
  assert.equal(w.summe.ist, 120 + 120 + 90 + fahrt, 'Feiertag angerechnet, zwei Einsätze, Fahrt')
  assert.equal(w.konto, -95)
  assert.ok(!JSON.stringify(w).includes('wage') && !JSON.stringify(w).includes('hourlyWage'), 'keine Lohndaten')
})

test('Übertragung: Personen einmal, Wochen je Hash und Montag', () => {
  const p = savePayload([
    { hash: 'h1', name: 'Anna', ntfy: 'mp-a', monday: '2026-11-02', week: { kw: 45 } },
    { hash: 'h1', name: 'Anna', ntfy: 'mp-a', monday: '2026-11-09', week: { kw: 46 } },
    { hash: 'h2', name: 'Bernd', monday: '2026-11-02', week: { kw: 45 } },
  ])
  assert.deepEqual(p.personen, [{ hash: 'h1', name: 'Anna', ntfy: 'mp-a' }, { hash: 'h2', name: 'Bernd', ntfy: '' }])
  assert.deepEqual(Object.keys(p.wochen.h1), ['2026-11-02', '2026-11-09'])
  assert.equal(p.wochen.h2['2026-11-02'].kw, 45)
})

test('Einstellungen für den Webspace: Büro-Handy und gültige E-Mails, ohne Codes', () => {
  const f = portalFile({ portal: { key: 'k'.repeat(64), codes: { a: 'GEHEIM' }, officeTopic: 'mp-buero', officeEmails: 'office@cleanos.example, kein-mail; lohn@cleanos.example', sender: 'dienstplan@cleanos.example' }, address: 'https://app.cleanos.at/', ntfy: 'https://ntfy.sh', employees: [{ name: 'Lisa Lohn', email: 'lohn@cleanos.example' }] })
  assert.deepEqual(f, { version: 1, schluessel: 'k'.repeat(64), adresse: 'https://app.cleanos.at/', ntfy: 'https://ntfy.sh', absender: 'dienstplan@cleanos.example', buero: [{ name: 'Büro-Handy', ntfy: 'mp-buero' }, { name: 'Büro', email: 'office@cleanos.example' }, { name: 'Lisa Lohn', email: 'lohn@cleanos.example' }] })
  assert.ok(!JSON.stringify(f).includes('GEHEIM'))
})

test('Anträge: nur offene und gültige, Person auch über ersetzten Link, älteste zuerst, Text', async () => {
  const index = await hashIndex({ codes: { e1: 'CodeAnna' }, oldHashes: { alt: 'e2' } })
  const anna = await sha256Hex('CodeAnna')
  const list = openRequests([
    { id: '1', hash: anna, art: 'Urlaub', von: '2026-12-21', bis: '2026-12-31', status: 'offen', erstellt: 20 },
    { id: '2', hash: 'alt', art: 'Krankenstand', von: '2026-11-02', bis: '2026-11-04', status: 'offen', erstellt: 10 },
    { id: '3', hash: 'fremd', art: 'Zeitausgleich', von: '2026-11-06', bis: '2026-11-06', status: 'offen', erstellt: 30 },
    { id: '4', hash: anna, art: 'Urlaub', von: '2026-11-10', bis: '2026-11-10', status: 'genehmigt', erstellt: 5 },
    { id: '5', hash: anna, art: 'Gehalt', von: '2026-11-10', bis: '2026-11-10', status: 'offen', erstellt: 6 },
  ], index)
  assert.deepEqual(list.map((a) => [a.id, a.employeeId]), [['2', 'e2'], ['1', 'e1'], ['3', null]])
  assert.equal(requestText(list[0], formatDate), 'Krankmeldung ab Mo 02.11., voraussichtlich bis Mi 04.11.')
  assert.equal(requestText({ art: 'Krankenstand', von: '2026-11-02', bis: '2026-11-02' }, formatDate), 'Krankmeldung ab Mo 02.11.')
  assert.equal(requestText(list[1], formatDate), 'Urlaub Mo 21.12. – Do 31.12.')
  assert.equal(requestText(list[2], formatDate), 'Zeitausgleich Fr 06.11.')
})

test('Einsatzbörse: offene Einsätze nur an Personen, die sie laut Regeln übernehmen dürfen', () => {
  const objects = [{ id: 'o1', name: 'Wohnanlage Rif', address: 'Rif 3, 5400 Hallein' }, { id: 'o2', name: 'Labor', address: 'Laborweg 1', onlyTrained: true }]
  const tasks = [task('Stiege', 'o1', [2], '08:00', '10:00'), task('Labor', 'o2', [2], '10:30', '12:00'), task('Früh', 'o1', [3], '06:00', '07:00'), task('Spät', 'o1', [2], '09:00', '11:00', { staff: 2 })]
  const employees = [emp('x', { name: 'Anna' }), emp('y', { name: 'Bernd' }), emp('z', { name: 'Clara', trained: ['o1'] })]
  const data = { employees, objects, tasks, absences: [{ id: 'a1', employeeId: 'y', type: 'Urlaub', from: '2026-11-03', to: '2026-11-03' }], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-10-26', '2026-11-15')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-26', '2026-11-15', holidays, ctx.rules)
  const state = new PlanState(instances, { '2026-11-03|Stiege': [{ employeeId: 'x' }], '2026-11-03|Spät': [{ employeeId: 'z' }] })
  const week = { from: '2026-11-02', to: '2026-11-08' }
  assert.deepEqual(openShifts(instances, state, week).map((i) => i.key), ['2026-11-03|Spät', '2026-11-03|Labor', '2026-11-04|Früh'], 'besetzte nicht, „Spät“ braucht noch eine Person')
  const notBefore = dayIndex('2026-11-03') * 1440 + 10 * 60
  assert.deepEqual(openShifts(instances, state, { ...week, notBefore }).map((i) => i.key), ['2026-11-03|Labor', '2026-11-04|Früh'], 'schon begonnene nicht')
  const offers = shiftOffers({ ctx, state, instances, ...week, employees: ctx.employees, objectsById: new Map(objects.map((o) => [o.id, o])) })
  const ids = (id) => (offers.get(id) || []).map((o) => o.id)
  assert.deepEqual(ids('x'), ['2026-11-03|Labor', '2026-11-04|Früh'], 'Anna: nicht „Spät“ (überschneidet Stiege)')
  assert.deepEqual(ids('y'), ['2026-11-04|Früh'], 'Bernd: am Dienstag Urlaub')
  assert.deepEqual(ids('z'), ['2026-11-04|Früh'], 'Clara: im Labor nicht eingeschult, in „Spät“ schon eingeteilt')
  assert.deepEqual(offers.get('x')[0], { id: '2026-11-03|Labor', datum: '2026-11-03', zeit: '10:30–12:00', objekt: 'Labor', leistung: 'Labor', adresse: 'Laborweg 1', minuten: 90 })
  assert.equal(shiftOffers({ ctx, state, instances, ...week, employees: ctx.employees, max: 1 }).get('x').length, 1, 'höchstens max je Person')
  assert.equal(offerOf({ key: 'k', date: '2026-11-03', startTime: '06:00', endTime: '07:00', objectId: 'weg', label: '', net: 60 }).objekt, 'Objekt')
})

test('Einsatzbörse: Meldung „Ich übernehme“ als Antrag mit Einsatz', async () => {
  const anna = await sha256Hex('CodeAnna')
  const list = openRequests([
    { id: '1', hash: anna, art: 'Einsatz', von: '2026-11-03', bis: '2026-11-03', einsatz: '2026-11-03|Labor', text: '10:30–12:00 Labor', status: 'offen', erstellt: 1 },
    { id: '2', hash: anna, art: 'Einsatz', von: '2026-11-03', bis: '2026-11-03', einsatz: '2026-11-04|Früh', status: 'offen', erstellt: 2 },
    { id: '3', hash: anna, art: 'Einsatz', von: '2026-11-03', bis: '2026-11-03', status: 'offen', erstellt: 3 },
  ], await hashIndex({ codes: { e1: 'CodeAnna' } }))
  assert.deepEqual(list.map((a) => [a.id, a.employeeId]), [['1', 'e1']], 'Einsatz muss zum Tag passen')
  assert.equal(requestText(list[0], formatDate), 'übernimmt Einsatz Di 03.11. 10:30–12:00 Labor')
})
