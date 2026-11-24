// Interne Aufgaben: wer macht was bis wann – rein rechnend, ohne Oberfläche (Tests: test/aufgaben.test.js).
// Ablage aufgaben/aufgaben.json { schema: 1, items[], settings {} }; eine Aufgabe:
//   { id, title, note, objectId?, assignee { name, email? } | null, due? (JJJJ-MM-TT), priority 'normal' | 'hoch',
//     status 'offen' | 'in-arbeit' | 'erledigt', createdAt/By, updatedAt/By, doneAt/By?,
//     log [{ at, by, text }] (Verlauf: angelegt, zugewiesen, Status, Fälligkeit, Kommentare) }
// „Meine“ Aufgaben erkennt die App am Namen bzw. an der E-Mail der angemeldeten Person. Die Datei sehen alle Rollen mit
// dem Bereich „Aufgaben“ – sie ist für die Zusammenarbeit im Büro gedacht, nicht für Vertrauliches.

export const STATUS = { offen: 'offen', 'in-arbeit': 'in Arbeit', erledigt: 'erledigt' }
export const PRIORITY = { normal: 'normal', hoch: 'dringend' }
export const FILTERS = { meine: 'Meine', offen: 'Alle offenen', ueberfaellig: 'Überfällig', erledigt: 'Erledigt', alle: 'Alle' }

const text = (v) => String(v ?? '').trim()
const lower = (v) => text(v).toLowerCase()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const isMail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(v))
const dayIndex = (iso) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 864e5)
const deDate = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`

export const emptyAufgaben = () => ({ schema: 1, items: [], settings: {} })

/** Inhalt der Datei in die heutige Form bringen (fehlende Teile ergänzen); ändert das Objekt selbst. */
export function upgradeAufgaben(doc) {
  if (!doc || typeof doc !== 'object') return emptyAufgaben()
  doc.schema ||= 1
  if (!Array.isArray(doc.items)) doc.items = []
  doc.settings ||= {}
  return doc
}

export const isOpen = (t) => t?.status !== 'erledigt'

/** Eingaben säubern: { title, note, objectId, assignee { name, email? } | null, due, priority, status }. */
export function normalizeTask(input = {}) {
  const name = text(input.assignee?.name ?? input.assigneeName)
  const email = lower(input.assignee?.email ?? input.assigneeEmail)
  return {
    title: text(input.title),
    note: text(input.note),
    objectId: text(input.objectId),
    assignee: name || email ? { name: name || email, ...(isMail(email) ? { email } : {}) } : null,
    due: isDate(input.due) ? input.due : '',
    priority: input.priority === 'hoch' ? 'hoch' : 'normal',
    status: Object.hasOwn(STATUS, input.status) ? input.status : 'offen',
  }
}

/** Fehlt etwas? '' = in Ordnung. */
export function taskProblem(t, { rawDue = undefined } = {}) {
  if (!text(t?.title)) return 'Bitte kurz beschreiben, was zu tun ist.'
  if (text(t.title).length > 200) return 'Die Aufgabe bitte kürzer fassen (höchstens 200 Zeichen); Einzelheiten gehören in die Notiz.'
  if (rawDue !== undefined && text(rawDue) && !isDate(rawDue)) return 'Das Datum „fällig am“ ist ungültig.'
  return ''
}

const assigneeText = (a) => (a ? a.name || a.email || '' : '')
const entry = (now, by, t) => ({ at: now, by, text: t })

/** Neue Aufgabe (Kopie mit id, Zeitstempeln und erstem Eintrag im Verlauf). */
export function createTask(fields, { now = new Date().toISOString(), by = '', newId = () => `au${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const f = normalizeTask(fields)
  const who = assigneeText(f.assignee)
  const t = { id: newId(), ...f, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, log: [entry(now, by, `angelegt${who ? `, zuständig: ${who}` : ''}${f.due ? `, fällig am ${deDate(f.due)}` : ''}`)] }
  if (f.status === 'erledigt') Object.assign(t, { doneAt: now, doneBy: by })
  return t
}

