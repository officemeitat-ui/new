// Beispieldaten für die Kundenzufriedenheit (Vorschau im Browser-Modus), relativ zu heute: vier Runden (die letzten
// drei Quartale abgeschlossen, das laufende offen), fünf Kunden. Versicherungsbüro Lehen wird von Runde zu Runde
// schlechter und wünscht jetzt einen Rückruf (Gesamt 2), die Steuerkanzlei ist sehr zufrieden, die Hausverwaltung
// antwortet für die Wohnanlage Lehen. Alles erfunden, keine echten Personen oder Telefonnummern.

import { addDays, todayISO } from '../core/dates.js'
import { newRound, periodFromIndex, periodIndex, periodOf, periodRange, settingsOf } from '../core/zufriedenheit.js'

const LINKS = [
  { id: 'kb00000de001', title: 'Hausverwaltung Muster', objectIds: ['o5', 'o4'] },
  { id: 'kb00000de002', title: 'Versicherungsbüro Lehen', objectIds: ['o11'] },
  { id: 'kb00000de003', title: 'Steuerkanzlei Schallmoos', objectIds: ['o1'] },
  { id: 'kb00000de004', title: 'Autohaus Maxglan', objectIds: ['o2'] },
  { id: 'kb00000de005', title: 'Arztpraxis Liefering', objectIds: ['o7'] },
]

export function createZufriedenheitDemo(today = todayISO()) {
  const settings = { rhythm: 'quartal', days: 28 }
  const questions = settingsOf({ settings }).questions
  const cur = periodIndex(periodOf(today))
  const rounds = []
  const answers = []
  let n = 0
  // [Kunde (Index in LINKS), Gesamt, Einzelfragen (Sauberkeit, Zuverlässigkeit, Personal, Büro), Weiterempfehlung, Freitext, Extras]
  const plan = [
    [
      [0, 4, [4, 5, 4, 4], 8, ''],
      [1, 5, [5, 5, 5, 4], 10, 'Sehr gründlich, danke an das Team.'],
      [2, 5, [5, 5, 5, 5], 10, ''],
      [3, 4, [4, 4, 5, 3], 8, 'Rückmeldungen vom Büro dauern manchmal länger.'],
    ],
    [
      [0, 4, [4, 4, 5, 4], 9, ''],
      [1, 4, [4, 4, 5, 4], 8, ''],
      [2, 5, [5, 5, 5, 5], 9, 'Alles bestens.'],
    ],
    [
      [0, 5, [5, 5, 5, 4], 10, 'Das neue Team im Stiegenhaus macht das sehr gut.', { objectId: 'o5' }],
      [1, 3, [3, 3, 4, 3], 6, 'Die Teeküche ist öfter nicht gemacht.'],
      [2, 5, [5, 4, 5, 5], 10, ''],
      [4, 4, [4, 4, 4, 4], 7, ''],
    ],
    [
      [1, 2, [2, 2, 3, 2], 3, 'Seit dem Personalwechsel sind die Sanitärräume nicht sauber. Bitte um Rückruf.', { callback: true, phone: '0662 000000', name: 'Erika Beispiel', role: 'Büroleitung' }],
      [2, 5, [5, 5, 5, 4], 9, ''],
    ],
  ]
  for (let i = 0; i < 4; i++) {
    const period = periodFromIndex(cur - 3 + i)
    const range = periodRange(period)
    const running = i === 3
    const from = running ? addDays(today, -10) : addDays(range.from, 14)
    const until = running ? addDays(today, 18) : addDays(from, 27)
    const r = newRound({ period, from, until, questions, links: running ? LINKS.slice(0, 4) : LINKS, by: 'Petra Leitner', at: `${from}T08:00:00.000Z` })
    r.publishedAt = `${from}T08:01:00.000Z`
    r.invites = (running ? LINKS.slice(0, 3) : LINKS).map((l, k) => ({ linkId: l.id, to: `kunde${k + 1}@beispiel.example`, at: `${from}T08:05:00.000Z`, by: 'Petra Leitner', via: 'graph' }))
    rounds.push(r)
    for (const [li, overall, vals, nps, comment, extra = {}] of plan[i]) {
      const link = LINKS[li]
      const at = `${addDays(from, 2 + (n % 5))}T${String(8 + (n % 9)).padStart(2, '0')}:15:00.000Z`
      const serverId = `de${String(++n).padStart(10, '0')}`
      answers.push({
        id: `kz${serverId}`,
        serverId,
        roundId: period,
        linkId: link.id,
        linkTitle: link.title,
        objectIds: [...link.objectIds],
        objectId: extra.objectId || '',
        at,
        overall,
        scores: Object.fromEntries(questions.items.map((q, k) => [q.id, vals[k]])),
        nps,
        comment,
        callback: !!extra.callback,
        phone: extra.phone || '',
        name: extra.name || '',
        role: extra.role || '',
        takenAt: at,
        takenBy: 'Petra Leitner',
        done: null,
      })
    }
  }
  return { settings, links: {}, rounds, answers }
}
