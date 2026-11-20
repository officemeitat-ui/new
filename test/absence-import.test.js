// Abwesenheiten aus einer Excel-Liste (core/absence-import.js). Alle Namen sind erfunden.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ABSENCE_TEMPLATE, absenceDate, absenceSpan, absenceSummary, absenceType, parseAbsenceTable } from '../src/core/absence-import.js'

const TODAY = '2026-11-20'
const EMPS = [
  { id: 'e1', name: 'Ana Popescu' },
  { id: 'e2', name: 'Markus Huber' },
  { id: 'e3', name: 'Elif Kaya' },
  { id: 'e4', name: 'Dragan Jović' },
  { id: 'e5', name: 'Alt Gedient', inactive: true },
]
const T = (rows) => rows.map((r) => r.join('\t')).join('\n')
const run = (text, extra = {}) => parseAbsenceTable(text, { employees: EMPS, today: TODAY, ...extra })

test('Abwesenheiten: Art erkennen (Kürzel, leer = Urlaub, Unbekanntes als Sonstiges mit Notiz)', () => {
  assert.deepEqual(['', 'Urlaub', 'U', 'krank', 'KS', 'Krankenstand', 'ZA', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges'].map((x) => absenceType(x).type), ['Urlaub', 'Urlaub', 'Urlaub', 'Krankenstand', 'Krankenstand', 'Krankenstand', 'Zeitausgleich', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges'])
  assert.deepEqual(absenceType('Fortbildung'), { type: 'Sonstiges', note: 'Fortbildung' })
  assert.equal(absenceType('Sonstiges').note, undefined)
})

test('Abwesenheiten: Datum mit und ohne Jahr, Zeitraum in einer Zelle, Jahreswechsel', () => {
  assert.deepEqual(absenceDate('23.12.2026', TODAY), { date: '2026-12-23', year: true })
  assert.deepEqual(absenceDate('3.1.27', TODAY), { date: '2027-01-03', year: true })
  assert.deepEqual(absenceDate('2026-12-23', TODAY), { date: '2026-12-23', year: true })
  // ohne Jahr: der nächste solche Tag ab zwei Monate vor heute
  assert.equal(absenceDate('07.01.', TODAY).date, '2027-01-07')
  assert.equal(absenceDate('23.12.', TODAY).date, '2026-12-23')
  assert.equal(absenceDate('02.11.', TODAY).date, '2026-11-02')
  assert.equal(absenceDate('01.09.', TODAY).date, '2027-09-01')
  assert.deepEqual(['31.02.2026', 'morgen', '', '12/24/2026'].map((x) => absenceDate(x, TODAY)), [null, null, null, null])
  assert.deepEqual(absenceSpan('23.12.2026–07.01.2027', TODAY), { from: '2026-12-23', to: '2027-01-07' })
  assert.deepEqual(absenceSpan('23.12. - 07.01.', TODAY), { from: '2026-12-23', to: '2027-01-07' })
  assert.deepEqual(absenceSpan('23.–27.12.2026', TODAY), { from: '2026-12-23', to: '2026-12-27' })
  assert.deepEqual(absenceSpan('23.12. bis 27.12.', TODAY), { from: '2026-12-23', to: '2026-12-27' })
  assert.deepEqual(absenceSpan('24.12.2026', TODAY), { from: '2026-12-24', to: '2026-12-24' })
  assert.equal(absenceSpan('irgendwann', TODAY), null)
  assert.equal(ABSENCE_TEMPLATE.join('|'), 'Name|Art|Von|Bis|Notiz')
})

test('Abwesenheiten: Liste lesen – Namen unscharf, leerer Name gilt wie darüber, ein Tag ohne „Bis“', () => {
  const r = run(T([
    ['Name', 'Art', 'Von', 'Bis', 'Notiz'],
    ['Popescu Ana', 'Urlaub', '23.12.2026', '07.01.2027', 'Weihnachten'],
    ['', 'ZA', '15.01.2027', '', ''],
    ['MARKUS HUBER', 'krank', '18.11.', '20.11.', ''],
    ['Elif Kaja', '', '02.02.', '06.02.', ''],
    ['Dragan Jovic', 'Fortbildung', '10.12.2026', '10.12.2026', 'Kurs'],
  ]))
  assert.equal(r.problem, '')
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.items.map((a) => [a.employeeId, a.type, a.from, a.to, a.note || '']), [
    ['e1', 'Urlaub', '2026-12-23', '2027-01-07', 'Weihnachten'],
    ['e1', 'Zeitausgleich', '2027-01-15', '2027-01-15', ''],
    ['e2', 'Krankenstand', '2026-11-18', '2026-11-20', ''],
    ['e3', 'Urlaub', '2027-02-02', '2027-02-06', ''],
    ['e4', 'Sonstiges', '2026-12-10', '2026-12-10', 'Kurs · Fortbildung'],
  ])
  // anders geschrieben: der geschriebene Name steht dabei (für die Vorschau)
  assert.equal(r.items[3].written, 'Elif Kaja')
  assert.equal(r.items[0].written, undefined)
  assert.equal(absenceSummary(r), '5 Abwesenheiten für 4 Personen (2 × Urlaub, 1 × Krankenstand, 1 × Zeitausgleich, 1 × Sonstiges)')
})

