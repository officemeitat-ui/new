// Mitarbeiterakte (core/mitarbeiterakte.js): Vermerke aus der Objektkontrolle je Person, offen fürs Gespräch, Erinnerung ab
// drei Vermerken, Vorschlag „wer hat gereinigt“, Gespräch eintragen, Aufräumen nach der Aufbewahrungsfrist, Ordner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyAkte, entriesFromMeasurement, folderOf, openEntries, purge, recordTalk, suggestCleaners, summary, talksDue } from '../src/core/mitarbeiterakte.js'

const foto = (n) => ({ path: `qualitaet/nachweise/2026/m1_${n}.jpg`, name: `${n}.jpg`, type: 'image/jpeg' })
const measurement = () => ({
  id: 'm1',
  objectId: 'o1',
  date: '2026-11-20',
  report: { path: 'qualitaet/nachweise/2026/m1_bericht.pdf', name: 'Bericht.pdf' },
  rooms: [
    { label: 'Büro 1', cleanedBy: 'e1', items: [{ name: 'Boden', state: 'mangel', defects: ['staub'], note: 'unter dem Tisch', photo: foto(1) }, { name: 'Tisch', state: 'ok' }] },
    { label: 'WC Damen', cleanedBy: 'e1', items: [{ name: 'WC', state: 'mangel', defects: ['kalk', 'flecken'], photo: null }] },
    { label: 'Küche', cleanedBy: 'e2', items: [{ name: 'Spüle', state: 'ok' }] },
    { label: 'Gang', cleanedBy: '', items: [{ name: 'Boden', state: 'mangel', defects: [] }] },
  ],
})

test('Objektkontrolle → Vermerk je Person mit Mangel: Räume, Fehlerarten, Notiz, Fotos, Bericht; ohne Mangel bzw. Person keiner', () => {
  const list = entriesFromMeasurement(measurement(), { objectName: 'Autohaus Maxglan', defectNames: { staub: 'Staub', kalk: 'Kalk', flecken: 'Flecken' } })
  assert.equal(list.length, 1)
  const e = list[0]
  assert.equal(e.empId, 'e1')
  assert.equal(e.kind, 'qualitaet')
  assert.equal(e.title, 'Objektkontrolle Autohaus Maxglan: 2 Räume nicht in Ordnung')
  assert.equal(e.text, 'Büro 1: Boden (Staub) – unter dem Tisch\nWC Damen: WC (Kalk, Flecken)')
  assert.deepEqual(e.photos, [foto(1)])
  assert.equal(e.report.path, 'qualitaet/nachweise/2026/m1_bericht.pdf')
  assert.deepEqual(e.source, { type: 'qualitaet', measurementId: 'm1', rooms: [0, 1] })
  const doc = { ...emptyAkte(), entries: [{ id: 'a1', ...e }] }
  assert.deepEqual(entriesFromMeasurement(measurement(), { doc }), [], 'nicht doppelt')
})

test('Ab drei offenen Vermerken: Gespräch fällig; Lob und Notiz zählen nicht; Ausgetretene nicht', () => {
  const doc = emptyAkte()
  const add = (empId, date, kind = 'qualitaet') => doc.entries.push({ id: `${empId}-${date}-${kind}`, empId, date, kind, title: '', at: '' })
  add('e1', '2026-10-01')
  add('e1', '2026-10-15', 'reklamation')
  add('e1', '2026-11-02', 'lob')
  add('e2', '2026-11-01')
  add('e2', '2026-11-05')
  add('e2', '2026-11-06', 'verhalten')
  add('e3', '2026-11-01')
  add('e3', '2026-11-02')
  add('e3', '2026-11-03')
  const employees = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }, { id: 'e3', name: 'Cem', exitDate: '2026-11-10' }]
  const due = talksDue(doc, employees, '2026-11-26')
  assert.deepEqual(due.map((x) => [x.emp.id, x.entries.length, x.since]), [['e2', 3, '2026-11-01']])
  assert.equal(openEntries(doc, 'e1').length, 2)
  assert.deepEqual(summary(doc, 'e1'), { empId: 'e1', open: 2, total: 3, last: '2026-11-02', talks: 0, lastTalk: '' })
  doc.settings.limit = 2
  assert.deepEqual(talksDue(doc, employees, '2026-11-26').map((x) => x.emp.id), ['e2', 'e1'])
})

test('Gespräch: gewählte Vermerke gelten als besprochen, die Erinnerung verschwindet', () => {
  const doc = emptyAkte()
  for (const d of ['2026-11-01', '2026-11-05', '2026-11-06']) doc.entries.push({ id: d, empId: 'e2', date: d, kind: 'qualitaet' })
  const t = recordTalk(doc, { id: 't1', empId: 'e2', date: '2026-11-26', entryIds: ['2026-11-01', '2026-11-05', '2026-11-06'], note: ' Zeitdruck im Objekt ', agreed: 'Checkliste WC', by: 'Petra', at: 'x' })
  assert.equal(t.note, 'Zeitdruck im Objekt')
  assert.deepEqual(openEntries(doc, 'e2'), [])
  assert.deepEqual(talksDue(doc, [{ id: 'e2', name: 'Bob' }], '2026-11-26'), [])
  assert.equal(summary(doc, 'e2').lastTalk, '2026-11-26')
})

test('Wer hat gereinigt? Der letzte Einsatz im Objekt bis zur Kontrolle, höchstens 7 Tage zurück', () => {
  const a = [
    { date: '2026-11-18', objectId: 'o1', employeeId: 'e1' },
    { date: '2026-11-19', objectId: 'o1', employeeId: 'e2' },
    { date: '2026-11-19', objectId: 'o1', employeeId: 'e3' },
    { date: '2026-11-21', objectId: 'o1', employeeId: 'e4' },
    { date: '2026-11-20', objectId: 'o2', employeeId: 'e5' },
  ]
  assert.deepEqual(suggestCleaners(a, 'o1', '2026-11-20'), ['e2', 'e3'])
  assert.deepEqual(suggestCleaners(a, 'o1', '2026-12-10'), [], 'zu lange her')
  assert.deepEqual(suggestCleaners(a, 'o9', '2026-11-20'), [])
})

test('Aufräumen: besprochene Vermerke nach 24 Monaten weg, offene bleiben', () => {
  const doc = { entries: [{ id: 'a', empId: 'e1', date: '2024-01-10', kind: 'qualitaet', talkId: 't1' }, { id: 'b', empId: 'e1', date: '2024-01-12', kind: 'qualitaet' }, { id: 'c', empId: 'e1', date: '2026-01-10', kind: 'qualitaet', talkId: 't2' }], talks: [{ id: 't1', empId: 'e1', date: '2024-02-01' }, { id: 't2', empId: 'e1', date: '2026-02-01' }], settings: {} }
  const r = purge(doc, '2026-11-26')
  assert.deepEqual(r.entries.map((e) => e.id), ['a'])
  assert.deepEqual(doc.entries.map((e) => e.id), ['b', 'c'])
  assert.deepEqual(doc.talks.map((t) => t.id), ['t2'])
})

test('Ordner in SharePoint: lesbarer Name ohne Sonderzeichen und die ID', () => {
  assert.equal(folderOf({ id: 'e7', name: 'Ilknur Günes' }), 'mitarbeiterakte/Ilknur-Gunes_e7')
  assert.equal(folderOf({ id: 'e8', name: 'Ion- Konstantin Kast' }), 'mitarbeiterakte/Ion-Konstantin-Kast_e8')
})
