// Mattenwechsel abrechnen (P14, docs/MATTENWECHSEL-PLAN.md Abschnitte 3.2, 5.1 Punkt 5 und 9): Rechnungsentwürfe aus den
// bestätigten Lieferscheinen des Mattenwechsels – über die vorhandene Fakturierung, ohne zweite Rechnungslogik. Rein
// rechnend, ohne Oberfläche (Tests: test/matten-abrechnung.test.js; Oberfläche: ui/views/invoicing-mattenabrechnung.js).
//
// Preismodell je Kunde (customers[].matten über mattenOf, Entscheidung E4):
//  wechsel    je gewechselter Matte: Einzel = ein Entwurf je Lieferschein, Sammel = collectDraft über die offenen
//             Lieferscheine des Kunden im Zeitraum (Positionen mit den beim Lieferschein eingefrorenen Preisen, nichts wird
//             neu gerechnet; Leistungszeitraum, deliveryNotes[]).
//  pauschale  Pauschale je Monat (monthlyFlats: je Liegeplatz, Objekt oder Kunde): ein Entwurf je Kunde und Zeitraum mit
//             einer Position je Monat und Pauschale (Quartal: drei Monatspositionen), source.key der Position
//             'matten-pauschale:<Kunde>:<JJJJ-MM>' – ein Monat wird je Kunde nur einmal pauschal verrechnet. Die Lieferscheine
//             der Monate hängen ohne Stückpreise als Nachweis an (deliveryNotes[], damit sie als verrechnet gelten).
// Zeitraum: Monat des Laufs (Vorgabe Vormonat); quartalsweise Kunden mit dem Lauf des letzten Quartalsmonats.
//
// Datenmodell (alle Felder optional, nicht in der Prüfsumme – FIXED_FIELDS bleibt unverändert):
//  documents[].source { type: 'matten-abrechnung', key, customerId, model: 'wechsel' | 'pauschale', billing: 'einzel' |
//                  'sammel', interval: 'monat' | 'quartal', period { from, to, label }, months [JJJJ-MM], notes [Beleg-IDs],
//                  run { ym, at, by } }  Rechnungsentwurf aus dem Abrechnungslauf
//  documents[].lines[].source { type: 'matten-pauschale', key: 'matten-pauschale:<Kunde>:<JJJJ-MM>', month, objectId,
//                  placementId, scope }  Position der Pauschale (Zeilen zählen zur Prüfsumme: nur in neuen Belegen)
//  documents[].review { checkedAt, checkedBy, releasedAt, releasedBy }  Prüfen → Freigeben (nur Entwürfe aus dem Lauf);
//                  „Ausgestellt“ = festgeschrieben. Korrekturen am Entwurf stehen im Verlauf (documents[].history).
//  settings.mattenRun { suggest }  „Rechnungsentwürfe am Monatsersten vorschlagen“ (Zu erledigen, digitaler Mitarbeiter)
//
// Doppelabrechnung: Ein Lieferschein (deliveryNotes[] bzw. refId), eine Lieferscheinposition (lines[].source.key) und ein
// Pauschal-Monat stehen höchstens in einer nicht stornierten Rechnung. Offen ist, was in keiner Rechnung steht; im
// Entwurf heißt vergeben, verrechnet erst mit dem Festschreiben. Ein gelöschter Entwurf und ein Storno geben frei. Vor
// dem Festschreiben prüft mattenConflicts alles noch einmal (auch zwischen Einzel und Sammel, Pauschale und Stück).

import { collectDraft, customerName, deDate, defaultTexts, dueDateFor, lineType, mattenOf, MATTEN_BILLING, MATTEN_INTERVALS, MATTEN_PRICE_MODELS, monthLabel, monthlyFlats, parseNumber, problems, recipientOf, round2, settingsOf, termsSetup, totals } from './invoicing.js'

export const NOTE_TYPE = 'matten' // Lieferschein aus dem Mattenwechsel (core/matten-lieferschein.js)
export const RUN_TYPE = 'matten-abrechnung' // Rechnungsentwurf aus dem Abrechnungslauf
export const FLAT_TYPE = 'matten-pauschale' // Position einer Pauschale je Monat
export const BILL_STATES = { offen: 'offen', entwurf: 'im Entwurf', verrechnet: 'verrechnet' }
export const REVIEW_STEPS = { entwurf: 'Entwurf', geprueft: 'Geprüft', freigegeben: 'Freigegeben', ausgestellt: 'Ausgestellt' }

const text = (v) => String(v ?? '').trim()
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const num = (n) => String(round2(n)).replace('.', ',')
const eur = (n) => `${round2(n).toFixed(2).replace('.', ',')} €`
const isYm = (ym) => /^\d{4}-\d{2}$/.test(String(ym || ''))
const ymOf = (iso) => String(iso || '').slice(0, 7)
const uniq = (list) => [...new Set(list)]

// ---------------------------------------------------------------- Zeitraum

/** Monat ± n: '2026-11' → '2026-10' (n = -1). */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
/** Letzter Tag eines Monats: '2026-02' → '2026-02-28'. */
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
/** Vormonat (Vorgabe des Laufs): am 9.11.2026 → '2026-10'. */
export const prevMonth = (today) => addMonths(ymOf(today), -1)
/** Monate des Quartals, in dem ym liegt: '2026-11' → ['2026-10', '2026-11', '2026-12']. */
export function quarterMonths(ym) {
  const first = Math.floor((Number(ym.slice(5, 7)) - 1) / 3) * 3 + 1
  return [0, 1, 2].map((i) => `${ym.slice(0, 4)}-${String(first + i).padStart(2, '0')}`)
}
const monthsBetween = (from, to) => {
  const out = []
  for (let m = from; m <= to && out.length < 240; m = addMonths(m, 1)) out.push(m)
  return out
}

