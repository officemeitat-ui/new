import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAccess, roleOptions } from '../src/core/access.js'

test('Rollen: ohne Einrichtung darf jede angemeldete Person alles (wie bisher)', () => {
  const a = resolveAccess({ email: 'x@firma.at' })
  assert.deepEqual(a.roles, ['disposition'])
  assert.ok(a.all && a.sees('zaehler') && a.canEdit('planung'))
})

test('Rollen: App-Rollen aus Entra ID, auch mit Präfix', () => {
  const a = resolveAccess({ roleClaims: ['Dienstplan.Objektservice'] })
  assert.deepEqual(a.roles, ['objektservice'])
  assert.ok(a.sees('zaehler') && a.canEdit('kontrolle'))
  assert.ok(!a.sees('planung') && !a.sees('auswertung') && !a.all)
})

test('Rollen: E-Mail-Listen und Planer-Liste aus config.json', () => {
  const access = { planners: ['chefin@firma.at'], members: { lohnverrechnung: ['Lohn@Firma.at'], objektleitung: ['ol@firma.at'] } }
  assert.deepEqual(resolveAccess({ email: 'chefin@firma.at', access }).roles, ['disposition'])
  const lohn = resolveAccess({ email: 'lohn@firma.at', access })
  assert.ok(lohn.canEdit('auswertung') && !lohn.sees('planung'))
  const ol = resolveAccess({ email: 'ol@firma.at', access })
  assert.ok(ol.sees('planung') && !ol.canEdit('planung') && ol.canEdit('zaehler'))
  // eingerichtet, aber nicht eingetragen: nur lesen
  const other = resolveAccess({ email: 'neu@firma.at', access })
  assert.deepEqual(other.roles, ['lesen'])
  assert.ok(other.sees('planung') && !other.canEdit('planung'))
})

test('Rollen: mehrere Rollen addieren sich, eigene Rollen per config', () => {
  const access = { roles: { hausbetreuung: { label: 'Hausbetreuung', modules: ['zaehler'], edit: ['zaehler'] } }, members: { hausbetreuung: ['h@firma.at'], lohnverrechnung: ['h@firma.at'] } }
  const a = resolveAccess({ email: 'h@firma.at', access })
  assert.deepEqual(a.roles.sort(), ['hausbetreuung', 'lohnverrechnung'])
  assert.ok(a.canEdit('zaehler') && a.canEdit('auswertung') && !a.sees('kontrolle'))
  assert.ok(roleOptions(access).some(([id]) => id === 'hausbetreuung'))
})

test('Rollen: Vorschau im Browser-Modus', () => {
  const a = resolveAccess({ preview: 'objektleitung' })
  assert.deepEqual(a.roles, ['objektleitung'])
  assert.equal(resolveAccess({ preview: 'gibt-es-nicht' }).roles[0], 'disposition')
})
