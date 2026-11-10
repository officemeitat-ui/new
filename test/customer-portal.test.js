// Kundenbereich (core/customer-portal.js, kunden.php): Links, freigegebene Monate, Termine ohne
// Namen, was je Link an den Webspace geht, Meldungen → Reklamationen, Stand zurück, E-Mail-Text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { complaintFromReport, contactText, CUSTOMER_KINDS, customerAppointments, customerLink, FILE_PATTERN, fileName, isActive, linkMail, linkPayload, linkState, markSent, newLinkId, newReports, PORTAL_SOURCE, releasedMonths, reportStatus, SHOW, showDefaults, stableJson, statusUpdates, upcomingDates, upcomingServices } from '../src/core/customer-portal.js'
import { SOURCES } from '../src/core/complaints.js'
import { winterLogDocument } from '../src/export/winter-pdf.js'
import { dataRights, MODULE_DOCS } from '../src/storage/data-service.js'
import { resolveAccess } from '../src/core/access.js'

const PHP = readFileSync(new URL('../kunden.php', import.meta.url), 'utf8')

test('Kundenbereich: Link enthält nur den Code, Kennung des Links', () => {
  assert.equal(customerLink('https://app.cleanos.at', 'Abc123xyz'), 'https://app.cleanos.at/kunden.php?k=Abc123xyz')
  assert.equal(customerLink('https://app.cleanos.at/', 'Abc'), 'https://app.cleanos.at/kunden.php?k=Abc')
  assert.equal(newLinkId(() => new Uint8Array([0, 15, 160, 255, 1])), 'kb000fa0ff01')
  assert.match(newLinkId(), /^kb[a-f0-9]{10}$/)
  assert.ok(isActive({ token: 'x' }) && !isActive({ token: 'x', revokedAt: '2026-11-01' }) && !isActive({}))
  assert.deepEqual([linkState({ revokedAt: 'x' }).key, linkState({ error: 'kaputt' }).key, linkState({}).key, linkState({ publishedAt: 'x' }).key], ['gesperrt', 'fehler', 'neu', 'aktiv'])
  // PHP prüft dasselbe Muster für Link-Kennungen
  assert.ok(PHP.includes("const LINK_MUSTER = '/^kb[a-f0-9]{10}$/';"))
})

test('Kundenbereich: freigegebene Monate (Vormonat erst ab dem Freigabetag), Dateinamen ohne Namen', () => {
  assert.deepEqual(releasedMonths({ today: '2026-11-04', count: 3, releaseDay: 5 }), ['2026-09', '2026-08', '2026-07'])
  assert.deepEqual(releasedMonths({ today: '2026-11-05', count: 3, releaseDay: 5 }), ['2026-10', '2026-09', '2026-08'])
  assert.deepEqual(releasedMonths({ today: '2027-01-20', count: 2 }), ['2026-12', '2026-11'], 'über den Jahreswechsel')
  assert.deepEqual(releasedMonths({ today: '2027-02-01', count: 2, releaseDay: 1 }), ['2027-01', '2026-12'])
  assert.deepEqual(releasedMonths({ today: '2027-02-01', count: 0 }), [])
  assert.equal(fileName('2026-10', 'leistung', 2), '2026-10-leistung-2.pdf')
  assert.ok(FILE_PATTERN.test('2026-10-winter-12.pdf') && !FILE_PATTERN.test('../2026-10-winter-1.pdf') && !FILE_PATTERN.test('2026-10-leistung-Lehen.pdf'))
  assert.ok(PHP.includes(`const DATEI_MUSTER = '/${FILE_PATTERN.source}/';`), 'gleiches Muster in kunden.php')
})

