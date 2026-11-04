import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addKm, addMonths, applyTasksDone, classOf, currentKm, dueStatus, fleetCsv, kmFits, kmPerDay, monthAdd, monthText, openTasks, parseKm, pickerlSchedule, pickerlStatus, pickerlWindow, serviceNext, serviceStatus, taskLabel, vehicleDues } from '../src/core/vehicle-dues.js'
import { applyDone, campaignFor, campaignSummary, changeWhat, conflicts, driverMail, importVehicles, lowestTread, proposeSlots, tireAge, tireCsv, tireIssues, vehicleStatus, workshopMail } from '../src/core/vehicles.js'

const van = { id: 'v1', plate: 'S-123 AB', label: 'Kastenwagen', kind: 'transporter', driverId: 'e1', mounted: 'sommer', tires: { sommer: { size: '215/65 R16C', tread: { vl: 5, vr: 5, hl: 5, hr: 5 } }, winter: { size: '215/65 R16C', storage: 'Halle 2, Regal 3', tread: { vl: 6, vr: 6, hl: 6, hr: 6 } } } }

// ---------------------------------------------------------------- Reifen-Saison

const campaigns = [
  ['2026-02-28', 'winter-2025', 'Winterreifen 2025/26'],
  ['2026-03-01', 'sommer-2026', 'Sommerreifen 2026'],
  ['2026-08-31', 'sommer-2026', 'Sommerreifen 2026'],
  ['2026-09-01', 'winter-2026', 'Winterreifen 2026/27'],
  ['2099-12-31', 'winter-2099', 'Winterreifen 2099/00'],
]
for (const [date, key, label] of campaigns)
  test(`Reifen-Saison am ${date}: ${label}`, () => {
    const c = campaignFor(date)
    assert.deepEqual([c.key, c.label], [key, label])
  })

test('Reifenprofil: Komma als Dezimalzeichen, ungültige Werte ignoriert', () => {
  assert.equal(lowestTread({ vl: '4,5', vr: '6', hl: '', hr: 'abc' }), 4.5)
  assert.equal(lowestTread({}), null)
  assert.equal(lowestTread(undefined), null)
})

test('Reifenalter aus der DOT-Nummer: Woche 1 und 53 gültig, Woche 0 nicht', () => {
  assert.equal(Math.floor(tireAge('0120', '2026-01-02')), 6)
  assert.equal(Math.floor(tireAge('DOT 5320', '2026-11-03')), 5)
  assert.equal(tireAge('0020', '2026-11-03'), null)
  assert.equal(tireAge('DOT', '2026-11-03'), null)
})

test('Reifen-Hinweise: Sommerreifen unter 3 mm Warnung, unter 1,6 mm Fehler, Transporter-Winterreifen unter 5 mm Warnung', () => {
  const v = (season, tread, kind = 'pkw') => ({ kind, tires: { [season]: { tread } } })
  assert.deepEqual(tireIssues(v('sommer', { vl: 2.5 }), 'sommer', '2026-11-03').map((i) => [i.level, i.text]), [['warning', 'Sommerreifen: nur 2,5 mm Profil. Neue Reifen für die nächste Saison einplanen.']])
  assert.equal(tireIssues(v('sommer', { vl: 1.5 }), 'sommer', '2026-11-03')[0].level, 'error')
  assert.equal(tireIssues(v('winter', { vl: 4.5 }, 'transporter'), 'winter', '2026-11-03')[0].level, 'warning')
  assert.deepEqual(tireIssues(v('winter', { vl: 5 }, 'transporter'), 'winter', '2026-11-03'), [])
  assert.deepEqual(tireIssues({ kind: 'pkw', tires: {} }, 'winter', '2026-11-03'), [], 'ohne Reifensatz nichts')
})

