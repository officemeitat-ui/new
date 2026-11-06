// Qualitätsmessung (core/qualitaet.js): Stichprobe und Annahmezahl in Anlehnung an ISO 2859-1, Verteilung auf die
// Raumgruppen, Zufallsauswahl mit Startwert, Bewertung je Raum mit Gewicht, Kennzahl, erfüllt/nicht erfüllt,
// Nachkontrolle, Reklamationsgefahr, Verlauf je Monat, Raumgruppen aus dem Raumbuch der Objektdoku, Bericht (PDF).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allocate,
  attention,
  AQL_VALUES,
  buildRooms,
  DEFECT_DEFAULTS,
  drawSample,
  emptyQualitaet,
  evaluate,
  falling,
  findAkte,
  GROUP_DEFAULTS,
  groupsFromRaumbuch,
  groupsProblem,
  isoAcceptance,
  isUrgent,
  ITEM_DEFAULTS,
  itemsFor,
  levelOf,
  lotSize,
  measurementsOf,
  monthly,
  newMeasurement,
  objectStatus,
  objektdokuName,
  planFor,
  planProblem,
  QM_HINT,
  resultOf,
  roomLabel,
  roomResult,
  SAMPLE_DEFAULTS,
  seededRandom,
  settingsOf,
  templateFor,
} from '../src/core/qualitaet.js'
import { createQualitaetDemo } from '../src/data/demo-qualitaet.js'
import { qualitaetDocument, qualitaetPdfName } from '../src/export/qualitaet-pdf.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const TODAY = '2026-11-06'
const S = settingsOf(null)
const GROUPS = [
  { id: 'g1', name: 'Büro', template: 'buero', rooms: 18 },
  { id: 'g2', name: 'Sanitär', template: 'sanitaer', rooms: 6, names: ['WC Damen', 'WC Herren'] },
  { id: 'g3', name: 'Verkehrsflächen', template: 'verkehr', rooms: 4 },
  { id: 'g4', name: 'Teeküche', template: 'kueche', rooms: 2 },
]
const CONF = { objectId: 'o1', groups: GROUPS, aql: '', accept: '', target: '' }
const meas = (over = {}) => newMeasurement({ id: 'm1', conf: CONF, settings: S, date: '2026-11-02', seed: 4711, by: 'Petra', at: 'T', ...over })

/** Messung abschließen; defects: [[Raumindex, Prüfobjekt]] → Mangel. */
function done(m, defects = [], { date, id } = {}) {
  const x = structuredClone(m)
  if (date) x.date = date
  if (id) x.id = id
  for (const [ri, itemId] of defects) {
    const it = x.rooms[ri].items.find((i) => i.id === itemId)
    it.state = 'mangel'
    it.defects = ['staub']
  }
  for (const r of x.rooms) r.checked = true
  x.status = 'fertig'
  x.result = evaluate(x)
  return x
}

test('Vorgaben: Tabelle, Prüfobjekte, Fehlerarten, Raumgruppen; leere Datei wie in der Ablage; als Vorschlag gekennzeichnet', () => {
  assert.deepEqual(MODULE_DOCS.qualitaet.empty(), emptyQualitaet())
  assert.equal(MODULE_DOCS.qualitaet.path, 'qualitaet/qualitaet.json')
  assert.match(QM_HINT, /Vorschlag in Anlehnung an EN 13549, ohne Gewähr/)
  assert.deepEqual(SAMPLE_DEFAULTS.map((r) => r.n), [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200])
  assert.deepEqual(SAMPLE_DEFAULTS.map((r) => r.upTo).slice(0, 6), [8, 15, 25, 50, 90, 150])
  assert.ok(DEFECT_DEFAULTS.some((d) => d.name === 'Abfall nicht geleert') && DEFECT_DEFAULTS.some((d) => d.name === 'Staub'))
  for (const t of GROUP_DEFAULTS) for (const id of t.items) assert.ok(ITEM_DEFAULTS.some((x) => x.id === id), `${t.id}: ${id}`)
  assert.equal(ITEM_DEFAULTS.find((x) => x.id === 'sanitaer').weight, 3)
  assert.deepEqual(AQL_VALUES, [0.65, 1, 1.5, 2.5, 4, 6.5, 10])
  assert.deepEqual([S.aql, S.target, S.roomLimit, S.recheckDays, S.dropPoints], [4, 90, 1, 7, 5])
  // eigene Werte, unsinnige fallen auf die Vorgabe oder werden begrenzt
  const own = settingsOf({ settings: { aql: 2.5, target: 120, roomLimit: 0, recheckDays: '10', checkItems: [{ id: 'x', name: 'X', weight: 1 }], sample: [] } })
  assert.deepEqual([own.aql, own.target, own.roomLimit, own.recheckDays], [2.5, 100, 1, 10])
  assert.deepEqual(own.checkItems.map((x) => x.id), ['x'])
  assert.equal(own.sample, SAMPLE_DEFAULTS)
  assert.equal(settingsOf({ settings: { aql: 3 } }).aql, 4, 'AQL nicht in der Liste')
})

