// Routing-Schnittstelle des Mattenwechsel-Moduls (P8, rein rechnend, ohne Oberfläche; Tests: test/routing.test.js).
// Plan: docs/MATTENWECHSEL-PLAN.md, Abschnitte 4.4, 6 und 9 (E8: eingebauter Anbieter zuerst, Google später zuschaltbar).
//
// Ein Anbieter (provider) erfüllt diese Schnittstelle (alle drei Methoden async):
//   geocode(adresse)  → { lat, lon, quality, label? } | null       quality wie am Liegeplatz: 'adresse' | 'hand'
//   matrix(punkte)    → { minutes[][], km[][], missing[] }          punkte [{ lat, lon }]; ohne Koordinaten: null-Einträge
//   optimize(problem) → { provider, routes[], unassigned[], minutes, km }
//
//   problem  { depot: { lat, lon }, stops: [{ id, lat, lon, window: { from, to } | null, minutes (Arbeit), demand (Matten) }],
//              drivers: [{ id, start: 'HH:MM', end: 'HH:MM', capacity? (Matten) }], settings?, matrix? ([depot, ...stops]) }
//   routes[] { driverId, stops: [{ id, arrival, start, departure, wait, travel, km }], start, end, minutes (Fahrt), km,
//              work, wait, load, back { travel, km } }        Zeiten 'HH:MM', Dauern in Minuten, km auf 0,1 gerundet
//   unassigned[] { id, reason, text }   reason: koordinaten | zeitfenster | arbeitszeit | kapazitaet | fahrer | betriebshof
//
// Anbieter
//  - 'luftlinie' (eingebaut, kostenlos, immer verfügbar): Fahrzeit = Zuschlag + Luftlinie × Umwegfaktor ÷ Geschwindigkeit
//    (gleiche Annahmen wie estimateTravel in core/geo.js, einstellbar), Geokodierung über OpenStreetMap (Nominatim,
//    höchstens 1 Anfrage je Sekunde). Optimierung siehe planRoutes.
//  - 'google' (Google Maps Platform, Entscheidung E8 vom 9.11.2026): Anfragen gehen über den Durchreicher routing.php
//    am Webspace (Muster ki.php: Microsoft-Anmeldung im Kopf X-Microsoft-Token, Schlüssel nur dort in privat/, Monats-
//    und Tageslimit). Die Zuteilung auf die Fahrer macht weiter planRoutes (Einfügen mit Bedauern); danach fragt der
//    Anbieter je Tour Google (Routes API computeRoutes mit optimierter Reihenfolge, Start und Ziel Betriebshof, höchstens
//    25 Stopps) und rechnet die Ankunftszeiten mit den echten Fahrzeiten neu (scheduleRoute); verletzt die Reihenfolge
//    von Google ein Zeitfenster, gilt die der App mit den Fahrzeiten von Google. An Google gehen nur Koordinaten (bei der
//    Adresssuche die Adresse), keine Namen. Fällt Google aus (kein Schlüssel, Limit, Netz, Fehler), rechnet je Tour der
//    eingebaute Anbieter mit Hinweis (notice) – ein Vorschlag scheitert nie an Google. Kein Schlüssel im Code.
//  - weitere (z. B. 'azure') lassen sich mit registerRoutingProvider anmelden, ohne Umbau.
//
// Navigation am Handy braucht keinen Schlüssel: navigationUrl → Google-Maps-Link.

import { formatTime, toMinutes } from './dates.js'
import { DETOUR, hasCoords, haversineKm, nominatimUrl, parseCoords, parseNominatim } from './geo.js'

/**
 * Vorgaben: speedKmh, baseMin (Zuschlag je Fahrt: Parken, Gehen, Laden) und detour wie estimateTravel; roundMin rundet
 * jede Fahrt auf (1 = ganze Minuten; 5 = genau wie estimateTravel); balance gewichtet die längste Tour gegen die Summe
 * der Fahrzeiten (Ausgleich zwischen Fahrern); maxPasses begrenzt die Verbesserungsrunden (Ergebnis bleibt gleich).
 */
export const ROUTING_DEFAULTS = Object.freeze({ speedKmh: 35, baseMin: 5, detour: DETOUR, roundMin: 1, balance: 0.25, maxPasses: 30 })
/** Arbeitszeit eines Fahrers ohne Angabe. */
export const DEFAULT_SHIFT = Object.freeze({ start: '07:00', end: '15:30' })

export const REASONS = {
  koordinaten: 'keine Koordinaten',
  zeitfenster: 'Zeitfenster nicht einzuhalten',
  arbeitszeit: 'Arbeitszeit reicht nicht',
  kapazitaet: 'Fahrzeug voll (Matten)',
  fahrer: 'kein Fahrer eingeteilt',
  betriebshof: 'Betriebshof ohne Koordinaten',
}

/** Fehler eines Anbieters; code 'nicht-eingerichtet' = Anbieter (noch) nicht verfügbar → Rückfall auf 'luftlinie'. */
export class RoutingError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RoutingError'
    this.code = code
  }
}

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))
const minutesOf = (v, fallback) => (isTime(v) ? toMinutes(v) : fallback)
const round1 = (x) => Math.round(x * 10) / 10
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)

// ---------------------------------------------------------------- Navigation

/** Google-Maps-Link „Route dorthin“ (Koordinaten bevorzugt, sonst die Adresse); ohne beides ''. */
export function navigationUrl({ lat, lon, address } = {}) {
  const base = 'https://www.google.com/maps/dir/?api=1&destination='
  if (hasCoords({ lat, lon })) return `${base}${lat},${lon}`
  const text = String(address ?? '').trim()
  return text ? base + encodeURIComponent(text) : ''
}

// ---------------------------------------------------------------- Matrix (Luftlinie)

/** Einstellungen der Fahrzeitschätzung mit Vorgaben. */
export function travelSettings(settings = {}) {
  const s = settings || {}
  return {
    speedKmh: Math.max(5, num(s.speedKmh, ROUTING_DEFAULTS.speedKmh)),
    baseMin: Math.max(0, num(s.baseMin, ROUTING_DEFAULTS.baseMin)),
    detour: Math.max(1, num(s.detour, ROUTING_DEFAULTS.detour)),
    roundMin: Math.max(0, num(s.roundMin, ROUTING_DEFAULTS.roundMin)),
  }
}

