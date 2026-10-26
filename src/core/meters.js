// Zählerstände nach dem bewährten Modell des Wasserzähler-Tools:
//
//  - Zählstelle mit stabiler ID (über Jahre und Zählertausch gleich). Die
//    Zählernummer ist eine Eigenschaft mit Verlauf (Tausch oder Berichtigung).
//  - Ablesung je Zeitraum (meist Quartal): Stand oder Grund ohne Stand
//    (kein Zutritt, nicht ablesbar, nicht gefunden, Abriss). Beim Tausch
//    gehören Endstand alt und Anfangsstand neu zur Ablesung; beide werden
//    bewusst nicht automatisch vorbelegt (bis dahin „Tausch unvollständig“).
//  - Fällig: 30 Tage vor bis 60 Tage nach Ende des Zeitraums (einstellbar).
//  - Verbrauch wird nie gespeichert, immer gerechnet: Stand − letzter gültiger
//    Stand; beim Tausch (Endstand alt − Vorstand) + (Stand − Anfangsstand neu).
//  - Vergleich mit demselben Zeitraum im Vorjahr, sonst mit dem Schnitt:
//    kritisch (negativ oder über 2,5-fach), hoch (0 oder über 1,4-fach),
//    niedrig (unter 25 %).
//
// Daten (zaehler/zaehler.json):
//   meters:   [{ id, objectId, number, kind, location, unit, interval, note?, objektNr?, state?: 'abriss',
//                installedAt?, history: [{ at, date, type: 'tausch'|'korrektur', from, to, by?, note? }] }]
//   readings: [{ id, meterId, period, date, value: Zahl|null, reason?, swap?: { oldNumber, newNumber, oldEnd, newStart },
//                by?, note?, photo?, estimated?, at }]
//   closures: { 'objektId|2026-Q3': { at, by } }   abgeschlossene Runden (gesperrt)

import { addDays, dayIndex, lastOfMonth, MONTH_LONG, todayISO } from './dates.js'
import { parseTable } from './importer.js'

export const METER_KINDS = {
  kaltwasser: { label: 'Kaltwasser', unit: 'm³' },
  warmwasser: { label: 'Warmwasser', unit: 'm³' },
  strom: { label: 'Strom', unit: 'kWh' },
  gas: { label: 'Gas', unit: 'm³' },
  waerme: { label: 'Wärme', unit: 'kWh' },
  sonstig: { label: 'Sonstiger Zähler', unit: '' },
}

export const INTERVALS = {
  monat: { label: 'monatlich', months: 1 },
  quartal: { label: 'quartalsweise', months: 3 },
  halbjahr: { label: 'halbjährlich', months: 6 },
  jahr: { label: 'jährlich', months: 12 },
}

/** Ablesung ohne Stand: Gründe wie im Wasserzähler-Tool. */
export const REASONS = {
  kein_zutritt: 'Kein Zutritt',
  nicht_lesbar: 'Zähler nicht ablesbar',
  nicht_gefunden: 'Zähler nicht gefunden',
  abriss: 'Abriss',
}

export const DEFAULT_WINDOW = { before: 30, after: 60 }
/** Schwellen der Plausibilität (Vielfaches des Vergleichswerts). */
export const LIMITS = { critical: 2.5, high: 1.4, low: 0.25 }

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d
const days = (a, b) => dayIndex(b) - dayIndex(a)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const meterLabel = (m) => `${METER_KINDS[m.kind]?.label || 'Zähler'}${m.location ? ` · ${m.location}` : ''}`
export const unitOf = (m) => m.unit || METER_KINDS[m.kind]?.unit || ''
export const isActive = (m, date = '9999-12-31') => m.state !== 'abriss' && (!m.removedAt || m.removedAt > date)

