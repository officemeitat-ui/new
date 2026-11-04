import { test } from 'node:test'
import assert from 'node:assert/strict'

import { viennaTime } from '../src/core/weather.js'
import { entriesFor, fromServer, logRows, missingLogs, newFromServer, photoPath, STREUMITTEL, workText } from '../src/core/winterlog.js'

const sec = (iso) => Math.floor(Date.parse(iso) / 1000)

test('Protokoll vom Handy: Datum aus der Erledigt-Zeit in Wien, wenn der Server keins schickt', () => {
  const e = fromServer({ id: 'a1b2c3d4e5f6', erledigt: sec('2026-12-01T23:30:00Z'), objektId: 17, person: 'Carla Dorn' })
  assert.equal(e.date, '2026-12-02', '0:30 Uhr Wien gehört zum 2.12.')
  assert.equal(e.objectId, '17', 'Kennung als Text')
  assert.equal(e.entered, e.at, 'ohne Eintragezeit: Erledigt-Zeit')
  assert.deepEqual([e.geraeumt, e.gestreut, e.kontrolle, e.test, e.mittel, e.fotos], [false, false, false, false, '', []])
  assert.equal(e.serverId, 'a1b2c3d4e5f6')
})

test('Protokoll vom Handy: Notiz auf 500 Zeichen gekürzt, nur bekannte Streumittel', () => {
  const e = fromServer({ id: 'x', erledigt: sec('2026-12-02T05:00:00Z'), notiz: 'Eis '.repeat(200), mittel: 'Splitt und Salz' })
  assert.equal(e.notiz.length, 500)
  assert.equal(e.mittel, 'Splitt und Salz')
  for (const m of STREUMITTEL) assert.equal(fromServer({ id: 'x', erledigt: 1, mittel: m }).mittel, m)
})

const photoNames = [
  ['ab12cd34ef56-1.jpg', true],
  ['ab12cd34ef56-4.webp', true],
  ['ab12cd34ef56-2.png', true],
  ['ab12cd34ef56-5.jpg', false],
  ['AB12CD34EF56-1.jpg', false],
  ['ab12cd34ef5-1.jpg', false],
  ['ab12cd34ef56-1.jpg.php', false],
  ['../ab12cd34ef56-1.jpg', false],
]
for (const [name, ok] of photoNames)
  test(`Protokoll vom Handy: Fotoname „${name}“ wird ${ok ? 'übernommen' : 'verworfen'}`, () => {
    assert.equal(fromServer({ id: 'x', erledigt: 1, fotos: [name] }).fotos.length, ok ? 1 : 0)
  })

test('Protokoll vom Handy: neue Einträge ohne leere, ohne Kennung, ohne Testalarm, ohne schon übernommene', () => {
  const log = { a: { serverId: 'old1' }, b: { id: 'app-eintrag' } }
  const list = newFromServer([null, { erledigt: 1 }, { id: 'old1', erledigt: 1 }, { id: 'neu1', erledigt: 1, test: true }, { id: 'neu2', erledigt: 1 }, { id: 'neu3', erledigt: 2 }], log)
  assert.deepEqual(list.map((e) => e.id), ['hneu2', 'hneu3'])
  assert.deepEqual(newFromServer(undefined, log), [])
})

const works = [
  [{ geraeumt: true, gestreut: true, mittel: 'Salz' }, 'geräumt, gestreut (Salz)'],
  [{ gestreut: true, kontrolle: true, mittel: 'Sand' }, 'gestreut (Sand)'],
  [{ geraeumt: true, kontrolle: true }, 'geräumt'],
  [{ kontrolle: true, mittel: 'Splitt' }, 'kontrolliert, nichts nötig'],
  [{}, ''],
]
for (const [e, text] of works) test(`Tätigkeit in Worten: „${text || '(leer)'}“`, () => assert.equal(workText(e), text))

test('Einträge eines Tags und Objekts, nach Uhrzeit', () => {
  const log = {
    a: { date: '2026-12-02', objectId: 'o1', at: '2026-12-02T05:10:00Z' },
    b: { date: '2026-12-02', objectId: 'o1', at: '2026-12-02T04:05:00Z' },
    c: { date: '2026-12-02', objectId: 'o2', at: '2026-12-02T03:00:00Z' },
    d: { date: '2026-12-03', objectId: 'o1', at: '2026-12-03T03:00:00Z' },
  }
  assert.deepEqual(entriesFor(log, '2026-12-02', 'o1').map((e) => e.at), ['2026-12-02T04:05:00Z', '2026-12-02T05:10:00Z'])
  assert.deepEqual(entriesFor(undefined, '2026-12-02', 'o1'), [])
})

