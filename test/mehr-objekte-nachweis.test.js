import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { objectsWithWork, proofFor, proofMailText, sentKey } from '../src/core/proof.js'
import { createContext } from '../src/core/rules.js'

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, name) => ({ id, name, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: ['o1'], availability: allDays })
const task = (id, weekdays, start, end, extra = {}) => ({ id, objectId: 'o1', label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'findet_statt', ...extra })

// Dezember 2026: Di 8.12. Mariä Empfängnis
function setup({ overrides = {}, assign = (i) => [{ employeeId: 'x' }] } = {}) {
  const data = {
    employees: [emp('x', 'Anna Maria Berger'), emp('y', 'Boris Kraus')],
    objects: [{ id: 'o1', name: 'Kanzlei am Markt' }, { id: 'o2', name: 'Lager Au' }],
    tasks: [
      task('Unterhaltsreinigung', [1, 2], '06:00', '08:00'),
      task('Sanitär', [2], '10:00', '11:00', { holidayRule: 'verschieben' }),
      task('Fenster', [2], '12:00', '13:00', { holidayRule: 'entfaellt', category: 'sonder' }),
      { ...task('Lager', [3], '06:00', '07:00'), objectId: 'o2' },
    ],
    absences: [],
    rules: {},
    overrides,
  }
  const holidays = holidayCalendar('2026-11-23', '2027-01-10')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-23', '2027-01-10', holidays, ctx.rules)
  const asg = {}
  for (const i of instances) if (i.status !== 'cancelled') asg[i.key] = assign(i)
  return { ctx, instances, state: new PlanState(instances, asg) }
}
const proof = (s, extra = {}) => proofFor({ objectId: 'o1', from: '2026-12-01', to: '2026-12-31', instances: s.instances, state: s.state, employeesById: s.ctx.employeesById, today: '2027-01-05', ...extra })
const row = (p, date, label) => p.rows.find((r) => r.date === date && r.label === label)

test('Leistungsnachweis: Feiertag mit „verschieben“ – erbracht am nächsten Werktag, Grund steht dabei', () => {
  const p = proof(setup())
  const moved = row(p, '2026-12-09', 'Sanitär')
  assert.deepEqual([moved.status, moved.reason, moved.time], ['erbracht', 'wegen Feiertag verschoben', '10:00–11:00'])
  assert.equal(row(p, '2026-12-08', 'Sanitär'), undefined, 'nicht doppelt am Feiertag')
  assert.equal(row(p, '2026-12-08', 'Fenster').reason, 'Feiertag (Mariä Empfängnis)')
})

test('Leistungsnachweis: von Hand abgesagt bzw. verschoben', () => {
  const p = proof(setup({ overrides: { '2026-12-14|Unterhaltsreinigung': { cancelled: true }, '2026-12-15|Unterhaltsreinigung': { date: '2026-12-17' } } }))
  assert.deepEqual([row(p, '2026-12-14', 'Unterhaltsreinigung').status, row(p, '2026-12-14', 'Unterhaltsreinigung').reason], ['entfallen', 'abgesagt'])
  assert.deepEqual([row(p, '2026-12-17', 'Unterhaltsreinigung').status, row(p, '2026-12-17', 'Unterhaltsreinigung').reason], ['erbracht', 'verschoben'])
  assert.equal(row(p, '2026-12-14', 'Unterhaltsreinigung').planMinutes, 0)
})

test('Leistungsnachweis: Monatsgrenze – abgesagt zählt nach dem ursprünglichen Tag, verschoben nach dem neuen', () => {
  const s = setup({ overrides: { '2026-11-30|Unterhaltsreinigung': { date: '2026-12-02' }, '2026-12-29|Unterhaltsreinigung': { date: '2027-01-04' }, '2026-11-24|Sanitär': { cancelled: true } } })
  const p = proof(s)
  assert.ok(row(p, '2026-12-02', 'Unterhaltsreinigung'), 'vom 30.11. in den Dezember verschoben')
  assert.equal(row(p, '2026-12-29', 'Unterhaltsreinigung'), undefined, 'in den Jänner verschoben: nicht im Dezember')
  assert.ok(!p.rows.some((r) => r.date === '2026-11-24'), 'Absage im November nicht im Dezember')
  assert.deepEqual([...objectsWithWork(s.instances, { from: '2026-11-24', to: '2026-11-24' })], ['o1'], 'abgesagter Einsatz zählt fürs Objekt')
  assert.deepEqual([...objectsWithWork(s.instances, { from: '2026-12-02', to: '2026-12-02' })].sort(), ['o1', 'o2'])
})

