// Mattenwechsel P10b: Fahrerseite am Webspace für Fahrer ohne Microsoft-Konto (core/matten-webspace.js): veröffentlichte
// Tour ohne Preise und Kundenstamm, Unterschrift vom Webspace, Abbildung Webspace-Meldung → Stopp mit denselben
// Rechenkernen wie die Fahreransicht, Idempotenz, Zusammenführen. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { finishStop, isFinal, mergeTour, placementsOf, setStopStatus } from '../src/core/matten-fahrt.js'
import { stopsFromJobs } from '../src/core/matten-tour.js'
import { normalizeDrivers } from '../src/core/matten-touren.js'
import { applyWebEvents, cleanWebEvent, eventsByTour, isWebDriver, tourLinkMessage, TOUR_LINK_TEXTS, tourOnWebspace, WEB_PHOTO_START, webDriverProblem, webDriversPayload, webIdentity, webLink, webPhotoTargets, webSignatureSvg, webTourPayload, withWebspace } from '../src/core/matten-webspace.js'
import { LANGUAGES } from '../src/core/sprachen.js'

const DAY = '2026-11-09'
const unix = (h, m = 0) => Date.parse(`${DAY}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`) / 1000 // Wien = UTC+1
const HASH = 'a'.repeat(64)
const gross = { articleId: 'a-m1', name: '85 × 150 cm, grau', size: '85 × 150 cm', color: 'grau', price: 4.9 }
const klein = { articleId: 'a-m2', name: '60 × 90 cm, navy', size: '60 × 90 cm', color: 'navy' }
const hv = { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', no: '10001', deliveryNoteEmail: 'lieferschein@hv-beispiel.example' }
const ah = { id: 'c2', name: 'Autohaus Muster KG', no: '10002' }
const objects = [
  { id: 'o1', name: 'Wohnanlage Beispielweg', address: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055 },
  { id: 'o2', name: 'Autohaus Musterstraße', address: 'Musterstraße 3, 5020 Salzburg' },
]
const lp = (id, objectId, customer, mats, extra = {}) => ({ id, objectId, customerId: customer.id, customer, name: id, active: true, mats, intervalDays: 14, startDate: '2026-10-26', rule: 'rhythmus', ...extra })
const placements = [
  lp('Haupteingang', 'o1', hv, [{ ...gross, qty: 2 }], { floor: 'EG', access: 'Schlüssel beim Hausbesorger', hint: 'Alte Matten in den Bus', window: { from: '08:00', to: '12:00', note: 'nur vormittags' } }),
  lp('Stiege 2', 'o1', hv, [{ ...klein, qty: 1 }]),
  lp('Tiefgarage', 'o1', hv, [{ ...gross, qty: 1 }, { ...klein, qty: 2 }]),
  lp('Schauraum', 'o2', ah, [{ ...gross, qty: 3 }]),
]
const job = (placementId) => ({ key: `${placementId}:${DAY}`, placementId, due: DAY, status: 'geplant' })

/** Freigegebene Tour für den Fahrer ohne Konto (zwei Stopps: o1 mit 3 Liegeplätzen, o2). */
function tour(extra = {}) {
  const stops = stopsFromJobs({ jobs: placements.map((p) => job(p.id)), placements, objects, date: DAY, customers: [hv, ah] })
  const order = ['st-o1', 'st-o2']
  const t = { schema: 1, id: 'mtwebweb000001', date: DAY, driverId: 'e7', driverName: 'Ivo Beispiel', vehicleLabel: 'S-MW 1 · Kastenwagen', status: 'freigegeben', order, stops: order.map((id) => stops.find((s) => s.id === id)), createdAt: `${DAY}T05:00:00.000Z`, updatedAt: `${DAY}T05:00:00.000Z`, updatedBy: 'Büro', ...extra }
  t.stops[0].times = { arrival: '08:15' }
  // was nicht an den Webspace darf: Preise, Kundennummer, Lieferschein-Mail, Einsatz-Schlüssel
  t.stops[0].items[0].price = 4.9
  t.route = { provider: 'luftlinie', km: 12.5, depot: { name: 'Betriebshof', address: 'Hofweg 1' } }
  return withWebspace(t, { hash: HASH, name: 'Ivo Beispiel', lang: 'tr' })
}
const NOW = `${DAY}T15:00:00.000Z`
const PFAD = 'M10 10L50 60L90 20L140 120M200 40L260 90'

const abschluss = (extra = {}, daten = {}) => ({
  id: 'abschluss0001aa',
  art: 'abschluss',
  tour: 'mtwebweb000001',
  stopp: 'st-o1',
  zeit: unix(8, 40),
  eingang: unix(8, 41),
  fahrer: 'Ivo Beispiel',
  daten: {
    liegeplaetze: [
      { id: 'Haupteingang', ergebnis: 'gewechselt', mengen: [{ i: 0, ist: 1 }], grund: '', bemerkung: 'Matte stark verschmutzt' },
      { id: 'Stiege 2', ergebnis: 'gewechselt', mengen: [{ i: 1, ist: 1 }], grund: '', bemerkung: '' },
      { id: 'Tiefgarage', ergebnis: 'nicht-moeglich', mengen: [], grund: 'kein Zugang', bemerkung: '' },
    ],
    ausnahme: '',
    notiz: 'Hausbetreuung informiert',
    unterschrift: { name: 'Erika Muster', funktion: 'Hausbetreuung', pfad: PFAD },
    ohne: null,
    ...daten,
  },
  fotos: [{ datei: 'abschluss0001aa-1.jpg', liegeplatz: 'Haupteingang', groesse: 120000 }, { datei: 'abschluss0001aa-2.jpg', liegeplatz: 'Haupteingang', groesse: 90000 }],
  ...extra,
})

// ---------------------------------------------------------------- Veröffentlichen

/** Alle Schlüssel eines Objekts (rekursiv). */
const keysOf = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((v) => keysOf(v, out))
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) out.add(k), keysOf(v, out)
  return out
}