const task = (id, rec, label) => ({ id, label, recurrence: rec })
const TASKS = [task('t1', { type: 'weekly', everyWeeks: 1 }, 'Unterhaltsreinigung'), task('t2', { type: 'monthly', everyMonths: 3 }, 'Glasreinigung'), task('t3', { type: 'once', date: '2026-11-20' }, 'Grundreinigung'), task('t4', { type: 'weekly', everyWeeks: 2 }, 'Tiefgarage')]
const inst = (taskId, date, over = {}) => ({ key: `${date}|${taskId}`, taskId, objectId: 'o1', date, start: 0, startTime: '08:00', endTime: '12:00', label: TASKS.find((t) => t.id === taskId).label, status: 'normal', ...over })

test('Kundenbereich: nächste periodische Leistungen ohne wöchentliche, entfallene und fremde Objekte', () => {
  const instances = [
    inst('t1', '2026-11-09'),
    inst('t2', '2026-11-12', { start: 600 }),
    inst('t3', '2026-11-20', { status: 'moved', reason: 'holiday' }),
    inst('t4', '2026-11-10', { status: 'cancelled' }),
    inst('t4', '2026-11-24', { objectId: 'o2' }),
    inst('t2', '2027-03-12'),
  ]
  const objectsById = new Map([['o1', { name: 'Wohnanlage Lehen' }]])
  const list = upcomingServices({ instances, tasks: TASKS, objectIds: ['o1'], from: '2026-11-04', to: '2027-02-01', objectsById })
  assert.deepEqual(list, [
    { datum: '2026-11-12', zeit: '08:00–12:00', titel: 'Glasreinigung', art: 'leistung', objekt: 'Wohnanlage Lehen', hinweis: 'quartalsweise' },
    { datum: '2026-11-20', zeit: '08:00–12:00', titel: 'Grundreinigung', art: 'leistung', objekt: 'Wohnanlage Lehen', hinweis: 'einmalig, wegen Feiertag verschoben' },
  ])
  assert.ok(!JSON.stringify(list).includes('assigned') && !JSON.stringify(list).includes('employee'), 'keine Personen')
})

test('Kundenbereich: Kundentermine und Begehungen, keine Kontrollen, keine Notizen und Teilnehmenden', () => {
  const items = [
    { id: 'a1', kind: 'kunde', title: 'Jahresgespräch Hausverwaltung', objectId: 'o1', start: '2026-11-10T10:00', end: '2026-11-10T11:00', note: 'intern: Preis erhöhen', attendees: [{ email: 'x@y.at', name: 'Frau X' }], employeeIds: ['e1'] },
    { id: 'a2', kind: 'kontrolle', title: 'Qualitätskontrolle unangekündigt', objectId: 'o1', start: '2026-11-11T08:00', end: '2026-11-11T09:00' },
    { id: 'a3', kind: 'begehung', title: 'Begehung Tiefgarage', objectId: 'o1', allDay: true, start: '2026-11-18', end: '2026-11-18' },
    { id: 'a4', kind: 'kunde', title: 'Anderer Kunde', objectId: 'o9', start: '2026-11-12T10:00', end: '2026-11-12T11:00' },
    { id: 'a5', kind: 'kunde', title: 'Abgesagt', objectId: 'o1', cancelled: true, start: '2026-11-13T10:00', end: '2026-11-13T11:00' },
    { id: 'a6', kind: 'schulung', title: 'Schulung', objectId: 'o1', start: '2026-11-14T10:00', end: '2026-11-14T11:00' },
  ]
  const list = customerAppointments(items, { objectIds: ['o1'], from: '2026-11-04', to: '2027-02-01', objectsById: new Map([['o1', { name: 'Lehen' }]]) })
  assert.deepEqual(list, [
    { datum: '2026-11-10', zeit: '10:00–11:00', titel: 'Jahresgespräch Hausverwaltung', art: 'termin', objekt: 'Lehen', hinweis: 'Kundentermin' },
    { datum: '2026-11-18', zeit: 'ganztägig', titel: 'Begehung Tiefgarage', art: 'termin', objekt: 'Lehen', hinweis: 'Objektbegehung' },
  ])
  assert.ok(!/intern|Frau X|e1/.test(JSON.stringify(list)))
  const both = upcomingDates({ services: [{ datum: '2026-11-10', zeit: '08:00–12:00', titel: 'Glas', art: 'leistung' }], appointments: list, max: 2 })
  assert.deepEqual(both.map((x) => x.titel), ['Glas', 'Jahresgespräch Hausverwaltung'])
})

