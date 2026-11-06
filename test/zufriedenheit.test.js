// Kundenzufriedenheit (core/zufriedenheit.js): Quartale, Fragen und Vorgaben, Teilnahme je Rhythmus, Runde und was der
// Webspace bekommt, Antworten vom Webspace (geprüft und begrenzt), Durchschnitt je Frage, NPS, Rücklauf, Verlauf,
// fallender Verlauf, „Kunde anrufen“, Bereich der Person (Reviere), Einladung per E-Mail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_DOCS } from '../src/storage/data-service.js'
import {
  answerFromServer,
  answerObjects,
  attention,
  customerRows,
  defaultUntil,
  dueLinks,
  emptyZufriedenheit,
  fmtAvg,
  fmtNps,
  fmtRate,
  history,
  inScope,
  inviteBlocked,
  inviteMail,
  isFalling,
  isOpen,
  ITEMS_MAX,
  needsCall,
  newQuestionId,
  newRound,
  newServerAnswers,
  normalizeQuestions,
  npsGroup,
  npsOf,
  objectRows,
  openCalls,
  periodLabel,
  periodOf,
  periodRange,
  periodShort,
  QUESTION_DEFAULTS,
  QUESTION_ID,
  questionsProblem,
  responseOf,
  rhythmOf,
  roundProblem,
  roundsPayload,
  roundState,
  scopeObjectIds,
  settingsOf,
  summarize,
} from '../src/core/zufriedenheit.js'

const link = (id, objectIds, extra = {}) => ({ id, title: `Kunde ${id}`, objectIds, token: `T${id}`, ...extra })
const answer = (id, roundId, linkId, overall, extra = {}) => ({ id: `kz${id}`, serverId: id, roundId, linkId, linkTitle: `Kunde ${linkId}`, objectIds: extra.objectIds || ['o1'], objectId: '', at: `${roundId.slice(0, 4)}-0${Number(roundId.slice(6)) * 3}-10T10:00:00.000Z`, overall, scores: {}, nps: null, comment: '', callback: false, done: null, ...extra })

test('Leerer Inhalt wie in data-service.js (MODULE_DOCS)', () => {
  assert.deepEqual(MODULE_DOCS.zufriedenheit.empty(), emptyZufriedenheit())
})

test('Quartale: Kennung, Zeitraum, Beschriftung', () => {
  assert.equal(periodOf('2026-11-06'), '2026-Q4')
  assert.equal(periodOf('2026-01-01'), '2026-Q1')
  assert.equal(periodOf('2026-03-31'), '2026-Q1')
  assert.equal(periodOf('2026-04-01'), '2026-Q2')
  assert.deepEqual(periodRange('2026-Q1'), { from: '2026-01-01', to: '2026-03-31' })
  assert.deepEqual(periodRange('2028-Q1'), { from: '2028-01-01', to: '2028-03-31' })
  assert.deepEqual(periodRange('2026-Q4'), { from: '2026-10-01', to: '2026-12-31' })
  assert.equal(periodLabel('2026-Q4'), '4. Quartal 2026')
  assert.equal(periodShort('2026-Q4'), 'Q4/26')
})

test('Fragen: Vorgaben, Prüfung, höchstens fünf Einzelfragen, Kennungen', () => {
  assert.deepEqual(normalizeQuestions(null), QUESTION_DEFAULTS)
  assert.equal(QUESTION_DEFAULTS.items.length, 4)
  const q = normalizeQuestions({ overall: '  Wie zufrieden?  ', items: [{ id: 'a1', text: 'Eins' }, { id: 'a1', text: 'doppelt' }, { id: 'X!', text: 'falsch' }, { id: 'b2', text: '' }, { id: 'c3', text: 'Drei' }], nps: '', comment: 'x'.repeat(300) })
  assert.equal(q.overall, 'Wie zufrieden?')
  assert.deepEqual(q.items, [{ id: 'a1', text: 'Eins' }, { id: 'c3', text: 'Drei' }])
  assert.equal(q.nps, QUESTION_DEFAULTS.nps)
  assert.equal(q.comment.length, 160)
  const many = normalizeQuestions({ items: Array.from({ length: 8 }, (_, i) => ({ id: `q${i}x`, text: `Frage ${i}` })) })
  assert.equal(many.items.length, ITEMS_MAX)
  assert.match(questionsProblem({ overall: 'a', items: [{ text: 'x' }, { text: 'y' }], nps: 'b' }), /3 bis 5 Einzelfragen \(jetzt 2\)/)
  assert.match(questionsProblem({ overall: 'a', items: Array.from({ length: 6 }, () => ({ text: 'x' })), nps: 'b' }), /jetzt 6/)
  assert.equal(questionsProblem(QUESTION_DEFAULTS), '')
  assert.match(questionsProblem({ ...QUESTION_DEFAULTS, overall: ' ' }), /Gesamtzufriedenheit/)
  for (let i = 0; i < 20; i++) assert.match(newQuestionId(), QUESTION_ID)
})

