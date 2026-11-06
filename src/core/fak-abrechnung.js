// Abrechnung aus dem Betrieb (Fakturierung): Winterdienst je Objekt und Monat aus dem Winterdienst-Protokoll und
// Unterhaltsreinigung nach Ist-Zeiten aus der Zeiterfassung (statt laut Plan). Rein rechnend, ohne Browser
// (test/fak-abrechnung.test.js). Oberfläche: ui/views/invoicing-abrechnung.js, Beilagen: export/abrechnung-pdf.js
// (Einsatzliste) und export/winter-pdf.js (Winterdienst-Nachweis).
//
// Datenmodell (fakturierung/fakturierung.json, alle Felder optional und nicht in der Prüfsumme):
//  customers[].winterPrices { [objectId]: { mode: 'einsatz' | 'monat' | 'saison', beides, raeumen, streuen, kontrolle,
//                  pauschale } } – Preise netto je Objekt beim Rechnungsempfänger (wie hourRate). Ohne eigene Preise
//                  gelten aktive Artikel mit diesen Namen: „Winterdienst Räumen und Streuen“, „Winterdienst Räumen“,
//                  „Winterdienst Streuen“, „Winterdienst Kontrolle“, „Winterdienst Pauschale“.
//  documents[].source  wie beim Leistungsnachweis { type, key } (Schutz vor doppelter Abrechnung), dazu
//                  Winterdienst: { type: 'winterdienst', key: 'winterdienst:<Objekt>:<Monat>', objectId, month, mode,
//                    season (nur 'saison'), entries: [Schlüssel der Protokoll-Einträge] }
//                  Ist-Zeiten: { type: 'nachweis', key: 'nachweis:<Objekt>:<Monat>', objectId, month, basis: 'ist',
//                    round: 0 | 5 | 15, minutes (verrechnet), rows: [Stempelung bzw. 'plan:<Einsatz>'], plan: true (Planzeit
//                    für Einsätze ohne vollständige Stempelung), special: true (nur Sonderleistungen, weil ein Dauerauftrag läuft) }
//                  Die Beilage (Nachweis, Einsatzliste) zeigt nur die Einträge bzw. Zeilen aus entries bzw. rows.
//                  beilage: beim Erstellen eingefroren, damit die Beilage ohne Zugriff auf die Planung (Wochen mit
//                    Protokoll und Zeiterfassung) entsteht, z. B. für die Rolle Buchhaltung:
//                    Winterdienst { object: { name, address }, names, entries: [Protokoll-Einträge] },
//                    Ist-Zeiten { object, names, round, rows: [{ date, in, out, billed, label, category, basis, person }] };
//                    Namen schon gekürzt wie beim Leistungsnachweis eingestellt (bei „keine“ gar nicht gespeichert).
//  settings.istRound  zuletzt gewählte Rundung je Stempelung (Standard 15 Minuten)
//
// Rundung je Stempelung auf das nächste Vielfache (5 oder 15 Minuten), ab der Hälfte aufwärts: 7 Minuten → 0,
// 8 → 15, 22 → 15, 23 → 30. Fair für beide Seiten, die Rundungen gleichen sich über den Monat aus. Gerechnet wird mit
// ganzen Minuten wie im Leistungsnachweis (Kommen 06:00:40, Gehen 08:15:10 = 135 Minuten).

import { formatDate } from './dates.js'
import { articleActive, deDate, isCancelled, monthLabel, parseNumber, round2, winterNote } from './invoicing.js'
import { absMinutes } from './timeclock.js'
import { viennaParts } from './weather.js'
import { logKey, logRows } from './winterlog.js'

// ---------------------------------------------------------------- Winterdienst

export const WINTER_KINDS = { beides: 'Räumen und Streuen', raeumen: 'Räumen', streuen: 'Streuen', kontrolle: 'Kontrolle' }
export const WINTER_MODES = { einsatz: 'je Einsatz', monat: 'Pauschale je Monat', saison: 'Pauschale je Saison' }
const KIND_ORDER = ['beides', 'raeumen', 'streuen', 'kontrolle']
const PRICE_FIELDS = [...KIND_ORDER, 'pauschale']
const ARTICLE_NAMES = { beides: 'winterdienst räumen und streuen', raeumen: 'winterdienst räumen', streuen: 'winterdienst streuen', kontrolle: 'winterdienst kontrolle', pauschale: 'winterdienst pauschale' }

