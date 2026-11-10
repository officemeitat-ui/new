// Bewerber, Eintritt, Austritt (core/bewerber.js): Status mit Verlauf, ohne Rückmeldung, Löschfrist, Prüfen vor dem
// Speichern, Hinweis auf geschützte Merkmale, Stammblatt aus der Bewerbung, Absage-Vorlage, Checklisten aus Vorlagen
// mit Fristen, Verknüpfungen (Unterweisungen, Schlüssel, Plan am Handy, Einsätze), Fristen für „Zu erledigen“.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addLog,
  addTask,
  applicantCounts,
  applicantProblem,
  AUSTRITT_DEFAULTS,
  checklistAttention,
  DEFAULT_REJECT,
  deleteDue,
  deletionsDue,
  EINTRITT_DEFAULTS,
  emptyBewerbung,
  emptyEintritt,
  employeeFrom,
  fillText,
  filterApplicants,
  futureWork,
  handyLang,
  keyCheck,
  lastActivity,
  linkContext,
  linkedOf,
  markDone,
  markOpen,
  moveList,
  nextTask,
  payrollGaps,
  payrollText,
  progress,
  protectedHints,
  rejectMail,
  removeApplicant,
  setStatus,
  silentApplicants,
  SOURCES,
  startList,
  STATUS,
  TASK_TYPES,
  taskState,
  templateOf,
  trainingCheck,
} from '../src/core/bewerber.js'
import { handOver } from '../src/core/keys.js'
import { LANGUAGES } from '../src/core/sprachen.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'
import { createBewerberDemo } from '../src/data/demo-bewerber.js'

const TODAY = '2026-11-06'
let n = 0
const newId = () => `x${++n}`
const applicant = (over = {}) => ({ id: 'b1', name: 'Test Person', source: 'inserat', status: 'neu', hours: 20, langs: ['de'], availability: {}, docs: [], log: [], createdAt: '2026-11-01T08:00:00Z', ...over })

test('Leere Dateien wie in der Ablage, Status und Quellen', () => {
  assert.deepEqual(MODULE_DOCS.bewerbung.empty(), emptyBewerbung())
  assert.deepEqual(MODULE_DOCS.eintritt.empty(), emptyEintritt())
  assert.equal(MODULE_DOCS.bewerbung.path, 'bewerbung/bewerbung.json')
  assert.equal(MODULE_DOCS.eintritt.path, 'eintritt/eintritt.json')
  assert.deepEqual(Object.keys(STATUS), ['neu', 'kontakt', 'gespraech', 'probe', 'zusage', 'absage', 'zurueck'])
  assert.equal(STATUS.gespraech, 'Gespräch geplant')
  assert.deepEqual(Object.values(SOURCES), ['AMS', 'Inserat', 'Empfehlung', 'Initiativ'])
})

test('Status: Verlauf, Entscheidung (Zusage, Absage, Rückzug) mit Datum, Kontakt zählt als Rückmeldung', () => {
  let a = applicant()
  a = setStatus(a, 'kontakt', { date: '2026-11-02', at: '2026-11-02T10:00:00Z', by: 'Petra' })
  assert.equal(a.status, 'kontakt')
  assert.equal(a.decidedAt, '')
  assert.deepEqual(a.log.at(-1), { at: '2026-11-02T10:00:00Z', date: '2026-11-02', by: 'Petra', kind: 'status', status: 'kontakt', text: '' })
  a = setStatus(a, 'absage', { date: '2026-11-05', by: 'Petra', text: ' mit Absage-Mail ' })
  assert.equal(a.decidedAt, '2026-11-05')
  assert.equal(a.log.at(-1).text, 'mit Absage-Mail')
  // wieder offen: Entscheidung weg
  assert.equal(setStatus(a, 'gespraech', { date: '2026-11-06' }).decidedAt, '')
  assert.throws(() => setStatus(a, 'eingestellt', { date: TODAY }))
  assert.equal(lastActivity(applicant()), '2026-11-01')
  const b = addLog(applicant(), { kind: 'kontakt', date: '2026-11-04', text: 'angerufen' })
  assert.equal(lastActivity(b), '2026-11-04')
  assert.equal(b.log[0].kind, 'kontakt')
  // angelegt bzw. vermerkt um 0:30 Uhr in Wien (23:30 UTC am Vortag): der Tag in Wien zählt
  assert.equal(lastActivity(applicant({ createdAt: '2026-11-01T23:30:00.000Z', log: [] })), '2026-11-02')
  assert.equal(lastActivity(applicant({ createdAt: '2026-11-01T08:00:00Z', log: [{ at: '2026-11-03T23:30:00.000Z', kind: 'mail' }] })), '2026-11-04')
})

