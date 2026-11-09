// Geräte & Maschinen: die eigenen Reinigungsgeräte der Firma (Scheuersaugmaschinen, Staubsauger, Hochdruckreiniger,
// Einscheibenmaschinen, Leitern, Akkus …) mit Inventarnummer, Standort, Zustand, Prüfungen und Wartung je Prüfart,
// Reparaturen mit Kosten und Ausgabe an ein Objekt oder eine Person mit Verlauf. Nicht die Anlagen beim Kunden
// (core/anlagen.js); die Fristen rechnet dieselbe Funktion (frist aus core/anlagen.js), es gibt keine zweite Fristen-Logik.
// Reine Funktionen ohne Browser (test/geraete.test.js); Ansicht: ui/views/geraete.js, Etikett: export/geraete-pdf.js.
//
// Datei geraete/geraete.json:
//   { types:   [{ id, name, plans: [{ kind, months }], note, active }]     leer = Vorgaben (GERAETE_ARTEN)
//     items:   [{ id, no, name, typeId, maker, model, serial, boughtOn, price, supplierId, supplierName,
//                 home: { kind: 'lager'|'objekt'|'fahrzeug', id, label },   Standort (wo das Gerät hingehört)
//                 responsibleId, responsibleName,                         verantwortliche Person
//                 status: 'betrieb'|'reparatur'|'gesperrt'|'ausgeschieden', statusSince, statusNote,
//                 issued: { kind: 'objekt'|'person', id, label, since, due } | null,   ausgegeben an
//                 plans: [{ id, kind, label, months, firstDue, active }],          Prüfarten mit Intervall
//                 photos: [Datei], docs: [Datei + kind: 'anleitung'|'rechnung'|'sonstiges'],
//                 history: [{ at, date, kind, from, to, by, note }], note, createdAt, createdBy }]
//     checks:  [{ id, itemId, planId, kind, date, by, result: 'ok'|'maengel'|'gesperrt', values, defects, note,
//                 report: Datei|null, at, user }]
//     repairs: [{ id, itemId, date, objectId, text, reportedBy, source: 'app'|'handy', portalId, photos: [Datei],
//                 status: 'gemeldet'|'werkstatt'|'erledigt'|'verworfen', workshop, cost, doneOn,
//                 invoice: { id, no, net } | null, note, log: [{ at, by, status, note }], at, user }]
//     settings: { prefix, warnDays } }
//   Datei = { path, name, type, size, at, by, url?, queued?, local? } in SharePoint unter geraete/dateien/<Jahr>/…
//
// Zustand: „gesperrt“ heißt außer Betrieb (Prüfung mit Ergebnis „gesperrt“ oder beim Melden eines Schadens); eine
// spätere Prüfung „in Ordnung“ gibt das Gerät wieder frei (Häkchen im Dialog). „In Reparatur“ setzt eine Reparatur in
// der Werkstatt, „erledigt“ nimmt es wieder in Betrieb. Gesperrte, reparierte und ausgeschiedene Geräte werden nicht
// ausgegeben. Reparaturkosten zählen nur für die Auswertung je Gerät, nicht für die Buchhaltung (eine Eingangsrechnung
// aus Einkauf & Kasse wird nur verknüpft).
//
// Prüfarten und Intervalle sind Vorschläge ohne Gewähr, keine Rechtsauskunft (docs/RECHTSPRUEFUNG.md): das Intervall
// der Prüfung elektrischer Arbeitsmittel legt der Betrieb nach der Evaluierung fest.

import { addDays, formatDate } from './dates.js'
import { frist, leadDays, WARN_DAYS } from './anlagen.js'

/** Prüfarten: Name, Kurzname, Grundlage als Hinweis. */
export const PRUEFARTEN = {
  elektro: { name: 'Prüfung elektrischer Betriebsmittel', short: 'E-Prüfung', basis: 'ÖVE/ÖNORM E 8701, Intervall nach der Evaluierung (legt der Betrieb fest)' },
  wartung: { name: 'Wartung laut Hersteller', short: 'Wartung', basis: 'Bedienungsanleitung, Herstellerangabe' },
  leiter: { name: 'Sichtprüfung Leiter', short: 'Leiterprüfung', basis: 'ÖNORM EN 131, Herstellerangabe; vor jeder Benützung kurz selbst prüfen' },
  sonstige: { name: 'Sonstige Prüfung', short: 'Prüfung', basis: '' },
}

