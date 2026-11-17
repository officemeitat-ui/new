import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

export const EMAIL_CATEGORIES = {
  terminanfrage: "Terminanfrage",
  allgemeine_frage: "Allgemeine Frage",
  angebotsanfrage: "Angebotsanfrage",
  reklamation: "Reklamation",
  rechnung_beleg: "Rechnung / Beleg",
  lieferant_bestellung: "Lieferant / Bestellung",
  werbung_spam: "Werbung / Spam",
  sonstiges: "Sonstiges",
} as const;
export type EmailCategory = keyof typeof EMAIL_CATEGORIES;

/**
 * neu: eingegangen, noch nicht ausgewertet · entwurf: Antwort wartet auf Freigabe · gesendet · erledigt: keine Antwort nötig
 * verworfen: Entwurf abgelehnt · fehler: Auswertung fehlgeschlagen (erneut versuchbar)
 */
export type EmailStatus = "neu" | "entwurf" | "gesendet" | "erledigt" | "verworfen" | "fehler";

export type Email = {
  id: string;
  /** eingang: E-Mail des Kunden mit Antwortentwurf · nachfass: von uns angestoßene Nachfass-E-Mail */
  kind: "eingang" | "nachfass";
  /** Bei Nachfass-E-Mails: Message-ID der ursprünglichen Anfrage, damit die Antwort im selben Verlauf landet. */
  threadMessageId: string | null;
  messageId: string | null;
  leadId: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  category: EmailCategory | null;
  summary: string | null;
  status: EmailStatus;
  replySubject: string | null;
  replyBody: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  /** ID der E-Mail im Postfach (Microsoft 365), für Entwurf, Kategorie und Ablage. */
  externalId: string | null;
  conversationId: string | null;
  /** Antwortentwurf, der direkt im Postfach (Outlook, Ordner „Entwürfe“) liegt. */
  draftId: string | null;
  draftCreatedAt: string | null;
  /** Outlook-Ordner, in den die E-Mail abgelegt wurde. */
  filedTo: string | null;
};

export type IncomingEmail = {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: Date;
  /** Automatisch erzeugte E-Mail (Auto-Submitted-Header), wird nie beantwortet. */
  autoSubmitted?: boolean;
  /** Microsoft 365: ID im Postfach und Gesprächs-ID. */
  externalId?: string;
  conversationId?: string;
  hasAttachments?: boolean;
  /** In Outlook als „Privat“ oder „Vertraulich“ markiert – geht nie an die KI. */
  confidential?: boolean;
  /** IMAP: Anhänge (nur PDF, Bilder, XML), direkt beim Abruf gelesen. */
  attachments?: MailAttachment[];
};

export type MailAttachment = { name: string; contentType: string; content: Buffer };

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toEmail(row: Row): Email {
  return {
    id: String(row.id),
    kind: (text(row.kind) ?? "eingang") as Email["kind"],
    threadMessageId: text(row.thread_message_id),
    messageId: text(row.message_id),
    leadId: text(row.lead_id),
    fromAddress: String(row.from_address),
    fromName: text(row.from_name),
    subject: String(row.subject),
    body: String(row.body),
    receivedAt: String(row.received_at),
    category: text(row.category) as EmailCategory | null,
    summary: text(row.summary),
    status: String(row.status) as EmailStatus,
    replySubject: text(row.reply_subject),
    replyBody: text(row.reply_body),
    error: text(row.error),
    sentAt: text(row.sent_at),
    createdAt: String(row.created_at),
    externalId: text(row.external_id),
    conversationId: text(row.conversation_id),
    draftId: text(row.draft_id),
    draftCreatedAt: text(row.draft_created_at),
    filedTo: text(row.filed_to),
  };
}

