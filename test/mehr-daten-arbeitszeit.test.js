import { test } from 'node:test'
import assert from 'node:assert/strict'

import { approveAll, breakWarnings, correctStamp, manualStamp, monthSummary, netMinutes, reasonLabel, viennaIso } from '../src/core/worktime.js'
import { absMinutes, fromServer, mergeStamps, missingCheckins, STATUS_TEXT, stampRows, stampUsers } from '../src/core/timeclock.js'
import { dayIndex, dstMinutes } from '../src/core/dates.js'
import { worktimeDocument } from '../src/export/worktime-pdf.js'

const AT = '2026-11-05T08:00:00Z'
const stamp = (date, from, to, extra = {}) => ({ id: extra.id || `${date}-${from}`, empId: 'e1', date, in: viennaIso(date, from), out: to ? viennaIso(date, to) : null, ...extra })
const wall = (date, hm) => dayIndex(date) * 1440 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))

// ---------------------------------------------------------------- Ortszeit und Zeitumstellung

for (const [date, hm, iso] of [
  ['2026-03-29', '01:30', '2026-03-29T00:30:00.000Z'],
  ['2026-03-29', '03:30', '2026-03-29T01:30:00.000Z'],
  ['2026-10-24', '23:00', '2026-10-24T21:00:00.000Z'],
  ['2026-10-25', '06:00', '2026-10-25T05:00:00.000Z'],
  ['2026-12-31', '23:45', '2026-12-31T22:45:00.000Z'],
]) {
  test(`Arbeitszeit: Wiener Ortszeit ${date} ${hm} → ${iso}`, () => {
    assert.equal(viennaIso(date, hm), iso)
  })
}

test('Arbeitszeit: Nachtdienst in der Nacht der Zeitumstellung im Oktober zählt 9 echte Stunden', () => {
  // Regression: netto war die Differenz der Wanduhrzeiten (8 h), gearbeitet wurde aber eine Stunde länger
  const s = manualStamp({ date: '2026-10-24', empId: 'e1', from: '22:00', to: '06:00', reason: 'vergessen', at: AT })
  assert.equal(s.out, '2026-10-25T05:00:00.000Z')
  assert.equal(netMinutes(s), 540)
  assert.equal(netMinutes({ ...s, pause: 30 }), 510)
})

test('Arbeitszeit: Nachtdienst in der Nacht der Zeitumstellung im März zählt 7 echte Stunden', () => {
  const s = manualStamp({ date: '2026-03-28', empId: 'e1', from: '22:00', to: '06:00', reason: 'vergessen', at: AT })
  assert.equal(netMinutes(s), 420)
})

test('Arbeitszeit: Ist laut Zeiterfassung passt in der Umstellungsnacht zum Soll laut Plan', () => {
  // Der Plan rechnet die Dauer über die Umstellung mit dstMinutes (plan.js); die Monatsübersicht muss gleich zählen
  const start = wall('2026-10-24', '22:00')
  const planNet = 480 + dstMinutes(start, start + 480)
  assert.equal(planNet, 540)
  const s = manualStamp({ date: '2026-10-24', empId: 'e1', from: '22:00', to: '06:00', reason: 'vergessen', at: AT })
  const [p] = monthSummary([{ date: '2026-10-24', empId: 'e1', inst: { net: planNet }, stamp: s, status: 'ok' }])
  assert.deepEqual([p.soll, p.ist, p.diff], [540, 540, 0])
})

test('Ruhepause § 11 AZG: 22–4 Uhr in der Oktober-Umstellungsnacht sind 7 Stunden und brauchen eine Pause', () => {
  const s = { empId: 'e1', date: '2026-10-24', in: viennaIso('2026-10-24', '22:00'), out: viennaIso('2026-10-25', '04:00') }
  assert.deepEqual(breakWarnings([s]), [{ empId: 'e1', date: '2026-10-24', minutes: 420 }])
})

test('Arbeitszeit: Sekunden werden wie bei der Stempeluhr abgeschnitten (05:55:30–08:33:10 = 158 Minuten)', () => {
  const s = { in: '2026-11-03T04:55:30.000Z', out: '2026-11-03T07:33:10.000Z' }
  assert.equal(netMinutes(s), absMinutes(s.out) - absMinutes(s.in))
  assert.equal(netMinutes(s), 158)
})

