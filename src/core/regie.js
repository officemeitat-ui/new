// Regiebericht: Sonderleistungen nach Auftrag (Grundreinigung, Wasserschaden, Zusatzarbeiten, Sonderreinigung) vor Ort
// am Handy erfassen – Objekt, Datum, Auftrag (wer hat beauftragt), Stunden je Person (von–bis oder Dauer), Material (aus
// Material & Lager oder frei), Fotos vorher/nachher und die Unterschrift von Kunde oder Hausbetreuung am Gerät. Daraus
// das PDF „Regiebericht“ (export/regie-pdf.js), der Versand per E-Mail, die Ablage in SharePoint und mit einem Klick ein
// Rechnungsentwurf. Reine Funktionen ohne Browser (test/regie.test.js); Ansicht: ui/views/regie.js, Beilage zur Rechnung:
// ui/views/invoicing-abrechnung.js.
//
// Datei regie/regie.json:
//   { reports: [{ id, no ('RB-2026-0001'), objectId, date, kind, title, description, orderedBy, orderedRole, orderRef,
//                 workers:  [{ id, employeeId, name, from, to, pause, minutes }]   von–bis (HH:MM) mit Pause in Minuten,
//                                                                                 sonst die Dauer in Minuten (minutes)
//                 material: [{ id, articleId, text, qty, unit }]                  articleId: Artikel aus Material & Lager
//                 photos:   [Datei mit phase 'vorher' | 'nachher']
//                 status:   'offen' (in Arbeit, änderbar) | 'abgeschlossen' (fest, mit oder ohne Unterschrift)
//                 signature { name, role, svg, at, by } | null                   Unterschrift am Gerät (SVG-Linie, ui/signature.js)
//                 unsigned  { reason, at, by } | null                            ohne Unterschrift abgeschlossen (mit Grund)
//                 email, pdf: Datei | null, sent: [{ at, to, by, via }]
//                 stock     { status: 'gebucht' | 'hinweis', loc, moves: [Buchungen], at, by } | null
//                 billing   { status: 'nicht', reason, at, by } | null           „nicht verrechnen“ (Kulanz, im Pauschalpreis)
//                 billed    { docId, number, date }                              Stand aus der Fakturierung (syncRegieBilled)
//                 createdAt, createdBy, changedAt, changedBy, closedAt, closedBy }],
//     settings: { names: 'voll' | 'vorname' | 'keine' } }                          Namen der eigenen Leute im PDF
//   Datei = { path, name, type, size, at, by, url?, queued?, local? }: in SharePoint unter regie/nachweise/<Jahr>/…
//
// Rechnung (fakturierung.json, außerhalb der Prüfsumme; FIXED_FIELDS bleiben unverändert):
//   documents[].source { type: 'regie', key: 'regie:<id>', reportId, no, objectId, date, beilage }
//     beilage: der Bericht beim Erstellen eingefroren (freezeRegie, ohne Fotos, Namen wie eingestellt), damit die Rolle
//     Buchhaltung den Regiebericht als Beilage senden kann, ohne regie/ lesen zu dürfen.
//   settings.regieRate  Regiestundensatz netto (Einstellungen der Fakturierung)
//   customers[].regieRate  eigener Regiestundensatz des Kunden
//
// Verrechnung (abgeleitet wie bei der Weiterverrechnung, nicht gespeichert):
//   offen       abgeschlossen, in keiner Rechnung
//   entwurf     in einem Rechnungsentwurf
//   verrechnet  in einer festgeschriebenen, nicht stornierten Rechnung
//   nicht       „nicht verrechnen“
// Entwurf gelöscht → wieder offen; Storno der Rechnung → wieder offen. Ein Regiebericht wird nur einmal verrechnet:
// kein zweiter Entwurf, solange einer besteht, und kein Festschreiben, wenn schon eine Rechnung festgeschrieben ist.
// Wer die Fakturierung nicht lesen darf, sieht den Stand aus billed.

import { articleActive, deDate, isCancelled, parseNumber, round2 } from './invoicing.js'

