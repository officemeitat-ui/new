import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyLegacy, convertAkte, convertInspection, mapInterval, planLegacyImport, scanLegacy } from '../src/core/legacy.js'
import { openDefects } from '../src/core/inspections.js'

// Daten im Format der bisherigen Werkzeuge (anonymisiert, wie beschrieben)
const waterList = {
  id: 'L-start-musterort-2026', art: 'wasserablesung', schema: 1, ort: 'Musterort', jahr: '2026', bereich: 'EBG',
  stellen: [{ id: 'S-musterort-01', objektNr: '520001', anschrift: 'Musterstraße 12', zaehlerNr: 'A1', startstand: '100', zustand: 'aktiv', verlauf: [] }],
  runden: { Q1: { datum: '2026-03-30', ableser: 'M. E.', status: 'abgeschlossen', werte: { 'S-musterort-01': { stand: '130', grund: '' } } } },
}
const kunden = [{ nr: '10000', name: 'Musterverwaltung GmbH', strasse: 'Musterstraße 1', ort: '5400 Hallein', email: 'office@example.at' }]
const objekte = [{ kundenNr: '10000', kunde: 'Musterverwaltung GmbH', objektId: 'OBJ-0001', objekt: 'Musterstraße 1', adresse: 'Musterstraße 1, 5400 Hallein', email: 'hv@example.at', neuerKunde: false }]
const kontrolle = {
  id: 'S-mf3k-a91c', schema: 1, art: 'schnell', status: 'abgeschlossen', abgeschlossen: '2026-09-24T10:00:00Z', erstellt: '2026-09-24T09:00:00Z',
  meta: { objektId: 'OBJ-0001', objekt: 'Musterstraße 1', adresse: 'Musterstraße 1, 5400 Hallein', auftraggeber: 'Musterverwaltung GmbH', kundenNr: '10000', kundenMail: 'office@example.at' },
  datum: '2026-09-24', zeit: '09:15', pruefer: 'M. E.', kontrollart: 'Regelkontrolle',
  items: { '1.1': { b: 'OK' }, '1.6': { b: 'G', bem: 'Lose Gehwegplatte', fotos: ['data:image/jpeg;base64,AAA'], fotoDateien: ['2026-09-24_Punkt-1-6_01.jpg'], prio: '1', erledigt: false }, '6.1': { b: 'NA' }, '7.3': { b: 'R', bem: 'Müllraum', prio: '3', erledigt: true } },
  abschluss: { gesamt: 'Handlungsbedarf', zusammenfassung: 'Platte gesichert.', nachkontrolle: 'Ja', nachtermin: '2026-11-05' },
  sig: { pruefer: { name: 'M. E.', data: 'data:image/png;base64,SIG', zeit: '2026-09-24T09:58:00Z' }, kunde: {} },
  gesendet: [{ an: ['hv@example.at'], cc: [], bcc: [], zeit: '2026-09-24T11:00:00Z' }],
}
const akte = {
  id: 'LV-7f3a', kundeNr: 'K-0815', kunde: 'Hausverwaltung Muster GmbH', objektId: '1042', objekt: 'Wohnanlage Musterweg 12', objektart: 'Wohnhaus', strasse: 'Musterweg 12', plz: '5020', ort: 'Salzburg', vertrag: 'Rahmenvertrag 2026', gueltigAb: '2026-01-01', hinweise: 'Parken im Hof',
  bereiche: [{ name: 'Stiegenhaus', lage: 'Stiege 1, EG–3. OG', flaeche: '120', boden: 'Fliesen', leistungen: [{ was: 'Böden feucht reinigen', intervall: 'w3', methode: 'Wischmopp', min: '25' }, { was: 'Grundreinigung', intervall: 'bedarf', min: '240' }], raeume: [{ nr: '0.12', name: 'Müllraum', flaeche: '8', boden: 'Fliesen' }] }],
  personen: [{ name: 'Fr. Muster', rolle: 'Hausverwaltung', telefon: '0662 000', mail: 'hv@example.at', intern: false }],
  schluesselListe: [{ bezeichnung: 'Haupteingang', nummer: 'S-14', art: 'Schlüssel', anzahl: 2, ausgabeAn: 'Stammkraft', lage: 'Schlüsselkasten Büro', vertraulich: true }],
  geraete: [{ bezeichnung: 'Sauger', standort: 'Keller', inventarnr: 'G-1', eigentum: 'Cleanos', zustand: 'gut' }],
  anhaenge: [{ name: 'Grundriss EG.pdf', quelle: 'https://example.sharepoint.com/Grundriss.pdf' }],
}

