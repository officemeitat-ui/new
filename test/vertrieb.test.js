// Vertrieb (core/vertrieb.js): Stufen und Übergänge, Erinnerungen (ohne doppeltes „Angebot nachfassen“), Übergabe an
// Kalkulation und Angebot, Stand des Angebots zurück in den Fall, Assistent „Auftrag anlegen“, Kennzahlen, KI-Besichtigung
// (Anfrage und Prüfung) und Rechte.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ROLES, resolveAccess } from '../src/core/access.js'
import { calculate, CALC_DEFAULTS } from '../src/core/calculation.js'
import { contractProblems, contractStatus } from '../src/core/vertraege.js'
import {
  advanceTo,
  applyCalc,
  applyMove,
  besichtigungRequest,
  calcAreasFromRooms,
  calcSummary,
  caseName,
  caseProblems,
  checkBesichtigung,
  contractFromCase,
  customerFromLead,
  dueCases,
  emptyVertrieb,
  expectedMonthly,
  firstMonth,
  freqOf,
  isProspect,
  lvSnapshot,
  lvText,
  mergeRooms,
  moveCheck,
  nextCaseNo,
  objectFromCase,
  offerDraftFields,
  offerLines,
  offerOfCase,
  offerSnapshot,
  planHint,
  probabilityOf,
  recurringFromOffer,
  roomTotals,
  salesKpi,
  salesRights,
  siteAddress,
  stageOf,
  syncOffer,
  typeOf,
  weightedMonthly,
  wizardSteps,
  workdayAfter,
} from '../src/core/vertrieb.js'
import { dataRights, FOLDERS, folderRights, MODULE_DOCS } from '../src/storage/data-service.js'

const AT = '2026-11-09T10:00:00.000Z'
const base = (extra = {}) => ({ id: 'vf1', no: 'VT-2026-001', stage: 'anfrage', requestDate: '2026-10-01', lead: { name: 'Kanzlei Beispiel', street: 'Gasse 1', zip: '5020', city: 'Salzburg', contact: 'Frau Muster', phone: '0662 1', email: 'k@beispiel.example' }, site: { name: 'Kanzlei', address: '' }, visit: { rooms: [], photos: [] }, history: [], ...extra })
const rooms = [
  { id: 'r1', name: 'Büros', type: 'buero', m2: 300, perWeek: 5, floor: 'teppich', notes: 'ab 17 Uhr' },
  { id: 'r2', name: 'WC', type: 'sanitaer', m2: 30, perWeek: 5, floor: 'fliesen' },
  { id: 'r3', name: 'Stiege', type: 'stiege', m2: 60, perWeek: 0.5 },
  { id: 'r4', name: 'Archiv', type: 'lager', m2: 0, perWeek: 1 },
]

test('Leerer Inhalt wie in storage/data-service.js, Fallnummer je Jahr', () => {
  assert.deepEqual(MODULE_DOCS.vertrieb.empty(), emptyVertrieb())
  assert.equal(MODULE_DOCS.vertrieb.path, 'vertrieb/vertrieb.json')
  assert.equal(nextCaseNo([], '2026'), 'VT-2026-001')
  assert.equal(nextCaseNo([{ no: 'VT-2026-004' }, { no: 'VT-2025-009' }, { no: 'x' }], '2026'), 'VT-2026-005')
})

test('Stufen: Wahrscheinlichkeit je Stufe, eigene bis zum Wechsel, Abschlüsse fest', () => {
  assert.equal(stageOf({}), 'anfrage')
  assert.equal(probabilityOf(base({ stage: 'kalkuliert' })), 40)
  assert.equal(probabilityOf(base({ stage: 'kalkuliert', probability: 70 })), 70)
  assert.equal(probabilityOf(base({ stage: 'angenommen', probability: 70 })), 100)
  assert.equal(probabilityOf(base({ stage: 'abgelehnt' })), 0)
  const moved = applyMove(base({ stage: 'kalkuliert', probability: 70 }), 'angebot', { at: AT, by: 'P' })
  assert.equal(moved.probability, undefined)
  assert.equal(probabilityOf(moved), 50)
  assert.equal(expectedMonthly(base({ monthly: '' , calc: { net: 1234.5 } })), 1234.5)
  assert.equal(expectedMonthly(base({ monthly: 900, calc: { net: 1234.5 } })), 900)
  assert.equal(weightedMonthly(base({ stage: 'angebot', monthly: 1000 })), 500)
})

