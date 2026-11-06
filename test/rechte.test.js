import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { accountProblem, groupsOf } from '../src/auth/msal.js'
import { resolveAccess } from '../src/core/access.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { DataService, dataRights, DOC, folderRights, MODULE_DOCS, OLD_PATHS, toolFolderRights, weekPath } from '../src/storage/data-service.js'
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
  // Vorarbeiter: nur das Werkzeug Wasserzähler, keine Datei der App
  const va = dataRights(resolveAccess({ groupClaims: [VA], access, strict: true }))
  for (const p of [DOC.objects, DOC.master, DOC.absences, DOC.account, weekPath('2026-10-26'), MODULE_DOCS.fahrzeuge.path]) assert.ok(!va.read(p) && !va.write(p), p)

  const om = dataRights(resolveAccess({ groupClaims: [OM], access, strict: true }))
  for (const p of [DOC.objects, DOC.master, weekPath('2026-10-26')]) assert.ok(om.read(p) && !om.write(p), p)
  for (const p of [DOC.absences, DOC.account, MODULE_DOCS.fahrzeuge.path]) assert.ok(!om.read(p), p)

  const none = dataRights(resolveAccess({ access, strict: true }))
  assert.ok(!none.read(DOC.objects) && !none.read(DOC.master))

  // Ordnertabelle für SharePoint (Ordner der App)
  const rows = (acc) => Object.fromEntries(folderRights(acc).map(([f, , r]) => [f, r]))
  assert.deepEqual(rows(resolveAccess({ groupClaims: [OM], access, strict: true })), { objekte: 'Lesen', daten: 'Lesen', plaene: 'Lesen', personal: '', lohn: '', fahrzeuge: '', reklamationen: 'Bearbeiten', kalkulation: '', material: 'Bearbeiten', schluessel: 'Bearbeiten', nachweise: 'Bearbeiten', unterweisungen: '', anlagen: 'Bearbeiten', regie: 'Bearbeiten', qualitaet: 'Bearbeiten', arbeitsschutz: 'Lesen', 'arbeitsschutz/dokumente/sdb': 'Lesen', termine: 'Bearbeiten', fakturierung: '', einkauf: '', assistenz: 'Bearbeiten', berichte: '', kundenbereich: 'Bearbeiten', exporte: '' })
  // Termine: Objektmanagement trägt ein; Vorarbeiter sieht sie nicht
  assert.ok(om.read(MODULE_DOCS.termine.path) && om.write(MODULE_DOCS.termine.path) && !va.read(MODULE_DOCS.termine.path))
  // Unterweisungen & Fristen: Objektleitung bearbeitet, Objektmanagement nicht
  assert.ok(dataRights(resolveAccess({ roleClaims: ['objektleitung'], access, strict: true })).write(MODULE_DOCS.unterweisungen.path) && !om.read(MODULE_DOCS.unterweisungen.path))
  // Anlagen & Prüffristen: Objektmanagement, Objektleitung und Objektservice bearbeiten (auch Fotos und Prüfberichte im Ordner), Vorarbeiter und Lager nicht
  for (const role of ['objektleitung', 'objektservice']) {
    const r = dataRights(resolveAccess({ roleClaims: [role], access, strict: true }))
    assert.ok(r.write(MODULE_DOCS.anlagen.path) && r.write('anlagen/nachweise/2026/foto.jpg') && r.read(DOC.objects) && r.write(MODULE_DOCS.assistenz.path), role)
  }
  assert.ok(om.write(MODULE_DOCS.anlagen.path) && !va.read(MODULE_DOCS.anlagen.path) && !dataRights(resolveAccess({ roleClaims: ['lager'], access, strict: true })).read(MODULE_DOCS.anlagen.path))
  assert.ok(!dataRights(resolveAccess({ roleClaims: ['lesen'], access, strict: true })).read(MODULE_DOCS.anlagen.path))
  // Regieberichte: Objektmanagement, Objektleitung und Objektservice erfassen (Datei, Fotos und PDF im Ordner regie/);
  // Buchhaltung, Lager, Vorarbeiter und „Nur lesen“ nicht (die Buchhaltung bekommt den Bericht eingefroren mit der Rechnung)
  for (const role of ['objektleitung', 'objektservice']) {
    const r = dataRights(resolveAccess({ roleClaims: [role], access, strict: true }))
    assert.ok(r.write(MODULE_DOCS.regie.path) && r.write('regie/nachweise/2026/RB-2026-0001_Lehen_2026-11-05_Regiebericht.pdf') && r.read(DOC.objects) && !r.read(MODULE_DOCS.fakturierung.path), role)
  }
  assert.ok(om.write(MODULE_DOCS.regie.path) && !va.read(MODULE_DOCS.regie.path))
  for (const role of ['lager', 'lesen', 'buchhaltung']) assert.ok(!dataRights(resolveAccess({ roleClaims: [role], access, strict: true })).read(MODULE_DOCS.regie.path), role)
  assert.equal(rows(resolveAccess({ roleClaims: ['buchhaltung'], access, strict: true })).regie, '')
  // Qualitätsmessung: Objektleitung und Objektmanagement messen (auch Fotos und Berichte im Ordner); der Objektservice
  // misst sich nicht selbst, Lager und Vorarbeiter sehen nichts; eine eigene Büro-Rolle mit dem Modul liest nur
  for (const role of ['objektleitung', 'objektmanagement']) {
    const acc = resolveAccess({ roleClaims: [role], access, strict: true })
    const r = dataRights(acc)
    assert.ok(acc.canEdit('qualitaet') && r.write(MODULE_DOCS.qualitaet.path) && r.write('qualitaet/nachweise/2026/bericht.pdf') && r.read(DOC.objects) && r.write(MODULE_DOCS.assistenz.path), role)
  }
  for (const role of ['objektservice', 'lager', 'vorarbeiter', 'lesen', 'buchhaltung', 'pruefer']) {
    const acc = resolveAccess({ roleClaims: [role], access, strict: true })
    assert.ok(!acc.sees('qualitaet') && !dataRights(acc).read(MODULE_DOCS.qualitaet.path) && !dataRights(acc).read('qualitaet/nachweise/2026/bericht.pdf'), role)
  }
  const buero = resolveAccess({ roleClaims: ['buero'], access: { ...access, roles: { buero: { label: 'Büro (Qualität lesen)', modules: ['planung', 'qualitaet'], edit: [] } } }, strict: true })
  assert.ok(buero.sees('qualitaet') && !buero.canEdit('qualitaet') && dataRights(buero).read(MODULE_DOCS.qualitaet.path) && !dataRights(buero).write(MODULE_DOCS.qualitaet.path))
  assert.equal(Object.fromEntries(folderRights(buero).map(([f, , r]) => [f, r])).qualitaet, 'Lesen')
  assert.ok(resolveAccess({ email: 'office@cleanos.at', access, strict: true }).canEdit('qualitaet'))
  // Schlüsselbuch: Objektmanagement bearbeitet, Vorarbeiter sieht es nicht
  assert.ok(om.read(MODULE_DOCS.schluessel.path) && om.write(MODULE_DOCS.schluessel.path) && !va.read(MODULE_DOCS.schluessel.path))
  // Material & Lager: Objektmanagement fordert an und gibt aus; Vorarbeiter sieht es nicht
  assert.ok(om.read(MODULE_DOCS.material.path) && om.write(MODULE_DOCS.material.path))
  assert.ok(!va.read(MODULE_DOCS.material.path))
  // Rolle Lager & Einkauf: Material bearbeiten, Objekte und Personen (für die Ausgabe) nur lesen, sonst nichts
  const lager = dataRights(resolveAccess({ roleClaims: ['Dienstplan.Lager'], access, strict: true }))
  assert.ok(lager.read(MODULE_DOCS.material.path) && lager.write(MODULE_DOCS.material.path))
  assert.ok(lager.read(DOC.objects) && lager.read(DOC.master) && !lager.write(DOC.master))
  for (const p of [DOC.absences, DOC.account, weekPath('2026-10-26'), MODULE_DOCS.kalkulation.path, MODULE_DOCS.reklamationen.path]) assert.ok(!lager.read(p), p)
  // Fakturierung: nur Buchhaltung (und Vollzugriff); Buchhaltung liest dazu nur die Objekte
  const fak = dataRights(resolveAccess({ roleClaims: ['Dienstplan.Buchhaltung'], access, strict: true }))
  assert.ok(fak.read(MODULE_DOCS.fakturierung.path) && fak.write(MODULE_DOCS.fakturierung.path))
  assert.ok(fak.read(DOC.objects) && !fak.write(DOC.objects))
  for (const p of [DOC.master, DOC.absences, DOC.account, weekPath('2026-10-26'), MODULE_DOCS.kalkulation.path, MODULE_DOCS.material.path]) assert.ok(!fak.read(p), p)
  for (const r of [om, va, lager]) assert.ok(!r.read(MODULE_DOCS.fakturierung.path))
  assert.equal(rows(resolveAccess({ roleClaims: ['buchhaltung'], access, strict: true })).fakturierung, 'Bearbeiten')
  // Einkauf & Kasse (Lieferanten mit Bankverbindung, Eingangsrechnungen, Kassenbuch): Buchhaltung bearbeitet, sonst nur Vollzugriff
  for (const p of [MODULE_DOCS.einkauf.path, MODULE_DOCS.kasse.path]) {
    assert.ok(fak.read(p) && fak.write(p), p)
    for (const r of [om, va, lager, dataRights(resolveAccess({ roleClaims: ['objektleitung'], access, strict: true })), dataRights(resolveAccess({ roleClaims: ['lesen'], access, strict: true })), dataRights(resolveAccess({ roleClaims: ['lohnverrechnung'], access, strict: true }))]) assert.ok(!r.read(p) && !r.write(p), p)
  }
  assert.equal(rows(resolveAccess({ roleClaims: ['buchhaltung'], access, strict: true })).einkauf, 'Bearbeiten')
  assert.equal(rows(resolveAccess({ roleClaims: ['objektleitung'], access, strict: true })).einkauf, '')
  assert.equal(rows(resolveAccess({ roleClaims: ['lager'], access, strict: true })).einkauf, '', 'Lager bestellt, sieht aber keine Rechnungen und Bankdaten')
  // Kundenbereich (Links wirken wie Passwörter): wer Reklamationen oder die Planung bearbeitet; Lager, Buchhaltung, Vorarbeiter nicht
  assert.ok(om.read(MODULE_DOCS.kundenbereich.path) && om.write(MODULE_DOCS.kundenbereich.path))
  for (const r of [va, lager, fak, dataRights(resolveAccess({ roleClaims: ['lesen'], access, strict: true }))]) assert.ok(!r.read(MODULE_DOCS.kundenbereich.path))
  // Reklamationen: Objektmanagement bearbeitet, Vorarbeiter sieht sie nicht
  assert.ok(om.read(MODULE_DOCS.reklamationen.path) && om.write(MODULE_DOCS.reklamationen.path))
  assert.ok(!va.read(MODULE_DOCS.reklamationen.path))
  assert.ok(Object.values(rows(resolveAccess({ groupClaims: [VA], access, strict: true }))).every((r) => r === ''))
  const full = folderRights(resolveAccess({ email: 'office@cleanos.at', access, strict: true }))
  assert.ok(full.every(([, , r]) => r === 'Bearbeiten'))

  // Ordner der Werkzeuge (neben dem Ordner der App)
  const tools = (acc) => Object.fromEntries(toolFolderRights(acc).map(([f, , r]) => [f, r]))
  assert.deepEqual(tools(resolveAccess({ groupClaims: [VA], access, strict: true })), { 'Wasserzähler - Ablesung': 'Bearbeiten', Objektpruefprotokolle: '', Objektdoku: '', Mattenwechsel: '', Stammdaten: 'Lesen' })
  assert.deepEqual(tools(resolveAccess({ groupClaims: [OM], access, strict: true })), { 'Wasserzähler - Ablesung': '', Objektpruefprotokolle: 'Bearbeiten', Objektdoku: 'Bearbeiten', Mattenwechsel: '', Stammdaten: 'Lesen' })
  // Prüfer: Objektdoku nur lesen, Objektliste der Kontrolle bearbeiten
  assert.deepEqual(tools(resolveAccess({ roleClaims: ['pruefer'], access, strict: true })).Objektdoku, 'Lesen')
  assert.ok(toolFolderRights(resolveAccess({ email: 'it@cleanos.at', access, strict: true })).every(([, , r]) => r === 'Bearbeiten'))
})

