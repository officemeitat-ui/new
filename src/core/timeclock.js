// Zeiterfassung im Objekt (QR-Code, mein-plan.php): Stempelungen vom Webspace übernehmen und mit
// dem Plan vergleichen.
//
// Gespeichert je Woche (Feld stamps, Schlüssel „Datum|zID“):
//   { id, date, empId, name, objectId, objectName, instKey, plan, in, out, changed }
// date ist der Tag des Einsatzes laut Plan (bzw. der Tag des Kommens ohne Plan), in/out ISO-Zeiten.
// Die Stunden im Wochenzettel bleiben die geplanten; die Ist-Zeiten zeigen Abweichungen zum Prüfen.

import { dayIndex } from './dates.js'
import { viennaParts } from './weather.js'

export const stampKey = (s) => `${s.date}|z${s.id}`

/** Datensatz vom Webspace → App (null, wenn unbrauchbar). */
export function fromServer(r, index = new Map()) {
  if (!/^[a-f0-9]{12}$/.test(r?.id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(r.datum || '') || !(Number(r.kommen) > 0)) return null
  const iso = (s) => new Date(Number(s) * 1000).toISOString()
  return {
    id: r.id,
    date: r.datum,
    empId: index.get(r.hash) || null,
    name: String(r.name || ''),
    objectId: String(r.objektId || ''),
    objectName: String(r.objekt || ''),
    instKey: typeof r.einsatz === 'string' && r.einsatz.startsWith(`${r.datum}|`) ? r.einsatz : '',
    plan: String(r.plan || ''),
    in: iso(r.kommen),
    out: Number(r.gehen) > 0 ? iso(r.gehen) : null,
    changed: Number(r.geaendert) || Number(r.kommen),
  }
}

/** Neue und geänderte Stempelungen übernehmen (z. B. „Gehen“ nachgetragen). Liefert die Anzahl. */
export function mergeStamps(stamps, list, index) {
  let n = 0
  for (const r of list || []) {
    const s = fromServer(r, index)
    if (!s) continue
    const key = stampKey(s)
    if (stamps[key] && stamps[key].changed >= s.changed) continue
    stamps[key] = s
    n++
  }
  return n
}

/** ISO-Zeit → Minuten wie inst.start (Tagesindex × 1440 + Minuten, Wiener Zeit). */
export function absMinutes(iso) {
  const p = viennaParts(iso)
  return dayIndex(p.date) * 1440 + p.hour * 60 + p.minute
}

/** Wer die Zeiterfassung benutzt (mindestens eine Stempelung): nur diese gelten als „fehlt“. */
export const stampUsers = (stamps) => new Set(Object.values(stamps || {}).map((s) => s.empId).filter(Boolean))

/**
 * Plan gegen Ist je eingeteilter Person: Zeilen { date, inst, empId, stamp, status, late, early, minutes }.
 * status: ok | spaet | frueh | laenger (früher gekommen oder später gegangen) | offen (noch nicht gegangen) | fehlt | kommt (noch nicht begonnen) | ohnePlan.
 * Nur Personen in users bekommen „fehlt“/„kommt“-Zeilen; Stempelungen ohne passenden Einsatz kommen dazu.
 */
export function stampRows({ instances, state, stamps, from, to, users, now, tolerance = 10 }) {
  const list = Object.values(stamps || {}).filter((s) => s.date >= from && s.date <= to)
  const used = new Set()
  const rows = []
  for (const inst of instances) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to) continue
    for (const { employeeId: empId } of state.assigned(inst.key)) {
      const stamp = list.find((s) => !used.has(s.id) && s.empId === empId && s.instKey === inst.key) || list.find((s) => !used.has(s.id) && s.empId === empId && !s.instKey && s.date === inst.date && s.objectId === inst.objectId)
      if (stamp) used.add(stamp.id)
      if (!stamp && !users.has(empId)) continue
      rows.push({ date: inst.date, inst, empId, stamp: stamp || null, ...judge(inst, stamp, now, tolerance) })
    }
  }
  for (const s of list) if (!used.has(s.id)) rows.push({ date: s.date, inst: null, empId: s.empId, stamp: s, status: 'ohnePlan', late: 0, early: 0, minutes: s.out ? absMinutes(s.out) - absMinutes(s.in) : null })
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.inst?.start ?? absMinutes(a.stamp.in)) - (b.inst?.start ?? absMinutes(b.stamp.in)))
}

function judge(inst, stamp, now, tolerance) {
  if (!stamp) return { status: now >= inst.start + tolerance ? 'fehlt' : 'kommt', late: 0, early: 0, minutes: null }
  const inM = absMinutes(stamp.in)
  const outM = stamp.out ? absMinutes(stamp.out) : null
  const late = Math.max(0, inM - inst.start)
  const early = outM === null ? 0 : Math.max(0, inst.end - outM)
  // länger als geplant (früher gekommen, später gegangen): Mehrstunden, die erst mit „Ist übernehmen“ zählen
  const over = outM === null ? 0 : Math.max(0, outM - inst.end) + Math.max(0, inst.start - inM)
  const status = outM === null ? 'offen' : late > tolerance ? 'spaet' : early > tolerance ? 'frueh' : over > tolerance ? 'laenger' : 'ok'
  // Dauer echt gemessen (auch in der Nacht der Zeitumstellung), Verspätung gegen den Plan in Ortszeit
  const minutes = outM === null ? null : Math.floor(Date.parse(stamp.out) / 6e4) - Math.floor(Date.parse(stamp.in) / 6e4)
  return { status, late, early, over, minutes }
}

/** Nicht eingestempelt: begonnene Einsätze (seit mehr als grace Minuten, bis zum Ende) ohne Stempelung. */
export function missingCheckins({ instances, state, stamps, users, now, grace = 20 }) {
  const days = new Set(instances.filter((i) => i.start <= now && now <= i.end).map((i) => i.date))
  if (!days.size) return []
  const from = [...days].sort()[0]
  const to = [...days].sort().at(-1)
  return stampRows({ instances, state, stamps, from, to, users, now, tolerance: grace }).filter((r) => r.status === 'fehlt' && r.inst.end >= now)
}

export const STATUS_TEXT = { ok: 'passt', spaet: 'später gekommen', frueh: 'früher gegangen', laenger: 'länger als geplant', offen: 'noch nicht ausgestempelt', fehlt: 'nicht eingestempelt', kommt: 'beginnt noch', ohnePlan: 'ohne Einsatz laut Plan' }