/** Art eines Protokoll-Eintrags: beides, raeumen, streuen oder kontrolle (nur kontrolliert, nichts nötig). */
export const winterKind = (e) => (e.geraeumt && e.gestreut ? 'beides' : e.geraeumt ? 'raeumen' : e.gestreut ? 'streuen' : 'kontrolle')
export const winterKey = (objectId, month) => `winterdienst:${objectId}:${month}`

/** Wintersaison eines Monats (Juli bis Juni): { key: '2026/27', label: 'Winter 2026/27' }. */
export function winterSeason(ym) {
  const y = Number(String(ym).slice(0, 4))
  const start = Number(String(ym).slice(5, 7)) >= 7 ? y : y - 1
  const key = `${start}/${String(start + 1).slice(2)}`
  return { key, label: `Winter ${key}` }
}

const priceOf = (v) => {
  const n = parseNumber(v)
  return n > 0 ? round2(n) : ''
}
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Preise eines Objekts: eigene beim Kunden (customer.winterPrices[objectId]), sonst aus den Artikeln „Winterdienst …“.
 * Liefert { mode, beides, raeumen, streuen, kontrolle, pauschale, own } (Preise als Zahl oder '' = fehlt).
 */
export function winterPrices(customer, objectId, articles = []) {
  const own = customer?.winterPrices?.[objectId]
  if (own) return { ...Object.fromEntries(PRICE_FIELDS.map((k) => [k, priceOf(own[k])])), mode: WINTER_MODES[own.mode] ? own.mode : 'einsatz', own: true }
  const art = (k) => articles.find((a) => articleActive(a) && norm(a.name) === ARTICLE_NAMES[k])
  return { ...Object.fromEntries(PRICE_FIELDS.map((k) => [k, priceOf(art(k)?.price)])), mode: 'einsatz', own: false }
}

/** Nur die gespeicherten Felder (für customer.winterPrices). */
export const cleanWinterPrices = (p = {}) => ({ mode: WINTER_MODES[p.mode] ? p.mode : 'einsatz', ...Object.fromEntries(PRICE_FIELDS.map((k) => [k, priceOf(p[k])])) })

/** Protokoll-Einträge eines Objekts im Monat (ohne Testalarme), nach Tag und Uhrzeit, mit kind. */
export function winterEntries(log = {}, { objectId, month, objectsById = new Map() }) {
  return logRows(log, { from: `${month}-01`, to: `${month}-31`, objectsById })
    .filter((r) => r.objectId === objectId && !r.test)
    .map((r) => ({ ...r, kind: winterKind(r) }))
}

/** Objekte mit Protokoll im Monat: Set der objectIds. */
export const winterObjectIds = (log = {}, month) => new Set(Object.values(log || {}).filter((e) => e && !e.test && String(e.date).startsWith(month)).map((e) => e.objectId))

/** Tage einer Liste: „03.12., 05.12. (2×), 12.12.“ */
export function dayList(list) {
  const n = new Map()
  for (const e of list) n.set(e.date, (n.get(e.date) || 0) + 1)
  return [...n.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, c]) => `${formatDate(date, { weekday: false })}${c > 1 ? ` (${c}×)` : ''}`)
    .join(', ')
}

