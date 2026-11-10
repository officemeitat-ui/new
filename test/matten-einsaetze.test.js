// Mattenwechsel: Einsätze speichern und Kalender (core/matten-einsaetze.js, Paket P7): Planen und Speichern ohne Doppel
// („x neu, y unverändert, z zur Prüfung“), Verschieben/Aussetzen/Nachholen/Verwerfen über mehrere Planungsläufe (Rhythmus
// der Folgetermine bleibt), Betriebsurlaub (ausgesetzt bzw. nachzuholen), Kalender je Tag nach Gebiet → Objekt mit
// Ladeliste, Hinweise und „Zu erledigen“, Jahresgrenze Dezember/Januar mit zwei Dateien (YEAR_DOCS in data-service.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  actionProblem,
  applyJobAction,
  applyPauses,
  attention,
  calendarView,
  canApply,
  closuresProblem,
  confirmedExchanges,
  dayGroups,
  displayStatus,
  hintList,
  loadList,
  loadTotal,
  mergeJobs,
  normalizeClosures,
  planJobs,
  planRange,
  planSettings,
  rangeProblem,
  resolveReview,
  withId,
  yearsFor,
} from '../src/core/matten-einsaetze.js'
import { catchUpJob, jobDate, markDone, pauseEffect } from '../src/core/matten-plan.js'
import { nextOf, placementRows } from '../src/core/matten.js'
import { createMattenDemo, createMattenJobsDemo } from '../src/data/demo-matten.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { applyDoc, DataService, splitData, YEAR_DOCS, yearDocOf, yearPath, yearsAround } from '../src/storage/data-service.js'

const NOW = '2026-11-06T08:00:00.000Z'
const TODAY = '2026-11-06'
const mat = (size, color, qty = 1, owner = 'wir') => ({ articleId: `a-${size}-${color}`, qty, owner, name: `${size}, ${color}`, size, color })
const lp = (id, extra = {}) => ({ id, objectId: 'o1', name: id, active: true, intervalDays: 14, startDate: '2026-11-02', rule: 'rhythmus', pauses: [], mats: [mat('85 × 150 cm', 'grau')], ...extra })
const docOf = (placements, settings = {}) => ({ schema: 1, settings, placements, areas: [{ id: 'g1', name: 'Salzburg Nord', active: true }, { id: 'g2', name: 'Flachgau', active: true }] })
const plan = (doc, jobs, von, bis, extra = {}) => planJobs({ doc, jobs, von, bis, now: NOW, by: 'Büro', ...extra })
const dues = (jobs, id) => jobs.filter((j) => j.placementId === id).map((j) => j.due)
const find = (jobs, key) => jobs.find((j) => j.key === key)
const change = (jobs, keys, action, opts) => {
  const r = applyJobAction(jobs, keys, action, { today: TODAY, now: NOW, by: 'Büro', ...opts })
  return { ...r, jobs: mergeJobs(jobs, r.changed) }
}

// ---------------------------------------------------------------- Planen und Speichern

test('Planen: Einsätze mit id = Schlüssel, erneutes Planen ohne Doppel (x neu, y unverändert, z zur Prüfung)', () => {
  const doc = docOf([lp('L1'), lp('L2', { intervalDays: 28, startDate: '2026-11-04' })])
  const first = plan(doc, [], '2026-11-06', '2026-12-31')
  assert.deepEqual(dues(first.jobs, 'L1'), ['2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28'])
  assert.deepEqual(dues(first.jobs, 'L2'), ['2026-12-02', '2026-12-30'])
  assert.deepEqual(first.counts, { neu: 6, unveraendert: 0, pruefen: 0 })
  assert.ok(first.jobs.every((j) => j.id === j.key && j.createdBy === 'Büro' && j.status === 'geplant'))
  // derselbe Zeitraum noch einmal: nichts Neues, alles unverändert
  const again = plan(doc, first.jobs, '2026-11-06', '2026-12-31')
  assert.deepEqual(again.counts, { neu: 0, unveraendert: 6, pruefen: 0 })
  assert.deepEqual(again.jobs, first.jobs)
  // länger geplant: nur die fehlenden Wochen kommen dazu
  const longer = plan(doc, first.jobs, '2026-11-06', planRange('2026-11-06', 12).bis)
  assert.equal(planRange('2026-11-06').bis, '2026-12-31', '8 Wochen ab heute (je einschließlich)')
  assert.deepEqual(longer.added.map((j) => j.key), ['L1:2027-01-11', 'L1:2027-01-25', 'L2:2027-01-27'])
  assert.equal(longer.counts.unveraendert, 6)
  assert.equal(new Set(longer.jobs.map((j) => j.key)).size, longer.jobs.length, 'jeder Schlüssel einmal')
  assert.deepEqual(yearsFor('2026-11-06', '2027-01-29'), ['2025', '2026', '2027'])
  assert.equal(rangeProblem('2026-11-06', '2026-11-01'), 'Der Zeitraum endet vor seinem Beginn.')
  assert.equal(rangeProblem('2026-11-06', '2028-01-01'), 'Bitte höchstens ein Jahr auf einmal planen.')
  assert.equal(rangeProblem('2026-11-06', '2026-12-31'), '')
})