/**
 * Abrechnungszeitraum je Kunde im Lauf für den Monat ym: monatlich der Monat; quartalsweise das Quartal, abgerechnet mit
 * dem Lauf seines letzten Monats (complete). { interval, from, to, months, label, complete, billMonth }.
 */
export function periodFor(interval, ym) {
  if (interval === 'quartal') {
    const months = quarterMonths(ym)
    const q = Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1
    return { interval, from: `${months[0]}-01`, to: monthEnd(months[2]), months, label: `${q}. Quartal ${ym.slice(0, 4)}`, complete: ym === months[2], billMonth: months[2] }
  }
  return { interval: 'monat', from: `${ym}-01`, to: monthEnd(ym), months: [ym], label: monthLabel(ym), complete: true, billMonth: ym }
}

// ---------------------------------------------------------------- Belege und Zustand

/** Festgeschriebener Lieferschein aus dem Mattenwechsel (nicht storniert). */
export const isMattenNote = (d) => d?.kind === 'lieferschein' && d.source?.type === NOTE_TYPE && !!d.number && d.status !== 'storniert' && !d.cancelledAt
const isItem = (l) => lineType(l) === 'item'
/** Positionen des Lieferscheins mit Schlüssel (je Liegeplatz und Mattentyp). */
export const noteLineKeys = (note) => (note?.lines || []).filter((l) => isItem(l) && l.source?.type === NOTE_TYPE && l.source.key).map((l) => l.source.key)
/** Gewechselte Matten eines Lieferscheins (Summe der Stückzahlen). */
export const notePieces = (note) => (note?.lines || []).filter((l) => isItem(l) && l.source?.type === NOTE_TYPE).reduce((s, l) => s + parseNumber(l.qty), 0)
/** Netto der Positionen eines Lieferscheins mit den eingefrorenen Preisen (wie in der Rechnung, ohne Rabatt auf alles). */
export const noteNet = (note) => totals({ lines: note?.lines || [] }, {}).net
/** Positionen ohne Preis (Mattentyp fehlte beim Erstellen in der Fakturierung): [{ text, line }]. */
export const missingPrices = (note) => (note?.lines || []).filter((l) => isItem(l) && l.source?.type === NOTE_TYPE && l.source.price === 'fehlt').map((line) => ({ text: text(line.text) || 'Matte', line }))
/** Schlüssel der Pauschale eines Monats. */
export const flatKey = (customerId, ym) => `${FLAT_TYPE}:${customerId}:${ym}`

/** Stornierte Rechnungen (ein festgeschriebenes Storno bezieht sich auf sie). */
const cancelledIds = (docs) => new Set(docs.filter((x) => x?.kind === 'storno' && x.number && x.refId).map((x) => x.refId))

/**
 * Wo stehen Lieferscheine, Positionen und Pauschal-Monate? Nur nicht stornierte Rechnungen (Entwurf oder festgeschrieben):
 * { notes: Map Lieferschein → [Rechnung], lines: Map Positionsschlüssel → [Rechnung], flats: Map Pauschal-Schlüssel → [Rechnung] }.
 */
export function billingIndex(docs = [], { except = '' } = {}) {
  const gone = cancelledIds(docs)
  const out = { notes: new Map(), lines: new Map(), flats: new Map() }
  const add = (map, k, d) => {
    if (!k) return
    const list = map.get(k) || []
    if (!list.includes(d)) list.push(d)
    map.set(k, list)
  }
  for (const d of docs) {
    if (d?.kind !== 'rechnung' || d.id === except || gone.has(d.id)) continue
    for (const n of d.deliveryNotes || []) add(out.notes, n?.id, d)
    if (d.refId) add(out.notes, d.refId, d)
    for (const l of d.lines || []) {
      if (l.source?.type === NOTE_TYPE) add(out.lines, l.source.key, d)
      else if (l.source?.type === FLAT_TYPE) add(out.flats, l.source.key, d)
    }
  }
  return out
}

const stateOfHits = (hits) => {
  const fixed = hits.find((d) => d.number)
  if (fixed) return { state: 'verrechnet', docId: fixed.id, number: fixed.number, date: fixed.date || '' }
  const draft = hits.find((d) => !d.number)
  if (draft) return { state: 'entwurf', docId: draft.id }
  return { state: 'offen' }
}

/** Zustand eines Lieferscheins: offen | entwurf | verrechnet (über den Lieferschein und jede seiner Positionen). */
export function noteBillState(note, docs = [], index = billingIndex(docs)) {
  const hits = uniq([...(index.notes.get(note.id) || []), ...noteLineKeys(note).flatMap((k) => index.lines.get(k) || [])])
  return stateOfHits(hits)
}

/** Zustand der Pauschale eines Kunden für einen Monat. */
export const flatBillState = (customerId, ym, docs = [], index = billingIndex(docs)) => stateOfHits(index.flats.get(flatKey(customerId, ym)) || [])

// ---------------------------------------------------------------- Namen (aus den Lieferscheinen, ohne Recht auf den Mattenwechsel)

/**
 * Namen der Objekte und Liegeplätze aus den Lieferscheinen (die Buchhaltung liest den Mattenwechsel nicht):
 * { objects: Map objectId → Name, placements: Map placementId → Name }. Liegeplatz = Titelzeile „Liegeplatz …“ über seinen
 * Positionen.
 */
export function namesFromNotes(notes = []) {
  const objects = new Map()
  const placements = new Map()
  for (const n of notes) {
    if (n.objectId && text(n.objectName) && !objects.has(n.objectId)) objects.set(n.objectId, text(n.objectName))
    let title = ''
    for (const l of n.lines || []) {
      if (lineType(l) === 'title') title = text(l.text).replace(/^Liegeplatz\s+/, '')
      else if (isItem(l) && l.source?.placementId && title && !placements.has(l.source.placementId)) placements.set(l.source.placementId, title)
    }
  }
  return { objects, placements }
}

const nameOf = (map, id) => (map instanceof Map ? map.get(id) : map?.[id]) || ''

