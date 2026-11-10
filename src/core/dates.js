// Datumshilfen. Ein Datum ist immer ein String 'YYYY-MM-DD', Zeitpunkte sind
// Minuten seit 1970-01-01 00:00 (Wanduhrzeit, ohne Zeitzonen). Für Dauer und
// Ruhezeit über eine Zeitumstellung hinweg gibt es dstMinutes().

const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')

export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
export const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
export const MONTH_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

// Tag ↔ Tagesnummer und Uhrzeit → Minuten je Wert nur einmal rechnen: Einsätze, Wochenzettel und Kennzahlen fragen
// dieselben Tage zehntausendfach. Reine Funktionen, das Ergebnis bleibt gleich; je Merker höchstens 20 000 Einträge.
const DAY_INDEX = new Map()
const DAY_OF_INDEX = new Map()
const MINUTES = new Map()
const remember = (map, key, value) => {
  if (map.size >= 20000) map.clear()
  map.set(key, value)
  return value
}

export function dayIndex(date) {
  const hit = DAY_INDEX.get(date)
  if (hit !== undefined) return hit
  const [y, m, d] = date.split('-').map(Number)
  const idx = Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
  return typeof date === 'string' ? remember(DAY_INDEX, date, idx) : idx
}

export function fromDayIndex(idx) {
  const hit = DAY_OF_INDEX.get(idx)
  if (hit !== undefined) return hit
  const dt = new Date(idx * DAY_MS)
  const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
  return typeof idx === 'number' ? remember(DAY_OF_INDEX, idx, date) : date
}

export const addDays = (date, n) => fromDayIndex(dayIndex(date) + n)

/** 1 = Montag … 7 = Sonntag */
export function isoWeekday(date) {
  // Tag 0 (1970-01-01) war ein Donnerstag; wie new Date(…).getUTCDay(), ohne Datumsobjekt
  const w = (((dayIndex(date) + 4) % 7) + 7) % 7
  return w === 0 ? 7 : w
}

export const mondayOf = (date) => addDays(date, 1 - isoWeekday(date))

export function isoWeek(date) {
  const thursday = addDays(date, 4 - isoWeekday(date))
  const year = Number(thursday.slice(0, 4))
  return { year, week: Math.floor((dayIndex(thursday) - dayIndex(`${year}-01-01`)) / 7) + 1 }
}

export function weeksBetween(a, b) {
  return Math.round((dayIndex(mondayOf(b)) - dayIndex(mondayOf(a))) / 7)
}

export function eachDay(from, to) {
  const out = []
  for (let i = dayIndex(from), end = dayIndex(to); i <= end; i++) out.push(fromDayIndex(i))
  return out
}

export const firstOfMonth = (date) => `${date.slice(0, 7)}-01`

export function lastOfMonth(date) {
  const [y, m] = date.split('-').map(Number)
  return fromDayIndex(Math.round(Date.UTC(y, m, 0) / DAY_MS))
}

export const daysInMonth = (date) => Number(lastOfMonth(date).slice(8))

/** Monate zwischen zwei Daten (nur Jahr/Monat zählen). */
export function monthsBetween(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
}

export function toMinutes(time) {
  const hit = MINUTES.get(time)
  if (hit !== undefined) return hit
  const [h, m] = String(time).split(':').map(Number)
  const min = h * 60 + (m || 0)
  return typeof time === 'string' ? remember(MINUTES, time, min) : min
}

export function formatTime(min) {
  const m = ((min % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export function formatDate(date, { weekday = true, year = false } = {}) {
  const [y, m, d] = date.split('-')
  const s = `${d}.${m}.${year ? y : ''}`
  return weekday ? `${WEEKDAY_SHORT[isoWeekday(date) - 1]} ${s}` : s
}

const hoursFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 })

/** Minuten → Stunden im österreichischen Format, z. B. 450 → "7,5" */
export const formatHours = (min) => hoursFormat.format(Math.round((min / 60) * 100) / 100)

/** Heutiges Datum (oder das Datum eines Zeitpunkts) in der Zeit des Geräts – nicht in UTC wie toISOString(). */
const VIENNA_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' })
/** Kalendertag in Wien (JJJJ-MM-TT) für einen Zeitpunkt (ISO-Text oder ms), nicht der UTC-Tag: „angenommen am“ um 0:30 Uhr ist schon der neue Tag. */
export function viennaDate(when) {
  const d = new Date(when)
  return Number.isNaN(d.getTime()) ? '' : VIENNA_DATE.format(d)
}

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** „03/2027“, „3.2027“, „2027-03“ oder ein Datum → „2027-03“ (sonst „“) */
export function parseMonth(text) {
  const s = String(text || '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  m = s.match(/^(?:\d{1,2}\.)?(\d{1,2})[./](\d{4})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`
  return ''
}

/** „15.03.2027“ oder „2027-03-15“ → „2027-03-15“ (sonst „“) */
export function parseDate(text) {
  const s = String(text || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
}

const DST_CACHE = new Map()
/** Umstellungen der Sommerzeit (EU, also Österreich) als Wanduhr-Minuten um 02:00. */
function dstSwitches(year) {
  if (!DST_CACHE.has(year)) {
    const lastSunday = (month) => {
      const last = lastOfMonth(`${year}-${month}-01`)
      return addDays(last, -(isoWeekday(last) % 7))
    }
    DST_CACHE.set(year, { spring: dayIndex(lastSunday('03')) * 1440 + 120, autumn: dayIndex(lastSunday('10')) * 1440 + 120 })
  }
  return DST_CACHE.get(year)
}

/**
 * Korrektur in Minuten für eine Spanne von Wanduhrzeit a bis b über eine
 * Zeitumstellung: im März fehlt eine Stunde (−60), im Oktober gibt es sie
 * doppelt (+60). Echte Dauer = b − a + dstMinutes(a, b).
 */
export function dstMinutes(a, b) {
  if (!(b > a)) return 0
  let correction = 0
  const from = Number(fromDayIndex(Math.floor(a / 1440)).slice(0, 4))
  const to = Number(fromDayIndex(Math.floor(b / 1440)).slice(0, 4))
  for (let year = from; year <= to; year++) {
    const { spring, autumn } = dstSwitches(year)
    if (a <= spring && b >= spring + 60) correction -= 60
    if (a <= autumn && b >= autumn + 60) correction += 60
  }
  return correction
}
