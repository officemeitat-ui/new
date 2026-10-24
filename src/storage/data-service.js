// Verbindet die App-Daten mit einer Ablage (Browser oder SharePoint).
//
// Aufteilung in Dateien, damit mehrere Personen gleichzeitig arbeiten können
// und jede Datei klein und lesbar bleibt:
//   daten/stammdaten.json             Mitarbeitende, Objekte, Leistungen, Regeln
//   daten/abwesenheiten.json          Urlaub, Krankenstand, …
//   daten/zeitkonto.json              veröffentlichte Wochen mit Salden
//   daten/plaene/2026/2026-10-26.json Einteilungen einer Woche + Änderungsprotokoll
//
// Gespeichert wird automatisch (verzögert), nur geänderte Dateien. Bei einem
// Konflikt werden die Änderungen beider Seiten zusammengeführt (merge.js).

import { mondayOf } from '../core/dates.js'
import { mergeDoc } from '../core/merge.js'
import { ConflictError } from './docstore-local.js'

export const DOC = {
  master: 'daten/stammdaten.json',
  absences: 'daten/abwesenheiten.json',
  account: 'daten/zeitkonto.json',
}
export const weekPath = (monday) => `daten/plaene/${monday.slice(0, 4)}/${monday}.json`

const MASTER_KEYS = ['version', 'employees', 'objects', 'tasks', 'skills', 'rules', 'extraFreeDays', 'travel', 'settings']
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const weekOfKey = (key) => mondayOf(key.slice(0, 10))

/** App-Daten → Dateien. Nur Wochen in `weeks` werden erzeugt. */
export function splitData(data, weeks) {
  const docs = {
    [DOC.master]: Object.fromEntries(MASTER_KEYS.map((k) => [k, data[k]]).filter(([, v]) => v !== undefined)),
    [DOC.absences]: { absences: data.absences || [] },
    [DOC.account]: { weeks: data.published || {} },
  }
  for (const monday of weeks) docs[weekPath(monday)] = { monday, assignments: {}, overrides: {}, log: data.logs?.[monday] || [] }
  for (const [field, target] of [
    ['assignments', 'assignments'],
    ['overrides', 'overrides'],
  ]) {
    for (const [key, value] of Object.entries(data[field] || {})) {
      const doc = docs[weekPath(weekOfKey(key))]
      if (doc) doc[target][key] = value
    }
  }
  return docs
}

/** Eine Datei in die App-Daten übernehmen. */
export function applyDoc(data, path, doc) {
  if (path === DOC.master) {
    for (const k of MASTER_KEYS) if (doc[k] !== undefined) data[k] = doc[k]
  } else if (path === DOC.absences) {
    data.absences = doc.absences || []
  } else if (path === DOC.account) {
    data.published = doc.weeks || {}
  } else {
    const monday = doc.monday
    for (const field of ['assignments', 'overrides']) {
      data[field] = data[field] || {}
      for (const key of Object.keys(data[field])) if (weekOfKey(key) === monday) delete data[field][key]
      Object.assign(data[field], doc[field] || {})
    }
    data.logs = data.logs || {}
    data.logs[monday] = doc.log || []
  }
}

export class DataService {
  constructor(store, { onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 800 } = {}) {
    this.store = store
    this.onStatus = onStatus
    this.onRemoteChange = onRemoteChange
    this.debounceMs = debounceMs
    this.base = new Map() // Pfad → zuletzt gespeicherter/geladener Stand
    this.etags = new Map()
    this.weeks = new Set()
    this.timer = null
    this.saving = null
    this.status = 'idle'
    this.data = null
  }

