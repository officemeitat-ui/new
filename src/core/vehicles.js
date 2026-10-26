// Fahrzeuge und Reifenwechsel (Fuhrpark). Je Firmenfahrzeug: Fahrer/in aus
// den Mitarbeitenden, Reifensätze (Sommer/Winter oder Ganzjahr), was gerade
// montiert ist, Werkstatt und Einlagerung. Je Saison ein Wechseltermin; die
// App schlägt Termine vor, die nicht mit den Diensten der Fahrer/innen
// kollidieren, und schreibt die E-Mails an Fahrer/innen und Werkstatt.
//
// Daten (fahrzeuge/fahrzeuge.json):
//   vehicles:  [{ id, plate, label, kind: 'pkw'|'transporter'|'lkw', driverId, workshopId, note, inactive,
//                 mounted: 'sommer'|'winter'|'ganzjahr',
//                 tires: { sommer: { size, storage, dot, tread: { vl, vr, hl, hr } }, winter: { … } } }]
//   workshops: [{ id, name, address, phone, email }]
//   changes:   [{ id, vehicleId, kind: 'reifen'|'werkstatt', season: 'winter'|'sommer', year, date, time, minutes, workshopId,
//                 tasks: ['service', 'pickerl', 'due:ID'],   was beim Termin außerdem erledigt wird
//                 status: 'geplant'|'erledigt'|'abgesagt', doneAt, km, tread, removedTread, storage, cost, note,
//                 mails: [{ at, to, kind: 'fahrer'|'werkstatt', via }] }]
//   Service, Pickerl und weitere Fälligkeiten: core/vehicle-dues.js
//   settings:  { slotMinutes, travelMinutes }
//
// Rechtslage Österreich (KFG/KDV, Stand 2026): vom 1. November bis 15. April
// situative Winterreifenpflicht für Pkw und Lkw bis 3,5 t; Winterreifen
// brauchen mindestens 4 mm Profil (Radialreifen). Über 3,5 t: Winterreifen
// zumindest auf einer Antriebsachse, mindestens 5 mm, Schneeketten mitführen.
// Sommerreifen: gesetzlich 1,6 mm.

import { addDays, formatDate, isoWeekday, parseDate, parseMonth, todayISO, toMinutes } from './dates.js'
import { holidayCalendar } from './holidays.js'
import { parseTable } from './importer.js'

export const VEHICLE_KINDS = {
  pkw: { label: 'Pkw', heavy: false },
  transporter: { label: 'Transporter bis 3,5 t', heavy: false },
  lkw: { label: 'Lkw über 3,5 t', heavy: true },
}

export const SEASONS = { sommer: 'Sommerreifen', winter: 'Winterreifen', ganzjahr: 'Ganzjahresreifen' }
export const WHEELS = [['vl', 'VL'], ['vr', 'VR'], ['hl', 'HL'], ['hr', 'HR']]
export const DEFAULT_SETTINGS = { slotMinutes: 30, travelMinutes: 20 }
export const TASKS = { service: 'Service', pickerl: '§57a-Begutachtung (Pickerl)' }

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------- Saison

/**
 * Laufende Wechselrunde für ein Datum. Winter: ab 1. September planen, Frist
 * 31. Oktober (ab 1. November gilt die Pflicht), offen bis Ende Februar.
 * Sommer: ab 1. März planen, wechseln erst ab 16. April, Ziel 15. Mai.
 */
export function campaignFor(date) {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  if (m >= 3 && m <= 8) return { season: 'sommer', year: y, key: `sommer-${y}`, label: `Sommerreifen ${y}`, from: `${y}-03-01`, earliest: `${y}-04-16`, by: `${y}-05-15` }
  const wy = m >= 9 ? y : y - 1
  return { season: 'winter', year: wy, key: `winter-${wy}`, label: `Winterreifen ${wy}/${String(wy + 1).slice(2)}`, from: `${wy}-09-01`, earliest: `${wy}-09-01`, by: `${wy}-10-31` }
}

/** Mindestprofil in mm für einen Reifensatz an einem Fahrzeug: { legal, advised }. */
export function minTread(vehicle, season) {
  if (season === 'sommer') return { legal: 1.6, advised: 3 }
  const legal = VEHICLE_KINDS[vehicle?.kind]?.heavy ? 5 : 4
  return { legal, advised: legal + 1 }
}

