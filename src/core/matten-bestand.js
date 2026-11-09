// Mattenwechsel: Mattenbestand und Wäscherei (Paket P17, docs/MATTENWECHSEL-PLAN.md, Entscheidung E16). Reine Funktionen
// ohne Oberfläche (Tests: test/matten-bestand.test.js); Ansicht: ui/views/matten-bestand.js, Wäscherei-Lieferschein:
// export/matten-bestand-pdf.js.
//
// Wie viele eigene Matten je Mattentyp (Artikel der Fakturierung mit group 'Matten', matTypes/matLabel) wo sind:
//   sauber    Lager sauber
//   kunde     beim Kunden: Summe der aktiven Liegeplätze mit owner 'wir' (matten/matten.json) – nie gebucht, immer
//             aus den Liegeplätzen gerechnet
//   fahrzeug  im Fahrzeug: schmutzig von den Touren zurück, wartet auf die Wäscherei
//   waesche   in der Wäscherei
//   schwund   als Schwund (verloren) gebucht, seit der Inventur
//   aus       ausgeschieden (kaputt, abgenutzt), seit der Inventur
// gesamt = sauber + kunde + fahrzeug + waesche (eigene Matten im Umlauf). Kundeneigentum (owner 'kunde') wird mit
// gewaschen, aber nirgends gezählt (auch nicht in der Ladeliste für den sauberen Bestand).
//
// Wie Material & Lager (core/material.js): Der Bestand wird nie gespeichert, sondern gerechnet – Startbestand plus
// Bewegungen (stockMap aus material.js summiert sie je Mattentyp und Ort). Startbestand je Mattentyp ist die letzte
// Inventur, die ihn enthält (Lager sauber, im Fahrzeug, Wäscherei; Stichtag date, erfasst at). Es zählen nur Buchungen
// danach: späterer Tag oder derselbe Tag und später erfasst. Eine nachträglich erfasste Inventur gilt also für das Ende
// ihres Stichtags. Matten werden nicht im Materiallager geführt.
//
// Buchungen (Bewegungen je Zeile):
//   abholung    Wäscherei holt ab: fahrzeug → waesche
//   rueckgabe   Wäscherei liefert zurück: waesche → sauber (qty), → schwund (lost), → aus (retired)
//   zukauf      neue Matten: → sauber
//   ausscheiden aus from (sauber | fahrzeug | waesche) → aus
//   schwund     aus from → schwund
//   korrektur   ± in pool (sauber | fahrzeug | waesche | schwund | aus), Grund Pflicht
//   tour        je abgeschlossenem Stopp: je gewechselter eigener Matte eine saubere vom Lager zum Kunden (sauber − qty)
//               und eine schmutzige zurück (fahrzeug + back); beim ersten Wechsel eines nach der Inventur angelegten
//               Liegeplatzes kommt nichts zurück (Erstausstattung, back 0)
// Touren werden nie doppelt verbucht: je Stopp eine Buchung mit id 'tour:<tourId>:<stopId>', je Liegeplatz und Mattentyp
// eine Zeile mit id '<tourId>:<stopId>:<placementId>:<articleId>' (tourSync vergleicht damit; gleiche id auf zwei Geräten
// führt merge.js zu einer zusammen). Bis das Büro sie speichert, rechnet die Ansicht sie mit (wie die Ergebnisse der
// Touren in der Übersicht).
//
// Datei matten/bestand.json (Büro: Recht matten bearbeiten; Fahrer lesen sie nicht):
//   { schema: 1,
//     settings: { min: { <articleId>: n } (Mindestbestand Lager sauber), laundry: { name, email, contact }, days (7) },
//     bookings: [{ id, kind, date, at, by, note,
//                  lines: [{ articleId, name, qty } | inventur { articleId, name, sauber, fahrzeug, waesche, before? }
//                          | rueckgabe { …, lost, retired } | tour { id, articleId, name, qty, back }],
//                  from? (ausscheiden, schwund), pool? (korrektur), no? und sent[]? (abholung: Wäscherei-Lieferschein),
//                  tourId?, stopId?, text? (tour), cancelled?: { at, by, reason } }] }

import { addDays, dayIndex } from './dates.js'
import { matLabel, matTypes } from './invoicing.js'
import { stockMap } from './material.js'
import { isFinal, localDate, shownQuantity } from './matten-fahrt.js'
import { jobDate } from './matten-plan.js'
import { TOUR_JOB_STATUS } from './matten-tour.js'
import { keysInTours } from './matten-touren.js'

export const SCHEMA = 1
/** Vorschau: so viele Tage ab heute prüft „reicht der saubere Bestand?“ (Einstellung settings.days). */
export const AHEAD_DAYS = 7
/** Tour-Buchungen, die älter sind und vor der letzten Inventur liegen, fallen aus der Datei (sie zählen nicht mehr). */
export const KEEP_DAYS = 400

