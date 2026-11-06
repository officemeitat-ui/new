// Touren des Mattenwechsels in SharePoint lesen und schreiben (je Tour eine Datei matten/touren/<Jahr>/<TourId>.json),
// auch ohne Netz (Keller, Tiefgarage): Änderungen liegen zuerst im Gerät (pending) und gehen dann mit eTag (If-Match)
// nach SharePoint. Hat jemand anders die Tour inzwischen geändert (Büro, zweites Gerät), wird je Stopp zusammengeführt
// (core/matten-fahrt.js → mergeTour). Ohne Netz bleibt die Änderung im Gerät und wird später nachgeholt; ein
// Neuladen der App verliert nichts. Fotos gehen über die Warteschlange der Ablage (offline.js: upload, flushUploads).
//
// Ablage: store = app.store (CachedDocStore mit SharePoint oder LocalDocStore im Browser-Modus).
// Gerät:  cache  = eigener Gerätespeicher (offline.js: createOfflineCache bzw. memoryCache):
//           pending  Pfad → { doc, base, etag, at, error? }   noch nicht gespeicherte Fassung (base = Stand in SharePoint)
//           meta     'liste' → [Pfad]                       zuletzt gelesene Liste der Tour-Dateien (Start ohne Netz)
//           docs     Pfad → { data, etag }                   Kopie für Ablagen ohne eigenen Gerätespeicher (Browser-Modus)

import { mergeTour } from '../core/matten-fahrt.js'
import { isNetworkError, memoryCache } from './offline.js'