test('Planen: inaktiver und gelöschter Liegeplatz sowie neue Pause → zur Prüfung, Anpassen verwirft bzw. setzt aus', () => {
  const doc = docOf([lp('L1'), lp('L2'), lp('L3')])
  const { jobs } = plan(doc, [], '2026-11-06', '2026-12-31')
  const later = docOf([lp('L1', { pauses: [{ from: '2026-11-30', to: '2026-12-05', reason: 'Umbau' }] }), lp('L2', { active: false })])
  const r = plan(later, jobs, '2026-11-06', '2026-12-31')
  assert.equal(r.counts.neu, 0)
  assert.deepEqual(r.review.map((x) => [x.key, x.why]).sort(), [
    ['L1:2026-11-30', 'pause'],
    ['L2:2026-11-16', 'inaktiv'],
    ['L2:2026-11-30', 'inaktiv'],
    ['L2:2026-12-14', 'inaktiv'],
    ['L2:2026-12-28', 'inaktiv'],
    ['L3:2026-11-16', 'geloescht'],
    ['L3:2026-11-30', 'geloescht'],
    ['L3:2026-12-14', 'geloescht'],
    ['L3:2026-12-28', 'geloescht'],
  ])
  assert.ok(r.review.every((x) => x.job?.key === x.key))
  const fixed = resolveReview(r.review, { doc: later, jobs, now: NOW, by: 'Büro' })
  const after = mergeJobs(jobs, fixed)
  assert.equal(find(after, 'L1:2026-11-30').status, 'ausgesetzt')
  assert.equal(find(after, 'L1:2026-11-30').reason, 'Umbau')
  assert.equal(find(after, 'L2:2026-11-16').status, 'verworfen')
  assert.equal(find(after, 'L3:2026-12-28').reason, 'Liegeplatz gibt es nicht mehr')
  assert.deepEqual(plan(later, after, '2026-11-06', '2026-12-31').counts, { neu: 0, unveraendert: 12, pruefen: 0 }, 'danach nichts mehr zu prüfen')
})

// ---------------------------------------------------------------- Verschieben, Aussetzen, Nachholen, Verwerfen

test('Verschieben: nur der Tag ändert sich, Rhythmus der Folgetermine bleibt über weitere Planungsläufe', () => {
  const doc = docOf([lp('L1')])
  let { jobs } = plan(doc, [], '2026-11-06', '2026-12-31')
  const r = change(jobs, ['L1:2026-11-30'], 'verschieben', { date: '2026-12-03', reason: 'Kunde bittet um Donnerstag' })
  assert.equal(r.changed.length, 1)
  jobs = r.jobs
  const moved = find(jobs, 'L1:2026-11-30')
  assert.deepEqual([moved.due, moved.planned, moved.status, moved.reason, moved.updatedBy], ['2026-11-30', '2026-12-03', 'geplant', 'Kunde bittet um Donnerstag', 'Büro'])
  assert.equal(displayStatus(moved, TODAY), 'verschoben')
  // zweiter und dritter Lauf (auch über den Jahreswechsel): der verschobene bleibt, Folgetermine im alten Rhythmus
  jobs = plan(doc, jobs, '2026-11-06', '2026-12-31').jobs
  jobs = plan(doc, jobs, '2026-11-20', '2027-01-31').jobs
  assert.deepEqual(dues(jobs, 'L1'), ['2026-11-16', '2026-11-30', '2026-12-14', '2026-12-28', '2027-01-11', '2027-01-25'])
  assert.equal(find(jobs, 'L1:2026-11-30').planned, '2026-12-03')
  // zurück auf den Solltermin entfernt planned
  const back = change(jobs, ['L1:2026-11-30'], 'verschieben', { date: '2026-11-30' }).jobs
  assert.equal(find(back, 'L1:2026-11-30').planned, undefined)
  assert.equal(actionProblem('verschieben', { date: '', today: TODAY }), 'Bitte den neuen Tag wählen.')
  assert.equal(actionProblem('verschieben', { date: '2026-11-01', today: TODAY }), 'Bitte einen Tag ab heute wählen.')
  assert.equal(actionProblem('verschieben', { date: '2026-11-10', today: TODAY }), '')
})

