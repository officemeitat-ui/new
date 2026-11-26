// Unterweisung am Handy (core/unterweisung-online.js, Vorlage core/unterweisung-vorlage.js, Seite unterweisung.php):
// Textformat, Fragen, Sprachen, Definition für den Webspace (ohne Lösung in den Texten), Zuordnung, Einträge aus den
// Ergebnissen, Unterschrift, Vorlage in sechs Sprachen mit gleichem Aufbau, Texte der Seite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { DUE_STATES, languageStatus, onlineTypes, onlineVersion, parseContent, parseQuiz, passCount, resultRecords, sameShape, signatureFromPath, webAssignments, webDefinition } from '../src/core/unterweisung-online.js'
import { VORLAGE } from '../src/core/unterweisung-vorlage.js'
import { LANGUAGES } from '../src/core/sprachen.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
let php = true
try {
  execFileSync('php', ['-v'])
} catch {
  php = false
}

const type = (online = {}) => ({ id: 'sicherheit', name: 'Sicherheitsunterweisung', months: 12, who: 'alle', law: '§ 14 ASchG', kind: 'unterweisung', online: { on: true, texts: VORLAGE, pass: 80, covers: ['chemie'], ...online } })
const chemie = { id: 'chemie', name: 'Unterweisung Reinigungsmittel', months: 12, who: 'alle', kind: 'unterweisung' }

test('Inhalt: Einleitung, Abschnitte mit „## “, Listen mit „- “, Absätze', () => {
  const r = parseContent('Einleitung Satz eins\nSatz zwei.\n\n## Chemie\n- nicht mischen\n- Handschuhe\nDanach ein Absatz.\n\n## Leiter\nText')
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.sections, [
    { title: '', blocks: [{ p: 'Einleitung Satz eins Satz zwei.' }] },
    { title: 'Chemie', blocks: [{ list: ['nicht mischen', 'Handschuhe'] }, { p: 'Danach ein Absatz.' }] },
    { title: 'Leiter', blocks: [{ p: 'Text' }] },
  ])
  assert.deepEqual(parseContent('   ').errors, ['Kein Inhalt.'])
})

test('Fragen: genau eine richtige Antwort, mindestens zwei Antworten, verständliche Fehler', () => {
  const ok = parseQuiz('? Notruf Rettung?\n+ 144\n- 122\n\n? Leiter?\n- Sessel\n+ geprüfte Leiter')
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.questions, [{ q: 'Notruf Rettung?', options: ['144', '122'], correct: 0 }, { q: 'Leiter?', options: ['Sessel', 'geprüfte Leiter'], correct: 1 }])
  const bad = parseQuiz('- ohne Frage\n? Zwei richtig\n+ a\n+ b\n? Nur eine Antwort\n+ a')
  assert.ok(bad.errors.some((e) => /Antwort ohne Frage/.test(e)))
  assert.ok(bad.errors.some((e) => /Frage 1: genau eine richtige/.test(e)))
  assert.ok(bad.errors.some((e) => /Frage 2: mindestens zwei/.test(e)))
  assert.equal(passCount(15, 80), 12)
  assert.equal(passCount(13, 80), 11)
  assert.equal(passCount(5, 0), 1, 'mindestens eine')
  assert.equal(passCount(0, 80), 0)
})

test('Vorlage: alle sechs Sprachen, gleiche Abschnitte und Fragen wie Deutsch, Notrufnummern, keine Wörter in Großbuchstaben', () => {
  assert.deepEqual(Object.keys(VORLAGE).sort(), LANGUAGES.map((l) => l.id).sort())
  const de = parseContent(VORLAGE.de.content)
  const dq = parseQuiz(VORLAGE.de.quiz)
  assert.equal(dq.questions.length, 15)
  assert.equal(de.sections.length, 21, 'Einleitung und 20 Abschnitte')
  const shape = (c) => c.sections.map((s) => s.blocks.map((b) => (b.list ? `L${b.list.length}` : 'P')).join(','))
  for (const [id, t] of Object.entries(VORLAGE)) {
    const c = parseContent(t.content)
    const q = parseQuiz(t.quiz)
    assert.deepEqual(c.errors, [], id)
    assert.deepEqual(q.errors, [], id)
    assert.deepEqual(shape(c), shape(de), `${id}: gleicher Aufbau der Abschnitte`)
    assert.ok(sameShape(dq.questions, q.questions), `${id}: gleiche Fragen`)
    for (const n of ['144', '122', '133', '112', '01 406 43 43']) assert.ok(t.content.includes(n), `${id}: ${n}`)
    assert.ok(t.title && t.decl, id)
    const caps = `${t.title} ${t.content} ${t.quiz} ${t.decl}`.match(/\b\p{Lu}{4,}\b/gu) || []
    assert.deepEqual(caps.filter((w) => !['ASchG'].includes(w)), [], `${id}: Großbuchstaben`)
  }
  assert.ok(languageStatus({ texts: VORLAGE }).every((s) => s.ok))
})