test('Reifen-Stand: Werkstatttermin ist kein Reifenwechsel, Frist 31.10. gilt bis einschließlich', () => {
  const fz = { vehicles: [van], changes: [{ id: 'w', vehicleId: 'v1', kind: 'werkstatt', season: 'winter', year: 2026, date: '2026-10-20', status: 'erledigt' }] }
  assert.equal(vehicleStatus(fz, van, '2026-10-31').status, 'offen')
  assert.equal(vehicleStatus(fz, van, '2026-11-01').status, 'ueberfaellig')
  fz.changes.push({ id: 'r', vehicleId: 'v1', season: 'winter', year: 2026, date: '2026-10-22', status: 'erledigt' })
  assert.equal(vehicleStatus(fz, van, '2026-11-01').status, 'erledigt', 'umgerüstet, auch wenn „montiert“ noch nicht nachgetragen ist')
  const winterOnly = { vehicles: [], changes: [{ vehicleId: 'v1', season: 'winter', year: 2026, date: '2026-10-20', status: 'geplant' }] }
  assert.equal(vehicleStatus(winterOnly, van, '2026-10-01').early, false, '„zu früh“ gibt es nur bei Sommerreifen')
  assert.equal(vehicleStatus(winterOnly, { ...van, mounted: 'winter' }, '2027-04-20').status, 'offen', 'Wintertermin zählt nicht für die Sommerrunde')
  assert.equal(vehicleStatus(winterOnly, van, '2027-04-20').status, 'erledigt', 'Sommerreifen sind schon drauf')
})

test('Reifen-Übersicht: stillgelegte Fahrzeuge zählen nicht', () => {
  const fz = { vehicles: [van, { ...van, id: 'v2', inactive: true }, { ...van, id: 'v3', mounted: 'ganzjahr' }, { ...van, id: 'v4', mounted: 'winter' }], changes: [] }
  const s = campaignSummary(fz, '2026-10-01')
  assert.equal(s.total, 3)
  assert.deepEqual([s.counts.offen, s.counts.ganzjahr, s.counts.erledigt], [1, 1, 1])
})

// ---------------------------------------------------------------- Termine neben den Diensten

test('Werkstatttermin: angrenzender Dienst ohne Fahrzeit ist kein Konflikt, mit Fahrzeit schon', () => {
  const busy = [{ start: 480, end: 600, label: 'Kanzlei' }]
  assert.equal(conflicts(busy, '10:00', 30).length, 0)
  assert.equal(conflicts(busy, '10:00', 30, 1).length, 1)
  assert.equal(conflicts(busy, '07:30', 30).length, 0, 'endet genau bei Dienstbeginn')
  assert.deepEqual(conflicts([{ allDay: true, label: 'Urlaub' }], '12:00', 30).map((c) => c.text), ['Urlaub'])
})

test('Terminvorschläge: Platz muss vor Werkstattschluss enden, Fahrer/in den ganzen Zeitraum weg → nicht eingeplant', () => {
  const busyOf = (emp) => (emp === 'weg' ? [{ allDay: true, label: 'Urlaub' }] : [{ start: 420, end: 990, label: 'Dienst' }])
  const r = proposeSlots([{ id: 'v1', driverId: 'spaet' }, { id: 'v2', driverId: 'weg' }], { from: '2026-11-03', to: '2026-11-04', dayStart: '07:00', dayEnd: '17:00', slotMinutes: 30, travelMinutes: 0, busyOf })
  // Dienst bis 16:30, letzter Platz 16:30–17:00
  assert.deepEqual(r.proposals.map((p) => [p.vehicleId, p.date, p.time, p.after]), [['v1', '2026-11-03', '16:30', 'nach Dienst 07:00–16:30']])
  assert.deepEqual(r.unplaced, ['v2'])
  const noRoom = proposeSlots([{ id: 'v1', driverId: 'spaet' }], { from: '2026-11-03', to: '2026-11-03', dayEnd: '17:00', travelMinutes: 20, busyOf })
  assert.deepEqual(noRoom.unplaced, ['v1'], 'mit 20 min Fahrzeit passt nichts mehr')
})

