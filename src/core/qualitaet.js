// Qualitätsmessung in Anlehnung an EN 13549 (Reinigungsdienstleistungen – Grundanforderungen und Empfehlungen für
// Qualitätsmesssysteme): je Objekt Raumgruppen mit Anzahl Räume (zusammen das Los), je Messung eine zufällige
// Stichprobe von Räumen (Umfang und Annahmezahl in Anlehnung an ISO 2859-1), Bewertung je Raum an Prüfobjekten mit
// Fehlerarten und Gewicht, Ergebnis je Raum „in Ordnung / nicht in Ordnung“, Gesamtergebnis „erfüllt / nicht erfüllt“,
// Qualitätskennzahl mit Verlauf, Nachkontrolle und Hinweis „Reklamationsgefahr“.
// Reine Funktionen ohne Browser (test/qualitaet.test.js); Ansicht ui/views/qualitaet.js, Bericht export/qualitaet-pdf.js.
//
// Alle Tabellen und Vorgaben hier sind ein Vorschlag in Anlehnung an EN 13549, ohne Gewähr: Der Wortlaut der Normen
// lag nicht vor (docs/RECHTSPRUEFUNG.md, offener Punkt 30). Sie lassen sich unter „Vorgaben“ ändern.
//
// Datei qualitaet/qualitaet.json:
//   { settings: { sample: [{ upTo, n }], checkItems: [{ id, name, weight }], defectTypes: [{ id, name }],
//                 groupTemplates: [{ id, name, items: [Prüfobjekt-ID] }], aql, target, roomLimit, recheckDays, dropPoints }
//                 (leere Listen und fehlende Werte = Vorgaben unten)
//     objects:  [{ objectId, groups: [{ id, name, template, rooms, names: [] }], aql, accept, target, email, note }]
//               aql leer = Vorgabe; accept: fest vereinbarte zulässige Zahl Räume „nicht in Ordnung“ (leer = aus der AQL)
//     measurements: [{ id, objectId, date, status: 'laufend'|'fertig', by, seed, groupIds, lot, plan, roomLimit, target,
//                      manual, recheckOf, rooms: [{ key, groupId, group, no, label, checked,
//                        items: [{ id, name, weight, state: 'ok'|'mangel'|'na', defects: [ID], note, photo: Datei|null }] }],
//                      result, note, customer, signature: { name, svg, at }|null, report: Datei|null,
//                      sent: [{ at, to, by }], at, user, finishedAt }] }
//   plan = { table, n, ac, re, aql, accept, letter, full } (beim Beginn festgehalten, spätere Vorgaben ändern alte
//   Messungen nicht). Datei = { path, name, type, size, at, by, url?, queued?, local? } unter qualitaet/nachweise/<Jahr>/.
//
// Rechenregeln (Annahmen, siehe Punkt 30):
//   Losgröße N = Räume der gewählten Raumgruppen. Stichprobe laut Tabelle (Vorgabe: ISO 2859-1, allgemeines
//   Prüfniveau II, Einfach-Stichprobe, Normalprüfung); Annahmezahl Ac aus der AQL (Tabelle 2-A, Pfeile aufgelöst: der
//   Stichprobenumfang kann sich dadurch ändern) oder fest je Objekt. Ist die Stichprobe so groß wie das Los: alle Räume.
//   Die Räume verteilen sich anteilig auf die Raumgruppen (mindestens einer je Gruppe, solange die Stichprobe reicht)
//   und werden mit einem Startwert zufällig gezogen (gleicher Startwert, gleiche Auswahl).
//   Fehlerpunkte eines Raums = Summe der Gewichte der Prüfobjekte mit Mangel; „nicht in Ordnung“ ab roomLimit Punkten
//   (Vorgabe 1: jeder Mangel). Erfüllt, wenn höchstens Ac Räume nicht in Ordnung sind.
//   Qualitätskennzahl = 100 × (1 − Fehlerpunkte / Summe der Gewichte aller bewerteten Prüfobjekte), eine Kommastelle
//   („entfällt“ zählt nicht). Schlecht = nicht erfüllt oder Kennzahl unter dem Zielwert.
//   Nachkontrolle: nach einer schlechten Messung binnen recheckDays (7) Tagen, erledigt durch die nächste Messung.
//   Reklamationsgefahr: die letzten zwei Messungen schlecht, oder die letzten drei Kennzahlen fallen jeweils und
//   zusammen um mindestens dropPoints (5) Prozentpunkte.

