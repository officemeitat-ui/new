import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, validatePlan } from '../src/core/rules.js'
import { autoPlan } from '../src/core/scheduler.js'
import { applyWinter, onCallIndex, parseForecast, parseWarnings, viennaTime, winterCheck } from '../src/core/weather.js'
import { missingLogs } from '../src/core/winterlog.js'
import { app } from '../src/ui/context.js'
import { cancelWinterCall, createWinterCalls, weatherFor, weatherOverview, winterOpen } from '../src/ui/weather.js'

// Stündliche Vorhersage wie vom Data Hub (GeoJSON), ab einem Zeitpunkt in UTC
function forecastJson(startIso, rows) {
  const start = Date.parse(startIso)
  const timestamps = rows.map((_, i) => new Date(start + i * 3600e3).toISOString().replace('.000Z', '+00:00'))
  const col = (k) => rows.map((r) => r[k] ?? null)
  return { timestamps, features: [{ properties: { parameters: { '2t': { unit: '°C', data: col('t') }, tp: { unit: 'kg m-2', data: col('precip') }, sf: { unit: 'kg m-2', data: col('snow') }, '10fg': { unit: 'm s-1', data: col('gust') } } } }] }
}
const hours = (startIso, n, row) => parseForecast(forecastJson(startIso, Array.from({ length: n }, (_, i) => row(i))))
const warn = (type, level, start, end) => parseWarnings({ properties: { warnings: [{ properties: { warntypid: type, warnstufeid: level, rawinfo: { start: String(start / 1000), end: String(end / 1000) } } }] } })

// ---------------------------------------------------------------- Entscheidung (§ 93 StVO)

test('Winterdienst-Entscheidung: Vorabend ab 16 Uhr zählt, 15 Uhr noch nicht', () => {
  // 1.12.2026 15:00 UTC = 16:00 Wien: erste Stunde im Zeitraum für den 2.12.
  const at = (iso) => hours(iso, 1, () => ({ t: -3, precip: 2, snow: 2 }))
  assert.equal(winterCheck({ hours: at('2026-12-01T15:00:00Z') }, '2026-12-02').needed, true)
  assert.equal(winterCheck({ hours: at('2026-12-01T14:00:00Z') }, '2026-12-02').needed, false, '15 Uhr Wien: gehört zum Vortag')
  // letzte Stunde vor 22 Uhr Wien (20:00 UTC) zählt, 21:00 UTC (22 Uhr) nicht mehr
  assert.equal(winterCheck({ hours: at('2026-12-02T20:00:00Z') }, '2026-12-02').needed, true)
  assert.equal(winterCheck({ hours: at('2026-12-02T21:00:00Z') }, '2026-12-02').needed, false)
})

test('Winterdienst-Entscheidung: Zeitraum stimmt auch am Tag der Zeitumstellung (25.10.)', () => {
  // 24.10. 16:00 Sommerzeit = 14:00 UTC; 25.10. 22:00 Winterzeit = 21:00 UTC
  const at = (iso) => hours(iso, 1, () => ({ t: -1, precip: 1.5, snow: 1.5 }))
  assert.equal(winterCheck({ hours: at('2026-10-24T13:00:00Z') }, '2026-10-25').needed, false)
  assert.equal(winterCheck({ hours: at('2026-10-24T14:00:00Z') }, '2026-10-25').needed, true)
  assert.equal(winterCheck({ hours: at('2026-10-25T20:00:00Z') }, '2026-10-25').needed, true)
  assert.equal(winterCheck({ hours: at('2026-10-25T21:00:00Z') }, '2026-10-25').needed, false)
})

test('Winterdienst-Entscheidung: Neuschnee wird über die Stunden summiert (ab 1 cm)', () => {
  // viermal 0,3 cm = 1,2 cm: einzeln zu wenig, zusammen nötig
  const h = hours('2026-12-01T18:00:00Z', 4, () => ({ t: -4, precip: 0.3, snow: 0.3 }))
  const w = winterCheck({ hours: h }, '2026-12-02')
  assert.equal(w.snow, 1.2)
  assert.deepEqual(w.reasons, ['Neuschnee ca. 1,2 cm'])
  assert.equal(w.ice, false, 'Schneefall ist keine Glätte durch Regen')
  // dreimal 0,3 cm = 0,9 cm: noch kein Winterdienst
  assert.equal(winterCheck({ hours: h.slice(0, 3) }, '2026-12-02').needed, false)
})