/**
 * Aufgabe ändern (Kopie): Änderungen an Zuständigkeit, Fälligkeit, Dringlichkeit und Status kommen in den Verlauf;
 * „erledigt“ setzt doneAt/doneBy, wieder öffnen nimmt sie weg. Ohne Änderung kommt dieselbe Aufgabe zurück.
 */
export function updateTask(task, fields, { now = new Date().toISOString(), by = '' } = {}) {
  const f = normalizeTask({ ...task, ...fields })
  const notes = []
  if (assigneeText(f.assignee) !== assigneeText(task.assignee)) notes.push(f.assignee ? `zuständig: ${assigneeText(f.assignee)}` : 'ohne Zuständige/n')
  if (f.due !== (task.due || '')) notes.push(f.due ? `fällig am ${deDate(f.due)}` : 'ohne Fälligkeit')
  if (f.priority !== (task.priority || 'normal')) notes.push(f.priority === 'hoch' ? 'als dringend markiert' : 'nicht mehr dringend')
  if (f.status !== (task.status || 'offen')) notes.push(`Status: ${STATUS[f.status]}`)
  const same = !notes.length && f.title === task.title && f.note === (task.note || '') && f.objectId === (task.objectId || '') && (f.assignee?.email || '') === (task.assignee?.email || '')
  if (same) return task
  const next = { ...task, ...f, updatedAt: now, updatedBy: by, log: [...(task.log || []), ...(notes.length ? [entry(now, by, notes.join(', '))] : [])] }
  if (f.status === 'erledigt' && task.status !== 'erledigt') Object.assign(next, { doneAt: now, doneBy: by })
  if (f.status !== 'erledigt') {
    delete next.doneAt
    delete next.doneBy
  }
  return next
}

export const setStatus = (task, status, opts = {}) => updateTask(task, { status }, opts)

/** Kommentar im Verlauf (Kopie); leerer Text ändert nichts. */
export function addComment(task, comment, { now = new Date().toISOString(), by = '' } = {}) {
  const c = text(comment)
  if (!c) return task
  return { ...task, updatedAt: now, updatedBy: by, log: [...(task.log || []), { at: now, by, text: c, comment: true }] }
}

/** Gehört die Aufgabe der angemeldeten Person? me: { name, email }. */
export function isMine(task, me = {}) {
  const a = task?.assignee
  if (!a) return false
  if (a.email && lower(me.email) && lower(a.email) === lower(me.email)) return true
  return !!lower(a.name) && lower(a.name) === lower(me.name)
}

/** Tage bis zur Fälligkeit (negativ = überfällig); null ohne Datum. */
export const daysLeft = (task, today) => (isDate(task?.due) && isDate(today) ? dayIndex(task.due) - dayIndex(today) : null)
export const isOverdue = (task, today) => isOpen(task) && daysLeft(task, today) !== null && daysLeft(task, today) < 0

/** „überfällig seit 3 Tagen“, „heute fällig“, „morgen fällig“, „fällig am 3.12.2026“ ('' ohne Datum). */
export function dueText(task, today) {
  const d = daysLeft(task, today)
  if (d === null) return ''
  if (!isOpen(task)) return `war fällig am ${deDate(task.due)}`
  if (d < 0) return `überfällig seit ${d === -1 ? 'gestern' : `${-d} Tagen`}`
  if (d === 0) return 'heute fällig'
  if (d === 1) return 'morgen fällig'
  return `fällig am ${deDate(task.due)}`
}

const rank = (t, today) => {
  const d = daysLeft(t, today)
  return [isOpen(t) ? 0 : 1, d === null ? 1 : 0, d ?? 0, t.priority === 'hoch' ? 0 : 1]
}

/**
 * Liste für die Ansicht: Filter wie FILTERS, query sucht in Titel, Notiz, Zuständigen und (mit objectName) im Objekt.
 * Reihenfolge: offene vor erledigten; mit Datum zuerst (Überfälliges oben), dann dringende, dann die neuesten;
 * erledigte nach dem Abschluss (neueste zuerst).
 */
