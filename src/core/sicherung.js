// Datensicherung (nur Vollzugriff): alle Dateien der App aus dem App-Ordner in SharePoint (Plattform/…) in eine
// ZIP-Datei mit manifest.json (je Datei Pfad, Größe, SHA-256, eTag, zuletzt geändert), eine Sicherung prüfen
// (Prüfsummen) und mit dem aktuellen Stand vergleichen. Zurückgespielt wird nie von selbst, nur einzelne Dateien nach
// Auswahl und Bestätigung; vorher kommt der aktuelle Stand der Datei nach Plattform/_Sicherung/<Datum>/ (Rückweg).
// Reine Funktionen ohne Oberfläche und ohne ZIP-Bibliothek (JSZip wird übergeben); Tests: test/sicherung.test.js.
// Ansicht: ui/views/sicherung.js (Kürzel sich-). Datum der letzten Sicherung: Einstellungen der App
// (daten/stammdaten.json → settings.sicherung { datum, at, by, dateien, bytes, fehler, anhaenge, every }).

import { dayIndex } from './dates.js'

export const SICH_FORMAT = 'cleanos-sicherung'
export const SICH_VERSION = 1
/** Ordner für den Rückweg im App-Ordner: _Sicherung/<Datum>/<Pfad> (wird selbst nicht gesichert). */
export const SICH_RUECKWEG = '_Sicherung'
/** Erinnerung „Zu erledigen“: Vorgabe alle 30 Tage, wählbar. */
export const SICH_EVERY = 30
export const SICH_EVERY_CHOICES = [7, 14, 30, 60, 90]

/** Wer darf sichern, prüfen und zurückspielen: nur Vollzugriff (Browser-Modus ohne Rollen: ja). */
export function sichRechte(access) {
  const all = !access || !!access.all
  return { view: all, backup: all, restore: all }
}

const clean = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '')

/**
 * Art einer Datei im App-Ordner: 'daten' (JSON: Stammdaten, Module, Jahres-Dateien, Touren je Jahr …), 'anhang'
 * (PDF, Fotos, Excel …) oder '' (nicht sichern: Rückweg-Ordner _Sicherung/, ungültiger Pfad mit „..“).
 */
export function sichArt(path) {
  const p = clean(path)
  if (!p || p.endsWith('/') || p.split('/').some((x) => x === '' || x === '.' || x === '..')) return ''
  if (p === SICH_RUECKWEG || p.startsWith(`${SICH_RUECKWEG}/`)) return ''
  return /\.json$/i.test(p) ? 'daten' : 'anhang'
}

const sum = (list) => list.reduce((s, f) => s + (Number(f.size) || 0), 0)

/**
 * Welche Dateien in die Sicherung kommen.
 *   files    Liste des App-Ordners [{ path (ab dem App-Ordner), size, etag, modified }]
 *   known    Pfade, die die App geladen hat (mit eTag) – kommen mit, auch wenn die Liste sie nicht enthält
 *   anhaenge PDFs und Fotos mit (Vorgabe nein: Größe)
 *   read     darf die Rolle die Datei lesen (dataRights(access).read); Vollzugriff: alle
 * Liefert { dateien: [{ path, art, size, etag, modified }] (nach Pfad), daten { anzahl, groesse },
 * anhaenge { anzahl, groesse } (alle gefundenen, auch wenn nicht gewählt), ausgelassen { anzahl, groesse } }.
 */
export function sichAuswahl({ files = [], known = [], anhaenge = false, read = () => true } = {}) {
  const byPath = new Map()
  for (const f of files || []) {
    const path = clean(f?.path)
    if (!sichArt(path) || byPath.has(path)) continue
    byPath.set(path, { path, art: sichArt(path), size: Number(f.size) || 0, etag: f.etag ?? null, modified: f.modified || null })
  }
  for (const k of known || []) {
    const path = clean(k)
    if (sichArt(path) && !byPath.has(path)) byPath.set(path, { path, art: sichArt(path), size: 0, etag: null, modified: null })
  }
  const all = [...byPath.values()].filter((f) => read(f.path)).sort((a, b) => a.path.localeCompare(b.path))
  const daten = all.filter((f) => f.art === 'daten')
  const anh = all.filter((f) => f.art === 'anhang')
  return {
    dateien: anhaenge ? all : daten,
    daten: { anzahl: daten.length, groesse: sum(daten) },
    anhaenge: { anzahl: anh.length, groesse: sum(anh) },
    ausgelassen: anhaenge ? { anzahl: 0, groesse: 0 } : { anzahl: anh.length, groesse: sum(anh) },
  }
}

/** SHA-256 als Hex (Web Crypto; im Browser und in Node gleich). bytes: Uint8Array, ArrayBuffer oder Text. */
export async function sichPruefsumme(bytes) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * manifest.json der Sicherung.
 *   erstellt ISO-Zeitpunkt, app { name, version }, quelle { ablage, ordner, ort }, von (Name), anhaenge (mit PDFs und
 *   Fotos), dateien [{ pfad, groesse, sha256, etag, geaendert }], fehler [{ pfad, fehler }] (nicht gesichert),
 *   ausgelassen { anzahl, groesse } (PDFs und Fotos, nicht gewählt)
 */
