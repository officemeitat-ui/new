// Anlagen & Prüffristen je Objekt: Feuerlöscher, Rauchwarnmelder, Notbeleuchtung, Spielplatz, Lift …
// mit Intervall, Prüfungen (Ergebnis, Mängel, Fotos, Prüfbericht), nächster Fälligkeit und offenen Mängeln.
// Reine Funktionen ohne Browser (test/anlagen.test.js); Ansicht: ui/views/anlagen.js, PDF: export/anlagen-pdf.js.
//
// Datei anlagen/anlagen.json:
//   { types:  [{ id, name, months, operativeMonths, basis, note, by, active }]      leer = Vorgaben (ANLAGEN_DEFAULTS)
//     items:  [{ id, objectId, typeId, label, count, maker, serial, months, operative, operativeMonths, firstDue,
//               by: 'eigen'|'fremd', company, contact, billable, price, note, active, createdAt, createdBy }]
//     checks: [{ id, itemId, kind: 'haupt'|'operativ', date, result: 'ok'|'maengel'|'ausser', defects, by, external, note,
//               photos: [Datei], report: Datei|null, billable, price, resolved: { date, note, by, at }|null, at, user }]
//     settings: { warnDays } }
//   months an der Anlage: leer = Intervall der Art; firstDue: nächste Prüfung, solange keine eingetragen ist
//   (z. B. von der Plakette). by an der Prüfung: wer geprüft hat (Person oder Firma), external: Fremdfirma (nur dann
//   steht der Name im PDF für den Kunden). Datei = { path, name, type, size, at, by, url?, queued?, local? }: Fotos und
//   Prüfbericht liegen in SharePoint unter anlagen/nachweise/<Jahr>/…
//
// Fristen: nächste Prüfung = Datum der letzten Prüfung + Intervall in Monaten (Monatsende beachtet: 31.1. + 1 Monat =
// 28./29.2.). Ohne Prüfung gilt firstDue, sonst ist die Anlage sofort fällig („noch keine Prüfung“). Die operative
// Inspektion (z. B. Spielplatz monatlich) hat eine eigene Frist ab der letzten Prüfung jeder Art. „Fällig“ heißt:
// höchstens warnDays (30) Tage vorher, bei kurzen Intervallen ein Viertel des Intervalls (monatlich: 7 Tage).
// Ein Mangel (Ergebnis „Mängel“ oder „außer Betrieb“) bleibt offen, bis er als behoben vermerkt ist.
//
// Intervalle und Grundlagen der Arten sind Vorschläge, keine Rechtsauskunft (docs/RECHTSPRUEFUNG.md, offener Punkt).

import { addDays } from './dates.js'
import { addMonths } from './trainings.js'

export { addMonths }

