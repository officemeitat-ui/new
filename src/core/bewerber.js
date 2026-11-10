// Bewerber, Eintritt, Austritt: Bewerbungen mit Status bis zur Zusage oder Absage, Eintritts- und
// Austritts-Checklisten je Person mit Frist, erledigt von/am und Fortschritt. Reine Funktionen ohne Browser
// (test/bewerber.test.js); Ansichten: ui/views/bewerber.js (Bewerbungen) und ui/views/eintritt.js (Checklisten).
//
// Zwei Dateien mit getrennten Rechten (Bewerbungsunterlagen braucht die Lohnverrechnung nicht):
//
// bewerbung/bewerbung.json (Modul „bewerber“: Personalverwaltung und Vollzugriff)
//   { applicants: [{ id, name, phone, email, source, sourceNote, status, hours, region, langs: [Sprache], license,
//                    availability: { 1..7: { from, to } }, start, notes, docs: [Datei],
//                    log: [{ at, date, by, kind, status?, text }], decidedAt, rejectMail: { at, by, via, to } | null,
//                    empId, createdAt, createdBy, changedAt }],
//     settings: { silentDays, deleteMonths, rejectSubject, rejectText } }
//   status neu → kontakt → gespraech → probe → zusage | absage | zurueck. decidedAt: Tag der Zusage, Absage oder des
//   Rückzugs (ab da läuft bei Absage und Rückzug die Löschfrist). Sprachen wie employees[].lang (core/sprachen.js),
//   Revier wie objects[].region, Verfügbarkeit wie employees[].availability. Datei = { path, name, type, size, at, by,
//   url?, queued?, local? } unter bewerbung/unterlagen/<Kennung>/. Bewusst ohne Felder für Geburtsdatum, Alter,
//   Geschlecht, Herkunft, Staatsangehörigkeit, Familienstand, Foto oder Gesundheit (Gleichbehandlungsgesetz,
//   Datenminimierung); protectedHints() warnt, wenn so etwas in der Notiz steht.
//
// eintritt/eintritt.json (Modul „eintritt“: Personalverwaltung, Lohnverrechnung und Vollzugriff)
//   { lists: [{ id, kind: 'eintritt'|'austritt', empId, applicantId, date, tasks: [Aufgabe], createdAt, createdBy, closedAt }],
//     templates: { eintritt: [Vorlage], austritt: [Vorlage] }   leer = Vorgaben (EINTRITT_DEFAULTS, AUSTRITT_DEFAULTS)
//     settings: { payrollEmail } }
//   date: erster Arbeitstag (Eintritt) bzw. letzter Arbeitstag (Austritt). Vorlage = { id, type, title, offset, note,
//   active }; offset in Tagen ab date (−1 = am Vortag). Aufgabe = { id, type, title, offset, due, note, data,
//   done: { date, by, at } | null }. Manche Aufgaben gelten von selbst als erledigt, wenn die verknüpften Daten es
//   zeigen (linkedOf): Pflicht-Unterweisungen eingetragen, Schlüssel ausgegeben bzw. alle zurück, Link „Plan am
//   Handy“ deaktiviert, keine Einsätze nach dem Austritt mehr.
//
// Fristen und Inhalte sind Vorschläge, keine Rechtsauskunft (docs/RECHTSPRUEFUNG.md, Punkt 34).

import { addDays, viennaDate } from './dates.js'
import { keysOf } from './keys.js'
import { addMonths, isRequired, statusOf as trainingStatus, typesOf as trainingTypes } from './trainings.js'

export const STATUS = { neu: 'neu', kontakt: 'Kontakt', gespraech: 'Gespräch geplant', probe: 'Probearbeit', zusage: 'Zusage', absage: 'Absage', zurueck: 'zurückgezogen' }
/** Reihenfolge der offenen Schritte. */
export const OPEN_STATUS = ['neu', 'kontakt', 'gespraech', 'probe']
export const CLOSED_STATUS = ['zusage', 'absage', 'zurueck']
export const SOURCES = { ams: 'AMS', inserat: 'Inserat', empfehlung: 'Empfehlung', initiativ: 'Initiativ' }
/** Filter „Status“ der Bewerbungen. */
export const STATUS_FILTERS = { '': 'offen', alle: 'alle', ...STATUS }
export const SILENT_DAYS = 7
export const DELETE_MONTHS = 6