export function sichManifest({ erstellt, app = {}, quelle = {}, von = '', anhaenge = false, dateien = [], fehler = [], ausgelassen = null } = {}) {
  const list = (dateien || []).map((f) => ({ pfad: clean(f.pfad), groesse: Number(f.groesse) || 0, sha256: String(f.sha256 || ''), etag: f.etag ?? null, geaendert: f.geaendert || null })).sort((a, b) => a.pfad.localeCompare(b.pfad))
  return {
    format: SICH_FORMAT,
    version: SICH_VERSION,
    erstellt: erstellt || new Date().toISOString(),
    app: { name: String(app.name || ''), version: String(app.version || '') },
    quelle: { ablage: String(quelle.ablage || ''), ordner: clean(quelle.ordner || 'Plattform').replace(/\/+$/, ''), ort: String(quelle.ort || '') },
    von: String(von || ''),
    anhaenge: !!anhaenge,
    anzahl: list.length,
    groesse: list.reduce((s, f) => s + f.groesse, 0),
    dateien: list,
    fehler: (fehler || []).map((x) => ({ pfad: clean(x.pfad), fehler: String(x.fehler || '') })),
    ausgelassen: ausgelassen ? { anzahl: Number(ausgelassen.anzahl) || 0, groesse: Number(ausgelassen.groesse) || 0 } : { anzahl: 0, groesse: 0 },
  }
}

/** Name des Eintrags im ZIP: <Ordner>/<Pfad> (wie in SharePoint, z. B. Plattform/daten/stammdaten.json). */
export const sichEintrag = (manifest, pfad) => `${manifest?.quelle?.ordner || 'Plattform'}/${clean(pfad)}`
/** Name der ZIP-Datei. */
export const sichZipName = (datum, marke = 'Cleanos') => `${String(marke || 'Cleanos').replace(/[^\p{L}\p{N}_-]+/gu, '-')}-Sicherung-${datum}.zip`

/** manifest.json lesen und prüfen; wirft mit einem verständlichen Text, wenn es keine Sicherung der App ist. */
export function sichManifestLesen(text) {
  let m = null
  try {
    m = JSON.parse(String(text || '').replace(/^﻿/, ''))
  } catch {
    m = null
  }
  if (!m || m.format !== SICH_FORMAT || !Array.isArray(m.dateien)) throw new Error('Keine Sicherung der App: manifest.json fehlt oder ist unlesbar.')
  if (Number(m.version) > SICH_VERSION) throw new Error(`Diese Sicherung stammt von einer neueren Fassung der App (Format ${m.version}). Bitte die App aktualisieren.`)
  return m
}

/** ZIP bauen: JSZip (Klasse), manifest, files [{ pfad, bytes, art? }]; Fotos und PDFs ungepackt (schon komprimiert). */
export async function sichZipBauen(JSZip, manifest, files = [], { type = 'blob' } = {}) {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 1))
  for (const f of files) zip.file(sichEintrag(manifest, f.pfad), f.bytes, { binary: true, compression: (f.art || sichArt(f.pfad)) === 'anhang' ? 'STORE' : 'DEFLATE' })
  return zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** ZIP lesen: { manifest, namen (Einträge ohne Ordner), lesen(pfad) → Uint8Array | null }. Wirft ohne gültiges Manifest. */
export async function sichZipLesen(JSZip, data) {
  let zip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('Die Datei ist keine ZIP-Datei oder beschädigt.')
  }
  const entry = zip.file('manifest.json')
  if (!entry) throw new Error('Keine Sicherung der App: manifest.json fehlt oder ist unlesbar.')
  const manifest = sichManifestLesen(await entry.async('string'))
  const namen = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== 'manifest.json')
  const lesen = async (pfad) => {
    const f = zip.file(sichEintrag(manifest, pfad))
    return f ? f.async('uint8array') : null
  }
  return { manifest, namen, lesen }
}

/**
 * Inhalt der Sicherung gegen das Manifest prüfen. lesen(pfad) → Uint8Array | null (Eintrag im ZIP), namen: alle
 * Einträge im ZIP (für „nicht im Manifest“). Liefert { dateien: [{ pfad, status: 'ok' | 'falsch' | 'fehlt', grund }],
 * ok, falsch, fehlt, fremd: [Eintrag] }. onStep(i, n) für den Fortschritt.
 */