import { addDays } from './dates.js'

export const QM_HINT = 'Vorschlag in Anlehnung an EN 13549, ohne Gewähr'

/** Stichprobe je Losgröße (Räume): ISO 2859-1, Tabelle 1 (Prüfniveau II) und Tabelle 2-A (Umfang). */
export const SAMPLE_DEFAULTS = [
  { upTo: 8, n: 2 },
  { upTo: 15, n: 3 },
  { upTo: 25, n: 5 },
  { upTo: 50, n: 8 },
  { upTo: 90, n: 13 },
  { upTo: 150, n: 20 },
  { upTo: 280, n: 32 },
  { upTo: 500, n: 50 },
  { upTo: 1200, n: 80 },
  { upTo: 3200, n: 125 },
  { upTo: 10000, n: 200 },
]

/** Prüfobjekte mit Gewicht (Fehlerpunkte bei Mangel). */
export const ITEM_DEFAULTS = [
  { id: 'boden', name: 'Boden', weight: 2 },
  { id: 'oberflaechen', name: 'Oberflächen (Tische, Ablagen, Fensterbänke)', weight: 1 },
  { id: 'kontakt', name: 'Türen, Griffe, Schalter', weight: 1 },
  { id: 'glas', name: 'Glas und Spiegel', weight: 1 },
  { id: 'abfall', name: 'Abfallbehälter', weight: 2 },
  { id: 'sanitaer', name: 'Sanitärobjekte (WC, Urinal, Waschbecken)', weight: 3 },
  { id: 'verbrauch', name: 'Verbrauchsmaterial (Seife, Papier)', weight: 2 },
  { id: 'fliesen', name: 'Wandfliesen und Trennwände', weight: 1 },
  { id: 'spuele', name: 'Spüle und Arbeitsflächen', weight: 2 },
  { id: 'geraete', name: 'Geräte außen (Kühlschrank, Kaffeemaschine)', weight: 1 },
  { id: 'gelaender', name: 'Handläufe und Geländer', weight: 1 },
]

export const DEFECT_DEFAULTS = [
  { id: 'staub', name: 'Staub' },
  { id: 'flecken', name: 'Flecken' },
  { id: 'streifen', name: 'Streifen, Schlieren' },
  { id: 'abfall', name: 'Abfall nicht geleert' },
  { id: 'kalk', name: 'Kalk, Urinstein' },
  { id: 'material', name: 'Verbrauchsmaterial fehlt' },
  { id: 'spinnweben', name: 'Spinnweben' },
  { id: 'finger', name: 'Fingerabdrücke' },
  { id: 'rueckstand', name: 'Rückstände, Haare' },
  { id: 'sonstiges', name: 'Sonstiges' },
]

/** Raumgruppen als Vorlage: welche Prüfobjekte in einem Raum dieser Gruppe bewertet werden. */
export const GROUP_DEFAULTS = [
  { id: 'buero', name: 'Büro', items: ['boden', 'oberflaechen', 'kontakt', 'glas', 'abfall'] },
  { id: 'sanitaer', name: 'Sanitär', items: ['boden', 'sanitaer', 'glas', 'fliesen', 'verbrauch', 'abfall'] },
  { id: 'verkehr', name: 'Verkehrsflächen', items: ['boden', 'gelaender', 'kontakt', 'glas', 'abfall'] },
  { id: 'kueche', name: 'Küche', items: ['boden', 'spuele', 'geraete', 'oberflaechen', 'abfall'] },
  { id: 'sonstige', name: 'Sonstige Räume', items: ['boden', 'oberflaechen', 'kontakt', 'abfall'] },
]

