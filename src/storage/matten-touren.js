// Touren des Mattenwechsels lesen und schreiben – eine Ablage für das Büro (Tourenplanung, views/matten-planung.js) und
// die Fahrer (Matten-Touren, views/matten-fahrer.js). Je Tour eine Datei matten/touren/<Jahr>/<TourId>.json; Touren
// gehen nicht über den DataService (die Liste wächst je Jahr).
//
// Lesen: Ordner eines Jahres mit eTag auflisten (listFiles: eine Anfrage; sonst listDocs + etagsOf), nur neue oder
// geänderte Dateien lesen (Kopie im Gerät bzw. hier gemerkt), gelöschte fallen weg. Ohne Netz gilt die zuletzt gelesene
// Liste mit den Kopien im Gerät.
// Schreiben: jede Änderung liegt zuerst im Gerät (pending, übersteht Neuladen und Neustart ohne Netz) und geht dann mit
// eTag (If-Match) in die Ablage, der Reihe nach. Hat jemand anders die Tour inzwischen geändert (Büro, Fahrer, zweites
// Gerät), wird an genau einer Stelle zusammengeführt: this.merge = mergeTour aus core/matten-fahrt.js (je Stopp).
// Büro-Regel: Änderungen des Büros (save) schreiben nie in eine Tour, die inzwischen unterwegs oder abgeschlossen ist
// (TourLockedError); die Fahrer ändern über update.
// Fotos gehen über die Warteschlange der Ablage (offline.js: upload, flushUploads).
//
// Ablage: store = app.store (CachedDocStore mit SharePoint oder LocalDocStore im Browser-Modus).
// Gerät:  cache  = eigener Gerätespeicher (offline.js: createOfflineCache bzw. memoryCache):
//           pending  Pfad → { doc, base, etag, at, office?, error? }   noch nicht gespeicherte Fassung (base = Stand der Ablage)
//           meta     'liste:<Jahr>' → [Pfad]                         zuletzt gelesene Liste je Jahr (Start ohne Netz)
//           docs     Pfad → { data, etag }                           Kopie für Ablagen ohne eigenen Gerätespeicher

import { mergeTour } from '../core/matten-fahrt.js'
import { isTourPath, lockedForOffice, pathOfTour, TOUR_DIR, TourLockedError, tourDir, yearOfPath } from '../core/matten-touren.js'
import { isNetworkError, memoryCache, OfflineError } from './offline.js'

export { isTourPath, TOUR_DIR }

