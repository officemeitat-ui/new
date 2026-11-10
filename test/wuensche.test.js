// Wunschzeiten (core/wuensche.js): Wünsche prüfen, Gründe für die Automatik, Bericht „erfüllt“, und die Automatik
// selbst (core/scheduler.js) gibt einen offenen Einsatz lieber jemandem ohne Wunschfrei.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeWish, syncHandyWishes, wishFactors, wishIndex, wishReport, wishStats } from '../src/core/wuensche.js'

let n = 0
const newId = () => `w${++n}`
const today = '2026-11-09'

test('Wünsche: prüfen (Art, Datum, Zukunft, doppelt, Widerspruch, Grenze je Woche), Wochenwunsch auf den Montag', () => {
  assert.match(makeWish({ empId: 'e1', date: '2026-11-12' }, { today }).error, /Art/)
  assert.match(makeWish({ empId: 'e1', kind: 'frei', date: '2026-11-09' }, { today }).error, /Zukunft/)
  assert.match(makeWish({ empId: 'e1', kind: 'frei', date: '2027-03-01' }, { today }).error, /Wochen voraus/)
  const a = makeWish({ empId: 'e1', kind: 'frei', date: '2026-11-12', note: '  Arzt   termin ' }, { today, newId }).wish
  assert.deepEqual([a.date, a.kind, a.note, a.source], ['2026-11-12', 'frei', 'Arzt termin', 'buero'])
  assert.match(makeWish({ empId: 'e1', kind: 'frei', date: '2026-11-12' }, { today, existing: [a] }).error, /schon/)
  assert.match(makeWish({ empId: 'e1', kind: 'frueh', date: '2026-11-12' }, { today, existing: [a] }).error, /anderen Wunsch/)
  const w = makeWish({ empId: 'e1', kind: 'mehr', date: '2026-11-19' }, { today, newId }).wish
  assert.equal(w.date, '2026-11-16', 'Montag der Woche')
  assert.match(makeWish({ empId: 'e1', kind: 'weniger', date: '2026-11-17' }, { today, existing: [w] }).error, /Stunden-Wunsch/)
  // diese Woche (Mo heute) ist für Stunden-Wünsche noch nicht vorbei
  assert.ok(makeWish({ empId: 'e1', kind: 'mehr', date: today }, { today, newId }).wish)
  const four = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map((d) => makeWish({ empId: 'e2', kind: 'frei', date: d }, { today, newId }).wish)
  assert.match(makeWish({ empId: 'e2', kind: 'frei', date: '2026-11-21' }, { today, existing: four }).error, /Höchstens 4/)
  assert.ok(makeWish({ empId: 'e3', kind: 'frei', date: '2026-11-21' }, { today, existing: four }).wish, 'andere Person zählt nicht')
  // Wunschfrei am Montag verträgt sich mit „mehr Stunden“ in derselben Woche (in beide Richtungen)
  assert.ok(makeWish({ empId: 'e1', kind: 'frei', date: '2026-11-16' }, { today, existing: [w], newId }).wish)
  const mo = makeWish({ empId: 'e4', kind: 'frei', date: '2026-11-16' }, { today, newId }).wish
  assert.ok(makeWish({ empId: 'e4', kind: 'weniger', date: '2026-11-18' }, { today, existing: [mo], newId }).wish)
})

test('Wünsche: nur Tage, die es gibt (wie wunsch_pruefen in mein-plan.php), auch nicht auf einen Montag umgerechnet', () => {
  for (const date of ['2026-11-31', '2026-13-01', '2026-11-00']) {
    for (const kind of ['frei', 'mehr']) assert.match(makeWish({ empId: 'e1', kind, date }, { today }).error, /Datum/, `${kind} ${date}`)
  }
  assert.ok(makeWish({ empId: 'e1', kind: 'mehr', date: '2026-11-30' }, { today, newId }).wish)
})