/** Wofür gilt eine Pauschale? „Liegeplatz Haupteingang (EG), Wohnanlage …“, „Wohnanlage … (alle Liegeplätze)“ bzw. „alle Liegeplätze“. */
export function flatScope(item, names = {}) {
  const obj = item.objectId ? nameOf(names.objects, item.objectId) : ''
  if (item.placementId) return `Liegeplatz ${nameOf(names.placements, item.placementId) || 'ohne Namen'}${obj ? `, ${obj}` : ''}`
  if (item.objectId) return `${obj || 'Objekt'} (alle Liegeplätze)`
  return 'alle Liegeplätze'
}

// ---------------------------------------------------------------- Lauf planen (Vorschau je Kunde)

const noteMonthOf = (n) => ymOf(n.date || n.serviceFrom)
const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number))
const groupKey = (n) => n.customerId || `name:${text(n.recipient?.name) || 'ohne Kunde'}`

/**
 * Vorschau des Laufs für den Monat ym: je Kunde mit Mattenwechsel-Lieferscheinen ein Plan
 * { key, customerId, customer, name, customerNo, model, billing, interval, period, notes (offen, abzurechnen), older (offen,
 *   vor dem Zeitraum, nicht dabei), pending (offen, Quartal läuft noch), months (Pauschale), billed [{ text, docId, number }],
 *   drafts [{ kind: 'einzel' | 'sammel' | 'pauschale', notes, months, doc, net, gross, errors, warnings }], hints
 *   [{ level: 'error' | 'warn' | 'info', text }], net, ready (Zahl der Entwürfe ohne Fehler) }.
 * fak: Fakturierung ({ documents, customers, articles, customerPrices, settings, paymentTerms, textBlocks }).
 * includeOlder: offene Lieferscheine vor dem Zeitraum mitnehmen (je gewechselter Matte; bei der Pauschale nur aus Monaten,
 * die schon pauschal verrechnet sind). names: weitere Namen { objects, placements } (sonst aus den Lieferscheinen).
 * Liefert { ym, plans, todo (mit etwas abzurechnen), done (nichts mehr offen), count, drafts, net }.
 */
export function planRun(fak = {}, { ym, today = '', includeOlder = true, names = {}, date = today, now = '', by = '' } = {}) {
  if (!isYm(ym)) throw new Error('Monat fehlt.')
  const docs = fak.documents || []
  const index = billingIndex(docs)
  const customers = new Map((fak.customers || []).map((c) => [c.id, c]))
  const all = docs.filter(isMattenNote).sort(byDate)
  const fromNotes = namesFromNotes(all)
  const merged = { objects: new Map([...fromNotes.objects, ...toEntries(names.objects)]), placements: new Map([...fromNotes.placements, ...toEntries(names.placements)]) }
  const groups = new Map()
  for (const n of all) groups.set(groupKey(n), [...(groups.get(groupKey(n)) || []), n])
  const plans = []
  for (const [key, notes] of groups) plans.push(planCustomer(fak, { key, notes, customer: customers.get(notes[0].customerId) || null, ym, index, includeOlder, names: merged, date: date || today, now, by }))
  plans.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const todo = plans.filter((p) => p.drafts.length || p.notes.length || p.older.length || p.pending.length)
  const done = plans.filter((p) => !todo.includes(p) && p.billed.length)
  const ready = todo.flatMap((p) => p.drafts.filter((d) => !d.errors.length))
  return { ym, plans, todo, done, names: merged, count: todo.filter((p) => p.ready).length, drafts: ready.length, net: round2(ready.reduce((s, d) => s + d.net, 0)) }
}

const toEntries = (m) => (m instanceof Map ? [...m] : Object.entries(m || {}))