const iceCases = [
  ['Regen bei genau 1 °C', { t: 1, precip: 0.4, snow: 0 }, true],
  ['Regen bei 1,1 °C', { t: 1.1, precip: 0.4, snow: 0 }, false],
  ['Nieseln 0,1 mm bei −2 °C', { t: -2, precip: 0.1, snow: 0 }, true],
  ['kaum Niederschlag 0,05 mm bei −2 °C', { t: -2, precip: 0.05, snow: 0 }, false],
  ['Schneefall bei −2 °C (zählt als Schnee, nicht als Glätte)', { t: -2, precip: 0.4, snow: 0.4 }, false],
  ['Temperatur fehlt', { t: null, precip: 2, snow: 0 }, false],
]
for (const [name, row, ice] of iceCases) {
  test(`Glätte (Niederschlag bei Frost): ${name}`, () => {
    const w = winterCheck({ hours: hours('2026-12-02T02:00:00Z', 1, () => row) }, '2026-12-02')
    assert.equal(w.ice, ice)
    if (ice) assert.match(w.reasons[0], /^Glätte möglich \(-?\d+(,\d)? °C mit Niederschlag\)$/)
  })
}

test('Winterdienst-Entscheidung: Gründe in fester Reihenfolge (Schnee, Glätte, Warnungen)', () => {
  const h = hours('2026-12-01T20:00:00Z', 3, (i) => (i < 2 ? { t: -1, precip: 1, snow: 1 } : { t: -0.5, precip: 0.6, snow: 0 }))
  const start = viennaTime('2026-12-02', '00:00')
  const warnings = [...warn(4, 2, start, start + 6 * 3600e3), ...warn(3, 1, start, start + 3600e3), ...warn(1, 3, start, start + 3600e3)]
  const w = winterCheck({ hours: h, warnings }, '2026-12-02')
  assert.deepEqual(w.reasons, ['Neuschnee ca. 2 cm', 'Glätte möglich (-0,5 °C mit Niederschlag)', 'Glatteiswarnung orange', 'Schneewarnung gelb'], 'Sturmwarnung zählt nicht')
  assert.equal(w.warning.type, 'glatteis', 'erste Warnung nach Beginn')
})

test('Winterdienst-Entscheidung: Warnung, die vor 16 Uhr am Vortag endet, zählt nicht', () => {
  const from = viennaTime('2026-12-01', '16:00')
  assert.equal(winterCheck({ warnings: warn(3, 2, from - 6 * 3600e3, from) }, '2026-12-02').needed, false, 'endet genau um 16 Uhr')
  assert.equal(winterCheck({ warnings: warn(3, 2, from - 6 * 3600e3, from + 60e3) }, '2026-12-02').needed, true)
  const to = viennaTime('2026-12-02', '22:00')
  assert.equal(winterCheck({ warnings: warn(4, 1, to, to + 3600e3) }, '2026-12-02').needed, false, 'beginnt erst um 22 Uhr')
})

test('Winterdienst-Entscheidung: ohne Daten „unbekannt“, eigene Schwellen aus den Regeln', () => {
  assert.deepEqual(winterCheck({}, '2026-12-02'), { needed: false, reasons: [], snow: 0, ice: false, warning: null, known: false })
  const h = hours('2026-12-02T01:00:00Z', 1, () => ({ t: 1.8, precip: 0.5, snow: 0 }))
  assert.equal(winterCheck({ hours: h }, '2026-12-02').needed, false, 'Standard: Glätte erst ab 1 °C')
  assert.equal(winterCheck({ hours: h }, '2026-12-02', { iceTempC: 2 }).ice, true, 'eigene Schwelle 2 °C')
  const s = hours('2026-12-02T01:00:00Z', 1, () => ({ t: -1, precip: 2, snow: 2 }))
  assert.equal(winterCheck({ hours: s }, '2026-12-02', { snowCm: 3 }).needed, false, 'erst ab 3 cm')
})

// ---------------------------------------------------------------- Einsätze (applyWinter)

const make = (task, date) => ({ ...task, date })
const winterObj = (id, winter) => ({ id, name: id, winter: { active: true, ...winter } })

