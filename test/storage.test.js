import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeDoc } from '../src/core/merge.js'
import { ConflictError, LocalDocStore } from '../src/storage/docstore-local.js'
import { SharePointDocStore } from '../src/storage/docstore-sharepoint.js'
import { DataService, DOC, splitData, weekPath } from '../src/storage/data-service.js'

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

test('Wochenaufteilung: Einteilungen landen in der Datei ihrer Woche', () => {
  const docs = splitData({ ...seed(), assignments: { '2026-10-27|t1': [1], '2026-11-02|t1': [2] } }, new Set(['2026-10-26', '2026-11-02']))
  assert.deepEqual(Object.keys(docs[weekPath('2026-10-26')].assignments), ['2026-10-27|t1'])
  assert.deepEqual(Object.keys(docs[weekPath('2026-11-02')].assignments), ['2026-11-02|t1'])
  assert.equal(weekPath('2026-10-26'), 'daten/plaene/2026/2026-10-26.json')
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

function fakeGraph() {
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
    if (p === '/sites/firma.sharepoint.com:/sites/Dienstplan') return json(200, { id: 'site1', displayName: 'Dienstplan' })
    if (p === '/sites/site1/drives') return json(200, { value: [{ id: 'drive1', name: 'Dokumente', webUrl: 'https://firma.sharepoint.com/sites/Dienstplan/Freigegebene Dokumente' }] })
    let m = p.match(/^\/drives\/drive1\/root:\/(.+):\/children$/) || (p === '/drives/drive1/root/children' ? [p, ''] : null)
    if (m && method === 'POST') {
      const name = JSON.parse(body).name
      const full = m[1] ? `${m[1]}/${name}` : name
      if (folders.has(full)) return json(409, { error: { message: 'exists' } })
      folders.add(full)
      return json(201, { name })
    }
    m = p.match(/^\/drives\/drive1\/root:\/(.+?)(:\/content)?$/)
    if (!m) return json(400, { error: { message: `unbekannt ${p}` } })
    const path = m[1]
    if (method === 'GET') {
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
  assert.ok(g.files.has('Dienstplan-App/daten/plaene/2026/2026-10-26.json'))
  const s2 = make()
  await s2.init()
  const b = new DataService(s2)
  const db = await b.load(seed)
  await b.ensureWeeks(['2026-10-26'])
  db.assignments['2026-10-28|t1'] = [{ employeeId: 'e2', locked: true }]
  a.data.employees[0].name = 'Ana P.'
  await a.flush()
  await b.flush()
  const week = JSON.parse(g.files.get('Dienstplan-App/daten/plaene/2026/2026-10-26.json').body)
  assert.deepEqual(Object.keys(week.assignments).sort(), ['2026-10-27|t1', '2026-10-28|t1'])
  const upload = await s1.upload('exporte/2026/KW44/Wochenplan.xlsx', new Blob(['x']), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.match(upload.webUrl, /Wochenplan\.xlsx$/)
})