function planCustomer(fak, { key, notes, customer, ym, index, includeOlder, names, date, now, by }) {
  const m = mattenOf(customer)
  const period = periodFor(m.billingInterval, ym)
  const customerId = customer?.id || notes[0].customerId || ''
  const plan = {
    key,
    customerId,
    customer,
    name: customer ? customerName(customer) : text(notes[0].recipient?.name) || 'ohne Kunde',
    customerNo: customer?.customerNo || text(notes[0].recipient?.customerNo),
    model: m.priceModel,
    billing: m.billing,
    interval: m.billingInterval,
    period,
    notes: [],
    older: [],
    pending: [],
    months: [],
    billed: [],
    drafts: [],
    hints: [],
    net: 0,
    ready: 0,
  }
  const hint = (level, t) => plan.hints.push({ level, text: t })
  const state = new Map(notes.map((n) => [n.id, noteBillState(n, [], index)]))
  const open = notes.filter((n) => state.get(n.id).state === 'offen')
  const inPeriod = open.filter((n) => n.date >= period.from && n.date <= period.to)
  const before = open.filter((n) => n.date < period.from)
  for (const n of notes) {
    const st = state.get(n.id)
    if (st.state !== 'offen' && n.date >= period.from && n.date <= period.to) plan.billed.push({ text: `${n.number} vom ${deDate(n.date)}`, docId: st.docId, number: st.number || '', state: st.state })
  }
  if (!customer) hint('error', `Kunde „${plan.name}“ ist nicht in der Fakturierung: zuerst anlegen (Kunden), dann abrechnen.`)
  else if (!text(customer.customerNo)) hint('warn', 'Kunde ohne Kundennummer.')
  if (!period.complete) {
    plan.pending = inPeriod
    plan.older = before
    if (inPeriod.length) hint('info', `Quartalsweise: abgerechnet mit dem Lauf für ${monthLabel(period.billMonth)}.`)
    if (before.length) hint('warn', `${plural(before.length, 'offener Lieferschein', 'offene Lieferscheine')} aus einem früheren Quartal: Lauf für ${uniq(before.map((n) => monthLabel(periodFor('quartal', noteMonthOf(n)).billMonth))).join(', ')} wählen.`)
    return finishPlan(plan)
  }
  if (m.priceModel === 'pauschale') planFlat(fak, plan, { inPeriod, before, notes, index, includeOlder })
  else {
    plan.notes = includeOlder ? [...before, ...inPeriod].sort(byDate) : inPeriod
    if (!includeOlder) plan.older = before
    else if (before.length) hint('info', `${plural(before.length, 'offener Lieferschein', 'offene Lieferscheine')} aus früheren Monaten (${uniq(before.map((n) => monthLabel(noteMonthOf(n)))).join(', ')}) mit dabei.`)
    const specs = m.billing === 'einzel' ? plan.notes.map((n) => ({ kind: 'einzel', notes: [n], months: [] })) : plan.notes.length ? [{ kind: 'sammel', notes: plan.notes, months: [] }] : []
    plan.drafts = specs.map((s) => ({ ...s, errors: wechselErrors(s.notes, customerId, index), warnings: [] }))
  }
  if (plan.older.length) {
    const when = uniq(plan.older.map((n) => monthLabel(noteMonthOf(n)))).join(', ')
    const what = plural(plan.older.length, 'offener Lieferschein', 'offene Lieferscheine')
    hint('warn', plan.model === 'pauschale' && includeOlder ? `${what} aus ${when}: Monat nicht pauschal verrechnet – Lauf für diesen Monat wählen oder von Hand verrechnen.` : `${what} vor dem Zeitraum (${when}) nicht dabei: „ältere mitnehmen“ einschalten oder Lauf für diesen Monat wählen.`)
  }
  // Entwürfe bauen (Vorschau: Beträge und Pflichtangaben wie später beim Festschreiben)
  plan.drafts.forEach((d, i) => {
    if (!customer) d.errors.push('Kunde fehlt in der Fakturierung.')
    d.doc = buildDraft(fak, plan, d, { id: `mwr-${i + 1}`, date, now, by, names })
    const t = totals(d.doc, settingsOf(fak))
    d.net = t.net
    d.gross = t.gross
    for (const p of customer ? problems(d.doc, settingsOf(fak)) : []) if (p.level !== 'info') d.warnings.push(`${p.text}${p.level === 'error' ? ' Vor dem Festschreiben im Entwurf ergänzen.' : ''}`)
  })
  for (const d of plan.drafts) for (const e of d.errors) hint('error', e)
  for (const w of uniq(plan.drafts.flatMap((d) => d.warnings))) hint('warn', w)
  if (customer && !text(customer.email)) hint('info', 'Keine E-Mail für Rechnungen: Versand per Post (Sammel-PDF).')
  if (customer?.reverseCharge) hint('info', 'Reverse Charge (Kunde erbringt selbst Bauleistungen).')
  return finishPlan(plan)
}

function finishPlan(plan) {
  plan.hints = plan.hints.filter((h, i, all) => all.findIndex((x) => x.text === h.text) === i)
  plan.net = round2(plan.drafts.filter((d) => !d.errors.length).reduce((s, d) => s + (d.net || 0), 0))
  plan.ready = plan.drafts.filter((d) => !d.errors.length).length
  return plan
}

/** Fehler eines Entwurfs je gewechselter Matte: Preis fehlt; Monat schon pauschal verrechnet (Pauschale und Stück). */
function wechselErrors(notes, customerId, index) {
  const out = []
  for (const n of notes) {
    const miss = missingPrices(n)
    if (miss.length) out.push(`${n.number}: Preis fehlt für ${uniq(miss.map((x) => `„${x.text}“`)).join(', ')} (Mattentyp bzw. Preis in der Fakturierung fehlte). Den Lieferschein von Hand verrechnen („→ Rechnung“, Preis im Entwurf eintragen).`)
    const flat = stateOfHits(index.flats.get(flatKey(customerId, noteMonthOf(n))) || [])
    if (flat.state !== 'offen') out.push(`${n.number}: ${monthLabel(noteMonthOf(n))} ist schon pauschal verrechnet${flat.number ? ` (${flat.number})` : ' (Entwurf)'} – nicht zusätzlich je Matte.`)
  }
  return out
}

function planFlat(fak, plan, { inPeriod, before, notes, index, includeOlder }) {
  const { items } = monthlyFlats(fak, plan.customerId)
  const first = notes.length ? noteMonthOf(notes[0]) : plan.period.months[0]
  const months = []
  for (const ym of plan.period.months) {
    if (ym < first) continue
    const st = flatBillState(plan.customerId, ym, [], index)
    if (st.state === 'offen') months.push(ym)
    else plan.billed.push({ text: `Pauschale ${monthLabel(ym)}`, docId: st.docId, number: st.number || '', state: st.state })
  }
  // Lieferscheine als Nachweis: aus den Monaten dieses Entwurfs und aus schon pauschal verrechneten Monaten. Schon je Matte
  // verrechnete (Preismodell im Monat gewechselt) nicht: sie stehen schon auf einer Rechnung (Entscheidung 9.11.2026: der
  // Wechselmonat gilt ganz als Pauschale, die Rechnung je Matte gutschreiben – Hinweis unten)
  const pieceDocs = (n) => uniq(noteLineKeys(n).flatMap((k) => index.lines.get(k) || []))
  const covered = (n) => (months.includes(noteMonthOf(n)) || flatBillState(plan.customerId, noteMonthOf(n), [], index).state !== 'offen') && !pieceDocs(n).length
  const attach = [...(includeOlder ? before.filter(covered) : []), ...inPeriod.filter(covered)].sort(byDate)
  plan.older = before.filter((n) => !attach.includes(n))
  plan.months = months
  plan.notes = attach
  if (!months.length) {
    if (attach.length) plan.hints.push({ level: 'info', text: `${plural(attach.length, 'Lieferschein', 'Lieferscheine')} aus schon pauschal verrechneten Monaten: kommt mit der nächsten Pauschale als Nachweis dazu.` })
    plan.notes = []
    plan.pending = attach
    return
  }
  const errors = items.length ? [] : ['Preismodell Pauschale, aber keine Pauschale eingetragen (Kundenblatt → Mattenwechsel).']
  plan.drafts = [{ kind: 'pauschale', notes: attach, months, errors, warnings: [] }]
  if (!inPeriod.length) plan.hints.push({ level: 'info', text: `Keine Lieferscheine im ${plan.period.label}: die Pauschale gilt trotzdem.` })
  // Preismodell gewechselt: Lieferscheine eines Monats schon je Matte verrechnet (Rechnung oder Entwurf mit ihren Positionen)
  const byPiece = (ym) => uniq(notes.filter((n) => noteMonthOf(n) === ym).flatMap((n) => noteLineKeys(n).flatMap((k) => index.lines.get(k) || [])))
  for (const ym of months) {
    const docs = byPiece(ym)
    if (docs.length) plan.hints.push({ level: 'warn', text: `${monthLabel(ym)}: Preismodell im Monat gewechselt – der ganze Monat gilt als Pauschale. Lieferscheine dieses Monats stehen schon je Matte auf ${docs.map((d) => d.number || 'Entwurf').join(', ')}: diese Rechnung gutschreiben (Entwurf löschen), sonst ist der Monat doppelt verrechnet.` })
  }
  // unverrechnete Monate davor (seit dem ersten Lieferschein, höchstens ein Jahr zurück), ohne die schon je Matte verrechneten
  const gap = monthsBetween(first > addMonths(plan.period.months[0], -12) ? first : addMonths(plan.period.months[0], -12), addMonths(plan.period.months[0], -1)).filter((ym) => flatBillState(plan.customerId, ym, [], index).state === 'offen' && !byPiece(ym).length)
  if (gap.length) plan.hints.push({ level: 'warn', text: `Pauschale noch nicht verrechnet: ${gap.map(monthLabel).join(', ')} (Lauf für diesen Monat wählen).` })
}

