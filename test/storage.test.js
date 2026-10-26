import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeDoc } from '../src/core/merge.js'
import { ConflictError, LocalDocStore } from '../src/storage/docstore-local.js'
import { SharePointDocStore } from '../src/storage/docstore-sharepoint.js'
import { DataService, DOC, MODULE_DOCS, splitData, weekPath } from '../src/storage/data-service.js'

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

const seed = () => ({
  version: 1,
  employees: [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Markus' }],
  objects: [{ id: 'o1', name: 'Kanzlei' }],
  tasks: [],
  absences: [],
  assignments: { '2026-10-27|t1': [{ employeeId: 'e1', locked: false }] },
  overrides: {},
  logs: {},
  published: {},
  skills: [],
  rules: {},
})

test('Merge: Änderungen beider Seiten bleiben erhalten', () => {
  const base = { employees: [{ id: 'a', n: 1 }, { id: 'b', n: 1 }], rules: { x: 1, y: 1 } }
  const local = { employees: [{ id: 'a', n: 2 }, { id: 'b', n: 1 }, { id: 'c', n: 1 }], rules: { x: 2, y: 1 } }
  const remote = { employees: [{ id: 'a', n: 1 }, { id: 'b', n: 3 }], rules: { x: 1, y: 3 } }
  assert.deepEqual(mergeDoc(base, local, remote), { employees: [{ id: 'a', n: 2 }, { id: 'b', n: 3 }, { id: 'c', n: 1 }], rules: { x: 2, y: 3 } })
})

test('Merge: lokal gelöschte Einträge bleiben gelöscht', () => {
  const base = { list: [{ id: 'a' }, { id: 'b' }] }
  assert.deepEqual(mergeDoc(base, { list: [{ id: 'a' }] }, { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), { list: [{ id: 'a' }, { id: 'c' }] })
})

test('Merge: beide ändern denselben Eintrag → Feld für Feld zusammengeführt', () => {
  const base = { list: [{ id: 'a', name: 'Anna', h: 20 }] }
  const local = { list: [{ id: 'a', name: 'Anna B.', h: 20 }] }
  const remote = { list: [{ id: 'a', name: 'Anna', h: 25 }] }
  assert.deepEqual(mergeDoc(base, local, remote), { list: [{ id: 'a', name: 'Anna B.', h: 25 }] })
})

test('Merge: fremde Änderung schlägt eigenes Löschen, eigene Änderung schlägt fremdes Löschen', () => {
  const base = { list: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }], map: { x: { v: 1 } } }
  const local = { list: [{ id: 'b', v: 2 }], map: {} }
  const remote = { list: [{ id: 'a', v: 9 }], map: { x: { v: 9 } } }
  assert.deepEqual(mergeDoc(base, local, remote), { list: [{ id: 'a', v: 9 }, { id: 'b', v: 2 }], map: { x: { v: 9 } } })
})

test('Merge: Listen ohne id als Menge, unbekannte Basis → gespeicherter Stand', () => {
  assert.deepEqual(mergeDoc({ tags: ['a', 'b'] }, { tags: ['a', 'c'] }, { tags: ['a', 'b', 'd'] }), { tags: ['a', 'd', 'c'] })
  assert.deepEqual(mergeDoc({}, { list: [{ id: 'a', v: 1 }, { id: 'n', v: 1 }] }, { list: [{ id: 'a', v: 2 }] }), { list: [{ id: 'a', v: 2 }, { id: 'n', v: 1 }] })
})

test('Wochenaufteilung: Einteilungen landen in der Datei ihrer Woche', () => {
  const docs = splitData({ ...seed(), assignments: { '2026-10-27|t1': [1], '2026-11-02|t1': [2] } }, new Set(['2026-10-26', '2026-11-02']))
  assert.deepEqual(Object.keys(docs[weekPath('2026-10-26')].assignments), ['2026-10-27|t1'])
  assert.deepEqual(Object.keys(docs[weekPath('2026-11-02')].assignments), ['2026-11-02|t1'])
  assert.equal(weekPath('2026-10-26'), 'plaene/2026/2026-10-26.json')
})

test('Browser-Ablage: eTag schützt vor Überschreiben', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const e1 = await store.write('a.json', { v: 1 })
  await store.write('a.json', { v: 2 }, e1)
  await assert.rejects(store.write('a.json', { v: 3 }, e1), ConflictError)
  assert.deepEqual((await store.read('a.json')).data, { v: 2 })
})