/** AQL-Werte zur Auswahl (Anteil Räume „nicht in Ordnung“ in Prozent; über 10 gilt die Tabelle nur für Fehler je 100). */
export const AQL_VALUES = [0.65, 1, 1.5, 2.5, 4, 6.5, 10]
export const SETTINGS_DEFAULTS = { aql: 4, target: 90, roomLimit: 1, recheckDays: 7, dropPoints: 5 }
export const STATES = { ok: 'in Ordnung', mangel: 'Mangel', na: 'entfällt' }

export const emptyQualitaet = () => ({ settings: {}, objects: [], measurements: [] })

const num = (v, fallback) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v))
const list = (v, fallback) => (Array.isArray(v) && v.length ? v : fallback)

/** Vorgaben mit eigenen Werten aus der Datei. */
export function settingsOf(doc) {
  const s = doc?.settings || {}
  return {
    sample: list(s.sample, SAMPLE_DEFAULTS),
    checkItems: list(s.checkItems, ITEM_DEFAULTS),
    defectTypes: list(s.defectTypes, DEFECT_DEFAULTS),
    groupTemplates: list(s.groupTemplates, GROUP_DEFAULTS),
    aql: AQL_VALUES.includes(num(s.aql, NaN)) ? Number(s.aql) : SETTINGS_DEFAULTS.aql,
    target: Math.min(100, Math.max(0, num(s.target, SETTINGS_DEFAULTS.target))),
    roomLimit: Math.max(1, num(s.roomLimit, SETTINGS_DEFAULTS.roomLimit)),
    recheckDays: Math.max(1, Math.round(num(s.recheckDays, SETTINGS_DEFAULTS.recheckDays))),
    dropPoints: Math.max(0, num(s.dropPoints, SETTINGS_DEFAULTS.dropPoints)),
  }
}

/** Einstellungen eines Objekts (Raumgruppen, Qualitätsniveau) oder null. */
export const objectConf = (doc, objectId) => (doc?.objects || []).find((o) => o.objectId === objectId) || null
/** Räume aller (oder der gewählten) Raumgruppen = Losgröße. */
export const lotSize = (groups = [], ids = null) => groups.filter((g) => !ids || ids.includes(g.id)).reduce((s, g) => s + Math.max(0, Math.round(Number(g.rooms) || 0)), 0)
/** Qualitätsniveau des Objekts: AQL (eigene oder Vorgabe), feste Annahmezahl, Zielwert der Kennzahl. */
export function levelOf(conf, settings) {
  const aql = AQL_VALUES.includes(Number(conf?.aql)) ? Number(conf.aql) : settings.aql
  const accept = conf?.accept === '' || conf?.accept === null || conf?.accept === undefined || !(Number(conf.accept) >= 0) ? null : Math.round(Number(conf.accept))
  const target = conf?.target === '' || conf?.target === null || conf?.target === undefined ? settings.target : Math.min(100, Math.max(0, Number(conf.target) || 0))
  return { aql, accept, target }
}

// ---------------------------------------------------------------- Stichprobe (ISO 2859-1)

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R']
const ISO_SIZES = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000]
const AQL_COLUMNS = [0.01, 0.015, 0.025, 0.04, 0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1, 1.5, 2.5, 4, 6.5, 10]
// Tabelle 2-A je Zeile ab der Spalte mit „0 1“ nach rechts: Annahmezahl oder Pfeil (danach ↑, links davon ↓).
// Die Spalte mit „0 1“ liegt bei A unter 6,5 und rückt je Kennbuchstabe eine Spalte nach links.
const ROW = [0, 'up', 'down', 1, 2, 3, 5, 7, 10, 14, 21]
const ZERO_A = AQL_COLUMNS.indexOf(6.5)

