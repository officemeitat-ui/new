import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addKm, addMonths, applyTasksDone, classOf, currentKm, kmPerDay, monthAdd, openTasks, parseMonth, pickerlSchedule, pickerlStatus, pickerlWindow, serviceStatus, suggestPickerl, vehicleDues } from '../src/core/vehicle-dues.js'
import { changeWhat, driverMail, importVehicles, workshopMail } from '../src/core/vehicles.js'

test('Pickerl: Fristen nach Klasse, 3-2-1 bis zur Novelle, danach 4-2-2-2-1, Lkw jährlich', () => {
  assert.equal(monthAdd('2026-11', 3), '2027-02')
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28')
  assert.equal(parseMonth('03/2027'), '2027-03')
  assert.equal(parseMonth('15.3.2027'), '2027-03')
  assert.equal(classOf({ kind: 'transporter' }), 'N1')
  assert.equal(classOf({ kind: 'transporter', cls: 'M1' }), 'M1', 'Zulassungsschein geht vor')
  // Pkw, Erstzulassung März 2021: 2024, 2026 nach 3-2-1; ab Mai 2027 nach 4-2-2-2-1 → 2027 (6 J.), 2029, 2031, 2032 …
  assert.deepEqual(pickerlSchedule('M1', '2021-03').slice(0, 6), ['2024-03', '2026-03', '2027-03', '2029-03', '2031-03', '2032-03'])
  assert.deepEqual(pickerlSchedule('N1', '2022-11').slice(0, 3), ['2023-11', '2024-11', '2025-11'])
  // Fenster
  assert.deepEqual(pickerlWindow('M1', '2026-03'), { from: '2026-02-01', to: '2026-07-31', grace: true })
  assert.deepEqual(pickerlWindow('M1', '2027-06'), { from: '2027-05-01', to: '2027-10-31', grace: true }, 'Übergang Feb.–Juli 2027: −1/+4')
  assert.deepEqual(pickerlWindow('M1', '2027-09'), { from: '2027-05-01', to: '2027-09-30', grace: false }, 'neu: 4 Monate vorher, keine Nachfrist')
  assert.deepEqual(pickerlWindow('N1', '2026-11'), { from: '2026-08-01', to: '2026-11-30', grace: false })
})

test('Pickerl: Stand und Vorschlag für die nächste Plakette', () => {
  const caddy = { kind: 'transporter', firstReg: '2022-11', pickerl: { next: '2026-11' } }
  assert.equal(pickerlStatus(caddy, '2026-07-15').status, 'bald', '30 Tage vor dem Fenster')
  assert.equal(pickerlStatus(caddy, '2026-06-15').status, 'ok')
  assert.equal(pickerlStatus(caddy, '2026-10-25').status, 'faellig')
  assert.equal(pickerlStatus(caddy, '2026-12-01').status, 'abgelaufen', 'Lkw: keine Nachfrist')
  const car = { kind: 'pkw', pickerl: { next: '2026-09' } }
  assert.equal(pickerlStatus(car, '2026-10-25').status, 'nachfrist')
  assert.equal(pickerlStatus(car, '2026-10-25').to, '2027-01-31')
  assert.equal(pickerlStatus({ kind: 'pkw' }, '2026-10-25').status, 'unbekannt')
  // ohne Plakette aus Erstzulassung: Pkw EZ 05/2016 → jährlich, nächster offener Termin
  const old = pickerlStatus({ kind: 'pkw', firstReg: '2016-05' }, '2026-10-25')
  assert.deepEqual([old.due, old.status, old.guessed], ['2027-05', 'ok', true])
  // Vorschlag nach der Begutachtung
  assert.equal(suggestPickerl(caddy, '2026-10-28'), '2027-11', 'N1 jährlich ab Erstzulassung')
  assert.equal(suggestPickerl({ kind: 'pkw', firstReg: '2023-04' }, '2026-04-10'), '2028-04', 'nach altem Recht begutachtet: im Zweifel der frühere Termin (2028 statt 2029)')
  assert.equal(suggestPickerl({ kind: 'pkw', firstReg: '2025-01' }, '2029-01-12'), '2031-01', 'neues Recht: 4-2-2-2-1')
  assert.equal(pickerlStatus({ kind: 'pkw', firstReg: '2025-01' }, '2026-10-25').due, '2029-01', 'Neuwagen 2025: erstes Pickerl nach 4 Jahren')
  assert.equal(suggestPickerl({ kind: 'lkw', pickerl: { next: '2026-09' } }, '2026-10-30'), '2027-09', 'ohne Erstzulassung: ein Jahr nach der Plakette')
})

