// Verbindet die App-Daten mit einer Ablage (Browser oder SharePoint).
//
// Aufteilung in Dateien, damit mehrere Personen gleichzeitig arbeiten können
// und jede Datei klein und lesbar bleibt. Ein Ordner je Berechtigung:
//   objekte/objekte.json              Objekte (Name, Adresse, Revier) – alle Gruppen lesen
//   daten/stammdaten.json             Mitarbeitende, Leistungen, Regeln (ohne Lohn)
//   daten/plaene/2026/2026-10-26.json Einteilungen einer Woche + Änderungsprotokoll
//   personal/abwesenheiten.json       Urlaub, Krankenstand, … (Gesundheitsdaten)
//   lohn/zeitkonto.json               veröffentlichte Wochen mit Salden, Löhne, Monatsabschlüsse
//   zaehler/zaehler.json              Zählstellen und Ablesungen (Modul Zählerstände), Fotos in zaehler/fotos/
//   kontrolle/kontrolle.json          Checklisten, Kontrollen, Mängel (Modul Objektkontrolle), Fotos in kontrolle/fotos/
//   objektmappe/objektmappe.json      Kontakte, Zugang, Leistungsverzeichnis (Modul Objektmappe)
//   fahrzeuge/fahrzeuge.json          Fahrzeuge, Reifen, Service, Pickerl
//
// Rechte: dataRights() sagt je Rolle, welche Dateien die App überhaupt liest
// und schreibt; andere Dateien fragt sie gar nicht erst an. In SharePoint
// bekommt jeder Ordner dieselben Rechte für die passende Microsoft-Gruppe
// (FOLDERS, folderRights). Antwortet SharePoint trotzdem mit 403, bleibt der
// Bereich leer und wird nie gespeichert – die App läuft weiter.
//
// Gespeichert wird automatisch (verzögert), nur geänderte Dateien. Bei einem
// Konflikt werden die Änderungen beider Seiten zusammengeführt (merge.js).
// Ohne Netz (Ablage meldet OfflineError) bleiben die Änderungen im Gerät
// (`local`, siehe offline.js) und werden beim nächsten Start bzw. sobald
// wieder Netz da ist gespeichert.

import { MODULES } from '../core/access.js'
import { mondayOf } from '../core/dates.js'
import { mergeDoc } from '../core/merge.js'
import { ConflictError } from './docstore-local.js'
import { isNetworkError } from './offline.js'

export const DOC = {
  master: 'daten/stammdaten.json',
  objects: 'objekte/objekte.json',
  absences: 'personal/abwesenheiten.json',
  account: 'lohn/zeitkonto.json',
}
/** Frühere Ablage (alles unter daten/): wird beim ersten Speichern in die eigenen Ordner verschoben. */
export const OLD_PATHS = { [DOC.absences]: 'daten/abwesenheiten.json', [DOC.account]: 'daten/zeitkonto.json' }
export const weekPath = (monday) => `daten/plaene/${monday.slice(0, 4)}/${monday}.json`

/** Dateien der Module: app.data[key] ist der Inhalt der Datei. */
export const MODULE_DOCS = {
  zaehler: { path: 'zaehler/zaehler.json', empty: () => ({ meters: [], readings: [], closures: {} }) },
  kontrolle: { path: 'kontrolle/kontrolle.json', empty: () => ({ checklists: [], plans: {}, inspections: [] }) },
  mappe: { path: 'objektmappe/objektmappe.json', empty: () => ({ objects: {} }) },
  fahrzeuge: { path: 'fahrzeuge/fahrzeuge.json', empty: () => ({ vehicles: [], workshops: [], changes: [], settings: {} }) },
}
const MODULE_BY_PATH = Object.fromEntries(Object.entries(MODULE_DOCS).map(([key, m]) => [m.path, { key, ...m }]))

// ---------------------------------------------------------------- Rechte je Rolle

const any = (list, fn) => list.some(fn)
/**
 * Welche Dateien die App für diese Person liest und schreibt. access: aus
 * resolveAccess (sees, canEdit, all). Ohne access (Browser-Modus): alles.
 */