/**
 * Annahmezahl nach ISO 2859-1, Tabelle 2-A (Einfach-Stichprobe, Normalprüfung) für einen Stichprobenumfang der
 * Tabelle und eine AQL: { letter, n, ac, re }; Pfeile führen zum nächsten Plan darunter (↓) oder darüber (↑), der
 * Umfang ändert sich dann. Kein Wert (Umfang oder AQL nicht in der Tabelle): null.
 * Annahme: ↑ in der ersten Zeile (A, AQL 10) gibt es nicht; dort gilt der Plan darunter.
 */
export function isoAcceptance(n, aql) {
  let i = ISO_SIZES.indexOf(Number(n))
  const col = AQL_COLUMNS.indexOf(Number(aql))
  if (i < 0 || col < 0) return null
  for (let step = 0; step < 40 && i >= 0 && i < ISO_SIZES.length; step++) {
    const offset = col - (ZERO_A - i)
    const cell = offset < 0 ? 'down' : offset < ROW.length ? ROW[offset] : 'up'
    if (cell === 'down' || (cell === 'up' && i === 0)) i++
    else if (cell === 'up') i--
    else return { letter: LETTERS[i], n: ISO_SIZES[i], ac: cell, re: cell + 1 }
  }
  return null
}

/**
 * Plan einer Messung für ein Los von N Räumen: { lot, table, n, ac, re, aql, accept, letter, full, needsAccept }.
 * table = Umfang laut Tabelle, n = zu prüfende Räume (nach dem ISO-Plan, höchstens N), full = alle Räume.
 * Feste Annahmezahl (accept): Umfang laut Tabelle, ac = accept. Ohne passenden ISO-Wert: ac = null (needsAccept).
 */
export function planFor(lot, { aql = SETTINGS_DEFAULTS.aql, accept = null, sample = SAMPLE_DEFAULTS } = {}) {
  const N = Math.max(0, Math.round(Number(lot) || 0))
  if (!N) return null
  const rows = [...sample].filter((r) => Number(r.n) > 0).sort((a, b) => Number(a.upTo) - Number(b.upTo))
  const row = rows.find((r) => N <= Number(r.upTo)) || rows.at(-1)
  const table = Math.round(Number(row?.n) || N)
  if (accept !== null && accept !== undefined && accept !== '' && Number(accept) >= 0) {
    const ac = Math.round(Number(accept))
    return { lot: N, table, n: Math.min(table, N), ac, re: ac + 1, aql: null, accept: ac, letter: '', full: table >= N, needsAccept: false }
  }
  const iso = isoAcceptance(table, aql)
  if (!iso) return { lot: N, table, n: Math.min(table, N), ac: null, re: null, aql: Number(aql), accept: null, letter: '', full: table >= N, needsAccept: true }
  return { lot: N, table, n: Math.min(iso.n, N), ac: iso.ac, re: iso.re, aql: Number(aql), accept: null, letter: iso.letter, full: iso.n >= N, needsAccept: false }
}