test('Arbeitszeit: ohne Gehen keine Netto-Zeit, Pause länger als der Einsatz ergibt 0', () => {
  assert.equal(netMinutes(stamp('2026-11-04', '06:00', null)), null)
  assert.equal(netMinutes(null), null)
  assert.equal(netMinutes(stamp('2026-11-04', '06:00', '06:20', { pause: 30 })), 0)
  assert.equal(netMinutes(stamp('2026-11-04', '06:00', '08:00', { pause: 'x' })), 120)
})

// ---------------------------------------------------------------- Nachtragen und Korrigieren

for (const [label, input, message] of [
  ['ohne Person', { date: '2026-11-04', from: '06:00', reason: 'vergessen' }, /Person, Datum und Kommen/],
  ['Datum österreichisch', { empId: 'e1', date: '04.11.2026', from: '06:00', reason: 'vergessen' }, /Person, Datum und Kommen/],
  ['Kommen ohne führende Null', { empId: 'e1', date: '2026-11-04', from: '6:00', reason: 'vergessen' }, /Person, Datum und Kommen/],
  ['Gehen kein Uhrzeitformat', { empId: 'e1', date: '2026-11-04', from: '06:00', to: '9 Uhr', reason: 'vergessen' }, /Gehen als Uhrzeit/],
  ['ohne Grund', { empId: 'e1', date: '2026-11-04', from: '06:00', to: '09:00' }, /Bitte einen Grund wählen/],
]) {
  test(`Nachtragen abgelehnt: ${label}`, () => {
    assert.throws(() => manualStamp(input), message)
  })
}

test('Nachtragen: negative Pause wird 0, ohne Gehen offen, gleiche Uhrzeit heißt 24 Stunden, Notiz nur wenn angegeben', () => {
  const open = manualStamp({ date: '2026-11-04', empId: 'e1', from: '06:00', pause: -15, reason: 'handy', at: AT })
  assert.deepEqual([open.pause, open.out, 'note' in open, open.changed], [0, null, false, Math.floor(Date.parse(AT) / 1000)])
  const day = manualStamp({ date: '2026-11-04', empId: 'e1', name: 'Eva', objectId: 'o1', objectName: 'Kanzlei Beispiel', from: '06:00', to: '06:00', pause: '15', reason: 'sonstiges', note: 'Inventur', at: AT })
  assert.equal(netMinutes(day), 1440 - 15)
  assert.deepEqual([day.note, day.objectName, day.name, day.source], ['Inventur', 'Kanzlei Beispiel', 'Eva', 'manuell'])
})

test('Korrektur: ohne Grund abgelehnt, Pause bleibt ohne Angabe, ausdrücklich 0 gilt, Notiz im Verlauf', () => {
  const s = { id: 'z1', date: '2026-11-04', empId: 'e1', in: viennaIso('2026-11-04', '06:00'), out: viennaIso('2026-11-04', '10:00'), pause: 20, changed: 9999999999 }
  assert.throws(() => correctStamp(s, { from: '06:00', to: '10:00' }), /Grund für die Korrektur/)
  const keep = correctStamp(s, { from: '06:30', to: '10:00', reason: 'falsch', note: 'QR-Code am falschen Objekt', by: 'Büro', at: AT })
  assert.equal(keep.pause, 20)
  assert.equal(netMinutes(keep), 190)
  assert.deepEqual(keep.changes, [{ at: AT, by: 'Büro', reason: 'falsch', note: 'QR-Code am falschen Objekt', before: { in: s.in, out: s.out, pause: 20 } }])
  assert.equal(keep.changed, 9999999999, 'neuerer Änderungsstand vom Webspace bleibt')
  assert.equal(correctStamp(s, { from: '06:00', to: '10:00', pause: 0, reason: 'sonstiges', at: AT }).pause, 0)
  assert.equal(keep.id, 'z1')
})

test('Gründe als Text: bekannte, unbekannte und fehlende', () => {
  assert.equal(reasonLabel('handy'), 'Handy/Netz ging nicht')
  assert.equal(reasonLabel('Schlüssel vergessen'), 'Schlüssel vergessen')
  assert.equal(reasonLabel(undefined), '')
})

// ---------------------------------------------------------------- Ruhepausen und Freigabe