/** Vorschläge je Art (ohne Gewähr): welche Prüfarten mit welchem Intervall in Monaten. */
export const GERAETE_ARTEN = [
  { id: 'scheuersaug', name: 'Scheuersaugmaschine', plans: [{ kind: 'elektro', months: 12 }, { kind: 'wartung', months: 12 }] },
  { id: 'sauger', name: 'Staub- und Nasssauger', plans: [{ kind: 'elektro', months: 12 }] },
  { id: 'hochdruck', name: 'Hochdruckreiniger', plans: [{ kind: 'elektro', months: 12 }, { kind: 'wartung', months: 12 }] },
  { id: 'einscheibe', name: 'Einscheibenmaschine', plans: [{ kind: 'elektro', months: 12 }, { kind: 'wartung', months: 12 }] },
  { id: 'teppich', name: 'Teppich- und Polsterreiniger', plans: [{ kind: 'elektro', months: 12 }] },
  { id: 'kehr', name: 'Kehrmaschine', plans: [{ kind: 'wartung', months: 12 }] },
  { id: 'leiter', name: 'Leiter oder Tritt', plans: [{ kind: 'leiter', months: 12 }] },
  { id: 'akku', name: 'Akku und Ladegerät', plans: [{ kind: 'elektro', months: 12 }] },
  { id: 'kabel', name: 'Verlängerungskabel, Kabeltrommel', plans: [{ kind: 'elektro', months: 12 }] },
  { id: 'winter', name: 'Schneefräse, Streugerät', plans: [{ kind: 'wartung', months: 12 }] },
  { id: 'sonstige', name: 'Sonstiges Gerät', plans: [] },
]

export const STATUS = { betrieb: 'in Betrieb', reparatur: 'in Reparatur', gesperrt: 'außer Betrieb', ausgeschieden: 'ausgeschieden' }
export const RESULTS = { ok: 'in Ordnung', maengel: 'Mängel', gesperrt: 'gesperrt' }
export const PRUEF_STATES = { ueberfaellig: 'überfällig', faellig: 'fällig', ok: 'in Ordnung', ohne: 'ohne Prüfung', aus: 'ausgeschieden' }
export const REPAIR_STATUS = { gemeldet: 'gemeldet', werkstatt: 'in Reparatur', erledigt: 'erledigt', verworfen: 'kein Schaden' }
export const HOME_KINDS = { lager: 'Lager', objekt: 'Objekt', fahrzeug: 'Fahrzeug' }
export const ISSUE_KINDS = { objekt: 'Objekt', person: 'Person' }
export const DOC_KINDS = { anleitung: 'Bedienungsanleitung', rechnung: 'Rechnung', sonstiges: 'Dokument' }
export const HISTORY_TEXT = { angelegt: 'angelegt', ausgabe: 'ausgegeben', rueckgabe: 'zurückgenommen', standort: 'Standort geändert', status: 'Zustand geändert' }
/** Filter „Zustand“ der Liste ('' = alle außer ausgeschiedenen). */
export const STATUS_FILTERS = { '': 'alle im Bestand', betrieb: 'in Betrieb', reparatur: 'in Reparatur', gesperrt: 'außer Betrieb', ausgeschieden: 'ausgeschieden' }
/** Filter „Prüfung“ der Liste. */
export const DUE_FILTERS = { '': 'alle', bedarf: 'fällig oder überfällig', ueberfaellig: 'überfällig', ok: 'in Ordnung' }
export const PREFIX = 'G-'

export const emptyGeraete = () => ({ types: [], items: [], checks: [], repairs: [], settings: {} })

/** Arten der Datei, ohne eigene die Vorgaben (auch inaktive). */
export const allTypes = (doc) => (doc?.types?.length ? doc.types : GERAETE_ARTEN)
/** Arten zur Auswahl (aktive). */
export const typesOf = (doc) => allTypes(doc).filter((t) => t.active !== false)
export const typeOf = (doc, id) => allTypes(doc).find((t) => t.id === id) || null
export const warnDaysOf = (doc) => (Number(doc?.settings?.warnDays) > 0 ? Number(doc.settings.warnDays) : WARN_DAYS)
export const prefixOf = (doc) => String(doc?.settings?.prefix ?? PREFIX)
/** Name einer Prüfart am Gerät: eigener Text (bei „sonstige“) oder der Name der Prüfart. */
export const planName = (plan) => String(plan?.label || '').trim() || PRUEFARTEN[plan?.kind]?.name || 'Prüfung'
export const planShort = (plan) => String(plan?.label || '').trim() || PRUEFARTEN[plan?.kind]?.short || 'Prüfung'

