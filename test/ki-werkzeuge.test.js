// Werkzeuge des KI-Assistenten für die Module (src/ai/tools-module.js): Rechte über die Bereiche (Lesen: sichtbar,
// Ändern: Schreibrecht, dazu when), Rückgaben aus den Daten, Ändern nur über die Aktionen der Module.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { availableTools, validateInput } from '../src/ai/registry.js'
import '../src/ai/tools.js'
import '../src/ai/tools-module.js'
import { addDays, todayISO } from '../src/core/dates.js'
import { app, registerActions } from '../src/ui/context.js'

const MODULE_TOOLS = ['anlage_termin', 'anlagen_pruefungen', 'eingangsrechnungen_offen', 'nachkontrolle_termin', 'offene_posten', 'qualitaet_abfragen', 'rechnung_aus_regiebericht', 'regieberichte_abfragen', 'umsatz_abfragen', 'zahlungserinnerung_vorbereiten']
const WRITE = ['anlage_termin', 'nachkontrolle_termin', 'rechnung_aus_regiebericht', 'zahlungserinnerung_vorbereiten']

function withApp(patch, fn) {
  const before = { access: app.access, readOnly: app.readOnly, auth: app.auth, data: app.data }
  Object.assign(app, patch)
  try {
    return fn()
  } finally {
    Object.assign(app, before)
  }
}
async function withAppAsync(patch, fn) {
  const before = { access: app.access, readOnly: app.readOnly, auth: app.auth, data: app.data }
  Object.assign(app, patch)
  try {
    return await fn()
  } finally {
    Object.assign(app, before)
  }
}
const role = (seen, edited = []) => ({ all: false, sees: (m) => seen.includes(m) || edited.includes(m), canEdit: (m) => edited.includes(m) })
const names = () => availableTools().map((t) => t.name).filter((n) => MODULE_TOOLS.includes(n))
const tool = (name) => withApp({ access: null, readOnly: false }, () => availableTools().find((t) => t.name === name))

test('Module: Werkzeuge gültig beschrieben, Ändern nur mit Bestätigung', () => {
  withApp({ access: null, readOnly: false }, () => {
    assert.deepEqual(names(), MODULE_TOOLS)
    for (const t of availableTools().filter((x) => MODULE_TOOLS.includes(x.name))) {
      assert.match(t.name, /^[a-z][a-z_]{2,63}$/)
      assert.ok(t.description.length >= 60, t.name)
      assert.ok(t.label, `${t.name}: Bezeichnung für den Chat`)
      assert.equal(!!t.write, WRITE.includes(t.name), t.name)
      if (t.write) assert.equal(typeof t.summary, 'function', t.name)
      for (const key of t.input_schema.required || []) assert.ok(t.input_schema.properties[key], `${t.name}.${key}`)
      assert.ok(!/claude|opus|sonnet|haiku/i.test(t.description), 'keine Modellnamen')
    }
  })
})

test('Module: Rechte – Fakturierung nur mit Recht „fakturierung“, Rechnungsentwurf nur mit Regieberichten', () => {
  // Objektservice (Regieberichte erfassen, keine Fakturierung)
  withApp({ access: role([], ['regie']), readOnly: false }, () => assert.deepEqual(names(), ['regieberichte_abfragen']))
  // Buchhaltung ohne Regieberichte: offene Posten, Umsatz, Erinnerung – kein Entwurf aus Regieberichten
  withApp({ access: role(['einkauf'], ['fakturierung']), readOnly: false }, () => assert.deepEqual(names(), ['eingangsrechnungen_offen', 'offene_posten', 'umsatz_abfragen', 'zahlungserinnerung_vorbereiten']))
  // Fakturierung nur lesen: nachschlagen ja, ändern nein
  withApp({ access: role(['fakturierung', 'regie']), readOnly: false }, () => assert.deepEqual(names(), ['offene_posten', 'regieberichte_abfragen', 'umsatz_abfragen']))
  // Büro mit Regieberichten und Fakturierung
  withApp({ access: role(['regie'], ['fakturierung']), readOnly: false }, () => assert.ok(names().includes('rechnung_aus_regiebericht')))
  // Anlagen und Qualität: Termine nur mit Schreibrecht auf Termine
  withApp({ access: role(['anlagen', 'qualitaet']), readOnly: false }, () => assert.deepEqual(names(), ['anlagen_pruefungen', 'qualitaet_abfragen']))
  withApp({ access: role(['anlagen'], ['termine']), readOnly: false }, () => assert.deepEqual(names(), ['anlage_termin', 'anlagen_pruefungen']))
  withApp({ access: role(['qualitaet'], ['termine']), readOnly: false }, () => assert.deepEqual(names(), ['nachkontrolle_termin', 'qualitaet_abfragen']))
  // Lager sieht nichts davon; Nur-Lesen ohne ändernde Werkzeuge
  withApp({ access: role(['material']), readOnly: false }, () => assert.deepEqual(names(), []))
  withApp({ access: null, readOnly: true }, () => assert.ok(WRITE.every((n) => !names().includes(n))))
})

