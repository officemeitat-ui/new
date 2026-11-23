// Mattenwechsel: Ankündigung an den Kunden vor dem Wechsel (core/matten-avis.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { markNotice, nextNoticeOff, noticeEmail, noticeMail, noticeProblem, noticeRows, noticeSummary, noticeWindow } from '../src/core/matten-avis.js'

const item = (placementId, placementName, planned = 1, extra = {}) => ({ jobKey: `${placementId}:2026-11-24`, placementId, placementName, mat: { name: 'Matte' }, planned, status: 'geplant', ...extra })
const stop = (id, customer, extra = {}) => ({ id, objectName: `${customer.name} Haus`, address: 'Testweg 1, 5020 Salzburg', customer, status: 'geplant', items: [item(`${id}-a`, 'Haupteingang', 2), item(`${id}-b`, 'Tor')], ...extra })
const cA = { id: 'c1', name: 'Muster GmbH', no: '10001' }
const cB = { id: 'c2', name: 'Bäckerei Probe', no: '10002' }
const tour = (extra = {}) => ({ id: 't1', date: '2026-11-24', status: 'freigegeben', driverName: 'Fahrer Eins', order: ['s1', 's2', 's3'], stops: [stop('s1', cA, { times: { arrival: '07:20' } }), stop('s2', cB, { times: { arrival: '09:05' }, window: { from: '08:00', to: '10:00' } }), stop('s3', { id: 'c3', name: 'Praxis' })], ...extra })

test('Zeitfenster: Ankunft − 30 bis + 90 Minuten, auf halbe Stunden, auf das Fenster des Kunden begrenzt', () => {
  assert.deepEqual(noticeWindow({ times: { arrival: '07:20' } }), { from: '06:30', to: '09:00' })
  assert.deepEqual(noticeWindow({ times: { arrival: '09:05' }, window: { from: '08:00', to: '10:00' } }), { from: '08:30', to: '10:00' })
  assert.deepEqual(noticeWindow({ times: { arrival: '08:00' }, window: { from: '08:00', to: '12:00' } }), { from: '08:00', to: '09:30' })
  assert.deepEqual(noticeWindow({ times: { arrival: '00:10' } }), { from: '00:00', to: '02:00' })
  assert.deepEqual(noticeWindow({ times: { arrival: '10:00' } }, { before: 60, after: 60, step: 60 }), { from: '09:00', to: '11:00' })
  // Fenster des Kunden außerhalb der Schätzung ändert nichts; ohne geplante Ankunft kein Fenster
  assert.deepEqual(noticeWindow({ times: { arrival: '10:00' }, window: { from: '14:00', to: '16:00' } }), { from: '09:30', to: '11:30' })
  assert.equal(noticeWindow({}), null)
  assert.equal(noticeWindow({ times: { arrival: 'früh' } }), null)
})

test('E-Mail: Lieferschein-E-Mail des Kunden, sonst seine E-Mail, sonst die Kopie am Stopp', () => {
  assert.equal(noticeEmail({ customer: {} }, { deliveryNoteEmail: 'ls@muster.example', email: 'office@muster.example' }), 'ls@muster.example')
  assert.equal(noticeEmail({ customer: {} }, { deliveryNoteEmail: 'kaputt', email: 'office@muster.example' }), 'office@muster.example')
  assert.equal(noticeEmail({ customer: { deliveryNoteEmail: 'kopie@muster.example' } }, null), 'kopie@muster.example')
  assert.equal(noticeEmail({ customer: {} }, {}), '')
})

test('Nur freigegebene Touren ab heute werden angekündigt', () => {
  assert.equal(noticeProblem(tour(), '2026-11-23'), '')
  assert.equal(noticeProblem(tour(), '2026-11-24'), '')
  assert.match(noticeProblem(tour({ status: 'entwurf' }), '2026-11-23'), /Zuerst die Tour freigeben/)
  assert.match(noticeProblem(tour({ status: 'unterwegs' }), '2026-11-23'), /schon unterwegs/)
  assert.match(noticeProblem(tour(), '2026-11-25'), /Vergangenheit/)
  assert.match(noticeProblem(null, '2026-11-23'), /nicht gefunden/)
})

