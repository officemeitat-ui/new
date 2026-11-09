import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DataService, MODULE_DOCS } from '../src/storage/data-service.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { CachedDocStore, isNetworkError, memoryCache, OfflineError } from '../src/storage/offline.js'

function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => [...map.keys()][i], get length() { return map.size } }
}

/** „SharePoint“ zum Ab- und Einschalten des Netzes. */
function flakyRemote() {
  const inner = new LocalDocStore({ storage: memoryStorage() })
  const net = { online: true, uploads: [], attempts: 0 }
  const guard = (fn) => async (...args) => {
    if (!net.online) {
      net.attempts++
      throw new TypeError('Failed to fetch')
    }
    return fn(...args)
  }
  const remote = {
    kind: 'sharepoint',
    label: 'SharePoint · Test',
    driveId: null,
    init: guard(async () => {
      remote.driveId = 'drive1'
      return { site: 'Test' }
    }),
    read: guard((p) => inner.read(p)),
    etagOf: guard((p) => inner.etagOf(p)),
    write: guard((p, d, e) => inner.write(p, d, e)),
    upload: guard(async (path) => {
      net.uploads.push(path)
      return { webUrl: `https://sp/${path}` }
    }),
  }
  return { remote, inner, net }
}

const seed = () => ({ version: 1, employees: [{ id: 'e1', name: 'Ana' }], objects: [{ id: 'o1', name: 'Kanzlei' }], tasks: [], absences: [], assignments: {}, overrides: {}, logs: {}, published: {}, skills: [], rules: {} })

test('Offline: Netzfehler werden erkannt', () => {
  assert.ok(isNetworkError(new TypeError('Failed to fetch')))
  assert.ok(isNetworkError(new OfflineError()))
  assert.ok(isNetworkError({ message: 'x', errorCode: 'no_network_connectivity' }))
  assert.ok(!isNetworkError(Object.assign(new Error('Zugriff verweigert'), { status: 403 })))
})

test('Offline: erfassen ohne Netz, Neustart ohne Netz, später speichern und zusammenführen', async () => {
  const { remote, inner, net } = flakyRemote()
  const cache = memoryCache()
  // 1. mit Netz starten: Stand landet auch im Gerät
  const store = new CachedDocStore(remote, cache)
  await store.init()
  const svc = new DataService(store, { debounceMs: 0, local: cache })
  const data = await svc.load(seed)
  data.fahrzeuge = { vehicles: [{ id: 'v1', plate: 'S-1' }], workshops: [], changes: [], settings: {} }
  await svc.flush()
  assert.equal(svc.status, 'saved')

  // 2. Netz weg: Reifenwechsel erfassen, Speichern schlägt nicht fehl, Status „offline“
  net.online = false
  data.fahrzeuge.changes.push({ id: 'r1', vehicleId: 'v1', date: '2026-10-02', km: 130 })
  await svc.flush()
  assert.equal(svc.status, 'offline')
  assert.equal(svc.pendingCount(), 1)
  assert.equal((await cache.all('pending')).length, 1, 'Änderung liegt im Gerät')

  // 3. App ohne Netz neu starten: Stand aus dem Gerät, Eintrag wieder da
  const store2 = new CachedDocStore(remote, cache)
  assert.deepEqual(await store2.init(), { site: null, offline: true })
  const svc2 = new DataService(store2, { debounceMs: 0, local: cache })
  const data2 = await svc2.load(seed)
  assert.equal(data2.employees[0].name, 'Ana')
  assert.deepEqual(data2.fahrzeuge.changes.map((r) => r.km), [130])

  // 4. inzwischen hat jemand anderes einen anderen Eintrag gespeichert
  const other = (await inner.read(MODULE_DOCS.fahrzeuge.path)).data
  other.changes.push({ id: 'r2', vehicleId: 'v1', date: '2026-06-30', km: 100 })
  await inner.write(MODULE_DOCS.fahrzeuge.path, other, (await inner.read(MODULE_DOCS.fahrzeuge.path)).etag)

  // 5. Netz wieder da: refresh speichert nach und führt zusammen
  net.online = true
  await svc2.refresh()
  assert.equal(svc2.status, 'saved')
  const saved = (await inner.read(MODULE_DOCS.fahrzeuge.path)).data.changes.map((r) => r.id).sort()
  assert.deepEqual(saved, ['r1', 'r2'], 'beide Einträge erhalten')
  assert.equal((await cache.all('pending')).length, 0)
})

test('Offline: ohne jemals verbunden zu sein gibt es eine klare Meldung', async () => {
  const { remote, net } = flakyRemote()
  net.online = false
  await assert.rejects(new CachedDocStore(remote, memoryCache()).init(), /noch nie verbunden/)
})

