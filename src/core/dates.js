// Datumshilfen. Ein Datum ist immer ein String 'YYYY-MM-DD', Zeitpunkte sind
// Minuten seit 1970-01-01 00:00 (Wanduhrzeit, ohne Zeitzonen/Sommerzeit).

const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')

export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
export const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
export const MONTH_LONG = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export function dayIndex(date) {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function fromDayIndex(idx) {
  const dt = new Date(idx * DAY_MS)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export const addDays = (date, n) => fromDayIndex(dayIndex(date) + n)

/** 1 = Montag … 7 = Sonntag */
export function isoWeekday(date) {
  const w = new Date(dayIndex(date) * DAY_MS).getUTCDay()
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

export function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + (m || 0)
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

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