/** Eine Fahrt: [Minuten, km Straße]; unter 100 m Luftlinie 0 (wie estimateTravel). */
function leg(a, b, cfg) {
  const air = haversineKm(a, b)
  if (air < 0.1) return [0, 0]
  const road = air * cfg.detour
  const raw = cfg.baseMin + (road / cfg.speedKmh) * 60
  return [cfg.roundMin > 0 ? Math.ceil(raw / cfg.roundMin - 1e-9) * cfg.roundMin : raw, round1(road)]
}

/**
 * Fahrzeiten und Entfernungen zwischen allen Punkten (symmetrisch, Diagonale 0): { minutes[][], km[][], missing[] }.
 * Punkte ohne Koordinaten: ihre Einträge sind null, der Index steht in missing.
 */
export function airMatrix(points = [], settings = {}) {
  const cfg = travelSettings(settings)
  const n = points.length
  const ok = points.map((p) => hasCoords(p))
  const minutes = Array.from({ length: n }, () => new Array(n).fill(null))
  const km = Array.from({ length: n }, () => new Array(n).fill(null))
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue
    minutes[i][i] = 0
    km[i][i] = 0
    for (let j = i + 1; j < n; j++) {
      if (!ok[j]) continue
      const [m, k] = leg(points[i], points[j], cfg)
      minutes[i][j] = minutes[j][i] = m
      km[i][j] = km[j][i] = k
    }
  }
  return { minutes, km, missing: ok.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0) }
}

const validMatrix = (m, n) => !!m && Array.isArray(m.minutes) && Array.isArray(m.km) && m.minutes.length === n && m.km.length === n

// ---------------------------------------------------------------- Zeitplan einer festen Reihenfolge

const windowOf = (w) => ({ e: minutesOf(w?.from, -Infinity), to: minutesOf(w?.to, Infinity) })
const fmt = (min) => (Number.isFinite(min) ? formatTime(Math.round(min)) : '')

/**
 * Zeitplan für eine feste Reihenfolge (z. B. nach manueller Änderung): Abfahrt am Betriebshof zum Arbeitsbeginn, warten
 * bis zum Beginn eines Zeitfensters, Arbeit muss bis zum Ende des Zeitfensters fertig sein, zurück zum Betriebshof.
 * Verstöße werden nicht korrigiert, sondern gemeldet: problems [{ code, id?, text }] (zeitfenster, arbeitszeit,
 * kapazitaet, koordinaten). Stopps ohne Koordinaten zählen ohne Fahrt (Fahrt vom letzten Punkt mit Koordinaten).
 * matrix: über [depot, ...stops] (sonst Luftlinie mit settings).
 */
export function scheduleRoute({ depot, stops = [], driver = {}, settings = {}, matrix = null } = {}) {
  const points = [depot || {}, ...stops]
  const M = validMatrix(matrix, points.length) ? matrix : airMatrix(points, settings)
  const start = minutesOf(driver.start, toMinutes(DEFAULT_SHIFT.start))
  const end = minutesOf(driver.end, toMinutes(DEFAULT_SHIFT.end))
  const cap = num(driver.capacity, 0) > 0 ? Number(driver.capacity) : Infinity
  const problems = []
  const out = []
  let t = start
  let prev = 0
  let travelSum = 0
  let kmSum = 0
  let work = 0
  let wait = 0
  let load = 0
  stops.forEach((s, k) => {
    const node = k + 1
    let travel = M.minutes[prev]?.[node]
    let km = M.km[prev]?.[node]
    if (travel === null || travel === undefined) {
      travel = 0
      km = 0
      problems.push({ code: 'koordinaten', id: s.id, text: `${REASONS.koordinaten}: Fahrzeit unbekannt` })
    } else prev = node
    const { e, to } = windowOf(s.window)
    const minutes = Math.max(0, num(s.minutes, 0))
    const arrival = t + travel
    const begin = Math.max(arrival, e)
    const departure = begin + minutes
    if (departure > to || e >= to) problems.push({ code: 'zeitfenster', id: s.id, text: e >= to ? 'Zeitfenster der Liegeplätze überschneiden sich nicht' : `fertig ${fmt(departure)}, Zeitfenster bis ${fmt(to)}` })
    out.push({ id: s.id, arrival: fmt(arrival), start: fmt(begin), departure: fmt(departure), wait: Math.round(begin - arrival), travel: Math.round(travel), km: round1(km || 0) })
    travelSum += travel
    kmSum += km || 0
    work += minutes
    wait += begin - arrival
    load += Math.max(0, num(s.demand, 0))
    t = departure
  })
  let back = { travel: 0, km: 0 }
  if (stops.length) {
    const travel = M.minutes[prev]?.[0]
    back = { travel: Math.round(travel ?? 0), km: round1(M.km[prev]?.[0] ?? 0) }
    if (travel === null || travel === undefined) problems.push({ code: 'koordinaten', text: REASONS.betriebshof })
    t += travel ?? 0
    travelSum += travel ?? 0
    kmSum += M.km[prev]?.[0] ?? 0
  }
  if (t > end) problems.push({ code: 'arbeitszeit', text: `zurück ${fmt(t)}, Arbeitszeit bis ${fmt(end)}` })
  if (load > cap) problems.push({ code: 'kapazitaet', text: `${load} Matten, Platz für ${cap}` })
  return { stops: out, start: fmt(start), end: fmt(stops.length ? t : start), minutes: Math.round(travelSum), km: round1(kmSum), work, wait: Math.round(wait), load, back, problems }
}

// ---------------------------------------------------------------- Optimierung (eingebauter Anbieter)

const EPS = 1e-6
const BIG = 1e9