test('Übergänge: Voraussetzungen vorwärts, rückwärts frei, Grund bei abgelehnt', () => {
  const c = base()
  assert.deepEqual(moveCheck(c, 'besichtigung').warnings, ['Noch kein Termin für die Besichtigung eingetragen.'])
  assert.ok(moveCheck(c, 'besichtigt').ok)
  assert.ok(!moveCheck(c, 'kalkuliert').ok, 'ohne Kalkulation nicht kalkuliert')
  assert.ok(moveCheck(base({ calc: { net: 900 } }), 'kalkuliert').ok)
  assert.ok(!moveCheck(base({ stage: 'kalkuliert', calc: { net: 900 } }), 'angebot').ok, 'ohne Angebot nicht gesendet')
  assert.ok(moveCheck(base({ stage: 'kalkuliert', offer: { id: 'd1', number: 'AN-1' } }), 'angebot').ok)
  assert.ok(!moveCheck(c, 'abgelehnt').ok)
  assert.ok(moveCheck(c, 'abgelehnt', { reason: 'Preis' }).ok)
  // angenommen geht auch ohne online angenommenes Angebot (telefonisch), mit Hinweis
  const tel = moveCheck(base({ stage: 'angebot', offer: { id: 'd1', number: 'AN-1', state: 'offen' } }), 'angenommen')
  assert.ok(tel.ok && tel.warnings.length === 1)
  // rückwärts: kein Fehler, auch von angenommen zurück
  assert.ok(moveCheck(base({ stage: 'angebot' }), 'kalkuliert').ok)
  assert.ok(moveCheck(base({ stage: 'angenommen', wonAt: '2026-11-01' }), 'angebot').ok)
  assert.ok(!moveCheck(c, 'gibt-es-nicht').ok)

  const won = applyMove(base({ stage: 'angebot' }), 'angenommen', { at: AT, by: 'Petra' })
  assert.equal(won.wonAt, '2026-11-09')
  assert.equal(won.history.at(-1).text, 'Angebot gesendet → Angenommen')
  const lost = applyMove(won, 'abgelehnt', { at: AT, by: 'Petra', reason: 'Preis zu hoch' })
  assert.ok(!lost.wonAt && lost.lostAt === '2026-11-09' && lost.lostReason === 'Preis zu hoch')
  assert.match(lost.history.at(-1).text, /Angenommen → Abgelehnt \(Preis zu hoch\)/)
  const back = applyMove(lost, 'angebot', { at: AT })
  assert.ok(!back.lostAt && !back.lostReason)
  // nur vorwärts: Abschlüsse und spätere Stufen bleiben
  assert.equal(advanceTo(base({ stage: 'kalkuliert' }), 'besichtigung').stage, 'kalkuliert')
  assert.equal(advanceTo(base({ stage: 'angenommen' }), 'angebot').stage, 'angenommen')
  assert.equal(advanceTo(base(), 'besichtigung', { at: AT }).stage, 'besichtigung')
  // der alte Fall bleibt unverändert
  const before = base({ stage: 'angebot' })
  applyMove(before, 'angenommen', { at: AT })
  assert.equal(before.stage, 'angebot')
})

test('Fall prüfen: Name oder Kunde, Zahlen, Hinweis ohne nächsten Schritt', () => {
  assert.ok(caseProblems({ lead: {} }).some((p) => p.level === 'error' && p.field === 'name'))
  assert.ok(!caseProblems({ customerId: 'c1' }).some((p) => p.level === 'error'))
  assert.ok(caseProblems(base({ probability: 120 })).some((p) => p.field === 'probability'))
  assert.ok(caseProblems(base()).some((p) => p.field === 'next' && p.level === 'warn'))
  assert.ok(!caseProblems(base({ next: { date: '2026-11-10' } })).some((p) => p.field === 'next'))
  assert.equal(caseName(base(), { name: 'Kunde GmbH' }), 'Kunde GmbH')
  assert.equal(caseName(base(), null), 'Kanzlei Beispiel')
  assert.equal(siteAddress(base()), 'Gasse 1, 5020 Salzburg')
  assert.equal(siteAddress(base({ site: { address: 'Weg 3' } })), 'Weg 3')
})