/** Vorschläge je Art: Intervall in Monaten (0 = je Anlage eintragen), Grundlage als Hinweis, wer üblicherweise prüft. */
export const ANLAGEN_DEFAULTS = [
  { id: 'feuerloescher', name: 'Feuerlöscher', months: 24, basis: 'ÖNORM F 1053', note: 'Überprüfung durch befähigte Person bzw. Fachfirma, Plakette am Gerät', by: 'fremd' },
  { id: 'rauchmelder', name: 'Rauchwarnmelder', months: 12, basis: 'Herstellerangabe', note: 'Prüfknopf, Batterie, Verschmutzung, freie Raucheintrittsöffnungen', by: 'eigen' },
  { id: 'notbeleuchtung', name: 'Sicherheits- / Notbeleuchtung', months: 12, basis: 'TRVB / ÖVE E 8002 (prüfen)', note: 'Funktionsprüfung, Betriebsdauer, Eintrag ins Prüfbuch', by: 'fremd' },
  { id: 'brandschutztuer', name: 'Brandschutztüren / Feststellanlagen', months: 12, basis: 'Herstellerangabe (prüfen)', note: 'Selbstschließung, Feststellanlage, Dichtungen, nichts verkeilt', by: 'fremd' },
  { id: 'spielplatz', name: 'Spielplatz', months: 12, operativeMonths: 1, basis: 'ÖNORM EN 1176 / ÖNORM B 2607', note: 'Hauptinspektion jährlich; dazu operative Inspektion (z. B. monatlich)', by: 'fremd' },
  { id: 'lift', name: 'Aufzug (Lift)', months: 12, basis: 'Aufzugsgesetz des Landes (prüfen)', note: 'wiederkehrende Überprüfung durch die Prüfstelle; Wartung durch die Liftfirma', by: 'fremd' },
  { id: 'blitzschutz', name: 'Blitzschutz', months: 36, basis: 'ÖVE/ÖNORM EN 62305 (prüfen)', note: 'Intervall je nach Schutzklasse', by: 'fremd' },
  { id: 'dach', name: 'Dachrinnen / Dach', months: 12, basis: 'Sichtkontrolle (betrieblich)', note: 'Rinnen und Abläufe frei, lose Teile; nach Sturm zusätzlich', by: 'eigen' },
  { id: 'rueckstau', name: 'Rückstauklappe', months: 6, basis: 'Herstellerangabe (prüfen)', note: 'Funktion prüfen, reinigen', by: 'eigen' },
  { id: 'fettabscheider', name: 'Fettabscheider', months: 0, basis: 'Herstellerangabe', note: 'Entleerung und Wartung laut Hersteller: Intervall je Anlage eintragen', by: 'fremd' },
  { id: 'sonstige', name: 'Sonstige', months: 12, basis: '', note: 'Intervall je Anlage festlegen', by: 'eigen' },
]

export const RESULTS = { ok: 'in Ordnung', maengel: 'Mängel', ausser: 'außer Betrieb' }
export const STATES = { ueberfaellig: 'überfällig', faellig: 'fällig', ok: 'in Ordnung', inaktiv: 'inaktiv' }
export const BY = { eigen: 'eigene Leute', fremd: 'Fremdfirma' }
export const CHECK_KINDS = { haupt: 'Prüfung', operativ: 'operative Inspektion' }
/** Filter „Status“ der Übersicht. */
export const STATUS_FILTERS = { '': 'alle aktiven', bedarf: 'mit Handlungsbedarf', ueberfaellig: 'überfällig', faellig: 'fällig (bald)', maengel: 'Mängel offen', ok: 'in Ordnung', inaktiv: 'inaktiv' }
export const WARN_DAYS = 30

export const emptyAnlagen = () => ({ types: [], items: [], checks: [], settings: {} })

/** Arten der Datei, ohne eigene die Vorgaben (auch inaktive). */
export const allTypes = (doc) => (doc?.types?.length ? doc.types : ANLAGEN_DEFAULTS)
/** Arten zur Auswahl (aktive). */
export const typesOf = (doc) => allTypes(doc).filter((t) => t.active !== false)
export const typeOf = (doc, id) => allTypes(doc).find((t) => t.id === id) || null
export const warnDaysOf = (doc) => (Number(doc?.settings?.warnDays) > 0 ? Number(doc.settings.warnDays) : WARN_DAYS)

const positive = (v) => (Number(v) > 0 ? Number(v) : 0)
/** Intervall der Prüfung in Monaten: an der Anlage eingetragen, sonst der Vorschlag der Art (0 = keines). */
export const intervalOf = (item, type) => positive(item?.months) || positive(type?.months)
/** Intervall der operativen Inspektion (0 = keine): an der Anlage, sonst der Art, sonst monatlich. */
export const operativeOf = (item, type) => (item?.operative ? positive(item.operativeMonths) || positive(type?.operativeMonths) || 1 : 0)
/** Vorlauf für „fällig“: höchstens warnDays, bei kurzen Intervallen ein Viertel davon (monatlich 7 Tage). */
export const leadDays = (months, warnDays = WARN_DAYS) => (months > 0 ? Math.min(warnDays, Math.max(3, Math.floor(months * 7.5))) : warnDays)