export const POOLS = { sauber: 'Lager sauber', kunde: 'beim Kunden', fahrzeug: 'im Fahrzeug', waesche: 'Wäscherei', schwund: 'Schwund', aus: 'ausgeschieden' }
/** Was die Inventur zählt (beim Kunden rechnet die App aus den Liegeplätzen). */
export const COUNTED = ['sauber', 'fahrzeug', 'waesche']
export const KINDS = {
  inventur: 'Inventur',
  abholung: 'Wäscherei abgeholt',
  rueckgabe: 'Wäscherei zurück',
  zukauf: 'Zukauf',
  ausscheiden: 'Ausgeschieden',
  schwund: 'Schwund',
  korrektur: 'Korrektur',
  tour: 'Tour',
}
/** Arten im Dialog „Zukauf/Ausscheiden“. */
export const MANUAL_KINDS = ['zukauf', 'ausscheiden', 'schwund', 'korrektur']
/** Woher ausgeschiedene Matten bzw. Schwund kommen. */
export const FROM_POOLS = ['sauber', 'fahrzeug', 'waesche']
/** Wo eine Korrektur bucht. */
export const CORRECT_POOLS = ['sauber', 'fahrzeug', 'waesche', 'schwund', 'aus']
/** Arten mit Grund als Pflicht. */
export const NOTE_REQUIRED = ['ausscheiden', 'schwund', 'korrektur']
/** Ampel je Mattentyp: rot reicht nicht für die geplanten Touren, gelb unter Mindestbestand, grün ausreichend. */
export const LEVELS = { rot: 'reicht nicht', gelb: 'unter Mindestbestand', gruen: 'ausreichend', grau: 'keine Inventur' }

export const emptyBestand = () => ({ schema: SCHEMA, settings: {}, bookings: [] })

/** Datei auf den aktuellen Stand bringen (fehlende Listen). Ändert nichts an vorhandenen Einträgen. */
export function upgradeBestand(doc) {
  const d = doc || emptyBestand()
  d.schema ||= SCHEMA
  d.settings ||= {}
  d.bookings ||= []
  return d
}

const text = (v) => String(v ?? '').trim()
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const whole = (v) => Math.max(0, Math.round(Number(v) || 0))
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0)
/** Reihenfolge der Buchungen: Tag, dann Zeitpunkt der Erfassung. */
export const byWhen = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at || '').localeCompare(String(b.at || '')) || String(a.id).localeCompare(String(b.id))
/** Liegt die Buchung nach der Inventur base (späterer Tag oder derselbe Tag und später erfasst)? */
export const isAfter = (b, base) => !base || String(b.date) > String(base.date) || (b.date === base.date && String(b.at || '') > String(base.at || ''))
export const isActive = (b) => !!b && !b.cancelled

/** Ganze Stückzahl aus einer Eingabe („3“, „ 12 “); leer → null, ungültig → NaN. */
export function parseCount(v, { signed = false } = {}) {
  const s = String(v ?? '').trim().replace(/\s+/g, '')
  if (!s) return null
  if (!(signed ? /^[+−-]?\d+$/ : /^\d+$/).test(s)) return NaN
  return Number(s.replace('−', '-'))
}

// ---------------------------------------------------------------- Einstellungen

export const minOf = (doc, articleId) => whole(doc?.settings?.min?.[articleId])
export const daysOf = (doc) => Math.min(31, Math.max(1, Math.round(Number(doc?.settings?.days) || AHEAD_DAYS)))
/** Wäscherei: { name, email, contact }. */
export const laundryOf = (doc) => ({ name: text(doc?.settings?.laundry?.name), email: text(doc?.settings?.laundry?.email), contact: text(doc?.settings?.laundry?.contact) })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Prüfung der Einstellungen: '' oder Text. */
export function settingsProblem({ laundry = {}, min = {}, days } = {}) {
  if (laundry.email && !EMAIL.test(text(laundry.email))) return `„${laundry.email}“ ist keine gültige E-Mail-Adresse.`
  for (const [id, v] of Object.entries(min || {})) if (v !== null && v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0)) return `Mindestbestand muss eine ganze Zahl ab 0 sein (${id}).`
  if (days !== undefined && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 31)) return 'Vorschau: 1 bis 31 Tage.'
  return ''
}

// ---------------------------------------------------------------- Liegeplätze

/** Anteil eigener Matten an qty Matten eines Typs am Liegeplatz (Kundeneigentum zählt nicht; gemischt: höchstens die eigenen). */
export function ownShare(placement, articleId, qty) {
  const q = whole(qty)
  const mats = (placement?.mats || []).filter((m) => m?.articleId === articleId)
  if (!mats.length) return q
  const kunde = sum(mats.filter((m) => m.owner === 'kunde'), (m) => whole(m.qty))
  if (!kunde) return q
  const wir = sum(mats.filter((m) => m.owner !== 'kunde'), (m) => whole(m.qty))
  return Math.min(q, wir)
}

/**
 * Matten an den aktiven Liegeplätzen je Mattentyp: Map articleId → { articleId, name, size, color, wir, kunde,
 * placements (Liegeplätze mit eigenen Matten) }; dazu untyped: eigene Matten ohne Mattentyp (aus dem Werkzeug).
 */