export const REGIE_KINDS = { grundreinigung: 'Grundreinigung', wasserschaden: 'Wasserschaden', zusatz: 'Zusatzarbeiten', sonder: 'Sonderreinigung nach Auftrag', sonstige: 'Sonstige Sonderleistung' }
export const PHASES = { vorher: 'vorher', nachher: 'nachher' }
export const NAME_MODES = { voll: 'ganze Namen', vorname: 'nur Vornamen', keine: 'ohne Namen' }
/** Vorschläge für „Funktion“ der unterschreibenden Person. */
export const SIGNER_ROLES = ['Kunde', 'Hausverwaltung', 'Hausbetreuung', 'Haustechnik', 'Objektverantwortliche Person']
export const STATUS = { offen: 'offen', abgeschlossen: 'abgeschlossen' }
export const BILL_STATES = { offen: 'noch nicht verrechnet', entwurf: 'im Rechnungsentwurf', verrechnet: 'verrechnet', nicht: 'nicht verrechnen' }
export const RATE_SOURCES = { kunde: 'Regiestundensatz des Kunden', artikel: 'Artikel „Regiestunde“', einstellung: 'Regiestundensatz in den Einstellungen', aufwand: 'Stundensatz des Kunden (nach Aufwand)' }
/** Filter der Übersicht. */
export const STATUS_FILTERS = { '': 'alle', offen: 'offen (nicht abgeschlossen)', abgeschlossen: 'abgeschlossen', zuverrechnen: 'noch nicht verrechnet', entwurf: 'im Rechnungsentwurf', verrechnet: 'verrechnet', nicht: 'nicht verrechnen' }
export const MAX_PHOTOS = 8

export const emptyRegie = () => ({ reports: [], settings: {} })
export const regieKey = (id) => `regie:${id}`
export const namesOf = (doc) => (NAME_MODES[doc?.settings?.names] ? doc.settings.names : 'vorname')
const num = (v) => parseNumber(v)
const r3 = (n) => Math.round(n * 1000) / 1000
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const text = (s) => String(s ?? '').trim()

// ---------------------------------------------------------------- Nummer, Zeiten

/** Nächste Nummer RB-JJJJ-NNNN, je Jahr fortlaufend. */
export function nextRegieNo(reports = [], year) {
  const re = new RegExp(`^RB-${year}-(\\d+)$`)
  const max = reports.reduce((m, r) => Math.max(m, Number(re.exec(r.no || '')?.[1] || 0)), 0)
  return `RB-${year}-${String(max + 1).padStart(4, '0')}`
}

/** „08:30“ → 510 Minuten; ungültig → null. */
export function clockMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim())
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Dauer aus der Eingabe: „2,5“ oder „2.5“ Stunden → 150, „2:30“ → 150; leer oder ungültig → 0. */
export function parseDuration(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  if (/^\d{1,2}:\d{2}$/.test(s)) return clockMinutes(s) ?? 0
  return Math.max(0, Math.round(parseNumber(s) * 60))
}

/** Arbeitszeit einer Person in Minuten: von–bis minus Pause (bis vor von: über Mitternacht), sonst die Dauer. */
export function workerMinutes(w = {}) {
  const a = clockMinutes(w.from)
  const b = clockMinutes(w.to)
  if (a !== null && b !== null) {
    let d = b - a
    if (d < 0) d += 1440
    return Math.max(0, d - Math.max(0, Math.round(num(w.pause))))
  }
  return Math.max(0, Math.round(num(w.minutes)))
}

/** Dauer als „4:30“. */
export const durationText = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
/** Stunden als Zahl mit 2 Stellen (4:15 → 4,25). */
export const hoursOf = (min) => round2(min / 60)

/** Summen eines Berichts: { minutes, hours, persons (Zeilen mit Zeit), material (Zeilen) }. */
export function regieTotals(r = {}) {
  const mins = (r.workers || []).map(workerMinutes)
  const minutes = mins.reduce((s, m) => s + m, 0)
  return { minutes, hours: hoursOf(minutes), persons: mins.filter((m) => m > 0).length, material: (r.material || []).length }
}

/** Name wie eingestellt: ganzer Name, nur der Vorname oder keiner. */
export const personName = (name, mode = 'vorname') => (!text(name) || mode === 'keine' ? '' : mode === 'vorname' ? text(name).split(/\s+/)[0] : text(name))