/** Zusammenfassung „2 × Räumen und Streuen, 1 × Streuen“. */
export const kindSummary = (entries) =>
  KIND_ORDER.map((k) => [k, entries.filter((e) => e.kind === k).length])
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} × ${WINTER_KINDS[k]}`)
    .join(', ')

/**
 * Positionen für den Winterdienst eines Objekts im Monat.
 *  je Einsatz: eine Position je Art (Menge = Einsätze, Einheit „Einsatz“, Tage als Langtext); reine Kontrollgänge nur
 *    mit eigenem Preis, sonst als Text („nicht verrechnet“).
 *  Pauschale je Monat: 1 × Pauschale, die Einsätze als Text.
 *  Pauschale je Saison: 1 × Pauschale beim ersten abgerechneten Monat der Saison; ist sie schon verrechnet
 *    (seasonDoc), gibt es nichts mehr abzurechnen (lines leer).
 * Liefert { lines, net, missing: [Arten ohne Preis], count, flat }.
 */
export function winterBill({ entries = [], prices = {}, objectName = '', month, vat = 20, newId, seasonDoc = null }) {
  const lines = []
  const missing = []
  const count = entries.length
  const info = (list) => `Einsätze lt. Winterdienst-Protokoll ${monthLabel(month)}: ${list.length} (${kindSummary(list)}) am ${dayList(list)}`
  const mode = WINTER_MODES[prices.mode] ? prices.mode : 'einsatz'
  if (!count) return { lines, net: 0, missing, count, flat: mode !== 'einsatz' }
  if (mode === 'einsatz') {
    for (const k of KIND_ORDER) {
      const list = entries.filter((e) => e.kind === k)
      if (!list.length) continue
      const price = priceOf(prices[k])
      if (k === 'kontrolle' && !price) {
        lines.push({ id: newId(), type: 'text', text: `Kontrollgänge ohne Räumen und Streuen: ${list.length} am ${dayList(list)} (nicht verrechnet)` })
        continue
      }
      if (!price) missing.push(k)
      lines.push({ id: newId(), text: `Winterdienst ${WINTER_KINDS[k]} – ${objectName}`, longText: `${monthLabel(month)} am ${dayList(list)}`, qty: list.length, unit: 'Einsatz', price: price || 0, vat, discount: 0 })
    }
  } else if (mode === 'monat' || !seasonDoc) {
    const price = priceOf(prices.pauschale)
    if (!price) missing.push('pauschale')
    const season = winterSeason(month)
    lines.push(
      mode === 'monat'
        ? { id: newId(), text: `Winterdienst Pauschale ${objectName} ${monthLabel(month)}`, qty: 1, unit: 'Monat', price: price || 0, vat, discount: 0 }
        : { id: newId(), text: `Winterdienst Saisonpauschale ${objectName} ${season.label}`, qty: 1, unit: 'Saison', price: price || 0, vat, discount: 0 },
    )
    lines.push({ id: newId(), type: 'text', text: info(entries) })
  }
  const net = round2(lines.filter((l) => !l.type).reduce((s, l) => s + round2(l.qty * l.price), 0))
  return { lines, net, missing, count, flat: mode !== 'einsatz' }
}

/**
 * Belege zu einer Quelle (source.key), z. B. schon abgerechnete Monate: [{ doc, state: 'entwurf' | 'fest' | 'storniert' }].
 * Stornierte zählen nicht als abgerechnet.
 */
export function billedBySource(docs = [], key) {
  return docs.filter((x) => x.source?.key === key && x.kind === 'rechnung').map((doc) => ({ doc, state: !doc.number ? 'entwurf' : isCancelled(doc, docs) ? 'storniert' : 'fest' }))
}
export const activeBilling = (list) => list.filter((b) => b.state !== 'storniert')

/** Schon verrechnete Saisonpauschale eines Objekts (Entwurf oder Rechnung, nicht storniert). */
export function seasonBilled(docs = [], objectId, month) {
  const { key } = winterSeason(month)
  return docs.find((x) => x.kind === 'rechnung' && x.source?.type === 'winterdienst' && x.source.objectId === objectId && x.source.mode === 'saison' && x.source.season === key && !(x.number && isCancelled(x, docs))) || null
}

/** Läuft für das Objekt ein Dauerauftrag mit Winterdienst (Titel oder Position)? Dann ist die Pauschale dort. */
export const winterRecurring = (recurring = [], objectId) => recurring.find((r) => r.active !== false && r.objectId === objectId && [r.title, ...(r.lines || []).map((l) => l.text)].some((t) => /winter/i.test(String(t || '')))) || null

// ---------------------------------------------------------------- Ist-Zeiten aus der Zeiterfassung

export const ROUND_STEPS = { 0: 'nicht runden', 5: 'auf 5 Minuten', 15: 'auf 15 Minuten' }
export const ROUND_DEFAULT = 15
export const roundStep = (v) => (ROUND_STEPS[Number(v)] !== undefined && v !== '' && v !== null ? Number(v) : ROUND_DEFAULT)
/** Auf das nächste Vielfache von step runden (ab der Hälfte aufwärts); step 0: nicht runden. */
export const roundMinutes = (min, step) => (step > 0 ? Math.round(min / step) * step : min)

const hhmm = (iso) => {
  const p = viennaParts(iso)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
const personName = (name, mode) => (!name || mode === 'keine' ? '' : mode === 'vorname' ? String(name).split(/\s+/)[0] : String(name))
/** Dauer als „2:15“. */
export const durationText = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`

