// KI beim Erfassen (core/ki-vorschlag.js, ai/extract.js): Anfragen, Prüfung der Antworten (Summen, Steuersätze,
// Datum, UID, IBAN), Lieferanten-Zuordnung, Diktat → Felder (Personen, Zeiten, Lager-Artikel), Texte (Reklamation
// ohne Schuldanerkenntnis, Mahnung mit unveränderten Angaben), Sicherheitsdatenblatt. Die KI ist eine Attrappe.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { draftComplaintReply, extractSdb, improveReminderText, readBeleg, readDiktat } from '../src/ai/extract.js'
import {
  antwortWarnings,
  BELEG_SCHEMA,
  belegRequest,
  checkBeleg,
  checkDiktat,
  checkFacts,
  checkSdb,
  DIKTAT_SCHEMA,
  kiErrorInfo,
  matchArticle,
  matchEmployee,
  matchSupplierKi,
  maxUploadBytes,
  parseKiJson,
  pdfPageCount,
  SDB_SCHEMA,
  textFacts,
  validDate,
} from '../src/core/ki-vorschlag.js'

const TODAY = '2026-11-06'
const OURS = { name: 'Cleanos Gebäudereinigung GmbH', uid: 'ATU87654321' }
const IBAN = 'AT611904300234573201'
const beleg = (patch = {}) => ({
  ist_rechnung: true,
  lieferant: { name: 'Reinigungsbedarf Muster GmbH', uid: 'ATU12345678', iban: IBAN, strasse: 'Industriestraße 5', plz: '5020', ort: 'Salzburg', land: 'AT' },
  empfaenger: { name: 'Cleanos Gebäudereinigung GmbH', uid: 'ATU 87654321' },
  rechnungsnummer: 'R-2026-118',
  rechnungsdatum: '2026-11-02',
  leistung_von: '2026-10-30',
  leistung_bis: '',
  faellig_am: '2026-11-16',
  waehrung: 'EUR',
  steuersaetze: [{ satz: 20, netto: 250, ust: 50 }],
  netto: 250,
  ust: 50,
  brutto: 300,
  reverse_charge: false,
  hinweis_steuerschuld: false,
  skonto_prozent: 2,
  skonto_tage: 10,
  positionen: ['20 Kanister Allzweckreiniger 10 l', '5 Rollen Müllsäcke 120 l'],
  unsicher: '',
  ...patch,
})
const errors = (r) => r.problems.filter((p) => p.level === 'error').map((p) => p.text)
const warnings = (r) => r.problems.filter((p) => p.level === 'warning').map((p) => p.text)

/** Schema für strukturierte Ausgabe: jedes Objekt mit allen Feldern Pflicht und ohne weitere Felder. */
function strict(schema, path = '') {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${path}: additionalProperties`)
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path}: required`)
    for (const [k, v] of Object.entries(schema.properties)) strict(v, `${path}.${k}`)
  }
  if (schema.type === 'array') strict(schema.items, `${path}[]`)
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) assert.ok(!(k in schema), `${path}: ${k} wird von der strukturierten Ausgabe nicht unterstützt`)
}

// ---------------------------------------------------------------- Beleg

test('Beleg: Anfrage mit Bild bzw. PDF als base64, Schema streng, eigene Firma nur als Name', () => {
  strict(BELEG_SCHEMA)
  strict(DIKTAT_SCHEMA)
  strict(SDB_SCHEMA)
  const img = belegRequest({ kind: 'image', mediaType: 'image/jpeg', data: 'QUJD' }, { ours: OURS, today: TODAY })
  const [block, text] = img.messages[0].content
  assert.deepEqual(block, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
  assert.match(text.text, /Cleanos Gebäudereinigung GmbH/)
  assert.ok(!text.text.includes('ATU87654321'), 'unsere UID muss nicht mit')
  assert.equal(img.output_config.format.type, 'json_schema')
  assert.equal(img.output_config.format.schema, BELEG_SCHEMA)
  const pdf = belegRequest({ kind: 'pdf', data: 'JVBERi0=' })
  assert.deepEqual(pdf.messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } })
  assert.ok(!('model' in img) && !('max_tokens' in img), 'Modell und Obergrenze bestimmt ki.php bzw. client.js')
})