/** Prüfungen einer Anlage, neueste zuerst (gleiches Datum: zuletzt eingetragene zuerst). */
export function checksOf(checks = [], itemId) {
  return checks.filter((c) => c.itemId === itemId).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))
}

/** Mangel offen: Ergebnis „Mängel“ oder „außer Betrieb“ und noch nicht als behoben vermerkt. */
export const isDefectOpen = (c) => !!c && (c.result === 'maengel' || c.result === 'ausser') && !c.resolved
/** Offene Mängel (einer Anlage), älteste zuerst. */
export const openDefects = (checks = [], itemId = null) => checks.filter((c) => isDefectOpen(c) && (!itemId || c.itemId === itemId)).sort((a, b) => (a.date || '').localeCompare(b.date || ''))

function dueState(next, today, lead) {
  if (!next) return { next: '', state: 'faellig', unknown: true }
  if (next < today) return { next, state: 'ueberfaellig' }
  if (next <= addDays(today, lead)) return { next, state: 'faellig' }
  return { next, state: 'ok' }
}

/**
 * Fristen einer Anlage: [{ kind: 'haupt'|'operativ', months, last, next, state, unknown?, noInterval? }].
 * haupt: ab der letzten Prüfung (operative zählen nicht); operativ: ab der letzten Prüfung jeder Art.
 * Ohne Prüfung: firstDue, sonst unbekannt (= fällig). Ohne Intervall nach einer Prüfung: unbekannt (noInterval).
 */
export function duesOf({ item, type, checks = [], today, warnDays = WARN_DAYS }) {
  const list = checksOf(checks, item.id)
  const months = intervalOf(item, type)
  const main = list.find((c) => c.kind !== 'operativ') || null
  const nextMain = main ? (months ? addMonths(main.date, months) : '') : item.firstDue || ''
  const out = [{ kind: 'haupt', months, last: main, ...dueState(nextMain, today, leadDays(months, warnDays)), ...(months ? {} : { noInterval: true }) }]
  const op = operativeOf(item, type)
  if (op) {
    const any = list[0] || null
    out.push({ kind: 'operativ', months: op, last: any, ...dueState(any ? addMonths(any.date, op) : item.firstDue || '', today, leadDays(op, warnDays)) })
  }
  return out
}

const ORDER = { ueberfaellig: 0, faellig: 1, ok: 2, inaktiv: 3 }

/**
 * Zustand einer Anlage: { state: ueberfaellig | faellig | ok | inaktiv, next, dues, defects, last, unknown }.
 * state = dringendste Frist; next = früheste bekannte nächste Prüfung; defects = offene Mängel (auch bei inaktiven).
 */
export function statusOf({ item, type, checks = [], today, warnDays = WARN_DAYS }) {
  const defects = openDefects(checks, item.id)
  const last = checksOf(checks, item.id)[0] || null
  if (item.active === false) return { state: 'inaktiv', next: '', dues: [], defects, last, unknown: false }
  const dues = duesOf({ item, type, checks, today, warnDays })
  const worst = dues.reduce((w, d) => (ORDER[d.state] < ORDER[w.state] ? d : w), dues[0])
  const next = dues.map((d) => d.next).filter(Boolean).sort()[0] || ''
  return { state: worst.state, next, dues, defects, last, unknown: dues.some((d) => d.unknown) }
}

/** Nächste Prüfung nach einer Prüfung an diesem Tag (operativ: Intervall der operativen Inspektion). */
export function nextAfter(item, type, date, kind = 'haupt') {
  const months = kind === 'operativ' ? operativeOf(item, type) : intervalOf(item, type)
  return date && months ? addMonths(date, months) : ''
}

/**
 * Alle Anlagen mit Zustand: [{ item, type, object, state, next, dues, defects, last, unknown }],
 * sortiert nach Objekt, dann dringend zuerst, dann nächste Prüfung, dann Art und Bezeichnung.
 */
