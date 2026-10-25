// Beispieldaten für die Module Zählerstände, Objektkontrolle und Objektmappe.
// Alles erfunden; Werte und Termine relativ zur angezeigten Woche, damit
// die Vorschau immer etwas Fälliges, Auffälliges und Offenes zeigt.

import { addDays } from '../core/dates.js'
import { periodFor, prevPeriod } from '../core/meters.js'
import { OBJEKTKONTROLLE_CHECKLIST } from './checklist-objektkontrolle.js'

/** Zählstellen mit sechs Quartalen Verlauf; die fällige Runde ist zur Hälfte erfasst. */
function demoMeters(monday) {
  const due = periodFor(addDays(monday, -7))
  const periods = [due]
  for (let i = 0; i < 6; i++) periods.unshift(prevPeriod(periods[0], 'quartal'))
  const meters = []
  const readings = []
  const add = (id, objectId, location, number, perQuarter, extra = {}) => {
    meters.push({ id, objectId, number, kind: extra.kind || 'kaltwasser', unit: extra.unit || 'm³', interval: 'quartal', location, history: [], ...(extra.objektNr ? { objektNr: extra.objektNr } : {}), ...(extra.note ? { note: extra.note } : {}) })
    let value = extra.start ?? 100
    periods.forEach((p, i) => {
      const last = i === periods.length - 1
      if (last && !extra.dueDone) return
      const season = /Q3/.test(p.key) ? 1.3 : 1
      value = Math.round((value + perQuarter * season * (last && extra.leak ? 3.2 : 1)) * 10) / 10
      readings.push({ id: `${id}-${p.key}`, meterId: id, period: p.key, date: addDays(p.to, last ? 3 : -1), value, by: 'Mario Kovač', at: `${p.to}T09:00:00.000Z` })
    })
    if (extra.reason) readings.push({ id: `${id}-${due.key}`, meterId: id, period: due.key, date: addDays(due.to, 2), value: null, reason: extra.reason, note: 'Mieter nicht angetroffen', by: 'Mario Kovač', at: `${due.to}T09:30:00.000Z` })
  }
  add('S-lehen-01', 'o5', 'Stiege 1 · Top 1', 'A20481', 14, { objektNr: '520001', dueDone: true })
  add('S-lehen-02', 'o5', 'Stiege 1 · Top 2', 'A20482', 22, { objektNr: '520001', dueDone: true, leak: true })
  add('S-lehen-03', 'o5', 'Stiege 1 · Top 3', 'A20483', 9, { objektNr: '520001', reason: 'kein_zutritt' })
  add('S-lehen-04', 'o5', 'Stiege 2 · Top 4', 'A20484', 17, { objektNr: '520002' })
  add('S-lehen-05', 'o5', 'Stiege 2 · Top 5', 'A20485', 12, { objektNr: '520002', note: 'Zähler im Badezimmer hinter der Revisionsklappe' })
  add('S-lehen-06', 'o5', 'Hauptzähler Keller', 'H7712', 88, { objektNr: '520000', note: 'Schlüssel Kellerabteil in der Hausmeisterbox', dueDone: true, start: 4200 })
  add('S-bergheim-01', 'o8', 'Halle A · Unterverteilung', 'E-55102', 2400, { kind: 'strom', unit: 'kWh', start: 81000 })
  add('S-bergheim-02', 'o8', 'Halle A · Wasser', 'B33310', 31, { start: 900 })
  add('S-kanzlei-01', 'o1', 'Teeküche', 'K-1180', 6, { dueDone: true })
  // Tausch in der vorletzten Runde (Top 4): alter Zähler bis 260, neuer ab 0
  const swap = readings.find((r) => r.id === `S-lehen-04-${periods[4].key}`)
  if (swap) {
    const before = readings.find((r) => r.id === `S-lehen-04-${periods[3].key}`)
    swap.swap = { oldNumber: 'A11904', newNumber: 'A20484', oldEnd: Math.round((before.value + 8) * 10) / 10, newStart: 0 }
    swap.value = 9.5
    for (const r of readings.filter((x) => x.meterId === 'S-lehen-04' && x.period > periods[4].key)) r.value = Math.round((r.value - swap.swap.oldEnd + 1.5) * 10) / 10
    meters.find((m) => m.id === 'S-lehen-04').history.push({ at: `${swap.date}T10:00:00.000Z`, date: swap.date, type: 'tausch', from: 'A11904', to: 'A20484', by: 'Mario Kovač' })
  }
  return { meters, readings, closures: { [`o5|${periods[5].key}`]: { at: `${addDays(periods[5].to, 20)}T12:00:00.000Z`, by: 'Büro' } } }
}

