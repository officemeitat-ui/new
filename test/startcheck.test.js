// Daten-Startcheck (core/startcheck.js): Was fehlt an Stammdaten, bevor die Module arbeiten können?
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nameList, startCheck, startReport, startSummary } from '../src/core/startcheck.js'
import { createDemoData } from '../src/data/demo.js'

const TODAY = '2026-11-20'
const of = (list, group, label) => list.find((x) => x.group === group && x.label === label)
const run = (data) => startCheck(data, { today: TODAY })

test('Startcheck: leere App → Mitarbeitende und Objekte fehlen, alles andere nur Hinweise', () => {
  const list = run({})
  assert.equal(of(list, 'Mitarbeitende', 'Mitarbeitende angelegt').status, 'error')
  assert.equal(of(list, 'Objekte und Leistungen', 'Objekte angelegt').status, 'error')
  assert.deepEqual(list.filter((x) => x.status === 'error').length, 2)
  assert.ok(list.filter((x) => x.status !== 'error').every((x) => x.status === 'info'))
  assert.equal(of(list, 'Fakturierung', 'Fakturierung').detail, 'noch nicht in Verwendung')
  assert.equal(of(list, 'Mattenwechsel', 'Mattenwechsel').detail, 'noch keine Liegeplätze')
  assert.deepEqual(startSummary(list), { error: 2, warn: 0, info: 5, ok: 0, text: '2 Punkte fehlen noch.' })
  // jeder Punkt führt in eine Ansicht; nur Fehler und Lücken brauchen einen Weg
  assert.ok(list.every((x) => x.view))
  assert.ok(list.filter((x) => x.status === 'error').every((x) => x.fix.length > 20))
})

test('Startcheck: Beispieldaten → kein fehlender Punkt, Lücken mit Namen', () => {
  const list = run(createDemoData('2026-11-16'))
  assert.equal(list.filter((x) => x.status === 'error').length, 0)
  const phone = of(list, 'Mitarbeitende', 'Handynummer')
  assert.equal(phone.status, 'warn')
  assert.match(phone.detail, /^fehlt bei 35: Ana Popescu, Markus Huber, Elif Kaya, Dragan Jović und 31 weitere$/)
  assert.equal(of(list, 'Objekte und Leistungen', 'Leistungen angelegt').detail, '79 Leistungen')
  assert.match(of(list, 'Objekte und Leistungen', 'Stammkraft je Leistung').detail, /^\d+ von 79 ohne Stammkraft$/)
  assert.equal(of(list, 'Mattenwechsel', 'Betriebshof').status, 'ok')
  assert.equal(of(list, 'Mattenwechsel', 'Einsätze geplant').detail, 'noch nie')
  assert.match(startSummary(list).text, /^Die Daten reichen für den Start; \d+ Lücken noch schließen\.$/)
})

test('Startcheck Mitarbeitende: Wochenstunden, Handy, ausgeschiedene und inaktive zählen nicht', () => {
  const list = run({
    employees: [
      { id: 'a', name: 'Anna', weeklyHours: 20, phone: '+43 660 1', entryDate: '2020-01-01', vacationDaysYear: 25, personnelNo: '1' },
      { id: 'b', name: 'Bert', weeklyHours: 0 },
      { id: 'c', name: 'Cem', weeklyHours: 38.5, vacationBase: { date: '2026-11-01', days: 7 } },
      { id: 'd', name: 'Dora', exitDate: '2026-10-31' },
      { id: 'e', name: 'Emil', inactive: true },
      { id: 'f', name: 'Fritz', weeklyHours: 10, exitDate: '2026-12-31', phone: '1' },
    ],
  })
  assert.equal(of(list, 'Mitarbeitende', 'Mitarbeitende angelegt').detail, '4 Personen')
  assert.deepEqual([of(list, 'Mitarbeitende', 'Wochenstunden').status, of(list, 'Mitarbeitende', 'Wochenstunden').detail], ['warn', 'fehlt bei 1: Bert'])
  assert.equal(of(list, 'Mitarbeitende', 'Handynummer').detail, 'fehlt bei 2: Bert, Cem')
  assert.deepEqual([of(list, 'Mitarbeitende', 'Urlaubsanspruch').status, of(list, 'Mitarbeitende', 'Urlaubsanspruch').detail], ['info', 'fehlt bei 2: Bert, Fritz'])
  assert.equal(of(list, 'Mitarbeitende', 'Eintrittsdatum').status, 'info')
})

