// Objektkontrolle nach dem Prüfprotokoll-Tool: fünfstufige Bewertung je
// Prüfpunkt, Vorschlag für den Gesamtzustand, Mängel werden über Kontrollen
// fortgeschrieben (gleicher Punkt später OK → erledigt). Neu gegenüber dem
// Werkzeug: Checklisten als Daten, Zuständigkeit und Frist je Mangel,
// Nacharbeit als Einsatz im Dienstplan, Rhythmus je Objekt.
//
// Daten (kontrolle/kontrolle.json):
//   checklists:  [{ id, name, version, chapters: [{ title, items: [Text] }] }]
//   plans:       { objektId: { months, checklistId? } }      Kontrollrhythmus
//   inspections: [{ id, objectId, checklistId, date, time, inspector, kind, status: 'offen'|'abgeschlossen', closedAt?,
//                   items: { '1.6': { rating, note?, prio?, photos?: [Foto], assignee?, due?, done?: { at, by }, taskId? } },
//                   summary: { overall?, text?, followUp?, followUpDate? },
//                   signatures: { inspector?: { name, image, at }, customer?: { name, image, at } }, sent?: [...] }]

import { addDays, dayIndex, lastOfMonth } from './dates.js'

export const RATINGS = {
  OK: { short: 'OK', text: 'in Ordnung' },
  R: { short: 'R', text: 'Reinigung erforderlich' },
  M: { short: 'M', text: 'Mangel / Reparatur' },
  G: { short: 'G', text: 'Gefahr – sofort sichern und melden' },
  NA: { short: 'N/A', text: 'nicht vorhanden / nicht geprüft' },
}
export const RATING_KEYS = ['OK', 'R', 'M', 'G', 'NA']
export const DEFECTS = ['R', 'M', 'G']
// Vorgabe: Reinigung bis zum nächsten Einsatz (kurzfristig), Reparatur braucht oft eine Firma (planbar)
export const DEFAULT_PRIO = { G: '1', R: '2', M: '3' }
export const PRIOS = { 1: 'sofort', 2: 'kurzfristig', 3: 'planbar', 4: 'beobachten' }
export const OVERALL = ['Sehr gut', 'Gut', 'Handlungsbedarf', 'Kritisch']
/**
 * Frist ab Kontrolle je Priorität (Tage), als Vorschlag. Je weniger dringend,
 * desto länger: sofort = am nächsten Tag (Gefahr sichern), kurzfristig = eine
 * Woche (bis zum nächsten wöchentlichen Einsatz; Vorgabe für Reinigung),
 * planbar = zwei Wochen (Vorgabe für Reparaturen), beobachten = bis zur
 * nächsten Regelkontrolle (Quartal). Die Fristen der Vorgaben bleiben damit
 * wie bisher (Reinigung 7, Reparatur 14 Tage).
 */
export const PRIO_DAYS = { 1: 1, 2: 7, 3: 14, 4: 90 }

/** Alle Prüfpunkte einer Checkliste: [{ id: '1.6', chapter: 0, chapterTitle, text }] */
export function checklistItems(checklist) {
  return (checklist?.chapters || []).flatMap((ch, i) => ch.items.map((text, j) => ({ id: `${i + 1}.${j + 1}`, chapter: i, chapterTitle: ch.title, text })))
}

/** Text eines Prüfpunkts (auch aus einer anderen Checkliste). */
export function itemText(checklist, id) {
  const [c, i] = id.split('.').map(Number)
  return checklist?.chapters?.[c - 1]?.items?.[i - 1] || `Punkt ${id}`
}

/** Vorschlag Gesamtzustand: G → Kritisch; M ab 3 → Handlungsbedarf; M oder R ab 4 → Gut; sonst Sehr gut. */
export function suggestOverall(items = {}) {
  const count = (r) => Object.values(items).filter((x) => x.rating === r).length
  if (count('G')) return 'Kritisch'
  if (count('M') >= 3) return 'Handlungsbedarf'
  if (count('M') >= 1 || count('R') >= 4) return 'Gut'
  return 'Sehr gut'
}

