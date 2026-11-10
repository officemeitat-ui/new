// Wunschzeiten der Mitarbeitenden: Wunschfrei an einem Tag, lieber früh oder spät an einem Tag, mehr oder weniger
// Stunden in einer Woche. Die Wünsche kommen vom Handy („Plan am Handy“, mein-plan.php) oder werden im Büro
// eingetragen. Die Automatik (core/scheduler.js candidateFactors) berücksichtigt sie als weiche Vorgabe – sie sind
// keine Abwesenheit und kein Anspruch: Stammkräfte bleiben eingeteilt, offene Einsätze gehen lieber an andere.
// Nach dem Planen zeigt wishReport, wessen Wünsche erfüllt sind. Rein rechnend (test/wuensche.test.js).
//
// Daten je Woche (Wochenfeld wishes wie stamps): „Datum|wID“ → { id, empId, date, kind, note, source: 'handy'|'buero',
//   at, by }. Für mehr/weniger ist date der Montag der Woche.

import { addDays, mondayOf } from './dates.js'

export const WISH_KINDS = {
  frei: { label: 'Wunschfrei', week: false },
  frueh: { label: 'lieber früh (bis 12 Uhr)', week: false },
  spaet: { label: 'lieber spät (ab 14 Uhr)', week: false },
  mehr: { label: 'mehr Stunden in der Woche', week: true },
  weniger: { label: 'weniger Stunden in der Woche', week: true },
}
/** Höchstens so viele Wünsche je Person in einer Woche (Schutz vor „jeden Tag frei“). */
export const MAX_PER_WEEK = 4
/** Wünsche gehen so weit voraus (Tage ab heute). */
export const AHEAD_DAYS = 56
const NOTE = 160

const minutesOf = (hm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const wishKey = (w) => `${w.date}|${w.id}`

/**
 * Wunsch prüfen und vereinheitlichen. { wish } oder { error }. existing: Wünsche der Person (für die Grenze je Woche
 * und doppelte). today: frühestens morgen, höchstens AHEAD_DAYS voraus.
 */
export function makeWish(input = {}, { existing = [], today, newId = () => `w${Date.now().toString(36)}`, source = 'buero', at = new Date().toISOString(), by = '' } = {}) {
  const kind = WISH_KINDS[input.kind] ? input.kind : ''
  if (!kind) return { error: 'Bitte die Art des Wunsches wählen.' }
  if (!input.empId) return { error: 'Bitte die Person wählen.' }
  // nur Tage, die es gibt (wie mein-plan.php): 2026-11-31 würde sonst still zum 1. Dezember bzw. dessen Montag
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) || addDays(input.date, 0) !== input.date) return { error: 'Bitte das Datum angeben.' }
  const date = WISH_KINDS[kind].week ? mondayOf(input.date) : input.date
  if (today && (input.date <= today && !WISH_KINDS[kind].week)) return { error: 'Wünsche gehen nur für die Zukunft.' }
  if (today && WISH_KINDS[kind].week && addDays(date, 6) <= today) return { error: 'Diese Woche ist schon vorbei.' }
  if (today && date > addDays(today, AHEAD_DAYS)) return { error: `Wünsche höchstens ${AHEAD_DAYS / 7} Wochen voraus.` }
  const mine = existing.filter((w) => w.empId === input.empId)
  if (mine.some((w) => w.date === date && w.kind === kind)) return { error: 'Diesen Wunsch gibt es schon.' }
  if (kind === 'frueh' || kind === 'spaet') {
    if (mine.some((w) => w.date === date && (w.kind === 'frei' || (w.kind !== kind && (w.kind === 'frueh' || w.kind === 'spaet'))))) return { error: 'Für diesen Tag gibt es schon einen anderen Wunsch.' }
  }
  if (kind === 'frei' && mine.some((w) => w.date === date && !WISH_KINDS[w.kind]?.week)) return { error: 'Für diesen Tag gibt es schon einen anderen Wunsch.' }
  if (WISH_KINDS[kind].week && mine.some((w) => w.date === date && WISH_KINDS[w.kind]?.week)) return { error: 'Für diese Woche gibt es schon einen Stunden-Wunsch.' }
  const week = mondayOf(date)
  if (mine.filter((w) => mondayOf(w.date) === week).length >= MAX_PER_WEEK) return { error: `Höchstens ${MAX_PER_WEEK} Wünsche je Woche.` }
  return { wish: { id: newId(), empId: input.empId, date, kind, note: String(input.note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE), source, at, by } }
}

/** Wünsche als Nachschlag für die Automatik: Map „empId|Datum“ → [wish] (Wochenwünsche unter dem Montag). */
export function wishIndex(wishes = {}) {
  const map = new Map()
  for (const w of Object.values(wishes || {})) {
    if (!w?.empId || !w.date || !WISH_KINDS[w.kind]) continue
    const k = `${w.empId}|${w.date}`
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(w)
  }
  return map
}

/**
 * Gründe für die Automatik (wie candidateFactors: negativ spricht dafür, positiv dagegen). index: wishIndex,
 * inst: Einsatz mit date, startTime; Wunschfrei wiegt schwer, ist aber kein Verbot.
 */
