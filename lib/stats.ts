import "server-only";
import { business } from "@/config/business";
import { db } from "@/lib/db";

export type ImpactStats = {
  calls: number;
  appointments: { total: number; telefon: number; email: number; manuell: number };
  emailsHandled: number;
  repliesSent: number;
  openDrafts: number;
  /** Geschätzte Minuten, die ohne KI-Mitarbeiter angefallen wären (Annahmen in business.impact). */
  minutesSaved: number;
};

async function count(sql: string, args: string[]): Promise<number> {
  const client = await db();
  const result = await client.execute({ sql, args });
  return Number(result.rows[0]?.n ?? 0);
}

/** Kennzahlen zur Wirkung der KI-Mitarbeiter seit einem Zeitpunkt – Grundlage für den Monatsbericht an Kunden. */
export async function impactStats(since: Date): Promise<ImpactStats> {
  const from = since.toISOString();
  const [calls, telefon, email, manuell, emailsHandled, repliesSent, openDrafts] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM calls WHERE created_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM appointments WHERE source = 'telefon' AND status = 'gebucht' AND created_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM appointments WHERE source = 'email' AND status = 'gebucht' AND created_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM appointments WHERE source = 'manuell' AND status = 'gebucht' AND created_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM emails WHERE status NOT IN ('neu', 'fehler') AND received_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'gesendet' AND received_at >= ?", [from]),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'entwurf'", []),
  ]);
  const { minutesPerCall, minutesPerEmail, minutesPerAppointment } = business.impact;
  return {
    calls,
    appointments: { total: telefon + email + manuell, telefon, email, manuell },
    emailsHandled,
    repliesSent,
    openDrafts,
    minutesSaved: calls * minutesPerCall + emailsHandled * minutesPerEmail + (telefon + email) * minutesPerAppointment,
  };
}