test('Erinnerungen: nächster Schritt fällig, Besichtigung erfassen, Angebot nicht doppelt', () => {
  const today = '2026-11-09'
  const cases = [
    base({ id: 'a', no: 'VT-1', next: { text: 'Anrufen', date: '2026-11-07' } }),
    base({ id: 'b', no: 'VT-2', next: { text: 'später', date: '2026-11-12' } }),
    base({ id: 'c', no: 'VT-3', stage: 'besichtigung', visit: { date: '2026-11-05' }, next: { date: '' } }),
    base({ id: 'd', no: 'VT-4', stage: 'angebot', offer: { id: 'o1', state: 'offen', followUp: '2026-11-05' }, next: { text: 'nachfassen', date: '2026-11-01' } }),
    base({ id: 'e', no: 'VT-5', stage: 'angenommen', next: { text: 'alt', date: '2026-11-01' } }),
    base({ id: 'f', no: 'VT-6', next: { text: 'heute', date: today } }),
  ]
  const ids = (list) => list.map((d) => `${d.case.id}:${d.kind}`)
  assert.deepEqual(ids(dueCases(cases, today)), ['d:schritt', 'c:besichtigung', 'a:schritt', 'f:schritt'])
  // wer die Fakturierung bearbeitet, bekommt das offene Angebot über „Angebote nachfassen“ – hier nicht noch einmal
  assert.deepEqual(ids(dueCases(cases, today, { offerHandled: (c) => c.offer?.state === 'offen' && !!c.offer.followUp })), ['c:besichtigung', 'a:schritt', 'f:schritt'])
  // ohne Wiedervorlage (nicht gesendet) erinnert der Vertrieb weiter
  const noFollow = cases.map((c) => (c.id === 'd' ? { ...c, offer: { id: 'o1', state: 'offen' } } : c))
  assert.ok(ids(dueCases(noFollow, today, { offerHandled: (c) => c.offer?.state === 'offen' && !!c.offer.followUp })).includes('d:schritt'))
  // erledigte Wiedervorlage zählt nicht als Erinnerung der Fakturierung
  assert.equal(offerSnapshot({ id: 'x', number: 'AN-1' }, { state: 'offen', net: 1, followUp: { date: '2026-11-01', done: true } }).followUp, undefined)
  assert.equal(offerSnapshot({ id: 'x', number: 'AN-1' }, { state: 'offen', net: 1, followUp: { date: '2026-11-01' } }).followUp, '2026-11-01')
  const a = dueCases(cases, today).find((d) => d.case.id === 'a')
  assert.equal(a.overdue, 2)
  assert.equal(dueCases(cases, today).find((d) => d.case.id === 'f').overdue, 0)
  assert.equal(workdayAfter('2026-11-13', 1), '2026-11-16') // Freitag → Montag
})

test('Übergabe an die Kalkulation: Flächen aus den Räumen, Ergebnis zurück in den Fall', () => {
  const { areas, skipped } = calcAreasFromRooms(rooms)
  assert.equal(areas.length, 3)
  assert.deepEqual(areas[0], { id: 'f-r1', name: 'Büros · Teppich, textil', type: 'buero', m2: 300, perWeek: 5 })
  assert.deepEqual(skipped, [{ name: 'Archiv', missing: ['Fläche'] }])
  const calc = calculate({ areas, settings: {}, wage: 12.5 })
  const sum = calcSummary(calc, { at: AT, by: 'Petra' })
  assert.deepEqual(Object.keys(sum).sort(), ['at', 'by', 'gross', 'hours', 'net', 'perM2', 'totalM2'])
  assert.ok(!('rate' in sum) && !('margin' in sum), 'keine Löhne und Margen im Fall')
  const c = applyCalc(base({ stage: 'besichtigt', monthly: '' }), sum)
  assert.equal(c.stage, 'kalkuliert')
  assert.equal(c.monthly, sum.net)
  assert.match(c.history.at(-2).text, /^Kalkulation: .* je Monat/)
  // eingetragener Umsatz bleibt, spätere Stufe bleibt
  const c2 = applyCalc(base({ stage: 'angebot', monthly: 999 }), sum)
  assert.equal(c2.monthly, 999)
  assert.equal(c2.stage, 'angebot')
  // aus der Kalkulation übernommener Umsatz folgt einer neuen Kalkulation
  const c3 = applyCalc(c, { ...sum, net: sum.net + 100 })
  assert.equal(c3.monthly, sum.net + 100)
  assert.equal(applyCalc({ ...c, monthly: 777 }, { ...sum, net: 5 }).monthly, 777)
  assert.deepEqual(roomTotals(rooms), { count: 4, m2: 390, missingM2: 1, missingFreq: 0 })
})

test('Angebot: Positionen aus der Kalkulation, Leistungsverzeichnis als Beilage, Fall findet sein Angebot', () => {
  const c = base({ id: 'vf9', no: 'VT-2026-009', title: 'Unterhaltsreinigung Kanzlei', visit: { rooms, date: '2026-11-05' }, calc: { net: 1890.4, hours: 80 } })
  let n = 0
  const lines = offerLines(c, { vat: 20, newId: () => `l${++n}` })
  assert.deepEqual(lines.map((l) => l.type || 'item'), ['title', 'item', 'text'])
  assert.equal(lines[1].price, 1890.4)
  assert.equal(lines[1].unit, 'Monat')
  assert.match(lines[1].text, /laut Leistungsverzeichnis \(390 m²\)/)
  assert.match(lines[2].text, /4 Bereichen: siehe Anlage/)
  const f = offerDraftFields(c, { vat: 20, newId: () => 'x', customerName: 'Kanzlei Beispiel KG' })
  assert.deepEqual(Object.keys(f.source).sort(), ['beilage', 'caseId', 'no', 'type'])
  assert.equal(f.source.type, 'vertrieb')
  assert.equal(f.source.beilage.customer, 'Kanzlei Beispiel KG')
  assert.equal(f.source.beilage.rooms.length, 4)
  assert.equal(f.source.beilage.rooms[0].freq, 'täglich (Mo–Fr)')
  assert.deepEqual(f.source.beilage.rooms[0].tasks, ['Papierkörbe leeren', 'freie Arbeitsflächen feucht wischen', 'Boden saugen bzw. feucht wischen'])
  assert.equal(f.source.beilage.rooms[3].freq, '1× pro Woche')
  assert.ok(!JSON.stringify(f.source.beilage).includes('1890'), 'keine Preise in der Beilage')
  const docs = [
    { id: 'a1', kind: 'angebot', date: '2026-11-01', source: { type: 'vertrieb', caseId: 'vf9' } },
    { id: 'a2', kind: 'angebot', date: '2026-11-08', source: { type: 'vertrieb', caseId: 'vf9' } },
    { id: 'r1', kind: 'rechnung', date: '2026-11-09', source: { type: 'vertrieb', caseId: 'vf9' } },
    { id: 'a3', kind: 'angebot', date: '2026-11-09', source: { type: 'vertrieb', caseId: 'anderer' } },
  ]
  assert.equal(offerOfCase(c, docs).id, 'a2')
  assert.equal(offerOfCase(base({ offer: { id: 'x9' } }), [{ id: 'x9', kind: 'angebot' }]).id, 'x9')
  assert.equal(offerOfCase(base(), docs), null)
  assert.match(lvText(c), /^Büros \(300 m²\): täglich \(Mo–Fr\); Papierkörbe leeren/)
  assert.equal(lvSnapshot(c).totalM2, 390)
})