test('Beleg: stimmige Rechnung → Felder, Lieferant, Prüfkästchen als Vorschlag', () => {
  const r = checkBeleg(beleg(), { today: TODAY, ours: OURS })
  assert.equal(r.ok, true, JSON.stringify(r.problems))
  assert.deepEqual(r.fields.groups, [{ rate: 20, net: 250, vat: 50 }])
  assert.equal(r.fields.number, 'R-2026-118')
  assert.equal(r.fields.date, '2026-11-02')
  assert.equal(r.fields.serviceFrom, '2026-10-30')
  assert.equal(r.fields.dueDate, '2026-11-16')
  assert.deepEqual(r.fields.skonto, { percent: 2, days: 10 })
  assert.match(r.fields.text, /20 Kanister Allzweckreiniger 10 l; 5 Rollen/)
  assert.deepEqual(r.fields.checks, { recipient: true, ourUid: true, rcNote: false })
  assert.equal(r.supplier.uid, 'ATU12345678')
  assert.equal(r.supplier.iban, IBAN)
  assert.equal(r.supplier.city, 'Salzburg')
})

test('Beleg: Summen, Steuersätze, Datum, UID und IBAN werden geprüft', () => {
  // Summen stimmen nicht
  let r = checkBeleg(beleg({ brutto: 310 }), { today: TODAY, ours: OURS })
  assert.equal(r.ok, false)
  assert.ok(errors(r).some((t) => /Summen stimmen nicht/.test(t)), errors(r).join())
  r = checkBeleg(beleg({ steuersaetze: [{ satz: 20, netto: 240, ust: 48 }] }), { today: TODAY })
  assert.ok(errors(r).some((t) => /Netto je Steuersatz/.test(t)))
  // Steuer passt nicht zum Satz
  r = checkBeleg(beleg({ steuersaetze: [{ satz: 20, netto: 250, ust: 40 }], ust: 40, brutto: 290 }), { today: TODAY })
  assert.ok(warnings(r).some((t) => /passt nicht zu 20 %/.test(t)))
  // Steuersatz gibt es in Österreich nicht: nicht übernommen
  r = checkBeleg(beleg({ steuersaetze: [{ satz: 19, netto: 250, ust: 47.5 }], ust: 47.5, brutto: 297.5 }), { today: TODAY })
  assert.ok(errors(r).some((t) => /19 % gibt es in Österreich nicht/.test(t)))
  assert.deepEqual(r.fields.groups, [])
  // zwei Sätze (Reinigungsmittel 20 %, Lebensmittel für die Kantine 10 %)
  r = checkBeleg(beleg({ steuersaetze: [{ satz: 20, netto: 100, ust: 20 }, { satz: 10, netto: 50, ust: 5 }, { satz: 20, netto: 10, ust: 2 }], netto: 160, ust: 27, brutto: 187 }), { today: TODAY })
  assert.equal(r.ok, true, JSON.stringify(r.problems))
  assert.deepEqual(r.fields.groups, [{ rate: 20, net: 110, vat: 22 }, { rate: 10, net: 50, vat: 5 }])
  // Datum: ungültig, in der Zukunft, Fälligkeit davor
  assert.ok(errors(checkBeleg(beleg({ rechnungsdatum: '2026-02-30' }), { today: TODAY })).some((t) => /kein gültiges Datum/.test(t)))
  r = checkBeleg(beleg({ rechnungsdatum: '2026-12-24' }), { today: TODAY })
  assert.ok(errors(r).some((t) => /in der Zukunft/.test(t)))
  assert.equal(r.fields.date, '')
  r = checkBeleg(beleg({ faellig_am: '2026-10-01' }), { today: TODAY })
  assert.equal(r.fields.dueDate, '')
  assert.ok(warnings(r).some((t) => /Fälligkeit liegt vor/.test(t)))
  // UID und IBAN mit falschem Format bzw. Prüfziffer: nicht übernommen
  r = checkBeleg(beleg({ lieferant: { ...beleg().lieferant, uid: 'ATU1234', iban: 'AT611904300234573202' } }), { today: TODAY })
  assert.equal(r.supplier.uid, '')
  assert.equal(r.supplier.iban, '')
  assert.equal(warnings(r).length, 2)
  // kein Beleg
  assert.equal(checkBeleg(beleg({ ist_rechnung: false }), { today: TODAY }).ok, false)
  // Empfänger ist nicht unsere Firma
  r = checkBeleg(beleg({ empfaenger: { name: 'Andere Firma KG', uid: '' } }), { today: TODAY, ours: OURS })
  assert.deepEqual(r.fields.checks, { recipient: false, ourUid: false, rcNote: false })
  assert.ok(warnings(r).some((t) => /Andere Firma KG/.test(t)))
  assert.ok(validDate('2028-02-29') && !validDate('2027-02-29') && !validDate('06.11.2026'))
})