// ---------------------------------------------------------------- Daten

const today = todayISO()
const doc = (id, number, customerId, name, date, dueDate, gross, extra = {}) => ({ id, kind: 'rechnung', number, customerId, recipient: { name }, date, dueDate, total: { net: Math.round((gross / 1.2) * 100) / 100, vat: Math.round((gross - gross / 1.2) * 100) / 100, gross }, payments: [], reminders: [], ...extra })
const DATA = () => ({
  objects: [
    { id: 'o1', name: 'Kanzlei Berger', address: 'Getreidegasse 1, 5020 Salzburg' },
    { id: 'o2', name: 'Wohnanlage Lehen', address: 'Lehener Straße 5, 5020 Salzburg' },
  ],
  employees: [],
  fakturierung: {
    settings: {},
    customers: [
      { id: 'c1', name: 'Kanzlei Berger', customerNo: '10001', objectIds: ['o1'] },
      { id: 'c2', name: 'Hausverwaltung Lehen GmbH', customerNo: '10002', objectIds: ['o2'] },
    ],
    documents: [
      doc('d1', 'RE-2026-0001', 'c1', 'Kanzlei Berger', addDays(today, -40), addDays(today, -26), 600),
      doc('d2', 'RE-2026-0002', 'c2', 'Hausverwaltung Lehen GmbH', addDays(today, -5), addDays(today, 9), 1200),
      doc('d3', 'RE-2026-0003', 'c1', 'Kanzlei Berger', addDays(today, -60), addDays(today, -46), 240, { payments: [{ id: 'p1', date: addDays(today, -40), amount: 240 }] }),
      { id: 'd4', kind: 'rechnung', customerId: 'c1', recipient: { name: 'Kanzlei Berger' }, date: today, total: { net: 50, vat: 10, gross: 60 } },
    ],
    articles: [],
  },
  einkauf: {
    suppliers: [{ id: 's1', name: 'Reinigungsbedarf Muster GmbH', supplierNo: '70001', iban: 'AT611904300234573201' }],
    invoices: [
      { id: 'i1', no: 'ER-2026-0001', supplierId: 's1', supplier: { name: 'Reinigungsbedarf Muster GmbH' }, number: 'R-118', date: addDays(today, -20), dueDate: addDays(today, -6), groups: [{ rate: 20, net: 250, vat: 50 }], payments: [] },
      { id: 'i2', no: 'ER-2026-0002', supplierId: 's1', supplier: { name: 'Reinigungsbedarf Muster GmbH' }, number: 'R-120', date: addDays(today, -2), dueDate: addDays(today, 30), groups: [{ rate: 20, net: 100, vat: 20 }], payments: [] },
      { id: 'i3', no: 'ER-2026-0003', supplierId: 's1', number: 'R-90', date: addDays(today, -50), dueDate: addDays(today, -36), groups: [{ rate: 20, net: 100, vat: 20 }], payments: [{ id: 'x', date: addDays(today, -30), amount: 120 }] },
    ],
  },
  anlagen: {
    types: [],
    items: [
      { id: 'a1', objectId: 'o2', typeId: 'feuerloescher', label: 'Stiege 1 EG', by: 'fremd', company: 'Brandschutz Muster', firstDue: addDays(today, -3) },
      { id: 'a2', objectId: 'o2', typeId: 'rauchmelder', label: 'Keller', firstDue: addDays(today, 200) },
    ],
    checks: [],
  },
  qualitaet: {
    settings: {},
    objects: [],
    measurements: [
      { id: 'm1', objectId: 'o1', date: addDays(today, -20), status: 'fertig', result: { score: 94, target: 90, ok: true, poor: false, rooms: 8, bad: 0 } },
      { id: 'm2', objectId: 'o1', date: addDays(today, -2), status: 'fertig', result: { score: 81.5, target: 90, ok: false, poor: true, rooms: 8, bad: 2 } },
    ],
  },
  regie: {
    reports: [
      { id: 'r1', no: 'RB-2026-0001', objectId: 'o2', date: addDays(today, -3), kind: 'wasserschaden', title: 'Keller nach Wasserschaden', status: 'abgeschlossen', signature: { name: 'Frau Berger' }, workers: [{ minutes: 210 }], material: [] },
      { id: 'r2', no: 'RB-2026-0002', objectId: 'o1', date: today, kind: 'zusatz', title: 'Fenster Stiegenhaus', status: 'offen', workers: [{ minutes: 60 }], material: [] },
    ],
  },
})

