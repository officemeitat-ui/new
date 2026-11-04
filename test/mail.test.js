// E-Mail aus der App: Adressen, Betreff, CSV, mailto, Aufgabe mit Kalender-Erinnerung, Bericht-PDF.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { attachmentSize, formatAddress, listMail, MAIL_LIMIT, mailtoUrl, parseAddresses, reportMail, rowsToCsv, sizeText, subjectFromFile, taskMail } from '../src/core/mail.js'
import { MAX_ROWS, reportDocument } from '../src/export/report-pdf.js'

test('Adressen: Komma, Strichpunkt, Zeilenumbruch, mit Namen, ohne Doppelte', () => {
  const r = parseAddresses('Anna Berger <anna@firma.at>; b@x.at,\nANNA@firma.at ;; c.d+e@sub.domain.co.at')
  assert.deepEqual(r.valid, ['anna@firma.at', 'b@x.at', 'c.d+e@sub.domain.co.at'])
  assert.deepEqual(r.invalid, [])
})

test('Adressen: Ungültiges wird gemeldet, nicht stillschweigend verworfen', () => {
  const r = parseAddresses('anna@, @firma.at, max mustermann, ok@firma.at, a@b')
  assert.deepEqual(r.valid, ['ok@firma.at'])
  assert.deepEqual(r.invalid, ['anna@', '@firma.at', 'max mustermann', 'a@b'])
})

test('Adressen: leer und Leerzeichen', () => {
  assert.deepEqual(parseAddresses(''), { valid: [], invalid: [] })
  assert.deepEqual(parseAddresses('  ;  , \n'), { valid: [], invalid: [] })
  assert.deepEqual(parseAddresses(undefined), { valid: [], invalid: [] })
})

test('Adressen: Name mit Sonderzeichen wird bereinigt', () => {
  assert.equal(formatAddress('Berger, Anna <x>', 'anna@firma.at'), 'Berger Anna x <anna@firma.at>')
  assert.equal(formatAddress('', 'anna@firma.at'), 'anna@firma.at')
  // was formatAddress liefert, liest parseAddresses wieder
  assert.deepEqual(parseAddresses(formatAddress('Dr. Anna "Ani" Berger', 'anna@firma.at')).valid, ['anna@firma.at'])
})

test('Betreff aus dem Dateinamen', () => {
  assert.equal(subjectFromFile('Lagerbestand_2026-11-04.csv'), 'Lagerbestand 04.11.2026')
  assert.equal(subjectFromFile('Kalkulation_Wohnanlage-Lehen.pdf'), 'Kalkulation Wohnanlage Lehen')
  assert.equal(subjectFromFile('Materialverbrauch_2026-10-01_2026-10-31.csv'), 'Materialverbrauch 01.10.2026 31.10.2026')
  assert.equal(subjectFromFile('Wochenplan_KW45.xlsx'), 'Wochenplan KW45')
  assert.equal(subjectFromFile(''), '')
})

test('CSV wie Excel in Österreich: Strichpunkt, Anführungszeichen, BOM, CRLF', () => {
  const csv = rowsToCsv([
    ['Name', 'Notiz', 'Betrag'],
    ['Berger; Anna', 'sagt "hallo"', '12,50'],
    ['Huber', 'zwei\nZeilen', null],
  ])
  assert.ok(csv.startsWith('\ufeff'))
  assert.equal(csv, '\ufeffName;Notiz;Betrag\r\n"Berger; Anna";"sagt ""hallo""";12,50\r\nHuber;zwei Zeilen;\r\n')
})

test('Größe der Anhänge und Anzeige', () => {
  assert.equal(attachmentSize([{ blob: { size: 1000 } }, { size: 24 }, {}]), 1024)
  assert.equal(attachmentSize(), 0)
  assert.equal(sizeText(340 * 1024), '340 KB')
  assert.equal(sizeText(10), '1 KB')
  assert.equal(sizeText(1.25 * 1024 * 1024), '1,3 MB')
  assert.ok(MAIL_LIMIT < 4 * 1024 * 1024, 'unter der Graph-Grenze je Anfrage')
})

test('mailto: Leerzeichen als %20, Umlaute kodiert, @ lesbar, Text gekürzt', () => {
  const url = mailtoUrl({ to: ['anna@firma.at', 'b@x.at'], cc: ['c@x.at'], subject: 'Grüße aus Salzburg', body: 'a b' })
  assert.match(url, /^mailto:anna@firma\.at,b@x\.at\?/)
  assert.ok(!url.includes('+'))
  assert.match(url, /subject=Gr%C3%BC%C3%9Fe%20aus%20Salzburg/)
  assert.match(url, /cc=c%40x\.at/)
  const long = mailtoUrl({ to: ['a@b.at'], body: 'x'.repeat(5000) })
  assert.ok(long.length < 2000)
  assert.equal(mailtoUrl({ to: ['a@b.at'] }), 'mailto:a@b.at')
})