/** Zeit einer Person als Text: „08:00–12:30 (Pause 30 Min.)“ bzw. „Dauer“. */
export function timeText(w = {}) {
  if (clockMinutes(w.from) !== null && clockMinutes(w.to) !== null) return `${w.from}–${w.to}${num(w.pause) > 0 ? ` (Pause ${Math.round(num(w.pause))} Min.)` : ''}`
  return 'Dauer'
}

// ---------------------------------------------------------------- Prüfen, säubern, abschließen

const filledWorker = (w) => text(w.name) || text(w.from) || text(w.to) || num(w.minutes) > 0
const filledMaterial = (m) => m.articleId || text(m.text) || num(m.qty) > 0

/**
 * Bericht säubern (beim Speichern): leere Zeilen weg, Zahlen als Zahl, Dauer aus von–bis gerechnet, Material mit
 * Text und Einheit des Lagerartikels, wenn leer. stock: Artikel aus Material & Lager.
 */
export function cleanReport(r, { stock = [] } = {}) {
  const art = new Map(stock.map((a) => [a.id, a]))
  return {
    ...r,
    title: text(r.title),
    description: text(r.description),
    orderedBy: text(r.orderedBy),
    orderedRole: text(r.orderedRole),
    orderRef: text(r.orderRef),
    workers: (r.workers || []).filter(filledWorker).map((w) => {
      const timed = clockMinutes(w.from) !== null && clockMinutes(w.to) !== null
      return { id: w.id, employeeId: w.employeeId || '', name: text(w.name), from: timed ? text(w.from) : '', to: timed ? text(w.to) : '', pause: timed ? Math.max(0, Math.round(num(w.pause))) : 0, minutes: workerMinutes(w) }
    }),
    material: (r.material || []).filter(filledMaterial).map((m) => {
      const a = m.articleId ? art.get(m.articleId) : null
      return { id: m.id, articleId: m.articleId || '', text: text(m.text) || a?.name || '', qty: r3(num(m.qty)), unit: text(m.unit) || a?.unit || 'Stk' }
    }),
  }
}

/** Prüfen vor dem Speichern: Text des ersten Problems oder ''. */
export function reportProblem(r, today) {
  if (!r.objectId) return 'Bitte das Objekt wählen.'
  if (!r.date) return 'Bitte das Datum eintragen.'
  if (today && r.date > today) return 'Das Datum liegt in der Zukunft.'
  if (!text(r.title) && !text(r.description)) return 'Bitte kurz beschreiben, was gemacht wurde (Leistung).'
  for (const w of (r.workers || []).filter(filledWorker)) {
    if (!text(w.name)) return 'Bitte bei jeder Zeile die Person eintragen.'
    const hasFrom = !!text(w.from)
    const hasTo = !!text(w.to)
    if (hasFrom || hasTo) {
      if (clockMinutes(w.from) === null || clockMinutes(w.to) === null) return `${text(w.name)}: Zeit von–bis prüfen (z. B. 08:00 bis 12:30).`
      if (clockMinutes(w.from) === clockMinutes(w.to)) return `${text(w.name)}: „bis“ muss nach „von“ liegen.`
    }
    if (!(workerMinutes(w) > 0)) return `${text(w.name)}: bitte von–bis oder die Dauer eintragen.`
    if (workerMinutes(w) > 16 * 60) return `${text(w.name)}: mehr als 16 Stunden an einem Tag, bitte prüfen.`
  }
  for (const m of (r.material || []).filter(filledMaterial)) {
    if (!m.articleId && !text(m.text)) return 'Bitte beim Material die Bezeichnung eintragen oder einen Artikel wählen.'
    if (!(num(m.qty) > 0)) return `Material ${text(m.text) || ''}: bitte die Menge eintragen.`.replace('  ', ' ')
  }
  return ''
}

/** Prüfen vor dem Abschließen: { signature: { name, svg } } oder { reason } (ohne Unterschrift). */
export function closeProblem(r, { signature = null, reason = '' } = {}) {
  const t = regieTotals(r)
  if (!t.minutes && !t.material) return 'Bitte Stunden oder Material eintragen.'
  if (signature) {
    if (!text(signature.name)) return 'Bitte den Namen der Person eintragen, die unterschreibt.'
    if (!signature.svg) return 'Bitte im Feld „Unterschrift“ unterschreiben lassen.'
    return ''
  }
  if (!text(reason)) return 'Bitte angeben, warum ohne Unterschrift abgeschlossen wird.'
  return ''
}

