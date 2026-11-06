// Beispieldaten für das Mattenwechsel-Modul (alles erfunden, keine echten Kunden oder Adressen):
//  - createMattenDemo(): einige Liegeplätze für die Vorschau im Browser-Modus (Kunden und Objekte der Beispieldaten)
//  - MATTEN_ARTIKEL_BEISPIEL: Mattentypen als Artikel der Fakturierung (group 'Matten') für Tests
//  - werkzeugBeispiel(): Dateien des bisherigen Werkzeugs (Standorte.json, Kunden.json, Touren) im Format der
//    Fassung 2.4 – für den Test der Übernahme (test/matten-import.test.js) und die SharePoint-Attrappe der Browser-Tests.

/** Mattentypen wie in der Fakturierung (Artikelgruppe „Matten“, Größe und Farbe als eigene Felder). */
export const MATTEN_ARTIKEL_BEISPIEL = [
  { id: 'a-mdemo1', articleNo: 'MA-85150-G', group: 'Matten', name: 'Schmutzfangmatte 85 × 150 cm grau', size: '85 x 150 cm', color: 'Grau', unit: 'Stk', price: 4.9, vat: 20 },
  { id: 'a-mdemo2', articleNo: 'MA-85120-N', group: 'Matten', name: 'Schmutzfangmatte 85 × 120 cm navy', size: '85 x 120 cm', color: 'Navy', unit: 'Stk', price: 4.2, vat: 20 },
  { id: 'a-mdemo3', articleNo: 'MA-115200-G', group: 'Matten', name: 'Schmutzfangmatte 115 × 200 cm grau', size: '115 x 200 cm', color: 'Grau', unit: 'Stk', price: 7.5, vat: 20 },
  { id: 'a-mdemo4', articleNo: 'MA-150250-G', group: 'Matten', name: 'Schmutzfangmatte 150 × 250 cm grau', size: '150 x 250 cm', color: 'Grau', unit: 'Stk', price: 11.9, vat: 20 },
]

const copy = (id) => {
  const a = MATTEN_ARTIKEL_BEISPIEL.find((x) => x.id === id)
  return { articleId: a.id, name: a.name, size: a.size, color: a.color }
}
const stamp = { createdAt: '2026-11-02T08:00:00.000Z', createdBy: 'Beispieldaten', updatedAt: '2026-11-02T08:00:00.000Z', updatedBy: 'Beispieldaten' }

/** Liegeplätze der Vorschau: Autohaus (2) und Versicherungsbüro (1), Gebiet „Salzburg Nord“. */
export function createMattenDemo() {
  const hv = { id: 'c-demo1', name: 'Hausverwaltung Beispiel GmbH', no: '10001' }
  const ah = { id: 'c-demo2', name: 'Autohaus Maxglan Beispiel KG', no: '10002' }
  return {
    schema: 1,
    settings: {},
    areas: [{ id: 'mg-demo1', name: 'Salzburg Nord', active: true, ...stamp }],
    placements: [
      { id: 'mw-demo1', objectId: 'o2', customerId: ah.id, customer: ah, name: 'Schauraum Eingang', floor: 'EG', access: 'offen ab 7 Uhr', hint: 'Alte Matten in den Bus, nicht in den Müllraum', active: true, mats: [{ ...copy('a-mdemo3'), qty: 2, owner: 'wir' }], intervalDays: 14, startDate: '2026-11-04', rule: 'rhythmus', workMinutes: 10, window: { from: '07:00', to: '09:00', note: 'vor Geschäftsöffnung' }, pauses: [], areaId: 'mg-demo1', ...stamp },
      { id: 'mw-demo2', objectId: 'o2', customerId: ah.id, customer: ah, name: 'Werkstatt Kundenannahme', floor: 'EG', access: '', hint: '', active: true, mats: [{ ...copy('a-mdemo1'), qty: 1, owner: 'wir' }], intervalDays: 28, startDate: '2026-11-04', rule: 'rhythmus', workMinutes: 5, pauses: [{ from: '2026-12-23', to: '2027-01-06', reason: 'Betriebsurlaub' }], areaId: 'mg-demo1', ...stamp },
      { id: 'mw-demo3', objectId: 'o11', customerId: hv.id, customer: hv, name: 'Eingang', floor: 'EG', access: 'Code 1234 an der Tür (Beispiel)', hint: '', active: true, mats: [{ ...copy('a-mdemo2'), qty: 1, owner: 'kunde' }], intervalDays: 28, startDate: '2026-11-10', rule: 'rhythmus', workMinutes: 5, pauses: [], areaId: 'mg-demo1', ...stamp },
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