test('Ohne Rückmeldung: offene Bewerbungen nach mehr als 7 Tagen, am längsten zuerst; entschiedene nicht', () => {
  const list = [
    applicant({ id: 'a', name: 'A', createdAt: '2026-10-30T08:00:00Z' }), // 7 Tage: noch nicht
    applicant({ id: 'b', name: 'B', createdAt: '2026-10-29T08:00:00Z' }), // 8 Tage
    applicant({ id: 'c', name: 'C', createdAt: '2026-10-01T08:00:00Z', log: [{ date: '2026-10-20', kind: 'kontakt' }] }), // 17 Tage
    applicant({ id: 'd', name: 'D', createdAt: '2026-10-01T08:00:00Z', status: 'absage', decidedAt: '2026-10-02' }),
    applicant({ id: 'e', name: 'E', createdAt: '2026-10-01T08:00:00Z', status: 'zusage' }),
    applicant({ id: 'f', name: 'F', createdAt: '2026-10-01T08:00:00Z', log: [{ date: '2026-11-05', kind: 'kontakt' }] }),
  ]
  const s = silentApplicants(list, TODAY)
  assert.deepEqual(s.map((x) => [x.a.id, x.days, x.since]), [['c', 17, '2026-10-20'], ['b', 8, '2026-10-29']])
  assert.deepEqual(silentApplicants(list, TODAY, 14).map((x) => x.a.id), ['c'])
})

test('Löschfrist: 6 Monate nach Absage oder Rückzug (Monatsende), nur dann; Zusage nie', () => {
  assert.equal(deleteDue(applicant({ status: 'absage', decidedAt: '2026-05-06' })), '2026-11-06')
  assert.equal(deleteDue(applicant({ status: 'zurueck', decidedAt: '2026-08-31' })), '2027-02-28')
  assert.equal(deleteDue(applicant({ status: 'absage', decidedAt: '2026-05-06' }), 3), '2026-08-06')
  assert.equal(deleteDue(applicant({ status: 'zusage', decidedAt: '2026-01-01' })), '')
  assert.equal(deleteDue(applicant({ status: 'absage' })), '')
  const list = [applicant({ id: 'x', status: 'absage', decidedAt: '2026-05-06' }), applicant({ id: 'y', status: 'absage', decidedAt: '2026-05-07' }), applicant({ id: 'z', status: 'zurueck', decidedAt: '2026-01-10' })]
  assert.deepEqual(deletionsDue(list, TODAY).map((x) => [x.a.id, x.due]), [['z', '2026-07-10'], ['x', '2026-11-06']])
})

test('Prüfen vor dem Speichern', () => {
  assert.equal(applicantProblem(applicant()), '')
  assert.match(applicantProblem(applicant({ name: ' ' })), /Namen/)
  assert.match(applicantProblem(applicant({ email: 'kein-at' })), /E-Mail/)
  assert.equal(applicantProblem(applicant({ email: 'a@b.at' })), '')
  assert.match(applicantProblem(applicant({ source: 'zeitung' })), /Quelle/)
  assert.match(applicantProblem(applicant({ hours: 70 })), /Stunden/)
  assert.equal(applicantProblem(applicant({ hours: '' })), '')
  assert.match(applicantProblem(applicant({ availability: { 1: { from: '06:00' } } })), /Verfügbarkeit/)
  assert.equal(applicantProblem(applicant({ availability: { 1: { from: '06:00', to: '12:00' } } })), '')
})

test('Hinweis auf geschützte Merkmale (Gleichbehandlungsgesetz), ohne Fehlalarm bei Fachlichem', () => {
  assert.deepEqual(protectedHints('Ist 52 Jahre alt und trägt ein Kopftuch'), ['Alter', 'Religion'])
  assert.deepEqual(protectedHints('schwanger, verheiratet, zwei Kinder'), ['Schwangerschaft', 'Familienstand'])
  assert.deepEqual(protectedHints('Nationalität: …, Migrationshintergrund'), ['Herkunft'])
  assert.deepEqual(protectedHints('chronische Erkrankung'), ['Gesundheit'])
  for (const ok of ['Erfahrung im Kindergarten Aigen', 'Empfehlung von Christian', 'Deutsch gut, Führerschein B', '3 Jahre Erfahrung in der Unterhaltsreinigung', 'Frühdienst ab 5:30', 'Glasreinigung, Hygienebereich']) assert.deepEqual(protectedHints(ok), [], ok)
})