const text = (v) => String(v ?? '').trim()
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r2 = (n) => Math.round(n * 100) / 100

// ---------------------------------------------------------------- Inventarnummer

/** Inventarnummer zum Vergleichen: groß, ohne Leerzeichen und Striche, Zahl ohne führende Nullen („g 007“ = „G-7“). */
export const normNo = (no) =>
  text(no)
    .toUpperCase()
    .replace(/[\s\-_./]+/g, '')
    .replace(/0*(\d+)$/, '$1')

/** Nächste freie Inventarnummer: höchste Zahl mit diesem Präfix plus 1, vierstellig („G-0001“). */
export function nextNo(items = [], prefix = PREFIX) {
  const p = normNo(prefix).replace(/\d+$/, '')
  let max = 0
  for (const i of items) {
    const m = /^(.*?)(\d+)$/.exec(normNo(i.no))
    if (m && m[1] === p) max = Math.max(max, Number(m[2]))
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/** Inventarnummer prüfen: leer oder schon vergeben → Text, sonst ''. */
export function noProblem(no, items = [], selfId = '') {
  if (!text(no)) return 'Bitte die Inventarnummer eintragen.'
  const other = items.find((i) => i.id !== selfId && normNo(i.no) === normNo(no))
  return other ? `Die Inventarnummer ${text(other.no)} hat schon „${text(other.name)}“.` : ''
}

/** Gerät zu einem Text vom Handy („G-0007 Sauger kaputt“): eindeutige Inventarnummer im Text, sonst null. */
export function matchDevice(textIn, items = []) {
  const found = new Set()
  for (const [tok] of String(textIn || '').matchAll(/[A-Za-zÄÖÜäöü]{0,4}[\s\-]?\d{1,6}/g)) {
    const n = normNo(tok)
    for (const i of items) if (i.status !== 'ausgeschieden' && normNo(i.no) === n) found.add(i)
  }
  return found.size === 1 ? [...found][0] : null
}

// ---------------------------------------------------------------- Prüfarten und Fristen

/** Prüfarten für ein neues Gerät aus der Vorlage der Art. */
export const plansFromType = (type, newId) => (type?.plans || []).map((p) => ({ id: newId(), kind: p.kind, label: '', months: num(p.months), firstDue: '', active: true }))

/** Prüfungen eines Geräts (oder einer Prüfart), neueste zuerst. */
export function checksOf(checks = [], itemId, planId = null) {
  return checks.filter((c) => c.itemId === itemId && (!planId || c.planId === planId)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))
}

/**
 * Fristen je aktiver Prüfart: [{ plan, months, last, next, state, unknown?, noInterval? }], gerechnet wie bei den
 * Anlagen (frist): nächste = letzte Prüfung dieser Prüfart + Intervall; ohne Prüfung „fällig am“ der Prüfart,
 * sonst gleich fällig.
 */
export function duesOf({ item, checks = [], today, warnDays = WARN_DAYS }) {
  return (item.plans || [])
    .filter((p) => p.active !== false)
    .map((plan) => {
      const last = checksOf(checks, item.id, plan.id)[0] || null
      return { plan, months: num(plan.months), last, ...frist({ last: last?.date, months: plan.months, firstDue: plan.firstDue, today, warnDays }) }
    })
}

const ORDER = { ueberfaellig: 0, faellig: 1, ok: 2, ohne: 3, aus: 4 }

/** Wo das Gerät gerade ist: ausgegeben (Objekt oder Person), sonst sein Standort. */
export const locationOf = (item) => (item.issued ? { ...item.issued, issued: true } : item.home?.kind ? { ...item.home, issued: false } : { kind: 'lager', id: '', label: 'Lager', issued: false })
/** Schlüssel eines Orts für Filter und Gruppen: „objekt:o5“, „lager:Hauptlager“, „person:e3“. */
export const locKey = (loc) => `${loc?.kind || 'lager'}:${loc?.id || text(loc?.label)}`

/**
 * Zeile je Gerät: { item, type, status, state, next, dues, last, location, openRepairs }.
 * state: dringendste Frist (ueberfaellig | faellig | ok), ohne aktive Prüfart „ohne“, ausgeschieden „aus“.
 */
export function rowOf({ item, doc, today, warnDays = warnDaysOf(doc) }) {
  const checks = doc?.checks || []
  const status = STATUS[item.status] ? item.status : 'betrieb'
  const last = checksOf(checks, item.id)[0] || null
  const openRepairs = (doc?.repairs || []).filter((r) => r.itemId === item.id && isOpenRepair(r))
  const base = { item, type: typeOf(doc, item.typeId), status, last, location: locationOf(item), openRepairs }
  if (status === 'ausgeschieden') return { ...base, state: 'aus', next: '', dues: [] }
  const dues = duesOf({ item, checks, today, warnDays })
  if (!dues.length) return { ...base, state: 'ohne', next: '', dues }
  const worst = dues.reduce((w, d) => (ORDER[d.state] < ORDER[w.state] ? d : w), dues[0])
  return { ...base, state: worst.state, next: dues.map((d) => d.next).filter(Boolean).sort()[0] || '', dues }
}

/** Alle Geräte mit Zustand, sortiert: Inventarnummer (Zahl beachtet). */
export function geraeteRows({ doc, today, warnDays = warnDaysOf(doc) }) {
  return (doc?.items || []).map((item) => rowOf({ item, doc, today, warnDays })).sort((a, b) => text(a.item.no).localeCompare(text(b.item.no), 'de', { numeric: true }) || text(a.item.name).localeCompare(text(b.item.name), 'de'))
}

/**
 * Filter der Liste: Art, Standort (Art des Orts „objekt“ oder genau „objekt:o5“; „ausgegeben“ = an Objekt oder Person
 * ausgegeben), Zustand (STATUS_FILTERS; leer = alle außer ausgeschiedenen), Prüfung (DUE_FILTERS), Suche.
 */
export function filterRows(rows, { typeId = '', location = '', status = '', due = '', q = '' } = {}) {
  const words = text(q).toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((r) => {
    if (typeId && r.item.typeId !== typeId) return false
    if (location) {
      const k = locKey(r.location)
      if (location === 'ausgegeben' ? !r.location.issued : location.includes(':') ? k !== location : r.location.kind !== location) return false
    }
    if (status ? r.status !== status : r.status === 'ausgeschieden') return false
    if (due === 'bedarf' && r.state !== 'ueberfaellig' && r.state !== 'faellig') return false
    if (due && due !== 'bedarf' && r.state !== due) return false
    if (words.length) {
      const hay = [r.item.no, r.item.name, r.type?.name, r.item.maker, r.item.model, r.item.serial, r.location.label, r.item.responsibleName].map((x) => text(x).toLowerCase()).join(' ')
      if (!words.every((w) => hay.includes(w))) return false
    }
    return true
  })
}

/** Zahlen für die Kacheln: Prüfung überfällig, bald fällig, außer Betrieb, in Reparatur, Geräte im Bestand. */
export function counts(rows) {
  const active = rows.filter((r) => r.status !== 'ausgeschieden')
  return {
    ueberfaellig: active.filter((r) => r.state === 'ueberfaellig').length,
    faellig: active.filter((r) => r.state === 'faellig').length,
    gesperrt: active.filter((r) => r.status === 'gesperrt').length,
    reparatur: active.filter((r) => r.status === 'reparatur').length,
    bestand: active.length,
  }
}

/**
 * Handlungsbedarf je Gerät (für „Zu erledigen“ und den digitalen Mitarbeiter „Fristen“): Prüfung fällig oder
 * überfällig, Gerät gesperrt (außer Betrieb), neu gemeldeter Schaden. Ausgeschiedene nicht.
 * [{ id, row, due: [Frist], blocked, reports: [Reparatur] }], dringend zuerst (überfällig oder gesperrt).
 * Meldungen vom Handy ohne erkanntes Gerät kommen als eigener Eintrag ohne Zeile (row: null).
 */
export function attention(rows, repairs = []) {
  const out = []
  for (const row of rows) {
    if (row.status === 'ausgeschieden') continue
    const due = row.dues.filter((d) => d.state === 'ueberfaellig' || d.state === 'faellig')
    const blocked = row.status === 'gesperrt'
    const reports = row.openRepairs.filter((r) => r.status === 'gemeldet')
    if (due.length || blocked || reports.length) out.push({ id: row.item.id, row, due, blocked, reports })
  }
  const loose = repairs.filter((r) => !r.itemId && r.status === 'gemeldet')
  if (loose.length) out.push({ id: '', row: null, due: [], blocked: false, reports: loose })
  const no = (g) => (g.row ? text(g.row.item.no) : '\uffff')
  return out.sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || no(a).localeCompare(no(b), 'de', { numeric: true }))
}
/** Dringend: Prüfung überfällig oder Gerät außer Betrieb. */
export const isUrgent = (g) => g.blocked || g.due.some((d) => d.state === 'ueberfaellig')

