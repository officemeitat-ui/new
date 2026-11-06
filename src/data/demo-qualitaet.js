// Beispieldaten für die Qualitätsmessung (Vorschau im Browser-Modus), relativ zu heute: Versicherungsbüro Lehen mit
// sechs Messungen (zuletzt zweimal nicht erfüllt, Kennzahl fällt: Reklamationsgefahr, Nachkontrolle bald fällig),
// Steuerkanzlei Schallmoos (AQL 6,5, alles erfüllt), Bürogebäude Hallwang im Revier Flachgau (eine schlechte Messung,
// Nachkontrolle überfällig), Kindergarten Aigen mit Raumgruppen, aber noch ohne Messung. Alles erfunden.

import { addDays, todayISO } from '../core/dates.js'
import { evaluate, newMeasurement, settingsOf } from '../core/qualitaet.js'

export function createQualitaetDemo(today = todayISO()) {
  const settings = settingsOf(null)
  const group = (id, name, template, rooms, names = []) => ({ id, name, template, rooms, names })
  const objects = [
    {
      objectId: 'o11',
      groups: [group('qg-o11-1', 'Büro', 'buero', 18), group('qg-o11-2', 'Sanitär', 'sanitaer', 6, ['WC Damen EG', 'WC Herren EG', 'WC Damen 1. OG', 'WC Herren 1. OG', 'WC barrierefrei', 'Dusche']), group('qg-o11-3', 'Verkehrsflächen', 'verkehr', 4, ['Eingang', 'Stiegenhaus', 'Gang EG', 'Gang 1. OG']), group('qg-o11-4', 'Teeküche', 'kueche', 2)],
      aql: '',
      accept: '',
      target: '',
      email: 'hausverwaltung@beispiel.example',
      note: 'Messung monatlich mit der Büroleitung',
    },
    { objectId: 'o1', groups: [group('qg-o1-1', 'Büro', 'buero', 10), group('qg-o1-2', 'Sanitär', 'sanitaer', 3), group('qg-o1-3', 'Verkehrsflächen', 'verkehr', 2), group('qg-o1-4', 'Küche', 'kueche', 1)], aql: 6.5, accept: '', target: '', email: '', note: '' },
    { objectId: 'o13', groups: [group('qg-o13-1', 'Büro', 'buero', 40), group('qg-o13-2', 'Sanitär', 'sanitaer', 8), group('qg-o13-3', 'Verkehrsflächen', 'verkehr', 6), group('qg-o13-4', 'Küche', 'kueche', 3)], aql: '', accept: '', target: '', email: '', note: '' },
    { objectId: 'o90', groups: [group('qg-o90-1', 'Gruppenräume', 'sonstige', 4), group('qg-o90-2', 'Sanitär', 'sanitaer', 3), group('qg-o90-3', 'Garderobe und Gang', 'verkehr', 2), group('qg-o90-4', 'Küche', 'kueche', 1)], aql: '', accept: '', target: '', email: '', note: '' },
  ]
  const measurements = []
  let n = 0
  // Mängel: [Raumgruppe (Name), Prüfobjekt, Fehlerarten, Notiz] – je Eintrag ein anderer Raum der Gruppe, wo es geht
  const measure = (objectId, days, defects, extra = {}) => {
    const conf = objects.find((o) => o.objectId === objectId)
    const date = addDays(today, days)
    const at = `${date}T09:30:00.000Z`
    const m = newMeasurement({ id: `qm-demo${++n}`, conf, settings, date, seed: 1000 + n * 7, by: 'Petra Leitner', at, ...extra })
    const used = new Map()
    for (const [groupName, itemId, defs, note = ''] of defects) {
      const rooms = m.rooms.filter((r) => r.group === groupName)
      const room = rooms[(used.get(groupName) || 0) % Math.max(1, rooms.length)] || m.rooms[0]
      used.set(groupName, (used.get(groupName) || 0) + 1)
      const it = room.items.find((x) => x.id === itemId) || room.items[0]
      Object.assign(it, { state: 'mangel', defects: [...defs], note })
    }
    for (const r of m.rooms) r.checked = true
    Object.assign(m, { status: 'fertig', finishedAt: at })
    m.result = evaluate(m)
    measurements.push(m)
    return m
  }
  // Versicherungsbüro: gut, dann zweimal nicht erfüllt (die zweite ist die Nachkontrolle der ersten)
  measure('o11', -152, [['Büro', 'boden', ['staub']]])
  measure('o11', -121, [['Sanitär', 'verbrauch', ['material']]])
  measure('o11', -91, [['Sanitär', 'sanitaer', ['kalk']]])
  measure('o11', -61, [['Teeküche', 'spuele', ['flecken']]])
  const bad1 = measure('o11', -33, [['Büro', 'boden', ['flecken'], 'Kaffeeflecken beim Drucker'], ['Sanitär', 'sanitaer', ['kalk']]])
  measure('o11', -5, [['Büro', 'boden', ['staub']], ['Büro', 'abfall', ['abfall']], ['Sanitär', 'sanitaer', ['kalk'], 'Urinstein im Urinal'], ['Sanitär', 'verbrauch', ['material']], ['Verkehrsflächen', 'boden', ['rueckstand']]], { recheckOf: bad1.id })
  // Steuerkanzlei: AQL 6,5, alles erfüllt
  measure('o1', -100, [])
  measure('o1', -70, [['Büro', 'glas', ['finger']]])
  measure('o1', -40, [])
  measure('o1', -12, [['Sanitär', 'glas', ['streifen']]])
  // Bürogebäude Hallwang: einmal nicht erfüllt, Nachkontrolle überfällig
  measure('o13', -20, [['Büro', 'abfall', ['abfall']], ['Büro', 'oberflaechen', ['staub']], ['Sanitär', 'verbrauch', ['material']]])
  return { settings: {}, objects, measurements }
}
