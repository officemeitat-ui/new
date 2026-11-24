// Interne Aufgaben (core/aufgaben.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addComment, assigneeChoices, createTask, dueText, emptyAufgaben, isMine, isOverdue, normalizeTask, setStatus, taskAlerts, taskMail, taskProblem, taskRows, taskSummary, updateTask, upgradeAufgaben } from '../src/core/aufgaben.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const stamp = { now: '2026-11-24T08:00:00.000Z', by: 'Petra Leitner' }
let n = 0
const make = (fields, opts = {}) => createTask(fields, { ...stamp, newId: () => `au${++n}`, ...opts })
const me = { name: 'Petra Leitner', email: 'office@cleanos.at' }
const today = '2026-11-24'

test('Leere Ablage wie im Speicher; ältere Inhalte werden ergänzt', () => {
  assert.deepEqual(MODULE_DOCS.aufgaben.empty(), emptyAufgaben())
  assert.deepEqual(upgradeAufgaben({}), emptyAufgaben())
  assert.deepEqual(upgradeAufgaben(null), emptyAufgaben())
  const doc = { items: [{ id: 'x' }] }
  assert.equal(upgradeAufgaben(doc), doc)
  assert.deepEqual(doc.settings, {})
})

test('Eingaben säubern und prüfen', () => {
  assert.deepEqual(normalizeTask({ title: '  Angebot nachfassen ', assigneeName: ' Bernd Büro ', assigneeEmail: 'Bernd@Cleanos.at', due: '2026-12-01', priority: 'hoch', status: 'quatsch' }), { title: 'Angebot nachfassen', note: '', objectId: '', assignee: { name: 'Bernd Büro', email: 'bernd@cleanos.at' }, due: '2026-12-01', priority: 'hoch', status: 'offen' })
  assert.equal(normalizeTask({ title: 'x', due: '1.12.' }).due, '')
  assert.equal(normalizeTask({ title: 'x' }).assignee, null)
  assert.deepEqual(normalizeTask({ title: 'x', assigneeEmail: 'kaputt', assigneeName: 'Bernd' }).assignee, { name: 'Bernd' })
  assert.match(taskProblem({ title: ' ' }), /beschreiben/)
  assert.match(taskProblem({ title: 'x'.repeat(201) }), /kürzer/)
  assert.match(taskProblem({ title: 'x' }, { rawDue: '31.13.' }), /ungültig/)
  assert.equal(taskProblem({ title: 'x' }, { rawDue: '' }), '')
  assert.equal(taskProblem({ title: 'Angebot nachfassen' }), '')
})

test('Anlegen, ändern, erledigen, wieder öffnen: Verlauf und Zeitstempel', () => {
  const t = make({ title: 'Schlüssel nachmachen', assigneeName: 'Bernd Büro', due: '2026-11-26' })
  assert.equal(t.status, 'offen')
  assert.equal(t.log[0].text, 'angelegt, zuständig: Bernd Büro, fällig am 26.11.2026')
  // ohne Änderung dieselbe Aufgabe
  assert.equal(updateTask(t, { title: 'Schlüssel nachmachen' }, stamp), t)
  const moved = updateTask(t, { assignee: { name: 'Petra Leitner' }, due: '2026-11-28', priority: 'hoch' }, { now: '2026-11-24T09:00:00.000Z', by: 'Bernd Büro' })
  assert.equal(moved.log.at(-1).text, 'zuständig: Petra Leitner, fällig am 28.11.2026, als dringend markiert')
  assert.equal(moved.updatedBy, 'Bernd Büro')
  assert.equal(t.log.length, 1) // Original unverändert
  const noted = updateTask(moved, { note: 'Schlüsseldienst am Bahnhof' }, stamp)
  assert.equal(noted.log.length, moved.log.length) // Notiz allein steht nicht im Verlauf
  const done = setStatus(noted, 'erledigt', { now: '2026-11-25T10:00:00.000Z', by: 'Petra Leitner' })
  assert.deepEqual([done.status, done.doneAt, done.doneBy, done.log.at(-1).text], ['erledigt', '2026-11-25T10:00:00.000Z', 'Petra Leitner', 'Status: erledigt'])
  const again = setStatus(done, 'in-arbeit', stamp)
  assert.equal(again.doneAt, undefined)
  assert.equal(again.log.at(-1).text, 'Status: in Arbeit')
  const cleared = updateTask(again, { assignee: null, due: '' }, stamp)
  assert.equal(cleared.log.at(-1).text, 'ohne Zuständige/n, ohne Fälligkeit')
  const c = addComment(done, '  Kunde hat abgeholt ', stamp)
  assert.deepEqual(c.log.at(-1), { at: stamp.now, by: 'Petra Leitner', text: 'Kunde hat abgeholt', comment: true })
  assert.equal(addComment(done, '  ', stamp), done)
})

