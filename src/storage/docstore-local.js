// Ablage im Browser (Demo, Test, Offline-Vorschau). Gleiche Schnittstelle wie
// die SharePoint-Ablage: read / write (mit eTag) / etagOf / upload.

export class ConflictError extends Error {
  constructor(path) {
    super(`Datei wurde zwischenzeitlich geändert: ${path}`)
    this.name = 'ConflictError'
    this.path = path
  }
}

function safeStorage(given) {
  try {
    // Schon der Zugriff auf localStorage kann werfen (gesperrte Website-Daten, eingebettete Vorschau)
    const storage = given ?? globalThis.localStorage
    const probe = '__einsatzplaner_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    const mem = new Map()
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), persistent: false }
  }
}

export class LocalDocStore {
  constructor({ prefix = 'einsatzplaner:doc:', storage, download } = {}) {
    this.kind = 'local'
    this.label = 'Dieser Browser'
    this.prefix = prefix
    this.storage = safeStorage(storage)
    this.persistent = this.storage.persistent !== false
    this.download = download
  }

  async init() {
    return { user: null }
  }

  #get(path) {
    const raw = this.storage.getItem(this.prefix + path)
    return raw ? JSON.parse(raw) : null
  }

  async read(path) {
    const doc = this.#get(path)
    return doc ? { data: doc.data, etag: doc.etag, modifiedBy: doc.modifiedBy || null, modifiedAt: doc.modifiedAt || null } : null
  }

  async etagOf(path) {
    return this.#get(path)?.etag ?? null
  }

  async write(path, data, etag) {
    const current = this.#get(path)
    if (current && etag !== undefined && etag !== null && current.etag !== etag) throw new ConflictError(path)
    if (current && (etag === undefined || etag === null)) throw new ConflictError(path)
    const next = String((Number(current?.etag) || 0) + 1)
    this.storage.setItem(this.prefix + path, JSON.stringify({ etag: next, data, modifiedAt: new Date().toISOString() }))
    return next
  }

  async remove(path) {
    this.storage.removeItem(this.prefix + path)
  }

  async upload(path, blob) {
    if (this.download) this.download(path.split('/').pop(), blob)
    return { webUrl: null, downloaded: true }
  }

  /** Daten anderer Werkzeuge gibt es nur in SharePoint. */
  async listTree() {
    return []
  }

  async readRoot() {
    return null
  }

  listDocs(prefix) {
    return this.list(prefix)
  }

  /** Dateien direkt in einem Ordner mit eTag (wie SharePoint): [{ path, etag, modified }]. */
  async listFiles(prefix) {
    const dir = `${String(prefix).replace(/^\/|\/$/g, '')}/`
    const out = []
    for (const path of await this.list(dir)) {
      if (path.slice(dir.length).includes('/')) continue
      const doc = this.#get(path)
      if (doc) out.push({ path, etag: doc.etag, modified: doc.modifiedAt || null })
    }
    return out
  }

  async list(prefix) {
    const out = []
    for (let i = 0; i < (this.storage.length || 0); i++) {
      const k = this.storage.key(i)
      if (k?.startsWith(this.prefix + prefix)) out.push(k.slice(this.prefix.length))
    }
    return out
  }
}
