import { test } from 'node:test'
import assert from 'node:assert/strict'

import { contrast, hueDistance, luminance, mix, parseColor, readableOn, textOn, toHex, toHsl } from '../src/core/color.js'
import { fileSafe } from '../src/core/filename.js'
import { coordsText, estimateTravel, haversineKm, hasCoords, nominatimUrl, parseCoords, parseNominatim } from '../src/core/geo.js'
import { importEmployees, importTasks, parseInterval, parseMonthInterval, parseTable, parseWeekdays, travelMinutes } from '../src/core/importer.js'
import { giveBack, handOver, markLost } from '../src/core/keys.js'
import { issueMoves, stockOf } from '../src/core/material.js'
import { mergeDoc } from '../src/core/merge.js'

// ---------------------------------------------------------------- Entfernung und Fahrzeit (geo.js)

const a = { lat: 47.8, lon: 13.0 }
const b = { lat: 47.9, lon: 13.0 }

test('Entfernung: in beide Richtungen gleich, 0,1° Breite ≈ 11,1 km, gleicher Ort 0', () => {
  assert.ok(Math.abs(haversineKm(a, b) - 11.12) < 0.02)
  assert.equal(haversineKm(a, b), haversineKm(b, a))
  assert.equal(haversineKm(a, a), 0)
})

const travelCases = [
  ['Standard (35 km/h, 5 min Zuschlag, Umweg 1,35)', {}, 35, 15],
  ['Mindesttempo 5 km/h', { speedKmh: 1 }, 190, 15],
  ['ohne Zuschlag und Umweg', { baseMin: 0, detour: 1 }, 20, 11.1],
  ['schnell auf der Autobahn (15,0 min wird auf 20 aufgerundet)', { speedKmh: 90 }, 20, 15],
]
for (const [name, opts, minutes, km] of travelCases)
  test(`Fahrzeit geschätzt: ${name} → ${minutes} min`, () => assert.deepEqual(estimateTravel(a, b, opts), { minutes, km }))

const coordCases = [
  [' 47.8 , 13.05 ', { lat: 47.8, lon: 13.05 }],
  ['47,8;13,05', { lat: 47.8, lon: 13.05 }],
  ['50.1, 13', null],
  ['47.8, 18.5', null],
  ['-47.8, 13', null],
  ['47.8', null],
  ['', null],
]
for (const [text, out] of coordCases) test(`Koordinaten lesen: „${text}“`, () => assert.deepEqual(parseCoords(text), out))

