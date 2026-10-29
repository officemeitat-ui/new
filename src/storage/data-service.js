// Verbindet die App-Daten mit einer Ablage (Browser oder SharePoint).
//
// Aufteilung in Dateien, damit mehrere Personen gleichzeitig arbeiten können
// und jede Datei klein und lesbar bleibt. Ein Ordner je Berechtigung:
//   objekte/objekte.json              Objekte (Name, Adresse, Revier) – alle Gruppen lesen
//   daten/stammdaten.json             Mitarbeitende, Leistungen, Regeln (ohne Lohn)
//   plaene/2026/2026-10-26.json       Einteilungen einer Woche + Änderungsprotokoll
//   personal/abwesenheiten.json       Urlaub, Krankenstand, … (Gesundheitsdaten)
//   lohn/zeitkonto.json               veröffentlichte Wochen mit Salden, Löhne, Monatsabschlüsse
//   fahrzeuge/fahrzeuge.json          Fahrzeuge, Reifen, Service, Pickerl
//
// Wasserzähler-Ablesung, Objektkontrolle, Objektdoku und Mattenwechsel sind
// eigene Werkzeuge (werkzeuge/): Sie speichern selbst in ihren Ordnern der
// Bibliothek (TOOL_FOLDERS), nicht hier.
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
export const weekPath = (monday) => `plaene/${monday.slice(0, 4)}/${monday}.json`
const isWeekPath = (path) => path.startsWith('plaene/') || path.startsWith('daten/plaene/')
/** Früherer Pfad einer Datei (Umzug), sonst null. */
export const oldPathOf = (path) => OLD_PATHS[path] || (path.startsWith('plaene/') ? `daten/${path}` : null)

/** Dateien der Module: app.data[key] ist der Inhalt der Datei. */
export const MODULE_DOCS = {
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
    [DOC.objects, () => sees('planung', 'auswertung', 'stammdaten', 'fahrzeuge'), () => edits('stammdaten', 'planung')],
    [DOC.master, () => sees('planung', 'auswertung', 'stammdaten', 'fahrzeuge'), () => edits('stammdaten', 'planung')],
    ['plaene/', () => sees('planung', 'auswertung'), () => edits('planung')],
    [DOC.absences, () => edits('planung') || sees('stammdaten', 'auswertung'), () => edits('planung', 'stammdaten')],
    [DOC.account, () => edits('planung') || sees('auswertung'), () => edits('planung', 'auswertung')],
    [MODULE_DOCS.fahrzeuge.path, () => sees('fahrzeuge'), () => edits('fahrzeuge')],
  ]
  const rule = (path) => rules.find(([p]) => (p.endsWith('/') ? path.startsWith(p) : path === p))
  return { read: (path) => !!rule(path)?.[1](), write: (path) => !!rule(path)?.[2]() }
}

/** Ordner im App-Ordner der SharePoint-Bibliothek: wer welche Rechte braucht (für die Einrichtung). */
export const FOLDERS = [
  ['objekte', 'Objekte (Name, Adresse, Revier)', DOC.objects],
  ['daten', 'Mitarbeitende, Leistungen, Regeln', DOC.master],
  ['plaene', 'Wochenpläne (Einteilungen)', weekPath('2026-01-05')],
  ['personal', 'Urlaub und Krankenstände', DOC.absences],
  ['lohn', 'Zeitkonto, Löhne, Monatsabschlüsse', DOC.account],
  ['fahrzeuge', 'Fahrzeuge, Reifen, Service', MODULE_DOCS.fahrzeuge.path],
]

/**
 * Ordner der eigenen Werkzeuge in derselben Bibliothek (neben dem Ordner der
 * App): [Ordner, Inhalt, Modul]. Die Werkzeuge lesen und schreiben dort mit
 * den SharePoint-Rechten der angemeldeten Person; ohne Modul = Kundenstamm,
 * den alle Werkzeuge lesen.
 */
