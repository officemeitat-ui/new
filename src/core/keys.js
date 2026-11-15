// Schlüsselbuch: Schlüssel, Transponder und Karten je Objekt, wer sie hat (oder ob sie im Büro
// liegen), Ausgabe und Rückgabe mit Datum und Unterschrift, Verlust, Rückgabe an den Kunden.
//
// Datei schluessel/schluessel.json:
//   { keys: [{ id, objectId, label, no, kind, storage, holderId, since, due, status, note, legacyId,
//              lost: { date, text, informed, measure }, history: [{ at, date, kind, from, to, by, note, signature }] }] }
//   holderId '' = im Büro (Aufbewahrung laut storage); status aktiv | verloren | kunde (zurück an den Kunden)
//
// Das Schlüsselbuch ist die Quelle für die Prüfregel „Schlüsselübergabe nötig“ im Plan. Objekte ohne
// Eintrag im Schlüsselbuch behalten ihre bisherigen Schlüssel (Objekt bearbeiten → Schlüssel).

import { addDays, formatDate } from './dates.js'
import { headKey, nameMatcher } from './names.js'

const day = (d) => formatDate(d, { year: true })

export const KEY_KINDS = { schluessel: 'Schlüssel', transponder: 'Transponder / Chip', karte: 'Zutrittskarte', fernbedienung: 'Fernbedienung', sonstiges: 'Sonstiges' }
export const KEY_STATUS = { aktiv: 'aktiv', verloren: 'verloren', kunde: 'an Kunden zurück' }
export const HISTORY_TEXT = { angelegt: 'angelegt', uebernommen: 'aus dem Objekt übernommen', ausgabe: 'ausgegeben', rueckgabe: 'zurückgegeben', verlust: 'als verloren gemeldet', gefunden: 'wieder da', kunde: 'an den Kunden zurückgegeben', geaendert: 'geändert' }

export const emptyKeys = () => ({ keys: [] })
export const isActive = (k) => (k.status || 'aktiv') === 'aktiv'

/** Aktive Schlüssel eines Objekts, nach Bezeichnung. */
export const objectKeys = (keys = [], objectId) => keys.filter((k) => k.objectId === objectId && isActive(k)).sort((a, b) => a.label.localeCompare(b.label, 'de'))
/** Schlüssel, die eine Person gerade hat. */
export const keysOf = (keys = [], empId) => keys.filter((k) => empId && k.holderId === empId && isActive(k))

/**
 * Schlüssel je Objekt für die Planung: aus dem Schlüsselbuch, wenn es dort welche gibt (auch nur
 * verlorene: dann gilt das Buch), sonst die bisher am Objekt eingetragenen.
 */
export function effectiveKeys(objects = [], book = []) {
  const inBook = new Set(book.map((k) => k.objectId))
  const out = new Map()
  for (const o of objects) out.set(o.id, inBook.has(o.id) ? objectKeys(book, o.id).map((k) => ({ id: k.id, label: k.label, holderId: k.holderId || '' })) : (o.keys || []).map((k) => ({ id: k.id, label: k.label, holderId: k.holderId || '' })))
  return out
}

const entry = (kind, { at, date, by = '', note = '', from = '', to = '', signature = '' }) => Object.fromEntries(Object.entries({ at, date, kind, from, to, by, note, signature }).filter(([, v]) => v !== ''))

/** Ausgabe an eine Person (auch Weitergabe von Person zu Person). */
export function handOver(key, { to, date, due = '', by, note = '', signature = '', at }) {
  if (!to) throw new Error('Empfänger fehlt')
  return { ...key, holderId: to, since: date, due: due || '', history: [...(key.history || []), entry('ausgabe', { at, date, by, note, from: key.holderId || '', to, signature })] }
}

/** Rückgabe ins Büro. */
export function giveBack(key, { date, by, note = '', signature = '', at }) {
  return { ...key, holderId: '', since: date, due: '', history: [...(key.history || []), entry('rueckgabe', { at, date, by, note, from: key.holderId || '', signature })] }
}

