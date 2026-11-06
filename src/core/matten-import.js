// Übernahme aus dem bisherigen Werkzeug Mattenwechsel (werkzeuge/mattenwechsel/, Fassung 2.4) in das Modul (P5,
// docs/MATTENWECHSEL-PLAN.md Abschnitt 4.3). Reine Funktionen ohne Browser (test/matten-import.test.js); Oberfläche:
// ui/views/matten-uebernahme.js (Sicherung, Vorschau, Zuordnung von Hand, Übernehmen).
//
// Quellen (werden nur gelesen, nie geschrieben):
//   Mattenwechsel/Stammdaten/Standorte.json   Liegeplätze des Werkzeugs („Standorte“, Array):
//       { id 'L-0001', gebiet, kunde, kundeId, strasse, plz, ort, position, matten [{ anzahl, farbe, groesse, eigentum }],
//         intervallWochen, aktiv, hinweis, quelle, pruefen, pruefGrund, lat, lon }
//   Stammdaten/Kunden.json                     Kundenliste des Werkzeugs (Array oder { kunden }):
//       { id 'K-0001', nr, name, strasse, ort ('PLZ Ort'), mails [], ansprech, telefon, notiz, aktiv, neuerKunde }
//   Mattenwechsel/Touren/<Jahr>/<Ordner>/<Datum>_<TourId>.json   Touren mit Halten { lid, status: 'gewechselt' … }
//
// Abbildung:
//   Werkzeug-Kunde → Kunde der Fakturierung: Vorschlag über die Kundennummer (nr = customerNo), sonst den Namen
//     (Schreibweise und Rechtsform egal, wie im Werkzeug); von Hand änderbar; fehlende werden nur auf Wunsch angelegt.
//   Liegeplätze eines Kunden an derselben Adresse → ein Objekt (vorhandenes App-Objekt mit dieser Adresse, sonst neu);
//     das Objekt wird dem Kunden zugeordnet (customers[].objectIds), wenn es noch keinem gehört.
//   Matte (Größe, Farbe) → Mattentyp (Artikel der Fakturierung mit group 'Matten', Felder size/color oder im Namen);
//     ohne passenden Typ bleibt die Matte mit Größe/Farbe (legacy) stehen und wird in der Vorschau genannt.
//   Intervall Wochen → Tage, Regel „ab dem letzten Wechsel“ (wie im Werkzeug), Gebiet → areas[], legacyId = L-ID,
//   „zu prüfen“ → check, letzter Wechsel = jüngster Halt mit status 'gewechselt' aus allen Touren (lastExchange).
//   Starttermin für den Fälligkeitsrechner (core/matten-plan.js): der letzte Wechsel, ohne Wechsel der Tag der Übernahme
//   (nie gewechselt = sofort fällig, wie im Werkzeug).
//
// Idempotent: Liegeplätze werden über legacyId wiedererkannt; ein zweiter Lauf mit denselben Daten ändert nichts.
// Ein späterer Lauf trägt nur nach: neue Liegeplätze des Werkzeugs, einen jüngeren letzten Wechsel und Mattentypen,
// die inzwischen angelegt sind. Alte Touren und PDFs werden nicht zu Belegen und nicht verrechnet.

import { matTypes, nextCustomerNo } from './invoicing.js'
import { areaByName, customerCopy, customerName, matFromType } from './matten.js'

export const TOOL_PATHS = {
  standorte: 'Mattenwechsel/Stammdaten/Standorte.json',
  kunden: 'Stammdaten/Kunden.json',
  touren: 'Mattenwechsel/Touren',
  sicherung: 'Mattenwechsel/_Sicherung',
}
/** Ordner der Sicherung eines Tages. */
export const backupFolder = (date) => `${TOOL_PATHS.sicherung}/${date}`
/** Tour-Datei des Werkzeugs: <Datum>_<TourId>.json */
export const isTourFile = (name) => /^\d{4}-\d{2}-\d{2}_[^/]+\.json$/i.test(String(name || ''))