export function wishFactors(index, empId, inst) {
  if (!index?.size) return []
  const out = []
  for (const w of index.get(`${empId}|${inst.date}`) || []) {
    const start = minutesOf(inst.startTime)
    if (w.kind === 'frei') out.push({ code: 'wish', points: 35, text: 'hat Wunschfrei', good: false })
    else if (w.kind === 'frueh' && start !== null) out.push(start < 12 * 60 ? { code: 'wish', points: -8, text: 'wünscht früh', good: true } : { code: 'wish', points: 12, text: 'wünscht früh', good: false })
    else if (w.kind === 'spaet' && start !== null) out.push(start >= 14 * 60 ? { code: 'wish', points: -8, text: 'wünscht spät', good: true } : { code: 'wish', points: 12, text: 'wünscht spät', good: false })
  }
  for (const w of index.get(`${empId}|${mondayOf(inst.date)}`) || []) {
    if (w.kind === 'mehr') out.push({ code: 'wish', points: -10, text: 'möchte mehr Stunden', good: true })
    if (w.kind === 'weniger') out.push({ code: 'wish', points: 15, text: 'möchte weniger Stunden', good: false })
  }
  return out
}

/**
 * Welche Wünsche erfüllt sind (nach der Einteilung): [{ wish, ok, text }]. instancesOf(empId): Einsätze der Person
 * (nicht abgesagt) mit date, startTime, net; contractMin(empId, monday): Vertragsminuten der Woche.
 */
export function wishReport(wishes = {}, { instancesOf, contractMin = () => 0, from = '', to = '9999-12-31' } = {}) {
  const out = []
  for (const w of Object.values(wishes || {})) {
    if (!w?.empId || !WISH_KINDS[w.kind]) continue
    const weekly = WISH_KINDS[w.kind].week
    const end = weekly ? addDays(w.date, 6) : w.date
    if (end < from || w.date > to) continue
    const own = (instancesOf(w.empId) || []).filter((i) => i.status !== 'cancelled')
    if (w.kind === 'frei') {
      const n = own.filter((i) => i.date === w.date).length
      out.push({ wish: w, ok: n === 0, text: n ? `${n} ${n === 1 ? 'Einsatz' : 'Einsätze'} an dem Tag` : 'frei' })
    } else if (w.kind === 'frueh' || w.kind === 'spaet') {
      const day = own.filter((i) => i.date === w.date)
      const bad = day.filter((i) => (w.kind === 'frueh' ? minutesOf(i.startTime) >= 12 * 60 : minutesOf(i.startTime) < 14 * 60))
      out.push({ wish: w, ok: !bad.length, text: !day.length ? 'kein Einsatz' : bad.length ? `${bad.map((i) => i.startTime).join(', ')} Uhr` : 'passt' })
    } else {
      const min = own.filter((i) => i.date >= w.date && i.date <= end).reduce((s, i) => s + (i.net || 0), 0)
      const c = contractMin(w.empId, w.date)
      const h = (m) => `${Math.round((m / 60) * 10) / 10}`.replace('.', ',')
      const ok = w.kind === 'mehr' ? min > c : min < c
      out.push({ wish: w, ok, text: `${h(min)} h geplant, Vertrag ${h(c)} h` })
    }
  }
  return out.sort((a, b) => a.wish.date.localeCompare(b.wish.date) || String(a.wish.empId).localeCompare(String(b.wish.empId)))
}

/** Erfüllungsquote je Person: Map empId → { total, ok }. */
export function wishStats(report = []) {
  const map = new Map()
  for (const r of report) {
    const x = map.get(r.wish.empId) || { total: 0, ok: 0 }
    x.total++
    if (r.ok) x.ok++
    map.set(r.wish.empId, x)
  }
  return map
}

/**
 * Wünsche vom Handy (mein-plan.php aktion=wuensche) mit den Wünschen in der App abgleichen. server: [{ id, hash, art,
 * datum, notiz, erstellt }], current: Wünsche der geladenen Wochen (Schlüssel → Wunsch), index: Hash → empId,
 * gone: am Webspace zu löschende Kennungen (im Büro gelöscht, noch nicht übertragen). Liefert { add: [Wunsch],
 * remove: [Schlüssel] }: neue Handy-Wünsche dazu; Handy-Wünsche, die am Webspace fehlen (am Handy gelöscht) und noch
 * nicht vorbei sind, weg. Vorbei sind sie am Webspace nach einer Woche ohnehin gelöscht – in der App bleiben sie.
 */
export function syncHandyWishes(server = [], current = {}, { index = new Map(), today = '', gone = [] } = {}) {
  const goneSet = new Set(gone)
  const ids = new Set()
  const known = new Set(Object.values(current || {}).map((w) => w?.webId).filter(Boolean))
  const add = []
  for (const s of server || []) {
    if (!s || typeof s.id !== 'string' || !/^[a-f0-9]{12}$/.test(s.id) || !WISH_KINDS[s.art] || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.datum || ''))) continue
    ids.add(s.id)
    const empId = index.get(s.hash)
    if (!empId || goneSet.has(s.id) || known.has(s.id)) continue
    const date = WISH_KINDS[s.art].week ? mondayOf(s.datum) : s.datum
    add.push({ id: `h${s.id}`, webId: s.id, empId, date, kind: s.art, note: String(s.notiz || '').replace(/\s+/g, ' ').trim().slice(0, NOTE), source: 'handy', at: s.erstellt ? new Date(s.erstellt * 1000).toISOString() : '', by: '' })
    known.add(s.id)
  }
  const remove = Object.entries(current || {})
    .filter(([, w]) => w?.source === 'handy' && w.webId && (goneSet.has(w.webId) || !ids.has(w.webId)) && (WISH_KINDS[w.kind]?.week ? addDays(w.date, 6) : w.date) >= today)
    .map(([k]) => k)
  return { add, remove }
}