test('Beleg: Reverse Charge, Steuersatz aus den Gesamtbeträgen, Währung', () => {
  let r = checkBeleg(beleg({ steuersaetze: [{ satz: 0, netto: 1200, ust: 0 }], netto: 1200, ust: 0, brutto: 1200, reverse_charge: true, hinweis_steuerschuld: true }), { today: TODAY, ours: OURS })
  assert.equal(r.ok, true, JSON.stringify(r.problems))
  assert.equal(r.fields.reverseCharge, true)
  assert.equal(r.fields.checks.rcNote, true)
  r = checkBeleg(beleg({ steuersaetze: [{ satz: 20, netto: 1200, ust: 240 }], netto: 1200, ust: 240, brutto: 1440, reverse_charge: true }), { today: TODAY })
  assert.ok(warnings(r).some((t) => /Reverse Charge, aber/.test(t)))
  assert.ok(warnings(r).some((t) => /ohne gedruckten Hinweis/.test(t)))
  // ohne Aufteilung: nur ein Satz passt genau
  r = checkBeleg(beleg({ steuersaetze: [], netto: 100, ust: 13, brutto: 113 }), { today: TODAY })
  assert.deepEqual(r.fields.groups, [{ rate: 13, net: 100, vat: 13 }])
  assert.ok(r.problems.some((p) => p.level === 'info' && /abgeleitet/.test(p.text)))
  r = checkBeleg(beleg({ steuersaetze: [], netto: 0, ust: 0, brutto: 59.9 }), { today: TODAY })
  assert.deepEqual(r.fields.groups, [])
  assert.ok(warnings(r).some((t) => /je Steuersatz nicht lesbar/.test(t)))
  assert.ok(warnings(checkBeleg(beleg({ waehrung: 'CHF' }), { today: TODAY })).some((t) => /CHF/.test(t)))
})

test('Lieferant: über UID, IBAN oder Namen zugeordnet, sonst neu; abweichende IBAN wird gemeldet', () => {
  const suppliers = [
    { id: 's1', name: 'Reinigungsbedarf Muster GmbH', uid: 'ATU12345678', iban: IBAN },
    { id: 's2', name: 'Papier & Co KG', uid: '', iban: 'DE89370400440532013000' },
    { id: 's3', name: 'Alte Firma', uid: 'ATU99999999', active: false },
  ]
  let m = matchSupplierKi(suppliers, { name: 'Muster Reinigungsbedarf', uid: 'ATU 12345678', iban: IBAN })
  assert.equal(m.supplier.id, 's1')
  assert.equal(m.via, 'uid')
  assert.deepEqual(m.warnings, [])
  m = matchSupplierKi(suppliers, { name: 'Papier und Co', iban: 'DE89 3704 0044 0532 0130 00' })
  assert.equal(m.supplier.id, 's2')
  assert.equal(m.via, 'iban')
  m = matchSupplierKi(suppliers, { name: 'Papier & Co' })
  assert.equal(m.supplier.id, 's2')
  assert.equal(m.via, 'name')
  // gleiche UID, andere IBAN: Warnung (gefälschte Rechnung?)
  m = matchSupplierKi(suppliers, { name: 'Reinigungsbedarf Muster GmbH', uid: 'ATU12345678', iban: 'DE89370400440532013000' })
  assert.equal(m.supplier.id, 's1')
  assert.ok(m.warnings.some((w) => /nicht die gespeicherte/.test(w)))
  assert.ok(m.warnings.some((w) => /Papier & Co KG/.test(w)))
  // inaktive Lieferanten zählen nicht; unbekannt → neu vorgeschlagen
  m = matchSupplierKi(suppliers, { name: 'Alte Firma', uid: 'ATU99999999', iban: '', street: 'Weg 1', zip: '5020', city: 'Salzburg' })
  assert.equal(m.supplier, null)
  assert.deepEqual(m.newSupplier, { name: 'Alte Firma', street: 'Weg 1', zip: '5020', city: 'Salzburg', country: 'AT', uid: 'ATU99999999', iban: '' })
  assert.equal(matchSupplierKi(suppliers, {}).newSupplier, null)
})

