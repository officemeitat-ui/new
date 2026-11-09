import { test } from 'node:test'
import assert from 'node:assert/strict'

import { answer, dataExamples, findObjects, findPeople, parseWhen, rangeFor, understand } from '../src/help/brain.js'
import { holidaysInRange, holidayCalendar } from '../src/core/holidays.js'
import { addDays } from '../src/core/dates.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, findAbsence, mergeRules } from '../src/core/rules.js'

const TODAY = '2026-11-04' // Mittwoch
const EMPS = [
  { id: 'e1', name: 'Anna Huber', phone: '+43 660 1234567', email: 'anna@example.at', weeklyHours: 20, skills: [], availability: {} },
  { id: 'e2', name: 'Ben Berger', phone: '', email: '', skills: [], availability: {} },
  { id: 'e3', name: 'Anna Moser', skills: [], availability: {} },
  { id: 'e4', name: 'Clara Morgenstern', skills: [], availability: {} },
]
const OBJS = [{ id: 'o1', name: 'Bürohaus Itzling' }, { id: 'o2', name: 'Praxis Aigen', short: 'PA' }, { id: 'o3', name: 'Spar Lehen' }]
const env = (extra = {}) => ({ today: TODAY, employees: EMPS, objects: OBJS, ...extra })

test('Datum: heute, morgen, Wochentage, Datum, Woche, Wochenende, bis', () => {
  assert.deepEqual(parseWhen('wer arbeitet heute', TODAY), { from: TODAY, to: TODAY, label: 'heute' })
  assert.equal(parseWhen('und morgen?', TODAY).from, '2026-11-05')
  assert.equal(parseWhen('Guten Morgen Cleo', TODAY), null, '„Guten Morgen“ ist kein Datum')
  assert.equal(parseWhen('übermorgen', TODAY).from, '2026-11-06')
  assert.equal(parseWhen('am Freitag', TODAY).from, '2026-11-06')
  assert.equal(parseWhen('am Mittwoch', TODAY).from, TODAY, 'heutiger Wochentag = heute')
  assert.equal(parseWhen('nächsten Mittwoch', TODAY).from, '2026-11-11')
  assert.equal(parseWhen('letzten Montag', TODAY).from, '2026-11-02')
  assert.equal(parseWhen('am 12.11.', TODAY).from, '2026-11-12')
  assert.equal(parseWhen('am 3.1.', '2026-12-20').from, '2027-01-03', 'Jänner im Dezember: nächstes Jahr')
  assert.equal(parseWhen('am 8.12.2026', TODAY).from, '2026-12-08')
  assert.deepEqual(parseWhen('diese Woche', TODAY), { from: '2026-11-02', to: '2026-11-08', label: 'diese Woche' })
  assert.deepEqual(parseWhen('nächste Woche', TODAY), { from: '2026-11-09', to: '2026-11-15', label: 'nächste Woche' })
  assert.deepEqual([parseWhen('am Wochenende', TODAY).from, parseWhen('am Wochenende', TODAY).to], ['2026-11-07', '2026-11-08'])
  assert.deepEqual([parseWhen('bis Freitag', TODAY).from, parseWhen('bis Freitag', TODAY).to], [TODAY, '2026-11-06'])
  const r = parseWhen('vom 10.11. bis 14.11.', TODAY)
  assert.deepEqual([r.from, r.to], ['2026-11-10', '2026-11-14'])
  assert.equal(parseWhen('im Dezember', TODAY).to, '2026-12-31')
  assert.equal(parseWhen('Rechnung schreiben', TODAY), null)
})

test('Namen: ganzer Name vor Nachname vor Vorname, Genitiv, keine Datumswörter', () => {
  assert.equal(findPeople('wo ist anna huber', EMPS)[0].emp.id, 'e1')
  assert.equal(findPeople('dienstplan von huber', EMPS)[0].emp.id, 'e1')
  assert.deepEqual(findPeople('wo ist anna', EMPS).map((x) => x.emp.id).sort(), ['e1', 'e3'], 'zwei Annas')
  assert.equal(findPeople('Bens Plan', EMPS)[0].emp.id, 'e2')
  assert.equal(findPeople('wer arbeitet morgen', EMPS).length, 0, '„morgen“ ist nicht Morgenstern')
  assert.equal(findObjects('wer putzt im bürohaus', OBJS)[0].obj.id, 'o1')
  assert.equal(findObjects('einsätze PA', OBJS)[0].obj.id, 'o2', 'Kurzname')
  assert.equal(findObjects('wer ist in der praxis', OBJS).length, 0, 'allgemeine Wörter allein zählen nicht')
})