const run = (name, input) => withApp({ access: null, readOnly: false, data: DATA() }, () => {
  const t = tool(name)
  assert.equal(validateInput(t.input_schema, input), '', `${name}: Eingabe`)
  return t.run(input)
})

test('Fakturierung: offene Posten je Kunde und überfällig, Umsatz eines Zeitraums', () => {
  let r = run('offene_posten', {})
  assert.equal(r.anzahl, 2, 'bezahlt und Entwurf zählen nicht')
  assert.equal(r.summe_offen, 1800)
  assert.equal(r.ueberfaellig, 1)
  r = run('offene_posten', { kunde: 'Berger' })
  assert.deepEqual(r.rechnungen.map((x) => [x.rechnung, x.offen, x.ueberfaellig_tage]), [['RE-2026-0001', 600, 26]])
  assert.equal(run('offene_posten', { nur_ueberfaellig: true }).anzahl, 1)
  assert.throws(() => run('offene_posten', { kunde: 'Unbekannt' }), /nicht gefunden/)
  r = run('umsatz_abfragen', { von: addDays(today, -45), bis: today })
  assert.equal(r.rechnungen, 2)
  assert.equal(r.brutto, 1800)
  assert.deepEqual(r.groesste_kunden.map((x) => x.name), ['Hausverwaltung Lehen GmbH', 'Kanzlei Berger'])
  assert.throws(() => run('umsatz_abfragen', { von: '2025-01-01', bis: '2026-12-31' }), /Höchstens ein Jahr/)
})