test('Beleg lesen mit Attrappe: Anfrage geht über send, Antwort wird geprüft', async () => {
  const calls = []
  const send = async (params, opts) => {
    calls.push({ params, opts })
    return `Hier das Ergebnis:\n${JSON.stringify(beleg())}`
  }
  const r = await readBeleg({ kind: 'image', mediaType: 'image/jpeg', data: 'QUJD' }, { ours: OURS, today: TODAY, send })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].opts.maxTokens, 16000)
  assert.equal(calls[0].params.messages[0].content[0].type, 'image')
  await assert.rejects(readBeleg({ kind: 'pdf', data: 'JVBERi0=' }, { today: TODAY, send: async () => 'kein JSON' }), /nicht lesbar/)
  assert.throws(() => parseKiJson('[]'), /nicht lesbar/)
})

// ---------------------------------------------------------------- Diktat

const EMPLOYEES = [
  { id: 'e1', name: 'Ana Novak' },
  { id: 'e2', name: 'Anton Huber' },
  { id: 'e3', name: 'Elif Kaya' },
  { id: 'e4', name: 'Maria Huber' },
]
const ARTICLES = [
  { id: 'a1', name: 'Müllsäcke 60 l', unit: 'Rolle' },
  { id: 'a2', name: 'Müllsäcke 120 l', unit: 'Rolle' },
  { id: 'a3', name: 'Flächendesinfektion 1 l', unit: 'Fl.' },
]

test('Diktat: Personen und Lager-Artikel zuordnen (eindeutig, sonst frei)', () => {
  assert.equal(matchEmployee(EMPLOYEES, 'Ana')?.id, 'e1')
  assert.equal(matchEmployee(EMPLOYEES, 'Frau Kaya')?.id, 'e3')
  assert.equal(matchEmployee(EMPLOYEES, 'elif kaya')?.id, 'e3')
  assert.equal(matchEmployee(EMPLOYEES, 'Huber'), null, 'zwei Huber: nicht eindeutig')
  assert.equal(matchEmployee(EMPLOYEES, 'Maria Huber')?.id, 'e4')
  assert.equal(matchEmployee(EMPLOYEES, 'Bernd'), null)
  assert.equal(matchArticle(ARTICLES, 'Müllsäcke 120 Liter')?.id, 'a2')
  assert.equal(matchArticle(ARTICLES, 'Müllsack 60 l')?.id, 'a1')
  assert.equal(matchArticle(ARTICLES, 'Müllsäcke'), null, 'ohne Größe nicht eindeutig')
  assert.equal(matchArticle(ARTICLES, 'Flächendesinfektion')?.id, 'a3')
  assert.equal(matchArticle(ARTICLES, 'Bautrocknerfolie'), null)
})