test('Aussetzen und Nachholen: ausgesetzt bleibt ausgesetzt, Nachholen öffnet ihn wieder, Verwerfen schließt ab', () => {
  const doc = docOf([lp('L1'), lp('L2')])
  let { jobs } = plan(doc, [], '2026-11-06', '2026-12-31')
  assert.equal(actionProblem('aussetzen', { reason: ' ' }), 'Bitte den Grund eintragen, z. B. Kunde geschlossen.')
  // zwei markierte auf einmal aussetzen
  let r = change(jobs, ['L1:2026-11-16', 'L2:2026-11-16'], 'aussetzen', { reason: 'Inventur' })
  assert.deepEqual(r.changed.map((j) => [j.key, j.status, j.reason]), [['L1:2026-11-16', 'ausgesetzt', 'Inventur'], ['L2:2026-11-16', 'ausgesetzt', 'Inventur']])
  jobs = r.jobs
  // erneutes Planen legt ausgesetzte nicht neu an
  jobs = plan(doc, jobs, '2026-11-06', '2026-12-31').jobs
  assert.equal(find(jobs, 'L1:2026-11-16').status, 'ausgesetzt')
  assert.equal(jobs.filter((j) => j.due === '2026-11-16').length, 2)
  // ausgesetzt: kein „nächster Wechsel“ an diesem Tag, sondern der folgende im Rhythmus
  assert.equal(nextOf(doc.placements[0], { today: TODAY, jobs }).next.date, '2026-11-30')
  // nachholen am 18.11.: wieder offen, Status nachzuholen, Solltermin bleibt
  assert.ok(canApply('nachholen', find(jobs, 'L1:2026-11-16'), TODAY))
  assert.ok(!canApply('nachholen', find(jobs, 'L1:2026-11-30'), TODAY), 'ein künftiger geplanter wird verschoben, nicht nachgeholt')
  r = change(jobs, ['L1:2026-11-16', 'L2:2026-11-30'], 'nachholen', { date: '2026-11-18' })
  assert.deepEqual(r.changed.map((j) => [j.key, j.status, j.planned]), [['L1:2026-11-16', 'nachzuholen', '2026-11-18']])
  assert.deepEqual(r.skipped.map((j) => j.key), ['L2:2026-11-30'])
  jobs = r.jobs
  assert.equal(displayStatus(find(jobs, 'L1:2026-11-16'), TODAY), 'nachzuholen')
  assert.equal(nextOf(doc.placements[0], { today: TODAY, jobs }).next.date, '2026-11-18')
  // ein Wechsel darüber hinaus: zweimal planen, nichts doppelt
  jobs = plan(doc, jobs, '2026-11-06', '2027-01-10').jobs
  jobs = plan(doc, jobs, '2026-11-06', '2027-01-10').jobs
  assert.equal(new Set(jobs.map((j) => j.key)).size, jobs.length)
  // überfällig: am 20.11. ist der nachzuholende vom 18.11. überfällig; verwerfen mit Grund
  const later = '2026-11-20'
  assert.equal(displayStatus(find(jobs, 'L1:2026-11-16'), later), 'ueberfaellig')
  assert.equal(actionProblem('verwerfen', { reason: '' }), 'Bitte den Grund eintragen, z. B. Kunde hat gekündigt.')
  r = applyJobAction(jobs, ['L1:2026-11-16'], 'verwerfen', { reason: 'Kunde verzichtet', today: later, now: NOW, by: 'Büro' })
  jobs = mergeJobs(jobs, r.changed)
  assert.equal(find(jobs, 'L1:2026-11-16').status, 'verworfen')
  assert.deepEqual(hintList(jobs, { placements: doc.placements, today: later }).overdue, [], 'ausgesetzt und verworfen: nicht überfällig')
  // erledigte und Einsätze in einer Tour ändert der Kalender nicht
  const doneJob = markDone(find(jobs, 'L1:2026-11-30'), '2026-11-30')
  assert.ok(['verschieben', 'aussetzen', 'nachholen', 'verwerfen'].every((a) => !canApply(a, doneJob, TODAY)))
  assert.ok(!canApply('verschieben', { ...find(jobs, 'L1:2026-12-14'), status: 'in-tour' }, TODAY))
})