export const DEFAULT_REJECT = {
  subject: 'Ihre Bewerbung bei {firma}',
  text: 'Guten Tag {name},\n\nvielen Dank für Ihre Bewerbung und Ihr Interesse an einer Mitarbeit bei {firma}.\n\nLeider können wir Ihnen keine Stelle anbieten. Wir haben uns für eine andere Bewerbung entschieden.\n\nIhre Unterlagen bewahren wir noch {monate} Monate auf und löschen sie danach.\n\nWir wünschen Ihnen für Ihren weiteren Weg alles Gute.\n\nFreundliche Grüße\n{absender}\n{firma}',
}

export const emptyBewerbung = () => ({ applicants: [], settings: {} })
export const emptyEintritt = () => ({ lists: [], templates: {}, settings: {} })

const num = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback)
export const silentDaysOf = (doc) => num(doc?.settings?.silentDays, SILENT_DAYS)
export const deleteMonthsOf = (doc) => num(doc?.settings?.deleteMonths, DELETE_MONTHS)
export const isOpen = (a) => OPEN_STATUS.includes(a?.status || 'neu')

/** Tage zwischen zwei Daten (b − a). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)

// ---------------------------------------------------------------- Bewerbungen

/** Letzte Rückmeldung bzw. Aktivität: Anlage, Statuswechsel, vermerkter Kontakt (Datum JJJJ-MM-TT). */
export function lastActivity(a) {
  // Zeitpunkte als Tag in Wien (0:30 Uhr ist schon der neue Tag, nicht der UTC-Vortag)
  const day = (at) => (at ? viennaDate(at) || String(at).slice(0, 10) : '')
  const dates = [day(a?.createdAt), ...(a?.log || []).map((l) => l.date || day(l.at))].filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
  return dates.sort().at(-1) || ''
}

/** Offene Bewerbungen ohne Rückmeldung seit mehr als `days` Tagen: [{ a, since, days }], am längsten zuerst. */
export function silentApplicants(applicants = [], today, days = SILENT_DAYS) {
  return applicants
    .filter(isOpen)
    .map((a) => ({ a, since: lastActivity(a) }))
    .filter((x) => x.since && daysBetween(x.since, today) > days)
    .map((x) => ({ ...x, days: daysBetween(x.since, today) }))
    .sort((x, y) => y.days - x.days || x.a.name.localeCompare(y.a.name, 'de'))
}

/** Löschen fällig ab (Absage oder zurückgezogen + Monate), sonst ''. */
export function deleteDue(a, months = DELETE_MONTHS) {
  if (!['absage', 'zurueck'].includes(a?.status) || !a.decidedAt) return ''
  return addMonths(a.decidedAt, months)
}

/** Abgelehnte und zurückgezogene Bewerbungen, deren Löschfrist erreicht ist: [{ a, due }], älteste zuerst. */
export function deletionsDue(applicants = [], today, months = DELETE_MONTHS) {
  return applicants
    .map((a) => ({ a, due: deleteDue(a, months) }))
    .filter((x) => x.due && x.due <= today)
    .sort((x, y) => x.due.localeCompare(y.due))
}

/** Status ändern: neues Objekt mit Eintrag im Verlauf; Zusage, Absage und Rückzug setzen decidedAt. */
export function setStatus(a, status, { date, at = '', by = '', text = '' }) {
  if (!STATUS[status]) throw new Error(`Unbekannter Status ${status}`)
  const decided = CLOSED_STATUS.includes(status)
  return {
    ...a,
    status,
    decidedAt: decided ? date : '',
    log: [...(a.log || []), { at, date, by, kind: 'status', status, text: String(text || '').trim() }],
    changedAt: at,
  }
}

