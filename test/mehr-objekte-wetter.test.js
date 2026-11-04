import { test } from 'node:test'
import assert from 'node:assert/strict'

import { alarmFile, alarmPlace, alarmProblems, dayOutlook, findPlace, forecastDays, heatCheck, hourSlots, locationFor, parseForecast, parseWarnings, pickParams, stormCheck, sunTimes, viennaParts, viennaTime, warningText, weatherKind, winterAt } from '../src/core/weather.js'

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00')
const series = (start, n, params) => ({ timestamps: Array.from({ length: n }, (_, i) => iso(start + i * 3600e3)), features: [{ properties: { parameters: params } }] })

// ---------------------------------------------------------------- Vorhersage lesen

test('Vorhersage: Niederschlag in Metern Wasser wird zu mm, Böen in km/h bleiben', () => {
  const start = Date.parse('2026-12-01T00:00:00Z')
  const h = parseForecast(series(start, 2, { '2t': { unit: '°C', data: [0, 1] }, tp: { unit: 'm', data: [0.0012, 0] }, sf: { unit: 'm', data: [0.0005, null] }, '10fg': { unit: 'km/h', data: [40, 55] } }))
  assert.equal(Math.round(h[0].precip * 1000) / 1000, 1.2)
  assert.equal(Math.round(h[0].snow * 1000) / 1000, 0.5)
  assert.equal(h[1].snow, null, 'fehlender Wert bleibt null')
  assert.deepEqual(h.map((x) => x.gust), [40, 55])
})

test('Vorhersage: Kelvin auch ohne Einheit erkannt (Werte über 150)', () => {
  const h = parseForecast(series(Date.parse('2026-12-01T00:00:00Z'), 2, { t2m: { data: [268.15, 275.65] }, tp: { data: [0, 0] } }))
  assert.deepEqual(h.map((x) => Math.round(x.t * 10) / 10), [-5, 2.5])
})

test('Vorhersage: Summen seit Modellstart mit Lücke werden nicht doppelt gezählt', () => {
  // rr_acc 1 → (fehlt) → 3 → 4: in den Stunden 1, –, 2, 1 mm (zusammen 4 mm, nicht 5)
  const h = parseForecast(series(Date.parse('2026-12-01T00:00:00Z'), 4, { t2m: { unit: 'K', data: [272, 272, 272, 272] }, rr_acc: { unit: 'kg m-2', data: [1, null, 3, 4] }, snow_acc: { unit: 'kg m-2', data: [0.5, 0.5, null, 2] } }))
  assert.deepEqual(h.map((x) => x.precip), [1, null, 2, 1])
  assert.deepEqual(h.map((x) => x.snow), [0.5, 0, null, 1.5])
  assert.equal(h.reduce((s, x) => s + (x.precip || 0), 0), 4)
})

test('Vorhersage: ungültige Zeitstempel fallen weg, Wind nur mit beiden Komponenten', () => {
  const json = { timestamps: ['2026-12-01T00:00+00:00', 'kaputt', '2026-12-01T02:00+00:00'], features: [{ properties: { parameters: { '2t': { data: [1, 2, 3] }, tp: { data: [0, 0, 0] }, '10u': { unit: 'm s-1', data: [3, 3, null] }, '10v': { unit: 'm s-1', data: [4, 4, 4] } } } }] }
  const h = parseForecast(json)
  assert.equal(h.length, 2)
  assert.equal(h[0].wind, 18, '√(3² + 4²) = 5 m/s = 18 km/h')
  assert.equal(h[0].windFrom, 217, 'weht nach Nordost, kommt aus Südwest')
  assert.equal('wind' in h[1], false)
})

test('Parameter aus den Metadaten: auch als Liste von Namen', () => {
  assert.deepEqual(pickParams({ parameters: ['10fg', 'sf', 'tp', '2t'] }), ['2t', 'tp', 'sf', '10fg'], 'Reihenfolge wie die App sie braucht')
  assert.deepEqual(pickParams({ parameters: ['t2m', 'rain_acc'] }), ['t2m', 'rain_acc'])
  assert.equal(pickParams({ parameters: ['tp', 'sf'] }), null, 'ohne Temperatur')
})

// ---------------------------------------------------------------- Warnungen