/** Kleinstes gemessenes Profil eines Satzes oder null. */
export function lowestTread(tread) {
  const values = Object.values(tread || {}).map(num).filter((v) => v !== null)
  return values.length ? Math.min(...values) : null
}

/** Alter in Jahren aus der DOT-Nummer (letzte 4 Ziffern: Woche, Jahr, z. B. „2419“ = KW 24/2019). */
export function tireAge(dot, today) {
  const m = String(dot || '').match(/(\d{2})(\d{2})\s*$/)
  if (!m) return null
  const week = Number(m[1])
  const year = 2000 + Number(m[2])
  if (week < 1 || week > 53) return null
  const made = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  return (new Date(`${today}T12:00:00Z`) - made) / (365.25 * 864e5)
}

/** Hinweise zu einem Reifensatz: [{ level: 'error'|'warning', text }] */
export function tireIssues(vehicle, season, today) {
  const set = vehicle.tires?.[season]
  if (!set) return []
  const out = []
  const low = lowestTread(set.tread)
  // Ganzjahresreifen (mit Alpin-Symbol) zählen im Winter als Winterreifen
  const { legal, advised } = minTread(vehicle, season === 'ganzjahr' ? 'winter' : season)
  const name = SEASONS[season]
  if (low !== null && low < legal) out.push({ level: 'error', text: `${name}: ${String(low).replace('.', ',')} mm Profil, gesetzlich mindestens ${String(legal).replace('.', ',')} mm. Neue Reifen nötig.` })
  else if (low !== null && low < advised) out.push({ level: 'warning', text: `${name}: nur ${String(low).replace('.', ',')} mm Profil. Neue Reifen für die nächste Saison einplanen.` })
  const age = tireAge(set.dot, today)
  if (age !== null && age >= 6) out.push({ level: 'warning', text: `${name}: ${Math.floor(age)} Jahre alt (DOT ${set.dot}). Ab 6 Jahren wird der Tausch empfohlen.` })
  return out
}

// ---------------------------------------------------------------- Stand je Fahrzeug

export const activeVehicles = (fz) => (fz?.vehicles || []).filter((v) => !v.inactive)

/** Wechsel eines Fahrzeugs in einer Runde (nicht abgesagt), der neueste zuerst. */
export const changeOf = (fz, vehicleId, campaign) =>
  (fz?.changes || []).filter((c) => (c.kind || 'reifen') === 'reifen' && c.vehicleId === vehicleId && c.season === campaign.season && c.year === campaign.year && c.status !== 'abgesagt').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null

/**
 * Stand eines Fahrzeugs in der laufenden Runde:
 *   status: 'ganzjahr' | 'erledigt' | 'geplant' | 'vorbei' (Termin war, nicht bestätigt) | 'offen' | 'ueberfaellig'
 */
export function vehicleStatus(fz, vehicle, today, campaign = campaignFor(today)) {
  const change = changeOf(fz, vehicle.id, campaign)
  const issues = tireIssues(vehicle, vehicle.mounted === 'ganzjahr' ? 'ganzjahr' : campaign.season, today)
  if (vehicle.mounted === 'ganzjahr') return { status: 'ganzjahr', change: null, campaign, issues }
  if (change?.status === 'erledigt' || (!change && vehicle.mounted === campaign.season)) return { status: 'erledigt', change, campaign, issues }
  if (change?.status === 'geplant') return { status: change.date < today ? 'vorbei' : 'geplant', change, campaign, issues, early: campaign.season === 'sommer' && change.date < campaign.earliest }
  return { status: today > campaign.by ? 'ueberfaellig' : 'offen', change: null, campaign, issues }
}

export const STATUS_LABEL = { ganzjahr: 'Ganzjahresreifen', erledigt: 'umgerüstet', geplant: 'Termin geplant', vorbei: 'Termin vorbei, bestätigen', offen: 'Termin fehlt', ueberfaellig: 'überfällig' }
export const STATUS_CLASS = { ganzjahr: 'info', erledigt: 'ok', geplant: 'info', vorbei: 'warning', offen: 'warning', ueberfaellig: 'error' }