export const TOUR_DIR = 'matten/touren'
export const isTourPath = (p) => /^matten\/touren\/\d{4}\/[A-Za-z0-9_-]+\.json$/.test(String(p || ''))
const clone = (x) => (x === undefined || x === null ? x : JSON.parse(JSON.stringify(x)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isConflict = (err) => err?.name === 'ConflictError' || err?.status === 412 || err?.status === 409

/** Jahre, deren Ordner gelesen werden: Vorjahr, dieses und nächstes (Touren im Dezember für Jänner). */
export const tourYears = (today) => {
  const y = Number(String(today || '').slice(0, 4)) || new Date().getFullYear()
  return [y - 1, y, y + 1]
}

export class TourStore {
  /**
   * store: Ablage (read, write mit eTag, listDocs, optional readMany, etagsOf, cached, upload, flushUploads).
   * cache: Gerätespeicher für Ungespeichertes (übersteht Neuladen und Neustart ohne Netz).
   * onChange(): nach jeder Änderung (neu zeichnen).
   */
  constructor({ store, cache = memoryCache(), onChange = () => {}, revalidateDays = 14 } = {}) {
    this.store = store
    this.cache = cache
    this.onChange = onChange
    this.revalidateDays = revalidateDays
    this.docs = new Map() // Pfad → { data, etag } (Stand in SharePoint)
    this.pending = new Map() // Pfad → { doc, base, etag, at, error? }
    this.loaded = false
    this.offline = false
    this.error = ''
    this.saving = null
    this.loading = null
  }

  /** Aktuelle Fassung je Tour (Ungespeichertes vor dem Stand in SharePoint). */
  tours() {
    const out = []
    for (const path of new Set([...this.docs.keys(), ...this.pending.keys()])) {
      const t = this.current(path)
      if (t) out.push(t)
    }
    return out
  }

  current(path) {
    return this.pending.get(path)?.doc || this.docs.get(path)?.data || null
  }

  pathOf(id) {
    for (const path of new Set([...this.docs.keys(), ...this.pending.keys()])) if (this.current(path)?.id === id) return path
    return null
  }

  byId(id) {
    const p = this.pathOf(id)
    return p ? this.current(p) : null
  }

  /** Pfade mit Änderungen, die noch nicht in SharePoint sind. */
  pendingPaths() {
    return [...this.pending.keys()]
  }

  isPending(id) {
    const p = this.pathOf(id)
    return !!p && this.pending.has(p)
  }

  /** Liste der Tour-Dateien; ohne Netz die zuletzt gelesene. null, wenn es keine gibt. */
  async #list(today) {
    // die Hülle für den Offline-Betrieb liefert ohne Netz eine leere Liste: dann direkt fragen, um es zu erkennen
    const src = this.store.remote?.listDocs ? this.store.remote : this.store
    if (!src.listDocs) return []
    try {
      const lists = await Promise.all(tourYears(today).map((y) => src.listDocs(`${TOUR_DIR}/${y}`)))
      const paths = [...new Set(lists.flat())].filter(isTourPath).sort()
      await this.cache.put('meta', 'liste', paths)
      return paths
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.offline = true
      return null
    }
  }

  /** Kopie im Gerät: Ablage mit eigenem Speicher (cached) bzw. der eigene (Browser-Modus). */
  async #cached(path) {
    if (this.store.cached) return this.store.cached(path)
    return (await this.cache.get('docs', path)) || null
  }

  /**
   * Touren laden (beim Öffnen und zum Abgleich): Liste aus SharePoint (ohne Netz die gemerkte), Kopien aus dem Gerät,
   * nur Geändertes neu lesen (eTags; alte abgeschlossene Touren bleiben aus dem Gerät), Ungespeichertes darüber legen
   * bzw. mit dem neueren Stand zusammenführen. Danach Ungespeichertes senden.
   */
  load({ today } = {}) {
    this.loading ||= this.#load(today).finally(() => (this.loading = null))
    return this.loading
  }

  async #load(today) {
    this.error = ''
    for (const [path, entry] of await this.cache.all('pending')) if (isTourPath(path) && !this.pending.has(path)) this.pending.set(path, entry)
    let paths = await this.#list(today)
    if (paths) this.offline = false
    else paths = (await this.cache.get('meta', 'liste')) || [...this.docs.keys()]
    paths = [...new Set([...paths, ...this.pending.keys()])]
    // Kopien aus dem Gerät
    for (const path of paths) {
      if (this.docs.has(path)) continue
      const c = await this.#cached(path)
      if (c?.data) this.docs.set(path, { data: c.data, etag: c.etag })
    }
    if (!this.offline) {
      const since = shiftDays(today, -this.revalidateDays)
      const recent = (p) => {
        const d = this.docs.get(p)?.data
        return !d || this.pending.has(p) || d.status !== 'abgeschlossen' || !since || String(d.date || '') >= since
      }
      const check = paths.filter(recent)
      let toRead = check
      if (this.store.etagsOf && check.some((p) => this.docs.has(p))) {
        try {
          const tags = await this.store.etagsOf(check)
          if (tags.size) toRead = check.filter((p) => !this.docs.has(p) || tags.get(p) === undefined || tags.get(p) !== this.docs.get(p).etag)
        } catch (err) {
          if (!isNetworkError(err)) throw err
        }
      }
      await this.#readAll(toRead)
    }
    // nicht mehr in SharePoint (gelöscht): ohne eigene Änderung weglassen
    for (const p of [...this.docs.keys()]) if (!paths.includes(p) && !this.pending.has(p)) this.docs.delete(p)
    this.loaded = true
    this.onChange()
    if (this.pending.size && !this.offline) await this.flush()
    return this.tours()
  }

  async #readAll(paths) {
    if (!paths.length) return
    let res
    try {
      res = this.store.readMany ? await this.store.readMany(paths) : new Map(await Promise.all(paths.map(async (p) => [p, await this.store.read(p).then((doc) => ({ doc }), (error) => ({ error }))])))
    } catch (err) {
      if (!isNetworkError(err)) throw err
      this.offline = true
      return
    }
    for (const path of paths) {
      const r = res.get(path)
      if (!r) continue
      if (r.error) {
        if (isNetworkError(r.error)) this.offline = true
        else this.error = `${path}: ${r.error.message || r.error}`
        continue
      }
      if (r.doc?.cached) this.offline = true
      if (!r.doc) {
        if (!this.pending.has(path)) this.docs.delete(path)
        continue
      }
      this.#adopt(path, r.doc.data, r.doc.etag)
    }
  }

  /** Neuer Stand aus SharePoint: übernehmen; eigene ungespeicherte Änderungen je Stopp darüber zusammenführen. */
  #adopt(path, data, etag) {
    this.docs.set(path, { data, etag })
    if (!this.store.cached) this.cache.put('docs', path, { data, etag })
    const p = this.pending.get(path)
    if (p && p.etag !== etag) {
      const merged = mergeTour(p.base, p.doc, data)
      const entry = { ...p, doc: merged, base: clone(data), etag }
      if (same(merged, data)) {
        this.pending.delete(path)
        this.cache.del('pending', path)
      } else {
        this.pending.set(path, entry)
        this.cache.put('pending', path, entry)
      }
    }
  }

  /**
   * Tour ändern: fn(Kopie) → neue Tour (oder dieselbe = nichts zu tun). Die Änderung liegt sofort im Gerät (übersteht
   * Neuladen ohne Netz) und wird dann gespeichert. Liefert die neue Tour. Fehler aus fn (z. B. Stopp fest) gehen durch.
   */
  async update(id, fn, { at = new Date().toISOString() } = {}) {
    const path = this.pathOf(id)
    if (!path) throw new Error('Tour nicht gefunden.')
    const cur = this.current(path)
    const next = fn(clone(cur))
    if (!next || same(next, cur)) return cur
    const known = this.docs.get(path)
    const entry = this.pending.get(path) || { base: clone(known?.data ?? null), etag: known?.etag ?? null }
    const saved = { ...entry, doc: clone(next), at }
    delete saved.error
    this.pending.set(path, saved)
    await this.cache.put('pending', path, saved)
    this.onChange()
    this.flush().catch(() => {})
    return next
  }

  /** Alles Ungespeicherte senden (eins nach dem anderen, Aufrufe der Reihe nach). Liefert die Zahl der noch wartenden. */
  flush() {
    const run = (this.saving || Promise.resolve()).catch(() => {}).then(() => this.#flush())
    this.saving = run
    run.finally(() => this.saving === run && (this.saving = null)).catch(() => {})
    return run
  }

  async #flush() {
    let changed = false
    for (const path of [...this.pending.keys()]) {
      const r = await this.#push(path)
      changed = true
      if (r === 'offline') break
    }
    if (changed) this.onChange()
    return this.pending.size
  }

  /** Eine Datei schreiben: mit eTag; bei Konflikt neu lesen, je Stopp zusammenführen, nochmals (höchstens 4×). */
  async #push(path) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const entry = this.pending.get(path)
      if (!entry) return 'saved'
      const doc = entry.doc
      try {
        const etag = await this.store.write(path, doc, entry.etag || null)
        this.offline = false
        this.docs.set(path, { data: clone(doc), etag })
        if (!this.store.cached) await this.cache.put('docs', path, { data: clone(doc), etag })
        const now = this.pending.get(path)
        if (now && now.doc !== doc) {
          // während des Speicherns weiter geändert: Rest bleibt mit dem neuen Stand als Basis
          const rest = { ...now, base: clone(doc), etag }
          this.pending.set(path, rest)
          await this.cache.put('pending', path, rest)
          continue
        }
        this.pending.delete(path)
        await this.cache.del('pending', path)
        return 'saved'
      } catch (err) {
        if (isNetworkError(err)) {
          this.offline = true
          return 'offline'
        }
        if (!isConflict(err)) {
          const failed = { ...entry, error: String(err?.message || err) }
          this.pending.set(path, failed)
          await this.cache.put('pending', path, failed)
          this.error = failed.error
          return 'error'
        }
        let theirs
        try {
          theirs = await this.store.read(path)
        } catch (e) {
          if (isNetworkError(e)) {
            this.offline = true
            return 'offline'
          }
          throw e
        }
        const now = this.pending.get(path) || entry
        if (!theirs) {
          // in SharePoint nicht mehr da: als neue Datei anlegen (nichts geht verloren)
          const again = { ...now, etag: null }
          this.pending.set(path, again)
          continue
        }
        const merged = mergeTour(now.base, now.doc, theirs.data)
        this.docs.set(path, { data: theirs.data, etag: theirs.etag })
        const next = { ...now, doc: merged, base: clone(theirs.data), etag: theirs.etag }
        this.pending.set(path, next)
        await this.cache.put('pending', path, next)
      }
    }
    return 'conflict'
  }

  /**
   * Wartende Fotos hochladen (Warteschlange der Ablage, nach dem Funkloch) und in den Touren vermerken:
   * mark(tour, [[Pfad, url]]) → Tour. Liefert die Zahl noch wartender Fotos.
   */
  async flushPhotos(mark) {
    if (!this.store.flushUploads) return 0
    const done = []
    const left = await this.store.flushUploads((path, url) => done.push([path, url]))
    if (done.length && mark) {
      for (const t of this.tours()) {
        const next = mark(t, done)
        if (next !== t) await this.update(t.id, () => next)
      }
    }
    return left
  }
}

function shiftDays(date, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return ''
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
}
