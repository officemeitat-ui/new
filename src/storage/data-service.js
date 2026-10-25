// Verbindet die App-Daten mit einer Ablage (Browser oder SharePoint).
//
// Aufteilung in Dateien, damit mehrere Personen gleichzeitig arbeiten können
// und jede Datei klein und lesbar bleibt:
//   daten/stammdaten.json             Mitarbeitende, Objekte, Leistungen, Regeln
//   daten/abwesenheiten.json          Urlaub, Krankenstand, …
//   daten/zeitkonto.json              veröffentlichte Wochen mit Salden, Monatsabschlüsse
//   daten/plaene/2026/2026-10-26.json Einteilungen einer Woche + Änderungsprotokoll
//   zaehler/zaehler.json              Zählstellen und Ablesungen (Modul Zählerstände), Fotos in zaehler/fotos/
//   kontrolle/kontrolle.json          Checklisten, Kontrollen, Mängel (Modul Objektkontrolle), Fotos in kontrolle/fotos/
//   objektmappe/objektmappe.json      Kontakte, Zugang, Leistungsverzeichnis (Modul Objektmappe)
//
// Rechte: Jeder Modul-Ordner kann in SharePoint eigene Berechtigungen haben
// (z. B. Gruppe „Ableser“ nur auf zaehler/). Darf jemand eine Datei nicht
// lesen (403), bleibt der Bereich leer und wird nie gespeichert – die App
// läuft weiter. Stundenlöhne stehen nicht in den Stammdaten, sondern in
// daten/zeitkonto.json (nur Disposition und Lohnverrechnung).
//
// Gespeichert wird automatisch (verzögert), nur geänderte Dateien. Bei einem
// Konflikt werden die Änderungen beider Seiten zusammengeführt (merge.js).
// Ohne Netz (Ablage meldet OfflineError) bleiben die Änderungen im Gerät
// (`local`, siehe offline.js) und werden beim nächsten Start bzw. sobald
// wieder Netz da ist gespeichert.

import { mondayOf } from '../core/dates.js'
import { mergeDoc } from '../core/merge.js'
import { ConflictError } from './docstore-local.js'
import { isNetworkError } from './offline.js'

export const DOC = {
  master: 'daten/stammdaten.json',
  absences: 'daten/abwesenheiten.json',
  account: 'daten/zeitkonto.json',
}
export const weekPath = (monday) => `daten/plaene/${monday.slice(0, 4)}/${monday}.json`

/** Dateien der Module: app.data[key] ist der Inhalt der Datei. */
export const MODULE_DOCS = {
  zaehler: { path: 'zaehler/zaehler.json', empty: () => ({ meters: [], readings: [], closures: {} }) },
  kontrolle: { path: 'kontrolle/kontrolle.json', empty: () => ({ checklists: [], plans: {}, inspections: [] }) },
  mappe: { path: 'objektmappe/objektmappe.json', empty: () => ({ objects: {} }) },
}
const MODULE_BY_PATH = Object.fromEntries(Object.entries(MODULE_DOCS).map(([key, m]) => [m.path, { key, ...m }]))

const MASTER_KEYS = ['version', 'employees', 'objects', 'tasks', 'skills', 'rules', 'extraFreeDays', 'travel', 'settings']
// Lohndaten je Person: nicht in den Stammdaten (die auch Ableser und Prüfer lesen), sondern im Zeitkonto
const PAY_FIELDS = ['hourlyWage', 'wageGroup']
const payOf = (e) => Object.fromEntries(PAY_FIELDS.filter((f) => e[f] !== undefined).map((f) => [f, e[f]]))
const withoutPay = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !PAY_FIELDS.includes(k)))
// Felder je Woche; Schlüssel beginnen mit dem Datum des Einsatzes (trips = geplante Fahrten)
const WEEK_FIELDS = ['assignments', 'overrides', 'trips']
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const weekOfKey = (key) => mondayOf(key.slice(0, 10))

/** App-Daten → Dateien. Nur Wochen in `weeks` werden erzeugt. */
export function splitData(data, weeks) {
  const master = Object.fromEntries(MASTER_KEYS.map((k) => [k, data[k]]).filter(([, v]) => v !== undefined))
  if (master.employees) master.employees = master.employees.map(withoutPay)
  const pay = Object.fromEntries((data.employees || []).map((e) => [e.id, payOf(e)]).filter(([, p]) => Object.keys(p).length))
  const docs = {
    [DOC.master]: master,
    [DOC.absences]: { absences: data.absences || [] },
    [DOC.account]: { weeks: data.published || {}, ...(data.payroll ? { payroll: data.payroll } : {}), ...(Object.keys(pay).length ? { pay } : {}) },
  }
  for (const [key, m] of Object.entries(MODULE_DOCS)) docs[m.path] = data[key] ?? m.empty()
  for (const monday of weeks) docs[weekPath(monday)] = { monday, assignments: {}, overrides: {}, log: data.logs?.[monday] || [] }
  for (const field of WEEK_FIELDS) {
    for (const [key, value] of Object.entries(data[field] || {})) {
      const doc = docs[weekPath(weekOfKey(key))]
      if (!doc) continue
      doc[field] = doc[field] || {}
      doc[field][key] = value
    }
  }
  return docs
}