test('Nachholen (catchUpJob) und Pause auf geplante Einsätze: Solltermin und Schlüssel bleiben', () => {
  const j = withId({ key: 'L1:2026-11-16', placementId: 'L1', due: '2026-11-16', status: 'ausgesetzt', reason: 'Inventur' })
  const c = catchUpJob(j, '2026-11-19', { now: NOW, by: 'Büro' })
  assert.deepEqual([c.key, c.id, c.due, c.planned, c.status, c.reason], ['L1:2026-11-16', 'L1:2026-11-16', '2026-11-16', '2026-11-19', 'nachzuholen', 'nachholen'])
  assert.equal(catchUpJob(j, 'morgen'), j, 'ungültiges Datum ändert nichts')
  // pauseEffect: wie beim Planen
  const p = lp('L1', { pauses: [{ from: '2026-11-15', to: '2026-11-20', reason: 'Umbau', mode: 'nachholen' }] })
  assert.deepEqual(pauseEffect(p, '2026-11-16', '2026-11-16'), { status: 'nachzuholen', planned: '2026-11-21', reason: 'Umbau: nachholen' })
  assert.deepEqual(pauseEffect(p, '2026-11-16', '2026-11-16', { skip: 'entfaellt' }), { status: 'nachzuholen', planned: '2026-11-21', reason: 'Umbau: nachholen' }, 'mode der Pause geht vor')
  assert.equal(pauseEffect(p, '2026-11-25', '2026-11-25'), null)
})

// ---------------------------------------------------------------- Betriebsurlaub

test('Betriebsurlaub: beim Planen ausgesetzt bzw. nachzuholen (Einstellung skip), schon geplante werden angepasst', () => {
  const closures = normalizeClosures([{ from: '2026-12-24', to: '2026-12-31', reason: ' Betriebsurlaub ' }, { from: '', reason: '' }])
  assert.deepEqual(closures, [{ from: '2026-12-24', to: '2026-12-31', reason: 'Betriebsurlaub' }])
  assert.equal(closuresProblem(normalizeClosures([{ from: '2026-12-24', to: '2026-12-20' }])), 'Ein Betriebsurlaub endet vor seinem Beginn.')
  assert.equal(closuresProblem(normalizeClosures([{ to: '2026-12-20', reason: 'x' }])), 'Bitte bei jedem Betriebsurlaub das Datum „von“ eintragen.')
  assert.deepEqual(normalizeClosures([{ from: '2026-12-08', reason: 'Feiertag' }]), [{ from: '2026-12-08', to: '2026-12-08', reason: 'Feiertag' }], 'ohne „bis“: ein Tag')
  // L1 alle 14 Tage ab 2.11. → 28.12. im Betriebsurlaub; L2 alle 28 Tage ab 30.11. → 28.12. ebenso
  const placements = [lp('L1'), lp('L2', { intervalDays: 28, startDate: '2026-11-30' })]
  const entfaellt = plan(docOf(placements, { closures, skip: 'entfaellt' }), [], '2026-12-01', '2027-01-31')
  assert.deepEqual([find(entfaellt.jobs, 'L1:2026-12-28').status, find(entfaellt.jobs, 'L1:2026-12-28').reason], ['ausgesetzt', 'Betriebsurlaub'])
  assert.equal(find(entfaellt.jobs, 'L1:2027-01-11').status, 'geplant', 'danach im Rhythmus weiter')
  const nachholen = plan(docOf(placements, { closures, skip: 'nachholen' }), [], '2026-12-01', '2027-01-31')
  // fester Rhythmus 14 Tage: 1.1. liegt vor dem nächsten Solltermin 11.1. → nachholen; 28 Tage ebenso
  assert.deepEqual([find(nachholen.jobs, 'L1:2026-12-28').status, find(nachholen.jobs, 'L1:2026-12-28').planned], ['nachzuholen', '2027-01-01'])
  assert.equal(find(nachholen.jobs, 'L2:2026-12-28').planned, '2027-01-01')
  assert.equal(planSettings(docOf([], { skip: 'quatsch' })).skip, 'entfaellt')
  // erst planen, dann den Betriebsurlaub eintragen: die geplanten ab heute werden angepasst
  const before = plan(docOf(placements), [], '2026-12-01', '2027-01-31').jobs
  const changed = applyPauses(before, { doc: docOf(placements, { closures, skip: 'nachholen' }), from: TODAY, now: NOW, by: 'Büro' })
  assert.deepEqual(changed.map((j) => [j.key, j.status, j.planned]), [['L1:2026-12-28', 'nachzuholen', '2027-01-01'], ['L2:2026-12-28', 'nachzuholen', '2027-01-01']])
  assert.deepEqual(applyPauses(mergeJobs(before, changed), { doc: docOf(placements, { closures, skip: 'nachholen' }), from: TODAY }), [], 'zweimal anwenden ändert nichts mehr')
  // Liegeplatz-Ansicht: „nächster Wechsel“ überspringt den Betriebsurlaub (auch ohne gespeicherte Einsätze)
  const p = lp('L3', { startDate: '2026-12-28' })
  assert.equal(nextOf(p, { today: '2026-12-20', closures }).next.date, '2027-01-11')
  assert.equal(nextOf(p, { today: '2026-12-20', closures, skip: 'nachholen' }).next.date, '2027-01-01')
})

// ---------------------------------------------------------------- Kalender, Ladeliste

