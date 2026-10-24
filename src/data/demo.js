// Erfundene Beispieldaten (Raum Salzburg), aufgebaut wie ein typischer
// Reinigungsbetrieb: feste Stammeinsätze je Objekt, 14-tägige Leistungen,
// Sonderleistungen, eine einmalige Grundreinigung, Urlaub und Krankenstand.
// Alle Datumsangaben sind relativ zur übergebenen Woche.

import { addDays } from '../core/dates.js'
import { DEFAULT_RULES } from '../core/rules.js'

const avail = (days, from, to) => Object.fromEntries(days.map((d) => [d, { from, to }]))

export const DEFAULT_SKILLS = ['Grundreinigung', 'Glasreinigung', 'Hygienebereich', 'Führerschein']

export function createDemoData(monday) {
  const day = (n) => addDays(monday, n)

  const employees = [
    { id: 'e1', name: 'Ana Popescu', type: 'Vollzeit', weeklyHours: 40, skills: ['Grundreinigung', 'Hygienebereich'], trained: ['o2', 'o7', 'o11'], availability: { ...avail([1, 2, 3, 4, 5], '05:30', '17:00'), 6: { from: '07:00', to: '15:00' } } },
    { id: 'e2', name: 'Markus Huber', type: 'Teilzeit', weeklyHours: 34, skills: ['Führerschein', 'Glasreinigung'], trained: ['o1', 'o4', 'o6', 'o8'], availability: { ...avail([1, 2, 3, 4, 5], '08:00', '21:30'), ...avail([6, 7], '07:00', '20:00') } },
    { id: 'e3', name: 'Elif Kaya', type: 'Teilzeit', weeklyHours: 30, skills: ['Hygienebereich'], trained: ['o3', 'o7', 'o2'], availability: avail([1, 2, 3, 4, 5], '05:30', '22:00') },
    { id: 'e4', name: 'Dragan Jović', type: 'Vollzeit', weeklyHours: 40, skills: ['Grundreinigung', 'Glasreinigung', 'Führerschein'], trained: ['o3', 'o10', 'o2'], availability: { ...avail([1, 2, 3, 4, 5], '06:00', '20:00'), 6: { from: '07:00', to: '15:00' } } },
    { id: 'e5', name: 'Sandra Pichler', type: 'Teilzeit', weeklyHours: 25, skills: ['Hygienebereich'], trained: ['o8', 'o7'], availability: avail([1, 2, 3, 4, 5], '08:00', '17:30') },
    { id: 'e6', name: 'Tomasz Nowak', type: 'Teilzeit', weeklyHours: 20, skills: ['Führerschein'], trained: ['o4', 'o3', 'o1'], availability: avail([1, 2, 3, 4, 5], '12:00', '21:00') },
    { id: 'e7', name: 'Irina Bogdan', type: 'Geringfügig', weeklyHours: 9, maxMonthHours: 40, skills: [], trained: ['o10', 'o4'], availability: { ...avail([1, 2, 3, 4, 5], '05:30', '09:00'), ...avail([6, 7], '07:00', '20:00') } },
    { id: 'e8', name: 'Lukas Wimmer', type: 'Lehrling', weeklyHours: 32, minor: true, skills: [], trained: ['o5', 'o9'], availability: avail([1, 2, 4, 5], '07:00', '18:00') },
    { id: 'e9', name: 'Gül Arslan', type: 'Teilzeit', weeklyHours: 25, skills: ['Grundreinigung', 'Glasreinigung'], trained: ['o1', 'o9'], availability: { ...avail([1, 2, 3, 4, 5], '07:00', '19:00'), 6: { from: '07:00', to: '15:00' } } },
    { id: 'e10', name: 'Ivana Kovač', type: 'Teilzeit', weeklyHours: 25, skills: ['Hygienebereich', 'Glasreinigung'], trained: ['o2', 'o4', 'o7', 'o8', 'o11'], availability: avail([1, 2, 3, 4, 5, 6], '06:00', '21:00'), note: 'Springerin' },
  ]

  const objects = [
    { id: 'o1', name: 'Steuerkanzlei Schallmoos', short: 'Kanzlei', address: '5020 Salzburg-Schallmoos', color: 1, onlyTrained: false },
    { id: 'o2', name: 'Autohaus Maxglan', short: 'Autohaus', address: '5020 Salzburg-Maxglan', color: 2, onlyTrained: false },
    { id: 'o3', name: 'Logistikzentrum Wals', short: 'Logistik', address: '5071 Wals-Siezenheim', color: 3, onlyTrained: false },
    { id: 'o4', name: 'Tankstelle Itzling', short: 'Tankstelle', address: '5020 Salzburg-Itzling', color: 4, onlyTrained: false },
    { id: 'o5', name: 'Wohnanlage Lehen', short: 'Stiegenhaus', address: '5020 Salzburg-Lehen', color: 5, onlyTrained: false },
    { id: 'o6', name: 'Büro & Container Gnigl', short: 'Gnigl', address: '5020 Salzburg-Gnigl', color: 6, onlyTrained: false },
    { id: 'o7', name: 'Arztpraxis Liefering', short: 'Praxis', address: '5020 Salzburg-Liefering', color: 7, onlyTrained: true },
    { id: 'o8', name: 'Gewerbepark Bergheim', short: 'Bergheim', address: '5101 Bergheim', color: 8, onlyTrained: false },
    { id: 'o9', name: 'Werkstatt Taxham', short: 'Taxham', address: '5020 Salzburg-Taxham', color: 9, onlyTrained: false },
    { id: 'o10', name: 'Fitnessstudio Nord', short: 'Fitness', address: '5020 Salzburg-Itzling', color: 10, onlyTrained: false },
    { id: 'o11', name: 'Versicherungsbüro Lehen', short: 'Versicherung', address: '5020 Salzburg-Lehen', color: 11, onlyTrained: false },
  ]

  const weekly = (weekdays, extra = {}) => ({ type: 'weekly', weekdays, everyWeeks: 1, anchor: monday, ...extra })
  const MO_FR = [1, 2, 3, 4, 5]

  const tasks = [
    { id: 't1', objectId: 'o1', label: 'Büroreinigung', category: 'reinigung', recurrence: weekly([1, 3, 5]), start: '17:30', end: '19:30', staff: 1, regulars: ['e2'], skills: [], holidayRule: 'verschieben' },
    { id: 't2', objectId: 'o2', label: 'Schauraum & Büros', category: 'reinigung', recurrence: weekly(MO_FR), start: '06:00', end: '08:30', staff: 1, regulars: ['e1'], skills: [], holidayRule: 'entfaellt' },
    { id: 't3', objectId: 'o2', label: 'Außenbereich (14-tägig)', category: 'reinigung', recurrence: weekly([4], { everyWeeks: 2, anchor: addDays(monday, 7) }), start: '13:30', end: '15:00', staff: 1, regulars: ['e1'], skills: [], holidayRule: 'entfaellt' },
    { id: 't4', objectId: 'o3', label: 'Lager & Sozialräume', category: 'reinigung', recurrence: weekly(MO_FR), start: '15:00', end: '19:00', staff: 2, regulars: ['e4', 'e3'], skills: [], holidayRule: 'entfaellt' },
    { id: 't5', objectId: 'o3', label: 'Samstagsdienst', category: 'reinigung', recurrence: weekly([6]), start: '08:00', end: '13:00', staff: 1, regulars: ['e4'], skills: [], holidayRule: 'entfaellt' },
    { id: 't18', objectId: 'o3', label: 'Büroetage', category: 'reinigung', recurrence: weekly(MO_FR), start: '14:30', end: '17:00', staff: 1, regulars: ['e6'], skills: [], holidayRule: 'entfaellt' },
    { id: 't6', objectId: 'o4', label: 'Shop & Sanitär', category: 'reinigung', recurrence: weekly(MO_FR), start: '18:00', end: '19:30', staff: 1, regulars: ['e6'], skills: [], holidayRule: 'findet_statt' },
    { id: 't7', objectId: 'o4', label: 'Shop & Sanitär (Wochenende)', category: 'reinigung', recurrence: weekly([6, 7]), start: '18:00', end: '19:30', staff: 1, regulars: ['e2'], skills: [], holidayRule: 'findet_statt' },
    { id: 't8', objectId: 'o5', label: 'Stiegenhäuser', category: 'reinigung', recurrence: weekly([2, 5]), start: '08:00', end: '09:30', staff: 1, regulars: ['e8'], skills: [], holidayRule: 'entfaellt' },
    { id: 't9', objectId: 'o6', label: 'Büro & Container', category: 'reinigung', recurrence: weekly([1, 3]), start: '09:30', end: '11:00', staff: 1, regulars: ['e2'], skills: [], holidayRule: 'entfaellt' },
    { id: 't19', objectId: 'o6', label: 'Werkhalle', category: 'reinigung', recurrence: weekly([2, 4]), start: '10:00', end: '16:30', staff: 1, regulars: ['e2'], skills: [], holidayRule: 'entfaellt' },
    { id: 't20', objectId: 'o6', label: 'Büro & Container', category: 'reinigung', recurrence: weekly([5]), start: '12:00', end: '16:00', staff: 1, regulars: ['e2'], skills: [], holidayRule: 'entfaellt' },
    { id: 't10', objectId: 'o7', label: 'Ordination', category: 'reinigung', recurrence: weekly(MO_FR), start: '19:30', end: '21:30', staff: 1, regulars: ['e3'], skills: ['Hygienebereich'], holidayRule: 'entfaellt' },
    { id: 't12', objectId: 'o8', label: 'Büros & Schmutzfangmatten', category: 'reinigung', recurrence: weekly(MO_FR), start: '08:30', end: '12:30', staff: 1, regulars: ['e5'], skills: [], holidayRule: 'entfaellt' },
    { id: 't11', objectId: 'o8', label: 'Blumen gießen', category: 'sonder', recurrence: weekly([2, 4]), start: '12:30', end: '13:00', staff: 1, regulars: ['e5'], skills: [], holidayRule: 'entfaellt' },
    { id: 't21', objectId: 'o8', label: 'Küche & Sozialraum', category: 'reinigung', recurrence: weekly([3]), start: '13:00', end: '17:00', staff: 1, regulars: ['e5'], skills: [], holidayRule: 'entfaellt' },
    { id: 't13', objectId: 'o9', label: 'Werkstatt & Sanitär', category: 'reinigung', recurrence: weekly([1, 2, 3, 4]), start: '14:00', end: '16:30', staff: 1, regulars: ['e9'], skills: [], holidayRule: 'entfaellt' },
    { id: 't14', objectId: 'o9', label: 'Büro', category: 'reinigung', recurrence: weekly([1, 2, 4, 5]), start: '10:00', end: '12:00', staff: 1, regulars: ['e8'], skills: [], holidayRule: 'entfaellt' },
    { id: 't22', objectId: 'o9', label: 'Halle & Außenanlage', category: 'reinigung', recurrence: weekly([1, 2, 4, 5]), start: '12:30', end: '16:30', staff: 1, regulars: ['e8'], skills: [], holidayRule: 'entfaellt' },
    { id: 't23', objectId: 'o1', label: 'Archiv & Besprechung', category: 'reinigung', recurrence: weekly([2, 4]), start: '08:00', end: '12:00', staff: 1, regulars: ['e9'], skills: [], holidayRule: 'entfaellt' },
    { id: 't24', objectId: 'o1', label: 'Büroreinigung Vormittag', category: 'reinigung', recurrence: weekly([5]), start: '08:00', end: '13:00', staff: 1, regulars: ['e9'], skills: [], holidayRule: 'entfaellt' },
    { id: 't15', objectId: 'o10', label: 'Trainingsfläche & Duschen', category: 'reinigung', recurrence: weekly(MO_FR), start: '06:00', end: '07:45', staff: 1, regulars: ['e7'], skills: [], holidayRule: 'findet_statt' },
    { id: 't25', objectId: 'o10', label: 'Geräte & Umkleiden', category: 'reinigung', recurrence: weekly(MO_FR), start: '10:00', end: '13:00', staff: 1, regulars: ['e4'], skills: [], holidayRule: 'findet_statt' },
    { id: 't26', objectId: 'o11', label: 'Büroetagen', category: 'reinigung', recurrence: weekly(MO_FR), start: '09:00', end: '13:00', staff: 1, regulars: ['e1'], skills: [], holidayRule: 'entfaellt' },
    { id: 't27', objectId: 'o11', label: 'Sanitär & Teeküchen', category: 'reinigung', recurrence: weekly(MO_FR), start: '13:00', end: '17:00', staff: 1, regulars: ['e10'], skills: [], holidayRule: 'entfaellt' },
    { id: 't16', objectId: 'o1', label: 'Grundreinigung Böden', category: 'reinigung', recurrence: { type: 'once', date: day(5) }, start: '08:00', end: '14:30', staff: 2, regulars: [], skills: ['Grundreinigung'], holidayRule: 'findet_statt' },
    { id: 't17', objectId: 'o2', label: 'Glasreinigung Schauraum', category: 'reinigung', recurrence: { type: 'once', date: day(3) }, start: '09:00', end: '12:00', staff: 1, regulars: [], skills: ['Glasreinigung'], holidayRule: 'findet_statt' },
  ]

  const absences = [
    { id: 'a1', employeeId: 'e5', type: 'Urlaub', from: day(0), to: day(4) },
    { id: 'a2', employeeId: 'e6', type: 'Krankenstand', from: day(3), to: day(4) },
    { id: 'a3', employeeId: 'e1', type: 'Zeitausgleich', from: day(4), to: day(4) },
  ]

  // Bewusst eingebautes Problem, damit die Markierungen sichtbar werden:
  // Ana hat Fr Zeitausgleich. Elif wurde händisch als Vertretung eingetragen,
  // putzt aber Do bis 21:30 die Praxis: Ruhezeit nur 8,5 h.
  const assignments = {
    [`${day(3)}|t10`]: [{ employeeId: 'e3', locked: true }],
    [`${day(4)}|t2`]: [{ employeeId: 'e3', locked: true }],
  }

  return {
    version: 1,
    employees,
    objects,
    tasks,
    absences,
    assignments,
    overrides: {},
    skills: [...DEFAULT_SKILLS],
    extraFreeDays: [{ date: `${monday.slice(0, 4)}-12-24`, name: 'Heiliger Abend (betriebsfrei)' }, { date: `${monday.slice(0, 4)}-12-31`, name: 'Silvester (betriebsfrei)' }],
    rules: { ...DEFAULT_RULES, minor: { ...DEFAULT_RULES.minor } },
  }
}
