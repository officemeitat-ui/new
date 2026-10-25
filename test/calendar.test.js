import { test } from 'node:test'
import assert from 'node:assert/strict'

import { saveEvent } from '../src/auth/graph-calendar.js'
import { scopesFor } from '../src/auth/msal.js'
import { icsEvent } from '../src/core/ics.js'

test('Kalender: Nachkontrolle als .ics (ganztägig, gefaltet, maskiert)', () => {
  const ics = icsEvent({ uid: 'k1-nachkontrolle@dienstplan', date: '2026-12-31', title: 'Nachkontrolle Wohnanlage Lehen; Stiege 2', description: `Offene Mängel:\n• 1.6 G/G1: Böden, Ecken verschmutzt – ${'sehr '.repeat(20)}deutlich`, location: 'Lehener Straße 1, Salzburg', now: new Date('2026-10-25T10:00:00Z') })
  const lines = ics.split('\r\n')
  assert.ok(ics.endsWith('\r\n'))
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261231'))
  assert.ok(lines.includes('DTEND;VALUE=DATE:20270101'), 'Ende am Folgetag, über den Jahreswechsel')
  assert.ok(lines.includes('DTSTAMP:20261025T100000Z'))
  assert.ok(lines.includes('SUMMARY:Nachkontrolle Wohnanlage Lehen\\; Stiege 2'))
  assert.ok(lines.includes('LOCATION:Lehener Straße 1\\, Salzburg'))
  assert.ok(lines.includes('TRIGGER:-PT15H'))
  const enc = new TextEncoder()
  assert.ok(lines.every((l) => enc.encode(l).length <= 75), 'keine Zeile über 75 Byte')
  const unfolded = ics.replace(/\r\n /g, '')
  assert.ok(unfolded.includes('DESCRIPTION:Offene Mängel:\\n• 1.6 G/G1: Böden'), 'Umlaute bleiben beim Falten heil')
})

test('Kalender: Termin in Outlook über Graph anlegen, verschieben, verständliche Fehler', async () => {
  const calls = []
  let mode = 'ok'
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body) })
    if (mode === 'gone' && opts.method === 'PATCH') return { ok: false, status: 404, json: async () => ({}) }
    if (mode === 'denied') return { ok: false, status: 403, json: async () => ({ error: { message: 'Access denied' } }) }
    return { ok: true, status: opts.method === 'POST' ? 201 : 200, json: async () => ({ id: 'EV1', webLink: 'https://outlook.office365.com/owa/?itemid=EV1' }) }
  }
  const ev = { title: 'Nachkontrolle Kanzlei', date: '2026-11-08', text: 'Offene Mängel', location: 'Musterstraße 1' }
  const res = await saveEvent(async () => 'TOKEN', ev, { fetchImpl: fakeFetch })
  assert.deepEqual(res, { id: 'EV1', webLink: 'https://outlook.office365.com/owa/?itemid=EV1' })
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me/events')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual([calls[0].body.isAllDay, calls[0].body.start.dateTime, calls[0].body.end.dateTime, calls[0].body.showAs, calls[0].body.location.displayName], [true, '2026-11-08T00:00:00', '2026-11-09T00:00:00', 'free', 'Musterstraße 1'])

  await saveEvent(async () => 'TOKEN', { ...ev, date: '2026-11-15' }, { id: 'EV1', fetchImpl: fakeFetch })
  assert.deepEqual([calls[1].method, calls[1].url.endsWith('/me/events/EV1')], ['PATCH', true], 'vorhandener Termin wird verschoben')

  mode = 'gone'
  await saveEvent(async () => 'TOKEN', ev, { id: 'EV1', fetchImpl: fakeFetch })
  assert.deepEqual(calls.slice(2).map((c) => c.method), ['PATCH', 'POST'], 'in Outlook gelöscht: neu anlegen')

  mode = 'denied'
  await assert.rejects(saveEvent(async () => 'TOKEN', ev, { fetchImpl: fakeFetch }), /Calendars\.ReadWrite/)
})

test('Kalender: Berechtigung nur, wenn eingeschaltet', () => {
  assert.ok(!scopesFor({ features: {} }).includes('Calendars.ReadWrite'))
  assert.ok(scopesFor({ features: { calendar: true } }).includes('Calendars.ReadWrite'))
})
