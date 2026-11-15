import { calendarFetch, CalendarSyncError, readJson, type CalendarProvider, type ExternalBusy } from "@/lib/calendar-sync/types";

// Microsoft 365 / Outlook über Microsoft Graph mit App-Zugang (Client Credentials).
// Im Entra-Admin-Center: App registrieren, Anwendungsberechtigung „Calendars.ReadWrite“ mit Administratorzustimmung,
// Zugriff per Application Access Policy auf das eine Postfach beschränken.

const LOGIN_URL = process.env.MS_LOGIN_URL || "https://login.microsoftonline.com";
const GRAPH_URL = process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0";
const SERVICE = "Microsoft 365";

type GraphDateTime = { dateTime: string; timeZone: string };
type GraphEvent = { id: string; start?: GraphDateTime; end?: GraphDateTime; showAs?: string; isCancelled?: boolean };

/** Graph liefert mit `Prefer: outlook.timezone="UTC"` Zeiten ohne Zone und mit 7 Nachkommastellen. */
function utcDate(value: GraphDateTime | undefined): Date | null {
  if (!value?.dateTime) return null;
  return new Date(`${value.dateTime.replace(/\.\d+$/, "")}Z`);
}

const graphTime = (date: Date) => ({ dateTime: date.toISOString().replace(/\.\d+Z$/, ""), timeZone: "UTC" });

export function microsoftProvider(options: { tenantId: string; clientId: string; clientSecret: string; user: string }): CalendarProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  const userPath = `${GRAPH_URL}/users/${encodeURIComponent(options.user)}`;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await calendarFetch(
      `${SERVICE} (Anmeldung)`,
      `${LOGIN_URL}/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    const data = await readJson<{ access_token: string; expires_in: number }>(response, `${SERVICE} (Anmeldung)`);
    cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cached.token;
  }

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    return calendarFetch(SERVICE, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
        ...init.headers,
      },
    });
  }

  return {
    label: SERVICE,

    async listBusy(from, to) {
      const busy: ExternalBusy[] = [];
      const params = new URLSearchParams({
        startDateTime: from.toISOString(),
        endDateTime: to.toISOString(),
        $select: "id,start,end,showAs,isCancelled",
        $top: "500",
      });
      let url: string | undefined = `${userPath}/calendar/calendarView?${params}`;
      while (url) {
        const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await readJson(await call(url), SERVICE);
        for (const event of page.value ?? []) {
          if (event.isCancelled || event.showAs === "free" || event.showAs === "workingElsewhere") continue;
          const start = utcDate(event.start);
          const end = utcDate(event.end);
          if (start && end) busy.push({ start, end, externalId: event.id });
        }
        url = page["@odata.nextLink"];
      }
      return busy;
    },

    async createEvent(event) {
      const created = await readJson<GraphEvent>(
        await call(`${userPath}/calendar/events`, {
          method: "POST",
          body: JSON.stringify({
            subject: event.title,
            body: { contentType: "text", content: event.description },
            start: graphTime(event.start),
            end: graphTime(event.end),
            showAs: "busy",
            // Verhindert doppelte Einträge, falls die Anfrage wiederholt wird.
            transactionId: event.appointmentId,
          }),
        }),
        SERVICE,
      );
      return created.id;
    },

    async deleteEvent(externalId) {
      const response = await call(`${userPath}/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
      if (response.ok || response.status === 404) return;
      throw new CalendarSyncError(`${SERVICE}: Löschen fehlgeschlagen (HTTP ${response.status})`);
    },
  };
}
