// Beispieldaten für Fahrzeuge & Reifen, Reklamationen, Kalkulation und Material & Lager (Vorschau im Browser-Modus).
// Alles erfunden; Termine relativ zur angezeigten Woche, damit die Vorschau
// immer etwas Fälliges zeigt. Wasserzähler, Objektkontrolle, Objektdoku und Mattenwechsel
// sind die eigenen Werkzeuge (werkzeuge/) mit ihren echten Daten in SharePoint.

import { addDays, todayISO } from '../core/dates.js'
import { monthAdd } from '../core/vehicle-dues.js'
import { campaignFor } from '../core/vehicles.js'

function demoVehicles(monday) {
  const day = (n) => addDays(monday, n)
  const campaign = campaignFor(monday)
  const target = campaign.season
  const before = target === 'winter' ? 'sommer' : 'winter'
  const tread = (vl, vr = vl, hl = vl - 0.5, hr = hl) => ({ vl, vr, hl, hr })
  const set = (sommer, winter) => ({ sommer: { size: sommer.size, storage: sommer.storage || '', dot: sommer.dot || '', tread: sommer.tread || {} }, winter: { size: winter.size, storage: winter.storage || '', dot: winter.dot || '', tread: winter.tread || {} } })
  const vehicles = [
    { id: 'v1', plate: 'S-284 KL', label: 'VW Caddy', kind: 'transporter', driverId: 'e2', workshopId: 'w1', mounted: before, tires: set({ size: '205/55 R16', tread: tread(5.5) }, { size: '205/55 R16', storage: 'Reifen Muster, Regal 14', dot: '3822', tread: tread(6.5) }), note: 'Reinigungsmaschine im Laderaum: vor dem Termin ausräumen' },
    { id: 'v2', plate: 'S-511 TR', label: 'Renault Trafic', kind: 'transporter', driverId: 'e4', workshopId: 'w1', mounted: before, tires: set({ size: '215/65 R16C', tread: tread(4) }, { size: '215/65 R16C', storage: 'Reifen Muster, Regal 15', dot: '4121', tread: tread(5.5) }) },
    { id: 'v3', plate: 'S-907 PL', label: 'MAN TGE 5,5 t', kind: 'lkw', driverId: 'e6', workshopId: 'w2', mounted: before, tires: set({ size: '205/75 R16C', tread: tread(6) }, { size: '205/75 R16C', storage: 'Lager Gnigl, Halle 2', dot: '1920', tread: tread(5, 4.8, 4.5, 4.5) }) },
    { id: 'v4', plate: 'S-133 MB', label: 'Škoda Fabia', kind: 'pkw', driverId: 'e10', workshopId: 'w2', mounted: target, tires: set({ size: '185/65 R15', storage: 'Autohaus Beispiel, Platz B7', tread: tread(4.5) }, { size: '185/65 R15', dot: '3623', tread: tread(7.5, 7.5, 7, 7) }) },
    { id: 'v5', plate: 'S-620 GA', label: 'Opel Combo', kind: 'transporter', driverId: 'e9', workshopId: 'w1', mounted: 'ganzjahr', tires: { ganzjahr: { size: '205/60 R16', tread: tread(6) } } },
    { id: 'v6', plate: 'S-742 HW', label: 'Dacia Dokker', kind: 'transporter', driverId: 'e1', workshopId: 'w1', mounted: before, tires: set({ size: '195/65 R15', tread: tread(5) }, { size: '195/65 R15', storage: 'Reifen Muster, Regal 9', dot: '2523', tread: tread(7) }) },
    { id: 'v7', plate: 'S-388 RE', label: 'Hyundai i20', kind: 'pkw', driverId: 'e5', workshopId: 'w2', mounted: before, tires: set({ size: '185/65 R15', tread: tread(5) }, { size: '185/65 R15', storage: 'Autohaus Beispiel, Platz B9', dot: '4422', tread: tread(6) }) },
  ]
  // Zulassung, Pickerl (Monat laut Plakette), Service und km-Stände relativ zur Demo-Woche
  const ym = monday.slice(0, 7)
  const km = (...pairs) => pairs.map(([d, k]) => ({ date: day(d), km: k }))
  Object.assign(vehicles[0], { cls: 'N1', firstReg: monthAdd(ym, -47), pickerl: { next: monthAdd(ym, 1) }, service: { months: 12, km: 30000, lastDate: day(-350), lastKm: 32000 }, kmLog: km([-350, 32000], [-6, 58100]) })
  Object.assign(vehicles[1], { cls: 'N1', firstReg: monthAdd(ym, -80), pickerl: { next: monthAdd(ym, 4) }, service: { months: 12, km: 40000, lastDate: day(-220), lastKm: 81000 }, kmLog: km([-220, 81000], [-10, 95500]), dues: [{ id: 'd1', label: 'Verbandskasten (Ablaufdatum)', date: day(20), months: 60, note: '' }] })
  Object.assign(vehicles[2], { cls: 'N2', firstReg: monthAdd(ym, -85), pickerl: { next: monthAdd(ym, -1) }, service: { months: '', km: '', lastDate: '', lastKm: '', nextKm: 150000 }, kmLog: km([-200, 131000], [-5, 148900]), dues: [{ id: 'd2', label: 'Tachographprüfung', date: day(45), months: 24, note: 'alle 2 Jahre' }] })
  Object.assign(vehicles[3], { cls: 'M1', firstReg: monthAdd(ym, -42), pickerl: { next: monthAdd(ym, 18), lastDate: day(-200), result: 'ok' }, service: { months: 24, km: 30000, lastDate: day(-200), lastKm: 30500 }, kmLog: km([-200, 30500], [-6, 48210]) })
  Object.assign(vehicles[4], { cls: 'N1', firstReg: monthAdd(ym, -64), pickerl: { next: monthAdd(ym, 8) }, service: { months: '', km: '', lastDate: '', lastKm: '', nextKm: 90000 }, kmLog: km([-120, 80100], [-8, 88900]) })
  Object.assign(vehicles[5], { cls: 'N1', firstReg: monthAdd(ym, -94), pickerl: { next: monthAdd(ym, 2) }, service: { months: 12, km: 20000, lastDate: day(-300), lastKm: 101000 }, kmLog: km([-300, 101000], [-15, 112400]) })
  Object.assign(vehicles[6], { cls: 'M1', firstReg: monthAdd(ym, -118), pickerl: { next: monthAdd(ym, 7) }, service: { months: 12, km: 15000, lastDate: day(-380), lastKm: 64000 }, kmLog: km([-380, 64000], [-12, 76500]), dues: [{ id: 'd3', label: 'Leasingende', date: day(200), months: '', note: 'Rückgabe beim Autohaus' }] })
  const change = (id, vehicleId, date, time, workshopId, extra = {}) => ({ id, vehicleId, season: target, year: campaign.year, date, time, minutes: 30, workshopId, status: 'geplant', mails: [], ...extra })
  return {
    vehicles,
    workshops: [
      { id: 'w1', name: 'Reifen Muster GmbH', address: 'Musterstraße 5, 5020 Salzburg', phone: '+43 662 000000', email: 'termine@reifen-muster.example' },
      { id: 'w2', name: 'Autohaus Beispiel', address: 'Beispielweg 12, 5071 Wals', phone: '+43 662 000001', email: 'service@autohaus-beispiel.example' },
    ],
    changes: [
      change('c1', 'v4', day(-6), '07:30', 'w2', { status: 'erledigt', doneAt: day(-6), km: 48210, tread: tread(7.5, 7.5, 7, 7), storage: 'Autohaus Beispiel, Platz B7', cost: 45 }),
      change('c2', 'v7', day(1), '13:30', 'w2', { mails: [{ at: `${day(-3)}T09:12:00.000Z`, to: 'Sandra Pichler', kind: 'fahrer', via: 'demo' }] }),
      change('c3', 'v6', day(2), '09:00', 'w1'),
      change('c4', 'v1', day(3), '07:00', 'w1', { minutes: 60, tasks: ['pickerl'], note: 'Reifenwechsel gleich mit Pickerl' }),
      { id: 'c5', vehicleId: 'v6', kind: 'werkstatt', tasks: ['pickerl'], date: day(8), time: '07:30', minutes: 60, workshopId: 'w1', status: 'geplant', note: '', mails: [] },
    ],
    settings: { slotMinutes: 30, travelMinutes: 20 },
  }
}

