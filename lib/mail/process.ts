import "server-only";
import { business } from "@/config/business";
import { AiError } from "@/lib/ai";
import { ensureContact } from "@/lib/contacts";
import {
  EMAIL_CATEGORIES,
  getEmail,
  insertEmail,
  knownMessageIds,
  listMailboxDrafts,
  updateEmail,
  type Email,
  type EmailCategory,
  type IncomingEmail,
  type MailAttachment,
} from "@/lib/emails";
import { addActivity } from "@/lib/leads";
import { analyzeEmail } from "@/lib/mail/analyze";
import type { Mailbox } from "@/lib/mail/mailbox";
import { sendMail, smtpConfigured } from "@/lib/mail/smtp";
import { captureReceipts, recordMissingReceipt } from "@/lib/receipts/capture";
import type { WebhookEvent } from "@/lib/webhook";

export type ProcessResult = { email: Email; events: WebhookEvent[] };

const AUTOMATED_SENDER = /(^|[.\-_])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)@/i;
const RECEIPT_HINT = /rechnung|invoice|beleg|gutschrift|quittung|receipt|zahlungsbest|abrechnung|mahnung|faktura/i;
/** Kategorien ohne Kundenbezug: kein Kontakt im CRM, keine Benachrichtigung (außer dringend, z. B. Mahnung). */
const BACK_OFFICE: EmailCategory[] = ["werbung_spam", "rechnung_beleg", "lieferant_bestellung"];

/** Absender, auf die nie geantwortet wird: eigene Adressen und automatische Systeme (verhindert Antwort-Schleifen). */
export function isAutomated(mail: Pick<IncomingEmail, "fromAddress" | "autoSubmitted">): boolean {
  const own = [business.email, process.env.SMTP_FROM, process.env.IMAP_USER, process.env.MS_MAILBOX]
    .filter((a): a is string => Boolean(a))
    .map((a) => a.replace(/.*<(.+)>.*/, "$1").toLowerCase());
  return Boolean(mail.autoSubmitted) || AUTOMATED_SENDER.test(mail.fromAddress) || own.includes(mail.fromAddress.toLowerCase());
}

/** E-Mails, die nie an die KI gehen: in Outlook als privat/vertraulich markiert oder Absender auf der Ausnahmeliste. */
export function isExcluded(mail: Pick<IncomingEmail, "fromAddress" | "confidential">): boolean {
  if (mail.confidential) return true;
  const address = mail.fromAddress.toLowerCase();
  return business.emailAssistant.excludeSenders.some((entry) => {
    const rule = entry.trim().toLowerCase();
    return rule.startsWith("@") ? address.endsWith(rule) : rule === address;
  });
}