export function atCustomers(placements = []) {
  const byType = new Map()
  let untyped = 0
  for (const p of placements || []) {
    if (!p?.id || p.active === false) continue
    for (const m of p.mats || []) {
      const q = whole(m?.qty)
      if (!q) continue
      if (!m.articleId) {
        if (m.owner !== 'kunde') untyped += q
        continue
      }
      const r = byType.get(m.articleId) || { articleId: m.articleId, name: text(m.name), size: text(m.size), color: text(m.color), wir: 0, kunde: 0, placements: new Set() }
      if (m.owner === 'kunde') r.kunde += q
      else {
        r.wir += q
        r.placements.add(p.id)
      }
      byType.set(m.articleId, r)
    }
  }
  for (const r of byType.values()) r.placements = r.placements.size
  return { byType, untyped }
}

// ---------------------------------------------------------------- Buchungen → Bewegungen

/** Bewegungen einer Buchung: [{ articleId, loc, qty }] (Inventur: keine, sie setzt den Startbestand). */
export function bookingMoves(b) {
  const out = []
  const mv = (articleId, loc, qty) => {
    if (articleId && qty) out.push({ articleId, loc, qty })
  }
  for (const l of b?.lines || []) {
    const a = l?.articleId
    const q = Number(l?.qty) || 0
    if (b.kind === 'abholung') {
      mv(a, 'fahrzeug', -q)
      mv(a, 'waesche', q)
    } else if (b.kind === 'rueckgabe') {
      const lost = Number(l.lost) || 0
      const retired = Number(l.retired) || 0
      mv(a, 'waesche', -(q + lost + retired))
      mv(a, 'sauber', q)
      mv(a, 'schwund', lost)
      mv(a, 'aus', retired)
    } else if (b.kind === 'zukauf') mv(a, 'sauber', q)
    else if (b.kind === 'ausscheiden' || b.kind === 'schwund') {
      mv(a, FROM_POOLS.includes(b.from) ? b.from : 'sauber', -q)
      mv(a, b.kind === 'schwund' ? 'schwund' : 'aus', q)
    } else if (b.kind === 'korrektur') mv(a, CORRECT_POOLS.includes(b.pool) ? b.pool : 'sauber', q)
    else if (b.kind === 'tour') {
      mv(a, 'sauber', -q)
      mv(a, 'fahrzeug', l.back === undefined || l.back === null ? q : Number(l.back) || 0)
    }
  }
  return out
}

/** Startbestand je Mattentyp: Map articleId → { booking, line, date, at } der letzten gültigen Inventur mit diesem Typ. */
export function basesOf(bookings = []) {
  const out = new Map()
  for (const b of bookings || []) {
    if (b?.kind !== 'inventur' || !isActive(b) || !isDate(b.date)) continue
    for (const l of b.lines || []) {
      if (!l?.articleId) continue
      const old = out.get(l.articleId)
      if (!old || isAfter(b, old.booking)) out.set(l.articleId, { booking: b, line: l, date: b.date, at: b.at || '' })
    }
  }
  return out
}

// ---------------------------------------------------------------- Touren

const matName = (mat = {}) => text(mat.name) || [text(mat.size), text(mat.color)].filter(Boolean).join(', ') || 'Matte'
const stopAt = (tour, stop) => {
  const date = localDate(stop?.finishedAt) || tour?.date || ''
  return { date, at: text(stop?.finishedAt) || `${date}T23:59:59.999Z` }
}

/** Erstausstattung: erster Wechsel eines Liegeplatzes, der nach der Inventur des Typs angelegt wurde (ohne Übernahme). */
function isInitial(placement, base, first) {
  if (!placement || !base || !first || placement.lastExchange?.date) return false
  const created = text(placement.createdAt)
  if (!created) return false
  return isAfter({ date: localDate(created) || created.slice(0, 10), at: created }, base)
}

/**
 * Buchungen aus den Touren (abgeschlossene Stopps, nicht Entwürfe): je Stopp eine Buchung 'tour:<tourId>:<stopId>' mit
 * Tag (Abschluss in Wien) und Zeitpunkt des Abschlusses; je Liegeplatz und Mattentyp eine Zeile
 * '<tourId>:<stopId>:<placementId>:<articleId>' mit der gewechselten Menge eigener Matten (qty) und den schmutzigen,
 * die zurückkommen (back; 0 bei der Erstausstattung). Matten ohne Mattentyp und Kundeneigentum fehlen.
 * bases: Startbestand je Typ (für die Erstausstattung). Liefert die Buchungen nach Zeit sortiert.
 */