/** Abschließen (neues Objekt): mit Unterschrift { name, role, svg } oder ohne (Grund). Danach nicht mehr änderbar. */
export function closeReport(r, { signature = null, reason = '', at, by = '' }) {
  if (r.status === 'abgeschlossen') throw new Error('Der Regiebericht ist schon abgeschlossen.')
  const problem = closeProblem(r, { signature, reason })
  if (problem) throw new Error(problem)
  return {
    ...r,
    status: 'abgeschlossen',
    signature: signature ? { name: text(signature.name), role: text(signature.role), svg: signature.svg, at, by } : null,
    unsigned: signature ? null : { reason: text(reason), at, by },
    closedAt: at,
    closedBy: by,
  }
}

// ---------------------------------------------------------------- Verrechnung (Zustand aus den Belegen)

/** Rechnungen mit Regiebericht: Map „regie:<id>“ → [Beleg]. */
function billedIndex(docs = []) {
  const map = new Map()
  for (const d of docs) if (d.kind === 'rechnung' && d.source?.type === 'regie' && d.source.key) map.set(d.source.key, [...(map.get(d.source.key) || []), d])
  return map
}

/**
 * Zustand der Verrechnung: { state: offen | entwurf | verrechnet | nicht, docId?, number?, date? }; null für offene
 * (nicht abgeschlossene) Berichte. docs: Belege der Fakturierung; null = nicht lesbar (dann gilt billed).
 */
export function regieState(r, docs, index = null) {
  if (!r || r.status !== 'abgeschlossen') return null
  if (!docs) {
    if (r.billed?.number) return { state: 'verrechnet', docId: r.billed.docId || '', number: r.billed.number, date: r.billed.date || '' }
    return { state: r.billing?.status === 'nicht' ? 'nicht' : 'offen' }
  }
  const hits = (index || billedIndex(docs)).get(regieKey(r.id)) || []
  const fixed = hits.find((d) => d.number && !isCancelled(d, docs))
  if (fixed) return { state: 'verrechnet', docId: fixed.id, number: fixed.number, date: fixed.date || '' }
  if (r.billing?.status === 'nicht') return { state: 'nicht' }
  const draft = hits.find((d) => !d.number)
  if (draft) return { state: 'entwurf', docId: draft.id }
  return { state: 'offen' }
}

/** Zustand aller Berichte: Map id → Zustand (wie regieState). */
export function regieStates(reports = [], docs = null) {
  const index = docs ? billedIndex(docs) : null
  return new Map(reports.map((r) => [r.id, regieState(r, docs, index)]))
}

/** Passt ein Bericht zum Filter der Übersicht (Objekt, Status aus STATUS_FILTERS)? state: aus regieState. */
export function matchFilter(r, state, { objectId = '', status = '' } = {}) {
  if (objectId && r.objectId !== objectId) return false
  if (!status) return true
  if (status === 'offen') return r.status !== 'abgeschlossen'
  if (status === 'abgeschlossen') return r.status === 'abgeschlossen'
  if (status === 'zuverrechnen') return state?.state === 'offen'
  return state?.state === status
}

/** Abgeschlossene Berichte, die noch in keiner Rechnung stehen (ältester zuerst). */
export function toBill(reports = [], docs = null) {
  const st = regieStates(reports, docs)
  return reports.filter((r) => st.get(r.id)?.state === 'offen').sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.no).localeCompare(String(b.no)))
}

/**
 * Stand der Fakturierung in die Berichte schreiben (billed), damit Rollen ohne Fakturierung „verrechnet mit …“ sehen;
 * nach einem Storno wieder weg. Liefert die Zahl der geänderten Berichte.
 */
export function syncRegieBilled(reports = [], docs = []) {
  const index = billedIndex(docs)
  let n = 0
  for (const r of reports) {
    const st = regieState(r, docs, index)
    if (st?.state === 'verrechnet') {
      if (r.billed?.docId === st.docId && r.billed?.number === st.number) continue
      r.billed = { docId: st.docId, number: st.number, date: st.date }
      n++
    } else if (r.billed) {
      delete r.billed
      n++
    }
  }
  return n
}