test('Einstellungen: Rhythmus aus (Vorgabe), Laufzeit 7–90 Tage, Einladung mit Vorgabe', () => {
  const s = settingsOf(emptyZufriedenheit())
  assert.equal(s.rhythm, 'aus')
  assert.equal(s.days, 28)
  assert.match(s.invite.text, /\{link\}/)
  assert.equal(settingsOf({ settings: { rhythm: 'halbjahr', days: 500 } }).days, 28)
  assert.equal(settingsOf({ settings: { rhythm: 'unsinn', days: '14' } }).rhythm, 'aus')
  assert.equal(settingsOf({ settings: { days: '14' } }).days, 14)
  assert.equal(defaultUntil('2026-11-06', 28), '2026-12-03')
})

test('Teilnahme: vierteljährlich jede Runde, halbjährlich jede zweite, aus nie, gesperrte Links nie', () => {
  const doc = { settings: { rhythm: 'quartal' }, links: { b: { rhythm: 'halbjahr' }, c: { rhythm: 'aus' } }, rounds: [], answers: [] }
  const links = [link('a', ['o1']), link('b', ['o2']), link('c', ['o3']), link('d', ['o4'], { revokedAt: '2026-01-01' }), link('e', ['o5'], { token: '' })]
  assert.deepEqual(dueLinks({ doc, links, period: '2026-Q4' }).map((l) => l.id), ['a', 'b'])
  assert.equal(rhythmOf(doc, 'a'), 'quartal')
  assert.equal(rhythmOf(doc, 'b'), 'halbjahr')
  // b war im 3. Quartal dabei: im 4. nicht, im 1. des nächsten Jahres wieder
  doc.rounds.push(newRound({ period: '2026-Q3', from: '2026-07-01', until: '2026-07-28', links: [links[0], links[1]] }))
  assert.deepEqual(dueLinks({ doc, links, period: '2026-Q4' }).map((l) => l.id), ['a'])
  assert.deepEqual(dueLinks({ doc, links, period: '2027-Q1' }).map((l) => l.id), ['a', 'b'])
  // Vorgabe aus: nur Links mit eigenem Rhythmus
  doc.settings.rhythm = 'aus'
  assert.deepEqual(dueLinks({ doc, links, period: '2027-Q1' }).map((l) => l.id), ['b'])
})

test('Runde: Fragen eingefroren, offen nur zwischen Beginn und Ende, was der Webspace bekommt', () => {
  const r = newRound({ period: '2026-Q4', from: '2026-11-06', until: '2026-12-03', questions: { items: [{ id: 'aa', text: 'A' }, { id: 'bb', text: 'B' }, { id: 'cc', text: 'C' }] }, links: [link('a', ['o1', 'o2'])], by: 'Petra' })
  assert.equal(r.id, '2026-Q4')
  assert.deepEqual(r.links, [{ id: 'a', title: 'Kunde a', objectIds: ['o1', 'o2'] }])
  assert.equal(r.questions.items.length, 3)
  assert.ok(isOpen(r, '2026-11-06') && isOpen(r, '2026-12-03') && !isOpen(r, '2026-12-04') && !isOpen(r, '2026-11-05'))
  assert.equal(roundState(r, '2026-11-01'), 'geplant')
  assert.equal(roundState(r, '2026-11-20'), 'offen')
  assert.equal(roundState(r, '2026-12-04'), 'beendet')
  const doc = { rounds: [r, { ...newRound({ period: '2026-Q3', from: '2026-07-01', until: '2026-07-28', links: [link('a', ['o1'])] }) }] }
  const p = roundsPayload(doc, '2026-11-10')
  assert.deepEqual(p, [{ id: '2026-Q4', von: '2026-11-06', bis: '2026-12-03', fragen: { gesamt: QUESTION_DEFAULTS.overall, einzeln: [{ id: 'aa', text: 'A' }, { id: 'bb', text: 'B' }, { id: 'cc', text: 'C' }], nps: QUESTION_DEFAULTS.nps, freitext: QUESTION_DEFAULTS.comment }, links: ['a'] }])
  // geschlossen: nicht mehr am Webspace
  r.closedAt = '2026-11-20T10:00:00Z'
  assert.equal(roundState(r, '2026-11-21'), 'beendet')
  assert.deepEqual(roundsPayload(doc, '2026-11-21'), [])
  assert.equal(roundProblem({ period: '2026-Q4', from: '2026-11-06', until: '2026-11-01', links: [1] }, '2026-11-06'), 'Das Ende liegt vor dem Beginn.')
  assert.equal(roundProblem({ period: '2026-Q4', from: '2026-11-06', until: '2027-03-01', links: [1] }, '2026-11-06'), 'Eine Runde dauert höchstens 90 Tage.')
  assert.equal(roundProblem({ period: '2026-Q4', from: '2026-11-06', until: '2026-12-01', links: [] }, '2026-11-06'), 'Bitte mindestens einen Link wählen.')
  assert.equal(roundProblem({ period: '2026-Q4', from: '2026-11-06', until: '2026-12-01', links: [1] }, '2026-11-06'), '')
})