test('Winterdienst-Einsatz: fertig bis 06:00, Beginn aus Dauer, Mindestens eine Person', () => {
  const objects = [winterObj('a', { minutes: '30', staff: '0' }), winterObj('b', { until: '05:30', minutes: 90, staff: 3 }), winterObj('c', { until: '6:30' })]
  const out = applyWinter([], { objects, winter: { '2026-12-02|a': { reason: 'Neuschnee' }, '2026-12-02|b': {}, '2026-12-02|c': {} }, make })
  assert.deepEqual(out.map((i) => [i.objectId, i.start, i.end, i.staff]), [
    ['a', '05:30', '06:00', 1],
    ['b', '04:00', '05:30', 3],
    ['c', '05:15', '06:00', 1],
  ], 'Zeit ohne führende Null ist ungültig: Standard 06:00')
  assert.deepEqual([out[0].winterReason, out[1].winterReason], ['Neuschnee', ''])
  assert.ok(out.every((i) => i.category === 'winter' && i.outdoor && i.holidayRule === 'findet_statt' && i.recurrence.type === 'once'))
})

test('Winterdienst-Einsatz: früh fertig – Beginn wird nicht vor Mitternacht gelegt', () => {
  const [i] = applyWinter([], { objects: [winterObj('a', { until: '00:30', minutes: 45 })], winter: { '2026-12-02|a': {} }, make })
  assert.deepEqual([i.start, i.end], ['00:00', '00:30'])
})

test('Winterdienst-Einsatz: unbekannte Objekte, abgesagte Aufrufe und Objekte ohne Winterdienst fallen weg', () => {
  const objects = [winterObj('a', {}), { id: 'b', name: 'b', winter: { active: false } }, { id: 'c', name: 'c' }]
  const out = applyWinter([], { objects, winter: { '2026-12-02|a': { cancelled: true }, '2026-12-02|b': {}, '2026-12-02|c': {}, '2026-12-02|x': {}, '2026-12-03|a': { reason: 'Glätte' } }, make })
  assert.deepEqual(out.map((i) => `${i.date}|${i.objectId}`), ['2026-12-03|a'])
})

test('Winterdienst-Einsatz: Team wird kopiert, nicht geteilt', () => {
  const o = winterObj('a', { team: ['e1', 'e2'] })
  const [i] = applyWinter([], { objects: [o], winter: { '2026-12-02|a': {} }, make })
  i.regulars.push('e9')
  assert.deepEqual(o.winter.team, ['e1', 'e2'])
})

// ---------------------------------------------------------------- Ablauf: verschneite Nacht → Einsätze → Einteilung

const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, name, extra = {}) => ({ id, name, type: 'Vollzeit', weeklyHours: 40, skills: [], trained: [], availability: allDays, ...extra })
const LOCATIONS = [{ name: 'Salzburg', lat: 47.81, lon: 13.05 }, { name: 'Hallein', lat: 47.683, lon: 13.097 }]
const KEY = { Salzburg: '47.810,13.050', Hallein: '47.683,13.097' }
// Schnee in der Nacht auf den 2.12.: 20–24 Uhr UTC je 0,8 cm (= 21–1 Uhr Wien)
const SNOWY = hours('2026-12-01T12:00:00Z', 40, (i) => ({ t: -2, precip: i >= 8 && i <= 11 ? 0.8 : 0, snow: i >= 8 && i <= 11 ? 0.8 : 0, gust: 3 }))
const DRY = hours('2026-12-01T12:00:00Z', 40, () => ({ t: 3, precip: 0, snow: 0, gust: 3 }))

function setupApp({ salzburg = SNOWY, hallein = DRY, hallWarnings = [], absences = [{ employeeId: 'e1', from: '2026-12-01', to: '2026-12-05', type: 'Urlaub' }] } = {}) {
  app.config = {}
  app.data = {
    employees: [emp('e1', 'Anna Berger'), emp('e2', 'Boris Kraus', { exitDate: '2026-11-30' }), emp('e3', 'Carla Dorn'), emp('e4', 'Dino Egger'), emp('e5', 'Eva Fink')],
    objects: [
      { id: 'o1', name: 'Wohnanlage Lindenhof', region: 'Salzburg', winter: { active: true, team: ['e1', 'e2', 'e3'], staff: 1 } },
      { id: 'o2', name: 'Praxis Kaltenbach', region: 'Salzburg', weatherPlace: 'Hallein', winter: { active: true, team: ['e4'] } },
      { id: 'o3', name: 'Büro Sonnhang', region: 'Salzburg', winter: { active: false, team: ['e3'] } },
      { id: 'o4', name: 'Seniorenheim Ahornweg', region: 'Salzburg', winter: { active: true, until: '05:30', minutes: 60, staff: 2, team: ['e2', 'e5', 'e1'] } },
    ],
    tasks: [],
    absences,
    rules: { weather: { locations: LOCATIONS } },
    overrides: {},
    winter: {},
    assignments: {},
  }
  app.weather = { byLoc: { [KEY.Salzburg]: { hours: salzburg, warnings: [] }, [KEY.Hallein]: { hours: hallein, warnings: hallWarnings } }, tried: {}, loading: false, error: '' }
  return app.data
}
const plan = (data) => {
  const holidays = holidayCalendar('2026-11-30', '2026-12-13')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-11-30', '2026-12-06', holidays, ctx.rules)
  return { ctx, instances, byKey: new Map(instances.map((i) => [i.key, i])) }
}
const ids = (list) => list.map((x) => x.employeeId)