// ---------------------------------------------------------------- Gerät anlegen und Zustand

const entry = (kind, { at = '', date = '', by = '', note = '', from = '', to = '' }) => Object.fromEntries(Object.entries({ at, date, kind, from, to, by, note: text(note) }).filter(([, v]) => v !== ''))

/** Gerät prüfen, bevor es gespeichert wird: Text des ersten Problems oder ''. */
export function itemProblem(fields, items = []) {
  const p = noProblem(fields.no, items, fields.id)
  if (p) return p
  if (!text(fields.name)) return 'Bitte die Bezeichnung eintragen, z. B. Scheuersaugmaschine 1.'
  if (!fields.typeId) return 'Bitte die Art wählen.'
  if (fields.home?.kind === 'objekt' && !fields.home.id) return 'Bitte das Objekt des Standorts wählen.'
  if (fields.home?.kind && fields.home.kind !== 'objekt' && !text(fields.home.label) && !fields.home.id) return `Bitte ${fields.home.kind === 'fahrzeug' ? 'das Fahrzeug' : 'das Lager'} eintragen.`
  if (fields.price !== '' && fields.price !== undefined && !(num(fields.price) >= 0)) return 'Der Kaufpreis darf nicht negativ sein.'
  for (const p of fields.plans || []) if (p.active !== false && !(num(p.months) > 0)) return `Bitte das Intervall für „${planName(p)}“ in Monaten eintragen.`
  return ''
}