test('Antworten vom Webspace: nur neue, Werte geprüft und begrenzt, Objekte aus der Runde', () => {
  const round = newRound({ period: '2026-Q4', from: '2026-11-01', until: '2026-11-30', links: [link('kb00000000a1', ['o1', 'o2'])] })
  const doc = { answers: [{ serverId: 'aaaaaaaaaaaa' }] }
  const list = [
    { id: 'aaaaaaaaaaaa', runde: '2026-Q4', link: 'kb00000000a1' },
    { id: 'bbbbbbbbbbbb', runde: '2026-Q4', link: 'kb00000000a1', uebernommen: 1 },
    { id: 'zz', runde: '2026-Q4' },
    { id: 'cccccccccccc', runde: 'Q4', link: 'kb00000000a1' },
    { id: 'dddddddddddd', runde: '2026-Q4', link: 'kb00000000a1', zeit: 1793000000, gesamt: 2, werte: { sauberkeit: 1, zuverlaessig: '4', personal: 9, fremd: 5 }, nps: '6', text: ' Stiegenhaus\u0007 nicht gewischt ', rueckruf: true, telefon: '0662 123', name: 'Maria Huber', funktion: 'Hausverwaltung', objekt: { nr: 2, id: 'o2', name: 'Lehen' } },
  ]
  const fresh = newServerAnswers(list, doc)
  assert.deepEqual(fresh.map((e) => e.id), ['dddddddddddd'])
  const a = answerFromServer(fresh[0], { round, by: 'Büro', now: '2026-11-06T10:00:00.000Z' })
  assert.equal(a.id, 'kzdddddddddddd')
  assert.equal(a.linkTitle, 'Kunde kb00000000a1')
  assert.deepEqual(a.objectIds, ['o1', 'o2'])
  assert.equal(a.objectId, 'o2')
  assert.deepEqual(answerObjects(a), ['o2'])
  assert.equal(a.overall, 2)
  assert.deepEqual(a.scores, { sauberkeit: 1, zuverlaessig: 4 })
  assert.equal(a.nps, 6)
  assert.equal(a.comment, 'Stiegenhaus nicht gewischt')
  assert.ok(a.callback && a.phone === '0662 123' && a.name === 'Maria Huber' && a.role === 'Hausverwaltung')
  assert.equal(a.at, new Date(1793000000 * 1000).toISOString())
  assert.ok(needsCall(a))
  // fremdes Objekt: zählt für alle Objekte des Links
  const b = answerFromServer({ ...fresh[0], id: 'eeeeeeeeeeee', objekt: { id: 'o9' }, gesamt: 7, nps: 11 }, { round })
  assert.equal(b.objectId, '')
  assert.deepEqual(answerObjects(b), ['o1', 'o2'])
  assert.equal(b.overall, 3)
  assert.equal(b.nps, null)
})

test('NPS: Promotoren minus Kritiker, gerundet; ohne Werte null', () => {
  assert.equal(npsOf([]), null)
  assert.equal(npsOf([null, undefined]), null)
  assert.deepEqual(npsOf([10, 9, 8, 7, 6, 0]), { score: 0, promoters: 2, passives: 2, detractors: 2, n: 6 })
  assert.equal(npsOf([10, 10, 9]).score, 100)
  assert.equal(npsOf([1, 5, 6]).score, -100)
  assert.equal(npsOf([10, 9, 8]).score, 67)
  assert.equal(npsGroup(9), 'Promotor')
  assert.equal(npsGroup(7), 'passiv')
  assert.equal(npsGroup(6), 'Kritiker')
  assert.equal(fmtNps(40), '+40')
  assert.equal(fmtNps(-10), '−10')
  assert.equal(fmtNps(0), '0')
  assert.equal(fmtNps(null), '–')
  assert.equal(fmtAvg(4.25), '4,3')
  assert.equal(fmtAvg(4), '4,0')
  assert.equal(fmtRate(2 / 3), '67 %')
})