  #setStatus(status, detail = '') {
    this.status = status
    this.onStatus(status, detail)
  }

  /** Lädt Stammdaten, Abwesenheiten und Zeitkonto. `seed()` liefert Startdaten, falls noch nichts existiert. */
  async load(seed) {
    this.#setStatus('loading')
    const [master, absences, account] = await Promise.all([DOC.master, DOC.absences, DOC.account].map((p) => this.store.read(p)))
    const data = { assignments: {}, overrides: {}, logs: {}, absences: [], published: {} }
    this.data = data
    if (!master) {
      Object.assign(data, await seed())
      this.firstRun = true
    } else {
      for (const [path, doc] of [
        [DOC.master, master],
        [DOC.absences, absences],
        [DOC.account, account],
      ]) {
        if (!doc) continue
        applyDoc(data, path, doc.data)
        this.base.set(path, clone(doc.data))
        this.etags.set(path, doc.etag)
      }
    }
    this.#setStatus('saved')
    if (this.firstRun) {
      // Startdaten enthalten ggf. schon Einteilungen: deren Wochen gelten als geladen
      for (const key of Object.keys(data.assignments)) this.weeks.add(weekOfKey(key))
      await this.flush()
    }
    return data
  }

  /** Lädt fehlende Wochen-Dateien nach (beim Blättern). */
  async ensureWeeks(mondays) {
    const missing = mondays.filter((m) => !this.weeks.has(m))
    if (!missing.length) return false
    const docs = await Promise.all(missing.map((m) => this.store.read(weekPath(m))))
    missing.forEach((monday, i) => {
      const path = weekPath(monday)
      const doc = docs[i]
      this.weeks.add(monday)
      if (doc) {
        applyDoc(this.data, path, doc.data)
        this.base.set(path, clone(doc.data))
        this.etags.set(path, doc.etag)
      }
    })
    return true
  }

  /** Änderungen vormerken; gespeichert wird nach kurzer Pause. */
  schedule() {
    clearTimeout(this.timer)
    this.#setStatus('pending')
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  hasPendingChanges() {
    const docs = splitData(this.data, this.weeks)
    return Object.entries(docs).some(([path, doc]) => !same(doc, this.base.get(path) ?? emptyDoc(path)))
  }

  async flush() {
    clearTimeout(this.timer)
    if (this.saving) {
      await this.saving
      return this.flush()
    }
    this.saving = this.#flush().finally(() => (this.saving = null))
    return this.saving
  }

  async #flush() {
    const docs = splitData(this.data, this.weeks)
    const dirty = Object.entries(docs).filter(([path, doc]) => !same(doc, this.base.get(path) ?? emptyDoc(path)))
    if (!dirty.length) {
      this.#setStatus('saved')
      return
    }
    this.#setStatus('saving')
    let merged = false
    try {
      for (const [path, doc] of dirty) merged = (await this.#save(path, doc)) || merged
      this.#setStatus('saved')
      if (merged) this.onRemoteChange('merged')
    } catch (err) {
      this.#setStatus('error', err.message)
      throw err
    }
  }

  async #save(path, doc, retry = true) {
    try {
      const etag = await this.store.write(path, doc, this.etags.get(path))
      this.etags.set(path, etag)
      this.base.set(path, clone(doc))
      return false
    } catch (err) {
      if (!(err instanceof ConflictError) || !retry) throw err
      const remote = await this.store.read(path)
      const mergedDoc = remote ? mergeDoc(this.base.get(path) ?? emptyDoc(path), doc, remote.data) : doc
      if (remote) {
        this.etags.set(path, remote.etag)
        this.base.set(path, clone(remote.data))
      } else {
        this.etags.delete(path)
      }
      applyDoc(this.data, path, mergedDoc)
      await this.#save(path, mergedDoc, false)
      return true
    }
  }

  /**
   * Prüft, ob andere Personen inzwischen gespeichert haben, und lädt deren
   * Stand nach, sofern hier nichts Ungespeichertes ansteht.
   */
  async refresh() {
    if (this.saving || this.timer && this.status === 'pending') return []
    const docs = splitData(this.data, this.weeks)
    const changed = []
    for (const path of Object.keys(docs)) {
      const etag = await this.store.etagOf(path)
      if (!etag || etag === this.etags.get(path)) continue
      if (!same(docs[path], this.base.get(path) ?? emptyDoc(path))) continue
      const remote = await this.store.read(path)
      if (!remote) continue
      applyDoc(this.data, path, remote.data)
      this.base.set(path, clone(remote.data))
      this.etags.set(path, remote.etag)
      changed.push({ path, by: remote.modifiedBy })
    }
    if (changed.length) this.onRemoteChange('refreshed', changed)
    return changed
  }
}

function emptyDoc(path) {
  if (path === DOC.absences) return { absences: [] }
  if (path === DOC.account) return { weeks: {} }
  if (path.startsWith('daten/plaene/')) {
    const monday = path.split('/').pop().replace('.json', '')
    return { monday, assignments: {}, overrides: {}, log: [] }
  }
  return undefined
}