export function tourBookings({ tours = [], placements = [], bases = new Map() } = {}) {
  const byId = new Map((placements || []).map((p) => [p?.id, p]))
  const first = new Map() // Liegeplatz → frühester bestätigter Wechsel (Zeitpunkt)
  const events = []
  for (const tour of tours || []) {
    if (!tour?.id || tour.status === 'entwurf') continue
    for (const stop of tour.stops || []) {
      if (!isFinal(stop)) continue
      const when = stopAt(tour, stop)
      if (!isDate(when.date)) continue
      const groups = new Map()
      for (const it of stop.items || []) {
        if (it?.status !== 'gewechselt' || !it.placementId) continue
        const qty = shownQuantity(it)
        if (qty <= 0) continue
        const f = first.get(it.placementId)
        if (!f || isAfter(f, when)) first.set(it.placementId, when)
        const articleId = it.mat?.articleId
        if (!articleId) continue
        const id = `${tour.id}:${stop.id}:${it.placementId}:${articleId}`
        const g = groups.get(id) || { id, articleId, placementId: it.placementId, name: matName(it.mat), qty: 0 }
        g.qty += qty
        groups.set(id, g)
      }
      if (groups.size) events.push({ tour, stop, when, groups })
    }
  }
  const out = []
  for (const { tour, stop, when, groups } of events) {
    const lines = []
    for (const g of groups.values()) {
      const p = byId.get(g.placementId)
      const qty = ownShare(p, g.articleId, g.qty)
      if (qty <= 0) continue
      const f = first.get(g.placementId)
      const initial = isInitial(p, bases.get(g.articleId), f && f.date === when.date && f.at === when.at)
      lines.push({ id: g.id, articleId: g.articleId, name: g.name, qty, back: initial ? 0 : qty })
    }
    if (!lines.length) continue
    out.push({
      id: `tour:${tour.id}:${stop.id}`,
      kind: 'tour',
      date: when.date,
      at: when.at,
      by: text(stop.finishedBy) || text(tour.driverName),
      tourId: tour.id,
      stopId: stop.id,
      text: [text(stop.objectName), text(stop.customer?.name)].filter(Boolean).join(' · '),
      lines,
    })
  }
  return out.sort(byWhen)
}

const sameQty = (a = [], b = []) => a.length === b.length && a.every((l) => b.some((x) => x.id === l.id && Number(x.qty) === Number(l.qty)))

/**
 * Abgleich mit den Touren: { add, update, remove } für die gespeicherten Buchungen. Neu nur, was nach dem Startbestand
 * eines seiner Typen liegt (sonst zählt es nicht); geändert, wenn sich eine Menge geändert hat (Stopp im Büro
 * korrigiert); entfernt, wenn die Tour gelesen ist und der Stopp keinen Wechsel mehr hat (wieder geöffnet). Touren, die
 * nicht gelesen sind, ändern nichts. Zweimal abgleichen ergibt beim zweiten Mal nichts.
 */
export function tourSync({ bookings = [], tours = [], placements = [] } = {}) {
  const bases = basesOf(bookings)
  const want = tourBookings({ tours, placements, bases })
  const have = new Map((bookings || []).filter((b) => b?.kind === 'tour').map((b) => [b.id, b]))
  const loaded = new Set((tours || []).map((t) => t?.id).filter(Boolean))
  const add = []
  const update = []
  const wanted = new Set()
  for (const b of want) {
    wanted.add(b.id)
    const old = have.get(b.id)
    if (!old) {
      if (b.lines.some((l) => bases.has(l.articleId) && isAfter(b, bases.get(l.articleId).booking))) add.push(b)
      continue
    }
    if (sameQty(old.lines, b.lines)) continue
    // Menge geändert: neue Zeilen, bei gleicher Menge bleibt das gespeicherte „zurück“
    const lines = b.lines.map((l) => {
      const was = (old.lines || []).find((x) => x.id === l.id)
      return was && Number(was.qty) === Number(l.qty) ? { ...l, back: was.back } : l
    })
    update.push({ ...old, ...b, lines })
  }
  const remove = [...have.values()].filter((b) => !wanted.has(b.id) && loaded.has(b.tourId)).map((b) => b.id)
  return { add, update, remove }
}

/** Abgleich auf die Buchungen anwenden (Kopie der Liste). */
export function applySync(bookings = [], { add = [], update = [], remove = [] } = {}) {
  const drop = new Set(remove)
  const upd = new Map(update.map((b) => [b.id, b]))
  return [...(bookings || []).filter((b) => !drop.has(b.id)).map((b) => upd.get(b.id) || b), ...add]
}
export const syncCount = (s) => (s?.add?.length || 0) + (s?.update?.length || 0) + (s?.remove?.length || 0)

/**
 * Datei klein halten: Tour-Buchungen älter als KEEP_DAYS Tage fallen weg, wenn jeder ihrer Mattentypen eine spätere
 * Inventur hat (dann zählen sie nicht mehr). Liefert die Liste ohne diese.
 */
export function pruneBookings(bookings = [], today) {
  const bases = basesOf(bookings)
  const limit = addDays(today, -KEEP_DAYS)
  return (bookings || []).filter((b) => !(b?.kind === 'tour' && String(b.date) < limit && (b.lines || []).every((l) => bases.has(l.articleId) && isAfter(bases.get(l.articleId).booking, b))))
}

// ---------------------------------------------------------------- Bestand

/** Gespeicherte Buchungen mit dem Abgleich der Touren (tours: gelesene Touren, null = ohne), nur gültige. */
export function effectiveBookings(doc, { tours = null, placements = [] } = {}) {
  const list = doc?.bookings || []
  const all = tours ? applySync(list, tourSync({ bookings: list, tours, placements })) : list
  return all.filter(isActive)
}