test('Verstehen: Fragen zu Plan, Abwesenheit, Offenem, Feiertag, Kontakt …', () => {
  const k = (q, e = env()) => understand(q, e)?.kind || null
  assert.equal(k('Wer arbeitet morgen?'), 'works')
  assert.equal(k('Wo ist Ben am Freitag?'), 'person')
  assert.equal(k('Wann arbeitet Ben diese Woche'), 'person')
  assert.equal(k('Wer putzt nächste Woche im Bürohaus?'), 'object')
  assert.equal(k('Wer ist diese Woche abwesend?'), 'absent')
  assert.equal(k('Wer ist krank?'), 'absent')
  assert.equal(k('Hat Ben Urlaub?'), 'absent')
  assert.equal(k('Was ist diese Woche noch offen?'), 'open')
  assert.equal(k('Was steht heute an?'), 'summary')
  assert.equal(k('Wann ist der nächste Feiertag?'), 'holiday')
  assert.equal(k('Ist der 8.12. ein Feiertag?'), 'holiday')
  assert.equal(k('Telefonnummer von Ben'), 'contact')
  assert.equal(k('Wer hat den Schlüssel vom Spar Lehen?'), 'keys')
  assert.equal(k('Offene Reklamationen?'), 'complaints')
  assert.equal(k('Wie viel Handtuchpapier haben wir noch?'), 'material')
  assert.equal(k('Wie viele Stunden hat Ben diese Woche?'), 'hours')
  // Befehle
  assert.equal(k('Ben ist morgen krank'), 'absence-cmd')
  assert.equal(k('Trag Ben bis Freitag Urlaub ein'), 'absence-cmd')
  const cmd = understand('Ben ist vom 10.11. bis 14.11. auf Urlaub', env())
  assert.deepEqual([cmd.kind, cmd.type, cmd.when.from, cmd.when.to, cmd.person.id], ['absence-cmd', 'Urlaub', '2026-11-10', '2026-11-14', 'e2'])
  // Anleitungsfragen bleiben bei den Hilfe-Themen
  assert.equal(k('Wie trage ich Urlaub ein?'), null)
  assert.equal(k('Wo finde ich die Abwesenheiten?'), null)
  assert.equal(k('Was ist ein Feiertag?'), null)
  assert.equal(k('Rechnung schreiben'), null)
  assert.equal(k('Guten Morgen'), null)
  assert.equal(k('Wann ist Ben wieder da?'), 'absent')
  assert.notEqual(k('Wo ist der Urlaubskalender?'), 'absent', 'Urlaubskalender ist kein Urlaub')
})

test('Rückfragen: „und morgen?“, „und Ben?“ greifen die letzte Frage auf', () => {
  const first = understand('Wer arbeitet heute?', env())
  const next = understand('und morgen?', env({ last: first }))
  assert.deepEqual([next.kind, next.when.from], ['works', '2026-11-05'])
  const who = understand('und Ben?', env({ last: next }))
  assert.deepEqual([who.kind, who.person.id, who.when.from], ['person', 'e2', '2026-11-05'])
  const abs = understand('Ist Ben krank?', env())
  const abs2 = understand('und Clara?', env({ last: abs }))
  assert.deepEqual([abs2.kind, abs2.person.id], ['absent', 'e4'])
  assert.equal(understand('und morgen?', env()), null, 'ohne vorige Frage keine Rückfrage')
})

// ---------------------------------------------------------------- Antworten mit echten Plan-Daten

function data({ assignments = {}, absences = [], can = {}, planned = true } = {}) {
  const tasks = [
    { id: 't1', objectId: 'o1', label: 'Unterhalt', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5] }, start: '06:00', end: '08:00', staff: 1, regulars: ['e1'], skills: [] },
    { id: 't2', objectId: 'o2', label: 'Praxis', recurrence: { type: 'weekly', weekdays: [3, 4] }, start: '18:00', end: '20:00', staff: 2, regulars: [], skills: [] },
  ]
  const from = '2026-10-26'
  const to = '2026-11-22'
  const holidays = holidayCalendar(from, to)
  const rules = mergeRules({})
  const instances = buildInstances({ objects: OBJS, tasks, overrides: {} }, from, to, holidays, rules)
  const ctx = createContext({ employees: EMPS, objects: OBJS, absences, rules: {} }, holidays)
  const list = Object.fromEntries(Object.entries(assignments).map(([k, ids]) => [k, ids.map((employeeId) => ({ employeeId }))]))
  const state = new PlanState(instances, list)
  return {
    today: TODAY,
    can: { plan: true, planEdit: true, coverage: true, absences: true, reasons: true, staff: true, keys: true, complaints: true, material: true, absenceView: true, ...can },
    instances,
    state,
    ctx,
    absences,
    absenceOf: (id, date) => findAbsence(ctx, id, date),
    isPlanned: () => planned,
    holidays: (a, b) => holidaysInRange(a, b),
    employees: EMPS,
    objects: OBJS,
    keys: [{ id: 'k1', objectId: 'o3', label: 'Haupttor', no: '7', holderId: 'e2' }],
    complaints: [{ id: 'c1', objectId: 'o1', kind: 'Reinigung mangelhaft', status: 'offen', due: '2026-11-02' }, { id: 'c2', objectId: 'o2', status: 'erledigt' }],
    material: { articles: [{ id: 'a1', name: 'Handtuchpapier', unit: 'Karton', min: 5 }, { id: 'a2', name: 'Müllsäcke', unit: 'Rolle', min: 2 }], moves: [{ articleId: 'a1', qty: 3, locationId: 'l1' }, { articleId: 'a2', qty: 40, locationId: 'l1' }], orders: [], locations: [{ id: 'l1', name: 'Lager' }] },
    todoCount: 2,
    appointments: [{ time: '10:30', title: 'Begehung Spar' }],
  }
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const ask = (q, d, last = null) => {
  const u = understand(q, env({ last }))
  return { u, a: answer(u, d) }
}