test('Service: nach Datum oder km, mit Hochrechnung', () => {
  let v = { service: { months: 12, km: 30000, lastDate: '2025-11-10', lastKm: 32000 } }
  v = addKm(v, '2025-11-10', 32000)
  v = addKm(v, '2026-10-20', 58100)
  assert.deepEqual(currentKm(v), { km: 58100, date: '2026-10-20' })
  assert.ok(Math.abs(kmPerDay(v) - 26100 / 344) < 0.01)
  const s = serviceStatus(v, '2026-10-25')
  assert.deepEqual([s.status, s.date, s.km, s.left], ['bald', '2026-11-10', 62000, 3900])
  assert.equal(s.perMonth, Math.round((26100 / 344) * 30.4))
  assert.equal(s.by, '2026-11-10', 'Datum kommt vor dem km-Stand')
  assert.equal(serviceStatus(v, '2026-11-10').status, 'faellig')
  const byKm = serviceStatus({ service: { nextKm: 90000 }, kmLog: [{ date: '2026-10-01', km: 88900 }] }, '2026-10-25')
  assert.deepEqual([byKm.status, byKm.left], ['bald', 1100], 'unter 1.500 km')
  assert.equal(serviceStatus({ service: { nextKm: 90000 }, kmLog: [{ date: '2026-01-01', km: 70000 }, { date: '2026-07-01', km: 89000 }] }, '2026-10-25').status, 'faellig', 'hochgerechnet schon überschritten')
  assert.equal(serviceStatus({}, '2026-10-25').status, 'unbekannt')
})

test('Fälligkeiten zusammen, Werkstatttermin erledigt sie', () => {
  const v = { id: 'v1', plate: 'S-284 KL', label: 'VW Caddy', kind: 'transporter', firstReg: '2022-11', pickerl: { next: '2026-11' }, service: { months: 12, km: 30000, lastDate: '2025-11-10', lastKm: 32000 }, kmLog: [{ date: '2025-11-10', km: 32000 }, { date: '2026-10-20', km: 58100 }], dues: [{ id: 'd1', label: 'Verbandskasten', date: '2026-11-15', months: 60 }, { id: 'd2', label: 'Leasingende', date: '2028-01-31' }] }
  const fz = { vehicles: [v], changes: [] }
  const dues = vehicleDues(fz, v, '2026-10-25')
  assert.deepEqual(dues.map((d) => [d.task, d.status]), [['pickerl', 'faellig'], ['service', 'bald'], ['due:d1', 'bald'], ['due:d2', 'ok']])
  assert.deepEqual(openTasks(fz, v, '2026-10-25').map((d) => d.task), ['pickerl', 'service', 'due:d1'])
  const change = { id: 'c9', vehicleId: 'v1', kind: 'werkstatt', tasks: ['service', 'pickerl', 'due:d1'], date: '2026-11-05', time: '07:30', minutes: 120, status: 'geplant' }
  fz.changes.push(change)
  assert.equal(openTasks(fz, v, '2026-10-25').length, 0, 'alle im Termin')
  assert.equal(changeWhat(change, v), 'Service, §57a-Begutachtung (Pickerl) und Verbandskasten')
  const done = applyTasksDone(v, { ...change, status: 'erledigt', doneAt: '2026-11-05', km: 59000 }, { service: { nextDate: '2027-11-05', nextKm: 89000 }, pickerl: { result: 'leicht', next: '2027-11' }, done: ['due:d1'] })
  assert.deepEqual(done.service, { months: 12, km: 30000, lastDate: '2026-11-05', lastKm: 59000, nextDate: '2027-11-05', nextKm: 89000 })
  assert.deepEqual(done.pickerl, { next: '2027-11', result: 'leicht', lastDate: '2026-11-05' })
  assert.equal(done.dues.find((d) => d.id === 'd1').date, '2031-11-15', 'wiederkehrend: 60 Monate weiter')
  assert.equal(currentKm(done).km, 59000)
  const failed = applyTasksDone(v, { ...change, doneAt: '2026-11-05' }, { pickerl: { result: 'schwer' } })
  assert.deepEqual(failed.pickerl, { next: '2026-11', result: 'schwer' }, 'schwere Mängel: keine neue Plakette')
})