/** Zwei Reklamationen (eine offen, eine erledigt), Objekte aus den Beispieldaten. */
function demoComplaints(monday) {
  const day = (n) => addDays(monday, n)
  return {
    items: [
      { id: 'r-demo1', objectId: 'o5', date: day(-3), received: `${day(-3)}T08:15:00.000Z`, source: 'Kunde (Telefon)', kind: 'Reinigung mangelhaft', text: 'Stiegenhaus 2. Stock: Geländer nicht gewischt, Eingangsmatte nicht ausgeklopft.', contact: 'Hausverwaltung, Frau Berger', employees: [], measure: 'Nachreinigung am selben Tag, Hinweis an das Team.', due: day(-2), status: 'erledigt', doneAt: `${day(-3)}T15:30:00.000Z`, result: 'Nachgereinigt, Kunde telefonisch informiert.', informed: true, by: 'Beispieldaten', history: [{ at: `${day(-3)}T08:15:00.000Z`, by: 'Beispieldaten', text: 'erfasst (Reinigung mangelhaft, Kunde (Telefon))' }, { at: `${day(-3)}T15:30:00.000Z`, by: 'Beispieldaten', text: 'Status: erledigt' }] },
      { id: 'r-demo2', objectId: 'o2', date: day(-1), received: `${day(-1)}T07:40:00.000Z`, source: 'Kunde (E-Mail)', kind: 'Leistung nicht erbracht', text: 'Mistkübel im Schauraum nicht geleert.', contact: 'Autohaus, Empfang', employees: [], measure: '', due: day(0), status: 'offen', result: '', informed: false, by: 'Beispieldaten', history: [{ at: `${day(-1)}T07:40:00.000Z`, by: 'Beispieldaten', text: 'erfasst (Leistung nicht erbracht, Kunde (E-Mail))' }] },
    ],
  }
}