// ---------------------------------------------------------------- Entwurf bauen

const sameOr = (list, empty = '') => (list.length && list.every((v) => v === list[0]) ? list[0] : empty)

/** Kopf aus dem Kunden der Fakturierung (wie ein neuer Rechnungsentwurf): Empfänger, Zahlungsbedingung, Texte. */
function customerHead(fak, customer, date) {
  const s = settingsOf(fak)
  const terms = termsSetup(customer, fak.paymentTerms || [], s)
  const texts = defaultTexts('rechnung', s, fak.textBlocks || [])
  return {
    recipient: customer ? recipientOf(customer) : {},
    reverseCharge: !!customer?.reverseCharge,
    // Kundenpreise sind schon vereinbart, ein Kundenrabatt steht beim Standardpreis in der Position: kein Rabatt auf alles
    discount: 0,
    dueDate: dueDateFor(date, terms.days),
    ...(terms.termsId ? { termsId: terms.termsId } : {}),
    ...(terms.skonto ? { skonto: terms.skonto } : {}),
    intro: texts.intro,
    outro: texts.outro,
    reference: '',
    contactName: customer?.contacts?.length === 1 ? customer.contacts[0].name || '' : '',
  }
}

/**
 * Rechnungsentwurf zu einem geplanten Entwurf (spec aus planRun): je gewechselter Matte über collectDraft (Positionen und
 * Preise wie im Lieferschein), Pauschale mit einer Position je Monat und Pauschale plus Nachweis der Lieferscheine.
 */
export function buildDraft(fak, plan, spec, { id, date, now = '', by = '', names = {} }) {
  const head = customerHead(fak, plan.customer, date)
  const notes = spec.notes
  const objectIds = uniq(notes.map((n) => n.objectId || ''))
  const addresses = uniq(notes.map((n) => text(n.deliveryAddress)))
  const runInfo = { ym: plan.period.billMonth, ...(now ? { at: now } : {}), ...(by ? { by } : {}) }
  const source = {
    type: RUN_TYPE,
    key: spec.kind === 'einzel' ? `${RUN_TYPE}:${notes[0].id}` : `${RUN_TYPE}:${plan.customerId}:${spec.kind === 'pauschale' ? spec.months[0] : plan.period.from.slice(0, 7)}`,
    customerId: plan.customerId,
    model: plan.model,
    billing: plan.billing,
    interval: plan.interval,
    period: { from: plan.period.from, to: plan.period.to, label: plan.period.label },
    ...(spec.months.length ? { months: [...spec.months] } : {}),
    notes: notes.map((n) => n.id),
    run: runInfo,
  }
  const how = plan.model === 'pauschale' ? MATTEN_PRICE_MODELS.pauschale : `${MATTEN_PRICE_MODELS.wechsel}, ${MATTEN_BILLING[plan.billing]}`
  const history = [{ at: now, by, text: `Entwurf aus dem Abrechnungslauf Mattenwechsel ${plan.period.label} (${how})` }]
  if (spec.kind !== 'pauschale') {
    const base = collectDraft(notes, { id, date })
    const many = notes.length > 1
    const lines = base.lines.map((l) => {
      if (!many || lineType(l) !== 'title' || !/^Lieferschein /.test(l.text || '')) return l
      const n = notes.find((x) => l.text.startsWith(`Lieferschein ${x.number} `))
      return n?.objectName && objectIds.length > 1 ? { ...l, text: `${l.text}, ${n.objectName}` } : l
    })
    return {
      ...base,
      ...head,
      customerId: plan.customerId,
      objectId: sameOr(objectIds),
      objectName: objectIds.length === 1 ? text(notes[0].objectName) : '',
      deliveryAddress: sameOr(addresses),
      title: spec.kind === 'einzel' ? `Mattenwechsel ${text(notes[0].objectName) || plan.name} am ${deDate(notes[0].date)}` : `Mattenwechsel ${plan.period.label}`,
      lines,
      source,
      history,
      createdAt: now,
      createdBy: by,
    }
  }
  // Pauschale je Monat
  const s = settingsOf(fak)
  const { items } = monthlyFlats(fak, plan.customerId)
  const lines = []
  let n = 0
  const lid = () => `${id}-${++n}`
  const several = items.length > 1
  for (const ym of spec.months) {
    if (several) lines.push({ id: lid(), type: 'title', text: monthLabel(ym) })
    for (const it of items) {
      const scope = flatScope(it, names)
      lines.push({
        id: lid(),
        type: 'item',
        text: several ? `Mattenwechsel Pauschale: ${scope}` : `Mattenwechsel Pauschale ${monthLabel(ym)}`,
        ...(several ? {} : { longText: scope }),
        qty: 1,
        unit: 'Monat',
        price: it.amount,
        vat: Number.isFinite(it.vat) ? it.vat : s.vat,
        discount: 0,
        source: { type: FLAT_TYPE, key: flatKey(plan.customerId, ym), month: ym, ...(it.objectId ? { objectId: it.objectId } : {}), ...(it.placementId ? { placementId: it.placementId } : {}), scope: it.placementId ? 'liegeplatz' : it.objectId ? 'objekt' : 'kunde' },
      })
    }
  }
  if (notes.length) {
    lines.push({ id: lid(), type: 'title', text: 'Nachweis: Lieferscheine (in der Pauschale enthalten)' })
    for (const x of notes) lines.push({ id: lid(), type: 'text', text: `${x.number} vom ${deDate(x.date)}${x.objectName ? `, ${x.objectName}` : ''}: ${plural(notePieces(x), 'Matte', 'Matten')} gewechselt` })
  }
  const flatObjects = uniq(items.map((it) => it.objectId || ''))
  const objs = uniq([...objectIds, ...flatObjects].filter(Boolean))
  return {
    id,
    kind: 'rechnung',
    status: 'entwurf',
    date,
    serviceFrom: `${spec.months[0]}-01`,
    serviceTo: monthEnd(spec.months.at(-1)),
    ...head,
    customerId: plan.customerId,
    objectId: objs.length === 1 && !flatObjects.includes('') ? objs[0] : '',
    objectName: objs.length === 1 ? nameOf(names.objects, objs[0]) : '',
    deliveryAddress: sameOr(addresses),
    title: `Mattenwechsel ${plan.period.label} (Pauschale)`,
    deliveryNotes: notes.map((x) => ({ id: x.id, number: x.number, date: x.date })),
    lines,
    source,
    history,
    createdAt: now,
    createdBy: by,
  }
}

