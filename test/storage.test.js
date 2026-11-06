import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeDoc } from '../src/core/merge.js'
import { ConflictError, LocalDocStore } from '../src/storage/docstore-local.js'
import { SharePointDocStore } from '../src/storage/docstore-sharepoint.js'
import { DataService, DOC, MODULE_DOCS, splitData, weekPath } from '../src/storage/data-service.js'
import { emptyCashbook } from '../src/core/cashbook.js'
import { emptyPurchase } from '../src/core/purchase.js'

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
    if (!headers['X-Teil']) calls.push(`${method} ${url}`)
    const u = new URL(url)
    if (u.pathname === '/v1.0/$batch' && method === 'POST') {
      // Graph $batch: je Teilanfrage wie eine einzelne beantworten
      assert.equal(headers.Authorization, 'Bearer TOKEN')
      const { requests } = JSON.parse(body)
      assert.ok(requests.length <= 20, 'höchstens 20 je $batch')
      const responses = []
      for (const r of requests) {
        if (opts.throttleOnce && !opts.throttled?.has(r.url)) {
          ;(opts.throttled ||= new Set()).add(r.url)
          responses.push({ id: r.id, status: 429, headers: { 'Retry-After': '0' }, body: { error: { message: 'throttled' } } })
          continue
        }
        const res = await fetchImpl(`https://graph.microsoft.com/v1.0${r.url}`, { method: r.method, headers: { Authorization: 'Bearer TOKEN', 'X-Teil': '1' } })
        responses.push({ id: r.id, status: res.status, headers: {}, body: await res.json().catch(() => null) })
      }
      return json(200, { responses })
    }
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
      return json(200, { value: [...[...folders].filter(direct).map((k) => ({ name: k.split('/').pop(), folder: {} })), ...[...files.keys()].filter(direct).map((k) => ({ name: k.split('/').pop(), file: {}, size: files.get(k).body.length, eTag: files.get(k).etag }))] })
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
  assert.equal(await store.read(MODULE_DOCS.fahrzeuge.path), null, 'leere Module legen keine Datei an')
  data.fahrzeuge = { vehicles: [{ id: 'v1', plate: 'S-1' }], workshops: [], changes: [], settings: {} }
  await svc.flush()
  assert.equal((await store.read(MODULE_DOCS.fahrzeuge.path)).data.vehicles[0].plate, 'S-1')
  assert.equal((await store.read(DOC.master)).data.fahrzeuge, undefined, 'nicht in den Stammdaten')

  // Person ohne Leserecht auf die Abwesenheiten (SharePoint antwortet 403)
  const denied = Object.create(store)
  denied.read = async (path) => {
    if (path === DOC.absences) throw Object.assign(new Error('Zugriff verweigert'), { status: 403 })
    return store.read(path)
  }
  denied.write = async (path, doc, etag) => {
    if (path === DOC.absences) throw new Error('darf nicht geschrieben werden')
    return store.write(path, doc, etag)
  }
  const other = new DataService(denied, { debounceMs: 0 })
  const d2 = await other.load(seed)
  assert.equal(d2.fahrzeuge.vehicles.length, 1)
  assert.ok(!other.writable(DOC.absences))
  d2.absences.push({ id: 'a1', employeeId: 'e1', type: 'Urlaub', from: '2026-11-02', to: '2026-11-06' })
  d2.fahrzeuge.changes.push({ id: 'c1', vehicleId: 'v1', date: '2026-10-25' })
  await other.flush()
  assert.equal((await store.read(MODULE_DOCS.fahrzeuge.path)).data.changes.length, 1)
  assert.equal(await store.read(DOC.absences), null)
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
  await store.write('fahrzeuge/fahrzeuge.json', { vehicles: [] })
  assert.ok(g.files.has('Plattform/fahrzeuge/fahrzeuge.json'), 'vorhandener Ordner wird nicht neu angelegt (kein 403)')
})