test('Meine Aufgaben über Name oder E-Mail; überfällig und Fälligkeitstext', () => {
  const byName = make({ title: 'a', assigneeName: 'petra leitner' })
  const byMail = make({ title: 'b', assigneeName: 'Büro', assigneeEmail: 'OFFICE@cleanos.at' })
  const other = make({ title: 'c', assigneeName: 'Bernd Büro' })
  assert.deepEqual([byName, byMail, other, make({ title: 'd' })].map((t) => isMine(t, me)), [true, true, false, false])
  const t = (due, status = 'offen') => ({ title: 'x', due, status })
  assert.equal(dueText(t('2026-11-21'), today), 'überfällig seit 3 Tagen')
  assert.equal(dueText(t('2026-11-23'), today), 'überfällig seit gestern')
  assert.equal(dueText(t('2026-11-24'), today), 'heute fällig')
  assert.equal(dueText(t('2026-11-25'), today), 'morgen fällig')
  assert.equal(dueText(t('2026-12-03'), today), 'fällig am 3.12.2026')
  assert.equal(dueText(t('2026-11-21', 'erledigt'), today), 'war fällig am 21.11.2026')
  assert.equal(dueText(t(''), today), '')
  assert.equal(isOverdue(t('2026-11-21'), today), true)
  assert.equal(isOverdue(t('2026-11-21', 'erledigt'), today), false)
  assert.equal(isOverdue(t('2026-11-24'), today), false)
})

test('Liste: Filter, Suche und Reihenfolge; Zahlen für die Reiter', () => {
  n = 100
  const items = [
    make({ title: 'Ohne Datum', assigneeName: 'Petra Leitner' }, { now: '2026-11-20T08:00:00.000Z' }),
    make({ title: 'Überfällig', assigneeName: 'Petra Leitner', due: '2026-11-20' }),
    make({ title: 'Nächste Woche dringend', assigneeName: 'Bernd Büro', due: '2026-12-01', priority: 'hoch' }),
    make({ title: 'Nächste Woche', assigneeName: 'Petra Leitner', due: '2026-12-01', objectId: 'o5' }),
    make({ title: 'Niemand zuständig', note: 'Lieferant anrufen' }),
    setStatus(make({ title: 'Fertig alt', assigneeName: 'Petra Leitner' }), 'erledigt', { now: '2026-11-10T08:00:00.000Z', by: 'Petra Leitner' }),
    setStatus(make({ title: 'Fertig neu', assigneeName: 'Bernd Büro' }), 'erledigt', { now: '2026-11-22T08:00:00.000Z', by: 'Bernd Büro' }),
  ]
  const titles = (opts) => taskRows(items, { me, today, ...opts }).map((t) => t.title)
  assert.deepEqual(titles({ filter: 'meine' }), ['Überfällig', 'Nächste Woche', 'Ohne Datum'])
  assert.deepEqual(titles({ filter: 'offen' }), ['Überfällig', 'Nächste Woche dringend', 'Nächste Woche', 'Niemand zuständig', 'Ohne Datum'])
  assert.deepEqual(titles({ filter: 'ueberfaellig' }), ['Überfällig'])
  assert.deepEqual(titles({ filter: 'erledigt' }), ['Fertig neu', 'Fertig alt'])
  assert.equal(titles({ filter: 'alle' }).length, 7)
  assert.deepEqual(titles({ filter: 'alle' }).slice(-2), ['Fertig neu', 'Fertig alt'])
  assert.deepEqual(titles({ filter: 'alle', query: 'lieferant' }), ['Niemand zuständig'])
  assert.deepEqual(titles({ filter: 'alle', query: 'bernd' }), ['Nächste Woche dringend', 'Fertig neu'])
  assert.deepEqual(titles({ filter: 'alle', query: 'lehen', objectName: (id) => (id === 'o5' ? 'Wohnanlage Lehen' : '') }), ['Nächste Woche'])
  assert.deepEqual(taskSummary(items, { me, today }), { open: 5, mine: 3, overdue: 1, mineOverdue: 1, mineSoon: 0, unassigned: 1, done: 2 })
  assert.deepEqual(taskSummary([], { me, today }), { open: 0, mine: 0, overdue: 0, mineOverdue: 0, mineSoon: 0, unassigned: 0, done: 0 })
})

