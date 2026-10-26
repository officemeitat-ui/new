// Übernahme aus den bisherigen Werkzeugen, deren Daten schon in SharePoint
// liegen (gemeinsame Bibliothek, z. B. „<Firma>_Daten“):
//   Wasserzähler - Ablesung/…/Ablesung_<Ort>_<Jahr>.json     → Zählerstände (core/meters.js)
//   Objektpruefprotokolle/Stammdaten/Kunden.json, Objekte.json → Kundenstamm, Objekte, Objektmappe
//   Objektpruefprotokolle/Objekte/<Objekt>/<Begehung>/*.json   → Objektkontrolle
//   Objektdoku/<Nr>_<Name>/<Nr>.json                          → Objektmappe
//
// Die Dateien werden erkannt, egal ob sie direkt aus SharePoint gelesen oder
// als Datei gewählt werden. IDs der alten Werkzeuge bleiben erhalten: ein
// zweiter Abgleich ersetzt, statt zu verdoppeln.

import { findWaterLists, importWaterLists } from './meters.js'
import { importCustomers, LV_INTERVALS } from './objektmappe.js'

/** Ordner der Werkzeuge in der Bibliothek (config.json → sharepoint.sources). */
export const LEGACY_SOURCES = {
  wasserzaehler: 'Wasserzähler - Ablesung',
  pruefprotokoll: 'Objektpruefprotokolle',
  objektdoku: 'Objektdoku',
}

// ß → ss vor dem Entfernen der Sonderzeichen („Straße“ = „Strasse“)
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const slug = (s) => norm(s).slice(0, 40) || 'x'
const str = (v) => (v === undefined || v === null ? '' : String(v).trim())

// ---------------------------------------------------------------- Erkennen

/**
 * JSON-Inhalte nach Art sortieren. files: [{ path, data }]
 * Liefert { water: [Liste], customers: [Kunde], objects: [Objekt aus Objekte.json], inspections: [{ path, data }], akten: [{ path, data }] }
 */
export function classifyLegacy(files) {
  const out = { water: [], customers: [], objects: [], inspections: [], akten: [], templates: [], unknown: [] }
  for (const { path = '', data } of files) {
    if (!data || typeof data !== 'object') continue
    const water = findWaterLists(data)
    if (water.length) {
      out.water.push(...water)
      continue
    }
    if (/vorlagen/i.test(path) || / Objektdokumentation$/.test(str(data.werkzeug))) {
      out.templates.push(...convertTemplates(data))
      continue
    }
    const list = Array.isArray(data) ? data : null
    if (list && list.length && list.every((x) => x && (x.objektId !== undefined || x.objekt !== undefined) && (x.kunde !== undefined || x.kundenNr !== undefined))) out.objects.push(...list)
    else if (list && list.length && list.every((x) => x && x.nr !== undefined && x.name !== undefined)) out.customers.push(...importCustomers(JSON.stringify(list)))
    else if (/kunden/i.test(path) && (Array.isArray(data.kunden) || list)) out.customers.push(...importCustomers(JSON.stringify(data)))
    else if (!list && data.items && (data.meta || data.kontrollart || data.pruefer !== undefined)) out.inspections.push({ path, data })
    else if (!list && (Array.isArray(data.bereiche) || Array.isArray(data.personen) || Array.isArray(data.schluesselListe) || /^LV-/.test(data.id || ''))) out.akten.push({ path, data })
    else out.unknown.push(path)
  }
  return out
}

// ---------------------------------------------------------------- Objekte zuordnen

/**
 * Objekt zu Nummer, Name oder Adresse finden; sonst neu anlegen (in `created`).
 * mappe: app.data.mappe.objects (für Objekt-Nr. und Kunde)
 */
export function objectResolver(objects, mappe = {}) {
  const all = [...objects]
  const created = []
  const resolve = ({ objectNo, name, address, customer, prefix = 'o-alt' }) => {
    const nr = norm(objectNo)
    const byNo = nr && all.find((o) => norm(mappe[o.id]?.objectNo) === nr || norm(o.legacyNo) === nr)
    const byName = byNo || all.find((o) => name && norm(o.name) === norm(name)) || all.find((o) => address && norm(o.name) === norm(address))
    const hit = byName || (name && all.find((o) => norm(o.address) && norm(o.address) === norm(address) && norm(o.name).includes(norm(name).slice(0, 8))))
    if (hit) return hit
    const label = name || address || objectNo || 'Objekt'
    let id = `${prefix}-${slug(objectNo || label)}`
    while (all.some((o) => o.id === id)) id += 'x'
    const obj = { id, name: label, short: label.slice(0, 18), address: address || '', region: '', color: ((all.length + 5) % 12) + 1, onlyTrained: false, keys: [], ...(objectNo ? { legacyNo: str(objectNo) } : {}), ...(customer ? { customer } : {}) }
    all.push(obj)
    created.push(obj)
    return obj
  }
  return { resolve, created }
}

