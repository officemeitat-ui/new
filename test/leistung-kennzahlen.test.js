// Leistung von Kennzahlen und Rentabilität beim ersten Besuch (große Datenmengen): die schnellen Wege liefern dasselbe wie
// die bisherigen. Verglichen wird mit den bisherigen Fassungen (hier nachgebaut) auf kleinen, erfundenen Daten:
//  - core/dates.js: dayIndex, fromDayIndex, toMinutes je Wert gemerkt, isoWeekday ohne Datumsobjekt
//  - core/plan.js: PlanState ohne Zwischenlisten, instancesOf je Person gemerkt (auch nach assign/unassign)
//  - storage/data-service.js: Wochen eines Abrufs in einem Zug (weeksWithEntries/weeksAfterApply), Kopien im Gerät zugleich
//  - storage/offline.js: cachedKnown (Liste der Kopien im Gerät, beim Schreiben nachgeführt)
//  - core/matten-uebersicht.js mattenKpi (Datum je Eintrag einmal, doneTours aus mattenStateOf), matten-fahrt.js notDoneDays
//  - core/rentabilitaet.js hoursByObject ohne Stempelungen; Zahlenformate der Ansichten (Intl.NumberFormat gemerkt)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, dayIndex, fromDayIndex, isoWeekday, mondayOf, toMinutes } from '../src/core/dates.js'
import { PlanState } from '../src/core/plan.js'
import { hoursByObject } from '../src/core/rentabilitaet.js'
import { doneFromTours, jobUpdatesFromTour, notDoneDays } from '../src/core/matten-fahrt.js'
import { doneOf, mattenKpi, mattenStateOf } from '../src/core/matten-uebersicht.js'
import { DONE_STATUS } from '../src/core/matten-plan.js'
import { LocalDocStore } from '../src/storage/docstore-local.js'
import { CachedDocStore, memoryCache } from '../src/storage/offline.js'
import { applyDoc, DataService, weekPath, weeksAfterApply, weeksWithEntries } from '../src/storage/data-service.js'

// fester Zufall (wiederholbar)
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const clone = (v) => JSON.parse(JSON.stringify(v))

// ---------------------------------------------------------------- core/dates.js

const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')
const old = {
  dayIndex(date) {
    const [y, m, d] = date.split('-').map(Number)
    return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
  },
  fromDayIndex(idx) {
    const dt = new Date(idx * DAY_MS)
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
  },
  isoWeekday(date) {
    const w = new Date(old.dayIndex(date) * DAY_MS).getUTCDay()
    return w === 0 ? 7 : w
  },
  toMinutes(time) {
    const [h, m] = String(time).split(':').map(Number)
    return h * 60 + (m || 0)
  },
}

test('Datum: gemerkte Tagesnummern, Wochentage und Minuten wie bisher (zweimal, über die Grenze des Merkers, ungültige Eingaben)', () => {
  const odd = ['2026-02-30', '2026-13-01', '2026-1-5', '0050-06-15', '1899-12-31', '', 'abc', '2026-11-10x', '2024-02-29', '2100-02-29', '-0001-01-01', '275760-09-13', '275760-09-14']
  for (let pass = 0; pass < 2; pass++) {
    // 1860 bis 2134 in Schritten von 3 Tagen: über 20 000 Werte, der Merker wird dabei einmal geleert
    for (let i = -40000; i <= 60000; i += 3) {
      const date = old.fromDayIndex(i)
      assert.equal(fromDayIndex(i), date)
      assert.equal(dayIndex(date), old.dayIndex(date))
      assert.equal(isoWeekday(date), old.isoWeekday(date))
    }
    for (const d of odd) {
      assert.equal(dayIndex(d), old.dayIndex(d), d)
      assert.equal(isoWeekday(d), old.isoWeekday(d), d)
      assert.equal(addDays(d, 1), old.fromDayIndex(old.dayIndex(d) + 1), d)
    }
    for (const idx of [NaN, 0.5, -0, 1e8, -1e8, Infinity]) assert.equal(fromDayIndex(idx), old.fromDayIndex(idx), String(idx))
    for (const t of ['06:30', '6:30', '24:00', '00:00', '7', '', 'x', '10:5', '23:59', undefined, null, 5, 7.5]) assert.equal(toMinutes(t), old.toMinutes(t), String(t))
  }
  assert.throws(() => dayIndex(undefined))
  assert.throws(() => old.dayIndex(undefined))
  assert.equal(mondayOf('2026-11-15'), '2026-11-09')
})