/** Kontrollen: Wohnanlage mit offenen Mängeln, Kanzlei sehr gut, Praxis fällig. */
function demoInspections(monday) {
  const ago = (d) => addDays(monday, -d)
  const ok = (ids) => Object.fromEntries(ids.map((id) => [id, { rating: 'OK' }]))
  const allIds = OBJEKTKONTROLLE_CHECKLIST.chapters.flatMap((ch, i) => ch.items.map((_, j) => `${i + 1}.${j + 1}`))
  const inspections = [
    {
      id: 'k-lehen-1',
      objectId: 'o5',
      checklistId: 'objektkontrolle',
      date: ago(118),
      time: '09:10',
      inspector: 'Mario Kovač',
      kind: 'Regelkontrolle',
      status: 'abgeschlossen',
      closedAt: `${ago(118)}T10:30:00.000Z`,
      items: { ...ok(allIds), '1.4': { rating: 'M', note: 'Wasserfleck an der Decke Stiege 2, 3. OG', prio: '2' }, '6.1': { rating: 'NA' }, '6.2': { rating: 'NA' }, '6.3': { rating: 'NA' }, '6.4': { rating: 'NA' } },
      summary: { overall: 'Gut', text: 'Objekt insgesamt in gutem Zustand. Wasserfleck an Hausverwaltung gemeldet.' },
    },
    {
      id: 'k-lehen-2',
      objectId: 'o5',
      checklistId: 'objektkontrolle',
      date: ago(26),
      time: '08:45',
      inspector: 'Mario Kovač',
      kind: 'Regelkontrolle',
      status: 'abgeschlossen',
      closedAt: `${ago(26)}T10:05:00.000Z`,
      items: {
        ...ok(allIds),
        '1.4': { rating: 'M', note: 'Wasserfleck Stiege 2 weiterhin sichtbar, größer geworden', prio: '2' },
        '4.1': { rating: 'M', note: 'Zwei Leuchten Stiege 1, 2. OG defekt', prio: '2', assignee: 'e5', due: addDays(monday, 2) },
        '7.3': { rating: 'R', note: 'Müllraum: lose Abfälle neben den Tonnen', prio: '3', assignee: 'e5', due: addDays(monday, 1) },
        '8.2': { rating: 'G', note: 'Gehwegplatte beim Hauseingang lose, abgesichert', prio: '1', assignee: '', due: addDays(monday, -3) },
        '6.1': { rating: 'NA' }, '6.2': { rating: 'NA' }, '6.3': { rating: 'NA' }, '6.4': { rating: 'NA' },
      },
      summary: { overall: 'Kritisch', text: 'Stolperstelle beim Hauseingang abgesichert, Hausverwaltung informiert. Reinigung Müllraum durch Stammkraft.', followUp: true, followUpDate: addDays(monday, 8) },
    },
    {
      id: 'k-kanzlei-1',
      objectId: 'o1',
      checklistId: 'objektkontrolle',
      date: ago(40),
      time: '07:30',
      inspector: 'Mario Kovač',
      kind: 'Regelkontrolle',
      status: 'abgeschlossen',
      closedAt: `${ago(40)}T08:20:00.000Z`,
      items: { ...ok(allIds), '7.2': { rating: 'R', note: 'Papiertonne falsch befüllt', prio: '3' } },
      summary: { overall: 'Sehr gut', text: 'Sehr guter Gesamteindruck.' },
    },
    {
      id: 'k-praxis-1',
      objectId: 'o7',
      checklistId: 'objektkontrolle',
      date: ago(104),
      time: '18:15',
      inspector: 'Mario Kovač',
      kind: 'Regelkontrolle',
      status: 'abgeschlossen',
      closedAt: `${ago(104)}T19:00:00.000Z`,
      items: ok(allIds),
      summary: { overall: 'Sehr gut', text: '' },
    },
  ]
  return { checklists: [OBJEKTKONTROLLE_CHECKLIST], plans: { o5: { months: 3 }, o1: { months: 3 }, o7: { months: 3 }, o2: { months: 6 } }, inspections }
}

