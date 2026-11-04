// Jahreszeiten-Looks für Cleo und die Übersicht: welcher Anlass an einem Tag gilt (Wiener Zeit).
// Reine Rechnung ohne Browser (getestet in test/season.test.js).
//
//   silvester  27. Dez. bis 6. Jän. (Silvester und Neujahr bis Heilige Drei Könige)
//   fasching   11. Nov. (Faschingsbeginn) und Unsinniger Donnerstag bis Faschingsdienstag
//   ostern     Palmsonntag bis Ostermontag
//   fruehjahr  15. März bis 20. April (Frühjahrsputz), außer zu Ostern und im Fasching
//   halloween  24. Okt. bis 1. Nov.
//   advent     1. Adventsonntag bis 26. Dez. (Stefanitag)

import { addDays } from './dates.js'

export const SEASONS = {
  halloween: { label: 'Halloween', outfit: 'hexe', mood: 'kuerbis', hello: 'Huch – Halloween! Keine Sorge, Spinnweben entferne ich gratis.' },
  advent: { label: 'Advent und Weihnachten', outfit: 'nikolaus', mood: 'geschenk', hello: 'Frohe Adventzeit! Ich bring Glanz in jede Stiege – und in deinen Dienstplan.' },
  silvester: { label: 'Silvester und Neujahr', outfit: 'party', mood: 'feiert', hello: 'Prosit Neujahr! Nach der Party räum ich das Konfetti weg.' },
  fasching: { label: 'Fasching', outfit: 'narr', mood: 'krapfen', hello: 'Lei lei! Im Fasching gibt’s bei mir Krapfen – und keine Konfetti-Reste.' },
  ostern: { label: 'Ostern', outfit: 'hase', mood: 'korb', hello: 'Frohe Ostern! Die Eier versteck ich, den Staub nicht.' },
  fruehjahr: { label: 'Frühjahrsputz', outfit: 'tuch', mood: 'wedel', hello: 'Frühjahrsputz! Fenster auf, Staubwedel raus – ich bin dabei.' },
}

/** Ostersonntag (gregorianisch, Algorithmus nach Gauß/Meeus) als „JJJJ-MM-TT“. */
export function easter(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 1. Adventsonntag: der Sonntag zwischen 27. Nov. und 3. Dez. */
export function firstAdvent(year) {
  const d = new Date(Date.UTC(year, 10, 27))
  d.setUTCDate(27 + ((7 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

/** Heutiges Datum in Wien („JJJJ-MM-TT“), unabhängig von der Zeitzone des Geräts. */
export const viennaDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

/** Anlass an einem Tag („JJJJ-MM-TT“) oder ''. */
export function seasonOn(day) {
  const year = Number(day.slice(0, 4))
  const md = day.slice(5)
  if (md >= '12-27' || md <= '01-06') return 'silvester'
  const e = easter(year)
  if (day >= addDays(e, -7) && day <= addDays(e, 1)) return 'ostern'
  if (md === '11-11' || (day >= addDays(e, -52) && day <= addDays(e, -47))) return 'fasching'
  if (md >= '03-15' && md <= '04-20') return 'fruehjahr'
  if (md >= '10-24' && md <= '11-01') return 'halloween'
  if (day >= firstAdvent(year) && md <= '12-26') return 'advent'
  return ''
}

/**
 * Welcher Look gilt: pref 'aus' schaltet ab, ein Anlass als pref oder ?saison=… erzwingt ihn (zum Testen),
 * sonst nach Datum. query: Wert von ?saison= (oder '').
 */
export function pickSeason({ day, pref = 'auto', query = '' } = {}) {
  if (query) return SEASONS[query] ? query : ''
  if (pref === 'aus') return ''
  if (SEASONS[pref]) return pref
  return seasonOn(day)
}