test('Warnungen: auch als Liste ohne GeoJSON, nur Stufen 1–3, Text aus meteotext', () => {
  const list = parseWarnings({
    warnings: [
      { rawinfo: { wtype: '1', wlevel: '3', start: '1796000000', end: '1796003600' }, meteotext: ' Orkanböen ' },
      { rawinfo: { wtype: 2, wlevel: 0, start: 1, end: 2 } },
      { rawinfo: { wtype: 2, wlevel: 4, start: 1, end: 2 } },
      { rawinfo: { wtype: 3, wlevel: 1, start: 'x', end: 2 } },
    ],
  })
  assert.deepEqual(list, [{ type: 'sturm', level: 3, start: 1796000000000, end: 1796003600000, text: 'Orkanböen' }])
})

test('Warnungen: Zeit als Text mit einstelligem Tag und Stunde, nach Beginn sortiert', () => {
  const list = parseWarnings({ properties: { warnings: [
    { properties: { warntypid: 7, warnstufeid: 1, begin: '5.1.2027 6:00', end: '05.01.2027 18:00', auswirkungen: 'Frost' } },
    { properties: { warntypid: 5, warnstufeid: 2, begin: '04.01.2027 20:00', end: '05.01.2027 02:00' } },
  ] } })
  assert.deepEqual(list.map((w) => w.type), ['gewitter', 'kaelte'])
  assert.equal(new Date(list[1].start).toISOString(), '2027-01-05T05:00:00.000Z', '6 Uhr Winterzeit')
  assert.equal(list[1].text, 'Frost')
})

const warnTexts = [
  [{ type: 'sturm', level: 3 }, 'Sturmwarnung rot'],
  [{ type: 'regen', level: 1 }, 'Starkregenwarnung gelb'],
  [{ type: 'kaelte', level: 2 }, 'Kältewarnung orange'],
  [{ type: 'gewitter', level: 2 }, 'Gewitterwarnung orange'],
]
for (const [w, text] of warnTexts) test(`Warnung als Text: ${text}`, () => assert.equal(warningText(w), text))

// ---------------------------------------------------------------- Tag, Hitze, Sturm

test('Tagesausblick: Tag nach Wiener Zeit, Summen ohne fehlende Werte, Böen gerundet', () => {
  // 1.12. 23:00 UTC = 2.12. 0 Uhr Wien
  const start = Date.parse('2026-12-01T22:00:00Z')
  const h = parseForecast(series(start, 4, { '2t': { data: [9, -1.24, 2.36, null] }, tp: { data: [5, 0.2, null, 0.35] }, '10fg': { unit: 'm s-1', data: [30, 10.1, null, 12.6] } }))
  const o = dayOutlook({ hours: h, warnings: [] }, '2026-12-02')
  assert.deepEqual([o.tMin, o.tMax, o.precip, o.gust, o.known], [-1.2, 2.4, 0.6, 45, true], '22 Uhr UTC (23 Uhr Wien) gehört zum 1.12.')
})

const heatCases = [
  ['29,9 °C ohne Warnung', { tMax: 29.9, warnings: [] }, false],
  ['genau 30 °C', { tMax: 30, warnings: [] }, true],
  ['kühl, aber Hitzewarnung', { tMax: 24, warnings: [{ type: 'hitze', level: 1 }] }, true],
  ['ohne Vorhersage', { tMax: null, warnings: [] }, false],
  ['Gewitterwarnung ist keine Hitze', { tMax: 25, warnings: [{ type: 'gewitter', level: 3 }] }, false],
]
for (const [name, outlook, hot] of heatCases) test(`Hitze-Hinweis (Hitzeschutzverordnung): ${name}`, () => assert.equal(heatCheck(outlook).hot, hot))

const stormCases = [
  ['Böen 59 km/h', { gust: 59, warnings: [] }, false, null],
  ['Böen genau 60 km/h', { gust: 60, warnings: [] }, true, null],
  ['Gewitterwarnung ohne Böen', { gust: null, warnings: [{ type: 'gewitter', level: 1 }] }, true, 'gewitter'],
  ['Sturm rot vor Gewitter gelb', { gust: 20, warnings: [{ type: 'gewitter', level: 1 }, { type: 'sturm', level: 3 }] }, true, 'sturm'],
]
for (const [name, outlook, windy, type] of stormCases)
  test(`Sturm-Hinweis (Glas, Fassade): ${name}`, () => {
    const s = stormCheck(outlook)
    assert.equal(s.windy, windy)
    assert.equal(s.warning?.type ?? null, type)
  })