/** Rechenkontext: flache Matrizen (Fahrzeit T, Kosten C = Minuten + km/1000 als Gleichstands-Entscheider). */
function context(problem, cfg) {
  const inStops = problem.stops || []
  const points = [problem.depot || {}, ...inStops]
  const M = validMatrix(problem.matrix, points.length) ? problem.matrix : airMatrix(points, cfg)
  const n = points.length
  const T = new Float64Array(n * n)
  const C = new Float64Array(n * n)
  const K = new Float64Array(n * n)
  const known = (i, j) => {
    const t = M.minutes[i]?.[j]
    return t !== null && t !== undefined && Number.isFinite(Number(t))
  }
  // erreichbar = Hin- und Rückfahrt zum Betriebshof bekannt; fehlt eine Fahrt zwischen zwei Stopps, gilt sie als unmöglich
  const reachable = Array.from({ length: n }, (_, u) => known(0, u) && known(u, 0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!known(i, j)) {
        T[i * n + j] = C[i * n + j] = 1e6
        continue
      }
      const t = Number(M.minutes[i][j])
      const k = Number(M.km[i]?.[j]) || 0
      T[i * n + j] = t
      K[i * n + j] = k
      C[i * n + j] = t + k / 1000
    }
  }
  const S = [{ e: -Infinity, l: Infinity, to: Infinity, s: 0, q: 0 }]
  inStops.forEach((s, k) => {
    const { e, to } = windowOf(s.window)
    const work = Math.max(0, num(s.minutes, 0))
    S.push({ node: k + 1, id: s.id, e, to, l: to - work, s: work, q: Math.max(0, num(s.demand, 0)) })
  })
  const depotOk = hasCoords(problem.depot) || (validMatrix(problem.matrix, n) && known(0, 0))
  return { n, T, C, K, S, reachable, depotOk }
}

function newRoute(drv) {
  return { drv, seq: [], D: [], L: [], cost: 0, end: drv.start, load: 0, wait: 0, dur: 0 }
}

/** Abfahrtszeiten D, späteste Beginnzeiten L (Rest bleibt machbar), Kosten, Ende, Ladung und Dauer neu rechnen. */
function refresh(ctx, r) {
  const { T, C, S, n } = ctx
  const m = r.seq.length
  r.D = new Array(m)
  r.L = new Array(m)
  let t = r.drv.start
  let prev = 0
  let cost = 0
  let load = 0
  let wait = 0
  for (let k = 0; k < m; k++) {
    const i = r.seq[k]
    const st = S[i]
    t += T[prev * n + i]
    cost += C[prev * n + i]
    if (t < st.e) {
      wait += st.e - t
      t = st.e
    }
    t += st.s
    r.D[k] = t
    load += st.q
    prev = i
  }
  if (m) {
    t += T[prev * n]
    cost += C[prev * n]
  }
  r.end = t
  r.cost = cost
  r.load = load
  r.wait = wait
  r.dur = m ? t - r.drv.start : 0
  let late = r.drv.end
  let next = 0
  for (let k = m - 1; k >= 0; k--) {
    const i = r.seq[k]
    const st = S[i]
    late = Math.min(st.l, late - T[i * n + next] - st.s)
    r.L[k] = late
    next = i
  }
}

/** Reihenfolge prüfen: { cost, end, dur } oder null (Zeitfenster, Arbeitszeit, Kapazität). relax: { windows, capacity } ignorieren. */
function simulate(ctx, drv, seq, relax = {}) {
  const { T, C, S, n } = ctx
  let t = drv.start
  let prev = 0
  let cost = 0
  let load = 0
  for (const i of seq) {
    const st = S[i]
    t += T[prev * n + i]
    cost += C[prev * n + i]
    if (!relax.windows) {
      if (t < st.e) t = st.e
      if (t > st.l + EPS) return null
    }
    t += st.s
    load += st.q
    prev = i
  }
  if (seq.length) {
    t += T[prev * n]
    cost += C[prev * n]
  }
  if (t > drv.end + EPS) return null
  if (!relax.capacity && load > drv.cap + EPS) return null
  return { cost, end: t, dur: seq.length ? t - drv.start : 0 }
}

/** Billigste machbare Stelle für u in Route r (Prüfung je Stelle in O(1) über die spätesten Beginnzeiten): { pos, delta } | null. */
function bestInsert(ctx, r, u) {
  const { T, C, S, n } = ctx
  const st = S[u]
  if (r.load + st.q > r.drv.cap + EPS) return null
  const m = r.seq.length
  let best = null
  for (let p = 0; p <= m; p++) {
    const a = p === 0 ? 0 : r.seq[p - 1]
    let t = (p === 0 ? r.drv.start : r.D[p - 1]) + T[a * n + u]
    if (t < st.e) t = st.e
    if (t > st.l + EPS) continue
    const b = p === m ? 0 : r.seq[p]
    t += st.s + T[u * n + b]
    if (p === m) {
      if (t > r.drv.end + EPS) continue
    } else if (Math.max(t, S[b].e) > r.L[p] + EPS) continue
    const delta = C[a * n + u] + C[u * n + b] - C[a * n + b]
    if (!best || delta < best.delta - EPS) best = { pos: p, delta }
  }
  return best
}

/** Gesamtziel: Summe der Kosten + balance × längste Tour (Dauer vom Arbeitsbeginn bis zur Rückkehr). */
function objective(routes, balance, override = null) {
  let sum = 0
  let max = 0
  for (const r of routes) {
    const o = override?.get(r)
    sum += o ? o.cost : r.cost
    max = Math.max(max, o ? o.dur : r.dur)
  }
  return sum + balance * max
}

/** Einfügen mit Bedauern (Regret-2): zuerst der Stopp, der am meisten verliert, wenn er nicht in seine beste Tour kommt. */
function insertAll(ctx, routes, pending) {
  let changed = false
  while (pending.size) {
    let pick = null
    for (const u of pending) {
      let b1 = null
      let b2 = null
      for (const r of routes) {
        const ins = bestInsert(ctx, r, u)
        if (!ins) continue
        const cand = { r, pos: ins.pos, delta: ins.delta }
        if (!b1 || cand.delta < b1.delta - EPS) {
          b2 = b1
          b1 = cand
        } else if (!b2 || cand.delta < b2.delta - EPS) b2 = cand
      }
      if (!b1) continue
      const regret = b2 ? b2.delta - b1.delta : BIG
      if (!pick || regret > pick.regret + EPS || (Math.abs(regret - pick.regret) <= EPS && b1.delta < pick.delta - EPS)) pick = { u, ...b1, regret }
    }
    if (!pick) break
    pick.r.seq.splice(pick.pos, 0, pick.u)
    refresh(ctx, pick.r)
    pending.delete(pick.u)
    changed = true
  }
  return changed
}