test('Koordinaten: nur echte Zahlen zählen, Text mit fünf Stellen, Suche mit Umlauten', () => {
  assert.equal(hasCoords({ lat: '47.8', lon: 13 }), false, 'Text zählt nicht als Koordinate')
  assert.equal(hasCoords(null), false)
  assert.equal(coordsText({ lat: 47.8 }), '')
  assert.equal(coordsText({ lat: 47.123456, lon: 13 }), '47.12346, 13.00000')
  assert.equal(nominatimUrl('Hauptstraße 1, Straßwalchen'), 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&q=Hauptstra%C3%9Fe%201%2C%20Stra%C3%9Fwalchen')
  assert.equal(parseNominatim([{ lat: 'x', lon: '13' }]), null)
  assert.deepEqual(parseNominatim([{ lat: '47.5', lon: '13.25' }]), { lat: 47.5, lon: 13.25, label: '' })
  assert.equal(parseNominatim({ lat: 47 }), null, 'keine Liste')
})

// ---------------------------------------------------------------- Excel-Import (importer.js)

test('Tabelle einfügen: Windows-Zeilenenden, leere Zeilen, fehlende Zellen, Anführungszeichen', () => {
  const rows = parseTable('Name;Stunden;Team\r\n"Anna Berger";20\r\n\r\nBoris;"38,5";Nord\r\n')
  assert.deepEqual(rows, [{ Name: 'Anna Berger', Stunden: '20', Team: '' }, { Name: 'Boris', Stunden: '38,5', Team: 'Nord' }])
  assert.deepEqual(parseTable('Name\tTeam'), [], 'nur Überschrift')
  assert.deepEqual(parseTable(''), [])
})

const dayCases = [
  ['Mo-Mi, Fr', [1, 2, 3, 5]],
  ['Mo–Fr', [1, 2, 3, 4, 5]],
  ['Di und Do', [2, 4]],
  ['Sa/So', [6, 7]],
  ['Montag; Mittwoch', [1, 3]],
  ['Mo, Mo, Di', [1, 2]],
  ['xyz', []],
  ['', []],
]
for (const [text, days] of dayCases) test(`Wochentage aus Excel: „${text}“`, () => assert.deepEqual(parseWeekdays(text), days))

const travelTexts = [
  ['3 min', 3],
  ['4 Minuten', 4],
  ['45 min', 45],
  ['2', 120],
  ['0,25 h', 15],
  ['1 h 30 min', 60],
  ['7', 7],
  ['-', null],
]
for (const [text, minutes] of travelTexts) test(`Fahrzeit aus Excel: „${text}“ → ${minutes} min`, () => assert.equal(travelMinutes(text), minutes))

const monthTexts = [
  ['vierteljährlich', 3],
  ['Vierteljahr', 3],
  ['quartalsweise', 3],
  ['halbjährlich', 6],
  ['jährlich', 12],
  ['zweimonatlich', 2],
  ['alle 3 Monate', 3],
  ['wöchentlich', null],
]
for (const [text, months] of monthTexts) test(`Monatsrhythmus aus Excel: „${text}“ → ${months ?? 'kein Monatsrhythmus'}`, () => assert.equal(parseMonthInterval(text), months))

test('Wochenrhythmus aus Excel: dreiwöchentlich, vier Wochen, Zahl außerhalb 1–4', () => {
  assert.deepEqual(['dreiwöchentlich', 'alle 4 Wochen', '21-tägig', '5', '0', ''].map(parseInterval), [3, 4, 3, 1, 1, 1])
})

test('Mitarbeitende aus Excel: Beschäftigung erkannt, Komma-Stunden, Uhrzeiten mit Punkt, Fehler je Zeile', () => {
  const text = 'Mitarbeiterin\tBeschäftigung\tStunden\tQualifikationen\tTage\tVon\tBis\nAnna Berger\tgeringfügig beschäftigt\t10,5\tGlas/Führerschein, Erste Hilfe\tMo-Mi\t7\t12.30\n\tVollzeit\t40\t\t\t\t\nCem Dorn\tLehrling 2. Jahr\t\t\t\t\t\nDora Egger\tFreie Dienstnehmerin\t20\t\t\t\t'
  const { items, errors } = importEmployees(text)
  assert.deepEqual(errors, ['Zeile 3: Name fehlt'])
  assert.deepEqual(items.map((e) => [e.name, e.type, e.weeklyHours]), [['Anna Berger', 'Geringfügig', 10.5], ['Cem Dorn', 'Lehrling', 0], ['Dora Egger', 'Teilzeit', 20]], 'unbekannte Beschäftigung: Teilzeit')
  assert.deepEqual(items[0].skills, ['Glas', 'Führerschein', 'Erste Hilfe'])
  assert.deepEqual(items[0].availability, { 1: { from: '07:00', to: '12:30' }, 2: { from: '07:00', to: '12:30' }, 3: { from: '07:00', to: '12:30' } })
  assert.deepEqual(Object.keys(items[1].availability), ['1', '2', '3', '4', '5'], 'ohne Tage: Mo–Fr')
  assert.deepEqual(items[1].availability[1], { from: '06:00', to: '20:00' })
})

test('Leistungen aus Excel: alle Fehler je Zeile, Personen aus den Stammkräften, Feiertagsregel', () => {
  const employees = [{ id: 'e1', name: 'Anna Berger' }, { id: 'e2', name: 'Boris Kraus' }]
  const text = 'Objekt\tLeistung\tTage\tVon\tBis\tStammkraft\tAn Feiertagen\tFahrzeit danach\n' + ['Kanzlei\tGartenpflege\tMo\t8\t10\tAnna, Boris\tnein\t3 min', '\tUnterhalt\tDi\t8\t9\t\t\t', 'Praxis\tUnterhalt\tirgendwann\t8:00\t9:00\tUnbekannt\tverschoben\t', 'Lager\tUnterhalt\tFr\tfrüh\t9\t\t\t'].join('\n')
  const { items, errors } = importTasks(text, employees)
  assert.deepEqual(errors, ['Zeile 3: Objekt fehlt', 'Zeile 4: Tage nicht erkannt („irgendwann“)', 'Zeile 4: Stammkraft „Unbekannt“ nicht gefunden', 'Zeile 5: Uhrzeit nicht erkannt'])
  assert.equal(items.length, 1)
  const t = items[0].task
  assert.deepEqual([t.staff, t.regulars, t.holidayRule, t.category, t.start, t.end, t.travelAfterMin], [2, ['e1', 'e2'], 'entfaellt', 'sonder', '08:00', '10:00', 3])
})

test('Leistungen aus Excel: „vierteljährlich“ wird alle 3 Monate, „14-tägig“ bekommt den Stichtag', () => {
  const text = 'Objekt\tTage\tVon\tBis\tIntervall\nKanzlei\tSa\t08:00\t12:00\tvierteljährlich\nPraxis\tDi\t08:00\t09:00\t14-tägig\nLager\tMi\t08:00\t09:00\twöchentlich'
  const { items } = importTasks(text, [], { anchor: '2026-11-04' })
  assert.deepEqual(items[0].task.recurrence, { type: 'monthly', mode: 'nth', nth: 1, weekday: 6, everyMonths: 3, anchor: '2026-11-01' })
  assert.deepEqual(items[1].task.recurrence, { type: 'weekly', weekdays: [2], everyWeeks: 2, anchor: '2026-11-04' })
  assert.deepEqual(items[2].task.recurrence, { type: 'weekly', weekdays: [3], everyWeeks: 1 }, 'wöchentlich braucht keinen Stichtag')
})

// ---------------------------------------------------------------- Gleichzeitig bearbeiten (merge.js)

test('Zusammenführen: beide ändern verschiedene Felder desselben Eintrags', () => {
  const base = { objects: [{ id: 'o1', name: 'Kanzlei', address: 'Markt 1' }] }
  const local = { objects: [{ id: 'o1', name: 'Kanzlei am Markt', address: 'Markt 1' }] }
  const remote = { objects: [{ id: 'o1', name: 'Kanzlei', address: 'Markt 1a' }] }
  assert.deepEqual(mergeDoc(base, local, remote), { objects: [{ id: 'o1', name: 'Kanzlei am Markt', address: 'Markt 1a' }] })
})

test('Zusammenführen: dasselbe Feld verschieden geändert – die eigene Änderung gewinnt', () => {
  assert.deepEqual(mergeDoc({ x: 1 }, { x: 2 }, { x: 3 }), { x: 2 })
  assert.deepEqual(mergeDoc({ x: 1 }, { x: 1 }, { x: 3 }), { x: 3 }, 'selbst nicht geändert: fremder Stand')
})

test('Zusammenführen: Löschen gegen Ändern – Änderungen gehen nie still verloren', () => {
  const base = { list: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] }
  assert.deepEqual(mergeDoc(base, { list: [{ id: 'b', v: 1 }] }, { list: [{ id: 'a', v: 2 }, { id: 'b', v: 1 }] }), { list: [{ id: 'a', v: 2 }, { id: 'b', v: 1 }] }, 'selbst gelöscht, fremd geändert: bleibt')
  assert.deepEqual(mergeDoc(base, { list: [{ id: 'a', v: 1 }, { id: 'b', v: 5 }] }, { list: [{ id: 'a', v: 1 }] }), { list: [{ id: 'a', v: 1 }, { id: 'b', v: 5 }] }, 'fremd gelöscht, selbst geändert: bleibt')
  assert.deepEqual(mergeDoc(base, { list: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] }, { list: [{ id: 'a', v: 1 }] }), { list: [{ id: 'a', v: 1 }] }, 'fremd gelöscht, selbst unverändert: weg')
})

