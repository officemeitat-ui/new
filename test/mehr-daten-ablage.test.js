import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyDoc, DataService, dataRights, DOC, folderRights, MODULE_DOCS, oldPathOf, splitData, weekPath } from '../src/storage/data-service.js'
import { ConflictError, LocalDocStore } from '../src/storage/docstore-local.js'
import { CachedDocStore, isNetworkError, memoryCache, OfflineError } from '../src/storage/offline.js'

function memoryStorage() {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => [...map.keys()][i], get length() { return map.size } }
}

/** Ablage, deren Lesen/Schreiben je Pfad ersetzt werden kann (LocalDocStore hat private Felder, daher kein Object.create). */
function wrap(inner, { read, write } = {}) {
  return {
    kind: 'local',
    read: (p) => (read ? read(p, () => inner.read(p)) : inner.read(p)),
    write: (p, d, e) => (write ? write(p, d, e, () => inner.write(p, d, e)) : inner.write(p, d, e)),
    etagOf: (p) => inner.etagOf(p),
    remove: (p) => inner.remove(p),
  }
}

/** „SharePoint“ zum Ab- und Einschalten des Netzes (wie in offline.test.js). */
function flakyRemote() {
  const inner = new LocalDocStore({ storage: memoryStorage() })
  const net = { online: true }
  const guard = (fn) => async (...args) => {
    if (!net.online) throw new TypeError('Failed to fetch')
    return fn(...args)
  }
  const remote = {
    kind: 'sharepoint',
    label: 'SharePoint · Test',
    init: guard(async () => ({ site: 'Test' })),
    read: guard((p) => inner.read(p)),
    etagOf: guard((p) => inner.etagOf(p)),
    write: guard((p, d, e) => inner.write(p, d, e)),
    remove: guard((p) => inner.remove(p)),
    listDocs: guard(async (prefix) => inner.list(prefix)),
  }
  return { remote, inner, net }
}

