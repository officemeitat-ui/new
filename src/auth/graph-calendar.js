// Termin im Outlook-Kalender der angemeldeten Person über Microsoft Graph
// (ganztägig, z. B. Nachkontrolle). Braucht die delegierte Berechtigung
// Calendars.ReadWrite; nur angefragt, wenn config.json → features.calendar
// eingeschaltet ist (siehe docs/EINRICHTUNG.md).

import { addDays } from '../core/dates.js'

/**
 * @param getToken  Funktion, die ein Graph-Token liefert
 * @param event     { title, date: 'JJJJ-MM-TT', text, location? }
 * @param id        vorhandener Termin: wird geändert statt neu angelegt
 * @returns         { id, webLink }
 */
export async function saveEvent(getToken, { title, date, text = '', location = '' }, { id = '', fetchImpl = fetch, timeZone = 'W. Europe Standard Time', remindHours = 15 } = {}) {
  const body = {
    subject: title,
    body: { contentType: 'Text', content: text },
    start: { dateTime: `${date}T00:00:00`, timeZone },
    end: { dateTime: `${addDays(date, 1)}T00:00:00`, timeZone },
    isAllDay: true,
    showAs: 'free',
    isReminderOn: true,
    reminderMinutesBeforeStart: remindHours * 60,
    ...(location ? { location: { displayName: location } } : {}),
  }
  const url = `https://graph.microsoft.com/v1.0/me/events${id ? `/${encodeURIComponent(id)}` : ''}`
  let res = await fetchImpl(url, { method: id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  // Termin wurde in Outlook gelöscht: neu anlegen
  if (id && res.status === 404) return saveEvent(getToken, { title, date, text, location }, { fetchImpl, timeZone, remindHours })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error?.message || ''
    } catch {
      /* keine Details */
    }
    if (res.status === 403) throw new Error(`Keine Berechtigung für den Kalender (Calendars.ReadWrite freigeben). ${detail}`)
    throw new Error(`Termin nicht eingetragen (${res.status}). ${detail}`)
  }
  const ev = await res.json()
  return { id: ev.id, webLink: ev.webLink || '' }
}