/** Übersicht der Runde: Zahlen je Status. */
export function campaignSummary(fz, today, campaign = campaignFor(today)) {
  const counts = { ganzjahr: 0, erledigt: 0, geplant: 0, vorbei: 0, offen: 0, ueberfaellig: 0 }
  for (const v of activeVehicles(fz)) counts[vehicleStatus(fz, v, today, campaign).status]++
  return { campaign, counts, total: activeVehicles(fz).length }
}

// ---------------------------------------------------------------- Termine und Dienste

const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/**
 * Überschneidungen eines Termins mit belegten Zeiten der Fahrerin.
 * busy: [{ start, end, label }] Minuten des Tages; allDay: ganztägig (Abwesenheit).
 * Die Fahrzeit zur Werkstatt (travel) zählt vorher und nachher dazu.
 */
export function conflicts(busy, time, minutes, travel = 0) {
  const s = toMinutes(time) - travel
  const e = toMinutes(time) + minutes + travel
  return busy.filter((b) => b.allDay || (b.start < e && b.end > s)).map((b) => ({ ...b, text: b.allDay ? b.label : `${hm(b.start)}–${hm(b.end)} ${b.label}` }))
}

/**
 * Termine für mehrere Fahrzeuge vorschlagen: je Fahrzeug der erste freie
 * Platz bei der Werkstatt, an dem die Fahrerin keinen Dienst hat (samt
 * Fahrzeit) und nicht abwesend ist. Wochenenden und Feiertage werden
 * übersprungen.
 *   vehicles: [{ id, driverId }]
 *   busyOf(driverId, date) → [{ start, end, label, allDay }]
 *   taken: [{ date, time, minutes }] schon vergebene Plätze der Werkstatt (auch außerhalb des Rasters)
 *   holidays: Map/Set der Feiertage (holidayCalendar), ohne Angabe die gesetzlichen
 * Liefert { proposals: [{ vehicleId, date, time, minutes, after }], unplaced: [vehicleId] }
 */
export function proposeSlots(vehicles, { from, to, dayStart = '07:00', dayEnd = '17:00', slotMinutes = 30, travelMinutes = 20, busyOf = () => [], taken = [], holidays = holidayCalendar(from, to) }) {
  // belegte Zeiträume der Werkstatt in Minuten; ein Platz ist frei, wenn er keinen davon überschneidet
  const used = taken.map((t) => ({ date: t.date, s: toMinutes(t.time), e: toMinutes(t.time) + (Number(t.minutes) || slotMinutes) }))
  const free = (date, m) => !used.some((b) => b.date === date && b.s < m + slotMinutes && b.e > m)
  const days = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && !holidays.has(d)) days.push(d)
  const proposals = []
  const unplaced = []
  for (const v of vehicles) {
    let found = null
    for (const date of days) {
      const busy = v.driverId ? busyOf(v.driverId, date) : []
      if (busy.some((b) => b.allDay)) continue
      for (let m = toMinutes(dayStart); m + slotMinutes <= toMinutes(dayEnd); m += slotMinutes) {
        if (!free(date, m)) continue
        if (conflicts(busy, hm(m), slotMinutes, travelMinutes).length) continue
        const before = busy.filter((b) => b.end <= m - travelMinutes).sort((a, b) => b.end - a.end)[0]
        found = { vehicleId: v.id, date, time: hm(m), minutes: slotMinutes, after: before ? `nach Dienst ${hm(before.start)}–${hm(before.end)}` : '' }
        used.push({ date, s: m, e: m + slotMinutes })
        break
      }
      if (found) break
    }
    if (found) proposals.push(found)
    else unplaced.push(v.id)
  }
  return { proposals, unplaced }
}

// ---------------------------------------------------------------- E-Mails

const dateText = (date) => formatDate(date, { year: true })
const workshopText = (w) => [w?.name, w?.address, w?.phone ? `Tel. ${w.phone}` : ''].filter(Boolean).join(', ')

const taskName = (vehicle, t) => TASKS[t] || (vehicle.dues || []).find((d) => `due:${d.id}` === t)?.label || t
const isTireOnly = (c) => (c.kind || 'reifen') === 'reifen' && !(c.tasks || []).length
const joinAnd = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : parts[0] || '')
const tidy = (lines) => lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n').trim()