export function anlagenRows({ doc, objects = [], today, warnDays = warnDaysOf(doc) }) {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const checks = doc?.checks || []
  return (doc?.items || [])
    .map((item) => {
      const type = typeOf(doc, item.typeId)
      return { item, type, object: byId.get(item.objectId) || null, ...statusOf({ item, type, checks, today, warnDays }) }
    })
    .sort(
      (a, b) =>
        (a.object?.name || '').localeCompare(b.object?.name || '', 'de') ||
        ORDER[a.state] - ORDER[b.state] ||
        (a.next || '0').localeCompare(b.next || '0') ||
        (a.type?.name || '').localeCompare(b.type?.name || '', 'de') ||
        (a.item.label || '').localeCompare(b.item.label || '', 'de', { numeric: true }),
    )
}

/** Passt eine Zeile zum Status-Filter (STATUS_FILTERS)? Leer = alle aktiven. */
export function matchStatus(row, status = '') {
  if (status === 'maengel') return row.defects.length > 0
  if (status === 'inaktiv') return row.state === 'inaktiv'
  if (status === 'bedarf') return row.state === 'ueberfaellig' || row.state === 'faellig' || row.defects.length > 0
  if (!status) return row.state !== 'inaktiv'
  return row.state === status
}

/** Filter der Übersicht: Objekt, Revier (region am Objekt), Art, Status. */
export function filterRows(rows, { objectId = '', region = '', typeId = '', status = '' } = {}) {
  return rows.filter((r) => (!objectId || r.item.objectId === objectId) && (!region || r.object?.region === region) && (!typeId || r.item.typeId === typeId) && matchStatus(r, status))
}

/** Zahlen für die Kacheln: überfällig, fällig, Mängel offen, aktive Anlagen. */
export function counts(rows) {
  return {
    ueberfaellig: rows.filter((r) => r.state === 'ueberfaellig').length,
    faellig: rows.filter((r) => r.state === 'faellig').length,
    maengel: rows.filter((r) => r.defects.length).length,
    aktiv: rows.filter((r) => r.state !== 'inaktiv').length,
  }
}

/**
 * Handlungsbedarf je Objekt (für „Zu erledigen“ und den digitalen Mitarbeiter Fristen): Objekte mit fälligen oder
 * überfälligen Anlagen oder offenen Mängeln; inaktive Objekte nicht. [{ objectId, object, due: [Zeile], defects: [Zeile] }]
 * dringend zuerst (überfällig oder außer Betrieb), dann nach Name.
 */
export function attention(rows) {
  const map = new Map()
  for (const r of rows) {
    if (r.object?.inactive) continue
    const due = r.state === 'ueberfaellig' || r.state === 'faellig'
    if (!due && !r.defects.length) continue
    const id = r.item.objectId
    if (!map.has(id)) map.set(id, { objectId: id, object: r.object, due: [], defects: [] })
    if (due) map.get(id).due.push(r)
    if (r.defects.length) map.get(id).defects.push(r)
  }
  return [...map.values()].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || (a.object?.name || '').localeCompare(b.object?.name || '', 'de'))
}
/** Dringend: eine Prüfung überfällig oder eine Anlage außer Betrieb. */
export const isUrgent = (g) => g.due.some((r) => r.state === 'ueberfaellig') || g.defects.some((r) => r.defects.some((c) => c.result === 'ausser'))

// ---------------------------------------------------------------- Eintragen

/** Prüfung prüfen, bevor sie eingetragen wird: Text des ersten Problems oder ''. */
export function checkProblem(input, today) {
  if (!input.itemId) return 'Bitte die Anlage wählen.'
  if (!input.date) return 'Bitte das Datum der Prüfung eintragen.'
  if (input.date > today) return 'Das Datum liegt in der Zukunft.'
  if (!RESULTS[input.result]) return 'Bitte das Ergebnis wählen.'
  if (input.result === 'maengel' && !String(input.defects || '').trim()) return 'Bitte die Mängel beschreiben.'
  if (!String(input.by || '').trim()) return 'Bitte eintragen, wer geprüft hat.'
  return ''
}