/** Verlust melden: Schlüssel gilt nicht mehr als vorhanden, bis er wieder auftaucht. */
export function markLost(key, { date, by, text = '', informed = false, measure = '', at }) {
  return { ...key, status: 'verloren', lost: { date, text, informed: !!informed, measure }, history: [...(key.history || []), entry('verlust', { at, date, by, note: text, from: key.holderId || '' })] }
}

/** Verlorener Schlüssel wieder da (liegt dann im Büro). */
export function markFound(key, { date, by, note = '', at }) {
  return { ...key, status: 'aktiv', holderId: '', since: date, due: '', history: [...(key.history || []), entry('gefunden', { at, date, by, note })] }
}

/** Zurück an den Kunden (Objekt gekündigt, Schließanlage getauscht). */
export function returnToCustomer(key, { date, by, note = '', at }) {
  return { ...key, status: 'kunde', holderId: '', since: date, due: '', history: [...(key.history || []), entry('kunde', { at, date, by, note, from: key.holderId || '' })] }
}

/**
 * Hinweise zum Schlüsselbuch: [{ severity, code, key, text }]
 *  AUSGETRETEN  Person ist ausgetreten und hat noch Schlüssel (error)
 *  AUSTRITT     Austritt in den nächsten 14 Tagen (warning)
 *  FAELLIG      Rückgabe vereinbart und überschritten (warning)
 *  ABWESEND     Person heute abwesend und noch mindestens 7 Tage (info)
 *  VERLOREN     Verlust gemeldet, Kunde noch nicht informiert (error)
 */
export function keyWarnings({ keys = [], employees = [], absences = [], today }) {
  const emp = new Map(employees.map((e) => [e.id, e]))
  const out = []
  for (const k of keys) {
    if (k.status === 'verloren' && !k.lost?.informed) out.push({ severity: 'error', code: 'VERLOREN', key: k, text: 'verloren, Kunde noch nicht informiert' })
    if (!isActive(k) || !k.holderId) continue
    const e = emp.get(k.holderId)
    if (e?.exitDate && e.exitDate < today) out.push({ severity: 'error', code: 'AUSGETRETEN', key: k, text: `${e.name} ist ausgetreten (${day(e.exitDate)}) und hat den Schlüssel noch` })
    else if (e?.exitDate && e.exitDate <= addDays(today, 14)) out.push({ severity: 'warning', code: 'AUSTRITT', key: k, text: `${e.name} tritt am ${day(e.exitDate)} aus: Rückgabe einplanen` })
    if (k.due && k.due < today) out.push({ severity: 'warning', code: 'FAELLIG', key: k, text: `Rückgabe war bis ${day(k.due)} vereinbart` })
    const away = absences.find((a) => a.employeeId === k.holderId && a.from <= today && a.to >= addDays(today, 7))
    if (away) out.push({ severity: 'info', code: 'ABWESEND', key: k, text: `${e?.name || 'Person'} ist bis ${day(away.to)} abwesend (${away.type})` })
  }
  const order = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * Übergaben laut Plan: eingeteilte Personen ohne Schlüssel in Objekten mit Schlüsseln (from–to).
 * [{ date, inst, empId, holders: [empId] (wer einen hat), office: true, wenn einer im Büro liegt }]
 */
export function handoversNeeded({ instances = [], state, keysByObject, from, to }) {
  const out = []
  const seen = new Set()
  // zeitlich: Winterdienst und Müll-Gänge stehen in der Liste hinter den übrigen Einsätzen
  for (const inst of [...instances].sort((a, b) => a.start - b.start)) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to) continue
    const keys = keysByObject.get(inst.objectId) || []
    if (!keys.length) continue
    for (const { employeeId: empId } of state.assigned(inst.key)) {
      if (keys.some((k) => k.holderId === empId)) continue
      const id = `${empId}|${inst.objectId}`
      if (seen.has(id)) continue // je Person und Objekt nur der erste Einsatz
      seen.add(id)
      out.push({ date: inst.date, inst, empId, holders: [...new Set(keys.map((k) => k.holderId).filter(Boolean))], office: keys.some((k) => !k.holderId) })
    }
  }
  return out.sort((a, b) => a.inst.start - b.inst.start)
}

