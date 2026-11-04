import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { effectiveKeys, giveBack, handOver, handoversNeeded, historyText, importFromObjects, keysOf, keyWarnings, markFound, markLost, objectKeys, returnToCustomer } from '../src/core/keys.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'

const at = '2026-11-03T08:00:00.000Z'
const key = (id, over = {}) => ({ id, objectId: 'o1', label: 'Haupteingang', no: id, kind: 'schluessel', storage: 'Kasten A', holderId: '', since: '2026-10-01', due: '', status: 'aktiv', history: [], ...over })
const names = { e1: 'Anna Berger', e2: 'Boris Kraus', e3: 'Carla Dorn' }
const name = (id) => names[id] || id

test('Schlüsselbuch: Ausgabe aus dem Büro mit Unterschrift und Frist, Verlauf ohne leere Felder', () => {
  const k = handOver(key('1'), { to: 'e1', date: '2026-11-03', due: '2026-11-20', by: 'Büro', note: 'für Grundreinigung', signature: 'data:image/png;base64,AAAA', at })
  assert.deepEqual([k.holderId, k.since, k.due], ['e1', '2026-11-03', '2026-11-20'])
  assert.deepEqual(k.history, [{ at, date: '2026-11-03', kind: 'ausgabe', to: 'e1', by: 'Büro', note: 'für Grundreinigung', signature: 'data:image/png;base64,AAAA' }], 'ohne „from“ (lag im Büro)')
  assert.equal(historyText(k.history[0], name), 'ausgegeben an Anna Berger')
  assert.equal(key('1').history.length, 0, 'Original unverändert')
})

test('Schlüsselbuch: Rückgabe ins Büro löscht Frist, Verlauf wächst je Schritt', () => {
  let k = handOver(key('1'), { to: 'e1', date: '2026-11-03', due: '2026-11-20', by: 'Büro', at })
  k = giveBack(k, { date: '2026-11-10', by: 'Büro', note: 'vollständig', at })
  assert.deepEqual([k.holderId, k.since, k.due], ['', '2026-11-10', ''])
  assert.deepEqual(k.history.map((h) => h.kind), ['ausgabe', 'rueckgabe'])
  assert.equal(historyText(k.history[1], name), 'zurückgegeben von Anna Berger ins Büro')
  assert.equal(historyText(giveBack(key('2'), { date: '2026-11-10', at }).history[0], name), 'zurückgegeben ins Büro', 'lag schon im Büro')
})

test('Schlüsselbuch: Verlust behält die letzte Person, zählt aber nicht mehr als vorhanden', () => {
  const k = markLost(handOver(key('1'), { to: 'e2', date: '2026-11-03', at }), { date: '2026-11-05', by: 'Büro', text: 'im Bus vergessen', informed: 'ja', measure: 'Zylinder tauschen', at })
  assert.equal(k.holderId, 'e2')
  assert.deepEqual(k.lost, { date: '2026-11-05', text: 'im Bus vergessen', informed: true, measure: 'Zylinder tauschen' })
  assert.deepEqual(k.history.at(-1), { at, date: '2026-11-05', kind: 'verlust', from: 'e2', by: 'Büro', note: 'im Bus vergessen' })
  assert.deepEqual(keysOf([k], 'e2'), [])
  assert.deepEqual(keyWarnings({ keys: [k], employees: [], today: '2026-11-06' }), [], 'Kunde informiert: kein Hinweis')
  const found = markFound(k, { date: '2026-11-07', by: 'Büro', note: 'Fundbüro', at })
  assert.deepEqual([found.status, found.holderId, found.since, historyText(found.history.at(-1))], ['aktiv', '', '2026-11-07', 'wieder da'])
})

test('Schlüsselbuch: an den Kunden zurück – nicht mehr im Objekt, nicht mehr bei der Person', () => {
  const k = returnToCustomer(handOver(key('1'), { to: 'e3', date: '2026-11-03', at }), { date: '2026-11-30', by: 'Büro', note: 'Vertrag beendet', at })
  assert.deepEqual([k.status, k.holderId, k.due], ['kunde', '', ''])
  assert.equal(historyText(k.history.at(-1)), 'an den Kunden zurückgegeben')
  assert.deepEqual(k.history.at(-1).from, 'e3')
  assert.deepEqual(objectKeys([k], 'o1'), [])
  assert.deepEqual(effectiveKeys([{ id: 'o1', keys: [{ id: 'alt', label: 'Alt' }] }], [k]).get('o1'), [], 'Buch gilt, auch wenn alles zurück ist')
})

test('Schlüssel eines Objekts: aktive nach Bezeichnung (Umlaute richtig einsortiert)', () => {
  const keys = [key('1', { label: 'Zufahrt' }), key('2', { label: 'Äußeres Tor' }), key('3', { label: 'Abstellraum' }), key('4', { label: 'Büro', objectId: 'o2' }), key('5', { label: 'Archiv', status: 'verloren' })]
  assert.deepEqual(objectKeys(keys, 'o1').map((k) => k.label), ['Abstellraum', 'Äußeres Tor', 'Zufahrt'])
  assert.deepEqual(keysOf(keys, ''), [], 'ohne Person: keine')
})