test('Stand des Angebots zurück in den Fall: festgeschrieben, angenommen (online), abgelehnt; Hand-Stand bleibt', () => {
  const doc = { id: 'a1', number: '', date: '2026-11-01', validUntil: '2026-12-01', sent: [] }
  let c = base({ stage: 'kalkuliert', calc: { net: 900 } })
  let r = syncOffer(c, offerSnapshot(doc, { state: 'entwurf', net: 900 }), { at: AT, by: 'P' })
  assert.ok(r.changed && r.case.stage === 'kalkuliert' && r.case.offer.state === 'entwurf')
  assert.equal(r.case.history.at(-1).text, 'Angebot als Entwurf angelegt')
  c = r.case
  r = syncOffer(c, offerSnapshot({ ...doc, number: 'AN-2026-0007' }, { state: 'offen', net: 900 }), { at: AT })
  assert.equal(r.case.stage, 'angebot')
  assert.ok(r.case.history.some((h) => h.text === 'Angebot AN-2026-0007 festgeschrieben'))
  c = r.case
  // nichts geändert: kein Speichern
  assert.equal(syncOffer(c, offerSnapshot({ ...doc, number: 'AN-2026-0007' }, { state: 'offen', net: 900 })).changed, false)
  // gesendet und Wiedervorlage: nur die Momentaufnahme
  r = syncOffer(c, offerSnapshot({ ...doc, number: 'AN-2026-0007', sent: [{ at: AT }] }, { state: 'offen', net: 900, followUp: { date: '2026-11-16' } }), { at: AT })
  assert.ok(r.changed && r.case.offer.sent && r.case.offer.followUp === '2026-11-16' && r.case.stage === 'angebot')
  c = r.case
  // von Hand zurück auf „kalkuliert“: bleibt, solange sich am Angebot nichts ändert
  const manual = applyMove(c, 'kalkuliert', { at: AT })
  assert.equal(syncOffer(manual, c.offer).changed, false)
  // online angenommen
  const accepted = offerSnapshot({ ...doc, number: 'AN-2026-0007', sent: [{ at: AT }], acceptance: { at: '2026-11-12T08:00:00Z', name: 'Frau Muster' } }, { state: 'angenommen', net: 900, followUp: { date: '2026-11-16' } })
  r = syncOffer(c, accepted, { at: AT })
  assert.equal(r.case.stage, 'angenommen')
  assert.equal(r.case.wonAt, '2026-11-12')
  assert.match(r.case.history.at(-1).text, /online angenommen von Frau Muster/)
  // abgelehnt
  r = syncOffer(c, offerSnapshot({ ...doc, number: 'AN-2026-0007' }, { state: 'abgelehnt', net: 900 }), { at: AT })
  assert.ok(r.case.stage === 'abgelehnt' && r.case.lostReason === 'Angebot abgelehnt')
  // Angebot gelöscht: Momentaufnahme weg
  r = syncOffer(c, null)
  assert.ok(r.changed && !r.case.offer)
})

