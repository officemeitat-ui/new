import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ROLES } from '../src/core/access.js'
import { todayISO } from '../src/core/dates.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { icsEvent } from '../src/core/ics.js'
import { applyDone, campaignFor, campaignSummary, conflicts, driverMail, importVehicles, minTread, proposeSlots, tireAge, tireCsv, tireIssues, vehicleStatus, workshopMail } from '../src/core/vehicles.js'
import { createModuleDemo } from '../src/data/demo-modules.js'
import { MODULE_DOCS } from '../src/storage/data-service.js'

const van = { id: 'v1', plate: 'S-284 KL', label: 'VW Caddy', kind: 'transporter', driverId: 'e2', mounted: 'sommer', tires: { sommer: { size: '205/55 R16', tread: { vl: 5, vr: 5, hl: 4.5, hr: 4.5 } }, winter: { size: '205/55 R16', storage: 'Reifen Muster, Regal 14', dot: '3822', tread: { vl: 6.5, vr: 6.5, hl: 6, hr: 6 } } } }

test('Reifen: Wechselrunde nach Datum (Winter bis 31.10., Sommer ab 16.4.)', () => {
  assert.deepEqual([campaignFor('2026-10-25').key, campaignFor('2026-10-25').by], ['winter-2026', '2026-10-31'])
  assert.equal(campaignFor('2027-01-10').key, 'winter-2026', 'Jänner gehört zur Wintersaison des Vorjahres')
  assert.equal(campaignFor('2027-01-10').label, 'Winterreifen 2026/27')
  const s = campaignFor('2027-04-02')
  assert.deepEqual([s.key, s.earliest, s.by], ['sommer-2027', '2027-04-16', '2027-05-15'])
})

test('Reifen: Mindestprofil nach Fahrzeugart, Reifenalter aus der DOT-Nummer', () => {
  assert.deepEqual(minTread(van, 'winter'), { legal: 4, advised: 5 })
  assert.deepEqual(minTread({ kind: 'lkw' }, 'winter'), { legal: 5, advised: 6 })
  assert.deepEqual(minTread(van, 'sommer'), { legal: 1.6, advised: 3 })
  assert.equal(Math.floor(tireAge('DOT XY12 1920', '2026-10-25')), 6)
  assert.equal(tireAge('', '2026-10-25'), null)
  assert.equal(tireAge('5999', '2026-10-25'), null, 'Woche 59 gibt es nicht')
  const heavy = { ...van, kind: 'lkw', tires: { winter: { tread: { vl: 5, vr: 4.8, hl: 4.5, hr: 4.5 }, dot: '1920' } } }
  const issues = tireIssues(heavy, 'winter', '2026-10-25')
  assert.equal(issues[0].level, 'error')
  assert.match(issues[0].text, /4,5 mm Profil, gesetzlich mindestens 5 mm/)
  assert.match(issues[1].text, /6 Jahre alt/)
  assert.deepEqual(tireIssues(van, 'winter', '2026-10-25'), [], '6 mm Winterreifen am Transporter passen')
  assert.equal(tireIssues({ kind: 'pkw', tires: { ganzjahr: { tread: { vl: 3.5 } } } }, 'ganzjahr', '2026-10-25')[0].level, 'error', 'Ganzjahresreifen brauchen im Winter 4 mm')
})

test('Reifen: Stand je Fahrzeug durch die Saison', () => {
  const fz = { vehicles: [van], changes: [] }
  assert.equal(vehicleStatus(fz, van, '2026-09-20').status, 'offen')
  assert.equal(vehicleStatus(fz, van, '2026-11-02').status, 'ueberfaellig')
  fz.changes.push({ id: 'c1', vehicleId: 'v1', season: 'winter', year: 2026, date: '2026-10-29', time: '07:00', status: 'geplant' })
  assert.equal(vehicleStatus(fz, van, '2026-10-25').status, 'geplant')
  assert.equal(vehicleStatus(fz, van, '2026-10-30').status, 'vorbei', 'Termin war, aber nicht bestätigt')
  fz.changes[0].status = 'abgesagt'
  assert.equal(vehicleStatus(fz, van, '2026-10-25').status, 'offen', 'abgesagt zählt nicht')
  assert.equal(vehicleStatus(fz, { ...van, mounted: 'winter' }, '2026-10-25').status, 'erledigt')
  assert.equal(vehicleStatus(fz, { ...van, mounted: 'winter' }, '2027-04-20').status, 'offen', 'im Frühjahr wieder offen')
  assert.equal(vehicleStatus(fz, { ...van, mounted: 'ganzjahr' }, '2026-10-25').status, 'ganzjahr')
  const early = { vehicles: [van], changes: [{ id: 'c2', vehicleId: 'v1', season: 'sommer', year: 2027, date: '2027-04-08', time: '08:00', status: 'geplant' }] }
  assert.equal(vehicleStatus(early, { ...van, mounted: 'winter' }, '2027-04-01').early, true, 'Sommerreifen vor dem 16. April')
})