/** Eine Datei in die App-Daten übernehmen. */
export function applyDoc(data, path, doc) {
  if (path === DOC.master) {
    // Lohndaten bleiben erhalten (stehen im Zeitkonto); ältere Stammdaten mit Lohn darin gelten weiter
    const pay = new Map((data.employees || []).map((e) => [e.id, payOf(e)]))
    for (const k of MASTER_KEYS) if (doc[k] !== undefined) data[k] = doc[k]
    if (doc.employees) data.employees = doc.employees.map((e) => ({ ...(pay.get(e.id) || {}), ...e }))
  } else if (path === DOC.absences) {
    data.absences = doc.absences || []
  } else if (path === DOC.account) {
    data.published = doc.weeks || {}
    if (doc.payroll) data.payroll = doc.payroll
    else delete data.payroll
    const pay = doc.pay || {}
    data.employees = (data.employees || []).map((e) => (pay[e.id] ? { ...withoutPay(e), ...pay[e.id] } : e))
  } else if (MODULE_BY_PATH[path]) {
    const m = MODULE_BY_PATH[path]
    data[m.key] = { ...m.empty(), ...doc }
  } else {
    const monday = doc.monday
    for (const field of WEEK_FIELDS) {
      data[field] = data[field] || {}
      for (const key of Object.keys(data[field])) if (weekOfKey(key) === monday) delete data[field][key]
      Object.assign(data[field], doc[field] || {})
    }
    data.logs = data.logs || {}
    data.logs[monday] = doc.log || []
  }
}

export class DataService {
  constructor(store, { onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 800, local = null } = {}) {
    this.store = store
    this.local = local // Gerätespeicher für ungespeicherte Änderungen (offline.js)
    this.onStatus = onStatus
    this.onRemoteChange = onRemoteChange
    this.debounceMs = debounceMs
    this.base = new Map() // Pfad → zuletzt gespeicherter/geladener Stand
    this.etags = new Map()
    this.weeks = new Set()
    this.denied = new Set() // Dateien ohne Leserecht: werden nie gespeichert
    this.timer = null
    this.saving = null
    this.status = 'idle'
    this.data = null
    this.version = 0 // steigt bei jedem geladenen/zusammengeführten Dokument (für Rechen-Caches)
  }

