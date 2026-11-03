// Outlook-Kalender der angemeldeten Person über Microsoft Graph (delegiert, Calendars.ReadWrite):
// Termin anlegen (mit Teilnehmenden, Ort, optional Teams-Besprechung) und Termine eines Zeitraums lesen.
// Zeiten in Wiener Ortszeit („W. Europe Standard Time“ ist der Windows-Name der Zeitzone).

export const TIME_ZONE = 'W. Europe Standard Time'
const GRAPH = 'https://graph.microsoft.com/v1.0'

async function graph(token, path, { method = 'GET', body, headers = {}, fetchImpl = fetch, scope = 'Calendars.ReadWrite' } = {}) {
  const res = await fetchImpl(`${GRAPH}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error?.message || ''
    } catch {
      /* keine Details */
    }
    if (res.status === 403) throw Object.assign(new Error(`Keine Berechtigung (${scope} freigeben). ${detail}`.trim()), { status: 403 })
    throw Object.assign(new Error(`Kalender: Fehler ${res.status}. ${detail}`.trim()), { status: res.status })
  }
  // 202/204 (z. B. Absage) ohne Inhalt
  const text = res.status === 204 ? '' : await res.text()
  return text ? JSON.parse(text) : null
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
  const q = new URLSearchParams({ startDateTime: `${from}T00:00:00`, endDateTime: `${to}T23:59:59`, $select: 'id,iCalUId,subject,start,end,location,attendees,organizer,isAllDay,showAs,isCancelled', $orderby: 'start/dateTime', $top: '100' })
  const res = await graph(token, `/me/calendarView?${q}`, { headers: { Prefer: `outlook.timezone="${TIME_ZONE}"` }, ...opts })
  return (res.value || []).filter((e) => !e.isCancelled).map((e) => ({
    id: e.id || '',
    iCalUId: e.iCalUId || '',
    showAs: e.showAs || 'busy',
    subject: e.subject || '',
    start: String(e.start?.dateTime || '').slice(0, 16),
    end: String(e.end?.dateTime || '').slice(0, 16),
    allDay: !!e.isAllDay,
    location: e.location?.displayName || '',
    attendees: (e.attendees || []).map((a) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean),
    organizer: e.organizer?.emailAddress?.name || '',
  }))
}

// ---------------------------------------------------------------- Termine der App (Modul Termine)

const eventResult = (res) => ({ id: res.id, iCalUId: res.iCalUId || '', webLink: res.webLink || '', onlineMeetingUrl: res.onlineMeeting?.joinUrl || '', organizer: res.organizer?.emailAddress?.address || '' })

/** Outlook-Termin aus fertigem Graph-Inhalt anlegen (core/appointments.js → graphEvent). transactionId verhindert Doppelte bei Wiederholung. */
export async function createGraphEvent(token, payload, { transactionId, ...opts } = {}) {
  const res = await graph(token, '/me/events', { method: 'POST', body: { ...payload, ...(transactionId ? { transactionId } : {}) }, ...opts })
  return eventResult(res)
}

/** Outlook-Termin ändern (nur wer ihn angelegt hat); die Eingeladenen bekommen die Änderung. */
export async function updateGraphEvent(token, id, payload, opts = {}) {
  const res = await graph(token, `/me/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, ...opts })
  return eventResult(res || { id })
}

/** Absagen: die Eingeladenen bekommen eine Absage, der Termin verschwindet aus den Kalendern. */
export async function cancelGraphEvent(token, id, comment = '', opts = {}) {
  try {
    await graph(token, `/me/events/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { comment }, ...opts })
  } catch (err) {
    // ohne Eingeladene (oder schon abgesagt) gibt es nichts abzusagen: dann löschen
    if (err.status === 400 || err.status === 404) await graph(token, `/me/events/${encodeURIComponent(id)}`, { method: 'DELETE', ...opts }).catch((e) => (e.status === 404 ? null : Promise.reject(e)))
    else throw err
  }
}

/** Antworten der Eingeladenen: [{ email, name, response: 'accepted'|'declined'|'tentativelyAccepted'|'none' }] */
export async function eventResponses(token, id, opts = {}) {
  const res = await graph(token, `/me/events/${encodeURIComponent(id)}?$select=attendees`, opts)
  return (res.attendees || []).map((a) => ({ email: String(a.emailAddress?.address || '').toLowerCase(), name: a.emailAddress?.name || '', response: a.status?.response || 'none' }))
}

/**
 * Personen der Firma suchen (Microsoft-Verzeichnis, User.ReadBasic.All): Name oder E-Mail.
 * Liefert [{ id, name, email, job }] (nur Konten mit Postfach).
 */
export async function findPeople(token, query, opts = {}) {
  const q = String(query || '').replace(/"/g, '').trim()
  if (q.length < 2) return []
  const search = `"displayName:${q}" OR "mail:${q}"`
  const params = new URLSearchParams({ $search: search, $select: 'id,displayName,mail,userPrincipalName,jobTitle', $top: '12', $count: 'true' })
  const res = await graph(token, `/users?${params}`, { headers: { ConsistencyLevel: 'eventual' }, scope: 'User.ReadBasic.All', ...opts })
  return (res.value || []).filter((u) => u.mail).map((u) => ({ id: u.id, name: u.displayName || u.mail, email: u.mail.toLowerCase(), job: u.jobTitle || '' }))
}

/**
 * Frei/Belegt der Eingeladenen (Calendars.ReadWrite reicht): Map E-Mail → [{ start, end, status }] in Ortszeit.
 * Wer nicht in der Firma ist, fehlt.
 */
export async function freeBusy(token, emails, { from, to }, opts = {}) {
  if (!emails.length) return new Map()
  const res = await graph(token, '/me/calendar/getSchedule', {
    method: 'POST',
    headers: { Prefer: `outlook.timezone="${TIME_ZONE}"` },
    body: { schedules: emails, startTime: { dateTime: `${from}:00`, timeZone: TIME_ZONE }, endTime: { dateTime: `${to}:00`, timeZone: TIME_ZONE }, availabilityViewInterval: 15 },
    ...opts,
  })
  const out = new Map()
  for (const s of res.value || []) {
    if (s.error) continue
    out.set(String(s.scheduleId || '').toLowerCase(), (s.scheduleItems || []).filter((i) => i.status !== 'free').map((i) => ({ start: String(i.start?.dateTime || '').slice(0, 16), end: String(i.end?.dateTime || '').slice(0, 16), status: i.status, subject: i.subject || '' })))
  }
  return out
}