test('Antwort „Wer arbeitet heute?“: Personen mit Zeit und Objekt, offene Plätze', () => {
  const d = data({ assignments: { [`${TODAY}|t1`]: ['e1'], [`${TODAY}|t2`]: ['e2'] } })
  const { a } = ask('Wer arbeitet heute?', d)
  const t = text(a.html)
  assert.match(t, /Heute: 2 Personen im Einsatz/)
  assert.match(t, /Anna Huber 06:00–08:00 · Bürohaus Itzling/)
  assert.match(t, /Ben Berger 18:00–20:00 · Praxis Aigen/)
  assert.match(t, /1 Platz ist noch offen/)
  assert.match(a.html, /data-run="view" data-view="coverage"/)
})

test('Antwort: Person abwesend zählt nicht als im Einsatz; Abwesenheit mit Grund nur mit Recht', () => {
  const absences = [{ id: 'a1', employeeId: 'e1', type: 'Krankenstand', from: TODAY, to: '2026-11-06' }]
  const d = data({ assignments: { [`${TODAY}|t1`]: ['e1'] }, absences })
  const works = text(ask('Wer arbeitet heute?', d).a.html)
  assert.doesNotMatch(works, /Anna Huber/)
  const open = text(ask('Was ist heute offen?', d).a.html)
  assert.match(open, /Anna Huber abwesend/)
  assert.match(text(ask('Wer ist krank?', d).a.html), /Anna Huber Krankenstand · Mi 04\.11\.–Fr 06\.11\./)
  const limited = data({ absences: [{ ...absences[0], type: 'Abwesend' }], can: { reasons: false } })
  const t = text(ask('Wer ist diese Woche abwesend?', limited).a.html)
  assert.match(t, /Anna Huber abwesend/)
  assert.doesNotMatch(t, /Krankenstand/)
  assert.match(text(ask('Wer ist abwesend?', data({ absences, can: { absences: false } })).a.html), /sieht deine Rolle nicht/)
})

test('Antwort „Wo ist Ben?“: heute oder der nächste Einsatz; Woche noch nicht geplant → Stammkraft', () => {
  const d = data({ assignments: { '2026-11-05|t2': ['e2'] } })
  const t = text(ask('Wo ist Ben?', d).a.html)
  assert.match(t, /Ben Berger morgen: 1 Einsatz, 2 h/)
  assert.match(t, /Do 05\.11\. 18:00–20:00 Praxis Aigen/)
  const unplanned = data({ planned: false })
  const anna = text(ask('Wann arbeitet Anna Huber diese Woche?', unplanned).a.html)
  assert.match(anna, /Anna Huber diese Woche: 5 Einsätze, 10 h/)
  assert.match(anna, /Stammkraft, Woche noch nicht geplant/)
})