/** Kontakt oder Notiz vermerken (zählt als Rückmeldung). */
export const addLog = (a, { kind = 'kontakt', date, at = '', by = '', text = '' }) => ({ ...a, log: [...(a.log || []), { at, date, by, kind, text: String(text || '').trim() }], changedAt: at })

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
/** Bewerbung prüfen, bevor sie gespeichert wird: Text des ersten Problems oder ''. */
export function applicantProblem(f) {
  if (!String(f.name || '').trim()) return 'Bitte den Namen eintragen.'
  if (f.email && !EMAIL.test(String(f.email).trim())) return 'Die E-Mail-Adresse ist nicht gültig.'
  if (!SOURCES[f.source]) return 'Bitte die Quelle wählen (AMS, Inserat, Empfehlung, Initiativ).'
  if (f.hours !== '' && f.hours !== undefined && f.hours !== null && !(Number(f.hours) >= 0 && Number(f.hours) <= 60)) return 'Gewünschte Stunden zwischen 0 und 60 je Woche.'
  for (const [d, w] of Object.entries(f.availability || {})) if (!(Number(d) >= 1 && Number(d) <= 7) || !w?.from || !w?.to) return 'Bitte die Verfügbarkeit mit Beginn und Ende eintragen.'
  return ''
}

// Hinweise auf geschützte Merkmale (Gleichbehandlungsgesetz: Geschlecht, ethnische Zugehörigkeit, Religion oder
// Weltanschauung, Alter, sexuelle Orientierung; dazu Behinderung, Schwangerschaft, Familienstand, Gesundheit).
// Nur ein Hinweis beim Speichern, keine Sperre: Fachliches („Deutsch gut“, „Führerschein B“) bleibt erlaubt.
// Ganze Wörter (auch mit Umlaut am Rand): „Kindergarten“ oder „Christian“ lösen nichts aus.
const words = (alts) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, 'iu')
const PROTECTED = [
  [words('alter|älter|jünger|jahrgang|geboren|geburtsdatum|geburtstag|jahre alt'), 'Alter'],
  [words('herkunft|nationalität|staatsbürger\\p{L}*|ausländer\\p{L}*|hautfarbe|ethnisch\\p{L}*|migrations\\p{L}*'), 'Herkunft'],
  [words('religion|religiös|kopftuch|konfession|muslim|muslimisch|muslima|christlich|katholisch|evangelisch|orthodox|jüdisch'), 'Religion'],
  [words('schwanger\\p{L}*|kinderwunsch|mutterschutz|karenz'), 'Schwangerschaft'],
  [words('verheiratet|ledig|geschieden|verwitwet|alleinerziehend|kinder'), 'Familienstand'],
  [words('behinderung|behindert|chronisch|erkrankung|krankheit|diagnose|gesundheitlich'), 'Gesundheit'],
  [words('homosexuell|schwul|lesbisch|sexuelle?'), 'sexuelle Orientierung'],
  [words('männlich|weiblich|geschlecht'), 'Geschlecht'],
]
/** Welche geschützten Merkmale ein Text vermutlich nennt (ohne Doppel). */
export function protectedHints(text = '') {
  const s = String(text || '')
  return [...new Set(PROTECTED.filter(([re]) => re.test(s)).map(([, label]) => label))]
}

/** Sprache am Handy aus den Sprachen der Bewerbung: Deutsch, wenn angegeben, sonst die erste. */
export const handyLang = (a) => ((a?.langs || []).includes('de') || !(a?.langs || []).length ? 'de' : a.langs[0])

/**
 * Stammblatt aus der Bewerbung vorbefüllen (staff.js, Dialog „employee“): Name, E-Mail, Revier, Wochenstunden,
 * Beschäftigung (ab 38 h Vollzeit), Eintritt, Verfügbarkeit, Sprache am Handy, Führerschein als Qualifikation
 * (nur wenn es die Qualifikation gibt). Was fehlt (Personalnummer, Lohngruppe), ergänzt das Büro.
 */
