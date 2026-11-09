// Werkzeuge des KI-Assistenten für den Mattenwechsel (src/ai/tools-matten.js): Rechte über die Bereiche (Fahrer nur die
// eigenen Touren, Buchhaltung nur, was sie in der Fakturierung sieht), Rückgaben aus den Rechenkernen des Moduls, Ändern
// nur über die Funktionen des Kalenders nach „Ausführen“. Ohne echte API: die Werkzeuge werden direkt aufgerufen.
// Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { availableTools, validateInput } from '../src/ai/registry.js'
import '../src/ai/tools.js'
import '../src/ai/tools-module.js'
import '../src/ai/tools-matten.js'
import { resolveAccess } from '../src/core/access.js'
import { addDays, todayISO } from '../src/core/dates.js'
import { prevMonth } from '../src/core/matten-abrechnung.js'
import { confirmPlacement, finishStop } from '../src/core/matten-fahrt.js'
import { createNote, markSent } from '../src/core/matten-lieferschein.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'
import { app } from '../src/ui/context.js'

const MATTEN_TOOLS = ['matten_abrechnung_vorschau', 'matten_einsatz_aendern', 'matten_faellig', 'matten_lieferscheine', 'matten_pause_eintragen', 'matten_touren', 'matten_uebersicht']
const WRITE = ['matten_einsatz_aendern', 'matten_pause_eintragen']
const today = todayISO()
const T = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+01:00`).toISOString()
const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><path d="M10 10L50 50"/></svg>'

const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const mat = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Lehen', address: 'Lehener Straße 5, 5020 Salzburg', lat: 47.81, lon: 13.03 },
  { id: 'o2', name: 'Autohaus Maxglan', address: 'Autoweg 7, 5020 Salzburg', lat: 47.79, lon: 13.0 },
]
const lp = (id, name, objectId, customer, areaId, intervalDays, startDate, extra = {}) => ({ id, name, objectId, customerId: customer.id, customer, areaId, active: true, mats: [{ ...mat, qty: 2, owner: 'wir' }], intervalDays, startDate, rule: 'rhythmus', pauses: [], ...extra })
const placements = () => [
  lp('p1', 'Haupteingang', 'o1', hv, 'g1', 14, addDays(today, 2), { floor: 'EG' }),
  lp('p2', 'Stiege 2', 'o1', hv, 'g1', 28, addDays(today, 3)),
  lp('p3', 'Schauraum', 'o2', ah, 'g2', 14, addDays(today, -3)),
  lp('p4', 'Werkstatt', 'o2', ah, 'g2', 28, today),
]
const job = (placementId, due, status = 'geplant', extra = {}) => ({ id: `${placementId}:${due}`, key: `${placementId}:${due}`, placementId, due, status, createdAt: T(today, 7), createdBy: 'Büro', ...extra })

/** Tour für einen Tag aus Einsätzen (stopsFromJobs wie die Tourenplanung). */
function tour(id, date, driver, status, jobs) {
  const stops = stopsFromJobs({ jobs, placements: placements(), objects, date })
  return { schema: 1, id, date, driverId: driver.id, driverName: driver.name, driverEmail: driver.email, vehicleLabel: driver.vehicle || '', status, order: stops.map((s) => s.id), stops, createdAt: T(date, 6), releasedAt: T(date, 6) }
}
const anna = { id: 'e1', name: 'Anna Beispiel', email: 'anna@beispiel.example', vehicle: 'S-100 AB · VW Caddy' }
const bernd = { id: 'e2', name: 'Bernd Muster', email: 'bernd@beispiel.example' }

function tours() {
  const a = tour('mt-anna', today, anna, 'freigegeben', [job('p4', today)])
  let b = tour('mt-bernd', today, bernd, 'unterwegs', [job('p1', addDays(today, -12)), job('p3', addDays(today, -12))])
  const s1 = b.stops.find((s) => s.objectId === 'o1').id
  b = confirmPlacement(b, s1, 'p1', { now: T(today, 8), by: bernd.name })
  b = finishStop(b, s1, { signature: { name: 'Eva Beispiel', role: 'Hausbetreuung', svg: SIG }, now: T(today, 8, 5), by: bernd.name })
  const draft = tour('mt-entwurf', today, anna, 'entwurf', [job('p2', today)])
  return [a, b, draft]
}

/** Fakturierung mit zwei Lieferscheinen aus dem Vormonat (Tour „mt-alt“), der des Autohauses versendet. */
function fakturierung() {
  const f = {
    settings: { sender: { name: 'Reinigung Beispiel GmbH', address: 'Beispielgasse 1\n5020 Salzburg', uid: 'ATU00000000' }, vat: 20, bank: { iban: 'AT611904300234573201' } },
    customers: [
      { id: 'c1', customerNo: '10001', name: 'Hausverwaltung Beispiel GmbH', street: 'Ringstraße 3', zip: '5020', city: 'Salzburg', email: 'buchhaltung@hv.example', objectIds: ['o1'] },
      { id: 'c2', customerNo: '10002', name: 'Autohaus Muster KG', street: 'Autoweg 7', zip: '5020', city: 'Salzburg', email: 'rechnung@autohaus.example', objectIds: ['o2'] },
    ],
    articles: [{ id: 'a-m1', articleNo: 'MA-01', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', unit: 'Stk', price: 4.9, vat: 20 }],
    customerPrices: [{ id: 'kp1', customerId: 'c1', articleId: 'a-m1', price: 4.4, vat: 20, validFrom: '2020-01-01', validTo: '' }],
    documents: [],
  }
  const date = `${prevMonth(today)}-12`
  let t = tour('mt-alt', date, bernd, 'unterwegs', [job('p1', date), job('p3', date)])
  for (const s of [...t.stops]) {
    for (const p of s.items) t = confirmPlacement(t, s.id, p.placementId, { now: T(date, 8), by: bernd.name })
    t = finishStop(t, s.id, { reason: 'niemand vor Ort', now: T(date, 8, 30), by: bernd.name })
  }
  for (const s of t.stops) {
    let doc = createNote({ tour: t, stop: s, data: f, id: `ls-${s.objectId}`, now: s.finishedAt, by: 'Büro' }).doc
    if (s.objectId === 'o2') doc = markSent(doc, { to: ['rechnung@autohaus.example'], by: 'Büro', at: T(date, 12) })
    f.documents.push(doc)
  }
  return f
}

/** Ablage der Touren für die gemeinsame Touren-Ablage (ui/matten-tourablage.js): Ordner je Jahr, Lesen mit eTag. */
function fakeStore(list) {
  const files = new Map(list.map((t) => [`matten/touren/${t.date.slice(0, 4)}/${t.id}.json`, t]))
  return {
    kind: 'local',
    listFiles: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((path) => ({ path, etag: 'e1' })),
    read: async (path) => (files.has(path) ? { data: structuredClone(files.get(path)), etag: 'e1' } : null),
    write: async () => ({ etag: 'e2' }),
  }
}

const DATA = () => ({
  objects,
  employees: [],
  matten: { schema: 1, settings: { closures: [] }, placements: placements(), areas: [{ id: 'g1', name: 'Salzburg Nord', active: true }, { id: 'g2', name: 'Salzburg Süd', active: true }] },
  mattenJobs: [job('p1', addDays(today, 2)), job('p3', addDays(today, -3)), job('p4', today, 'in-tour', { tourId: 'mt-anna' })],
  fakturierung: fakturierung(),
})

let saved = 0
const service = { schedule: () => saved++, ensureYears: async () => true }
async function withApp(patch, fn) {
  const before = { access: app.access, readOnly: app.readOnly, data: app.data, store: app.store, service: app.service, user: app.user }
  Object.assign(app, { service, store: fakeStore(tours()), user: { name: 'Eva Büro', email: 'buero@beispiel.example' }, ...patch })
  try {
    return await fn()
  } finally {
    Object.assign(app, before)
  }
}
const role = (seen, edited = []) => ({ all: false, label: 'Rolle', sees: (m) => seen.includes(m) || edited.includes(m), canEdit: (m) => edited.includes(m) })
const names = () => availableTools().map((t) => t.name).filter((n) => MATTEN_TOOLS.includes(n))
const tool = (name) => availableTools().find((t) => t.name === name)
/** Werkzeug wie im Chat aufrufen: Eingabe gegen das Schema prüfen, dann run. */
const run = async (name, input) => {
  const t = tool(name)
  assert.ok(t, `${name} verfügbar`)
  assert.equal(validateInput(t.input_schema, input), '', `${name}: Eingabe`)
  return t.run(input)
}

test('Mattenwechsel: Werkzeuge gültig beschrieben, Ändern nur mit Bestätigung, keine Freigabe-, Sende- oder Festschreib-Werkzeuge', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, () => {
    assert.deepEqual(names(), MATTEN_TOOLS)
    for (const t of availableTools().filter((x) => MATTEN_TOOLS.includes(x.name))) {
      assert.match(t.name, /^[a-z][a-z_]{2,63}$/)
      assert.ok(t.description.length >= 60 && t.description.length <= 420, t.name)
      assert.ok(t.label, `${t.name}: Bezeichnung für den Chat`)
      assert.equal(!!t.write, WRITE.includes(t.name), t.name)
      if (t.write) assert.equal(typeof t.summary, 'function', t.name)
      for (const key of t.input_schema.required || []) assert.ok(t.input_schema.properties[key], `${t.name}.${key}`)
      assert.ok(!/claude|opus|sonnet|haiku/i.test(t.description), 'keine Modellnamen')
      assert.ok(!/Standort/.test(t.description), 'Fachbegriff Liegeplatz')
    }
    assert.ok(tool('matten_faellig').description.includes('Liegeplätze'))
    assert.ok(!availableTools().some((t) => t.name.startsWith('matten_') && /freigeb|festschreib|send/.test(t.name)), 'keine Werkzeuge zum Freigeben, Festschreiben oder Senden')
  })
})

test('Mattenwechsel: Rechte – Büro, Fahrer nur Touren, Buchhaltung nur Lieferscheine und Abrechnung, Nur-Lesen ohne Ändern', async () => {
  const roles = { planners: ['chef@example.com'] }
  const real = (id) => resolveAccess({ roleClaims: [id], access: roles, strict: true })
  const as = (access, readOnly = false) => withApp({ access, readOnly, data: DATA() }, () => names())
  assert.deepEqual(await as(real('mattenwechsel')), ['matten_einsatz_aendern', 'matten_faellig', 'matten_lieferscheine', 'matten_pause_eintragen', 'matten_touren', 'matten_uebersicht'])
  assert.deepEqual(await as(real('mattenfahrer')), ['matten_touren'])
  assert.deepEqual(await as(real('buchhaltung')), ['matten_abrechnung_vorschau', 'matten_lieferscheine'])
  assert.deepEqual(await as(real('lager')), [])
  assert.deepEqual(await as(real('objektmanagement')), [])
  assert.deepEqual(await as(real('mattenwechsel'), true), ['matten_faellig', 'matten_lieferscheine', 'matten_touren', 'matten_uebersicht'], 'Nur-Lesen: nichts ändern')
  // Büro, das den Mattenwechsel nur sieht: nachschlagen ja, ändern nein
  assert.deepEqual(await as(role(['matten'])), ['matten_faellig', 'matten_lieferscheine', 'matten_touren', 'matten_uebersicht'])
  assert.deepEqual(await as(resolveAccess({ email: 'chef@example.com', access: roles, strict: true })), MATTEN_TOOLS)
})

test('Fällige Liegeplätze: Zeitraum mit geplanten, noch nicht geplanten, in Tour und überfälligen; Filter je Gebiet, Kunde, Objekt', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, async () => {
    const r = await run('matten_faellig', { von: today, bis: addDays(today, 6) })
    const by = new Map(r.liegeplaetze.map((x) => [x.liegeplatz, x]))
    assert.equal(by.get('Haupteingang (EG)').stand, 'geplant')
    assert.equal(by.get('Haupteingang (EG)').datum, addDays(today, 2))
    assert.match(by.get('Stiege 2').stand, /^noch nicht im Kalender/)
    assert.equal(by.get('Werkstatt').stand, 'in Tour (Anna Beispiel, freigegeben)')
    assert.match(by.get('Schauraum').stand, /^überfällig seit /)
    assert.equal(by.get('Schauraum').datum, addDays(today, -3))
    assert.equal(r.ueberfaellig, 1)
    assert.deepEqual([by.get('Schauraum').objekt, by.get('Schauraum').kunde, by.get('Schauraum').gebiet, by.get('Schauraum').matten], ['Autohaus Maxglan', 'Autohaus Muster KG', 'Salzburg Süd', '2 × 85 × 150 cm, grau'])
    assert.ok(!JSON.stringify(r).includes('4.4') && !/preis/i.test(JSON.stringify(r)), 'keine Preise')
    // Filter
    assert.deepEqual((await run('matten_faellig', { von: today, bis: addDays(today, 6), gebiet: 'Nord' })).liegeplaetze.map((x) => x.liegeplatz), ['Haupteingang (EG)', 'Stiege 2'])
    const k = await run('matten_faellig', { von: today, bis: addDays(today, 6), kunde: 'Autohaus' })
    assert.deepEqual([k.kunde, k.liegeplaetze.map((x) => x.liegeplatz).sort().join()], ['Autohaus Muster KG', 'Schauraum,Werkstatt'])
    assert.equal((await run('matten_faellig', { von: today, bis: addDays(today, 6), objekt: 'Wohnanlage' })).anzahl, 2)
    assert.equal((await run('matten_faellig', { von: today, bis: addDays(today, 6), mit_ueberfaelligen: false })).ueberfaellig, 0)
    await assert.rejects(() => run('matten_faellig', { von: today, bis: addDays(today, 90) }), /Höchstens 62 Tage/)
    await assert.rejects(() => run('matten_faellig', { von: today, bis: today, kunde: 'Unbekannt' }), /nicht gefunden/)
  })
})

test('Touren eines Tages: Büro sieht alle mit Fortschritt, Fahrer nur die eigenen (ohne Entwürfe)', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, async () => {
    const r = await run('matten_touren', {})
    assert.equal(r.datum, today)
    assert.deepEqual(r.touren.map((t) => [t.fahrer, t.stand]), [['Anna Beispiel', 'freigegeben'], ['Anna Beispiel', 'Entwurf'], ['Bernd Muster', 'unterwegs']])
    const b = r.touren.find((t) => t.fahrer === 'Bernd Muster')
    assert.deepEqual([b.stopps_gesamt, b.stopps_erledigt, b.stopps_offen, b.matten_geplant, b.matten_gewechselt], [2, 1, 1, 4, 2])
    assert.equal(b.naechster_stopp, 'Autohaus Maxglan, Autohaus Muster KG')
    assert.deepEqual(b.stopps.map((s) => [s.objekt, s.stand]).sort(), [['Autohaus Maxglan', 'geplant'], ['Wohnanlage Lehen', 'abgeschlossen']])
    assert.equal(r.touren.find((t) => t.fahrzeug).fahrzeug, 'S-100 AB · VW Caddy')
  })
  // Fahrerin Anna (Konto mit ihrer E-Mail): nur die eigene freigegebene Tour, kein Entwurf, nicht Bernds
  await withApp({ access: role([], ['mattentour']), readOnly: false, data: { objects: [], employees: [] }, user: { name: 'Anna Beispiel', email: 'Anna@Beispiel.example' } }, async () => {
    const r = await run('matten_touren', { datum: today })
    assert.deepEqual(r.touren.map((t) => [t.fahrer, t.stand]), [['Anna Beispiel', 'freigegeben']])
    assert.equal(r.hinweis, 'Nur deine eigenen Touren.')
    assert.ok(!JSON.stringify(r).includes('Bernd'))
  })
  await withApp({ access: role([], ['mattentour']), readOnly: false, data: { objects: [], employees: [] }, user: { name: 'Jemand', email: 'jemand@beispiel.example' } }, async () => {
    assert.equal((await run('matten_touren', {})).anzahl, 0, 'fremde Touren nie')
  })
})

test('Übersicht: die neun Zahlen; ohne Fakturierung fehlen Lieferscheine und Rechnungsentwürfe', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, async () => {
    const r = await run('matten_uebersicht', {})
    assert.deepEqual(Object.keys(r).slice(0, 10), ['stichtag', 'heute_faellig', 'geplante_touren', 'touren_in_durchfuehrung', 'abgeschlossene_touren_7_tage', 'ueberfaellig', 'nicht_durchgefuehrt', 'nicht_versendete_lieferscheine', 'fehlerhafte_uebertragungen', 'offene_rechnungsentwuerfe'])
    assert.deepEqual([r.geplante_touren, r.touren_in_durchfuehrung, r.ueberfaellig, r.nicht_versendete_lieferscheine, r.offene_rechnungsentwuerfe], [2, 1, 1, 1, 0])
    assert.ok(r.heute_faellig >= 1)
  })
  await withApp({ access: role(['matten', 'mattentour'], ['matten', 'mattentour']), readOnly: false, data: DATA() }, async () => {
    const r = await run('matten_uebersicht', {})
    assert.ok(!('nicht_versendete_lieferscheine' in r) && !('offene_rechnungsentwuerfe' in r) && r.ohne_fakturierung)
  })
})

test('Lieferscheine: mit Fakturierung Netto und Verrechnung, ohne Fakturierung aus den Touren ohne Preise', async () => {
  const von = `${prevMonth(today)}-01`
  await withApp({ access: role(['einkauf'], ['fakturierung', 'einkauf']), readOnly: false, data: DATA() }, async () => {
    const r = await run('matten_lieferscheine', { von, bis: today })
    assert.equal(r.anzahl, 2)
    const byKunde = new Map(r.lieferscheine.map((x) => [x.kunde, x]))
    assert.deepEqual([byKunde.get('Hausverwaltung Beispiel GmbH').netto, byKunde.get('Hausverwaltung Beispiel GmbH').matten, byKunde.get('Hausverwaltung Beispiel GmbH').versendet], [8.8, 2, 'nein'])
    assert.deepEqual([byKunde.get('Autohaus Muster KG').netto, byKunde.get('Autohaus Muster KG').versendet, byKunde.get('Autohaus Muster KG').verrechnung], [9.8, 'ja', 'offen'])
    assert.equal(r.summe_netto, 18.6)
    const one = await run('matten_lieferscheine', { von, bis: today, kunde: '10002' })
    assert.deepEqual([one.kunde, one.anzahl], ['Autohaus Muster KG', 1])
    await assert.rejects(() => run('matten_lieferscheine', { von: '2024-01-01', bis: today }), /Höchstens ein Jahr/)
  })
  // Büro ohne Fakturierung: Stand aus der Kopie am Stopp, keine Preise (Tour „mt-alt“ mit Vermerk am Stopp)
  const data = DATA()
  const notes = data.fakturierung.documents
  const alt = (() => {
    const date = `${prevMonth(today)}-12`
    const t = tour('mt-alt', date, bernd, 'abgeschlossen', [job('p1', date), job('p3', date)])
    return { ...t, stops: t.stops.map((s) => ({ ...s, status: 'abgeschlossen', finishedAt: T(date, 8, 30), items: s.items.map((it) => ({ ...it, status: 'gewechselt' })), deliveryNote: { state: s.objectId === 'o2' ? 'versendet' : 'erstellt', number: notes.find((d) => d.objectId === s.objectId).number } })) }
  })()
  delete data.fakturierung
  await withApp({ access: role(['matten', 'mattentour'], ['matten', 'mattentour']), readOnly: false, data, store: fakeStore([...tours(), alt]) }, async () => {
    const r = await run('matten_lieferscheine', { von, bis: today })
    assert.equal(r.anzahl, 2)
    assert.deepEqual(r.lieferscheine.map((x) => x.stand).sort(), ['nicht versendet', 'versendet'])
    assert.ok(r.lieferscheine.every((x) => !('netto' in x)) && !/netto|preis|4\.4|8\.8/i.test(JSON.stringify(r.lieferscheine)))
    assert.match(r.hinweis, /ohne Preise/)
  })
})

test('Abrechnung: Vorschau des Laufs je Kunde, nichts wird angelegt', async () => {
  await withApp({ access: role([], ['fakturierung']), readOnly: false, data: DATA() }, async () => {
    const before = app.data.fakturierung.documents.length
    const r = await run('matten_abrechnung_vorschau', {})
    assert.equal(r.monat, prevMonth(today))
    assert.equal(r.nur_vorschau, true)
    assert.deepEqual([r.kunden_mit_offenem, r.entwuerfe, r.netto_gesamt], [2, 2, 18.6])
    const k = r.kunden.find((x) => x.kunde === 'Hausverwaltung Beispiel GmbH')
    assert.equal(k.entwuerfe[0].art, 'Sammelrechnung')
    assert.deepEqual([k.entwuerfe[0].netto, k.entwuerfe[0].brutto, k.lieferscheine.length], [8.8, 10.56, 1])
    assert.equal(app.data.fakturierung.documents.length, before, 'nichts angelegt')
    assert.match(r.hinweis, /Nichts wurde angelegt/)
    assert.equal((await run('matten_abrechnung_vorschau', { kunde: 'Autohaus' })).kunden.length, 1)
    await assert.rejects(() => run('matten_abrechnung_vorschau', { monat: '2099-01' }), /Zukunft/)
  })
})

test('Ändern: Einsatz verschieben bzw. aussetzen erst nach „Ausführen“, wie im Kalender', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, async () => {
    const t = tool('matten_einsatz_aendern')
    const target = addDays(today, 4)
    const card = await t.summary({ liegeplatz: 'Haupteingang Lehen', aktion: 'verschieben', neuer_tag: target })
    assert.equal(card.title, 'Mattenwechsel verschieben')
    assert.equal(card.lines[0], 'Haupteingang (EG), Wohnanlage Lehen · Hausverwaltung Beispiel GmbH')
    assert.match(card.lines[1], /^Wechsel am /)
    assert.match(card.lines[3], /Rhythmus/)
    assert.equal(app.data.mattenJobs.find((j) => j.key === `p1:${addDays(today, 2)}`).planned, undefined, 'vor „Ausführen“ nichts geändert')
    const savedBefore = saved
    const res = await t.run({ liegeplatz: 'Haupteingang Lehen', aktion: 'verschieben', neuer_tag: target })
    const moved = app.data.mattenJobs.find((j) => j.key === `p1:${addDays(today, 2)}`)
    assert.deepEqual([res.geaendert, res.tag, moved.planned, moved.due, moved.status], [true, target, target, addDays(today, 2), 'geplant'])
    assert.match(moved.updatedBy, /KI-Assistent/)
    assert.ok(saved > savedBefore, 'gespeichert')
    // noch nicht im Kalender: der Wechsel aus dem Rhythmus wird mit dem Aussetzen angelegt
    await assert.rejects(() => t.summary({ liegeplatz: 'Stiege 2', aktion: 'aussetzen' }), /Grund/)
    const c2 = await t.summary({ liegeplatz: 'Stiege 2', aktion: 'aussetzen', grund: 'Kunde geschlossen' })
    assert.match(c2.lines[1], /noch nicht im Kalender, wird dabei angelegt/)
    await t.run({ liegeplatz: 'Stiege 2', aktion: 'aussetzen', grund: 'Kunde geschlossen' })
    assert.deepEqual(app.data.mattenJobs.filter((j) => j.placementId === 'p2').map((j) => [j.due, j.status, j.reason]), [[addDays(today, 3), 'ausgesetzt', 'Kunde geschlossen']])
    // in einer freigegebenen Tour: nur die Tourenplanung
    await assert.rejects(() => t.summary({ liegeplatz: 'Werkstatt', aktion: 'verschieben', neuer_tag: target }), /freigegebenen Tour/)
    // verschieben nur ab heute; kein Wechsel an diesem Tag
    await assert.rejects(() => t.summary({ liegeplatz: 'Schauraum', aktion: 'verschieben', neuer_tag: addDays(today, -1) }), /ab heute/)
    await assert.rejects(() => t.summary({ liegeplatz: 'Haupteingang', aktion: 'aussetzen', datum: addDays(today, 5), grund: 'x' }), /kein Wechsel/)
    // mehrdeutig: Rückfrage
    await assert.rejects(() => t.summary({ liegeplatz: 'Autohaus', aktion: 'aussetzen', grund: 'x' }), /nicht eindeutig/)
  })
})

test('Ändern: Pause am Liegeplatz – geplante Wechsel darin ausgesetzt, nach „Ausführen“ gespeichert', async () => {
  await withApp({ access: null, readOnly: false, data: DATA() }, async () => {
    const t = tool('matten_pause_eintragen')
    const input = { liegeplatz: 'Haupteingang', von: today, bis: addDays(today, 10), grund: 'Umbau Eingang' }
    const card = await t.summary(input)
    assert.equal(card.title, 'Pause am Liegeplatz eintragen')
    assert.match(card.lines[1], /: Umbau Eingang$/)
    assert.match(card.lines[2], /^Geplante Wechsel: .* entfällt$/)
    assert.deepEqual(app.data.matten.placements.find((p) => p.id === 'p1').pauses, [], 'vor „Ausführen“ nichts geändert')
    const res = await t.run(input)
    assert.deepEqual([res.eingetragen, res.geplante_wechsel_angepasst], [true, 1])
    const p1 = app.data.matten.placements.find((p) => p.id === 'p1')
    assert.deepEqual(p1.pauses, [{ from: today, to: addDays(today, 10), reason: 'Umbau Eingang' }])
    assert.equal(app.data.mattenJobs.find((j) => j.key === `p1:${addDays(today, 2)}`).status, 'ausgesetzt')
    // überschneidet sich, beginnt in der Vergangenheit, Einsatz in einer Tour bleibt (Hinweis)
    await assert.rejects(() => t.summary({ ...input, von: addDays(today, 5), bis: '' }), /schon eine Pause/)
    await assert.rejects(() => t.summary({ ...input, liegeplatz: 'Stiege 2', von: addDays(today, -1) }), /frühestens heute/)
    const w = await t.summary({ liegeplatz: 'Werkstatt', von: today, grund: 'Inventur' })
    assert.ok(w.lines.some((l) => /schon in einer Tour/.test(l)), w.lines.join(' | '))
    await t.run({ liegeplatz: 'Werkstatt', von: today, grund: 'Inventur' })
    assert.equal(app.data.mattenJobs.find((j) => j.key === `p4:${today}`).status, 'in-tour', 'Einsatz in der Tour bleibt')
  })
})