/** Zustand ändern (mit Eintrag im Verlauf); gleicher Zustand: unverändert. Ausgeschieden beendet eine Ausgabe. */
export function withStatus(item, status, { date, by = '', note = '', at = '' }) {
  const from = STATUS[item.status] ? item.status : 'betrieb'
  if (!STATUS[status] || status === from) return item
  const history = [...(item.history || [])]
  let issued = item.issued || null
  if (status === 'ausgeschieden' && issued) {
    history.push(entry('rueckgabe', { at, date, by, from: issued.label, note: 'Gerät ausgeschieden' }))
    issued = null
  }
  history.push(entry('status', { at, date, by, from, to: status, note }))
  return { ...item, status, statusSince: date, statusNote: text(note), issued, history }
}

/** Standort ändern (mit Eintrag im Verlauf, wenn er sich wirklich ändert). */
export function withHome(item, home, { date, by = '', note = '', at = '' }) {
  if (locKey(item.home) === locKey(home) && text(item.home?.label) === text(home?.label)) return { ...item, home }
  return { ...item, home, history: [...(item.history || []), entry('standort', { at, date, by, from: text(item.home?.label), to: text(home?.label), note })] }
}

// ---------------------------------------------------------------- Ausgabe und Rückgabe

/** Darf das Gerät ausgegeben werden? Text des Problems oder ''. */
export function issueProblem(item, { to, date } = {}) {
  if (item.status === 'ausgeschieden') return 'Das Gerät ist ausgeschieden.'
  if (item.status === 'gesperrt') return 'Das Gerät ist außer Betrieb (gesperrt) und darf nicht ausgegeben werden.'
  if (item.status === 'reparatur') return 'Das Gerät ist in Reparatur.'
  if (!to?.kind || !ISSUE_KINDS[to.kind] || !to.id) return to?.kind === 'person' ? 'Bitte die Person wählen.' : 'Bitte das Objekt wählen.'
  if (!date) return 'Bitte das Datum eintragen.'
  if (item.issued && item.issued.kind === to.kind && item.issued.id === to.id) return `Das Gerät ist schon bei ${text(item.issued.label)}.`
  return ''
}

