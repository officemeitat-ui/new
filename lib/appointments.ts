import "server-only";
import { LibsqlError, type Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { business, getService } from "@/config/business";
import { formatSlot, isBookable, type Busy } from "@/lib/calendar";
import { calendarProvider, CalendarSyncError, externalBusy, invalidateExternalBusy } from "@/lib/calendar-sync";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/leads";

export type AppointmentSource = "telefon" | "whatsapp" | "email" | "manuell";

export type Appointment = {
  id: string;
  serviceId: string;
  start: Date;
  end: Date;
  status: "gebucht" | "storniert";
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  leadId: string | null;
  source: AppointmentSource;
  /** ID des Eintrags im externen Kalender (Google/Microsoft), sofern übertragen. */
  externalId: string | null;
  /** Letzter Fehler beim Übertragen in den externen Kalender. */
  syncError: string | null;
  confirmationSentAt: string | null;
  confirmationChannel: string | null;
  reminderSentAt: string | null;
  reminderChannel: string | null;
  /** Letzter Fehler beim Benachrichtigen des Kunden (Bestätigung/Erinnerung). */
  notifyError: string | null;
  createdAt: string;
};

function toAppointment(row: Row): Appointment {
  return {
    id: String(row.id),
    serviceId: String(row.service_id),
    start: new Date(String(row.start_at)),
    end: new Date(String(row.end_at)),
    status: String(row.status) as Appointment["status"],
    name: String(row.name),
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    leadId: (row.lead_id as string | null) ?? null,
    source: String(row.source) as AppointmentSource,
    externalId: (row.external_id as string | null) ?? null,
    syncError: (row.sync_error as string | null) ?? null,
    confirmationSentAt: (row.confirmation_sent_at as string | null) ?? null,
    confirmationChannel: (row.confirmation_channel as string | null) ?? null,
    reminderSentAt: (row.reminder_sent_at as string | null) ?? null,
    reminderChannel: (row.reminder_channel as string | null) ?? null,
    notifyError: (row.notify_error as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

type Executor = { execute: Awaited<ReturnType<typeof db>>["execute"] };

async function internalBusy(executor: Executor, from: Date, to: Date): Promise<(Busy & { externalId: string | null })[]> {
  const result = await executor.execute({
    sql: "SELECT start_at, end_at, external_id FROM appointments WHERE status = 'gebucht' AND start_at < ? AND end_at > ?",
    args: [to.toISOString(), from.toISOString()],
  });
  return result.rows.map((r) => ({
    start: new Date(String(r.start_at)),
    end: new Date(String(r.end_at)),
    externalId: (r.external_id as string | null) ?? null,
  }));
}

/** Gebuchte Termine plus belegte Zeiten im externen Kalender; eigene, bereits übertragene Termine zählen nur einmal. */
function mergeBusy(internal: (Busy & { externalId: string | null })[], external: (Busy & { externalId: string })[]): Busy[] {
  const own = new Set(internal.map((b) => b.externalId).filter(Boolean));
  const foreign = external.filter((b) => !own.has(b.externalId));
  // „alles“: Ein externer Eintrag belegt alle Plätze – er wird dafür so oft gezählt, wie es Plätze gibt.
  const weight = business.booking.externalEvents === "alles" ? business.booking.capacity : 1;
  return [...internal, ...foreign.flatMap((b) => Array.from({ length: weight }, () => b))];
}

/** Belegte Zeiten im Zeitraum: eigene Buchungen und – falls angebunden – der Kalender des Betriebs. */
export async function busyBetween(from: Date, to: Date): Promise<Busy[]> {
  const [internal, external] = await Promise.all([internalBusy(await db(), from, to), externalBusy(from, to)]);
  return mergeBusy(internal, external);
}

export async function listAppointments(from: Date, to: Date): Promise<Appointment[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM appointments WHERE start_at >= ? AND start_at < ? ORDER BY start_at",
    args: [from.toISOString(), to.toISOString()],
  });
  return result.rows.map(toAppointment);
}

export type BookingRequest = {
  serviceId: string;
  start: Date;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  leadId?: string;
  source: AppointmentSource;
};

export type BookingResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; reason: "unbekannte_leistung" | "nicht_verfuegbar" | "kalender_nicht_erreichbar" };

// Buchungen innerhalb dieses Prozesses nacheinander ausführen; SQLite erlaubt nur einen Schreiber.
let bookingQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = bookingQueue.then(task, task);
  bookingQueue = run.catch(() => undefined);
  return run;
}

