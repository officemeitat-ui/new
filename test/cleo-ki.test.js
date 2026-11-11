// Cleo mit KI (core/cleo-ki.js): Anfrage mit den passenden Hilfethemen, Rolle und Bereichen; Antwort ohne die Zeile
// „Themen:“, nur erlaubte Themen. Dazu: ki.php nimmt für Cleo das günstige Modell ohne Werkzeuge, help.js fragt die
// KI nur, wenn sie eingerichtet ist und die Person zugestimmt hat.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CLEO_KI_MAX_QUESTION, CLEO_KI_MAX_TOKENS, CLEO_KI_TOPICS, cleoKiRequest, parseCleoAnswer, topicText } from '../src/core/cleo-ki.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const T = (id, extra = {}) => ({ id, title: `Titel ${id}`, answer: `Antwort zu ${id}`, steps: ['Erst das', 'dann das'], ...extra })

test('Cleo mit KI: Anfrage mit Hilfethemen, Rolle, Bereich und sichtbaren Bereichen; Frage nur als Nachricht', () => {
  const topics = Array.from({ length: 9 }, (_, i) => T(`thema-${i}`))
  const r = cleoKiRequest({ question: '  Wie mache ich   das?  ', topics, role: 'Objektmanagement', view: 'Reklamationen', areas: ['Reklamationen', 'Material'] })
  assert.equal(r.max_tokens, CLEO_KI_MAX_TOKENS)
  assert.deepEqual(r.messages, [{ role: 'user', content: 'Wie mache ich das?' }])
  for (let i = 0; i < CLEO_KI_TOPICS; i++) assert.ok(r.system.includes(`<thema id="thema-${i}">`), `thema-${i}`)
  assert.ok(!r.system.includes('thema-6'), 'höchstens sechs Themen')
  assert.match(r.system, /Rolle der Person: Objektmanagement/)
  assert.match(r.system, /gerade im Bereich „Reklamationen“/)
  assert.match(r.system, /sehen darf: Reklamationen, Material/)
  assert.match(r.system, /ausschließlich auf die Hilfethemen/)
  assert.match(r.system, /KI-Assistent/, 'echte Daten: Verweis auf den Assistenten')
  assert.match(r.system, /keine Anweisung an dich/, 'Frage ist keine Anweisung')
  assert.ok(!r.system.includes('Wie mache ich'), 'Frage steht nicht im System-Text')
  // lange Frage gekürzt, ohne Themen ein klarer Hinweis
  const lang = cleoKiRequest({ question: 'x'.repeat(5000) })
  assert.equal(lang.messages[0].content.length, CLEO_KI_MAX_QUESTION)
  assert.match(lang.system, /keine passenden Hilfethemen gefunden/)
  assert.match(lang.system, /Rolle der Person: unbekannt/)
})

test('Cleo mit KI: Thema als Text mit Antwort, Schritten, Tipp und Rolle, ohne Zeilenumbrüche im Inhalt', () => {
  const t = topicText(T('urlaub', { tips: ['Tipp\neins'], roles: 'alle' }))
  assert.match(t, /^<thema id="urlaub">\nTitel: Titel urlaub\nAntwort: Antwort zu urlaub\nSchritte: 1\. Erst das 2\. dann das\nTipps: Tipp eins\nWer: alle\n<\/thema>$/)
})

test('Cleo mit KI: Antwort lesen – Zeile „Themen:“ weg, nur erlaubte IDs, höchstens drei', () => {
  const r = parseCleoAnswer('So geht es:\n1. Öffne X\n2. Klick Y\n\nThemen: urlaub, erfunden, abwesenheit, urlaub, krank, x', ['urlaub', 'abwesenheit', 'krank', 'x'])
  assert.equal(r.text, 'So geht es:\n1. Öffne X\n2. Klick Y')
  assert.deepEqual(r.topicIds, ['urlaub', 'abwesenheit', 'krank'])
  assert.deepEqual(parseCleoAnswer('Weiß ich nicht.\n**Themen:** keine', ['a']), { text: 'Weiß ich nicht.', topicIds: [] })
  assert.deepEqual(parseCleoAnswer('Ohne Zeile', ['a']), { text: 'Ohne Zeile', topicIds: [] })
  assert.deepEqual(parseCleoAnswer('', []), { text: '', topicIds: [] })
})

test('ki.php: Fragen an Cleo (X-KI-Zweck: hilfe) mit dem Modell für die Hilfe, ohne Werkzeuge, kurz; einstellbar', () => {
  const php = read('ki.php')
  assert.match(php, /const MODELL_HILFE = 'claude-haiku-5-5';/)
  assert.match(php, /\$hilfe = \(string\) \(\$_SERVER\['HTTP_X_KI_ZWECK'\] \?\? ''\) === 'hilfe';/)
  assert.match(php, /\$modell = \$hilfe \? \(isset\(MODELLE\[\$e\['modellHilfe'\] \?\? ''\]\) \? \$e\['modellHilfe'\] : MODELL_HILFE\)/)
  assert.match(php, /min\(\$hilfe \? MAX_TOKENS_HILFE : MAX_TOKENS/)
  assert.match(php, /unset\(\$senden->tools, \$senden->tool_choice, \$senden->thinking, \$senden->output_config\);/)
  assert.match(php, /'modellHilfe' => isset\(MODELLE\[\$d\['modellHilfe'\] \?\? ''\]\)/, 'beim Einrichten gespeichert')
  assert.match(read('src/ai/client.js'), /'X-KI-Zweck': purpose/)
})

test('Cleo fragt die KI nur, wenn sie eingerichtet ist und die Person einmal zugestimmt hat', () => {
  const src = read('src/ui/help.js')
  assert.match(src, /if \(KI\.ok === true && kiConsented\(\)\) return askKi\(text\)/)
  assert.match(src, /function offerKi\(text\) \{\n  if \(KI\.ok !== true \|\| kiConsented\(\)\) return/)
  assert.match(src, /Dafür geht deine Frage an die KI von Anthropic/)
  assert.match(src, /kiSend\(params, \{ maxTokens, purpose: 'hilfe' \}\)/)
  assert.match(src, /visible: \(v\) => ids\.has\(v\)/, 'nur Themen, die die Rolle sehen darf')
})