test('Diktat: Antwort → Felder, Zeiten (von–bis oder Dauer), Material; Unplausibles wird gemeldet', () => {
  const raw = {
    art: 'wasserschaden',
    leistung: 'Keller nach Wasserschaden',
    beschreibung: 'Wasser abgesaugt, Boden gereinigt und desinfiziert.',
    beauftragt_von: 'Frau Berger',
    funktion: 'Hausverwaltung',
    datum: '2026-11-05',
    personen: [
      { name: 'Ana', von: '8:00', bis: '11.30', pause_minuten: 0, stunden: 0 },
      { name: 'Elif Kaya', von: '', bis: '', pause_minuten: 0, stunden: 2.5 },
      { name: 'Bernd', von: '25:00', bis: '26:00', pause_minuten: 0, stunden: 0 },
      { name: 'Maria Huber', von: '13:00', bis: '14:00', pause_minuten: 90, stunden: 0 },
    ],
    material: [
      { bezeichnung: 'Müllsäcke 120 Liter', menge: 2, einheit: '' },
      { bezeichnung: 'Bautrocknerfolie', menge: 1.5, einheit: 'Rolle' },
      { bezeichnung: '', menge: 3, einheit: 'Stk' },
    ],
    unklar: 'Ob die Kellertür auch gereinigt wurde',
  }
  const r = checkDiktat(raw, { today: TODAY, employees: EMPLOYEES, articles: ARTICLES })
  assert.deepEqual(r.fields, { kind: 'wasserschaden', title: 'Keller nach Wasserschaden', description: 'Wasser abgesaugt, Boden gereinigt und desinfiziert.', orderedBy: 'Frau Berger', orderedRole: 'Hausverwaltung', date: '2026-11-05' })
  assert.deepEqual(r.workers[0], { name: 'Ana Novak', employeeId: 'e1', from: '08:00', to: '11:30', pause: '', dur: '' })
  assert.deepEqual(r.workers[1], { name: 'Elif Kaya', employeeId: 'e3', from: '', to: '', pause: '', dur: '2,5' })
  assert.deepEqual(r.workers[2], { name: 'Bernd', employeeId: '', from: '', to: '', pause: '', dur: '' })
  assert.equal(r.workers[3].pause, '', 'Pause länger als die Arbeitszeit')
  assert.deepEqual(r.material, [
    { articleId: 'a2', text: 'Müllsäcke 120 l', qty: '2', unit: 'Rolle' },
    { articleId: '', text: 'Bautrocknerfolie', qty: '1,5', unit: 'Rolle' },
  ])
  const texts = r.problems.map((p) => p.text).join(' | ')
  assert.match(texts, /Bernd: Uhrzeit „25:00–26:00“ nicht erkannt/)
  assert.match(texts, /„Bernd“ ist keiner Person eindeutig zugeordnet/)
  assert.match(texts, /Maria Huber: Pause länger/)
  assert.match(texts, /Unklar: Ob die Kellertür/)
  // Datum in der Zukunft oder zu alt: nicht übernommen; falsche Art: leer
  assert.equal(checkDiktat({ datum: '2026-11-07' }, { today: TODAY }).fields.date, undefined)
  assert.equal(checkDiktat({ datum: '2026-08-01' }, { today: TODAY }).fields.date, undefined)
  assert.equal(checkDiktat({ art: 'putzen' }, { today: TODAY }).fields.kind, undefined)
  assert.equal(checkDiktat({ personen: [{ name: 'Ana', stunden: 20 }] }, { today: TODAY, employees: EMPLOYEES }).workers[0].dur, '')
})

test('Diktat mit Attrappe: nur der Text geht weg (keine Namenslisten), leeres Diktat nicht', async () => {
  let sent = null
  const send = async (params) => {
    sent = params
    return JSON.stringify({ art: 'zusatz', leistung: 'Fenster Stiegenhaus', beschreibung: '', beauftragt_von: '', funktion: '', datum: '', personen: [{ name: 'Ana', von: '', bis: '', pause_minuten: 0, stunden: 1 }], material: [], unklar: '' })
  }
  const r = await readDiktat('Fenster im Stiegenhaus geputzt, Ana eine Stunde', { today: TODAY, employees: EMPLOYEES, articles: ARTICLES, send })
  assert.equal(r.workers[0].employeeId, 'e1')
  const wire = JSON.stringify(sent)
  assert.ok(!wire.includes('Novak') && !wire.includes('Müllsäcke 60'), 'Listen bleiben in der App')
  assert.match(wire, /Heute ist 2026-11-06/)
  await assert.rejects(readDiktat('  ', { send }), /sprechen oder den Bericht tippen/)
})

// ---------------------------------------------------------------- Texte

test('Reklamation: Antwort ohne Schuldanerkenntnis – Hinweise bei Zusage oder Haftung', async () => {
  assert.deepEqual(antwortWarnings('Es tut uns leid, dass die Reinigung nicht wie gewohnt war. Wir entschuldigen uns für die Unannehmlichkeiten.'), [])
  assert.deepEqual(antwortWarnings('Selbstverständlich übernehmen wir die Kosten.'), ['Kostenübernahme'])
  assert.ok(antwortWarnings('Das war unser Fehler, wir haften für den Schaden.').includes('Haftung'))
  assert.ok(antwortWarnings('Das war unser Fehler.').includes('eigener Fehler'))
  assert.ok(antwortWarnings('Sie erhalten eine Gutschrift.').includes('Gutschrift oder Entschädigung'))
  let sent = null
  const res = await draftComplaintReply(
    { objectName: 'Kanzlei Berger', kind: 'Reinigung mangelhaft', text: 'Staub auf den Fensterbänken', measure: 'Nachreinigung am Freitag', due: '2026-11-07', status: 'in Arbeit' },
    {
      send: async (params) => {
        sent = params
        return JSON.stringify({ betreff: 'Ihre Rückmeldung', text: 'Sehr geehrte Damen und Herren,\nwir übernehmen die Kosten.' })
      },
    },
  )
  assert.deepEqual(res.warnings, ['Kostenübernahme'])
  assert.match(sent.system[0].text, /Kein Schuldanerkenntnis/)
  assert.match(sent.messages[0].content, /Nachreinigung am Freitag/)
  await assert.rejects(draftComplaintReply({ text: '' }, { send: async () => '{}' }), /beschreiben/)
})