/** Zufallszahlen aus einem Startwert (mulberry32): gleicher Startwert, gleiche Folge. */
export function seededRandom(seed) {
  let a = Math.round(Number(seed) || 0) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Stichprobe auf die Raumgruppen verteilen: anteilig nach Räumen (größter Rest), mindestens ein Raum je Gruppe,
 * solange der Umfang reicht (sonst die größten Gruppen). groups [{ id, rooms }] → { id: Anzahl }.
 */
export function allocate(groups, n) {
  const gs = groups.map((g) => ({ id: g.id, rooms: Math.max(0, Math.round(Number(g.rooms) || 0)) })).filter((g) => g.rooms > 0)
  const N = gs.reduce((s, g) => s + g.rooms, 0)
  const total = Math.min(Math.max(0, Math.round(Number(n) || 0)), N)
  const out = Object.fromEntries(gs.map((g) => [g.id, 0]))
  if (!total) return out
  if (total < gs.length) {
    const big = [...gs].map((g, i) => ({ ...g, i })).sort((a, b) => b.rooms - a.rooms || a.i - b.i)
    for (const g of big.slice(0, total)) out[g.id] = 1
    return out
  }
  const quota = gs.map((g) => (total * g.rooms) / N)
  const alloc = gs.map((g, i) => Math.min(g.rooms, Math.max(1, Math.floor(quota[i]))))
  let sum = alloc.reduce((s, x) => s + x, 0)
  while (sum > total) {
    let best = -1
    for (let i = 0; i < gs.length; i++) if (alloc[i] > 1 && (best < 0 || alloc[i] - quota[i] >= alloc[best] - quota[best])) best = i
    alloc[best]--
    sum--
  }
  while (sum < total) {
    let best = -1
    for (let i = 0; i < gs.length; i++) if (alloc[i] < gs[i].rooms && (best < 0 || quota[i] - alloc[i] > quota[best] - alloc[best])) best = i
    alloc[best]++
    sum++
  }
  gs.forEach((g, i) => (out[g.id] = alloc[i]))
  return out
}

/** Zufällige Räume je Gruppe: [{ groupId, no }] (Raumnummer ab 1), nach Gruppe und Nummer geordnet. */
export function drawSample({ groups, n, seed }) {
  const counts = allocate(groups, n)
  const rnd = seededRandom(seed)
  const out = []
  for (const g of groups) {
    const k = counts[g.id] || 0
    const rooms = Math.max(0, Math.round(Number(g.rooms) || 0))
    if (!k) continue
    const nos = Array.from({ length: rooms }, (_, i) => i + 1)
    for (let i = nos.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[nos[i], nos[j]] = [nos[j], nos[i]]
    }
    for (const no of nos.slice(0, k).sort((a, b) => a - b)) out.push({ groupId: g.id, no })
  }
  return out
}

/** Name eines Raums: aus dem Raumbuch bzw. von Hand, sonst „Büro 3“. */
export const roomLabel = (group, no) => String(group?.names?.[no - 1] || '').trim() || `${group?.name || 'Raum'} ${no}`

/** Prüfobjekte einer Raumgruppe (laut Vorlage; unbekannte Vorlage: „Sonstige Räume“ bzw. die erste). */
export function itemsFor(group, settings) {
  const tpl = settings.groupTemplates.find((t) => t.id === group?.template) || settings.groupTemplates.find((t) => t.id === 'sonstige') || settings.groupTemplates[0]
  return (tpl?.items || []).map((id) => settings.checkItems.find((x) => x.id === id)).filter(Boolean)
}

/** Räume der Messung mit allen Prüfobjekten „in Ordnung“ (beim Bewerten nur die Mängel antippen). */
export function buildRooms(picks, groups, settings) {
  return picks
    .map(({ groupId, no }) => {
      const g = groups.find((x) => x.id === groupId)
      if (!g) return null
      return {
        key: `${groupId}#${no}`,
        groupId,
        group: g.name,
        no,
        label: roomLabel(g, no),
        checked: false,
        items: itemsFor(g, settings).map((x) => ({ id: x.id, name: x.name, weight: Math.max(0, Number(x.weight) || 0), state: 'ok', defects: [], note: '', photo: null })),
      }
    })
    .filter(Boolean)
}

// ---------------------------------------------------------------- Bewertung

/** Ein Raum: { points, max, ok, defects (Prüfobjekte mit Mangel), rated }. */
export function roomResult(room, roomLimit = SETTINGS_DEFAULTS.roomLimit) {
  let points = 0
  let max = 0
  let defects = 0
  for (const it of room?.items || []) {
    if (it.state === 'na') continue
    const w = Math.max(0, Number(it.weight) || 0)
    max += w
    if (it.state === 'mangel') {
      points += w
      defects++
    }
  }
  return { points, max, defects, rated: max > 0, ok: points < Math.max(1, Number(roomLimit) || 1) }
}

const round1 = (x) => Math.round(x * 10) / 10

/**
 * Ergebnis einer Messung: { rooms (bewertet), bad (nicht in Ordnung), defects, items, itemsOk, points, max, score,
 * ac, re, ok (erfüllt; null ohne Annahmezahl), poor (schlecht), target }.
 */
export function evaluate(m) {
  const limit = m?.roomLimit ?? SETTINGS_DEFAULTS.roomLimit
  let rooms = 0
  let bad = 0
  let defects = 0
  let items = 0
  let points = 0
  let max = 0
  for (const r of m?.rooms || []) {
    const x = roomResult(r, limit)
    if (!x.rated) continue
    rooms++
    if (!x.ok) bad++
    defects += x.defects
    items += r.items.filter((it) => it.state !== 'na').length
    points += x.points
    max += x.max
  }
  const ac = m?.plan?.ac ?? null
  const score = max > 0 ? round1(100 * (1 - points / max)) : null
  const ok = ac === null || ac === undefined ? null : bad <= ac
  const target = Number(m?.target ?? SETTINGS_DEFAULTS.target)
  const poor = ok === false || (score !== null && score < target)
  return { rooms, bad, defects, items, itemsOk: items - defects, points, max, score, ac, re: ac === null ? null : ac + 1, ok, poor, target }
}

/** Ergebnis einer Messung (abgeschlossen: wie beim Abschluss festgehalten, laufend: neu gerechnet). */
export const resultOf = (m) => (m?.status === 'fertig' && m.result ? m.result : evaluate(m))

/**
 * Neue Messung: Plan und Räume aus Objekt, Raumgruppen und Startwert. picks: von Hand geänderte Auswahl
 * (sonst gezogen). → Messung (status 'laufend').
 */
export function newMeasurement({ id, conf, settings, date, seed, groupIds = null, picks = null, by = '', at = '', recheckOf = null }) {
  const groups = (conf?.groups || []).filter((g) => (!groupIds || groupIds.includes(g.id)) && Number(g.rooms) > 0)
  const level = levelOf(conf, settings)
  const plan = planFor(lotSize(groups), { aql: level.aql, accept: level.accept, sample: settings.sample })
  const drawn = plan ? drawSample({ groups, n: plan.n, seed }) : []
  const chosen = picks || drawn
  const manual = !!picks && (picks.length !== drawn.length || picks.some((p, i) => p.groupId !== drawn[i]?.groupId || p.no !== drawn[i]?.no))
  return {
    id,
    objectId: conf?.objectId || '',
    date,
    status: 'laufend',
    by,
    seed: Math.round(Number(seed) || 0),
    groupIds: groups.map((g) => g.id),
    lot: plan?.lot || 0,
    plan,
    roomLimit: settings.roomLimit,
    target: level.target,
    manual,
    recheckOf,
    rooms: buildRooms(chosen, groups, settings),
    result: null,
    note: '',
    customer: '',
    signature: null,
    report: null,
    sent: [],
    at,
    user: by,
    finishedAt: '',
  }
}

/** Messung prüfen, bevor sie beginnt: Text des ersten Problems oder ''. */
export function planProblem({ conf, date, today, picks, plan }) {
  if (!conf) return 'Bitte das Objekt wählen.'
  if (!lotSize(conf.groups)) return 'Für dieses Objekt sind keine Raumgruppen mit Räumen eingetragen.'
  if (!date) return 'Bitte das Datum eintragen.'
  if (date > today) return 'Das Datum liegt in der Zukunft.'
  if (!plan) return 'Bitte mindestens eine Raumgruppe wählen.'
  if (!picks?.length) return 'Die Stichprobe ist leer.'
  if (new Set(picks.map((p) => `${p.groupId}#${p.no}`)).size !== picks.length) return 'Ein Raum ist doppelt in der Stichprobe.'
  return ''
}

/** Raumgruppen prüfen, bevor sie gespeichert werden: Text des ersten Problems oder ''. */
export function groupsProblem(groups) {
  if (!groups.length) return 'Bitte mindestens eine Raumgruppe eintragen.'
  for (const g of groups) {
    if (!String(g.name || '').trim()) return 'Jede Raumgruppe braucht einen Namen.'
    if (!(Number(g.rooms) >= 1) || !Number.isInteger(Number(g.rooms))) return `${g.name}: Anzahl Räume als ganze Zahl ab 1 eintragen.`
  }
  if (new Set(groups.map((g) => String(g.name).trim().toLowerCase())).size !== groups.length) return 'Zwei Raumgruppen heißen gleich.'
  return ''
}

// ---------------------------------------------------------------- Verlauf, Nachkontrolle, Reklamationsgefahr

/** Abgeschlossene Messungen eines Objekts, älteste zuerst. */
export function measurementsOf(doc, objectId) {
  return (doc?.measurements || [])
    .filter((m) => m.objectId === objectId && m.status === 'fertig')
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.finishedAt || a.at || '').localeCompare(b.finishedAt || b.at || ''))
}

