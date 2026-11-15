import "server-only";
import { business } from "@/config/business";
import { resolveSource } from "@/config/site";
import { AiError } from "@/lib/ai";
import { db } from "@/lib/db";
import { getEmail, insertFollowUp, type Email } from "@/lib/emails";
import { addActivity, getLead } from "@/lib/leads";
import { draftFollowUp } from "@/lib/mail/analyze";

// Nachfass-Assistent: Anfragen, auf die wir geantwortet haben, bei denen danach aber nichts mehr kam
// (keine E-Mail, kein Anruf, kein Termin), bekommen einen Nachfass-Entwurf – immer zur Freigabe.

const DAY = 24 * 60 * 60 * 1000;

/** Beantwortete Anfragen ohne Reaktion seit `afterDays` Tagen, noch nicht nachgefasst. */
export async function followUpCandidates(now = new Date()): Promise<Email[]> {
  const { afterDays, maxAgeDays, categories } = business.followUp;
  if (categories.length === 0) return [];
  const client = await db();
  const result = await client.execute({
    sql: `SELECT e.id FROM emails e
          WHERE e.kind = 'eingang' AND e.status = 'gesendet' AND e.lead_id IS NOT NULL
            AND e.sent_at <= ? AND e.sent_at >= ?
            AND e.category IN (${categories.map(() => "?").join(", ")})
            AND NOT EXISTS (SELECT 1 FROM emails n WHERE n.lead_id = e.lead_id AND n.kind = 'eingang' AND n.received_at > e.sent_at)
            AND NOT EXISTS (SELECT 1 FROM emails f WHERE f.kind = 'nachfass' AND f.thread_message_id = e.message_id)
            AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.lead_id = e.lead_id AND a.created_at > e.sent_at)
            AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.lead_id = e.lead_id AND c.created_at > e.sent_at)
          ORDER BY e.sent_at`,
    args: [
      new Date(now.getTime() - afterDays * DAY).toISOString(),
      new Date(now.getTime() - maxAgeDays * DAY).toISOString(),
      ...categories,
    ],
  });
  const emails = await Promise.all(result.rows.map((row) => getEmail(String(row.id))));

  // Kontakte, die in der Pipeline schon abgeschlossen sind (erledigt, kein Bedarf, …), nicht anschreiben.
  const open: Email[] = [];
  for (const email of emails) {
    if (!email?.leadId) continue;
    const lead = await getLead(email.leadId);
    const stage = lead && resolveSource(lead.funnel)?.pipeline?.stages.find((s) => s.id === lead.stage);
    if (lead && !stage?.closed) open.push(email);
  }
  return open;
}

/** Erstellt Nachfass-Entwürfe für alle Kandidaten. KI-Fehler überspringen den Verlauf (nächster Lauf versucht es erneut). */
export async function createFollowUps(now = new Date()): Promise<{ created: number; failed: number }> {
  if (!business.followUp.enabled) return { created: 0, failed: 0 };
  let created = 0;
  let failed = 0;
  for (const email of await followUpCandidates(now)) {
    const daysSince = Math.floor((now.getTime() - new Date(email.sentAt!).getTime()) / DAY);
    try {
      const draft = await draftFollowUp(
        { customerName: email.fromName, subject: email.subject, customerEmail: email.body, ourReply: email.replyBody ?? "", daysSince },
        now,
      );
      await insertFollowUp({
        leadId: email.leadId!,
        to: email.fromAddress,
        toName: email.fromName,
        threadMessageId: email.messageId!,
        context: `Unsere Antwort vom ${new Date(email.sentAt!).toLocaleDateString("de-AT", { timeZone: business.timeZone })}:\n\n${email.replyBody ?? ""}`,
        summary: `Keine Rückmeldung seit ${daysSince} Tagen auf unsere Antwort zu „${email.subject}“`,
        subject: draft.subject,
        body: draft.body,
      });
      await addActivity(email.leadId!, "email", `Nachfass-Entwurf erstellt (keine Rückmeldung seit ${daysSince} Tagen)`);
      created++;
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      console.error(`Nachfass-Entwurf für E-Mail ${email.id} fehlgeschlagen:`, error.message);
      failed++;
    }
  }
  return { created, failed };
}
