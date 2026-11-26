// Unterweisungen & Fristen je Person: Sicherheitsunterweisung, Unterweisung Reinigungsmittel,
// Erste-Hilfe-Auffrischung, Führerscheinkontrolle, Aufenthaltstitel/Arbeitserlaubnis … mit Datum,
// „gültig bis“, Ampel, Unterweisung mit Teilnehmerliste und Unterschriften.
//
// Datei unterweisungen/unterweisungen.json:
//   { types: [{ id, name, months, who, law, note, kind, blocking, active }],
//     records: [{ id, empId, typeId, date, until, note, sessionId, signature, by, at }],
//     sessions: [{ id, typeId, date, topic, trainer, place, participants: [empId], by, at }],
//     requests: [{ id, empId, typeId, date, via: 'whatsapp' | 'vermerk', by, at }] }   Aufforderungen („bitte nachholen“)
//   link (je Art, optional): Adresse zum Sicherheitsvideo oder zu den Unterlagen, steht in der Aufforderung
//   content (je Art, optional): Standard-Inhalt der Unterweisung, z. B. der Text des bisherigen Sicherheitsblatts
//   who: 'alle' (Pflicht für alle) | 'optional' (nur wer einen Eintrag hat) | 'skill:Führerschein' (Pflicht mit dieser Qualifikation)
//   months: Gültigkeit ab dem Datum (0 = kein Ablauf bzw. „gültig bis“ von Hand, z. B. Aufenthaltstitel)
//   blocking: abgelaufen = Fehler im Plan (darf nicht arbeiten), sonst Warnung (nur bei passender Qualifikation)
//
// Rechtliches (Stand 11/2026): § 14 ASchG verlangt eine nachweisliche Unterweisung in der Arbeitszeit,
// Wiederholung erforderlichenfalls; das Intervall ergibt sich aus der Evaluierung (§ 4 ASchG), jährlich ist
// üblich. § 40 AStV: Ersthelfer:innen frischen spätestens alle vier Jahre auf (mindestens 8 Stunden).
// § 103 Abs. 1 Z 3 KFG: Firmenfahrzeuge nur Personen mit Lenkberechtigung überlassen (Kontrolle sinnvoll).

import { addDays, formatDate } from './dates.js'
import { headKey, nameMatcher } from './names.js'

export { nameMatcher }

export const TRAINING_DEFAULTS = [
  { id: 'sicherheit', name: 'Sicherheitsunterweisung', months: 12, who: 'alle', law: '§ 14 ASchG', note: 'beim Eintritt, bei Änderungen und regelmäßig; Intervall laut Evaluierung', kind: 'unterweisung' },
  { id: 'chemie', name: 'Unterweisung Reinigungsmittel', months: 12, who: 'alle', law: '§ 14 ASchG', note: 'Gefahren, Dosierung, Schutzhandschuhe, Sicherheitsdatenblätter', kind: 'unterweisung' },
  { id: 'ersthilfe', name: 'Erste-Hilfe-Auffrischung (Ersthelfer:innen)', months: 48, who: 'optional', law: '§ 40 AStV', note: 'spätestens alle vier Jahre, mindestens 8 Stunden', kind: 'kurs' },
  { id: 'fuehrerschein', name: 'Führerscheinkontrolle', months: 6, who: 'skill:Führerschein', law: '§ 103 Abs. 1 Z 3 KFG', note: 'Führerschein vorlegen lassen (keine Kopie nötig)', kind: 'kontrolle' },
  { id: 'aufenthalt', name: 'Aufenthaltstitel / Arbeitserlaubnis', months: 0, who: 'optional', law: 'AuslBG', note: 'Ablaufdatum eintragen; abgelaufen = nicht einteilen', kind: 'dokument', blocking: true },
]
export const KINDS = { unterweisung: 'Unterweisung', kurs: 'Kurs', kontrolle: 'Kontrolle', dokument: 'Dokument mit Ablaufdatum', formular: 'Formular zum Unterschreiben' }
export const STATE_TEXT = { ok: 'gültig', bald: 'läuft bald ab', abgelaufen: 'abgelaufen', fehlt: 'fehlt', na: '–' }