/** Fallender Verlauf: die letzten drei Kennzahlen fallen jeweils und zusammen um mindestens dropPoints. */
export function falling(scores, dropPoints = SETTINGS_DEFAULTS.dropPoints) {
  const s = scores.filter((x) => x !== null && x !== undefined).slice(-3)
  return s.length === 3 && s[0] > s[1] && s[1] > s[2] && s[0] - s[2] >= dropPoints
}

/**
 * Lage eines Objekts: { list, last, result, recheck: { due, overdue, of }|null, twoBad, falling, risk }.
 * recheck: nach einer schlechten letzten Messung; die nächste Messung erledigt sie.
 */
export function objectStatus({ doc, objectId, today, settings = settingsOf(doc) }) {
  const list = measurementsOf(doc, objectId)
  const last = list.at(-1) || null
  const result = last ? resultOf(last) : null
  const recheck = last && result.poor ? { of: last.id, due: addDays(last.date, settings.recheckDays), overdue: addDays(last.date, settings.recheckDays) < today } : null
  const prev = list.at(-2) || null
  const twoBad = !!(last && prev && result.poor && resultOf(prev).poor)
  const fall = falling(list.map((m) => resultOf(m).score), settings.dropPoints)
  return { list, last, result, recheck, twoBad, falling: fall, risk: twoBad || fall }
}

