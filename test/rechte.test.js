import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { accountProblem, groupsOf } from '../src/auth/msal.js'
import { resolveAccess } from '../src/core/access.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { DataService, dataRights, DOC, folderRights, MODULE_DOCS, OLD_PATHS, weekPath } from '../src/storage/data-service.js'
import { deepMerge } from '../src/ui/config.js'
import { viewFromHash } from '../src/ui/context.js'

const OM = '11111111-1111-1111-1111-111111111111'
const VA = '22222222-2222-2222-2222-222222222222'
const TENANT = 'a31131f2-4ccf-4eb2-ab3d-49c923c6bede'
const access = { planners: ['office@cleanos.at', 'it@cleanos.at'], groups: { objektmanagement: [OM], vorarbeiter: VA } }

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i],
    get length() {
      return map.size
    },
  }
}

/** Ablage, die mitschreibt, welche Dateien gelesen, geschrieben und gelöscht werden. */
function spyStore() {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const log = { read: [], write: [], remove: [] }
  for (const op of ['read', 'write', 'remove']) {
    const orig = store[op].bind(store)
    store[op] = (path, ...rest) => {
      log[op].push(path)
      return orig(path, ...rest)
    }
  }
  return { store, log }
}

const blank = () => ({ version: 1, employees: [], objects: [], tasks: [], absences: [], skills: [], rules: {} })

test('Rechte: Rolle aus Microsoft-Gruppe, office@ und it@ dürfen alles', () => {
  const om = resolveAccess({ groupClaims: [OM.toUpperCase()], email: 'om@cleanos.at', access, strict: true })
  assert.deepEqual(om.roles, ['objektmanagement'])
  assert.ok(om.sees('planung') && !om.canEdit('planung'), 'Einsatzplanung nur sehen')
  assert.ok(om.canEdit('kontrolle') && om.canEdit('objektmappe'))
  assert.ok(!om.sees('zaehler') && !om.sees('auswertung') && !om.sees('stammdaten') && !om.sees('fahrzeuge'))

  const va = resolveAccess({ groupClaims: [VA], access, strict: true })
  assert.deepEqual(va.roles, ['vorarbeiter'])
  assert.ok(va.canEdit('zaehler') && !va.sees('planung') && !va.sees('kontrolle') && !va.sees('objektmappe'))

  for (const email of ['office@cleanos.at', 'IT@cleanos.at']) assert.ok(resolveAccess({ email, access, strict: true }).all)
})

test('Rechte: ohne Gruppe kein Zugriff (Betrieb), App-Rollen über Gruppen wirken weiter', () => {
  const nobody = resolveAccess({ email: 'neu@cleanos.at', groupClaims: ['33333333-3333-3333-3333-333333333333'], access, strict: true })
  assert.deepEqual(nobody.roles, [])
  assert.ok(!nobody.sees('planung') && !nobody.sees('zaehler') && !nobody.all)
  assert.equal(nobody.label, 'Keine Berechtigung')
  assert.deepEqual(resolveAccess({ roleClaims: ['Dienstplan.Vorarbeiter'], access, strict: true }).roles, ['vorarbeiter'])
  // Probe ohne Einrichtung: wie bisher alles
  assert.ok(resolveAccess({}).all)
})