const warnCases = [
  ['Austritt heute: noch kein Fehler, aber Rückgabe einplanen', { exitDate: '2026-11-03' }, {}, ['AUSTRITT']],
  ['Austritt in 14 Tagen', { exitDate: '2026-11-17' }, {}, ['AUSTRITT']],
  ['Austritt in 15 Tagen: noch kein Hinweis', { exitDate: '2026-11-18' }, {}, []],
  ['Rückgabe heute fällig: noch nicht überschritten', {}, { due: '2026-11-03' }, []],
  ['Rückgabe gestern fällig', {}, { due: '2026-11-02' }, ['FAELLIG']],
  ['ausgetreten und Frist überschritten', { exitDate: '2026-10-31' }, { due: '2026-10-31' }, ['AUSGETRETEN', 'FAELLIG']],
]
for (const [title, empOver, keyOver, codes] of warnCases)
  test(`Schlüssel-Hinweis: ${title}`, () => {
    const w = keyWarnings({ keys: [key('1', { holderId: 'e1', ...keyOver })], employees: [{ id: 'e1', name: 'Anna Berger', ...empOver }], today: '2026-11-03' })
    assert.deepEqual(w.map((x) => x.code), codes)
  })

test('Schlüssel-Hinweis: Abwesenheit erst ab einer Woche, unbekannte Person heißt „Person“', () => {
  const keys = [key('1', { holderId: 'e1' }), key('2', { holderId: 'x9' })]
  const short = keyWarnings({ keys, employees: [{ id: 'e1', name: 'Anna Berger' }], absences: [{ employeeId: 'e1', from: '2026-11-01', to: '2026-11-09', type: 'Urlaub' }], today: '2026-11-03' })
  assert.deepEqual(short, [], 'bis 9.11.: weniger als 7 Tage ab heute')
  const long = keyWarnings({ keys, employees: [{ id: 'e1', name: 'Anna Berger' }], absences: [{ employeeId: 'x9', from: '2026-11-03', to: '2026-11-10', type: 'Krankenstand' }], today: '2026-11-03' })
  assert.deepEqual(long.map((w) => [w.code, w.key.id, w.text]), [['ABWESEND', '2', 'Person ist bis Di 10.11.2026 abwesend (Krankenstand)']])
  const ahead = keyWarnings({ keys, employees: [], absences: [{ employeeId: 'x9', from: '2026-11-04', to: '2026-11-30', type: 'Urlaub' }], today: '2026-11-03' })
  assert.deepEqual(ahead, [], 'beginnt erst morgen')
})

test('Schlüssel-Hinweis: Texte mit Datum, Fehler vor Warnungen', () => {
  const w = keyWarnings({ keys: [key('1', { holderId: 'e1', due: '2026-10-30' }), key('2', { holderId: 'e2' })], employees: [{ id: 'e1', name: 'Anna Berger', exitDate: '2026-11-10' }, { id: 'e2', name: 'Boris Kraus', exitDate: '2026-10-31' }], today: '2026-11-03' })
  assert.deepEqual(w.map((x) => [x.severity, x.text]), [
    ['error', 'Boris Kraus ist ausgetreten (Sa 31.10.2026) und hat den Schlüssel noch'],
    ['warning', 'Anna Berger tritt am Di 10.11.2026 aus: Rückgabe einplanen'],
    ['warning', 'Rückgabe war bis Fr 30.10.2026 vereinbart'],
  ])
})

const historyCases = [
  [{ kind: 'uebernommen', to: 'e1' }, 'aus dem Objekt übernommen (bei Anna Berger)'],
  [{ kind: 'uebernommen' }, 'aus dem Objekt übernommen'],
  [{ kind: 'ausgabe', from: 'e1', to: 'e2' }, 'ausgegeben von Anna Berger an Boris Kraus'],
  [{ kind: 'geaendert' }, 'geändert'],
  [{ kind: 'verlust', from: 'e1' }, 'als verloren gemeldet'],
  [{ kind: 'neu-unbekannt' }, 'neu-unbekannt'],
]
for (const [h, text] of historyCases) test(`Schlüssel-Verlauf in Worten: ${text}`, () => assert.equal(historyText(h, name), text))

// ---------------------------------------------------------------- Übergaben laut Plan

const inst = (key, date, objectId, start, extra = {}) => ({ key, date, objectId, start, status: 'normal', ...extra })