/** Startpunkte: je Fahrer ein Stopp, möglichst weit vom Betriebshof und voneinander (jeder Fahrer wird genutzt). */
function seed(ctx, routes, pending) {
  const { T, n } = ctx
  const chosen = [0]
  for (const r of routes) {
    let best = -1
    let bestDist = -1
    for (const u of pending) {
      if (!simulate(ctx, r.drv, [u])) continue
      let d = Infinity
      for (const c of chosen) d = Math.min(d, T[c * n + u])
      if (d > bestDist + EPS) {
        bestDist = d
        best = u
      }
    }
    if (best < 0) continue
    r.seq = [best]
    refresh(ctx, r)
    pending.delete(best)
    chosen.push(best)
  }
}

/** 2-opt innerhalb einer Tour (Abschnitt umdrehen), erste Verbesserung, bis nichts mehr hilft. */
function twoOpt(ctx, routes, r, balance) {
  const { C, n } = ctx
  let improved = false
  for (let guard = 0; guard < 10000; guard++) {
    const seq = r.seq
    const m = seq.length
    let moved = false
    for (let i = 0; i < m - 1 && !moved; i++) {
      const a = i === 0 ? 0 : seq[i - 1]
      for (let j = i + 1; j < m; j++) {
        const b = j === m - 1 ? 0 : seq[j + 1]
        if (C[a * n + seq[j]] + C[seq[i] * n + b] - C[a * n + seq[i]] - C[seq[j] * n + b] >= -EPS) continue
        const cand = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1))
        if (accept(ctx, routes, r, cand, balance)) {
          moved = true
          break
        }
      }
    }
    if (!moved) break
    improved = true
  }
  return improved
}

/** Or-opt innerhalb einer Tour: Abschnitt aus 1–3 Stopps (auch umgedreht) an eine andere Stelle setzen. */
function orOpt(ctx, routes, r, balance) {
  const { C, n } = ctx
  let improved = false
  for (let guard = 0; guard < 10000; guard++) {
    const seq = r.seq
    const m = seq.length
    let moved = false
    for (let len = 1; len <= 3 && !moved; len++) {
      for (let i = 0; i + len <= m && !moved; i++) {
        const prev = i === 0 ? 0 : seq[i - 1]
        const first = seq[i]
        const last = seq[i + len - 1]
        const next = i + len === m ? 0 : seq[i + len]
        const gain = C[prev * n + first] + C[last * n + next] - C[prev * n + next]
        const rest = seq.slice(0, i).concat(seq.slice(i + len))
        for (let p = 0; p <= rest.length && !moved; p++) {
          if (p === i) continue
          const a = p === 0 ? 0 : rest[p - 1]
          const b = p === rest.length ? 0 : rest[p]
          for (const rev of len === 1 ? [false] : [false, true]) {
            const x = rev ? last : first
            const y = rev ? first : last
            if (C[a * n + x] + C[y * n + b] - C[a * n + b] - gain >= -EPS) continue
            const seg = seq.slice(i, i + len)
            if (rev) seg.reverse()
            if (accept(ctx, routes, r, rest.slice(0, p).concat(seg, rest.slice(p)), balance)) {
              moved = true
              break
            }
          }
        }
      }
    }
    if (!moved) break
    improved = true
  }
  return improved
}

/** Neue Reihenfolge übernehmen, wenn machbar und das Gesamtziel sinkt. */
function accept(ctx, routes, r, cand, balance) {
  const sim = simulate(ctx, r.drv, cand)
  if (!sim) return false
  if (objective(routes, balance, new Map([[r, sim]])) >= objective(routes, balance) - EPS) return false
  r.seq = cand
  refresh(ctx, r)
  return true
}

/** Stopp in eine andere Tour verlegen (Ausgleich zwischen Fahrern); keine Tour wird dabei leer. */
function relocate(ctx, routes, balance) {
  const { T, C, S, n } = ctx
  let improved = false
  for (let guard = 0; guard < 10000; guard++) {
    let moved = false
    const base = objective(routes, balance)
    const maxDur = Math.max(0, ...routes.map((r) => r.dur))
    for (const r1 of routes) {
      if (r1.seq.length < 2) continue
      for (let k = 0; k < r1.seq.length && !moved; k++) {
        const u = r1.seq[k]
        const prev = k === 0 ? 0 : r1.seq[k - 1]
        const next = k === r1.seq.length - 1 ? 0 : r1.seq[k + 1]
        const gain = C[prev * n + u] + C[u * n + next] - C[prev * n + next]
        const gainT = T[prev * n + u] + T[u * n + next] - T[prev * n + next]
        for (const r2 of routes) {
          if (r2 === r1) continue
          const ins = bestInsert(ctx, r2, u)
          if (!ins) continue
          // grobe Vorprüfung (ohne Wartezeiten), erst dann genau rechnen
          const a = ins.pos === 0 ? 0 : r2.seq[ins.pos - 1]
          const b = ins.pos === r2.seq.length ? 0 : r2.seq[ins.pos]
          const addT = T[a * n + u] + T[u * n + b] - T[a * n + b] + S[u].s
          const others = Math.max(0, ...routes.filter((x) => x !== r1 && x !== r2).map((x) => x.dur))
          const approxMax = Math.max(others, r1.dur - gainT - S[u].s, r2.dur + addT)
          if (ins.delta - gain + balance * (approxMax - maxDur) >= -EPS) continue
          const seq1 = r1.seq.filter((_, i) => i !== k)
          const seq2 = r2.seq.slice(0, ins.pos).concat([u], r2.seq.slice(ins.pos))
          const s1 = simulate(ctx, r1.drv, seq1)
          const s2 = s1 && simulate(ctx, r2.drv, seq2)
          if (!s2) continue
          if (objective(routes, balance, new Map([[r1, s1], [r2, s2]])) >= base - EPS) continue
          r1.seq = seq1
          r2.seq = seq2
          refresh(ctx, r1)
          refresh(ctx, r2)
          moved = true
          break
        }
      }
      if (moved) break
    }
    if (!moved) break
    improved = true
  }
  return improved
}