export const TOOL_FOLDERS = [
  ['Wasserzähler - Ablesung', 'Wasserzähler-Ablesung: Listen, Fotos und Berichte je Standort', 'zaehler'],
  ['Objektpruefprotokolle', 'Objektkontrolle: Protokolle, Fotos, Unterschriften, Objektliste (auch die Objektdoku liest sie)', 'kontrolle'],
  ['Objektdoku', 'Objektdoku: Akten, Leistungsverzeichnis, Objektblätter, Vorlagen', 'objektmappe'],
  ['Mattenwechsel', 'Mattenwechsel: Touren, Lieferscheine, Standorte', 'matten'],
  ['Stammdaten', 'Kundenstamm (Kunden.json): von allen Werkzeugen gelesen, vom Mattenwechsel beim Abschließen gepflegt', null],
]

/** Vorschlag je Rolle für die Werkzeug-Ordner: 'Bearbeiten', 'Lesen' oder ''. */
export function toolFolderRights(access) {
  const sees = (m) => !access || access.all || access.sees(m)
  const edits = (m) => !access || access.all || access.canEdit(m)
  const anyTool = TOOL_FOLDERS.some(([, , m]) => m && sees(m))
  return TOOL_FOLDERS.map(([folder, label, m]) => {
    // die Objektdoku liest die Objektliste der Objektkontrolle; der Mattenwechsel schreibt den gemeinsamen Kundenstamm
    const right = m ? (edits(m) ? 'Bearbeiten' : sees(m) || (m === 'kontrolle' && sees('objektmappe')) ? 'Lesen' : '') : access?.all || !access || edits('matten') ? 'Bearbeiten' : anyTool ? 'Lesen' : ''
    return [folder, label, right]
  })
}

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
  const known = new Set((data.employees || []).map((e) => e.id))
  // Löhne von Personen, die dieses Gerät (noch) nicht kennt, nicht verlieren
  const pay = {
    ...Object.fromEntries(Object.entries(data.payOther || {}).filter(([id]) => !known.has(id))),
    ...Object.fromEntries((data.employees || []).map((e) => [e.id, payOf(e)]).filter(([, p]) => Object.keys(p).length)),
  }
  const docs = {
    [DOC.master]: master,
    [DOC.objects]: { objects: data.objects || [] },
    [DOC.absences]: { absences: data.absences || [] },
    // pay immer schreiben (auch leer): ein gelöschter Lohn muss bei anderen Geräten ankommen
    [DOC.account]: { weeks: data.published || {}, ...(data.payroll ? { payroll: data.payroll } : {}), pay },
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
    // Lohndaten bleiben erhalten (stehen im Zeitkonto, auch für Personen, die erst jetzt dazukommen);
    // ältere Stammdaten mit Lohn darin gelten weiter
    const pay = new Map([...Object.entries(data.payOther || {}), ...(data.employees || []).map((e) => [e.id, payOf(e)])])
    for (const k of MASTER_KEYS) if (doc[k] !== undefined) data[k] = doc[k]
    if (doc.employees) {
      data.employees = doc.employees.map((e) => ({ ...(pay.get(e.id) || {}), ...e }))
      const known = new Set(doc.employees.map((e) => e.id))
      if (data.payOther) data.payOther = Object.fromEntries(Object.entries(data.payOther).filter(([id]) => !known.has(id)))
    }
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
    // mit pay (auch leer) gilt nur, was dort steht; ältere Dateien ohne pay lassen Löhne aus den Stammdaten stehen
    if (doc.pay) {
      const known = new Set((data.employees || []).map((e) => e.id))
      data.employees = (data.employees || []).map((e) => ({ ...withoutPay(e), ...(doc.pay[e.id] || {}) }))
      data.payOther = Object.fromEntries(Object.entries(doc.pay).filter(([id]) => !known.has(id)))
    }
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
   * rights:  dataRights(access) – welche Dateien gelesen/geschrieben werden (Standard: alle).
   * blank:   Grunddaten (leere Listen, Regeln) für Personen ohne Zugriff auf die Stammdaten.
   * session: Kennung dieses Fensters (ungespeicherte Änderungen anderer Fenster bleiben unberührt).
   */
  constructor(store, { onStatus = () => {}, onRemoteChange = () => {}, debounceMs = 800, local = null, rights = null, blank = () => ({}), session = Math.random().toString(36).slice(2) } = {}) {
    this.store = store
    this.local = local // Gerätespeicher für ungespeicherte Änderungen (offline.js)
    this.rights = rights || { read: () => true, write: () => true }
    this.blank = blank
    this.session = session
    this.moved = new Map() // neuer Pfad → alter Pfad (Umzug in die eigenen Ordner)
    this.mustWrite = new Set() // neu anzulegen, auch wenn der Inhalt der Basis entspricht (Umzug)
    this.onStatus = onStatus
    this.onRemoteChange = onRemoteChange
    this.debounceMs = debounceMs
    this.base = new Map() // Pfad → zuletzt gespeicherter/geladener Stand
    this.etags = new Map()
    this.weeks = new Set()
    this.loadingWeeks = new Map() // Woche → laufender Ladevorgang
    this.unavailable = new Set() // Wochen ohne Netz und ohne Kopie im Gerät: nicht bearbeiten
    this.denied = new Set() // Dateien ohne Leserecht: werden nie gespeichert
    this.broken = new Set() // Dateien mit kaputtem Inhalt (kein JSON): Bereich bleibt leer, Hinweis
    this.missing = new Set() // lesbar laut Rolle, aber nicht gefunden (fehlt noch oder SharePoint-Recht fehlt: Graph meldet dann 404)
    this.failed = new Map() // Pfad → letzte Fehlermeldung beim Speichern
    this.timer = null
    this.saving = null
    this.status = 'idle'
    this.data = null
    this.loadedAt = ''
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
      if (err.name === 'SyntaxError') {
        // abgeschnittene oder von Hand kaputt gemachte Datei: Bereich sperren statt die App nicht zu starten
        this.denied.add(path)
        this.broken.add(path)
        return null
      }
      if (err.status !== 403) throw err
      this.denied.add(path)
      return null
    }
  }

  /** Frühere Ablage lesen (Umzug); Fehler zählen als „gibt es nicht“. */
  async #readOld(path) {
    try {
      return await this.store.read(path)
    } catch {
      return null
    }
  }

  /** Aktueller Inhalt einer Datei aus den App-Daten. */
  #live(path) {
    return splitData(this.data, new Set([...this.weeks, ...this.#touchedWeeks()]))[path]
  }

  /** Ungespeicherte Änderungen im Gerät festhalten (übersteht Neustart ohne Netz). */
  async #savePending(snaps) {
    if (!this.local) return
    const at = new Date().toISOString()
    for (const [path, doc] of snaps) await this.local.put('pending', path, { doc, base: clone(this.base.get(path)), etag: this.etags.get(path) ?? null, at, owner: this.session })
  }

  /** Gespeichert: eigenen Eintrag (und beim Start übernommene) aus dem Gerät nehmen, fremde neuere stehen lassen. */
  async #dropPending(path) {
    if (!this.local) return
    const entry = await this.local.get('pending', path)
    if (entry && (entry.owner === this.session || !entry.at || entry.at <= this.loadedAt)) await this.local.del('pending', path)
  }

  /** Anzahl der Dateien mit ungespeicherten Änderungen. */
  pendingCount() {
    return this.data ? this.#dirty().length : 0
  }

  /** Darf diese Datei gespeichert werden? */
  writable(path) {
    return !this.denied.has(path) && this.rights.write(path)
  }

  /** Woche ohne Netz nicht verfügbar (nicht im Gerät): nicht bearbeiten. */
  weekUnavailable(monday) {
    return this.unavailable.has(monday) && !this.weeks.has(monday)
  }

  /**
   * Wochen mit Einträgen im Speicher, die nie geladen wurden (z. B. ohne Netz
   * bearbeitet oder per Abwesenheit in einer späteren Woche ausgetragen).
   * Sie werden mit unbekannter Basis gespeichert: gibt es die Datei schon,
   * führt das Speichern zusammen statt zu überschreiben.
   */
  #touchedWeeks() {
    const out = new Set()
    for (const field of WEEK_FIELDS) for (const key of Object.keys(this.data[field] || {})) out.add(weekOfKey(key))
    for (const [monday, log] of Object.entries(this.data.logs || {})) if (log?.length) out.add(monday)
    for (const m of this.weeks) out.delete(m)
    return out
  }

  /** Splitten ohne gesperrte Dateien. */
  #docs() {
    return Object.entries(splitData(this.data, new Set([...this.weeks, ...this.#touchedWeeks()]))).filter(([path]) => !this.denied.has(path))
  }

  /** Geänderte Dateien, die diese Person speichern darf. */
  #dirty() {
    return this.#docs().filter(([path, doc]) => this.rights.write(path) && (this.mustWrite.has(path) || !same(doc, this.base.get(path) ?? emptyDoc(path))))
  }

  /** Lädt Stammdaten, Abwesenheiten, Zeitkonto und die Modul-Dateien. `seed()` liefert Startdaten, falls noch nichts existiert. */
  async load(seed) {
    this.#setStatus('loading')
    const paths = [DOC.master, DOC.objects, DOC.absences, DOC.account, ...Object.values(MODULE_DOCS).map((m) => m.path)]
    const docs = await Promise.all(paths.map((p) => this.#read(p)))
    const needsMaster = this.rights.read(DOC.master)
    if (needsMaster && this.broken.has(DOC.master)) throw new Error('Die Datei daten/stammdaten.json ist beschädigt (kein gültiges JSON). In SharePoint im Versionsverlauf eine frühere Fassung wiederherstellen.')
    if (needsMaster && this.denied.has(DOC.master)) throw new Error('Kein Leserecht auf die Stammdaten (daten/stammdaten.json). Bitte in SharePoint freigeben lassen.')
    if (docs[needsMaster ? 0 : 1] === undefined) throw Object.assign(new Error('Keine Verbindung, und auf diesem Gerät liegt noch kein Stand. Bitte einmal mit Netz öffnen.'), { offline: true })
    // Erststart nur, wer die Stammdaten anlegen darf (SharePoint meldet unsichtbare Dateien als „gibt es nicht“)
    const fresh = needsMaster && !docs[0] && this.rights.write(DOC.master)
    // Frühere Ablage unter daten/: lesen, im eigenen Ordner neu anlegen; der alte Inhalt ist die Basis zum Zusammenführen
    const cleanup = []
    for (const [i, path] of paths.entries()) {
      const old = OLD_PATHS[path]
      if (!old || this.denied.has(path) || fresh) continue
      if (docs[i]) {
        // neue Datei gibt es schon: liegt die alte noch (Löschen ist früher gescheitert), nochmals entfernen
        if (this.rights.write(path)) cleanup.push(old)
        continue
      }
      if (docs[i] !== null) continue
      const doc = await this.#readOld(old)
      if (doc) {
        docs[i] = { data: doc.data, etag: null }
        this.moved.set(path, old)
        this.mustWrite.add(path)
      }
    }
    for (const path of [DOC.master, DOC.objects]) if (docs[paths.indexOf(path)] === null && !this.denied.has(path) && this.rights.read(path) && !this.rights.write(path)) this.missing.add(path)
    const data = { assignments: {}, overrides: {}, trips: {}, logs: {}, absences: [], published: {} }
    this.data = data
    if (fresh) {
      Object.assign(data, await seed())
      this.firstRun = true
    } else {
      // Grunddaten zuerst: Dateien, die es (noch) nicht gibt bzw. die die Rolle nicht liest, lassen leere Listen
      Object.assign(data, await this.blank())
      for (const [i, path] of paths.entries()) {
        const doc = docs[i]
        if (!doc) continue
        applyDoc(data, path, doc.data)
        this.version++
        this.base.set(path, clone(doc.data))
        if (doc.etag) this.etags.set(path, doc.etag)
      }
    }
    data.objects ||= []
    // Objekte aus älteren Stammdaten: neu anlegen; Basis ist der alte Stand (für eine gleichzeitige Anlage auf einem anderen Gerät)
    if (!fresh && !this.base.has(DOC.objects) && data.objects.length && this.writable(DOC.objects)) {
      this.base.set(DOC.objects, { objects: clone(data.objects) })
      this.mustWrite.add(DOC.objects)
    }
    const migrate = this.mustWrite.size > 0
    // Änderungen, die zuletzt ohne Netz gemacht wurden: wieder übernehmen (beim Speichern zusammengeführt).
    // Einträge ohne Schreibrecht (anderes Konto, andere Rolle) bleiben unangetastet im Gerät.
    const pending = this.local ? await this.local.all('pending') : []
    let restored = 0
    for (const [path, p] of pending) {
      if (this.denied.has(path) || !this.rights.write(path)) continue
      if (isWeekPath(path)) this.weeks.add(p.doc.monday)
      applyDoc(data, path, clone(p.doc))
      this.version++
      restored++
      if (p.base === undefined) this.base.delete(path)
      else this.base.set(path, clone(p.base))
      if (p.etag) this.etags.set(path, p.etag)
      else this.etags.delete(path)
    }
    this.restored = restored
    this.loadedAt = new Date().toISOString()
    this.#setStatus('saved')
    for (const old of cleanup) this.store.remove?.(old).catch(() => {})
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
    await Promise.all(missing.map((m) => this.#loadWeek(m)))
    return true
  }

  /** Eine Woche laden; läuft der Ladevorgang schon (schnelles Blättern), darauf warten. */
  #loadWeek(monday) {
    if (!this.loadingWeeks.has(monday)) this.loadingWeeks.set(monday, this.#fetchWeek(monday).finally(() => this.loadingWeeks.delete(monday)))
    return this.loadingWeeks.get(monday)
  }

  async #fetchWeek(monday) {
    const path = weekPath(monday)
    let doc = await this.#read(path)
    let moved = false
    if (doc === null && !this.denied.has(path)) {
      // frühere Ablage daten/plaene/…
      const old = await this.#readOld(oldPathOf(path))
      if (old) {
        doc = { data: old.data, etag: null }
        moved = true
      }
    }
    if (doc === undefined) {
      this.unavailable.add(monday)
      return
    }
    if (this.weeks.has(monday)) return
    this.unavailable.delete(monday)
    // schon bearbeitet, bevor die Woche geladen war: nicht überschreiben, sondern zusammenführen
    const local = this.#touchedWeeks().has(monday) ? this.#live(path) : null
    this.weeks.add(monday)
    if (!doc) {
      if (local) this.schedule()
      return
    }
    applyDoc(this.data, path, clone(local ? mergeDoc(this.base.get(path), local, doc.data) : doc.data))
    this.version++
    this.base.set(path, clone(doc.data))
    if (doc.etag) this.etags.set(path, doc.etag)
    if (local && this.writable(path)) this.schedule()
    if (moved && this.writable(path)) {
      this.moved.set(path, oldPathOf(path))
      this.mustWrite.add(path)
      this.schedule()
    }
  }

  /**
   * Alle Wochenpläne der früheren Ablage daten/plaene/ nach plaene/ umziehen
   * (nicht nur die geöffneten), damit unter daten/ nur noch die Stammdaten
   * liegen. Nur mit Schreibrecht auf die Pläne; liefert die Anzahl.
   */
  async migrateOldWeeks() {
    if (!this.store.listDocs || !this.writable(weekPath('2026-01-05'))) return 0
    let moved = 0
    for (const old of await this.store.listDocs('daten/plaene/').catch(() => [])) {
      const monday = old.match(/(\d{4}-\d{2}-\d{2})\.json$/)?.[1]
      if (!monday || this.weeks.has(monday) || this.loadingWeeks.has(monday)) continue
      const path = weekPath(monday)
      try {
        const doc = await this.store.read(old)
        if (doc) {
          try {
            await this.store.write(path, doc.data, null)
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err // gibt es schon (früherer Umzug): alte Datei nur noch löschen
          }
        }
        await this.store.remove(old)
        moved++
      } catch {
        /* nächster Start versucht es wieder */
      }
    }
    return moved
  }

  /** Änderungen vormerken; gespeichert wird nach kurzer Pause. */
  schedule() {
    clearTimeout(this.timer)
    this.#setStatus('pending')
    this.timer = setTimeout(() => this.flush().catch(() => {}), this.debounceMs)
  }

  hasPendingChanges() {
    return this.#dirty().length > 0
  }

  async flush() {
    clearTimeout(this.timer)
    this.timer = null
    if (this.saving) {
      await this.saving.catch(() => {})
      return this.flush()
    }
    this.saving = this.#flush().finally(() => (this.saving = null))
    return this.saving
  }

  async #flush() {
    // Neues zuerst anlegen (Objekte, umgezogene Dateien), erst danach z. B. die Stammdaten ohne Objekte
    const first = (path) => (this.mustWrite.has(path) ? 0 : 1)
    // fester Stand je Datei: was während des Speicherns geändert wird, gilt danach als ungespeichert
    const snaps = this.#dirty()
      .sort(([a], [b]) => first(a) - first(b))
      .map(([path, doc]) => [path, clone(doc)])
    if (!snaps.length) {
      this.#setStatus('saved')
      return
    }
    this.#setStatus('saving')
    await this.#savePending(snaps)
    let merged = false
    const errors = []
    for (const [path, doc] of snaps) {
      // Stammdaten ohne Objekte erst, wenn objekte/objekte.json sicher liegt
      if (path === DOC.master && this.mustWrite.has(DOC.objects)) continue
      try {
        merged = (await this.#save(path, doc)) || merged
        await this.#dropPending(path)
      } catch (err) {
        if (isNetworkError(err)) {
          // ohne Netz: Änderungen bleiben im Gerät, gespeichert wird beim nächsten Versuch
          this.#setStatus('offline', String(this.pendingCount()))
          return
        }
        // eine Datei, die nicht geht, hält die anderen nicht auf
        this.failed.set(path, err.message)
        errors.push(err)
      }
    }
    if (errors.length) {
      this.#setStatus('error', errors[0].message)
      throw errors[0]
    }
    this.#setStatus(this.hasPendingChanges() ? 'pending' : 'saved')
    if (merged) this.onRemoteChange('merged')
  }

  async #save(path, doc, retry = true) {
    try {
      const etag = await this.store.write(path, doc, this.etags.get(path))
      this.etags.set(path, etag)
      this.base.set(path, clone(doc))
      this.mustWrite.delete(path)
      this.failed.delete(path)
      // Umzug fertig: die alte Datei (z. B. Krankenstände unter daten/) entfernen; scheitert das, versucht es der nächste Start
      const old = this.moved.get(path)
      if (old) {
        try {
          await this.store.remove?.(old)
          this.moved.delete(path)
        } catch {
          /* bleibt vorgemerkt */
        }
      }
      return false
    } catch (err) {
      if (!(err instanceof ConflictError) || !retry) throw err
      const remote = await this.store.read(path)
      // mit dem aktuellen Stand zusammenführen (inkl. Änderungen während des Speicherns)
      const live = this.#live(path) ?? doc
      // ohne bekannte Basis (nie geladen) gilt bei Einträgen, die beide haben, der gespeicherte Stand
      const mergedDoc = remote ? mergeDoc(this.base.get(path), live, remote.data) : live
      if (remote) {
        this.etags.set(path, remote.etag)
        this.base.set(path, clone(remote.data))
      } else {
        this.etags.delete(path)
      }
      applyDoc(this.data, path, clone(mergedDoc))
      this.version++
      await this.#save(path, clone(mergedDoc), false)
      return true
    }
  }

  /**
   * Prüft, ob andere Personen inzwischen gespeichert haben, und lädt deren
   * Stand nach, sofern hier nichts Ungespeichertes ansteht.
   */
  async refresh() {
    if (this.saving || (this.timer && this.status === 'pending')) return []
    // zuerst nachholen, was ohne Netz liegen geblieben ist
    if (this.status === 'offline' || this.restored) {
      this.restored = 0
      await this.flush()
      if (this.status === 'offline') return []
    }
    // Wochen, die ohne Netz nicht geladen werden konnten, jetzt nachladen
    if (this.unavailable.size) {
      const retry = [...this.unavailable]
      await Promise.all(retry.map((m) => this.#loadWeek(m)))
      const loaded = retry.filter((m) => this.weeks.has(m)).map((m) => ({ path: weekPath(m), by: null }))
      if (loaded.length) this.onRemoteChange('loaded', loaded)
    }
    const changed = []
    for (const [path, doc] of this.#docs()) {
      const etag = await this.store.etagOf(path)
      if (!etag || etag === this.etags.get(path)) continue
      if (!same(doc, this.base.get(path) ?? emptyDoc(path))) continue
      const remote = await this.store.read(path)
      if (!remote) continue
      // inzwischen hier geändert oder Speichern begonnen: nicht überschreiben, das Speichern führt zusammen
      if (this.saving || this.timer || !same(this.#live(path), this.base.get(path) ?? emptyDoc(path))) continue
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
  if (path === DOC.account) return { weeks: {}, pay: {} }
  if (isWeekPath(path)) {
    const monday = path.split('/').pop().replace('.json', '')
    return { monday, assignments: {}, overrides: {}, log: [] }
  }
  return undefined
}
