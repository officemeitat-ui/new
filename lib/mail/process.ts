import "server-only";
import { business } from "@/config/business";
import { AiError } from "@/lib/ai";
import { ensureContact } from "@/lib/contacts";
import { EMAIL_CATEGORIES, getEmail, insertEmail, knownMessageIds, updateEmail, type Email, type IncomingEmail } from "@/lib/emails";
import { addActivity } from "@/lib/leads";
import { analyzeEmail } from "@/lib/mail/analyze";
import { fetchRecentEmails } from "@/lib/mail/imap";
import { sendMail, smtpConfigured } from "@/lib/mail/smtp";
import type { WebhookEvent } from "@/lib/webhook";

export type ProcessResult = { email: Email; events: WebhookEvent[] };

const AUTOMATED_SENDER = /(^|[.\-_])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)@/i;

/** Absender, auf die nie geantwortet wird: eigene Adressen und automatische Systeme (verhindert Antwort-Schleifen). */
export function isAutomated(mail: Pick<IncomingEmail, "fromAddress" | "autoSubmitted">): boolean {
  const own = [business.email, process.env.SMTP_FROM, process.env.IMAP_USER]
    .filter((a): a is string => Boolean(a))
    .map((a) => a.replace(/.*<(.+)>.*/, "$1").toLowerCase());
  return Boolean(mail.autoSubmitted) || AUTOMATED_SENDER.test(mail.fromAddress) || own.includes(mail.fromAddress.toLowerCase());
}

/** Speichert und verarbeitet eine eingehende E-Mail. null, wenn sie schon bekannt war. */
export async function processIncomingEmail(mail: IncomingEmail, now = new Date()): Promise<ProcessResult | null> {
  const stored = await insertEmail(mail);
  if (!stored) return null;
  if (isAutomated(mail)) {
    await updateEmail(stored.id, { status: "erledigt", category: "sonstiges", summary: "Automatische E-Mail – nicht beantwortet" });
    return { email: (await getEmail(stored.id))!, events: [] };
  }
  return analyzeAndRoute(stored, now);
}

/** Wertet eine gespeicherte E-Mail aus (auch für „Erneut versuchen“ nach einem Fehler). */
export async function analyzeAndRoute(email: Email, now = new Date()): Promise<ProcessResult> {
  let analysis;
  try {
    analysis = await analyzeEmail(email, now);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    await updateEmail(email.id, { status: "fehler", error: error.message });
    return { email: (await getEmail(email.id))!, events: [] };
  }

  let leadId: string | null = null;
  if (analysis.category !== "werbung_spam") {
    const lead = await ensureContact("email", {
      email: email.fromAddress,
      name: analysis.senderName || email.fromName || undefined,
      phone: analysis.phone || undefined,
    });
    leadId = lead.id;
    await addActivity(lead.id, "email", `E-Mail „${email.subject}“ (${EMAIL_CATEGORIES[analysis.category]}): ${analysis.summary}`);
  }

  const hasDraft = analysis.needsReply && analysis.replyBody.trim().length > 0;
  await updateEmail(email.id, {
    leadId,
    category: analysis.category,
    summary: analysis.summary,
    status: hasDraft ? "entwurf" : "erledigt",
    replySubject: hasDraft ? analysis.replySubject : null,
    replyBody: hasDraft ? analysis.replyBody : null,
    error: null,
  });

  const events: WebhookEvent[] = [];
  if (analysis.category !== "werbung_spam") {
    events.push({
      event: "email.received",
      emailId: email.id,
      leadId,
      category: analysis.category,
      urgent: analysis.urgent,
      summary: `${email.fromName ?? email.fromAddress}: ${analysis.summary}`,
    });
  }

  const { mode, autoSendCategories } = business.emailAssistant;
  if (hasDraft && mode === "autonom" && autoSendCategories.includes(analysis.category) && !analysis.urgent && smtpConfigured()) {
    await sendReply((await getEmail(email.id))!);
  }
  return { email: (await getEmail(email.id))!, events };
}

/** Versendet die (ggf. bearbeitete) Antwort und vermerkt sie beim Kontakt. */
export async function sendReply(email: Email, edited?: { subject: string; body: string }): Promise<void> {
  const subject = edited?.subject ?? email.replySubject;
  const body = edited?.body ?? email.replyBody;
  if (!subject || !body) throw new Error("Kein Antwortentwurf vorhanden");
  await sendMail({ to: email.fromAddress, subject, text: body, inReplyTo: email.messageId });
  await updateEmail(email.id, { status: "gesendet", replySubject: subject, replyBody: body, sentAt: new Date().toISOString() });
  if (email.leadId) await addActivity(email.leadId, "email", `Antwort gesendet: „${subject}“`);
}

/** Ruft das Postfach ab und verarbeitet alle neuen E-Mails. */
export async function pollMailbox(now = new Date()): Promise<{ fetched: number; processed: number; events: WebhookEvent[] }> {
  const emails = await fetchRecentEmails();
  const known = await knownMessageIds(emails.map((e) => e.messageId));
  const events: WebhookEvent[] = [];
  let processed = 0;
  // Nacheinander, damit Kontakte desselben Absenders nicht doppelt angelegt werden.
  for (const mail of emails.filter((e) => !known.has(e.messageId))) {
    const result = await processIncomingEmail(mail, now);
    if (result) {
      processed++;
      events.push(...result.events);
    }
  }
  return { fetched: emails.length, processed, events };
}
