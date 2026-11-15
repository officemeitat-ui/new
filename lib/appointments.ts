import "server-only";
import { LibsqlError, type Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { business, getService } from "@/config/business";
import { isBookable, type Busy } from "@/lib/calendar";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/leads";

export type AppointmentSource = "telefon" | "email" | "manuell";

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
    createdAt: String(row.created_at),
  };
}

/** Belegte Zeiten im Zeitraum (nur gebuchte Termine). */
export async function busyBetween(from: Date, to: Date): Promise<Busy[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT start_at, end_at FROM appointments WHERE status = 'gebucht' AND start_at < ? AND end_at > ?",
    args: [to.toISOString(), from.toISOString()],
  });
  return result.rows.map((r) => ({ start: new Date(String(r.start_at)), end: new Date(String(r.end_at)) }));
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

export type BookingResult = { ok: true; appointment: Appointment } | { ok: false; reason: "unbekannte_leistung" | "nicht_verfuegbar" };

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
  return serialized(() => retryWhenBusy(() => bookInTransaction(request, now)));
}

async function bookInTransaction(request: BookingRequest, now: Date): Promise<BookingResult> {
  const service = getService(request.serviceId);
  if (!service) return { ok: false, reason: "unbekannte_leistung" };
  const end = new Date(request.start.getTime() + service.durationMinutes * 60_000);

  const client = await db();
  const tx = await client.transaction("write");
  try {
    const busyRows = await tx.execute({
      sql: "SELECT start_at, end_at FROM appointments WHERE status = 'gebucht' AND start_at < ? AND end_at > ?",
      args: [end.toISOString(), request.start.toISOString()],
    });
    const busy = busyRows.rows.map((r) => ({ start: new Date(String(r.start_at)), end: new Date(String(r.end_at)) }));
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

export async function cancelAppointment(id: string): Promise<Appointment | null> {
  const client = await db();
  await client.execute({ sql: "UPDATE appointments SET status = 'storniert' WHERE id = ?", args: [id] });
  const result = await client.execute({ sql: "SELECT * FROM appointments WHERE id = ?", args: [id] });
  return result.rows[0] ? toAppointment(result.rows[0]) : null;
}
