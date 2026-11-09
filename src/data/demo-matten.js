// Beispieldaten für das Mattenwechsel-Modul (alles erfunden, keine echten Kunden oder Adressen):
//  - createMattenDemo(): einige Liegeplätze für die Vorschau im Browser-Modus (Kunden und Objekte der Beispieldaten),
//    mit einem erfundenen Betriebsurlaub zu Weihnachten
//  - createMattenJobsDemo(today, matten): gespeicherte Einsätze dazu (erledigt, überfällig, verschoben, ausgesetzt)
//  - MATTEN_ARTIKEL_BEISPIEL: Mattentypen als Artikel der Fakturierung (group 'Matten') für Tests
//  - werkzeugBeispiel(): Dateien des bisherigen Werkzeugs (Standorte.json, Kunden.json, Touren) im Format der
//    Fassung 2.4 – für den Test der Übernahme (test/matten-import.test.js) und die SharePoint-Attrappe der Browser-Tests.
//  - createMattenTourDemo(date): eine freigegebene Tour für die Fahreransicht im Browser-Modus (Matten-Touren)
//  - createMattenBestandDemo(today): kleiner Mattenbestand (Inventur, Wäscherei abgeholt und zurück) für „Matten-Bestand“

import { addDays } from '../core/dates.js'
import { matLabel } from '../core/invoicing.js'
import { applyJobAction, confirmedExchanges, planJobs } from '../core/matten-einsaetze.js'
import { jobDate, markDone } from '../core/matten-plan.js'
import { stopsFromJobs } from '../core/matten-tour.js'

