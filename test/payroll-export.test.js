import { test } from 'node:test'
import assert from 'node:assert/strict'

import { exportLines, exportProblems, exportText, keyTotals } from '../src/core/payroll-export.js'
import { applyDoc, DOC, splitData } from '../src/storage/data-service.js'

const emp = (id, pnr, name) => ({ id, personnelNo: pnr, name })
// Minuten wie in payMonth
const ot = (e, over = {}) => ({ employee: e, wage: 13.54, ueMode: 'auszahlen', total: { normal: 160 * 60 }, mehr: { paid: 90 }, hours: { ue: { tag: 120, nacht: 30 }, ue11: {}, normal: { nacht: 600, sonntag: 240, feiertag: 0 }, mehr: { nacht: 60 } }, ...over })
const rep = (e, over = {}) => ({ employee: e, vacationDays: 2, vacationCredit: 16 * 60, sickDays: 0, sickCredit: 0, holidayCredit: 8 * 60, travel: 300, ...over })

const anna = emp('e1', '1001', 'Anna Berger')
const bernd = emp('e2', '', 'Bernd Huber')
const carl = emp('e3', '1003', 'Carl Ott')
const settings = { wageTypes: { normal: '100', mehr: '210', 'ue.tag': '300', 'ue.nacht': '301', nacht: '410', urlaubTage: '600', feiertag: '620' } }

test('Lohn-Export: Zeilen je Person und Lohnart, nur mit Lohnart und Menge, Überstunden nur bei Auszahlung', () => {
  const otRows = [ot(anna), ot(bernd, { total: { normal: 40 * 60 }, mehr: { paid: 0 }, hours: { ue: {}, ue11: {}, normal: {}, mehr: {} } }), ot(carl, { ueMode: 'za' })]
  const report = [rep(anna), rep(bernd, { vacationDays: 0 }), rep(carl)]
  const lines = exportLines({ month: '2026-11', otRows, report, settings })
  const of = (id) => lines.filter((l) => l.empId === id).map((l) => [l.lohnart, l.menge, l.einheit])
  assert.deepEqual(of('e1'), [['100', 160, 'h'], ['210', 1.5, 'h'], ['300', 2, 'h'], ['301', 0.5, 'h'], ['410', 11, 'h'], ['620', 8, 'h'], ['600', 2, 'Tage']])
  assert.deepEqual(of('e2'), [['100', 40, 'h'], ['620', 8, 'h']])
  assert.ok(!of('e3').some(([la]) => la === '300' || la === '301'), 'Zeitausgleich: Überstunden nicht als bezahlte Stunden')
  assert.equal(lines[0].satz, 13.54)
  assert.equal(lines.find((l) => l.einheit === 'Tage').satz, 0, 'Tage ohne Satz')
  assert.equal(lines[0].von, '2026-11-01')
  assert.equal(lines[0].bis, '2026-11-30')
})

test('Lohn-Export: Datei mit Kopfzeile, Strichpunkt, Dezimalkomma, Datum; andere Formate', () => {
  const lines = exportLines({ month: '2026-11', otRows: [ot(anna)], report: [rep(anna)], settings })
  const text = exportText(lines, settings)
  const rows = text.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(rows[0], 'Personalnummer;Lohnart;Menge;Satz;Von;Bis;Text')
  assert.equal(rows[1], '1001;100;160;13,54;01.11.2026;30.11.2026;Normalstunden')
  assert.equal(rows[2], '1001;210;1,50;13,54;01.11.2026;30.11.2026;Mehrarbeit ausbezahlt (Zuschlag 25 %)')
  assert.ok(text.startsWith('﻿') && text.endsWith('\r\n'))
  const other = exportText(lines, { ...settings, columns: ['pnr', 'name', 'lohnart', 'menge', 'betrag', 'monat'], header: false, sep: 'tab', decimal: '.', dateFormat: 'yyyy-mm-dd' })
  assert.equal(other.replace(/^﻿/, '').split('\r\n')[1], '1001\tAnna Berger\t210\t1.50\t20.31\t11.2026')
  const quoted = exportText([{ ...lines[0], text: 'Stunden; „Tag“' }], { ...settings, columns: ['pnr', 'text'], header: false })
  assert.equal(quoted.replace(/^\uFEFF/, '').trim(), '1001;"Stunden; „Tag“"', 'Trennzeichen im Text: in Anführungszeichen')
})

test('Lohn-Export: Summen je Kennzahl und Hinweise', () => {
  const otRows = [ot(anna), ot(bernd)]
  const report = [rep(anna), rep(bernd)]
  const totals = keyTotals({ otRows, report })
  assert.equal(totals.normal, 320)
  assert.equal(totals.fahrzeit, 10)
  const lines = exportLines({ month: '2026-11', otRows, report, settings })
  const problems = exportProblems({ lines, totals, settings })
  assert.match(problems[0], /Ohne Personalnummer.*Bernd Huber/)
  assert.match(problems[1], /Ohne Lohnart.*Urlaub angerechnet \(32 h\).*Fahrzeit \(10 h\)/)
  assert.match(exportProblems({ lines, totals, settings: { ...settings, columns: ['pnr', 'menge'] } }).at(-1), /Personalnummer, Lohnart und Menge/)
})

test('Lohn-Export: Einstellungen liegen im Zeitkonto (lohn/), auch nach dem Laden', () => {
  const data = { employees: [], objects: [], tasks: [], absences: [], rules: {}, published: {}, payrollExport: { wageTypes: { normal: '100' }, sep: ';' } }
  const docs = splitData(data, new Set())
  assert.deepEqual(docs[DOC.account].export, { wageTypes: { normal: '100' }, sep: ';' })
  const back = {}
  applyDoc(back, DOC.account, docs[DOC.account])
  assert.deepEqual(back.payrollExport, data.payrollExport)
  applyDoc(back, DOC.account, { weeks: {} })
  assert.equal(back.payrollExport, undefined)
})