test('Rechte: die App liest und schreibt nur die Ordner der eigenen Rolle', () => {
  const va = dataRights(resolveAccess({ groupClaims: [VA], access, strict: true }))
  assert.ok(va.read(DOC.objects) && va.read(MODULE_DOCS.zaehler.path) && va.write(MODULE_DOCS.zaehler.path))
  for (const p of [DOC.master, DOC.absences, DOC.account, weekPath('2026-10-26'), MODULE_DOCS.kontrolle.path, MODULE_DOCS.mappe.path, MODULE_DOCS.fahrzeuge.path]) assert.ok(!va.read(p), p)
  assert.ok(!va.write(DOC.objects))

  const om = dataRights(resolveAccess({ groupClaims: [OM], access, strict: true }))
  for (const p of [DOC.objects, DOC.master, weekPath('2026-10-26'), MODULE_DOCS.kontrolle.path, MODULE_DOCS.mappe.path]) assert.ok(om.read(p), p)
  for (const p of [DOC.absences, DOC.account, MODULE_DOCS.zaehler.path, MODULE_DOCS.fahrzeuge.path]) assert.ok(!om.read(p), p)
  assert.deepEqual([DOC.master, DOC.objects, weekPath('2026-10-26'), MODULE_DOCS.kontrolle.path, MODULE_DOCS.mappe.path].filter((p) => om.write(p)), [MODULE_DOCS.kontrolle.path, MODULE_DOCS.mappe.path])

  const none = dataRights(resolveAccess({ access, strict: true }))
  assert.ok(!none.read(DOC.objects) && !none.read(DOC.master))

  // Ordnertabelle für SharePoint
  const rows = Object.fromEntries(folderRights(resolveAccess({ groupClaims: [OM], access, strict: true })).map(([f, , r]) => [f, r]))
  assert.deepEqual(rows, { objekte: 'Lesen', daten: 'Lesen', plaene: 'Lesen', personal: '', lohn: '', zaehler: '', kontrolle: 'Bearbeiten', objektmappe: 'Bearbeiten', fahrzeuge: '', exporte: '' })
  // Prüfer liest die Stammdaten (Namen), aber keine Wochenpläne
  const pr = Object.fromEntries(folderRights(resolveAccess({ roleClaims: ['pruefer'], access, strict: true })).map(([f, , r]) => [f, r]))
  assert.equal(pr.daten, 'Lesen')
  assert.equal(pr.plaene, '')
  const full = folderRights(resolveAccess({ email: 'office@cleanos.at', access, strict: true }))
  assert.ok(full.every(([, , r]) => r === 'Bearbeiten'))
})

test('Rechte: Vorarbeiter fragt Personaldaten gar nicht erst an', async () => {
  const { store, log } = spyStore()
  // Bestand der Disposition
  const admin = new DataService(store, { debounceMs: 0 })
  await admin.load(() => ({ ...blank(), employees: [{ id: 'e1', name: 'Ana', phone: '0664' }], objects: [{ id: 'o1', name: 'Wohnanlage Lehen' }], absences: [{ id: 'a1', employeeId: 'e1', type: 'Krankenstand', from: '2026-10-26', to: '2026-10-30' }] }))
  admin.data.zaehler = { meters: [{ id: 'm1', objectId: 'o1', nr: 'A1' }], readings: [], closures: {} }
  await admin.flush()
  log.read.length = 0
  log.write.length = 0

  const rights = dataRights(resolveAccess({ groupClaims: [VA], access, strict: true }))
  const va = new DataService(store, { debounceMs: 0, rights, blank })
  const data = await va.load(() => assert.fail('legt nichts an'))
  assert.deepEqual(log.read.sort(), [DOC.objects, MODULE_DOCS.zaehler.path].sort())
  assert.deepEqual(data.employees, [])
  assert.deepEqual(data.absences, [])
  assert.equal(data.objects[0].name, 'Wohnanlage Lehen')
  assert.equal(data.zaehler.meters.length, 1)
  // Ablesung speichern: nur zaehler/
  data.zaehler.readings.push({ id: 'r1', meterId: 'm1', value: 12 })
  data.tasks.push({ id: 'x' }) // dürfte die Rolle nicht, wird nicht gespeichert
  await va.flush()
  assert.deepEqual(log.write, [MODULE_DOCS.zaehler.path])
  assert.equal(va.writable(DOC.master), false)
})