/** Ausgabe an ein Objekt oder eine Person (auch Weitergabe von dort weiter): Gerät mit issued und Verlauf. */
export function issue(item, { to, date, due = '', by = '', note = '', at = '' }) {
  const problem = issueProblem(item, { to, date })
  if (problem) throw new Error(problem)
  const issued = { kind: to.kind, id: to.id, label: text(to.label), since: date, ...(due ? { due } : {}) }
  return { ...item, issued, history: [...(item.history || []), entry('ausgabe', { at, date, by, from: text(item.issued?.label || item.home?.label), to: issued.label, note })] }
}

/** Rücknahme an den Standort. */
export function takeBack(item, { date, by = '', note = '', at = '' }) {
  if (!item.issued) return item
  return { ...item, issued: null, history: [...(item.history || []), entry('rueckgabe', { at, date, by, from: text(item.issued.label), to: text(item.home?.label), note })] }
}

/** Verlauf der Ausgaben und Rücknahmen, neueste zuerst. */
export const issueHistory = (item) =>
  (item.history || [])
    .filter((h) => h.kind === 'ausgabe' || h.kind === 'rueckgabe')
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))

/** Ausgaben mit vereinbarter Rückgabe, die vorbei ist. */
export const issueOverdue = (item, today) => !!item.issued?.due && item.issued.due < today

// ---------------------------------------------------------------- Prüfung erfassen

/** Prüfung prüfen, bevor sie eingetragen wird: Text des ersten Problems oder ''. */
export function checkProblem(input, today, item = null) {
  if (!input.itemId) return 'Bitte das Gerät wählen.'
  if (!input.planId) return 'Bitte die Prüfart wählen.'
  if (item && !(item.plans || []).some((p) => p.id === input.planId)) return 'Diese Prüfart gibt es am Gerät nicht.'
  if (!input.date) return 'Bitte das Datum der Prüfung eintragen.'
  if (input.date > today) return 'Das Datum liegt in der Zukunft.'
  if (!RESULTS[input.result]) return 'Bitte das Ergebnis wählen.'
  if (input.result !== 'ok' && !text(input.defects)) return input.result === 'gesperrt' ? 'Bitte kurz eintragen, warum das Gerät gesperrt ist.' : 'Bitte die Mängel beschreiben.'
  if (!text(input.by)) return 'Bitte eintragen, wer geprüft hat.'
  return ''
}

/**
 * Prüfung eintragen: { checks, item, check, change } mit der neuen Prüfung am Ende. Ergebnis „gesperrt“ setzt das Gerät
 * auf außer Betrieb; „in Ordnung“ mit release gibt ein gesperrtes Gerät wieder frei. change: 'gesperrt' | 'frei' | ''.
 */
export function addCheck({ checks = [], item, input, newId, at = '', user = '', release = false }) {
  const plan = (item.plans || []).find((p) => p.id === input.planId)
  const check = {
    id: newId(),
    itemId: item.id,
    planId: input.planId,
    kind: plan?.kind || 'sonstige',
    date: input.date,
    by: text(input.by),
    result: input.result,
    values: text(input.values),
    defects: input.result === 'ok' ? '' : text(input.defects),
    note: text(input.note),
    report: input.report || null,
    at,
    user,
  }
  let next = item
  let change = ''
  const what = `${planShort(plan)} am ${formatDate(input.date, { weekday: false, year: true })}`
  if (check.result === 'gesperrt' && item.status !== 'gesperrt' && item.status !== 'ausgeschieden') {
    next = withStatus(item, 'gesperrt', { date: input.date, by: user, at, note: `${what}: ${check.defects}` })
    change = 'gesperrt'
  } else if (check.result === 'ok' && release && item.status === 'gesperrt') {
    next = withStatus(item, 'betrieb', { date: input.date, by: user, at, note: `${what} in Ordnung` })
    change = 'frei'
  }
  return { checks: [...checks, check], item: next, check, change }
}

/** Nächste Fälligkeit einer Prüfart nach einer Prüfung an diesem Tag ('' ohne Intervall). */
export const nextAfter = (plan, date) => (date && num(plan?.months) > 0 ? frist({ last: date, months: plan.months, today: date }).next : '')

// ---------------------------------------------------------------- Reparaturen