const seed = () => ({ version: 1, employees: [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bo' }], objects: [{ id: 'o1', name: 'Kanzlei Beispiel' }], tasks: [], absences: [], assignments: {}, overrides: {}, logs: {}, published: {}, skills: [], rules: {} })
const FAK = MODULE_DOCS.fakturierung.path
const invoiceDoc = (id, extra = {}) => ({ id, kind: 'rechnung', date: '2026-11-03', lines: [{ id: `${id}-1`, text: 'Reinigung', qty: 1, price: 100 }], ...extra })

// ---------------------------------------------------------------- Browser-Ablage

test('Browser-Ablage: neue Datei ohne eTag, Überschreiben nur mit dem aktuellen eTag', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  assert.equal(await store.read('x/a.json'), null)
  assert.equal(await store.etagOf('x/a.json'), null)
  assert.equal(await store.write('x/a.json', { v: 1 }, null), '1')
  await assert.rejects(store.write('x/a.json', { v: 2 }), (err) => err instanceof ConflictError && err.name === 'ConflictError' && err.path === 'x/a.json' && /zwischenzeitlich geändert: x\/a\.json/.test(err.message))
  await assert.rejects(store.write('x/a.json', { v: 2 }, '7'), ConflictError)
  assert.equal(await store.write('x/a.json', { v: 2 }, '1'), '2')
  const doc = await store.read('x/a.json')
  assert.deepEqual([doc.data, doc.etag, doc.modifiedBy], [{ v: 2 }, '2', null])
  assert.match(doc.modifiedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('Browser-Ablage: Liste nach Ordner, Löschen, keine Werkzeug-Dateien, Hochladen als Download', async () => {
  let downloaded = null
  const store = new LocalDocStore({ storage: memoryStorage(), download: (name) => (downloaded = name) })
  await store.write('plaene/2026/2026-11-02.json', {}, null)
  await store.write('plaene/2026/2026-11-09.json', {}, null)
  await store.write('daten/stammdaten.json', {}, null)
  assert.deepEqual((await store.listDocs('plaene/')).sort(), ['plaene/2026/2026-11-02.json', 'plaene/2026/2026-11-09.json'])
  await store.remove('plaene/2026/2026-11-02.json')
  assert.deepEqual(await store.list('plaene/'), ['plaene/2026/2026-11-09.json'])
  assert.deepEqual([await store.listTree(), await store.readRoot('x')], [[], null])
  assert.deepEqual(await store.upload('exporte/2026/KW45/Wochenplan.pdf', 'x'), { webUrl: null, downloaded: true })
  assert.equal(downloaded, 'Wochenplan.pdf')
})

test('Browser-Ablage: gesperrter Speicher (Website-Daten blockiert) fällt auf Arbeitsspeicher zurück', async () => {
  const blocked = { setItem() { throw new Error('SecurityError') }, getItem() { throw new Error('SecurityError') }, removeItem() {} }
  const store = new LocalDocStore({ storage: blocked })
  assert.equal(store.persistent, false)
  await store.write('a.json', { v: 1 }, null)
  assert.deepEqual((await store.read('a.json')).data, { v: 1 })
  assert.equal(new LocalDocStore({ storage: memoryStorage() }).persistent, true)
})

// ---------------------------------------------------------------- Gerätespeicher und Netz

for (const [label, err, expected] of [
  ['TypeError von fetch', new TypeError('Failed to fetch'), true],
  ['Safari „Load failed“', new Error('Load failed'), true],
  ['Firefox NetworkError', new Error('NetworkError when attempting to fetch resource.'), true],
  ['MSAL timed_out', { message: '', errorCode: 'timed_out' }, true],
  ['OfflineError', new OfflineError(), true],
  ['403 Zugriff verweigert', Object.assign(new Error('Zugriff verweigert'), { status: 403 }), false],
  ['404 Not Found', new Error('Not Found'), false],
  ['kein Fehler', null, false],
]) {
  test(`Offline: Netzfehler erkannt? ${label} → ${expected}`, () => {
    assert.equal(isNetworkError(err), expected)
  })
}

test('Gerätespeicher im Arbeitsspeicher: Bereiche getrennt, Leeren betrifft nur einen Bereich', async () => {
  const c = memoryCache()
  await c.put('pending', 'a', { n: 1 })
  await c.put('docs', 'a', { n: 2 })
  assert.deepEqual(await c.get('pending', 'a'), { n: 1 })
  await c.clear('pending')
  assert.deepEqual([await c.all('pending'), await c.all('docs')], [[], [['a', { n: 2 }]]])
  await c.del('docs', 'a')
  assert.equal(await c.get('docs', 'a'), undefined)
})

test('SharePoint-Hülle ohne Netz: Kopie aus dem Gerät, sonst OfflineError mit Pfad', async () => {
  const { remote, inner, net } = flakyRemote()
  await inner.write('a.json', { v: 1 }, null)
  const store = new CachedDocStore(remote, memoryCache())
  await store.read('a.json')
  net.online = false
  const cached = await store.read('a.json')
  assert.deepEqual([cached.data, cached.cached, cached.modifiedBy, store.offline], [{ v: 1 }, true, null, true])
  await assert.rejects(store.read('nie-gelesen.json'), (err) => err instanceof OfflineError && /nie-gelesen\.json/.test(err.message))
  await assert.rejects(store.write('a.json', { v: 2 }, cached.etag), OfflineError)
  assert.deepEqual(await store.etagsOf(['a.json']), new Map(), 'ohne Netz nichts zu aktualisieren')
  assert.deepEqual(await store.listDocs('plaene/'), [])
  net.online = true
  assert.equal(await store.write('a.json', { v: 2 }, cached.etag), '2')
  assert.equal(store.offline, false)
  assert.deepEqual((await store.cached('a.json')).data, { v: 2 }, 'Kopie im Gerät nachgezogen')
})

test('SharePoint-Hülle: in SharePoint gelöschte Datei verschwindet auch aus dem Gerät, Entfernen ebenso', async () => {
  const { remote, inner } = flakyRemote()
  const cache = memoryCache()
  const store = new CachedDocStore(remote, cache)
  await inner.write('a.json', { v: 1 }, null)
  await inner.write('b.json', { v: 1 }, null)
  await store.read('a.json')
  await store.read('b.json')
  await inner.remove('a.json')
  assert.equal(await store.read('a.json'), null)
  assert.equal(await store.cached('a.json'), null)
  await store.remove('b.json')
  assert.equal(await cache.get('docs', 'b.json'), undefined)
})

test('SharePoint-Hülle: gebündelt lesen ohne Netz liefert Kopien bzw. Fehler je Datei, eTags ohne Bündel-Funktion', async () => {
  const { remote, inner, net } = flakyRemote()
  await inner.write('a.json', { v: 1 }, null)
  const store = new CachedDocStore(remote, memoryCache())
  const online = await store.readMany(['a.json', 'fehlt.json'])
  assert.deepEqual([online.get('a.json').doc.data, online.get('fehlt.json').doc], [{ v: 1 }, null])
  assert.deepEqual(await store.etagsOf(['a.json', 'fehlt.json']), new Map([['a.json', '1'], ['fehlt.json', null]]))
  net.online = false
  const off = await store.readMany(['a.json', 'neu.json'])
  assert.equal(off.get('a.json').doc.cached, true)
  assert.ok(off.get('neu.json').error instanceof OfflineError)
  assert.equal(store.offline, true)
})

test('SharePoint-Hülle: echter Fehler beim Auflisten wird weitergegeben, nicht als „offline“ verschluckt', async () => {
  const { remote } = flakyRemote()
  remote.listDocs = async () => {
    throw Object.assign(new Error('Zugriff verweigert'), { status: 403 })
  }
  await assert.rejects(new CachedDocStore(remote, memoryCache()).listDocs('daten/plaene/'), /Zugriff verweigert/)
})

// ---------------------------------------------------------------- Aufteilung in Dateien

test('Aufteilung: Löhne ins Zeitkonto, Löhne unbekannter Personen bleiben, Wochen-Felder in die Woche', () => {
  const data = {
    ...seed(),
    employees: [{ id: 'e1', name: 'Ana', hourlyWage: 15, wageGroup: '2' }],
    payOther: { e9: { hourlyWage: 13 }, e1: { hourlyWage: 99 } },
    stamps: { '2026-11-03|zabc': { empId: 'e1' }, '2026-11-10|zdef': { empId: 'e1' } },
    winter: { '2026-11-04|o1': { reason: 'Schnee' } },
    payroll: { '2026-10': { closedAt: '2026-11-02' } },
    payrollExport: { format: 'bmd' },
  }
  const docs = splitData(data, new Set(['2026-11-02']))
  assert.deepEqual(docs[DOC.master].employees, [{ id: 'e1', name: 'Ana' }])
  assert.deepEqual(docs[DOC.account].pay, { e9: { hourlyWage: 13 }, e1: { hourlyWage: 15, wageGroup: '2' } }, 'Lohn der bekannten Person aus den Stammdaten')
  assert.deepEqual([docs[DOC.account].payroll, docs[DOC.account].export], [data.payroll, { format: 'bmd' }])
  assert.deepEqual(docs[weekPath('2026-11-02')].stamps, { '2026-11-03|zabc': { empId: 'e1' } })
  assert.deepEqual(docs[weekPath('2026-11-02')].winter, { '2026-11-04|o1': { reason: 'Schnee' } })
  assert.equal(docs[weekPath('2026-11-09')], undefined, 'nicht geladene Woche wird nicht erzeugt')
  assert.deepEqual(docs[FAK], { settings: {}, customers: [], articles: [], documents: [], recurring: [], indexValues: {}, textBlocks: [], paymentTerms: [] })
})

test('Woche übernehmen: nur deren Einträge ersetzt, Protokoll gesetzt, andere Wochen bleiben', () => {
  const data = { assignments: { '2026-11-03|t1': ['x'], '2026-11-10|t1': ['y'] }, stamps: { '2026-11-04|zold': {} }, logs: { '2026-11-09': [{ text: 'alt' }] } }
  applyDoc(data, weekPath('2026-11-02'), { monday: '2026-11-02', assignments: { '2026-11-04|t2': ['z'] }, log: [{ text: 'neu' }] })
  assert.deepEqual(data.assignments, { '2026-11-10|t1': ['y'], '2026-11-04|t2': ['z'] })
  assert.deepEqual(data.stamps, {}, 'Stempelungen der Woche ersetzt (hier: keine mehr)')
  assert.deepEqual(data.logs, { '2026-11-09': [{ text: 'alt' }], '2026-11-02': [{ text: 'neu' }] })
})

test('Datei übernehmen: Fakturierung mit Vorgaben ergänzt, Zeitkonto mit „pay“ ersetzt Löhne, ohne „pay“ bleiben sie', () => {
  const data = { employees: [{ id: 'e1', name: 'Ana', hourlyWage: 14 }, { id: 'e2', name: 'Bo', hourlyWage: 12 }] }
  applyDoc(data, FAK, { documents: [{ id: 'r1' }] })
  assert.deepEqual(Object.keys(data.fakturierung).sort(), ['articles', 'customers', 'documents', 'indexValues', 'paymentTerms', 'recurring', 'settings', 'textBlocks'])
  applyDoc(data, DOC.account, { weeks: {} })
  assert.deepEqual(data.employees.map((e) => e.hourlyWage), [14, 12], 'ältere Datei ohne pay')
  applyDoc(data, DOC.account, { weeks: { '2026-11-02': { status: 'veroeffentlicht' } }, pay: { e1: { hourlyWage: 15 }, e7: { hourlyWage: 11 } } })
  assert.deepEqual(data.employees.map((e) => e.hourlyWage), [15, undefined], 'gelöschter Lohn kommt an')
  assert.deepEqual(data.payOther, { e7: { hourlyWage: 11 } })
  assert.equal(data.payroll, undefined)
  assert.deepEqual(Object.keys(data.published), ['2026-11-02'])
})

test('Stammdaten übernehmen: Löhne bleiben, Objekte aus alten Stammdaten nur ohne eigene Objektdatei', () => {
  const data = { employees: [{ id: 'e1', name: 'Ana', hourlyWage: 14 }], payOther: { e2: { hourlyWage: 12 } }, objects: [{ id: 'o1' }] }
  applyDoc(data, DOC.master, { employees: [{ id: 'e1', name: 'Ana P.' }, { id: 'e2', name: 'Bo' }], objects: [{ id: 'alt' }] })
  assert.deepEqual(data.employees, [{ hourlyWage: 14, id: 'e1', name: 'Ana P.' }, { hourlyWage: 12, id: 'e2', name: 'Bo' }])
  assert.deepEqual(data.payOther, {})
  assert.deepEqual(data.objects, [{ id: 'o1' }])
  const empty = { objects: [] }
  applyDoc(empty, DOC.master, { objects: [{ id: 'alt' }] })
  assert.deepEqual(empty.objects, [{ id: 'alt' }])
})

test('Rechte: Buchhaltung sieht Fakturierung und Objekte, aber weder Stammdaten noch Pläne noch Kalkulation', () => {
  const access = { all: false, sees: (m) => m === 'fakturierung', canEdit: (m) => m === 'fakturierung' }
  const r = dataRights(access)
  assert.deepEqual([r.read(FAK), r.write(FAK), r.read(DOC.objects), r.write(DOC.objects), r.read(DOC.master), r.read(weekPath('2026-11-02')), r.read(MODULE_DOCS.kalkulation.path), r.write(MODULE_DOCS.assistenz.path)], [true, true, true, false, false, false, false, true])
  const folders = Object.fromEntries(folderRights(access).map(([f, , right]) => [f, right]))
  assert.deepEqual([folders.fakturierung, folders.objekte, folders.daten, folders.lohn, folders.exporte], ['Bearbeiten', 'Lesen', '', '', ''])
  const all = dataRights(null)
  assert.ok(all.read('irgendwas.json') && all.write('irgendwas.json'))
  assert.equal(dataRights(access).read('unbekannt/datei.json'), false)
})

test('Pfade: Woche im Jahresordner, frühere Ablage unter daten/', () => {
  assert.equal(weekPath('2026-12-28'), 'plaene/2026/2026-12-28.json')
  assert.equal(oldPathOf(DOC.absences), 'daten/abwesenheiten.json')
  assert.equal(oldPathOf(DOC.account), 'daten/zeitkonto.json')
  assert.equal(oldPathOf(weekPath('2026-11-02')), 'daten/plaene/2026/2026-11-02.json')
  assert.equal(oldPathOf(DOC.master), null)
})

// ---------------------------------------------------------------- DataService

test('DataService: kaputte Fakturierungs-Datei sperrt nur diesen Bereich, der Rest wird gespeichert', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const broken = wrap(store, { read: (p, next) => (p === FAK ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : next()) })
  const svc = new DataService(broken, { debounceMs: 0 })
  const data = await svc.load(seed)
  assert.deepEqual([svc.broken.has(FAK), svc.denied.has(FAK), svc.writable(FAK)], [true, true, false])
  data.fakturierung = { documents: [invoiceDoc('r1')] }
  data.employees[0].name = 'Ana geändert'
  await svc.flush()
  assert.equal(await store.read(FAK), null, 'kaputte Datei wird nicht überschrieben')
  assert.equal((await store.read(DOC.master)).data.employees[0].name, 'Ana geändert')
})

test('DataService: kaputte Stammdaten und fehlendes Netz ohne Stand im Gerät geben klare Meldungen', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const broken = wrap(store, { read: (p, next) => (p === DOC.master ? Promise.reject(new SyntaxError('x')) : next()) })
  await assert.rejects(new DataService(broken).load(seed), /daten\/stammdaten\.json ist beschädigt/)
  const offline = wrap(store, { read: () => Promise.reject(new TypeError('Failed to fetch')) })
  await assert.rejects(new DataService(offline).load(seed), (err) => err.offline === true && /Bitte einmal mit Netz öffnen/.test(err.message))
})

test('DataService: eine Datei scheitert beim Speichern, die anderen werden trotzdem gespeichert', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const statuses = []
  const full = wrap(store, { write: (p, d, e, next) => (p === DOC.absences ? Promise.reject(Object.assign(new Error('Speicher voll'), { status: 507 })) : next()) })
  const svc = new DataService(full, { debounceMs: 0, onStatus: (s, detail) => statuses.push([s, detail]) })
  const data = await svc.load(seed)
  data.absences.push({ id: 'a1', employeeId: 'e1', type: 'Urlaub', from: '2026-11-02', to: '2026-11-03' })
  data.employees[1].name = 'Bo Beispiel'
  await assert.rejects(svc.flush(), /Speicher voll/)
  assert.deepEqual(statuses.at(-1), ['error', 'Speicher voll'])
  assert.deepEqual([...svc.failed], [[DOC.absences, 'Speicher voll']])
  assert.equal((await store.read(DOC.master)).data.employees[1].name, 'Bo Beispiel')
  assert.equal(svc.pendingCount(), 1, 'Abwesenheit bleibt ungespeichert')
})

test('DataService: zwei Personen schreiben gleichzeitig Rechnungen – beide bleiben, Felder je Rechnung zusammengeführt', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  const first = new DataService(store, { debounceMs: 0 })
  const d0 = await first.load(seed)
  d0.fakturierung = { ...MODULE_DOCS.fakturierung.empty(), documents: [invoiceDoc('r1')] }
  await first.flush()
  const a = new DataService(store, { debounceMs: 0 })
  const b = new DataService(store, { debounceMs: 0 })
  const da = await a.load(seed)
  const db = await b.load(seed)
  da.fakturierung.documents.push(invoiceDoc('r2'))
  da.fakturierung.documents[0].title = 'Oktober'
  db.fakturierung.documents.push(invoiceDoc('r3'))
  db.fakturierung.documents[0].dueDate = '2026-11-17'
  await a.flush()
  let kind = null
  b.onRemoteChange = (k) => (kind = k)
  await b.flush()
  assert.equal(kind, 'merged')
  const saved = (await store.read(FAK)).data.documents
  assert.deepEqual(saved.map((d) => d.id).sort(), ['r1', 'r2', 'r3'])
  assert.deepEqual([saved[0].title, saved[0].dueDate], ['Oktober', '2026-11-17'])
  assert.deepEqual(db.fakturierung.documents.map((d) => d.id).sort(), ['r1', 'r2', 'r3'], 'auch im Fenster von B')
  assert.equal(b.status, 'saved')
})

test('DataService: Konflikt auch nach dem Zusammenführen ergibt einen Fehler statt einer Endlosschleife', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  let tries = 0
  const busy = wrap(store, { write: (p, d, e, next) => (p === DOC.absences ? (tries++, Promise.reject(new ConflictError(p))) : next()) })
  const svc = new DataService(busy, { debounceMs: 0 })
  const data = await svc.load(seed)
  data.absences.push({ id: 'a1', employeeId: 'e1', type: 'Urlaub', from: '2026-11-02', to: '2026-11-03' })
  await assert.rejects(svc.flush(), ConflictError)
  assert.equal(tries, 2, 'ein zweiter Versuch nach dem Zusammenführen, dann Schluss')
  assert.equal(svc.status, 'error')
  assert.ok(svc.failed.has(DOC.absences))
})