test('Startcheck Objekte: Adresse, Objekt ohne Leistung, beendete Leistung, inaktives Objekt', () => {
  const list = run({
    employees: [{ id: 'a', name: 'Anna', weeklyHours: 20 }],
    objects: [
      { id: 'o1', name: 'Kanzlei', address: 'Musterweg 1, 5020 Salzburg' },
      { id: 'o2', name: 'Praxis', address: '' },
      { id: 'o3', name: 'Lager', address: 'Musterweg 3' },
      { id: 'o4', name: 'Alt', inactive: true },
    ],
    tasks: [
      { id: 't1', objectId: 'o1', regulars: ['a'], recurrence: {} },
      { id: 't2', objectId: 'o2', regulars: [], recurrence: {} },
      { id: 't3', objectId: 'o3', regulars: ['a'], recurrence: { until: '2026-10-31' } },
      { id: 't4', objectId: 'o4', regulars: [], recurrence: {} },
    ],
  })
  assert.equal(of(list, 'Objekte und Leistungen', 'Objekte angelegt').detail, '3 Objekte')
  assert.deepEqual([of(list, 'Objekte und Leistungen', 'Adresse je Objekt').status, of(list, 'Objekte und Leistungen', 'Adresse je Objekt').detail], ['warn', 'fehlt bei 1: Praxis'])
  assert.equal(of(list, 'Objekte und Leistungen', 'Leistungen angelegt').detail, '2 Leistungen')
  assert.equal(of(list, 'Objekte und Leistungen', 'Leistung je Objekt').detail, '1 ohne Leistung: Lager')
  assert.deepEqual([of(list, 'Objekte und Leistungen', 'Stammkraft je Leistung').status, of(list, 'Objekte und Leistungen', 'Stammkraft je Leistung').detail], ['info', '1 von 2 ohne Stammkraft'])
  // Objekte ohne jede Leistung: das ist ein fehlender Punkt
  const none = run({ objects: [{ id: 'o1', name: 'Kanzlei', address: 'x' }], tasks: [] })
  assert.equal(of(none, 'Objekte und Leistungen', 'Leistungen angelegt').status, 'error')
})

test('Startcheck Fakturierung: in Verwendung ohne Absender → fehlt; IBAN und Anschrift als Lücke', () => {
  const list = run({ fakturierung: { settings: { sender: { name: 'Firma' } }, customers: [{ id: 'c1', name: 'Kunde A', street: 'Weg 1', city: 'Salzburg' }, { id: 'c2', name: 'Kunde B', email: 'b@example.org' }] } })
  assert.deepEqual([of(list, 'Fakturierung', 'Absender auf Rechnungen').status, of(list, 'Fakturierung', 'Absender auf Rechnungen').detail], ['error', 'fehlt: Anschrift, UID-Nummer'])
  assert.equal(of(list, 'Fakturierung', 'Bankverbindung').status, 'warn')
  assert.equal(of(list, 'Fakturierung', 'Anschrift je Kunde').detail, 'fehlt bei 1: Kunde B')
  assert.deepEqual([of(list, 'Fakturierung', 'E-Mail je Kunde').status, of(list, 'Fakturierung', 'E-Mail je Kunde').detail], ['info', 'fehlt bei 1: Kunde A'])
})

test('Startcheck Fakturierung: Absender unvollständig, aber noch keine Kunden und Belege → Lücke statt rot', () => {
  const list = run({ fakturierung: { settings: { sender: { name: 'Firma' } }, customers: [], documents: [] } })
  assert.deepEqual([of(list, 'Fakturierung', 'Absender auf Rechnungen').status, of(list, 'Fakturierung', 'Kunden angelegt').status], ['warn', 'warn'])
  assert.equal(list.filter((x) => x.group === 'Fakturierung' && x.status === 'error').length, 0)
})

