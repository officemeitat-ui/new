// Arbeitsschutz: Arbeitsstoffverzeichnis aus den Material-Artikeln, Betriebsanweisungen, Evaluierung nach § 4 ASchG
// mit Maßnahmen und Fristen, Hinweis auf noch nicht unterwiesene Personen. Reine Funktionen ohne Browser
// (test/arbeitsschutz.test.js); Ansicht: ui/views/arbeitsschutz.js, PDFs: export/arbeitsschutz-pdf.js,
// Vorlagen (Gefahren der Reinigung, Texte der Betriebsanweisung): core/arbeitsschutz-vorlagen.js.
//
// Arbeitsstoffe sind Artikel aus material/material.json. Die Angaben dazu stehen optional am Artikel (alte Artikel
// ohne diese Felder bleiben gültig):
//   article.haz = { on, maker, product, use, ghs: ['GHS05', …], signal: ''|'achtung'|'gefahr', h, p, ppe: [Text],
//                   sdb: Datei|null, sdbDate, objectIds: [], changedAt, changedBy }
//   on: true = im Verzeichnis, false = bewusst nicht; fehlt es, stehen Reinigungsmittel und Desinfektion drin.
//   article.sds (Link zum Sicherheitsdatenblatt, schon vorher am Artikel) zählt als Sicherheitsdatenblatt.
//   Datei = { path, name, type, size, at, by, url?, queued?, local? } unter arbeitsschutz/dokumente/sdb/
//
// Datei arbeitsschutz/arbeitsschutz.json:
//   { instructions: [{ id, kind: 'stoff'|'taetigkeit', articleId, title, area, sections: { anwendung, gefahren, schutz,
//                      gefahrfall, ersteHilfe, entsorgung }, date, approvedBy, approvedAt, trainingTypeId, pdf: Datei|null,
//                      createdAt, createdBy, changedAt, changedBy }],
//     evaluations:  [{ id, title, templateId, objectIds: [], participants, reviewedAt, reviewedBy, trigger: { date, text }|null,
//                      note, hazards: [{ id, text, source: 'vorschlag'|'eigen', likelihood: 0–3, severity: 0–3,
//                      measures: [{ id, text, who, due, status: 'offen'|'umgesetzt'|'wirksam'|'unwirksam', doneAt, checkedAt,
//                      trainingTypeId }] }], active, createdAt, createdBy, changedAt, changedBy }],
//     settings: { sdbYears, reviewMonths, warnDays, trainingTypeId } }
//
// Fristen: Maßnahme „offen“ mit Frist vor heute = überfällig; „nicht wirksam“ braucht eine neue Maßnahme. Evaluierung:
// nächste Überprüfung = zuletzt überprüft + reviewMonths (Vorschlag 12), fällig warnDays (30) vorher; ein Anlass
// (z. B. Unfall) nach der letzten Überprüfung macht sie sofort fällig. Sicherheitsdatenblatt: veraltet, wenn die Fassung
// älter als sdbYears (Vorschlag 3) ist; ohne Datei und Link fehlt es.
// Alles Fachliche (Intervalle, Bewertung 3 × 3, Vorschläge) ist Vorschlag ohne Gewähr (docs/RECHTSPRUEFUNG.md, Punkt 32).

import { addDays } from './dates.js'
import { addMonths, latest, TRAINING_DEFAULTS, untilOf } from './trainings.js'

