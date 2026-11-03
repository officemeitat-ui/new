import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ROLES, GROUP_MODULE, MODULES, resolveAccess, roleOptions } from '../src/core/access.js'
import { DEFAULT_SKILLS } from '../src/core/skills.js'
import { TRAINING_DEFAULTS } from '../src/core/trainings.js'
import { createDemoData } from '../src/data/demo.js'

test('Rechte: Ändern nur in Modulen, die die Rolle auch sieht', () => {
  const access = { roles: { kaputt: { label: 'Fehlkonfiguriert', modules: [], edit: ['zaehler'] } }, members: { kaputt: ['k@cleanos.example'] } }
  const a = resolveAccess({ email: 'k@cleanos.example', access })
  assert.deepEqual(a.roles, ['kaputt'])
  assert.equal(a.sees('zaehler'), false)
  assert.equal(a.canEdit('zaehler'), false)
})

test('Rechte: eigene Rolle ersetzt eine Standardrolle gleichen Namens (auch als Rückfall „lesen“)', () => {
  const access = { planners: ['chefin@cleanos.example'], roles: { lesen: { label: 'Nur lesen (mit Terminen)', modules: ['planung', 'termine'], edit: [] } } }
  const a = resolveAccess({ email: 'neu@cleanos.example', access })
  assert.deepEqual([a.roles, a.label], [['lesen'], 'Nur lesen (mit Terminen)'])
  assert.ok(a.sees('termine') && a.sees('planung') && !a.canEdit('termine'))
})

test('Rechte: Microsoft-Gruppe als einzelne ID, Groß-/Kleinschreibung egal, unbekannte Rolle ignoriert', () => {
  const access = { groups: { lager: 'ABC-123', gibtsnicht: ['xyz'] } }
  const a = resolveAccess({ groupClaims: ['abc-123', 'xyz'], access, strict: true })
  assert.deepEqual(a.roles, ['lager'])
  assert.ok(a.sees('material') && a.canEdit('material') && !a.sees('planung'))
})

test('Rechte: App-Rolle nur exakt oder nach einem Punkt; unbekannte Rolle im Betrieb ohne Zugriff', () => {
  assert.deepEqual(resolveAccess({ roleClaims: ['Dienstplan.Lager'], strict: true }).roles, ['lager'])
  assert.deepEqual(resolveAccess({ roleClaims: ['  FUHRPARK '], strict: true }).roles, ['fuhrpark'])
  assert.deepEqual(resolveAccess({ roleClaims: ['superlager'], strict: true }).roles, [])
  assert.deepEqual(resolveAccess({ roleClaims: ['Dienstplan.Unbekannt'], strict: true }).roles, [])
  assert.deepEqual(resolveAccess({ roleClaims: ['Dienstplan.Unbekannt'] }).roles, ['lesen'], 'Probe: eingerichtet, aber unbekannt = nur lesen')
})

test('Rechte: mehrere Rollen ergeben die Summe, „alles“ nur mit Vollzugriff; Vorschau ignoriert Token', () => {
  const a = resolveAccess({ roleClaims: ['lager', 'pruefer'], strict: true })
  assert.equal(a.label, 'Lager & Einkauf, Prüfer/in')
  assert.ok(a.canEdit('material') && a.canEdit('kontrolle') && a.sees('objektmappe') && !a.canEdit('objektmappe'))
  assert.equal(a.all, false)
  const preview = resolveAccess({ preview: 'buchhaltung', roleClaims: ['disposition'] })
  assert.deepEqual(preview.roles, ['buchhaltung'])
  assert.ok(preview.canEdit('fakturierung') && !preview.sees('planung') && !preview.all)
})

test('Rechte: Rollenauswahl mit Standardrollen und eigenen Rollen', () => {
  const ids = roleOptions().map(([id]) => id)
  assert.deepEqual(ids, Object.keys(DEFAULT_ROLES))
  assert.ok(roleOptions().some(([id, label]) => id === 'lohnverrechnung' && label === 'Lohnverrechnung'))
  const custom = roleOptions({ roles: { hausbetreuung: { label: 'Hausbetreuung' }, lesen: { label: 'Lesen (angepasst)' } } })
  assert.deepEqual(custom.at(-1), ['hausbetreuung', 'Hausbetreuung'])
  assert.deepEqual(custom.find(([id]) => id === 'lesen'), ['lesen', 'Lesen (angepasst)'])
})

test('Rechte: Standardrollen verweisen nur auf bekannte Module und ändern nur, was sie sehen', () => {
  const known = new Set(Object.keys(MODULES))
  for (const [id, role] of Object.entries(DEFAULT_ROLES)) {
    if (role.modules === '*') {
      assert.equal(role.edit, '*', id)
      continue
    }
    for (const m of role.modules) assert.ok(known.has(m), `${id}: ${m}`)
    for (const m of role.edit) assert.ok(role.modules.includes(m), `${id} ändert ${m}, sieht es aber nicht`)
  }
  for (const m of Object.values(GROUP_MODULE)) assert.ok(known.has(m), m)
  const voll = resolveAccess({ roleClaims: ['disposition'], strict: true })
  assert.ok(voll.all && Object.keys(MODULES).every((m) => voll.canEdit(m)))
})

test('Qualifikationen: Grundausstattung ohne Doppelte, passt zu Fristen und Beispieldaten', () => {
  assert.equal(new Set(DEFAULT_SKILLS).size, DEFAULT_SKILLS.length)
  for (const t of TRAINING_DEFAULTS) if (t.who.startsWith('skill:')) assert.ok(DEFAULT_SKILLS.includes(t.who.slice(6)), t.who)
  const demo = createDemoData('2026-11-02')
  const used = new Set([...demo.tasks.flatMap((t) => t.skills || []), ...demo.employees.flatMap((e) => e.skills || [])])
  for (const s of used) assert.ok(DEFAULT_SKILLS.includes(s), `Beispieldaten nutzen unbekannte Qualifikation ${s}`)
  assert.ok(used.size > 0)
})