/** Mattentypen wie in der Fakturierung (Artikelgruppe „Matten“, Größe, Farbe und Art als eigene Felder) – für Tests. */
export const MATTEN_ARTIKEL_BEISPIEL = [
  { id: 'a-mdemo1', articleNo: 'MA-85150-G', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 × 150 cm', color: 'grau', matKind: 'Standard', unit: 'Stk', price: 4.9, vat: 20 },
  { id: 'a-mdemo2', articleNo: 'MA-85120-N', group: 'Matten', name: 'Schmutzfangmatte 85 × 120 cm navy', size: '85 × 120 cm', color: 'navy', matKind: 'Standard', unit: 'Stk', price: 4.2, vat: 20 },
  { id: 'a-mdemo3', articleNo: 'MA-115200-G', group: 'Matten', name: 'Schmutzfangmatte 115 × 200 cm grau', size: '115 × 200 cm', color: 'grau', matKind: 'Standard', unit: 'Stk', price: 7.5, vat: 20 },
  { id: 'a-mdemo4', articleNo: 'MA-150250-G', group: 'Matten', name: 'Schmutzfangmatte 150 × 250 cm grau', size: '150 × 250 cm', color: 'grau', matKind: 'Standard', unit: 'Stk', price: 11.9, vat: 20 },
]

// Mattentypen der Beispieldaten der Fakturierung (demo-modules.js, a-fdemo6 und a-fdemo7): nur die Felder für die Kopie
const DEMO_TYPES = [
  { id: 'a-fdemo6', size: '85 × 150 cm', color: 'grau', matKind: 'Standard' },
  { id: 'a-fdemo7', size: '150 × 250 cm', color: 'anthrazit', matKind: 'Standard' },
]
export const MATTEN_DEMO_TYPE_IDS = DEMO_TYPES.map((t) => t.id)

const copy = (id) => {
  const a = DEMO_TYPES.find((x) => x.id === id)
  return { articleId: a.id, name: matLabel(a), size: a.size, color: a.color, matKind: a.matKind }
}
const stamp = { createdAt: '2026-11-02T08:00:00.000Z', createdBy: 'Beispieldaten', updatedAt: '2026-11-02T08:00:00.000Z', updatedBy: 'Beispieldaten' }

/** Erfundene Koordinaten der Beispiel-Objekte (Salzburg) für Liegeplätze und Touren der Vorschau. */
const DEMO_GEO = { o2: { lat: 47.7951, lon: 13.0186 }, o11: { lat: 47.8127, lon: 13.0329 } }
/** Betriebshof der Vorschau (erfunden, keine echte Adresse). */
const DEMO_DEPOT = { name: 'Betriebshof (Beispiel)', address: 'Beispielweg 1, 5020 Salzburg', lat: 47.7745, lon: 13.07 }
/** Fahrer der Vorschau (Kopie aus den Beispiel-Mitarbeitenden e2 und e4, Fahrzeuge aus dem Beispiel-Fuhrpark). */
const DEMO_DRIVERS = [
  { id: 'fd-demo1', employeeId: 'e2', name: 'Markus Huber', email: 'markus.huber@beispiel.example', start: '07:00', end: '15:30', vehicleId: 'v1', capacity: 30, active: true },
  { id: 'fd-demo2', employeeId: 'e4', name: 'Dragan Jović', email: 'dragan.jovic@beispiel.example', start: '07:00', end: '12:00', vehicleId: 'v2', active: true },
]

/**
 * Liegeplätze der Vorschau: Autohaus (2) und Versicherungsbüro (1), Gebiet „Salzburg Nord“, Mattentypen der Fakturierung,
 * Koordinaten (für die Tourenplanung); Betriebsurlaub zu Weihnachten (Wechsel entfällt), Betriebshof und zwei Fahrer.
 */
export function createMattenDemo() {
  const hv = { id: 'c-demo1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
  const ah = { id: 'c-demo2', name: 'Autohaus Maxglan Beispiel KG', no: '10002' }
  const geo = (objectId) => ({ ...DEMO_GEO[objectId], geoQuality: 'hand' })
  return {
    schema: 1,
    settings: { skip: 'entfaellt', closures: [{ from: '2026-12-24', to: '2026-12-26', reason: 'Betriebsurlaub Weihnachten' }], depot: { ...DEMO_DEPOT }, workday: { from: '07:00', to: '15:30' }, drivers: DEMO_DRIVERS.map((d) => ({ ...d })) },
    areas: [{ id: 'mg-demo1', name: 'Salzburg Nord', active: true, ...stamp }],
    placements: [
      { id: 'mw-demo1', objectId: 'o2', customerId: ah.id, customer: ah, name: 'Schauraum Eingang', floor: 'EG', access: 'offen ab 7 Uhr', hint: 'Alte Matten in den Bus, nicht in den Müllraum', active: true, mats: [{ ...copy('a-fdemo7'), qty: 2, owner: 'wir' }], intervalDays: 14, startDate: '2026-11-04', rule: 'rhythmus', workMinutes: 10, window: { from: '07:00', to: '09:00', note: 'vor Geschäftsöffnung' }, pauses: [], areaId: 'mg-demo1', ...geo('o2'), ...stamp },
      { id: 'mw-demo2', objectId: 'o2', customerId: ah.id, customer: ah, name: 'Werkstatt Kundenannahme', floor: 'EG', access: '', hint: '', active: true, mats: [{ ...copy('a-fdemo6'), qty: 1, owner: 'wir' }], intervalDays: 28, startDate: '2026-11-04', rule: 'rhythmus', workMinutes: 5, pauses: [{ from: '2026-12-23', to: '2027-01-06', reason: 'Betriebsurlaub' }], areaId: 'mg-demo1', ...geo('o2'), ...stamp },
      { id: 'mw-demo3', objectId: 'o11', customerId: hv.id, customer: hv, name: 'Eingang', floor: 'EG', access: 'Code an der Tür (siehe Schlüsselbuch)', hint: '', active: true, mats: [{ ...copy('a-fdemo6'), qty: 1, owner: 'kunde' }], intervalDays: 28, startDate: '2026-11-10', rule: 'rhythmus', workMinutes: 5, pauses: [], areaId: 'mg-demo1', ...geo('o11'), ...stamp },
    ],
  }
}

/** Erfundene Koordinaten der Beispiel-Objekte (Salzburg) für die Tour der Vorschau. */
const DEMO_TOUR_OBJECTS = [
  { id: 'o2', name: 'Autohaus Maxglan', address: '5020 Salzburg-Maxglan', ...DEMO_GEO.o2 },
  { id: 'o11', name: 'Versicherungsbüro Lehen', address: '5020 Salzburg-Lehen', ...DEMO_GEO.o11 },
]

/**
 * Tour für die Fahreransicht im Browser-Modus: am Tag date, freigegeben, Fahrer Markus Huber (Beispieldaten e2), zwei
 * Stopps aus den Liegeplätzen der Vorschau (Autohaus mit zwei Liegeplätzen, Versicherungsbüro mit einem). Fest, ohne
 * Routing; Zeiten erfunden. Ohne Preise (die Tour trägt nie Preise).
 */
export function createMattenTourDemo(date, { id = 'mtdemo00000001', driverEmail = 'markus.huber@beispiel.example' } = {}) {
  const demo = createMattenDemo()
  const jobs = demo.placements.map((p) => ({ key: `${p.id}:${date}`, placementId: p.id, due: date, status: 'geplant' }))
  const stops = stopsFromJobs({ jobs, placements: demo.placements, objects: DEMO_TOUR_OBJECTS, date })
  const times = [
    { arrival: '07:20', start: '07:20', departure: '07:35', wait: 0, travel: 20, km: 9.4 },
    { arrival: '07:47', start: '07:47', departure: '07:52', wait: 0, travel: 12, km: 3.1 },
  ]
  const ordered = [...stops].sort((a, b) => (a.objectId === 'o2' ? -1 : b.objectId === 'o2' ? 1 : 0)).map((s, i) => ({ ...s, times: times[i] || null }))
  const at = `${date}T05:30:00.000Z`
  return {
    schema: 1,
    id,
    date,
    driverId: 'e2',
    driverName: 'Markus Huber',
    driverEmail,
    vehicleId: 'v1',
    vehicleLabel: 'S-284 KL · VW Caddy',
    areaId: 'mg-demo1',
    status: 'freigegeben',
    order: ordered.map((s) => s.id),
    route: { provider: 'luftlinie', km: 24.6, minutes: 47, start: '07:00', end: '08:15', work: 20, wait: 0, load: 4, shift: { from: '07:00', to: '15:30' }, depot: { ...DEMO_DEPOT } },
    stops: ordered,
    createdAt: at,
    createdBy: 'Beispieldaten',
    updatedAt: at,
    updatedBy: 'Beispieldaten',
    releasedAt: at,
    releasedBy: 'Beispieldaten',
  }
}

/**
 * Gespeicherte Einsätze der Vorschau (matten/einsaetze-<Jahr>.json), relativ zu heute: geplant drei Wochen zurück und
 * fünf Wochen voraus; Vergangenes erledigt bis auf einen überfälligen Wechsel (Werkstatt), der nächste Wechsel im
 * Schauraum um einen Tag verschoben, der übernächste ausgesetzt (Inventur).
 */
export function createMattenJobsDemo(today, matten = createMattenDemo()) {
  const by = 'Beispieldaten'
  const now = `${today}T07:00:00.000Z`
  const done = confirmedExchanges({ placements: matten.placements })
  let { jobs } = planJobs({ doc: matten, done, von: addDays(today, -21), bis: addDays(today, 34), now, by })
  const past = jobs.filter((j) => j.status === 'geplant' && jobDate(j) < today)
  const late = past.filter((j) => j.placementId === 'mw-demo2').at(-1)
  jobs = jobs.map((j) => (past.includes(j) && j !== late ? { ...markDone(j, j.due, { now, by }), id: j.key } : j))
  const next = jobs.filter((j) => j.placementId === 'mw-demo1' && j.status === 'geplant' && j.due >= today)
  const change = (key, action, opts) => {
    const r = applyJobAction(jobs, [key], action, { today, now, by, ...opts })
    jobs = jobs.map((j) => r.changed.find((c) => c.key === j.key) || j)
  }
  if (next[0]) change(next[0].key, 'verschieben', { date: addDays(next[0].due, 1), reason: 'Kunde bittet um einen Tag später' })
  if (next[1]) change(next[1].key, 'aussetzen', { reason: 'Inventur im Autohaus' })
  return jobs
}

/**
 * Mattenbestand der Vorschau (matten/bestand.json, P17), relativ zu heute: Inventur vor 14 Tagen, Wäscherei vor 10 Tagen
 * abgeholt und vor 6 Tagen zurück (eine Matte Schwund), Mindestbestand je Typ, Wäscherei mit erfundener Adresse.
 */
export function createMattenBestandDemo(today) {
  const by = 'Beispieldaten'
  const at = (d, hm) => `${d}T${hm}:00.000Z`
  const line = (id, extra) => ({ articleId: id, name: copy(id).name, ...extra })
  const d14 = addDays(today, -14)
  const d10 = addDays(today, -10)
  const d6 = addDays(today, -6)
  return {
    schema: 1,
    settings: { min: { 'a-fdemo6': 10, 'a-fdemo7': 4 }, laundry: { name: 'Wäscherei Beispiel', email: 'annahme@waescherei-beispiel.example', contact: 'Frau Muster' }, days: 7 },
    bookings: [
      { id: 'mwb-demo1', kind: 'inventur', date: d14, at: at(d14, '15:00'), by, note: 'Startbestand', lines: [line('a-fdemo6', { sauber: 12, fahrzeug: 3, waesche: 8 }), line('a-fdemo7', { sauber: 6, fahrzeug: 1, waesche: 4 })] },
      { id: 'mwb-demo2', kind: 'abholung', date: d10, at: at(d10, '07:30'), by, note: '', no: `WL-${d10.slice(0, 4)}-001`, lines: [line('a-fdemo6', { qty: 3 }), line('a-fdemo7', { qty: 1 })] },
      { id: 'mwb-demo3', kind: 'rueckgabe', date: d6, at: at(d6, '08:00'), by, note: 'Lieferschein der Wäscherei 4711', lines: [line('a-fdemo6', { qty: 9, lost: 1, retired: 0 }), line('a-fdemo7', { qty: 4, lost: 0, retired: 0 })] },
    ],
  }
}

/**
 * Daten des bisherigen Werkzeugs (Fassung 2.4), erfunden: 6 Liegeplätze („Standorte“) bei 3 Kunden an 4 Adressen,
 * Kundenliste mit Nummer bei 2 Kunden, 3 Touren. Enthält: zwei Liegeplätze an derselben Adresse, einen ohne
 * kundeId (Zuordnung über den Namen), einen „zu prüfen“, einen inaktiven, eine Kundenmatte, eine Matte ohne passenden
 * Mattentyp, Koordinaten bei einem, Halte „nicht rein“/„entfällt“ und einen Halt eines unbekannten Liegeplatzes.
 */
export function werkzeugBeispiel() {
  const m = (anzahl, farbe, groesse, eigentum = 'wir') => ({ anzahl, farbe, groesse, eigentum })
  const standorte = [
    { id: 'L-0001', gebiet: 'Nord', kunde: 'Hausverwaltung Beispiel GmbH', kundeId: 'K-0001', strasse: 'Ignaz-Beispiel-Straße 12', plz: '5020', ort: 'Salzburg', position: 'Haupteingang', matten: [m(2, 'Grau', '85 x 150 cm')], intervallWochen: 2, aktiv: true, hinweis: 'Schlüssel beim Hausbesorger', quelle: 'Tourenliste Nord, Zeile 1', pruefen: false },
    { id: 'L-0002', gebiet: 'Nord', kunde: 'Hausverwaltung Beispiel GmbH', kundeId: '', strasse: 'Ignaz-Beispiel-Str. 12', plz: '5020', ort: 'Salzburg', position: 'Stiege 2', matten: [m(1, 'Navy', '85 x 120 cm')], intervallWochen: 4, aktiv: true, hinweis: '', quelle: 'Tourenliste Nord, Zeile 2', pruefen: false },
    { id: 'L-0003', gebiet: 'Nord', kunde: 'Hausverwaltung Beispiel GmbH', kundeId: 'K-0001', strasse: 'Muster-Allee 5', plz: '5020', ort: 'Salzburg', position: 'Tiefgarage Lift', matten: [m(1, 'Grau/Schwarz', '115 x 200 cm', 'kunde')], intervallWochen: 4, aktiv: true, hinweis: '', quelle: 'Tourenliste Nord, Zeile 3', pruefen: true, pruefGrund: 'Stückzahl laut Liste unklar' },
    { id: 'L-0004', gebiet: 'Süd', kunde: 'Bäckerei Muster OG', kundeId: '', strasse: 'Beispielgasse 7', plz: '5400', ort: 'Hallein', position: 'Verkaufsraum', matten: [m(1, 'Rot', '60 x 90 cm')], intervallWochen: 2, aktiv: true, hinweis: 'vor 6 Uhr, Hintertür', quelle: 'Tourenliste Süd, Zeile 1', pruefen: false, lat: 47.6831, lon: 13.0962 },
    { id: 'L-0005', gebiet: 'Süd', kunde: 'Bäckerei Muster OG', kundeId: '', strasse: 'Beispielgasse 7', plz: '5400', ort: 'Hallein', position: 'Hintereingang', matten: [m(2, 'Grau', '85 x 150 cm')], intervallWochen: 4, aktiv: false, hinweis: 'ruht seit Umbau', quelle: 'Tourenliste Süd, Zeile 2', pruefen: false },
    { id: 'L-0006', gebiet: 'Nord', kunde: 'Autohaus Maxglan Beispiel KG', kundeId: 'K-0003', strasse: 'Autoweg 7', plz: '5020', ort: 'Salzburg', position: 'Schauraum', matten: [m(2, 'Grau', '115 x 200 cm'), m(1, 'Navy', '85 x 150 cm')], intervallWochen: 4, aktiv: true, hinweis: '', quelle: 'von Hand angelegt am 01.10.2026', pruefen: false },
  ]
  const kunden = [
    { id: 'K-0001', nr: '10001', name: 'Hausverwaltung Beispiel GmbH', strasse: 'Ringstraße 3', ort: '5020 Salzburg', mails: ['lieferschein@hv-beispiel.example'], ansprech: 'Paul Muster', telefon: '0662 000001', notiz: '', aktiv: true, neuerKunde: false },
    { id: 'K-0002', nr: '', name: 'Bäckerei Muster OG', strasse: 'Beispielgasse 7', ort: '5400 Hallein', mails: ['backstube@muster-beispiel.example'], ansprech: 'Frau Muster', telefon: '06245 00000', notiz: 'Lieferschein an die Backstube', aktiv: true, neuerKunde: true },
    { id: 'K-0003', nr: '20077', name: 'Autohaus Maxglan Beispiel KG', strasse: 'Autoweg 7', ort: '5020 Salzburg', mails: [], ansprech: '', telefon: '', notiz: '', aktiv: true, neuerKunde: false },
    { id: 'K-0004', nr: '', name: 'Fitnessclub Probe', strasse: '', ort: '', mails: [], ansprech: '', telefon: '', notiz: 'kein Mattenservice mehr', aktiv: false, neuerKunde: true },
  ]
  const halt = (lid, status) => {
    const s = standorte.find((x) => x.id === lid) || { kunde: 'unbekannt', matten: [] }
    return { lid, kunde: s.kunde, strasse: s.strasse || '', plz: s.plz || '', ort: s.ort || '', position: s.position || '', gebiet: s.gebiet || '', matten: s.matten, soll: s.matten.reduce((n, x) => n + x.anzahl, 0), status, gewechselt: status === 'gewechselt' ? s.matten.reduce((n, x) => n + x.anzahl, 0) : null, bemerkung: '', fotos: [], fotoDateien: [], zeit: status ? '08:30' : '' }
  }
  const tour = (id, datum, gebiet, halte) => ({ id, schema: 1, art: 'mattenwechsel', werkzeug: 'Mattenwechsel 2.4', erstellt: `${datum}T06:00:00.000Z`, geaendert: `${datum}T12:00:00.000Z`, datum, fahrer: 'Fahrer Beispiel', gebiet, bemerkung: '', status: 'abgeschlossen', abgeschlossen: `${datum}T12:00:00.000Z`, halte, sig: { fahrer: { name: '', data: '', zeit: '' }, kunde: { name: '', data: '', zeit: '' } }, versand: {} })
  const touren = [
    tour('T-beispiel-a1', '2026-10-06', 'Nord', [halt('L-0001', 'gewechselt'), halt('L-0002', 'gewechselt'), halt('L-0006', 'nichtErreicht')]),
    tour('T-beispiel-b2', '2026-10-20', 'Nord', [halt('L-0001', 'gewechselt'), halt('L-0006', 'gewechselt'), halt('L-0099', 'gewechselt')]),
    tour('T-beispiel-c3', '2026-09-15', 'Süd', [halt('L-0004', 'gewechselt'), halt('L-0005', 'entfaellt'), halt('L-0003', 'gewechselt')]),
  ]
  return { standorte, kunden, touren }
}

/** Pfade der Tour-Dateien im Werkzeug-Ordner (wie das Werkzeug sie ablegt). */
export const werkzeugTourPfad = (t) => `Mattenwechsel/Touren/${t.datum.slice(0, 4)}/${t.datum}_${t.gebiet || 'ohne-Gebiet'}_${t.id}/${t.datum}_${t.id}.json`