export function employeeFrom(a, { skills = [] } = {}) {
  const hours = Number(a.hours) > 0 ? Math.round(Number(a.hours) * 2) / 2 : 20
  const out = {
    name: String(a.name || '').trim(),
    type: hours >= 38 ? 'Vollzeit' : 'Teilzeit',
    weeklyHours: hours,
    skills: a.license && skills.includes('Führerschein') ? ['Führerschein'] : [],
    trained: [],
    availability: structuredClone(a.availability || {}),
  }
  if (a.email) out.email = String(a.email).trim().toLowerCase()
  if (a.region) out.team = a.region
  if (a.start) out.entryDate = a.start
  const lang = handyLang(a)
  if (lang !== 'de') out.lang = lang
  return out
}

/** Platzhalter {name}, {firma}, {absender}, {monate} in einer Vorlage ersetzen. */
export const fillText = (text, vars = {}) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))

/** Absage-Mail aus der Vorlage: { subject, text }. */
export function rejectMail(a, { settings = {}, firma = '', absender = '', months = DELETE_MONTHS } = {}) {
  const vars = { name: String(a.name || '').trim(), firma, absender, monate: months }
  return { subject: fillText(settings.rejectSubject || DEFAULT_REJECT.subject, vars).trim(), text: fillText(settings.rejectText || DEFAULT_REJECT.text, vars) }
}

/** Bewerbung entfernen: { applicants, files } (files: Pfade der Unterlagen zum Löschen in SharePoint). */
export function removeApplicant(applicants = [], id) {
  const a = applicants.find((x) => x.id === id)
  return { applicants: applicants.filter((x) => x.id !== id), files: (a?.docs || []).map((d) => d.path).filter(Boolean) }
}

/** Zahlen für die Kacheln der Bewerbungen. */
export function applicantCounts(applicants = [], today, { silentDays = SILENT_DAYS, deleteMonths = DELETE_MONTHS } = {}) {
  return {
    offen: applicants.filter(isOpen).length,
    still: silentApplicants(applicants, today, silentDays).length,
    gespraech: applicants.filter((a) => a.status === 'gespraech' || a.status === 'probe').length,
    zusage: applicants.filter((a) => a.status === 'zusage' && !a.empId).length,
    loeschen: deletionsDue(applicants, today, deleteMonths).length,
  }
}

/** Filter der Bewerbungen: Status ('' = offen, 'alle'), Quelle, Revier, Suche (Name, Telefon, E-Mail, Notiz). */
export function filterApplicants(applicants = [], { status = '', source = '', region = '', q = '' } = {}) {
  const n = String(q || '').trim().toLowerCase()
  return applicants
    .filter((a) => (status === 'alle' ? true : status ? a.status === status : isOpen(a)))
    .filter((a) => (!source || a.source === source) && (!region || a.region === region))
    .filter((a) => !n || [a.name, a.phone, a.email, a.notes, a.sourceNote].some((t) => String(t || '').toLowerCase().includes(n)))
    .sort((a, b) => OPEN_STATUS.indexOf(b.status) - OPEN_STATUS.indexOf(a.status) || (a.name || '').localeCompare(b.name || '', 'de'))
}

// ---------------------------------------------------------------- Checklisten: Vorlagen

/**
 * Aufgaben-Arten mit eigener Anzeige in der Checkliste (ui/views/eintritt.js). frei = nur Titel, Frist, erledigt.
 * linked: kann von selbst als erledigt gelten (linkedOf).
 */