test('ISO 2859-1 Tabelle 2-A: Annahmezahlen und Pfeile (Normalprüfung, Einfach-Stichprobe)', () => {
  const ac = (n, aql) => {
    const r = isoAcceptance(n, aql)
    return r && `${r.letter} ${r.n}/${r.ac}`
  }
  // Werte ohne Pfeil
  assert.equal(ac(13, 4), 'E 13/1')
  assert.equal(ac(32, 2.5), 'G 32/2')
  assert.equal(ac(50, 4), 'H 50/5')
  assert.equal(ac(80, 2.5), 'J 80/5')
  assert.equal(ac(80, 4), 'J 80/7')
  assert.equal(ac(125, 2.5), 'K 125/7')
  assert.equal(ac(125, 4), 'K 125/10')
  assert.equal(ac(200, 6.5), 'L 200/21')
  assert.equal(ac(2, 6.5), 'A 2/0')
  // ↓ links der „0 1“-Diagonale: größere Stichprobe
  assert.equal(ac(8, 4), 'E 13/1')
  assert.equal(ac(2, 0.65), 'F 20/0')
  assert.equal(ac(20, 1.5), 'G 32/1')
  // ↑ direkt rechts davon: kleinere Stichprobe mit 0 Fehlern
  assert.equal(ac(5, 4), 'B 3/0')
  assert.equal(ac(20, 1), 'E 13/0')
  assert.equal(ac(32, 0.65), 'F 20/0')
  // ↑ über 21/22 hinaus
  assert.equal(ac(200, 10), 'K 125/21')
  // Annahme: in der ersten Zeile gibt es kein ↑ (A, AQL 10 → Plan darunter)
  assert.equal(ac(2, 10), 'C 5/1')
  assert.equal(isoAcceptance(7, 4), null, 'Umfang nicht in der Tabelle')
  assert.equal(isoAcceptance(13, 3), null, 'AQL nicht in der Tabelle')
  // jede Kombination der Vorgaben hat einen Plan, Rückweisezahl = Annahmezahl + 1
  for (const row of SAMPLE_DEFAULTS)
    for (const a of AQL_VALUES) {
      const r = isoAcceptance(row.n, a)
      assert.ok(r && r.re === r.ac + 1 && r.ac >= 0, `${row.n} / ${a}`)
    }
})

test('Plan je Losgröße: Stichprobe, Annahmezahl, alle Räume bei kleinem Los, feste Zahl, eigene Tabelle', () => {
  const p30 = planFor(30, { aql: 4 })
  assert.deepEqual([p30.lot, p30.table, p30.n, p30.ac, p30.re, p30.letter, p30.full], [30, 8, 13, 1, 2, 'E', false])
  assert.deepEqual([planFor(90, { aql: 4 }).n, planFor(90, { aql: 4 }).ac], [13, 1])
  assert.deepEqual([planFor(200, { aql: 4 }).n, planFor(200, { aql: 4 }).ac], [32, 3])
  assert.deepEqual([planFor(16, { aql: 4 }).n, planFor(16, { aql: 4 }).ac], [3, 0])
  assert.deepEqual([planFor(16, { aql: 6.5 }).n, planFor(16, { aql: 6.5 }).ac], [8, 1])
  const tiny = planFor(1, { aql: 4 })
  assert.deepEqual([tiny.n, tiny.full], [1, true])
  const small = planFor(5, { aql: 0.65 })
  assert.deepEqual([small.n, small.full, small.ac], [5, true, 0], 'Stichprobe größer als das Los: alle Räume')
  assert.equal(planFor(0), null)
  const fixed = planFor(30, { aql: 4, accept: 2 })
  assert.deepEqual([fixed.n, fixed.ac, fixed.re, fixed.aql, fixed.accept], [8, 2, 3, null, 2])
  const custom = planFor(30, { aql: 4, sample: [{ upTo: 20, n: 4 }, { upTo: 100, n: 10 }] })
  assert.deepEqual([custom.n, custom.ac, custom.needsAccept], [10, null, true], 'eigener Umfang ohne ISO-Wert: Annahmezahl festlegen')
  assert.equal(planFor(500, { aql: 4, sample: [{ upTo: 20, n: 4 }, { upTo: 100, n: 10 }] }).table, 10, 'größer als die Tabelle: letzte Zeile')
  assert.equal(lotSize(GROUPS), 30)
  assert.equal(lotSize(GROUPS, ['g2', 'g4']), 8)
})