test('DataService: Erststart legt Dateien an, Änderungen werden gespeichert', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(seed)
  assert.ok(await store.read(DOC.master))
  assert.ok(await store.read(weekPath('2026-10-26')))
  data.employees.push({ id: 'e3', name: 'Neu' })
  await svc.flush()
  assert.equal((await store.read(DOC.master)).data.employees.length, 3)

  const again = new DataService(store)
  const loaded = await again.load(seed)
  await again.ensureWeeks(['2026-10-26'])
  assert.equal(loaded.employees.length, 3)
  assert.deepEqual(loaded.assignments['2026-10-27|t1'], [{ employeeId: 'e1', locked: false }])
})

test('DataService: gleichzeitige Änderungen zweier Personen werden zusammengeführt', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const a = new DataService(store)
  const b = new DataService(store)
  const da = await a.load(seed)
  const db = await b.load(seed)
  da.employees[0].name = 'Ana Popescu'
  db.employees[1].name = 'Markus Huber'
  await a.flush()
  let merged = null
  b.onRemoteChange = (kind) => (merged = kind)
  await b.flush()
  assert.equal(merged, 'merged')
  const final = (await store.read(DOC.master)).data.employees.map((e) => e.name)
  assert.deepEqual(final, ['Ana Popescu', 'Markus Huber'])
})

test('DataService: refresh lädt fremde Änderungen nach', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const a = new DataService(store)
  const b = new DataService(store)
  await a.load(seed)
  const db = await b.load(seed)
  a.data.absences.push({ id: 'x', employeeId: 'e1', type: 'Urlaub', from: '2026-10-27', to: '2026-10-28' })
  await a.flush()
  const changed = await b.refresh()
  assert.equal(changed.length, 1)
  assert.equal(db.absences.length, 1)
})

// ---------------------------------------------------------------- Nachgebauter Graph