export const TASK_TYPES = {
  oegk: { label: 'Anmeldung ÖGK', kind: 'eintritt' },
  vertrag: { label: 'Dienstvertrag / Dienstzettel', kind: 'eintritt' },
  lohn: { label: 'Daten für die Lohnverrechnung', kind: 'eintritt' },
  unterweisung: { label: 'Unterweisungen', kind: 'eintritt', linked: true },
  arbeitsschutz: { label: 'Betriebsanweisungen', kind: 'eintritt' },
  schluessel: { label: 'Schlüssel ausgeben', kind: 'eintritt', linked: true },
  kleidung: { label: 'Dienstkleidung', kind: 'eintritt' },
  einschulung: { label: 'Einschulung im Objekt', kind: 'eintritt' },
  handy: { label: 'Plan am Handy', kind: 'eintritt' },
  sprache: { label: 'Sprache am Handy', kind: 'eintritt' },
  'schluessel-rueck': { label: 'Schlüssel zurück', kind: 'austritt', linked: true },
  'kleidung-rueck': { label: 'Dienstkleidung, Geräte zurück', kind: 'austritt' },
  'oegk-ab': { label: 'Abmeldung ÖGK', kind: 'austritt' },
  zeitkonto: { label: 'Zeitkonto, Resturlaub, Überstunden', kind: 'austritt' },
  'handy-aus': { label: 'Plan am Handy deaktivieren', kind: 'austritt', linked: true },
  einsaetze: { label: 'Künftige Einsätze', kind: 'austritt', linked: true },
  zeugnis: { label: 'Dienstzeugnis', kind: 'austritt' },
  frei: { label: 'eigene Aufgabe', kind: '' },
}

export const EINTRITT_DEFAULTS = [
  { id: 'e-lohn', type: 'lohn', title: 'Daten für die Lohnverrechnung (Personalnummer, Lohngruppe, Wochenstunden)', offset: -3, note: 'Stammblatt vollständig; Meldung an die Lohnverrechnung' },
  { id: 'e-oegk', type: 'oegk', title: 'Anmeldung bei der ÖGK vor Arbeitsbeginn', offset: -1, note: 'vor dem ersten Arbeitstag (über ELDA bzw. die Lohnverrechnung); die App sendet nichts' },
  { id: 'e-vertrag', type: 'vertrag', title: 'Dienstvertrag bzw. Dienstzettel unterschreiben', offset: 0, note: 'Dienstzettel nach § 2 AVRAG' },
  { id: 'e-kleidung', type: 'kleidung', title: 'Dienstkleidung (Größen)', offset: -2, note: '' },
  { id: 'e-handy', type: 'handy', title: 'Link „Plan am Handy“ erzeugen und senden', offset: -1, note: '' },
  { id: 'e-sprache', type: 'sprache', title: 'Sprache am Handy setzen', offset: -1, note: '' },
  { id: 'e-unterweisung', type: 'unterweisung', title: 'Pflicht-Unterweisungen (Sicherheit, Reinigungsmittel)', offset: 0, note: 'vor der ersten Arbeit, § 14 ASchG' },
  { id: 'e-arbeitsschutz', type: 'arbeitsschutz', title: 'Betriebsanweisungen zu den Arbeitsstoffen besprechen', offset: 0, note: '' },
  { id: 'e-schluessel', type: 'schluessel', title: 'Schlüssel ausgeben (mit Quittung)', offset: 0, note: '' },
  { id: 'e-einschulung', type: 'einschulung', title: 'Einschulung im Objekt', offset: 0, note: 'Objekt, Termin und wer einschult' },
]

export const AUSTRITT_DEFAULTS = [
  { id: 'a-einsaetze', type: 'einsaetze', title: 'Aus künftigen Einsätzen nehmen (Planung entscheidet)', offset: -7, note: '' },
  { id: 'a-zeitkonto', type: 'zeitkonto', title: 'Zeitkonto, Resturlaub und Überstunden prüfen', offset: -7, note: 'nichts wird automatisch ausbezahlt' },
  { id: 'a-schluessel', type: 'schluessel-rueck', title: 'Schlüssel zurück', offset: 0, note: '' },
  { id: 'a-kleidung', type: 'kleidung-rueck', title: 'Dienstkleidung und Geräte zurück', offset: 0, note: '' },
  { id: 'a-handy', type: 'handy-aus', title: 'Link „Plan am Handy“ deaktivieren', offset: 1, note: 'nach dem letzten Arbeitstag' },
  { id: 'a-oegk', type: 'oegk-ab', title: 'Abmeldung bei der ÖGK', offset: 7, note: 'binnen 7 Tagen nach dem Ende (über ELDA bzw. die Lohnverrechnung); die App sendet nichts' },
  { id: 'a-zeugnis', type: 'zeugnis', title: 'Dienstzeugnis ausstellen', offset: 14, note: 'auf Verlangen der Person, § 1163 ABGB' },
]

