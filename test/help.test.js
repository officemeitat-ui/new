// Cleos Verständnis (src/help/match.js): Normalisieren, Wortstamm, Synonyme, Tippfehler, Suche
// über die Hilfe-Themen, Rollen-Filter, Glossar und Plaudern.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glossary, normalize, rarity, score, search, similar, smalltalk, stem, SURE, terms } from '../src/help/match.js'

const T = [
  { id: 'woche-planen', section: 'planung', view: 'week', title: 'Eine Woche planen', q: ['woche planen', 'dienstplan erstellen', 'automatisch einteilen'], answer: 'Woche planen verteilt alle freien Einsätze.' },
  { id: 'urlaub', section: 'planung', view: 'absences', title: 'Urlaub oder Krankenstand eintragen', q: ['urlaub eintragen', 'krank melden', 'abwesenheit erfassen'], answer: 'Unter Abwesenheiten oder mit Neu → Abwesenheit.' },
  { id: 'rechnung', section: 'finanzen', view: 'fakturierung', title: 'Eine Rechnung schreiben', q: ['rechnung schreiben', 'faktura', 'verrechnen'], answer: 'In der Fakturierung mit Rechnung.' },
  { id: 'winter', section: 'einsatz', view: 'wetter', title: 'Winterdienst bei Schnee', q: ['winterdienst anlegen', 'streuen', 'schneeräumung'], answer: 'Wetter & Winterdienst zeigt, wann Winterdienst nötig ist.' },
  { id: 'zaehler', section: 'objekte', view: 'zaehler', title: 'Wasserzähler ablesen', q: ['wasserzähler ablesen', 'zählerstand erfassen'], answer: 'Im Werkzeug Wasserzähler.' },
  { id: 'darstellung', section: 'allgemein', title: 'Darstellung ändern', q: ['dunkelmodus', 'farbschema wechseln', 'schrift größer'], answer: 'Über das Paletten-Symbol.' },
]
const G = [{ term: 'Stammkraft', text: 'macht den Einsatz normalerweise' }, { term: 'Reverse Charge', text: 'Steuerschuld geht über' }]

test('normalize: Umlaute, ß, Akzente, Satzzeichen', () => {
  assert.equal(normalize('Wasserzähler – Größe? Café!'), 'wasserzaehler groesse cafe')
  assert.equal(normalize('  Straße  '), 'strasse')
})

test('stem: übliche Endungen ab, kurze Wörter bleiben', () => {
  assert.equal(stem('rechnungen'), 'rechn')
  assert.equal(stem('einsaetze'), 'einsaetz')
  assert.equal(stem('plan'), 'plan')
  assert.equal(stem('urlaube'), 'urlaub')
})

test('terms: Füllwörter weg, Synonyme dazu', () => {
  const t = terms('Wie kann ich meinen Urlaub eintragen?')
  assert.ok(!t.includes('wie') && !t.includes('ich'))
  assert.ok(t.includes('urlaub'))
  assert.ok(t.includes(stem('abwesenheit')), 'Urlaub → Abwesenheit')
  assert.ok(terms('Schnee morgen').includes('winterdienst'))
})

test('similar: gleich, Anfang, Tippfehler', () => {
  assert.equal(similar('rechnung', 'rechnung'), 1)
  assert.ok(similar('rechn', 'rechnungsnummer') > 0.8)
  assert.ok(similar('urlaubb', 'urlaub') > 0)
  assert.ok(similar('fahrzeuk', 'fahrzeug') > 0, 'ein Tippfehler')
  assert.equal(similar('abc', 'xyz'), 0)
})

for (const [frage, id] of [
  ['Wie plane ich die Woche?', 'woche-planen'],
  ['dienstplan machen', 'woche-planen'],
  ['ich bin krank', 'urlaub'],
  ['Urlaub beantragen', 'urlaub'],
  ['RECHNUNG SCHREIBEN', 'rechnung'],
  ['wie verrechne ich', 'rechnung'],
  ['es schneit, was tun', 'winter'],
  ['glatteis streuen', 'winter'],
  ['Zählerstände eintragen', 'zaehler'],
  ['wasser ablesen', 'zaehler'],
  ['dunkel einstellen', 'darstellung'],
]) {
  test(`search: „${frage}“ → ${id}`, () => {
    const r = search(T, frage)
    assert.equal(r[0]?.topic.id, id, JSON.stringify(r.map((x) => [x.topic.id, x.score.toFixed(2)])))
  })
}

test('search: sicherer Treffer liegt über SURE, Unsinn findet nichts', () => {
  assert.ok(search(T, 'rechnung schreiben')[0].score >= SURE)
  assert.deepEqual(search(T, 'xyzzy quux'), [])
  assert.deepEqual(search(T, ''), [])
})

test('search: Rolle sieht die Ansicht nicht → Thema fehlt; Themen ohne Ansicht immer', () => {
  const r = search(T, 'rechnung schreiben', { visible: (v) => v !== 'fakturierung' })
  assert.ok(!r.some((x) => x.topic.id === 'rechnung'))
  assert.equal(search(T, 'dunkelmodus', { visible: () => false })[0]?.topic.id, 'darstellung')
})