export const emptyTrainings = () => ({ types: [], records: [], sessions: [] })
export const typesOf = (doc) => (doc?.types?.length ? doc.types : TRAINING_DEFAULTS).filter((t) => t.active !== false)

/** Datum plus Monate (31.1. + 1 Monat = 28./29.2.). */
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

/** Gültig bis: eingetragen, sonst Datum + Monate der Art (ohne Monate: kein Ablauf). */
export const untilOf = (record, type) => record?.until || (record?.date && Number(type?.months) > 0 ? addMonths(record.date, Number(type.months)) : '')

/** Pflicht für diese Person? */
export function isRequired(type, emp) {
  if (type.who === 'alle') return true
  if (String(type.who || '').startsWith('skill:')) return (emp?.skills || []).includes(type.who.slice(6))
  return false
}

/** Letzter Eintrag einer Person zu einer Art (nach Datum). */
export function latest(records = [], empId, typeId) {
  let best = null
  for (const r of records) if (r.empId === empId && r.typeId === typeId && (!best || r.date > best.date || (r.date === best.date && (r.at || '') > (best.at || '')))) best = r
  return best
}

/**
 * Zustand einer Frist an einem Tag: { state: ok | bald | abgelaufen | fehlt | na, until, record }
 * bald = läuft in den nächsten warnDays Tagen ab; fehlt = Pflicht, aber kein Eintrag; na = keine Pflicht, kein Eintrag.
 */
export function statusOf({ type, emp, records, today, warnDays = 30 }) {
  const record = latest(records, emp.id, type.id)
  if (!record) return { state: isRequired(type, emp) ? 'fehlt' : 'na', until: '', record: null }
  const until = untilOf(record, type)
  if (!until) return { state: 'ok', until: '', record }
  if (until < today) return { state: 'abgelaufen', until, record }
  if (until <= addDays(today, warnDays)) return { state: 'bald', until, record }
  return { state: 'ok', until, record }
}

/** Matrix Person × Art: [{ emp, cells: { typeId: status } , worst }] für aktive Personen. */
export function matrix({ doc, employees = [], today, warnDays = 30 }) {
  const types = typesOf(doc)
  const order = { abgelaufen: 0, fehlt: 1, bald: 2, ok: 3, na: 4 }
  return employees
    .filter((e) => !e.exitDate || e.exitDate >= today)
    .map((emp) => {
      const cells = Object.fromEntries(types.map((t) => [t.id, statusOf({ type: t, emp, records: doc?.records || [], today, warnDays })]))
      const worst = Object.values(cells).reduce((w, c) => (order[c.state] < order[w] ? c.state : w), 'na')
      return { emp, cells, worst }
    })
}

/** Handlungsbedarf: [{ emp, type, state, until }] abgelaufen, fehlt (Pflicht), läuft bald ab; dringendste zuerst. */
export function dueList({ doc, employees = [], today, warnDays = 30 }) {
  const types = typesOf(doc)
  const order = { abgelaufen: 0, fehlt: 1, bald: 2 }
  const out = []
  for (const row of matrix({ doc, employees, today, warnDays })) for (const t of types) {
    const c = row.cells[t.id]
    if (c.state in order) out.push({ emp: row.emp, type: t, state: c.state, until: c.until })
  }
  return out.sort((a, b) => Number(!!b.type.blocking) - Number(!!a.type.blocking) || order[a.state] - order[b.state] || (a.until || '').localeCompare(b.until || '') || a.emp.name.localeCompare(b.emp.name, 'de'))
}

/** Einträge aus einer durchgeführten Unterweisung (je Teilnehmer:in, mit Unterschrift falls vorhanden). */
export function sessionRecords(session, type, { newId, at, by = '', signatures = {} }) {
  return session.participants.map((empId) => ({ id: newId(), empId, typeId: session.typeId, date: session.date, until: Number(type?.months) > 0 ? '' : session.until || '', note: session.topic ? `Inhalt: ${session.topic}` : '', sessionId: session.id, signature: signatures[empId] || '', by, at }))
}