/** Mattentypen für die Tabelle: aus der Fakturierung (Reihenfolge von matTypes), sonst Kopien an Liegeplätzen und Buchungen. */
function typeList({ articles = null, placements = [], bookings = [], min = {} }) {
  const out = new Map()
  const byArticle = new Map((articles || []).map((a) => [a?.id, a]))
  const add = (id, name, size = '', color = '') => {
    if (!id || out.has(id)) return
    const a = byArticle.get(id)
    out.set(id, a ? { articleId: id, name: matLabel(a), size: text(a.size), color: text(a.color), article: true } : { articleId: id, name: text(name) || 'Matte', size: text(size), color: text(color), article: false })
  }
  if (articles) for (const a of matTypes(articles)) add(a.id)
  const known = new Set(out.keys())
  for (const p of placements || []) for (const m of p?.mats || []) if (m?.articleId && m.owner !== 'kunde') add(m.articleId, m.name || matLabel(m), m.size, m.color)
  for (const b of bookings || []) for (const l of b.lines || []) add(l?.articleId, l?.name)
  for (const id of Object.keys(min || {})) if (whole(min[id])) add(id, '')
  const rest = [...out.values()].filter((t) => !known.has(t.articleId)).sort((a, b) => byName(a.name, b.name))
  return [...[...out.values()].filter((t) => known.has(t.articleId)), ...rest]
}

/**
 * Bestand je Mattentyp: [{ articleId, name, size, color, base ({ id, date, at, by } der Inventur | null), sauber,
 * fahrzeug, waesche, schwund, aus (ohne Inventur: null), kunde (eigene an aktiven Liegeplätzen), eigentum
 * (Kundeneigentum an Liegeplätzen, nur zur Info), placements, gesamt (sauber + kunde + fahrzeug + waesche, ohne Inventur
 * null), min (Mindestbestand Lager sauber, 0 = keiner) }].
 *  doc       matten/bestand.json
 *  placements Liegeplätze (matten/matten.json); tours: gelesene Touren (null: nur gespeicherte Buchungen)
 *  articles   Artikel der Fakturierung (null ohne Leserecht: Typen aus den Kopien an den Liegeplätzen)
 */
export function stockRows({ doc, placements = [], tours = null, articles = null } = {}) {
  const d = doc || emptyBestand()
  const active = effectiveBookings(d, { tours, placements })
  const bases = basesOf(active)
  const cust = atCustomers(placements)
  return typeList({ articles, placements, bookings: active, min: d.settings?.min }).map((t) => {
    const base = bases.get(t.articleId)
    const k = cust.byType.get(t.articleId)
    const row = { ...t, base: base ? { id: base.booking.id, date: base.date, at: base.at, by: base.booking.by || '' } : null, sauber: null, fahrzeug: null, waesche: null, schwund: null, aus: null, kunde: k?.wir || 0, eigentum: k?.kunde || 0, placements: k?.placements || 0, gesamt: null, min: minOf(d, t.articleId) }
    if (!t.name || t.name === 'Matte') row.name = k?.name || row.name
    if (!base) return row
    const moves = []
    for (const b of active) if (b.kind !== 'inventur' && isAfter(b, base.booking)) for (const m of bookingMoves(b)) if (m.articleId === t.articleId) moves.push(m)
    const map = stockMap(moves)
    const of = (loc) => map.get(`${t.articleId}|${loc}`) || 0
    for (const p of COUNTED) row[p] = whole(base.line[p]) + of(p)
    row.schwund = of('schwund')
    row.aus = of('aus')
    row.gesamt = row.sauber + row.kunde + row.fahrzeug + row.waesche
    return row
  })
}

/** Summen über alle Typen mit Inventur (Zeile „gesamt“). */
export function stockTotals(rows = []) {
  const withBase = rows.filter((r) => r.base)
  const out = { kunde: sum(rows, (r) => r.kunde), eigentum: sum(rows, (r) => r.eigentum) }
  for (const p of [...COUNTED, 'schwund', 'aus', 'gesamt']) out[p] = withBase.length ? sum(withBase, (r) => r[p] || 0) : null
  return out
}

// ---------------------------------------------------------------- Reicht der saubere Bestand?

const OPEN_TOURS = ['entwurf', 'freigegeben', 'unterwegs']

/**
 * Bedarf an sauberen eigenen Matten je Tag: Map Tag → Map articleId → Stück. Ladelisten der Touren (Entwürfe,
 * freigegeben; unterwegs nur die noch offenen Stopps; ohne vergangene Tage) und fällige Einsätze ohne Tour (am Tag
 * ihres Termins, überfällige heute; je Liegeplatz und Tag einmal).
 */