test('search: aktuelle Ansicht gibt bei Gleichstand den Ausschlag', () => {
  assert.equal(search(T, 'erfassen', { view: 'zaehler' })[0].topic.id, 'zaehler')
  assert.equal(search(T, 'erfassen', { view: 'absences' })[0].topic.id, 'urlaub')
})

test('rarity: seltene Wörter wiegen mehr als häufige', () => {
  const many = [...T, ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, section: 'allgemein', title: `Etwas eintragen ${i}`, q: ['eintragen', 'erfassen', `ding${i}`], answer: 'Irgendwas eintragen und erfassen.' }))]
  const w = rarity(many, terms('wasserzaehler eintragen', { synonyms: false }))
  assert.ok(w[stem('wasserzaehler')] > w[stem('eintragen')])
  assert.equal(search(many, 'Wasserzähler eintragen')[0].topic.id, 'zaehler')
})

test('score: ganze Frage aus q zählt extra', () => {
  assert.ok(score(T[0], 'dienstplan erstellen') > score(T[0], 'erstellen'))
})

test('glossary: „Was ist …“ findet den Begriff, Unbekanntes nicht', () => {
  assert.equal(glossary(G, 'Was ist eine Stammkraft?')?.term, 'Stammkraft')
  assert.equal(glossary(G, 'was bedeutet reverse charge')?.term, 'Reverse Charge')
  assert.equal(glossary(G, 'was ist ein pinguin'), null)
})

test('smalltalk: Gruß, Dank, wer bist du; sonst null', () => {
  assert.equal(smalltalk('Hallo!')?.mood, 'hallo')
  assert.equal(smalltalk('danke dir')?.mood, 'herz')
  assert.match(smalltalk('Wer bist du?')?.text || '', /Cleo/)
  assert.equal(smalltalk('Hallo, wie schreibe ich eine Rechnung für den Kunden Maier?'), null, 'lange Fragen mit Gruß sind keine Plauderei')
  assert.equal(smalltalk('rechnung schreiben'), null)
})

// Mit den echten Hilfe-Themen: typische Fragen aus dem Alltag landen beim richtigen Thema
import { TOPICS } from '../src/help/topics.js'
for (const [frage, id] of [
  ['Wie trage ich Urlaub ein?', 'abwesenheit-eintragen'],
  ['Cleo, wie plane ich die Woche', 'woche-planen'],
  ['es schneit morgen was muss ich tun', 'winterdienst-anlegen'],
  ['Zählerstände eintragen', 'wasserzaehler'],
  ['wie schreibe ich eine Rechnung', 'rechnung-schreiben'],
  ['Rechnung stornieren', 'storno-korrektur'],
  ['Mitarbeiter krank gemeldet', 'abwesenheit-eintragen'],
  ['Kunde hat sich beschwert', 'reklamation-erfassen'],
  ['Pickerl fällig', 'pickerl'],
  ['Material bestellen', 'material-bestellen'],
  ['Wie stempeln Mitarbeiter mit dem Handy', 'qr-stempeln'],
  ['Dienst tauschen', 'dienst-tauschen'],
  ['Schlüssel verloren', 'schluessel-verlust'],
  ['Kontoauszug einlesen', 'bankabgleich'],
  ['Angebot erstellen', 'angebot'],
  ['Schnee Alarm einrichten', 'schnee-alarm'],
  ['radar', 'radar'],
  ['inventur', 'material-inventur'],
  ['mattenwechsel', 'mattenwechsel'],
  ['objektdoku', 'objektdoku'],
  ['passwort', 'anmeldung'],
  ['installieren', 'app-installieren'],
]) {
  test(`Cleo mit allen Themen: „${frage}“ → ${id} (sicher)`, () => {
    const [top] = search(TOPICS, frage)
    assert.equal(top?.topic.id, id)
    assert.ok(top.score >= SURE, `nur ${top.score.toFixed(2)}`)
  })
}

test('Cleo: E-Mail aus der App (Bericht, Aufgabe, Export, Einrichtung) – ohne die alten Versand-Themen zu verdrängen', () => {
  const top = (q) => search(TOPICS, q, { limit: 1 })[0]?.topic.id
  assert.equal(top('bericht per mail senden'), 'bericht-per-mail')
  assert.equal(top('wie schicke ich eine aufgabe per mail'), 'aufgabe-per-mail')
  assert.equal(top('kann ich exporte mailen'), 'export-per-mail')
  assert.equal(top('mail geht nicht direkt aus der app'), 'email-einrichten')
  assert.equal(top('rechnung per mail'), 'rechnung-versenden')
  assert.equal(top('dienstplan per mail an mitarbeiter'), 'versenden')
  assert.equal(top('leistungsnachweis per mail'), 'leistungsnachweis-versenden')
})

test('Cleo: Saison-Deko ausschalten findet das Thema', () => {
  const top = (q) => search(TOPICS, q, { limit: 1 })[0]?.topic.id
  assert.equal(top('wie schalte ich die weihnachtsdeko aus'), 'saison-deko')
  assert.equal(top('schneeflocken ausschalten'), 'saison-deko')
  assert.equal(top('farbschema ändern'), 'darstellung')
})