test('Rechte: Arbeitsschutz – Vollzugriff bearbeitet, Objektleitung und Objektmanagement lesen, Lager pflegt die Arbeitsstoffe', () => {
  const role = (id) => resolveAccess({ roleClaims: [id], access, strict: true })
  const rights = (id) => dataRights(role(id))
  const rows = (acc) => Object.fromEntries(folderRights(acc).map(([f, , x]) => [f, x]))
  const FILE = MODULE_DOCS.arbeitsschutz.path
  const SDB = 'arbeitsschutz/dokumente/sdb/Sanitaerreiniger_2025-10-01_s1.pdf'
  const BA = 'arbeitsschutz/dokumente/betriebsanweisungen/Betriebsanweisung_Sanitaerreiniger_2026-11-06.pdf'
  assert.equal(FILE, 'arbeitsschutz/arbeitsschutz.json')
  // Vollzugriff: alles, auch die Angaben am Artikel
  const voll = resolveAccess({ email: 'office@cleanos.at', access, strict: true })
  assert.ok(voll.canEdit('arbeitsschutz') && voll.canEdit('arbeitsstoffe'))
  for (const p of [FILE, SDB, BA, MODULE_DOCS.material.path]) assert.ok(dataRights(voll).write(p), p)
  // Objektleitung und Objektmanagement: sehen den Arbeitsschutz (lesen, Betriebsanweisungen drucken), ändern nichts daran
  for (const id of ['objektleitung', 'objektmanagement']) {
    const a = role(id)
    const r = rights(id)
    assert.ok(a.sees('arbeitsschutz') && !a.canEdit('arbeitsschutz') && !a.canEdit('arbeitsstoffe'), id)
    assert.ok(r.read(FILE) && !r.write(FILE) && r.read(BA) && !r.write(BA) && r.read(SDB) && !r.write(SDB), id)
    assert.ok(r.read(MODULE_DOCS.material.path) && r.read(DOC.master) && r.read(DOC.objects), id)
    assert.deepEqual([rows(a).arbeitsschutz, rows(a)['arbeitsschutz/dokumente/sdb']], ['Lesen', 'Lesen'], id)
  }
  // Lager: Angaben am Artikel (material.json) und Sicherheitsdatenblätter hochladen; Evaluierung und Betriebsanweisungen nur lesen
  const lager = role('lager')
  const lr = rights('lager')
  assert.ok(lager.sees('arbeitsschutz') && !lager.canEdit('arbeitsschutz') && lager.canEdit('arbeitsstoffe') && lager.canEdit('material'))
  assert.ok(lr.write(MODULE_DOCS.material.path) && lr.write(SDB) && lr.read(FILE) && !lr.write(FILE) && !lr.write(BA))
  assert.deepEqual([rows(lager).arbeitsschutz, rows(lager)['arbeitsschutz/dokumente/sdb'], rows(lager).material], ['Lesen', 'Bearbeiten', 'Bearbeiten'])
  // ohne Recht: weder Datei noch Dokumente, auch nicht über den Unterordner
  for (const id of ['objektservice', 'buchhaltung', 'vorarbeiter', 'lesen', 'lohnverrechnung', 'pruefer', 'fuhrpark', 'mattenwechsel']) {
    const r = rights(id)
    assert.ok(!role(id).sees('arbeitsschutz') && !r.read(FILE) && !r.read(SDB) && !r.write(SDB) && !r.read(BA), id)
    assert.equal(rows(role(id)).arbeitsschutz, '', id)
  }
  // eigene Rolle „Sicherheitsfachkraft“ über config.json: Arbeitsschutz bearbeiten, Artikel nur lesen
  const own = resolveAccess({ roleClaims: ['sicherheit'], access: { ...access, roles: { sicherheit: { label: 'Sicherheitsfachkraft', modules: ['arbeitsschutz', 'unterweisungen'], edit: ['arbeitsschutz'] } } }, strict: true })
  const or = dataRights(own)
  assert.ok(or.write(FILE) && or.write(BA) && or.write(SDB) && or.read(MODULE_DOCS.material.path) && !or.write(MODULE_DOCS.material.path) && or.write(MODULE_DOCS.assistenz.path))
})