export async function sichPruefen(manifest, lesen, { namen = [], onStep = () => {} } = {}) {
  const dateien = []
  const list = manifest?.dateien || []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    onStep(i, list.length)
    let bytes = null
    try {
      bytes = sichArt(f.pfad) ? await lesen(f.pfad) : null
    } catch {
      bytes = null
    }
    if (!bytes) {
      dateien.push({ pfad: f.pfad, status: 'fehlt', grund: sichArt(f.pfad) ? 'fehlt in der ZIP-Datei' : 'ungültiger Pfad' })
      continue
    }
    const sha = await sichPruefsumme(bytes)
    if (sha !== f.sha256) dateien.push({ pfad: f.pfad, status: 'falsch', grund: 'Prüfsumme stimmt nicht (Datei verändert oder beschädigt)' })
    else if (bytes.length !== Number(f.groesse)) dateien.push({ pfad: f.pfad, status: 'falsch', grund: 'Größe stimmt nicht' })
    else dateien.push({ pfad: f.pfad, status: 'ok', grund: '' })
  }
  const inManifest = new Set(list.map((f) => sichEintrag(manifest, f.pfad)))
  const fremd = (namen || []).filter((n) => !inManifest.has(n)).sort()
  const count = (s) => dateien.filter((d) => d.status === s).length
  return { dateien, ok: count('ok'), falsch: count('falsch'), fehlt: count('fehlt'), fremd }
}

const time = (iso) => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? t : null
}

/**
 * Sicherung mit dem aktuellen Stand vergleichen. aktuell: Liste des App-Ordners [{ path, etag, modified, size }].
 * Je Datei der Sicherung: 'gleich' (gleicher eTag), 'neuer' (jetzt neuer als in der Sicherung), 'aelter' (jetzt älter),
 * 'anders' (geändert, Zeitpunkt unklar), 'fehlt' (gibt es jetzt nicht mehr); dazu 'neu' für Dateien, die jetzt da sind,
 * aber nicht in der Sicherung (nur Arten, die gesichert wurden: ohne Anhänge keine Fotos). Liefert
 * { dateien: [{ pfad, status, gesichert, jetzt }], zaehler: { gleich, neuer, aelter, anders, fehlt, neu } }.
 */
export function sichVergleich(manifest, aktuell = []) {
  const now = new Map()
  for (const f of aktuell || []) {
    const path = clean(f?.path)
    if (sichArt(path)) now.set(path, f)
  }
  const dateien = []
  const seen = new Set()
  for (const g of manifest?.dateien || []) {
    seen.add(g.pfad)
    const j = now.get(g.pfad)
    let status
    if (!j) status = 'fehlt'
    else if (g.etag && j.etag && g.etag === j.etag) status = 'gleich'
    else {
      const a = time(g.geaendert)
      const b = time(j.modified)
      status = a !== null && b !== null && b > a ? 'neuer' : a !== null && b !== null && b < a ? 'aelter' : 'anders'
    }
    dateien.push({ pfad: g.pfad, status, gesichert: g, jetzt: j || null })
  }
  for (const [path, j] of now) {
    if (seen.has(path)) continue
    if (sichArt(path) === 'anhang' && !manifest?.anhaenge) continue
    dateien.push({ pfad: path, status: 'neu', gesichert: null, jetzt: j })
  }
  dateien.sort((x, y) => x.pfad.localeCompare(y.pfad))
  const zaehler = { gleich: 0, neuer: 0, aelter: 0, anders: 0, fehlt: 0, neu: 0 }
  for (const d of dateien) zaehler[d.status]++
  return { dateien, zaehler }
}

/** Darf diese Datei zurückgespielt werden? Nur geprüft (Prüfsumme ok), gültiger Pfad, und anders als jetzt bzw. fehlend. */
export const sichZurueckspielbar = (vergleich, pruefung) => vergleich?.gesichert && pruefung?.status === 'ok' && sichArt(vergleich.pfad) && ['neuer', 'aelter', 'anders', 'fehlt'].includes(vergleich.status)

/**
 * Pfad für den Rückweg: _Sicherung/<Datum>/<Pfad>, beim n-ten Mal am selben Tag mit „ (n)“ vor der Endung
 * (z. B. _Sicherung/2026-11-09/daten/stammdaten (2).json).
 */
export function sichRueckwegPfad(datum, pfad, n = 1) {
  const p = clean(pfad)
  const name = n > 1 ? p.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`) : p
  return `${SICH_RUECKWEG}/${datum}/${name}`
}

/**
 * Erinnerung: Wann war die letzte Sicherung, ist eine neue fällig? s = settings.sicherung, today = Datum (JJJJ-MM-TT).
 * Liefert { datum, tage (seit der letzten, null = noch nie), every, faellig }.
 */
export function sichFaellig(s = {}, today) {
  const every = SICH_EVERY_CHOICES.includes(Number(s?.every)) ? Number(s.every) : Number(s?.every) > 0 ? Math.round(Number(s.every)) : SICH_EVERY
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(s?.datum || '') ? s.datum : ''
  const tage = datum ? dayIndex(today) - dayIndex(datum) : null
  return { datum, tage, every, faellig: tage === null || tage >= every }
}

/** Größe lesbar: 980 B, 12 KB, 3,4 MB, 1,2 GB. */
export function sichGroesse(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB`
  return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
}