const WORST = ['G', 'M', 'R']
/** Fortschritt je Kapitel: bewertet, gesamt, schlechteste Bewertung. */
export function progress(checklist, items = {}) {
  const all = checklistItems(checklist)
  const chapters = (checklist?.chapters || []).map((ch, i) => {
    const list = all.filter((x) => x.chapter === i)
    const rated = list.filter((x) => items[x.id]?.rating)
    return { title: ch.title, total: list.length, rated: rated.length, worst: WORST.find((r) => rated.some((x) => items[x.id].rating === r)) || (rated.length ? 'OK' : null) }
  })
  return { total: all.length, rated: all.filter((x) => items[x.id]?.rating).length, chapters }
}

export const quarterOf = (date) => `Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1} ${date.slice(0, 4)}`

/**
 * Feststellungen einer Kontrolle (R, M, G) nach Priorität. Geht von den
 * Bewertungen aus, nicht von der Checkliste: auch wenn diese fehlt oder eine
 * andere ist, geht keine Feststellung verloren (Text dann „Punkt 3.2“).
 */
export function findings(inspection, checklist) {
  return Object.entries(inspection.items || {})
    .filter(([, it]) => DEFECTS.includes(it?.rating))
    .map(([id, it]) => {
      const chapter = Number(id.split('.')[0]) - 1
      return { id, chapter, chapterTitle: checklist?.chapters?.[chapter]?.title || '', text: itemText(checklist, id), ...it, prio: it.prio || DEFAULT_PRIO[it.rating] }
    })
    .sort((a, b) => a.prio.localeCompare(b.prio) || a.id.localeCompare(b.id, 'de', { numeric: true }))
}

const byDate = (a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || (a.closedAt || '').localeCompare(b.closedAt || '')

/**
 * Offene Mängel über alle (abgeschlossenen) Kontrollen: je Objekt, Checkliste
 * und Prüfpunkt zählt die letzte Bewertung (Punkt 1.6 einer anderen Checkliste
 * ist ein anderer Punkt). R/M/G ohne „erledigt“ ist offen, OK schließt den
 * Mangel, N/A und „nicht bewertet“ ändern nichts. Ältere Kontrollen ohne
 * Checkliste schreibt derselbe Punkt einer späteren Kontrolle fort.
 * `exclude`: Kontrolle, die nicht mitzählt (die gerade bearbeitete).
 * Liefert [{ objectId, checklistId, itemId, rating, note, prio, since, inspectionId, assignee, due, photos }].
 */
export function openDefects(inspections, { objectId = null, exclude = null } = {}) {
  const state = new Map()
  for (const insp of [...inspections].filter((x) => x.status === 'abgeschlossen' && x.id !== exclude && (!objectId || x.objectId === objectId)).sort(byDate)) {
    const checklistId = insp.checklistId || ''
    for (const [itemId, item] of Object.entries(insp.items || {})) {
      if (item.rating !== 'OK' && !DEFECTS.includes(item.rating)) continue
      const key = `${insp.objectId}|${checklistId}|${itemId}`
      const legacy = `${insp.objectId}||${itemId}`
      const prev = state.get(key) || state.get(legacy)
      state.delete(legacy)
      if (item.rating === 'OK' || item.done) state.delete(key)
      else state.set(key, { objectId: insp.objectId, checklistId, itemId, rating: item.rating, note: item.note || '', prio: item.prio || DEFAULT_PRIO[item.rating], since: prev?.since || insp.date, inspectionId: insp.id, date: insp.date, assignee: item.assignee || prev?.assignee || '', due: item.due || '', photos: item.photos || [], taskId: item.taskId || prev?.taskId || '' })
    }
  }
  return [...state.values()].sort((a, b) => a.prio.localeCompare(b.prio) || a.since.localeCompare(b.since))
}

export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + months, 1))
  const ym = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
  return `${ym}-${String(Math.min(d, Number(lastOfMonth(`${ym}-01`).slice(8)))).padStart(2, '0')}`
}

