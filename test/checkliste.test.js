// Leistungs-Checkliste am Handy (core/checkliste.js, core/checkliste-buero.js, core/checkliste-vorlagen.js): Punkte je Einsatz mit Wochentag-Regel
// und „1× pro Woche“, Übertragung ans Handy (mit Übersetzungen), Stände vom Webspace übernehmen (Merge wie die
// Stempelungen), Auswertung für Einsatz-Dialog, „Zu erledigen“ und Leistungsnachweis, Vorlagen, KI-Übersetzung.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checksByInst, instSummary, itemsFor, publishItems, summaryText } from '../src/core/checkliste.js'
import { checkKey, checklistTranslationRequest, checkPhotoPath, checkTodos, cleanItems, fromServer, mergeChecks, notPossibleSig, parseChecklistTranslation, pendingFromServer, summaryOf, whenOf } from '../src/core/checkliste-buero.js'
import { CHECKLIST_TEMPLATES, fromTemplate } from '../src/core/checkliste-vorlagen.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { proofFor } from '../src/core/proof.js'
import { createContext } from '../src/core/rules.js'
import { FOREIGN_LANGUAGES, LANGUAGES, sourceKey } from '../src/core/sprachen.js'
import { staffWeek } from '../src/core/staffplan.js'
import { checkCellText, proofDocument } from '../src/export/proof-pdf.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, name) => ({ id, name, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
const CHECKLIST = [
  { id: 'p1', text: 'Böden feucht wischen' },
  { id: 'p2', text: 'Glasflächen Eingang', photo: true, i18n: { tr: { text: 'Girişteki cam yüzeyler', source: sourceKey('Glasflächen Eingang') }, en: { text: 'Old glass text', source: sourceKey('Glas Eingang') } } },
  { id: 'p3', text: 'Kühlschrank auswischen', days: [5] },
  { id: 'p4', text: 'Glastrennwände', weekly: true },
]
const task = (extra = {}) => ({ id: 'u', objectId: 'o1', label: 'Büroreinigung', recurrence: { type: 'weekly', weekdays: [1, 3, 5] }, start: '18:00', end: '20:00', staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', checklist: CHECKLIST, ...extra })

function setup() {
  // November 2026: Mo 9., Mi 11., Fr 13.; Mo 16. …
  const data = { employees: [emp('x', 'Ana Popescu'), emp('y', 'Bogdan Ionescu')], objects: [{ id: 'o1', name: 'Kanzlei Lehen' }], tasks: [task()], absences: [], rules: {}, overrides: {} }
  const holidays = holidayCalendar('2026-11-01', '2026-11-30')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-09', '2026-11-22', holidays, ctx.rules)
  const asg = Object.fromEntries(instances.map((i) => [i.key, [{ employeeId: 'x' }]]))
  return { data, ctx, instances, state: new PlanState(instances, asg) }
}
const inst = (instances, date) => instances.find((i) => i.date === date)

test('Checkliste: Punkte bereinigen (leer, Kennung, doppelt, höchstens 30, 1× pro Woche ohne Tage)', () => {
  const out = cleanItems([
    { id: 'a1', text: '  Böden   wischen ' },
    { id: 'a1', text: 'doppelt' },
    { id: 'A B', text: 'falsche Kennung' },
    { id: 'a2', text: '   ' },
    { id: 'a3', text: 'Wochentage', days: [5, 1, 1, 9] },
    { id: 'a4', text: 'alle Tage', days: [1, 2, 3, 4, 5, 6, 7] },
    { id: 'a5', text: 'Woche', weekly: true, days: [2] },
    { id: 'a6', text: 'x'.repeat(300), photo: 1 },
  ])
  assert.deepEqual(
    out.map((x) => [x.id, x.text.length > 40 ? x.text.length : x.text, x.days, x.weekly, x.photo]),
    [
      ['a1', 'Böden wischen', undefined, undefined, undefined],
      ['a3', 'Wochentage', [1, 5], undefined, undefined],
      ['a4', 'alle Tage', undefined, undefined, undefined],
      ['a5', 'Woche', undefined, true, undefined],
      ['a6', 160, undefined, undefined, true],
    ],
  )
  assert.equal(cleanItems(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `Punkt ${i}` }))).length, 30)
  assert.deepEqual([whenOf({}), whenOf({ days: [1] }), whenOf({ weekly: true })], ['immer', 'tage', 'woche'])
})