/**
 * Vor dem Festschreiben: steht der Regiebericht dieses Entwurfs schon in einer festgeschriebenen, nicht stornierten
 * Rechnung (z. B. zwei Entwürfe gleichzeitig)? Liefert Meldungen (leer: in Ordnung).
 */
export function regieConflicts(draft, docs = []) {
  if (draft?.kind !== 'rechnung' || draft.source?.type !== 'regie' || !draft.source.key) return []
  const other = docs.find((d) => d.id !== draft.id && d.kind === 'rechnung' && d.source?.key === draft.source.key && d.number && !isCancelled(d, docs))
  return other ? [`Der Regiebericht ${draft.source.no || ''} ist schon mit ${other.number} verrechnet: diesen Entwurf löschen.`.replace('  ', ' ')] : []
}

// ---------------------------------------------------------------- Preise und Positionen

/**
 * Regiestundensatz: eigener Satz des Kunden, sonst aktiver Artikel „Regiestunde …“, sonst die Einstellung
 * „Regiestundensatz“, sonst der Stundensatz des Kunden nach Aufwand. → { rate, source } (source '' = fehlt).
 */
export function regieRate({ customer = null, articles = [], settings = {} } = {}) {
  const own = num(customer?.regieRate)
  if (own > 0) return { rate: round2(own), source: 'kunde' }
  const art = articles.find((a) => articleActive(a) && /^regiestunde/.test(norm(a.name)) && num(a.price) > 0)
  if (art) return { rate: round2(num(art.price)), source: 'artikel', vat: art.vat, articleNo: art.articleNo || '' }
  const set = num(settings?.regieRate)
  if (set > 0) return { rate: round2(set), source: 'einstellung' }
  const hour = num(customer?.hourRate)
  if (hour > 0) return { rate: round2(hour), source: 'aufwand' }
  return { rate: 0, source: '' }
}

/**
 * Verkaufspreis einer Material-Zeile: Artikel der Fakturierung mit gleicher Artikelnummer oder gleichem Namen (Preis,
 * Steuersatz), sonst Einkaufspreis des Lagerartikels plus Aufschlag (markup in %, wie bei der Weiterverrechnung).
 * → { price, vat?, articleNo?, source: 'artikel' | 'einkauf' | '' }
 */
export function materialPrice(line, { stock = [], articles = [], markup = 10 } = {}) {
  const ma = line.articleId ? stock.find((a) => a.id === line.articleId) : null
  const name = norm(line.text || ma?.name)
  const no = norm(ma?.articleNo)
  const fa = articles.filter(articleActive).find((a) => (no && norm(a.articleNo) === no) || (name && (norm(a.name) === name || norm(ma?.name) === norm(a.name))))
  if (fa && num(fa.price) > 0) return { price: round2(num(fa.price)), ...(fa.vat !== undefined && fa.vat !== '' ? { vat: Number(fa.vat) } : {}), ...(fa.articleNo ? { articleNo: fa.articleNo } : {}), source: 'artikel' }
  if (ma && num(ma.price) > 0) return { price: round2(num(ma.price) * (1 + Math.max(0, num(markup)) / 100)), source: 'einkauf' }
  return { price: 0, source: '' }
}