export const isOpenRepair = (r) => r.status === 'gemeldet' || r.status === 'werkstatt'
/** Kosten einer Reparatur (ohne „kein Schaden“). */
export const repairCost = (r) => (r.status === 'verworfen' ? 0 : r2(Math.max(0, num(r.cost))))
/** Monat, in dem die Kosten zählen: erledigt am, sonst gemeldet am. */
export const costDate = (r) => r.doneOn || r.date || ''

/** Reparatur prüfen: Text des ersten Problems oder ''. */
export function repairProblem(input, today) {
  if (!input.itemId) return 'Bitte das Gerät wählen.'
  if (!text(input.text)) return 'Bitte beschreiben, was kaputt ist.'
  if (!input.date) return 'Bitte das Datum eintragen.'
  if (input.date > today) return 'Das Datum liegt in der Zukunft.'
  if (!REPAIR_STATUS[input.status || 'gemeldet']) return 'Bitte den Stand wählen.'
  if (input.status === 'erledigt' && !input.doneOn) return 'Bitte eintragen, wann die Reparatur erledigt war.'
  if (input.doneOn && input.doneOn < input.date) return 'Erledigt liegt vor der Meldung.'
  if (input.cost !== '' && input.cost !== undefined && !(num(input.cost) >= 0)) return 'Die Kosten dürfen nicht negativ sein.'
  return ''
}

/**
 * Reparatur anlegen oder ändern: { repairs, repair, item }. Stand „in Reparatur“ setzt das Gerät auf „in Reparatur“
 * (ein gesperrtes bleibt gesperrt), „erledigt“ oder „kein Schaden“ nimmt es wieder in Betrieb, wenn keine andere
 * Reparatur in der Werkstatt ist (ein gesperrtes bleibt gesperrt, bis eine Prüfung es freigibt). block: beim Melden
 * gleich außer Betrieb setzen. Jeder Wechsel des Stands steht im Protokoll der Reparatur.
 */
export function saveRepair({ repairs = [], item, input, newId, at = '', user = '', block = false }) {
  const old = input.id ? repairs.find((r) => r.id === input.id) : null
  const status = REPAIR_STATUS[input.status] ? input.status : 'gemeldet'
  const repair = {
    ...(old || { id: newId(), source: input.source || 'app', reportedBy: text(input.reportedBy) || user, photos: [], log: [], at, user }),
    itemId: item.id,
    date: input.date,
    objectId: input.objectId || '',
    text: text(input.text),
    status,
    workshop: text(input.workshop),
    cost: input.cost === '' || input.cost === undefined ? '' : r2(num(input.cost)),
    doneOn: status === 'erledigt' ? input.doneOn || '' : '',
    invoice: input.invoice || null,
    note: text(input.note),
    photos: input.photos || old?.photos || [],
  }
  if (!old || old.status !== status || old.itemId !== item.id) repair.log = [...(old?.log || []), { at, by: user, status }]
  const list = old ? repairs.map((r) => (r.id === old.id ? repair : r)) : [...repairs, repair]
  const date = status === 'erledigt' ? repair.doneOn : input.date
  let next = item
  if (block && !old) next = withStatus(next, 'gesperrt', { date, by: user, at, note: `Schaden: ${repair.text}` })
  if (status === 'werkstatt' && next.status === 'betrieb') next = withStatus(next, 'reparatur', { date, by: user, at, note: repair.workshop ? `Werkstatt: ${repair.workshop}` : repair.text })
  const busy = list.some((r) => r.itemId === item.id && r.status === 'werkstatt')
  if ((status === 'erledigt' || status === 'verworfen') && next.status === 'reparatur' && !busy) next = withStatus(next, 'betrieb', { date, by: user, at, note: status === 'erledigt' ? 'Reparatur erledigt' : 'kein Schaden' })
  return { repairs: list, repair, item: next }
}

/** Reparaturkosten je Gerät im Zeitraum (from–to, Monat laut costDate): Map itemId → { cost, count }. */
export function repairCosts(repairs = [], { from = '', to = '9999' } = {}) {
  const out = new Map()
  for (const r of repairs) {
    const d = costDate(r)
    if (!r.itemId || r.status === 'verworfen' || d < from || d > to) continue
    const x = out.get(r.itemId) || { cost: 0, count: 0 }
    x.cost = r2(x.cost + repairCost(r))
    x.count++
    out.set(r.itemId, x)
  }
  return out
}

