import { test } from 'node:test'
import assert from 'node:assert/strict'

import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext, validatePlan } from '../src/core/rules.js'
import { createDemoData } from '../src/data/demo.js'
import { alarmFile, alarmPlace, alarmProblems, applyWinter, dayOutlook, findPlace, forecastUrl, heatCheck, locationFor, metadataUrl, onCallIndex, parseForecast, parseWarnings, pickParams, stormCheck, viennaParts, viennaTime, warningsUrl, warningText, winterAt, winterCheck } from '../src/core/weather.js'

// Stündliche Vorhersage als Antwort des Data Hub (GeoJSON), ab einem Zeitpunkt in UTC
function forecastJson(startIso, rows, params = { t: '2t', precip: 'tp', snow: 'sf', gust: '10fg' }, units = { t: '°C', precip: 'kg m-2', snow: 'kg m-2', gust: 'm s-1' }) {
  const start = Date.parse(startIso)
  const timestamps = rows.map((_, i) => new Date(start + i * 3600e3).toISOString().replace('.000Z', '+00:00'))
  const parameters = {}
  for (const [kind, name] of Object.entries(params)) parameters[name] = { name, unit: units[kind], data: rows.map((r) => r[kind] ?? null) }
  return { media_type: 'application/json', type: 'FeatureCollection', version: 'v1', timestamps, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [13.055, 47.8095] }, properties: { parameters } }] }
}
const hoursOf = (n, row) => Array.from({ length: n }, (_, i) => (typeof row === 'function' ? row(i) : { ...row }))
const warnJson = (list) => ({ type: 'Feature', properties: { warnings: list.map(([warntypid, warnstufeid, start, end, text = '']) => ({ type: 'Feature', properties: { warntypid, warnstufeid, rawinfo: { wtype: warntypid, wlevel: warnstufeid, start: String(start / 1000), end: String(end / 1000) }, text } })) } })

