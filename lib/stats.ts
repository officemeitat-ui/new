import "server-only";
import { business } from "@/config/business";
import { db } from "@/lib/db";

export type ImpactStats = {
  calls: number;
  /** Gesprächszeit des Telefon-Assistenten in Minuten. */
  callMinutes: number;
  callbacks: number;
  /** WhatsApp-Gespräche mit Kundennachrichten im Zeitraum und Antworten des Assistenten darin. */
  chats: number;
  chatReplies: number;
  appointments: {
    total: number;
    /** von KI-Mitarbeitern gebucht (Telefon, WhatsApp, E-Mail) */
    automated: number;
    telefon: number;
    whatsapp: number;
    email: number;
    manuell: number;
  };
  emailsHandled: number;
  repliesSent: number;
  /** Belege, die aus E-Mails oder Uploads erfasst und ausgelesen wurden. */
  receipts: number;
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
  const bySource = (source: string) =>
    count(
      `SELECT COUNT(*) AS n FROM appointments WHERE source = '${source}' AND status = 'gebucht' AND created_at >= ? AND created_at < ?`,
      range,
    );
  const [
    calls,
    callSeconds,
    callbacks,
    telefon,
    whatsapp,
    email,
    manuell,
    emailsHandled,
    repliesSent,
    openDrafts,
    chats,
    chatReplies,
    receipts,
  ] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM calls WHERE created_at >= ? AND created_at < ?", range),
    count("SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM calls WHERE created_at >= ? AND created_at < ?", range),
    count("SELECT COUNT(*) AS n FROM activities WHERE type = 'callback' AND created_at >= ? AND created_at < ?", range),
    bySource("telefon"),
    bySource("whatsapp"),
    bySource("email"),
    bySource("manuell"),
    count(
      "SELECT COUNT(*) AS n FROM emails WHERE kind = 'eingang' AND status NOT IN ('neu', 'fehler') AND received_at >= ? AND received_at < ?",
      range,
    ),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'gesendet' AND received_at >= ? AND received_at < ?", range),
    count("SELECT COUNT(*) AS n FROM emails WHERE status = 'entwurf'", []),
    count(
      `SELECT COUNT(DISTINCT m.conversation_id) AS n FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.channel = 'whatsapp' AND m.author = 'kunde' AND m.created_at >= ? AND m.created_at < ?`,
      range,
    ),
    count(
      `SELECT COUNT(*) AS n FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.channel = 'whatsapp' AND m.author = 'ki' AND m.created_at >= ? AND m.created_at < ?`,
      range,
    ),
    count("SELECT COUNT(*) AS n FROM receipts WHERE status != 'fehlt' AND created_at >= ? AND created_at < ?", range),
  ]);
  const { minutesPerCall, minutesPerEmail, minutesPerChat, minutesPerAppointment, minutesPerReceipt } = business.impact;
  const automated = telefon + whatsapp + email;
  return {
    calls,
    callMinutes: Math.round(callSeconds / 60),
    callbacks,
    chats,
    chatReplies,
    appointments: { total: automated + manuell, automated, telefon, whatsapp, email, manuell },
    emailsHandled,
    repliesSent,
    openDrafts,
    receipts,
    minutesSaved:
      calls * minutesPerCall +
      emailsHandled * minutesPerEmail +
      chats * minutesPerChat +
      automated * minutesPerAppointment +
      receipts * minutesPerReceipt,
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