test('Stammblatt aus der Bewerbung: Name, E-Mail, Revier, Stunden, Beschäftigung, Verfügbarkeit, Sprache, Führerschein', () => {
  const a = applicant({ name: ' Mihai Ionescu ', email: 'Mihai@Example.com ', hours: 30.25, region: 'Flachgau', langs: ['ro', 'de'], license: true, start: '2026-11-16', availability: { 1: { from: '05:30', to: '14:00' } } })
  const e = employeeFrom(a, { skills: ['Glasreinigung', 'Führerschein'] })
  assert.deepEqual(e, { name: 'Mihai Ionescu', type: 'Teilzeit', weeklyHours: 30.5, skills: ['Führerschein'], trained: [], availability: { 1: { from: '05:30', to: '14:00' } }, email: 'mihai@example.com', team: 'Flachgau', entryDate: '2026-11-16' })
  assert.notEqual(e.availability, a.availability, 'Kopie, nicht dieselbe Verfügbarkeit')
  // ohne Deutsch: erste Sprache am Handy; ab 38 h Vollzeit; Führerschein nur, wenn es die Qualifikation gibt
  const f = employeeFrom(applicant({ hours: 40, langs: ['tr', 'en'], license: true }), { skills: [] })
  assert.equal(f.lang, 'tr')
  assert.equal(f.type, 'Vollzeit')
  assert.deepEqual(f.skills, [])
  assert.equal(employeeFrom(applicant({ hours: '' })).weeklyHours, 20)
  assert.equal(handyLang(applicant({ langs: [] })), 'de')
  assert.ok(LANGUAGES.some((l) => l.id === handyLang(applicant({ langs: ['bks'] }))))
})

test('Absage: neutrale Vorlage mit Platzhaltern, eigene Vorlage, ohne Begründung', () => {
  const m = rejectMail(applicant({ name: 'Petra Gruber' }), { firma: 'Cleanos', absender: 'Petra Leitner' })
  assert.equal(m.subject, 'Ihre Bewerbung bei Cleanos')
  assert.match(m.text, /^Guten Tag Petra Gruber,/)
  assert.match(m.text, /noch 6 Monate auf und löschen sie danach/)
  assert.match(m.text, /Petra Leitner\nCleanos$/)
  assert.deepEqual(protectedHints(DEFAULT_REJECT.text), [], 'Vorlage nennt keine geschützten Merkmale')
  const own = rejectMail(applicant({ name: 'X' }), { settings: { rejectSubject: 'Bewerbung {name}', rejectText: 'Hallo {name}, {unbekannt}' }, months: 3 })
  assert.deepEqual(own, { subject: 'Bewerbung X', text: 'Hallo X, {unbekannt}' })
  assert.equal(fillText('{a}{b}', { a: 1 }), '1{b}')
})

test('Löschen: Bewerbung weg, Unterlagen zum Löschen in SharePoint', () => {
  const list = [applicant({ id: 'a', docs: [{ path: 'bewerbung/unterlagen/a/cv.pdf' }, { path: 'bewerbung/unterlagen/a/z.jpg' }] }), applicant({ id: 'b' })]
  const r = removeApplicant(list, 'a')
  assert.deepEqual(r.applicants.map((x) => x.id), ['b'])
  assert.deepEqual(r.files, ['bewerbung/unterlagen/a/cv.pdf', 'bewerbung/unterlagen/a/z.jpg'])
  assert.deepEqual(removeApplicant(list, 'nix').files, [])
})

