import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditFolder, expectedRights, fixPlan, principalOf, rightOf, summary } from '../src/core/rights-audit.js'

const G_BUCH = '11111111-1111-4111-8111-111111111111'
const G_OL = '22222222-2222-4222-8222-222222222222'
const G_VOLL = '33333333-3333-4333-8333-333333333333'

const owners = { id: 'p-own', roles: ['owner'], grantedToV2: { siteGroup: { id: '3', displayName: 'Cleanos Besitzer' } } }
const members = { id: 'p-mem', roles: ['write'], grantedToV2: { siteGroup: { id: '5', displayName: 'Cleanos Mitglieder' } } }
const group = (id, role, name, pid = `p-${id.slice(0, 4)}-${role}`) => ({ id: pid, roles: [role], grantedToV2: { group: { id, displayName: name }, siteUser: { loginName: `c:0t.c|tenant|${id}` } } })

test('Freigaben lesen: Rechte, Gruppen über ID oder Anmeldename, Website-Gruppen, Personen, Links', () => {
  assert.equal(rightOf(['read']), 'Lesen')
  assert.equal(rightOf(['write']), 'Bearbeiten')
  assert.equal(rightOf(['owner']), 'Besitzer')
  assert.equal(rightOf(['sp.irgendwas']), 'Bearbeiten', 'unbekannt zählt vorsichtshalber als Bearbeiten')
  assert.deepEqual(pick(principalOf(group(G_BUCH, 'read', 'Cleanos_App_Buchhaltung'))), { key: `g:${G_BUCH}`, kind: 'group', right: 'Lesen', name: 'Cleanos_App_Buchhaltung' })
  // nur im Anmeldenamen (SharePoint gibt Sicherheitsgruppen manchmal als „Benutzer“ zurück), groß geschrieben
  const viaLogin = principalOf({ id: 'x', roles: ['write'], grantedToV2: { siteUser: { displayName: 'Cleanos_App_Lager', loginName: `c:0t.c|tenant|${G_OL.toUpperCase()}` } } })
  assert.deepEqual(pick(viaLogin), { key: `g:${G_OL}`, kind: 'group', right: 'Bearbeiten', name: 'Cleanos_App_Lager' })
  assert.equal(principalOf({ id: 'm', roles: ['write'], grantedToV2: { siteUser: { loginName: `c:0o.c|federateddirectoryclaimprovider|${G_VOLL}_o` } } }).owners, true, 'Besitzer einer Microsoft-365-Gruppe')
  assert.deepEqual(pick(principalOf(members)), { key: 's:5', kind: 'siteGroup', right: 'Bearbeiten', name: 'Cleanos Mitglieder' })
  assert.deepEqual(pick(principalOf({ id: 'u', roles: ['read'], grantedToV2: { user: { id: 'abc', displayName: 'Petra Leitner' }, siteUser: { loginName: 'i:0#.f|membership|Office@Cleanos.at' } } })), { key: 'u:office@cleanos.at', kind: 'user', right: 'Lesen', name: 'Petra Leitner' })
  const link = principalOf({ id: 'L1', roles: ['read'], link: { scope: 'anonymous', type: 'view' } })
  assert.equal(link.kind, 'link')
  assert.match(link.name, /jeden mit dem Link/)
})
const pick = (p) => ({ key: p.key, kind: p.kind, right: p.right, name: p.name })

const ROLES = [
  { id: 'disposition', label: 'Vollzugriff', groups: [G_VOLL], people: ['office@cleanos.at'], rights: { 'Plattform/lohn': 'Bearbeiten', 'Plattform/fakturierung': 'Bearbeiten', 'Plattform/objekte': 'Bearbeiten' } },
  { id: 'buchhaltung', label: 'Buchhaltung', groups: [G_BUCH.toUpperCase()], rights: { 'Plattform/lohn': '', 'Plattform/fakturierung': 'Bearbeiten', 'Plattform/objekte': 'Lesen' } },
  { id: 'objektleitung', label: 'Objektleitung', groups: [G_OL], rights: { 'Plattform/lohn': '', 'Plattform/fakturierung': '', 'Plattform/objekte': 'Lesen' } },
  { id: 'lager', label: 'Lager', groups: [], rights: { 'Plattform/objekte': 'Lesen' } },
]

test('Soll je Ordner: höchstes Recht je Gruppe, Rollen gesammelt, ohne Gruppe nichts', () => {
  const exp = expectedRights(ROLES)
  assert.deepEqual([...exp.keys()].sort(), ['Plattform/fakturierung', 'Plattform/lohn', 'Plattform/objekte'])
  const lohn = exp.get('Plattform/lohn')
  assert.deepEqual([...lohn.keys()].sort(), [`g:${G_VOLL}`, 'u:office@cleanos.at'])
  const obj = exp.get('Plattform/objekte')
  assert.equal(obj.get(`g:${G_BUCH}`).want, 'Lesen', 'Gruppen-ID klein')
  assert.deepEqual(obj.get(`g:${G_OL}`).roles, ['Objektleitung'])
  assert.equal(obj.size, 4, 'Lager hat keine Gruppe: zählt nicht')
})