test('Checkliste: Punkte je Einsatz (Wochentag-Regel, 1× pro Woche beim ersten Einsatz, abgesagt ohne)', () => {
  const { data, instances } = setup()
  const t = data.tasks[0]
  const ids = (date) => itemsFor(t, inst(instances, date), instances).map((x) => x.id)
  assert.deepEqual(ids('2026-11-09'), ['p1', 'p2', 'p4'], 'Montag: erster Einsatz der Woche → 1× pro Woche dabei')
  assert.deepEqual(ids('2026-11-11'), ['p1', 'p2'], 'Mittwoch')
  assert.deepEqual(ids('2026-11-13'), ['p1', 'p2', 'p3'], 'Freitag: nur-Freitag-Punkt')
  assert.deepEqual(ids('2026-11-16'), ['p1', 'p2', 'p4'], 'neue Woche')
  // Montag abgesagt: der Mittwoch ist der erste Einsatz der Woche
  const cancelled = instances.map((i) => (i.date === '2026-11-09' ? { ...i, status: 'cancelled' } : i))
  assert.deepEqual(itemsFor(t, inst(cancelled, '2026-11-09'), cancelled), [])
  assert.deepEqual(itemsFor(t, inst(cancelled, '2026-11-11'), cancelled).map((x) => x.id), ['p1', 'p2', 'p4'])
  assert.deepEqual(itemsFor({ ...t, checklist: [] }, inst(instances, '2026-11-09'), instances), [])
  assert.deepEqual(itemsFor(undefined, inst(instances, '2026-11-09'), instances), [])
})

test('Checkliste: fürs Handy mit Übersetzungen (aktuell, veraltet) und „Foto nötig“; im Plan der Person', () => {
  const { data, instances } = setup()
  const items = publishItems(data.tasks[0], inst(instances, '2026-11-09'), instances)
  assert.deepEqual(items, [
    { id: 'p1', text: 'Böden feucht wischen' },
    { id: 'p2', text: 'Glasflächen Eingang', foto: true, uebersetzt: { tr: { text: 'Girişteki cam yüzeyler' }, en: { text: 'Old glass text', veraltet: true } } },
    { id: 'p4', text: 'Glastrennwände' },
  ])
  // staffWeek: Checkliste nur bei Einsätzen (nicht bei entfallenen), nur mit checklistOf
  const i9 = inst(instances, '2026-11-09')
  const ts = { monday: '2026-11-09', days: [{ date: '2026-11-09', lines: [{ kind: 'work', inst: i9, time: '18:00 - 20:00', text: 'Kanzlei', notes: [] }, { kind: 'missed', inst: { ...i9, key: 'x' }, time: '', text: '', notes: [] }] }], totals: { ist: 120, soll: 120 } }
  const week = staffWeek(ts, { objectsById: new Map([['o1', data.objects[0]]]), checklistOf: (i) => publishItems(data.tasks[0], i, instances) })
  assert.equal(week.tage[0].eintraege[0].checkliste.length, 3)
  assert.equal(week.tage[0].eintraege[1].checkliste, undefined)
  assert.equal(staffWeek(ts, {}).tage[0].eintraege[0].checkliste, undefined, 'ohne checklistOf wie bisher')
})

const server = (extra = {}) => ({ id: 'aaaaaaaaaaaa', hash: 'h'.repeat(64), name: 'Ana Popescu', einsatz: '2026-11-09|u', datum: '2026-11-09', objektId: 'o1', objekt: 'Kanzlei Lehen', leistung: 'Büroreinigung', punkte: [{ id: 'p1', text: 'Böden feucht wischen', status: 'ok', zeit: 1794250000 }, { id: 'p2', text: 'Glasflächen Eingang', foto: true, status: 'ok', bild: 'aaaaaaaaaaaa-p2-abcdef.jpg', zeit: 1794250100 }, { id: 'p4', text: 'Glastrennwände', status: 'nicht', grund: 'Raum versperrt' }], fertig: 1794250200, geaendert: 1794250200, ...extra })

