// Winterdienst-Protokoll: wer hat wann wo geräumt und gestreut (Nachweis für
// § 93 StVO und die Haftung nach § 1319a ABGB).
//
// Einträge kommen vom Handy (Link aus dem Schnee-Alarm, wetter-alarm.php) oder
// werden in der App erfasst. Gespeichert sind sie je Woche wie die Einteilung
// (data.winterlog: „Datum|Objekt|Eintrag“ → Eintrag), die Fotos in SharePoint
// unter exporte/Winterdienst/<Monat>/.
//
// Rein rechnend, ohne Netz testbar.

import { formatDate } from './dates.js'
import { viennaParts, viennaTime, WEATHER_DEFAULTS } from './weather.js'

export const STREUMITTEL = ['', 'Splitt', 'Salz', 'Sand', 'Splitt und Salz']
export const logKey = (e) => `${e.date}|${e.objectId}|${e.id}`

/** Eintrag vom Webspace (wetter-alarm.php) → Eintrag der App. */
export function fromServer(p) {
  const at = new Date(Number(p.erledigt) * 1000)
  return {
    id: `h${p.id}`,
    serverId: String(p.id),
    date: p.datum || viennaParts(at).date,
    objectId: String(p.objektId || ''),
    object: String(p.objekt || ''),
    address: String(p.adresse || ''),
    person: String(p.person || ''),
    at: at.toISOString(),
    geraeumt: !!p.geraeumt,
    gestreut: !!p.gestreut,
    kontrolle: !!p.kontrolle,
    mittel: STREUMITTEL.includes(p.mittel) ? p.mittel : '',
    notiz: String(p.notiz || '').slice(0, 500),
    fotos: (p.fotos || []).filter((f) => /^[a-f0-9]{12}-[1-4]\.(jpg|png|webp)$/.test(f)).map((datei) => ({ datei })),
    lage: String(p.lage || ''),
    quelle: 'Handy',
    test: !!p.test,
    entered: new Date(Number(p.eingetragen || p.erledigt) * 1000).toISOString(),
  }
}

/** Vom Webspace noch nicht übernommene Einträge (ohne Testalarme). */
export function newFromServer(serverEntries, log = {}) {
  const known = new Set(Object.values(log).map((e) => e.serverId).filter(Boolean))
  return (serverEntries || []).filter((p) => p && p.id && !p.test && !known.has(String(p.id))).map(fromServer)
}

/** Einträge eines Tags und Objekts, nach Uhrzeit. */
export const entriesFor = (log = {}, date, objectId) =>
  Object.values(log)
    .filter((e) => e.date === date && e.objectId === objectId)
    .sort((a, b) => a.at.localeCompare(b.at))

/** Was gemacht wurde, in Worten: „geräumt, gestreut (Splitt)“ bzw. „kontrolliert, nichts nötig“. */
export function workText(e) {
  if (e.kontrolle && !e.geraeumt && !e.gestreut) return 'kontrolliert, nichts nötig'
  return [e.geraeumt ? 'geräumt' : '', e.gestreut ? `gestreut${e.mittel ? ` (${e.mittel})` : ''}` : ''].filter(Boolean).join(', ')
}

/**
 * Angelegter Winterdienst (data.winter) ohne Protokoll, wenn die Frist vorbei ist
 * (fertig-bis des Objekts plus `graceH` Stunden). Liefert [{ date, object, until }].
 */
export function missingLogs({ winter = {}, log = {}, objects = [], now = Date.now(), weatherRules = {}, graceH = 2 }) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const c = { ...WEATHER_DEFAULTS, ...weatherRules }
  const out = []
  for (const [key, call] of Object.entries(winter)) {
    if (!call || call.cancelled) continue
    const [date, objectId] = key.split('|')
    const object = byId.get(objectId)
    if (!object?.winter?.active) continue
    const until = /^\d{2}:\d{2}$/.test(object.winter.until || '') ? object.winter.until : c.winterUntil
    if (now < viennaTime(date, until) + graceH * 3600e3) continue
    if (entriesFor(log, date, objectId).length) continue
    out.push({ date, object, until })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.object.name.localeCompare(b.object.name))
}

/** Zeilen fürs Protokoll eines Zeitraums (Tabelle und PDF), nach Tag, Uhrzeit, Objekt. */
export function logRows(log = {}, { from, to, objectsById = new Map() } = {}) {
  return Object.values(log)
    .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
    .map((e) => {
      const o = objectsById.get(e.objectId)
      return { ...e, objectName: o?.name || e.object || 'Objekt', address: o?.address || e.address || '', time: viennaParts(e.at).date === e.date ? timeOf(e.at) : `${formatDate(viennaParts(e.at).date)} ${timeOf(e.at)}` }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at) || a.objectName.localeCompare(b.objectName))
}

const timeOf = (iso) => {
  const p = viennaParts(iso)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Dateiname eines Fotos in SharePoint: exporte/Winterdienst/2026-12/2026-12-02_Wohnanlage-Lehen_ab12cd34ef56-1.jpg */
export function photoPath(e, datei, objectName = e.object) {
  const safe = String(objectName || 'Objekt').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `exporte/Winterdienst/${e.date.slice(0, 7)}/${e.date}_${safe}_${datei}`
}
