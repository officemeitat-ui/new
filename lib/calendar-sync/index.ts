import "server-only";
import { business } from "@/config/business";
import { googleProvider } from "@/lib/calendar-sync/google";
import { microsoftProvider } from "@/lib/calendar-sync/microsoft";
import { CalendarSyncError, type CalendarProvider, type ExternalBusy } from "@/lib/calendar-sync/types";

export { CalendarSyncError } from "@/lib/calendar-sync/types";

const DAY = 24 * 60 * 60 * 1000;

let provider: { kind: string; instance: CalendarProvider } | undefined;

/**
 * Externer Kalender laut CALENDAR_PROVIDER („google“ oder „microsoft“), sonst null (nur interner Kalender).
 * Ist ein Anbieter gewählt, aber unvollständig eingerichtet, gibt es einen Fehler – lieber keine Buchung als eine Doppelbuchung.
 */
export function calendarProvider(): CalendarProvider | null {
  const kind = process.env.CALENDAR_PROVIDER || "intern";
  if (kind === "intern") return null;
  if (provider?.kind === kind) return provider.instance;

  let instance: CalendarProvider;
  if (kind === "google") {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    let account: { client_email?: string; private_key?: string } = {};
    try {
      account = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    } catch {
      throw new CalendarSyncError("Google Kalender: GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON");
    }
    if (!calendarId || !account.client_email || !account.private_key) {
      throw new CalendarSyncError("Google Kalender: GOOGLE_SERVICE_ACCOUNT_JSON und GOOGLE_CALENDAR_ID setzen");
    }
    instance = googleProvider({
      account: { client_email: account.client_email, private_key: account.private_key },
      calendarId,
      timeZone: business.timeZone,
    });
  } else if (kind === "microsoft") {
    const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_CALENDAR_USER } = process.env;
    if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !MS_CALENDAR_USER) {
      throw new CalendarSyncError("Microsoft 365: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET und MS_CALENDAR_USER setzen");
    }
    instance = microsoftProvider({
      tenantId: MS_TENANT_ID,
      clientId: MS_CLIENT_ID,
      clientSecret: MS_CLIENT_SECRET,
      user: MS_CALENDAR_USER,
    });
  } else {
    throw new CalendarSyncError(`Unbekannter CALENDAR_PROVIDER „${kind}“ (erlaubt: intern, google, microsoft)`);
  }
  provider = { kind, instance };
  return instance;
}

// Belegte Zeiten werden für ein großzügiges Zeitfenster kurz zwischengespeichert: Ein Telefonat oder eine E-Mail-Auswertung
// fragt mehrmals hintereinander ab, der externe Kalender soll dafür nur einmal gelesen werden.
const CACHE_TTL = 60_000;
let cache: { from: number; to: number; busy: ExternalBusy[]; fetchedAt: number } | undefined;

export function invalidateExternalBusy(): void {
  cache = undefined;
}

/** Belegte Zeiten aus dem externen Kalender im Zeitraum (leer ohne externen Kalender). */
export async function externalBusy(from: Date, to: Date, now = Date.now()): Promise<ExternalBusy[]> {
  const calendar = calendarProvider();
  if (!calendar) return [];

  const windowFrom = now - DAY;
  const windowTo = now + (business.booking.maxDaysAhead + 16) * DAY;
  const inWindow = from.getTime() >= windowFrom && to.getTime() <= windowTo;
  if (!inWindow) return calendar.listBusy(from, to);

  if (!cache || now - cache.fetchedAt > CACHE_TTL) {
    cache = { from: windowFrom, to: windowTo, busy: await calendar.listBusy(new Date(windowFrom), new Date(windowTo)), fetchedAt: now };
  }
  return cache.busy.filter((b) => b.start < to && b.end > from);
}