export function dataRights(access) {
  if (!access || access.all) return { read: () => true, write: () => true }
  const sees = (...m) => any(m, (x) => access.sees(x))
  const edits = (...m) => any(m, (x) => access.canEdit(x))
  const rules = [
    [DOC.objects, () => sees(...Object.keys(MODULES)), () => edits('stammdaten', 'planung')],
    [DOC.master, () => sees('planung', 'auswertung', 'stammdaten', 'kontrolle', 'objektmappe', 'fahrzeuge'), () => edits('stammdaten', 'planung')],
    ['daten/plaene/', () => sees('planung', 'auswertung'), () => edits('planung')],
    [DOC.absences, () => edits('planung') || sees('stammdaten', 'auswertung'), () => edits('planung', 'stammdaten')],
    [DOC.account, () => edits('planung') || sees('auswertung'), () => edits('planung', 'auswertung')],
    [MODULE_DOCS.zaehler.path, () => sees('zaehler'), () => edits('zaehler')],
    [MODULE_DOCS.kontrolle.path, () => sees('kontrolle'), () => edits('kontrolle')],
    [MODULE_DOCS.mappe.path, () => sees('objektmappe', 'kontrolle'), () => edits('objektmappe')],
    [MODULE_DOCS.fahrzeuge.path, () => sees('fahrzeuge'), () => edits('fahrzeuge')],
  ]
  const rule = (path) => rules.find(([p]) => (p.endsWith('/') ? path.startsWith(p) : path === p))
  return { read: (path) => !!rule(path)?.[1](), write: (path) => !!rule(path)?.[2]() }
}

/** Ordner im App-Ordner der SharePoint-Bibliothek: wer welche Rechte braucht (für die Einrichtung). */
export const FOLDERS = [
  ['objekte', 'Objekte (Name, Adresse, Revier)', DOC.objects],
  ['daten', 'Mitarbeitende, Leistungen, Wochenpläne', DOC.master],
  ['personal', 'Urlaub und Krankenstände', DOC.absences],
  ['lohn', 'Zeitkonto, Löhne, Monatsabschlüsse', DOC.account],
  ['zaehler', 'Zählerstände mit Fotos', MODULE_DOCS.zaehler.path],
  ['kontrolle', 'Objektkontrollen mit Fotos', MODULE_DOCS.kontrolle.path],
  ['objektmappe', 'Objektmappe, Leistungsverzeichnis', MODULE_DOCS.mappe.path],
  ['fahrzeuge', 'Fahrzeuge, Reifen, Service', MODULE_DOCS.fahrzeuge.path],
]

/** Rechte einer Rolle je Ordner: 'Bearbeiten', 'Lesen' oder ''. Exporte (PDF/Excel) und Übernahme nur mit Vollzugriff. */
export function folderRights(access) {
  const r = dataRights(access)
  const rows = FOLDERS.map(([folder, label, path]) => [folder, label, r.write(path) ? 'Bearbeiten' : r.read(path) ? 'Lesen' : ''])
  rows.push(['exporte', 'Excel- und PDF-Wochenpläne', access?.all ? 'Bearbeiten' : ''])
  return rows
}