const text = (v) => String(v ?? '').trim()

/** Namensschlüssel wie im Werkzeug (namensSchluessel): Groß/klein, Punkte, Unterstriche und Rechtsform egal. */
export function nameKey(n) {
  return String(n || '')
    .toLowerCase()
    .replace(/[_.]/g, ' ')
    .replace(/\b(gmbh|ges\s?m\s?b\s?h|ag|kg|og|e\s?u|gesellschaft|co|mbh)\b/g, ' ')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
}

/** Liste aus einer Werkzeug-Datei: Array oder { [key]: Array }. */
export const toolList = (raw, key) => (Array.isArray(raw) ? raw : Array.isArray(raw?.[key]) ? raw[key] : [])

/**
 * Werkzeug-Daten aus hochgeladenen Dateien (Browser-Modus): Standorte.json, Kunden.json, Tour-Dateien oder die
 * Sicherung „Alles sichern“ des Werkzeugs ({ db: { standorte, kunden, touren } }). files: [{ name, json }].
 */
export function toolDataFromFiles(files = []) {
  const out = { standorte: [], kunden: [], touren: [] }
  const tours = new Map()
  const addTour = (t) => {
    if (!t?.id || !Array.isArray(t.halte)) return
    const old = tours.get(t.id)
    if (!old || String(t.geaendert || '') > String(old.geaendert || '')) tours.set(t.id, t)
  }
  for (const { json } of files) {
    if (!json) continue
    if (json.db && typeof json.db === 'object') {
      if (Array.isArray(json.db.standorte) && json.db.standorte.length) out.standorte = json.db.standorte
      if (Array.isArray(json.db.kunden) && json.db.kunden.length) out.kunden = json.db.kunden
      for (const t of json.db.touren || []) addTour(t)
      continue
    }
    if (Array.isArray(json.halte)) {
      addTour(json)
      continue
    }
    const list = Array.isArray(json) ? json : Array.isArray(json.kunden) ? json.kunden : null
    if (!list?.length) continue
    if (list.some((x) => Array.isArray(x?.matten) || 'intervallWochen' in (x || {}) || /^L-/.test(x?.id || ''))) out.standorte = list
    else if (list.some((x) => Array.isArray(x?.mails) || /^K-/.test(x?.id || '') || 'nr' in (x || {}))) out.kunden = list
  }
  out.touren = [...tours.values()]
  return out
}

// ---------------------------------------------------------------- Adressen, Kunden, Matten

const streetNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/stra(ss)?e\b/g, 'str')
    .replace(/str\./g, 'str')
    .replace(/[^a-z0-9äöü]+/g, ' ')
    .trim()