/**
 * Entwürfe des Laufs anlegen (nur Entwürfe: nie festschreiben oder senden). fak: aktueller Stand der Fakturierung (vorher
 * frisch geholt). keys: nur diese Kunden (Plan-Schlüssel); ohne: alle ohne Fehler. Prüft gegen den aktuellen Stand:
 * was inzwischen in einem anderen Entwurf oder einer Rechnung steht, kommt nicht noch einmal.
 * Liefert { drafts: [Beleg], plans, skipped: [{ name, reason }] }.
 */
export function createDrafts(fak = {}, { ym, today = '', date = today, includeOlder = true, names = {}, keys = null, newId, now = '', by = '' } = {}) {
  const run = planRun(fak, { ym, today, includeOlder, names, date, now, by })
  const drafts = []
  const skipped = []
  for (const plan of run.todo) {
    if (keys && !keys.includes(plan.key)) continue
    for (const spec of plan.drafts) {
      if (spec.errors.length) {
        skipped.push({ name: plan.name, reason: spec.errors[0] })
        continue
      }
      drafts.push(buildDraft(fak, plan, spec, { id: newId(), date, now, by, names: run.names }))
    }
  }
  return { drafts, plans: run.todo, skipped }
}

// ---------------------------------------------------------------- Prüfen → Freigeben → Ausstellen

/** Entwurf aus dem Abrechnungslauf (mit den Schritten Geprüft und Freigegeben)? */
export const needsReview = (d) => d?.kind === 'rechnung' && d.source?.type === RUN_TYPE
/** Schritt: entwurf | geprueft | freigegeben | ausgestellt (= festgeschrieben). */
export function reviewStep(d) {
  if (d?.number) return 'ausgestellt'
  if (d?.review?.releasedAt) return 'freigegeben'
  if (d?.review?.checkedAt) return 'geprueft'
  return 'entwurf'
}
const logged = (d, at, by, t) => [...(d.history || []), { at, by, text: t }]

/** Als geprüft markieren (Beträge und Angaben stimmen). */
export function markChecked(d, { at, by = '' }) {
  if (d.number) throw new Error('Schon festgeschrieben.')
  return { ...d, review: { checkedAt: at, checkedBy: by }, history: logged(d, at, by, 'geprüft') }
}
/** Freigeben (danach festschreiben); erst nach „Geprüft“. */
export function markReleased(d, { at, by = '' }) {
  if (d.number) throw new Error('Schon festgeschrieben.')
  if (!d.review?.checkedAt) throw new Error('Erst prüfen, dann freigeben.')
  return { ...d, review: { ...d.review, releasedAt: at, releasedBy: by }, history: logged(d, at, by, 'freigegeben') }
}
/** Prüfung bzw. Freigabe zurücknehmen (wieder Entwurf). */
export function undoReview(d, { at, by = '', reason = '' }) {
  if (d.number || !d.review) return d
  const { review, ...rest } = d
  return { ...rest, history: logged(d, at, by, `${review.releasedAt ? 'Freigabe' : 'Prüfung'} zurückgenommen${reason ? `: ${reason}` : ''}`) }
}

// ---------------------------------------------------------------- Korrekturen protokollieren