test('Rechte: Vertrieb für Vollzugriff und Objektleitung; Kalkulation, Fakturierung, Objekte je eigenes Recht', () => {
  const access = { planners: ['office@cleanos.at'] }
  const role = (id) => resolveAccess({ roleClaims: [id], access, strict: true })
  const full = salesRights(role('disposition'))
  assert.ok(Object.values(full).every(Boolean))
  const ol = salesRights(role('objektleitung'))
  assert.ok(ol.view && ol.edit && ol.termin)
  assert.ok(!ol.calc && !ol.offer && !ol.customer && !ol.contract && !ol.recurring && !ol.fakView && !ol.object, JSON.stringify(ol))
  for (const id of ['buchhaltung', 'objektmanagement', 'objektservice', 'lager', 'vorarbeiter', 'mattenwechsel', 'mattenfahrer', 'lohnverrechnung', 'personalverwaltung', 'fuhrpark', 'pruefer', 'ableser', 'lesen']) {
    const r = salesRights(role(id))
    assert.ok(!r.view && !r.edit, id)
  }
  // Buchhaltung: Fakturierung ja (Angebote, Kunden), Vertrieb nicht
  const bh = salesRights(role('buchhaltung'))
  assert.ok(bh.offer && bh.customer && !bh.view)
  assert.ok(Object.values(salesRights(null)).every(Boolean), 'Browser-Modus ohne Rollen: alles')
  assert.ok(DEFAULT_ROLES.objektleitung.modules.includes('vertrieb') && DEFAULT_ROLES.objektleitung.edit.includes('vertrieb'))
  // Dateien: vertrieb/ (Fälle und Fotos) nur mit dem Modul; Objekte lesen, Fakturierung und Kalkulation nicht
  const r = dataRights(role('objektleitung'))
  assert.ok(r.read(MODULE_DOCS.vertrieb.path) && r.write(MODULE_DOCS.vertrieb.path) && r.write('vertrieb/fotos/2026/VT-2026-001_x.jpg'))
  assert.ok(r.read('objekte/objekte.json') && !r.read(MODULE_DOCS.fakturierung.path) && !r.read(MODULE_DOCS.kalkulation.path))
  for (const id of ['buchhaltung', 'objektmanagement', 'lager', 'lesen']) assert.ok(!dataRights(role(id)).read(MODULE_DOCS.vertrieb.path) && !dataRights(role(id)).read('vertrieb/fotos/2026/a.jpg'), id)
  // eigene Rolle nur mit dem Vertrieb: liest Objekte, sonst nichts
  const own = resolveAccess({ roleClaims: ['verkauf'], access: { ...access, roles: { verkauf: { label: 'Verkauf', modules: ['vertrieb'], edit: ['vertrieb'] } } }, strict: true })
  const ow = dataRights(own)
  assert.ok(ow.write(MODULE_DOCS.vertrieb.path) && ow.read('objekte/objekte.json') && !ow.read(MODULE_DOCS.fakturierung.path) && !ow.read(MODULE_DOCS.material.path))
  assert.ok(FOLDERS.some(([f, , p]) => f === 'vertrieb' && p === MODULE_DOCS.vertrieb.path))
  const rows = Object.fromEntries(folderRights(role('objektleitung')).map(([f, , x]) => [f, x]))
  assert.equal(rows.vertrieb, 'Bearbeiten')
  assert.equal(Object.fromEntries(folderRights(role('buchhaltung')).map(([f, , x]) => [f, x])).vertrieb, '')
})

test('Assistent: Schritte mit Stand, Rechte und Reihenfolge', () => {
  const all = salesRights(null)
  const c = base({ stage: 'angenommen', customerId: 'c1', offer: { id: 'a1', number: 'AN-1', state: 'angenommen' } })
  let s = wizardSteps(c, { customer: { id: 'c1', name: 'Kanzlei', group: 'Interessent' }, rights: all })
  assert.deepEqual(s.map((x) => `${x.id}:${x.state}`), ['kunde:open', 'objekt:open', 'dauerauftrag:open', 'vertrag:open', 'dispo:open'])
  assert.ok(isProspect({ group: ' interessent ' }) && !isProspect({ group: 'Gewerbe' }))
  s = wizardSteps({ ...c, objectId: 'o1', recurringIds: ['r1'], contractId: 'v1', dispo: { at: AT, text: 'Mo–Fr 2 h' } }, { customer: { id: 'c1', name: 'Kanzlei', group: '' }, rights: all, recurring: [{ id: 'r1' }], contract: { id: 'v1', no: 'V-2026-004' }, object: { name: 'Kanzlei' } })
  assert.ok(s.every((x) => x.state === 'done'), JSON.stringify(s))
  // ohne Kunde: Dauerauftrag und Vertrag warten
  s = wizardSteps(base({ stage: 'angenommen', offer: { id: 'a1' } }), { rights: all })
  assert.deepEqual(s.map((x) => x.state), ['open', 'open', 'wait', 'wait', 'open'])
  // ohne Angebot: Dauerauftrag wartet
  assert.equal(wizardSteps(base({ stage: 'angenommen', customerId: 'c1' }), { customer: { id: 'c1', group: 'Interessent' }, rights: all })[2].state, 'wait')
  // Objektleitung: Kunde, Objekt, Dauerauftrag, Vertrag gesperrt mit Hinweis; Disposition geht
  const ol = salesRights(resolveAccess({ roleClaims: ['objektleitung'], access: {}, strict: true }))
  s = wizardSteps(c, { customer: null, rights: ol })
  assert.deepEqual(s.map((x) => x.state), ['blocked', 'blocked', 'blocked', 'blocked', 'open'])
  assert.ok(s[0].text.includes('Fakturierung') && s[1].text.includes('Stammdaten'))
})