test('Mahnung: Beträge, Nummern, Daten und Platzhalter müssen unverändert bleiben', async () => {
  const original = 'Sehr geehrte Frau Berger,\n\nzu unserer Rechnung RE-2026-0012 vom 01.10.2026 ist noch € 1.234,56 offen. Bitte überweisen Sie € 1.274,56 bis 13.11.2026 auf AT61 1904 3002 3457 3201. {Gruss}'
  const facts = textFacts(original)
  for (const f of ['RE-2026-0012', '01.10.2026', '1.234,56', '1.274,56', '13.11.2026', 'AT61 1904 3002 3457 3201', '{Gruss}']) assert.ok(facts.includes(f), `${f} in ${facts.join(' | ')}`)
  const good = 'Sehr geehrte Frau Berger,\n\nunsere Rechnung RE-2026-0012 vom 01.10.2026 über 1.234,56 € ist leider noch offen. Wir bitten Sie, 1.274,56 € bis 13.11.2026 auf AT611904300234573201 zu überweisen. {Gruss}'
  assert.deepEqual(checkFacts(original, good, ['RE-2026-0012']), { ok: true, missing: [], added: [] })
  let c = checkFacts(original, good.replace('1.274,56', '1.247,56'), [])
  assert.equal(c.ok, false)
  assert.deepEqual(c.missing, ['1.274,56'])
  assert.deepEqual(c.added, ['1.247,56'])
  c = checkFacts(original, `${good} Zahlbar binnen 7 Tagen ab 20.11.2026.`, [])
  assert.deepEqual(c.added, ['20.11.2026'])
  assert.equal(checkFacts(original, '', []).ok, false)
  // Angabe aus den Daten, die nicht im Original steht, wird nicht verlangt
  assert.equal(checkFacts(original, good, ['RE-2099-0001']).ok, true)
  const res = await improveReminderText(original, { stage: 'Zahlungserinnerung', facts: ['RE-2026-0012'], send: async () => JSON.stringify({ text: good.replace('13.11.2026', '14.11.2026') }) })
  assert.equal(res.check.ok, false)
  assert.deepEqual(res.check.missing, ['13.11.2026'])
})

// ---------------------------------------------------------------- Sicherheitsdatenblatt