test('Zusammenführen: Felder löschen – unverändert weg, fremd geändert bleibt', () => {
  assert.deepEqual(mergeDoc({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2, c: 3 }), { a: 1, c: 3 })
  assert.deepEqual(mergeDoc({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 9 }), { a: 1, b: 9 })
})

test('Zusammenführen: eigene Umsortierung bleibt, Neues der anderen Seite hinten an', () => {
  const base = { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  const local = { list: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] }
  const remote = { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
  assert.deepEqual(mergeDoc(base, local, remote).list.map((x) => x.id), ['c', 'a', 'b', 'd'])
})

test('Zusammenführen: Listen ohne Kennung als Menge – keine Doppelten, eigenes Entfernen gilt', () => {
  assert.deepEqual(mergeDoc({ tags: ['a', 'b'] }, { tags: ['b', 'x'] }, { tags: ['a', 'b', 'x', 'y'] }), { tags: ['b', 'x', 'y'] })
})

test('Zusammenführen Lager: zwei Personen buchen gleichzeitig – beide Buchungen zählen', () => {
  let n = 0
  const newId = () => `b${++n}`
  const base = { moves: [{ id: 'start', articleId: 'a', loc: 'lager', qty: 20, kind: 'eingang', date: '2026-11-01' }] }
  const local = { moves: [...base.moves, ...issueMoves([{ articleId: 'a', qty: 3 }], { objectId: 'o1', date: '2026-11-03', at: 'x', newId })] }
  const remote = { moves: [...base.moves, ...issueMoves([{ articleId: 'a', qty: 5 }], { objectId: 'o2', date: '2026-11-03', at: 'y', newId })] }
  const merged = mergeDoc(base, local, remote)
  assert.equal(merged.moves.length, 3)
  assert.equal(stockOf(merged.moves, 'a'), 12)
})

test('Zusammenführen Schlüsselbuch: Ausgabe hier, Verlustmeldung dort – beides bleibt erhalten', () => {
  const k = (id) => ({ id, objectId: 'o1', label: id, holderId: '', status: 'aktiv', history: [] })
  const base = { keys: [k('k1'), k('k2')] }
  const at = '2026-11-03T08:00:00.000Z'
  const local = { keys: [handOver(k('k1'), { to: 'e1', date: '2026-11-03', at }), k('k2')] }
  const remote = { keys: [k('k1'), markLost(k('k2'), { date: '2026-11-03', text: 'weg', at })] }
  const merged = mergeDoc(base, local, remote)
  assert.deepEqual(merged.keys.map((x) => [x.id, x.holderId, x.status, x.history.length]), [['k1', 'e1', 'aktiv', 1], ['k2', '', 'verloren', 1]])
  // derselbe Schlüssel: hier zurückgegeben, dort an jemand anderen ausgegeben → eigener Stand (Feld für Feld)
  const both = mergeDoc(local, { keys: [giveBack(local.keys[0], { date: '2026-11-04', at }), k('k2')] }, { keys: [handOver(local.keys[0], { to: 'e2', date: '2026-11-04', at }), k('k2')] })
  assert.equal(both.keys[0].holderId, '')
  assert.deepEqual(both.keys[0].history.map((h) => [h.kind, h.to || '']), [['ausgabe', 'e1'], ['ausgabe', 'e2'], ['rueckgabe', '']], 'Verlauf beider Seiten bleibt (als Menge: fremder Stand, eigene Zugänge dahinter)')
})

// ---------------------------------------------------------------- Dateinamen und Farben

const names = [
  ['Leistungsnachweis Kanzlei Süd/West.pdf', 'Leistungsnachweis_Kanzlei_SuedWest.pdf'],
  ['Đorđe Łukasz Søren', 'Dorde_Lukasz_Soren'],
  ['Café „Zentral“ 50%', 'Cafe_Zentral_50'],
  ['Straße: Plan?*', 'Strasse_Plan'],
  ['  zwei   Leerzeichen ', '_zwei_Leerzeichen_'],
  ['Æsop Ørsted', 'Aesop_Orsted'],
  ['Wetter & Winterdienst 2026', 'Wetter_Winterdienst_2026'],
  ['Material – Lager', 'Material_Lager'],
]
for (const [input, out] of names) test(`Dateiname ohne Sonderzeichen: „${input}“ → ${out}`, () => assert.equal(fileSafe(input), out))

test('Farben lesen: Kurzform mit Alpha, Prozentwerte, ungültige Angaben', () => {
  assert.deepEqual(parseColor('#0a38'), { r: 0, g: 170, b: 51, a: 136 / 255 })
  assert.deepEqual(parseColor('rgb(100% 0% 50%)'), { r: 255, g: 0, b: 127.5, a: 1 })
  assert.deepEqual(parseColor('rgba(300, -5, 10, 50%)'), { r: 255, g: 0, b: 10, a: 0.5 }, 'auf 0–255 begrenzt')
  assert.equal(toHex(parseColor('hsl(120 100% 25%)')), '#008000')
  for (const bad of ['#12345', 'blue', 'rgb(1,2)', 'hsl(x 1% 2%)', '', null]) assert.equal(parseColor(bad), null, String(bad))
})

test('Farben rechnen: HSL, Helligkeit, Mischen, Farbabstand über 0°', () => {
  assert.deepEqual(toHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 1 })
  assert.equal(Math.round(toHsl(parseColor('#0000ff')).h), 240)
  assert.equal(luminance('#ffffff'), 1)
  assert.equal(luminance('#000000'), 0)
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mix('#0c6cb4', '#ffffff', 0), '#0c6cb4')
  assert.equal(hueDistance('#ff0000', '#0000ff'), 120)
  assert.equal(Math.round(hueDistance('hsl(350 80% 50%)', 'hsl(10 80% 50%)')), 20, 'über 0° hinweg')
  assert.equal(Math.round(contrast('#777777', '#ffffff') * 100) / 100, Math.round(contrast('#ffffff', '#777777') * 100) / 100)
})

test('Lesbarkeit: auf dunklem Grund wird zu Weiß hin aufgehellt, Schrift auf Grün', () => {
  const dark = '#13232f'
  const c = readableOn('#0c6cb4', dark)
  assert.ok(contrast(c, dark) >= 4.5)
  assert.ok(luminance(c) > luminance('#0c6cb4'), 'heller als vorher')
  assert.equal(readableOn('#ffffff', '#000000'), '#ffffff', 'schon lesbar: unverändert')
  assert.equal(textOn('#9cc654'), '#111827')
  assert.equal(textOn('#0a5a96'), '#ffffff')
})
