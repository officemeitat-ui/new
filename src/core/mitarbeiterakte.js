// Mitarbeiterakte: Vermerke je Person (z. B. aus der Objektkontrolle „nicht ordentlich gereinigt“ mit Foto und Bericht),
// offen fürs Mitarbeitergespräch, Gespräche mit Ergebnis und Vereinbarung. Ab „limit“ (Vorgabe 3) offenen Vermerken, die
// zählen, erinnert „Zu erledigen“ an das Gespräch. Reine Funktionen ohne Browser (test/mitarbeiterakte.test.js); Ansicht
// ui/views/mitarbeiterakte.js, PDF export/akte-pdf.js. Dateien (Bericht, Fotos, Gesprächsprotokoll) liegen in SharePoint
// unter mitarbeiterakte/<Name>_<ID>/ (eigener Ordner: nur wer die Akte sieht), Fotos der Qualitätsmessung bleiben bei der
// Messung (qualitaet/nachweise/) und werden nur verknüpft.
//
// Datei mitarbeiterakte/akte.json:
//   { entries: [{ id, empId, date, kind, objectId, title, text, photos: [Datei], report: Datei|null,
//                 source: { type: 'qualitaet', measurementId, rooms: [Nr] } | null, by, at, talkId }],
//     talks:   [{ id, empId, date, entryIds, note, agreed, followUp, pdf: Datei|null, by, at }],
//     settings: { limit, keepMonths } }
//   Datei = { path, name, type, size, at, by, url?, queued?, local? }
//
// Rechtliches (docs/RECHTSPRUEFUNG.md, Punkt 59): Vermerke sind personenbezogene Daten über Leistung und Verhalten. Nur wer
// die Personalverwaltung sieht, liest die Akte; die Person hat ein Recht auf Auskunft (Art. 15 DSGVO). Besprochene Vermerke
// fallen nach „keepMonths“ (Vorgabe 24) weg. Gibt es einen Betriebsrat, die Akte mit ihm abstimmen (§ 96a ArbVG).

import { addMonths } from './trainings.js'

export const AKTE_KINDS = {
  qualitaet: { label: 'Objektkontrolle', counts: true },
  reklamation: { label: 'Reklamation', counts: true },
  verhalten: { label: 'Pünktlichkeit / Verhalten', counts: true },
  lob: { label: 'Lob', counts: false },
  notiz: { label: 'Notiz', counts: false },
}
export const AKTE_DEFAULTS = { limit: 3, keepMonths: 24 }
export const emptyAkte = () => ({ entries: [], talks: [], settings: {} })
export const akteSettings = (doc) => ({ ...AKTE_DEFAULTS, ...(doc?.settings || {}) })

const byDate = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at || '').localeCompare(String(a.at || ''))

/** Vermerke einer Person, neueste zuerst. */
export const entriesOf = (doc, empId) => (doc?.entries || []).filter((e) => e.empId === empId).sort(byDate)

/** Offen fürs Gespräch: noch nicht besprochen und von einer Art, die zählt (Lob und Notiz zählen nicht). */
export const openEntries = (doc, empId) => entriesOf(doc, empId).filter((e) => !e.talkId && AKTE_KINDS[e.kind]?.counts !== false)

/**
 * Wer ein Mitarbeitergespräch braucht: [{ emp, entries, since }] mit mindestens „limit“ offenen Vermerken, die meisten zuerst.
 * Ausgetretene nicht.
 */
export function talksDue(doc, employees = [], today = '') {
  const { limit } = akteSettings(doc)
  return employees
    .filter((e) => !e.exitDate || !today || e.exitDate >= today)
    .map((emp) => {
      const entries = openEntries(doc, emp.id)
      return { emp, entries, since: entries.at(-1)?.date || '' }
    })
    .filter((x) => x.entries.length >= Math.max(1, Number(limit) || AKTE_DEFAULTS.limit))
    .sort((a, b) => b.entries.length - a.entries.length || a.since.localeCompare(b.since))
}

/** Übersicht je Person: { empId, open, total, last, talks, lastTalk }. */
export function summary(doc, empId) {
  const all = entriesOf(doc, empId)
  const talks = (doc?.talks || []).filter((t) => t.empId === empId).sort(byDate)
  return { empId, open: openEntries(doc, empId).length, total: all.length, last: all[0]?.date || '', talks: talks.length, lastTalk: talks[0]?.date || '' }
}

/**
 * Vermerke aus einer Objektkontrolle (Qualitätsmessung): je Person, die laut „gereinigt von“ (room.cleanedBy) Räume mit
 * Mangel hatte, ein Vermerk mit den Räumen, Prüfobjekten, Fehlerarten, Notizen und Fotos. Räume ohne Mangel oder ohne
 * Person zählen nicht. Schon angelegte (gleiche Messung und Person) kommen nicht doppelt.
 * → [{ empId, date, kind: 'qualitaet', objectId, title, text, photos, report, source }]
 */