/** Grund, warum ein Stopp in keine Tour passt (Reihenfolge der Prüfung: allein → Kapazität → Zeitfenster → Arbeitszeit). */
function reasonFor(ctx, routes, u) {
  const st = ctx.S[u]
  const span = (d) => `${fmt(d.start)}–${fmt(d.end)}`
  const win = `${Number.isFinite(st.e) ? fmt(st.e) : ''}–${Number.isFinite(st.to) ? fmt(st.to) : ''}`
  if (st.e >= st.to) return { reason: 'zeitfenster', text: 'Zeitfenster der Liegeplätze überschneiden sich nicht' }
  if (routes.every((r) => st.q > r.drv.cap + EPS)) return { reason: 'kapazitaet', text: `${st.q} Matten passen in kein Fahrzeug` }
  const alone = routes.map((r) => ({ win: !!simulate(ctx, { ...r.drv, end: Infinity }, [u], { capacity: true }), full: !!simulate(ctx, r.drv, [u], { capacity: true }) }))
  if (!alone.some((x) => x.win)) return { reason: 'zeitfenster', text: `Zeitfenster ${win} mit der Arbeitszeit nicht erreichbar` }
  if (!alone.some((x) => x.full)) return { reason: 'arbeitszeit', text: `Arbeitszeit ${span(routes[0].drv)} reicht für Hin- und Rückfahrt nicht` }
  const fits = (relax) =>
    routes.some((r) => {
      for (let p = 0; p <= r.seq.length; p++) if (simulate(ctx, r.drv, r.seq.slice(0, p).concat([u], r.seq.slice(p)), relax)) return true
      return false
    })
  if (fits({ capacity: true })) return { reason: 'kapazitaet', text: 'Fahrzeuge sind voll' }
  if (fits({ capacity: true, windows: true })) return { reason: 'zeitfenster', text: `Zeitfenster ${win} passt in keine Tour` }
  return { reason: 'arbeitszeit', text: 'Arbeitszeit der Fahrer ist ausgeschöpft' }
}

/** Ergebnis einer Tour: Zeiten je Stopp wie scheduleRoute. */
function describe(ctx, r, inStops) {
  const { T, K, S, n } = ctx
  let t = r.drv.start
  let prev = 0
  let travelSum = 0
  let kmSum = 0
  let work = 0
  let wait = 0
  const stops = r.seq.map((i) => {
    const st = S[i]
    const travel = T[prev * n + i]
    const km = K[prev * n + i]
    const arrival = t + travel
    const begin = Math.max(arrival, st.e)
    t = begin + st.s
    travelSum += travel
    kmSum += km
    work += st.s
    wait += begin - arrival
    prev = i
    return { id: inStops[i - 1].id, arrival: fmt(arrival), start: fmt(begin), departure: fmt(t), wait: Math.round(begin - arrival), travel: Math.round(travel), km: round1(km) }
  })
  const back = r.seq.length ? { travel: Math.round(T[prev * n]), km: round1(K[prev * n]) } : { travel: 0, km: 0 }
  if (r.seq.length) {
    travelSum += T[prev * n]
    kmSum += K[prev * n]
    t += T[prev * n]
  }
  return { driverId: r.drv.id, stops, start: fmt(r.drv.start), end: fmt(r.seq.length ? t : r.drv.start), minutes: Math.round(travelSum), km: round1(kmSum), work, wait: Math.round(wait), load: r.load, back }
}

/**
 * Touren für mehrere Fahrer planen (eingebauter Anbieter, synchron; optimize ruft das auf). Deterministisch: gleiche
 * Eingabe → gleiches Ergebnis (keine Zufallszahlen, feste Reihenfolge bei Gleichstand, begrenzte Runden).
 *
 * Verfahren: (1) Stopps ohne Koordinaten und unmögliche (Zeitfenster, Arbeitszeit, Kapazität schon allein) aussortieren;
 * (2) je Fahrer ein Startpunkt (am weitesten vom Betriebshof und von den anderen) – so wird jeder Fahrer genutzt;
 * (3) Einfügen mit Bedauern (Regret-2) an der jeweils billigsten machbaren Stelle aller Touren, mit Prüfung der
 * Ankunftszeiten gegen Zeitfenster und Arbeitsende; (4) Verbesserung: 2-opt und Or-opt innerhalb jeder Tour, Verlegen
 * einzelner Stopps zwischen Touren (Ziel: Summe der Fahrzeiten + balance × längste Tour), danach Übriggebliebene erneut
 * einfügen – bis nichts mehr besser wird (höchstens maxPasses Runden). Pausen werden nicht eingeplant.
 */
export function planRoutes(problem = {}) {
  const cfg = { ...ROUTING_DEFAULTS, ...(problem.settings || {}) }
  const balance = Math.max(0, num(cfg.balance, ROUTING_DEFAULTS.balance))
  const inStops = problem.stops || []
  const ctx = context(problem, travelSettings(cfg))
  const drivers = (problem.drivers || []).map((d) => ({
    id: d.id,
    start: minutesOf(d.start, toMinutes(DEFAULT_SHIFT.start)),
    end: minutesOf(d.end, toMinutes(DEFAULT_SHIFT.end)),
    cap: num(d.capacity, 0) > 0 ? Number(d.capacity) : Infinity,
  }))
  const routes = drivers.filter((d) => d.start < d.end).map(newRoute)
  const unassigned = new Map()
  const pending = new Set()
  inStops.forEach((s, k) => {
    const u = k + 1
    if (!ctx.depotOk) unassigned.set(u, { reason: 'betriebshof', text: 'Betriebshof ohne Koordinaten – bitte in den Einstellungen eintragen' })
    else if (!ctx.reachable[u]) unassigned.set(u, { reason: 'koordinaten', text: 'keine Koordinaten – bitte am Objekt eintragen oder suchen' })
    else if (!routes.length) unassigned.set(u, { reason: 'fahrer', text: 'kein Fahrer mit Arbeitszeit eingeteilt' })
    else pending.add(u)
  })
  for (const u of [...pending]) {
    if (!routes.some((r) => simulate(ctx, r.drv, [u]))) {
      unassigned.set(u, reasonFor(ctx, routes, u))
      pending.delete(u)
    }
  }
  if (routes.length) {
    seed(ctx, routes, pending)
    insertAll(ctx, routes, pending)
    for (let pass = 0; pass < Math.max(1, cfg.maxPasses); pass++) {
      let improved = false
      for (const r of routes) {
        if (twoOpt(ctx, routes, r, balance)) improved = true
        if (orOpt(ctx, routes, r, balance)) improved = true
      }
      if (routes.length > 1 && relocate(ctx, routes, balance)) improved = true
      if (pending.size && insertAll(ctx, routes, pending)) improved = true
      if (!improved) break
    }
  }
  for (const u of pending) unassigned.set(u, reasonFor(ctx, routes, u))
  const out = routes.map((r) => describe(ctx, r, inStops))
  return {
    provider: 'luftlinie',
    routes: out,
    unassigned: [...unassigned.entries()].sort((a, b) => a[0] - b[0]).map(([u, x]) => ({ id: inStops[u - 1].id, ...x })),
    minutes: out.reduce((s, r) => s + r.minutes, 0),
    km: round1(out.reduce((s, r) => s + r.km, 0)),
  }
}

