import type { Busy } from "@/lib/calendar";

/** Belegte Zeit aus dem externen Kalender des Betriebs. */
export type ExternalBusy = Busy & { externalId: string };

export type CalendarEventInput = {
  appointmentId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
};

/** Anbindung an den Kalender, den der Betrieb ohnehin nutzt (Google, Microsoft 365). */
export interface CalendarProvider {
  /** Name für die Anzeige im Cockpit. */
  label: string;
  listBusy(from: Date, to: Date): Promise<ExternalBusy[]>;
  /** Legt einen Termin an und liefert dessen ID im externen Kalender. */
  createEvent(event: CalendarEventInput): Promise<string>;
  deleteEvent(externalId: string): Promise<void>;
}

/** Externer Kalender nicht erreichbar oder falsch eingerichtet. */
export class CalendarSyncError extends Error {}

/** Markiert Termine, die das Cockpit selbst angelegt hat (damit sie nicht doppelt als belegt zählen). */
export const APPOINTMENT_MARKER = "kiCockpitAppointment";

export async function readJson<T>(response: Response, service: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new CalendarSyncError(`${service}: HTTP ${response.status}${detail ? ` – ${detail}` : ""}`);
  }
  return (await response.json()) as T;
}

/** fetch, das Netzwerkfehler und Zeitüberschreitungen als CalendarSyncError meldet. */
export async function calendarFetch(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new CalendarSyncError(`${service}: nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
}