// ---------------------------------------------------------------- Stunden und Tageskarten

test('Stunden für die Grafik: ab der angebrochenen Stunde, höchstens count, Ende bei einer Lücke', () => {
  const start = Date.parse('2026-12-01T00:00:00Z')
  const h = parseForecast(series(start, 6, { '2t': { data: [0, 1, 2, 3, 4, 5] }, tp: { data: [0, 0.1, 0.2, 0.3, 0.4, 0.5] } }))
  const slots = hourSlots(h, { from: start + 90 * 60e3, count: 2 })
  assert.deepEqual(slots.map((s) => [new Date(s.at).getUTCHours(), s.t, s.precip]), [[1, 1, 0.2], [2, 2, 0.3]], 'Temperatur vom Beginn, Niederschlag vom Ende der Stunde')
  const gap = h.filter((_, i) => i !== 3)
  assert.equal(hourSlots(gap, { from: start, count: 10 }).length, 2, 'fehlt eine Stunde, endet die Reihe davor')
})

test('Tageskarten: Vorhersage endet vor Mitternacht („bis“), Tag ohne Daten bleibt leer', () => {
  const start = Date.parse('2026-12-01T23:00:00Z') // 2.12. 0 Uhr Wien
  const h = parseForecast(series(start, 10, { '2t': { data: Array(10).fill(1) }, tp: { data: Array.from({ length: 10 }, (_, i) => (i === 3 ? 0.4 : 0)) } }))
  const [d, next] = forecastDays({ hours: h, warnings: [] }, ['2026-12-02', '2026-12-03'], null)
  assert.equal(d.hoursKnown, 9)
  assert.equal(d.wetHours, 1)
  assert.equal(new Date(d.until).toISOString(), '2026-12-02T08:00:00.000Z', 'bis 9 Uhr Wien')
  assert.deepEqual(d.kind, { kind: 'clear', label: 'Trocken' }, 'Regen um 2 Uhr nachts zählt nicht fürs Tageswetter (7–19 Uhr)')
  assert.equal(d.sun, null, 'ohne Ort keine Sonnenzeiten')
  assert.deepEqual([next.known, next.kind, next.hoursKnown, next.until], [false, null, 0, null])
})

test('Tageskarten: tagsüber zählt das Merklichste (Gewitter vor Regen vor Bewölkung)', () => {
  const start = Date.parse('2027-07-14T22:00:00Z') // 15.7. 0 Uhr Sommerzeit
  const sy = Array.from({ length: 25 }, (_, i) => (i === 10 ? 8 : i === 15 ? 26 : 3))
  const h = parseForecast(series(start, 25, { '2t': { data: Array(25).fill(25) }, tp: { data: Array(25).fill(0) }, sy: { data: sy } }))
  const [d] = forecastDays({ hours: h, warnings: [] }, ['2027-07-15'], { lat: 47.8, lon: 13.05 })
  assert.deepEqual(d.kind, { kind: 'thunder', label: 'Gewitter' })
  assert.ok(d.sun.rise < d.sun.set)
})

const kinds = [
  ['Symbol 14,4 wird gerundet', { symbol: 14.4 }, 'snow', 'Leichter Schneefall'],
  ['Symbol 0 unbekannt, Bewölkung 60 %', { symbol: 0, cloud: 60 }, 'cloudy', 'Stark bewölkt'],
  ['70 % Schnee', { precip: 1, snow: 0.7 }, 'snow', 'Schneefall'],
  ['viel Schnee ab 2,5 mm', { precip: 2.5, snow: 2.5 }, 'snow', 'Starker Schneefall'],
  ['20 % Schnee: Schneeregen', { precip: 1, snow: 0.2 }, 'sleet', 'Schneeregen'],
  ['Regen ab 1 mm', { precip: 1, snow: 0 }, 'rain', 'Regen'],
  ['Regen unter 1 mm', { precip: 0.5 }, 'rain', 'Leichter Regen'],
  ['Starkregen ab 4 mm', { precip: 4 }, 'heavyrain', 'Starker Regen'],
  ['Bewölkung 19 %', { precip: 0, cloud: 19 }, 'clear', 'Heiter'],
  ['Bewölkung 54 %', { cloud: 54 }, 'partly', 'Wolkig'],
  ['Bewölkung 85 %', { cloud: 85 }, 'overcast', 'Bedeckt'],
]
for (const [name, h, kind, label] of kinds) test(`Wetterart einer Stunde: ${name}`, () => assert.deepEqual(weatherKind(h), { kind, label }))