test('Reifen: Termine neben den Diensten vorschlagen', () => {
  // Ana: Dienst 06:00–08:30 und 09:00–13:00 (Minuten des Tages); Dragan: Mittwoch Urlaub
  const busy = { e1: { '2026-10-27': [{ start: 360, end: 510, label: 'Autohaus' }, { start: 540, end: 780, label: 'Versicherung' }] }, e4: { '2026-10-28': [{ allDay: true, label: 'Urlaub' }] } }
  const busyOf = (emp, date) => busy[emp]?.[date] || []
  assert.equal(conflicts(busyOf('e1', '2026-10-27'), '08:30', 30, 20).length, 2, 'mit Fahrzeit vor und nach dem Termin')
  assert.equal(conflicts(busyOf('e1', '2026-10-27'), '13:30', 30, 20).length, 0)
  assert.match(conflicts(busyOf('e1', '2026-10-27'), '12:00', 30)[0].text, /^09:00–13:00 Versicherung/)
  const res = proposeSlots(
    [
      { id: 'v6', driverId: 'e1' },
      { id: 'v2', driverId: 'e4' },
      { id: 'v9', driverId: '' },
    ],
    { from: '2026-10-27', to: '2026-10-30', dayStart: '07:00', dayEnd: '17:00', slotMinutes: 30, travelMinutes: 20, busyOf, taken: [{ date: '2026-10-27', time: '07:00', minutes: 30 }] },
  )
  assert.deepEqual(res.proposals.map((p) => [p.vehicleId, p.date, p.time]), [
    ['v6', '2026-10-27', '13:30'],
    ['v2', '2026-10-27', '07:30'],
    ['v9', '2026-10-27', '08:00'],
  ])
  assert.equal(res.proposals[0].after, 'nach Dienst 09:00–13:00')
  const weekend = proposeSlots([{ id: 'v1', driverId: '' }], { from: '2026-10-31', to: '2026-11-01', busyOf })
  assert.deepEqual(weekend.unplaced, ['v1'], 'Samstag und Sonntag hat die Werkstatt zu')
})

test('Reifen: Vorschläge überschneiden keine vergebenen Plätze und lassen Feiertage aus', () => {
  const overlap = (p, t) => {
    const m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))
    return m(p.time) < m(t.time) + t.minutes && m(t.time) < m(p.time) + p.minutes
  }
  // 60 Minuten, belegt 07:30–08:00: 07:00–08:00 überschneidet sich
  const taken = [{ date: '2026-11-03', time: '07:30', minutes: 30 }]
  const one = proposeSlots([{ id: 'v1' }], { from: '2026-11-03', to: '2026-11-03', slotMinutes: 60, travelMinutes: 0, taken }).proposals[0]
  assert.deepEqual([one.time, overlap(one, taken[0])], ['08:00', false])
  // belegt außerhalb des Rasters (07:45–08:15)
  const off = [{ date: '2026-11-03', time: '07:45', minutes: 30 }]
  const three = proposeSlots([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { from: '2026-11-03', to: '2026-11-03', slotMinutes: 30, travelMinutes: 0, taken: off }).proposals
  assert.deepEqual(three.map((p) => p.time), ['07:00', '08:30', '09:00'])
  // 26.10. Nationalfeiertag, 8.12. Mariä Empfängnis; betriebsfreie Tage über holidays
  assert.equal(proposeSlots([{ id: 'v1' }], { from: '2026-10-26', to: '2026-10-30' }).proposals[0].date, '2026-10-27')
  assert.equal(proposeSlots([{ id: 'v1' }], { from: '2026-12-08', to: '2026-12-11' }).proposals[0].date, '2026-12-09')
  const free = holidayCalendar('2026-12-21', '2026-12-31', [{ date: '2026-12-24', name: 'Heiliger Abend' }])
  assert.equal(proposeSlots([{ id: 'v1' }], { from: '2026-12-24', to: '2026-12-31', holidays: free }).proposals[0].date, '2026-12-28')
})