test('Ruhepause § 11 AZG: Grenzen bei 6 Stunden und 30 Minuten, je Person und Tag getrennt', () => {
  assert.equal(breakWarnings([stamp('2026-11-04', '06:00', '12:01')]).length, 1, '6 h 1 min')
  assert.equal(breakWarnings([stamp('2026-11-04', '06:00', '13:00', { pause: 29 })]).length, 1, '29 min Pause zu kurz')
  assert.equal(breakWarnings([stamp('2026-11-04', '06:00', '10:00'), stamp('2026-11-04', '10:30', '13:00')]).length, 0, 'Lücke genau 30 min')
  const two = [stamp('2026-11-04', '06:00', '10:00'), stamp('2026-11-04', '10:05', '13:00', { empId: 'e2' }), stamp('2026-11-05', '06:00', '10:00', { id: 'b' }), stamp('2026-11-05', '10:05', '13:00', { id: 'c' })]
  assert.deepEqual(breakWarnings(two), [{ empId: 'e1', date: '2026-11-05', minutes: 415 }])
  assert.equal(breakWarnings([stamp('2026-11-04', '06:00', '13:00')], { limit: 480 }).length, 0, 'eigene Grenze')
  assert.equal(breakWarnings([stamp('2026-11-04', '06:00', '13:00', { empId: '' }), stamp('2026-11-04', '06:00', null)]).length, 0, 'ohne Person oder ohne Gehen')
})

test('Freigabe: bereits freigegebene behalten den Prüfer, offene Stempelungen werden nicht freigegeben', () => {
  const list = [stamp('2026-11-04', '06:00', '08:00', { approved: { by: 'Chefin', at: 'x' } }), stamp('2026-11-04', '09:00', '10:00'), stamp('2026-11-04', '11:00', null)]
  assert.equal(approveAll(list, { by: 'Büro', at: AT }), 1)
  assert.deepEqual(list.map((s) => s.approved?.by), ['Chefin', 'Büro', undefined])
  assert.equal(approveAll(list, { by: 'Büro', at: AT }), 0)
})

test('Monatsübersicht: Soll aus Beginn/Ende ohne net, zwei Personen, Korrekturen zählen als Nachtrag, Tage einmal', () => {
  const corrected = { ...stamp('2026-11-04', '06:00', '08:00'), changes: [{ reason: 'falsch' }], approved: { by: 'x' } }
  const rows = [
    { date: '2026-11-04', empId: 'e1', inst: { start: 100, end: 220 }, stamp: corrected, status: 'ok' },
    { date: '2026-11-04', empId: 'e1', inst: { net: 60 }, stamp: stamp('2026-11-04', '09:00', '10:00', { id: 'b' }), status: 'frueh' },
    { date: '2026-11-05', empId: 'e2', inst: { net: 90 }, stamp: stamp('2026-11-05', '06:00', null, { empId: 'e2' }), status: 'offen' },
    { date: '2026-11-05', empId: null, inst: { net: 999 }, stamp: null, status: 'fehlt' },
  ]
  const [a, b] = monthSummary(rows)
  assert.deepEqual({ ...a }, { empId: 'e1', soll: 180, ist: 180, diff: 0, spaet: 0, frueh: 1, fehlt: 0, manuell: 1, offen: 1, tage: 1 })
  assert.deepEqual([b.empId, b.soll, b.ist, b.offen, b.tage], ['e2', 90, 0, 0, 0])
})

// ---------------------------------------------------------------- Zeiterfassung vom Webspace

const D = '2026-11-03'
const server = (over = {}) => ({ id: 'abcdefabcdef', hash: 'h-eva', name: 'Eva', objektId: 'o1', objekt: 'Kanzlei', einsatz: `${D}|t1`, plan: '06:00–08:00', datum: D, kommen: Date.parse(viennaIso(D, '05:58')) / 1000, gehen: Date.parse(viennaIso(D, '08:02')) / 1000, geaendert: Date.parse(viennaIso(D, '08:02')) / 1000, ...over })

test('Zeiterfassung: unbekannte Person ohne Zuordnung, Gehen 0 ist offen, Änderungszeit ersatzweise Kommen', () => {
  const s = fromServer(server({ hash: 'fremd', gehen: 0, geaendert: undefined }), new Map([['h-eva', 'e1']]))
  assert.deepEqual([s.empId, s.out, s.changed], [null, null, server().kommen])
  assert.equal(fromServer(server({ einsatz: 42 })).instKey, '')
})