test('Sprache mit anderem Aufbau der Fragen: nicht genutzt, Deutsch bleibt', () => {
  const texts = { de: VORLAGE.de, en: { ...VORLAGE.en, quiz: '? Only one\n+ a\n- b' } }
  const st = languageStatus({ texts })
  assert.equal(st.find((s) => s.id === 'en').ok, false)
  assert.match(st.find((s) => s.id === 'en').errors.join(), /passen nicht zu den deutschen/)
  const d = webDefinition(type({ texts }), { types: [type({ texts }), chemie] })
  assert.deepEqual(Object.keys(d.texte), ['de'])
})

test('Definition für den Webspace: Lösung getrennt, nicht in den Texten; Fassung ändert sich mit dem Inhalt', () => {
  const t = type()
  const d = webDefinition(t, { types: [t, chemie] })
  assert.equal(d.loesung.length, 15)
  assert.ok(d.loesung.every((x) => x === 0), 'in der Vorlage steht die richtige Antwort oben (am Handy gemischt)')
  assert.deepEqual(Object.keys(d.texte).sort(), LANGUAGES.map((l) => l.id).sort())
  assert.equal(d.texte.de.fragen.length, 15)
  assert.ok(!JSON.stringify(d.texte).includes('"correct"') && !JSON.stringify(d.texte).includes('"+ '), 'keine Lösung in den Texten')
  assert.deepEqual(d.deckt, ['chemie'])
  assert.equal(d.bestehen, 80)
  assert.equal(d.monate, 12)
  assert.match(d.version, /^[a-f0-9]{8}$/)
  assert.notEqual(onlineVersion(type({ pass: 100 })), onlineVersion(t))
  assert.equal(onlineVersion(type()), onlineVersion(t))
  assert.equal(webDefinition(type({ videoLink: 'http://unsicher.example' }), { types: [] }).videoLink, '', 'nur https')
  assert.deepEqual(webDefinition(type({ covers: ['gibts-nicht', 'sicherheit'] }), { types: [type(), chemie] }).deckt, [], 'nur bekannte, andere Arten')
})

test('Zuordnung: Pflicht ohne Eintrag = fehlt, mit Eintrag der Stand; ausgetreten und ohne Link nicht', () => {
  const doc = { types: [type(), chemie], records: [{ id: 'r1', empId: 'e2', typeId: 'sicherheit', date: '2026-01-10' }] }
  const employees = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }, { id: 'e3', name: 'Cem', exitDate: '2026-10-01' }, { id: 'e4', name: 'Dora' }]
  const hashOf = (id) => ({ e1: 'h1', e2: 'h2', e3: 'h3' })[id] || null
  const out = webAssignments({ doc, employees, hashOf, today: '2026-11-26' })
  assert.deepEqual(out, { h1: [{ art: 'sicherheit', stand: 'fehlt', bis: '', datum: '' }], h2: [{ art: 'sicherheit', stand: 'ok', bis: '2027-01-10', datum: '2026-01-10' }] })
  assert.deepEqual(webAssignments({ doc, employees, hashOf, today: '2027-01-20' }).h2[0].stand, 'abgelaufen')
  assert.ok(DUE_STATES.includes('bald'))
  assert.deepEqual(onlineTypes({ types: [type({ on: false }), chemie] }), [], 'ausgeschaltet: nicht am Handy')
})

