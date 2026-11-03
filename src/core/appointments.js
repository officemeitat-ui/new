// Termine (Kundentermin, Objektbegehung, Kontrolle, Schulung, Werkstatt, intern):
// in der App gespeichert (termine/termine.json) und als Outlook-Termin der Person,
// die ihn anlegt, mit Einladung an alle Teilnehmenden. Exchange trägt die Einladung
// bei den Eingeladenen von selbst (vorläufig) in den Kalender ein; mit Zusage wird sie fix.
//
// Zeiten sind Wiener Ortszeit („2026-11-04T12:00“). Mitarbeitende aus dem Dienstplan
// (employeeIds) erscheinen zusätzlich in der Zeitlinie und bei Konflikten mit Einsätzen.

import { addDays } from './dates.js'

export const APPOINTMENT_KINDS = [
  ['kunde', 'Kundentermin'],
  ['begehung', 'Objektbegehung'],
  ['kontrolle', 'Qualitätskontrolle'],
  ['schulung', 'Schulung / Unterweisung'],
  ['werkstatt', 'Werkstatt'],
  ['bewerbung', 'Bewerbungsgespräch'],
  ['intern', 'Intern / Besprechung'],
  ['sonstiges', 'Sonstiges'],
]
export const kindLabel = (k) => APPOINTMENT_KINDS.find(([id]) => id === k)?.[1] || 'Termin'

export const REMINDERS = [
  [0, 'keine Erinnerung'],
  [15, '15 Minuten vorher'],
  [30, '30 Minuten vorher'],
  [60, '1 Stunde vorher'],
  [1440, '1 Tag vorher'],
]

export const emptyAppointments = () => ({ items: [], settings: {} })

/** Wiederholung: repeat { freq, until?, count? }, einzelne abgesagte Tage in exdates. */
export const REPEATS = [
  ['', 'keine Wiederholung'],
  ['weekly', 'jede Woche'],
  ['biweekly', 'alle 2 Wochen'],
  ['monthly', 'jeden Monat am selben Tag'],
  ['monthlyNth', 'jeden Monat am selben Wochentag (z. B. 2. Dienstag)'],
]
const WEEKDAY_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const NTH = ['first', 'second', 'third', 'fourth', 'last']
const NTH_DE = ['1.', '2.', '3.', '4.', 'letzten']
const WEEKDAY_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const utcDay = (d) => new Date(`${d}T12:00:00Z`)
const iso = (dt) => dt.toISOString().slice(0, 10)
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
/** Welcher Wochentag im Monat (0 = erster … 4 = letzter, wenn es der letzte ist). */
function nthOf(date) {
  const d = utcDay(date)
  const n = Math.floor((d.getUTCDate() - 1) / 7)
  const last = d.getUTCDate() + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth())
  return last && n >= 3 ? 4 : n
}
function nthWeekday(y, m, weekday, n) {
  if (n === 4) {
    const last = daysInMonth(y, m)
    const wd = new Date(Date.UTC(y, m, last)).getUTCDay()
    return iso(new Date(Date.UTC(y, m, last - ((wd - weekday + 7) % 7))))
  }
  const firstWd = new Date(Date.UTC(y, m, 1)).getUTCDay()
  const day = 1 + ((weekday - firstWd + 7) % 7) + n * 7
  return day <= daysInMonth(y, m) ? iso(new Date(Date.UTC(y, m, day))) : null
}

/** Text der Wiederholung: „jede Woche am Montag bis 31.12.“ */
export function repeatText(a, formatDate = (d) => d) {
  const r = a.repeat
  if (!r?.freq) return ''
  const d = utcDay(dateOf(a.start))
  const wd = WEEKDAY_DE[d.getUTCDay()]
  const base = { weekly: `jede Woche am ${wd}`, biweekly: `alle 2 Wochen am ${wd}`, monthly: `jeden Monat am ${d.getUTCDate()}.`, monthlyNth: `jeden ${NTH_DE[nthOf(dateOf(a.start))]} ${wd} im Monat` }[r.freq] || ''
  return `${base}${r.until ? ` bis ${formatDate(r.until)}` : r.count ? `, ${r.count}-mal` : ''}`
}