test('Veröffentlichen: Tour für den Webspace nur mit dem Nötigen, ohne Preise und Kundenstammdaten', () => {
  const t = tour()
  const p = webTourPayload(t, webIdentity({ webspace: true, name: 'Ivo Beispiel', lang: 'tr', web: { hash: HASH } }))
  assert.deepEqual(Object.keys(p).sort(), ['datum', 'fahrer', 'fahrzeug', 'id', 'ladeliste', 'status', 'stopps'])
  assert.deepEqual(p.fahrer, { hash: HASH, name: 'Ivo Beispiel', sprache: 'tr' })
  assert.equal(p.fahrzeug, 'S-MW 1 · Kastenwagen')
  // Reihenfolge, Stopp mit Kunde (nur Name), Objekt, Adresse, Koordinaten, Zeitfenster, Ankunft
  assert.deepEqual(p.stopps.map((s) => s.id), ['st-o1', 'st-o2'])
  const s1 = p.stopps[0]
  assert.deepEqual({ kunde: s1.kunde, objekt: s1.objekt, adresse: s1.adresse, lat: s1.lat, lon: s1.lon, ankunft: s1.ankunft, fenster: s1.fenster, status: s1.status }, { kunde: 'Hausverwaltung Beispiel GmbH', objekt: 'Wohnanlage Beispielweg', adresse: 'Beispielweg 12, 5020 Salzburg', lat: 47.8095, lon: 13.055, ankunft: '08:15', fenster: { von: '08:00', bis: '12:00', hinweis: 'nur vormittags' }, status: 'geplant' })
  assert.equal(p.stopps[1].lat, null, 'ohne Koordinaten: Navigation über die Adresse')
  // Liegeplätze mit Stockwerk, Zugang, Hinweis; Matten mit Index in stop.items (für die Rückmeldung der Menge)
  assert.deepEqual(s1.liegeplaetze.map((l) => [l.id, l.matten.map((m) => [m.i, m.bezeichnung, m.soll])]), [
    ['Haupteingang', [[0, '85 × 150 cm, grau', 2]]],
    ['Stiege 2', [[1, '60 × 90 cm, navy', 1]]],
    ['Tiefgarage', [[2, '85 × 150 cm, grau', 1], [3, '60 × 90 cm, navy', 2]]],
  ])
  assert.deepEqual([s1.liegeplaetze[0].stockwerk, s1.liegeplaetze[0].zugang, s1.liegeplaetze[0].hinweis], ['EG', 'Schlüssel beim Hausbesorger', 'Alte Matten in den Bus'])
  assert.deepEqual(p.ladeliste, [
    { groesse: '60 × 90 cm', farbe: 'navy', bezeichnung: '60 × 90 cm, navy', stueck: 3, stopps: 1 },
    { groesse: '85 × 150 cm', farbe: 'grau', bezeichnung: '85 × 150 cm, grau', stueck: 6, stopps: 2 },
  ])
  // keine Preise, keine Kundennummer, keine E-Mail, keine Artikel, keine Einsatz-Schlüssel, kein Betriebshof
  const keys = keysOf(p)
  for (const k of ['price', 'preis', 'vat', 'no', 'customerId', 'deliveryNoteEmail', 'email', 'articleId', 'jobKey', 'alsoJobKeys', 'route', 'depot', 'code', 'driverId']) assert.ok(!keys.has(k), `${k} gehört nicht an den Webspace`)
  const json = JSON.stringify(p)
  for (const x of ['10001', 'lieferschein@', '4.9', 'Hofweg']) assert.ok(!json.includes(x), `${x} gehört nicht an den Webspace`)
  // ohne Kennung des Fahrers nichts
  assert.equal(webTourPayload(t, null), null)
  assert.equal(webTourPayload(t, { hash: 'kurz' }), null)
})

