import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

// Chat-Gespräche (WhatsApp und Test-Chat im Cockpit) mit ihren Nachrichten.

export type ChatChannel = "whatsapp" | "simulation";
/** ki: der Assistent antwortet · team: ein Mensch hat übernommen, der Assistent schweigt */
export type ChatMode = "ki" | "team";
export type ChatAuthor = "kunde" | "ki" | "team";

export type Conversation = {
  id: string;
  channel: ChatChannel;
  /** WhatsApp-ID (Telefonnummer ohne „+“) bzw. Kennung des Test-Chats */
  contact: string;
  contactName: string | null;
  leadId: string | null;
  mode: ChatMode;
  lastInboundAt: string | null;
  updatedAt: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  author: ChatAuthor;
  text: string;
  externalId: string | null;
  deliveryError: string | null;
  createdAt: string;
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function toConversation(row: Row): Conversation {
  return {
    id: String(row.id),
    channel: String(row.channel) as ChatChannel,
    contact: String(row.contact),
    contactName: text(row.contact_name),
    leadId: text(row.lead_id),
    mode: String(row.mode) as ChatMode,
    lastInboundAt: text(row.last_inbound_at),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

function toMessage(row: Row): ChatMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    author: String(row.author) as ChatAuthor,
    text: String(row.text),
    externalId: text(row.external_id),
    deliveryError: text(row.delivery_error),
    createdAt: String(row.created_at),
  };
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM conversations WHERE id = ?", args: [id] });
  return result.rows[0] ? toConversation(result.rows[0]) : null;
}

/** Gespräch zu Kanal und Kontakt; wird beim ersten Mal angelegt (created = true). */
export async function openConversation(
  channel: ChatChannel,
  contact: string,
  contactName: string | null,
): Promise<{ conversation: Conversation; created: boolean }> {
  const client = await db();
  const now = new Date().toISOString();
  const insert = await client.execute({
    sql: `INSERT INTO conversations (id, channel, contact, contact_name, mode, updated_at, created_at)
          VALUES (?, ?, ?, ?, 'ki', ?, ?) ON CONFLICT(channel, contact) DO NOTHING`,
    args: [randomUUID(), channel, contact, contactName, now, now],
  });
  const result = await client.execute({ sql: "SELECT * FROM conversations WHERE channel = ? AND contact = ?", args: [channel, contact] });
  const conversation = toConversation(result.rows[0]);
  if (contactName && !conversation.contactName) {
    await client.execute({ sql: "UPDATE conversations SET contact_name = ? WHERE id = ?", args: [contactName, conversation.id] });
    conversation.contactName = contactName;
  }
  return { conversation, created: insert.rowsAffected > 0 };
}

export async function updateConversation(id: string, fields: { mode?: ChatMode; leadId?: string }): Promise<void> {
  const client = await db();
  const sets: string[] = ["updated_at = ?"];
  const args: (string | null)[] = [new Date().toISOString()];
  if (fields.mode) {
    sets.push("mode = ?");
    args.push(fields.mode);
  }
  if (fields.leadId) {
    sets.push("lead_id = ?");
    args.push(fields.leadId);
  }
  await client.execute({ sql: `UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
}

/** Speichert eine Nachricht; null, wenn sie (gleiche externe ID) schon gespeichert war. */
export async function addChatMessage(message: {
  conversationId: string;
  author: ChatAuthor;
  text: string;
  externalId?: string | null;
  deliveryError?: string | null;
  createdAt?: Date;
}): Promise<ChatMessage | null> {
  const client = await db();
  const id = randomUUID();
  const createdAt = (message.createdAt ?? new Date()).toISOString();
  const result = await client.execute({
    sql: `INSERT INTO chat_messages (id, conversation_id, author, text, external_id, delivery_error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING`,
    args: [id, message.conversationId, message.author, message.text, message.externalId ?? null, message.deliveryError ?? null, createdAt],
  });
  if (result.rowsAffected === 0) return null;
  await client.execute({
    sql: `UPDATE conversations SET updated_at = ?${message.author === "kunde" ? ", last_inbound_at = ?" : ""} WHERE id = ?`,
    args: message.author === "kunde" ? [createdAt, createdAt, message.conversationId] : [createdAt, message.conversationId],
  });
  const row = await client.execute({ sql: "SELECT * FROM chat_messages WHERE id = ?", args: [id] });
  return toMessage(row.rows[0]);
}

export async function setDelivery(messageId: string, externalId: string | null, error: string | null): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "UPDATE chat_messages SET external_id = ?, delivery_error = ? WHERE id = ?",
    args: [externalId, error, messageId],
  });
}

/** Die letzten Nachrichten eines Gesprächs in zeitlicher Reihenfolge. */
export async function listChatMessages(conversationId: string, limit = 50): Promise<ChatMessage[]> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM (SELECT *, rowid AS seq FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, seq",
    args: [conversationId, limit],
  });
  return result.rows.map(toMessage);
}

export type ConversationSummary = Conversation & { lastMessage: string | null; lastAuthor: ChatAuthor | null };

export async function listConversations(limit = 100): Promise<ConversationSummary[]> {
  const client = await db();
  const result = await client.execute({
    sql: `SELECT c.*,
            (SELECT text FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_text,
            (SELECT author FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_author
          FROM conversations c ORDER BY c.updated_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => ({
    ...toConversation(row),
    lastMessage: text(row.last_text),
    lastAuthor: text(row.last_author) as ChatAuthor | null,
  }));
}