test('Checkliste: vom Webspace übernehmen (prüfen, Person, Merge: neuer gewinnt, Foto-Ablage und „Gesehen“ bleiben)', () => {
  const index = new Map([['h'.repeat(64), 'x']])
  const c = fromServer(server(), index)
  assert.equal(checkKey(c), '2026-11-09|kaaaaaaaaaaaa')
  assert.deepEqual([c.empId, c.instKey, c.objectName, c.finished], ['x', '2026-11-09|u', 'Kanzlei Lehen', new Date(1794250200e3).toISOString()])
  assert.deepEqual(c.items.map((x) => [x.id, x.status, x.reason, x.photo?.datei || null, x.photoRequired]), [
    ['p1', 'ok', '', null, false],
    ['p2', 'ok', '', 'aaaaaaaaaaaa-p2-abcdef.jpg', true],
    ['p4', 'nicht', 'Raum versperrt', null, false],
  ])
  assert.equal(fromServer(server({ id: '../x' }), index), null)
  assert.equal(fromServer(server({ einsatz: 'kaputt' }), index), null)
  assert.equal(fromServer(server({ punkte: [{ id: 'p1', status: 'egal', grund: 'x', bild: '../etc.jpg' }] }), index).items[0].status, '')
  assert.equal(fromServer(server(), new Map()).empId, null, 'unbekannter Link: ohne Person')

  const checks = {}
  assert.equal(mergeChecks(checks, [server(), { id: 'kaputt' }], index), 1)
  const key = '2026-11-09|kaaaaaaaaaaaa'
  Object.assign(checks[key].items[1].photo, { pfad: 'plaene/checklisten/2026/x.jpg', webspaceGeloescht: true })
  checks[key].seen = { sig: 'p4:Raum versperrt', at: 'x', by: 'Büro' }
  assert.equal(mergeChecks(checks, [server({ geaendert: 1794250000 })], index), 0, 'älter: bleibt')
  assert.equal(mergeChecks(checks, [server({ geaendert: 1794251000 })], index), 1)
  assert.equal(checks[key].items[1].photo.pfad, 'plaene/checklisten/2026/x.jpg', 'gleiches Foto: Ablage bleibt')
  assert.equal(checks[key].seen.by, 'Büro')
  const neu = server({ geaendert: 1794252000 })
  neu.punkte[1].bild = 'aaaaaaaaaaaa-p2-123456.jpg'
  mergeChecks(checks, [neu], index)
  assert.deepEqual(checks[key].items[1].photo, { datei: 'aaaaaaaaaaaa-p2-123456.jpg' }, 'neues Foto: neu ablegen')
  assert.equal(mergeChecks(checks, null, index), 0)
  assert.equal(checkPhotoPath(checks[key], 'aaaaaaaaaaaa-p2-123456.jpg'), 'plaene/checklisten/2026/2026-11-09_Kanzlei-Lehen_aaaaaaaaaaaa-p2-123456.jpg')
  assert.equal(checkPhotoPath({ date: '2026-11-09', objectName: 'Straße/Ärztehaus' }, 'f.jpg'), 'plaene/checklisten/2026/2026-11-09_Strasse-Arztehaus_f.jpg')
})