const lineText = (l) => text(l.text) || 'ohne Bezeichnung'
const norm = (v) => text(v).replace(/\s+/g, ' ')
const numOf = (v) => round2(parseNumber(v))
const DOC_FIELDS = [
  ['date', 'Rechnungsdatum', (v) => deDate(v) || 'leer'],
  ['dueDate', 'Fällig am', (v) => deDate(v) || 'leer'],
  ['title', 'Betreff', (v) => `„${v}“`],
  ['intro', 'Einleitung', () => 'geändert'],
  ['outro', 'Schlusstext', () => 'geändert'],
  ['reference', 'Bestellnummer/Zeichen', (v) => `„${v}“`],
  ['deliveryAddress', 'Leistungsort', () => 'geändert'],
  ['objectId', 'Objekt', () => 'geändert'],
  ['termsId', 'Zahlungsbedingung', () => 'geändert'],
]

/**
 * Was hat sich am Entwurf geändert (before = gespeicherter Stand, after = neuer)? Liste kurzer Texte, leer wenn nichts.
 * Positionen nach Kennung: neu, entfernt, Bezeichnung, Menge, Einheit, Einzelpreis, Rabatt, USt; Reihenfolge.
 */
export function draftChanges(before, after) {
  if (!before || !after) return []
  const out = []
  for (const [k, label, fmt] of DOC_FIELDS) if (norm(before[k]) !== norm(after[k])) out.push(k === 'intro' || k === 'outro' || k === 'deliveryAddress' || k === 'objectId' || k === 'termsId' ? `${label} geändert` : `${label} ${fmt(text(before[k]))} → ${fmt(text(after[k]))}`)
  const sf = (d) => `${text(d.serviceFrom)}|${text(d.serviceTo) || text(d.serviceFrom)}`
  if (sf(before) !== sf(after)) out.push(`Leistungszeitraum ${deDate(before.serviceFrom)}–${deDate(before.serviceTo || before.serviceFrom)} → ${deDate(after.serviceFrom)}–${deDate(after.serviceTo || after.serviceFrom)}`)
  if (numOf(before.discount) !== numOf(after.discount)) out.push(`Rabatt auf alles ${num(numOf(before.discount))} % → ${num(numOf(after.discount))} %`)
  if (!!before.reverseCharge !== !!after.reverseCharge) out.push(`Reverse Charge ${after.reverseCharge ? 'eingeschaltet' : 'ausgeschaltet'}`)
  // Schreibweise wie im Formular (UID groß, Leerraum zusammengefasst): kein Eintrag ohne echte Änderung
  const rec = (d) => ['name', 'address', 'uid', 'email'].map((k) => norm(d.recipient?.[k])).join('|').toUpperCase() + (d.recipient?.consumer ? '|v' : '')
  if (rec(before) !== rec(after)) out.push('Empfänger geändert')
  const old = new Map((before.lines || []).map((l) => [l.id, l]))
  const fresh = new Map((after.lines || []).map((l) => [l.id, l]))
  for (const l of after.lines || []) {
    const o = old.get(l.id)
    const priced = isItem(l)
    if (!o) {
      if (priced || text(l.text)) out.push(`Position neu: „${lineText(l)}“${priced ? ` (${num(numOf(l.qty))} × ${eur(numOf(l.price))})` : ''}`)
      continue
    }
    const what = []
    if (lineType(o) !== lineType(l)) what.push('Art geändert')
    if (norm(o.text) !== norm(l.text)) what.push(`Bezeichnung „${lineText(o)}“ → „${lineText(l)}“`)
    if (priced && isItem(o)) {
      if (numOf(o.qty) !== numOf(l.qty)) what.push(`Menge ${num(numOf(o.qty))} → ${num(numOf(l.qty))}`)
      if (text(o.unit) !== text(l.unit)) what.push(`Einheit ${text(o.unit) || '–'} → ${text(l.unit) || '–'}`)
      if (numOf(o.price) !== numOf(l.price)) what.push(`Einzelpreis ${eur(numOf(o.price))} → ${eur(numOf(l.price))}`)
      if (numOf(o.discount) !== numOf(l.discount)) what.push(`Rabatt ${num(numOf(o.discount))} % → ${num(numOf(l.discount))} %`)
      if (numOf(o.vat) !== numOf(l.vat)) what.push(`USt ${num(numOf(o.vat))} % → ${num(numOf(l.vat))} %`)
    }
    if (what.length) out.push(`Position „${lineText(o)}“: ${what.join(', ')}`)
  }
  for (const l of before.lines || []) if (!fresh.has(l.id) && (isItem(l) || text(l.text))) out.push(`Position entfernt: „${lineText(l)}“${isItem(l) ? ` (${num(numOf(l.qty))} × ${eur(numOf(l.price))})` : ''}`)
  const order = (d) => (d.lines || []).map((l) => l.id).filter((id) => old.has(id) && fresh.has(id))
  if (order(before).join() !== order(after).join()) out.push('Reihenfolge der Positionen geändert')
  return out
}

/**
 * Korrektur am Entwurf aus dem Lauf protokollieren: Änderungen gegenüber dem gespeicherten Stand in den Verlauf
 * (history: „Korrektur: …“, wer, wann); war der Entwurf schon geprüft oder freigegeben, wird das zurückgesetzt (danach
 * neu prüfen). Andere Entwürfe bleiben unverändert. Liefert den Entwurf (neues Objekt, wenn sich etwas geändert hat).
 */
export function trackChanges(before, after, { at, by = '' }) {
  if (!needsReview(after) || after.number || !before) return after
  const changes = draftChanges(before, after)
  if (!changes.length) return after
  let out = { ...after, history: logged(after, at, by, `Korrektur: ${changes.join('; ')}`) }
  if (out.review) {
    const step = out.review.releasedAt ? 'Freigabe' : 'Prüfung'
    const { review, ...rest } = out
    out = { ...rest, history: logged(rest, at, by, `${step} zurückgesetzt (nach der Korrektur neu prüfen)`) }
  }
  return out
}

// ---------------------------------------------------------------- Vor dem Festschreiben