/**
 * Bisher am Objekt eingetragene Schlüssel ins Schlüsselbuch übernehmen (einmal je Schlüssel). Objekte,
 * die schon im Schlüsselbuch geführt werden, bleiben aus (sonst gäbe es dieselben Schlüssel doppelt).
 */
export function importFromObjects(objects = [], book = [], { newId, at, date, by = '' }) {
  const known = new Set(book.map((k) => k.legacyId).filter(Boolean))
  const inBook = new Set(book.filter((k) => !k.legacyId).map((k) => k.objectId))
  const out = []
  for (const o of objects) {
    if (inBook.has(o.id)) continue
    for (const k of o.keys || []) {
      const legacyId = `${o.id}:${k.id || k.label}`
      if (known.has(legacyId) || !String(k.label || '').trim()) continue
      out.push({ id: newId(), objectId: o.id, label: k.label.trim(), no: '', kind: 'schluessel', storage: '', holderId: k.holderId || '', since: date, due: '', status: 'aktiv', note: '', legacyId, history: [entry('uebernommen', { at, date, by, to: k.holderId || '' })] })
    }
  }
  return out
}

/** Text einer Zeile im Verlauf, z. B. „ausgegeben an Ana“. */
export function historyText(h, name = (id) => id) {
  const base = HISTORY_TEXT[h.kind] || h.kind
  if (h.kind === 'ausgabe') return `${base}${h.from ? ` von ${name(h.from)}` : ''} an ${name(h.to)}`
  if (h.kind === 'rueckgabe') return `${base}${h.from ? ` von ${name(h.from)}` : ''} ins Büro`
  if (h.kind === 'uebernommen' && h.to) return `${base} (bei ${name(h.to)})`
  return base
}

// ---------------------------------------------------------------- Schlüsselliste aus Excel einfügen

const KEY_COLS = {
  seq: ['nummerierung', 'nummerrierung', 'lfdnr', 'lfdnummer', 'laufendenummer', 'pos', 'position'],
  no: ['schlusselnummer', 'schlusselnr', 'nummer', 'nr', 'schliessnummer', 'code'],
  object: ['objekt', 'objektname', 'haus', 'liegenschaft', 'kunde'],
  holder: ['mitarbeiter', 'mitarbeiterin', 'person', 'inhaber', 'ausgegebenan', 'wer', 'name'],
  label: ['bezeichnung', 'schlussel', 'tur', 'wofur'],
  storage: ['aufbewahrung', 'schlusselkasten', 'haken', 'ort'],
  note: ['notiz', 'bemerkung', 'anmerkung', 'hinweis'],
}

/** Laufende Nummer aus der Liste: „3“, „3.“ – und „03.01.1900“ bzw. „1900-01-03“, wenn Excel die Zahl als Datum zeigt. */
export function listNumber(v) {
  const s = String(v ?? '').trim()
  let m = /^(\d{1,4})\.?$/.exec(s)
  if (m) return String(Number(m[1]))
  m = /^1900-01-(\d{2})/.exec(s) || /^(\d{1,2})\.0?1\.1900\b/.exec(s)
  return m ? String(Number(m[1])) : ''
}

/**
 * Schlüssel aus einer eingefügten Tabelle (Tabulator wie aus Excel, sonst Semikolon). Überschrift wie in der bisherigen
 * Schlüsselliste: Nummerierung, Schlüssel Nummer, Objekt, Mitarbeiter – dazu wahlweise Bezeichnung, Aufbewahrung, Notiz.
 * Objekt und Person über den Namen (auch leicht anders geschrieben). Ohne Person liegt der Schlüssel im Büro.
 * → { items: [{ objectId, objectName, objectWritten?, label, no, holderId, holderName, holderWritten?, storage, note }],
 *     unknownObjects: [Name], unknownPeople: [Name], known: Anzahl schon vorhandener, errors: [Text] }
 */