/** Anschrift eines Werkzeug-Liegeplatzes in einer Zeile: „Straße 1, 5020 Salzburg“. */
export const toolAddress = (s = {}) => [text(s.strasse), [text(s.plz), text(s.ort)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
/** Schlüssel der Adresse (Schreibweise egal). */
export const addressKey = (s = {}) => [streetNorm(s.strasse), text(s.plz), streetNorm(s.ort)].join('|')

/**
 * Werkzeug-Kunde eines Liegeplatzes wie im Werkzeug (kundeZuStandort): über kundeId, sonst über den Namen.
 * kunden: Kundenliste des Werkzeugs. Liefert den Kunden oder null.
 */
export function toolCustomerOf(s, kunden = []) {
  return (s.kundeId && kunden.find((k) => k?.id === s.kundeId)) || (nameKey(s.kunde) && kunden.find((k) => k?.id && nameKey(k.name) === nameKey(s.kunde))) || null
}
/** Kundenschlüssel eines Werkzeug-Liegeplatzes: „id:K-0001“ (Kunde der Liste), sonst „name:<Namensschlüssel>“. */
export function toolCustomerKey(s, kunden = []) {
  const k = toolCustomerOf(s, kunden)
  return k ? `id:${k.id}` : `name:${nameKey(s.kunde)}`
}

/** Größe als Schlüssel: „85 x 150 cm“ → „85x150“ (kleinere Zahl zuerst); ohne zwei Zahlen ''. */
export function sizeKey(s) {
  const m = String(s || '').match(/(\d{2,3})\s*[x×*/]\s*(\d{2,3})/i)
  if (!m) return ''
  const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y)
  return `${a}x${b}`
}
/** Farbe als Schlüssel (Groß/klein und Leerzeichen egal, „Grau / Schwarz“ = „grau/schwarz“). */
export const colorKey = (s) => String(s || '').toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim()
/** Schlüssel einer Werkzeug-Matte: Größe und Farbe. */
export const matKey = (m = {}) => `${sizeKey(m.groesse) || colorKey(m.groesse) || '-'}|${colorKey(m.farbe) || '-'}`

const COLOR_WORDS = ['grau/schwarz', 'navy', 'grau', 'schwarz', 'rot', 'blau', 'braun', 'grün', 'beige', 'anthrazit', 'sonderfarbe']
/** Größe und Farbe eines Mattentyps: aus size/color, sonst aus Name und Text. */
function articleKeys(a) {
  const blob = `${a.name || ''} ${a.text || ''}`
  const size = sizeKey(a.size) || sizeKey(blob)
  const low = colorKey(blob)
  const color = colorKey(a.color) || COLOR_WORDS.find((w) => new RegExp(`(^|[^a-zäöü/])${w.replace('/', '\\s*/\\s*')}($|[^a-zäöü/])`).test(low)) || ''
  return { size, color }
}

/**
 * Passender Mattentyp für eine Werkzeug-Matte { groesse, farbe }: gleiche Größe und Farbe; gibt es in der Größe nur
 * einen Typ ohne Farbe, dieser. → { id, how: 'Größe und Farbe' | 'Größe' } oder null.
 */
export function matchArticle(articles = [], mat = {}) {
  const size = sizeKey(mat.groesse)
  if (!size) return null
  const color = colorKey(mat.farbe)
  const same = matTypes(articles)
    .map((a) => ({ a, ...articleKeys(a) }))
    .filter((x) => x.size === size)
  const standard = (x) => !x.a.matKind || x.a.matKind === 'Standard'
  const exact = same.filter((x) => color && x.color === color).sort((x, y) => Number(standard(y)) - Number(standard(x)))
  if (exact.length) return { id: exact[0].a.id, how: 'Größe und Farbe' }
  const plain = same.filter((x) => !x.color)
  if (plain.length === 1) return { id: plain[0].a.id, how: 'Größe' }
  return null
}

/** Letzter bestätigter Wechsel je Liegeplatz aus allen Touren: { 'L-0001': { date, tourId } }. */
export function lastExchanges(touren = []) {
  const out = {}
  for (const t of touren) {
    const date = text(t?.datum)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    for (const h of t.halte || []) {
      if (h?.status !== 'gewechselt' || !h.lid) continue
      if (!out[h.lid] || date > out[h.lid].date) out[h.lid] = { date, tourId: text(t.id) }
    }
  }
  return out
}

/** ‚PLZ Ort‘ aus der Kundenliste des Werkzeugs trennen. */
const splitPlace = (ort) => {
  const m = /^(\d{4,5})\s+(.+)$/.exec(text(ort))
  return m ? { zip: m[1], city: m[2] } : { zip: '', city: text(ort) }
}

// ---------------------------------------------------------------- Vorschau

/**
 * Vorschau der Übernahme. tool: { standorte, kunden, touren }; customers/objects/articles/doc: Stand der App;
 * choices: Zuordnung von Hand { customers: { key: id | 'neu' | '' }, objects: { key: id | 'neu' }, mats: { key: id | '' } }.
 * Ohne Wahl gilt der Vorschlag (Kunden ohne Vorschlag: nicht übernehmen; Objekte ohne Vorschlag: neu anlegen).
 */
export function planImport({ tool = {}, customers = [], objects = [], articles = [], doc = {}, choices = {} }) {
  const standorte = toolList(tool.standorte, 'standorte').filter((s) => s && s.id)
  const kunden = toolList(tool.kunden, 'kunden').filter((k) => k && typeof k === 'object')
  const placements = doc.placements || []
  const byLegacy = new Map(placements.filter((p) => p.legacyId).map((p) => [p.legacyId, p]))
  const last = lastExchanges(tool.touren || [])
  const custById = new Map(customers.map((c) => [c.id, c]))
  const objById = new Map(objects.map((o) => [o.id, o]))
  const ch = { customers: choices.customers || {}, objects: choices.objects || {}, mats: choices.mats || {} }

  // Kunden des Werkzeugs (nur die mit Liegeplätzen)
  const custGroups = new Map()
  for (const s of standorte) {
    const key = toolCustomerKey(s, kunden)
    if (!custGroups.has(key)) {
      const k = toolCustomerOf(s, kunden)
      custGroups.set(key, { key, name: text(k?.name) || text(s.kunde) || 'ohne Kundennamen', nr: text(k?.nr), kunde: k, lids: [] })
    }
    custGroups.get(key).lids.push(s.id)
  }
  const custRows = [...custGroups.values()]
    .map((g) => {
      const done = g.lids.map((id) => byLegacy.get(id)).find((p) => p?.customerId && custById.has(p.customerId))
      let suggestion = null
      if (done) suggestion = { id: done.customerId, how: 'schon übernommen' }
      else if (g.nr) {
        const c = customers.find((x) => text(x.customerNo) && text(x.customerNo).toLowerCase() === g.nr.toLowerCase())
        if (c) suggestion = { id: c.id, how: 'Kundennummer' }
      }
      if (!suggestion && nameKey(g.name)) {
        const c = customers.find((x) => nameKey(customerName(x)) === nameKey(g.name))
        if (c) suggestion = { id: c.id, how: 'Name' }
      }
      const raw = g.key in ch.customers ? ch.customers[g.key] : suggestion?.id || ''
      const choice = raw === 'neu' || custById.has(raw) ? raw : ''
      return { ...g, count: g.lids.length, suggestion, choice }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const custChoice = new Map(custRows.map((r) => [r.key, r.choice]))

  // Objekte: je Kunde und Adresse
  const objGroups = new Map()
  for (const s of standorte) {
    const ck = toolCustomerKey(s, kunden)
    const key = `${ck}#${addressKey(s)}`
    if (!objGroups.has(key)) objGroups.set(key, { key, customerKey: ck, addressKey: addressKey(s), street: text(s.strasse), plz: text(s.plz), ort: text(s.ort), address: toolAddress(s), lids: [], lat: null, lon: null })
    const g = objGroups.get(key)
    g.lids.push(s.id)
    if (g.lat === null && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) && s.lat !== null && s.lat !== '' && s.lon !== null && s.lon !== '') {
      g.lat = Number(s.lat)
      g.lon = Number(s.lon)
    }
  }
  const sharedAddress = new Map()
  for (const g of objGroups.values()) sharedAddress.set(g.addressKey, (sharedAddress.get(g.addressKey) || 0) + 1)
  const objRows = [...objGroups.values()]
    .map((g) => {
      const done = g.lids.map((id) => byLegacy.get(id)).find((p) => p?.objectId && objById.has(p.objectId))
      let suggestion = done ? { id: done.objectId, how: 'schon übernommen' } : null
      if (!suggestion && g.street) {
        const street = streetNorm(g.street)
        const re = new RegExp(`(^| )${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`)
        const hit = objects.find((o) => {
          const a = streetNorm(o.address)
          return re.test(a) && (!g.plz || a.includes(g.plz))
        })
        if (hit) suggestion = { id: hit.id, how: 'Adresse' }
      }
      const raw = g.key in ch.objects ? ch.objects[g.key] : suggestion?.id || 'neu'
      const choice = raw === 'neu' || objById.has(raw) ? raw : 'neu'
      const cust = custRows.find((c) => c.key === g.customerKey)
      const ownerOf = choice !== 'neu' ? customers.find((c) => (c.objectIds || []).includes(choice)) : null
      const target = custChoice.get(g.customerKey)
      const conflict = ownerOf && target && target !== 'neu' && ownerOf.id !== target ? customerName(ownerOf) : ''
      const name = [g.street || 'Objekt', g.ort].filter(Boolean).join(', ') + (sharedAddress.get(g.addressKey) > 1 && cust ? ` – ${cust.name}` : '')
      return { ...g, count: g.lids.length, customerName: cust?.name || '', suggestion, choice, newName: name, conflict }
    })
    .sort((a, b) => a.customerName.localeCompare(b.customerName, 'de') || a.address.localeCompare(b.address, 'de'))

  // Matten: je Größe und Farbe
  const matGroups = new Map()
  for (const s of standorte)
    for (const m of s.matten || []) {
      const key = matKey(m)
      if (!matGroups.has(key)) matGroups.set(key, { key, groesse: text(m.groesse), farbe: text(m.farbe), qty: 0, lids: new Set() })
      const g = matGroups.get(key)
      g.qty += Math.max(0, Math.round(Number(m.anzahl) || 0))
      g.lids.add(s.id)
    }
  const typeIds = new Set(matTypes(articles).map((a) => a.id))
  const matRows = [...matGroups.values()]
    .map((g) => {
      const suggestion = matchArticle(articles, g)
      const raw = g.key in ch.mats ? ch.mats[g.key] : suggestion?.id || ''
      return { ...g, lids: [...g.lids], count: g.lids.size, suggestion, choice: typeIds.has(raw) ? raw : '' }
    })
    .sort((a, b) => (sizeKey(a.groesse) || a.groesse).localeCompare(sizeKey(b.groesse) || b.groesse, 'de', { numeric: true }) || a.farbe.localeCompare(b.farbe, 'de'))
  const matChoice = new Map(matRows.map((r) => [r.key, r.choice]))

  // Liegeplätze
  const objChoice = new Map(objRows.map((r) => [r.key, r.choice]))
  const rows = standorte.map((s) => {
    const ck = toolCustomerKey(s, kunden)
    const existing = byLegacy.get(s.id) || null
    const lastEx = last[s.id] || null
    const base = { lid: s.id, standort: s, customerKey: ck, objectKey: `${ck}#${addressKey(s)}`, last: lastEx, existing }
    if (existing) {
      const newer = lastEx && (!existing.lastExchange?.date || lastEx.date > existing.lastExchange.date)
      const fill = (existing.mats || []).some((m) => !m.articleId && m.legacy && matChoice.get(matKey(m.legacy)))
      return { ...base, action: newer || fill ? 'aktualisieren' : 'gleich', newer: !!newer, fill }
    }
    if (!custChoice.get(ck)) return { ...base, action: 'ohne-kunde' }
    return { ...base, action: 'neu', missingType: (s.matten || []).some((m) => !matChoice.get(matKey(m))) }
  })
  const areasNeeded = [...new Set(rows.filter((r) => r.action === 'neu').map((r) => text(r.standort.gebiet)).filter(Boolean))]
  const areas = areasNeeded.map((name) => ({ name, existing: areaByName(doc, name)?.id || null }))
  const counts = {
    standorte: standorte.length,
    neu: rows.filter((r) => r.action === 'neu').length,
    aktualisieren: rows.filter((r) => r.action === 'aktualisieren').length,
    gleich: rows.filter((r) => r.action === 'gleich').length,
    ohneKunde: rows.filter((r) => r.action === 'ohne-kunde').length,
    pruefen: rows.filter((r) => r.action === 'neu' && r.standort.pruefen).length,
    ohneTyp: rows.filter((r) => r.action === 'neu' && r.missingType).length,
    touren: (tool.touren || []).length,
    wechsel: Object.keys(last).length,
    neueKunden: custRows.filter((r) => r.choice === 'neu' && rows.some((x) => x.action === 'neu' && x.customerKey === r.key)).length,
    neueObjekte: objRows.filter((r) => r.choice === 'neu' && rows.some((x) => x.action === 'neu' && x.objectKey === r.key)).length,
    neueGebiete: areas.filter((a) => !a.existing).length,
  }
  return { customers: custRows, objects: objRows, mats: matRows, missingTypes: matRows.filter((r) => !r.choice), areas, rows, counts, changes: counts.neu + counts.aktualisieren }
}

// ---------------------------------------------------------------- Übernehmen

/**
 * Übernahme ausführen (nach planImport mit denselben Daten). Ändert nichts an den Eingaben, sondern liefert neue Stände:
 * { doc, customers, objects, summary: { placements, updated, customers, objects, areas, links } }.
 * newId(prefix): zufällige ID; now/user: Vermerk; today: Starttermin übernommener Liegeplätze ohne letzten Wechsel.
 */
export function applyImport(plan, { doc = {}, customers = [], objects = [], articles = [], newId, now, user = '', today = String(now || '').slice(0, 10) }) {
  const out = { doc: structuredClone(doc), customers: structuredClone(customers), objects: structuredClone(objects) }
  out.doc.placements ||= []
  out.doc.areas ||= []
  const summary = { placements: 0, updated: 0, customers: 0, objects: 0, areas: 0, links: 0 }
  if (!plan.changes) return { ...out, summary }
  const artById = new Map(matTypes(articles).map((a) => [a.id, a]))
  const matChoice = new Map(plan.mats.map((r) => [r.key, r.choice]))
  const stamp = { createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }
  const needed = new Set(plan.rows.filter((r) => r.action === 'neu').flatMap((r) => [r.customerKey, r.objectKey]))

  // Kunden: gewählt oder neu (nur, wenn ein neuer Liegeplatz ihn braucht)
  const custId = new Map()
  for (const r of plan.customers) {
    if (!r.choice) continue
    if (r.choice !== 'neu') {
      custId.set(r.key, r.choice)
      continue
    }
    if (!needed.has(r.key)) continue
    const k = r.kunde || {}
    const place = splitPlace(k.ort)
    const mails = (k.mails || []).map(text).filter(Boolean)
    const c = {
      id: newId('c'),
      name: r.name,
      customerNo: r.nr && !out.customers.some((x) => text(x.customerNo) === r.nr) ? r.nr : nextCustomerNo(out.customers),
      street: text(k.strasse),
      zip: place.zip,
      city: place.city,
      country: 'AT',
      email: '',
      ...(mails.length ? { deliveryNoteEmail: mails.join(', ') } : {}),
      contacts: text(k.ansprech) || text(k.telefon) ? [{ id: newId('cp'), name: text(k.ansprech), role: 'Ansprechperson', email: '', phone: text(k.telefon) }] : [],
      note: text(k.notiz),
      objectIds: [],
      reverseCharge: false,
      consumer: false,
      createdAt: now,
      source: { system: 'mattenwechsel', id: text(k.id) },
    }
    out.customers.push(c)
    custId.set(r.key, c.id)
    summary.customers++
  }
  const custOf = (key) => out.customers.find((c) => c.id === custId.get(key)) || null

  // Objekte: gewählt oder neu (nur für neue Liegeplätze)
  const objId = new Map()
  for (const r of plan.objects) {
    if (r.choice !== 'neu') {
      objId.set(r.key, r.choice)
      continue
    }
    if (!needed.has(r.key) || !custId.get(r.customerKey)) continue
    const o = {
      id: newId('o'),
      name: r.newName,
      short: (r.street || r.ort || 'Objekt').split(/[\s,]+/)[0].slice(0, 14),
      address: r.address,
      ...(r.lat !== null ? { lat: r.lat, lon: r.lon } : {}),
      source: { system: 'mattenwechsel', key: r.addressKey },
    }
    out.objects.push(o)
    objId.set(r.key, o.id)
    summary.objects++
  }
  // Objekt dem Kunden zuordnen, wenn es noch keinem gehört (ein Objekt gehört genau einem Kunden)
  for (const r of plan.objects) {
    const oid = objId.get(r.key)
    const c = custOf(r.customerKey)
    if (!oid || !c || !needed.has(r.key)) continue
    if (out.customers.some((x) => (x.objectIds || []).includes(oid))) continue
    c.objectIds = [...(c.objectIds || []), oid]
    summary.links++
  }

  // Gebiete
  for (const a of plan.areas) {
    if (areaByName(out.doc, a.name)) continue
    out.doc.areas.push({ id: newId('mg'), name: a.name, active: true, legacyName: a.name, ...stamp })
    summary.areas++
  }

  const matOf = (m) => {
    const legacy = { groesse: text(m.groesse), farbe: text(m.farbe) }
    const qty = Math.max(0, Math.round(Number(m.anzahl) || 0))
    const owner = m.eigentum === 'kunde' ? 'kunde' : 'wir'
    const a = artById.get(matChoice.get(matKey(m)))
    if (a) return { ...matFromType(a, { owner }), qty }
    return { articleId: '', qty, owner, name: [legacy.groesse, legacy.farbe].filter(Boolean).join(' ') || 'Matte', legacy }
  }

  for (const r of plan.rows) {
    if (r.action === 'aktualisieren') {
      const p = out.doc.placements.find((x) => x.id === r.existing.id)
      if (!p) continue
      if (r.newer) p.lastExchange = { date: r.last.date, tourId: r.last.tourId, source: 'werkzeug' }
      if (r.fill)
        p.mats = (p.mats || []).map((m) => {
          const a = !m.articleId && m.legacy && artById.get(matChoice.get(matKey(m.legacy)))
          return a ? { ...matFromType(a, { owner: m.owner }), qty: m.qty } : m
        })
      p.updatedAt = now
      p.updatedBy = user
      summary.updated++
      continue
    }
    if (r.action !== 'neu') continue
    const s = r.standort
    const c = custOf(r.customerKey)
    const objectId = objId.get(r.objectKey)
    if (!c || !objectId) continue
    const obj = out.objects.find((o) => o.id === objectId)
    const area = text(s.gebiet) ? areaByName(out.doc, s.gebiet) : null
    const mats = (s.matten || []).map(matOf)
    const reasons = [s.pruefen ? text(s.pruefGrund) || 'im Werkzeug als „zu prüfen“ markiert' : '', mats.some((m) => !m.qty) ? 'Stückzahl fehlt' : ''].filter(Boolean)
    const hasCoords = Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) && s.lat !== null && s.lat !== '' && s.lon !== null && s.lon !== ''
    const coords = hasCoords ? { lat: Number(s.lat), lon: Number(s.lon), geoQuality: 'werkzeug' } : Number.isFinite(obj?.lat) && Number.isFinite(obj?.lon) ? { lat: obj.lat, lon: obj.lon, geoQuality: 'objekt' } : {}
    out.doc.placements.push({
      id: newId('mw'),
      legacyId: s.id,
      objectId,
      customerId: c.id,
      customer: customerCopy(c),
      name: text(s.position) || 'Liegeplatz',
      floor: '',
      access: '',
      hint: text(s.hinweis),
      active: s.aktiv !== false,
      mats,
      intervalDays: Math.max(1, Math.round(Number(s.intervallWochen) || 4)) * 7,
      // ab dem letzten Wechsel (wie im Werkzeug); Starttermin = letzter Wechsel, ohne Wechsel heute (sofort fällig)
      startDate: r.last?.date || today,
      rule: 'ab-ist',
      pauses: [],
      areaId: area?.id || '',
      ...coords,
      ...(r.last ? { lastExchange: { date: r.last.date, tourId: r.last.tourId, source: 'werkzeug' } } : {}),
      ...(reasons.length ? { check: { reason: reasons.join('; ') } } : {}),
      source: { system: 'mattenwechsel', quelle: text(s.quelle) },
      ...stamp,
    })
    summary.placements++
  }
  return { ...out, summary }
}
