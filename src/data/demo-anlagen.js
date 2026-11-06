// Beispieldaten für Anlagen & Prüffristen (Vorschau im Browser-Modus), relativ zu heute: Wohnanlage Lehen mit
// überfälligen Feuerlöschern und bald fälligen Rauchwarnmeldern (verrechenbar), Kindergarten Aigen mit Spielplatz
// (offener Mangel aus der Hauptinspektion, operative Inspektion bald fällig), Autohaus mit Notbeleuchtung (bald
// fällig), Wohnanlage Obertrum (Revier Flachgau) mit Lift und einer Dachkontrolle ohne Prüfung. Alles erfunden.

import { addMonths } from '../core/anlagen.js'
import { addDays, todayISO } from '../core/dates.js'

export function createAnlagenDemo(today = todayISO()) {
  const day = (n) => addDays(today, n)
  // Prüfung so legen, dass die nächste Frist in n Tagen ist (Intervall in Monaten)
  const before = (months, n) => addDays(addMonths(today, -months), n)
  const at = (date) => `${date}T08:30:00.000Z`
  const item = (id, objectId, typeId, label, extra = {}) => ({ id, objectId, typeId, label, count: 1, maker: '', serial: '', months: '', operative: false, operativeMonths: '', firstDue: '', by: 'eigen', company: '', contact: '', billable: false, price: '', note: '', active: true, createdAt: at(day(-400)), createdBy: 'Beispieldaten', ...extra })
  const check = (id, itemId, date, extra = {}) => ({ id, itemId, kind: 'haupt', date, result: 'ok', defects: '', by: 'Hausbetreuung Cleanos', external: false, note: '', photos: [], report: null, billable: false, price: 0, resolved: null, at: at(date), user: 'Beispieldaten', ...extra })
  const brand = { by: 'fremd', company: 'Brandschutz Muster GmbH', contact: '0662 000 111, service@brandschutz-muster.example' }
  return {
    types: [],
    items: [
      item('an-demo1', 'o5', 'feuerloescher', 'Stiege 1 und 2, je EG', { count: 4, maker: 'Gloria', ...brand }),
      item('an-demo2', 'o5', 'rauchmelder', 'Stiegenhaus, alle Geschoße', { count: 8, billable: true, price: 35, note: 'Prüfknopf je Geschoß, Leiter im Keller' }),
      item('an-demo3', 'o5', 'rueckstau', 'Keller, Waschküche', { billable: true, price: 25 }),
      item('an-demo4', 'o90', 'spielplatz', 'Garten: Schaukel, Rutsche, Sandkiste', { operative: true, by: 'fremd', company: 'Spielplatzprüfung Beispiel KG', contact: '0664 000 222', note: 'operative Inspektion monatlich durch die Hausbetreuung' }),
      item('an-demo5', 'o90', 'rauchmelder', 'Gruppenräume', { count: 6, firstDue: day(60) }),
      item('an-demo6', 'o2', 'notbeleuchtung', 'Schauraum und Werkstatt', { count: 14, by: 'fremd', company: 'Elektro Beispiel GmbH', contact: '0662 000 333' }),
      item('an-demo7', 'o2', 'brandschutztuer', 'Werkstatt zu Schauraum', { count: 2, by: 'fremd', company: 'Elektro Beispiel GmbH' }),
      item('an-demo8', 'o18', 'lift', 'Stiege 1', { by: 'fremd', company: 'Aufzüge Beispiel AG', contact: 'Störung 0800 000 444', serial: 'FA-20417' }),
      item('an-demo9', 'o18', 'dach', 'Dach und Dachrinnen'),
    ],
    checks: [
      check('ap-demo1', 'an-demo1', before(24, -20), { by: 'Brandschutz Muster GmbH', external: true }),
      check('ap-demo2', 'an-demo2', before(12, 18), { billable: true, price: 35 }),
      check('ap-demo3', 'an-demo3', day(-60), { billable: true, price: 25 }),
      check('ap-demo4', 'an-demo4', day(-150), { result: 'maengel', defects: 'Schaukel: Kette verschlissen, Sitz tauschen', by: 'Spielplatzprüfung Beispiel KG', external: true }),
      check('ap-demo5', 'an-demo4', day(-27), { kind: 'operativ', note: 'Sand gerecht, Schaukel weiter gesperrt' }),
      check('ap-demo6', 'an-demo6', before(12, 25), { by: 'Elektro Beispiel GmbH', external: true }),
      check('ap-demo7', 'an-demo7', day(-95), { by: 'Elektro Beispiel GmbH', external: true }),
      check('ap-demo8', 'an-demo8', day(-300), { by: 'Aufzüge Beispiel AG', external: true }),
      // behobener Mangel als Beispiel für den Verlauf
      check('ap-demo9', 'an-demo3', day(-200), { result: 'maengel', defects: 'Klappe schwergängig', resolved: { date: day(-190), note: 'gereinigt und gefettet', by: 'Beispieldaten', at: at(day(-190)) } }),
    ],
    settings: {},
  }
}