export function entriesFromMeasurement(m, { doc = null, objectName = '', defectNames = {} } = {}) {
  const have = new Set((doc?.entries || []).filter((e) => e.source?.measurementId === m.id).map((e) => e.empId))
  const byEmp = new Map()
  m.rooms.forEach((room, i) => {
    const bad = (room.items || []).filter((it) => it.state === 'mangel')
    if (!room.cleanedBy || !bad.length) return
    const list = byEmp.get(room.cleanedBy) || []
    list.push({ room, i, bad })
    byEmp.set(room.cleanedBy, list)
  })
  const out = []
  for (const [empId, rooms] of byEmp) {
    if (have.has(empId)) continue
    const lines = rooms.map(({ room, bad }) => `${room.label}: ${bad.map((it) => `${it.name}${it.defects?.length ? ` (${it.defects.map((d) => defectNames[d] || d).join(', ')})` : ''}${it.note ? ` – ${it.note}` : ''}`).join('; ')}`)
    out.push({
      empId,
      date: m.date,
      kind: 'qualitaet',
      objectId: m.objectId,
      title: `Objektkontrolle${objectName ? ` ${objectName}` : ''}: ${rooms.length === 1 ? '1 Raum' : `${rooms.length} Räume`} nicht in Ordnung`,
      text: lines.join('\n'),
      photos: rooms.flatMap(({ bad }) => bad.map((it) => it.photo).filter(Boolean)),
      report: m.report || null,
      source: { type: 'qualitaet', measurementId: m.id, rooms: rooms.map(({ i }) => i) },
    })
  }
  return out
}

/**
 * Wer hat dort gereinigt? Aus den Einsätzen [{ date, objectId, employeeId, from? }]: am Tag der Kontrolle oder davor (bis
 * zu 7 Tage zurück), der späteste Tag zählt. Mehrere am selben Tag: alle (Auswahl in der Ansicht). → [empId]
 */
export function suggestCleaners(assignments = [], objectId, date) {
  const before = assignments.filter((a) => a.objectId === objectId && a.employeeId && a.date <= date).sort((a, b) => b.date.localeCompare(a.date))
  if (!before.length) return []
  const day = before[0].date
  const limit = new Date(Date.parse(`${date}T12:00:00Z`) - 7 * 86400e3).toISOString().slice(0, 10)
  if (day < limit) return []
  return [...new Set(before.filter((a) => a.date === day).map((a) => a.employeeId))]
}

/** Gespräch eintragen: die gewählten offenen Vermerke bekommen die ID des Gesprächs. Liefert das Gespräch. */
export function recordTalk(doc, { id, empId, date, entryIds = [], note = '', agreed = '', followUp = '', by = '', at = '' }) {
  const ids = new Set(entryIds)
  for (const e of doc.entries || []) if (e.empId === empId && ids.has(e.id) && !e.talkId) e.talkId = id
  const talk = { id, empId, date, entryIds: [...ids], note: String(note).trim(), agreed: String(agreed).trim(), followUp: followUp || '', pdf: null, by, at }
  doc.talks = [...(doc.talks || []), talk]
  return talk
}

/**
 * Aufräumen (Datensparsamkeit): besprochene Vermerke und Gespräche, die älter als keepMonths sind, fallen weg; offene
 * bleiben, bis sie besprochen sind. Liefert { entries, talks } (die entfernten, damit die Ansicht ihre Dateien löschen kann).
 */
export function purge(doc, today) {
  const { keepMonths } = akteSettings(doc)
  const months = Math.max(6, Number(keepMonths) || AKTE_DEFAULTS.keepMonths)
  const old = (date) => !!date && addMonths(date, months) < today
  const talks = (doc.talks || []).filter((t) => old(t.date))
  const gone = new Set(talks.map((t) => t.id))
  const entries = (doc.entries || []).filter((e) => e.talkId && gone.has(e.talkId) && old(e.date))
  const dropE = new Set(entries.map((e) => e.id))
  doc.entries = (doc.entries || []).filter((e) => !dropE.has(e.id))
  doc.talks = (doc.talks || []).filter((t) => !gone.has(t.id) || doc.entries.some((e) => e.talkId === t.id))
  return { entries, talks: talks.filter((t) => !doc.talks.includes(t)) }
}

/** Ordner der Person in SharePoint (Name lesbar, ID eindeutig). */
export const folderOf = (emp) => `mitarbeiterakte/${String(emp?.name || 'Person').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Person'}_${emp?.id || 'x'}`