test('Offline: Fotos warten im Gerät und werden später hochgeladen', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  const res = await store.upload('zaehler/fotos/2026/Q3/a.jpg', new Blob(['x']), 'image/jpeg')
  assert.deepEqual(res, { webUrl: null, queued: true })
  assert.equal(await store.queuedUploads(), 1)
  assert.equal(await store.flushUploads(), 1, 'ohne Netz bleibt es in der Warteschlange')
  net.online = true
  const done = []
  assert.equal(await store.flushUploads((path, url) => done.push([path, url])), 0)
  assert.deepEqual(done, [['zaehler/fotos/2026/Q3/a.jpg', 'https://sp/zaehler/fotos/2026/Q3/a.jpg']])
  assert.deepEqual(net.uploads, ['zaehler/fotos/2026/Q3/a.jpg'])
})

test('Offline: ein Foto mit echtem Fehler hält die anderen nicht auf', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  await store.upload('kontrolle/fotos/a.jpg', new Blob(['a']), 'image/jpeg')
  await store.upload('kontrolle/fotos/b.jpg', new Blob(['b']), 'image/jpeg')
  net.online = true
  const upload = remote.upload
  remote.upload = async (path, ...rest) => {
    if (path.endsWith('a.jpg')) throw Object.assign(new Error('Zugriff verweigert'), { status: 403 })
    return upload(path, ...rest)
  }
  const done = []
  assert.equal(await store.flushUploads((path) => done.push(path)), 1)
  assert.deepEqual(done, ['kontrolle/fotos/b.jpg'])
  assert.deepEqual(await store.failedUploads(), [{ path: 'kontrolle/fotos/a.jpg', error: 'Zugriff verweigert', tries: 1 }])
})

test('Offline: nie geöffnete Woche ist gesperrt und wird mit Netz nachgeladen', async () => {
  const { remote, inner, net } = flakyRemote()
  const cache = memoryCache()
  await inner.write('plaene/2026/2026-11-09.json', { assignments: { '2026-11-10|t1': ['e1'] }, overrides: {}, logs: {}, published: {} })
  const store = new CachedDocStore(remote, cache)
  await store.init()
  const events = []
  const svc = new DataService(store, { debounceMs: 0, local: cache, onRemoteChange: (kind) => events.push(kind) })
  const data = await svc.load(seed)
  net.online = false
  await svc.ensureWeeks(['2026-11-09'])
  assert.equal(svc.weekUnavailable('2026-11-09'), true)
  assert.equal(data.assignments['2026-11-10|t1'], undefined)
  net.online = true
  await svc.refresh()
  assert.equal(svc.weekUnavailable('2026-11-09'), false)
  assert.deepEqual(data.assignments['2026-11-10|t1'], ['e1'])
  assert.deepEqual(events, ['loaded'])
})

test('Offline: der Abgleich holt wartende Fotos aller Module nach (nicht nur im offenen Modul)', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  const service = new DataService(store, { debounceMs: 0 })
  await service.load(seed)
  net.online = false
  await store.upload('regie/nachweise/2026/a.jpg', new Blob(['x']), 'image/jpeg')
  await store.upload('anlagen/nachweise/2026/b.jpg', new Blob(['y']), 'image/jpeg')
  assert.equal(await store.queuedUploads(), 2)
  net.online = true
  const done = []
  const states = []
  service.onUploaded = (path) => done.push(path)
  service.onUploads = (state) => states.push(state)
  await service.refresh()
  // läuft im Hintergrund: auf das Ende warten
  for (let i = 0; i < 50 && (await store.queuedUploads()); i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(await store.queuedUploads(), 0)
  assert.deepEqual(done.sort(), ['anlagen/nachweise/2026/b.jpg', 'regie/nachweise/2026/a.jpg'])
  assert.deepEqual(net.uploads.sort(), ['anlagen/nachweise/2026/b.jpg', 'regie/nachweise/2026/a.jpg'])
  assert.deepEqual(states, [{ done: 2, left: 0, failed: [] }], 'Stand der Warteschlange für „Zu erledigen“ und Systemcheck')
  assert.equal(await service.flushQueuedUploads(), 0, 'nichts mehr da')
})

test('Offline: Nachholen läuft nie doppelt gleichzeitig (Abgleich und Fahreransicht rufen es beide auf)', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  await store.upload('matten/fotos/2026/p1/a.jpg', new Blob(['a']), 'image/jpeg')
  await store.upload('matten/fotos/2026/p1/b.jpg', new Blob(['b']), 'image/jpeg')
  net.online = true
  // langsames Hochladen, damit sich beide Aufrufe überschneiden
  const upload = remote.upload
  remote.upload = async (...args) => {
    await new Promise((r) => setTimeout(r, 5))
    return upload(...args)
  }
  const done = []
  const [a, b] = await Promise.all([store.flushUploads((p) => done.push(`1:${p}`)), store.flushUploads((p) => done.push(`2:${p}`))])
  assert.deepEqual([a, b], [0, 0])
  assert.deepEqual(net.uploads.sort(), ['matten/fotos/2026/p1/a.jpg', 'matten/fotos/2026/p1/b.jpg'], 'jede Datei genau einmal hochgeladen')
  assert.deepEqual(done.map((x) => x.slice(0, 2)), ['1:', '1:'], 'der zweite Aufruf hat gewartet; für ihn blieb nichts')
})

