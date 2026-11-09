// Leistungs-Checkliste am Handy, Teile für das Büro (Punkte je Einsatz und Nachweis: core/checkliste.js): Punkte im
// Dialog der Leistung bereinigen, Datensätze von mein-plan.php übernehmen (Merge wie die Stempelungen), Ablage der
// Fotos, Auswertung für den Einsatz-Dialog und „Zu erledigen“, Anfrage an die KI zum Übersetzen aller Punkte einer
// Leistung. Nur für die später geladenen Teile der App (views/checkliste.js, ai/translate.js), nicht für den Start.

import { ITEM_ID, MAX_ITEMS, MAX_TEXT } from './checkliste.js'
import { translationRequest } from './sprachen.js'

const PHOTO = /^[a-f0-9]{12}-[a-z0-9]{1,16}-[a-f0-9]{6}\.jpg$/

// ---------------------------------------------------------------- Punkte der Leistung

/** Wann ein Punkt gilt: 'immer' | 'woche' (1× pro Woche) | 'tage' (nur an days). */
export const whenOf = (x) => (x?.weekly ? 'woche' : x?.days?.length ? 'tage' : 'immer')

/** Punkte bereinigen (Editor): ohne leere, Kennungen eindeutig, höchstens 30, „1× pro Woche“ ohne Wochentage. */
export function cleanItems(list) {
  const out = []
  const seen = new Set()
  for (const x of list || []) {
    const text = String(x?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
    if (!text || !ITEM_ID.test(x?.id || '') || seen.has(x.id)) continue
    seen.add(x.id)
    const days = x.weekly ? [] : [...new Set((x.days || []).map(Number).filter((d) => d >= 1 && d <= 7))].sort()
    const i18n = x.i18n && typeof x.i18n === 'object' && Object.keys(x.i18n).length ? x.i18n : null
    out.push({ id: x.id, text, ...(x.photo ? { photo: true } : {}), ...(days.length && days.length < 7 ? { days } : {}), ...(x.weekly ? { weekly: true } : {}), ...(i18n ? { i18n } : {}) })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

// ---------------------------------------------------------------- Vom Webspace

export const checkKey = (c) => `${c.date}|k${c.id}`

/** Datensatz vom Webspace → App (null, wenn unbrauchbar). index: Hashwert des Links → Person. */
export function fromServer(r, index = new Map()) {
  if (!/^[a-f0-9]{12}$/.test(r?.id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(r.datum || '') || !/^\d{4}-\d{2}-\d{2}\|[^|]{1,80}$/.test(r.einsatz || '')) return null
  const iso = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null)
  const items = (Array.isArray(r.punkte) ? r.punkte : [])
    .filter((p) => ITEM_ID.test(p?.id || ''))
    .slice(0, MAX_ITEMS)
    .map((p) => {
      const status = p.status === 'ok' || p.status === 'nicht' ? p.status : ''
      return { id: p.id, text: String(p.text || '').slice(0, MAX_TEXT), photoRequired: !!p.foto, status, reason: status === 'nicht' ? String(p.grund || '').slice(0, 120) : '', at: iso(p.zeit), photo: PHOTO.test(p.bild || '') ? { datei: p.bild } : null }
    })
  return { id: r.id, date: r.datum, instKey: r.einsatz, empId: index.get(r.hash) || null, name: String(r.name || ''), objectId: String(r.objektId || ''), objectName: String(r.objekt || ''), label: String(r.leistung || ''), items, finished: iso(r.fertig), changed: Number(r.geaendert) || 0 }
}

/**
 * Neue und geänderte Checklisten übernehmen (wie mergeStamps: der neuere Stand gewinnt). Was die App dazu weiß, bleibt:
 * Ablage der Fotos in SharePoint (bei gleicher Datei) und „Gesehen“ des Büros. Liefert die Anzahl.
 */
export function mergeChecks(checks, list, index) {
  let n = 0
  for (const r of list || []) {
    const c = fromServer(r, index)
    if (!c) continue
    const key = checkKey(c)
    const old = checks[key]
    if (old && old.changed >= c.changed) continue
    if (old) {
      for (const it of c.items) {
        const prev = (old.items || []).find((x) => x.id === it.id)
        if (it.photo && prev?.photo?.datei === it.photo.datei) it.photo = { ...prev.photo }
      }
      if (old.seen) c.seen = old.seen
    }
    checks[key] = c
    n++
  }
  return n
}

/** Ablage des Fotos in SharePoint: plaene/checklisten/<Jahr>/<Datum>_<Objekt>_<Datei> (Rechte wie die Wochenpläne). */
export function checkPhotoPath(c, datei) {
  const safe = String(c.objectName || '').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'Objekt'
  return `plaene/checklisten/${c.date.slice(0, 4)}/${c.date}_${safe}_${datei}`
}

// ---------------------------------------------------------------- Auswerten

/** Stand einer Checkliste: { total, done, notPossible, open, photos, finished }. */
export function summaryOf(c) {
  const items = c?.items || []
  return {
    total: items.length,
    done: items.filter((x) => x.status === 'ok').length,
    notPossible: items.filter((x) => x.status === 'nicht').length,
    open: items.filter((x) => !x.status).length,
    photos: items.filter((x) => x.photo).length,
    finished: !!c?.finished,
  }
}

/** Kennzeichen der „nicht möglich“-Punkte (ändert sich, wenn ein neuer dazukommt oder der Grund sich ändert). */
export const notPossibleSig = (c) =>
  (c?.items || [])
    .filter((x) => x.status === 'nicht')
    .map((x) => `${x.id}:${x.reason}`)
    .join('|')

/**
 * Für „Zu erledigen“:
 *  - kind 'nicht': gemeldete „nicht möglich“-Punkte ab since, bis jemand im Büro „Gesehen“ klickt (seen.sig);
 *  - kind 'fehlt': Einsatz seit 30 Minuten vorbei, Checkliste nicht fertig. Welche Einsätze das sind, weiß nur der Webspace
 *    (dort steht, welche Einsätze die Checkliste wirklich bekommen haben; nur Personen, die sie schon benutzen, bis zum
 *    Ende der Frist am Handy): pending = [{ empId, instKey, date, time, objectName }] vom letzten Abruf.
 */
export function checkTodos({ checks = {}, pending = [], since = '0000-01-01' }) {
  const out = []
  const all = Object.values(checks || {})
  for (const c of all) {
    const sig = notPossibleSig(c)
    if (!sig || c.date < since || c.seen?.sig === sig) continue
    out.push({ kind: 'nicht', id: `nicht:${checkKey(c)}:${sig.length}`, key: checkKey(c), check: c, items: c.items.filter((x) => x.status === 'nicht') })
  }
  const byPerson = new Map(all.filter((c) => c.empId).map((c) => [`${c.instKey}|${c.empId}`, c]))
  for (const p of pending || []) {
    if (!p?.empId || !p.instKey) continue
    const c = byPerson.get(`${p.instKey}|${p.empId}`)
    if (c?.finished) continue // inzwischen fertig (nach dem Abruf übernommen)
    out.push({ kind: 'fehlt', id: `fehlt:${p.instKey}:${p.empId}`, ...p, check: c || null })
  }
  return out
}

/** Offene Einsätze vom Webspace (ck_offen in mein-plan.php) → pending für checkTodos; ohne bekannte Person weg. */
export const pendingFromServer = (list, index = new Map()) =>
  (Array.isArray(list) ? list : [])
    .filter((o) => /^\d{4}-\d{2}-\d{2}\|[^|]{1,80}$/.test(o?.einsatz || '') && /^\d{4}-\d{2}-\d{2}$/.test(o.datum || '') && index.get(o.hash))
    .map((o) => ({ empId: index.get(o.hash), instKey: o.einsatz, date: o.datum, time: String(o.zeit || ''), objectName: String(o.objekt || '') }))

// ---------------------------------------------------------------- Übersetzen mit der KI

/** Anfrage an die KI für alle Punkte einer Leistung (eine Liste je Sprache, gleiche Reihenfolge). */
export function checklistTranslationRequest(texts, langs) {
  const base = translationRequest('', langs)
  const list = texts.map((t, i) => `${i + 1}. ${String(t).slice(0, MAX_TEXT)}`).join('\n')
  return {
    system: base.system,
    messages: [{ role: 'user', content: `Übersetze jeden Punkt dieser Checkliste (${texts.length} Punkte, Reihenfolge beibehalten, ohne Nummern) in diese Sprachen (Schlüssel: Sprache, Wert: Liste der Punkte):\n${langs.join(', ')}\n\n<checkliste>\n${list}\n</checkliste>` }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: { type: 'object', properties: Object.fromEntries(langs.map((id) => [id, { type: 'array', items: { type: 'string' } }])), required: [...langs], additionalProperties: false },
      },
    },
  }
}

/** Antwort der KI → { tr: ['Punkt 1', …] }; nur Sprachen mit genau n nicht leeren Punkten. */
export function parseChecklistTranslation(raw, langs, n) {
  let data = null
  try {
    data = JSON.parse(String(raw || '').trim())
  } catch {
    const m = /\{[\s\S]*\}/.exec(String(raw || ''))
    try {
      data = m ? JSON.parse(m[0]) : null
    } catch {
      data = null
    }
  }
  if (!data || typeof data !== 'object') throw new Error('Die Antwort der KI war keine Übersetzung. Bitte noch einmal versuchen oder von Hand übersetzen.')
  const out = {}
  for (const id of langs) {
    const list = Array.isArray(data[id]) ? data[id].map((x) => String(x || '').replace(/^\s*\d+[.)]\s*/, '').trim().slice(0, MAX_TEXT)) : []
    if (list.length === n && list.every(Boolean)) out[id] = list
  }
  return out
}