  #setStatus(status, detail = '') {
    this.status = status
    this.onStatus(status, detail)
  }

  /** Datei lesen; ohne Leserecht (403) als gesperrt merken statt abzubrechen. Ohne Netz und ohne Kopie im Gerät: undefined. */
  async #read(path) {
    try {
      return await this.store.read(path)
    } catch (err) {
      if (isNetworkError(err)) return undefined
      if (err.status !== 403) throw err
      this.denied.add(path)
      return null
    }
  }

  /** Ungespeicherte Änderungen im Gerät festhalten (übersteht Neustart ohne Netz). */
  async #savePending(dirty) {
    if (!this.local) return
    const paths = new Set(dirty.map(([path]) => path))
    for (const [path, doc] of dirty) await this.local.put('pending', path, { doc: clone(doc), base: clone(this.base.get(path)), etag: this.etags.get(path) ?? null, at: new Date().toISOString() })
    for (const [path] of await this.local.all('pending')) if (!paths.has(path)) await this.local.del('pending', path)
  }

  /** Anzahl der Dateien mit ungespeicherten Änderungen. */
  pendingCount() {
    return this.data ? this.#docs().filter(([path, doc]) => !same(doc, this.base.get(path) ?? emptyDoc(path))).length : 0
  }

  /** Darf diese Datei gespeichert werden? */
  writable(path) {
    return !this.denied.has(path)
  }

  /** Splitten ohne gesperrte Dateien. */
  #docs() {
    return Object.entries(splitData(this.data, this.weeks)).filter(([path]) => !this.denied.has(path))
  }

  /** Lädt Stammdaten, Abwesenheiten, Zeitkonto und die Modul-Dateien. `seed()` liefert Startdaten, falls noch nichts existiert. */
  async load(seed) {
    this.#setStatus('loading')
    const paths = [DOC.master, DOC.absences, DOC.account, ...Object.values(MODULE_DOCS).map((m) => m.path)]
    const docs = await Promise.all(paths.map((p) => this.#read(p)))
    if (this.denied.has(DOC.master)) throw new Error('Kein Leserecht auf die Stammdaten (daten/stammdaten.json). Bitte in SharePoint freigeben lassen.')
    if (docs[0] === undefined) throw Object.assign(new Error('Keine Verbindung, und auf diesem Gerät liegt noch kein Stand. Bitte einmal mit Netz öffnen.'), { offline: true })
    const data = { assignments: {}, overrides: {}, trips: {}, logs: {}, absences: [], published: {} }
    this.data = data
    if (!docs[0]) {
      Object.assign(data, await seed())
      this.firstRun = true
    } else {
      for (const [i, path] of paths.entries()) {
        const doc = docs[i]
        if (!doc) continue
        applyDoc(data, path, doc.data)
        this.version++
        this.base.set(path, clone(doc.data))
        this.etags.set(path, doc.etag)
      }
    }
    // Änderungen, die zuletzt ohne Netz gemacht wurden: wieder übernehmen (beim Speichern zusammengeführt)
    const pending = this.local ? await this.local.all('pending') : []
    for (const [path, p] of pending) {
      if (this.denied.has(path)) continue
      if (path.startsWith('daten/plaene/')) this.weeks.add(p.doc.monday)
      applyDoc(data, path, clone(p.doc))
      this.version++
      if (p.base === undefined) this.base.delete(path)
      else this.base.set(path, clone(p.base))
      if (p.etag) this.etags.set(path, p.etag)
      else this.etags.delete(path)
    }
    this.restored = pending.length
    this.#setStatus('saved')
    if (this.firstRun) {
      // Startdaten enthalten ggf. schon Einteilungen: deren Wochen gelten als geladen
      for (const key of Object.keys(data.assignments)) this.weeks.add(weekOfKey(key))
      await this.flush()
    }
    return data
  }

  /** Lädt fehlende Wochen-Dateien nach (beim Blättern). Ohne Netz und ohne Kopie bleibt eine Woche ungeladen. */
  async ensureWeeks(mondays) {
    const missing = mondays.filter((m) => !this.weeks.has(m))
    if (!missing.length) return false
    const docs = await Promise.all(missing.map((m) => this.#read(weekPath(m))))
    missing.forEach((monday, i) => {
      const path = weekPath(monday)
      const doc = docs[i]
      if (doc === undefined) return
      this.weeks.add(monday)
      if (doc) {
        applyDoc(this.data, path, doc.data)
        this.version++
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
    return this.#docs().some(([path, doc]) => !same(doc, this.base.get(path) ?? emptyDoc(path)))
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
    const dirty = this.#docs().filter(([path, doc]) => !same(doc, this.base.get(path) ?? emptyDoc(path)))
    if (!dirty.length) {
      if (this.local) await this.#savePending([])
      this.#setStatus('saved')
      return
    }
    this.#setStatus('saving')
    await this.#savePending(dirty)
    let merged = false
    try {
      for (const [path, doc] of dirty) {
        merged = (await this.#save(path, doc)) || merged
        await this.local?.del('pending', path)
      }
      this.#setStatus('saved')
      if (merged) this.onRemoteChange('merged')
    } catch (err) {
      if (isNetworkError(err)) {
        // ohne Netz: Änderungen bleiben im Gerät, gespeichert wird beim nächsten Versuch
        this.#setStatus('offline', String(this.pendingCount()))
        return
      }
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
      this.version++
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
    // zuerst nachholen, was ohne Netz liegen geblieben ist
    if (this.status === 'offline' || this.restored) {
      this.restored = 0
      await this.flush()
      if (this.status === 'offline') return []
    }
    const changed = []
    for (const [path, doc] of this.#docs()) {
      const etag = await this.store.etagOf(path)
      if (!etag || etag === this.etags.get(path)) continue
      if (!same(doc, this.base.get(path) ?? emptyDoc(path))) continue
      const remote = await this.store.read(path)
      if (!remote) continue
      applyDoc(this.data, path, remote.data)
      this.version++
      this.base.set(path, clone(remote.data))
      this.etags.set(path, remote.etag)
      changed.push({ path, by: remote.modifiedBy })
    }
    if (changed.length) this.onRemoteChange('refreshed', changed)
    return changed
  }
}

function emptyDoc(path) {
  if (MODULE_BY_PATH[path]) return MODULE_BY_PATH[path].empty()
  if (path === DOC.absences) return { absences: [] }
  if (path === DOC.account) return { weeks: {} }
  if (path.startsWith('daten/plaene/')) {
    const monday = path.split('/').pop().replace('.json', '')
    return { monday, assignments: {}, overrides: {}, log: [] }
  }
  return undefined
}
