import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addMonths, dueList, emptyTrainings, isRequired, latest, matrix, sessionRecords, shiftProblems, statusOf, TRAINING_DEFAULTS, typesOf, untilOf } from '../src/core/trainings.js'

const T = Object.fromEntries(TRAINING_DEFAULTS.map((t) => [t.id, t]))
const rec = (empId, typeId, date, extra = {}) => ({ id: `${empId}-${typeId}-${date}`, empId, typeId, date, until: '', ...extra })

const monthCases = [
  ['2026-12-31', 2, '2027-02-28'],
  ['2026-03-31', -1, '2026-02-28'],
  ['2027-11-30', 3, '2028-02-29'],
  ['2026-05-15', 0, '2026-05-15'],
]
for (const [date, months, out] of monthCases) test(`Frist: ${date} plus ${months} Monate = ${out}`, () => assert.equal(addMonths(date, months), out))

test('Gültig bis: Monate als Text, ohne Datum keine Frist', () => {
  assert.equal(untilOf({ date: '2026-02-01' }, { months: '6' }), '2026-08-01')
  assert.equal(untilOf({ until: '' }, T.sicherheit), '')
  assert.equal(untilOf(null, T.sicherheit), '')
  assert.equal(untilOf({ date: '2026-02-01' }, null), '')
})

test('Pflicht je Art: „optional“ nie, Qualifikation nur, wenn die Person sie hat', () => {
  assert.equal(isRequired(T.aufenthalt, { skills: ['Führerschein'] }), false)
  assert.equal(isRequired(T.fuehrerschein, null), false)
  assert.equal(isRequired({ who: 'skill:Hebebühne' }, { skills: ['Hebebühne'] }), true)
  assert.equal(isRequired({}, { skills: [] }), false)
})

test('Letzter Eintrag: späteres Datum gewinnt, am selben Tag der zuletzt erfasste', () => {
  const records = [rec('a', 'sicherheit', '2026-03-01', { at: '2026-03-01T09:00:00Z', note: 'erst' }), rec('a', 'sicherheit', '2026-03-01', { id: 'zwei', at: '2026-03-01T15:00:00Z', note: 'dann' }), rec('a', 'sicherheit', '2025-12-01'), rec('b', 'sicherheit', '2026-06-01')]
  assert.equal(latest(records, 'a', 'sicherheit').note, 'dann')
  assert.equal(latest(records, 'a', 'chemie'), null)
  assert.equal(latest(undefined, 'a', 'sicherheit'), null)
})

const stateCases = [
  ['läuft heute ab: noch gültig, aber bald', '2025-11-03', '2026-11-03', 30, 'bald'],
  ['lief gestern ab', '2025-11-02', '2026-11-03', 30, 'abgelaufen'],
  ['läuft in 30 Tagen ab', '2025-12-03', '2026-11-03', 30, 'bald'],
  ['läuft in 31 Tagen ab', '2025-12-04', '2026-11-03', 30, 'ok'],
  ['ohne Vorwarnung, läuft heute ab', '2025-11-03', '2026-11-03', 0, 'bald'],
]
for (const [name, date, today, warnDays, state] of stateCases)
  test(`Ampel Sicherheitsunterweisung: ${name} → ${state}`, () => {
    assert.equal(statusOf({ type: T.sicherheit, emp: { id: 'a', skills: [] }, records: [rec('a', 'sicherheit', date)], today, warnDays }).state, state)
  })

test('Ampel: Dokument ohne Ablaufdatum gilt, Führerscheinkontrolle fehlt nur mit Führerschein', () => {
  const s = statusOf({ type: T.aufenthalt, emp: { id: 'a' }, records: [rec('a', 'aufenthalt', '2024-01-01')], today: '2026-11-03' })
  assert.deepEqual([s.state, s.until], ['ok', ''])
  assert.equal(statusOf({ type: T.fuehrerschein, emp: { id: 'a', skills: ['Führerschein'] }, records: [], today: '2026-11-03' }).state, 'fehlt')
  assert.equal(statusOf({ type: T.fuehrerschein, emp: { id: 'a', skills: [] }, records: [], today: '2026-11-03' }).state, 'na')
})

test('Matrix: am Austrittstag noch dabei, schlechtester Zustand je Person', () => {
  const employees = [{ id: 'a', name: 'Anna', skills: [], exitDate: '2026-11-03' }, { id: 'b', name: 'Boris', skills: [], exitDate: '2026-11-02' }]
  const records = [rec('a', 'sicherheit', '2025-11-20'), rec('a', 'chemie', '2026-06-01')]
  const m = matrix({ doc: { types: [], records }, employees, today: '2026-11-03' })
  assert.deepEqual(m.map((r) => r.emp.id), ['a'])
  assert.deepEqual([m[0].cells.sicherheit.state, m[0].cells.chemie.state, m[0].cells.ersthilfe.state], ['bald', 'ok', 'na'])
  assert.equal(m[0].worst, 'bald')
  assert.equal(matrix({ doc: { types: [], records: [] }, employees: [{ id: 'c', name: 'Cem', skills: [] }], today: '2026-11-03' })[0].worst, 'fehlt')
})