test('Wetter: Adressen von GeoSphere (Vorhersage C-LAEF 1 km, Warnungen je Ort)', () => {
  assert.equal(forecastUrl(47.8095, 13.055), 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km?lat_lon=47.8095,13.055&parameters=2t,tp,sf,10fg,tcc,sy,snowlmt,10u,10v')
  assert.equal(warningsUrl(47.8095, 13.055), 'https://warnungen.zamg.at/wsapp/api/getWarningsForCoords?lon=13.055&lat=47.8095&lang=de')
})

test('Wetter: Parameter aus den Metadaten wählen (falls GeoSphere Namen ändert)', () => {
  assert.equal(metadataUrl(), 'https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v2-1h-1km/metadata')
  assert.deepEqual(pickParams({ parameters: [{ name: 'u10m' }, { name: 't2m' }, { name: 'rr_acc' }, { name: 'snow_acc' }] }), ['t2m', 'rr_acc', 'snow_acc'])
  assert.deepEqual(pickParams({ parameters: [{ name: '2t' }, { name: 't2m' }, { name: 'tp' }, { name: 'sf' }, { name: '10fg' }] }), ['2t', 'tp', 'sf', '10fg'])
  assert.deepEqual(pickParams({ parameters: { a: { name: 't2m' }, b: { name: 'rain' } } }), ['t2m', 'rain'])
  assert.equal(pickParams({ parameters: [{ name: 't2m' }] }), null, 'ohne Niederschlag unbrauchbar')
  assert.equal(pickParams(null), null)
})

test('Wetter: Zeit in Wien mit Sommer- und Winterzeit', () => {
  // 25.10.2026: Umstellung auf Winterzeit
  assert.equal(new Date(viennaTime('2026-10-24', '06:00')).toISOString(), '2026-10-24T04:00:00.000Z')
  assert.equal(new Date(viennaTime('2026-10-26', '06:00')).toISOString(), '2026-10-26T05:00:00.000Z')
  assert.deepEqual(viennaParts(Date.parse('2026-12-31T23:30:00Z')), { date: '2027-01-01', hour: 0, minute: 30 })
})

test('Wetter: Vorhersage lesen (°C, mm, cm, Böen in km/h; Kelvin und Summen umgerechnet)', () => {
  const json = forecastJson('2026-12-01T00:00:00Z', [{ t: -1.5, precip: 0.4, snow: 0.4, gust: 10 }, { t: 0.2, precip: 0, snow: 0, gust: 20 }])
  const hours = parseForecast(json)
  assert.equal(hours.length, 2)
  assert.deepEqual(hours[0], { at: Date.parse('2026-12-01T00:00:00Z'), t: -1.5, precip: 0.4, snow: 0.4, gust: 36 })
  assert.equal(hours[1].gust, 72)
  // ältere Namen: Temperatur in Kelvin, Niederschlag als Summe seit Modellstart
  const old = forecastJson('2026-12-01T00:00:00Z', [{ t: 271.15, precip: 1 }, { t: 272.15, precip: 3 }, { t: 273.15, precip: 3 }], { t: 't2m', precip: 'rr_acc' }, { t: 'K', precip: 'kg m-2' })
  const h = parseForecast(old)
  assert.deepEqual(h.map((x) => Math.round(x.t * 10) / 10), [-2, -1, 0])
  assert.deepEqual(h.map((x) => x.precip), [1, 2, 0])
  assert.equal(h[0].snow, null)
  assert.throws(() => parseForecast({ title: 'Fehler' }), /Unerwartete Antwort/)
})

test('Wetter: amtliche Warnungen lesen (Art, Stufe, Zeitraum)', () => {
  const from = Date.parse('2026-12-01T17:00:00Z')
  const list = parseWarnings(warnJson([[3, 2, from, from + 18 * 3600e3, 'Bis zu 25 cm Neuschnee'], [6, 1, from, from + 3600e3], [9, 1, from, from + 3600e3]]))
  assert.equal(list.length, 2, 'unbekannte Warnart fällt weg')
  assert.deepEqual(list[0], { type: 'schnee', level: 2, start: from, end: from + 18 * 3600e3, text: 'Bis zu 25 cm Neuschnee' })
  assert.equal(warningText(list[0]), 'Schneewarnung orange')
  assert.equal(warningText(list[1]), 'Hitzewarnung gelb')
  // Beginn als Text statt Zeitstempel
  const text = parseWarnings({ properties: { warnings: [{ properties: { warntypid: 4, warnstufeid: 3, begin: '02.12.2026 03:00', end: '02.12.2026 10:00' } }] } })
  assert.equal(new Date(text[0].start).toISOString(), '2026-12-02T02:00:00.000Z')
  assert.deepEqual(parseWarnings({}), [])
})

test('Winterdienst: Neuschnee ab dem Vorabend, Glätte, Warnung', () => {
  const night = (snowAt) => parseForecast(forecastJson('2026-12-01T12:00:00Z', hoursOf(40, (i) => ({ t: -2, precip: i === snowAt ? 1.5 : 0, snow: i === snowAt ? 1.5 : 0, gust: 5 }))))
  // 1.12. 22 Uhr Wien (Stunde 9 ab 12 UTC = 21 UTC): zählt für den 2.12.
  const w = winterCheck({ hours: night(9), warnings: [] }, '2026-12-02')
  assert.equal(w.needed, true)
  assert.deepEqual(w.reasons, ['Neuschnee ca. 1,5 cm'])
  // Schnee erst am 2.12. um 23 Uhr: nicht mehr für den 2.12.
  assert.equal(winterCheck({ hours: night(34), warnings: [] }, '2026-12-02').needed, false)
  // kaum Schnee: unter der Schwelle
  const little = parseForecast(forecastJson('2026-12-01T12:00:00Z', hoursOf(30, (i) => ({ t: -2, precip: i === 10 ? 0.3 : 0, snow: i === 10 ? 0.3 : 0 }))))
  assert.equal(winterCheck({ hours: little, warnings: [] }, '2026-12-02').needed, false)
  assert.equal(winterCheck({ hours: little, warnings: [] }, '2026-12-02', { snowCm: 0.2 }).needed, true)
  // Regen bei Frost: Glätte
  const ice = parseForecast(forecastJson('2026-12-01T12:00:00Z', hoursOf(30, (i) => ({ t: 0.5, precip: i === 15 ? 0.6 : 0, snow: 0 }))))
  const g = winterCheck({ hours: ice, warnings: [] }, '2026-12-02')
  assert.equal(g.ice, true)
  assert.match(g.reasons[0], /Glätte möglich \(0,5 °C/)
  // Regen bei +4 °C: nichts
  const rain = parseForecast(forecastJson('2026-12-01T12:00:00Z', hoursOf(30, () => ({ t: 4, precip: 2, snow: 0 }))))
  assert.equal(winterCheck({ hours: rain, warnings: [] }, '2026-12-02').needed, false)
  // amtliche Glatteiswarnung reicht, auch ohne Vorhersage
  const warn = parseWarnings(warnJson([[4, 1, Date.parse('2026-12-02T03:00:00Z'), Date.parse('2026-12-02T09:00:00Z')]]))
  assert.deepEqual(winterCheck({ hours: [], warnings: warn }, '2026-12-02').reasons, ['Glatteiswarnung gelb'])
})

test('Hitze und Sturm: Warnung geht vor, sonst Schwelle aus der Vorhersage', () => {
  const day = '2027-07-15'
  const hours = parseForecast(forecastJson('2027-07-14T22:00:00Z', hoursOf(24, (i) => ({ t: 20 + (i > 10 && i < 16 ? 12 : 0), precip: 0, snow: 0, gust: i === 12 ? 18 : 3 }))))
  const plain = dayOutlook({ hours, warnings: [] }, day)
  assert.equal(plain.tMax, 32)
  assert.equal(plain.gust, 65)
  assert.deepEqual(heatCheck(plain), { warning: null, hot: true, tMax: 32 })
  assert.equal(heatCheck(plain, { heatC: 33 }).hot, false)
  assert.equal(stormCheck(plain).windy, true)
  assert.equal(stormCheck(plain, { gustKmh: 70 }).windy, false)
  const start = viennaTime(day, '10:00')
  const warnings = parseWarnings(warnJson([[6, 1, start, start + 8 * 3600e3], [6, 2, start, start + 3600e3], [5, 1, start, start + 3600e3]]))
  const o = dayOutlook({ hours, warnings }, day)
  assert.equal(heatCheck(o).warning.level, 2, 'höchste Stufe zählt')
  assert.equal(stormCheck(o).warning.type, 'gewitter')
  assert.equal(dayOutlook({ hours, warnings }, '2027-07-17').known, false)
})

test('Wetter-Ort je Objekt: eigens gewählter Ort, sonst Revier mit gleichem Namen, sonst der erste Ort', () => {
  const locations = [{ name: 'Salzburg Stadt', lat: 47.8, lon: 13.05 }, { name: 'Tennengau', lat: 47.68, lon: 13.1 }, { name: 'kaputt', lat: 'x', lon: 1 }, { name: 'Hallein', lat: 47.68, lon: 13.1 }]
  assert.equal(locationFor({ region: 'tennengau ' }, locations).name, 'Tennengau')
  assert.equal(locationFor({ region: 'Tennengau', weatherPlace: 'Hallein' }, locations).name, 'Hallein')
  assert.equal(locationFor({ region: 'Tennengau', weatherPlace: 'gibt es nicht' }, locations).name, 'Tennengau')
  assert.equal(locationFor({ region: 'Pongau' }, locations).name, 'Salzburg Stadt')
  assert.equal(locationFor({ region: 'kaputt' }, locations).name, 'Salzburg Stadt')
  assert.equal(locationFor({}, []), null)
})

const data = (extra = {}) => ({
  employees: [{ id: 'e1', name: 'A', type: 'Vollzeit', weeklyHours: 40, skills: [], trained: [], availability: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }])) }],
  objects: [
    { id: 'o1', name: 'Wohnanlage', short: 'Wohnanlage', color: 1, winter: { active: true, until: '06:30', minutes: 40, staff: 2, team: ['e1'] } },
    { id: 'o2', name: 'Büro', short: 'Büro', color: 2, winter: { active: false, team: ['e1'] } },
    { id: 'o3', name: 'Lager', short: 'Lager', color: 3, winter: { active: true } },
  ],
  tasks: [{ id: 't1', objectId: 'o1', label: 'Außenanlage', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5] }, start: '08:00', end: '10:00', staff: 1, regulars: ['e1'], skills: [], holidayRule: 'findet_statt', outdoor: true }],
  absences: [],
  rules: {},
  overrides: {},
  ...extra,
})