test('Verteilung auf die Raumgruppen: anteilig, mindestens ein Raum je Gruppe, Summe stimmt', () => {
  assert.deepEqual(allocate(GROUPS, 13), { g1: 8, g2: 2, g3: 2, g4: 1 })
  assert.deepEqual(allocate(GROUPS, 3), { g1: 1, g2: 1, g3: 1, g4: 0 }, 'weniger Räume als Gruppen: die größten')
  assert.deepEqual(allocate(GROUPS, 30), { g1: 18, g2: 6, g3: 4, g4: 2 })
  assert.deepEqual(allocate(GROUPS, 99), { g1: 18, g2: 6, g3: 4, g4: 2 }, 'nie mehr als das Los')
  assert.deepEqual(allocate([{ id: 'a', rooms: 1 }, { id: 'b', rooms: 100 }], 5), { a: 1, b: 4 })
  assert.deepEqual(allocate([{ id: 'a', rooms: 0 }, { id: 'b', rooms: 3 }], 2), { b: 2 })
  for (let n = 1; n <= 30; n++) {
    const a = allocate(GROUPS, n)
    assert.equal(Object.values(a).reduce((s, x) => s + x, 0), n, `Summe bei ${n}`)
    for (const g of GROUPS) assert.ok(a[g.id] <= g.rooms)
    if (n >= 4) assert.ok(GROUPS.every((g) => a[g.id] >= 1), `jede Gruppe bei ${n}`)
  }
})

test('Zufallsauswahl mit Startwert: gleicher Startwert, gleiche Räume; keine doppelt; geordnet', () => {
  const a = drawSample({ groups: GROUPS, n: 13, seed: 4711 })
  assert.deepEqual(a, drawSample({ groups: GROUPS, n: 13, seed: 4711 }))
  assert.notDeepEqual(a, drawSample({ groups: GROUPS, n: 13, seed: 4712 }))
  assert.equal(a.length, 13)
  assert.equal(new Set(a.map((p) => `${p.groupId}#${p.no}`)).size, 13)
  for (const p of a) assert.ok(p.no >= 1 && p.no <= GROUPS.find((g) => g.id === p.groupId).rooms)
  assert.deepEqual([...new Set(a.map((p) => p.groupId))], ['g1', 'g2', 'g3', 'g4'])
  for (const g of GROUPS) {
    const nos = a.filter((p) => p.groupId === g.id).map((p) => p.no)
    assert.deepEqual(nos, [...nos].sort((x, y) => x - y))
  }
  const r1 = seededRandom(1)
  const r2 = seededRandom(1)
  for (let i = 0; i < 5; i++) {
    const x = r1()
    assert.ok(x >= 0 && x < 1)
    assert.equal(x, r2())
  }
  // über viele Startwerte kommt jeder Raum einmal dran
  const seen = new Set()
  for (let s = 1; s < 200; s++) for (const p of drawSample({ groups: GROUPS, n: 13, seed: s })) seen.add(`${p.groupId}#${p.no}`)
  assert.equal(seen.size, 30)
})

