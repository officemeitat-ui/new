// Erfundene Beispieldaten (Raum Salzburg), aufgebaut wie ein typischer
// Reinigungsbetrieb mit 35 Mitarbeitenden in vier Revieren: feste
// Stammeinsätze je Objekt, 14-tägige Leistungen, Sonderleistungen, eine
// einmalige Grundreinigung, Springer:innen, Urlaub und Krankenstand.
// Alle Datumsangaben sind relativ zur übergebenen Woche. Namen und Objekte
// sind frei erfunden.

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

  // Revier Salzburg Stadt (handverlesen) ergänzen
  employees.forEach((e, i) => Object.assign(e, { team: 'Salzburg Stadt', personnelNo: String(1001 + i), vacationDaysYear: 25 }))
  const budgetFactor = [1, 0.9, 1.05, 1, 1, 0.95, 1.1, 1, 0.85, 1, 1]
  objects.forEach((o, i) => Object.assign(o, { region: 'Salzburg Stadt', budgetHoursMonth: 0, budgetFactor: budgetFactor[i] }))
  Object.assign(objects.find((o) => o.id === 'o7'), {
    keys: [{ id: 'k1', label: 'Praxis Haupteingang', holderId: 'e3' }],
    instructions: 'Zugang über den Hintereingang. Behandlungsräume nur mit Flächendesinfektion laut Hygieneplan. Abfälle aus den Behandlungsräumen getrennt entsorgen.',
    contact: 'Ordinationsassistenz, Mo–Fr bis 18 Uhr',
  })
  Object.assign(objects.find((o) => o.id === 'o4'), { keys: [{ id: 'k2', label: 'Lager/Sanitär', holderId: 'e6' }, { id: 'k3', label: 'Lager/Sanitär (2)', holderId: 'e2' }], instructions: 'Schlüssel für Lager und Sanitär an der Kassa abholen. Zapfsäulenbereich nur nach Rücksprache.' })
  Object.assign(objects.find((o) => o.id === 'o2'), { instructions: 'Schauraum: Glasflächen nur mit Abzieher, keine Mikrofasertücher an den Fahrzeugen.' })

  const generated = generateRegions(monday)
  employees.push(...generated.employees)
  objects.push(...generated.objects)
  tasks.push(...generated.tasks)
  absences.push(...generated.absences)
  setBudgets(objects, tasks)
  for (const o of objects) delete o.budgetFactor

  return {
    version: 1,
    employees,
    objects,
    tasks,
    absences,
    assignments,
    travel: { 'o1|o6': 15, 'o5|o11': 10, 'o4|o10': 10, 'o3|o8': 20 },
    overrides: {},
    skills: [...DEFAULT_SKILLS],
    extraFreeDays: [{ date: `${monday.slice(0, 4)}-12-24`, name: 'Heiliger Abend (betriebsfrei)' }, { date: `${monday.slice(0, 4)}-12-31`, name: 'Silvester (betriebsfrei)' }],
    rules: { ...DEFAULT_RULES, minor: { ...DEFAULT_RULES.minor } },
  }
}

// ---------------------------------------------------------------- Weitere Reviere

// Tagesmuster: Blöcke [Wochentage, Beginn, Ende]
const PROFILES = {
  frueh: { type: 'Vollzeit', hours: 40, avail: { days: [1, 2, 3, 4, 5, 6], from: '05:30', to: '14:00' }, blocks: [[[1, 2, 3, 4, 5], '06:00', '08:30'], [[1, 2, 3, 4, 5], '09:00', '13:00'], [[6], '07:00', '12:00']] },
  tag: { type: 'Vollzeit', hours: 40, avail: { days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }, blocks: [[[1, 2, 3, 4, 5], '08:30', '12:30'], [[1, 2, 3, 4, 5], '13:00', '16:30']] },
  abend: { type: 'Teilzeit', hours: 30, avail: { days: [1, 2, 3, 4, 5], from: '14:30', to: '21:30' }, blocks: [[[1, 2, 3, 4, 5], '15:00', '18:00'], [[1, 2, 3, 4, 5], '18:30', '21:00']] },
  teilfrueh: { type: 'Teilzeit', hours: 20, avail: { days: [1, 2, 3, 4, 5], from: '05:30', to: '12:00' }, blocks: [[[1, 2, 3, 4, 5], '06:00', '10:00']] },
  teilabend: { type: 'Teilzeit', hours: 20, avail: { days: [1, 2, 3, 4, 5], from: '16:30', to: '21:30' }, blocks: [[[1, 2, 3, 4, 5], '17:00', '21:00']] },
  springer: { type: 'Teilzeit', hours: 20, avail: { days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '21:00' }, blocks: [[[1, 3], '07:00', '10:00']] },
  gfg: { type: 'Geringfügig', hours: 9, maxMonthHours: 40, avail: { days: [5, 6, 7], from: '07:00', to: '13:00' }, blocks: [[[6, 7], '07:00', '11:00']] },
}