test('Ablauf Schneenacht: welche Objekte Winterdienst brauchen (Ort je Objekt, nur aktive)', () => {
  setupApp()
  const open = winterOpen('2026-12-01')
  assert.deepEqual(open.map((o) => [o.date, o.loc.name, o.reasons, o.objects.map((x) => x.id)]), [['2026-12-02', 'Salzburg', ['Neuschnee ca. 3,2 cm'], ['o1', 'o4']]], 'Praxis liegt beim Wetterort Hallein (trocken), Büro ohne Winterdienst')
  const overview = weatherOverview('2026-12-01')
  const sbg = overview.find((r) => r.loc.name === 'Salzburg')
  assert.deepEqual(sbg.days.map((d) => [d.date, d.winter.needed, d.winter.snow]), [['2026-12-01', false, 0.8], ['2026-12-02', true, 3.2], ['2026-12-03', false, 0]], 'am 1.12. fällt bis 22 Uhr nur der erste Teil')
})

test('Ablauf Schneenacht: Aufrufe anlegen, Team der Reihe nach, abwesende und ausgetretene übersprungen', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  assert.equal(createWinterCalls(open.date, open.objects, open.reasons.join(', ')), 2)
  assert.deepEqual(Object.keys(data.winter).sort(), ['2026-12-02|o1', '2026-12-02|o4'])
  assert.equal(data.winter['2026-12-02|o1'].reason, 'Neuschnee ca. 3,2 cm')
  // Lindenhof: Anna (Urlaub) und Boris (ausgetreten 30.11.) fallen weg → Carla
  assert.deepEqual(ids(data.assignments['2026-12-02|winter-o1']), ['e3'])
  // Ahornweg braucht zwei: aus dem Team ist nur Eva verfügbar
  assert.deepEqual(ids(data.assignments['2026-12-02|winter-o4']), ['e5'])
  assert.deepEqual(winterOpen('2026-12-01'), [], 'alles angelegt: nichts mehr offen')
})

test('Ablauf Schneenacht: Einsätze im Plan sind um 06:00 bzw. 05:30 fertig', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  createWinterCalls(open.date, open.objects, open.reasons.join(', '))
  const { byKey } = plan(data)
  const lind = byKey.get('2026-12-02|winter-o1')
  const ahorn = byKey.get('2026-12-02|winter-o4')
  assert.deepEqual([lind.startTime, lind.endTime, lind.staff, lind.duration], ['05:15', '06:00', 1, 45])
  assert.deepEqual([ahorn.startTime, ahorn.endTime, ahorn.staff, ahorn.duration], ['04:30', '05:30', 2, 60])
  assert.equal(lind.winterReason, 'Neuschnee ca. 3,2 cm')
  assert.ok(lind.outdoor && lind.category === 'winter')
  assert.equal([...byKey.keys()].filter((k) => k.includes('winter')).length, 2, 'nur am 2.12., nicht an den trockenen Tagen')
})

test('Ablauf Schneenacht: Automatik füllt den offenen Platz, nie mit abwesenden oder ausgetretenen Personen', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  createWinterCalls(open.date, open.objects, open.reasons.join(', '))
  const { ctx, instances } = plan(data)
  const res = autoPlan(ctx, instances, data.assignments, { from: '2026-11-30', to: '2026-12-06' })
  assert.deepEqual(res.open, [], 'beide Einsätze voll besetzt')
  assert.deepEqual(ids(res.assignments['2026-12-02|winter-o1']), ['e3'], 'Einteilung aus dem Team bleibt')
  const ahorn = ids(res.assignments['2026-12-02|winter-o4'])
  assert.equal(ahorn.length, 2)
  assert.equal(ahorn[0], 'e5')
  for (const list of Object.values(res.assignments)) for (const a of list) assert.ok(!['e1', 'e2'].includes(a.employeeId), `${a.employeeId} darf nicht eingeteilt werden`)
  assert.ok(!ahorn.includes('e3'), 'Carla ist zur selben Zeit am Lindenhof')
})