test('Winterdienst-Einsätze: nur angelegte Tage und Objekte mit Winterdienst', () => {
  const holidays = holidayCalendar('2026-11-30', '2026-12-13')
  const d = data({ winter: { '2026-12-02|o1': { reason: 'Neuschnee ca. 3 cm' }, '2026-12-02|o2': { reason: 'x' }, '2026-12-03|o3': { reason: 'Glätte' }, '2026-12-04|o1': { reason: 'y', cancelled: true }, '2026-12-20|o1': { reason: 'außerhalb' } } })
  const ctx = createContext(d, holidays)
  const list = buildInstances(d, '2026-11-30', '2026-12-06', holidays, ctx.rules).filter((i) => i.category === 'winter')
  assert.deepEqual(list.map((i) => i.key), ['2026-12-02|winter-o1', '2026-12-03|winter-o3'])
  const [a, b] = list
  assert.equal(a.startTime, '05:50')
  assert.equal(a.endTime, '06:30')
  assert.equal(a.staff, 2)
  assert.deepEqual(a.regulars, ['e1'])
  assert.equal(a.outdoor, true)
  assert.equal(a.winterReason, 'Neuschnee ca. 3 cm')
  // ohne Angaben beim Objekt: Standard aus den Regeln (fertig 6 Uhr, 45 min)
  assert.equal(b.startTime, '05:15')
  assert.equal(b.endTime, '06:00')
  // Winterdienst an einem Feiertag findet statt (8.12.)
  const h = buildInstances(data({ winter: { '2026-12-08|o1': {} } }), '2026-12-07', '2026-12-13', holidays, ctx.rules).find((i) => i.category === 'winter')
  assert.equal(h.status, 'normal')
  // eigene Regel: fertig bis 7 Uhr
  const r = applyWinter([], { objects: d.objects, winter: { '2026-12-03|o3': {} }, weatherRules: { winterUntil: '07:00', winterMinutes: 30 }, make: (task, date) => ({ ...task, date }) })
  assert.deepEqual([r[0].start, r[0].end], ['06:30', '07:00'])
})