/** Eingabe „1.234,5“, „1234.5“ oder „ 12,3 “ → Zahl (oder null). */
export function parseValue(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  let s = String(text ?? '').replace(/\s/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const fmt = (v) => (v ?? 0).toLocaleString('de-AT', { maximumFractionDigits: 3 })
const dmy = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
export { fmt as formatValue }

// ---------------------------------------------------------------- Zeiträume

/** Zeitraum, in dem ein Datum liegt: { key: '2026-Q3', from, to, label }. */
export function periodOf(date, interval = 'quartal') {
  const months = INTERVALS[interval]?.months || 3
  const y = Number(date.slice(0, 4))
  const m0 = Math.floor((Number(date.slice(5, 7)) - 1) / months) * months
  const from = `${y}-${String(m0 + 1).padStart(2, '0')}-01`
  const to = lastOfMonth(`${y}-${String(m0 + months).padStart(2, '0')}-01`)
  const key = months === 1 ? `${y}-${String(m0 + 1).padStart(2, '0')}` : months === 3 ? `${y}-Q${m0 / 3 + 1}` : months === 6 ? `${y}-H${m0 ? 2 : 1}` : String(y)
  const label = months === 1 ? `${MONTH_LONG[m0]} ${y}` : months === 3 ? `Q${m0 / 3 + 1} ${y}` : months === 6 ? `${m0 ? '2.' : '1.'} Halbjahr ${y}` : String(y)
  return { key, from, to, label }
}

/** Zeitraum aus seinem Schlüssel („2026-Q3“, „2026-10“, „2026-H2“, „2026“). */
export function periodByKey(key) {
  let m = key.match(/^(\d{4})-Q([1-4])$/)
  if (m) return periodOf(`${m[1]}-${String(m[2] * 3).padStart(2, '0')}-01`, 'quartal')
  m = key.match(/^(\d{4})-H([12])$/)
  if (m) return periodOf(`${m[1]}-${m[2] === '1' ? '01' : '07'}-01`, 'halbjahr')
  m = key.match(/^(\d{4})-(\d{2})$/)
  if (m) return periodOf(`${key}-01`, 'monat')
  return periodOf(`${key}-01-01`, 'jahr')
}

export const prevPeriod = (p, interval) => periodOf(addDays(p.from, -1), interval)
export const nextPeriod = (p, interval) => periodOf(addDays(p.to, 1), interval)

/**
 * Zu welchem Zeitraum gehört eine Ablesung an diesem Tag? Kurz nach dem
 * Stichtag (bis `after` Tage) zählt sie zum vorigen Zeitraum, sonst zum
 * laufenden (im Oktober also Q3).
 */
export function periodFor(date, interval = 'quartal', window = DEFAULT_WINDOW) {
  const cur = periodOf(date, interval)
  if (date >= addDays(cur.to, -window.before)) return cur
  const prev = prevPeriod(cur, interval)
  return date <= addDays(prev.to, window.after) ? prev : cur
}

// ---------------------------------------------------------------- Ablesungen

/** Ablesungen einer Zählstelle, nach Datum sortiert. */
export function readingsOf(zaehler, meterId) {
  return (zaehler?.readings || []).filter((r) => r.meterId === meterId).sort((a, b) => a.date.localeCompare(b.date) || (a.at || '').localeCompare(b.at || ''))
}

export const hasValue = (r) => num(r?.value) !== null
const swapOpen = (s) => num(s.oldEnd) === null || num(s.newStart) === null
const swapIncomplete = (r) => !!r.swap && swapOpen(r.swap)

/**
 * Verbrauch zwischen aufeinanderfolgenden gültigen Ständen. Beim Tausch:
 * (Endstand alt − Vorstand) + (Stand − Anfangsstand neu); fehlt einer der
 * beiden Werte, ist der Verbrauch unbekannt (incomplete). Ein Tausch ohne
 * Stand (nur Endstand alt und Anfangsstand neu) gilt beim nächsten Stand.
 */
export function segments(readings) {
  const out = []
  let prev = null
  let pending = []
  for (const r of readings) {
    if (!hasValue(r)) {
      if (r.swap) pending.push(r.swap)
      continue
    }
    const swaps = [...pending, ...(r.swap ? [r.swap] : [])]
    pending = []
    if (prev) {
      const d = Math.max(0, days(prev.date, r.date))
      let delta = round(r.value - prev.value)
      let incomplete = false
      if (swaps.some(swapOpen)) {
        delta = null
        incomplete = true
      } else if (swaps.length) {
        // je Zähler: bis zum Endstand, dann ab dem Anfangsstand des nächsten
        let from = prev.value
        let sum = 0
        for (const s of swaps) {
          sum += s.oldEnd - from
          from = s.newStart
        }
        delta = round(sum + r.value - from)
      }
      out.push({ from: prev.date, to: r.date, days: d, delta, perDay: delta !== null && d ? delta / d : null, reading: r, prev, incomplete })
    }
    prev = r
  }
  return out
}

/** Verbrauch pro Tag im Zeitraum [a, b], gewichtet aus den Abschnitten (mind. halb abgedeckt). */
function rateBetween(segs, a, b) {
  const want = Math.max(1, days(a, b))
  let covered = 0
  let sum = 0
  for (const s of segs) {
    if (s.perDay === null || s.delta < 0) continue
    const overlap = Math.min(dayIndex(b), dayIndex(s.to)) - Math.max(dayIndex(a), dayIndex(s.from))
    if (overlap <= 0) continue
    covered += overlap
    sum += s.perDay * overlap
  }
  return covered >= want / 2 ? sum / covered : null
}

/** Schnitt pro Tag aus allen Abschnitten (ohne negative und unvollständige). */
export function averagePerDay(readings) {
  const segs = segments(readings).filter((s) => s.perDay !== null && s.delta >= 0 && s.days >= 7)
  const d = segs.reduce((x, s) => x + s.days, 0)
  return d ? segs.reduce((x, s) => x + s.delta, 0) / d : null
}

/** Erwarteter Verbrauch zwischen zwei Daten: Vorjahr im selben Zeitraum, sonst Schnitt. */
export function expectedBetween(readings, from, to) {
  const segs = segments(readings.filter((r) => r.date <= from))
  const rate = rateBetween(segs, addDays(from, -365), addDays(to, -365)) ?? (() => {
    const usable = segs.filter((s) => s.perDay !== null && s.delta >= 0 && s.days >= 7)
    const d = usable.reduce((x, s) => x + s.days, 0)
    return d ? usable.reduce((x, s) => x + s.delta, 0) / d : null
  })()
  return rate === null ? null : rate * Math.max(0, days(from, to))
}

/**
 * Bewertung einer (neuen oder vorhandenen) Ablesung gegen die bisherigen.
 * Liefert Hinweise [{ level: 'error'|'warning'|'info', code, text }].
 * code: kritisch | hoch | niedrig | leer | tausch | tausch_unvollstaendig | kein_stand | spaeter
 */
export function checkReading(meter, readings, reading) {
  const { date } = reading
  const unit = unitOf(meter)
  if (reading.reason) return [{ level: 'info', code: 'kein_stand', text: `${REASONS[reading.reason] || 'Kein Stand'}: zählt als erledigt, Verbrauch wird beim nächsten Stand über beide Zeiträume gerechnet.` }]
  const value = num(reading.value)
  if (value === null) return [{ level: 'error', code: 'fehlt', text: 'Zählerstand fehlt.' }]
  const issues = []
  const others = readings.filter((r) => r.id !== reading.id)
  const before = others.filter((r) => hasValue(r) && r.date <= date)
  const prev = before.at(-1)
  // nächste spätere Ablesung; ist sie ein Tausch, gilt dessen Endstand alt (danach zählt der neue Zähler)
  const later = reading.swap ? null : others.find((r) => r.date > date && (hasValue(r) || r.swap))
  const limit = later ? (later.swap ? num(later.swap.oldEnd) : later.value) : null
  if (limit !== null && value > limit) issues.push({ level: 'error', code: 'spaeter', text: later.swap ? `Größer als der Endstand des alten Zählers beim Tausch (${fmt(limit)} am ${dmy(later.date)}).` : `Größer als die spätere Ablesung (${fmt(limit)} am ${dmy(later.date)}).` })
  if (reading.swap) {
    if (swapIncomplete(reading)) return [...issues, { level: 'warning', code: 'tausch_unvollstaendig', text: 'Zählertausch unvollständig: Endstand des alten und Anfangsstand des neuen Zählers eintragen, sonst kann kein Verbrauch gerechnet werden.' }]
    issues.push({ level: 'info', code: 'tausch', text: `Zählerwechsel ${reading.swap.oldNumber || ''} → ${reading.swap.newNumber || ''}: Verbrauch über beide Zähler gerechnet.` })
  }
  if (!prev) return issues
  // mit Tausch ohne Stand dazwischen (gilt bei dieser Ablesung)
  const seg = segments([...others.filter((r) => r.date <= date && (hasValue(r) || r.swap)), reading]).at(-1)
  if (!seg || seg.delta === null) return issues
  const delta = seg.delta
  const expected = expectedBetween(before, prev.date, date)
  const since = `seit ${dmy(prev.date)}`
  if (delta < 0) return [...issues, { level: 'error', code: 'kritisch', text: `Negativer Verbrauch (${fmt(delta)} ${unit} ${since}). Tippfehler? Bei neuem Zähler „Zählertausch“ ankreuzen.` }]
  if (expected !== null && expected >= 0.5) {
    const ratio = delta / expected
    const pct = `${Math.round(ratio * 100)} %`
    if (ratio > LIMITS.critical) issues.push({ level: 'error', code: 'kritisch', text: `Kritisch hoch: ${fmt(delta)} ${unit} ${since}, üblich etwa ${fmt(round(expected, 1))} (${pct}). Leck oder Tippfehler?` })
    else if (delta === 0) issues.push({ level: 'warning', code: 'leer', text: `Kein Verbrauch ${since}. Leerstand oder Zähler steht?` })
    else if (ratio > LIMITS.high) issues.push({ level: 'warning', code: 'hoch', text: `Hoch: ${fmt(delta)} ${unit} ${since}, üblich etwa ${fmt(round(expected, 1))} (${pct}).` })
    else if (ratio < LIMITS.low) issues.push({ level: 'warning', code: 'niedrig', text: `Niedrig: ${fmt(delta)} ${unit} ${since}, üblich etwa ${fmt(round(expected, 1))} (${pct}).` })
  } else if (delta === 0 && seg.days >= 30) issues.push({ level: 'warning', code: 'leer', text: `Kein Verbrauch ${since}. Leerstand oder Zähler steht?` })
  return issues
}

/** Auffällig (für Bericht und Filter): kritisch, hoch, niedrig, leer, unvollständiger Tausch, kein Stand. */
export const NOTABLE = ['kritisch', 'hoch', 'niedrig', 'leer', 'tausch_unvollstaendig', 'kein_stand']
export const notableIssue = (issues) => issues.find((i) => NOTABLE.includes(i.code)) || null

// ---------------------------------------------------------------- Fälligkeit

/**
 * Status der Zählstelle am Tag `today`:
 *  'ueberfaellig' – Fenster des letzten Zeitraums vorbei, keine Ablesung
 *  'faellig'      – Fenster offen, noch keine Ablesung
 *  'erledigt'     – für den laufenden Zeitraum schon abgelesen
 *  'ok'           – nichts offen, nächstes Fenster öffnet am opensAt
 *  'inaktiv'      – Abriss oder ausgebaut
 */
export function meterStatus(meter, readings, today, window = DEFAULT_WINDOW) {
  if (!isActive(meter, today)) return { status: 'inaktiv' }
  const interval = meter.interval || 'quartal'
  const cur = periodOf(today, interval)
  const last = [...readings].reverse().find(hasValue) || null
  // erledigt nur durch eine Ablesung ab Öffnung des Fensters (nicht z. B. durch einen Tausch mitten im Quartal)
  const done = (p) => readings.find((r) => (r.period || periodFor(r.date, interval, window).key) === p.key && r.date >= addDays(p.to, -window.before))
  for (const p of [prevPeriod(cur, interval), cur]) {
    if (meter.installedAt && meter.installedAt > p.to) continue
    if (done(p)) continue
    const opens = addDays(p.to, -window.before)
    if (today < opens) return { status: 'ok', due: p.to, opensAt: opens, period: p, last }
    const until = addDays(p.to, window.after)
    return { status: today > until ? 'ueberfaellig' : 'faellig', due: p.to, until, period: p, last }
  }
  const next = nextPeriod(cur, interval)
  return { status: 'erledigt', due: next.to, opensAt: addDays(next.to, -window.before), period: cur, reading: done(cur), last }
}

/** Zeitraum, in den eine neue Ablesung heute gehört (der fällige, sonst nach Datum). */
export function duePeriod(meter, readings, date, window = DEFAULT_WINDOW) {
  const interval = meter.interval || 'quartal'
  const st = meterStatus(meter, readings, date, window)
  if ((st.status === 'faellig' || st.status === 'ueberfaellig') && date >= addDays(st.period.to, -window.before)) return st.period
  const p = periodFor(date, interval, window)
  const own = periodOf(date, interval)
  // vorige Runde schon mit Stand erfasst: eine neue Ablesung überschreibt sie nicht, sondern zählt zum
  // laufenden Zeitraum; war dort nur „kein Zutritt“ o. Ä., wird der Stand nachgetragen
  return p.key !== own.key && readings.some((r) => r.period === p.key && hasValue(r)) ? own : p
}

// ---------------------------------------------------------------- Tausch und Berichtigung

/**
 * Ablesung mit Zählertausch übernehmen: Zählernummer wechselt, Verlauf
 * bekommt einen Eintrag. Liefert den neuen Datenstand.
 */
export function applySwap(zaehler, meterId, reading, { by = '', at = new Date().toISOString() } = {}) {
  const meters = zaehler.meters.map((m) => {
    if (m.id !== meterId || !reading.swap?.newNumber || reading.swap.newNumber === m.number) return m
    return { ...m, number: reading.swap.newNumber, history: [...(m.history || []), { at, date: reading.date, type: 'tausch', from: m.number, to: reading.swap.newNumber, ...(by ? { by } : {}) }] }
  })
  return { ...zaehler, meters, readings: [...zaehler.readings.filter((r) => r.id !== reading.id), reading] }
}

/** Nur die Nummer berichtigen (Tippfehler, Nachtrag): Verlauf ohne Tausch. Datum: heute nach Ortszeit. */
export function correctNumber(meter, number, { by = '', note = '', date, at = new Date().toISOString() } = {}) {
  if (!number || number === meter.number) return meter
  return { ...meter, number, history: [...(meter.history || []), { at, date: date || todayISO(), type: 'korrektur', from: meter.number, to: number, ...(by ? { by } : {}), ...(note ? { note } : {}) }] }
}

/**
 * Zählernummer an einem Tag: spätere Tausche aus dem Verlauf zurückgerechnet.
 * Eine Berichtigung (Tippfehler) gilt auch für frühere Ablesungen.
 */
export function numberAt(meter, date) {
  let number = String(meter.number ?? '')
  const swaps = (meter.history || []).filter((h) => h.type === 'tausch' && (h.date || '') > date)
  for (const h of swaps.sort((a, b) => b.date.localeCompare(a.date) || (b.at || '').localeCompare(a.at || ''))) number = String(h.from ?? '')
  return number
}

// ---------------------------------------------------------------- Listen und Export

/** Zeilen für die Liste an die Hausverwaltung (eine Zeile je Ablesung im Zeitraum). */
export function readingRows(zaehler, objects, { from, to, objectId = null } = {}) {
  const objById = new Map(objects.map((o) => [o.id, o]))
  const rows = []
  for (const m of zaehler.meters) {
    if (objectId && m.objectId !== objectId) continue
    const all = readingsOf(zaehler, m.id)
    const segByReading = new Map(segments(all).map((s) => [s.reading.id, s]))
    for (const r of all) {
      if (r.date < from || r.date > to) continue
      const seg = segByReading.get(r.id)
      const issue = notableIssue(checkReading(m, all, r))
      rows.push({
        object: objById.get(m.objectId)?.name || '',
        address: objById.get(m.objectId)?.address || '',
        objektNr: m.objektNr || '',
        number: String(r.swap?.newNumber || numberAt(m, r.date)),
        kind: METER_KINDS[m.kind]?.label || m.kind,
        location: m.location || '',
        period: r.period ? periodByKey(r.period).label : '',
        date: r.date,
        value: hasValue(r) ? r.value : null,
        unit: unitOf(m),
        delta: seg?.delta ?? null,
        since: seg ? seg.from : null,
        note: [r.reason ? REASONS[r.reason] : '', r.swap ? `Tausch ${r.swap.oldNumber || ''} → ${r.swap.newNumber || ''}${swapIncomplete(r) ? ' (unvollständig)' : ` (Endstand alt ${fmt(r.swap.oldEnd)}, Anfang neu ${fmt(r.swap.newStart)})`}` : '', r.estimated ? 'geschätzt' : '', r.note || ''].filter(Boolean).join(', '),
        flag: issue?.code || '',
        by: r.by || '',
        photo: r.photo?.url || '',
      })
    }
  }
  return rows.sort((a, b) => a.object.localeCompare(b.object, 'de') || String(a.location).localeCompare(String(b.location), 'de') || a.number.localeCompare(b.number, 'de') || a.date.localeCompare(b.date))
}

const csvCell = (v) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (head, lines) => `﻿${[head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`

/** CSV (Semikolon, Excel-tauglich): eine Zeile je Ablesung. */
export function readingsCsv(rows) {
  return csv(
    ['Objekt', 'Adresse', 'Objekt Nr.', 'Zählernummer', 'Art', 'Ort / Anschrift', 'Zeitraum', 'Datum', 'Stand', 'Einheit', 'Verbrauch', 'seit', 'Auffällig', 'Bemerkung', 'Abgelesen von', 'Foto'],
    rows.map((r) => [r.object, r.address, r.objektNr, r.number, r.kind, r.location, r.period, dmy(r.date), r.value ?? '', r.unit, r.delta ?? '', r.since ? dmy(r.since) : '', r.flag, r.note, r.by, r.photo]),
  )
}

/**
 * Jahresliste je Zählstelle im Zuschnitt des Wasserzähler-Tools: Q1–Q4 mit
 * Datum, Stand, Verbrauch, Hinweis; Anfang, Ende, Jahresverbrauch, Änderungen.
 */
export function yearRows(zaehler, objects, { year, objectId = null }) {
  const objById = new Map(objects.map((o) => [o.id, o]))
  const out = []
  for (const m of zaehler.meters) {
    if (objectId && m.objectId !== objectId) continue
    if ((m.interval || 'quartal') !== 'quartal') continue
    const all = readingsOf(zaehler, m.id)
    const segByReading = new Map(segments(all).map((s) => [s.reading.id, s]))
    const inYear = (r) => (r.period || '').startsWith(`${year}-`)
    if (!all.some(inYear) && m.state === 'abriss') continue
    const start = [...all].reverse().find((r) => hasValue(r) && (r.period ? r.period < `${year}-` : r.date < `${year}-01-01`)) || null
    const quarters = [1, 2, 3, 4].map((q) => {
      const list = all.filter((x) => x.period === `${year}-Q${q}`)
      const r = list.at(-1) || null
      if (!r) return null
      // Verbrauch des Quartals: alle Abschnitte darin (z. B. Tausch mitten im Quartal und reguläre Ablesung)
      const segs = list.map((x) => segByReading.get(x.id)).filter(Boolean)
      const delta = segs.length && segs.every((s) => s.delta !== null) ? round(segs.reduce((x, s) => x + s.delta, 0)) : null
      return { date: r.date, value: hasValue(r) ? r.value : null, delta, note: [r.reason ? REASONS[r.reason] : '', list.some((x) => x.swap) ? 'Zählertausch' : '', r.note || ''].filter(Boolean).join(', '), photo: r.photo?.url || '' }
    })
    const yearSegs = all.filter(inYear).map((r) => segByReading.get(r.id)).filter(Boolean)
    const end = [...all].reverse().find((r) => hasValue(r) && inYear(r)) || null
    out.push({
      meter: m,
      object: objById.get(m.objectId)?.name || '',
      objektNr: m.objektNr || '',
      location: m.location || '',
      number: String(m.number ?? ''),
      note: m.note || '',
      quarters,
      start: start?.value ?? null,
      end: end?.value ?? null,
      total: yearSegs.length && yearSegs.every((s) => s.delta !== null) ? round(yearSegs.reduce((x, s) => x + s.delta, 0)) : null,
      changes: (m.history || []).filter((h) => (h.date || '').startsWith(String(year))).map((h) => `${h.type === 'tausch' ? 'Tausch' : 'Berichtigung'} ${dmy(h.date)}: ${h.from} → ${h.to}`).join('; '),
    })
  }
  return out.sort((a, b) => a.object.localeCompare(b.object, 'de') || a.location.localeCompare(b.location, 'de') || a.number.localeCompare(b.number, 'de'))
}

export function yearCsv(rows) {
  const head = ['Objekt', 'Objekt Nr.', 'Objekt Anschrift', 'Zähler Nr.', 'Ansprechperson (Hinweis)']
  for (const q of [1, 2, 3, 4]) head.push(`Q${q} Datum`, `Q${q} Zählerstand`, `Q${q} Verbrauch`, `Q${q} Hinweis`, `Q${q} Fotos`)
  head.push('Zählerstand Anfang', 'Zählerstand Ende', 'Jahresverbrauch', 'Änderungen')
  return csv(
    head,
    rows.map((r) => [r.object, r.objektNr, r.location, r.number, r.note, ...r.quarters.flatMap((q) => (q ? [dmy(q.date), q.value ?? '', q.delta ?? '', q.note, q.photo] : ['', '', '', '', ''])), r.start ?? '', r.end ?? '', r.total ?? '', r.changes]),
  )
}

// ---------------------------------------------------------------- Import aus Excel

export const METER_TEMPLATE = ['Objekt', 'Zählernummer', 'Art', 'Ort', 'Rhythmus', 'Stand', 'Datum', 'Objekt Nr.', 'Hinweis']

// ß → ss vor dem Entfernen der Sonderzeichen („Straße“ = „Strasse“)
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const col = (row, ...names) => {
  const key = Object.keys(row).find((k) => names.includes(norm(k)))
  return key === undefined ? '' : row[key]
}
// Reihenfolge zählt: „Wärme“ (normiert „warme“) vor Warmwasser, „vierteljährlich“ vor „jährlich“
const KIND_WORDS = [
  ['waerme', /warme(?!s?wasser)|waerme|heiz/],
  ['warmwasser', /warm|^ww/],
  ['kaltwasser', /kalt|wasser|^kw/],
  ['strom', /strom|elektr|kwh/],
  ['gas', /gas/],
]
const INTERVAL_WORDS = [
  ['quartal', /quartal|viertel|^q|(^|\D)3monat|dreimonat/],
  ['halbjahr', /halb|(^|\D)6monat|sechsmonat/],
  ['jahr', /12monat|jahr/],
  ['monat', /monat/],
]
/** Datum „31.12.2025“, „31.12.25“ oder „2025-12-31“ → ISO, sonst null (auch für 31.11.). */
const toDate = (v) => {
  const s = String(v || '').trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  const [y, m, d] = iso ? iso.slice(1) : de ? [de[3], de[2], de[1]] : []
  if (!y || Number(m) < 1 || Number(m) > 12 || Number(d) < 1) return null
  const month = `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}`
  return Number(d) <= Number(lastOfMonth(`${month}-01`).slice(8)) ? `${month}-${d.padStart(2, '0')}` : null
}

/** Objekt zu einem Namen: Name oder Kurzname, genau (ohne Groß-/Kleinschreibung und Sonderzeichen). */
export function findObject(objects, name) {
  const n = norm(name)
  if (!n) return null
  return objects.find((o) => norm(o.name) === n) || objects.find((o) => norm(o.short) === n) || null
}

/** Zähler aus Excel einfügen: Objekt, Zählernummer, Art, Ort, Rhythmus, (Stand, Datum, Objekt Nr., Hinweis). */
export function importMeters(text, objects, { today }) {
  const errors = []
  const items = []
  parseTable(text).forEach((row, i) => {
    const line = i + 2
    const objName = col(row, 'objekt', 'kunde', 'standort')
    const obj = findObject(objects, objName)
    const number = String(col(row, 'zahlernummer', 'zaehlernummer', 'zahlernr', 'zaehlernr', 'nummer', 'zahler', 'zaehler')).trim()
    if (!obj) return errors.push(`Zeile ${line}: Objekt „${objName}“ nicht gefunden`)
    if (!number) return errors.push(`Zeile ${line}: Zählernummer fehlt`)
    const kindText = norm(col(row, 'art', 'typ', 'medium'))
    const kind = KIND_WORDS.find(([, re]) => re.test(kindText))?.[0] || (kindText ? 'sonstig' : 'kaltwasser')
    const intText = norm(col(row, 'rhythmus', 'intervall', 'ablesung'))
    const interval = INTERVAL_WORDS.find(([, re]) => re.test(intText))?.[0] || 'quartal'
    const value = parseValue(col(row, 'stand', 'zahlerstand', 'zaehlerstand', 'anfangsstand'))
    // Datum leer: heute; unlesbar: Fehler statt still „heute“
    const dateText = String(col(row, 'datum', 'ablesedatum')).trim()
    const date = dateText ? toDate(dateText) : today
    if (value !== null && !date) return errors.push(`Zeile ${line}: Datum „${dateText}“ nicht lesbar (TT.MM.JJJJ)`)
    const meter = { objectId: obj.id, number, kind, location: col(row, 'ort', 'lage', 'einbauort', 'anschrift', 'objektanschrift'), unit: METER_KINDS[kind].unit, interval }
    const objektNr = col(row, 'objektnr', 'objektnummer')
    const note = col(row, 'hinweis', 'ansprechperson', 'bemerkung')
    if (objektNr) meter.objektNr = objektNr
    if (note) meter.note = note
    items.push({ meter, reading: value !== null ? { date, value } : null })
  })
  return { items, errors }
}

// ---------------------------------------------------------------- Übernahme aus dem Wasserzähler-Tool

/** Alle Jahreslisten in beliebigen JSON-Dateien finden (Einzelliste, Liste von Listen, Komplett-Sicherung). */
export function findWaterLists(json, out = []) {
  if (Array.isArray(json)) json.forEach((x) => findWaterLists(x, out))
  else if (json && typeof json === 'object') {
    if (Array.isArray(json.stellen) && (json.art === 'wasserablesung' || json.runden)) out.push(json)
    else Object.values(json).forEach((x) => findWaterLists(x, out))
  }
  return out
}

const slug = (s) => norm(s).slice(0, 40) || 'x'

/**
 * Jahreslisten des Wasserzähler-Tools übernehmen. Zählstellen-IDs bleiben
 * erhalten (stabiler Schlüssel), Ablesungen bekommen IDs je Quartal: ein
 * zweiter Import ersetzt statt zu verdoppeln. Standorte ohne passendes Objekt
 * werden als Objekte angelegt.
 * Liefert { objects (neu), meters, readings, closures, stats }.
 */
export function importWaterLists(lists, existing = { objects: [], zaehler: { meters: [], readings: [] } }) {
  const objects = []
  const allObjects = [...existing.objects]
  const meters = new Map((existing.zaehler?.meters || []).map((m) => [m.id, { ...m }]))
  const readings = new Map((existing.zaehler?.readings || []).map((r) => [r.id, r]))
  const closures = { ...(existing.zaehler?.closures || {}) }
  const starts = []
  const stats = { lists: 0, objects: 0, meters: 0, readings: 0, photos: 0 }
  const sorted = [...lists].sort((a, b) => String(a.jahr).localeCompare(String(b.jahr)))
  for (const list of sorted) {
    const year = Number(list.jahr)
    if (!year || !list.ort) continue
    stats.lists++
    const name = list.bereich && !norm(list.ort).includes(norm(list.bereich)) ? `${list.bereich} ${list.ort}` : list.ort
    let obj = allObjects.find((o) => o.meterSite === name) || findObject(allObjects, name)
    if (!obj) {
      // gekürzte ID kann bei langen, ähnlichen Namen gleich sein: eindeutig machen
      let id = `o-wz-${slug(name)}`
      while (allObjects.some((o) => o.id === id)) id += 'x'
      obj = { id, name, short: list.ort, address: list.ort, region: '', color: ((allObjects.length + 3) % 12) + 1, onlyTrained: false, keys: [], meterSite: name, ...(list.bereich ? { customer: list.bereich } : {}), ...(list.auftragsnummer ? { orderNo: list.auftragsnummer } : {}) }
      allObjects.push(obj)
      objects.push(obj)
      stats.objects++
    }
    for (const s of list.stellen || []) {
      const prev = meters.get(s.id)
      const history = [...(prev?.history || [])]
      for (const v of s.verlauf || []) {
        const entry = { at: v.zeit || '', date: v.quartal && v.jahr ? periodByKey(`${v.jahr}-${v.quartal}`).to : (v.zeit || '').slice(0, 10), type: v.art === 'tausch' ? 'tausch' : 'korrektur', from: String(v.von ?? ''), to: String(v.nach ?? ''), ...(v.ableser ? { by: v.ableser } : {}), ...(v.bem ? { note: v.bem } : {}) }
        if (!history.some((h) => h.at === entry.at && h.from === entry.from && h.to === entry.to)) history.push(entry)
      }
      if (!prev) stats.meters++
      meters.set(s.id, {
        ...(prev || {}),
        id: s.id,
        objectId: obj.id,
        number: String(s.zaehlerNr ?? '') || prev?.number || '',
        kind: prev?.kind || 'kaltwasser',
        unit: prev?.unit || 'm³',
        interval: 'quartal',
        location: s.anschrift || prev?.location || '',
        ...(s.hinweis ? { note: s.hinweis } : {}),
        ...(s.objektNr ? { objektNr: String(s.objektNr) } : {}),
        ...(s.zustand === 'abriss' ? { state: 'abriss' } : {}),
        history,
      })
      if (s.zustand !== 'abriss' && prev?.state === 'abriss') delete meters.get(s.id).state
      const start = parseValue(s.startstand)
      if (start !== null) starts.push({ meterId: s.id, year, value: start, source: s.startQuelle || '' })
    }
    for (const [q, round] of Object.entries(list.runden || {})) {
      const qn = Number(String(q).replace(/\D/g, ''))
      if (!qn || qn > 4) continue
      const period = periodByKey(`${year}-Q${qn}`)
      if (round.status === 'abgeschlossen') closures[`${obj.id}|${period.key}`] = { at: round.abgeschlossen || '', by: round.ableser || '', ...(round.datum ? { date: round.datum } : {}) }
      for (const [sid, w] of Object.entries(round.werte || {})) {
        const value = parseValue(w.stand)
        const reason = REASONS[w.grund] ? w.grund : null
        if (value === null && !reason && !w.tausch) continue
        const photo = (w.fotos || []).find((f) => f.url)
        if (photo) stats.photos++
        const id = `${sid}-${period.key}`
        if (!readings.has(id)) stats.readings++
        readings.set(id, {
          id,
          meterId: sid,
          period: period.key,
          date: round.datum && round.datum >= addDays(period.to, -DEFAULT_WINDOW.before) ? round.datum : period.to,
          value,
          ...(reason ? { reason } : {}),
          ...(w.tausch ? { swap: { oldNumber: '', newNumber: String(w.tausch.zaehlerNeu ?? ''), oldEnd: parseValue(w.tausch.standAlt), newStart: parseValue(w.tausch.startNeu) } } : {}),
          ...(round.ableser ? { by: round.ableser } : {}),
          ...(w.bem ? { note: w.bem } : {}),
          ...(photo ? { photo: { url: photo.url, name: photo.name || '' } } : {}),
          at: w.zeit || round.abgeschlossen || '',
          source: 'wasserzaehler',
        })
      }
    }
  }
  // Anfangsstand (Endstand Vorjahr) nur, solange es für Q4 des Vorjahres keine echte Ablesung gibt;
  // kommt die Liste des Vorjahres später dazu, fällt ein früher angelegter Anfangsstand weg
  const isStart = (r) => r.id === `${r.meterId}-${r.period}-start`
  const real = new Set([...readings.values()].filter((r) => hasValue(r) && !isStart(r)).map((r) => `${r.meterId}|${r.period}`))
  for (const r of [...readings.values()]) if (isStart(r) && real.has(`${r.meterId}|${r.period}`)) readings.delete(r.id)
  for (const s of starts) {
    const key = `${s.year - 1}-Q4`
    if (real.has(`${s.meterId}|${key}`)) continue
    const id = `${s.meterId}-${key}-start`
    if (!readings.has(id)) stats.readings++
    readings.set(id, { id, meterId: s.meterId, period: key, date: `${s.year - 1}-12-31`, value: s.value, note: `Anfangsstand${s.source ? ` (${s.source})` : ''}`, at: '', source: 'wasserzaehler' })
  }
  // alte Nummer beim Tausch aus dem Verlauf ergänzen (als Kopie: der Bestand bleibt unverändert)
  for (const r of [...readings.values()]) {
    if (!r.swap || r.swap.oldNumber) continue
    const h = (meters.get(r.meterId)?.history || []).find((x) => x.type === 'tausch' && x.to === r.swap.newNumber)
    if (h) readings.set(r.id, { ...r, swap: { ...r.swap, oldNumber: h.from } })
  }
  return { objects, meters: [...meters.values()], readings: [...readings.values()], closures, stats }
}