test('Fahrzeugliste: Art „bis 3,5 t“ ist Transporter, Kombi ist Pkw, km-Stand ohne Datum gilt heute', () => {
  const kindOf = (art) => importVehicles(`Kennzeichen\tArt\nS-1\t${art}`, { today: '2026-10-26' }).vehicles[0].kind
  assert.deepEqual(['Transporter bis 3,5 t', 'Lkw bis 3,5 t', 'Kastenwagen 3,5t', 'Klein-Lkw', 'N1'].map(kindOf), ['transporter', 'transporter', 'transporter', 'transporter', 'transporter'])
  assert.deepEqual(['Lkw über 3,5 t', 'Lkw', 'N2', 'Sattelzug N3'].map(kindOf), ['lkw', 'lkw', 'lkw', 'lkw'])
  assert.deepEqual(['Pkw', 'Kombi', 'Personenkraftwagen', 'Limousine', 'M1', ''].map(kindOf), ['pkw', 'pkw', 'pkw', 'pkw', 'pkw', 'pkw'])
  // eigene Liste wieder einlesen: Transporter bleibt Transporter (Winterreifen 4 mm, nicht 5 mm)
  const csv = tireCsv([{ vehicle: van, change: null, driver: '', workshop: '', status: 'erledigt' }]).replace(/^﻿/, '')
  const back = importVehicles(csv, { today: '2026-10-26' }).vehicles[0]
  assert.deepEqual([back.kind, minTread(back, 'winter').legal], ['transporter', 4])
  // so ruft die App auf: ohne today → km-Stand von heute statt verloren
  const a = importVehicles('Kennzeichen\tkm-Stand\nS-284 KL\t58.100', { employees: [], workshops: [] }).vehicles[0]
  assert.deepEqual(a.kmLog, [{ date: todayISO(), km: 58100 }])
})

test('Reifen: E-Mail an Fahrer/in und Sammelliste an die Werkstatt', () => {
  const change = { id: 'c1', vehicleId: 'v1', season: 'winter', year: 2026, date: '2026-10-29', time: '07:00', minutes: 30, note: 'Laderaum ausräumen' }
  const workshop = { name: 'Reifen Muster GmbH', address: 'Musterstraße 5, 5020 Salzburg', phone: '+43 662 000000', email: 'termine@reifen-muster.example' }
  const mail = driverMail({ change, vehicle: van, workshop, driverName: 'Markus Huber', sender: 'Disposition', brand: 'Firma' })
  assert.equal(mail.subject, 'Reifenwechsel S-284 KL: Do 29.10.2026 um 07:00 Uhr')
  assert.match(mail.text, /^Hallo Markus,\n\nfür dein Firmenauto S-284 KL \(VW Caddy\) ist der Wechsel auf Winterreifen geplant:/)
  assert.match(mail.text, /Werkstatt: Reifen Muster GmbH, Musterstraße 5, 5020 Salzburg, Tel\. \+43 662 000000/)
  assert.match(mail.text, /Die Winterreifen liegen: Reifen Muster, Regal 14/)
  assert.match(mail.text, /Hinweis: Laderaum ausräumen/)
  assert.ok(!/\n\n\n/.test(mail.text), 'keine doppelten Leerzeilen')
  const ws = workshopMail({ rows: [{ change: { ...change, date: '2026-10-30', time: '08:00' }, vehicle: { ...van, plate: 'S-511 TR', label: 'Renault Trafic' } }, { change, vehicle: van }], workshop, campaign: campaignFor('2026-10-25'), sender: 'Disposition' })
  assert.equal(ws.subject, 'Reifenwechsel Winterreifen 2026/27: 2 Fahrzeuge')
  const lines = ws.text.split('\n').filter((l) => l.startsWith('•'))
  assert.deepEqual(lines, ['• Do 29.10.2026 07:00 Uhr · S-284 KL VW Caddy · auf Winterreifen 205/55 R16 · eingelagert: Reifen Muster, Regal 14', '• Fr 30.10.2026 08:00 Uhr · S-511 TR Renault Trafic · auf Winterreifen 205/55 R16 · eingelagert: Reifen Muster, Regal 14'])
  assert.match(ws.text, /^Sehr geehrte Damen und Herren von Reifen Muster GmbH,/)
  const ics = icsEvent({ uid: 'c1@reifenwechsel', date: '2026-10-29', time: '07:00', minutes: 30, title: 'Reifenwechsel S-284 KL', remindHours: 12 }).split('\r\n')
  assert.ok(ics.includes('DTSTART:20261029T070000') && ics.includes('DTEND:20261029T073000') && ics.includes('TRANSP:OPAQUE'))
})