test('Prüfregel Wetter: Hitzewarnung und Sturm nur bei Arbeit im Freien', () => {
  const holidays = holidayCalendar('2027-07-05', '2027-07-18')
  const d = data({ tasks: [...data().tasks, { id: 't2', objectId: 'o2', label: 'Büro', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5] }, start: '11:00', end: '12:00', staff: 1, regulars: ['e1'], skills: [], holidayRule: 'findet_statt' }] })
  const ctx = createContext(d, holidays)
  const instances = buildInstances(d, '2027-07-12', '2027-07-18', holidays, ctx.rules)
  const assignments = Object.fromEntries(instances.map((i) => [i.key, [{ employeeId: 'e1' }]]))
  const state = new PlanState(instances, assignments)
  const start = viennaTime('2027-07-14', '00:00')
  const warnings = parseWarnings(warnJson([[6, 1, start, start + 86400e3], [1, 2, start, start + 86400e3]]))
  ctx.weather = (objectId, date) => {
    const outlook = dayOutlook({ hours: [], warnings: date === '2027-07-14' ? warnings : [] }, date)
    if (date === '2027-07-15') Object.assign(outlook, { known: true, tMax: 31, gust: 70 })
    return { outlook, heat: heatCheck(outlook), storm: stormCheck(outlook) }
  }
  const { issues } = validatePlan(ctx, state, instances, { from: '2027-07-12', to: '2027-07-18' })
  const wx = issues.filter((i) => ['HEAT', 'HEAT_HINT', 'STORM', 'WIND'].includes(i.code))
  assert.deepEqual(wx.map((i) => `${i.code} ${i.keys[0]}`).sort(), ['HEAT 2027-07-14|t1', 'HEAT_HINT 2027-07-15|t1', 'STORM 2027-07-14|t1', 'WIND 2027-07-15|t1'])
  assert.match(wx.find((i) => i.code === 'HEAT').message, /Hitzewarnung gelb.*Hitzeschutzverordnung/)
  // Regel abgeschaltet: keine Hinweise
  ctx.rules.disabledRules = ['weather']
  assert.equal(validatePlan(ctx, state, instances, { from: '2027-07-12', to: '2027-07-18' }).issues.filter((i) => i.code === 'HEAT').length, 0)
})