test('Aufgabe: Betreff mit Frist, Text mit Objekt und Absender, Kalender-Erinnerung', () => {
  const now = new Date('2026-11-04T10:00:00Z')
  const m = taskMail({ title: 'Glasreinigung nachbessern', due: '2026-11-10', object: 'Wohnanlage Lehen', description: 'Stiegenhaus 2', from: 'Petra Leitner' }, { now })
  assert.equal(m.subject, 'Aufgabe: Glasreinigung nachbessern (bis 10.11.)')
  assert.match(m.text, /Fällig bis: Di 10\.11\.2026/)
  assert.match(m.text, /Objekt: Wohnanlage Lehen/)
  assert.match(m.text, /Stiegenhaus 2/)
  assert.match(m.text, /Petra Leitner/)
  assert.match(m.ics, /BEGIN:VCALENDAR/)
  assert.match(m.ics, /DTSTART;VALUE=DATE:20261110/)
  assert.match(m.ics, /Fällig: Glasreinigung nachbessern/)
  assert.match(m.ics, /BEGIN:VALARM/)
})

test('Aufgabe ohne Frist: keine Kalenderdatei; leerer Titel wird „Aufgabe“', () => {
  const m = taskMail({ title: '  ' })
  assert.equal(m.subject, 'Aufgabe: Aufgabe')
  assert.equal(m.ics, '')
  assert.match(m.text, /Danke!/)
})

test('Aufgaben: eindeutige Kalender-IDs', () => {
  const a = taskMail({ title: 'A', due: '2026-11-10' })
  const b = taskMail({ title: 'A', due: '2026-11-10' })
  const uid = (ics) => /UID:(.+)/.exec(ics)[1]
  assert.notEqual(uid(a.ics), uid(b.ics))
})

test('Liste als E-Mail: Punkte, Abschnitte, Link, keine doppelten Leerzeilen', () => {
  const m = listMail({ title: 'Zu erledigen', sections: [{ title: 'Abwesenheiten', items: ['Anna · Urlaub'] }, { title: 'Leer', items: [] }, { title: 'Periodisch', items: ['Glas · 10.11.'] }], link: 'https://app.cleanos.at/', from: 'Petra' })
  assert.equal(m.subject, 'Zu erledigen')
  assert.match(m.text, /Abwesenheiten\n• Anna · Urlaub/)
  assert.ok(!m.text.includes('Leer'))
  assert.match(m.text, /In der App: https:\/\/app\.cleanos\.at\//)
  assert.ok(!/\n\n\n/.test(m.text))
  const simple = listMail({ title: 'T', items: ['a', 'b'] })
  assert.match(simple.text, /^T\n\n• a\n• b\n\n– gesendet aus der Cleanos App$/)
})

test('Bericht als E-Mail: Betreff mit Stand, Kennzahlen im Text, Anhänge gezählt', () => {
  const m = reportMail({ title: 'Kennzahlen', subtitle: 'Stand 04.11.2026', tiles: [{ label: 'Stunden', value: '1.234' }], files: ['a.pdf', 'a.csv'], from: 'Petra' })
  assert.equal(m.subject, 'Kennzahlen – Stand 04.11.2026')
  assert.match(m.text, /anbei Kennzahlen \(Stand 04\.11\.2026\) als 2 Anhänge\./)
  assert.match(m.text, /• Stunden: 1\.234/)
  assert.match(m.text, /Liebe Grüße\nPetra/)
  assert.equal(reportMail({ title: 'Lagerbestand', files: ['x.csv'] }).text.split('\n')[2], 'anbei Lagerbestand als Anhang.')
})

test('Bericht-PDF: Kopf, Kacheln in Reihen, Tabelle mit Kopfzeile, Listen', () => {
  const doc = reportDocument({
    title: 'Prüfbericht',
    subtitle: 'Stand 04.11.2026',
    tiles: [1, 2, 3, 4, 5].map((i) => ({ label: `K${i}`, value: String(i) })),
    tables: [{ title: 'Einsätze', head: ['Datum', 'Objekt'], rows: [['04.11.', 'Lehen'], ['05.11.']] }],
    lists: [{ title: 'Hinweise', items: ['eins', ' zwei  '] }, { title: 'leer', items: [] }],
    brand: { name: 'Cleanos' },
    createdAt: new Date('2026-11-04T10:00:00Z'),
  })
  const json = JSON.stringify(doc.content)
  assert.match(json, /Prüfbericht/)
  const tileTable = doc.content.find((x) => x.table && x.table.body[0][0].stack)
  assert.equal(tileTable.table.body.length, 2, '5 Kacheln → 2 Reihen zu 4')
  assert.equal(tileTable.table.body[1].length, 4)
  const t = doc.content.find((x) => x.table?.headerRows === 1)
  assert.equal(t.table.body[0][0].text, 'Datum')
  assert.deepEqual(t.table.body[2], ['05.11.', ''], 'fehlende Zellen leer')
  assert.ok(doc.content.some((x) => x.ul && x.ul[1] === 'zwei'))
  assert.ok(!json.includes('"leer"'))
  assert.equal(doc.pageOrientation, undefined)
})

test('Bericht-PDF: breite Tabellen quer, lange Tabellen gekürzt mit Hinweis, leere Tabelle', () => {
  const head = Array.from({ length: 10 }, (_, i) => `S${i}`)
  const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => head.map(() => String(i)))
  const doc = reportDocument({ title: 'Lohn', tables: [{ head, rows }, { head: ['A'], rows: [] }] })
  assert.equal(doc.pageOrientation, 'landscape')
  const t = doc.content.find((x) => x.table?.headerRows === 1)
  assert.equal(t.table.body.length, MAX_ROWS + 1)
  assert.ok(doc.content.some((x) => /und 5 weitere Zeilen/.test(x.text || '')))
  const empty = doc.content.filter((x) => x.table?.headerRows === 1)[1]
  assert.equal(empty.table.body[1][0], 'keine Einträge')
})
