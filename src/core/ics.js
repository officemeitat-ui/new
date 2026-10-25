// Ganztägiger Termin als iCalendar-Datei (.ics), z. B. für die Nachkontrolle.
// Öffnet sich in Outlook, Apple- und Google-Kalender; braucht keine
// Berechtigung (Alternative zum direkten Eintrag über Microsoft Graph).

import { addDays } from './dates.js'

const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** Zeilen über 75 Byte falten (RFC 5545), ohne UTF-8-Zeichen zu zerteilen. */
function fold(line) {
  const enc = new TextEncoder()
  const parts = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (parts.length ? 74 : 75)) {
      parts.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** { uid, date: 'JJJJ-MM-TT', title, description?, location?, remindHours? } → Inhalt der .ics-Datei */
export function icsEvent({ uid, date, title, description = '', location = '', remindHours = 15, now = new Date() }) {
  const day = (iso) => iso.replace(/-/g, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dienstplan//Objektkontrolle//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;VALUE=DATE:${day(date)}`,
    `DTEND;VALUE=DATE:${day(addDays(date, 1))}`,
    `SUMMARY:${text(title)}`,
    ...(location ? [`LOCATION:${text(location)}`] : []),
    ...(description ? [`DESCRIPTION:${text(description)}`] : []),
    'TRANSP:TRANSPARENT',
    ...(remindHours ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(title)}`, `TRIGGER:-PT${remindHours}H`, 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}