/** Gefahrenpiktogramme nach GHS/CLP: Kennung, Name des Symbols, Kurzbeschreibung. */
export const GHS = [
  { id: 'GHS01', name: 'Explodierende Bombe', short: 'explosiv' },
  { id: 'GHS02', name: 'Flamme', short: 'entzündbar' },
  { id: 'GHS03', name: 'Flamme über einem Kreis', short: 'brandfördernd' },
  { id: 'GHS04', name: 'Gasflasche', short: 'Gas unter Druck' },
  { id: 'GHS05', name: 'Ätzwirkung', short: 'ätzend' },
  { id: 'GHS06', name: 'Totenkopf mit gekreuzten Knochen', short: 'giftig' },
  { id: 'GHS07', name: 'Ausrufezeichen', short: 'reizend, gesundheitsschädlich' },
  { id: 'GHS08', name: 'Gesundheitsgefahr', short: 'gesundheitsgefährdend' },
  { id: 'GHS09', name: 'Umwelt', short: 'umweltgefährlich' },
]
export const GHS_IDS = GHS.map((g) => g.id)
export const ghsOf = (id) => GHS.find((g) => g.id === id) || null
export const SIGNALS = { '': 'kein Signalwort', achtung: 'Achtung', gefahr: 'Gefahr' }
/** Persönliche Schutzausrüstung zur Auswahl (für die Betriebsanweisung). */
export const PPE = ['Schutzhandschuhe', 'Schutzbrille', 'Atemschutz', 'Schutzkleidung']
/** Kategorien der Artikel, die ohne eigene Angabe als Arbeitsstoff gelten. */
export const STOFF_CATEGORIES = ['Reinigungsmittel', 'Desinfektion']
export const SDB_STATES = { ok: 'aktuell', veraltet: 'veraltet', 'ohne-datum': 'Fassung unbekannt', fehlt: 'fehlt' }
export const MEASURE_STATES = { offen: 'offen', umgesetzt: 'umgesetzt', wirksam: 'wirksam', unwirksam: 'nicht wirksam' }
export const REVIEW_STATES = { ok: 'aktuell', faellig: 'bald fällig', ueberfaellig: 'überfällig', anlass: 'Anlass zur Überprüfung' }
/** Bewertung 3 × 3 (Vorschlag): Wahrscheinlichkeit und Schwere je 1–3, Risiko = Produkt. */
export const LIKELIHOOD = { 1: 'selten', 2: 'gelegentlich', 3: 'häufig' }
export const SEVERITY = { 1: 'leicht', 2: 'mittel', 3: 'schwer' }
export const RISK = { gering: 'gering', mittel: 'mittel', hoch: 'hoch' }
export const BA_KINDS = { stoff: 'Arbeitsstoff', taetigkeit: 'Tätigkeit oder Maschine' }

export const DEFAULTS = { sdbYears: 3, reviewMonths: 12, warnDays: 30, trainingTypeId: 'chemie' }
export const emptyArbeitsschutz = () => ({ instructions: [], evaluations: [], settings: {} })

const positive = (v, d) => (Number(v) > 0 ? Number(v) : d)
/** Einstellungen mit Vorgaben. */
export function settingsOf(doc) {
  const s = doc?.settings || {}
  return { sdbYears: positive(s.sdbYears, DEFAULTS.sdbYears), reviewMonths: positive(s.reviewMonths, DEFAULTS.reviewMonths), warnDays: positive(s.warnDays, DEFAULTS.warnDays), trainingTypeId: s.trainingTypeId ?? DEFAULTS.trainingTypeId }
}

// ---------------------------------------------------------------- Arbeitsstoffe

export const hazOf = (article) => article?.haz || {}
/** Steht der Artikel im Arbeitsstoffverzeichnis? Eigene Angabe vor Kategorie; inaktive Artikel nicht. */
export function isStoff(article) {
  if (!article || article.active === false) return false
  const on = article.haz?.on
  if (on === true || on === false) return on
  return STOFF_CATEGORIES.includes(article.category)
}
/** Sind Angaben zur Gefahr eingetragen (Hersteller, Piktogramme, Signalwort, H-Sätze oder Verwendung)? */
export const hasDetails = (article) => {
  const h = hazOf(article)
  return !!(h.maker || h.use || h.signal || String(h.h || '').trim() || (h.ghs || []).length)
}