test('Neue Messung: Räume mit Prüfobjekten der Raumgruppe, Namen aus dem Raumbuch, von Hand geändert', () => {
  const m = meas()
  assert.equal(m.status, 'laufend')
  assert.equal(m.rooms.length, 13)
  assert.deepEqual([m.lot, m.plan.n, m.plan.ac, m.target, m.roomLimit, m.manual], [30, 13, 1, 90, 1, false])
  const wc = m.rooms.find((r) => r.groupId === 'g2')
  assert.deepEqual(wc.items.map((x) => x.id), ['boden', 'sanitaer', 'glas', 'fliesen', 'verbrauch', 'abfall'])
  assert.ok(wc.items.every((x) => x.state === 'ok' && !x.photo && x.defects.length === 0))
  assert.equal(roomLabel(GROUPS[1], 1), 'WC Damen')
  assert.equal(roomLabel(GROUPS[1], 5), 'Sanitär 5')
  assert.equal(itemsFor({ template: 'gibt-es-nicht' }, S).map((x) => x.id).join(), 'boden,oberflaechen,kontakt,abfall')
  // nur zwei Raumgruppen: kleineres Los
  const part = meas({ groupIds: ['g2', 'g4'] })
  assert.deepEqual([part.lot, part.rooms.length, part.plan.ac], [8, 3, 0])
  // von Hand: ein Raum getauscht
  const picks = drawSample({ groups: GROUPS, n: 13, seed: 4711 }).map((p, i) => (i === 0 ? { ...p, no: p.no === 1 ? 2 : 1 } : p))
  const manual = meas({ picks: picks.some((p, i) => i > 0 && p.groupId === picks[0].groupId && p.no === picks[0].no) ? picks.slice(1) : picks })
  assert.ok(manual.manual)
  assert.equal(buildRooms([{ groupId: 'x', no: 1 }], GROUPS, S).length, 0)
  // Plan prüfen
  const plan = planFor(30, { aql: 4 })
  assert.equal(planProblem({ conf: null }), 'Bitte das Objekt wählen.')
  assert.match(planProblem({ conf: CONF, date: '2026-11-07', today: TODAY, picks: [{ groupId: 'g1', no: 1 }], plan }), /Zukunft/)
  assert.match(planProblem({ conf: CONF, date: TODAY, today: TODAY, picks: [], plan }), /leer/)
  assert.match(planProblem({ conf: CONF, date: TODAY, today: TODAY, picks: [{ groupId: 'g1', no: 1 }, { groupId: 'g1', no: 1 }], plan }), /doppelt/)
  assert.equal(planProblem({ conf: CONF, date: TODAY, today: TODAY, picks: [{ groupId: 'g1', no: 1 }], plan }), '')
  assert.match(planProblem({ conf: { groups: [] }, date: TODAY, today: TODAY }), /keine Raumgruppen/)
})

test('Bewertung: Fehlerpunkte mit Gewicht, „entfällt“ zählt nicht, Raum nicht in Ordnung ab Grenze', () => {
  const room = { items: [{ id: 'boden', weight: 2, state: 'mangel' }, { id: 'glas', weight: 1, state: 'ok' }, { id: 'abfall', weight: 2, state: 'na' }] }
  assert.deepEqual(roomResult(room), { points: 2, max: 3, defects: 1, rated: true, ok: false })
  assert.equal(roomResult(room, 3).ok, true, 'Grenze 3 Punkte: ein Mangel mit Gewicht 2 ist noch in Ordnung')
  assert.equal(roomResult({ items: [{ weight: 2, state: 'na' }] }).rated, false)
  // Messung: 13 Räume, Summe der Gewichte 100
  const m = meas()
  const clean = done(m)
  assert.deepEqual([clean.result.score, clean.result.bad, clean.result.ok, clean.result.poor, clean.result.max], [100, 0, true, false, 100])
  const one = done(m, [[0, 'boden']])
  assert.deepEqual([one.result.score, one.result.bad, one.result.ok, one.result.poor, one.result.itemsOk, one.result.items], [98, 1, true, false, 66, 67])
  const two = done(m, [[0, 'boden'], [1, 'oberflaechen']])
  assert.deepEqual([two.result.score, two.result.bad, two.result.ok, two.result.poor], [97, 2, false, true], 'zwei Räume nicht in Ordnung bei Ac 1')
  // zwei Mängel im selben Raum: ein Raum
  const same = done(m, [[0, 'boden'], [0, 'abfall'], [0, 'glas']])
  assert.deepEqual([same.result.score, same.result.bad, same.result.ok], [95, 1, true])
  // Zielwert: erfüllt, aber Kennzahl darunter ist schlecht
  const low = done({ ...m, target: 99 }, [[0, 'boden']])
  assert.deepEqual([low.result.ok, low.result.poor], [true, true])
  // ohne Annahmezahl keine Entscheidung
  assert.equal(evaluate({ ...m, plan: { ...m.plan, ac: null } }).ok, null)
  // Ergebnis einer abgeschlossenen Messung bleibt wie festgehalten
  assert.equal(resultOf({ ...one, roomLimit: 5 }).bad, 1)
  assert.equal(resultOf({ ...meas(), roomLimit: 5 }).bad, 0)
})