/** Anlage prüfen, bevor sie gespeichert wird: Text des ersten Problems oder ''. */
export function itemProblem(fields, type) {
  if (!fields.objectId) return 'Bitte das Objekt wählen.'
  if (!type) return 'Bitte die Art wählen.'
  if (!String(fields.label || '').trim()) return 'Bitte Bezeichnung oder Standort eintragen, z. B. Stiege 2, EG.'
  if (!(Number(fields.count) >= 1)) return 'Die Anzahl muss mindestens 1 sein.'
  if (!intervalOf(fields, type)) return 'Bitte das Intervall in Monaten eintragen (laut Hersteller oder Vertrag).'
  if (fields.by === 'fremd' && !String(fields.company || '').trim()) return 'Bitte die Fremdfirma eintragen.'
  if (fields.billable && !(Number(fields.price) > 0)) return 'Bitte den Preis je Prüfung eintragen (oder „verrechenbar“ abwählen).'
  return ''
}

/** Mangel als behoben vermerken (neues Objekt, die Prüfung selbst bleibt). */
export const resolveDefect = (check, { date, note = '', by = '', at = '' }) => ({ ...check, resolved: { date, note: String(note).trim(), by, at } })

/**
 * Prüfung eintragen: { checks, check, resolved } mit der neuen Prüfung am Ende. resolveOpen: bei „in Ordnung“ gelten
 * offene Mängel der Anlage bis zu diesem Tag als behoben (Vermerk mit Datum der Prüfung).
 */
export function addCheck(checks = [], input, { newId, at = '', user = '', resolveOpen = false }) {
  const check = {
    id: newId(),
    itemId: input.itemId,
    kind: input.kind === 'operativ' ? 'operativ' : 'haupt',
    date: input.date,
    result: input.result,
    defects: input.result === 'ok' ? '' : String(input.defects || '').trim(),
    by: String(input.by || '').trim(),
    external: !!input.external,
    note: String(input.note || '').trim(),
    photos: input.photos || [],
    report: input.report || null,
    billable: !!input.billable,
    price: input.billable ? Number(input.price) || 0 : 0,
    resolved: null,
    at,
    user,
  }
  let resolved = 0
  const list = checks.map((c) => {
    if (!resolveOpen || check.result !== 'ok' || c.itemId !== check.itemId || !isDefectOpen(c) || c.date > check.date) return c
    resolved++
    return resolveDefect(c, { date: check.date, note: 'bei der Prüfung in Ordnung', by: user, at })
  })
  return { checks: [...list, check], check, resolved }
}

// ---------------------------------------------------------------- Verrechnung

/**
 * Verrechenbare Prüfungen eines Monats (JJJJ-MM) je Objekt: [{ objectId, object, rows: [{ check, item, type }], sum }],
 * nach Objektname; Preis wie beim Erfassen vermerkt (die Anlage kann sich seither geändert haben).
 */
export function billableChecks({ doc, objects = [], month }) {
  const items = new Map((doc?.items || []).map((i) => [i.id, i]))
  const byObj = new Map(objects.map((o) => [o.id, o]))
  const groups = new Map()
  for (const check of doc?.checks || []) {
    if (!check.billable || !String(check.date || '').startsWith(month)) continue
    const item = items.get(check.itemId)
    if (!item) continue
    if (!groups.has(item.objectId)) groups.set(item.objectId, { objectId: item.objectId, object: byObj.get(item.objectId) || null, rows: [], sum: 0 })
    const g = groups.get(item.objectId)
    g.rows.push({ check, item, type: typeOf(doc, item.typeId) })
    g.sum = Math.round((g.sum + (Number(check.price) || 0)) * 100) / 100
  }
  for (const g of groups.values()) g.rows.sort((a, b) => a.check.date.localeCompare(b.check.date))
  return [...groups.values()].sort((a, b) => (a.object?.name || '').localeCompare(b.object?.name || '', 'de'))
}