test('Filter und Kacheln der Bewerbungen', () => {
  const list = [
    applicant({ id: 'a', name: 'Anna', status: 'neu', region: 'Flachgau', source: 'ams', createdAt: `${TODAY}T08:00:00Z` }),
    applicant({ id: 'b', name: 'Berta', status: 'gespraech', phone: '0660 123', createdAt: `${TODAY}T08:00:00Z` }),
    applicant({ id: 'c', name: 'Carl', status: 'zusage' }),
    applicant({ id: 'd', name: 'Dora', status: 'absage', decidedAt: '2026-01-02' }),
    applicant({ id: 'e', name: 'Emil', status: 'kontakt', createdAt: '2026-10-01T08:00:00Z' }),
  ]
  assert.deepEqual(filterApplicants(list).map((a) => a.id), ['b', 'e', 'a'], 'offen: weiter fortgeschritten zuerst')
  assert.deepEqual(filterApplicants(list, { status: 'alle' }).length, 5)
  assert.deepEqual(filterApplicants(list, { status: 'absage' }).map((a) => a.id), ['d'])
  assert.deepEqual(filterApplicants(list, { source: 'ams' }).map((a) => a.id), ['a'])
  assert.deepEqual(filterApplicants(list, { region: 'Flachgau' }).map((a) => a.id), ['a'])
  assert.deepEqual(filterApplicants(list, { q: '0660' }).map((a) => a.id), ['b'])
  assert.deepEqual(applicantCounts(list, TODAY), { offen: 3, still: 1, gespraech: 1, zusage: 1, loeschen: 1 })
})

test('Vorlagen: Eintritt mit Anmeldung ÖGK vor Arbeitsbeginn, Austritt mit Abmeldung; alle Arten bekannt', () => {
  const ids = (l) => l.map((t) => t.type)
  for (const t of ['oegk', 'vertrag', 'lohn', 'unterweisung', 'arbeitsschutz', 'schluessel', 'kleidung', 'einschulung', 'handy', 'sprache']) assert.ok(ids(EINTRITT_DEFAULTS).includes(t), t)
  for (const t of ['schluessel-rueck', 'kleidung-rueck', 'oegk-ab', 'zeitkonto', 'handy-aus', 'einsaetze', 'zeugnis']) assert.ok(ids(AUSTRITT_DEFAULTS).includes(t), t)
  for (const t of [...EINTRITT_DEFAULTS, ...AUSTRITT_DEFAULTS]) assert.ok(TASK_TYPES[t.type] && t.title && Number.isInteger(t.offset), t.id)
  assert.equal(EINTRITT_DEFAULTS.find((t) => t.type === 'oegk').offset, -1, 'vor dem ersten Arbeitstag')
  assert.equal(AUSTRITT_DEFAULTS.find((t) => t.type === 'oegk-ab').offset, 7)
  assert.equal(new Set([...EINTRITT_DEFAULTS, ...AUSTRITT_DEFAULTS].map((t) => t.id)).size, EINTRITT_DEFAULTS.length + AUSTRITT_DEFAULTS.length)
  assert.equal(templateOf(null, 'eintritt'), EINTRITT_DEFAULTS)
  assert.equal(templateOf({ templates: {} }, 'austritt'), AUSTRITT_DEFAULTS)
  const own = [{ id: 'z', type: 'frei', title: 'Eigenes', offset: 2 }]
  assert.equal(templateOf({ templates: { eintritt: own } }, 'eintritt'), own)
})

test('Checkliste starten: Fristen ab dem Tag, inaktive fehlen; Datum ändern, Aufgabe ergänzen, erledigt, Fortschritt', () => {
  const template = [
    { id: 't1', type: 'oegk', title: 'Anmeldung', offset: -1 },
    { id: 't2', type: 'vertrag', title: 'Vertrag', offset: 0 },
    { id: 't3', type: 'frei', title: 'Aus', offset: 3, active: false },
    { id: 't4', type: 'gibtsnicht', title: 'Unbekannt', offset: 5 },
  ]
  const l = startList({ kind: 'eintritt', empId: 'e1', date: '2026-11-16', template, newId, at: 'T', by: 'Petra' })
  assert.equal(l.kind, 'eintritt')
  assert.deepEqual(l.tasks.map((t) => [t.id, t.type, t.due, t.done]), [['t1', 'oegk', '2026-11-15', null], ['t2', 'vertrag', '2026-11-16', null], ['t4', 'frei', '2026-11-21', null]])
  assert.equal(startList({ kind: 'x', empId: 'e1', date: TODAY, template: [], newId }).kind, 'eintritt')
  // erledigt bleibt beim Verschieben, offene wandern mit
  const done = { ...l, tasks: l.tasks.map((t) => (t.id === 't2' ? markDone(t, { date: TODAY, by: 'Petra', at: 'A' }) : t)) }
  assert.deepEqual(done.tasks[1].done, { date: TODAY, by: 'Petra', at: 'A' })
  const moved = moveList(done, '2026-11-23')
  assert.deepEqual(moved.tasks.map((t) => t.due), ['2026-11-22', '2026-11-16', '2026-11-28'])
  const added = addTask(moved, { title: ' Arbeitserlaubnis ', due: '2026-11-20', newId })
  assert.deepEqual([added.tasks.at(-1).title, added.tasks.at(-1).offset, added.tasks.at(-1).type], ['Arbeitserlaubnis', -3, 'frei'])
  assert.deepEqual(progress(added), { done: 1, total: 4, pct: 25 })
  assert.equal(nextTask(added).title, 'Arbeitserlaubnis')
  assert.equal(markOpen(done.tasks[1]).done, null)
  // Zustand: überfällig vor heute, fällig bis 3 Tage, sonst offen
  assert.equal(taskState({ due: '2026-11-05' }, TODAY), 'ueberfaellig')
  assert.equal(taskState({ due: '2026-11-09' }, TODAY), 'faellig')
  assert.equal(taskState({ due: '2026-11-10' }, TODAY), 'offen')
  assert.equal(taskState({ due: '2026-11-01', done: { date: TODAY } }, TODAY), 'erledigt')
  assert.equal(taskState({ due: '2026-11-01' }, TODAY, { done: true }), 'erledigt')
})