test('Assistent: Kunde aus der Anfrage, Objekt mit Leistungsverzeichnis, Dauerauftrag aus dem Angebot, Vertrag mit Fristen', () => {
  const c = base({ no: 'VT-2026-001', visit: { rooms }, calc: { net: 1890, hours: 81.25 }, offer: { id: 'a1', number: 'AN-2026-0003' } })
  const cust = customerFromLead(c, { id: 'c9', customerNo: '10004', at: AT })
  assert.equal(cust.group, 'Interessent')
  assert.deepEqual([cust.name, cust.street, cust.zip, cust.city, cust.email, cust.contacts[0].name], ['Kanzlei Beispiel', 'Gasse 1', '5020', 'Salzburg', 'k@beispiel.example', 'Frau Muster'])
  assert.equal(customerFromLead(c, { id: 'c9', customerNo: '1', group: '' }).group, '')
  const obj = objectFromCase(c, { id: 'o9' })
  assert.deepEqual([obj.id, obj.name, obj.short, obj.address, obj.budgetHoursMonth], ['o9', 'Kanzlei', 'Kanzlei', 'Gasse 1, 5020 Salzburg', 81.3])
  assert.match(obj.instructions, /Büros \(300 m²\): täglich/)
  assert.ok(!('instructions' in objectFromCase(c, { id: 'o9', withInstructions: false })))
  const offer = { id: 'a1', title: 'Unterhaltsreinigung Kanzlei', lines: [{ id: 't', type: 'title', text: 'Unterhaltsreinigung' }, { id: 'l1', text: 'Unterhaltsreinigung lt. LV', qty: 1, unit: 'Monat', price: 1890, vat: 20 }, { id: 'l2', text: 'Grundreinigung einmalig', qty: 210, unit: 'm²', price: 2.9, vat: 20 }, { id: 'l3', type: 'optional', text: 'Glasreinigung', qty: 1, unit: 'Monat', price: 90 }, { id: 'x', type: 'text', text: 'siehe Anlage' }] }
  const { rec, skipped } = recurringFromOffer(offer, { id: 'rec9', customerId: 'c9', objectId: 'o9', startMonth: '2026-12' })
  assert.deepEqual([rec.interval, rec.startMonth, rec.customerId, rec.objectId, rec.active, rec.index.active], ['monat', '2026-12', 'c9', 'o9', true, false])
  assert.deepEqual(rec.lines.map((l) => [l.text, l.qty, l.unit, l.price]), [['Unterhaltsreinigung lt. LV', 1, 'Monat', 1890]])
  assert.deepEqual(skipped, ['Grundreinigung einmalig'])
  assert.equal(recurringFromOffer({ lines: [{ text: 'nur einmalig', qty: 1, unit: 'Pauschale', price: 5 }] }, { id: 'r' }).rec.lines.length, 0)
  assert.equal(firstMonth('2026-11-09'), '2026-12')
  assert.equal(firstMonth('2026-12-20'), '2027-01')
  assert.equal(firstMonth('2026-11-09', '2027-02-01'), '2027-02')
  const v = contractFromCase(c, { id: 'vt9', no: 'V-2026-004', customerId: 'c9', start: '2026-12-01', objectIds: ['o9'], at: AT, by: 'Petra' })
  assert.deepEqual(contractProblems(v).filter((p) => p.level === 'error'), [])
  assert.deepEqual([v.minMonths, v.notice.n, v.notice.unit, v.term, v.end], [12, 3, 'monat', 'quartal', ''])
  assert.match(v.scope, /Büros/)
  assert.match(v.note, /VT-2026-001, Angebot AN-2026-0003/)
  const st = contractStatus(v, '2026-11-09')
  assert.equal(st.status, 'laeuft')
  assert.equal(st.termin, '2027-12-31') // Mindestlaufzeit bis 30.11.2027, dann zum Quartalsende
})

test('Hinweis für die Disposition: Minuten je Wochentag, 14-tägig extra, Monatsstunden wie die Kalkulation', () => {
  const h = planHint(rooms)
  // Büros 300 m² / 200 m²/h = 90 min, WC 30 / 60 = 30 min, je +10 % Rüstzeit → 132 min an Mo–Fr
  assert.deepEqual(h.days.map((d) => d.minutes), [132, 132, 132, 132, 132, 0])
  assert.equal(h.biweekly, 26) // Stiege 60 / 150 = 24 min + 10 %
  assert.equal(h.weekMinutes, 660)
  const calc = calculate({ areas: calcAreasFromRooms(rooms).areas, settings: {}, wage: 10 })
  assert.ok(Math.abs(h.monthHours - calc.hours) < 0.02, `${h.monthHours} ≈ ${calc.hours}`)
  assert.match(h.text, /^Mo–Fr 2,2 h, 14-tägig 0,4 h; etwa \d+ h im Monat$/)
  assert.equal(planHint([]).text, 'Für einen Vorschlag fehlen Flächen und Häufigkeiten.')
  assert.deepEqual(planHint([{ name: 'A', type: 'buero', m2: 200, perWeek: 3 }], { setupPct: 0 }).days.map((d) => d.minutes), [60, 0, 60, 0, 60, 0])
  assert.equal(CALC_DEFAULTS.setupPct, 10)
})