for (const [label, over] of [
  ['Großbuchstaben in der Kennung', { id: 'ABCDEFABCDEF' }],
  ['zu kurze Kennung', { id: 'abc' }],
  ['Datum ohne Bindestriche', { datum: '03.11.2026' }],
  ['Kommen fehlt', { kommen: 0 }],
]) {
  test(`Zeiterfassung: unbrauchbarer Datensatz verworfen – ${label}`, () => {
    assert.equal(fromServer(server(over)), null)
  })
}

test('Zeiterfassung: ältere Stände überschreiben nichts, Unbrauchbares wird übersprungen, ohne Liste nichts', () => {
  const stamps = {}
  const index = new Map([['h-eva', 'e1']])
  assert.equal(mergeStamps(stamps, [server(), { id: '../x' }], index), 1)
  assert.equal(mergeStamps(stamps, [server({ gehen: 0, geaendert: server().geaendert - 60 })], index), 0)
  assert.ok(Object.values(stamps)[0].out, 'Gehen bleibt erhalten')
  assert.equal(mergeStamps(stamps, null, index), 0)
  assert.deepEqual([...stampUsers({ ...stamps, x: { empId: null }, y: { empId: '' } })], ['e1'])
})

test('Plan gegen Ist: genau 10 Minuten zu spät ist noch in Ordnung, 11 nicht; früher gegangen; nur eigene Stempelung', () => {
  const inst = (key, from, to) => ({ key: `${D}|${key}`, date: D, objectId: 'o1', start: wall(D, from), end: wall(D, to), status: 'normal' })
  const instances = [inst('t1', '06:00', '08:00'), inst('t2', '09:00', '11:00'), inst('t3', '12:00', '14:00'), inst('t4', '15:00', '16:00')]
  const state = { assigned: (k) => (k.endsWith('t4') ? [{ employeeId: 'e1' }, { employeeId: 'e2' }] : [{ employeeId: 'e1' }]) }
  const st = (id, key, from, to, empId = 'e1') => ({ id, date: D, empId, objectId: 'o1', instKey: `${D}|${key}`, in: viennaIso(D, from), out: to ? viennaIso(D, to) : null })
  const stamps = { a: st('a', 't1', '06:10', '08:00'), b: st('b', 't2', '09:11', '11:00'), c: st('c', 't3', '12:00', '13:49'), d: st('d', 't4', '15:00', null, 'e2') }
  const rows = stampRows({ instances, state, stamps, from: D, to: D, users: new Set(['e1', 'e2']), now: wall(D, '15:30') })
  const of = (key, emp = 'e1') => rows.find((r) => r.inst?.key === `${D}|${key}` && r.empId === emp)
  assert.deepEqual([of('t1').status, of('t1').late], ['ok', 10])
  assert.deepEqual([of('t2').status, of('t2').late], ['spaet', 11])
  assert.deepEqual([of('t3').status, of('t3').early, of('t3').minutes], ['frueh', 11, 109])
  assert.equal(of('t4').status, 'fehlt', 'e1 hat für t4 nicht gestempelt')
  assert.deepEqual([of('t4', 'e2').status, of('t4', 'e2').minutes], ['offen', null])
  assert.equal(STATUS_TEXT[of('t2').status], 'später gekommen')
})

test('Plan gegen Ist: Stempelung ohne Einsatz und ohne Gehen, Sortierung nach Tag und Beginn', () => {
  const stamps = {
    x: { id: 'x', date: '2026-11-04', empId: 'e1', objectId: 'o7', instKey: '', in: viennaIso('2026-11-04', '07:00'), out: null },
    y: { id: 'y', date: '2026-11-03', empId: 'e1', objectId: 'o7', instKey: '', in: viennaIso('2026-11-03', '18:00'), out: viennaIso('2026-11-03', '19:30') },
    z: { id: 'z', date: '2026-11-03', empId: 'e1', objectId: 'o7', instKey: '', in: viennaIso('2026-11-03', '06:00'), out: viennaIso('2026-11-03', '06:45') },
  }
  const rows = stampRows({ instances: [], state: { assigned: () => [] }, stamps, from: '2026-11-03', to: '2026-11-04', users: new Set(['e1']), now: 0 })
  assert.deepEqual(rows.map((r) => [r.stamp.id, r.status, r.minutes]), [['z', 'ohnePlan', 45], ['y', 'ohnePlan', 90], ['x', 'ohnePlan', null]])
})