test('Antwort: Objekt, Feiertag, Kontakt, Schlüssel, Reklamationen, Material, Stunden, Überblick', () => {
  const d = data({ assignments: { '2026-11-09|t1': ['e1'] } })
  assert.match(text(ask('Wer putzt nächste Woche im Bürohaus?', d).a.html), /Bürohaus Itzling nächste Woche: 5 Einsätze.*Mo 09\.11\. 06:00–08:00 Anna Huber/)
  assert.match(text(ask('Ist der 8.12. ein Feiertag?', d).a.html), /Mariä Empfängnis/)
  assert.match(text(ask('Ist morgen ein Feiertag?', d).a.html), /kein Feiertag/)
  assert.match(text(ask('Wann ist der nächste Feiertag?', d).a.html), /Nächster Feiertag: Mariä Empfängnis/)
  const c = ask('Telefonnummer von Anna Huber', d).a.html
  assert.match(c, /href="tel:\+436601234567"/)
  assert.match(text(ask('Nummer von Ben', d).a.html), /keine Telefonnummer/)
  assert.match(text(ask('Wer hat den Schlüssel vom Spar Lehen?', d).a.html), /Haupttor Nr\. 7 bei Ben Berger/)
  assert.match(text(ask('Welche Schlüssel hat Ben?', d).a.html), /Ben Berger hat 1 Schlüssel.*Spar Lehen/)
  assert.match(text(ask('Offene Reklamationen?', d).a.html), /1 offene Reklamation · 1 überfällig.*Bürohaus Itzling/)
  assert.match(text(ask('Was muss nachbestellt werden?', d).a.html), /Handtuchpapier 3 Karton/)
  assert.match(text(ask('Wie viel Müllsäcke haben wir noch?', d).a.html), /Müllsäcke 40 Rolle/)
  assert.match(text(ask('Wie viele Stunden hat Anna Huber nächste Woche?', d).a.html), /2 Stunden/)
  const s = text(ask('Was steht heute an?', d).a.html)
  assert.match(s, /2 Einsätze mit 0 Personen/)
  assert.match(s, /3 Plätze sind noch offen/)
  assert.match(s, /Termin: 10:30 Begehung Spar/)
  assert.match(s, /2 Punkte warten/)
})

test('Antwort: zwei Annas → Rückfrage mit Auswahl; Auswahl löst es', () => {
  const d = data()
  const { a, u } = ask('Wo ist Anna morgen?', d)
  assert.match(a.html, /wen meinst du/)
  assert.match(a.html, /data-action="help-ask" data-q="Wo ist Anna morgen\? \(Anna Moser\)"/)
  const again = understand(`${u.text} (Anna Moser)`, env())
  assert.equal(again.person.id, 'e3')
})

test('Befehl „Ben ist morgen krank“: Formular schon ausgefüllt, ohne Recht ein Hinweis', () => {
  const d = data()
  const { a } = ask('Ben ist morgen krank', d)
  assert.match(a.html, /data-run="open-absence-new" data-emp="e2" data-date="2026-11-05" data-to="2026-11-05" data-type="Krankenstand"/)
  const no = ask('Ben ist morgen krank', data({ can: { planEdit: false } })).a
  assert.match(text(no.html), /trägt das Büro ein/)
  assert.doesNotMatch(no.html, /open-absence-new/)
})

test('Rechte: ohne Plan-Recht kein Plan; Zeitraum höchstens 31 Tage; Beispiele je Rolle', () => {
  assert.match(text(ask('Wer arbeitet heute?', data({ can: { plan: false } })).a.html), /sieht deine Rolle nicht/)
  const r = rangeFor(understand('Wer ist im Dezember abwesend', env()), TODAY)
  assert.equal(r.to, '2026-12-31')
  const long = rangeFor({ kind: 'absent', when: { from: TODAY, to: addDays(TODAY, 90), label: 'x' } }, TODAY)
  assert.equal(long.to, addDays(TODAY, 30))
  assert.ok(dataExamples({ plan: true }).includes('Wer arbeitet heute?'))
  assert.ok(!dataExamples({}).includes('Wer arbeitet heute?'))
})

test('Wunschzeiten: „Wer hat diese Woche Wunschfrei?“, Wünsche einer Person, ohne Planung kein Einblick', () => {
  const d = {
    ...data(),
    wishes: [
      { id: 'w1', empId: 'e2', date: '2026-11-06', kind: 'frei', note: 'Familienfeier' },
      { id: 'w2', empId: 'e1', date: '2026-11-05', kind: 'frueh' },
      { id: 'w3', empId: 'e1', date: '2026-11-02', kind: 'mehr' },
      { id: 'w4', empId: 'e2', date: '2026-12-01', kind: 'frei' },
    ],
  }
  let { u, a } = ask('Wer hat diese Woche Wunschfrei?', d)
  assert.equal(u.kind, 'wishes')
  assert.match(text(a.html), /1 Wunsch diese Woche Ben Berger .*Fr 06\.11\. · Wunschfrei · Familienfeier/)
  assert.match(a.html, /data-run="wish-open"/)
  ;({ u, a } = ask('Welche Wünsche hat Anna Huber?', d))
  assert.equal(u.kind, 'wishes')
  assert.match(text(a.html), /2 Wünsche von Anna Huber in den nächsten 14 Tagen/)
  assert.match(text(a.html), /Woche ab .*mehr Stunden/)
  assert.equal(answer(understand('Wer hat diese Woche Wunschfrei?', env()), { ...d, can: { plan: false } }).mood, 'hoppla')
  assert.ok(dataExamples({ plan: true }).includes('Wer hat diese Woche Wunschfrei?'))
})