test('Kundenbereich: was ein Link an den Webspace schickt (nur seine Objekte, nur was er zeigt, kein Code)', () => {
  const link = { id: 'kb0123456789', title: 'Hausverwaltung Muster', objectIds: ['o1', 'o2'], token: 'GeheimerCode1234567890', show: { ...showDefaults(), winter: false, termine: false } }
  const objectsById = new Map([['o1', { name: 'Lehen', address: 'Ignaz-Harrer-Straße 10' }], ['o2', { name: 'Itzling', address: '' }], ['o3', { name: 'Fremd' }]])
  const termine = [{ datum: '2026-11-12', art: 'leistung', titel: 'Glas' }, { datum: '2026-11-13', art: 'termin', titel: 'Begehung' }]
  const nachweise = [{ datei: '2026-10-leistung-1.pdf', art: 'leistung' }, { datei: '2026-10-winter-1.pdf', art: 'winter' }]
  const p = linkPayload({ link, hash: 'h'.repeat(64), objectsById, termine, nachweise })
  assert.deepEqual(p.objekte, [{ nr: 1, id: 'o1', name: 'Lehen', adresse: 'Ignaz-Harrer-Straße 10' }, { nr: 2, id: 'o2', name: 'Itzling', adresse: '' }])
  assert.deepEqual(p.termine.map((t) => t.titel), ['Glas'])
  assert.deepEqual(p.nachweise.map((n) => n.datei), ['2026-10-leistung-1.pdf'])
  assert.equal(p.hash, 'h'.repeat(64))
  assert.ok(!JSON.stringify(p).includes('GeheimerCode') && !JSON.stringify(p).includes('Fremd'))
  assert.deepEqual(Object.keys(p.zeige).sort(), Object.keys(SHOW).sort())
  // ohne Recht auf den Plan: null = Webspace behält den letzten Stand
  const keep = linkPayload({ link, hash: 'h'.repeat(64), objectsById })
  assert.equal(keep.termine, null)
  assert.equal(keep.nachweise, null)
  // PHP kennt dieselben Schalter
  for (const k of Object.keys(SHOW)) assert.ok(PHP.includes(`'${k}'`), k)
})