test('SharePoint: nur Ordner freigegeben (Ableser) – Laufwerk über die Freigabe', async () => {
  const g = fakeGraph({ siteDenied: true, shared: ['https://firma.sharepoint.com/sites/Dienstplan/Dokumente/Plattform/fahrzeuge'] })
  g.folders.add('Plattform').add('Plattform/fahrzeuge')
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', library: 'Dokumente', folder: 'Plattform', fetchImpl: g.fetchImpl })
  await store.init()
  assert.equal(store.folderOnly, true)
  await store.write('fahrzeuge/fahrzeuge.json', { vehicles: [{ id: 'v1' }] })
  assert.deepEqual((await store.read('fahrzeuge/fahrzeuge.json')).data, { vehicles: [{ id: 'v1' }] })
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


// ---------------------------------------------------------------- Gebündelt lesen, Schnellstart

test('SharePoint: viele Dateien gebündelt lesen ($batch), eTags in einer Anfrage', async () => {
  const g = fakeGraph({ throttleOnce: true })
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: g.fetchImpl })
  await store.init()
  const paths = Array.from({ length: 23 }, (_, i) => `plaene/2026/w${String(i).padStart(2, '0')}.json`)
  for (const p of paths.slice(0, 20)) await store.write(p, { p }, null)
  g.calls.length = 0
  const res = await store.readMany(paths)
  // 23 Metadaten in zwei $batch-Anfragen (20 + 3), gedrosselte Teile nochmals, Inhalte direkt
  const batches = g.calls.filter((c) => c.startsWith('POST https://graph.microsoft.com/v1.0/$batch')).length
  assert.ok(batches >= 2 && batches <= 4, `Anzahl $batch: ${batches}`)
  assert.equal(g.calls.filter((c) => c.startsWith('GET https://download.example/')).length, 20)
  assert.deepEqual(res.get(paths[3]).doc.data, { p: paths[3] })
  assert.ok(res.get(paths[3]).doc.etag)
  assert.equal(res.get(paths[22]).doc, null)
  g.calls.length = 0
  const etags = await store.etagsOf(paths)
  assert.equal(etags.get(paths[0]), res.get(paths[0]).doc.etag)
  assert.equal(etags.get(paths[21]), null)
  assert.ok(g.calls.every((c) => !c.startsWith('GET https://graph.microsoft.com')), 'keine Einzelanfragen')
})

test('Schnellstart: zweiter Start aus dem Gerät ohne Warten auf SharePoint, Neueres kommt im Hintergrund', async () => {
  const { CachedDocStore, memoryCache } = await import('../src/storage/offline.js')
  const g = fakeGraph()
  const make = () => new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: g.fetchImpl })
  const cache = memoryCache()
  // erster Start: normal (legt an), dann eine Woche öffnen
  const s1 = new CachedDocStore(make(), cache)
  await s1.init({ quick: true })
  const a = new DataService(s1, { debounceMs: 0, local: cache, quickStart: true })
  await a.load(seed)
  await a.ensureWeeks(['2026-10-26'])
  a.data.assignments['2026-10-28|t1'] = [{ employeeId: 'e2', locked: true }]
  await a.flush()
  // zweiter Start: zuerst nur Gerätespeicher
  const remoteB = make()
  const s2 = new CachedDocStore(remoteB, cache)
  g.calls.length = 0
  let gate
  const hold = new Promise((r) => (gate = r))
  const origFetch = remoteB.fetch
  remoteB.fetch = async (...args) => {
    await hold // SharePoint „hängt“, bis der Start fertig ist
    return origFetch(...args)
  }
  const changes = []
  await s2.init({ quick: true })
  const b = new DataService(s2, { debounceMs: 0, local: cache, quickStart: true, onRemoteChange: (kind, changed) => changes.push([kind, changed.map((c) => c.path)]) })
  const data = await b.load(seed)
  assert.equal(b.fromCache, true)
  assert.equal(b.status, 'syncing')
  assert.equal(data.employees.length, 2)
  await b.ensureWeeks(['2026-10-26'])
  assert.deepEqual(data.assignments['2026-10-28|t1'], [{ employeeId: 'e2', locked: true }], 'Woche aus dem Gerät')
  // inzwischen ändert jemand anderes die Stammdaten in SharePoint
  const other = new DataService(make(), { debounceMs: 0 })
  await other.store.init()
  await other.load(seed)
  other.data.employees.push({ id: 'e3', name: 'Neu' })
  await other.flush()
  // und hier wird gleichzeitig etwas geändert
  data.employees[0].name = 'Ana Lokal'
  gate()
  await b.synced()
  await b.flush()
  assert.deepEqual(data.employees.map((e) => e.name), ['Ana Lokal', 'Markus', 'Neu'], 'zusammengeführt')
  assert.ok(changes.some(([kind, paths]) => kind === 'loaded' && paths.includes(DOC.master)))
  // gespeichert: SharePoint hat beides
  const check = new DataService(make(), { debounceMs: 0 })
  await check.store.init()
  await check.load(seed)
  assert.deepEqual(check.data.employees.map((e) => e.name), ['Ana Lokal', 'Markus', 'Neu'])
  assert.notEqual(b.status, 'syncing')
})

