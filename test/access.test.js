import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accessSnippet, resolveAccess, roleOptions } from '../src/core/access.js'

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

test('Rollen: Einkauf & Kasse für Buchhaltung und Vollzugriff, nicht für Lager oder Objektleitung', () => {
  const b = resolveAccess({ roleClaims: ['Dienstplan.Buchhaltung'] })
  assert.ok(b.sees('einkauf') && b.canEdit('einkauf') && b.canEdit('fakturierung') && !b.sees('material') && !b.sees('planung'))
  assert.ok(resolveAccess({ email: 'x@firma.at' }).canEdit('einkauf'), 'Vollzugriff')
  for (const role of ['lager', 'objektleitung', 'objektmanagement', 'objektservice', 'lohnverrechnung', 'lesen', 'vorarbeiter']) assert.ok(!resolveAccess({ roleClaims: [role] }).sees('einkauf'), role)
})

test('Rollen: Personalverwaltung bearbeitet Mitarbeitende, nicht Objekte, Leistungen, Regeln oder Berechtigungen', async () => {
  const { MODULES } = await import('../src/core/access.js')
  const { dataRights, DOC } = await import('../src/storage/data-service.js')
  assert.ok(MODULES.verwaltung && MODULES.stammdaten, 'zwei Bereiche: Mitarbeitende und Objekte/Regeln/Berechtigungen')
  const pv = resolveAccess({ roleClaims: ['personalverwaltung'], strict: true })
  assert.ok(pv.sees('stammdaten') && pv.canEdit('stammdaten'), 'Mitarbeitende anlegen und ändern')
  assert.ok(!pv.sees('verwaltung') && !pv.canEdit('verwaltung'), 'kein Zugriff auf Objekte & Leistungen, Zuweisung, Regeln, Berechtigungen')
  const r = dataRights(pv)
  assert.ok(r.read(DOC.master) && r.write(DOC.master), 'Stammdaten-Datei (Mitarbeitende) lesen und schreiben')
  assert.ok(r.read(DOC.objects) && !r.write(DOC.objects), 'Objekte nur lesen (Einschulung im Objekt)')
  // keine der eingebauten Rollen außer dem Vollzugriff hat den Bereich
  for (const role of ['objektmanagement', 'objektleitung', 'objektservice', 'lager', 'lohnverrechnung', 'buchhaltung', 'fuhrpark', 'mattenwechsel', 'mattenfahrer', 'vorarbeiter', 'ableser', 'pruefer', 'lesen']) assert.ok(!resolveAccess({ roleClaims: [role], strict: true }).sees('verwaltung'), role)
  const all = resolveAccess({ email: 'x@firma.at' })
  assert.ok(all.canEdit('verwaltung') && all.canEdit('stammdaten'), 'Vollzugriff')
  // eigene Rolle über config.json: Objekte und Regeln ohne Personal
  const own = resolveAccess({ roleClaims: ['objektpflege'], access: { roles: { objektpflege: { label: 'Objektpflege', modules: ['verwaltung'], edit: ['verwaltung'] } } }, strict: true })
  const ro = dataRights(own)
  assert.ok(own.canEdit('verwaltung') && !own.sees('stammdaten') && ro.write(DOC.objects) && ro.write(DOC.master))
})

test('Ausschnitt für config.json: behält planners, members und eigene Rollen, nimmt groups und reviere aus dem Entwurf', () => {
  const access = {
    planners: ['office@cleanos.at'],
    members: { objektmanagement: ['om@cleanos.at'] },
    roles: { mattenbuero: { label: 'Mattenwechsel Büro mit Lieferscheinen', modules: ['matten'], edit: ['matten'] } },
    groups: { lager: ['alt'] },
    reviere: { Nord: ['r-alt'] },
  }
  const { access: out } = accessSnippet(access, { disposition: ['g-buero'], lager: [], objektmanagement: ['g-om'] }, { Nord: ['r-neu'], Sued: [] })
  assert.deepEqual(out.planners, ['office@cleanos.at'])
  assert.deepEqual(out.members, { objektmanagement: ['om@cleanos.at'] })
  assert.equal(out.roles.mattenbuero.label, 'Mattenwechsel Büro mit Lieferscheinen')
  assert.deepEqual(out.groups, { disposition: ['g-buero'], objektmanagement: ['g-om'] })
  assert.deepEqual(out.reviere, { Nord: ['r-neu'] })
  assert.equal(accessSnippet(undefined, {}, {}).access.reviere, undefined)
  assert.deepEqual(accessSnippet({ reviere: { Nord: ['x'] } }, {}, { Nord: [] }).access, { groups: {} })
})