/**
 * Meldungen gegen das Festschreiben eines Rechnungsentwurfs (leer: in Ordnung) – für jede Rechnung mit Lieferscheinen
 * oder Positionen aus dem Mattenwechsel, nicht nur aus dem Lauf:
 *  - Entwurf aus dem Lauf noch nicht freigegeben,
 *  - ein Lieferschein, eine Lieferscheinposition oder ein Pauschal-Monat steht schon in einer anderen festgeschriebenen,
 *    nicht stornierten Rechnung (auch Einzel ↔ Sammel, Pauschale ↔ Stück),
 *  - Stückpreise für einen schon pauschal verrechneten Monat,
 *  - Preis fehlt (Position aus einem Lieferschein ohne Preis, noch 0).
 */
export function mattenConflicts(draft, docs = []) {
  if (draft?.kind !== 'rechnung' || draft.number) return []
  const out = []
  if (needsReview(draft) && !draft.review?.releasedAt) out.push(`Mattenwechsel: erst prüfen und freigeben (${draft.review?.checkedAt ? 'geprüft, noch nicht freigegeben' : 'noch nicht geprüft'}), dann festschreiben.`)
  const fixedDocs = docs.filter((d) => d.id !== draft.id)
  const index = billingIndex(fixedDocs)
  const fixed = (list) => (list || []).find((d) => d.number)
  const notesById = new Map(docs.filter((d) => d.kind === 'lieferschein').map((d) => [d.id, d]))
  const refs = uniq([...(draft.deliveryNotes || []).map((n) => n?.id), draft.refId].filter(Boolean)).filter((id) => notesById.has(id))
  const shown = new Set() // je anderer Rechnung bzw. Monat nur eine Meldung
  for (const id of refs) {
    const note = notesById.get(id)
    const other = fixed(index.notes.get(id)) || fixed(noteLineKeys(note).flatMap((k) => index.lines.get(k) || []))
    if (other && !shown.has(`${other.id}:${id}`)) {
      shown.add(`${other.id}:${id}`)
      out.push(`Lieferschein ${note.number} ist schon mit ${other.number} verrechnet: aus diesem Entwurf nehmen oder den Entwurf löschen.`)
    }
  }
  for (const l of draft.lines || []) {
    if (l.source?.type === NOTE_TYPE && l.source.key) {
      const other = fixed(index.lines.get(l.source.key))
      if (other && !shown.has(other.id) && ![...shown].some((k) => k.startsWith(`${other.id}:`))) {
        shown.add(other.id)
        out.push(`Position „${lineText(l)}“ ist schon mit ${other.number} verrechnet: Position entfernen.`)
      }
      if (isItem(l) && l.source.price === 'fehlt' && !(parseNumber(l.price) > 0)) out.push(`Preis fehlt: „${lineText(l)}“ – Einzelpreis im Entwurf eintragen.`)
    } else if (l.source?.type === FLAT_TYPE && l.source.key && !shown.has(l.source.key)) {
      const other = fixed(index.flats.get(l.source.key))
      if (other) {
        shown.add(l.source.key)
        out.push(`Pauschale ${monthLabel(l.source.month || l.source.key.slice(-7))} ist für diesen Kunden schon mit ${other.number} verrechnet.`)
      }
    }
  }
  // Stückpreise für einen Monat, der für den Kunden schon pauschal verrechnet ist
  const pieces = (draft.lines || []).some((l) => isItem(l) && l.source?.type === NOTE_TYPE && parseNumber(l.price) > 0)
  if (pieces && draft.customerId) {
    for (const ym of uniq(refs.map((id) => noteMonthOf(notesById.get(id))))) {
      const other = fixed(index.flats.get(flatKey(draft.customerId, ym)))
      if (other) out.push(`${monthLabel(ym)} ist für diesen Kunden schon pauschal verrechnet (${other.number}): die Lieferscheine nicht zusätzlich je Matte verrechnen.`)
    }
  }
  return uniq(out)
}

// ---------------------------------------------------------------- Vorschlag am Monatsersten, Rechte, Texte

/** Einstellung „Rechnungsentwürfe am Monatsersten vorschlagen“ (settings.mattenRun.suggest). */
export const suggestOn = (settings = {}) => settings?.mattenRun?.suggest === true

/**
 * Vorschlag für „Zu erledigen“ und den digitalen Mitarbeiter Buchhaltung: ab dem Monatsersten der Lauf für den Vormonat,
 * solange Kunden mit fertigen Entwürfen übrig sind. null, wenn ausgeschaltet oder nichts abzurechnen.
 * { ym, count (Kunden), drafts, net, names }.
 */
export function runTask(fak = {}, { today }) {
  if (!suggestOn(fak.settings) || !today) return null
  const ym = prevMonth(today)
  const run = planRun(fak, { ym, today })
  const ready = run.todo.filter((p) => p.ready)
  if (!ready.length) return null
  return { ym, count: ready.length, drafts: run.drafts, net: run.net, names: ready.map((p) => p.name), keys: ready.map((p) => p.key) }
}

/**
 * Wer abrechnen darf: wer die Fakturierung bearbeitet (Buchhaltung, Vollzugriff) – auch ohne den Mattenwechsel zu sehen,
 * alle Daten stehen in den Lieferscheinen. access: aus resolveAccess; ohne (Browser-Modus) alles.
 */
export function runRights(access) {
  if (!access) return { run: true, hint: '' }
  const run = access.canEdit('fakturierung')
  return { run, hint: run ? '' : access.sees('fakturierung') ? 'Abrechnen darf, wer die Fakturierung bearbeitet.' : 'Kein Recht auf die Fakturierung.' }
}

/** Kurzbeschreibung der Abrechnung eines Plans: „je gewechselter Matte · Sammelrechnung · monatlich“. */
export const billingText = (plan) => (plan.model === 'pauschale' ? [MATTEN_PRICE_MODELS.pauschale, MATTEN_INTERVALS[plan.interval]] : [MATTEN_PRICE_MODELS.wechsel, MATTEN_BILLING[plan.billing], MATTEN_INTERVALS[plan.interval]]).filter(Boolean).join(' · ')
