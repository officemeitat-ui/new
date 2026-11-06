// Arbeitsschutz (core/arbeitsschutz.js, core/arbeitsschutz-vorlagen.js, export/arbeitsschutz-pdf.js): Arbeitsstoffe aus
// den Material-Artikeln, Sicherheitsdatenblatt, Objekte und Bestand, noch nicht unterwiesene Personen, Evaluierung mit
// Bewertung, Maßnahmen und Überprüfung, Handlungsbedarf, Vorlagen, Betriebsanweisung, PDFs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allMeasures,
  attention,
  badCodes,
  codesOf,
  DEFAULTS,
  emptyArbeitsschutz,
  evalProblem,
  evalRows,
  GHS,
  GHS_IDS,
  hasDetails,
  instructionFor,
  instructionProblem,
  isOpenMeasure,
  isStoff,
  isUrgent,
  measureState,
  peopleAt,
  reviewOf,
  riskClass,
  riskOf,
  sdbState,
  setMeasureStatus,
  settingsOf,
  stoffCounts,
  stoffRows,
  stockOfArticle,
  trainingGaps,
  trainState,
  usedObjects,
} from '../src/core/arbeitsschutz.js'
import { BA_SECTIONS, EVAL_TEMPLATES, hazardsFromTemplate, instructionFromArticle, templateOf } from '../src/core/arbeitsschutz-vorlagen.js'
import { instructionDocument, instructionPdfName, sdbText, sgdDocument, verzeichnisDocument, verzeichnisPdfName } from '../src/export/arbeitsschutz-pdf.js'
import { ghsSvg } from '../src/export/ghs.js'
import { createDemoData } from '../src/data/demo.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const TODAY = '2026-11-06'
const art = (id, over = {}) => ({ id, name: `Artikel ${id}`, category: 'Reinigungsmittel', unit: 'Fl.', active: true, ...over })
let n = 0
const newId = () => `x${++n}`