/** Objektmappe der Wohnanlage und der Praxis. */
function demoMappe() {
  return {
    objects: {
      o5: {
        customerNo: '10042',
        customer: 'Hausverwaltung Muster GmbH',
        objectNo: '520000',
        kind: 'Wohnhaus',
        contract: 'Rahmenvertrag 2026',
        validFrom: '2026-01-01',
        hvEmail: 'hausverwaltung@example.at',
        contacts: [
          { name: 'Fr. Berger', role: 'Hausverwaltung', phone: '+43 662 000000', mail: 'hausverwaltung@example.at' },
          { name: 'Hr. Lindner', role: 'Hausbesorger', phone: '+43 660 0000000', note: 'Mo–Fr 7–12 Uhr', internal: true },
        ],
        access: [
          { label: 'Haupteingang Stiege 1+2', number: 'S-14', type: 'Schlüssel', count: 2, place: 'Schlüsselkasten Büro', confidential: true },
          { label: 'Müllraum / Keller', number: 'S-15', type: 'Schlüssel', count: 1, place: 'Hausmeisterbox (Code bei der Disposition erfragen)', confidential: true },
        ],
        devices: [{ label: 'Nass-Trockensauger', place: 'Kellerabteil 3', owner: 'eigen', inventoryNo: 'G-0112' }],
        areas: [
          { name: 'Stiegenhaus Stiege 1+2', location: 'EG–3. OG', size: 240, floor: 'Kunststein', services: [
            { what: 'Böden kehren und feucht wischen', interval: 'w2', minutes: 40, method: 'Wischmopp' },
            { what: 'Handläufe, Türgriffe, Lichtschalter', interval: 'w2', minutes: 10 },
            { what: 'Glasflächen Eingangstüren', interval: 'w1', minutes: 15, method: 'Abzieher' },
            { what: 'Spinnweben, Heizkörper, Fensterbänke', interval: 'm1', minutes: 45 },
          ] },
          { name: 'Müllraum und Hof', location: 'Hof', services: [
            { what: 'Müllraum kehren, Tonnenplatz säubern', interval: 'w1', minutes: 15 },
            { what: 'Tonnen raus- und reinstellen', interval: 'w2', minutes: 10 },
          ] },
          { name: 'Keller', location: 'UG', services: [{ what: 'Kellergänge kehren', interval: 'm1', minutes: 30 }] },
        ],
        notes: 'Parken im Hof erlaubt. Bei Wasserschäden sofort Hausbesorger und Hausverwaltung verständigen.',
        attachments: [{ name: 'Grundriss Stiegenhaus', url: 'https://example.sharepoint.com/sites/firma/Objekte/Lehen/Grundriss.pdf' }],
      },
      o7: {
        customerNo: '10077',
        customer: 'Ordination Dr. Muster',
        kind: 'Arztpraxis',
        contacts: [{ name: 'Ordinationsassistenz', role: 'Ansprechperson vor Ort', phone: '+43 662 111111' }],
        access: [{ label: 'Hintereingang', number: 'P-1', type: 'Transponder', count: 1, place: 'bei Stammkraft', confidential: true }],
        areas: [
          { name: 'Behandlungsräume', size: 60, floor: 'PVC', services: [{ what: 'Flächendesinfektion laut Hygieneplan', interval: 't5', minutes: 30 }, { what: 'Böden nass wischen', interval: 't5', minutes: 20 }] },
          { name: 'Wartebereich und Empfang', size: 40, services: [{ what: 'Böden saugen und wischen', interval: 't5', minutes: 15 }, { what: 'Glasflächen', interval: 'w1', minutes: 20 }] },
        ],
      },
    },
  }
}

export function createModuleDemo(monday) {
  return { zaehler: demoMeters(monday), kontrolle: demoInspections(monday), mappe: demoMappe() }
}