/** Zeiten der Personen als Text für die Rechnung: „Ana 08:00–12:00 (4:00), Ben 08:00–11:30 (3:30)“. */
export function workersText(r, names = 'vorname') {
  return (r.workers || [])
    .map((w, i) => {
      const min = workerMinutes(w)
      if (!min) return ''
      const who = personName(w.name, names) || `Person ${i + 1}`
      return `${who} ${clockMinutes(w.from) !== null && clockMinutes(w.to) !== null ? `${w.from}–${w.to} ` : ''}(${durationText(min)})`
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * Positionen für den Rechnungsentwurf: Textzeile mit Nummer, Datum, Leistung und Auftrag; Regiestunden (Summe aller
 * Personen, Zeiten als Langtext); je Material eine Position mit Verkaufspreis. → { lines, missing: [Texte ohne Preis],
 * rateMissing, hours }
 */
export function regieLines({ report: r, objectName = '', rate = 0, vat = 20, newId, names = 'vorname', stock = [], articles = [], markup = 10, rateInfo = null }) {
  const lines = []
  const t = regieTotals(r)
  const kind = REGIE_KINDS[r.kind] || 'Sonderleistung'
  const head = [`Regiebericht ${r.no || ''} vom ${deDate(r.date)}`.replace('  ', ' '), r.title || kind, r.orderedBy ? `beauftragt von ${r.orderedBy}${r.orderedRole ? ` (${r.orderedRole})` : ''}` : '', r.orderRef ? `Auftrag ${r.orderRef}` : ''].filter(Boolean).join(', ')
  lines.push({ id: newId(), type: 'text', text: head })
  if (t.minutes > 0) {
    const long = workersText(r, names)
    lines.push({ id: newId(), text: `Regiestunden ${kind}${objectName ? ` – ${objectName}` : ''}`, ...(long ? { longText: long } : {}), ...(rateInfo?.articleNo ? { articleNo: rateInfo.articleNo } : {}), qty: t.hours, unit: 'Std.', price: round2(rate), vat: rateInfo?.vat ?? vat, discount: 0 })
  }
  const missing = []
  for (const m of r.material || []) {
    const p = materialPrice(m, { stock, articles, markup })
    const label = text(m.text) || stock.find((a) => a.id === m.articleId)?.name || 'Material'
    if (!p.price) missing.push(label)
    lines.push({ id: newId(), text: `Material: ${label}`, ...(p.articleNo ? { articleNo: p.articleNo } : {}), qty: r3(num(m.qty)), unit: text(m.unit) || 'Stk', price: p.price, vat: p.vat ?? vat, discount: 0 })
  }
  return { lines, missing, rateMissing: t.minutes > 0 && !(rate > 0), hours: t.hours }
}

// ---------------------------------------------------------------- Einfrieren (Beilage, PDF)

/**
 * Bericht für PDF und Beilage: ohne Fotos (nur die Anzahl), ohne interne Kennungen, Namen der eigenen Leute wie
 * eingestellt gekürzt. object { name, address }.
 */
export function freezeRegie(r, { object = {}, names = 'vorname' } = {}) {
  const photos = r.photos || []
  return {
    no: r.no || '',
    date: r.date || '',
    kind: r.kind || '',
    title: r.title || '',
    description: r.description || '',
    orderedBy: r.orderedBy || '',
    orderedRole: r.orderedRole || '',
    orderRef: r.orderRef || '',
    object: { name: object.name || '', address: object.address || '' },
    names,
    workers: (r.workers || []).map((w) => ({ ...(personName(w.name, names) ? { name: personName(w.name, names) } : {}), from: w.from || '', to: w.to || '', pause: Math.round(num(w.pause)) || 0, minutes: workerMinutes(w) })),
    material: (r.material || []).map((m) => ({ text: m.text || '', qty: r3(num(m.qty)), unit: m.unit || '' })),
    photos: { vorher: photos.filter((p) => p.phase === 'vorher').length, nachher: photos.filter((p) => p.phase !== 'vorher').length },
    signature: r.signature ? { name: r.signature.name || '', role: r.signature.role || '', svg: r.signature.svg || '', at: r.signature.at || '' } : null,
    unsigned: r.unsigned ? { reason: r.unsigned.reason || '' } : null,
    closedAt: r.closedAt || '',
  }
}

/** Material-Zeilen mit Lagerartikel für die Ausgabe aus dem Lager (core/material.js → issueMoves). */
export const stockLines = (r) => (r.material || []).filter((m) => m.articleId && num(m.qty) > 0).map((m) => ({ articleId: m.articleId, qty: r3(num(m.qty)) }))

/** Pfad im SharePoint-Ordner: regie/nachweise/2026/RB-2026-0001_Wohnanlage-Lehen_2026-11-05 (ohne Endung). */
export const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
export const regieBase = (r, objectName = '') => `regie/nachweise/${String(r.date || '').slice(0, 4) || 'ohne-Jahr'}/${fileSafe(r.no) || r.id}_${fileSafe(objectName) || 'Objekt'}_${r.date || ''}`
