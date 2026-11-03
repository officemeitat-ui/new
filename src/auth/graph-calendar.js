// Outlook-Kalender der angemeldeten Person über Microsoft Graph (delegiert, Calendars.ReadWrite):
// Termin anlegen (mit Teilnehmenden, Ort, optional Teams-Besprechung) und Termine eines Zeitraums lesen.
// Zeiten in Wiener Ortszeit („W. Europe Standard Time“ ist der Windows-Name der Zeitzone).

export const TIME_ZONE = 'W. Europe Standard Time'
const GRAPH = 'https://graph.microsoft.com/v1.0'

async function graph(token, path, { method = 'GET', body, headers = {}, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${GRAPH}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error?.message || ''
    } catch {
      /* keine Details */
    }
    if (res.status === 403) throw new Error(`Keine Berechtigung für den Kalender (Calendars.ReadWrite freigeben). ${detail}`.trim())
    throw new Error(`Kalender: Fehler ${res.status}. ${detail}`.trim())
  }
  return res.status === 204 ? null : res.json()
}

/** Ortszeit „2026-11-04T12:00“ → Graph-Zeit „2026-11-04T12:00:00“. */
const local = (t) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t)

/**
 * Termin anlegen. event: { subject, start, end (Ortszeit YYYY-MM-DDTHH:MM), location, body, attendees: [{ email, name }], online }
 * Liefert { id, webLink, onlineMeetingUrl }.
 */
export async function createEvent(token, event, opts = {}) {
  const body = {
    subject: event.subject,
    start: { dateTime: local(event.start), timeZone: TIME_ZONE },
    end: { dateTime: local(event.end), timeZone: TIME_ZONE },
    ...(event.location ? { location: { displayName: event.location } } : {}),
    ...(event.body ? { body: { contentType: 'Text', content: event.body } } : {}),
    attendees: (event.attendees || []).map((a) => ({ emailAddress: { address: a.email, name: a.name || a.email }, type: 'required' })),
    ...(event.online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
  }
  const res = await graph(token, '/me/events', { method: 'POST', body, ...opts })
  return { id: res.id, webLink: res.webLink || '', onlineMeetingUrl: res.onlineMeeting?.joinUrl || '' }
}

/** Termine von–bis (Ortszeit), sortiert: [{ subject, start, end, location, attendees, organizer }] */
export async function listEvents(token, { from, to }, opts = {}) {
  const q = new URLSearchParams({ startDateTime: `${from}T00:00:00`, endDateTime: `${to}T23:59:59`, $select: 'subject,start,end,location,attendees,organizer,isAllDay', $orderby: 'start/dateTime', $top: '50' })
  const res = await graph(token, `/me/calendarView?${q}`, { headers: { Prefer: `outlook.timezone="${TIME_ZONE}"` }, ...opts })
  return (res.value || []).map((e) => ({
    subject: e.subject || '',
    start: String(e.start?.dateTime || '').slice(0, 16),
    end: String(e.end?.dateTime || '').slice(0, 16),
    allDay: !!e.isAllDay,
    location: e.location?.displayName || '',
    attendees: (e.attendees || []).map((a) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean),
    organizer: e.organizer?.emailAddress?.name || '',
  }))
}