/**
 * Nächste Kontrolle je Objekt mit Rhythmus: { due, status: 'ueberfaellig'|'faellig'|'ok', last }
 * fällig ab 14 Tage vor dem Termin; ohne bisherige Kontrolle sofort fällig.
 * Eine Nachkontrolle mit Termin geht vor.
 */
export function inspectionDue(inspections, objectId, plan, today, { leadDays = 14 } = {}) {
  const done = inspections.filter((x) => x.objectId === objectId && x.status === 'abgeschlossen').sort(byDate)
  const last = done.at(-1) || null
  const open = inspections.find((x) => x.objectId === objectId && x.status !== 'abgeschlossen') || null
  let due = last ? addMonths(last.date, plan?.months || 3) : today
  let reason = last ? 'Regelkontrolle' : 'Erstaufnahme'
  if (last?.summary?.followUp && last.summary.followUpDate && last.summary.followUpDate < due) {
    due = last.summary.followUpDate
    reason = 'Nachkontrolle'
  }
  const status = today > due ? 'ueberfaellig' : today >= addDays(due, -leadDays) ? 'faellig' : 'ok'
  return { due, status, reason, last, open, days: dayIndex(due) - dayIndex(today) }
}

/** Textvorschlag für die Zusammenfassung. */
export function summaryText(inspection, checklist) {
  const p = progress(checklist, inspection.items)
  const f = findings(inspection, checklist)
  const count = (r) => f.filter((x) => x.rating === r).length
  const ok = Object.values(inspection.items || {}).filter((x) => x.rating === 'OK').length
  const parts = [`${p.rated} von ${p.total} Prüfpunkten bewertet, ${ok} in Ordnung.`]
  if (!f.length) parts.push('Keine Feststellungen.')
  else {
    parts.push(`${f.length} ${f.length === 1 ? 'Feststellung' : 'Feststellungen'}${[count('G') ? `${count('G')} × Gefahr` : '', count('M') ? `${count('M')} × Mangel` : '', count('R') ? `${count('R')} × Reinigung` : ''].filter(Boolean).map((x, i) => (i ? `, ${x}` : `: ${x}`)).join('')}.`)
    const urgent = f.filter((x) => x.rating === 'G' || x.prio === '1')
    if (urgent.length) parts.push(`Sofort: ${urgent.map((x) => `${x.text}${x.note ? ` (${x.note})` : ''}`).join('; ')}.`)
  }
  parts.push(`Gesamtzustand: ${inspection.summary?.overall || suggestOverall(inspection.items)}.`)
  return parts.join(' ')
}

/** Einsatz „Nacharbeit“ für einen Mangel (Dienstplan, einmalig). */
export function reworkTask(defect, { text, objectId, assignee = '', date, id, start = '08:00', minutes = 30 }) {
  const endMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + minutes
  return {
    id,
    objectId,
    label: `Nacharbeit: ${text}`,
    category: 'sonder',
    recurrence: { type: 'once', date },
    start,
    end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`,
    staff: 1,
    regulars: assignee ? [assignee] : [],
    skills: [],
    holidayRule: 'verschieben',
    instructions: defect.note ? `Mangel aus der Objektkontrolle: ${defect.note}` : 'Mangel aus der Objektkontrolle',
    defectRef: `${defect.inspectionId}|${defect.itemId}`,
  }
}

/** Checkliste ↔ Text: „# Kapitel“ und darunter je Zeile ein Prüfpunkt. */
export const checklistToText = (cl) => (cl?.chapters || []).map((ch) => `# ${ch.title}\n${ch.items.join('\n')}`).join('\n\n')
export function textToChapters(text) {
  const chapters = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) chapters.push({ title: line.replace(/^#+\s*/, '').replace(/^\d+\s+/, ''), items: [] })
    else {
      if (!chapters.length) chapters.push({ title: 'Allgemein', items: [] })
      chapters.at(-1).items.push(line.replace(/^[-•*]\s*/, ''))
    }
  }
  return chapters.filter((c) => c.items.length)
}