function fakeGraph(opts = {}) {
  const files = new Map() // Pfad im Laufwerk → { body, etag }
  const folders = new Set([''])
  let n = 0
  const calls = []
  const json = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const fetchImpl = async (url, { method = 'GET', body, headers = {} } = {}) => {
    calls.push(`${method} ${url}`)
    const u = new URL(url)
    if (u.hostname === 'download.example') {
      const f = files.get(decodeURIComponent(u.pathname.slice(1)))
      return f ? new Response(f.body, { status: 200 }) : new Response(null, { status: 404 })
    }
    assert.equal(headers.Authorization, 'Bearer TOKEN')
    const p = decodeURIComponent(u.pathname.replace('/v1.0', ''))
    if (opts.siteDenied && p.startsWith('/sites/')) return json(403, { error: { message: 'Access denied' } })
    if (p === '/sites/firma.sharepoint.com:/sites/Dienstplan' || p === '/sites/firma.sharepoint.com') return json(200, { id: 'site1', displayName: 'Dienstplan' })
    if (p.startsWith('/sites/firma.sharepoint.com:')) return json(400, { error: { message: 'Invalid hostname for this tenancy' } })
    if (p.startsWith('/shares/')) {
      const url = Buffer.from(p.split('/')[2].slice(2).replace(/_/g, '/').replace(/-/g, '+'), 'base64').toString('utf8')
      calls.push(`SHARE ${url}`)
      return (opts.shared || []).includes(url) ? json(200, { id: 'item1', webUrl: url, parentReference: { driveId: 'drive1' } }) : json(403, { error: { message: 'Access denied' } })
    }
    if (p === '/sites/site1/drives') return json(200, { value: [{ id: 'drive1', name: opts.driveName || 'Dokumente', webUrl: `https://firma.sharepoint.com/sites/Dienstplan/${opts.driveUrlName || 'Freigegebene Dokumente'}` }] })
    let m = p.match(/^\/drives\/drive1\/root:\/(.+):\/children$/) || (p === '/drives/drive1/root/children' ? [p, ''] : null)
    if (m && method === 'POST') {
      const name = JSON.parse(body).name
      const full = m[1] ? `${m[1]}/${name}` : name
      if (opts.noRootRights && !m[1]) return json(403, { error: { message: 'Access denied' } })
      if (folders.has(full)) return json(409, { error: { message: 'exists' } })
      folders.add(full)
      return json(201, { name })
    }
    const kids = p.match(/^\/drives\/drive1\/root:\/(.+):\/children$/)
    if (kids && method === 'GET') {
      const dir = kids[1]
      if (!folders.has(dir)) return json(404, { error: { message: 'not found' } })
      const direct = (k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')
      return json(200, { value: [...[...folders].filter(direct).map((k) => ({ name: k.split('/').pop(), folder: {} })), ...[...files.keys()].filter(direct).map((k) => ({ name: k.split('/').pop(), file: {}, size: files.get(k).body.length }))] })
    }
    m = p.match(/^\/drives\/drive1\/root:\/(.+?)(:\/content)?$/)
    if (!m) return json(400, { error: { message: `unbekannt ${p}` } })
    const path = m[1]
    if (method === 'GET') {
      if (folders.has(path)) return json(200, { name: path.split('/').pop(), folder: {} })
      const f = files.get(path)
      if (!f) return json(404, { error: { message: 'not found' } })
      return json(200, { eTag: f.etag, '@microsoft.graph.downloadUrl': `https://download.example/${encodeURIComponent(path)}`, lastModifiedBy: { user: { displayName: 'Test' } } })
    }
    if (method === 'PUT') {
      const dir = path.split('/').slice(0, -1).join('/')
      if (!folders.has(dir)) return json(404, { error: { message: 'parent missing' } })
      const existing = files.get(path)
      if (headers['If-Match'] && existing?.etag !== headers['If-Match']) return json(412, { error: { message: 'precondition' } })
      if (u.search.includes('conflictBehavior=fail') && existing) return json(409, { error: { message: 'exists' } })
      const text = typeof body === 'string' ? body : await new Response(body).text()
      const etag = `"e${++n}"`
      files.set(path, { body: text, etag })
      return json(200, { eTag: etag, webUrl: `https://firma.sharepoint.com/${path}` })
    }
    return json(405, { error: { message: 'method' } })
  }
  return { fetchImpl, files, folders, calls }
}

test('SharePoint: Bibliothek finden, Ordner anlegen, lesen und schreiben', async () => {
  const g = fakeGraph()
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', library: 'Dokumente', folder: 'Dienstplan-App', fetchImpl: g.fetchImpl })
  await store.init()
  assert.equal(await store.read(DOC.master), null)
  const etag = await store.write(DOC.master, { employees: [] })
  assert.ok(g.folders.has('Dienstplan-App/daten'))
  const doc = await store.read(DOC.master)
  assert.deepEqual(doc.data, { employees: [] })
  assert.equal(doc.etag, etag)
  assert.equal(doc.modifiedBy, 'Test')
  await store.write(DOC.master, { employees: [{ id: 'e1' }] }, etag)
  await assert.rejects(store.write(DOC.master, { employees: [] }, etag), ConflictError)
  await assert.rejects(store.write(DOC.master, { employees: [] }), ConflictError)
})

test('SharePoint: DataService arbeitet mit Graph-Ablage', async () => {
  const g = fakeGraph()
  const make = () => new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', fetchImpl: g.fetchImpl })
  const s1 = make()
  await s1.init()
  const a = new DataService(s1)
  await a.load(seed)
  assert.ok(g.files.has('Dienstplan-App/plaene/2026/2026-10-26.json'))
  const s2 = make()
  await s2.init()
  const b = new DataService(s2)
  const db = await b.load(seed)
  await b.ensureWeeks(['2026-10-26'])
  db.assignments['2026-10-28|t1'] = [{ employeeId: 'e2', locked: true }]
  a.data.employees[0].name = 'Ana P.'
  await a.flush()
  await b.flush()
  const week = JSON.parse(g.files.get('Dienstplan-App/plaene/2026/2026-10-26.json').body)
  assert.deepEqual(Object.keys(week.assignments).sort(), ['2026-10-27|t1', '2026-10-28|t1'])
  const upload = await s1.upload('exporte/2026/KW44/Wochenplan.xlsx', new Blob(['x']), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.match(upload.webUrl, /Wochenplan\.xlsx$/)
})

test('DataService: Modul-Dateien werden getrennt gespeichert, ohne Leserecht nie geschrieben', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(seed)
  assert.equal(await store.read(MODULE_DOCS.zaehler.path), null, 'leere Module legen keine Datei an')
  data.zaehler = { meters: [{ id: 'm1', objectId: 'o1', number: 'W-1' }], readings: [] }
  await svc.flush()
  assert.equal((await store.read(MODULE_DOCS.zaehler.path)).data.meters[0].number, 'W-1')
  assert.equal((await store.read(DOC.master)).data.zaehler, undefined, 'nicht in den Stammdaten')

  // Person ohne Leserecht auf die Kontrollen (SharePoint antwortet 403)
  const denied = Object.create(store)
  denied.read = async (path) => {
    if (path === MODULE_DOCS.kontrolle.path) throw Object.assign(new Error('Zugriff verweigert'), { status: 403 })
    return store.read(path)
  }
  denied.write = async (path, doc, etag) => {
    if (path === MODULE_DOCS.kontrolle.path) throw new Error('darf nicht geschrieben werden')
    return store.write(path, doc, etag)
  }
  const other = new DataService(denied, { debounceMs: 0 })
  const d2 = await other.load(seed)
  assert.equal(d2.zaehler.meters.length, 1)
  assert.ok(!other.writable(MODULE_DOCS.kontrolle.path))
  d2.kontrolle = { checklists: [], plans: {}, inspections: [{ id: 'k1' }], defects: [] }
  d2.zaehler.readings.push({ id: 'r1', meterId: 'm1', date: '2026-10-25', value: 12 })
  await other.flush()
  assert.equal((await store.read(MODULE_DOCS.zaehler.path)).data.readings.length, 1)
  assert.equal(await store.read(MODULE_DOCS.kontrolle.path), null)
})

test('DataService: ohne Leserecht auf die Stammdaten gibt es eine klare Meldung', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  store.read = async () => {
    throw Object.assign(new Error('403'), { status: 403 })
  }
  await assert.rejects(new DataService(store).load(seed), /Kein Leserecht auf die Stammdaten/)
})