test('Leistungsnachweis: Minuten laut Plan je Person, nur erbrachte Einsätze', () => {
  const s = setup({ assign: (i) => (i.taskId === 'Unterhaltsreinigung' && i.date === '2026-12-07' ? [{ employeeId: 'x' }, { employeeId: 'y' }] : i.date === '2026-12-21' ? [] : [{ employeeId: 'x' }]) })
  const p = proof(s)
  assert.equal(row(p, '2026-12-07', 'Unterhaltsreinigung').planMinutes, 240, '2 h × 2 Personen')
  assert.equal(row(p, '2026-12-07', 'Unterhaltsreinigung').staff, 2)
  assert.deepEqual([row(p, '2026-12-21', 'Unterhaltsreinigung').status, row(p, '2026-12-21', 'Unterhaltsreinigung').planMinutes], ['offen', 0])
  assert.equal(p.totals.planMinutes, p.rows.reduce((sum, r) => sum + r.planMinutes, 0))
  assert.equal(p.totals.count, p.rows.length - p.totals.cancelled)
})

test('Leistungsnachweis: ausgetretene/gelöschte Person zählt nicht als besetzt', () => {
  const s = setup({ assign: (i) => (i.date === '2026-12-01' ? [{ employeeId: 'gibt-es-nicht' }] : [{ employeeId: 'x' }]) })
  const p = proof(s)
  assert.equal(row(p, '2026-12-01', 'Unterhaltsreinigung').status, 'offen')
  assert.deepEqual(row(p, '2026-12-01', 'Unterhaltsreinigung').persons, [])
})

test('Leistungsnachweis: Namen ganz, als Vorname oder gar nicht', () => {
  const s = setup()
  const at = (names) => row(proof(s, { names }), '2026-12-01', 'Unterhaltsreinigung').persons
  assert.deepEqual(at('voll'), ['Anna Maria Berger'])
  assert.deepEqual(at('vorname'), ['Anna'])
  assert.deepEqual(at('keine'), [])
})

test('Leistungsnachweis: Stempelung wird nur einem Einsatz zugeordnet, fremde Einsatz-Kennung zählt nicht', () => {
  const s = setup()
  const stamps = {
    a: { id: 'a', date: '2026-12-01', empId: 'x', objectId: 'o1', instKey: '2026-12-01|Sanitär', in: '2026-12-01T09:02:00.000Z', out: '2026-12-01T10:01:00.000Z' },
    b: { id: 'b', date: '2026-12-01', empId: 'x', objectId: 'o1', instKey: '', in: '2026-12-01T05:00:00.000Z', out: '2026-12-01T07:00:00.000Z' },
    c: { id: 'c', date: '2026-12-01', empId: 'y', objectId: 'o1', instKey: '', in: '2026-12-01T11:00:00.000Z', out: null },
  }
  const p = proof(s, { stamps })
  assert.deepEqual(row(p, '2026-12-01', 'Sanitär').ist, [{ in: '10:02', out: '11:01', minutes: 59 }])
  assert.deepEqual(row(p, '2026-12-01', 'Unterhaltsreinigung').ist, [{ in: '06:00', out: '08:00', minutes: 120 }])
  assert.deepEqual(row(p, '2026-12-01', 'Fenster').ist, [], 'Boris war nicht eingeteilt: seine Stempelung zählt nicht')
  assert.equal(p.totals.confirmed, 2)
  assert.equal(p.totals.istMinutes, 179)
})

test('Leistungsnachweis: heute laufender und späterer Einsatz sind „geplant“, Sonderleistungen gezählt', () => {
  const s = setup()
  const today = proof(s, { today: '2026-12-15' })
  assert.equal(row(today, '2026-12-15', 'Unterhaltsreinigung').status, 'erbracht', 'ohne Uhrzeit zählt heute ganz')
  assert.equal(row(today, '2026-12-21', 'Unterhaltsreinigung').status, 'geplant')
  assert.equal(today.totals.planned, today.rows.filter((r) => r.date > '2026-12-15').length)
  // Fenster (Sonderleistung) an jedem Dienstag außer dem Feiertag: 1., 15., 22., 29.
  assert.equal(today.totals.special, 4)
})

test('E-Mail zum Nachweis: Einzahl, persönliche Anrede, ohne leere Zeilen am Ende', () => {
  const one = proofMailText({ objectName: 'Lager Au', monthLabel: 'Dezember 2026', totals: { done: 1, cancelled: 0, confirmed: 1 }, contact: 'Frau Huber' })
  assert.equal(one, 'Guten Tag Frau Huber,\n\nanbei der Leistungsnachweis für Lager Au, Dezember 2026: 1 Einsatz erbracht, davon 1 mit Zeiterfassung im Objekt.\n\nBei Fragen melden Sie sich gerne.\n\nMit freundlichen Grüßen')
  const many = proofMailText({ objectName: 'Kanzlei', monthLabel: 'Jänner 2027', totals: { done: 0, cancelled: 2, confirmed: 0 }, sender: 'Büro', company: 'Reinigung Beispiel GmbH' })
  assert.match(many, /: 0 Einsätze erbracht, 2 entfallen\.\n/)
  assert.ok(many.endsWith('Mit freundlichen Grüßen\nBüro\nReinigung Beispiel GmbH'))
  assert.equal(sentKey('2026-12', 'o1'), '2026-12|o1')
})