/**
 * Termine einer Serie im Zeitraum (je Vorkommen eine Kopie mit verschobenem Beginn/Ende und occ = Datum).
 * Ohne Wiederholung: der Termin selbst. exdates: abgesagte einzelne Tage.
 */
export function occurrences(a, from, to, { max = 400 } = {}) {
  if (!a.repeat?.freq) return [a]
  const first = dateOf(a.start)
  const span = Math.round((Date.parse(`${dateOf(a.end || a.start)}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 864e5)
  const until = a.repeat.until || '9999-12-31'
  const count = Number(a.repeat.count) || 0
  const ex = new Set(a.exdates || [])
  const out = []
  const shift = (date) => {
    const delta = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 864e5)
    const move = (t) => (t ? `${iso(new Date(Date.parse(`${dateOf(t)}T12:00:00Z`) + delta * 864e5))}T${timeOf(t) || '00:00'}` : t)
    return { ...a, start: move(a.start), end: move(a.end), occ: date, series: a.id }
  }
  const start = utcDay(first)
  const wd = start.getUTCDay()
  const dom = start.getUTCDate()
  const nth = nthOf(first)
  let n = 0
  for (let i = 0; i < 2000 && out.length < max; i++) {
    let date
    if (a.repeat.freq === 'weekly' || a.repeat.freq === 'biweekly') date = iso(new Date(start.getTime() + i * (a.repeat.freq === 'weekly' ? 7 : 14) * 864e5))
    else {
      const y = start.getUTCFullYear() + Math.floor((start.getUTCMonth() + i) / 12)
      const m = (start.getUTCMonth() + i) % 12
      date = a.repeat.freq === 'monthly' ? (dom <= daysInMonth(y, m) ? iso(new Date(Date.UTC(y, m, dom))) : null) : nthWeekday(y, m, wd, nth)
      if (!date) continue
    }
    if (date > until || date > to) break
    n++
    if (count && n > count) break
    const endDay = iso(new Date(utcDay(date).getTime() + span * 864e5))
    if (endDay < from || ex.has(date)) continue
    out.push(shift(date))
  }
  return out
}

/** Wiederholung für Outlook (Graph recurrence). */
export function graphRecurrence(a) {
  const r = a.repeat
  if (!r?.freq) return null
  const startDate = dateOf(a.start)
  const d = utcDay(startDate)
  const day = WEEKDAY_EN[d.getUTCDay()]
  const pattern = {
    weekly: { type: 'weekly', interval: 1, daysOfWeek: [day], firstDayOfWeek: 'monday' },
    biweekly: { type: 'weekly', interval: 2, daysOfWeek: [day], firstDayOfWeek: 'monday' },
    monthly: { type: 'absoluteMonthly', interval: 1, dayOfMonth: d.getUTCDate() },
    monthlyNth: { type: 'relativeMonthly', interval: 1, daysOfWeek: [day], index: NTH[nthOf(startDate)] },
  }[r.freq]
  if (!pattern) return null
  const range = r.until ? { type: 'endDate', startDate, endDate: r.until } : r.count ? { type: 'numbered', startDate, numberOfOccurrences: Number(r.count) } : { type: 'noEnd', startDate }
  return { pattern, range }
}

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
export const dateOf = (t) => String(t || '').slice(0, 10)
export const timeOf = (t) => String(t || '').slice(11, 16)
/** Minuten seit Mitternacht des Tages `date` (auch über Mitternacht hinaus). */
export function minutesFrom(date, t) {
  const d = dateOf(t)
  const [h, m] = timeOf(t).split(':').map(Number)
  const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 864e5)
  return days * 1440 + (h || 0) * 60 + (m || 0)
}
/** Ortszeit plus Minuten. */
export function addMinutes(t, minutes) {
  const total = minutesFrom(dateOf(t), t) + minutes
  const day = addDays(dateOf(t), Math.floor(total / 1440))
  const rest = ((total % 1440) + 1440) % 1440
  return `${day}T${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
}

/** Prüft einen Termin; liefert Fehlertexte (leer = in Ordnung). */
export function validateAppointment(a) {
  const errors = []
  if (!String(a.title || '').trim()) errors.push('Bitte einen Titel eingeben.')
  if (a.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOf(a.start))) errors.push('Bitte ein Datum wählen.')
    if (a.end && dateOf(a.end) < dateOf(a.start)) errors.push('Das Ende liegt vor dem Beginn.')
  } else {
    if (!TIME.test(a.start || '')) errors.push('Bitte Datum und Beginn wählen.')
    if (!TIME.test(a.end || '')) errors.push('Bitte das Ende wählen.')
    else if (a.end <= a.start) errors.push('Das Ende liegt vor dem Beginn.')
  }
  for (const x of a.attendees || []) if (x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)) errors.push(`Keine gültige E-Mail-Adresse: ${x.email}`)
  if (a.repeat?.freq && a.repeat.until && a.repeat.until < dateOf(a.start)) errors.push('Die Wiederholung endet vor dem ersten Termin.')
  return errors
}

/** Erster und letzter Tag eines Termins. */
export function daysOf(a) {
  const from = dateOf(a.start)
  const to = a.allDay ? dateOf(a.end || a.start) : dateOf(a.end) > from && timeOf(a.end) === '00:00' ? addDays(dateOf(a.end), -1) : dateOf(a.end || a.start)
  return { from, to: to < from ? from : to }
}

/** Termine, die den Zeitraum berühren (ohne abgesagte), nach Beginn sortiert. */
export function appointmentsBetween(items = [], from, to, { cancelled = false } = {}) {
  return items
    .filter((a) => (cancelled || !a.cancelled) && a.start)
    .flatMap((a) => occurrences(a, from, to))
    .filter((a) => {
      const d = daysOf(a)
      return d.from <= to && d.to >= from
    })
    .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0))
}

