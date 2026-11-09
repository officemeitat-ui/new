// Wochenbriefing: Fakten, Text ohne KI, Namen und Abwesenheitsarten für die KI ersetzt, Prüfung der KI-Antwort
// (core/briefing.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anonymize, briefingFacts, briefingForAi, briefingRequest, briefingText, checkBriefing } from '../src/core/briefing.js'

const proposals = [
  { id: 'a', agent: 'disponent', prio: 1, title: 'Vertretung für Elif Kaya (Krankenstand 10.11.–12.11.)', text: '6 Einsätze sind betroffen' },
  { id: 'b', agent: 'buchhaltung', prio: 1, title: '3 Rechnungen sind überfällig', text: 'Mahnungen sind fällig' },
  { id: 'c', agent: 'lager', prio: 2, title: 'Bestellvorschlag', text: '' },
]
const agents = [{ id: 'disponent', name: 'Disponent' }, { id: 'buchhaltung', name: 'Buchhaltung' }]
const todo = [{ title: 'Abwesenheiten: Stunden neu planen', items: ['Elif Kaya · Krankenstand', 'Max Muster · Urlaub'] }, { title: 'Leer', items: [] }]
const tiles = [{ label: 'Umsatz Oktober', value: '€ 48.210,50' }, { label: 'Offene Posten', value: '€ 12.400,00' }]

test('Fakten und Text ohne KI', () => {
  const f = briefingFacts({ day: '2026-11-09', proposals, agents, todo, tiles })
  assert.deepEqual(f.urgent.map((u) => u.agent), ['Disponent', 'Buchhaltung'])
  assert.deepEqual(f.todo, [{ title: 'Abwesenheiten: Stunden neu planen', count: 2, first: ['Elif Kaya · Krankenstand', 'Max Muster · Urlaub'] }])
  const t = briefingText(f, { link: 'https://app.example/', from: 'Petra' })
  assert.match(t, /^Guten Morgen,\n\nhier das Wichtigste für die Woche ab 09\.11\.2026\./)
  assert.match(t, /Diese Woche wichtig:\n• Vertretung für Elif Kaya \(Krankenstand 10\.11\.–12\.11\.\) \(Disponent\)\n• 3 Rechnungen sind überfällig \(Buchhaltung\)/)
  assert.match(t, /Zu erledigen:\n• Abwesenheiten: Stunden neu planen: 2/)
  assert.match(t, /Kennzahlen:\n• Umsatz Oktober: € 48\.210,50/)
  assert.match(t, /In der App: https:\/\/app\.example\//)
  assert.match(briefingText(briefingFacts({ day: '2026-11-09' })), /Keine dringenden Vorschläge/)
})

test('Für die KI: Namen und Abwesenheitsarten ersetzt, Anfrage ohne Namen', () => {
  assert.equal(anonymize('Vertretung für Elif Kaya (Krankenstand), Elif fehlt', ['Elif Kaya']), 'Vertretung für eine Person (abwesend), eine Person fehlt')
  const ai = briefingForAi(briefingFacts({ day: '2026-11-09', proposals, agents, todo, tiles }), ['Elif Kaya', 'Max Muster'])
  const req = JSON.stringify(briefingRequest(ai))
  assert.doesNotMatch(req, /Elif|Kaya|Krankenstand|Urlaub/)
  assert.match(req, /Vertretung für eine Person \(abwesend/)
  assert.equal(ai.todo[0].count, 2)
  assert.equal(ai.todo[0].first, undefined) // Einzelpunkte gehen nicht hinaus
})

test('KI-Antwort prüfen: nur Zahlen aus den Fakten, kein Markdown, nicht zu lang', () => {
  const ai = briefingForAi(briefingFacts({ day: '2026-11-09', proposals, agents, todo, tiles }), ['Elif Kaya'])
  const ok = checkBriefing('{"text": "Diese Woche zuerst die Vertretung ab 10.11. planen. 3 Rechnungen sind überfällig, offen sind € 12.400,00. Im Oktober kamen € 48.210,50 Umsatz herein. Am 9. November startet die Woche."}', ai)
  assert.equal(ok.ok, true, ok.problems.join())
  const bad = checkBriefing('{"text": "Der Umsatz stieg um 17 % auf € 50.000."}', ai)
  assert.equal(bad.ok, false)
  assert.match(bad.problems.join(), /Zahlen nicht aus den Fakten: 17, 50\.000/)
  assert.equal(checkBriefing('{"text": "- Punkt eins"}', ai).ok, false)
  assert.equal(checkBriefing('kein json', ai).ok, false)
  assert.equal(checkBriefing(JSON.stringify({ text: 'x'.repeat(1500) }), ai).ok, false)
})