test('Übernahme: Dateien der Werkzeuge werden erkannt', () => {
  const found = classifyLegacy([
    { path: 'Wasserzähler - Ablesung/EBG/Musterort/Ablesung_Musterort_2026.json', data: waterList },
    { path: 'Objektpruefprotokolle/Stammdaten/Kunden.json', data: kunden },
    { path: 'Objektpruefprotokolle/Stammdaten/Objekte.json', data: objekte },
    { path: 'Objektpruefprotokolle/Objekte/OBJ-0001_Musterstrasse-1/2026-09-24_Q3/2026-09-24_S-mf3k.json', data: kontrolle },
    { path: 'Objektdoku/1042_Wohnanlage-Musterweg-12/1042.json', data: akte },
    { path: 'irgendwas.json', data: { foo: 1 } },
    { path: 'Objektdoku/Stammdaten/Vorlagen.json', data: { werkzeug: 'Cleanos Objektdokumentation', vorlagen: [{ id: 'V-1', name: 'Stiegenhaus', boden: 'Fliesen', leistungen: [{ was: 'Handläufe abwischen', intervall: 'w1', min: '10' }] }, { id: 'V-2', name: 'Alt', geloescht: true }] } },
  ])
  assert.deepEqual([found.water.length, found.customers.length, found.objects.length, found.inspections.length, found.akten.length, found.unknown.length], [1, 1, 1, 1, 1, 1])
  assert.deepEqual(found.templates, [{ id: 'V-1', name: 'Stiegenhaus', floor: 'Fliesen', note: '', services: [{ what: 'Handläufe abwischen', interval: 'w1', minutes: 10, method: '' }] }], 'gelöschte Vorlagen (Grabstein) nicht')
  assert.deepEqual(found.customers[0], { nr: '10000', name: 'Musterverwaltung GmbH', street: 'Musterstraße 1', city: '5400 Hallein', email: 'office@example.at' })
})

test('Übernahme: Protokoll des Prüfprotokoll-Tools wird zur Kontrolle', () => {
  const k = convertInspection(kontrolle, { objectId: 'o1', checklistId: 'objektkontrolle', photoDir: 'Objektpruefprotokolle/Objekte/OBJ/2026-09-24_Q3', photoUrl: (p) => `https://x/${p}` })
  assert.deepEqual([k.id, k.date, k.time, k.inspector, k.kind, k.status], ['S-mf3k-a91c', '2026-09-24', '09:15', 'M. E.', 'Regelkontrolle', 'abgeschlossen'])
  assert.deepEqual(k.items['1.6'].photos, [{ path: 'Objektpruefprotokolle/Objekte/OBJ/2026-09-24_Q3/Fotos/2026-09-24_Punkt-1-6_01.jpg', root: true, name: '2026-09-24_Punkt-1-6_01.jpg', url: 'https://x/Objektpruefprotokolle/Objekte/OBJ/2026-09-24_Q3/Fotos/2026-09-24_Punkt-1-6_01.jpg' }], 'Foto als Verweis, nicht eingebettet')
  assert.deepEqual([k.items['1.6'].rating, k.items['1.6'].note, k.items['1.6'].prio, k.items['6.1'].rating], ['G', 'Lose Gehwegplatte', '1', 'NA'])
  assert.ok(k.items['7.3'].done, 'Haken „erledigt“ bleibt')
  assert.deepEqual(k.summary, { overall: 'Handlungsbedarf', text: 'Platte gesichert.', followUp: true, followUpDate: '2026-11-05' })
  assert.deepEqual([k.signatures.inspector.name, k.signatures.inspector.image.data, k.signatures.customer], ['M. E.', 'data:image/png;base64,SIG', undefined])
  assert.deepEqual(k.sent[0].to, ['hv@example.at'])
  assert.deepEqual(openDefects([k]).map((d) => d.itemId), ['1.6'])
})