test('Nachkontrolle, zwei schlechte in Folge, fallender Verlauf, Handlungsbedarf je Objekt', () => {
  const m = meas()
  const good = (date, id, defects = []) => done(m, defects, { date, id })
  const bad = (date, id) => done(m, [[0, 'boden'], [1, 'boden'], [2, 'abfall']], { date, id })
  const doc = { settings: {}, objects: [CONF], measurements: [good('2026-08-01', 'a'), good('2026-09-01', 'b'), bad('2026-10-30', 'c')] }
  let st = objectStatus({ doc, objectId: 'o1', today: TODAY })
  assert.deepEqual(st.recheck, { of: 'c', due: '2026-11-06', overdue: false })
  assert.deepEqual([st.twoBad, st.falling, st.risk], [false, false, false])
  st = objectStatus({ doc, objectId: 'o1', today: '2026-11-07' })
  assert.ok(st.recheck.overdue)
  // Nachkontrolle gut: erledigt
  doc.measurements.push(good('2026-11-05', 'd'))
  assert.equal(objectStatus({ doc, objectId: 'o1', today: TODAY }).recheck, null)
  // Nachkontrolle wieder schlecht: zwei in Folge
  doc.measurements.splice(3, 1, bad('2026-11-05', 'd'))
  st = objectStatus({ doc, objectId: 'o1', today: TODAY })
  assert.ok(st.twoBad && st.risk && st.recheck.due === '2026-11-12')
  // laufende Messungen zählen nicht
  doc.measurements.push({ ...meas(), id: 'e', date: '2026-11-06' })
  assert.equal(measurementsOf(doc, 'o1').length, 4)
  // fallend: jeweils weniger und zusammen mindestens 5 Punkte
  assert.ok(falling([99, 96, 93]))
  assert.ok(!falling([99, 97, 96]), 'nur 3 Punkte')
  assert.ok(!falling([93, 96, 90]), 'nicht jedes Mal weniger')
  assert.ok(!falling([96, 90]), 'zu wenige')
  assert.ok(falling([99, 97, 96], 3))
  const fall = { settings: {}, objects: [CONF], measurements: [good('2026-08-01', 'f1'), good('2026-09-01', 'f2', [[0, 'boden'], [0, 'abfall']]), good('2026-10-01', 'f3', [[0, 'boden'], [0, 'abfall'], [0, 'glas'], [0, 'oberflaechen']])] }
  st = objectStatus({ doc: fall, objectId: 'o1', today: TODAY })
  assert.deepEqual([st.result.ok, st.result.score, st.falling, st.risk, st.recheck], [true, 94, true, true, null], 'erfüllt, aber fallend: Reklamationsgefahr ohne Nachkontrolle')
  // Handlungsbedarf: dringend zuerst, inaktive Objekte nicht
  const objects = [{ id: 'o1', name: 'Zentrale' }, { id: 'o2', name: 'Archiv' }, { id: 'o3', name: 'Altbau', inactive: true }]
  const both = { settings: {}, objects: [CONF], measurements: [...doc.measurements, { ...bad('2026-11-04', 'x'), objectId: 'o2' }, { ...bad('2026-11-04', 'y'), objectId: 'o3' }, { ...good('2026-11-04', 'z'), objectId: 'o4' }] }
  const list = attention({ doc: both, objects, today: TODAY })
  assert.deepEqual(list.map((g) => g.objectId), ['o1', 'o2'])
  assert.ok(isUrgent(list[0]) && !isUrgent(list[1]))
  assert.ok(isUrgent({ risk: false, recheck: { overdue: true } }))
})