// ---------------------------------------------------------------- Verknüpfungen

const emp = { id: 'e1', name: 'Neu Person', skills: ['Führerschein'], entryDate: '2026-11-09' }
const trainings = {
  types: [],
  records: [
    { id: 'r1', empId: 'e1', typeId: 'sicherheit', date: '2026-11-04', by: 'Petra', at: '1' },
    { id: 'r2', empId: 'e1', typeId: 'chemie', date: '2026-11-05', by: 'Paul', at: '2' },
  ],
  sessions: [],
}
const key = (id, objectId) => ({ id, objectId, label: `Schlüssel ${id}`, status: 'aktiv', holderId: '', history: [] })

test('Unterweisungen verknüpft: alle Pflicht-Unterweisungen (auch über Qualifikation) gültig eingetragen', () => {
  const r = trainingCheck(trainings, emp, TODAY)
  // Pflicht: Sicherheit, Reinigungsmittel (alle) und Führerscheinkontrolle (Qualifikation Führerschein)
  assert.deepEqual(r.required.map((x) => [x.type.id, x.state]), [['sicherheit', 'ok'], ['chemie', 'ok'], ['fuehrerschein', 'fehlt']])
  assert.equal(r.ok, false)
  const ok = trainingCheck(trainings, { ...emp, skills: [] }, TODAY)
  assert.deepEqual([ok.ok, ok.date, ok.by], [true, '2026-11-05', 'Paul'])
  assert.equal(trainingCheck(null, emp, TODAY), null)
  const list = startList({ kind: 'eintritt', empId: 'e1', date: '2026-11-09', template: EINTRITT_DEFAULTS, newId })
  const task = list.tasks.find((t) => t.type === 'unterweisung')
  const ctx = linkContext({ employees: [{ ...emp, skills: [] }], unterweisungen: trainings }, { today: TODAY, can: { trainings: true } })
  assert.deepEqual(linkedOf(task, list, ctx), { done: true, date: '2026-11-05', by: 'Paul', text: '2 Pflicht-Unterweisungen eingetragen' })
  const missing = linkedOf(task, list, linkContext({ employees: [emp], unterweisungen: trainings }, { today: TODAY, can: { trainings: true } }))
  assert.deepEqual(missing, { done: false, text: 'fehlt: Führerscheinkontrolle' })
  // ohne Leserecht: keine Verknüpfung
  assert.equal(linkedOf(task, list, linkContext({ employees: [emp], unterweisungen: trainings }, { today: TODAY, can: {} })), null)
})