test('Werkstatttermin in den E-Mails, Übernahme aus Excel', () => {
  const v = { plate: 'S-284 KL', label: 'VW Caddy', tires: { winter: { size: '205/55 R16', storage: 'Regal 14' } }, dues: [] }
  const combined = { kind: 'reifen', season: 'winter', tasks: ['pickerl'], date: '2026-10-29', time: '07:00', minutes: 60 }
  const mail = driverMail({ change: combined, vehicle: v, driverName: 'Markus Huber' })
  assert.equal(mail.subject, 'Werkstatttermin S-284 KL: Do 29.10.2026 um 07:00 Uhr')
  assert.match(mail.text, /ist ein Werkstatttermin geplant: Wechsel auf Winterreifen und §57a-Begutachtung \(Pickerl\)\./)
  assert.match(mail.text, /Die Winterreifen liegen: Regal 14/)
  assert.match(mail.text, /Zulassungsschein im Auto lassen/)
  const service = { kind: 'werkstatt', tasks: ['service'], date: '2026-11-05', time: '07:30', minutes: 120 }
  const ws = workshopMail({ rows: [{ change: combined, vehicle: v }, { change: service, vehicle: { ...v, plate: 'S-511 TR', label: 'Renault Trafic' } }], workshop: { name: 'Reifen Muster GmbH' } })
  assert.equal(ws.subject, 'Werkstatttermine: 2 Fahrzeuge')
  assert.deepEqual(ws.text.split('\n').filter((l) => l.startsWith('•')), ['• Do 29.10.2026 07:00 Uhr · S-284 KL VW Caddy · auf Winterreifen 205/55 R16 · eingelagert: Regal 14 · dazu: §57a-Begutachtung (Pickerl)', '• Do 05.11.2026 07:30 Uhr · S-511 TR Renault Trafic · Service'])
  const text = 'Kennzeichen\tFahrzeug\tKlasse\tErstzulassung\tkm-Stand\tPickerl\tNächstes Service\tService bei km\nS-284 KL\tVW Caddy\tN1\t11/2022\t58.100\t11/2026\t10.11.2026\t62.000\nS-133 MB\tŠkoda Fabia\tM1\t2023-04\t\t04/2028\t03/2027\t'
  const { vehicles } = importVehicles(text, { today: '2026-10-25' })
  assert.deepEqual(vehicles[0].cls, 'N1')
  assert.deepEqual([vehicles[0].firstReg, vehicles[0].pickerl.next, vehicles[0].kmLog], ['2022-11', '2026-11', [{ date: '2026-10-25', km: 58100 }]])
  assert.deepEqual([vehicles[0].service.nextDate, vehicles[0].service.nextKm], ['2026-11-10', 62000])
  assert.deepEqual([vehicles[1].service.nextDate, vehicles[1].kmLog], ['2027-03-01', undefined])
})