test('Verlauf je Monat: zwölf Monate, Mittel der Messungen, leere Monate ohne Wert', () => {
  const m = meas()
  const list = [done(m, [], { date: '2026-09-10' }), done(m, [[0, 'boden']], { date: '2026-11-02' }), done(m, [[0, 'boden'], [1, 'boden']], { date: '2026-11-04' }), done(m, [], { date: '2025-10-01' })]
  const months = monthly(list, { today: TODAY })
  assert.equal(months.length, 12)
  assert.deepEqual([months[0].key, months.at(-1).key], ['2025-12', '2026-11'])
  assert.deepEqual(months.at(-1), { key: '2026-11', count: 2, score: 97 })
  assert.deepEqual(months.at(-3), { key: '2026-09', count: 1, score: 100 })
  assert.equal(months.at(-2).score, null)
  assert.equal(monthly([], { today: '2026-01-15', months: 3 })[0].key, '2025-11')
})

test('Raumbuch der Objektdoku: Räume je Bereich werden Raumgruppen; Akte zum Objekt finden', () => {
  const akte = {
    objekt: 'Versicherungsbüro Lehen',
    bereiche: [
      { name: 'Erdgeschoß', raeume: [{ nr: 'EG-01', name: 'Büro Leitung' }, { nr: 'EG-02', name: 'Besprechung' }, { nr: 'EG-03', name: 'WC Damen' }, { nr: 'EG-04', name: 'WC Herren' }, { nr: 'EG-05', name: 'Gang' }, { nr: 'EG-06', name: 'Teeküche' }] },
      { name: 'Keller', raeume: [{ nr: 'K-01', name: 'Archiv' }, { nr: 'K-02', name: 'Lager' }, { nr: '', name: '' }] },
      { name: 'Stiegenhaus', raeume: [{ nr: 'ST', name: 'Podest 1. OG' }] },
      { name: 'Ohne Räume', raeume: [] },
    ],
  }
  const groups = groupsFromRaumbuch(akte)
  assert.deepEqual(
    groups.map((g) => [g.name, g.template, g.rooms]),
    [
      ['Büro', 'buero', 2],
      ['Sanitär', 'sanitaer', 2],
      ['Verkehrsflächen', 'verkehr', 2],
      ['Küche', 'kueche', 1],
      ['Keller', 'sonstige', 2],
    ],
  )
  assert.deepEqual(groups[0].names, ['EG-01 Büro Leitung', 'EG-02 Besprechung'])
  assert.deepEqual(groups[2].names, ['EG-05 Gang', 'ST Podest 1. OG'], 'Raum ohne Schlagwort: nach dem Bereich')
  assert.deepEqual(groupsFromRaumbuch({ bereiche: [{ name: 'Büros' }] }), [])
  assert.deepEqual(groupsFromRaumbuch(null), [])
  assert.deepEqual(['Damen-WC', 'Umkleide Herren', 'Kaffeeküche', 'Stiege 2', 'Foyer', 'Sekretariat', 'Lager'].map(templateFor), ['sanitaer', 'sanitaer', 'kueche', 'verkehr', 'verkehr', 'buero', ''])
  assert.equal(objektdokuName('Versicherungsbüro Lehen'), 'Versicherungsbuero-Lehen')
  assert.equal(objektdokuName('Büro & Container Gnigl'), 'Buero-Container-Gnigl')
  const files = [
    { path: 'Objektdoku/7_Versicherungsbuero-Lehen/7.json' },
    { path: 'Objektdoku/Revier Salzburg-Stadt/7_Versicherungsbuero-Lehen/7.json' },
    { path: 'Objektdoku/Revier Salzburg-Stadt/7_Versicherungsbuero-Lehen/Objektblatt.pdf' },
    { path: 'Objektdoku/Revier Salzburg-Stadt/8_Lehen/8.json' },
    { path: 'Objektdoku/Revier Flachgau/9_Buerogebaeude-Hallwang/9.json' },
  ]
  assert.deepEqual(findAkte(files, 'Versicherungsbüro Lehen'), ['Objektdoku/Revier Salzburg-Stadt/7_Versicherungsbuero-Lehen/7.json', 'Objektdoku/7_Versicherungsbuero-Lehen/7.json'])
  assert.deepEqual(findAkte(files, 'Lehen'), ['Objektdoku/Revier Salzburg-Stadt/8_Lehen/8.json'])
  assert.deepEqual(findAkte(files, ''), [])
})