/**
 * Handlungsbedarf je Objekt (Zu erledigen, digitaler Mitarbeiter): Nachkontrolle offen oder Reklamationsgefahr;
 * inaktive Objekte nicht. [{ objectId, object, last, result, recheck, twoBad, falling, risk }], dringend zuerst
 * (Reklamationsgefahr, dann überfällige Nachkontrolle), dann nach Name.
 */
export function attention({ doc, objects = [], today }) {
  const settings = settingsOf(doc)
  const byId = new Map(objects.map((o) => [o.id, o]))
  const ids = [...new Set((doc?.measurements || []).filter((m) => m.status === 'fertig').map((m) => m.objectId))]
  return ids
    .map((objectId) => ({ objectId, object: byId.get(objectId) || null, ...objectStatus({ doc, objectId, today, settings }) }))
    .filter((g) => !g.object?.inactive && (g.recheck || g.risk))
    .map(({ list, ...g }) => g)
    .sort((a, b) => Number(b.risk) - Number(a.risk) || Number(!!b.recheck?.overdue) - Number(!!a.recheck?.overdue) || (a.object?.name || '').localeCompare(b.object?.name || '', 'de'))
}

/** Dringend: Reklamationsgefahr oder Nachkontrolle überfällig. */
export const isUrgent = (g) => g.risk || !!g.recheck?.overdue