test('Ladeliste: Matten je Größe und Farbe der offenen Einsätze, Kundeneigentum, Werkzeug-Größen, nach Fläche sortiert', () => {
  const placements = [
    lp('A', { mats: [mat('85 × 150 cm', 'grau', 2), mat('150 × 250 cm', 'anthrazit', 1)] }),
    lp('B', { mats: [mat('85 × 150 cm', 'grau', 1, 'kunde')] }),
    lp('C', { mats: [{ qty: 3, owner: 'wir', legacy: { groesse: '60 x 90 cm', farbe: 'Rot' } }] }),
    lp('D', { mats: [mat('85 × 150 cm', 'grau', 5)] }),
  ]
  const jobs = [
    { key: 'A:1', placementId: 'A', due: '2026-11-16', status: 'geplant' },
    { key: 'B:1', placementId: 'B', due: '2026-11-16', status: 'nachzuholen', planned: '2026-11-16' },
    { key: 'C:1', placementId: 'C', due: '2026-11-16', status: 'geplant' },
    { key: 'D:1', placementId: 'D', due: '2026-11-16', status: 'ausgesetzt' },
    { key: 'X:1', placementId: 'X', due: '2026-11-16', status: 'geplant' },
  ]
  const list = loadList(jobs, placements)
  assert.deepEqual(list.map((r) => [r.label, r.qty, r.kunde, r.placements]), [
    ['60 x 90 cm Rot', 3, 0, 1],
    ['85 × 150 cm, grau', 3, 1, 2],
    ['150 × 250 cm, anthrazit', 1, 0, 1],
  ])
  assert.equal(loadTotal(list), 7)
  assert.equal(loadTotal(loadList(jobs, placements, { all: true })), 12, 'all: auch ausgesetzte')
})

test('Kalender: je Tag nach Gebiet → Objekt, Status, Matten je Objekt, verschobene am neuen Tag, verworfene nicht', () => {
  const objects = [{ id: 'o1', name: 'Wohnanlage Lehen', address: 'Lehen' }, { id: 'o2', name: 'Autohaus Maxglan' }]
  const placements = [
    lp('A', { name: 'Haupteingang', objectId: 'o1', areaId: 'g1', mats: [mat('85 × 150 cm', 'grau', 2)] }),
    lp('B', { name: 'Stiege 2', objectId: 'o1', areaId: 'g1' }),
    lp('C', { name: 'Schauraum', objectId: 'o2', areaId: 'g2', mats: [mat('150 × 250 cm', 'anthrazit', 2)] }),
    lp('D', { name: 'Werkstatt', objectId: 'o2', areaId: '' }),
  ]
  const doc = docOf(placements)
  let { jobs } = plan(doc, [], '2026-11-02', '2026-11-30')
  jobs = change(jobs, ['C:2026-11-16'], 'verschieben', { date: '2026-11-17' }).jobs
  jobs = change(jobs, ['D:2026-11-16'], 'verwerfen', { reason: 'gekündigt' }).jobs
  jobs = mergeJobs(jobs, [markDone(find(jobs, 'A:2026-11-02'), '2026-11-02')])
  const groups = dayGroups(jobs.filter((j) => jobDate(j) === '2026-11-16'), { placements, objects, areas: doc.areas, today: TODAY })
  assert.deepEqual(groups.map((g) => [g.name, g.objects.map((o) => [o.name, o.placements, o.items.map((x) => [x.placement.name, x.status])])]), [['Salzburg Nord', [['Wohnanlage Lehen', 2, [['Haupteingang', 'geplant'], ['Stiege 2', 'geplant']]]]]])
  assert.deepEqual(groups[0].objects[0].load.map((r) => [r.label, r.qty]), [['85 × 150 cm, grau', 3]])
  // Woche ab Montag 16.11.
  const week = calendarView({ jobs, placements, objects, areas: doc.areas, today: TODAY, mode: 'woche', date: '2026-11-18' })
  assert.equal(week.monday, '2026-11-16')
  assert.equal(week.days.length, 7)
  const [mo, di] = week.days
  assert.deepEqual([mo.jobs, mo.open, mo.objects, mo.mats, mo.weekend], [2, 2, 1, 3, false])
  assert.deepEqual(mo.moved.map((x) => x.job.key), ['C:2026-11-16'], 'am Solltermin: „verschoben auf …“')
  assert.deepEqual(di.groups.map((g) => [g.name, g.objects.map((o) => o.items.map((x) => x.status))]), [['Flachgau', [['verschoben']]]])
  assert.deepEqual(di.load.map((r) => [r.label, r.qty]), [['150 × 250 cm, anthrazit', 2]])
  assert.equal(week.days[5].weekend, true)
  // Monat November: ganze Wochen, Zähler je Status; vergangener offener Einsatz überfällig, ohne Gebiet zuletzt
  const month = calendarView({ jobs, placements, objects, areas: doc.areas, today: TODAY, mode: 'monat', date: '2026-11-18' })
  assert.equal(month.from, '2026-10-26')
  assert.equal(month.to, '2026-12-06')
  const nov2 = month.days.find((d) => d.date === '2026-11-02')
  assert.deepEqual(nov2.counts, { erledigt: 1, ueberfaellig: 3 })
  assert.deepEqual(nov2.groups.map((g) => g.name), ['Flachgau', 'Salzburg Nord', 'ohne Gebiet'])
  assert.equal(month.days.find((d) => d.date === '2026-10-26').inMonth, false)
  // Hinweise: überfällige (offen vor heute), nachzuholende ab heute
  jobs = change(jobs, ['B:2026-11-30'], 'aussetzen', { reason: 'Umbau' }).jobs
  jobs = change(jobs, ['B:2026-11-30'], 'nachholen', { date: '2026-12-02' }).jobs
  const h = hintList(jobs, { placements, today: TODAY })
  assert.deepEqual(h.overdue.map((x) => x.job.key), ['B:2026-11-02', 'C:2026-11-02', 'D:2026-11-02'])
  assert.deepEqual(h.catchUp.map((x) => x.job.key), ['B:2026-11-30'])
})