test('Raumgruppen prüfen und Qualitätsniveau je Objekt', () => {
  assert.match(groupsProblem([]), /mindestens eine/)
  assert.match(groupsProblem([{ name: '', rooms: 2 }]), /Namen/)
  assert.match(groupsProblem([{ name: 'Büro', rooms: 0 }]), /ganze Zahl/)
  assert.match(groupsProblem([{ name: 'Büro', rooms: 2.5 }]), /ganze Zahl/)
  assert.match(groupsProblem([{ name: 'Büro', rooms: 2 }, { name: 'büro ', rooms: 1 }]), /gleich/)
  assert.equal(groupsProblem(GROUPS), '')
  assert.deepEqual(levelOf(CONF, S), { aql: 4, accept: null, target: 90 })
  assert.deepEqual(levelOf({ aql: 6.5, accept: 2, target: 95 }, S), { aql: 6.5, accept: 2, target: 95 })
  assert.deepEqual(levelOf({ aql: 7, accept: -1, target: '' }, S), { aql: 4, accept: null, target: 90 })
  assert.equal(levelOf({ accept: 0 }, S).accept, 0, 'null Räume nicht in Ordnung ist eine gültige Vereinbarung')
})

test('Beispieldaten: Reklamationsgefahr (zwei schlecht, fallend) und überfällige Nachkontrolle', () => {
  const doc = createQualitaetDemo(TODAY)
  assert.ok(doc.measurements.every((m) => m.status === 'fertig' && m.result && m.rooms.every((r) => r.checked)))
  const objects = ['o1', 'o11', 'o13', 'o90'].map((id) => ({ id, name: id }))
  const list = attention({ doc, objects, today: TODAY })
  assert.deepEqual(list.map((g) => [g.objectId, g.twoBad, g.falling, !!g.recheck?.overdue]), [['o11', true, true, false], ['o13', false, false, true]])
  assert.ok(measurementsOf(doc, 'o1').every((m) => m.result.ok))
  assert.equal(measurementsOf(doc, 'o90').length, 0)
  assert.equal(measurementsOf(doc, 'o11').at(-1).recheckOf, measurementsOf(doc, 'o11').at(-2).id)
})

test('Bericht (PDF): Ergebnis, Kennzahl, Räume mit Mängeln, Verlauf, Unterschrift, Fotos nur ladbare', () => {
  const m = done(meas(), [[0, 'boden'], [1, 'oberflaechen']])
  m.rooms[0].items[0].note = 'Kaffeeflecken'
  m.rooms[0].items[0].photo = { path: 'qualitaet/nachweise/2026/x.jpg' }
  m.rooms[1].items[1].photo = { path: 'qualitaet/nachweise/2026/y.jpg' }
  m.signature = { name: 'Frau Muster', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1L9 9"/></svg>' }
  const history = [done(meas(), [], { date: '2026-10-01', id: 'h1' })]
  const pdf = qualitaetDocument({ m, object: { name: 'Versicherungsbüro Lehen', address: 'Lehen' }, history, defectNames: { staub: 'Staub' }, photos: new Map([['qualitaet/nachweise/2026/x.jpg', 'data:image/jpeg;base64,AAAA']]), brand: { name: 'Cleanos' } })
  const text = JSON.stringify(pdf.content)
  assert.match(text, /Qualitätsmessung/)
  assert.match(text, /nicht erfüllt/)
  assert.match(text, /97,0 %/)
  assert.match(text, /Zielwert 90,0 %/)
  assert.match(text, /2 von 13/)
  assert.match(text, /Boden: Staub, Kaffeeflecken/)
  assert.match(text, /AQL 4/)
  assert.match(text, /Verlauf der letzten Messungen/)
  assert.match(text, /Kunde: Frau Muster/)
  assert.match(text, /in Anlehnung an EN 13549/)
  assert.equal((text.match(/data:image\/jpeg/g) || []).length, 1, 'nur das ladbare Foto')
  assert.equal(qualitaetPdfName('Versicherungsbüro Lehen', '2026-11-02'), 'Qualitaetsmessung_Versicherungsbüro-Lehen_2026-11-02.pdf')
  // ohne Verlauf und Fotos keine leeren Abschnitte
  const plain = JSON.stringify(qualitaetDocument({ m: done(meas()), object: { name: 'X' } }).content)
  assert.ok(!/Verlauf der letzten Messungen/.test(plain) && !/Fotos der Mängel/.test(plain) && /erfüllt/.test(plain))
})