/**
 * Prüfung für den Plan: Probleme einer Person an einem Tag mit den Qualifikationen des Einsatzes.
 * [{ severity, type, text }]: Dokument mit „blocking“ abgelaufen → error; Pflicht über eine Qualifikation,
 * die der Einsatz verlangt, abgelaufen → warning.
 */
export function shiftProblems({ doc, emp, date, skills = [] }) {
  if (!doc) return []
  const out = []
  for (const type of typesOf(doc)) {
    if (type.blocking) {
      const record = latest(doc.records || [], emp.id, type.id)
      const until = untilOf(record, type)
      if (until && until < date) out.push({ severity: 'error', type, text: `${type.name} abgelaufen (${formatDate(until, { weekday: false, year: true })})` })
      continue
    }
    const skill = String(type.who || '').startsWith('skill:') ? type.who.slice(6) : null
    if (!skill || !skills.includes(skill) || !(emp.skills || []).includes(skill)) continue
    const s = statusOf({ type, emp, records: doc.records || [], today: date, warnDays: 0 })
    // nur abgelaufene (fehlende Einträge meldet „Zu erledigen“, sonst wäre der Plan beim Start voller Warnungen)
    if (s.state === 'abgelaufen') out.push({ severity: 'warning', type, text: `${type.name} abgelaufen (${formatDate(s.until, { weekday: false, year: true })})` })
  }
  return out
}

// ---------------------------------------------------------------- Aufforderung („bitte nachholen“)

/** Offene Aufforderung: die jüngste zur Person und Art, solange seither nichts eingetragen wurde (sonst null). */
export function openRequest(doc, empId, typeId) {
  let last = null
  for (const q of doc?.requests || []) if (q.empId === empId && q.typeId === typeId && (!last || q.date > last.date || (q.date === last.date && (q.at || '') > (last.at || '')))) last = q
  if (!last) return null
  return (doc.records || []).some((r) => r.empId === empId && r.typeId === typeId && r.date >= last.date) ? null : last
}

/** Text der Aufforderung für WhatsApp: Stand, was zu tun ist (je Art), Link der Art. status = statusOf(…). */
export function requestText({ type, emp, status, company = '' }) {
  const first = String(emp?.name || '').trim().split(/\s+/)[0] || ''
  const day = (d) => formatDate(d, { weekday: false, year: true })
  const kind = type.kind || 'unterweisung'
  const what = kind === 'dokument' ? `dein Nachweis „${type.name}“` : `deine ${type.name}`
  const stand =
    status?.state === 'abgelaufen' ? `${what} ist am ${day(status.until)} abgelaufen` : status?.state === 'bald' ? `${what} läuft am ${day(status.until)} ab` : status?.state === 'fehlt' ? `${what} fehlt uns noch` : `${what} steht wieder an`
  const link = String(type.link || '').trim()
  const todo =
    kind === 'dokument'
      ? 'Bitte bring das neue Dokument in den nächsten Tagen im Büro vorbei.'
      : kind === 'kontrolle'
        ? 'Bitte komm dafür in den nächsten Tagen kurz im Büro vorbei.'
        : link
          ? `Bitte hol sie in den nächsten Tagen nach:\n${link}\n\nDanach schick uns bitte den Nachweis (Zertifikat).`
          : 'Bitte melde dich bei uns, damit wir sie in den nächsten Tagen nachholen.'
  return [`Hallo ${first},`.replace(' ,', ','), '', `${stand}.`, todo, '', 'Danke!', company].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim()
}

// ---------------------------------------------------------------- Aus Excel einfügen