test('„Zu erledigen“: meine überfälligen und bis morgen fälligen, dazu neue ohne Datum der letzten Woche', () => {
  n = 200
  const items = [
    make({ title: 'Heute', assigneeName: 'Petra Leitner', due: '2026-11-24' }),
    make({ title: 'Überfällig', assigneeName: 'Petra Leitner', due: '2026-11-20' }),
    make({ title: 'Übermorgen', assigneeName: 'Petra Leitner', due: '2026-11-26' }),
    make({ title: 'Neu ohne Datum', assigneeName: 'Petra Leitner' }, { now: '2026-11-22T08:00:00.000Z' }),
    make({ title: 'Alt ohne Datum', assigneeName: 'Petra Leitner' }, { now: '2026-11-01T08:00:00.000Z' }),
    make({ title: 'Fremd', assigneeName: 'Bernd Büro', due: '2026-11-20' }),
    setStatus(make({ title: 'Erledigt', assigneeName: 'Petra Leitner', due: '2026-11-20' }), 'erledigt', stamp),
  ]
  const a = taskAlerts(items, { me, today })
  assert.deepEqual(a.map((x) => [x.task.title, x.why]), [['Überfällig', 'überfällig seit 4 Tagen'], ['Heute', 'heute fällig'], ['Neu ohne Datum', 'neu für dich']])
  assert.match(a[0].id, /^aufgabe:au\d+:2026-11-20$/)
  assert.match(a[2].id, /^aufgabe:au\d+:neu$/)
})

test('Auswahl „zuständig“ und E-Mail an die zuständige Person', () => {
  const items = [make({ title: 'a', assigneeName: 'Bernd Büro', assigneeEmail: 'bernd@cleanos.at' }), make({ title: 'b', assigneeName: 'bernd büro' })]
  const list = assigneeChoices(items, { employees: [{ name: 'Ana Popescu' }, { name: 'Alt Mitarbeiter', active: false }], me })
  assert.deepEqual(list, [{ name: 'Ana Popescu', email: '' }, { name: 'Bernd Büro', email: 'bernd@cleanos.at' }, { name: 'Petra Leitner', email: 'office@cleanos.at' }])
  const t = make({ title: 'Schlüssel nachmachen', note: 'Zwei Stück für Stiege 2', assigneeName: 'Bernd Büro', due: '2026-11-20', priority: 'hoch' })
  const m = taskMail(t, { objectName: 'Wohnanlage Lehen', sender: 'Petra Leitner', today })
  assert.equal(m.subject, 'Aufgabe: Schlüssel nachmachen')
  assert.equal(m.text, ['Hallo Bernd,', '', 'für dich ist eine Aufgabe in der Cleanos App eingetragen:', '', 'Schlüssel nachmachen', 'Objekt: Wohnanlage Lehen', 'Fällig: 20.11.2026 (überfällig)', 'Dringend', '', 'Zwei Stück für Stiege 2', '', 'Du findest sie in der App unter „Aufgaben“.', '', 'Viele Grüße', 'Petra Leitner'].join('\n'))
})