test('Beispieldaten: Orte je Revier, Winterdienst-Objekte mit Team, Leistungen im Freien', () => {
  const demo = createDemoData('2026-11-30')
  const regions = new Set(demo.objects.map((o) => o.region))
  for (const loc of demo.rules.weather.locations) assert.ok(regions.has(loc.name), loc.name)
  const winter = demo.objects.filter((o) => o.winter?.active)
  assert.ok(winter.length >= 2)
  for (const o of winter) for (const id of o.winter.team) assert.ok(demo.employees.some((e) => e.id === id))
  assert.ok(demo.tasks.filter((t) => t.outdoor).length >= 2)
})

test('Ortsliste Salzburg: Name genügt („Obertrum“ → Obertrum am See)', () => {
  assert.deepEqual(findPlace('Hallein'), { name: 'Hallein', lat: 47.6833, lon: 13.097 })
  assert.equal(findPlace('obertrum').name, 'Obertrum am See')
  assert.equal(findPlace(' seekirchen ').name, 'Seekirchen am Wallersee')
  assert.equal(findPlace('Wien'), null)
  assert.equal(findPlace(''), null)
})

test('Schnee-Alarm: Datei für den Server (Stufe 1 aus den Teams, Stufe 2, Büro, Regeln)', () => {
  const locations = [{ name: 'Salzburg', lat: 47.8095, lon: 13.055 }, { name: 'Hallein', lat: 47.6833, lon: 13.097 }, { name: 'Obertrum', lat: 47.9372, lon: 13.0767 }]
  const objects = [
    { id: 'o1', name: 'Wohnanlage Lehen', region: 'Salzburg', winter: { active: true, team: ['e1', 'e2'] } },
    { id: 'o2', name: 'Bank Hallein', region: 'Salzburg', weatherPlace: 'Hallein', winter: { active: true, team: ['e3'] } },
    { id: 'o3', name: 'Büro ohne Winterdienst', region: 'Salzburg', winter: { active: false, team: ['e4'] } },
  ]
  const employees = [{ id: 'e1', name: 'Ana', email: 'ana@example.test' }, { id: 'e2', name: 'Ben' }, { id: 'e3', name: 'Cem', email: 'cem@example.test' }, { id: 'e4', name: 'Dora', email: 'dora@example.test' }]
  assert.deepEqual(winterAt(locations[1], objects, locations), { objects: [objects[1]], team: ['e3'] })
  assert.deepEqual(alarmPlace({}, locations[0], objects, locations), { active: true, level1: ['e1', 'e2'], level2: [], rotate: false })
  const alarm = {
    key: 'k'.repeat(64), cronKey: 'p'.repeat(32), sender: 'winterdienst@example.test', officeEmails: 'buero@example.test; kaputt, chef@example.test', quietFrom: '22:00', quietTo: '03:00',
    topics: { e1: 'wd-ana', e3: 'wd-cem', e4: 'wd-dora', office: 'wd-buero' },
    places: { Hallein: { active: true, level1: ['e3'], level2: ['e4'] }, Obertrum: { active: false, level1: [], level2: [] } },
  }
  const f = alarmFile({ alarm, locations, objects, employees, address: 'https://app.example.test/' })
  assert.equal(f.schluessel, 'k'.repeat(64))
  assert.equal(f.pruefschluessel, 'p'.repeat(32))
  assert.equal(f.ntfy, 'https://ntfy.sh')
  assert.deepEqual(f.regeln, { vorlaufStunden: 3, schneeCm: 0.3, pauseStunden: 8, eskalationMinuten: 15, ruheVon: '22:00', ruheBis: '03:00', ruheAusnahmeStufe: 2 })
  assert.deepEqual(f.orte.map((o) => o.name), ['Salzburg', 'Hallein'], 'Obertrum ist aus')
  const [sbg, hal] = f.orte
  assert.deepEqual(sbg.objekte, [{ id: 'o1', name: 'Wohnanlage Lehen', adresse: '' }])
  assert.deepEqual(sbg.stufe1, [{ name: 'Ana', ntfy: 'wd-ana' }], 'Ben ohne Handy und E-Mail fällt weg; Stufe 1 ohne E-Mail')
  assert.deepEqual(sbg.stufe2, [{ name: 'Büro', ntfy: 'wd-buero' }, { name: 'Büro', email: 'buero@example.test' }, { name: 'Büro', email: 'chef@example.test' }])
  assert.deepEqual(hal.objekte, [{ id: 'o2', name: 'Bank Hallein', adresse: '' }])
  assert.deepEqual(hal.stufe1, [{ name: 'Cem', ntfy: 'wd-cem' }])
  assert.deepEqual(hal.stufe2[0], { name: 'Dora', ntfy: 'wd-dora', email: 'dora@example.test' })
  assert.deepEqual(alarmProblems(f), [])
  // Stufe 1 auch per E-Mail; Ort ohne Handy wird gemeldet
  const g = alarmFile({ alarm: { ...alarm, emailLevel1: true, topics: { e1: 'wd-ana' } }, locations, objects, employees, address: '' })
  assert.deepEqual(g.orte[1].stufe1, [{ name: 'Cem', email: 'cem@example.test' }])
  assert.deepEqual(alarmProblems(g), ['Hallein: Stufe 1 ohne Handy (ntfy)'])
  assert.deepEqual(alarmProblems({ orte: [] }), ['kein Ort eingeschaltet'])
})