// ---------------------------------------------------------------- Zu erledigen, bestätigte Wechsel

test('Zu erledigen: überfällige Liegeplätze und noch nicht geplante Einsätze der nächsten 14 Tage', () => {
  const doc = docOf([lp('A'), lp('B', { rule: 'ab-ist', intervalDays: 28, startDate: '2026-09-01', lastExchange: { date: '2026-10-01' } }), lp('C', { active: false })])
  const done = confirmedExchanges({ placements: doc.placements })
  assert.deepEqual(done, [{ placementId: 'B', date: '2026-10-01' }])
  let a = attention({ doc, jobs: [], done, today: TODAY })
  assert.deepEqual(a.overdue.map((x) => [x.placement.id, x.next.date]), [['B', '2026-10-29']], 'ab dem letzten Wechsel: überfällig auch ohne Einsatz')
  assert.deepEqual(a.missing.map((j) => j.key), ['B:2026-10-29', 'A:2026-11-16'])
  assert.equal(a.until, '2026-11-19')
  // nach dem Planen fehlt nichts mehr; der offene Einsatz vom 2.11. ist überfällig
  const jobs = plan(doc, [{ key: 'A:2026-11-02', id: 'A:2026-11-02', placementId: 'A', due: '2026-11-02', status: 'geplant' }], TODAY, '2026-12-31', { done }).jobs
  a = attention({ doc, jobs, done, today: TODAY })
  assert.deepEqual(a.missing, [])
  assert.deepEqual(a.overdue.map((x) => x.placement.id).sort(), ['A', 'B'])
  // bestätigte Wechsel aus Touren (Phase Fahrer): erledigt und teilweise zählen
  const tours = [{ date: '2026-11-03', stops: [{ items: [{ placementId: 'A', status: 'erledigt', time: '2026-11-03T08:12:00Z' }, { placementId: 'B', status: 'nicht-durchgefuehrt' }] }, { items: [{ placementId: 'C', status: 'teilweise' }] }] }]
  assert.deepEqual(confirmedExchanges({ placements: [], tours }), [{ placementId: 'A', date: '2026-11-03' }, { placementId: 'C', date: '2026-11-03' }])
  // bestätigt um 0:40 Uhr in Wien (23:40 UTC am Vortag): Tag in Wien wie in der Übersicht, nicht der UTC-Vortag
  const night = [{ date: '2026-11-03', stops: [{ items: [{ placementId: 'A', status: 'erledigt', time: '2026-11-03T23:40:00.000Z' }] }] }]
  assert.deepEqual(confirmedExchanges({ tours: night }), [{ placementId: 'A', date: '2026-11-04' }])
})

test('Liegeplatz-Ansicht: nächster Wechsel aus gespeicherten Einsätzen (verschoben, ausgesetzt) und Schließtagen', () => {
  const doc = docOf([lp('A', { name: 'Haupteingang' })], { closures: [{ from: '2026-11-30', to: '2026-11-30', reason: 'Inventur' }] })
  let { jobs } = plan(doc, [], TODAY, '2026-12-31')
  assert.equal(find(jobs, 'A:2026-11-30').status, 'ausgesetzt', 'Schließtag beim Planen')
  jobs = change(jobs, ['A:2026-11-16'], 'verschieben', { date: '2026-11-18' }).jobs
  const s = planSettings(doc)
  const rows = placementRows({ doc, objects: [], today: TODAY, jobs, closures: s.closures, skip: s.skip })
  assert.deepEqual([rows[0].next.date, rows[0].next.due, rows[0].state], ['2026-11-18', '2026-11-16', 'geplant'])
  jobs = mergeJobs(jobs, [markDone(find(jobs, 'A:2026-11-16'), '2026-11-18')])
  assert.equal(placementRows({ doc, objects: [], today: '2026-11-19', jobs, closures: s.closures }).at(0).next.date, '2026-12-14', 'ausgesetzter 30.11. zählt nicht')
})