test('Offline: kennt kein Modul die Datei, bekommt sie der nächste Aufrufer noch einmal (Touren erst später geladen)', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  await store.upload('matten/fotos/2026/p1/a.jpg', new Blob(['a']), 'image/jpeg')
  net.online = true
  const first = []
  assert.equal(
    await store.flushUploads((path, url) => {
      first.push([path, url])
      return false // z. B. uploadDone: die Fahreransicht hat ihre Touren noch nicht geladen
    }),
    0,
  )
  assert.deepEqual(first, [['matten/fotos/2026/p1/a.jpg', 'https://sp/matten/fotos/2026/p1/a.jpg']])
  assert.deepEqual((await store.unclaimedUploads()).map((x) => x.path), ['matten/fotos/2026/p1/a.jpg'])
  assert.equal(await store.queuedUploads(), 0, 'hochgeladen ist sie')
  const second = []
  assert.equal(await store.flushUploads((path, url) => second.push([path, url])), 0)
  assert.deepEqual(second, first, 'noch einmal gemeldet, ohne neu hochzuladen')
  assert.deepEqual(net.uploads, ['matten/fotos/2026/p1/a.jpg'])
  assert.deepEqual(await store.unclaimedUploads(), [])
  const third = []
  await store.flushUploads((path) => third.push(path))
  assert.deepEqual(third, [], 'vermerkt: kein drittes Mal')
})

test('Offline: Datei mit echtem Fehler frühestens nach 10 Minuten wieder, „Erneut versuchen“ sofort', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  await store.upload('kontrolle/fotos/a.jpg', new Blob(['a']), 'image/jpeg')
  net.online = true
  const upload = remote.upload
  let denied = true
  remote.upload = async (...args) => {
    if (denied) throw Object.assign(new Error('Zugriff verweigert'), { status: 403 })
    return upload(...args)
  }
  const now = Date.parse('2026-11-09T10:00:00Z')
  assert.equal(await store.flushUploads(() => {}, { now }), 1)
  denied = false // das Büro hat das Recht freigegeben
  assert.equal(await store.flushUploads(() => {}, { now: now + 60e3 }), 1, 'eine Minute später: noch nicht wieder versucht (nicht bei jedem Abgleich)')
  assert.deepEqual(net.uploads, [])
  const done = []
  assert.equal(await store.flushUploads((p) => done.push(p), { now: now + 60e3, retryFailed: true }), 0)
  assert.deepEqual(done, ['kontrolle/fotos/a.jpg'])
  // und von selbst nach 10 Minuten
  net.online = false
  await store.upload('kontrolle/fotos/b.jpg', new Blob(['b']), 'image/jpeg')
  net.online = true
  denied = true
  assert.equal(await store.flushUploads(() => {}, { now }), 1)
  denied = false
  assert.equal(await store.flushUploads(() => {}, { now: now + 11 * 60e3 }), 0)
  assert.deepEqual(await store.failedUploads(), [])
})

test('Offline: ohne Netz wartet nach dem ersten Netzfehler der Rest ohne weitere Versuche', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  net.online = false
  for (const n of ['a', 'b', 'c']) await store.upload(`regie/nachweise/2026/${n}.jpg`, new Blob([n]), 'image/jpeg')
  net.attempts = 0
  assert.equal(await store.flushUploads(), 3)
  assert.equal(net.attempts, 1)
  assert.equal(store.offline, true)
  net.online = true
  assert.equal(await store.flushUploads(), 0)
  assert.equal(store.offline, false)
})

test('Offline: DataService mit Vermerk im Modul (onUploaded) und Stand (onUploads) aus den Optionen', async () => {
  const { remote, net } = flakyRemote()
  const store = new CachedDocStore(remote, memoryCache())
  await store.init()
  const marked = []
  const states = []
  const service = new DataService(store, { debounceMs: 0, onUploaded: (path, url) => (marked.push([path, url]), path.startsWith('regie/')), onUploads: (s) => states.push(s) })
  await service.load(seed)
  net.online = false
  await store.upload('regie/nachweise/2026/a.jpg', new Blob(['a']), 'image/jpeg')
  await store.upload('matten/fotos/2026/p1/b.jpg', new Blob(['b']), 'image/jpeg')
  net.online = true
  assert.equal(await service.flushQueuedUploads(), 0)
  assert.deepEqual(marked.map(([p]) => p).sort(), ['matten/fotos/2026/p1/b.jpg', 'regie/nachweise/2026/a.jpg'])
  assert.deepEqual(states, [{ done: 2, left: 0, failed: [] }])
  // das Matten-Foto kennt noch niemand: beim nächsten Nachholen noch einmal gemeldet
  assert.equal(await service.flushQueuedUploads(), 0)
  assert.deepEqual(marked.slice(2), [['matten/fotos/2026/p1/b.jpg', 'https://sp/matten/fotos/2026/p1/b.jpg']])
  assert.deepEqual(states.at(-1), { done: 1, left: 0, failed: [] })
})