test('Schlüssel verknüpft: Ausgabe (mit Unterschrift) erledigt die Eintrittsaufgabe; Austritt erst, wenn alle zurück sind', () => {
  const k1 = handOver(key('k1', 'o5'), { to: 'e1', date: '2026-11-07', by: 'Petra', signature: '<svg/>', at: 'A' })
  const k2 = key('k2', 'o5')
  assert.deepEqual(keyCheck([k1, k2], 'e1'), { held: [k1], ok: true, date: '2026-11-07', by: 'Petra', signed: true })
  assert.equal(keyCheck(null, 'e1'), null)
  const ein = startList({ kind: 'eintritt', empId: 'e1', date: '2026-11-09', template: EINTRITT_DEFAULTS, newId })
  const aus = startList({ kind: 'austritt', empId: 'e1', date: '2026-11-30', template: AUSTRITT_DEFAULTS, newId })
  const give = ein.tasks.find((t) => t.type === 'schluessel')
  const back = aus.tasks.find((t) => t.type === 'schluessel-rueck')
  const ctx = (keys) => linkContext({ employees: [emp], schluessel: { keys } }, { today: TODAY, can: { keys: true } })
  assert.deepEqual(linkedOf(give, ein, ctx([k1])), { done: true, date: '2026-11-07', by: 'Petra', text: '1 Schlüssel ausgegeben (mit Unterschrift)' })
  assert.deepEqual(linkedOf(give, ein, ctx([k2])), { done: false, text: 'noch kein Schlüssel ausgegeben' })
  assert.deepEqual(linkedOf(back, aus, ctx([k1])), { done: false, text: '1 Schlüssel noch offen' })
  assert.equal(linkedOf(back, aus, ctx([k2])).done, true)
  // Schlüsselbuch nicht lesbar: „keine offen“ darf nicht von selbst gelten
  assert.equal(linkedOf(back, aus, linkContext({ employees: [emp], schluessel: { keys: [] } }, { today: TODAY, can: {} })), null)
})

test('Austritt: Einsätze nach dem letzten Arbeitstag und Stammkraft verknüpft; Link Plan am Handy', () => {
  const aus = startList({ kind: 'austritt', empId: 'e1', date: '2026-11-30', template: AUSTRITT_DEFAULTS, newId })
  const work = aus.tasks.find((t) => t.type === 'einsaetze')
  const off = aus.tasks.find((t) => t.type === 'handy-aus')
  const assignments = { '2026-11-30|t1': [{ employeeId: 'e1' }], '2026-12-01|t1': [{ employeeId: 'e1' }], '2026-12-03|t2': [{ employeeId: 'e2' }], '2026-12-02|winter-o5': [{ employeeId: 'e1' }] }
  const planTasks = [{ id: 't1', objectId: 'o1', regulars: ['e1'] }, { id: 't2', objectId: 'o2', regulars: ['e2'] }]
  const r = futureWork({ assignments, planTasks, empId: 'e1', after: '2026-11-30' })
  assert.deepEqual(r.shifts.map((s) => [s.date, s.taskId]), [['2026-12-01', 't1'], ['2026-12-02', 'winter-o5']])
  assert.deepEqual(r.regular.map((t) => t.id), ['t1'])
  assert.equal(futureWork({ assignments: null, planTasks, empId: 'e1', after: '2026-11-30' }), null)
  const ctx = (a, t, codes) => linkContext({ employees: [emp], assignments: a, tasks: t, rules: { portal: { codes } } }, { today: TODAY, can: { plans: true, portal: true } })
  assert.deepEqual(linkedOf(work, aus, ctx(assignments, planTasks, {})), { done: false, text: '2 Einsätze nach dem Austritt, Stammkraft in 1 Leistung' })
  assert.equal(linkedOf(work, aus, ctx({}, [], {})).done, true)
  assert.deepEqual(linkedOf(off, aus, ctx({}, [], { e1: 'CODE' })), { done: false, text: 'Link noch gültig' })
  assert.equal(linkedOf(off, aus, ctx({}, [], {})).done, true)
  // Person gibt es nicht mehr, Aufgabe ohne Verknüpfung
  assert.equal(linkedOf(work, { ...aus, empId: 'weg' }, ctx({}, [], {})), null)
  assert.equal(linkedOf(aus.tasks.find((t) => t.type === 'zeugnis'), aus, ctx({}, [], {})), null)
})