test('Fahrer ohne Konto: Kennung, Link, Liste für den Webspace (nur Hashwerte), Einstellungen behalten die Felder', () => {
  const code = 'IvoCode1234567890abc'
  const drivers = normalizeDrivers([
    { id: 'd1', name: 'Ivo Beispiel', webspace: true, lang: 'tr', web: { from: 'eigen', code, hash: HASH } },
    { id: 'd2', name: 'Petra Konto', email: 'petra@beispiel.example' },
    { id: 'd3', name: 'Ana Plan', employeeId: 'e9', webspace: true, lang: 'ro', web: { from: 'mein-plan', code: 'NichtSpeichern12345678', hash: 'b'.repeat(64) } },
    { id: 'd4', name: 'Ohne Link', webspace: true, lang: 'xx', web: { hash: 'kaputt' } },
  ])
  const by = Object.fromEntries(drivers.map((d) => [d.id, d]))
  assert.deepEqual(by.d1.web, { from: 'eigen', hash: HASH, code })
  assert.deepEqual(by.d3.web, { from: 'mein-plan', hash: 'b'.repeat(64) }, 'Link von Plan am Handy: nur der Hashwert')
  assert.equal(by.d4.lang, 'de')
  assert.equal(by.d4.web, undefined)
  assert.ok(isWebDriver(by.d1) && !isWebDriver(by.d2))
  assert.equal(webDriverProblem(by.d1), '')
  assert.match(webDriverProblem(by.d4), /noch keinen Link/)
  assert.equal(webDriverProblem(by.d2), '')
  assert.deepEqual(webDriversPayload(drivers), [{ hash: 'b'.repeat(64), name: 'Ana Plan', sprache: 'ro' }, { hash: HASH, name: 'Ivo Beispiel', sprache: 'tr' }])
  assert.ok(!JSON.stringify(webDriversPayload(drivers)).includes(code), 'der Code geht nie an den Webspace')
  assert.deepEqual(webIdentity(by.d1), { hash: HASH, name: 'Ivo Beispiel', lang: 'tr' })
  assert.deepEqual(webIdentity(by.d3, { hash: 'c'.repeat(64) }).hash, 'c'.repeat(64), 'frisch berechneter Hash geht vor')
  assert.equal(webIdentity(by.d2), null)
  assert.equal(webLink('https://app.beispiel.example/', code), `https://app.beispiel.example/mattentour.php?p=${code}`)
  // Tour mit Kennung; ohne wieder weg
  const t = tour()
  assert.ok(tourOnWebspace(t))
  assert.ok(!tourOnWebspace(withWebspace(t, null)))
})

test('Link-Nachricht: in jeder Sprache der App, mit Link und Vornamen', () => {
  assert.deepEqual(Object.keys(TOUR_LINK_TEXTS), LANGUAGES.map((l) => l.id))
  for (const l of LANGUAGES) {
    const m = tourLinkMessage(l.id, { name: 'Ivo Beispiel', product: 'Cleanos App', link: 'https://x.example/mattentour.php?p=A' })
    assert.ok(m.subject && m.text.includes('https://x.example/mattentour.php?p=A') && m.text.includes('Ivo') && !m.text.includes('Beispiel') && !/\{\w+\}/.test(m.text), l.id)
  }
  assert.match(tourLinkMessage('tr', { name: 'Ivo', product: 'App', link: 'L' }).subject, /paspas/)
  assert.equal(tourLinkMessage('xx', { name: 'Ivo', product: 'App', link: 'L' }).subject, TOUR_LINK_TEXTS.de.betreff)
})