// Material & Lager: zwei Lieferanten, übliche Artikel, Bestand aus Anfangsbestand und Ausgaben an
// Objekte, eine offene Bestellung, zwei Anforderungen (eine vom Handy). Einige Artikel sind knapp.
function demoMaterial() {
  // relativ zu heute (nicht zur angezeigten Woche): Buchungen liegen in der Vergangenheit
  const day = (n) => addDays(todayISO(), n)
  const at = (n, time = '07:30') => `${day(n)}T${time}:00.000Z`
  let n = 0
  const id = () => `mv-demo${++n}`
  const suppliers = [
    { id: 's-demo1', name: 'Hygiene-Großhandel Beispiel', email: 'bestellung@hygiene-beispiel.at', phone: '0662 000 000', contact: '', customerNo: 'K-1020', note: 'Lieferung Di und Do, ab 150 € frei Haus' },
    { id: 's-demo2', name: 'Papier & Co Beispiel', email: 'shop@papier-beispiel.at', phone: '', contact: 'Frau Huber', customerNo: '', note: '' },
  ]
  const art = (aid, name, category, unit, supplierId, price, min, target, packSize = 1) => ({ id: aid, name, category, unit, supplierId, price, min, target, packSize, articleNo: '', active: true })
  const articles = [
    art('a-demo1', 'Allzweckreiniger 1 l', 'Reinigungsmittel', 'Fl.', 's-demo1', 3.2, 6, 18, 6),
    art('a-demo2', 'Sanitärreiniger 1 l', 'Reinigungsmittel', 'Fl.', 's-demo1', 3.9, 6, 18, 6),
    art('a-demo3', 'Glasreiniger 1 l', 'Reinigungsmittel', 'Fl.', 's-demo1', 2.8, 4, 12),
    art('a-demo4', 'Handseife 5 l', 'Papier & Hygiene', 'Kanister', 's-demo1', 14.5, 2, 6),
    art('a-demo5', 'Papierhandtücher Zickzack', 'Papier & Hygiene', 'Karton', 's-demo2', 24.9, 3, 8),
    art('a-demo6', 'Toilettenpapier 3-lagig', 'Papier & Hygiene', 'Pkg', 's-demo2', 6.5, 4, 12),
    art('a-demo7', 'Müllsäcke 60 l', 'Müllsäcke', 'Rolle', 's-demo2', 2.1, 10, 30),
    art('a-demo8', 'Müllsäcke 120 l', 'Müllsäcke', 'Rolle', 's-demo2', 3.4, 10, 30),
    art('a-demo9', 'Mikrofasertücher (10 Stk)', 'Tücher & Mopps', 'Pkg', 's-demo1', 9.9, 3, 8),
    art('a-demo10', 'Einweghandschuhe Nitril M', 'Arbeitskleidung & Schutz', 'Box', 's-demo1', 7.5, 4, 10),
    art('a-demo11', 'Arbeitsjacke', 'Arbeitskleidung & Schutz', 'Stk', '', 39, 0, 0),
  ]
  const price = Object.fromEntries(articles.map((a) => [a.id, a.price]))
  const start = { 'a-demo1': 18, 'a-demo2': 8, 'a-demo3': 10, 'a-demo4': 3, 'a-demo5': 6, 'a-demo6': 14, 'a-demo7': 28, 'a-demo8': 22, 'a-demo9': 7, 'a-demo10': 9, 'a-demo11': 5 }
  const moves = Object.entries(start).map(([articleId, qty]) => ({ id: id(), at: at(-28), date: day(-28), kind: 'korrektur', articleId, loc: 'lager', qty, price: price[articleId], by: 'Beispieldaten', note: 'Anfangsbestand' }))
  const out = (d, articleId, qty, objectId, employeeId = '') => moves.push({ id: id(), at: at(d), date: day(d), kind: 'ausgabe', articleId, loc: 'lager', qty: -qty, price: price[articleId], objectId, employeeId, by: 'Beispieldaten', note: '' })
  out(-20, 'a-demo1', 3, 'o1'); out(-20, 'a-demo8', 6, 'o5'); out(-18, 'a-demo5', 2, 'o2'); out(-15, 'a-demo2', 2, 'o3'); out(-14, 'a-demo4', 1, 'o2')
  out(-12, 'a-demo8', 4, 'o3'); out(-10, 'a-demo1', 3, 'o5'); out(-9, 'a-demo6', 4, 'o1'); out(-7, 'a-demo2', 2, 'o5'); out(-6, 'a-demo7', 8, 'o4')
  out(-5, 'a-demo8', 4, 'o5'); out(-4, 'a-demo4', 1, 'o7'); out(-3, 'a-demo5', 1, 'o7'); out(-3, 'a-demo1', 3, 'o2'); out(-2, 'a-demo10', 2, 'o3')
  out(-8, 'a-demo11', 1, '', 'e3')
  const orders = [{ id: 'b-demo1', no: `${day(0).slice(0, 4)}-001`, supplierId: 's-demo1', status: 'bestellt', createdAt: at(-2), orderedAt: day(-2), expected: day(2), lines: [{ articleId: 'a-demo2', qty: 12, price: 3.9, received: 0 }], note: '', by: 'Beispieldaten', sent: { at: at(-2), via: 'markiert', to: '', by: 'Beispieldaten' } }]
  const requests = [
    { id: 'q-demo1', at: at(-1, '06:40'), source: 'handy', by: 'Ana Popescu', name: 'Ana Popescu', employeeId: 'e1', objectId: 'o2', lines: [{ articleId: '', qty: 0, text: 'Handseife leer, Papierhandtücher fast aus' }], note: '', status: 'offen', answer: '' },
    { id: 'q-demo2', at: at(0, '09:15'), source: 'app', by: 'Objektleitung', name: 'Objektleitung', employeeId: '', objectId: 'o5', lines: [{ articleId: 'a-demo8', qty: 5, text: '' }], note: 'bis Freitag', status: 'offen', answer: '' },
  ]
  return { articles, locations: [{ id: 'lager', name: 'Hauptlager' }, { id: 'l-demo2', name: 'Bus S-284 KL' }], suppliers, moves, orders, requests, settings: { deliveryAddress: 'Cleanos, Lagerweg 1, 5020 Salzburg', contact: 'Büro, 0662 000 001' } }
}

export function createModuleDemo(monday) {
  return {
    material: demoMaterial(),
    fahrzeuge: demoVehicles(monday),
    reklamationen: demoComplaints(monday),
    // Kalkulation für die Wohnanlage (o5): Stiegenhaus, Eingang, Kellergang
    kalkulation: {
      settings: {},
      objects: {
        o5: {
          areas: [
            { id: 'f-demo1', name: 'Stiegenhaus 4 Stockwerke', type: 'stiege', m2: 180, perWeek: 2 },
            { id: 'f-demo2', name: 'Eingang mit Glastür', type: 'eingang', m2: 25, perWeek: 2 },
            { id: 'f-demo3', name: 'Kellergang, Müllraum', type: 'gang', m2: 90, perWeek: 0.5 },
          ],
        },
      },
    },
  }
}