test('Zeilen: offene Stopps in Fahrreihenfolge, vorgewählt mit E-Mail, ohne „wünscht keine“ und ohne schon Angekündigte', () => {
  const customers = [{ id: 'c1', email: 'office@muster.example' }, { id: 'c2', deliveryNoteEmail: 'ls@baeckerei.example' }]
  const t = tour()
  t.stops[1].status = 'abgeschlossen' // erledigte Stopps werden nicht mehr angekündigt
  let rows = noticeRows({ tour: t, customers })
  assert.deepEqual(rows.map((r) => [r.stopId, r.email, r.selected]), [['s1', 'office@muster.example', true], ['s3', '', false]])
  assert.deepEqual(rows[0].window, { from: '06:30', to: '09:00' })
  assert.equal(rows[1].window, null)
  assert.deepEqual(rows[0].placements, [{ name: 'Haupteingang', qty: 2 }, { name: 'Tor', qty: 1 }])
  rows = noticeRows({ tour: tour(), customers, off: ['c2'] })
  assert.deepEqual(rows.map((r) => [r.stopId, r.off, r.selected]), [['s1', false, true], ['s2', true, false], ['s3', false, false]])
  const sent = markNotice(tour(), 's1', { to: ['office@muster.example'], window: { from: '06:30', to: '09:00' }, at: '2026-11-23T14:00:00.000Z', by: 'Büro' })
  rows = noticeRows({ tour: sent, customers })
  assert.equal(rows[0].selected, false)
  assert.deepEqual(rows[0].sent, { at: '2026-11-23T14:00:00.000Z', by: 'Büro', to: ['office@muster.example'], window: { from: '06:30', to: '09:00' }, via: 'graph' })
  assert.deepEqual(noticeSummary(sent), { open: 3, sent: 1 })
  assert.equal(sent.status, 'freigegeben')
  assert.equal(tour().stops[0].notice, undefined)
})

test('E-Mail-Text: Tag ausgeschrieben, Objekt, Zeitfenster, Liegeplätze; ohne Fahrernamen und ohne Preise', () => {
  const t = tour()
  const rows = noticeRows({ tour: t, customers: [{ id: 'c1', email: 'office@muster.example' }] })
  const m = noticeMail({ tour: t, row: rows[0], sender: 'Petra Leitner', company: 'Cleanos GmbH' })
  assert.equal(m.subject, 'Mattenwechsel am Dienstag, 24.11.2026 – Muster GmbH Haus')
  assert.equal(m.text, ['Guten Tag,', '', 'am Dienstag, 24.11.2026 tauschen wir bei Ihnen die Schmutzfangmatten:\nMuster GmbH Haus, Testweg 1, 5020 Salzburg', '', 'Unser Fahrer kommt voraussichtlich zwischen 06:30 und 09:00 Uhr.', '', 'Liegeplätze:', '– Haupteingang: 2 Matten', '– Tor: 1 Matte', '', 'Bitte halten Sie die Liegeplätze zugänglich. Passt der Termin nicht, antworten Sie bitte auf diese E-Mail.', '', 'Freundliche Grüße', 'Petra Leitner', 'Cleanos GmbH'].join('\n'))
  assert.ok(!/Fahrer Eins|€|Preis/.test(m.text))
  const noTime = noticeMail({ tour: t, row: rows[2] })
  assert.match(noTime.text, /Unser Fahrer kommt im Laufe des Tages\./)
  assert.ok(noTime.text.endsWith('Freundliche Grüße'))
})

test('„Wünscht keine Ankündigung“: abgewählte Kunden merken, gewählte wieder herausnehmen', () => {
  const rows = [
    { stopId: 's1', customerId: 'c1', email: 'a@x.example', sent: null },
    { stopId: 's2', customerId: 'c2', email: 'b@x.example', sent: null },
    { stopId: 's3', customerId: 'c3', email: '', sent: null }, // ohne E-Mail: ändert nichts
    { stopId: 's4', customerId: 'c4', email: 'd@x.example', sent: { at: 'x' } }, // schon angekündigt: ändert nichts
  ]
  assert.deepEqual(nextNoticeOff([], rows, ['s1']), ['c2'])
  assert.deepEqual(nextNoticeOff(['c1', 'c9'], rows, ['s1', 's2']), ['c9'])
  assert.deepEqual(nextNoticeOff(['c3', 'c4'], rows, []), ['c1', 'c2', 'c3', 'c4'])
})