test('Unterschrift vom Webspace: Pfad im Feld 600 × 200 → SVG wie in der App (300 × 100), Unlesbares leer', () => {
  const svg = webSignatureSvg(PFAD)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 300 100" width="300" height="100"><path d="M5 5L25 30L45 10L70 60M100 20L130 45" /)
  assert.equal(webSignatureSvg('M1 1'), '', 'zu wenig gezeichnet')
  assert.equal(webSignatureSvg('M1 1L2 2"/><script>'), '')
  assert.equal(webSignatureSvg('M1 1L700 2L3 3L4 4'), '', 'außerhalb des Felds')
  assert.equal(webSignatureSvg(''), '')
})

// ---------------------------------------------------------------- Meldungen übernehmen

test('Meldung prüfen: unbrauchbare fallen weg, Felder begrenzt', () => {
  assert.equal(cleanWebEvent(null), null)
  assert.equal(cleanWebEvent({ id: 'X!', art: 'start', tour: 'mtwebweb000001' }), null)
  assert.equal(cleanWebEvent({ id: 'abcdefgh1', art: 'loeschen', tour: 'mtwebweb000001' }), null)
  assert.equal(cleanWebEvent({ id: 'abcdefgh1', art: 'unterwegs', tour: 'mtwebweb000001' }), null, 'unterwegs ohne Stopp')
  assert.equal(cleanWebEvent({ id: 'abcdefgh1', art: 'start', tour: '../x' }), null)
  const ev = cleanWebEvent(abschluss({}, { ausnahme: 'boese', notiz: 'x'.repeat(900) }))
  assert.equal(ev.daten.ausnahme, '')
  assert.equal(ev.daten.notiz.length, 500)
  assert.deepEqual(cleanWebEvent({ ...abschluss(), fotos: [{ datei: '../../etc/passwd', liegeplatz: 'Haupteingang' }] }).fotos, [])
  const byTour = eventsByTour([abschluss(), { id: 'start00001', art: 'start', tour: 'mtanderetour01' }, { id: 'kaputt' }])
  assert.deepEqual([...byTour.keys()], ['mtwebweb000001', 'mtanderetour01'])
})

test('Webspace-Meldung → Stopp: Start, unterwegs, Abschluss mit Mengen, nicht möglich, Bemerkung, Fotos, Unterschrift', () => {
  const t0 = tour()
  const start = { id: 'start000001aa', art: 'start', tour: t0.id, zeit: unix(7, 5), eingang: unix(7, 5), fahrer: 'Ivo Beispiel' }
  const unterwegs = { id: 'unterwegs01aa', art: 'unterwegs', tour: t0.id, stopp: 'st-o1', zeit: unix(7, 10), eingang: unix(7, 10) }
  const r = applyWebEvents(t0, [abschluss(), unterwegs, start], { now: NOW })
  assert.deepEqual(r.applied, ['start000001aa', 'unterwegs01aa', 'abschluss0001aa'], 'in der Reihenfolge der Zeit am Handy')
  assert.deepEqual(r.skipped, [])
  const t = r.tour
  assert.equal(t.status, 'unterwegs')
  assert.equal(t.startedAt, `${DAY}T06:05:00.000Z`)
  assert.equal(t.startedBy, 'Ivo Beispiel')
  const s = t.stops[0]
  assert.equal(s.status, 'teilweise', 'zwei gewechselt, einer nicht möglich')
  assert.equal(s.finishedAt, `${DAY}T07:40:00.000Z`, 'Zeitpunkt am Handy')
  assert.equal(s.finishedBy, 'Ivo Beispiel')
  assert.equal(s.driverId, 'e7')
  assert.deepEqual(s.deliveryNote, { state: 'offen' }, 'wie in der App: Merker für den Lieferschein')
  assert.equal(s.confirmation, 'unterschrieben')
  assert.deepEqual([s.signature.name, s.signature.role, s.signature.at], ['Erika Muster', 'Hausbetreuung', `${DAY}T07:40:00.000Z`])
  assert.match(s.signature.svg, /viewBox="0 0 300 100"/)
  assert.equal(s.note, 'Hausbetreuung informiert')
  assert.deepEqual(s.totals, { planned: 6, actual: 2 })
  assert.deepEqual(s.web, { event: 'abschluss0001aa', at: `${DAY}T07:41:00.000Z` })
  const p = Object.fromEntries(placementsOf(s).map((x) => [x.placementId, x]))
  assert.equal(p.Haupteingang.status, 'gewechselt')
  assert.equal(p.Haupteingang.actual, 1)
  assert.equal(p.Haupteingang.deviation, -1, 'Menge mit Minus: Abweichung')
  assert.equal(p.Haupteingang.note, 'Matte stark verschmutzt')
  assert.equal(p.Tiefgarage.status, 'nicht-moeglich')
  assert.equal(p.Tiefgarage.reason, 'kein Zugang')
  assert.deepEqual(s.deviations.map((d) => [d.placementName, d.diff]), [['Haupteingang', -1], ['Tiefgarage', -1], ['Tiefgarage', -2]])
  // Fotos: feste Pfade wie in der App, ab Nummer 51
  assert.deepEqual(p.Haupteingang.photos.map((f) => f.path), [`matten/fotos/2026/Haupteingang/${DAY}_mtwebweb000001_51.jpg`, `matten/fotos/2026/Haupteingang/${DAY}_mtwebweb000001_52.jpg`])
  assert.deepEqual(r.uploads, [
    { id: 'abschluss0001aa', datei: 'abschluss0001aa-1.jpg', placementId: 'Haupteingang', path: `matten/fotos/2026/Haupteingang/${DAY}_mtwebweb000001_51.jpg` },
    { id: 'abschluss0001aa', datei: 'abschluss0001aa-2.jpg', placementId: 'Haupteingang', path: `matten/fotos/2026/Haupteingang/${DAY}_mtwebweb000001_52.jpg` },
  ])
  assert.equal(WEB_PHOTO_START, 51)
  assert.deepEqual(webPhotoTargets(t0, cleanWebEvent(abschluss())).map((x) => x.name), [`${DAY}_mtwebweb000001_51.jpg`, `${DAY}_mtwebweb000001_52.jpg`])
  // zweiter Stopp noch offen, Tour bleibt unterwegs; Kennungen gemerkt
  assert.equal(t.stops[1].status, 'geplant')
  assert.deepEqual(t.webspace.applied, ['start000001aa', 'unterwegs01aa', 'abschluss0001aa'])
  assert.equal(t.updatedAt, NOW)
})