test('Fehlendes Protokoll: eigene Frist und „fertig bis“ aus den Regeln, unbekannte Objekte ignoriert', () => {
  const objects = [{ id: 'o1', name: 'Zentrum', winter: { active: true, until: '05:00' } }, { id: 'o2', name: 'Arkaden', winter: { active: true } }]
  const winter = { '2026-12-02|o1': { reason: 'Schnee' }, '2026-12-02|o2': {}, '2026-12-02|o9': {}, '2026-12-01|o2': null }
  const at = (t) => viennaTime('2026-12-02', t)
  // Regeln: fertig bis 07:00; Frist 1 Stunde
  const rules = { winterUntil: '07:00' }
  assert.deepEqual(missingLogs({ winter, objects, now: at('05:59'), weatherRules: rules, graceH: 1 }), [])
  assert.deepEqual(missingLogs({ winter, objects, now: at('06:00'), weatherRules: rules, graceH: 1 }).map((m) => [m.object.id, m.until]), [['o1', '05:00']])
  assert.deepEqual(missingLogs({ winter, objects, now: at('08:00'), weatherRules: rules, graceH: 1 }).map((m) => [m.object.id, m.until]), [['o2', '07:00'], ['o1', '05:00']], 'Arkaden vor Zentrum (Name)')
})

test('Fehlendes Protokoll: Tage in der Reihenfolge, Eintrag am Tag reicht (auch nur „kontrolliert“)', () => {
  const objects = [{ id: 'o1', name: 'Zentrum', winter: { active: true } }]
  const winter = { '2026-12-03|o1': {}, '2026-12-01|o1': {}, '2026-12-02|o1': {} }
  const log = { x: { date: '2026-12-02', objectId: 'o1', at: '2026-12-02T05:00:00Z', kontrolle: true } }
  assert.deepEqual(missingLogs({ winter, objects, log, now: viennaTime('2026-12-04', '12:00') }).map((m) => m.date), ['2026-12-01', '2026-12-03'])
})

test('Protokoll-Zeilen: ohne Zeitraum alle, Name und Adresse aus dem Eintrag, wenn das Objekt fehlt', () => {
  const log = {
    a: { date: '2026-12-02', objectId: 'o1', object: 'Altes Objekt', address: 'Gasse 1', at: '2026-12-02T05:00:00Z' },
    b: { date: '2026-12-02', objectId: 'o2', at: '2026-12-02T05:00:00Z' },
    c: { date: '2026-11-20', objectId: 'o3', object: 'Hof', at: '2026-11-20T06:00:00Z' },
  }
  const rows = logRows(log)
  assert.deepEqual(rows.map((r) => [r.date, r.objectName, r.address, r.time]), [
    ['2026-11-20', 'Hof', '', '07:00'],
    ['2026-12-02', 'Altes Objekt', 'Gasse 1', '06:00'],
    ['2026-12-02', 'Objekt', '', '06:00'],
  ], 'gleiche Zeit: nach Objektname')
  assert.deepEqual(logRows(log, { from: '2026-12-01' }).length, 2)
  assert.deepEqual(logRows(log, { to: '2026-11-30' }).map((r) => r.objectName), ['Hof'])
})

test('Foto in SharePoint: Ordner je Monat, Name ohne Sonderzeichen und höchstens 40 Zeichen', () => {
  const e = { date: '2027-01-05', object: 'Haus „Am Bach“ – Süd' }
  assert.equal(photoPath(e, 'ab12cd34ef56-1.jpg'), 'exporte/Winterdienst/2027-01/2027-01-05_Haus-Am-Bach-Sud_ab12cd34ef56-1.jpg')
  assert.equal(photoPath(e, 'f.jpg', 'Wohnhausanlage Am Sonnenhang Stiege 1 bis 7 und Garagen'), 'exporte/Winterdienst/2027-01/2027-01-05_Wohnhausanlage-Am-Sonnenhang-Stiege-1-bi_f.jpg')
  assert.equal(photoPath({ date: '2027-01-05' }, 'f.jpg'), 'exporte/Winterdienst/2027-01/2027-01-05_Objekt_f.jpg')
})