test('Wetterart: nur Spuren von Niederschlag ohne Bewölkung ist unbekannt', () => {
  assert.equal(weatherKind({ precip: 0.05 }), null)
  assert.deepEqual(weatherKind({ precip: 0 }), { kind: 'clear', label: 'Trocken' })
})

test('Sonne in Salzburg: Sommer gut 16 Stunden, Winter knapp 8½ Stunden, Wien früher hell', () => {
  const summer = sunTimes('2026-06-21', 47.8095, 13.055)
  const winter = sunTimes('2026-12-21', 47.8095, 13.055)
  assert.ok(Math.abs((summer.set - summer.rise) / 3600e3 - 16) < 0.25)
  assert.ok(Math.abs((winter.set - winter.rise) / 3600e3 - 8.4) < 0.25)
  // Aufgang 21.12. ca. 7:54 MEZ
  assert.ok(Math.abs(winter.rise - Date.parse('2026-12-21T06:54:00Z')) < 8 * 60e3)
  const wien = sunTimes('2026-12-21', 48.2082, 16.3738)
  const diff = (winter.rise - wien.rise) / 60e3
  assert.ok(diff > 8 && diff < 16, `Wien ${diff.toFixed(1)} min früher`)
})

// ---------------------------------------------------------------- Zeit, Orte

test('Zeit in Wien: Sommerzeit, Mitternacht, nicht vorhandene Stunde bei der Umstellung', () => {
  assert.equal(new Date(viennaTime('2026-07-01', '06:00')).toISOString(), '2026-07-01T04:00:00.000Z')
  assert.deepEqual(viennaParts(Date.parse('2026-07-01T22:30:00Z')), { date: '2026-07-02', hour: 0, minute: 30 })
  // 28.3.2027: 2:30 gibt es nicht, es wird 3:30 Sommerzeit
  assert.deepEqual(viennaParts(viennaTime('2027-03-28', '02:30')), { date: '2027-03-28', hour: 3, minute: 30 })
})

test('Ort je Objekt: Groß/klein egal, Orte ohne Koordinaten zählen nicht', () => {
  const locations = [{ name: 'ohne', lat: 'unbekannt', lon: 'x' }, { name: 'Salzburg', lat: '47.8', lon: '13.05' }, { name: 'Hallein', lat: 47.68, lon: 13.1 }]
  assert.equal(locationFor({ weatherPlace: ' HALLEIN ' }, locations).name, 'Hallein')
  assert.equal(locationFor({ region: 'ohne' }, locations).name, 'Salzburg', 'ungültiger Ort: der erste gültige')
  assert.equal(locationFor(null, locations).name, 'Salzburg')
  assert.equal(locationFor({}).name, 'Salzburg', 'Standard: Salzburg')
})

const places = [
  ['St. Johann im Pongau', 'St. Johann im Pongau'],
  ['st.', 'St. Gilgen'],
  ['Neumarkt', 'Neumarkt am Wallersee'],
  ['Hall', null],
  ['Zell', 'Zell am See'],
  ['Salzburger', null],
]
for (const [input, name] of places) test(`Ortsliste Salzburg: „${input}“ → ${name ?? 'keiner'}`, () => assert.equal(findPlace(input)?.name ?? null, name))

// ---------------------------------------------------------------- Schnee-Alarm (Datei für den Server)