test('Idempotenz: dieselbe Meldung zweimal ändert nichts, ein zweiter Abschluss überschreibt nicht', () => {
  const r1 = applyWebEvents(tour(), [abschluss()], { now: NOW })
  const r2 = applyWebEvents(r1.tour, [abschluss(), abschluss()], { now: '2026-11-09T16:00:00.000Z' })
  assert.deepEqual(r2.applied, [])
  assert.deepEqual(r2.done, ['abschluss0001aa', 'abschluss0001aa'], 'am Webspace trotzdem als übernommen melden')
  assert.equal(r2.tour, r1.tour, 'unverändert (dieselbe Tour)')
  // ein zweiter Abschluss (andere Kennung) für denselben Stopp: Stopp bleibt, Fotos kommen dazu, Hinweis
  const nochmal = abschluss({ id: 'abschluss0002bb', fotos: [{ datei: 'abschluss0002bb-1.jpg', liegeplatz: 'Stiege 2' }] }, { liegeplaetze: [{ id: 'Haupteingang', ergebnis: 'gewechselt', mengen: [{ i: 0, ist: 2 }] }] })
  const r3 = applyWebEvents(r1.tour, [nochmal], { now: NOW })
  assert.deepEqual(r3.applied, ['abschluss0002bb'])
  assert.deepEqual(r3.notes.map((n) => n.stopId), ['st-o1'])
  const s = r3.tour.stops[0]
  assert.equal(s.status, 'teilweise')
  assert.equal(s.finishedAt, r1.tour.stops[0].finishedAt)
  assert.equal(placementsOf(s).find((x) => x.placementId === 'Haupteingang').actual, 1, 'Menge des ersten Abschlusses bleibt')
  assert.equal(placementsOf(s).find((x) => x.placementId === 'Stiege 2').photos.length, 1)
  // im Büro schon abgeschlossen (nach einem Anruf): bleibt, wie es ist
  const buero = finishStop(setStopStatus(tour(), 'st-o2', 'in-bearbeitung', { now: `${DAY}T08:00:00.000Z`, by: 'Büro' }), 'st-o2', { outcome: 'nicht-durchgefuehrt', reason: 'telefonisch abgesagt', now: `${DAY}T08:00:00.000Z`, by: 'Büro' })
  const r4 = applyWebEvents(buero, [abschluss({ id: 'abschluss0003cc', stopp: 'st-o2', fotos: [] }, { liegeplaetze: [{ id: 'Schauraum', ergebnis: 'gewechselt', mengen: [] }] })], { now: NOW })
  assert.equal(r4.tour.stops[1].status, 'nicht-durchgefuehrt')
  assert.equal(r4.notes.length, 1)
})