test('DataService: Stundenlöhne stehen im Zeitkonto, nicht in den Stammdaten', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(() => ({ ...seed(), employees: [{ id: 'e1', name: 'Ana', hourlyWage: 14.5, wageGroup: 5 }, { id: 'e2', name: 'Markus' }] }))
  const master = (await store.read(DOC.master)).data
  assert.deepEqual(master.employees[0], { id: 'e1', name: 'Ana' })
  assert.deepEqual((await store.read(DOC.account)).data.pay, { e1: { hourlyWage: 14.5, wageGroup: 5 } })
  assert.equal(data.employees[0].hourlyWage, 14.5)
  // neu laden: Lohn kommt aus dem Zeitkonto zurück
  const again = await new DataService(store).load(seed)
  assert.deepEqual([again.employees[0].hourlyWage, again.employees[0].wageGroup], [14.5, 5])
  // ohne Leserecht aufs Zeitkonto: kein Lohn sichtbar
  const denied = Object.create(store)
  denied.read = async (path) => {
    if (path === DOC.account) throw Object.assign(new Error('403'), { status: 403 })
    return store.read(path)
  }
  const ableser = await new DataService(denied).load(seed)
  assert.equal(ableser.employees[0].hourlyWage, undefined)
})

test('SharePoint: Website auf der Tenant-Wurzel, Bibliothek über die Adresse, Ordner nur nachsehen', async () => {
  const g = fakeGraph({ driveName: 'Cleanos Daten', driveUrlName: 'Cleanos_Daten', noRootRights: true })
  g.folders.add('Plattform')
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/', library: 'Cleanos_Daten', folder: 'Plattform', fetchImpl: g.fetchImpl })
  await store.init()
  assert.ok(g.calls.includes('GET https://graph.microsoft.com/v1.0/sites/firma.sharepoint.com'))
  await store.write('zaehler/zaehler.json', { meters: [] })
  assert.ok(g.files.has('Plattform/zaehler/zaehler.json'), 'vorhandener Ordner wird nicht neu angelegt (kein 403)')
})

test('SharePoint: nur Ordner freigegeben (Ableser) – Laufwerk über die Freigabe', async () => {
  const g = fakeGraph({ siteDenied: true, shared: ['https://firma.sharepoint.com/sites/Dienstplan/Dokumente/Plattform/zaehler'] })
  g.folders.add('Plattform').add('Plattform/zaehler')
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', library: 'Dokumente', folder: 'Plattform', fetchImpl: g.fetchImpl })
  await store.init()
  assert.equal(store.folderOnly, true)
  await store.write('zaehler/zaehler.json', { meters: [{ id: 'S-1' }] })
  assert.deepEqual((await store.read('zaehler/zaehler.json')).data, { meters: [{ id: 'S-1' }] })
  const denied = fakeGraph({ siteDenied: true, shared: [] })
  await assert.rejects(new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: denied.fetchImpl }).init(), /Access denied/)
})

