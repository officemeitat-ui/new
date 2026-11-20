// Abwesenheiten aus einer Excel-Liste lesen (Urlaubsplan, Krankenstände): eingefügter Text mit Tabulator oder
// Strichpunkt. Reine Funktion ohne Oberfläche (Tests: test/absence-import.test.js); Dialog: ui/views/absences.js.
//
// Spalten (Überschrift, Schreibweise egal): Name, Art, Von, Bis, Notiz – oder statt Von und Bis eine Spalte „Zeitraum“
// („23.12.–07.01.“, „23.–27.12.2026“). Pflicht sind Name und Von bzw. Zeitraum.
//   - Art: Urlaub (auch leer), Krankenstand („krank“, „KS“), Zeitausgleich („ZA“), Pflegefreistellung; anderes wird
//     „Sonstiges“ mit dem Text als Notiz.
//   - Datum ohne Jahr („07.01.“): der nächste solche Tag ab zwei Monate vor heute (ein Urlaubsplan im November meint
//     mit „07.01.“ den kommenden Jänner).
//   - Namen wie beim Einfügen der Unterweisungen: Groß/klein, „Nachname Vorname“ und kleine Tippfehler passen, wenn es
//     eindeutig ist; unbekannte Namen werden gemeldet und nicht angelegt.
//   - Was es genau so schon gibt (Person, Art, von, bis), wird übersprungen: dieselbe Liste noch einmal ändert nichts.

import { headKey, nameMatcher } from './names.js'

export const ABSENCE_TEMPLATE = ['Name', 'Art', 'Von', 'Bis', 'Notiz']
export const IMPORT_TYPES = ['Urlaub', 'Krankenstand', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges']

const ALIASES = {
  name: ['name', 'mitarbeiter', 'mitarbeiterin', 'mitarbeitende', 'person', 'dienstnehmer', 'dienstnehmerin'],
  type: ['art', 'grund', 'typ', 'abwesenheit', 'abwesenheitsart'],
  from: ['von', 'ab', 'beginn', 'start', 'erstertag', 'vom'],
  to: ['bis', 'ende', 'letztertag'],
  span: ['zeitraum', 'datum', 'tage', 'termin'],
  note: ['notiz', 'bemerkung', 'anmerkung', 'hinweis', 'kommentar'],
}
const text = (v) => String(v ?? '').trim()
const fieldOf = (head) => {
  const k = headKey(head)
  if (!k) return ''
  for (const [field, list] of Object.entries(ALIASES)) if (list.includes(k)) return field
  return ''
}
const pad = (n) => String(n).padStart(2, '0')
const valid = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : ''
}
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** Art aus der Liste → Art der App und, wenn es keine der bekannten ist, der Text als Notiz. */
export function absenceType(v) {
  const s = text(v).toLowerCase()
  if (!s || /^u$|urlaub|ferien/.test(s)) return { type: 'Urlaub' }
  if (/^ks?$|krank/.test(s)) return { type: 'Krankenstand' }
  if (/^za$|zeitausgleich|gutstunden/.test(s)) return { type: 'Zeitausgleich' }
  if (/pflege/.test(s)) return { type: 'Pflegefreistellung' }
  if (/^sonstiges?$/.test(s)) return { type: 'Sonstiges' }
  return { type: 'Sonstiges', note: text(v) }
}

/**
 * Ein Datum aus der Liste: „23.12.2026“, „23.12.26“, „2026-12-23“ oder ohne Jahr „23.12.“ (dann der nächste solche
 * Tag ab zwei Monate vor heute). Liefert { date: 'JJJJ-MM-TT', year: true|false } oder null.
 */
export function absenceDate(v, today) {
  const s = text(v).replace(/\s+/g, '')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const date = valid(Number(m[1]), Number(m[2]), Number(m[3]))
    return date ? { date, year: true } : null
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  if (m[3]) {
    const date = valid(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), mo, d)
    return date ? { date, year: true } : null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(today))) return null
  const floor = addDays(today, -60)
  const y = Number(floor.slice(0, 4))
  for (const year of [y, y + 1]) {
    const date = valid(year, mo, d)
    if (date && date >= floor) return { date, year: false }
  }
  return null
}

/**
 * Zeitraum in einer Zelle: „23.12.2026–07.01.2027“, „23.12. - 07.01.“, „23.–27.12.2026“, „23.12. bis 27.12.“ oder ein
 * einzelner Tag. Liefert { from, to } (to mit Jahreswechsel, wenn das Ende sonst vor dem Beginn läge) oder null.
 */
export function absenceSpan(v, today) {
  const s = text(v)
  if (!s) return null
  const parts = s.split(/\s*(?:–|—|\bbis\b|(?<=[\d.])\s*-\s*(?=\d))\s*/i).map(text).filter(Boolean)
  if (parts.length === 1) {
    const one = absenceDate(parts[0], today)
    return one ? { from: one.date, to: one.date } : null
  }
  if (parts.length !== 2) return null
  const end = absenceDate(parts[1], today)
  if (!end) return null
  // „23.–27.12.2026“: der Beginn nennt nur den Tag
  const dayOnly = parts[0].match(/^(\d{1,2})\.?$/)
  const start = dayOnly ? { date: valid(Number(end.date.slice(0, 4)), Number(end.date.slice(5, 7)), Number(dayOnly[1])), year: true } : absenceDate(parts[0], today)
  if (!start?.date) return null
  return range(start, end)
}