export function demandByDay({ tours = [], jobs = [], placements = [], today, days = AHEAD_DAYS } = {}) {
  const until = addDays(today, Math.max(1, days) - 1)
  const byId = new Map((placements || []).map((p) => [p?.id, p]))
  const out = new Map()
  const add = (date, articleId, qty) => {
    if (!articleId || qty <= 0) return
    const m = out.get(date) || new Map()
    m.set(articleId, (m.get(articleId) || 0) + qty)
    out.set(date, m)
  }
  for (const t of tours || []) {
    if (!OPEN_TOURS.includes(t?.status) || !isDate(t.date) || t.date < today || t.date > until) continue
    for (const stop of t.stops || []) {
      if (t.status === 'unterwegs' && isFinal(stop)) continue
      // je Liegeplatz und Mattentyp zusammen (ein Liegeplatz mit eigener und Kundenmatte desselben Typs = zwei Einträge)
      const groups = new Map()
      for (const it of stop.items || []) {
        if (!it?.mat?.articleId) continue
        const k = `${it.placementId}|${it.mat.articleId}`
        const g = groups.get(k) || { placementId: it.placementId, articleId: it.mat.articleId, qty: 0 }
        g.qty += whole(it.planned)
        groups.set(k, g)
      }
      for (const g of groups.values()) add(t.date, g.articleId, ownShare(byId.get(g.placementId), g.articleId, g.qty))
    }
  }
  // Einsätze in einer offenen Tour zählen dort (abgeschlossene Touren halten nichts fest: ein dort nicht durchgeführter
  // Wechsel ist wieder offen und kommt als Einsatz ohne Tour dazu)
  const inTour = keysInTours((tours || []).filter((t) => OPEN_TOURS.includes(t?.status)), { today })
  const seen = new Set()
  for (const j of jobs || []) {
    if (!TOUR_JOB_STATUS.includes(j?.status) || inTour.has(j.key)) continue
    const d0 = jobDate(j)
    if (!isDate(d0) || d0 > until) continue
    const date = d0 < today ? today : d0
    const p = byId.get(j.placementId)
    if (!p || p.active === false || seen.has(`${p.id}|${date}`)) continue
    seen.add(`${p.id}|${date}`)
    for (const m of p.mats || []) if (m?.articleId && m.owner !== 'kunde') add(date, m.articleId, whole(m.qty))
  }
  return out
}

/**
 * Reicht der saubere Bestand für die geplanten Touren der nächsten days Tage? Ohne Rücklieferungen der Wäscherei
 * gerechnet (die kommen erst, wenn sie gebucht sind).
 * Liefert { from, to, days, types: [{ articleId, name, stock, need, left, short: { date, missing } | null }],
 *  short: { date, items: [{ articleId, name, stock, need (bis zu diesem Tag), missing }] } | null (erster Tag, an dem
 *  ein Typ fehlt), until (letzter Tag, an dem alles reicht; '' wenn schon heute nicht), unknown: [{ articleId, name,
 *  need }] (Bedarf, aber noch keine Inventur) }.
 */
export function coverage({ rows = [], tours = [], jobs = [], placements = [], today, days = AHEAD_DAYS } = {}) {
  const n = Math.max(1, Math.round(Number(days) || AHEAD_DAYS))
  const to = addDays(today, n - 1)
  const need = demandByDay({ tours, jobs, placements, today, days: n })
  const byType = new Map(rows.map((r) => [r.articleId, r]))
  const copies = atCustomers(placements).byType
  const ids = new Set()
  for (const m of need.values()) for (const id of m.keys()) ids.add(id)
  const types = []
  const unknown = []
  for (const id of ids) {
    const r = byType.get(id)
    let total = 0
    let short = null
    let left = r?.base ? r.sauber : null
    for (let i = 0; i < n; i++) {
      const date = addDays(today, i)
      const q = need.get(date)?.get(id) || 0
      total += q
      if (left === null) continue
      left -= q
      if (left < 0 && !short) short = { date, missing: -left, need: total }
    }
    const name = r?.name || copies.get(id)?.name || 'Matte'
    if (!r?.base) {
      unknown.push({ articleId: id, name, need: total })
      continue
    }
    types.push({ articleId: id, name, stock: r.sauber, need: total, left, short })
  }
  const order = (a, b) => rows.findIndex((r) => r.articleId === a.articleId) - rows.findIndex((r) => r.articleId === b.articleId)
  types.sort(order)
  unknown.sort(order)
  const shortDate = types.map((t) => t.short?.date).filter(Boolean).sort()[0] || ''
  const short = shortDate ? { date: shortDate, items: types.filter((t) => t.short && t.short.date === shortDate).map((t) => ({ articleId: t.articleId, name: t.name, stock: t.stock, need: t.short.need, missing: t.short.missing })) } : null
  return { from: today, to, days: n, types, short, until: shortDate ? (shortDate > today ? addDays(shortDate, -1) : '') : to, unknown }
}

/** Ampel eines Mattentyps (mit coverage): rot reicht nicht, gelb unter Mindestbestand, grün ausreichend, grau keine Inventur. */
export function levelOf(row, cov = null) {
  if (!row?.base) return 'grau'
  if (cov?.types?.some((t) => t.articleId === row.articleId && t.short)) return 'rot'
  if (row.min > 0 && row.sauber < row.min) return 'gelb'
  return 'gruen'
}

/** Mattentypen unter dem Mindestbestand (Lager sauber): [{ articleId, name, sauber, min }]. */
export const belowMin = (rows = []) => rows.filter((r) => r.base && r.min > 0 && r.sauber < r.min).map((r) => ({ articleId: r.articleId, name: r.name, sauber: r.sauber, min: r.min }))

/**
 * Hinweis bei der Freigabe einer Tour: übersteigt die Ladeliste bis zum Tag der Tour (mit den anderen Touren und den
 * fälligen Einsätzen davor) den sauberen Bestand? Liefert { date, items: [{ articleId, name, stock, need, missing }] }
 * für die Mattentypen dieser Tour oder null. Sperrt nichts.
 */
