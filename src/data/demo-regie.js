// Beispieldaten für die Regieberichte (Vorschau im Browser-Modus), relativ zu heute: Wohnanlage Lehen mit einem
// unterschriebenen Wasserschaden-Einsatz (zwei Personen, Material, noch nicht verrechnet), Autohaus Maxglan mit einer
// Grundreinigung ohne Unterschrift (niemand vor Ort) und Kindergarten Aigen mit Zusatzarbeiten von heute, noch offen.
// Alles erfunden; die Unterschrift ist eine Linie wie aus dem Unterschriftsfeld.

import { addDays, todayISO } from '../core/dates.js'

const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100"><path d="M24 70L34 52L42 66L52 40L60 72L72 48L84 64L96 58M112 70L120 46L126 70M118 60L130 58M146 44L144 72L160 66M176 70C190 30 206 30 214 56L226 66L250 54" fill="none" stroke="#13232f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function createRegieDemo(today = todayISO()) {
  const day = (n) => addDays(today, n)
  const at = (d, t = '15:30') => `${d}T${t}:00.000Z`
  const y = today.slice(0, 4)
  const base = { orderRef: '', photos: [], email: '', pdf: null, sent: [], stock: null, billing: null, createdBy: 'Beispieldaten' }
  return {
    reports: [
      {
        ...base,
        id: 'rb-demo1',
        no: `RB-${y}-0001`,
        objectId: 'o5',
        date: day(-3),
        kind: 'wasserschaden',
        title: 'Keller nach Rohrbruch',
        description: 'Wasser im Kellergang und Waschküche abgesaugt, Boden gereinigt und desinfiziert, Bautrockner aufgestellt.',
        orderedBy: 'Paul Muster',
        orderedRole: 'Hausverwaltung',
        orderRef: 'HV-2207',
        workers: [
          { id: 'rw-demo1', employeeId: 'e4', name: 'Dragan Jović', from: '07:30', to: '11:30', pause: 0, minutes: 240 },
          { id: 'rw-demo2', employeeId: 'e9', name: 'Gül Arslan', from: '07:30', to: '10:00', pause: 0, minutes: 150 },
        ],
        material: [
          { id: 'rm-demo1', articleId: 'a-demo1', text: 'Allzweckreiniger 1 l', qty: 2, unit: 'Fl.' },
          { id: 'rm-demo2', articleId: '', text: 'Flächendesinfektion 5 l', qty: 1, unit: 'Kanister' },
        ],
        status: 'abgeschlossen',
        signature: { name: 'Herbert Beispiel', role: 'Hausbetreuung', svg: SIG, at: at(day(-3), '10:40'), by: 'Beispieldaten' },
        unsigned: null,
        stock: { status: 'hinweis', at: at(day(-3), '10:41'), by: 'Beispieldaten' },
        createdAt: at(day(-3), '07:20'),
        closedAt: at(day(-3), '10:40'),
        closedBy: 'Beispieldaten',
      },
      {
        ...base,
        id: 'rb-demo2',
        no: `RB-${y}-0002`,
        objectId: 'o2',
        date: day(-1),
        kind: 'grundreinigung',
        title: 'Werkstattboden maschinell',
        description: 'Werkstattboden mit der Einscheibenmaschine grundgereinigt, Ölflecken entfernt.',
        orderedBy: 'Max Beispiel',
        orderedRole: 'Kunde',
        workers: [{ id: 'rw-demo3', employeeId: 'e1', name: 'Ana Popescu', from: '', to: '', pause: 0, minutes: 210 }],
        material: [],
        status: 'abgeschlossen',
        signature: null,
        unsigned: { reason: 'niemand vor Ort, Bestätigung per E-Mail', at: at(day(-1), '19:05'), by: 'Beispieldaten' },
        createdAt: at(day(-1), '16:00'),
        closedAt: at(day(-1), '19:05'),
        closedBy: 'Beispieldaten',
      },
      {
        ...base,
        id: 'rb-demo3',
        no: `RB-${y}-0003`,
        objectId: 'o90',
        date: day(0),
        kind: 'zusatz',
        title: 'Turnsaal nach dem Fest',
        description: '',
        orderedBy: 'Leitung',
        orderedRole: 'Kunde',
        workers: [{ id: 'rw-demo4', employeeId: 'e10', name: 'Ivana Kovač', from: '13:00', to: '15:00', pause: 0, minutes: 120 }],
        material: [{ id: 'rm-demo3', articleId: 'a-demo8', text: 'Müllsäcke 120 l', qty: 1, unit: 'Rolle' }],
        status: 'offen',
        signature: null,
        unsigned: null,
        createdAt: at(day(0), '12:50'),
      },
    ],
    settings: {},
  }
}