export function taskRows(items = [], { filter = 'meine', me = {}, today = '', query = '', objectName = () => '' } = {}) {
  const q = lower(query)
  const list = (items || []).filter((t) => {
    if (filter === 'meine' && !(isOpen(t) && isMine(t, me))) return false
    if (filter === 'offen' && !isOpen(t)) return false
    if (filter === 'ueberfaellig' && !isOverdue(t, today)) return false
    if (filter === 'erledigt' && isOpen(t)) return false
    if (!q) return true
    return [t.title, t.note, t.assignee?.name, t.assignee?.email, objectName(t.objectId)].some((v) => lower(v).includes(q))
  })
  return list.sort((a, b) => {
    if (!isOpen(a) && !isOpen(b)) return String(b.doneAt || '').localeCompare(String(a.doneAt || ''))
    const ra = rank(a, today)
    const rb = rank(b, today)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  })
}

/** Zahlen für Reiter, Seitenleiste und „Zu erledigen“. */
export function taskSummary(items = [], { me = {}, today = '' } = {}) {
  const open = (items || []).filter(isOpen)
  const mine = open.filter((t) => isMine(t, me))
  return {
    open: open.length,
    mine: mine.length,
    overdue: open.filter((t) => isOverdue(t, today)).length,
    mineOverdue: mine.filter((t) => isOverdue(t, today)).length,
    mineSoon: mine.filter((t) => { const d = daysLeft(t, today); return d !== null && d >= 0 && d <= 1 }).length,
    unassigned: open.filter((t) => !t.assignee).length,
    done: (items || []).length - open.length,
  }
}

/**
 * Für „Zu erledigen“: meine offenen Aufgaben, die überfällig oder bis morgen fällig sind, dazu neu zugewiesene ohne
 * Datum der letzten sieben Tage. Liefert [{ id, task, why }]; die id ändert sich mit der Fälligkeit (neuer Hinweis).
 */
export function taskAlerts(items = [], { me = {}, today = '' } = {}) {
  const out = []
  for (const t of items || []) {
    if (!isOpen(t) || !isMine(t, me)) continue
    const d = daysLeft(t, today)
    if (d !== null && d <= 1) out.push({ id: `aufgabe:${t.id}:${t.due}`, task: t, why: dueText(t, today) })
    else if (d === null && isDate(String(t.createdAt || '').slice(0, 10)) && isDate(today) && dayIndex(today) - dayIndex(t.createdAt.slice(0, 10)) <= 7) out.push({ id: `aufgabe:${t.id}:neu`, task: t, why: 'neu für dich' })
  }
  return out.sort((a, b) => (daysLeft(a.task, today) ?? 99) - (daysLeft(b.task, today) ?? 99))
}

/** Namen für die Auswahl „zuständig“: Mitarbeitende, wer schon Aufgaben hat und die angemeldete Person. */
export function assigneeChoices(items = [], { employees = [], me = {} } = {}) {
  const map = new Map()
  const add = (name, email = '') => {
    const n = text(name)
    if (!n) return
    const k = lower(n)
    if (!map.has(k)) map.set(k, { name: n, email: lower(email) })
    else if (email && !map.get(k).email) map.get(k).email = lower(email)
  }
  add(me.name, me.email)
  for (const t of items || []) add(t.assignee?.name, t.assignee?.email)
  for (const e of employees || []) if (e?.active !== false) add(e.name, e.email)
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** E-Mail an die zuständige Person: { subject, text }. */
export function taskMail(task, { objectName = '', sender = '', today = '' } = {}) {
  const lines = [`Hallo ${text(task.assignee?.name).split(' ')[0] || ''},`.replace(' ,', ','), '', 'für dich ist eine Aufgabe in der Cleanos App eingetragen:', '', task.title]
  if (objectName) lines.push(`Objekt: ${objectName}`)
  if (task.due) lines.push(`Fällig: ${deDate(task.due)}${today && isOverdue(task, today) ? ' (überfällig)' : ''}`)
  if (task.priority === 'hoch') lines.push('Dringend')
  if (task.note) lines.push('', task.note)
  lines.push('', 'Du findest sie in der App unter „Aufgaben“.', '', 'Viele Grüße', ...[text(sender)].filter(Boolean))
  return { subject: `Aufgabe: ${task.title}`, text: lines.join('\n') }
}