test('Rechte: ältere Ablage wird in die eigenen Ordner verschoben', async () => {
  const { store, log } = spyStore()
  await store.write(DOC.master, { version: 1, employees: [{ id: 'e1', name: 'Ana' }], objects: [{ id: 'o1', name: 'Kanzlei' }], tasks: [], skills: [], rules: {} })
  await store.write(OLD_PATHS[DOC.absences], { absences: [{ id: 'a1', employeeId: 'e1', type: 'Krankenstand', from: '2026-10-26', to: '2026-10-27' }] })
  await store.write(OLD_PATHS[DOC.account], { weeks: { '2026-10-19': { saldo: {} } }, pay: { e1: { hourlyWage: 14.5 } } })

  // Objektmanagement (nur lesen): liest die alten Stammdaten mit Objekten, schreibt nichts
  const om = new DataService(store, { debounceMs: 0, rights: dataRights(resolveAccess({ groupClaims: [OM], access, strict: true })), blank })
  const omData = await om.load(() => assert.fail())
  assert.equal(omData.objects[0].name, 'Kanzlei')
  assert.deepEqual(omData.absences, [])
  assert.equal(log.write.length, 3)

  // Vollzugriff: zieht beim Start um
  const admin = new DataService(store, { debounceMs: 0 })
  const data = await admin.load(() => assert.fail())
  assert.equal(data.absences.length, 1)
  assert.equal(data.employees[0].hourlyWage, 14.5)
  assert.deepEqual((await store.read(DOC.objects)).data.objects, [{ id: 'o1', name: 'Kanzlei' }])
  assert.equal((await store.read(DOC.master)).data.objects, undefined)
  assert.equal((await store.read(DOC.absences)).data.absences.length, 1)
  assert.equal((await store.read(DOC.account)).data.pay.e1.hourlyWage, 14.5)
  assert.equal(await store.read(OLD_PATHS[DOC.absences]), null)
  assert.equal(await store.read(OLD_PATHS[DOC.account]), null)
  assert.deepEqual(log.remove.sort(), Object.values(OLD_PATHS).sort())

  // danach liest das Objektmanagement die Objekte aus objekte/
  const again = await new DataService(store, { rights: dataRights(resolveAccess({ groupClaims: [OM], access, strict: true })), blank }).load(() => assert.fail())
  assert.equal(again.objects[0].name, 'Kanzlei')
})

test('Rechte: leere Ablage, zweiter Start ohne Objekte hat trotzdem eine Objektliste', async () => {
  const { store } = spyStore()
  await new DataService(store, { debounceMs: 0, blank }).load(blank)
  assert.equal(await store.read(DOC.objects), null)
  const data = await new DataService(store, { debounceMs: 0 }).load(() => assert.fail())
  assert.deepEqual(data.objects, [])
})

test('Anmeldung: nur Konten aus dem eigenen Tenant, keine Gäste', () => {
  const member = { tenantId: TENANT, homeAccountId: `oid1.${TENANT}`, idTokenClaims: { tid: TENANT } }
  assert.equal(accountProblem(member, TENANT), '')
  const guest = { tenantId: TENANT, homeAccountId: 'oid2.99999999-9999-9999-9999-999999999999', idTokenClaims: { tid: TENANT } }
  assert.match(accountProblem(guest, TENANT), /Gastkonten/)
  assert.equal(accountProblem(guest, TENANT, { allowGuests: true }), '')
  const other = { tenantId: '99999999-9999-9999-9999-999999999999', homeAccountId: 'oid3.99999999-9999-9999-9999-999999999999' }
  assert.match(accountProblem(other, TENANT), /nicht zur Firma/)
  const viaIdp = { ...member, idTokenClaims: { tid: TENANT, idp: 'live.com' } }
  assert.match(accountProblem(viaIdp, TENANT), /Gastkonten/)
  assert.match(accountProblem({ ...member, idTokenClaims: { tid: TENANT, acct: 1 } }, TENANT), /Gastkonten/)
  assert.deepEqual(groupsOf({ idTokenClaims: { groups: [OM, VA] } }), { groups: [OM, VA], overage: false })
  assert.equal(groupsOf({ idTokenClaims: { _claim_names: { groups: 'src1' } } }).overage, true)
})