test('Schnellstart: erst nach einem normalen Start und nur mit Kernliste im Gerät', async () => {
  const { CachedDocStore, memoryCache } = await import('../src/storage/offline.js')
  const g = fakeGraph()
  const make = () => new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: g.fetchImpl })
  const cache = memoryCache()
  const first = new DataService(new CachedDocStore(make(), cache), { debounceMs: 0, local: cache, quickStart: true })
  await first.store.init({ quick: true })
  await first.load(seed)
  assert.equal(first.fromCache, undefined, 'erster Start normal')
  assert.equal(first.firstRun, true)
  assert.equal(await cache.get('meta', 'ablage'), 2)
  // Gerät ohne Kopie der Stammdaten: normal laden
  await cache.del('docs', DOC.master)
  const second = new DataService(new CachedDocStore(make(), cache), { debounceMs: 0, local: cache, quickStart: true })
  await second.store.init({ quick: true })
  await second.load(seed)
  assert.equal(second.fromCache, undefined)
  // gemerktes Laufwerk: init fragt die Website nicht mehr ab, prüft aber im Hintergrund
  g.calls.length = 0
  const r3 = make()
  let gate
  const hold = new Promise((r) => (gate = r))
  const orig = r3.fetch
  r3.fetch = async (...args) => {
    await hold
    return orig(...args)
  }
  const s3 = new CachedDocStore(r3, cache)
  const res = await s3.init({ quick: true }) // wartet nicht auf SharePoint
  assert.equal(res.quick, true)
  assert.equal(r3.driveId, 'drive1')
  gate()
  await s3.verified
  assert.ok(g.calls.some((c) => c.includes('/sites/')), 'Nachprüfung im Hintergrund')
})

test('Abgleich: anderes Fenster übernimmt Gespeichertes aus dem Gerät, ohne SharePoint zu fragen', async () => {
  const { CachedDocStore, memoryCache } = await import('../src/storage/offline.js')
  const g = fakeGraph()
  const make = () => new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', folder: 'Plattform', fetchImpl: g.fetchImpl })
  const cache = memoryCache()
  const saved = []
  const a = new DataService(new CachedDocStore(make(), cache), { debounceMs: 0, local: cache, onSaved: (p) => saved.push(...p) })
  await a.store.init()
  await a.load(seed)
  const b = new DataService(new CachedDocStore(make(), cache), { debounceMs: 0, local: cache })
  await b.store.init()
  await b.load(seed)
  // A ändert zwei Dateien: gleichzeitig gespeichert, onSaved meldet beide
  saved.length = 0
  a.data.employees[1].name = 'Markus Neu'
  a.data.absences.push({ id: 'x1', employeeId: 'e1', type: 'Urlaub', from: '2026-11-02', to: '2026-11-03' })
  await a.flush()
  // mit den Abwesenheiten auch die Liste „abwesend“ ohne Grund (daten/abwesend.json)
  assert.deepEqual(saved.sort(), [DOC.absences, DOC.absent, DOC.master].sort())
  // B hat inzwischen selbst etwas geändert (ungespeichert)
  b.data.employees[0].name = 'Ana B'
  g.calls.length = 0
  const changed = await b.adoptSaved(saved)
  assert.equal(g.calls.length, 0, 'keine Anfrage an SharePoint')
  assert.deepEqual(changed.map((c) => c.path).sort(), [DOC.absences, DOC.absent, DOC.master].sort())
  assert.deepEqual(b.data.employees.map((e) => e.name), ['Ana B', 'Markus Neu'], 'zusammengeführt')
  assert.equal(b.data.absences.length, 1)
  await b.flush()
  const check = new DataService(make(), { debounceMs: 0 })
  await check.store.init()
  await check.load(seed)
  assert.deepEqual(check.data.employees.map((e) => e.name), ['Ana B', 'Markus Neu'])
})

test('Abgleich: Änderung wird gleich im Gerät gesichert (App vor dem Speichern geschlossen)', async () => {
  const { memoryCache } = await import('../src/storage/offline.js')
  const cache = memoryCache()
  const store = new LocalDocStore({ storage: memoryStorage() })
  const a = new DataService(store, { debounceMs: 5000, local: cache })
  await a.load(seed)
  a.data.employees[0].name = 'Ana geändert'
  a.schedule()
  await new Promise((r) => setTimeout(r, 400))
  const pending = await cache.all('pending')
  assert.ok(pending.some(([path, p]) => path === DOC.master && p.doc.employees[0].name === 'Ana geändert'))
  clearTimeout(a.timer)
  // „neu gestartet“: holt die Änderung nach
  const b = new DataService(store, { debounceMs: 0, local: cache })
  await b.load(seed)
  assert.equal(b.data.employees[0].name, 'Ana geändert')
  assert.equal(b.restored, 1)
})