test('Einkauf, Anlagen, Qualität, Regieberichte: nachschlagen', () => {
  let r = run('eingangsrechnungen_offen', {})
  assert.deepEqual(r.rechnungen.map((x) => [x.eingangsnummer, x.offen, x.zustand]), [['ER-2026-0001', 300, 'überfällig'], ['ER-2026-0002', 120, 'offen']])
  assert.ok(!JSON.stringify(r).includes('AT61'), 'keine Bankdaten')
  assert.equal(run('eingangsrechnungen_offen', { faellig_in_tagen: 3 }).anzahl, 1)
  r = run('anlagen_pruefungen', { objekt: 'Lehen' })
  assert.deepEqual(r.anlagen.map((x) => [x.art, x.bezeichnung, x.zustand, x.prueft]), [['Feuerlöscher', 'Stiege 1 EG', 'überfällig', 'Brandschutz Muster']])
  r = run('qualitaet_abfragen', { objekt: 'Kanzlei Berger' })
  assert.equal(r.objekte[0].kennzahl, 81.5)
  assert.equal(r.objekte[0].erfuellt, false)
  assert.match(r.objekte[0].nachkontrolle, /^bis \d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(r.objekte[0].messungen.map((m) => m.kennzahl), [81.5, 94])
  r = run('regieberichte_abfragen', {})
  assert.deepEqual(r.berichte.map((x) => [x.nummer, x.stunden, x.verrechnung]), [['RB-2026-0001', 3.5, 'noch nicht verrechnet']])
  assert.deepEqual(run('regieberichte_abfragen', { stand: 'offen' }).berichte.map((x) => x.nummer), ['RB-2026-0002'])
})

test('Ändern: Rechnungsentwurf über die Aktion des Moduls, Erinnerung öffnet nur den Dialog', async () => {
  const calls = []
  registerActions({
    'reg-invoice': (el) => {
      calls.push(['reg-invoice', { ...el.dataset }])
      return { x: { id: 'neu', title: 'Regiebericht RB-2026-0001', lines: [], total: { net: 140, vat: 28, gross: 168 } }, customer: { id: 'c2', name: 'Hausverwaltung Lehen GmbH' }, message: '1 Rechnungsentwurf erstellt.' }
    },
    'fak-remind-open': (el) => calls.push(['fak-remind-open', { ...el.dataset }]),
  })
  await withAppAsync({ access: null, readOnly: false, data: DATA() }, async () => {
    const draft = availableTools().find((t) => t.name === 'rechnung_aus_regiebericht')
    const card = draft.summary({ regiebericht: 'RB-2026-0001' })
    assert.equal(card.title, 'Rechnungsentwurf aus Regiebericht')
    assert.ok(card.lines.some((l) => /Kunde: Hausverwaltung Lehen GmbH/.test(l)), card.lines.join(' | '))
    assert.throws(() => draft.summary({ regiebericht: 'RB-2026-0002' }), /noch nicht abgeschlossen/)
    const res = await draft.run({ regiebericht: 'rb-2026-0001' })
    assert.equal(res.entwurf, true)
    assert.deepEqual(calls[0], ['reg-invoice', { id: 'r1', quiet: '1' }])
    const remind = availableTools().find((t) => t.name === 'zahlungserinnerung_vorbereiten')
    assert.match(remind.summary({ rechnung: '2026-1' }).lines.join(' '), /RE-2026-0001.*offen 600,00 €.*gesendet wird erst dort/)
    assert.throws(() => remind.summary({ rechnung: 'RE-2026-0003' }), /bezahlt/)
    assert.match(remind.summary({ rechnung: '2' }).lines[0], /^RE-2026-0002 · Hausverwaltung Lehen GmbH$/, 'nur die laufende Nummer genügt')
    assert.throws(() => remind.summary({ rechnung: 'RE-2025-0001' }), /nicht gefunden/)
    const done = await remind.run({ rechnung: 'RE-2026-0001' })
    assert.equal(done.geoeffnet, true)
    assert.deepEqual(calls[1], ['fak-remind-open', { id: 'd1' }])
  })
})

test('Ändern: Termine für Anlage und Nachkontrolle – Vorschlag des Tages und Karte', () => {
  withApp({ access: null, readOnly: false, data: DATA() }, () => {
    const a = availableTools().find((t) => t.name === 'anlage_termin')
    const card = a.summary({ objekt: 'Wohnanlage Lehen' })
    assert.equal(card.lines[0], 'Prüfung Feuerlöscher: Stiege 1 EG (Brandschutz Muster)')
    assert.match(card.lines[1], /08:00–09:00$/)
    assert.throws(() => a.summary({ objekt: 'Kanzlei Berger' }), /keine Anlagen/)
    assert.equal(a.summary({ objekt: 'Lehen', anlage: 'Rauchwarnmelder', beginn: '10:30' }).lines[1].slice(-11), '10:30–11:30')
    const q = availableTools().find((t) => t.name === 'nachkontrolle_termin')
    const qc = q.summary({ objekt: 'Kanzlei Berger' })
    assert.equal(qc.lines[0], 'Nachkontrolle: Kanzlei Berger')
    assert.match(qc.lines[2], /Kennzahl 81\.5 % \(Ziel 90 %\), nicht erfüllt/)
    assert.throws(() => q.summary({ objekt: 'Wohnanlage Lehen' }), /noch keine Qualitätsmessung/)
  })
})