test('Adresse: app.cleanos.at/#zaehler öffnet die Ansicht, Namen der früheren Werkzeuge gehen auch', () => {
  const ids = ['home', 'week', 'zaehler', 'kontrolle', 'objektmappe']
  assert.equal(viewFromHash('#start', ids), 'home')
  assert.equal(viewFromHash('#zaehler', ids), 'zaehler')
  assert.equal(viewFromHash('#wasserzaehler', ids), 'zaehler')
  assert.equal(viewFromHash('#Pruefprotokoll', ids), 'kontrolle')
  assert.equal(viewFromHash('#objektdoku', ids), 'objektmappe')
  assert.equal(viewFromHash('#dienstplan', ids), 'week')
  assert.equal(viewFromHash('#code=abc&state=xyz', ids), null)
  assert.equal(viewFromHash('', ids), null)
  assert.equal(viewFromHash('#100%', ids), null)
  assert.equal(viewFromHash('#constructor', ids), null)
})

test('Betrieb auf app.cleanos.at: SharePoint, Tenant, Vollzugriff für office@ und it@', () => {
  const base = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  const prod = JSON.parse(readFileSync(new URL('../config.production.json', import.meta.url), 'utf8'))
  const c = deepMerge(base, prod)
  assert.equal(c.storage, 'sharepoint')
  assert.equal(c.demo, false)
  assert.equal(c.sharepoint.tenantId, TENANT)
  assert.equal(c.sharepoint.siteUrl, base.sharepoint.siteUrl)
  assert.equal(c.sharepoint.allowGuests, false)
  assert.deepEqual(c.access.planners, ['office@cleanos.at', 'it@cleanos.at'])
  assert.deepEqual(Object.keys(c.access.groups), ['disposition', 'objektmanagement', 'vorarbeiter'])
  assert.equal(c.brand.name, base.brand.name)
  // Probe-Ablage bleibt im Browser
  assert.equal(base.storage, 'local')
})

test('Vertrag: Wochenstunden mit Gültigkeit, Ein- und Austritt', async () => {
  const { changeWeeklyHours, employedInWeek, sollMinutes, weeklyHoursAt } = await import('../src/core/contract.js')
  let emp = { id: 'e1', weeklyHours: 20 }
  emp = changeWeeklyHours(emp, 25, '2026-11-02')
  assert.equal(weeklyHoursAt(emp, '2026-08-10'), 20, 'August rechnet mit den damaligen 20 h')
  assert.equal(weeklyHoursAt(emp, '2026-11-02'), 25)
  assert.equal(sollMinutes(emp, '2026-08-10', '2026-08-16'), 20 * 60)
  assert.equal(sollMinutes(emp, '2026-11-02', '2026-11-08'), 25 * 60)
  // nochmals ändern ab demselben Tag ersetzt den Eintrag
  emp = changeWeeklyHours(emp, 30, '2026-11-02')
  assert.deepEqual(emp.hoursHistory.map((h) => h.weeklyHours), [20, 30])
  // Eintritt Mittwoch: 3 von 5 Werktagen
  const neu = { id: 'e2', weeklyHours: 20, entryDate: '2026-11-04' }
  assert.equal(sollMinutes(neu, '2026-11-02', '2026-11-08'), 12 * 60)
  assert.equal(sollMinutes(neu, '2026-10-26', '2026-11-01'), 0)
  const weg = { id: 'e3', weeklyHours: 40, exitDate: '2026-09-30' }
  assert.equal(sollMinutes(weg, '2026-10-05', '2026-10-11'), 0)
  assert.ok(employedInWeek(weg, '2026-09-28') && !employedInWeek(weg, '2026-10-05'))
  assert.ok(!employedInWeek(neu, '2026-10-26') && employedInWeek(neu, '2026-11-02'))
})