test('Beispieldaten: Einsätze passen zu den Liegeplätzen (erledigt, überfällig, verschoben, ausgesetzt)', () => {
  const matten = createMattenDemo()
  const jobs = createMattenJobsDemo(TODAY, matten)
  assert.ok(jobs.every((j) => j.id === j.key && matten.placements.some((p) => p.id === j.placementId)))
  const st = (k) => displayStatus(find(jobs, k), TODAY)
  assert.deepEqual([st('mw-demo1:2026-11-04'), st('mw-demo2:2026-11-04'), st('mw-demo1:2026-11-18'), st('mw-demo1:2026-12-02')], ['erledigt', 'ueberfaellig', 'verschoben', 'ausgesetzt'])
  assert.deepEqual(plan(matten, jobs, TODAY, '2026-12-10').counts.neu, 0, 'Beispiel ist schon geplant')
})

// ---------------------------------------------------------------- Ablage: eine Datei je Jahr

function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => [...map.keys()][i], get length() { return map.size } }
}
const seed = () => ({ version: 1, employees: [], objects: [], tasks: [], absences: [], assignments: {}, overrides: {}, logs: {}, published: {}, skills: [], rules: {} })

test('Ablage: Einsätze je Jahr des Solltermins in matten/einsaetze-<Jahr>.json (splitData, applyDoc)', () => {
  assert.equal(yearPath('mattenJobs', '2027'), 'matten/einsaetze-2027.json')
  assert.deepEqual(yearDocOf('matten/einsaetze-2027.json')?.year, '2027')
  assert.equal(yearDocOf('matten/matten.json'), null)
  assert.equal(yearDocOf('matten/einsaetze-27.json'), null)
  assert.deepEqual(yearsAround('2026-11-06'), ['2025', '2026', '2027'])
  assert.deepEqual(YEAR_DOCS.mattenJobs.empty(), { schema: 1, jobs: [] })
  const doc = docOf([lp('L1')])
  let { jobs } = plan(doc, [], '2026-12-01', '2027-01-31')
  jobs = change(jobs, ['L1:2026-12-28'], 'verschieben', { date: '2027-01-04' }).jobs
  const docs = splitData({ mattenJobs: [...jobs].reverse() }, [], ['matten/einsaetze-2025.json'])
  assert.deepEqual(docs['matten/einsaetze-2026.json'].jobs.map((j) => j.key), ['L1:2026-12-14', 'L1:2026-12-28'], 'verschoben in den Jänner: bleibt im Jahr des Solltermins, sortiert')
  assert.deepEqual(docs['matten/einsaetze-2027.json'].jobs.map((j) => j.key), ['L1:2027-01-11', 'L1:2027-01-25'])
  assert.deepEqual(docs['matten/einsaetze-2025.json'], { schema: 1, jobs: [] }, 'geladenes Jahr ohne Einsätze: leere Datei')
  assert.equal(docs['matten/einsaetze-2026.json'].schema, 1)
  // applyDoc ersetzt nur das Jahr der Datei
  const data = { mattenJobs: jobs }
  applyDoc(data, 'matten/einsaetze-2027.json', { schema: 1, jobs: [withId({ key: 'L9:2027-02-01', placementId: 'L9', due: '2027-02-01', status: 'geplant' })] })
  assert.deepEqual(data.mattenJobs.map((j) => j.key).sort(), ['L1:2026-12-14', 'L1:2026-12-28', 'L9:2027-02-01'])
})