test('Auswertung: Durchschnitt gesamt und je Frage, NPS, Rückrufe, Freitexte, Rücklauf', () => {
  const list = [
    answer('a', '2026-Q4', 'l1', 5, { scores: { sauberkeit: 5, personal: 4 }, nps: 10, comment: 'Alles bestens' }),
    answer('b', '2026-Q4', 'l2', 2, { scores: { sauberkeit: 1, personal: 3 }, nps: 3, callback: true, at: '2026-11-20T10:00:00.000Z', comment: 'Stiege schmutzig' }),
    answer('c', '2026-Q4', 'l3', 4, { scores: { sauberkeit: 4, alt: 2 }, nps: 8 }),
  ]
  const s = summarize(list, null)
  assert.equal(s.count, 3)
  assert.equal(s.overall, 3.67)
  assert.deepEqual(s.items.map((x) => [x.id, x.avg, x.n]), [['sauberkeit', 3.33, 3], ['zuverlaessig', null, 0], ['personal', 3.5, 2], ['buero', null, 0], ['alt', 2, 1]])
  assert.equal(s.nps.score, 0)
  assert.equal(s.callbacks, 1)
  assert.deepEqual(s.comments.map((a) => a.comment), ['Stiege schmutzig', 'Alles bestens'])
  const round = newRound({ period: '2026-Q4', from: '2026-11-01', until: '2026-11-28', links: [link('l1', ['o1']), link('l2', ['o2']), link('l3', ['o1']), link('l4', ['o3']), link('l5', ['o3'])] })
  assert.deepEqual(responseOf(round, list), { invited: 5, answered: 3, rate: 0.6 })
  assert.deepEqual(responseOf(round, list, new Set(['o3'])), { invited: 2, answered: 0, rate: 0 })
})

test('Verlauf und fallender Verlauf: je Runde, je Kunde, je Objekt', () => {
  assert.ok(!isFalling([4]))
  assert.ok(isFalling([5, 4]))
  assert.ok(!isFalling([5, 4.5]))
  assert.ok(isFalling([4.5, 4.2, 3.9]))
  assert.ok(!isFalling([4.5, 4.4, 4.3]))
  assert.ok(isFalling([5, null, 4]))
  assert.ok(!isFalling([3, 4, 5]))
  const rounds = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'].map((p, i) => newRound({ period: p, from: periodRange(p).from, until: periodRange(p).to, links: [link('l1', ['o1']), link('l2', ['o2', 'o3'])] }))
  const doc = {
    rounds,
    answers: [
      answer('1', '2026-Q1', 'l1', 5, { nps: 10 }),
      answer('2', '2026-Q2', 'l1', 4, { nps: 9 }),
      answer('3', '2026-Q3', 'l1', 3, { nps: 7 }),
      answer('4', '2026-Q4', 'l1', 2, { nps: 4, callback: true }),
      answer('5', '2026-Q3', 'l2', 4, { objectIds: ['o2', 'o3'], objectId: 'o3' }),
      answer('6', '2026-Q4', 'l2', 5, { objectIds: ['o2', 'o3'] }),
    ],
  }
  const h = history(doc, { today: '2026-11-06' })
  assert.deepEqual(h.map((x) => [x.period, x.count, x.overall, x.nps, x.invited, x.answered]), [
    ['2026-Q1', 1, 5, 100, 2, 1],
    ['2026-Q2', 1, 4, 100, 2, 1],
    ['2026-Q3', 2, 3.5, 0, 2, 2],
    ['2026-Q4', 2, 3.5, -100, 2, 2],
  ])
  const kunden = customerRows(doc, { today: '2026-11-06' })
  assert.deepEqual(kunden.map((r) => [r.linkId, r.count, r.last.overall, r.prev.overall, r.falling, r.calls]), [['l1', 4, 2, 3, true, 1], ['l2', 2, 5, 4, false, 0]])
  const objekte = objectRows(doc, { today: '2026-11-06', objects: [{ id: 'o1', name: 'Kanzlei' }, { id: 'o2', name: 'Lehen' }, { id: 'o3', name: 'Itzling' }] })
  assert.deepEqual(objekte.map((r) => [r.objectId, r.count, r.last?.overall ?? null]), [['o3', 2, 5], ['o1', 4, 2], ['o2', 1, 5]])
  // Bereich: nur Objekt o3 → nur Kunde l2 und nur seine Antworten
  const scope = new Set(['o3'])
  assert.deepEqual(customerRows(doc, { today: '2026-11-06', scope }).map((r) => r.linkId), ['l2'])
  assert.deepEqual(objectRows(doc, { today: '2026-11-06', scope, objects: [] }).map((r) => r.objectId), ['o3'])
  assert.ok(inScope(doc.answers[4], scope) && !inScope(doc.answers[0], scope))
})