const LOCS = [{ name: 'Salzburg', lat: 47.81, lon: 13.05 }, { name: 'Hallein', lat: 47.68, lon: 13.1 }]
const OBJECTS = [
  { id: 'o1', name: 'Wohnanlage Lindenhof', address: 'Lindenweg 4, 5020 Salzburg', region: 'Salzburg', winter: { active: true, team: ['e1', 'e2'] } },
  { id: 'o2', name: 'Praxis Kaltenbach', region: 'Salzburg', winter: { active: true, team: ['e2', 'e3'] } },
  { id: 'o3', name: 'Lager Au', region: 'Hallein', winter: { active: false, team: ['e4'] } },
]
const EMPLOYEES = [{ id: 'e1', name: 'Anna Berger', email: 'anna@example.test' }, { id: 'e2', name: 'Boris Kraus' }, { id: 'e3', name: 'Carla Dorn', email: 'carla@example.test' }]

test('Schnee-Alarm: Stufe 1 aus allen Teams am Ort ohne Doppelte, eigene Auswahl geht vor', () => {
  assert.deepEqual(winterAt(LOCS[0], OBJECTS, LOCS).team, ['e1', 'e2', 'e3'])
  assert.deepEqual(winterAt(LOCS[1], OBJECTS, LOCS), { objects: [], team: [] }, 'Lager ohne Winterdienst')
  assert.deepEqual(alarmPlace({ places: { Salzburg: { level1: [] } } }, LOCS[0], OBJECTS, LOCS), { active: true, level1: [], level2: [], rotate: false }, 'leere eigene Liste bleibt leer')
  assert.equal(alarmPlace({ places: { Hallein: { active: false } } }, LOCS[1], OBJECTS, LOCS).active, false)
})

test('Schnee-Alarm: Datei mit Objekten samt Adresse, Regeln als Zahlen, eigener ntfy-Server', () => {
  const alarm = { key: 'k', cronKey: 'c', ntfy: 'https://push.example.test', leadHours: '4', snowCm: '0.5', pauseHours: '6', escalateMin: '10', topics: { e1: 'wd-1', e2: 'wd-2', e3: 'wd-3' }, places: { Hallein: { active: false } } }
  const f = alarmFile({ alarm, locations: LOCS, objects: OBJECTS, employees: EMPLOYEES, address: 'https://app.example.test/' })
  assert.equal(f.ntfy, 'https://push.example.test')
  assert.deepEqual(f.regeln, { vorlaufStunden: 4, schneeCm: 0.5, pauseStunden: 6, eskalationMinuten: 10, ruheVon: '', ruheBis: '', ruheAusnahmeStufe: 2 })
  assert.deepEqual(f.orte.map((o) => o.name), ['Salzburg'])
  assert.deepEqual(f.orte[0].objekte, [{ id: 'o1', name: 'Wohnanlage Lindenhof', adresse: 'Lindenweg 4, 5020 Salzburg' }, { id: 'o2', name: 'Praxis Kaltenbach', adresse: '' }])
  assert.deepEqual(f.orte[0].stufe1.map((p) => p.name), ['Anna Berger', 'Boris Kraus', 'Carla Dorn'])
  assert.deepEqual([f.version, f.adresse, f.absender], [1, 'https://app.example.test/', ''])
})

test('Schnee-Alarm: unbekannte Personen und ungültige Büro-Adressen fallen weg, Probleme je Ort', () => {
  const alarm = { officeEmails: 'buero@example.test,keine-adresse;  chef@example', places: { Salzburg: { level1: ['e9', 'e2'], level2: ['e3'] }, Hallein: { level1: ['e1'] } } }
  const f = alarmFile({ alarm, locations: LOCS, objects: OBJECTS, employees: EMPLOYEES, address: '' })
  assert.deepEqual(f.orte[0].stufe1, [], 'e9 gibt es nicht, Boris hat weder Handy noch E-Mail')
  assert.deepEqual(f.orte[0].stufe2, [{ name: 'Carla Dorn', email: 'carla@example.test' }, { name: 'Büro', email: 'buero@example.test' }])
  assert.deepEqual(f.orte[1].stufe1, [], 'Stufe 1 ohne E-Mail, solange nicht eingeschaltet')
  assert.deepEqual(alarmProblems(f), ['Salzburg: niemand in Stufe 1', 'Hallein: niemand in Stufe 1'])
  const withMail = alarmFile({ alarm: { ...alarm, emailLevel1: true }, locations: LOCS, objects: OBJECTS, employees: EMPLOYEES, address: '' })
  assert.deepEqual(alarmProblems(withMail), ['Salzburg: niemand in Stufe 1', 'Hallein: Stufe 1 ohne Handy (ntfy)'])
})