test('Kundenbereich: Meldung → Reklamation mit Eingang „Kundenbereich“, Stand zurück ohne Maßnahme', () => {
  assert.ok(SOURCES.includes(PORTAL_SOURCE), 'Quelle im Reklamations-Dialog wählbar')
  for (const k of CUSTOMER_KINDS) assert.ok(PHP.includes(`'${k}' =>`), `Art ${k} in kunden.php`)
  const m = { id: 'a1b2c3d4e5f6', link: 'kb0123456789', objektId: 'o1', art: 'Schaden', datum: '2026-11-03', text: 'Glastür zerkratzt', kontakt: { name: 'Maria Huber', telefon: '0662 123', email: '' }, foto: 'a1b2c3d4e5f6.jpg', erstellt: Date.parse('2026-11-04T08:00:00Z') / 1000, status: 'eingegangen' }
  const c = complaintFromReport(m, { link: { id: 'kb0123456789', title: 'HV Muster' } })
  assert.equal(c.id, 'rka1b2c3d4e5f6')
  assert.deepEqual([c.source, c.kind, c.objectId, c.date, c.status, c.due, c.contact], ['Kundenbereich', 'Schaden', 'o1', '2026-11-03', 'offen', '2026-11-07', 'Maria Huber, 0662 123'])
  assert.deepEqual(c.employees, [])
  assert.deepEqual(c.portal, { id: 'a1b2c3d4e5f6', link: 'kb0123456789', sent: 'eingegangen|' })
  assert.match(c.history[0].text, /Kundenbereich \(HV Muster\)/)
  assert.equal(complaintFromReport({ ...m, art: 'Gehaltserhöhung' }).kind, 'Sonstiges')
  assert.equal(contactText({ name: ' A ', email: 'a@b.at' }), 'A, a@b.at')

  // Stand: nichts zu melden, solange offen; in Arbeit; erledigt mit Ergebnis (Maßnahme bleibt intern)
  assert.deepEqual(statusUpdates([c]), [])
  const work = { ...c, status: 'arbeit', measure: 'Gespräch mit Frau K.' }
  assert.deepEqual(statusUpdates([work]), [{ id: 'a1b2c3d4e5f6', status: 'arbeit', antwort: '' }])
  const done = { ...markSent(work), status: 'erledigt', result: 'Glastür poliert, Kratzer entfernt.' }
  assert.deepEqual(reportStatus(done), { id: 'a1b2c3d4e5f6', status: 'erledigt', antwort: 'Glastür poliert, Kratzer entfernt.' })
  assert.ok(!JSON.stringify(statusUpdates([done])).includes('Frau K.'))
  assert.deepEqual(statusUpdates([markSent(done), { id: 'r1', status: 'arbeit' }]), [], 'gemeldet; Reklamationen ohne Kundenbereich nie')

  // neue Meldungen: noch nicht in der App, von niemandem übernommen, gültige Kennung
  const list = [m, { ...m, id: 'bbbbbbbbbbbb', uebernommen: 1 }, { ...m, id: '../x' }, { ...m, id: 'cccccccccccc' }]
  assert.deepEqual(newReports(list, [c]).map((x) => x.id), ['cccccccccccc'])
})

test('Meldung nach Mitternacht: Tag und Frist der Reklamation nach dem Tag in Wien (Kundenbereich und Aushang)', () => {
  // eingegangen am Mo 2.11.2026 um 0:20 Uhr in Wien = 1.11. 23:20 UTC
  const erstellt = Date.parse('2026-11-01T23:20:00Z') / 1000
  const kb = complaintFromReport({ id: 'a1b2c3d4e5f6', link: 'kb0123456789', objektId: 'o1', art: 'Schaden', text: 'Glastür zerkratzt', erstellt })
  assert.equal(kb.received, '2026-11-01T23:20:00.000Z', 'der Zeitpunkt bleibt in UTC')
  assert.deepEqual([kb.date, kb.due], ['2026-11-02', '2026-11-05'], 'ohne Datum der Tag des Eingangs; Schaden: 3 Tage ab dem Eingang')
  const ah = complaintFromReport({ id: 'b1b2c3d4e5f6', quelle: 'aushang', aushang: 'ah0123456789', objektId: 'o5', kategorie: 'winterdienst', datum: '2026-11-02', text: 'Nicht gestreut', erstellt })
  assert.deepEqual([ah.date, ah.due], ['2026-11-02', '2026-11-03'], 'Winterdienst: 1 Tag ab dem Eingang, nicht ab dem UTC-Tag')
  // Sommerzeit: 1:30 Uhr am 1.7. ist 30.6. 23:30 UTC
  assert.equal(complaintFromReport({ id: 'c1b2c3d4e5f6', link: 'kb0123456789', art: 'Sonstiges', text: 'x', erstellt: Date.parse('2026-06-30T23:30:00Z') / 1000 }).date, '2026-07-01')
})