test('Zu erledigen: sperrende zuerst, dann abgelaufen vor fehlt vor bald, gleiche Frist nach Name', () => {
  const employees = [{ id: 'z', name: 'Zora', skills: [] }, { id: 'a', name: 'Ägidius', skills: [] }, { id: 'b', name: 'Bert', skills: [] }]
  const records = [
    ...['z', 'a', 'b'].map((id) => rec(id, 'chemie', '2026-06-01')),
    rec('z', 'sicherheit', '2025-11-20'),
    rec('a', 'sicherheit', '2025-11-20'),
    rec('b', 'sicherheit', '2025-10-01'),
    rec('z', 'aufenthalt', '2024-01-01', { until: '2026-11-25' }),
  ]
  const list = dueList({ doc: { types: [], records }, employees, today: '2026-11-03' })
  assert.deepEqual(list.map((d) => `${d.emp.name}:${d.type.id}:${d.state}`), ['Zora:aufenthalt:bald', 'Bert:sicherheit:abgelaufen', 'Ägidius:sicherheit:bald', 'Zora:sicherheit:bald'])
})

test('Eigene Arten: inaktive aus, ohne eigene die Standardliste, leere Datei', () => {
  assert.equal(typesOf(null).length, 5)
  assert.deepEqual(typesOf({ types: [{ id: 'leiter', name: 'Leiterunterweisung', months: 12, who: 'alle' }, { id: 'alt', active: false }] }).map((t) => t.id), ['leiter'])
  assert.deepEqual(emptyTrainings(), { types: [], records: [], sessions: [] })
  const m = matrix({ doc: { types: [{ id: 'leiter', name: 'Leiterunterweisung', months: 12, who: 'alle' }], records: [] }, employees: [{ id: 'a', name: 'Anna' }], today: '2026-11-03' })
  assert.deepEqual(Object.keys(m[0].cells), ['leiter'])
})

test('Unterweisung für viele: ohne Thema keine Notiz, Ablaufdatum der Sitzung nur bei Arten ohne Monate', () => {
  let n = 0
  const opts = { newId: () => `r${++n}`, at: '2026-11-03T10:00:00Z', by: 'Büro' }
  const kurs = sessionRecords({ id: 's1', typeId: 'sicherheit', date: '2026-11-03', until: '2027-01-01', participants: ['a'] }, T.sicherheit, opts)
  assert.deepEqual([kurs[0].until, kurs[0].note, kurs[0].signature, kurs[0].by], ['', '', '', 'Büro'], 'Gültigkeit aus den 12 Monaten')
  const doc = sessionRecords({ id: 's2', typeId: 'aufenthalt', date: '2026-11-03', until: '2028-05-31', topic: 'Kontrolle', participants: ['a', 'b'] }, T.aufenthalt, opts)
  assert.deepEqual(doc.map((r) => [r.id, r.until, r.note]), [['r2', '2028-05-31', 'Inhalt: Kontrolle'], ['r3', '2028-05-31', 'Inhalt: Kontrolle']])
})

test('Prüfung im Plan: ohne Datei nichts, sperrendes Dokument ohne Eintrag kein Fehler, Qualifikation muss die Person haben', () => {
  assert.deepEqual(shiftProblems({ doc: null, emp: { id: 'a' }, date: '2026-11-04' }), [])
  const doc = { types: [], records: [rec('a', 'fuehrerschein', '2025-01-01')] }
  assert.deepEqual(shiftProblems({ doc, emp: { id: 'b', skills: [] }, date: '2026-11-04' }), [], 'Aufenthaltstitel nicht eingetragen: steht unter „Zu erledigen“')
  assert.deepEqual(shiftProblems({ doc, emp: { id: 'a', skills: [] }, date: '2026-11-04', skills: ['Führerschein'] }), [], 'Person ohne Führerschein-Qualifikation: Regel gilt nicht')
  const [p] = shiftProblems({ doc, emp: { id: 'a', skills: ['Führerschein'] }, date: '2026-11-04', skills: ['Führerschein'] })
  assert.deepEqual([p.severity, p.text], ['warning', 'Führerscheinkontrolle abgelaufen (01.07.2025)'])
})

test('Prüfung im Plan: eigene sperrende Art (z. B. Gesundheitszeugnis) ergibt einen Fehler', () => {
  const doc = { types: [{ id: 'gesund', name: 'Gesundheitszeugnis', months: 24, who: 'alle', blocking: true }], records: [rec('a', 'gesund', '2024-11-03')] }
  assert.deepEqual(shiftProblems({ doc, emp: { id: 'a' }, date: '2026-11-03' }), [], 'bis 3.11.2026 gültig')
  assert.deepEqual(shiftProblems({ doc, emp: { id: 'a' }, date: '2026-11-04' }).map((p) => [p.severity, p.text]), [['error', 'Gesundheitszeugnis abgelaufen (03.11.2026)']])
})