const clone = (x) => (x === undefined || x === null ? x : JSON.parse(JSON.stringify(x)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isConflict = (err) => err?.name === 'ConflictError' || err?.status === 412 || err?.status === 409

/** Jahre um einen Tag: Vorjahr, dieses und nächstes (Touren im Dezember für Jänner) – Vorgabe für load({ today }). */
export const yearsAround = (today) => {
  const y = Number(String(today || '').slice(0, 4)) || new Date().getFullYear()
  return [y - 1, y, y + 1]
}

/** Map, die jede Änderung zählt: daran erkennt pathOf, ob ihr Verzeichnis Tour → Pfad noch stimmt. */
class CountingMap extends Map {
  changes = 0
  set(key, value) {
    this.changes++
    return super.set(key, value)
  }
  delete(key) {
    this.changes++
    return super.delete(key)
  }
  clear() {
    this.changes++
    return super.clear()
  }
}

export class TourStore {
  #ids = null // Tour-ID → Pfad, gültig für den Stand { docs, pending } (pathOf)
  /**
   * store: Ablage (read, write mit eTag, remove, listFiles bzw. listDocs, optional readMany, etagsOf, cached, upload,
   * flushUploads). cache: Gerätespeicher für Ungespeichertes. onChange(): nach jeder Änderung (neu zeichnen).
   * merge(base, mine, theirs): Zusammenführen bei Konflikt (Vorgabe mergeTour). canWrite(path): darf die Rolle schreiben?
   */
  constructor({ store, cache = memoryCache(), onChange = () => {}, merge = mergeTour, canWrite = () => true, now = () => Date.now() } = {}) {
    this.store = store
    this.cache = cache
    this.onChange = onChange
    this.merge = merge
    this.canWrite = canWrite
    this.now = now
    this.docs = new CountingMap() // Pfad → { data, etag } (Stand der Ablage)
    this.pending = new CountingMap() // Pfad → { doc, base, etag, at, office?, error? }
    this.years = new Map() // Jahr → { at } (Ordner gelesen)
    this.yearLoads = new Map() // Jahr → laufendes Laden
    this.restored = false
    this.loaded = false
    this.offline = false
    this.error = ''
    this.saving = null
    this.loading = null
  }

  // ------------------------------------------------ Stand

  /** Aktuelle Fassung je Tour (Ungespeichertes vor dem Stand der Ablage). */
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
    // erster Pfad (Stand der Ablage, dann nur Ungespeichertes) mit dieser ID; das Verzeichnis gilt, bis sich eine der beiden
    // Listen ändert (Kalender und Planung fragen je Einsatz „in Tour“: sonst jedes Mal durch alle Touren)
    const at = `${this.docs.changes}|${this.pending.changes}`
    if (this.#ids?.at !== at) {
      const map = new Map()
      for (const path of new Set([...this.docs.keys(), ...this.pending.keys()])) {
        const tid = this.current(path)?.id
        if (tid === tid && !map.has(tid)) map.set(tid, path) // tid !== tid: NaN, gleicht keiner ID
      }
      this.#ids = { at, map }
    }
    return this.#ids.map.has(id) ? this.#ids.map.get(id) : ''
  }

  byId(id) {
    const p = this.pathOf(id)
    return p ? this.current(p) : null
  }

  /** Pfade mit Änderungen, die noch nicht in der Ablage sind. */
  pendingPaths() {
    return [...this.pending.keys()]
  }

  isPending(id) {
    const p = this.pathOf(id)
    return !!p && this.pending.has(p)
  }

  /** Ordner des Jahres gelesen (und nicht älter als maxAge ms)? */
  yearLoaded(year, maxAge = Infinity) {
    const y = this.years.get(String(year))
    return !!y && this.now() - y.at <= maxAge
  }

  /** Wird der Ordner des Jahres gerade gelesen? */
  yearLoading(year) {
    return this.yearLoads.has(String(year))
  }

  // ------------------------------------------------ Lesen

  /**
   * Touren laden (beim Öffnen und zum Abgleich): years (Vorgabe: yearsAround(today)) je Ordner mit eTag auflisten, nur
   * Geändertes lesen, Ungespeichertes darüber legen bzw. mit dem neueren Stand zusammenführen; danach Ungespeichertes
   * senden. Gleichzeitige Aufrufe für dasselbe Jahr teilen sich das Laden. Liefert alle bekannten Touren.
   */
  load({ today, years } = {}) {
    const list = [...new Set((years || yearsAround(today)).map(String))].filter((y) => /^\d{4}$/.test(y))
    const run = (async () => {
      this.error = ''
      await this.#restore()
      await Promise.all(
        list.map((y) => {
          if (!this.yearLoads.has(y)) this.yearLoads.set(y, this.#loadYear(y).finally(() => this.yearLoads.delete(y)))
          return this.yearLoads.get(y)
        }),
      )
      this.loaded = true
      this.onChange()
      if (this.pending.size && !this.offline) await this.flush()
      return this.tours()
    })()
    this.loading = run
    run.finally(() => this.loading === run && (this.loading = null)).catch(() => {})
    return run
  }

  /** Ungespeichertes aus dem Gerät übernehmen (einmal je Sitzung). */
  async #restore() {
    if (this.restored) return
    this.restored = true
    for (const [path, entry] of await this.cache.all('pending')) if (isTourPath(path) && !this.pending.has(path)) this.pending.set(path, entry)
  }

  /** Dateien eines Ordners mit eTag: [{ path, etag }]. Wirft ohne Netz einen Netzfehler. */
  async #listing(dir) {
    if (typeof this.store.listFiles === 'function') return this.store.listFiles(dir)
    // die Hülle für den Offline-Betrieb liefert ohne Netz eine leere Liste: dann direkt fragen, um es zu erkennen
    const src = this.store.remote?.listDocs ? this.store.remote : this.store
    if (!src.listDocs) return []
    const paths = ((await src.listDocs(dir)) || []).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
    const tags = this.store.etagsOf ? await this.store.etagsOf(paths) : new Map(await Promise.all(paths.map(async (p) => [p, await this.store.etagOf?.(p)])))
    return paths.map((path) => ({ path, etag: tags.get(path) ?? null }))
  }

  /** Kopie im Gerät: Ablage mit eigenem Speicher (cached) bzw. der eigene. */
  async #cached(path) {
    if (this.store.cached) return this.store.cached(path)
    return (await this.cache.get('docs', path)) || null
  }

  async #loadYear(year) {
    const dir = tourDir(year)
    let listing = null
    try {
      listing = (await this.#listing(dir)).filter((x) => isTourPath(x.path) && yearOfPath(x.path) === year)
      this.offline = false
      await this.cache.put('meta', `liste:${year}`, listing.map((x) => x.path))
    } catch (err) {
      if (!isNetworkError(err)) {
        this.error = `Touren ${year}: ${err.message || err}`
        throw err
      }
      this.offline = true
    }
    const known = listing ? listing.map((x) => x.path) : (await this.cache.get('meta', `liste:${year}`)) || [...this.docs.keys()].filter((p) => yearOfPath(p) === year)
    const paths = [...new Set([...known, ...[...this.pending.keys()].filter((p) => yearOfPath(p) === year)])]
    // Kopien aus dem Gerät; mit Liste nur, wenn ihr eTag noch stimmt
    const tag = new Map((listing || []).map((x) => [x.path, x.etag]))
    const toRead = []
    for (const path of paths) {
      const have = this.docs.get(path)
      if (listing && have && tag.get(path) && have.etag === tag.get(path)) continue
      const c = !have || listing ? await this.#cached(path) : null
      if (c?.data && (!listing || (tag.get(path) && c.etag === tag.get(path)))) {
        this.#adopt(path, c.data, c.etag)
        continue
      }
      if (listing && tag.has(path)) toRead.push(path)
    }
    if (listing) await this.#readAll(toRead)
    // nicht mehr in der Ablage (gelöscht): ohne eigene Änderung weglassen
    if (listing) for (const p of [...this.docs.keys()]) if (yearOfPath(p) === year && !tag.has(p) && !this.pending.has(p)) this.docs.delete(p)
    if (listing || !this.years.has(year)) this.years.set(year, { at: this.now() })
  }

  async #readAll(paths) {
    if (!paths.length) return
    let res
    try {
      res = this.store.readMany && paths.length > 1 ? await this.store.readMany(paths) : new Map(await Promise.all(paths.map(async (p) => [p, await this.store.read(p).then((doc) => ({ doc }), (error) => ({ error }))])))
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
      if (r.doc.data && typeof r.doc.data === 'object') this.#adopt(path, r.doc.data, r.doc.etag ?? null)
    }
  }

  /** Neuer Stand aus der Ablage: übernehmen; eigene ungespeicherte Änderungen darüber zusammenführen (die eine Stelle). */
  #adopt(path, data, etag) {
    this.docs.set(path, { data, etag })
    if (!this.store.cached) this.cache.put('docs', path, { data, etag })
    const p = this.pending.get(path)
    if (!p || p.etag === etag) return
    if (p.office && lockedForOffice(data)) {
      // Büro-Änderung an einer Tour, die inzwischen unterwegs ist: verworfen, der Stand des Fahrers gilt
      this.pending.delete(path)
      this.cache.del('pending', path)
      this.error = new TourLockedError(data).message
      return
    }
    const merged = this.merge(p.base, p.doc, data)
    if (same(merged, data)) {
      this.pending.delete(path)
      this.cache.del('pending', path)
      return
    }
    const entry = { ...p, doc: merged, base: clone(data), etag }
    this.pending.set(path, entry)
    this.cache.put('pending', path, entry)
  }

  /** Eine Tour frisch aus der Ablage (z. B. vor „Freigabe zurücknehmen“); null, wenn es sie nicht mehr gibt. */
  async refresh(id) {
    const path = this.pathOf(id)
    if (!path) return null
    await this.saving?.catch(() => {})
    const doc = await this.store.read(path)
    if (!doc) {
      if (!this.pending.has(path)) this.docs.delete(path)
      return this.pending.has(path) ? this.current(path) : null
    }
    this.#adopt(path, doc.data, doc.etag ?? null)
    return this.current(path)
  }

  // ------------------------------------------------ Schreiben

  /** Der Reihe nach (ein Schreiben nach dem anderen, alle Aufrufer). */
  #run(fn) {
    const run = (this.saving || Promise.resolve()).catch(() => {}).then(fn)
    this.saving = run
    run.finally(() => this.saving === run && (this.saving = null)).catch(() => {})
    return run
  }

  async #queue(path, doc, { office = false, at = new Date().toISOString() } = {}) {
    const known = this.docs.get(path)
    const prev = this.pending.get(path)
    const entry = { ...(prev || { base: clone(known?.data ?? null), etag: known?.etag ?? null }), doc: clone(doc), at }
    if (office) entry.office = true
    delete entry.error
    this.pending.set(path, entry)
    await this.cache.put('pending', path, entry)
    this.onChange()
    return prev
  }

  /**
   * Fahrer (und Mitarbeit des Büros in der Fahreransicht): Tour ändern, fn(Kopie) → neue Tour (oder dieselbe = nichts
   * zu tun). Die Änderung liegt sofort im Gerät und wird dann gespeichert. Liefert die neue Tour.
   */
  async update(id, fn, { at = new Date().toISOString() } = {}) {
    const path = this.pathOf(id)
    if (!path) throw new Error('Tour nicht gefunden.')
    const cur = this.current(path)
    const next = fn(clone(cur))
    if (!next || same(next, cur)) return cur
    await this.#queue(path, next, { at })
    this.flush().catch(() => {})
    return next
  }

  /**
   * Büro: Tour speichern (neu oder geändert) und auf das Ergebnis warten. Liefert die gespeicherte Fassung (nach einem
   * Konflikt die zusammengeführte). Ist die Tour in der Ablage inzwischen unterwegs oder abgeschlossen: TourLockedError
   * (die Änderung wird verworfen). Andere Fehler: geworfen, der vorige Stand gilt. Ohne Netz bleibt die Änderung im
   * Gerät und wird nachgeholt – außer mit online: true (Freigabe): dann OfflineError und verworfen.
   */
  async save(tour, { online = false } = {}) {
    const path = pathOfTour(tour)
    if (!path) throw new Error('Tour ohne gültiges Datum oder ID')
    if (!this.canWrite(path)) throw new Error('Keine Schreibrechte auf die Touren (matten/touren/).')
    const prev = await this.#queue(path, tour, { office: true })
    const res = await this.#run(() => this.#push(path))
    const undo = async () => {
      if (prev) this.pending.set(path, prev)
      else this.pending.delete(path)
      await (prev ? this.cache.put('pending', path, prev) : this.cache.del('pending', path))
      this.onChange()
    }
    if (res.state === 'saved') return this.current(path)
    if (res.state === 'locked') throw res.error
    if (res.state === 'offline') {
      if (!online) return this.current(path)
      await undo()
      throw new OfflineError('Ohne Verbindung: das geht erst wieder mit Netz.')
    }
    await undo()
    throw res.error || new Error(`Tour ${tour.id}: wird gerade von jemand anderem geändert – bitte neu laden.`)
  }

  /** Alles Ungespeicherte senden (der Reihe nach). Liefert die Zahl der noch wartenden. */
  flush() {
    return this.#run(() => this.#flush())
  }

  async #flush() {
    let changed = false
    for (const path of [...this.pending.keys()]) {
      const r = await this.#push(path)
      changed = true
      if (r.state === 'offline') break
    }
    if (changed) this.onChange()
    return this.pending.size
  }

  /**
   * Eine Datei schreiben: mit eTag; bei Konflikt neu lesen und zusammenführen (this.merge), nochmals (höchstens 4×).
   * Liefert { state: saved | offline | error | locked | conflict, error? }.
   */
  async #push(path) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const entry = this.pending.get(path)
      if (!entry) return { state: 'saved' }
      const doc = entry.doc
      if (!this.canWrite(path)) {
        const error = new Error('Keine Schreibrechte auf die Touren (matten/touren/).')
        return this.#failed(path, entry, error)
      }
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
        return { state: 'saved' }
      } catch (err) {
        if (isNetworkError(err)) {
          this.offline = true
          return { state: 'offline', error: err }
        }
        if (!isConflict(err)) return this.#failed(path, entry, err)
        let theirs
        try {
          theirs = await this.store.read(path)
        } catch (e) {
          if (isNetworkError(e)) {
            this.offline = true
            return { state: 'offline', error: e }
          }
          return this.#failed(path, entry, e)
        }
        const now = this.pending.get(path) || entry
        if (!theirs) {
          // in der Ablage nicht mehr da: als neue Datei anlegen (nichts geht verloren)
          this.docs.delete(path)
          this.pending.set(path, { ...now, base: null, etag: null })
          continue
        }
        this.docs.set(path, { data: theirs.data, etag: theirs.etag ?? null })
        if (now.office && lockedForOffice(theirs.data)) {
          this.pending.delete(path)
          await this.cache.del('pending', path)
          return { state: 'locked', error: new TourLockedError(theirs.data) }
        }
        // die eine Stelle: eigene Fassung mit dem Stand der Ablage zusammenführen
        const next = { ...now, doc: this.merge(now.base, now.doc, theirs.data), base: clone(theirs.data), etag: theirs.etag ?? null }
        this.pending.set(path, next)
        await this.cache.put('pending', path, next)
      }
    }
    return { state: 'conflict' }
  }

  /** Fehler ohne Netzbezug (z. B. kein Schreibrecht): bleibt im Gerät mit Fehlertext. */
  async #failed(path, entry, err) {
    const failed = { ...entry, error: String(err?.message || err) }
    this.pending.set(path, failed)
    await this.cache.put('pending', path, failed)
    this.error = failed.error
    return { state: 'error', error: err }
  }

  /**
   * Büro: Tour löschen (nur Entwürfe – check prüft den frischen Stand und liefert sonst den Grund). Liefert true.
   * Ohne Netz wird nichts gelöscht (Netzfehler).
   */
  async remove(tour, { check = null } = {}) {
    const path = this.pathOf(tour?.id) || pathOfTour(tour)
    if (!path) return false
    if (!this.canWrite(path)) throw new Error('Keine Schreibrechte auf die Touren (matten/touren/).')
    await this.saving?.catch(() => {})
    const fresh = await this.store.read(path)
    const problem = fresh && check ? check(fresh.data) : ''
    if (problem) {
      this.#adopt(path, fresh.data, fresh.etag ?? null)
      throw new Error(problem)
    }
    if (fresh) await this.store.remove(path)
    this.docs.delete(path)
    this.pending.delete(path)
    await this.cache.del('pending', path)
    await this.cache.del('docs', path)
    this.onChange()
    return true
  }

  /** Hat eine geladene Tour dieses Foto (Pfad)? */
  hasPhoto(path) {
    return this.tours().some((t) => (t.stops || []).some((s) => (s.items || []).some((it) => (it.photos || []).some((p) => p.path === path))))
  }

  /**
   * Hochgeladene Fotos in den geladenen Touren vermerken und speichern: mark(tour, [[Pfad, url]]) → Tour
   * (core/matten-fahrt.js: markPhotosUploaded). true, wenn eine Tour geändert wurde.
   */
  async markPhotos(done, mark) {
    let changed = false
    for (const t of this.tours()) {
      const next = mark(t, done)
      if (next === t) continue
      changed = true
      await this.update(t.id, () => next)
    }
    return changed
  }

  /**
   * Wartende Fotos hochladen (Warteschlange der Ablage, nach dem Funkloch) und in den Touren vermerken:
   * mark(tour, [[Pfad, url]]) → Tour. Liefert die Zahl noch wartender Fotos. Auch der Abgleich der App holt
   * die Warteschlange nach (DataService); Fotos einer Tour, die hier noch nicht geladen ist, meldet die Ablage
   * beim nächsten Mal noch einmal (onDone false).
   */
  async flushPhotos(mark) {
    if (!this.store.flushUploads) return 0
    const done = []
    const left = await this.store.flushUploads((path, url) => {
      done.push([path, url])
      return this.hasPhoto(path)
    })
    if (done.length && mark) await this.markPhotos(done, mark)
    return left
  }
}