/**
 * Ist-Zeiten eines Objekts für from–to aus den Stempelungen (data.stamps):
 *   rows:     gezählte Stempelungen { key, date, in, out, minutes (gestempelt), billed (gerundet), label, category,
 *             person, basis: 'ist' | 'plan', instKey, long (über 12 Stunden: prüfen) }
 *   problems: nicht gezählt (ohne „Gehen“, Gehen vor Kommen) { key, date, in, out, person, label, text }
 *   skipped:  Winterdienst-Einsätze (gehen über „Winterdienst abrechnen“)
 *   totals:   { minutes (gestempelt), billed, ist, plan, problems, skipped }
 * Leistung: Einsatz laut Plan (Kennung der Stempelung, sonst der zeitlich nächste im Objekt an dem Tag).
 * planFallback: Einsätze laut Plan, die vorbei und besetzt sind, aber keine vollständige Stempelung haben, mit der
 * geplanten Zeit (Nettozeit × Personen, wie im Leistungsnachweis) – nur, wenn ausdrücklich gewählt.
 * names: wie beim Leistungsnachweis ('keine' | 'vorname' | 'voll').
 */
export function istFor({ objectId, from, to, stamps = {}, instances = [], state = null, employeesById = new Map(), round = ROUND_DEFAULT, planFallback = false, today = '9999-12-31', now = null, names = 'keine' }) {
  const step = roundStep(round)
  const insts = instances.filter((i) => i.objectId === objectId && i.status !== 'cancelled' && i.date >= from && i.date <= to)
  const byKey = new Map(insts.map((i) => [i.key, i]))
  const nearest = (s) => {
    let pick = null
    let dist = Infinity
    const at = absMinutes(s.in)
    for (const i of insts) {
      if (i.date !== s.date) continue
      const d = Math.abs(at - i.start)
      if (d < dist) {
        dist = d
        pick = i
      }
    }
    return pick
  }
  const nameOf = (empId, fallback = '') => personName(employeesById.get(empId)?.name || fallback, names)
  const rows = []
  const problems = []
  const skipped = []
  const counted = new Set()
  const list = Object.values(stamps || {})
    .filter((s) => s && s.objectId === objectId && s.date >= from && s.date <= to && s.in)
    .sort((a, b) => a.date.localeCompare(b.date) || a.in.localeCompare(b.in))
  for (const s of list) {
    const inst = byKey.get(s.instKey) || nearest(s)
    const base = { key: s.id, date: s.date, in: hhmm(s.in), out: s.out ? hhmm(s.out) : '', person: nameOf(s.empId, s.name), label: inst?.label || 'ohne Einsatz laut Plan', category: inst?.category || '', instKey: inst?.key || '' }
    if (inst?.category === 'winter') {
      skipped.push({ ...base, text: 'Winterdienst: über „Winterdienst abrechnen“' })
      continue
    }
    if (!s.out) {
      problems.push({ ...base, text: 'ohne „Gehen“: nicht gezählt' })
      continue
    }
    const minutes = Math.floor(Date.parse(s.out) / 6e4) - Math.floor(Date.parse(s.in) / 6e4)
    if (!(minutes > 0)) {
      problems.push({ ...base, text: '„Gehen“ nicht nach „Kommen“: nicht gezählt' })
      continue
    }
    rows.push({ ...base, minutes, billed: roundMinutes(minutes, step), basis: 'ist', long: minutes > 720 })
    if (inst) counted.add(inst.key)
  }
  if (planFallback && state) {
    for (const i of insts) {
      if (counted.has(i.key) || i.category === 'winter') continue
      if (i.date > today || (now !== null && i.end > now)) continue
      const assigned = state
        .assigned(i.key)
        .map((a) => a.employeeId)
        .filter((id) => employeesById.has(id))
      if (!assigned.length) continue
      const minutes = (Number(i.net) || 0) * Math.max(1, assigned.length)
      if (!minutes) continue
      rows.push({ key: `plan:${i.key}`, date: i.date, in: i.startTime, out: i.endTime, minutes, billed: minutes, person: assigned.map((id) => nameOf(id)).filter(Boolean).join(', '), label: i.label || '', category: i.category || '', instKey: i.key, basis: 'plan', long: false })
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.in.localeCompare(b.in))
  }
  return {
    rows,
    problems,
    skipped,
    round: step,
    totals: {
      minutes: rows.filter((r) => r.basis === 'ist').reduce((s, r) => s + r.minutes, 0),
      billed: rows.reduce((s, r) => s + r.billed, 0),
      ist: rows.filter((r) => r.basis === 'ist').length,
      plan: rows.filter((r) => r.basis === 'plan').length,
      problems: problems.length,
      skipped: skipped.length,
    },
  }
}