test('Nicht eingestempelt: ohne laufenden Einsatz gibt es nichts zu melden', () => {
  const instances = [{ key: `${D}|t1`, date: D, objectId: 'o1', start: wall(D, '06:00'), end: wall(D, '08:00'), status: 'normal' }]
  assert.deepEqual(missingCheckins({ instances, state: { assigned: () => [{ employeeId: 'e1' }] }, stamps: {}, users: new Set(['e1']), now: wall(D, '09:00') }), [])
})

// ---------------------------------------------------------------- Arbeitszeitaufzeichnung als PDF

test('Arbeitszeitaufzeichnung (§ 26 AZG): Nachtrag und Korrektur mit Grund, fehlende Stempelung, Summe gegen Soll', () => {
  const s = manualStamp({ date: '2026-11-04', empId: 'e1', from: '06:00', to: '09:00', pause: 15, reason: 'handy', by: 'Büro', at: AT })
  const c = correctStamp(s, { from: '06:00', to: '09:30', reason: 'laenger', by: 'Büro', at: AT })
  const rows = [
    { date: '2026-11-04', empId: 'e1', inst: { objectId: 'o1', startTime: '06:00', endTime: '09:00', net: 180 }, stamp: c, status: 'ok' },
    { date: '2026-11-05', empId: 'e1', inst: { objectId: 'o1', startTime: '06:00', endTime: '09:00', net: 180 }, stamp: null, status: 'fehlt' },
    { date: '2026-11-06', empId: 'e1', inst: null, stamp: { id: 'w', date: '2026-11-06', empId: 'e1', objectName: 'Lager Beispiel', in: viennaIso('2026-11-06', '14:00'), out: null }, status: 'ohnePlan' },
  ]
  const summary = monthSummary(rows)[0]
  const doc = worktimeDocument({ employee: { name: 'Eva Muster', personnelNo: '0815' }, monthLabel: 'November 2026', rows, summary, objName: (id) => (id === 'o1' ? 'Kanzlei Beispiel' : ''), createdAt: new Date('2026-12-01T10:00:00Z') })
  const table = doc.content.find((x) => x.table).table.body
  assert.deepEqual(table[1].slice(0, 7), ['Mi 04.11.', 'Kanzlei Beispiel', '06:00–09:00', '06:00', '09:30', '15 min', '3,25'])
  assert.equal(table[1][7].text, 'nachgetragen: Handy/Netz ging nicht (Büro)\nkorrigiert: Einsatz hat länger gedauert (vorher 06:00–09:00, Büro)')
  assert.equal(table[2][7].text, 'nicht eingestempelt')
  assert.deepEqual(table[3].slice(0, 7), ['Fr 06.11.', 'Lager Beispiel', '–', '14:00', '…', '', ''])
  assert.equal(table.at(-1)[6].text, '3,25')
  assert.equal(table.at(-1)[7].text, 'Soll laut Plan 6 h · Differenz −2,75 h')
  const text = JSON.stringify(doc.content)
  assert.match(text, /Personalnr\. 0815/)
  assert.match(text, /nachgetragen\/korrigiert: 1/)
  assert.equal(doc.info.title, 'Arbeitszeitaufzeichnung Eva Muster November 2026')
})

test('Arbeitszeitaufzeichnung ohne Zeiten im Monat: Hinweis statt Tabelle, Unterschriftsfelder bleiben', () => {
  const doc = worktimeDocument({ employee: { name: 'Bo Beispiel' }, monthLabel: 'Dezember 2026', rows: [], summary: { soll: 0, ist: 0, diff: 0, tage: 0, spaet: 0, frueh: 0, fehlt: 0, manuell: 0 } })
  const text = JSON.stringify(doc.content)
  assert.match(text, /Keine Zeiten in diesem Monat\./)
  assert.ok(!doc.content.some((x) => x.table))
  assert.match(text, /Datum, Unterschrift Mitarbeiter\/in/)
  assert.match(text, /Datum, Unterschrift Arbeitgeber/)
  assert.doesNotMatch(text, /Personalnr/)
})