/** Kürzel der H- und P-Sätze als Liste: „H290, H314“ → ['H290', 'H314'] (Großschreibung, ohne Doppel). */
export function codesOf(text) {
  const out = []
  for (const part of String(text || '').split(/[,;\s]+/)) {
    const code = part.trim().toUpperCase()
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}
/** Kürzel prüfen: H-Sätze (auch EUH) bzw. P-Sätze (auch kombiniert mit +). Liefert die ungültigen. */
export function badCodes(text, kind) {
  const re = kind === 'p' ? /^P\d{3}(\+P\d{3})*$/ : /^(H\d{3}[A-Z]{0,2}|EUH\d{3}[A-Z]?)$/
  return codesOf(text).filter((c) => !re.test(c))
}

/** Sicherheitsdatenblatt: { state: ok | veraltet | ohne-datum | fehlt, file, link, date, due } (due: ab wann veraltet). */
export function sdbState(article, today, years = DEFAULTS.sdbYears) {
  const h = hazOf(article)
  const file = h.sdb?.path ? h.sdb : null
  const link = /^https?:\/\//i.test(article?.sds || '') ? article.sds : ''
  const date = h.sdbDate || ''
  if (!file && !link) return { state: 'fehlt', file, link, date, due: '' }
  if (!date) return { state: 'ohne-datum', file, link, date, due: '' }
  const due = addMonths(date, Math.round(years * 12))
  return { state: due < today ? 'veraltet' : 'ok', file, link, date, due }
}

const usable = (m) => !m.cancelledBy && !m.cancels
/** Objekte, in denen der Artikel verwendet wird: Ausgaben der letzten months Monate und eigene Zuordnung. */
export function usedObjects(material, article, today, months = 12) {
  const since = addMonths(today, -months)
  const ids = new Set(hazOf(article).objectIds || [])
  for (const m of material?.moves || []) if (m.articleId === article.id && m.kind === 'ausgabe' && m.objectId && m.date >= since && usable(m)) ids.add(m.objectId)
  return [...ids]
}
/** Personen, an die der Artikel direkt ausgegeben wurde (letzte months Monate). */
export function issuedPeople(material, article, today, months = 12) {
  const since = addMonths(today, -months)
  return [...new Set((material?.moves || []).filter((m) => m.articleId === article.id && m.kind === 'ausgabe' && m.employeeId && m.date >= since && usable(m)).map((m) => m.employeeId))]
}

/** Bestand je Lager (nur Lager mit Menge ≠ 0): [{ loc, name, qty }] und gesamt. */
export function stockOfArticle(material, articleId) {
  const byLoc = new Map()
  for (const m of material?.moves || []) if (m.articleId === articleId) byLoc.set(m.loc, Math.round(((byLoc.get(m.loc) || 0) + (Number(m.qty) || 0)) * 1000) / 1000)
  const names = new Map((material?.locations?.length ? material.locations : [{ id: 'lager', name: 'Hauptlager' }]).map((l) => [l.id, l.name]))
  const list = [...byLoc].filter(([, qty]) => qty !== 0).map(([loc, qty]) => ({ loc, name: names.get(loc) || loc, qty }))
  return { list, total: Math.round(list.reduce((s, x) => s + x.qty, 0) * 1000) / 1000 }
}

/** Betriebsanweisung zu einem Artikel (die zuletzt geänderte, falls es mehrere gibt). */
export function instructionFor(doc, articleId) {
  const list = (doc?.instructions || []).filter((b) => b.kind === 'stoff' && b.articleId === articleId)
  return list.sort((a, b) => (b.changedAt || b.createdAt || '').localeCompare(a.changedAt || a.createdAt || ''))[0] || null
}

/**
 * Arbeitsstoffverzeichnis: [{ article, haz, product, maker, details, sdb, stock, objectIds, instruction, needs }]
 * nach Produktname. needs: Handlungsbedarf (Angaben fehlen, Sicherheitsdatenblatt fehlt oder veraltet).
 */
export function stoffRows({ material, doc, today, settings = settingsOf(doc) }) {
  return (material?.articles || [])
    .filter(isStoff)
    .map((article) => {
      const haz = hazOf(article)
      const sdb = sdbState(article, today, settings.sdbYears)
      const details = hasDetails(article)
      return {
        article,
        haz,
        product: haz.product || article.name,
        maker: haz.maker || '',
        details,
        sdb,
        stock: stockOfArticle(material, article.id),
        objectIds: usedObjects(material, article, today),
        instruction: instructionFor(doc, article.id),
        needs: !details || sdb.state === 'fehlt' || sdb.state === 'veraltet',
      }
    })
    .sort((a, b) => a.product.localeCompare(b.product, 'de'))
}

export function stoffCounts(rows) {
  return {
    stoffe: rows.length,
    sdb: rows.filter((r) => r.sdb.state === 'fehlt' || r.sdb.state === 'veraltet').length,
    angaben: rows.filter((r) => !r.details).length,
    ohneBa: rows.filter((r) => !r.instruction).length,
  }
}

// ---------------------------------------------------------------- Unterweisung

const trainingTypes = (trainings) => (trainings?.types?.length ? trainings.types : TRAINING_DEFAULTS)
export const trainingTypeOf = (trainings, id) => trainingTypes(trainings).find((t) => t.id === id) || null

/** Personen, die im Objekt arbeiten: Stammkräfte der Leistungen und im Objekt eingeschulte (aktive Personen). */
export function peopleAt({ objectIds = [], tasks = [], employees = [], today }) {
  const set = new Set(objectIds)
  const ids = new Set()
  for (const t of tasks) if (set.has(t.objectId)) for (const e of t.regulars || []) ids.add(e)
  for (const e of employees) if ((e.trained || []).some((o) => set.has(o))) ids.add(e.id)
  return employees.filter((e) => ids.has(e.id) && !e.inactive && (!e.exitDate || e.exitDate >= today)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Stand einer Person zu einer Art der Unterweisung: ok | abgelaufen | fehlt (ohne Eintrag). */
export function trainState(trainings, type, empId, today) {
  const record = type ? latest(trainings?.records || [], empId, type.id) : null
  if (!record) return { state: 'fehlt', record: null, until: '' }
  const until = untilOf(record, type)
  return { state: until && until < today ? 'abgelaufen' : 'ok', record, until }
}

/**
 * Wer zu einem Arbeitsstoff noch nicht (gültig) unterwiesen ist, je Objekt: { type, groups: [{ objectId, people:
 * [{ emp, state, until }] }], missing: [emp] } – groups enthält alle Personen, missing nur die ohne gültige Unterweisung.
 * Ohne Art der Unterweisung (oder ohne Zugriff auf die Unterweisungen) ist type null und missing leer.
 */
export function trainingGaps({ article, material, tasks = [], employees = [], trainings, typeId, today }) {
  const type = trainings ? trainingTypeOf(trainings, typeId) : null
  const groups = usedObjects(material, article, today).map((objectId) => ({ objectId, people: peopleAt({ objectIds: [objectId], tasks, employees, today }) }))
  const direct = issuedPeople(material, article, today)
    .map((id) => employees.find((e) => e.id === id))
    .filter((e) => e && !e.inactive && (!e.exitDate || e.exitDate >= today))
  if (direct.length) groups.push({ objectId: '', people: direct })
  const missing = new Map()
  const out = groups
    .filter((g) => g.people.length)
    .map((g) => ({
      objectId: g.objectId,
      people: g.people.map((emp) => {
        const s = type ? trainState(trainings, type, emp.id, today) : { state: 'unbekannt', until: '' }
        if (type && s.state !== 'ok') missing.set(emp.id, emp)
        return { emp, state: s.state, until: s.until }
      }),
    }))
  return { type, groups: out, objects: groups.map((g) => g.objectId).filter(Boolean), missing: [...missing.values()] }
}

// ---------------------------------------------------------------- Evaluierung

export const riskOf = (h) => (Number(h?.likelihood) >= 1 && Number(h?.severity) >= 1 ? Number(h.likelihood) * Number(h.severity) : 0)
/** Risikostufe (Vorschlag): 1–2 gering, 3–4 mittel, 6–9 hoch; 0 = noch nicht bewertet (''). */
export const riskClass = (r) => (!r ? '' : r <= 2 ? 'gering' : r <= 4 ? 'mittel' : 'hoch')

/** Zustand einer Maßnahme: ueberfaellig | offen | ohne-frist | umgesetzt | wirksam | unwirksam. */
export function measureState(m, today) {
  if (m.status === 'wirksam' || m.status === 'unwirksam' || m.status === 'umgesetzt') return m.status
  if (!m.due) return 'ohne-frist'
  return m.due < today ? 'ueberfaellig' : 'offen'
}
/** Braucht die Maßnahme noch Arbeit (offen, überfällig, ohne Frist, nicht wirksam)? */
export const isOpenMeasure = (m, today) => ['offen', 'ueberfaellig', 'ohne-frist', 'unwirksam'].includes(measureState(m, today))

/** Alle Maßnahmen einer Evaluierung: [{ hazard, m, state }]. */
export const measuresOf = (ev, today) => (ev?.hazards || []).flatMap((hazard) => (hazard.measures || []).map((m) => ({ hazard, m, state: measureState(m, today) })))

/**
 * Überprüfung der Evaluierung: { last, next, state: ok | faellig | ueberfaellig | anlass, trigger }.
 * Ohne Datum gilt sie als überfällig (seit heute).
 */
export function reviewOf(ev, today, settings = DEFAULTS) {
  const last = ev?.reviewedAt || ''
  const next = last ? addMonths(last, settings.reviewMonths || DEFAULTS.reviewMonths) : today
  const trigger = ev?.trigger?.date && (!last || ev.trigger.date > last) ? ev.trigger : null
  if (trigger) return { last, next, state: 'anlass', trigger }
  if (!last || next < today) return { last, next, state: 'ueberfaellig', trigger: null }
  if (next <= addDays(today, settings.warnDays || DEFAULTS.warnDays)) return { last, next, state: 'faellig', trigger: null }
  return { last, next, state: 'ok', trigger: null }
}

/** Übersicht je Evaluierung (aktive): [{ ev, review, hazards, unrated, maxRisk, open, overdue, noDue, unwirksam, check }]. */
export function evalRows({ doc, today, settings = settingsOf(doc) }) {
  return (doc?.evaluations || [])
    .filter((ev) => ev.active !== false)
    .map((ev) => {
      const list = measuresOf(ev, today)
      const count = (s) => list.filter((x) => x.state === s).length
      return {
        ev,
        review: reviewOf(ev, today, settings),
        hazards: (ev.hazards || []).length,
        unrated: (ev.hazards || []).filter((h) => !riskOf(h)).length,
        maxRisk: Math.max(0, ...(ev.hazards || []).map(riskOf)),
        open: list.filter((x) => isOpenMeasure(x.m, today)).length,
        overdue: count('ueberfaellig'),
        noDue: count('ohne-frist'),
        unwirksam: count('unwirksam'),
        check: count('umgesetzt'),
      }
    })
    .sort((a, b) => (a.ev.title || '').localeCompare(b.ev.title || '', 'de'))
}

const MEASURE_ORDER = { ueberfaellig: 0, unwirksam: 1, offen: 2, 'ohne-frist': 3, umgesetzt: 4, wirksam: 5 }
/** Alle Maßnahmen aktiver Evaluierungen, dringend zuerst, dann nach Frist: [{ ev, hazard, m, state }]. */
export function allMeasures(doc, today) {
  return (doc?.evaluations || [])
    .filter((ev) => ev.active !== false)
    .flatMap((ev) => measuresOf(ev, today).map((x) => ({ ev, ...x })))
    .sort((a, b) => MEASURE_ORDER[a.state] - MEASURE_ORDER[b.state] || (a.m.due || '9').localeCompare(b.m.due || '9') || (a.ev.title || '').localeCompare(b.ev.title || '', 'de'))
}

/**
 * Handlungsbedarf für „Zu erledigen“ und den digitalen Mitarbeiter „Fristen“:
 * [{ kind: 'massnahmen', ev, list: [{ hazard, m, state }] } | { kind: 'ueberpruefung', ev, review } | { kind: 'sdb', rows }]
 * Maßnahmen: überfällig oder nicht wirksam; Überprüfung: fällig, überfällig oder Anlass; Sicherheitsdatenblätter:
 * fehlend oder veraltet (eine Sammelzeile).
 */
export function attention({ doc, material, today, settings = settingsOf(doc) }) {
  const out = []
  for (const ev of (doc?.evaluations || []).filter((x) => x.active !== false)) {
    const list = measuresOf(ev, today).filter((x) => x.state === 'ueberfaellig' || x.state === 'unwirksam')
    if (list.length) out.push({ kind: 'massnahmen', ev, list })
    const review = reviewOf(ev, today, settings)
    if (review.state !== 'ok') out.push({ kind: 'ueberpruefung', ev, review })
  }
  const rows = material ? stoffRows({ material, doc, today, settings }).filter((r) => r.sdb.state === 'fehlt' || r.sdb.state === 'veraltet') : []
  if (rows.length) out.push({ kind: 'sdb', rows })
  return out
}
/** Dringend: alles außer einer Überprüfung, die erst bald fällig ist. */
export const isUrgent = (x) => (x.kind === 'ueberpruefung' ? x.review.state !== 'faellig' : true)

// ---------------------------------------------------------------- Prüfen vor dem Speichern

/** Evaluierung prüfen: Text des ersten Problems oder ''. */
export function evalProblem(ev, today) {
  if (!String(ev.title || '').trim()) return 'Bitte den Arbeitsbereich oder die Tätigkeit eintragen.'
  if (!ev.reviewedAt) return 'Bitte eintragen, wann evaluiert bzw. zuletzt überprüft wurde.'
  if (ev.reviewedAt > today) return 'Das Datum der Überprüfung liegt in der Zukunft.'
  for (const h of ev.hazards || []) {
    if (!String(h.text || '').trim()) return 'Jede Gefahr braucht eine Beschreibung (leere Zeile entfernen).'
    for (const m of h.measures || []) if (!String(m.text || '').trim()) return `Maßnahme ohne Text bei „${h.text}“ (leere Zeile entfernen).`
  }
  if (ev.trigger && ev.trigger.date && !String(ev.trigger.text || '').trim()) return 'Bitte den Anlass zur Überprüfung kurz beschreiben (z. B. Unfall).'
  if (ev.trigger && !ev.trigger.date && String(ev.trigger.text || '').trim()) return 'Bitte das Datum des Anlasses eintragen.'
  if (ev.trigger?.date && ev.trigger.date > today) return 'Das Datum des Anlasses liegt in der Zukunft.'
  return ''
}

/** Betriebsanweisung prüfen: Text des ersten Problems oder ''. */
export function instructionProblem(ba) {
  if (ba.kind === 'stoff' && !ba.articleId) return 'Bitte den Arbeitsstoff wählen.'
  if (!String(ba.title || '').trim()) return 'Bitte einen Titel eintragen.'
  if (!ba.date) return 'Bitte das Datum (Stand) eintragen.'
  if (ba.approvedAt && !String(ba.approvedBy || '').trim()) return 'Bitte eintragen, wer freigegeben hat.'
  return ''
}

/** Status einer Maßnahme setzen (mit Datum): umgesetzt → doneAt, wirksam/unwirksam → checkedAt; offen löscht beides. */
export function setMeasureStatus(m, status, today) {
  if (status === 'offen') return { ...m, status, doneAt: '', checkedAt: '' }
  if (status === 'umgesetzt') return { ...m, status, doneAt: m.doneAt || today, checkedAt: '' }
  return { ...m, status, doneAt: m.doneAt || today, checkedAt: today }
}