test('SharePoint: Ordnerbaum und Dateien der bisherigen Werkzeuge lesen', async () => {
  const g = fakeGraph()
  g.folders.add('Wasserzähler - Ablesung').add('Wasserzähler - Ablesung/EBG').add('Wasserzähler - Ablesung/EBG/Fotos')
  g.files.set('Wasserzähler - Ablesung/EBG/Ablesung_Hallein_2026.json', { body: '﻿{"ort":"Hallein","stellen":[]}', etag: '"w1"' })
  g.files.set('Wasserzähler - Ablesung/EBG/Fotos/a.jpg', { body: 'x', etag: '"f1"' })
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: g.fetchImpl })
  await store.init()
  const tree = await store.listTree('Wasserzähler - Ablesung')
  assert.deepEqual(tree.map((f) => f.path), ['Wasserzähler - Ablesung/EBG/Ablesung_Hallein_2026.json'], 'Fotos-Ordner übersprungen')
  assert.deepEqual(await store.readRoot('Wasserzähler - Ablesung/EBG/Ablesung_Hallein_2026.json'), { ort: 'Hallein', stellen: [] })
  assert.equal(await store.readRoot('gibt/es/nicht.json'), null)
  assert.equal(store.rootUrl('A B/c.jpg'), 'https://firma.sharepoint.com/sites/Dienstplan/Freigegebene Dokumente/A%20B/c.jpg')
})

test('Woche ohne Laden bearbeitet: wird zusammengeführt statt überschrieben oder verworfen', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store, { debounceMs: 0 }).load(seed)
  const other = new DataService(store, { debounceMs: 0 })
  const od = await other.load(seed)
  await other.ensureWeeks(['2026-11-02'])
  od.assignments['2026-11-05|t2'] = ['e2']
  await other.flush()
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(seed)
  // ohne ensureWeeks: Einteilung in einer nie geladenen Woche
  data.assignments['2026-11-03|t1'] = ['e1']
  assert.equal(svc.pendingCount(), 1)
  await svc.flush()
  const saved = (await store.read(weekPath('2026-11-02'))).data.assignments
  assert.deepEqual(Object.keys(saved).sort(), ['2026-11-03|t1', '2026-11-05|t2'])
  await svc.ensureWeeks(['2026-11-02'])
  assert.deepEqual(Object.keys(data.assignments).filter((k) => k >= '2026-11-02').sort(), ['2026-11-03|t1', '2026-11-05|t2'])
})

test('Lohn einer neuen Person bleibt, wenn die Stammdaten später ankommen', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(seed)
  const office = new DataService(store, { debounceMs: 0 })
  const od = await office.load(seed)
  od.employees.push({ id: 'e9', name: 'Neu', hourlyWage: 13 })
  await office.flush()
  data.published = { '2026-10-19': { saldo: {} } }
  await svc.flush() // Konflikt im Zeitkonto → zusammengeführt, e9 noch unbekannt
  await svc.refresh() // Stammdaten mit e9 kommen an
  data.published['2026-10-26'] = { saldo: {} }
  await svc.flush()
  assert.equal((await store.read(DOC.account)).data.pay.e9.hourlyWage, 13)
  assert.equal(data.employees.find((e) => e.id === 'e9').hourlyWage, 13)
})

test('Umzug: alle Wochen unter daten/plaene/ landen in plaene/', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store, { debounceMs: 0 }).load(seed)
  await store.write('daten/plaene/2025/2025-03-03.json', { monday: '2025-03-03', assignments: { '2025-03-04|t1': ['e1'] }, overrides: {}, log: [] })
  const svc = new DataService(store, { debounceMs: 0 })
  await svc.load(seed)
  assert.equal(await svc.migrateOldWeeks(), 1)
  assert.equal(await store.read('daten/plaene/2025/2025-03-03.json'), null)
  assert.deepEqual((await store.read(weekPath('2025-03-03'))).data.assignments, { '2025-03-04|t1': ['e1'] })
})