test('Ablage: Jahresgrenze Dezember/Januar – zwei Dateien, neu laden, gleichzeitig planen wird zusammengeführt', async () => {
  const storage = memoryStorage()
  const a = new DataService(new LocalDocStore({ storage }), { debounceMs: 0 })
  await a.load(seed)
  await a.ensureYears('mattenJobs', ['2026', '2027'])
  assert.ok(a.yearLoaded('mattenJobs', '2026') && a.yearLoaded('mattenJobs', 2027))
  const doc = docOf([lp('L1'), lp('L2', { intervalDays: 28, startDate: '2026-12-21' })])
  a.data.matten = doc
  a.data.mattenJobs = plan(doc, [], '2026-12-01', '2027-01-31').jobs
  await a.flush()
  const file = async (y) => (await a.store.read(`matten/einsaetze-${y}.json`))?.data
  assert.deepEqual((await file(2026)).jobs.map((j) => j.key), ['L1:2026-12-14', 'L2:2026-12-21', 'L1:2026-12-28'])
  assert.deepEqual((await file(2027)).jobs.map((j) => j.key), ['L1:2027-01-11', 'L2:2027-01-18', 'L1:2027-01-25'])
  // ein Einsatz vom Dezember in den Jänner verschoben: nur die Datei 2026 ändert sich
  const etag2027 = (await a.store.read('matten/einsaetze-2027.json')).etag
  a.data.mattenJobs = change(a.data.mattenJobs, ['L1:2026-12-28'], 'verschieben', { date: '2027-01-04' }).jobs
  await a.flush()
  assert.equal((await file(2026)).jobs.find((j) => j.key === 'L1:2026-12-28').planned, '2027-01-04')
  assert.equal((await a.store.read('matten/einsaetze-2027.json')).etag, etag2027, 'unverändertes Jahr nicht neu gespeichert')
  // zweites Gerät lädt beide Jahre; beide planen gleichzeitig weiter: zusammengeführt, ohne Doppel
  const b = new DataService(new LocalDocStore({ storage }), { debounceMs: 0 })
  await b.load(seed)
  await b.ensureYears('mattenJobs', ['2026', '2027'])
  assert.equal(b.data.mattenJobs.length, 6)
  a.data.mattenJobs = plan(doc, a.data.mattenJobs, '2027-02-01', '2027-02-28').jobs
  b.data.mattenJobs = change(b.data.mattenJobs, ['L2:2027-01-18'], 'aussetzen', { reason: 'Inventur' }).jobs
  b.data.mattenJobs = plan(doc, b.data.mattenJobs, '2027-02-01', '2027-02-28').jobs
  await a.flush()
  await b.flush()
  const c = new DataService(new LocalDocStore({ storage }), { debounceMs: 0 })
  await c.load(seed)
  await c.ensureYears('mattenJobs', ['2026', '2027'])
  const keys = c.data.mattenJobs.map((j) => j.key)
  assert.equal(new Set(keys).size, keys.length, 'kein Einsatz doppelt')
  assert.deepEqual(keys.filter((k) => k.includes('2027-02')).sort(), ['L1:2027-02-08', 'L1:2027-02-22', 'L2:2027-02-15'])
  assert.equal(c.data.mattenJobs.find((j) => j.key === 'L2:2027-01-18').status, 'ausgesetzt')
  assert.equal(c.data.mattenJobs.find((j) => j.key === 'L1:2026-12-28').planned, '2027-01-04')
  // ein noch nicht geladenes Jahr, in dem hier schon geplant wurde: beim Laden zusammengeführt statt überschrieben
  const job = (key) => withId({ key, placementId: key.split(':')[0], due: key.split(':')[1], status: 'geplant' })
  await c.ensureYears('mattenJobs', ['2031'])
  c.data.mattenJobs = mergeJobs(c.data.mattenJobs, [job('L1:2031-03-03')])
  await c.flush()
  const d = new DataService(new LocalDocStore({ storage }), { debounceMs: 0 })
  await d.load(seed)
  assert.ok(!d.yearLoaded('mattenJobs', '2031'))
  d.data.mattenJobs = mergeJobs(d.data.mattenJobs, [job('L3:2031-03-01')])
  await d.ensureYears('mattenJobs', ['2031'])
  assert.deepEqual(d.data.mattenJobs.filter((j) => j.due.startsWith('2031')).map((j) => j.key).sort(), ['L1:2031-03-03', 'L3:2031-03-01'])
  await d.flush()
  assert.deepEqual((await d.store.read('matten/einsaetze-2031.json')).data.jobs.map((j) => j.key), ['L3:2031-03-01', 'L1:2031-03-03'])
})

test('Rechte: Einsätze liegen im Ordner matten/ (nur Büro), Fahrer lesen sie nicht', async () => {
  const { dataRights } = await import('../src/storage/data-service.js')
  const { resolveAccess } = await import('../src/core/access.js')
  const access = { planners: [], groups: {} }
  const role = (id) => resolveAccess({ roleClaims: [id], access, strict: true })
  const path = 'matten/einsaetze-2026.json'
  assert.ok(dataRights(role('mattenwechsel')).write(path))
  assert.ok(!dataRights(role('mattenfahrer')).read(path))
  assert.ok(!dataRights(role('lager')).read(path))
  // Entscheidungen beim digitalen Mitarbeiter („Später“, „Ablehnen“): auch das Büro des Mattenwechsels
  assert.ok(dataRights(role('mattenwechsel')).write('assistenz/entscheidungen.json'))
})