test('Fristen für „Zu erledigen“: offene Aufgaben bis 7 Tage voraus, überfällige zuerst, verknüpft erledigte und abgeschlossene Listen nicht', () => {
  const employees = [emp, { id: 'e2', name: 'Alt Person' }]
  const ein = startList({ kind: 'eintritt', empId: 'e1', date: '2026-11-09', template: EINTRITT_DEFAULTS, newId })
  const aus = startList({ kind: 'austritt', empId: 'e2', date: '2026-11-02', template: AUSTRITT_DEFAULTS, newId })
  const later = startList({ kind: 'eintritt', empId: 'e2', date: '2026-12-15', template: EINTRITT_DEFAULTS, newId })
  const closed = { ...startList({ kind: 'eintritt', empId: 'e2', date: '2026-11-01', template: EINTRITT_DEFAULTS, newId }), closedAt: 'X' }
  ein.tasks = ein.tasks.map((t) => (t.type === 'vertrag' ? markDone(t, { date: TODAY }) : t))
  const ctx = linkContext({ employees, unterweisungen: trainings, schluessel: { keys: [] } }, { today: TODAY, can: { trainings: true, keys: true } })
  const att = checklistAttention([later, ein, closed, aus], ctx)
  assert.deepEqual(att.map((g) => [g.list.kind, g.emp.name, g.urgent]), [['austritt', 'Alt Person', true], ['eintritt', 'Neu Person', false]])
  // Austritt am 2.11.: Einsätze und Zeitkonto (−7) überfällig, Schlüssel zurück verknüpft (keine offen), Link/ÖGK/Zeugnis noch nicht fällig bzw. bis 13.11.
  assert.deepEqual(att[0].tasks.map((x) => [x.task.type, x.state]), [['einsaetze', 'ueberfaellig'], ['zeitkonto', 'ueberfaellig'], ['kleidung-rueck', 'ueberfaellig'], ['handy-aus', 'ueberfaellig'], ['oegk-ab', 'faellig']])
  const types = att[1].tasks.map((x) => x.task.type)
  assert.ok(types.includes('oegk') && types.includes('schluessel') && !types.includes('vertrag'), types.join())
  assert.ok(att[1].tasks.every((x) => x.state === 'faellig' || x.state === 'offen'))
  // ohne Vorlauf nur, was heute fällig ist (Lohnverrechnung 3 Tage vor dem Eintritt)
  assert.deepEqual(checklistAttention([ein], ctx, { lead: 0 })[0].tasks.map((x) => [x.task.type, x.state]), [['lohn', 'faellig']])
})

test('Lohnverrechnung: fehlende Angaben im Stammblatt, Text ohne Sozialversicherungs- und Bankdaten', () => {
  assert.deepEqual(payrollGaps({ name: 'X', weeklyHours: 0 }), ['Personalnummer', 'Eintritt', 'Wochenstunden', 'Lohngruppe oder Stundenlohn'])
  assert.deepEqual(payrollGaps({ personnelNo: '1', entryDate: TODAY, weeklyHours: 20, wageGroup: 6 }), [])
  assert.deepEqual(payrollGaps(null), [])
  // Lohn nicht lesbar (Personalverwaltung ohne Zeitkonto): Lohngruppe nicht als fehlend melden
  assert.deepEqual(payrollGaps({ personnelNo: '1', entryDate: TODAY, weeklyHours: 20 }, { wage: false }), [])
  const t = payrollText({ name: 'Neu Person', personnelNo: '1234', type: 'Teilzeit', weeklyHours: 20.5, team: 'Flachgau' }, { date: '09.11.2026', firma: 'Cleanos', absender: 'Petra', wage: 'Lohngruppe 6' })
  assert.match(t, /Neueintritt zur Anmeldung/)
  assert.match(t, /Personalnummer: 1234\nEintritt \(erster Arbeitstag\): 09\.11\.2026\nBeschäftigung: Teilzeit, 20,5 Wochenstunden\nLohngruppe 6\nRevier: Flachgau/)
  assert.match(t, /Sozialversicherungsnummer, Adresse und Bankverbindung schicken wir getrennt/)
  assert.match(payrollText({ name: 'X', weeklyHours: 10 }, { kind: 'austritt', date: '30.11.2026' }), /Austritt \(letzter Arbeitstag\): 30\.11\.2026/)
})

test('Beispieldaten: erfunden, eine ohne Rückmeldung, eine mit Löschfrist, eine Zusage, keine geschützten Merkmale', () => {
  const demo = createBewerberDemo(TODAY)
  const list = demo.bewerbung.applicants
  assert.equal(list.length, 6)
  assert.deepEqual(applicantCounts(list, TODAY), { offen: 3, still: 1, gespraech: 1, zusage: 1, loeschen: 1 })
  for (const a of list) {
    assert.equal(applicantProblem(a), '', a.name)
    assert.deepEqual(protectedHints(`${a.notes} ${a.sourceNote}`), [], a.name)
    assert.ok(!a.email || a.email.endsWith('@example.com'), a.email)
  }
  assert.deepEqual(demo.eintritt.lists, [])
})