/** Speichert eine eingegangene E-Mail; null, wenn sie (gleiche Message-ID) schon vorhanden ist. */
export async function insertEmail(mail: IncomingEmail): Promise<Email | null> {
  const client = await db();
  const id = randomUUID();
  const result = await client.execute({
    sql: `INSERT INTO emails (id, message_id, from_address, from_name, subject, body, received_at, status, created_at, external_id, conversation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'neu', ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
    args: [
      id,
      mail.messageId,
      mail.fromAddress,
      mail.fromName,
      mail.subject.slice(0, 500),
      mail.body.slice(0, 50_000),
      mail.receivedAt.toISOString(),
      new Date().toISOString(),
      mail.externalId ?? null,
      mail.conversationId ?? null,
    ],
  });
  return result.rowsAffected > 0 ? getEmail(id) : null;
}

/**
 * Legt einen Nachfass-Entwurf an. Er erscheint in der Freigabe-Warteschlange wie ein Antwortentwurf;
 * Empfänger ist der Kunde (from_address), der Text der letzten Antwort steht als Kontext im body.
 */
export async function insertFollowUp(followUp: {
  leadId: string;
  to: string;
  toName: string | null;
  threadMessageId: string;
  context: string;
  summary: string;
  subject: string;
  body: string;
}): Promise<Email> {
  const client = await db();
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO emails (id, kind, message_id, thread_message_id, lead_id, from_address, from_name, subject, body, received_at,
            category, summary, status, reply_subject, reply_body, created_at)
          VALUES (?, 'nachfass', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'entwurf', ?, ?, ?)`,
    args: [
      id,
      `<nachfass-${id}@cockpit>`,
      followUp.threadMessageId,
      followUp.leadId,
      followUp.to,
      followUp.toName,
      followUp.subject,
      followUp.context,
      now,
      followUp.summary,
      followUp.subject,
      followUp.body,
      now,
    ],
  });
  return (await getEmail(id))!;
}

export async function getEmail(id: string): Promise<Email | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM emails WHERE id = ?", args: [id] });
  return result.rows[0] ? toEmail(result.rows[0]) : null;
}

export async function knownMessageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const client = await db();
  const result = await client.execute({
    sql: `SELECT message_id FROM emails WHERE message_id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  return new Set(result.rows.map((r) => String(r.message_id)));
}

export async function listEmails(statuses?: EmailStatus[], limit = 200): Promise<Email[]> {
  const client = await db();
  const where = statuses?.length ? `WHERE status IN (${statuses.map(() => "?").join(", ")})` : "";
  const result = await client.execute({
    sql: `SELECT * FROM emails ${where} ORDER BY received_at DESC LIMIT ?`,
    args: [...(statuses ?? []), limit],
  });
  return result.rows.map(toEmail);
}

export async function updateEmail(
  id: string,
  fields: Partial<
    Pick<
      Email,
      | "leadId"
      | "category"
      | "summary"
      | "status"
      | "replySubject"
      | "replyBody"
      | "error"
      | "sentAt"
      | "draftId"
      | "draftCreatedAt"
      | "filedTo"
    >
  >,
): Promise<void> {
  const columns: Record<string, string> = {
    leadId: "lead_id",
    category: "category",
    summary: "summary",
    status: "status",
    replySubject: "reply_subject",
    replyBody: "reply_body",
    error: "error",
    sentAt: "sent_at",
    draftId: "draft_id",
    draftCreatedAt: "draft_created_at",
    filedTo: "filed_to",
  };
  const entries = Object.entries(fields).filter(([key]) => key in columns);
  if (entries.length === 0) return;
  const client = await db();
  await client.execute({
    sql: `UPDATE emails SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`,
    args: [...entries.map(([, value]) => (value === undefined ? null : value)), id],
  });
}

/** Entwürfe, die im Postfach (Outlook) auf Versand warten – für den Abgleich, ob sie inzwischen gesendet wurden. */
export async function listMailboxDrafts(limit = 100): Promise<Email[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM emails WHERE status = 'entwurf' AND draft_id IS NOT NULL ORDER BY received_at LIMIT ?",
    args: [limit],
  });
  return result.rows.map(toEmail);
}