test('Reifen: Liste für Excel, Fahrzeugliste übernehmen, Erledigt nachtragen', () => {
  const csv = tireCsv([{ vehicle: van, change: { season: 'winter', date: '2026-10-29', time: '07:00', km: 48210 }, driver: 'Markus Huber', workshop: 'Reifen Muster GmbH', status: 'geplant' }])
  const [head, row] = csv.replace('﻿', '').trim().split('\r\n')
  assert.ok(head.startsWith('Kennzeichen;Fahrzeug;Art;Fahrer/in;Montiert;Saison;Termin'))
  assert.ok(row.startsWith('S-284 KL;VW Caddy;Transporter bis 3,5 t;Markus Huber;Sommerreifen;Winterreifen;29.10.2026;07:00;Reifen Muster GmbH;Termin geplant;205/55 R16;Reifen Muster, Regal 14;6.5;6.5;6;6;48210'))

  const employees = [{ id: 'e2', name: 'Markus Huber' }, { id: 'e4', name: 'Dragan Jović' }]
  const workshops = [{ id: 'w1', name: 'Reifen Muster GmbH' }]
  const text = 'Kennzeichen\tFahrzeug\tArt\tFahrer/in\tSommerreifen\tWinterreifen\tLagerort\tWerkstatt\tMontiert\ns-284 kl\tVW Caddy\tKastenwagen\tMarkus Huber\t205/55 R16\t205/55 R16\tRegal 14\tReifen Muster\tSommer\nS-907 PL\tMAN TGE\tLkw über 3,5 t\tDragan Jovic\t205/75 R16C\t205/75 R16C\tHalle 2\t\tWinter\nS-620 GA\tOpel Combo\tPkw\tUnbekannt\tGanzjahr 205/60 R16\t\t\t\t'
  const { vehicles, warnings } = importVehicles(text, { employees, workshops })
  assert.deepEqual(vehicles.map((v) => [v.plate, v.kind, v.driverId, v.workshopId, v.mounted]), [
    ['S-284 KL', 'transporter', 'e2', 'w1', 'sommer'],
    ['S-907 PL', 'lkw', 'e4', '', 'winter'],
    ['S-620 GA', 'pkw', '', '', 'ganzjahr'],
  ])
  assert.equal(vehicles[0].tires.winter.storage, 'Regal 14')
  assert.deepEqual(warnings, ['S-620 GA: „Unbekannt“ ist bei den Mitarbeitenden nicht bekannt.'])

  const done = applyDone(van, { season: 'winter', tread: { vl: 6.4, vr: 6.4, hl: 6, hr: 6 }, removedTread: { vl: 4.8, vr: 4.8, hl: 4.2, hr: 4.2 }, storage: 'Reifen Muster, Regal 14' })
  assert.equal(done.mounted, 'winter')
  assert.deepEqual([done.tires.winter.storage, done.tires.winter.tread.vl], ['', 6.4], 'montierter Satz ist nicht mehr im Lager')
  assert.deepEqual([done.tires.sommer.storage, done.tires.sommer.tread.hl], ['Reifen Muster, Regal 14', 4.2])
  assert.equal(van.mounted, 'sommer', 'Original bleibt unverändert')
})

test('Reifen: eigene Datei, Rolle Fuhrpark, Beispieldaten', () => {
  assert.equal(MODULE_DOCS.fahrzeuge.path, 'fahrzeuge/fahrzeuge.json')
  assert.deepEqual(DEFAULT_ROLES.fuhrpark, { label: 'Fuhrpark', modules: ['fahrzeuge'], edit: ['fahrzeuge'] })
  const fz = createModuleDemo('2026-10-26').fahrzeuge
  const { counts, total } = campaignSummary(fz, '2026-10-25')
  assert.deepEqual([total, counts.geplant, counts.offen, counts.erledigt, counts.ganzjahr], [7, 3, 2, 1, 1])
  assert.ok(JSON.stringify(fz).match(/example/), 'nur erfundene Adressen')
})