test('Startcheck Mattenwechsel: Koordinaten, Rhythmus, Mattentyp, Preis, Betriebshof, Fahrer, Planung', () => {
  const data = {
    fakturierung: { articles: [{ id: 'a1', name: '85 × 150 cm, grau', price: 4.9 }, { id: 'a2', name: '115 × 180 cm, Navy', price: 0 }] },
    matten: {
      settings: { drivers: [{ id: 'd1', name: 'Fahrer Eins' }, { id: 'd2', name: 'Fahrer Zwei', webspace: true }, { id: 'd3', name: 'Alt', active: false }], planning: { bis: '2026-11-25' } },
      placements: [
        { id: 'p1', lat: 47.8, lon: 13.04, intervalDays: 28, startDate: '2026-11-20', mats: [{ articleId: 'a1', qty: 1 }] },
        { id: 'p2', intervalDays: 28, startDate: '2026-11-20', mats: [{ articleId: 'a2', qty: 2 }, { name: 'Sonderfarben', qty: 1 }] },
        { id: 'p3', lat: 47.8, lon: 13.04, mats: [{ articleId: 'weg', qty: 1 }] },
        { id: 'p4', active: false },
      ],
    },
  }
  const list = run(data)
  const m = (label) => [of(list, 'Mattenwechsel', label).status, of(list, 'Mattenwechsel', label).detail]
  assert.deepEqual(m('Liegeplätze angelegt'), ['ok', '3 Liegeplätze'])
  assert.deepEqual(m('Koordinaten je Liegeplatz'), ['warn', 'fehlen bei 1'])
  assert.deepEqual(m('Intervall und Starttermin'), ['warn', 'fehlen bei 1'])
  assert.deepEqual(m('Mattentyp je Matte'), ['warn', 'fehlt bei 2 Zeilen'])
  assert.deepEqual(m('Preis je Mattentyp'), ['warn', '1 Mattentyp ohne Preis: 115 × 180 cm, Navy'])
  assert.deepEqual(m('Betriebshof'), ['warn', 'fehlt'])
  assert.deepEqual(m('Fahrer'), ['warn', '2 Fahrer; ohne E-Mail: Fahrer Eins'])
  assert.deepEqual(m('Einsätze geplant'), ['warn', 'bis 25.11.2026'])
  // eingerichtet: alles passt
  data.matten.settings = { depot: { name: 'Hof', lat: 47.8, lon: 13 }, drivers: [{ id: 'd1', name: 'Fahrer Eins', email: 'f@example.org' }], planning: { bis: '2026-12-04' }, officeEmail: 'buero@example.org' }
  const ok = run(data)
  assert.deepEqual(['Betriebshof', 'Fahrer', 'Einsätze geplant', 'Büro-Adresse für Lieferscheine'].map((l) => of(ok, 'Mattenwechsel', l).status), ['ok', 'ok', 'ok', 'ok'])
  assert.equal(of(ok, 'Mattenwechsel', 'Betriebshof').detail, 'Hof')
})

test('Startcheck: Namenliste, Zusammenfassung und Bericht', () => {
  assert.equal(nameList(['A', 'B']), 'A, B')
  assert.equal(nameList(['A', 'B', 'C', 'D', 'E']), 'A, B, C, D und 1 weitere')
  assert.equal(nameList(['A', '', null, 'B'], 1), 'A und 1 weitere')
  assert.equal(startSummary([{ status: 'ok' }, { status: 'info' }]).text, 'Die Daten sind startklar.')
  assert.equal(startSummary([{ status: 'warn' }]).text, 'Die Daten reichen für den Start; 1 Lücke noch schließen.')
  assert.equal(startSummary([{ status: 'error' }, { status: 'warn' }, { status: 'warn' }]).text, '1 Punkt fehlt noch, dazu 2 Lücken.')
  const report = startReport(run({}))
  assert.match(report, /^\[fehlt\] Mitarbeitende · Mitarbeitende angelegt: noch niemand$/m)
  assert.ok(!/[A-ZÄÖÜ]{4,}/.test(report), 'kein Wort in Großbuchstaben')
})