test('Ausnahmen: Kunde nicht angetroffen ohne Unterschrift, Ausnahme passt nicht mehr, Stopp fehlt, Tour zurückgenommen', () => {
  // alle offen, Ausnahme „Kunde nicht angetroffen“, ohne Unterschrift (Grund vorbelegt am Webspace)
  const na = abschluss({ id: 'nichtda00001', stopp: 'st-o2', fotos: [] }, { liegeplaetze: [{ id: 'Schauraum', ergebnis: '', mengen: [] }], ausnahme: 'nicht-angetroffen', unterschrift: null, ohne: { grund: 'Kunde nicht angetroffen' }, notiz: '' })
  const r = applyWebEvents(tour(), [na], { now: NOW })
  const s = r.tour.stops[1]
  assert.equal(s.status, 'nicht-angetroffen')
  assert.equal(s.confirmation, 'ohne-unterschrift')
  assert.equal(s.unsigned.reason, 'Kunde nicht angetroffen')
  assert.equal(s.outcome, 'nicht-angetroffen')
  assert.deepEqual(s.deliveryNote, { state: 'offen' })
  assert.ok(isFinal(s))
  // am Webspace kannte der Fahrer einen Liegeplatz nicht (Tour inzwischen anders): Abschluss mit „Teilweise erledigt“
  const teil = abschluss({ id: 'teil0000001', fotos: [] }, { liegeplaetze: [{ id: 'Haupteingang', ergebnis: 'gewechselt', mengen: [] }], unterschrift: null, ohne: { grund: 'niemand vor Ort' } })
  const r2 = applyWebEvents(tour(), [teil], { now: NOW })
  assert.equal(r2.tour.stops[0].status, 'teilweise')
  assert.equal(r2.tour.stops[0].outcome, 'teilweise')
  // unlesbare Unterschrift: ohne Unterschrift mit Vermerk
  const kaputt = abschluss({ id: 'kaputt000001', fotos: [] }, { unterschrift: { name: 'Erika Muster', funktion: '', pfad: 'M1 1' } })
  assert.equal(applyWebEvents(tour(), [kaputt], { now: NOW }).tour.stops[0].unsigned.reason, 'Unterschrift am Webspace nicht lesbar')
  // Stopp fehlt, andere Tour, Tour wieder Entwurf: bleibt am Webspace
  const r3 = applyWebEvents(tour(), [abschluss({ id: 'fehlt000001', stopp: 'st-weg' }), abschluss({ id: 'andere00001', tour: 'mtanderetour01' })], { now: NOW })
  assert.deepEqual(r3.applied, [])
  assert.deepEqual(r3.skipped.map((x) => x.id), ['fehlt000001'])
  const r4 = applyWebEvents(tour({ status: 'entwurf' }), [abschluss()], { now: NOW })
  assert.deepEqual(r4.skipped.map((x) => x.reason), ['Die Tour ist nicht mehr freigegeben.'])
  assert.deepEqual(r4.uploads, [])
})

test('Zusammenführen: Meldung vom Webspace und gleichzeitige Änderung im Büro bleiben beide (mergeTour)', () => {
  const base = tour()
  const mine = applyWebEvents(base, [abschluss()], { now: NOW }).tour
  // Büro: Fahrer startet den zweiten Stopp in der App (z. B. im Büro mitgearbeitet) und ändert ein Feld der Tour
  const theirs = { ...setStopStatus(base, 'st-o2', 'unterwegs', { now: `${DAY}T09:00:00.000Z`, by: 'Büro' }), vehicleLabel: 'S-MW 2 · Ersatz' }
  const merged = mergeTour(base, mine, theirs)
  assert.equal(merged.stops[0].status, 'teilweise', 'Abschluss vom Webspace')
  assert.equal(merged.stops[1].status, 'unterwegs', 'Änderung des Büros')
  assert.equal(merged.vehicleLabel, 'S-MW 2 · Ersatz')
  assert.deepEqual(merged.webspace.applied, ['abschluss0001aa'])
  assert.equal(merged.status, 'unterwegs')
})