test('Handlungsbedarf: anrufen (Gesamt ≤ 2 oder Rückruf, nicht erledigt), fallend, Runde öffnen', () => {
  const links = [link('l1', ['o1']), link('l2', ['o2'])]
  const doc = { settings: { rhythm: 'quartal' }, links: {}, rounds: [newRound({ period: '2026-Q3', from: '2026-07-01', until: '2026-07-28', links })], answers: [answer('1', '2026-Q3', 'l1', 3, { callback: true }), answer('2', '2026-Q3', 'l2', 2, { objectIds: ['o2'] }), answer('3', '2026-Q3', 'l2', 4, { objectIds: ['o2'], done: { at: 'x', by: 'y', note: '' }, overall: 1 })] }
  assert.deepEqual(openCalls(doc.answers).map((a) => a.serverId), ['1', '2'])
  let at = attention({ doc, today: '2026-11-06', links })
  assert.equal(at.calls.length, 2)
  assert.deepEqual(at.openRound, { period: '2026-Q4', count: 2 })
  // ohne Links des Kundenbereichs (Rolle ohne Kundenbereich): kein Vorschlag „Runde öffnen“
  assert.equal(attention({ doc, today: '2026-11-06' }).openRound, null)
  // Runde des Quartals schon da: kein Vorschlag mehr
  doc.rounds.push(newRound({ period: '2026-Q4', from: '2026-11-06', until: '2026-12-03', links }))
  at = attention({ doc, today: '2026-11-06', links })
  assert.equal(at.openRound, null)
  // Bereich: nur o2
  assert.deepEqual(attention({ doc, today: '2026-11-06', scope: new Set(['o2']) }).calls.map((a) => a.serverId), ['2'])
  // Rhythmus aus: kein Vorschlag
  assert.equal(attention({ doc: { ...doc, settings: { rhythm: 'aus' }, rounds: [] }, today: '2026-11-06', links }).openRound, null)
})

test('Bereich der Person: Vollzugriff alle, ohne Reviere alle, mit Revieren nur die eigenen', () => {
  const objects = [{ id: 'o1', region: 'Salzburg Stadt' }, { id: 'o2', region: 'Flachgau' }, { id: 'o3' }]
  assert.equal(scopeObjectIds({ all: true, objects }), null)
  assert.equal(scopeObjectIds({ objects, reviere: {} }), null)
  const reviere = { 'Salzburg Stadt': ['g-stadt'], Flachgau: ['g-flach'] }
  assert.deepEqual([...scopeObjectIds({ objects, reviere, groups: ['G-STADT'] })], ['o1'])
  assert.deepEqual([...scopeObjectIds({ objects, reviere, groups: [] })], [])
})

test('Einladung: Platzhalter, Link immer drin, Grund ohne Einladung', () => {
  const m = inviteMail({ title: 'Hausverwaltung Muster', objects: ['Wohnanlage Lehen', 'Itzling'], url: 'https://app.example/kunden.php?k=abc#umfrage', until: '2026-12-03', sender: 'Petra Leitner', company: 'Cleanos' })
  assert.equal(m.subject, 'Kurze Umfrage: Wie zufrieden sind Sie mit uns?')
  assert.match(m.text, /\(Wohnanlage Lehen, Itzling\)/)
  assert.match(m.text, /bis 03\.12\.2026 offen/)
  assert.match(m.text, /https:\/\/app\.example\/kunden\.php\?k=abc#umfrage/)
  assert.match(m.text, /Petra Leitner\nCleanos/)
  assert.match(m.text, /keine Einladungen zu Umfragen mehr/)
  const own = inviteMail({ template: { subject: 'Umfrage {titel}', text: 'Hallo\n\n\n\nbitte antworten' }, title: 'X', url: 'https://u' })
  assert.equal(own.subject, 'Umfrage X')
  assert.equal(own.text, 'Hallo\n\nbitte antworten\n\nhttps://u')
  const doc = { links: { a: { noInvite: true } } }
  assert.equal(inviteBlocked(doc, { id: 'a' }, 'x@example.com'), 'keine Einladungen gewünscht')
  assert.equal(inviteBlocked(doc, { id: 'b' }, ''), 'keine E-Mail-Adresse beim Link')
  assert.equal(inviteBlocked(doc, { id: 'b' }, 'x@example.com'), '')
})