/** Teil eines Termins an einem Tag in Minuten seit Mitternacht ({ start, end }); ganztägig: null. */
export function dayPart(a, date) {
  if (a.allDay) return null
  const start = Math.max(0, minutesFrom(date, a.start))
  const end = Math.min(1440, minutesFrom(date, a.end))
  return end > start ? { start, end } : null
}

/** Einladungsliste: Teilnehmende plus Mitarbeitende mit E-Mail; doppelte Adressen nur einmal. */
export function inviteList(a, employeesById = new Map()) {
  const seen = new Set()
  const out = []
  const add = (email, name, extra = {}) => {
    const key = String(email || '').trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ email: key, name: name || key, ...extra })
  }
  for (const x of a.attendees || []) add(x.email, x.name, x.optional ? { optional: true } : {})
  for (const id of a.employeeIds || []) {
    const e = employeesById.get(id)
    if (e?.email) add(e.email, e.name)
  }
  return out
}

/** Mitarbeitende des Termins: angegebene plus Teilnehmende, deren E-Mail zu einer Person im Dienstplan passt. */
export function employeesOf(a, employees = []) {
  const byMail = new Map(employees.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e.id]))
  const ids = new Set(a.employeeIds || [])
  for (const x of a.attendees || []) {
    const id = byMail.get(String(x.email || '').toLowerCase())
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Einsätze, die sich mit dem Termin überschneiden, je Person:
 * instancesOf(empId) → Einsätze mit { date, start, end (Minuten ab Wochenbeginn wie im Plan), startTime, endTime, objectId }.
 * dayIndexOf(date) → Tagesnummer wie im Plan (Minuten = Tag * 1440 + Uhrzeit).
 */
export function conflicts(a, { employeeIds = [], instancesOf, dayIndexOf }) {
  if (a.allDay || !TIME.test(a.start || '') || !TIME.test(a.end || '')) return []
  const out = []
  const day = dateOf(a.start)
  const base = dayIndexOf(day) * 1440
  const s = base + minutesFrom(day, a.start)
  const e = base + minutesFrom(day, a.end)
  for (const empId of employeeIds)
    for (const inst of instancesOf(empId) || []) if (inst.start < e && inst.end > s) out.push({ empId, inst })
  return out
}

/** Text für die Einladung (Notiz, Objekt, Hinweis auf die App). */
export function inviteText(a, { objectName = '', objectAddress = '', appName = 'App', link = '' } = {}) {
  return [a.note || '', objectName ? `Objekt: ${objectName}${objectAddress ? `, ${objectAddress}` : ''}` : '', `Eingetragen in der ${appName}${link ? `: ${link}` : ''}.`].filter(Boolean).join('\n\n')
}

/**
 * Outlook-Termin (Microsoft Graph) aus einem Termin der App.
 * Ganztägig: Beginn 00:00, Ende 00:00 des Folgetags (so verlangt es Outlook).
 */
export function graphEvent(a, { employeesById = new Map(), timeZone = 'W. Europe Standard Time', body = '', location = '' } = {}) {
  const at = (t) => ({ dateTime: `${t}:00`, timeZone })
  const start = a.allDay ? `${dateOf(a.start)}T00:00` : a.start
  const end = a.allDay ? `${addDays(dateOf(a.end || a.start), 1)}T00:00` : a.end
  const reminder = Number(a.reminder ?? 15)
  return {
    subject: a.title,
    start: at(start),
    end: at(end),
    isAllDay: !!a.allDay,
    location: { displayName: location || a.location || '' },
    body: { contentType: 'Text', content: body || a.note || '' },
    attendees: inviteList(a, employeesById).map((x) => ({ emailAddress: { address: x.email, name: x.name }, type: x.optional ? 'optional' : 'required' })),
    isReminderOn: reminder > 0,
    ...(reminder > 0 ? { reminderMinutesBeforeStart: reminder } : {}),
    responseRequested: a.responseRequested !== false,
    showAs: a.allDay ? 'free' : 'busy',
    ...(a.online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    categories: a.category ? [a.category] : [],
    ...(graphRecurrence(a) ? { recurrence: graphRecurrence(a) } : {}),
  }
}

/** Stand in Outlook: 'aus' (nicht eingetragen), 'ok', 'offen' (Änderung noch nicht übertragen), 'fehler'. */
export function outlookState(a) {
  if (!a.outlook) return a.sync === false ? 'aus' : 'offen'
  if (a.outlook.error) return 'fehler'
  if (a.outlook.dirty) return 'offen'
  return 'ok'
}

/** Kurzform für Listen: „Mi 04.11. 12:00–13:00“ bzw. „Mi 04.11. ganztägig“. */
export function whenText(a, formatDate) {
  const d = daysOf(a)
  if (a.allDay) return d.to > d.from ? `${formatDate(d.from)} – ${formatDate(d.to)}, ganztägig` : `${formatDate(d.from)}, ganztägig`
  return dateOf(a.end) === dateOf(a.start) ? `${formatDate(d.from)} ${timeOf(a.start)}–${timeOf(a.end)}` : `${formatDate(d.from)} ${timeOf(a.start)} – ${formatDate(dateOf(a.end))} ${timeOf(a.end)}`
}

/** Termin für eine .ics-Datei (ohne Microsoft-Anmeldung): Daten für core/ics.js. */
export function icsData(a) {
  return {
    uid: `${a.id}@termine`,
    date: dateOf(a.start),
    time: a.allDay ? '' : timeOf(a.start),
    minutes: a.allDay ? 0 : Math.max(5, minutesFrom(dateOf(a.start), a.end) - minutesFrom(dateOf(a.start), a.start)),
    title: a.title,
    description: a.note || '',
    location: a.location || '',
    remindHours: Number(a.reminder ?? 15) >= 60 ? Math.round(Number(a.reminder) / 60) : 0,
    rrule: rruleOf(a),
  }
}

/** RRULE für .ics (Serie). */
export function rruleOf(a) {
  const r = a.repeat
  if (!r?.freq) return ''
  const d = utcDay(dateOf(a.start))
  const by = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getUTCDay()]
  const rule = { weekly: `FREQ=WEEKLY;BYDAY=${by}`, biweekly: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${by}`, monthly: `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}`, monthlyNth: `FREQ=MONTHLY;BYDAY=${nthOf(dateOf(a.start)) === 4 ? -1 : nthOf(dateOf(a.start)) + 1}${by}` }[r.freq]
  return `${rule}${r.until ? `;UNTIL=${r.until.replace(/-/g, '')}T235959` : r.count ? `;COUNT=${Number(r.count)}` : ''}`
}