// ---------------------------------------------------------------- Anbieter

/** Eingebauter Anbieter. fetch und minInterval (Abstand der Nominatim-Anfragen) lassen sich für Tests ersetzen. */
export function createLuftlinieProvider({ fetch: fetchFn = (...a) => globalThis.fetch(...a), minInterval = 1100, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity
  return {
    name: 'luftlinie',
    label: 'Eingebaut (Luftlinie)',
    ready: () => true,
    /** Koordinaten-Text („47.8, 13.04“) direkt, sonst OpenStreetMap (Nominatim, Österreich). */
    async geocode(address) {
      const text = String(address ?? '').trim()
      if (!text) return null
      const c = parseCoords(text)
      if (c) return { ...c, quality: 'hand' }
      const wait = last + minInterval - now()
      if (wait > 0) await sleep(wait)
      last = now()
      const res = await fetchFn(nominatimUrl(text), { headers: { Accept: 'application/json', 'Accept-Language': 'de' } })
      if (!res.ok) throw new RoutingError('geocode', `OpenStreetMap antwortet ${res.status}`)
      const hit = parseNominatim(await res.json())
      return hit ? { lat: hit.lat, lon: hit.lon, quality: 'adresse', label: hit.label } : null
    },
    async matrix(points, settings = {}) {
      return airMatrix(points, settings)
    },
    async optimize(problem) {
      return { ...planRoutes(problem), provider: 'luftlinie' }
    },
  }
}

// ---------------------------------------------------------------- Google (über routing.php am Webspace)

/** Durchreicher am Webspace (routing.php, Muster ki.php): Schlüssel nur dort, Anmeldung mit dem Microsoft-Token. */
export const GOOGLE_ENDPOINT = 'routing.php'
export const GOOGLE_ACTIONS = ['status', 'einrichten', 'geocode', 'optimize']
/** Höchstens so viele Stopps je Tour gehen an Google (Routes API: 25 Zwischenziele mit optimierter Reihenfolge). */
export const GOOGLE_MAX_STOPS = 25
/** Vorgaben der Limits am Webspace (Anfragen an Google zusammen): im Monat so, dass es im Gratis-Kontingent bleibt. */
export const GOOGLE_LIMITS = Object.freeze({ month: 1000, day: 100 })
/**
 * Preise der Google Maps Platform für die grobe Kostenschätzung in US-Dollar, Stand 9.11.2026 – bitte im Google-Konto
 * prüfen: Compute Routes (mit optimierter Reihenfolge) 10 US-Dollar je 1000 Anfragen über 5000 Gratis-Anfragen im Monat,
 * Geocoding 5 US-Dollar je 1000 über 10000 Gratis-Anfragen im Monat.
 */
export const GOOGLE_PRICES = Object.freeze({ asOf: '2026-11-09', routes: Object.freeze({ free: 5000, per1000: 10 }), geocode: Object.freeze({ free: 10000, per1000: 5 }) })
/** Format eines API-Schlüssels der Google Maps Platform (nur zur Prüfung vor dem Senden; der Schlüssel bleibt am Webspace). */
export const GOOGLE_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/

const round2 = (x) => Math.round(x * 100) / 100

/** Grobe Kosten eines Monats aus den Zählern { routen, geocode } (US-Dollar, nach Abzug der Gratis-Anfragen). */
export function googleCost({ routen = 0, geocode = 0 } = {}, prices = GOOGLE_PRICES) {
  const part = (n, p) => (Math.max(0, (Number(n) || 0) - p.free) / 1000) * p.per1000
  const routes = part(routen, prices.routes)
  const geo = part(geocode, prices.geocode)
  return { routes: round2(routes), geocode: round2(geo), total: round2(routes + geo) }
}

/**
 * Anfrage an den Durchreicher: status per GET, sonst POST <endpoint>?aktion=<…> mit JSON. Kopf X-Microsoft-Token
 * (Anmeldung wie ki.php); der Schlüssel liegt nur am Webspace (privat/), nie in der App.
 */
export function googleRequest(action, body, { endpoint = GOOGLE_ENDPOINT, token = '' } = {}) {
  if (!GOOGLE_ACTIONS.includes(action)) throw new RoutingError('aktion', `Unbekannte Aktion „${action}“`)
  if (action === 'status') return { url: `${endpoint}?aktion=status`, method: 'GET', headers: { 'X-Microsoft-Token': token } }
  return { url: `${endpoint}?aktion=${action}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Microsoft-Token': token }, body: JSON.stringify(body ?? {}) }
}

/**
 * Matrix aus den Abschnitten einer Reihenfolge (Google): Punkte [Betriebshof, Stopp 1, …, Stopp n], Abschnitt k fährt
 * von Punkt k zum nächsten, der letzte zurück zum Betriebshof. Minuten = Fahrzeit von Google (aufgerundet) plus
 * Zuschlag je Fahrt (baseMin: Parken, Gehen, Laden – wie beim eingebauten Anbieter); unter 100 m und 1 Minute 0.
 * Nur diese Paare sind bekannt (sonst null): gilt nur für genau diese Reihenfolge.
 */
export function legsMatrix(legs = [], settings = {}) {
  const cfg = travelSettings(settings)
  const n = legs.length
  const grid = () => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : null)))
  const minutes = grid()
  const km = grid()
  if (n < 2) return { minutes, km }
  legs.forEach((leg, k) => {
    const to = (k + 1) % n
    const meters = Math.max(0, Number(leg?.meters) || 0)
    const seconds = Math.max(0, Number(leg?.seconds) || 0)
    minutes[k][to] = meters < 100 && seconds < 60 ? 0 : Math.ceil(seconds / 60 - 1e-9) + cfg.baseMin
    km[k][to] = round1(meters / 1000)
  })
  return { minutes, km }
}

/** Fehler von routing.php → Kennung (anmeldung, rechte, nicht-eingerichtet, limit, keine-route, google, anfrage, webspace). */
function errorCode(status, type) {
  if (status === 401) return 'anmeldung'
  if (status === 403) return 'rechte'
  if (status === 503 || type === 'not_configured') return 'nicht-eingerichtet'
  if (status === 429) return 'limit'
  if (status === 422) return 'keine-route'
  if (type === 'google_error') return 'google'
  if (status === 400 || status === 413) return 'anfrage'
  return 'webspace'
}

const LATE = ['zeitfenster', 'arbeitszeit']

/**
 * Google Maps Platform über routing.php (Entscheidung E8). fetch und getToken (Microsoft-Token der Person) lassen sich
 * ersetzen (Tests, App). Den Stand des Webspace (status: eingerichtet, Limits, Nutzung) liest refresh(); ready() ist
 * erst wahr, wenn ein Schlüssel eingerichtet und kein Limit erreicht ist (sonst wählt routingFor den eingebauten
 * Anbieter mit why() als Hinweis).
 *  - optimize(problem): Zuteilung und erste Reihenfolge mit planRoutes, dann je Tour eine Anfrage (optimierte
 *    Reihenfolge); verletzt sie Zeitfenster oder Arbeitszeit, eine zweite mit der Reihenfolge der App. Ergebnis wie
 *    planRoutes, je Tour provider ('google' | 'luftlinie'), notice ('' oder Grund) und google { order, legs }
 *    (Abschnitte für spätere Änderungen ohne neue Anfrage). Nach einem Fehler fragt er für weitere Touren nicht mehr.
 *  - legs({ depot, stops, optimize }): eine Anfrage → { order, legs [{ seconds, meters }] } (optimize false: feste Reihenfolge).
 *  - geocode(adresse) → { lat, lon, quality: 'google', label, precision } | null (eine Anfrage).
 *  - matrix(punkte): bewusst ohne Google (Anfragen sparen) – Luftlinie wie der eingebaute Anbieter.
 *  - setup({ schluessel?, limitMonat?, limitTag?, entfernen? }): nur Vollzugriff (prüft routing.php).
 */
export function createGoogleProvider({ endpoint = GOOGLE_ENDPOINT, fetch: fetchFn = (...a) => globalThis.fetch(...a), getToken = async () => '', label = 'Google-Routing' } = {}) {
  let status = null
  let lastError = null

  async function call(action, body) {
    let token = ''
    try {
      token = (await getToken()) || ''
    } catch {
      token = ''
    }
    const req = googleRequest(action, body, { endpoint, token })
    let res
    try {
      res = await fetchFn(req.url, { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}), cache: 'no-store' })
    } catch {
      throw Object.assign(new RoutingError('netz', 'Webspace nicht erreichbar (keine Verbindung)'), { status: 0 })
    }
    const type = String(res.headers?.get?.('content-type') || '')
    const json = type.includes('json') ? await res.json().catch(() => null) : null
    if (!json) throw Object.assign(new RoutingError('webspace', 'routing.php fehlt am Webspace (oder PHP ist aus)'), { status: res.status })
    if (!res.ok) {
      const e = json.error || {}
      throw Object.assign(new RoutingError(errorCode(res.status, e.type), String(e.message || `Fehler ${res.status}`)), { status: res.status, limit: e.limit || '' })
    }
    if (json.nutzung && status) status = { ...status, nutzung: json.nutzung }
    return json
  }

  const limitText = (st) => {
    const n = st?.nutzung || {}
    const month = Number(st?.limitMonat || n.limitMonat) || Infinity
    const day = Number(st?.limitTag || n.limitTag) || Infinity
    if (Number(n.anfragen) >= month) return `Monatslimit erreicht (${month} Anfragen)`
    if (Number(n.heute) >= day) return `Tageslimit erreicht (${day} Anfragen)`
    return ''
  }
  const ready = () => !!status?.eingerichtet && !limitText(status)
  const why = () =>
    lastError && !status
      ? `nicht erreichbar (${lastError.message})`
      : !status
        ? 'noch nicht eingerichtet (Stand vom Webspace nicht gelesen)'
        : !status.eingerichtet
          ? 'noch nicht eingerichtet (kein API-Schlüssel am Webspace)'
          : limitText(status)

  async function refresh() {
    try {
      status = await call('status')
      lastError = null
    } catch (err) {
      status = null
      lastError = { message: err.message, status: err.status ?? 0, code: err.code }
    }
    return status
  }

  async function ensureReady() {
    if (!status) await refresh()
    if (!ready()) throw new RoutingError(status?.eingerichtet ? 'limit' : 'nicht-eingerichtet', why())
  }

  /** Eine Anfrage an Google über routing.php: Reihenfolge (optimiert oder fest) und Abschnitte. */
  async function legs({ depot, stops = [], optimize = true } = {}) {
    await ensureReady()
    if (!hasCoords(depot)) throw new RoutingError('koordinaten', REASONS.betriebshof)
    if (!stops.length) throw new RoutingError('anfrage', 'Tour ohne Stopp')
    if (stops.length > GOOGLE_MAX_STOPS) throw new RoutingError('anfrage', `mehr als ${GOOGLE_MAX_STOPS} Stopps in einer Tour`)
    const missing = stops.find((s) => !hasCoords(s))
    if (missing) throw new RoutingError('koordinaten', `Stopp ohne Koordinaten (${missing.id})`)
    const ids = stops.map((s) => String(s.id))
    // nur Kennung und Koordinaten: keine Namen, keine Adressen
    const res = await call('optimize', { depot: { lat: Number(depot.lat), lon: Number(depot.lon) }, stops: stops.map((s) => ({ id: String(s.id), lat: Number(s.lat), lon: Number(s.lon) })), ...(optimize ? {} : { keepOrder: true }) })
    const order = Array.isArray(res.order) ? res.order.map(String) : []
    const ok = order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id)) && Array.isArray(res.legs) && res.legs.length === ids.length + 1
    if (!ok) throw new RoutingError('google', 'Antwort von routing.php unvollständig')
    if (!optimize && order.some((id, i) => id !== ids[i])) throw new RoutingError('google', 'Reihenfolge geändert, obwohl sie fest bleiben sollte')
    return { order, legs: res.legs.map((l) => ({ seconds: Math.max(0, Math.round(Number(l?.seconds) || 0)), meters: Math.max(0, Math.round(Number(l?.meters) || 0)) })) }
  }

  /** Eine Tour mit Google: optimierte Reihenfolge, sonst (Zeitfenster) die der App, je mit den Fahrzeiten von Google. */
  async function googleRoute({ depot, stops, driver, settings, driverId }) {
    const plan = (list, l) => scheduleRoute({ depot, stops: list, driver, settings, matrix: legsMatrix(l, settings) })
    const late = (x) => x.problems.filter((p) => LATE.includes(p.code)).length
    const byId = new Map(stops.map((s) => [String(s.id), s]))
    const first = await legs({ depot, stops, optimize: true })
    let pick = { res: plan(first.order.map((id) => byId.get(id)), first.legs), google: first, notice: '' }
    const same = first.order.every((id, i) => id === String(stops[i].id))
    if (late(pick.res) && !same) {
      const second = await legs({ depot, stops, optimize: false })
      const res = plan(stops, second.legs)
      if (late(res) <= late(pick.res)) pick = { res, google: second, notice: `${label}: die Reihenfolge von Google hätte Zeitfenster oder Arbeitszeit verletzt – Reihenfolge der App mit den Fahrzeiten von Google.` }
    }
    const { problems, ...rest } = pick.res
    return { driverId, ...rest, provider: 'google', google: pick.google, notice: pick.notice }
  }

  return {
    name: 'google',
    label,
    endpoint,
    ready,
    why,
    status: () => status,
    lastError: () => lastError,
    refresh,
    async setup(body = {}) {
      status = await call('einrichten', body)
      lastError = null
      return status
    },
    async geocode(address) {
      const text = String(address ?? '').trim()
      if (!text) return null
      const c = parseCoords(text)
      if (c) return { ...c, quality: 'hand' }
      await ensureReady()
      const res = await call('geocode', { address: text.slice(0, 200) })
      const h = res.hit
      return h && hasCoords(h) ? { lat: Number(h.lat), lon: Number(h.lon), quality: 'google', label: String(h.label || ''), precision: String(h.precision || '') } : null
    },
    async matrix(points, settings = {}) {
      return airMatrix(points, settings)
    },
    legs,
    async optimize(problem = {}) {
      await ensureReady()
      const plan = planRoutes(problem)
      const settings = problem.settings || {}
      const byId = new Map((problem.stops || []).map((s) => [s.id, s]))
      const drivers = new Map((problem.drivers || []).map((d) => [d.id, d]))
      const routes = []
      let halt = ''
      for (const r of plan.routes) {
        const fallback = (notice) => routes.push({ ...r, provider: 'luftlinie', notice })
        if (!r.stops.length) fallback('')
        else if (halt) fallback(halt)
        else if (r.stops.length > GOOGLE_MAX_STOPS) fallback(`${label}: mehr als ${GOOGLE_MAX_STOPS} Stopps in der Tour – eingebauter Anbieter (Luftlinie).`)
        else {
          try {
            routes.push(await googleRoute({ depot: problem.depot, stops: r.stops.map((x) => byId.get(x.id)), driver: drivers.get(r.driverId) || {}, settings, driverId: r.driverId }))
          } catch (err) {
            const notice = `${label}: ${err?.message || 'Fehler'} – eingebauter Anbieter (Luftlinie).`
            // ohne Route zwischen diesen Punkten nur diese Tour; sonst (Schlüssel, Limit, Netz) keine weitere Anfrage
            if (err?.code !== 'keine-route') halt = notice
            fallback(notice)
          }
        }
      }
      const notices = [...new Set(routes.map((r) => r.notice).filter(Boolean))]
      return {
        provider: routes.some((r) => r.provider === 'google') ? 'google' : 'luftlinie',
        routes,
        unassigned: plan.unassigned,
        minutes: routes.reduce((x, r) => x + r.minutes, 0),
        km: round1(routes.reduce((x, r) => x + r.km, 0)),
        ...(notices.length ? { notice: notices.join(' ') } : {}),
      }
    },
    request: (action, body, token = '') => googleRequest(action, body, { endpoint, token }),
  }
}

const registry = new Map()

/** Anbieter anmelden (ersetzt einen gleichnamigen). impl: { geocode, matrix, optimize, ready?, label? }. */
export function registerRoutingProvider(name, impl) {
  const key = String(name || '').trim()
  if (!key) throw new RoutingError('anbieter', 'Anbieter braucht einen Namen')
  for (const fn of ['geocode', 'matrix', 'optimize']) if (typeof impl?.[fn] !== 'function') throw new RoutingError('anbieter', `Anbieter „${key}“: ${fn} fehlt`)
  registry.set(key, impl)
  return impl
}

/** Angemeldeter Anbieter oder null. */
export const routingProvider = (name) => registry.get(String(name || '')) || null
/** Namen der angemeldeten Anbieter. */
export const routingProviders = () => [...registry.keys()]

const isReady = (p, settings) => (typeof p.ready === 'function' ? !!p.ready(settings) : true)

/**
 * Anbieter laut Einstellung (settings.provider, Vorgabe 'luftlinie') mit Rückfall: ist er unbekannt oder nicht
 * eingerichtet (ready() falsch, Grund aus why()), kommt 'luftlinie' mit { requested, notice }. Ein eingerichteter fremder
 * Anbieter fällt bei einem Fehler je Aufruf auf 'luftlinie' zurück (Ergebnis von optimize mit notice).
 */
export function routingFor(settings = {}) {
  const want = String(settings?.provider || 'luftlinie')
  const base = registry.get('luftlinie')
  const p = registry.get(want)
  if (p && want === 'luftlinie') return p
  if (!p || !isReady(p, settings)) {
    const why = p && typeof p.why === 'function' ? p.why(settings) : ''
    const notice = p ? `${p.label || want}: ${why || 'noch nicht eingerichtet'} – eingebauter Anbieter (Luftlinie).` : `Anbieter „${want}“ unbekannt – eingebauter Anbieter (Luftlinie).`
    return { ...base, requested: want, notice }
  }
  const safe = (fn) =>
    async (...args) => {
      try {
        return await p[fn](...args)
      } catch (err) {
        const res = await base[fn](...args)
        const notice = `${p.label || want}: ${err?.message || 'Fehler'} – eingebauter Anbieter (Luftlinie).`
        return fn === 'optimize' ? { ...res, notice } : res
      }
    }
  return { ...p, name: want, geocode: safe('geocode'), matrix: safe('matrix'), optimize: safe('optimize') }
}

registerRoutingProvider('luftlinie', createLuftlinieProvider())
registerRoutingProvider('google', createGoogleProvider())