test('Übernahme: Akte der Objektdoku wird zur Objektmappe', () => {
  const m = convertAkte(akte)
  assert.deepEqual([m.customerNo, m.customer, m.objectNo, m.kind, m.street, m.contract, m.validFrom, m.notes], ['K-0815', 'Hausverwaltung Muster GmbH', '1042', 'Wohnhaus', 'Musterweg 12, 5020 Salzburg', 'Rahmenvertrag 2026', '2026-01-01', 'Parken im Hof'])
  assert.deepEqual(m.areas[0].services.map((s) => [s.what, s.interval, s.minutes]), [['Böden feucht reinigen', 'w3', 25], ['Grundreinigung', 'bedarf', 240]])
  assert.deepEqual(m.areas[0].rooms[0], { no: '0.12', name: 'Müllraum', size: 8, floor: 'Fliesen', note: '' })
  assert.deepEqual([m.access[0].label, m.access[0].count, m.access[0].place, m.access[0].confidential], ['Haupteingang', 2, 'Schlüsselkasten Büro · ausgegeben an Stammkraft', true])
  assert.equal(m.devices[0].owner, 'eigen')
  assert.equal(m.attachments[0].url, 'https://example.sharepoint.com/Grundriss.pdf')
  assert.deepEqual(['t7', 'w3', 'W2', 'm2', 'j1', 'witter', 't1', ''].map(mapInterval), ['t7', 'w3', 'w2', 'm2', 'j1', 'witter', 'w1', 'w1'], 'gleiche Kennungen, Unbekanntes wie im Werkzeug → w1')
  // weitere Felder laut Werkzeug: Einsatztage, Zeitfenster, Fotos, Verlauf
  const full = convertAkte({ ...akte, einsatzTage: ['Mo', 'Mi'], zeitfenster: [{ tage: 'Mo–Fr', von: '06:00', bis: '08:00', hinweis: 'vor Geschäftsbeginn' }], zeitHinweis: 'nicht vor 7 Uhr', fotos: [{ id: 'F-1', art: 'zugang', bereich: 'Stiegenhaus', titel: 'Schlüsselbund', datei: 'F-1.jpg', daten: '' }, { id: 'F-2', art: 'ablauf', titel: 'Weg', datei: 'F-2.jpg' }], verlauf: [{ fassung: 2, zeit: '2026-10-22T10:00:00Z', wer: 'Büro', anlass: 'Blatt erzeugt', daten: { ...akte, hinweise: 'alt' } }], geprueftAm: '2026-10-20', geprueftVon: 'M. E.' }, { photoDir: 'Objektdoku/1042_W', photoUrl: (p) => `https://x/${p}` })
  assert.deepEqual([full.serviceDays, full.timeWindows, full.timeNote], [['Mo', 'Mi'], [{ days: 'Mo–Fr', from: '06:00', to: '08:00', note: 'vor Geschäftsbeginn' }], 'nicht vor 7 Uhr'])
  assert.deepEqual(full.photos.map((p) => [p.kind, p.title, p.photo.path]), [['zugang', 'Schlüsselbund', 'Objektdoku/1042_W/Fotos/F-1.jpg'], ['ablauf', 'Weg', 'Objektdoku/1042_W/Fotos/F-2.jpg']])
  assert.deepEqual([full.history[0].version, full.history[0].reason, full.history[0].data.notes, full.checkedAt], [2, 'Blatt erzeugt', 'alt', '2026-10-20'])
})