export function tourShortage({ tour, rows = [], tours = [], jobs = [], placements = [], today } = {}) {
  if (!tour || !isDate(tour.date) || tour.date < today) return null
  const list = (tours || []).some((t) => t?.id === tour.id) ? (tours || []).map((t) => (t.id === tour.id ? tour : t)) : [...(tours || []), tour]
  const cov = coverage({ rows, tours: list, jobs, placements, today, days: dayIndex(tour.date) - dayIndex(today) + 1 })
  const mine = new Set()
  for (const s of tour.stops || []) for (const it of s.items || []) if (it?.mat?.articleId) mine.add(it.mat.articleId)
  const items = cov.types.filter((t) => t.short && mine.has(t.articleId)).map((t) => ({ articleId: t.articleId, name: t.name, stock: t.stock, need: t.need, missing: -t.left, date: t.short.date }))
  return items.length ? { date: tour.date, items } : null
}

// ---------------------------------------------------------------- Buchungen anlegen, prüfen, stornieren

const LINE_FIELDS = {
  inventur: ['sauber', 'fahrzeug', 'waesche'],
  rueckgabe: ['qty', 'lost', 'retired'],
}

/**
 * Buchung aus Eingaben (Kopie): Zeilen mit Name des Typs, nur Zeilen mit einer Menge; Inventur mit allen drei Orten.
 * fields: { date, note, lines: [{ articleId, name, qty | sauber/fahrzeug/waesche | lost/retired, before? }], from, pool, no }
 */
export function newBooking(kind, fields = {}, { newId = () => '', now = new Date().toISOString(), by = '' } = {}) {
  const keys = LINE_FIELDS[kind] || ['qty']
  const lines = []
  for (const l of fields.lines || []) {
    if (!l?.articleId) continue
    const line = { articleId: l.articleId, name: text(l.name) || 'Matte' }
    for (const k of keys) line[k] = kind === 'korrektur' ? Math.round(Number(l[k]) || 0) : whole(l[k])
    if (kind === 'inventur' && l.before) line.before = Object.fromEntries(COUNTED.map((p) => [p, l.before[p] === null || l.before[p] === undefined ? null : Number(l.before[p]) || 0]))
    if (kind !== 'inventur' && keys.every((k) => !line[k])) continue
    lines.push(line)
  }
  const b = { id: newId(), kind, date: fields.date, at: now, by, note: text(fields.note), lines }
  if (kind === 'ausscheiden' || kind === 'schwund') b.from = FROM_POOLS.includes(fields.from) ? fields.from : 'sauber'
  if (kind === 'korrektur') b.pool = CORRECT_POOLS.includes(fields.pool) ? fields.pool : 'sauber'
  if (kind === 'abholung' && fields.no) b.no = text(fields.no)
  return b
}

/** Prüfung vor dem Speichern: '' oder Text (deutsch). today: Datum darf nicht in der Zukunft liegen. */
export function bookingProblem(b, { today = '' } = {}) {
  if (!KINDS[b?.kind] || b.kind === 'tour') return 'Unbekannte Buchung.'
  if (!isDate(b.date)) return 'Bitte ein Datum wählen.'
  if (today && b.date > today) return 'Das Datum liegt in der Zukunft.'
  if (!(b.lines || []).length) return b.kind === 'inventur' ? 'Bitte für mindestens einen Mattentyp die gezählten Mengen eintragen.' : 'Bitte mindestens eine Menge eintragen.'
  for (const l of b.lines) {
    const vals = (LINE_FIELDS[b.kind] || ['qty']).map((k) => l[k])
    if (vals.some((v) => !Number.isInteger(v) || (b.kind !== 'korrektur' && v < 0))) return `${l.name || 'Matte'}: nur ganze Stückzahlen.`
  }
  if (NOTE_REQUIRED.includes(b.kind) && !text(b.note)) return b.kind === 'korrektur' ? 'Bitte den Grund der Korrektur angeben.' : 'Bitte den Grund angeben (z. B. kaputt, beim Kunden verloren).'
  return ''
}

/** Stornieren nur für Buchungen von Hand (Touren ergeben sich aus den Touren). '' oder Text. */
export const cancelProblem = (b) => (!b ? 'Die Buchung gibt es nicht mehr.' : b.kind === 'tour' ? 'Buchungen aus Touren ändern sich mit der Tour (Stopp im Büro korrigieren).' : b.cancelled ? 'Schon storniert.' : '')
/** Storniert (Kopie): zählt nicht mehr, bleibt im Verlauf. */
export const cancelBooking = (b, { reason = '', now = new Date().toISOString(), by = '' } = {}) => ({ ...b, cancelled: { at: now, by, reason: text(reason) } })

