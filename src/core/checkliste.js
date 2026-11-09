// Leistungs-Checkliste am Handy: Je Leistung des Stammplans (data.tasks[].checklist) eine Liste von Punkten, die die
// Reinigungskraft im „Plan am Handy“ (mein-plan.php) je Einsatz abhakt: erledigt, mit Foto, wo die Leistung es
// verlangt, oder „nicht möglich“ mit kurzem Grund. Der Webspace speichert je Einsatz und Person
// (privat/mitarbeiter/checklisten.json, Fotos ohne Metadaten), die App holt die Stände mit den Stempelungen ab und
// speichert sie je Woche (Feld checks wie stamps). Daraus: Block im Einsatz-Dialog, „Zu erledigen“ und auf Wunsch
// die Checkliste im Leistungsnachweis (core/proof.js).
//
// Punkt einer Leistung (task.checklist[]):
//   { id, text, photo?: true, days?: [1..7] (nur an diesen Wochentagen), weekly?: true (1× pro Woche: beim ersten
//     Einsatz der Leistung in der Woche), i18n?: { tr: { text, source, at, by, ki } } }
// Übersetzungen wie bei den Objektanweisungen (core/sprachen.js): source ist der Kennwert des deutschen Texts; ändert
// er sich, gilt die Übersetzung als veraltet und das Handy zeigt den deutschen Text.
//
// Stand in der App (checks[„Datum|kID“], Datum = Tag des Einsatzes):
//   { id, date, instKey, empId, name, objectId, objectName, label,
//     items: [{ id, text, photoRequired, status: 'ok' | 'nicht' | '', reason, at, photo: { datei, pfad?, url?, webspaceGeloescht? } | null }],
//     finished: ISO | null, changed: Unix-Sekunden, seen?: { sig, at, by } }
// Hier steht, was auch der Start der App braucht (Veröffentlichen, Leistungsnachweis). Punkte bereinigen, Stände vom
// Webspace übernehmen, „Zu erledigen“ und „Mit KI übersetzen“: core/checkliste-buero.js (später geladen); Vorlagen mit
// Übersetzungen: core/checkliste-vorlagen.js.

import { isoWeekday, mondayOf } from './dates.js'
import { objectInfo } from './sprachen.js'

export const MAX_ITEMS = 30
export const MAX_TEXT = 160
export const ITEM_ID = /^[a-z0-9]{1,16}$/

/** Erster nicht entfallener Einsatz der Leistung in seiner Woche (für „1× pro Woche“)? */
function firstInWeek(inst, instances) {
  const monday = mondayOf(inst.date)
  return !instances.some((i) => i.taskId === inst.taskId && i.key !== inst.key && i.status !== 'cancelled' && mondayOf(i.date) === monday && i.start < inst.start)
}

/** Punkte für diesen Einsatz: Wochentag-Regel und „1× pro Woche“; abgesagte Einsätze haben keine. */
export function itemsFor(task, inst, instances = []) {
  if (!task?.checklist?.length || !inst || inst.status === 'cancelled') return []
  const day = inst.weekday || isoWeekday(inst.date)
  return task.checklist.filter((x) => (!x.days?.length || x.days.includes(day)) && (!x.weekly || firstInWeek(inst, instances)))
}

/**
 * Für den Plan am Handy (woche.tage[].eintraege[].checkliste): [{ id, text, foto?, uebersetzt? }], Übersetzungen wie
 * objectInfo (veraltete markiert). Leer, wenn die Leistung keine Punkte für diesen Einsatz hat.
 */
export function publishItems(task, inst, instances = []) {
  return itemsFor(task, inst, instances).map((x) => {
    const info = objectInfo({ instructions: x.text, instructionsI18n: x.i18n })
    return { id: x.id, text: x.text, ...(x.photo ? { foto: true } : {}), ...(info?.uebersetzt ? { uebersetzt: info.uebersetzt } : {}) }
  })
}

// ---------------------------------------------------------------- Leistungsnachweis

/** Checklisten je Einsatz: Map instKey → [Stand je Person]. */
export function checksByInst(checks, { from = '0000-01-01', to = '9999-12-31' } = {}) {
  const out = new Map()
  for (const c of Object.values(checks || {})) {
    if (!c?.instKey || c.date < from || c.date > to) continue
    if (!out.has(c.instKey)) out.set(c.instKey, [])
    out.get(c.instKey).push(c)
  }
  return out
}

/**
 * Für den Leistungsnachweis: alle Personen eines Einsatzes zusammen. Ein Punkt gilt als erledigt, wenn ihn jemand
 * erledigt hat; „nicht möglich“ (mit Grund) nur, wenn ihn niemand erledigt hat. null ohne Checkliste.
 * { total, done, notPossible: [{ text, reason }], open, finished }
 */
export function instSummary(records) {
  const list = (records || []).filter((c) => c?.items?.length)
  if (!list.length) return null
  const byId = new Map()
  for (const c of list) {
    for (const it of c.items) {
      const cur = byId.get(it.id)
      if (!cur) byId.set(it.id, { text: it.text, status: it.status, reason: it.reason })
      else if (it.status === 'ok' || (it.status === 'nicht' && !cur.status)) Object.assign(cur, { status: it.status, reason: it.reason })
    }
  }
  const items = [...byId.values()]
  return {
    total: items.length,
    done: items.filter((x) => x.status === 'ok').length,
    notPossible: items.filter((x) => x.status === 'nicht').map((x) => ({ text: x.text, reason: x.reason })),
    open: items.filter((x) => !x.status).length,
    finished: list.every((c) => c.finished),
  }
}

/** Kurztext für Nachweis und Liste: „5 von 6 erledigt“ (nicht möglich steht extra). */
export const summaryText = (s) => (s ? `${s.done} von ${s.total} erledigt` : '')