test('Terminvorschläge: mehrere Fahrzeuge belegen die Plätze der Reihe nach, ohne Fahrer/in kein „nach Dienst“', () => {
  const r = proposeSlots([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { from: '2026-11-03', to: '2026-11-03', dayStart: '08:00', dayEnd: '09:30', slotMinutes: 30 })
  assert.deepEqual(r.proposals.map((p) => [p.vehicleId, p.time, p.after]), [['a', '08:00', ''], ['b', '08:30', ''], ['c', '09:00', '']])
  const full = proposeSlots([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], { from: '2026-11-03', to: '2026-11-04', dayStart: '08:00', dayEnd: '09:30', slotMinutes: 30 })
  assert.deepEqual(full.proposals.at(-1), { vehicleId: 'd', date: '2026-11-04', time: '08:00', minutes: 30, after: '' }, 'vierter am nächsten Tag')
})

// ---------------------------------------------------------------- E-Mails und Liste

test('Was beim Termin gemacht wird: nur Werkstatt, eigene Fälligkeit, unbekannte Aufgabe', () => {
  const v = { dues: [{ id: 'd1', label: 'Tachograph' }] }
  assert.equal(changeWhat({ kind: 'werkstatt', tasks: [] }, v), 'Werkstatttermin')
  assert.equal(changeWhat({ kind: 'werkstatt', tasks: ['due:d1', 'service'] }, v), 'Tachograph und Service')
  assert.equal(changeWhat({ season: 'sommer', tasks: ['due:x'] }, v), 'Wechsel auf Sommerreifen und due:x')
})

test('E-Mail an die Fahrerin: Sommerreifen ohne Lager, ohne Werkstatt und Namen, Service-Hinweis', () => {
  const mail = driverMail({ change: { season: 'sommer', tasks: ['service'], date: '2027-04-20', time: '08:30' }, vehicle: van })
  assert.equal(mail.subject, 'Werkstatttermin S-123 AB: Di 20.04.2027 um 08:30 Uhr')
  assert.match(mail.text, /^Hallo,\n\nfür dein Firmenauto S-123 AB \(Kastenwagen\) ist ein Werkstatttermin geplant: Wechsel auf Sommerreifen und Service\./)
  assert.match(mail.text, /Termin: Di 20\.04\.2027, 08:30 Uhr \(ca\. 30 Minuten\)/)
  assert.match(mail.text, /Serviceheft/)
  assert.ok(!/Werkstatt:|liegen:|Zulassungsschein/.test(mail.text))
  assert.ok(mail.text.endsWith('Liebe Grüße'))
})

test('Sammel-E-Mail an die Werkstatt: ein Fahrzeug, Firmenname im Betreff, nach Termin sortiert', () => {
  const one = workshopMail({ rows: [{ change: { season: 'winter', date: '2026-10-28', time: '09:00' }, vehicle: van }], workshop: {}, campaign: campaignFor('2026-10-01'), brand: 'Reinigung Beispiel' })
  assert.equal(one.subject, 'Reifenwechsel Winterreifen 2026/27: 1 Fahrzeug (Reinigung Beispiel)')
  assert.match(one.text, /^Sehr geehrte Damen und Herren,\n/)
  const rows = [
    { change: { kind: 'werkstatt', tasks: ['pickerl'], date: '2026-11-05', time: '07:30' }, vehicle: { ...van, plate: 'S-2' } },
    { change: { kind: 'werkstatt', tasks: ['service'], date: '2026-11-05', time: '07:00' }, vehicle: { ...van, plate: 'S-1', label: '' } },
  ]
  const ws = workshopMail({ rows, workshop: { name: 'Autohaus Beispiel' } })
  assert.equal(ws.subject, 'Werkstatttermine: 2 Fahrzeuge')
  assert.deepEqual(ws.text.split('\n').filter((l) => l.startsWith('•')), ['• Do 05.11.2026 07:00 Uhr · S-1 · Service', '• Do 05.11.2026 07:30 Uhr · S-2 Kastenwagen · §57a-Begutachtung (Pickerl)'])
})

test('Reifenliste für Excel: BOM, Strichpunkt und Anführungszeichen werden maskiert', () => {
  const csv = tireCsv([{ vehicle: { ...van, label: 'Bus "groß"; Kasten' }, change: null, driver: '', workshop: '', status: 'offen' }])
  assert.ok(csv.startsWith('﻿Kennzeichen;'))
  assert.ok(csv.endsWith('\r\n'))
  const row = csv.trim().split('\r\n')[1]
  assert.ok(row.startsWith('S-123 AB;"Bus ""groß""; Kasten";Transporter bis 3,5 t;;Sommerreifen;;;;;Termin fehlt;215/65 R16C;;5;5;5;5;;;'), row)
})

test('Fahrzeugliste übernehmen: Zeilen ohne Kennzeichen fallen weg, Allwetter = Ganzjahr, Namen ungefähr', () => {
  const text = 'Kfz-Kennzeichen\tTyp\tMitarbeiter\tReifendienst\tAktuell\tBemerkung\n\tPkw\tAnna\t\t\t\ns-77 xy\tKombi\tAnna\tReifen Beispiel\tAllwetter\tAnhängerkupplung\nS-78 XY\tN1\t\t\tWinter\t'
  const { vehicles, warnings } = importVehicles(text, { employees: [{ id: 'e1', name: 'Anna Berger' }], workshops: [{ id: 'w1', name: 'Reifen Beispiel GmbH' }], today: '2026-11-03' })
  assert.deepEqual(vehicles.map((v) => [v.plate, v.kind, v.driverId, v.workshopId, v.mounted, v.note]), [['S-77 XY', 'pkw', 'e1', 'w1', 'ganzjahr', 'Anhängerkupplung'], ['S-78 XY', 'transporter', '', '', 'winter', '']])
  assert.deepEqual(vehicles[0].tires, {}, 'Ganzjahr: keine Sommer/Winter-Sätze')
  assert.deepEqual(warnings, [])
})

test('Nach dem Wechsel auf Sommerreifen: Winterreifen ins Lager, altes Profil bleibt ohne neue Messung', () => {
  const done = applyDone({ ...van, mounted: 'winter' }, { season: 'sommer', storage: 'Halle 2, Regal 3', tread: {}, removedTread: {} })
  assert.equal(done.mounted, 'sommer')
  assert.deepEqual(done.tires.sommer.tread, van.tires.sommer.tread)
  assert.equal(done.tires.sommer.storage, '')
  assert.equal(done.tires.winter.storage, 'Halle 2, Regal 3')
  assert.deepEqual(done.tires.winter.tread, van.tires.winter.tread)
})

// ---------------------------------------------------------------- Pickerl (§57a KFG)

test('Monate rechnen: über den Jahreswechsel, Monatsende, Schaltjahr', () => {
  assert.equal(monthAdd('2027-01', -1), '2026-12')
  assert.equal(monthAdd('2026-11', 14), '2028-01')
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28')
  assert.equal(addMonths('2026-08-31', 1), '2026-09-30')
  assert.equal(addMonths('2027-12-15', 2), '2028-02-15')
  assert.deepEqual([monthText('2027-03'), monthText('')], ['03/2027', ''])
})

test('Pickerl: Klasse aus der Art, Lkw über 3,5 t als N2, unbekannt als Pkw', () => {
  assert.deepEqual([classOf({ kind: 'lkw' }), classOf({ kind: 'pkw' }), classOf({}), classOf({ kind: 'lkw', cls: 'N3' })], ['N2', 'M1', 'M1', 'N3'])
  assert.deepEqual(pickerlWindow('N2', '2027-01'), { from: '2026-10-01', to: '2027-01-31', grace: false })
})

test('Pickerl-Fenster Pkw: Juli 2027 noch altes Recht (−1/+4), August 2027 neues Recht (−4/0)', () => {
  assert.deepEqual(pickerlWindow('M1', '2027-07'), { from: '2027-06-01', to: '2027-11-30', grace: true })
  assert.deepEqual(pickerlWindow('M1', '2027-08'), { from: '2027-04-01', to: '2027-08-31', grace: false })
})

test('Pickerl-Termine: Lkw jährlich ab dem ersten Jahr, Pkw ab 2025 erst nach 4 Jahren', () => {
  assert.deepEqual(pickerlSchedule('N1', '2026-03').slice(0, 2), ['2027-03', '2028-03'])
  assert.deepEqual(pickerlSchedule('M1', '2025-06').slice(0, 5), ['2029-06', '2031-06', '2033-06', '2035-06', '2036-06'])
})

const lkwStates = [
  ['2026-07-01', 'ok'],
  ['2026-07-02', 'bald'],
  ['2026-08-01', 'faellig'],
  ['2026-11-30', 'faellig'],
  ['2026-12-01', 'abgelaufen'],
]
for (const [today, status] of lkwStates) test(`Pickerl Lkw (fällig 11/2026) am ${today}: ${status}`, () => assert.equal(pickerlStatus({ kind: 'transporter', pickerl: { next: '2026-11' } }, today).status, status))

const pkwStates = [
  ['2026-09-30', 'faellig'],
  ['2026-10-01', 'nachfrist'],
  ['2027-01-31', 'nachfrist'],
  ['2027-02-01', 'abgelaufen'],
]
for (const [today, status] of pkwStates) test(`Pickerl Pkw (fällig 09/2026, Nachfrist 4 Monate) am ${today}: ${status}`, () => assert.equal(pickerlStatus({ kind: 'pkw', pickerl: { next: '2026-09' } }, today).status, status))

// ---------------------------------------------------------------- km und Service

test('km-Stand: neuester nach Datum, kaputte Einträge zählen nicht, Hochrechnung erst ab 30 Tagen', () => {
  const v = { kmLog: [{ date: '2026-10-01', km: 1000 }, { date: '2026-10-20', km: 'x' }, { km: 9999 }, { date: '2026-10-15', km: 1500 }] }
  assert.deepEqual(currentKm(v), { km: 1500, date: '2026-10-15' })
  assert.equal(kmPerDay(v), null, 'nur 14 Tage')
  assert.equal(kmPerDay({ kmLog: [{ date: '2026-01-01', km: 5000 }, { date: '2026-03-02', km: 5000 }] }), null, 'nicht gefahren')
  assert.equal(kmPerDay({ kmLog: [{ date: '2026-01-01', km: 5000 }, { date: '2026-01-31', km: 5600 }] }), 20)
  assert.equal(currentKm({}), null)
})

const kms = [
  ["59'000", 59000],
  ['1.234,5', 1235],
  ['12 345 km', 12345],
  [12.6, 13],
  [-5, null],
  ['-5', null],
  [Number.NaN, null],
  ['12a', null],
]
for (const [input, out] of kms) test(`km-Eingabe ${JSON.stringify(input)} → ${out}`, () => assert.equal(parseKm(input), out))

test('km-Stand eintragen: gleicher Tag ersetzt, höchstens 24 Stände, ungültige Eingaben abgelehnt', () => {
  assert.equal(kmFits({ kmLog: [] }, '', 100), false)
  assert.equal(kmFits({ kmLog: [] }, '2026-11-03', 0), false)
  let v = { kmLog: Array.from({ length: 24 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${i < 12 ? '01' : '15'}`, km: 0 })) }
  v = { kmLog: v.kmLog.sort((a, b) => a.date.localeCompare(b.date)).map((x, i) => ({ ...x, km: 1000 + i * 100 })) }
  const more = addKm(v, '2026-01-10', 9000)
  assert.equal(more.kmLog.length, 24)
  assert.deepEqual(more.kmLog.at(-1), { date: '2026-01-10', km: 9000 })
  assert.equal(more.kmLog[0].date, '2025-01-15', 'ältester fällt weg')
  const same = addKm(more, '2026-01-10', 9100)
  assert.deepEqual([same.kmLog.length, same.kmLog.at(-1).km], [24, 9100])
})

test('Nächstes Service: aus Intervall nach Datum und km, eingetragene Werte gehen vor', () => {
  assert.deepEqual(serviceNext({ months: 12, km: 30000, lastDate: '2026-01-31', lastKm: 0 }), { date: '2027-01-31', km: 30000 })
  assert.deepEqual(serviceNext({ months: 12, km: 30000, lastDate: '2026-01-31', lastKm: '' }), { date: '2027-01-31', km: 0 }, 'ohne letzten km-Stand kein km-Ziel')
  assert.deepEqual(serviceNext({ nextDate: '2026-12-01', nextKm: '90000', months: 12, lastDate: '2026-01-01' }), { date: '2026-12-01', km: 90000 })
  assert.deepEqual(serviceNext(), { date: '', km: 0 })
})

test('Service-Stand nach Datum: 30 Tage vorher bald, am Tag fällig', () => {
  const v = { service: { nextDate: '2026-12-15' } }
  assert.equal(serviceStatus(v, '2026-11-14').status, 'ok')
  assert.equal(serviceStatus(v, '2026-11-15').status, 'bald')
  assert.equal(serviceStatus(v, '2026-12-15').status, 'faellig')
  assert.deepEqual([serviceStatus(v, '2026-11-15').by, serviceStatus(v, '2026-11-15').left], ['2026-12-15', null])
})

test('Service-Stand nach km: Hochrechnung ergibt den voraussichtlichen Tag', () => {
  // 600 km in 30 Tagen = 20 km/Tag; bis 7.000 fehlen 1.400 km → 70 Tage nach dem 31.1.
  const v = { service: { nextKm: 7000 }, kmLog: [{ date: '2026-01-01', km: 5000 }, { date: '2026-01-31', km: 5600 }] }
  const s = serviceStatus(v, '2026-02-01')
  assert.deepEqual([s.status, s.kmDate, s.left, s.perMonth, s.by], ['bald', '2026-04-11', 1400, 608, '2026-04-11'], 'unter 1.500 km: bald')
  assert.equal(serviceStatus(v, '2026-04-11').status, 'faellig', 'hochgerechnet erreicht')
})

const dueCases = [
  [{ date: '2026-12-03' }, '2026-11-02', 'ok'],
  [{ date: '2026-12-03' }, '2026-11-03', 'bald'],
  [{ date: '2026-12-03' }, '2026-12-03', 'faellig'],
  [{}, '2026-11-03', 'unbekannt'],
  [null, '2026-11-03', 'unbekannt'],
]
for (const [d, today, status] of dueCases) test(`Weitere Fälligkeit ${JSON.stringify(d)} am ${today}: ${status}`, () => assert.equal(dueStatus(d, today), status))

test('Fälligkeiten: abgelaufen vor Nachfrist vor fällig, nur geplante Termine decken Aufgaben ab', () => {
  const v = { id: 'v1', kind: 'pkw', pickerl: { next: '2026-06' }, service: { nextDate: '2026-11-01' }, dues: [{ id: 'd1', label: 'Leasingende', date: '2026-11-20' }, { id: 'd2', label: 'Verbandskasten', date: '2026-10-01' }] }
  const fz = { changes: [{ vehicleId: 'v1', status: 'erledigt', tasks: ['service'] }, { vehicleId: 'v1', status: 'geplant', tasks: ['due:d1'] }, { vehicleId: 'v2', status: 'geplant', tasks: ['pickerl'] }] }
  const dues = vehicleDues(fz, v, '2026-11-03')
  assert.deepEqual(dues.map((d) => [d.task, d.status, !!d.change]), [['pickerl', 'abgelaufen', false], ['due:d2', 'faellig', false], ['service', 'faellig', false], ['due:d1', 'bald', true]])
  assert.deepEqual(openTasks(fz, v, '2026-11-03').map((d) => d.task), ['pickerl', 'due:d2', 'service'])
  assert.deepEqual([taskLabel(v, 'pickerl'), taskLabel(v, 'due:d1'), taskLabel(v, 'due:weg'), taskLabel(v, 'frei')], ['§57a-Begutachtung (Pickerl)', 'Leasingende', 'Termin', 'frei'])
})

test('Werkstatt erledigt: einmalige Fälligkeit verschwindet, Pickerl ohne Monat wird vorgeschlagen', () => {
  const v = { id: 'v1', kind: 'transporter', firstReg: '2022-11', pickerl: { next: '2026-11' }, dues: [{ id: 'd1', label: 'Leasingende', date: '2026-11-20' }, { id: 'd2', label: 'Verbandskasten', date: '2026-11-15', months: 60 }] }
  const done = applyTasksDone(v, { tasks: ['due:d1', 'due:d2', 'pickerl', 'service'], date: '2026-11-05' }, { pickerl: { result: 'ok' }, done: ['due:d1'] })
  assert.deepEqual(done.dues.map((d) => [d.id, d.date]), [['d2', '2026-11-15']], 'd2 nicht als erledigt markiert: bleibt')
  assert.deepEqual(done.pickerl, { next: '2027-11', result: 'ok', lastDate: '2026-11-05' })
  assert.equal(done.service, undefined, 'Service ohne Ergebnis: unverändert')
  assert.deepEqual(v.dues.length, 2, 'Original unverändert')
})

test('Fahrzeugliste mit Fälligkeiten für Excel', () => {
  const v = { plate: 'S-9', label: 'Kleinwagen', kind: 'pkw', firstReg: '2023-04', pickerl: { next: '2026-09' }, service: { nextDate: '2027-02-01', nextKm: 45000 }, kmLog: [{ date: '2026-10-01', km: 30500 }], dues: [{ label: 'Leasingende', date: '2028-01-31' }] }
  const [head, row] = fleetCsv([{ vehicle: v, driver: 'Anna Berger', today: '2026-11-03', change: { date: '2026-11-20', time: '07:30' } }]).replace('﻿', '').trim().split('\r\n')
  assert.ok(head.startsWith('Kennzeichen;Fahrzeug;Klasse;Fahrer/in;Erstzulassung'))
  assert.equal(row, 'S-9;Kleinwagen;M1;Anna Berger;04/2023;30500;01.10.2026;09/2026;in der Nachfrist;01.02.2027;45000;in Ordnung;Leasingende 31.01.2028;20.11.2026 07:30')
})