test('Leere Datei wie in der Ablage, Einstellungen mit Vorgaben', () => {
  assert.deepEqual(MODULE_DOCS.arbeitsschutz.empty(), emptyArbeitsschutz())
  assert.equal(MODULE_DOCS.arbeitsschutz.path, 'arbeitsschutz/arbeitsschutz.json')
  assert.deepEqual(settingsOf(null), DEFAULTS)
  assert.deepEqual(settingsOf({ settings: { sdbYears: 5, reviewMonths: 0, trainingTypeId: '' } }), { ...DEFAULTS, sdbYears: 5, trainingTypeId: '' })
  assert.deepEqual(GHS_IDS, ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'])
  assert.equal(GHS.find((g) => g.id === 'GHS05').name, 'Ätzwirkung')
})

test('Arbeitsstoff: Reinigungsmittel und Desinfektion von selbst, eigene Angabe geht vor, inaktive nie', () => {
  assert.equal(isStoff(art('a')), true)
  assert.equal(isStoff(art('a', { category: 'Desinfektion' })), true)
  assert.equal(isStoff(art('a', { category: 'Müllsäcke' })), false)
  assert.equal(isStoff(art('a', { category: 'Müllsäcke', haz: { on: true } })), true)
  assert.equal(isStoff(art('a', { haz: { on: false } })), false)
  assert.equal(isStoff(art('a', { active: false })), false)
  // ältere Artikel ohne haz: gültig, nur ohne Angaben
  assert.equal(hasDetails(art('a')), false)
  assert.equal(hasDetails(art('a', { haz: { ghs: ['GHS07'] } })), true)
  assert.equal(hasDetails(art('a', { haz: { on: true } })), false)
})

test('H- und P-Sätze: Kürzel als Liste, ungültige erkannt', () => {
  assert.deepEqual(codesOf('h290, H314;  h314 euh208'), ['H290', 'H314', 'EUH208'])
  assert.deepEqual(badCodes('H290, H314, EUH208, H360FD', 'h'), [])
  assert.deepEqual(badCodes('H31, Hxyz, P280', 'h'), ['H31', 'HXYZ', 'P280'])
  assert.deepEqual(badCodes('P280, P305+P351+P338', 'p'), [])
  assert.deepEqual(badCodes('P28, H314', 'p'), ['P28', 'H314'])
})

test('Sicherheitsdatenblatt: fehlt, Fassung unbekannt, aktuell, veraltet nach Jahren (Link am Artikel zählt)', () => {
  assert.equal(sdbState(art('a'), TODAY).state, 'fehlt')
  assert.equal(sdbState(art('a', { sds: 'kein-link' }), TODAY).state, 'fehlt')
  const link = art('a', { sds: 'https://example.com/sdb.pdf' })
  assert.equal(sdbState(link, TODAY).state, 'ohne-datum')
  const file = { path: 'arbeitsschutz/dokumente/sdb/a.pdf', name: 'a.pdf' }
  assert.equal(sdbState(art('a', { haz: { sdb: file, sdbDate: '2024-01-10' } }), TODAY).state, 'ok')
  const old = sdbState(art('a', { haz: { sdb: file, sdbDate: '2023-11-05' } }), TODAY)
  assert.deepEqual([old.state, old.due], ['veraltet', '2026-11-05'])
  assert.equal(sdbState(art('a', { haz: { sdb: file, sdbDate: '2023-11-06' } }), TODAY).state, 'ok', 'genau 3 Jahre: noch aktuell')
  assert.equal(sdbState(art('a', { sds: 'https://x.example/s.pdf', haz: { sdbDate: '2025-06-01' } }), TODAY, 1).state, 'veraltet')
})

test('Objekte aus Ausgaben der letzten 12 Monate (ohne Storno) plus eigene Zuordnung, Bestand je Lager', () => {
  const a = art('a', { haz: { objectIds: ['o9'] } })
  const material = {
    locations: [{ id: 'lager', name: 'Hauptlager' }, { id: 'bus', name: 'Bus' }],
    moves: [
      { id: 'm1', articleId: 'a', kind: 'korrektur', loc: 'lager', qty: 10, date: '2026-01-01' },
      { id: 'm2', articleId: 'a', kind: 'ausgabe', loc: 'lager', qty: -2, objectId: 'o1', date: '2026-10-01' },
      { id: 'm3', articleId: 'a', kind: 'ausgabe', loc: 'lager', qty: -1, objectId: 'o2', date: '2025-10-01' },
      { id: 'm4', articleId: 'a', kind: 'ausgabe', loc: 'lager', qty: -1, objectId: 'o3', date: '2026-09-01', cancelledBy: 'm5' },
      { id: 'm5', articleId: 'a', kind: 'ausgabe', loc: 'lager', qty: 1, objectId: 'o3', date: '2026-09-02', cancels: 'm4' },
      { id: 'm6', articleId: 'a', kind: 'umbuchung', loc: 'lager', qty: -3, date: '2026-09-03' },
      { id: 'm7', articleId: 'a', kind: 'umbuchung', loc: 'bus', qty: 3, date: '2026-09-03' },
      { id: 'm8', articleId: 'b', kind: 'ausgabe', loc: 'lager', qty: -1, objectId: 'o4', date: '2026-10-01' },
    ],
  }
  assert.deepEqual(usedObjects(material, a, TODAY).sort(), ['o1', 'o9'])
  assert.deepEqual(stockOfArticle(material, 'a'), { list: [{ loc: 'lager', name: 'Hauptlager', qty: 4 }, { loc: 'bus', name: 'Bus', qty: 3 }], total: 7 })
})

test('Verzeichnis: Zeilen mit Produktname, Handlungsbedarf, Betriebsanweisung; Zahlen für die Kacheln', () => {
  const material = {
    articles: [
      art('a1', { name: 'Allzweck', haz: { product: 'Zeta Allzweck', maker: 'Beispiel GmbH', ghs: ['GHS07'], sdb: { path: 'p' }, sdbDate: '2025-01-01' } }),
      art('a2', { name: 'Alpha Glas' }),
      art('a3', { name: 'Müllsack', category: 'Müllsäcke' }),
      art('a4', { name: 'Beta Sanitär', haz: { ghs: ['GHS05'], sdbDate: '2020-01-01' }, sds: 'https://example.com/b.pdf' }),
    ],
    moves: [],
  }
  const doc = { instructions: [{ id: 'b1', kind: 'stoff', articleId: 'a4', title: 'Beta', changedAt: '2026-01-01' }, { id: 'b2', kind: 'stoff', articleId: 'a4', title: 'Beta neu', changedAt: '2026-05-01' }], evaluations: [] }
  const rows = stoffRows({ material, doc, today: TODAY })
  assert.deepEqual(rows.map((r) => [r.product, r.sdb.state, r.needs, r.instruction?.id || '']), [
    ['Alpha Glas', 'fehlt', true, ''],
    ['Beta Sanitär', 'veraltet', true, 'b2'],
    ['Zeta Allzweck', 'ok', false, ''],
  ])
  assert.equal(instructionFor(doc, 'a4').title, 'Beta neu')
  assert.deepEqual(stoffCounts(rows), { stoffe: 3, sdb: 2, angaben: 1, ohneBa: 2 })
})

test('Personen im Objekt: Stammkräfte und Eingeschulte, ohne Ausgetretene; Stand der Unterweisung', () => {
  const employees = [
    { id: 'e1', name: 'Bea', trained: ['o1'] },
    { id: 'e2', name: 'Anna', trained: [] },
    { id: 'e3', name: 'Cem', trained: ['o1'], exitDate: '2026-10-31' },
    { id: 'e4', name: 'Dora', trained: ['o2'] },
  ]
  const tasks = [{ id: 't1', objectId: 'o1', regulars: ['e2'] }]
  assert.deepEqual(peopleAt({ objectIds: ['o1'], tasks, employees, today: TODAY }).map((e) => e.id), ['e2', 'e1'])
  const type = { id: 'chemie', months: 12 }
  const trainings = { types: [], records: [{ id: 'r1', empId: 'e1', typeId: 'chemie', date: '2026-02-01' }, { id: 'r2', empId: 'e2', typeId: 'chemie', date: '2025-01-10' }] }
  assert.equal(trainState(trainings, type, 'e1', TODAY).state, 'ok')
  assert.deepEqual(trainState(trainings, type, 'e2', TODAY), { state: 'abgelaufen', record: trainings.records[1], until: '2026-01-10' })
  assert.equal(trainState(trainings, type, 'e4', TODAY).state, 'fehlt')
})

test('Noch nicht unterwiesen: je Objekt (Ausgaben) und direkt ausgegeben; ohne Unterweisungen kein falscher Alarm', () => {
  const employees = [{ id: 'e1', name: 'Bea', trained: ['o1'] }, { id: 'e2', name: 'Anna' }, { id: 'e3', name: 'Cem' }]
  const tasks = [{ id: 't1', objectId: 'o1', regulars: ['e2'] }]
  const article = art('a')
  const material = { moves: [{ id: 'm1', articleId: 'a', kind: 'ausgabe', qty: -1, objectId: 'o1', date: '2026-10-01' }, { id: 'm2', articleId: 'a', kind: 'ausgabe', qty: -1, employeeId: 'e3', date: '2026-10-02' }] }
  const trainings = { types: [], records: [{ id: 'r1', empId: 'e1', typeId: 'chemie', date: '2026-02-01' }] }
  const g = trainingGaps({ article, material, tasks, employees, trainings, typeId: 'chemie', today: TODAY })
  assert.equal(g.type.name, 'Unterweisung Reinigungsmittel')
  assert.deepEqual(g.groups.map((x) => [x.objectId, x.people.map((p) => `${p.emp.id}:${p.state}`)]), [['o1', ['e2:fehlt', 'e1:ok']], ['', ['e3:fehlt']]])
  assert.deepEqual(g.missing.map((e) => e.id).sort(), ['e2', 'e3'])
  assert.deepEqual(g.objects, ['o1'])
  const blind = trainingGaps({ article, material, tasks, employees, trainings: null, typeId: 'chemie', today: TODAY })
  assert.equal(blind.type, null)
  assert.deepEqual(blind.missing, [])
  assert.equal(trainingGaps({ article, material, tasks, employees, trainings, typeId: 'gibtsnicht', today: TODAY }).type, null)
})

test('Bewertung 3 × 3: Risiko und Stufe, nicht bewertet = 0', () => {
  assert.equal(riskOf({ likelihood: 2, severity: 3 }), 6)
  assert.equal(riskOf({ likelihood: 0, severity: 3 }), 0)
  assert.deepEqual([1, 2, 3, 4, 6, 9, 0].map(riskClass), ['gering', 'gering', 'mittel', 'mittel', 'hoch', 'hoch', ''])
})

test('Maßnahmen: Zustand mit Frist, Wirksamkeit, Status setzen mit Datum', () => {
  assert.equal(measureState({ status: 'offen', due: '2026-11-05' }, TODAY), 'ueberfaellig')
  assert.equal(measureState({ status: 'offen', due: TODAY }, TODAY), 'offen')
  assert.equal(measureState({ status: 'offen', due: '' }, TODAY), 'ohne-frist')
  assert.equal(measureState({ status: 'umgesetzt', due: '2026-01-01' }, TODAY), 'umgesetzt')
  assert.equal(measureState({ status: 'unwirksam' }, TODAY), 'unwirksam')
  assert.ok(isOpenMeasure({ status: 'unwirksam' }, TODAY) && !isOpenMeasure({ status: 'wirksam' }, TODAY) && !isOpenMeasure({ status: 'umgesetzt' }, TODAY))
  const m = { id: 'm', text: 'X', status: 'offen', due: '2026-12-01', doneAt: '', checkedAt: '' }
  const done = setMeasureStatus(m, 'umgesetzt', TODAY)
  assert.deepEqual([done.status, done.doneAt, done.checkedAt], ['umgesetzt', TODAY, ''])
  const ok = setMeasureStatus({ ...done, doneAt: '2026-10-01' }, 'wirksam', TODAY)
  assert.deepEqual([ok.doneAt, ok.checkedAt], ['2026-10-01', TODAY])
  assert.deepEqual([setMeasureStatus(ok, 'offen', TODAY).doneAt, setMeasureStatus(ok, 'offen', TODAY).checkedAt], ['', ''])
})

test('Überprüfung: Intervall, bald fällig, überfällig, Anlass nach der letzten Überprüfung', () => {
  const s = settingsOf(null)
  assert.deepEqual(reviewOf({ reviewedAt: '2026-01-10' }, TODAY, s), { last: '2026-01-10', next: '2027-01-10', state: 'ok', trigger: null })
  assert.equal(reviewOf({ reviewedAt: '2025-12-01' }, TODAY, s).state, 'faellig')
  assert.equal(reviewOf({ reviewedAt: '2025-10-01' }, TODAY, s).state, 'ueberfaellig')
  assert.equal(reviewOf({ reviewedAt: '' }, TODAY, s).state, 'ueberfaellig')
  assert.equal(reviewOf({ reviewedAt: '2026-01-10', trigger: { date: '2026-10-20', text: 'Sturz von der Leiter' } }, TODAY, s).state, 'anlass')
  assert.equal(reviewOf({ reviewedAt: '2026-10-25', trigger: { date: '2026-10-20', text: 'Sturz' } }, TODAY, s).state, 'ok', 'nach dem Anlass überprüft')
  assert.equal(reviewOf({ reviewedAt: '2026-01-10' }, TODAY, { ...s, reviewMonths: 6 }).state, 'ueberfaellig')
})

const evalDoc = () => ({
  evaluations: [
    {
      id: 'e1',
      title: 'Glasreinigung',
      reviewedAt: '2026-03-01',
      hazards: [
        { id: 'h1', text: 'Absturz', likelihood: 1, severity: 3, measures: [{ id: 'm1', text: 'Teleskopstange', status: 'offen', due: '2026-10-01' }, { id: 'm2', text: 'Leiter prüfen', status: 'wirksam', due: '2026-01-01' }] },
        { id: 'h2', text: 'Schnitt', likelihood: 0, severity: 0, measures: [{ id: 'm3', text: 'Klingenschutz', status: 'offen', due: '' }] },
      ],
    },
    { id: 'e2', title: 'Alleinarbeit', reviewedAt: '2025-09-01', hazards: [{ id: 'h3', text: 'Keine Hilfe', likelihood: 2, severity: 3, measures: [{ id: 'm4', text: 'Meldung bei Beginn', status: 'unwirksam', due: '2026-01-01' }, { id: 'm5', text: 'Handy', status: 'umgesetzt', due: '2026-12-01' }] }] },
    { id: 'e3', title: 'Alt', active: false, reviewedAt: '2020-01-01', hazards: [{ id: 'h4', text: 'X', measures: [{ id: 'm6', text: 'Y', status: 'offen', due: '2020-01-01' }] }] },
  ],
})

test('Evaluierung: Übersicht je Arbeitsbereich und alle Maßnahmen (dringend zuerst, inaktive nicht)', () => {
  const rows = evalRows({ doc: evalDoc(), today: TODAY })
  assert.deepEqual(rows.map((r) => [r.ev.title, r.hazards, r.unrated, r.maxRisk, r.open, r.overdue, r.noDue, r.unwirksam, r.check, r.review.state]), [
    ['Alleinarbeit', 1, 0, 6, 1, 0, 0, 1, 1, 'ueberfaellig'],
    ['Glasreinigung', 2, 1, 3, 2, 1, 1, 0, 0, 'ok'],
  ])
  assert.deepEqual(allMeasures(evalDoc(), TODAY).map((x) => `${x.m.id}:${x.state}`), ['m1:ueberfaellig', 'm4:unwirksam', 'm3:ohne-frist', 'm5:umgesetzt', 'm2:wirksam'])
})

test('Handlungsbedarf: überfällige und unwirksame Maßnahmen, Überprüfung, Sicherheitsdatenblätter gesammelt', () => {
  const material = { articles: [art('a1', { name: 'Glas' }), art('a2', { name: 'Sanitär', sds: 'https://example.com/s.pdf', haz: { sdbDate: '2026-01-01' } })], moves: [] }
  const list = attention({ doc: evalDoc(), material, today: TODAY })
  assert.deepEqual(list.map((x) => [x.kind, x.ev?.id || '', x.list?.map((y) => y.m.id).join(',') || x.review?.state || x.rows?.map((r) => r.article.id).join(',')]), [
    ['massnahmen', 'e1', 'm1'],
    ['massnahmen', 'e2', 'm4'],
    ['ueberpruefung', 'e2', 'ueberfaellig'],
    ['sdb', '', 'a1'],
  ])
  assert.ok(list.every(isUrgent), 'überfällig, unwirksam, Überprüfung überfällig, Datenblatt fehlt')
  assert.ok(!isUrgent({ kind: 'ueberpruefung', review: { state: 'faellig' } }))
  // ohne Material (z. B. „Zu erledigen“ der Evaluierung): keine Zeile zu Datenblättern
  assert.ok(!attention({ doc: evalDoc(), material: null, today: TODAY }).some((x) => x.kind === 'sdb'))
})

test('Prüfen vor dem Speichern: Evaluierung und Betriebsanweisung', () => {
  const ev = { title: 'Glas', reviewedAt: TODAY, hazards: [{ text: 'Absturz', measures: [{ text: 'Stange' }] }] }
  assert.equal(evalProblem(ev, TODAY), '')
  assert.match(evalProblem({ ...ev, title: ' ' }, TODAY), /Arbeitsbereich/)
  assert.match(evalProblem({ ...ev, reviewedAt: '' }, TODAY), /zuletzt überprüft/)
  assert.match(evalProblem({ ...ev, reviewedAt: '2026-12-01' }, TODAY), /Zukunft/)
  assert.match(evalProblem({ ...ev, hazards: [{ text: '', measures: [] }] }, TODAY), /Beschreibung/)
  assert.match(evalProblem({ ...ev, hazards: [{ text: 'A', measures: [{ text: '' }] }] }, TODAY), /Maßnahme ohne Text/)
  assert.match(evalProblem({ ...ev, trigger: { date: '2026-11-01', text: '' } }, TODAY), /Anlass/)
  assert.match(evalProblem({ ...ev, trigger: { date: '', text: 'Unfall' } }, TODAY), /Datum des Anlasses/)
  const ba = { kind: 'stoff', articleId: 'a1', title: 'Sanitär', date: TODAY }
  assert.equal(instructionProblem(ba), '')
  assert.match(instructionProblem({ ...ba, articleId: '' }), /Arbeitsstoff/)
  assert.equal(instructionProblem({ ...ba, kind: 'taetigkeit', articleId: '' }), '')
  assert.match(instructionProblem({ ...ba, date: '' }), /Stand/)
  assert.match(instructionProblem({ ...ba, approvedAt: TODAY, approvedBy: '' }), /freigegeben/)
})

test('Vorlagen: typische Gefahren der Reinigung, Gefahren ohne Bewertung mit offenen Maßnahmen', () => {
  const ids = EVAL_TEMPLATES.map((t) => t.id)
  for (const id of ['unterhalt', 'glas', 'leiter', 'winter', 'chemie', 'allein', 'nacht']) assert.ok(ids.includes(id), id)
  assert.equal(new Set(ids).size, ids.length)
  for (const t of EVAL_TEMPLATES) for (const [text, measures] of t.hazards) assert.ok(text.length > 5 && measures.length >= 1, `${t.id}: ${text}`)
  const hz = hazardsFromTemplate('leiter', newId)
  assert.equal(hz.length, templateOf('leiter').hazards.length)
  assert.ok(hz.every((h) => h.source === 'vorschlag' && h.likelihood === 0 && h.severity === 0 && !riskOf(h)))
  assert.ok(hz.every((h) => h.measures.every((m) => m.status === 'offen' && !m.due && !m.who)))
  assert.deepEqual(hazardsFromTemplate('gibtsnicht', newId), [])
})

test('Betriebsanweisung aus dem Artikel: sechs Abschnitte, Piktogramme, Kürzel, Schutzausrüstung', () => {
  assert.deepEqual(BA_SECTIONS.map(([k]) => k), ['anwendung', 'gefahren', 'schutz', 'gefahrfall', 'ersteHilfe', 'entsorgung'])
  const v = instructionFromArticle(art('a', { name: 'Sanitär 1 l', haz: { product: 'Sanitär Beispiel', maker: 'Beispiel GmbH', use: 'Sanitärreinigung', ghs: ['GHS05', 'GHS09'], signal: 'gefahr', h: 'H290, H314', p: 'P280', ppe: [] } }))
  assert.equal(v.title, 'Sanitär Beispiel')
  assert.equal(v.area, 'Sanitärreinigung')
  assert.match(v.sections.anwendung, /^Sanitär Beispiel \(Beispiel GmbH\): Sanitärreinigung\./)
  assert.match(v.sections.gefahren, /Signalwort: Gefahr\./)
  assert.match(v.sections.gefahren, /Ätzend/)
  assert.match(v.sections.gefahren, /H290, H314/)
  assert.match(v.sections.schutz, /Schutzhandschuhe/)
  assert.match(v.sections.schutz, /Schutzbrille/)
  assert.match(v.sections.schutz, /P280/)
  assert.match(v.sections.gefahrfall, /144/)
  assert.match(v.sections.entsorgung, /nicht in Kanal, Gewässer oder Boden/)
  for (const [k] of BA_SECTIONS) assert.ok(v.sections[k].trim(), k)
  // ohne Angaben: Hinweis, Gefahren aus dem Sicherheitsdatenblatt zu ergänzen
  const empty = instructionFromArticle(art('b', { name: 'Glasreiniger' }))
  assert.equal(empty.title, 'Glasreiniger')
  assert.match(empty.sections.gefahren, /Sicherheitsdatenblatt \(Abschnitt 2\)/)
  assert.doesNotMatch(empty.sections.schutz, /Schutzbrille/)
})

test('Eigene Piktogramme als SVG mit Kennung und Namen', () => {
  for (const id of GHS_IDS) {
    const svg = ghsSvg(id, 24)
    assert.match(svg, /^<svg [^>]*viewBox="0 0 40 40"/)
    assert.match(svg, new RegExp(`aria-label="${id} `))
    assert.match(svg, /stroke="#c8102e"/)
  }
  assert.equal(ghsSvg('GHS10'), '')
})

test('PDF-Beschreibungen: Verzeichnis quer, Betriebsanweisung mit Entwurf-Hinweis, Evaluierung', () => {
  const material = { articles: [art('a1', { name: 'Sanitär', haz: { product: 'Sanitär Beispiel', maker: 'Beispiel GmbH', ghs: ['GHS05'], signal: 'gefahr', h: 'H314', p: 'P280', sdb: { path: 'p' }, sdbDate: '2026-01-01' } })], moves: [{ id: 'm', articleId: 'a1', kind: 'korrektur', loc: 'lager', qty: 4, date: '2026-01-01' }], locations: [{ id: 'lager', name: 'Hauptlager' }] }
  const doc = { instructions: [], evaluations: evalDoc().evaluations }
  const rows = stoffRows({ material, doc, today: TODAY })
  const v = verzeichnisDocument({ rows, objectName: () => '', today: TODAY })
  assert.equal(v.pageOrientation, 'landscape')
  const text = JSON.stringify(v.content)
  assert.match(text, /Arbeitsstoffverzeichnis/)
  assert.match(text, /Sanitär Beispiel/)
  assert.match(text, /Hauptlager: 4 Fl\./)
  assert.match(text, /"svg":"<svg/)
  assert.equal(verzeichnisPdfName(TODAY), 'Arbeitsstoffverzeichnis_2026-11-06.pdf')
  assert.equal(sdbText(rows[0].sdb), '01.01.2026')

  const ba = { id: 'b', kind: 'stoff', articleId: 'a1', title: 'Sanitär Beispiel', area: 'Sanitärreinigung', date: TODAY, sections: instructionFromArticle(material.articles[0]).sections, approvedBy: '', approvedAt: '' }
  const draft = JSON.stringify(instructionDocument({ ba, article: material.articles[0], sdb: rows[0].sdb }).content)
  assert.match(draft, /Entwurf – vor dem Aushang prüfen und freigeben/)
  for (const [, label] of BA_SECTIONS) assert.ok(draft.includes(label), label)
  assert.match(draft, /Gefahr/)
  const approved = JSON.stringify(instructionDocument({ ba: { ...ba, approvedBy: 'Geschäftsführung', approvedAt: TODAY } }).content)
  assert.doesNotMatch(approved, /Entwurf – vor dem Aushang/)
  assert.match(approved, /Freigegeben: Geschäftsführung/)
  assert.equal(instructionPdfName(ba), 'Betriebsanweisung_Sanitär-Beispiel_2026-11-06.pdf')

  const sgd = JSON.stringify(sgdDocument({ rows: evalRows({ doc, today: TODAY }), stoffe: 1, instructions: [ba], today: TODAY }).content)
  assert.match(sgd, /Sicherheits- und Gesundheitsschutzdokument/)
  assert.match(sgd, /Glasreinigung/)
  assert.match(sgd, /überfällig \(Frist 01\.10\.2026\)/)
  assert.match(sgd, /nicht bewertet/)
  assert.match(sgd, /Arbeitsstoffverzeichnis: 1 Arbeitsstoff/)
})

test('Beispieldaten: erfundene Arbeitsstoffe am Artikel, Betriebsanweisung, Evaluierungen mit Fristen', () => {
  const data = createDemoData('2026-11-02')
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date())
  const rows = stoffRows({ material: data.material, doc: data.arbeitsschutz, today })
  assert.deepEqual(rows.map((r) => [r.product, r.sdb.state, r.details]), [
    ['Allzweckreiniger Beispiel AZ 10', 'veraltet', true],
    ['Glasreiniger 1 l', 'fehlt', false],
    ['Sanitärreiniger Beispiel SR 20 (sauer)', 'ok', true],
  ])
  assert.ok(rows.every((r) => !r.maker || /Beispiel/.test(r.maker)))
  assert.equal(rows[2].instruction.id, 'ba-demo1')
  const kinds = attention({ doc: data.arbeitsschutz, material: data.material, today }).map((x) => `${x.kind}:${x.ev?.id || ''}`)
  assert.deepEqual(kinds, ['massnahmen:ev-demo1', 'ueberpruefung:ev-demo2', 'massnahmen:ev-demo3', 'sdb:'])
  // Vorbefüllte Betriebsanweisung aus den Angaben am Artikel
  assert.match(data.arbeitsschutz.instructions[0].sections.gefahren, /Ätzend/)
})