test('Kundenbereich: E-Mail mit dem Link in der Sie-Form', () => {
  const mail = linkMail({ link: { title: 'Wohnanlage Lehen', show: { ...showDefaults(), winter: false } }, url: 'https://app.cleanos.at/kunden.php?k=Abc', company: 'Cleanos', sender: 'Eva Büro', phone: '0662 1234' })
  assert.equal(mail.subject, 'Ihr Kundenbereich bei Cleanos: Wohnanlage Lehen')
  assert.match(mail.text, /^Sehr geehrte Damen und Herren,/)
  assert.match(mail.text, /https:\/\/app\.cleanos\.at\/kunden\.php\?k=Abc/)
  assert.match(mail.text, /Leistungsnachweise als PDF, die nächsten Termine in Ihrem Objekt und die Möglichkeit, eine Reklamation/)
  assert.match(mail.text, /0662 1234/)
  assert.ok(!/\b(du|dein|dich)\b/i.test(mail.text) && !/Winterdienst/.test(mail.text))
})

test('Kundenbereich: Winterdienst-Nachweis ohne Namen, mit Vornamen oder ganz', () => {
  const log = { a: { id: 'a', date: '2026-12-02', objectId: 'o5', at: '2026-12-02T04:40:00Z', person: 'Elif Yilmaz', geraeumt: true, fotos: [] } }
  const objects = [{ id: 'o5', name: 'Wohnanlage Rif' }]
  const body = (names) => JSON.stringify(winterLogDocument({ month: '2026-12', log, objects, objectId: 'o5', names }).content.find((x) => x.table).table.body)
  assert.ok(!/Elif|Durchgeführt von/.test(body('keine')))
  assert.ok(/"Elif"/.test(body('vorname')) && !/Yilmaz/.test(body('vorname')))
  assert.ok(/Elif Yilmaz/.test(body()) && /Durchgeführt von/.test(body()), 'Standard wie bisher')
})

test('Kundenbereich: Signatur unabhängig von der Reihenfolge, Ablage nur für Reklamationen oder Planung', () => {
  assert.equal(stableJson({ b: 1, a: [{ d: 2, c: null }] }), stableJson({ a: [{ c: null, d: 2 }], b: 1 }))
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }))
  const path = MODULE_DOCS.kundenbereich.path
  assert.equal(path, 'kundenbereich/kundenbereich.json')
  const rights = (role) => dataRights(resolveAccess({ roleClaims: [role], strict: true }))
  for (const role of ['objektmanagement', 'objektleitung', 'objektservice']) assert.ok(rights(role).read(path) && rights(role).write(path), role)
  for (const role of ['lesen', 'lager', 'buchhaltung', 'lohnverrechnung', 'vorarbeiter']) assert.ok(!rights(role).read(path), role)
})

