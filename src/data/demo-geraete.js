// Beispieldaten für Geräte & Maschinen (Vorschau im Browser-Modus), relativ zu heute: Scheuersaugmaschine im Autohaus
// mit überfälliger E-Prüfung, Nasssauger im Bus mit bald fälliger Prüfung, Hochdruckreiniger gesperrt und in der
// Werkstatt, Einscheibenmaschine mit erledigter Reparatur, Leiter bei einer Person, Akku-Sauger ohne Prüfung bis zum
// Termin, ein ausgeschiedener Staubsauger und eine Meldung vom Handy, die noch keinem Gerät zugeordnet ist.
// Hersteller, Werkstätten und Nummern sind erfunden.

import { addMonths } from '../core/anlagen.js'
import { addDays, formatDate, todayISO } from '../core/dates.js'

export function createGeraeteDemo(today = todayISO()) {
  const day = (n) => addDays(today, n)
  // Prüfung so legen, dass die nächste Frist in n Tagen ist (Intervall in Monaten)
  const before = (months, n) => addDays(addMonths(today, -months), n)
  const at = (date, t = '08:30') => `${date}T${t}:00.000Z`
  const lager = { kind: 'lager', id: 'lager', label: 'Hauptlager' }
  const plan = (id, kind, months = 12, extra = {}) => ({ id, kind, label: '', months, firstDue: '', active: true, ...extra })
  const made = (date) => [{ at: at(date), date, kind: 'angelegt', by: 'Beispieldaten' }]
  const item = (id, no, name, typeId, extra = {}) => ({ id, no, name, typeId, maker: '', model: '', serial: '', boughtOn: '', price: '', supplierId: '', supplierName: '', home: lager, responsibleId: '', responsibleName: '', status: 'betrieb', statusSince: '', statusNote: '', issued: null, plans: [], photos: [], docs: [], history: made(day(-500)), note: '', createdAt: at(day(-500)), createdBy: 'Beispieldaten', ...extra })
  const check = (id, itemId, planId, kind, date, extra = {}) => ({ id, itemId, planId, kind, date, by: 'Elektro Beispiel GmbH', result: 'ok', values: '', defects: '', note: '', report: null, at: at(date), user: 'Beispieldaten', ...extra })
  const blockedOn = day(-6)
  return {
    types: [],
    items: [
      item('gr-demo1', 'G-0001', 'Scheuersaugmaschine 1', 'scheuersaug', {
        maker: 'Saugwerk Beispiel',
        model: 'SSM 450',
        serial: 'SW-450-0815',
        boughtOn: day(-900),
        price: 3490,
        supplierName: 'Hygiene-Großhandel Beispiel GmbH',
        supplierId: 'ls-demo1',
        responsibleId: 'e4',
        responsibleName: 'Dragan Jović',
        plans: [plan('gp-demo1', 'elektro'), plan('gp-demo2', 'wartung')],
        issued: { kind: 'objekt', id: 'o2', label: 'Autohaus Maxglan', since: day(-12) },
        history: [...made(day(-900)), { at: at(day(-12)), date: day(-12), kind: 'ausgabe', from: 'Hauptlager', to: 'Autohaus Maxglan', by: 'Beispieldaten', note: 'Schauraum, Grundreinigung' }],
      }),
      item('gr-demo2', 'G-0002', 'Nasssauger Bus', 'sauger', { maker: 'Saugwerk Beispiel', model: 'NS 30', home: { kind: 'fahrzeug', id: 'v1', label: 'S-284 KL VW Caddy' }, plans: [plan('gp-demo3', 'elektro')], price: 420 }),
      item('gr-demo3', 'G-0003', 'Hochdruckreiniger', 'hochdruck', {
        maker: 'Druckwerk Muster',
        model: 'HD 7/150',
        boughtOn: day(-1300),
        price: 1290,
        plans: [plan('gp-demo4', 'elektro'), plan('gp-demo5', 'wartung')],
        status: 'gesperrt',
        statusSince: blockedOn,
        statusNote: `E-Prüfung am ${formatDate(blockedOn, { weekday: false, year: true })}: Isolation am Kabel beschädigt`,
        history: [...made(day(-1300)), { at: at(blockedOn), date: blockedOn, kind: 'status', from: 'betrieb', to: 'gesperrt', by: 'Beispieldaten', note: `E-Prüfung am ${formatDate(blockedOn, { weekday: false, year: true })}: Isolation am Kabel beschädigt` }],
      }),
      item('gr-demo4', 'G-0004', 'Einscheibenmaschine', 'einscheibe', { maker: 'Bodenpflege Beispiel', model: 'ES 43', price: 1850, plans: [plan('gp-demo6', 'elektro'), plan('gp-demo7', 'wartung', 24)] }),
      item('gr-demo5', 'G-0005', 'Stufenleiter 3 Stufen', 'leiter', {
        plans: [plan('gp-demo8', 'leiter')],
        issued: { kind: 'person', id: 'e3', label: 'Elif Kaya', since: day(-30), due: day(20) },
        history: [...made(day(-500)), { at: at(day(-30)), date: day(-30), kind: 'ausgabe', from: 'Hauptlager', to: 'Elif Kaya', by: 'Beispieldaten' }],
      }),
      item('gr-demo6', 'G-0006', 'Akku-Rucksacksauger', 'akku', { maker: 'Saugwerk Beispiel', model: 'RS 18', boughtOn: day(-40), price: 690, plans: [plan('gp-demo9', 'elektro', 12, { firstDue: day(60) })], history: made(day(-40)) }),
      item('gr-demo7', 'G-0007', 'Staubsauger alt', 'sauger', {
        plans: [plan('gp-demo10', 'elektro')],
        status: 'ausgeschieden',
        statusSince: day(-200),
        statusNote: 'Motor defekt, verschrottet',
        history: [...made(day(-2000)), { at: at(day(-200)), date: day(-200), kind: 'status', from: 'betrieb', to: 'ausgeschieden', by: 'Beispieldaten', note: 'Motor defekt, verschrottet' }],
      }),
    ],
    checks: [
      check('gc-demo1', 'gr-demo1', 'gp-demo1', 'elektro', before(12, -15), { values: 'Schutzleiter 0,10 Ω, Isolation > 2 MΩ' }),
      check('gc-demo2', 'gr-demo1', 'gp-demo2', 'wartung', day(-120), { by: 'Reinigungstechnik Beispiel GmbH' }),
      check('gc-demo3', 'gr-demo2', 'gp-demo3', 'elektro', before(12, 20), { values: 'Schutzleiter 0,15 Ω' }),
      check('gc-demo4', 'gr-demo3', 'gp-demo4', 'elektro', blockedOn, { result: 'gesperrt', defects: 'Isolation am Kabel beschädigt', values: 'Isolation 0,3 MΩ' }),
      check('gc-demo5', 'gr-demo3', 'gp-demo5', 'wartung', day(-200), { by: 'Reinigungstechnik Beispiel GmbH' }),
      check('gc-demo6', 'gr-demo4', 'gp-demo6', 'elektro', day(-90)),
      check('gc-demo7', 'gr-demo4', 'gp-demo7', 'wartung', day(-40), { by: 'Reinigungstechnik Beispiel GmbH', note: 'nach der Reparatur' }),
      check('gc-demo8', 'gr-demo5', 'gp-demo8', 'leiter', day(-100), { by: 'Lukas Wimmer', note: 'Holme, Stufen, Gelenke in Ordnung' }),
    ],
    repairs: [
      { id: 'gs-demo1', itemId: 'gr-demo3', date: blockedOn, objectId: '', text: 'Gesperrt bei der E-Prüfung: Isolation am Kabel beschädigt', reportedBy: 'Elektro Beispiel GmbH', source: 'app', photos: [], status: 'werkstatt', workshop: 'Reinigungstechnik Beispiel GmbH', cost: '', doneOn: '', invoice: null, note: 'Kostenvoranschlag angefragt', log: [{ at: at(blockedOn), by: 'Beispieldaten', status: 'gemeldet' }, { at: at(day(-4)), by: 'Beispieldaten', status: 'werkstatt' }], at: at(blockedOn), user: 'Beispieldaten' },
      { id: 'gs-demo2', itemId: 'gr-demo4', date: day(-48), objectId: 'o7', text: 'Treibteller schlägt, Lager laut', reportedBy: 'Ana Popescu', source: 'app', photos: [], status: 'erledigt', workshop: 'Reinigungstechnik Beispiel GmbH', cost: 186.4, doneOn: day(-41), invoice: null, note: '', log: [{ at: at(day(-48)), by: 'Beispieldaten', status: 'gemeldet' }, { at: at(day(-46)), by: 'Beispieldaten', status: 'werkstatt' }, { at: at(day(-41)), by: 'Beispieldaten', status: 'erledigt' }], at: at(day(-48)), user: 'Beispieldaten' },
      { id: 'gs-demo3', itemId: 'gr-demo1', date: day(-80), objectId: 'o5', text: 'Saugleiste eingerissen', reportedBy: 'Dragan Jović', source: 'app', photos: [], status: 'erledigt', workshop: 'eigene Leute', cost: 92, doneOn: day(-78), invoice: null, note: 'Ersatzteil aus dem Lager', log: [{ at: at(day(-80)), by: 'Beispieldaten', status: 'gemeldet' }, { at: at(day(-78)), by: 'Beispieldaten', status: 'erledigt' }], at: at(day(-80)), user: 'Beispieldaten' },
      { id: 'gs-demo4', itemId: '', date: day(-1), objectId: 'o5', text: 'Gerät: roter Staubsauger. Schlauch abgebrochen', reportedBy: 'Lukas Wimmer', source: 'handy', portalId: 'demo-handy-1', photos: [], status: 'gemeldet', workshop: '', cost: '', doneOn: '', invoice: null, note: '', log: [{ at: at(day(-1), '17:40'), by: 'Lukas Wimmer', status: 'gemeldet' }], at: at(day(-1), '17:40'), user: 'Lukas Wimmer' },
    ],
    settings: {},
  }
}
