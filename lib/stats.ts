import "server-only";
import { business } from "@/config/business";
import { db } from "@/lib/db";

export type ImpactStats = {
  calls: number;
  /** Gesprächszeit des Telefon-Assistenten in Minuten. */
  callMinutes: number;
  callbacks: number;
  appointments: { total: number; telefon: number; email: number; manuell: number };
  emailsHandled: number;
  repliesSent: number;
  openDrafts: number;
  /** Geschätzte Minuten, die ohne KI-Mitarbeiter angefallen wären (Annahmen in business.impact). */
  minutesSaved: number;
};

async function query(sql: string, args: string[]) {
  const client = await db();
  return (await client.execute({ sql, args })).rows;
}

async function count(sql: string, args: string[]): Promise<number> {
  return Number((await query(sql, args))[0]?.n ?? 0);
}

/**
 * Kennzahlen zur Wirkung der KI-Mitarbeiter im Zeitraum [from, to) – für Dashboard und Monatsbericht.
 * Termine zählen nach Buchungszeitpunkt, E-Mails nach Eingang.
 */
export async function impactStats(from: Date, to = new Date()): Promise<ImpactStats> {
  const range = [from.toISOString(), to.toISOString()];
  const [calls, callSeconds, callbacks, telefon, email, manuell, emailsHandled, repliesSent, openDrafts] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM calls WHERE created_at >= ? AND created_at < ?", range),
    count("SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM calls WHERE created_at >= ? AND created_at < ?", range),
    count("SELECT COUNT(*) AS n FROM activities WHERE type = 'callback' AND created_at >= ? AND created_at < ?", range),
    count(
      "SELECT COUNT(*) AS n FROM appointments WHERE source = 'telefon' AND status = 'gebucht' AND created_at >= ? AND created_at < ?",
      range,
    ),
    count(
      "SELECT COUNT(*) AS n FROM appointments WHERE source = 'email' AND status = 'gebucht' AND created_at >= ? AND created_at < ?",
      range,
    ),
    count(
      "SELECT COUNT(*) AS n FROM appointments WHERE source = 'manuell' AND status = 'gebucht' AND created_at >= ? AND created_at < ?",
      range,
    ),
    count(
      "SELECT COUNT(*) AS n FROM emails WHERE kind = 'eingang' AND status NOT IN ('neu', 'fehler') AND received_at >= ? AND received_at < ?",
      range,
    ),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'gesendet' AND received_at >= ? AND received_at < ?", range),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'entwurf'", []),
  ]);
  const { minutesPerCall, minutesPerEmail, minutesPerAppointment } = business.impact;
  return {
    calls,
    callMinutes: Math.round(callSeconds / 60),
    callbacks,
    appointments: { total: telefon + email + manuell, telefon, email, manuell },
    emailsHandled,
    repliesSent,
    openDrafts,
    minutesSaved: calls * minutesPerCall + emailsHandled * minutesPerEmail + (telefon + email) * minutesPerAppointment,
  };
}

/** Anzahl je Schlüssel, z. B. Termine je Leistung oder E-Mails je Kategorie. */
export async function breakdown(kind: "appointmentsByService" | "emailsByCategory", from: Date, to: Date): Promise<Record<string, number>> {
  const range = [from.toISOString(), to.toISOString()];
  const rows =
    kind === "appointmentsByService"
      ? await query(
          "SELECT service_id AS k, COUNT(*) AS n FROM appointments WHERE status = 'gebucht' AND created_at >= ? AND created_at < ? GROUP BY service_id",
          range,
        )
      : await query(
          "SELECT category AS k, COUNT(*) AS n FROM emails WHERE kind = 'eingang' AND status NOT IN ('neu', 'fehler') AND category IS NOT NULL AND received_at >= ? AND received_at < ? GROUP BY category",
          range,
        );
  return Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]));
}