test('Abwesenheiten: Spalte „Zeitraum“, Strichpunkt, Vorspann und andere Überschriften', () => {
  const r = run(['Urlaubsplan Winter', '', 'Mitarbeiter;Zeitraum;Grund;Bemerkung', 'Ana Popescu;23.12.–07.01.;U;', 'Markus Huber;24.12.2026;Urlaub;halber Tag geht nicht', 'Elif Kaya;23.–27.12.2026;;'].join('\n'))
  assert.deepEqual(r.columns, ['name', 'span', 'type', 'note'])
  assert.deepEqual(r.items.map((a) => [a.employeeId, a.from, a.to]), [['e1', '2026-12-23', '2027-01-07'], ['e2', '2026-12-24', '2026-12-24'], ['e3', '2026-12-23', '2026-12-27']])
  assert.equal(r.items[1].note, 'halber Tag geht nicht')
})

test('Abwesenheiten: schon Vorhandenes und Doppelte überspringen, Überschneidung als Hinweis, Unbekannte und Fehler melden', () => {
  const existing = [
    { id: 'a1', employeeId: 'e1', type: 'Urlaub', from: '2026-12-23', to: '2027-01-07' },
    { id: 'a2', employeeId: 'e2', type: 'Krankenstand', from: '2026-12-01', to: '2026-12-03' },
  ]
  const r = run(T([
    ['Name', 'Art', 'Von', 'Bis'],
    ['Ana Popescu', 'Urlaub', '23.12.2026', '07.01.2027'],
    ['Markus Huber', 'Urlaub', '02.12.2026', '04.12.2026'],
    ['Markus Huber', 'Urlaub', '02.12.2026', '04.12.2026'],
    ['Frau Niemand', 'Urlaub', '02.12.2026', '04.12.2026'],
    ['Alt Gedient', 'Urlaub', '02.12.2026', '04.12.2026'],
    ['Elif Kaya', 'Urlaub', '10.12.2026', '08.12.2026'],
    ['Elif Kaya', 'Urlaub', 'bald', ''],
    ['', '', '', ''],
  ]), { existing })
  assert.deepEqual(r.items.map((a) => [a.employeeId, a.from, !!a.overlap]), [['e2', '2026-12-02', true]])
  assert.equal(r.skipped, 2)
  assert.deepEqual(r.unknown, ['Frau Niemand', 'Alt Gedient'])
  assert.deepEqual(r.errors.map((e) => [e.line, e.text.split(':')[0]]), [[7, 'Elif Kaya'], [8, 'Elif Kaya']])
  assert.match(r.errors[0].text, /„Bis“ liegt vor „Von“/)
  assert.match(r.errors[1].text, /Datum „bald“ nicht lesbar/)
  assert.equal(absenceSummary(r), '1 Abwesenheit für 1 Person (1 × Urlaub) · 2 schon vorhanden · 2 Namen nicht gefunden · 1 mit Überschneidung')
  // dieselbe Liste noch einmal: alles schon da
  const again = run(T([['Name', 'Von', 'Bis'], ['Ana Popescu', '23.12.2026', '07.01.2027']]), { existing })
  assert.deepEqual([again.items.length, again.skipped, again.problem], [0, 1, 'Alles aus der Liste ist schon eingetragen.'])
})

test('Abwesenheiten: verständliche Meldungen ohne brauchbare Liste', () => {
  assert.match(run('').problem, /Liste aus Excel einfügen/)
  assert.match(run('Name\tStunden\nAna\t3').problem, /Keine Überschrift erkannt/)
  assert.match(run('Name\tVon\tBis\n').problem, /keine Zeile/)
  assert.match(run('Name\tVon\nNiemand Da\t01.12.2026').problem, /Keine Zeile konnte übernommen werden/)
})