/** Vorlage einer Art (eintritt/austritt): eigene aus der Datei, sonst die Vorgaben (auch inaktive). */
export const templateOf = (doc, kind) => (doc?.templates?.[kind]?.length ? doc.templates[kind] : kind === 'austritt' ? AUSTRITT_DEFAULTS : EINTRITT_DEFAULTS)

/** Checkliste starten: Aufgaben aus der Vorlage (aktive), Frist = Datum + offset Tage. */
export function startList({ kind, empId, applicantId = '', date, template, newId, at = '', by = '' }) {
  return {
    id: newId(),
    kind: kind === 'austritt' ? 'austritt' : 'eintritt',
    empId,
    applicantId,
    date,
    tasks: template.filter((t) => t.active !== false).map((t) => ({ id: t.id, type: TASK_TYPES[t.type] ? t.type : 'frei', title: t.title, offset: Number(t.offset) || 0, due: addDays(date, Number(t.offset) || 0), note: t.note || '', data: {}, done: null })),
    createdAt: at,
    createdBy: by,
    closedAt: '',
  }
}

/** Datum einer Checkliste ändern (Beginn verschoben): offene Aufgaben bekommen die neue Frist, erledigte bleiben. */
export const moveList = (list, date) => ({ ...list, date, tasks: list.tasks.map((t) => (t.done ? t : { ...t, due: addDays(date, Number(t.offset) || 0) })) })

/** Eigene Aufgabe in einer Checkliste ergänzen. */
export function addTask(list, { title, due, newId }) {
  const offset = daysBetween(list.date, due)
  return { ...list, tasks: [...list.tasks, { id: newId(), type: 'frei', title: String(title || '').trim(), offset, due, note: '', data: {}, done: null }] }
}

export const markDone = (task, { date, by = '', at = '' }) => ({ ...task, done: { date, by, at } })
export const markOpen = (task) => ({ ...task, done: null })

// ---------------------------------------------------------------- Verknüpfungen (Unterweisungen, Schlüssel, Plan)

/**
 * Daten für die Verknüpfungen aus den App-Daten. Was die Rolle nicht lesen darf, bleibt null (dann gilt nichts
 * von selbst als erledigt, z. B. „keine Schlüssel offen“, nur weil das Schlüsselbuch fehlt).
 * can: { trainings, keys, plans, portal } – Leserecht auf die jeweiligen Dateien.
 */
export function linkContext(data, { today, can = {} } = {}) {
  return {
    today,
    employees: data?.employees || [],
    trainings: can.trainings ? data?.unterweisungen || null : null,
    keys: can.keys ? data?.schluessel?.keys || [] : null,
    assignments: can.plans ? data?.assignments || {} : null,
    planTasks: can.plans ? data?.tasks || [] : null,
    portal: can.portal ? data?.rules?.portal || {} : null,
  }
}

/** Pflicht-Unterweisungen einer Person: [{ type, state, until, record }], ok wenn alle gültig eingetragen sind. */
export function trainingCheck(doc, emp, today) {
  if (!doc || !emp) return null
  const required = trainingTypes(doc)
    .filter((t) => isRequired(t, emp))
    .map((type) => ({ type, ...trainingStatus({ type, emp, records: doc.records || [], today }) }))
  const ok = required.length > 0 && required.every((r) => r.state === 'ok' || r.state === 'bald')
  const last = ok ? required.map((r) => r.record).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] : null
  return { required, ok, date: last?.date || '', by: last?.by || '' }
}