/** Reparaturkosten je Monat: months = [{ key, from, to }] (wie kpi.lastMonths) → [{ key, cost, count }]. */
export const repairMonths = (repairs = [], months = []) =>
  months.map((m) => {
    const list = repairs.filter((r) => r.status !== 'verworfen' && costDate(r) >= m.from && costDate(r) <= m.to && repairCost(r) > 0)
    return { key: m.key, cost: r2(list.reduce((s, r) => s + repairCost(r), 0)), count: list.length }
  })

/** Reparatur aus „Mein Dienstplan“ (Meldung „Gerät kaputt?“): Gerät über die Inventarnummer im Text, sonst offen. */
export function repairFromPortal(a, { items = [], newId, at = '' }) {
  const what = text(a.geraet)
  const item = matchDevice(`${what} ${text(a.notiz)}`, items)
  return {
    id: newId(),
    itemId: item?.id || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(a.von || '') ? a.von : at.slice(0, 10),
    objectId: text(a.objekt),
    text: [what && !item ? `Gerät: ${what}` : '', text(a.notiz)].filter(Boolean).join('. '),
    reportedBy: text(a.name),
    source: 'handy',
    portalId: a.id,
    photos: [],
    status: 'gemeldet',
    workshop: '',
    cost: '',
    doneOn: '',
    invoice: null,
    note: '',
    log: [{ at, by: text(a.name), status: 'gemeldet' }],
    at,
    user: text(a.name),
  }
}

// ---------------------------------------------------------------- Verlauf, Kennzahlen

/**
 * Verlauf eines Geräts: Prüfungen, Reparaturen, Ausgaben, Zustand und Standort, neueste zuerst.
 * [{ date, at, kind: 'pruefung'|'reparatur'|Verlauf-Art, entry }]
 */
export function timeline(doc, itemId) {
  const item = (doc?.items || []).find((i) => i.id === itemId)
  const out = [
    ...(item?.history || []).map((h) => ({ date: h.date || (h.at || '').slice(0, 10), at: h.at || '', kind: h.kind, entry: h })),
    ...(doc?.checks || []).filter((c) => c.itemId === itemId).map((c) => ({ date: c.date, at: c.at || '', kind: 'pruefung', entry: c })),
    ...(doc?.repairs || []).filter((r) => r.itemId === itemId).map((r) => ({ date: r.date, at: r.at || '', kind: 'reparatur', entry: r })),
  ]
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))
}

/**
 * Kennzahlen: Geräte nach Zustand, Geräte mit überfälliger Prüfung (und Zahl der überfälligen Prüfarten),
 * Reparaturkosten je Monat (months wie kpi.lastMonths). null, wenn es keine Geräte gibt.
 */
export function geraeteKpi({ doc, months = [], today }) {
  const rows = geraeteRows({ doc, today })
  if (!rows.length) return null
  const byStatus = Object.fromEntries(Object.keys(STATUS).map((s) => [s, rows.filter((r) => r.status === s).length]))
  const live = rows.filter((r) => r.status !== 'ausgeschieden')
  return {
    byStatus,
    overdue: live.filter((r) => r.state === 'ueberfaellig').length,
    overduePlans: live.reduce((s, r) => s + r.dues.filter((d) => d.state === 'ueberfaellig').length, 0),
    due: live.filter((r) => r.state === 'faellig').length,
    repairs: repairMonths(doc?.repairs || [], months),
  }
}

// ---------------------------------------------------------------- Etikett

/** Adresse auf dem QR-Etikett: öffnet die Gerätekarte in der App (#geraete/G-0001). */
export const labelUrl = (base, no) => `${String(base || '').replace(/#.*$/, '')}#geraete/${encodeURIComponent(text(no))}`
/** Gerät zum Teil hinter # („geraete/g-0001“, klein geschrieben) oder null. */
export function itemFromKey(key, items = []) {
  const m = /^geraete\/(.+)$/.exec(String(key || ''))
  if (!m) return null
  const n = normNo(m[1])
  return items.find((i) => normNo(i.no) === n) || null
}

/** Vorlauf in Tagen für „fällig“ je Intervall (wie bei den Anlagen). */
export { leadDays }
/** Tag, ab dem eine Frist als fällig gilt. */
export const dueFrom = (next, months, warnDays = WARN_DAYS) => (next ? addDays(next, -leadDays(num(months), warnDays)) : '')