test('Schnee-Alarm: Bereitschaft wechselt wöchentlich (montags), auch über den Jahreswechsel', () => {
  // Mo 30.11.2026 bis So 6.12.2026 dieselbe Person, ab Mo 7.12. die nächste
  const w = (d) => onCallIndex(d, 3)
  assert.equal(w('2026-11-30'), w('2026-12-06'))
  assert.equal(w('2026-12-07'), (w('2026-11-30') + 1) % 3)
  assert.equal(w('2026-12-14'), (w('2026-11-30') + 2) % 3)
  assert.equal(w('2026-12-21'), w('2026-11-30'))
  // fortlaufend über Silvester (kein Sprung durch Kalenderwochen)
  assert.equal(onCallIndex('2027-01-04', 4), (onCallIndex('2026-12-28', 4) + 1) % 4)
  assert.equal(onCallIndex('2026-12-01', 0), -1)
  const locations = [{ name: 'Hallein', lat: 47.68, lon: 13.1 }]
  const employees = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  const base = { key: 'k'.repeat(64), topics: { a: 'wd-a', b: 'wd-b' } }
  const file = (rotate, level1) => alarmFile({ alarm: { ...base, places: { Hallein: { active: true, level1, level2: [], rotate } } }, locations, objects: [], employees, address: '' })
  assert.equal(file(true, ['a', 'b']).orte[0].wechsel, 'woche')
  assert.equal(file(false, ['a', 'b']).orte[0].wechsel, undefined)
  assert.equal(file(true, ['a']).orte[0].wechsel, undefined, 'eine Person: kein Wechsel nötig')
})