test('Ordner prüfen: passt, fehlt, zu wenig, zu viel, Website-Gruppe, Link; Besitzer und man selbst bleiben', () => {
  const exp = expectedRights(ROLES)
  const ok = auditFolder({ expected: exp.get('Plattform/lohn'), perms: [owners, group(G_VOLL, 'write', 'Cleanos_App_Voll'), { id: 'po', roles: ['write'], grantedToV2: { siteUser: { loginName: 'i:0#.f|membership|office@cleanos.at', displayName: 'Petra' } } }], me: 'office@cleanos.at' })
  assert.equal(ok.ok, true)
  assert.deepEqual(summary(ok), { cls: 'ok', text: 'passt' })

  const lohn = auditFolder({ expected: exp.get('Plattform/lohn'), perms: [owners, members, group(G_VOLL, 'write', 'Voll'), group(G_OL, 'read', 'Cleanos_App_Objektleitung'), { id: 'L1', roles: ['read'], link: { scope: 'organization' } }, { id: 'me', roles: ['write'], grantedToV2: { user: { email: 'it@cleanos.at', displayName: 'IT' } } }], me: 'it@cleanos.at' })
  const st = Object.fromEntries(lohn.items.map((i) => [i.key, i.status]))
  assert.equal(st['s:5'], 'zuviel', 'alle Mitglieder der Website auf lohn/')
  assert.equal(st[`g:${G_OL}`], 'zuviel')
  assert.equal(st['l:L1'], 'link')
  assert.equal(st['u:it@cleanos.at'], 'ich', 'die eigene Person bleibt')
  assert.equal(st['s:3'], 'besitzer')
  assert.equal(st['u:office@cleanos.at'], 'fehlt')
  assert.equal(lohn.ok, false)
  assert.deepEqual(summary(lohn), { cls: 'bad', text: '4 Abweichungen' })

  const fak = auditFolder({ expected: exp.get('Plattform/fakturierung'), perms: [owners, group(G_VOLL, 'write', 'Voll'), group(G_BUCH, 'read', 'Buch')], me: '' })
  assert.equal(fak.items.find((i) => i.key === `g:${G_BUCH}`).status, 'zuwenig')
  const obj = auditFolder({ expected: exp.get('Plattform/objekte'), perms: [owners, group(G_VOLL, 'write', 'Voll'), group(G_BUCH, 'write', 'Buch'), group(G_OL, 'read', 'OL')], me: '' })
  const buch = obj.items.find((i) => i.key === `g:${G_BUCH}`)
  assert.equal(buch.status, 'zuviel')
  assert.match(buch.text, /braucht nur Lesen, hat Bearbeiten/)
})

test('Ohne Besitzer-Sicht unvollständig: nichts ändern; fehlender Ordner: anlegen und vergeben', () => {
  const exp = expectedRights(ROLES)
  const part = auditFolder({ expected: exp.get('Plattform/lohn'), perms: [group(G_VOLL, 'write', 'Voll')], me: '' })
  assert.equal(part.partial, true)
  assert.deepEqual(fixPlan(part), { create: false, grants: [], removes: [], anchor: null })
  assert.deepEqual(summary(part), { cls: 'warn', text: 'nur teilweise sichtbar' })
  const miss = auditFolder({ expected: exp.get('Plattform/fakturierung'), perms: null })
  const plan = fixPlan(miss)
  assert.equal(plan.create, true)
  assert.deepEqual(plan.grants.map((g) => `${g.key}=${g.right}`).sort(), [`g:${G_BUCH}=Bearbeiten`, `g:${G_VOLL}=Bearbeiten`, 'u:office@cleanos.at=Bearbeiten'])
})

test('Plan: fehlende vergeben, zu viel entfernen, zu hohes Recht tauschen; Besitzer nie; Vererbung über einen Anker beenden', () => {
  const exp = expectedRights(ROLES)
  const lohn = auditFolder({ expected: exp.get('Plattform/lohn'), perms: [owners, members, group(G_VOLL, 'write', 'Voll'), { id: 'po', roles: ['write'], grantedToV2: { siteUser: { loginName: 'i:0#.f|membership|office@cleanos.at' } } }, { id: 'L1', roles: ['read'], link: { scope: 'anonymous' } }] })
  const p1 = fixPlan(lohn)
  assert.deepEqual(p1.grants, [])
  assert.deepEqual(p1.removes.map((r) => r.permId).sort(), ['L1', 'p-mem'])
  assert.deepEqual([p1.anchor.key, p1.anchor.right], [`g:${G_VOLL}`, 'Bearbeiten'], 'vergibt ein vorhandenes Recht noch einmal, damit Entfernen geht')

  // Buchhaltung hat Bearbeiten und Lesen doppelt: nur die Bearbeiten-Freigabe weg, Lesen bleibt
  const obj = auditFolder({ expected: exp.get('Plattform/objekte'), perms: [owners, group(G_VOLL, 'write', 'Voll'), group(G_BUCH, 'write', 'Buch'), group(G_BUCH, 'read', 'Buch'), group(G_OL, 'write', 'OL')] })
  const p2 = fixPlan(obj)
  assert.deepEqual(p2.removes.map((r) => r.permId).sort(), [`p-${G_BUCH.slice(0, 4)}-write`, `p-${G_OL.slice(0, 4)}-write`])
  assert.deepEqual(p2.grants.map((g) => `${g.key}=${g.right}`).sort(), [`g:${G_OL}=Lesen`, 'u:office@cleanos.at=Bearbeiten'])
  assert.equal(p2.anchor, null, 'es wird ohnehin vergeben')

  // nur Zuviel und niemand Passendes da: kein Anker, das Entfernen wird versucht und ggf. gemeldet
  const lone = auditFolder({ expected: new Map([[`g:${G_BUCH}`, { kind: 'group', id: G_BUCH, key: `g:${G_BUCH}`, want: 'Lesen', roles: ['Buchhaltung'] }]]), perms: [owners, group(G_BUCH, 'write', 'Buch')] })
  const p3 = fixPlan(lone)
  assert.deepEqual(p3.grants.map((g) => g.right), ['Lesen'])
  assert.ok(!p3.removes.some((r) => r.right === 'Besitzer'))
})