/** Nächste Nummer eines Wäscherei-Lieferscheins im Jahr: WL-2026-001, WL-2026-002, … */
export function nextSlipNo(bookings = [], year) {
  const prefix = `WL-${year}-`
  const max = Math.max(0, ...(bookings || []).map((b) => String(b?.no || '')).filter((no) => no.startsWith(prefix)).map((no) => Number(no.slice(prefix.length)) || 0))
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

// ---------------------------------------------------------------- Verlauf und Texte

const lineQty = (b, l) => (b.kind === 'inventur' ? COUNTED.map((p) => `${POOLS[p]} ${l[p]}`).join(', ') : b.kind === 'rueckgabe' ? [`${l.qty} sauber`, l.lost ? `${l.lost} Schwund` : '', l.retired ? `${l.retired} ausgeschieden` : ''].filter(Boolean).join(', ') : b.kind === 'korrektur' ? `${l.qty > 0 ? '+' : ''}${l.qty}` : String(l.qty))

/** Kurztext einer Buchung: „Wäscherei abgeholt (WL-2026-001): 12 × 85 × 150 cm, grau“. */
export function describe(b) {
  if (!b) return ''
  const head = `${KINDS[b.kind] || b.kind}${b.no ? ` (${b.no})` : ''}${b.kind === 'korrektur' ? ` ${POOLS[b.pool] || ''}` : ''}${b.kind === 'ausscheiden' || b.kind === 'schwund' ? ` aus ${POOLS[b.from] || POOLS.sauber}` : ''}`
  const lines = (b.lines || []).map((l) => (b.kind === 'inventur' || b.kind === 'rueckgabe' ? `${l.name}: ${lineQty(b, l)}` : `${lineQty(b, l)} × ${l.name}`))
  return `${head}: ${lines.join('; ')}`
}

/** Verlauf: Buchungen (auch stornierte), neueste zuerst; articleId: nur Buchungen mit diesem Typ. */
export function historyOf(bookings = [], { articleId = '', limit = 200 } = {}) {
  return (bookings || [])
    .filter((b) => !articleId || (b.lines || []).some((l) => l.articleId === articleId))
    .sort((a, b) => byWhen(b, a))
    .slice(0, limit)
}

/** Mengen eines Wäscherei-Lieferscheins (Zeilen der Abholung) mit Summe. */
export const slipTotal = (b) => sum(b?.lines || [], (l) => whole(l.qty))

/** Text der E-Mail an die Wäscherei (Lieferschein im Anhang). */
export function laundryMail({ booking, laundry = {}, sender = '', company = '', formatDate = (d) => d }) {
  const n = slipTotal(booking)
  return {
    subject: `Lieferschein ${booking.no || ''} – ${plural(n, 'Matte', 'Matten')} zur Wäsche`.replace(/\s+/g, ' ').trim(),
    text: [
      laundry.contact ? `Guten Tag ${laundry.contact},` : 'Guten Tag,',
      '',
      `anbei der Lieferschein ${booking.no || ''} vom ${formatDate(booking.date)} über ${plural(n, 'Schmutzfangmatte', 'Schmutzfangmatten')} zur Wäsche:`.replace(/\s+/g, ' '),
      '',
      ...(booking.lines || []).map((l) => `- ${l.qty} × ${l.name}`),
      booking.note ? `\n${booking.note}` : '',
      '',
      'Mit freundlichen Grüßen',
      sender || '',
      company || '',
    ]
      .filter((x, i, all) => x !== '' || all[i - 1] !== '')
      .join('\n')
      .trim(),
  }
}

// ---------------------------------------------------------------- Kennzahlen

const inMonth = (d, m) => isDate(d) && d >= m.from && d <= m.to

/**
 * Wäscherei je Monat (months wie lastMonths in core/kpi.js: [{ key, from, to }]): [{ key, abgeholt, zurueck, schwund
 * (Schwund aus Rücklieferungen und Buchungen „Schwund“), aus (ausgeschieden), rate (Schwundquote = Schwund ÷ (zurück +
 * Schwund + ausgeschieden), null ohne Rückmeldung) }]. Stornierte zählen nicht.
 */
export function laundryMonths(bookings = [], months = []) {
  const list = (bookings || []).filter(isActive)
  return months.map((m) => {
    const r = { key: m.key, abgeholt: 0, zurueck: 0, schwund: 0, aus: 0, rate: null }
    for (const b of list) {
      if (!inMonth(b.date, m)) continue
      for (const l of b.lines || []) {
        if (b.kind === 'abholung') r.abgeholt += whole(l.qty)
        else if (b.kind === 'rueckgabe') {
          r.zurueck += whole(l.qty)
          r.schwund += whole(l.lost)
          r.aus += whole(l.retired)
        } else if (b.kind === 'schwund') r.schwund += whole(l.qty)
        else if (b.kind === 'ausscheiden') r.aus += whole(l.qty)
      }
    }
    const base = r.zurueck + r.schwund + r.aus
    r.rate = base ? r.schwund / base : null
    return r
  })
}

// ---------------------------------------------------------------- Rechte

/**
 * Was die Person im Matten-Bestand darf: view (wer das Modul matten sieht – Fahrer nicht), edit (buchen, Inventur,
 * Einstellungen: Recht matten bearbeiten). access aus resolveAccess; ohne (Browser-Modus) alles.
 */
export function bestandRights(access) {
  if (!access) return { view: true, edit: true }
  const view = access.sees('matten')
  return { view, edit: view && access.canEdit('matten') }
}