/** Nur die Zeilen, die eine Rechnung verrechnet (Dauerauftrag: nur Sonderleistungen). */
export const istRowsFor = (ist, { special = false } = {}) => (special ? ist.rows.filter((r) => r.category === 'sonder') : ist.rows)

/**
 * Positionen aus den Ist-Zeiten (wie linesFromProof): regelmäßige Einsätze als Stunden (Summe der gerundeten Zeiten),
 * Sonderleistungen je Einsatz mit Datum. special: nur Sonderleistungen (Dauerauftrag).
 */
export function linesFromIst({ ist, objectName = '', month, rate = 0, vat = 20, newId, special = false }) {
  const all = istRowsFor(ist, { special })
  const regular = all.filter((r) => r.category !== 'sonder')
  const sonder = all.filter((r) => r.category === 'sonder')
  const hours = (list) => round2(list.reduce((s, r) => s + r.billed, 0) / 60)
  const lines = []
  if (regular.length && hours(regular) > 0) {
    const n = new Set(regular.map((r) => r.instKey || r.key)).size
    const plan = new Set(regular.filter((r) => r.basis === 'plan').map((r) => r.instKey)).size
    lines.push({ id: newId(), text: `Unterhaltsreinigung ${objectName} ${monthLabel(month)} lt. Zeiterfassung (${n} ${n === 1 ? 'Einsatz' : 'Einsätze'}${plan ? `, davon ${plan} laut Plan` : ''})`, qty: hours(regular), unit: 'Std.', price: round2(rate), vat, discount: 0 })
  }
  const groups = new Map()
  for (const r of sonder) groups.set(r.instKey || r.key, [...(groups.get(r.instKey || r.key) || []), r])
  for (const list of groups.values()) if (hours(list) > 0) lines.push({ id: newId(), text: `${list[0].label || 'Sonderleistung'} am ${deDate(list[0].date)}`, qty: hours(list), unit: 'Std.', price: round2(rate), vat, discount: 0 })
  // Winterdienst geht über „Winterdienst abrechnen“ (wie beim Plan): Hinweis im Entwurf
  const winter = new Set(ist.skipped.map((r) => r.instKey || r.key)).size
  if (lines.length && winter && !special) lines.push({ id: newId(), type: 'text', text: winterNote(winter) })
  return lines
}

// ---------------------------------------------------------------- Beilage eingefroren (ohne Planung erzeugbar)

const objectSnap = (o = {}) => ({ name: o.name || '', address: o.address || '' })

/** Winterdienst-Nachweis zum Einfrieren: Objekt, Namen-Einstellung, die verrechneten Einträge (Namen gekürzt). */
export function freezeWinter({ object, entries = [], names = 'keine' }) {
  return {
    object: objectSnap(object),
    names,
    entries: entries.map((e) => ({
      id: e.id,
      date: e.date,
      objectId: e.objectId,
      at: e.at,
      ...(personName(e.person, names) ? { person: personName(e.person, names) } : {}),
      geraeumt: !!e.geraeumt,
      gestreut: !!e.gestreut,
      kontrolle: !!e.kontrolle,
      mittel: e.mittel || '',
      notiz: e.notiz || '',
      lage: e.lage || '',
      fotos: (e.fotos || []).map((f) => ({ datei: f.datei, ...(f.pfad ? { pfad: f.pfad } : {}) })),
    })),
  }
}
/** Eingefrorene Einträge wieder als Protokoll (für winterLogDocument). */
export const frozenLog = (b) => Object.fromEntries((b?.entries || []).map((e) => [logKey(e), e]))

/** Einsatzliste zum Einfrieren: Objekt, Namen-Einstellung, Rundung, die verrechneten Zeilen (Namen gekürzt). */
export function freezeIst({ object, rows = [], names = 'keine', round = ROUND_DEFAULT }) {
  return {
    object: objectSnap(object),
    names,
    round: roundStep(round),
    rows: rows.map((r) => ({ date: r.date, in: r.in, out: r.out, billed: r.billed, label: r.label || '', category: r.category || '', basis: r.basis, ...(personName(r.person, names) ? { person: personName(r.person, names) } : {}) })),
  }
}