/** Wiederholt bei „database is locked“, falls mehrere Instanzen gleichzeitig schreiben. */
async function retryWhenBusy<T>(task: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const busy = error instanceof LibsqlError && error.code === "SQLITE_BUSY";
      if (!busy || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

/**
 * Bucht einen Termin. Verfügbarkeit wird innerhalb einer Schreib-Transaktion erneut geprüft,
 * damit zwei gleichzeitige Anrufe nicht denselben letzten freien Platz bekommen.
 */
export function bookAppointment(request: BookingRequest, now = new Date()): Promise<BookingResult> {
  return serialized(async () => {
    const result = await retryWhenBusy(() => bookInTransaction(request, now));
    if (result.ok) result.appointment = await pushToCalendar(result.appointment);
    return result;
  });
}

async function bookInTransaction(request: BookingRequest, now: Date): Promise<BookingResult> {
  const service = getService(request.serviceId);
  if (!service) return { ok: false, reason: "unbekannte_leistung" };
  const end = new Date(request.start.getTime() + service.durationMinutes * 60_000);

  // Externer Kalender vor der Transaktion lesen. Ist er nicht erreichbar, wird nicht gebucht (keine Doppelbuchung).
  let external;
  try {
    invalidateExternalBusy();
    external = await externalBusy(request.start, end, now.getTime());
  } catch (error) {
    if (!(error instanceof CalendarSyncError)) throw error;
    console.error("Kalender nicht erreichbar:", error.message);
    return { ok: false, reason: "kalender_nicht_erreichbar" };
  }

  const client = await db();
  const tx = await client.transaction("write");
  try {
    const busy = mergeBusy(await internalBusy(tx, request.start, end), external);
    if (!isBookable(business, service.durationMinutes, request.start, busy, now)) {
      await tx.rollback();
      return { ok: false, reason: "nicht_verfuegbar" };
    }

    const id = randomUUID();
    await tx.execute({
      sql: `INSERT INTO appointments (id, service_id, start_at, end_at, status, name, phone, email, notes, lead_id, source, created_at)
            VALUES (?, ?, ?, ?, 'gebucht', ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        service.id,
        request.start.toISOString(),
        end.toISOString(),
        request.name,
        request.phone ? normalizePhone(request.phone) : null,
        request.email || null,
        request.notes || null,
        request.leadId || null,
        request.source,
        now.toISOString(),
      ],
    });
    await tx.commit();
    const result = await client.execute({ sql: "SELECT * FROM appointments WHERE id = ?", args: [id] });
    return { ok: true, appointment: toAppointment(result.rows[0]) };
  } finally {
    tx.close();
  }
}

/** Gebuchte Termine, deren Erinnerung fällig ist: Beginn im Zeitraum (from, to], noch nicht erinnert, nicht kurzfristig gebucht. */
export async function appointmentsDueForReminder(from: Date, to: Date, bookedBefore: (start: Date) => Date): Promise<Appointment[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM appointments WHERE status = 'gebucht' AND reminder_sent_at IS NULL AND start_at > ? AND start_at <= ? ORDER BY start_at",
    args: [from.toISOString(), to.toISOString()],
  });
  return result.rows.map(toAppointment).filter((a) => new Date(a.createdAt) <= bookedBefore(a.start));
}

/** Vermerkt eine versendete Bestätigung bzw. Erinnerung (Kanal null = nicht zustellbar, Grund in error). */
export async function recordNotification(id: string, kind: "bestaetigung" | "erinnerung", channel: string | null, error: string | null) {
  const client = await db();
  const [sentColumn, channelColumn] =
    kind === "bestaetigung" ? ["confirmation_sent_at", "confirmation_channel"] : ["reminder_sent_at", "reminder_channel"];
  await client.execute({
    sql: `UPDATE appointments SET ${sentColumn} = ?, ${channelColumn} = ?, notify_error = ? WHERE id = ?`,
    args: [new Date().toISOString(), channel, error, id],
  });
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM appointments WHERE id = ?", args: [id] });
  return result.rows[0] ? toAppointment(result.rows[0]) : null;
}

async function setSyncState(id: string, externalId: string | null, syncError: string | null): Promise<void> {
  const client = await db();
  await client.execute({ sql: "UPDATE appointments SET external_id = ?, sync_error = ? WHERE id = ?", args: [externalId, syncError, id] });
}

/**
 * Gleicht einen Termin mit dem externen Kalender ab: gebuchte Termine eintragen, stornierte löschen.
 * Fehler werden am Termin vermerkt und können im Cockpit erneut versucht werden.
 */
export async function pushToCalendar(appointment: Appointment): Promise<Appointment> {
  let calendar;
  try {
    calendar = calendarProvider();
  } catch (error) {
    if (!(error instanceof CalendarSyncError)) throw error;
    await setSyncState(appointment.id, appointment.externalId, error.message);
    return (await getAppointment(appointment.id))!;
  }
  if (!calendar) return appointment;

  try {
    if (appointment.status === "gebucht" && !appointment.externalId) {
      const service = getService(appointment.serviceId);
      const externalId = await calendar.createEvent({
        appointmentId: appointment.id,
        title: `${service?.name ?? appointment.serviceId} – ${appointment.name}`,
        description: [
          appointment.phone && `Telefon: ${appointment.phone}`,
          appointment.email && `E-Mail: ${appointment.email}`,
          appointment.notes && `Notiz: ${appointment.notes}`,
          `Gebucht über: ${appointment.source} (KI-Mitarbeiter-Cockpit), ${formatSlot(appointment.start, business)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        start: appointment.start,
        end: appointment.end,
      });
      await setSyncState(appointment.id, externalId, null);
    } else if (appointment.status === "storniert" && appointment.externalId) {
      await calendar.deleteEvent(appointment.externalId);
      await setSyncState(appointment.id, null, null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Kalender-Abgleich für Termin ${appointment.id} fehlgeschlagen:`, message);
    await setSyncState(appointment.id, appointment.externalId, message.slice(0, 500));
  } finally {
    invalidateExternalBusy();
  }
  return (await getAppointment(appointment.id))!;
}

export async function cancelAppointment(id: string): Promise<Appointment | null> {
  const client = await db();
  await client.execute({ sql: "UPDATE appointments SET status = 'storniert' WHERE id = ?", args: [id] });
  const appointment = await getAppointment(id);
  return appointment ? pushToCalendar(appointment) : null;
}