const pdf = (pages = 2) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} /Kids [] >> endobj\n%%EOF`).toString('base64')

test('Sicherheitsdatenblatt: Codes gesäubert und geprüft, Fassung als Datum', () => {
  const r = checkSdb({ ist_sdb: true, produkt: 'Sanitärreiniger Forte', hersteller: 'Muster Chemie GmbH', signalwort: 'Gefahr', ghs: ['GHS05', 'ghs07', 'GHS05 Ätzwirkung', 'Totenkopf'], h_saetze: ['H314: Verursacht schwere Verätzungen', 'H 290', 'EUH208', 'h314'], p_saetze: ['P280', 'P305 + P351 + P338', 'P501x'], fassung: '12.3.2025', unsicher: '' })
  assert.deepEqual({ ...r, hinweise: undefined }, { produkt: 'Sanitärreiniger Forte', hersteller: 'Muster Chemie GmbH', signalwort: 'Gefahr', ghs: ['GHS05', 'GHS07'], hSaetze: ['H314', 'H290', 'EUH208'], pSaetze: ['P280', 'P305+P351+P338'], fassung: '2025-03-12', hinweise: undefined })
  assert.equal(r.hinweise.length, 2, JSON.stringify(r.hinweise))
  // Gegenproben
  let x = checkSdb({ produkt: 'A', signalwort: '', ghs: ['GHS05'], h_saetze: ['H302'], p_saetze: [], fassung: '' })
  const t = x.hinweise.map((h) => h.text).join(' | ')
  assert.match(t, /Piktogramme ohne Signalwort/)
  assert.match(t, /GHS05 \(ätzend\) ohne passenden H-Satz/)
  x = checkSdb({ produkt: 'B', signalwort: 'Warning', ghs: [], h_saetze: [], p_saetze: [], fassung: 'Version 3.1' })
  assert.equal(x.signalwort, 'Achtung')
  assert.equal(x.fassung, 'Version 3.1')
  assert.throws(() => checkSdb({ ist_sdb: false }), /kein Sicherheitsdatenblatt/)
  assert.throws(() => checkSdb({ produkt: '', ghs: [], h_saetze: [] }), /nichts lesbar/)
})

test('Sicherheitsdatenblatt lesen mit Attrappe: PDF als Dokument, Grenzen, Prüfung', async () => {
  const calls = []
  const send = async (params, opts) => {
    calls.push({ params, opts })
    return JSON.stringify({ ist_sdb: true, produkt: 'Glasreiniger Klar', hersteller: 'Muster Chemie GmbH', signalwort: '', ghs: [], h_saetze: ['EUH210'], p_saetze: ['P102'], fassung: '2024-05-02', unsicher: '' })
  }
  const data = pdf(3)
  const r = await extractSdb(data, { send })
  assert.deepEqual(r, { produkt: 'Glasreiniger Klar', hersteller: 'Muster Chemie GmbH', signalwort: '', ghs: [], hSaetze: ['EUH210'], pSaetze: ['P102'], fassung: '2024-05-02', hinweise: [] })
  const [doc, text] = calls[0].params.messages[0].content
  assert.deepEqual(doc, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
  assert.equal(text.type, 'text')
  assert.equal(calls[0].params.output_config.format.schema, SDB_SCHEMA)
  assert.equal(calls[0].opts.maxTokens, 16000)
  // data:-Präfix und Zeilenumbrüche stören nicht
  await extractSdb(`data:application/pdf;base64,${data.slice(0, 8)}\n${data.slice(8)}`, { send })
  assert.equal(calls[1].params.messages[0].content[0].source.data, data)
  await assert.rejects(extractSdb('', { send }), /Kein PDF/)
  await assert.rejects(extractSdb(Buffer.from('<html></html>').toString('base64'), { send }), /kein PDF/)
  await assert.rejects(extractSdb(pdf(40), { send }), /40 Seiten/)
  await assert.rejects(extractSdb(data, { send: async () => JSON.stringify({ ist_sdb: false }) }), /kein Sicherheitsdatenblatt/)
  assert.equal(calls.length, 2, 'ungültige Dateien gehen nicht weg')
})

// ---------------------------------------------------------------- Grenzen, Fehler

test('Dateien und Fehler: Seiten zählen, Größe nach post_max_size, verständliche Meldungen', () => {
  assert.equal(pdfPageCount(Buffer.from(atob(pdf(4)), 'latin1')), 4)
  assert.equal(pdfPageCount('%PDF-1.4 << /Type /Page >> << /Type /Page >> << /Type /Pages >>'), 2)
  assert.equal(maxUploadBytes(0), 3 * 1024 * 1024)
  assert.equal(maxUploadBytes(8 * 1024 * 1024), 3 * 1024 * 1024)
  assert.ok(maxUploadBytes(2 * 1024 * 1024) < 1.5 * 1024 * 1024)
  assert.equal(kiErrorInfo({ status: 429, message: 'Tageslimit erreicht (150 Anfragen je Person). Morgen geht es weiter.' }).code, 'limit')
  assert.match(kiErrorInfo({ status: 429 }).text, /Tageslimit/)
  assert.match(kiErrorInfo({ status: 503 }).text, /nicht eingerichtet/)
  assert.match(kiErrorInfo({ status: 413, message: 'Anfrage zu groß.' }).text, /zu groß für die KI/)
  assert.match(kiErrorInfo({ status: 413, message: 'Die Datei ist zu groß für den Webspace (post_max_size 8 MB).' }).text, /post_max_size/)
  assert.equal(kiErrorInfo({ status: 401 }).code, 'auth')
  assert.equal(kiErrorInfo({ message: 'Failed to fetch' }).code, 'net')
  assert.equal(kiErrorInfo({ aborted: true }).code, 'stop')
})