/** Was beim Termin gemacht wird, in Worten: „Wechsel auf Winterreifen, Service und §57a-Begutachtung (Pickerl)“ */
export function changeWhat(change, vehicle) {
  const parts = (change.kind || 'reifen') === 'reifen' ? [`Wechsel auf ${change.season === 'winter' ? 'Winterreifen' : 'Sommerreifen'}`] : []
  parts.push(...(change.tasks || []).map((t) => taskName(vehicle, t)))
  return joinAnd(parts) || 'Werkstatttermin'
}

/** E-Mail an die Fahrerin bzw. den Fahrer (Du-Form wie bei den Wochenplänen). */
export function driverMail({ change, vehicle, workshop, driverName = '', sender = '', brand = '' }) {
  const tire = (change.kind || 'reifen') === 'reifen'
  const season = change.season === 'winter' ? 'Winterreifen' : 'Sommerreifen'
  const set = (tire && vehicle.tires?.[change.season]) || {}
  const tasks = change.tasks || []
  return {
    subject: `${isTireOnly(change) ? 'Reifenwechsel' : 'Werkstatttermin'} ${vehicle.plate}: ${dateText(change.date)} um ${change.time} Uhr`,
    text: tidy([
      `Hallo ${String(driverName).split(' ')[0] || ''},`.replace(' ,', ','),
      '',
      isTireOnly(change) ? `für dein Firmenauto ${vehicle.plate}${vehicle.label ? ` (${vehicle.label})` : ''} ist der Wechsel auf ${season} geplant:` : `für dein Firmenauto ${vehicle.plate}${vehicle.label ? ` (${vehicle.label})` : ''} ist ein Werkstatttermin geplant: ${changeWhat(change, vehicle)}.`,
      '',
      `Termin: ${dateText(change.date)}, ${change.time} Uhr (ca. ${change.minutes || 30} Minuten)`,
      workshop ? `Werkstatt: ${workshopText(workshop)}` : '',
      set.storage ? `Die ${season} liegen: ${set.storage}` : '',
      tasks.includes('pickerl') ? 'Für das Pickerl bitte den Zulassungsschein im Auto lassen.' : '',
      tasks.includes('service') ? 'Bitte das Serviceheft (falls vorhanden) im Auto lassen.' : '',
      change.note ? `Hinweis: ${change.note}` : '',
      '',
      'Bitte bring das Auto rechtzeitig hin. Passt der Termin nicht, melde dich bitte gleich bei der Disposition.',
      '',
      'Liebe Grüße',
      sender,
      brand,
    ]),
  }
}

/** Sammel-E-Mail an die Werkstatt mit allen Terminen (Sie-Form). */
export function workshopMail({ rows, workshop, campaign, sender = '', brand = '' }) {
  const tiresOnly = rows.every((r) => isTireOnly(r.change))
  const lines = rows
    .slice()
    .sort((a, b) => `${a.change.date} ${a.change.time}`.localeCompare(`${b.change.date} ${b.change.time}`))
    .map(({ change, vehicle }) => {
      const head = `• ${dateText(change.date)} ${change.time} Uhr · ${vehicle.plate}${vehicle.label ? ` ${vehicle.label}` : ''}`
      const extra = (change.tasks || []).map((t) => taskName(vehicle, t))
      if ((change.kind || 'reifen') !== 'reifen') return `${head} · ${joinAnd(extra)}`
      const set = vehicle.tires?.[change.season] || {}
      return `${head} · ${change.season === 'winter' ? 'auf Winterreifen' : 'auf Sommerreifen'}${set.size ? ` ${set.size}` : ''}${set.storage ? ` · eingelagert: ${set.storage}` : ''}${extra.length ? ` · dazu: ${joinAnd(extra)}` : ''}`
    })
  const n = `${rows.length} ${rows.length === 1 ? 'Fahrzeug' : 'Fahrzeuge'}${brand ? ` (${brand})` : ''}`
  return {
    subject: tiresOnly && campaign ? `Reifenwechsel ${campaign.label}: ${n}` : `Werkstatttermine: ${n}`,
    text: tidy([
      `Sehr geehrte Damen und Herren${workshop?.name ? ` von ${workshop.name}` : ''},`,
      '',
      tiresOnly ? 'wir möchten folgende Reifenwechsel vereinbaren:' : 'wir möchten folgende Termine vereinbaren:',
      '',
      ...lines,
      '',
      tiresOnly ? 'Bitte um kurze Bestätigung oder einen Gegenvorschlag. Fällt Ihnen beim Wechsel ein zu geringes Profil oder ein Schaden auf, geben Sie uns bitte Bescheid.' : 'Bitte um kurze Bestätigung oder einen Gegenvorschlag. Fällt Ihnen etwas auf (Reifenprofil, Mängel, anstehende Reparaturen), geben Sie uns bitte vorher Bescheid.',
      '',
      'Freundliche Grüße',
      sender,
      brand,
    ]),
  }
}