// ---------------------------------------------------------------- core/plan.js

/** PlanState wie bisher (ohne gemerkte Einsätze je Person). */
class OldPlanState {
  constructor(instances, assignments = {}) {
    this.instByKey = new Map(instances.map((i) => [i.key, i]))
    this.asg = new Map()
    this.byEmp = new Map()
    for (const [key, list] of Object.entries(assignments)) {
      this.asg.set(key, list.map((a) => ({ ...a })))
      if (this.isActive(key)) for (const a of list) this.link(a.employeeId, key)
    }
  }
  isActive(key) {
    const inst = this.instByKey.get(key)
    return !!inst && inst.status !== 'cancelled'
  }
  link(empId, key) {
    if (!this.byEmp.has(empId)) this.byEmp.set(empId, new Set())
    this.byEmp.get(empId).add(key)
  }
  assigned(key) {
    return this.asg.get(key) || []
  }
  has(empId, key) {
    return this.assigned(key).some((a) => a.employeeId === empId)
  }
  instancesOf(empId) {
    return [...(this.byEmp.get(empId) || [])].map((k) => this.instByKey.get(k))
  }
  assign(empId, key, locked = false) {
    if (this.has(empId, key)) return
    if (!this.asg.has(key)) this.asg.set(key, [])
    this.asg.get(key).push({ employeeId: empId, locked })
    if (this.isActive(key)) this.link(empId, key)
  }
  unassign(empId, key) {
    const list = this.assigned(key).filter((a) => a.employeeId !== empId)
    if (list.length) this.asg.set(key, list)
    else this.asg.delete(key)
    this.byEmp.get(empId)?.delete(key)
  }
  toObject() {
    const out = {}
    for (const [key, list] of this.asg) if (list.length) out[key] = list.map((a) => ({ ...a }))
    return out
  }
}

test('PlanState: Einsätze je Person gemerkt, nach Einteilen und Austragen wie bisher (dieselben Einsätze, gleiche Reihenfolge)', () => {
  const r = rng(7)
  const emps = ['e1', 'e2', 'e3', 'e4', 'e5']
  const instances = []
  for (let d = 0; d < 21; d++) for (let t = 0; t < 6; t++) instances.push({ key: `${addDays('2026-11-02', d)}|t${t}`, date: addDays('2026-11-02', d), status: r() < 0.1 ? 'cancelled' : 'normal' })
  const assignments = {}
  for (const inst of instances) if (r() < 0.6) assignments[inst.key] = emps.filter(() => r() < 0.35).map((employeeId) => ({ employeeId, locked: r() < 0.3 }))
  assignments['2026-12-24|t9'] = [{ employeeId: 'e1' }] // ohne Einsatz im Zeitraum
  const input = clone(assignments)
  const a = new PlanState(instances, assignments)
  const b = new OldPlanState(instances, assignments)
  const same = (step) => {
    for (const e of [...emps, 'e9']) {
      const x = a.instancesOf(e)
      const y = b.instancesOf(e)
      assert.equal(x.length, y.length, `${step} ${e}`)
      x.forEach((inst, i) => assert.equal(inst, y[i], `${step} ${e} #${i}`))
    }
    assert.deepEqual(a.toObject(), b.toObject(), step)
    for (const inst of instances) assert.deepEqual(a.assigned(inst.key), b.assigned(inst.key), `${step} ${inst.key}`)
  }
  same('Start')
  // zurückgegebene Liste verändern: der Merker bleibt unberührt
  a.instancesOf('e1').reverse().push({ key: 'fremd' })
  same('nach Ändern der Liste')
  for (let step = 0; step < 400; step++) {
    const e = pick(r, emps)
    const key = pick(r, instances).key
    if (r() < 0.5) {
      a.assign(e, key, r() < 0.5)
      b.assign(e, key, a.assigned(key).at(-1)?.locked ?? false)
    } else {
      a.unassign(e, key)
      b.unassign(e, key)
    }
    if (step % 20 === 0) same(`Schritt ${step}`)
  }
  same('Ende')
  assert.deepEqual(assignments, input, 'Eingabe unverändert')
})

