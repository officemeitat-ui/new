import { createSign } from "node:crypto";
import { zonedToUtc } from "@/lib/calendar";
import {
  APPOINTMENT_MARKER,
  calendarFetch,
  CalendarSyncError,
  readJson,
  type CalendarProvider,
  type ExternalBusy,
} from "@/lib/calendar-sync/types";

// Google Kalender über ein Dienstkonto: Der Betrieb gibt seinen Kalender für die E-Mail-Adresse des Dienstkontos frei
// („Änderungen an Terminen vornehmen“). Kein OAuth-Bildschirm, keine Google-Workspace-Pflicht.

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API_URL = process.env.GOOGLE_CALENDAR_API_URL || "https://www.googleapis.com/calendar/v3";
const SERVICE = "Google Kalender";

type ServiceAccount = { client_email: string; private_key: string };

type GoogleDateTime = { date?: string; dateTime?: string; timeZone?: string };
type GoogleEvent = {
  id: string;
  status?: string;
  transparency?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  extendedProperties?: { private?: Record<string, string> };
};

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** Signiertes JWT für den Token-Austausch eines Dienstkontos (RS256). */
export function serviceAccountAssertion(account: ServiceAccount, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/calendar",
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

export function googleProvider(options: { account: ServiceAccount; calendarId: string; timeZone: string }): CalendarProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  const calendarPath = `${API_URL}/calendars/${encodeURIComponent(options.calendarId)}`;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await calendarFetch(`${SERVICE} (Anmeldung)`, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountAssertion(options.account),
      }),
    });
    const data = await readJson<{ access_token: string; expires_in: number }>(response, `${SERVICE} (Anmeldung)`);
    cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cached.token;
  }

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    return calendarFetch(SERVICE, url, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...init.headers },
    });
  }

  const toDate = (value: GoogleDateTime | undefined): Date | null => {
    if (value?.dateTime) return new Date(value.dateTime);
    // Ganztägige Termine (z. B. Urlaub) blockieren den ganzen Tag in der Zeitzone des Betriebs.
    if (value?.date) return zonedToUtc(value.date, "00:00", options.timeZone);
    return null;
  };

  return {
    label: SERVICE,

    async listBusy(from, to) {
      const busy: ExternalBusy[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: "true",
          maxResults: "2500",
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await readJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(
          await call(`${calendarPath}/events?${params}`),
          SERVICE,
        );
        for (const event of page.items ?? []) {
          if (event.status === "cancelled" || event.transparency === "transparent") continue;
          if (event.extendedProperties?.private?.[APPOINTMENT_MARKER]) continue;
          const start = toDate(event.start);
          const end = toDate(event.end);
          if (start && end) busy.push({ start, end, externalId: event.id });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return busy;
    },

    async createEvent(event) {
      const created = await readJson<GoogleEvent>(
        await call(`${calendarPath}/events`, {
          method: "POST",
          body: JSON.stringify({
            summary: event.title,
            description: event.description,
            start: { dateTime: event.start.toISOString(), timeZone: options.timeZone },
            end: { dateTime: event.end.toISOString(), timeZone: options.timeZone },
            extendedProperties: { private: { [APPOINTMENT_MARKER]: event.appointmentId } },
          }),
        }),
        SERVICE,
      );
      return created.id;
    },

    async deleteEvent(externalId) {
      const response = await call(`${calendarPath}/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
      // Bereits gelöscht gilt als erledigt.
      if (response.ok || response.status === 404 || response.status === 410) return;
      throw new CalendarSyncError(`${SERVICE}: Löschen fehlgeschlagen (HTTP ${response.status})`);
    },
  };
}
