// Offline-Betrieb (z. B. im Keller ohne Netz): Der letzte Stand jeder Datei,
// noch nicht gespeicherte Änderungen und Fotos liegen im Gerät (IndexedDB).
// Die App startet und arbeitet weiter; sobald wieder Netz da ist, wird
// gespeichert und mit den Änderungen anderer zusammengeführt (merge.js).
//
// Speicher im Gerät:
//   docs     Pfad → { data, etag, modifiedAt }   letzter Stand aus SharePoint
//   pending  Pfad → { doc, base, etag }          noch nicht gespeicherte Änderungen
//   blobs    Pfad → { blob, type, at }           Fotos/Unterschriften zum Hochladen
//   meta     'init' → Laufwerk und Ordner (Start ohne Netz)

export class OfflineError extends Error {
  constructor(message = 'Keine Verbindung') {
    super(message)
    this.name = 'OfflineError'
    this.offline = true
  }
}

/** Netzfehler (kein Netz, DNS, Anmeldung ohne Netz) statt eines echten Fehlers? */
export const isNetworkError = (err) => !!err && (err.offline || err instanceof TypeError || /network|failed to fetch|load failed|no_network|timed_out|offline|ERR_INTERNET/i.test(`${err.message || ''} ${err.errorCode || ''}`))

const STORES = ['docs', 'pending', 'blobs', 'meta']

/** Gerätespeicher: IndexedDB im Browser, sonst (Tests) im Arbeitsspeicher. */
export function createOfflineCache(name = 'dienstplan-offline') {
  if (typeof indexedDB === 'undefined') return memoryCache()
  let dbPromise = null
  const db = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const run = async (store, mode, fn) => {
    const d = await db()
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  const safe = (fn, fallback) => (...args) => fn(...args).catch(() => fallback)
  return {
    get: safe((store, key) => run(store, 'readonly', (s) => s.get(key)), undefined),
    put: safe((store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)), undefined),
    del: safe((store, key) => run(store, 'readwrite', (s) => s.delete(key)), undefined),
    all: safe(async (store) => {
      const d = await db()
      return new Promise((resolve, reject) => {
        const out = []
        const req = d.transaction(store, 'readonly').objectStore(store).openCursor()
        req.onsuccess = () => {
          const cur = req.result
          if (!cur) return resolve(out)
          out.push([cur.key, cur.value])
          cur.continue()
        }
        req.onerror = () => reject(req.error)
      })
    }, []),
  }
}

export function memoryCache() {
  const maps = Object.fromEntries(STORES.map((s) => [s, new Map()]))
  return {
    get: async (store, key) => maps[store].get(key),
    put: async (store, key, value) => void maps[store].set(key, value),
    del: async (store, key) => void maps[store].delete(key),
    all: async (store) => [...maps[store].entries()],
  }
}

/**
 * Hülle um die SharePoint-Ablage: liest ohne Netz aus dem Gerät, meldet beim
 * Schreiben ohne Netz OfflineError (DataService hält die Änderung fest) und
 * stellt Fotos zum späteren Hochladen zurück.
 */
export class CachedDocStore {
  constructor(remote, cache = memoryCache()) {
    this.remote = remote
    this.cache = cache
    this.kind = remote.kind
    this.offline = false
  }

  get label() {
    return this.remote.label
  }

  get webUrl() {
    return this.remote.webUrl
  }

  #mark(offline) {
    this.offline = offline
  }

  async init() {
    try {
      const res = await this.remote.init()
      const { driveId, driveWebUrl, label, webUrl, folderOnly } = this.remote
      await this.cache.put('meta', 'init', { driveId, driveWebUrl, label, webUrl, folderOnly })
      this.#mark(false)
      return res
    } catch (err) {
      if (!isNetworkError(err)) throw err
      const meta = await this.cache.get('meta', 'init')
      if (!meta) throw new OfflineError('Keine Verbindung zu SharePoint, und dieses Gerät war noch nie verbunden.')
      Object.assign(this.remote, meta)
      this.#mark(true)
      return { site: null, offline: true }
    }
  }

  async read(path) {
    try {
      const doc = await this.remote.read(path)
      if (doc) await this.cache.put('docs', path, { data: doc.data, etag: doc.etag, modifiedAt: doc.modifiedAt || null })
      this.#mark(false)
      return doc
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.#mark(true)
      const cached = await this.cache.get('docs', path)
      if (cached) return { ...cached, modifiedBy: null, cached: true }
      throw new OfflineError(`Ohne Verbindung nicht verfügbar: ${path}`)
    }
  }

  async etagOf(path) {
    try {
      const etag = await this.remote.etagOf(path)
      this.#mark(false)
      return etag
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.#mark(true)
      return null
    }
  }

  async write(path, data, etag) {
    try {
      const next = await this.remote.write(path, data, etag)
      await this.cache.put('docs', path, { data, etag: next, modifiedAt: new Date().toISOString() })
      this.#mark(false)
      return next
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.#mark(true)
      throw new OfflineError()
    }
  }

  /** Hochladen; ohne Netz in die Warteschlange ({ queued: true }). */
  async upload(path, blob, contentType) {
    try {
      const res = await this.remote.upload(path, blob, contentType)
      this.#mark(false)
      return res
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.#mark(true)
      await this.cache.put('blobs', path, { blob, type: contentType, at: new Date().toISOString() })
      return { webUrl: null, queued: true }
    }
  }

  /** Wartende Fotos hochladen; onDone(path, webUrl) je Datei. Liefert die Anzahl noch wartender. */
  async flushUploads(onDone = () => {}) {
    const list = await this.cache.all('blobs')
    let left = 0
    for (const [path, { blob, type }] of list) {
      try {
        const { webUrl } = await this.remote.upload(path, blob, type)
        await this.cache.del('blobs', path)
        onDone(path, webUrl)
      } catch (err) {
        if (!isNetworkError(err)) throw err
        left++
      }
    }
    if (!left && list.length) this.#mark(false)
    return left
  }

  async queuedUploads() {
    return (await this.cache.all('blobs')).length
  }

  readBlob(path, opts) {
    return this.remote.readBlob(path, opts)
  }

  listTree(...args) {
    return this.remote.listTree(...args)
  }

  readRoot(path) {
    return this.remote.readRoot(path)
  }

  rootUrl(path) {
    return this.remote.rootUrl?.(path) ?? null
  }
}