// ---------------------------------------------------------------- storage/data-service.js

const FIELDS = ['assignments', 'overrides', 'trips', 'stamps']
const weekOf = (date) => mondayOf(date)

test('Wochen laden: Wochen mit Einträgen werden nach jeder übernommenen Woche richtig nachgeführt (wie neu gesammelt)', () => {
  const r = rng(11)
  const mondays = Array.from({ length: 8 }, (_, i) => addDays('2026-10-05', 7 * i))
  const keyIn = (monday) => `${addDays(monday, Math.floor(r() * 7))}|t${Math.floor(r() * 30)}`
  for (let round = 0; round < 60; round++) {
    const data = { logs: {} }
    for (const f of FIELDS) data[f] = {}
    for (let i = 0; i < 40; i++) data[pick(r, FIELDS)][keyIn(pick(r, mondays))] = [{ employeeId: 'e1' }]
    for (const m of mondays) if (r() < 0.2) data.logs[m] = r() < 0.5 ? [] : [{ text: 'x' }]
    const set = weeksWithEntries(data)
    for (let w = 0; w < 4; w++) {
      const monday = pick(r, mondays)
      const doc = { monday, log: r() < 0.3 ? [{ text: 'neu' }] : r() < 0.5 ? [] : undefined }
      for (const f of FIELDS) if (r() < 0.7) doc[f] = Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, () => [r() < 0.15 ? keyIn(pick(r, mondays)) : keyIn(monday), [{ employeeId: 'e2' }]]))
      const twin = clone(data)
      const empty = !set.has(monday)
      applyDoc(data, weekPath(monday), clone(doc), empty)
      applyDoc(twin, weekPath(monday), clone(doc))
      assert.deepEqual(data, twin, 'ohne Suche nach Einträgen der Woche dasselbe Ergebnis')
      assert.equal(weeksAfterApply(set, doc), true)
      assert.deepEqual([...set].sort(), [...weeksWithEntries(data)].sort(), `Runde ${round}, Woche ${monday}`)
    }
  }
  // ohne gültigen Montag: nicht nachführbar (dann wird neu gesammelt)
  assert.equal(weeksAfterApply(new Set(), { assignments: {} }), false)
})