export function parseKeyTable(text, { objects = [], employees = [], book = [] } = {}) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const out = { items: [], unknownObjects: [], unknownPeople: [], known: 0, errors: [] }
  if (!lines.length) return out
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ';'
  const headAt = lines.slice(0, 10).findIndex((l) => {
    const h = l.split(sep).map(headKey)
    return h.some((x) => KEY_COLS.object.includes(x)) && h.some((x) => KEY_COLS.no.includes(x) || KEY_COLS.label.includes(x) || KEY_COLS.seq.includes(x))
  })
  if (headAt < 0) {
    out.errors.push('Die Überschrift fehlt: gebraucht werden „Objekt“ und „Schlüssel Nummer“ (oder „Bezeichnung“).')
    return out
  }
  const head = lines[headAt].split(sep).map(headKey)
  const ix = Object.fromEntries(Object.keys(KEY_COLS).map((k) => [k, head.findIndex((h) => KEY_COLS[k].includes(h))]))
  const cell = (c, k) => (ix[k] >= 0 ? (c[ix[k]] || '').replace(/\s+/g, ' ').trim() : '')
  const findObject = nameMatcher(objects, (o) => [o.name, o.short])
  const findPerson = nameMatcher(employees)
  const have = new Set(book.filter((k) => (k.status || 'aktiv') === 'aktiv').map((k) => `${k.objectId}|${headKey(k.no)}|${headKey(k.label)}`))
  for (const line of lines.slice(headAt + 1)) {
    const c = line.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, '$1'))
    const written = cell(c, 'object')
    const no = cell(c, 'no')
    const seq = listNumber(cell(c, 'seq'))
    if (!written) continue
    const hit = findObject(written)
    if (!hit) {
      if (!out.unknownObjects.includes(written)) out.unknownObjects.push(written)
      continue
    }
    const label = cell(c, 'label') || (seq ? `Schlüssel ${seq}` : 'Schlüssel')
    const key = `${hit.emp.id}|${headKey(no)}|${headKey(label)}`
    if (have.has(key)) {
      out.known++
      continue
    }
    have.add(key)
    const who = cell(c, 'holder')
    const person = who ? findPerson(who) : null
    if (who && !person && !out.unknownPeople.includes(who)) out.unknownPeople.push(who)
    out.items.push({
      objectId: hit.emp.id,
      objectName: hit.emp.name,
      ...(hit.exact ? {} : { objectWritten: written }),
      label,
      no,
      holderId: person?.emp.id || '',
      holderName: person?.emp.name || '',
      ...(who && (!person || !person.exact) ? { holderWritten: who } : {}),
      storage: cell(c, 'storage'),
      note: [cell(c, 'note'), who && !person ? `laut Liste bei ${who}` : ''].filter(Boolean).join(' · '),
    })
  }
  return out
}

/** Eingefügte Schlüssel als Einträge fürs Schlüsselbuch (angelegt, mit Person gleich als ausgegeben). */
export function keysFromImport(items = [], { newId, at, date, by = '' }) {
  return items.map((x) => ({
    id: newId(),
    objectId: x.objectId,
    label: x.label,
    no: x.no || '',
    kind: 'schluessel',
    storage: x.storage || '',
    holderId: x.holderId || '',
    since: date,
    due: '',
    status: 'aktiv',
    note: x.note || '',
    history: [entry('angelegt', { at, date, by, note: 'aus der Schlüsselliste' }), ...(x.holderId ? [entry('ausgabe', { at, date, by, to: x.holderId, note: 'laut Schlüsselliste' })] : [])],
  }))
}
