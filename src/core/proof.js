// Leistungsnachweis für Kunden: was im Objekt in einem Monat laut Plan geleistet wurde, mit den
// gestempelten Zeiten aus der Zeiterfassung (wo vorhanden) und dem Winterdienst-Protokoll.
//
// Je Einsatz: erbracht | bestaetigt (mit Zeiterfassung) | entfallen (Feiertag, abgesagt) | geplant (liegt
// noch in der Zukunft) | offen (vorbei, aber niemand eingeteilt: vor dem Versand prüfen).
// Namen der Mitarbeitenden nur, wenn gewünscht (keine, Vornamen, ganze Namen).

import { absMinutes } from './timeclock.js'
import { viennaParts } from './weather.js'

export const PROOF_STATUS = { erbracht: 'erbracht', bestaetigt: 'erbracht', entfallen: 'entfällt', geplant: 'geplant', offen: 'nicht besetzt' }
export const NAME_MODES = { keine: 'keine Namen', vorname: 'Vornamen', voll: 'ganze Namen' }

const hhmm = (iso) => {
  const p = viennaParts(iso)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
const personName = (emp, mode) => (!emp || mode === 'keine' ? '' : mode === 'vorname' ? String(emp.name || '').split(/\s+/)[0] : emp.name || '')

/**
 * Nachweis eines Objekts für from–to (now: Minuten wie inst.end, z. B. absMinutes(jetzt), sonst zählt heute ganz):
 *   { rows: [{ date, start, time, label, category, status, reason, staff, persons, ist: [{ in, out, minutes }], planMinutes, istMinutes }],
 *     totals: { count, done, confirmed, cancelled, planned, open, planMinutes, istMinutes, special } }
 * planMinutes zählen nur erbrachte Einsätze (Nettozeit × Personen laut Plan).
 */
export function proofFor({ objectId, from, to, instances = [], state, stamps = {}, employeesById = new Map(), today, now = null, names = 'keine' }) {
  const stampList = Object.values(stamps || {}).filter((s) => s.objectId === objectId && s.date >= from && s.date <= to)
  const used = new Set()
  const rows = []
  // Stempelungen ohne Einsatz-Kennung: zum zeitlich nächsten Einsatz der Person an dem Tag (zwei Einsätze,
  // zwei Stempelungen: je eine, nicht beide auf den ersten)
  const best = new Map()
  for (const s of stampList) {
    if (s.instKey || !employeesById.has(s.empId)) continue
    let pick = null
    let dist = Infinity
    for (const inst of instances) {
      if (inst.objectId !== objectId || inst.status === 'cancelled' || inst.date !== s.date) continue
      if (!state.assigned(inst.key).some((a) => a.employeeId === s.empId)) continue
      const d = Math.abs(absMinutes(s.in) - inst.start)
      if (d < dist) {
        dist = d
        pick = inst.key
      }
    }
    if (pick) best.set(s.id, pick)
  }
  for (const inst of instances) {
    if (inst.objectId !== objectId) continue
    if (inst.status === 'cancelled') {
      if (inst.origDate < from || inst.origDate > to) continue
      rows.push({ date: inst.origDate, start: inst.start, time: `${inst.startTime}–${inst.endTime}`, label: inst.label || '', category: inst.category, status: 'entfallen', reason: inst.reason === 'holiday' ? `Feiertag${inst.origHoliday?.name ? ` (${inst.origHoliday.name})` : ''}` : 'abgesagt', staff: inst.staff, persons: [], ist: [], planMinutes: 0, istMinutes: 0 })
      continue
    }
    if (inst.date < from || inst.date > to) continue
    const assigned = state.assigned(inst.key).map((a) => a.employeeId).filter((id) => employeesById.has(id))
    const own = stampList.filter((s) => !used.has(s.id) && (s.instKey === inst.key || (!s.instKey && best.get(s.id) === inst.key && assigned.includes(s.empId))))
    own.forEach((s) => used.add(s.id))
    const ist = own
      .map((s) => ({ in: hhmm(s.in), out: s.out ? hhmm(s.out) : null, minutes: s.out ? Math.floor(Date.parse(s.out) / 6e4) - Math.floor(Date.parse(s.in) / 6e4) : null, at: s.in }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ at, ...x }) => x)
    // noch nicht vorbei (später am Tag oder läuft gerade): geplant
    const status = inst.date > today || (now !== null && inst.end > now) ? 'geplant' : !assigned.length ? 'offen' : ist.length ? 'bestaetigt' : 'erbracht'
    const done = status === 'erbracht' || status === 'bestaetigt'
    rows.push({
      date: inst.date,
      start: inst.start,
      time: `${inst.startTime}–${inst.endTime}`,
      label: inst.label || '',
      category: inst.category,
      status,
      reason: inst.status === 'moved' ? (inst.reason === 'holiday' ? 'wegen Feiertag verschoben' : 'verschoben') : '',
      staff: assigned.length || inst.staff,
      persons: assigned.map((id) => personName(employeesById.get(id), names)).filter(Boolean),
      ist,
      planMinutes: done ? inst.net * Math.max(1, assigned.length) : 0,
      istMinutes: ist.reduce((sum, x) => sum + (x.minutes || 0), 0),
    })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  const count = (st) => rows.filter((r) => st.includes(r.status)).length
  return {
    rows,
    totals: {
      count: rows.filter((r) => r.status !== 'entfallen').length,
      done: count(['erbracht', 'bestaetigt']),
      confirmed: count(['bestaetigt']),
      cancelled: count(['entfallen']),
      planned: count(['geplant']),
      open: count(['offen']),
      planMinutes: rows.reduce((s, r) => s + r.planMinutes, 0),
      istMinutes: rows.reduce((s, r) => s + r.istMinutes, 0),
      special: rows.filter((r) => r.category === 'sonder' && r.status !== 'entfallen').length,
    },
  }
}

/** Objekte mit mindestens einem Einsatz im Zeitraum (auch entfallene). */
export function objectsWithWork(instances = [], { from, to }) {
  const ids = new Set()
  for (const i of instances) if ((i.status === 'cancelled' ? i.origDate : i.date) >= from && (i.status === 'cancelled' ? i.origDate : i.date) <= to) ids.add(i.objectId)
  return ids
}

/** Schlüssel für den Versand-Vermerk: „2026-10|o5“. */
export const sentKey = (month, objectId) => `${month}|${objectId}`

/** Text der E-Mail an den Kunden. */
export function proofMailText({ objectName, monthLabel, totals, company = '', sender = '', contact = '' }) {
  return [
    contact ? `Guten Tag ${contact},` : 'Sehr geehrte Damen und Herren,',
    '',
    `anbei der Leistungsnachweis für ${objectName}, ${monthLabel}: ${totals.done} ${totals.done === 1 ? 'Einsatz' : 'Einsätze'} erbracht${totals.cancelled ? `, ${totals.cancelled} entfallen` : ''}${totals.confirmed ? `, davon ${totals.confirmed} mit Zeiterfassung im Objekt` : ''}.`,
    '',
    'Bei Fragen melden Sie sich gerne.',
    '',
    'Mit freundlichen Grüßen',
    sender,
    company,
  ]
    .filter((x, i, all) => x !== '' || all[i - 1] !== '')
    .join('\n')
    .trim()
}