test('DataService: Ungespeichertes im Gerät – ohne Schreibrecht bleibt es liegen, mit Recht wird es übernommen und danach entfernt', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const cache = memoryCache()
  const pending = { doc: { absences: [{ id: 'k1', employeeId: 'e2', type: 'Krankenstand', from: '2026-11-04', to: '2026-11-06' }] }, base: { absences: [] }, etag: null, at: '2026-11-04T06:00:00Z', owner: 'anderes-fenster' }
  await cache.put('pending', DOC.absences, pending)
  const reader = new DataService(store, { local: cache, rights: { read: () => true, write: (p) => p !== DOC.absences } })
  const r = await reader.load(seed)
  assert.deepEqual([reader.restored, r.absences.length], [0, 0])
  assert.ok(await cache.get('pending', DOC.absences), 'bleibt für das richtige Konto im Gerät')
  const planner = new DataService(store, { debounceMs: 0, local: cache })
  const p = await planner.load(seed)
  assert.deepEqual([planner.restored, p.absences.map((x) => x.id)], [1, ['k1']])
  await planner.flush()
  assert.deepEqual((await store.read(DOC.absences)).data.absences.map((x) => x.id), ['k1'])
  assert.equal(await cache.get('pending', DOC.absences), undefined)
})

test('DataService: ohne Netz meldet der Status die Zahl der ungespeicherten Dateien, im Gerät mit Kennung des Fensters', async () => {
  const { remote, net } = flakyRemote()
  const cache = memoryCache()
  const store = new CachedDocStore(remote, cache)
  await store.init()
  const statuses = []
  const svc = new DataService(store, { debounceMs: 0, local: cache, session: 'fenster-1', onStatus: (s, d) => statuses.push([s, d]) })
  const data = await svc.load(seed)
  net.online = false
  data.employees[0].name = 'Ana offline'
  data.fakturierung = { ...MODULE_DOCS.fakturierung.empty(), documents: [invoiceDoc('r1')] }
  await svc.flush()
  assert.deepEqual(statuses.at(-1), ['offline', '2'])
  const entries = await cache.all('pending')
  assert.deepEqual(entries.map(([path]) => path).sort(), [DOC.master, FAK].sort())
  assert.ok(entries.every(([, e]) => e.owner === 'fenster-1'))
})

