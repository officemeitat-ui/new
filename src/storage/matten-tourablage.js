// Touren des Mattenwechsels für das Büro lesen und schreiben: je Tour eine Datei matten/touren/<Jahr>/<TourId>.json
// über die Ablage der App (SharePoint mit eTag bzw. im Browser-Modus der Browser-Speicher). Anders als die übrigen
// Dateien gehen Touren nicht über den DataService (eine Datei je Tour, die Liste wächst je Jahr): Ordner eines Jahres
// auflisten (mit eTag), nur neue oder geänderte Dateien lesen (Kopie im Gerät bzw. hier gemerkt), Schreiben mit
// If-Match. Schlägt das fehl (jemand hat die Tour inzwischen gespeichert), wird neu gelesen und zusammengeführt –
// an genau einer Stelle (this.merge, Vorgabe mergeOfficeTour aus core/matten-touren.js; später mergeTour aus
// core/matten-fahrt.js). Ist die Tour dort schon unterwegs oder abgeschlossen, bricht das Speichern ab
// (TourLockedError): ab dann gehört sie dem Fahrer.
//
// Das Büro schreibt nur mit Verbindung (Planen und Freigeben brauchen den aktuellen Stand); ohne Netz zeigt die
// Ansicht den zuletzt gelesenen Stand. Schreibrechte prüft canWrite (dataRights der Rolle), SharePoint zusätzlich.

import { isNetworkError } from './offline.js'
import { isTourPath, mergeOfficeTour, pathOfTour, tourDir, yearOfPath } from '../core/matten-touren.js'

const clone = (x) => (x === undefined || x === null ? x : JSON.parse(JSON.stringify(x)))
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isConflict = (err) => err?.name === 'ConflictError' || err?.status === 412 || err?.status === 409

export class OfficeTourStore {
  /**
   * store: Ablage der App (read, write mit eTag, remove, listFiles bzw. listDocs, optional readMany, etagsOf, cached).
   * merge(base, mine, theirs): Zusammenführen bei Konflikt (die eine Stelle). canWrite(path): darf die Rolle schreiben?
   */
  constructor({ store, merge = mergeOfficeTour, canWrite = () => true, now = () => Date.now() } = {}) {
    this.store = store
    this.merge = merge
    this.canWrite = canWrite
    this.now = now
    this.files = new Map() // Pfad → { data, etag } (Stand in der Ablage)
    this.local = new Map() // Pfad → Tour (geändert, noch nicht geschrieben)
    this.years = new Map() // Jahr → { at } (Ordner gelesen)
    this.loading = new Map() // Jahr → laufendes Laden
    this.queue = new Map() // Pfad → letztes Schreiben (der Reihe nach je Datei)
    this.offline = false
    this.error = ''
  }

  // ------------------------------------------------ Stand

  /** Aktuelle Fassung je Datei (eigene ungeschriebene Änderung vor dem Stand der Ablage). */
  current(path) {
    return this.local.get(path) || this.files.get(path)?.data || null
  }

  /** Alle bekannten Touren. */
  tours() {
    const out = []
    for (const path of new Set([...this.files.keys(), ...this.local.keys()])) {
      const t = this.current(path)
      if (t) out.push(t)
    }
    return out
  }

  pathOf(id) {
    for (const path of new Set([...this.files.keys(), ...this.local.keys()])) if (this.current(path)?.id === id) return path
    return ''
  }

  byId(id) {
    const p = this.pathOf(id)
    return p ? this.current(p) : null
  }

  /** Ordner des Jahres schon gelesen? maxAge (ms): nur, wenn nicht älter. */
  loaded(year, maxAge = Infinity) {
    const y = this.years.get(String(year))
    return !!y && this.now() - y.at <= maxAge
  }

  // ------------------------------------------------ Lesen

  /** Ordner der Jahre lesen, die noch fehlen (bzw. alle mit force). Gleichzeitige Aufrufe teilen sich das Laden. */
  async load(years = [], { force = false } = {}) {
    const list = [...new Set(years.map(String))].filter((y) => /^\d{4}$/.test(y))
    await Promise.all(
      list.map((y) => {
        if (!force && this.years.has(y)) return null
        if (!this.loading.has(y)) this.loading.set(y, this.#loadYear(y).finally(() => this.loading.delete(y)))
        return this.loading.get(y)
      }),
    )
    return this.tours()
  }

  async #listing(dir) {
    if (typeof this.store.listFiles === 'function') return this.store.listFiles(dir)
    const paths = ((await this.store.listDocs?.(dir)) || []).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
    const tags = this.store.etagsOf ? await this.store.etagsOf(paths) : new Map(await Promise.all(paths.map(async (p) => [p, await this.store.etagOf?.(p)])))
    return paths.map((path) => ({ path, etag: tags.get(path) ?? null }))
  }

  async #loadYear(year) {
    const dir = tourDir(year)
    let listing
    try {
      listing = (await this.#listing(dir)).filter((x) => isTourPath(x.path) && yearOfPath(x.path) === year)
      this.offline = false
    } catch (err) {
      if (!isNetworkError(err)) {
        this.error = `Touren ${year}: ${err.message || err}`
        throw err
      }
      this.offline = true
      return
    }
    const listed = new Set(listing.map((x) => x.path))
    const toRead = []
    for (const { path, etag } of listing) {
      const known = this.files.get(path)
      if (known && etag && known.etag === etag) continue
      const cached = this.store.cached ? await this.store.cached(path) : null
      if (cached?.data && etag && cached.etag === etag) {
        this.files.set(path, { data: cached.data, etag })
        continue
      }
      toRead.push(path)
    }
    await this.#readAll(toRead)
    // in der Ablage nicht mehr da (gelöscht): weglassen, außer es gibt hier eine ungeschriebene Änderung
    for (const path of [...this.files.keys()]) if (yearOfPath(path) === year && !listed.has(path) && !this.local.has(path)) this.files.delete(path)
    this.years.set(year, { at: this.now() })
    this.error = ''
  }