/** Kennzahl je Monat (Mittel der Messungen, null ohne Messung) für die letzten `months` Monate bis today. */
export function monthly(list, { today, months = 12 }) {
  const keys = []
  const [y, mo] = today.slice(0, 7).split('-').map(Number)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys.map((key) => {
    const scores = list.filter((m) => (m.date || '').startsWith(key)).map((m) => resultOf(m).score).filter((s) => s !== null)
    return { key, count: scores.length, score: scores.length ? round1(scores.reduce((s, x) => s + x, 0) / scores.length) : null }
  })
}

// ---------------------------------------------------------------- Raumbuch (Objektdoku)

/** Ordner- und Dateinamen wie in der Objektdoku (dateiSicher): Umlaute ausgeschrieben, Sonderzeichen „-“. */
export const objektdokuName = (s) =>
  String(s ?? '')
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/**
 * Akte eines Objekts in der Objektdoku finden: Dateien [{ path }] unter Objektdoku/[Revier …/]<Nr>_<Objekt>/<Nr>.json.
 * → Pfade der passenden Akten (Ordnername endet auf den Objektnamen), beste zuerst.
 */
export function findAkte(files, objectName) {
  const want = objektdokuName(objectName).toLowerCase()
  if (!want) return []
  return files
    .map((f) => f.path)
    .filter((p) => /\.json$/i.test(p))
    .filter((p) => {
      const parts = p.split('/')
      const folder = (parts.at(-2) || '').toLowerCase()
      return folder === want || folder.endsWith(`_${want}`)
    })
    .sort((a, b) => Number(/Revier /.test(b)) - Number(/Revier /.test(a)) || a.localeCompare(b))
}

const KEYWORDS = [
  ['sanitaer', /wc|toilett|sanit|dusch|\bbad\b|waschraum|urinal|umkleide/i],
  ['kueche', /küche|kueche|kaffee|pantry|sozialraum/i],
  ['verkehr', /gang\b|gänge|flur|stiege|treppe|foyer|eingang|aufzug|lift|podest|windfang|korridor|verkehr/i],
  ['buero', /büro|buero|besprech|sekretariat|empfang|arbeitsplatz|konferenz|meeting|kanzlei/i],
]

/** Raumgruppe zu einem Raumnamen (Schlagworte), sonst ''. */
export function templateFor(name) {
  for (const [id, re] of KEYWORDS) if (re.test(String(name || ''))) return id
  return ''
}

/**
 * Raumgruppen aus dem Raumbuch der Objektdoku (akte.bereiche[].raeume[]): Räume nach Schlagworten im Namen
 * (sonst im Bereich) einer Vorlage zugeordnet, sonst je Bereich eine eigene Gruppe. → [{ name, template, rooms, names }]
 */
export function groupsFromRaumbuch(akte, templates = GROUP_DEFAULTS) {
  const out = new Map()
  for (const b of akte?.bereiche || []) {
    for (const r of b.raeume || []) {
      const name = [r.nr, r.name].map((x) => String(x || '').trim()).filter(Boolean).join(' ')
      if (!name) continue
      const tplId = templateFor(r.name) || templateFor(b.name)
      const tpl = templates.find((t) => t.id === tplId)
      const key = tpl ? `t:${tpl.id}` : `b:${String(b.name || 'Sonstige Räume').trim()}`
      if (!out.has(key)) out.set(key, { name: tpl ? tpl.name : String(b.name || '').trim() || 'Sonstige Räume', template: tpl ? tpl.id : 'sonstige', rooms: 0, names: [] })
      const g = out.get(key)
      g.rooms++
      g.names.push(name)
    }
  }
  return [...out.values()]
}