test('Checkliste: Stand, Zusammenfassung für den Nachweis (mehrere Personen), Kennzeichen „nicht möglich“', () => {
  const index = new Map([['h'.repeat(64), 'x'], ['g'.repeat(64), 'y']])
  const a = fromServer(server(), index)
  assert.deepEqual(summaryOf(a), { total: 3, done: 2, notPossible: 1, open: 0, photos: 1, finished: true })
  assert.equal(notPossibleSig(a), 'p4:Raum versperrt')
  // zweite Person: hat p4 erledigt, p1 offen
  const b = fromServer(server({ id: 'bbbbbbbbbbbb', hash: 'g'.repeat(64), punkte: [{ id: 'p1', text: 'Böden feucht wischen' }, { id: 'p4', text: 'Glastrennwände', status: 'ok' }, { id: 'p5', text: 'Extra', status: 'nicht', grund: 'Zu wenig Zeit' }], fertig: 0 }), index)
  const s = instSummary([a, b])
  assert.deepEqual(s, { total: 4, done: 3, notPossible: [{ text: 'Extra', reason: 'Zu wenig Zeit' }], open: 0, finished: false })
  assert.equal(summaryText(s), '3 von 4 erledigt')
  assert.equal(instSummary([]), null)
  assert.equal(instSummary([{ items: [] }]), null)
  const map = checksByInst({ [checkKey(a)]: a, [checkKey(b)]: b, old: { ...a, date: '2026-10-01', instKey: '2026-10-01|u' } }, { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual([...map.keys()], ['2026-11-09|u'])
  assert.equal(map.get('2026-11-09|u').length, 2)
  assert.equal(checkCellText(s), '3 von 4 erledigt\nnicht möglich: Extra (Zu wenig Zeit)')
  assert.equal(checkCellText({ total: 3, done: 1, notPossible: [], open: 2 }), '1 von 3 erledigt\n2 offen')
  assert.equal(checkCellText(null), '–')
})

test('Checkliste: „Zu erledigen“ – nicht möglich bis „Gesehen“, nicht fertig laut Webspace (bis fertig übernommen)', () => {
  const index = new Map([['h'.repeat(64), 'x']])
  const a = fromServer(server(), index)
  const checks = { [checkKey(a)]: a }
  const pending = pendingFromServer([
    { hash: 'h'.repeat(64), einsatz: '2026-11-11|u', datum: '2026-11-11', zeit: '18:00–20:00', objekt: 'Kanzlei Lehen' },
    { hash: 'h'.repeat(64), einsatz: '2026-11-09|u', datum: '2026-11-09', zeit: '18:00–20:00', objekt: 'Kanzlei Lehen' },
    { hash: 'unbekannt', einsatz: '2026-11-11|u', datum: '2026-11-11' },
    { hash: 'h'.repeat(64), einsatz: 'kaputt', datum: '2026-11-11' },
  ], index)
  assert.deepEqual(pending.map((p) => [p.empId, p.instKey, p.time, p.objectName]), [['x', '2026-11-11|u', '18:00–20:00', 'Kanzlei Lehen'], ['x', '2026-11-09|u', '18:00–20:00', 'Kanzlei Lehen']])
  let todos = checkTodos({ checks, pending, since: '2026-11-01' })
  assert.deepEqual(todos.map((x) => [x.kind, x.instKey || x.key]), [['nicht', checkKey(a)], ['fehlt', '2026-11-11|u']], 'Montag inzwischen fertig übernommen: nicht mehr offen')
  // „Gesehen“: weg, bis ein neuer Grund dazukommt
  a.seen = { sig: notPossibleSig(a) }
  assert.deepEqual(checkTodos({ checks, since: '2026-11-01' }), [])
  a.items[0] = { ...a.items[0], status: 'nicht', reason: 'Kein Zugang (Schlüssel, Code)' }
  assert.equal(checkTodos({ checks, since: '2026-11-01' })[0].kind, 'nicht')
  assert.equal(checkTodos({ checks, since: '2026-11-10' }).length, 0, 'älter als since: nicht mehr')
  // halb ausgefüllt: steht mit Stand
  const halb = fromServer(server({ id: 'cccccccccccc', einsatz: '2026-11-11|u', datum: '2026-11-11', fertig: 0, punkte: [{ id: 'p1', text: 'Böden', status: 'ok' }, { id: 'p2', text: 'Glas' }] }), index)
  todos = checkTodos({ checks: { [checkKey(halb)]: halb }, pending })
  assert.equal(todos.find((x) => x.kind === 'fehlt' && x.instKey === '2026-11-11|u').check.id, 'cccccccccccc')
  assert.deepEqual(checkTodos({}), [])
})

test('Checkliste im Leistungsnachweis: je Einsatz erledigt x von y, nicht möglich mit Grund; ohne checks unverändert; PDF-Spalte', () => {
  const { ctx, instances, state } = setup()
  const a = fromServer(server(), new Map([['h'.repeat(64), 'x']]))
  const base = { objectId: 'o1', from: '2026-11-01', to: '2026-11-30', instances, state, employeesById: ctx.employeesById, today: '2026-11-25' }
  const plain = proofFor(base)
  assert.ok(!('check' in plain.rows[0]) && !('checks' in plain.totals), 'ohne checks: Nachweis wie bisher')
  const p = proofFor({ ...base, checks: { [checkKey(a)]: a } })
  const row = p.rows.find((r) => r.date === '2026-11-09')
  assert.deepEqual(row.check, { total: 3, done: 2, notPossible: [{ text: 'Glastrennwände', reason: 'Raum versperrt' }], open: 0, finished: true })
  assert.equal(p.rows.find((r) => r.date === '2026-11-11').check, null)
  assert.deepEqual(p.totals.checks, { rows: 1, items: 3, done: 2, notPossible: 1 })
  const doc = (withChecks) => JSON.stringify(proofDocument({ object: { name: 'Kanzlei Lehen' }, monthLabel: 'November 2026', from: base.from, to: base.to, proof: p, withChecks }))
  assert.ok(doc(true).includes('"Checkliste"') && doc(true).includes('nicht möglich: Glastrennwände (Raum versperrt)') && doc(true).includes('Checkliste: 2 von 3 Punkten erledigt, 1 nicht möglich'))
  assert.ok(!doc(false).includes('Glastrennwände (Raum versperrt)'), 'ausgeschaltet: keine Spalte')
})

test('Checkliste: Vorlagen (Büro, Sanitär, Stiegenhaus, Küche, Glas) in allen Sprachen, Übernahme mit Übersetzungen', () => {
  assert.deepEqual(CHECKLIST_TEMPLATES.map((t) => t.label), ['Büro', 'Sanitär', 'Stiegenhaus', 'Küche', 'Glas'])
  for (const t of CHECKLIST_TEMPLATES) {
    assert.ok(t.items.length >= 4 && t.items.length <= 8, t.id)
    for (const x of t.items) {
      for (const l of LANGUAGES) assert.ok(typeof x[l.id] === 'string' && x[l.id].trim() && x[l.id].length <= 160, `${t.id}: ${x.de} (${l.id})`)
      for (const l of FOREIGN_LANGUAGES) assert.notEqual(x[l.id], x.de, `${t.id}: ${x.de} nicht übersetzt (${l.id})`)
    }
  }
  let n = 0
  const newId = () => `v${++n}`
  const glas = CHECKLIST_TEMPLATES.find((t) => t.id === 'glas')
  const items = fromTemplate(glas, [{ id: 'a', text: 'Fensterbänke abwischen' }], { newId, at: '2026-11-09' })
  assert.deepEqual(items.map((x) => x.text), ['Fensterbänke abwischen', 'Glasflächen Eingang reinigen', 'Glastüren und Griffbereiche reinigen', 'Glastrennwände innen reinigen'], 'schon vorhandene nicht doppelt')
  assert.equal(items[1].photo, true)
  assert.equal(items[3].weekly, true)
  assert.deepEqual(Object.keys(items[1].i18n), FOREIGN_LANGUAGES.map((l) => l.id))
  assert.deepEqual(items[1].i18n.tr, { text: 'Girişteki cam yüzeyleri temizle', source: sourceKey('Glasflächen Eingang reinigen'), at: '2026-11-09', by: 'Vorlage' })
  // übernommen = aktuell übersetzt (nicht veraltet) und so auch am Handy
  const pub = publishItems({ checklist: cleanItems(items) }, { key: 'k', taskId: 't', date: '2026-11-09', weekday: 1, start: 0 }, [])
  assert.equal(pub[1].uebersetzt.hu.text, 'Tisztítsd meg a bejárat üvegfelületeit')
  assert.ok(!pub[1].uebersetzt.hu.veraltet)
  assert.equal(fromTemplate(glas, Array.from({ length: 29 }, (_, i) => ({ id: `x${i}`, text: `P${i}` })), { newId }).length, 30, 'höchstens 30')
})

test('Checkliste: KI-Übersetzung aller Punkte (Anfrage, Antwort geprüft: gleiche Zahl, ohne Nummern)', () => {
  const req = checklistTranslationRequest(['Böden wischen', 'Müll entleeren'], ['tr', 'hu'])
  assert.match(req.system[0].text, /Gebäudereinigung/)
  assert.match(req.messages[0].content, /<checkliste>\n1\. Böden wischen\n2\. Müll entleeren\n<\/checkliste>/)
  assert.deepEqual(req.output_config.format.schema.required, ['tr', 'hu'])
  assert.equal(req.output_config.format.schema.properties.tr.type, 'array')
  assert.deepEqual(parseChecklistTranslation('{"tr":["1. Zemini sil","Çöpü boşalt"],"hu":["csak egy"]}', ['tr', 'hu'], 2), { tr: ['Zemini sil', 'Çöpü boşalt'] })
  assert.deepEqual(parseChecklistTranslation('Hier: {"tr":["a","b"]} fertig', ['tr'], 2), { tr: ['a', 'b'] })
  assert.throws(() => parseChecklistTranslation('keine Antwort', ['tr'], 2), /keine Übersetzung/)
})