test('Ablauf: Abwesenheit nach dem Anlegen – Automatik gibt den Platz frei, fixierte Einteilung bleibt', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  createWinterCalls(open.date, open.objects, 'Schnee')
  data.absences.push({ employeeId: 'e3', from: '2026-12-02', to: '2026-12-02', type: 'Krankenstand' })
  // ohne weitere Person bleibt der Platz offen (Dino und Eva sind zur selben Zeit am Ahornweg)
  const short = plan(data)
  const none = autoPlan(short.ctx, short.instances, data.assignments, { from: '2026-11-30', to: '2026-12-06' })
  assert.deepEqual(none.open, ['2026-12-02|winter-o1'])
  data.employees.push(emp('e6', 'Franz Gruber'))
  const { ctx, instances } = plan(data)
  const res = autoPlan(ctx, instances, data.assignments, { from: '2026-11-30', to: '2026-12-06' })
  assert.equal(res.stats.released, 1)
  assert.deepEqual(res.open, [])
  const lind = ids(res.assignments['2026-12-02|winter-o1'])
  assert.equal(lind.length, 1, 'jemand anderer übernimmt')
  assert.ok(!['e1', 'e2', 'e3'].includes(lind[0]), lind[0])
  // fixiert (von Hand gesetzt): bleibt trotz Abwesenheit, die Prüfung meldet es
  const locked = { ...data.assignments, '2026-12-02|winter-o1': [{ employeeId: 'e3', locked: true }] }
  const res2 = autoPlan(ctx, instances, locked, { from: '2026-11-30', to: '2026-12-06' })
  assert.deepEqual(ids(res2.assignments['2026-12-02|winter-o1']), ['e3'])
  const issues = validatePlan(ctx, new PlanState(instances, res2.assignments), instances, { from: '2026-11-30', to: '2026-12-06' }).issues
  assert.ok(issues.some((i) => i.code === 'ABSENT' && i.employeeId === 'e3'))
})

test('Ablauf: zweites Anlegen legt nichts doppelt an und überschreibt keine Einteilung', () => {
  const data = setupApp()
  const objects = data.objects.filter((o) => ['o1', 'o4'].includes(o.id))
  data.assignments['2026-12-02|winter-o1'] = [{ employeeId: 'e4' }] // von Hand vorab eingeteilt
  assert.equal(createWinterCalls('2026-12-02', objects, 'Neuschnee'), 2)
  assert.deepEqual(ids(data.assignments['2026-12-02|winter-o1']), ['e4'], 'vorhandene Einteilung bleibt')
  const first = data.winter['2026-12-02|o1'].at
  assert.equal(createWinterCalls('2026-12-02', objects, 'anderer Grund'), 0)
  assert.equal(data.winter['2026-12-02|o1'].reason, 'Neuschnee')
  assert.equal(data.winter['2026-12-02|o1'].at, first)
})

test('Ablauf: ganzes Team abwesend – Aufruf ohne Einteilung, Automatik sucht Ersatz', () => {
  const data = setupApp({ absences: [{ employeeId: 'e4', from: '2026-12-01', to: '2026-12-03', type: 'Urlaub' }] })
  const praxis = data.objects.find((o) => o.id === 'o2')
  assert.equal(createWinterCalls('2026-12-02', [praxis], 'Glätte'), 1)
  assert.equal(data.assignments['2026-12-02|winter-o2'], undefined)
  const { ctx, instances } = plan(data)
  const res = autoPlan(ctx, instances, data.assignments, { from: '2026-11-30', to: '2026-12-06' })
  const who = ids(res.assignments['2026-12-02|winter-o2'])
  assert.equal(who.length, 1)
  assert.ok(!['e2', 'e4'].includes(who[0]))
})

test('Ablauf: Winterdienst absagen (Schnee blieb aus) – Aufruf und Einteilung weg, wieder offen', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  createWinterCalls(open.date, open.objects, 'Schnee')
  cancelWinterCall('2026-12-02', 'o4')
  assert.deepEqual(Object.keys(data.winter), ['2026-12-02|o1'])
  assert.equal(data.assignments['2026-12-02|winter-o4'], undefined)
  assert.deepEqual(winterOpen('2026-12-01').map((o) => o.objects.map((x) => x.id)), [['o4']])
  assert.equal(plan(data).byKey.has('2026-12-02|winter-o4'), false)
})

