// Beispieldaten für den Arbeitsschutz (Vorschau im Browser-Modus), relativ zu heute. Alles erfunden, auch Hersteller
// und Produktnamen. Angaben am Material-Artikel: Allzweckreiniger mit veraltetem Sicherheitsdatenblatt, Sanitärreiniger
// (sauer, ätzend) mit aktuellem; der Glasreiniger hat noch keine Angaben. Betriebsanweisung zum Sanitärreiniger
// (freigegeben, verknüpft mit „Unterweisung Reinigungsmittel“). Evaluierung: Unterhaltsreinigung mit überfälliger
// Maßnahme, Glasreinigung mit überfälliger Überprüfung, Umgang mit Reinigungsmitteln mit hohem Risiko.

import { addMonths } from '../core/trainings.js'
import { instructionFromArticle } from '../core/arbeitsschutz-vorlagen.js'
import { addDays, todayISO } from '../core/dates.js'

/** Angaben zu Arbeitsstoffen je Artikel der Beispieldaten (Material & Lager): { artikelId: { haz, sds } }. */
export function stoffDemo(today = todayISO()) {
  const maker = 'Chemie Beispiel GmbH'
  return {
    'a-demo1': {
      sds: 'https://example.com/sdb/allzweck-beispiel-az10.pdf',
      haz: { on: true, maker, product: 'Allzweckreiniger Beispiel AZ 10', use: 'Unterhaltsreinigung abwaschbarer Flächen, 1:100 verdünnt', ghs: ['GHS07'], signal: 'achtung', h: 'H319', p: 'P280, P305+P351+P338', ppe: ['Schutzhandschuhe'], sdb: null, sdbDate: addMonths(today, -50), objectIds: [] },
    },
    'a-demo2': {
      sds: 'https://example.com/sdb/sanitaer-beispiel-sr20.pdf',
      haz: { on: true, maker, product: 'Sanitärreiniger Beispiel SR 20 (sauer)', use: 'Sanitärreinigung gegen Kalk und Urinstein, 1:20 verdünnt', ghs: ['GHS05'], signal: 'gefahr', h: 'H290, H314', p: 'P260, P280, P301+P330+P331, P305+P351+P338', ppe: ['Schutzhandschuhe', 'Schutzbrille'], sdb: null, sdbDate: addDays(today, -400), objectIds: ['o7'] },
    },
  }
}

export function createArbeitsschutzDemo(today = todayISO(), articles = []) {
  const day = (n) => addDays(today, n)
  const at = (date) => `${date}T08:00:00.000Z`
  const sanitaer = articles.find((a) => a.id === 'a-demo2')
  const base = instructionFromArticle(sanitaer || { name: 'Sanitärreiniger', haz: stoffDemo(today)['a-demo2'].haz })
  const m = (id, text, who, due, status = 'offen', extra = {}) => ({ id, text, who, due, status, doneAt: '', checkedAt: '', trainingTypeId: '', ...extra })
  const h = (id, text, likelihood, severity, measures, source = 'vorschlag') => ({ id, text, source, likelihood, severity, measures })
  return {
    instructions: [
      { id: 'ba-demo1', kind: 'stoff', articleId: 'a-demo2', title: base.title, area: 'Sanitärreinigung in allen Objekten', sections: base.sections, date: day(-100), approvedBy: 'Geschäftsführung', approvedAt: day(-100), trainingTypeId: 'chemie', pdf: null, createdAt: at(day(-100)), createdBy: 'Beispieldaten' },
    ],
    evaluations: [
      {
        id: 'ev-demo1',
        title: 'Unterhaltsreinigung',
        templateId: 'unterhalt',
        objectIds: [],
        participants: 'Geschäftsführung, Sicherheitsfachkraft, Objektleitung',
        reviewedAt: day(-200),
        reviewedBy: 'Geschäftsführung',
        trigger: null,
        note: '',
        hazards: [
          h('hz-demo1', 'Ausrutschen auf nassen oder frisch gewischten Böden', 2, 2, [m('ms-demo1', 'Rutschhemmende Arbeitsschuhe für alle ausgeben', 'Lager', day(-10)), m('ms-demo2', 'Warnschild in jedem Reinigungswagen', 'Objektleitung', day(-160), 'wirksam', { doneAt: day(-150), checkedAt: day(-60) })]),
          h('hz-demo2', 'Belastung von Rücken und Gelenken durch Heben, Tragen und gebückte Haltung', 2, 2, [m('ms-demo3', 'Teleskopstiele und Reinigungswagen in allen Objekten', 'Objektleitung', day(30))]),
          h('hz-demo3', 'Hautbelastung durch Feuchtarbeit und Handschuhe', 3, 1, [m('ms-demo4', 'Hautschutzplan in jedem Putzraum aushängen', 'Büro', day(-25), 'umgesetzt', { doneAt: day(-20) })]),
        ],
        active: true,
        createdAt: at(day(-200)),
        createdBy: 'Beispieldaten',
      },
      {
        id: 'ev-demo2',
        title: 'Glasreinigung',
        templateId: 'glas',
        objectIds: ['o2', 'o11'],
        participants: 'Geschäftsführung, Sicherheitsfachkraft',
        reviewedAt: addMonths(today, -13),
        reviewedBy: 'Geschäftsführung',
        trigger: null,
        note: '',
        hazards: [
          h('hz-demo4', 'Absturz bei Arbeiten in der Höhe (Fenster, Glasflächen)', 1, 3, [m('ms-demo5', 'Teleskopstangen statt Leitern verwenden', 'Objektleitung', day(-380), 'wirksam', { doneAt: day(-370), checkedAt: day(-300) })]),
          h('hz-demo5', 'Schnittverletzungen an beschädigtem Glas und Klingen', 2, 1, [m('ms-demo6', 'Schaber mit Klingenschutz anschaffen', 'Lager', day(-360), 'umgesetzt', { doneAt: day(-350) })]),
        ],
        active: true,
        createdAt: at(addMonths(today, -13)),
        createdBy: 'Beispieldaten',
      },
      {
        id: 'ev-demo3',
        title: 'Umgang mit Reinigungsmitteln',
        templateId: 'chemie',
        objectIds: [],
        participants: 'Geschäftsführung, Sicherheitsfachkraft, Arbeitsmedizin',
        reviewedAt: day(-90),
        reviewedBy: 'Geschäftsführung',
        trigger: null,
        note: 'Saure Sanitärreiniger nur noch über das Dosiersystem.',
        hazards: [
          h('hz-demo6', 'Verätzung oder Reizung von Haut und Augen', 2, 3, [m('ms-demo7', 'Schutzbrille in jeden Reinigungswagen', 'Lager', day(14)), m('ms-demo8', 'Unterweisung Reinigungsmittel für alle Beschäftigten', 'Objektleitung', day(-3), 'offen', { trainingTypeId: 'chemie' })]),
          h('hz-demo7', 'Gefährliche Reaktion beim Mischen verschiedener Reiniger (z. B. sauer und chlorhaltig)', 1, 3, [m('ms-demo9', 'Dosiersystem statt Umfüllen', 'Geschäftsführung', day(-120), 'wirksam', { doneAt: day(-100), checkedAt: day(-40) })]),
        ],
        active: true,
        createdAt: at(day(-90)),
        createdBy: 'Beispieldaten',
      },
    ],
    settings: {},
  }
}