test('Rechte: Mattenwechsel wird pro Gruppe zugewiesen', () => {
  const MW = '33333333-3333-3333-3333-333333333333'
  const acc = { ...access, groups: { ...access.groups, mattenwechsel: [MW] } }
  const mw = resolveAccess({ groupClaims: [MW], access: acc, strict: true })
  assert.ok(mw.sees('matten') && mw.canEdit('matten'))
  for (const m of ['planung', 'zaehler', 'kontrolle', 'objektmappe', 'fahrzeuge', 'auswertung', 'stammdaten']) assert.ok(!mw.sees(m), m)
  // die App selbst liest für diese Gruppe nichts aus der Plattform-Ablage
  const r = dataRights(mw)
  for (const p of [DOC.objects, DOC.master, DOC.absences, DOC.account, weekPath('2026-10-26')]) assert.ok(!r.read(p), p)
  // SharePoint: Mattenwechsel und Kundenstamm bearbeiten (Kundenliste beim Abschließen), sonst nichts
  const tools = Object.fromEntries(toolFolderRights(mw).map(([f, , x]) => [f, x]))
  assert.deepEqual(tools, { 'Wasserzähler - Ablesung': '', Objektpruefprotokolle: '', Objektdoku: '', Mattenwechsel: 'Bearbeiten', Stammdaten: 'Bearbeiten' })
  // zusammen mit Vorarbeiter: beides
  const beide = resolveAccess({ groupClaims: [MW, VA], access: acc, strict: true })
  assert.ok(beide.sees('matten') && beide.sees('zaehler'))
  // ohne Eintrag sieht nur Vollzugriff den Mattenwechsel
  assert.ok(!resolveAccess({ groupClaims: [OM], access: acc, strict: true }).sees('matten'))
})