// [Name, Kurzname, Art, Feiertagsregel, Leistung]
const OBJECT_TYPES = {
  buero: ['Bürogebäude', 'Büro', 'entfaellt', 'Büroreinigung'],
  praxis: ['Arztpraxis', 'Praxis', 'entfaellt', 'Ordination'],
  markt: ['Supermarkt', 'Markt', 'entfaellt', 'Verkaufsfläche & Sozialräume'],
  heim: ['Seniorenwohnheim', 'Heim', 'findet_statt', 'Wohnbereiche'],
  hotel: ['Hotel', 'Hotel', 'findet_statt', 'Zimmer & Gänge'],
  bank: ['Bankfiliale', 'Bank', 'entfaellt', 'Kundenhalle & Büros'],
  stiege: ['Wohnanlage', 'Stiege', 'entfaellt', 'Stiegenhäuser'],
  werk: ['Werkstatt', 'Werkstatt', 'entfaellt', 'Halle & Sanitär'],
  schule: ['Bildungszentrum', 'Bildung', 'entfaellt', 'Klassen & Gänge'],
}

const REGIONS = [
  {
    name: 'Flachgau',
    places: ['Eugendorf', 'Hallwang', 'Seekirchen', 'Neumarkt', 'Straßwalchen', 'Elixhausen', 'Obertrum'],
    types: ['heim', 'buero', 'markt', 'praxis', 'werk', 'bank', 'stiege'],
    people: [
      ['Mirela Stan', 'frueh'], ['Jasmin Hofer', 'tag'], ['Goran Petrović', 'abend'], ['Aylin Yıldız', 'teilfrueh'], ['Katharina Moser', 'teilabend'],
      ['Bogdan Ionescu', 'tag'], ['Nina Lechner', 'abend'], ['Sead Hadžić', 'springer'], ['Renate Gruber', 'gfg'],
    ],
    absence: [5, 'Urlaub', 1, 2],
  },
  {
    name: 'Tennengau',
    places: ['Hallein', 'Kuchl', 'Golling', 'Puch', 'Oberalm', 'Adnet', 'Bad Vigaun'],
    types: ['hotel', 'buero', 'buero', 'bank', 'stiege', 'werk', 'praxis'],
    people: [
      ['Ljiljana Marić', 'frueh'], ['Thomas Brandstätter', 'tag'], ['Emine Çelik', 'abend'], ['Patrik Varga', 'teilfrueh'], ['Silvia Rainer', 'teilabend'],
      ['Adrian Kowalczyk', 'tag'], ['Hana Novotná', 'springer'], ['Franz Eder', 'gfg'],
    ],
    absence: [2, 'Krankenstand', 2, 4],
  },
  {
    name: 'Salzburg Süd',
    places: ['Nonntal', 'Anif', 'Grödig', 'Elsbethen', 'Morzg', 'Herrnau', 'Gneis'],
    types: ['heim', 'buero', 'markt', 'praxis', 'schule', 'bank', 'stiege'],
    people: [
      ['Dana Constantin', 'frueh'], ['Michael Wallner', 'tag'], ['Zeynep Aksoy', 'abend'], ['Ivo Babić', 'teilfrueh'], ['Monika Steiner', 'teilabend'],
      ['Daniel Horvath', 'tag'], ['Maja Kranjc', 'springer'], ['Elfriede Moos', 'gfg'],
    ],
    absence: null,
  },
]

const regionAvail = ({ days, from, to }) => Object.fromEntries(days.map((d) => [d, { from, to }]))