const memoryStorage = () => {
  const map = new Map()
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), key: (i) => [...map.keys()][i], get length() { return map.size } }
}
const seed = () => ({ version: 1, employees: [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Markus' }], objects: [{ id: 'o1', name: 'Kanzlei' }], tasks: [], absences: [], assignments: {}, overrides: {}, logs: {}, published: {}, skills: [], rules: {} })

/**
 * Ablage mit Wochen W0–W5 (W3 fehlt). Fremde Schlüssel: W1 enthält einen aus W2, W2 einen aus W5 – die spätere Woche gilt
 * dann als hier bearbeitet und wird zusammengeführt (am Protokoll sichtbar: zusammengeführt bleibt das eigene leere).
 */
async function storeWithWeeks(mondays) {
  const store = new LocalDocStore({ storage: memoryStorage() })
  await new DataService(store, { debounceMs: 0 }).load(seed)
  for (const [i, m] of mondays.entries()) {
    if (i === 3) continue
    const assignments = { [`${addDays(m, 1)}|t1`]: [{ employeeId: 'e1' }], [`${addDays(m, 3)}|t2`]: [{ employeeId: 'e2' }] }
    if (i === 1) assignments[`${addDays(mondays[2], 5)}|t8`] = [{ employeeId: 'e1' }]
    if (i === 2) assignments[`${addDays(mondays[5], 2)}|t7`] = [{ employeeId: 'e2' }]
    await store.write(weekPath(m), { monday: m, assignments, overrides: { [`${addDays(m, 1)}|t1`]: { note: `Woche ${i}` } }, log: [{ text: `gespeichert ${i}` }] })
  }
  return store
}

test('Wochen laden: viele Wochen in einem Zug wie Woche für Woche (vorher bearbeitete Wochen zusammengeführt, auch aus dem Gerät)', async () => {
  const mondays = Array.from({ length: 6 }, (_, i) => addDays('2026-11-02', 7 * i))
  const run = async ({ together, quick }) => {
    const remote = await storeWithWeeks(mondays)
    const cache = memoryCache()
    // Kopien im Gerät: W0 (älterer Stand, mit einem Schlüssel aus W4) und W4
    await cache.put('docs', weekPath(mondays[0]), { data: { monday: mondays[0], assignments: { [`${addDays(mondays[0], 1)}|t1`]: [{ employeeId: 'e2' }], [`${addDays(mondays[4], 5)}|t9`]: [{ employeeId: 'e2' }] }, overrides: {}, log: [] }, etag: 'alt' })
    await cache.put('docs', weekPath(mondays[4]), { data: (await remote.read(weekPath(mondays[4]))).data, etag: (await remote.read(weekPath(mondays[4]))).etag })
    const store = quick ? new CachedDocStore(remote, cache) : remote
    const svc = new DataService(store, { debounceMs: 60_000, quickStart: quick })
    const data = await svc.load(seed)
    let saves = 0
    const schedule = svc.schedule.bind(svc)
    svc.schedule = () => (saves++, schedule())
    // vor dem Laden bearbeitet: W1 (neue Einteilung), W3 (Woche ohne Datei), Protokoll in W5
    data.assignments[`${addDays(mondays[1], 4)}|t3`] = [{ employeeId: 'e2', locked: true }]
    data.assignments[`${addDays(mondays[3], 0)}|t4`] = [{ employeeId: 'e1' }]
    data.logs[mondays[5]] = [{ text: 'lokal' }]
    if (together) await svc.ensureWeeks(mondays)
    else for (const m of mondays) await svc.ensureWeeks([m])
    await svc.synced()
    clearTimeout(svc.timer)
    return { assignments: data.assignments, overrides: data.overrides, logs: data.logs, weeks: [...svc.weeks].sort(), saves }
  }
  for (const quick of [false, true]) {
    const a = await run({ together: true, quick })
    const b = await run({ together: false, quick })
    assert.deepEqual(a, b, quick ? 'mit Kopien im Gerät' : 'ohne Gerät')
    // bearbeitete Wochen: eigene und gespeicherte Einträge beide da
    assert.deepEqual(a.assignments[`${addDays(mondays[1], 4)}|t3`], [{ employeeId: 'e2', locked: true }])
    assert.ok(a.assignments[`${addDays(mondays[1], 1)}|t1`])
    assert.ok(a.assignments[`${addDays(mondays[3], 0)}|t4`])
    assert.ok(a.assignments[`${addDays(mondays[5], 2)}|t7`], 'Schlüssel aus fremder Woche')
    assert.ok(a.assignments[`${addDays(mondays[2], 5)}|t8`], 'Schlüssel aus fremder Woche')
    assert.deepEqual(a.logs[mondays[1]], [], 'W1 hier bearbeitet: zusammengeführt')
    assert.deepEqual(a.logs[mondays[2]], [], 'W2 durch den Schlüssel aus W1 bearbeitet: zusammengeführt')
    if (quick) assert.deepEqual(a.logs[mondays[4]], [], 'W4 (Gerät) durch den Schlüssel aus W0 bearbeitet: zusammengeführt')
    assert.deepEqual(a.logs[mondays[0]], [{ text: 'gespeichert 0' }], 'W0 nicht bearbeitet (aus dem Gerät: danach abgeglichen)')
    assert.deepEqual(a.weeks, mondays)
  }
})

// ---------------------------------------------------------------- storage/offline.js

test('Gerät: cachedKnown kennt die Kopien (beim Start gelesen, beim Lesen, Schreiben und Löschen nachgeführt)', async () => {
  const remote = new LocalDocStore({ storage: memoryStorage() })
  await remote.write('plaene/2026/2026-11-02.json', { monday: '2026-11-02' })
  await remote.write('plaene/2026/2026-11-09.json', { monday: '2026-11-09' })
  const cache = memoryCache()
  await cache.put('docs', 'daten/stammdaten.json', { data: { employees: [] }, etag: 'e1' })
  await cache.put('docs', 'plaene/2026/weg.json', { data: { monday: 'alt' }, etag: 'e0' }) // in SharePoint inzwischen gelöscht
  const deleted = []
  const del = cache.del
  cache.del = (store, key) => (deleted.push(key), del(store, key))
  const store = new CachedDocStore(remote, cache)
  remote.init = async () => ({})
  await store.init()
  assert.deepEqual((await store.cachedKnown('daten/stammdaten.json')).data, { employees: [] })
  assert.equal(await store.cachedKnown('plaene/2026/2026-11-02.json'), null, 'nie geladen: ohne Nachsehen im Gerät')
  await store.read('plaene/2026/2026-11-02.json')
  assert.deepEqual((await store.cachedKnown('plaene/2026/2026-11-02.json')).data, { monday: '2026-11-02' })
  await store.readMany(['plaene/2026/2026-11-09.json', 'plaene/2026/fehlt.json', 'plaene/2026/weg.json'])
  assert.deepEqual((await store.cachedKnown('plaene/2026/2026-11-09.json')).data, { monday: '2026-11-09' })
  assert.equal(await store.cachedKnown('plaene/2026/fehlt.json'), null)
  assert.equal(await store.cached('plaene/2026/weg.json'), null, 'gelöschte Datei: alte Kopie im Gerät entfernt')
  assert.deepEqual(deleted, ['plaene/2026/weg.json'], 'nur gelöscht, was im Gerät lag')
  await store.write('neu.json', { v: 1 }, null)
  assert.deepEqual((await store.cachedKnown('neu.json')).data, { v: 1 })
  await store.remove('neu.json')
  assert.equal(await store.cachedKnown('neu.json'), null)
  // immer dasselbe wie cached
  for (const p of ['daten/stammdaten.json', 'plaene/2026/2026-11-02.json', 'plaene/2026/2026-11-09.json', 'neu.json', 'x.json']) assert.deepEqual(await store.cachedKnown(p), await store.cached(p), p)
  // Gerät ohne Liste der Schlüssel: wie cached
  const plain = { ...memoryCache(), keys: undefined }
  await plain.put('docs', 'a.json', { data: 1 })
  const s2 = new CachedDocStore(remote, plain)
  assert.deepEqual(await s2.cachedKnown('a.json'), await s2.cached('a.json'))
})

// ---------------------------------------------------------------- Mattenwechsel-Kennzahlen

const isDateOld = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const inMonthOld = (d, m) => isDateOld(d) && d >= m.from && d <= m.to
/** Zeilen je Monat wie bisher (mattenKpi vor dem Umbau). */
function oldRows({ state, tours, months, tolerance }) {
  const tol = Math.max(0, Math.round(Number(tolerance) || 0))
  const ist = new Set()
  for (const d of doneFromTours(tours)) ist.add(`${d.placementId}|${d.date}`)
  const done = state.jobs.filter((j) => DONE_STATUS.includes(j.status) && isDateOld(j.doneOn))
  for (const j of done) ist.add(`${j.placementId}|${j.doneOn}`)
  const istDates = [...ist].map((k) => k.split('|')[1])
  const failed = []
  for (const tour of tours || []) if (tour?.status !== 'entwurf') for (const u of jobUpdatesFromTour(tour)) if (u.status === 'nachzuholen' && !u.also) failed.push(u.date)
  return months.map((m) => {
    const fin = done.filter((j) => inMonthOld(j.doneOn, m))
    const punctual = fin.filter((j) => isDateOld(j.due) && j.doneOn <= addDays(j.due, tol)).length
    return {
      key: m.key,
      soll: state.jobs.filter((j) => inMonthOld(j.due, m) && j.status !== 'ausgesetzt' && j.status !== 'verworfen').length,
      ist: istDates.filter((d) => inMonthOld(d, m)).length,
      erledigt: fin.length,
      puenktlich: punctual,
      rate: fin.length ? punctual / fin.length : null,
      nicht: failed.filter((d) => inMonthOld(d, m)).length,
    }
  })
}

function mattenData(seed) {
  const r = rng(seed)
  const mat = { articleId: 'a1', name: '85 × 150 cm, grau', size: '85 × 150 cm' }
  const placements = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Liegeplatz ${i}`, active: i !== 3, mats: [{ ...mat, qty: 1 + (i % 3) }], lastExchange: i % 4 === 0 ? addDays('2026-08-01', i) : undefined }))
  const days = Array.from({ length: 150 }, (_, i) => addDays('2026-06-15', i))
  const statuses = ['geplant', 'erledigt', 'teilweise', 'ausgesetzt', 'verworfen', 'in-tour', 'nachzuholen']
  const badDates = ['', '2026-7-1', 'kein Datum', null, undefined, '2026-07-01T08:00']
  const jobs = []
  for (let i = 0; i < 160; i++) {
    const p = pick(r, placements)
    const due = r() < 0.08 ? pick(r, badDates) : pick(r, days)
    const status = pick(r, statuses)
    jobs.push({ key: `${p.id}:${i}`, id: `${p.id}:${i}`, placementId: p.id, due, status, doneOn: DONE_STATUS.includes(status) ? (r() < 0.1 ? pick(r, badDates) : addDays(isDateOld(due) ? due : '2026-07-01', Math.floor(r() * 5) - 1)) : undefined, tourId: status === 'in-tour' ? `t${i % 20}` : undefined })
  }
  const stopStatus = ['abgeschlossen', 'teilweise', 'nicht-angetroffen', 'nicht-durchgefuehrt', 'geplant', 'unterwegs']
  const itemStatus = ['gewechselt', 'gewechselt', 'nicht-moeglich', 'offen']
  const tours = Array.from({ length: 20 }, (_, t) => {
    const date = pick(r, days)
    const stops = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, s) => ({
      id: `s${t}-${s}`,
      status: pick(r, stopStatus),
      finishedAt: r() < 0.7 ? `${addDays(date, r() < 0.2 ? 1 : 0)}T${pad(5 + Math.floor(r() * 18))}:30:00.000Z` : r() < 0.5 ? 'kaputt' : undefined,
      items: Array.from({ length: Math.floor(r() * 4) }, () => {
        const j = pick(r, jobs)
        return { jobKey: r() < 0.85 ? j.key : '', alsoJobKeys: r() < 0.2 ? [pick(r, jobs).key, j.key] : undefined, placementId: j.placementId, status: pick(r, itemStatus), planned: 1 + Math.floor(r() * 3), actual: pick(r, [null, undefined, '', 0, 1, 2, '3']), mat }
      }),
    }))
    return { id: `t${t}`, date: r() < 0.05 ? 'kein Datum' : date, status: pick(r, ['entwurf', 'freigegeben', 'unterwegs', 'abgeschlossen']), order: stops.map((s) => s.id).reverse(), stops }
  })
  return { doc: { schema: 1, settings: {}, placements, areas: [] }, jobs, tours }
}

test('Mattenwechsel-Kennzahlen: wie bisher, auch mit den Wechseln aus mattenStateOf (doneTours) und ungültigen Daten', () => {
  const months = [['2026-06', '2026-06-01', '2026-06-30'], ['2026-07', '2026-07-01', '2026-07-31'], ['2026-08', '2026-08-01', '2026-08-31'], ['2026-09', '2026-09-01', '2026-09-30'], ['2026-10', '2026-10-01', '2026-10-31'], ['2026-11', '2026-11-01', '2026-11-30']].map(([key, from, to]) => ({ key, from, to }))
  for (let seed = 1; seed <= 25; seed++) {
    const { doc, jobs, tours } = mattenData(seed)
    for (const toursLoaded of [true, false]) {
      const state = mattenStateOf({ doc, jobs, tours, today: '2026-11-10', toursLoaded })
      const list = toursLoaded ? tours : []
      assert.deepEqual(state.done, doneOf(doc.placements, list), 'done wie doneOf')
      assert.deepEqual(state.doneTours, doneFromTours(list))
      for (const tolerance of [0, 2]) {
        const plain = mattenKpi({ doc, state, tours: list, months, tolerance })
        assert.deepEqual(plain.months, oldRows({ state, tours: list, months, tolerance }), `Zeilen wie bisher (${seed})`)
        assert.deepEqual(mattenKpi({ doc, state, tours: list, months, tolerance, doneTours: state.doneTours }), plain, `mit doneTours (${seed})`)
      }
    }
    // nicht durchgeführte Wechsel: dieselben Tage wie „nachzuholen“ aus jobUpdatesFromTour
    for (const tour of tours) {
      const want = jobUpdatesFromTour(tour).filter((u) => u.status === 'nachzuholen' && !u.also).map((u) => u.date)
      assert.deepEqual(notDoneDays(tour).sort(), want.sort(), tour.id)
    }
  }
})

// ---------------------------------------------------------------- Rentabilität, Zahlenformate

/** hoursByObject wie bisher (Schlüssel der Stempelungen auch ohne Stempelungen gebaut). */
function oldHours({ instances = [], state, stamps = {}, from, to }) {
  const minutes = (s) => (s.in && s.out ? Math.max(0, Math.floor(Date.parse(s.out) / 6e4) - Math.floor(Date.parse(s.in) / 6e4)) : null)
  const list = Object.values(stamps || {}).filter((s) => s.date >= from && s.date <= to)
  const byInst = new Map()
  const loose = new Map()
  for (const s of list) {
    if (s.instKey) byInst.set(`${s.instKey}|${s.empId}`, s)
    else loose.set(`${s.date}|${s.objectId}|${s.empId}`, s)
  }
  const used = new Set()
  const out = new Map()
  const at = (id) => {
    if (!out.has(id)) out.set(id, { planned: 0, used: 0, stamped: 0, pairs: 0, stampedPairs: 0 })
    return out.get(id)
  }
  for (const inst of instances) {
    if (inst.status === 'cancelled' || inst.date < from || inst.date > to || !inst.objectId) continue
    const x = at(inst.objectId)
    for (const { employeeId } of state.assigned(inst.key).slice(0, Math.max(1, inst.staff || 1))) {
      x.planned += inst.net
      x.pairs++
      const s = byInst.get(`${inst.key}|${employeeId}`) || loose.get(`${inst.date}|${inst.objectId}|${employeeId}`)
      const m = s && !used.has(s) ? minutes(s) : null
      if (m !== null) {
        used.add(s)
        x.used += m
        x.stamped += m
        x.stampedPairs++
      } else x.used += inst.net
    }
  }
  for (const s of list) {
    if (used.has(s) || !s.objectId) continue
    const m = minutes(s)
    if (m === null) continue
    const x = at(s.objectId)
    x.used += m
    x.stamped += m
  }
  return out
}

test('Rentabilität: Stunden je Objekt wie bisher, mit und ohne Stempelungen im Zeitraum', () => {
  const r = rng(5)
  const instances = Array.from({ length: 120 }, (_, i) => ({ key: `${addDays('2026-10-01', i % 40)}|t${i}`, date: addDays('2026-10-01', i % 40), objectId: `o${i % 7}`, net: 60 + (i % 5) * 30, staff: 1 + (i % 2), status: i % 13 === 0 ? 'cancelled' : 'normal' }))
  const state = new PlanState(instances, Object.fromEntries(instances.filter(() => r() < 0.7).map((i) => [i.key, [{ employeeId: 'e1' }, { employeeId: 'e2' }].slice(0, 1 + Math.floor(r() * 2))])))
  const stamps = Object.fromEntries(instances.filter(() => r() < 0.3).map((i, n) => [`${i.date}|z${n}`, { date: i.date, empId: 'e1', objectId: i.objectId, instKey: n % 2 ? i.key : undefined, in: `${i.date}T06:00:00.000Z`, out: n % 5 ? `${i.date}T08:1${n % 10}:00.000Z` : null }]))
  for (const [from, to] of [['2026-10-01', '2026-10-31'], ['2026-10-10', '2026-10-20'], ['2027-01-01', '2027-01-31']]) {
    for (const s of [stamps, {}]) assert.deepEqual(hoursByObject({ instances, state, stamps: s, from, to }), oldHours({ instances, state, stamps: s, from, to }), `${from}–${to}`)
  }
})

test('Zahlenformate: gemerktes Intl.NumberFormat schreibt wie toLocaleString', () => {
  const values = [0, -0, 1, -1, 0.5, 1.25, 12.345, 99.95, 1234.5, -9876.54321, 1e7, 123456789.123, NaN, Infinity, -Infinity, 0.004, 33.333333]
  for (const opts of [{ maximumFractionDigits: 0 }, { maximumFractionDigits: 1 }, { maximumFractionDigits: 0, minimumFractionDigits: 0 }, { maximumFractionDigits: 1, minimumFractionDigits: 0 }]) {
    const fmt = new Intl.NumberFormat('de-AT', opts)
    for (const v of values) assert.equal(fmt.format(v), v.toLocaleString('de-AT', opts), `${v} ${JSON.stringify(opts)}`)
  }
})