test('Stand im Objekt: zuletzt/kommend aus dem Plan, erledigt mit Stempelung oder Checkliste, Winterdienst, Meldungen ohne Text', async () => {
  const { objectStatus, confirmedKeys, linkPayload, showDefaults } = await import('../src/core/customer-portal.js')
  const today = '2026-11-10'
  const inst = (date, startTime, endTime, extra = {}) => ({ key: `${date}|t1`, objectId: 'o1', date, startTime, endTime, start: Date.parse(`${date}T${startTime}:00Z`) / 60000, label: 'Unterhaltsreinigung', status: 'planned', ...extra })
  const instances = [
    inst('2026-10-20', '06:00', '08:30'), // älter als 14 Tage
    inst('2026-11-06', '06:00', '08:30'),
    inst('2026-11-09', '06:00', '08:30'),
    inst('2026-11-10', '06:00', '08:30'),
    inst('2026-11-11', '06:00', '08:30', { status: 'cancelled' }),
    inst('2026-11-12', '06:00', '08:30'),
    { ...inst('2026-11-12', '09:00', '10:00'), objectId: 'o2' },
  ]
  const confirmed = confirmedKeys({ stamps: { a: { instKey: '2026-11-09|t1', in: '2026-11-09T05:02:00Z' }, b: { instKey: '2026-11-06|t1', in: null } }, checks: { c: { instKey: '2026-11-06|t1', finished: null }, d: { instKey: '2026-11-10|t1', finished: '2026-11-10T07:30:00Z' } } })
  assert.deepEqual([...confirmed].sort(), ['2026-11-09|t1', '2026-11-10|t1'])
  const winterlog = {
    x: { objectId: 'o1', date: '2026-11-08', at: '2026-11-08T04:40:00Z', geraeumt: true, gestreut: true, mittel: 'Splitt', person: 'Max' },
    y: { objectId: 'o1', date: '2026-11-01', at: '2026-11-01T04:40:00Z', geraeumt: true },
    z: { objectId: 'o1', date: '2026-11-09', at: '2026-11-09T05:00:00Z', geraeumt: true, test: true },
  }
  const complaints = [
    { objectId: 'o1', source: 'Kundenbereich', kind: 'Reinigung mangelhaft', status: 'offen', received: '2026-11-08T22:30:00Z', text: 'Stiege 2 schmutzig, Frau Maier' },
    { objectId: 'o1', source: 'Aushang (QR)', kind: 'Sonstiges', status: 'arbeit', received: '2026-11-07T10:00:00Z', text: 'x' },
    { objectId: 'o1', source: 'Intern', kind: 'Verhalten', status: 'offen', received: '2026-11-07T10:00:00Z' },
    { objectId: 'o1', source: 'Objektkontrolle', kind: 'Reinigung mangelhaft', status: 'offen', received: '2026-11-07T10:00:00Z' },
    { objectId: 'o1', source: 'Kunde (Telefon)', kind: 'Schaden', status: 'erledigt', received: '2026-10-20T10:00:00Z', doneAt: '2026-10-25T10:00:00Z' },
    { objectId: 'o1', source: 'Kunde (Telefon)', kind: 'Schaden', status: 'erledigt', received: '2026-09-01T10:00:00Z', doneAt: '2026-09-02T10:00:00Z' },
  ]
  const objectsById = new Map([['o1', { name: 'Wohnanlage Rif' }]])
  const [s] = objectStatus({ objectIds: ['o1'], instances, today, confirmed, winterlog, complaints, objectsById })
  assert.equal(s.objekt, 'Wohnanlage Rif')
  assert.deepEqual(s.einsaetze.map((e) => [e.datum, e.bestaetigt || false]), [['2026-11-06', false], ['2026-11-09', true], ['2026-11-10', true], ['2026-11-12', false]], 'ohne alte, entfallene und andere Objekte')
  assert.deepEqual(s.einsaetze[0], { datum: '2026-11-06', von: '06:00', bis: '08:30', titel: 'Unterhaltsreinigung' })
  assert.deepEqual(s.winter, { datum: '2026-11-08', uhr: '05:40', was: 'geräumt, gestreut (Splitt)' }, 'ohne Testeintrag und ohne Namen')
  assert.deepEqual(s.meldungen, [
    { datum: '2026-11-07', art: 'Sonstiges', stand: 'arbeit' },
    { datum: '2026-11-08', art: 'Reinigung mangelhaft', stand: 'eingegangen' },
  ], 'nur Kunde und Aushang, Tag in Wien (23:30), ohne Text')
  assert.equal(s.erledigt30, 1)
  assert.ok(!JSON.stringify(s).includes('Maier') && !JSON.stringify(s).includes('Max'))
  // ohne Recht auf die Reklamationen: null (der Webspace behält die alten)
  const [n] = objectStatus({ objectIds: ['o1'], instances, today, complaints: null })
  assert.equal(n.meldungen, null)
  assert.equal(n.erledigt30, null)
  // Link: Standard aus; eingeschaltet geht der Stand mit, ohne Plan-Recht null
  assert.equal(showDefaults().status, false)
  assert.deepEqual(linkPayload({ link: { id: 'kb1', objectIds: [] }, hash: 'h', status: [s] }).status, [])
  assert.deepEqual(linkPayload({ link: { id: 'kb1', objectIds: [], show: { status: true } }, hash: 'h', status: [s] }).status, [s])
  assert.equal(linkPayload({ link: { id: 'kb1', objectIds: [], show: { status: true } }, hash: 'h' }).status, null)
})