// ---------------------------------------------------------------- Objektkontrolle

const RATING = { OK: 'OK', R: 'R', M: 'M', G: 'G', NA: 'NA', 'N/A': 'NA' }
const OVERALL = { 'sehr gut': 'Sehr gut', gut: 'Gut', handlungsbedarf: 'Handlungsbedarf', kritisch: 'Kritisch' }

/** Ein Protokoll des Prüfprotokoll-Tools → Kontrolle. photoDir: Ordner der Begehung in der Bibliothek (für Fotos). */
export function convertInspection(json, { objectId, checklistId, photoDir = '', photoUrl = null }) {
  const items = {}
  for (const [id, it] of Object.entries(json.items || {})) {
    const rating = RATING[it.b] || RATING[str(it.b).toUpperCase()]
    if (!rating) continue
    const files = it.fotoDateien || []
    const photos = files.map((name) => {
      const path = `${photoDir}/Fotos/${name}`
      return { path, root: true, name, ...(photoUrl ? { url: photoUrl(path) } : {}) }
    })
    // eingebettete Fotos nur, wenn es keine Dateien gibt (sonst bleibt die Datei klein)
    if (!photos.length) for (const data of it.fotos || []) if (/^data:image\//.test(data)) photos.push({ data })
    items[id] = { rating, ...(it.bem ? { note: str(it.bem) } : {}), ...(it.prio && rating !== 'OK' && rating !== 'NA' ? { prio: str(it.prio) } : {}), ...(photos.length ? { photos } : {}), ...(it.erledigt ? { done: { at: json.geaendert || json.abgeschlossen || '', by: 'Prüfprotokoll-Tool' } } : {}) }
  }
  const a = json.abschluss || {}
  const overall = OVERALL[str(a.gesamt).toLowerCase()]
  const sig = (s) => (s?.data ? { name: str(s.name), image: { data: s.data }, at: s.zeit || '' } : s?.name ? { name: str(s.name) } : undefined)
  return {
    id: str(json.id) || `k-alt-${slug(objectId)}-${json.datum}`,
    objectId,
    checklistId,
    date: json.datum,
    time: str(json.zeit),
    inspector: str(json.pruefer),
    kind: str(json.kontrollart) || 'Regelkontrolle',
    status: json.status === 'abgeschlossen' ? 'abgeschlossen' : 'offen',
    ...(json.abgeschlossen ? { closedAt: json.abgeschlossen } : {}),
    items,
    summary: {
      ...(overall ? { overall } : {}),
      ...(a.zusammenfassung ? { text: str(a.zusammenfassung) } : {}),
      ...(/^ja$/i.test(str(a.nachkontrolle)) ? { followUp: true, ...(a.nachtermin ? { followUpDate: a.nachtermin } : {}) } : {}),
    },
    signatures: Object.fromEntries([['inspector', sig(json.sig?.pruefer)], ['customer', sig(json.sig?.kunde)]].filter(([, v]) => v)),
    ...(json.gesendet?.length ? { sent: json.gesendet.map((g) => ({ to: g.an || [], cc: g.cc || [], bcc: g.bcc || [], at: g.zeit || '' })) } : {}),
    createdAt: json.erstellt || '',
    source: 'pruefprotokoll',
  }
}

// ---------------------------------------------------------------- Objektdoku

/** Häufigkeit des Objektdoku-Tools: gleiche Kennungen; Unbekanntes wird wie dort zu „w1“. */
export const mapInterval = (code) => (LV_INTERVALS[str(code).toLowerCase()] ? str(code).toLowerCase() : 'w1')

/**
 * Eine Akte des Objektdoku-Tools → Eintrag der Objektmappe. Felder können
 * fehlen (das Werkzeug füllt sie erst beim Laden auf). photoDir: Ordner der
 * Akte in der Bibliothek, Fotos liegen in <photoDir>/Fotos/<datei>.
 */
export function convertAkte(a, { photoDir = '', photoUrl = null } = {}) {
  const list = (v) => (Array.isArray(v) ? v : [])
  const num = (v) => (v === undefined || v === null || v === '' ? '' : Number(String(v).replace(',', '.')) || '')
  const photoRef = (datei) => {
    const path = `${photoDir}/Fotos/${datei}`
    return { path, root: true, name: datei, ...(photoUrl ? { url: photoUrl(path) } : {}) }
  }
  const contacts = list(a.personen).map((p) => ({ name: str(p.name), role: str(p.rolle), phone: str(p.telefon), mail: str(p.mail), note: str(p.bemerkung), internal: !!p.intern }))
  if (!contacts.length && (a.ansprech || a.telefon)) contacts.push({ name: str(a.ansprech), role: 'Ansprechpartner', phone: str(a.telefon), mail: '', note: '', internal: false })
  return {
    ...(a.kundeNr ? { customerNo: str(a.kundeNr) } : {}),
    ...(a.kunde ? { customer: str(a.kunde) } : {}),
    ...(a.kundenMail ? { customerEmail: str(a.kundenMail) } : {}),
    ...(a.objektId ? { objectNo: str(a.objektId) } : {}),
    ...(a.objektart ? { kind: str(a.objektart) } : {}),
    ...(a.strasse || a.plz || a.ort ? { street: [str(a.strasse), [str(a.plz), str(a.ort)].filter(Boolean).join(' ')].filter(Boolean).join(', ') } : {}),
    ...(a.vertrag ? { contract: str(a.vertrag) } : {}),
    ...(a.gueltigAb ? { validFrom: str(a.gueltigAb) } : {}),
    ...(a.hinweise ? { notes: str(a.hinweise) } : {}),
    ...(a.zeitHinweis ? { timeNote: str(a.zeitHinweis) } : {}),
    ...(a.objektleitung ? { manager: str(a.objektleitung) } : {}),
    ...(a.vertretung ? { deputy: str(a.vertretung) } : {}),
    ...(list(a.einsatzTage).length ? { serviceDays: list(a.einsatzTage) } : {}),
    ...(list(a.zeitfenster).length ? { timeWindows: list(a.zeitfenster).map((z) => ({ days: Array.isArray(z.tage) ? z.tage.join(', ') : str(z.tage), from: str(z.von), to: str(z.bis), note: str(z.hinweis) })) } : {}),
    contacts,
    access: list(a.schluesselListe).map((k) => ({ label: str(k.bezeichnung), number: str(k.nummer), type: str(k.art) || 'Schlüssel', count: Number(k.anzahl) || 1, place: [str(k.lage), k.ausgabeAn ? `ausgegeben an ${str(k.ausgabeAn)}` : ''].filter(Boolean).join(' · '), note: str(k.bemerkung), confidential: k.vertraulich !== false })),
    devices: list(a.geraete).map((g) => ({ label: str(g.bezeichnung), place: str(g.standort), inventoryNo: str(g.inventarnr), owner: /kunde/i.test(g.eigentum) ? 'Kunde' : /miet/i.test(g.eigentum) ? 'gemietet' : 'eigen', condition: [str(g.zustand), str(g.bemerkung)].filter(Boolean).join(' · ') })),
    attachments: list(a.anhaenge).map((x) => ({ name: str(x.name), url: /^https:\/\//.test(str(x.quelle)) ? str(x.quelle) : '', ...(x.art ? { kind: str(x.art) } : {}), ...(x.datum ? { date: str(x.datum) } : {}), note: [/^https:\/\//.test(str(x.quelle)) ? '' : str(x.quelle), str(x.bemerkung)].filter(Boolean).join(' · ') })),
    areas: list(a.bereiche).map((b) => ({
      name: str(b.name),
      location: str(b.lage),
      size: num(b.flaeche),
      floor: str(b.boden),
      ...(b.bemerkung ? { note: str(b.bemerkung) } : {}),
      services: list(b.leistungen).map((l) => ({ what: str(l.was), interval: mapInterval(l.intervall), minutes: num(l.min), method: str(l.methode), ...(l.bemerkung ? { note: str(l.bemerkung) } : {}), ...(list(l.tage).length ? { days: l.tage } : {}) })),
      rooms: list(b.raeume).map((r) => ({ no: str(r.nr), name: str(r.name), size: num(r.flaeche), floor: str(r.boden), note: str(r.bemerkung) })),
    })),
    photos: list(a.fotos).filter((f) => f.datei || /^data:image\//.test(f.daten || '')).map((f, i) => ({ id: str(f.id) || `F-${i + 1}`, kind: f.art === 'zugang' ? 'zugang' : 'ablauf', area: str(f.bereich), title: str(f.titel), text: str(f.beschreibung), date: str(f.datum), photo: f.datei ? photoRef(f.datei) : { data: f.daten } })),
    ...(a.geprueftAm ? { checkedAt: str(a.geprueftAm), ...(a.geprueftVon ? { checkedBy: str(a.geprueftVon) } : {}) } : {}),
    ...(list(a.verlauf).length ? { history: list(a.verlauf).slice(0, 50).map((v) => ({ version: Number(v.fassung) || 0, at: str(v.zeit), by: str(v.wer), reason: str(v.anlass), ...(v.daten ? { data: convertAkte({ ...v.daten, verlauf: [], fotos: [] }) } : {}) })) } : {}),
    ...(list(a.versandt).length ? { sent: list(a.versandt).map((x) => ({ at: str(x.zeit), to: str(x.an), cc: str(x.cc), bcc: str(x.bcc), subject: str(x.betreff), file: str(x.datei), via: str(x.weg) })) } : {}),
    ...(a.fassung ? { version: Number(a.fassung) || 0 } : {}),
    legacyId: str(a.id),
    source: 'objektdoku',
  }
}

/** Bereichsvorlagen (Vorlagen.json des Objektdoku-Tools oder eingebaut) → Vorlagen der Objektmappe. */
export function convertTemplates(json) {
  const list = Array.isArray(json) ? json : json?.vorlagen || []
  return list
    .filter((v) => v && v.name && !v.geloescht)
    .map((v) => ({ id: str(v.id) || `V-${slug(v.name)}`, name: str(v.name), floor: str(v.boden), note: str(v.bemerkung), services: (v.leistungen || []).map((l) => ({ what: str(l.was), interval: mapInterval(l.intervall), minutes: l.min === '' || l.min === undefined ? '' : Number(l.min) || '', method: str(l.methode), ...(l.bemerkung ? { note: str(l.bemerkung) } : {}) })) }))
}

// ---------------------------------------------------------------- Gesamte Übernahme

/**
 * Rechnet alles aus, ohne etwas zu ändern. current: { objects, mappe, kontrolle, zaehler }
 * Liefert, was sich ändert, und eine Übersicht je Quelle.
 */
export function planLegacyImport(found, current, { checklistId = 'objektkontrolle', photoUrl = null } = {}) {
  const mappe = { ...(current.mappe?.objects || {}) }
  const { resolve, created } = objectResolver(current.objects || [], mappe)
  const stats = { water: null, customers: found.customers.length, objects: 0, inspections: 0, akten: 0, created: 0 }

  // Objekte der Objektkontrolle: Kunde, Nummer, E-Mail der Hausverwaltung
  for (const o of found.objects) {
    const obj = resolve({ objectNo: o.objektId, name: o.objekt, address: o.adresse, customer: o.kunde, prefix: 'o-pk' })
    const m = { ...(mappe[obj.id] || {}) }
    if (o.kunde && !m.customer) m.customer = str(o.kunde)
    if (o.kundenNr && !m.customerNo) m.customerNo = str(o.kundenNr)
    if (o.objektId && !m.objectNo) m.objectNo = str(o.objektId)
    if (o.email && !m.hvEmail) m.hvEmail = str(o.email)
    if (o.adresse && !m.street) m.street = str(o.adresse)
    mappe[obj.id] = m
    stats.objects++
  }

  // Akten der Objektdoku: Inhalt der Mappe (vorhandene Einträge werden ergänzt, nicht gelöscht)
  for (const { path, data } of found.akten) {
    const obj = resolve({ objectNo: data.objektId, name: data.objekt, address: [data.strasse, data.ort].filter(Boolean).join(', '), customer: data.kunde, prefix: 'o-od' })
    const conv = convertAkte(data, { photoDir: path.split('/').slice(0, -1).join('/'), photoUrl })
    const prev = mappe[obj.id] || {}
    const merged = { ...prev }
    for (const [k, v] of Object.entries(conv)) {
      if (Array.isArray(v)) merged[k] = v.length ? v : prev[k] || []
      else if (v !== '' && v !== undefined) merged[k] = v
    }
    mappe[obj.id] = merged
    stats.akten++
  }

  // Kontrollen
  const inspections = new Map((current.kontrolle?.inspections || []).map((x) => [x.id, x]))
  for (const { path, data } of found.inspections) {
    const meta = data.meta || {}
    const obj = resolve({ objectNo: meta.objektId, name: meta.objekt, address: meta.adresse, customer: meta.auftraggeber, prefix: 'o-pk' })
    const m = { ...(mappe[obj.id] || {}) }
    if (meta.auftraggeber && !m.customer) m.customer = str(meta.auftraggeber)
    if (meta.kundenNr && !m.customerNo) m.customerNo = str(meta.kundenNr)
    if (meta.objektId && !m.objectNo) m.objectNo = str(meta.objektId)
    mappe[obj.id] = m
    const dir = path.split('/').slice(0, -1).join('/')
    const insp = convertInspection(data, { objectId: obj.id, checklistId, photoDir: dir, photoUrl })
    if (!insp.date) continue
    inspections.set(insp.id, insp)
    stats.inspections++
  }

  // Zählerstände (Objekte schon mit den neu angelegten)
  let zaehler = current.zaehler
  if (found.water.length) {
    const res = importWaterLists(found.water, { objects: [...(current.objects || []), ...created], zaehler: current.zaehler || { meters: [], readings: [] } })
    created.push(...res.objects)
    zaehler = { ...(current.zaehler || {}), meters: res.meters, readings: res.readings, closures: res.closures }
    stats.water = res.stats
  }
  stats.created = created.length

  // Kundenstamm: neue Liste ersetzt, sonst bleibt der alte; Vorlagen je Name ergänzen
  const customers = found.customers.length ? found.customers : current.mappe?.customers || []
  const templates = [...(current.mappe?.templates || [])]
  for (const t of found.templates || []) {
    const i = templates.findIndex((x) => x.id === t.id || x.name === t.name)
    if (i >= 0) templates[i] = t
    else templates.push(t)
  }
  stats.templates = (found.templates || []).length
  return {
    objects: created,
    mappe: { ...(current.mappe || {}), objects: mappe, customers, ...(templates.length ? { templates } : {}) },
    kontrolle: found.inspections.length ? { ...(current.kontrolle || {}), inspections: [...inspections.values()] } : current.kontrolle,
    zaehler,
    stats,
  }
}

// ---------------------------------------------------------------- In SharePoint suchen

/**
 * Die Ordner der bisherigen Werkzeuge in der Bibliothek durchsuchen und alle
 * passenden JSON-Dateien lesen. store: SharePoint-Ablage (listTree, readRoot).
 * Liefert { files: [{ path, data }], sources: { name: Anzahl Dateien } }.
 */
export async function scanLegacy(store, sources = LEGACY_SOURCES, { onProgress = () => {} } = {}) {
  const wanted = []
  const counts = {}
  const add = (key, list) => {
    counts[key] = (counts[key] || 0) + list.length
    wanted.push(...list)
  }
  if (sources.wasserzaehler) add('wasserzaehler', (await store.listTree(sources.wasserzaehler, { depth: 4 })).filter((f) => /^Ablesung_.*\.json$/i.test(f.name)).map((f) => f.path))
  if (sources.pruefprotokoll) {
    const pp = sources.pruefprotokoll
    // Kundenstamm gehört allen Werkzeugen: zuerst Stammdaten/ an der Wurzel der Bibliothek
    add('pruefprotokoll', ['Stammdaten/Kunden.json', `${pp}/Stammdaten/Kunden.json`, `${pp}/Stammdaten/Objekte.json`])
    add('pruefprotokoll', (await store.listTree(`${pp}/Objekte`, { depth: 3 })).filter((f) => /\.json$/i.test(f.name)).map((f) => f.path))
  }
  if (sources.objektdoku) {
    add('objektdoku', (await store.listTree(sources.objektdoku, { depth: 2, skip: ['Fotos', 'Stammdaten'] })).filter((f) => /\.json$/i.test(f.name)).map((f) => f.path))
    // Vorlagen: Ort im Werkzeug noch nicht endgültig, darum mehrere Stellen
    add('objektdoku', [`${sources.objektdoku}/Stammdaten/Vorlagen.json`, 'Stammdaten/Vorlagen.json'])
  }
  const files = []
  const seenCustomers = new Set()
  for (let i = 0; i < wanted.length; i += 6) {
    const batch = wanted.slice(i, i + 6)
    const docs = await Promise.all(batch.map((p) => store.readRoot(p).catch(() => null)))
    batch.forEach((path, j) => {
      if (!docs[j]) return
      // Kundenstamm nur einmal (liegt je nach Fassung an zwei Orten)
      if (/Kunden\.json$/i.test(path)) {
        if (seenCustomers.size) return
        seenCustomers.add(path)
      }
      files.push({ path, data: docs[j] })
    })
    onProgress(Math.min(wanted.length, i + 6), wanted.length)
  }
  return { files, sources: counts }
}