test('Wünsche vom Handy: neue übernehmen (Wochenwunsch auf den Montag), am Handy gelöschte weg, vorbei bleibt', () => {
  const index = new Map([['h1', 'e1'], ['h2', 'e2']])
  const server = [
    { id: 'aaaaaaaaaaa1', hash: 'h1', art: 'frei', datum: '2026-11-12', notiz: '  Familie  ', erstellt: 1794000000 },
    { id: 'aaaaaaaaaaa2', hash: 'h2', art: 'mehr', datum: '2026-11-18', notiz: '', erstellt: 1794000000 },
    { id: 'aaaaaaaaaaa3', hash: 'unbekannt', art: 'frei', datum: '2026-11-13' },
    { id: 'kaputt', hash: 'h1', art: 'frei', datum: '2026-11-13' },
    { id: 'aaaaaaaaaaa4', hash: 'h1', art: 'urlaub', datum: '2026-11-13' },
    { id: 'aaaaaaaaaaa5', hash: 'h1', art: 'spaet', datum: '2026-11-14' },
  ]
  const current = {
    '2026-11-14|haaaaaaaaaaa5': { id: 'haaaaaaaaaaa5', webId: 'aaaaaaaaaaa5', empId: 'e1', date: '2026-11-14', kind: 'spaet', source: 'handy' },
    '2026-11-11|hbbbbbbbbbbb1': { id: 'hbbbbbbbbbbb1', webId: 'bbbbbbbbbbb1', empId: 'e1', date: '2026-11-11', kind: 'frueh', source: 'handy' },
    '2026-11-05|hbbbbbbbbbbb2': { id: 'hbbbbbbbbbbb2', webId: 'bbbbbbbbbbb2', empId: 'e1', date: '2026-11-05', kind: 'frei', source: 'handy' },
    '2026-11-11|w1': { id: 'w1', empId: 'e2', date: '2026-11-11', kind: 'frei', source: 'buero' },
  }
  const { add, remove } = syncHandyWishes(server, current, { index, today: '2026-11-10' })
  assert.deepEqual(add.map((w) => [w.id, w.webId, w.empId, w.date, w.kind, w.note, w.source]), [
    ['haaaaaaaaaaa1', 'aaaaaaaaaaa1', 'e1', '2026-11-12', 'frei', 'Familie', 'handy'],
    ['haaaaaaaaaaa2', 'aaaaaaaaaaa2', 'e2', '2026-11-16', 'mehr', '', 'handy'],
  ])
  assert.match(add[0].at, /^2026-11-/)
  assert.deepEqual(remove, ['2026-11-11|hbbbbbbbbbbb1'], 'am Handy gelöscht; vorbei (05.11.) und Büro-Wünsche bleiben')
  // im Büro gelöscht, am Webspace noch nicht: nicht wieder übernehmen
  assert.deepEqual(syncHandyWishes(server, {}, { index, today: '2026-11-10', gone: ['aaaaaaaaaaa1'] }).add.map((w) => w.webId), ['aaaaaaaaaaa2', 'aaaaaaaaaaa5'])
  assert.deepEqual(syncHandyWishes([], {}, { index, today: '2026-11-10' }), { add: [], remove: [] })
})

test('Wünsche: Gründe für die Automatik (Wunschfrei schwer, früh/spät, mehr/weniger je Woche)', () => {
  const idx = wishIndex({
    a: { id: 'a', empId: 'e1', date: '2026-11-12', kind: 'frei' },
    b: { id: 'b', empId: 'e2', date: '2026-11-12', kind: 'frueh' },
    c: { id: 'c', empId: 'e3', date: '2026-11-09', kind: 'mehr' },
    d: { id: 'd', empId: 'e4', date: '2026-11-12', kind: 'spaet' },
  })
  const inst = (startTime, date = '2026-11-12') => ({ date, startTime })
  assert.deepEqual(wishFactors(idx, 'e1', inst('06:00')).map((f) => f.points), [35])
  assert.deepEqual(wishFactors(idx, 'e2', inst('06:00')).map((f) => f.points), [-8])
  assert.deepEqual(wishFactors(idx, 'e2', inst('17:00')).map((f) => f.points), [12])
  assert.deepEqual(wishFactors(idx, 'e4', inst('17:00')).map((f) => f.points), [-8])
  assert.deepEqual(wishFactors(idx, 'e3', inst('10:00')).map((f) => f.points), [-10], 'mehr Stunden gilt die ganze Woche')
  assert.deepEqual(wishFactors(idx, 'e9', inst('10:00')), [])
  assert.deepEqual(wishFactors(new Map(), 'e1', inst('06:00')), [])
})