test('DataService: Einkauf und Kassenbuch in eigenen Dateien unter einkauf/', async () => {
  // leere Inhalte wie in den Rechenkernen (in data-service.js ausgeschrieben, damit sie nicht in den Start wandern)
  assert.deepEqual(MODULE_DOCS.einkauf.empty(), emptyPurchase())
  assert.deepEqual(MODULE_DOCS.kasse.empty(), emptyCashbook())
  assert.deepEqual([MODULE_DOCS.einkauf.path, MODULE_DOCS.kasse.path], ['einkauf/einkauf.json', 'einkauf/kassenbuch.json'])
  const store = new LocalDocStore({ storage: memoryStorage() })
  const svc = new DataService(store, { debounceMs: 0 })
  const data = await svc.load(seed)
  assert.equal(await store.read(MODULE_DOCS.kasse.path), null, 'leeres Kassenbuch legt keine Datei an')
  data.einkauf = { ...emptyPurchase(), suppliers: [{ id: 's1', name: 'Lieferant Beispiel' }] }
  data.kasse = { ...emptyCashbook(), entries: [{ id: 'k1', no: 1, date: '2026-10-01', kind: 'einnahme', amount: 50, text: 'Anfangsbestand' }] }
  await svc.flush()
  assert.equal((await store.read(MODULE_DOCS.einkauf.path)).data.suppliers[0].name, 'Lieferant Beispiel')
  assert.equal((await store.read(MODULE_DOCS.kasse.path)).data.entries[0].amount, 50)
  assert.equal((await store.read(DOC.master)).data.kasse, undefined, 'nicht in den Stammdaten')
  // ein zweites Gerät bucht gleichzeitig: beide Einträge bleiben (Zusammenführen je id)
  const other = new DataService(store, { debounceMs: 0 })
  const d2 = await other.load(seed)
  data.kasse.entries.push({ id: 'k2', no: 2, date: '2026-10-02', kind: 'ausgabe', amount: 5, text: 'Porto' })
  d2.kasse.entries.push({ id: 'k3', no: 2, date: '2026-10-02', kind: 'ausgabe', amount: 7, text: 'Parken' })
  await svc.flush()
  await other.flush()
  assert.deepEqual((await store.read(MODULE_DOCS.kasse.path)).data.entries.map((e) => e.id).sort(), ['k1', 'k2', 'k3'])
})

test('SharePoint: Dateien eines Ordners mit eTag in einer Anfrage (Touren je Jahr), ohne Netz klare Meldung', async () => {
  const g = fakeGraph()
  const store = new SharePointDocStore({ getToken: async () => 'TOKEN', siteUrl: 'https://firma.sharepoint.com/sites/Dienstplan', fetchImpl: g.fetchImpl })
  await store.init()
  assert.deepEqual(await store.listFiles('matten/touren/2026'), [], 'Ordner fehlt noch')
  const e1 = await store.write('matten/touren/2026/mt000000000001.json', { id: 'mt000000000001' })
  const e2 = await store.write('matten/touren/2026/mt000000000002.json', { id: 'mt000000000002' })
  await store.write('matten/touren/2026/unter/x.json', { id: 'x' })
  g.calls.length = 0
  const list = await store.listFiles('matten/touren/2026')
  assert.deepEqual(list.map((x) => [x.path, x.etag]).sort(), [['matten/touren/2026/mt000000000001.json', e1], ['matten/touren/2026/mt000000000002.json', e2]], 'nur Dateien direkt im Ordner')
  assert.equal(g.calls.length, 1, 'eine Anfrage')
  assert.match(g.calls[0], /select=name,file,eTag/)
  const { CachedDocStore, memoryCache } = await import('../src/storage/offline.js')
  const cached = new CachedDocStore(store, memoryCache())
  assert.equal((await cached.listFiles('matten/touren/2026')).length, 2)
  store.listFiles = async () => {
    throw new TypeError('Failed to fetch')
  }
  await assert.rejects(cached.listFiles('matten/touren/2026'), (err) => err.offline === true)
  assert.equal(cached.offline, true)
})
