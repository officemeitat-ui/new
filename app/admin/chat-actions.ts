"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { handleIncomingChat, sendTeamMessage } from "@/lib/chat/handle";
import { senderFor } from "@/lib/chat/senders";
import { getConversation, updateConversation } from "@/lib/conversations";
import { dispatchEvents } from "@/lib/notify";

export type ChatActionState = { error?: string; ok?: boolean };

function refresh(conversationId?: string) {
  revalidatePath("/admin", "layout");
  if (conversationId) revalidatePath(`/admin/chats/${conversationId}`);
}

/** Test-Chat: schreibt als Kunde an den Assistenten – für Vorführungen ohne WhatsApp. */
export async function simulateChat(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  await requireAdmin();
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 2000);
  if (!text) return { error: "Bitte eine Nachricht eingeben." };
  const existing = formData.get("conversationId") ? await getConversation(String(formData.get("conversationId"))) : null;
  const name =
    String(formData.get("name") ?? "")
      .trim()
      .slice(0, 100) || "Test-Kunde";
  const { reply, events } = await handleIncomingChat(
    {
      channel: "simulation",
      contact: existing?.contact ?? `test-${randomUUID().slice(0, 8)}`,
      contactName: existing?.contactName ?? name,
      text,
      externalId: null,
    },
    senderFor("simulation"),
  );
  if (events.length > 0) after(() => dispatchEvents(events));
  const conversationId = existing?.id ?? reply?.conversationId;
  refresh(conversationId);
  if (!existing && conversationId) redirect(`/admin/chats/${conversationId}`);
  return { ok: true };
}

export async function sendTeamReply(_prev: ChatActionState, formData: FormData): Promise<ChatActionState> {
  await requireAdmin();
  const conversation = await getConversation(String(formData.get("conversationId")));
  if (!conversation) return { error: "Gespräch nicht gefunden" };
  const text = String(formData.get("text") ?? "")
    .trim()
    .slice(0, 4000);
  if (!text) return { error: "Bitte eine Nachricht eingeben." };
  try {
    const message = await sendTeamMessage(conversation.id, text, senderFor(conversation.channel));
    refresh(conversation.id);
    return message.deliveryError ? { error: `Gespeichert, aber nicht zugestellt: ${message.deliveryError}` } : { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setChatMode(formData: FormData) {
  await requireAdmin();
  const conversationId = String(formData.get("conversationId"));
  const mode = formData.get("mode") === "ki" ? "ki" : "team";
  await updateConversation(conversationId, { mode });
  refresh(conversationId);
}