test('Ablauf: Glätte durch gefrierenden Regen in Hallein betrifft nur das Objekt dort', () => {
  const freezing = hours('2026-12-01T12:00:00Z', 40, (i) => ({ t: -0.5, precip: i === 16 ? 0.6 : 0, snow: 0, gust: 3 }))
  setupApp({ salzburg: DRY, hallein: freezing })
  const open = winterOpen('2026-12-01')
  assert.deepEqual(open.map((o) => [o.date, o.loc.name, o.reasons, o.objects.map((x) => x.id)]), [['2026-12-02', 'Hallein', ['Glätte möglich (-0,5 °C mit Niederschlag)'], ['o2']]])
})

test('Ablauf: amtliche Glatteiswarnung allein reicht, auch ohne Vorhersage', () => {
  const start = viennaTime('2026-12-03', '03:00')
  setupApp({ salzburg: DRY, hallein: [], hallWarnings: warn(4, 2, start, start + 5 * 3600e3) })
  const open = winterOpen('2026-12-01')
  assert.deepEqual(open.map((o) => [o.date, o.reasons]), [['2026-12-03', ['Glatteiswarnung orange']]])
})

test('Ablauf: Wetter in der App abgeschaltet – keine offenen Tage, kein Wetter für die Prüfung', () => {
  setupApp()
  app.config = { weather: false }
  assert.deepEqual(winterOpen('2026-12-01'), [])
  assert.equal(weatherFor('o1', '2026-12-02'), null)
  app.config = {}
  assert.equal(weatherFor('o2', '2026-12-02').loc.name, 'Hallein', 'Wetter des gewählten Orts')
  assert.equal(weatherFor('o1', '2027-01-15'), null, 'Tag ohne Vorhersage')
})

test('Ablauf: Sturm am Winterdienst-Morgen – Prüfung meldet Böen beim Winterdienst', () => {
  const stormy = hours('2026-12-01T12:00:00Z', 40, (i) => ({ t: -2, precip: i >= 8 && i <= 11 ? 0.8 : 0, snow: i >= 8 && i <= 11 ? 0.8 : 0, gust: i === 20 ? 20 : 3 }))
  const data = setupApp({ salzburg: stormy })
  createWinterCalls('2026-12-02', data.objects.filter((o) => o.id === 'o1'), 'Schnee')
  const { ctx, instances } = plan(data)
  ctx.weather = weatherFor
  const issues = validatePlan(ctx, new PlanState(instances, data.assignments), instances, { from: '2026-11-30', to: '2026-12-06' }).issues.filter((i) => i.code === 'WIND')
  assert.deepEqual(issues.map((i) => i.keys[0]), ['2026-12-02|winter-o1'])
  assert.match(issues[0].message, /Böen bis 72 km\/h/)
})

test('Ablauf: fehlendes Protokoll nach dem Winterdienst (Frist 06:00 + 2 h)', () => {
  const data = setupApp()
  const [open] = winterOpen('2026-12-01')
  createWinterCalls(open.date, open.objects, 'Schnee')
  const at = (t) => viennaTime('2026-12-02', t)
  assert.deepEqual(missingLogs({ winter: data.winter, objects: data.objects, now: at('07:45') }).map((m) => m.object.id), ['o4'], 'Ahornweg fertig 05:30: ab 07:30 fehlt das Protokoll')
  const log = { '2026-12-02|o4|h1': { date: '2026-12-02', objectId: 'o4', at: '2026-12-02T04:20:00.000Z' } }
  assert.deepEqual(missingLogs({ winter: data.winter, objects: data.objects, log, now: at('08:00') }).map((m) => [m.object.id, m.until]), [['o1', '06:00']])
})

test('Bereitschaft: Wechsel genau am Montag 0 Uhr, eine Person immer dran', () => {
  const sun = onCallIndex('2027-01-03', 2) // Sonntag
  assert.equal(onCallIndex('2026-12-28', 2), sun, 'Mo bis So dieselbe Person')
  assert.equal(onCallIndex('2027-01-04', 2), 1 - sun, 'Montag: die andere')
  for (const d of ['2026-11-02', '2026-12-24', '2027-02-15']) assert.equal(onCallIndex(d, 1), 0)
  // über ein ganzes Jahr: jede von drei Personen gleich oft (±1 Woche)
  const counts = [0, 0, 0]
  for (let w = 0; w < 52; w++) counts[onCallIndex(new Date(Date.UTC(2026, 10, 2) + w * 7 * 86400e3).toISOString().slice(0, 10), 3)]++
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts))
})