// ---------------------------------------------------------------- Liste und Übernahme

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '')

/** Liste für Excel. rows: [{ vehicle, change, driver, workshop, status }] */
export function tireCsv(rows) {
  const head = ['Kennzeichen', 'Fahrzeug', 'Art', 'Fahrer/in', 'Montiert', 'Saison', 'Termin', 'Uhrzeit', 'Werkstatt', 'Status', 'Reifengröße', 'Einlagerung', 'Profil VL', 'Profil VR', 'Profil HL', 'Profil HR', 'km', 'Kosten', 'Was']
  const lines = rows.map(({ vehicle, change, driver, workshop, status }) => {
    const season = change?.season || (vehicle.mounted === 'winter' ? 'winter' : 'sommer')
    const set = vehicle.tires?.[season] || {}
    const tread = change?.tread || set.tread || {}
    return [vehicle.plate, vehicle.label, VEHICLE_KINDS[vehicle.kind]?.label || '', driver || '', SEASONS[vehicle.mounted] || '', change ? SEASONS[change.season] : '', dmy(change?.date), change?.time || '', workshop || '', STATUS_LABEL[status] || status || '', set.size || '', set.storage || '', ...WHEELS.map(([k]) => tread[k] ?? ''), change?.km ?? '', change?.cost ?? '', change ? changeWhat(change, vehicle) : '']
  })
  return `﻿${[head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`
}

// ß → ss vor dem Entfernen der Sonderzeichen („Straße“ = „Strasse“)
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const pick = (row, ...names) => {
  const key = Object.keys(row).find((k) => names.includes(norm(k)))
  return key === undefined ? '' : String(row[key] ?? '').trim()
}

/**
 * Fahrzeugart aus der Spalte „Art“: bis 3,5 t (auch „3,5t“, Klein-Lkw, N1) ist
 * ein Transporter, Lkw nur über 3,5 t (N2, N3) oder „Lkw“ ohne „bis 3,5 t“;
 * Pkw auch als Kombi, Limousine, Personenkraftwagen oder M1.
 */
function vehicleKind(text) {
  const t = norm(text)
  if (!t) return 'pkw'
  const code = String(text).toUpperCase().match(/\b[MN][1-3]\b/)?.[0]
  if (/bis35|kleinlkw/.test(t) || code === 'N1') return 'transporter'
  if (/uber35|mehrals35|lkw/.test(t) || code === 'N2' || code === 'N3') return 'lkw'
  if (/pkw|personen|kombi|limousine/.test(t) || code === 'M1') return 'pkw'
  return 'transporter'
}

/** Zulassung, km, Pickerl und Service aus einer Zeile der Fahrzeugliste. */
function dueFields(row, today) {
  const out = {}
  const cls = pick(row, 'klasse', 'fahrzeugklasse').toUpperCase().match(/[MN][1-3]/)?.[0]
  if (cls) out.cls = cls
  const reg = parseMonth(pick(row, 'erstzulassung', 'ez', 'zulassung'))
  if (reg) out.firstReg = reg
  const km = num(pick(row, 'kmstand', 'km', 'kilometer').replace(/\./g, ''))
  if (km && today) out.kmLog = [{ date: today, km }]
  const pickerl = parseMonth(pick(row, 'pickerl', 'begutachtung', '57a', 'nachstespickerl', 'pickerlfallig'))
  if (pickerl) out.pickerl = { next: pickerl }
  const serviceText = pick(row, 'service', 'nachstesservice', 'servicefallig', 'serviceam')
  const serviceKm = num(pick(row, 'servicebeikm', 'servicekm', 'nachstesservicekm').replace(/\./g, ''))
  const serviceDate = parseDate(serviceText) || (parseMonth(serviceText) ? `${parseMonth(serviceText)}-01` : '')
  if (serviceDate || serviceKm) out.service = { months: '', km: '', lastDate: '', lastKm: '', nextDate: serviceDate, nextKm: serviceKm || '' }
  return out
}