// Objekte stehen seit der Trennung in objekte/objekte.json; ältere Stammdaten enthalten sie noch
const MASTER_KEYS = ['version', 'employees', 'tasks', 'skills', 'rules', 'extraFreeDays', 'travel', 'settings']
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
    [DOC.objects]: { objects: data.objects || [] },
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
    // ältere Stammdaten mit Objekten: nur solange es objekte/objekte.json noch nicht gibt
    if (doc.objects && !data.objects?.length) data.objects = doc.objects
  } else if (path === DOC.objects) {
    data.objects = doc.objects || []
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
  /**
   * rights: dataRights(access) – welche Dateien gelesen/geschrieben werden (Standard: alle).
   * blank:  Grunddaten (leere Listen, Regeln) für Personen ohne Zugriff auf die Stammdaten.
   */
  constructor(store, { onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 800, local = null, rights = null, blank = () => ({}) } = {}) {
    this.store = store
    this.local = local // Gerätespeicher für ungespeicherte Änderungen (offline.js)
    this.rights = rights || { read: () => true, write: () => true }
    this.blank = blank
    this.moved = new Map() // neuer Pfad → alter Pfad (Umzug in die eigenen Ordner)
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
    if (!this.rights.read(path)) {
      // nicht für diese Rolle: gar nicht erst anfragen
      this.denied.add(path)
      return null
    }
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
    return this.data ? this.#dirty().length : 0
  }

  /** Darf diese Datei gespeichert werden? */
  writable(path) {
    return !this.denied.has(path) && this.rights.write(path)
  }

  /** Splitten ohne gesperrte Dateien. */
  #docs() {
    return Object.entries(splitData(this.data, this.weeks)).filter(([path]) => !this.denied.has(path))
  }

  /** Geänderte Dateien, die diese Person speichern darf. */
  #dirty() {
    return this.#docs().filter(([path, doc]) => this.rights.write(path) && !same(doc, this.base.get(path) ?? emptyDoc(path)))
  }

  /** Lädt Stammdaten, Abwesenheiten, Zeitkonto und die Modul-Dateien. `seed()` liefert Startdaten, falls noch nichts existiert. */
  async load(seed) {
    this.#setStatus('loading')
    const paths = [DOC.master, DOC.objects, DOC.absences, DOC.account, ...Object.values(MODULE_DOCS).map((m) => m.path)]
    const docs = await Promise.all(paths.map((p) => this.#read(p)))
    const needsMaster = this.rights.read(DOC.master)
    if (needsMaster && this.denied.has(DOC.master)) throw new Error('Kein Leserecht auf die Stammdaten (daten/stammdaten.json). Bitte in SharePoint freigeben lassen.')
    if (docs[needsMaster ? 0 : 1] === undefined) throw Object.assign(new Error('Keine Verbindung, und auf diesem Gerät liegt noch kein Stand. Bitte einmal mit Netz öffnen.'), { offline: true })
    // Frühere Ablage unter daten/: lesen, beim nächsten Speichern im eigenen Ordner ablegen
    for (const [i, path] of paths.entries()) {
      const old = OLD_PATHS[path]
      if (!old || docs[i] !== null || this.denied.has(path) || (needsMaster && !docs[0])) continue
      // gleiche Rechte wie der neue Ordner; fehlt das Recht in SharePoint, bleibt es beim neuen
      const doc = await this.store.read(old).catch(() => null)
      if (doc) {
        docs[i] = { data: doc.data, etag: null }
        this.moved.set(path, old)
      }
    }
    const data = { assignments: {}, overrides: {}, trips: {}, logs: {}, absences: [], published: {} }
    this.data = data
    if (!needsMaster) {
      // ohne Stammdaten (z. B. nur Zählerstände): Grunddaten, nichts anlegen
      Object.assign(data, await this.blank())
      for (const [i, path] of paths.entries()) {
        const doc = docs[i]
        if (!doc) continue
        applyDoc(data, path, doc.data)
        this.version++
        this.base.set(path, clone(doc.data))
        this.etags.set(path, doc.etag)
      }
    } else if (!docs[0]) {
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
    // Umzug: alte Dateien gelten als noch nicht gespeichert, Objekte aus älteren Stammdaten ebenso
    for (const path of this.moved.keys()) {
      this.base.delete(path)
      this.etags.delete(path)
    }
    const migrate = this.moved.size || (!this.base.has(DOC.objects) && data.objects?.length && this.writable(DOC.objects))
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
    } else if (migrate) {
      await this.flush().catch(() => {})
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
    return this.#dirty().length > 0
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
    const dirty = this.#dirty()
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
      // Umzug fertig: die alte Datei (z. B. Krankenstände unter daten/) entfernen
      const old = this.moved.get(path)
      if (old) {
        this.moved.delete(path)
        await this.store.remove?.(old).catch(() => {})
      }
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
  if (path === DOC.objects) return { objects: [] }
  if (path === DOC.absences) return { absences: [] }
  if (path === DOC.account) return { weeks: {} }
  if (path.startsWith('daten/plaene/')) {
    const monday = path.split('/').pop().replace('.json', '')
    return { monday, assignments: {}, overrides: {}, log: [] }
  }
  return undefined
}
