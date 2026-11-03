import { test } from 'node:test'
import assert from 'node:assert/strict'

import { icsEvent } from '../src/core/ics.js'
import { addMinutes, appointmentsBetween, conflicts, dayPart, daysOf, graphEvent, graphRecurrence, icsData, inviteList, inviteText, kindLabel, minutesFrom, occurrences, outlookState, repeatText, rruleOf, validateAppointment, whenText } from '../src/core/appointments.js'
import { dayIndex } from '../src/core/dates.js'

const NOW = new Date('2026-11-03T10:15:30.123Z')
const lines = (ics) => ics.split('\r\n')
/** Gefaltete Zeilen wieder zusammensetzen (RFC 5545, 3.1). */
const unfold = (ics) => ics.replace(/\r\n /g, '')
const de = (d) => d.split('-').reverse().join('.')

// ---------------------------------------------------------------- .ics-Datei

test('ICS: ganztägiger Termin mit Datumswerten, frei, Zeilenende CRLF auch am Schluss', () => {
  const ics = icsEvent({ uid: 'k1@test', date: '2026-12-31', title: 'Nachkontrolle', now: NOW })
  const l = lines(ics)
  assert.ok(l.includes('DTSTART;VALUE=DATE:20261231'))
  assert.ok(l.includes('DTEND;VALUE=DATE:20270101'), 'Ende ist der Folgetag (exklusiv), auch über den Jahreswechsel')
  assert.ok(l.includes('TRANSP:TRANSPARENT'))
  assert.ok(l.includes('DTSTAMP:20261103T101530Z'), 'Zeitstempel in UTC ohne Millisekunden')
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(!/[^\r]\n/.test(ics), 'kein LF ohne CR')
})

test('ICS: Termin mit Uhrzeit über Mitternacht endet am Folgetag, belegt', () => {
  const l = lines(icsEvent({ uid: 'n@test', date: '2026-11-04', time: '22:30', minutes: 150, title: 'Nachtreinigung', now: NOW }))
  assert.ok(l.includes('DTSTART:20261104T223000'))
  assert.ok(l.includes('DTEND:20261105T010000'))
  assert.ok(l.includes('TRANSP:OPAQUE'))
})

test('ICS: Komma, Strichpunkt, Backslash und Zeilenumbruch werden maskiert, Doppelpunkt nicht', () => {
  const ics = unfold(icsEvent({ uid: 'e@test', date: '2026-11-04', title: 'Begehung; Stiege 2, Lift', description: 'Zeile 1\r\nZeile 2: C:\\Ordner', location: 'Gasse 1, Salzburg', now: NOW }))
  assert.match(ics, /\r\nSUMMARY:Begehung\\; Stiege 2\\, Lift\r\n/)
  assert.match(ics, /\r\nDESCRIPTION:Zeile 1\\nZeile 2: C:\\\\Ordner\r\n/)
  assert.match(ics, /\r\nLOCATION:Gasse 1\\, Salzburg\r\n/)
})

test('ICS: lange Zeilen höchstens 75 Byte, Umlaute nicht zerteilt, zusammengesetzt wieder der Text', () => {
  const title = `${'Ä'.repeat(60)} Objektbegehung Grundreinigung Stiegenhaus Wohnanlage Beispielgasse`
  const ics = icsEvent({ uid: 'u@test', date: '2026-11-04', title, remindHours: 0, now: NOW })
  for (const l of lines(ics)) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `zu lang: ${l}`)
  assert.ok(lines(ics).some((l) => l.startsWith(' ')), 'Folgezeile beginnt mit Leerzeichen')
  assert.ok(!ics.includes('\uFFFD'))
  assert.ok(unfold(ics).includes(`SUMMARY:${title}\r\n`))
})

test('ICS: Erinnerung in Stunden, ohne Erinnerung kein VALARM; Ort und Beschreibung nur wenn vorhanden', () => {
  const withAlarm = icsEvent({ uid: 'a@test', date: '2026-11-04', time: '07:00', minutes: 30, title: 'Reifenwechsel', remindHours: 12, now: NOW })
  assert.match(withAlarm, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reifenwechsel\r\nTRIGGER:-PT12H\r\nEND:VALARM/)
  const plain = icsEvent({ uid: 'a@test', date: '2026-11-04', title: 'X', remindHours: 0, now: NOW })
  assert.doesNotMatch(plain, /VALARM|LOCATION|DESCRIPTION/)
})