/** Schlüssel einer Person mit der letzten Ausgabe an sie (für die Quittung). */
export function keyCheck(keys, empId) {
  if (!keys) return null
  const held = keysOf(keys, empId)
  const issues = held.map((k) => [...(k.history || [])].reverse().find((h) => h.kind === 'ausgabe' && h.to === empId)).filter(Boolean)
  const first = issues.sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null
  return { held, ok: held.length > 0, date: first?.date || '', by: first?.by || '', signed: issues.some((h) => !!h.signature) }
}

/**
 * Einsätze nach dem Austritt (nur geladene Wochen) und Leistungen, in denen die Person Stammkraft ist:
 * { shifts: [{ key, date, taskId }], regular: [Leistung] }.
 */
export function futureWork({ assignments, planTasks, empId, after }) {
  if (!assignments || !planTasks) return null
  const shifts = Object.entries(assignments)
    .filter(([key, list]) => key.slice(0, 10) > after && (list || []).some((a) => a.employeeId === empId))
    .map(([key]) => ({ key, date: key.slice(0, 10), taskId: key.split('|')[1] || '' }))
    .sort((a, b) => a.key.localeCompare(b.key))
  const regular = planTasks.filter((t) => (t.regulars || []).includes(empId))
  return { shifts, regular, ok: !shifts.length && !regular.length }
}

/**
 * Gilt die Aufgabe von selbst als erledigt? { done, date, by, text } (done false: nur Hinweis), null = keine
 * Verknüpfung oder Daten nicht lesbar.
 */
export function linkedOf(task, list, ctx) {
  const emp = ctx.employees.find((e) => e.id === list.empId)
  if (!emp) return null
  if (task.type === 'unterweisung') {
    const r = trainingCheck(ctx.trainings, emp, ctx.today)
    if (!r) return null
    const missing = r.required.filter((x) => !(x.state === 'ok' || x.state === 'bald'))
    return r.ok ? { done: true, date: r.date, by: r.by, text: `${r.required.length} Pflicht-Unterweisungen eingetragen` } : { done: false, text: `fehlt: ${missing.map((x) => x.type.name).join(', ')}` }
  }
  if (task.type === 'schluessel') {
    const r = keyCheck(ctx.keys, emp.id)
    if (!r) return null
    return r.ok ? { done: true, date: r.date, by: r.by, text: `${r.held.length} ${r.held.length === 1 ? 'Schlüssel' : 'Schlüssel'} ausgegeben${r.signed ? ' (mit Unterschrift)' : ''}` } : { done: false, text: 'noch kein Schlüssel ausgegeben' }
  }
  if (task.type === 'schluessel-rueck') {
    const r = keyCheck(ctx.keys, emp.id)
    if (!r) return null
    return r.ok ? { done: false, text: `${r.held.length} ${r.held.length === 1 ? 'Schlüssel' : 'Schlüssel'} noch offen` } : { done: true, date: '', by: '', text: 'keine Schlüssel mehr offen' }
  }
  if (task.type === 'handy-aus') {
    if (!ctx.portal) return null
    return ctx.portal.codes?.[emp.id] ? { done: false, text: 'Link noch gültig' } : { done: true, date: '', by: '', text: 'kein Link mehr' }
  }
  if (task.type === 'einsaetze') {
    const r = futureWork({ assignments: ctx.assignments, planTasks: ctx.planTasks, empId: emp.id, after: list.date })
    if (!r) return null
    return r.ok ? { done: true, date: '', by: '', text: 'keine Einsätze nach dem Austritt (geladene Wochen)' } : { done: false, text: [r.shifts.length ? `${r.shifts.length} ${r.shifts.length === 1 ? 'Einsatz' : 'Einsätze'} nach dem Austritt` : '', r.regular.length ? `Stammkraft in ${r.regular.length} ${r.regular.length === 1 ? 'Leistung' : 'Leistungen'}` : ''].filter(Boolean).join(', ') }
  }
  return null
}

/** Zustand einer Aufgabe: erledigt | ueberfaellig | faellig (heute oder in den nächsten 3 Tagen) | offen. */
export function taskState(task, today, linked = null) {
  if (task.done || linked?.done) return 'erledigt'
  if (task.due && task.due < today) return 'ueberfaellig'
  if (task.due && task.due <= addDays(today, 3)) return 'faellig'
  return 'offen'
}