test('Kennzahlen: Pipeline-Wert gewichtet, Abschlussquote, Dauer Anfrage → Auftrag, je Monat', () => {
  const months = [
    { key: '2026-09', from: '2026-09-01', to: '2026-09-30' },
    { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
    { key: '2026-11', from: '2026-11-01', to: '2026-11-30' },
  ]
  const cases = [
    base({ id: '1', stage: 'anfrage', monthly: 1000, requestDate: '2026-11-02' }),
    base({ id: '2', stage: 'angebot', monthly: 2000, probability: 80, requestDate: '2026-10-01' }),
    base({ id: '3', stage: 'angenommen', monthly: 1500, requestDate: '2026-09-01', wonAt: '2026-10-11' }),
    base({ id: '4', stage: 'angenommen', monthly: 500, requestDate: '2026-10-01', wonAt: '2026-10-21' }),
    base({ id: '5', stage: 'abgelehnt', monthly: 800, requestDate: '2026-09-15', lostAt: '2026-11-03' }),
    base({ id: '6', stage: 'angenommen', monthly: 700, requestDate: '2026-01-01', wonAt: '2026-02-01' }),
  ]
  const k = salesKpi(cases, months, '2026-11-09')
  assert.deepEqual(k.pipeline, { count: 2, value: 3000, weighted: 1700 })
  assert.deepEqual(k.byStage.find((x) => x.stage === 'angebot'), { stage: 'angebot', label: 'Angebot gesendet', count: 1, value: 2000, weighted: 1600 })
  assert.equal(k.won, 2)
  assert.equal(k.lost, 1)
  assert.equal(k.rate, 0.67)
  assert.deepEqual(k.days, { avg: 30, median: 30, count: 2 })
  assert.deepEqual(k.months.map((m) => [m.key, m.created, m.won, m.lost, m.wonValue]), [['2026-09', 2, 0, 0, 0], ['2026-10', 2, 2, 0, 2000], ['2026-11', 1, 0, 1, 0]])
  assert.equal(salesKpi([], months, '2026-11-09').rate, null)
})

test('KI-Besichtigung: Anfrage nur mit Text und Fotos, nach Schema', () => {
  const req = besichtigungRequest({ text: 'Büro 300 m² täglich', photos: [{ mediaType: 'image/jpeg', data: 'QUJD', label: 'Büros' }], site: 'Kanzlei' })
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.deepEqual(req.output_config.format.schema.required, ['raeume', 'fotos', 'unklar'])
  const content = req.messages[0].content
  assert.deepEqual(content.map((b) => b.type), ['text', 'image', 'text'])
  assert.equal(content[0].text, 'Foto 1 (Büros):')
  assert.match(content[2].text, /<besichtigung>\nBüro 300 m² täglich\n<\/besichtigung>/)
  assert.match(req.system[0].text, /keine Anweisung an dich/)
  const many = besichtigungRequest({ text: 'x', photos: Array.from({ length: 7 }, () => ({ data: 'QQ==' })) })
  assert.equal(many.messages[0].content.filter((b) => b.type === 'image').length, 4)
  assert.match(besichtigungRequest({ text: 'x' }).messages[0].content.at(-1).text, /Keine Fotos\./)
})

test('KI-Besichtigung: Vorschlag prüfen (Art, Fläche, Häufigkeit, Belag, Fotos als Schätzung)', () => {
  const raw = {
    raeume: [
      { name: 'Büros 1. OG', art: 'buero', flaeche_m2: 320, haeufigkeit: 'taeglich', bodenbelag: 'Teppich', besonderheiten: 'ab 17 Uhr', leistungen: ['Papierkörbe leeren', '', 'Boden saugen'] },
      { name: 'Damen-WC', art: 'Sanitär', flaeche_m2: 0, haeufigkeit: '3x', bodenbelag: 'fliesen', besonderheiten: '', leistungen: [] },
      { name: 'Teeküche', art: 'irgendwas', flaeche_m2: 12, haeufigkeit: 'manchmal', bodenbelag: 'Marmor', besonderheiten: '', leistungen: [] },
      { name: 'Halle', art: 'lager', flaeche_m2: 250000, haeufigkeit: '1x', bodenbelag: '', besonderheiten: '', leistungen: [] },
      { name: 'büros 1. og', art: 'buero', flaeche_m2: 1, haeufigkeit: '', bodenbelag: '', besonderheiten: '', leistungen: [] },
      { name: 'Lager hinten', art: '', flaeche_m2: -5, haeufigkeit: '14-taegig', bodenbelag: 'Estrich', besonderheiten: '', leistungen: [] },
    ],
    fotos: [{ foto: 1, raum: 'Büros 1. OG', bodenbelag: 'teppich', verschmutzung: 'Mittel', hinweis: 'Flecken beim Fenster' }, { foto: 9, raum: '', bodenbelag: '', verschmutzung: '', hinweis: '' }, { foto: 2, raum: 'WC', bodenbelag: 'x', verschmutzung: 'sehr', hinweis: '' }],
    unklar: 'Fläche des WC nicht genannt',
  }
  const res = checkBesichtigung(raw)
  assert.deepEqual(res.rooms.map((r) => [r.name, r.type, r.m2, r.perWeek, r.floor]), [
    ['Büros 1. OG', 'buero', 320, 5, 'teppich'],
    ['Damen-WC', 'sanitaer', 0, 3, 'fliesen'],
    ['Teeküche', 'kueche', 12, 0, 'stein'],
    ['Halle', 'lager', 0, 1, ''],
    ['Lager hinten', 'lager', 0, 0.5, 'beton'],
  ])
  assert.deepEqual(res.rooms[0].tasks, ['Papierkörbe leeren', 'Boden saugen'])
  assert.deepEqual(res.rooms[0].flags, [])
  assert.deepEqual(res.rooms[1].flags, ['Fläche nicht genannt'])
  assert.deepEqual(res.rooms[2].flags, ['Häufigkeit nicht genannt', 'Art geschätzt: Küche, Teeküche'])
  assert.match(res.rooms[3].flags[0], /unplausibel, nicht übernommen/)
  assert.match(res.rooms[4].flags[0], /unplausibel/)
  assert.deepEqual(res.photos, [
    { index: 1, room: 'Büros 1. OG', floor: 'teppich', soil: 'mittel', note: 'Flecken beim Fenster', estimate: true },
    { index: 2, room: 'WC', floor: '', soil: '', note: '', estimate: true },
  ])
  assert.ok(res.problems.some((p) => p.level === 'warning' && /3 Räume ohne Fläche/.test(p.text)))
  assert.ok(res.problems.some((p) => /Unklar laut KI: Fläche des WC/.test(p.text)))
  assert.ok(res.problems.some((p) => /Schätzungen/.test(p.text)))
  assert.ok(checkBesichtigung({}).problems.some((p) => p.level === 'error'))
  assert.ok(checkBesichtigung('Unsinn').rooms.length === 0)
  assert.deepEqual([typeOf('', 'Stiegenhaus Nord').type, typeOf('Foyer').type, typeOf('', 'Zimmer 3').type], ['stiege', 'eingang', 'sonst'])
  assert.deepEqual(['täglich', 'Mo-Sa', 'zweimal', 'monatlich', 'quartalsweise', 'alle 2 Wochen', ''].map(freqOf), [5, 6, 2, 12 / 52, 4 / 52, 0.5, 0])
})

test('KI-Vorschlag übernehmen: nur gewählte, gleichnamige nur ergänzen, Fotos setzen leeren Belag', () => {
  const existing = [{ id: 'a', name: 'Büros 1. OG', type: 'buero', m2: 0, perWeek: 5, floor: '', notes: '' }, { id: 'b', name: 'WC', type: 'sanitaer', m2: 25, perWeek: 5, floor: 'fliesen', notes: 'neu verfliest' }]
  const suggested = checkBesichtigung({ raeume: [{ name: 'büros 1. og', art: 'buero', flaeche_m2: 320, haeufigkeit: '3x', bodenbelag: 'teppich', besonderheiten: 'ab 17 Uhr', leistungen: ['Saugen'] }, { name: 'Küche', art: 'kueche', flaeche_m2: 12, haeufigkeit: 'taeglich', bodenbelag: '', besonderheiten: '', leistungen: [] }], fotos: [], unklar: '' }).rooms
  const res = mergeRooms(existing, suggested, { photos: [{ index: 1, room: '', floor: 'stein', soil: 'stark', note: 'Kalk' }], photoRoom: { 1: 'b' } })
  assert.deepEqual([res.added, res.filled], [1, 1])
  const buero = res.rooms.find((r) => r.id === 'a')
  assert.deepEqual([buero.m2, buero.perWeek, buero.floor, buero.notes, buero.tasks, buero.ki], [320, 5, 'teppich', 'ab 17 Uhr', ['Saugen'], true])
  const wc = res.rooms.find((r) => r.id === 'b')
  assert.deepEqual([wc.floor, wc.soil, wc.notes], ['fliesen', 'stark', 'neu verfliest; Foto (Schätzung): Kalk'])
  assert.ok(res.rooms.at(-1).name === 'Küche' && res.rooms.at(-1).ki && !('flags' in res.rooms.at(-1)))
  assert.equal(existing[0].m2, 0, 'Eingabe bleibt unverändert')
})
