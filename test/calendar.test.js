import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scopesFor } from '../src/auth/msal.js'
import { icsEvent } from '../src/core/ics.js'

test('Kalender: Termin als .ics (ganztägig, gefaltet, maskiert)', () => {
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

test('Kalender: Berechtigung nur, wenn eingeschaltet', () => {
  assert.ok(!scopesFor({ features: {} }).includes('Calendars.ReadWrite'))
  assert.ok(scopesFor({ features: { calendar: true } }).includes('Calendars.ReadWrite'))
})