/** Automatische E-Mails werden nur ausgewertet, wenn sie nach Rechnung aussehen (Rechnungen kommen oft von „noreply“). */
function looksLikeReceipt(mail: IncomingEmail): boolean {
  return Boolean(mail.hasAttachments) || RECEIPT_HINT.test(mail.subject);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Speichert und verarbeitet eine eingehende E-Mail. null, wenn sie schon bekannt war. */
export async function processIncomingEmail(
  mail: IncomingEmail,
  now = new Date(),
  mailbox: Mailbox | null = null,
): Promise<ProcessResult | null> {
  const stored = await insertEmail(mail);
  if (!stored) return null;
  if (isExcluded(mail)) {
    await updateEmail(stored.id, {
      status: "erledigt",
      summary: "Nicht ausgewertet: vertraulich markiert oder Absender auf der Ausnahmeliste",
    });
    return { email: (await getEmail(stored.id))!, events: [] };
  }
  const automated = isAutomated(mail);
  if (automated && !looksLikeReceipt(mail)) {
    await updateEmail(stored.id, { status: "erledigt", category: "sonstiges", summary: "Automatische E-Mail – nicht beantwortet" });
    return { email: (await getEmail(stored.id))!, events: [] };
  }
  // Ohne Anhänge muss das Postfach später nicht danach gefragt werden.
  const attachments = mail.attachments ?? (mail.hasAttachments === false ? [] : undefined);
  return analyzeAndRoute(stored, now, { mailbox, attachments, noReply: automated });
}

export type RouteOptions = {
  mailbox?: Mailbox | null;
  /** Anhänge, falls schon beim Abruf gelesen (IMAP); sonst holt sie das Postfach bei Bedarf. */
  attachments?: MailAttachment[];
  /** Nie antworten (automatische Absender). */
  noReply?: boolean;
};

/** Wertet eine gespeicherte E-Mail aus (auch für „Erneut versuchen“ nach einem Fehler). */
export async function analyzeAndRoute(email: Email, now = new Date(), options: RouteOptions = {}): Promise<ProcessResult> {
  const mailbox = options.mailbox ?? null;
  let thread: string | null = null;
  if (mailbox?.thread && email.conversationId) {
    try {
      thread = await mailbox.thread(email);
    } catch (error) {
      console.error("Verlauf konnte nicht geladen werden:", error);
    }
  }

  let analysis;
  try {
    analysis = await analyzeEmail(email, now, thread);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    await updateEmail(email.id, { status: "fehler", error: error.message });
    return { email: (await getEmail(email.id))!, events: [] };
  }

  const backOffice = BACK_OFFICE.includes(analysis.category);
  let leadId: string | null = null;
  if (!backOffice) {
    const lead = await ensureContact("email", {
      email: email.fromAddress,
      name: analysis.senderName || email.fromName || undefined,
      phone: analysis.phone || undefined,
    });
    leadId = lead.id;
    await addActivity(lead.id, "email", `E-Mail „${email.subject}“ (${EMAIL_CATEGORIES[analysis.category]}): ${analysis.summary}`);
  }

  // Auf Rechnungen und Werbung wird nie geantwortet, auch wenn das Modell einen Entwurf vorschlägt.
  const noReplyCategory = analysis.category === "rechnung_beleg" || analysis.category === "werbung_spam";
  const hasDraft = !options.noReply && !noReplyCategory && analysis.needsReply && analysis.replyBody.trim().length > 0;
  await updateEmail(email.id, {
    leadId,
    category: analysis.category,
    summary: analysis.summary,
    status: hasDraft ? "entwurf" : "erledigt",
    replySubject: hasDraft ? analysis.replySubject : null,
    replyBody: hasDraft ? analysis.replyBody : null,
    error: null,
  });

  // Was im Postfach schiefgeht, hält die Auswertung nicht auf – es wird an der E-Mail vermerkt.
  const problems: string[] = [];

  if (hasDraft && mailbox?.createReplyDraft && email.externalId && !email.draftId) {
    try {
      const draftId = await mailbox.createReplyDraft(email, analysis.replyBody);
      await updateEmail(email.id, { draftId, draftCreatedAt: now.toISOString() });
    } catch (error) {
      problems.push(`Entwurf in Outlook nicht angelegt: ${message(error)}`);
    }
  }

  if (analysis.category === "rechnung_beleg" && business.receipts.enabled) {
    try {
      const files = options.attachments ?? (mailbox?.attachments && email.externalId ? await mailbox.attachments(email.externalId) : []);
      const { stored, duplicates } = await captureReceipts({ files, source: "email", email, receivedAt: new Date(email.receivedAt) });
      if (stored.length === 0 && duplicates === 0) await recordMissingReceipt(email);
    } catch (error) {
      problems.push(`Beleg nicht abgelegt: ${message(error)}`);
    }
  }

  if (mailbox?.file && email.externalId) {
    const { outlookCategoryPrefix: prefix, filing } = business.emailAssistant;
    const categories = [`${prefix}${EMAIL_CATEGORIES[analysis.category]}`, ...(analysis.urgent ? [`${prefix}Dringend`] : [])];
    const folder = filing[analysis.category] ?? null;
    try {
      await mailbox.file(email, categories, folder);
      if (folder) await updateEmail(email.id, { filedTo: folder });
    } catch (error) {
      problems.push(`Ablage in Outlook fehlgeschlagen: ${message(error)}`);
    }
  }
  if (problems.length > 0) await updateEmail(email.id, { error: problems.join(" · ") });

  const events: WebhookEvent[] = [];
  if (!backOffice || analysis.urgent) {
    events.push({
      event: "email.received",
      emailId: email.id,
      leadId,
      category: analysis.category,
      urgent: analysis.urgent,
      summary: `${email.fromName ?? email.fromAddress}: ${analysis.summary}`,
    });
  }

  // Automatischer Versand nur über SMTP. Mit Microsoft 365 liegt der Entwurf in Outlook – gesendet wird dort, von einem Menschen.
  const { mode, autoSendCategories } = business.emailAssistant;
  const mailboxDrafts = Boolean(mailbox?.createReplyDraft);
  if (
    hasDraft &&
    !mailboxDrafts &&
    mode === "autonom" &&
    autoSendCategories.includes(analysis.category) &&
    !analysis.urgent &&
    smtpConfigured()
  ) {
    await sendReply((await getEmail(email.id))!);
  }
  return { email: (await getEmail(email.id))!, events };
}

/** Versendet die (ggf. bearbeitete) Antwort und vermerkt sie beim Kontakt. */
export async function sendReply(email: Email, edited?: { subject: string; body: string }): Promise<void> {
  if (email.draftId) throw new Error("Dieser Entwurf liegt in Outlook und wird dort gesendet.");
  const subject = edited?.subject ?? email.replySubject;
  const body = edited?.body ?? email.replyBody;
  if (!subject || !body) throw new Error("Kein Antwortentwurf vorhanden");
  await sendMail({ to: email.fromAddress, subject, text: body, inReplyTo: email.threadMessageId ?? email.messageId });
  await updateEmail(email.id, { status: "gesendet", replySubject: subject, replyBody: body, sentAt: new Date().toISOString() });
  if (email.leadId) {
    await addActivity(email.leadId, "email", `${email.kind === "nachfass" ? "Nachfass-E-Mail" : "Antwort"} gesendet: „${subject}“`);
  }
}

/** Gleicht ab, ob Entwürfe in Outlook inzwischen gesendet oder gelöscht wurden. */
export async function syncMailboxDrafts(mailbox: Mailbox, now = new Date()): Promise<{ sent: number; discarded: number }> {
  if (!mailbox.draftState) return { sent: 0, discarded: 0 };
  let sent = 0;
  let discarded = 0;
  for (const email of await listMailboxDrafts()) {
    try {
      const state = await mailbox.draftState(email);
      if (state === "gesendet") {
        sent++;
        await updateEmail(email.id, { status: "gesendet", sentAt: now.toISOString() });
        if (email.leadId) await addActivity(email.leadId, "email", `Antwort in Outlook gesendet: „${email.replySubject ?? email.subject}“`);
      } else if (state === "verworfen") {
        discarded++;
        await updateEmail(email.id, { status: "verworfen" });
      }
    } catch (error) {
      console.error(`Entwurfsstatus für E-Mail ${email.id} nicht abrufbar:`, error);
    }
  }
  return { sent, discarded };
}

/** Ruft das Postfach ab, verarbeitet alle neuen E-Mails und gleicht offene Outlook-Entwürfe ab. */
export async function pollMailbox(
  mailbox: Mailbox,
  now = new Date(),
): Promise<{ fetched: number; processed: number; draftsSent: number; events: WebhookEvent[] }> {
  const emails = await mailbox.fetchRecent();
  const known = await knownMessageIds(emails.map((e) => e.messageId));
  const events: WebhookEvent[] = [];
  let processed = 0;
  // Nacheinander, damit Kontakte desselben Absenders nicht doppelt angelegt werden.
  for (const mail of emails.filter((e) => !known.has(e.messageId))) {
    const result = await processIncomingEmail(mail, now, mailbox);
    if (result) {
      processed++;
      events.push(...result.events);
    }
  }
  const { sent } = await syncMailboxDrafts(mailbox, now);
  return { fetched: emails.length, processed, draftsSent: sent, events };
}