test('Rechte: Vorarbeiter fragt keine Datei der App an (nur das Werkzeug Wasserzähler)', async () => {
  const { store, log } = spyStore()
  // Bestand der Disposition
  const admin = new DataService(store, { debounceMs: 0 })
  await admin.load(() => ({ ...blank(), employees: [{ id: 'e1', name: 'Ana', phone: '0664' }], objects: [{ id: 'o1', name: 'Wohnanlage Lehen' }], absences: [{ id: 'a1', employeeId: 'e1', type: 'Krankenstand', from: '2026-10-26', to: '2026-10-30' }] }))
  log.read.length = 0
  log.write.length = 0

  const rights = dataRights(resolveAccess({ groupClaims: [VA], access, strict: true }))
  const va = new DataService(store, { debounceMs: 0, rights, blank })
  const data = await va.load(() => assert.fail('legt nichts an'))
  assert.deepEqual(log.read, [])
  assert.deepEqual(data.employees, [])
  assert.deepEqual(data.absences, [])
  data.tasks.push({ id: 'x' }) // dürfte die Rolle nicht, wird nicht gespeichert
  await va.flush()
  assert.deepEqual(log.write, [])
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
  assert.equal(viewFromHash('#mattenwechsel', [...ids, 'matten']), 'matten')
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
  assert.deepEqual(Object.keys(c.access.groups), ['disposition', 'objektmanagement', 'vorarbeiter', 'mattenwechsel'])
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

test('Oberfläche: Schreibrecht je Bereich, nicht je Ansicht (Suche/Übersicht öffnen keine Hintertür)', async () => {
  const { app, mayEdit } = await import('../src/ui/context.js')
  const before = { access: app.access, locked: app.locked, readOnly: app.readOnly }
  try {
    app.access = resolveAccess({ roleClaims: ['Dienstplan.Objektmanagement'], strict: true })
    app.readOnly = false // z. B. auf der Übersicht
    assert.equal(mayEdit('planung'), false)
    assert.equal(mayEdit('stammdaten'), false)
    assert.equal(mayEdit('kontrolle'), true)
    assert.equal(mayEdit(['planung', 'objektmappe']), true)
    assert.equal(mayEdit('*'), false)
    app.access = resolveAccess({ roleClaims: ['Dienstplan.Disposition'], strict: true })
    assert.equal(mayEdit('*'), true)
    app.locked = true // Woche ohne Netz nicht geladen
    assert.equal(mayEdit('planung'), false)
    assert.equal(mayEdit('stammdaten'), true)
  } finally {
    Object.assign(app, before)
  }
})

test('Rechte: „abwesend“ ohne Grund für Objektmanagement, Krankenstand bleibt in personal/', async () => {
  const om = dataRights(resolveAccess({ groupClaims: [OM], access, strict: true }))
  assert.ok(om.read(DOC.absent) && !om.write(DOC.absent) && !om.read(DOC.absences))
  const ol = dataRights(resolveAccess({ roleClaims: ['objektleitung'], access, strict: true }))
  assert.ok(ol.read(DOC.absent) && !ol.read(DOC.absences))
  const va = dataRights(resolveAccess({ groupClaims: [VA], access, strict: true }))
  assert.ok(!va.read(DOC.absent))

  const { store, log } = spyStore()
  const admin = new DataService(store, { debounceMs: 0 })
  const data = await admin.load(() => ({ ...blank(), employees: [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bo' }], absences: [{ id: 'a1', employeeId: 'e1', type: 'Krankenstand', from: '2026-10-26', to: '2026-10-30', note: 'Grippe' }] }))
  data.absences.push({ id: 'a2', employeeId: 'e2', type: 'Urlaub', from: '2026-11-02' })
  await admin.flush()
  const saved = (await store.read(DOC.absent)).data.absent
  assert.deepEqual(saved, [
    { id: 'a1', employeeId: 'e1', from: '2026-10-26', to: '2026-10-30' },
    { id: 'a2', employeeId: 'e2', from: '2026-11-02', to: '2026-11-02' },
  ])
  assert.ok(!JSON.stringify(saved).includes('Krankenstand') && !JSON.stringify(saved).includes('Grippe'))

  // Objektmanagement: sieht wer wann fehlt, ohne Grund, und schreibt nichts
  log.write.length = 0
  const o = new DataService(store, { debounceMs: 0, rights: om, blank })
  const od = await o.load(() => assert.fail())
  assert.deepEqual(od.absences.map((a) => [a.employeeId, a.type, a.from, a.to, a.note]), [
    ['e1', 'Abwesend', '2026-10-26', '2026-10-30', undefined],
    ['e2', 'Abwesend', '2026-11-02', '2026-11-02', undefined],
  ])
  await o.flush()
  assert.deepEqual(log.write, [])

  // Vollzugriff behält die vollständigen Abwesenheiten (nicht von der Liste überschrieben)
  const again = await new DataService(store, { debounceMs: 0 }).load(() => assert.fail())
  assert.deepEqual(again.absences.map((a) => a.type), ['Krankenstand', 'Urlaub'])
  assert.equal(again.absences[0].note, 'Grippe')
})

test('Rechte: Kalkulation nur Vollzugriff; Nachweise senden mit Schreibrecht, nicht „Nur lesen“', () => {
  const lohn = dataRights(resolveAccess({ roleClaims: ['lohnverrechnung'], access, strict: true }))
  assert.ok(!lohn.read(MODULE_DOCS.kalkulation.path) && !lohn.write(MODULE_DOCS.kalkulation.path))
  assert.ok(dataRights(resolveAccess({ email: 'office@cleanos.at', access, strict: true })).write(MODULE_DOCS.kalkulation.path))
  const lesen = dataRights(resolveAccess({ roleClaims: ['lesen'], access, strict: true }))
  assert.ok(lesen.read(MODULE_DOCS.nachweise.path) && !lesen.write(MODULE_DOCS.nachweise.path))
  const ol = dataRights(resolveAccess({ roleClaims: ['objektleitung'], access, strict: true }))
  assert.ok(ol.read(MODULE_DOCS.nachweise.path) && ol.write(MODULE_DOCS.nachweise.path))
})

test('Anmeldung: nach Zeitüberschreitung im unsichtbaren Fenster neu anmelden, bei Netzfehlern nicht', async () => {
  const { needsReauth } = await import('../src/auth/msal.js')
  assert.equal(needsReauth({ errorCode: 'monitor_window_timeout' }), true)
  assert.equal(needsReauth({ errorCode: 'login_required' }), true)
  assert.equal(needsReauth({ errorCode: 'no_network_connectivity' }), false)
  assert.equal(needsReauth(new Error('x')), false)
  assert.equal(needsReauth(null), false)
})

test('Gruppen über Microsoft Graph, wenn das Token keine hat: mit Folgeseiten, nur Gruppen; ohne Netz der gemerkte Stand', async () => {
  const { memberGroups } = await import('../src/auth/msal.js')
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const pages = {
    'https://graph.microsoft.com/v1.0/me/transitiveMemberOf': { value: [{ '@odata.type': '#microsoft.graph.group', id: 'AAAA-1' }, { '@odata.type': '#microsoft.graph.directoryRole', id: 'rolle' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$skiptoken=2' },
    'https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$skiptoken=2': { value: [{ '@odata.type': '#microsoft.graph.group', id: 'bbbb-2' }] },
  }
  const seen = []
  const fetchImpl = async (url, opts) => (seen.push(opts.headers.Authorization), { ok: true, json: async () => pages[url] })
  const got = await memberGroups(async () => 'T', { userId: 'u1', fetchImpl, storage, now: 1000 })
  assert.deepEqual(got, { groups: ['aaaa-1', 'bbbb-2'], from: 'graph' })
  assert.deepEqual(seen, ['Bearer T', 'Bearer T'])
  const offline = async () => { throw new TypeError('Failed to fetch') }
  assert.deepEqual(await memberGroups(async () => 'T', { userId: 'u1', fetchImpl: offline, storage, now: 1000 + 864e5 }), { groups: ['aaaa-1', 'bbbb-2'], from: 'gemerkt' })
  assert.equal(await memberGroups(async () => 'T', { userId: 'u1', fetchImpl: offline, storage, now: 1000 + 15 * 864e5 }), null, 'nach 14 Tagen nicht mehr')
  assert.equal(await memberGroups(async () => 'T', { userId: 'u2', fetchImpl: offline, storage }), null, 'je Konto getrennt')
})