test('DataService: anderes Fenster mit Browser-Ablage gleicht über refresh ab; nicht geladene Wochen werden ignoriert', async () => {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store).load(seed)
  const a = new DataService(store, { debounceMs: 0 })
  const b = new DataService(store, { debounceMs: 0 })
  await a.load(seed)
  const db = await b.load(seed)
  a.data.employees[1].name = 'Bo aus Fenster A'
  await a.flush()
  const changed = await b.adoptSaved([DOC.master])
  assert.deepEqual(changed.map((c) => c.path), [DOC.master])
  assert.equal(db.employees[1].name, 'Bo aus Fenster A')
  const { remote } = flakyRemote()
  const cache = memoryCache()
  const c = new DataService(new CachedDocStore(remote, cache), { debounceMs: 0, local: cache })
  await c.load(seed)
  assert.deepEqual(await c.adoptSaved([weekPath('2030-01-07')]), [])
  assert.deepEqual(await new DataService(store).adoptSaved([DOC.master]), [], 'vor dem Laden nichts')
})

test('DataService: vor dem Laden nichts ungespeichert, nie angefragte Woche gilt nicht als gesperrt', async () => {
  const svc = new DataService(new LocalDocStore({ storage: memoryStorage() }))
  assert.equal(svc.pendingCount(), 0)
  assert.equal(svc.weekUnavailable('2026-11-02'), false)
  const ro = new DataService(new LocalDocStore({ storage: memoryStorage() }), { rights: { read: () => true, write: (p) => p !== FAK } })
  assert.equal(ro.writable(FAK), false)
  assert.equal(ro.writable(DOC.master), true)
})