/** Fortschritt einer Checkliste: { done, total, pct }. */
export function progress(list, ctx = null) {
  const total = list.tasks.length
  const done = list.tasks.filter((t) => t.done || (ctx && linkedOf(t, list, ctx)?.done)).length
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
}

/** Nächste offene Aufgabe (früheste Frist). */
export function nextTask(list, ctx = null) {
  return list.tasks.filter((t) => !t.done && !(ctx && linkedOf(t, list, ctx)?.done)).sort((a, b) => (a.due || '').localeCompare(b.due || ''))[0] || null
}

/**
 * Fristen der Checklisten (für „Zu erledigen“ und den digitalen Mitarbeiter): offene Aufgaben mit Frist bis
 * heute + lead Tage in nicht abgeschlossenen Listen. [{ list, emp, tasks: [{ task, state }], urgent }] mit
 * überfälligen zuerst, dann nach der frühesten Frist.
 */
export function checklistAttention(lists = [], ctx, { lead = 7 } = {}) {
  const until = addDays(ctx.today, lead)
  return lists
    .filter((l) => !l.closedAt)
    .map((list) => {
      const tasks = list.tasks
        .map((task) => ({ task, linked: linkedOf(task, list, ctx) }))
        .filter((x) => !x.task.done && !x.linked?.done && x.task.due && x.task.due <= until)
        .map((x) => ({ task: x.task, state: taskState(x.task, ctx.today, x.linked) }))
        .sort((a, b) => a.task.due.localeCompare(b.task.due))
      return { list, emp: ctx.employees.find((e) => e.id === list.empId) || null, tasks, urgent: tasks.some((t) => t.state === 'ueberfaellig') }
    })
    .filter((g) => g.tasks.length)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.tasks[0].task.due.localeCompare(b.tasks[0].task.due))
}

/** Fehlende Angaben im Stammblatt für die Lohnverrechnung. wage: Lohn lesbar (lohn/zeitkonto.json), sonst nicht prüfen. */
export function payrollGaps(emp, { wage = true } = {}) {
  if (!emp) return []
  const out = []
  if (!emp.personnelNo) out.push('Personalnummer')
  if (!emp.entryDate) out.push('Eintritt')
  if (!(Number(emp.weeklyHours) > 0)) out.push('Wochenstunden')
  if (wage && !emp.wageGroup && !emp.hourlyWage) out.push('Lohngruppe oder Stundenlohn')
  return out
}

/** Text für die Lohnverrechnung (E-Mail, nur nach Klick): Stammdaten ohne Sozialversicherungs- und Bankdaten. */
export function payrollText(emp, { kind = 'eintritt', date, firma = '', absender = '', wage = '' } = {}) {
  const lines = [
    `Name: ${emp.name}`,
    emp.personnelNo ? `Personalnummer: ${emp.personnelNo}` : '',
    kind === 'austritt' ? `Austritt (letzter Arbeitstag): ${date}` : `Eintritt (erster Arbeitstag): ${date}`,
    `Beschäftigung: ${emp.type || ''}, ${String(emp.weeklyHours ?? '').replace('.', ',')} Wochenstunden`,
    emp.maxMonthHours ? `höchstens ${String(emp.maxMonthHours).replace('.', ',')} Stunden im Monat` : '',
    wage,
    emp.team ? `Revier: ${emp.team}` : '',
  ].filter(Boolean)
  const intro = kind === 'austritt' ? 'Austritt zur Abmeldung und Endabrechnung' : 'Neueintritt zur Anmeldung und Lohnverrechnung'
  return `Guten Tag,\n\n${intro}:\n\n${lines.join('\n')}\n\nSozialversicherungsnummer, Adresse und Bankverbindung schicken wir getrennt bzw. bringt die Person selbst mit.\n\nFreundliche Grüße\n${absender}${firma ? `\n${firma}` : ''}`
}