  async #readAll(paths) {
    if (!paths.length) return
    let res
    if (this.store.readMany && paths.length > 1) res = await this.store.readMany(paths)
    else res = new Map(await Promise.all(paths.map(async (p) => [p, await this.store.read(p).then((doc) => ({ doc }), (error) => ({ error }))])))
    for (const path of paths) {
      const r = res.get(path)
      if (!r) continue
      if (r.error) {
        if (isNetworkError(r.error)) this.offline = true
        else this.error = `${path}: ${r.error.message || r.error}`
        continue
      }
      if (!r.doc) this.files.delete(path)
      else if (r.doc.data && typeof r.doc.data === 'object') this.files.set(path, { data: r.doc.data, etag: r.doc.etag ?? null })
    }
  }

  /** Eine Tour frisch aus der Ablage (z. B. vor „Freigabe zurücknehmen“); null, wenn es sie nicht mehr gibt. */
  async refresh(id) {
    const path = this.pathOf(id)
    if (!path) return null
    await this.#settled(path)
    const doc = await this.store.read(path)
    if (!doc) {
      this.files.delete(path)
      this.local.delete(path)
      return null
    }
    this.files.set(path, { data: doc.data, etag: doc.etag ?? null })
    return this.current(path)
  }

  // ------------------------------------------------ Schreiben

  /** Warten, bis das Schreiben dieser Datei fertig ist (Fehler zählen nicht). */
  async #settled(path) {
    await this.queue.get(path)?.catch(() => {})
  }

  /**
   * Tour speichern (neu oder geändert): sofort hier sichtbar, dann der Reihe nach je Datei geschrieben. Liefert die
   * gespeicherte Fassung (nach einem Konflikt die zusammengeführte). Wirft TourLockedError (unterwegs), Fehler der
   * Ablage, ohne Netz einen Netzfehler (die Änderung wird dann verworfen, der gelesene Stand gilt).
   */
  save(tour) {
    const path = pathOfTour(tour)
    if (!path) return Promise.reject(new Error('Tour ohne gültiges Datum oder ID'))
    if (!this.canWrite(path)) return Promise.reject(new Error('Keine Schreibrechte auf die Touren (matten/touren/).'))
    this.local.set(path, clone(tour))
    const run = (this.queue.get(path) || Promise.resolve())
      .catch(() => {})
      .then(() => this.#push(path))
    this.queue.set(path, run)
    run.finally(() => this.queue.get(path) === run && this.queue.delete(path)).catch(() => {})
    return run
  }

  async #push(path) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = this.local.get(path)
      if (!doc) return this.current(path)
      const base = this.files.get(path)
      if (base && same(base.data, doc)) {
        this.local.delete(path)
        return base.data
      }
      try {
        const etag = await this.store.write(path, doc, base?.etag ?? null)
        this.files.set(path, { data: clone(doc), etag })
        if (this.local.get(path) === doc) this.local.delete(path)
        this.offline = false
        return doc
      } catch (err) {
        if (!isConflict(err)) {
          // nicht geschrieben: der Stand der Ablage gilt wieder
          if (this.local.get(path) === doc) this.local.delete(path)
          if (isNetworkError(err)) this.offline = true
          throw err
        }
        const theirs = await this.store.read(path)
        if (!theirs) {
          // dort gelöscht bzw. noch nie da: als neue Datei anlegen
          this.files.delete(path)
          continue
        }
        // die eine Stelle: eigene Fassung (auch eine inzwischen neuere) mit dem Stand der Ablage zusammenführen
        const mine = this.local.get(path) || doc
        let merged
        try {
          merged = this.merge(base?.data ?? null, mine, theirs.data)
        } catch (e) {
          this.files.set(path, { data: theirs.data, etag: theirs.etag ?? null })
          this.local.delete(path)
          throw e
        }
        this.files.set(path, { data: theirs.data, etag: theirs.etag ?? null })
        this.local.set(path, merged)
      }
    }
    const doc = this.local.get(path)
    this.local.delete(path)
    throw new Error(`Tour ${doc?.id || path}: wird gerade von jemand anderem geändert – bitte neu laden.`)
  }

  /**
   * Tour löschen (nur Entwürfe – check prüft den frischen Stand, z. B. „noch Entwurf?“, und liefert sonst den Grund).
   * Liefert true, wenn gelöscht.
   */
  async remove(tour, { check = null } = {}) {
    const path = this.pathOf(tour?.id) || pathOfTour(tour)
    if (!path) return false
    if (!this.canWrite(path)) throw new Error('Keine Schreibrechte auf die Touren (matten/touren/).')
    await this.#settled(path)
    const fresh = await this.store.read(path)
    const problem = fresh && check ? check(fresh.data) : ''
    if (problem) {
      this.files.set(path, { data: fresh.data, etag: fresh.etag ?? null })
      throw new Error(problem)
    }
    if (fresh) await this.store.remove(path)
    this.files.delete(path)
    this.local.delete(path)
    return true
  }
}