// ---------------------------------------------------------------- Serien als RRULE und für Outlook

test('RRULE: ganztägige Serie endet mit einem Datum (gleicher Werttyp wie DTSTART), mit Uhrzeit mit Datum und Uhrzeit', () => {
  // Regression: UNTIL war bei ganztägigen Serien ein DATE-TIME, DTSTART aber ein DATE (RFC 5545, 3.3.10)
  const allDay = { id: 'm', title: 'Messe', allDay: true, start: '2026-11-04T00:00', end: '2026-11-04T00:00', repeat: { freq: 'weekly', until: '2026-12-30' } }
  assert.equal(rruleOf(allDay), 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230')
  const ics = lines(icsEvent({ ...icsData(allDay), now: NOW }))
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261104'))
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230'))
  assert.equal(rruleOf({ ...allDay, allDay: false, start: '2026-11-04T09:00', end: '2026-11-04T10:00' }), 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230T235959')
})

test('ICS: mehrtägiger ganztägiger Termin geht bis einschließlich des letzten Tages', () => {
  // Regression: die .ics-Datei hatte nur den ersten Tag, Outlook (graphEvent) dagegen alle drei
  const messe = { id: 'm', title: 'Reinigungsmesse', allDay: true, start: '2026-11-04T00:00', end: '2026-11-06T00:00' }
  assert.equal(icsData(messe).days, 3)
  const l = lines(icsEvent({ ...icsData(messe), now: NOW }))
  assert.ok(l.includes('DTSTART;VALUE=DATE:20261104'))
  assert.ok(l.includes('DTEND;VALUE=DATE:20261107'))
  assert.equal(graphEvent(messe).end.dateTime, '2026-11-07T00:00:00', 'gleich wie in Outlook')
  assert.equal(icsData({ ...messe, end: '2026-11-04T00:00' }).days, 1)
  assert.equal(icsData({ ...messe, end: '2026-11-01T00:00' }).days, 1, 'Ende vor Beginn: ein Tag')
})

test('ICS-Daten aus einem Termin: Erinnerung unter einer Stunde entfällt, mindestens 5 Minuten, Kennung', () => {
  const a = { id: 't7', title: 'Kurz', start: '2026-11-04T10:00', end: '2026-11-04T10:02', reminder: 15, note: 'Notiz', location: 'Büro' }
  assert.deepEqual(icsData(a), { uid: 't7@termine', date: '2026-11-04', time: '10:00', minutes: 5, days: 1, title: 'Kurz', description: 'Notiz', location: 'Büro', remindHours: 0, rrule: '' })
  assert.equal(icsData({ ...a, reminder: 1440 }).remindHours, 24)
  assert.equal(icsData({ ...a, end: '2026-11-05T01:00' }).minutes, 900)
})

test('RRULE: wöchentlich, 14-tägig, monatlich am Tag, Anzahl, ohne Wiederholung leer', () => {
  assert.equal(rruleOf({ start: '2026-11-08T09:00', repeat: { freq: 'weekly' } }), 'FREQ=WEEKLY;BYDAY=SU')
  assert.equal(rruleOf({ start: '2026-11-02T09:00', repeat: { freq: 'biweekly', count: 6 } }), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=6')
  assert.equal(rruleOf({ start: '2026-11-15T09:00', repeat: { freq: 'monthly' } }), 'FREQ=MONTHLY;BYMONTHDAY=15')
  assert.equal(rruleOf({ start: '2026-10-29T09:00', repeat: { freq: 'monthlyNth' } }), 'FREQ=MONTHLY;BYDAY=-1TH', '5. Donnerstag ist der letzte')
  assert.equal(rruleOf({ start: '2026-10-22T09:00', repeat: { freq: 'monthlyNth' } }), 'FREQ=MONTHLY;BYDAY=4TH')
  assert.equal(rruleOf({ start: '2026-11-02T09:00' }), '')
})

test('Outlook-Serie: monatlich am Tag, ohne Ende, ohne Wiederholung keine; im Termin mitgeschickt', () => {
  assert.deepEqual(graphRecurrence({ start: '2026-11-15T09:00', repeat: { freq: 'monthly' } }), { pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-11-15' } })
  assert.equal(graphRecurrence({ start: '2026-11-15T09:00' }), null)
  assert.equal(graphRecurrence({ start: '2026-11-15T09:00', repeat: { freq: 'täglich' } }), null)
  const ev = graphEvent({ title: 'Jour fixe', start: '2026-11-02T08:00', end: '2026-11-02T08:30', repeat: { freq: 'weekly', count: 4 } })
  assert.deepEqual(ev.recurrence.range, { type: 'numbered', startDate: '2026-11-02', numberOfOccurrences: 4 })
  assert.equal(graphEvent({ title: 'Einmal', start: '2026-11-02T08:00', end: '2026-11-02T08:30' }).recurrence, undefined)
})

test('Outlook-Termin: Kategorie, Antwort nicht verlangt, Standard-Erinnerung 15 Minuten, ganztägig frei', () => {
  const ev = graphEvent({ title: 'Kontrolle', start: '2026-11-04T10:00', end: '2026-11-04T11:00', category: 'Kontrolle', responseRequested: false, note: 'bitte Schlüssel mitnehmen', location: 'Objekt' }, { timeZone: 'UTC' })
  assert.deepEqual([ev.categories, ev.responseRequested, ev.isReminderOn, ev.reminderMinutesBeforeStart, ev.showAs], [['Kontrolle'], false, true, 15, 'busy'])
  assert.deepEqual(ev.end, { dateTime: '2026-11-04T11:00:00', timeZone: 'UTC' })
  assert.deepEqual(ev.body, { contentType: 'Text', content: 'bitte Schlüssel mitnehmen' })
  assert.equal(ev.location.displayName, 'Objekt')
  assert.equal(ev.isOnlineMeeting, undefined)
  assert.equal(graphEvent({ title: 'Urlaubssperre', allDay: true, start: '2026-12-21T00:00' }).showAs, 'free')
})

// ---------------------------------------------------------------- Vorkommen einer Serie

test('Serie: Anzahl zählt abgesagte Tage mit (wie RRULE COUNT mit EXDATE)', () => {
  const s = { id: 's', title: 'Team', start: '2026-11-02T07:00', end: '2026-11-02T08:00', repeat: { freq: 'weekly', count: 3 }, exdates: ['2026-11-09'] }
  assert.deepEqual(occurrences(s, '2026-11-01', '2026-12-31').map((o) => o.occ), ['2026-11-02', '2026-11-16'])
})

test('Serie: mehrtägiges Vorkommen, das vor dem Zeitraum beginnt, zählt mit; Höchstzahl begrenzt', () => {
  const s = { id: 's', title: 'Schulungsblock', allDay: true, start: '2026-11-02T00:00', end: '2026-11-04T00:00', repeat: { freq: 'weekly' } }
  const o = occurrences(s, '2026-11-11', '2026-11-12')
  assert.deepEqual(o.map((x) => [x.occ, x.start, x.end, x.series]), [['2026-11-09', '2026-11-09T00:00', '2026-11-11T00:00', 's']])
  assert.equal(occurrences(s, '2026-11-01', '2027-12-31', { max: 5 }).length, 5)
  const single = { id: 'e', title: 'Einmal', start: '2026-11-04T10:00', end: '2026-11-04T11:00' }
  assert.deepEqual(occurrences(single, '2027-01-01', '2027-01-31'), [single], 'ohne Wiederholung der Termin selbst')
})

test('Serie: letzter Donnerstag im Monat, monatlich am 29. auch im Februar eines Nicht-Schaltjahres übersprungen', () => {
  const last = { id: 'l', title: 'x', start: '2026-10-29T09:00', end: '2026-10-29T10:00', repeat: { freq: 'monthlyNth' } }
  assert.deepEqual(occurrences(last, '2026-10-01', '2027-02-28').map((o) => o.occ), ['2026-10-29', '2026-11-26', '2026-12-31', '2027-01-28', '2027-02-25'])
  const m29 = { id: 'm', title: 'x', start: '2027-01-29T09:00', end: '2027-01-29T10:00', repeat: { freq: 'monthly', until: '2027-04-30' } }
  assert.deepEqual(occurrences(m29, '2027-01-01', '2027-12-31').map((o) => o.occ), ['2027-01-29', '2027-03-29', '2027-04-29'])
})

test('Serie als Text: Anzahl, 14-tägig, monatlich, ohne Wiederholung leer', () => {
  assert.equal(repeatText({ start: '2026-10-29T09:00', repeat: { freq: 'weekly', count: 4 } }), 'jede Woche am Donnerstag, 4-mal')
  assert.equal(repeatText({ start: '2026-11-02T09:00', repeat: { freq: 'biweekly', until: '2026-12-28' } }, de), 'alle 2 Wochen am Montag bis 28.12.2026')
  assert.equal(repeatText({ start: '2026-11-15T09:00', repeat: { freq: 'monthly' } }), 'jeden Monat am 15.')
  assert.equal(repeatText({ start: '2026-11-15T09:00' }), '')
})

// ---------------------------------------------------------------- Prüfen, Zeiten, Listen

test('Termin prüfen: ganztägig ohne Datum, Ende vor Beginn, fehlendes Ende, Serie endet vor Beginn', () => {
  assert.deepEqual(validateAppointment({ title: 'x', allDay: true, start: 'kaputt' }), ['Bitte ein Datum wählen.'])
  assert.deepEqual(validateAppointment({ title: 'x', allDay: true, start: '2026-11-04T00:00', end: '2026-11-03T00:00' }), ['Das Ende liegt vor dem Beginn.'])
  assert.deepEqual(validateAppointment({ title: 'x', start: '2026-11-04T10:00' }), ['Bitte das Ende wählen.'])
  assert.deepEqual(validateAppointment({ title: 'x', start: '2026-11-04T10:00', end: '2026-11-04T10:00' }), ['Das Ende liegt vor dem Beginn.'], 'gleich lang zählt nicht')
  assert.deepEqual(validateAppointment({ title: 'x', start: '2026-11-04T10:00', end: '2026-11-04T11:00', repeat: { freq: 'weekly', until: '2026-11-01' } }), ['Die Wiederholung endet vor dem ersten Termin.'])
  assert.deepEqual(validateAppointment({ title: '  ', start: '2026-11-04T10:00', end: '2026-11-04T11:00', attendees: [{ email: '' }, { email: 'a@b.at' }] }), ['Bitte einen Titel eingeben.'])
})

test('Zeiten: Minuten rückwärts über Mitternacht, Minuten ab einem späteren Tag negativ', () => {
  assert.equal(addMinutes('2026-11-04T00:10', -30), '2026-11-03T23:40')
  assert.equal(addMinutes('2026-12-31T23:59', 2), '2027-01-01T00:01')
  assert.equal(minutesFrom('2026-11-05', '2026-11-04T23:00'), -60)
  assert.deepEqual(daysOf({ start: '2026-11-04T22:00', end: '2026-11-06T02:00' }), { from: '2026-11-04', to: '2026-11-06' })
  assert.deepEqual(daysOf({ allDay: true, start: '2026-11-04T00:00', end: '2026-11-02T00:00' }), { from: '2026-11-04', to: '2026-11-04' })
})

test('Tagesanteil: ganztägig keiner, anderer Tag keiner, über zwei Mitternächte der ganze Tag', () => {
  assert.equal(dayPart({ allDay: true, start: '2026-11-04T00:00' }, '2026-11-04'), null)
  assert.equal(dayPart({ start: '2026-11-04T10:00', end: '2026-11-04T11:00' }, '2026-11-05'), null)
  assert.deepEqual(dayPart({ start: '2026-11-04T22:00', end: '2026-11-06T02:00' }, '2026-11-05'), { start: 0, end: 1440 })
})

test('Termine im Zeitraum: abgesagte nur auf Wunsch, Serien aufgelöst, nach Beginn sortiert', () => {
  const items = [
    { id: 'x', title: 'abgesagt', start: '2026-11-04T08:00', end: '2026-11-04T09:00', cancelled: true },
    { id: 's', title: 'Serie', start: '2026-10-28T07:00', end: '2026-10-28T07:30', repeat: { freq: 'weekly' } },
    { id: 'y', title: 'ohne Beginn' },
  ]
  assert.deepEqual(appointmentsBetween(items, '2026-11-04', '2026-11-04').map((a) => a.start), ['2026-11-04T07:00'])
  assert.deepEqual(appointmentsBetween(items, '2026-11-04', '2026-11-04', { cancelled: true }).map((a) => a.id), ['s', 'x'])
})

test('Einladungen: optionale Teilnahme bleibt, Mitarbeitende ohne E-Mail fehlen, Adressen getrimmt und klein', () => {
  const list = inviteList({ attendees: [{ email: ' HV@Beispiel.at ', name: 'HV', optional: true }, { email: '' }], employeeIds: ['e1', 'e2', 'e9'] }, new Map([['e1', { name: 'Ana', email: 'hv@beispiel.at' }], ['e2', { name: 'Bo' }]]))
  assert.deepEqual(list, [{ email: 'hv@beispiel.at', name: 'HV', optional: true }])
  const ev = graphEvent({ title: 'x', start: '2026-11-04T10:00', end: '2026-11-04T11:00', attendees: [{ email: 'gast@beispiel.at', optional: true }] })
  assert.deepEqual(ev.attendees, [{ emailAddress: { address: 'gast@beispiel.at', name: 'gast@beispiel.at' }, type: 'optional' }])
})

test('Konflikte: ganztägig oder ohne gültige Zeiten keine, mehrere Personen einzeln gemeldet', () => {
  const day = dayIndex('2026-11-04') * 1440
  const a = { start: '2026-11-04T10:00', end: '2026-11-04T11:00' }
  const instancesOf = (id) => (id === 'e1' ? [{ start: day + 600, end: day + 630 }, { start: day + 660, end: day + 700 }] : [{ start: day + 540, end: day + 601 }])
  assert.deepEqual(conflicts(a, { employeeIds: ['e1', 'e2'], instancesOf, dayIndexOf: dayIndex }).map((c) => [c.empId, c.inst.start - day]), [['e1', 600], ['e2', 540]])
  assert.deepEqual(conflicts({ ...a, allDay: true }, { employeeIds: ['e1'], instancesOf, dayIndexOf: dayIndex }), [])
  assert.deepEqual(conflicts({ start: '2026-11-04', end: '2026-11-04T11:00' }, { employeeIds: ['e1'], instancesOf, dayIndexOf: dayIndex }), [])
})

test('Texte: Zeitraum mehrtägig mit Uhrzeit und ganztägig eintägig, Einladungstext, Art und Outlook-Stand', () => {
  assert.equal(whenText({ start: '2026-11-04T22:00', end: '2026-11-05T02:00' }, de), '04.11.2026 22:00 – 05.11.2026 02:00')
  assert.equal(whenText({ allDay: true, start: '2026-11-04T00:00', end: '2026-11-04T00:00' }, de), '04.11.2026, ganztägig')
  assert.equal(inviteText({ note: 'Bitte pünktlich' }, { objectName: 'Wohnanlage Beispiel', objectAddress: 'Gasse 1', appName: 'Cleanos App', link: 'https://app.example/termine' }), 'Bitte pünktlich\n\nObjekt: Wohnanlage Beispiel, Gasse 1\n\nEingetragen in der Cleanos App: https://app.example/termine.')
  assert.equal(inviteText({}), 'Eingetragen in der App.')
  assert.deepEqual([kindLabel('begehung'), kindLabel('xyz')], ['Objektbegehung', 'Termin'])
  assert.deepEqual([outlookState({ sync: false }), outlookState({ outlook: { id: 'x', dirty: true } })], ['aus', 'offen'])
})