/**
 * Fahrzeugliste aus Excel (kopiert oder CSV): Kennzeichen, Fahrzeug, Art,
 * Fahrer/in, Sommerreifen, Winterreifen, Lagerort, Werkstatt, Montiert;
 * dazu Klasse, Erstzulassung, km-Stand, Pickerl (Monat/Jahr), Service
 * (Datum oder Monat), Service bei km.
 * Fahrer/innen und Werkstätten werden über den Namen zugeordnet. Der km-Stand
 * gilt am Tag `today` (ohne Angabe: heute).
 */
export function importVehicles(text, { employees = [], workshops = [], today = todayISO() } = {}) {
  const byName = (list, name) => {
    const n = norm(name)
    return n ? list.find((x) => norm(x.name) === n) || list.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name))) : null
  }
  const out = []
  const warnings = []
  for (const row of parseTable(text)) {
    const plate = pick(row, 'kennzeichen', 'kfz', 'kfzkennzeichen', 'plate').toUpperCase()
    if (!plate) continue
    const kind = vehicleKind(pick(row, 'art', 'typ', 'fahrzeugart'))
    const driverName = pick(row, 'fahrer', 'fahrerin', 'fahrerfahrerin', 'mitarbeiter', 'mitarbeiterin')
    const driver = byName(employees, driverName)
    if (driverName && !driver) warnings.push(`${plate}: „${driverName}“ ist bei den Mitarbeitenden nicht bekannt.`)
    const workshop = byName(workshops, pick(row, 'werkstatt', 'reifenhandler', 'reifendienst'))
    const storage = pick(row, 'lagerort', 'einlagerung', 'lager')
    const mountedText = norm(pick(row, 'montiert', 'drauf', 'aktuell'))
    const allSeason = /ganzjahr|allwetter/.test(norm(pick(row, 'sommerreifen', 'sommer')) + mountedText)
    out.push({
      plate,
      label: pick(row, 'fahrzeug', 'modell', 'marke', 'bezeichnung'),
      kind,
      driverId: driver?.id || '',
      workshopId: workshop?.id || '',
      mounted: allSeason ? 'ganzjahr' : /winter/.test(mountedText) ? 'winter' : 'sommer',
      tires: allSeason ? {} : { sommer: { size: pick(row, 'sommerreifen', 'sommer', 'reifengrossesommer'), storage: '', tread: {} }, winter: { size: pick(row, 'winterreifen', 'winter', 'reifengrossewinter'), storage, tread: {} } },
      note: pick(row, 'bemerkung', 'hinweis', 'notiz'),
      ...dueFields(row, today),
    })
  }
  return { vehicles: out, warnings }
}

/** Nach dem Wechsel: Reifensatz und Einlagerung am Fahrzeug nachtragen. */
export function applyDone(vehicle, change) {
  const other = change.season === 'winter' ? 'sommer' : 'winter'
  const tires = structuredClone(vehicle.tires || {})
  tires[change.season] = { ...(tires[change.season] || {}), ...(lowestTread(change.tread) !== null ? { tread: change.tread } : {}) }
  if (change.storage || lowestTread(change.removedTread) !== null) tires[other] = { ...(tires[other] || {}), ...(change.storage ? { storage: change.storage } : {}), ...(lowestTread(change.removedTread) !== null ? { tread: change.removedTread } : {}) }
  // montierter Satz liegt nicht mehr im Lager
  if (tires[change.season]) tires[change.season].storage = ''
  return { ...vehicle, mounted: change.season, tires }
}