const COLS = {
  name: ['name', 'mitarbeiter', 'mitarbeiterin', 'person', 'mitarbeiterinnen'],
  date: ['datum', 'am', 'zertifikat', 'zertifikatsicherheitsvideo', 'unterweisungam', 'durchgefuhrtam', 'unterwiesenam', 'zertifikatsdatum'],
  until: ['gultigbis', 'bis', 'ablauf', 'ablaufdatum'],
  by: ['durchgefuhrtvon', 'von', 'trainer', 'unterwiesenvon', 'durch'],
  note: ['notiz', 'bemerkung', 'hinweis', 'anmerkung'],
}
/** Datum „16.01.2024“, „16.1.24“, „2024-01-16“ (auch mit Uhrzeit) → „2024-01-16“; sonst ''. */
export function tableDate(v) {
  const s = String(v ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/.exec(s)
  if (!m) return ''
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? d : ''
}

/**
 * Einträge aus einer eingefügten Tabelle (Tabulator wie aus Excel, sonst Semikolon), erste Zeile = Überschriften:
 * Name, Datum (auch „Zertifikat …“), optional „Gültig bis“, „Durchgeführt von“, Notiz. Personen über den Namen
 * (Groß/klein, Akzente, Leerzeichen egal; auch „Nachname Vorname“). Zeilen ohne Datum zählen als „ohne Datum“.
 * → { items: [{ empId, name, date, until, by, note }], unknown: [Name], noDate: [Name], errors: [Text] }
 */
export function parseRecordTable(text, { employees = [] } = {}) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const out = { items: [], unknown: [], noDate: [], errors: [] }
  if (!lines.length) return out
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ';'
  const isDateHead = (h) => COLS.date.includes(h) || h.startsWith('zertifikat') || h.startsWith('datum')
  // Überschrift: die erste Zeile mit „Name“ und „Datum“ (darüber darf ein Titel stehen, wie in der bisherigen Liste)
  const headAt = lines.slice(0, 10).findIndex((l) => {
    const h = l.split(sep).map(headKey)
    return h.some((x) => COLS.name.includes(x)) && h.some(isDateHead)
  })
  if (headAt < 0) {
    out.errors.push(lines.length < 2 ? 'Bitte die Überschriften mit einfügen (erste Zeile: Name, Datum …).' : 'Spalten „Name“ und „Datum“ (oder „Zertifikat“) fehlen in der Überschrift.')
    return out
  }
  const head = lines[headAt].split(sep).map(headKey)
  const ix = Object.fromEntries(Object.keys(COLS).map((k) => [k, head.findIndex((h) => COLS[k].includes(h))]))
  if (ix.date < 0) ix.date = head.findIndex(isDateHead)
  const find = nameMatcher(employees.filter((e) => !e.inactive))
  for (const line of lines.slice(headAt + 1)) {
    const c = line.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, '$1'))
    const name = (c[ix.name] || '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const date = tableDate(c[ix.date])
    if (!date) {
      out.noDate.push(name)
      continue
    }
    const hit = find(name)
    if (!hit) {
      out.unknown.push(name)
      continue
    }
    const e = hit.emp
    out.items.push({ empId: e.id, name: e.name, ...(hit.exact ? {} : { written: name }), date, until: ix.until >= 0 ? tableDate(c[ix.until]) : '', by: ix.by >= 0 ? c[ix.by] || '' : '', note: ix.note >= 0 ? c[ix.note] || '' : '' })
  }
  return out
}

/** Eingefügte Einträge übernehmen; schon vorhandene (Person, Art, Datum) bleiben einmal. → { records, added, skipped } */
export function addImported(records = [], items = [], typeId, { newId, at = '', by = '' } = {}) {
  const have = new Set(records.map((r) => `${r.empId}|${r.typeId}|${r.date}`))
  const out = [...records]
  let added = 0
  let skipped = 0
  for (const x of items) {
    const key = `${x.empId}|${typeId}|${x.date}`
    if (have.has(key)) {
      skipped++
      continue
    }
    have.add(key)
    out.push({ id: newId(), empId: x.empId, typeId, date: x.date, ...(x.until ? { until: x.until } : {}), note: [x.by ? `durchgeführt von ${x.by}` : '', x.note].filter(Boolean).join(' · '), by, at, source: 'import' })
    added++
  }
  return { records: out, added, skipped }
}