test('Übernahme: alles zusammen, Objekte werden zugeordnet oder angelegt, zweiter Lauf verdoppelt nichts', () => {
  const found = classifyLegacy([
    { path: 'W/Ablesung_Musterort_2026.json', data: waterList },
    { path: 'P/Stammdaten/Kunden.json', data: kunden },
    { path: 'P/Stammdaten/Objekte.json', data: objekte },
    { path: 'P/Objekte/OBJ-0001_Musterstrasse-1/2026-09-24_Q3/k.json', data: kontrolle },
    { path: 'O/1042/1042.json', data: akte },
  ])
  const current = { objects: [{ id: 'o5', name: 'Wohnanlage Musterweg 12', address: '5020 Salzburg' }], mappe: { objects: {} }, kontrolle: { inspections: [] }, zaehler: { meters: [], readings: [] } }
  const plan = planLegacyImport(found, current)
  assert.deepEqual(plan.objects.map((o) => o.name).sort(), ['EBG Musterort', 'Musterstraße 1'])
  const pk = plan.objects.find((o) => o.name === 'Musterstraße 1')
  assert.deepEqual([plan.mappe.objects[pk.id].customerNo, plan.mappe.objects[pk.id].objectNo, plan.mappe.objects[pk.id].hvEmail], ['10000', 'OBJ-0001', 'hv@example.at'])
  assert.equal(plan.mappe.objects.o5.objectNo, '1042', 'Akte dem vorhandenen Objekt zugeordnet')
  assert.equal(plan.kontrolle.inspections[0].objectId, pk.id, 'Kontrolle beim selben Objekt wie Objekte.json')
  assert.equal(plan.mappe.customers.length, 1)
  assert.deepEqual([plan.stats.water.meters, plan.stats.water.readings, plan.stats.inspections, plan.stats.akten, plan.stats.created], [1, 2, 1, 1, 2])
  // zweiter Lauf mit dem Ergebnis: nichts Neues
  const again = planLegacyImport(found, { objects: [...current.objects, ...plan.objects], mappe: plan.mappe, kontrolle: plan.kontrolle, zaehler: plan.zaehler })
  assert.deepEqual([again.objects.length, again.kontrolle.inspections.length, again.zaehler.readings.length, again.stats.water.readings], [0, 1, 2, 0])
})

test('Übernahme: Ordner in SharePoint durchsuchen', async () => {
  const tree = {
    'Wasserzähler - Ablesung': [{ path: 'Wasserzähler - Ablesung/EBG/Musterort/Ablesung_Musterort_2026.json', name: 'Ablesung_Musterort_2026.json' }, { path: 'Wasserzähler - Ablesung/EBG/Musterort/Wasserablesung-Musterort-2026-Q1.pdf', name: 'Wasserablesung-Musterort-2026-Q1.pdf' }],
    'Objektpruefprotokolle/Objekte': [{ path: 'Objektpruefprotokolle/Objekte/OBJ/2026-09-24_Q3/2026-09-24_S-mf3k.json', name: '2026-09-24_S-mf3k.json' }],
    Objektdoku: [{ path: 'Objektdoku/1042_W/1042.json', name: '1042.json' }],
  }
  const files = {
    'Wasserzähler - Ablesung/EBG/Musterort/Ablesung_Musterort_2026.json': waterList,
    'Objektpruefprotokolle/Stammdaten/Kunden.json': kunden,
    'Stammdaten/Kunden.json': kunden,
    'Objektpruefprotokolle/Stammdaten/Objekte.json': objekte,
    'Objektpruefprotokolle/Objekte/OBJ/2026-09-24_Q3/2026-09-24_S-mf3k.json': kontrolle,
    'Objektdoku/1042_W/1042.json': akte,
  }
  const store = { listTree: async (dir, opts) => tree[dir] || [], readRoot: async (p) => files[p] || null }
  const res = await scanLegacy(store)
  assert.equal(res.files.length, 5, 'Kundenstamm nur einmal, PDF nicht')
  const found = classifyLegacy(res.files)
  assert.deepEqual([found.water.length, found.customers.length, found.objects.length, found.inspections.length, found.akten.length], [1, 1, 1, 1, 1])
})
