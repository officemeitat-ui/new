// Reviere in den Werkzeugen: Wasserzähler, Objektkontrolle und Objektdoku legen ihre Daten je Revier
// in einen eigenen Unterordner „Revier <Name>“ unter ihrem Grundordner. Rechte in SharePoint je
// Revier-Ordner (eine Gruppe je Revier, config.json → access.reviere), so sehen Leute vor Ort nur ihre
// Objekte. Die Namensregel ist in allen drei Werkzeugen gleich (revierName); ändern nur gemeinsam.
// Alte Ordner (ohne Revier) bleiben lesbar und werden einmal vom Büro verschoben (Umzug in
// ui/views/access.js, Plan hier: moveRows).

export const REVIER_PREFIX = 'Revier '

/** Name im Ordner: wie saubererName der Werkzeuge, dazu getrimmt („Salzburg Stadt“ → „Salzburg-Stadt“). */
export const revierName = (s) =>
  String(s || '')
    .replace(/[^\wäöüÄÖÜß\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
export const revierFolder = (s) => REVIER_PREFIX + revierName(s)
export const isRevierFolder = (name) => String(name || '').startsWith(REVIER_PREFIX)
export const revierOfFolder = (name) => (isRevierFolder(name) ? String(name).slice(REVIER_PREFIX.length) : '')

/**
 * Werkzeuge mit Reviere: Grundordner ab der Bibliothek; nested = Ebenen ohne eigene Objekte, deren
 * Unterordner einzeln umziehen (Wasserzähler: EBG/<Ort>); skip = Ordner, die keine Objekte sind.
 */
export const REVIER_TOOLS = [
  { id: 'zaehler', label: 'Wasserzähler-Ablesung', top: 'Wasserzähler - Ablesung', base: 'Wasserzähler - Ablesung', nested: ['EBG'], skip: ['Stammdaten'] },
  { id: 'kontrolle', label: 'Objektkontrolle', top: 'Objektpruefprotokolle', base: 'Objektpruefprotokolle/Objekte', nested: [], skip: ['Stammdaten'] },
  { id: 'objektmappe', label: 'Objektdoku', top: 'Objektdoku', base: 'Objektdoku', nested: [], skip: ['Stammdaten'] },
]
/** Objektliste der Objektkontrolle: gesamt (alt) und je Revier. */
export const KONTROLLE_LIST = 'Objektpruefprotokolle/Stammdaten/Objekte.json'
export const kontrolleRevierList = (revier) => `Objektpruefprotokolle/Objekte/${revierFolder(revier)}/Stammdaten/Objekte.json`

/**
 * Bekannte Reviere (Anzeigenamen), eindeutig nach Ordnername: aus config.json (access.reviere, auch
 * ein Entwurf) und aus den Objekten der App (region). → [{ name, folder, groups: [IDs] }]
 */
export function knownReviere({ reviere = {}, objects = [] } = {}) {
  const out = new Map()
  const add = (name, groups = []) => {
    const key = revierName(name)
    if (!key) return
    const cur = out.get(key) || { name: String(name).trim(), folder: REVIER_PREFIX + key, groups: [] }
    for (const g of [groups].flat().join(',').split(/[\s,;]+/)) if (g && !cur.groups.includes(g.toLowerCase())) cur.groups.push(g.toLowerCase())
    out.set(key, cur)
  }
  for (const [name, groups] of Object.entries(reviere || {})) add(name, groups)
  for (const o of objects || []) if (o?.region) add(o.region)
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/**
 * Ist die Trennung je Revier eingerichtet? Erst wenn JEDES bekannte Revier eine Gruppe hat – sonst
 * könnten Leute aus einem Revier ohne Gruppe in den Werkzeugen nichts Neues mehr anlegen (auf den
 * Grundordnern haben die Rollen dann nur noch „Lesen“). → { list, missing: [Namen ohne Gruppe], active }
 */
export function revierSetup({ reviere = {}, objects = [] } = {}) {
  const list = knownReviere({ reviere, objects })
  const missing = list.filter((r) => !r.groups.length).map((r) => r.name)
  return { list, missing, active: list.length > 0 && !missing.length }
}

/** Reviere einer Person (nur wenn eingerichtet): alle beim Vollzugriff, sonst die, deren Gruppe sie hat. Anzeigenamen. */
export function reviereFor({ all = false, groups = [], reviere = {}, objects = [] } = {}) {
  const { list, active } = revierSetup({ reviere, objects })
  if (!active) return []
  if (all) return list.map((r) => r.name)
  const mine = new Set(groups.map((g) => String(g).toLowerCase()))
  return list.filter((r) => r.groups.some((g) => mine.has(g))).map((r) => r.name)
}

// ------------------------------------------------ Umzug alter Ordner

const UML = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UML[c])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1)

/**
 * In welches Revier gehört ein alter Ordner? Vergleicht den Ordnernamen (ohne Kennung vor „_“)
 * mit Name, Kurzname und Adresse der Objekte. → { revier, object, score } oder null
 * score 3 = gleich, 2 = enthalten, 1 = die meisten Wörter gleich.
 */
export function suggestRevier(folderName, objects = []) {
  const raw = String(folderName || '')
  const variants = [raw, raw.includes('_') ? raw.slice(raw.indexOf('_') + 1) : ''].map(norm).filter(Boolean)
  let best = null
  for (const o of objects || []) {
    if (!o?.region) continue
    for (const field of [o.name, o.short, o.address]) {
      const f = norm(field)
      if (!f) continue
      for (const v of variants) {
        let score = 0
        if (v === f) score = 3
        else if (Math.min(v.length, f.length) >= 5 && (v.includes(f) || f.includes(v))) score = 2
        else {
          const a = tokens(v)
          const b = new Set(tokens(field))
          const hit = a.filter((t) => b.has(t)).length
          if (a.length && hit / a.length >= 0.6 && hit >= 2) score = 1
        }
        if (score && (!best || score > best.score)) best = { revier: o.region, object: o.name, score }
      }
    }
  }
  return best
}

/**
 * Was umziehen kann: je Werkzeug die Ordner ohne Revier.
 *  listing: { [Grundordner]: [{ name, folder }], [Grundordner/EBG]: [...] } (aus der Ablage)
 * → [{ tool, label, path, name, parent, target, suggestion }] (target ohne Revier, Revier kommt beim Umzug davor)
 */
export function moveRows(listing = {}, objects = []) {
  const rows = []
  for (const t of REVIER_TOOLS) {
    const skip = new Set([...t.skip, ...t.nested])
    for (const c of listing[t.base] || []) {
      if (!c.folder || isRevierFolder(c.name) || skip.has(c.name)) continue
      rows.push({ tool: t.id, label: t.label, path: `${t.base}/${c.name}`, name: c.name, sub: '', suggestion: suggestRevier(c.name, objects) })
    }
    for (const n of t.nested) {
      for (const c of listing[`${t.base}/${n}`] || []) {
        if (!c.folder || isRevierFolder(c.name)) continue
        rows.push({ tool: t.id, label: t.label, path: `${t.base}/${n}/${c.name}`, name: c.name, sub: n, suggestion: suggestRevier(c.name, objects) })
      }
    }
  }
  return rows
}

/** Zielordner (Elternordner) für einen Umzug: <Grundordner>/Revier X[/EBG]. */
export function moveTarget(row, revier) {
  const t = REVIER_TOOLS.find((x) => x.id === row.tool)
  return [t.base, revierFolder(revier), row.sub].filter(Boolean).join('/')
}

/** Objektkontrolle: Kennung des Objekts aus dem Ordnernamen „<objektId>_<objekt>“. */
export const objektIdOfFolder = (name) => (String(name).includes('_') ? String(name).slice(0, String(name).indexOf('_')) : '')

/**
 * Objektliste der Objektkontrolle aufteilen ({ stand, objekte: [...] }): Einträge der umgezogenen
 * Objekt-Ordner („<objektId>_<objekt>“, über die Kennung, sonst über den Objektnamen) in die Liste
 * ihres Reviers, der Rest bleibt in der Gesamtliste. moved: [{ folder, revier }]
 * → { rest, byRevier: { revier: [Einträge mit revier] } }
 */
export function splitObjectList(list = [], moved = []) {
  const byId = new Map()
  const byName = new Map()
  for (const m of moved) {
    const id = objektIdOfFolder(m.folder)
    if (id) byId.set(id, m.revier)
    const name = String(m.folder).includes('_') ? String(m.folder).slice(String(m.folder).indexOf('_') + 1) : String(m.folder)
    if (name) byName.set(revierName(name), m.revier)
  }
  const rest = []
  const byRevier = {}
  for (const e of list || []) {
    const revier = (e?.objektId && byId.get(String(e.objektId))) || byName.get(revierName(e?.objekt))
    if (revier) (byRevier[revier] ||= []).push({ ...e, revier: revierName(revier) })
    else rest.push(e)
  }
  return { rest, byRevier }
}