test('Ergebnisse → Einträge mit Unterschrift, „erledigt auch“, ohne doppelte; unbekannte Person bleibt liegen', () => {
  const t = type()
  const v = onlineVersion(t)
  const doc = { types: [t, chemie], records: [], versions: { [v]: { covers: ['chemie'] } } }
  const zeit = Date.UTC(2026, 10, 26, 23, 30) / 1000 // 27.11. 00:30 in Wien
  const results = [
    { id: 'a1b2c3d4e5f6a7b8', hash: 'h1', art: 'sicherheit', version: v, sprache: 'ro', zeit, geoeffnet: zeit - 900, richtig: 14, gesamt: 15, versuche: 2, unterschrift: 'M10 10L20 20L30 30', erklaerung: 'Confirm …' },
    { id: 'ffffffffffffffff', hash: 'hx', art: 'sicherheit', version: v, zeit, richtig: 15, gesamt: 15, versuche: 1, unterschrift: 'M1 1L2 2' },
  ]
  let n = 0
  const r = resultRecords(doc, results, { empOf: (h) => (h === 'h1' ? { id: 'e1' } : null), newId: () => `r${++n}`, types: doc.types })
  assert.equal(r.records.length, 2)
  assert.deepEqual(r.taken, ['a1b2c3d4e5f6a7b8'])
  assert.deepEqual(r.unknown, ['ffffffffffffffff'])
  const [a, b] = r.records
  assert.equal(a.date, '2026-11-27', 'Datum in Wien')
  assert.equal(a.note, 'Am Handy: 14 von 15 Fragen richtig (2. Versuch)')
  assert.equal(a.source, 'handy')
  assert.equal(a.online.lang, 'ro')
  assert.match(a.signature, /^<svg[^>]+viewBox="0 0 600 200"[\s\S]+d="M10 10L20 20L30 30"/)
  assert.equal(b.typeId, 'chemie')
  assert.equal(b.online.coveredBy, 'sicherheit')
  doc.records.push(...r.records)
  const again = resultRecords(doc, results.slice(0, 1), { empOf: () => ({ id: 'e1' }), newId: () => 'x', types: doc.types })
  assert.deepEqual(again.records, [])
  assert.deepEqual(again.taken, ['a1b2c3d4e5f6a7b8'], 'schon eingetragen: trotzdem am Webspace löschen')
})

test('Unterschrift: nur ein Pfad aus Zahlen, M und L (kein HTML ins PDF)', () => {
  assert.equal(signatureFromPath('M1 2L3 4" onload="x'), '')
  assert.equal(signatureFromPath('<script>'), '')
  assert.ok(signatureFromPath('M1 2L3 4').startsWith('<svg'))
})

test('Seite unterweisung.php: gleiche Regeln wie die App, Lösung nie in der Seite, Schutz vor fremden Seiten', () => {
  const p = read('unterweisung.php')
  assert.match(p, /function noetig\(int \$gesamt, int \$prozent\): int/)
  assert.match(p, /UW_VERSUCHE_TAG = 12/)
  assert.match(p, /fremde_herkunft\(\)/)
  assert.match(p, /function reihenfolge\(/, 'Antworten je Person gemischt, die Seite schickt nur die Stelle')
  assert.ok(!/\$def\['loesung'\][^;]*\. '<|'loesung' =>[^,]*\$h\(/.test(p), 'Lösung nicht ausgeben')
  assert.match(read('scripts/build.js'), /'unterweisung\.php'/)
  assert.match(read('mein-plan.php'), /function uw_hinweis_html\(string \$hash\): string/)
})

test('PHP: Bestehensgrenze wie in der App', { skip: !php && 'ohne PHP' }, () => {
  const src = read('unterweisung.php')
  const fn = src.slice(src.indexOf('function noetig('), src.indexOf('}', src.indexOf('function noetig(')) + 1)
  const out = JSON.parse(execFileSync('php', ['-r', `${fn} echo json_encode([noetig(15, 80), noetig(13, 80), noetig(5, 0), noetig(0, 80), noetig(10, 100)]);`], { encoding: 'utf8' }))
  assert.deepEqual(out, [passCount(15, 80), passCount(13, 80), passCount(5, 0), passCount(0, 80), passCount(10, 100)])
})

test('Formulare zum Unterschreiben (Diensthandy, Arztbesuche): ohne Fragen, gültiger Inhalt, Definition ohne Lösung', async () => {
  const { FORMULAR_VORLAGEN } = await import('../src/core/formular-vorlagen.js')
  assert.deepEqual(FORMULAR_VORLAGEN.map((f) => f.id), ['dienstverhinderung', 'diensthandy'])
  for (const f of FORMULAR_VORLAGEN) {
    const st = languageStatus({ texts: f.texts })
    assert.ok(st[0].ok, f.id)
    assert.equal(st[0].questions, 0, `${f.id}: ohne Fragen`)
    assert.ok(!/PIN:\s*\d|Pin:\s*\d|\d{4}\s*$/m.test(f.texts.de.content), `${f.id}: keine PIN oder Nummer einer Person`)
    const d = webDefinition({ id: f.id, name: f.name, months: 0, who: 'alle', kind: 'formular', online: { on: true, texts: f.texts, pass: 0 } }, { types: [] })
    assert.deepEqual(d.loesung, [])
    assert.equal(d.texte.de.fragen.length, 0)
    assert.equal(d.monate, 0)
  }
})
