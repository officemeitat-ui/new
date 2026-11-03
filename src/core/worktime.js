// Arbeitszeit aus der Zeiterfassung: Zeiten nachtragen und korrigieren (mit Grund und Verlauf),
// Pausen, Freigabe, Ruhepausen-Prüfung (§ 11 AZG) und Monatsübersicht je Person (Soll laut Plan
// gegen Ist laut Zeiterfassung) als Grundlage der Arbeitszeitaufzeichnung (§ 26 AZG).
//
// Stempelungen wie in timeclock.js ({ id, date, empId, objectId, instKey, in, out }), dazu:
//   source 'manuell' (nachgetragen), pause (Minuten), reason/note, by/at,
//   orig { in, out } (erster Stand vor einer Korrektur), changes [{ at, by, reason, before }],
//   approved { by, at } (geprüft und freigegeben).

import { absMinutes } from './timeclock.js'

export const REASONS = [
  ['vergessen', 'Stempeln vergessen'],
  ['handy', 'Handy/Netz ging nicht'],
  ['falsch', 'falsch gestempelt (anderes Objekt, zu früh/spät)'],
  ['laenger', 'Einsatz hat länger gedauert'],
  ['kuerzer', 'Einsatz früher beendet'],
  ['sonstiges', 'Sonstiges'],
]
export const reasonLabel = (r) => REASONS.find(([id]) => id === r)?.[1] || r || ''

/** Ortszeit (Datum + „06:30“) → ISO-Zeit (Wiener Zeit, Sommer/Winter richtig). */
export function viennaIso(date, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  // Näherung mit +01:00, dann um den tatsächlichen Versatz korrigieren
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+01:00`)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess)
  const shownH = Number(parts.find((p) => p.type === 'hour').value)
  const diff = ((shownH - h + 24) % 24) * 60
  return new Date(guess.getTime() - diff * 60e3).toISOString()
}

const rnd = () => Math.random().toString(16).slice(2, 13).padEnd(11, '0')

/**
 * Nachgetragene Zeit. von/bis „HH:MM“; bis vor von = über Mitternacht. Liefert die Stempelung.
 * Pflicht: Person, Datum, Kommen und ein Grund.
 */
export function manualStamp({ date, empId, name = '', objectId = '', objectName = '', instKey = '', from, to = '', pause = 0, reason, note = '', by = '', at = new Date().toISOString() }) {
  if (!empId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(from || '')) throw new Error('Person, Datum und Kommen angeben.')
  if (!reason) throw new Error('Bitte einen Grund wählen.')
  const inIso = viennaIso(date, from)
  let outIso = null
  if (to) {
    if (!/^\d{2}:\d{2}$/.test(to)) throw new Error('Gehen als Uhrzeit angeben.')
    const next = to <= from ? new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) : date
    outIso = viennaIso(next, to)
  }
  return { id: `m${rnd()}`, date, empId, name, objectId, objectName, instKey, plan: '', in: inIso, out: outIso, changed: Math.floor(Date.parse(at) / 1000), source: 'manuell', pause: Math.max(0, Number(pause) || 0), reason, ...(note ? { note } : {}), by, at }
}

/** Korrektur einer Stempelung: neue Zeiten mit Grund; der erste Stand bleibt in orig, jede Änderung im Verlauf. */
export function correctStamp(stamp, { from, to = '', pause, reason, note = '', by = '', at = new Date().toISOString() }) {
  if (!reason) throw new Error('Bitte einen Grund für die Korrektur wählen.')
  const fixed = manualStamp({ date: stamp.date, empId: stamp.empId, from, to, pause: pause ?? stamp.pause ?? 0, reason, by, at })
  const before = { in: stamp.in, out: stamp.out, pause: stamp.pause || 0 }
  return {
    ...stamp,
    in: fixed.in,
    out: fixed.out,
    pause: fixed.pause,
    orig: stamp.orig || { in: stamp.in, out: stamp.out },
    changes: [...(stamp.changes || []), { at, by, reason, ...(note ? { note } : {}), before }],
    changed: Math.max(Number(stamp.changed) || 0, fixed.changed),
    approved: undefined,
  }
}

/** Netto-Minuten einer Stempelung (ohne Pause); null, solange nicht gegangen. */
export function netMinutes(stamp) {
  if (!stamp?.in || !stamp.out) return null
  return Math.max(0, absMinutes(stamp.out) - absMinutes(stamp.in) - (Number(stamp.pause) || 0))
}

/**
 * Ruhepause (§ 11 AZG): bei mehr als 6 Stunden Arbeit am Tag mindestens 30 Minuten Unterbrechung.
 * Zählt eingetragene Pausen und Lücken von mindestens 30 Minuten zwischen den Einsätzen.
 * Liefert [{ empId, date, minutes }] für Tage ohne ausreichende Pause.
 */
export function breakWarnings(stamps = [], { limit = 360, pause = 30 } = {}) {
  const byDay = new Map()
  for (const s of stamps) {
    if (!s.empId || !s.in || !s.out) continue
    const k = `${s.empId}|${s.date}`
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(s)
  }
  const out = []
  for (const [k, list] of byDay) {
    const sorted = list.slice().sort((a, b) => absMinutes(a.in) - absMinutes(b.in))
    const minutes = sorted.reduce((n, s) => n + (netMinutes(s) || 0), 0)
    if (minutes <= limit) continue
    const recorded = sorted.some((s) => (Number(s.pause) || 0) >= pause)
    const gap = sorted.some((s, i) => i > 0 && absMinutes(s.in) - absMinutes(sorted[i - 1].out) >= pause)
    if (!recorded && !gap) {
      const [empId, date] = k.split('|')
      out.push({ empId, date, minutes })
    }
  }
  return out
}

/** Freigeben: alle vollständigen Stempelungen der Liste (die noch nicht freigegeben sind). Liefert die Anzahl. */
export function approveAll(stamps, { by = '', at = new Date().toISOString() } = {}) {
  let n = 0
  for (const s of stamps) {
    if (!s.out || s.approved) continue
    s.approved = { by, at }
    n++
  }
  return n
}

/**
 * Monatsübersicht je Person aus den Zeilen von stampRows (Plan gegen Ist) des Monats:
 * { empId, soll (Minuten laut Plan), ist (netto laut Zeiterfassung), diff, spaet, frueh, fehlt, manuell, offen (nicht freigegeben), tage }.
 * Soll zählt nur Einsätze von Personen, die die Zeiterfassung benutzen (sonst wäre Ist immer 0).
 */
export function monthSummary(rows) {
  const by = new Map()
  const get = (id) => {
    if (!by.has(id)) by.set(id, { empId: id, soll: 0, ist: 0, diff: 0, spaet: 0, frueh: 0, fehlt: 0, manuell: 0, offen: 0, tage: new Set() })
    return by.get(id)
  }
  for (const r of rows) {
    if (!r.empId) continue
    const p = get(r.empId)
    if (r.inst) p.soll += r.inst.net ?? r.inst.end - r.inst.start
    const net = netMinutes(r.stamp)
    if (net !== null) {
      p.ist += net
      p.tage.add(r.date)
    }
    if (r.status === 'spaet') p.spaet++
    if (r.status === 'frueh') p.frueh++
    if (r.status === 'fehlt') p.fehlt++
    if (r.stamp?.source === 'manuell' || r.stamp?.changes?.length) p.manuell++
    if (r.stamp?.out && !r.stamp.approved) p.offen++
  }
  return [...by.values()].map((p) => ({ ...p, diff: p.ist - p.soll, tage: p.tage.size }))
}