test('Übergaben laut Plan: nur besetzte Einsätze im Zeitraum, je Person und Objekt einmal, nach Beginn', () => {
  const instances = [
    inst('2026-11-05|a', '2026-11-05', 'o1', 3000),
    inst('2026-11-04|a', '2026-11-04', 'o1', 2000),
    inst('2026-11-04|c', '2026-11-04', 'o1', 2100, { status: 'cancelled' }),
    inst('2026-11-04|b', '2026-11-04', 'o2', 1000),
    inst('2026-11-20|a', '2026-11-20', 'o1', 9000),
    inst('2026-11-04|d', '2026-11-04', 'o3', 1500),
  ]
  const state = new PlanState(instances, { '2026-11-05|a': [{ employeeId: 'e2' }], '2026-11-04|a': [{ employeeId: 'e2' }, { employeeId: 'e1' }], '2026-11-04|c': [{ employeeId: 'e3' }], '2026-11-04|b': [{ employeeId: 'e3' }], '2026-11-20|a': [{ employeeId: 'e3' }], '2026-11-04|d': [{ employeeId: 'e3' }] })
  const keysByObject = new Map([['o1', [{ id: 'k1', holderId: 'e1' }, { id: 'k2', holderId: '' }]], ['o2', [{ id: 'k3', holderId: 'e1' }]], ['o3', []]])
  const out = handoversNeeded({ instances, state, keysByObject, from: '2026-11-03', to: '2026-11-10' })
  assert.deepEqual(out.map((h) => [h.date, h.empId, h.inst.objectId, h.holders, h.office]), [
    ['2026-11-04', 'e3', 'o2', ['e1'], false],
    ['2026-11-04', 'e2', 'o1', ['e1'], true],
  ], 'Anna hat einen; abgesagt, später und Objekt ohne Schlüssel zählen nicht; Boris schon am 4.11. (erster Einsatz, auch wenn er später in der Liste steht)')
})

test('Übergaben laut Plan: Winterdienst vor dem ersten Regel-Einsatz – Übergabe schon für den Winterdienst', () => {
  const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
  const emp = (id) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: [], availability: allDays })
  const data = {
    employees: [emp('e1'), emp('e3')],
    objects: [{ id: 'o1', name: 'Wohnanlage Lindenhof', winter: { active: true, team: ['e3'] } }],
    tasks: [{ id: 't', objectId: 'o1', label: 'Stiegenhaus', recurrence: { type: 'weekly', weekdays: [4] }, start: '08:00', end: '10:00', staff: 1, regulars: ['e3'], skills: [], holidayRule: 'findet_statt' }],
    absences: [], rules: {}, overrides: {}, winter: { '2026-12-02|o1': { reason: 'Neuschnee' } },
  }
  const holidays = holidayCalendar('2026-11-30', '2026-12-13')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-30', '2026-12-06', holidays, ctx.rules)
  assert.deepEqual(instances.map((i) => i.key), ['2026-12-03|t', '2026-12-02|winter-o1'], 'Winterdienst wird hinten angehängt')
  const state = new PlanState(instances, { '2026-12-03|t': [{ employeeId: 'e3' }], '2026-12-02|winter-o1': [{ employeeId: 'e3' }] })
  const book = [key('k1', { holderId: 'e1' })]
  const ho = handoversNeeded({ instances, state, keysByObject: effectiveKeys(data.objects, book), from: '2026-11-30', to: '2026-12-06' })
  assert.deepEqual(ho.map((h) => [h.date, h.inst.key, h.empId, h.holders]), [['2026-12-02', '2026-12-02|winter-o1', 'e3', ['e1']]])
  assert.equal(instances[0].key, '2026-12-03|t', 'Liste der Einsätze bleibt unverändert')
})

test('Schlüssel übernehmen: Kennung aus der Bezeichnung, Leerzeichen weg, bekannte nicht doppelt', () => {
  const objects = [{ id: 'o1', keys: [{ label: '  Kellertür ', holderId: 'e1' }, { id: 'k2', label: 'Tor' }] }, { id: 'o2' }]
  let n = 0
  const newId = () => `n${++n}`
  const first = importFromObjects(objects, [], { newId, at, date: '2026-11-03' })
  assert.deepEqual(first.map((k) => [k.id, k.label, k.legacyId, k.holderId, k.status, k.history[0].kind]), [['n1', 'Kellertür', 'o1:  Kellertür ', 'e1', 'aktiv', 'uebernommen'], ['n2', 'Tor', 'o1:k2', '', 'aktiv', 'uebernommen']])
  assert.deepEqual(first[0].history[0], { at, date: '2026-11-03', kind: 'uebernommen', to: 'e1' }, 'ohne leeres „by“')
  // Buch hat nur übernommene: ein neu am Objekt eingetragener Schlüssel kommt dazu
  const more = [{ id: 'o1', keys: [...objects[0].keys, { id: 'k3', label: 'Garage' }] }]
  assert.deepEqual(importFromObjects(more, first, { newId, at, date: '2026-11-04' }).map((k) => k.label), ['Garage'])
})