function generateRegions(monday) {
  const employees = []
  const objects = []
  const tasks = []
  const absences = []
  let empNo = 11
  let objNo = 12
  let taskNo = 100
  let color = 1
  for (const region of REGIONS) {
    const regionObjects = region.types.map((type, i) => {
      const [name, short, , ] = OBJECT_TYPES[type]
      const obj = {
        id: `o${objNo++}`,
        name: `${name} ${region.places[i]}`,
        short: `${short} ${region.places[i].split(' ').pop().slice(0, 9)}`,
        address: `${region.places[i]}, ${region.name}`,
        color: (color++ % 12) + 1,
        region: region.name,
        onlyTrained: type === 'praxis' || type === 'bank',
        type,
        budgetFactor: [1, 0.92, 1.08, 1, 0.88, 1.04, 1][i],
      }
      if (type === 'bank') obj.instructions = 'Alarmanlage: Code persönlich beim Objektleiter. Tresorraum nicht betreten.'
      if (type === 'heim') obj.instructions = 'Bewohnerzimmer nur nach Anklopfen. Pflegebereiche mit Desinfektionsmittel laut Hygieneplan.'
      return obj
    })
    objects.push(...regionObjects)
    const daily = regionObjects.find((o) => o.type === 'heim' || o.type === 'hotel')
    const weekdayObjects = regionObjects.filter((o) => o !== daily)
    let rr = 0
    const regionEmployees = []
    for (const [name, profileId] of region.people) {
      const p = PROFILES[profileId]
      const emp = {
        id: `e${empNo}`,
        name,
        personnelNo: String(1000 + empNo),
        type: p.type,
        weeklyHours: p.hours,
        team: region.name,
        vacationDaysYear: 25,
        skills: profileId === 'springer' ? ['Hygienebereich', 'Glasreinigung', 'Grundreinigung'] : profileId === 'frueh' || profileId === 'tag' ? ['Hygienebereich'] : [],
        trained: [],
        availability: regionAvail(p.avail),
      }
      empNo++
      if (p.maxMonthHours) emp.maxMonthHours = p.maxMonthHours
      if (profileId === 'springer') emp.note = 'Springer:in'
      for (const [days, start, end] of p.blocks) {
        const weekend = days.every((d) => d >= 6)
        const obj = weekend ? daily : weekdayObjects[rr++ % weekdayObjects.length]
        const [, , holidayRule, label] = OBJECT_TYPES[obj.type]
        tasks.push({
          id: `t${taskNo++}`,
          objectId: obj.id,
          label: weekend ? `${label} (Wochenende)` : label,
          category: 'reinigung',
          recurrence: { type: 'weekly', weekdays: days, everyWeeks: 1, anchor: monday },
          start,
          end,
          staff: 1,
          regulars: [emp.id],
          skills: obj.type === 'praxis' && emp.skills.includes('Hygienebereich') ? ['Hygienebereich'] : [],
          holidayRule,
        })
        if (!emp.trained.includes(obj.id)) emp.trained.push(obj.id)
      }
      regionEmployees.push(emp)
    }
    // Springer:innen sind in allen Objekten ihres Reviers eingeschult
    for (const emp of regionEmployees) if (emp.note) emp.trained = regionObjects.map((o) => o.id)
    // Wochentags-Dienst im Heim/Hotel (täglich), von der Frühschicht abgedeckt
    const early = regionEmployees.find((e) => e.availability[1]?.from === '05:30' && e.type === 'Vollzeit')
    if (early) {
      const t = tasks.find((x) => x.regulars[0] === early.id && x.start === '06:00')
      if (t) {
        t.objectId = daily.id
        t.label = OBJECT_TYPES[daily.type][3]
        t.holidayRule = 'findet_statt'
      }
      if (!early.trained.includes(daily.id)) early.trained.push(daily.id)
    }
    // Schlüssel bei der Stammkraft von Bank und Praxis
    for (const o of regionObjects.filter((x) => x.onlyTrained)) {
      const holder = tasks.find((t) => t.objectId === o.id)?.regulars[0]
      if (holder) o.keys = [{ id: `k${o.id}`, label: 'Haupteingang', holderId: holder }]
    }
    // Sonderleistung und 14-tägige Leistung je Revier
    const office = regionObjects.find((o) => o.type === 'buero')
    const springer = regionEmployees.find((e) => e.note)
    tasks.push({ id: `t${taskNo++}`, objectId: office.id, label: 'Blumen gießen', category: 'sonder', recurrence: { type: 'weekly', weekdays: [2, 4], everyWeeks: 1, anchor: monday }, start: '07:30', end: '08:00', staff: 1, regulars: springer ? [springer.id] : [], skills: [], holidayRule: 'entfaellt' })
    tasks.push({ id: `t${taskNo++}`, objectId: office.id, label: 'Glasreinigung (14-tägig)', category: 'reinigung', recurrence: { type: 'weekly', weekdays: [5], everyWeeks: 2, anchor: monday }, start: '13:30', end: '16:30', staff: 1, regulars: springer ? [springer.id] : [], skills: ['Glasreinigung'], holidayRule: 'verschieben' })
    if (region.absence) {
      const [idx, type, fromDay, toDay] = region.absence
      absences.push({ id: `a${region.name.slice(0, 3)}`, employeeId: regionEmployees[idx].id, type, from: addDays(monday, fromDay), to: addDays(monday, toDay) })
    }
    for (const o of regionObjects) delete o.type
    employees.push(...regionEmployees)
  }
  return { employees, objects, tasks, absences }
}

/** Budget (Sollstunden laut Kalkulation) je Objekt aus dem Stammplan, mit Abweichungen zur Veranschaulichung. */
function setBudgets(objects, tasks) {
  for (const o of objects) {
    let weekly = 0
    for (const t of tasks) {
      if (t.objectId !== o.id || t.recurrence.type !== 'weekly') continue
      const [sh, sm] = t.start.split(':').map(Number)
      const [eh, em] = t.end.split(':').map(Number)
      let dur = eh * 60 + em - (sh * 60 + sm)
      if (dur <= 0) dur += 1440
      if (dur > 360) dur -= 30
      weekly += (dur * t.staff * t.recurrence.weekdays.length) / (t.recurrence.everyWeeks || 1)
    }
    o.budgetHoursMonth = Math.round(((weekly * 4.33) / 60) * (o.budgetFactor ?? 1))
  }
}