test('Wünsche: Bericht erfüllt/nicht erfüllt und Quote je Person', () => {
  const wishes = {
    a: { id: 'a', empId: 'e1', date: '2026-11-12', kind: 'frei' },
    b: { id: 'b', empId: 'e1', date: '2026-11-13', kind: 'frueh' },
    c: { id: 'c', empId: 'e2', date: '2026-11-09', kind: 'mehr' },
    d: { id: 'd', empId: 'e2', date: '2026-12-20', kind: 'frei' },
  }
  const own = {
    e1: [{ date: '2026-11-12', startTime: '06:00', net: 120 }, { date: '2026-11-13', startTime: '07:00', net: 120 }, { date: '2026-11-13', startTime: '17:00', net: 60, status: 'cancelled' }],
    e2: [{ date: '2026-11-10', startTime: '06:00', net: 1500 }, { date: '2026-11-11', startTime: '06:00', net: 1200 }],
  }
  const r = wishReport(wishes, { instancesOf: (id) => own[id] || [], contractMin: () => 2400, from: '2026-11-09', to: '2026-11-15' })
  assert.deepEqual(r.map((x) => [x.wish.id, x.ok, x.text]), [['c', true, '45 h geplant, Vertrag 40 h'], ['a', false, '1 Einsatz an dem Tag'], ['b', true, 'passt']])
  const s = wishStats(r)
  assert.deepEqual(s.get('e1'), { total: 2, ok: 1 })
  assert.deepEqual(s.get('e2'), { total: 1, ok: 1 })
})

test('Wünsche: die Automatik gibt einen offenen Einsatz lieber jemandem ohne Wunschfrei', async () => {
  const { holidayCalendar } = await import('../src/core/holidays.js')
  const { buildInstances } = await import('../src/core/plan.js')
  const { createContext } = await import('../src/core/rules.js')
  const { autoPlan } = await import('../src/core/scheduler.js')
  const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
  const emp = (id) => ({ id, name: id, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
  const tasks = [{ id: 't', objectId: 'o1', label: 't', recurrence: { type: 'weekly', weekdays: [3] }, start: '06:00', end: '10:00', staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt' }]
  const plan = (wishes) => {
    // a und b gleich gut; ohne Wunsch nimmt die Automatik a (Reihenfolge), mit Wunschfrei für a am Mittwoch b
    const data = { employees: [emp('a'), emp('b')], objects: [{ id: 'o1', name: 'A' }], tasks, absences: [], rules: {}, travel: {}, trips: {}, overrides: {}, wishes }
    const holidays = holidayCalendar('2026-11-01', '2026-11-30')
    const ctx = createContext(data, holidays)
    const instances = buildInstances(data, '2026-11-01', '2026-11-30', holidays, ctx.rules)
    const res = autoPlan(ctx, instances, {}, { from: '2026-11-16', to: '2026-11-22' })
    return (res.assignments['2026-11-18|t'] || []).map((x) => x.employeeId)
  }
  const without = plan({})
  const wished = without[0]
  const other = wished === 'a' ? 'b' : 'a'
  assert.deepEqual(plan({ x: { id: 'x', empId: wished, date: '2026-11-18', kind: 'frei' } }), [other])
  assert.deepEqual(plan({ x: { id: 'x', empId: other, date: '2026-11-17', kind: 'frei' } }), without, 'Wunsch an einem anderen Tag ändert nichts')
})
