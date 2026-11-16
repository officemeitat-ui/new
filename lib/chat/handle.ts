import "server-only";
import { generateChatReply } from "@/lib/chat/agent";
import { ensureContact } from "@/lib/contacts";
import {
  addChatMessage,
  getConversation,
  listChatMessages,
  openConversation,
  setDelivery,
  updateConversation,
  type ChatChannel,
  type ChatMessage,
  type Conversation,
} from "@/lib/conversations";
import { addActivity } from "@/lib/leads";
import type { WebhookEvent } from "@/lib/webhook";

export type IncomingChat = {
  channel: ChatChannel;
  /** WhatsApp-ID bzw. Kennung des Test-Chats */
  contact: string;
  contactName: string | null;
  /** Telefonnummer im internationalen Format, falls bekannt (bei WhatsApp immer) */
  contactPhone?: string;
  text: string;
  externalId: string | null;
  receivedAt?: Date;
  /** Bild, Sprachnachricht o. Ä. – kann der Assistent nicht lesen. */
  unsupported?: boolean;
};

export const UNSUPPORTED_REPLY =
  "Danke für Ihre Nachricht! Ich kann derzeit nur Textnachrichten lesen – schreiben Sie mir Ihr Anliegen bitte kurz als Text.";

/** Verschickt eine Nachricht im jeweiligen Kanal und liefert deren externe ID (oder null). Wirft bei Fehlern. */
export type ChatSender = (conversation: Conversation, text: string) => Promise<string | null>;

/** Ab so viel Zeit nach der letzten Kundennachricht erlaubt WhatsApp keine freien Antworten mehr. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Nachrichten eines Gesprächs nacheinander verarbeiten (pro Prozess). Schickt der Kunde mehrere Nachrichten kurz
// hintereinander, antwortet der Assistent nur einmal – auf den gesamten Verlauf.
const queues = new Map<string, Promise<unknown>>();

function inConversationQueue<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(conversationId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  queues.set(conversationId, settled);
  void settled.then(() => {
    if (queues.get(conversationId) === settled) queues.delete(conversationId);
  });
  return run;
}

async function deliver(conversation: Conversation, message: ChatMessage, send: ChatSender): Promise<ChatMessage> {
  try {
    const externalId = await send(conversation, message.text);
    await setDelivery(message.id, externalId, null);
    return { ...message, externalId };
  } catch (error) {
    const deliveryError = error instanceof Error ? error.message : String(error);
    console.error(`Chat-Nachricht ${message.id} nicht zugestellt:`, deliveryError);
    await setDelivery(message.id, null, deliveryError);
    return { ...message, deliveryError };
  }
}

/**
 * Verarbeitet eine eingehende Chat-Nachricht: speichern, Kontakt zuordnen und – solange der Assistent zuständig ist –
 * antworten. Liefert die Antwort (oder null) und Ereignisse für Webhook und Team-Benachrichtigung.
 */
export async function handleIncomingChat(
  incoming: IncomingChat,
  send: ChatSender,
  now = new Date(),
): Promise<{ reply: ChatMessage | null; events: WebhookEvent[] }> {
  const { conversation, created } = await openConversation(incoming.channel, incoming.contact, incoming.contactName);
  const stored = await addChatMessage({
    conversationId: conversation.id,
    author: "kunde",
    text: incoming.text,
    externalId: incoming.externalId,
    createdAt: incoming.receivedAt ?? now,
  });
  if (!stored) return { reply: null, events: [] }; // schon verarbeitet (WhatsApp stellt Webhooks gelegentlich doppelt zu)

  const events: WebhookEvent[] = [];
  if (incoming.channel === "whatsapp" && !conversation.leadId && incoming.contactPhone) {
    const lead = await ensureContact("whatsapp", { name: incoming.contactName ?? undefined, phone: incoming.contactPhone });
    await updateConversation(conversation.id, { leadId: lead.id });
    if (created) await addActivity(lead.id, "chat", "WhatsApp-Gespräch begonnen");
  }

  return inConversationQueue(conversation.id, async () => {
    const current = (await getConversation(conversation.id))!;
    if (current.mode === "team") return { reply: null, events };

    const history = await listChatMessages(conversation.id, 30);
    // Ist inzwischen eine neuere Kundennachricht da, antwortet deren Verarbeitung auf alles zusammen.
    const latestFromCustomer = [...history].reverse().find((m) => m.author === "kunde");
    if (latestFromCustomer && latestFromCustomer.id !== stored.id) return { reply: null, events };

    const result = incoming.unsupported
      ? { text: UNSUPPORTED_REPLY, handoff: false, handoffReason: null }
      : await generateChatReply({ history, contactPhone: incoming.contactPhone, ctx: { now, channel: "whatsapp", events } });
    const reply = await deliver(
      current,
      (await addChatMessage({ conversationId: conversation.id, author: "ki", text: result.text }))!,
      send,
    );

    if (result.handoff) {
      await updateConversation(conversation.id, { mode: "team" });
      const reason = result.handoffReason ?? "Übergabe gewünscht";
      if (current.leadId) await addActivity(current.leadId, "chat", `Chat an das Team übergeben: ${reason}`);
      events.push({
        event: "chat.handoff",
        conversationId: conversation.id,
        leadId: current.leadId,
        contact: current.contactName ?? current.contact,
        reason,
      });
    }
    return { reply, events };
  });
}

/** Nachricht eines Teammitglieds. Übernimmt das Gespräch (Assistent schweigt danach). */
export async function sendTeamMessage(conversationId: string, text: string, send: ChatSender, now = new Date()): Promise<ChatMessage> {
  const conversation = await getConversation(conversationId);
  if (!conversation) throw new Error("Gespräch nicht gefunden");
  if (conversation.channel === "whatsapp") {
    const last = conversation.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : 0;
    if (now.getTime() - last > WHATSAPP_WINDOW_MS) {
      throw new Error("Die letzte Nachricht des Kunden ist älter als 24 Stunden – WhatsApp erlaubt dann nur freigegebene Vorlagen.");
    }
  }
  const message = (await addChatMessage({ conversationId, author: "team", text }))!;
  await updateConversation(conversationId, { mode: "team" });
  return deliver(conversation, message, send);
}