/** Beginn und Ende zusammensetzen: liegt ein Ende ohne Jahr vor dem Beginn, ist das Folgejahr gemeint. */
function range(start, end) {
  let to = end.date
  if (to < start.date && !end.year) to = `${Number(to.slice(0, 4)) + 1}${to.slice(4)}`
  return { from: start.date, to }
}

/**
 * Eingefügte Liste lesen. employees: [{ id, name, inactive?, exitDate? }]; existing: vorhandene Abwesenheiten.
 * Liefert { items: [{ employeeId, name, written (nur wenn anders geschrieben), type, from, to, note?, overlap? }],
 *   unknown: [geschriebene Namen ohne Treffer], errors: [{ line, text }], skipped (schon vorhanden bzw. doppelt in der
 *   Liste), rows, columns, problem ('' oder Text, wenn nichts gelesen werden konnte) }.
 * overlap: die Person ist im Zeitraum schon anders eingetragen (kommt trotzdem herüber, als Hinweis).
 */
export function parseAbsenceTable(raw, { employees = [], existing = [], today = '' } = {}) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n')
  const out = { items: [], unknown: [], errors: [], skipped: 0, rows: 0, columns: [], problem: '' }
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ';'
  const cells = (l) => l.split(sep).map(text)
  let headAt = -1
  let fields = []
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const f = cells(lines[i]).map(fieldOf)
    if (f.includes('name') && (f.includes('from') || f.includes('span'))) {
      headAt = i
      fields = f
      break
    }
  }
  if (headAt < 0) {
    out.problem = lines.some((l) => text(l)) ? 'Keine Überschrift erkannt. Die erste Zeile braucht „Name“ und „Von“ (oder „Zeitraum“); „Vorlage kopieren“ zeigt alle Spalten.' : 'Bitte die Liste aus Excel einfügen.'
    return out
  }
  out.columns = [...new Set(fields.filter(Boolean))]
  const find = nameMatcher(employees.filter((e) => !e.inactive))
  const seen = new Set((existing || []).map((a) => `${a.employeeId}|${a.type}|${a.from}|${a.to}`))
  const unknown = new Set()
  let lastName = ''
  for (let i = headAt + 1; i < lines.length; i++) {
    if (!text(lines[i])) continue
    const c = cells(lines[i])
    const row = {}
    fields.forEach((f, k) => {
      if (f && !row[f]) row[f] = c[k] || ''
    })
    if (!Object.values(row).some(Boolean)) continue
    out.rows++
    // leere Namenszelle: weitere Abwesenheit der Person darüber
    const written = row.name || lastName
    lastName = written
    if (!written) {
      out.errors.push({ line: i + 1, text: 'Name fehlt' })
      continue
    }
    let span = null
    if (row.from) {
      const a = absenceDate(row.from, today)
      const b = row.to ? absenceDate(row.to, today) : a
      span = a && b ? range(a, b) : null
      // „Von“ enthält schon den ganzen Zeitraum
      if (!span && !row.to) span = absenceSpan(row.from, today)
    } else span = absenceSpan(row.span, today)
    if (!span) {
      out.errors.push({ line: i + 1, text: `${written}: Datum „${[row.from, row.to, row.span].filter(Boolean).join(' – ')}“ nicht lesbar (z. B. 23.12.2026)` })
      continue
    }
    if (span.to < span.from) {
      out.errors.push({ line: i + 1, text: `${written}: „Bis“ liegt vor „Von“` })
      continue
    }
    const hit = find(written)
    if (!hit) {
      unknown.add(written)
      continue
    }
    const t = absenceType(row.type)
    const note = [row.note, t.note].map(text).filter(Boolean).join(' · ')
    const key = `${hit.emp.id}|${t.type}|${span.from}|${span.to}`
    if (seen.has(key)) {
      out.skipped++
      continue
    }
    seen.add(key)
    const overlap = (existing || []).some((a) => a.employeeId === hit.emp.id && a.from <= span.to && a.to >= span.from) || out.items.some((a) => a.employeeId === hit.emp.id && a.from <= span.to && a.to >= span.from)
    out.items.push({ employeeId: hit.emp.id, name: hit.emp.name, ...(hit.exact ? {} : { written }), type: t.type, from: span.from, to: span.to, ...(note ? { note } : {}), ...(overlap ? { overlap: true } : {}) })
  }
  out.unknown = [...unknown]
  if (!out.items.length && !out.problem) {
    out.problem = out.skipped && !out.unknown.length && !out.errors.length ? 'Alles aus der Liste ist schon eingetragen.' : out.rows ? 'Keine Zeile konnte übernommen werden.' : 'Unter der Überschrift steht keine Zeile.'
  }
  return out
}

/** Zusammenfassung: „12 Abwesenheiten für 8 Personen (10 × Urlaub, 2 × Krankenstand)“. */
export function absenceSummary(r) {
  const n = r.items.length
  const people = new Set(r.items.map((a) => a.employeeId)).size
  const kinds = IMPORT_TYPES.map((t) => [t, r.items.filter((a) => a.type === t).length]).filter(([, k]) => k)
  const parts = [`${n} ${n === 1 ? 'Abwesenheit' : 'Abwesenheiten'} für ${people} ${people === 1 ? 'Person' : 'Personen'}${kinds.length ? ` (${kinds.map(([t, k]) => `${k} × ${t}`).join(', ')})` : ''}`]
  if (r.skipped) parts.push(`${r.skipped} schon vorhanden`)
  if (r.unknown.length) parts.push(`${r.unknown.length} ${r.unknown.length === 1 ? 'Name' : 'Namen'} nicht gefunden`)
  const over = r.items.filter((a) => a.overlap).length
  if (over) parts.push(`${over} mit Überschneidung`)
  return parts.join(' · ')
}
